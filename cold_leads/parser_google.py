"""
parser_google.py — Парсер организаций через Google Places API (New).

Документация: https://developers.google.com/maps/documentation/places/web-service/text-search
Бесплатный уровень: $200/мес кредит (~6 000 запросов/мес по базовым полям).
При использовании до 100 запросов/день лицензия бесплатна.

Регистрация ключа:
  console.cloud.google.com → Enable "Places API (New)" → API & Services → Credentials

Переменная окружения: GOOGLE_PLACES_API_KEY

Публичный API (совместим с parser_2gis):
  parse_category(category, max_results, api_key) -> List[ParsedCompany]
  enrich_contacts(name, api_key) -> dict  # {phone, website}
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
    GOOGLE_PLACES_API_KEY,
)
from parser_2gis import ParsedCompany

logger = logging.getLogger(__name__)

_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# Поля, запрашиваемые у Google Places API
# Базовые: бесплатно (displayName, formattedAddress, rating, userRatingCount, primaryTypeDisplayName)
# Контактные: $17/1000 запросов, покрывается $200 кредитом
_FIELD_MASK = (
    "places.displayName,"
    "places.formattedAddress,"
    "places.nationalPhoneNumber,"
    "places.websiteUri,"
    "places.rating,"
    "places.userRatingCount,"
    "places.primaryTypeDisplayName"
)

# Центр Перми (для locationBias)
_PERM_LAT = 58.0105
_PERM_LNG = 56.2502
_PERM_RADIUS_M = 25_000  # 25 км — весь город


def _build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=MAX_RETRIES,
        backoff_factor=RETRY_BACKOFF,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["POST"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.headers.update({
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    return session


_SESSION = _build_session()


def _should_skip(name: str, category: str) -> bool:
    combined = f"{name.lower()} {category.lower()}"
    for kw in ICP.skip_keywords:
        if kw in combined:
            return True
    for chain in ICP.known_chains:
        if chain in combined:
            return True
    return False


def _fetch_places(query: str, max_results: int = 10, api_key: str = "") -> List[Dict]:
    """Запрашивает список организаций через Google Places Text Search."""
    key = api_key or GOOGLE_PLACES_API_KEY
    if not key:
        return []

    headers = {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": _FIELD_MASK,
    }
    body = {
        "textQuery": query,
        "languageCode": "ru",
        "maxResultCount": min(max_results, 20),
        "locationBias": {
            "circle": {
                "center": {"latitude": _PERM_LAT, "longitude": _PERM_LNG},
                "radius": _PERM_RADIUS_M,
            }
        },
    }

    try:
        resp = _SESSION.post(_PLACES_SEARCH_URL, json=body, headers=headers, timeout=15)
        logger.info("Google Places '%s': HTTP %d", query, resp.status_code)
        if resp.status_code == 403:
            logger.error(
                "Google Places API: 403 — проверьте GOOGLE_PLACES_API_KEY. "
                "console.cloud.google.com → Enable 'Places API (New)'"
            )
            return []
        resp.raise_for_status()
        places = resp.json().get("places", [])
        logger.info("Google Places '%s': %d результатов", query, len(places))
        return places
    except requests.HTTPError as exc:
        logger.warning("HTTP ошибка Google Places (q=%r): %s", query, exc)
        return []
    except requests.RequestException as exc:
        logger.warning("Сетевая ошибка Google Places (q=%r): %s", query, exc)
        return []


def _place_to_company(place: Dict) -> Optional[ParsedCompany]:
    """Конвертирует объект Google Place в ParsedCompany."""
    name_obj = place.get("displayName", {})
    name = name_obj.get("text", "").strip() if isinstance(name_obj, dict) else ""
    if not name:
        return None

    address = place.get("formattedAddress", "").strip()
    # Убираем ", Россия" из конца адреса
    if address.endswith(", Россия"):
        address = address[: -len(", Россия")]

    cat_obj = place.get("primaryTypeDisplayName", {})
    category = cat_obj.get("text", "") if isinstance(cat_obj, dict) else ""

    if _should_skip(name, category):
        return None

    phone = place.get("nationalPhoneNumber", "").strip()
    website = place.get("websiteUri", "").strip()
    if website and not website.startswith(("http://", "https://")):
        website = ""

    rating = float(place.get("rating", 0) or 0)
    review_count = int(place.get("userRatingCount", 0) or 0)

    logger.info(
        "Google '%s': phone=%r site=%r рейтинг=%.1f (%d отзывов)",
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
    Ищет организации через Google Places по категории.
    Интерфейс совместим с parser_2gis.parse_category().
    """
    key = api_key or GOOGLE_PLACES_API_KEY
    if not key:
        logger.warning(
            "GOOGLE_PLACES_API_KEY не задан — Google Places пропущен. "
            "Ключ: console.cloud.google.com → Places API (New)"
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

        need = min(20, max_results - len(results) + 5)
        places = _fetch_places(query, max_results=need, api_key=key)

        for place in places:
            company = _place_to_company(place)
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

    logger.info("Google Places: %d компаний по категории '%s'", len(results), category)
    return results


def enrich_contacts(name: str, api_key: str = "") -> Dict[str, str]:
    """
    Ищет телефон и сайт компании по имени через Google Places.
    Используется для обогащения данных 2GIS когда contact_groups пуст.
    Возвращает: {"phone": "...", "website": "..."}
    """
    key = api_key or GOOGLE_PLACES_API_KEY
    if not key:
        return {"phone": "", "website": ""}

    query = f"{name} Пермь"
    places = _fetch_places(query, max_results=1, api_key=key)
    if not places:
        return {"phone": "", "website": ""}

    place = places[0]
    found_name = (place.get("displayName") or {}).get("text", "").lower()

    # Проверяем что название примерно совпадает
    name_lower = name.lower()
    if name_lower[:8] not in found_name and found_name[:8] not in name_lower:
        logger.debug("Google enrich: имя не совпало '%s' vs '%s'", name, found_name)
        return {"phone": "", "website": ""}

    phone = place.get("nationalPhoneNumber", "").strip()
    website = place.get("websiteUri", "").strip()
    if website and not website.startswith(("http://", "https://")):
        website = ""

    if phone or website:
        logger.info("Google обогатил '%s': phone=%r site=%r", name, phone, website)

    return {"phone": phone, "website": website}
