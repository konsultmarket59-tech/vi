"""
parser_2gis.py — Парсер каталога 2GIS для сбора бизнесов Перми.

Использует публичный каталожный API 2GIS:
  GET https://catalog.api.2gis.com/3.0/items
  Параметры: key, q, city_id=38 (Пермь), type=branch, fields=...

Извлекает: название, адрес, телефон, сайт, ссылки на VK/Telegram,
           рейтинг, количество отзывов.

Публичный API:
  parse_query(query, max_pages, api_key, save_to_db) -> List[Lead]
  parse_all_categories(queries, max_pages_per_query, api_key) -> List[Lead]
  parse_category(category, max_results, api_key) -> List[ParsedCompany]  # обёртка для main.py
  ParsedCompany  — dataclass, совместимый с интерфейсом main.py
"""

import logging
import re
import time
import random
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    TWOGIS_API_BASE,
    TWOGIS_API_KEY,
    TWOGIS_DEMO_KEY,
    TWOGIS_CITY_ID,
    TWOGIS_FIELDS,
    TWOGIS_PAGE_SIZE,
    TWOGIS_REQUEST_DELAY_MIN,
    TWOGIS_REQUEST_DELAY_MAX,
    TARGET_SEARCH_QUERIES,
    ICP,
    MAX_LEADS_PER_DAY,
    MAX_RETRIES,
    RETRY_BACKOFF,
)
from database import Lead, save_lead, leads_created_today

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HTTP session with retry logic
# ---------------------------------------------------------------------------

def _build_session() -> requests.Session:
    """Создаёт requests.Session с политикой повторных попыток."""
    session = requests.Session()
    retry_strategy = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (compatible; DynamikaLeadBot/1.0; +https://dynamicbrands.ru)"
        ),
        "Accept": "application/json",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    })
    return session


_SESSION = _build_session()


# ---------------------------------------------------------------------------
# Contact extraction helpers
# ---------------------------------------------------------------------------

_VK_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?vk\.com/([a-zA-Z0-9_.]+)",
    re.IGNORECASE,
)
_TG_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/([a-zA-Z0-9_]+)",
    re.IGNORECASE,
)
_INSTA_PATTERN = re.compile(
    r"(?:https?://)?(?:www\.)?instagram\.com/([a-zA-Z0-9_.]+)",
    re.IGNORECASE,
)


def _extract_phone(contact_groups: List[Dict]) -> str:
    """Извлекает первый телефонный номер из contact_groups 2GIS."""
    for group in contact_groups:
        for contact in group.get("contacts", []):
            if contact.get("type") == "phone":
                value = contact.get("value", "").strip()
                if value:
                    return value
    return ""


def _extract_email(contact_groups: List[Dict]) -> str:
    """Извлекает первый email из contact_groups 2GIS."""
    for group in contact_groups:
        for contact in group.get("contacts", []):
            if contact.get("type") == "email":
                value = contact.get("value", "").strip()
                if value:
                    return value
    return ""


def _link_to_url(link) -> str:
    """Извлекает URL из элемента links — строка или dict."""
    if isinstance(link, str):
        return link.strip()
    if isinstance(link, dict):
        return link.get("url", "").strip()
    return ""


def _extract_website(links) -> str:
    """Извлекает URL сайта из поля links 2GIS."""
    for link in links:
        if isinstance(link, dict):
            link_type = link.get("type", "")
            url = link.get("url", "").strip()
        else:
            link_type = ""
            url = str(link).strip()
        if not url:
            continue
        if link_type == "website":
            return url
        # Fallback: любая ссылка, не являющаяся соцсетью
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        if not any(s in host for s in ("vk.com", "t.me", "instagram", "facebook", "ok.ru")):
            return url
    return ""


def _extract_social_links(
    links,
    contact_groups: List[Dict],
) -> Dict[str, str]:
    """
    Извлекает ссылки на ВКонтакте, Telegram, Instagram из всех доступных полей.
    Возвращает dict с ключами: vk, telegram, instagram.
    """
    socials = {"vk": "", "telegram": "", "instagram": ""}

    # Собираем все URL в одном месте для поиска
    all_urls: List[str] = []

    for link in links:
        url = _link_to_url(link)
        if url:
            all_urls.append(url)

    for group in contact_groups:
        for contact in group.get("contacts", []):
            contact_type = contact.get("type", "")
            value = contact.get("value", "").strip()
            if value:
                if contact_type in ("social_media", "vkontakte", "vk"):
                    all_urls.append(value)
                elif contact_type in ("telegram",):
                    all_urls.append(value)
                elif contact_type in ("instagram",):
                    all_urls.append(value)

    for url in all_urls:
        if not socials["vk"]:
            m = _VK_PATTERN.search(url)
            if m:
                socials["vk"] = f"https://vk.com/{m.group(1)}"
        if not socials["telegram"]:
            m = _TG_PATTERN.search(url)
            if m:
                socials["telegram"] = f"https://t.me/{m.group(1)}"
        if not socials["instagram"]:
            m = _INSTA_PATTERN.search(url)
            if m:
                socials["instagram"] = f"https://www.instagram.com/{m.group(1)}"

    return socials


