"""
Рилзы НЗ — генератор рилзов для девелоперской компании «Новая Земля».

Pipeline:
  1. LLM генерирует 5-6 сценариев по формуле ХУК → ОТВЕТ → РАЗРЫВ ШАБЛОНА
     под целевые аудитории Новой Земли.
  2. Видео берутся из публичной папки Яндекс.Диска (YANDEX_DISK_NZ_SOURCE).
  3. Горизонтальные видео конвертируются в 1080×1920 методом blur-background.
  4. FFmpeg накладывает три блока текста с тайм-кодами и плавной анимацией:
       0–4 с  — ХУК
       5–8 с  — ОТВЕТ
       9–12 с — РАЗРЫВ ШАБЛОНА
     Блок CTA внизу экрана не используется.
  5. В правый нижний угол добавляется планировка (только 100/85/60 м²)
     из папки YANDEX_DISK_NZ_PLANS.
  6. Готовые рилзы загружаются в YANDEX_DISK_NZ_OUTPUT.

Обязательные env-переменные:
  YANDEX_DISK_TOKEN      — OAuth-токен (запись в выходную папку)
  LLM_API_KEY            — ключ Polza.ai / OpenAI-compatible
Опциональные:
  YANDEX_DISK_NZ_SOURCE  — публичная ссылка на папку с исходными видео
  YANDEX_DISK_NZ_PLANS   — публичная ссылка на папку с планировками
  YANDEX_DISK_NZ_OUTPUT  — путь выходной папки (по умолчанию NZ/Reels)
  LLM_BASE_URL           — эндпоинт (по умолчанию https://polza.ai/api/v1)
  LLM_MODEL              — модель (по умолчанию anthropic/claude-sonnet-4.6)
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

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

YADISK_API = 'https://cloud-api.yandex.net/v1/disk'

_NZ_SOURCE_DEFAULT = 'https://disk.yandex.ru/d/I3pJYyGYgBit8A'
_NZ_PLANS_DEFAULT  = 'https://disk.yandex.ru/d/JZTTziGsto60WA'
_NZ_OUTPUT_DEFAULT = 'NZ/Reels'

REELS_MIN = 5
REELS_MAX = 6
CLIP_DURATION_SEC = 12
OUTPUT_W, OUTPUT_H = 1080, 1920

# Timed display windows (seconds within the clip)
HOOK_START,  HOOK_END  = 0.0, 4.0
ANS_START,   ANS_END   = 5.0, 8.0
BREAK_START, BREAK_END = 9.0, 12.0
FADE_DUR = 0.5  # fade-in / fade-out duration

# Brand colour — background under all text, white text on top
COLOR_BRAND = '0x19317B'
COLOR_TEXT  = '0xFFFFFF'

# Exactly these filenames are accepted as floor plans
ALLOWED_PLAN_FILES = {'100.png', '60.png', '85.png'}

VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'}
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}
MUSIC_EXTENSIONS = ('.mp3', '.m4a', '.wav', '.ogg', '.aac')

FONT_DIR = Path(__file__).parent / 'fonts'
FONT_CANDIDATES = [
    'BebasNeuePro-Bold.ttf', 'BebasNeuePro.ttf',
    'bebasneuecyrillic.ttf', 'Oswald.ttf',
    'BebasNeue-Regular.ttf', 'BebasNeue.ttf',
]

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def find_font(candidates: list[str]) -> str:
    for name in candidates:
        p = FONT_DIR / name
        if p.exists():
            return str(p)
    raise FileNotFoundError(f'No usable font in {FONT_DIR}. Tried: {candidates}')


def ffmpeg_escape(path: str) -> str:
    """Escape a file-system path for use inside an FFmpeg filtergraph string."""
    return path.replace('\\', '/').replace(':', r'\:')


def _disk_path(path: str) -> str:
    """Normalise to an absolute Yandex.Disk path (API requires leading /)."""
    p = path.strip('/')
    return f'/{p}' if p else '/'


def pick_music_track() -> Path | None:
    music_dir = Path(__file__).parent / 'music'
    if not music_dir.is_dir():
        return None
    tracks = [p for p in music_dir.iterdir()
              if p.is_file() and p.suffix.lower() in MUSIC_EXTENSIONS]
    return random.choice(tracks) if tracks else None


def wrap_text(text: str, max_chars: int = 22) -> list[str]:
    """Word-wrap text into lines of at most max_chars characters (up to 4 lines)."""
    words = text.split()
    lines, cur = [], ''
    for word in words:
        candidate = f'{cur} {word}'.strip()
        if len(candidate) <= max_chars:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines[:4]


def safe_filename(text: str) -> str:
    slug = re.sub(r'[^0-9A-Za-zА-Яа-яЁё _-]+', '', text).strip().replace(' ', '_')
    return slug[:60] or 'reel'


def _ya_headers(token: str) -> dict:
    return {'Authorization': f'OAuth {token}'}


# ---------------------------------------------------------------------------
# Step 1 — scenario generation (ХУК → ОТВЕТ → РАЗРЫВ ШАБЛОНА)
# ---------------------------------------------------------------------------

NZ_PROMPT = """\
Ты — сценарист коротких вертикальных видео для девелоперской компании «Новая Земля».
Компания продаёт земельные участки и готовые дома (60, 85, 100 м²) в современных
загородных посёлках — комфорт городского уровня рядом с природой.

