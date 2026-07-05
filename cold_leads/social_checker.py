"""
social_checker.py — Проверка присутствия и активности бизнеса в соцсетях.

Проверяет:
  - ВКонтакте: наличие группы, дата последнего поста, частота публикаций,
                наличие видеоконтента, визуальная консистентность
  - Telegram:  наличие канала/группы, дата последнего поста

Использует VK API (при наличии токена) или HTML-скрапинг как fallback.
"""

import logging
import re
import time
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any, Tuple
from urllib.parse import urlparse, quote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    VK_ACCESS_TOKEN,
    SOCIAL_CHECK_DELAY_MIN,
    SOCIAL_CHECK_DELAY_MAX,
    ICP,
    MAX_RETRIES,
    RETRY_BACKOFF,
)

# ID города Пермь в VK (используется в groups.search)
VK_PERM_CITY_ID = 119

# Российский телефон — для поиска в описании VK-группы
_PHONE_RE = re.compile(
    r'(?:\+7|8)[\s\(\-]?\d{3}[\s\)\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}'
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HTTP session
# ---------------------------------------------------------------------------

def _build_session() -> requests.Session:
    """Создаёт requests.Session с политикой повторных попыток и UA браузера."""
    session = requests.Session()
    retry = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return session


_SESSION = _build_session()

# VK API version
VK_API_VERSION = "5.199"
VK_API_BASE = "https://api.vk.com/method"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class SocialReport:
    """Результат проверки социальных сетей одной компании."""

    # --- Присутствие ---
    has_vk: bool = False
    has_telegram: bool = False

    # --- Контакты из VK (телефон, сайт из группы) ---
    vk_phone: str = ""
    vk_website: str = ""

    # --- VK детали ---
    vk_url: str = ""
    vk_screen_name: str = ""          # короткое имя группы (slug)
    vk_group_id: int = 0
    vk_members_count: int = 0
    vk_is_closed: bool = False

    # --- Активность VK ---
    last_post_days_ago: int = -1       # -1 = неизвестно
    last_post_timestamp: Optional[int] = None
    posting_frequency: str = "unknown" # daily / weekly / biweekly / monthly / rare / none / unknown
    posts_last_30_days: int = 0
    has_video: bool = False            # есть ли видеозаписи в группе
    has_style_consistency: bool = False  # эвристика по регулярности постов

    # --- Telegram ---
    telegram_url: str = ""
    tg_last_post_days_ago: int = -1

    # --- Флаги для квалификации ---
    is_inactive: bool = False          # нет постов или пост > inactive_social_days
    needs_smm: bool = False            # True → «горячий» кандидат для агентства

    # --- Ошибки ---
    errors: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Helpers — URL parsing
# ---------------------------------------------------------------------------

_VK_URL_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?vk\.com/([a-zA-Z0-9_.]+)",
    re.IGNORECASE,
)
_TG_URL_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/([a-zA-Z0-9_]+)",
    re.IGNORECASE,
)

# Слаги, которые не являются группами
_VK_SYSTEM_SLUGS = {
    "login", "about", "dev", "support", "help", "terms", "privacy",
    "jobs", "donate", "ads", "gifts",
}


def _parse_vk_slug(url: str) -> Optional[str]:
    """Извлекает короткое имя (slug) группы ВКонтакте из URL."""
    m = _VK_URL_PATTERN.search(url)
    if not m:
        return None
    slug = m.group(1).lower().strip("/")
    # Убираем query-параметры (если slug содержит '?')
    slug = slug.split("?")[0]
    if slug in _VK_SYSTEM_SLUGS:
        return None
    return slug


def _parse_tg_slug(url: str) -> Optional[str]:
    """Извлекает username из Telegram URL."""
    m = _TG_URL_PATTERN.search(url)
    if not m:
        return None
    return m.group(1)


# ---------------------------------------------------------------------------
# VK API helpers (requires VK_ACCESS_TOKEN)
# ---------------------------------------------------------------------------