def _extract_address(item: Dict) -> str:
    """Извлекает адрес из объекта 2GIS."""
    # Попробуем address_name, затем full_address_name
    addr = item.get("address_name", "") or item.get("full_address_name", "")
    if not addr:
        # Собираем вручную
        address_obj = item.get("address", {})
        parts = []
        if address_obj.get("street_name"):
            parts.append(address_obj["street_name"])
        if address_obj.get("building_id"):
            pass  # не нужен
        if address_obj.get("building_name"):
            parts.append(address_obj["building_name"])
        addr = ", ".join(parts)
    return addr.strip()


def _extract_category(item: Dict) -> str:
    """Возвращает основную рубрику объекта 2GIS."""
    rubrics = item.get("rubrics", [])
    if rubrics:
        return rubrics[0].get("name", "")
    return ""


def _get_rating(item: Dict) -> tuple[float, int]:
    """Возвращает (рейтинг, кол-во отзывов) из данных 2GIS."""
    reviews = item.get("reviews", {})
    if isinstance(reviews, dict):
        rating = float(reviews.get("rating", 0) or 0)
        count = int(reviews.get("count", 0) or 0)
        return rating, count
    return 0.0, 0


# ---------------------------------------------------------------------------
# ICP pre-filter (быстрый фильтр до сохранения в БД)
# ---------------------------------------------------------------------------

def _should_skip(name: str, category: str) -> bool:
    """
    Быстрая проверка: нужно ли пропустить компанию по стоп-словам.
    Более детальная квалификация — в qualifier.py через Claude.
    """
    name_lower = name.lower()
    cat_lower = category.lower()
    combined = f"{name_lower} {cat_lower}"

    for kw in ICP.skip_keywords:
        if kw in combined:
            logger.debug("Пропуск '%s' — стоп-слово '%s'", name, kw)
            return True

    for chain in ICP.known_chains:
        if chain in combined:
            logger.debug("Пропуск '%s' — известная сеть/франшиза", name)
            return True

    return False


# ---------------------------------------------------------------------------
# Core API call
# ---------------------------------------------------------------------------

def _fetch_page(
    session: requests.Session,
    query: str,
    page: int,
    api_key: str,
) -> Optional[Dict[str, Any]]:
    """
    Выполняет один запрос к 2GIS catalog API.
    Возвращает parsed JSON или None при ошибке.
    """
    params = {
        "q": query,
        "type": "branch",
        "fields": TWOGIS_FIELDS,
        "page_size": TWOGIS_PAGE_SIZE,
        "page": page,
        "key": api_key,
        "locale": "ru_RU",
    }

    url = TWOGIS_API_BASE
    safe_params = {k: v for k, v in params.items() if k != "key"}
    safe_params["key"] = f"{api_key[:6]}..." if api_key else "EMPTY"
    logger.info("2GIS запрос: %s params=%s", url, safe_params)

    try:
        response = session.get(url, params=params, timeout=15)
        logger.info("2GIS ответ: HTTP %d, длина=%d", response.status_code, len(response.content))
        response.raise_for_status()
        data = response.json()
        items = data.get("result", {}).get("items", [])
        meta = data.get("meta", {})
        logger.info("2GIS result: items=%d, meta=%s, top-keys=%s", len(items), meta, list(data.keys()))
        if not items:
            logger.warning(
                "2GIS вернул 0 объектов (q=%r, page=%d). meta=%s, full=%s",
                query, page, meta, str(data)[:500],
            )
        return data
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response else "?"
        body = exc.response.text[:500] if exc.response is not None else ""
        logger.warning("HTTP %s при запросе 2GIS (q=%r, page=%d). body=%s", status, query, page, body)
        if status in (401, 403):
            logger.error(
                "Ключ 2GIS недействителен или исчерпан лимит. "
                "Получите ключ на https://dev.2gis.com/ и добавьте "
                "TWOGIS_API_KEY в GitHub Secrets."
            )
        return None
    except requests.exceptions.Timeout:
        logger.warning("Таймаут при запросе 2GIS (q=%r, page=%d)", query, page)
        return None
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Ошибка соединения с 2GIS (q=%r): %s", query, exc)
        return None
    except Exception as exc:
        logger.error("Неожиданная ошибка 2GIS (q=%r): %s: %s", query, type(exc).__name__, exc)
        return None
    except requests.exceptions.ConnectionError as exc:
        logger.warning("Ошибка соединения с 2GIS: %s", exc)
        return None
    except ValueError:
        logger.warning("Невалидный JSON от 2GIS (q=%r, page=%d)", query, page)
        return None


