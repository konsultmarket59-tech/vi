// PDF для типографии: цвета в CMYK (точные значения документа или пересчёт по профилю),
// вылеты (BleedBox), обрезной формат (TrimBox), метки реза, 100% чёрный с наложением,
// текст кривыми, картинки в CMYK. Собирается прямо из модели документа, без браузерной печати.
'use strict';

const PDFWriter = {
  // pages — страницы документа; opt: { cmyk, bleed, marks, overprintBlack, includeNoPrint, title, imageJpeg, dpiFallback }
  async build(pages, opt = {}) {
    const W = new PDFWriter.Doc(opt);
    // шрифты для текста кривыми
    const texts = [];
    for (const P of pages) Model.walkDoc({ pages: [P] }, o => { if (o.type === 'text') texts.push(o); });
    for (const t of texts) { try { await Fonts.otf(t.font, t.bold, t.italic); } catch (e) { } }
    for (const P of pages) await W.page(P);
    return W.finish();
  },

  Doc: class {
    constructor(opt) {
      this.opt = Object.assign({ cmyk: true, bleed: 0, marks: false, overprintBlack: true, includeNoPrint: false, imageJpeg: false }, opt);
      this.objs = [null]; // 1-based
      this.pages = [];
      this.gs = new Map(); this.imgCache = new Map();
      this.catalog = this.alloc(); this.pagesId = this.alloc();
    }
    alloc() { this.objs.push(null); return this.objs.length - 1; }
    set(id, body) { this.objs[id] = body; return id; }
    add(body) { const id = this.alloc(); this.objs[id] = body; return id; }
    stream(dict, data, compress = true) {
      let bytes = typeof data === 'string' ? PDFWriter.latin1(data) : data;
      let filter = dict.Filter;
      if (compress && !filter) { bytes = fflate.zlibSync(bytes, { level: 6 }); filter = '/FlateDecode'; }
      const d = Object.assign({}, dict, filter ? { Filter: filter } : {}, { Length: bytes.length });
      return this.add({ dict: d, bytes });
    }
    // ---------- страница ----------
    async page(P) {
      const o = this.opt, k = 72 / 25.4;
      const bleed = o.bleed || 0, markM = o.marks ? 10 : 0;
      const pad = bleed + markM; // мм вокруг обрезного формата
      const Wp = (P.w + pad * 2) * k, Hp = (P.h + pad * 2) * k;
      this.res = { ExtGState: {}, XObject: {}, Shading: {} };
      this.ops = [];
      this.pk = k;
      const op = s => this.ops.push(s);
      // базовая система координат: мм от левого верхнего угла обрезного формата, Y вниз
      op(`${pf(k)} 0 0 ${pf(-k)} ${pf(pad * k)} ${pf(Hp - pad * k)} cm`);
      this.base = [1, 0, 0, 1, 0, 0];
      // фон страницы — на вылеты
      if (P.color && P.color.toLowerCase() !== '#ffffff') { this.setFill(P.color); op(`${pf(-bleed)} ${pf(-bleed)} ${pf(P.w + bleed * 2)} ${pf(P.h + bleed * 2)} re f`); }
      for (const L of P.layers) {
        if (!L.visible || (L.noPrint && !o.includeNoPrint)) continue;
        for (const ob of L.objects) await this.obj(ob, [1, 0, 0, 1, 0, 0], 1);
      }
      if (o.marks) this.marks(P, bleed);
      const content = this.stream({}, this.ops.join('\n'));
      const res = this.resDict();
      const box = (x0, y0, x1, y1) => `[${pf(x0)} ${pf(y0)} ${pf(x1)} ${pf(y1)}]`;
      const trim = box(pad * k, pad * k, Wp - pad * k, Hp - pad * k), bl = box((pad - bleed) * k, (pad - bleed) * k, Wp - (pad - bleed) * k, Hp - (pad - bleed) * k);
      const pid = this.add({ dict: { Type: '/Page', Parent: `${this.pagesId} 0 R`, MediaBox: box(0, 0, Wp, Hp), BleedBox: bl, TrimBox: trim, CropBox: box(0, 0, Wp, Hp), Resources: res, Contents: `${content} 0 R` } });
      this.pages.push(pid);
    }
    resDict() {
      const r = this.res, part = (name, m) => Object.keys(m).length ? `/${name} <<${Object.entries(m).map(([k, v]) => `/${k} ${v} 0 R`).join(' ')}>>` : '';
      return `<< /ProcSet [/PDF /ImageC /ImageB] ${part('ExtGState', r.ExtGState)} ${part('XObject', r.XObject)} ${part('Shading', r.Shading)} >>`;
    }
    // ---------- цвет ----------
    cmykOf(hex) { return CMYK.of(hex); }
    colorOps(hex, stroke) {
      if (this.opt.cmyk) { const v = this.cmykOf(hex).map(x => pf(x / 100, 4)); return `${v.join(' ')} ${stroke ? 'K' : 'k'}`; }
      const { r, g, b } = Color.hexToRgb(hex); return `${pf(r / 255, 4)} ${pf(g / 255, 4)} ${pf(b / 255, 4)} ${stroke ? 'RG' : 'rg'}`;
    }
    setFill(hex) { this.ops.push(this.colorOps(hex, false)); }
    setStroke(hex) { this.ops.push(this.colorOps(hex, true)); }
    isK100(hex) { if (!this.opt.cmyk) return false; const v = this.cmykOf(hex); return v[0] < 0.5 && v[1] < 0.5 && v[2] < 0.5 && v[3] > 99.5; }
    gstate(ca, CA, op) {
      const key = [pf(ca, 3), pf(CA, 3), op ? 1 : 0].join('|');
      if (!this.gs.has(key)) {
        const d = { Type: '/ExtGState', ca: pf(ca, 3), CA: pf(CA, 3) };
        if (op) Object.assign(d, { OP: 'true', op: 'true', OPM: 1 });
        this.gs.set(key, { id: this.add({ dict: d }), name: 'G' + this.gs.size });
      }
      const g = this.gs.get(key);
      this.res.ExtGState[g.name] = g.id;
      this.ops.push(`/${g.name} gs`);
    }
    // ---------- геометрия ----------
    path(subs) {
      const out = [];
      for (const sp of subs) {
        if (!sp.nodes.length) continue;
        const n0 = sp.nodes[0];
        out.push(`${pf(n0.x)} ${pf(n0.y)} m`);
        for (const [i, j] of Path.segments(sp)) {
          const a = sp.nodes[i], b = sp.nodes[j];
          if (Path.isLineSeg(a, b)) out.push(`${pf(b.x)} ${pf(b.y)} l`);
          else out.push(`${pf(a.ox)} ${pf(a.oy)} ${pf(b.ix)} ${pf(b.iy)} ${pf(b.x)} ${pf(b.y)} c`);
        }
        if (sp.closed) out.push('h');
      }
      this.ops.push(out.join(' '));
    }
    // ---------- объекты ----------
    async obj(o, pm, alpha) {
      if (!o.visible) return;
      const a = alpha * (o.opacity ?? 1);
      if (a <= 0.001) return;
      const m = Mx.mul(pm, o.m || Mx.id());
      const cm = o.m && !Mx.isId(o.m) ? `${o.m.map(v => pf(v, 6)).join(' ')} cm` : '';
      if (o.type === 'group') {
        this.ops.push('q'); if (cm) this.ops.push(cm);
        for (const c of o.children) await this.obj(c, m, a);
        this.ops.push('Q'); return;
      }
      if (o.type === 'blend') {
        const [A, B] = o.children;
        this.ops.push('q'); if (cm) this.ops.push(cm);
        await this.obj(A, m, a);
        for (const x of Effects.blendItems(o)) await this.obj(x, m, a);
        await this.obj(B, m, a);
        this.ops.push('Q'); return;
      }
      if (o.type === 'powerclip') {
        const c = o.container, ccm = c.m && !Mx.isId(c.m) ? `${c.m.map(v => pf(v, 6)).join(' ')} cm` : '';
        this.ops.push('q'); if (cm) this.ops.push(cm);
        this.ops.push('q'); if (ccm) this.ops.push(ccm); await this.shape(c, a, { noStroke: true }); this.ops.push('Q');
        const cs = Model.toSubs(c);
        if (cs) {
          this.ops.push('q'); if (ccm) this.ops.push(ccm);
          this.path(cs); this.ops.push('W n');
          // клип задан в системе контейнера — возвращаемся к системе PowerClip
          const inv = Mx.inv(c.m || Mx.id()); this.ops.push(`${inv.map(v => pf(v, 6)).join(' ')} cm`);
          for (const ch of o.children) await this.obj(ch, m, a);
          this.ops.push('Q');
        }
        this.ops.push('q'); if (ccm) this.ops.push(ccm); await this.shape(c, a, { noFill: true }); this.ops.push('Q');
        this.ops.push('Q'); return;
      }
      // эффекты (контур, выдавливание) — части уже в системе родителя
      let parts = null;
      if (o.contour || o.extrude) parts = Effects.parts(o);
      if (parts) for (const it of parts.before) await this.shape({ type: 'path', subs: it.subs, fill: it.fill, stroke: Object.assign({ width: 0.2 }, it.stroke), m: Mx.id() }, a, {});
      this.ops.push('q'); if (cm) this.ops.push(cm);
      const ok = await this.shape(o, a, {});
      this.ops.push('Q');
      if (!ok) await this.raster(o, pm, a);
      if (parts) for (const it of parts.after) await this.shape({ type: 'path', subs: it.subs, fill: it.fill, stroke: Object.assign({ width: 0.2 }, it.stroke), m: Mx.id() }, a, {});
    }
    // один «листовой» объект в его собственной системе; false — не получилось нарисовать векторно
    async shape(o, alpha, opt) {
      if (o.type === 'image') return this.image(o, alpha);
      const subs = Model.toSubs(o);
      if (!subs) return o.type !== 'text';
      const fl = o.fill, st = o.stroke;
      const hasFill = !opt.noFill && fl && fl.type && fl.type !== 'none';
      const hasStroke = !opt.noStroke && st && st.color && st.width > 0;
      if (!hasFill && !hasStroke) return true;
      const even = o.type === 'path' || (o.envelope && o.type !== 'text');
      const ops = this.ops;
      if (hasFill && (fl.type === 'linear' || fl.type === 'radial')) {
        ops.push('q'); this.gstate(alpha, alpha, false);
        this.path(subs); ops.push(even ? 'W* n' : 'W n');
        this.gradient(fl, Path.bbox(subs));
        ops.push('Q');
      } else if (hasFill) {
        ops.push('q'); this.gstate(alpha, alpha, this.opt.overprintBlack && this.isK100(fl.color));
        this.setFill(fl.color); this.path(subs); ops.push(even ? 'f*' : 'f');
        ops.push('Q');
      }
      if (hasStroke) {
        ops.push('q'); this.gstate(alpha, alpha, this.opt.overprintBlack && this.isK100(st.color));
        this.setStroke(st.color);
        ops.push(`${pf(st.width, 4)} w`);
        const cap = st.dash === 'dot' ? 1 : ({ round: 1, square: 2 }[st.cap] || 0), join = ({ round: 1, bevel: 2 }[st.join] || 0);
        ops.push(`${cap} J ${join} j 4 M`);
        const d = Render.dash(st);
        if (d) ops.push(`[${d.split(/[ ,]+/).map(v => pf(+v, 4)).join(' ')}] 0 d`);
        this.path(subs); ops.push('S');
        ops.push('Q');
      }
      return true;
    }
    gradient(fl, bb) {
      const list = fl.stops && fl.stops.length > 1 ? fl.stops.map(s => ({ o: s.o, c: s.c })) : [{ o: 0, c: fl.color }, { o: 1, c: fl.color2 || '#ffffff' }];
      list.sort((x, y) => x.o - y.o);
      const comp = hex => this.opt.cmyk ? this.cmykOf(hex).map(v => pf(v / 100, 4)) : (({ r, g, b }) => [r, g, b].map(v => pf(v / 255, 4)))(Color.hexToRgb(hex));
      const fn = (a, b) => `<< /FunctionType 2 /Domain [0 1] /C0 [${comp(a).join(' ')}] /C1 [${comp(b).join(' ')}] /N 1 >>`;
      let func;
      if (list.length === 2) func = fn(list[0].c, list[1].c);
      else {
        const fns = [], bounds = [], enc = [];
        for (let i = 0; i < list.length - 1; i++) { fns.push(fn(list[i].c, list[i + 1].c)); if (i > 0) bounds.push(pf(list[i].o, 4)); enc.push('0 1'); }
        func = `<< /FunctionType 3 /Domain [${pf(list[0].o, 4)} ${pf(list[list.length - 1].o, 4)}] /Functions [${fns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${enc.join(' ')}] >>`;
      }
      const cs = this.opt.cmyk ? '/DeviceCMYK' : '/DeviceRGB';
      const bw = Math.max(1e-6, bb.x2 - bb.x1), bh = Math.max(1e-6, bb.y2 - bb.y1);
      let sh;
      if (fl.type === 'linear') sh = { ShadingType: 2, ColorSpace: cs, Coords: `[0 0.5 1 0.5]`, Function: func, Extend: '[true true]' };
      else { const cx = fl.cx ?? 0.5, cy = fl.cy ?? 0.5; sh = { ShadingType: 3, ColorSpace: cs, Coords: `[${pf(cx, 4)} ${pf(cy, 4)} 0 ${pf(cx, 4)} ${pf(cy, 4)} 0.5]`, Function: func, Extend: '[true true]' }; }
      const id = this.add({ dict: sh }), name = 'Sh' + id;
      this.res.Shading[name] = id;
      // система градиента: доли габарита, поворот вокруг центра (как в SVG)
      this.ops.push(`${pf(bw, 6)} 0 0 ${pf(bh, 6)} ${pf(bb.x1, 6)} ${pf(bb.y1, 6)} cm`);
      if (fl.type === 'linear' && fl.angle) {
        const r = -(fl.angle) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
        this.ops.push(`1 0 0 1 0.5 0.5 cm ${pf(c, 6)} ${pf(s, 6)} ${pf(-s, 6)} ${pf(c, 6)} 0 0 cm 1 0 0 1 -0.5 -0.5 cm`);
      }
      this.ops.push(`/${name} sh`);
    }
    async image(o, alpha) {
      let rec = this.imgCache.get(o.href);
      if (!rec) {
        const img = await Polza.loadImage(o.href);
        const w = img.naturalWidth, hh = img.naturalHeight;
        const c = document.createElement('canvas'); c.width = w; c.height = hh;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, w, hh).data;
        let hasAlpha = false; for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { hasAlpha = true; break; }
        let smask = null;
        if (hasAlpha) {
          const a = new Uint8Array(w * hh); for (let i = 0; i < w * hh; i++) a[i] = px[i * 4 + 3];
          smask = this.stream({ Type: '/XObject', Subtype: '/Image', Width: w, Height: hh, ColorSpace: '/DeviceGray', BitsPerComponent: 8 }, a);
        }
        let id;
        if (this.opt.cmyk) {
          const cm = CMYK.pixelsToCmyk(px);
          id = this.stream(Object.assign({ Type: '/XObject', Subtype: '/Image', Width: w, Height: hh, ColorSpace: '/DeviceCMYK', BitsPerComponent: 8 }, smask ? { SMask: `${smask} 0 R` } : {}), cm);
        } else if (!hasAlpha && this.opt.imageJpeg) {
          const jb = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
          id = this.stream({ Type: '/XObject', Subtype: '/Image', Width: w, Height: hh, ColorSpace: '/DeviceRGB', BitsPerComponent: 8, Filter: '/DCTDecode' }, new Uint8Array(await jb.arrayBuffer()), false);
        } else {
          const rgb = new Uint8Array(w * hh * 3); for (let i = 0; i < w * hh; i++) { rgb[i * 3] = px[i * 4]; rgb[i * 3 + 1] = px[i * 4 + 1]; rgb[i * 3 + 2] = px[i * 4 + 2]; }
          id = this.stream(Object.assign({ Type: '/XObject', Subtype: '/Image', Width: w, Height: hh, ColorSpace: '/DeviceRGB', BitsPerComponent: 8 }, smask ? { SMask: `${smask} 0 R` } : {}), rgb);
        }
        rec = { id, name: 'Im' + id };
        this.imgCache.set(o.href, rec);
      }
      this.res.XObject[rec.name] = rec.id;
      this.ops.push('q'); this.gstate(alpha, alpha, false);
      // единичный квадрат картинки — в прямоугольник w×h с учётом перевёрнутой оси Y
      this.ops.push(`${pf(o.w, 6)} 0 0 ${pf(-o.h, 6)} 0 ${pf(o.h, 6)} cm /${rec.name} Do Q`);
      if (o.stroke && o.stroke.color && o.stroke.width > 0) { this.ops.push('q'); this.setStroke(o.stroke.color); this.ops.push(`${pf(o.stroke.width, 4)} w 0 0 ${pf(o.w)} ${pf(o.h)} re S Q`); }
      return true;
    }
    // запасной путь: объект растром 600 dpi (например, текст без файла шрифта)
    async raster(o, pm, alpha) {
      const b = Model.worldBox(o, pm);
      if (!G.boxValid(b)) return;
      const w = b.x2 - b.x1, hh = b.y2 - b.y1;
      const defs = [];
      const body = Render.obj(o, defs, {});
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}mm" height="${hh}mm" viewBox="${b.x1} ${b.y1} ${w} ${hh}"><style>${Fonts.cssFor({ pages: [{ layers: [{ objects: [o] }] }] })}</style><defs>${defs.join('')}</defs><g transform="${Mx.str(pm)}">${body}</g></svg>`;
      const dpi = Math.min(600, 8000 / Math.max(w, hh) * 25.4);
      const { blob } = await IO.rasterize(svg, w, hh, dpi, 'png');
      const href = await Polza.dataURL(blob);
      const fake = { href, w, h: hh, stroke: null };
      // растр уже учитывает матрицу родителей — рисуем в системе страницы
      this.ops.push('q', `${Mx.inv(pm).map(v => pf(v, 6)).join(' ')} cm`, `1 0 0 1 ${pf(b.x1, 6)} ${pf(b.y1, 6)} cm`);
      await this.image(fake, alpha);
      this.ops.push('Q');
    }
    marks(P, bleed) {
      const o = this.ops, L = 5, gap = bleed + 2;
      o.push('q 0.25 w', this.opt.cmyk ? '1 1 1 1 K' : '0 0 0 RG');
      const line = (x1, y1, x2, y2) => o.push(`${pf(x1)} ${pf(y1)} m ${pf(x2)} ${pf(y2)} l S`);
      for (const [x, sx] of [[0, -1], [P.w, 1]]) for (const [y, sy] of [[0, -1], [P.h, 1]]) {
        line(x + sx * gap, y, x + sx * (gap + L), y);
        line(x, y + sy * gap, x, y + sy * (gap + L));
      }
      o.push('Q');
    }
    // ---------- сборка файла ----------
    finish() {
      const title = this.opt.title || 'Вектор';
      const info = this.add({ dict: { Producer: PDFWriter.utf16('Вектор'), Title: PDFWriter.utf16(title), CreationDate: `(D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)})` } });
      this.set(this.pagesId, { dict: { Type: '/Pages', Kids: `[${this.pages.map(p => p + ' 0 R').join(' ')}]`, Count: this.pages.length } });
      this.set(this.catalog, { dict: { Type: '/Catalog', Pages: `${this.pagesId} 0 R` } });
      const chunks = [], offs = [];
      let pos = 0;
      const push = b => { const u = typeof b === 'string' ? PDFWriter.latin1(b) : b; chunks.push(u); pos += u.length; };
      push('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n');
      for (let i = 1; i < this.objs.length; i++) {
        offs[i] = pos;
        const ob = this.objs[i];
        push(`${i} 0 obj\n${PDFWriter.dict(ob.dict)}\n`);
        if (ob.bytes) { push('stream\n'); push(ob.bytes); push('\nendstream\n'); }
        push('endobj\n');
      }
      const xref = pos;
      let x = `xref\n0 ${this.objs.length}\n0000000000 65535 f \n`;
      for (let i = 1; i < this.objs.length; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
      push(x);
      push(`trailer\n<< /Size ${this.objs.length} /Root ${this.catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const out = new Uint8Array(pos); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
      return out;
    }
  },
  dict(d) { return '<< ' + Object.entries(d).map(([k, v]) => `/${k} ${v}`).join(' ') + ' >>'; },
  latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; },
  utf16(s) { let h = 'FEFF'; for (const ch of s) { const c = ch.charCodeAt(0); h += c.toString(16).padStart(4, '0').toUpperCase(); } return `<${h}>`; },
};
function pf(v, d = 3) { const r = +(+v).toFixed(d); return Object.is(r, -0) ? '0' : String(r); }
