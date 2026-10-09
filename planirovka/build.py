"""Собирает index.html (отдельная страница) из tilda-block.html (блок для Тильды)."""
from pathlib import Path
here = Path(__file__).parent
block = (here / 'tilda-block.html').read_text(encoding='utf-8')
page = f"""<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Дом серии СМАРТ — свободная планировка</title>
<style>body{{margin:0;background:#eef0ec}}</style>
</head>
<body>
{block}</body>
</html>
"""
(here / 'index.html').write_text(page, encoding='utf-8')
print('index.html собран')
