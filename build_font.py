#!/usr/bin/env python3
"""
Add Latin A-Z, a-z, digits 0-9 and Cyrillic updates to the existing TTF font.
Exports TTF, WOFF, WOFF2.
"""

import xml.etree.ElementTree as ET
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path as svg_parse_path

# ── Font metrics (read from existing font) ───────────────────────────────────
CAP_HEIGHT   = 701   # yMax of uppercase А
X_HEIGHT     = 500   # yMax of lowercase а
DESCENDER_D  = 200   # units BELOW baseline (positive value)

# For lowercase: fixed scale derived from x-height reference letters (~81 px tall)
SCALE_LOWER  = X_HEIGHT / 81.0          # ≈ 6.173

# Lowercase letters whose descender goes below baseline.
# Baseline in SVG is placed at X_HEIGHT/SCALE_LOWER ≈ 81 px from TOP.
DESCEND_XHEIGHT = {'g', 'p', 'q', 'y'}

# 'j' has both ascender AND descender; baseline ≈ CAP_HEIGHT/SCALE_LOWER px from top
DESCEND_ASCEND  = {'j'}

# ── Character → SVG mapping ──────────────────────────────────────────────────
BASE_U  = '/tmp/font_work/zips/f1a38bf8-___________________18/Uppercase'
BASE_L  = '/tmp/font_work/zips/faff3d62-___________________19/Lowercase'
BASE_N  = '/tmp/font_work/zips/f717a529-___________________20'

# Uppercase Latin.  name → (svg_filename, [unicode_codepoints])
UPPERCASE = {
    'A': ('Latin A.svg',  [0x0041]),
    'B': ('Latin B.svg',  [0x0042]),
    'C': ('Latin #U0421.svg', [0x0043, 0x0421]),   # C / Cyrillic С
    'D': ('Latin D.svg',  [0x0044]),
    'E': ('Latin #U0415.svg', [0x0045, 0x0415]),   # E / Cyrillic Е
    'F': ('Latin F.svg',  [0x0046]),
    'G': ('Latin G.svg',  [0x0047]),
    'H': ('Latin #U041d.svg', [0x0048, 0x041D]),   # H / Cyrillic Н
    'I': ('Latin I.svg',  [0x0049]),
    'J': ('Latin J.svg',  [0x004A]),
    'K': ('Latin #U041a.svg', [0x004B, 0x041A]),   # K / Cyrillic К
    'L': ('Latin L.svg',  [0x004C]),
    'M': ('Latin #U041c.svg', [0x004D, 0x041C]),   # M / Cyrillic М
    'N': ('Latin N.svg',  [0x004E]),
    'O': ('Latin #U041e.svg', [0x004F, 0x041E]),   # O / Cyrillic О
    'P': ('Latin P.svg',  [0x0050]),
    'Q': ('Latin Q.svg',  [0x0051]),
    'R': ('Latin R.svg',  [0x0052]),
    'S': ('Latin S.svg',  [0x0053]),
    'T': ('Latin #U0422.svg', [0x0054, 0x0422]),   # T / Cyrillic Т
    'U': ('Latin U.svg',  [0x0055]),
    'V': ('Latin V.svg',  [0x0056]),
    'W': ('Latin W.svg',  [0x0057]),
    'X': ('Latin X.svg',  [0x0058]),
    'Y': ('Latin Y.svg',  [0x0059]),
    'Z': ('Latin Z.svg',  [0x005A]),
}

