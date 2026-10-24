/* Модель дома: все размеры в мм. План: X — вправо, Y — вниз; верх плана — север.
   Контур дома — ортогональный многоугольник по наружной грани несущего слоя, вершины по часовой стрелке.
   Ребро контура называется по id своей начальной вершины; проёмы в наружных стенах ссылаются на него.
   Несущая стена, мокрая зона и лестница общие для всех этажей; перегородки, проёмы, мебель и назначения помещений — у каждого этажа свои. */
(function () {
'use strict';
const DK = window.DK = window.DK || {};

const SPEC = {
  outer: {
    gas: { t: 400, n: 'Газобетон D400–D500, 400 мм' },
    brick: { t: 510, n: 'Кирпич в 2 кирпича, 510 мм' },
  },
  bearing: { t: 380, n: 'Кирпич в 1,5 кирпича, 380 мм' },
  part: { t: 120, n: 'Кирпич в полкирпича, 120 мм' },
  clad: {
    plaster: { n: 'Тонкослойная штукатурка по утеплителю', s: 'Штукатурка', gap: 0, t: 10, insul: 100 },
    brick: { n: 'Облицовочный кирпич', s: 'Облицовочный кирпич', gap: 20, t: 120, insul: 50 },
    fibro: { n: 'Фиброцементные панели, вентфасад', s: 'Фиброцемент', gap: 40, t: 10, insul: 50 },
    planken: { n: 'Планкен, вентфасад', s: 'Планкен', gap: 40, t: 20, insul: 50 },
    siding: { n: 'Сайдинг, вентфасад', s: 'Сайдинг', gap: 40, t: 20, insul: 50 },
  },
  insul: [0, 50, 100, 150],
  slabMax: 6000, // пролёт пустотной плиты ПК в частном доме, мм в чистоте
  slabMin: 2400,
};

const FLOORS = [
  { id: 'b', n: 'Цокольный', s: 'Цоколь' },
  { id: 'f1', n: '1 этаж', s: '1' },
  { id: 'f2', n: '2 этаж', s: '2' },
  { id: 'f3', n: '3 этаж', s: '3' },
];

const ROOM = {
  none: { n: 'Помещение' },
  kl: { n: 'Кухня-гостиная', min: 16 },
  living: { n: 'Гостиная', min: 14 },
  kitchen: { n: 'Кухня', min: 6 },
  bed: { n: 'Спальня', min: 8 },
  kids: { n: 'Детская', min: 8 },
  office: { n: 'Кабинет', min: 6 },
  hall: { n: 'Холл', pass: true },
  tamb: { n: 'Тамбур', pass: true },
  corr: { n: 'Коридор', pass: true },
  bath: { n: 'Санузел', wet: true },
  laundry: { n: 'Прачечная', wet: true },
  boiler: { n: 'Котельная', wet: true },
  sauna: { n: 'Сауна', wet: true },
  dress: { n: 'Гардеробная' },
  store: { n: 'Кладовая' },
  garage: { n: 'Гараж' },
  void: { n: 'Второй свет', upper: true },
  loggia: { n: 'Лоджия', upper: true, cold: true },
};

/* требования к котельной (газ, до 150 кВт): СП 402.1325800.2018, п. 5.2 — сверять с ТУ газовой службы */
const BOILER = { vol: 15, height: 2500, glazing: 0.03, door: 800 };
/* проём без двери: допустимая ширина */
const PASS = { min: 700, maxPart: 3000, maxBearing: 2400, lintel: 1000 };

const STAIRS = {
  straight: { n: 'Прямая', w: 1000, l: 3600 },
  L: { n: 'Г-образная с площадкой', w: 2100, l: 3200 },
  U: { n: 'П-образная с площадкой', w: 2200, l: 2900 },
  spiral: { n: 'Винтовая', w: 1800, l: 1800 },
};

let uid = Date.now() % 100000;
const id = (p) => p + (uid++).toString(36);

function ts(p) { return SPEC.outer[p.wallMat].t; }
function extT(p) { const c = SPEC.clad[p.clad] || SPEC.clad.plaster; return p.insul + c.gap + c.t; }
function totalT(p) { return ts(p) + extT(p); }
function storey(p) { return p.hClear + p.slab; }
function floorsOf(p) { return (p.basement ? ['b'] : []).concat(['f1', 'f2', 'f3'].slice(0, p.floors)); }
function floorName(fid) { return FLOORS.find(f => f.id === fid).n; }
function elev(p, fid) { return fid === 'b' ? -storey(p) : (Number(fid[1]) - 1) * storey(p); }
function emptyLevel() { return { parts: [], open: [], furn: [], names: [] }; }

/* допустимая ширина проёма по типу и стене */
function opLimits(p, w, o) {
  const len = w ? w.a1 - w.a0 : 99999;
  if (o.kind === 'win') return { min: 400, max: Math.max(400, w && w.kind === 'outer' ? w.edge.hi - w.edge.lo - 2 * ts(p) - 600 : len - 200) };
  if (o.kind === 'door') return { min: 600, max: 1200 };
  if (o.kind === 'entry') return { min: 900, max: 2000 };
  if (o.kind === 'pass') return { min: PASS.min, max: Math.min(len - 200, w && w.kind === 'bearing' ? PASS.maxBearing : PASS.maxPart) };
  return { min: 400, max: len };
}
function opSize(p, o) {
  if (o.kind === 'door' || o.kind === 'pass') return { sill: 0, h: 2100 };
  if (o.kind === 'entry') return { sill: 0, h: 2200 };
  if (o.pano) return { sill: 0, h: p.hClear - 250 };
  return { sill: o.sill != null ? o.sill : 850, h: o.h || 1500 };
}

/* ---------- контур ---------- */
function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }
function inside(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
/* рёбра контура: ось, линия, пределы, наружная нормаль, сторона света, выпуклость концов */
function edges(p) {
  const P = p.poly, n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n], z = P[(i - 1 + n) % n];
    const axis = a.y === b.y ? 'x' : 'y';
    const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const o = axis === 'x' ? -dx : dy; // наружу: для X-ребра — знак по Y, для Y-ребра — по X
    const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
    const dPrev = [Math.sign(a.x - z.x), Math.sign(a.y - z.y)], dNext = [Math.sign(c.x - b.x), Math.sign(c.y - b.y)];
    out.push({
      id: a.id, i, a, b, axis, out: o, line: axis === 'x' ? a.y : a.x,
      lo: axis === 'x' ? Math.min(a.x, b.x) : Math.min(a.y, b.y), hi: axis === 'x' ? Math.max(a.x, b.x) : Math.max(a.y, b.y),
      dir: axis === 'x' ? dx : dy,
      side: axis === 'x' ? (o < 0 ? 'N' : 'S') : (o > 0 ? 'E' : 'W'),
      convexA: cross(dPrev, [dx, dy]) > 0, convexB: cross([dx, dy], dNext) > 0,
    });
  }
  return out;
}
/* контур, сдвинутый наружу на d (облицовка, утеплитель) */
function offsetPoly(p, d) {
  const E = edges(p), n = E.length, pts = [];
  for (let i = 0; i < n; i++) {
    const e0 = E[(i - 1 + n) % n], e1 = E[i];
    const l0 = e0.line + e0.out * d, l1 = e1.line + e1.out * d;
    pts.push(e1.axis === 'x' ? { x: l0, y: l1 } : { x: l1, y: l0 });
  }
  return pts;
}
/* разбиение контура на прямоугольники (жадно, крупные первыми) */
function decompose(p) {
  const xs = Array.from(new Set(p.poly.map(v => v.x))).sort((a, b) => a - b), ys = Array.from(new Set(p.poly.map(v => v.y))).sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1, inn = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) inn[j * nx + i] = inside(p.poly, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
  const used = inn.map(() => false), rects = [];
  for (;;) {
    let best = null;
    for (let j0 = 0; j0 < ny; j0++) for (let i0 = 0; i0 < nx; i0++) {
      if (!inn[j0 * nx + i0] || used[j0 * nx + i0]) continue;
      for (let j1 = j0; j1 < ny; j1++) {
        if (!inn[j1 * nx + i0] || used[j1 * nx + i0]) break;
        for (let i1 = i0; i1 < nx; i1++) {
          let ok = true;
          for (let j = j0; j <= j1 && ok; j++) if (!inn[j * nx + i1] || used[j * nx + i1]) ok = false;
          if (!ok) break;
          const a = (xs[i1 + 1] - xs[i0]) * (ys[j1 + 1] - ys[j0]);
          if (!best || a > best.a) best = { a, i0, i1, j0, j1 };
        }
      }
    }
    if (!best) break;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) used[j * nx + i] = true;
    rects.push({ x0: xs[best.i0], x1: xs[best.i1 + 1], y0: ys[best.j0], y1: ys[best.j1 + 1] });
  }
  return rects;
}
function mainRect(p) { return decompose(p)[0]; }
/* интервал линии внутри контура (по наружным граням); для несущей стены */
function lineSpan(p, axis, pos, prefer) {
  const cr = edges(p).filter(e => e.axis === (axis === 'h' ? 'y' : 'x') && pos > e.lo && pos < e.hi).map(e => e.line).sort((a, b) => a - b);
  const iv = [];
  for (let i = 0; i + 1 < cr.length; i += 2) iv.push([cr[i], cr[i + 1]]);
  if (!iv.length) return null;
  const M = prefer || mainRect(p), m0 = axis === 'h' ? M.x0 : M.y0, m1 = axis === 'h' ? M.x1 : M.y1;
  return iv.reduce((a, b) => (Math.min(b[1], m1) - Math.max(b[0], m0)) > (Math.min(a[1], m1) - Math.max(a[0], m0)) ? b : a);
}

