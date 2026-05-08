"""
Boldino LIFE (Perm) reels generator.

Daily pipeline:
  1. Claude generates 5-6 hooks targeting the cottage-village audience triggers
     (young families, status buyers, remote workers, retirees, investors).
  2. Source videos are fetched from a public Yandex.Disk folder
     (env YANDEX_DISK_BOLDINO_SOURCE — a public share URL).
  3. Horizontal videos are converted to 1080x1920 vertical via blur-background
     technique; already-vertical clips are scaled and cropped normally.
  4. FFmpeg adds a hook headline + CTA overlay with background colour #19317B.
  5. Finished reels are uploaded to a private Yandex.Disk output folder
     (env YANDEX_DISK_BOLDINO_OUTPUT).

Required env vars:
  YANDEX_DISK_TOKEN            — OAuth token (for writing the output folder)
  YANDEX_DISK_BOLDINO_SOURCE   — public share URL of the source video folder
                                  e.g. https://disk.yandex.ru/d/I3pJYyGYgBit8A
  YANDEX_DISK_BOLDINO_OUTPUT   — path inside the owner's disk for output
                                  e.g. Boldino/Reels  (default)
  LLM_API_KEY                  — Polza.ai / OpenAI-compatible key
  LLM_BASE_URL                 — optional, defaults to https://polza.ai/api/v1
  LLM_MODEL                    — optional, defaults to anthropic/claude-sonnet-4.6
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

BOLDINO_SOURCE_URL = os.environ.get(
    'YANDEX_DISK_BOLDINO_SOURCE',
    'https://disk.yandex.ru/d/I3pJYyGYgBit8A',
)
BOLDINO_OUTPUT_FOLDER = os.environ.get('YANDEX_DISK_BOLDINO_OUTPUT', 'Boldino/Reels')

REELS_MIN = 5
REELS_MAX = 6
CLIP_DURATION_SEC = 12
OUTPUT_W, OUTPUT_H = 1080, 1920

# Brand palette — #19317B background under all text, white text on top.
COLOR_BRAND = '0x19317B'
COLOR_TEXT = '0xFFFFFF'

VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'}
MUSIC_EXTENSIONS = ('.mp3', '.m4a', '.wav', '.ogg', '.aac')

FONT_DIR = Path(__file__).parent / 'fonts'
HEADLINE_FONT_CANDIDATES = [
    'BebasNeuePro-Bold.ttf',
    'BebasNeuePro.ttf',
    'bebasneuecyrillic.ttf',
    'Oswald.ttf',
    'BebasNeue-Regular.ttf',
    'BebasNeue.ttf',
]

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def find_font(candidates):
    for name in candidates:
        p = FONT_DIR / name
        if p.exists():
            return str(p)
    raise FileNotFoundError(
        f'No usable font in {FONT_DIR}. Looked for: {candidates}'
    )


def ffmpeg_escape(path: str) -> str:
    """Escape a file path for use inside an FFmpeg filtergraph string."""
    return path.replace('\\', '/').replace(':', r'\:')


def pick_music_track():
    music_dir = Path(__file__).parent / 'music'
    if not music_dir.is_dir():
        return None
    tracks = [p for p in music_dir.iterdir()
              if p.is_file() and p.suffix.lower() in MUSIC_EXTENSIONS]
    return random.choice(tracks) if tracks else None


def wrap_text(text: str, max_chars: int = 14) -> list[str]:
    """Split text into lines of at most max_chars characters (up to 3 lines)."""
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
    return lines[:3]


def safe_filename(text: str) -> str:
    slug = re.sub(r'[^0-9A-Za-zА-Яа-яЁё _-]+', '', text).strip().replace(' ', '_')
    return slug[:60] or 'reel'


# ---------------------------------------------------------------------------
# Step 1 — audience-trigger hook generation
# ---------------------------------------------------------------------------

BOLDINO_PROMPT = """\
Ты — маркетинговый стратег по загородной недвижимости в России.

Целевая аудитория коттеджного посёлка (ИЖС, населённый пункт, 20 км от города):

1. Молодые семьи (28–38 лет, 1–2 ребёнка):
   - тесная квартира, у детей нет своей комнаты
   - страх за здоровье детей в городском смоге
   - нет безопасного двора, нельзя выпустить ребёнка одного
   - школьная логистика отнимает всё время
   - «стены давят», хочется своего пространства

