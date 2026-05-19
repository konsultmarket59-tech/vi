"""
pdf_generator.py — Генерация персонализированных PDF-КП для агентства "Динамика".
Использует reportlab для создания профессионального коммерческого предложения.
"""

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

PROPOSALS_DIR = Path(__file__).parent / "proposals"
PROPOSALS_DIR.mkdir(exist_ok=True)

# Цветовая схема агентства
COLOR_PRIMARY = (0.13, 0.35, 0.75)      # Синий #2159BF
COLOR_SECONDARY = (0.95, 0.95, 0.97)    # Светло-серый
COLOR_ACCENT = (0.07, 0.62, 0.47)       # Зелёный #13 9F78
COLOR_DARK = (0.12, 0.12, 0.18)         # Почти чёрный
COLOR_LIGHT = (1.0, 1.0, 1.0)           # Белый

AGENCY_NAME = "Динамика"
AGENCY_URL = "dynamicbrands.ru"
AGENCY_PHONE = "+7 (342) 204-60-85"
AGENCY_VK = "vk.me/dynamic_brands"
AGENCY_TG = "@Dynamic_brands_consultant_bot"
AGENCY_FOUNDER = "Виктория Ладыгина"

TARIFF_DETAILS = {
    "БАЗОВЫЙ": {
        "price": "от 43 600 ₽/мес",
        "min_contract": "мин. контракт 3 месяца",
        "description": "Системная работа с аудиторией: посты, сторис, аналитика. "
                       "Идеально для тех, кто только начинает выстраивать присутствие в соцсетях.",
    },
    "КОРОТКАЯ ВОРОНКА": {
        "price": "85 000 ₽/мес",
        "min_contract": "мин. контракт 2 месяца",
        "description": "Упор на охват и прямой призыв к действию. "
                       "Подходит для простого продукта с коротким циклом принятия решения.",
    },
    "ПРОГРЕВАЮЩАЯ ВОРОНКА": {
        "price": "120 000 ₽/мес",
        "min_contract": "мин. контракт 4 месяца",
        "description": "Многоступенчатый прогрев: экспертность → доверие → продажа. "
                       "Для сложных продуктов, услуг, недвижимости, B2B.",
    },
    "SEO-ВОРОНКА": {
        "price": "90 000 ₽/мес",
        "min_contract": "мин. контракт 6 месяцев",
        "description": "Контент под поисковые запросы, оптимизация площадок. "
                       "Долгосрочный органический трафик без рекламного бюджета.",
    },
}

CASES = {
    "СВЕРХУ": {
        "niche": "Спорт",
        "city": "Пермь",
        "metrics": [
            ("Виральность", "57,2%"),
            ("Охват публикаций", "3 961 чел."),
            ("ERview", "15,7%"),
            ("Рекламный бюджет", "0 ₽"),
        ],
        "description": (
            "Спортивный клуб без рекламного бюджета получил органический вирусный охват. "
            "Контент-стратегия сработала так, что аудитория сама делилась публикациями."
        ),
    },
    "БОЛДИНО LIFE": {
        "niche": "Девелопмент",
        "city": "Пермь",
        "metrics": [
            ("Формат", "Прогревающая воронка"),
            ("Период", "4 месяца"),
            ("Результат", "Рост заявок"),
        ],
        "description": (
            "Жилой комплекс с длинным циклом сделки. Контентная воронка провела "
            "аудиторию от первого касания до заявки через экспертный контент и прогрев доверия."
        ),
    },
}

PAIN_POINT_DESCRIPTIONS = {
    "нет присутствия": (
        "Компания не представлена в социальных сетях или ссылки на соцсети "
        "отсутствуют в открытых источниках. Потенциальные клиенты, которые "
        "ищут вас в ВКонтакте или Telegram, вас просто не находят."
    ),
    "не ведётся": (
        "Аккаунт в соцсетях есть, но публикации выходят редко или давно остановились. "
        "Неактивная страница создаёт впечатление, что бизнес закрылся — "
        "это отпугивает потенциальных клиентов."
    ),
    "без стратегии": (
        "Публикации выходят регулярно, но без системы: разный стиль, случайные темы, "
        "нет воронки. Аудитория не прогревается к покупке, контент не работает на продажи."
    ),
}


def _try_import_reportlab():
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
            HRFlowable, KeepTogether,
        )
        from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
        return True
    except ImportError:
        return False


