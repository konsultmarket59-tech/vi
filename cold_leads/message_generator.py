"""
message_generator.py — Генерация персонализированных холодных сообщений для ВКонтакте.

Создаёт краткое первое сообщение (до 500 символов) и шаблон follow-up (день 3).
Использует Claude API для персонализации под конкретную компанию.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import anthropic

import config

logger = logging.getLogger(__name__)

MESSAGES_DIR = Path(__file__).parent / "messages"
MESSAGES_DIR.mkdir(exist_ok=True)

AGENCY_FOUNDER = "Виктория"
AGENCY_NAME = "Динамика"
AGENCY_URL = "dynamicbrands.ru"


@dataclass
class OutreachMessage:
    """Результат генерации сообщений для компании."""

    first_message: str = ""      # Первое холодное сообщение (до 500 символов)
    follow_up: str = ""          # Follow-up на день 3 (если нет ответа)
    subject_line: str = ""       # Тема для email (если нужно)
    char_count: int = 0          # Длина первого сообщения
    generated_by: str = "ai"    # "ai" или "template"


# ---------------------------------------------------------------------------
# Системный промпт для Claude
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Ты — Виктория Ладыгина, основатель маркетингового агентства "Динамика" (Пермь).
Пишешь холодные сообщения во ВКонтакте потенциальным клиентам.

Твой стиль:
- Дружелюбный и профессиональный, без агрессивных продаж
- Говоришь конкретно: называешь что именно увидела в их соцсетях
- Коротко — максимум 450 символов в первом сообщении
- Не давишь — предлагаешь ценность (бесплатный разбор), не продаёшь сразу
- Заканчиваешь вопросом (закрытый вопрос, чтобы получить ответ "да/нет")

Формат ответа — только JSON без markdown-блоков:
{
  "first_message": "текст первого сообщения (до 450 символов)",
  "follow_up": "текст follow-up сообщения на день 3 (до 300 символов)",
  "subject_line": "тема для email (если нужна)"
}"""

USER_TEMPLATE = """Напиши холодное сообщение для:

Компания: {company_name}
Ниша: {niche}
Боль: {pain_point}
Рекомендованный тариф: {recommended_tariff}
Детали о соцсетях: {social_diagnosis}
Ссылка ВКонтакте компании: {vk_url}

Контекст боли:
- "нет присутствия" → нет страницы или не найти в ВК
- "не ведётся" → страница есть, но последний пост был давно (указан в деталях)
- "без стратегии" → посты есть, но хаотичные, без системы

Важно:
- Упомяни конкретное наблюдение (из «детали о соцсетях»)
- CTA: предложи бесплатный разбор аккаунта
- Подпись: Виктория, агентство Динамика"""


# ---------------------------------------------------------------------------
# Шаблонные сообщения (fallback без Claude API)
# ---------------------------------------------------------------------------

TEMPLATES = {
    "нет присутствия": {
        "first_message": (
            "Добрый день! Меня зовут Виктория, агентство «Динамика» (Пермь).\n\n"
            "Ищу вас во ВКонтакте и не могу найти — значит, часть клиентов проходит мимо.\n\n"
            "Хотите, сделаю бесплатный разбор: как именно соцсети помогут привлечь "
            "больше клиентов в {company_name}? Это займёт 15 минут."
        ),
        "follow_up": (
            "Виктория снова, агентство «Динамика». Подготовила разбор для {company_name} — "
            "могу поделиться бесплатно. Удобно созвониться на 15 мин?"
        ),
    },
    "не ведётся": {
        "first_message": (
            "Добрый день! Виктория, агентство «Динамика» (Пермь).\n\n"
            "Нашла вашу страницу ВКонтакте — вижу, что публикации давно не выходили. "
            "Это нормально, жизнь насыщенная :)\n\n"
            "Могу бесплатно разобрать аккаунт и показать, что можно улучшить без "
            "больших вложений. Интересно?"
        ),
        "follow_up": (
            "Виктория, агентство «Динамика». Ещё раз по вопросу соцсетей {company_name} — "
            "подготовила несколько идей конкретно для вашей ниши. Поделиться?"
        ),
    },
    "без стратегии": {
        "first_message": (
            "Добрый день! Виктория, агентство «Динамика» (Пермь).\n\n"
            "Видела ваши публикации — контент есть, но заметила что пока без системы. "
            "Это частая история: посты выходят, но не ведут к заявкам.\n\n"
            "Хочу показать, как это поправить. Могу сделать бесплатный аудит — интересно?"
        ),
        "follow_up": (
            "Снова Виктория из «Динамики». Подготовила идеи для {company_name} — "
            "как превратить контент в поток клиентов. 10 минут на звонок?"
        ),
    },
}


