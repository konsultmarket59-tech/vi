"""
pdf_generator.py — PDF коммерческого предложения агентства "Динамика".
Фирменный стиль: Lato, малиновые акценты, структурные таблицы этапов.
"""

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Пути к активам (рядом с этим файлом)
# ---------------------------------------------------------------------------
_ASSETS = Path(__file__).parent / "assets"
_LOGO   = str(_ASSETS / "logo_svg.png")
_FONT_R = str(_ASSETS / "Lato-Regular.ttf")
_FONT_B = str(_ASSETS / "Lato-Bold.ttf")
_FONT_I = str(_ASSETS / "Lato-Italic.ttf")

# Имена зарегистрированных шрифтов (заполняются при инициализации)
_FR = "Helvetica"
_FB = "Helvetica-Bold"
_FI = "Helvetica-Oblique"


def _register_fonts() -> tuple:
    """Регистрирует Lato; возвращает (regular, bold, italic)."""
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        if Path(_FONT_R).exists() and Path(_FONT_B).exists():
            pdfmetrics.registerFont(TTFont("Lato", _FONT_R))
            pdfmetrics.registerFont(TTFont("Lato-Bold", _FONT_B))
            if Path(_FONT_I).exists():
                pdfmetrics.registerFont(TTFont("Lato-Italic", _FONT_I))
                return "Lato", "Lato-Bold", "Lato-Italic"
            return "Lato", "Lato-Bold", "Lato"
    except Exception as exc:
        logger.warning("Не удалось зарегистрировать Lato: %s", exc)
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


_FR, _FB, _FI = _register_fonts()

PROPOSALS_DIR = Path(__file__).parent / "proposals"
PROPOSALS_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Цвета фирменного стиля
# ---------------------------------------------------------------------------
RASP   = "#FE3268"  # малиновый — заголовки, разделители, итого
DARK   = "#1A1A18"  # основной текст
MUTED  = "#6B6A66"  # серый — описания, контакты
LIGHT  = "#F7F6F2"  # светло-серый — фон строк итого, шапки таблиц
BORD   = "#E8E7E3"  # линии таблиц
BLUE   = "#185FA5"  # синий — суммы в таблицах

# Фоны секций этапов
BG_BLUE_LIGHT  = "#EBF4FD"  # онбординг / старт
TEXT_BLUE      = "#185FA5"
BG_GREEN_LIGHT = "#EAF3DE"  # основное ведение
TEXT_GREEN     = "#27500A"
BG_GRAY_LIGHT  = "#F2F2F0"  # системное ведение
TOTBG          = "#FEE8EF"  # финальная строка сводки

# ---------------------------------------------------------------------------
# Реквизиты агентства
# ---------------------------------------------------------------------------
AGENCY_NAME    = "Динамика"
AGENCY_URL     = "dynamicbrands.ru"
AGENCY_PHONE   = "+7 (342) 204-60-85, +7 922 645-00-40"
AGENCY_TG      = "t.me/Dynamic_brands_consultant_bot"
AGENCY_VK      = "vk.me/dynamic_brands"
AGENCY_FOUNDER = "ИП Ладыгина В.А."
AGENCY_CITY    = "Пермь"

