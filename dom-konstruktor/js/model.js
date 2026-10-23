/* Модель дома: все размеры в мм. План: X — вправо, Y — вниз; верх плана — фасад «Север».
   Наружные стены, несущая стена, мокрая зона и лестница общие для всех этажей,
   перегородки, проёмы, мебель и назначения помещений — у каждого этажа свои. */
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
  hall: { n: 'Холл' },
  tamb: { n: 'Тамбур' },
  corr: { n: 'Коридор' },
  bath: { n: 'Санузел', wet: true },
  laundry: { n: 'Прачечная', wet: true },
  boiler: { n: 'Котельная', wet: true },
  sauna: { n: 'Сауна', wet: true },
  dress: { n: 'Гардеробная' },
  store: { n: 'Кладовая' },
  garage: { n: 'Гараж' },
};

/* требования к котельной (газ, до 150 кВт): СП 402.1325800.2018, п. 5.2 — сверять с ТУ газовой службы */
const BOILER = { vol: 15, height: 2500, glazing: 0.03, door: 800 };

let uid = Date.now() % 100000;
const id = (p) => p + (uid++).toString(36);

function ts(p) { return SPEC.outer[p.wallMat].t; }
function extT(p) { const c = SPEC.clad[p.clad]; return p.insul + c.gap + c.t; }
function totalT(p) { return ts(p) + extT(p); }
function storey(p) { return p.hClear + p.slab; }
function floorsOf(p) { return (p.basement ? ['b'] : []).concat(['f1', 'f2', 'f3'].slice(0, p.floors)); }
function floorName(fid) { return FLOORS.find(f => f.id === fid).n; }
function elev(p, fid) { return fid === 'b' ? -storey(p) : (Number(fid[1]) - 1) * storey(p); }
function emptyLevel() { return { parts: [], open: [], furn: [], names: [] }; }

/* размеры проёма по типу */
function opSize(p, o) {
  if (o.kind === 'door') return { sill: 0, h: 2100 };
  if (o.kind === 'entry') return { sill: 0, h: 2200 };
  if (o.pano) return { sill: 0, h: p.hClear - 250 };
  return { sill: o.sill != null ? o.sill : 850, h: o.h || 1500 };
}

/* стены этажа прямоугольниками; a0..a1 — пределы вдоль оси стены */
function walls(p, fid) {
  const t = ts(p), W = p.W, D = p.D, out = [];
  out.push({ id: 'N', kind: 'outer', axis: 'x', x0: 0, y0: 0, x1: W, y1: t });
  out.push({ id: 'S', kind: 'outer', axis: 'x', x0: 0, y0: D - t, x1: W, y1: D });
  out.push({ id: 'W', kind: 'outer', axis: 'y', x0: 0, y0: 0, x1: t, y1: D });
  out.push({ id: 'E', kind: 'outer', axis: 'y', x0: W - t, y0: 0, x1: W, y1: D });
  const bh = SPEC.bearing.t / 2;
  p.bearing.forEach((b, i) => {
    if (b.axis === 'h') out.push({ id: 'B' + i, kind: 'bearing', axis: 'x', x0: t, x1: W - t, y0: b.pos - bh, y1: b.pos + bh });
    else out.push({ id: 'B' + i, kind: 'bearing', axis: 'y', x0: b.pos - bh, x1: b.pos + bh, y0: t, y1: D - t });
  });
  const ph = SPEC.part.t / 2, lv = p.levels[fid];
  if (lv) lv.parts.forEach(w => {
    if (w.y1 === w.y2) out.push({ id: w.id, kind: 'part', axis: 'x', x0: Math.min(w.x1, w.x2), x1: Math.max(w.x1, w.x2), y0: w.y1 - ph, y1: w.y1 + ph });
    else out.push({ id: w.id, kind: 'part', axis: 'y', x0: w.x1 - ph, x1: w.x1 + ph, y0: Math.min(w.y1, w.y2), y1: Math.max(w.y1, w.y2) });
  });
  out.forEach(w => {
    w.a0 = w.axis === 'x' ? w.x0 : w.y0; w.a1 = w.axis === 'x' ? w.x1 : w.y1;
    w.t = w.axis === 'x' ? w.y1 - w.y0 : w.x1 - w.x0;
    w.m = w.axis === 'x' ? (w.y0 + w.y1) / 2 : (w.x0 + w.x1) / 2; // координата оси стены
  });
  return out;
}

