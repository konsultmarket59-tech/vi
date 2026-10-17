// Шрифты и вёрстка текста: фигурный и абзацный текст, перенос строк, выключка,
// контуры букв (для перевода в кривые и эффектов) через opentype.js.
'use strict';

const PT_MM = 25.4 / 72; // 1 пункт в мм

// ---------- Шрифты ----------
// Источники: встроенные (base64 в fonts/fonts.js), системные (Local Font Access API),
// пользовательские (загруженные файлы .ttf/.otf, хранятся в IndexedDB).
const Fonts = {
  system: ['Arial', 'Times New Roman', 'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'Segoe UI', 'Calibri', 'Cambria'],
  faces: new Map(),      // семейство → [{ style, source, buffer?, blob?, otf? }]
  localLoaded: false,
  styleKey(bold, italic) { return (bold ? 'b' : '') + (italic ? 'i' : '') || 'r'; },
  parseStyle(s) {
    s = String(s || '').toLowerCase();
    const bold = /bold|black|heavy|semibold|demibold|extrabold|полужир|жирн/.test(s);
    const italic = /italic|oblique|курсив/.test(s);
    return Fonts.styleKey(bold, italic);
  },
  addFace(family, style, rec) {
    if (!Fonts.faces.has(family)) Fonts.faces.set(family, []);
    const list = Fonts.faces.get(family);
    if (!list.find(f => f.style === style)) list.push(Object.assign({ style }, rec));
  },
  embedded() { return (window.VK_FONTS || []).map(f => f.family); },
  all() {
    const set = new Set([...Fonts.embedded(), ...Fonts.faces.keys(), ...Fonts.system]);
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  },
  b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; },

  load() {
    for (const f of window.VK_FONTS || []) {
      try {
        const buf = Fonts.b64ToBuf(f.data);
        Fonts.addFace(f.family, 'r', { source: 'embedded', buffer: buf, data: f.data, format: f.format });
        Fonts.register(f.family, buf, 'r');
      } catch (e) { console.warn('шрифт', f.family, e); }
    }
    Fonts.loadUserFonts();
    // системные шрифты без запроса разрешения доступны, если оно уже дано (настольная версия — всегда)
    if (navigator.permissions && window.queryLocalFonts) {
      navigator.permissions.query({ name: 'local-fonts' }).then(p => { if (p.state === 'granted') Fonts.loadLocal(true); }).catch(() => { });
    }
  },
  register(family, buf, style) {
    try {
      const desc = { weight: style.includes('b') ? 'bold' : 'normal', style: style.includes('i') ? 'italic' : 'normal' };
      const ff = new FontFace(family, buf.slice(0), desc);
      document.fonts.add(ff);
      ff.load().then(() => Fonts.changed()).catch(() => { });
    } catch (e) { console.warn('FontFace', family, e); }
  },
  _chTimer: 0,
  changed() {
    clearTimeout(Fonts._chTimer);
    Fonts._chTimer = setTimeout(() => { Text.cache.clear(); if (typeof UI !== 'undefined' && App.doc) UI.refresh(); }, 60);
  },
  // системные шрифты (Chrome / Edge / настольная версия)
  async loadLocal(silent = false) {
    if (!window.queryLocalFonts) { if (!silent) UI.toast('Этот браузер не даёт доступ к шрифтам системы — используйте Chrome, Edge или настольную версию'); return false; }
    try {
      const list = await window.queryLocalFonts();
      for (const fd of list) Fonts.addFace(fd.family, Fonts.parseStyle(fd.style), { source: 'local', fd });
      Fonts.localLoaded = true;
      if (!silent) UI.toast(`Системных шрифтов: ${new Set(list.map(f => f.family)).size}`);
      Fonts.changed();
      return true;
    } catch (e) { if (!silent) UI.toast('Доступ к шрифтам системы не разрешён'); return false; }
  },
  // пользовательский файл шрифта
  async addFontFile(name, buf, persist = true) {
    let otf;
    try { otf = opentype.parse(buf); } catch (e) { UI.toast('Не удалось прочитать шрифт ' + name); return null; }
    const family = (otf.names.fontFamily && (otf.names.fontFamily.en || Object.values(otf.names.fontFamily)[0])) || name.replace(/\.\w+$/, '');
    const sub = (otf.names.fontSubfamily && (otf.names.fontSubfamily.en || Object.values(otf.names.fontSubfamily)[0])) || '';
    const style = Fonts.parseStyle(sub);
    const list = Fonts.faces.get(family) || [];
    const ex = list.find(f => f.style === style);
    if (ex) Object.assign(ex, { source: 'user', buffer: buf, otf });
    else Fonts.addFace(family, style, { source: 'user', buffer: buf, otf });
    Fonts.register(family, buf, style);
    if (persist) Fonts.idb('put', { key: family + '|' + style, family, style, buf });
    return family;
  },
  async loadUserFonts() {
    const all = await Fonts.idb('all');
    for (const r of all || []) {
      Fonts.addFace(r.family, r.style, { source: 'user', buffer: r.buf });
      Fonts.register(r.family, r.buf, r.style);
    }
  },
  idb(op, val) {
    return new Promise(res => {
      try {
        const rq = indexedDB.open('vektor-fonts', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('fonts', { keyPath: 'key' });
        rq.onerror = () => res(null);
        rq.onsuccess = () => {
          const tx = rq.result.transaction('fonts', op === 'all' ? 'readonly' : 'readwrite').objectStore('fonts');
          const r = op === 'all' ? tx.getAll() : tx.put(val);
          r.onsuccess = () => res(r.result); r.onerror = () => res(null);
        };
      } catch (e) { res(null); }
    });
  },
  // распарсенный шрифт (синхронно, если уже загружен)
  face(family, bold, italic) {
    const list = Fonts.faces.get(family);
    if (!list) return null;
    const want = Fonts.styleKey(bold, italic);
    return list.find(f => f.style === want) || list.find(f => f.style === 'r') || list[0];
  },
  otfSync(family, bold, italic) {
    const f = Fonts.face(family, bold, italic);
    if (!f) return null;
    if (f.otf) return f.otf;
    if (f.buffer) { try { f.otf = opentype.parse(f.buffer); return f.otf; } catch (e) { f.bad = true; return null; } }
    if (f.fd && !f.loading && !f.bad) {
      f.loading = true;
      f.fd.blob().then(b => b.arrayBuffer()).then(buf => { f.buffer = buf; f.otf = opentype.parse(buf); Fonts.changed(); })
        .catch(() => { f.bad = true; });
    }
    return null;
  },
  async otf(family, bold, italic) {
    let o = Fonts.otfSync(family, bold, italic);
    if (o) return o;
    if (!Fonts.faces.has(family) && !Fonts.localLoaded) await Fonts.loadLocal(true);
    const f = Fonts.face(family, bold, italic);
    if (!f) return null;
    if (f.fd && !f.buffer) {
      try { f.buffer = await (await f.fd.blob()).arrayBuffer(); } catch (e) { return null; }
    }
    return Fonts.otfSync(family, bold, italic);
  },
  // @font-face для шрифтов, использованных в документе: встроенные и пользовательские
  cssFor(doc) {
    const used = new Set();
    Model.walkDoc(doc, o => { if (o.type === 'text') used.add(o.font); });
    let css = '';
    for (const fam of used) {
      for (const f of Fonts.faces.get(fam) || []) {
        if (f.source === 'local') continue; // системные есть на машине
        let b64 = f.data;
        if (!b64 && f.buffer) {
          const u8 = new Uint8Array(f.buffer); let s = '';
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          b64 = btoa(s);
        }
        if (!b64) continue;
        const fmt = f.format || 'truetype';
        css += `@font-face{font-family:"${fam}";font-weight:${f.style.includes('b') ? 'bold' : 'normal'};font-style:${f.style.includes('i') ? 'italic' : 'normal'};src:url(data:font/${fmt === 'woff2' ? 'woff2' : 'ttf'};base64,${b64}) format("${fmt}");}`;
      }
    }
    return css;
  },
};

// ---------- Вёрстка ----------
const Text = {
  cache: new Map(),
  ctx: null,
  fs(o) { return o.size * PT_MM; },
  // ширина строки в мм (канвас мерит тем же шрифтом, каким браузер рисует)
  measure(o, str) {
    const key = [o.font, o.bold, o.italic, o.ls || 0, str].join('|');
    let w = Text.cache.get(key);
    if (w === undefined) {
      const c = Text.ctx || (Text.ctx = document.createElement('canvas').getContext('2d'));
      c.font = `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}100px "${o.font || 'Arial'}"`;
      w = c.measureText(str).width / 100; // в долях кегля
      w += (o.ls || 0) / 100 * [...str].length; // трекинг в % кегля на символ
      if (Text.cache.size > 20000) Text.cache.clear();
      Text.cache.set(key, w);
    }
    return w * Text.fs(o);
  },
  // строки с координатами: { lines: [{ text, x, y, w, words? }], box }
  layout(o) {
    const fs = Text.fs(o), lh = (o.lh || 1.2) * fs;
    const paras = String(o.text || '').split('\n');
    const lines = [];
    const frame = o.frame;
    if (!frame) {
      paras.forEach(t => lines.push({ text: t, w: Text.measure(o, t) }));
      for (const l of lines) l.x = o.align === 'center' ? -l.w / 2 : o.align === 'right' ? -l.w : 0;
    } else {
      const W = Math.max(1, frame.w);
      for (const p of paras) {
        const words = p.split(/(\s+)/).filter(s => s.length);
        let cur = '';
        const flush = (last) => { const t = cur.replace(/\s+$/, ''); lines.push({ text: t, w: Text.measure(o, t), last }); cur = ''; };
        if (!words.length) { lines.push({ text: '', w: 0, last: true }); continue; }
        for (const wd of words) {
          const cand = cur + wd;
          if (cur && !/^\s+$/.test(wd) && Text.measure(o, cand.replace(/\s+$/, '')) > W) {
            flush(false);
            // слишком длинное слово режем по буквам
            let rest = wd;
            while (Text.measure(o, rest) > W && rest.length > 1) {
              let n = rest.length - 1;
              while (n > 1 && Text.measure(o, rest.slice(0, n)) > W) n--;
              cur = rest.slice(0, n); flush(false); rest = rest.slice(n);
            }
            cur = rest;
          } else if (!(cur === '' && /^\s+$/.test(wd))) cur = cand;
        }
        flush(true);
      }
      for (const l of lines) {
        l.x = o.align === 'center' ? (W - l.w) / 2 : o.align === 'right' ? W - l.w : 0;
        if (o.align === 'justify' && !l.last && /\s/.test(l.text)) {
          // выключка по ширине: слова расставляются по всей строке
          const ws = l.text.split(/\s+/);
          const total = ws.reduce((s, x) => s + Text.measure(o, x), 0);
          const gap = (W - total) / (ws.length - 1);
          let x = 0;
          l.words = ws.map(t => { const r = { t, x }; x += Text.measure(o, t) + gap; return r; });
          l.w = W;
        }
      }
    }
    lines.forEach((l, i) => { l.y = fs * 0.85 + i * lh; });
    const box = G.emptyBox();
    for (const l of lines) { G.addPt(box, l.x, l.y - fs * 0.85); G.addPt(box, l.x + Math.max(l.w, fs * 0.05), l.y + fs * 0.25); }
    if (!lines.length) G.addPt(box, 0, 0);
    if (frame) { G.addPt(box, 0, 0); G.addPt(box, frame.w, Math.max(frame.h || 0, box.y2)); }
    return { lines, box, fs, lh };
  },
  markup(o, attrs) {
    const L = Text.layout(o);
    const fam = Render.esc(o.font || 'Arial');
    let s = `<text ${attrs} font-family="${fam}" font-size="${+L.fs.toFixed(4)}"` +
      (o.bold ? ' font-weight="bold"' : '') + (o.italic ? ' font-style="italic"' : '') +
      (o.ls ? ` letter-spacing="${+(o.ls / 100 * L.fs).toFixed(4)}"` : '') + ' xml:space="preserve">';
    for (const l of L.lines) {
      if (l.words) for (const w of l.words) s += `<tspan x="${+(l.x + w.x).toFixed(4)}" y="${+l.y.toFixed(4)}">${Render.esc(w.t)}</tspan>`;
      else s += `<tspan x="${+l.x.toFixed(4)}" y="${+l.y.toFixed(4)}">${Render.esc(l.text) || ' '}</tspan>`;
    }
    return s + '</text>';
  },
  // контуры букв в локальных координатах (null — шрифт ещё не загружен или недоступен)
  outlines(o) {
    const otf = Fonts.otfSync(o.font, o.bold, o.italic);
    if (!otf) return null;
    const L = Text.layout(o);
    const opt = { kerning: true, letterSpacing: (o.ls || 0) / 100 };
    let d = '';
    for (const l of L.lines) {
      const runs = l.words ? l.words.map(w => ({ t: w.t, x: l.x + w.x })) : [{ t: l.text, x: l.x }];
      for (const r of runs) if (r.t) d += otf.getPath(r.t, r.x, l.y, L.fs, opt).toPathData(4);
    }
    return Path.parse(d);
  },
  async ensureOutlines(o) {
    await Fonts.otf(o.font, o.bold, o.italic);
    return Text.outlines(o);
  },
};
