// Фреймы — заготовки под виды полиграфии и сувенирки: размер, вылеты, безопасное поле,
// фальцы, контур реза. Свои фреймы запоминаются из файла-конструктора (CDR, PDF, AI, SVG,
// например «футболка» сувенирного сервиса): дальше достаточно выбрать фрейм, а не искать файл.
'use strict';

const FRAMES = [
  ['Листовки и флаеры', [
    ['A4 листовка', 210, 297, 2, 3], ['A5 листовка', 148, 210, 2, 3], ['A6 флаер', 105, 148, 2, 3], ['Евро-флаер 99×210', 99, 210, 2, 3],
    ['Евро-флаер горизонтальный', 210, 99, 2, 3], ['Квадрат 200×200', 200, 200, 2, 3], ['Квадрат 148×148', 148, 148, 2, 3]]],
  ['Визитки', [['Визитка 90×50', 90, 50, 2, 4], ['Евровизитка 85×55', 85, 55, 2, 4], ['Визитка вертикальная 50×90', 50, 90, 2, 4], ['Визитка квадратная 65×65', 65, 65, 2, 4]]],
  ['Буклеты (с фальцами)', [
    ['Евробуклет A4, 2 фальца', 297, 210, 2, 4, [['v', 99, 'Фальц 1'], ['v', 198, 'Фальц 2']], 2],
    ['Буклет A4, 1 фальц (A5)', 297, 210, 2, 4, [['v', 148.5, 'Фальц']], 2],
    ['Буклет A3, 1 фальц (A4)', 420, 297, 2, 4, [['v', 210, 'Фальц']], 2],
    ['Буклет A4 вертикальный, 1 фальц', 210, 297, 2, 4, [['h', 148.5, 'Фальц']], 2],
    ['Открытка A6 со сгибом', 210, 148, 2, 4, [['v', 105, 'Сгиб']], 2]]],
  ['Плакаты и афиши', [['A3', 297, 420, 2, 5], ['A2', 420, 594, 3, 10], ['A1', 594, 841, 3, 10], ['A0', 841, 1189, 3, 15], ['Постер 500×700', 500, 700, 3, 10], ['Постер 600×900', 600, 900, 3, 10]]],
  ['Баннеры и широкий формат', [['Баннер 3×6 м', 6000, 3000, 0, 50], ['Баннер 1×3 м', 3000, 1000, 0, 50], ['Ролл-ап 850×2000', 850, 2000, 0, 30, [['h', 2000 - 100, 'Ниже — уходит в основание']]], ['Ролл-ап 1000×2000', 1000, 2000, 0, 30], ['X-баннер 600×1600', 600, 1600, 0, 30], ['X-баннер 800×1800', 800, 1800, 0, 30], ['Штендер A1', 594, 841, 3, 20]]],
  ['Наклейки и этикетки', [['Наклейка 100×100', 100, 100, 2, 3], ['Наклейка круглая ⌀50', 50, 50, 2, 3, null, 1, 'circle'], ['Наклейка круглая ⌀100', 100, 100, 2, 3, null, 1, 'circle'], ['Этикетка 70×100', 70, 100, 2, 3], ['Этикетка 58×40', 58, 40, 1, 2]]],
  ['Конверты и бланки', [['Конверт DL 220×110', 220, 110, 2, 5], ['Конверт C5 229×162', 229, 162, 2, 5], ['Конверт C4 324×229', 324, 229, 2, 5], ['Бланк A4', 210, 297, 0, 10]]],
  ['Календари', [['Карманный календарь 70×100', 70, 100, 2, 3, null, 1, 'round'], ['Квартальный: шапка 297×210', 297, 210, 3, 5], ['Квартальный: календарная сетка 297×145', 297, 145, 3, 5], ['Перекидной A3', 297, 420, 3, 10], ['Домик 200×100 (со сгибом)', 200, 200, 2, 4, [['h', 100, 'Сгиб']]]]],
  ['Меню и папки', [['Меню A4', 210, 297, 2, 4], ['Меню A3 со сгибом', 420, 297, 2, 4, [['v', 210, 'Сгиб']]], ['Папка A4 (развёртка)', 450, 330, 3, 5, [['v', 225, 'Корешок']]]]],
  ['Сувенирка', [
    ['Кружка 330 мл — запечатка 200×95', 200, 95, 0, 3], ['Кружка-хамелеон 200×85', 200, 85, 0, 3], ['Термостакан 220×160', 220, 160, 0, 3],
    ['Футболка — печать A3 (спина/грудь)', 297, 420, 0, 5], ['Футболка — печать A4', 210, 297, 0, 5], ['Футболка — логотип на грудь 100×100', 100, 100, 0, 3],
    ['Кепка — передняя панель 100×60', 100, 60, 0, 3], ['Шоппер — печать 300×350', 300, 350, 0, 10], ['Подушка 400×400', 400, 400, 10, 20],
    ['Коврик для мыши 220×180', 220, 180, 2, 5, null, 1, 'round'], ['Магнит 70×100', 70, 100, 2, 3], ['Значок закатной ⌀56 (с заворотом)', 68, 68, 0, 9, null, 1, 'circle'],
    ['Пазл A4', 210, 297, 3, 5], ['Брелок 40×60', 40, 60, 1, 3, null, 1, 'round'], ['Флешка (лого) 40×15', 40, 15, 0, 1], ['Ручка (лого) 45×7', 45, 7, 0, 0.5]]],
  ['Соцсети и экран (96 dpi)', [['Пост 1080×1080', 285.75, 285.75, 0, 10], ['Сторис 1080×1920', 285.75, 508, 0, 30], ['Обложка 1920×1080', 508, 285.75, 0, 10], ['Обложка ВК 1590×530', 420.69, 140.23, 0, 10]]],
];