/* ---------- стены ---------- */
function walls(p, fid) {
  const t = ts(p), out = [];
  for (const e of edges(p)) {
    let a0 = e.lo, a1 = e.hi;
    // во внутреннем углу ребро продлевается внутрь на толщину стены, чтобы угол был заполнен
    const startLo = e.dir > 0;
    if (!e.convexA) { if (startLo) a0 -= t; else a1 += t; }
    if (!e.convexB) { if (startLo) a1 += t; else a0 -= t; }
    const t0 = e.out < 0 ? e.line : e.line - t, t1 = t0 + t;
    const w = e.axis === 'x' ? { x0: a0, x1: a1, y0: t0, y1: t1 } : { x0: t0, x1: t1, y0: a0, y1: a1 };
    out.push(Object.assign(w, { id: e.id, kind: 'outer', axis: e.axis, out: e.out, line: e.line, side: e.side, edge: e }));
  }
  const bh = SPEC.bearing.t / 2;
  p.bearing.forEach((b, i) => {
    const sp = lineSpan(p, b.axis, b.pos);
    if (!sp) return;
    if (b.axis === 'h') out.push({ id: 'B' + i, kind: 'bearing', axis: 'x', x0: sp[0] + t, x1: sp[1] - t, y0: b.pos - bh, y1: b.pos + bh });
    else out.push({ id: 'B' + i, kind: 'bearing', axis: 'y', x0: b.pos - bh, x1: b.pos + bh, y0: sp[0] + t, y1: sp[1] - t });
  });
  const ph = SPEC.part.t / 2, lv = p.levels[fid];
  if (lv) lv.parts.forEach(w => {
    const r = w.rail ? 30 : ph;
    if (w.y1 === w.y2) out.push({ id: w.id, kind: 'part', rail: !!w.rail, axis: 'x', x0: Math.min(w.x1, w.x2), x1: Math.max(w.x1, w.x2), y0: w.y1 - r, y1: w.y1 + r });
    else out.push({ id: w.id, kind: 'part', rail: !!w.rail, axis: 'y', x0: w.x1 - r, x1: w.x1 + r, y0: Math.min(w.y1, w.y2), y1: Math.max(w.y1, w.y2) });
  });
  out.forEach(w => {
    w.a0 = w.axis === 'x' ? w.x0 : w.y0; w.a1 = w.axis === 'x' ? w.x1 : w.y1;
    w.t = w.axis === 'x' ? w.y1 - w.y0 : w.x1 - w.x0;
    w.m = w.axis === 'x' ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2;
  });
  return out;
}
/* слой облицовки ребра: от наружной грани несущего слоя наружу на ext */
function cladRect(p, w, ext) {
  const e = w.edge, P = offsetPoly(p, ext), n = P.length, i = e.i;
  const q0 = P[i], q1 = P[(i + 1) % n];
  const b0 = e.axis === 'x' ? Math.min(q0.x, q1.x) : Math.min(q0.y, q1.y), b1 = e.axis === 'x' ? Math.max(q0.x, q1.x) : Math.max(q0.y, q1.y);
  const a0 = Math.min(e.lo, b0), a1 = Math.max(e.hi, b1);
  const t0 = e.out < 0 ? e.line - ext : e.line, t1 = t0 + ext;
  return { a0, a1, t0, t1 };
}

/* ---------- помещения ---------- */
function rooms(p, fid) {
  const ws = walls(p, fid), W = p.W, D = p.D;
  const uniq = (a) => Array.from(new Set(a.map(Math.round))).sort((m, n) => m - n);
  const xs = uniq([0, W].concat(...ws.map(w => [w.x0, w.x1]), p.poly.map(v => v.x))).filter(v => v >= 0 && v <= W);
  const ys = uniq([0, D].concat(...ws.map(w => [w.y0, w.y1]), p.poly.map(v => v.y))).filter(v => v >= 0 && v <= D);
  const nx = xs.length - 1, ny = ys.length - 1, cell = new Int32Array(nx * ny).fill(-1);
  const cw = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (xs[i] + xs[i + 1]) / 2, y = (ys[j] + ys[j + 1]) / 2;
    if (!inside(p.poly, x, y)) { cell[j * nx + i] = -3; continue; }
    const w = ws.find(v => x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1);
    if (w) { cell[j * nx + i] = -2; cw[j * nx + i] = w; }
  }
  const regs = [];
  for (let s = 0; s < nx * ny; s++) {
    if (cell[s] !== -1) continue;
    const r = { i: regs.length, area: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, cells: [], sides: new Set(), big: null };
    const st = [s]; cell[s] = r.i;
    while (st.length) {
      const c = st.pop(), i = c % nx, j = (c - i) / nx;
      const cx0 = xs[i], cx1 = xs[i + 1], cy0 = ys[j], cy1 = ys[j + 1], a = (cx1 - cx0) * (cy1 - cy0);
      r.area += a; r.cells.push([cx0, cy0, cx1, cy1]);
      if (!r.big || a > r.big[4]) r.big = [cx0, cy0, cx1, cy1, a];
      r.x0 = Math.min(r.x0, cx0); r.y0 = Math.min(r.y0, cy0); r.x1 = Math.max(r.x1, cx1); r.y1 = Math.max(r.y1, cy1);
      for (const [a2, b2] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a2 < 0 || b2 < 0 || a2 >= nx || b2 >= ny) continue;
        const k = b2 * nx + a2;
        if (cell[k] === -1) { cell[k] = r.i; st.push(k); }
        else if (cell[k] === -2 && cw[k].kind === 'outer') r.sides.add(cw[k].id);
      }
    }
    r.area /= 1e6;
    r.rect = Math.abs(r.area * 1e6 - (r.x1 - r.x0) * (r.y1 - r.y0)) < 1;
    r.cx = r.rect ? (r.x0 + r.x1) / 2 : (r.big[0] + r.big[2]) / 2;
    r.cy = r.rect ? (r.y0 + r.y1) / 2 : (r.big[1] + r.big[3]) / 2;
    if (r.area >= 0.3) regs.push(r);
  }
  regs.forEach((r, k) => { r.i = k; r.type = 'none'; });
  const at = (x, y) => regs.find(r => r.cells.some(c => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]));
  const lv = p.levels[fid];
  if (lv) lv.names.forEach(nm => { const r = at(nm.x, nm.y); if (r && r.type === 'none') { r.type = nm.type; r.nameRef = nm; } });
  if (fid === 'f1' || fid === 'b') regs.forEach(r => { if (r.type === 'void') r.type = 'none'; });
  regs.at = at;
  return regs;
}
function opRegions(p, fid, o, regs) { return opSides(p, fid, o, regs).filter(Boolean); }
/* помещения по сторонам проёма: [сторона −, сторона +] по оси, перпендикулярной стене */
function opSides(p, fid, o, regs) {
  const w = walls(p, fid).find(v => v.id === o.wall);
  if (!w) return [null, null];
  const d = w.t / 2 + 30;
  return [-1, 1].map(s => {
    const x = w.axis === 'x' ? o.c : w.m + s * d, y = w.axis === 'x' ? w.m + s * d : o.c;
    return regs.at(x, y) || null;
  });
}
/* куда открывается дверь: из котельной и санузлов — наружу из помещения, входная — на улицу,
   остальные — в комнату, а не в коридор. Петли — у ближнего конца стены. */
function doorSwing(p, fid, o, w, regs) {
  let side;
  if (w.kind === 'outer') side = w.out;
  else {
    const [A, B] = opSides(p, fid, o, regs);
    const pr = (r) => !r ? 1 : (ROOM[r.type] || {}).wet ? 0 : (ROOM[r.type] || {}).pass ? 1 : 2;
    const pa = pr(A), pb = pr(B);
    side = pa === 0 && pb !== 0 ? 1 : pb === 0 && pa !== 0 ? -1 : (pb >= pa ? 1 : -1);
  }
  const hingeLo = (o.c - w.a0) <= (w.a1 - o.c);
  return { side, hingeLo };
}

