// Цвет для печати: CMYK по профилю (таблица из GenericCMYK, как в libcdr/CorelDRAW).
// Точные значения CMYK, заданные человеком (палитра, поля C/M/Y/K, файлы CorelDRAW и PDF),
// запоминаются за каждым цветом документа и уходят в печать без пересчёта.
'use strict';

const CMYK = {
  N: 11, lut: null, known: new Map(), _inv: new Map(),
  init() {
    if (CMYK.lut || !window.CMYK_LUT_B64) return;
    const bin = atob(window.CMYK_LUT_B64);
    CMYK.lut = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) CMYK.lut[i] = bin.charCodeAt(i);
  },
  // CMYK (0..100) → [r,g,b] 0..255, четырёхлинейная интерполяция по узлам таблицы
  toRgb(c, m, y, k) {
    CMYK.init();
    if (!CMYK.lut) { return [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)]; }
    const N = CMYK.N, L = CMYK.lut, v = [c, m, y, k].map(x => Math.max(0, Math.min(100, x)) / 10);
    const i0 = v.map(x => Math.min(N - 2, Math.floor(x))), t = v.map((x, n) => x - i0[n]);
    const out = [0, 0, 0];
    for (let b = 0; b < 16; b++) {
      let w = 1, idx = 0;
      for (let d = 0; d < 4; d++) { const bit = (b >> (3 - d)) & 1; w *= bit ? t[d] : 1 - t[d]; idx = idx * N + i0[d] + bit; }
      if (!w) continue;
      out[0] += w * L[idx * 3]; out[1] += w * L[idx * 3 + 1]; out[2] += w * L[idx * 3 + 2];
    }
    return out;
  },
  hex(c, m, y, k) { const [r, g, b] = CMYK.toRgb(c, m, y, k); return Color.rgbToHex(r, g, b); },
  // RGB → CMYK: стартуем с простого разложения с чёрной генерацией, затем подгоняем C, M, Y
  // по профилю (несколько шагов Гаусса — Ньютона), чтобы на печати был тот же цвет
  fromRgb(r, g, b) {
    const key = (r << 16) | (g << 8) | b;
    const hit = CMYK._inv.get(key); if (hit) return hit.slice();
    const R = r / 255, Gg = g / 255, B = b / 255;
    let k = 1 - Math.max(R, Gg, B);
    let res;
    if (k > 0.995) res = [0, 0, 0, 100];
    else if (r > 252 && g > 252 && b > 252) res = [0, 0, 0, 0];
    else {
      // чёрная генерация: средняя (часть серой составляющей уходит в K)
      const K = Math.max(0, Math.min(100, (k - 0.1) / 0.9 * 100 * 0.9));
      let x = [(1 - R - k) / (1 - k) * 100, (1 - Gg - k) / (1 - k) * 100, (1 - B - k) / (1 - k) * 100].map(v => Math.max(0, Math.min(100, v + (k * 100 - K) * 0.8)));
      const target = [r, g, b];
      for (let it = 0; it < 10; it++) {
        const f0 = CMYK.toRgb(x[0], x[1], x[2], K), err = f0.map((v, i) => v - target[i]);
        if (Math.abs(err[0]) + Math.abs(err[1]) + Math.abs(err[2]) < 1.5) break;
        // якобиан конечными разностями
        const J = [0, 1, 2].map(j => { const xx = x.slice(); xx[j] = Math.min(100, xx[j] + 2) === xx[j] ? xx[j] - 2 : xx[j] + 2; const d = xx[j] - x[j]; const f1 = CMYK.toRgb(xx[0], xx[1], xx[2], K); return f1.map((v, i) => (v - f0[i]) / d); });
        // J[j][i] = ∂rgb_i/∂x_j → решаем J^T dx = -err
        const A = [[J[0][0], J[1][0], J[2][0]], [J[0][1], J[1][1], J[2][1]], [J[0][2], J[1][2], J[2][2]]];
        const dx = CMYK.solve3(A, err.map(v => -v));
        if (!dx) break;
        x = x.map((v, i) => Math.max(0, Math.min(100, v + Math.max(-25, Math.min(25, dx[i])))));
      }
      res = [...x, K];
    }
    res = res.map(v => Math.round(v));
    if (CMYK._inv.size > 50000) CMYK._inv.clear();
    CMYK._inv.set(key, res);
    return res.slice();
  },
  solve3(A, b) {
    const d = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    if (Math.abs(d) < 1e-9) return null;
    const rep = (j) => A.map((row, i) => row.map((v, c) => c === j ? b[i] : v));
    const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    return [0, 1, 2].map(j => det(rep(j)) / d);
  },
  // запомнить точный CMYK цвета (для документа и на время сеанса)
  remember(hex, v) {
    if (!hex) return;
    hex = hex.toLowerCase();
    const val = v.map(x => Math.round(x * 10) / 10);
    CMYK.known.set(hex, val);
    if (typeof App !== 'undefined' && App.doc) { (App.doc.cmyk || (App.doc.cmyk = {}))[hex] = val; }
  },
  // CMYK цвета: заданный человеком, иначе — пересчёт по профилю
  of(hex) {
    if (!hex) return null;
    hex = String(hex).toLowerCase();
    const d = typeof App !== 'undefined' && App.doc && App.doc.cmyk && App.doc.cmyk[hex];
    if (d) return d.slice();
    const k = CMYK.known.get(hex); if (k) return k.slice();
    const { r, g, b } = Color.hexToRgb(hex);
    return CMYK.fromRgb(r, g, b);
  },
  exact(hex) { hex = String(hex || '').toLowerCase(); return !!((typeof App !== 'undefined' && App.doc && App.doc.cmyk && App.doc.cmyk[hex]) || CMYK.known.get(hex)); },
  str(v) { return `C${Math.round(v[0])} M${Math.round(v[1])} Y${Math.round(v[2])} K${Math.round(v[3])}`; },
  // все цветовые поля объекта: [paint, key] — для пересчёта и проверки
  paints(o, cb) {
    const f = o.fill, s = o.stroke;
    if (f && f.type && f.type !== 'none') {
      if (f.color) cb(f, 'color', 'fill');
      if ((f.type === 'linear' || f.type === 'radial')) { if (f.stops && f.stops.length > 1) f.stops.forEach(st => cb(st, 'c', 'stop')); else if (f.color2) cb(f, 'color2', 'fill'); }
    }
    if (s && s.color && s.width > 0) cb(s, 'color', 'stroke');
    if (o.shadow && o.shadow.color) cb(o.shadow, 'color', 'shadow');
  },
  // таблица RGB → CMYK для картинок (33³ узла, дальше трилинейная интерполяция)
  imageLUT() {
    if (CMYK._img) return CMYK._img;
    const S = 33, t = new Float32Array(S * S * S * 4);
    for (let r = 0; r < S; r++) for (let g = 0; g < S; g++) for (let b = 0; b < S; b++) {
      const v = CMYK.fromRgb(Math.round(r * 255 / (S - 1)), Math.round(g * 255 / (S - 1)), Math.round(b * 255 / (S - 1)));
      t.set(v, ((r * S + g) * S + b) * 4);
    }
    CMYK._img = { S, t };
    return CMYK._img;
  },
  // RGBA → CMYK (байты 0..255 на канал)
  pixelsToCmyk(rgba) {
    const { S, t } = CMYK.imageLUT(), n = rgba.length / 4, out = new Uint8Array(n * 4), q = (S - 1) / 255;
    for (let i = 0; i < n; i++) {
      const R = rgba[i * 4] * q, Gq = rgba[i * 4 + 1] * q, B = rgba[i * 4 + 2] * q;
      const r0 = Math.min(S - 2, R | 0), g0 = Math.min(S - 2, Gq | 0), b0 = Math.min(S - 2, B | 0), fr = R - r0, fg = Gq - g0, fb = B - b0;
      for (let c = 0; c < 4; c++) {
        const at = (rr, gg, bb) => t[((rr * S + gg) * S + bb) * 4 + c];
        const c00 = at(r0, g0, b0) * (1 - fb) + at(r0, g0, b0 + 1) * fb, c01 = at(r0, g0 + 1, b0) * (1 - fb) + at(r0, g0 + 1, b0 + 1) * fb;
        const c10 = at(r0 + 1, g0, b0) * (1 - fb) + at(r0 + 1, g0, b0 + 1) * fb, c11 = at(r0 + 1, g0 + 1, b0) * (1 - fb) + at(r0 + 1, g0 + 1, b0 + 1) * fb;
        const v = (c00 * (1 - fg) + c01 * fg) * (1 - fr) + (c10 * (1 - fg) + c11 * fg) * fr;
        out[i * 4 + c] = Math.round(v * 2.55);
      }
    }
    return out;
  },
};

// цвета CMYK во всей программе — по профилю, и каждый заданный CMYK запоминается
Color.fromCmyk = (c, m, y, k) => { const hex = CMYK.hex(c, m, y, k); CMYK.remember(hex, [c, m, y, k]); return hex; };
Color.toCmyk = (hex) => { const v = CMYK.of(hex); return { c: Math.round(v[0]), m: Math.round(v[1]), y: Math.round(v[2]), k: Math.round(v[3]) }; };
