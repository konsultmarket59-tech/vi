// Файлы: сохранение и открытие .vkt; открытие и импорт CDR (любой версии), PDF/AI, SVG, растра;
// экспорт страниц в SVG, PNG, JPG, PDF и CDR нужной версии (через установленный CorelDRAW).
'use strict';

const CDR_VERSIONS = [
  [27, 'CorelDRAW 2025'], [26, 'CorelDRAW 2024'], [25, 'CorelDRAW 2023'], [24, 'CorelDRAW 2022'], [23, 'CorelDRAW 2021'], [22, 'CorelDRAW 2020'],
  [21, 'CorelDRAW 2019'], [20, 'CorelDRAW 2018'], [19, 'CorelDRAW 2017'], [18, 'CorelDRAW X8'], [17, 'CorelDRAW X7'],
  [16, 'CorelDRAW X6'], [15, 'CorelDRAW X5'], [14, 'CorelDRAW X4'], [13, 'CorelDRAW X3'], [12, 'CorelDRAW 12'], [11, 'CorelDRAW 11'],
];

const IO = {
  handle: null, // файл браузера (File System Access API) — Ctrl+S пишет в тот же файл
  path: null,   // путь файла в настольной версии

  baseName() { return (App.fileName || App.doc.name || 'Без имени').replace(/\.(vkt|cdr|svg|pdf|ai)$/i, ''); },
  json() { return JSON.stringify(App.doc); },
  ext: name => Host.extOf(name),
  download(blob, name) { return Host.saveFile(name, blob, blob.type); },

  // ---------- сохранение ----------
  async save() {
    if (Host.desktop && IO.path) return IO.writeTo(IO.path);
    if (IO.handle) {
      try { const w = await IO.handle.createWritable(); await w.write(IO.json()); await w.close(); return IO.saved(); }
      catch (e) { console.warn(e); return UI.toast('Не удалось сохранить: ' + (e.message || e), true); }
    }
    return IO.saveAs();
  },
  // запись документа в файл по расширению: .vkt — сам документ, .cdr — через CorelDRAW, .pdf — PDF для печати
  async writeTo(p) {
    const ext = IO.ext(p);
    UI.busy('Сохраняю…');
    try {
      if (ext === 'cdr') {
        const v = Math.floor((IO.lastCDRVersion || 0) / 100) || 17;
        await IO.exportCDR(Math.min(Math.max(v, 11), 27), { out: p, cmyk: true });
      } else if (ext === 'pdf') {
        const bytes = await PDFWriter.build(App.doc.pages, { cmyk: true, title: App.doc.name, imageJpeg: true });
        await vkHost.write(p, bytes);
      } else await vkHost.write(p, IO.json());
      IO.path = p; App.fileName = p.split(/[\\/]/).pop();
      FileOps.addRecent(p);
      IO.saved();
    } catch (e) { console.error(e); UI.toast('Не удалось сохранить: ' + (e.message || e), true); }
    finally { UI.busy(null); }
  },
  saved() { App.dirty = false; UI.refresh({ panels: false }); UI.toast('Сохранено: ' + App.fileName); },
  async saveAs() {
    const name = IO.baseName() + '.vkt';
    if (Host.desktop) {
      const filters = [{ name: 'Документ Вектор', extensions: ['vkt'] }, { name: 'CorelDRAW (через установленный Corel)', extensions: ['cdr'] }, { name: 'PDF для печати (CMYK)', extensions: ['pdf'] }];
      // файл из Corel по умолчанию сохраняется обратно в CDR, если Corel установлен
      const fromCdr = /\.cdr$/i.test(App.fileName || '') || (Docs.active() && /\.cdr$/i.test(Docs.active().src || ''));
      if (fromCdr && await IO.corelAvailable()) filters.unshift(filters.splice(1, 1)[0]);
      const p = await vkHost.saveDialog({ defaultPath: IO.baseName() + '.' + filters[0].extensions[0], filters });
      if (!p) return;
      return IO.writeTo(p);
    }
    if (window.showSaveFilePicker) {
      try {
        IO.handle = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Документ Вектор', accept: { 'application/json': ['.vkt'] } }] });
        App.fileName = IO.handle.name;
        return IO.save();
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    await Host.saveFile(name, IO.json(), 'application/json');
    App.fileName = name; App.dirty = false; UI.refresh({ panels: false });
  },

  // ---------- открытие ----------
  OPEN_ACCEPT: '.vkt,.json,.cdr,.cdt,.svg,.pdf,.ai,.fig,.pen,.vkm,.vkn,.psd',
  async open() {
    const [f] = await Host.pickFiles(IO.OPEN_ACCEPT, false, 'Открыть документ');
    if (f) IO.openEntry(f);
  },
  async openPath(p) {
    const name = p.split(/[\\/]/).pop();
    return IO.openEntry({ name, path: p, read: () => vkHost.read(p) });
  },
  async openEntry(f) {
    const ext = IO.ext(f.name);
    let tab = null;
    try {
      if (ext === 'fig' || ext === 'pen') { UI.busy(null); return FigmaWS.openBuffer(await f.read(), f.name); }
      if (ext === 'vkm') { UI.busy(null); return Motion.openBuffer(await f.read(), f.name); }
      if (ext === 'psd') { UI.busy(null); WS.show('photo'); return PhotoWS.openBuffer(await f.read(), f.name); }
      if (!['vkt', 'json', 'svg', 'cdr', 'cdt', 'pdf', 'ai'].includes(ext)) return UI.toast('Этот тип файла не открывается: ' + f.name);
      tab = Docs.begin(f.path || null);
      if (tab.already) return;
      UI.busy('Открываю ' + f.name + '…');
      const buf = await f.read();
      if (ext === 'vkt' || ext === 'json') { IO.loadText(new TextDecoder().decode(buf), f.name); if (f.path) IO.path = f.path; else if (f.handle) IO.handle = f.handle; }
      else if (ext === 'svg') IO.openSVGAsDoc(new TextDecoder().decode(buf), f.name);
      else if (ext === 'cdr' || ext === 'cdt') IO.docFromPages(await IO.readCDR(buf, f.path), f.name);
      else if (ext === 'pdf' || ext === 'ai') IO.docFromPages((await PDFImport.open(buf)).pages, f.name);
      else UI.toast('Этот тип файла не открывается: ' + f.name);
      if (tab && f.path && Docs.active()) Docs.active().src = f.path;
      if (f.path) FileOps.addRecent(f.path, f.name);
    } catch (e) { console.error(e); Docs.cancel(tab); UI.toast('Не удалось открыть: ' + (e.message || e)); }
    finally { UI.busy(null); }
  },
  loadText(text, name) {
    let d;
    try { d = JSON.parse(text); if (!d.layers && !d.pages) throw new Error('нет слоёв'); } catch (e) { throw new Error('это не документ Вектора'); }
    App.doc = App.migrate(d); Model.syncSeq(App.doc); App.sel = [];
    App.fileName = name; App.dirty = false; IO.handle = null; IO.path = null;
    App.resetHistory();
    Text.cache.clear(); App.autosave(); App.zoomPage(); UI.refresh();
    UI.toast('Открыт: ' + name);
  },
  openSVGAsDoc(text, name) {
    App.doc = Model.newDoc(); App.sel = [];
    App.resetHistory();
    const size = IO.importSVGText(text, null, true);
    if (size) { App.pg().w = G.round(size.w, 3); App.pg().h = G.round(size.h, 3); }
    App.doc.name = name.replace(/\.svg$/i, '');
    App.fileName = null; IO.handle = null; IO.path = null; App.sel = [];
    App.resetHistory(); App.dirty = false; App.autosave(); App.zoomPage(); UI.refresh();
  },
  // страницы из CDR/PDF → новый документ
  docFromPages(pages, name) {
    if (!pages || !pages.length) return UI.toast('В файле нет страниц');
    const d = Model.newDoc();
    d.pages = pages.map((pg, i) => { const P = Model.newPage(G.round(pg.w, 3), G.round(pg.h, 3), i + 1); P.layers[0].objects = pg.objects; if (pg.name) P.name = pg.name; return P; });
    d.name = name.replace(/\.\w+$/, '');
    App.doc = d; Model.syncSeq(d); App.sel = [];
    App.fileName = null; IO.handle = null; IO.path = null;
    Text.cache.clear(); App.resetHistory(); App.dirty = false; App.autosave(); UI.refresh();
    if (App.zoomFit()) UI.toast('Объекты лежат за пределами листа — показан весь рисунок (F4 — всё, Shift+F4 — лист)');
    const n = pages.reduce((s, p) => s + p.objects.length, 0);
    UI.toast(`Открыт ${name}: страниц ${pages.length}, объектов ${n}`);
  },
  // CDR. В настольной версии с установленным CorelDRAW файл по умолчанию открывается через сам Corel
  // (он публикует PDF — фото, PowerClip, эффекты и тексты переносятся точно). Без Corel — собственный разборщик.
  cdrMode() { try { return localStorage.getItem('vektor.cdrOpen') || 'auto'; } catch (e) { return 'auto'; } },
  setCdrMode(m) { try { localStorage.setItem('vektor.cdrOpen', m); } catch (e) { } UI.toast(m === 'corel' ? 'CDR всегда открываются через CorelDRAW (если он установлен)' : 'CDR открываются встроенным разборщиком; CorelDRAW — если файл прочитан не полностью'); },
  _corel: undefined,
  async corelAvailable() {
    if (!Host.desktop || !window.vkHost || !vkHost.corelProbe) return false;
    if (IO._corel === undefined) { const r = await vkHost.corelProbe().catch(() => ({ ok: false })); IO._corel = !!r.ok; }
    return IO._corel;
  },
  async readCDRviaCorel(path) {
    UI.busy('CorelDRAW открывает файл… (большие файлы — до пары минут)');
    const r = await vkHost.corelPDF(path);
    if (!r || !r.ok) throw new Error(r && r.error || 'CorelDRAW не открыл файл');
    UI.busy('Читаю страницы…');
    const pdf = await PDFImport.open(r.data);
    IO.lastCDRVersion = r.version ? r.version * 100 : 0;
    UI.toast('Файл открыт через CorelDRAW: страниц ' + pdf.pages.length);
    return pdf.pages;
  },
  async readCDR(buf, path) {
    // по умолчанию — встроенный разборщик (сохраняет группы, слои и имена страниц);
    // CorelDRAW подключается, если так выбрано или файл прочитан не полностью
    const viaCorel = Host.desktop && path && IO.cdrMode() === 'corel' && await IO.corelAvailable();
    if (viaCorel) {
      try { return await IO.readCDRviaCorel(path); } catch (e) { console.warn(e); UI.toast('CorelDRAW: ' + (e.message || e) + '. Открываю встроенным разборщиком'); }
    }
    let res = null, err = null;
    try { res = await CDR.parseAsync(buf); } catch (e) { err = e; }
    const empty = !res || !res.pages.some(p => p.objects.length);
    if (!viaCorel && Host.desktop && path && (empty || err || (res && res.missingImages)) && await IO.corelAvailable()) {
      try { return await IO.readCDRviaCorel(path); } catch (e) { console.warn(e); }
    }
    if ((empty || err) && Host.desktop && path && !viaCorel) {
      const r = await vkHost.corelNormalize(path);
      if (r && r.ok) { res = CDR.parse(r.data); UI.toast('Файл прочитан через установленный CorelDRAW'); }
      else if (!res) throw new Error((err && err.message) + (r && r.error ? '; CorelDRAW: ' + r.error : ''));
    }
    if (!res) throw err || new Error('Не удалось прочитать CDR');
    IO.lastCDRVersion = res.appVersion || res.version || 0;
    if (res.version) UI.toast('Файл ' + CDR.versionName(res.appVersion || res.version) + (res.appVersion && Math.floor(res.appVersion / 100) !== Math.floor(res.version / 100) ? ` (формат ${CDR.versionName(res.version).replace('CorelDRAW ', '')})` : ''));
    if (res.missingImages) UI.toast(`Не прочитано изображений: ${res.missingImages} — на их месте серые заглушки.` + (Host.desktop ? ' С установленным CorelDRAW файл откроется точно.' : ' Откройте файл в настольной версии с CorelDRAW или пересохраните его в Corel как PDF.'), true);
    return res.pages;
  },

  // ---------- импорт ----------
  IMPORT_ACCEPT: '.cdr,.cdt,.svg,.pdf,.ai,.png,.jpg,.jpeg,.webp,.gif,.bmp,.vkt,.ttf,.otf',
  async importDialog() {
    const files = await Host.pickFiles(IO.IMPORT_ACCEPT, true, 'Импорт');
    for (const f of files) await IO.importEntry(f);
  },
  importFile(file, at) { if (file) return IO.importEntry({ name: file.name || 'image.png', file, read: () => file.arrayBuffer(), type: file.type }, at); },
  async importEntry(f, at) {
    const ext = IO.ext(f.name);
    try {
      if (ext === 'vkt' || ext === 'json') return IO.openEntry(f);
      if (ext === 'ttf' || ext === 'otf') { const fam = await Fonts.addFontFile(f.name, await f.read()); if (fam) UI.toast('Шрифт добавлен: ' + fam); return; }
      if (ext === 'svg' || f.type === 'image/svg+xml') return IO.importSVGText(new TextDecoder().decode(await f.read()), at);
      if (ext === 'cdr' || ext === 'cdt') { UI.busy('Читаю ' + f.name + '…'); return IO.placePages(await IO.readCDR(await f.read(), f.path), f.name, at); }
      if (ext === 'pdf' || ext === 'ai') { UI.busy('Читаю ' + f.name + '…'); return IO.placePages((await PDFImport.open(await f.read())).pages, f.name, at); }
      if (/^(png|jpe?g|webp|gif|bmp)$/.test(ext) || /^image\//.test(f.type || '')) {
        const buf = await f.read();
        return IO.importRaster(new Blob([buf], { type: f.type || 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }), f.name, at);
      }
      UI.toast('Этот тип файла не поддерживается: ' + f.name);
    } catch (e) { console.error(e); UI.toast('Не удалось импортировать ' + f.name + ': ' + (e.message || e)); }
    finally { UI.busy(null); }
  },
  // первая страница — группой на текущую страницу, остальные — новыми страницами
  placePages(pages, name, at) {
    if (!pages.length) return UI.toast('Пусто');
    const [first, ...rest] = pages;
    if (first.objects.length) {
      const g = first.objects.length > 1 ? Object.assign(Model.make('group', { children: first.objects }), { name: name.replace(/\.\w+$/, '') }) : first.objects[0];
      if (at) { const b = Model.worldBox(g); Model.applyT(g, Mx.translate(at.x - (b.x1 + b.x2) / 2, at.y - (b.y1 + b.y2) / 2)); }
      Actions.insert([g]);
    }
    for (const pg of rest) {
      const P = Model.newPage(pg.w, pg.h, App.doc.pages.length + 1);
      P.layers[0].objects = pg.objects; App.doc.pages.push(P);
    }
    App.commit('Импорт ' + name);
    UI.toast(rest.length ? `Импортировано: ${name}, ещё ${rest.length} стр. добавлены в конец` : 'Импортировано: ' + name);
  },
  importRaster(blob, name, at, fit = 0.9) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          // растр: 96 точек на дюйм, но не больше страницы
          let w = img.naturalWidth * 25.4 / 96, hh = img.naturalHeight * 25.4 / 96;
          const p = App.pg(), k = Math.min(1, p.w * fit / w, p.h * fit / hh);
          w *= k; hh *= k;
          const o = Model.make('image', { w, h: hh, href: r.result, name: name || 'Изображение' });
          o.stroke = Object.assign(structuredClone(App.defaults.stroke), { color: null });
          o.fill = { type: 'none' };
          const c = at || { x: p.w / 2, y: p.h / 2 };
          o.m = Mx.translate(c.x - w / 2, c.y - hh / 2);
          Actions.insert([o]); App.commit('Импорт изображения');
          res(o);
        };
        img.onerror = () => { UI.toast('Не удалось прочитать изображение'); res(null); };
        img.src = r.result;
      };
      r.readAsDataURL(blob);
    });
  },
  // разбор SVG в объекты редактора; возвращает размер в мм
  importSVGText(text, at, asDoc = false) {
    const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) { UI.toast('Не удалось разобрать SVG'); return null; }
    // временно вставляем в документ, чтобы получить вычисленные стили и матрицы
    const host = h('div', { style: { position: 'absolute', left: '-100000px', top: '0', visibility: 'hidden' } });
    const svg = document.importNode(root, true);
    svg.querySelectorAll('script, foreignObject').forEach(n => n.remove());
    host.append(svg); document.body.append(host);
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
    const len = a => { try { const L = svg[a].baseVal; L.convertToSpecifiedUnits(SVGLength.SVG_LENGTHTYPE_MM); return L.valueInSpecifiedUnits; } catch (e) { return 0; } };
    let wmm = len('width'), hmm = len('height');
    if (!wmm || !hmm) { const bb = svg.getBoundingClientRect(); wmm = (vb ? vb.width : bb.width) * 25.4 / 96; hmm = (vb ? vb.height : bb.height) * 25.4 / 96; }
    const svgRect = svg.getBoundingClientRect();
    const px2mm = 25.4 / 96;
    // экранные px внутри svg → мм
    const base = Mx.mul(Mx.scale(px2mm, px2mm), Mx.translate(-svgRect.left, -svgRect.top));
    const ctm = el => { const m = el.getScreenCTM(); return Mx.mul(base, [m.a, m.b, m.c, m.d, m.e, m.f]); };
    const objs = [];
    const styleOf = (el, o) => {
      const cs = getComputedStyle(el);
      const paint = v => {
        if (!v || v === 'none') return null;
        if (v.startsWith('url(')) {
          const id = (v.match(/#([^)"']+)/) || [])[1];
          const g = id && svg.querySelector('#' + CSS.escape(id));
          const stops = g ? [...g.querySelectorAll('stop')] : [];
          if (stops.length) {
            const c1 = Color.normalize(getComputedStyle(stops[0]).stopColor) || '#000000', c2 = Color.normalize(getComputedStyle(stops[stops.length - 1]).stopColor) || '#ffffff';
            return { type: g.nodeName === 'radialGradient' ? 'radial' : 'linear', color: c1, color2: c2, angle: 0 };
          }
          return null;
        }
        const c = Color.normalize(v);
        return c ? { type: 'solid', color: c, color2: '#ffffff', angle: 0 } : null;
      };
      o.fill = paint(cs.fill) || { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      const sp = paint(cs.stroke);
      const m = ctm(el), sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      const sw = parseFloat(cs.strokeWidth) || 0;
      o.stroke = Object.assign(Model.defaults().stroke, { color: sp ? sp.color : null, width: G.round(sw * (sc || px2mm), 4), cap: cs.strokeLinecap, join: cs.strokeLinejoin === 'round' || cs.strokeLinejoin === 'bevel' ? cs.strokeLinejoin : 'miter' });
      if (cs.strokeDasharray && cs.strokeDasharray !== 'none') o.stroke.dash = 'dash';
      const op = (parseFloat(cs.opacity) || 1) * (parseFloat(cs.fillOpacity) ?? 1);
      o.opacity = G.clamp(isNaN(op) ? 1 : op, 0, 1);
      if (el.id) o.name = el.id;
      return o;
    };
    const walk = (el) => {
      for (const c of el.children) {
        const tag = c.nodeName.toLowerCase();
        if (['defs', 'clippath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'pattern', 'filter', 'marker'].includes(tag)) continue;
        if (getComputedStyle(c).display === 'none') continue;
        try {
          if (tag === 'g' || tag === 'a' || tag === 'switch' || tag === 'svg') { walk(c); continue; }
          if (tag === 'use') {
            const href = c.getAttribute('href') || c.getAttribute('xlink:href');
            if (href) {
              // разворачиваем <use> в копию элемента на месте
              const ref = svg.querySelector(CSS.escape(href).replace(/^\\#/, '#'));
              if (ref) {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                const x = parseFloat(c.getAttribute('x')) || 0, y = parseFloat(c.getAttribute('y')) || 0;
                g.setAttribute('transform', (c.getAttribute('transform') || '') + ` translate(${x} ${y})`);
                for (const a of ['fill', 'stroke', 'stroke-width', 'style', 'opacity']) if (c.hasAttribute(a)) g.setAttribute(a, c.getAttribute(a));
                const cl = ref.cloneNode(true); cl.removeAttribute('id');
                if (cl.nodeName.toLowerCase() === 'symbol') { while (cl.firstChild) g.append(cl.firstChild); } else g.append(cl);
                c.after(g); walk({ children: [g] }); g.remove();
              }
            }
            continue;
          }
          let o = null;
          const M = ctm(c);
          if (tag === 'rect') {
            const g = n => c[n].baseVal.value;
            const w = g('width'), hh = g('height');
            if (!w || !hh) continue;
            let rx = c.rx.baseVal.value || c.ry.baseVal.value;
            o = Model.make('rect', { w, h: hh, r: rx || 0 });
            o.m = Mx.mul(M, Mx.translate(g('x'), g('y')));
            // normalize переносит масштаб в ширину/высоту, а радиус пересчитываем сами
            o.r *= Math.sqrt(Math.abs(o.m[0] * o.m[3] - o.m[1] * o.m[2]));
          } else if (tag === 'circle' || tag === 'ellipse') {
            const cx = c.cx.baseVal.value, cy = c.cy.baseVal.value;
            const rx = tag === 'circle' ? c.r.baseVal.value : c.rx.baseVal.value, ry = tag === 'circle' ? rx : c.ry.baseVal.value;
            if (!rx || !ry) continue;
            o = Model.make('ellipse', { w: rx * 2, h: ry * 2, mode: 'ellipse', a1: 0, a2: 360 });
            o.m = Mx.mul(M, Mx.translate(cx - rx, cy - ry));
          } else if (tag === 'line') {
            const g = n => c[n].baseVal.value;
            o = Model.make('path', { subs: [{ closed: false, nodes: [Path.node(g('x1'), g('y1')), Path.node(g('x2'), g('y2'))] }] });
            o.m = M;
          } else if (tag === 'polyline' || tag === 'polygon') {
            const pts = (c.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
            const nodes = [];
            for (let i = 0; i + 1 < pts.length; i += 2) nodes.push(Path.node(pts[i], pts[i + 1]));
            if (nodes.length < 2) continue;
            o = Model.make('path', { subs: [{ closed: tag === 'polygon', nodes }] });
            o.m = M;
          } else if (tag === 'path') {
            const subs = Path.parse(c.getAttribute('d') || '');
            if (!subs.length) continue;
            o = Model.make('path', { subs });
            o.m = M;
          } else if (tag === 'text') {
            const cs = getComputedStyle(c);
            const fsPx = parseFloat(cs.fontSize) || 16;
            const lines = c.querySelectorAll('tspan').length ? [...c.children].filter(t => t.nodeName === 'tspan').map(t => t.textContent) : [c.textContent];
            const x = c.x.baseVal.numberOfItems ? c.x.baseVal.getItem(0).value : 0, y = c.y.baseVal.numberOfItems ? c.y.baseVal.getItem(0).value : 0;
            const sc = Math.hypot(M[0], M[1]);
            const sizePt = fsPx * sc / PT_MM;
            const anchor = cs.textAnchor;
            o = Model.make('text', { text: lines.join('\n').trim(), font: (cs.fontFamily || 'Arial').split(',')[0].replace(/["']/g, '').trim(), size: G.round(sizePt, 2), bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle === 'italic', align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', lh: 1.2 });
            // в редакторе базовая линия первой строки на 0.85 кегля от начала координат
            const lin = [M[0] / sc, M[1] / sc, M[2] / sc, M[3] / sc, 0, 0];
            const p0 = Mx.apply(M, x, y);
            const off = Mx.applyVec(lin, 0, -sizePt * PT_MM * 0.85);
            o.m = [lin[0], lin[1], lin[2], lin[3], p0.x + off.x, p0.y + off.y];
          } else if (tag === 'image') {
            const href = c.getAttribute('href') || c.getAttribute('xlink:href');
            const g = n => c[n].baseVal.value;
            if (!href || !g('width')) continue;
            o = Model.make('image', { w: g('width'), h: g('height'), href });
            o.m = Mx.mul(M, Mx.translate(g('x'), g('y')));
            styleOf(c, o); o.fill = { type: 'none' }; o.stroke.color = null;
            objs.push(o); continue;
          }
          if (o) {
            styleOf(c, o);
            if (o.type === 'text' && o.stroke) o.stroke.color = o.stroke.color && o.stroke.width > 0 ? o.stroke.color : null;
            Model.normalize(o);
            objs.push(o);
          }
        } catch (err) { console.warn('импорт SVG: пропущен элемент', tag, err); }
      }
    };
    walk(svg);
    host.remove();
    if (!objs.length) { UI.toast('В SVG не найдено поддерживаемых объектов'); return null; }
    if (asDoc) { Actions.insert(objs); return { w: wmm, h: hmm }; }
    let target = objs;
    if (objs.length > 1) {
      const g = Model.make('group', { children: objs, name: 'Импорт SVG' }); delete g.fill; delete g.stroke;
      target = [g];
    }
    // ставим импорт в точку бросания или в центр страницы
    const b = Model.worldBox(target[0]);
    const c = at || { x: App.pg().w / 2, y: App.pg().h / 2 };
    if (G.boxValid(b)) Model.applyT(target[0], Mx.translate(c.x - (b.x1 + b.x2) / 2, c.y - (b.y1 + b.y2) / 2));
    Actions.insert(target);
    App.commit('Импорт SVG');
    UI.toast(`Импортировано объектов: ${objs.length}`);
    return { w: wmm, h: hmm };
  },

  // ---------- экспорт ----------
  exportDialog(preset) {
    const fmt = UI.sel([['png', 'PNG — растр с прозрачностью'], ['jpg', 'JPG — растр'], ['svg', 'SVG — вектор'], ['pdfx', 'PDF для типографии — CMYK, вылеты, метки'], ['pdfv', 'PDF векторный (RGB)'], ['ai', 'AI — Adobe Illustrator (PDF-совместимый)'], ['pdf', 'PDF — через окно печати'],
      ['cdr', 'CDR — CorelDRAW (нужен установленный Corel)'], ['vkt', 'VKT — документ Вектора'], ...(typeof Convert !== 'undefined' ? Convert.exportFormats() : [])], typeof preset === 'string' ? preset : (IO.lastFmt || 'png'), v => { IO.lastFmt = v; upd(); }, '', 300);
    const pp = typeof Prepress !== 'undefined' ? Prepress.pp() : { bleed: 0 };
    const cmykC = h('input', { type: 'checkbox', checked: true }), marksC = h('input', { type: 'checkbox', checked: (pp.bleed || 0) > 0 });
    const bleedIn = h('input', { type: 'number', min: 0, step: 0.5, value: pp.bleed || 0 });
    const pdfRow = h('div', { class: 'form' }, h('label', { class: 'chk' }, cmykC, ' Цвета в CMYK (точные значения документа, остальное — по профилю)'), h('label', {}, 'Вылеты, мм', bleedIn), h('label', { class: 'chk' }, marksC, ' Метки реза'));
    const dpi = h('input', { type: 'number', value: IO.lastDpi || 300, min: 36, max: 1200 });
    const area = UI.sel([['page', 'Текущая страница'], ['pages', 'Все страницы'], ['sel', 'Только выделенное'], ['all', 'Все объекты страницы']], App.sel.length ? 'sel' : 'page', () => upd(), '', 300);
    const ver = UI.sel(CDR_VERSIONS, IO.lastVer || 17, v => { IO.lastVer = +v; }, '', 300);
    const transp = h('input', { type: 'checkbox', checked: IO.lastTransp ?? false });
    const info = h('p', { class: 'muted' });
    const verRow = h('label', {}, 'Версия CorelDRAW', ver);
    const upd = () => {
      const f = fmt.value;
      verRow.style.display = f === 'cdr' ? '' : 'none';
      pdfRow.style.display = ['pdfx', 'pdfv', 'ai', 'cdr'].includes(f) ? '' : 'none';
      marksC.parentNode.style.display = bleedIn.parentNode.style.display = f === 'cdr' ? 'none' : '';
      const b = IO.area(area.value === 'pages' ? 'page' : area.value);
      const px = b ? `${Math.round((b.x2 - b.x1) / 25.4 * dpi.value)} × ${Math.round((b.y2 - b.y1) / 25.4 * dpi.value)} пикселей` : '—';
      info.textContent = ['png', 'jpg'].includes(f) ? 'Размер: ' + px + (area.value === 'pages' && App.doc.pages.length > 1 ? '; страницы сложатся в ZIP' : '')
        : f === 'svg' ? 'Размеры в мм, шрифты из набора программы встраиваются в файл.'
          : f === 'cdr' ? (Host.desktop ? 'Страницы передаются в установленный CorelDRAW и сохраняются в выбранной версии.' : 'Сохранение в CDR работает в настольной версии «Вектора» на Windows с установленным CorelDRAW. В браузере сохраните PDF или SVG — Corel откроет их.')
            : f === 'pdf' ? 'Откроется окно печати: выберите «Сохранить как PDF». Все страницы документа попадут в один PDF.'
              : f === 'pdfx' || f === 'pdfv' || f === 'ai' ? 'Все страницы, векторами; текст — кривыми. Обрезной формат (TrimBox) и вылеты (BleedBox) записываются в файл.'
                : typeof Convert !== 'undefined' && Convert.describe(f) || 'Полный документ со страницами и слоями.';
    };
    dpi.addEventListener('input', upd);
    upd();
    UI.dialog('Экспорт', h('div', { class: 'form' },
      h('label', {}, 'Формат', fmt), h('label', {}, 'Что экспортировать', area), verRow, pdfRow, h('label', {}, 'Разрешение, точек на дюйм', dpi),
      h('label', { class: 'chk' }, transp, 'Прозрачный фон (PNG и SVG)'), info),
    [{ label: 'Отмена' }, { label: 'Экспорт', primary: true, action: () => {
      IO.lastDpi = +dpi.value; IO.lastTransp = transp.checked;
      IO.exportOpt = { cmyk: cmykC.checked, bleed: +bleedIn.value || 0, marks: marksC.checked };
      IO.exportAs(fmt.value, area.value, +dpi.value || 300, transp.checked, +ver.value);
    } }]);
  },
  area(kind, page = App.pg()) {
    if (kind === 'sel') return Model.selBox();
    if (kind === 'all') {
      let b = G.emptyBox(); Model.topLevel(page).forEach(({ o }) => { if (o.visible) b = G.unionBox(b, Model.worldBox(o)); });
      return G.boxValid(b) ? b : null;
    }
    return { x1: 0, y1: 0, x2: page.w, y2: page.h };
  },
  // SVG страницы (или выделения) с нужной рамкой
  svgFor(kind, transparent, page = App.pg()) {
    const b = IO.area(kind, page);
    if (!b) return null;
    let src = page;
    if (kind === 'sel') src = Object.assign({}, page, { layers: [{ id: 'x', name: 'x', visible: true, objects: App.selObjs() }] });
    const pad = kind === 'page' ? 0 : 0.5;
    const x = b.x1 - pad, y = b.y1 - pad, w = b.x2 - b.x1 + pad * 2, hh = b.y2 - b.y1 + pad * 2;
    let svg = Render.exportSVG(src, { background: !transparent && kind === 'page' });
    svg = svg.replace(/width="[^"]*mm" height="[^"]*mm" viewBox="[^"]*"/, `width="${G.round(w, 3)}mm" height="${G.round(hh, 3)}mm" viewBox="${G.round(x, 4)} ${G.round(y, 4)} ${G.round(w, 4)} ${G.round(hh, 4)}"`);
    return { svg, w, h: hh };
  },
  // SVG → PNG/JPG (Blob)
  rasterize(svg, wmm, hmm, dpi, fmt = 'png', bg = null) {
    const W = Math.max(1, Math.round(wmm / 25.4 * dpi)), H = Math.max(1, Math.round(hmm / 25.4 * dpi));
    if (W > 16384 || H > 16384) return Promise.reject(new Error('Слишком большое изображение — уменьшите разрешение'));
    const sized = svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${W}" height="${H}"`);
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        if (fmt === 'jpg' || bg) { ctx.fillStyle = bg || '#ffffff'; ctx.fillRect(0, 0, W, H); }
        ctx.drawImage(img, 0, 0, W, H);
        c.toBlob(b => b ? res({ blob: b, W, H }) : rej(new Error('Не удалось создать изображение')), fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
      };
      // blob:-адрес вместо data: — у data:-адресов есть предел длины, и большие фото пропадали из экспорта
      const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
      const done = img.onload;
      img.onload = () => { try { done(); } finally { URL.revokeObjectURL(url); } };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Ошибка при растеризации')); };
      img.src = url;
    });
  },
  // картинка страницы для агента (data URL)
  async pageImage(page = App.pg(), maxPx = 1200) {
    const r = IO.svgFor('page', false, page);
    const dpi = Math.min(150, maxPx / Math.max(page.w, page.h) * 25.4);
    const { blob } = await IO.rasterize(r.svg, r.w, r.h, dpi, 'jpg', page.color || '#ffffff');
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  },
  async exportAs(fmt, kind, dpi, transparent, version = 17) {
    const base = IO.baseName();
    try {
      if (fmt === 'vkt') return await Host.saveFile(base + '.vkt', IO.json(), 'application/json');
      if (fmt === 'pdf') return IO.print();
      const eo = IO.exportOpt || {};
      if (fmt === 'pdfx' || fmt === 'pdfv' || fmt === 'ai') {
        const pages = kind === 'pages' || fmt !== 'pdfv' ? App.doc.pages : [App.pg()];
        const bytes = await (async () => { UI.busy('Собираю PDF…'); try { return await PDFWriter.build(pages, { cmyk: fmt === 'pdfv' ? false : eo.cmyk !== false, bleed: fmt === 'pdfv' ? 0 : eo.bleed || 0, marks: fmt === 'pdfx' && eo.marks, title: App.doc.name, imageJpeg: true }); } finally { UI.busy(null); } })();
        const ext = fmt === 'ai' ? 'ai' : 'pdf';
        await Host.saveFile(base + (fmt === 'pdfx' && eo.cmyk !== false ? '-CMYK' : '') + '.' + ext, new Blob([bytes], { type: 'application/pdf' }), 'application/pdf', ext);
        return UI.toast('Сохранено: ' + (bytes.length / 1048576).toFixed(1) + ' МБ');
      }
      if (fmt === 'cdr') return await IO.exportCDR(version, { cmyk: eo.cmyk !== false });
      if (typeof Convert !== 'undefined' && Convert.handles(fmt)) return await Convert.exportDoc(fmt, kind);
      const pages = kind === 'pages' ? App.doc.pages : [App.pg()];
      const files = [];
      for (let i = 0; i < pages.length; i++) {
        const r = IO.svgFor(kind === 'pages' ? 'page' : kind, transparent, pages[i]);
        if (!r) continue;
        const suffix = pages.length > 1 ? '-' + String(i + 1).padStart(2, '0') : '';
        if (fmt === 'svg') files.push({ name: base + suffix + '.svg', data: new TextEncoder().encode(r.svg) });
        else {
          const { blob, W, H } = await IO.rasterize(r.svg, r.w, r.h, dpi, fmt, fmt === 'jpg' ? (pages[i].color || '#ffffff') : null);
          files.push({ name: base + suffix + '.' + fmt, data: new Uint8Array(await blob.arrayBuffer()), W, H });
        }
      }
      if (!files.length) return UI.toast('Нечего экспортировать');
      if (files.length === 1) {
        const f = files[0];
        await Host.saveFile(f.name, new Blob([f.data]), fmt === 'svg' ? 'image/svg+xml' : fmt === 'jpg' ? 'image/jpeg' : 'image/png');
        UI.toast(f.W ? `Экспорт: ${f.W} × ${f.H} px` : 'Экспорт: ' + f.name);
      } else {
        const zip = fflate.zipSync(Object.fromEntries(files.map(f => [f.name, f.data])), { level: 0 });
        await Host.saveFile(base + '.zip', new Blob([zip], { type: 'application/zip' }), 'application/zip');
        UI.toast(`Экспорт: ${files.length} файлов в ZIP`);
      }
    } catch (e) { console.error(e); UI.toast('Экспорт не удался: ' + (e.message || e)); }
  },
  // CDR нужной версии: страницы → SVG → установленный CorelDRAW → «Сохранить как» с версией
  async exportCDR(version, opt = {}) {
    if (!Host.desktop) { if (opt.out) throw new Error('CDR — только в настольной версии с CorelDRAW'); return UI.toast('Сохранение в CDR доступно в настольной версии на Windows с установленным CorelDRAW'); }
    UI.busy('Проверяю CorelDRAW…');
    const probe = await vkHost.corelProbe();
    UI.busy(null);
    if (!probe.ok) { if (opt.out) throw new Error('CorelDRAW недоступен: ' + probe.error); return UI.toast('CorelDRAW недоступен: ' + probe.error); }
    const out = opt.out || await vkHost.saveDialog({ defaultPath: IO.baseName() + '.cdr', filters: [{ name: 'CorelDRAW', extensions: ['cdr'] }] });
    if (!out) return;
    const pages = App.doc.pages.map(P => {
      let svg = Render.exportSVG(P, { background: false, frames: true });
      // фон страницы с вылетами — отдельным объектом
      const bl = typeof Prepress !== 'undefined' ? Prepress.pp(P).bleed || 0 : 0;
      if (P.color && P.color.toLowerCase() !== '#ffffff') svg = svg.replace('<defs>', `<rect id="vk-page-bg" x="${-bl}" y="${-bl}" width="${P.w + bl * 2}" height="${P.h + bl * 2}" fill="${P.color}"/>\n<defs>`);
      // невидимая рамка страницы — чтобы Corel поставил импорт точно на место; после импорта удаляется
      svg = svg.replace('<defs>', `<rect id="vk-page-frame" width="${P.w}" height="${P.h}" fill="none" stroke="none"/>\n<defs>`);
      return { w: P.w, h: P.h, svg };
    });
    UI.busy('CorelDRAW сохраняет файл…');
    // точные CMYK цветов документа: Corel перекрасит импортированные RGB-цвета в эти значения
    const cmyk = {};
    if (opt.cmyk && typeof CMYK !== 'undefined') {
      const add = hex => { if (hex) cmyk[hex.toLowerCase()] = CMYK.of(hex).map(v => Math.round(v)); };
      Model.walkDoc(App.doc, o => CMYK.paints(o, (p, k) => add(p[k])));
      App.doc.pages.forEach(P => add(P.color));
    }
    const r = await vkHost.corelBuild(pages, out, version, { cmyk: opt.cmyk ? cmyk : null, bitmapsCmyk: !!opt.cmyk });
    UI.busy(null);
    if (opt.out) { if (!r.ok) throw new Error(r.error); return out; }
    if (r.ok) { UI.toast('Сохранено для ' + (CDR_VERSIONS.find(v => v[0] === version) || [, ''])[1] + ': ' + out.split(/[\\/]/).pop()); vkHost.reveal(out); }
    else UI.toast('CorelDRAW не сохранил файл: ' + r.error);
  },
  printHTML(pages = App.doc.pages) {
    const body = pages.map(P => {
      const r = IO.svgFor('page', false, P);
      return `<div class="pg" style="width:${P.w}mm;height:${P.h}mm">${r.svg.replace(/^<\?xml[^>]*>/, '')}</div>`;
    }).join('');
    const P0 = pages[0];
    return `<!doctype html><html><head><meta charset="utf-8"><title>${Render.esc(IO.baseName())}</title><style>@page{size:${P0.w}mm ${P0.h}mm;margin:0}html,body{margin:0;padding:0}.pg{page-break-after:always;overflow:hidden}.pg:last-child{page-break-after:auto}svg{display:block;width:100%;height:100%}</style></head><body>${body}</body></html>`;
  },
  async print() {
    // настольная версия сохраняет настоящий PDF-файл, браузер — через окно печати
    if (Host.desktop && vkHost.printPDF) {
      const p = await vkHost.saveDialog({ defaultPath: IO.baseName() + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (!p) return;
      UI.busy('Сохраняю PDF…');
      const r = await vkHost.printPDF(IO.printHTML(), p);
      UI.busy(null);
      if (r.ok) { UI.toast('PDF сохранён: ' + p.split(/[\\/]/).pop()); vkHost.reveal(p); } else UI.toast('PDF не сохранён: ' + r.error);
      return;
    }
    const html = IO.printHTML();
    const fr = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
    document.body.append(fr);
    fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
    setTimeout(() => {
      fr.contentWindow.focus(); fr.contentWindow.print();
      setTimeout(() => fr.remove(), 1500);
    }, 500);
    UI.toast('Для PDF выберите «Сохранить как PDF» в окне печати');
  },
};