Целевые аудитории:
• Молодые семьи, которым нужно жильё в связи с расширением семьи
• Молодые семьи с детьми, заботящиеся о здоровом образе жизни
• Семьи, выбирающие между маленькой квартирой и домом за те же деньги
• Семьи, выбирающие: платить аренду чужому или ипотеку за своё
• Семьи с финансовыми возможностями (маткапитал, семейная ипотека)
• Пары среднего возраста, чьи дети выросли — хочется тишины и природы

────────────────────────────────────────────────
ФОРМУЛА СЦЕНАРИЯ (строго соблюдай)
────────────────────────────────────────────────
[ХУК — вопрос-триггер]
[ОТВЕТ — конкретный, цепляющий]
[РАЗРЫВ ШАБЛОНА — неожиданный поворот / образ / факт / эмоция]

ХУК:
• Вопрос, бьющий точно в боль, желание или страх ЦА
• Вызывает мгновенное «это про меня»
• ОБЯЗАТЕЛЬНО заканчивается вопросительным знаком
• Запрещено: «Хотите быть счастливы?», клише, приветствия

ОТВЕТ:
• Прямой и конкретный ответ на вопрос хука
• Выгода — не описание продукта
• Без воды и перечислений

РАЗРЫВ ШАБЛОНА:
• Неожиданный факт, юмор, парадокс, яркий образ, эмоциональный удар
• Не повторяет ответ, удерживает внимание до конца

────────────────────────────────────────────────
РАСПРЕДЕЛЕНИЕ ТИПОВ ХУКОВ (для РОВНО {n} сценариев)
────────────────────────────────────────────────
Страх / потеря             → ≈2
Желание / мечта            → ≈2
Любопытство / парадокс     → ≈1
Конкретная ситуация        → ≈1
(добавь юмор или провокацию если n > 6)

────────────────────────────────────────────────
ПРАВИЛА КАЧЕСТВА
────────────────────────────────────────────────
• Текст каждого блока — не более 20 слов (читается за 3–4 сек.)
• Никаких штампов: «динамично развивающаяся», «профессиональная команда» — запрещены
• Конкретика вместо общих слов
• Первое слово — не название бренда

