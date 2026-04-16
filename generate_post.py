import os
import json
import datetime
from anthropic import Anthropic
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
]

# Google Sheets columns (1-indexed):
# A=1 Date, B=2 Theme, C=3 Platform, D=4 Brief, E=5 Tone, F=6 Status, G=7 Post Link


def get_google_credentials():
    service_account_info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    return service_account.Credentials.from_service_account_info(
        service_account_info, scopes=SCOPES
    )


def get_next_task(sheets_service, sheet_id):
    """Return first row that is pending (Status empty/not done) and date <= today."""
    result = sheets_service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range='A2:G1000'
    ).execute()

    rows = result.get('values', [])
    today = datetime.date.today()

    for i, row in enumerate(rows):
        if len(row) < 4:
            continue

        date_str = row[0].strip() if row[0] else ''
        theme = row[1].strip() if len(row) > 1 else ''
        platform = row[2].strip() if len(row) > 2 else ''
        brief = row[3].strip() if len(row) > 3 else ''
        tone = row[4].strip() if len(row) > 4 else 'нейтральный, вовлекающий'
        status = row[5].strip() if len(row) > 5 else ''

        if status.lower() in ('✓', 'done', 'выполнено', '+', 'да', 'yes'):
            continue

        try:
            task_date = datetime.date.fromisoformat(date_str)
            if task_date > today:
                continue
        except ValueError:
            pass  # row without valid date — include it

        return {
            'row_index': i + 2,  # +2: skip header, convert to 1-based
            'date': date_str,
            'theme': theme,
            'platform': platform,
            'brief': brief,
            'tone': tone,
        }

    return None


def _platform_instructions(platform_str):
    p = platform_str.upper()
    instructions = []
    if 'ВК' in p or 'VK' in p:
        instructions.append(
            'ВКонтакте: до 2000 символов, живой тон, эмодзи уместны, хэштеги в конце'
        )
    if 'TG' in p or 'TELEGRAM' in p or 'ТГ' in p:
        instructions.append(
            'Telegram: до 4096 символов, поддерживает **жирный** и _курсив_, хэштеги приветствуются'
        )
    if 'БЛОГ' in p or 'BLOG' in p or 'САЙТ' in p or 'SITE' in p:
        instructions.append(
            'Блог/сайт: развёрнутая статья, SEO-заголовок H1, подзаголовки H2, 500–1500 слов'
        )
    if not instructions:
        instructions.append('универсальный пост для социальных сетей, ~800 символов')
    return instructions


PROJECT_CONTEXT = """
=== ПРОЕКТ «БОЛДИНО LIFE» — КОНТЕКСТ ДЛЯ НАПИСАНИЯ ПОСТОВ ===

ОПИСАНИЕ ПРОЕКТА
Болдино LIFE — коттеджный посёлок в 20 минутах от Перми. Два сектора:
• «Дома» — 402 участка (5,24–49 соток), дома под ключ с коммуникациями
• «Участки» — 112 участков (4,66–15,44 соток), под собственное строительство

ПУБЛИЧНЫЕ ЦЕНЫ (использовать в постах — только эти):
• Дома 100 м² — от 7 550 000 р. (White box)
• Дома 85 м² — от 6 700 000 до 9 000 000 р.
• Участки ул. Подсолнуховая: 6 соток — 495 000 р., 10 соток — 825 000 р.
• Базовая цена участка — 82 500 руб./сотка
• Скидки: 10% при 100% оплате наличными, 5% для участников СВО, 10% при покупке от 5 участков
• Ипотека: семейная, IT, сельская, военная; рассрочка 0% до 6 мес. (от 50% взноса)

ИНФРАСТРУКТУРА:
Асфальт, освещение, электричество, оптоволоконный интернет, центральный водопровод (сектор «Дома»),
шлагбаум, видеонаблюдение, детские и спортивные площадки, яблоневый сад. Планируется газ.

ЗАСТРОЙЩИКИ: «Новая Земля» (генеральный девелопер), СК Максима Терехичева
КОНТАКТЫ: +7 950 474-07-07, boldino59.ru
ОФИС: г. Пермь, пр. Парковый, 50А, офис 1

ПРАВИЛА ДЛЯ ПОСТОВ — ОБЯЗАТЕЛЬНО:
✓ Используй только публичные цены (указаны выше)
✓ Ключевое УТП: «городской комфорт в экологичной упаковке» в 20 минутах от Перми
✓ Главный эмоциональный крючок: не «дом», а «своя земля», «пространство для семьи», «воздух для детей»
✗ НЕ упоминай: комплект сантехники, озеленение, септик как отдельные опции
✗ НЕ раскрывай внутреннюю структуру себестоимости
✗ Никаких внутренних пометок и скрытых условий

ЦЕЛЕВАЯ АУДИТОРИЯ — 5 сегментов:

1. МОЛОДАЯ СЕМЬЯ (28–38 лет, дети до 10 лет)
Боли: тесная квартира, нет безопасного двора, шум соседей
Страхи: дети не доберутся до школы, дорого отапливать, застройщик бросит
Триггеры: дом по цене 2-комнатной квартиры, семейная ипотека, безопасная территория, готовый «под ключ»

2. СТАТУСНЫЙ ПРАГМАТИК (40–55 лет, топ-менеджер/владелец бизнеса)
Боли: шум в ЖК, низкое качество стройки, нет места для гаража/мастерской
Страхи: поселок станет «шанхаем», инфраструктура не достроится
Триггеры: единый архитектурный стиль, охрана, мощные инженерные сети, репутация застройщика

3. УДАЛЁННЫЙ ПРОФЕССИОНАЛ (25–35 лет, IT/digital)
Боли: стресс города снижает продуктивность, маленькая квартира, нет кабинета
Страхи: интернет упадёт во время дедлайна, оторванность от жизни
Триггеры: оптоволокно, современная архитектура, готовый дом без стройки, близость к Перми

4. АКТИВНЫЕ ПЕНСИОНЕРЫ (55–65+ лет)
Боли: плохая экология в Перми, высокие тарифы, одиночество
Страхи: плохая вода, далеко до врача, некачественный дом
Триггеры: газ и вода (центральные), близость к городу, компактный одноэтажный дом до 7 млн

5. РАЦИОНАЛЬНЫЙ ИНВЕСТОР (30–50 лет)
Боли: инфляция обесценивает накопления, сложно найти ликвидную загородную локацию
Страхи: проект заморозят, юридические риски
Триггеры: динамика цен (растёт), скидка 10% от 5 участков, прозрачность, масштаб 500+ участков

СКВОЗНЫЕ ИНСАЙТЫ:
• Главный барьер — страх потерять связь с цивилизацией (важны: магазин, автобус, асфальт, интернет)
• Главный триггер доверия — единый архитектурный стиль (= «здесь порядок, соседи как я»)
• Эмоция > логика: «своя земля», «пространство для семьи», «уверенность в завтрашнем дне»
"""


