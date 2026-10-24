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
function houseRect(p) { const s = p.site, b = DK.siteHouseBox(p); return { x0: b.x0 + s.hx, y0: b.y0 + s.hy, x1: b.x1 + s.hx, y1: b.y1 + s.hy }; }
function objRect(o) { const T = DK.SITE_OBJ[o.type], rot = (o.a || 0) % 180 === 90, w = o.w || T.w, d = o.d || T.d, sw = rot ? d : w, sd = rot ? w : d; return { x0: o.x - sw / 2, y0: o.y - sd / 2, x1: o.x + sw / 2, y1: o.y + sd / 2 }; }
function rectDist(a, b) { const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1), dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1); return Math.hypot(dx, dy); }
/* расстояния до сторон участка: до улицы и до ближайшей соседской границы */
function bounds(s, r) {
  const d = { N: r.y0, S: s.D - r.y1, W: r.x0, E: s.W - r.x1 }, st = s.street || 'S';
  return { street: d[st], side: Math.min(...Object.keys(d).filter(k => k !== st).map(k => d[k])), all: d };
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
    const o = r.e.axis === 'x' ? [0, r.e.out] : [r.e.out, 0]; if (o[0] !== dirs[0] || o[1] !== dirs[1]) continue;
    const a0 = x.c - x.w / 2 + 300, a1 = x.c + x.w / 2 - 300;
    const R = r.e.axis === 'x' ? { x0: a0 + s.hx, x1: a1 + s.hx } : { y0: a0 + s.hy, y1: a1 + s.hy };
    if (st === 'S') { R.y0 = r.far + s.hy; R.y1 = s.D; } else if (st === 'N') { R.y1 = r.far + s.hy; R.y0 = 0; } else if (st === 'E') { R.x0 = r.far + s.hx; R.x1 = s.W; } else { R.x1 = r.far + s.hx; R.x0 = 0; }
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
  if (type === 'bath') return -B.street + B.side * 0.6;
  if (type === 'gazebo') return dh - B.street * 0.15;
  if (type === 'bbq') { const g = near('gazebo'); return (g != null ? Math.abs(g - 4500) * 1.5 : 0) + dh * 0.3 - B.street * 0.1; }
  if (type === 'play') return dh * 1.2 - B.street * 0.1 + B.side * 0.05;
  if (type === 'greenhouse') return -B.street * 0.6 + B.side * 0.4;
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
  const order = ['bath', 'greenhouse', 'gazebo', 'bbq', 'play', 'flower'];
  s.objs = [];
  objs.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type)).forEach(o => { DK.siteAuto(p, o); s.objs.push(o); });
};
/* проверки отступов */
DK.siteChecks = function (p) {
  const s = p.site; if (!s) return [];
  const out = [], f = (v) => DK.fmtM(Math.max(0, v));
  const H = houseRect(p), BH = bounds(s, H);
  if (BH.street < HOUSE_STREET) out.push({ lv: 'err', txt: `Дом ближе ${f(HOUSE_STREET)} м к улице (${f(BH.street)} м)` });
  if (BH.side < HOUSE_SIDE) out.push({ lv: 'err', txt: `Дом ближе ${f(HOUSE_SIDE)} м к соседнему участку (${f(BH.side)} м)` });
  if (BH.street >= HOUSE_STREET && BH.side >= HOUSE_SIDE) out.push({ lv: 'ok', txt: `Дом: ${f(BH.street)} м до улицы, ${f(BH.side)} м до соседей — в норме` });
  for (const o of s.objs) {
    const T = DK.SITE_OBJ[o.type], r = objRect(o), B = bounds(s, r), dh = rectDist(r, H);
    const bad = [];
    if (B.side < T.b) bad.push(`${f(B.side)} м до забора (нужно ${f(T.b)})`);
    if (B.street < T.street) bad.push(`${f(B.street)} м до улицы (нужно ${f(T.street)})`);
    if (dh < T.house) bad.push(`${f(dh)} м до дома (нужно ${f(T.house)})`);
    if (T.fire) s.objs.filter(q => q !== o && (q.type === 'bath' || q.type === 'play' || q.type === 'greenhouse')).forEach(q => { const d = rectDist(r, objRect(q)); if (d < T.fire) bad.push(`${f(d)} м до «${DK.SITE_OBJ[q.type].n.toLowerCase()}» (нужно ${f(T.fire)})`); });
    out.push(bad.length ? { lv: 'err', txt: `${T.n}: ${bad.join(', ')}` } : { lv: 'ok', txt: `${T.n}: ${T.rule} — в норме` });
  }
  return out;
};
DK.siteTz = function (p) {
  const s = p.site; if (!s) return [];
  const st = { S: 'юга', N: 'севера', W: 'запада', E: 'востока' };
  const out = [`Участок ${DK.fmtM(s.W)} × ${DK.fmtM(s.D)} м (${DK.fmtA(s.W * s.D / 1e8)} сот.), улица с ${st[s.street || 'S']} плана; дом — ${DK.fmtM(bounds(s, houseRect(p)).street)} м от улицы`];
  if (s.objs.length) out.push('На участке: ' + s.objs.map(o => DK.SITE_OBJ[o.type].n.toLowerCase()).join(', ') + ' — в одном стиле с домом, фундаменты по геологии');
  return out;
};