/* помещения: сжатая сетка по граням стен и заливка — площади точные для любых ортогональных стен */
function rooms(p, fid) {
  const ws = walls(p, fid), W = p.W, D = p.D;
  const uniq = (a) => Array.from(new Set(a.map(Math.round))).sort((m, n) => m - n);
  const xs = uniq([0, W].concat(...ws.map(w => [w.x0, w.x1]))).filter(v => v >= 0 && v <= W);
  const ys = uniq([0, D].concat(...ws.map(w => [w.y0, w.y1]))).filter(v => v >= 0 && v <= D);
  const nx = xs.length - 1, ny = ys.length - 1, cell = new Int32Array(nx * ny).fill(-1);
  const wallAt = (x, y) => ws.find(w => x > w.x0 && x < w.x1 && y > w.y0 && y < w.y1);
  const cw = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const w = wallAt((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
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
      const nb = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
      for (const [a2, b2] of nb) {
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
    if (r.area >= 0.3) regs.push(r); else r.tiny = true;
  }
  regs.forEach((r, k) => { r.i = k; r.type = 'none'; });
  const at = (x, y) => regs.find(r => r.cells.some(c => x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3]));
  const lv = p.levels[fid];
  if (lv) lv.names.forEach(nm => { const r = at(nm.x, nm.y); if (r && r.type === 'none') { r.type = nm.type; r.nameRef = nm; } });
  regs.at = at;
  return regs;
}

/* по проёму — помещения по обе стороны */
function opRegions(p, fid, o, regs) {
  const w = walls(p, fid).find(v => v.id === o.wall);
  if (!w) return [];
  const d = w.t / 2 + 30, out = [];
  for (const s of [-1, 1]) {
    const x = w.axis === 'x' ? o.c : w.m + s * d, y = w.axis === 'x' ? w.m + s * d : o.c;
    const r = regs.at(x, y);
    if (r) out.push(r);
  }
  return out;
}

/* варианты несущей стены: каждый пролёт перекрытия в чистоте — от slabMin до slabMax */
function bearingVariants(p) {
  const t = ts(p), bt = SPEC.bearing.t, res = [];
  const cx = p.W - 2 * t, cy = p.D - 2 * t, mx = SPEC.slabMax, mn = SPEC.slabMin;
  const r50 = (v) => Math.round(v / 50) * 50;
  const longIs = p.W >= p.D ? 'h' : 'v';
  const label = (ax, n) => (ax === longIs ? 'Продольная' : 'Поперечная') + (n > 1 ? ' ×' + n : '');
  if (Math.min(cx, cy) <= mx) res.push({ walls: [], n: 'Без внутренней несущей стены', note: 'плиты перекрывают пролёт ' + fmtM(Math.min(cx, cy)) + ' м' });
  for (const ax of ['h', 'v']) {
    const clear = ax === 'h' ? cy : cx, origin = t;
    for (const n of [1, 2]) {
      const span = (clear - n * bt) / (n + 1);
      if (span > mx || span < mn) continue;
      if (n === 2 && (clear - bt) / 2 <= mx) continue; // хватает одной стены
      const fracs = n === 1 ? [0.5, 0.42, 0.58, 0.36, 0.64] : [0];
      const seen = new Set();
      for (const f of fracs) {
        let pos;
        if (n === 1) pos = [r50(origin + bt / 2 + (clear - bt) * f)];
        else pos = [1, 2].map(k => r50(origin + k * span + (k - 0.5) * bt));
        const spans = spansOf(origin, clear, pos, bt);
        if (spans.some(s => s > mx || s < mn)) continue;
        const key = pos.join(',');
        if (seen.has(key)) continue; seen.add(key);
        res.push({ walls: pos.map(v => ({ axis: ax, pos: v })), n: label(ax, n) + (f === 0.5 || n === 2 ? ' по центру' : ' со смещением'), note: 'пролёты ' + spans.map(fmtM).join(' + ') + ' м' });
      }
    }
  }
  return res;
}
function spansOf(origin, clear, pos, bt) {
  const edges = [origin].concat(...pos.slice().sort((a, b) => a - b).map(v => [v - bt / 2, v + bt / 2]), [origin + clear]);
  const s = [];
  for (let i = 0; i < edges.length; i += 2) s.push(edges[i + 1] - edges[i]);
  return s;
}
function fmtM(mm) { return (mm / 1000).toFixed(2).replace(/0$/, '').replace('.', ','); }

/* мокрая зона: у наружной стены, рядом с несущей — короткие разводки и общий стояк */
function wetVariants(p) {
  const t = ts(p), W = p.W, D = p.D, zw = 2600, zh = 2600, out = [];
  const b = p.bearing[0];
  const clampX = (x) => Math.max(t, Math.min(x, W - t - zw)), clampY = (y) => Math.max(t, Math.min(y, D - t - zh));
  if (b && b.axis === 'h') {
    for (const x of [t, W - t - zw]) for (const y of [b.pos - 190 - zh, b.pos + 190]) out.push({ x: clampX(x), y: clampY(y), w: zw, h: zh });
  } else if (b) {
    for (const y of [t, D - t - zh]) for (const x of [b.pos - 190 - zw, b.pos + 190]) out.push({ x: clampX(x), y: clampY(y), w: zw, h: zh });
  } else {
    for (const x of [t, W - t - zw]) for (const y of [t, D - t - zh]) out.push({ x, y, w: zw, h: zh });
  }
  return out;
}

const inter = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
function stairRect(p) { const s = p.stair; return s ? { x0: s.x, y0: s.y, x1: s.x + (s.rot % 2 ? s.l : s.w), y1: s.y + (s.rot % 2 ? s.w : s.l) } : null; }

/* проверки: ошибки (err), предупреждения (warn), норма (ok) */
function checks(p) {
  const out = [], t = ts(p);
  const add = (lv, txt, fid) => out.push({ lv, txt, fid });
  // перекрытия
  const sp = { h: spansOf(t, p.D - 2 * t, p.bearing.filter(b => b.axis === 'h').map(b => b.pos), SPEC.bearing.t),
               v: spansOf(t, p.W - 2 * t, p.bearing.filter(b => b.axis === 'v').map(b => b.pos), SPEC.bearing.t) };
  const ok = (a) => a.every(s => s <= SPEC.slabMax);
  if (ok(sp.h) || ok(sp.v)) add('ok', 'Перекрытия: пролёты ' + (ok(sp.h) ? sp.h : sp.v).map(fmtM).join(' + ') + ' м — в пределах ' + fmtM(SPEC.slabMax) + ' м');
  else add('err', 'Пролёт перекрытия больше ' + fmtM(SPEC.slabMax) + ' м — выберите вариант несущей стены');
  const too = sp.h.concat(sp.v).filter(s => s < 1200);
  if (too.length) add('warn', 'Несущая стена слишком близко к наружной — помещение уже 1,2 м');
  const wz = p.wet ? { x0: p.wet.x, y0: p.wet.y, x1: p.wet.x + p.wet.w, y1: p.wet.y + p.wet.h } : null;
  const st = stairRect(p);
  if (st && p.bearing.some((b, i) => inter(st, walls(p, 'f1').find(w => w.id === 'B' + i)))) add('err', 'Лестница пересекает несущую стену');
  if (floorsOf(p).length > 1 && !p.stair) add('warn', 'Добавьте лестницу между этажами');
  let boilers = [];
  for (const fid of floorsOf(p)) {
    const regs = rooms(p, fid), lv = p.levels[fid], fn = floorName(fid);
    for (const r of regs) {
      const R = ROOM[r.type] || ROOM.none;
      if (R.wet && wz && !inter(r, wz)) add('warn', `${fn}: ${R.n.toLowerCase()} вне мокрой зоны — стояки не совпадут по этажам`, fid);
      if (R.min && r.area < R.min) add('warn', `${fn}: ${R.n.toLowerCase()} ${fmtA(r.area)} м² — меньше ${R.min} м²`, fid);
      if (r.type === 'boiler') boilers.push({ r, fid, regs });
    }
    // проёмы в наружных стенах
    const ws = walls(p, fid), inner = ws.filter(w => w.kind !== 'outer');
    for (const o of lv.open) {
      const w = ws.find(v => v.id === o.wall);
      if (!w) continue;
      const s0 = o.c - o.w / 2, s1 = o.c + o.w / 2;
      if (w.kind === 'outer') {
        if (s0 < t + 300 || s1 > (w.axis === 'x' ? p.W : p.D) - t - 300) add('warn', `${fn}: проём ближе 300 мм к углу дома (фасад ${sideName(w.id)})`, fid);
        const face = w.axis === 'x' ? (w.id === 'N' ? t : p.D - t) : (w.id === 'W' ? t : p.W - t);
        const hit = inner.find(v => w.axis === 'x' ? (v.axis === 'y' && v.x1 > s0 && v.x0 < s1 && v.y0 <= face + 1 && v.y1 >= face - 1)
                                                   : (v.axis === 'x' && v.y1 > s0 && v.y0 < s1 && v.x0 <= face + 1 && v.x1 >= face - 1));
        if (hit) add('err', `${fn}: ${o.kind === 'win' ? 'окно' : 'дверь'} упирается в ${hit.kind === 'bearing' ? 'несущую стену' : 'перегородку'} (фасад ${sideName(w.id)})`, fid);
      }
      if (s0 < w.a0 + 50 || s1 > w.a1 - 50) add('warn', `${fn}: проём выходит за пределы стены`, fid);
      const near = lv.open.find(q => q !== o && q.wall === o.wall && Math.abs(q.c - o.c) < (q.w + o.w) / 2 + 300);
      if (near && o.id < near.id) add('warn', `${fn}: проёмы ближе 300 мм друг к другу`, fid);
    }
  }
  if (!boilers.length) add('warn', 'Нет котельной: назначьте помещение у наружной стены на 1 этаже или в цоколе');
  for (const { r, fid, regs } of boilers) {
    const fn = floorName(fid);
    if (fid === 'f2' || fid === 'f3') add('warn', `${fn}: котельную удобнее на 1 этаже или в цоколе`, fid);
    const vol = r.area * p.hClear / 1000;
    add(vol >= BOILER.vol ? 'ok' : 'err', `Котельная: объём ${fmtA(vol)} м³ ${vol >= BOILER.vol ? '≥' : '<'} ${BOILER.vol} м³`, fid);
    if (p.hClear < BOILER.height) add('err', `Котельная: высота ${p.hClear} мм < ${BOILER.height} мм`, fid);
    if (!r.sides.size) add('err', 'Котельная должна примыкать к наружной стене (окно, приток воздуха, дымоход)', fid);
    const lv = p.levels[fid];
    let glaz = 0, door = null;
    for (const o of lv.open) {
      const rs = opRegions(p, fid, o, regs);
      if (!rs.includes(r)) continue;
      if (o.kind === 'win') { const sz = opSize(p, o); glaz += o.w * sz.h / 1e6; }
      else door = Math.max(door || 0, o.w);
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

function areas(p) {
  const per = floorsOf(p).map(fid => ({ fid, n: floorName(fid), area: rooms(p, fid).reduce((s, r) => s + r.area, 0) }));
  const T = totalT(p), ext = extT(p);
  return {
    per, total: per.reduce((s, f) => s + f.area, 0),
    outW: p.W + 2 * ext, outD: p.D + 2 * ext, // с облицовкой
    inW: p.W - 2 * ts(p), inD: p.D - 2 * ts(p), // в чистоте
    T, footprint: (p.W + 2 * ext) * (p.D + 2 * ext) / 1e6,
  };
}

/* подгонка после смены размеров и толщин */
function normalize(p) {
  const t = ts(p);
  // несущие стены — ближайший допустимый вариант
  const vs = bearingVariants(p);
  const okNow = vs.find(v => JSON.stringify(v.walls) === JSON.stringify(p.bearing));
  if (!okNow) {
    const cur = p.bearing[0];
    let best = vs.find(v => v.walls.length) || vs[0];
    if (cur) {
      const same = vs.filter(v => v.walls.length === p.bearing.length && v.walls[0].axis === cur.axis);
      if (same.length) best = same.reduce((a, b) => Math.abs(a.walls[0].pos - cur.pos) <= Math.abs(b.walls[0].pos - cur.pos) ? a : b);
      const lim = (cur.axis === 'h' ? p.D : p.W);
      const spans = spansOf(t, lim - 2 * t, p.bearing.filter(b => b.axis === cur.axis).map(b => b.pos), SPEC.bearing.t);
      if (spans.every(s => s >= SPEC.slabMin && s <= SPEC.slabMax)) best = null; // ручная подстройка в допуске
    }
    if (best) p.bearing = best.walls.map(w => Object.assign({}, w));
  }
  for (const fid of Object.keys(p.levels)) {
    const lv = p.levels[fid];
    lv.parts = lv.parts.map(w => {
      const c = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
      return Object.assign(w, { x1: c(w.x1, t, p.W - t), x2: c(w.x2, t, p.W - t), y1: c(w.y1, t, p.D - t), y2: c(w.y2, t, p.D - t) });
    }).filter(w => Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1) >= 300);
    const ws = walls(p, fid);
    lv.open = lv.open.filter(o => {
      const w = ws.find(v => v.id === o.wall);
      if (!w) return false;
      o.c = Math.max(w.a0 + o.w / 2, Math.min(o.c, w.a1 - o.w / 2));
      return w.a1 - w.a0 >= o.w;
    });
    lv.furn.forEach(f => { f.x = Math.max(0, Math.min(f.x, p.W)); f.y = Math.max(0, Math.min(f.y, p.D)); });
  }
  if (p.wet) {
    p.wet.w = Math.min(p.wet.w, p.W - 2 * t); p.wet.h = Math.min(p.wet.h, p.D - 2 * t);
    p.wet.x = Math.max(t, Math.min(p.wet.x, p.W - t - p.wet.w)); p.wet.y = Math.max(t, Math.min(p.wet.y, p.D - t - p.wet.h));
  }
  if (p.stair) {
    const r = stairRect(p);
    p.stair.x = Math.max(t, Math.min(p.stair.x, p.W - t - (r.x1 - r.x0)));
    p.stair.y = Math.max(t, Math.min(p.stair.y, p.D - t - (r.y1 - r.y0)));
  }
  return p;
}

/* стартовый проект 12 × 10 м по газобетону, два этажа */
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
             O('P3', 3900, 900, 'door'), O('P4', 6000, 800, 'door'), O('P5', 6000, 800, 'door')];
  // привязка дверей к перегородкам по порядку
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
             O(f2.parts[0].id, 1600, 700, 'door'), O(f2.parts[2].id, 6000, 800, 'door'), O(f2.parts[3].id, 6000, 800, 'door')];
  f2.furn = [F('toilet', 900, 800), F('sink', 2200, 700), F('bath', 1550, 2450), F('bed160', 4800, 1500, 0), F('desk', 9300, 900),
             F('bed160', 2200, 8400, 2), F('bed90', 9800, 8500, 2), F('wardrobe', 1500, 4500, 2)];
  return {
    v: 1, name: 'Мой дом', W: 12000, D: 10000, wallMat: 'gas', clad: 'plaster', insul: 100,
    hClear: 2800, slab: 220, floors: 2, basement: false,
    bearing: [{ axis: 'h', pos: 5000 }],
    wet: { x: 400, y: 400, w: 4600, h: 4410 },
    stair: { x: 5900, y: 5300, w: 1000, l: 3600, rot: 0 },
    roof: { type: 'gable', pitch: 30, ridge: 'long' },
    style: 'white',
    levels: { b: emptyLevel(), f1, f2, f3: emptyLevel() },
  };
}

Object.assign(DK, { SPEC, FLOORS, ROOM, BOILER, id, ts, extT, totalT, storey, floorsOf, floorName, elev, emptyLevel, opSize,
  walls, rooms, opRegions, bearingVariants, spansOf, wetVariants, checks, areas, normalize, starter, stairRect, fmtM, fmtA, sideName });
})();