2. Статусные прагматики (40–55 лет, высокий доход):
   - устал от соседей, шума, управляющей компании
   - хочет принимать гостей достойно
   - мечтает о бане, саде, гараже на 2 машины
   - ценит тишину и приватность
   - «я уже могу позволить — так почему до сих пор не сделал?»

3. Удалённые профессионалы (25–35 лет, IT/digital):
   - квартира стала одновременно офисом и спальней
   - мечтает о кабинете с видом на природу
   - хочет чистый воздух, но без потери города (20 мин)
   - важна стабильность электричества и интернета

4. Активные пенсионеры (55–65 лет):
   - надоела городская суета, хочется земли и тишины
   - мечтает о саду и месте для внуков
   - беспокоит дорогая коммуналка и лифт
   - хочет здоровый воздух и активную жизнь

5. Рациональные инвесторы (30–50 лет):
   - деньги на вкладе обесцениваются
   - земля — твёрдый актив
   - интересен момент входа на старте

Сгенерируй РОВНО {n} разных хуков для вертикальных видео. Каждый хук:
• бьёт в боль конкретного сегмента — вскрывает то, что человек прячет
• headline — 3–6 слов КАПСОМ, острая фраза, без банальностей
• accent — 1–2 акцентных слова
• cta — провокационная финальная фраза 2–4 слова; НЕ призыв к действию,
  а констатация, диагноз или риторический вопрос
• НЕ упоминает конкретные цены, проценты роста, суммы доходности
  (это требует маркировки рекламы)
• НЕ содержит прямых призывов: «купи», «звони», «запишись», «переходи»,
  «оставь заявку», «узнай цену»
• работает с эмоцией и ситуацией, не с коммерческим предложением

Примеры допустимого cta: «Пора менять», «Или нет», «Ещё год так»,
«Давно пора», «Подумай об этом», «Факт», «Честно ответь», «Слабо признать»

Верни СТРОГО JSON-массив, без пояснений:
[
  {{
    "trigger": "сегмент и триггер одним предложением",
    "headline": "ГЛАВНАЯ ФРАЗА КАПСОМ 3-6 СЛОВ",
    "accent": "акцентное слово 1-2 слова",
    "cta": "финальная фраза 2-4 слова"
  }}
]
"""


def generate_hooks(client: OpenAI, n: int) -> list[dict]:
    model = os.environ.get('LLM_MODEL', 'anthropic/claude-sonnet-4.6')
    resp = client.chat.completions.create(
        model=model,
        max_tokens=2048,
        messages=[{'role': 'user', 'content': BOLDINO_PROMPT.format(n=n)}],
    )
    raw = (resp.choices[0].message.content or '').strip()
    match = re.search(r'\[.*\]', raw, re.DOTALL)
    if not match:
        raise ValueError(f'LLM did not return a JSON array:\n{raw}')
    hooks = json.loads(match.group(0))
    return [
        {
            'trigger':  h.get('trigger', '').strip(),
            'headline': h.get('headline', '').strip().upper(),
            'accent':   h.get('accent', '').strip(),
            'cta':      h.get('cta', '').strip(),
        }
        for h in hooks
    ]


# ---------------------------------------------------------------------------
# Step 2 — list & download source videos from public Yandex.Disk folder
# ---------------------------------------------------------------------------

def list_public_videos(public_url: str) -> list[dict]:
    """
    Returns a list of {name, path} dicts for video files in the public folder.
    Uses the Yandex.Disk public resources API (no auth required).
    """
    resp = requests.get(
        f'{YADISK_API}/public/resources',
        params={
            'public_key': public_url,
            'limit': 100,
            'fields': '_embedded.items.name,_embedded.items.path,_embedded.items.media_type,_embedded.items.type',
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
        and Path(item['name']).suffix.lower() in VIDEO_EXTENSIONS
    ]


def download_public_file(public_url: str, file_path: str, dest: Path) -> None:
    """
    Downloads one file from a public Yandex.Disk folder.
    file_path is the relative path inside the shared folder (e.g. '/video.mp4').
    """
    info = requests.get(
        f'{YADISK_API}/public/resources/download',
        params={'public_key': public_url, 'path': file_path},
        timeout=30,
    )
    info.raise_for_status()
    href = info.json()['href']

    with requests.get(href, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(dest, 'wb') as fh:
            for chunk in r.iter_content(chunk_size=256 * 1024):
                fh.write(chunk)


# ---------------------------------------------------------------------------
# Step 3 — compose reel with FFmpeg
# ---------------------------------------------------------------------------

def get_video_dimensions(video_path: Path) -> tuple[int, int]:
    """Returns (width, height) of the first video stream, honouring rotation."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:stream_tags=rotate',
        '-of', 'json',
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    stream = (data.get('streams') or [{}])[0]
    w, h = int(stream['width']), int(stream['height'])
    rotate = int((stream.get('tags') or {}).get('rotate', 0))
    if rotate in (90, 270):
        w, h = h, w
    return w, h


