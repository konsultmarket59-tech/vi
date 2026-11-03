"""Дома в продаже из выгрузки (xlsx) → houses.json: посёлок, улица, номер, площадь, статус.

    python3 houses.py выгрузка.xlsx
"""
import json
import sys
from pathlib import Path

import openpyxl

rows = list(openpyxl.load_workbook(sys.argv[1], data_only=True).worksheets[0].iter_rows(values_only=True))[1:]
out = [{'status': r[0], 'village': r[3], 'street': r[4], 'number': str(r[5]), 'area': r[7]} for r in rows if r[0] and r[7]]
(Path(__file__).parent / 'houses.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print('houses.json: %d домов' % len(out))
