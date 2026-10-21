/* ---------- вкладка «Узлы»: 3D-пироги конструкций по проектам ----------
   Слои стопки: n — название, t — толщина, мм (0 — плёнка), m — материал (см. NMAT), a — толщина в проекте
   не указана, принята типовая; bars — бруски/доски {w — ширина, step — шаг, dir: 'u' вдоль длины, 'w' поперёк,
   m — материал брусков, n — их подпись}; pipes — трубы в слое {d, step, n}; mesh — сетка арматуры {d, step}.
   Стопка строится сверху вниз (у стены — снаружи внутрь), каждый следующий слой длиннее на шаг — так видно все слои. */
const WALL60 = [
  { n: 'Виниловый сайдинг ТЕХНОНИКОЛЬ', t: 12, m: 'siding' },
  { n: 'Контробрешётка с шагом 400 мм — вентзазор', t: 40, m: 'gap', a: 1, air: 'w', bars: { w: 50, step: 400, dir: 'w', m: 'wood' } },
  { n: 'Плёнка ТЕХНОНИКОЛЬ АЛЬФА ВЕНТ ТПУ', t: 0, m: 'membrane' },
  { n: 'Плиты из каменной ваты ТЕХНОБЛОК СТАНДАРТ', t: 100, m: 'wool', a: 1 },
  { n: 'Несущая стена — блоки Твинблок ТБ300-4п', t: 300, m: 'aerated' },
  { n: 'Затирка декоративной штукатурки', t: 10, m: 'plaster', a: 1 },
  { n: 'Стеклообои с окраской водоэмульсионными составами', t: 1, m: 'paint' },
];
const ROOF_TILE = [
  { n: 'Кровля — металлочерепица «Каскад»', t: 0.5, m: 'mtile' },
  { n: 'Вентиляционный зазор', t: 0, m: 'gap' },
  { n: 'Разреженная обрешётка 30×150 с шагом 250 мм', t: 30, m: 'gap', bars: { w: 150, step: 250, dir: 'w', m: 'woodfr' } },
  { n: 'Контробрешётка 50×50 с шагом 600 мм — вентзазор', t: 50, m: 'gap', air: 'u', bars: { w: 50, step: 600, dir: 'u', m: 'woodfr' } },
  { n: 'Стропильная нога — 2 спаренные доски 50×200', t: 200, m: 'gap', bars: { w: 100, step: 600, dir: 'u', m: 'woodfr' } },
];
const CEIL60 = [
  { n: 'Черновой пол — доска 30×150', t: 30, m: 'gap', bars: { w: 150, step: 160, dir: 'w', m: 'wood' } },
  { n: 'Мембрана супердиффузионная ТЕХНОНИКОЛЬ', t: 0, m: 'membrane' },
  { n: 'Теплоизоляционные плиты ROCKWOOL Лайт Баттс — 200 мм', t: 200, m: 'wool', bars: { w: 100, step: 600, dir: 'u', m: 'wood', n: 'Ригель — доска 100×200 с шагом 600 мм' } },
  { n: 'Пароизоляционная плёнка ТЕХНОНИКОЛЬ', t: 0, m: 'vapour' },
  { n: 'Черновой пол — доска 50×150', t: 50, m: 'gap', bars: { w: 150, step: 400, dir: 'w', m: 'wood' } },
  { n: 'Подшив', t: 12, m: 'plaster', a: 1 },
];
const FLOOR60 = [
  { n: 'Напольное покрытие: ламинат, линолеум, ковролин', t: 10, m: 'laminate', a: 1 },
  { n: 'Цементно-песчаная стяжка 4–5 см, максимум 8 см', t: 50, m: 'screed', pipes: { d: 20, step: 200, n: 'Водяной тёплый пол — труба XL PIPE Ø20 мм' } },
  { n: 'Железобетонная плита 120 мм, бетон B25 W6 F75, сетка А-III Ø12 400×400', t: 120, m: 'concrete', mesh: { d: 12, step: 400 } },
  { n: 'Дренажная профилированная мембрана Planter', t: 8, m: 'planter' },
  { n: 'Теплоизоляция ТЕХНОНИКОЛЬ XPS 30-250 СТАНДАРТ — 50 мм', t: 50, m: 'xps' },
  { n: 'Песчано-гравийное основание — мин. 250 (300) мм', t: 300, m: 'gravel' },
  { n: 'Геотекстиль термообработанный ТЕХНОНИКОЛЬ, 300 г/м²', t: 2.3, m: 'geotex' },
  { n: 'Основание — грунт уплотнённый', t: 200, m: 'soil' },
];
const OTM_TYPE = [
  { n: 'Бетонная отмостка', t: 80, m: 'concrete', a: 1 },
  { n: 'Утепление отмостки — ТЕХНОНИКОЛЬ XPS 30-250 СТАНДАРТ', t: 50, m: 'xps', a: 1 },
  { n: 'Песчаная подготовка', t: 150, m: 'sand', a: 1 },
  { n: 'Геотекстиль ТЕХНОНИКОЛЬ, 300 г/м²', t: 2.3, m: 'geotex' },
  { n: 'Грунт уплотнённый', t: 200, m: 'soil' },
];
const WALL510 = [
  { n: 'Облицовочный кирпич', t: 120, m: 'brick' },
  { n: 'Вентилируемый зазор', t: 20, m: 'gap', a: 1, air: 'w' },
  { n: 'Утеплитель — плиты из каменной ваты', t: 50, m: 'wool', a: 1 },
  { n: 'Газобетонный блок', t: 300, m: 'aerated', a: 1 },
  { n: 'Штукатурка', t: 20, m: 'plaster', a: 1 },
];
const WALL_SIDING = [
  { n: 'Виниловый сайдинг', t: 12, m: 'siding' },
  { n: 'Металлическая обрешётка: вертикальные и горизонтальные профили, вентзазор', t: 40, m: 'gap', air: 'w', frame: { step: 600, hstep: 500, w: 60 } },
  { n: 'Гидро-ветрозащита Ондутис', t: 0, m: 'ondutis' },
  { n: 'Утеплитель Эковер Лайт Вент Фасад', t: 50, m: 'wool' },
  { n: 'Газобетон Твинблок D400', t: 300, m: 'aerated' },
  { n: 'Внутренняя штукатурка', t: 10, m: 'plaster', a: 1 },
];
const WALL_PLASTER = [
  { n: 'Декоративная штукатурка', t: 5, m: 'dplaster', a: 1 },
  { n: 'Армирующая сетка', t: 1, m: 'fmesh' },
  { n: 'Выравнивающий клеевой слой', t: 5, m: 'glue', a: 1 },
  { n: 'Газобетон Твинблок D400', t: 400, m: 'aerated' },
  { n: 'Внутренняя штукатурка', t: 10, m: 'plaster', a: 1 },
];
const SLATE_FLOOR85 = [
  { n: 'Напольное покрытие', t: 20, m: 'laminate' },
  { n: 'Бетон B25 F200 W6', t: 120, m: 'concrete', mesh: { d: 12, step: 200 } },
  { n: 'ЭППС', t: 100, m: 'xps' },
  { n: 'Профилированная мембрана PLANTER Geo', t: 8, m: 'planter' },
  { n: 'Песок', t: 380, m: 'sand' },
  { n: 'Геотекстиль термообработанный ТЕХНОНИКОЛЬ, 300 г/м²', t: 2.3, m: 'geotex' },
  { n: 'Основание — грунт уплотнённый', t: 200, m: 'soil' },
];
const SLATE_FLOOR100 = [
  { n: 'Напольное покрытие', t: 20, m: 'laminate' },
  { n: 'Цементно-песчаная стяжка с нагревательными элементами', t: 40, m: 'screed', a: 1, pipes: { d: 8, step: 120, n: 'Нагревательный кабель тёплого пола' } },
  { n: 'Бетон B25 F200 W6', t: 100, m: 'concrete', mesh: { d: 12, step: 200 } },
  { n: 'ЭППС', t: 100, m: 'xps' },
  { n: 'Профилированная мембрана PLANTER Geo', t: 8, m: 'planter' },
  { n: 'Песок', t: 350, m: 'sand' },
  { n: 'Геотекстиль термообработанный ТЕХНОНИКОЛЬ, 300 г/м²', t: 2.3, m: 'geotex' },
  { n: 'Основание — грунт уплотнённый', t: 200, m: 'soil' },
];
const SLATE_OTM = [
  { n: 'Отмостка — бетонная плитка', t: 60, m: 'paver', a: 1 },
  { n: 'Утепление отмостки — ЭППС', t: 100, m: 'xps' },
  { n: 'Профилированная мембрана PLANTER Standard', t: 8, m: 'planter' },
  { n: 'Песок', t: 150, m: 'sand', a: 1 },
  { n: 'Геотекстиль термообработанный ТЕХНОНИКОЛЬ, 300 г/м²', t: 2.3, m: 'geotex' },
  { n: 'Грунт уплотнённый', t: 200, m: 'soil' },
];
const slateWall = (cladding) => [
  cladding,
  // под вертикальный планкен обрешётка горизонтальная, под фальц-панели — вертикальная
  { n: 'Деревянная обрешётка — вентзазор', t: 50, m: 'gap', air: 'w', bars: { w: 50, step: 600, dir: cladding.bars && cladding.bars.dir === 'w' ? 'u' : 'w', m: 'wood' } },
  { n: 'Супердиффузионная мембрана', t: 0, m: 'membrane' },
  { n: 'Газобетонные блоки D400, B3.5 — 400 мм', t: 400, m: 'aerated' },
];
const slateRoof = (osb) => [
  { n: 'Фальцевая кровля Falz Lock 0,5 мм', t: 0.5, m: 'falz' },
  { n: 'Плёнка ТЕХНОНИКОЛЬ АЛЬФА ТОП', t: 0, m: 'membrane' },
  ...(osb ? [{ n: 'OSB', t: 12, m: 'osb' }] : []),
  { n: 'Обрешётка — вентзазор', t: 45, m: 'gap', air: 'u', bars: { w: 100, step: 300, dir: 'w', m: 'woodfr' } },
  { n: 'Стропильная система — фермы (раздел КД)', t: 150, m: 'gap', a: 1, bars: { w: 50, step: 600, dir: 'u', m: 'woodfr' } },
];
const NODESETS = [
  {
    id: 'dom60', n: 'Дом 60 м²', src: 'Проект «Дом 60», разрезы 1-1 и 2-2', plans: ['p60', 'p58'],
    nodes: [
      { id: 'wall', n: 'Стена', type: 'wall', layers: WALL60 },
      { id: 'roof', n: 'Кровля', type: 'roof', pitch: 22, layers: ROOF_TILE },
      { id: 'ceil', n: 'Перекрытие', type: 'slab', layers: CEIL60 },
      { id: 'floor', n: 'Пол по грунту', type: 'slab', layers: FLOOR60 },
      { id: 'fnd', n: 'Фундамент и цоколь', type: 'fnd', wall: WALL60, floor: FLOOR60, rib: { w: 400, d: 310 }, xpsV: 100, ground: -650, otm: OTM_TYPE, otmW: 900 },
      { id: 'otm', n: 'Отмостка', type: 'slab', layers: OTM_TYPE },
    ],
  },
  {
    id: 'kirp', n: 'Дома 85, 100, 120 м²', src: 'Проекты «85/100/120 м², газобетон, кирпич 510»: разрезы фундамента, ступени и отмостка',
    plans: ['p85', 'p100', 'p120', 'p68'],
    note: 'Стена — 510 мм по проекту, разбивка по слоям принята типовая. Кровля и перекрытие на листах не расписаны — как в проекте дома 60.',
    nodes: [
      { id: 'wall', n: 'Стена — кирпич', type: 'wall', layers: WALL510 },
      { id: 'wallS', n: 'Стена — сайдинг', type: 'wall', layers: WALL_SIDING },
      { id: 'wallP', n: 'Стена — штукатурка', type: 'wall', layers: WALL_PLASTER },
      { id: 'roof', n: 'Кровля', type: 'roof', pitch: 22, layers: ROOF_TILE.map((l) => ({ ...l, a: 1 })) },
      { id: 'ceil', n: 'Перекрытие', type: 'slab', layers: CEIL60.map((l) => ({ ...l, a: 1 })) },
      { id: 'floor', n: 'Пол по грунту', type: 'slab', layers: FLOOR60 },
      { id: 'fnd', n: 'Фундамент и цоколь', type: 'fnd', wall: WALL510, floor: FLOOR60, rib: { w: 510, d: 300 }, xpsV: 100, ground: -650, otm: OTM_TYPE, otmW: 900 },
      { id: 'otm', n: 'Отмостка', type: 'slab', layers: OTM_TYPE },
    ],
  },
  {
    id: 'slate85', n: 'SLATE 85', src: 'SLATE 85 (IT-arc): разрезы 1-1, 4-4, 5-5, 6-6', plans: ['slate85-1', 'slate85-2'],
    nodes: [
      { id: 'wall', n: 'Стена', type: 'wall', layers: slateWall({ n: 'Планкен из лиственницы 20 мм, вертикально, модуль 90-120-90-90-120-140, зазор 3–5 мм', t: 20, m: 'gap', bars: { ws: [90, 120, 90, 90, 120, 140], gap: 4, dir: 'w', m: 'planken' } }) },
      { id: 'roof', n: 'Кровля', type: 'roof', pitch: 20, layers: slateRoof(false) },
      { id: 'floor', n: 'Пол по грунту (УШП)', type: 'slab', layers: SLATE_FLOOR85 },
      { id: 'fnd', n: 'Фундамент и цоколь', type: 'fnd', wall: slateWall({ n: 'Планкен из лиственницы 20 мм, вертикально', t: 20, m: 'gap', bars: { ws: [90, 120, 90, 90, 120, 140], gap: 4, dir: 'w', m: 'planken' } }), floor: SLATE_FLOOR85, rib: { w: 570, d: 280 }, xpsV: 0, ground: -150, otm: SLATE_OTM, otmW: 1430, drain: true },
      { id: 'otm', n: 'Отмостка', type: 'slab', layers: SLATE_OTM },
    ],
  },
  {
    id: 'slate100', n: 'SLATE 100', src: 'SLATE 100 (IT-arc): разрезы 5-5, 6-6', plans: ['slate100-1', 'slate100-2', 'slate100-3', 'slate100-4', 'slate100-5', 'dom100-1', 'dom100-2', 'dom100-3'],
    nodes: [
      { id: 'wall', n: 'Стена (фальц-панели)', type: 'wall', layers: slateWall({ n: 'Фальцевые панели (графит)', t: 13, m: 'falzwall' }) },
      { id: 'wall2', n: 'Стена (планкен)', type: 'wall', layers: slateWall({ n: 'Планкен из лиственницы 20 мм, вертикально, модуль 90-120-90-90-120-140, зазор 10 мм', t: 20, m: 'gap', bars: { ws: [90, 120, 90, 90, 120, 140], gap: 10, dir: 'w', m: 'planken' } }) },
      { id: 'roof', n: 'Кровля', type: 'roof', pitch: 20, layers: slateRoof(true) },
      { id: 'floor', n: 'Пол по грунту (УШП)', type: 'slab', layers: SLATE_FLOOR100 },
      { id: 'fnd', n: 'Фундамент и цоколь', type: 'fnd', wall: slateWall({ n: 'Фальцевые панели (графит)', t: 13, m: 'falzwall' }), floor: SLATE_FLOOR100, rib: { w: 570, d: 280 }, xpsV: 0, ground: -150, otm: SLATE_OTM, otmW: 1430, drain: true },
      { id: 'otm', n: 'Отмостка', type: 'slab', layers: SLATE_OTM },
    ],
  },
];