def _build_filter_complex(
    is_horizontal: bool,
    headline_files: list[Path],
    cta_file: Path,
    font_esc: str,
) -> str:
    """
    Assembles the FFmpeg filter_complex string.

    For horizontal input  → blurred background + centred clear foreground (pillarbox+blur).
    For vertical input    → scale+crop to 1080×1920.
    Both paths then add: 10% darkening, headline pills, CTA pill.
    All text boxes use background colour #19317B with white text.
    """
    parts = []

    if is_horizontal:
        parts.append(f'[0:v]fps=25,split=2[bg_raw][fg_raw]')
        parts.append(
            f'[bg_raw]'
            f'scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=increase,'
            f'crop={OUTPUT_W}:{OUTPUT_H},'
            f'boxblur=luma_radius=30:luma_power=1'
            f'[bg]'
        )
        parts.append(
            f'[fg_raw]'
            f'scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=decrease'
            f'[fg]'
        )
        parts.append(f'[bg][fg]overlay=(W-w)/2:(H-h)/2[base]')
    else:
        parts.append(
            f'[0:v]'
            f'fps=25,'
            f'scale={OUTPUT_W}:{OUTPUT_H}:force_original_aspect_ratio=increase,'
            f'crop={OUTPUT_W}:{OUTPUT_H}'
            f'[base]'
        )

    # 10 % uniform darkening
    parts.append(
        '[base]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.10:t=fill[dark]'
    )
    cur = '[dark]'

    # Headline lines — each on its own #19317B pill
    font_size_hl = 120
    line_gap = font_size_hl + 70
    start_y = int(OUTPUT_H * 0.14)

    for i, hf in enumerate(headline_files):
        path_esc = ffmpeg_escape(str(hf))
        nxt = f'[hl{i}]'
        parts.append(
            f"{cur}"
            f"drawtext="
            f"fontfile='{font_esc}':"
            f"textfile='{path_esc}':"
            f"fontsize={font_size_hl}:"
            f"fontcolor={COLOR_TEXT}:"
            f"box=1:"
            f"boxcolor={COLOR_BRAND}:"
            f"boxborderw=30:"
            f"x=(w-text_w)/2:"
            f"y={start_y + i * line_gap}"
            f"{nxt}"
        )
        cur = nxt

    # CTA — #19317B pill near bottom
    cta_esc = ffmpeg_escape(str(cta_file))
    parts.append(
        f"{cur}"
        f"drawtext="
        f"fontfile='{font_esc}':"
        f"textfile='{cta_esc}':"
        f"fontsize=80:"
        f"fontcolor={COLOR_TEXT}:"
        f"box=1:"
        f"boxcolor={COLOR_BRAND}:"
        f"boxborderw=40:"
        f"x=(w-text_w)/2:"
        f"y=h*0.83"
        f"[final]"
    )

    return ';'.join(parts)


def compose_reel(src: Path, dest: Path, hook: dict, font: str) -> None:
    w, h = get_video_dimensions(src)
    is_horizontal = w > h
    print(f'    source dims: {w}×{h} → {"horizontal→vertical" if is_horizontal else "vertical"}')

    lines = wrap_text(hook['headline'])

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        headline_files = []
        for i, line in enumerate(lines):
            p = tmp / f'hl_{i}.txt'
            p.write_text(line, encoding='utf-8')
            headline_files.append(p)

        cta_file = tmp / 'cta.txt'
        cta_file.write_text(hook['cta'], encoding='utf-8')

        font_esc = ffmpeg_escape(font)
        fc = _build_filter_complex(is_horizontal, headline_files, cta_file, font_esc)

        music = pick_music_track()
        cmd = [
            'ffmpeg', '-y',
            '-ss', '0', '-t', str(CLIP_DURATION_SEC),
            '-i', str(src),
        ]
        if music:
            offset = random.uniform(5, 25)
            cmd += ['-ss', f'{offset:.2f}', '-t', str(CLIP_DURATION_SEC),
                    '-i', str(music)]

        cmd += [
            '-t', str(CLIP_DURATION_SEC),
            '-filter_complex', fc,
            '-map', '[final]',
            '-r', '25',
        ]
        if music:
            cmd += [
                '-map', '1:a:0',
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
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            str(dest),
        ]
        subprocess.run(cmd, check=True, timeout=300)


