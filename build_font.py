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

# Lowercase letters with an ASCENDING stroke (scale each to cap height like uppercase,
# so all ascender tops align at CAP_HEIGHT regardless of individual SVG heights).
ASCEND_LOWER = {'b', 'd', 'f', 'h', 'i', 'k', 'l', 't'}

# ── Character → SVG mapping ──────────────────────────────────────────────────
BASE_U  = '/tmp/font_work/zips/f1a38bf8-___________________18/Uppercase'
BASE_L  = '/tmp/font_work/zips/faff3d62-___________________19/Lowercase'
BASE_N  = '/tmp/font_work/zips/f717a529-___________________20'
BASE_S  = '/tmp/font_work/zips/zip22'

MATH_AXIS   = X_HEIGHT // 2   # 250 — vertical centre for operators
DOT_H       = 120             # period/dot target height (font units)
QUOTE_H     = 150             # quotation-mark target height

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

# Symbols  name → (svg_filename, [unicode_codepoints], category)
#
# Categories:
#   'tall'      scale=CAP_HEIGHT/h, baseline=svg_h   (top at cap-height, base at 0)
#   'mathNNN'   scale=NNN/h, centered at MATH_AXIS   (e.g. 'math400')
#   'dot'       scale=DOT_H/h, baseline=svg_h        (sits on baseline)
#   'comma'     scale=DOT_H/34, baseline=34          (dot on baseline, tail descends)
#   'colon'     scale=X_HEIGHT/h, baseline=svg_h     (spans baseline → x-height)
#   'semi'      scale=X_HEIGHT/107, baseline=107     (colon part aligned, tail descends)
#   'quote'     scale=QUOTE_H/h, top pinned at CAP_HEIGHT
#   'under'     scale=DOT_H/h, baseline=0            (sits below baseline)
SYMBOLS = {
    # ── Tall (scale to cap height) ──────────────────────────────────────────
    'sym_ampersand':     ('ampersand.svg',      [0x0026],        'tall'),
    'sym_at':            ('at.svg',             [0x0040],        'tall'),
    'sym_backslash':     ('backslash.svg',      [0x005C],        'tall'),
    'sym_brace_close':   ('brace-close.svg',    [0x007D],        'tall'),
    'sym_brace_open':    ('brace-open.svg',     [0x007B],        'tall'),
    'sym_bracket_close': ('bracket-close.svg',  [0x005D],        'tall'),
    'sym_bracket_open':  ('bracket-open.svg',   [0x005B],        'tall'),
    'sym_exclamation':   ('exclamation.svg',    [0x0021],        'tall'),
    'sym_paren_close':   ('paren-close.svg',    [0x0029],        'tall'),
    'sym_paren_open':    ('paren-open.svg',     [0x0028],        'tall'),
    'sym_percent':       ('percent.svg',        [0x0025],        'tall'),
    'sym_question':      ('question.svg',       [0x003F],        'tall'),
    'sym_ruble':         ('ruble.svg',          [0x20BD],        'tall'),
    'sym_slash':         ('slash.svg',          [0x002F],        'tall'),
    # ── Math operators (centred at MATH_AXIS=250) ────────────────────────────
    'sym_plus':          ('plus.svg',           [0x002B],        'math400'),
    'sym_multiply':      ('multiply.svg',       [0x00D7],        'math400'),
    'sym_divide':        ('divide.svg',         [0x00F7],        'math400'),
    'sym_gt':            ('greater-than.svg',   [0x003E],        'math400'),
    'sym_lt':            ('less-than.svg',      [0x003C],        'math400'),
    'sym_gte':           ('greater-or-eq.svg',  [0x2265],        'math400'),
    'sym_lte':           ('less-or-eq.svg',     [0x2264],        'math400'),
    'sym_approx':        ('approx.svg',         [0x2248],        'math300'),
    'sym_equals':        ('equals.svg',         [0x003D],        'math200'),
    'sym_guillemet_op':  ('guillemet-open.svg',  [0x00AB],       'math250'),
    'sym_guillemet_cl':  ('guillemet-close.svg', [0x00BB],       'math250'),
    'sym_tilde':         ('tilde.svg',          [0x007E],        'math150'),
    'sym_hyphen':        ('hyphen.svg',         [0x002D],        'math80'),
    'sym_dash':          ('dash.svg',           [0x2014, 0x2013],'math80'),  # em/en dash
    # ── Punctuation ─────────────────────────────────────────────────────────
    'sym_period':        ('period.svg',         [0x002E],        'dot'),
    'sym_ellipsis':      ('ellipsis.svg',       [0x2026],        'dot'),
    'sym_comma':         ('comma.svg',          [0x002C],        'comma'),
    'sym_colon':         ('colon.svg',          [0x003A],        'colon'),
    'sym_semicolon':     ('semicolon.svg',      [0x003B],        'semi'),
    'sym_quote_open':    ('quote-open.svg',     [0x201C, 0x2018],'quote'),
    'sym_quote_close':   ('quote-close.svg',    [0x201D, 0x2019],'quote'),
    'sym_underscore':    ('underscore.svg',     [0x005F],        'under'),
}