/* материалы узлов: цвет, текстура (рисуется на холсте), размер текстуры в метрах */
const NMAT = {
  brick: { c: '#b2583d', tex: 'brick', ts: { f: [.52, .15], su: [.15, 2], sw: [.52, 2] } },
  concrete: { c: '#a8a7a3', tex: 'speckle', ts: .4 }, screed: { c: '#c9c6bf', tex: 'speckle', ts: .5 },
  xps: { c: '#a9c9e6', tex: 'xps', ts: .6 }, wool: { c: '#d8bf72', tex: 'wool', ts: .4 },
  membrane: { c: '#eef1f6', tex: 'membrane', ts: .6 }, vapour: { c: '#bcd9ea', op: .82 },
  planter: { c: '#2f3135', tex: 'dimple', ts: .12 }, sand: { c: '#e1cb93', tex: 'speckle', ts: .25 },
  gravel: { c: '#bcb4a5', tex: 'gravel', ts: .3 }, geotex: { c: '#f3f2ee', tex: 'felt', ts: .3 },
  soil: { c: '#83654a', tex: 'speckle', ts: .5 }, wood: { c: '#c9975e', tex: 'grain', ts: .6 }, woodfr: { c: '#d89a8f', tex: 'grain', ts: .6 },
  osb: { c: '#c9a46a', tex: 'osb', ts: .3 }, laminate: { c: '#cfa576', tex: 'planks', ts: 1.2 },
  plaster: { c: '#f2f0eb', tex: 'speckle', ts: .3, soft: 1 }, paint: { c: '#f8f6f2' },
  siding: { c: '#e3dfd4', tex: 'siding', ts: .4 }, planken: { c: '#a8693d', tex: 'grain', ts: .6 },
  falz: { c: '#3b3f45', m: .55, r: .38 }, falzwall: { c: '#454a51', m: .35, r: .45, tex: 'seams', ts: .54 }, mtile: { c: '#6a2b25', m: .35, r: .42 },
  paver: { c: '#9d9a94', tex: 'paver', ts: .6 },
  aerated: { c: '#e7e5e0', tex: 'aerated', ts: { f: [1.2, .5], su: [.5, 2], sw: [1.2, 2] } }, ondutis: { c: '#f6f6f4', tex: 'ondutis', ts: .9 },
  metal: { c: '#dfe3e7', m: .15, r: .35 }, glue: { c: '#8f8c87', tex: 'comb', ts: .3 }, fmesh: { c: '#e9eef2', tex: 'mesh', ts: .15 },
  dplaster: { c: '#f3efe6', tex: 'rough', ts: .4 }, pipe: { c: '#e5532f', r: .5 }, rebar: { c: '#6d6052', m: .6, r: .5 },
};
const NODE_DEF = { nair: true, nset: '', nnode: 'wall', labels: true, nlabelColor: '#261A7E', naz: .75, nel: .5, tab: 'plan' };