def generate_post(client, task):
    """Call Claude API and return the generated post text."""
    platform_lines = '\n'.join(f'- {p}' for p in _platform_instructions(task['platform']))

    section_hint = ''
    platforms_upper = task['platform'].upper()
    sections = []
    if 'ВК' in platforms_upper or 'VK' in platforms_upper:
        sections.append('## ВКонтакте')
    if 'TG' in platforms_upper or 'TELEGRAM' in platforms_upper or 'ТГ' in platforms_upper:
        sections.append('## Telegram')
    if 'БЛОГ' in platforms_upper or 'BLOG' in platforms_upper or 'САЙТ' in platforms_upper:
        sections.append('## Блог')
    if len(sections) > 1:
        section_hint = (
            'Разделяй секции заголовками: ' + ', '.join(sections) + '. '
            'Каждая секция — готовый текст для своей платформы.'
        )

    system_prompt = (
        'Ты — опытный SMM-редактор и копирайтер проекта «Болдино LIFE» — '
        'коттеджного посёлка в 20 минутах от Перми. '
        'Ты отлично знаешь продукт, аудиторию и умеешь писать тексты, которые продают без давления. '
        'Пиши живо, по-человечески, без канцеляризма и шаблонных фраз.\n\n'
        + PROJECT_CONTEXT
    )

    user_prompt = f"""Напиши пост по заданию из контент-плана:

**Тема:** {task['theme']}
**Ключевые моменты / бриф:** {task['brief']}
**Тон и стиль:** {task['tone']}
**Дата публикации:** {task['date']}

Платформы:
{platform_lines}

{section_hint}"""

    message = client.messages.create(
        model='claude-opus-4-7',
        max_tokens=4096,
        system=system_prompt,
        messages=[{'role': 'user', 'content': user_prompt}],
    )
    return message.content[0].text


def create_google_doc(docs_service, drive_service, folder_id, task, post_content):
    """Create a Google Doc, write post content, move to target folder."""
    title = f"{task['date']} — {task['theme']}"

    doc = docs_service.documents().create(body={'title': title}).execute()
    doc_id = doc['documentId']

    header = (
        f"Болдино LIFE | Контент-план\n\n"
        f"Дата: {task['date']}\n"
        f"Тема: {task['theme']}\n"
        f"Платформа: {task['platform']}\n\n"
        f"{'=' * 50}\n\n"
    )
    full_text = header + post_content

    docs_service.documents().batchUpdate(
        documentId=doc_id,
        body={
            'requests': [
                {
                    'insertText': {
                        'location': {'index': 1},
                        'text': full_text,
                    }
                }
            ]
        },
    ).execute()

    # Move document to target Drive folder
    file_meta = drive_service.files().get(fileId=doc_id, fields='parents').execute()
    previous_parents = ','.join(file_meta.get('parents', []))
    drive_service.files().update(
        fileId=doc_id,
        addParents=folder_id,
        removeParents=previous_parents,
        fields='id, parents',
    ).execute()

    return f'https://docs.google.com/document/d/{doc_id}/edit'


def mark_task_done(sheets_service, sheet_id, row_index, doc_url):
    """Write ✓ into Status column and doc URL into Link column."""
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f'F{row_index}:G{row_index}',
        valueInputOption='RAW',
        body={'values': [['✓', doc_url]]},
    ).execute()


def main():
    sheet_id = os.environ['GOOGLE_SHEET_ID']
    folder_id = os.environ['GOOGLE_DRIVE_FOLDER_ID']

    creds = get_google_credentials()
    sheets_service = build('sheets', 'v4', credentials=creds)
    docs_service = build('docs', 'v1', credentials=creds)
    drive_service = build('drive', 'v3', credentials=creds)
    claude = Anthropic()

    task = get_next_task(sheets_service, sheet_id)

    if not task:
        print('Нет задач на сегодня или все задачи уже выполнены.')
        return

    print(f"Задача: «{task['theme']}» [{task['platform']}] (строка {task['row_index']})")

    post_content = generate_post(claude, task)
    print(f'Пост написан ({len(post_content)} символов).')

    doc_url = create_google_doc(docs_service, drive_service, folder_id, task, post_content)
    print(f'Документ создан: {doc_url}')

    mark_task_done(sheets_service, sheet_id, task['row_index'], doc_url)
    print('Задача отмечена как выполненная ✓')


if __name__ == '__main__':
    main()