# ---------------------------------------------------------------------------
# Тарифы: состав услуг по умолчанию для каждого тарифа
# ---------------------------------------------------------------------------
# Каждая строка: (название, описание, кол-во, цена/ед, итого)
# Итого "" или "—" → "—"; "вкл." → "вкл."; иначе выводим жирным синим
TARIFF_SERVICES = {
    "БАЗОВЫЙ": {
        "monthly": 43_600,
        "months": 3,
        "services": [
            ("Контент-план на месяц",
             "Структура воронки: охват → доверие → продажа. Темы постов и сторис.",
             "1 шт", "вкл.", ""),
            ("Посты текст+фото",
             "Регулярные публикации, визуальный стиль, аудитория.",
             "16 шт", "1 400", "22 400"),
            ("Размещение готового контента клиента",
             "Адаптация и публикация материалов заказчика на платформах.",
             "10 шт", "600", "6 000"),
            ("Оформление страниц соцсетей",
             "Обложки, аватары, описания, закреплённые посты.",
             "1 шт", "вкл.", ""),
            ("Аналитика + отчёт",
             "Охваты, ER, динамика, лучшие форматы, рекомендации.",
             "1 шт", "вкл.", ""),
        ],
    },
    "КОРОТКАЯ ВОРОНКА": {
        "monthly": 85_000,
        "months": 2,
        "services": [
            ("Контент-план + воронка быстрых продаж",
             "Охват → прогрев → призыв к действию. Прямые продающие форматы.",
             "1 шт", "вкл.", ""),
            ("Посты текст+фото",
             "Продающий контент, кейсы, отзывы, закрытие возражений.",
             "12 шт", "1 400", "16 800"),
            ("Рилсы реальные (съёмка+монтаж+SEO)",
             "Сценарий, монтаж, титры, обложка, SEO-теги.",
             "6 шт", "8 000", "48 000"),
            ("Аналитика + отчёт",
             "Охваты, ER, стоимость лида, рекомендации.",
             "1 шт", "вкл.", ""),
        ],
    },
    "ПРОГРЕВАЮЩАЯ ВОРОНКА": {
        "monthly": 120_000,
        "months": 4,
        "services": [
            ("Контент-план + воронка прогрева",
             "Экспертность → доверие → продажа. CJM на 4 месяца.",
             "1 шт", "вкл.", ""),
            ("Посты текст+фото",
             "Экспертный контент, прогрев, история бренда, кейсы.",
             "10 шт", "1 400", "14 000"),
            ("Рилсы реальные (съёмка+монтаж+SEO)",
             "Сценарий, монтаж, титры, обложка.",
             "8 шт", "8 000", "64 000"),
            ("Выездные съёмки",
             "1–2 выезда в месяц. Фото и видео для контента.",
             "1 выезд", "8 000", "8 000"),
            ("Аналитика + отчёт",
             "Охваты, ER, динамика воронки, рекомендации.",
             "1 шт", "вкл.", ""),
        ],
    },
    "SEO-ВОРОНКА": {
        "monthly": 90_000,
        "months": 6,
        "services": [
            ("Контент-план + SEO-стратегия",
             "Поисковые запросы, оптимизация площадок, семантическое ядро.",
             "1 шт", "вкл.", ""),
            ("SEO-статьи",
             "Контент под поисковые запросы, полезные материалы.",
             "12 шт", "2 500", "30 000"),
            ("Посты текст+фото",
             "Регулярные публикации в соцсетях, поддержка аудитории.",
             "16 шт", "1 400", "22 400"),
            ("Аналитика + отчёт",
             "Позиции, трафик, ER, динамика роста, рекомендации.",
             "1 шт", "вкл.", ""),
        ],
    },
}
TARIFF_SERVICES["Старт"]  = TARIFF_SERVICES["БАЗОВЫЙ"]
TARIFF_SERVICES["Бизнес"] = TARIFF_SERVICES["КОРОТКАЯ ВОРОНКА"]

# Теги платформ и форматов по нише
NICHE_TAGS = {
    "красота":       "ВКонтакте · Telegram · Рилсы · Посты · Сторис",
    "фитнес":        "ВКонтакте · Telegram · Рилсы · Посты · Сторис",
    "медицина":      "ВКонтакте · Telegram · Экспертный контент · Посты",
    "общепит":       "ВКонтакте · Telegram · Рилсы · Посты · Фотосъёмка",
    "образование":   "ВКонтакте · Telegram · Экспертный контент · Посты",
    "строительство": "ВКонтакте · Telegram · Кейсы · Видео · Посты",
    "интерьер":      "ВКонтакте · Telegram · Рилсы · Посты · Фотосъёмка",
    "мебель":        "ВКонтакте · Telegram · Каталог · Посты · Фотосъёмка",
}