# ---------------------------------------------------------------------------
# Step 4 — upload finished reel to private Yandex.Disk output folder
# ---------------------------------------------------------------------------

def _ya_headers(token: str) -> dict:
    return {'Authorization': f'OAuth {token}'}


def _disk_path(path: str) -> str:
    """Normalise to an absolute Yandex.Disk path (must start with /)."""
    p = path.strip('/')
    return f'/{p}' if p else '/'


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
    yadisk_token = os.environ['YANDEX_DISK_TOKEN']
    # Use `or` so that an empty-string secret (GitHub Actions sets unset secrets
    # to "") still falls back to the hardcoded default.
    source_url = os.environ.get('YANDEX_DISK_BOLDINO_SOURCE') or BOLDINO_SOURCE_URL
    output_dir = os.environ.get('YANDEX_DISK_BOLDINO_OUTPUT') or 'Boldino/Reels'

    if output_dir.startswith('http'):
        raise SystemExit(
            f'YANDEX_DISK_BOLDINO_OUTPUT looks like a URL: {output_dir!r}\n'
            'Set it to a folder path, e.g. "Boldino/Reels".'
        )

    font = find_font(HEADLINE_FONT_CANDIDATES)
    print(f'Font: {font}')

    llm = OpenAI(
        api_key=os.environ['LLM_API_KEY'],
        base_url=os.environ.get('LLM_BASE_URL') or 'https://polza.ai/api/v1',
    )

    today      = datetime.date.today().isoformat()
    remote_dir = _disk_path(f'{output_dir.strip("/")}/{today}')
    ensure_yadisk_folder(yadisk_token, remote_dir)
    print(f'Output folder: {remote_dir}')

    print(f'Listing source videos from: {source_url}')
    videos = list_public_videos(source_url)
    if not videos:
        raise SystemExit(f'No video files found at {source_url}')
    print(f'Found {len(videos)} video(s): {[v["name"] for v in videos]}')
    random.shuffle(videos)

    n = random.randint(REELS_MIN, REELS_MAX)
    n = min(n, len(videos))
    print(f'Generating {n} hooks…')
    hooks = generate_hooks(llm, n)

    work_dir = Path(tempfile.mkdtemp(prefix='boldino_reels_'))
    successes = 0
    links: list[tuple[str, str]] = []

    for idx, (hook, video_info) in enumerate(zip(hooks, videos), start=1):
        print(f'\n[{idx}/{n}] {hook["trigger"]}')
        print(f'  headline="{hook["headline"]}"  cta="{hook["cta"]}"')
        print(f'  video="{video_info["name"]}"')
        try:
            raw = work_dir / f'raw_{idx}_{video_info["name"]}'
            print('  Downloading…')
            download_public_file(source_url, video_info['path'], raw)

            out_name = f'{today}_{idx:02d}_{safe_filename(hook["headline"])}.mp4'
            out_path = work_dir / out_name
            print('  Composing…')
            compose_reel(raw, out_path, hook, font)

            remote_path = f'{remote_dir}/{out_name}'  # remote_dir already starts with /
            url = upload_to_yadisk(yadisk_token, out_path, remote_path)
            print(f'  Uploaded ✓  {url}')
            links.append((hook['headline'], url))
            successes += 1

            raw.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
        except Exception as exc:
            print(f'  FAILED: {exc}')

        time.sleep(1)

    print(f'\nDone. {successes}/{n} reels → /{remote_dir}')
    for headline, url in links:
        print(f'  • {headline}: {url}')
    if successes == 0:
        raise SystemExit('No reels produced.')


if __name__ == '__main__':
    main()
