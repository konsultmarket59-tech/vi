#!/usr/bin/env python3
"""
Синхронизация цен: скачивает xlsx с Яндекс.Диска → парсит → записывает prices.json.
Запускается GitHub Action ежедневно.

Запуск вручную:
  YANDEX_DISK_TOKEN=<tok> python3 calculator/sync_prices.py
"""
import os, sys, json, io, tempfile
import urllib.request, urllib.error

TOKEN  = os.environ.get('YANDEX_DISK_TOKEN', '')
FOLDER = os.environ.get('YANDEX_DISK_CALC_FOLDER', 'Калькулятор_ИндивиДом')
API    = 'https://cloud-api.yandex.net/v1/disk'
OUT    = os.path.join(os.path.dirname(__file__), 'prices.json')

if not TOKEN:
    print("ERROR: YANDEX_DISK_TOKEN не задан — используется prices.json из репо")
    sys.exit(0)   # soft exit, keep existing prices.json

def ya_get(path, **params):
    url = f'{API}/{path}'
    if params:
        url += '?' + '&'.join(f'{k}={urllib.parse.quote(str(v))}' for k,v in params.items())
    req = urllib.request.Request(url, headers={'Authorization': f'OAuth {TOKEN}'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'error': str(e)}

import urllib.parse

# 1. Get download URL
remote = f'disk:/{FOLDER}/цены-материалов.xlsx'
print(f"Получение URL для скачивания {remote}...")
res = ya_get('resources/download', path=remote)
if 'error' in res:
    print(f"ERROR: {res}"); sys.exit(1)
dl_url = res['href']

# 2. Download file
print("Скачивание файла...")
req = urllib.request.Request(dl_url, headers={'Authorization': f'OAuth {TOKEN}'})
with urllib.request.urlopen(dl_url) as r:
    data = r.read()
print(f"Загружено {len(data):,} байт")

# 3. Parse with openpyxl
try:
    import openpyxl
except ImportError:
    os.system("pip install openpyxl -q")
    import openpyxl

wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)

def parse_rates(wb):
    """Extract rates and modifiers from the СТАВКИ sheet."""
    ws = wb['СТАВКИ']
    rows = list(ws.iter_rows(values_only=True))

    prices = {
        'foundation': {},
        'walls':      {},
        'roof':       {},
        'slabs':      {},
        'additional': {},
        'modifiers':  {},
        '_meta': {}
    }

    section = None
    for row in rows:
        # Detect section headers
        a = str(row[0] or '').strip() if row[0] else ''
        if '1. ФУНДАМЕНТ' in a:   section = 'foundation'; continue
        if '2. НЕСУЩИЕ СТЕНЫ' in a: section = 'walls'; continue
        if '3. КРОВЛЯ' in a:      section = 'roof'; continue
        if '4. ПЕРЕКРЫТИЯ' in a:  section = 'slabs'; continue
        if '5. ДОПОЛНИТЕЛЬНЫЕ' in a: section = 'additional'; continue
        if '6. КОЭФФИЦИЕНТЫ' in a:   section = 'modifiers'; continue

        if section is None: continue

        # Data rows have a code in col F (index 5) and rate in col C (index 2)
        code = str(row[5] or '').strip() if len(row) > 5 else ''
        rate = row[2] if len(row) > 2 else None

        if not code or not rate: continue
        try:
            rate_val = float(rate)
        except (TypeError, ValueError):
            continue

        # Mat/work ratios
        mat_r  = float(row[3]) if len(row) > 3 and row[3] else None
        work_r = float(row[4]) if len(row) > 4 and row[4] else None

        if section == 'modifiers':
            prices['modifiers'][code] = rate_val
        elif section == 'foundation':
            prices['foundation'][code] = {
                'rate': rate_val,
                'matR': mat_r or 0.60,
                'workR': work_r or 0.40
            }
        elif section == 'walls':
            prices['walls'][code] = {
                'rate': rate_val,
                'matR': mat_r or 0.57,
                'workR': work_r or 0.43
            }
        elif section == 'roof':
            prices['roof'][code] = {
                'rate': rate_val,
                'matR': mat_r or 0.55,
                'workR': work_r or 0.45
            }
        elif section == 'slabs':
            prices['slabs'][code] = {
                'rate': rate_val,
                'matR': mat_r or 0.62,
                'workR': work_r or 0.38
            }
        elif section == 'additional':
            prices['additional'][code] = {
                'cost': rate_val,
                'matR': mat_r or 0.70,
                'workR': work_r or 0.30
            }

    import datetime
    prices['_meta']['updated_at'] = datetime.datetime.utcnow().isoformat() + 'Z'
    prices['_meta']['source']     = f'Яндекс.Диск /{FOLDER}/цены-материалов.xlsx'
    return prices

prices = parse_rates(wb)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(prices, f, ensure_ascii=False, indent=2)

print(f"\n✅ prices.json обновлён: {OUT}")
print(f"   Фундаментов: {len(prices['foundation'])}")
print(f"   Материалов стен: {len(prices['walls'])}")
print(f"   Кровельных покрытий: {len(prices['roof'])}")
print(f"   Перекрытий: {len(prices['slabs'])}")
print(f"   Доп. работ: {len(prices['additional'])}")
print(f"   Коэффициентов: {len(prices['modifiers'])}")
print(f"   Обновлено: {prices['_meta']['updated_at']}")
