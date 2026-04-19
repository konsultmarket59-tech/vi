"""
Marketing-agency reels generator.

Daily:
  1. Claude generates 5-6 hooks based on triggers of the target audience
     (Russian entrepreneurs, 25-55, men & women).
  2. For each hook, a vertical luxury-lifestyle clip is downloaded from Pexels.
  3. FFmpeg composes a 1080x1920 MP4 with brand colors and fonts.
  4. The reel is sent to the user via a Max messenger bot.
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
COLOR_PINK = '0xFE3268'
COLOR_CYAN = '0x00D4FF'
COLOR_DARK = '0x2A2A2A'
COLOR_WHITE = '0xF5F5F5'

# Fonts — paid versions win if the user dropped them in fonts/.
FONT_DIR = Path(__file__).parent / 'fonts'
HEADLINE_FONT_CANDIDATES = [
    'BebasNeuePro-Bold.ttf',
    'BebasNeuePro.ttf',
    'BebasNeue-Regular.ttf',
    'BebasNeue.ttf',
]
ACCENT_FONT_CANDIDATES = [
    'MartinaScript.ttf',
    'Martina-Script.ttf',
    'DancingScript-Bold.ttf',
    'DancingScript.ttf',
    'DancingScript[wght].ttf',
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
• у них есть триггеры трёх типов:
  1. бизнес-триггеры: выгорание, слабый маркетинг, устаревший бренд, низкие продажи, \
     отсутствие системы, застой, невидимость на фоне конкурентов, кассовые разрывы
  2. триггеры руководителя: одиночество наверху, страх потерять команду, недоверие к найму, \
     усталость от ручного управления, синдром самозванца
  3. возрастные и гендерные триггеры: 25–35 «нужно успеть», 35–45 «второе дыхание», \
     45–55 «оставить наследие»; у женщин — баланс семья/карьера, видимость, экспертность; \
     у мужчин — статус, масштаб, признание

Сгенерируй РОВНО {n} разных хуков для вертикальных рилзов. Каждый хук должен:
• бить точно в один триггер
• быть коротким (3–6 слов в заголовке, 1–2 слова в акценте)
• работать без контекста — зритель должен замереть в первые 2 секунды
• использовать провокацию, противопоставление или обещание результата

Верни СТРОГО JSON-массив без пояснений, формат:
[
  {{
    "trigger": "категория триггера одним предложением",
    "headline": "ГЛАВНАЯ ФРАЗА КАПСОМ 3-6 СЛОВ",
    "accent": "акцентное слово 1-2 слова",
    "cta": "короткий CTA 2-4 слова",
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


def compose_reel(src_video, dest_video, hook, headline_font, accent_font):
    headline_lines = wrap_headline(hook['headline'])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        headline_files = []
        for i, line in enumerate(headline_lines):
            p = tmp / f'hl_{i}.txt'
            p.write_text(line, encoding='utf-8')
            headline_files.append(p)

        accent_file = tmp / 'accent.txt'
        accent_file.write_text(hook['accent'], encoding='utf-8')

        cta_file = tmp / 'cta.txt'
        cta_file.write_text(hook['cta'], encoding='utf-8')

        headline_font_esc = ffmpeg_escape_path(headline_font)
        accent_font_esc = ffmpeg_escape_path(accent_font)

        filters = [
            f'fps=25',
            # Oversize slightly so we can pan/zoom inside the crop window.
            f'scale={int(OUTPUT_W * 1.1)}:-2:force_original_aspect_ratio=increase',
            # Time-varying crop gives a subtle zoom-in without zoompan's frame-multiply bug.
            (
                f'crop={OUTPUT_W}:{OUTPUT_H}:'
                f"'(in_w-{OUTPUT_W})/2':'(in_h-{OUTPUT_H})/2'"
            ),
            f'drawbox=x=0:y=0:w=iw:h=ih*0.45:color=black@0.45:t=fill',
            f'drawbox=x=0:y=ih*0.75:w=iw:h=ih*0.25:color=black@0.55:t=fill',
            f'drawbox=x=iw*0.1:y=ih*0.62:w=iw*0.8:h=4:color={COLOR_CYAN}:t=fill',
        ]

        # Headline lines, centered horizontally, stacked in upper third.
        headline_font_size = 120
        line_gap = headline_font_size + 20
        start_y = int(OUTPUT_H * 0.15)
        for i, hf in enumerate(headline_files):
            path = ffmpeg_escape_path(str(hf))
            filters.append(
                f"drawtext=fontfile='{headline_font_esc}':textfile='{path}':"
                f'fontsize={headline_font_size}:fontcolor={COLOR_WHITE}:'
                f'borderw=3:bordercolor={COLOR_DARK}:'
                f'x=(w-text_w)/2:y={start_y + i * line_gap}'
            )

        # Accent word in script font, brand pink, middle-lower.
        accent_path = ffmpeg_escape_path(str(accent_file))
        filters.append(
            f"drawtext=fontfile='{accent_font_esc}':textfile='{accent_path}':"
            f'fontsize=180:fontcolor={COLOR_PINK}:'
            f'borderw=2:bordercolor={COLOR_DARK}:'
            f'x=(w-text_w)/2:y=h*0.48'
        )

        # CTA at the bottom in cyan, bold headline font.
        cta_path = ffmpeg_escape_path(str(cta_file))
        filters.append(
            f"drawtext=fontfile='{headline_font_esc}':textfile='{cta_path}':"
            f'fontsize=70:fontcolor={COLOR_CYAN}:'
            f'borderw=2:bordercolor={COLOR_DARK}:'
            f'x=(w-text_w)/2:y=h*0.85'
        )

        filter_chain = ','.join(filters)

        cmd = [
            'ffmpeg', '-y',
            '-ss', '0', '-t', str(CLIP_DURATION_SEC),
            '-i', str(src_video),
            '-t', str(CLIP_DURATION_SEC),
            '-vf', filter_chain,
            '-r', '25',
            '-an',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            str(dest_video),
        ]
        subprocess.run(cmd, check=True, timeout=180)


# --- Step 4: send to Max bot ---------------------------------------------

def resolve_max_chat_id(token):
    chat_id = os.environ.get('MAX_CHAT_ID')
    if chat_id:
        return chat_id.strip()

    resp = requests.get(
        f'{MAX_API_BASE}/updates',
        params={'access_token': token, 'limit': 100},
        timeout=30,
    )
    resp.raise_for_status()
    updates = resp.json().get('updates', [])
    for upd in updates:
        msg = upd.get('message') or {}
        recipient = msg.get('recipient') or {}
        cid = recipient.get('chat_id')
        if cid:
            return str(cid)
    raise RuntimeError(
        'Не нашёл chat_id. Напишите боту /start в Max и перезапустите, '
        'либо задайте MAX_CHAT_ID в секретах.'
    )


def send_to_max(token, chat_id, file_path, caption):
    up = requests.post(
        f'{MAX_API_BASE}/uploads',
        params={'access_token': token, 'type': 'video'},
        timeout=30,
    )
    up.raise_for_status()
    upload_url = up.json()['url']

    with open(file_path, 'rb') as fh:
        files = {'data': (Path(file_path).name, fh, 'video/mp4')}
        up_resp = requests.post(upload_url, files=files, timeout=600)
    up_resp.raise_for_status()
    up_data = up_resp.json()
    video_token = (
        up_data.get('token')
        or (up_data.get('video') or {}).get('token')
        or (up_data.get('videos') or {}).get('token')
    )
    if not video_token:
        raise RuntimeError(f'В ответе на загрузку нет token: {up_data}')

    # Max обрабатывает видео асинхронно — подождём немного, чтобы attachment
    # успел стать доступным.
    time.sleep(3)

    body = {
        'text': caption,
        'attachments': [{'type': 'video', 'payload': {'token': video_token}}],
    }
    last_err = None
    for attempt in range(5):
        msg_resp = requests.post(
            f'{MAX_API_BASE}/messages',
            params={'access_token': token, 'chat_id': chat_id},
            json=body,
            timeout=60,
        )
        if msg_resp.status_code < 400:
            return msg_resp.json()
        last_err = msg_resp.text
        # attachment.not.ready — типичный ответ, пока Max переваривает видео.
        if 'not.ready' in last_err or msg_resp.status_code in (400, 409):
            time.sleep(5 * (attempt + 1))
            continue
        msg_resp.raise_for_status()
    raise RuntimeError(f'Max отверг сообщение после 5 попыток: {last_err}')


# --- Orchestration --------------------------------------------------------

def safe_filename(text):
    slug = re.sub(r'[^0-9A-Za-zА-Яа-яЁё _-]+', '', text).strip().replace(' ', '_')
    return slug[:60] or 'reel'


def main():
    pexels_key = os.environ['PEXELS_API_KEY']
    max_token = os.environ['MAX_BOT_TOKEN']

    headline_font = find_font(HEADLINE_FONT_CANDIDATES)
    accent_font = find_font(ACCENT_FONT_CANDIDATES)
    print(f'Fonts: headline={headline_font}, accent={accent_font}')

    llm = OpenAI(
        api_key=os.environ['LLM_API_KEY'],
        base_url=os.environ.get('LLM_BASE_URL', 'https://polza.ai/api/v1'),
    )

    chat_id = resolve_max_chat_id(max_token)
    print(f'Max chat_id: {chat_id}')

    n = random.randint(REELS_MIN, REELS_MAX)
    print(f'Generating {n} hooks…')
    hooks = generate_hooks(llm, n)

    today = datetime.date.today().isoformat()
    work_dir = Path(tempfile.mkdtemp(prefix='reels_'))
    used_pexels_ids = set()
    successes = 0

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
            compose_reel(raw_path, out_path, hook, headline_font, accent_font)

            caption = (
                f"#{idx} · {today}\n"
                f"Триггер: {hook['trigger']}\n"
                f"{hook['headline']} · {hook['accent']}\n"
                f"CTA: {hook['cta']}"
            )
            send_to_max(max_token, chat_id, out_path, caption)
            print('  sent to Max ✓')
            successes += 1

            raw_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
        except Exception as exc:
            print(f'  failed: {exc}')
            continue

        time.sleep(1)

    print(f'\nDone. {successes}/{len(hooks)} reels sent to Max chat {chat_id}.')
    if successes == 0:
        raise SystemExit('No reels produced.')


if __name__ == '__main__':
    main()
