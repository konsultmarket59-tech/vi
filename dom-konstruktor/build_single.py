#!/usr/bin/env python3
"""Собирает конструктор в один HTML-файл: все скрипты внутри, three.js и шрифты — с CDN.
Файл открывается двойным щелчком, без сервера (заявки и проекты в этом режиме сохраняются файлом).

    python3 build_single.py [выходной.html]
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def build() -> str:
    html = (ROOT / 'index.html').read_text(encoding='utf-8')

    def inline(m):
        src = (ROOT / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
        return '<script>\n' + src + '\n</script>'

    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    # файл без сервера: шрифты — с Google Fonts, three.js и jsPDF — с CDN (запасные адреса в коде)
    # токены бренда — внутрь файла, шрифты Manrope и Inter — с Google Fonts; логотип и иконки сайта — data:-адресами
    import base64
    ld = re.sub(r'@font-face\s*\{[^}]*\}', '', (ROOT / 'brand' / 'ld.css').read_text(encoding='utf-8'))
    html = html.replace('<link rel="stylesheet" href="brand/ld.css">', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap">\n<style>' + ld + '</style>')
    for f, t in [('brand/logo-horizontal.svg', 'image/svg+xml'), ('brand/favicon-32.png', 'image/png'), ('brand/apple-touch-icon.png', 'image/png'), ('brand/mark.png', 'image/png'), ('brand/img/hero-house.jpg', 'image/jpeg')]:
        html = html.replace('"' + f + '"', '"data:' + t + ';base64,' + base64.b64encode((ROOT / f).read_bytes()).decode() + '"')
    return html


if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'dist' / 'konstruktor-doma.html')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding='utf-8')
    print(out, out.stat().st_size, 'байт')
