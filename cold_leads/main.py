"""
main.py — Главный оркестратор системы холодных лидов агентства "Динамика".

Запуск:
  python main.py --category медицина --max-leads 10
  python main.py --category все --max-leads 30
  python main.py --stats
"""

import argparse
import logging
import sys
from datetime import datetime, date
from pathlib import Path

import config
from config import validate_config, TARGET_CATEGORIES, MAX_LEADS_PER_DAY
from database import (
    Lead, init_db, save_lead, leads_created_today, get_unprocessed_leads,
    update_lead_status, get_stats, lead_exists,
)
from parser_2gis import parse_category, ParsedCompany
from social_checker import check_social_presence
from qualifier import qualify_lead, QualificationResult
from profiler import profile_lead
import profiler as _profiler_mod
from pdf_generator import generate_proposal
from bitrix24_integration import create_lead as bitrix_create_lead, add_note, attach_file
from message_generator import generate_message

# ---------------------------------------------------------------------------
# Логирование
# ---------------------------------------------------------------------------

LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)


def setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else getattr(logging, config.LOG_LEVEL, logging.INFO)
    log_file = LOG_DIR / f"cold_leads_{date.today().isoformat()}.log"

    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_file, encoding="utf-8"),
    ]
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        handlers=handlers,
    )


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

def _company_to_lead(company: ParsedCompany, category: str) -> Lead:
    """Конвертирует ParsedCompany в объект Lead."""
    return Lead(
        company_name=company.name,
        category=category,
        address=company.address,
        phone=company.phone,
        website=company.website,
        vk_url=company.vk_url,
        telegram_url=company.telegram_url,
        rating=company.rating,
        review_count=company.review_count,
    )


def _build_social_diagnosis(company: ParsedCompany, social) -> str:
    """Формирует текстовый диагноз соцсетей для КП и сообщения."""
    parts = []
    if not social.has_vk and not social.has_telegram:
        parts.append(
            f"Компания «{company.name}» не представлена в ВКонтакте и Telegram."
        )
    elif social.has_vk:
        if social.last_post_days_ago > 21:
            parts.append(
                f"Страница ВКонтакте есть, но последний пост был {social.last_post_days_ago} дней назад."
            )
        if social.posting_frequency in ("rare", "none"):
            parts.append("Публикации выходят редко или нерегулярно.")
        if not social.has_video:
            parts.append("Видеоконтент отсутствует.")
        if not social.has_style_consistency:
            parts.append("Единого стиля в публикациях не прослеживается.")
    return " ".join(parts) if parts else "Требуется ручная проверка."


def _estimate_roi(tariff: str, niche: str) -> dict:
    """Простая оценка ROI по тарифу и нише."""
    tariff_prices = {
        "БАЗОВЫЙ": 55000,
        "КОРОТКАЯ ВОРОНКА": 85000,
        "ПРОГРЕВАЮЩАЯ ВОРОНКА": 120000,
        "SEO-ВОРОНКА": 90000,
    }
    min_contracts = {
        "БАЗОВЫЙ": 3,
        "КОРОТКАЯ ВОРОНКА": 2,
        "ПРОГРЕВАЮЩАЯ ВОРОНКА": 4,
        "SEO-ВОРОНКА": 6,
    }

    monthly = tariff_prices.get(tariff, 55000)
    months = min_contracts.get(tariff, 3)

    # Ниши с высокой конверсией соцсетей
    high_conv_niches = {"еда", "красота", "фитнес", "спорт", "общепит"}
    niche_lower = niche.lower()
    is_high_conv = any(n in niche_lower for n in high_conv_niches)

    expected_leads = "15–35" if is_high_conv else "8–20"
    cost_per_lead = "2 000–4 000" if is_high_conv else "3 500–7 000"

    return {
        "onboarding": 45000,
        "monthly_cost": monthly,
        "months": months,
        "expected_leads": expected_leads,
        "cost_per_lead": cost_per_lead,
    }


# ---------------------------------------------------------------------------
# Основной пайплайн
# ---------------------------------------------------------------------------

