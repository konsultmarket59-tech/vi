"""
qualifier.py — AI-квалификация лидов через Claude API (библиотека anthropic).

Принимает данные лида (Lead) и отчёт о соцсетях (SocialReport),
возвращает QualificationResult с приоритетом, болью и обоснованием.

Особенности реализации:
- Structured outputs (output_config.format + json_schema) — гарантируют валидный JSON
- Prompt caching системного промпта (cache_control ephemeral) — экономия токенов
- Rule-based fallback при недоступности API
- Трекинг токенов и оценка стоимости каждого вызова
- Exponential backoff при ошибках сети / rate limit
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Optional, List

import anthropic

import config
from database import Lead

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataclass результата квалификации
# ---------------------------------------------------------------------------

@dataclass
class QualificationResult:
    """Результат AI-квалификации одного лида."""

    priority: str = "LOW"               # HIGH / MEDIUM / LOW / SKIP
    pain_point: str = ""                # Формулировка основной боли
    recommended_tariff: str = ""        # Название тарифа
    recommended_tariff_price: int = 0   # Цена тарифа (руб/мес)
    reasoning: str = ""                 # Обоснование решения
    pitch_hook: str = ""                # Первая фраза для питча
    suggested_content_ideas: List[str] = field(default_factory=list)
    skip_reason: str = ""               # Причина пропуска (если SKIP)

    # Метаданные вызова API
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model_used: str = ""
    call_duration_sec: float = 0.0
    used_fallback: bool = False         # True — ответ дан rule-based fallback


# ---------------------------------------------------------------------------
# Pricing для трекинга стоимости (claude-sonnet-4-6, $/1M токенов)
# ---------------------------------------------------------------------------

_PRICE_INPUT_PER_M       = 3.00
_PRICE_OUTPUT_PER_M      = 15.00
_PRICE_CACHE_READ_PER_M  = 0.30
_PRICE_CACHE_WRITE_PER_M = 3.75


def _estimate_cost_usd(result: QualificationResult) -> float:
    """Оценивает стоимость одного вызова Claude в долларах."""
    return round(
        result.input_tokens        / 1_000_000 * _PRICE_INPUT_PER_M
        + result.output_tokens     / 1_000_000 * _PRICE_OUTPUT_PER_M
        + result.cache_read_tokens / 1_000_000 * _PRICE_CACHE_READ_PER_M
        + result.cache_write_tokens / 1_000_000 * _PRICE_CACHE_WRITE_PER_M,
        6,
    )


# ---------------------------------------------------------------------------
# Системный промпт (стабильный — кешируем через cache_control)
# ---------------------------------------------------------------------------

_TARIFF_LIST = "\n".join(
    f"- {name}: {info['price']:,} руб./мес — {info['description']}"
    for name, info in config.TARIFF_TIERS.items()
)

_SYSTEM_PROMPT = f"""Ты — эксперт по B2B-продажам и SMM-маркетингу, работающий в агентстве «{config.AGENCY_NAME}» (сайт: {config.AGENCY_WEBSITE}), г. {config.AGENCY_CITY}.

## Задача
Квалифицировать входящий лид (потенциального клиента) по данным из 2GIS и проверки соцсетей.
Вернуть структурированный JSON с оценкой и рекомендациями для менеджера по продажам.

## Услуги агентства
- SMM (ведение ВКонтакте, Telegram, создание контента)
- Контент-маркетинг для малого и среднего бизнеса (МСБ)

## Тарифы (руб./месяц, разовый онбординг {config.TARIFF_ONBOARDING:,} руб.):
{_TARIFF_LIST}

## Идеальный профиль клиента (ЦКП)

### HIGH-приоритет — все критерии одновременно:
1. Активный офлайн-бизнес в Перми: рейтинг 4.0+, 10+ отзывов в 2GIS
2. Нет соцсетей ИЛИ последний пост был >21 дня назад
3. Визуальная ниша: еда/напитки, красота/уход, фитнес/спорт, медицина, интерьер/декор, цветы, дети, фото
4. МСБ — не государственный, не федеральная сеть/франчайзинг

### MEDIUM-приоритет (хотя бы 2 из 4):
- Соцсети есть, но слабые: посты реже 1/нед., нет видео, нет единого стиля
- Рейтинг 3.5–4.0
- Смежная ниша (строительство, образование, розница)
- Есть телефон и/или сайт

### LOW-приоритет:
- Нет телефона и сайта
- Рейтинг <3.5 или <5 отзывов
- Активные соцсети с профессиональным контентом

