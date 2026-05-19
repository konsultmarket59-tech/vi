"""
database.py — SQLite-хранилище лидов для системы холодных продаж агентства "Динамика"

Таблицы:
  - leads: все собранные лиды с результатами квалификации
  - parsing_runs: лог запусков парсера (для дедупликации и статистики)
"""

import sqlite3
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import List, Optional
from config import DB_PATH

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Модели данных (dataclasses)
# ---------------------------------------------------------------------------

@dataclass
class Lead:
    """Представляет один лид — потенциального клиента агентства."""

    # Основная информация из 2GIS
    company_name: str
    category: str
    address: str
    phone: str = ""
    website: str = ""

    # Социальные сети
    vk_url: str = ""
    telegram_url: str = ""
    instagram_url: str = ""

    # Метрики качества из 2GIS
    rating: float = 0.0
    review_count: int = 0

    # Результаты квалификации
    priority: str = "UNKNOWN"       # HIGH / MEDIUM / LOW / SKIP
    status: str = "new"             # new / qualified / contacted / converted / rejected
    pain_point: str = ""            # Основная боль (для персонализации питча)
    recommended_tariff: str = ""    # Рекомендованный тариф агентства
    qualification_reasoning: str = ""  # Обоснование от Claude

    # Данные о социальной активности
    last_post_days_ago: int = -1    # -1 = неизвестно
    posting_frequency: str = ""     # daily / weekly / monthly / rare / none
    has_vk: bool = False
    has_telegram: bool = False

    # Служебные поля
    source_query: str = ""          # Поисковый запрос, по которому найден
    id: Optional[int] = None
    created_at: Optional[str] = None
    processed_at: Optional[str] = None


@dataclass
class ParsingRun:
    """Лог одного запуска парсера."""

    query: str
    started_at: str
    finished_at: str = ""
    leads_found: int = 0
    leads_saved: int = 0
    error: str = ""
    id: Optional[int] = None


@dataclass
class Stats:
    """Агрегированная статистика базы."""

    total_leads: int = 0
    leads_by_priority: dict = field(default_factory=dict)
    leads_by_status: dict = field(default_factory=dict)
    leads_today: int = 0
    unprocessed: int = 0


# ---------------------------------------------------------------------------
# Инициализация базы данных
# ---------------------------------------------------------------------------

