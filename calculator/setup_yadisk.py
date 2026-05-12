#!/usr/bin/env python3
"""
Первичная настройка: создаёт папку на Яндекс.Диске и загружает шаблон цен.

Запуск:
  YANDEX_DISK_TOKEN=<токен> python3 calculator/setup_yadisk.py

После запуска скрипт выведет публичную ссылку на папку.
"""
import os, sys, time, json
import urllib.request, urllib.error

TOKEN  = os.environ.get('YANDEX_DISK_TOKEN', '')
FOLDER = os.environ.get('YANDEX_DISK_CALC_FOLDER', 'Калькулятор_ИндивиДом')
FILE   = os.path.join(os.path.dirname(__file__), 'цены-материалов.xlsx')
API    = 'https://cloud-api.yandex.net/v1/disk'

if not TOKEN:
    print("ERROR: укажите YANDEX_DISK_TOKEN в переменных окружения")
    sys.exit(1)

def ya(method, path, **params):
    url = f'{API}/{path}'
    if params:
        url += '?' + '&'.join(f'{k}={v}' for k, v in params.items())
    req = urllib.request.Request(url, headers={'Authorization': f'OAuth {TOKEN}'})
    req.method = method
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()) if r.length else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'error': e.code, 'body': body}

def ya_put(path, **params):
    url = f'{API}/{path}'
    if params:
        url += '?' + '&'.join(f'{k}={v}' for k, v in params.items())
    req = urllib.request.Request(url, headers={'Authorization': f'OAuth {TOKEN}'})
    req.method = 'PUT'
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()) if r.length else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'error': e.code, 'body': body}

def ya_post(path, **params):
    url = f'{API}/{path}'
    if params:
        url += '?' + '&'.join(f'{k}={v}' for k, v in params.items())
    req = urllib.request.Request(url, headers={'Authorization': f'OAuth {TOKEN}'})
    req.method = 'POST'
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()) if r.length else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        return {'error': e.code, 'body': body}

# 1. Check disk access
print("1. Проверка доступа к Яндекс.Диску...")
info = ya('GET', 'disk')
if 'error' in info:
    print(f"   ERROR: {info}")
    sys.exit(1)
print(f"   OK — диск: {info.get('used_space', 0) // 1024 // 1024} МБ занято")

# 2. Create folder
print(f"2. Создание папки /{FOLDER}...")
res = ya_put(f'resources', path=f'disk:/{FOLDER}')
if 'error' in res and res['error'] != 409:
    print(f"   WARNING: {res}")
else:
    print(f"   OK")

# 3. Get upload URL
remote_path = f'disk:/{FOLDER}/цены-материалов.xlsx'
print(f"3. Получение URL для загрузки файла...")
upload = ya('GET', 'resources/upload', path=remote_path, overwrite='true')
if 'error' in upload:
    print(f"   ERROR: {upload}"); sys.exit(1)
upload_url = upload.get('href')
print(f"   OK — URL получен")

# 4. Upload file
print(f"4. Загрузка файла цены-материалов.xlsx...")
with open(FILE, 'rb') as f:
    data = f.read()
req = urllib.request.Request(upload_url, data=data, method='PUT')
req.add_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
try:
    with urllib.request.urlopen(req) as r:
        print(f"   OK — {len(data):,} байт загружено")
except urllib.error.HTTPError as e:
    print(f"   ERROR: {e.code} {e.read()}")
    sys.exit(1)

time.sleep(1)

# 5. Publish folder
print(f"5. Открытие публичного доступа к папке...")
pub = ya_put(f'resources/publish', path=f'disk:/{FOLDER}')
print(f"   {pub}")

# 6. Get public link
res = ya('GET', 'resources', path=f'disk:/{FOLDER}', fields='public_url,public_key')
pub_url = res.get('public_url', '')
pub_key = res.get('public_key', '')
print(f"\n✅ Готово!")
print(f"   Папка на Яндекс.Диске: /{FOLDER}")
print(f"   Публичная ссылка: {pub_url}")
print(f"   Public key: {pub_key}")
print(f"\n📌 Добавьте в GitHub Secrets:")
print(f"   YANDEX_DISK_CALC_FOLDER = {FOLDER}")
print(f"   (YANDEX_DISK_TOKEN уже есть)")
print(f"\n📝 Файл цен: https://disk.yandex.ru — папка '{FOLDER}' — цены-материалов.xlsx")
print(f"   Откройте файл в браузере и редактируйте жёлтые ячейки с ценами.")
