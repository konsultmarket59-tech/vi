#!/usr/bin/env python3
"""
Еженедельный анализ конкурентной среды на Авито — «Болдино LIFE»
Каждую пятницу: сбор данных, сравнение с прошлой неделей, отчёт в Google Drive.
"""

import os
import re
import json
import time
import datetime
import requests
from anthropic import Anthropic
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ── константы ────────────────────────────────────────────────────────────────
SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents',
]

OUR_SELLER_ID = 'b9b67d5c5ef41c24b74cae92f536c8b2'
OUR_PROFILE_URL = (
    'https://www.avito.ru/brands/i73351402/all/nedvizhimost'
    '?src=search_seller_info&iid=4360364036&sellerId=' + OUR_SELLER_ID
)

AVITO_TOKEN_URL = 'https://api.avito.ru/token'
AVITO_ITEMS_URL = 'https://api.avito.ru/core/v1/items'

# Поисковые URL конкурентов (Пермский край)
COMPETITOR_SEARCH_URLS = [
    # Земельные участки
    'https://www.avito.ru/permskiy_kray/zemelnye_uchastki?s=104',
    # Дома, дачи, коттеджи
    'https://www.avito.ru/permskiy_kray/doma_dachi_kottedzhi?s=104',
]

HISTORY_SHEET_NAME = 'Авито-конкуренты'

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'ru-RU,ru;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': 'https://www.avito.ru/',
}


# ── Google helpers ────────────────────────────────────────────────────────────
def get_google_credentials():
    info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)


