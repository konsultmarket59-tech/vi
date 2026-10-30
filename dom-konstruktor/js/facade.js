/* Отделка фасада: материалы по зонам и готовые сочетания. Цвет любой зоны меняется отдельно. */
(function () {
'use strict';
const DK = window.DK = window.DK || {};

DK.WALL_MATS = {
  plaster: 'Штукатурка', smooth: 'Гладкая окраска', brick: 'Кирпич', stone: 'Камень (рваный)', ledge: 'Камень (плитняк)',
  siding: 'Сайдинг горизонтальный', bnb: 'Сайдинг вертикальный', planken: 'Планкен', panel: 'Фиброцементные панели',
};
DK.ROOF_MATS = { shingle: 'Гибкая черепица', mtile: 'Металлочерепица', falz: 'Фальцевая кровля', smooth: 'Гладкая' };
DK.ROOFS = {
  gable: { n: 'Двускатная', pitch: 30 },
  hip: { n: 'Вальмовая', pitch: 25 },
  mansard: { n: 'Ломаная мансардная', pitch: 25 },
  halfhip: { n: 'Полувальмовая', pitch: 35 },
  pyramid: { n: 'Шатровая', pitch: 30 },
  shed: { n: 'Односкатная', pitch: 10 },
  flat: { n: 'Плоская', pitch: 0 },
};
DK.ACCENT_ON = { none: 'Нет', upper: 'Верхний этаж', lower: 'Первый этаж', wings: 'Выступы и крылья' };

/* zones: main — основной, accent — второй материал, plinth — цоколь и низ стен, gable — фронтоны, roof — кровля;
   frame — рамы окон, trim — наличники/пояс/уголки, door — входная дверь, soffit — подшива свеса */
const F = (o) => Object.assign({ accentOn: 'none', wainscot: 0, surrounds: false, belt: false, corners: false, soffit: '#f2f2f0', gable: null }, o);
DK.FACADES = {
  white: { n: 'Белая модель', f: F({ main: { m: 'smooth', c: '#f3f2ef' }, accent: { m: 'smooth', c: '#f3f2ef' }, plinth: { m: 'smooth', c: '#d9d8d4' }, roof: { m: 'smooth', c: '#e2e2df' }, frame: '#ffffff', trim: '#ffffff', door: '#d9d6cf', soffit: '#f6f6f4' }) },
  contrast: { n: 'Контраст', f: F({ main: { m: 'plaster', c: '#ecebe6' }, accent: { m: 'plaster', c: '#2f2f31' }, plinth: { m: 'ledge', c: '#3d3d40' }, roof: { m: 'shingle', c: '#2b2c30' }, frame: '#2d2d30', trim: '#2d2d30', door: '#2d2d30', soffit: '#2d2d30', accentOn: 'wings', wainscot: 900 }) },
  twotone: { n: 'Два тона', f: F({ main: { m: 'plaster', c: '#f4f3f1' }, accent: { m: 'plaster', c: '#6e5f69' }, plinth: { m: 'smooth', c: '#2f2a2c' }, roof: { m: 'mtile', c: '#4a2c30' }, frame: '#3b2629', trim: '#3b2629', door: '#3b2629', soffit: '#3b2629', accentOn: 'lower', surrounds: true, belt: true }) },
  beige: { n: 'Беж и шоколад', f: F({ main: { m: 'plaster', c: '#e9caa4' }, accent: { m: 'plaster', c: '#7b4a33' }, plinth: { m: 'smooth', c: '#7b4a33' }, roof: { m: 'mtile', c: '#4b3127' }, frame: '#5a3627', trim: '#7b4a33', door: '#5a3627', soffit: '#5a3627', surrounds: true, corners: true }) },
  american: { n: 'Американская классика', f: F({ main: { m: 'siding', c: '#6d7e6c' }, accent: { m: 'ledge', c: '#cfc8bb' }, plinth: { m: 'ledge', c: '#c5beb1' }, roof: { m: 'shingle', c: '#4b4e54' }, frame: '#ffffff', trim: '#ffffff', door: '#5a3424', soffit: '#ffffff', accentOn: 'wings', surrounds: true, corners: true }) },
  craftsman: { n: 'Крафтсман', f: F({ main: { m: 'siding', c: '#8e9297' }, accent: { m: 'bnb', c: '#8e9297' }, plinth: { m: 'stone', c: '#8b7b67' }, gable: { m: 'bnb', c: '#8e9297' }, roof: { m: 'shingle', c: '#69696b' }, frame: '#ffffff', trim: '#ffffff', door: '#25262a', soffit: '#ffffff', wainscot: 1000, surrounds: true, corners: true }) },
  modern: { n: 'Современный', f: F({ main: { m: 'plaster', c: '#ebe8e2' }, accent: { m: 'planken', c: '#9b6a42' }, plinth: { m: 'panel', c: '#4a4d52' }, roof: { m: 'falz', c: '#3a3d42' }, frame: '#3b3e44', trim: '#3b3e44', door: '#3b3e44', soffit: '#3b3e44', accentOn: 'upper' }) },
  brick: { n: 'Кирпичный', f: F({ main: { m: 'brick', c: '#9c4f3a' }, accent: { m: 'brick', c: '#9c4f3a' }, plinth: { m: 'stone', c: '#5f5a55' }, roof: { m: 'mtile', c: '#3d3a39' }, frame: '#f4f4f4', trim: '#e9e4dc', door: '#4a3a2e', soffit: '#e9e4dc', surrounds: true, belt: true }) },
  scandi: { n: 'Скандинавский', f: F({ main: { m: 'bnb', c: '#2f3134' }, accent: { m: 'bnb', c: '#2f3134' }, plinth: { m: 'smooth', c: '#262729' }, roof: { m: 'falz', c: '#222325' }, frame: '#1d1e20', trim: '#1d1e20', door: '#a4744a', soffit: '#2f3134' }) },
  chalet: { n: 'Шале', f: F({ main: { m: 'planken', c: '#a4744a' }, accent: { m: 'stone', c: '#a29c92' }, plinth: { m: 'stone', c: '#77716a' }, roof: { m: 'shingle', c: '#4b3a2e' }, frame: '#5a3d26', trim: '#5a3d26', door: '#5a3d26', soffit: '#a4744a', accentOn: 'lower' }) },
  hitech: { n: 'Хай-тек', f: F({ main: { m: 'panel', c: '#f1f1f0' }, accent: { m: 'panel', c: '#3b3e44' }, plinth: { m: 'smooth', c: '#2f3237' }, roof: { m: 'smooth', c: '#55585d' }, frame: '#2b2d31', trim: '#2b2d31', door: '#2b2d31', soffit: '#2b2d31', accentOn: 'lower' }) },
};
/* стили прежней версии → ближайшее сочетание */
const OLD = { classic: 'beige' };
DK.facadeOf = function (p) {
  if (p.facade) return p.facade;
  const k = DK.FACADES[p.style] ? p.style : OLD[p.style] || 'white';
  return DK.FACADES[k].f;
};
DK.FACADE_ZONES = [
  ['main', 'Стены'], ['accent', 'Акцент'], ['plinth', 'Цоколь'], ['gable', 'Фронтоны'], ['roof', 'Кровля'],
];
DK.FACADE_COLORS = [['frame', 'Рамы окон'], ['trim', 'Наличники, пояс, уголки'], ['door', 'Входная дверь'], ['soffit', 'Подшива свеса']];
})();
