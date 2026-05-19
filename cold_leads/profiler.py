"""
profiler.py — AI-профилирование квалифицированных лидов через Claude API.

Для каждого лида определяет:
  - Нишу и тип продукта
  - Масштаб бизнеса (по количеству отзывов, рейтингу, локациям)
  - Основную боль в SMM
  - Лучший тариф агентства Динамика
  - Оценку ROI для клиента
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

import anthropic

import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class SocialReport:
    """Отчёт о социальном присутствии компании (из social_checker)."""
    vk_url: str = ""
    vk_followers: int = 0
    vk_last_post_days: int = -1
    vk_posting_frequency: str = "unknown"
    vk_avg_likes: float = 0.0
    vk_avg_comments: float = 0.0
    telegram_url: str = ""
    telegram_subscribers: int = 0
    instagram_url: str = ""
    has_any_social: bool = False
    is_active: bool = False
    main_pain: str = ""  # нет присутствия / не ведётся / без стратегии


@dataclass
class QualificationResult:
    """Результат квалификации лида (из qualifier)."""
    priority: str = "MEDIUM"   # HIGH / MEDIUM / LOW
    reasoning: str = ""
    pain_point: str = ""
    recommended_tariff: str = ""


@dataclass
class ProfileResult:
    """Полный профиль лида после анализа Claude."""
    company_name: str = ""
    niche: str = ""
    product_type: str = ""
    business_scale: str = ""         # micro / small / medium
    business_scale_reasoning: str = ""
    smm_pain: str = ""               # нет присутствия / не ведётся / без стратегии
    smm_pain_details: str = ""       # конкретика для питча
    recommended_tariff: str = ""
    tariff_price_min: int = 0
    tariff_price_max: int = 0
    tariff_reasoning: str = ""
    roi_min_budget: int = 0          # минимальный бюджет для старта
    roi_expected_results: str = ""   # ожидаемые результаты за 3 месяца
    roi_key_metric: str = ""         # главная метрика ROI для этой ниши
    personalization_hooks: list = field(default_factory=list)  # зацепки для сообщения
    raw_response: str = ""


# ---------------------------------------------------------------------------
# Тарифы агентства
# ---------------------------------------------------------------------------

TARIFFS = {
    "БАЗОВЫЙ": {
        "price_min": 43_600,
        "price_max": 75_700,
        "duration": "от 3 месяцев",
        "description": "Базовый SMM: ведение соцсетей, контент-план, оформление",
        "best_for": "малый бизнес без соцсетей или с неактивными страницами",
    },
    "КОРОТКАЯ ВОРОНКА": {
        "price_min": 85_000,
        "price_max": 85_000,
        "duration": "от 2 месяцев",
        "description": "Воронка быстрых продаж: таргет + контент + прогрев",
        "best_for": "бизнес с уже имеющейся аудиторией, нужны быстрые заявки",
    },
    "ПРОГРЕВАЮЩАЯ ВОРОНКА": {
        "price_min": 120_000,
        "price_max": 120_000,
        "duration": "от 4 месяцев",
        "description": "Полная воронка прогрева: контент + экспертность + доверие + продажи",
        "best_for": "сложные продукты с долгим циклом принятия решения",
    },
    "SEO-ВОРОНКА": {
        "price_min": 90_000,
        "price_max": 90_000,
        "duration": "от 6 месяцев",
        "description": "SEO + SMM: органический трафик + социальное доказательство",
        "best_for": "бизнес, которому нужен долгосрочный трафик без рекламы",
    },
}

TARIFFS_JSON = json.dumps(TARIFFS, ensure_ascii=False, indent=2)

# ---------------------------------------------------------------------------
# Промпт
# ---------------------------------------------------------------------------

PROFILE_SYSTEM_PROMPT = """Ты — эксперт по B2B продажам SMM-услуг. Агентство "Динамика" (г. Пермь) — SMM-агентство для малого и среднего бизнеса.
Основатель: Виктория Ладыгина, 20+ лет опыта в маркетинге.

Тарифы агентства (JSON):
{tariffs_json}

Онбординг: 45 000 руб. (единоразово).

Кейсы:
1. СВЕРХУ (спорт, Пермь): вирусность 57.2%, охват 3961, ERview 15.7%, бюджет 0 руб.
2. Болдино LIFE (недвижимость): контентная воронка для жилого комплекса.

Твоя задача — глубоко проанализировать компанию и дать структурированный JSON-профиль.
Отвечай ТОЛЬКО валидным JSON без markdown-блоков, объяснений вне JSON или других символов."""

PROFILE_USER_TEMPLATE = """Проанализируй компанию и заполни профиль:

Название: {company_name}
Категория 2GIS: {category}
Адрес: {address}
Рейтинг: {rating} (отзывов: {review_count})
Телефон: {phone}
Сайт: {website}

Соцсети:
- ВКонтакте: {vk_url} | подписчики: {vk_followers} | последний пост: {vk_last_post} | частота: {vk_freq}
- Telegram: {telegram_url} | подписчиков: {telegram_subs}
- Instagram: {instagram_url}
- Есть хоть одна соцсеть: {has_social}
- Активность: {is_active}
- Основная боль (предварительно): {main_pain}

Предварительная квалификация:
- Приоритет: {priority}
- Причина: {qual_reasoning}