let N = null;
const nsets = () => NODESETS;
const curSet = () => nsets().find((s) => s.id === S.nset) || nsets()[0];
const curNode = () => { const s = curSet(); return s.nodes.find((n) => n.id === S.nnode) || s.nodes[0]; };
for (const [k, v] of Object.entries(NODE_DEF)) if (S[k] === undefined) S[k] = v;

/* текстуры: v — вариант грани: 'f' — лицевая (поперёк толщины), 'su' и 'sw' — срезы.
   На срезах по горизонтали текстуры — вдоль среза, по вертикали — толщина слоя. rot — повернуть рисунок на 90°. */
function nodeTex(kind, base, v = 'f', rot = false) {
  const key = [kind, base, v, rot].join('|'); if (N.texs.has(key)) return N.texs.get(key);
  let cv = document.createElement('canvas'); cv.width = cv.height = 256; let c = cv.getContext('2d');
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const col = new THREE.Color(base), rgb = (k, a = 1) => `rgba(${Math.min(255, col.r * 255 * k) | 0},${Math.min(255, col.g * 255 * k) | 0},${Math.min(255, col.b * 255 * k) | 0},${a})`;
  c.fillStyle = base; c.fillRect(0, 0, 256, 256);
  const dots = (n, r1, r2, k1, k2, a = 1) => { for (let i = 0; i < n; i++) { c.fillStyle = rgb(k1 + rnd() * (k2 - k1), a); c.beginPath(); c.arc(rnd() * 256, rnd() * 256, r1 + rnd() * (r2 - r1), 0, 7); c.fill(); } };
  const vline = (x, w, k) => { c.fillStyle = rgb(k); c.fillRect(x, 0, w, 256); }, hline = (y, w, k) => { c.fillStyle = rgb(k); c.fillRect(0, y, 256, w); };
  const fibers = (along) => { for (let i = 0; i < 1500; i++) { c.strokeStyle = rgb(.68 + rnd() * .45, .55); c.lineWidth = .6 + rnd(); const x = rnd() * 256, y = rnd() * 256, l = 8 + rnd() * 22, a = along ? (rnd() - .5) * .35 : (rnd() - .5) * 3; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); } };
  const grain = () => { for (let y = 0; y < 256; y += 3) { c.strokeStyle = rgb(.8 + rnd() * .3, .5); c.lineWidth = 1 + rnd() * 1.5; c.beginPath(); c.moveTo(0, y); for (let x = 0; x <= 256; x += 32) c.lineTo(x, y + Math.sin(x / 40 + y) * 2); c.stroke(); } };
  const endgrain = () => { for (let r = 300; r > 4; r -= 7 + rnd() * 5) { c.strokeStyle = rgb(.78 + rnd() * .15, .6); c.lineWidth = 1.5; c.beginPath(); c.arc(-40, 300, r, 0, 7); c.stroke(); } };
  switch (kind) {
    case 'aerated': // блок 600×250; лицо — плитка 1,2 × 0,5 м (2 ряда), торец — 0,5 м по высоте, верх — 1,2 м по длине
      dots(900, .5, 1.4, .78, .92);
      if (v === 'f') for (let r = 0; r < 2; r++) { hline(r * 128, 2, .78); for (const x of [0, 128]) { c.fillStyle = rgb(.78); c.fillRect((x + r * 64) % 256, r * 128, 2, 128); } }
      else for (const x of [0, 128]) vline(x, 2, .78);
      break;
    case 'brick': { // кирпич 250×65, шов 10: лицо — 520 × 150 мм (2 ряда), торец — 150 мм по высоте, верх — 520 мм по длине
      c.fillStyle = '#d6d0c4'; c.fillRect(0, 0, 256, 256);
      const jx = 5, jy = 17, b = (x, y, w, h) => { c.fillStyle = rgb(.86 + rnd() * .26); c.fillRect(x, y, w, h); };
      if (v === 'f') { for (let r = 0; r < 2; r++) for (let i = -1; i < 2; i++) b(i * 128 + r * 64 + jx / 2, r * 128 + jy / 2, 128 - jx, 128 - jy); }
      else if (v === 'su') { for (let r = 0; r < 2; r++) b(r * 128 + jy / 2, 0, 128 - jy, 256); }   // торец: ряды кладки, кирпич во всю толщину
      else { for (let i = 0; i < 2; i++) b(i * 128 + jx / 2, 0, 128 - jx, 256); }                   // верх: ложки во всю толщину
      dots(500, .4, 1, .85, 1.1, .45); break;
    }
    case 'speckle': dots(1600, .4, 1.4, .75, 1.2); break;
    case 'xps': if (v === 'f') { for (let i = 0; i < 256; i += 16) vline(i, 1, .9); } else dots(900, .5, 1.2, .9, 1.08); break;
    case 'wool': fibers(v !== 'f'); break;
    case 'membrane': if (v === 'f') { c.fillStyle = 'rgba(70,110,190,.35)'; c.font = 'bold 15px Arial'; for (let y = 20; y < 256; y += 42) { c.fillText('ТЕХНОНИКОЛЬ', ((y / 42) % 2) * 60 - 30, y); c.fillText('ТЕХНОНИКОЛЬ', 150 + ((y / 42) % 2) * 60 - 30, y); } } break;
    case 'ondutis': if (v === 'f') { c.strokeStyle = 'rgba(200,60,50,.25)'; c.lineWidth = 1; for (let i = 0; i < 256; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 256); c.moveTo(0, i); c.lineTo(256, i); c.stroke(); } c.save(); c.translate(256, 0); c.scale(-1, 1); c.fillStyle = 'rgba(205,55,45,.75)'; c.font = 'bold 22px Arial'; for (let y = 40; y < 256; y += 96) c.fillText('ОНДУТИС', 10 + ((y / 96) % 2) * 70, y); c.restore(); } break;
    case 'dimple': if (v === 'f') for (let y = 16; y < 256; y += 32) for (let x = 16; x < 256; x += 32) { c.fillStyle = rgb(1.9); c.beginPath(); c.arc(x + ((y / 32) % 2) * 16, y, 9, 0, 7); c.fill(); c.fillStyle = rgb(1.3); c.beginPath(); c.arc(x + ((y / 32) % 2) * 16 + 2, y + 2, 6, 0, 7); c.fill(); } break;
    case 'gravel': for (let i = 0; i < 420; i++) { c.fillStyle = rgb(.7 + rnd() * .5); c.beginPath(); c.ellipse(rnd() * 256, rnd() * 256, 3 + rnd() * 7, 2 + rnd() * 5, rnd() * 3, 0, 7); c.fill(); } break;
    case 'felt': dots(2500, .3, 1, .9, 1.04); break;
    case 'grain': if (v === 'end') endgrain(); else grain(); break;
    case 'osb': if (v === 'f') { for (let i = 0; i < 700; i++) { c.fillStyle = rgb(.72 + rnd() * .5); c.save(); c.translate(rnd() * 256, rnd() * 256); c.rotate(rnd() * 3); c.fillRect(-12, -3, 24 + rnd() * 10, 6); c.restore(); } } else for (let y = 0; y < 256; y += 2) hline(y, 1, .8 + rnd() * .35); break;
    case 'planks': if (v === 'f') for (let r = 0; r < 6; r++) { const off = (r * 97) % 256; for (let i = -1; i < 2; i++) { c.fillStyle = rgb(.9 + rnd() * .2); c.fillRect(i * 256 + off, r * 43, 256, 43); c.fillStyle = rgb(.7, .5); c.fillRect(i * 256 + off, r * 43, 2, 43); } hline(r * 43, 1.5, .7); } else grain(); break;
    case 'siding': if (v === 'f') for (let y = 0; y < 256; y += 64) { const g = c.createLinearGradient(0, y, 0, y + 64); g.addColorStop(0, rgb(.84)); g.addColorStop(.12, rgb(1.03)); g.addColorStop(1, rgb(.96)); c.fillStyle = g; c.fillRect(0, y, 256, 64); } break;
    case 'paver': if (v === 'f') { c.fillStyle = rgb(.78); c.fillRect(0, 0, 256, 256); for (let r = 0; r < 4; r++) for (let i = -1; i < 3; i++) { c.fillStyle = rgb(.95 + rnd() * .12); c.fillRect(i * 128 + (r % 2) * 64 + 2, r * 64 + 2, 124, 60); } } else dots(1200, .4, 1.2, .8, 1.1); break;
    case 'seams': if (v === 'f') for (const x of [0, 128]) { vline(x, 5, 1.35); vline(x + 5, 3, .7); } break;
    case 'mesh': c.fillStyle = 'rgba(255,255,255,0)'; c.clearRect(0, 0, 256, 256); c.fillStyle = base; for (let i = 0; i < 256; i += 12) { c.fillRect(i, 0, 3, 256); c.fillRect(0, i, 256, 3); } break;
    case 'comb': for (let x = 0; x < 256; x += 6) vline(x, 3, .82); dots(400, .4, 1, .8, 1.1); break;
    case 'rough': dots(2600, .5, 2.2, .86, 1.1); for (let i = 0; i < 260; i++) { c.fillStyle = rgb(.8 + rnd() * .1, .5); c.beginPath(); c.arc(rnd() * 256, rnd() * 256, 2 + rnd() * 3, 0, 7); c.fill(); } break;
  }
  if (rot) { const o = document.createElement('canvas'); o.width = o.height = 256; const oc = o.getContext('2d'); oc.translate(256, 0); oc.rotate(Math.PI / 2); oc.drawImage(cv, 0, 0); cv = o; }
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  N.texs.set(key, t); return t;
}
/* цвет облицовки, который выбирают в панели */
const NCOL = { brick: '#b2583d', siding: '#e3dfd4', dplaster: '#f3efe6' };
const ncolor = (m) => (NCOL[m] && S.ncol && S.ncol[m]) || (NMAT[m] || {}).c || '#cccccc';
function nodeMat(m, v = 'f', rot = false) {
  const d = NMAT[m] || { c: '#cccccc' }, c = ncolor(m), key = [m, v, rot, c].join('|');
  if (N.mats.has(key)) return N.mats.get(key);
  const mt = new THREE.MeshStandardMaterial({ color: d.tex ? 0xffffff : new THREE.Color(c).convertSRGBToLinear(), roughness: d.r ?? .9, metalness: d.m ?? 0, transparent: !!d.op || d.tex === 'mesh', opacity: d.op ?? 1, alphaTest: d.tex === 'mesh' ? .3 : 0, side: d.tex === 'mesh' ? THREE.DoubleSide : THREE.FrontSide });
  if (d.tex) mt.map = nodeTex(d.tex, c, v, rot);
  // размер плитки текстуры в метрах [по горизонтали, по вертикали] для этой грани; у повёрнутой — наоборот
  const t0 = d.ts || .5, t = typeof t0 === 'number' ? [t0, t0] : (t0[v] || t0.f);
  mt.userData.ts = rot ? [t[1], t[0]] : t;
  N.mats.set(key, mt); return mt;
}
/* развёртка UV по мировым размерам: текстура не растягивается на длинных брусках */
/* ts — размер плитки [x, y] в метрах, или функция от номера вершины (у бруска — свой размер на каждой грани);
   o — сдвиг начала координат, чтобы швы на соседних гранях одного куска совпадали */