def _format_template(text: str, company_name: str) -> str:
    return text.replace("{company_name}", company_name)


def _count_chars(text: str) -> int:
    return len(text)


# ---------------------------------------------------------------------------
# Генерация через Claude API
# ---------------------------------------------------------------------------

def _generate_via_claude(
    company_name: str,
    niche: str,
    pain_point: str,
    recommended_tariff: str,
    social_diagnosis: str,
    vk_url: str,
) -> Optional[OutreachMessage]:
    """Генерирует сообщения через Claude API. Возвращает None при ошибке."""
    if not config.ANTHROPIC_API_KEY:
        return None

    user_message = USER_TEMPLATE.format(
        company_name=company_name,
        niche=niche,
        pain_point=pain_point,
        recommended_tariff=recommended_tariff,
        social_diagnosis=social_diagnosis or "данные не собраны",
        vk_url=vk_url or "не указана",
    )

    try:
        client = anthropic.Anthropic(
            api_key=config.ANTHROPIC_API_KEY,
            **({"base_url": config.ANTHROPIC_BASE_URL} if config.ANTHROPIC_BASE_URL else {}),
        )
        time.sleep(config.CLAUDE_REQUEST_DELAY)

        response = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=800,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        raw_text = response.content[0].text.strip()

        # Убираем markdown-обёртки
        raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
        raw_text = re.sub(r"\s*```$", "", raw_text)

        data = json.loads(raw_text)

        first_msg = data.get("first_message", "")
        follow_up = data.get("follow_up", "")
        subject = data.get("subject_line", "")

        # Обрезаем если модель всё равно дала больше 500 символов
        if len(first_msg) > 500:
            first_msg = first_msg[:497] + "..."

        return OutreachMessage(
            first_message=first_msg,
            follow_up=follow_up,
            subject_line=subject,
            char_count=len(first_msg),
            generated_by="ai",
        )

    except json.JSONDecodeError as exc:
        logger.error("Ошибка парсинга JSON от Claude (message_generator): %s", exc)
    except anthropic.APIError as exc:
        logger.error("Ошибка Claude API (message_generator): %s", exc)
    except Exception as exc:
        logger.error("Непредвиденная ошибка генерации сообщения: %s", exc)

    return None


def _generate_from_template(
    company_name: str,
    pain_point: str,
) -> OutreachMessage:
    """Fallback: берёт шаблонное сообщение под тип боли."""
    pain_key = pain_point if pain_point in TEMPLATES else "не ведётся"
    tmpl = TEMPLATES[pain_key]
    first_msg = _format_template(tmpl["first_message"], company_name)
    follow_up = _format_template(tmpl["follow_up"], company_name)

    return OutreachMessage(
        first_message=first_msg,
        follow_up=follow_up,
        char_count=len(first_msg),
        generated_by="template",
    )


# ---------------------------------------------------------------------------
# Публичный API
# ---------------------------------------------------------------------------

