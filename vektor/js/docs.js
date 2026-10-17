// Несколько открытых документов — вкладки над холстом, как в CorelDRAW, Photoshop и Figma.
// Активный документ живёт в App.* (doc, история, выделение, вид); остальные хранятся в своих записях.
// Открытые вкладки запоминаются на компьютере (IndexedDB) и восстанавливаются при следующем запуске.
'use strict';

const Docs = {
  list: [], cur: 0, seq: 0,

  active() { return Docs.list[Docs.cur] || null; },
  state() {
    return { doc: App.doc, sel: App.sel, history: App.history, hpos: App.hpos, fileName: App.fileName, dirty: App.dirty,
      handle: IO.handle, path: IO.path, zoom: App.zoom, panX: App.panX, panY: App.panY, cdrVersion: IO.lastCDRVersion || 0 };
  },
  stash() { const e = Docs.active(); if (e) Object.assign(e, Docs.state()); },
  load(e) {
    if (Tools.text.editing) Tools.text.commit();
    App.doc = e.doc; App.sel = e.sel || [];
    if (e.history) { App.history = e.history; App.hpos = e.hpos; } else App.resetHistory();
    App.fileName = e.fileName; App.dirty = !!e.dirty; IO.handle = e.handle || null; IO.path = e.path || null;
    IO.lastCDRVersion = e.cdrVersion || 0;
    App.rotateMode = false; App.rotCenter = null;
    if (e.zoom) { App.zoom = e.zoom; App.panX = e.panX; App.panY = e.panY; UI.refresh(); UI.updateZoomBox(); }
    else { App.zoomFit(); UI.refresh(); }
  },
  blank() {
    return !App.dirty && !App.fileName && !IO.path && App.history.length <= 1 && App.countObjects() === 0;
  },
  // перед открытием файла: если такой уже открыт — переключиться; если текущая вкладка пустая — открыть в ней
  begin(src) {
    if (src) {
      const k = Docs.list.findIndex(e => e.src === src);
      if (k >= 0) { Docs.switchTo(k); UI.toast('Этот файл уже открыт'); return { already: true }; }
    }
    if (Docs.blank()) { Docs.active().src = src || null; return { reused: true }; }
    Docs.stash();
    const prev = Docs.cur;
    Docs.list.push({ id: ++Docs.seq, src: src || null });
    Docs.cur = Docs.list.length - 1;
    App.doc = Model.newDoc(); App.sel = []; App.fileName = null; App.dirty = false; IO.handle = null; IO.path = null;
    App.resetHistory();
    Docs.renderBar();
    return { prev };
  },
  // открытие не удалось — убираем созданную вкладку
  cancel(tok) {
    if (!tok || tok.already || tok.reused || tok.prev === undefined) { if (tok && tok.reused && Docs.active()) Docs.active().src = null; return; }
    Docs.list.splice(Docs.cur, 1);
    Docs.cur = Math.min(tok.prev, Docs.list.length - 1);
    Docs.load(Docs.active());
    Docs.renderBar();
  },
  newDoc(doc) {
    Docs.stash();
    Docs.list.push({ id: ++Docs.seq, src: null });
    Docs.cur = Docs.list.length - 1;
    App.doc = doc || Model.newDoc(); App.sel = []; App.fileName = null; App.dirty = false; IO.handle = null; IO.path = null;
    Model.syncSeq(App.doc); App.resetHistory();
    App.zoomPage(); UI.refresh(); Docs.persist();
  },
  switchTo(i) {
    if (i === Docs.cur || !Docs.list[i]) return;
    Docs.stash();
    Docs.cur = i;
    Docs.load(Docs.list[i]);
    Docs.persist();
  },
  next(d) { if (Docs.list.length > 1) Docs.switchTo((Docs.cur + d + Docs.list.length) % Docs.list.length); },
  close(i = Docs.cur) {
    const e = Docs.list[i]; if (!e) return;
    const dirty = i === Docs.cur ? App.dirty : e.dirty;
    const doClose = () => {
      if (i === Docs.cur) Docs.stash();
      Docs.list.splice(i, 1);
      Docs.drop(e.id);
      if (!Docs.list.length) { Docs.list.push({ id: ++Docs.seq, src: null }); Docs.cur = 0; App.doc = Model.newDoc(); App.sel = []; App.fileName = null; App.dirty = false; IO.handle = null; IO.path = null; App.resetHistory(); App.zoomPage(); UI.refresh(); }
      else if (i === Docs.cur) { Docs.cur = Math.min(i, Docs.list.length - 1); Docs.load(Docs.active()); }
      else if (i < Docs.cur) Docs.cur--;
      Docs.renderBar(); Docs.persist();
    };
    if (!dirty) return doClose();
    const name = Docs.title(i);
    UI.dialog('Закрыть документ', h('p', {}, `Сохранить изменения в «${name}»?`), [
      { label: 'Отмена' },
      { label: 'Не сохранять', action: doClose },
      { label: 'Сохранить', primary: true, action: () => { setTimeout(async () => { Docs.switchTo(i); await IO.save(); if (!App.dirty) Docs.close(Docs.cur); }, 0); } },
    ]);
  },
  title(i) {
    const e = Docs.list[i]; if (!e) return '';
    const live = i === Docs.cur;
    const fn = live ? App.fileName : e.fileName, d = live ? App.doc : e.doc;
    return fn || (e.src ? e.src.split(/[\\/]/).pop() : '') || (d && d.name) || 'Без имени';
  },

  // ---------- полоса вкладок ----------
  renderBar() {
    const bar = document.getElementById('doctabs'); if (!bar) return;
    const key = Docs.list.map((e, i) => Docs.title(i) + (i === Docs.cur ? (App.dirty ? '*' : '') + '#' : (e.dirty ? '*' : ''))).join('|');
    if (bar._key === key) return;
    bar._key = key;
    bar.innerHTML = '';
    Docs.list.forEach((e, i) => {
      const dirty = i === Docs.cur ? App.dirty : e.dirty;
      const t = h('div', { class: 'doctab' + (i === Docs.cur ? ' on' : ''), title: (e.src || Docs.title(i)) + (dirty ? ' — есть несохранённые изменения' : ''),
        onclick: () => Docs.switchTo(i), onauxclick: ev => { if (ev.button === 1) { ev.preventDefault(); Docs.close(i); } } },
        h('span', { class: 'dt-name' }, Docs.title(i)), dirty ? h('span', { class: 'dt-dirty' }, '●') : null,
        h('button', { class: 'dt-x', title: 'Закрыть (Ctrl+W)', onclick: ev => { ev.stopPropagation(); Docs.close(i); } }, '×'));
      bar.append(t);
    });
    bar.append(h('button', { class: 'dt-new', title: 'Новый документ (Ctrl+N)', onclick: () => Docs.newDoc() }, '+'));
  },

  // ---------- хранение открытых вкладок ----------
  _db: null,
  db() {
    if (Docs._db) return Docs._db;
    Docs._db = new Promise((res, rej) => {
      const r = indexedDB.open('vektor-session', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }).catch(() => null);
    return Docs._db;
  },
  async put(k, v) { const db = await Docs.db(); if (!db) return; await new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = tx.onerror = tx.onabort = () => res(); }); },
  async get(k) { const db = await Docs.db(); if (!db) return null; return new Promise(res => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); },
  async drop(id) { const db = await Docs.db(); if (!db) return; db.transaction('kv', 'readwrite').objectStore('kv').delete('doc:' + id); },
  _t: 0,
  persist() {
    clearTimeout(Docs._t);
    Docs._t = setTimeout(() => {
      const run = async () => {
        if (!Docs.active()) return;
        try {
          Docs.stash();
          // пишутся только документы, изменившиеся с прошлого раза (снимок истории — метка версии)
          for (const e of Docs.list) {
            if (!e.doc) continue;
            const mark = (e.history && e.history[e.hpos]) || e.doc;
            if (e._saved === mark) continue;
            await Docs.put('doc:' + e.id, e.doc);
            e._saved = mark;
          }
          await Docs.put('meta', { cur: Docs.cur, tabs: Docs.list.map((x, i) => ({ id: x.id, src: x.src || null, fileName: i === Docs.cur ? App.fileName : x.fileName, dirty: i === Docs.cur ? App.dirty : !!x.dirty })) });
          try { localStorage.removeItem('vektor.autosave'); } catch (er) { }
        } catch (er) { console.warn('Автосохранение', er); }
      };
      (window.requestIdleCallback || (f => setTimeout(f, 0)))(run, { timeout: 4000 });
    }, 1200);
  },
  async restore() {
    const meta = await Docs.get('meta');
    if (!meta || !meta.tabs || !meta.tabs.length) return;
    const list = [];
    for (const t of meta.tabs) {
      const doc = await Docs.get('doc:' + t.id);
      if (!doc) continue;
      list.push({ id: t.id, src: t.src, fileName: t.fileName, dirty: t.dirty, doc: App.migrate(doc) });
    }
    if (!list.length) return;
    // пока шло чтение, пользователь мог уже открыть файл — тогда его вкладка остаётся последней
    const keep = Docs.blank() ? null : (Docs.stash(), Docs.active());
    for (const e of list) { Model.syncSeq(e.doc); e.sel = []; }
    Docs.seq = Math.max(Docs.seq, ...list.map(e => e.id));
    Docs.list = keep ? list.concat(keep) : list;
    Docs.cur = keep ? Docs.list.length - 1 : G.clamp(meta.cur || 0, 0, list.length - 1);
    Docs.load(Docs.active());
    Docs.renderBar();
    if (list.length > 1 || App.countObjects() > 0) UI.toast(`Восстановлены открытые документы: ${list.length}`);
  },

  init() {
    Docs.list = [{ id: ++Docs.seq, src: null }];
    Docs.cur = 0;
    Docs.renderBar();
    window.addEventListener('keydown', e => {
      if (typeof WS !== 'undefined' && WS.active()) return;
      if (UI.modalOpen && UI.modalOpen()) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'Tab') { e.preventDefault(); Docs.next(e.shiftKey ? -1 : 1); }
      else if (ctrl && !e.shiftKey && (e.code === 'KeyW' || e.key === 'F4')) { e.preventDefault(); Docs.close(); }
    }, true);
    window.addEventListener('beforeunload', e => {
      Docs.stash();
      if (Docs.list.some(x => x.dirty && x.fileName)) { e.preventDefault(); e.returnValue = ''; }
    });
    Docs.restore().catch(er => console.warn(er));
  },
};
