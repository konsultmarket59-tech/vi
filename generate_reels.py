"""
Marketing-agency reels generator.

Daily:
  1. Claude generates 5-6 hooks based on triggers of the target audience
     (Russian entrepreneurs, 25-55, men & women).
  2. For each hook, a vertical luxury-lifestyle clip is downloaded from Pexels.
  3. FFmpeg composes a 1080x1920 MP4 with brand colors and fonts.
  4. The reel is uploaded to Yandex.Disk and a public link is returned.
"""

import datetime
import json
import os
import random
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from openai import OpenAI

# --- Configuration --------------------------------------------------------

MAX_API_BASE = 'https://botapi.max.ru'
YADISK_API = 'https://cloud-api.yandex.net/v1/disk'
YADISK_FOLDER = os.environ.get('YANDEX_DISK_FOLDER', 'Reels')

REELS_MIN = 5
REELS_MAX = 6
CLIP_DURATION_SEC = 12
OUTPUT_W, OUTPUT_H = 1080, 1920

PEXELS_API = 'https://api.pexels.com/videos/search'
LUXURY_QUERIES = [
    'luxury penthouse view',
    'supercar driving road',
    'private jet runway',
    'yacht ocean sunset',
    'luxury watch close up',
    'helicopter city skyline',
    'ski slope alps',
    'golf course sunrise',
    'horse riding equestrian',
    'tennis match aerial',
    'dubai skyline night',
    'monaco harbor',
    'champagne celebration slow motion',
    'miami beach sunset aerial',
    'mountain driving porsche',
    'hotel infinity pool',
    'first class cabin',
    'exotic sports car garage',
]

# Brand palette.
COLOR_PINK = '0xF53165'
COLOR_CYAN = '0x00D4FF'
COLOR_DARK = '0x2A2A2A'
COLOR_WHITE = '0xF5F5F5'

# Fonts — paid versions win if the user dropped them in fonts/.
FONT_DIR = Path(__file__).parent / 'fonts'
HEADLINE_FONT_CANDIDATES = [
    'BebasNeuePro-Bold.ttf',
    'BebasNeuePro.ttf',
    'bebasneuecyrillic.ttf',
    'Oswald.ttf',
    'BebasNeue-Regular.ttf',
    'BebasNeue.ttf',
]


# --- Helpers --------------------------------------------------------------

def find_font(candidates):
    for name in candidates:
        path = FONT_DIR / name
        if path.exists():
            return str(path)
    raise FileNotFoundError(
        f'Font not found. Looked for {candidates} in {FONT_DIR}. '
        'The workflow downloads free fallbacks — check the setup step.'
    )


def ffmpeg_escape_path(path):
    # Windows-style colons must be escaped in filter paths.
    return path.replace('\\', '/').replace(':', r'\:')


# --- Step 1: hook generation ---------------------------------------------

