"""
bitrix24_integration.py — Интеграция с Битрикс24 через REST API (webhook).

Создаёт лиды в CRM, обновляет статусы, добавляет заметки и прикрепляет файлы.
Webhook URL берётся из переменной окружения BITRIX24_WEBHOOK_URL.
"""

import logging
import os
import time
from pathlib import Path
from typing import Optional

import requests

from config import BITRIX24_WEBHOOK_URL, MAX_RETRIES, RETRY_BACKOFF

logger = logging.getLogger(__name__)

# Статусы лидов в Битрикс24 (стандартные)
LEAD_STATUS_NEW = "NEW"
LEAD_STATUS_IN_PROCESS = "IN_PROCESS"
LEAD_STATUS_PROCESSED = "PROCESSED"
LEAD_STATUS_JUNK = "JUNK"

# Источник лида
LEAD_SOURCE = "COLD_CALL"   # холодный контакт


def _get_webhook() -> Optional[str]:
    """Возвращает URL вебхука или None если не настроен."""
    url = BITRIX24_WEBHOOK_URL or os.environ.get("BITRIX24_WEBHOOK_URL", "")
    if not url:
        logger.debug("BITRIX24_WEBHOOK_URL не задан — интеграция отключена")
        return None
    return url.rstrip("/")


def _api_call(method: str, params: dict, retries: int = MAX_RETRIES) -> Optional[dict]:
    """
    Выполняет REST-запрос к Битрикс24.

    Args:
        method: Метод API, например 'crm.lead.add'
        params: Параметры запроса
        retries: Количество повторных попыток

    Returns:
        Словарь result или None при ошибке
    """
    webhook = _get_webhook()
    if not webhook:
        return None

    url = f"{webhook}/{method}/"
    delay = 1.0

    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(url, json=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            if "error" in data:
                logger.error(
                    "Битрикс24 API ошибка (%s): %s — %s",
                    method,
                    data.get("error"),
                    data.get("error_description", ""),
                )
                return None

            return data.get("result")

        except requests.Timeout:
            logger.warning("Тайм-аут Битрикс24 API (попытка %d/%d): %s", attempt, retries, method)
        except requests.RequestException as exc:
            logger.warning("Ошибка сети Битрикс24 (попытка %d/%d): %s", attempt, retries, exc)

        if attempt < retries:
            time.sleep(delay)
            delay *= RETRY_BACKOFF

    logger.error("Все попытки обращения к Битрикс24 исчерпаны: %s", method)
    return None


# ---------------------------------------------------------------------------
# Публичный API
# ---------------------------------------------------------------------------

def create_lead(
    company_name: str,
    phone: str = "",
    email: str = "",
    website: str = "",
    vk_url: str = "",
    telegram_url: str = "",
    instagram_url: str = "",
    category: str = "",
    priority: str = "",
    pain_point: str = "",
    recommended_tariff: str = "",
    reasoning: str = "",
    address: str = "",
    rating: float = 0.0,
    review_count: int = 0,
) -> Optional[int]:
    """
    Создаёт лид в Битрикс24 с заполненными контактными полями.

    Returns:
        ID созданного лида или None при ошибке / отключённой интеграции
    """
    # Блок контактов — все данные из 2GIS в одном месте
    comments_parts = ["=== КОНТАКТЫ ИЗ 2GIS ==="]
    if phone:
        comments_parts.append(f"Телефон: {phone}")
    if email:
        comments_parts.append(f"E-mail: {email}")
    if address:
        comments_parts.append(f"Адрес: {address}")
    if website:
        comments_parts.append(f"Сайт: {website}")
    if vk_url:
        comments_parts.append(f"ВКонтакте: {vk_url}")
    if telegram_url:
        comments_parts.append(f"Telegram: {telegram_url}")
    if instagram_url:
        comments_parts.append(f"Instagram: {instagram_url}")
    if rating:
        comments_parts.append(f"Рейтинг 2GIS: {rating} ({review_count} отзывов)")

    # Блок квалификации
    comments_parts.append("")
    comments_parts.append("=== КВАЛИФИКАЦИЯ ===")
    if pain_point:
        comments_parts.append(f"Боль клиента: {pain_point}")
    if recommended_tariff:
        comments_parts.append(f"Рекомендованный тариф: {recommended_tariff}")
    if reasoning:
        comments_parts.append(f"Обоснование: {reasoning}")
    if category:
        comments_parts.append(f"Ниша: {category}")
    comments_parts.append("Источник: автоматический парсер 2GIS (агентство Динамика)")

    fields = {
        "TITLE": f"[SMM] {company_name}",
        "COMPANY_TITLE": company_name,
        "SOURCE_ID": LEAD_SOURCE,
        "STATUS_ID": LEAD_STATUS_NEW,
        "COMMENTS": "\n".join(comments_parts),
        "CURRENCY_ID": "RUB",
    }

    if phone:
        fields["PHONE"] = [{"VALUE": phone, "VALUE_TYPE": "WORK"}]

    if email:
        fields["EMAIL"] = [{"VALUE": email, "VALUE_TYPE": "WORK"}]

    if address:
        fields["ADDRESS"] = address

    # Собираем все веб-ссылки и соцсети в поле WEB
    web_fields = []
    if website:
        web_fields.append({"VALUE": website, "VALUE_TYPE": "WORK"})
    if vk_url:
        web_fields.append({"VALUE": vk_url, "VALUE_TYPE": "OTHER"})
    if telegram_url:
        web_fields.append({"VALUE": telegram_url, "VALUE_TYPE": "OTHER"})
    if instagram_url:
        web_fields.append({"VALUE": instagram_url, "VALUE_TYPE": "OTHER"})
    if web_fields:
        fields["WEB"] = web_fields

    # Приоритет → важность в Битрикс24
    priority_map = {"HIGH": "HIGH", "MEDIUM": "MEDIUM", "LOW": "LOW"}
    if priority in priority_map:
        fields["PRIORITY"] = priority_map[priority]

    result = _api_call("crm.lead.add", {"fields": fields, "params": {"REGISTER_SONET_EVENT": "Y"}})

    if result:
        lead_id = int(result)
        logger.info("Лид создан в Битрикс24: ID=%d (%s)", lead_id, company_name)
        return lead_id

    return None


def update_lead_status(lead_id: int, status: str) -> bool:
    """
    Обновляет статус лида в Битрикс24.

    Args:
        lead_id: ID лида
        status: Один из: NEW, IN_PROCESS, PROCESSED, JUNK

    Returns:
        True при успехе
    """
    result = _api_call("crm.lead.update", {
        "id": lead_id,
        "fields": {"STATUS_ID": status},
    })
    if result:
        logger.info("Статус лида %d обновлён: %s", lead_id, status)
        return True
    return False


def add_note(lead_id: int, note_text: str) -> bool:
    """
    Добавляет заметку к лиду в Битрикс24.

    Args:
        lead_id: ID лида
        note_text: Текст заметки

    Returns:
        True при успехе
    """
    result = _api_call("crm.timeline.comment.add", {
        "fields": {
            "ENTITY_ID": lead_id,
            "ENTITY_TYPE": "lead",
            "COMMENT": note_text,
        },
    })
    if result:
        logger.info("Заметка добавлена к лиду %d", lead_id)
        return True

    # Fallback: activity
    result2 = _api_call("crm.activity.add", {
        "fields": {
            "OWNER_ID": lead_id,
            "OWNER_TYPE_ID": 1,  # 1 = Лид
            "TYPE_ID": 6,        # 6 = Комментарий
            "SUBJECT": "Заметка автоматизации",
            "DESCRIPTION": note_text,
            "COMPLETED": "Y",
        },
    })
    return bool(result2)


def attach_file(lead_id: int, file_path: str) -> bool:
    """
    Загружает PDF-КП на Яндекс Диск и добавляет публичную ссылку в комментарий лида.

    Returns:
        True если ссылка добавлена в комментарий
    """
    from yandex_disk import upload_pdf

    path = Path(file_path)
    if not path.exists():
        logger.error("Файл не найден: %s", file_path)
        return False

    public_url = upload_pdf(file_path)

    if public_url:
        note = f"PDF-КП: {path.stem}\nСкачать: {public_url}"
        add_note(lead_id, note)
        logger.info("Ссылка на PDF добавлена в комментарий лида %d: %s", lead_id, public_url)
        return True

    # Фолбэк: просто отметим что КП сформирован
    add_note(lead_id, f"PDF-КП сформирован: {path.name} (загрузка не удалась — проверьте YANDEX_DISK_TOKEN)")
    logger.warning("Не удалось загрузить PDF на Яндекс Диск для лида %d", lead_id)
    return False


def get_lead(lead_id: int) -> Optional[dict]:
    """Возвращает данные лида из Битрикс24 по ID."""
    result = _api_call("crm.lead.get", {"id": lead_id})
    return result if isinstance(result, dict) else None


def is_configured() -> bool:
    """Возвращает True если интеграция с Битрикс24 настроена."""
    return bool(_get_webhook())
