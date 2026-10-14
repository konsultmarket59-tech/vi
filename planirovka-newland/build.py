"""Собирает tilda-block.html (код для Тильды) и index.html (отдельная страница).

Исходники: block.html — разметка, стили и скрипт; plans.py — планировки.
Готовые файлы руками не правятся: после любых изменений запустите python3 build.py.
"""
from pathlib import Path
from plans import plans_json

here = Path(__file__).parent
src = (here / 'block.html').read_text(encoding='utf-8')
mark = '/*__PLANS__*/[]'
assert src.count(mark) == 1, 'в block.html должна быть ровно одна метка ' + mark
block = src.replace(mark, plans_json())
(here / 'tilda-block.html').write_text(block, encoding='utf-8')
page = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Примерка планировки — Новая Земля</title>
<style>body{{margin:0;background:#E9EBF2}}</style>
</head>
<body>
{block}</body>
</html>
"""
(here / 'index.html').write_text(page, encoding='utf-8')
print('tilda-block.html и index.html собраны, %d КБ' % (len(block.encode('utf-8')) // 1024))