# ── Avito API — наши объявления ───────────────────────────────────────────────
def avito_get_token(client_id: str, client_secret: str) -> str:
    resp = requests.post(
        AVITO_TOKEN_URL,
        data={
            'grant_type': 'client_credentials',
            'client_id': client_id,
            'client_secret': client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()['access_token']


def avito_fetch_own_listings(token: str) -> list[dict]:
    """Получить наши активные объявления через официальный API."""
    listings = []
    page = 1
    while True:
        resp = requests.get(
            AVITO_ITEMS_URL,
            headers={'Authorization': f'Bearer {token}'},
            params={'per_page': 100, 'page': page, 'status': 'active'},
            timeout=15,
        )
        if resp.status_code != 200:
            break
        data = resp.json()
        items = data.get('resources', [])
        if not items:
            break
        listings.extend(items)
        if len(items) < 100:
            break
        page += 1
        time.sleep(0.5)

    return listings


def avito_fetch_item_description(token: str, item_id: int) -> str:
    """Получить описание конкретного объявления."""
    resp = requests.get(
        f'https://api.avito.ru/core/v1/items/{item_id}',
        headers={'Authorization': f'Bearer {token}'},
        timeout=15,
    )
    if resp.status_code == 200:
        return resp.json().get('description', '')
    return ''


# ── Парсинг конкурентов ───────────────────────────────────────────────────────
def _extract_json_from_page(html: str) -> list[dict]:
    """Извлечь данные объявлений из HTML-страницы Авито."""
    listings = []

    # Попытка 1: __initialData__ / window.__initialState__
    patterns = [
        r'window\.__initialState__\s*=\s*(\{.*?\});\s*</script>',
        r'window\.__initialData__\s*=\s*(\{.*?\});\s*</script>',
        r'"items"\s*:\s*(\[.*?\])\s*,\s*"totalCount"',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.DOTALL)
        if m:
            try:
                raw = json.loads(m.group(1))
                # Путь к листингам варьируется — ищем рекурсивно
                items = _find_items_in_json(raw)
                if items:
                    listings.extend(items)
                    break
            except (json.JSONDecodeError, TypeError):
                continue

    # Попытка 2: data-marker="item" в HTML
    if not listings:
        # Мини-парсер без BeautifulSoup
        item_blocks = re.findall(
            r'data-item-id="(\d+)"[^>]*data-marker="item".*?</article>',
            html, re.DOTALL
        )
        for block in item_blocks[:50]:
            listing = _parse_html_block(block)
            if listing:
                listings.append(listing)

    return listings[:60]  # ограничение — 60 конкурентов на категорию


def _find_items_in_json(obj, depth=0) -> list[dict]:
    """Рекурсивный поиск массива объявлений в JSON."""
    if depth > 8:
        return []
    if isinstance(obj, list):
        if obj and isinstance(obj[0], dict) and 'id' in obj[0] and 'price' in obj[0]:
            return obj
        for item in obj:
            result = _find_items_in_json(item, depth + 1)
            if result:
                return result
    if isinstance(obj, dict):
        for key in ('items', 'catalog', 'listing', 'data'):
            if key in obj:
                result = _find_items_in_json(obj[key], depth + 1)
                if result:
                    return result
        for v in obj.values():
            result = _find_items_in_json(v, depth + 1)
            if result:
                return result
    return []


def _parse_html_block(block: str) -> dict | None:
    """Минимальный парсер карточки из HTML."""
    item_id_m = re.search(r'data-item-id="(\d+)"', block)
    title_m = re.search(r'title="([^"]+)"', block)
    price_m = re.search(r'"price"[^>]*>([^<]+)<', block)
    if not (item_id_m and title_m):
        return None
    return {
        'id': item_id_m.group(1),
        'title': title_m.group(1),
        'price_raw': price_m.group(1).strip() if price_m else '',
    }


def fetch_competitor_listings() -> list[dict]:
    """Получить объявления конкурентов с поисковых страниц Авито."""
    all_listings = []
    seen_ids = set()

    for url in COMPETITOR_SEARCH_URLS:
        for page in range(1, 3):  # первые 2 страницы = ~50 объявлений
            try:
                page_url = f'{url}&p={page}' if page > 1 else url
                resp = requests.get(page_url, headers=HEADERS, timeout=20)
                if resp.status_code != 200:
                    print(f'  [warn] {page_url} → HTTP {resp.status_code}')
                    break

                items = _extract_json_from_page(resp.text)
                new_items = [
                    i for i in items
                    if str(i.get('id', '')) not in seen_ids
                    and str(i.get('id', '')) != ''
                ]
                for item in new_items:
                    seen_ids.add(str(item.get('id', '')))
                all_listings.extend(new_items)

                time.sleep(2)  # пауза между запросами

            except requests.RequestException as e:
                print(f'  [error] fetch {url} page {page}: {e}')
                break

    # Исключить наши собственные объявления
    all_listings = [
        i for i in all_listings
        if i.get('seller', {}).get('id', '') != OUR_SELLER_ID
    ]
    print(f'Найдено объявлений конкурентов: {len(all_listings)}')
    return all_listings


# ── Извлечение структурированных данных через Claude ─────────────────────────
def extract_listing_features(claude: Anthropic, listings: list[dict], label: str) -> list[dict]:
    """
    Отправить батч описаний в Claude — получить структурированные атрибуты
    (цена/м², назначение земли, электричество, прописка и т.д.)
    """
    if not listings:
        return []

    batch_size = 10
    result = []

    for i in range(0, len(listings), batch_size):
        batch = listings[i:i + batch_size]
        items_text = '\n\n---\n\n'.join(
            f'ID: {l.get("id", "?")}\n'
            f'Заголовок: {l.get("title", "")}\n'
            f'Цена: {l.get("price", {}).get("value", l.get("price_raw", ""))}\n'
            f'Описание: {l.get("description", "")[:800]}'
            for l in batch
        )

        prompt = f"""Ты анализируешь объявления о продаже недвижимости в Пермском крае ({label}).
Для каждого объявления (они разделены ---) извлеки JSON со следующими полями (null если не указано):

{{
  "id": "ID объявления",
  "title": "заголовок",
  "price_total": число в рублях или null,
  "area_sotki": площадь участка в сотках или null,
  "area_house_m2": площадь дома в м² или null,
  "price_per_sotka": рассчитай = price_total / area_sotki или null,
  "price_per_m2_house": рассчитай = price_total / area_house_m2 или null,
  "land_type": "ИЖС|СНТ|ДНП|ЛПХ|другое|null",
  "electricity_kw": число кВт или true/false или null,
  "registration_possible": true/false/null,
  "gas": true/false/null,
  "water_central": true/false/null,
  "sewage": true/false/null,
  "road_type": "асфальт|грунт|гравий|null",
  "views": ["лес","река","поле","горы","null"] — массив,
  "soil_type": "суглинок|песок|чернозём|глина|торф|null",
  "distance_perm_km": число км до Перми или null,
  "house_material": "кирпич|брус|бревно|газоблок|пеноблок|каркас|null",
  "house_floors": число этажей или null,
  "house_year": год постройки или null,
  "heating": "газовое|электро|дровяное|null",
  "seller_type": "частное лицо|агентство|застройщик|null",
  "cottage_village": название КП или null,
  "key_advantages": ["список УТП из объявления"],
  "photos_count": число фото или null
}}

Верни массив JSON объектов, по одному на объявление. Только JSON, без пояснений.

Объявления:
{items_text}"""

        try:
            msg = claude.messages.create(
                model='claude-opus-4-7',
                max_tokens=4096,
                messages=[{'role': 'user', 'content': prompt}],
            )
            text = msg.content[0].text.strip()
            # Извлечь JSON массив
            json_m = re.search(r'\[.*\]', text, re.DOTALL)
            if json_m:
                parsed = json.loads(json_m.group())
                result.extend(parsed)
        except (json.JSONDecodeError, Exception) as e:
            print(f'  [warn] extract_features batch {i}: {e}')
            # Добавить raw данные без структурирования
            for l in batch:
                result.append({'id': str(l.get('id', '?')), 'title': l.get('title', ''), 'price_total': None})

        time.sleep(1)

    return result


# ── История — Google Sheets ───────────────────────────────────────────────────
def ensure_history_sheet(sheets_service, sheet_id: str) -> int:
    """Создать лист 'Авито-конкуренты' если не существует. Вернуть sheetId."""
    meta = sheets_service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    for s in meta.get('sheets', []):
        if s['properties']['title'] == HISTORY_SHEET_NAME:
            return s['properties']['sheetId']

    # Создать лист
    resp = sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={'requests': [{'addSheet': {'properties': {'title': HISTORY_SHEET_NAME}}}]},
    ).execute()
    return resp['replies'][0]['addSheet']['properties']['sheetId']


def load_previous_factors(sheets_service, sheet_id: str) -> set:
    """Загрузить набор ключей факторов из прошлого отчёта."""
    try:
        result = sheets_service.spreadsheets().values().get(
            spreadsheetId=sheet_id,
            range=f'{HISTORY_SHEET_NAME}!A:A',
        ).execute()
        rows = result.get('values', [])
        return {r[0] for r in rows[1:] if r}
    except HttpError:
        return set()


def save_report_data(sheets_service, sheet_id: str, report_date: str,
                     our_features: list[dict], competitor_features: list[dict]):
    """Сохранить данные отчёта в Google Sheets для истории."""
    ensure_history_sheet(sheets_service, sheet_id)

    rows = [['factor_key', 'week', 'type', 'value']]
    for f in our_features:
        for k, v in f.items():
            if v is not None:
                rows.append([f'our_{f.get("id","?")}_{k}', report_date, 'our', str(v)])
    for f in competitor_features:
        for k, v in f.items():
            if v is not None:
                rows.append([f'comp_{f.get("id","?")}_{k}', report_date, 'competitor', str(v)])

    sheets_service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f'{HISTORY_SHEET_NAME}!A1',
        valueInputOption='RAW',
        body={'values': rows},
    ).execute()


