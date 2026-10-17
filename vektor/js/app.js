// Состояние приложения, история правок, вид (масштаб/панорама), привязки, события мыши и клавиатуры.
'use strict';

// Снимки истории. Каждый объект верхнего уровня сериализуется заново только если изменился
// (сверка по быстрому отпечатку), большие строки (картинки) хранятся один раз — в снимке короткая ссылка.
const Snap = {
  ids: new Map(), strs: [], cache: new WeakMap(),
  _f: new Float64Array(1), _u: null,
  // отпечаток содержимого: числа побитно, короткие строки целиком, длинные — длина и выборка символов
  hash(o) {
    const f = Snap._f, u = Snap._u || (Snap._u = new Uint32Array(f.buffer));
    let h1 = 0x9e3779b9 | 0, h2 = 0x85ebca6b | 0;
    const walk = v => {
      switch (typeof v) {
        case 'number':
          if ((v | 0) === v) { h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 + v, 0x5bd1e995); }
          else { f[0] = v; h1 = Math.imul(h1 ^ u[0], 0x01000193); h2 = Math.imul(h2 + u[1], 0x5bd1e995) ^ (h2 >>> 15); }
          return;
        case 'string': {
          const n = v.length; h1 = Math.imul(h1 ^ n, 0x01000193);
          const st = n <= 256 ? 1 : Math.floor(n / 97);
          for (let i = 0; i < n; i += st) h2 = Math.imul(h2 + v.charCodeAt(i), 0x5bd1e995) ^ (h2 >>> 15);
          if (n) h2 = Math.imul(h2 + v.charCodeAt(n - 1), 0x5bd1e995);
          return;
        }
        case 'boolean': h1 = Math.imul(h1 ^ (v ? 3 : 5), 0x01000193); return;
        case 'object':
          if (v === null) { h1 = Math.imul(h1 ^ 7, 0x01000193); return; }
          if (Array.isArray(v)) { h1 = Math.imul(h1 ^ (v.length + 11), 0x01000193); for (let i = 0; i < v.length; i++) walk(v[i]); return; }
          {
            const ks = Object.keys(v);
            h1 = Math.imul(h1 ^ (ks.length + 13), 0x01000193);
            for (let i = 0; i < ks.length; i++) { const k = ks[i]; h2 = Math.imul(h2 + k.charCodeAt(0) + (k.length << 8), 0x5bd1e995); walk(v[k]); }
          }
      }
    };
    walk(o);
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
  },
  ref(v) { let i = Snap.ids.get(v); if (i === undefined) { i = Snap.strs.length; Snap.strs.push(v); Snap.ids.set(v, i); } return '\u0001' + i; },
  raw(x) {
    const undo = [];
    const walk = o => { for (const k in o) { const v = o[k]; if (typeof v === 'string') { if (v.length > 4096) { undo.push(o, k, v); o[k] = Snap.ref(v); } } else if (v && typeof v === 'object') walk(v); } };
    if (x && typeof x === 'object') walk(x);
    try { return JSON.stringify(x); } finally { for (let i = 0; i < undo.length; i += 3) undo[i][undo[i + 1]] = undo[i + 2]; }
  },
  obj(o, h) {
    h = h || Snap.hash(o);
    const c = Snap.cache.get(o);
    if (c && c.h === h) return c.json;
    const json = Snap.raw(o);
    Snap.cache.set(o, { h, json });
    return json;
  },
  // снимок документа: дерево строк JSON, неизменённые объекты делят строки с прошлыми снимками
  _shell(o, key) { const c = Object.assign({}, o); delete c[key]; return Snap.raw(c); },
  take(doc) {
    if (!doc || !doc.pages) return { raw: Snap.raw(doc) };
    return { d: Snap._shell(doc, 'pages'), p: doc.pages.map(P => !P.layers ? { raw: Snap.raw(P) } :
      { d: Snap._shell(P, 'layers'), l: P.layers.map(L => !L.objects ? { raw: Snap.raw(L) } : { d: Snap._shell(L, 'objects'), o: L.objects.map(o => Snap.obj(o)) }) }) };
  },
  // объекты текущего документа по их JSON — при отмене неизменённые объекты переиспользуются, а не разбираются заново
  _live(doc) {
    const m = new Map();
    for (const P of (doc && doc.pages) || []) for (const L of P.layers || []) for (const o of L.objects || []) { const c = Snap.cache.get(o); if (c) m.set(c.json, o); }
    return m;
  },
  restore(sn, cur) {
    const P = s => Snap.parse(s), live = Snap._live(cur);
    const O = s => {
      const o = live.get(s);
      if (o) { live.delete(s); const c = Snap.cache.get(o); if (c && c.json === s && Snap.hash(o) === c.h) return o; }
      const n = P(s);
      if (n && typeof n === 'object') Snap.cache.set(n, { h: Snap.hash(n), json: s });
      return n;
    };
    if (sn.raw !== undefined) return P(sn.raw);
    const doc = P(sn.d);
    doc.pages = sn.p.map(p => {
      if (p.raw !== undefined) return P(p.raw);
      const pg = P(p.d);
      pg.layers = p.l.map(l => { if (l.raw !== undefined) return P(l.raw); const L = P(l.d); L.objects = l.o.map(O); return L; });
      return pg;
    });
    return doc;
  },
  // одна строка JSON (для сохранения)
  str(doc) { return JSON.stringify(Snap.restore(Snap.take(doc))); },
  parse(s) {
    const d = JSON.parse(s);
    const walk = o => { for (const k in o) { const v = o[k]; if (typeof v === 'string') { if (v.charCodeAt(0) === 1) o[k] = Snap.strs[+v.slice(1)]; } else if (v && typeof v === 'object') walk(v); } };
    if (d && typeof d === 'object') walk(d);
    return d;
  },
};

