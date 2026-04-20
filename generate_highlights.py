"""
Highlight reel generator — pole sport & aerial gymnastics.

Pipeline:
  1. List source videos from a Yandex.Disk folder (private or public).
  2. Download each video.
  3. Sample up to 20 frames evenly across each video.
  4. Send thumbnails to Claude Vision; score 0–10 with the eye of a
     professional pole/aerial editor (peak tricks, dynamic poses, clean action).
  5. Select the best segments (default: 6 × 5 s = 30 s total).
  6. Extract each segment in both target formats using blur-background resize.
  7. Concatenate + add music → upload widescreen (1920×1080) and stories
     (1080×1920) to a private Yandex.Disk output folder.

Required env vars:
  YANDEX_DISK_TOKEN              — OAuth token (read source + write output)
  ANTHROPIC_API_KEY              — for Claude Vision frame scoring
  YANDEX_DISK_HIGHLIGHTS_SOURCE  — folder path on your disk, e.g. "Videos/Source"
                                    OR a public /d/ share URL
                                    (note: /a/ album links are NOT supported by
                                     the Yandex public API — use a folder path instead)
  YANDEX_DISK_HIGHLIGHTS_OUTPUT  — private folder path for output (default: Highlights)

Optional env vars:
  HIGHLIGHT_CLIP_DURATION        — seconds per extracted clip (default: 5)
  HIGHLIGHT_TARGET_DURATION      — total output duration in seconds (default: 30)
"""

import base64
import datetime
import json
import math
import os
import random
import re
import subprocess
import tempfile
import time
from pathlib import Path

import anthropic
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

YADISK_API = 'https://cloud-api.yandex.net/v1/disk'

DEFAULT_SOURCE = os.environ.get('YANDEX_DISK_HIGHLIGHTS_SOURCE', '')
DEFAULT_OUTPUT_FOLDER = os.environ.get('YANDEX_DISK_HIGHLIGHTS_OUTPUT', 'Highlights')

CLIP_DURATION   = float(os.environ.get('HIGHLIGHT_CLIP_DURATION', '5'))
TARGET_DURATION = float(os.environ.get('HIGHLIGHT_TARGET_DURATION', '30'))

WIDE_W,   WIDE_H   = 1920, 1080
STORY_W,  STORY_H  = 1080, 1920

VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'}
MUSIC_EXTENSIONS = ('.mp3', '.m4a', '.wav', '.ogg', '.aac')

MAX_FRAMES_PER_VIDEO = 20
CLAUDE_MODEL = 'claude-opus-4-7'

# ---------------------------------------------------------------------------
# Utilities (shared with generate_reels_boldino.py pattern)
# ---------------------------------------------------------------------------

def ffmpeg_escape(path: str) -> str:
    return path.replace('\\', '/').replace(':', r'\:')


def pick_music_track() -> Path | None:
    music_dir = Path(__file__).parent / 'music'
    if not music_dir.is_dir():
        return None
    tracks = [p for p in music_dir.iterdir()
              if p.is_file() and p.suffix.lower() in MUSIC_EXTENSIONS]
    return random.choice(tracks) if tracks else None


# ---------------------------------------------------------------------------
# Yandex.Disk — public source
# ---------------------------------------------------------------------------

