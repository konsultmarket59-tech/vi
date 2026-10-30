/* Участок: габариты, сторона улицы, север, дом в отступах и постройки по нормам.
   Координаты участка — мм, начало в левом верхнем углу, Y вниз (как на плане дома). Дом стоит точкой своего начала (hx, hy).
   Отступы — по СП 53.13330.2019 и СП 30-102-99: дом — 3 м до соседей и 5 м до улицы, хозпостройки — 1 м до забора,
   баня — 8 м от дома (противопожарный разрыв для деревянной постройки), мангал — 5 м от построек. */
(function () {
'use strict';
const DK = window.DK = window.DK || {};

const HOUSE_SIDE = 3000, HOUSE_STREET = 5000;
DK.SITE_OBJ = {
  bath:   { n: 'Баня', w: 4000, d: 5000, b: 1000, street: 5000, house: 8000, sep: 3000, rule: '1 м до забора, 5 м до улицы, 8 м до дома' },
  gazebo: { n: 'Беседка', w: 3000, d: 3000, b: 1000, street: 5000, house: 3000, sep: 2000, rule: '1 м до забора, 3 м до дома' },
  bbq:    { n: 'Мангальная зона', w: 3000, d: 3000, b: 1000, street: 5000, house: 5000, sep: 2000, fire: 5000, rule: '1 м до забора, 5 м до дома и бани' },
  play:   { n: 'Игровая зона', w: 5000, d: 4000, b: 2000, street: 6000, house: 2000, sep: 3000, rule: '2 м до забора, 6 м до улицы, видна из дома, 5 м от мангала' },
  flower: { n: 'Клумба', w: 2400, d: 1000, b: 500, street: 1000, house: 800, sep: 600, rule: 'у входа и дорожки' },
  greenhouse: { n: 'Теплица', w: 3000, d: 6000, b: 1000, street: 5000, house: 4000, sep: 2000, rule: '1 м до забора, торцами на север-юг, не в тени дома' },
  beds:   { n: 'Грядки', w: 6000, d: 4000, b: 1000, street: 5000, house: 2000, sep: 1500, rule: '1 м до забора, на солнечной стороне' },
  poolRect:  { n: 'Бассейн бетонный 8 × 4', g: 'pool', w: 8000, d: 4000, b: 2000, street: 5000, house: 3000, sep: 2500, rule: '2 м до забора, 3 м от фундамента дома' },
  poolRound: { n: 'Бассейн каркасный Ø 4,6', g: 'pool', w: 4600, d: 4600, b: 2000, street: 5000, house: 3000, sep: 2000, rule: '2 м до забора, 3 м от дома' },
  poolCover: { n: 'Бассейн с павильоном', g: 'pool', w: 9000, d: 5000, b: 2000, street: 5000, house: 3000, sep: 2500, rule: '2 м до забора, 3 м от дома' },
  spa:       { n: 'Купель / хот-тоб', g: 'pool', w: 2200, d: 2200, b: 1000, street: 5000, house: 2000, sep: 1500, rule: '1 м до забора, рядом с баней или террасой' },
  tennis: { n: 'Теннисный корт', w: 18300, d: 36600, b: 1000, street: 5000, house: 5000, sep: 3000, rule: '1 м до забора, 5 м от дома, длинной осью север–юг' },
  volley: { n: 'Волейбольная площадка', w: 14000, d: 22000, b: 1000, street: 5000, house: 5000, sep: 3000, rule: '1 м до забора, 5 м от дома' },
  treeFruit:   { n: 'Плодовое дерево', g: 'tree', w: 4000, d: 4000, b: 2000, street: 3000, house: 3000, sep: 3000, rule: 'среднерослое — 2 м до забора, 3 м от дома' },
  treeDecor:   { n: 'Декоративное дерево', g: 'tree', w: 6000, d: 6000, b: 4000, street: 2000, house: 5000, sep: 3000, rule: 'высокорослое — 4 м до забора, 5 м от дома' },
  treeConifer: { n: 'Ель / туя', g: 'tree', w: 3000, d: 3000, b: 2000, street: 1500, house: 4000, sep: 2000, rule: 'хвойное — 2 м до забора, 4 м от дома' },
};
DK.SITE_SIDES = { S: 'снизу (юг плана)', N: 'сверху', W: 'слева', E: 'справа' };

/* габарит дома на участке (в координатах дома): облицовка, террасы, гаражи */
DK.siteHouseBox = function (p) {
  const pts = DK.offsetPoly(p, DK.extT(p));
  const b = { x0: Math.min(...pts.map(q => q.x)), y0: Math.min(...pts.map(q => q.y)), x1: Math.max(...pts.map(q => q.x)), y1: Math.max(...pts.map(q => q.y)) };
  const add = (r) => { b.x0 = Math.min(b.x0, r.x0); b.y0 = Math.min(b.y0, r.y0); b.x1 = Math.max(b.x1, r.x1); b.y1 = Math.max(b.y1, r.y1); };
  (p.ext || []).forEach(x => { const r = DK.extRect(p, x); if (r) add(r); });
  // входное крыльцо со ступенями — 2,4 м от стены
  const ent = p.levels.f1 && p.levels.f1.open.find(o => o.kind === 'entry'), e = ent && DK.edges(p).find(q => q.id === ent.wall);
  if (e) { const f0 = e.line + e.out * DK.extT(p), f1 = f0 + e.out * 2400, a0 = ent.c - ent.w / 2 - 700, a1 = ent.c + ent.w / 2 + 700;
    add(e.axis === 'x' ? { x0: a0, x1: a1, y0: Math.min(f0, f1), y1: Math.max(f0, f1) } : { y0: a0, y1: a1, x0: Math.min(f0, f1), x1: Math.max(f0, f1) }); }
  return b;
};
/* контур участка: произвольный многоугольник s.poly (мм, по часовой на экране) или прямоугольник W × D */
DK.sitePoly = function (s) { return s.poly && s.poly.length >= 3 ? s.poly : [{ x: 0, y: 0 }, { x: s.W, y: 0 }, { x: s.W, y: s.D }, { x: 0, y: s.D }]; };
DK.siteArea = function (s) { const P = DK.sitePoly(s); let a = 0; P.forEach((q, i) => { const r = P[(i + 1) % P.length]; a += q.x * r.y - r.x * q.y; }); return Math.abs(a) / 2; };
const STDIR = { S: [0, 1], N: [0, -1], W: [-1, 0], E: [1, 0] };
/* стороны участка: отрезок, внешняя нормаль, уличная ли сторона */
function siteEdges(s) {
  const P = DK.sitePoly(s), n = P.length, st = STDIR[s.street || 'S'];
  let a = 0; P.forEach((q, i) => { const r = P[(i + 1) % n]; a += q.x * r.y - r.x * q.y; });
  const sg = a > 0 ? 1 : -1; // ориентация обхода
  const E = P.map((q, i) => { const r = P[(i + 1) % n], dx = r.x - q.x, dy = r.y - q.y, l = Math.hypot(dx, dy) || 1; const nx = sg * dy / l, ny = -sg * dx / l; return { a: q, b: r, len: l, nx, ny, dot: nx * st[0] + ny * st[1], i }; });
  const best = Math.max(...E.map(e => e.dot));
  E.forEach(e => { e.street = e.dot >= Math.min(0.5, best - 1e-6); });
  return E;
}
DK.siteEdges = siteEdges;
function insideP(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
const segPt = (x, y, a, b) => DK.segDist(x, y, a.x, a.y, b.x, b.y);
function segHitsRect(a, b, r) {
  // отрезок пересекает прямоугольник: отсечение Лианга — Барски
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - r.x0], [dx, r.x1 - a.x], [-dy, a.y - r.y0], [dy, r.y1 - a.y]]) {
    if (pp === 0) { if (q < 0) return false; continue; }
    const t = q / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
function rectSegDist(r, a, b) {
  if (segHitsRect(a, b, r)) return 0;
  const cs = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  const pr = (q) => Math.hypot(Math.max(0, r.x0 - q.x, q.x - r.x1), Math.max(0, r.y0 - q.y, q.y - r.y1));
  return Math.min(pr(a), pr(b), ...cs.map(([x, y]) => segPt(x, y, a, b)));
}
/* луч из точки до границы участка */
function rayHit(s, x, y, dx, dy) {
  let best = Infinity;
  for (const e of siteEdges(s)) {
    const ex = e.b.x - e.a.x, ey = e.b.y - e.a.y, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
    const t = ((e.a.x - x) * ey - (e.a.y - y) * ex) / den, u = ((e.a.x - x) * dy - (e.a.y - y) * dx) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}
DK.siteRay = rayHit;
/* перенос контура так, чтобы габарит начинался с 0,0; дом и постройки едут вместе */
DK.siteNormalize = function (p) {
  const s = p.site; if (!s.poly) return;
  const x0 = Math.min(...s.poly.map(q => q.x)), y0 = Math.min(...s.poly.map(q => q.y));
  s.poly = s.poly.map(q => ({ x: Math.round(q.x - x0), y: Math.round(q.y - y0) }));
  s.W = Math.max(...s.poly.map(q => q.x)); s.D = Math.max(...s.poly.map(q => q.y));
  s.hx -= x0; s.hy -= y0; s.objs.forEach(o => { o.x -= x0; o.y -= y0; });
  // контур-прямоугольник по габариту — снова «простой»
  if (s.poly.length === 4 && s.poly.every(q => (q.x === 0 || q.x === s.W) && (q.y === 0 || q.y === s.D))) delete s.poly;
};
function houseRect(p) { const s = p.site, b = DK.siteHouseBox(p); return { x0: b.x0 + s.hx, y0: b.y0 + s.hy, x1: b.x1 + s.hx, y1: b.y1 + s.hy }; }
function objRect(o) { const T = DK.SITE_OBJ[o.type], rot = (o.a || 0) % 180 === 90, w = o.w || T.w, d = o.d || T.d, sw = rot ? d : w, sd = rot ? w : d; return { x0: o.x - sw / 2, y0: o.y - sd / 2, x1: o.x + sw / 2, y1: o.y + sd / 2 }; }
function rectDist(a, b) { const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1); return Math.hypot(dx, dy); }
/* расстояния до сторон участка: до улицы и до ближайшей соседской границы */
function bounds(s, r) {
  const st = s.street || 'S';
  if (!s.poly) { const d = { N: r.y0, S: s.D - r.y1, W: r.x0, E: s.W - r.x1 }; return { street: d[st], side: Math.min(...Object.keys(d).filter(k => k !== st).map(k => d[k])), all: d }; }
  // участок сложной формы: прямоугольник должен быть внутри, расстояние — до ближайшей стороны каждого типа
  const P = s.poly, cs = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]], E = siteEdges(s);
  if (!cs.every(([x, y]) => insideP(P, x, y))) return { street: -1, side: -1, all: {} };
  let street = Infinity, side = Infinity;
  for (const e of E) { const d = rectSegDist(r, e.a, e.b); if (d === 0) return { street: -1, side: -1, all: {} }; if (e.street) street = Math.min(street, d); else side = Math.min(side, d); }
  return { street, side, all: {} };
}
DK.siteHouseRect = houseRect; DK.siteObjRect = objRect;