HOOK_PROMPT = """Ты — креативный директор маркетингового агентства. Твоё агентство решает задачи \
клиентов через SMM, vibe coding, брендинг, продуктовый маркетинг.

Целевая аудитория:
• предприниматели в России, 25–55 лет, мужчины и женщины
• у них есть триггеры четырёх типов:
  1. бизнес-триггеры: выгорание, слабый маркетинг, устаревший бренд, низкие продажи, \
     отсутствие системы, застой, невидимость на фоне конкурентов, кассовые разрывы
  2. триггеры руководителя: одиночество наверху, страх потерять команду, недоверие к найму, \
     усталость от ручного управления, синдром самозванца
  3. возрастные и гендерные триггеры: 25–35 «нужно успеть», 35–45 «второе дыхание», \
     45–55 «оставить наследие»; у женщин — баланс семья/карьера, видимость, экспертность; \
     у мужчин — статус, масштаб, признание
  4. триггеры недооценённости и соцсетей: демпинг собственных услуг, «стесняюсь поднять цену», \
     работа за лайки вместо денег, соцсети как витрина без выручки, \
     непонимание, сколько реально можно зарабатывать с текущей аудитории, \
     «другие с меньшим охватом делают х5 к моей выручке», ощущение «я достоин большего, \
     но не знаю, как это превратить в деньги»

Сгенерируй РОВНО {n} разных хуков для вертикальных рилзов. Каждый хук должен:
• БИТЬ БОЛЬНО по конкретному триггеру — вскрывать боль, которую человек прячет
• быть максимально коротким и острым (3–6 слов в headline)
• использовать провокацию, противопоставление, жёсткий диагноз или неожиданный разворот
• вызывать реакцию «это про меня» или «да как он посмел» — зритель не должен остаться равнодушным
• избегать банальностей типа «успех рядом», «начни сегодня», «ты сможешь» — только хирургический удар
• НЕ обещать конкретные суммы выручки, проценты роста, «+500к за месяц» и т.п. \
  (это будет подпадать под маркировку рекламы) — работать с чувством, а не с цифрой

ВАЖНО про поле "cta":
• это НЕ призыв к действию — никаких «купи», «закажи», «напиши», «оставь заявку», \
  «переходи», «подписывайся», «получи», «запишись», «узнай подробнее», «жми»
• пиши провокационную финальную фразу 2-4 слова: констатация, вопрос, приговор, вызов
• примеры допустимого: «Это лечится», «Или нет», «Честно ответь», «Решай сам», \
  «Давно пора», «Слабо признать», «Факт», «Тебе решать», «Пока не поздно»

Верни СТРОГО JSON-массив без пояснений, формат:
[
  {{
    "trigger": "категория триггера одним предложением",
    "headline": "ГЛАВНАЯ ФРАЗА КАПСОМ 3-6 СЛОВ",
    "accent": "акцентное слово 1-2 слова",
    "cta": "финальная фраза 2-4 слова без прямого призыва",
    "search_query": "english search query for luxury stock video, 2-4 words"
  }}
]

Примеры search_query: "luxury penthouse sunset", "supercar driving", "private jet", \
"yacht ocean", "rolex watch". Только латиница, только люкс-тематика.
"""


def generate_hooks(client, n):
    model = os.environ.get('LLM_MODEL', 'anthropic/claude-sonnet-4.6')
    resp = client.chat.completions.create(
        model=model,
        max_tokens=2048,
        messages=[{'role': 'user', 'content': HOOK_PROMPT.format(n=n)}],
    )
    text = (resp.choices[0].message.content or '').strip()

    # Strip ```json fences if the model added them.
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if not match:
        raise ValueError(f'Claude did not return a JSON array:\n{text}')
    hooks = json.loads(match.group(0))

    cleaned = []
    for h in hooks:
        cleaned.append({
            'trigger': h.get('trigger', '').strip(),
            'headline': h.get('headline', '').strip().upper(),
            'accent': h.get('accent', '').strip(),
            'cta': h.get('cta', '').strip(),
            'search_query': h.get('search_query', '').strip() or random.choice(LUXURY_QUERIES),
        })
    return cleaned


# --- Step 2: stock video --------------------------------------------------

def fetch_pexels_video(query, api_key, used_ids):
    headers = {'Authorization': api_key}
    params = {'query': query, 'orientation': 'portrait', 'size': 'medium', 'per_page': 15}
    resp = requests.get(PEXELS_API, headers=headers, params=params, timeout=30)
    resp.raise_for_status()
    videos = resp.json().get('videos', [])

    random.shuffle(videos)
    for video in videos:
        if video['id'] in used_ids:
            continue
        if video.get('duration', 0) < CLIP_DURATION_SEC:
            continue
        # Prefer a vertical file around 1080p.
        portrait_files = [
            f for f in video['video_files']
            if f.get('height') and f.get('width') and f['height'] > f['width']
        ]
        if not portrait_files:
            continue
        portrait_files.sort(key=lambda f: abs((f.get('height') or 0) - OUTPUT_H))
        return video['id'], portrait_files[0]['link']
    return None, None