# ── Генерация отчёта через Claude ────────────────────────────────────────────
BOLDINO_CONTEXT = """
«Болдино LIFE» — коттеджный посёлок в 20 минутах от Перми (Пермский край).
Два сектора:
• «Дома» — 402 участка (5,24–49 соток), дома под ключ с коммуникациями
• «Участки» — 112 участков (4,66–15,44 соток), под собственное строительство

Наши цены: дома 100 м² от 7 550 000 р., дома 85 м² от 6 700 000 р.,
участки базово 82 500 руб./сотка (6 соток — 495 000 р., 10 соток — 825 000 р.).
Инфраструктура: асфальт, освещение, электричество, оптоволокно, центральный водопровод,
шлагбаум, видеонаблюдение, детские площадки, яблоневый сад. Планируется газ.
"""


def generate_analysis_report(
    claude: Anthropic,
    our_features: list[dict],
    competitor_features: list[dict],
    new_factors: set,
    report_date: str,
) -> tuple[str, list[str]]:
    """
    Сгенерировать полный аналитический отчёт.
    Вернуть (текст отчёта, список новых факторов для выделения).
    """
    our_json = json.dumps(our_features, ensure_ascii=False, indent=2)[:3000]
    comp_json = json.dumps(competitor_features[:30], ensure_ascii=False, indent=2)[:6000]
    new_f_list = ', '.join(sorted(new_factors)) if new_factors else 'нет новых факторов'

    prompt = f"""Ты — аналитик рынка недвижимости Пермского края. Составь ПОЛНЫЙ еженедельный отчёт
конкурентного анализа для «Болдино LIFE» на Авито за {report_date}.

{BOLDINO_CONTEXT}

НАШИ ОБЪЯВЛЕНИЯ (структурированные данные):
{our_json}

ОБЪЯВЛЕНИЯ КОНКУРЕНТОВ (структурированные данные, до 30 лотов):
{comp_json}

НОВЫЕ ФАКТОРЫ этой недели (которых не было в прошлом отчёте — отметь их [НОВОЕ]):
{new_f_list}

Структура отчёта (строго соблюдай заголовки H1/H2/H3):

# Анализ конкурентной среды Авито — {report_date}

## 1. Краткая сводка
(3-5 ключевых инсайта недели)

## 2. Наши объявления — обзор
(цены, характеристики, позиционирование — только из данных выше)

## 3. Полный анализ конкурентов
### 3.1 Таблица конкурентов
(сделай Markdown-таблицу: Название КП/продавец | Тип | Цена | Площадь | Цена/сотку | Электр. | Газ | Вода | Дорога | УТП)

### 3.2 Ценовой анализ
- Средняя цена/сотку по рынку vs наша цена
- Разбивка по назначению (ИЖС/СНТ/ДНП/ЛПХ)
- Разбивка по типу (только земля / дом+участок)
- Диапазоны цен конкурентов

### 3.3 Анализ факторов ценообразования
Сравни по каждому фактору (используй только данные из объявлений):
- Электричество (наличие, мощность)
- Возможность прописки (ИЖС vs СНТ)
- Виды и природное окружение
- Характеристики почв (если упоминаются)
- Коммуникации (газ, вода, канализация)
- Дороги
- Характеристики домов (если применимо): материал, год, этажность, отопление

### 3.4 Качество объявлений конкурентов
- Количество фото
- Полнота описания
- Наличие планировок, видео
- Использование платного продвижения

## 4. SWOT-анализ «Болдино LIFE»
### Сильные стороны (Strengths)
### Слабые стороны (Weaknesses)
### Возможности (Opportunities)
### Угрозы (Threats)

## 5. Рекомендации
### 5.1 По ценообразованию
(конкретные рекомендации на основе данных)

### 5.2 По контенту объявлений
(что добавить/убрать в описаниях для лучшего восприятия)

### 5.3 По алгоритмам Авито
(как улучшить ранжирование: заголовки, параметры, фото, активность)

### 5.4 Приоритет действий на следующую неделю
(конкретный список из 3-5 действий)

ВАЖНО: Факторы помеченные [НОВОЕ] — это изменения этой недели. Сохраняй маркер [НОВОЕ] рядом с ними в тексте.
Опирайся ТОЛЬКО на данные из объявлений — не домысливай.
Пиши по-русски, конкретно, с цифрами."""

    msg = claude.messages.create(
        model='claude-opus-4-7',
        max_tokens=8192,
        messages=[{'role': 'user', 'content': prompt}],
    )
    report_text = msg.content[0].text

    # Найти все упоминания [НОВОЕ] — для подсветки в Google Doc
    new_factor_phrases = re.findall(r'([^\n]*\[НОВОЕ\][^\n]*)', report_text)

    return report_text, new_factor_phrases