def _vk_api_call(
    method: str,
    params: Dict[str, Any],
    session: requests.Session = _SESSION,
) -> Optional[Dict]:
    """
    Выполняет вызов VK API.
    Возвращает dict из response['response'] или None при ошибке.
    """
    params = {
        **params,
        "access_token": VK_ACCESS_TOKEN,
        "v": VK_API_VERSION,
    }
    url = f"{VK_API_BASE}/{method}"
    try:
        resp = session.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            err = data["error"]
            logger.warning(
                "VK API ошибка %d: %s (метод: %s)",
                err.get("error_code", 0),
                err.get("error_msg", ""),
                method,
            )
            return None
        return data.get("response")
    except requests.RequestException as exc:
        logger.warning("Сетевая ошибка VK API (%s): %s", method, exc)
        return None
    except ValueError:
        logger.warning("Невалидный JSON от VK API (%s)", method)
        return None


def _get_vk_group_info_api(slug: str) -> Optional[Dict]:
    """
    Получает базовую информацию о группе ВКонтакте через API.
    """
    response = _vk_api_call(
        "groups.getById",
        {
            "group_id": slug,
            "fields": "members_count,status,is_closed,activity",
        },
    )
    if not response:
        return None
    groups = response if isinstance(response, list) else response.get("groups", [])
    if groups:
        return groups[0]
    return None


def _get_vk_wall_posts_api(
    owner_id: int,
    count: int = 50,
) -> List[Dict]:
    """
    Получает последние посты со стены группы через VK API.
    owner_id — отрицательный ID группы (например, -12345678).
    """
    response = _vk_api_call(
        "wall.get",
        {
            "owner_id": owner_id,
            "count": count,
            "filter": "owner",
            "fields": "date,attachments",
        },
    )
    if not response:
        return []
    return response.get("items", []) if isinstance(response, dict) else []


def _get_vk_video_count_api(owner_id: int) -> int:
    """Возвращает количество видеозаписей в группе."""
    response = _vk_api_call(
        "video.get",
        {"owner_id": owner_id, "count": 1},
    )
    if not response:
        return 0
    return response.get("count", 0) if isinstance(response, dict) else 0


# ---------------------------------------------------------------------------
# VK: поиск сообщества по имени компании + извлечение контактов
# ---------------------------------------------------------------------------

def search_vk_group(company_name: str) -> Optional[str]:
    """
    Ищет VK-сообщество по названию компании через groups.search.
    Возвращает URL первого подходящего совпадения или None.
    """
    if not VK_ACCESS_TOKEN:
        return None

    # Добавляем "Пермь" чтобы сузить результаты
    query = f"{company_name} Пермь"
    response = _vk_api_call("groups.search", {
        "q": query,
        "count": 5,
        "sort": 0,  # по релевантности
    })
    if not response:
        return None

    items = response.get("items", []) if isinstance(response, dict) else []
    if not items:
        return None

    # Проверяем совпадение по значимым словам названия компании
    name_words = [w.lower() for w in company_name.split() if len(w) > 3]

    for group in items:
        group_name = group.get("name", "").lower()
        screen_name = group.get("screen_name", "")
        if not screen_name:
            continue

        # Хотя бы одно значимое слово из названия компании должно быть в имени группы
        if not name_words or any(w in group_name for w in name_words):
            vk_url = f"https://vk.com/{screen_name}"
            logger.info("VK найден по имени '%s': %s ('%s')", company_name, vk_url, group.get("name"))
            return vk_url

    logger.debug("VK не найден по имени '%s'", company_name)
    return None