/* ---------- лестницы ---------- */
function stairParts(s) {
  const t = s.type || 'straight', w = s.w, l = s.l;
  if (t === 'L') { const L1 = l - 1000, L2 = w - 1000, hL = L1 / (L1 + L2); return { flights: [{ u0: 0, v0: 0, u1: 1000, v1: L1, d: [0, 1], h0: 0, h1: hL }, { u0: 1000, v0: L1, u1: w, v1: l, d: [1, 0], h0: hL, h1: 1 }], lands: [{ u0: 0, v0: L1, u1: 1000, v1: l, h: hL }] }; }
  if (t === 'U') { const L1 = l - 1100; return { flights: [{ u0: 0, v0: 0, u1: 1000, v1: L1, d: [0, 1], h0: 0, h1: 0.5 }, { u0: w - 1000, v0: 0, u1: w, v1: L1, d: [0, -1], h0: 0.5, h1: 1 }], lands: [{ u0: 0, v0: L1, u1: w, v1: l, h: 0.5 }] }; }
  if (t === 'spiral') return { flights: [], lands: [], spiral: { cu: w / 2, cv: l / 2, r: Math.min(w, l) / 2, turn: 0.9 } };
  return { flights: [{ u0: 0, v0: 0, u1: w, v1: l, d: [0, 1], h0: 0, h1: 1 }], lands: [] };
}
function stairToWorld(s, u, v) {
  const { w, l, x, y } = s;
  return [[x + u, y + v], [x + l - v, y + u], [x + w - u, y + l - v], [x + v, y + w - u]][s.rot % 4];
}
function stairToLocal(s, X, Y) {
  const { w, l, x, y } = s, dx = X - x, dy = Y - y;
  return [[dx, dy], [dy, l - dx], [w - dx, l - dy], [w - dy, dx]][s.rot % 4];
}
function stairDir(s, d) { return [[d[0], d[1]], [-d[1], d[0]], [-d[0], -d[1]], [d[1], -d[0]]][s.rot % 4]; }
function stairRect(p) { const s = p.stair; return s ? { x0: s.x, y0: s.y, x1: s.x + (s.rot % 2 ? s.l : s.w), y1: s.y + (s.rot % 2 ? s.w : s.l) } : null; }
/* доля подъёма 0..1 в точке, null — точка не на ступенях и не на площадке */
function stairHeight(p, X, Y) {
  const s = p.stair; if (!s) return null;
  const [u, v] = stairToLocal(s, X, Y), P = stairParts(s);
  if (u < 0 || v < 0 || u > s.w || v > s.l) return null;
  if (P.spiral) {
    const S = P.spiral, du = u - S.cu, dv = v - S.cv, r = Math.hypot(du, dv);
    if (r > S.r || r < 120) return null;
    let a = Math.atan2(dv, du) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
    return Math.min(1, a / (Math.PI * 2 * S.turn));
  }
  for (const f of P.flights) {
    if (u < f.u0 || u > f.u1 || v < f.v0 || v > f.v1) continue;
    const len = f.d[0] ? f.u1 - f.u0 : f.v1 - f.v0;
    const pr = f.d[0] > 0 ? u - f.u0 : f.d[0] < 0 ? f.u1 - u : f.d[1] > 0 ? v - f.v0 : f.v1 - v;
    return f.h0 + (f.h1 - f.h0) * Math.max(0, Math.min(1, pr / len));
  }
  for (const L of P.lands) if (u >= L.u0 && u <= L.u1 && v >= L.v0 && v <= L.v1) return L.h;
  return null;
}

/* зона выхода с верхней ступени (0,8 м за последним маршем) — там не должно быть стен */
function stairExit(p) {
  const s = p.stair; if (!s) return null;
  const P = stairParts(s), D = 800;
  let r;
  if (P.spiral) {
    const S = P.spiral, th = Math.PI * 2 * (S.turn + 1) / 2 - Math.PI / 2, cu = S.cu + Math.cos(th) * (S.r + D / 2), cv = S.cv + Math.sin(th) * (S.r + D / 2);
    r = [cu - D / 2, cv - D / 2, cu + D / 2, cv + D / 2];
  } else {
    const f = P.flights[P.flights.length - 1], d = f.d;
    r = d[1] > 0 ? [f.u0, f.v1, f.u1, f.v1 + D] : d[1] < 0 ? [f.u0, f.v0 - D, f.u1, f.v0] : d[0] > 0 ? [f.u1, f.v0, f.u1 + D, f.v1] : [f.u0 - D, f.v0, f.u0, f.v1];
  }
  const a = stairToWorld(s, r[0], r[1]), b = stairToWorld(s, r[2], r[3]);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}
/* выход наверх свободен: зона за верхней ступенью внутри дома и не пересекает стены (двери не мешают) */
function stairExitOk(p, fid) {
  const z = stairExit(p); if (!z) return true;
  const m = 60, Z = { x0: z.x0 + m, y0: z.y0 + m, x1: z.x1 - m, y1: z.y1 - m };
  if (![[Z.x0, Z.y0], [Z.x1, Z.y0], [Z.x0, Z.y1], [Z.x1, Z.y1]].every(([x, y]) => inside(p.poly, x, y))) return false;
  return !walls(p, fid).some(w => {
    if (!inter(Z, w)) return false;
    // проём двери, перекрывающий зону по длине стены, — проход есть
    const lo = w.axis === 'x' ? Z.x0 : Z.y0, hi = w.axis === 'x' ? Z.x1 : Z.y1;
    return !p.levels[fid].open.some(o => o.wall === w.id && o.kind !== 'win' && o.c - o.w / 2 <= lo + 100 && o.c + o.w / 2 >= hi - 100);
  });
}

/* ---------- несущая стена ---------- */
function spansOf(origin, clear, pos, bt) {
  const edgesA = [origin].concat(...pos.slice().sort((a, b) => a - b).map(v => [v - bt / 2, v + bt / 2]), [origin + clear]);
  const s = [];
  for (let i = 0; i < edgesA.length; i += 2) s.push(edgesA[i + 1] - edgesA[i]);
  return s;
}
function fmtM(mm) { return (mm / 1000).toFixed(2).replace(/0$/, '').replace('.', ','); }
/* проверка пролётов по частям дома: пролёт опирается на наружные стены и несущие */
function spanReport(p, bearing) {
  const t = ts(p), E = edges(p), B = bearing || p.bearing, out = [];
  const onOuter = (axis, line, lo, hi) => {
    const L = E.filter(e => e.axis === axis && e.line === line).reduce((s, e) => s + Math.max(0, Math.min(e.hi, hi) - Math.max(e.lo, lo)), 0);
    return L >= (hi - lo) * 0.5;
  };
  for (const r of decompose(p)) {
    let best = null;
    for (const dir of ['x', 'y']) {
      // плиты вдоль dir: опоры — линии поперёк
      const lo = dir === 'x' ? r.x0 : r.y0, hi = dir === 'x' ? r.x1 : r.y1, c0 = dir === 'x' ? r.y0 : r.x0, c1 = dir === 'x' ? r.y1 : r.x1;
      const eAxis = dir === 'x' ? 'y' : 'x';
      if (!onOuter(eAxis, lo, c0, c1) || !onOuter(eAxis, hi, c0, c1)) continue;
      const pos = B.filter(b => (dir === 'x' ? b.axis === 'v' : b.axis === 'h') && b.pos > lo && b.pos < hi).map(b => b.pos);
      const s = spansOf(lo + t, hi - lo - 2 * t, pos, SPEC.bearing.t);
      const mx = Math.max(...s);
      if (!best || mx < best.mx) best = { dir, s, mx };
    }
    out.push({ r, best, ok: !!best && best.mx <= SPEC.slabMax });
  }
  return out;
}
function bearingVariants(p) {
  const t = ts(p), bt = SPEC.bearing.t, res = [], M = mainRect(p);
  const mx = SPEC.slabMax, mn = SPEC.slabMin, r50 = (v) => Math.round(v / 50) * 50;
  const longIs = (M.x1 - M.x0) >= (M.y1 - M.y0) ? 'h' : 'v';
  const label = (ax, n) => (ax === longIs ? 'Продольная' : 'Поперечная') + (n > 1 ? ' ×2' : '');
  if (spanReport(p, []).every(x => x.ok)) {
    const s = spanReport(p, [])[0].best;
    res.push({ walls: [], n: 'Без внутренней несущей стены', note: 'плиты перекрывают пролёт ' + fmtM(s ? s.mx : 0) + ' м' });
  }
  for (const ax of ['h', 'v']) {
    const origin = (ax === 'h' ? M.y0 : M.x0) + t, clear = (ax === 'h' ? M.y1 - M.y0 : M.x1 - M.x0) - 2 * t;
    for (const n of [1, 2]) {
      const span = (clear - n * bt) / (n + 1);
      if (span > mx || span < mn) continue;
      if (n === 2 && (clear - bt) / 2 <= mx) continue;
      const fracs = n === 1 ? [0.5, 0.42, 0.58, 0.36, 0.64] : [0];
      const seen = new Set();
      for (const f of fracs) {
        const pos = n === 1 ? [r50(origin + bt / 2 + (clear - bt) * f)] : [1, 2].map(k => r50(origin + k * span + (k - 0.5) * bt));
        const spans = spansOf(origin, clear, pos, bt);
        if (spans.some(s => s > mx || s < mn)) continue;
        const key = pos.join(',');
        if (seen.has(key)) continue; seen.add(key);
        const walls2 = pos.map(v => ({ axis: ax, pos: v }));
        if (!spanReport(p, walls2).every(x => x.ok)) continue;
        res.push({ walls: walls2, n: label(ax, n) + (f === 0.5 || n === 2 ? ' по центру' : ' со смещением'), note: 'пролёты ' + spans.map(fmtM).join(' + ') + ' м' });
      }
    }
  }
  return res;
}