# Lowercase Latin.  name → (svg_filename, [unicode_codepoints])
LOWERCASE = {
    'a': ('Latin a.svg', [0x0061]),
    'b': ('Latin b.svg', [0x0062]),
    'c': ('Latin c.svg', [0x0063]),
    'd': ('Latin d.svg', [0x0064]),
    'e': ('Latin #U0435.svg', [0x0065, 0x0435]),   # e / Cyrillic е
    'f': ('Latin f.svg', [0x0066]),
    'g': ('Latin g.svg', [0x0067]),
    'h': ('Latin h.svg', [0x0068]),
    'i': ('Latin i.svg', [0x0069]),
    'j': ('Latin j.svg', [0x006A]),
    'k': ('Latin k.svg', [0x006B]),
    'l': ('Latin l.svg', [0x006C]),
    'm': ('Latin m.svg', [0x006D]),
    'n': ('Latin n.svg', [0x006E]),
    'o': ('Latin o.svg', [0x006F]),
    'p': ('Latin p.svg', [0x0070]),
    'q': ('Latin q.svg', [0x0071]),
    'r': ('Latin r.svg', [0x0072]),
    's': ('Latin s.svg', [0x0073]),
    't': ('Latin t.svg', [0x0074]),
    'u': ('Latin u.svg', [0x0075]),
    'v': ('Latin v.svg', [0x0076]),
    'w': ('Latin w.svg', [0x0077]),
    'x': ('Latin x.svg', [0x0078]),
    'y': ('Latin y.svg', [0x0079]),
    'z': ('Latin z.svg', [0x007A]),
}

# Digits  name → (svg_filename, [unicode_codepoints])
DIGITS = {f'd{i}': (f'Numbers {i}.svg', [0x0030 + i]) for i in range(10)}

# ── SVG helpers ───────────────────────────────────────────────────────────────

def get_svg_dims(svg_file):
    tree = ET.parse(svg_file)
    root = tree.getroot()
    vb = root.get('viewBox', '')
    if vb:
        parts = vb.split()
        return float(parts[2]), float(parts[3])
    return float(root.get('width', 100)), float(root.get('height', 100))

def get_paths(svg_file):
    tree = ET.parse(svg_file)
    root = tree.getroot()
    return [e.get('d', '') for e in root.iter() if e.get('d')]

# ── Glyph builder ─────────────────────────────────────────────────────────────

def build_glyph(svg_file, scale, baseline_y_svg):
    """
    Parse SVG and return (TTGlyph, advance_width).

    Transformation applied to each point:
        font_x = svg_x  * scale
        font_y = (baseline_y_svg - svg_y) * scale   ← Y-flip + translate
    """
    svg_w, svg_h = get_svg_dims(svg_file)

    tt_pen    = TTGlyphPen(None)
    cu2qu_pen = Cu2QuPen(tt_pen, max_err=1.0, all_quadratic=True)

    # Affine matrix (a,b,c,d,e,f): x'=ax+cy+e, y'=bx+dy+f
    #   a=scale, b=0, c=0, d=-scale, e=0, f=baseline_y_svg*scale
    tf = (scale, 0, 0, -scale, 0, baseline_y_svg * scale)
    tf_pen = TransformPen(cu2qu_pen, tf)

    paths = get_paths(svg_file)
    if not paths:
        print(f"  WARNING: no paths in {svg_file}")

    for d in paths:
        try:
            svg_parse_path(d, tf_pen)
        except Exception as exc:
            print(f"  WARNING: path parse error in {os.path.basename(svg_file)}: {exc}")

    glyph = tt_pen.glyph()
    advance = round(svg_w * scale)
    return glyph, advance

# ── Font manipulation ─────────────────────────────────────────────────────────