def get_vk_contacts(slug: str) -> Dict[str, str]:
    """
    Получает контактные данные из VK-сообщества: телефон, сайт.

    Проверяет (в порядке приоритета):
      1. Поле phone группы
      2. Список contacts (телефоны сотрудников/менеджеров)
      3. Regex по тексту описания группы
      4. Поле site группы
    """
    result = {"phone": "", "website": ""}
    if not VK_ACCESS_TOKEN:
        return result

    response = _vk_api_call("groups.getById", {
        "group_id": slug,
        "fields": "description,site,contacts,phone",
    })
    if not response:
        return result

    groups = response if isinstance(response, list) else response.get("groups", [])
    if not groups:
        return result

    group = groups[0]

    # 1. Прямой телефон группы
    phone = group.get("phone", "").strip()
    if phone:
        result["phone"] = phone

    # 2. Контакты — список менеджеров с телефонами
    if not result["phone"]:
        for contact in group.get("contacts", []):
            contact_phone = (contact.get("phone") or "").strip()
            if contact_phone:
                result["phone"] = contact_phone
                break

    # 3. Regex по описанию группы
    if not result["phone"]:
        description = group.get("description", "") or ""
        m = _PHONE_RE.search(description)
        if m:
            result["phone"] = m.group(0).strip()

    # 4. Сайт
    site = (group.get("site") or "").strip()
    if site and site.startswith(("http://", "https://")):
        result["website"] = site

    if result["phone"] or result["website"]:
        logger.info("VK контакты из '%s': phone=%r site=%r", slug, result["phone"], result["website"])

    return result


# ---------------------------------------------------------------------------
# VK scraping fallback (без API-токена)
# ---------------------------------------------------------------------------

def _scrape_vk_group(slug: str, session: requests.Session = _SESSION) -> Dict:
    """
    Скрапит публичную страницу группы ВКонтакте без токена.
    Возвращает dict с ключами: found, last_post_ts, posts, members, is_closed.
    """
    result = {
        "found": False,
        "last_post_ts": None,
        "posts": [],
        "members": 0,
        "is_closed": False,
        "has_video": False,
    }
    url = f"https://vk.com/{slug}"
    try:
        resp = session.get(url, timeout=12)
        if resp.status_code == 404:
            logger.debug("VK группа не найдена: %s", slug)
            return result
        if resp.status_code != 200:
            logger.debug("VK вернул %d для %s", resp.status_code, slug)
            return result

        html = resp.text
        result["found"] = True

        # Закрытая группа?
        if "Закрытая группа" in html or "closed_group" in html:
            result["is_closed"] = True

        # Участники
        members_match = re.search(r'"members_count"\s*:\s*(\d+)', html)
        if members_match:
            result["members"] = int(members_match.group(1))

        # Временные метки постов (Unix timestamp в data-post-id / post date)
        # VK использует data-post-id и отдельные timestamp в разных форматах
        timestamps: List[int] = []

        # Вариант 1: JSON-объекты с "date" в HTML
        date_matches = re.findall(r'"date"\s*:\s*(\d{10})', html)
        for d in date_matches:
            ts = int(d)
            # Санитизация: 2015 < ts < now+1day
            if 1420000000 < ts < int(datetime.now(timezone.utc).timestamp()) + 86400:
                timestamps.append(ts)

        # Вариант 2: человекочитаемые даты в посте (менее надёжно, как запасной)
        if not timestamps:
            # «сегодня», «вчера», «X дней назад» нам не поможет без JS
            pass

        if timestamps:
            timestamps.sort(reverse=True)
            result["last_post_ts"] = timestamps[0]
            result["posts"] = timestamps

        # Видео
        result["has_video"] = "video_page" in html or "/video-" in html

    except requests.RequestException as exc:
        logger.warning("Ошибка скрапинга VK группы %s: %s", slug, exc)

    return result


# ---------------------------------------------------------------------------
# Frequency classification
# ---------------------------------------------------------------------------

def _classify_frequency(posts_timestamps: List[int]) -> str:
    """
    Определяет частоту публикаций по списку Unix-timestamp постов.
    Анализирует последние 30 дней.
    """
    if not posts_timestamps:
        return "none"

    now_ts = int(datetime.now(timezone.utc).timestamp())
    cutoff_30d = now_ts - 30 * 86400
    cutoff_14d = now_ts - 14 * 86400
    cutoff_7d  = now_ts - 7  * 86400

    posts_30d = sum(1 for ts in posts_timestamps if ts >= cutoff_30d)
    posts_14d = sum(1 for ts in posts_timestamps if ts >= cutoff_14d)
    posts_7d  = sum(1 for ts in posts_timestamps if ts >= cutoff_7d)

    if posts_7d >= 5:
        return "daily"
    if posts_7d >= 2:
        return "weekly"
    if posts_14d >= 2:
        return "biweekly"
    if posts_30d >= 1:
        return "monthly"
    return "rare"


