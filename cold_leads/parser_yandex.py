"""
parser_yandex.py — Парсер организаций через Яндекс Геопоиск.

Использует Яндекс Maps Search API (search-maps.yandex.ru/v1/):
  https://yandex.ru/dev/maps/geosearch/

Бесплатный ключ: developer.tech.yandex.ru → проект → "Search API"
Лимит бесплатного тарифа: 1 000 запросов в сутки.

Публичный API (совместим с parser_2gis):
  parse_category(category, max_results, api_key) -> List[ParsedCompany]
  enrich_phone(name, api_key) -> str   # обогащение данных 2GIS телефоном
"""

import logging
import random
import time
from typing import Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    ICP,
    MAX_RETRIES,
    RETRY_BACKOFF,
    TARGET_SEARCH_QUERIES,
    TWOGIS_REQUEST_DELAY_MIN,
    TWOGIS_REQUEST_DELAY_MAX,
    YANDEX_MAPS_API_KEY,
)
from parser_2gis import ParsedCompany

logger = logging.getLogger(__name__)

_YANDEX_SEARCH_API = "https://search-maps.yandex.ru/v1/"

# Центр Перми: lon, lat (формат Яндекса — lon первым)
_PERM_LL = "56.2502,58.0105"
# Охват ±0.5 градуса ≈ покрывает весь город
_PERM_SPN = "0.5,0.5"


def _build_session() -> requests.Session:
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
        "User-Agent": "DynamikaLeadBot/1.0 (+https://dynamicbrands.ru)",
        "Accept": "application/json",
    })
    return session


_SESSION = _build_session()


def _extract_phone(meta: Dict) -> str:
    """Первый телефон из CompanyMetaData (поле Phones или Phone)."""
    phones = meta.get("Phones") or meta.get("Phone") or []
    for p in phones:
        if isinstance(p, dict):
            formatted = p.get("formatted", "").strip()
            if formatted:
                return formatted
    return ""


def _extract_website(meta: Dict) -> str:
    url = meta.get("url", "").strip()
    return url if url.startswith(("http://", "https://")) else ""


def _extract_rating(meta: Dict) -> tuple:
    rating_obj = meta.get("rating", {})
    if isinstance(rating_obj, dict):
        score = float(rating_obj.get("score", 0) or 0)
        count = int(rating_obj.get("ratings", 0) or 0)
        return score, count
    return 0.0, 0


def _extract_category(meta: Dict) -> str:
    cats = meta.get("Categories", [])
    return cats[0].get("name", "") if cats else ""


def _should_skip(name: str, category: str) -> bool:
    combined = f"{name.lower()} {category.lower()}"
    for kw in ICP.skip_keywords:
        if kw in combined:
            return True
    for chain in ICP.known_chains:
        if chain in combined:
            return True
    return False


def _fetch_orgs(query: str, results: int = 10, api_key: str = "") -> List[Dict]:
    """Запрашивает список организаций из Яндекс Геопоиска."""
    key = api_key or YANDEX_MAPS_API_KEY
    if not key:
        return []
    params = {
        "text": query,
        "lang": "ru_RU",
        "type": "biz",
        "results": min(results, 500),
        "rspn": "1",
        "ll": _PERM_LL,
        "spn": _PERM_SPN,
        "apikey": key,
    }
    try:
        resp = _SESSION.get(_YANDEX_SEARCH_API, params=params, timeout=15)
        logger.info("Яндекс запрос '%s': HTTP %d", query, resp.status_code)
        if resp.status_code == 403:
            logger.error(
                "Яндекс API: 403 Forbidden — проверьте YANDEX_MAPS_API_KEY. "
                "Ключ: developer.tech.yandex.ru → Search API"
            )
            return []
        resp.raise_for_status()
        features = resp.json().get("features", [])
        logger.info("Яндекс '%s': %d организаций", query, len(features))
        return features
    except requests.HTTPError as exc:
        logger.warning("HTTP ошибка Яндекс (q=%r): %s", query, exc)
        return []
    except requests.RequestException as exc:
        logger.warning("Сетевая ошибка Яндекс (q=%r): %s", query, exc)
        return []


def _feature_to_company(feature: Dict) -> Optional[ParsedCompany]:
    """Конвертирует GeoJSON Feature Яндекса в ParsedCompany."""
    props = feature.get("properties", {})
    meta = props.get("CompanyMetaData", {})
    if not meta:
        return None

    name = meta.get("name", "").strip()
    if not name:
        return None

    address = meta.get("address", "").strip()
    if address.startswith("Россия, "):
        address = address[len("Россия, "):]

    category = _extract_category(meta)
    if _should_skip(name, category):
        return None

    phone = _extract_phone(meta)
    website = _extract_website(meta)
    rating, review_count = _extract_rating(meta)

    logger.info(
        "Яндекс '%s': phone=%r site=%r рейтинг=%.1f (%d отзывов)",
        name, phone, website, rating, review_count,
    )

    return ParsedCompany(
        name=name,
        address=address,
        phone=phone,
        email="",
        website=website,
        vk_url="",
        telegram_url="",
        instagram_url="",
        category=category,
        rating=rating,
        review_count=review_count,
    )


def parse_category(
    category: str,
    max_results: int = 10,
    api_key: str = "",
) -> List[ParsedCompany]:
    """
    Ищет организации через Яндекс Геопоиск по категории.
    Интерфейс совместим с parser_2gis.parse_category().
    """
    key = api_key or YANDEX_MAPS_API_KEY
    if not key:
        logger.warning(
            "YANDEX_MAPS_API_KEY не задан — Яндекс Геопоиск пропущен. "
            "Получите ключ: developer.tech.yandex.ru → Search API"
        )
        return []

    if category and category.lower() not in ("все", "all", ""):
        queries = [q for q in TARGET_SEARCH_QUERIES if category.lower() in q.lower()]
        if not queries:
            queries = [f"{category} Пермь"]
    else:
        queries = list(TARGET_SEARCH_QUERIES)

    seen: set = set()
    results: List[ParsedCompany] = []

    for i, query in enumerate(queries):
        if len(results) >= max_results:
            break

        need = min(10, max_results - len(results) + 5)
        features = _fetch_orgs(query, results=need, api_key=key)

        for feat in features:
            company = _feature_to_company(feat)
            if company is None:
                continue
            dedup_key = company.name.lower()
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            results.append(company)
            if len(results) >= max_results:
                break

        if i < len(queries) - 1:
            time.sleep(random.uniform(TWOGIS_REQUEST_DELAY_MIN, TWOGIS_REQUEST_DELAY_MAX))

    logger.info("Яндекс: %d компаний по категории '%s'", len(results), category)
    return results


def enrich_phone(name: str, api_key: str = "") -> str:
    """
    Ищет телефон компании по имени в Яндекс Геопоиске.
    Используется для обогащения данных 2GIS когда contact_groups пуст.
    """
    key = api_key or YANDEX_MAPS_API_KEY
    if not key:
        return ""
    query = f"{name} Пермь"
    features = _fetch_orgs(query, results=1, api_key=key)
    if not features:
        return ""
    meta = features[0].get("properties", {}).get("CompanyMetaData", {})
    # Проверяем что имя примерно совпадает
    found_name = meta.get("name", "").lower()
    if name.lower()[:10] not in found_name and found_name[:10] not in name.lower():
        logger.debug("Яндекс enrich: имя не совпало '%s' vs '%s'", name, meta.get("name"))
        return ""
    phone = _extract_phone(meta)
    if phone:
        logger.info("Яндекс обогатил '%s': phone=%r", name, phone)
    return phone