const Frames = {
  // ---------- свои фреймы (IndexedDB) ----------
  db() {
    return Frames._db || (Frames._db = new Promise((res, rej) => {
      const r = indexedDB.open('vektor-frames', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('frames', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) { const db = await Frames.db(); return new Promise((res, rej) => { const t = db.transaction('frames', mode); const q = fn(t.objectStore('frames')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); },
  list() { return Frames.tx('readonly', s => s.getAll()).then(x => x || []).catch(() => []); },
  put(f) { return Frames.tx('readwrite', s => s.put(f)); },
  del(id) { return Frames.tx('readwrite', s => s.delete(id)); },

  builtin() {
    const out = [];
    for (const [cat, items] of FRAMES) for (const [name, w, hh, bleed, safe, folds, pages, cut] of items) out.push({ id: 'b:' + name, cat, name, w, h: hh, bleed, safe, folds: (folds || []).map(([axis, pos, nm]) => ({ axis, pos, name: nm })), cut, builtin: true });
    return out;
  },
  cutPath(f) {
    if (f.cut === 'circle') return `M${f.w / 2} 0A${f.w / 2} ${f.h / 2} 0 1 1 ${f.w / 2 - 0.001} 0Z`;
    if (f.cut === 'round') { const r = Math.min(f.w, f.h) * 0.08; return `M${r} 0H${f.w - r}A${r} ${r} 0 0 1 ${f.w} ${r}V${f.h - r}A${r} ${r} 0 0 1 ${f.w - r} ${f.h}H${r}A${r} ${r} 0 0 1 0 ${f.h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`; }
    return null;
  },
  // применить фрейм к странице
  apply(P, f) {
    P.w = f.w; P.h = f.h;
    P.print = { bleed: f.bleed || 0, safe: f.safe || 0 };
    P.folds = structuredClone(f.folds || []);
    const cut = Frames.cutPath(f); P.cuts = cut ? [cut] : [];
    P.frame = f.name;
    P.layers = P.layers.filter(L => !L.frame);
    if (f.objects && f.objects.length) {
      // слой фрейма: виден и заблокирован, при печати не выводится, в CDR сохраняется
      const objs = structuredClone(f.objects);
      const re = x => { x.id = Model.newId(); if (x.children) x.children.forEach(re); if (x.container) re(x.container); };
      objs.forEach(re);
      P.layers.push({ id: 'L' + Date.now().toString(36), name: 'Фрейм: ' + f.name, visible: true, locked: true, noPrint: !!f.noPrint, frame: true, objects: objs });
    }
  },
  newDoc(f) {
    Docs.begin();
    const P = App.pg();
    Frames.apply(P, f);
    App.doc.name = f.name;
    App.commit('Новый: ' + f.name); App.zoomPage(); UI.refresh();
  },

  // ---------- галерея ----------
  async dialog() {
    const custom = await Frames.list();
    const all = [...custom.map(f => Object.assign({ cat: 'Мои фреймы' }, f)), ...Frames.builtin()];
    const cats = [...new Set(all.map(f => f.cat))];
    let cat = custom.length ? 'Мои фреймы' : cats[0], q = '';
    const left = h('div', { class: 'fr-cats' }), grid = h('div', { class: 'fr-grid' });
    const search = h('input', { type: 'text', class: 'wide', placeholder: 'Поиск: футболка, буклет, 90×50…', oninput: e => { q = e.target.value.trim().toLowerCase(); render(); } });
    search.addEventListener('keydown', e => e.stopPropagation());
    const where = UI.sel([['new', 'Новый документ'], ['page', 'Применить к текущей странице'], ['add', 'Добавить страницей']], 'new', () => { }, '', 240);
    const render = () => {
      left.innerHTML = '';
      for (const c of cats) left.append(h('div', { class: 'fr-cat' + (c === cat && !q ? ' on' : ''), onclick: () => { cat = c; q = ''; search.value = ''; render(); } }, c, h('span', { class: 'muted' }, ' ' + all.filter(f => f.cat === c).length)));
      grid.innerHTML = '';
      const items = all.filter(f => q ? (f.name + ' ' + f.cat + ` ${f.w}×${f.h}`).toLowerCase().includes(q) : f.cat === cat);
      if (cat === 'Мои фреймы' && !q && !items.length) grid.append(h('p', { class: 'muted' }, 'Пока пусто. «Запомнить фрейм из файла» — покажите конструктор (CDR, PDF, SVG), и программа сохранит его размер и контуры.'));
      for (const f of items) {
        const k = 90 / Math.max(f.w, f.h), tw = Math.max(8, f.w * k), th = Math.max(8, f.h * k);
        const thumb = f.thumb ? h('img', { src: f.thumb, style: { width: tw + 'px', height: th + 'px' } }) : h('div', { class: 'fr-th', style: { width: tw + 'px', height: th + 'px', borderRadius: f.cut === 'circle' ? '50%' : f.cut === 'round' ? '6px' : '1px' } }, ...(f.folds || []).map(fd => h('i', { style: fd.axis === 'v' ? { left: fd.pos * k + 'px' } : { top: fd.pos * k + 'px', width: '100%', height: '0', borderLeft: 0, borderTop: '1px dashed #16a34a' } })));
        grid.append(h('div', { class: 'fr-card', title: `${f.name}\n${f.w}×${f.h} мм, вылеты ${f.bleed} мм, поле ${f.safe} мм`, onclick: () => { UI.closeDialog(); Frames.use(f, where.value); } },
          h('div', { class: 'fr-thb' }, thumb), h('div', { class: 'fr-n' }, f.name), h('div', { class: 'muted small' }, `${G.round(f.w, 1)}×${G.round(f.h, 1)} мм · вылеты ${f.bleed}`),
          !f.builtin ? h('button', { class: 'ib', title: 'Удалить фрейм', onclick: async e => { e.stopPropagation(); if (confirm('Удалить фрейм «' + f.name + '»?')) { await Frames.del(f.id); UI.closeDialog(); Frames.dialog(); } } }, '×') : ''));
      }
    };
    render();
    UI.dialog('Фреймы: полиграфия и сувенирка', h('div', { class: 'fr-dlg' },
      h('div', { class: 'row' }, search, where),
      h('div', { class: 'fr-body' }, left, grid),
      h('div', { class: 'row' }, h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Frames.fromFile(); } }, '＋ Запомнить фрейм из файла (конструктор)…'),
        h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Frames.fromPage(); } }, '＋ Запомнить текущую страницу'),
        h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Frames.customDialog(); } }, '＋ Свой размер…'))),
    [{ label: 'Закрыть' }]);
  },
  use(f, where) {
    if (where === 'new') return Frames.newDoc(f);
    if (where === 'add') { const P = Model.newPage(f.w, f.h, App.doc.pages.length + 1); App.doc.pages.splice(App.doc.pageIndex + 1, 0, P); App.doc.pageIndex++; Frames.apply(P, f); }
    else Frames.apply(App.pg(), f);
    App.commit('Фрейм: ' + f.name); App.zoomPage(); UI.refresh();
  },
  customDialog() {
    const name = h('input', { type: 'text', class: 'wide', value: 'Мой формат' });
    const w = h('input', { type: 'number', step: 'any', value: App.pg().w }), hh = h('input', { type: 'number', step: 'any', value: App.pg().h });
    const bleed = h('input', { type: 'number', step: 0.5, value: 2 }), safe = h('input', { type: 'number', step: 0.5, value: 3 });
    const folds = h('input', { type: 'text', class: 'wide', placeholder: 'Фальцы через запятую, мм от левого края: 99, 198 (или h:148.5 — горизонтальный)' });
    folds.addEventListener('keydown', e => e.stopPropagation());
    const cat = h('input', { type: 'text', class: 'wide', value: 'Мои фреймы' });
    UI.dialog('Свой фрейм', h('div', { class: 'form' }, h('label', {}, 'Название', name), h('label', {}, 'Раздел', cat),
      h('div', { class: 'row' }, h('label', {}, 'Ширина, мм', w), h('label', {}, 'Высота, мм', hh)), h('div', { class: 'row' }, h('label', {}, 'Вылеты, мм', bleed), h('label', {}, 'Поле, мм', safe)), folds),
    [{ label: 'Отмена' }, { label: 'Сохранить и применить', primary: true, action: () => {
      const f = { id: 'u' + Date.now().toString(36), cat: cat.value.trim() || 'Мои фреймы', name: name.value.trim() || 'Мой формат', w: +w.value, h: +hh.value, bleed: +bleed.value || 0, safe: +safe.value || 0,
        folds: folds.value.split(/[,;]+/).map(s => s.trim()).filter(Boolean).map(s => { const m = s.match(/^(h|v)?:?\s*([\d.]+)/i); return m ? { axis: (m[1] || 'v').toLowerCase(), pos: +m[2], name: 'Фальц' } : null; }).filter(Boolean) };
      Frames.put(f).then(() => Frames.use(f, 'page'));
    } }]);
  },
  // конструктор из файла: CDR любой версии, PDF/AI, SVG
  async fromFile() {
    const [file] = await Host.pickFiles('.cdr,.cdt,.pdf,.ai,.svg', false, 'Файл-конструктор (например, футболка сувенирного сервиса)');
    if (!file) return;
    let pages;
    try {
      UI.busy('Читаю ' + file.name + '…');
      const buf = await file.read(), ext = IO.ext(file.name);
      if (ext === 'cdr' || ext === 'cdt') pages = await IO.readCDR(buf, file.path);
      else if (ext === 'pdf' || ext === 'ai') pages = (await PDFImport.open(buf)).pages;
      else {
        const before = App.doc; // SVG разбираем во временный документ
        const tmp = Model.newDoc(); App.doc = tmp;
        try { const sz = IO.importSVGText(new TextDecoder().decode(buf), null, true); pages = [{ w: sz ? sz.w : tmp.pages[0].w, h: sz ? sz.h : tmp.pages[0].h, objects: tmp.pages[0].layers.flatMap(L => L.objects) }]; }
        finally { App.doc = before; }
      }
    } catch (e) { UI.busy(null); return UI.toast('Не удалось прочитать: ' + (e.message || e), true); }
    UI.busy(null);
    if (!pages || !pages.length) return UI.toast('В файле нет страниц', true);
    Frames.saveDialog({ name: file.name.replace(/\.\w+$/, ''), w: pages[0].w, h: pages[0].h, objects: pages[0].objects });
  },
  fromPage() {
    const P = App.pg();
    const objects = P.layers.filter(L => L.visible).flatMap(L => L.objects);
    Frames.saveDialog({ name: P.frame || P.name, w: P.w, h: P.h, objects, bleed: Prepress.pp(P).bleed, safe: Prepress.pp(P).safe, folds: P.folds });
  },
  saveDialog(src) {
    const name = h('input', { type: 'text', class: 'wide', value: src.name });
    const cat = h('input', { type: 'text', class: 'wide', value: 'Мои фреймы' });
    const bleed = h('input', { type: 'number', step: 0.5, value: src.bleed ?? 0 }), safe = h('input', { type: 'number', step: 0.5, value: src.safe ?? 3 });
    const keep = h('input', { type: 'checkbox', checked: true }), noPrint = h('input', { type: 'checkbox', checked: false });
    [name, cat].forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
    UI.dialog('Запомнить фрейм', h('div', { class: 'form' },
      h('p', { class: 'muted' }, `Размер: ${G.round(src.w, 2)} × ${G.round(src.h, 2)} мм, объектов: ${src.objects.length}.`),
      h('label', {}, 'Название (например, «Футболка — Сувенир-Маркет»)', name), h('label', {}, 'Раздел', cat),
      h('div', { class: 'row' }, h('label', {}, 'Вылеты, мм', bleed), h('label', {}, 'Поле, мм', safe)),
      h('label', { class: 'chk' }, keep, ' Сохранить контуры конструктора (слой «Фрейм», заблокирован)'),
      h('label', { class: 'chk' }, noPrint, ' Слой фрейма не выводить в PDF и PNG (в CDR он остаётся)')),
    [{ label: 'Отмена' }, { label: 'Запомнить и применить', primary: true, action: () => {
      (async () => {
        const f = { id: 'u' + Date.now().toString(36), cat: cat.value.trim() || 'Мои фреймы', name: name.value.trim() || 'Фрейм', w: src.w, h: src.h, bleed: +bleed.value || 0, safe: +safe.value || 0, folds: src.folds || [], noPrint: noPrint.checked, objects: keep.checked ? structuredClone(src.objects) : [] };
        try {
          const page = { w: f.w, h: f.h, color: '#ffffff', layers: [{ id: 'x', visible: true, objects: f.objects }] };
          f.thumb = await IO.pageImage(page, 240);
        } catch (e) { }
        await Frames.put(f);
        UI.toast('Фрейм «' + f.name + '» сохранён: Файл → Фреймы');
        Frames.use(f, App.doc.pages.length === 1 && !App.pg().layers.some(L => L.objects.length) ? 'page' : 'add');
      })();
    } }]);
  },
};