def _try_import_reportlab() -> bool:
    try:
        from reportlab.lib.pagesizes import A4  # noqa
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
    intro_text: str = "",
) -> Optional[str]:
    """Генерирует PDF коммерческого предложения в фирменном стиле агентства."""
    if not _try_import_reportlab():
        logger.error("reportlab не установлен. pip install reportlab")
        return _text_fallback(company_name, recommended_tariff, output_path)

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
        HRFlowable, Image,
    )

    # Путь к файлу
    if output_path is None:
        safe = "".join(c for c in company_name if c.isalnum() or c in " _-")
        safe = safe.strip().replace(" ", "_")[:40]
        output_path = str(PROPOSALS_DIR / f"{safe}_{datetime.now().strftime('%Y%m%d')}.pdf")

    # Цвета
    c_rasp  = colors.HexColor(RASP)
    c_dark  = colors.HexColor(DARK)
    c_muted = colors.HexColor(MUTED)
    c_light = colors.HexColor(LIGHT)
    c_bord  = colors.HexColor(BORD)
    c_blue  = colors.HexColor(BLUE)

    c_bg_blue  = colors.HexColor(BG_BLUE_LIGHT)
    c_txt_blue = colors.HexColor(TEXT_BLUE)
    c_bg_green = colors.HexColor(BG_GREEN_LIGHT)
    c_txt_green = colors.HexColor(TEXT_GREEN)
    c_bg_gray  = colors.HexColor(BG_GRAY_LIGHT)
    c_totbg    = colors.HexColor(TOTBG)

    # Разметка страницы
    LEFT_M = RIGHT_M = 20 * mm
    TOP_M = BOT_M = 16 * mm
    W_CONTENT = A4[0] - LEFT_M - RIGHT_M  # ~170 mm
    COL_W = [96 * mm, 20 * mm, 24 * mm, 30 * mm]

    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=LEFT_M, rightMargin=RIGHT_M,
        topMargin=TOP_M, bottomMargin=BOT_M,
        title=f"КП для {company_name} — агентство Динамика",
        author="Агентство Динамика",
    )

    # Стиль-фабрика
    def S(name, fn=_FR, fs=10, tc=None, lead=None, align=TA_LEFT, **kw):
        return ParagraphStyle(
            name, fontName=fn, fontSize=fs,
            textColor=tc if tc is not None else c_dark,
            leading=lead if lead is not None else round(fs * 1.45),
            alignment=align, **kw,
        )

    sRightContact = S("RC", fn=_FR, fs=8, tc=c_muted, align=TA_RIGHT, lead=13)
    sTitle        = S("TT", fn=_FB, fs=26, tc=c_rasp, lead=32, spaceAfter=4)
    sSubtitle     = S("ST", fn=_FB, fs=13, tc=c_dark, lead=18, spaceAfter=2)
    sTags         = S("TG", fn=_FR, fs=10, tc=c_muted, lead=15, spaceAfter=4)
    sBody         = S("BO", fn=_FR, fs=10, tc=c_dark, lead=15, spaceAfter=6)
    sItalic       = S("IT", fn=_FI, fs=9, tc=c_muted, lead=13)
    sMinContract  = S("MC", fn=_FI, fs=9, tc=c_dark, lead=13, spaceAfter=10)

    sSectLbl      = S("SL", fn=_FB, fs=10, lead=14)    # текст в метке секции
    sColHead      = S("CH", fn=_FB, fs=9, tc=c_muted, lead=13)
    sSvcName      = S("SN", fn=_FB, fs=10, tc=c_dark, lead=14)
    sSvcDesc      = S("SD", fn=_FR, fs=8,  tc=c_muted, lead=12)
    sQty          = S("QT", fn=_FR, fs=9,  tc=c_dark, lead=13, align=TA_CENTER)
    sUnitP        = S("UP", fn=_FR, fs=9,  tc=c_muted, lead=13, align=TA_RIGHT)
    sTotVal       = S("TV", fn=_FB, fs=10, tc=c_blue, lead=14, align=TA_RIGHT)
    sTotDash      = S("TD", fn=_FR, fs=9,  tc=c_muted, lead=13, align=TA_RIGHT)

    sPhaseTotLbl  = S("PTL", fn=_FB, fs=10, tc=c_dark, lead=14)
    sPhaseTotSum  = S("PTS", fn=_FB, fs=11, tc=c_rasp, lead=15, align=TA_RIGHT)

    sSumHead      = S("SH",  fn=_FB, fs=13, tc=c_dark, lead=18, spaceBefore=8)
    sSumLbl       = S("SuL", fn=_FR, fs=10, tc=c_dark, lead=15)
    sSumLblB      = S("SuLB",fn=_FB, fs=11, tc=c_dark, lead=16)
    sSumPrc       = S("SuP", fn=_FB, fs=11, tc=c_rasp, lead=16, align=TA_RIGHT)
    sSumPrcBig    = S("SuPB",fn=_FB, fs=14, tc=c_rasp, lead=19, align=TA_RIGHT)

    sFootTitle    = S("FT", fn=_FB, fs=10, tc=c_dark, lead=14, spaceAfter=4)
    sFootBold     = S("FB", fn=_FB, fs=10, tc=c_dark, lead=14)
    sFootBody     = S("FBo",fn=_FR, fs=9,  tc=c_muted, lead=13)
    sFootCTA      = S("FC", fn=_FB, fs=11, tc=c_rasp, lead=15)
    sFootCTASub   = S("FCS",fn=_FI, fs=9,  tc=c_muted, lead=13)

    story = []

    # ── Вспомогательные функции ───────────────────────────────────────────────

    def hr_rasp(thick=1.5):
        return HRFlowable(width="100%", thickness=thick, color=c_rasp,
                          spaceAfter=10, spaceBefore=6)

    def hr_light(thick=0.5):
        return HRFlowable(width="100%", thickness=thick, color=c_bord,
                          spaceAfter=4, spaceBefore=2)

    def _pad(t, top=0, bot=0, left=0, right=0):
        t.setStyle(TableStyle([
            ("TOPPADDING",    (0, 0), (-1, -1), top),
            ("BOTTOMPADDING", (0, 0), (-1, -1), bot),
            ("LEFTPADDING",   (0, 0), (-1, -1), left),
            ("RIGHTPADDING",  (0, 0), (-1, -1), right),
        ]))
        return t

    # ── Шапка ─────────────────────────────────────────────────────────────────
    logo_elem = None
    if Path(_LOGO).exists():
        try:
            logo_h = 52 * mm * 116 / 365
            logo_elem = Image(_LOGO, width=52 * mm, height=logo_h)
        except Exception:
            logo_elem = None
    if logo_elem is None:
        logo_elem = Paragraph(f"<b>{AGENCY_NAME}</b>",
                              S("LF", fn=_FB, fs=16, tc=c_rasp, lead=20))

    contacts_para = Paragraph(
        f"{AGENCY_URL}<br/>{AGENCY_PHONE}<br/>{AGENCY_TG}",
        sRightContact,
    )
    hdr = _pad(
        Table([[logo_elem, contacts_para]],
              colWidths=[80 * mm, W_CONTENT - 80 * mm]),
        top=0, bot=0, left=0, right=0,
    )
    hdr.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 6))
    story.append(hr_rasp(thick=2))
    story.append(Spacer(1, 8))

    # ── Заголовок КП ──────────────────────────────────────────────────────────
    story.append(Paragraph("Коммерческое предложение", sTitle))
    story.append(Paragraph(f"{company_name} · {niche}", sSubtitle))

    tags = NICHE_TAGS.get(niche.lower(), "ВКонтакте · Telegram · Посты · Контент")
    story.append(Paragraph(tags, sTags))
    story.append(Spacer(1, 6))

    # ── Персональное вступление ────────────────────────────────────────────────
    intro_source = intro_text or social_diagnosis or ""
    if intro_source:
        # Каждый абзац вступления — отдельный Paragraph
        for para in intro_source.split("\n\n"):
            para = para.strip()
            if para:
                # Последний абзац (переход к ценам) — курсив
                if para == intro_source.split("\n\n")[-1].strip():
                    story.append(Paragraph(para, sItalic))
                else:
                    story.append(Paragraph(para, sBody))
        story.append(Spacer(1, 8))

    tariff_info = TARIFF_SERVICES.get(recommended_tariff, TARIFF_SERVICES["БАЗОВЫЙ"])
    months = tariff_info.get("months", 3)
    monthly = tariff_info.get("monthly", 43_600)

    # ── Секция-фабрика ────────────────────────────────────────────────────────

    def phase_block(label: str, price_label: str,
                    rows: list,
                    bg_sect, tc_sect,
                    phase_total_label: str, phase_total_price: str,
                    note: str = ""):
        """Строит блок одного этапа: цветная плашка + колонки + строки + итог."""
        elems = []

        # Цветная плашка
        lbl_s = ParagraphStyle("SL2", fontName=_FB, fontSize=10,
                                textColor=tc_sect, leading=14)
        prc_s = ParagraphStyle("SP2", fontName=_FB, fontSize=10,
                                textColor=tc_sect, leading=14, alignment=TA_RIGHT)
        sect_t = Table(
            [[Paragraph(label, lbl_s), Paragraph(price_label, prc_s)]],
            colWidths=[W_CONTENT * 0.65, W_CONTENT * 0.35],
        )
        sect_t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), bg_sect),
            ("TOPPADDING",    (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elems.append(sect_t)

        # Заголовки колонок
        col_hdr = Table(
            [[Paragraph("Услуга / описание", sColHead),
              Paragraph("Кол-во", sColHead),
              Paragraph("Цена/ед", sColHead),
              Paragraph("Итого", sColHead)]],
            colWidths=COL_W,
        )
        col_hdr.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), c_light),
            ("TOPPADDING",    (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING",   (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
            ("LINEBELOW",     (0, 0), (-1, -1), 0.5, c_bord),
        ]))
        elems.append(col_hdr)

        # Строки услуг
        for name, desc, qty, unit, total in rows:
            if total and total not in ("", "—"):
                tot_p = Paragraph(f"{total} ₽", sTotVal)
            else:
                tot_p = Paragraph("—" if total != "вкл." else "вкл.", sTotDash)

            unit_p = Paragraph(unit if unit else "—", sUnitP)
            qty_p  = Paragraph(qty, sQty)

            name_cell = _pad(
                Table([[Paragraph(name, sSvcName)],
                        [Paragraph(desc, sSvcDesc)]],
                       colWidths=[COL_W[0] - 12]),
                top=0, bot=0, left=0, right=0,
            )
            row_t = Table(
                [[name_cell, qty_p, unit_p, tot_p]],
                colWidths=COL_W,
            )
            row_t.setStyle(TableStyle([
                ("TOPPADDING",    (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LEFTPADDING",   (0, 0), (-1, -1), 6),
                ("RIGHTPADDING",  (0, 0), (-1, -1), 6),
                ("LINEBELOW",     (0, 0), (-1, -1), 0.3, c_bord),
                ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ]))
            elems.append(row_t)

        # Строка итога этапа
        tot_t = Table(
            [[Paragraph(phase_total_label, sPhaseTotLbl),
              Paragraph(phase_total_price, sPhaseTotSum)]],
            colWidths=[W_CONTENT * 0.65, W_CONTENT * 0.35],
        )
        tot_t.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), c_light),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING",   (0, 0), (-1, -1), 8),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]))
        elems.append(tot_t)

        if note:
            elems.append(Paragraph(note, sItalic))

        elems.append(Spacer(1, 14))
        return elems

    # ── Этап 0: Онбординг + дизайн-система ───────────────────────────────────
    onb_rows = [
        ("Онбординг — стратегическая база",
         "Анализ ЦА, CJM, стратегия SMM, архитектура воронки, KPI. "
         "Опционально: можно не проводить, если заказчик предоставляет "
         "готовые материалы — платформу бренда, анализ ЦА, стратегию.",
         "1 шт", "—", "45 000"),
        ("Дизайн-система",
         "Визуал для соцсетей, шаблоны постов и сторис, обложки, аватары, "
         "фирменный стиль контента. Опционально: не разрабатывается, "
         "если заказчик предоставляет готовый брендбук.",
         "1 шт", "—", "25 000"),
    ]
    story.extend(phase_block(
        label="Онбординг + дизайн-система",
        price_label="до 70 000 ₽",
        rows=onb_rows,
        bg_sect=c_bg_blue, tc_sect=c_txt_blue,
        phase_total_label="Месяц 0 — стоимость",
        phase_total_price="до 70 000 ₽",
        note="* Оба этапа опциональны при наличии материалов со стороны заказчика.",
    ))

    # ── Этап 1+: Ежемесячное ведение ─────────────────────────────────────────
    svc_rows = tariff_info.get("services", [])
    story.extend(phase_block(
        label=f"Ежемесячное ведение — тариф «{recommended_tariff}»",
        price_label=f"{monthly:,} ₽/мес".replace(",", " "),
        rows=svc_rows,
        bg_sect=c_bg_green, tc_sect=c_txt_green,
        phase_total_label="Ежемесячная стоимость",
        phase_total_price=f"{monthly:,} ₽/мес".replace(",", " "),
        note=f"* Минимальный контракт — {months} месяца.",
    ))

    # ── Итоговая стоимость ────────────────────────────────────────────────────
    story.append(Paragraph("Итоговая стоимость", sSumHead))
    story.append(Spacer(1, 6))

    def sum_row(label: str, price: str, highlight: bool = False):
        lbl_s = sSumLblB if highlight else sSumLbl
        prc_s = sSumPrcBig if highlight else sSumPrc
        bg = c_totbg if highlight else colors.white
        t = Table(
            [[Paragraph(label, lbl_s), Paragraph(price, prc_s)]],
            colWidths=[W_CONTENT * 0.65, W_CONTENT * 0.35],
        )
        ts = [
            ("BACKGROUND",    (0, 0), (-1, -1), bg),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING",   (0, 0), (-1, -1), 0),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
            ("LINEBELOW",     (0, 0), (-1, -1), 0.5, c_bord),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ]
        if highlight:
            ts.append(("LINEABOVE", (0, 0), (-1, -1), 1.5, c_rasp))
        t.setStyle(TableStyle(ts))
        return t

    story.append(sum_row("Месяц 0 — онбординг + дизайн-система", "до 70 000 ₽"))
    story.append(sum_row(
        f"Месяц 1 — размещение + запуск ведения",
        f"{monthly:,} ₽".replace(",", " "),
    ))
    story.append(sum_row(
        f"Месяц 2–{months} — системное ведение",
        f"{monthly:,} ₽/мес".replace(",", " "),
    ))
    story.append(sum_row(
        f"Месяц {months}+ — системное ведение",
        f"{monthly:,} ₽/мес".replace(",", " "),
        highlight=True,
    ))

    story.append(Spacer(1, 4))
    note_txt = (
        f"* Месяц 0 опционален: если заказчик предоставляет брендбук, "
        f"стратегию и анализ ЦА — этот этап пропускается.<br/>"
        f"Минимальный контракт — {months} месяца."
    )
    story.append(Paragraph(note_txt, sItalic))

    if reasoning:
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<i>{reasoning}</i>", sItalic))

    story.append(Spacer(1, 16))
    story.append(hr_rasp(thick=2))

    # ── Контакты ──────────────────────────────────────────────────────────────
    story.append(Spacer(1, 8))
    story.append(Paragraph("Свяжитесь с нами", sFootTitle))

    col1 = _pad(
        Table([
            [Paragraph(f"Агентство {AGENCY_NAME}", sFootBold)],
            [Paragraph(AGENCY_FOUNDER, sFootBody)],
            [Paragraph(f"{AGENCY_CITY} · {AGENCY_URL}", sFootBody)],
        ], colWidths=[W_CONTENT * 0.33]),
        top=2, bot=2, left=0, right=0,
    )
    col2 = _pad(
        Table([
            [Paragraph(AGENCY_PHONE, sFootBold)],
            [Paragraph(AGENCY_TG, sFootBody)],
            [Paragraph(AGENCY_VK, sFootBody)],
        ], colWidths=[W_CONTENT * 0.37]),
        top=2, bot=2, left=0, right=0,
    )
    col3 = _pad(
        Table([
            [Paragraph("Обсудить проект →", sFootCTA)],
            [Paragraph("Ответим в течение часа", sFootCTASub)],
        ], colWidths=[W_CONTENT * 0.30]),
        top=2, bot=2, left=0, right=0,
    )

    footer_t = Table([[col1, col2, col3]],
                     colWidths=[W_CONTENT * 0.33,
                                W_CONTENT * 0.37,
                                W_CONTENT * 0.30])
    footer_t.setStyle(TableStyle([
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",    (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING",   (0, 0), (-1, -1), 0),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 0),
    ]))
    story.append(footer_t)

    # ── Сборка ────────────────────────────────────────────────────────────────
    try:
        doc.build(story)
        logger.info("PDF создан: %s", output_path)
        return output_path
    except Exception as exc:
        logger.error("Ошибка создания PDF: %s", exc, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Текстовый fallback (если reportlab не установлен)
# ---------------------------------------------------------------------------

def _text_fallback(
    company_name: str,
    recommended_tariff: str,
    output_path: Optional[str],
) -> Optional[str]:
    if output_path is None:
        safe = "".join(c for c in company_name if c.isalnum() or c in " _-")
        output_path = str(PROPOSALS_DIR / f"{safe.strip().replace(' ','_')[:40]}_proposal.txt")

    tariff = TARIFF_SERVICES.get(recommended_tariff, TARIFF_SERVICES["БАЗОВЫЙ"])
    content = (
        f"КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ\n"
        f"Агентство «{AGENCY_NAME}» для «{company_name}»\n"
        f"Дата: {datetime.now().strftime('%d.%m.%Y')}\n"
        f"{'='*60}\n\n"
        f"Тариф «{recommended_tariff}»: {tariff['monthly']:,} ₽/мес\n"
        f"Минимальный контракт: {tariff.get('months', 3)} месяца\n\n"
        f"Контакты:\nАгентство {AGENCY_NAME} · {AGENCY_FOUNDER}\n"
        f"{AGENCY_PHONE}\n{AGENCY_TG}\n{AGENCY_VK}\n{AGENCY_URL}\n"
    )
    try:
        Path(output_path).write_text(content, encoding="utf-8")
        logger.info("Текстовое КП: %s", output_path)
        return output_path
    except Exception as exc:
        logger.error("Ошибка текстового КП: %s", exc)
        return None