/* точка входа: середина входной двери снаружи, в координатах участка */
DK.siteEntry = function (p) {
  const s = p.site, ent = p.levels.f1 && p.levels.f1.open.find(o => o.kind === 'entry'); if (!ent) return null;
  const e = DK.edges(p).find(q => q.id === ent.wall); if (!e) return null;
  const t = e.line + e.out * (DK.extT(p) + 2400);
  return e.axis === 'x' ? { x: ent.c + s.hx, y: t + s.hy, out: [0, e.out] } : { x: t + s.hx, y: ent.c + s.hy, out: [e.out, 0] };
};
/* дорожка от калитки до входа: от двери наружу, затем к улице */
DK.sitePath = function (p) {
  const s = p.site, E = DK.siteEntry(p); if (!E) return null;
  const H = houseRect(p), st = s.street || 'S';
  const away = { x: E.x + E.out[0] * 1500, y: E.y + E.out[1] * 1500 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  // если дверь смотрит не на улицу — выходим за габарит дома и поворачиваем
  let mid = away;
  if (st === 'S' || st === 'N') { if (away.x > H.x0 - 300 && away.x < H.x1 + 300 && (st === 'S' ? away.y < H.y1 : away.y > H.y0)) mid = { x: E.out[0] > 0 ? H.x1 + 1200 : H.x0 - 1200, y: away.y }; }
  else if (away.y > H.y0 - 300 && away.y < H.y1 + 300 && (st === 'E' ? away.x < H.x1 : away.x > H.x0)) mid = { x: away.x, y: E.out[1] > 0 ? H.y1 + 1200 : H.y0 - 1200 };
  if (s.poly) {
    // сложный участок: калитка — там, куда луч от дорожки выходит на уличную сторону
    const d = STDIR[st], hit = rayHit(s, mid.x, mid.y, d[0], d[1]);
    if (hit < Infinity) { const gate = { x: Math.round(mid.x + d[0] * hit), y: Math.round(mid.y + d[1] * hit) }; return [{ x: E.x, y: E.y }, mid, gate]; }
  }
  const gate = st === 'S' ? { x: clamp(mid.x, 1500, s.W - 1500), y: s.D } : st === 'N' ? { x: clamp(mid.x, 1500, s.W - 1500), y: 0 } : st === 'W' ? { x: 0, y: clamp(mid.y, 1500, s.D - 1500) } : { x: s.W, y: clamp(mid.y, 1500, s.D - 1500) };
  const bend = st === 'S' || st === 'N' ? { x: gate.x, y: mid.y } : { x: mid.x, y: gate.y };
  return [{ x: E.x, y: E.y }, mid, bend, gate];
};
/* заезд к воротам гаража, если ворота смотрят на улицу */
DK.siteDrives = function (p) {
  const s = p.site, st = s.street || 'S', dirs = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[st], out = [];
  for (const x of p.ext || []) {
    if (x.kind !== 'garage') continue;
    const r = DK.extRect(p, x); if (!r) continue;
    const e = r.e, g = DK.garageGate(x), nv = e.axis === 'x' ? [0, e.out] : [e.out, 0], uv = e.axis === 'x' ? [1, 0] : [0, 1];
    const d = g === 'far' ? nv : g === 'near' ? [-nv[0], -nv[1]] : g === 'left' ? [-uv[0], -uv[1]] : uv;
    if (d[0] !== dirs[0] || d[1] !== dirs[1]) continue;
    const R = { x0: r.x0 + s.hx, y0: r.y0 + s.hy, x1: r.x1 + s.hx, y1: r.y1 + s.hy };
    // длина заезда — до границы участка по лучу от ворот (для сложного контура — по середине ворот)
    const reach = (x, y) => { const h = rayHit(s, x, y, dirs[0], dirs[1]); return h < Infinity ? h : 0; };
    if (st === 'S' || st === 'N') { R.x0 += 300; R.x1 -= 300; const mx = (R.x0 + R.x1) / 2; if (st === 'S') { const h = reach(mx, R.y1); R.y0 = R.y1; R.y1 = R.y0 + h; } else { const h = reach(mx, R.y0); R.y1 = R.y0; R.y0 = R.y1 - h; } }
    else { R.y0 += 300; R.y1 -= 300; const my = (R.y0 + R.y1) / 2; if (st === 'E') { const h = reach(R.x1, my); R.x0 = R.x1; R.x1 = R.x0 + h; } else { const h = reach(R.x0, my); R.x1 = R.x0; R.x0 = R.x1 - h; } }
    if (R.x1 > R.x0 && R.y1 > R.y0) out.push(R);
  }
  return out;
};

/* участок по умолчанию: на 6 соток больше дома, улица снизу */
DK.siteDefault = function (p) {
  const b = DK.siteHouseBox(p), hw = b.x1 - b.x0, hd = b.y1 - b.y0;
  const s = { W: Math.max(20000, Math.ceil((hw + 2 * HOUSE_SIDE + 6000) / 1000) * 1000), D: Math.max(30000, Math.ceil((hd + HOUSE_STREET + 15000) / 1000) * 1000), street: 'S', north: 0, hx: 0, hy: 0, objs: [] };
  p.site = s; DK.sitePlaceHouse(p);
  return s;
};
/* дом к улице с отступом 5 м, по центру ширины (не ближе 3 м к соседям) */
DK.sitePlaceHouse = function (p) {
  const s = p.site, b = DK.siteHouseBox(p), hw = b.x1 - b.x0, hd = b.y1 - b.y0, st = s.street || 'S';
  const front = HOUSE_STREET + 1000;
  if (s.poly) {
    // перебор положений: в отступах, ближе к улице (6 м), подальше от соседей
    let best = null;
    for (let y = 0; y <= s.D - hd; y += 250) for (let x = 0; x <= s.W - hw; x += 250) {
      const B = bounds(s, { x0: x, y0: y, x1: x + hw, y1: y + hd });
      if (B.street < HOUSE_STREET || B.side < HOUSE_SIDE) continue;
      const sc = Math.abs(B.street - front) - Math.min(B.side, 8000) * 0.4;
      if (!best || sc < best.sc) best = { sc, x, y };
    }
    if (best) { s.hx = Math.round(best.x - b.x0); s.hy = Math.round(best.y - b.y0); return true; }
    return false;
  }
  if (st === 'S' || st === 'N') {
    s.hx = Math.round(Math.max(HOUSE_SIDE, (s.W - hw) / 2) - b.x0);
    s.hy = Math.round((st === 'S' ? s.D - front - hd : front) - b.y0);
  } else {
    s.hy = Math.round(Math.max(HOUSE_SIDE, (s.D - hd) / 2) - b.y0);
    s.hx = Math.round((st === 'E' ? s.W - front - hw : front) - b.x0);
  }
};
/* дорожка и заезды как прямоугольники — на них ничего не ставим */
function pathRects(p) {
  const pts = DK.sitePath(p) || [], out = DK.siteDrives(p).slice(), h = 600;
  for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; out.push({ x0: Math.min(a.x, b.x) - h, y0: Math.min(a.y, b.y) - h, x1: Math.max(a.x, b.x) + h, y1: Math.max(a.y, b.y) + h }); }
  return out;
}
/* можно ли поставить постройку в прямоугольник r */
function fits(p, type, r, skip, paths) {
  const s = p.site, T = DK.SITE_OBJ[type], B = bounds(s, r);
  if (B.street < T.street || B.side < T.b) return false;
  if (rectDist(r, houseRect(p)) < T.house) return false;
  if ((paths || pathRects(p)).some(q => rectDist(r, q) < 300)) return false;
  for (const o of s.objs) {
    if (o === skip) continue;
    const U = DK.SITE_OBJ[o.type], need = Math.max(T.sep, U.sep, ((T.fire && o.type !== 'gazebo' && o.type !== 'flower') || (U.fire && type !== 'gazebo' && type !== 'flower')) ? 5000 : 0);
    if (rectDist(r, objRect(o)) < need) return false;
  }
  return true;
}
/* предпочтения: баня — в дальнем углу, беседка — за домом, мангал — рядом с беседкой, площадка — на виду, клумбы — у входа */
function score(p, type, r) {
  const s = p.site, B = bounds(s, r), H = houseRect(p), dh = rectDist(r, H), cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const near = (t) => { const o = s.objs.find(q => q.type === t); return o ? Math.hypot(o.x - cx, o.y - cy) : null; };
  // корт и теплица — длинной осью север–юг
  const th = (s.north || 0) * Math.PI / 180, alongY = (r.y1 - r.y0) >= (r.x1 - r.x0), ns = alongY ? Math.abs(Math.cos(th)) : Math.abs(Math.sin(th)), nsPen = (1 - ns) * 20000;
  if (type === 'bath') return -B.street + B.side * 0.6;
  if (type === 'gazebo') return dh - B.street * 0.15;
  if (type === 'bbq') { const g = near('gazebo'); return (g != null ? Math.abs(g - 4500) * 1.5 : 0) + dh * 0.3 - B.street * 0.1; }
  if (type === 'play') return dh * 1.2 - B.street * 0.1 + B.side * 0.05;
  if (type === 'greenhouse') return -B.street * 0.6 + B.side * 0.4 + nsPen * 0.3;
  if (type === 'beds') { const g = near('greenhouse'); return -B.street * 0.4 + (g != null ? g * 0.3 : B.side * 0.3); }
  if (type === 'poolRect' || type === 'poolCover' || type === 'poolRound') return dh * 1.0 - B.street * 0.15;
  if (type === 'spa') { const b2 = near('bath'); return b2 != null ? b2 : dh; }
  if (type === 'tennis' || type === 'volley') return -B.street + B.side * 0.3 + (type === 'tennis' ? nsPen : 0);
  if (type === 'treeFruit') { const others = s.objs.filter(o => o.type === 'treeFruit'); return -B.street * 0.4 + B.side * 0.2 + others.reduce((m, o) => Math.min(m, Math.abs(Math.hypot(o.x - cx, o.y - cy) - 4500)), 0) * 0.5; }
  if (type === 'treeDecor' || type === 'treeConifer') return B.side * 1.2 + B.street * 0.1;
  if (type === 'flower') { const E = DK.siteEntry(p); const ds = E ? Math.hypot(E.x - cx, E.y - cy) : dh; return Math.abs(ds - 2200); }
  return dh;
}
/* найти место для постройки: перебор сетки 250 мм, оба поворота */
DK.siteAuto = function (p, o) {
  const s = p.site, T = DK.SITE_OBJ[o.type];
  let best = null; const paths = pathRects(p);
  for (const a of [0, 90]) {
    const q = Object.assign({}, o, { a }), r0 = objRect(Object.assign({}, q, { x: 0, y: 0 }));
    for (let y = -r0.y0; y <= s.D + r0.y0; y += 250) for (let x = -r0.x0; x <= s.W + r0.x0; x += 250) {
      const r = { x0: x + r0.x0, y0: y + r0.y0, x1: x + r0.x1, y1: y + r0.y1 };
      if (!fits(p, o.type, r, o, paths)) continue;
      const sc = score(p, o.type, r) + (a ? 50 : 0);
      if (!best || sc < best.sc) best = { sc, x, y, a };
    }
  }
  if (!best) return false;
  o.x = best.x; o.y = best.y; o.a = best.a;
  return true;
};
DK.siteAdd = function (p, type) {
  if (!p.site) DK.siteDefault(p);
  const o = { id: DK.id('s'), type, x: p.site.W / 2, y: p.site.D / 2, a: 0 };
  const ok = DK.siteAuto(p, o);
  p.site.objs.push(o);
  return { o, ok };
};
DK.siteRearrange = function (p) {
  const s = p.site, objs = s.objs.slice();
  DK.sitePlaceHouse(p);
  const order = ['tennis', 'volley', 'poolCover', 'poolRect', 'poolRound', 'bath', 'spa', 'greenhouse', 'beds', 'gazebo', 'bbq', 'play', 'treeDecor', 'treeConifer', 'treeFruit', 'flower'];
  s.objs = [];
  objs.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).forEach(o => { DK.siteAuto(p, o); s.objs.push(o); });
};
/* проверки отступов */
DK.siteChecks = function (p) {
  const s = p.site; if (!s) return [];
  const out = [], f = (v) => DK.fmtM(Math.max(0, v));
  const H = houseRect(p), BH = bounds(s, H);
  if (BH.street < 0) out.push({ lv: 'err', txt: 'Дом выходит за границу участка' });
  else if (BH.street < HOUSE_STREET) out.push({ lv: 'err', txt: `Дом ближе ${f(HOUSE_STREET)} м к улице (${f(BH.street)} м)` });
  if (BH.side >= 0 && BH.side < HOUSE_SIDE) out.push({ lv: 'err', txt: `Дом ближе ${f(HOUSE_SIDE)} м к соседнему участку (${f(BH.side)} м)` });
  if (BH.street >= HOUSE_STREET && BH.side >= HOUSE_SIDE) out.push({ lv: 'ok', txt: `Дом: ${f(BH.street)} м до улицы, ${f(BH.side)} м до соседей — в норме` });
  for (const o of s.objs) {
    const T = DK.SITE_OBJ[o.type], r = objRect(o), B = bounds(s, r), dh = rectDist(r, H);
    const bad = [];
    if (B.side < 0) bad.push('за границей участка');
    else if (B.side < T.b) bad.push(`${f(B.side)} м до забора (нужно ${f(T.b)})`);
    if (B.street >= 0 && B.street < T.street) bad.push(`${f(B.street)} м до улицы (нужно ${f(T.street)})`);
    if (dh < T.house) bad.push(`${f(dh)} м до дома (нужно ${f(T.house)})`);
    if (T.fire) s.objs.filter(q => q !== o && (q.type === 'bath' || q.type === 'play' || q.type === 'greenhouse')).forEach(q => { const d = rectDist(r, objRect(q)); if (d < T.fire) bad.push(`${f(d)} м до «${DK.SITE_OBJ[q.type].n.toLowerCase()}» (нужно ${f(T.fire)})`); });
    out.push(bad.length ? { lv: 'err', txt: `${T.n}: ${bad.join(', ')}` } : { lv: 'ok', txt: `${T.n}: ${T.rule} — в норме` });
  }
  return out;
};
DK.siteTz = function (p) {
  const s = p.site; if (!s) return [];
  const st = { S: 'юга', N: 'севера', W: 'запада', E: 'востока' };
  const out = [`Участок ${s.poly ? 'сложной формы (' + s.poly.length + ' углов), габарит ' : ''}${DK.fmtM(s.W)} × ${DK.fmtM(s.D)} м (${DK.fmtA(DK.siteArea(s) / 1e8)} сот.), улица с ${st[s.street || 'S']} плана; дом — ${DK.fmtM(Math.max(0, bounds(s, houseRect(p)).street))} м от улицы`];
  if (s.objs.length) out.push('На участке: ' + s.objs.map(o => DK.SITE_OBJ[o.type].n.toLowerCase()).join(', ') + ' — в одном стиле с домом, фундаменты по геологии');
  return out;
};