/* ---------- план участка ---------- */
DK.SitePlan = function (canvas, app) {
  const ctx = canvas.getContext('2d'), view = { k: 0.02, ox: 40, oy: 40 };
  let dpr = 1, drag = null, sel = null;
  const INK = '#2f3237', SEL = '#e3a21a';
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
    c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, w = c.measureText(txt).width + 8;
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(mx - w / 2, my - 8, w, 16); c.fillStyle = INK; c.fillText(txt, mx, my);
  }
  function draw(c, p, o) {
    o = o || {};
    const s = p.site, k = view.k, X = (x) => view.ox + x * k, Y = (y) => view.oy + y * k, L = (v) => v * k;
    const F = DK.facadeOf(p), st = s.street || 'S';
    // газон, зона застройки (отступы), граница
    c.fillStyle = '#e4ecd9'; c.fillRect(X(0), Y(0), L(s.W), L(s.D));
    const z = { x0: st === 'W' ? HOUSE_STREET : HOUSE_SIDE, y0: st === 'N' ? HOUSE_STREET : HOUSE_SIDE, x1: s.W - (st === 'E' ? HOUSE_STREET : HOUSE_SIDE), y1: s.D - (st === 'S' ? HOUSE_STREET : HOUSE_SIDE) };
    c.strokeStyle = 'rgba(190,70,60,.55)'; c.lineWidth = 1; c.setLineDash([8, 4, 2, 4]); c.strokeRect(X(z.x0), Y(z.y0), L(z.x1 - z.x0), L(z.y1 - z.y0)); c.setLineDash([]);
    c.strokeStyle = INK; c.lineWidth = 2.2; c.strokeRect(X(0), Y(0), L(s.W), L(s.D));
    // улица — красная линия
    c.strokeStyle = '#c0392b'; c.lineWidth = 3;
    const sl = { S: [0, s.D, s.W, s.D], N: [0, 0, s.W, 0], W: [0, 0, 0, s.D], E: [s.W, 0, s.W, s.D] }[st];
    line(c, X(sl[0]), Y(sl[1]), X(sl[2]), Y(sl[3]));
    c.font = '700 12px Raleway, sans-serif'; c.fillStyle = '#c0392b'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const so = { S: [s.W / 2, s.D + 1600], N: [s.W / 2, -1600], W: [-1800, s.D / 2], E: [s.W + 1800, s.D / 2] }[st];
    c.fillText('УЛИЦА', X(so[0]), Y(so[1]));
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
    c.font = '700 13px Raleway, sans-serif'; c.fillStyle = INK; c.textAlign = 'center';
    c.fillText('Дом', HX((hb.x0 + hb.x1) / 2), HY(p.D / 2) - 8);
    c.font = '500 11px "JetBrains Mono", monospace'; c.fillText(`${DK.fmtM(p.W + 2 * ext)} × ${DK.fmtM(p.D + 2 * ext)}`, HX((hb.x0 + hb.x1) / 2), HY(p.D / 2) + 8);
    const E = DK.siteEntry(p); if (E) { c.fillStyle = '#c0392b'; c.beginPath(); c.arc(X(E.x), Y(E.y), 4, 0, 7); c.fill(); }
    // постройки
    for (const q of s.objs) {
      const T = DK.SITE_OBJ[q.type], r = objRect(q), R = [X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)];
      const fill = { bath: '#c8a57c', gazebo: '#d9c3a0', bbq: '#cfc6b8', play: '#ead9a5', flower: '#c9dfb4', greenhouse: '#d7e7ee' }[q.type];
      c.fillStyle = fill; c.fillRect(...R); c.strokeStyle = INK; c.lineWidth = 1.2; c.strokeRect(...R);
      c.save(); c.beginPath(); c.rect(...R); c.clip(); c.strokeStyle = 'rgba(60,64,70,.35)'; c.lineWidth = 1;
      if (q.type === 'bath' || q.type === 'gazebo' || q.type === 'greenhouse') { line(c, R[0], R[1], R[0] + R[2], R[1] + R[3]); line(c, R[0] + R[2], R[1], R[0], R[1] + R[3]); }
      if (q.type === 'flower') for (let i = 0; i < 8; i++) { c.fillStyle = ['#d65a7a', '#e8b23a', '#9b6bd6', '#e06a3a'][i % 4]; c.beginPath(); c.arc(R[0] + R[2] * ((i * 37) % 10 + 0.5) / 10, R[1] + R[3] * ((i * 53) % 7 + 0.5) / 7, Math.max(2, L(140)), 0, 7); c.fill(); }
      if (q.type === 'play') { c.strokeStyle = 'rgba(160,120,40,.6)'; c.strokeRect(R[0] + L(400), R[1] + L(400), L(1500), L(1500)); }
      if (q.type === 'bbq') { c.fillStyle = '#8c5a46'; c.fillRect(R[0] + R[2] / 2 - L(600), R[1] + L(150), L(1200), L(600)); }
      c.restore();
      const fs = Math.max(9, Math.min(12, L(700)));
      c.font = `600 ${fs}px Raleway, sans-serif`; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (R[2] > 40) c.fillText(T.n, R[0] + R[2] / 2, R[1] + R[3] / 2);
    }
    // размеры участка
    c.font = '600 12px "JetBrains Mono", monospace'; c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(DK.fmtM(s.W) + ' м', X(s.W / 2), Y(0) - 14); c.save(); c.translate(X(0) - 16, Y(s.D / 2)); c.rotate(-Math.PI / 2); c.fillText(DK.fmtM(s.D) + ' м', 0, 0); c.restore();
    // выделение и расстояния до границ
    const selR = sel === 'house' ? houseRect(p) : sel ? (() => { const q = s.objs.find(v => v.id === sel); return q && objRect(q); })() : null;
    if (selR && !o.noSel) {
      c.strokeStyle = SEL; c.lineWidth = 2.5; c.strokeRect(X(selR.x0) - 2, Y(selR.y0) - 2, L(selR.x1 - selR.x0) + 4, L(selR.y1 - selR.y0) + 4);
      const cx = (selR.x0 + selR.x1) / 2, cy = (selR.y0 + selR.y1) / 2;
      dimText(c, X(selR.x0), Y(cy), X(0), Y(cy), DK.fmtM(selR.x0));
      dimText(c, X(selR.x1), Y(cy), X(s.W), Y(cy), DK.fmtM(s.W - selR.x1));
      dimText(c, X(cx), Y(selR.y0), X(cx), Y(0), DK.fmtM(selR.y0));
      dimText(c, X(cx), Y(selR.y1), X(cx), Y(s.D), DK.fmtM(s.D - selR.y1));
    }
    // роза ветров: стрелка на север
    const cr = 26, ccx = X(s.W) + (o.compass || 46), ccy = Y(0) + 30;
    c.save(); c.translate(ccx, ccy); c.rotate((s.north || 0) * Math.PI / 180);
    c.strokeStyle = INK; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, cr, 0, 7); c.stroke();
    c.fillStyle = '#c0392b'; c.beginPath(); c.moveTo(0, -cr + 3); c.lineTo(7, 4); c.lineTo(-7, 4); c.closePath(); c.fill();
    c.fillStyle = INK; c.beginPath(); c.moveTo(0, cr - 3); c.lineTo(7, 4); c.lineTo(-7, 4); c.closePath(); c.fill();
    c.font = '700 12px Raleway, sans-serif'; c.textAlign = 'center'; c.fillText('С', 0, -cr - 9);
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
    if (q) { sel = q.id; drag = { kind: 'obj', o: q, w0: w, x0: q.x, y0: q.y }; }
    else if (inR(houseRect(p), w)) { sel = 'house'; drag = { kind: 'house', w0: w, x0: s.hx, y0: s.hy }; }
    else { sel = null; drag = { kind: 'pan', sx: w.sx, sy: w.sy, ox: view.ox, oy: view.oy }; }
    app.siteSel && app.siteSel(sel); render();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = app.p(), s = p.site, w = toW(e), snap = (v) => Math.round(v / 100) * 100;
    if (drag.kind === 'pan') { view.ox = drag.ox + w.sx - drag.sx; view.oy = drag.oy + w.sy - drag.sy; }
    else if (drag.kind === 'obj') { drag.o.x = snap(drag.x0 + w.x - drag.w0.x); drag.o.y = snap(drag.y0 + w.y - drag.w0.y); drag.moved = true; }
    else { s.hx = snap(drag.x0 + w.x - drag.w0.x); s.hy = snap(drag.y0 + w.y - drag.w0.y); drag.moved = true; }
    render();
  });
  const up = () => { if (drag && drag.moved) app.commit(drag.kind === 'house' ? 'Дом на участке' : DK.SITE_OBJ[drag.o.type].n); drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015), e); }, { passive: false });
  function zoom(f, e) {
    const r = canvas.getBoundingClientRect(), sx = e ? e.clientX - r.left : r.width / 2, sy = e ? e.clientY - r.top : r.height / 2;
    const nk = Math.max(0.002, Math.min(0.3, view.k * f)); view.ox = sx - (sx - view.ox) * nk / view.k; view.oy = sy - (sy - view.oy) * nk / view.k; view.k = nk; render();
  }
  window.addEventListener('resize', () => { if (!canvas.hidden) size(); });
  return { size, fit, render, zoom, toImage, view, sel: () => sel, select(v) { sel = v; render(); } };
};
})();
