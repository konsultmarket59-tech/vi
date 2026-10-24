/* Предварительная оценка стоимости «тёплого контура»: объёмы из модели × цены материалов и работ.
   Логика по образцу сметы строительной компании: фундамент (сваи + ростверк, гидроизоляция, утепление), стены (газобетон/кирпич,
   армопояса, перемычки), перекрытия (пустотные плиты, омоноличивание), кровля (стропила, плёнки, покрытие, утепление мансарды),
   окна и входная дверь, утепление фасада. На сайте показывается только вилка; тело расчёта — в CRM, с ручной правкой.
   Цены — ориентиры осени 2026 (регион — Пермь и Урал); сметчик правит их в CRM, сайт берёт свежие с сервера. */
(function () {
'use strict';
const DK = window.DK = window.DK || {};

/* прайс по умолчанию: ключ → { n, u, m — материал за единицу, w — работа за единицу, g — раздел } */
DK.PRICES_DEFAULT = {
  // фундамент
  pile:      { g: 'Фундамент', n: 'Буронабивная свая Ø300, L 2,5 м (бетон, арматура)', u: 'шт', m: 2900, w: 2600 },
  grill:     { g: 'Фундамент', n: 'Ростверк монолитный, бетон М300 с арматурой', u: 'м³', m: 13800, w: 9500 },
  baseSlab:  { g: 'Фундамент', n: 'Цокольное перекрытие — пустотные плиты с монтажом', u: 'м²', m: 3300, w: 900 },
  waterpr:   { g: 'Фундамент', n: 'Гидроизоляция ростверка', u: 'м²', m: 420, w: 380 },
  eppsF:     { g: 'Фундамент', n: 'Утепление цоколя ЭППС 50 мм', u: 'м²', m: 520, w: 300 },
  basement:  { g: 'Фундамент', n: 'Цокольный этаж: котлован, монолитные стены, гидроизоляция', u: 'м²', m: 19000, w: 14000 },
  // стены
  gasWall:   { g: 'Стены', n: 'Газобетон D400 с клеем и армированием', u: 'м³', m: 9500, w: 5500 },
  brickWall: { g: 'Стены', n: 'Кладка из полнотелого кирпича с раствором', u: 'м³', m: 15500, w: 6800 },
  partWall:  { g: 'Стены', n: 'Перегородки в полкирпича 120 мм', u: 'м²', m: 1500, w: 1100 },
  belt:      { g: 'Стены', n: 'Армопояс монолитный', u: 'м³', m: 13500, w: 9000 },
  lintel:    { g: 'Стены', n: 'Перемычки над проёмами (U-блоки, уголок)', u: 'шт', m: 2400, w: 1500 },
  cladBrick: { g: 'Стены', n: 'Облицовочный кирпич с кладкой', u: 'м²', m: 2600, w: 2100 },
  // перекрытия
  slab:      { g: 'Перекрытия', n: 'Пустотные плиты ПК 220 мм с доставкой и монтажом краном', u: 'м²', m: 3800, w: 1100 },
  slabJoint: { g: 'Перекрытия', n: 'Омоноличивание швов, анкеровка', u: 'м²', m: 160, w: 190 },
  stairHole: { g: 'Перекрытия', n: 'Обрамление проёма под лестницу, монолитный участок', u: 'шт', m: 22000, w: 18000 },
  // кровля
  rafters:   { g: 'Кровля', n: 'Стропильная система, мауэрлат, огнебиозащита', u: 'м²', m: 1150, w: 950 },
  membrane:  { g: 'Кровля', n: 'Гидроветрозащита, обрешётка, контробрешётка', u: 'м²', m: 380, w: 260 },
  roofMetal: { g: 'Кровля', n: 'Металлочерепица с доборами и водостоком', u: 'м²', m: 1050, w: 850 },
  roofSoft:  { g: 'Кровля', n: 'Гибкая черепица с ОСП и подкладочным ковром', u: 'м²', m: 2050, w: 1150 },
  roofFalz:  { g: 'Кровля', n: 'Фальцевая кровля с доборами и водостоком', u: 'м²', m: 1600, w: 1300 },
  roofFlat:  { g: 'Кровля', n: 'Плоская кровля: уклонообразующий слой, утепление, мембрана', u: 'м²', m: 3200, w: 1500 },
  roofInsul: { g: 'Кровля', n: 'Утепление мансарды 200 мм с пароизоляцией', u: 'м²', m: 980, w: 650 },
  atticIns:  { g: 'Кровля', n: 'Утепление чердачного перекрытия 200 мм', u: 'м²', m: 820, w: 350 },
  // окна, двери
  window:    { g: 'Окна и двери', n: 'Окна ПВХ, двухкамерный стеклопакет, с монтажом', u: 'м²', m: 14500, w: 3000 },
  windowPano:{ g: 'Окна и двери', n: 'Панорамное остекление, тёплый профиль', u: 'м²', m: 21000, w: 3500 },
  doorEntry: { g: 'Окна и двери', n: 'Входная утеплённая дверь с монтажом', u: 'шт', m: 62000, w: 9000 },
  // утепление
  facadeIns: { g: 'Утепление фасада', n: 'Минвата фасадная (за 100 мм) с крепежом', u: 'м²', m: 780, w: 650 },
  // пристройки, благоустройство дома
  garage:    { g: 'Пристройки', n: 'Гараж в тёплом контуре (фундамент, стены, кровля, ворота)', u: 'м²', m: 23000, w: 15000 },
  carport:   { g: 'Пристройки', n: 'Навес на стойках с кровлей и площадкой', u: 'м²', m: 7500, w: 4500 },
  terrace:   { g: 'Пристройки', n: 'Терраса: сваи, каркас, настил', u: 'м²', m: 8200, w: 6200 },
  terraceRoof:{ g: 'Пристройки', n: 'Навес террасы на колоннах', u: 'м²', m: 7000, w: 5000 },
  terraceGl: { g: 'Пристройки', n: 'Остекление террасы алюминиевым профилем', u: 'м²', m: 14000, w: 4000 },
  balcony:   { g: 'Пристройки', n: 'Балконная плита с терморазрывом и ограждением', u: 'м²', m: 17000, w: 11000 },
  blind:     { g: 'Пристройки', n: 'Утеплённая отмостка', u: 'м²', m: 1700, w: 1300 },
  // накладные
  logistics: { g: 'Накладные', n: 'Доставка, спецтехника, бытовка, геодезия', u: '%', m: 8, w: 0 },
  siteWork:  { g: 'Накладные', n: 'Леса, временные сети, вывоз мусора', u: '%', m: 0, w: 4 },
  margin:    { g: 'Накладные', n: 'Организация работ и прибыль подрядчика', u: '%', m: 0, w: 20 },
};
DK.PRICES = JSON.parse(JSON.stringify(DK.PRICES_DEFAULT));
/* класс отделки и комплектации (из анкеты): множитель к окнам, кровле и дверям */
DK.EST_CLASS = { eco: { n: 'Эконом', k: 0.92 }, comfort: { n: 'Комфорт', k: 1 }, premium: { n: 'Дороже', k: 1.18 } };

/* свежие цены с сервера (их правит сметчик) */
DK.loadPrices = async function () {
  if (location.protocol === 'file:') return;
  try { const r = await fetch((DK.CONFIG.api || '') + '/api/prices'); if (r.ok) { const j = await r.json(); if (j && j.prices) Object.keys(j.prices).forEach(k => { if (DK.PRICES[k]) Object.assign(DK.PRICES[k], j.prices[k]); }); } } catch (e) { /* остаются цены по умолчанию */ }
};

const len = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
function perimeter(pts) { let s = 0; for (let i = 0; i < pts.length; i++) s += len(pts[i], pts[(i + 1) % pts.length]); return s; }

/* объёмы работ по модели: [{ k — ключ прайса, q — количество, note }] */
DK.estimateQty = function (p) {
  const fl = DK.floorsOf(p).filter(f => f !== 'b'), A = DK.areas(p), out = [];
  const add = (k, q, note) => { if (q > 0.001) out.push({ k, q: Math.round(q * 100) / 100, note }); };
  const t = DK.ts(p) / 1000, H = DK.storey(p) / 1000, hc = p.hClear / 1000;
  const axis = DK.outline(p, -DK.ts(p) / 2), P = perimeter(axis) / 1000;           // периметр по оси стены (со срезами углов)
  const foot = Math.abs(DK.polyArea(DK.outline(p, 0))) / 1e6, inner = Math.abs(DK.polyArea(DK.outline(p, -DK.ts(p)))) / 1e6;
  const bearingL = (DK.walls(p, 'f1').filter(w => w.kind === 'bearing').reduce((s, w) => s + (w.a1 - w.a0), 0)) / 1000;
  const attic = !!p.attic && fl.length > 1, top = fl[fl.length - 1];
  // фундамент: ростверк под наружными и несущими стенами, сваи через 1,5 м
  const grillL = P + bearingL;
  add('pile', Math.ceil(grillL / 1.5) + p.poly.length, `ростверк ${DK.fmtM(grillL * 1000)} м, шаг 1,5 м + углы`);
  add('grill', grillL * 0.4 * 0.6, 'сечение 400 × 600 мм');
  if (p.basement) add('basement', foot, 'площадь цокольного этажа');
  else add('baseSlab', inner, 'по площади первого этажа');
  add('waterpr', P * 0.9, 'наружная и внутренняя грань');
  add('eppsF', P * 0.6, 'высота 0,6 м');
  // стены: площадь наружных стен за вычетом проёмов, по этажам; у мансарды — колено 1,2 м
  let outerA = 0, openA = 0, winA = 0, panoA = 0, lintels = 0, doors = 0;
  for (const f of fl) {
    const h = attic && f === top ? 1.2 : H;
    outerA += P * h;
    for (const o of p.levels[f].open) {
      const w = DK.walls(p, f).find(v => v.id === o.wall); if (!w) continue;
      const oh = (o.kind === 'win' ? (o.pano ? hc * 1000 - (o.sill || 0) : (o.h || 1500)) : (o.h || 2100)) / 1000, ow = o.w / 1000;
      if (w.kind === 'outer') { openA += ow * oh; if (o.kind === 'win') { if (o.pano) panoA += ow * oh; else winA += ow * oh; } if (o.kind === 'entry') doors++; if (o.kind === 'door') winA += ow * oh; }
      if (o.kind !== 'win' || w.kind === 'outer') lintels++;
    }
  }
  // фронтоны двускатной кровли — кладка из того же материала
  const M = DK.mainRect(p), mw = (M.x1 - M.x0) / 1000, md = (M.y1 - M.y0) / 1000, ridgeX = (p.roof.ridge === 'short') === (mw >= md);
  const span = ridgeX ? mw : md, rise = span / 2 * Math.tan((p.roof.pitch || 30) * Math.PI / 180);
  const gables = p.roof.type === 'gable' || p.roof.type === 'mansard' ? 2 * span * rise / 2 * (attic ? 1 : 0.6) : p.roof.type === 'halfhip' ? span * rise * 0.5 : p.roof.type === 'shed' ? span * rise : 0;
  const wallA = Math.max(0, outerA + gables - openA);
  add(p.wallMat === 'brick' ? 'brickWall' : 'gasWall', wallA * t, `${DK.fmtA(wallA)} м² × ${Math.round(t * 1000)} мм, фронтоны`);
  if (bearingL) add('brickWall', bearingL * hc * DK.SPEC.bearing.t / 1000 * fl.length, `несущая стена ${DK.fmtM(bearingL * 1000)} м × ${fl.length} эт.`);
  let partL = 0; fl.forEach(f => p.levels[f].parts.filter(w => !w.rail).forEach(w => { partL += Math.hypot(w.x2 - w.x1, w.y2 - w.y1) / 1000; }));   // косые — по длине
  add('partWall', partL * hc, `перегородки ${DK.fmtM(partL * 1000)} м`);
  add('belt', (P + bearingL) * 0.25 * 0.2 * fl.length, 'по каждому этажу');
  add('lintel', lintels, 'окна и двери');
  if (p.clad === 'brick') add('cladBrick', wallA, 'облицовка');
  // перекрытия
  const slabFloors = fl.length - 1 + (attic || p.roof.type === 'flat' ? 0 : 1);
  const hole = p.stair && fl.length > 1 ? (() => { const r = DK.stairRect(p); return (r.x1 - r.x0) * (r.y1 - r.y0) / 1e6; })() : 0;
  add('slab', inner * slabFloors - hole * (fl.length - 1), `${slabFloors} перекрытия по ${DK.fmtA(inner)} м²`);
  add('slabJoint', inner * slabFloors, '');
  if (hole) add('stairHole', fl.length - 1, '');
  // кровля: площадь ската по габариту с карнизом 0,5 м
  const ov = 0.5, roofPlan = (A.outW / 1000 + 2 * ov) * (A.outD / 1000 + 2 * ov) * (foot / ((p.W / 1000) * (p.D / 1000)));
  const pitch = (p.roof.pitch || 30) * Math.PI / 180, roofA = p.roof.type === 'flat' ? roofPlan : roofPlan / Math.cos(pitch) * (p.roof.type === 'mansard' ? 1.15 : 1);
  if (p.roof.type === 'flat') add('roofFlat', roofPlan, 'по площади кровли');
  else {
    add('rafters', roofA, `${DK.fmtA(roofA)} м², уклон ${p.roof.pitch}°`);
    add('membrane', roofA, '');
    const F = DK.facadeOf ? DK.facadeOf(p) : null, rm = F && F.roof ? F.roof.m : 'mtile';
    add(rm === 'shingle' ? 'roofSoft' : rm === 'falz' ? 'roofFalz' : 'roofMetal', roofA, '');
    if (attic) add('roofInsul', roofA * 0.85, 'мансарда — утеплённые скаты');
    else add('atticIns', inner, 'холодный чердак');
  }
  // окна и двери
  add('window', winA, 'обычные окна и балконные двери');
  add('windowPano', panoA, 'панорамные');
  add('doorEntry', Math.max(1, doors), '');
  if (p.insul) add('facadeIns', wallA * p.insul / 100, `${p.insul} мм`);
  // пристройки
  for (const x of p.ext || []) {
    const a = x.w * x.d / 1e6;
    if (x.kind === 'garage') add(x.gtype === 'carport' ? 'carport' : 'garage', a, DK.garageName(x));
    else if (x.kind === 'balcony') add('balcony', a, 'балкон');
    else { add('terrace', a, DK.EXT[x.kind].n); if ((x.roof || 'open') !== 'open') add('terraceRoof', a, 'навес'); if (x.roof === 'glazed') add('terraceGl', (x.w + 2 * x.d) / 1000 * 2.4, 'остекление'); }
  }
  if (p.blind) add('blind', perimeter(DK.outline(p, DK.extT(p) + p.blind / 2)) / 1000 * p.blind / 1000, `ширина ${DK.fmtM(p.blind)} м`);
  return out;
};

/* расчёт: строки с суммами, разделы, итог и вилка. ov — ручные правки { ключ: { q, m, w } }, cls — класс */
DK.estimate = function (p, opt) {
  opt = opt || {};
  const P = opt.prices || DK.PRICES, ov = opt.ov || {}, kc = (DK.EST_CLASS[opt.cls] || DK.EST_CLASS.comfort).k;
  const premiumKeys = { window: 1, windowPano: 1, doorEntry: 1, roofMetal: 1, roofSoft: 1, roofFalz: 1, facadeIns: 1 };
  const rows = DK.estimateQty(p).map((r, i) => {
    const pr = P[r.k] || { n: r.k, u: '', m: 0, w: 0, g: 'Прочее' }, o = ov[r.k + ':' + i] || ov[r.k] || {};
    const k = premiumKeys[r.k] ? kc : 1;
    const q = o.q != null ? o.q : r.q, m = o.m != null ? o.m : Math.round(pr.m * k), w = o.w != null ? o.w : Math.round(pr.w * k);
    return { id: r.k + ':' + i, k: r.k, g: pr.g, n: pr.n, u: pr.u, note: r.note, q, m, w, sm: q * m, sw: q * w, auto: o.q == null && o.m == null && o.w == null };
  });
  const base = rows.reduce((s, r) => s + r.sm + r.sw, 0), mat = rows.reduce((s, r) => s + r.sm, 0);
  const pct = (k, f, d) => (ov[k] && ov[k][f] != null ? ov[k][f] : (P[k] || {})[f] != null ? P[k][f] : d) / 100;
  const logi = pct('logistics', 'm', 8) * mat, site = pct('siteWork', 'w', 4) * base;
  const marg = pct('margin', 'w', 20) * (base + logi + site);
  const total = base + logi + site + marg;
  const groups = {};
  rows.forEach(r => { groups[r.g] = (groups[r.g] || 0) + r.sm + r.sw; });
  const area = DK.areas(p).total + DK.areas(p).loggia * 0.5;
  // вилка: −8 % … +12 % — разброс цен подрядчиков и неучтённое до геологии
  return { rows, groups, mat, base, logi, site, marg, total, min: total * 0.92, max: total * 1.12, area, perM2: area ? total / area : 0 };
};
/* строка вилки для экрана */
DK.estimateText = function (p, cls) {
  const e = DK.estimate(p, { cls }), mln = (v) => (Math.round(v / 1e5) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1 });
  return { e, range: `${mln(e.min)}–${mln(e.max)} млн ₽`, perM2: `≈ ${Math.round(e.min / e.area / 1000)}–${Math.round(e.max / e.area / 1000)} тыс. ₽/м²` };
};
})();