def add_glyph(font, glyph_name, svg_file, scale, baseline_y_svg, codepoints):
    """Add or replace a glyph in the font."""
    glyph, advance = build_glyph(svg_file, scale, baseline_y_svg)

    # Glyph order
    order = list(font.getGlyphOrder())
    if glyph_name not in order:
        order.append(glyph_name)
        font.setGlyphOrder(order)

    # Outline
    font['glyf'][glyph_name] = glyph
    font['glyf'][glyph_name].recalcBounds(font['glyf'])

    # Metrics
    g   = font['glyf'][glyph_name]
    lsb = g.xMin if hasattr(g, 'xMin') and g.xMin is not None else 0
    font['hmtx'].metrics[glyph_name] = (advance, lsb)

    # maxp
    font['maxp'].numGlyphs = len(font.getGlyphOrder())

    # cmap — update only Unicode subtables (format 4 / 12), skip 8-bit tables
    for table in font['cmap'].tables:
        if hasattr(table, 'cmap') and table.format in (4, 12, 6):
            try:
                for cp in codepoints:
                    table.cmap[cp] = glyph_name
            except Exception:
                pass

    print(f"  ✓ {glyph_name:20s}  U+{[f'{cp:04X}' for cp in codepoints]}  advance={advance}")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    src  = '/tmp/font_work/original.ttf'
    out  = '/tmp/font_work/output'
    os.makedirs(out, exist_ok=True)

    font = TTFont(src)

    # ── Uppercase ─────────────────────────────────────────────────────────────
    print("\n=== Uppercase ===")
    for key, (svg_fn, codepoints) in UPPERCASE.items():
        svg_path = os.path.join(BASE_U, svg_fn)
        if not os.path.exists(svg_path):
            print(f"  SKIP (not found): {svg_fn}")
            continue
        _, svg_h = get_svg_dims(svg_path)
        scale = CAP_HEIGHT / svg_h
        baseline_y = svg_h   # baseline at bottom of uppercase SVG
        glyph_name = f'latin{key}' if codepoints[0] < 0x0400 else f'latin{key}_cy'
        add_glyph(font, glyph_name, svg_path, scale, baseline_y, codepoints)

    # ── Lowercase ─────────────────────────────────────────────────────────────
    print("\n=== Lowercase ===")
    for key, (svg_fn, codepoints) in LOWERCASE.items():
        svg_path = os.path.join(BASE_L, svg_fn)
        if not os.path.exists(svg_path):
            print(f"  SKIP (not found): {svg_fn}")
            continue

        _, svg_h = get_svg_dims(svg_path)
        scale = SCALE_LOWER

        if key in DESCEND_XHEIGHT:
            # x-height top, descender bottom
            # baseline is at x-height / scale from top = 81 px
            baseline_y = X_HEIGHT / SCALE_LOWER
        elif key in DESCEND_ASCEND:
            # ascender top, descender bottom
            # baseline is at cap_height / scale from top ≈ 114 px
            baseline_y = CAP_HEIGHT / SCALE_LOWER
        else:
            # no descender: baseline at bottom of SVG
            baseline_y = svg_h

        glyph_name = f'latin{key}'
        add_glyph(font, glyph_name, svg_path, scale, baseline_y, codepoints)

    # ── Digits ────────────────────────────────────────────────────────────────
    print("\n=== Digits ===")
    for key, (svg_fn, codepoints) in DIGITS.items():
        svg_path = os.path.join(BASE_N, svg_fn)
        if not os.path.exists(svg_path):
            print(f"  SKIP (not found): {svg_fn}")
            continue
        _, svg_h = get_svg_dims(svg_path)
        scale = CAP_HEIGHT / svg_h
        baseline_y = svg_h
        glyph_name = f'digit{key[1]}'
        add_glyph(font, glyph_name, svg_path, scale, baseline_y, codepoints)

    # ── Save ──────────────────────────────────────────────────────────────────
    print("\n=== Saving ===")

    ttf_path = os.path.join(out, 'DINAMIKA-extended.ttf')
    font.save(ttf_path)
    print(f"  TTF  → {ttf_path}")

    # WOFF
    woff_path = os.path.join(out, 'DINAMIKA-extended.woff')
    font.flavor = 'woff'
    font.save(woff_path)
    print(f"  WOFF → {woff_path}")

    # WOFF2
    woff2_path = os.path.join(out, 'DINAMIKA-extended.woff2')
    font.flavor = 'woff2'
    font.save(woff2_path)
    print(f"  WOFF2→ {woff2_path}")

    print("\nDone.")

if __name__ == '__main__':
    main()