function wetVariants(p) {
  const t = ts(p), M = mainRect(p), zw = 2600, zh = 2600, out = [];
  const b = p.bearing[0];
  const cx = (x) => Math.max(M.x0 + t, Math.min(x, M.x1 - t - zw)), cy = (y) => Math.max(M.y0 + t, Math.min(y, M.y1 - t - zh));
  if (b && b.axis === 'h') { for (const x of [M.x0 + t, M.x1 - t - zw]) for (const y of [b.pos - 190 - zh, b.pos + 190]) out.push({ x: cx(x), y: cy(y), w: zw, h: zh }); }
  else if (b) { for (const y of [M.y0 + t, M.y1 - t - zh]) for (const x of [b.pos - 190 - zw, b.pos + 190]) out.push({ x: cx(x), y: cy(y), w: zw, h: zh }); }
  else for (const x of [M.x0 + t, M.x1 - t - zw]) for (const y of [M.y0 + t, M.y1 - t - zh]) out.push({ x, y, w: zw, h: zh });
  return out;
}

const inter = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/* ---------- проверки ---------- */
function checks(p) {
  const out = [], t = ts(p);
  const add = (lv, txt, fid) => out.push({ lv, txt, fid });
  const sr = spanReport(p);
  if (sr.every(x => x.ok)) add('ok', 'Перекрытия: пролёты до ' + fmtM(Math.max(...sr.map(x => x.best.mx))) + ' м — в пределах ' + fmtM(SPEC.slabMax) + ' м');
  else sr.filter(x => !x.ok).forEach(x => add('err', `Часть дома ${fmtM(x.r.x1 - x.r.x0)} × ${fmtM(x.r.y1 - x.r.y0)} м: пролёт перекрытия больше ${fmtM(SPEC.slabMax)} м — выберите несущую стену или уменьшите выступ`));
  const wz = p.wet ? { x0: p.wet.x, y0: p.wet.y, x1: p.wet.x + p.wet.w, y1: p.wet.y + p.wet.h } : null;
  const st = stairRect(p), fl = floorsOf(p);
  if (st && walls(p, 'f1').some(w => w.kind === 'bearing' && inter(st, w))) add('err', 'Лестница пересекает несущую стену');
  if (st && ![[st.x0, st.y0], [st.x1, st.y0], [st.x0, st.y1], [st.x1, st.y1]].every(([x, y]) => inside(p.poly, x, y))) add('err', 'Лестница выходит за контур дома');
  if (fl.length > 1 && !p.stair) add('warn', 'Добавьте лестницу между этажами');
  if (st && fl.length > 1) fl.slice(1).forEach(fid => { if (!stairExitOk(p, fid)) add('err', `${floorName(fid)}: выход с лестницы упирается в стену — оставьте площадку 0,8 м за верхней ступенью или разверните лестницу`, fid); });
  const boilers = [];
  fl.forEach((fid, k) => {
    const regs = rooms(p, fid), lv = p.levels[fid], fn = floorName(fid);
    for (const r of regs) {
      const R = ROOM[r.type] || ROOM.none;
      if (R.wet && wz && !inter(r, wz)) add('warn', `${fn}: ${R.n.toLowerCase()} вне мокрой зоны — стояки не совпадут по этажам`, fid);
      if (R.min && r.area < R.min) add('warn', `${fn}: ${R.n.toLowerCase()} ${fmtA(r.area)} м² — меньше ${R.min} м²`, fid);
      if (r.type === 'boiler') boilers.push({ r, fid, regs });
      if (r.type === 'void') {
        const below = rooms(p, fl[k - 1]).find(q => q.cells.some(c => r.cx >= c[0] && r.cx <= c[2] && r.cy >= c[1] && r.cy <= c[3]));
        if (below && (ROOM[below.type] || {}).wet) add('warn', `${fn}: второй свет над помещением «${ROOM[below.type].n}»`, fid);
        if (st && inter(r, st)) add('warn', `${fn}: второй свет совмещён с лестничным проёмом — проверьте ограждение`, fid);
      }
    }
    const ws = walls(p, fid), inner = ws.filter(w => w.kind !== 'outer');
    for (const o of lv.open) {
      const w = ws.find(v => v.id === o.wall);
      if (!w) continue;
      const s0 = o.c - o.w / 2, s1 = o.c + o.w / 2;
      if (w.kind === 'outer') {
        if (s0 < w.edge.lo + t + 300 || s1 > w.edge.hi - t - 300) add('warn', `${fn}: проём ближе 300 мм к углу (фасад ${sideName(w.side)})`, fid);
        const face = w.line - w.out * t;
        const hit = inner.find(v => w.axis === 'x' ? (v.axis === 'y' && v.x1 > s0 && v.x0 < s1 && v.y0 <= face + 1 && v.y1 >= face - 1)
                                                   : (v.axis === 'x' && v.y1 > s0 && v.y0 < s1 && v.x0 <= face + 1 && v.x1 >= face - 1));
        if (hit) add('err', `${fn}: ${o.kind === 'win' ? 'окно' : 'дверь'} упирается в ${hit.kind === 'bearing' ? 'несущую стену' : 'перегородку'} (фасад ${sideName(w.side)})`, fid);
      }
      if (s0 < w.a0 + 50 || s1 > w.a1 - 50) add('warn', `${fn}: проём выходит за пределы стены`, fid);
      if (o.kind === 'pass') {
        if (o.w < PASS.min) add('warn', `${fn}: проём без двери уже ${PASS.min} мм`, fid);
        if (w.kind === 'bearing' && o.w > PASS.maxBearing) add('err', `${fn}: проём ${o.w} мм в несущей стене шире ${PASS.maxBearing} мм`, fid);
        if (w.kind === 'part' && o.w > PASS.maxPart) add('warn', `${fn}: проём ${o.w} мм шире ${PASS.maxPart} мм — проще убрать перегородку`, fid);
      }
      const near = lv.open.find(q => q !== o && q.wall === o.wall && Math.abs(q.c - o.c) < (q.w + o.w) / 2 + 300);
      if (near && o.id < near.id) add('warn', `${fn}: проёмы ближе 300 мм друг к другу`, fid);
    }
  });
  for (const x of p.ext || []) {
    const n = extName(x);
    if (x.kind === 'garage') { if (x.gtype === 'attached') add('ok', `${n}: стена между гаражом и домом — противопожарная, дверь в дом EI 30`); continue; }
    if (!extExit(p, x) && x.kind !== 'porch') add('warn', `${n}: нет выхода — поставьте дверь или панорамное окно на эту стену`);
    if (x.kind === 'balcony' && x.d > BALCONY_CANT) add('ok', `${n} ${fmtM(x.d)} м: вылет больше ${fmtM(BALCONY_CANT)} м — добавлены колонны до земли`);
    if (x.kind === 'balcony' && !floorsOf(p).includes(x.fid)) add('err', `${n}: этажа ${floorName(x.fid)} нет в доме`);
  }
  if (!boilers.length) add('warn', 'Нет котельной: назначьте помещение у наружной стены на 1 этаже или в цоколе');
  for (const { r, fid, regs } of boilers) {
    if (fid === 'f2' || fid === 'f3') add('warn', `${floorName(fid)}: котельную удобнее на 1 этаже или в цоколе`, fid);
    const vol = r.area * p.hClear / 1000;
    add(vol >= BOILER.vol ? 'ok' : 'err', `Котельная: объём ${fmtA(vol)} м³ ${vol >= BOILER.vol ? '≥' : '<'} ${BOILER.vol} м³`, fid);
    if (p.hClear < BOILER.height) add('err', `Котельная: высота ${p.hClear} мм < ${BOILER.height} мм`, fid);
    if (!r.sides.size) add('err', 'Котельная должна примыкать к наружной стене (окно, приток воздуха, дымоход)', fid);
    let glaz = 0, door = null;
    for (const o of p.levels[fid].open) {
      if (!opRegions(p, fid, o, regs).includes(r)) continue;
      if (o.kind === 'win') { const sz = opSize(p, o); glaz += o.w * sz.h / 1e6; }
      else if (o.kind !== 'pass') door = Math.max(door || 0, o.w);
      else add('err', 'Котельная: нужен дверной блок, а не проём без двери', fid);
    }
    const need = BOILER.glazing * vol;
    add(glaz >= need ? 'ok' : 'err', `Котельная: остекление ${fmtA(glaz)} м², нужно ≥ ${fmtA(need)} м² (0,03 м² на 1 м³)`, fid);
    if (door == null) add('err', 'Котельная: нет двери', fid);
    else if (door < BOILER.door) add('warn', `Котельная: дверь ${door} мм — нужна не уже ${BOILER.door} мм`, fid);
  }
  return out;
}
function sideName(s) { return { N: 'север', S: 'юг', W: 'запад', E: 'восток' }[s] || s; }
function fmtA(v) { return v.toFixed(1).replace('.', ','); }