# ── Google Doc — создание с форматированием ──────────────────────────────────
def create_report_doc(
    docs_service,
    drive_service,
    folder_id: str,
    report_date: str,
    report_text: str,
    new_factor_phrases: list[str],
) -> str:
    """Создать Google Doc с отчётом. Новые факторы выделить жёлтым."""
    title = f'Авито-анализ {report_date}'

    doc = docs_service.documents().create(body={'title': title}).execute()
    doc_id = doc['documentId']

    # Вставить текст
    docs_service.documents().batchUpdate(
        documentId=doc_id,
        body={
            'requests': [
                {'insertText': {'location': {'index': 1}, 'text': report_text}}
            ]
        },
    ).execute()

    # Применить форматирование заголовков и выделения
    doc_content = docs_service.documents().get(documentId=doc_id).execute()
    formatting_requests = _build_formatting_requests(doc_content, new_factor_phrases)

    if formatting_requests:
        docs_service.documents().batchUpdate(
            documentId=doc_id,
            body={'requests': formatting_requests},
        ).execute()

    # Переместить в папку
    file_meta = drive_service.files().get(fileId=doc_id, fields='parents').execute()
    prev_parents = ','.join(file_meta.get('parents', []))
    drive_service.files().update(
        fileId=doc_id,
        addParents=folder_id,
        removeParents=prev_parents,
        fields='id, parents',
    ).execute()

    return f'https://docs.google.com/document/d/{doc_id}/edit'


