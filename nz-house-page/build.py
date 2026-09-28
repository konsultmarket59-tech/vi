#!/usr/bin/env python3
"""Сборка лендингов домов «Новой Земли» для Тильды.

Источники:
  1. Выгрузка Tilda Store (CSV, разделитель «;») — название, описание, цена, фото, External ID.
  2. Таблица «Дома в продаже» (XLSX) — статус, готовность, фото по ссылкам.
Связь — по кадастровому номеру (SKU в CSV = «кадастровый номер» в XLSX).

На выходе:
  tilda/<External ID>.html    — код для блока T123 в Тильде
  preview/<External ID>.html  — то же с запасными фото (для просмотра вне Тильды)

Запуск:
  python3 build.py store.csv houses.xlsx               # все дома из CSV
  python3 build.py store.csv houses.xlsx --only jX2OkV9tzErRmKFLN0S0
"""
import argparse
import csv
import html
import json
import os
import re

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MAP = "https://nt.newland159.ru/index.php?lon=55.94764&lat=57.87664&zoom=12"
PHONE = "+7 950 474 07 07"


def strip_tags(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s)).replace("\xa0", " ").strip()


def parse_text(raw):
    """Раскладывает HTML-описание из Tilda Store на вступление и разделы.

    Заголовок раздела — строка целиком жирным, короткая, без точки в конце
    («Конструктив», «Инженерия», «Комплектации и цены»…).
    Пункт — «<strong>Ключ.</strong> значение» или просто текст.
    """
    s = re.sub(r"</?ul[^>]*>", "\n", raw)
    s = re.sub(r"<li[^>]*>", "\n", s)
    s = re.sub(r"</li>|<br\s*/?>", "\n", s)
    intro = {"lead": "", "paras": [], "items": []}
    sections, current = [], None
    for line in s.split("\n"):
        plain = strip_tags(line)
        if not plain:
            continue
        strongs = [strip_tags(x) for x in re.findall(r"<strong>(.*?)</strong>", line)]
        whole_bold = bool(strongs) and "".join(strongs).strip() == plain
        if whole_bold and len(plain) < 40 and not plain.endswith("."):
            current = {"title": plain.rstrip(":"), "items": []}
            sections.append(current)
            continue
        if whole_bold and current is None and not intro["lead"]:
            intro["lead"] = plain
            continue
        m = re.match(r"\s*<strong>(.*?)</strong>(.*)", line)
        if m and strip_tags(m.group(2)):
            item = {"k": strip_tags(m.group(1)).rstrip(". "), "v": strip_tags(m.group(2))}
        else:
            item = {"k": "", "v": plain}
        if current is None:
            if item["k"]:
                intro["items"].append(item)
            else:
                intro["paras"].append(item["v"])
        else:
            current["items"].append(item)
    return intro, sections


def parse_packages(items):
    out = []
    for it in items:
        head = it["k"] or it["v"]
        m = re.match(r"(.+?)\s+[—-]\s+([\d\s ]+)\s*₽\s*(.*)", head)
        if m:
            out.append({
                "name": m.group(1).strip(),
                "price": int(re.sub(r"\D", "", m.group(2))),
                "priceNote": m.group(3).strip().rstrip("."),
                "text": it["v"] if it["k"] else "",
            })
        else:
            out.append({"name": head, "price": 0, "priceNote": "", "text": it["v"] if it["k"] else ""})
    return out


def num(v):
    try:
        return float(str(v).replace(",", ".").replace(" ", ""))
    except (TypeError, ValueError):
        return None


def fmt_area(v):
    n = num(v)
    if n is None:
        return ""
    return str(int(n)) if n == int(n) else f"{n:g}".replace(".", ",")


def load_xlsx(path):
    wb = openpyxl.load_workbook(path)
    ws = wb["Дома в продаже"]
    by_cad = {}
    for row in ws.iter_rows(min_row=2):
        v = [c.value for c in row]
        if not v[2]:
            continue
        photos = [c.hyperlink.target for c in row[10:] if c.hyperlink and c.hyperlink.target]
        by_cad[str(v[2]).strip()] = {
            "status": (v[0] or "").strip(), "ready": (v[1] or "").strip(),
            "village": v[3], "street": v[4], "number": v[5],
            "plot": v[6], "area": v[7], "price": v[8], "desc": (v[9] or "").strip(), "photos": photos,
        }
    return by_cad


READY = {"готов": "Готов к заселению", "стройка": "Строится", "план": "В проекте"}