def download_video(url, dest):
    with requests.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        with open(dest, 'wb') as fh:
            for chunk in resp.iter_content(chunk_size=1024 * 256):
                fh.write(chunk)


# --- Step 3: composing the reel ------------------------------------------

MUSIC_EXTENSIONS = ('.mp3', '.m4a', '.wav', '.ogg', '.aac')


def pick_music_track():
    """Returns a random track from ./music/, or None if the folder is empty."""
    music_dir = Path(__file__).parent / 'music'
    if not music_dir.is_dir():
        return None
    tracks = [p for p in music_dir.iterdir()
              if p.is_file() and p.suffix.lower() in MUSIC_EXTENSIONS]
    return random.choice(tracks) if tracks else None


def wrap_headline(text, max_chars_per_line=14):
    words = text.split()
    lines, current = [], ''
    for word in words:
        candidate = f'{current} {word}'.strip()
        if len(candidate) <= max_chars_per_line:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines[:3]  # cap at 3 lines


def compose_reel(src_video, dest_video, hook, headline_font):
    headline_lines = wrap_headline(hook['headline'])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        headline_files = []
        for i, line in enumerate(headline_lines):
            p = tmp / f'hl_{i}.txt'
            p.write_text(line, encoding='utf-8')
            headline_files.append(p)

        cta_file = tmp / 'cta.txt'
        cta_file.write_text(hook['cta'], encoding='utf-8')

        headline_font_esc = ffmpeg_escape_path(headline_font)

        filters = [
            f'fps=25',
            # Oversize slightly so we can pan/zoom inside the crop window.
            f'scale={int(OUTPUT_W * 1.1)}:-2:force_original_aspect_ratio=increase',
            # Time-varying crop gives a subtle zoom-in without zoompan's frame-multiply bug.
            (
                f'crop={OUTPUT_W}:{OUTPUT_H}:'
                f"'(in_w-{OUTPUT_W})/2':'(in_h-{OUTPUT_H})/2'"
            ),
        ]
        # Uniform 10% darkening across the whole frame.
        filters.append('drawbox=x=0:y=0:w=iw:h=ih:color=black@0.10:t=fill')

        # Headline lines, each on its own pink pill, centered in upper third.
        headline_font_size = 120
        line_gap = headline_font_size + 70
        start_y = int(OUTPUT_H * 0.14)
        for i, hf in enumerate(headline_files):
            path = ffmpeg_escape_path(str(hf))
            filters.append(
                f"drawtext=fontfile='{headline_font_esc}':textfile='{path}':"
                f'fontsize={headline_font_size}:fontcolor={COLOR_WHITE}:'
                f'box=1:boxcolor={COLOR_PINK}:boxborderw=30:'
                f'x=(w-text_w)/2:y={start_y + i * line_gap}'
            )

        # CTA in a cyan pill near the bottom: dark text on filled box.
        cta_path = ffmpeg_escape_path(str(cta_file))
        filters.append(
            f"drawtext=fontfile='{headline_font_esc}':textfile='{cta_path}':"
            f'fontsize=80:fontcolor={COLOR_DARK}:'
            f'box=1:boxcolor={COLOR_CYAN}:boxborderw=40:'
            f'x=(w-text_w)/2:y=h*0.83'
        )

        filter_chain = ','.join(filters)

        music_track = pick_music_track()
        cmd = [
            'ffmpeg', '-y',
            '-ss', '0', '-t', str(CLIP_DURATION_SEC),
            '-i', str(src_video),
        ]
        if music_track:
            music_offset = random.uniform(5, 25)
            cmd += [
                '-ss', f'{music_offset:.2f}',
                '-t', str(CLIP_DURATION_SEC),
                '-i', str(music_track),
            ]
        cmd += [
            '-t', str(CLIP_DURATION_SEC),
            '-vf', filter_chain,
            '-r', '25',
        ]
        if music_track:
            cmd += [
                '-map', '0:v:0', '-map', '1:a:0',
                '-af', 'afade=t=in:st=0:d=0.4,'
                       f'afade=t=out:st={CLIP_DURATION_SEC - 0.5:.2f}:d=0.5,'
                       'volume=0.9',
                '-c:a', 'aac', '-b:a', '128k',
                '-shortest',
            ]
        else:
            cmd += ['-an']
        cmd += [
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            str(dest_video),
        ]
        subprocess.run(cmd, check=True, timeout=180)


