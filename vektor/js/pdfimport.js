// Импорт PDF как редактируемой векторной графики (через pdf.js): контуры, заливки,
// абрисы, прозрачность, растровые изображения и текст (как текстовые объекты).
// Так открываются брендбуки, макеты из Illustrator (.ai — это PDF внутри) и сохранённые из Corel PDF.
'use strict';

const PDFImport = {
  async open(buffer, opts = {}) {
    const pdfjs = await Host.lib('pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    const max = Math.min(doc.numPages, opts.maxPages || 200);
    for (let i = 1; i <= max; i++) {
      const page = await doc.getPage(i);
      pages.push(await PDFImport.page(page, pdfjs, opts));
    }
    return { pages, numPages: doc.numPages, pdf: doc };
  },

  async page(page, pdfjs, opts) {
    const OPS = pdfjs.OPS;
    const vp = page.getViewport({ scale: 25.4 / 72 }); // мм, y вниз
    const V = vp.transform;
    const ops = await page.getOperatorList();
    const objects = [];
    let st = { ctm: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lw: 1, fa: 1, sa: 1, dash: null, cap: 0, join: 0 };
    const stack = [];
    let path = new PathAcc();
    const cur = { x: 0, y: 0 };
    const M = () => Mx.mul(V, st.ctm);
    // обтравка (PowerClip): объекты под одной обтравкой собираются в один PowerClip
    let clipPending = false, clipSeq = 0;
    const place = o => {
      const c = st.clip;
      if (!c) return objects.push(o);
      const last = objects[objects.length - 1];
      if (last && last.type === 'powerclip' && last._clip === c.id) return last.children.push(o);
      const cont = Model.make('path', { subs: structuredClone(c.subs), name: 'Рамка' });
      cont.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      cont.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
      const pc = Model.make('powerclip', { container: cont, children: [o] });
      Object.defineProperty(pc, '_clip', { value: c.id, enumerable: false });
      objects.push(pc);
    };
    const takeClip = () => {
      if (!clipPending) return;
      clipPending = false;
      const subs = path.subs.filter(sp => sp.nodes.length > 1).map(sp => structuredClone(sp));
      if (!subs.length) return;
      Path.transform(subs, M());
      // обтравка во всю страницу ничего не режет
      const b = Path.bbox ? Path.bbox(subs) : null;
      if (b && b.x1 <= 0.5 && b.y1 <= 0.5 && b.x2 >= vp.width - 0.5 && b.y2 >= vp.height - 0.5 && subs.length === 1 && subs[0].nodes.length <= 5) return;
      st.clip = { id: ++clipSeq, subs };
    };
    const emit = (fill, stroke, evenodd) => {
      takeClip();
      if (!path.subs.length) return;
      const subs = path.subs.filter(sp => sp.nodes.length > 1);
      Path.transform(subs, M());
      path = new PathAcc();
      if (!subs.length) return;
      for (const sp of subs) Path.detectSmooth(sp);
      const o = Model.make('path', { subs });
      o.fill = fill ? { type: 'solid', color: st.fill, color2: '#ffffff', angle: 0 } : { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      const m = M(), sc = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
      o.stroke = stroke ? Object.assign(Model.defaults().stroke, { color: st.stroke, width: G.round(Math.max(0.05, st.lw * sc), 4), cap: ['butt', 'round', 'square'][st.cap] || 'butt', join: ['miter', 'round', 'bevel'][st.join] || 'miter' })
        : Object.assign(Model.defaults().stroke, { color: null, width: 0 });
      if (stroke && st.dash && st.dash.length) o.stroke.dashArray = st.dash.map(v => v / Math.max(st.lw, 0.01));
      const a = fill ? st.fa : st.sa;
      if (a < 1) o.opacity = a;
      void evenodd;
      place(o);
    };
    const { fnArray, argsArray } = ops;
    const textColors = [];
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], args = argsArray[i];
      try {
        switch (fn) {
          case OPS.save: stack.push(structuredClone(st)); break;
          case OPS.restore: if (stack.length) st = stack.pop(); break;
          case OPS.transform: st.ctm = Mx.mul(st.ctm, args); break;
          case OPS.paintFormXObjectBegin: stack.push(structuredClone(st)); if (args[0]) st.ctm = Mx.mul(st.ctm, args[0]); break;
          case OPS.paintFormXObjectEnd: if (stack.length) st = stack.pop(); break;
          case OPS.setLineWidth: st.lw = args[0]; break;
          case OPS.setLineCap: st.cap = args[0]; break;
          case OPS.setLineJoin: st.join = args[0]; break;
          case OPS.setDash: st.dash = args[0]; break;
          case OPS.setGState:
            for (const [k, v] of args[0] || []) {
              if (k === 'ca') st.fa = v; else if (k === 'CA') st.sa = v; else if (k === 'LW') st.lw = v;
              else if (k === 'LC') st.cap = v; else if (k === 'LJ') st.join = v; else if (k === 'D') st.dash = v && v[0];
            }
            break;
          case OPS.setFillRGBColor: st.fill = Color.rgbToHex(args[0], args[1], args[2]); break;
          case OPS.setStrokeRGBColor: st.stroke = Color.rgbToHex(args[0], args[1], args[2]); break;
          case OPS.setFillGray: st.fill = Color.rgbToHex(args[0] * 255, args[0] * 255, args[0] * 255); break;
          case OPS.setStrokeGray: st.stroke = Color.rgbToHex(args[0] * 255, args[0] * 255, args[0] * 255); break;
          case OPS.setFillCMYKColor: st.fill = Color.fromCmyk(args[0] * 100, args[1] * 100, args[2] * 100, args[3] * 100); break;
          case OPS.setStrokeCMYKColor: st.stroke = Color.fromCmyk(args[0] * 100, args[1] * 100, args[2] * 100, args[3] * 100); break;
          case OPS.constructPath: {
            const [ops2, a] = args;
            let k = 0;
            for (const op of ops2) {
              if (op === OPS.rectangle) {
                const x = a[k++], y = a[k++], w = a[k++], hh = a[k++];
                path.M(x, y); path.L(x + w, y); path.L(x + w, y + hh); path.L(x, y + hh); path.Z(); cur.x = x; cur.y = y;
              } else if (op === OPS.moveTo) { cur.x = a[k++]; cur.y = a[k++]; path.M(cur.x, cur.y); }
              else if (op === OPS.lineTo) { cur.x = a[k++]; cur.y = a[k++]; path.L(cur.x, cur.y); }
              else if (op === OPS.curveTo) { const x1 = a[k++], y1 = a[k++], x2 = a[k++], y2 = a[k++]; cur.x = a[k++]; cur.y = a[k++]; path.C(x1, y1, x2, y2, cur.x, cur.y); }
              else if (op === OPS.curveTo2) { const x2 = a[k++], y2 = a[k++], px = cur.x, py = cur.y; cur.x = a[k++]; cur.y = a[k++]; path.C(px, py, x2, y2, cur.x, cur.y); }
              else if (op === OPS.curveTo3) { const x1 = a[k++], y1 = a[k++]; cur.x = a[k++]; cur.y = a[k++]; path.C(x1, y1, cur.x, cur.y, cur.x, cur.y); }
              else if (op === OPS.closePath) path.Z();
            }
            break;
          }
          case OPS.fill: emit(true, false); break;
          case OPS.eoFill: emit(true, false, true); break;
          case OPS.stroke: emit(false, true); break;
          case OPS.closeStroke: path.Z(); emit(false, true); break;
          case OPS.fillStroke: case OPS.eoFillStroke: emit(true, true); break;
          case OPS.closeFillStroke: case OPS.closeEOFillStroke: path.Z(); emit(true, true); break;
          case OPS.clip: case OPS.eoClip: clipPending = true; break;
          case OPS.endPath: takeClip(); path = new PathAcc(); break;
          case OPS.showText: case OPS.showSpacedText: case OPS.nextLineShowText: case OPS.nextLineSetSpacingShowText: textColors.push({ c: st.fill, a: st.fa }); break;
          case OPS.paintImageXObject: case OPS.paintInlineImageXObject: {
            const img = fn === OPS.paintInlineImageXObject ? args[0] : await PDFImport.getObj(page, args[0]);
            const url = img && PDFImport.imageURL(img);
            if (url) {
              const o = Model.make('image', { w: 1, h: 1, href: url, name: 'Изображение из PDF' });
              o.fill = { type: 'none' }; o.stroke = Object.assign(Model.defaults().stroke, { color: null });
              o.m = Mx.mul(M(), [1, 0, 0, -1, 0, 1]);
              Model.normalize(o);
              place(o);
            }
            break;
          }
          default: break;
        }
      } catch (e) { console.warn('PDF', e); }
    }
    // текст — отдельными объектами, чтобы его можно было править
    if (opts.text !== false) {
      const tc = await page.getTextContent();
      // соседние куски одной строки (например, знак ₽ другим шрифтом) склеиваем
      const items = [];
      tc.items.forEach((it, idx) => {
        if (!it.str) return;
        const size = Math.hypot(it.transform[2], it.transform[3]) || Math.hypot(it.transform[0], it.transform[1]) || 10;
        const prev = items[items.length - 1];
        if (prev && Math.abs(prev.t[5] - it.transform[5]) < size * 0.2 && Math.abs(prev.size - size) < size * 0.15 && prev.t[1] === it.transform[1]) {
          const gap = it.transform[4] - (prev.t[4] + prev.width);
          if (gap > -size * 0.3 && gap < size * 0.8) {
            prev.str += (gap > size * 0.12 && !/\s$/.test(prev.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
            prev.width = it.transform[4] + it.width - prev.t[4];
            items._skipped = (items._skipped || 0) + 1;
            return;
          }
        }
        if (!it.str.trim()) { items._skipped = (items._skipped || 0) + 1; return; }
        items.push({ str: it.str, t: it.transform, width: it.width, size, fontName: it.fontName });
      });
      // цвет текста берём с отрисованной страницы: pdf.js не сообщает его в текстовом слое
      const pick = await PDFImport.colorPicker(page);
      for (const it of items) {
        const t = it.t, sizePt = it.size;
        it.col = pick(it) || (textColors.length ? textColors[0] : null);
        const real = PDFImport.fontName(page, it.fontName, tc.styles[it.fontName]);
        const o = Model.make('text', { text: it.str.trim(), font: real.family, bold: real.bold, italic: real.italic, size: G.round(sizePt, 2) });
        if (it.col) { o.fill = { type: 'solid', color: it.col.c, color2: '#ffffff', angle: 0 }; if (it.col.a < 1) o.opacity = it.col.a; }
        // базовая линия первой строки в «Векторе» на 0.85 кегля ниже начала координат
        const sc = 1 / (sizePt * PT_MM);
        const tm = [t[0] * sc, t[1] * sc, -t[2] * sc, -t[3] * sc, t[4], t[5]];
        const m = Mx.mul(V, tm);
        const k = Math.hypot(m[0], m[1]) || 1;
        const lin = [m[0] / k, m[1] / k, m[2] / k, m[3] / k, 0, 0];
        const off = Mx.applyVec(lin, 0, -sizePt * PT_MM * 0.85);
        o.m = [lin[0], lin[1], lin[2], lin[3], m[4] + off.x, m[5] + off.y];
        objects.push(o);
      }
    }
    return { w: vp.width, h: vp.height, objects };
  },
  async colorPicker(page) {
    const k = 2.5; // пикселей на пункт
    const vp = page.getViewport({ scale: k });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    try { await page.render({ canvasContext: ctx, viewport: vp }).promise; } catch (e) { return () => null; }
    return (it) => {
      const t = it.t, s = it.size;
      const [x1, y1] = vp.convertToViewportPoint(t[4], t[5] - s * 0.15), [x2, y2] = vp.convertToViewportPoint(t[4] + it.width, t[5] + s * 0.75);
      const X = Math.max(0, Math.floor(Math.min(x1, x2))), Y = Math.max(0, Math.floor(Math.min(y1, y2)));
      const W = Math.min(c.width - X, Math.ceil(Math.abs(x2 - x1))), H = Math.min(c.height - Y, Math.ceil(Math.abs(y2 - y1)));
      if (W < 2 || H < 2) return null;
      const d = ctx.getImageData(X, Y, W, H).data;
      const hist = new Map();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const key = (d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3);
        const e = hist.get(key) || { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; hist.set(key, e);
      }
      const arr = [...hist.values()].sort((a, b) => b.n - a.n);
      if (!arr.length) return null;
      const bg = arr[0], avg = e => [e.r / e.n, e.g / e.n, e.b / e.n];
      const B = avg(bg);
      const fg = arr.find(e => { const a = avg(e); return Math.hypot(a[0] - B[0], a[1] - B[1], a[2] - B[2]) > 90; });
      // фон страницы пуст (прозрачный) → текст и есть самый частый цвет
      const C = fg ? avg(fg) : avg(bg);
      return { c: Color.rgbToHex(...C), a: 1 };
    };
  },
  // настоящее имя шрифта: «ABCDEF+ArialMT» → Arial, «Montserrat-BoldItalic» → Montserrat, полужирный, курсив
  fontName(page, id, style) {
    let raw = '';
    try { const f = page.commonObjs.get(id); raw = f && (f.name || f.loadedName) || ''; } catch (e) { }
    raw = String(raw).replace(/^[A-Z]{6}\+/, '');
    const bold = /bold|black|heavy|semibold/i.test(raw), italic = /italic|oblique/i.test(raw);
    let fam = raw.split(/[-,]/)[0].replace(/(MT|PS|Std|Pro)$/,'').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    if (!fam || /^g_d\d/.test(fam)) fam = /serif/i.test((style && style.fontFamily) || '') && !/sans/i.test((style && style.fontFamily) || '') ? 'Times New Roman' : 'Arial';
    if (/^Times( New)?( Roman)?$/i.test(fam)) fam = 'Times New Roman';
    // если такого семейства нет, но есть похожее среди известных — берём его
    const known = Fonts.all().find(f => f.replace(/\s/g, '').toLowerCase() === fam.replace(/\s/g, '').toLowerCase());
    return { family: known || fam, bold, italic };
  },
  getObj(page, id) {
    return new Promise(res => {
      try {
        if (page.objs.has && page.objs.has(id)) return res(page.objs.get(id));
        page.objs.get(id, res);
        setTimeout(() => res(null), 3000);
      } catch (e) { res(null); }
    });
  },
  imageURL(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return c.toDataURL('image/png'); }
      const id = ctx.createImageData(img.width, img.height);
      const d = img.data, n = img.width * img.height;
      if (img.kind === 3 || d.length >= n * 4) id.data.set(d.subarray(0, n * 4));
      else if (img.kind === 2 || d.length >= n * 3) for (let i = 0; i < n; i++) { id.data[i * 4] = d[i * 3]; id.data[i * 4 + 1] = d[i * 3 + 1]; id.data[i * 4 + 2] = d[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
      else { // 1 бит на пиксель
        const rowBytes = (img.width + 7) >> 3;
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
          const v = d[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0, p = (y * img.width + x) * 4;
          id.data[p] = id.data[p + 1] = id.data[p + 2] = v; id.data[p + 3] = 255;
        }
      }
      ctx.putImageData(id, 0, 0);
      return c.toDataURL(img.width * img.height > 1e6 ? 'image/jpeg' : 'image/png', 0.92);
    } catch (e) { return null; }
  },
  // картинка страницы (для агента и как подложка)
  async render(buffer, pageNo = 1, dpi = 110) {
    const pdfjs = await Host.lib('pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    const page = await doc.getPage(Math.min(pageNo, doc.numPages));
    const vp = page.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    return { url: c.toDataURL('image/jpeg', 0.85), numPages: doc.numPages };
  },
  async text(buffer, maxPages = 30) {
    const pdfjs = await Host.lib('pdf');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out += `\n--- страница ${i} ---\n` + tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('');
    }
    return { text: out, numPages: doc.numPages };
  },
};

// накопитель контура в координатах PDF
class PathAcc {
  constructor() { this.subs = []; this.cur = null; }
  M(x, y) { this.cur = { closed: false, nodes: [Path.node(x, y)] }; this.subs.push(this.cur); }
  L(x, y) { if (!this.cur) this.M(x, y); this.cur.nodes.push(Path.node(x, y)); }
  C(x1, y1, x2, y2, x, y) { if (!this.cur) this.M(x1, y1); const l = this.cur.nodes[this.cur.nodes.length - 1]; l.ox = x1; l.oy = y1; const n = Path.node(x, y); n.ix = x2; n.iy = y2; this.cur.nodes.push(n); }
  Z() {
    if (!this.cur) return;
    const sp = this.cur, f = sp.nodes[0], l = sp.nodes[sp.nodes.length - 1];
    if (sp.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; sp.nodes.pop(); }
    sp.closed = true;
    const start = { x: f.x, y: f.y };
    this.cur = null;
    this._start = start;
  }
}