# ── SVG helpers ───────────────────────────────────────────────────────────────

def get_svg_dims(svg_file):
    tree = ET.parse(svg_file)
    root = tree.getroot()
    vb = root.get('viewBox', '')
    if vb:
        parts = vb.split()
        return float(parts[2]), float(parts[3])
    return float(root.get('width', 100)), float(root.get('height', 100))

_CIRCLE_K = 0.5523  # cubic bezier approximation of arc: 4*(sqrt(2)-1)/3

def _circle_to_path(cx, cy, r):
    kr = _CIRCLE_K * r
    return (f'M {cx-r} {cy} '
            f'C {cx-r} {cy-kr} {cx-kr} {cy-r} {cx} {cy-r} '
            f'C {cx+kr} {cy-r} {cx+r} {cy-kr} {cx+r} {cy} '
            f'C {cx+r} {cy+kr} {cx+kr} {cy+r} {cx} {cy+r} '
            f'C {cx-kr} {cy+r} {cx-r} {cy+kr} {cx-r} {cy} Z')

def get_paths(svg_file):
    tree = ET.parse(svg_file)
    root = tree.getroot()
    paths = [e.get('d', '') for e in root.iter() if e.get('d')]
    for e in root.iter():
        tag = e.tag.split('}')[-1]  # strip XML namespace
        if tag == 'circle':
            paths.append(_circle_to_path(
                float(e.get('cx', 0)), float(e.get('cy', 0)), float(e.get('r', 0))
            ))
    return paths

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

        if key in ASCEND_LOWER:
            # Ascending stroke letters: scale each so the ascender top lands exactly at
            # CAP_HEIGHT (like uppercase).  Baseline at the bottom of the SVG.
            scale      = CAP_HEIGHT / svg_h
            baseline_y = svg_h

        elif key in DESCEND_XHEIGHT:
            # Descender letters: top of x-height body at X_HEIGHT, tail below baseline.
            # Baseline in SVG is at X_HEIGHT/SCALE_LOWER ≈ 81 px from the TOP.
            scale      = SCALE_LOWER
            baseline_y = X_HEIGHT / SCALE_LOWER

        elif key in DESCEND_ASCEND:
            # 'j': ascender AND descender — scale so it spans exactly from CAP_HEIGHT
            # down to -DESCENDER_D, baseline placed at CAP_HEIGHT / scale from the top.
            scale      = (CAP_HEIGHT + DESCENDER_D) / svg_h
            baseline_y = CAP_HEIGHT / scale

        else:
            # Pure x-height letters: baseline at the bottom of the SVG.
            scale      = SCALE_LOWER
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

    # ── Symbols ───────────────────────────────────────────────────────────────
    print("\n=== Symbols ===")
    for glyph_name, (svg_fn, codepoints, cat) in SYMBOLS.items():
        svg_path = os.path.join(BASE_S, svg_fn)
        if not os.path.exists(svg_path):
            print(f"  SKIP (not found): {svg_fn}")
            continue
        _, svg_h = get_svg_dims(svg_path)

        if cat == 'tall':
            scale      = CAP_HEIGHT / svg_h
            baseline_y = svg_h

        elif cat.startswith('math'):
            target_h   = int(cat[4:])
            scale      = target_h / svg_h
            bottom     = MATH_AXIS - target_h / 2
            baseline_y = svg_h + bottom / scale

        elif cat == 'dot':
            scale      = DOT_H / svg_h
            baseline_y = svg_h

        elif cat == 'comma':
            # period dot = 34 px SVG; scale so dot = DOT_H; tail descends below baseline
            scale      = DOT_H / 34.0
            baseline_y = 34.0

        elif cat == 'colon':
            scale      = X_HEIGHT / svg_h
            baseline_y = svg_h

        elif cat == 'semi':
            # same visual scale as colon (colon.svg height = 107); tail descends
            scale      = X_HEIGHT / 107.0
            baseline_y = 107.0

        elif cat == 'quote':
            scale      = QUOTE_H / svg_h
            baseline_y = CAP_HEIGHT / scale   # top of quote pinned at cap height

        elif cat == 'under':
            scale      = DOT_H / svg_h
            baseline_y = 0.0                  # glyph sits below baseline

        else:
            print(f"  UNKNOWN category '{cat}' for {glyph_name}, skipping")
            continue

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