def get_connection(db_path: str = DB_PATH) -> sqlite3.Connection:
    """Возвращает соединение с SQLite с включёнными foreign keys."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # лучше для конкурентных записей
    return conn


def init_db(db_path: str = DB_PATH) -> None:
    """
    Создаёт таблицы, если они ещё не существуют.
    Безопасно вызывать при каждом старте.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS leads (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name            TEXT    NOT NULL,
        category                TEXT    NOT NULL,
        address                 TEXT    NOT NULL,
        phone                   TEXT    DEFAULT '',
        website                 TEXT    DEFAULT '',
        vk_url                  TEXT    DEFAULT '',
        telegram_url            TEXT    DEFAULT '',
        instagram_url           TEXT    DEFAULT '',
        rating                  REAL    DEFAULT 0.0,
        review_count            INTEGER DEFAULT 0,
        priority                TEXT    DEFAULT 'UNKNOWN',
        status                  TEXT    DEFAULT 'new',
        pain_point              TEXT    DEFAULT '',
        recommended_tariff      TEXT    DEFAULT '',
        qualification_reasoning TEXT    DEFAULT '',
        last_post_days_ago      INTEGER DEFAULT -1,
        posting_frequency       TEXT    DEFAULT '',
        has_vk                  INTEGER DEFAULT 0,
        has_telegram            INTEGER DEFAULT 0,
        source_query            TEXT    DEFAULT '',
        created_at              TEXT    NOT NULL,
        processed_at            TEXT    DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
    CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_created  ON leads(created_at);

    -- Уникальность: одна компания по имени + адресу
    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_unique
        ON leads(company_name, address);

    CREATE TABLE IF NOT EXISTS parsing_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        query       TEXT    NOT NULL,
        started_at  TEXT    NOT NULL,
        finished_at TEXT    DEFAULT '',
        leads_found INTEGER DEFAULT 0,
        leads_saved INTEGER DEFAULT 0,
        error       TEXT    DEFAULT ''
    );
    """
    with get_connection(db_path) as conn:
        conn.executescript(ddl)
    logger.info("База данных инициализирована: %s", db_path)


# ---------------------------------------------------------------------------
# CRUD-операции с лидами
# ---------------------------------------------------------------------------

def save_lead(lead: Lead, db_path: str = DB_PATH) -> Optional[int]:
    """
    Сохраняет лид в базу.
    При дубликате (company_name + address) обновляет существующую запись.
    Возвращает ID сохранённой записи или None при ошибке.
    """
    now = datetime.now().isoformat()
    if not lead.created_at:
        lead.created_at = now

    sql_insert = """
    INSERT INTO leads (
        company_name, category, address, phone, website,
        vk_url, telegram_url, instagram_url,
        rating, review_count,
        priority, status, pain_point, recommended_tariff, qualification_reasoning,
        last_post_days_ago, posting_frequency, has_vk, has_telegram,
        source_query, created_at, processed_at
    ) VALUES (
        :company_name, :category, :address, :phone, :website,
        :vk_url, :telegram_url, :instagram_url,
        :rating, :review_count,
        :priority, :status, :pain_point, :recommended_tariff, :qualification_reasoning,
        :last_post_days_ago, :posting_frequency, :has_vk, :has_telegram,
        :source_query, :created_at, :processed_at
    )
    ON CONFLICT(company_name, address) DO UPDATE SET
        phone                   = excluded.phone,
        website                 = excluded.website,
        vk_url                  = excluded.vk_url,
        telegram_url            = excluded.telegram_url,
        instagram_url           = excluded.instagram_url,
        rating                  = excluded.rating,
        review_count            = excluded.review_count
    """
    params = {
        "company_name": lead.company_name,
        "category": lead.category,
        "address": lead.address,
        "phone": lead.phone,
        "website": lead.website,
        "vk_url": lead.vk_url,
        "telegram_url": lead.telegram_url,
        "instagram_url": lead.instagram_url,
        "rating": lead.rating,
        "review_count": lead.review_count,
        "priority": lead.priority,
        "status": lead.status,
        "pain_point": lead.pain_point,
        "recommended_tariff": lead.recommended_tariff,
        "qualification_reasoning": lead.qualification_reasoning,
        "last_post_days_ago": lead.last_post_days_ago,
        "posting_frequency": lead.posting_frequency,
        "has_vk": int(lead.has_vk),
        "has_telegram": int(lead.has_telegram),
        "source_query": lead.source_query,
        "created_at": lead.created_at,
        "processed_at": lead.processed_at,
    }

    try:
        with get_connection(db_path) as conn:
            cursor = conn.execute(sql_insert, params)
            row_id = cursor.lastrowid
            # При ON CONFLICT ... DO UPDATE lastrowid = 0 → ищем по ключу
            if not row_id:
                row = conn.execute(
                    "SELECT id FROM leads WHERE company_name=? AND address=?",
                    (lead.company_name, lead.address),
                ).fetchone()
                row_id = row["id"] if row else None
            lead.id = row_id
            return row_id
    except sqlite3.Error as exc:
        logger.error("Ошибка сохранения лида '%s': %s", lead.company_name, exc)
        return None


def get_unprocessed_leads(
    limit: int = 50,
    db_path: str = DB_PATH,
) -> List[Lead]:
    """
    Возвращает лиды со статусом 'new' и приоритетом != 'SKIP',
    отсортированные по рейтингу (убывание).
    """
    sql = """
    SELECT * FROM leads
    WHERE status = 'new' AND priority != 'SKIP'
    ORDER BY
        CASE priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        rating DESC,
        review_count DESC
    LIMIT ?
    """
    try:
        with get_connection(db_path) as conn:
            rows = conn.execute(sql, (limit,)).fetchall()
            return [_row_to_lead(r) for r in rows]
    except sqlite3.Error as exc:
        logger.error("Ошибка получения необработанных лидов: %s", exc)
        return []


def get_leads_by_priority(
    priority: str,
    limit: int = 100,
    db_path: str = DB_PATH,
) -> List[Lead]:
    """Возвращает лиды с заданным приоритетом."""
    sql = "SELECT * FROM leads WHERE priority = ? ORDER BY rating DESC LIMIT ?"
    try:
        with get_connection(db_path) as conn:
            rows = conn.execute(sql, (priority, limit)).fetchall()
            return [_row_to_lead(r) for r in rows]
    except sqlite3.Error as exc:
        logger.error("Ошибка получения лидов по приоритету %s: %s", priority, exc)
        return []


def update_lead_status(
    lead_id: int,
    status: str,
    db_path: str = DB_PATH,
) -> bool:
    """Обновляет статус лида."""
    sql = "UPDATE leads SET status = ? WHERE id = ?"
    try:
        with get_connection(db_path) as conn:
            conn.execute(sql, (status, lead_id))
        return True
    except sqlite3.Error as exc:
        logger.error("Ошибка обновления статуса лида #%d: %s", lead_id, exc)
        return False


def update_lead_qualification(
    lead_id: int,
    priority: str,
    pain_point: str,
    recommended_tariff: str,
    reasoning: str,
    last_post_days_ago: int = -1,
    posting_frequency: str = "",
    has_vk: bool = False,
    has_telegram: bool = False,
    db_path: str = DB_PATH,
) -> bool:
    """Обновляет результаты квалификации лида (вызывается после Claude-анализа)."""
    sql = """
    UPDATE leads SET
        priority                = ?,
        pain_point              = ?,
        recommended_tariff      = ?,
        qualification_reasoning = ?,
        last_post_days_ago      = ?,
        posting_frequency       = ?,
        has_vk                  = ?,
        has_telegram            = ?,
        processed_at            = ?
    WHERE id = ?
    """
    now = datetime.now().isoformat()
    try:
        with get_connection(db_path) as conn:
            conn.execute(sql, (
                priority, pain_point, recommended_tariff, reasoning,
                last_post_days_ago, posting_frequency,
                int(has_vk), int(has_telegram),
                now, lead_id,
            ))
        return True
    except sqlite3.Error as exc:
        logger.error("Ошибка обновления квалификации лида #%d: %s", lead_id, exc)
        return False


def leads_created_today(db_path: str = DB_PATH) -> int:
    """Возвращает количество лидов, созданных сегодня."""
    today = datetime.now().strftime("%Y-%m-%d")
    sql = "SELECT COUNT(*) FROM leads WHERE created_at LIKE ?"
    try:
        with get_connection(db_path) as conn:
            row = conn.execute(sql, (f"{today}%",)).fetchone()
            return row[0] if row else 0
    except sqlite3.Error as exc:
        logger.error("Ошибка подсчёта лидов за сегодня: %s", exc)
        return 0


def lead_exists(company_name: str, address: str, db_path: str = DB_PATH) -> bool:
    """Проверяет, существует ли лид с таким названием и адресом."""
    sql = "SELECT 1 FROM leads WHERE company_name = ? AND address = ?"
    try:
        with get_connection(db_path) as conn:
            row = conn.execute(sql, (company_name, address)).fetchone()
            return row is not None
    except sqlite3.Error as exc:
        logger.error("Ошибка проверки существования лида: %s", exc)
        return False


def get_stats(db_path: str = DB_PATH) -> Stats:
    """Возвращает агрегированную статистику по базе лидов."""
    stats = Stats()
    try:
        with get_connection(db_path) as conn:
            # Общее количество
            stats.total_leads = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]

            # По приоритету
            rows = conn.execute(
                "SELECT priority, COUNT(*) as cnt FROM leads GROUP BY priority"
            ).fetchall()
            stats.leads_by_priority = {r["priority"]: r["cnt"] for r in rows}

            # По статусу
            rows = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM leads GROUP BY status"
            ).fetchall()
            stats.leads_by_status = {r["status"]: r["cnt"] for r in rows}

            # За сегодня
            today = datetime.now().strftime("%Y-%m-%d")
            stats.leads_today = conn.execute(
                "SELECT COUNT(*) FROM leads WHERE created_at LIKE ?",
                (f"{today}%",),
            ).fetchone()[0]

            # Необработанные (новые, не SKIP)
            stats.unprocessed = conn.execute(
                "SELECT COUNT(*) FROM leads WHERE status='new' AND priority != 'SKIP'"
            ).fetchone()[0]

    except sqlite3.Error as exc:
        logger.error("Ошибка получения статистики: %s", exc)

    return stats


# ---------------------------------------------------------------------------
# Работа с логом запусков парсера
# ---------------------------------------------------------------------------

def save_parsing_run(run: ParsingRun, db_path: str = DB_PATH) -> Optional[int]:
    """Создаёт запись о запуске парсера."""
    sql = """
    INSERT INTO parsing_runs (query, started_at, finished_at, leads_found, leads_saved, error)
    VALUES (:query, :started_at, :finished_at, :leads_found, :leads_saved, :error)
    """
    try:
        with get_connection(db_path) as conn:
            cursor = conn.execute(sql, asdict(run))
            run.id = cursor.lastrowid
            return run.id
    except sqlite3.Error as exc:
        logger.error("Ошибка сохранения лога запуска: %s", exc)
        return None


def update_parsing_run(
    run_id: int,
    finished_at: str,
    leads_found: int,
    leads_saved: int,
    error: str = "",
    db_path: str = DB_PATH,
) -> None:
    """Обновляет запись о запуске парсера по завершении."""
    sql = """
    UPDATE parsing_runs
    SET finished_at=?, leads_found=?, leads_saved=?, error=?
    WHERE id=?
    """
    try:
        with get_connection(db_path) as conn:
            conn.execute(sql, (finished_at, leads_found, leads_saved, error, run_id))
    except sqlite3.Error as exc:
        logger.error("Ошибка обновления лога запуска #%d: %s", run_id, exc)


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _row_to_lead(row: sqlite3.Row) -> Lead:
    """Конвертирует строку SQLite в объект Lead."""
    return Lead(
        id=row["id"],
        company_name=row["company_name"],
        category=row["category"],
        address=row["address"],
        phone=row["phone"],
        website=row["website"],
        vk_url=row["vk_url"],
        telegram_url=row["telegram_url"],
        instagram_url=row["instagram_url"] if "instagram_url" in row.keys() else "",
        rating=row["rating"],
        review_count=row["review_count"],
        priority=row["priority"],
        status=row["status"],
        pain_point=row["pain_point"],
        recommended_tariff=row["recommended_tariff"],
        qualification_reasoning=row["qualification_reasoning"],
        last_post_days_ago=row["last_post_days_ago"],
        posting_frequency=row["posting_frequency"],
        has_vk=bool(row["has_vk"]),
        has_telegram=bool(row["has_telegram"]),
        source_query=row["source_query"],
        created_at=row["created_at"],
        processed_at=row["processed_at"],
    )


# ---------------------------------------------------------------------------
# CLI: инициализация БД при прямом запуске
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    init_db()
    stats = get_stats()
    print(f"База данных: {DB_PATH}")
    print(f"Всего лидов: {stats.total_leads}")
    print(f"По приоритетам: {stats.leads_by_priority}")
    print(f"По статусам: {stats.leads_by_status}")
    print(f"Создано сегодня: {stats.leads_today}")
    print(f"Необработанных: {stats.unprocessed}")