# --- Step 4: send to Max bot ---------------------------------------------

def _autodetect_target(token):
    last_exc = None
    for attempt in range(4):
        try:
            resp = requests.get(
                f'{MAX_API_BASE}/updates',
                params={'access_token': token, 'limit': 100},
                timeout=(10, 60),
            )
            resp.raise_for_status()
            break
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_exc = exc
            time.sleep(2 ** attempt)
    else:
        raise RuntimeError(f'Max /updates недоступен: {last_exc}')
    data = resp.json()
    updates = data.get('updates', [])
    print(f'Max /updates: получено {len(updates)} событий, типы: '
          f'{[u.get("update_type") for u in updates]}', flush=True)
    for upd in updates:
        msg = upd.get('message') or {}
        recipient = msg.get('recipient') or {}
        sender = msg.get('sender') or {}
        if recipient.get('chat_type') == 'dialog' and sender.get('user_id'):
            return {'user_id': str(sender['user_id'])}
        if recipient.get('chat_id'):
            return {'chat_id': str(recipient['chat_id'])}
        if sender.get('user_id'):
            return {'user_id': str(sender['user_id'])}
    if updates:
        print(f'Max /updates: первое событие целиком: {updates[0]!r}', flush=True)
    return None


def resolve_max_target(token):
    """Возвращает dict {user_id: …} или {chat_id: …} для отправки сообщения."""
    if os.environ.get('MAX_USER_ID'):
        return {'user_id': os.environ['MAX_USER_ID'].strip()}
    if os.environ.get('MAX_CHAT_ID'):
        return {'chat_id': os.environ['MAX_CHAT_ID'].strip()}
    target = _autodetect_target(token)
    if target:
        return target
    raise RuntimeError(
        'Не нашёл адресата. Напишите боту /start в Max и перезапустите, '
        'либо задайте MAX_USER_ID (для личных сообщений) или MAX_CHAT_ID '
        '(для группового чата) в секретах.'
    )


def _decode_json(resp, label):
    try:
        return resp.json()
    except ValueError:
        snippet = (resp.text or '')[:500]
        raise RuntimeError(
            f'{label}: не JSON (status={resp.status_code}, '
            f'content-type={resp.headers.get("content-type")}): {snippet!r}'
        )


def _extract_token_from_url(url):
    # TamTam/Max upload URLs часто включают token как query-параметр.
    from urllib.parse import urlparse, parse_qs
    q = parse_qs(urlparse(url).query)
    for key in ('token', 'upload_token', 'video_token', 'uploadKey'):
        if key in q and q[key]:
            return q[key][0]
    return None