function worldUV(g, ts, o = [0, 0, 0]) {
  const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv; if (!uv) return g;
  for (let i = 0; i < p.count; i++) {
    const t = typeof ts === 'function' ? ts(i) : (typeof ts === 'number' ? [ts, ts] : ts);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i)), x = p.getX(i) + o[0], y = p.getY(i) + o[1], z = p.getZ(i) + o[2];
    if (ax >= ay && ax >= az) uv.setXY(i, z / t[0], y / t[1]); else if (ay >= az) uv.setXY(i, x / t[0], z / t[1]); else uv.setXY(i, x / t[0], y / t[1]);
  }
  uv.needsUpdate = true; return g;
}
/* брусок в системе стопки: u — вдоль, v — по толщине (вверх), w — вглубь; размеры и центр в мм */
/* брусок в системе стопки: u — вдоль, v — по толщине (вверх), w — вглубь; размеры в мм.
   Грани ±v — лицевые, ±u и ±w — срезы. frame 'x' — слой стены в узле фундамента: толщина по u, высота по v.
   grain — у деревянных брусков: 'u' или 'w', вдоль чего идут волокна. */
function nBox(parent, m, u1, u2, v1, v2, w1, w2, opt = {}) {
  const sx = (u2 - u1) / 1000, sy = Math.max(v2 - v1, .6) / 1000, sz = (w2 - w1) / 1000;
  let mats;
  if (opt.grain) {
    // волокна вдоль бруска, на торцах — годовые кольца
    const along = opt.grain, gm = (face, axis) => nodeMat(m, axis === 'end' ? 'end' : 'f', axis === 'rot');
    mats = along === 'u' ? [gm(0, 'end'), gm(0, 'end'), gm(0, ''), gm(0, ''), gm(0, ''), gm(0, '')]
      : along === 'w' ? [gm(0, ''), gm(0, ''), gm(0, 'rot'), gm(0, 'rot'), gm(0, 'end'), gm(0, 'end')]
        : [gm(0, 'rot'), gm(0, 'rot'), gm(0, 'end'), gm(0, 'end'), gm(0, 'rot'), gm(0, 'rot')];   // 'v' — вертикальные
  } else if (opt.frame === 'x') {
    const f = nodeMat(m, 'f'), su = nodeMat(m, 'su', true), sw = nodeMat(m, 'sw', true);
    mats = [f, f, sw, sw, su, su];
  } else { const f = nodeMat(m, 'f'), su = nodeMat(m, 'su'), sw = nodeMat(m, 'sw'); mats = [su, su, f, f, sw, sw]; }
  // у BoxGeometry по 4 вершины на грань в порядке +x, −x, +y, −y, +z, −z; начало развёртки — угол куска
  // opt.abs — развёртка от общего начала стопки: соседние полоски одного слоя продолжают рисунок
  const org = opt.abs ? [(u1 + u2) / 2000 + 5, (v1 + v2) / 2000 + 5, (w1 + w2) / 2000 + 5] : [sx / 2, sy / 2, sz / 2];
  const g = worldUV(new THREE.BoxGeometry(sx, sy, sz), (i) => mats[i >> 2].userData.ts, org);
  const me = new THREE.Mesh(g, mats); me.position.set((u1 + u2) / 2000, (v1 + v2) / 2000, (w1 + w2) / 2000);
  me.castShadow = !mats[2].transparent; me.receiveShadow = true; parent.add(me); return me;
}
/* профилированный лист: рёбра вдоль u (кровля — по скату), профиль поперёк w */
function nSheet(parent, m, u1, u2, v0, w1, w2, kind) {
  const sh = new THREE.Shape(), pts = [], W = (w2 - w1), t = 1.2;
  for (let w = 0; w <= W; w += 10) {
    let h;
    if (kind === 'falz') { const p = w % 542; h = p < 12 ? 25 : 0; }
    else { const p = (w % 185) / 185; h = 18 * (1 - Math.cos(p * Math.PI * 2)) / 2; }
    pts.push([w, h]);
  }
  sh.moveTo(pts[0][0] / 1000, pts[0][1] / 1000);
  for (const [w, h] of pts) sh.lineTo(w / 1000, (h + t) / 1000);
  for (const [w, h] of pts.slice().reverse()) sh.lineTo(w / 1000, h / 1000);
  const g = new THREE.ExtrudeGeometry(sh, { depth: (u2 - u1) / 1000, bevelEnabled: false, curveSegments: 1 });
  // профиль нарисован в плоскости (w, v) и выдавлен по z; поворот кладёт выдавливание вдоль u
  g.rotateY(Math.PI / 2); g.translate(u1 / 1000, v0 / 1000, w2 / 1000);
  g.computeVertexNormals();
  const me = new THREE.Mesh(g, nodeMat(m)); me.castShadow = true; me.receiveShadow = true; parent.add(me);
  if (kind !== 'falz') for (let u = u2 - 60; u > u1; u -= 350) nBox(parent, m, u - 25, u, v0, v0 + 20, w1, w2);
  return me;
}
/* стопка слоёв; L — длина, D — глубина, s — шаг выступа каждого следующего слоя */
function nStack(layers, L, D, s, labels, spread, diag) {
  const g = new THREE.Group(), n = layers.length;
  // линия диагонального среза лицевого слоя: от нижнего угла у ступеньки слоёв до верхнего угла на дальнем краю —
  // остаётся треугольник, выше диагонали видно обрешётку и слои под облицовкой
  const du1 = -L / 2, du2 = L / 2 - (n - 1) * s, diagTop = (u) => -D / 2 + D * Math.min(1, Math.max(0, (du2 - u) / (du2 - du1)));
  let v = 0;
  const visOf = (l) => (l.m === 'mtile' || l.m === 'falz' ? 20 : l.t === 0 ? 3 : Math.max(l.t, 3));
  // наружная грань несущего слоя — к ней крепятся кронштейны подсистемы
  let acc = 0, vWall = null; for (const l of layers) { if (vWall === null && (l.m === 'aerated' || l.m === 'brick') && l !== layers[0]) vWall = -acc; acc += visOf(l); }
  layers.forEach((l, i) => {
    const vis = visOf(l);
    const v2 = v, v1 = v - vis, u1 = -L / 2, u2 = L / 2 - (n - 1 - i) * s, w1 = -D / 2, w2 = D / 2;
    // у стены точки выносок расходятся по высоте, чтобы линии не перекрещивались
    const mid = diag && i === 0 ? [u1 + (u2 - u1) * .25, v2, -D * .3] : [(u2 - s * .55), v2, spread ? D * (.36 - .72 * i / Math.max(1, n - 1)) : D * .18];
    if (l.m === 'mtile' || l.m === 'falz') nSheet(g, l.m, u1, u2, v1, w1, w2, l.m === 'falz' ? 'falz' : 'tile');
    else if (diag && i === 0 && l.m !== 'gap') {
      // лицевой слой срезан по диагонали: остаётся треугольник ниже линии от низа до верхнего угла
      for (let u = u1; u < u2 - 1; u += 15) { const ue = Math.min(u + 15, u2), top = diagTop((u + ue) / 2); if (top > w1 + 5) nBox(g, l.m, u, ue, v1, v2, w1, top, { abs: 1 }); }
    } else if (l.reveal) {
      // облицовка снята уступами по рядам, чтобы был виден каркас под ней
      const R = l.reveal; let k = 0;
      for (let w = w1; w < w2 - R.w; w += R.row, k++) nBox(g, l.m, u1 + 330 + (k % 2) * 120 + k * 20, u2 + s - 30, v1, v2, w, Math.min(w + R.row - 2, w2 - R.w));
    } else if (l.m !== 'gap') nBox(g, l.m, u1, u2, v1, v2, w1, w2);
    if (l.frame) {
      // вертикальные профили — ближе к стене, горизонтальные — поверх них; кронштейны через утеплитель к несущей стене
      const F = l.frame, vm = (v1 + v2) / 2, pw = F.w;
      for (let u = u2 - 80; u > u1 + 40; u -= F.step) {
        nBox(g, 'metal', u - pw / 2, u - pw / 2 + 2, v1, vm, w1, w2); nBox(g, 'metal', u + pw / 2 - 2, u + pw / 2, v1, vm, w1, w2); nBox(g, 'metal', u - pw / 2, u + pw / 2, vm - 2, vm, w1, w2);
        if (vWall !== null) for (let w = w1 + 180; w < w2 - 60; w += 600) {
          nBox(g, 'metal', u - pw / 2 - 4, u - pw / 2, vWall, v1, w - 45, w + 45);        // лапка кронштейна
          nBox(g, 'metal', u - pw / 2 - 40, u - pw / 2, vWall, vWall + 3, w - 45, w + 45); // пятка на стене
        }
      }
      for (let w = w1 + 120; w < w2; w += F.hstep) { nBox(g, 'metal', u1, u2, vm, v2, w - pw / 2, w - pw / 2 + 2); nBox(g, 'metal', u1, u2, vm, v2, w + pw / 2 - 2, w + pw / 2); nBox(g, 'metal', u1, u2, v2 - 2, v2, w - pw / 2, w + pw / 2); }
      if (vWall !== null) labels.push({ n: 'Кронштейны подсистемы — к несущей стене через утеплитель', at: [u2 - 80 - pw / 2 - 20, (vWall + v1) / 2, w1 + 180] });
    }
    if (l.bars) {
      const b = l.bars, bm = b.m || 'wood';
      const gr = NMAT[bm] && NMAT[bm].tex === 'grain' ? 1 : 0;
      if (b.dir === 'u') { for (let w = w1 + b.w / 2 + 40; w < w2 - b.w / 2; w += b.step) nBox(g, bm, u1, u2, v1 - .5, v2 + .5, w - b.w / 2, w + b.w / 2, gr ? { grain: 'u' } : {}); }
      else if (b.ws) { let u = u2 - 10, k = 0; while (u - b.ws[k % b.ws.length] > u1) { const bw = b.ws[k++ % b.ws.length], top = diag && i === 0 ? diagTop(u - bw / 2) : w2; if (top > w1 + 5) nBox(g, bm, u - bw, u, v1 - .5, v2 + .5, w1, top, gr ? { grain: 'w' } : {}); u -= bw + b.gap; } }
      else { for (let u = u2 - b.w / 2 - 20; u > u1 + b.w / 2; u -= b.step) nBox(g, bm, u - b.w / 2, u + b.w / 2, v1 - .5, v2 + .5, w1, w2, gr ? { grain: 'w' } : {}); }
      if (b.n) labels.push({ n: b.n, at: b.dir === 'u' ? [u2 - s * .3, v2, w1 + b.w / 2 + 40] : [u2 - b.w / 2 - 20, v2, D * .3] });
    }
    if (l.pipes) {
      const p = l.pipes, pm = nodeMat('pipe');
      for (let w = w1 + p.step / 2; w < w2; w += p.step) { const c = new THREE.Mesh(new THREE.CylinderGeometry(p.d / 2000, p.d / 2000, (u2 - u1 + 40) / 1000, 14), pm); c.rotation.z = Math.PI / 2; c.position.set((u1 + u2 + 40) / 2000, (v1 + p.d / 2 + 2) / 1000, w / 1000); c.castShadow = true; g.add(c); }
      labels.push({ n: p.n, at: [u2 + 20, v1 + p.d, w1 + p.step / 2] });
    }
    if (l.mesh) {
      // арматура выступает из торца плиты
      const p = l.mesh, rm = nodeMat('rebar'), y = (v1 + vis * .5) / 1000;
      for (let w = w1 + p.step / 2; w < w2; w += p.step) { const c = new THREE.Mesh(new THREE.CylinderGeometry(p.d / 2000, p.d / 2000, (u2 - u1 + 90) / 1000, 8), rm); c.rotation.z = Math.PI / 2; c.position.set((u1 + u2 + 90) / 2000, y, w / 1000); g.add(c); }
    }
    if (l.air && S.nair) nAir(g, l.air, u1, u2, (v1 + v2) / 2, w1, w2);
    labels.push({ n: l.n, t: l.t, a: l.a, at: l.m === 'gap' && !l.bars ? [u2 - s * .5, v2 - vis / 2, D / 2] : mid });
    v = v1;
  });
  return g;
}
/* полупрозрачные стрелки движения воздуха в вентзазоре: dir 'w' — снизу вверх по стене, 'u' — вдоль ската к коньку */
function nAir(g, dir, u1, u2, v, w1, w2) {
  if (!N.airMat) N.airMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#38b6f0').convertSRGBToLinear(), emissive: new THREE.Color('#2a8fd0').convertSRGBToLinear(), emissiveIntensity: .35, transparent: true, opacity: .55, depthWrite: false, roughness: .4 });
  const P = (a, b) => (dir === 'w' ? new THREE.Vector3(a / 1000, v / 1000, b / 1000) : new THREE.Vector3(b / 1000, v / 1000, a / 1000));
  const along = dir === 'w' ? [w1 + 80, w2 - 140] : [u1 + 120, u2 - 160], across = dir === 'w' ? [u1, u2] : [w1, w2];
  const n = Math.max(2, Math.round((across[1] - across[0]) / 420));
  for (let k = 0; k < n; k++) {
    const c = across[0] + (across[1] - across[0]) * (k + .5) / n, A = along[0], B = along[1], L = B - A, sw = 60 * (k % 2 ? 1 : -1);
    for (const [a0, a1] of [[A, A + L * .44], [A + L * .52, B]]) {
      const pts = [0, .33, .66, 1].map((t) => P(c + Math.sin(t * Math.PI * 1.4) * sw, a0 + (a1 - a0) * t));
      const curve = new THREE.CatmullRomCurve3(pts), tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, .011, 8, false), N.airMat);
      tube.renderOrder = 5; g.add(tube);
      const end = curve.getPoint(1), tan = curve.getTangent(1), head = new THREE.Mesh(new THREE.ConeGeometry(.03, .08, 14), N.airMat);
      head.position.copy(end).addScaledVector(tan, .03); head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan); head.renderOrder = 5; g.add(head);
    }
  }
}
/* узел «фундамент и цоколь»: разрез по краю плиты с ребром, стеной и отмосткой (x — наружу, y — вверх, z — вдоль стены) */
function nFoundation(nd, labels) {
  const g = new THREE.Group(), D = 1200, w1 = -D / 2, w2 = D / 2;
  const floor = nd.floor.filter((l) => l.m !== 'soil'), wall = nd.wall.slice().reverse();   // стена изнутри наружу
  const wallT = wall.reduce((s, l) => s + Math.max(l.t, l.t === 0 ? 3 : 0), 0);
  const ci = floor.findIndex((l) => l.m === 'concrete'), above = floor.slice(0, ci), conc = floor[ci], below = floor.slice(ci + 1);
  const yC = -above.reduce((s, l) => s + Math.max(l.t, 3), 0), yCb = yC - conc.t;
  const block = wall.find((l) => l.m === 'aerated' || l.m === 'brick'), blockIn = wall.slice(0, wall.indexOf(block)).reduce((s, l) => s + Math.max(l.t, 3), 0);
  const xBlockIn = 0, xOut = wallT;                         // внутренняя грань стены — 0
  // ребро — под всей кладкой: наружная грань ребра совпадает с наружной гранью самого внешнего каменного слоя (кирпич или блок),
  // как на разрезах проекта; навесная облицовка (сайдинг, планкен, фальц) держится на обрешётке
  const mIdx = wall.reduce((m, l, i) => (l.m === 'aerated' || l.m === 'brick' ? i : m), 0);
  const ribOut = wall.slice(0, mIdx + 1).reduce((s, l) => s + Math.max(l.t, 3), 0), ribIn = Math.min(ribOut - nd.rib.w, 0), ribB = yCb - nd.rib.d;
  const L = 1500, inner = -L;
  // слои пола внутри — ступенькой у дальнего края
  let y = 0;
  above.forEach((l, i) => { const t = Math.max(l.t, 3); nBox(g, l.m, inner + (above.length - i) * 110, xBlockIn, y - t, y, w1, w2); if (l.pipes) { const p = l.pipes; for (let w = w1 + p.step / 2; w < w2; w += p.step) { const c = new THREE.Mesh(new THREE.CylinderGeometry(p.d / 2000, p.d / 2000, (-inner) / 1000, 12), nodeMat('pipe')); c.rotation.z = Math.PI / 2; c.position.set(inner / 2000, (y - t + p.d / 2 + 2) / 1000, w / 1000); g.add(c); } } labels.push({ n: l.n, t: l.t, a: l.a, at: [inner + (above.length - i) * 110 + 60, y, D * .2] }); y -= t; });
  // плита с ребром под стеной
  nBox(g, 'concrete', inner, ribOut, yCb, yC, w1, w2);
  nBox(g, 'concrete', ribIn, ribOut, ribB, yCb, w1, w2);
  labels.push({ n: conc.n.replace(/, сетка[^,]*$/, '') + ' с ребром под стеной', t: conc.t, at: [inner + 60, yC, D * .2] });
  // слои под плитой: внутри — до ребра, под ребром и снаружи — песок/основание
  y = yCb;
  below.forEach((l, i) => { const t = Math.max(l.t, 3); nBox(g, l.m, inner + (below.length - i) * 110 - 220, ribIn, y - t, y, w1, w2); labels.push({ n: l.n, t: l.t, a: l.a, at: [inner + (below.length - i) * 110 - 160, y, D * .2] }); y -= t; });
  const yBase = Math.min(y, ribB - 150);
  const xIns = ribOut + (nd.xpsV || 8);
  nBox(g, 'sand', ribIn, xIns, yBase, ribB, w1, w2);
  // вертикальное утепление ребра
  const yG = nd.ground;
  if (nd.xpsV) { nBox(g, 'xps', ribOut, ribOut + nd.xpsV, ribB, Math.min(-60, yC + 60), w1, w2, { frame: 'x' }); labels.push({ n: 'Утепление цоколя — ТЕХНОНИКОЛЬ XPS 30-250 СТАНДАРТ', t: nd.xpsV, at: [ribOut + nd.xpsV, (yG + ribB) / 2, D / 2] }); }
  else { nBox(g, 'planter', ribOut, ribOut + 8, ribB, -20, w1, w2); labels.push({ n: 'Гидроизоляция — PLANTER Standard', at: [ribOut + 8, (yCb + ribB) / 2, D / 2] }); }
  // отмостка
  const ox1 = ribOut + (nd.xpsV || 8), ox2 = xOut + nd.otmW;
  let yo = yG + 50;
  const otm = nd.otm.filter((l) => l.m !== 'soil');
  otm.forEach((l, i) => { const t = Math.max(l.t, 3); nBox(g, l.m, ox1, ox2 - (otm.length - 1 - i) * 90, yo - t, yo, w1, w2); labels.push({ n: l.n, t: l.t, a: l.a, at: [ox2 - (otm.length - 1 - i) * 90 - 50, yo, D * .25] }); yo -= t; });
  // грунт: под плитой — до основания, снаружи — до низа отмостки
  const ySoil = Math.min(yBase, yo) - 250, xFar = ox2 + 450;
  nBox(g, 'soil', inner - 100, xIns, ySoil, yBase, w1, w2);
  nBox(g, 'soil', xIns, xFar, ySoil, yo, w1, w2);
  if (ribB > yo) nBox(g, 'soil', ribOut, ox1, yo, ribB, w1, w2);
  labels.push({ n: 'Основание — грунт уплотнённый', at: [xFar - 100, yo, D * .1] });
  if (nd.drain) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, D / 1000, 20), nodeMat('planter')); c.rotation.x = Math.PI / 2; c.position.set((ox2 + 120) / 1000, (yo - 60) / 1000, 0); c.castShadow = true; g.add(c); labels.push({ n: 'Дренажная труба Ø110', at: [ox2 + 120, yo, D / 2] }); }
  // стена: слои изнутри наружу, внизу — на плите
  let x = xBlockIn;
  const top = 1100;
  wall.forEach((l, i) => {
    const t = Math.max(l.t, 3), isBlock = l === block, y0 = isBlock ? yC : 0;
    const yTop = top - (wall.length - 1 - i) * 0;
    const yb = i <= mIdx ? yC : Math.max(yG + 120, -60);
    if (l.m !== 'gap') nBox(g, l.m, x, x + t, yb, yTop - (i > wall.indexOf(block) ? (i - wall.indexOf(block)) * 120 : 0), w1, w2, { frame: 'x' });
    if (l.bars) { const b = l.bars, gr = NMAT[b.m] && NMAT[b.m].tex === 'grain'; if (b.dir === 'u') { for (let yy = yb + b.w / 2; yy < yTop - 140 * (i - wall.indexOf(block)); yy += b.step) nBox(g, b.m, x, x + t, yy - b.w / 2, yy + b.w / 2, w1, w2, gr ? { grain: 'w' } : { frame: 'x' }); } else if (b.ws) { let w = w1 + 10, k = 0; while (w + b.ws[k % b.ws.length] < w2) { const bw = b.ws[k++ % b.ws.length]; nBox(g, b.m, x, x + t, yb, yTop - (i - wall.indexOf(block)) * 120, w, w + bw, gr ? { grain: 'v' } : { frame: 'x' }); w += bw + b.gap; } } else for (let w = w1 + 60; w < w2; w += b.step) nBox(g, b.m, x, x + t, yb, yTop - (i - wall.indexOf(block)) * 120, w, w + b.w, gr ? { grain: 'v' } : { frame: 'x' }); }
    if (i > wall.indexOf(block) || isBlock) labels.push({ n: l.n, t: l.t, a: l.a, at: [x + t, yTop - (i > wall.indexOf(block) ? (i - wall.indexOf(block)) * 120 : 0) - 60, D * .3] });
    x += t;
  });
  // армирование по листу КЖ: продольная арматура и сетка выходят из среза плиты, на выпуске видны хомут и гнутый стержень
  const rm = nodeMat('rebar'), cov = 50, out = 260, zs = w2 + 140;
  const bar = (a, b, d) => {
    const A = new THREE.Vector3(...a).divideScalar(1000), B = new THREE.Vector3(...b).divideScalar(1000), len = A.distanceTo(B);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(d / 2000, d / 2000, len + d / 1000, 10), rm);
    c.position.copy(A).add(B).multiplyScalar(.5); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); c.castShadow = true; g.add(c);
  };
  const ms = (conc.mesh && conc.mesh.step) || 400, yTop = yC - 40, yBot = ribB + cov, rx1 = ribIn + cov, rx2 = ribOut - cov, rxm = (rx1 + rx2) / 2;
  // ребро: продольные Ø12 — 3 сверху и 3 снизу
  for (const x of [rx1, rxm, rx2]) for (const y of [yTop, yBot]) bar([x, y, w1 + 30], [x, y, w2 + out], 12);
  // хомуты Ø6 с шагом 400 — один на выпуске, остальные внутри бетона
  for (const z of [zs]) { bar([rx1, yBot, z], [rx2, yBot, z], 6); bar([rx2, yBot, z], [rx2, yTop, z], 6); bar([rx2, yTop, z], [rx1, yTop, z], 6); bar([rx1, yTop, z], [rx1, yBot, z], 6); }
  // сетка плиты Ø12: стержни вдоль стены выходят из среза, поперечный — на выпуске
  for (let x = rx1 - ms; x > inner + 60; x -= ms) bar([x, yTop, w1 + 30], [x, yTop, w2 + out], 12);
  bar([inner + 60, yTop + 12, zs], [rx2, yTop + 12, zs], 12);
  // гнутый стержень П: верхняя ветвь в плиту на 1000, вертикаль у наружной грани ребра, нижняя — по низу ребра
  const zp = zs + 70;
  bar([rx2 - 1000, yTop - 12, zp], [rx2 + 8, yTop - 12, zp], 12); bar([rx2 + 8, yTop - 12, zp], [rx2 + 8, yBot + 12, zp], 12); bar([rx2 + 8, yBot + 12, zp], [rx1, yBot + 12, zp], 12);
  labels.push({ n: 'Армирование ребра: продольная арматура Ø12 А500С — 3 сверху, 3 снизу', at: [rx1, yBot, w2 + out] });
  labels.push({ n: 'Хомуты Ø6 А500С с шагом 400 мм', at: [rx2, (yTop + yBot) / 2, zs] });
  labels.push({ n: `Сетка плиты Ø12 А500С ${ms}×${ms} мм`, at: [inner + 400, yTop, w2 + out] });
  labels.push({ n: 'Гнутый стержень П Ø12 А500С — связь плиты и ребра', at: [rx2 - 600, yTop - 12, zp] });
  // отсечная гидроизоляция под стеной
  nBox(g, 'planter', xBlockIn + blockIn, xBlockIn + blockIn + block.t, yC, yC + 4, w1, w2);
  labels.push({ n: 'Отсечная гидроизоляция', at: [xBlockIn + blockIn + block.t / 2, yC + 4, D / 2] });
  return g;
}
function buildNode() {
  if (!N) return;
  const { group } = N; group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); group.clear();
  const nd = curNode(), labels = [];
  let g;
  if (nd.type === 'fnd') g = nFoundation(nd, labels);
  else {
    const L = nd.type === 'wall' ? 1300 : 1500, D = nd.type === 'wall' ? 1100 : 1000;
    g = nStack(nd.layers, L, D, nd.type === 'wall' ? 110 : 120, labels, nd.type === 'wall', nd.type === 'wall');
    const outer = new THREE.Group(); outer.add(g);
    if (nd.type === 'wall') {
      // стопка: u — вдоль стены, v — наружу, w — вверх; основание матрицы с определителем +1
      g.matrixAutoUpdate = false; g.matrix.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
      g.position.set(0, 0, 0);
    } else if (nd.type === 'roof') g.rotation.z = nd.pitch * Math.PI / 180;
    g = outer;
  }
  group.add(g);
  group.updateMatrixWorld(true);
  // всё поднимаем на землю и центрируем
  const bb = new THREE.Box3().setFromObject(group), c = bb.getCenter(new THREE.Vector3());
  group.position.set(-c.x, -bb.min.y, -c.z); group.updateMatrixWorld(true);
  N.box = new THREE.Box3().setFromObject(group);
  const inner = g.children[0] && g.children[0].isGroup ? g.children[0] : g;
  N.labels = labels.map((l, i) => ({ ...l, n0: l.n, i: i + 1, w: new THREE.Vector3(l.at[0] / 1000, l.at[1] / 1000, l.at[2] / 1000).applyMatrix4(inner.matrixWorld) }));
  nodeLight(); nodeFit(); orderLabels(); renderNodeLegend();
}
/* номера слоёв — сверху вниз, как точки выносок видны в исходном ракурсе */
function orderLabels() {
  const v = new THREE.Vector3();
  N.labels.forEach((l) => { v.copy(l.w).project(N.cam); l.sy = -v.y; l.sx = v.x; });
  N.labels.sort((a, b) => a.sy - b.sy || a.sx - b.sx).forEach((l, i) => { l.i = i + 1; });
  ndirty();
}
const tSuffix = (l) => (l.t && !l.n.includes(fmtT(l.t) + ' мм') ? ` — ${fmtT(l.t)} мм` : '') + (l.a ? '*' : '');
const fmtT = (t) => (t < 1 ? String(t).replace('.', ',') : t % 1 ? String(t).replace('.', ',') : fmtMM(t));
/* свой текст подписи: ключ — проект/узел/исходный текст, пусто — вернуть исходный */
const ntKey = (l) => curSet().id + '/' + curNode().id + '/' + l.n0;
const ntext = (l) => (S.ntext && S.ntext[ntKey(l)]) ?? null;
function setNtext(l, v) {
  S.ntext = S.ntext || {}; const k = ntKey(l), d = l.n0 + tSuffix({ ...l, n: l.n0 });
  if (!v || v.trim() === d) delete S.ntext[k]; else S.ntext[k] = v.trim();
  save(); renderNodeLegend(); ndirty();
}
const labelText = (l) => ntext(l) ?? (l.n0 + tSuffix({ ...l, n: l.n0 }));
function editLabel(l) {
  const v = prompt('Текст подписи (пусто — вернуть исходный):', labelText(l));
  if (v !== null) setNtext(l, v);
}
function renderNodeLegend() {
  const nd = curNode(), set = curSet(), el = $('#nlegend'); el.innerHTML = '';
  const ol = document.createElement('ol');
  for (const l of N.labels.slice().sort((a, b) => a.i - b.i)) {
    const li = document.createElement('li'), inp = document.createElement('textarea');
    inp.className = 'nedit'; inp.rows = 1; inp.value = labelText(l); inp.title = 'Можно исправить текст подписи';
    const fit = () => { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; };
    inp.oninput = () => { fit(); S.ntext = S.ntext || {}; S.ntext[ntKey(l)] = inp.value; save(); ndirty(); };
    inp.onchange = () => setNtext(l, inp.value);
    li.append(inp); ol.append(li); requestAnimationFrame(fit);
  }
  el.append(ol);
  const rs = document.createElement('button'); rs.className = 'lnk'; rs.textContent = 'Вернуть исходные подписи';
  rs.onclick = () => { for (const l of N.labels) delete (S.ntext || {})[ntKey(l)]; save(); renderNodeLegend(); ndirty(); };
  el.append(rs);
  const any = N.labels.some((l) => l.a);
  const p = document.createElement('div'); p.className = 'muted';
  p.textContent = 'Подписи можно исправить в списке или двойным щелчком по подписи на рисунке. ' + (any ? '* Толщина в проекте не указана — принята типовая. ' : '') + (set.note ? set.note + ' ' : '') + 'Источник: ' + set.src + '.';
  el.append(p);
  $('#nodeTitle').textContent = set.n + ' · ' + nd.n;
}
function renderNodeUI() {
  const pe = $('#nprojects'); pe.innerHTML = '';
  for (const s of nsets()) {
    const b = document.createElement('button'); b.className = 'plan'; b.setAttribute('aria-pressed', s.id === curSet().id);
    b.innerHTML = '<b></b><span></span>'; b.querySelector('b').textContent = s.n; b.querySelector('span').textContent = s.nodes.length + ' узлов';
    b.onclick = () => { S.nset = s.id; save(); renderNodeUI(); buildNode(); }; pe.append(b);
  }
  const ne = $('#nnodes'); ne.innerHTML = '';
  for (const n of curSet().nodes) {
    const b = document.createElement('button'); b.className = 'btn'; b.textContent = n.n; b.setAttribute('aria-pressed', n.id === curNode().id);
    b.onclick = () => { S.nnode = n.id; save(); renderNodeUI(); buildNode(); }; ne.append(b);
  }
  $('#nlab').setAttribute('aria-pressed', !!S.labels); $('#nair').setAttribute('aria-pressed', !!S.nair); $('#nlabColor').value = S.nlabelColor;
  for (const k of Object.keys(NCOL)) $('#ncol_' + k).value = ncolor(k);
}
$('#nair').onclick = () => { S.nair = !S.nair; save(); renderNodeUI(); if (N) buildNode(); };
$('#nlab').onclick = () => { S.labels = !S.labels; save(); renderNodeUI(); if (N) nodeFit(); };
$('#nlabColor').oninput = (e) => { S.nlabelColor = e.target.value; save(); ndirty(); };
for (const k of Object.keys(NCOL)) $('#ncol_' + k).oninput = (e) => { S.ncol = S.ncol || {}; S.ncol[k] = e.target.value; save(); if (N) buildNode(); };
$('#ncolReset').onclick = () => { S.ncol = {}; save(); renderNodeUI(); if (N) buildNode(); };