def _has_style_consistency(posts_timestamps: List[int]) -> bool:
    """
    Эвристика: есть ли ритмичность публикаций (признак работы SMM-специалиста).
    Считаем «консистентным», если интервалы между постами примерно одинаковы.
    """
    if len(posts_timestamps) < 4:
        return False
    sorted_ts = sorted(posts_timestamps, reverse=True)
    gaps = [sorted_ts[i] - sorted_ts[i + 1] for i in range(len(sorted_ts) - 1)]
    # Отбрасываем выбросы и считаем вариацию
    avg_gap = sum(gaps) / len(gaps)
    if avg_gap == 0:
        return False
    variance = sum((g - avg_gap) ** 2 for g in gaps) / len(gaps)
    cv = (variance ** 0.5) / avg_gap   # коэффициент вариации
    # Если CV < 0.7 — публикации достаточно регулярны
    return cv < 0.7


# ---------------------------------------------------------------------------
# VK check — main function
# ---------------------------------------------------------------------------

def _check_vk(
    vk_url: str,
    session: requests.Session = _SESSION,
) -> Tuple[bool, Dict]:
    """
    Проверяет VK-присутствие компании.

    Returns:
        (found: bool, details: dict)
    """
    slug = _parse_vk_slug(vk_url)
    if not slug:
        return False, {}

    details = {
        "slug": slug,
        "url": f"https://vk.com/{slug}",
        "group_id": 0,
        "members": 0,
        "is_closed": False,
        "last_post_ts": None,
        "posts_timestamps": [],
        "has_video": False,
    }

    if VK_ACCESS_TOKEN:
        # --- Путь 1: VK API ---
        logger.debug("Проверяем VK через API: %s", slug)
        group_info = _get_vk_group_info_api(slug)
        if not group_info:
            return False, details

        group_id = group_info.get("id", 0)
        details["group_id"] = group_id
        details["members"] = group_info.get("members_count", 0)
        details["is_closed"] = bool(group_info.get("is_closed", 0))

        # Посты
        owner_id = -abs(group_id)   # стены группы — отрицательный ID
        posts = _get_vk_wall_posts_api(owner_id, count=50)
        timestamps = [p["date"] for p in posts if "date" in p]
        details["posts_timestamps"] = timestamps
        details["last_post_ts"] = max(timestamps) if timestamps else None

        # Видео
        video_count = _get_vk_video_count_api(owner_id)
        details["has_video"] = video_count > 0

        return True, details

    else:
        # --- Путь 2: HTML scraping ---
        logger.debug("Проверяем VK через скрапинг: %s", slug)
        scraped = _scrape_vk_group(slug, session)
        if not scraped["found"]:
            return False, details

        details["members"] = scraped["members"]
        details["is_closed"] = scraped["is_closed"]
        details["last_post_ts"] = scraped["last_post_ts"]
        details["posts_timestamps"] = scraped["posts"]
        details["has_video"] = scraped["has_video"]

        return True, details


# ---------------------------------------------------------------------------
# Telegram check
# ---------------------------------------------------------------------------

def _check_telegram(
    tg_url: str,
    session: requests.Session = _SESSION,
) -> Tuple[bool, int]:
    """
    Проверяет наличие Telegram-канала/группы по URL.
    Возвращает (found: bool, last_post_days_ago: int).

    Telegram не имеет публичного API для чтения постов без бота,
    поэтому используем t.me/preview endpoint.
    """
    slug = _parse_tg_slug(tg_url)
    if not slug:
        return False, -1

    # t.me/<slug> → проверяем доступность публичного превью
    preview_url = f"https://t.me/{slug}"
    try:
        resp = session.get(preview_url, timeout=10)
        if resp.status_code == 200 and "tgme_page" in resp.text:
            # Канал существует
            # Точное время последнего поста без Bot API недоступно,
            # но можно попробовать t.me/s/<slug> (публичные каналы)
            last_days = _scrape_tg_last_post(slug, session)
            return True, last_days
        return False, -1
    except requests.RequestException as exc:
        logger.debug("Ошибка проверки Telegram %s: %s", slug, exc)
        return False, -1