def generate_proposal(
    company_name: str,
    niche: str,
    pain_point: str,
    recommended_tariff: str,
    social_diagnosis: str,
    reasoning: str,
    contact_phone: str = "",
    vk_url: str = "",
    roi_estimate: Optional[dict] = None,
    output_path: Optional[str] = None,
) -> Optional[str]:
    """
    Генерирует PDF-КП для компании.

    Args:
        company_name: Название компании
        niche: Ниша (например "Красота", "Общепит")
        pain_point: Основная боль (ключ из PAIN_POINT_DESCRIPTIONS)
        recommended_tariff: Тариф из TARIFF_DETAILS
        social_diagnosis: Текст диагноза для соцсетей (конкретные наблюдения)
        reasoning: Обоснование выбора тарифа (из qualifier)
        contact_phone: Телефон компании
        vk_url: URL ВКонтакте компании
        roi_estimate: Словарь с расчётом ROI (опционально)
        output_path: Путь для сохранения (если None — автоматически)

    Returns:
        Путь к созданному PDF или None при ошибке
    """
    if not _try_import_reportlab():
        logger.error(
            "reportlab не установлен. Установите: pip install reportlab"
        )
        return _generate_text_fallback(
            company_name, niche, pain_point, recommended_tariff,
            social_diagnosis, output_path,
        )

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, KeepTogether,
    )
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

    # --- Путь к файлу ---
    if output_path is None:
        safe_name = "".join(c for c in company_name if c.isalnum() or c in " _-")
        safe_name = safe_name.strip().replace(" ", "_")[:40]
        date_str = datetime.now().strftime("%Y%m%d")
        output_path = str(PROPOSALS_DIR / f"{safe_name}_{date_str}.pdf")

    # --- Стили ---
    normal_color = colors.Color(*COLOR_DARK)
    primary_color = colors.Color(*COLOR_PRIMARY)
    accent_color = colors.Color(*COLOR_ACCENT)
    light_color = colors.Color(*COLOR_LIGHT)
    secondary_color = colors.Color(*COLOR_SECONDARY)

    styles = getSampleStyleSheet()

    def make_style(name, parent="Normal", **kwargs):
        return ParagraphStyle(name, parent=styles[parent], **kwargs)

    style_h1 = make_style("H1", fontSize=24, leading=30, textColor=light_color,
                           fontName="Helvetica-Bold", spaceAfter=6)
    style_h2 = make_style("H2", fontSize=16, leading=22, textColor=primary_color,
                           fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=6)
    style_h3 = make_style("H3", fontSize=13, leading=18, textColor=primary_color,
                           fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4)
    style_body = make_style("Body", fontSize=11, leading=16, textColor=normal_color,
                             fontName="Helvetica", spaceAfter=8)
    style_small = make_style("Small", fontSize=9, leading=13, textColor=normal_color,
                              fontName="Helvetica")
    style_header_sub = make_style("HeaderSub", fontSize=13, leading=18,
                                   textColor=light_color, fontName="Helvetica")
    style_metric_val = make_style("MetricVal", fontSize=20, leading=24,
                                   textColor=primary_color, fontName="Helvetica-Bold",
                                   alignment=TA_CENTER)
    style_metric_lbl = make_style("MetricLbl", fontSize=9, leading=12,
                                   textColor=normal_color, fontName="Helvetica",
                                   alignment=TA_CENTER)
    style_footer = make_style("Footer", fontSize=9, leading=13,
                               textColor=colors.Color(0.5, 0.5, 0.5),
                               fontName="Helvetica", alignment=TA_CENTER)

    # --- Документ ---
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title=f"КП для {company_name} — агентство Динамика",
        author=AGENCY_FOUNDER,
    )

    story = []
    W = A4[0] - 4 * cm  # ширина контента

    def hr(color=primary_color, thickness=1):
        return HRFlowable(width="100%", thickness=thickness, color=color,
                          spaceAfter=8, spaceBefore=4)

    # =========================================================================
    # БЛОК 1 — Шапка (цветной прямоугольник с заголовком)
    # =========================================================================
    header_data = [[
        Paragraph(f"<b>{AGENCY_NAME}</b>", style_h1),
    ]]
    header_sub_data = [[
        Paragraph(
            f"Коммерческое предложение для компании<br/><b>{company_name}</b>",
            style_header_sub,
        ),
    ]]
    date_str_ru = datetime.now().strftime("%d.%m.%Y")
    header_right = [[
        Paragraph(
            f"Дата: {date_str_ru}<br/>{AGENCY_URL}",
            make_style("HR", fontSize=10, leading=14, textColor=light_color,
                       fontName="Helvetica", alignment=TA_RIGHT),
        ),
    ]]

    header_table = Table(
        [[
            Table(header_data + header_sub_data,
                  colWidths=[W * 0.65]),
            Table(header_right, colWidths=[W * 0.35]),
        ]],
        colWidths=[W * 0.65, W * 0.35],
    )
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), primary_color),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
        ("LEFTPADDING", (0, 0), (-1, -1), 16),
        ("RIGHTPADDING", (0, 0), (-1, -1), 16),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 0.5 * cm))

    # =========================================================================
    # БЛОК 2 — Диагноз
    # =========================================================================
    story.append(Paragraph("Что мы увидели", style_h2))
    story.append(hr())

    pain_desc = PAIN_POINT_DESCRIPTIONS.get(pain_point, social_diagnosis)
    diagnosis_text = social_diagnosis if social_diagnosis else pain_desc

    diag_box = Table(
        [[Paragraph(diagnosis_text, style_body)]],
        colWidths=[W],
    )
    diag_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), secondary_color),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("ROUNDEDCORNERS", [4]),
    ]))
    story.append(diag_box)
    story.append(Spacer(1, 0.3 * cm))

    pain_label_map = {
        "нет присутствия": "Проблема: нет присутствия в соцсетях",
        "не ведётся": "Проблема: аккаунт есть, но не ведётся",
        "без стратегии": "Проблема: ведение без стратегии",
    }
    pain_label = pain_label_map.get(pain_point, f"Проблема: {pain_point}")
    story.append(Paragraph(f"<b>{pain_label}</b>", style_body))

    # =========================================================================
    # БЛОК 3 — Рекомендованный тариф
    # =========================================================================
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Наше решение", style_h2))
    story.append(hr())

    tariff_info = TARIFF_DETAILS.get(recommended_tariff, TARIFF_DETAILS["БАЗОВЫЙ"])
    tariff_table = Table(
        [
            [Paragraph(f"<b>Тариф «{recommended_tariff}»</b>",
                       make_style("TariffH", fontSize=14, leading=18,
                                  textColor=light_color, fontName="Helvetica-Bold")),
             Paragraph(tariff_info["price"],
                       make_style("TariffP", fontSize=14, leading=18,
                                  textColor=light_color, fontName="Helvetica-Bold",
                                  alignment=TA_RIGHT))],
            [Paragraph(tariff_info["min_contract"],
                       make_style("TariffS", fontSize=10, leading=14,
                                  textColor=light_color, fontName="Helvetica")),
             Paragraph("", style_small)],
        ],
        colWidths=[W * 0.6, W * 0.4],
    )
    tariff_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), primary_color),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(tariff_table)
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(tariff_info["description"], style_body))

    if reasoning:
        story.append(Paragraph(f"<i>Почему этот тариф: {reasoning}</i>", style_small))

    # =========================================================================
    # БЛОК 4 — ROI-расчёт
    # =========================================================================
    if roi_estimate:
        story.append(Spacer(1, 0.3 * cm))
        story.append(Paragraph("Расчёт рентабельности", style_h2))
        story.append(hr())

        onboarding = roi_estimate.get("onboarding", 45000)
        monthly = roi_estimate.get("monthly_cost", 43600)
        months = roi_estimate.get("months", 3)
        total = onboarding + monthly * months
        expected_leads = roi_estimate.get("expected_leads", "10–30")
        cost_per_lead = roi_estimate.get("cost_per_lead", "3 000–5 000")

        metrics_data = [
            [
                _metric_cell(f"45 000 ₽", "Онбординг (разово)", style_metric_val, style_metric_lbl),
                _metric_cell(f"{monthly:,} ₽/мес".replace(",", " "), "Ежемесячный платёж",
                             style_metric_val, style_metric_lbl),
                _metric_cell(f"{total:,} ₽".replace(",", " "), f"Итого за {months} мес.",
                             style_metric_val, style_metric_lbl),
            ],
        ]
        metrics_table = Table(metrics_data, colWidths=[W / 3] * 3)
        metrics_table.setStyle(TableStyle([
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("BACKGROUND", (0, 0), (-1, -1), secondary_color),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(metrics_table)
        story.append(Spacer(1, 0.2 * cm))

        results_text = (
            f"За {months} месяца работы ожидаем: <b>{expected_leads} новых обращений</b> "
            f"из соцсетей. Ориентировочная стоимость одного обращения: "
            f"<b>{cost_per_lead} ₽</b> — против 5 000–15 000 ₽ за клик в контекстной рекламе."
        )
        story.append(Paragraph(results_text, style_body))

    # =========================================================================
    # БЛОК 5 — Кейсы
    # =========================================================================
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Наши результаты", style_h2))
    story.append(hr())

    relevant_case_key = "СВЕРХУ"
    if niche.lower() in ("девелопмент", "строительство", "недвижимость"):
        relevant_case_key = "БОЛДИНО LIFE"

    case = CASES[relevant_case_key]
    story.append(Paragraph(f"<b>Кейс: {relevant_case_key}</b> — {case['niche']}", style_h3))
    story.append(Paragraph(case["description"], style_body))

    case_metrics = [[
        _metric_cell(v, k, style_metric_val, style_metric_lbl)
        for k, v in case["metrics"]
    ]]
    case_table = Table(case_metrics, colWidths=[W / len(case["metrics"])] * len(case["metrics"]))
    case_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (-1, -1), secondary_color),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.85, 0.85, 0.85)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(case_table)

    # =========================================================================
    # БЛОК 6 — Контакты и CTA
    # =========================================================================
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph("Следующий шаг", style_h2))
    story.append(hr())

    cta_text = (
        f"Мы готовы провести <b>бесплатный разбор вашего аккаунта</b> и показать, "
        f"как именно будет работать SMM для <b>{company_name}</b>. "
        f"Свяжитесь с нами удобным способом:"
    )
    story.append(Paragraph(cta_text, style_body))

    contacts_data = [
        ["Основатель:", f"{AGENCY_FOUNDER}, маркетолог, 20+ лет опыта"],
        ["Телефон:", AGENCY_PHONE],
        ["ВКонтакте:", AGENCY_VK],
        ["Telegram:", AGENCY_TG],
        ["Сайт:", AGENCY_URL],
    ]
    contacts_table = Table(contacts_data, colWidths=[W * 0.25, W * 0.75])
    contacts_table.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("LEADING", (0, 0), (-1, -1), 15),
        ("TEXTCOLOR", (0, 0), (0, -1), primary_color),
        ("TEXTCOLOR", (1, 0), (1, -1), normal_color),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(contacts_table)

    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph(
        f"Агентство {AGENCY_NAME} · {AGENCY_URL} · {AGENCY_PHONE}",
        style_footer,
    ))

    # --- Сборка ---
    try:
        doc.build(story)
        logger.info("PDF-КП создан: %s", output_path)
        return output_path
    except Exception as exc:
        logger.error("Ошибка создания PDF: %s", exc)
        return None