def generate_message(
    company_name: str,
    niche: str = "",
    pain_point: str = "не ведётся",
    recommended_tariff: str = "БАЗОВЫЙ",
    social_diagnosis: str = "",
    vk_url: str = "",
    save_to_file: bool = True,
) -> OutreachMessage:
    """
    Генерирует персонализированные сообщения для ВКонтакте.

    Args:
        company_name: Название компании
        niche: Ниша бизнеса
        pain_point: Тип боли (нет присутствия / не ведётся / без стратегии)
        recommended_tariff: Рекомендованный тариф
        social_diagnosis: Конкретные наблюдения о соцсетях
        vk_url: URL ВКонтакте компании
        save_to_file: Сохранить ли сообщения в файл

    Returns:
        OutreachMessage с готовыми текстами
    """
    # Пробуем Claude API
    result = _generate_via_claude(
        company_name=company_name,
        niche=niche,
        pain_point=pain_point,
        recommended_tariff=recommended_tariff,
        social_diagnosis=social_diagnosis,
        vk_url=vk_url,
    )

    # Fallback на шаблон
    if result is None:
        logger.info(
            "Используем шаблонное сообщение для '%s' (Claude API недоступен)",
            company_name,
        )
        result = _generate_from_template(company_name, pain_point)

    # Сохранение
    if save_to_file:
        _save_to_file(company_name, result)

    logger.info(
        "Сообщение для '%s' готово (%d символов, источник: %s)",
        company_name,
        result.char_count,
        result.generated_by,
    )

    return result


