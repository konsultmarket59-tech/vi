"""Собирает index.html: подставляет планировки из plans.py в template.html.

    python3 build.py
"""
from pathlib import Path

from plans import plans_json

HERE = Path(__file__).parent
html = (HERE / 'template.html').read_text(encoding='utf-8')
assert '/*PLANS*/[]' in html
assert '/*NODES*/' in html
html = html.replace('/*NODES*/', (HERE / 'nodes.js').read_text(encoding='utf-8'))
(HERE / 'index.html').write_text(html.replace('/*PLANS*/[]', plans_json()), encoding='utf-8')
print('index.html собран')
