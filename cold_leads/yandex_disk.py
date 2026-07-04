"""
yandex_disk.py — Загрузка PDF-КП на Яндекс Диск и получение публичной ссылки.

Использует Яндекс Диск REST API v1:
  https://cloud-api.yandex.net/v1/disk

Токен берётся из переменной окружения YANDEX_DISK_TOKEN.
"""

import logging
import os
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_YADISK_API = "https://cloud-api.yandex.net/v1/disk"
_UPLOAD_FOLDER = "/Динамика-КП"  # папка на диске куда складываем КП


def _token() -> str:
    return os.environ.get("YANDEX_DISK_TOKEN", "")


def _headers() -> dict:
    return {"Authorization": f"OAuth {_token()}"}


def upload_pdf(file_path: str) -> Optional[str]:
    """
    Загружает PDF на Яндекс Диск и возвращает публичную ссылку для скачивания.

    Args:
        file_path: Локальный путь к PDF-файлу

    Returns:
        Публичная ссылка (str) или None при ошибке / отсутствии токена
    """
    token = _token()
    if not token:
        logger.warning("YANDEX_DISK_TOKEN не задан — загрузка на Яндекс Диск пропущена")
        return None

    path = Path(file_path)
    if not path.exists():
        logger.error("Файл не найден: %s", file_path)
        return None

    disk_path = f"{_UPLOAD_FOLDER}/{path.name}"
    hdrs = _headers()

    try:
        # Шаг 1: создаём папку (игнорируем ошибку если уже существует)
        requests.put(
            f"{_YADISK_API}/resources",
            headers=hdrs,
            params={"path": _UPLOAD_FOLDER},
            timeout=10,
        )

        # Шаг 2: получаем URL для загрузки
        resp = requests.get(
            f"{_YADISK_API}/resources/upload",
            headers=hdrs,
            params={"path": disk_path, "overwrite": "true"},
            timeout=10,
        )
        resp.raise_for_status()
        upload_url = resp.json().get("href")
        if not upload_url:
            logger.error("Яндекс Диск не вернул upload URL")
            return None

        # Шаг 3: загружаем файл
        with open(file_path, "rb") as f:
            put_resp = requests.put(upload_url, data=f, timeout=60)
        put_resp.raise_for_status()
        logger.info("PDF %s загружен на Яндекс Диск: %s", path.name, disk_path)

        # Шаг 4: публикуем файл (если уже опубликован — ошибку игнорируем)
        requests.put(
            f"{_YADISK_API}/resources/publish",
            headers=hdrs,
            params={"path": disk_path},
            timeout=10,
        )

        # Шаг 5: читаем публичную ссылку
        info_resp = requests.get(
            f"{_YADISK_API}/resources",
            headers=hdrs,
            params={"path": disk_path, "fields": "public_url"},
            timeout=10,
        )
        info_resp.raise_for_status()
        public_url = info_resp.json().get("public_url", "")

        if public_url:
            logger.info("Публичная ссылка: %s", public_url)
            return public_url

        logger.warning("Файл загружен, но публичная ссылка не получена")
        return None

    except requests.HTTPError as exc:
        logger.error("Ошибка HTTP при работе с Яндекс Диск: %s", exc)
        return None
    except requests.RequestException as exc:
        logger.error("Сетевая ошибка Яндекс Диск: %s", exc)
        return None


def is_configured() -> bool:
    return bool(_token())