### SKIP (пропустить немедленно):
- Государственные/муниципальные учреждения
- Крупные сети и федеральные франшизы
- За пределами Перми
- Нет никакой контактной информации

## Формат ответа
Верни строго валидный JSON без пояснений до или после него.
Поля описаны в схеме — не добавляй лишних ключей.
"""

# JSON Schema для structured outputs
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {
            "type": "string",
            "enum": ["HIGH", "MEDIUM", "LOW", "SKIP"],
        },
        "pain_point": {
            "type": "string",
            "description": "Основная боль бизнеса (1-2 предложения на русском)",
        },
        "recommended_tariff": {
            "type": "string",
            "description": "Название тарифа из списка или пустая строка если SKIP",
        },
        "recommended_tariff_price": {
            "type": "integer",
            "description": "Цена тарифа в рублях (0 если SKIP)",
        },
        "reasoning": {
            "type": "string",
            "description": "Обоснование решения (3-5 предложений)",
        },
        "pitch_hook": {
            "type": "string",
            "description": "Первая фраза для обращения к клиенту (на Вы, на русском)",
        },
        "suggested_content_ideas": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-3 идеи для контент-плана (пустой массив если SKIP)",
        },
        "skip_reason": {
            "type": "string",
            "description": "Причина пропуска (только если SKIP, иначе пустая строка)",
        },
    },
    "required": [
        "priority", "pain_point", "recommended_tariff",
        "recommended_tariff_price", "reasoning", "pitch_hook",
        "suggested_content_ideas", "skip_reason",
    ],
    "additionalProperties": False,
}


# ---------------------------------------------------------------------------
# Построение пользовательского сообщения
# ---------------------------------------------------------------------------

def _build_user_message(lead: Lead, social=None) -> str:
    """Формирует описание лида для передачи в Claude."""
    lines = [
        "## Данные лида для квалификации",
        "",
        f"**Компания:** {lead.company_name}",
        f"**Категория:** {lead.category}",
        f"**Адрес:** {lead.address}",
        f"**Телефон:** {lead.phone or 'не указан'}",
        f"**Сайт:** {lead.website or 'нет'}",
        f"**Рейтинг 2GIS:** {lead.rating} ({lead.review_count} отзывов)",
        "",
        "### Социальные сети",
    ]

    if social is not None:
        has_vk = getattr(social, "has_vk", False)
        has_tg = getattr(social, "has_telegram", False)
        lines.append(f"**ВКонтакте:** {'есть (' + str(lead.vk_url) + ')' if has_vk else 'нет'}")
        if has_vk:
            days = getattr(social, "last_post_days_ago", -1)
            freq = getattr(social, "posting_frequency", "unknown")
            posts_30 = getattr(social, "posts_last_30_days", 0)
            has_video = getattr(social, "has_video", False)
            has_style = getattr(social, "has_style_consistency", False)
            lines += [
                f"  - Последний пост: {days} дн. назад" if days >= 0 else "  - Последний пост: неизвестно",
                f"  - Частота: {freq}",
                f"  - Постов за 30 дней: {posts_30}",
                f"  - Видеоконтент: {'да' if has_video else 'нет'}",
                f"  - Единый стиль: {'да' if has_style else 'нет'}",
            ]
        lines.append(f"**Telegram:** {'есть (' + str(lead.telegram_url) + ')' if has_tg else 'нет'}")
        is_inactive = getattr(social, "is_inactive", False)
        needs_smm   = getattr(social, "needs_smm", False)
        lines += [
            "",
            f"**Итог:** {'Неактивен (>21 дня без постов)' if is_inactive else 'Активен'}",
            f"**Нуждается в SMM:** {'да' if needs_smm else 'нет/частично'}",
        ]
    else:
        lines += [
            f"**ВКонтакте:** {lead.vk_url or 'не указана'}",
            f"**Telegram:** {lead.telegram_url or 'не указан'}",
            "*(Проверка соцсетей не выполнялась)*",
        ]

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Rule-based fallback (без API)
# ---------------------------------------------------------------------------

def _rule_based_qualify(lead: Lead) -> QualificationResult:
    """
    Быстрая квалификация на основе правил.
    Используется при отсутствии/недоступности Claude API.
    """
    result = QualificationResult(used_fallback=True, model_used="rule-based")
    combined = f"{lead.company_name} {lead.category}".lower()

    # SKIP: стоп-слова
    for kw in config.ICP.skip_keywords:
        if kw in combined:
            result.priority = "SKIP"
            result.skip_reason = f"Стоп-слово: «{kw}»"
            return result
    for chain in config.ICP.known_chains:
        if chain in combined:
            result.priority = "SKIP"
            result.skip_reason = f"Известная сеть: «{chain}»"
            return result

    # Характеристики
    is_visual = any(n in combined for n in config.ICP.visual_niches)
    has_social = bool(lead.vk_url or lead.telegram_url)
    is_high_rated = lead.rating >= config.ICP.min_rating and lead.review_count >= config.ICP.min_reviews

    if is_visual and is_high_rated and not has_social:
        result.priority = "HIGH"
        result.pain_point = "Бизнес не представлен в социальных сетях — упускает онлайн-аудиторию."
        result.recommended_tariff = "Старт"
        result.recommended_tariff_price = config.TARIFF_TIERS.get("Старт", {}).get("price", 43_600)
        result.reasoning = (
            f"Визуальная ниша, высокий рейтинг {lead.rating} ({lead.review_count} отзывов), "
            "полное отсутствие соцсетей — идеальный кандидат для SMM."
        )
        result.pitch_hook = f"Добрый день! Мы заметили, что у {lead.company_name} ещё нет страницы ВКонтакте — и хотим это исправить."
        result.suggested_content_ideas = [
            "Фото и видео «до/после»",
            "Истории сотрудников и закулисье производства",
            "Акции и специальные предложения для подписчиков",
        ]
    elif is_visual and is_high_rated:
        result.priority = "HIGH"
        result.pain_point = "Соцсети ведутся нерегулярно, упускается потенциал онлайн-продаж."
        result.recommended_tariff = "Бизнес"
        result.recommended_tariff_price = config.TARIFF_TIERS.get("Бизнес", {}).get("price", 89_000)
        result.reasoning = (
            f"Визуальная ниша, рейтинг {lead.rating} ({lead.review_count} отзывов), "
            "соцсети требуют профессионального ведения."
        )
        result.pitch_hook = f"Добрый день! Мы видим, что {lead.company_name} уже есть ВКонтакте — и хотим помочь привлечь больше клиентов."
        result.suggested_content_ideas = [
            "Регулярный контент-план 12+ постов/мес",
            "Видеоконтент и сторис",
            "Таргетированная реклама",
        ]
    elif is_high_rated or is_visual:
        result.priority = "MEDIUM"
        result.pain_point = "Частичное соответствие ЦКП — требует уточнения."
        result.recommended_tariff = "Старт"
        result.recommended_tariff_price = config.TARIFF_TIERS.get("Старт", {}).get("price", 43_600)
        result.reasoning = "Частичное соответствие профилю — нужна детальная проверка менеджером."
        result.pitch_hook = f"Добрый день! Мы хотели бы обсудить возможности продвижения {lead.company_name}."
        result.suggested_content_ideas = ["Базовый контент-план", "Оформление страницы"]
    else:
        result.priority = "LOW"
        result.pain_point = "Не соответствует ЦКП агентства."
        result.reasoning = f"Рейтинг {lead.rating} ({lead.review_count} отзывов) или ниша не совпадает с ЦКП."

    return result


# ---------------------------------------------------------------------------
# Claude API квалификация
# ---------------------------------------------------------------------------

def qualify_lead(
    lead: Lead,
    social=None,
    client: Optional[anthropic.Anthropic] = None,
) -> QualificationResult:
    """
    Квалифицирует лид через Claude API с использованием structured outputs.

    Args:
        lead:   Объект Lead с данными о компании.
        social: SocialReport (опционально; любой объект с нужными атрибутами).
        client: Готовый anthropic.Anthropic (для переиспользования соединения).

    Returns:
        QualificationResult с заполненными полями.
    """
    result = QualificationResult(model_used=config.CLAUDE_MODEL)

    if not config.ANTHROPIC_API_KEY:
        logger.warning(
            "ANTHROPIC_API_KEY не задан — rule-based квалификация для '%s'",
            lead.company_name,
        )
        return _rule_based_qualify(lead)

    if client is None:
        client = anthropic.Anthropic(
            api_key=config.ANTHROPIC_API_KEY,
            **({"base_url": config.ANTHROPIC_BASE_URL} if config.ANTHROPIC_BASE_URL else {}),
        )

    user_message = _build_user_message(lead, social)
    start_time = time.time()
    last_exc: Optional[Exception] = None

    for attempt in range(1, config.MAX_RETRIES + 1):
        try:
            response = client.messages.create(
                model=config.CLAUDE_MODEL,
                max_tokens=config.CLAUDE_MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": _SYSTEM_PROMPT,
                        # Кешируем системный промпт — он одинаков для всех лидов
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_message}],
                output_config={
                    "format": {
                        "type": "json_schema",
                        "schema": _RESPONSE_SCHEMA,
                    }
                },
            )

            # Трекинг токенов
            usage = response.usage
            result.input_tokens        = getattr(usage, "input_tokens", 0)
            result.output_tokens       = getattr(usage, "output_tokens", 0)
            result.cache_read_tokens   = getattr(usage, "cache_read_input_tokens", 0)
            result.cache_write_tokens  = getattr(usage, "cache_creation_input_tokens", 0)
            result.call_duration_sec   = round(time.time() - start_time, 2)

            # Извлекаем текст (structured output гарантирует валидный JSON)
            text_content = next(
                (block.text for block in response.content if block.type == "text"),
                "",
            )

            if not text_content:
                logger.warning("Пустой ответ от Claude для '%s'", lead.company_name)
                return _rule_based_qualify(lead)

            # Парсим JSON
            try:
                data = json.loads(text_content)
            except json.JSONDecodeError as json_exc:
                logger.error(
                    "Невалидный JSON от Claude для '%s': %s | Текст: %s",
                    lead.company_name, json_exc, text_content[:300],
                )
                return _rule_based_qualify(lead)

            # Заполняем результат
            result.priority                = data.get("priority", "LOW")
            result.pain_point              = data.get("pain_point", "")
            result.recommended_tariff      = data.get("recommended_tariff", "")
            result.recommended_tariff_price = int(data.get("recommended_tariff_price", 0))
            result.reasoning               = data.get("reasoning", "")
            result.pitch_hook              = data.get("pitch_hook", "")
            result.suggested_content_ideas = data.get("suggested_content_ideas", [])
            result.skip_reason             = data.get("skip_reason", "")

            cost_usd = _estimate_cost_usd(result)
            logger.info(
                "Квалификация '%s': %s | "
                "tokens(in=%d out=%d cache_r=%d cache_w=%d) | "
                "cost≈$%.4f | %.1fс",
                lead.company_name, result.priority,
                result.input_tokens, result.output_tokens,
                result.cache_read_tokens, result.cache_write_tokens,
                cost_usd, result.call_duration_sec,
            )
            return result

        except anthropic.RateLimitError as exc:
            retry_after = int(
                getattr(getattr(exc, "response", None), "headers", {})
                .get("retry-after", "60")
            )
            logger.warning(
                "Rate limit Claude (попытка %d/%d). Ожидание %d сек.",
                attempt, config.MAX_RETRIES, retry_after,
            )
            last_exc = exc
            time.sleep(retry_after)

        except anthropic.APIStatusError as exc:
            if exc.status_code >= 500:
                backoff = config.RETRY_BACKOFF ** attempt
                logger.warning(
                    "Серверная ошибка Claude %d (попытка %d/%d). Повтор через %.1f сек.",
                    exc.status_code, attempt, config.MAX_RETRIES, backoff,
                )
                last_exc = exc
                time.sleep(backoff)
            else:
                logger.error(
                    "Ошибка Claude API %d для '%s': %s",
                    exc.status_code, lead.company_name, exc.message,
                )
                return _rule_based_qualify(lead)

        except anthropic.APIConnectionError as exc:
            backoff = config.RETRY_BACKOFF ** attempt
            logger.warning(
                "Сетевая ошибка Claude (попытка %d/%d): %s. Повтор через %.1f сек.",
                attempt, config.MAX_RETRIES, exc, backoff,
            )
            last_exc = exc
            time.sleep(backoff)

        except Exception as exc:
            logger.error(
                "Непредвиденная ошибка квалификации '%s': %s",
                lead.company_name, exc, exc_info=True,
            )
            return _rule_based_qualify(lead)

        if attempt < config.MAX_RETRIES:
            time.sleep(config.CLAUDE_REQUEST_DELAY)

    # Все попытки исчерпаны
    logger.error(
        "Не удалось квалифицировать '%s' после %d попыток. Последняя ошибка: %s",
        lead.company_name, config.MAX_RETRIES, last_exc,
    )
    fb = _rule_based_qualify(lead)
    fb.reasoning = (
        f"Квалификация Claude недоступна ({config.MAX_RETRIES} попытки, ошибка: {last_exc}). "
        + fb.reasoning
    )
    return fb


# ---------------------------------------------------------------------------
# Пакетная квалификация
# ---------------------------------------------------------------------------

@dataclass
class BatchStats:
    """Агрегированная статистика пакетной квалификации."""
    total: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    skip: int = 0
    fallbacks: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_read: int = 0
    total_cache_write: int = 0
    total_cost_usd: float = 0.0
    duration_sec: float = 0.0


def qualify_batch(
    leads: List[Lead],
    social_reports: Optional[List] = None,
    delay_between: float = config.CLAUDE_REQUEST_DELAY,
) -> tuple:
    """
    Квалифицирует список лидов пакетно, используя один HTTP-клиент.

    Args:
        leads:          Список Lead.
        social_reports: Список SocialReport (в том же порядке; None = без проверки).
        delay_between:  Пауза между вызовами Claude (секунды).

    Returns:
        Кортеж (List[QualificationResult], BatchStats).
    """
    if not leads:
        return [], BatchStats()

    if social_reports is None:
        social_reports = [None] * len(leads)
    elif len(social_reports) < len(leads):
        social_reports = list(social_reports) + [None] * (len(leads) - len(social_reports))

    api_client = (
        anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
        if config.ANTHROPIC_API_KEY else None
    )

    results: List[QualificationResult] = []
    stats = BatchStats()
    batch_start = time.time()

    for i, (lead, social) in enumerate(zip(leads, social_reports), 1):
        logger.info("[%d/%d] Квалифицируем: %s", i, len(leads), lead.company_name)
        result = qualify_lead(lead, social, client=api_client)
        results.append(result)

        stats.total += 1
        p = result.priority.upper()
        if p == "HIGH":     stats.high   += 1
        elif p == "MEDIUM": stats.medium += 1
        elif p == "SKIP":   stats.skip   += 1
        else:               stats.low    += 1

        if result.used_fallback:
            stats.fallbacks += 1

        stats.total_input_tokens  += result.input_tokens
        stats.total_output_tokens += result.output_tokens
        stats.total_cache_read    += result.cache_read_tokens
        stats.total_cache_write   += result.cache_write_tokens
        stats.total_cost_usd      += _estimate_cost_usd(result)

        if i < len(leads):
            time.sleep(delay_between)

    stats.duration_sec   = round(time.time() - batch_start, 1)
    stats.total_cost_usd = round(stats.total_cost_usd, 4)

    logger.info(
        "Пакет завершён: %d лидов за %.1f сек | HIGH=%d MEDIUM=%d LOW=%d SKIP=%d | "
        "Токены: in=%d out=%d cache_r=%d | Стоимость: $%.4f",
        stats.total, stats.duration_sec,
        stats.high, stats.medium, stats.low, stats.skip,
        stats.total_input_tokens, stats.total_output_tokens, stats.total_cache_read,
        stats.total_cost_usd,
    )
    return results, stats


# ---------------------------------------------------------------------------
# CLI для тестирования
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    from database import init_db

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    init_db()

    # Тестовый лид
    test_lead = Lead(
        company_name="Салон красоты Люмьер",
        category="Салон красоты",
        address="ул. Ленина, 10, Пермь",
        phone="+7 342 200-00-01",
        website="lumiere-perm.ru",
        vk_url="",
        telegram_url="",
        rating=4.7,
        review_count=83,
        source_query="салон красоты Пермь",
    )

    print(f"\nКвалифицируем: {test_lead.company_name}")
    result = qualify_lead(test_lead)

    print(f"\n=== Результат ===")
    print(f"  Приоритет:    {result.priority}")
    print(f"  Боль:         {result.pain_point}")
    print(f"  Тариф:        {result.recommended_tariff} ({result.recommended_tariff_price:,} руб./мес)")
    print(f"  Обоснование:  {result.reasoning}")
    print(f"  Питч:         {result.pitch_hook}")
    print(f"  Идеи:         {result.suggested_content_ideas}")
    if result.skip_reason:
        print(f"  SKIP-причина: {result.skip_reason}")
    print(f"\n  Модель:       {result.model_used} (fallback={result.used_fallback})")
    print(f"  Токены:       in={result.input_tokens} out={result.output_tokens} "
          f"cache_r={result.cache_read_tokens}")
    print(f"  Стоимость:    ${_estimate_cost_usd(result):.4f}")
    print(f"  Время:        {result.call_duration_sec} сек.")
