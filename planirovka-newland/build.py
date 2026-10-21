"""Собирает код примерки для двух страниц Тильды из одного движка (block.html):

  КЛАССИК — дома 60, 85, 100, 120 м²  → tilda-block.html,       index.html
  СМАРТ   — дома из planirovki-3d     → tilda-block-smart.html, smart.html

Готовые файлы руками не правятся: после изменений запустите python3 build.py,
затем node minify.cjs — он сожмёт код и разделит его на блоки T123 (папки tilda/ и tilda-smart/).
"""
import json
from pathlib import Path
from plans import plans_json

here = Path(__file__).parent
src = (here / 'block.html').read_text(encoding='utf-8')
for mark in ('/*__PLANS__*/[]', '/*__CFG__*/{}'):
    assert src.count(mark) == 1, 'в block.html должна быть ровно одна метка ' + mark

SERIES = {
    'classic': ('tilda-block.html', 'index.html', {
        'series': 'КЛАССИК', 'head': 'Примерьте планировку',
        'sub': 'Выберите дом — расставьте мебель, подберите цвета и посмотрите интерьер в 3D.'}),
    'smart': ('tilda-block-smart.html', 'smart.html', {
        'series': 'СМАРТ', 'head': 'Дома СМАРТ: примерьте планировку',
        'sub': 'Выберите дом и вариант планировки — расставьте мебель, подберите цвета и посмотрите интерьер в 3D. Площадь указана вместе с террасой.'}),
}
for key, (block_name, page_name, cfg) in SERIES.items():
    block = src.replace('/*__PLANS__*/[]', plans_json(key)).replace('/*__CFG__*/{}', json.dumps(cfg, ensure_ascii=False))
    (here / block_name).write_text(block, encoding='utf-8')
    page = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Примерка планировки {cfg['series']} — Новая Земля</title>
<style>body{{margin:0;background:#E9EBF2}}</style>
</head>
<body>
{block}</body>
</html>
"""
    (here / page_name).write_text(page, encoding='utf-8')
    print('%s и %s собраны, %d КБ' % (block_name, page_name, len(block.encode('utf-8')) // 1024))