Верни СТРОГО JSON-массив из РОВНО {n} элементов, без пояснений:
[
  {{
    "hook_type": "тип хука (страх/желание/парадокс/ситуация/юмор/провокация)",
    "hook": "вопрос-триггер — до 20 слов, с ?",
    "answer": "конкретный ответ — до 20 слов",
    "pattern_break": "разрыв шаблона — до 20 слов"
  }}
]"""


def generate_scenarios(client: OpenAI, n: int) -> list[dict]:
    model = os.environ.get('LLM_MODEL') or 'anthropic/claude-sonnet-4.6'
    resp = client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=[{'role': 'user', 'content': NZ_PROMPT.format(n=n)}],
    )
    raw = (resp.choices[0].message.content or '').strip()
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if not match:
        raise ValueError(f'LLM did not return a JSON array:\n{raw}')
    items = json.loads(match.group(0))
    return [
        {
            'hook_type':     s.get('hook_type', '').strip(),
            'hook':          s.get('hook', '').strip(),
            'answer':        s.get('answer', '').strip(),
            'pattern_break': s.get('pattern_break', '').strip(),
        }
        for s in items
    ]


# ---------------------------------------------------------------------------
# Step 2 — list & download files from public Yandex.Disk folders
# ---------------------------------------------------------------------------

def _list_public_folder(public_url: str, extensions: set[str]) -> list[dict]:
    """Returns [{name, path}] for files matching extensions in a public folder."""
    resp = requests.get(
        f'{YADISK_API}/public/resources',
        params={
            'public_key': public_url,
            'limit': 200,
            'fields': '_embedded.items.name,_embedded.items.path,_embedded.items.type',
        },
        timeout=30,
    )
    if resp.status_code == 404:
        raise RuntimeError(f'Public folder not found: {public_url}')
    resp.raise_for_status()
    items = resp.json().get('_embedded', {}).get('items', [])
    return [
        {'name': item['name'], 'path': item.get('path', item['name'])}
        for item in items
        if item.get('type') == 'file'
        and Path(item['name']).suffix.lower() in extensions
    ]


def list_source_videos(source_url: str) -> list[dict]:
    return _list_public_folder(source_url, VIDEO_EXTENSIONS)


def list_floor_plans(plans_url: str) -> list[dict]:
    """Returns only 100/85/60 m² plans from the public folder."""
    try:
        all_files = _list_public_folder(plans_url, IMAGE_EXTENSIONS)
    except Exception as exc:
        print(f'  Warning: could not list floor plans: {exc}')
        return []
    return [f for f in all_files if f['name'] in ALLOWED_PLAN_FILES]


def download_public_file(public_url: str, file_path: str, dest: Path) -> None:
    """Download one file from a public Yandex.Disk folder."""
    info = requests.get(
        f'{YADISK_API}/public/resources/download',
        params={'public_key': public_url, 'path': file_path},
        timeout=30,
    )
    info.raise_for_status()
    with requests.get(info.json()['href'], stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, 'wb') as fh:
            for chunk in r.iter_content(chunk_size=256 * 1024):
                fh.write(chunk)


# ---------------------------------------------------------------------------
# Step 3 — FFmpeg composition
# ---------------------------------------------------------------------------

def get_video_dimensions(path: Path) -> tuple[int, int]:
    """Return (width, height) of the first video stream, honouring rotation."""
    cmd = [
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:stream_tags=rotate',
        '-of', 'json', str(path),
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    data = json.loads(out.stdout)
    stream = (data.get('streams') or [{}])[0]
    w, h = int(stream['width']), int(stream['height'])
    rotate = int((stream.get('tags') or {}).get('rotate', 0))
    if rotate in (90, 270):
        w, h = h, w
    return w, h


def _alpha_expr(t_start: float, t_end: float, fade: float = FADE_DUR) -> str:
    """FFmpeg expression: fade-in for `fade` seconds, hold, fade-out for `fade` seconds."""
    return (
        f"if(lt(t,{t_start + fade}),(t-{t_start})/{fade},"
        f"if(gt(t,{t_end - fade}),({t_end}-t)/{fade},1))"
    )


def compose_reel(
    src: Path,
    dest: Path,
    scenario: dict,
    font: str,
    plan_img: Path | None,
) -> None:
    w, h = get_video_dimensions(src)
    is_horizontal = w > h
    print(f'    source: {w}×{h} → {"convert H→V" if is_horizontal else "vertical OK"}')

    music = pick_music_track()

    # Determine FFmpeg input indices (video is always [0])
    next_idx = 1
    music_idx = plan_idx = None
    if music:
        music_idx = next_idx
        next_idx += 1
    if plan_img:
        plan_idx = next_idx
        next_idx += 1

    font_esc   = ffmpeg_escape(font)
    font_size  = 70
    line_h     = font_size + 28                  # vertical gap between wrapped lines
    text_y0    = int(OUTPUT_H * 0.27)            # top of text area (≈516 px from top)
    plan_w     = 260                             # floor-plan image width (px)
    plan_alpha = 0.82                            # floor-plan opacity

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)

        def write_lines(key: str) -> list[Path]:
            text = scenario.get(key, '').strip() or '…'
            files = []
            for i, line in enumerate(wrap_text(text, max_chars=22)):
                p = tmp / f'{key}_{i}.txt'
                p.write_text(line, encoding='utf-8')
                files.append(p)
            return files

        hook_files  = write_lines('hook')
        ans_files   = write_lines('answer')
        break_files = write_lines('pattern_break')

        # ── Build filter_complex ──────────────────────────────────────────

        fc: list[str] = []

        # 1. Base video: horizontal → blur-background pillarbox; vertical → scale+crop
        if is_horizontal:
            fc.append('[0:v]fps=25,split=2[bg_raw][fg_raw]')
            fc.append(
                f'[bg_raw]scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=increase,'
                f'crop={OUTPUT_W}:{OUTPUT_H},'
                f'boxblur=luma_radius=30:luma_power=1[bg]'
            )
            fc.append(
                f'[fg_raw]scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=decrease[fg]'
            )
            fc.append(f'[bg][fg]overlay=(W-w)/2:(H-h)/2[base]')
        else:
            fc.append(
                f'[0:v]fps=25,'
                f'scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=increase,'
                f'crop={OUTPUT_W}:{OUTPUT_H}[base]'
            )

        # 2. Subtle darkening
        fc.append('[base]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.12:t=fill[dark]')
        cur = '[dark]'

        # 3. Floor-plan overlay — bottom-right corner, semi-transparent
        if plan_idx is not None:
            fc.append(
                f'[{plan_idx}:v]'
                f'scale={plan_w}:-1,'
                f'format=rgba,'
                f'colorchannelmixer=aa={plan_alpha}'
                f'[plan]'
            )
            fc.append(f'{cur}[plan]overlay=W-w-30:H-h-120[after_plan]')
            cur = '[after_plan]'

        # 4. Helper: append drawtext filters for one timed text block
        def add_text_block(
            text_files: list[Path],
            t_start: float,
            t_end: float,
            prefix: str,
        ) -> None:
            nonlocal cur
            if not text_files:
                return
            alpha  = _alpha_expr(t_start, t_end)
            enable = f"between(t,{t_start},{t_end})"
            for i, tf in enumerate(text_files):
                path_esc = ffmpeg_escape(str(tf))
                y = text_y0 + i * line_h
                nxt = f'[{prefix}{i}]'
                fc.append(
                    f"{cur}"
                    f"drawtext="
                    f"fontfile='{font_esc}':"
                    f"textfile='{path_esc}':"
                    f"fontsize={font_size}:"
                    f"fontcolor={COLOR_TEXT}:"
                    f"box=1:"
                    f"boxcolor={COLOR_BRAND}:"
                    f"boxborderw=22:"
                    f"x=(w-text_w)/2:"
                    f"y={y}:"
                    f"enable='{enable}':"
                    f"alpha='{alpha}'"
                    f"{nxt}"
                )
                cur = nxt

        add_text_block(hook_files,  HOOK_START,  HOOK_END,  'h')
        add_text_block(ans_files,   ANS_START,   ANS_END,   'a')
        add_text_block(break_files, BREAK_START, BREAK_END, 'b')

        # Rename the last generated output label to [final]
        fc[-1] = re.sub(r'\[[hab]\d+\]$', '[final]', fc[-1])

        filter_complex = ';'.join(fc)

        # ── Build ffmpeg command ──────────────────────────────────────────

        cmd = [
            'ffmpeg', '-y',
            # -stream_loop -1 loops the source video infinitely so clips shorter
            # than CLIP_DURATION_SEC are extended; -t caps the read at 12 s.
            '-stream_loop', '-1',
            '-t', str(CLIP_DURATION_SEC),
            '-i', str(src),
        ]
        if music and music_idx is not None:
            offset = random.uniform(5, 25)
            cmd += ['-ss', f'{offset:.2f}', '-t', str(CLIP_DURATION_SEC),
                    '-i', str(music)]
        if plan_img and plan_idx is not None:
            # -loop 1 turns the still image into an infinite stream so the
            # overlay filter never terminates the pipeline early.
            cmd += ['-loop', '1', '-t', str(CLIP_DURATION_SEC), '-i', str(plan_img)]

        cmd += [
            '-t', str(CLIP_DURATION_SEC),
            '-filter_complex', filter_complex,
            '-map', '[final]',
            '-r', '25',
        ]

        if music and music_idx is not None:
            cmd += [
                '-map', f'{music_idx}:a:0',
                '-af', (
                    'afade=t=in:st=0:d=0.4,'
                    f'afade=t=out:st={CLIP_DURATION_SEC - 0.5:.2f}:d=0.5,'
                    'volume=0.9'
                ),
                '-c:a', 'aac', '-b:a', '128k',
                '-shortest',
            ]
        else:
            cmd += ['-an']

        cmd += [
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            str(dest),
        ]
        subprocess.run(cmd, check=True, timeout=300)


# ---------------------------------------------------------------------------
# Step 4 — upload finished reels to Yandex.Disk
# ---------------------------------------------------------------------------

def ensure_yadisk_folder(token: str, path: str) -> None:
    parts = [p for p in path.strip('/').split('/') if p]
    for i in range(1, len(parts) + 1):
        cur = '/' + '/'.join(parts[:i])
        r = requests.put(
            f'{YADISK_API}/resources',
            params={'path': cur},
            headers=_ya_headers(token),
            timeout=30,
        )
        if r.status_code not in (201, 409):
            raise RuntimeError(f'mkdir {cur}: {r.status_code} {r.text[:300]}')


def upload_to_yadisk(token: str, file_path: Path, remote_path: str) -> str | None:
    remote_path = _disk_path(remote_path)
    info = requests.get(
        f'{YADISK_API}/resources/upload',
        params={'path': remote_path, 'overwrite': 'true'},
        headers=_ya_headers(token),
        timeout=30,
    )
    if info.status_code >= 400:
        raise RuntimeError(f'upload-url {info.status_code}: {info.text[:300]}')

    with open(file_path, 'rb') as fh:
        put = requests.put(info.json()['href'], data=fh, timeout=600)
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
        params={'path': remote_path, 'fields': 'public_url'},
        headers=_ya_headers(token),
        timeout=30,
    )
    meta.raise_for_status()
    return meta.json().get('public_url')


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main() -> None:
    yadisk_token  = os.environ['YANDEX_DISK_TOKEN']
    source_url    = os.environ.get('YANDEX_DISK_NZ_SOURCE') or _NZ_SOURCE_DEFAULT
    plans_url     = os.environ.get('YANDEX_DISK_NZ_PLANS')  or _NZ_PLANS_DEFAULT
    output_folder = os.environ.get('YANDEX_DISK_NZ_OUTPUT') or _NZ_OUTPUT_DEFAULT

    if output_folder.startswith('http'):
        raise SystemExit(
            f'YANDEX_DISK_NZ_OUTPUT выглядит как URL: {output_folder!r}\n'
            'Укажите путь к папке, например "NZ/Reels".'
        )

    font = find_font(FONT_CANDIDATES)
    print(f'Font: {font}')

    llm = OpenAI(
        api_key=os.environ['LLM_API_KEY'],
        base_url=os.environ.get('LLM_BASE_URL') or 'https://polza.ai/api/v1',
    )

    today      = datetime.date.today().isoformat()
    remote_dir = _disk_path(f'{output_folder.strip("/")}/{today}')
    ensure_yadisk_folder(yadisk_token, remote_dir)
    print(f'Output folder: {remote_dir}')

    # Source videos
    print(f'Listing videos: {source_url}')
    videos = list_source_videos(source_url)
    if not videos:
        raise SystemExit(f'No video files found at {source_url}')
    print(f'Found {len(videos)} video(s)')
    random.shuffle(videos)

    # Floor plans (100/85/60 m² only)
    print(f'Listing floor plans: {plans_url}')
    plans = list_floor_plans(plans_url)
    print(f'Found {len(plans)} matching plan(s): {[p["name"] for p in plans]}')

    n = random.randint(REELS_MIN, REELS_MAX)
    n = min(n, len(videos))
    print(f'Generating {n} scenarios…')
    scenarios = generate_scenarios(llm, n)

    work_dir  = Path(tempfile.mkdtemp(prefix='nz_reels_'))
    successes = 0
    links: list[tuple[str, str]] = []

    for idx, (sc, video_info) in enumerate(zip(scenarios, videos), start=1):
        print(f'\n[{idx}/{n}] [{sc["hook_type"]}]')
        print(f'  hook="{sc["hook"]}"')
        print(f'  video="{video_info["name"]}"')
        try:
            # Download source video
            raw = work_dir / f'raw_{idx}_{video_info["name"]}'
            print('  Downloading video…')
            download_public_file(source_url, video_info['path'], raw)

            # Download floor plan
            plan_img: Path | None = None
            if plans:
                plan_info = random.choice(plans)
                plan_img  = work_dir / f'plan_{idx}{Path(plan_info["name"]).suffix}'
                print(f'  Downloading plan: {plan_info["name"]}…')
                try:
                    download_public_file(plans_url, plan_info['path'], plan_img)
                except Exception as exc:
                    print(f'  Plan download failed ({exc}), skipping overlay')
                    plan_img = None

            out_name = f'{today}_{idx:02d}_{safe_filename(sc["hook"])}.mp4'
            out_path = work_dir / out_name
            print('  Composing…')
            compose_reel(raw, out_path, sc, font, plan_img)

            remote_path = f'{remote_dir}/{out_name}'
            url = upload_to_yadisk(yadisk_token, out_path, remote_path)
            print(f'  Uploaded ✓  {url}')
            links.append((sc['hook'], url))
            successes += 1

            raw.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
            if plan_img:
                plan_img.unlink(missing_ok=True)

        except Exception as exc:
            print(f'  FAILED: {exc}')

        time.sleep(1)

    print(f'\nDone. {successes}/{n} reels → {remote_dir}')
    for hook, url in links:
        print(f'  • {hook}: {url}')
    if successes == 0:
        raise SystemExit('No reels produced.')


if __name__ == '__main__':
    main()