Верни JSON строго следующей структуры:
{{
  "niche": "краткое название ниши (еда/красота/медицина/фитнес/образование/интерьер/другое)",
  "product_type": "тип продукта или услуги (1-3 слова)",
  "business_scale": "micro|small|medium",
  "business_scale_reasoning": "почему именно такой масштаб (1 предложение)",
  "smm_pain": "нет присутствия|не ведётся|без стратегии",
  "smm_pain_details": "конкретное описание боли для питча (2-3 предложения, конкретно про эту компанию)",
  "recommended_tariff": "БАЗОВЫЙ|КОРОТКАЯ ВОРОНКА|ПРОГРЕВАЮЩАЯ ВОРОНКА|SEO-ВОРОНКА",
  "tariff_reasoning": "почему именно этот тариф (2-3 предложения)",
  "roi_min_budget": 43600,
  "roi_expected_results": "что клиент получит за 3 месяца (конкретные метрики для их ниши)",
  "roi_key_metric": "главная метрика ROI для этой ниши (заявки/подписчики/охват/узнаваемость)",
  "personalization_hooks": [
    "зацепка 1 для персонального сообщения",
    "зацепка 2",
    "зацепка 3"
  ]
}}"""


# ---------------------------------------------------------------------------
# Основная функция профилирования
# ---------------------------------------------------------------------------

def profile_lead(
    company_name: str,
    category: str,
    address: str,
    rating: float,
    review_count: int,
    phone: str = "",
    website: str = "",
    social_report: Optional[SocialReport] = None,
    qualification: Optional[QualificationResult] = None,
) -> ProfileResult:
    """
    Профилирует лид через Claude API.
    Возвращает ProfileResult с полным анализом компании.
    """
    result = ProfileResult(company_name=company_name)

    if not config.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY не задан — профилирование пропущено для '%s'", company_name)
        result.smm_pain = "не ведётся"
        result.recommended_tariff = "БАЗОВЫЙ"
        result.tariff_price_min = TARIFFS["БАЗОВЫЙ"]["price_min"]
        result.tariff_price_max = TARIFFS["БАЗОВЫЙ"]["price_max"]
        result.roi_min_budget = TARIFFS["БАЗОВЫЙ"]["price_min"]
        result.niche = category
        return result

    sr = social_report or SocialReport()
    qr = qualification or QualificationResult()

    user_message = PROFILE_USER_TEMPLATE.format(
        company_name=company_name,
        category=category,
        address=address,
        rating=rating,
        review_count=review_count,
        phone=phone or "не указан",
        website=website or "нет",
        vk_url=sr.vk_url or "нет",
        vk_followers=sr.vk_followers,
        vk_last_post=f"{sr.vk_last_post_days} дн. назад" if sr.vk_last_post_days >= 0 else "неизвестно",
        vk_freq=sr.vk_posting_frequency,
        telegram_url=sr.telegram_url or "нет",
        telegram_subs=sr.telegram_subscribers,
        instagram_url=sr.instagram_url or "нет",
        has_social="да" if sr.has_any_social else "нет",
        is_active="да" if sr.is_active else "нет",
        main_pain=sr.main_pain or qr.pain_point or "не определена",
        priority=qr.priority,
        qual_reasoning=qr.reasoning or "не указана",
    )

    system_prompt = PROFILE_SYSTEM_PROMPT.format(tariffs_json=TARIFFS_JSON)

    try:
        client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        time.sleep(config.CLAUDE_REQUEST_DELAY)

        message = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=1500,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

        raw_text = message.content[0].text.strip()
        result.raw_response = raw_text

        # Убираем возможные markdown-обёртки
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            raw_text = "\n".join(lines[1:-1]) if lines[-1].strip() == "```" else "\n".join(lines[1:])

        data = json.loads(raw_text)

        result.niche = data.get("niche", category)
        result.product_type = data.get("product_type", "")
        result.business_scale = data.get("business_scale", "small")
        result.business_scale_reasoning = data.get("business_scale_reasoning", "")
        result.smm_pain = data.get("smm_pain", "не ведётся")
        result.smm_pain_details = data.get("smm_pain_details", "")
        result.recommended_tariff = data.get("recommended_tariff", "БАЗОВЫЙ")
        result.tariff_reasoning = data.get("tariff_reasoning", "")
        result.roi_min_budget = int(data.get("roi_min_budget", 43_600))
        result.roi_expected_results = data.get("roi_expected_results", "")
        result.roi_key_metric = data.get("roi_key_metric", "заявки")
        result.personalization_hooks = data.get("personalization_hooks", [])

        # Заполняем цены из справочника тарифов
        tariff_info = TARIFFS.get(result.recommended_tariff, TARIFFS["БАЗОВЫЙ"])
        result.tariff_price_min = tariff_info["price_min"]
        result.tariff_price_max = tariff_info["price_max"]

        logger.info(
            "Профиль создан: %s | ниша=%s | тариф=%s | боль=%s",
            company_name, result.niche, result.recommended_tariff, result.smm_pain,
        )

    except json.JSONDecodeError as exc:
        logger.error("Ошибка парсинга JSON от Claude для '%s': %s", company_name, exc)
        logger.debug("Raw response: %s", result.raw_response)
        _fill_defaults(result, category)

    except anthropic.APIError as exc:
        logger.error("Ошибка Claude API для '%s': %s", company_name, exc)
        _fill_defaults(result, category)

    except Exception as exc:
        logger.error("Непредвиденная ошибка профилирования '%s': %s", company_name, exc)
        _fill_defaults(result, category)

    return result


def _fill_defaults(result: ProfileResult, category: str) -> None:
    """Заполняет дефолтные значения при ошибке API."""
    result.niche = category
    result.smm_pain = "не ведётся"
    result.recommended_tariff = "БАЗОВЫЙ"
    tariff_info = TARIFFS["БАЗОВЫЙ"]
    result.tariff_price_min = tariff_info["price_min"]
    result.tariff_price_max = tariff_info["price_max"]
    result.roi_min_budget = tariff_info["price_min"]
    result.roi_expected_results = "рост подписчиков и вовлечённости аудитории за 3 месяца"
    result.roi_key_metric = "заявки"
    result.personalization_hooks = []
