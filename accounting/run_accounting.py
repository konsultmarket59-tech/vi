"""
CLI-обёртка для запуска бухгалтерских скриптов.

Использование:
  python accounting/run_accounting.py --month=2026-04 --dry-run
  python accounting/run_accounting.py --month=2026-04 --generate
  python accounting/run_accounting.py --month=2026-04 --ord
  python accounting/run_accounting.py --month=2026-04 --push-to-ord
  python accounting/run_accounting.py --reconcile
"""

import argparse
import calendar
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import generate_monthly_acts
import generate_ord_template
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


def get_env(key, required=True):
    val = os.environ.get(key)
    if required and not val:
        print(f'Ошибка: переменная окружения {key} не задана.')
        sys.exit(1)
    return val


def find_stats_excel(token, stats_folder, period_str):
    """Ищет Excel-файл статистики в папке {stats_folder}/{period_str}/."""
    from generate_monthly_acts import list_yadisk_folder, _ya_headers
    folder_path = f'{stats_folder}/{period_str}'
    items = list_yadisk_folder(token, folder_path)
    for item in items:
        if item['type'] == 'file' and item['name'].lower().endswith(('.xlsx', '.xls')):
            return f'{folder_path}/{item["name"]}'
    # Попробуем корень папки статистики
    items = list_yadisk_folder(token, stats_folder)
    for item in items:
        name = item['name'].lower()
        if item['type'] == 'file' and name.endswith(('.xlsx', '.xls')) and period_str in name:
            return f'{stats_folder}/{item["name"]}'
    return None


def main():
    parser = argparse.ArgumentParser(
        description='Бухгалтер-делопроизводитель — генерация актов и ОРД-шаблонов'
    )
    parser.add_argument(
        '--month', default=None,
        help='Период в формате YYYY-MM (по умолчанию — прошлый месяц)'
    )
    parser.add_argument(
        '--stats-path', default=None,
        help='Путь к Excel-файлу на Яндекс.Диске (если не указан — ищется автоматически)'
    )
    parser.add_argument('--generate', action='store_true', help='Генерировать акты')
    parser.add_argument('--ord', action='store_true', help='Генерировать ОРД-шаблон')
    parser.add_argument('--push-to-ord', action='store_true',
                        help='Отправить статистику в ВК ОРД API (требует подтверждения)')
    parser.add_argument('--reconcile', action='store_true',
                        help='Обновить сверку взаиморасчётов без генерации актов')
    parser.add_argument('--dry-run', action='store_true',
                        help='Показать что будет сделано, ничего не записывать')
    args = parser.parse_args()

    # Если ничего не выбрано — запустить всё
    if not any([args.generate, args.ord, args.push_to_ord, args.reconcile]):
        args.generate = True
        args.ord = True

    token = get_env('YANDEX_DISK_TOKEN')
    accounting_folder = os.environ.get('YANDEX_DISK_ACCOUNTING_FOLDER', 'Бухгалтерия')
    stats_folder = os.environ.get('YANDEX_DISK_STATS_FOLDER', 'Статистика')

    year, month = parse_month(args.month) if args.month else prev_month()
    period_str = f'{year}-{month:02d}'

    print(f'Период: {period_str}')
    print(f'Папка бухгалтерии: {accounting_folder}')
    if args.dry_run:
        print('[dry-run режим — файлы не будут записаны]\n')

    # Найти Excel статистики
    stats_path = args.stats_path
    if not stats_path and (args.generate or args.ord):
        stats_path = find_stats_excel(token, stats_folder, period_str)
        if not stats_path:
            print(f'Ошибка: Excel-файл статистики не найден в папке '
                  f'«{stats_folder}/{period_str}/».\n'
                  f'Загрузите файл на Яндекс.Диск или укажите путь через --stats-path.')
            sys.exit(1)
        print(f'Найден файл статистики: {stats_path}')

    generated_acts = []

    # --- Генерация актов ---
    if args.generate:
        generated_acts = generate_monthly_acts.run(
            year, month, token, accounting_folder, stats_path,
            dry_run=args.dry_run
        )
        if not args.dry_run and generated_acts:
            reconciliation.update_reconciliation(
                token, accounting_folder, generated_acts, year
            )

    # --- ОРД шаблон ---
    if args.ord:
        generate_ord_template.run(
            year, month, token, accounting_folder, stats_path,
            dry_run=args.dry_run
        )

    # --- Только сверка ---
    if args.reconcile and not args.generate:
        print('Обновление сверки без генерации актов — нет новых данных.')
        print('Используйте --generate для автоматического обновления сверки.')

    # --- Отправка в ОРД API ---
    if args.push_to_ord and not args.dry_run:
        import io
        import openpyxl
        from generate_monthly_acts import download_excel_from_yadisk
        from generate_ord_template import parse_ord_sheet, push_to_vk_ord

        ord_token = os.environ.get('VK_ORD_API_TOKEN')
        if not ord_token:
            print('VK_ORD_API_TOKEN не задан — пропускаем API отправку.')
        else:
            excel_bytes = download_excel_from_yadisk(token, stats_path)
            wb = openpyxl.load_workbook(io.BytesIO(excel_bytes))
            rows = parse_ord_sheet(wb)
            push_to_vk_ord(rows, ord_token)

    # --- Итог ---
    if not args.dry_run and generated_acts:
        print(f'\n{"="*50}')
        print(f'Сгенерировано документов: {len(generated_acts)}')
        for d in generated_acts:
            tz_info = f' ТЗ №{d["tz"]}' if d.get('tz') else ''
            print(f'  ✓ {d["client"]} | {d["type"]} | ДС №{d["ds"]}{tz_info} | '
                  f'{int(d["total"]):,} руб.'.replace(',', ' '))
        print(f'\nФайлы на Яндекс.Диске в папке: {accounting_folder}/')
        print('Проверьте документы и при необходимости скорректируйте счётчики')
        print('номеров актов в accounting/config/clients.json (поле act_counters).')


if __name__ == '__main__':
    main()