def process_category(category: str, max_leads: int, dry_run: bool = False) -> dict:
    """
    Обрабатывает одну категорию: парсинг → квалификация → профилирование →
    генерация КП и сообщений → добавление в Битрикс24.

    Returns:
        Словарь со статистикой обработки
    """
    stats = {
        "parsed": 0,
        "skipped_duplicate": 0,
        "skipped_low": 0,
        "skipped_daily_limit": 0,
        "qualified_high": 0,
        "qualified_medium": 0,
        "proposals_generated": 0,
        "bitrix_created": 0,
        "errors": 0,
    }

    logger.info("=== Категория: %s (макс. %d лидов) ===", category, max_leads)

    # Проверяем дневной лимит
    today_count = leads_created_today()
    if today_count >= MAX_LEADS_PER_DAY:
        logger.warning(
            "Дневной лимит %d лидов достигнут. Запуск отложен.",
            MAX_LEADS_PER_DAY,
        )
        stats["skipped_daily_limit"] = max_leads
        return stats

    remaining_today = MAX_LEADS_PER_DAY - today_count
    actual_max = min(max_leads, remaining_today)

    # Шаг 1 — парсинг 2GIS
    logger.info("Шаг 1: Парсинг 2GIS по категории «%s»...", category)
    companies = parse_category(category, max_results=actual_max * 3)  # берём запас для фильтрации
    stats["parsed"] = len(companies)
    logger.info("Получено %d компаний из 2GIS", len(companies))

    processed = 0

    for company in companies:
        if processed >= actual_max:
            break

        # Шаг 2 — дедупликация
        if lead_exists(company.name, company.address):
            logger.debug("Дубликат: %s", company.name)
            stats["skipped_duplicate"] += 1
            continue

        logger.info("Обрабатываем: %s (%s)", company.name, company.address)

        try:
            # Шаг 3 — квалификация
            lead = _company_to_lead(company, category)
            qual = qualify_lead(lead)
            lead.priority = qual.priority
            lead.pain_point = qual.pain_point
            lead.recommended_tariff = qual.recommended_tariff
            lead.qualification_reasoning = qual.reasoning

            if qual.priority in ("SKIP", "LOW"):
                lead.status = "rejected"
                save_lead(lead)
                stats["skipped_low"] += 1
                logger.info(
                    "  Пропущен (SKIP/LOW): %s — %s",
                    company.name,
                    qual.skip_reason or qual.reasoning[:60],
                )
                continue

            if qual.priority == "HIGH":
                stats["qualified_high"] += 1
            else:
                stats["qualified_medium"] += 1

            if dry_run:
                logger.info(
                    "  [DRY RUN] %s → %s | %s",
                    company.name, qual.priority, qual.recommended_tariff
                )
                save_lead(lead)
                processed += 1
                continue

            # Шаг 4 — проверка соцсетей
            logger.info("  Шаг 4: Проверка соцсетей...")
            social = check_social_presence(
                vk_url=company.vk_url,
                telegram_url=company.telegram_url,
                company_name=company.name,
            )
            lead.last_post_days_ago = social.last_post_days_ago
            lead.has_vk = social.has_vk
            lead.has_telegram = social.has_telegram

            # Шаг 5 — профилирование
            logger.info("  Шаг 5: Профилирование компании...")
            # Конвертируем SocialReport и QualificationResult в форматы profiler
            _sr = _profiler_mod.SocialReport(
                vk_url=social.vk_url or "",
                vk_last_post_days=social.last_post_days_ago if social.last_post_days_ago >= 0 else -1,
                vk_posting_frequency=social.posting_frequency or "unknown",
                telegram_url=social.telegram_url or "",
                has_any_social=social.has_vk or social.has_telegram,
                is_active=not social.is_inactive,
                main_pain=qual.pain_point or "",
            )
            _qr = _profiler_mod.QualificationResult(
                priority=qual.priority,
                reasoning=qual.reasoning,
                pain_point=qual.pain_point,
                recommended_tariff=qual.recommended_tariff,
            )
            profile = profile_lead(
                company_name=company.name,
                category=category,
                address=company.address,
                rating=company.rating,
                review_count=company.review_count,
                phone=company.phone,
                website=company.website,
                social_report=_sr,
                qualification=_qr,
            )
            social_diagnosis = _build_social_diagnosis(company, social)
            roi = _estimate_roi(qual.recommended_tariff, profile.niche)

            # Шаг 6 — генерация PDF-КП
            logger.info("  Шаг 6: Генерация PDF-КП...")
            pdf_path = generate_proposal(
                company_name=company.name,
                niche=profile.niche,
                pain_point=qual.pain_point,
                recommended_tariff=qual.recommended_tariff,
                social_diagnosis=social_diagnosis,
                reasoning=qual.reasoning,
                contact_phone=company.phone,
                vk_url=company.vk_url,
                roi_estimate=roi,
            )
            if pdf_path:
                stats["proposals_generated"] += 1

            # Шаг 7 — генерация сообщения ВК
            logger.info("  Шаг 7: Генерация сообщения ВКонтакте...")
            msg = generate_message(
                company_name=company.name,
                niche=profile.niche,
                pain_point=qual.pain_point,
                recommended_tariff=qual.recommended_tariff,
                social_diagnosis=social_diagnosis,
                vk_url=company.vk_url,
            )

            # Шаг 8 — добавление в Битрикс24
            logger.info("  Шаг 8: Добавление в Битрикс24...")
            bitrix_id = bitrix_create_lead(
                company_name=company.name,
                phone=company.phone,
                website=company.website,
                vk_url=company.vk_url,
                category=category,
                priority=qual.priority,
                pain_point=qual.pain_point,
                recommended_tariff=qual.recommended_tariff,
                reasoning=qual.reasoning,
                address=company.address,
                rating=company.rating,
                review_count=company.review_count,
            )
            if bitrix_id:
                stats["bitrix_created"] += 1
                if pdf_path:
                    attach_file(bitrix_id, pdf_path)
                if msg.first_message:
                    add_note(bitrix_id, f"VK-сообщение:\n{msg.first_message}")

            # Шаг 9 — сохранение в базу
            lead.status = "qualified"
            lead_db_id = save_lead(lead)

            logger.info(
                "  ✓ %s → %s | %s | БД: %s | Битрикс: %s",
                company.name,
                qual.priority,
                qual.recommended_tariff,
                lead_db_id,
                bitrix_id or "—",
            )
            processed += 1

        except Exception as exc:
            logger.error("Ошибка обработки '%s': %s", company.name, exc, exc_info=True)
            stats["errors"] += 1

    return stats