# ---------------------------------------------------------------------------
# Parse single item
# ---------------------------------------------------------------------------

def _parse_item(item: Dict, source_query: str) -> Optional[Lead]:
    """
    Преобразует один объект из ответа 2GIS в Lead.
    Возвращает None, если данных недостаточно или объект нужно пропустить.
    """
    name = item.get("name", "").strip()
    if not name:
        return None

    address = _extract_address(item)
    if not address:
        address = "Пермь"

    category = _extract_category(item)
    rating, review_count = _get_rating(item)

    # Быстрый фильтр стоп-слов
    if _should_skip(name, category):
        return None

    # Контакты
    contact_groups = item.get("contact_groups", [])
    links = item.get("links", [])

    phone = _extract_phone(contact_groups)
    email = _extract_email(contact_groups)
    website = _extract_website(links)
    socials = _extract_social_links(links, contact_groups)

    lead = Lead(
        company_name=name,
        category=category,
        address=address,
        phone=phone,
        website=website,
        vk_url=socials["vk"],
        telegram_url=socials["telegram"],
        instagram_url=socials["instagram"],
        rating=rating,
        review_count=review_count,
        source_query=source_query,
    )
    lead.email = email  # type: ignore[attr-defined]

    return lead


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_query(
    query: str,
    max_pages: int = 5,
    api_key: Optional[str] = None,
    save_to_db: bool = True,
) -> List[Lead]:
    """
    Собирает лиды по одному поисковому запросу через 2GIS API.

    Args:
        query:      Поисковый запрос, например «салон красоты Пермь».
        max_pages:  Максимальное число страниц (до 50 результатов каждая).
        api_key:    2GIS API ключ (если не указан — берётся из config).
        save_to_db: Сохранять ли найденные лиды в БД автоматически.

    Returns:
        Список найденных Lead-объектов (включая уже существующие в БД).
    """
    effective_key = api_key or TWOGIS_API_KEY or TWOGIS_DEMO_KEY
    leads: List[Lead] = []

    logger.info("Запрос 2GIS: %r (до %d страниц)", query, max_pages)

    for page in range(1, max_pages + 1):
        # Проверяем суточный лимит
        if save_to_db and leads_created_today() >= MAX_LEADS_PER_DAY:
            logger.info("Достигнут суточный лимит (%d лидов), остановка", MAX_LEADS_PER_DAY)
            break

        data = _fetch_page(_SESSION, query, page, effective_key)
        if not data:
            break

        result = data.get("result", {})
        items = result.get("items", [])

        if not items:
            logger.debug("Страница %d пуста, завершаем пагинацию", page)
            break

        total = result.get("total", 0)
        logger.debug(
            "Страница %d/%d: получено %d объектов, всего найдено %d",
            page,
            max_pages,
            len(items),
            total,
        )

        for item in items:
            lead = _parse_item(item, source_query=query)
            if lead is None:
                continue

            if save_to_db:
                saved_id = save_lead(lead)
                if saved_id:
                    lead.id = saved_id
                    leads.append(lead)
                    logger.debug("Сохранён лид: %s (%s)", lead.company_name, lead.address)
            else:
                leads.append(lead)

        # Не тянем следующую страницу, если объектов меньше размера страницы
        if len(items) < TWOGIS_PAGE_SIZE:
            break

        # Rate limiting
        delay = random.uniform(TWOGIS_REQUEST_DELAY_MIN, TWOGIS_REQUEST_DELAY_MAX)
        logger.debug("Пауза %.1f сек перед следующей страницей", delay)
        time.sleep(delay)

    logger.info(
        "Запрос %r завершён: собрано %d лидов",
        query,
        len(leads),
    )
    return leads


