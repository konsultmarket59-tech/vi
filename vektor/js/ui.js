// Интерфейс: меню, панели, докеры, палитра, линейки, строка состояния, диалоги.
'use strict';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

const ICONS = {
  pick: '<path d="M6 3l12 9-5.5 1 3 6-2.5 1.2-3-6L6 18z" fill="currentColor" stroke="none"/>',
  shape: '<path d="M5 19C8 9 14 5 19 5"/><rect x="3" y="17" width="4" height="4" fill="currentColor"/><rect x="17" y="3" width="4" height="4"/><path d="M8 9l3 1"/><circle cx="7" cy="8.5" r="1.6" fill="currentColor"/>',
  zoom: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L20 20M7 10h6M10 7v6"/>',
  pan: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V14c0 4-2.5 7-6 7s-5-2-7-6l-1-2a1.5 1.5 0 012.5-1.5L8 13"/>',
  freehand: '<path d="M3 17c3-6 5 2 8-3s4-8 6-6-2 7 1 8 2-3 3-3"/>',
  bezier: '<path d="M12 3l4 8-4 10-4-10z"/><circle cx="12" cy="11" r="1.5" fill="currentColor"/><path d="M3 21h4M17 21h4"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  polygon: '<path d="M12 3.5l8.5 6.2-3.2 10H6.7l-3.2-10z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  spiral: '<path d="M12 12c0-1 1.5-1 1.5 0s-1.5 2.5-3 2.5-3-1.5-3-3.5 2-4.5 4.5-4.5 5.5 2 5.5 5.5-3 7-7 7-8-3.5-8-8"/>',
  text: '<path d="M5 5h14M12 5v15M9 20h6" stroke-width="2.2"/>',
  eyedropper: '<path d="M14 4l6 6-2 2-6-6zM12 8l-7 7-1 5 5-1 7-7"/>',
  ifill: '<rect x="4" y="4" width="16" height="16" fill="url(#ig)" stroke="currentColor"/><defs><linearGradient id="ig"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>',
  new: '<path d="M6 3h8l4 4v14H6z M14 3v4h4"/>',
  open: '<path d="M3 7h6l2 2h10v10H3z"/>',
  save: '<path d="M5 4h11l3 3v13H5z M8 4v5h7V4 M8 14h8v6H8z"/>',
  undo: '<path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h3"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5M4 19h16"/>',
  print: '<path d="M7 9V4h10v5M5 9h14v7H5zM7 14h10v6H7z"/>',
  grid: '<path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  rulers: '<path d="M3 3h18v5H8v13H3zM6 3v3M9 3v2M12 3v3M15 3v2M18 3v3M3 11h2M3 14h3M3 17h2"/>',
  wire: '<rect x="4" y="5" width="11" height="10" stroke-dasharray="2 1.5"/><circle cx="15" cy="15" r="5"/>',
  magnet: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/>',
  mirrorH: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 6L3 18h6zM15 6l6 12h-6z"/>',
  mirrorV: '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M6 9L18 3v6zM6 15l12 6v-6z"/>',
  lock: '<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" opacity=".35"/><path d="M4 4l16 16"/>',
  portrait: '<rect x="7" y="3" width="10" height="18"/>',
  landscape: '<rect x="3" y="7" width="18" height="10"/>',
  bold: '<path d="M7 4h6a4 4 0 010 8H7zM7 12h7a4 4 0 010 8H7z" stroke-width="2.2"/>',
  italic: '<path d="M10 4h8M6 20h8M14 4l-4 16"/>',
  alignL: '<path d="M4 5h16M4 9h10M4 13h16M4 17h10"/>',
  alignC: '<path d="M4 5h16M7 9h10M4 13h16M7 17h10"/>',
  alignR: '<path d="M4 5h16M10 9h10M4 13h16M10 17h10"/>',
  alignJ: '<path d="M4 5h16M4 9h16M4 13h16M4 17h10"/>',
  fontAdd: '<path d="M4 19L9 5h1l5 14M6 14h7M18 8v8M14 12h8"/>',
  group: '<rect x="3" y="3" width="10" height="10"/><circle cx="15" cy="15" r="6"/><path d="M1 1h4M1 1v4M23 23h-4M23 23v-4"/>',
  ungroup: '<rect x="3" y="3" width="9" height="9"/><circle cx="16" cy="16" r="5"/>',
  ellFull: '<ellipse cx="12" cy="12" rx="8" ry="7"/>',
  ellPie: '<path d="M12 12h8a8 7 0 11-2.3-5z"/>',
  ellArc: '<path d="M20 12a8 7 0 11-2.3-5"/>',
  nodeAdd: '<path d="M3 18C8 6 16 6 21 18"/><rect x="9" y="7" width="6" height="6"/><path d="M12 15v6M9 18h6"/>',
  nodeDel: '<path d="M3 18C8 6 16 6 21 18"/><rect x="9" y="7" width="6" height="6"/><path d="M9 18h6"/>',
  nodeJoin: '<path d="M3 16c3-8 6-8 8-2M21 16c-3-8-6-8-8-2"/><rect x="10" y="12" width="4" height="4" fill="currentColor"/>',
  nodeBreak: '<path d="M3 16c3-8 6-8 7-4M21 16c-3-8-6-8-7-4"/><rect x="8" y="11" width="3" height="3"/><rect x="13" y="11" width="3" height="3"/>',
  toLine: '<path d="M4 18L20 6"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="4" width="4" height="4"/>',
  toCurve: '<path d="M4 18C4 8 14 6 20 6"/><rect x="2" y="16" width="4" height="4"/><rect x="18" y="4" width="4" height="4"/>',
  cusp: '<path d="M3 18L12 6l9 12"/><rect x="10" y="4" width="4" height="4"/>',
  smooth: '<path d="M3 16C6 6 18 6 21 16M5 6h14"/><circle cx="12" cy="8.5" r="2"/>',
  sym: '<path d="M3 16C6 6 18 6 21 16M4 8h16"/><circle cx="12" cy="8.3" r="2" fill="currentColor"/>',
  close: '<path d="M6 18C2 10 8 4 14 5s8 8 4 13z"/><rect x="4" y="16" width="4" height="4" fill="currentColor"/>',
  reverse: '<path d="M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4"/>',
  curves: '<path d="M4 18C6 8 10 6 12 12s6 4 8-6"/>',
  blend: '<circle cx="5" cy="17" r="3"/><rect x="16" y="3" width="6" height="6"/><path d="M8 14l2-2M11 11l2-2M14 8l1-1" stroke-dasharray="1.5 1.5"/>',
  contour: '<rect x="8" y="8" width="8" height="8"/><rect x="5" y="5" width="14" height="14" rx="2" opacity=".7"/><rect x="2" y="2" width="20" height="20" rx="4" opacity=".4"/>',
  envelope: '<path d="M4 6Q12 1 20 6L19 18Q12 23 5 18Z"/><rect x="2.5" y="4.5" width="3" height="3" fill="currentColor"/><rect x="18.5" y="4.5" width="3" height="3" fill="currentColor"/>',
  extrude: '<path d="M4 9h11v11H4zM4 9l5-5h11l-5 5M20 4v11l-5 5"/>',
};
const icon = (name, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICONS[name] || ''}</svg>`;

// Палитра по мотивам стандартной CMYK-палитры CorelDRAW
const PALETTE = [
  ['Чёрный', 0, 0, 0, 100], ['90% чёрного', 0, 0, 0, 90], ['80% чёрного', 0, 0, 0, 80], ['70% чёрного', 0, 0, 0, 70], ['60% чёрного', 0, 0, 0, 60],
  ['50% чёрного', 0, 0, 0, 50], ['40% чёрного', 0, 0, 0, 40], ['30% чёрного', 0, 0, 0, 30], ['20% чёрного', 0, 0, 0, 20], ['10% чёрного', 0, 0, 0, 10],
  ['Белый', 0, 0, 0, 0], ['Синий', 100, 100, 0, 0], ['Голубой', 100, 0, 0, 0], ['Зелёный', 100, 0, 100, 0], ['Жёлтый', 0, 0, 100, 0],
  ['Красный', 0, 100, 100, 0], ['Пурпурный', 0, 100, 0, 0], ['Фиолетовый', 20, 80, 0, 20], ['Оранжевый', 0, 60, 100, 0], ['Розовый', 0, 40, 20, 0],
  ['Тёмно-коричневый', 0, 20, 20, 80], ['Пудрово-голубой', 20, 20, 0, 0], ['Пастельно-голубой', 40, 20, 0, 0], ['Нежно-голубой', 60, 40, 0, 0], ['Электрик', 60, 60, 0, 0],
  ['Сумеречно-синий', 40, 40, 0, 20], ['Тёмно-синий', 60, 60, 0, 40], ['Глубокий тёмно-синий', 40, 40, 0, 60], ['Пустынно-синий', 40, 20, 0, 40], ['Небесно-голубой', 100, 20, 0, 0],
  ['Ледяной', 40, 0, 0, 0], ['Светлый сине-зелёный', 20, 0, 0, 20], ['Морская волна', 60, 0, 20, 20], ['Мох', 20, 0, 20, 40], ['Тёмно-зелёный', 100, 0, 100, 40],
  ['Лесной', 60, 0, 40, 40], ['Травяной', 60, 0, 40, 20], ['Кентукки', 40, 0, 40, 20], ['Светло-зелёный', 40, 0, 40, 0], ['Весенний', 60, 0, 60, 20],
  ['Бирюзовый', 60, 0, 20, 0], ['Блёкло-зелёный', 20, 0, 20, 20], ['Призрачно-зелёный', 20, 0, 20, 0], ['Мятный', 40, 0, 40, 0], ['Хаки армейский', 20, 0, 20, 40],
  ['Авокадо', 20, 0, 60, 20], ['Шартрёз', 20, 0, 60, 0], ['Болотный', 0, 0, 20, 80], ['Оливково-серый', 0, 0, 20, 60], ['Хаки', 0, 0, 20, 40],
  ['Оливковый', 0, 0, 40, 40], ['Банановый', 0, 0, 60, 20], ['Светло-жёлтый', 0, 0, 60, 0], ['Мел', 0, 0, 20, 0], ['Бледно-жёлтый', 0, 0, 40, 0],
  ['Коричневый', 0, 20, 20, 60], ['Красно-коричневый', 0, 60, 80, 20], ['Золотой', 0, 20, 60, 20], ['Осенний оранжевый', 0, 60, 80, 0], ['Светло-оранжевый', 0, 40, 80, 0],
  ['Персиковый', 0, 40, 60, 0], ['Насыщенный жёлтый', 0, 20, 100, 0], ['Песочный', 0, 0, 20, 20], ['Ореховый', 0, 20, 40, 60], ['Рубиновый', 0, 60, 60, 40],
  ['Кирпичный', 0, 60, 80, 20], ['Тропический розовый', 0, 60, 60, 0], ['Нежно-розовый', 0, 20, 20, 0], ['Блёкло-розовый', 0, 20, 0, 0], ['Малиновый', 0, 100, 60, 0],
  ['Бордовый', 0, 100, 60, 40], ['Сливовый', 20, 60, 0, 40], ['Лавандовый', 20, 40, 0, 0], ['Сиреневый', 40, 60, 0, 0], ['Индиго', 80, 100, 0, 20],
].map(([n, c, m, y, k]) => ({ name: n, cmyk: [c, m, y, k], hex: Color.fromCmyk(c, m, y, k) }));

const PAGE_SIZES = [
  ['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148],
  ['B5', 176, 250], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6], ['Визитка 90×50', 90, 50], ['Евро-флаер 99×210', 99, 210],
  ['Пост 1080×1080 px', 285.75, 285.75], ['Сторис 1080×1920 px', 285.75, 508], ['Баннер 1920×1080 px', 508, 285.75],
];

const UI = {
  $: s => document.querySelector(s),
  opts: { polySides: 5, starPoints: 5, starInner: 0.45, spiralTurns: 4, rectR: 0, font: 'Arial', fontSize: 24, align: 'left', smooth: 1.2, ellMode: 'ellipse' },
  dockTab: 'props',
  dockOpen: true,

  init() {
    try { Object.assign(UI.opts, JSON.parse(localStorage.getItem('vektor.opts') || '{}')); UI.dockTab = localStorage.getItem('vektor.dock') || 'props'; } catch (e) { }
    UI.buildMenus();
    UI.buildStdbar();
    UI.buildToolbox();
    UI.buildPalette();
    UI.buildRulers();
    Shortcuts.init();
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu, .menubar, .ctx')) UI.closeMenus(); });
  },
  saveOpts() { try { localStorage.setItem('vektor.opts', JSON.stringify(UI.opts)); } catch (e) { } },

  // ================== Отрисовка ==================
  refresh(o = {}) {
    const panels = o.panels !== false, doc = o.doc !== false;
    UI.renderStage(doc, !panels);
    UI.renderOverlay();
    UI.drawRulers();
    if (panels) { UI.renderPropbar(); UI.renderDocker(); UI.renderDocPalette(); UI.renderPagebar(); }
    UI.renderStatus();
    UI.updateToolbox();
    if (Tools.text.editing && Tools.text.place) Tools.text.place();
    document.title = (App.fileName || App.doc.name) + (App.dirty ? ' *' : '') + ' — Вектор';
    if (typeof Docs !== 'undefined') Docs.renderBar();
  },
  renderStage(doc, live) {
    const vp = UI.$('#viewport');
    vp.setAttribute('transform', `translate(${App.panX} ${App.panY}) scale(${App.zoom})`);
    const { w, h, color } = App.pg();
    for (const id of ['#page', '#pageShadow']) { UI.$(id).setAttribute('width', w); UI.$(id).setAttribute('height', h); }
    UI.$('#page').setAttribute('fill', color || '#ffffff');
    UI.$('#pageShadow').setAttribute('x', 1.2 / App.zoom * 2); UI.$('#pageShadow').setAttribute('y', 1.2 / App.zoom * 2);
    UI.$('#pageBorder').setAttribute('width', w); UI.$('#pageBorder').setAttribute('height', h);
    UI.$('#pageBorder').setAttribute('stroke-width', 1 / App.zoom);
    const gs = App.doc.grid.size;
    const gridOn = App.view.grid && gs * App.zoom >= 4;
    UI.$('#gridRect').setAttribute('display', gridOn ? 'inline' : 'none');
    if (gridOn) {
      UI.$('#gridRect').setAttribute('width', w); UI.$('#gridRect').setAttribute('height', h);
      UI.$('#gridPattern').setAttribute('width', gs); UI.$('#gridPattern').setAttribute('height', gs);
      UI.$('#gridPath').setAttribute('d', `M${gs} 0H0V${gs}`);
      UI.$('#gridPath').setAttribute('stroke-width', 1 / App.zoom);
    }
    if (typeof Prepress !== 'undefined') Prepress.renderMarks();
    if (doc) {
      UI.renderDoc(App.pg(), live);
      UI.$('#docG').classList.toggle('wire', !!App.view.wire);
      // редактируемый текст показывает поле ввода, а не SVG
      if (Tools.text.editing) { const el = UI.$(`#docG [data-id="${Tools.text.editing.id}"]`); if (el) { el.style.visibility = 'hidden'; UI._hidden = el; } }
    }
  },
  // Отрисовка страницы с заменой только изменившихся объектов: большие файлы не перестраиваются целиком.
  // Неизменившиеся объекты (сверка по отпечатку) берутся из кэша разметки.
  _sc: null, _memo: new WeakMap(), _tsize: 0, _defsStr: null, _hidden: null,
  renderDoc(page, live) {
    const defs = [], tsize = Text.cache.size;
    if (tsize < UI._tsize) UI._memo = new WeakMap(); // кэш шрифтов сброшен — тексты перерисовываются заново
    UI._tsize = tsize;
    const one = o => {
      const hh = Snap.hash(o), c = UI._memo.get(o);
      if (c && c.h === hh) { if (c.defs.length) defs.push(...c.defs); return c.str; }
      const d = [];
      let str;
      try { str = Render.obj(o, d, { ids: true }) || '<g/>'; } catch (e) { console.warn('Объект не отрисован', o && o.id, e); str = '<g/>'; }
      UI._memo.set(o, { h: hh, str, defs: d });
      if (d.length) defs.push(...d);
      return str;
    };
    Render.live = true;
    let layers;
    try { layers = page.layers.map(L => ({ id: L.id, objs: L.visible ? L.objects.map(one) : [] })); }
    finally { Render.live = false; }
    const dstr = defs.join('');
    if (dstr !== UI._defsStr) { UI.$('#docDefs').innerHTML = dstr; UI._defsStr = dstr; }
    if (UI._hidden) { UI._hidden.style.visibility = ''; UI._hidden = null; }
    const root = UI.$('#docG'), C = UI._sc;
    if (!C || C.layers.length !== layers.length || C.layers.some((l, i) => l.id !== layers[i].id) || root.children.length !== layers.length) {
      root.innerHTML = layers.map(l => `<g data-layer="${l.id}">${l.objs.join('')}</g>`).join('');
      UI._sc = { page, layers };
      return;
    }
    const frag = (g, html) => { const r = document.createRange(); r.selectNodeContents(g); return r.createContextualFragment(html); };
    layers.forEach((l, i) => {
      const old = C.layers[i].objs, nw = l.objs, g = root.children[i];
      if (old === nw) return;
      if (g.children.length !== old.length) { g.innerHTML = nw.join(''); return; }
      let a = 0; const n = Math.min(old.length, nw.length);
      while (a < n && old[a] === nw[a]) a++;
      let bo = old.length, bn = nw.length;
      while (bo > a && bn > a && old[bo - 1] === nw[bn - 1]) { bo--; bn--; }
      if (bo - a === bn - a) {
        // тот же состав — заменяем только отличающиеся объекты
        for (let k = a; k < bo; k++) if (old[k] !== nw[k]) g.replaceChild(frag(g, nw[k]), g.children[k]);
      } else {
        for (let k = bo - 1; k >= a; k--) g.children[k].remove();
        if (bn > a) g.insertBefore(frag(g, nw.slice(a, bn).join('')), g.children[a] || null);
      }
    });
    C.layers = layers;
  },
  preview(markup, defs) {
    UI.$('#previewG').innerHTML = markup;
    UI.$('#previewDefs').innerHTML = defs || '';
  },
  renderOverlay() {
    UI.$('#previewG').innerHTML = '';
    const out = [];
    const r = App.stageRect();
    // направляющие
    for (const x of App.doc.guides.v) { const sx = App.toScreen(x, 0).x; out.push(`<line class="guide" x1="${sx}" y1="0" x2="${sx}" y2="${r.height}"/>`); }
    for (const y of App.doc.guides.h) { const sy = App.toScreen(0, y).y; out.push(`<line class="guide" x1="0" y1="${sy}" x2="${r.width}" y2="${sy}"/>`); }
    if (UI.newGuide) {
      const g = UI.newGuide;
      if (g.dir === 'v') { const sx = App.toScreen(g.pos, 0).x; out.push(`<line class="guide new" x1="${sx}" y1="0" x2="${sx}" y2="${r.height}"/>`); }
      else { const sy = App.toScreen(0, g.pos).y; out.push(`<line class="guide new" x1="0" y1="${sy}" x2="${r.width}" y2="${sy}"/>`); }
    }
    const t = Tools[App.tool];
    if (t.overlay) t.overlay(out); else Overlay.selection(out, true);
    UI.$('#overlay').innerHTML = out.join('');
    UI.$('#stage').dataset.tool = App.tool;
  },

  // ================== Страницы ==================
  renderPagebar() {
    const el = UI.$('#pagebar'), d = App.doc, n = d.pages.length, i = d.pageIndex;
    el.innerHTML = '';
    const B = (t, title, fn) => h('button', { class: 'pnav', title, onclick: fn }, t);
    el.append(B('⏮', 'Первая страница', () => App.goPage(0)), B('◀', 'Предыдущая (PgUp)', () => App.goPage(i - 1)),
      h('span', { class: 'pinfo' }, `${i + 1} из ${n}`), B('▶', 'Следующая (PgDn)', () => App.goPage(i + 1)), B('⏭', 'Последняя', () => App.goPage(n - 1)),
      B('+', 'Добавить страницу после текущей', () => Actions.addPage()));
    d.pages.forEach((P, k) => {
      const t = h('span', { class: 'ptab' + (k === i ? ' on' : ''), title: `${P.name}: ${G.round(P.w, 1)} × ${G.round(P.h, 1)} мм. Двойной щелчок — переименовать, правая кнопка — меню`,
        onclick: () => App.goPage(k), ondblclick: () => Actions.renamePage(k),
        oncontextmenu: e => {
          e.preventDefault(); App.goPage(k);
          UI.showMenuList([
            { label: 'Вставить страницу до', action: () => Actions.addPage(k - 1) }, { label: 'Вставить страницу после', action: () => Actions.addPage(k) },
            { label: 'Дублировать страницу', action: Actions.duplicatePage }, { label: 'Переименовать…', action: () => Actions.renamePage(k) },
            '-', { label: 'Сдвинуть влево', action: () => Actions.movePage(k, -1), disabled: () => k === 0 }, { label: 'Сдвинуть вправо', action: () => Actions.movePage(k, 1), disabled: () => k === n - 1 },
            '-', { label: 'Размер страницы…', action: UI.pageDialog }, { label: 'Удалить страницу', action: () => Actions.deletePage(k), disabled: () => n < 2 },
          ], e.clientX, e.clientY - 10);
        } }, P.name);
      el.append(t);
    });
  },

  // ================== Линейки ==================
  buildRulers() {
    for (const [id, dir] of [['#rulerTop', 'h'], ['#rulerLeft', 'v']]) {
      UI.$(id).addEventListener('pointerdown', e => {
        e.preventDefault();
        // из верхней линейки тянется горизонтальная направляющая, из левой — вертикальная
        UI.newGuide = { dir, pos: 0 };
        const mv = ev => {
          const p = App.toDoc(ev.clientX, ev.clientY);
          let pos = dir === 'h' ? p.y : p.x;
          if (App.view.snapGrid) pos = Math.round(pos / App.doc.grid.size) * App.doc.grid.size;
          UI.newGuide.pos = pos;
          UI.status(`Направляющая: ${pos.toFixed(2)} мм`);
          UI.renderOverlay();
        };
        const upf = ev => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upf);
          const r = App.stageRect();
          const inside = ev.clientX > r.left && ev.clientY > r.top && ev.clientX < r.right && ev.clientY < r.bottom;
          if (inside) { App.doc.guides[dir].push(G.round(UI.newGuide.pos, 3)); UI.newGuide = null; App.commit('Направляющая'); }
          else { UI.newGuide = null; UI.refresh({ panels: false }); }
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upf);
      });
      UI.$(id).addEventListener('dblclick', () => UI.guidesDialog());
    }
  },
  drawRulers() {
    const show = App.view.rulers;
    UI.$('#canvasWrap').classList.toggle('norulers', !show);
    if (!show) return;
    const dpr = window.devicePixelRatio || 1;
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--ruler-bg').trim() || '#eee', fg = css.getPropertyValue('--ruler-fg').trim() || '#333';
    for (const [id, horiz] of [['#rulerTop', true], ['#rulerLeft', false]]) {
      const c = UI.$(id), w = c.clientWidth, hh = c.clientHeight;
      if (!w || !hh) continue;
      if (c.width !== w * dpr || c.height !== hh * dpr) { c.width = w * dpr; c.height = hh * dpr; }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, hh);
      ctx.strokeStyle = fg; ctx.fillStyle = fg; ctx.lineWidth = 1;
      ctx.font = '9px system-ui, sans-serif';
      const z = App.zoom;
      const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      const major = steps.find(s => s * z >= 60) || 5000;
      const minor = major / (String(major)[0] === '2' ? 4 : 5) / (major * z > 120 ? 2 : 1);
      const off = horiz ? App.panX - 20 : App.panY - 20; // смещение холста относительно линейки
      const len = horiz ? w : hh;
      const start = Math.floor((-off) / z / minor) * minor;
      const end = (len - off) / z;
      ctx.beginPath();
      for (let v = start; v <= end; v += minor) {
        const s = Math.round(v * z + off) + 0.5;
        const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const tl = isMajor ? 20 : (Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6 ? 8 : 4);
        if (horiz) { ctx.moveTo(s, hh); ctx.lineTo(s, hh - tl); } else { ctx.moveTo(w, s); ctx.lineTo(w - tl, s); }
        if (isMajor) {
          const lab = String(+v.toFixed(2));
          if (horiz) ctx.fillText(lab, s + 2, 9);
          else { ctx.save(); ctx.translate(9, s + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(lab, -ctx.measureText(lab).width - 2, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
      // курсор на линейке
      const cp = UI.cursorPos;
      if (cp) {
        const s = (horiz ? cp.x : cp.y) * z + off;
        ctx.strokeStyle = '#e53935'; ctx.beginPath();
        if (horiz) { ctx.moveTo(s, 0); ctx.lineTo(s, hh); } else { ctx.moveTo(0, s); ctx.lineTo(w, s); }
        ctx.stroke();
      }
    }
  },
  setCursorPos(p) {
    UI.cursorPos = p;
    UI.$('#stCoords').textContent = `${p.x.toFixed(2)}, ${p.y.toFixed(2)} мм`;
    if (App.view.rulers) UI.drawRulers();
  },

  // ================== Меню ==================
  menus() {
    const A = Actions, sel = () => App.sel.length > 0;
    const v = App.view;
    const tog = (key, label) => ({ label, check: () => v[key], action: () => { v[key] = !v[key]; App.saveView(); UI.refresh(); } });
    return [
      { label: 'Файл', items: [
        { label: 'Создать', key: 'Ctrl+N', action: A.newDoc },
        { label: 'Создать из фрейма… (листовки, буклеты, сувенирка)', action: () => Frames.dialog() },
        { label: 'Открыть…', key: 'Ctrl+O', action: IO.open },
        { label: 'Закрыть документ', key: 'Ctrl+W', action: () => Docs.close() },
        { label: 'Следующий документ', key: 'Ctrl+Tab', action: () => Docs.next(1), disabled: () => Docs.list.length < 2 },
        { label: 'CDR открывать через CorelDRAW (точно: фото, PowerClip, эффекты)', check: () => IO.cdrMode() !== 'own', action: () => IO.setCdrMode(IO.cdrMode() === 'own' ? 'auto' : 'own') },
        '-',
        { label: 'Сохранить', key: 'Ctrl+S', action: IO.save },
        { label: 'Сохранить как…', key: 'Ctrl+Shift+S', action: IO.saveAs },
        '-',
        { label: 'Импорт… (SVG, PNG, JPG)', key: 'Ctrl+I', action: IO.importDialog },
        { label: 'Экспорт… (SVG, PNG, JPG)', key: 'Ctrl+E', action: IO.exportDialog },
        '-',
        { label: 'Печать / PDF…', key: 'Ctrl+P', action: IO.print },
        { label: 'PDF для типографии (CMYK, вылеты, метки)…', action: () => IO.exportDialog('pdfx') },
        { label: 'Подготовить файл для типографии…', action: () => Prepress.dialog() },
        { label: 'Конвертер файлов (CDR, PDF, AI, SVG, FIG, PSD, PNG…)…', action: () => Convert.dialog() },
        '-',
        { label: 'Свойства документа…', action: UI.pageDialog },
      ] },
      { label: 'Правка', items: [
        { label: 'Отменить', key: 'Ctrl+Z', action: A.undo, disabled: () => App.hpos <= 0 },
        { label: 'Повторить', key: 'Ctrl+Y', action: A.redo, disabled: () => App.hpos >= App.history.length - 1 },
        '-',
        { label: 'Вырезать', key: 'Ctrl+X', action: A.cut, disabled: () => !sel() },
        { label: 'Копировать', key: 'Ctrl+C', action: A.copy, disabled: () => !sel() },
        { label: 'Вставить', key: 'Ctrl+V', action: () => A.paste(), disabled: () => !App.clipboard },
        { label: 'Дублировать', key: 'Ctrl+D', action: A.duplicate, disabled: () => !sel() },
        { label: 'Копия на месте', key: '+', action: A.duplicateInPlace, disabled: () => !sel() },
        { label: 'Удалить', key: 'Delete', action: A.del, disabled: () => !sel() },
        '-',
        { label: 'Выделить всё', key: 'Ctrl+A', action: A.selectAll },
        { label: 'Снять выделение', key: 'Esc', action: () => App.setSel([]) },
      ] },
      { label: 'Вид', items: [
        { label: 'Вся страница', key: 'Shift+F4', action: App.zoomPage },
        { label: 'Все объекты', key: 'F4', action: App.zoomAll },
        { label: 'Выделенные', key: 'Shift+F2', action: App.zoomSel },
        { label: 'Реальный размер (100%)', action: App.zoom100 },
        '-',
        tog('wire', 'Каркас'),
        tog('rulers', 'Линейки'),
        tog('grid', 'Сетка'),
        '-',
        tog('snapGrid', 'Привязка к сетке'),
        tog('snapGuides', 'Привязка к направляющим'),
        tog('snapObjects', 'Привязка к объектам'),
        tog('snapPage', 'Привязка к странице'),
        '-',
        { label: 'Направляющие…', action: UI.guidesDialog },
        { label: 'Удалить все направляющие', action: () => { App.doc.guides = { h: [], v: [] }; App.commit('Направляющие'); } },
        { label: 'Колесо мыши: масштаб', check: () => v.wheel === 'zoom', action: () => { v.wheel = v.wheel === 'zoom' ? 'scroll' : 'zoom'; App.saveView(); UI.toast(v.wheel === 'zoom' ? 'Колесо — масштаб (Shift — прокрутка)' : 'Колесо — прокрутка (Ctrl — масштаб)'); } },
      ] },
      { label: 'Макет', items: [
        { label: 'Размер страницы…', action: UI.pageDialog },
        { label: 'Фреймы: полиграфия и сувенирка…', action: () => Frames.dialog() },
        { label: 'Параметры печати: вылеты, поля, CMYK…', action: () => Prepress.settingsDialog() },
        { label: 'Подготовка к печати (проверка и исправление)…', action: () => Prepress.dialog() },
        { label: 'Изменить размер макета (масштаб, расширение)…', action: () => Prepress.resizeDialog() },
        { label: 'Сжать картинки…', action: () => Prepress.compressDialog() },
        { label: 'Книжная', action: () => UI.setOrientation(false) },
        { label: 'Альбомная', action: () => UI.setOrientation(true) },
        '-',
        { label: 'Вставить страницу', key: '', action: () => A.addPage() },
        { label: 'Дублировать страницу', action: A.duplicatePage },
        { label: 'Переименовать страницу…', action: () => A.renamePage() },
        { label: 'Удалить страницу', action: () => A.deletePage(), disabled: () => App.doc.pages.length < 2 },
        { label: 'Перенести выделенное на страницу', sub: App.doc.pages.map((P, k) => ({ label: `${k + 1}. ${P.name}`, action: () => A.moveToPage(k), disabled: () => !sel() || k === App.doc.pageIndex })) },
        '-',
        { label: 'Новый слой', action: A.addLayer },
        { label: 'Диспетчер объектов', key: 'Ctrl+Shift+O', action: () => UI.docker('objects') },
      ] },
      { label: 'Объект', items: [
        { label: 'Упорядочить', sub: [
          { label: 'На передний план', key: 'Shift+PgUp', action: () => A.order('front'), disabled: () => !sel() },
          { label: 'На задний план', key: 'Shift+PgDn', action: () => A.order('back'), disabled: () => !sel() },
          { label: 'На уровень вперёд', key: 'Ctrl+PgUp', action: () => A.order('up'), disabled: () => !sel() },
          { label: 'На уровень назад', key: 'Ctrl+PgDn', action: () => A.order('down'), disabled: () => !sel() },
          { label: 'Обратить порядок', action: () => A.order('reverse'), disabled: () => App.sel.length < 2 },
        ] },
        { label: 'Выровнять и распределить', sub: [
          { label: 'По левому краю', key: 'L', action: () => A.align('left') },
          { label: 'По правому краю', key: 'R', action: () => A.align('right') },
          { label: 'По верхнему краю', key: 'T', action: () => A.align('top') },
          { label: 'По нижнему краю', key: 'B', action: () => A.align('bottom') },
          { label: 'Центры по горизонтали', key: 'E', action: () => A.align('hcenter') },
          { label: 'Центры по вертикали', key: 'C', action: () => A.align('vcenter') },
          { label: 'По центру страницы', key: 'P', action: A.centerPage },
          '-',
          { label: 'Докер «Выравнивание»…', key: 'Ctrl+Shift+A', action: () => UI.docker('align') },
        ] },
        '-',
        { label: 'Сгруппировать', key: 'Ctrl+G', action: A.group, disabled: () => App.sel.length < 2 },
        { label: 'Отменить группировку', key: 'Ctrl+U', action: A.ungroup },
        { label: 'Отменить всю группировку', action: A.ungroupAll },
        '-',
        { label: 'Объединить', key: 'Ctrl+L', action: A.combine, disabled: () => App.sel.length < 2 },
        { label: 'Разъединить', key: 'Ctrl+K', action: A.breakApart },
        { label: 'Преобразовать в кривые', key: 'Ctrl+Q', action: A.toCurves, disabled: () => !sel() },
        '-',
        { label: 'Формирование', sub: [
          { label: 'Сварка', action: () => A.shaping('weld') },
          { label: 'Обрезка', action: () => A.shaping('trim') },
          { label: 'Пересечение', action: () => A.shaping('intersect') },
          { label: 'Передний минус задний', action: () => A.shaping('frontMinusBack') },
          { label: 'Задний минус передний', action: () => A.shaping('backMinusFront') },
        ] },
        { label: 'PowerClip', sub: [
          { label: 'Поместить во фрейм…', action: A.powerclipStart, disabled: () => !sel() },
          { label: 'Извлечь содержимое', action: A.powerclipExtract },
        ] },
        '-',
        { label: 'Зеркально по горизонтали', action: () => A.mirror(true), disabled: () => !sel() },
        { label: 'Зеркально по вертикали', action: () => A.mirror(false), disabled: () => !sel() },
        { label: 'Повернуть на 90° влево', action: () => A.rotate(-90), disabled: () => !sel() },
        { label: 'Повернуть на 90° вправо', action: () => A.rotate(90), disabled: () => !sel() },
        { label: 'Сбросить преобразования', action: A.clearTransform, disabled: () => !sel() },
        { label: 'Преобразования…', key: 'Ctrl+F7', action: () => UI.docker('transform') },
        '-',
        { label: 'Заблокировать', action: () => UI.lockSel(true), disabled: () => !sel() },
        { label: 'Разблокировать все', action: () => { Model.walkDoc(App.doc, o => { o.locked = false; }); App.commit('Разблокировать'); } },
        { label: 'Свойства объекта', key: 'F11', action: () => UI.docker('props') },
      ] },
      { label: 'Эффекты', items: [
        { label: 'Перетекание…', action: UI.blendDialog, disabled: () => App.sel.length !== 2 },
        { label: 'Контур', action: () => { App.setTool('contour'); if (App.sel.length) Actions.contour({}); } },
        { label: 'Оболочка', action: () => App.setTool('envelope') },
        { label: 'Выдавливание', action: () => { App.setTool('extrude'); if (App.sel.length) Actions.extrude({}); } },
        { label: 'Разъединить эффект', action: Actions.breakEffect, disabled: () => !sel() },
        { label: 'Убрать контур, оболочку и выдавливание', action: () => Actions.clearEffects(), disabled: () => !sel() },
        '-',
        { label: 'Тень', action: () => { Actions.setPaint(o => { o.shadow = o.shadow ? null : { dx: 1.5, dy: 1.5, blur: 1.2, color: '#000000', opacity: 0.45 }; }, 'Тень'); }, disabled: () => !sel() },
        { label: 'Прозрачность 50%', action: () => Actions.setPaint(o => { o.opacity = 0.5; }, 'Прозрачность'), disabled: () => !sel() },
        { label: 'Сбросить эффекты', action: () => Actions.setPaint(o => { o.opacity = 1; o.shadow = null; }, 'Сброс эффектов'), disabled: () => !sel() },
      ] },
      { label: 'Текст', items: [
        { label: 'Инструмент «Текст»', key: 'F8', action: () => App.setTool('text') },
        { label: 'Редактировать текст', action: () => { const o = App.selObjs()[0]; if (o && o.type === 'text') Tools.text.edit(o); else UI.toast('Выделите текстовый объект'); } },
        { label: 'Свойства текста', action: () => UI.docker('props') },
        '-',
        { label: 'Загрузить шрифт из файла…', action: UI.loadFontFiles },
        { label: 'Подключить шрифты системы', action: () => Fonts.loadLocal() },
        { label: 'Преобразовать текст в кривые', key: 'Ctrl+Q', action: A.toCurves, disabled: () => !sel() },
      ] },
      ...(typeof AIOps !== 'undefined' ? [AIOps.menu()] : []),
      { label: 'Окно', items: [
        { label: 'ИИ-агент', check: () => UI.dockOpen && UI.dockTab === 'agent', action: () => UI.docker('agent') },
        { label: 'Свойства объекта', check: () => UI.dockOpen && UI.dockTab === 'props', action: () => UI.docker('props') },
        { label: 'Диспетчер объектов', check: () => UI.dockOpen && UI.dockTab === 'objects', action: () => UI.docker('objects') },
        { label: 'Выравнивание и распределение', check: () => UI.dockOpen && UI.dockTab === 'align', action: () => UI.docker('align') },
        { label: 'Преобразования', check: () => UI.dockOpen && UI.dockTab === 'transform', action: () => UI.docker('transform') },
        '-',
        { label: 'Показывать докеры', check: () => UI.dockOpen, action: () => { UI.dockOpen = !UI.dockOpen; UI.$('#app').classList.toggle('nodock', !UI.dockOpen); UI.refresh(); } },
        { label: 'Тёмная тема', check: () => document.documentElement.dataset.theme === 'dark', action: UI.toggleTheme },
      ] },
      { label: 'Справка', items: [
        { label: 'Горячие клавиши', key: 'F1', action: UI.showHelp },
        { label: 'О программе', action: UI.about },
      ] },
    ];
  },
  buildMenus() {
    const bar = UI.$('#menubar');
    bar.innerHTML = '';
    UI.menus().forEach((m, i) => {
      const b = h('div', { class: 'mb-item', 'data-i': i }, m.label);
      b.addEventListener('pointerdown', e => { e.stopPropagation(); UI.openMenu(i, b); });
      b.addEventListener('pointerenter', () => { if (UI.menuOpen !== null && UI.menuOpen !== i) UI.openMenu(i, b); });
      bar.append(b);
    });
    UI.menuOpen = null;
  },
  menuOpen: null,
  openMenu(i, anchor) {
    if (UI.menuOpen === i) { UI.closeMenus(); return; }
    UI.closeMenus();
    UI.menuOpen = i;
    anchor.classList.add('open');
    const m = UI.menus()[i];
    const r = anchor.getBoundingClientRect();
    UI.showMenuList(m.items, r.left, r.bottom);
  },
  showMenuList(items, x, y, isSub = false) {
    const menu = h('div', { class: 'menu' + (isSub ? ' sub' : '') });
    for (const it of items) {
      if (it === '-') { menu.append(h('div', { class: 'msep' })); continue; }
      const dis = it.disabled && it.disabled();
      const row = h('div', { class: 'mi' + (dis ? ' dis' : '') + (it.sub ? ' has-sub' : '') },
        h('span', { class: 'mcheck' }, it.check && it.check() ? '✓' : ''),
        h('span', { class: 'mlabel' }, it.label),
        h('span', { class: 'mkey' }, it.key || (it.sub ? '▸' : '')));
      if (it.sub) {
        row.addEventListener('pointerenter', () => {
          document.querySelectorAll('.menu.sub').forEach(s => s.remove());
          const rr = row.getBoundingClientRect();
          UI.showMenuList(it.sub, rr.right - 2, rr.top - 4, true);
        });
      } else {
        row.addEventListener('pointerenter', () => { if (!isSub) document.querySelectorAll('.menu.sub').forEach(s => s.remove()); });
        row.addEventListener('pointerup', e => { e.stopPropagation(); if (dis) return; UI.closeMenus(); it.action(); });
      }
      menu.append(row);
    }
    document.body.append(menu);
    const mr = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - mr.width - 4) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - mr.height - 4) + 'px';
    return menu;
  },
  closeMenus() {
    document.querySelectorAll('.menu, .ctx').forEach(m => m.remove());
    document.querySelectorAll('.mb-item.open').forEach(m => m.classList.remove('open'));
    UI.menuOpen = null;
  },
  contextMenu(x, y) {
    UI.closeMenus();
    const A = Actions, o = App.selObjs()[0];
    let items;
    if (App.tool === 'shape' && Tools.shape.target() && Tools.shape.target().type === 'path') {
      const T = Tools.shape;
      items = [
        { label: 'Добавить узел', action: T.addNodes }, { label: 'Удалить узел', key: 'Del', action: T.deleteNodes },
        '-', { label: 'В линию', action: () => T.segType(false) }, { label: 'В кривую', action: () => T.segType(true) },
        '-', { label: 'Острый угол', action: () => T.setType('cusp') }, { label: 'Сглаженный', action: () => T.setType('smooth') }, { label: 'Симметричный', action: () => T.setType('sym') },
        '-', { label: 'Разорвать кривую', action: T.breakAt }, { label: 'Соединить два узла', action: T.joinNodes }, { label: 'Замкнуть / разомкнуть', action: T.toggleClose }, { label: 'Обратить направление', action: T.reverse },
      ];
    } else if (!o) {
      items = [
        { label: 'Вставить', key: 'Ctrl+V', action: () => A.paste(), disabled: () => !App.clipboard },
        { label: 'Выделить всё', key: 'Ctrl+A', action: A.selectAll },
        '-', { label: 'Отменить', key: 'Ctrl+Z', action: A.undo },
        '-', { label: 'Свойства документа…', action: UI.pageDialog },
      ];
    } else {
      items = [
        { label: 'Вырезать', key: 'Ctrl+X', action: A.cut }, { label: 'Копировать', key: 'Ctrl+C', action: A.copy },
        { label: 'Вставить', key: 'Ctrl+V', action: () => A.paste(), disabled: () => !App.clipboard },
        { label: 'Дублировать', key: 'Ctrl+D', action: A.duplicate }, { label: 'Удалить', key: 'Del', action: A.del },
        '-',
        { label: 'Порядок', sub: [
          { label: 'На передний план', key: 'Shift+PgUp', action: () => A.order('front') },
          { label: 'На задний план', key: 'Shift+PgDn', action: () => A.order('back') },
          { label: 'На уровень вперёд', key: 'Ctrl+PgUp', action: () => A.order('up') },
          { label: 'На уровень назад', key: 'Ctrl+PgDn', action: () => A.order('down') },
        ] },
        App.sel.length > 1 ? { label: 'Сгруппировать', key: 'Ctrl+G', action: A.group } : null,
        o.type === 'group' ? { label: 'Отменить группировку', key: 'Ctrl+U', action: A.ungroup } : null,
        App.sel.length > 1 ? { label: 'Объединить', key: 'Ctrl+L', action: A.combine } : null,
        o.type === 'path' && o.subs.length > 1 ? { label: 'Разъединить', key: 'Ctrl+K', action: A.breakApart } : null,
        ['rect', 'ellipse', 'polygon'].includes(o.type) ? { label: 'Преобразовать в кривые', key: 'Ctrl+Q', action: A.toCurves } : null,
        o.type === 'powerclip' ? { label: 'Извлечь содержимое', action: A.powerclipExtract } : { label: 'PowerClip: поместить во фрейм…', action: A.powerclipStart },
        '-',
        { label: 'Заблокировать', action: () => UI.lockSel(true) },
        { label: 'Свойства', key: 'F11', action: () => UI.docker('props') },
      ].filter(Boolean);
    }
    const m = UI.showMenuList(items, x, y);
    m.classList.add('ctx');
  },
  lockSel(v) {
    App.selObjs().forEach(o => { o.locked = v; });
    if (v) App.sel = [];
    App.commit(v ? 'Блокировка' : 'Разблокировка');
  },

  // ================== Стандартная панель ==================
  buildStdbar() {
    const bar = UI.$('#stdbar');
    const B = (ic, title, fn, id) => h('button', { class: 'tb', title, id, html: icon(ic), onclick: fn });
    const zoomSel = h('select', { id: 'zoomBox', title: 'Масштаб', onchange: e => {
      const v = e.target.value;
      if (v === 'page') App.zoomPage(); else if (v === 'all') App.zoomAll(); else if (v === 'sel') App.zoomSel(); else App.setZoom(+v / 100 * 96 / 25.4);
      e.target.blur();
    } });
    bar.append(
      B('new', 'Создать (Ctrl+N)', Actions.newDoc), B('open', 'Открыть (Ctrl+O)', IO.open), B('save', 'Сохранить (Ctrl+S)', IO.save),
      h('span', { class: 'sep' }),
      B('undo', 'Отменить (Ctrl+Z)', Actions.undo), B('redo', 'Повторить (Ctrl+Y)', Actions.redo),
      h('span', { class: 'sep' }),
      B('import', 'Импорт (Ctrl+I)', IO.importDialog), B('export', 'Экспорт (Ctrl+E)', IO.exportDialog), B('print', 'Печать / PDF (Ctrl+P)', IO.print),
      h('span', { class: 'sep' }),
      zoomSel,
      h('span', { class: 'sep' }),
      B('rulers', 'Линейки', () => UI.toggleView('rulers'), 'tbRulers'),
      B('grid', 'Сетка', () => UI.toggleView('grid'), 'tbGrid'),
      B('wire', 'Каркас', () => UI.toggleView('wire'), 'tbWire'),
      h('button', { class: 'tb wide', id: 'tbSnap', title: 'Привязки', html: icon('magnet') + '<span>Привязка ▾</span>', onclick: e => {
        const r = e.currentTarget.getBoundingClientRect();
        const v = App.view, t = (k, l) => ({ label: l, check: () => v[k], action: () => { v[k] = !v[k]; App.saveView(); UI.refresh(); } });
        UI.showMenuList([t('snapGrid', 'К сетке'), t('snapGuides', 'К направляющим'), t('snapObjects', 'К объектам'), t('snapPage', 'К странице')], r.left, r.bottom);
      } }),
      h('span', { class: 'grow' }),
      h('button', { class: 'tb wide agent-btn', title: 'ИИ-агент: поручить задачу', onclick: () => UI.docker('agent'), html: '<span>✦ Агент</span>' }),
      h('span', { class: 'brand' }, 'Вектор'),
    );
    UI.updateZoomBox();
  },
  toggleView(k) { App.view[k] = !App.view[k]; App.saveView(); UI.refresh(); },
  updateZoomBox() {
    const sel = UI.$('#zoomBox'); if (!sel) return;
    const pct = Math.round(App.zoom / (96 / 25.4) * 100);
    const opts = [['page', 'Страница'], ['all', 'Все объекты'], ['sel', 'Выделенные'], ...[10, 25, 50, 75, 100, 200, 400, 800, 1600].map(v => [v, v + '%'])];
    sel.innerHTML = `<option value="" selected>${pct}%</option>` + opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  },

  // ================== Панель инструментов ==================
  TOOLS: [
    ['pick', 'Указатель (Пробел)'], ['shape', 'Форма — редактирование узлов (F10)'], '-',
    ['zoom', 'Масштаб (Z): щелчок — ближе, Shift/правая — дальше, рамка — область'], ['pan', 'Панорама (H)'], '-',
    ['freehand', 'Свободная форма (F5): тяните — кривая, два щелчка — прямая'], ['bezier', 'Кривая Безье (N): щелчок — угол, тяните — гладкий узел, Enter — конец'], '-',
    ['rect', 'Прямоугольник (F6): Ctrl — квадрат, Shift — от центра'], ['ellipse', 'Эллипс (F7): Ctrl — круг, Shift — от центра'],
    ['polygon', 'Многоугольник (Y)'], ['star', 'Звезда (S)'], ['spiral', 'Спираль (A)'], '-',
    ['text', 'Текст (F8): щелчок — фигурный, рамка — абзацный'], '-',
    ['blend', 'Перетекание: от первого объекта ко второму'], ['contour', 'Контур: тяните от края наружу или внутрь'],
    ['envelope', 'Оболочка: тяните узлы рамки, чтобы изогнуть объект'], ['extrude', 'Выдавливание: тяните от объекта'], '-',
    ['eyedropper', 'Пипетка атрибутов (I): взять стиль и применить к другим'], ['ifill', 'Интерактивная заливка (G): протяните градиент по объекту'],
  ],
  buildToolbox() {
    const tb = UI.$('#toolbox');
    for (const t of UI.TOOLS) {
      if (t === '-') { tb.append(h('div', { class: 'tsep' })); continue; }
      tb.append(h('button', { class: 'tool', 'data-tool': t[0], title: t[1], html: icon(t[0], 22), onclick: () => App.setTool(t[0]) }));
    }
    // индикаторы цвета по умолчанию
    tb.append(h('div', { class: 'tsep' }), h('div', { class: 'defcolors', id: 'defColors', title: 'Заливка и абрис для новых фигур' }));
  },
  updateToolbox() {
    document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === App.tool));
    for (const [id, k] of [['#tbRulers', 'rulers'], ['#tbGrid', 'grid'], ['#tbWire', 'wire']]) UI.$(id).classList.toggle('on', !!App.view[k]);
    const d = App.defaults, dc = UI.$('#defColors');
    dc.innerHTML = `<span class="dstroke" style="border-color:${d.stroke.color || 'transparent'}"></span><span class="dfill" style="background:${d.fill.type === 'none' ? 'transparent' : d.fill.color}"></span>`;
    UI.$('#stage').style.cursor = Tools[App.tool].cursor || '';
  },

  // ================== Палитра ==================
  buildPalette() {
    const pal = UI.$('#palette');
    pal.append(h('div', { class: 'sw none', title: 'Нет (щелчок — без заливки, правая кнопка — без абриса)',
      onclick: () => Actions.setFillColor(null), oncontextmenu: e => { e.preventDefault(); Actions.setStrokeColor(null); } }));
    for (const c of PALETTE) {
      pal.append(h('div', {
        class: 'sw', style: { background: c.hex }, title: `${c.name}\nC${c.cmyk[0]} M${c.cmyk[1]} Y${c.cmyk[2]} K${c.cmyk[3]}\nЩелчок — заливка, правая кнопка — абрис`,
        onclick: () => Actions.setFillColor(c.hex), oncontextmenu: e => { e.preventDefault(); Actions.setStrokeColor(c.hex); },
      }));
    }
  },
  renderDocPalette() {
    const el = UI.$('#docPalette');
    const used = new Map();
    Model.walkDoc(App.doc, o => {
      if (o.fill && o.fill.type !== 'none' && o.fill.color) used.set(o.fill.color, 1);
      if (o.fill && (o.fill.type === 'linear' || o.fill.type === 'radial')) used.set(o.fill.color2, 1);
      if (o.stroke && o.stroke.color && o.stroke.width > 0) used.set(o.stroke.color, 1);
    });
    const key = [...used.keys()].join();
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = '';
    el.append(h('span', { class: 'dp-label' }, 'Палитра документа:'));
    for (const c of used.keys()) el.append(h('div', { class: 'sw', style: { background: c }, title: c + ' — щелчок: заливка, правая: абрис', onclick: () => Actions.setFillColor(c), oncontextmenu: e => { e.preventDefault(); Actions.setStrokeColor(c); } }));
  },

  // ================== Строка состояния ==================
  _statusMsg: '', _statusTimer: 0,
  status(msg) {
    UI.$('#stInfo').textContent = msg;
    clearTimeout(UI._statusTimer);
    UI._statusTimer = setTimeout(() => { UI._statusTimer = 0; UI.renderStatus(); }, 1600);
  },
  renderStatus() {
    if (!UI._statusTimer) {
      const objs = App.selObjs();
      let s;
      const L = App.activeLayer();
      if (!objs.length) s = `Нет выделения · Слой: ${L.name}`;
      else if (objs.length === 1) {
        const o = objs[0], b = Model.worldBox(o);
        s = `${Model.label(o)} на слое «${Model.layerOf(o.id).name}» · ${(b.x2 - b.x1).toFixed(2)} × ${(b.y2 - b.y1).toFixed(2)} мм`;
      } else s = `Выделено объектов: ${objs.length}`;
      if (App.tool === 'shape' && Tools.shape.selected().length) s += ` · узлов выбрано: ${Tools.shape.selected().length}`;
      if (Tools.pick.pickContainer) s = 'PowerClip: щёлкните по фрейму, в который поместить объекты';
      if (App.tool === 'eyedropper') s = Tools.eyedropper.picked ? 'Пипетка: щёлкайте по объектам, чтобы применить стиль (Shift — взять заново)' : 'Пипетка: щёлкните по объекту-образцу';
      UI.$('#stInfo').textContent = s;
    }
    const o = App.selObjs()[0];
    const leaf = o && Model.leaves(o)[0];
    const f = leaf ? leaf.fill : App.defaults.fill, st = leaf ? leaf.stroke : App.defaults.stroke;
    const fillCss = !f || f.type === 'none' ? null : f.type === 'solid' ? f.color : `linear-gradient(90deg, ${f.color}, ${f.color2})`;
    UI.$('#stFill').innerHTML = `<span class="chip${fillCss ? '' : ' none'}" style="background:${fillCss || 'transparent'}"></span>${!f || f.type === 'none' ? 'Нет' : f.type === 'solid' ? UI.colorName(f.color) : f.type === 'linear' ? 'Линейный градиент' : 'Радиальный градиент'}`;
    UI.$('#stStroke').innerHTML = `<span class="chip ring${st && st.color ? '' : ' none'}" style="border-color:${st && st.color || 'transparent'}"></span>${st && st.color && st.width > 0 ? UI.colorName(st.color) + ' · ' + (+st.width.toFixed(3)) + ' мм' : 'Нет'}`;
  },
  colorName(hex) {
    const p = PALETTE.find(c => c.hex.toLowerCase() === String(hex).toLowerCase());
    if (p) return p.name;
    const c = Color.toCmyk(hex);
    return `C${c.c} M${c.m} Y${c.y} K${c.k}`;
  },
  toast(msg, force = false) {
    // во время работы агента служебные сообщения не нужны — он сам пишет, что делает
    if (typeof Agent !== 'undefined' && Agent.running && !force) return;
    const t = h('div', { class: 'toast' }, msg);
    UI.$('#toasts').append(t);
    setTimeout(() => t.classList.add('hide'), 2600);
    setTimeout(() => t.remove(), 3100);
  },

  // ================== Панель свойств ==================
  // Поле ввода числа: применяется по Enter/уходу фокуса, колесо и стрелки — шаг
  num(label, val, set, o = {}) {
    const inp = h('input', { type: 'text', class: 'num', value: Number.isFinite(val) ? String(G.round(val, o.dec ?? 2)) : '', title: o.title || label, style: o.w ? { width: o.w + 'px' } : null });
    // last — уже применённое значение: чтобы Enter, уход фокуса и стрелки не применяли его дважды
    let last = inp.value;
    const apply = () => {
      if (inp.value === last) return;
      last = inp.value;
      const v = UI.evalNum(inp.value);
      if (v !== null) set(v);
      setTimeout(() => UI.refresh(), 0);
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { apply(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = last; inp.blur(); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const v = (UI.evalNum(inp.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (o.step || 1) * (e.shiftKey ? 10 : 1);
        inp.value = String(G.round(v, o.dec ?? 2)); last = inp.value; set(v);
      }
      e.stopPropagation();
    });
    inp.addEventListener('change', apply);
    inp.addEventListener('focus', () => inp.select());
    return h('label', { class: 'fld' }, label ? h('span', { class: 'fl' }, label) : null, inp, o.unit ? h('span', { class: 'fu' }, o.unit) : null);
  },
  // в поле можно ввести выражение: «100/3», «25.4*2»
  evalNum(s) {
    s = String(s).replace(',', '.').replace(/[^\d.+\-*/() e]/g, '');
    if (!s.trim()) return null;
    try { const v = Function('"use strict";return (' + s + ')')(); return Number.isFinite(v) ? v : null; } catch (e) { return null; }
  },
  btn(ic, title, fn, active) {
    return h('button', { class: 'pb' + (active ? ' on' : ''), title, html: icon(ic, 18), onclick: fn });
  },
  sel(options, val, set, title, w) {
    const s = h('select', { title, style: w ? { width: w + 'px' } : null, onchange: e => { set(e.target.value); e.target.blur(); } });
    for (const o of options) {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      s.append(h('option', { value: v, selected: String(v) === String(val) }, l));
    }
    return s;
  },
  propKey: '',
  renderPropbar() {
    const pb = UI.$('#propbar');
    if (pb.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    pb.innerHTML = '';
    const add = (...els) => pb.append(...els);
    const sep = () => h('span', { class: 'sep' });
    const objs = App.selObjs();
    const T = App.tool;

    if (['blend', 'contour', 'envelope', 'extrude'].includes(T)) {
      UI.effectControls(add, T);
      return;
    }
    if (objs.length === 1 && objs[0].type === 'blend' && T === 'pick') {
      UI.effectControls(add, 'blend'); add(sep());
    }

    if (T === 'shape' && objs.length === 1) {
      const S = Tools.shape, o = objs[0];
      if (o.type === 'path') {
        add(h('span', { class: 'pl' }, 'Узлы:'),
          UI.btn('nodeAdd', 'Добавить узел (+ / двойной щелчок по сегменту)', S.addNodes), UI.btn('nodeDel', 'Удалить узел (Del / двойной щелчок по узлу)', S.deleteNodes), sep(),
          UI.btn('nodeJoin', 'Соединить два конечных узла', S.joinNodes), UI.btn('nodeBreak', 'Разорвать кривую в узле', S.breakAt), sep(),
          UI.btn('toLine', 'Сегмент в линию', () => S.segType(false)), UI.btn('toCurve', 'Сегмент в кривую', () => S.segType(true)), sep(),
          UI.btn('cusp', 'Острый угол', () => S.setType('cusp')), UI.btn('smooth', 'Сглаженный узел', () => S.setType('smooth')), UI.btn('sym', 'Симметричный узел', () => S.setType('sym')), sep(),
          UI.btn('close', 'Замкнуть / разомкнуть кривую', S.toggleClose), UI.btn('reverse', 'Обратить направление', S.reverse), sep(),
          h('span', { class: 'pl muted' }, 'Shift — несколько узлов, рамка — выбор областью, тяните сегмент — изгиб'));
        return;
      }
      add(h('span', { class: 'pl muted' }, o.type === 'rect' ? 'Тяните угловой узел — скругление углов' : o.type === 'ellipse' ? 'Тяните узел: внутри эллипса — сектор, снаружи — дуга' : o.type === 'polygon' ? 'Тяните внутренний узел — звезда и острота лучей' : 'Для узлов преобразуйте в кривые (Ctrl+Q)'), sep(),
        h('button', { class: 'pbt', onclick: Actions.toCurves }, 'Преобразовать в кривые'));
    }

    // параметры инструментов создания
    if (!objs.length || ['polygon', 'star', 'spiral', 'text', 'rect', 'ellipse', 'freehand'].includes(T) && !objs.length) {
      if (T === 'polygon') add(UI.num('Углов', UI.opts.polySides, v => { UI.opts.polySides = G.clamp(Math.round(v), 3, 500); UI.saveOpts(); UI.refresh(); }, { w: 44 }));
      if (T === 'star') add(UI.num('Лучей', UI.opts.starPoints, v => { UI.opts.starPoints = G.clamp(Math.round(v), 3, 500); UI.saveOpts(); }, { w: 44 }),
        UI.num('Острота', Math.round((1 - UI.opts.starInner) * 100), v => { UI.opts.starInner = G.clamp(1 - v / 100, 0.02, 0.98); UI.saveOpts(); }, { w: 44 }));
      if (T === 'spiral') add(UI.num('Витков', UI.opts.spiralTurns, v => { UI.opts.spiralTurns = G.clamp(v, 1, 100); UI.saveOpts(); }, { w: 44 }));
      if (T === 'rect') add(UI.num('Скругление', UI.opts.rectR, v => { UI.opts.rectR = Math.max(0, v); UI.saveOpts(); }, { unit: 'мм', w: 50 }));
      if (T === 'ellipse') add(UI.btn('ellFull', 'Эллипс', () => { UI.opts.ellMode = 'ellipse'; UI.saveOpts(); UI.refresh(); }, UI.opts.ellMode === 'ellipse'),
        UI.btn('ellPie', 'Сектор', () => { UI.opts.ellMode = 'pie'; UI.saveOpts(); UI.refresh(); }, UI.opts.ellMode === 'pie'),
        UI.btn('ellArc', 'Дуга', () => { UI.opts.ellMode = 'arc'; UI.saveOpts(); UI.refresh(); }, UI.opts.ellMode === 'arc'));
      if (T === 'freehand') add(UI.num('Сглаживание', UI.opts.smooth * 10, v => { UI.opts.smooth = G.clamp(v, 0, 100) / 10; UI.saveOpts(); }, { w: 44 }));
      if (T === 'text') UI.textControls(add, null);
      if (pb.childNodes.length) return;
    }

    if (!objs.length) {
      // свойства страницы
      const p = App.pg();
      const cur = PAGE_SIZES.find(s => (Math.abs(s[1] - p.w) < 0.1 && Math.abs(s[2] - p.h) < 0.1) || (Math.abs(s[2] - p.w) < 0.1 && Math.abs(s[1] - p.h) < 0.1));
      add(UI.sel([['', 'Свой размер'], ...PAGE_SIZES.map(s => [s[0], s[0]])], cur ? cur[0] : '', v => {
        const s = PAGE_SIZES.find(x => x[0] === v); if (!s) return;
        const land = p.w > p.h;
        p.w = land ? s[2] : s[1]; p.h = land ? s[1] : s[2];
        App.commit('Размер страницы'); App.zoomPage();
      }, 'Размер страницы', 140),
      UI.num('Ш', p.w, v => { p.w = Math.max(1, v); App.commit('Размер страницы'); }, { unit: 'мм', w: 56 }),
      UI.num('В', p.h, v => { p.h = Math.max(1, v); App.commit('Размер страницы'); }, { unit: 'мм', w: 56 }),
      UI.btn('portrait', 'Книжная', () => UI.setOrientation(false), p.h >= p.w), UI.btn('landscape', 'Альбомная', () => UI.setOrientation(true), p.w > p.h), sep(),
      h('span', { class: 'pl' }, 'Единицы: мм'), sep(),
      UI.num('Шаг сдвига', App.nudge, v => { App.nudge = Math.max(0.01, v); }, { unit: 'мм', w: 44, title: 'Сдвиг стрелками (Shift — ×10, Ctrl — ×0.1)' }),
      UI.num('Сетка', App.doc.grid.size, v => { App.doc.grid.size = Math.max(0.1, v); App.commit('Сетка'); }, { unit: 'мм', w: 44 }));
      return;
    }

    // габариты выделения
    // габарит пересчитывается в момент применения: поле может меняться стрелками несколько раз подряд
    const cur = () => { const b = Model.selBox(); return { W: b.x2 - b.x1, H: b.y2 - b.y1, cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2 }; };
    const { W, H, cx, cy } = cur();
    const xform = (T, label) => { App.selObjs().forEach(o => Model.applyT(o, T)); App.commit(label); };
    const lock = App.view.lockRatio !== false;
    add(UI.num('X', cx, v => xform(Mx.translate(v - cur().cx, 0), 'Положение'), { unit: 'мм', w: 62, title: 'Центр по X' }),
      UI.num('Y', cy, v => xform(Mx.translate(0, v - cur().cy), 'Положение'), { unit: 'мм', w: 62, title: 'Центр по Y' }), sep(),
      UI.num('Ш', W, v => { const c = cur(); if (v <= 0 || !c.W) return; const s = v / c.W; xform(Mx.scale(s, lock ? s : 1, c.cx, c.cy), 'Размер'); }, { unit: 'мм', w: 62 }),
      UI.num('В', H, v => { const c = cur(); if (v <= 0 || !c.H) return; const s = v / c.H; xform(Mx.scale(lock ? s : 1, s, c.cx, c.cy), 'Размер'); }, { unit: 'мм', w: 62 }),
      UI.btn(lock ? 'lock' : 'unlock', 'Сохранять пропорции', () => { App.view.lockRatio = !lock; App.saveView(); UI.refresh(); }, lock), sep());
    const o = objs[0];
    const angOf = () => objs.length === 1 && o.type !== 'group' && o.type !== 'powerclip' ? ((-Mx.angle(Model.get(o.id).m) % 360) + 360) % 360 : 0;
    let ang = angOf();
    add(UI.num('∠', ang, v => { const c = cur(); xform(Mx.rotate(-(v - ang), c.cx, c.cy), 'Поворот'); ang = objs.length === 1 ? angOf() : v; }, { unit: '°', w: 50, dec: 1, title: 'Угол поворота (против часовой)' }),
      UI.btn('mirrorH', 'Зеркально по горизонтали', () => Actions.mirror(true)), UI.btn('mirrorV', 'Зеркально по вертикали', () => Actions.mirror(false)), sep());

    if (objs.length === 1) {
      if (o.type === 'rect') add(UI.num('Скругление', o.r || 0, v => { o.r = G.clamp(v, 0, Math.min(o.w, o.h) / 2); App.commit('Скругление'); }, { unit: 'мм', w: 50 }), sep());
      if (o.type === 'ellipse') {
        const setMode = m => { o.mode = m; if (m !== 'ellipse' && (o.a2 === undefined || o.a2 === 360)) { o.a1 = 0; o.a2 = 270; } App.commit('Тип эллипса'); };
        add(UI.btn('ellFull', 'Эллипс', () => setMode('ellipse'), o.mode === 'ellipse'), UI.btn('ellPie', 'Сектор', () => setMode('pie'), o.mode === 'pie'), UI.btn('ellArc', 'Дуга', () => setMode('arc'), o.mode === 'arc'));
        if (o.mode !== 'ellipse') add(UI.num('От', o.a1 || 0, v => { o.a1 = v; App.commit('Угол'); }, { unit: '°', w: 44, dec: 1 }), UI.num('До', o.a2 ?? 270, v => { o.a2 = v; App.commit('Угол'); }, { unit: '°', w: 44, dec: 1 }));
        add(sep());
      }
      if (o.type === 'polygon') {
        add(UI.num(o.star ? 'Лучей' : 'Углов', o.sides, v => { o.sides = G.clamp(Math.round(v), 3, 500); App.commit('Углы'); }, { w: 40 }),
          UI.btn('star', 'Звезда', () => { o.star = !o.star; App.commit('Звезда'); }, o.star));
        if (o.star) add(UI.num('Острота', Math.round((1 - o.inner) * 100), v => { o.inner = G.clamp(1 - v / 100, 0.02, 0.98); App.commit('Острота'); }, { w: 40 }));
        add(sep());
      }
      if (o.type === 'text') { UI.textControls(add, o); add(sep()); }
      if (o.type === 'group') add(UI.btn('ungroup', 'Отменить группировку (Ctrl+U)', Actions.ungroup), sep());
    }
    if (objs.length > 1) add(UI.btn('group', 'Сгруппировать (Ctrl+G)', Actions.group), sep());
    if (objs.length >= 1 && objs.some(x => ['rect', 'ellipse', 'polygon'].includes(x.type))) add(UI.btn('curves', 'Преобразовать в кривые (Ctrl+Q)', Actions.toCurves));
    // толщина абриса
    const leaf = Model.leaves(o)[0];
    const sw = leaf && leaf.stroke && leaf.stroke.color ? leaf.stroke.width : 0;
    add(h('span', { class: 'pl' }, 'Абрис'), UI.strokeWidthSelect(sw, v => Actions.setStrokeWidth(v)));
  },
  colorBtn(val, set, title) {
    const c = h('input', { type: 'color', class: 'cbtn', value: val || '#000000', title });
    c.addEventListener('change', () => set(c.value));
    return c;
  },
  // параметры живых эффектов (панель свойств и докер)
  effectControls(add, kind) {
    const objs = App.selObjs(), o = objs[0];
    const leaf = o && Model.leaves(o)[0];
    const sep = () => h('span', { class: 'sep' });
    const A = Actions;
    if (kind === 'blend') {
      const bl = objs.find(x => x.type === 'blend');
      if (!bl) { add(UI.num('Шагов', UI.opts.blendSteps || 10, v => { UI.opts.blendSteps = G.clamp(Math.round(v), 1, 500); UI.saveOpts(); }, { w: 44 }), h('span', { class: 'pl muted' }, 'Нажмите на первом объекте и отпустите на втором. Ctrl+щелчок — правка исходных объектов, перетекание перестроится само')); return; }
      add(h('span', { class: 'pl' }, 'Перетекание'), UI.num('Шагов', bl.steps, v => A.setBlendSteps(v), { w: 44 }),
        h('button', { class: 'pbt', onclick: A.breakEffect, title: 'Превратить в обычную группу объектов' }, 'Разъединить'));
      return;
    }
    if (!leaf || ['image'].includes(leaf.type)) { add(h('span', { class: 'pl muted' }, 'Выделите фигуру, кривую или текст')); return; }
    if (kind === 'contour') {
      const c = leaf.contour || {};
      const dirB = (d, l) => h('button', { class: 'pbt' + (c.dir === d ? ' on' : ''), onclick: () => A.contour({ dir: d }) }, l);
      add(h('span', { class: 'pl' }, 'Контур'), dirB('outside', 'Наружу'), dirB('inside', 'Внутрь'), dirB('center', 'К центру'),
        UI.num('Шагов', c.steps || 3, v => A.contour({ steps: G.clamp(Math.round(v), 1, 200) }), { w: 40 }),
        UI.num('Смещение', c.offset || 2, v => A.contour({ offset: Math.max(0.05, v) }), { unit: 'мм', w: 44 }),
        h('span', { class: 'pl' }, 'Заливка до'), UI.colorBtn(c.fill || '#ffffff', v => A.contour({ fill: v }), 'Цвет последнего шага'),
        h('span', { class: 'pl' }, 'Абрис до'), UI.colorBtn(c.stroke || (leaf.stroke && leaf.stroke.color) || '#000000', v => A.contour({ stroke: v }), 'Цвет абриса последнего шага'),
        sep(), h('button', { class: 'pbt', onclick: () => A.clearEffects('contour') }, 'Убрать'), h('button', { class: 'pbt', onclick: A.breakEffect }, 'Разъединить'));
    }
    if (kind === 'extrude') {
      const x = leaf.extrude || {};
      add(h('span', { class: 'pl' }, 'Выдавливание'),
        UI.num('Глубина', x.depth || 10, v => A.extrude({ depth: Math.max(0.1, v) }), { unit: 'мм', w: 44 }),
        UI.num('Угол', x.angle ?? -45, v => A.extrude({ angle: v }), { unit: '°', w: 40, dec: 1 }),
        UI.num('Перспектива', Math.round((x.persp || 0) * 100), v => A.extrude({ persp: G.clamp(v / 100, 0, 0.95) }), { unit: '%', w: 36 }),
        h('span', { class: 'pl' }, 'Боковины'), UI.colorBtn(x.color || Color.mix((leaf.fill && leaf.fill.color) || '#777777', '#000000', 0.35), v => A.extrude({ color: v }), 'Цвет боковых граней'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: x.shade !== false, onchange: e => A.extrude({ shade: e.target.checked }) }), 'Свет'),
        sep(), h('button', { class: 'pbt', onclick: () => A.clearEffects('extrude') }, 'Убрать'), h('button', { class: 'pbt', onclick: A.breakEffect }, 'Разъединить'));
    }
    if (kind === 'envelope') {
      const P = (k, l) => h('button', { class: 'pbt', onclick: () => A.envelope(k) }, l);
      add(h('span', { class: 'pl' }, 'Оболочка'), P('arcUp', 'Дуга ⌒'), P('arcDown', 'Дуга ⌣'), P('bulge', 'Выпуклость'), P('pinch', 'Сжатие'),
        P('flagUp', 'Флаг'), P('perspective', 'Перспектива'), P('trapezoid', 'Трапеция'), sep(),
        h('label', { class: 'chk', title: 'Прямые стороны: середины следуют за углами' }, h('input', { type: 'checkbox', checked: leaf.envelope && leaf.envelope.mode === 'straight', onchange: e => { Actions.setPaint(l => { if (!l.envelope) l.envelope = Effects.defaultEnvelope(Model.localBox(l)); l.envelope.mode = e.target.checked ? 'straight' : 'curve'; }, 'Режим оболочки'); } }), 'Прямые'),
        P('reset', 'Сбросить'), h('button', { class: 'pbt', onclick: () => A.envelope('none') }, 'Убрать'),
        h('span', { class: 'pl muted' }, 'Тяните узлы рамки; Ctrl — середина только поперёк стороны'));
    }
  },
  strokeWidthSelect(val, set) {
    const list = [[0, 'Нет'], [0.1, '0.1 мм'], [0.2, '0.2 мм'], [0.25, '0.25 мм'], [0.35, '0.35 мм'], [0.5, '0.5 мм'], [0.75, '0.75 мм'], [1, '1 мм'], [1.5, '1.5 мм'], [2, '2 мм'], [3, '3 мм'], [5, '5 мм']];
    if (!list.find(x => Math.abs(x[0] - val) < 1e-6)) list.push([val, (+val.toFixed(3)) + ' мм']);
    return UI.sel(list, list.find(x => Math.abs(x[0] - val) < 1e-6)[0], v => set(+v), 'Толщина абриса', 96);
  },
  textControls(add, o) {
    const src = o || UI.opts;
    const set = (k, v) => {
      if (o) { o[k] = v; App.commit('Текст'); } else { UI.opts[k === 'size' ? 'fontSize' : k] = v; UI.saveOpts(); UI.refresh(); }
    };
    const font = o ? o.font : UI.opts.font, size = o ? o.size : UI.opts.fontSize;
    const fonts = Fonts.all();
    if (!fonts.includes(font)) fonts.unshift(font);
    const fsel = UI.sel(fonts.map(f => [f, f]), font, v => set('font', v), 'Шрифт', 160);
    fsel.querySelectorAll('option').forEach(op => { op.style.fontFamily = `"${op.value}"`; });
    add(fsel,
      UI.btn('fontAdd', 'Шрифты: загрузить файл или подключить системные', e => UI.fontMenu(e)),
      UI.num('', size, v => set('size', Math.max(1, v)), { unit: 'пт', w: 44, title: 'Кегль' }),
      UI.btn('bold', 'Полужирный', () => set('bold', !src.bold), !!src.bold),
      UI.btn('italic', 'Курсив', () => set('italic', !src.italic), !!src.italic),
      UI.btn('alignL', 'Влево', () => set('align', 'left'), (src.align || 'left') === 'left'),
      UI.btn('alignC', 'По центру', () => set('align', 'center'), src.align === 'center'),
      UI.btn('alignR', 'Вправо', () => set('align', 'right'), src.align === 'right'),
      UI.btn('alignJ', 'По ширине (для абзацного текста)', () => set('align', 'justify'), src.align === 'justify'));
    if (o) {
      add(UI.num('Интерв.', (o.lh || 1.2) * 100, v => set('lh', Math.max(0.5, v / 100)), { unit: '%', w: 40, title: 'Межстрочный интервал' }),
        UI.num('Трекинг', o.ls || 0, v => set('ls', v), { unit: '%', w: 36, title: 'Межсимвольный интервал, % кегля' }),
        h('button', { class: 'pbt', title: 'Фигурный ↔ абзацный текст', onclick: () => {
          if (o.frame) o.frame = null;
          else { const b = Text.layout(o).box; o.frame = { w: Math.max(10, b.x2 - b.x1 + 2), h: Math.max(5, b.y2 - b.y1) }; if (o.align === 'center' || o.align === 'right') { const m = o.m; o.m = Mx.mul(m, Mx.translate(b.x1, 0)); } }
          App.commit('Тип текста');
        } }, o.frame ? '→ фигурный' : '→ абзацный'));
    }
  },
  fontMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    UI.showMenuList([
      { label: 'Загрузить файл шрифта (.ttf, .otf)…', action: UI.loadFontFiles },
      { label: 'Подключить шрифты системы', action: () => Fonts.loadLocal() },
    ], r.left, r.bottom);
  },
  async loadFontFiles() {
    for (const f of await Host.pickFiles('.ttf,.otf,.woff', true, 'Файлы шрифтов')) {
      const fam = await Fonts.addFontFile(f.name, await f.read());
      if (fam) UI.toast('Шрифт добавлен: ' + fam);
    }
  },
  // индикатор долгой операции
  busy(msg) {
    let el = UI.$('#busy');
    if (!msg) { if (el) el.remove(); return; }
    if (!el) { el = h('div', { id: 'busy', class: 'busy' }); document.body.append(el); }
    el.innerHTML = `<span class="spin"></span>${Render.esc(msg)}`;
  },
  setOrientation(land) {
    const p = App.pg();
    if ((p.w > p.h) !== land) { [p.w, p.h] = [p.h, p.w]; App.commit('Ориентация'); App.zoomPage(); }
  },

  // ================== Докеры ==================
  docker(tab) {
    UI.dockTab = tab; UI.dockOpen = true;
    UI.$('#app').classList.remove('nodock');
    try { localStorage.setItem('vektor.dock', tab); } catch (e) { }
    UI.refresh();
  },
  renderDocker() {
    const d = UI.$('#docker');
    if (!UI.dockOpen) return;
    const tabs = [['agent', '✦ Агент'], ['props', 'Свойства'], ['objects', 'Объекты'], ['align', 'Выравн.'], ['transform', 'Преобр.']];
    UI.$('#app').classList.toggle('wide-dock', UI.dockTab === 'agent');
    if (UI.dockTab === 'agent') {
      // панель агента строится один раз: переписка и поле ввода не должны сбрасываться при каждой перерисовке
      if (d.dataset.tab === 'agent' && d.querySelector('#agentPanel')) return;
      d.innerHTML = ''; d.dataset.tab = 'agent';
      d.append(h('div', { class: 'dtabs' }, tabs.map(([k, l]) => h('div', { class: 'dtab' + (UI.dockTab === k ? ' on' : ''), onclick: () => UI.docker(k) }, l))));
      d.append(Agent.el || Agent.build());
      return;
    }
    d.dataset.tab = UI.dockTab;
    const ae = document.activeElement;
    if (d.contains(ae) && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT') && ae.type !== 'checkbox' && ae.type !== 'range') return;
    const scroll = UI.$('#dockBody') ? UI.$('#dockBody').scrollTop : 0;
    d.innerHTML = '';
    d.append(h('div', { class: 'dtabs' }, tabs.map(([k, l]) => h('div', { class: 'dtab' + (UI.dockTab === k ? ' on' : ''), onclick: () => UI.docker(k) }, l))));
    const body = h('div', { class: 'dbody', id: 'dockBody' });
    d.append(body);
    ({ props: UI.dockProps, objects: UI.dockObjects, align: UI.dockAlign, transform: UI.dockTransform })[UI.dockTab](body);
    body.scrollTop = scroll;
  },
  section(title, ...kids) { return h('div', { class: 'dsec' }, h('div', { class: 'dsec-t' }, title), ...kids); },
  row(...kids) { return h('div', { class: 'drow' }, ...kids); },
  colorField(val, onInput, onChange) {
    const wrap = h('div', { class: 'cfield' });
    const ci = h('input', { type: 'color', value: val || '#000000' });
    const hx = h('input', { type: 'text', class: 'hex', value: val || '', maxlength: 7 });
    const cm = Color.toCmyk(val || '#000000');
    const cmyk = ['c', 'm', 'y', 'k'].map(k => h('input', { type: 'text', class: 'cmyk', value: cm[k], title: k.toUpperCase() + ', %' }));
    const fromCmyk = () => { const v = cmyk.map(i => G.clamp(+i.value || 0, 0, 100)); const hex = Color.fromCmyk(...v); ci.value = hex; hx.value = hex; onChange(hex); };
    ci.addEventListener('input', () => { hx.value = ci.value; onInput(ci.value); });
    ci.addEventListener('change', () => onChange(ci.value));
    hx.addEventListener('change', () => { const c = Color.normalize(hx.value.startsWith('#') ? hx.value : '#' + hx.value); if (c) { ci.value = c; onChange(c); } });
    cmyk.forEach(i => { i.addEventListener('change', fromCmyk); i.addEventListener('keydown', e => e.stopPropagation()); });
    hx.addEventListener('keydown', e => e.stopPropagation());
    wrap.append(h('div', { class: 'crow' }, ci, hx), h('div', { class: 'crow' }, h('span', { class: 'cmyk-l' }, 'CMYK'), ...cmyk));
    return wrap;
  },
  dockProps(body) {
    const objs = App.selObjs();
    const leaves = objs.flatMap(o => Model.leaves(o));
    const editDefaults = !leaves.length;
    const L = editDefaults ? App.defaults : leaves[0];
    const live = fn => { if (editDefaults) { fn(App.defaults); UI.refresh({ panels: false }); } else Actions.setPaint(fn, '', false); };
    const done = (fn, label) => { if (editDefaults) { fn(App.defaults); UI.refresh(); } else Actions.setPaint(fn, label); };
    if (editDefaults) body.append(h('div', { class: 'dnote' }, 'Ничего не выделено — настраиваются заливка и абрис для новых фигур.'));
    else body.append(h('div', { class: 'dnote' }, objs.length === 1 ? Model.label(objs[0]) : `Выделено: ${objs.length}`));

    // --- заливка ---
    const f = L.fill || { type: 'none' };
    const ftypes = [['none', 'Нет'], ['solid', 'Однородная'], ['linear', 'Линейная'], ['radial', 'Радиальная']];
    const fsec = UI.section('Заливка',
      h('div', { class: 'seg' }, ftypes.map(([k, l]) => h('button', { class: f.type === k ? 'on' : '', onclick: () => done(o => {
        o.fill = Object.assign({ color: '#000000', color2: '#ffffff', angle: 0 }, o.fill || {}, { type: k });
        if (k !== 'none' && (!o.fill.color)) o.fill.color = '#000000';
      }, 'Тип заливки') }, l))));
    if (f.type !== 'none') {
      fsec.append(UI.row(h('span', { class: 'dl' }, f.type === 'solid' ? 'Цвет' : 'Цвет 1'),
        UI.colorField(f.color, c => live(o => { o.fill.color = c; }), c => done(o => { o.fill.color = c; }, 'Цвет заливки'))));
      if (f.type === 'linear' || f.type === 'radial') {
        fsec.append(UI.row(h('span', { class: 'dl' }, 'Цвет 2'),
          UI.colorField(f.color2, c => live(o => { o.fill.color2 = c; }), c => done(o => { o.fill.color2 = c; }, 'Цвет заливки'))));
        fsec.append(UI.row(h('button', { class: 'pbt', onclick: () => done(o => { [o.fill.color, o.fill.color2] = [o.fill.color2, o.fill.color]; }, 'Цвета градиента') }, '⇄ Поменять цвета')));
        if (f.type === 'linear') {
          const rng = h('input', { type: 'range', min: -180, max: 180, value: f.angle || 0 });
          const lab = h('span', { class: 'dv' }, (f.angle || 0) + '°');
          rng.addEventListener('input', () => { lab.textContent = rng.value + '°'; live(o => { o.fill.angle = +rng.value; }); });
          rng.addEventListener('change', () => done(o => { o.fill.angle = +rng.value; }, 'Угол градиента'));
          fsec.append(UI.row(h('span', { class: 'dl' }, 'Угол'), rng, lab));
        }
      }
    }
    body.append(fsec);

    // --- абрис ---
    const s = L.stroke || {};
    const ssec = UI.section('Абрис');
    ssec.append(UI.row(h('span', { class: 'dl' }, 'Толщина'), UI.strokeWidthSelect(s.color ? s.width || 0 : 0, v => done(o => {
      o.stroke = Object.assign(structuredClone(App.defaults.stroke), o.stroke || {}, { width: v });
      if (v > 0 && !o.stroke.color) o.stroke.color = '#000000';
      if (!v) o.stroke.color = null;
    }, 'Толщина абриса')), UI.num('', s.color ? s.width || 0 : 0, v => done(o => { o.stroke = Object.assign(structuredClone(App.defaults.stroke), o.stroke || {}, { width: Math.max(0, v) }); if (v > 0 && !o.stroke.color) o.stroke.color = '#000000'; }, 'Толщина абриса'), { unit: 'мм', w: 48, dec: 3 })));
    if (s.color) {
      ssec.append(UI.row(h('span', { class: 'dl' }, 'Цвет'), UI.colorField(s.color, c => live(o => { if (o.stroke) o.stroke.color = c; }), c => done(o => { o.stroke = Object.assign(structuredClone(App.defaults.stroke), o.stroke || {}, { color: c }); }, 'Цвет абриса'))));
      ssec.append(UI.row(h('span', { class: 'dl' }, 'Стиль'), UI.sel([['solid', '———— сплошной'], ['dash', '— — — штрих'], ['dot', '· · · · пунктир'], ['dashdot', '— · — штрихпунктир']], s.dash || 'solid', v => done(o => { o.stroke.dash = v; }, 'Стиль линии'), 'Стиль линии', 150)));
      ssec.append(UI.row(h('span', { class: 'dl' }, 'Концы'), UI.sel([['butt', 'Срезанные'], ['round', 'Круглые'], ['square', 'Квадратные']], s.cap || 'butt', v => done(o => { o.stroke.cap = v; }, 'Концы линии'), 'Концы', 110),
        UI.sel([['miter', 'Углы: острые'], ['round', 'Углы: круглые'], ['bevel', 'Углы: срезанные']], s.join || 'miter', v => done(o => { o.stroke.join = v; }, 'Углы'), 'Углы', 120)));
      if (leaves.some(x => x.type === 'path')) {
        const cb = (k, l) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!s[k], onchange: e => done(o => { o.stroke[k] = e.target.checked; }, 'Стрелки') }), l);
        ssec.append(UI.row(h('span', { class: 'dl' }, 'Стрелки'), cb('arrowStart', 'в начале'), cb('arrowEnd', 'в конце')));
      }
    }
    body.append(ssec);
    if (editDefaults) return;

    // --- прозрачность и тень ---
    const op = Math.round((1 - (L.opacity ?? 1)) * 100);
    const rng = h('input', { type: 'range', min: 0, max: 100, value: op });
    const lab = h('span', { class: 'dv' }, op + '%');
    rng.addEventListener('input', () => { lab.textContent = rng.value + '%'; live(o => { o.opacity = 1 - rng.value / 100; }); });
    rng.addEventListener('change', () => done(o => { o.opacity = 1 - rng.value / 100; }, 'Прозрачность'));
    body.append(UI.section('Прозрачность', UI.row(rng, lab)));

    const sh = L.shadow;
    const shsec = UI.section('Тень', UI.row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!sh, onchange: e => done(o => { o.shadow = e.target.checked ? { dx: 1.5, dy: 1.5, blur: 1.2, color: '#000000', opacity: 0.45 } : null; }, 'Тень') }), 'Отбрасывать тень')));
    if (sh) {
      const sset = (k, v) => done(o => { if (o.shadow) o.shadow[k] = v; }, 'Тень');
      shsec.append(UI.row(UI.num('X', sh.dx, v => sset('dx', v), { unit: 'мм', w: 40 }), UI.num('Y', sh.dy, v => sset('dy', v), { unit: 'мм', w: 40 }), UI.num('Размытие', sh.blur, v => sset('blur', Math.max(0, v)), { unit: 'мм', w: 40 })));
      shsec.append(UI.row(h('span', { class: 'dl' }, 'Цвет'), UI.colorField(sh.color, c => live(o => { if (o.shadow) o.shadow.color = c; }), c => sset('color', c))));
      shsec.append(UI.row(UI.num('Непрозрачность', Math.round(sh.opacity * 100), v => sset('opacity', G.clamp(v / 100, 0, 1)), { unit: '%', w: 40 })));
    }
    body.append(shsec);

    // живые эффекты
    const esec = UI.section('Эффекты');
    const has = { contour: !!L.contour, extrude: !!L.extrude, envelope: !!L.envelope };
    for (const k of ['contour', 'extrude', 'envelope']) {
      if (!has[k]) continue;
      const box = h('div', { class: 'effbox' });
      UI.effectControls((...els) => box.append(...els), k);
      esec.append(box);
    }
    esec.append(UI.row(
      !has.contour ? h('button', { class: 'pbt', onclick: () => Actions.contour({}) }, '+ Контур') : null,
      !has.extrude ? h('button', { class: 'pbt', onclick: () => Actions.extrude({}) }, '+ Выдавливание') : null,
      !has.envelope ? h('button', { class: 'pbt', onclick: () => { Actions.envelope('arcUp'); App.setTool('envelope'); } }, '+ Оболочка') : null));
    if (objs.length === 2) esec.append(UI.row(h('button', { class: 'pbt', onclick: () => Actions.blend(UI.opts.blendSteps || 10) }, 'Перетекание между выделенными')));
    if (objs.some(o => o.type === 'blend')) { const box = h('div', { class: 'effbox' }); UI.effectControls((...els) => box.append(...els), 'blend'); esec.append(box); }
    body.append(esec);

    if (objs.length === 1) {
      const o = objs[0];
      const nm = h('input', { type: 'text', class: 'wide', value: o.name || '', placeholder: Model.typeName(o) });
      nm.addEventListener('change', () => { o.name = nm.value.trim(); App.commit('Имя'); });
      nm.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') nm.blur(); });
      body.append(UI.section('Объект', UI.row(h('span', { class: 'dl' }, 'Имя'), nm)));
    }
  },
  objOpen: new Set(), objRows: 400,
  dockObjects(body) {
    const tools = h('div', { class: 'drow' },
      h('button', { class: 'pbt', onclick: Actions.addLayer }, '+ Слой'),
      App.sel.length ? h('button', { class: 'pbt', onclick: e => {
        const r = e.currentTarget.getBoundingClientRect();
        UI.showMenuList(App.pg().layers.map(L => ({ label: L.name, action: () => Actions.moveToLayer(L.id) })), r.left, r.bottom);
      } }, 'Перенести на слой ▾') : null);
    body.append(tools);
    const list = h('div', { class: 'otree' });
    const layers = App.pg().layers.slice().reverse();
    let rows = 0, more = 0;
    // выделенные объекты внутри групп — разворачиваем их родителей
    for (const id of App.sel) { let f = Model.find(id); while (f && f.parent) { UI.objOpen.add(f.parent.id); f = Model.find(f.parent.id); } }
    for (const L of layers) {
      const active = L.id === App.pg().activeLayer;
      const lrow = h('div', { class: 'orow layer' + (active ? ' active' : ''), onclick: () => { App.pg().activeLayer = L.id; UI.refresh(); } },
        h('button', { class: 'ib', title: 'Показать/скрыть', html: icon(L.visible ? 'eye' : 'eyeOff', 15), onclick: e => { e.stopPropagation(); L.visible = !L.visible; App.commit('Видимость слоя'); } }),
        h('button', { class: 'ib', title: 'Блокировать', html: icon(L.locked ? 'lock' : 'unlock', 15), onclick: e => { e.stopPropagation(); L.locked = !L.locked; App.commit('Блокировка слоя'); } }),
        h('span', { class: 'oname', ondblclick: e => { e.stopPropagation(); UI.prompt('Имя слоя', L.name, v => { L.name = v || L.name; App.commit('Имя слоя'); }); } }, L.name),
        h('button', { class: 'ib', title: 'Удалить слой', html: '×', onclick: e => { e.stopPropagation(); Actions.deleteLayer(L.id); } }));
      lrow.addEventListener('dragover', e => e.preventDefault());
      lrow.addEventListener('drop', e => { e.preventDefault(); UI.dropTo(e.dataTransfer.getData('text/x-obj'), L, null); });
      list.append(lrow);
      const rec = (objs, depth) => {
        for (let ri = objs.length - 1; ri >= 0; ri--) {
          const o = objs[ri];
          if (++rows > UI.objRows) { more++; continue; }
          const selected = App.sel.includes(o.id);
          const kids = o.children || o.container ? (o.children || []).length + (o.container ? 1 : 0) : 0;
          const open = UI.objOpen.has(o.id);
          const r = h('div', { class: 'orow' + (selected ? ' sel' : ''), style: { paddingLeft: (10 + depth * 14) + 'px' }, draggable: depth === 0 ? 'true' : null,
            onclick: e => {
              if (depth > 0) return;
              if (e.shiftKey || e.ctrlKey) App.sel = selected ? App.sel.filter(x => x !== o.id) : App.sel.concat(o.id);
              else App.sel = [o.id];
              App.rotateMode = false; UI.refresh({ doc: false });
            } },
          kids ? h('button', { class: 'ib otog', title: open ? 'Свернуть' : 'Развернуть', onclick: e => { e.stopPropagation(); open ? UI.objOpen.delete(o.id) : UI.objOpen.add(o.id); UI.renderDocker(); } }, open ? '▾' : '▸') : h('span', { class: 'ib otog' }),
          h('button', { class: 'ib', title: 'Показать/скрыть', html: icon(o.visible ? 'eye' : 'eyeOff', 14), onclick: e => { e.stopPropagation(); o.visible = !o.visible; App.commit('Видимость'); } }),
          h('button', { class: 'ib', title: 'Блокировать', html: icon(o.locked ? 'lock' : 'unlock', 14), onclick: e => { e.stopPropagation(); o.locked = !o.locked; if (o.locked) App.sel = App.sel.filter(x => x !== o.id); App.commit('Блокировка'); } }),
          h('span', { class: 'oswatch', style: { background: o.fill && o.fill.type !== 'none' ? (o.fill.color || '#000') : 'transparent', borderColor: o.stroke && o.stroke.color || '#999' } }),
          h('span', { class: 'oname', ondblclick: e => { e.stopPropagation(); UI.prompt('Имя объекта', o.name || '', v => { o.name = v; App.commit('Имя'); }); } }, Model.label(o)));
          if (depth === 0) {
            r.addEventListener('dragstart', e => e.dataTransfer.setData('text/x-obj', o.id));
            r.addEventListener('dragover', e => e.preventDefault());
            r.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); UI.dropTo(e.dataTransfer.getData('text/x-obj'), L, o.id); });
          }
          list.append(r);
          if (kids && open) {
            if (o.children) rec(o.children, depth + 1);
            if (o.container) rec([o.container], depth + 1);
          }
        }
      };
      rec(L.objects, 1 - 1);
    }
    if (more) list.append(h('button', { class: 'pbt omore', onclick: () => { UI.objRows += 500; UI.renderDocker(); } }, `Показать ещё (скрыто строк: ${more})`));
    body.append(list);
    body.append(h('div', { class: 'dnote' }, 'Перетаскивайте строки, чтобы менять порядок и слой. Двойной щелчок — переименовать.'));
  },
  dropTo(id, L, beforeId) {
    if (!id || id === beforeId) return;
    const f = Model.find(id); if (!f || f.parent) return;
    f.list.splice(f.list.indexOf(f.obj), 1);
    if (!beforeId) L.objects.push(f.obj);
    else {
      // в дереве верх списка = передний план, поэтому «над строкой» = после неё в массиве
      const k = L.objects.findIndex(o => o.id === beforeId);
      L.objects.splice(k + 1, 0, f.obj);
    }
    App.commit('Порядок');
  },
  alignTo: 'auto',
  dockAlign(body) {
    const A = Actions;
    const to = () => UI.alignTo === 'auto' ? undefined : UI.alignTo;
    const B = (lab, fn, title) => h('button', { class: 'abtn', title, onclick: fn }, lab);
    body.append(UI.section('Выровнять относительно', UI.sel([['auto', 'Последнего выделенного (одиночный — страницы)'], ['last', 'Последнего выделенного'], ['first', 'Первого выделенного'], ['sel', 'Границ выделения'], ['page', 'Страницы']], UI.alignTo, v => { UI.alignTo = v; }, '', 250)));
    body.append(UI.section('Выравнивание',
      h('div', { class: 'agrid' },
        B('⇤ Слева', () => A.align('left', to()), 'L'), B('⇔ Центр', () => A.align('hcenter', to()), 'E'), B('⇥ Справа', () => A.align('right', to()), 'R'),
        B('⤒ Сверху', () => A.align('top', to()), 'T'), B('⇕ Центр', () => A.align('vcenter', to()), 'C'), B('⤓ Снизу', () => A.align('bottom', to()), 'B')),
      UI.row(B('По центру страницы (P)', A.centerPage))));
    body.append(UI.section('Распределение (от 3 объектов)',
      h('div', { class: 'agrid four' },
        B('Левые', () => A.distribute('left')), B('Центры', () => A.distribute('hcenter')), B('Правые', () => A.distribute('right')), B('Интервал ↔', () => A.distribute('hspace')),
        B('Верхние', () => A.distribute('top')), B('Центры', () => A.distribute('vcenter')), B('Нижние', () => A.distribute('bottom')), B('Интервал ↕', () => A.distribute('vspace')))));
    body.append(UI.section('Формирование (от 2 объектов)',
      h('div', { class: 'agrid' },
        B('Сварка', () => A.shaping('weld'), 'Объединить в один контур'), B('Обрезка', () => A.shaping('trim'), 'Вырезать верхними объектами из нижнего'), B('Пересечение', () => A.shaping('intersect'), 'Новый объект из общей области'),
        B('Перед − зад', () => A.shaping('frontMinusBack')), B('Зад − перед', () => A.shaping('backMinusFront')), B('Объединить', A.combine, 'Ctrl+L'))));
  },
  tf: { tab: 'pos', x: 0, y: 0, rel: true, angle: 90, sx: 100, sy: 100, w: 0, h: 0, kx: 0, ky: 0, copies: 0, prop: true },
  dockTransform(body) {
    const tf = UI.tf;
    const tabs = [['pos', 'Положение'], ['rot', 'Поворот'], ['scale', 'Масштаб'], ['size', 'Размер'], ['skew', 'Наклон']];
    body.append(h('div', { class: 'seg' }, tabs.map(([k, l]) => h('button', { class: tf.tab === k ? 'on' : '', onclick: () => { tf.tab = k; UI.refresh(); } }, l))));
    const b = Model.selBox();
    const sec = h('div', { class: 'dsec' });
    const N = (l, k, unit, o = {}) => UI.num(l, tf[k], v => { tf[k] = v; }, Object.assign({ unit, w: 60 }, o));
    if (tf.tab === 'pos') {
      sec.append(UI.row(N('X', 'x', 'мм'), N('Y', 'y', 'мм')), UI.row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: tf.rel, onchange: e => { tf.rel = e.target.checked; } }), 'Относительное смещение')));
      if (b && !tf.rel) sec.append(h('div', { class: 'dnote' }, `Сейчас центр: ${((b.x1 + b.x2) / 2).toFixed(2)}, ${((b.y1 + b.y2) / 2).toFixed(2)} мм`));
    }
    if (tf.tab === 'rot') sec.append(UI.row(N('Угол', 'angle', '°', { dec: 1 })), h('div', { class: 'dnote' }, 'Против часовой стрелки вокруг центра выделения'));
    if (tf.tab === 'scale') sec.append(UI.row(N('Г', 'sx', '%'), N('В', 'sy', '%')), UI.row(
      h('button', { class: 'pbt', onclick: () => { tf.sx = -Math.abs(tf.sx); tf.sy = Math.abs(tf.sy); UI.refresh(); } }, '⇋ Зеркало Г'),
      h('button', { class: 'pbt', onclick: () => { tf.sy = -Math.abs(tf.sy); tf.sx = Math.abs(tf.sx); UI.refresh(); } }, '⇵ Зеркало В')));
    if (tf.tab === 'size') {
      if (b && !tf.w) { tf.w = G.round(b.x2 - b.x1, 2); tf.h = G.round(b.y2 - b.y1, 2); }
      sec.append(UI.row(N('Ш', 'w', 'мм'), N('В', 'h', 'мм')), UI.row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: tf.prop, onchange: e => { tf.prop = e.target.checked; } }), 'Пропорционально')));
    }
    if (tf.tab === 'skew') sec.append(UI.row(N('Г', 'kx', '°', { dec: 1 }), N('В', 'ky', '°', { dec: 1 })));
    sec.append(UI.row(N('Копии', 'copies', '', { dec: 0, title: 'Сколько копий создать (0 — изменить сам объект)' })));
    sec.append(UI.row(h('button', { class: 'primary', onclick: UI.applyTransform }, 'Применить')));
    body.append(sec);
    body.append(h('div', { class: 'dnote' }, 'Копии: каждая следующая копия получает преобразование относительно предыдущей — так удобно делать «ромашки» и ряды.'));
  },
  applyTransform() {
    // поля читаются по change — перед применением заберём значение из активного поля
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.dispatchEvent(new Event('change'));
    if (!Actions.need()) return;
    const tf = UI.tf;
    const make = () => {
      const b = Model.selBox(), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      switch (tf.tab) {
        case 'pos': return tf.rel ? Mx.translate(tf.x, tf.y) : Mx.translate(tf.x - cx, tf.y - cy);
        case 'rot': return Mx.rotate(-tf.angle, cx, cy);
        case 'scale': return Mx.scale(tf.sx / 100, tf.sy / 100, cx, cy);
        case 'size': {
          const W = b.x2 - b.x1 || 1, H = b.y2 - b.y1 || 1;
          let sx = tf.w / W, sy = tf.h / H;
          if (tf.prop) sy = sx;
          return Mx.scale(sx, sy, cx, cy);
        }
        case 'skew': return Mx.skew(tf.kx, tf.ky, cx, cy);
      }
    };
    const n = Math.max(0, Math.round(tf.copies));
    if (!n) { const T = make(); App.selObjs().forEach(o => Model.applyT(o, T)); }
    else {
      for (let i = 0; i < n; i++) {
        const T = make();
        const copies = App.selObjs().map(o => { const c = Model.clone(o); Model.applyT(c, T); return c; });
        Actions.placeAfter(copies);
      }
    }
    App.commit('Преобразование');
  },

  // ================== Диалоги ==================
  modalOpen() { return !!UI.$('.modal'); },
  dialog(title, content, buttons = [{ label: 'OK', primary: true }], opts = {}) {
    UI.closeDialog();
    UI._onClose = opts.onClose || null;
    const box = h('div', { class: 'dialog' },
      h('div', { class: 'dlg-t' }, title, h('button', { class: 'ib', html: '×', onclick: UI.closeDialog })),
      h('div', { class: 'dlg-b' }, content),
      h('div', { class: 'dlg-f' }, buttons.map(b => h('button', { class: b.primary ? 'primary' : '', onclick: () => { if (b.action && b.action() === false) return; UI.closeDialog(); } }, b.label))));
    const m = h('div', { class: 'modal', onpointerdown: e => { if (e.target === m) UI.closeDialog(); } }, box);
    document.body.append(m);
    const first = box.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 0);
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = buttons.find(b => b.primary); if (p) { if (p.action && p.action() === false) return; UI.closeDialog(); } }
      if (e.key === 'Escape') UI.closeDialog();
    });
    return box;
  },
  closeDialog() {
    document.querySelectorAll('.modal').forEach(m => m.remove());
    if (typeof ModelPick !== 'undefined') ModelPick.close();
    const f = UI._onClose; UI._onClose = null; if (f) f();
  },
  confirm(msg, ok) { UI.dialog('Подтверждение', h('p', {}, msg), [{ label: 'Отмена' }, { label: 'Да', primary: true, action: ok }]); },
  prompt(title, val, ok) {
    const inp = h('input', { type: 'text', class: 'wide', value: val });
    UI.dialog(title, inp, [{ label: 'Отмена' }, { label: 'OK', primary: true, action: () => ok(inp.value.trim()) }]);
  },
  pageDialog() {
    const p = App.pg();
    const w = h('input', { type: 'number', value: p.w, step: 'any' }), hh = h('input', { type: 'number', value: p.h, step: 'any' });
    const col = h('input', { type: 'color', value: p.color || '#ffffff' });
    const name = h('input', { type: 'text', class: 'wide', value: App.doc.name });
    const all = h('input', { type: 'checkbox', checked: App.doc.pages.length === 1 });
    const preset = UI.sel([['', '— шаблон —'], ...PAGE_SIZES.map(s => [s[0], `${s[0]} (${s[1]}×${s[2]} мм)`])], '', v => { const s = PAGE_SIZES.find(x => x[0] === v); if (s) { w.value = s[1]; hh.value = s[2]; } }, '', 260);
    UI.dialog('Свойства документа', h('div', { class: 'form' },
      h('label', {}, 'Название', name), h('label', {}, 'Шаблон', preset),
      h('label', {}, 'Ширина, мм', w), h('label', {}, 'Высота, мм', hh), h('label', {}, 'Цвет фона страницы', col),
      h('label', { class: 'chk' }, all, 'Применить ко всем страницам')),
    [{ label: 'Отмена' }, { label: 'Применить', primary: true, action: () => {
      for (const P of all.checked ? App.doc.pages : [p]) { P.w = Math.max(1, +w.value || P.w); P.h = Math.max(1, +hh.value || P.h); P.color = col.value; }
      App.doc.name = name.value || App.doc.name;
      App.commit('Свойства документа'); App.zoomPage();
    } }]);
  },
  guidesDialog() {
    const g = App.doc.guides;
    const hv = h('textarea', { rows: 4 }, g.h.join('\n')), vv = h('textarea', { rows: 4 }, g.v.join('\n'));
    UI.dialog('Направляющие', h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'По одному значению в мм на строку. Направляющие также можно вытянуть мышью из линеек и убрать, утащив обратно.'),
      h('label', {}, 'Горизонтальные (Y)', hv), h('label', {}, 'Вертикальные (X)', vv)),
    [{ label: 'Отмена' }, { label: 'OK', primary: true, action: () => {
      const parse = t => t.value.split(/[\s;]+/).map(s => UI.evalNum(s)).filter(v => v !== null);
      App.doc.guides = { h: parse(hv), v: parse(vv) }; App.commit('Направляющие');
    } }]);
  },
  blendDialog() {
    if (App.sel.length !== 2) return UI.toast('Для перетекания выделите ровно два объекта');
    const n = h('input', { type: 'number', value: UI.opts.blendSteps || 10, min: 1, max: 500 });
    UI.dialog('Перетекание', h('div', { class: 'form' }, h('label', {}, 'Число промежуточных шагов', n),
      h('p', { class: 'muted' }, 'Между двумя объектами будут построены промежуточные формы с плавным переходом цвета, абриса и размера. Кривые с одинаковым числом узлов перетекают узел в узел.')),
    [{ label: 'Отмена' }, { label: 'Построить', primary: true, action: () => { UI.opts.blendSteps = G.clamp(+n.value || 10, 1, 500); UI.saveOpts(); Actions.blend(UI.opts.blendSteps); } }]);
  },
  showHelp() {
    const rows = [
      ['Пробел', 'Указатель ↔ текущий инструмент'], ['F10', 'Форма (узлы)'], ['F5 / N', 'Свободная форма / Безье'], ['F6 / F7', 'Прямоугольник / Эллипс'],
      ['Y / S / A', 'Многоугольник / Звезда / Спираль'], ['F8', 'Текст'], ['Z / H', 'Масштаб / Панорама'], ['I / G', 'Пипетка / Интерактивная заливка'],
      ['Щелчок по выделенному', 'Маркеры поворота и наклона'], ['Ctrl при перетаскивании', 'Ограничение: по оси, шаг 15°, 100%'], ['Shift при масштабе', 'От центра'], ['Alt + перетаскивание', 'Оставить копию'],
      ['Палитра: щелчок / правая', 'Заливка / Абрис (✕ — убрать)'],
      ['Ctrl+G / Ctrl+U', 'Группа / Разгруппировать'], ['Ctrl+L / Ctrl+K', 'Объединить / Разъединить'], ['Ctrl+Q', 'В кривые'],
      ['Ctrl+D / +', 'Дублировать / Копия на месте'], ['Shift+PgUp / PgDn', 'На передний / задний план'], ['Ctrl+PgUp / PgDn', 'На уровень вперёд / назад'],
      ['L R T B E C', 'Выровнять: лево, право, верх, низ, центр Г, центр В'], ['P', 'По центру страницы'],
      ['Стрелки', `Сдвиг на ${App.nudge} мм (Shift ×10, Ctrl ×0.1)`], ['Tab', 'Следующий объект'],
      ['F4 / Shift+F4 / Shift+F2', 'Все объекты / Страница / Выделенные'], ['Колесо', 'Масштаб (Shift — прокрутка), средняя кнопка — панорама'],
      ['Ctrl+Z / Ctrl+Y', 'Отменить / Повторить'], ['Ctrl+S / Ctrl+O', 'Сохранить / Открыть'], ['Ctrl+I / Ctrl+E', 'Импорт / Экспорт'], ['Ctrl+P', 'Печать / PDF'],
      ['Ctrl+щелчок', 'Выбрать объект внутри группы'], ['Двойной щелчок', 'Текст — правка, фигура — инструмент «Форма»'],
    ];
    UI.dialog('Горячие клавиши', h('table', { class: 'keys' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))));
  },
  about() {
    UI.dialog('О программе', h('div', {},
      h('h3', {}, 'Вектор — векторный редактор'),
      h('p', {}, 'Аналог CorelDRAW, работающий в браузере и как настольное приложение. Устроен по тем же принципам: инструменты слева, панель свойств сверху, докеры справа, палитра (левая кнопка — заливка, правая — абрис), маркеры масштаба и второй щелчок для поворота.'),
      h('p', { class: 'muted' }, 'Формат документа — .vkt (JSON). Экспорт: SVG, PNG, JPG, печать в PDF. Импорт: SVG, PNG, JPG, WEBP.'),
      h('p', { class: 'muted' }, 'Сторонние компоненты: libcdr (MPL 2.0) — чтение CDR; opentype.js, polygon-clipping, fflate (MIT); Clipper (Boost); SheetJS, pdf.js (Apache 2.0); mammoth (BSD); ImageTracer (Unlicense). Лицензии — в папке vendor.')));
  },
  toggleTheme() {
    const r = document.documentElement;
    r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('vektor.theme', r.dataset.theme); } catch (e) { }
    UI.refresh();
  },
};