/* пункты для технического задания: перемычки, усиления, проёмы в перекрытиях */
function tzItems(p) {
  const out = [], fl = floorsOf(p);
  fl.forEach((fid, k) => {
    const ws = walls(p, fid), fn = floorName(fid), regs = rooms(p, fid);
    for (const o of p.levels[fid].open) {
      const w = ws.find(v => v.id === o.wall); if (!w) continue;
      const what = o.kind === 'pass' ? 'проём без двери' : o.kind === 'win' ? (o.pano ? 'панорамное окно' : 'окно') : 'дверной проём';
      if (w.kind === 'bearing') {
        if (o.w > PASS.lintel) out.push(`${fn}: ${what} ${o.w} мм в несущей стене — усиленная перемычка (металлическая или ж/б по расчёту), опирание не менее 250 мм, на перемычку опираются плиты перекрытия`);
        else out.push(`${fn}: ${what} ${o.w} мм в несущей стене — перемычка под нагрузку от перекрытия`);
      } else if (w.kind === 'outer' && o.w >= 2400) out.push(`${fn}: ${what} ${o.w} мм в наружной стене — усиленная перемычка (U-блок с армированием или металл)`);
    }
    regs.filter(r => r.type === 'void').forEach(r => out.push(`${fn}: второй свет ${fmtM(r.x1 - r.x0)} × ${fmtM(r.y1 - r.y0)} м — проём в перекрытии, монолитный участок или металлическая обвязка по контуру, ограждение 1,0 м`));
    if (k > 0 && p.levels[fid].parts.some(w => !w.rail)) out.push(`${fn}: кирпичные перегородки по перекрытию — учесть линейную нагрузку на плиты`);
  });
  if (p.stair && fl.length > 1) { const r = stairRect(p); out.push(`Лестница ${STAIRS[p.stair.type || 'straight'].n.toLowerCase()}: проём в перекрытии ${fmtM(r.x1 - r.x0)} × ${fmtM(r.y1 - r.y0)} м — обрамление проёма, плиты не режутся вдоль`); }
  for (const x of p.ext || []) {
    const sz = `${fmtM(x.w)} × ${fmtM(x.d)} м`;
    if (x.kind === 'garage') {
      out.push(x.gtype === 'carport'
        ? `${garageName(x)} ${sz}: стойки ${extColumns(p, x).length} шт. на столбчатых фундаментах, односкатная кровля с уклоном от дома, площадка — бетон или плитка по щебёночному основанию`
        : `${garageName(x)} ${sz} (${GARAGE_TYPES[x.gtype || 'attached'].toLowerCase()}): ленточный фундамент${x.gtype === 'attached' ? ' с деформационным швом у дома, общая стена — противопожарная REI 45, дверь в дом EI 30' : `, ${fmtM(x.gap || GARAGE.gap)} м от дома`}; стены из того же материала, что дом; бетонный пол с уклоном к воротам, утеплённые секционные ворота ${x.cars || 1} × 2,5 м, вентиляция`);
      continue;
    }
    if (x.kind === 'balcony') out.push(x.d <= BALCONY_CANT
      ? `Балкон ${sz} (${floorName(x.fid)}): монолитная консольная плита с термовкладышем (терморазрыв), анкеровка в перекрытие, гидроизоляция с уклоном 1–2 % наружу, ограждение 1,0 м`
      : `Балкон ${sz} (${floorName(x.fid)}): вылет больше ${fmtM(BALCONY_CANT)} м — плита на колоннах с отдельными фундаментами, связь с перекрытием через терморазрыв, ограждение 1,0 м`);
    else {
      const roof = x.kind === 'terrace' ? (EXT_ROOF[x.roof || 'open'] || '').toLowerCase() : 'крыльцо';
      out.push(`${EXT[x.kind].n} ${sz} (${roof}): фундамент — сваи или ленточный отдельно от дома, деформационный шов у стены${(x.roof || 'open') !== 'open' ? `; колонны ${extColumns(p, x).length} шт., кровля навеса примыкает к стене с гидроизоляцией примыкания` : ''}${x.roof === 'glazed' ? '; остекление алюминиевым профилем, вентиляция' : ''}; ограждение при высоте настила больше 0,45 м`);
    }
  }
  fl.forEach(fid => rooms(p, fid).filter(r => r.type === 'loggia').forEach(r => out.push(`${floorName(fid)}: лоджия ${fmtA(r.area)} м² — плита перекрытия опирается на боковые стены, утепление стен, граничащих с лоджией, гидроизоляция пола с уклоном наружу, ограждение 1,0 м`)));
  if (p.blind) out.push(`Отмостка ${fmtM(p.blind)} м по периметру (${p.blindMat === 'concrete' ? 'бетон' : 'тротуарная плитка'}): утепление ЭППС 50 мм, щебёночная подготовка, уклон 2–3 % от дома, водоотвод от водосточных труб`);
  if (fl.some(f => rooms(p, f).some(r => r.type === 'boiler'))) out.push('Котельная: коаксиальный дымоход или дымоход через наружную стену, приточная вентиляция, дверь EI 30 — по ТУ газовой службы');
  return out;
}

function areas(p) {
  const per = floorsOf(p).map(fid => ({ fid, n: floorName(fid), area: rooms(p, fid).filter(r => r.type !== 'void' && r.type !== 'loggia').reduce((s, r) => s + r.area, 0) }));
  const ext = extT(p);
  const loggia = floorsOf(p).reduce((s, f) => s + rooms(p, f).filter(r => r.type === 'loggia').reduce((a, r) => a + r.area, 0), 0);
  const outdoor = (p.ext || []).filter(x => x.kind !== 'garage').reduce((s, x) => s + x.w * x.d / 1e6, 0);
  const garage = (p.ext || []).filter(x => x.kind === 'garage').reduce((s, x) => s + x.w * x.d / 1e6, 0);
  return {
    per, total: per.reduce((s, f) => s + f.area, 0), loggia, outdoor, garage,
    outW: p.W + 2 * ext, outD: p.D + 2 * ext, inW: p.W - 2 * ts(p), inD: p.D - 2 * ts(p),
    T: totalT(p), footprint: polyArea(offsetPoly(p, ext)) / 1e6,
  };
}