def _save_to_file(company_name: str, msg: OutreachMessage) -> Optional[str]:
    """Сохраняет сообщения в текстовый файл."""
    safe_name = "".join(c for c in company_name if c.isalnum() or c in " _-")
    safe_name = safe_name.strip().replace(" ", "_")[:40]
    file_path = MESSAGES_DIR / f"{safe_name}_message.txt"

    content = f"""СООБЩЕНИЕ ДЛЯ: {company_name}
{'='*60}

ПЕРВОЕ СООБЩЕНИЕ ({msg.char_count} символов):
{msg.first_message}

---

FOLLOW-UP (день 3, если нет ответа):
{msg.follow_up}
"""
    if msg.subject_line:
        content += f"\nТЕМА EMAIL:\n{msg.subject_line}\n"

    content += f"\nГенерация: {msg.generated_by}\n"

    try:
        file_path.write_text(content, encoding="utf-8")
        logger.debug("Сообщение сохранено: %s", file_path)
        return str(file_path)
    except OSError as exc:
        logger.error("Ошибка сохранения сообщения: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Вступительный текст для PDF-КП
# ---------------------------------------------------------------------------

_KP_INTRO_SYSTEM = """Ты — Виктория Ладыгина, основатель агентства «Динамика» (Пермь).
Пишешь вводный персональный текст для PDF-коммерческого предложения.

Правила:
- Тёплый и профессиональный тон, без канцелярита и клише («мы рады предложить»)
- Конкретика: называй что именно увидела в соцсетях этой компании
- 4 абзаца, каждый 2–3 предложения
- Структура:
  1) Что заметили о соцсетях (конкретное наблюдение)
  2) Почему это важно — факт о рынке/спросе/конкурентах в этой нише в Перми
  3) О нас: агентство Динамика, 20+ лет в маркетинге, знаем эту нишу
  4) Переход к предложению: «Мы подготовили для вас индивидуальное предложение — вот порядок цен и состав работ»
- Ответ — только текст без заголовков и markdown, абзацы разделены пустой строкой"""

_KP_INTRO_USER = """Напиши вступительный текст для КП:

Компания: {company_name}
Ниша: {niche}
Наблюдение о соцсетях: {social_diagnosis}
Тип проблемы: {pain_point}
Рекомендованный тариф: {recommended_tariff}"""

# Шаблонные fallback-вступления (если Claude недоступен)
_KP_INTRO_FALLBACKS = {
    "нет присутствия": (
        "Мы изучили присутствие «{company_name}» в социальных сетях — и не нашли активных страниц. "
        "Это значит, что клиенты, которые ищут {niche} в Перми через ВКонтакте, вас просто не находят.\n\n"
        "В вашей нише конкуренты уже активно работают с соцсетями: публикуют контент несколько раз в неделю, "
        "получают заявки и отзывы. Отсутствие в соцсетях сегодня — это не нейтральная позиция, а потерянные клиенты.\n\n"
        "Мы — агентство «Динамика», Пермь. Более 20 лет в маркетинге: стратегия, SMM, брендинг, "
        "производство контента. Работаем с бизнесом из вашей ниши и знаем, какой контент приводит реальных клиентов.\n\n"
        "Мы подготовили для вас индивидуальное предложение — вот порядок цен и состав работ:"
    ),
    "не ведётся": (
        "{social_diagnosis} Потенциальные клиенты заходят на страницу "
        "и видят тишину — и уходят к тем, кто активен.\n\n"
        "В нише «{niche}» в Перми аудитория принимает решение именно через соцсети: "
        "смотрит последние посты, читает отзывы, оценивает активность. "
        "Конкуренты публикуют контент регулярно — и регулярно получают обращения.\n\n"
        "Мы — агентство «Динамика», Пермь. Более 20 лет в маркетинге: "
        "SMM-стратегия, производство контента, аналитика. "
        "Поднимаем «уснувшие» аккаунты и превращаем их в рабочий канал продаж.\n\n"
        "Мы подготовили для вас индивидуальное предложение — вот порядок цен и состав работ:"
    ),
    "без стратегии": (
        "{social_diagnosis} Контент выходит, но пока не выстраивает путь клиента к покупке.\n\n"
        "В нише «{niche}» в Перми побеждает тот, у кого есть система: "
        "охват → доверие → заявка. Без воронки контент работает вхолостую — "
        "аудитория читает, но не обращается.\n\n"
        "Мы — агентство «Динамика», Пермь. Более 20 лет в маркетинге: "
        "выстраиваем контент-стратегию под цели бизнеса, делаем контент, который продаёт.\n\n"
        "Мы подготовили для вас индивидуальное предложение — вот порядок цен и состав работ:"
    ),
}


def generate_kp_intro(
    company_name: str,
    niche: str,
    pain_point: str,
    recommended_tariff: str,
    social_diagnosis: str,
) -> str:
    """
    Генерирует персональное вступление для PDF-КП через Claude.
    Fallback — шаблонный текст.
    """
    if config.ANTHROPIC_API_KEY:
        try:
            client = anthropic.Anthropic(
                api_key=config.ANTHROPIC_API_KEY,
                **({"base_url": config.ANTHROPIC_BASE_URL} if config.ANTHROPIC_BASE_URL else {}),
            )
            time.sleep(config.CLAUDE_REQUEST_DELAY)

            response = client.messages.create(
                model=config.CLAUDE_MODEL,
                max_tokens=600,
                system=_KP_INTRO_SYSTEM,
                messages=[{"role": "user", "content": _KP_INTRO_USER.format(
                    company_name=company_name,
                    niche=niche,
                    social_diagnosis=social_diagnosis or "данные не собраны",
                    pain_point=pain_point,
                    recommended_tariff=recommended_tariff,
                )}],
            )
            text = response.content[0].text.strip()
            if text:
                logger.info("Вступление КП для '%s' сгенерировано Claude", company_name)
                return text
        except Exception as exc:
            logger.warning("Ошибка генерации вступления КП: %s", exc)

    # Fallback
    pain_key = pain_point if pain_point in _KP_INTRO_FALLBACKS else "не ведётся"
    tmpl = _KP_INTRO_FALLBACKS[pain_key]
    return tmpl.format(
        company_name=company_name,
        niche=niche,
        social_diagnosis=social_diagnosis or "",
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    result = generate_message(
        company_name="Кофейня Уют",
        niche="Общепит",
        pain_point="не ведётся",
        social_diagnosis="Последний пост был 45 дней назад, нет видеоконтента",
        vk_url="https://vk.com/kofeynauyt",
    )

    print("\n=== Первое сообщение ===")
    print(result.first_message)
    print(f"\nДлина: {result.char_count} символов")
    print("\n=== Follow-up ===")
    print(result.follow_up)
    print(f"\nИсточник: {result.generated_by}")