async function initNodes() {
  if (N) return;
  if (!window.THREE) await loadScript(LIBS);
  const canvas = $('#gl2');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 1, .02, 100);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b2a6, .7), sun = new THREE.DirectionalLight(0xfff6ea, .8);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .01;
  scene.add(hemi, sun, sun.target);
  const group = new THREE.Group(); scene.add(group);
  const shadowM = new THREE.ShadowMaterial({ opacity: .18 }), ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), shadowM);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.001; ground.receiveShadow = true; scene.add(ground);
  N = { renderer, scene, cam, hemi, sun, group, mats: new Map(), texs: new Map(), dirty: true, t: new THREE.Vector3(), dist: 4, labels: [] };
  scene.background = new THREE.Color('#F7F8FB').convertSRGBToLinear();
  bindNodeControls(canvas);
  new ResizeObserver(nresize).observe($('#stage')); nresize();
  const loop = () => { if (N.dirty && S.tab === 'nodes') { N.dirty = false; nrender(); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  buildNode();
  if (document.fonts) document.fonts.ready.then(ndirty);
}
const ndirty = () => { if (N) N.dirty = true; };
function nresize() {
  if (!N) return; const st = $('#stage'), w = st.clientWidth, h = st.clientHeight; if (!w || !h) return;
  N.renderer.setSize(w, h, false); const ov = $('#ov2'), dpr = Math.min(devicePixelRatio, 2); ov.width = Math.round(w * dpr); ov.height = Math.round(h * dpr);
  N.cam.aspect = w / h; N.cam.updateProjectionMatrix(); ncam();
}
function ncam() {
  const { cam, t } = N; S.nel = clamp(S.nel, -.2, 1.45);
  const ce = Math.cos(S.nel); cam.position.set(t.x + N.dist * ce * Math.sin(S.naz), t.y + N.dist * Math.sin(S.nel), t.z + N.dist * ce * Math.cos(S.naz));
  cam.lookAt(t); cam.updateMatrixWorld(); ndirty();
}
function nodeFit() {
  const bb = N.box, c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length() / 2;
  N.t.copy(c); const fov = N.cam.fov * Math.PI / 360, asp = N.cam.aspect || 1;
  // справа место под подписи
  N.dist = r / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * asp))) * (S.labels ? 1.4 : 1.0);
  if (S.labels) { const right = new THREE.Vector3(Math.cos(S.naz), 0, -Math.sin(S.naz)); N.t.addScaledVector(right, r * .8); }
  ncam();
}
function nodeLight() {
  if (!N) return;
  const az = S.sunAz * Math.PI / 180, el = S.sunEl * Math.PI / 180, R = 6, k = S.sunPow / 100;
  N.sun.position.set(R * Math.cos(el) * Math.sin(az), R * Math.sin(el), -R * Math.cos(el) * Math.cos(az)); N.sun.target.position.set(0, .3, 0); N.sun.target.updateMatrixWorld();
  N.sun.intensity = .85 * k; N.hemi.intensity = .62 * (.55 + .45 * k);
  Object.assign(N.sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: .5, far: 15 }); N.sun.shadow.camera.updateProjectionMatrix();
  ndirty();
}
function nrender() {
  N.renderer.render(N.scene, N.cam);
  const ov = $('#ov2'), c = ov.getContext('2d'), k = ov.width / ov.clientWidth || 1;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ov.width, ov.height);
  drawNodeLabels(c, ov.width, ov.height, k);
}
/* подписи слоёв: точка на слое, выноска в колонку справа от узла */
function drawNodeLabels(c, W, H, k) {
  if (!S.labels || !N.labels.length) return;
  N.hits = [];
  const v = new THREE.Vector3(), pts = N.labels.map((l) => { v.copy(l.w).project(N.cam); return { l, x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H }; });
  // правый край узла на экране
  const bb = N.box, corners = []; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { v.set(x, y, z).project(N.cam); corners.push((v.x + 1) / 2 * W); }
  const fs = 12.5 * k, lh = fs * 1.55;
  c.save(); c.font = `600 ${fs}px ${FONT_T}`;
  const colX = Math.min(Math.max(...corners) + 30 * k, W * .62), maxW = W - colX - 14 * k;
  // длинные подписи переносятся по словам
  for (const p of pts) {
    const words = (`${p.l.i}. ` + labelText(p.l)).split(' '), lines = [''];
    for (const wd of words) { const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + wd : wd; if (c.measureText(t).width > maxW && lines[lines.length - 1]) lines.push(wd); else lines[lines.length - 1] = t; }
    p.lines = lines;
  }
  c.restore();
  const order = pts.slice().sort((a, b) => a.l.i - b.l.i);
  const lh2 = fs * 1.25, total = order.reduce((s, p) => s + lh + (p.lines.length - 1) * lh2, 0);
  let yy = Math.max(16 * k, Math.min(order[0].y, H - total - 16 * k));
  for (const p of order) { p.ly = yy; yy += lh + (p.lines.length - 1) * lh2; }
  c.save(); c.font = `600 ${fs}px ${FONT_T}`; c.textBaseline = 'middle';
  for (const p of order) {
    c.strokeStyle = S.nlabelColor; c.fillStyle = S.nlabelColor; c.globalAlpha = .75; c.lineWidth = 1 * k;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(colX - 12 * k, p.ly); c.lineTo(colX - 4 * k, p.ly); c.stroke(); c.globalAlpha = 1;
    c.beginPath(); c.arc(p.x, p.y, 3 * k, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.6 * k; c.stroke();
    c.fillStyle = S.nlabelColor;
    p.lines.forEach((t, j) => c.fillText(t, colX + (j ? 14 * k : 0), p.ly + j * lh2));
    N.hits.push({ l: p.l, x1: (colX - 6 * k) / k, x2: (colX + Math.max(...p.lines.map((t) => c.measureText(t).width)) + 14 * k) / k, y1: (p.ly - lh / 2) / k, y2: (p.ly + (p.lines.length - 1) * lh2 + lh / 2) / k });
  }
  c.restore();
}
function bindNodeControls(dom) {
  const pts = new Map(); let pinch = 0;
  const pan = (dx, dy) => { const H = $('#stage').clientHeight || 1, kk = 2 * N.dist * Math.tan(N.cam.fov * Math.PI / 360) / H; const r = new THREE.Vector3().setFromMatrixColumn(N.cam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(N.cam.matrixWorld, 1); N.t.addScaledVector(r, -dx * kk).addScaledVector(u, dy * kk); ncam(); };
  dom.style.touchAction = 'none';
  dom.addEventListener('contextmenu', (e) => e.preventDefault());
  dom.addEventListener('pointerdown', (e) => { dom.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }); pinch = 0; });
  dom.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) { N.dist *= pinch / d; ncam(); } pinch = d; return; }
    if (p.pan) pan(dx, dy); else { S.naz -= dx * .006; S.nel += dy * .006; ncam(); }
  });
  const up = (e) => { if (pts.delete(e.pointerId)) save(); pinch = 0; };
  dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  dom.addEventListener('wheel', (e) => { e.preventDefault(); N.dist = clamp(N.dist * Math.pow(1.0012, e.deltaY), .3, 30); ncam(); }, { passive: false });
  dom.addEventListener('dblclick', (e) => {
    const r = dom.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const h = S.labels && (N.hits || []).find((q) => x >= q.x1 && x <= q.x2 && y >= q.y1 && y <= q.y2);
    if (h) editLabel(h.l); else nodeFit();
  });
}
async function nodeSnapshot(transparent) {
  const sc = +$('#shotScale').value || 2, r = N.renderer, st = $('#stage'), w = st.clientWidth, h = st.clientHeight, pr0 = r.getPixelRatio();
  r.setPixelRatio(sc); r.setSize(w, h, false);
  const bg = N.scene.background; if (transparent) { N.scene.background = null; r.setClearColor(0x000000, 0); }
  r.render(N.scene, N.cam);
  const out = document.createElement('canvas'); out.width = Math.round(w * sc); out.height = Math.round(h * sc);
  const c = out.getContext('2d'); c.drawImage(r.domElement, 0, 0, out.width, out.height); const hs = N.hits; drawNodeLabels(c, out.width, out.height, sc); N.hits = hs;
  N.scene.background = bg; r.setPixelRatio(pr0); r.setSize(w, h, false); ndirty();
  let res = transparent ? cropAlpha(out, Math.round(24 * sc)) : out;
  if ($('#shotCap').checked) {
    const k = sc, o = document.createElement('canvas'); o.width = res.width; o.height = res.height + 56 * k; const cc = o.getContext('2d');
    if (!transparent) { cc.fillStyle = '#F7F8FB'; cc.fillRect(0, 0, o.width, o.height); }
    cc.drawImage(res, 0, 0); cc.fillStyle = '#261A7E'; cc.font = `800 ${28 * k}px ${FONT_D}`; cc.fillText((curSet().n + ' · ' + curNode().n).toUpperCase(), 22 * k, res.height + 36 * k); res = o;
  }
  const name = `uzel-${curSet().id}-${curNode().id}-${transparent ? 'bez-fona' : 's-fonom'}.png`;
  res.toBlob((blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Снимок сохранён: ' + name); }, 'image/png');
}
/* переключение вкладок */
function setTab(t) {
  S.tab = t; save();
  document.body.classList.toggle('tab-nodes', t === 'nodes');
  $$('#tabs button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === t));
  if (t === 'nodes') {
    if (!S.nset || !nsets().some((s) => s.id === S.nset)) { const s = nsets().find((x) => x.plans.includes(S.plan)); S.nset = (s || nsets()[0]).id; }
    renderNodeUI();
    initNodes().then(() => { nresize(); ndirty(); }).catch(() => toast('Не удалось загрузить 3D'));
  } else if (G) { resize(); dirty(); }
}
$$('#tabs button').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
