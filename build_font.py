#!/usr/bin/env python3
"""
build_font.py — Convert individual SVG glyph files to WOFF + WOFF2.

Usage:
    python build_font.py <svg_dir> [font_name] [output_dir]

    svg_dir    folder with SVG files named by character: A.svg, Б.svg, 1.svg
    font_name  optional font family name  (default: folder name)
    output_dir optional output folder     (default: same as svg_dir)

Requirements:
    pip install fonttools brotli
    npm install -g svg2ttf
"""

from __future__ import annotations

import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from fontTools.ttLib import TTFont

EM = 1000
ASCENT = 800
DESCENT = -200
X_HEIGHT = 500
CAP_HEIGHT = 700

# ---------------------------------------------------------------------------
# SVG parsing
# ---------------------------------------------------------------------------

def parse_viewbox(svg: ET.Element) -> tuple[float, float, float, float]:
    vb = svg.get('viewBox') or svg.get('viewbox', '')
    if vb:
        parts = re.split(r'[,\s]+', vb.strip())
        if len(parts) >= 4:
            return (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
    def dim(attr: str) -> float:
        val = re.sub(r'[^\d.]', '', svg.get(attr, '100'))
        return float(val) if val else 100.0
    return 0.0, 0.0, dim('width'), dim('height')


def collect_path_ds(elem: ET.Element) -> list[str]:
    ds: list[str] = []
    tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
    if tag == 'path':
        d = (elem.get('d') or '').strip()
        if d:
            ds.append(d)
    for child in elem:
        ds.extend(collect_path_ds(child))
    return ds


# ---------------------------------------------------------------------------
# Path coordinate transformation  (SVG Y-down → font Y-up)
# ---------------------------------------------------------------------------

# Reference SVG heights (statistical mode across all glyphs)
_REF_UPPER = 99.0   # most common uppercase glyph height in SVG units
_REF_LOWER = 81.0   # most common lowercase glyph height in SVG units

# Letters whose extra height sits ABOVE the body (breves, dots, tall stems).
# They are bottom-aligned so the body stays at cap/x-height; the extension
# protrudes upward above it.
_TOP_EXT = frozenset({'Й', 'Ё', 'й', 'ё', 'б'})

# Uppercase letters whose SVG contains NO descender/ascender extensions —
# the entire glyph must fit within [baseline … CAP_HEIGHT].
# We scale them individually (not by the shared ref_h) so nothing sticks out.
_CONTAINED_UPPER = frozenset({'Ф'})

# Latin uppercase letters that look identical to Cyrillic capitals and should
# also be registered under the Cyrillic Unicode codepoint.
# Fixes the case where A.svg was uploaded meaning Cyrillic А.
_LATIN_TO_CYR = {'A': 'А'}   # U+0041 → U+0410

_TOKEN_RE = re.compile(
    r'([MmLlHhVvCcSsQqTtAaZz])'
    r'|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)'
)


def _tokenize(d: str):
    for cmd, num in _TOKEN_RE.findall(d):
        yield (True, cmd) if cmd else (False, float(num))


def transform_paths(ds: list[str], vx: float, vy: float, vw: float, vh: float,
                    char: str = '') -> tuple[str, int]:
    """Return (font_path_d, advance_width).

    All glyphs of the same case share the same scale factor so that body
    heights are visually equal.  Descenders extend below the baseline;
    ascenders extend above cap/x-height.
    """
    if not ds or not vw or not vh:
        return '', 500

    is_lower = bool(char) and char.islower()
    ref_h  = _REF_LOWER if is_lower else _REF_UPPER
    target = X_HEIGHT   if is_lower else CAP_HEIGHT

    scale   = target / ref_h
    advance = max(1, round(vw * scale))

    def tx(x: float) -> float:
        return (x - vx) * scale

    if char in _CONTAINED_UPPER:
        # Entire glyph must fit within [0 … CAP_HEIGHT]: scale to vh, no extension.
        scale   = CAP_HEIGHT / vh if vh else scale
        advance = max(1, round(vw * scale))
        def ty(y: float) -> float:
            return CAP_HEIGHT - (y - vy) * scale
    elif char in _TOP_EXT:
        # Extension is ABOVE the body → anchor the SVG bottom at baseline (y=0)
        bottom = vy + vh
        def ty(y: float) -> float:
            return (bottom - y) * scale
    else:
        # Normal letter OR descender → anchor the SVG top at cap/x-height
        def ty(y: float) -> float:
            return target - (y - vy) * scale

    all_out: list[str] = []

    for d in ds:
        cx = cy = sx = sy = 0.0
        out: list[str] = []

        def process(cmd: str, args: list[float]) -> None:
            nonlocal cx, cy, sx, sy
            up = cmd.upper()
            rel = cmd.islower()

            def A(x: float, y: float) -> tuple[float, float]:
                return (cx + x, cy + y) if rel else (x, y)

            if up == 'Z':
                out.append('Z')
                cx, cy = sx, sy

            elif up == 'M':
                for i, (x, y) in enumerate(zip(args[::2], args[1::2])):
                    ax, ay = A(x, y)
                    if i == 0:
                        out.append(f'M {tx(ax):.2f} {ty(ay):.2f}')
                        sx, sy = ax, ay
                    else:
                        out.append(f'L {tx(ax):.2f} {ty(ay):.2f}')
                    cx, cy = ax, ay

            elif up == 'L':
                for x, y in zip(args[::2], args[1::2]):
                    ax, ay = A(x, y)
                    out.append(f'L {tx(ax):.2f} {ty(ay):.2f}')
                    cx, cy = ax, ay

            elif up == 'H':
                for x in args:
                    ax = cx + x if rel else x
                    out.append(f'L {tx(ax):.2f} {ty(cy):.2f}')
                    cx = ax

            elif up == 'V':
                for y in args:
                    ay = cy + y if rel else y
                    out.append(f'L {tx(cx):.2f} {ty(ay):.2f}')
                    cy = ay

            elif up == 'C':
                i = 0
                while i + 5 < len(args):
                    x1, y1, x2, y2, x, y = args[i:i + 6]
                    ax1, ay1 = A(x1, y1)
                    ax2, ay2 = A(x2, y2)
                    ax, ay = A(x, y)
                    out.append(
                        f'C {tx(ax1):.2f} {ty(ay1):.2f} '
                        f'{tx(ax2):.2f} {ty(ay2):.2f} '
                        f'{tx(ax):.2f} {ty(ay):.2f}'
                    )
                    cx, cy = ax, ay
                    i += 6

            elif up == 'S':
                i = 0
                while i + 3 < len(args):
                    x2, y2, x, y = args[i:i + 4]
                    ax2, ay2 = A(x2, y2)
                    ax, ay = A(x, y)
                    out.append(f'S {tx(ax2):.2f} {ty(ay2):.2f} {tx(ax):.2f} {ty(ay):.2f}')
                    cx, cy = ax, ay
                    i += 4

            elif up == 'Q':
                i = 0
                while i + 3 < len(args):
                    x1, y1, x, y = args[i:i + 4]
                    ax1, ay1 = A(x1, y1)
                    ax, ay = A(x, y)
                    out.append(f'Q {tx(ax1):.2f} {ty(ay1):.2f} {tx(ax):.2f} {ty(ay):.2f}')
                    cx, cy = ax, ay
                    i += 4

            elif up == 'T':
                i = 0
                while i + 1 < len(args):
                    x, y = args[i:i + 2]
                    ax, ay = A(x, y)
                    out.append(f'T {tx(ax):.2f} {ty(ay):.2f}')
                    cx, cy = ax, ay
                    i += 2

            elif up == 'A':
                i = 0
                while i + 6 < len(args):
                    rx, ry, rot, large, sweep, x, y = args[i:i + 7]
                    ax, ay = A(x, y)
                    out.append(
                        f'A {rx * scale:.2f} {ry * scale:.2f} {-rot} '
                        f'{int(large)} {1 - int(sweep)} '
                        f'{tx(ax):.2f} {ty(ay):.2f}'
                    )
                    cx, cy = ax, ay
                    i += 7

        # tokenizer loop
        cur: str | None = None
        nums: list[float] = []

        for is_cmd, val in _tokenize(d):
            if is_cmd:
                if cur is not None and (nums or cur.upper() == 'Z'):
                    process(cur, nums)
                    nums = []
                cur = val
                if val.upper() == 'Z':
                    process(cur, [])
                    cur = None
            else:
                nums.append(val)

        if cur and nums:
            process(cur, nums)

        if out:
            all_out.append(' '.join(out))

    return ' '.join(all_out), advance


# ---------------------------------------------------------------------------
# SVG font XML assembly
# ---------------------------------------------------------------------------

_XML_ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}


