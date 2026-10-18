// Кодировщик GIF для экспорта роликов «Моушна»: общая палитра 256 цветов (медианное сечение по
// кадрам-образцам), подбор цвета через кэш, LZW-сжатие, бесконечный повтор.
'use strict';

const GifEnc = {
  // пиксели нескольких кадров → палитра [[r,g,b]…] до 256 цветов
  palette(samples, n = 256) {
    const px = [];
    for (const d of samples) { const step = Math.max(1, Math.floor(d.length / 4 / 40000)) * 4; for (let i = 0; i < d.length; i += step) px.push([d[i], d[i + 1], d[i + 2]]); }
    let boxes = [px];
    while (boxes.length < n) {
      let bi = -1, br = -1, bc = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let c = 0; c < 3; c++) { let lo = 255, hi = 0; for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; } if (hi - lo > br) { br = hi - lo; bi = i; bc = c; } }
      });
      if (bi < 0 || br <= 0) break;
      const b = boxes[bi].sort((p, q) => p[bc] - q[bc]), m = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, m), b.slice(m));
    }
    const pal = boxes.filter(b => b.length).map(b => { const s = [0, 0, 0]; for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => Math.round(v / b.length)); });
    while (pal.length < 2) pal.push([0, 0, 0]);
    return pal;
  },
  create(w, h, pal, delayCs = 7) {
    let size = 2; while (size < pal.length) size <<= 1;
    const bits = Math.max(1, Math.log2(size));
    const out = [], B = v => out.push(v & 255), W16 = v => { B(v); B(v >> 8); };
    for (const c of 'GIF89a') B(c.charCodeAt(0));
    W16(w); W16(h); B(0xf0 | (bits - 1)); B(0); B(0);
    for (let i = 0; i < size; i++) { const c = pal[i] || [0, 0, 0]; B(c[0]); B(c[1]); B(c[2]); }
    B(0x21); B(0xff); B(11); for (const c of 'NETSCAPE2.0') B(c.charCodeAt(0)); B(3); B(1); W16(0); B(0);
    const cache = new Map();
    const nearest = (r, g, b) => {
      const k = (r >> 2) << 12 | (g >> 2) << 6 | (b >> 2);
      let v = cache.get(k); if (v !== undefined) return v;
      let bd = 1e9; v = 0;
      for (let i = 0; i < pal.length; i++) { const p = pal[i], d = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 3; if (d < bd) { bd = d; v = i; } }
      cache.set(k, v); return v;
    };
    return {
      add(rgba) {
        const idx = new Uint8Array(w * h);
        for (let i = 0, j = 0; j < idx.length; i += 4, j++) idx[j] = nearest(rgba[i], rgba[i + 1], rgba[i + 2]);
        B(0x21); B(0xf9); B(4); B(0); W16(delayCs); B(0); B(0);
        B(0x2c); W16(0); W16(0); W16(w); W16(h); B(0);
        GifEnc.lzw(idx, bits, out);
      },
      finish() { B(0x3b); return new Blob([new Uint8Array(out)], { type: 'image/gif' }); },
    };
  },
  lzw(idx, bits, out) {
    const minCode = Math.max(2, bits), clear = 1 << minCode, eoi = clear + 1;
    out.push(minCode);
    let codeSize = minCode + 1, next = eoi + 1, dict = new Map();
    let cur = 0, curBits = 0, block = [];
    const emit = code => {
      cur |= code << curBits; curBits += codeSize;
      while (curBits >= 8) { block.push(cur & 255); cur >>>= 8; curBits -= 8; if (block.length === 255) { out.push(255, ...block); block = []; } }
    };
    emit(clear);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = prefix << 8 | k, hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) { dict.set(key, next++); if (next > (1 << codeSize) && codeSize < 12) codeSize++; }
      else { emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1; }
      prefix = k;
    }
    emit(prefix); emit(eoi);
    if (curBits > 0) block.push(cur & 255);
    if (block.length) out.push(block.length, ...block);
    out.push(0);
  },
};