def _scrape_tg_last_post(slug: str, session: requests.Session) -> int:
    """
    Пытается определить, сколько дней назад был последний пост,
    через страницу t.me/s/<slug> (работает для публичных каналов).
    Возвращает -1, если не удалось определить.
    """
    url = f"https://t.me/s/{slug}"
    try:
        resp = session.get(url, timeout=10)
        if resp.status_code != 200:
            return -1
        html = resp.text

        # Ищем datetime в атрибутах тегов <time datetime="...">
        dt_matches = re.findall(r'datetime="([^"]+)"', html)
        if not dt_matches:
            return -1

        timestamps: List[int] = []
        for dt_str in dt_matches:
            try:
                # ISO 8601: "2024-05-19T14:30:00+00:00"
                dt = datetime.fromisoformat(dt_str)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                timestamps.append(int(dt.timestamp()))
            except ValueError:
                continue

        if not timestamps:
            return -1

        latest_ts = max(timestamps)
        now_ts = int(datetime.now(timezone.utc).timestamp())
        days_ago = max(0, (now_ts - latest_ts) // 86400)
        return days_ago

    except requests.RequestException:
        return -1


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check_social_presence(
    vk_url: str = "",
    telegram_url: str = "",
    company_name: str = "",
    delay: bool = True,
) -> SocialReport:
    """
    Основная функция: проверяет соцсети компании и возвращает SocialReport.

    Args:
        vk_url:       URL страницы ВКонтакте (может быть пустым).
        telegram_url: URL Telegram-канала (может быть пустым).
        company_name: Название компании (для логов).
        delay:        Делать ли паузу между запросами (для rate limiting).

    Returns:
        SocialReport с заполненными данными.
    """
    report = SocialReport(vk_url=vk_url, telegram_url=telegram_url)
    now_ts = int(datetime.now(timezone.utc).timestamp())

    # --- ВКонтакте ---
    # Если URL не задан — ищем сообщество по названию компании через API
    effective_vk_url = vk_url
    if not effective_vk_url and company_name and VK_ACCESS_TOKEN:
        logger.info("VK поиск по имени: '%s'", company_name)
        found_url = search_vk_group(company_name)
        if found_url:
            effective_vk_url = found_url
            report.vk_url = found_url

    if effective_vk_url:
        try:
            found, details = _check_vk(effective_vk_url)
            report.has_vk = found

            if found:
                report.vk_screen_name = details.get("slug", "")
                report.vk_group_id = details.get("group_id", 0)
                report.vk_members_count = details.get("members", 0)
                report.vk_is_closed = details.get("is_closed", False)
                report.has_video = details.get("has_video", False)

                timestamps = details.get("posts_timestamps", [])
                last_ts = details.get("last_post_ts")

                if last_ts:
                    report.last_post_timestamp = last_ts
                    days_ago = max(0, (now_ts - last_ts) // 86400)
                    report.last_post_days_ago = days_ago
                else:
                    report.last_post_days_ago = 999  # группа есть, постов нет

                cutoff_30d = now_ts - 30 * 86400
                report.posts_last_30_days = sum(
                    1 for ts in timestamps if ts >= cutoff_30d
                )
                report.posting_frequency = _classify_frequency(timestamps)
                report.has_style_consistency = _has_style_consistency(timestamps)

                # Извлекаем контактные данные из VK-сообщества
                slug = details.get("slug", "")
                if slug and VK_ACCESS_TOKEN:
                    vk_contacts = get_vk_contacts(slug)
                    report.vk_phone = vk_contacts.get("phone", "")
                    report.vk_website = vk_contacts.get("website", "")

        except Exception as exc:
            msg = f"Ошибка проверки VK для '{company_name}': {exc}"
            logger.error(msg)
            report.errors.append(msg)

        if delay:
            time.sleep(random.uniform(SOCIAL_CHECK_DELAY_MIN, SOCIAL_CHECK_DELAY_MAX))

    # --- Telegram ---
    if telegram_url:
        try:
            found, tg_days = _check_telegram(telegram_url)
            report.has_telegram = found
            report.tg_last_post_days_ago = tg_days
        except Exception as exc:
            msg = f"Ошибка проверки Telegram для '{company_name}': {exc}"
            logger.error(msg)
            report.errors.append(msg)

        if delay:
            time.sleep(random.uniform(SOCIAL_CHECK_DELAY_MIN, SOCIAL_CHECK_DELAY_MAX))

    # --- Итоговые флаги ---
    _compute_flags(report)

    return report


def _compute_flags(report: SocialReport) -> None:
    """
    Вычисляет флаги is_inactive и needs_smm на основе собранных данных.
    Мутирует переданный объект report.
    """
    inactive_threshold = ICP.inactive_social_days

    if not report.has_vk and not report.has_telegram:
        # Соцсетей нет вообще — максимальная потребность в SMM
        report.is_inactive = True
        report.needs_smm = True
        return

    if report.has_vk:
        if report.last_post_days_ago < 0:
            # Группа закрытая или информация недоступна
            report.is_inactive = False
            report.needs_smm = False
        elif report.last_post_days_ago >= inactive_threshold:
            report.is_inactive = True
            report.needs_smm = True
        else:
            # Активная группа — нужны дополнительные факторы
            report.is_inactive = False
            # Потенциальная потребность в улучшении SMM:
            # нет видео, нет консистентности, мало постов
            needs_improvement = (
                not report.has_video
                or not report.has_style_consistency
                or report.posts_last_30_days < 8
            )
            report.needs_smm = needs_improvement
    elif report.has_telegram:
        if report.tg_last_post_days_ago >= inactive_threshold:
            report.is_inactive = True
            report.needs_smm = True


def check_multiple(
    companies: List[Dict[str, str]],
) -> List[Tuple[str, SocialReport]]:
    """
    Проверяет список компаний пакетно.

    Args:
        companies: Список словарей с ключами:
                   name, vk_url (опц.), telegram_url (опц.)

    Returns:
        Список кортежей (company_name, SocialReport).
    """
    results = []
    for i, company in enumerate(companies, 1):
        name = company.get("name", f"Компания #{i}")
        vk = company.get("vk_url", "")
        tg = company.get("telegram_url", "")
        logger.info("[%d/%d] Проверяем: %s", i, len(companies), name)
        report = check_social_presence(vk_url=vk, telegram_url=tg, company_name=name)
        results.append((name, report))
    return results


# ---------------------------------------------------------------------------
# CLI для тестирования
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Принимаем VK URL как аргумент или используем тестовый
    vk_test = sys.argv[1] if len(sys.argv) > 1 else "https://vk.com/dinamikaagency"
    tg_test = sys.argv[2] if len(sys.argv) > 2 else ""

    report = check_social_presence(vk_url=vk_test, telegram_url=tg_test, company_name="Тест")

    print("\n=== SocialReport ===")
    print(f"  ВКонтакте:         {'есть' if report.has_vk else 'нет'}")
    print(f"  Telegram:          {'есть' if report.has_telegram else 'нет'}")
    print(f"  Последний пост:    {report.last_post_days_ago} дн. назад")
    print(f"  Частота:           {report.posting_frequency}")
    print(f"  Постов за 30 дн.:  {report.posts_last_30_days}")
    print(f"  Есть видео:        {report.has_video}")
    print(f"  Консистентность:   {report.has_style_consistency}")
    print(f"  Неактивен:         {report.is_inactive}")
    print(f"  Нужен SMM:         {report.needs_smm}")
    if report.errors:
        print(f"  Ошибки:            {report.errors}")