def _metric_cell(value: str, label: str, val_style, lbl_style):
    """Вспомогательная ячейка метрики: большое значение + подпись снизу."""
    from reportlab.platypus import Table as T, Paragraph as P
    inner = T(
        [[P(value, val_style)], [P(label, lbl_style)]],
        colWidths=None,
    )
    inner.setStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")])
    return inner


def _generate_text_fallback(
    company_name: str,
    niche: str,
    pain_point: str,
    recommended_tariff: str,
    social_diagnosis: str,
    output_path: Optional[str],
) -> Optional[str]:
    """Сохраняет КП в текстовый файл если reportlab недоступен."""
    if output_path is None:
        safe_name = "".join(c for c in company_name if c.isalnum() or c in " _-")
        safe_name = safe_name.strip().replace(" ", "_")[:40]
        output_path = str(PROPOSALS_DIR / f"{safe_name}_proposal.txt")

    tariff_info = TARIFF_DETAILS.get(recommended_tariff, TARIFF_DETAILS["БАЗОВЫЙ"])
    content = f"""
КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ
Агентство «{AGENCY_NAME}» для компании «{company_name}»
Дата: {datetime.now().strftime('%d.%m.%Y')}
{'='*60}

ЧТО МЫ УВИДЕЛИ:
{social_diagnosis or PAIN_POINT_DESCRIPTIONS.get(pain_point, '')}

НАШЕ РЕШЕНИЕ:
Тариф «{recommended_tariff}»
Стоимость: {tariff_info['price']}
{tariff_info['min_contract']}
{tariff_info['description']}

КЕЙС: СВЕРХУ (Спорт, Пермь)
Виральность 57,2% | Охват 3 961 чел. | ERview 15,7% | Бюджет 0 ₽

КОНТАКТЫ:
{AGENCY_FOUNDER}, агентство {AGENCY_NAME}
Телефон: {AGENCY_PHONE}
ВКонтакте: {AGENCY_VK}
Telegram: {AGENCY_TG}
Сайт: {AGENCY_URL}
""".strip()

    try:
        Path(output_path).write_text(content, encoding="utf-8")
        logger.info("Текстовое КП создано: %s", output_path)
        return output_path
    except Exception as exc:
        logger.error("Ошибка создания текстового КП: %s", exc)
        return None