/* ---------- террасы, крыльца, балконы ---------- */
const EXT = {
  terrace: { n: 'Терраса', fl: 'ground', w: 4000, d: 2500 },
  porch: { n: 'Крыльцо', fl: 'ground', w: 2200, d: 1500 },
  balcony: { n: 'Балкон', fl: 'upper', w: 3000, d: 1200 },
  garage: { n: 'Гараж', fl: 'ground', w: 4000, d: 6500 },
};
/* гараж: ширина снаружи по числу машин (место 2,5 × 5,5 м на машину + проходы), ворота 2,5 м на машину */
const GARAGE = { w: { 1: 4000, 2: 6500, 3: 9500 }, d: 6500, gate: 2500, gap: 2000, h: 2800 };
const GARAGE_TYPES = { attached: 'Пристрой к дому', detached: 'Отдельно у дома', carport: 'Навес' };
function garageName(x) { const n = x.cars || 1; return `${x.gtype === 'carport' ? 'Навес' : 'Гараж'} на ${n} ${n === 1 ? 'машину' : 'машины'}`; }
function extName(x) { return x.kind === 'garage' ? garageName(x) : EXT[x.kind].n; }
const EXT_ROOF = { open: 'Открытая', covered: 'Крытая на колоннах', glazed: 'Застеклённая' };
const BALCONY_CANT = 1500; // предельный вылет консольной плиты с терморазрывом, мм
/* прямоугольник на плане (мм) снаружи облицовки */
function extRect(p, x) {
  const e = edges(p).find(q => q.id === x.wall); if (!e) return null;
  const gap = x.kind === 'garage' && x.gtype === 'detached' ? (x.gap || GARAGE.gap) : 0;
  const f0 = e.line + e.out * (extT(p) + gap), f1 = f0 + e.out * x.d, a0 = x.c - x.w / 2, a1 = x.c + x.w / 2;
  const t0 = Math.min(f0, f1), t1 = Math.max(f0, f1);
  return Object.assign(e.axis === 'x' ? { x0: a0, x1: a1, y0: t0, y1: t1 } : { x0: t0, x1: t1, y0: a0, y1: a1 }, { e, face: f0, far: f1 });
}
/* колонны: по углам у внешнего края и не реже чем через 3 м; у балкона — только если вылет больше консоли */
function extColumns(p, x) {
  const r = extRect(p, x); if (!r) return [];
  if (x.kind === 'garage') {
    // навес: стойки по обеим длинным сторонам не реже чем через 3 м
    if (x.gtype !== 'carport') return [];
    const n = Math.max(2, Math.ceil(x.d / 3000) + 1), out = [], inset = 150;
    for (const a of [x.c - x.w / 2 + inset, x.c + x.w / 2 - inset]) for (let i = 0; i < n; i++) {
      const t = r.face + r.e.out * (inset + (x.d - 2 * inset) * i / (n - 1));
      out.push(r.e.axis === 'x' ? { x: a, y: t } : { x: t, y: a });
    }
    return out;
  }
  if (x.kind === 'balcony' ? x.d <= BALCONY_CANT : (x.roof || 'open') === 'open') return [];
  const n = Math.max(2, Math.ceil(x.w / 3000) + 1), out = [], inset = 150;
  for (let i = 0; i < n; i++) {
    const a = x.c - x.w / 2 + inset + (x.w - 2 * inset) * i / (n - 1), t = r.far - r.e.out * inset;
    out.push(r.e.axis === 'x' ? { x: a, y: t } : { x: t, y: a });
  }
  return out;
}
/* выход на террасу или балкон: дверь или панорамное окно на этой стене в пределах ширины */
function extExit(p, x) {
  const fid = x.kind === 'balcony' ? x.fid : 'f1', lv = p.levels[fid]; if (!lv) return false;
  return lv.open.some(o => o.wall === x.wall && (o.kind !== 'win' || o.pano) && o.c > x.c - x.w / 2 && o.c < x.c + x.w / 2);
}

/* панорамное окно — выход на террасу, крыльцо или балкон: одна створка становится дверью */
function exitWin(p, fid, o) {
  if (o.kind !== 'win' || !o.pano) return false;
  return (p.ext || []).some(x => x.kind !== 'garage' && x.wall === o.wall && (x.kind === 'balcony' ? x.fid === fid : fid === 'f1') && o.c > x.c - x.w / 2 && o.c < x.c + x.w / 2);
}
/* створка-дверь: средняя (при чётном числе — правая из средних) */
function exitSash(o) { const n = o.sash || (o.w >= 1300 ? 2 : 1); return { n, i: Math.floor(n / 2) }; }

/* ---------- правка контура ---------- */
function shiftAll(p, dx, dy) {
  if (!dx && !dy) return;
  p.poly.forEach(v => { v.x += dx; v.y += dy; });
  p.bearing.forEach(b => { b.pos += b.axis === 'h' ? dy : dx; });
  if (p.wet) { p.wet.x += dx; p.wet.y += dy; }
  if (p.stair) { p.stair.x += dx; p.stair.y += dy; }
  const E = {}; edges(p).forEach(e => { E[e.id] = e.axis; });
  (p.ext || []).forEach(x => { x.c += E[x.wall] === 'y' ? dy : dx; });
  for (const lv of Object.values(p.levels)) {
    const PA = {}; lv.parts.forEach(w => { PA[w.id] = w.y1 === w.y2 ? 'x' : 'y'; w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; });
    lv.open.forEach(o => { const ax = E[o.wall] || PA[o.wall] || (/^B/.test(o.wall) ? (p.bearing[+o.wall.slice(1)] || {}).axis === 'h' ? 'x' : 'y' : 'x'); o.c += ax === 'x' ? dx : dy; });
    lv.furn.forEach(f => { f.x += dx; f.y += dy; });
    lv.names.forEach(n => { n.x += dx; n.y += dy; });
  }
}
/* убрать повторы и вершины на одной прямой; проёмы сросшихся рёбер переходят к соседнему */
function cleanPoly(p) {
  let P = p.poly, changed = true;
  const rebind = (from, to) => { for (const lv of Object.values(p.levels)) lv.open.forEach(o => { if (o.wall === from) o.wall = to; }); };
  while (changed && P.length > 4) {
    changed = false;
    for (let i = 0; i < P.length; i++) {
      const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
      if (a.x === b.x && a.y === b.y) { rebind(b.id, a.id); P.splice(i, 1); changed = true; break; }
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) { rebind(b.id, a.id); P.splice(i, 1); changed = true; break; }
    }
  }
  if (polyArea(P) < 0) P.reverse();
  p.poly = P;
}
function simplePoly(P) {
  const n = P.length, seg = [];
  for (let i = 0; i < n; i++) seg.push([P[i], P[(i + 1) % n]]);
  const box = (s) => ({ x0: Math.min(s[0].x, s[1].x), x1: Math.max(s[0].x, s[1].x), y0: Math.min(s[0].y, s[1].y), y1: Math.max(s[0].y, s[1].y) });
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const a = box(seg[i]), b = box(seg[j]);
    if (a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0) return false;
  }
  return true;
}
/* сдвиг наружной стены перпендикулярно; перегородки, упёртые в неё, тянутся следом */
function moveEdge(p, eid, d) {
  const E = edges(p), e = E.find(x => x.id === eid); if (!e || !d) return false;
  const P = p.poly.map(v => Object.assign({}, v)), i = e.i, j = (i + 1) % P.length;
  const prev = E[(i - 1 + E.length) % E.length], next = E[j];
  if (e.axis === 'x') { P[i].y += d; P[j].y += d; } else { P[i].x += d; P[j].x += d; }
  // соседние рёбра не должны вывернуться
  const len = (k) => { const a = P[k], b = P[(k + 1) % P.length]; return [Math.sign(b.x - a.x), Math.sign(b.y - a.y)]; };
  const ok = (k, ed) => { const s = len(k); return (s[0] === 0 && s[1] === 0) || (ed.axis === 'x' ? s[0] === ed.dir : s[1] === ed.dir); };
  if (!ok(prev.i, prev) || !ok(j, next)) return false;
  const nz = P.filter((v, k) => !(v.x === P[(k + 1) % P.length].x && v.y === P[(k + 1) % P.length].y));
  if (nz.length < 4 || !simplePoly(nz)) return false;
  const t = ts(p), f0 = e.line - e.out * t, f1 = f0 + d;
  for (const lv of Object.values(p.levels)) lv.parts.forEach(w => {
    const perp = e.axis === 'x' ? w.x1 === w.x2 : w.y1 === w.y2;
    if (!perp) return;
    const along = e.axis === 'x' ? w.x1 : w.y1;
    if (along < e.lo || along > e.hi) return;
    for (const k of ['1', '2']) { const key = (e.axis === 'x' ? 'y' : 'x') + k; if (Math.abs(w[key] - f0) <= 2) w[key] = f1; }
  });
  p.poly = P;
  return true;
}
/* выступ на ребре: ширина w по центру c, глубина d наружу */
function addBump(p, eid, c, w, d) {
  const E = edges(p), e = E.find(x => x.id === eid); if (!e) return false;
  const lo = Math.max(e.lo + 600, c - w / 2), hi = Math.min(e.hi - 600, c + w / 2);
  if (hi - lo < 1500) return false;
  const P = p.poly.slice(), i = e.i, L = e.line, Ld = e.line + e.out * d;
  const s0 = e.dir > 0 ? lo : hi, s1 = e.dir > 0 ? hi : lo;
  const mk = (a, l) => e.axis === 'x' ? { id: id('v'), x: a, y: l } : { id: id('v'), x: l, y: a };
  const ins = [mk(s0, L), mk(s0, Ld), mk(s1, Ld), mk(s1, L)];
  // проёмы, попавшие на выступ, переходят на его лицевое ребро
  for (const lv of Object.values(p.levels)) lv.open.forEach(o => { if (o.wall === eid && o.c > lo && o.c < hi) o.wall = ins[1].id; else if (o.wall === eid && (e.dir > 0 ? o.c >= hi : o.c <= lo)) o.wall = ins[3].id; });
  P.splice(i + 1, 0, ...ins);
  if (!simplePoly(P)) return false;
  p.poly = P;
  return true;
}