def send_to_max(token, target, file_path, caption):
    # Step 1: запрашиваем upload endpoint.
    up = requests.post(
        f'{MAX_API_BASE}/uploads',
        params={'access_token': token, 'type': 'video'},
        timeout=30,
    )
    if up.status_code == 405:
        up = requests.get(
            f'{MAX_API_BASE}/uploads',
            params={'access_token': token, 'type': 'video'},
            timeout=30,
        )
    if up.status_code >= 400:
        raise RuntimeError(
            f'uploads {up.status_code}: {(up.text or "")[:500]}'
        )
    up_json = _decode_json(up, 'uploads')
    print(f'  uploads response keys: {list(up_json.keys())}')
    upload_url = up_json.get('url')
    if not upload_url:
        raise RuntimeError(f'uploads: в ответе нет url: {up_json}')

    # Токен может быть сразу в ответе первого шага ИЛИ зашит в query upload-URL.
    preset_token = (
        up_json.get('token')
        or up_json.get('video_token')
        or _extract_token_from_url(upload_url)
    )

    # Step 2: льём файл. Upload-сервер Max отвечает либо JSON с token,
    # либо OK-стилевым `<retval>1</retval>` — тогда токен берём из шага 1.
    with open(file_path, 'rb') as fh:
        files = {'data': (Path(file_path).name, fh, 'video/mp4')}
        up_resp = requests.post(upload_url, files=files, timeout=600)
    if up_resp.status_code >= 400:
        raise RuntimeError(
            f'upload {up_resp.status_code}: {(up_resp.text or "")[:500]}'
        )

    video_token = None
    try:
        up_data = up_resp.json()
        video_token = (
            up_data.get('token')
            or (up_data.get('video') or {}).get('token')
            or (up_data.get('videos') or {}).get('token')
        )
    except ValueError:
        body_text = (up_resp.text or '').strip()
        if '<retval>1</retval>' not in body_text:
            raise RuntimeError(
                f'upload: неожиданный ответ (status={up_resp.status_code}): '
                f'{body_text[:500]!r}'
            )

    if not video_token:
        video_token = preset_token
    if not video_token:
        raise RuntimeError(
            f'upload: не смогли получить token. uploads keys={list(up_json.keys())}, '
            f'upload body={(up_resp.text or "")[:300]!r}'
        )

    # Max обрабатывает видео асинхронно — подождём, пока attachment будет готов.
    time.sleep(5)

    body = {
        'text': caption,
        'attachments': [{'type': 'video', 'payload': {'token': video_token}}],
    }
    # Если заданный target не находит диалог — пробуем тот же id как user_id,
    # а последним шансом запрашиваем апдейты и берём реального собеседника
    # (частая ошибка: в MAX_CHAT_ID записан id самого бота).
    targets_to_try = [target]
    if 'chat_id' in target:
        targets_to_try.append({'user_id': target['chat_id']})
    detected = _autodetect_target(token)
    if detected and detected not in targets_to_try:
        targets_to_try.append(detected)

    last_err = None
    for t in targets_to_try:
        for attempt in range(6):
            msg_resp = requests.post(
                f'{MAX_API_BASE}/messages',
                params={'access_token': token, **t},
                json=body,
                timeout=60,
            )
            if msg_resp.status_code < 400:
                return _decode_json(msg_resp, 'messages')
            last_err = f'{msg_resp.status_code}: {(msg_resp.text or "")[:500]}'
            if 'dialog.not.found' in last_err:
                break  # этот target не подходит, переключаемся
            if 'not.ready' in last_err or 'processing' in last_err or msg_resp.status_code in (400, 409):
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f'messages {last_err}')
    raise RuntimeError(f'Max отверг сообщение: {last_err}')


# --- Step 4 (Yandex.Disk) -------------------------------------------------

def _ya_headers(token):
    return {'Authorization': f'OAuth {token}'}


def ensure_yadisk_folder(token, path):
    """Создаёт папку на Я.Диске, если её нет. Принимает путь без `disk:` префикса."""
    parts = [p for p in path.strip('/').split('/') if p]
    cur = ''
    for part in parts:
        cur = f'{cur}/{part}' if cur else part
        resp = requests.put(
            f'{YADISK_API}/resources',
            params={'path': cur},
            headers=_ya_headers(token),
            timeout=30,
        )
        if resp.status_code in (201, 409):
            continue
        raise RuntimeError(f'mkdir {cur}: {resp.status_code} {resp.text[:300]}')


