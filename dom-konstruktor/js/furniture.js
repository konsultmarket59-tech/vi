/* Каталог мебели, сантехники, света и декора: w — ширина, d — глубина, h — высота, мм.
   Угол a — градусы по часовой; 0 — спинка/задняя стенка к верху плана (−Y).
   wall — высота низа предмета над полом (настенные), ceil — подвешен к потолку, light — светит. */
(function () {
'use strict';
const DK = window.DK = window.DK || {};
const WOOD = '#b88a62', DARKW = '#7a5638', WHITE = '#f1efea', FAB = '#c9c6c0', METAL = '#3a3c40';
DK.FURN = {
  // гостиная
  sofa: { n: 'Диван 2,2 м', g: 'Гостиная', w: 2200, d: 950, h: 850, c: FAB },
  sofa3: { n: 'Диван 2,6 м', g: 'Гостиная', w: 2600, d: 1000, h: 850, c: '#b9b2a6', base: 'sofa' },
  sofaOffice: { n: 'Диван офисный малый', g: 'Гостиная', w: 1400, d: 750, h: 780, c: '#5d6168' },
  sofaL: { n: 'Угловой диван', g: 'Гостиная', w: 2800, d: 1800, h: 850, c: FAB },
  armchair: { n: 'Кресло', g: 'Гостиная', w: 850, d: 850, h: 850, c: '#c2ad94' },
  pouf: { n: 'Пуф', g: 'Гостиная', w: 550, d: 550, h: 420, c: '#a88f74' },
  tv: { n: 'ТВ-тумба с телевизором', g: 'Гостиная', w: 1800, d: 450, h: 1300, c: DARKW },
  coffee: { n: 'Журнальный столик', g: 'Гостиная', w: 1100, d: 600, h: 420, c: DARKW },
  coffeeR: { n: 'Столик круглый', g: 'Гостиная', w: 800, d: 800, h: 420, c: DARKW },
  fireplace: { n: 'Камин', g: 'Гостиная', w: 1300, d: 550, h: 1150, c: '#e6e2db' },
  rug: { n: 'Ковёр', g: 'Гостиная', w: 2000, d: 1400, h: 12, c: '#d9cdb9' },
  // кухня
  kitchen: { n: 'Кухня прямая 2,4 м', g: 'Кухня', w: 2400, d: 600, h: 900, c: WHITE },
  kitchenS: { n: 'Кухня прямая 1,8 м', g: 'Кухня', w: 1800, d: 600, h: 900, c: WHITE, base: 'kitchen' },
  kitchen3: { n: 'Кухня прямая 3,2 м', g: 'Кухня', w: 3200, d: 600, h: 900, c: '#e9e4dc', base: 'kitchen' },
  kitchenL: { n: 'Кухня угловая', g: 'Кухня', w: 2800, d: 1800, h: 900, c: WHITE },
  kitchenNo: { n: 'Кухня прямая без верха 2,4 м', g: 'Кухня', w: 2400, d: 600, h: 900, c: '#d9d4cb', base: 'kitchen', noUpper: true },
  kitchenLNo: { n: 'Кухня угловая без верха', g: 'Кухня', w: 2800, d: 1800, h: 900, c: WHITE, base: 'kitchenL', noUpper: true },
  kitchenU: { n: 'Кухня П-образная', g: 'Кухня', w: 3000, d: 2400, h: 900, c: '#e9e4dc' },
  island: { n: 'Кухонный остров', g: 'Кухня', w: 1800, d: 900, h: 900, c: WHITE },
  fridge: { n: 'Холодильник', g: 'Кухня', w: 600, d: 650, h: 1900, c: '#e6e6e4' },
  barstool: { n: 'Барный стул', g: 'Кухня', w: 400, d: 400, h: 750, c: METAL },
  // столовая
  table: { n: 'Стол 1,6 м + 6 стульев', g: 'Столовая', w: 1600, d: 900, h: 760, c: WOOD, chairs: 6 },
  table4: { n: 'Стол 1,2 м + 4 стула', g: 'Столовая', w: 1200, d: 800, h: 760, c: WOOD, chairs: 4, base: 'table' },
  table8: { n: 'Стол 2,2 м + 8 стульев', g: 'Столовая', w: 2200, d: 1000, h: 760, c: DARKW, chairs: 8, base: 'table' },
  tableR: { n: 'Круглый стол + 4 стула', g: 'Столовая', w: 1100, d: 1100, h: 760, c: WOOD, chairs: 4 },
  chair: { n: 'Стул', g: 'Столовая', w: 450, d: 480, h: 900, c: '#d9d2c6' },
  bench: { n: 'Скамья', g: 'Столовая', w: 1400, d: 400, h: 450, c: WOOD },
  // спальня
  bed180: { n: 'Кровать 180', g: 'Спальня', w: 1900, d: 2150, h: 1050, c: '#e4ddd2', base: 'bed160' },
  bed160: { n: 'Кровать 160', g: 'Спальня', w: 1700, d: 2100, h: 1000, c: '#e4ddd2' },
  bed140: { n: 'Кровать 140', g: 'Спальня', w: 1500, d: 2100, h: 1000, c: '#e4ddd2', base: 'bed160' },
  bed90: { n: 'Кровать 90', g: 'Спальня', w: 1000, d: 2050, h: 950, c: '#e4ddd2' },
  nightstand: { n: 'Тумба прикроватная', g: 'Спальня', w: 450, d: 400, h: 500, c: '#a77a52' },
  dresser: { n: 'Комод', g: 'Спальня', w: 1200, d: 500, h: 850, c: '#a77a52' },
  vanity: { n: 'Туалетный столик', g: 'Спальня', w: 1000, d: 450, h: 760, c: WHITE },
  desk: { n: 'Рабочий стол', g: 'Спальня', w: 1200, d: 600, h: 750, c: WOOD },
  ochair: { n: 'Рабочее кресло', g: 'Спальня', w: 600, d: 600, h: 1050, c: METAL },
  // детская
  bunk: { n: 'Двухъярусная кровать', g: 'Детская', w: 1000, d: 2050, h: 1700, c: '#e9e4dc' },
  cot: { n: 'Детская кроватка', g: 'Детская', w: 700, d: 1300, h: 950, c: '#f1efea' },
  // хранение
  wardrobe: { n: 'Шкаф 1,2 м', g: 'Хранение', w: 1200, d: 600, h: 2200, c: '#b88a62' },
  wardrobe2: { n: 'Шкаф-купе 1,8 м', g: 'Хранение', w: 1800, d: 650, h: 2400, c: '#d8d2c8', base: 'wardrobe' },
  shelf: { n: 'Стеллаж', g: 'Хранение', w: 1000, d: 400, h: 2000, c: WOOD },
  shelfLow: { n: 'Стеллаж низкий', g: 'Хранение', w: 1200, d: 400, h: 900, c: WOOD, base: 'shelf' },
  hallway: { n: 'Прихожая с вешалкой', g: 'Хранение', w: 1200, d: 400, h: 2000, c: '#d8d2c8' },
  shoe: { n: 'Обувница', g: 'Хранение', w: 900, d: 350, h: 600, c: '#d8d2c8', base: 'dresser' },
  // санузел
  saunaBench: { n: 'Полок двухъярусный', g: 'Сауна', w: 2200, d: 1200, h: 1050, c: '#dcb27a' },
  saunaBench1: { n: 'Полок одноярусный', g: 'Сауна', w: 1800, d: 600, h: 900, c: '#dcb27a', base: 'saunaBench' },
  saunaStove: { n: 'Печь-каменка', g: 'Сауна', w: 600, d: 600, h: 900, c: '#2b2d31' },
  saunaBucket: { n: 'Шайка с ковшом', g: 'Сауна', w: 350, d: 350, h: 300, c: '#b4875a' },
  toilet: { n: 'Унитаз', g: 'Санузел', w: 400, d: 650, h: 800, c: '#ffffff' },
  sink: { n: 'Раковина', g: 'Санузел', w: 600, d: 480, h: 850, c: '#ffffff' },
  sink2: { n: 'Двойная раковина', g: 'Санузел', w: 1200, d: 500, h: 850, c: '#ffffff', base: 'sink' },
  bath: { n: 'Ванна', g: 'Санузел', w: 1700, d: 750, h: 600, c: '#ffffff' },
  bathC: { n: 'Ванна угловая', g: 'Санузел', w: 1500, d: 1500, h: 600, c: '#ffffff' },
  shower: { n: 'Душевая', g: 'Санузел', w: 900, d: 900, h: 2000, c: '#dfe9ee' },
  washer: { n: 'Стиральная машина', g: 'Санузел', w: 600, d: 600, h: 850, c: '#f3f3f3' },
  dryer: { n: 'Сушильная машина', g: 'Санузел', w: 600, d: 600, h: 850, c: '#f3f3f3', base: 'washer' },
  towel: { n: 'Полотенцесушитель', g: 'Санузел', w: 500, d: 100, h: 800, c: '#c9c9c9', wall: 700 },
  // котельная
  boiler: { n: 'Газовый котёл', g: 'Котельная', w: 450, d: 350, h: 750, c: '#f3f3f3', wall: 900 },
  tank: { n: 'Бойлер', g: 'Котельная', w: 550, d: 550, h: 1300, c: '#e9e9e9' },
  // свет
  lampCeil: { n: 'Люстра', g: 'Свет', w: 600, d: 600, h: 250, c: '#f4efe4', ceil: true, light: 'ceil' },
  lampPend: { n: "Подвес над столом", g: "Свет", w: 1000, d: 250, h: 900, c: '#2f3237', ceil: true, light: 'pend' },
  lampFloor: { n: 'Торшер', g: 'Свет', w: 450, d: 450, h: 1600, c: '#f4efe4', light: 'floor' },
  lampTable: { n: 'Настольная лампа', g: 'Свет', w: 300, d: 300, h: 500, c: '#f4efe4', light: 'table', wall: 500 },
  // декор
  plant: { n: 'Растение', g: 'Декор', w: 450, d: 450, h: 900, c: '#6e8f55' },
  plantBig: { n: 'Большое растение', g: 'Декор', w: 700, d: 700, h: 1700, c: '#5f8048', base: 'plant' },
  picture: { n: 'Картина', g: 'Декор', w: 900, d: 40, h: 600, c: '#c9b28f', wall: 1300 },
  mirror: { n: 'Зеркало', g: 'Декор', w: 700, d: 30, h: 1500, c: '#cfdde6', wall: 500 },
  // терраса и улица
  oTable: { n: 'Уличный стол + 6 кресел', g: 'Терраса', w: 1800, d: 900, h: 740, c: '#8a6a4c', chairs: 6, base: 'table' },
  oChair: { n: 'Садовое кресло', g: 'Терраса', w: 650, d: 700, h: 800, c: '#8a6a4c', base: 'armchair' },
  oSofa: { n: 'Уличный диван', g: 'Терраса', w: 1900, d: 850, h: 750, c: '#d9d2c6', base: 'sofa' },
  lounger: { n: 'Шезлонг', g: 'Терраса', w: 700, d: 1900, h: 400, c: '#d9d2c6' },
  bbq: { n: 'Мангал', g: 'Терраса', w: 1000, d: 500, h: 900, c: '#2f3237' },
  umbrella: { n: 'Зонт', g: 'Терраса', w: 2500, d: 2500, h: 2400, c: '#efe9df' },
  car: { n: 'Автомобиль', g: 'Гараж', w: 1850, d: 4600, h: 1500, c: '#9aa0a8' },
};
DK.FURN_GROUPS = ['Гостиная', 'Кухня', 'Столовая', 'Спальня', 'Детская', 'Хранение', 'Санузел', 'Сауна', 'Котельная', 'Свет', 'Декор', 'Терраса', 'Гараж'];

DK.furnAngle = function (f) { return f.a != null ? f.a : (f.rot || 0) * 90; };
/* размер предмета: свой (f.w, f.d, f.h) или по каталогу */
DK.furnSize = function (f) {
  const F = DK.FURN[f.type] || { w: 500, d: 500, h: 500 };
  return { w: f.w || F.w, d: f.d || F.d, h: f.h || F.h };
};
/* пределы ручного размера: от 40 % до 250 % каталожного, не меньше 100 мм */
DK.furnClamp = function (base, v) { return Math.round(Math.max(Math.max(100, base * 0.4), Math.min(v, base * 2.5)) / 10) * 10; };
/* наполнение сауны: полок вдоль длинной стены, печь в дальнем углу */
DK.saunaFill = function (r) {
  const [x0, y0, x1, y1] = r.rect ? [r.x0, r.y0, r.x1, r.y1] : r.big, W = x1 - x0, D = y1 - y0, id = () => (DK.id ? DK.id('f') : 'f' + Math.random().toString(36).slice(2));
  const long = Math.max(W, D), short = Math.min(W, D), L = Math.round(Math.min(2200, long - 750) / 50) * 50, dep = short >= 1900 ? 1200 : 600, type = dep > 900 ? 'saunaBench' : 'saunaBench1';
  if (L < 900 || short < 1200) return [];
  const bench = W >= D ? { id: id(), type, x: x0 + 40 + L / 2, y: y0 + dep / 2 + 20, a: 0 } : { id: id(), type, x: x0 + dep / 2 + 20, y: y0 + 40 + L / 2, a: 270 };
  if (L !== DK.FURN[type].w) bench.w = L;
  return [bench, { id: id(), type: 'saunaStove', x: x1 - 380, y: y1 - 380, a: W >= D ? 180 : 90 }];
};
DK.KITCHENS = ['kitchen', 'kitchenS', 'kitchen3', 'kitchenL', 'kitchenU', 'kitchenNo', 'kitchenLNo'];
/* габарит на плане с учётом поворота (описанный прямоугольник) */
DK.furnBox = function (f) {
  const F = DK.furnSize(f), a = DK.furnAngle(f) * Math.PI / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const sw = F.w * c + F.d * s, sd = F.w * s + F.d * c;
  return { x0: f.x - sw / 2, y0: f.y - sd / 2, x1: f.x + sw / 2, y1: f.y + sd / 2, sw, sd };
};
/* точка внутри повёрнутого предмета */
DK.furnHit = function (f, x, y) {
  const F = DK.furnSize(f), a = -DK.furnAngle(f) * Math.PI / 180;
  const dx = x - f.x, dy = y - f.y, u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(u) <= F.w / 2 && Math.abs(v) <= F.d / 2;
};

/* 3D-модели: k — набор построителей (add — коробка, cyl — цилиндр), размеры в метрах, начало — центр предмета на полу */
DK.FURN3D = {
  bed160(k) {
    const { w, d, h, c } = k;
    k.add(w, 0.3, d, DARKW, 0, 0.15, 0); k.add(w - 0.06, 0.22, d - 0.12, '#f7f5f0', 0, 0.41, 0.04);
    k.add(w, h - 0.3, 0.08, DARKW, 0, 0.3 + (h - 0.3) / 2, -d / 2 + 0.04);
    k.add(w - 0.1, 0.06, d * 0.55, c, 0, 0.54, d * 0.2);
    for (const s of [-1, 1]) k.add(w / 2 - 0.15, 0.12, 0.35, '#ffffff', s * w / 4, 0.58, -d / 2 + 0.3);
  },
  bed90(k) {
    const { w, d, h, c } = k;
    k.add(w, 0.3, d, DARKW, 0, 0.15, 0); k.add(w - 0.06, 0.22, d - 0.12, '#f7f5f0', 0, 0.41, 0.04);
    k.add(w, h - 0.3, 0.08, DARKW, 0, 0.3 + (h - 0.3) / 2, -d / 2 + 0.04);
    k.add(w - 0.1, 0.06, d * 0.55, c, 0, 0.54, d * 0.2); k.add(w - 0.2, 0.12, 0.35, '#ffffff', 0, 0.58, -d / 2 + 0.3);
  },
  bunk(k) {
    const { w, d, c } = k;
    for (const y of [0.25, 1.35]) { k.add(w, 0.12, d, c, 0, y, 0); k.add(w - 0.06, 0.16, d - 0.1, '#f7f5f0', 0, y + 0.14, 0); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.06, 1.7, 0.06, c, sx * (w / 2 - 0.03), 0.85, sz * (d / 2 - 0.03));
    k.add(0.05, 1.2, 0.4, c, w / 2 - 0.03, 1.0, d / 2 - 0.4);
  },
  cot(k) { const { w, d, c } = k; k.add(w, 0.12, d, c, 0, 0.45, 0); for (const s of [-1, 1]) { k.add(w, 0.9, 0.03, c, 0, 0.45, s * d / 2); k.add(0.03, 0.9, d, c, s * w / 2, 0.45, 0); } },
  sofa(k) {
    const { w, d, h, c } = k;
    k.add(w, 0.42, d, c, 0, 0.21, 0); k.add(w, h - 0.42, 0.22, c, 0, 0.42 + (h - 0.42) / 2, -d / 2 + 0.11);
    k.add(0.18, 0.62, d, c, -w / 2 + 0.09, 0.31, 0); k.add(0.18, 0.62, d, c, w / 2 - 0.09, 0.31, 0);
    const n = Math.max(2, Math.round((w - 0.36) / 0.7));
    for (let i = 0; i < n; i++) k.add((w - 0.4) / n - 0.02, 0.12, d - 0.3, '#ddd9d2', -w / 2 + 0.2 + (w - 0.4) / n * (i + 0.5), 0.48, 0.08);
  },
  sofaOffice(k) {
    const { w, d, h, c } = k, y = 0.14;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.03, y, 0.03, METAL, sx * (w / 2 - 0.06), y / 2, sz * (d / 2 - 0.06));
    k.add(w, 0.12, d, c, 0, y + 0.06, 0); k.add(w - 0.2, 0.12, d - 0.2, c, 0, y + 0.18, 0.06);
    k.add(w, h - y - 0.12, 0.16, c, 0, y + 0.12 + (h - y - 0.12) / 2, -d / 2 + 0.08);
    for (const sx of [-1, 1]) k.add(0.1, 0.42, d, c, sx * (w / 2 - 0.05), y + 0.21, 0);
    k.add(0.008, 0.11, d - 0.22, '#4a4e55', 0, y + 0.19, 0.06);
  },
  sofaL(k) {
    const { w, d, h, c } = k, s = 0.95;
    k.add(w, 0.42, s, c, 0, 0.21, -d / 2 + s / 2); k.add(s, 0.42, d - s, c, w / 2 - s / 2, 0.21, s / 2);
    k.add(w, h - 0.42, 0.22, c, 0, 0.42 + (h - 0.42) / 2, -d / 2 + 0.11); k.add(0.22, h - 0.42, d, c, w / 2 - 0.11, 0.42 + (h - 0.42) / 2, 0);
    k.add(0.18, 0.62, s, c, -w / 2 + 0.09, 0.31, -d / 2 + s / 2);
  },
  armchair(k) { const { w, d, h, c } = k; k.add(w, 0.42, d, c, 0, 0.21, 0); k.add(w, h - 0.42, 0.2, c, 0, 0.42 + (h - 0.42) / 2, -d / 2 + 0.1); k.add(0.15, 0.6, d, c, -w / 2 + 0.075, 0.3, 0); k.add(0.15, 0.6, d, c, w / 2 - 0.075, 0.3, 0); },
  pouf(k) { k.cyl(k.w / 2, k.h, k.c, 0, k.h / 2, 0); },
  tv(k) {
    const { w, d, c } = k, sw = Math.min(1.6, w * 0.75);
    k.add(w, 0.45, d, c, 0, 0.225, 0); k.add(w - 0.04, 0.005, d - 0.04, '#5b4330', 0, 0.452, 0);
    k.add(sw, sw * 9 / 16, 0.04, '#141518', 0, 0.62 + sw * 9 / 32, -d / 2 + 0.08);
    k.add(0.3, 0.12, 0.18, METAL, 0, 0.51, -d / 2 + 0.12);
  },
  coffee(k) { const { w, d, h, c } = k; k.add(w, 0.04, d, c, 0, h - 0.02, 0); k.add(w - 0.1, 0.03, d - 0.1, c, 0, 0.12, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.04, h - 0.04, 0.04, METAL, sx * (w / 2 - 0.05), (h - 0.04) / 2, sz * (d / 2 - 0.05)); },
  coffeeR(k) { k.cyl(k.w / 2, 0.04, k.c, 0, k.h - 0.02, 0); k.cyl(0.05, k.h, METAL, 0, k.h / 2, 0); k.cyl(0.22, 0.02, METAL, 0, 0.01, 0); },
  fireplace(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.add(w * 0.55, h * 0.45, 0.06, '#1b1b1b', 0, 0.2 + h * 0.225, d / 2 - 0.02); k.add(w + 0.1, 0.06, d + 0.06, '#cfcac2', 0, h + 0.03, 0); k.add(w * 0.4, 0.12, 0.06, '#ff9b42', 0, 0.28, d / 2 - 0.05, 0, { glow: '#ff7a1a' }); },
  rug(k) { k.add(k.w, 0.012, k.d, k.c, 0, 0.006, 0); k.add(k.w - 0.16, 0.013, k.d - 0.16, '#cbbca3', 0, 0.007, 0); },
  kitchen(k) {
    const { w, d, c } = k;
    k.add(w, 0.86, d, c, 0, 0.43, 0); k.add(w + 0.02, 0.04, d + 0.02, '#d8d4cc', 0, 0.88, 0);
    k.add(0.55, 0.01, 0.45, METAL, -w / 2 + 0.9, 0.905, 0); k.add(0.5, 0.02, 0.4, '#c9cfd3', w / 2 - 0.6, 0.9, 0);
    if (k.upper) k.add(w, 0.72, 0.35, c, 0, 1.5 + 0.36, -d / 2 + 0.175);
    for (let x = -w / 2 + 0.6; x < w / 2 - 0.01; x += 0.6) k.add(0.008, 0.82, 0.005, '#c9c5bd', x, 0.43, d / 2 + 0.003);
  },
  kitchenL(k) {
    const { w, d, c } = k, s = 0.6;
    k.add(w, 0.86, s, c, 0, 0.43, -d / 2 + s / 2); k.add(s, 0.86, d - s, c, -w / 2 + s / 2, 0.43, s / 2);
    k.add(w + 0.02, 0.04, s + 0.02, '#d8d4cc', 0, 0.88, -d / 2 + s / 2); k.add(s + 0.02, 0.04, d - s, '#d8d4cc', -w / 2 + s / 2, 0.88, s / 2);
    k.add(0.55, 0.01, 0.45, METAL, w / 2 - 0.8, 0.905, -d / 2 + s / 2); k.add(0.4, 0.02, 0.5, '#c9cfd3', -w / 2 + s / 2, 0.9, d / 2 - 0.6);
    if (k.upper) { k.add(w, 0.72, 0.35, c, 0, 1.86, -d / 2 + 0.175); k.add(0.35, 0.72, d - 0.35, c, -w / 2 + 0.175, 1.86, 0.175); }
  },
  kitchenU(k) {
    const { w, d, c } = k, s = 0.6;
    k.add(w, 0.86, s, c, 0, 0.43, -d / 2 + s / 2); k.add(s, 0.86, d - s, c, -w / 2 + s / 2, 0.43, s / 2); k.add(s, 0.86, d - s, c, w / 2 - s / 2, 0.43, s / 2);
    k.add(w + 0.02, 0.04, s + 0.02, '#d8d4cc', 0, 0.88, -d / 2 + s / 2); k.add(s + 0.02, 0.04, d - s, '#d8d4cc', -w / 2 + s / 2, 0.88, s / 2); k.add(s + 0.02, 0.04, d - s, '#d8d4cc', w / 2 - s / 2, 0.88, s / 2);
    k.add(0.55, 0.01, 0.45, METAL, 0, 0.905, -d / 2 + s / 2); if (k.upper) k.add(w, 0.72, 0.35, c, 0, 1.86, -d / 2 + 0.175);
  },
  island(k) { const { w, d, c } = k; k.add(w, 0.86, d, c, 0, 0.43, 0); k.add(w + 0.1, 0.04, d + 0.1, '#d8d4cc', 0, 0.88, 0); },
  fridge(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.add(w - 0.02, 0.005, 0.005, '#bdbdbb', 0, h * 0.62, d / 2 + 0.003); k.add(0.02, 0.4, 0.03, '#a9a9a7', w / 2 - 0.06, h * 0.75, d / 2 + 0.015); },
  barstool(k) { k.cyl(0.19, 0.05, METAL, 0, k.h, 0); k.cyl(0.025, k.h, METAL, 0, k.h / 2, 0); k.cyl(0.2, 0.02, METAL, 0, 0.01, 0); },
  table(k) {
    const { w, d, h, c, F } = k;
    k.add(w, 0.04, d, c, 0, h - 0.02, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.06, h - 0.04, 0.06, c, sx * (w / 2 - 0.08), (h - 0.04) / 2, sz * (d / 2 - 0.08));
    const n = F.chairs || 0, per = Math.max(1, Math.floor((n - (n >= 6 ? 2 : 0)) / 2)), cc = F.g === 'Терраса' ? '#8a6a4c' : '#d9d2c6';
    for (const sz of [-1, 1]) for (let i = 0; i < per; i++) { const x = -w / 2 + w / per * (i + 0.5); k.chair(x, sz * (d / 2 + 0.2), sz > 0 ? 0 : Math.PI, cc); }
    if (n >= 6) for (const sx of [-1, 1]) k.chair(sx * (w / 2 + 0.2), 0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, cc);
  },
  tableR(k) {
    const { w, h, c, F } = k;
    k.cyl(w / 2, 0.04, c, 0, h - 0.02, 0); k.cyl(0.06, h - 0.04, c, 0, (h - 0.04) / 2, 0); k.cyl(0.3, 0.03, c, 0, 0.015, 0);
    const n = F.chairs || 4;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / 4, r = w / 2 + 0.18; k.chair(Math.cos(a) * r, Math.sin(a) * r, -a + Math.PI / 2, '#d9d2c6'); }
  },
  chair(k) { k.chair(0, 0, 0, k.c); },
  bench(k) { const { w, d, h, c } = k; k.add(w, 0.05, d, c, 0, h - 0.025, 0); for (const s of [-1, 1]) k.add(0.06, h - 0.05, d - 0.04, c, s * (w / 2 - 0.1), (h - 0.05) / 2, 0); },
  nightstand(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.add(w - 0.04, 0.005, 0.005, '#7b5a3e', 0, h * 0.55, d / 2 + 0.003); },
  dresser(k) { const { w, d, h, c } = k; k.add(w, h - 0.08, d, c, 0, 0.08 + (h - 0.08) / 2, 0); for (let i = 1; i < 3; i++) k.add(w - 0.04, 0.005, 0.005, '#7b5a3e', 0, 0.08 + (h - 0.08) * i / 3, d / 2 + 0.003); for (const sx of [-1, 1]) k.add(0.04, 0.08, 0.04, METAL, sx * (w / 2 - 0.05), 0.04, 0); },
  vanity(k) { const { w, d, h, c } = k; k.add(w, 0.04, d, c, 0, h - 0.02, 0); for (const s of [-1, 1]) k.add(0.04, h - 0.04, d, c, s * (w / 2 - 0.02), (h - 0.04) / 2, 0); k.add(0.6, 0.8, 0.03, '#cfdde6', 0, h + 0.5, -d / 2 + 0.02); },
  desk(k) { const { w, d, h, c } = k; k.add(w, 0.04, d, c, 0, h - 0.02, 0); k.add(0.4, h - 0.04, d - 0.02, c, w / 2 - 0.2, (h - 0.04) / 2, 0); k.add(0.03, h - 0.04, d - 0.06, METAL, -w / 2 + 0.03, (h - 0.04) / 2, 0); k.add(0.5, 0.32, 0.03, '#141518', 0, h + 0.22, -d / 2 + 0.12); },
  ochair(k) { k.add(0.5, 0.08, 0.5, METAL, 0, 0.47, 0); k.add(0.5, 0.55, 0.08, METAL, 0, 0.78, -0.22); k.cyl(0.03, 0.42, '#888', 0, 0.22, 0); k.cyl(0.28, 0.03, '#555', 0, 0.03, 0); },
  wardrobe(k) {
    const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0);
    const n = Math.max(2, Math.round(w / 0.6));
    for (let i = 1; i < n; i++) k.add(0.006, h - 0.1, 0.005, '#8d6a4b', -w / 2 + w * i / n, h / 2, d / 2 + 0.003);
    for (let i = 0; i < n; i++) k.add(0.015, 0.3, 0.02, METAL, -w / 2 + w * (i + 0.5) / n + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), h * 0.5, d / 2 + 0.012);
  },
  shelf(k) {
    const { w, d, h, c } = k, n = Math.max(2, Math.round(h / 0.4)), gap = (h - 0.025) / n;
    for (const s of [-1, 1]) k.add(0.03, h, d, c, s * (w / 2 - 0.015), h / 2, 0);
    k.add(w - 0.06, h, 0.01, c, 0, h / 2, -d / 2 + 0.005);
    for (let i = 0; i <= n; i++) k.add(w - 0.06, 0.025, d, c, 0, 0.0125 + gap * i, 0);
    // книги стоят на полке плотными рядами и не выходят за боковины
    const books = ['#7d4b3a', '#3e5566', '#c9b28f', '#556b4f', '#a88f74', '#2f3a45'], x0 = -w / 2 + 0.04, x1 = w / 2 - 0.04;
    for (let i = 0; i < n; i++) {
      let x = x0 + ((i * 0.07) % 0.12), b = i * 5;
      const top = 0.025 + gap * i, hmax = Math.min(0.3, gap - 0.05);
      while (x < x1) {
        const bw = 0.025 + (b * 7 % 5) * 0.008, bh = hmax * (0.72 + (b * 3 % 4) * 0.08), bd = Math.min(d - 0.06, 0.24);
        if (x + bw > x1) break;
        if ((b + i) % 9 === 8) { x += 0.08 + (i % 3) * 0.05; b++; continue; }
        k.add(bw, bh, bd, books[b % books.length], x + bw / 2, top + bh / 2, -d / 2 + 0.01 + bd / 2 + 0.01);
        x += bw + 0.003; b++;
      }
    }
  },
  saunaBench(k) {
    const { w, d, h, c } = k, two = d > 0.9, leg = '#b88a5a';
    // ярусы из реек: нижний спереди, верхний у стены; доска-спинка на стене
    const tier = (y, z0, z1) => { const n = Math.max(3, Math.round((z1 - z0) / 0.1)); for (let i = 0; i < n; i++) k.add(w, 0.03, (z1 - z0) / n - 0.012, c, 0, y, z0 + (z1 - z0) * (i + 0.5) / n);
      for (const sx of [-1, 0, 1]) k.add(0.05, y - 0.015, 0.05, leg, sx * (w / 2 - 0.05), (y - 0.015) / 2, z1 - 0.05); };
    if (two) { tier(0.45, 0, d / 2); tier(h, -d / 2, 0); k.add(w, 0.45, 0.03, c, 0, 0.225, 0.01); }
    else tier(h * 0.5, -d / 2, d / 2);
    for (let i = 0; i < 3; i++) k.add(w, 0.08, 0.02, c, 0, (two ? h : h * 0.5) + 0.25 + i * 0.14, -d / 2 + 0.01);
  },
  saunaStove(k) {
    const { w, d, h, c } = k;
    k.add(w * 0.8, h * 0.62, d * 0.8, c, 0, h * 0.31, 0); k.add(w * 0.82, 0.03, d * 0.82, '#1b1c1f', 0, h * 0.62, 0);
    k.add(w * 0.3, 0.12, 0.02, '#ff8a3d', 0, h * 0.2, d * 0.4 + 0.005, 0, { glow: '#ff6a1a' });
    k.add(w * 0.8, h * 0.3, d * 0.8, '#3a3c40', 0, h * 0.62 + h * 0.15, 0);
    for (let i = 0; i < 14; i++) k.ball(0.055 + (i % 3) * 0.012, ['#77736c', '#5f5b55', '#8b867e'][i % 3], ((i * 37) % 9 / 9 - 0.45) * w * 0.65, h * 0.93 + (i % 2) * 0.03, ((i * 53) % 7 / 7 - 0.43) * d * 0.65);
    for (const sx of [-1, 1]) k.add(0.03, h * 0.8, d + 0.12, '#b88a5a', sx * (w / 2 + 0.06), h * 0.4, 0);
    k.add(w + 0.15, h * 0.8, 0.03, '#b88a5a', 0, h * 0.4, d / 2 + 0.06);
  },
  saunaBucket(k) { k.cyl(k.w / 2, k.h * 0.75, k.c, 0, k.h * 0.375, 0); k.cyl(0.02, 0.3, '#8a6a4c', k.w * 0.2, k.h * 0.9, 0, 0.9); },
  hallway(k) { const { w, d, h, c } = k; k.add(w * 0.5, h, d, c, -w / 4, h / 2, 0); k.add(w * 0.5, 0.45, d, c, w / 4, 0.225, 0); k.add(w * 0.5, 0.03, 0.25, c, w / 4, 1.75, -d / 2 + 0.125); for (let i = 0; i < 3; i++) k.add(0.02, 0.1, 0.06, METAL, w / 4 - 0.15 + i * 0.15, 1.65, -d / 2 + 0.05); k.add(w * 0.45, 0.9, 0.02, '#cfdde6', w / 4, 1.1, -d / 2 + 0.01); },
  toilet(k) { const { w, d, c } = k; k.add(w * 0.9, 0.4, 0.2, c, 0, 0.6, -d / 2 + 0.1); k.add(w * 0.85, 0.4, d - 0.2, c, 0, 0.2, 0.1); },
  sink(k) { const { w, d, h, c } = k; k.add(w, 0.15, d, c, 0, h - 0.075, 0); k.add(w * 0.9, h - 0.15, d * 0.8, '#c9b79c', 0, (h - 0.15) / 2, 0); k.add(Math.min(0.6, w * 0.8), 0.8, 0.02, '#cfdde6', 0, h + 0.55, -d / 2 + 0.01); },
  bath(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.add(w - 0.12, 0.02, d - 0.12, '#cfe3ec', 0, h - 0.04, 0); },
  bathC(k) { const { w, d, h, c } = k; k.add(w, h, d / 2, c, 0, h / 2, -d / 4); k.add(w / 2, h, d / 2, c, -w / 4, h / 2, d / 4); k.add(w - 0.15, 0.02, d / 2 - 0.1, '#cfe3ec', 0, h - 0.04, -d / 4); },
  shower(k) { const { w, d, c } = k; k.add(w, 0.06, d, c, 0, 0.03, 0); k.glass(w, 1.95, 0.01, 0, 1.0, d / 2); k.glass(0.01, 1.95, d, w / 2, 1.0, 0); k.cyl(0.1, 0.02, '#c9c9c9', 0, 1.95, -d / 2 + 0.15); },
  washer(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.cyl(0.18, 0.02, '#9fb3bf', 0, h * 0.5, d / 2 + 0.01, Math.PI / 2); },
  towel(k) { const { w, h, c } = k; for (let i = 0; i < 6; i++) k.add(w, 0.02, 0.02, c, 0, 0.05 + i * (h - 0.1) / 5, 0); for (const s of [-1, 1]) k.add(0.025, h, 0.025, c, s * w / 2, h / 2, 0); },
  boiler(k) { const { w, d, h, c } = k; k.add(w, h, d, c, 0, h / 2, 0); k.add(0.08, 1.0, 0.08, '#c9c9c9', 0, h + 0.5, -d / 4); },
  tank(k) { k.cyl(k.w / 2, k.h, k.c, 0, k.h / 2, 0); },
  lampCeil(k) { k.cyl(0.03, 0.25, '#c9c9c9', 0, 0.125, 0); k.cyl(k.w / 2, 0.14, k.c, 0, 0.0, 0, 0, true); },
  lampPend(k) { for (const x of [-0.3, 0, 0.3]) { k.cyl(0.005, 0.7, '#222', x, 0.35, 0); k.cyl(0.11, 0.16, k.c, x, -0.05, 0, 0, true); } },
  lampFloor(k) { k.cyl(0.16, 0.03, '#2f3237', 0, 0.015, 0); k.cyl(0.015, 1.4, '#2f3237', 0, 0.7, 0); k.cyl(0.2, 0.3, k.c, 0, 1.5, 0, 0, true); },
  lampTable(k) { k.cyl(0.08, 0.03, '#b9a27f', 0, 0.015, 0); k.cyl(0.015, 0.3, '#b9a27f', 0, 0.16, 0); k.cyl(0.13, 0.2, k.c, 0, 0.38, 0, 0, true); },
  plant(k) { const { w, h, c } = k; k.cyl(w * 0.32, h * 0.3, '#e9e4dc', 0, h * 0.15, 0); k.cyl(0.02, h * 0.4, '#6b4f36', 0, h * 0.45, 0); k.ball(w * 0.5, c, 0, h * 0.72, 0); k.ball(w * 0.36, c, w * 0.15, h * 0.9, 0.05); },
  picture(k) { const { w, h, c } = k; k.add(w, h, 0.03, '#2f3237', 0, h / 2, 0); k.add(w - 0.06, h - 0.06, 0.035, c, 0, h / 2, 0.002); },
  mirror(k) { const { w, h, c } = k; k.add(w, h, 0.03, '#b9a27f', 0, h / 2, 0); k.add(w - 0.05, h - 0.05, 0.034, c, 0, h / 2, 0.002); },
  lounger(k) { const { w, d, c } = k; k.add(w, 0.08, d * 0.7, c, 0, 0.3, d * 0.15); const b = k.add(w, 0.08, d * 0.35, c, 0, 0.5, -d * 0.33); b.rotation.x = 0.6; for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.04, 0.28, 0.04, '#8a6a4c', sx * (w / 2 - 0.04), 0.14, sz * (d / 2 - 0.1)); },
  bbq(k) { const { w, d, h, c } = k; k.add(w, 0.25, d, c, 0, h - 0.125, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.03, h - 0.25, 0.03, c, sx * (w / 2 - 0.03), (h - 0.25) / 2, sz * (d / 2 - 0.03)); },
  umbrella(k) { k.cyl(0.025, 2.3, '#c9c9c9', 0, 1.15, 0); k.cyl(1.25, 0.12, k.c, 0, 2.3, 0); k.cyl(0.25, 0.08, '#555', 0, 0.04, 0); },
  car(k) { const { w, d, c } = k; k.add(w, 0.75, d, c, 0, 0.55, 0); k.add(w * 0.88, 0.5, d * 0.5, '#59606a', 0, 1.15, 0.1); for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(0.22, 0.6, 0.6, METAL, sx * (w / 2 - 0.12), 0.3, sz * (d / 2 - 0.8)); },
};
})();