const App = {
  doc: null,
  sel: [],             // id выбранных объектов верхнего уровня (порядок выбора важен для выравнивания)
  defaults: Model.defaults(),
  zoom: 2.5,           // пикселей на миллиметр
  panX: 0, panY: 0,
  tool: 'pick', prevTool: 'pick',
  rotateMode: false,   // второй щелчок по выделению — маркеры поворота и наклона (как в CorelDRAW)
  rotCenter: null,
  view: { grid: false, snapGrid: false, snapGuides: true, snapObjects: true, snapPage: true, rulers: true, wire: false, wheel: 'zoom' },
  nudge: 1, superNudge: 10, microNudge: 0.1, dupOffset: 5,
  history: [], hpos: -1,
  fileName: null, dirty: false,
  clipboard: null,
  snapLines: [],

  init() {
    Fonts.load();
    let restored = false;
    try {
      const raw = localStorage.getItem('vektor.autosave');
      if (raw) { App.doc = App.migrate(JSON.parse(raw)); restored = true; }
      const v = JSON.parse(localStorage.getItem('vektor.view') || 'null');
      if (v) Object.assign(App.view, v);
    } catch (e) { App.doc = null; }
    if (!App.doc) App.doc = Model.newDoc();
    Model.syncSeq(App.doc);
    App.resetHistory();
    UI.init();
    Events.init();
    requestAnimationFrame(() => { App.zoomPage(); UI.refresh(); });
    if (restored && App.countObjects() > 0) UI.toast('Восстановлен последний документ (автосохранение)');
  },
  migrate(doc) {
    const d = Object.assign(Model.newDoc(), Model.upgrade(doc));
    if (!d.guides) d.guides = { h: [], v: [] };
    if (!d.grid) d.grid = { size: 5 };
    if (!d.pages || !d.pages.length) d.pages = Model.newDoc().pages;
    for (const P of d.pages) {
      if (!P.layers || !P.layers.length) P.layers = Model.newPage().layers;
      if (!P.layers.find(l => l.id === P.activeLayer)) P.activeLayer = P.layers[0].id;
    }
    d.pageIndex = G.clamp(d.pageIndex || 0, 0, d.pages.length - 1);
    return d;
  },
  // текущая страница
  pg() { return App.doc.pages[App.doc.pageIndex] || App.doc.pages[0]; },
  goPage(i) {
    if (Tools.text.editing) Tools.text.commit();
    App.doc.pageIndex = G.clamp(i, 0, App.doc.pages.length - 1);
    App.sel = []; App.rotateMode = false;
    UI.refresh();
  },
  countObjects() { return App.doc.pages.reduce((n, P) => n + P.layers.reduce((s, l) => s + l.objects.length, 0), 0); },
  activeLayer() {
    let L = App.pg().layers.find(l => l.id === App.pg().activeLayer);
    if (!L || L.locked) L = App.pg().layers.find(l => !l.locked && l.visible) || App.pg().layers[0];
    return L;
  },

  // ---- история ----
  resetHistory() { App.history = [Snap.take(App.doc)]; App.hpos = 0; },
  commit(label) {
    App.history.length = App.hpos + 1;
    App.history.push(Snap.take(App.doc));
    if (App.history.length > 150) App.history.shift();
    App.hpos = App.history.length - 1;
    App.dirty = true;
    App.autosave();
    UI.refresh();
  },
  undo() {
    if (App.hpos <= 0) return UI.toast('Нечего отменять');
    App.hpos--; App.restore();
  },
  redo() {
    if (App.hpos >= App.history.length - 1) return UI.toast('Нечего возвращать');
    App.hpos++; App.restore();
  },
  restore() {
    App.doc = Snap.restore(App.history[App.hpos], App.doc);
    App.sel = App.sel.filter(id => Model.find(id));
    Text.cache.clear();
    App.autosave(); UI.refresh();
  },
  _saveTimer: 0,
  // автосохранение открытых документов — в IndexedDB, в фоне (без JSON целого документа)
  autosave() { if (typeof Docs !== 'undefined') Docs.persist(); },
  saveView() { try { localStorage.setItem('vektor.view', JSON.stringify(App.view)); } catch (e) { } },

  // ---- выделение ----
  setSel(ids) {
    App.sel = ids.filter(id => Model.find(id));
    App.rotateMode = false; App.rotCenter = null;
    UI.refresh({ doc: false });
  },
  selObjs() { return App.sel.map(id => Model.get(id)).filter(Boolean); },

  // ---- вид ----
  stageRect() { return UI.$('#stage').getBoundingClientRect(); },
  toDoc(cx, cy) {
    const r = App.stageRect();
    return { x: (cx - r.left - App.panX) / App.zoom, y: (cy - r.top - App.panY) / App.zoom };
  },
  toScreen(x, y) { return { x: x * App.zoom + App.panX, y: y * App.zoom + App.panY }; },
  setZoom(z, cx, cy) {
    z = G.clamp(z, 0.02, 400);
    const r = App.stageRect();
    if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const p = App.toDoc(cx, cy);
    App.zoom = z;
    App.panX = cx - r.left - p.x * z; App.panY = cy - r.top - p.y * z;
    UI.refresh({ panels: false, doc: false });
    UI.updateZoomBox();
  },
  zoomBox(b, pad = 30) {
    if (!b) return;
    const r = App.stageRect();
    const w = Math.max(b.x2 - b.x1, 1), h = Math.max(b.y2 - b.y1, 1);
    App.zoom = G.clamp(Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h), 0.02, 400);
    App.panX = r.width / 2 - (b.x1 + w / 2) * App.zoom;
    App.panY = r.height / 2 - (b.y1 + h / 2) * App.zoom;
    UI.refresh({ panels: false, doc: false }); UI.updateZoomBox();
  },
  zoomPage() { App.zoomBox({ x1: 0, y1: 0, x2: App.pg().w, y2: App.pg().h }); },
  zoomAll() {
    let b = G.emptyBox();
    Model.topLevel().forEach(({ o }) => { if (o.visible) b = G.unionBox(b, Model.worldBox(o)); });
    G.boxValid(b) ? App.zoomBox(b) : App.zoomPage();
  },
  zoomSel() { const b = Model.selBox(); b ? App.zoomBox(b) : App.zoomPage(); },
  zoom100() {
    // 100% — реальный размер на экране (96 точек на дюйм)
    App.setZoom(96 / 25.4);
  },

  // ---- поиск объекта под курсором ----
  hitTest(cx, cy, deep = false) {
    const els = document.elementsFromPoint(cx, cy);
    for (const el of els) {
      if (!el.closest || !el.closest('#docG')) continue;
      let node = el.closest('[data-id]');
      if (!node) continue;
      if (!deep) {
        // поднимаемся до объекта верхнего уровня (дочерний элемент слоя)
        while (node.parentElement && !node.parentElement.hasAttribute('data-layer')) {
          const up = node.parentElement.closest('[data-id]');
          if (!up) break;
          node = up;
        }
      }
      const f = Model.find(node.getAttribute('data-id'));
      if (!f) continue;
      if (f.layer.locked || f.obj.locked) continue;
      return f.obj.id;
    }
    return null;
  },
  topIdOf(id) {
    const f = Model.find(id);
    if (!f) return null;
    let cur = f;
    while (cur.parent) cur = Model.find(cur.parent.id);
    return cur.obj.id;
  },

  // ---- привязки ----
  snapTol() { return 7 / App.zoom; },
  snapTargets(excludeIds = []) {
    const xs = [], ys = [], pts = [];
    const d = App.doc;
    if (App.view.snapGuides) { d.guides.v.forEach(x => xs.push(x)); d.guides.h.forEach(y => ys.push(y)); }
    if (App.view.snapPage) {
      xs.push(0, App.pg().w / 2, App.pg().w); ys.push(0, App.pg().h / 2, App.pg().h);
    }
    if (App.view.snapObjects) {
      const ex = new Set(excludeIds);
      for (const { o, L } of Model.topLevel()) {
        if (ex.has(o.id) || !o.visible || !L.visible) continue;
        const b = Model.worldBox(o);
        if (!G.boxValid(b)) continue;
        xs.push(b.x1, (b.x1 + b.x2) / 2, b.x2); ys.push(b.y1, (b.y1 + b.y2) / 2, b.y2);
        pts.push({ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }, { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
        if (o.type === 'path') for (const sp of Model.worldSubs(o)) for (const n of sp.nodes) pts.push({ x: n.x, y: n.y });
      }
    }
    return { xs, ys, pts };
  },
  // привязка одной точки (инструменты рисования, узлы)
  snapPoint(p, exclude = []) {
    App.snapLines = [];
    const tol = App.snapTol();
    const T = App.snapTargets(exclude);
    let best = null;
    for (const q of T.pts) { const d = G.dist(p, q); if (d < tol && (!best || d < best.d)) best = { d, q }; }
    if (best) { App.snapLines.push({ x: best.q.x }, { y: best.q.y }); return { x: best.q.x, y: best.q.y }; }
    let x = p.x, y = p.y, dx = tol, dy = tol;
    for (const v of T.xs) if (Math.abs(v - p.x) < dx) { dx = Math.abs(v - p.x); x = v; }
    for (const v of T.ys) if (Math.abs(v - p.y) < dy) { dy = Math.abs(v - p.y); y = v; }
    if (x !== p.x) App.snapLines.push({ x }); if (y !== p.y) App.snapLines.push({ y });
    if (App.view.snapGrid) {
      const g = App.doc.grid.size;
      if (x === p.x) x = Math.round(p.x / g) * g;
      if (y === p.y) y = Math.round(p.y / g) * g;
    }
    return { x, y };
  },
  // привязка смещаемого габарита: возвращает поправку {dx, dy}
  snapBox(b, exclude) {
    App.snapLines = [];
    const tol = App.snapTol();
    const T = App.snapTargets(exclude);
    const cand = (vals, targets) => {
      let best = null;
      for (const v of vals) for (const t of targets) {
        const d = t - v;
        if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
      return best;
    };
    const bx = cand([b.x1, (b.x1 + b.x2) / 2, b.x2], T.xs), by = cand([b.y1, (b.y1 + b.y2) / 2, b.y2], T.ys);
    let dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    if (bx) App.snapLines.push({ x: bx.t }); if (by) App.snapLines.push({ y: by.t });
    if (App.view.snapGrid) {
      const g = App.doc.grid.size;
      if (!bx) dx = Math.round(b.x1 / g) * g - b.x1;
      if (!by) dy = Math.round(b.y1 / g) * g - b.y1;
    }
    return { dx, dy };
  },

  setTool(t) {
    if (Tools[App.tool] && Tools[App.tool].deactivate) Tools[App.tool].deactivate();
    if (t !== App.tool) App.prevTool = App.tool;
    App.tool = t;
    if (Tools[t] && Tools[t].activate) Tools[t].activate();
    UI.refresh();
  },
};

// ---------- События ----------
const Events = {
  drag: null,
  lastPos: { x: 0, y: 0 },
  moves: [false, false], // были ли перемещения в двух последних нажатиях
  init() {
    const st = UI.$('#stage');
    st.addEventListener('pointerdown', Events.down);
    window.addEventListener('pointermove', Events.move);
    window.addEventListener('pointerup', Events.up);
    st.addEventListener('dblclick', e => {
      // перетаскивание и следом быстрый щелчок браузер тоже считает двойным щелчком — такие пропускаем
      if (Events.moves.some(Boolean)) return;
      const t = Tools[App.tool]; if (t.dbl) t.dbl(e, App.toDoc(e.clientX, e.clientY));
    });
    st.addEventListener('contextmenu', e => {
      e.preventDefault();
      const t = Tools[App.tool];
      if (t.context) t.context(e, App.toDoc(e.clientX, e.clientY));
    });
    st.addEventListener('wheel', Events.wheel, { passive: false });
    window.addEventListener('keydown', Events.key);
    window.addEventListener('resize', () => UI.refresh({ panels: false, doc: false }));
    document.addEventListener('copy', e => { if (Events.typing() || (typeof WS !== 'undefined' && WS.active())) return; if (Actions.copy()) { Actions.toSystemClipboard(e); e.preventDefault(); } });
    document.addEventListener('cut', e => { if (Events.typing() || (typeof WS !== 'undefined' && WS.active())) return; if (Actions.copy()) { Actions.toSystemClipboard(e); e.preventDefault(); Actions.del(); } });
    document.addEventListener('paste', e => { if (Events.typing() || (typeof WS !== 'undefined' && WS.active())) return; e.preventDefault(); Actions.pasteEvent(e); });
    window.addEventListener('beforeunload', e => { if (App.dirty && App.fileName) { e.preventDefault(); e.returnValue = ''; } });
    // перетаскивание файлов на холст
    const wrap = UI.$('#canvasWrap');
    wrap.addEventListener('dragover', e => { e.preventDefault(); });
    wrap.addEventListener('drop', e => {
      e.preventDefault();
      const p = App.toDoc(e.clientX, e.clientY);
      for (const f of e.dataTransfer.files) IO.importFile(f, p);
    });
  },
  typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  },
  down(e) {
    UI.closeMenus();
    // завершаем правку текста до действия инструмента — иначе потеря фокуса закроет уже новый текст
    if (Tools.text.editing) { Tools.text.commit(); UI.$('#textEditor').blur(); }
    if (document.activeElement && Events.typing()) document.activeElement.blur();
    // без действия по умолчанию: фокус не уходит со вставленного поля текста, нет выделения страницы
    e.preventDefault();
    const p = App.toDoc(e.clientX, e.clientY);
    if (e.button === 1) {
      e.preventDefault();
      Events.drag = { pan: true, sx: e.clientX, sy: e.clientY, px: App.panX, py: App.panY };
      UI.$('#stage').setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2 && App.tool !== 'zoom') return;
    UI.$('#stage').setPointerCapture(e.pointerId);
    Events.drag = { tool: App.tool, sx: e.clientX, sy: e.clientY };
    const t = Tools[App.tool];
    if (t.down) t.down(e, p);
  },
  move(e) {
    const p = App.toDoc(e.clientX, e.clientY);
    Events.lastPos = { x: e.clientX, y: e.clientY };
    UI.setCursorPos(p);
    const d = Events.drag;
    if (d && d.pan) {
      App.panX = d.px + e.clientX - d.sx; App.panY = d.py + e.clientY - d.sy;
      UI.refresh({ panels: false, doc: false });
      return;
    }
    const t = Tools[App.tool];
    if (t.move) t.move(e, p, !!d);
    else if (t.hover && !d) t.hover(e, p);
  },
  up(e) {
    const d = Events.drag;
    Events.drag = null;
    if (!d) return;
    Events.moves = [Events.moves[1], Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3];
    if (d.pan) { UI.refresh({ panels: false, doc: false }); return; }
    const t = Tools[App.tool];
    if (t.up) t.up(e, App.toDoc(e.clientX, e.clientY));
    if (App.snapLines.length) { App.snapLines = []; UI.renderOverlay(); }
  },
  wheel(e) {
    e.preventDefault();
    const zoomIt = App.view.wheel === 'zoom' ? !e.shiftKey : e.ctrlKey;
    if (zoomIt || e.ctrlKey) {
      const k = Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 30 ? 0.01 : 0.0015));
      App.setZoom(App.zoom * k, e.clientX, e.clientY);
    } else {
      if (e.shiftKey && !e.deltaX) App.panX -= e.deltaY; else { App.panX -= e.deltaX; App.panY -= e.deltaY; }
      UI.refresh({ panels: false, doc: false });
    }
  },
  key(e) {
    if (typeof WS !== 'undefined' && WS.active()) return;
    if (UI.modalOpen()) { if (e.key === 'Escape') UI.closeDialog(); return; }
    if (Events.typing()) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
    const t = Tools[App.tool];
    if (t.key && t.key(e) === true) { e.preventDefault(); return; }
    const combo = (ctrl ? 'Ctrl+' : '') + (sh ? 'Shift+' : '') + (alt ? 'Alt+' : '') + (k.length === 1 ? k.toUpperCase() : k);
    // буквенные клавиши — по физической клавише, чтобы работало и в русской раскладке
    const code = e.code && e.code.startsWith('Key') ? e.code.slice(3) : (e.code && e.code.startsWith('Digit') ? e.code.slice(5) : null);
    const combo2 = code ? (ctrl ? 'Ctrl+' : '') + (sh ? 'Shift+' : '') + (alt ? 'Alt+' : '') + code : combo;
    const act = Shortcuts.map[combo2] || Shortcuts.map[combo];
    if (act) {
      if (['Ctrl+C', 'Ctrl+X', 'Ctrl+V'].includes(combo2)) return; // обрабатываются событиями copy/cut/paste
      e.preventDefault(); act(); return;
    }
    if (k === ' ') {
      e.preventDefault();
      // пробел — переключение между текущим инструментом и указателем (как в CorelDRAW)
      if (App.tool === 'pick') App.setTool(App.prevTool !== 'pick' ? App.prevTool : 'pick');
      else App.setTool('pick');
      return;
    }
    if (k.startsWith('Arrow') && App.sel.length) {
      e.preventDefault();
      const step = sh ? App.superNudge : ctrl ? App.microNudge : App.nudge;
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      App.selObjs().forEach(o => Model.applyT(o, Mx.translate(dx, dy)));
      App.commit('Сдвиг');
    }
  },
};