def xml_attr(s: str) -> str:
    return ''.join(_XML_ESC.get(c, c) for c in s)


def build_svg_font(glyphs: list[dict], font_name: str) -> str:
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg">',
        '  <defs>',
        f'    <font id="{font_name}" horiz-adv-x="600">',
        f'      <font-face font-family="{font_name}" font-weight="400"',
        f'        font-style="normal" units-per-em="{EM}"',
        f'        ascent="{ASCENT}" descent="{DESCENT}"',
        f'        x-height="{X_HEIGHT}" cap-height="{CAP_HEIGHT}"',
        f'        bbox="0 {DESCENT} {EM} {ASCENT}"/>',
        f'      <missing-glyph horiz-adv-x="500"/>',
    ]

    for g in glyphs:
        char_esc = xml_attr(g['unicode'])
        adv = g['advance']
        d = g['d']
        attrs = f'unicode="{char_esc}" glyph-name="{g["name"]}" horiz-adv-x="{adv}"'
        if d:
            lines.append(f'      <glyph {attrs} d="{d}"/>')
        else:
            lines.append(f'      <glyph {attrs}/>')

    lines += ['    </font>', '  </defs>', '</svg>']
    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    svg_dir = Path(sys.argv[1]).resolve()
    font_name = sys.argv[2] if len(sys.argv) > 2 else svg_dir.name
    out_dir = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else svg_dir

    out_dir.mkdir(parents=True, exist_ok=True)

    svg_files = sorted(svg_dir.glob('*.svg'))
    if not svg_files:
        print(f'No .svg files found in {svg_dir}')
        sys.exit(1)

    print(f'Processing {len(svg_files)} SVG files from {svg_dir}')

    glyphs: list[dict] = []
    for path in svg_files:
        # strip GitHub's dedup suffix: "б (1)" → "б"
        char = re.sub(r'\s*\(\d+\)\s*$', '', path.stem)
        if not char:
            continue

        try:
            tree = ET.parse(path)
        except ET.ParseError as e:
            print(f'  skip {path.name}: XML error — {e}')
            continue

        root = tree.getroot()
        vx, vy, vw, vh = parse_viewbox(root)
        ds = collect_path_ds(root)

        if not ds:
            print(f'  skip {path.name}: no <path> elements found')
            continue

        d, advance = transform_paths(ds, vx, vy, vw, vh, char)
        glyph_name = f'uni{ord(char):04X}' if len(char) == 1 else char

        glyphs.append({'unicode': char, 'name': glyph_name, 'd': d, 'advance': advance})
        print(f'  ok   {path.name}  adv={advance}')

    # Add Cyrillic equivalents for Latin lookalikes (e.g. A.svg → also Cyrillic А)
    existing = {g['unicode'] for g in glyphs}
    for g in list(glyphs):
        cyr = _LATIN_TO_CYR.get(g['unicode'])
        if cyr and cyr not in existing:
            dup = dict(g, unicode=cyr, name=f'uni{ord(cyr):04X}')
            glyphs.append(dup)
            existing.add(cyr)
            print(f'  dup  {g["unicode"]} → {cyr}  (Cyrillic U+{ord(cyr):04X})')

    if not glyphs:
        print('No glyphs built. Check your SVG files contain <path> elements.')
        sys.exit(1)

    # Step 1: SVG font
    svg_out = out_dir / f'{font_name}.svg'
    svg_out.write_text(build_svg_font(glyphs, font_name), encoding='utf-8')
    print(f'\n[1/4] SVG font → {svg_out}')

    # Step 2: TTF via svg2ttf
    ttf_out = out_dir / f'{font_name}.ttf'
    r = subprocess.run(['svg2ttf', str(svg_out), str(ttf_out)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(f'svg2ttf failed:\n{r.stderr}')
        sys.exit(1)
    print(f'[2/4] TTF      → {ttf_out}')

    # Step 3: WOFF
    woff_out = out_dir / f'{font_name}.woff'
    font = TTFont(str(ttf_out))
    font.flavor = 'woff'
    font.save(str(woff_out))
    print(f'[3/4] WOFF     → {woff_out}')

    # Step 4: WOFF2
    woff2_out = out_dir / f'{font_name}.woff2'
    font2 = TTFont(str(ttf_out))
    font2.flavor = 'woff2'
    font2.save(str(woff2_out))
    print(f'[4/4] WOFF2    → {woff2_out}')

    print(f'\nAll done! Use in CSS:')
    print(f'  @font-face {{')
    print(f'    font-family: "{font_name}";')
    print(f'    src: url("{font_name}.woff2") format("woff2"),')
    print(f'         url("{font_name}.woff") format("woff");')
    print(f'    font-weight: 400;')
    print(f'    font-style: normal;')
    print(f'  }}')


if __name__ == '__main__':
    main()