def parse_all_categories(
    queries: Optional[List[str]] = None,
    max_pages_per_query: int = 3,
    api_key: Optional[str] = None,
) -> List[Lead]:
    """
    Запускает парсинг по всем целевым категориям из конфига.
    Соблюдает суточный лимит MAX_LEADS_PER_DAY.

    Args:
        queries:              Список запросов (если None — используется TARGET_SEARCH_QUERIES).
        max_pages_per_query:  Число страниц на каждый запрос.
        api_key:              2GIS API ключ.

    Returns:
        Объединённый список всех найденных лидов.
    """
    queries = queries or TARGET_SEARCH_QUERIES
    all_leads: List[Lead] = []

    for i, query in enumerate(queries, 1):
        # Проверяем суточный лимит перед каждым запросом
        if leads_created_today() >= MAX_LEADS_PER_DAY:
            logger.info(
                "Суточный лимит достигнут после %d запросов, завершаем",
                i - 1,
            )
            break

        logger.info("[%d/%d] Парсим: %r", i, len(queries), query)
        leads = parse_query(
            query=query,
            max_pages=max_pages_per_query,
            api_key=api_key,
            save_to_db=True,
        )
        all_leads.extend(leads)

        # Пауза между запросами
        if i < len(queries):
            delay = random.uniform(TWOGIS_REQUEST_DELAY_MIN, TWOGIS_REQUEST_DELAY_MAX)
            time.sleep(delay)

    logger.info(
        "Парсинг завершён: %d запросов, %d лидов сохранено",
        len(queries),
        len(all_leads),
    )
    return all_leads


# ---------------------------------------------------------------------------
# ParsedCompany — lightweight dataclass для main.py (совместимость)
# ---------------------------------------------------------------------------

@dataclass
class ParsedCompany:
    """
    Простой контейнер данных компании, возвращаемый parse_category().
    Совместим с интерфейсом, ожидаемым main.py.
    """
    name: str
    address: str
    phone: str = ""
    email: str = ""
    website: str = ""
    vk_url: str = ""
    telegram_url: str = ""
    instagram_url: str = ""
    category: str = ""
    rating: float = 0.0
    review_count: int = 0


def _lead_to_parsed(lead: "Lead") -> ParsedCompany:
    """Конвертирует Lead в ParsedCompany."""
    return ParsedCompany(
        name=lead.company_name,
        address=lead.address,
        phone=lead.phone,
        email=getattr(lead, "email", ""),
        website=lead.website,
        vk_url=lead.vk_url,
        telegram_url=lead.telegram_url,
        instagram_url=getattr(lead, "instagram_url", ""),
        category=lead.category,
        rating=lead.rating,
        review_count=lead.review_count,
    )


def parse_category(
    category: str,
    max_results: int = 30,
    api_key: Optional[str] = None,
) -> List[ParsedCompany]:
    """
    Парсит компании по категории из 2GIS и возвращает список ParsedCompany.
    Обёртка над parse_query() для совместимости с main.py.

    Args:
        category:    Категория / поисковый запрос (например «медицина»).
                     Если не содержит слово «Пермь» — добавляется автоматически.
        max_results: Ограничение на кол-во результатов.
        api_key:     2GIS API ключ (если None — берётся из config).

    Returns:
        Список ParsedCompany (не сохраняется в БД).
    """
    # Нормализуем запрос: добавляем город, если его нет
    query = category.strip()
    if "пермь" not in query.lower():
        query = f"{query} Пермь"

    # Определяем число страниц исходя из max_results
    pages_needed = max(1, (max_results + TWOGIS_PAGE_SIZE - 1) // TWOGIS_PAGE_SIZE)

    leads = parse_query(
        query=query,
        max_pages=pages_needed,
        api_key=api_key,
        save_to_db=False,
    )

    companies = [_lead_to_parsed(lead) for lead in leads]

    # Ограничиваем результат
    return companies[:max_results]


# ---------------------------------------------------------------------------
# CLI для быстрого тест-запуска
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    import json
    from database import init_db

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    # Инициализируем БД
    init_db()

    # Тестовый запрос
    test_query = sys.argv[1] if len(sys.argv) > 1 else "салон красоты Пермь"
    results = parse_query(test_query, max_pages=1, save_to_db=False)

    print(f"\nНайдено лидов: {len(results)}")
    for lead in results[:5]:
        print(f"\n  Компания:  {lead.company_name}")
        print(f"  Категория: {lead.category}")
        print(f"  Адрес:     {lead.address}")
        print(f"  Телефон:   {lead.phone}")
        print(f"  Сайт:      {lead.website}")
        print(f"  ВКонтакте: {lead.vk_url}")
        print(f"  Telegram:  {lead.telegram_url}")
        print(f"  Рейтинг:   {lead.rating} ({lead.review_count} отзывов)")