def list_public_videos(public_url: str) -> list[dict]:
    """Return [{name, path}, ...] for video files in a public YaDisk folder."""
    resp = requests.get(
        f'{YADISK_API}/public/resources',
        params={
            'public_key': public_url,
            'limit': 100,
            'fields': '_embedded.items.name,_embedded.items.path,'
                      '_embedded.items.media_type,_embedded.items.type',
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
    info = requests.get(
        f'{YADISK_API}/public/resources/download',
        params={'public_key': public_url, 'path': file_path},
        timeout=30,
    )
    info.raise_for_status()
    href = info.json()['href']
    with requests.get(href, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, 'wb') as fh:
            for chunk in r.iter_content(chunk_size=256 * 1024):
                fh.write(chunk)


# ---------------------------------------------------------------------------
# Yandex.Disk — private source (OAuth token required)
# ---------------------------------------------------------------------------

def list_private_videos(token: str, folder_path: str) -> list[dict]:
    """Return [{name, path}, ...] for video files in a private YaDisk folder."""
    resp = requests.get(
        f'{YADISK_API}/resources',
        params={
            'path': _disk_path_raw(folder_path),
            'limit': 100,
            'fields': '_embedded.items.name,_embedded.items.path,'
                      '_embedded.items.media_type,_embedded.items.type',
        },
        headers={'Authorization': f'OAuth {token}'},
        timeout=30,
    )
    if resp.status_code == 404:
        raise RuntimeError(
            f'Folder not found on Yandex.Disk: {folder_path!r}\n'
            'Set YANDEX_DISK_HIGHLIGHTS_SOURCE to the folder path on your disk, '
            'e.g. "Видео/Исходники".'
        )
    resp.raise_for_status()
    items = resp.json().get('_embedded', {}).get('items', [])
    return [
        {'name': item['name'], 'path': item['path']}
        for item in items
        if item.get('type') == 'file'
        and Path(item['name']).suffix.lower() in VIDEO_EXTENSIONS
    ]


def download_private_file(token: str, remote_path: str, dest: Path) -> None:
    info = requests.get(
        f'{YADISK_API}/resources/download',
        params={'path': remote_path},
        headers={'Authorization': f'OAuth {token}'},
        timeout=30,
    )
    info.raise_for_status()
    href = info.json()['href']
    with requests.get(href, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, 'wb') as fh:
            for chunk in r.iter_content(chunk_size=256 * 1024):
                fh.write(chunk)


def _disk_path_raw(path: str) -> str:
    """Return path as-is if it already looks absolute, else prepend /."""
    p = path.strip()
    if p.startswith('/'):
        return p
    return f'/{p}' if p else '/'


# ---------------------------------------------------------------------------
# Yandex.Disk — private output
# ---------------------------------------------------------------------------

def _ya_headers(token: str) -> dict:
    return {'Authorization': f'OAuth {token}'}


def _disk_path(path: str) -> str:
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
# Video utilities
# ---------------------------------------------------------------------------

def get_video_duration(path: Path) -> float:
    cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'json',
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return float(json.loads(result.stdout)['format']['duration'])


def get_video_dimensions(path: Path) -> tuple[int, int]:
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height:stream_tags=rotate',
        '-of', 'json',
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    data = json.loads(result.stdout)
    stream = (data.get('streams') or [{}])[0]
    w, h = int(stream['width']), int(stream['height'])
    rotate = int((stream.get('tags') or {}).get('rotate', 0))
    if rotate in (90, 270):
        w, h = h, w
    return w, h


def sample_timestamps(duration: float, max_frames: int = MAX_FRAMES_PER_VIDEO) -> list[float]:
    """Evenly spaced frame timestamps, capped at max_frames."""
    n = min(max_frames, max(1, int(duration / 5)))
    interval = duration / n
    # Take frame from the middle of each interval; avoid the very last second
    return [min(interval * i + interval / 2, duration - 0.5) for i in range(n)]


def extract_thumbnail(path: Path, timestamp: float) -> bytes:
    """Extract a single frame as JPEG bytes (320×180) for Claude Vision."""
    cmd = [
        'ffmpeg', '-y',
        '-ss', f'{timestamp:.3f}',
        '-i', str(path),
        '-frames:v', '1',
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,'
               'pad=320:180:(ow-iw)/2:(oh-ih)/2:black',
        '-f', 'image2', '-vcodec', 'mjpeg',
        'pipe:1',
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    return result.stdout


# ---------------------------------------------------------------------------
# Claude Vision scoring
# ---------------------------------------------------------------------------

def score_frames_with_claude(
    client: anthropic.Anthropic,
    frames: list[tuple[float, bytes]],
    video_name: str,
) -> list[tuple[float, float]]:
    """
    Send thumbnails to Claude Vision and return [(timestamp, score), ...].
    Score 0–10: 10 = peak trick / dynamic pose / great action,
                0 = static / transition / uninteresting.
    Falls back to equal scores on any failure.
    """
    if not frames:
        return []

    content: list[dict] = [
        {
            'type': 'text',
            'text': (
                'Ты — профессиональный видеомонтажёр, специалист по пилонному '
                'спорту и воздушной гимнастике.\n'
                f'Перед тобой {len(frames)} кадров из видео «{video_name}».\n'
                'Оцени каждый кадр по шкале 0–10 для включения в хайлайт-ролик:\n'
                '10 = пиковый момент трюка, красивая поза, динамичное движение;\n'
                '5  = рядовой момент выступления;\n'
                '0  = переход, статика, неинтересный план.\n\n'
                'Учитывай:\n'
                '• Вершина трюка или элемента (split, inverted, флаг и т.п.) — высокий балл\n'
                '• Динамика движения, размах — высокий балл\n'
                '• Выразительная поза, красивая линия тела — высокий балл\n'
                '• Взгляд в камеру, уверенность — бонус\n'
                '• Размытый переход, вход/выход из трюка, незаконченное движение — низкий балл\n\n'
                'Ответь СТРОГО JSON-массивом без пояснений:\n'
                '[{"index": 0, "score": 8.5}, {"index": 1, "score": 3.0}, ...]'
            ),
        }
    ]

    for i, (ts, jpeg_bytes) in enumerate(frames):
        if not jpeg_bytes:
            continue
        content.append({'type': 'text', 'text': f'Кадр {i} (время {ts:.1f} с):'})
        content.append({
            'type': 'image',
            'source': {
                'type': 'base64',
                'media_type': 'image/jpeg',
                'data': base64.standard_b64encode(jpeg_bytes).decode('utf-8'),
            },
        })

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            messages=[{'role': 'user', 'content': content}],
        )
        raw = (response.content[0].text or '').strip()
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if not match:
            raise ValueError(f'No JSON array in response: {raw[:200]}')
        scores = json.loads(match.group(0))
        result = []
        for item in scores:
            idx = int(item['index'])
            if 0 <= idx < len(frames):
                result.append((frames[idx][0], float(item['score'])))
        return result
    except Exception as exc:
        print(f'    Claude Vision fallback (equal scores): {exc}')
        return [(ts, 5.0) for ts, _ in frames]


# ---------------------------------------------------------------------------
# Segment selection
# ---------------------------------------------------------------------------

def select_best_segments(
    scored: list[tuple[float, float]],
    clip_dur: float,
    n: int,
) -> list[float]:
    """
    Return up to n start-times for the best non-overlapping segments,
    sorted chronologically.
    """
    if not scored:
        return []
    sorted_by_score = sorted(scored, key=lambda x: x[1], reverse=True)
    selected: list[float] = []
    for ts, _score in sorted_by_score:
        if len(selected) >= n:
            break
        # Ensure no overlap with already-selected segments
        overlap = any(abs(ts - s) < clip_dur for s in selected)
        if not overlap:
            selected.append(ts)
    return sorted(selected)


# ---------------------------------------------------------------------------
# FFmpeg composition
# ---------------------------------------------------------------------------

def build_resize_filter(target_w: int, target_h: int) -> tuple[str, str]:
    """Universal blur-background filter_complex for any input aspect ratio."""
    fc = (
        f'[0:v]fps=25,split=2[bg_raw][fg_raw];'
        f'[bg_raw]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,'
        f'crop={target_w}:{target_h},'
        f'boxblur=luma_radius=30:luma_power=1[bg];'
        f'[fg_raw]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease[fg];'
        f'[bg][fg]overlay=(W-w)/2:(H-h)/2[out]'
    )
    return fc, '[out]'


def extract_clip(
    src: Path,
    start: float,
    duration: float,
    dest: Path,
    target_w: int,
    target_h: int,
) -> None:
    fc, map_tag = build_resize_filter(target_w, target_h)
    cmd = [
        'ffmpeg', '-y',
        '-ss', f'{start:.3f}', '-t', f'{duration:.3f}',
        '-i', str(src),
        '-filter_complex', fc,
        '-map', map_tag,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-an',
        str(dest),
    ]
    subprocess.run(cmd, check=True, timeout=120)


def concat_clips(clip_paths: list[Path], output: Path) -> None:
    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.txt', delete=False, prefix='concat_'
    ) as f:
        list_path = f.name
        for p in clip_paths:
            f.write(f"file '{p.resolve()}'\n")
    try:
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat', '-safe', '0',
            '-i', list_path,
            '-c', 'copy',
            '-movflags', '+faststart',
            str(output),
        ]
        subprocess.run(cmd, check=True, timeout=300)
    finally:
        try:
            os.unlink(list_path)
        except OSError:
            pass