def _build_formatting_requests(doc_content: dict, new_factor_phrases: list[str]) -> list[dict]:
    """Построить запросы форматирования для Google Docs API."""
    requests_list = []
    full_text = ''
    for element in doc_content.get('body', {}).get('content', []):
        para = element.get('paragraph', {})
        for run in para.get('elements', []):
            tc = run.get('textRun', {})
            full_text += tc.get('content', '')

    # Заголовки H1 (#)
    for m in re.finditer(r'^# (.+)$', full_text, re.MULTILINE):
        start = m.start() + 2  # skip '# '
        end = m.end()
        requests_list.append({
            'updateParagraphStyle': {
                'range': {'startIndex': m.start() + 1, 'endIndex': end + 1},
                'paragraphStyle': {'namedStyleType': 'HEADING_1'},
                'fields': 'namedStyleType',
            }
        })

    # Заголовки H2 (##)
    for m in re.finditer(r'^## (.+)$', full_text, re.MULTILINE):
        start = m.start() + 3
        requests_list.append({
            'updateParagraphStyle': {
                'range': {'startIndex': m.start() + 1, 'endIndex': m.end() + 1},
                'paragraphStyle': {'namedStyleType': 'HEADING_2'},
                'fields': 'namedStyleType',
            }
        })

    # Жёлтый фон для новых факторов [НОВОЕ]
    for phrase in new_factor_phrases:
        idx = full_text.find(phrase)
        if idx >= 0:
            requests_list.append({
                'updateTextStyle': {
                    'range': {'startIndex': idx + 1, 'endIndex': idx + len(phrase) + 1},
                    'textStyle': {
                        'backgroundColor': {
                            'color': {'rgbColor': {'red': 1.0, 'green': 0.95, 'blue': 0.0}}
                        }
                    },
                    'fields': 'backgroundColor',
                }
            })

    return requests_list