const Shortcuts = {
  map: {},
  init() {
    const A = Actions, S = (k, f) => { Shortcuts.map[k] = f; };
    S('Ctrl+Z', A.undo); S('Ctrl+Y', A.redo); S('Ctrl+Shift+Z', A.redo);
    S('Ctrl+D', A.duplicate); S('Delete', A.del); S('Backspace', A.del);
    S('Ctrl+A', A.selectAll); S('Escape', () => { if (App.sel.length) App.setSel([]); else App.setTool('pick'); });
    S('Ctrl+G', A.group); S('Ctrl+U', A.ungroup); S('Ctrl+L', A.combine); S('Ctrl+K', A.breakApart); S('Ctrl+Q', A.toCurves);
    S('Shift+PageUp', () => A.order('front')); S('Shift+PageDown', () => A.order('back'));
    S('Ctrl+PageUp', () => A.order('up')); S('Ctrl+PageDown', () => A.order('down'));
    S('L', () => A.align('left')); S('R', () => A.align('right')); S('T', () => A.align('top')); S('B', () => A.align('bottom'));
    S('E', () => A.align('hcenter')); S('C', () => A.align('vcenter')); S('P', A.centerPage);
    S('F4', App.zoomAll); S('Shift+F4', App.zoomPage); S('Shift+F2', App.zoomSel); S('F3', () => App.setZoom(App.zoom / 2)); S('F2', () => App.setTool('zoom'));
    S('Ctrl+S', IO.save); S('Ctrl+Shift+S', IO.saveAs); S('Ctrl+O', IO.open); S('Ctrl+I', IO.importDialog); S('Ctrl+E', IO.exportDialog); S('Ctrl+P', IO.print);
    S('Ctrl+N', A.newDoc); S('Ctrl+Alt+N', A.newDoc);
    S('PageUp', () => App.goPage(App.doc.pageIndex - 1)); S('PageDown', () => App.goPage(App.doc.pageIndex + 1));
    S('Tab', () => A.cycle(1)); S('Shift+Tab', () => A.cycle(-1));
    S('+', A.duplicateInPlace); S('Shift++', A.duplicateInPlace);
    S('F5', () => App.setTool('freehand')); S('F6', () => App.setTool('rect')); S('F7', () => App.setTool('ellipse'));
    S('F8', () => App.setTool('text')); S('F10', () => App.setTool('shape')); S('Y', () => App.setTool('polygon'));
    S('S', () => App.setTool('star')); S('A', () => App.setTool('spiral')); S('Z', () => App.setTool('zoom')); S('H', () => App.setTool('pan'));
    S('I', () => App.setTool('eyedropper')); S('G', () => App.setTool('ifill')); S('V', () => App.setTool('pick')); S('N', () => App.setTool('bezier'));
    S('F11', () => UI.docker('props')); S('F12', () => UI.docker('props'));
    S('Ctrl+F7', () => UI.docker('transform')); S('Ctrl+Shift+A', () => UI.docker('align'));
    S('Ctrl+Shift+O', () => UI.docker('objects'));
    S('F1', UI.showHelp);
  },
};