def run_pipeline(
    categories: list,
    max_leads_per_category: int,
    dry_run: bool = False,
) -> None:
    """Запускает полный пайплайн по списку категорий."""
    logger.info("Запуск пайплайна холодных лидов: %d категорий", len(categories))

    total_stats = {
        "parsed": 0,
        "skipped_duplicate": 0,
        "skipped_low": 0,
        "qualified_high": 0,
        "qualified_medium": 0,
        "proposals_generated": 0,
        "bitrix_created": 0,
        "errors": 0,
    }

    for cat in categories:
        cat_stats = process_category(cat, max_leads_per_category, dry_run=dry_run)
        for key in total_stats:
            total_stats[key] = total_stats.get(key, 0) + cat_stats.get(key, 0)

    _print_summary(total_stats)


def _print_summary(stats: dict) -> None:
    """Выводит итоговый отчёт."""
    print("\n" + "=" * 60)
    print("ИТОГИ РАБОТЫ ПАЙПЛАЙНА")
    print("=" * 60)
    print(f"  Найдено в 2GIS:          {stats['parsed']}")
    print(f"  Пропущено (дубликаты):   {stats['skipped_duplicate']}")
    print(f"  Пропущено (LOW/SKIP):    {stats['skipped_low']}")
    print(f"  Квалифицировано HIGH:    {stats['qualified_high']}")
    print(f"  Квалифицировано MEDIUM:  {stats['qualified_medium']}")
    print(f"  PDF-КП сгенерировано:    {stats['proposals_generated']}")
    print(f"  Добавлено в Битрикс24:   {stats['bitrix_created']}")
    print(f"  Ошибки:                  {stats['errors']}")
    print("=" * 60)


def print_stats() -> None:
    """Выводит статистику из базы данных."""
    stats = get_stats()
    by_p = stats.leads_by_priority
    by_s = stats.leads_by_status
    print("\n" + "=" * 60)
    print("СТАТИСТИКА БАЗЫ ЛИДОВ")
    print("=" * 60)
    print(f"  Всего лидов:     {stats.total_leads}")
    print(f"  HIGH:            {by_p.get('HIGH', 0)}")
    print(f"  MEDIUM:          {by_p.get('MEDIUM', 0)}")
    print(f"  LOW/SKIP:        {by_p.get('LOW', 0) + by_p.get('SKIP', 0)}")
    print(f"  Квалифицировано: {by_s.get('qualified', 0)}")
    print(f"  Отклонено:       {by_s.get('rejected', 0)}")
    print(f"  Обработано сегодня: {leads_created_today()}/{MAX_LEADS_PER_DAY}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Система холодных лидов агентства «Динамика»",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python main.py --category медицина --max-leads 10
  python main.py --category все --max-leads 30
  python main.py --stats
  python main.py --category красота --max-leads 5 --dry-run
        """,
    )

    parser.add_argument(
        "--category",
        type=str,
        help=f"Категория для парсинга. 'все' = все категории. Доступные: {', '.join(TARGET_CATEGORIES)}",
    )
    parser.add_argument(
        "--max-leads",
        type=int,
        default=10,
        help="Максимальное количество лидов на категорию (по умолчанию: 10)",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="Показать статистику базы лидов",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Тестовый запуск: парсинг и квалификация без генерации КП и Битрикс24",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Подробное логирование",
    )

    args = parser.parse_args()
    setup_logging(verbose=args.verbose)

    # Инициализация БД
    init_db()

    # Валидация конфига
    warnings = validate_config()
    for w in warnings:
        logger.warning("Конфигурация: %s", w)

    if args.stats:
        print_stats()
        return

    if not args.category:
        parser.print_help()
        return

    # Выбор категорий
    if args.category.lower() == "все":
        categories = TARGET_CATEGORIES
    else:
        categories = [args.category]

    # Ограничение дневного лимита
    per_cat = min(args.max_leads, MAX_LEADS_PER_DAY)

    run_pipeline(
        categories=categories,
        max_leads_per_category=per_cat,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
