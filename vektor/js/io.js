// Файлы: сохранение/открытие .vkt, импорт SVG и растра, экспорт SVG/PNG/JPG, печать.
'use strict';

const IO = {
  handle: null, // дескриптор файла (File System Access API) — Ctrl+S пишет в тот же файл

  download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  },
  baseName() { return (App.fileName || App.doc.name || 'Без имени').replace(/\.vkt$/i, ''); },
  json() { return JSON.stringify(App.doc); },

  async save() {
    if (IO.handle) {
      try {
        const w = await IO.handle.createWritable(); await w.write(IO.json()); await w.close();
        App.dirty = false; UI.refresh({ panels: false }); UI.toast('Сохранено: ' + App.fileName); return;
      } catch (e) { console.warn(e); }
    }
    IO.saveAs();
  },
  async saveAs() {
    const name = IO.baseName() + '.vkt';
    if (window.showSaveFilePicker) {
      try {
        IO.handle = await showSaveFilePicker({ suggestedName: name, types: [{ description: 'Документ Вектор', accept: { 'application/json': ['.vkt'] } }] });
        App.fileName = IO.handle.name;
        return IO.save();
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    IO.download(new Blob([IO.json()], { type: 'application/json' }), name);
    App.fileName = name; App.dirty = false; UI.refresh({ panels: false });
  },
  async open() {
    if (window.showOpenFilePicker) {
      try {
        const [hd] = await showOpenFilePicker({ types: [{ description: 'Документ Вектор или SVG', accept: { 'application/json': ['.vkt', '.json'], 'image/svg+xml': ['.svg'] } }] });
        const f = await hd.getFile();
        if (/\.svg$/i.test(f.name)) { IO.openSVGAsDoc(await f.text(), f.name); return; }
        IO.loadText(await f.text(), f.name); IO.handle = hd; return;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    IO.pick('.vkt,.json,.svg', async f => {
      if (/\.svg$/i.test(f.name)) IO.openSVGAsDoc(await f.text(), f.name); else IO.loadText(await f.text(), f.name);
    });
  },
  pick(accept, cb, multiple = false) {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { for (const f of inp.files) cb(f); inp.remove(); });
    document.body.append(inp); inp.click();
  },
  loadText(text, name) {
    let d;
    try { d = JSON.parse(text); if (!d.layers && !d.pages) throw new Error('нет слоёв'); } catch (e) { return UI.toast('Не удалось открыть файл: это не документ Вектора'); }
    App.doc = App.migrate(d); Model.syncSeq(App.doc); App.sel = [];
    App.fileName = name; App.dirty = false; IO.handle = null;
    App.history = [JSON.stringify(App.doc)]; App.hpos = 0;
    Text.cache.clear(); App.autosave(); App.zoomPage(); UI.refresh();
    UI.toast('Открыт: ' + name);
  },
  openSVGAsDoc(text, name) {
    App.doc = Model.newDoc(); App.sel = [];
    App.history = [JSON.stringify(App.doc)]; App.hpos = 0;
    const size = IO.importSVGText(text, null, true);
    if (size) { App.pg().w = G.round(size.w, 3); App.pg().h = G.round(size.h, 3); }
    App.doc.name = name.replace(/\.svg$/i, '');
    App.fileName = null; IO.handle = null; App.sel = [];
    App.commit('Открыт SVG'); App.zoomPage();
  },

  // ---------- импорт ----------
  importDialog() { IO.pick('.svg,image/png,image/jpeg,image/webp,image/gif', f => IO.importFile(f), true); },
  importFile(f, at) {
    if (!f) return;
    if (/\.vkt$|\.json$/i.test(f.name)) { f.text().then(t => IO.loadText(t, f.name)); return; }
    if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) { f.text().then(t => IO.importSVGText(t, at)); return; }
    if (!/^image\//.test(f.type)) return UI.toast('Этот тип файла не поддерживается: ' + f.name);
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        // растр: 96 точек на дюйм, но не больше страницы
        let w = img.naturalWidth * 25.4 / 96, hh = img.naturalHeight * 25.4 / 96;
        const p = App.pg(), k = Math.min(1, p.w * 0.9 / w, p.h * 0.9 / hh);
        w *= k; hh *= k;
        const o = Model.make('image', { w, h: hh, href: r.result, name: f.name || 'Изображение' });
        o.stroke = Object.assign(structuredClone(App.defaults.stroke), { color: null });
        const c = at || { x: p.w / 2, y: p.h / 2 };
        o.m = Mx.translate(c.x - w / 2, c.y - hh / 2);
        Actions.insert([o]); App.commit('Импорт изображения');
      };
      img.onerror = () => UI.toast('Не удалось прочитать изображение');
      img.src = r.result;
    };
    r.readAsDataURL(f);
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
  exportDialog() {
    const fmt = UI.sel([['svg', 'SVG — вектор'], ['png', 'PNG — растр с прозрачностью'], ['jpg', 'JPG — растр'], ['vkt', 'VKT — документ Вектора']], IO.lastFmt || 'png', v => { IO.lastFmt = v; upd(); }, '', 240);
    const dpi = h('input', { type: 'number', value: IO.lastDpi || 300, min: 36, max: 1200 });
    const area = UI.sel([['page', 'Страница'], ['sel', 'Только выделенное'], ['all', 'Все объекты']], App.sel.length ? 'sel' : 'page', () => upd(), '', 240);
    const transp = h('input', { type: 'checkbox', checked: IO.lastTransp ?? false });
    const info = h('p', { class: 'muted' });
    const upd = () => {
      const b = IO.area(area.value);
      const px = b ? `${Math.round((b.x2 - b.x1) / 25.4 * dpi.value)} × ${Math.round((b.y2 - b.y1) / 25.4 * dpi.value)} пикселей` : '—';
      info.textContent = ['png', 'jpg'].includes(fmt.value) ? 'Размер: ' + px : fmt.value === 'svg' ? 'Размеры в мм, шрифты из набора программы встраиваются в файл.' : 'Полный документ со слоями.';
    };
    dpi.addEventListener('input', upd);
    upd();
    UI.dialog('Экспорт', h('div', { class: 'form' },
      h('label', {}, 'Формат', fmt), h('label', {}, 'Область', area), h('label', {}, 'Разрешение, точек на дюйм', dpi),
      h('label', { class: 'chk' }, transp, 'Прозрачный фон (PNG и SVG)'), info),
    [{ label: 'Отмена' }, { label: 'Экспорт', primary: true, action: () => {
      IO.lastDpi = +dpi.value; IO.lastTransp = transp.checked;
      IO.exportAs(fmt.value, area.value, +dpi.value || 300, transp.checked);
    } }]);
  },
  area(kind) {
    if (kind === 'sel') return Model.selBox();
    if (kind === 'all') {
      let b = G.emptyBox(); Model.topLevel().forEach(({ o }) => { if (o.visible) b = G.unionBox(b, Model.worldBox(o)); });
      return G.boxValid(b) ? b : null;
    }
    return { x1: 0, y1: 0, x2: App.pg().w, y2: App.pg().h };
  },
  svgFor(kind, transparent) {
    const b = IO.area(kind);
    if (!b) return null;
    let doc = App.pg();
    if (kind === 'sel') {
      doc = Object.assign({}, App.pg(), { layers: [{ id: 'x', name: 'x', visible: true, objects: App.selObjs() }] });
    }
    const pad = kind === 'page' ? 0 : 0.5;
    const x = b.x1 - pad, y = b.y1 - pad, w = b.x2 - b.x1 + pad * 2, hh = b.y2 - b.y1 + pad * 2;
    let svg = Render.exportSVG(doc, { background: !transparent && kind === 'page' });
    svg = svg.replace(/width="[^"]*mm" height="[^"]*mm" viewBox="[^"]*"/, `width="${G.round(w, 3)}mm" height="${G.round(hh, 3)}mm" viewBox="${G.round(x, 4)} ${G.round(y, 4)} ${G.round(w, 4)} ${G.round(hh, 4)}"`);
    return { svg, w, h: hh };
  },
  async exportAs(fmt, kind, dpi, transparent) {
    const base = IO.baseName();
    if (fmt === 'vkt') return IO.download(new Blob([IO.json()], { type: 'application/json' }), base + '.vkt');
    const r = IO.svgFor(kind, transparent);
    if (!r) return UI.toast('Нечего экспортировать');
    if (fmt === 'svg') return IO.download(new Blob([r.svg], { type: 'image/svg+xml' }), base + '.svg');
    const W = Math.round(r.w / 25.4 * dpi), H = Math.round(r.h / 25.4 * dpi);
    if (W * H > 16384 * 16384 || W > 16384 || H > 16384) return UI.toast('Слишком большое изображение — уменьшите разрешение');
    const svg = r.svg.replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${W}" height="${H}"`);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      if (fmt === 'jpg' || !transparent && kind !== 'page') { ctx.fillStyle = fmt === 'jpg' ? (App.pg().color || '#ffffff') : 'transparent'; if (fmt === 'jpg') ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(img, 0, 0, W, H);
      c.toBlob(b => {
        if (!b) return UI.toast('Не удалось создать изображение (слишком большое?)');
        IO.download(b, base + '.' + fmt); UI.toast(`Экспорт: ${W} × ${H} px`);
      }, fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
    };
    img.onerror = () => UI.toast('Ошибка при растеризации');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },
  print() {
    const r = IO.svgFor('page', false);
    const { w, h: hh } = App.pg();
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${Render.esc(IO.baseName())}</title><style>@page{size:${w}mm ${hh}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${w}mm;height:${hh}mm}</style></head><body>${r.svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`;
    const fr = h('iframe', { style: { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' } });
    document.body.append(fr);
    fr.contentDocument.open(); fr.contentDocument.write(html); fr.contentDocument.close();
    setTimeout(() => {
      fr.contentWindow.focus(); fr.contentWindow.print();
      setTimeout(() => fr.remove(), 1500);
    }, 400);
    UI.toast('Для PDF выберите «Сохранить как PDF» в окне печати');
  },
};
