"""
enricher_free.py — Бесплатное обогащение контактов без API-ключей.

Источники (в порядке приоритета):
  1. OpenStreetMap Overpass API (overpass-api.de) — телефон, сайт.
     Бесплатно, без регистрации, данные CC-BY-SA.
  2. Парсинг сайта компании — regex по главной странице.

Использование:
  contacts = enrich_contacts("Кафе Лакомка")
  # {"phone": "+7 342 218-45-67", "website": "https://..."}
"""

import logging
import re
import time
from typing import Dict

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

_OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Пермь: bounding box south,west,north,east
_PERM_BBOX = "57.8,55.9,58.3,56.6"

# Российский телефон: +7/8 XXX XXX-XX-XX и вариации
_PHONE_RE = re.compile(
    r'(?:\+7|8)[\s\(\-]?\d{3}[\s\)\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}'
)


def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=2, backoff_factor=1.0, status_forcelist=[429, 500, 503])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers["User-Agent"] = "Mozilla/5.0 DynamikaLeadBot/1.0 (+https://dynamicbrands.ru)"
    return session


_SESSION = _build_session()


def _osm_lookup(name: str) -> Dict[str, str]:
    """Ищет компанию в OpenStreetMap по имени в Перми (Overpass API)."""
    # Экранируем для Overpass regex (не Python regex)
    safe = re.sub(r'[^\w\s\-]', '', name[:25]).strip()
    if not safe:
        return {}

    query = f"""[out:json][timeout:15];
(
  node["name"~"{safe}",i]({_PERM_BBOX});
  way["name"~"{safe}",i]({_PERM_BBOX});
  relation["name"~"{safe}",i]({_PERM_BBOX});
);
out body;"""

    try:
        resp = _SESSION.post(_OVERPASS_URL, data={"data": query}, timeout=20)
        resp.raise_for_status()
        elements = resp.json().get("elements", [])
    except requests.RequestException as exc:
        logger.debug("OSM Overpass ошибка '%s': %s", name, exc)
        return {}

    result: Dict[str, str] = {}
    for elem in elements:
        tags = elem.get("tags", {})
        if not result.get("phone"):
            phone = (
                tags.get("phone") or
                tags.get("contact:phone") or
                tags.get("contact:mobile") or ""
            ).strip()
            if phone:
                result["phone"] = phone
        if not result.get("website"):
            site = (
                tags.get("website") or
                tags.get("contact:website") or
                tags.get("url") or ""
            ).strip()
            if site and site.startswith(("http://", "https://")):
                result["website"] = site
        if result.get("phone") and result.get("website"):
            break

    if result:
        logger.info("OSM '%s': %s", name, result)
    return result


def _website_phone(url: str) -> str:
    """Ищет российский телефон на главной странице сайта."""
    if not url or not url.startswith(("http://", "https://")):
        return ""
    try:
        resp = _SESSION.get(url, timeout=8, allow_redirects=True)
        resp.raise_for_status()
        # Убираем HTML-теги для чистого поиска
        text = re.sub(r'<[^>]+>', ' ', resp.text[:80_000])
        matches = _PHONE_RE.findall(text)
        if matches:
            phone = matches[0].strip()
            logger.info("Regex телефон из сайта %s: %r", url, phone)
            return phone
    except requests.RequestException as exc:
        logger.debug("Не удалось загрузить сайт %s: %s", url, exc)
    return ""


def enrich_contacts(name: str, website_hint: str = "") -> Dict[str, str]:
    """
    Ищет телефон и сайт без платных API.

    Порядок:
      1. OpenStreetMap Overpass — по имени в Перми
      2. Regex по HTML сайта (если URL известен из OSM или подсказки)

    Args:
        name: Название компании
        website_hint: URL сайта если уже известен (пропускает его парсинг через OSM)

    Returns:
        {"phone": "...", "website": "..."}
    """
    result = {"phone": "", "website": website_hint or ""}

    # 1. OSM
    osm = _osm_lookup(name)
    if osm.get("phone"):
        result["phone"] = osm["phone"]
    if osm.get("website") and not result["website"]:
        result["website"] = osm["website"]

    # 2. Regex по сайту (если телефона всё ещё нет, но есть URL)
    if not result["phone"] and result["website"]:
        phone = _website_phone(result["website"])
        if phone:
            result["phone"] = phone

    return result


def enrich_batch(companies, delay: float = 1.5) -> None:
    """
    Обогащает список ParsedCompany контактами in-place.
    Добавляет паузу между запросами чтобы не перегружать Overpass.
    """
    no_contact = [c for c in companies if not c.phone]
    if not no_contact:
        return

    logger.info("Бесплатное обогащение OSM для %d компаний без телефона...", len(no_contact))
    for i, company in enumerate(no_contact):
        contacts = enrich_contacts(company.name, website_hint=company.website)
        if contacts["phone"]:
            company.phone = contacts["phone"]
        if contacts["website"] and not company.website:
            company.website = contacts["website"]
        if i < len(no_contact) - 1:
            time.sleep(delay)