def build_house(row, x, data_date):
    intro, sections = parse_text(row["Text"])
    packages, terms, build = [], [], []
    for sec in sections:
        t = sec["title"].lower()
        if "комплектац" in t:
            packages = parse_packages(sec["items"])
        elif "услови" in t:
            terms = sec["items"]
        elif sec["items"]:
            build.append(sec)

    # готовый дом продаётся в конкретном виде — комплектации ему не показываем
    if (row.get("Mark") or "").strip() == "готов":
        packages = []

    village, _, address = row["Title"].partition(",")
    village, address = village.strip(), address.strip()
    area = row.get("Characteristics:площадь дома") or (x or {}).get("area") or ""
    plot = row.get("Characteristics:Площадь участка") or (x or {}).get("plot") or ""
    ready = (row.get("Mark") or (x or {}).get("ready") or "").strip()
    status = (x or {}).get("status", "")
    status_label = "В резерве" if status == "в резерве" else READY.get(ready, "В продаже")

    photos = [p for p in (row.get("Photo") or "").split() if p]
    for p in (x or {}).get("photos", []):
        if p not in photos:
            photos.append(p)

    sub_parts = [row.get("Description", "").strip()]
    if x and x.get("desc"):
        sub_parts.append(x["desc"])
    if plot:
        sub_parts.append(f"Участок {fmt_area(plot)} сот. входит в стоимость.")
    subtitle = " ".join(p for p in sub_parts if p)

    facts = [["Дом", f"{fmt_area(area)} м²"]]
    if plot:
        facts.append(["Участок", f"{fmt_area(plot)} сот."])
    facts.append(["Готовность", {"готов": "Готов", "стройка": "Стройка", "план": "Проект"}.get(ready, "—")])

    specs = [["Посёлок", village], ["Адрес", address], ["Площадь дома", f"{fmt_area(area)} м²"]]
    if plot:
        specs.append(["Участок", f"{fmt_area(plot)} сот."])
    specs += [["Состояние", status_label], ["Кадастровый номер", row["SKU"]]]

    return {
        "externalId": row["External ID"],
        "cadastral": row["SKU"],
        "title": row["Title"],
        "village": village,
        "address": address,
        "houseArea": fmt_area(area),
        "plotArea": fmt_area(plot),
        "price": int(float(row["Price"] or (x or {}).get("price") or 0)),
        "statusLabel": status_label,
        "subtitle": subtitle,
        "aboutTitle": f"Дом {fmt_area(area)} м² в посёлке «{village}»",
        "intro": intro,
        "facts": facts,
        "specs": specs,
        "packages": packages,
        "sections": build,
        "terms": terms,
        "photos": photos,
        "dataDate": data_date,
    }


def render(tpl, house, preview):
    js = lambda o: json.dumps(o, ensure_ascii=False, indent=2).replace("</", "<\\/")
    extra = []
    fallback = []
    if preview:
        extra = [{"type": "video", "src": "house-orbit-b.mp4", "poster": "assets/house-long.webp", "alt": "Облёт дома (пример вставленного видео)"}]
        fallback = [f"assets/{n}.webp" for n in ("house-wide", "house-2", "int-kitchen", "int-bedroom", "house-3", "house-long")]
    out = tpl
    out = out.replace("__TITLE_TAG__", f"<title>Дом {house['houseArea']} м², {house['address']}</title>\n" if preview else "")
    out = out.replace("__DRAW_IMG__", '          <img class="nzh-draw" src="assets/draw-house-1.png" alt="">\n' if preview else "")
    out = out.replace("__MAP_SRC__", DEFAULT_MAP)
    out = out.replace("__EXTRA_MEDIA__", js(extra) if extra else "[\n    /* сюда — свои фото и видео */\n  ]")
    out = out.replace("__HOUSE_JSON__", js(house))
    out = out.replace("__PREVIEW_FALLBACK__", js(fallback))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("xlsx")
    ap.add_argument("--only", help="External ID одного дома")
    a = ap.parse_args()

    m = re.search(r"(\d{4})(\d{2})(\d{2})\d{4}", os.path.basename(a.csv))
    data_date = f"{m.group(3)}.{m.group(2)}.{m.group(1)}" if m else ""
    xl = load_xlsx(a.xlsx)
    tpl = open(os.path.join(HERE, "template.html"), encoding="utf8").read()
    os.makedirs(os.path.join(HERE, "tilda"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "preview"), exist_ok=True)

    n = 0
    for row in csv.DictReader(open(a.csv, encoding="utf8"), delimiter=";"):
        if "Метраж дома" not in row["Category"]:
            continue  # участки без дома пропускаем
        if a.only and row["External ID"] != a.only:
            continue
        house = build_house(row, xl.get(row["SKU"].strip()), data_date)
        for folder, preview in (("tilda", False), ("preview", True)):
            with open(os.path.join(HERE, folder, house["externalId"] + ".html"), "w", encoding="utf8") as f:
                f.write(render(tpl, house, preview))
        n += 1
        print(f"{house['externalId']}  {house['title']}  фото: {len(house['photos'])}  "
              f"комплектаций: {len(house['packages'])}  разделов: {len(house['sections'])}")
    print(f"Готово: {n}")


if __name__ == "__main__":
    main()
