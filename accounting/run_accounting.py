"""
CLI-обёртка для запуска бухгалтерских скриптов.

Использование:
  python accounting/run_accounting.py --month=2026-04 --dry-run
  python accounting/run_accounting.py --month=2026-04 --generate
  python accounting/run_accounting.py --reconcile
"""

import argparse
import io
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import generate_monthly_acts
import reconciliation


def prev_month():
    today = date.today()
    first = today.replace(day=1)
    last_month = first - timedelta(days=1)
    return last_month.year, last_month.month


def parse_month(month_str):
    try:
        year, month = map(int, month_str.split('-'))
        if not (1 <= month <= 12):
            raise ValueError
        return year, month
    except ValueError:
        print(f'Ошибка: неверный формат месяца «{month_str}». Используйте YYYY-MM.')
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description='Генератор ежемесячных актов — Dynamic Brands'
    )
    parser.add_argument('--month', default=None, help='Период YYYY-MM (по умолчанию прошлый месяц)')
    parser.add_argument('--stats-path', default=None,
                        help='Путь к файлу на Яндекс.Диске (приватный) или имя файла в публичной папке')
    parser.add_argument('--generate', action='store_true', help='Генерировать акты')
    parser.add_argument('--reconcile', action='store_true', help='Только обновить сверку')
    parser.add_argument('--dry-run', action='store_true',
                        help='Показать что будет сделано, ничего не записывать')
    args = parser.parse_args()

    if not any([args.generate, args.reconcile]):
        args.generate = True

    token = os.environ.get('YANDEX_DISK_TOKEN', '')
    accounting_folder = os.environ.get('YANDEX_DISK_ACCOUNTING_FOLDER', 'Бухгалтерия')
    stats_public_key = os.environ.get('YANDEX_DISK_STATS_PUBLIC_KEY', '')

    year, month = parse_month(args.month) if args.month else prev_month()
    period_str = f'{year}-{month:02d}'

    print(f'Период: {period_str}')
    print(f'Папка бухгалтерии: {accounting_folder}')
    if args.dry_run:
        print('[dry-run — файлы не записываются]\n')

    # Найти и скачать Excel статистики
    excel_bytes = None
    if args.generate:
        if args.stats_path and not args.stats_path.startswith('/'):
            # Имя файла в публичной папке
            if not stats_public_key:
                print('Ошибка: YANDEX_DISK_STATS_PUBLIC_KEY не задан.')
                sys.exit(1)
            print(f'Скачиваем из публичной папки: {args.stats_path}')
            excel_bytes = generate_monthly_acts.download_excel_from_public_yadisk(
                stats_public_key, args.stats_path
            )
        elif args.stats_path:
            # Приватный путь
            if not token:
                print('Ошибка: YANDEX_DISK_TOKEN не задан.')
                sys.exit(1)
            excel_bytes = generate_monthly_acts.download_excel_from_yadisk(token, args.stats_path)
        elif stats_public_key:
            # Ищем файл автоматически в публичной папке
            print(f'Ищем Excel за {period_str} в публичной папке статистики...')
            file_path = generate_monthly_acts.find_stats_excel_in_public_folder(
                stats_public_key, period_str
            )
            if not file_path:
                # Берём первый доступный Excel
                file_path = generate_monthly_acts.find_stats_excel_in_public_folder(stats_public_key)
            if not file_path:
                print(f'Ошибка: Excel-файл не найден в публичной папке.')
                sys.exit(1)
            print(f'Найден: {file_path}')
            excel_bytes = generate_monthly_acts.download_excel_from_public_yadisk(
                stats_public_key, file_path
            )
        else:
            print('Ошибка: укажите --stats-path или задайте YANDEX_DISK_STATS_PUBLIC_KEY.')
            sys.exit(1)

    # Генерация актов
    generated_acts = []
    if args.generate and not args.dry_run:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
        generated_acts = generate_monthly_acts.run(
            year, month, token, accounting_folder,
            excel_bytes=excel_bytes, dry_run=False
        )
        if generated_acts:
            reconciliation.update_reconciliation(token, accounting_folder, generated_acts, year)
    elif args.generate and args.dry_run:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
        generate_monthly_acts.run(
            year, month, token, accounting_folder,
            excel_bytes=excel_bytes, dry_run=True
        )

    # Итог
    if generated_acts:
        print(f'\n{"="*50}')
        print(f'Готово: {len(generated_acts)} документ(ов)')
        for d in generated_acts:
            tz_info = f' ТЗ №{d["tz"]}' if d.get('tz') else ''
            print(f'  ✓ {d["client"]} | {d["type"]} | ДС №{d["ds"]}{tz_info} | '
                  f'{int(d["total"]):,} руб.'.replace(',', ' '))
        print(f'\nФайлы: {accounting_folder}/')
        print('После подписания обновите act_counters в accounting/config/clients.json')


if __name__ == '__main__':
    main()