function normalize(p) {
  cleanPoly(p);
  const mx = Math.min(...p.poly.map(v => v.x)), my = Math.min(...p.poly.map(v => v.y));
  shiftAll(p, -mx, -my);
  p.W = Math.max(...p.poly.map(v => v.x)); p.D = Math.max(...p.poly.map(v => v.y));
  const t = ts(p);
  const vs = bearingVariants(p);
  const okNow = vs.find(v => JSON.stringify(v.walls) === JSON.stringify(p.bearing));
  const curOk = spanReport(p).every(x => x.ok) && p.bearing.every(b => lineSpan(p, b.axis, b.pos));
  if (!okNow && !curOk && vs.length) {
    const cur = p.bearing[0];
    let best = vs.find(v => v.walls.length) || vs[0];
    if (cur) {
      const same = vs.filter(v => v.walls.length === p.bearing.length && v.walls[0].axis === cur.axis);
      if (same.length) best = same.reduce((a, b) => Math.abs(a.walls[0].pos - cur.pos) <= Math.abs(b.walls[0].pos - cur.pos) ? a : b);
    }
    p.bearing = best.walls.map(w => Object.assign({}, w));
  }
  p.bearing = p.bearing.filter(b => lineSpan(p, b.axis, b.pos));
  for (const fid of Object.keys(p.levels)) {
    const lv = p.levels[fid];
    const c = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    lv.parts = lv.parts.map(w => Object.assign(w, { x1: c(w.x1, t, p.W - t), x2: c(w.x2, t, p.W - t), y1: c(w.y1, t, p.D - t), y2: c(w.y2, t, p.D - t) }))
      .filter(w => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1) >= 300 && inside(p.poly, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2));
    const ws = walls(p, fid);
    lv.open = lv.open.filter(o => {
      const w = ws.find(v => v.id === o.wall);
      if (!w) return false;
      o.c = Math.max(w.a0 + o.w / 2, Math.min(o.c, w.a1 - o.w / 2));
      return w.a1 - w.a0 >= o.w;
    });
    lv.furn.forEach(f => { f.x = c(f.x, -9000, p.W + 9000); f.y = c(f.y, -9000, p.D + 9000); });
  }
  if (p.wet) {
    p.wet.w = Math.min(p.wet.w, p.W - 2 * t); p.wet.h = Math.min(p.wet.h, p.D - 2 * t);
    p.wet.x = Math.max(t, Math.min(p.wet.x, p.W - t - p.wet.w)); p.wet.y = Math.max(t, Math.min(p.wet.y, p.D - t - p.wet.h));
  }
  const E2 = edges(p);
  p.ext = (p.ext || []).filter(x => {
    const e = E2.find(q => q.id === x.wall); if (!e) return false;
    if (x.kind === 'garage') { x.cars = Math.max(1, Math.min(3, x.cars || 1)); x.w = Math.max(3000, Math.min(x.w, 12000)); x.d = Math.max(4500, Math.min(x.d, 9000)); }
    else { x.w = Math.max(1000, Math.min(x.w, e.hi - e.lo)); x.d = Math.max(800, Math.min(x.d, x.kind === 'balcony' ? 3000 : 8000)); }
    // гараж может быть шире стены — достаточно, чтобы он примыкал к ней
    x.c = x.kind === 'garage' ? Math.max(e.lo, Math.min(x.c, e.hi)) : Math.max(e.lo + x.w / 2, Math.min(x.c, e.hi - x.w / 2));
    return true;
  });
  if (p.stair) {
    if (!p.stair.type) p.stair.type = 'straight';
    const r = stairRect(p);
    p.stair.x = Math.max(t, Math.min(p.stair.x, p.W - t - (r.x1 - r.x0)));
    p.stair.y = Math.max(t, Math.min(p.stair.y, p.D - t - (r.y1 - r.y0)));
  }
  return p;
}

/* старые проекты (прямоугольник W × D) → контур */
function migrate(p) {
  if (!p || p.v === 2) return p;
  if (p.v !== 1) return null;
  p.poly = [{ id: 'N', x: 0, y: 0 }, { id: 'E', x: p.W, y: 0 }, { id: 'S', x: p.W, y: p.D }, { id: 'W', x: 0, y: p.D }];
  if (p.stair && !p.stair.type) p.stair.type = 'straight';
  p.facade = null; p.v = 2;
  return p;
}

/* ---------- шаблоны формы ---------- */
const TEMPLATES = [
  { id: 'rect', n: 'Прямоугольный', d: '12 × 10 м, 2 этажа', floors: 2, roof: 'gable', pts: [[0, 0], [12000, 0], [12000, 10000], [0, 10000]] },
  { id: 'porch', n: 'С выступом', d: '12 × 10,5 м, вход в выступе', floors: 2, roof: 'hip', pts: [[0, 0], [12000, 0], [12000, 9000], [8000, 9000], [8000, 10500], [4000, 10500], [4000, 9000], [0, 9000]] },
  { id: 'L', n: 'Г-образный', d: '14 × 12 м, 2 этажа', floors: 2, roof: 'hip', pts: [[0, 0], [14000, 0], [14000, 7000], [6000, 7000], [6000, 12000], [0, 12000]] },
  { id: 'T', n: 'Т-образный', d: '15 × 12 м, 2 этажа', floors: 2, roof: 'gable', pts: [[0, 0], [15000, 0], [15000, 6500], [10500, 6500], [10500, 12000], [4500, 12000], [4500, 6500], [0, 6500]] },
  { id: 'U', n: 'П-образный', d: '16 × 12 м, двор с юга', floors: 1, roof: 'hip', pts: [[0, 0], [16000, 0], [16000, 12000], [11000, 12000], [11000, 6500], [5000, 6500], [5000, 12000], [0, 12000]] },
  { id: 'bung', n: 'Одноэтажный с эркером', d: '15 × 10,5 м, 1 этаж', floors: 1, roof: 'hip', pts: [[0, 0], [15000, 0], [15000, 9000], [5500, 9000], [5500, 10500], [0, 10500]] },
];

/* окна по фасадам: равномерно, в обход перегородок, несущих и других проёмов */
function autoWindows(p, fid, opt) {
  opt = opt || {};
  const t = ts(p), lv = p.levels[fid], ws = walls(p, fid), inner = ws.filter(w => w.kind !== 'outer');
  for (const w of ws.filter(v => v.kind === 'outer')) {
    const e = w.edge, len = e.hi - e.lo - 2 * t;
    if (len < 1800) continue;
    const width = len < 3200 ? 1200 : 1500, n = Math.max(1, Math.floor(len / 3600));
    const face = w.line - w.out * t;
    for (let k = 0; k < n; k++) {
      const c0 = Math.round((e.lo + (e.hi - e.lo) * (k + 0.5) / n) / 50) * 50;
      for (const sh of [0, 500, -500, 1000, -1000]) {
        const c = c0 + sh, s0 = c - width / 2, s1 = c + width / 2;
        if (s0 < e.lo + t + 400 || s1 > e.hi - t - 400) continue;
        if (lv.open.some(q => q.wall === w.id && Math.abs(q.c - c) < (q.w + width) / 2 + 400)) continue;
        const hit = inner.some(v => w.axis === 'x' ? (v.axis === 'y' && v.x1 > s0 - 200 && v.x0 < s1 + 200 && v.y0 <= face + 1 && v.y1 >= face - 1)
                                                   : (v.axis === 'x' && v.y1 > s0 - 200 && v.y0 < s1 + 200 && v.x0 <= face + 1 && v.x1 >= face - 1));
        if (hit) continue;
        lv.open.push(Object.assign({ id: id('o'), wall: w.id, c, w: width, kind: 'win', sash: 2 }, fid === 'b' ? { sill: 1500, h: 900 } : {}));
        break;
      }
    }
  }
}
/* шаблон: контур, несущая стена, котельная и санузел в контуре у наружной стены, окна, вход, лестница */
function fromTemplate(tid) {
  if (tid === 'rect') return starter();
  const T = TEMPLATES.find(x => x.id === tid);
  const p = {
    v: 2, name: 'Мой дом', poly: T.pts.map(([x, y]) => ({ id: id('v'), x, y })), wallMat: 'gas', clad: 'plaster', insul: 100,
    hClear: 2800, slab: 220, floors: T.floors, basement: false, bearing: [], wet: null, stair: null,
    roof: { type: T.roof, pitch: T.roof === 'hip' ? 25 : 30, ridge: 'long' }, style: 'white', facade: null,
    levels: { b: emptyLevel(), f1: emptyLevel(), f2: emptyLevel(), f3: emptyLevel() },
  };
  p.W = Math.max(...T.pts.map(q => q[0])); p.D = Math.max(...T.pts.map(q => q[1]));
  const vs = bearingVariants(p);
  const pick = vs[0] && !vs[0].walls.length ? vs[0] : (vs.find(v => v.walls.length && v.walls[0].axis === 'h') || vs[0] || { walls: [] });
  p.bearing = pick.walls.map(w => Object.assign({}, w));
  const t = ts(p), bh = p.bearing.find(b => b.axis === 'h');
  const d = Math.max(1900, Math.min(2600, bh ? bh.pos - 190 - t - 120 : 2600));
  const xb = t + 2400, xw = xb + 120 + 2000, yb = t + d;
  const P = (x1, y1, x2, y2) => ({ id: id('w'), x1, y1, x2, y2 });
  const topEdge = p.poly[0].id;
  floorsOf(p).forEach((fid, k) => {
    const lv = p.levels[fid];
    const pv = P(xb + 60, t, xb + 60, yb), ph = P(t, yb + 60, xw + 120, yb + 60), pw = P(xw + 60, t, xw + 60, yb);
    lv.parts.push(pv, ph, pw);
    lv.open.push({ id: id('o'), wall: ph.id, c: t + 1200, w: k ? 700 : 800, kind: 'door' }, { id: id('o'), wall: ph.id, c: xb + 120 + 1000, w: 700, kind: 'door' });
    if (!k) lv.open.push({ id: id('o'), wall: topEdge, c: t + 1200, w: 900, kind: 'win', sill: 1200, h: 900 });
    lv.open.push({ id: id('o'), wall: topEdge, c: xb + 120 + 1000, w: 600, kind: 'win', sill: 1300, h: 800 });
    lv.names.push({ x: t + 1200, y: t + d / 2, type: k ? 'dress' : 'boiler' }, { x: xb + 1120, y: t + d / 2, type: 'bath' });
    const F = (type, x, y, rot) => lv.furn.push({ id: id('f'), type, x, y, rot: rot || 0 });
    if (!k) F('boiler', t + 1200, t + 200);
    F('toilet', xb + 420, t + 360); F('sink', xb + 1250, t + 280); F('shower', xb + 120 + 2000 - 480, yb - 480);
  });
  p.wet = { x: t, y: t, w: xw + 120 - t, h: d + 120 };
  if (p.floors > 1) p.stair = { type: 'straight', x: xw + 420, y: t + 200, w: 1000, l: 3600, rot: 3 };
  // вход — на самом южном и длинном ребре
  const E = edges(p).filter(e => e.side === 'S');
  const maxY = Math.max(...E.map(e => e.line));
  const ent = E.reduce((a, b) => (b.hi - b.lo + (b.line === maxY ? 3000 : 0)) > (a.hi - a.lo + (a.line === maxY ? 3000 : 0)) ? b : a);
  p.levels.f1.open.push({ id: id('o'), wall: ent.id, c: Math.round((ent.lo + ent.hi) / 100) * 50, w: 1000, kind: 'entry' });
  floorsOf(p).forEach(fid => autoWindows(p, fid));
  return normalize(p);
}