def upload_to_yadisk(token, file_path, remote_path):
    """Заливает файл, возвращает публичную ссылку."""
    info = requests.get(
        f'{YADISK_API}/resources/upload',
        params={'path': remote_path, 'overwrite': 'true'},
        headers=_ya_headers(token),
        timeout=30,
    )
    if info.status_code >= 400:
        raise RuntimeError(f'upload-url {info.status_code}: {info.text[:300]}')
    href = info.json()['href']

    with open(file_path, 'rb') as fh:
        put = requests.put(href, data=fh, timeout=600)
    if put.status_code >= 400:
        raise RuntimeError(f'PUT {put.status_code}: {put.text[:300]}')

    pub = requests.put(
        f'{YADISK_API}/resources/publish',
        params={'path': remote_path},
        headers=_ya_headers(token),
        timeout=30,
    )
    if pub.status_code >= 400:
        raise RuntimeError(f'publish {pub.status_code}: {pub.text[:300]}')

    meta = requests.get(
        f'{YADISK_API}/resources',
        params={'path': remote_path, 'fields': 'public_url,public_key'},
        headers=_ya_headers(token),
        timeout=30,
    )
    meta.raise_for_status()
    return meta.json().get('public_url')


# --- Orchestration --------------------------------------------------------

def safe_filename(text):
    slug = re.sub(r'[^0-9A-Za-zА-Яа-яЁё _-]+', '', text).strip().replace(' ', '_')
    return slug[:60] or 'reel'


def main():
    pexels_key = os.environ['PEXELS_API_KEY']
    yadisk_token = os.environ['YANDEX_DISK_TOKEN']

    headline_font = find_font(HEADLINE_FONT_CANDIDATES)
    print(f'Font: headline={headline_font}')

    llm = OpenAI(
        api_key=os.environ['LLM_API_KEY'],
        base_url=os.environ.get('LLM_BASE_URL', 'https://polza.ai/api/v1'),
    )

    today = datetime.date.today().isoformat()
    remote_dir = f'{YADISK_FOLDER}/{today}'
    ensure_yadisk_folder(yadisk_token, remote_dir)
    print(f'Yandex.Disk folder: /{remote_dir}')

    n = random.randint(REELS_MIN, REELS_MAX)
    print(f'Generating {n} hooks…')
    hooks = generate_hooks(llm, n)

    work_dir = Path(tempfile.mkdtemp(prefix='reels_'))
    used_pexels_ids = set()
    successes = 0
    links = []

    for idx, hook in enumerate(hooks, start=1):
        print(f"\n[{idx}/{len(hooks)}] {hook['trigger']}")
        print(f"  headline='{hook['headline']}' accent='{hook['accent']}'")
        try:
            video_id, video_url = fetch_pexels_video(hook['search_query'], pexels_key, used_pexels_ids)
            if not video_id:
                fallback = random.choice(LUXURY_QUERIES)
                print(f'  no match for "{hook["search_query"]}", retrying with "{fallback}"')
                video_id, video_url = fetch_pexels_video(fallback, pexels_key, used_pexels_ids)
            if not video_id:
                print('  skipped — no suitable stock video')
                continue
            used_pexels_ids.add(video_id)

            raw_path = work_dir / f'raw_{idx}.mp4'
            download_video(video_url, raw_path)

            out_name = f'{today}_{idx:02d}_{safe_filename(hook["headline"])}.mp4'
            out_path = work_dir / out_name
            compose_reel(raw_path, out_path, hook, headline_font)

            remote_path = f'{remote_dir}/{out_name}'
            url = upload_to_yadisk(yadisk_token, out_path, remote_path)
            print(f'  uploaded ✓ {url}')
            links.append((hook['headline'], url))
            successes += 1

            raw_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
        except Exception as exc:
            print(f'  failed: {exc}')
            continue

        time.sleep(1)

    print(f'\nDone. {successes}/{len(hooks)} reels uploaded to /{remote_dir}.')
    for headline, url in links:
        print(f'  • {headline}: {url}')
    if successes == 0:
        raise SystemExit('No reels produced.')


if __name__ == '__main__':
    main()
