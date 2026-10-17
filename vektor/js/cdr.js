// Чтение файлов CorelDRAW (.cdr, .cdt, шаблоны) версий 3 … 2024 без самого CorelDRAW.
// Перенос разборщика libcdr (LibreOffice, MPL 2.0) на JavaScript: записи RIFF, сжатые
// списки, контейнеры X4+ (ZIP) и внешние потоки X6+; фигуры, кривые, заливки,
// абрисы, градиенты, текст, растровые изображения, страницы и группы.
// Как производная от libcdr, этот файл распространяется на условиях Mozilla Public License 2.0
// (https://mozilla.org/MPL/2.0/).
'use strict';

const CDR = (() => {
  const FOURCC = s => s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24) >>> 0;
  const F = {};
  for (const k of ['RIFF', 'LIST', 'cmpr', 'CPng', 'page', 'obj ', 'grp ', 'lnkg', 'vect', 'clpt', 'stlt', 'DISP', 'loda', 'lobj', 'vrsn', 'trfd', 'outl', 'fild', 'fill', 'arrw', 'flgs', 'mcfg', 'bmp ', 'bmpf', 'ppdt', 'ftil', 'iccd', 'bbox', 'spnd', 'uidr', 'vpat', 'font', 'txsm', 'udta', 'styd']) F[k.trim() || k] = FOURCC(k);
  F.obj = FOURCC('obj '); F.grp = FOURCC('grp '); F.bmp = FOURCC('bmp ');

  const versionFromChar = c => c === 0x20 ? 300 : c < 0x31 ? 0 : c < 0x3a ? 100 * (c - 0x30) : c < 0x41 ? 0 : 100 * (c - 0x37);

  class EOS extends Error { }

  // ---------- поток байтов ----------
  class Reader {
    constructor(u8) { this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.pos = 0; }
    get length() { return this.u8.length; }
    isEnd() { return this.pos >= this.u8.length; }
    remaining() { return Math.max(0, this.u8.length - this.pos); }
    need(n) { if (this.pos + n > this.u8.length) throw new EOS('end of stream'); }
    seek(n, whence = 'cur') { this.pos = whence === 'set' ? n : this.pos + n; if (this.pos < 0) this.pos = 0; }
    u8r() { this.need(1); return this.u8[this.pos++]; }
    u16() { this.need(2); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
    s16() { this.need(2); const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
    u32() { this.need(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
    s32() { this.need(4); const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
    u64lo() { this.need(8); const v = this.dv.getUint32(this.pos, true); this.pos += 8; return v; }
    f64() { this.need(8); const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
    fixed() { const fr = this.u16(), i = this.s16(); return i + fr / 65536; }
    bytes(n) { n = Math.min(n, this.remaining()); const b = this.u8.subarray(this.pos, this.pos + n); this.pos += n; return b; }
    sub(n) { return new Reader(this.bytes(n)); }
  }

  const inflate = (u8) => { try { return fflate.unzlibSync(u8); } catch (e) { try { return fflate.inflateSync(u8); } catch (e2) { return new Uint8Array(0); } } };

  // ---------- цвет ----------
  const pal = (name) => {
    const s = window.CDR_PALETTES && window.CDR_PALETTES[name];
    if (!s) return null;
    if (typeof s !== 'string') return s;
    const a = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    window.CDR_PALETTES[name] = a;
    return a;
  };
  const labToRgb = (L, a, b) => {
    let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
    const f = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
    x = 0.96422 * f(x); y = f(y); z = 0.82521 * f(z);
    // D50 → sRGB (Брэдфорд)
    let r = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z, g = -0.9787684 * x + 1.9161415 * y + 0.0334540 * z, bl = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
    const gam = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return [gam(r), gam(g), gam(bl)];
  };
  const hex = (r, g, b) => Color.rgbToHex(r, g, b);

  // ---------- геометрия: кривые в пространстве объекта ----------
  class PathB {
    constructor() { this.subs = []; this.cur = null; this.closedAny = false; }
    get empty() { return !this.subs.length; }
    M(x, y) { this.cur = { closed: false, nodes: [Path.node(x, y)] }; this.subs.push(this.cur); }
    ensure() { if (!this.cur) this.M(0, 0); }
    last() { return this.cur.nodes[this.cur.nodes.length - 1]; }
    L(x, y) { this.ensure(); this.cur.nodes.push(Path.node(x, y)); }
    C(x1, y1, x2, y2, x, y) { this.ensure(); const l = this.last(); l.ox = x1; l.oy = y1; const n = Path.node(x, y); n.ix = x2; n.iy = y2; this.cur.nodes.push(n); }
    Q(qx, qy, x, y) { this.ensure(); const l = this.last(); this.C(l.x + 2 / 3 * (qx - l.x), l.y + 2 / 3 * (qy - l.y), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y); }
    A(rx, ry, rot, large, sweep, x, y) { this.ensure(); const l = this.last(); for (const c of Path.arcToCubics(l.x, l.y, rx, ry, rot, large ? 1 : 0, sweep ? 1 : 0, x, y)) this.C(...c); }
    Z() { if (this.cur) { this.cur.closed = true; this.closedAny = true; this.cur = null; } }
    append(other) { for (const sp of other.subs) this.subs.push(structuredClone(sp)); this.cur = null; this.closedAny = this.closedAny || other.closedAny; }
    transform(m) { Path.transform(this.subs, m); }
    // B-сплайн 3-й степени → кривые Безье (алгоритм DecomposeCurve, Пигл и Тиллер)
    spline(pts) {
      const D = 3, n = pts.length;
      if (n < 4) { for (const p of pts.slice(1)) this.L(p[0], p[1]); return; }
      const knot = i => i < D ? 0 : i > n ? n - D : i - D;
      const m = n + D + 1;
      let a = D, b = D + 1;
      let Qw = pts.slice(0, D + 1).map(p => [p[0], p[1]]), Next = new Array(D + 1).fill(0).map(() => [0, 0]);
      while (b < m) {
        let i = b;
        while (b < m && knot(b + 1) === knot(b)) b++;
        const mult = b - i + 1;
        if (mult < D) {
          const numer = knot(b) - knot(a);
          const alphas = {};
          for (let j = D; j > mult; j--) alphas[j - mult - 1] = numer / (knot(a + j) - knot(a));
          const r = D - mult;
          for (let j = 1; j <= r; j++) {
            const save = r - j, s = mult + j;
            for (let k = D; k >= s; k--) { const al = alphas[k - s]; Qw[k] = [al * Qw[k][0] + (1 - al) * Qw[k - 1][0], al * Qw[k][1] + (1 - al) * Qw[k - 1][1]]; }
            if (b < m) Next[save] = [Qw[D][0], Qw[D][1]];
          }
        }
        this.C(Qw[1][0], Qw[1][1], Qw[2][0], Qw[2][1], Qw[3][0], Qw[3][1]);
        [Qw, Next] = [Next, Qw];
        if (b < m) {
          for (i = D - mult; i <= D; i++) { const p = pts[b - D + i]; if (p) Qw[i] = [p[0], p[1]]; }
          a = b; b++;
        }
      }
    }
  }

  // ---------- разборщик (как CDRParser) ----------
  class Parser {
    constructor(ext, col) { this.ext = ext; this.col = col; this.version = 0; this.prec = 0; this.fonts = {}; this.fills = {}; this.lines = {}; this.arrows = {}; }
    coord(r) { if (!this.prec) throw new Error('precision'); return this.prec === 16 ? r.s16() / 1000 : r.s32() / 254000; }
    uns(r) { return this.prec === 16 ? r.u16() : r.u32(); }
    int(r) { return this.prec === 16 ? r.s16() : r.s32(); }
    ushort(r) { return this.prec === 16 ? r.u8r() : r.u16(); }
    angle(r) { return this.prec === 16 ? Math.PI * r.s16() / 1800 : Math.PI * r.s32() / 180000000; }
    rectCoord(r) { return this.version < 1500 ? this.coord(r) : r.f64() / 254000; }

    parseRecords(r, blocks = [], level = 0) {
      if (level > 64) return false;
      this.col.level(level);
      while (!r.isEnd()) if (!this.parseRecord(r, blocks, level)) return false;
      return true;
    }
    parseRecord(r, blocks, level) {
      try {
        this.col.level(level);
        while (!r.isEnd() && r.u8r() === 0) { /* выравнивание */ }
        if (r.isEnd()) return true;
        r.seek(-1);
        let fourCC = r.u32() >>> 0;
        let length = r.u32();
        if (blocks.length > length) length = blocks[length];
        const position = r.pos;
        let listType = 0;
        if (fourCC === F.RIFF || fourCC === F.LIST) {
          listType = r.u32() >>> 0;
          if (listType === F.stlt && this.version >= 700) fourCC = listType;
          else this.col.otherList();
        }
        if (fourCC === F.RIFF || fourCC === F.LIST) {
          let cmprsize = length - 4;
          if (listType === F.cmpr) {
            cmprsize = r.u32(); r.seek(12);
            if ((r.u32() >>> 0) !== F.CPng) return false;
            if (r.u16() !== 1 || r.u16() !== 4) return false;
          } else if (listType === F.page) this.col.page(level);
          else if (listType === F.obj) this.col.object(level);
          else if (listType === F.grp || listType === F.lnkg) this.col.group(level);
          else if ((listType & 0xffffff) === 0x524443 || (listType & 0xffffff) === 0x726463) {
            this.version = versionFromChar((listType >>> 24) & 0xff);
            this.prec = this.version < 600 ? 16 : 32;
          } else if (listType === F.vect || listType === F.clpt) this.col.vect(level);
          if (listType !== F.cmpr) {
            if (!this.parseRecords(r.sub(cmprsize), blocks, level + 1)) return false;
          } else {
            const data = inflate(r.bytes(cmprsize));
            const blocksLen = length + position - r.pos;
            const bl = new Reader(inflate(r.bytes(blocksLen)));
            const lens = [];
            while (bl.remaining() >= 4) lens.push(bl.u32());
            if (!this.parseRecords(new Reader(data), lens, level + 1)) return false;
          }
        } else this.readRecord(fourCC, length, r.sub(Math.min(length, r.remaining())));
        r.seek(position + length, 'set');
        return true;
      } catch (e) {
        if (!(e instanceof EOS)) console.warn('CDR запись', e);
        return false;
      }
    }
    readRecord(fourCC, length, r) {
      try {
        switch (fourCC) {
          case F.loda: case F.lobj: this.readLoda(r, length); break;
          case F.vrsn: this.readVersion(r, length); break;
          case F.trfd: this.readTrfd(r, length); break;
          case F.outl: this.readOutl(r, length); break;
          case F.fild: case F.fill: this.readFild(r, length); break;
          case F.arrw: this.readArrw(r, length); break;
          case F.flgs: { const x = this.redirect(r, length); this.col.flags(x.r.u32(), this.version >= 400); break; }
          case F.mcfg: this.readMcfg(r, length); break;
          case F.bmp: this.readBmp(r, length); break;
          case F.ppdt: this.readPpdt(r, length); break;
          case F.ftil: break;
          case F.bbox: { const x = this.redirect(r, length); const x0 = this.coord(x.r), y0 = this.coord(x.r), x1 = this.coord(x.r), y1 = this.coord(x.r); this.col.bbox(x0, y0, x1, y1); break; }
          case F.spnd: { const x = this.redirect(r, length); this.col.spnd(this.uns(x.r)); break; }
          case F.uidr: { const x = this.redirect(r, length); const id = x.r.u32(); x.r.u32(); x.r.seek(36); this.col.paletteEntry(id, this.readColor(x.r)); break; }
          case F.font: this.readFont(r, length); break;
          case F.stlt: this.readStlt(r, length); break;
          case F.txsm: this.readTxsm(r, length); break;
          case F.styd: this.readStyd(r); break;
          default: break;
        }
      } catch (e) { if (!(e instanceof EOS)) console.warn('CDR запись', String.fromCharCode(fourCC & 255, (fourCC >> 8) & 255, (fourCC >> 16) & 255, fourCC >>> 24), e); }
    }
    // X6+: содержимое записи может лежать во внешнем файле архива
    redirect(r, length) {
      if (this.version >= 1600 && length === 0x10) {
        const n = r.u32() >>> 0; const len = r.u32();
        if (n < this.ext.length) {
          const off = r.u32();
          const s = this.ext[n];
          if (!s) throw new EOS('no stream');
          const rr = new Reader(s); rr.seek(off, 'set');
          return { r: rr, length: len };
        }
        if (n === 0xffffffff) return { r, length };
        throw new EOS('bad redirect');
      }
      return { r, length };
    }
    readColor(r) {
      const c = { model: 0, palette: 0, value: 0 };
      if (this.version >= 500) {
        c.model = r.u16();
        if (c.model === 0x01 && this.version >= 1300) c.model = 0x19;
        if (c.model === 0x1e) { c.model = 0x19; c.palette = 0x1e; }
        else { c.palette = r.u16(); r.seek(4); }
        c.value = r.u32() >>> 0;
      } else if (this.version >= 400) {
        c.model = r.u16();
        const C = r.u16(), M = r.u16(), Y = r.u16(), K = r.u16();
        c.value = ((K & 0xff) << 24 | (Y & 0xff) << 16 | (M & 0xff) << 8 | (C & 0xff)) >>> 0;
        r.seek(2);
      } else { c.model = r.u8r(); c.value = r.u32() >>> 0; }
      CDR.resolvePalette(c);
      return c;
    }
    readVersion(r, length) { const x = this.redirect(r, length); this.version = x.r.u16(); this.prec = this.version < 600 ? 16 : 32; }
    readMcfg(r, length) {
      const x = this.redirect(r, length); r = x.r;
      if (this.version >= 1300) r.seek(12); else if (this.version >= 900) r.seek(4); else if (this.version < 700 && this.version >= 600) r.seek(0x1c);
      let w, h;
      if (this.version < 400) { r.seek(2); const x0 = this.coord(r), y0 = this.coord(r), x1 = this.coord(r), y1 = this.coord(r); w = Math.abs(x1 - x0); h = Math.abs(y1 - y0); }
      else { w = this.coord(r); h = this.coord(r); }
      this.col.pageSize(w, h, -w / 2, -h / 2);
    }
    readTrfd(r, length) {
      const x = this.redirect(r, length); r = x.r; length = x.length;
      const start = r.pos;
      if (start >= r.length) return;
      if (length > r.length - start) length = r.length - start;
      const chunkLength = this.uns(r);
      let numArgs = this.uns(r);
      const startArgs = this.uns(r);
      if (startArgs >= length) return;
      numArgs = Math.min(numArgs, Math.floor((length - startArgs) / 4));
      r.seek(start + startArgs, 'set');
      const offs = []; for (let i = 0; i < numArgs; i++) offs.push(this.uns(r));
      const trafos = [];
      for (const off of offs) {
        r.seek(start + off, 'set');
        if (this.version >= 1300) r.seek(8);
        const t = r.u16();
        if (t === 0x08) {
          let v0, v1, x0, v3, v4, y0;
          if (this.version >= 600) r.seek(6);
          if (this.version >= 500) {
            v0 = r.f64(); v1 = r.f64(); x0 = r.f64() / (this.version < 600 ? 1000 : 254000);
            v3 = r.f64(); v4 = r.f64(); y0 = r.f64() / (this.version < 600 ? 1000 : 254000);
          } else {
            v0 = r.fixed(); v1 = r.fixed(); x0 = r.s32() / 1000; v3 = r.fixed(); v4 = r.fixed(); y0 = r.s32() / 1000;
          }
          trafos.push([v0, v3, v1, v4, x0, y0]); // в виде матрицы [a b c d e f]
        }
      }
      if (trafos.length) this.col.transform(trafos, this.version < 400);
      r.seek(start + chunkLength, 'set');
    }
    readFild(r, length) {
      const x = this.redirect(r, length); r = x.r;
      const id = r.u32() >>> 0;
      if (this.version >= 1300) r.seek(8);
      let type = r.u16();
      const st = { type, c1: null, c2: null, grad: null, image: null };
      const v = this.version;
      if (type === 1) { r.seek(v >= 1300 ? 13 : 2); st.c1 = this.readColor(r); }
      else if (type === 2) {
        r.seek(v >= 1300 ? 8 : 2);
        const g = { type: r.u8r(), stops: [], angle: 0, cx: 0, cy: 0, edge: 0 };
        if (v >= 1300) { r.seek(17); g.edge = r.s16(); } else if (v >= 600) { r.seek(19); g.edge = r.s32(); } else { r.seek(11); g.edge = r.s16(); }
        g.angle = this.angle(r); g.cx = this.int(r); g.cy = this.int(r);
        if (v >= 600) r.seek(2);
        g.mode = this.uns(r) & 0xff; g.mid = r.u8r() / 100; r.seek(1);
        const n = this.uns(r) & 0xffff;
        if (v >= 1300) r.seek(3);
        for (let i = 0; i < n; i++) {
          const color = this.readColor(r);
          if (v >= 1500) r.seek(26); else if (v >= 1300) r.seek(5);
          const off = (this.uns(r) & 0xffff) / 100;
          if (v >= 1300) r.seek(3);
          g.stops.push({ color, off });
        }
        st.grad = g;
      } else if (type === 7) {
        r.seek(v >= 1300 ? 8 : 2);
        r.u32(); this.int(r); this.int(r);
        if (v < 900) r.seek(4); else r.seek(4);
        r.u16(); r.u8r();
        r.seek(v >= 1300 ? 6 : 1);
        st.c1 = this.readColor(r);
        if (v >= 1600) r.seek(31); else if (v >= 1300) r.seek(10);
        st.c2 = this.readColor(r);
      } else if (type === 9 || type === 10 || type === 11) {
        if (type !== 11 || true) {
          if (v >= 1300) { this.skipX3(r); r.seek(-4); } else r.seek(2);
          let pid = type === 11 ? r.u32() : this.uns(r);
          if (type !== 11 || v >= 600) {
            this.uns(r); this.uns(r);
            r.seek(4); r.u16(); r.u8r();
            r.seek(v >= 1300 ? 17 : 21);
            if (v >= 600) pid = this.uns(r);
          }
          st.image = { id: pid };
        }
        if (v < 600 && (type === 9 || type === 11)) st.type = type = 10;
      }
      this.fills[id] = st;
      this.col.fillStyle(id, st);
    }
    skipX3(r) {
      if (this.version < 1300) return;
      for (;;) {
        const t = r.u32();
        if (t === 0x640) { r.seek(r.u32()); } else if (t === 0x514) r.seek(4); else { r.seek(-4); return; }
      }
    }
    readOutl(r, length) {
      const x = this.redirect(r, length); r = x.r;
      const id = r.u32() >>> 0;
      const v = this.version;
      if (v >= 1300) { let i = 0, l = 0; while (i !== 1) { r.seek(l); i = r.u32(); l = r.u32(); } }
      const lineType = r.u16(), caps = r.u16(), join = r.u16();
      if (v < 1300 && v >= 600) r.seek(2);
      const width = this.coord(r);
      const stretch = r.u16() / 100;
      if (v >= 600) r.seek(2);
      this.angle(r);
      if (v >= 1300) r.seek(46); else if (v >= 600) r.seek(52);
      const color = this.readColor(r);
      r.seek(v < 600 ? 10 : 16);
      let nd = r.u16(); nd = Math.min(nd, Math.floor(r.remaining() / 2));
      const fix = r.pos;
      const dash = []; for (let i = 0; i < nd; i++) dash.push(r.u16());
      r.seek(fix + (v < 600 ? 20 : 22), 'set');
      const sm = r.remaining() >= 4 ? r.u32() : 0, em = r.remaining() >= 4 ? r.u32() : 0;
      const st = { lineType, caps, join, width, stretch, color, dash, start: !!this.arrows[sm], end: !!this.arrows[em] };
      this.lines[id] = st;
      this.col.lineStyle(id, st);
    }
    readArrw(r, length) {
      if (this.version < 600) return;
      const x = this.redirect(r, length); r = x.r;
      this.arrows[r.u32() >>> 0] = true;
    }
    readLoda(r, length) {
      const x = this.redirect(r, length); r = x.r; length = x.length;
      const start = r.pos;
      if (start >= r.length) return;
      if (length > r.length - start) length = r.length - start;
      const chunkLength = this.uns(r);
      let numArgs = this.uns(r);
      const startArgs = this.uns(r);
      if (startArgs >= length) return;
      const startTypes = this.uns(r);
      if (startTypes >= length) return;
      numArgs = Math.min(numArgs, Math.floor((length - startArgs) / 4));
      const chunkType = this.uns(r);
      if (chunkType === 0x26) this.col.spline();
      r.seek(start + startArgs, 'set');
      const offs = []; for (let i = 0; i < numArgs; i++) offs.push(this.uns(r));
      r.seek(start + startTypes, 'set');
      const types = new Array(numArgs);
      for (let i = numArgs; i > 0; i--) types[i - 1] = this.uns(r);
      const v = this.version;
      for (let i = 0; i < numArgs; i++) {
        r.seek(start + offs[i], 'set');
        const t = types[i];
        try {
          if (t === 0x1e) {
            if ((v >= 400 && chunkType === 1) || (v < 400 && chunkType === 0)) this.readRect(r);
            else if ((v >= 400 && chunkType === 2) || (v < 400 && chunkType === 1)) this.readEllipse(r);
            else if ((v >= 400 && chunkType === 3) || (v < 400 && chunkType === 2)) this.readLineCurve(r);
            else if (chunkType === 0x25) this.readPath(r);
            else if ((v >= 400 && chunkType === 4) || (v < 400 && chunkType === 3)) { const X = this.coord(r), Y = this.coord(r); this.col.artisticText(X, Y); }
            else if ((v >= 400 && chunkType === 5) || (v < 400 && chunkType === 4)) this.readBitmap(r);
            else if ((v >= 400 && chunkType === 6) || (v < 400 && chunkType === 5)) { r.seek(4); const w = this.coord(r), h = this.coord(r); this.col.paragraphText(w, h); }
            else if (chunkType === 0x14) this.readPolygonCoords(r);
          } else if (t === 0x14) { if (v >= 400) { const id = r.u32() >>> 0; if (id) this.col.fillId(id); } }
          else if (t === 0x0a) { if (v >= 400) { const id = r.u32() >>> 0; if (id) this.col.lineId(id); } }
          else if (t === 0xc8) { const id = this.uns(r); if (id) this.col.styleId(id); }
          else if (t === 0x2af8) this.readPolygonTransform(r);
          else if (t === 0x1f40) { r.seek(v < 1300 ? 10 : 14); this.col.opacity(r.u16() / 1000); }
          else if (t === 0x4aba) { const w = this.coord(r), h = this.coord(r); this.col.pageSize(w, h, -w / 2, -h / 2); }
        } catch (e) { if (!(e instanceof EOS)) console.warn('CDR loda', e); }
      }
      r.seek(start + chunkLength, 'set');
    }
    points(r, n) {
      const pts = [], types = [];
      for (let j = 0; j < n; j++) pts.push([this.coord(r), this.coord(r)]);
      for (let k = 0; k < n; k++) types.push(r.u8r());
      return { pts, types };
    }
    // как CommonParser::processPath
    outputPath(pts, types) { const p = new PathB(); CDR.processPath(pts, types, p); this.col.path(p); }
    readLineCurve(r) {
      let n = r.u16();
      const ps = 2 * (this.prec === 16 ? 2 : 4) + 1;
      r.seek(2);
      n = Math.min(n, Math.floor(r.remaining() / ps));
      const { pts, types } = this.points(r, n);
      this.outputPath(pts, types);
    }
    readPath(r) {
      r.seek(4);
      let n = r.u16() + r.u16();
      const ps = 2 * (this.prec === 16 ? 2 : 4) + 1, max = r.remaining();
      n = max < 16 ? 0 : Math.min(n, Math.floor((max - 16) / ps));
      r.seek(16);
      const { pts, types } = this.points(r, n);
      this.outputPath(pts, types);
    }
    readPolygonCoords(r) {
      let n = r.u16();
      const ps = 2 * (this.prec === 16 ? 2 : 4) + 1;
      n = Math.min(n, Math.floor(r.remaining() / ps));
      r.seek(2);
      const { pts, types } = this.points(r, n);
      this.outputPath(pts, types);
      this.col.polygon();
    }
    readPolygonTransform(r) {
      if (this.version < 1300) r.seek(4);
      const numAngles = r.u32();
      let next = r.u32();
      if (next <= 1) next = r.u32(); else r.seek(4);
      if (this.version >= 1300) r.seek(4);
      const rx = r.f64(), ry = r.f64(), cx = this.coord(r), cy = this.coord(r);
      this.col.polygonTransform({ numAngles, next, rx, ry, cx, cy });
    }
    readPpdt(r, length) {
      const x = this.redirect(r, length); r = x.r;
      let n = r.u16();
      const ps = 2 * (this.prec === 16 ? 2 : 4) + 4;
      n = Math.min(n, Math.floor(r.remaining() / ps));
      r.seek(4);
      const pts = []; for (let j = 0; j < n; j++) pts.push([this.coord(r), this.coord(r)]);
      const knots = []; for (let k = 0; k < n; k++) knots.push(r.u32());
      this.col.ppdt(pts, knots);
    }
    readRect(r) {
      const v = this.version;
      const x0 = this.rectCoord(r), y0 = this.rectCoord(r);
      let r0 = 0, r1 = 0, r2 = 0, r3 = 0, ct = 0, sx = 1, sy = 1;
      if (v < 1500) {
        r3 = this.rectCoord(r);
        r2 = v < 900 ? r3 : this.rectCoord(r); r1 = v < 900 ? r3 : this.rectCoord(r); r0 = v < 900 ? r3 : this.rectCoord(r);
      } else {
        let s = r.f64(); if (Math.abs(s) > 1e-9) sx = s;
        s = r.f64(); if (Math.abs(s) > 1e-9) sy = s;
        const scaleWith = r.u8r(); r.seek(7);
        if (scaleWith === 0) {
          r3 = r.f64(); ct = r.u8r(); r.seek(15); r2 = r.f64(); r.seek(16); r1 = r.f64(); r.seek(16); r0 = r.f64();
          const w = Math.abs(x0 * sx / 2), h = Math.abs(y0 * sy / 2), mn = Math.min(w, h);
          r3 *= mn; r2 *= mn; r1 *= mn; r0 *= mn;
        } else {
          r3 = this.rectCoord(r); ct = r.u8r(); r.seek(15); r2 = this.rectCoord(r); r.seek(16); r1 = this.rectCoord(r); r.seek(16); r0 = this.rectCoord(r);
        }
      }
      const p = new PathB();
      const corner = (cx, cy, ex, ey) => { if (ct === 0) p.Q(cx, cy, ex, ey); else if (ct === 1) p.Q(...this._inner, ex, ey); else p.L(ex, ey); };
      if (r0 > 0) p.M(0, -r0 / sy); else p.M(0, 0);
      if (r1 > 0) { p.L(0, y0 + r1 / sy); this._inner = [r1 / sx, y0 + r1 / sy]; corner(0, y0, r1 / sx, y0); } else p.L(0, y0);
      if (r2 > 0) { p.L(x0 - r2 / sx, y0); this._inner = [x0 - r2 / sx, y0 + r2 / sy]; corner(x0, y0, x0, y0 + r2 / sy); } else p.L(x0, y0);
      if (r3 > 0) { p.L(x0, -r3 / sy); this._inner = [x0 - r3 / sx, -r3 / sy]; corner(x0, 0, x0 - r3 / sx, 0); } else p.L(x0, 0);
      if (r0 > 0) { p.L(r0 / sx, 0); this._inner = [r0 / sx, -r0 / sy]; corner(0, 0, 0, -r0 / sy); } else p.L(0, 0);
      p.Z();
      this.col.path(p);
    }
    readEllipse(r) {
      const x = this.coord(r), y = this.coord(r);
      let a1 = this.angle(r), a2 = this.angle(r);
      const pie = this.uns(r) !== 0;
      const cx = x / 2, cy = y / 2, rx = Math.abs(cx), ry = Math.abs(cy);
      const norm = a => { a %= 2 * Math.PI; return a < 0 ? a + 2 * Math.PI : a; };
      a1 = norm(a1); a2 = norm(a2);
      const p = new PathB();
      if (Math.abs(a1 - a2) > 1e-9) {
        if (a2 < a1) a2 += 2 * Math.PI;
        const x0 = cx + rx * Math.cos(a1), y0 = cy - ry * Math.sin(a1), x1 = cx + rx * Math.cos(a2), y1 = cy - ry * Math.sin(a2);
        p.M(x0, y0); p.A(rx, ry, 0, a2 - a1 > Math.PI, false, x1, y1);
        if (pie) { p.L(cx, cy); p.L(x0, y0); p.Z(); }
      } else {
        a2 += Math.PI / 2;
        const x0 = cx + rx * Math.cos(a1), y0 = cy - ry * Math.sin(a1), x1 = cx + rx * Math.cos(a2), y1 = cy - ry * Math.sin(a2);
        p.M(x0, y0); p.A(rx, ry, 0, false, false, x1, y1); p.A(rx, ry, 0, true, false, x0, y0); p.Z();
      }
      this.col.path(p);
    }
    readBitmap(r) {
      let x1 = 0, y1 = 0, x2 = 0, y2 = 0, id = 0;
      const v = this.version;
      if (v < 600) {
        x1 = this.coord(r); y1 = this.coord(r);
        if (v < 400) r.seek(2);
        r.seek(8); id = this.uns(r); r.seek(20);
        const p = new PathB(); p.M(x1, y1); p.L(x1, y2); p.L(x2, y2); p.L(x2, y1); p.L(x1, y1); this.col.path(p);
      } else {
        x1 = this.coord(r); y1 = this.coord(r); x2 = this.coord(r); y2 = this.coord(r);
        r.seek(32);
        id = this.uns(r);
        r.seek(v < 800 ? 8 : v < 900 ? 12 : 20);
        let n = r.u16(); r.seek(2);
        const ps = 2 * (this.prec === 16 ? 2 : 4) + 1;
        n = Math.min(n, Math.floor(r.remaining() / ps));
        this.points(r, n); // контур рамки изображения — не рисуем, только рамка ниже
      }
      this.col.bitmap(id >>> 0, x1, x2, y1, y2);
    }
    readBmp(r, length) {
      const x = this.redirect(r, length); r = x.r; length = x.length;
      const id = this.uns(r) >>> 0;
      const v = this.version;
      if (v < 500) {
        if (r.u8r() !== 0x42 || r.u8r() !== 0x4d) return;
        const len = r.u32(); r.seek(-6);
        this.col.bmpFile(id, r.bytes(len)); return;
      }
      r.seek(v < 600 ? 14 : v < 700 ? 46 : 50);
      const model = r.u32(); r.seek(4);
      const w = r.u32(), h = r.u32(); r.seek(4);
      const bpp = r.u32(); r.seek(4);
      const size = r.u32(); r.seek(32);
      const palette = [];
      if (bpp < 24 && model !== 5 && model !== 6) {
        r.seek(2);
        let n = r.u16(); n = Math.min(n, Math.floor(r.remaining() / 3));
        for (let i = 0; i < n; i++) { const b = r.u8r(), g = r.u8r(), rr = r.u8r(); palette.push(b | (g << 8) | (rr << 16)); }
      }
      if (!size) return;
      const data = r.bytes(size);
      if (data.length !== size) return;
      this.col.bmp(id, { model, w, h, bpp, palette, data });
    }
    readFont(r, length) {
      const x = this.redirect(r, length); r = x.r;
      const id = r.u16(); let enc = r.u16();
      r.seek(14);
      let name = '';
      if (this.version >= 1200) {
        const b = []; for (;;) { const c = r.u16(); if (!c) break; b.push(c); }
        name = String.fromCharCode(...b);
      } else {
        const b = []; for (;;) { const c = r.u8r(); if (!c) break; b.push(c); }
        name = CDR.decode(Uint8Array.from(b), enc);
      }
      // «Arial Cyr» и подобные — кириллица 1251
      const m = name.match(/^(.*?)\s+(CE|Cyrillic|Cyr|CYR|Baltic|Greek|Tur|TUR|Hebrew|Arabic|Thai)$/);
      if (!enc && m) { enc = { CE: 0xee, Cyrillic: 0xcc, Cyr: 0xcc, CYR: 0xcc, Baltic: 0xba, Greek: 0xa1, Tur: 0xa2, TUR: 0xa2, Hebrew: 0xb1, Arabic: 0xb2, Thai: 0xde }[m[2]]; name = m[1]; }
      if (!this.fonts[id]) this.fonts[id] = { name, enc };
      this.col.font(id, this.fonts[id]);
    }
    readStlt(r, length) {
      if (this.version < 700) return;
      const saveVer = this.version;
      try {
        const x = this.redirect(r, length); r = x.r;
        const start = r.pos;
        const numRecords = r.u32();
        if (!numRecords) return;
        let nf = r.u32();
        const fillSize = 12 + (this.version >= 1300 ? 48 : 0);
        nf = Math.min(nf, Math.floor(r.remaining() / fillSize));
        const fillIds = {};
        for (let i = 0; i < nf; i++) { const id = r.u32(); r.seek(4); fillIds[id] = r.u32(); if (this.version >= 1300) r.seek(48); }
        let no = r.u32(); no = Math.min(no, Math.floor(r.remaining() / 12));
        const outlIds = {};
        for (let i = 0; i < no; i++) { const id = r.u32(); r.seek(4); outlIds[id] = r.u32(); }
        let nfn = r.u32();
        const fsz = 4 + 4 + 8 + (this.prec === 16 ? 2 : 4) + 2 * (this.version < 1000 ? 12 : 20);
        nfn = Math.min(nfn, Math.floor(r.remaining() / fsz));
        const fontIds = {}, fontEnc = {}, fontSizes = {};
        for (let i = 0; i < nfn; i++) {
          const id = r.u32(); r.seek(this.version < 1000 ? 12 : 20);
          fontIds[id] = r.u16(); fontEnc[id] = r.u16(); r.seek(8); fontSizes[id] = this.coord(r);
          r.seek(this.version < 1000 ? 12 : 20);
        }
        let na = r.u32(); na = Math.min(na, Math.floor(r.remaining() / 12));
        const aligns = {};
        for (let i = 0; i < na; i++) { const id = r.u32(); r.seek(4); aligns[id] = r.u32(); }
        const ni = r.u32(); r.seek(52 * ni);
        const n5 = r.u32(); r.seek(152 * n5);
        const nt = r.u32(); r.seek(784 * nt);
        const nb = r.u32();
        for (let i = 0; i < nb && r.remaining() >= 16; i++) {
          r.seek(40); if (this.version > 1300) r.seek(4);
          if (this.version >= 1300) { if (r.u32()) r.seek(68); else r.seek(12); }
          else { r.seek(20); if (this.version >= 1000) r.seek(8); if (r.u32()) r.seek(8); r.seek(8); }
        }
        let nIn = r.u32();
        const isz = 4 + 3 * (this.prec === 16 ? 2 : 4);
        nIn = Math.min(nIn, Math.floor(r.remaining() / isz));
        for (let i = 0; i < nIn; i++) { r.u32(); r.seek(12); this.coord(r); this.coord(r); this.coord(r); }
        const nh = r.u32(); r.seek((this.version >= 1300 ? 36 : 32) * nh);
        const nd = r.u32(); r.seek(28 * nd);
        let set11 = false;
        if (this.version > 800) { set11 = true; const n11 = r.u32(); r.seek(12 * n11); }
        const styles = {};
        for (let i = 0; i < numRecords && r.remaining() >= 32; i++) {
          const num = r.u32(), sid = r.u32();
          const s = { parentId: r.u32() };
          r.seek(8);
          let nl = r.u32(); if (this.version >= 1200) nl *= 2;
          r.seek(nl);
          s.fillId = r.u32(); s.outlId = r.u32();
          if (num > 1) { s.fontRecId = r.u32(); s.alignId = r.u32(); r.u32(); r.u32(); if (set11) r.u32(); }
          if (num > 2) { r.u32(); r.u32(); r.u32(); r.u32(); r.u32(); }
          styles[sid] = s;
        }
        for (const [sid, s] of Object.entries(styles)) {
          const st = CDR.style();
          if (s.fontRecId) {
            const fid = fontIds[s.fontRecId];
            if (fid !== undefined && this.fonts[fid]) { st.fontName = this.fonts[fid].name; st.charSet = this.fonts[fid].enc; }
            if (fontEnc[s.fontRecId]) st.charSet = fontEnc[s.fontRecId];
            if (fontSizes[s.fontRecId] !== undefined) st.fontSize = fontSizes[s.fontRecId];
          }
          if (s.alignId && aligns[s.alignId] !== undefined) st.align = aligns[s.alignId];
          if (s.fillId && fillIds[s.fillId] !== undefined && this.fills[fillIds[s.fillId]]) st.fill = this.fills[fillIds[s.fillId]];
          if (s.outlId && outlIds[s.outlId] !== undefined && this.lines[outlIds[s.outlId]]) st.line = this.lines[outlIds[s.outlId]];
          if (s.parentId) st.parentId = s.parentId;
          this.col.style(+sid, st);
        }
        void start;
      } catch (e) { this.version = saveVer; }
    }
    readStyd(r) {
      if (this.version >= 700) return;
      const sid = r.u16();
      const start = r.pos;
      let chunk = this.uns(r); chunk = Math.min(chunk, r.length - start);
      let numArgs = this.uns(r); const sa = this.uns(r); if (sa >= chunk) return;
      const stt = this.uns(r); if (stt >= chunk) return;
      numArgs = Math.min(numArgs, Math.floor((chunk - sa) / 4));
      const st = CDR.style(); st.parentId = this.uns(r);
      r.seek(start + sa, 'set'); const offs = []; for (let i = 0; i < numArgs; i++) offs.push(this.uns(r));
      r.seek(start + stt, 'set'); const types = new Array(numArgs); for (let i = numArgs; i > 0; i--) types[i - 1] = this.uns(r);
      for (let i = 0; i < numArgs; i++) {
        r.seek(start + offs[i], 'set');
        const t = types[i];
        if (t === 0xcd) { const id = r.u32() >>> 0; if (this.fills[id]) st.fill = this.fills[id]; }
        else if (t === 0xd2) { const id = r.u32() >>> 0; if (this.lines[id]) st.line = this.lines[id]; }
        else if (t === 0xdc) {
          if (this.version >= 600) r.seek(4);
          const fid = this.ushort(r); if (this.fonts[fid]) { st.fontName = this.fonts[fid].name; st.charSet = this.fonts[fid].enc; }
          const cs = this.ushort(r); if (cs) st.charSet = cs;
          if (this.version >= 600) r.seek(8);
          st.fontSize = this.coord(r);
        } else if (t === 0xe1) st.align = this.uns(r);
      }
      this.col.style(sid, st);
    }
    readTxsm(r, length) {
      if (this.version < 500) return;
      try {
        const x = this.redirect(r, length); r = x.r;
        if (this.version < 600) return this.txsm5(r);
        if (this.version < 700) return this.txsm6(r);
        if (this.version >= 1600) return this.txsm16(r);
        const v = this.version;
        const frameFlag = r.u32();
        r.seek(0x20); if (v >= 1500) r.seek(1);
        if (v <= 700) { if (r.u32() === 1) r.seek(32); }
        const nfr = r.u32(); let textId = 0;
        for (let i = 0; i < nfr; i++) {
          textId = r.u32(); r.seek(48);
          if (v > 700) {
            if (r.u32() === 1) { r.seek(4); if (v > 1200) r.seek(8); r.seek(28); if (v >= 1500) r.seek(8); }
            else if (v >= 1500) r.seek(8);
          }
          if (!frameFlag) { if (v >= 1500) r.seek(40); else if (v >= 1400) r.seek(36); else if (v > 800) r.seek(34); else if (v >= 800) r.seek(32); else if (v >= 700) r.seek(36); }
          else if (v >= 1500) r.seek(4);
        }
        const np = r.u32();
        for (let j = 0; j < np; j++) {
          const stl = r.u32(); r.seek(1); if (v > 1200 && frameFlag) r.seek(1);
          const ns = r.u32(); const styles = {};
          for (let i = 0; i < ns; i++) {
            r.u16(); const fl2 = r.u8r(); const fl3 = v >= 800 ? r.u8r() : 0;
            const st = CDR.style();
            if (fl2 & 1) { const fid = r.u16(); if (this.fonts[fid]) { st.fontName = this.fonts[fid].name; st.charSet = this.fonts[fid].enc; } const cs = r.u16(); if (cs) st.charSet = cs; }
            if (fl2 & 2) { const bi = r.u32(); st.bold = !!(bi & 1); st.italic = !!(bi & 2); }
            if (fl2 & 4) st.fontSize = this.coord(r);
            if (fl2 & 8) r.seek(4);
            if (fl2 & 0x10) r.seek(4);
            if (fl2 & 0x20) r.seek(4);
            if (fl2 & 0x40) { const fid = r.u32() >>> 0; if (this.fills[fid]) st.fill = this.fills[fid]; if (v >= 1300) r.seek(48); }
            if (fl2 & 0x80) { const oid = r.u32() >>> 0; if (this.lines[oid]) st.line = this.lines[oid]; }
            if (fl3 & 8) { if (v >= 1300) { const tl = r.u32(); r.seek(tl * 2); } else r.seek(4); }
            if (fl3 & 0x20) { const f = r.u8r(); r.seek(-1); if (f) { r.seek(4); if (v >= 1500) r.seek(48); } }
            styles[2 * i] = st;
          }
          let nc = r.u32(); const cs = v >= 1200 ? 8 : 4; nc = Math.min(nc, Math.floor(r.remaining() / cs));
          const desc = new Uint8Array(nc);
          for (let i = 0; i < nc; i++) { const d = v >= 1200 ? r.u64lo() : r.u32(); desc[i] = ((d >>> 16) | (d & 1)) & 0xff; }
          const nb = v >= 1200 ? r.u32() : nc;
          const data = r.bytes(nb); r.seek(1);
          if (data.length || Object.keys(styles).length) this.col.text(textId, stl, data, desc, styles);
        }
      } catch (e) { if (!(e instanceof EOS)) console.warn('CDR txsm', e); }
    }
    txsm16(r) {
      const v = this.version;
      const frameFlag = r.u32(); r.seek(37);
      const nfr = r.u32(); let textId = 0;
      for (let i = 0; i < nfr; i++) {
        textId = r.u32(); r.seek(48);
        if (r.u32() === 1) r.seek(48); else r.seek(8);
        if (!frameFlag) { r.seek(16); const tl = r.u32(); r.seek(v > 1600 ? tl : tl * 2); }
      }
      const np = r.u32();
      for (let j = 0; j < np; j++) {
        const stl = r.u32(); r.seek(1); if (frameFlag) r.seek(1);
        let sl = r.u32(); if (v < 1700) sl *= 2;
        const def = CDR.style(); this.x6Style(r, sl, def);
        const nrec = r.u32(); const styles = {};
        for (let i = 0; i < nrec && r.remaining() >= 17; i++) {
          styles[i * 2] = Object.assign(CDR.style(), def);
          r.seek(2); const f1 = r.u16(), f2 = r.u16();
          if (f2 & 4) { const el = r.u32(); r.seek(el * 2); }
          if (f1 || (f2 & 4)) { let jl = r.u32(); if (v < 1700) jl *= 2; this.x6Style(r, jl, styles[i * 2]); }
        }
        let nc = r.u32(); nc = Math.min(nc, Math.floor(r.remaining() / 8));
        const desc = new Uint8Array(nc);
        for (let i = 0; i < nc; i++) { const d = r.u64lo(); desc[i] = ((d >>> 16) | (d & 1)) & 0xff; }
        const nb = r.u32(); const data = r.bytes(nb); r.seek(1);
        if (data.length) this.col.text(textId, stl, data, desc, styles);
      }
    }
    txsm6(r) {
      const frameFlag = r.u32(); r.seek(0x18);
      if (r.u32() === 1) r.seek(32);
      const nfr = r.u32(); let textId = 0;
      for (let j = 0; j < nfr; j++) { textId = r.u32(); r.seek(48); if (!frameFlag) r.seek(8); }
      const np = r.u32();
      for (let j = 0; j < np; j++) {
        const stl = r.u32(), ns = r.u32(); const styles = {};
        for (let i = 0; i < ns; i++) {
          const st = CDR.style(); const fl = r.u8r(); r.seek(3);
          if (fl & 1) { const fid = r.u16(); if (this.fonts[fid]) { st.fontName = this.fonts[fid].name; st.charSet = this.fonts[fid].enc; } const cs = r.u16(); if (cs) st.charSet = cs; } else r.seek(4);
          r.seek(4);
          if (fl & 4) st.fontSize = this.coord(r); else r.seek(4);
          r.seek(44);
          if (fl & 0x10) { const id = r.u32() >>> 0; if (this.fills[id]) st.fill = this.fills[id]; }
          if (fl & 0x20) { const id = r.u32() >>> 0; if (this.lines[id]) st.line = this.lines[id]; }
          styles[2 * i] = st;
        }
        let nc = r.u32(); r.seek(4); nc = Math.min(nc, Math.floor(r.remaining() / 12));
        const data = new Uint8Array(nc), desc = new Uint8Array(nc);
        for (let i = 0; i < nc; i++) { data[i] = r.u8r(); r.seek(5); desc[i] = (r.u8r() << 1) & 0xff; r.seek(5); }
        if (nc) this.col.text(textId, stl, data, desc, styles);
      }
    }
    txsm5(r) {
      r.seek(2); const nfr = r.u16(); let textId = 0;
      for (let j = 0; j < nfr; j++) { textId = r.u16(); r.seek(2); }
      const np = r.u16();
      for (let j = 0; j < np; j++) {
        const stl = r.u16(), ns = r.u16(); const styles = {};
        for (let i = 0; i < ns; i++) {
          const st = CDR.style(); const fl = r.u8r(); r.seek(1);
          if (fl & 1) { const fid = r.u8r(); if (this.fonts[fid]) { st.fontName = this.fonts[fid].name; st.charSet = this.fonts[fid].enc; } const cs = r.u8r(); if (cs) st.charSet = cs; } else r.seek(2);
          r.seek(6);
          if (fl & 4) st.fontSize = this.coord(r); else r.seek(2);
          r.seek(2);
          if (fl & 0x10) { const id = r.u32() >>> 0; if (this.fills[id]) st.fill = this.fills[id]; } else r.seek(4);
          if (fl & 0x20) { const id = r.u32() >>> 0; if (this.lines[id]) st.line = this.lines[id]; } else r.seek(4);
          r.seek(14);
          styles[2 * i] = st;
        }
        let nc = r.u16(); nc = Math.min(nc, Math.floor(r.remaining() / 8));
        const data = new Uint8Array(nc), desc = new Uint8Array(nc);
        for (let i = 0; i < nc; i++) { r.seek(4); data[i] = r.u8r(); r.seek(1); desc[i] = (r.u16() >> 3) & 0xff; }
        if (nc) this.col.text(textId, stl, data, desc, styles);
      }
    }
    // X6+: стиль символов хранится строкой JSON
    x6Style(r, len, st) {
      len = Math.min(len, r.remaining());
      if (this.version < 1700 && (len & 1)) len--;
      const b = r.bytes(len);
      let s = this.version >= 1700 ? new TextDecoder('utf-8').decode(b) : new TextDecoder('utf-16le').decode(b);
      s = s.replace(/\0+$/, '');
      let js;
      try { js = JSON.parse(s); } catch (e) { return; }
      const ch = js.character;
      if (ch) {
        const lat = ch.latin || {};
        if (lat.font) st.fontName = lat.font;
        if (lat.charset !== undefined) st.charSet = lat.charset;
        if (lat.size) st.fontSize = lat.size / 254000;
        if (ch.outline) { st.line = { lineType: 0, width: (ch.outline.width || 0) / 254000, color: CDR.parseColorString(ch.outline.color), caps: 0, join: 0, stretch: 1, dash: [] }; }
        if (ch.fill) {
          const c1 = CDR.parseColorString(ch.fill.primaryColor);
          st.fill = { type: ch.fill.type ?? 1, c1, c2: c1 };
        }
        if (ch.latin && ch.latin.bold !== undefined) st.bold = !!ch.latin.bold;
      }
      if (js.paragraph && js.paragraph.justify !== undefined) st.align = js.paragraph.justify;
    }
  }

  // ---------- сборщик стилей (первый проход) ----------
  function makeStyles(ps) {
    let page = { w: 8.5, h: 11, ox: -4.25, oy: -5.5 };
    const noop = () => { };
    return {
      level: noop, otherList: noop, object: noop, group: noop, vect: noop, flags: noop, bbox: noop, spnd: noop, transform: noop,
      fillId: noop, lineId: noop, styleId: noop, path: noop, polygon: noop, polygonTransform: noop, spline: noop, ppdt: noop,
      artisticText: noop, paragraphText: noop, bitmap: noop, opacity: noop, font: noop,
      pageSize(w, h, ox, oy) { const p = { w, h, ox, oy }; if (!ps.pages.length) page = p; else ps.pages[ps.pages.length - 1] = p; },
      page() { ps.pages.push(page); },
      fillStyle(id, st) { ps.fills[id] = st; },
      lineStyle(id, st) { ps.lines[id] = st; },
      paletteEntry(id, c) { ps.palette[id] = c; },
      style(id, st) { ps.styles[id] = st; },
      bmp(id, b) { ps.bmps[id] = b; },
      bmpFile(id, bytes) { ps.bmps[id] = { file: bytes }; },
      text(textId, styleId, data, desc, overrides) {
        const base = ps.recursed(styleId);
        const spans = [];
        let cur = 0, buf = [], j = 0;
        const flush = (d, st) => {
          if (!buf.length) return;
          const u = Uint8Array.from(buf);
          const t = d & 1 ? new TextDecoder('utf-16le').decode(u) : CDR.decode(u, st.charSet);
          spans.push({ text: t, style: st });
          buf = [];
        };
        let curStyle = Object.assign(CDR.style(), base);
        for (let i = 0; i < desc.length && j < data.length; i++) {
          if (desc[i] !== cur) {
            flush(cur, curStyle);
            cur = desc[i];
            curStyle = Object.assign(CDR.style(), base);
            CDR.override(curStyle, overrides[cur & 0xfe]);
          }
          buf.push(data[j++]);
          if ((cur & 1) && j < data.length) buf.push(data[j++]);
        }
        flush(cur, curStyle);
        (ps.texts[textId] = ps.texts[textId] || []).push(spans);
      },
    };
  }

  // ---------- сборщик содержимого (второй проход): объекты Вектора ----------
  function makeContent(ps, out) {
    let page = ps.pages[0] || { w: 8.5, h: 11, ox: -4.25, oy: -5.5 }, pageIndex = 0;
    let pageProps = false, ignorePage = false, pageStarted = false, pageLevel = 0;
    let objLevel = 0, vectLevel = 0;
    let fill = null, line = null, styleId = 0, bbox = null, image = null, text = null, textBox = null, path = new PathB();
    let trafos = [], groupLevels = [], groupTrafos = [], listStack = [];
    let polygon = null, inPolygon = false, inSpline = false, spline = null, fillOpacity = 1, spnd = 0;
    let curPage = null;
    const startPage = () => {
      if (ignorePage || pageStarted) return;
      curPage = { w: page.w * 25.4, h: page.h * 25.4, objects: [] };
      out.pages.push(curPage);
      listStack = [curPage.objects];
      pageStarted = true;
    };
    const endPage = () => { pageStarted = false; listStack = []; };
    const list = () => listStack[listStack.length - 1];
    // CDR (дюймы, y вверх, начало в центре страницы) → документ (мм, y вниз, начало в левом верхнем углу)
    const pageM = () => [25.4, 0, 0, -25.4, -page.ox * 25.4, (page.h + page.oy) * 25.4];
    const fullM = () => {
      let m = Mx.id();
      for (const t of trafos) m = Mx.mul(t, m);
      if (groupTrafos.length && groupTrafos[groupTrafos.length - 1]) for (const t of groupTrafos[groupTrafos.length - 1]) m = Mx.mul(t, m);
      return Mx.mul(pageM(), m);
    };
    const add = (o) => { if (!pageStarted || vectLevel) return; list().unshift(o); }; // в CDR первый объект — верхний
    const flush = () => {
      if (!pageStarted && !vectLevel) { path = new PathB(); image = null; text = null; return; }
      const st = resolveStyle();
      if (!path.empty || (spline && inSpline)) {
        if (polygon && inPolygon) CDR.polygonCreate(polygon, path);
        polygon = null; inPolygon = false;
        if (spline && inSpline) CDR.splineCreate(spline, path);
        spline = null; inSpline = false;
        const M = fullM();
        path.transform(M);
        const subs = path.subs.filter(sp => sp.nodes.length > 1);
        for (const sp of subs) {
          const f = sp.nodes[0], l = sp.nodes[sp.nodes.length - 1];
          if (sp.nodes.length > 2 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; sp.nodes.pop(); sp.closed = true; }
          Path.detectSmooth(sp);
        }
        if (subs.length && !(image && image.data)) {
          const o = Model.make('path', { subs });
          applyStyle(o, st, M);
          add(o);
        }
      }
      if (image && image.data) {
        const M = fullM();
        const xmin = Math.min(image.x1, image.x2), xmax = Math.max(image.x1, image.x2), ymin = Math.min(image.y1, image.y2), ymax = Math.max(image.y1, image.y2);
        const o = Model.make('image', { w: (xmax - xmin) * 25.4, h: (ymax - ymin) * 25.4, href: image.data, name: image.missing ? 'Изображение не прочитано' : 'Изображение из CDR' });
        o.stroke = Object.assign(Model.defaults().stroke, { color: null }); o.fill = { type: 'none' };
        o.m = Mx.mul(M, Mx.mul(Mx.translate(xmin, ymax), Mx.scale(1 / 25.4, -1 / 25.4)));
        Model.normalize(o);
        add(o);
      }
      if (text && text.length) {
        const M = fullM();
        const first = (text[0] && text[0][0] && text[0][0].style) || CDR.style();
        const lines = text.map(spans => spans.map(s => s.text).join('').replace(/[\r\n\u2029]+$/, ''));
        const fsIn = first.fontSize || 12 / 72;
        const size = G.round(fsIn * 72, 2);
        const align = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify' }[first.align] || 'left';
        const o = Model.make('text', { text: lines.join('\n').replace(/\r/g, ''), font: first.fontName || 'Arial', size, bold: !!first.bold, italic: !!first.italic, align, lh: 1.2 });
        const fs = first.fill && first.fill.type !== undefined ? first.fill : st.fill;
        const c = fs && (fs.c1 || (fs.grad && fs.grad.stops[0] && fs.grad.stops[0].color));
        o.fill = c ? { type: 'solid', color: CDR.rgb(c, ps), color2: '#ffffff', angle: 0 } : { type: 'solid', color: '#000000', color2: '#ffffff', angle: 0 };
        o.stroke = Object.assign(Model.defaults().stroke, { color: null });
        const fsMM = fsIn * 25.4;
        if (textBox && textBox.w && textBox.h) {
          o.frame = { w: Math.abs(textBox.w) * 25.4, h: Math.abs(textBox.h) * 25.4 };
          o.m = Mx.mul(M, Mx.mul(Mx.translate(textBox.x, textBox.y), Mx.scale(1 / 25.4, -1 / 25.4)));
        } else {
          const tx = textBox ? textBox.x : 0, ty = textBox ? textBox.y : 0;
          o.m = Mx.mul(M, Mx.mul(Mx.translate(tx, ty), Mx.mul(Mx.scale(1 / 25.4, -1 / 25.4), Mx.translate(0, -fsMM * 0.85))));
        }
        // перенос масштаба матрицы в кегль (Corel хранит растянутый текст матрицей)
        const sc = Math.sqrt(Math.abs(o.m[0] * o.m[3] - o.m[1] * o.m[2]));
        if (sc > 0 && Math.abs(sc - 1) > 1e-3) {
          o.size = G.round(o.size * sc, 2);
          if (o.frame) { o.frame.w *= sc; o.frame.h *= sc; }
          o.m = [o.m[0] / sc, o.m[1] / sc, o.m[2] / sc, o.m[3] / sc, o.m[4], o.m[5]];
        }
        if (fillOpacity < 1) o.opacity = fillOpacity;
        add(o);
      }
      image = null; text = null; textBox = null; path = new PathB(); trafos = []; fillOpacity = 1;
    };
    const resolveStyle = () => {
      let f = fill, l = line;
      if ((!f || !l) && styleId) {
        const s = ps.recursed(styleId);
        if (!f && s.fill) f = s.fill;
        if (!l && s.line) l = s.line;
      }
      return { fill: f, line: l };
    };
    const applyStyle = (o, st, M) => {
      const f = st.fill;
      if (!f || f.type === 0 || f.type === undefined) o.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      else if (f.type === 1) o.fill = { type: 'solid', color: CDR.rgb(f.c1, ps), color2: '#ffffff', angle: 0, cmyk: CDR.cmyk(f.c1) };
      else if (f.type === 2 && f.grad && f.grad.stops.length) {
        const g = f.grad, stops = g.stops.map(s => ({ o: G.clamp(s.off, 0, 1), c: CDR.rgb(s.color, ps) }));
        if (stops.length === 1) o.fill = { type: 'solid', color: stops[0].c, color2: '#ffffff', angle: 0 };
        else {
          let ang = g.angle * 180 / Math.PI;
          // угол Corel задан в системе с осью y вверх; поправка на матрицу объекта
          const v = Mx.applyVec(M, Math.cos(g.angle), Math.sin(g.angle));
          ang = Math.atan2(-v.y, v.x) * 180 / Math.PI;
          o.fill = { type: g.type === 2 || g.type === 4 ? 'radial' : 'linear', color: stops[0].c, color2: stops[stops.length - 1].c, angle: G.round(ang, 1), stops };
          if (o.fill.type === 'radial') { o.fill.cx = 0.5 + (g.cx || 0) / 200; o.fill.cy = 0.5 - (g.cy || 0) / 200; }
        }
      } else if (f.type === 7) o.fill = { type: 'solid', color: CDR.rgb(f.c2 || f.c1, ps), color2: '#ffffff', angle: 0 };
      else o.fill = { type: 'solid', color: '#c0c0c0', color2: '#ffffff', angle: 0 }; // текстуры и узоры — нейтральная заливка
      const l = st.line;
      if (!l || (l.lineType & 1) || l.lineType === undefined) o.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
      else {
        const scaleWithImage = l.lineType & 0x20;
        let w = l.width * 25.4 * (l.stretch || 1);
        if (scaleWithImage) { const s = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) / 25.4; w *= s; }
        o.stroke = {
          color: (l.lineType & 0x6) ? CDR.rgb(l.color, ps) : '#000000', width: G.round(Math.max(w, 0.01), 4),
          dash: 'solid', cap: ['butt', 'round', 'square'][l.caps] || 'butt', join: ['miter', 'round', 'bevel'][l.join] || 'miter',
          arrowStart: !!l.start, arrowEnd: !!l.end,
        };
        if (l.dash && l.dash.length && (l.lineType & 0x4)) o.stroke.dashArray = l.dash.slice();
      }
      if (fillOpacity < 1) o.opacity = fillOpacity;
    };
    return {
      level(level) {
        if (level <= objLevel) { flush(); objLevel = 0; }
        while (groupLevels.length && level <= groupLevels[groupLevels.length - 1]) {
          groupLevels.pop(); groupTrafos.pop();
          if (listStack.length > 1) {
            const children = listStack.pop();
            const g = list().find(x => x.children === children);
            if (g && !children.length) list().splice(list().indexOf(g), 1);
            else if (g && children.length === 1) list()[list().indexOf(g)] = children[0]; // группа из одного объекта не нужна
          }
        }
        if (level <= vectLevel) { vectLevel = 0; page = ps.pages[pageIndex ? pageIndex - 1 : 0] || page; }
        if (level <= pageLevel) { endPage(); pageLevel = 0; }
      },
      otherList() { },
      page(level) { pageProps = true; ignorePage = false; pageLevel = level; page = ps.pages[pageIndex++] || page; },
      object(level) { if (!pageStarted && !vectLevel && !ignorePage) startPage(); objLevel = level; fill = null; line = null; styleId = 0; bbox = null; },
      group(level) {
        if (!pageStarted && !vectLevel && !ignorePage) startPage();
        groupLevels.push(level); groupTrafos.push(null);
        if (pageStarted && !vectLevel) {
          const g = Model.make('group', { children: [] });
          list().unshift(g); listStack.push(g.children);
        } else listStack.push([]);
      },
      vect(level) { vectLevel = level; },
      flags(fl, consider) {
        if (pageProps && !(fl & 0x00ff0000)) { if (!pageStarted) startPage(); }
        else if (pageProps && consider) ignorePage = true;
        pageProps = false;
      },
      path(p) { path.append(p); },
      transform(t, considerGroup) { if (objLevel) trafos = t; else if (groupTrafos.length && considerGroup) groupTrafos[groupTrafos.length - 1] = t; },
      fillId(id) { if (ps.fills[id]) fill = ps.fills[id]; },
      lineId(id) { if (ps.lines[id]) line = ps.lines[id]; },
      styleId(id) { styleId = id; },
      polygon() { inPolygon = true; },
      spline() { inSpline = true; },
      polygonTransform(p) { polygon = p; },
      ppdt(pts, knots) { spline = { pts, knots }; },
      opacity(o) { fillOpacity = o; },
      bbox(x0, y0, x1, y1) { bbox = { x0, y0, x1, y1 }; },
      spnd(v) { spnd = v; },
      bitmap(id, x1, x2, y1, y2) {
        const b = ps.bmps[id], data = b ? CDR.bitmapURL(b, ps) : null;
        if (data) image = { data, x1, x2, y1, y2 };
        else { out.missingImages = (out.missingImages || 0) + 1; image = { data: CDR.MISSING, x1, x2, y1, y2, missing: true }; }
      },
      artisticText(x, y) { textBox = { x, y, w: 0, h: 0 }; text = ps.texts[spnd] || null; },
      paragraphText(w, h) { textBox = { x: 0, y: 0, w, h }; text = ps.texts[spnd] || null; },
      pageSize() { }, fillStyle() { }, lineStyle() { }, paletteEntry() { }, style() { }, bmp() { }, bmpFile() { }, text() { }, font() { },
      finish() { if (objLevel) flush(); },
    };
  }

  const api = {
    style() { return { fontName: '', charSet: -1, fontSize: 0, align: 0, fill: null, line: null, parentId: 0 }; },
    override(st, o) {
      if (!o) return;
      if (o.charSet !== -1 || o.fontName) { st.charSet = o.charSet; st.fontName = o.fontName || st.fontName; }
      if (o.fontSize) st.fontSize = o.fontSize;
      if (o.align) st.align = o.align;
      if (o.line) st.line = o.line;
      if (o.fill) st.fill = o.fill;
      if (o.bold !== undefined) st.bold = o.bold;
      if (o.italic !== undefined) st.italic = o.italic;
    },
    decode(u8, cs) {
      const map = { 0: 'windows-1252', 1: 'windows-1252', 0xcc: 'windows-1251', 0xee: 'windows-1250', 0xa1: 'windows-1253', 0xa2: 'windows-1254', 0xb1: 'windows-1255', 0xb2: 'windows-1256', 0xba: 'windows-1257', 0xde: 'windows-874', 0x80: 'shift_jis', 0x81: 'euc-kr', 0x86: 'gbk', 0x88: 'big5' };
      try { return new TextDecoder(map[cs] || 'windows-1252').decode(u8); } catch (e) { return String.fromCharCode(...u8); }
    },
    processPath(pts, types, p) {
      let tmp = [];
      for (let k = 0; k < pts.length; k++) {
        const t = types[k], [x, y] = pts[k];
        const closed = !!(t & 0x08);
        if (!(t & 0x40) && !(t & 0x80)) { if (closed) p.Z(); tmp = []; p.M(x, y); }
        else if ((t & 0x40) && !(t & 0x80)) { tmp = []; p.L(x, y); if (closed) p.Z(); }
        else if (!(t & 0x40) && (t & 0x80)) {
          if (tmp.length >= 2) p.C(tmp[0][0], tmp[0][1], tmp[1][0], tmp[1][1], x, y); else p.L(x, y);
          if (closed) p.Z();
          tmp = [];
        } else tmp.push([x, y]);
      }
    },
    polygonCreate(pg, path) {
      if (!pg.numAngles || path.empty) return;
      const tmp = new PathB(); tmp.append(path);
      const step = 2 * Math.PI / pg.numAngles;
      const rot = a => [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a), 0, 0];
      if (pg.next && pg.numAngles % pg.next) {
        const T = rot(pg.next * step);
        for (let i = 1; i < pg.numAngles && path.subs.length < 4096; i++) { tmp.transform(T); path.append(tmp); }
      } else {
        const T = rot(pg.next * step), S = rot(step);
        for (let i = 0; i < pg.next && path.subs.length < 4096; i++) {
          if (i) { tmp.transform(S); path.append(tmp); }
          for (let j = 1; j < pg.numAngles / pg.next; j++) { tmp.transform(T); path.append(tmp); }
        }
      }
      // соединяем фрагменты в один замкнутый контур
      const nodes = [];
      for (const sp of path.subs) for (const n of sp.nodes) { const l = nodes[nodes.length - 1]; if (l && Math.abs(l.x - n.x) < 1e-7 && Math.abs(l.y - n.y) < 1e-7) { l.ox = n.ox; l.oy = n.oy; } else nodes.push(n); }
      path.subs = [{ closed: true, nodes }];
      path.transform([pg.rx, 0, 0, pg.ry, pg.cx, pg.cy]);
    },
    splineCreate(sd, path) {
      const { pts, knots } = sd;
      if (!pts.length || !knots.length) return;
      path.M(pts[0][0], pts[0][1]);
      let tmp = [pts[0]];
      const emit = () => {
        if (tmp.length === 2) path.L(tmp[1][0], tmp[1][1]);
        else if (tmp.length === 3) path.Q(tmp[1][0], tmp[1][1], tmp[2][0], tmp[2][1]);
        else if (tmp.length > 3) path.spline(tmp);
      };
      for (let i = 1; i < pts.length && i < knots.length; i++) {
        tmp.push(pts[i]);
        if (knots[i]) { emit(); tmp = [pts[i]]; }
      }
      emit();
    },
    // плашечные цвета из палитр (Pantone, HKS…) → CMYK/RGB/Lab
    resolvePalette(c) {
      const ix = c.value & 0xffff, tint = (c.value >>> 16) & 0xffff;
      const P = id => [pal(id + '_C'), pal(id + '_M'), pal(id + '_Y'), pal(id + '_K')];
      if (c.model === 0x19) {
        const p2 = c.palette.toString(16).toUpperCase().padStart(2, '0');
        const key = '19_' + p2;
        const zeroBased = [0x1a, 0x1b, 0x1c, 0x1d].includes(c.palette);
        const i = zeroBased ? ix : ix - 1;
        if ([0x03, 0x08, 0x0a, 0x0b, 0x11, 0x12, 0x14, 0x15, 0x16, 0x17, 0x1a, 0x1b, 0x1c, 0x1d, 0x23, 0x24, 0x25].includes(c.palette)) {
          const [C, M, Y, K] = P(key);
          let cc = 0, mm = 0, yy = 0, kk = 100;
          if (C && i >= 0 && i < C.length) { cc = C[i]; mm = M[i]; yy = Y[i]; kk = K[i]; }
          c.model = 2;
          c.value = (((tint * kk / 100) & 0xff) << 24 | ((tint * yy / 100) & 0xff) << 16 | ((tint * mm / 100) & 0xff) << 8 | ((tint * cc / 100) & 0xff)) >>> 0;
          c.palette = 0;
        } else if ([0x1e, 0x1f, 0x20].includes(c.palette)) {
          const R = pal(key + '_R'), Gg = pal(key + '_G'), B = pal(key + '_B');
          let r = 0, g = 0, b = 0;
          if (R && i >= 0 && i < R.length) { r = R[i]; g = Gg[i]; b = B[i]; }
          c.model = 5;
          const f = v => Math.floor((tint * v + 255 * (100 - tint)) / 100) & 0xff;
          c.value = ((f(r) << 16) | (f(g) << 8) | f(b)) >>> 0; c.palette = 0;
        } else if (c.palette === 0x09) {
          const L = pal(key + '_L'), A = pal(key + '_A'), B = pal(key + '_B');
          if (L && i >= 0 && i < L.length) c.value = ((B[i] << 16) | (A[i] << 8) | L[i]) >>> 0;
          c.model = 0x12; c.palette = 0;
        }
      } else if (c.model === 0x0e && [0x0c, 0x18, 0x21, 0x22].includes(c.palette)) {
        const key = '0E_' + c.palette.toString(16).toUpperCase().padStart(2, '0');
        const L = pal(key + '_L'), A = pal(key + '_A'), B = pal(key + '_B'), i = ix - 1;
        if (L && i >= 0 && i < L.length) c.value = ((B[i] << 16) | (A[i] << 8) | L[i]) >>> 0;
        c.model = 0x12; c.palette = 0;
      }
    },
    parseColorString(s) {
      // «CMYK,USER,0,100,100,0,100,guid» и подобные строки X6+
      const c = { model: 2, palette: 0, value: 0 };
      if (!s) return c;
      const parts = String(s).split(',');
      const models = { CMYK: 2, CMYK255: 3, RGB255: 5, HSB: 6, HLS: 7, GRAY255: 9, LAB: 12, LAB255: 18 };
      c.model = models[parts[0]] ?? 2;
      const nums = parts.slice(2).filter(p => /^\d+$/.test(p)).map(Number);
      if (nums.length >= 5) c.value = (nums[0] | nums[1] << 8 | nums[2] << 16 | nums[3] << 24) >>> 0;
      else if (nums.length >= 4) c.value = c.model === 5 ? (nums[2] | nums[1] << 8 | nums[0] << 16) : (nums[0] | nums[1] << 8 | nums[2] << 16);
      else if (nums.length) c.value = nums[0];
      return c;
    },
    cmyk(c) {
      if (!c) return null;
      const v = c.value, b0 = v & 0xff, b1 = (v >>> 8) & 0xff, b2 = (v >>> 16) & 0xff, b3 = (v >>> 24) & 0xff;
      if (c.model === 1 || c.model === 2 || c.model === 0x15) return [b0, b1, b2, b3];
      if (c.model === 3 || c.model === 0x11) return [b0, b1, b2, b3].map(x => Math.round(x * 100 / 255));
      return null;
    },
    rgb(c, ps) {
      if (!c) return '#000000';
      let model = c.model, value = c.value >>> 0;
      if (model === 0x19 && ps && ps.palette[value & 0xffff]) { const p = ps.palette[value & 0xffff]; model = p.model; value = p.value >>> 0; }
      const b0 = value & 0xff, b1 = (value >>> 8) & 0xff, b2 = (value >>> 16) & 0xff, b3 = (value >>> 24) & 0xff;
      switch (model) {
        case 1: case 2: case 0x15: return Color.fromCmyk(b0, b1, b2, b3);
        case 3: case 0x11: return Color.fromCmyk(b0 * 100 / 255, b1 * 100 / 255, b2 * 100 / 255, b3 * 100 / 255);
        case 4: return hex(255 - b0, 255 - b1, 255 - b2);
        case 5: return hex(b2, b1, b0);
        case 6: case 7: {
          let hue = (b1 << 8) | b0; while (hue > 360) hue -= 360;
          const s1 = model === 6 ? b2 / 255 : b3 / 255, v1 = model === 6 ? b3 / 255 : b2 / 255;
          let R, Gr, B;
          if (hue < 120) { R = (120 - hue) / 60; Gr = hue / 60; B = 0; } else if (hue < 240) { R = 0; Gr = (240 - hue) / 60; B = (hue - 120) / 60; } else { R = (hue - 240) / 60; Gr = 0; B = (360 - hue) / 60; }
          R = Math.min(1, R); Gr = Math.min(1, Gr); B = Math.min(1, B);
          if (model === 6) return hex(255 * (1 - s1 + s1 * R) * v1, 255 * (1 - s1 + s1 * Gr) * v1, 255 * (1 - s1 + s1 * B) * v1);
          const t = x => 2 * s1 * x + 1 - s1;
          return v1 < 0.5 ? hex(255 * v1 * t(R), 255 * v1 * t(Gr), 255 * v1 * t(B)) : hex(255 * ((1 - v1) * t(R) + 2 * v1 - 1), 255 * ((1 - v1) * t(Gr) + 2 * v1 - 1), 255 * ((1 - v1) * t(B) + 2 * v1 - 1));
        }
        case 8: return b0 ? '#000000' : '#ffffff';
        case 9: return hex(b0, b0, b0);
        case 0x0c: return hex(...labToRgb(b0 * 100 / 255, (b1 << 24) >> 24, (b2 << 24) >> 24));
        case 0x12: return hex(...labToRgb(b0 * 100 / 255, b1 - 0x80, b2 - 0x80));
        case 0x14: return hex(255 * b0 / 100, 255 * b0 / 100, 255 * b0 / 100);
        case 0: return '#000000';
        default: return '#000000';
      }
    },
    // растр CDR → data:URL (PNG)
    // заглушка вместо растра, который не удалось прочитать (серая клетка — видно, что здесь было фото)
    MISSING: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d9dde3"/><path d="M0 0L64 64M64 0L0 64" stroke="#9aa3ad" stroke-width="2"/></svg>'),
    bitmapURL(b, ps) {
      if (b.url) return b.url;
      try {
        const c = document.createElement('canvas');
        if (b.file) {
          // старые версии хранят готовый BMP
          let bin = ''; for (let i = 0; i < b.file.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.file.subarray(i, i + 0x8000));
          b.url = 'data:image/bmp;base64,' + btoa(bin);
          return b.url;
        }
        const { model, w, h, bpp, palette, data } = b;
        c.width = w; c.height = Math.max(1, h);
        const ctx = c.getContext('2d'), img = ctx.createImageData(w, Math.max(1, h));
        const lineW = Math.floor(data.length / Math.max(1, h));
        const color = (v, m) => {
          // цвет пикселя в модели растра (как getBMPColor)
          const mm = { 0: 0, 1: 5, 2: 4, 3: 3, 4: 6, 5: 9, 6: 8, 7: 7, 10: 5, 11: 18 }[m];
          if (m === 8 || m === 9 || mm === undefined) return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
          const hx = CDR.rgb({ model: mm, value: v >>> 0 }, ps);
          const n = parseInt(hx.slice(1), 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        };
        const cache = new Map();
        const cc = (v, m) => { const k = v * 16 + m; let r = cache.get(k); if (!r) { r = color(v, m); if (cache.size < 1 << 20) cache.set(k, r); } return r; };
        // RGB-растры (модели 1, 8, 9, 10) — прямо из байтов, без пересчёта цвета для каждой точки
        const direct = !palette.length && (bpp === 24 || bpp === 32) && (model === 1 || model === 8 || model === 9 || model === 10);
        const px = img.data;
        for (let j = 0; j < h; j++) {
          const row = h - 1 - j; // строки BMP идут снизу вверх
          const o = j * lineW;
          let p = row * w * 4;
          if (direct) {
            const st = bpp >> 3;
            for (let k = 0, i = o; k < w; k++, i += st, p += 4) { px[p] = data[i + 2]; px[p + 1] = data[i + 1]; px[p + 2] = data[i]; px[p + 3] = 255; }
            continue;
          }
          for (let k = 0; k < w; k++, p += 4) {
            let rgb;
            if (model === 6) { const byte = data[o + (k >> 3)]; rgb = byte & (0x80 >> (k & 7)) ? [255, 255, 255] : [0, 0, 0]; }
            else if (model === 5) { const g = data[o + k]; px[p] = px[p + 1] = px[p + 2] = g; px[p + 3] = 255; continue; }
            else if (palette.length) { let ix = data[o + k]; if (ix >= palette.length) ix = palette.length - 1; rgb = cc(palette[ix], model); }
            else if (bpp === 24) { const i = o + k * 3; rgb = cc((data[i + 2] << 16) | (data[i + 1] << 8) | data[i], model); }
            else if (bpp === 32) { const i = o + k * 4; rgb = cc(((data[i + 3] << 24) | (data[i + 2] << 16) | (data[i + 1] << 8) | data[i]) >>> 0, model); }
            else rgb = [255, 255, 255];
            px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        // фотографии — JPEG высокого качества (в разы меньше и быстрее), штриховые и палитровые — PNG
        b.url = w * h > 250000 && (bpp >= 24 || model === 5) ? c.toDataURL('image/jpeg', 0.95) : c.toDataURL('image/png');
      } catch (e) { console.warn('CDR растр', e); b.url = null; }
      return b.url;
    },

    // ---------- точка входа ----------
    // возвращает { version, pages: [{ w, h, objects }] }
    parse(buffer) {
      let u8 = new Uint8Array(buffer);
      let ext = [];
      const isRiff = u => u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46;
      if (!isRiff(u8)) {
        if (u8[0] !== 0x50 || u8[1] !== 0x4b) throw new Error('Это не файл CorelDRAW');
        const z = fflate.unzipSync(u8);
        const main = z['content/riffData.cdr'] || z['content/root.dat'];
        if (!main) throw new Error('В архиве нет содержимого CorelDRAW (content/riffData.cdr)');
        if (z['content/dataFileList.dat']) {
          const names = new TextDecoder().decode(z['content/dataFileList.dat']).split('\n').map(s => s.trim()).filter(Boolean);
          ext = names.map(n => z['content/data/' + n] || null);
        }
        u8 = main;
      }
      const sig = String.fromCharCode(u8[8], u8[9], u8[10]).toUpperCase();
      if (!isRiff(u8) || sig !== 'CDR') throw new Error('Неизвестный формат файла CorelDRAW');
      const version = versionFromChar(u8[11]);
      if (version && version < 300) throw new Error('Файлы CorelDRAW 1–2 не поддерживаются');
      const ps = {
        pages: [], fills: {}, lines: {}, palette: {}, styles: {}, bmps: {}, texts: {},
        recursed(id) {
          const chain = []; let s = this.styles[id]; const seen = new Set();
          while (s && !seen.has(s)) { chain.push(s); seen.add(s); s = s.parentId ? this.styles[s.parentId] : null; }
          const st = api.style();
          for (let i = chain.length - 1; i >= 0; i--) api.override(st, chain[i]);
          return st;
        },
      };
      new Parser(ext, makeStyles(ps)).parseRecords(new Reader(u8));
      if (!ps.pages.length) throw new Error('В файле не найдено страниц');
      const out = { version, pages: [] };
      const col = makeContent(ps, out);
      const p2 = new Parser(ext, col);
      p2.parseRecords(new Reader(u8));
      col.level(0); col.finish && col.finish();
      // пустые группы и страницы без объектов в конце убираем
      const clean = list => list.filter(o => { if (o.type === 'group') { o.children = clean(o.children); return o.children.length > 0; } return true; });
      for (const p of out.pages) p.objects = clean(p.objects);
      out.version = p2.version || version;
      return out;
    },
    versionName(v) {
      const n = Math.floor(v / 100);
      const map = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: '11', 12: '12', 13: 'X3', 14: 'X4', 15: 'X5', 16: 'X6', 17: 'X7', 18: 'X8', 19: '2017', 20: '2018', 21: '2019', 22: '2020', 23: '2021', 24: '2022', 25: '2023', 26: '2024', 27: '2025' };
      return map[n] ? 'CorelDRAW ' + map[n] : 'CorelDRAW (версия ' + n + ')';
    },
  };
  return api;
})();