# ── Определение новых факторов ────────────────────────────────────────────────
def detect_new_factors(
    competitor_features: list[dict],
    previous_factor_keys: set,
) -> set:
    """Найти факторы/параметры, которых не было в прошлом отчёте."""
    current_keys = set()
    for f in competitor_features:
        cid = str(f.get('id', '?'))
        if f.get('cottage_village'):
            current_keys.add(f'village:{f["cottage_village"]}')
        if f.get('land_type'):
            current_keys.add(f'land_type:{f["land_type"]}')
        if f.get('house_material'):
            current_keys.add(f'material:{f["house_material"]}')
        for adv in (f.get('key_advantages') or []):
            current_keys.add(f'adv:{adv[:40]}')

    return current_keys - previous_factor_keys


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    report_date = datetime.date.today().strftime('%Y-%m-%d')
    print(f'=== Авито-анализ {report_date} ===')

    client_id = os.environ.get('AVITO_CLIENT_ID', '')
    client_secret = os.environ.get('AVITO_CLIENT_SECRET', '')
    sheet_id = os.environ['GOOGLE_SHEET_ID']
    folder_id = os.environ['GOOGLE_DRIVE_FOLDER_ID']

    creds = get_google_credentials()
    sheets_service = build('sheets', 'v4', credentials=creds)
    docs_service = build('docs', 'v1', credentials=creds)
    drive_service = build('drive', 'v3', credentials=creds)
    claude = Anthropic()

    # 1. Наши объявления
    our_raw = []
    if client_id and client_secret:
        print('Получаем токен Авито...')
        try:
            token = avito_get_token(client_id, client_secret)
            print('Загружаем наши объявления...')
            our_raw = avito_fetch_own_listings(token)
            # Подгрузить описания (до 20 объявлений)
            for item in our_raw[:20]:
                if not item.get('description') and item.get('id'):
                    item['description'] = avito_fetch_item_description(token, item['id'])
                    time.sleep(0.3)
            print(f'Наших объявлений: {len(our_raw)}')
        except Exception as e:
            print(f'[warn] Avito API: {e}')
    else:
        print('[info] AVITO_CLIENT_ID/SECRET не заданы — пропускаем наши объявления через API')

    # 2. Конкуренты
    print('Парсим объявления конкурентов...')
    competitor_raw = fetch_competitor_listings()

    # 3. Структурированные данные через Claude
    print('Извлекаем характеристики объявлений...')
    our_features = extract_listing_features(claude, our_raw, 'наши объявления')
    competitor_features = extract_listing_features(claude, competitor_raw, 'конкуренты')

    # 4. История и новые факторы
    print('Загружаем историю...')
    ensure_history_sheet(sheets_service, sheet_id)
    prev_factors = load_previous_factors(sheets_service, sheet_id)
    new_factors = detect_new_factors(competitor_features, prev_factors)
    print(f'Новых факторов: {len(new_factors)}')

    # 5. Генерация отчёта
    print('Генерируем аналитический отчёт...')
    report_text, new_factor_phrases = generate_analysis_report(
        claude, our_features, competitor_features, new_factors, report_date
    )
    print(f'Отчёт готов ({len(report_text)} символов)')

    # 6. Google Doc
    print('Сохраняем отчёт в Google Drive...')
    doc_url = create_report_doc(
        docs_service, drive_service, folder_id,
        report_date, report_text, new_factor_phrases
    )
    print(f'Документ: {doc_url}')

    # 7. Сохранить историю
    save_report_data(sheets_service, sheet_id, report_date, our_features, competitor_features)
    print('История сохранена в Google Sheets.')

    print(f'\n✓ Анализ {report_date} завершён. Новых факторов: {len(new_factors)}')
    print(f'  Документ: {doc_url}')


if __name__ == '__main__':
    main()
