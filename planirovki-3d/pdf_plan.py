"""Черновик планировки из векторного листа PDF (проекты IT-arc, масштаб 1:75).

    python3 pdf_plan.py файл.pdf номер_страницы имя [--out папка]

Что делает:
  * стены — по контурам стен (чёрные линии 0,85 pt), разбивает на прямоугольники;
  * окна и двери — по условным обозначениям (чёрные линии 0,43 pt): у двери есть дуга,
    петли — со стороны прямой створки, наружная — если выходит на улицу;
  * помещения — свободные области между стенами и проёмами, название и площадь берёт
    из подписей на листе;
  * мебель — группы серых линий: печатает их рамки с номерами и сохраняет картинку
    <имя>-furn.png с номерами и сеткой в мм. Тип каждого предмета назначается руками в plans.py.

С --json geo/<имя>.json сохраняет стены, окна и двери — plans.py подхватывает их полем 'geo'.
Печатает словарь для plans.py в миллиметрах (k=1, o=(0, 0)) и сохраняет <имя>-check.png —
лист со стенами и проёмами поверх, чтобы сверить. Результат — черновик: проверьте его глазами.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
import pymupdf

MM_PT = 25.4 / 72 * 75      # мм в одном pt листа при 1:75
RES = 10                    # мм в пикселе растра


def fix_text(t):
    try:
        return t.encode('latin-1').decode('cp1251')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return t


def segments(d):
    """Отрезки пути (кривые — ломаной по контрольным точкам)."""
    out = []
    for it in d['items']:
        if it[0] == 'l':
            out.append((it[1].x, it[1].y, it[2].x, it[2].y))
        elif it[0] == 'c':
            pts = it[1:5]
            for a, b in zip(pts, pts[1:]):
                out.append((a.x, a.y, b.x, b.y))
        elif it[0] == 're':
            r = it[1]
            out += [(r.x0, r.y0, r.x1, r.y0), (r.x1, r.y0, r.x1, r.y1), (r.x1, r.y1, r.x0, r.y1), (r.x0, r.y1, r.x0, r.y0)]
        elif it[0] == 'qu':
            q = it[1]
            p = [q.ul, q.ur, q.lr, q.ll, q.ul]
            out += [(a.x, a.y, b.x, b.y) for a, b in zip(p, p[1:])]
    return out


def clusters(items, tol):
    """Объединяет пути, чьи рамки ближе tol (pt)."""
    n = len(items)
    par = list(range(n))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    rects = [it['rect'] for it in items]
    order = sorted(range(n), key=lambda i: rects[i].x0)
    for ii, i in enumerate(order):
        ri = rects[i]
        for j in order[ii + 1:]:
            rj = rects[j]
            if rj.x0 > ri.x1 + tol:
                break
            if rj.y0 <= ri.y1 + tol and rj.y1 >= ri.y0 - tol:
                par[find(i)] = find(j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(items[i])
    return list(groups.values())


def rects_of(mask, min_px=2):
    """Жадно режет маску на прямоугольники (x1, y1, x2, y2) в пикселях."""
    m = mask.copy().astype(bool)
    out = []
    H, W = m.shape
    while True:
        ys, xs = np.nonzero(m)
        if not len(ys):
            break
        y, x = ys[0], xs[0]
        x2 = x
        while x2 + 1 < W and m[y, x2 + 1]:
            x2 += 1
        y2 = y
        while y2 + 1 < H and m[y2 + 1, x:x2 + 1].all():
            y2 += 1
        m[y:y2 + 1, x:x2 + 1] = False
        if x2 - x + 1 >= min_px and y2 - y + 1 >= min_px:
            out.append([x, y, x2 + 1, y2 + 1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf')
    ap.add_argument('page', type=int, help='номер страницы с 1')
    ap.add_argument('name')
    ap.add_argument('--out', default='.')
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--json', help='сохранить стены, окна и двери в JSON для plans.py')
    a = ap.parse_args()
    out = Path(a.out)
    doc = pymupdf.open(a.pdf)
    pg = doc[a.page - 1]
    dr = pg.get_drawings()
    black = lambda x, w: x['type'] == 's' and x.get('color') and max(x['color']) < .05 and abs((x.get('width') or 0) - w) < .02
    wall_d = [x for x in dr if black(x, .85)]
    sym_d = [x for x in dr if black(x, .43)]
    grey_d = [x for x in dr if x['type'] == 's' and x.get('color') and abs(x['color'][0] - .5) < .02]

    wsegs = [s for d in wall_d for s in segments(d)]
    x0 = min(min(s[0], s[2]) for s in wsegs)
    y0 = min(min(s[1], s[3]) for s in wsegs)
    x1 = max(max(s[0], s[2]) for s in wsegs)
    y1 = max(max(s[1], s[3]) for s in wsegs)
    PAD = 40
    W = int((x1 - x0) * MM_PT / RES) + 2 * PAD
    H = int((y1 - y0) * MM_PT / RES) + 2 * PAD
    px = lambda x, y: (int(round((x - x0) * MM_PT / RES)) + PAD, int(round((y - y0) * MM_PT / RES)) + PAD)
    mm = lambda p: int(round(((p - PAD) * RES) / 10.0)) * 10

    # стены: замкнутые контуры, внутри — узкие области
    lines = np.zeros((H, W), np.uint8)
    for s in wsegs:
        cv2.line(lines, px(s[0], s[1]), px(s[2], s[3]), 255, 2)
    free = (lines == 0).astype(np.uint8)
    ff = free.copy()
    cv2.floodFill(ff, None, (0, 0), 2)
    outside = ff == 2
    inner = (ff == 1).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inner, connectivity=4)
    dist = cv2.distanceTransform(inner, cv2.DIST_L2, 3)
    wall = np.zeros((H, W), bool)
    for i in range(1, n):
        comp = lab == i
        if dist[comp].max() < 30:          # уже 600 мм — стена
            wall |= comp
    wall = cv2.dilate(wall.astype(np.uint8), np.ones((3, 3), np.uint8))
    wall = cv2.morphologyEx(wall, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0

    # проёмы
    opens = []
    for g in clusters(sym_d, 1.0):
        segs = [s for d in g for s in segments(d)]
        has_arc = any(it[0] == 'c' for d in g for it in d['items'])
        bx0 = min(min(s[0], s[2]) for s in segs); bx1 = max(max(s[0], s[2]) for s in segs)
        by0 = min(min(s[1], s[3]) for s in segs); by1 = max(max(s[1], s[3]) for s in segs)
        (X0, Y0), (X1, Y1) = px(bx0, by0), px(bx1, by1)
        if X1 - X0 < 25 and Y1 - Y0 < 25:
            continue
        best = None
        for horiz in (True, False):
            hits = []
            if horiz:
                for y in range(Y0, Y1 + 1):
                    if 0 <= y < H and wall[y, max(0, X0 - 3)] and wall[y, min(W - 1, X1 + 3)]:
                        hits.append(y)
            else:
                for x in range(X0, X1 + 1):
                    if 0 <= x < W and wall[max(0, Y0 - 3), x] and wall[min(H - 1, Y1 + 3), x]:
                        hits.append(x)
            # проём тонкий поперёк стены и сплошной
            if len(hits) >= 6 and max(hits) - min(hits) <= 60 and len(hits) >= .8 * (max(hits) - min(hits) + 1) \
                    and (best is None or len(hits) > len(best[1])):
                best = (horiz, hits)
        if not best:
            continue
        horiz, hits = best
        r = [X0, min(hits), X1, max(hits) + 1] if horiz else [min(hits), Y0, max(hits) + 1, Y1]
        o = {'r': r, 'door': has_arc}
        if has_arc:
            L = (r[2] - r[0]) if horiz else (r[3] - r[1])
            # прямая створка — длинный отрезок поперёк стены
            leaf = None
            for s in segs:
                (ax, ay), (bx, by) = px(s[0], s[1]), px(s[2], s[3])
                ln = math.hypot(bx - ax, by - ay)
                perp = abs(bx - ax) < 2 if horiz else abs(by - ay) < 2
                if perp and ln > L * .6 and (leaf is None or ln > leaf[1]):
                    leaf = ((ax + bx) / 2 if horiz else (ay + by) / 2, ln)
            mid = (r[0] + r[2]) / 2 if horiz else (r[1] + r[3]) / 2
            o['hinge'] = 'a' if leaf and leaf[0] < mid else 'b'
            cy = (Y0 + Y1) / 2 if horiz else (X0 + X1) / 2
            wc = (r[1] + r[3]) / 2 if horiz else (r[0] + r[2]) / 2
            o['side'] = -1 if cy < wc else 1
        o['horiz'] = horiz
        opens.append(o)

    # улица: заливка снаружи, когда проёмы закрыты
    block = wall.copy()
    for o in opens:
        r = o['r']
        block[r[1]:r[3], r[0]:r[2]] = True
    # щели в доли миллиметра на стыках обозначений закрываем, чтобы улица не затекала в дом
    sealed = cv2.morphologyEx(block.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
    ff = (~sealed).astype(np.uint8)
    cv2.floodFill(ff, None, (0, 0), 2)
    outside = ff == 2
    if '--debug' in sys.argv:
        cv2.imwrite('debug-outside.png', (outside * 120 + block * 255).clip(0, 255).astype(np.uint8))

    def ext_of(o):
        r = o['r']
        if o['horiz']:
            xm = (r[0] + r[2]) // 2
            return bool(outside[max(0, r[1] - 6), xm] or outside[min(H - 1, r[3] + 6), xm])
        ym = (r[1] + r[3]) // 2
        return bool(outside[ym, max(0, r[0] - 6)] or outside[ym, min(W - 1, r[2] + 6)])
    for o in opens:
        o['ext'] = ext_of(o)
    opens = [o for o in opens if o['door'] or o['ext']]

    # помещения: свободное место внутри дома, проёмы считаем стеной
    roomspace = (~block & ~outside).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(roomspace, connectivity=4)
    words = pg.get_text('words')
    texts = []
    for w in words:
        t = fix_text(w[4])
        texts.append((w[0], w[1], w[2], w[3], t))
    rooms = []
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] * RES * RES / 1e6 < .6:
            continue
        comp = lab == i
        inside = []
        for (tx0, ty0, tx1, ty1, t) in texts:
            X, Y = px((tx0 + tx1) / 2, (ty0 + ty1) / 2)
            if 0 <= X < W and 0 <= Y < H and comp[Y, X]:
                inside.append((ty0, tx0, t, X, Y))
        inside.sort()
        names = [t for _, _, t, _, _ in inside if any(c.isalpha() for c in t) and t not in ('m2', 'м2', 'Ст.М.', 'Ст.М', 'СтМ')]
        name = ' / '.join(names) or '?'      # несколько подписей — помещения слились, разделите руками
        areas = [float(t.replace(',', '.')) for _, _, t, _, _ in inside if ',' in t and t.replace(',', '').isdigit()]
        area = areas[0] if len(areas) == 1 else (areas or None)
        lp = (inside[0][3], inside[0][4]) if inside else None
        rr = [r for r in rects_of(comp, 8) if (r[2] - r[0]) * (r[3] - r[1]) > 400]
        rooms.append({'n': name, 'a': area, 'r': rr, 'lp': lp, 'px': int(stats[i, cv2.CC_STAT_AREA])})

    # мебель
    furn = []
    gx0, gy0, gx1, gy1 = x0 - 120, y0 - 120, x1 + 120, y1 + 120
    grey_in = [d for d in grey_d if d['rect'].x0 > gx0 and d['rect'].x1 < gx1 and d['rect'].y0 > gy0 and d['rect'].y1 < gy1]
    for g in clusters(grey_in, .6):
        segs = [s for d in g for s in segments(d)]
        bx0 = min(min(s[0], s[2]) for s in segs); bx1 = max(max(s[0], s[2]) for s in segs)
        by0 = min(min(s[1], s[3]) for s in segs); by1 = max(max(s[1], s[3]) for s in segs)
        (X0, Y0), (X1, Y1) = px(bx0, by0), px(bx1, by1)
        if (X1 - X0) * (Y1 - Y0) < 60:
            continue
        furn.append([mm(X0), mm(Y0), mm(X1), mm(Y1)])
    furn.sort(key=lambda r: (r[1] // 500, r[0]))

    # вывод
    R = lambda r: [mm(r[0]), mm(r[1]), mm(r[2]), mm(r[3])]
    wr = [R(r) for r in rects_of(wall, 2)]
    if a.json:
        geo = {
            'src': '%s, стр. %d' % (Path(a.pdf).name, a.page),
            'walls': wr,
            'windows': [R(o['r']) for o in opens if not o['door']],
            'doors': [{'r': R(o['r']), 'hinge': o['hinge'], 'side': o['side'], **({'ext': True} if o['ext'] else {})} for o in opens if o['door']],
        }
        Path(a.json).write_text(json.dumps(geo, ensure_ascii=False), encoding='utf-8')
    print("    {\n        'id': '%s', 'title': '%s', 'note': '', 'src': '%s, стр. %d', 'k': 1, 'o': (0, 0)," % (a.name, a.name, Path(a.pdf).name, a.page))
    print("        'walls': %s," % wr)
    print("        'windows': %s," % [R(o['r']) for o in opens if not o['door']])
    print("        'doors': [")
    for o in opens:
        if o['door']:
            print("            {'r': %s, 'hinge': '%s', 'side': %d%s}," % (R(o['r']), o['hinge'], o['side'], ", 'ext': True" if o['ext'] else ''))
    print("        ],\n        'rooms': [")
    for r in sorted(rooms, key=lambda r: -r['px']):
        lp = ", 'lp': (%d, %d)" % (mm(r['lp'][0]), mm(r['lp'][1])) if r['lp'] else ''
        print("            {'n': '%s', 'a': %s, 'k': '', 'r': %s%s}," % (r['n'], r['a'], [R(x) for x in r['r']], lp))
    print("        ],\n        'furn': [  # рамки серых групп, мм")
    for i, f in enumerate(furn):
        print("            # %2d: %s  %d×%d" % (i, f, f[2] - f[0], f[3] - f[1]))
    print("        ],\n    },")

    # картинки для сверки
    S = 2
    pix = pg.get_pixmap(matrix=pymupdf.Matrix(S * MM_PT / RES, S * MM_PT / RES), clip=pymupdf.Rect(x0 - PAD * RES / MM_PT, y0 - PAD * RES / MM_PT, x1 + PAD * RES / MM_PT, y1 + PAD * RES / MM_PT))
    base = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3].copy()
    base = cv2.cvtColor(base, cv2.COLOR_RGB2BGR)
    chk = base.copy()
    for r in rects_of(wall, 2):
        cv2.rectangle(chk, (r[0] * S, r[1] * S), (r[2] * S, r[3] * S), (200, 120, 40), -1)
    for o in opens:
        r = o['r']
        cv2.rectangle(chk, (r[0] * S, r[1] * S), (r[2] * S, r[3] * S), (0, 0, 230) if o['door'] else (0, 200, 0), 2)
        if o['door']:
            tx = (r[0] * S, r[1] * S - 4)
            cv2.putText(chk, o['hinge'] + ('%+d' % o['side']) + ('E' if o['ext'] else ''), tx, cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 0, 230), 1)
    for r in rooms:
        for x in r['r']:
            cv2.rectangle(chk, (x[0] * S, x[1] * S), (x[2] * S, x[3] * S), (180, 0, 180), 1)
        if r['lp']:
            cv2.putText(chk, r['n'][:10], (r['lp'][0] * S, r['lp'][1] * S), cv2.FONT_HERSHEY_SIMPLEX, .5, (180, 0, 180), 1)
    cv2.imwrite(str(out / (a.name + '-check.png')), chk)
    fim = base.copy()
    for v in range(0, int(max(W, H) * RES), 500):
        p = (v // RES + PAD) * S
        c = (230, 210, 210) if v % 1000 else (230, 150, 150)
        cv2.line(fim, (p, 0), (p, fim.shape[0]), c, 1)
        cv2.line(fim, (0, p), (fim.shape[1], p), c, 1)
        if v % 1000 == 0:
            cv2.putText(fim, str(v), (p + 2, 12), cv2.FONT_HERSHEY_SIMPLEX, .4, (200, 0, 0), 1)
            cv2.putText(fim, str(v), (2, p - 2), cv2.FONT_HERSHEY_SIMPLEX, .4, (200, 0, 0), 1)
    for i, f in enumerate(furn):
        p1 = ((f[0] // RES + PAD) * S, (f[1] // RES + PAD) * S)
        p2 = ((f[2] // RES + PAD) * S, (f[3] // RES + PAD) * S)
        cv2.rectangle(fim, p1, p2, (0, 140, 255), 1)
        cv2.putText(fim, str(i), (p1[0] + 2, p1[1] + 13), cv2.FONT_HERSHEY_SIMPLEX, .45, (0, 0, 255), 1)
    cv2.imwrite(str(out / (a.name + '-furn.png')), fim)


if __name__ == '__main__':
    sys.exit(main())