/* ---------- план участка ---------- */
DK.SitePlan = function (canvas, app) {
  const ctx = canvas.getContext('2d'), view = { k: 0.02, ox: 40, oy: 40 };
  let dpr = 1, drag = null, sel = null, editPoly = false, hotV = -1, lastTap = { i: -1, t: 0 };
  const INK = '#242832', SEL = '#2784EB';
  function size() { dpr = window.devicePixelRatio || 1; const r = canvas.getBoundingClientRect(); canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); render(); }
  function fit() {
    const p = app.p(), s = p.site; if (!s) return;
    const r = canvas.getBoundingClientRect(), m = 4000;
    view.k = Math.max(0.002, Math.min((r.width - 40) / (s.W + 2 * m), (r.height - 90) / (s.D + 2 * m)));
    view.ox = (r.width - s.W * view.k) / 2; view.oy = 60 + (r.height - 60 - s.D * view.k) / 2;
    render();
  }
  const line = (c, a, b, d, e) => { c.beginPath(); c.moveTo(a, b); c.lineTo(d, e); c.stroke(); };
  function dimText(c, x0, y0, x1, y1, txt) {
    c.strokeStyle = SEL; c.lineWidth = 1; c.setLineDash([4, 3]); line(c, x0, y0, x1, y1); c.setLineDash([]);
    c.font = '600 11px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, w = c.measureText(txt).width + 8;
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(mx - w / 2, my - 8, w, 16); c.fillStyle = INK; c.fillText(txt, mx, my);
  }
  function draw(c, p, o) {
    o = o || {};
    const s = p.site, k = view.k, X = (x) => view.ox + x * k, Y = (y) => view.oy + y * k, L = (v) => v * k;
    const F = DK.facadeOf(p), st = s.street || 'S';
    // газон, зона застройки (отступы), граница по контуру
    const SP = DK.sitePoly(s), SE = siteEdges(s), path0 = () => { c.beginPath(); SP.forEach((q, i) => i ? c.lineTo(X(q.x), Y(q.y)) : c.moveTo(X(q.x), Y(q.y))); c.closePath(); };
    c.fillStyle = '#e4ecd9'; path0(); c.fill();
    // полоса отступов дома: 5 м от улицы, 3 м от соседей (внутри контура)
    c.save(); path0(); c.clip(); c.strokeStyle = 'rgba(190,70,60,.10)'; c.lineCap = 'round';
    SE.forEach(e => { c.lineWidth = L(2 * (e.street ? HOUSE_STREET : HOUSE_SIDE)); line(c, X(e.a.x), Y(e.a.y), X(e.b.x), Y(e.b.y)); });
    c.restore();
    c.strokeStyle = INK; c.lineWidth = 2.2; c.lineJoin = 'round'; path0(); c.stroke(); c.lineJoin = 'miter';
    // улица — красная линия по уличным сторонам
    c.strokeStyle = '#c0392b'; c.lineWidth = 3;
    SE.filter(e => e.street).forEach(e => line(c, X(e.a.x), Y(e.a.y), X(e.b.x), Y(e.b.y)));
    c.font = '700 12px Inter, sans-serif'; c.fillStyle = '#c0392b'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const se = SE.filter(e => e.street).sort((a, b) => b.len - a.len)[0];
    if (se) c.fillText('УЛИЦА', X((se.a.x + se.b.x) / 2 + se.nx * 1800), Y((se.a.y + se.b.y) / 2 + se.ny * 1800));
    // заезды и дорожка
    c.fillStyle = '#d8d3ca'; DK.siteDrives(p).forEach(r => c.fillRect(X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)));
    const path = DK.sitePath(p);
    if (path) { c.strokeStyle = '#cfc8bc'; c.lineWidth = L(1200); c.lineJoin = 'round'; c.beginPath(); path.forEach((q, i) => i ? c.lineTo(X(q.x), Y(q.y)) : c.moveTo(X(q.x), Y(q.y))); c.stroke(); c.lineJoin = 'miter'; }
    // дом: отмостка, облицовка, кровля контуром, пристройки
    const hx = s.hx, hy = s.hy, HX = (x) => X(x + hx), HY = (y) => Y(y + hy), ext = DK.extT(p);
    const poly = (pts) => { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(HX(q.x), HY(q.y)) : c.moveTo(HX(q.x), HY(q.y))); c.closePath(); };
    if (p.blind) { c.fillStyle = '#ddd8cf'; poly(DK.offsetPoly(p, ext + p.blind)); c.fill(); }
    for (const x of p.ext || []) { const r = DK.extRect(p, x); if (!r) continue; c.fillStyle = x.kind === 'garage' ? '#c9c6c0' : '#e2d3b8'; c.fillRect(HX(r.x0), HY(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)); c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(HX(r.x0), HY(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)); }
    c.fillStyle = '#9ea3aa'; poly(DK.offsetPoly(p, ext + 400)); c.fill();
    c.fillStyle = '#b9bdc3'; poly(DK.offsetPoly(p, ext)); c.fill(); c.strokeStyle = INK; c.lineWidth = 1.5; poly(DK.offsetPoly(p, ext)); c.stroke();
    const M = DK.mainRect(p), ridgeX = (p.roof.ridge === 'short') === ((M.x1 - M.x0) >= (M.y1 - M.y0));
    if (p.roof.type !== 'flat' && p.roof.type !== 'pyramid') { c.strokeStyle = 'rgba(47,50,55,.6)'; c.lineWidth = 1; if (!ridgeX) line(c, HX(M.x0), HY((M.y0 + M.y1) / 2), HX(M.x1), HY((M.y0 + M.y1) / 2)); else line(c, HX((M.x0 + M.x1) / 2), HY(M.y0), HX((M.x0 + M.x1) / 2), HY(M.y1)); }
    const hb = DK.siteHouseBox(p);
    c.font = '700 13px Inter, sans-serif'; c.fillStyle = INK; c.textAlign = 'center';
    c.fillText('Дом', HX((hb.x0 + hb.x1) / 2), HY(p.D / 2) - 8);
    c.font = '500 11px Inter, sans-serif'; c.fillText(`${DK.fmtM(p.W + 2 * ext)} × ${DK.fmtM(p.D + 2 * ext)}`, HX((hb.x0 + hb.x1) / 2), HY(p.D / 2) + 8);
    const E = DK.siteEntry(p); if (E) { c.fillStyle = '#c0392b'; c.beginPath(); c.arc(X(E.x), Y(E.y), 4, 0, 7); c.fill(); }
    // постройки
    for (const q of s.objs) {
      const T = DK.SITE_OBJ[q.type], r = objRect(q), R = [X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)];
      const fill = { bath: '#c8a57c', gazebo: '#d9c3a0', bbq: '#cfc6b8', play: '#ead9a5', flower: '#c9dfb4', greenhouse: '#d7e7ee', beds: '#b59a78',
        poolRect: '#7cc4dd', poolRound: '#7cc4dd', poolCover: '#9fd3e3', spa: '#8cc7d6', tennis: '#5f8f74', volley: '#ead9a5' }[q.type];
      if (T.g === 'tree') {
        // дерево — крона кругом, ствол точкой
        const cx2 = R[0] + R[2] / 2, cy2 = R[1] + R[3] / 2, rad = Math.min(R[2], R[3]) / 2;
        c.fillStyle = q.type === 'treeFruit' ? 'rgba(110,160,80,.75)' : q.type === 'treeConifer' ? 'rgba(50,100,70,.8)' : 'rgba(80,130,70,.7)';
        c.beginPath(); c.arc(cx2, cy2, rad, 0, 7); c.fill(); c.strokeStyle = 'rgba(40,70,40,.7)'; c.lineWidth = 1; c.stroke();
        if (q.type === 'treeConifer') { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.moveTo(cx2, cy2); c.lineTo(cx2 + Math.cos(a) * rad, cy2 + Math.sin(a) * rad); } c.stroke(); }
        if (q.type === 'treeFruit') for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#d9534f' : '#e8b23a'; c.beginPath(); c.arc(cx2 + Math.cos(i) * rad * 0.55, cy2 + Math.sin(i * 1.7) * rad * 0.55, Math.max(1.5, rad * 0.1), 0, 7); c.fill(); }
        c.fillStyle = '#6b4f36'; c.beginPath(); c.arc(cx2, cy2, Math.max(1.5, rad * 0.12), 0, 7); c.fill();
        continue;
      }
      c.fillStyle = fill;
      if (q.type === 'poolRound' || q.type === 'spa') { c.beginPath(); c.ellipse(R[0] + R[2] / 2, R[1] + R[3] / 2, R[2] / 2, R[3] / 2, 0, 0, 7); c.fill(); c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke(); }
      else { c.fillRect(...R); c.strokeStyle = INK; c.lineWidth = 1.2; c.strokeRect(...R); }
      c.save(); c.beginPath(); c.rect(...R); c.clip(); c.strokeStyle = 'rgba(60,64,70,.35)'; c.lineWidth = 1;
      if (q.type === 'bath' || q.type === 'gazebo' || q.type === 'greenhouse') { line(c, R[0], R[1], R[0] + R[2], R[1] + R[3]); line(c, R[0] + R[2], R[1], R[0], R[1] + R[3]); }
      if (q.type === 'flower') for (let i = 0; i < 8; i++) { c.fillStyle = ['#d65a7a', '#e8b23a', '#9b6bd6', '#e06a3a'][i % 4]; c.beginPath(); c.arc(R[0] + R[2] * ((i * 37) % 10 + 0.5) / 10, R[1] + R[3] * ((i * 53) % 7 + 0.5) / 7, Math.max(2, L(140)), 0, 7); c.fill(); }
      if (q.type === 'play') { c.strokeStyle = 'rgba(160,120,40,.6)'; c.strokeRect(R[0] + L(400), R[1] + L(400), L(1500), L(1500)); }
      if (q.type === 'tennis' || q.type === 'volley') {
        // игровое поле и разметка
        const rot = R[2] > R[3], fw = q.type === 'tennis' ? 10970 : 9000, fl = q.type === 'tennis' ? 23770 : 18000;
        const pw = L(rot ? fl : fw), ph = L(rot ? fw : fl), px = R[0] + (R[2] - pw) / 2, py = R[1] + (R[3] - ph) / 2;
        c.fillStyle = q.type === 'tennis' ? '#4a6fa5' : '#e3cf9c'; c.fillRect(px, py, pw, ph); c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.strokeRect(px, py, pw, ph);
        if (rot) line(c, px + pw / 2, py - 4, px + pw / 2, py + ph + 4); else line(c, px - 4, py + ph / 2, px + pw + 4, py + ph / 2);
      }
      if (q.type === 'poolRect' || q.type === 'poolCover') { c.strokeStyle = '#e8e2d6'; c.lineWidth = Math.max(2, L(300)); c.strokeRect(R[0] + L(150), R[1] + L(150), R[2] - L(300), R[3] - L(300)); }
      if (q.type === 'poolCover') { c.strokeStyle = 'rgba(60,64,70,.4)'; c.lineWidth = 1; for (let i = 1; i < 6; i++) { const xx = R[2] > R[3] ? R[0] + R[2] * i / 6 : null; if (xx) line(c, xx, R[1], xx, R[1] + R[3]); else line(c, R[0], R[1] + R[3] * i / 6, R[0] + R[2], R[1] + R[3] * i / 6); } }
      if (q.type === 'beds') { c.fillStyle = '#5a4636'; const n2 = Math.max(2, Math.round((R[2] > R[3] ? R[2] : R[3]) / L(1600))); for (let i = 0; i < n2; i++) { if (R[2] > R[3]) c.fillRect(R[0] + R[2] * (i + 0.15) / n2, R[1] + L(300), R[2] * 0.7 / n2, R[3] - L(600)); else c.fillRect(R[0] + L(300), R[1] + R[3] * (i + 0.15) / n2, R[2] - L(600), R[3] * 0.7 / n2); } }
      if (q.type === 'bbq') { c.fillStyle = '#8c5a46'; c.fillRect(R[0] + R[2] / 2 - L(600), R[1] + L(150), L(1200), L(600)); }
      c.restore();
      const fs = Math.max(9, Math.min(12, L(700)));
      c.font = `600 ${fs}px Inter, sans-serif`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (R[2] > 40) c.fillText(T.n, R[0] + R[2] / 2, R[1] + R[3] / 2);
    }
    // длины сторон участка — снаружи у каждой стороны
    c.font = '600 11px Inter, sans-serif'; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
    SE.forEach(e => { if (L(e.len) < 34) return; const mx = X((e.a.x + e.b.x) / 2) + e.nx * 14, my = Y((e.a.y + e.b.y) / 2) + e.ny * 14; let ang = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
      c.save(); c.translate(mx, my); c.rotate(ang); c.fillText(DK.fmtM(e.len) + ' м', 0, 0); c.restore(); });
    if (!o.noSel) { c.font = '600 12px Inter, sans-serif'; c.textAlign = 'left'; c.fillStyle = INK; c.fillText(`${DK.fmtA(DK.siteArea(s) / 1e8)} сот.${s.poly ? ' · ' + s.poly.length + ' углов' : ''}`, X(0), Y(0) - 30); }
    // правка контура: вершины и «+» на серединах сторон
    if (editPoly && !o.noSel) {
      SE.forEach(e => { const mx = X((e.a.x + e.b.x) / 2), my = Y((e.a.y + e.b.y) / 2); c.fillStyle = '#fff'; c.strokeStyle = SEL; c.lineWidth = 1.5; c.beginPath(); c.arc(mx, my, 6, 0, 7); c.fill(); c.stroke(); c.strokeStyle = INK; line(c, mx - 3, my, mx + 3, my); line(c, mx, my - 3, mx, my + 3); });
      SP.forEach((q, i) => { c.fillStyle = i === hotV ? SEL : '#fff'; c.strokeStyle = INK; c.lineWidth = 1.8; c.beginPath(); c.arc(X(q.x), Y(q.y), 7, 0, 7); c.fill(); c.stroke(); });
    }
    // выделение и расстояния до границ
    const selR = sel === 'house' ? houseRect(p) : sel ? (() => { const q = s.objs.find(v => v.id === sel); return q && objRect(q); })() : null;
    if (selR && !o.noSel) {
      c.strokeStyle = SEL; c.lineWidth = 2.5; c.strokeRect(X(selR.x0) - 2, Y(selR.y0) - 2, L(selR.x1 - selR.x0) + 4, L(selR.y1 - selR.y0) + 4);
      const cx = (selR.x0 + selR.x1) / 2, cy = (selR.y0 + selR.y1) / 2;
      // до границы — лучом от середины каждой стороны (работает и для сложного контура)
      [[selR.x0, cy, -1, 0], [selR.x1, cy, 1, 0], [cx, selR.y0, 0, -1], [cx, selR.y1, 0, 1]].forEach(([x, y, dx, dy]) => {
        const h = rayHit(s, x, y, dx, dy); if (h < Infinity) dimText(c, X(x), Y(y), X(x + dx * h), Y(y + dy * h), DK.fmtM(h));
      });
    }
    // роза ветров: стрелка на север
    const cr = 26, ccx = X(s.W) + (o.compass || 46), ccy = Y(0) + 30;
    c.save(); c.translate(ccx, ccy); c.rotate((s.north || 0) * Math.PI / 180);
    c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, cr, 0, 7); c.stroke();
    c.fillStyle = '#c0392b'; c.beginPath(); c.moveTo(0, -cr + 3); c.lineTo(7, 4); c.lineTo(-7, 4); c.closePath(); c.fill();
    c.fillStyle = INK; c.beginPath(); c.moveTo(0, cr - 3); c.lineTo(7, 4); c.lineTo(-7, 4); c.closePath(); c.fill();
    c.font = '700 12px Inter, sans-serif'; c.textAlign = 'center'; c.fillText('С', 0, -cr - 9);
    c.restore();
  }
  function render() {
    const p = app.p(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!p.site) return;
    draw(ctx, p);
  }
  function toImage(w) {
    const p = app.p(), s = p.site; if (!s) return null;
    const W = w || 1400, m = 5000, k = (W - 120) / (s.W + 2 * m), H = Math.round((s.D + 2 * m) * k + 80);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    const keep = Object.assign({}, view); view.k = k; view.ox = 60 + m * k; view.oy = 40 + m * k;
    draw(c, p, { noSel: true, compass: 50 }); Object.assign(view, keep);
    return cv.toDataURL('image/png');
  }
  const toW = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.ox) / view.k, y: (e.clientY - r.top - view.oy) / view.k, sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const inR = (r, w) => w.x > r.x0 && w.x < r.x1 && w.y > r.y0 && w.y < r.y1;
  canvas.addEventListener('pointerdown', (e) => {
    const p = app.p(), s = p.site; if (!s) return;
    canvas.setPointerCapture(e.pointerId);
    const w = toW(e), q = s.objs.slice().reverse().find(o => inR(objRect(o), w));
    if (editPoly) {
      const P = DK.sitePoly(s), near = (x, y) => Math.hypot(X0(x) - w.sx, Y0(y) - w.sy) < 10;
      const vi = P.findIndex(v => near(v.x, v.y));
      if (vi >= 0) {
        const dbl = lastTap.i === vi && Date.now() - lastTap.t < 400; lastTap = { i: vi, t: Date.now() };
        if (dbl && P.length > 3) { s.poly = P.filter((_, i) => i !== vi); DK.siteNormalize(p); app.commit('Контур участка'); render(); return; }
        s.poly = P.map(v => ({ x: v.x, y: v.y })); hotV = vi; drag = { kind: 'vertex', i: vi }; render(); return;
      }
      const ei = P.findIndex((v, i) => { const b = P[(i + 1) % P.length]; return near((v.x + b.x) / 2, (v.y + b.y) / 2); });
      if (ei >= 0) { const a = P[ei], b = P[(ei + 1) % P.length]; s.poly = P.map(v => ({ x: v.x, y: v.y })); s.poly.splice(ei + 1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) }); hotV = ei + 1; drag = { kind: 'vertex', i: ei + 1 }; render(); return; }
    }
    if (q) { sel = q.id; drag = { kind: 'obj', o: q, w0: w, x0: q.x, y0: q.y }; }
    else if (inR(houseRect(p), w)) { sel = 'house'; drag = { kind: 'house', w0: w, x0: s.hx, y0: s.hy }; }
    else { sel = null; drag = { kind: 'pan', sx: w.sx, sy: w.sy, ox: view.ox, oy: view.oy }; }
    app.siteSel && app.siteSel(sel); render();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = app.p(), s = p.site, w = toW(e), snap = (v) => Math.round(v / 100) * 100;
    if (drag.kind === 'vertex') {
      // вершина: шаг 100 мм, Shift — по горизонтали или вертикали к соседней вершине
      const P = s.poly, v = P[drag.i], pv = P[(drag.i - 1 + P.length) % P.length];
      let x = snap(w.x), y = snap(w.y);
      if (e.shiftKey) { if (Math.abs(x - pv.x) < Math.abs(y - pv.y)) x = pv.x; else y = pv.y; }
      v.x = x; v.y = y; drag.moved = true; render(); return;
    }
    if (drag.kind === 'pan') { view.ox = drag.ox + w.sx - drag.sx; view.oy = drag.oy + w.sy - drag.sy; }
    else if (drag.kind === 'obj') { drag.o.x = snap(drag.x0 + w.x - drag.w0.x); drag.o.y = snap(drag.y0 + w.y - drag.w0.y); drag.moved = true; }
    else { s.hx = snap(drag.x0 + w.x - drag.w0.x); s.hy = snap(drag.y0 + w.y - drag.w0.y); drag.moved = true; }
    render();
  });
  const up = () => {
    if (drag && drag.kind === 'vertex') { DK.siteNormalize(app.p()); hotV = -1; app.commit('Контур участка'); drag = null; render(); return; }
    if (drag && drag.moved) app.commit(drag.kind === 'house' ? 'Дом на участке' : DK.SITE_OBJ[drag.o.type].n); drag = null;
  };
  const X0 = (x) => view.ox + x * view.k, Y0 = (y) => view.oy + y * view.k;
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015), e); }, { passive: false });
  function zoom(f, e) {
    const r = canvas.getBoundingClientRect(), sx = e ? e.clientX - r.left : r.width / 2, sy = e ? e.clientY - r.top : r.height / 2;
    const nk = Math.max(0.002, Math.min(0.3, view.k * f)); view.ox = sx - (sx - view.ox) * nk / view.k; view.oy = sy - (sy - view.oy) * nk / view.k; view.k = nk; render();
  }
  window.addEventListener('resize', () => { if (!canvas.hidden) size(); });
  return { size, fit, render, zoom, toImage, view, sel: () => sel, select(v) { sel = v; render(); }, edit(v) { editPoly = !!v; hotV = -1; render(); }, editing: () => editPoly };
};
})();