def add_music(video: Path, output: Path, duration: float) -> None:
    """Mix in a random music track with fade-in/out. Copies video if no track."""
    music = pick_music_track()
    if not music:
        import shutil
        shutil.copy(video, output)
        return
    offset = random.uniform(5, 25)
    fade_out_start = max(0.0, duration - 0.5)
    cmd = [
        'ffmpeg', '-y',
        '-i', str(video),
        '-ss', f'{offset:.2f}', '-t', f'{duration:.2f}',
        '-i', str(music),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-af', (
            f'afade=t=in:st=0:d=0.4,'
            f'afade=t=out:st={fade_out_start:.2f}:d=0.5,'
            'volume=0.9'
        ),
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest',
        str(output),
    ]
    subprocess.run(cmd, check=True, timeout=300)


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main() -> None:
    yadisk_token   = os.environ['YANDEX_DISK_TOKEN']
    anthropic_key  = os.environ['ANTHROPIC_API_KEY']
    source         = os.environ.get('YANDEX_DISK_HIGHLIGHTS_SOURCE') or DEFAULT_SOURCE
    output_dir     = os.environ.get('YANDEX_DISK_HIGHLIGHTS_OUTPUT') or DEFAULT_OUTPUT_FOLDER

    if not source:
        raise SystemExit(
            'YANDEX_DISK_HIGHLIGHTS_SOURCE is not set.\n'
            'Set it to the folder path on your Yandex.Disk, e.g. "Видео/Исходники".\n'
            '(Note: /a/ album links are not supported — use the folder path instead.)'
        )

    if output_dir.startswith('http'):
        raise SystemExit(
            f'YANDEX_DISK_HIGHLIGHTS_OUTPUT looks like a URL: {output_dir!r}\n'
            'Set it to a folder path, e.g. "Highlights".'
        )

    # Detect source type: public /d/ URL vs private folder path
    use_public = source.startswith('http') and '/d/' in source

    if source.startswith('http') and not use_public:
        print(
            f'WARNING: {source!r} looks like a Yandex.Disk album (/a/) link.\n'
            'Album links are not supported by the public API.\n'
            'Set YANDEX_DISK_HIGHLIGHTS_SOURCE to the folder path on your disk instead,\n'
            'e.g. "Видео/Исходники".\n'
        )
        raise SystemExit('Unsupported source URL format.')

    claude = anthropic.Anthropic(api_key=anthropic_key)

    clips_needed = math.ceil(TARGET_DURATION / CLIP_DURATION)
    print(f'Target: {TARGET_DURATION:.0f}s  |  clip={CLIP_DURATION:.0f}s  |  clips needed={clips_needed}')

    # Output folder on YaDisk
    today = datetime.date.today().isoformat()
    remote_dir = _disk_path(f'{output_dir.strip("/")}/{today}')
    ensure_yadisk_folder(yadisk_token, remote_dir)
    print(f'Output folder: {remote_dir}')

    # List source videos
    print(f'\nListing source videos: {source}')
    if use_public:
        videos = list_public_videos(source)
    else:
        videos = list_private_videos(yadisk_token, source)

    if not videos:
        raise SystemExit(f'No video files found at {source!r}')
    print(f'Found {len(videos)} video(s): {[v["name"] for v in videos]}')

    clips_per_video = max(1, min(3, math.ceil(clips_needed / len(videos))))
    print(f'Clips per video: {clips_per_video}')

    work_dir = Path(tempfile.mkdtemp(prefix='highlights_'))
    wide_clips:    list[Path] = []
    stories_clips: list[Path] = []

    for vid_idx, video_info in enumerate(videos, start=1):
        vname = video_info['name']
        print(f'\n[{vid_idx}/{len(videos)}] {vname}')

        # Download
        raw = work_dir / f'raw_{vid_idx}_{vname}'
        try:
            print('  Downloading…')
            if use_public:
                download_public_file(source, video_info['path'], raw)
            else:
                download_private_file(yadisk_token, video_info['path'], raw)
        except Exception as exc:
            print(f'  Download failed: {exc} — skipping')
            continue

        # Duration & frame sampling
        try:
            duration = get_video_duration(raw)
            print(f'  Duration: {duration:.1f}s')
        except Exception as exc:
            print(f'  Duration probe failed: {exc} — skipping')
            raw.unlink(missing_ok=True)
            continue

        timestamps = sample_timestamps(duration)
        print(f'  Sampling {len(timestamps)} frames for Claude Vision…')

        frames: list[tuple[float, bytes]] = []
        for ts in timestamps:
            thumb = extract_thumbnail(raw, ts)
            if thumb:
                frames.append((ts, thumb))

        # Claude Vision scoring
        if frames:
            print(f'  Scoring {len(frames)} frames with Claude…')
            scored = score_frames_with_claude(claude, frames, vname)
        else:
            print('  No thumbnails extracted, using equal scores')
            scored = [(ts, 5.0) for ts in timestamps]

        # Select best segments
        best_starts = select_best_segments(scored, CLIP_DURATION, clips_per_video)
        print(f'  Selected {len(best_starts)} segment(s): {[f"{t:.1f}s" for t in best_starts]}')

        # Extract clips in both formats
        for seg_idx, start in enumerate(best_starts):
            clip_start = max(0.0, start - CLIP_DURATION / 2)
            clip_start = min(clip_start, max(0.0, duration - CLIP_DURATION))

            wide_dest    = work_dir / f'wide_{vid_idx}_{seg_idx}.mp4'
            stories_dest = work_dir / f'stories_{vid_idx}_{seg_idx}.mp4'
            try:
                extract_clip(raw, clip_start, CLIP_DURATION, wide_dest,    WIDE_W,  WIDE_H)
                extract_clip(raw, clip_start, CLIP_DURATION, stories_dest, STORY_W, STORY_H)
                wide_clips.append(wide_dest)
                stories_clips.append(stories_dest)
                print(f'    Clip {seg_idx+1}: {clip_start:.1f}s → {clip_start+CLIP_DURATION:.1f}s ✓')
            except Exception as exc:
                print(f'    Clip {seg_idx+1} extraction failed: {exc}')

        raw.unlink(missing_ok=True)
        time.sleep(1)

    if not wide_clips:
        raise SystemExit('No clips extracted. Check source videos and logs.')

    # Trim to target count
    wide_clips    = wide_clips[:clips_needed]
    stories_clips = stories_clips[:clips_needed]
    actual_duration = len(wide_clips) * CLIP_DURATION
    print(f'\nAssembling {len(wide_clips)} clips ({actual_duration:.0f}s total)…')

    # Concatenate
    wide_concat    = work_dir / 'wide_concat.mp4'
    stories_concat = work_dir / 'stories_concat.mp4'
    concat_clips(wide_clips,    wide_concat)
    concat_clips(stories_clips, stories_concat)

    # Add music
    wide_final    = work_dir / f'{today}_highlights_wide.mp4'
    stories_final = work_dir / f'{today}_highlights_stories.mp4'
    print('Adding music…')
    add_music(wide_concat,    wide_final,    actual_duration)
    add_music(stories_concat, stories_final, actual_duration)

    # Upload
    print('Uploading…')
    wide_url = upload_to_yadisk(
        yadisk_token, wide_final,
        f'{remote_dir}/{wide_final.name}',
    )
    stories_url = upload_to_yadisk(
        yadisk_token, stories_final,
        f'{remote_dir}/{stories_final.name}',
    )

    print(f'\nDone!')
    print(f'  Widescreen : {wide_url}')
    print(f'  Stories    : {stories_url}')


if __name__ == '__main__':
    main()