/* прямоугольный дом 12 × 10 м с готовой планировкой двух этажей */
function starter() {
  const P = (x1, y1, x2, y2) => ({ id: id('w'), x1, y1, x2, y2 });
  const O = (wall, c, w, kind, extra) => Object.assign({ id: id('o'), wall, c, w, kind }, extra || {});
  const F = (type, x, y, rot) => ({ id: id('f'), type, x, y, rot: rot || 0 });
  const f1 = emptyLevel(), f2 = emptyLevel();
  f1.parts = [P(2800, 400, 2800, 4810), P(400, 3000, 2740, 3000), P(5000, 400, 5000, 4810), P(2860, 2600, 4940, 2600),
              P(4000, 5190, 4000, 9600), P(7000, 5190, 7000, 9600)];
  f1.open = [O('W', 1700, 900, 'win', { sill: 1200, h: 900 }), O('N', 3900, 900, 'win', { sill: 1300, h: 800 }),
             O('N', 7000, 1500, 'win'), O('N', 9900, 2400, 'win', { pano: true, sash: 3 }), O('E', 2600, 1500, 'win'),
             O('S', 2200, 1500, 'win'), O('S', 9300, 1800, 'win', { sash: 3 }), O('E', 7400, 1500, 'win'), O('S', 5500, 1000, 'entry'),
             O('B0', 4500, 800, 'door'), O('P2', 3900, 700, 'door'), O('P1', 1600, 800, 'door'), O('P0', 3900, 700, 'door'),
             O('P3', 3900, 1200, 'pass'), O('P4', 6000, 800, 'door'), O('P5', 9100, 800, 'door')];
  const map = { P0: 0, P1: 1, P2: 3, P3: 2, P4: 4, P5: 5 };
  f1.open.forEach(o => { if (o.wall in map) o.wall = f1.parts[map[o.wall]].id; });
  f1.names = [{ x: 1500, y: 1500, type: 'boiler' }, { x: 1500, y: 4000, type: 'laundry' }, { x: 3900, y: 1500, type: 'bath' },
              { x: 3900, y: 3700, type: 'corr' }, { x: 8300, y: 2600, type: 'kl' }, { x: 5500, y: 7000, type: 'hall' },
              { x: 2200, y: 7400, type: 'bed' }, { x: 9300, y: 7400, type: 'bed' }];
  f1.furn = [F('boiler', 1500, 650), F('washer', 800, 4400), F('toilet', 3300, 800), F('sink', 4500, 700), F('shower', 4450, 2050),
             F('kitchen', 6600, 700), F('fridge', 8150, 730), F('table', 8300, 3200), F('sofa', 10900, 2700, 1),
             F('bed160', 2200, 8400, 2), F('wardrobe', 3500, 6500, 1), F('bed160', 9300, 8400, 2), F('wardrobe', 7600, 6400, 1)];
  f2.parts = [P(400, 3000, 2800, 3000), P(2800, 400, 2800, 4810), P(4000, 5190, 4000, 9600), P(7000, 5190, 7000, 9600), P(7000, 400, 7000, 4810)];
  f2.names = [{ x: 1500, y: 1500, type: 'bath' }, { x: 2200, y: 7400, type: 'bed' }, { x: 9300, y: 7400, type: 'kids' }, { x: 5500, y: 7000, type: 'hall' },
              { x: 4800, y: 2000, type: 'bed' }, { x: 9300, y: 2400, type: 'office' }, { x: 1500, y: 4000, type: 'dress' }];
  f2.open = [O('W', 1700, 600, 'win', { sill: 1300, h: 800 }), O('N', 4900, 1500, 'win'), O('N', 9300, 1500, 'win'), O('E', 2600, 1500, 'win'),
             O('S', 2200, 1500, 'win'), O('S', 9300, 1500, 'win'), O('E', 7400, 1500, 'win'), O('S', 5500, 900, 'win'),
             O('B0', 4500, 800, 'door'), O('B0', 1600, 700, 'door'), O('B0', 8200, 800, 'door'),
             O(f2.parts[0].id, 1600, 700, 'door'), O(f2.parts[2].id, 6000, 800, 'door'), O(f2.parts[3].id, 9100, 800, 'door')];
  f2.furn = [F('toilet', 900, 800), F('sink', 2200, 700), F('bath', 1550, 2450), F('bed160', 4800, 1500, 0), F('desk', 9300, 900),
             F('bed160', 2200, 8400, 2), F('bed90', 9800, 8500, 2), F('wardrobe', 1500, 4500, 2)];
  return normalize({
    v: 2, name: 'Мой дом', poly: [{ id: 'N', x: 0, y: 0 }, { id: 'E', x: 12000, y: 0 }, { id: 'S', x: 12000, y: 10000 }, { id: 'W', x: 0, y: 10000 }],
    W: 12000, D: 10000, wallMat: 'gas', clad: 'plaster', insul: 100,
    hClear: 2800, slab: 220, floors: 2, basement: false, blind: 1000,
    bearing: [{ axis: 'h', pos: 5000 }],
    wet: { x: 400, y: 400, w: 4600, h: 4410 },
    stair: { type: 'L', x: 5000, y: 5400, w: 1900, l: 3600, rot: 2 },
    roof: { type: 'gable', pitch: 30, ridge: 'long' },
    style: 'white', facade: null,
    levels: { b: emptyLevel(), f1, f2, f3: emptyLevel() },
  });
}

Object.assign(DK, { GARAGE, GARAGE_TYPES, garageName, extName, exitWin, exitSash, EXT, EXT_ROOF, BALCONY_CANT, extRect, extColumns, extExit, opLimits, SPEC, FLOORS, ROOM, BOILER, PASS, STAIRS, TEMPLATES, id, ts, extT, totalT, storey, floorsOf, floorName, elev, emptyLevel, opSize,
  edges, offsetPoly, polyArea, inside, decompose, mainRect, lineSpan, walls, cladRect, rooms, opRegions, opSides, doorSwing,
  stairParts, stairToWorld, stairToLocal, stairDir, stairRect, stairHeight, stairExit, stairExitOk,
  bearingVariants, spansOf, spanReport, wetVariants, checks, tzItems, areas, moveEdge, addBump, cleanPoly, normalize, migrate,
  fromTemplate, autoWindows, starter, fmtM, fmtA, sideName });
})();
