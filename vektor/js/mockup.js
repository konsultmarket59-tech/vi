// Мокап-студия (как в Recraft): любое фото превращается в мокап, а дизайн ложится на объект
// и принимает его форму — по силуэту, с изгибом цилиндра или в перспективе, со складками
// (смещение по рельефу фото), тенями и бликами. Объект выделяется ИИ (Polza), волшебной
// палочкой или кистью. Шаблон мокапа сохраняется (.vkmock) и годится для серии дизайнов.
'use strict';

// ---------------- движок (без интерфейса: им пользуются студия, «Ноды» и агенты) ----------------
function MockupEngine() {
  const E = {
    W: 0, H: 0, base: null, baseBlob: null, mask: null, design: null,
    mesh: { nx: 6, ny: 6, pts: [] },
    opt: { mode: 'shape', wrap: 0.85, curve: 0, fit: 'cover', scale: 1, dx: 0, dy: 0, rot: 0, tile: false, disp: 8, shade: 0.75, high: 0.35, opacity: 1, blend: 'normal', clip: true, soft: 1 },
    gl: null, canvas: null, dirty: { base: true, mask: true, design: true },
  };
  const MAXS = 2048;

  // ---------- основа ----------
  E.setBase = async (src) => {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    const img = await Polza.loadImage(blob);
    const k = Math.min(1, MAXS / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    E.W = Math.max(2, Math.round((img.naturalWidth || img.width) * k)); E.H = Math.max(2, Math.round((img.naturalHeight || img.height) * k));
    const c = document.createElement('canvas'); c.width = E.W; c.height = E.H;
    c.getContext('2d').drawImage(img, 0, 0, E.W, E.H);
    E.base = c; E.baseBlob = blob;
    E.baseData = c.getContext('2d').getImageData(0, 0, E.W, E.H);
    E.mask = document.createElement('canvas'); E.mask.width = E.W; E.mask.height = E.H;
    E.computeLum();
    E.dirty.base = E.dirty.mask = true;
    E.autoMesh();
  };
  E.computeLum = () => {
    const { W, H } = E, p = E.baseData.data, n = W * H;
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = (p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114) / 255;
    // размытая яркость — рельеф для смещения (складки, изгибы)
    const r = Math.max(2, Math.round(Math.max(W, H) / 300));
    const tmp = new Float32Array(n), out = new Float32Array(n);
    const blur = (src, dst, horiz) => {
      const len = horiz ? W : H, lines = horiz ? H : W;
      for (let l = 0; l < lines; l++) {
        let acc = 0;
        const at = i => horiz ? l * W + Math.min(len - 1, Math.max(0, i)) : Math.min(len - 1, Math.max(0, i)) * W + l;
        for (let i = -r; i <= r; i++) acc += src[at(i)];
        for (let i = 0; i < len; i++) { dst[horiz ? l * W + i : i * W + l] = acc / (2 * r + 1); acc += src[at(i + r + 1)] - src[at(i - r)]; }
      }
    };
    blur(L, tmp, true); blur(tmp, out, false); blur(out, tmp, true); blur(tmp, out, false);
    E.lumSharp = L;
    E.lumBlur = new Uint8Array(n); for (let i = 0; i < n; i++) E.lumBlur[i] = Math.round(out[i] * 255);
  };

  // ---------- маска объекта ----------
  E.maskCtx = () => E.mask.getContext('2d');
  E.maskFull = () => { const g = E.maskCtx(); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, E.W, E.H); E.dirty.mask = true; };
  E.maskClear = () => { E.maskCtx().clearRect(0, 0, E.W, E.H); E.dirty.mask = true; };
  E.maskInvert = () => {
    const g = E.maskCtx(), d = g.getImageData(0, 0, E.W, E.H), p = d.data;
    for (let i = 3; i < p.length; i += 4) { p[i] = 255 - p[i]; p[i - 3] = p[i - 2] = p[i - 1] = 255; }
    g.putImageData(d, 0, 0); E.dirty.mask = true;
  };
  E.maskFromAlpha = async (blob) => {
    const img = await Polza.loadImage(blob);
    const g = E.maskCtx(); g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, E.W, E.H); g.drawImage(img, 0, 0, E.W, E.H);
    // оставляем только прозрачность: всё непрозрачное — белое
    const d = g.getImageData(0, 0, E.W, E.H), p = d.data;
    let any = 0;
    for (let i = 0; i < p.length; i += 4) { p[i] = p[i + 1] = p[i + 2] = 255; if (p[i + 3] > 127) any++; }
    g.putImageData(d, 0, 0); E.dirty.mask = true;
    return any / (E.W * E.H);
  };
  E.maskAI = async (onStatus) => {
    const out = await Polza.removeBackground(E.baseBlob, { onStatus });
    const share = await E.maskFromAlpha(out);
    if (share > 0.97 || share < 0.003) throw new Error('ИИ не нашёл отдельный объект — выделите его палочкой или кистью');
    return share;
  };
  // волшебная палочка: заливка похожих по цвету соседних пикселей
  E.wand = (x, y, tol = 32, add = true) => {
    const { W, H } = E, p = E.baseData.data;
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i0 = (y * W + x) * 4, r0 = p[i0], g0 = p[i0 + 1], b0 = p[i0 + 2];
    const seen = new Uint8Array(W * H), t2 = tol * tol * 3;
    const ok = i => { const j = i * 4, dr = p[j] - r0, dg = p[j + 1] - g0, db = p[j + 2] - b0; return dr * dr + dg * dg + db * db <= t2; };
    const st = [y * W + x];
    while (st.length) {
      const i = st.pop();
      if (seen[i] || !ok(i)) continue;
      let l = i, r = i; const row = Math.floor(i / W) * W;
      while (l > row && !seen[l - 1] && ok(l - 1)) l--;
      while (r < row + W - 1 && !seen[r + 1] && ok(r + 1)) r++;
      for (let k = l; k <= r; k++) {
        seen[k] = 1;
        if (k - W >= 0 && !seen[k - W]) st.push(k - W);
        if (k + W < W * H && !seen[k + W]) st.push(k + W);
      }
    }
    const g = E.maskCtx(), d = g.getImageData(0, 0, W, H), q = d.data;
    for (let i = 0; i < W * H; i++) if (seen[i]) { const j = i * 4; q[j] = q[j + 1] = q[j + 2] = 255; q[j + 3] = add ? 255 : 0; }
    g.putImageData(d, 0, 0);
    // заполняем дырки маски внутри объекта (надписи, блики на одежде)
    if (add) E.fillHoles();
    E.dirty.mask = true;
  };
  E.fillHoles = () => {
    const { W, H } = E, g = E.maskCtx(), d = g.getImageData(0, 0, W, H), q = d.data;
    const out = new Uint8Array(W * H), st = [];
    for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
    while (st.length) {
      const i = st.pop();
      if (out[i] || q[i * 4 + 3] > 127) continue;
      out[i] = 1;
      const x = i % W;
      if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i < W * (H - 1)) st.push(i + W);
    }
    for (let i = 0; i < W * H; i++) if (!out[i] && q[i * 4 + 3] <= 127) { const j = i * 4; q[j] = q[j + 1] = q[j + 2] = q[j + 3] = 255; }
    g.putImageData(d, 0, 0);
  };
  E.brush = (x, y, r, add) => {
    const g = E.maskCtx();
    g.globalCompositeOperation = add ? 'source-over' : 'destination-out';
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    E.dirty.mask = true;
  };
  E.maskStats = () => {
    const { W, H } = E, p = E.maskCtx().getImageData(0, 0, W, H).data;
    const top = new Float32Array(W).fill(-1), bot = new Float32Array(W).fill(-1), lef = new Float32Array(H).fill(-1), rig = new Float32Array(H).fill(-1);
    let x0 = W, x1 = -1, y0 = H, y1 = -1, sum = 0, cnt = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = p[(y * W + x) * 4 + 3];
      if (a > 127) {
        if (top[x] < 0) top[x] = y; bot[x] = y; if (lef[y] < 0) lef[y] = x; rig[y] = x;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        sum += E.lumSharp[y * W + x]; cnt++;
      }
    }
    return { top, bot, lef, rig, x0, x1, y0, y1, empty: cnt === 0, avg: cnt ? sum / cnt : 0.5, share: cnt / (W * H) };
  };

  // ---------- сетка посадки ----------
  // режимы: shape — по силуэту объекта; cylinder — по силуэту с изгибом цилиндра (кружки,
  // бутылки, банки); flat — плоскость в перспективе (вывески, экраны, коробки) по 4 углам
  E.autoMesh = (mode = E.opt.mode) => {
    E.opt.mode = mode;
    const s = E.mask && !E.maskEmpty() ? E.core(E.maskStats()) : null;
    const nx = E.mesh.nx, ny = E.mesh.ny, pts = [];
    const bx0 = s ? s.x0 : E.W * 0.2, bx1 = s ? s.x1 : E.W * 0.8, by0 = s ? s.y0 : E.H * 0.2, by1 = s ? s.y1 : E.H * 0.8;
    const col = x => { if (!s) return [by0, by1]; x = Math.max(bx0, Math.min(bx1, Math.round(x))); for (let d = 0; d < E.W; d++) { for (const xx of [x - d, x + d]) if (xx >= 0 && xx < E.W && s.top[xx] >= 0) return [s.top[xx], s.bot[xx]]; } return [by0, by1]; };
    const row = y => { if (!s) return [bx0, bx1]; y = Math.max(0, Math.min(E.H - 1, Math.round(y))); for (let d = 0; d < E.H; d++) { for (const yy of [y - d, y + d]) if (yy >= 0 && yy < E.H && s.lef[yy] >= 0) return [s.lef[yy], s.rig[yy]]; } return [bx0, bx1]; };
    const wrap = Math.max(0.05, Math.min(1, E.opt.wrap));
    const fu = mode === 'cylinder' ? u => (Math.sin((u - 0.5) * Math.PI * wrap) / Math.sin(Math.PI * wrap / 2) + 1) / 2 : u => u;
    const inset = 0.015;
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = fu(inset + (1 - 2 * inset) * i / nx), v = inset + (1 - 2 * inset) * j / ny;
      let x, y;
      if (mode === 'flat') { x = bx0 + u * (bx1 - bx0); y = by0 + v * (by1 - by0); }
      else {
        x = bx0 + u * (bx1 - bx0);
        let [t, b] = col(x); y = t + v * (b - t);
        for (let k = 0; k < 2; k++) { const [l, r] = row(y); x = l + u * (r - l); [t, b] = col(x); y = t + v * (b - t); }
        if (mode === 'cylinder' && E.opt.curve) y += E.opt.curve * (b - t) * 0.12 * Math.cos((i / nx - 0.5) * Math.PI * wrap);
      }
      pts.push([x, y]);
    }
    E.mesh.pts = pts;
  };
  // «тело» объекта: без рукавов, ручек и выступов — столбцы высотой не меньше 60% наибольшей;
  // края силуэта сглажены, чтобы дизайн ложился плавно
  E.core = (s) => {
    const { W, H } = E, hgt = x => s.top[x] >= 0 ? s.bot[x] - s.top[x] : 0;
    let mx = 0; for (let x = 0; x < W; x++) mx = Math.max(mx, hgt(x));
    // самый длинный непрерывный участок высоких столбцов
    let best = null, run = -1;
    for (let x = 0; x <= W; x++) {
      const ok = x < W && hgt(x) >= mx * 0.6;
      if (ok && run < 0) run = x;
      if (!ok && run >= 0) { if (!best || x - 1 - run > best[1] - best[0]) best = [run, x - 1]; run = -1; }
    }
    if (!best || best[1] - best[0] < 4) best = [s.x0, s.x1];
    const smooth = (arr, n, r) => {
      const out = new Float32Array(n).fill(-1);
      for (let i = 0; i < n; i++) { if (arr[i] < 0) continue; let acc = 0, c = 0; for (let k = -r; k <= r; k++) { const v = arr[i + k]; if (i + k >= 0 && i + k < n && v >= 0) { acc += v; c++; } } out[i] = acc / c; }
      return out;
    };
    const rx = Math.max(2, Math.round(W / 60)), ry = Math.max(2, Math.round(H / 60));
    const top = smooth(s.top, W, rx), bot = smooth(s.bot, W, rx);
    const lef = smooth(s.lef, H, ry).map(v => v < 0 ? v : Math.max(best[0], v)), rig = smooth(s.rig, H, ry).map(v => v < 0 ? v : Math.min(best[1], v));
    let y0 = H, y1 = 0; for (let x = best[0]; x <= best[1]; x++) if (top[x] >= 0) { y0 = Math.min(y0, top[x]); y1 = Math.max(y1, bot[x]); }
    return Object.assign({}, s, { top, bot, lef, rig, x0: best[0], x1: best[1], y0, y1 });
  };
  E.maskEmpty = () => { if (E._me && !E.dirty.mask) return E._me; const p = E.maskCtx().getImageData(0, 0, E.W, E.H).data; for (let i = 3; i < p.length; i += 64) if (p[i] > 127) return false; return true; };
  E.pt = (i, j) => { const { nx, ny } = E.mesh; i = Math.max(0, Math.min(nx, i)); j = Math.max(0, Math.min(ny, j)); return E.mesh.pts[j * (nx + 1) + i]; };
  // перспектива: углы → внутренние точки через гомографию
  E.perspective = () => {
    const { nx, ny } = E.mesh, P = E.pt;
    const q = [P(0, 0), P(nx, 0), P(nx, ny), P(0, ny)];
    const Hm = E.homography(q);
    const pts = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
      const u = i / nx, v = j / ny, w = Hm[6] * u + Hm[7] * v + 1;
      pts.push([(Hm[0] * u + Hm[1] * v + Hm[2]) / w, (Hm[3] * u + Hm[4] * v + Hm[5]) / w]);
    }
    E.mesh.pts = pts;
  };
  E.homography = (q) => {
    // единичный квадрат → четырёхугольник q
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
    return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh];
  };
  // гладкая поверхность через точки сетки (Катмулл — Ром)
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
  E.evalMesh = (u, v) => {
    const { nx, ny } = E.mesh;
    if (E.opt.mode === 'flat') {
      const P = E.pt, Hm = E.homography([P(0, 0), P(nx, 0), P(nx, ny), P(0, ny)]), w = Hm[6] * u + Hm[7] * v + 1;
      return [(Hm[0] * u + Hm[1] * v + Hm[2]) / w, (Hm[3] * u + Hm[4] * v + Hm[5]) / w];
    }
    const U = u * nx, V = v * ny;
    const i = Math.min(nx - 1, Math.floor(U)), j = Math.min(ny - 1, Math.floor(V)), tu = U - i, tv = V - j;
    const rowAt = jj => [0, 1].map(c => cr(E.pt(i - 1, jj)[c], E.pt(i, jj)[c], E.pt(i + 1, jj)[c], E.pt(i + 2, jj)[c], tu));
    const r0 = rowAt(j - 1), r1 = rowAt(j), r2 = rowAt(j + 1), r3 = rowAt(j + 2);
    return [cr(r0[0], r1[0], r2[0], r3[0], tv), cr(r0[1], r1[1], r2[1], r3[1], tv)];
  };

  // ---------- дизайн ----------
  E.setDesign = async (src) => {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    const img = await Polza.loadImage(blob);
    let w = img.naturalWidth || img.width || 1024, hh = img.naturalHeight || img.height || 1024;
    // SVG и мелкие картинки — в разумное разрешение
    const k = Math.min(MAXS / Math.max(w, hh), blob.type === 'image/svg+xml' ? MAXS / Math.max(w, hh) : 1);
    w = Math.max(2, Math.round(w * k)); hh = Math.max(2, Math.round(hh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    c.getContext('2d').drawImage(img, 0, 0, w, hh);
    E.design = c; E.designBlob = blob; E.dirty.design = true;
  };

  // ---------- отрисовка (WebGL) ----------
  const VS_WARP = `attribute vec2 aPos; attribute vec2 aUv; varying vec2 vUv; uniform vec2 uSize;
    void main(){ vUv = aUv; gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0); }`;
  const FS_WARP = `precision highp float; varying vec2 vUv; uniform sampler2D uD; uniform vec2 uS; uniform vec2 uOff; uniform float uRot; uniform float uAsp; uniform float uTile;
    void main(){ vec2 q = (vUv - 0.5) * vec2(uAsp, 1.0); float c = cos(uRot), s = sin(uRot); q = vec2(c*q.x + s*q.y, -s*q.x + c*q.y); q /= vec2(uAsp, 1.0);
      vec2 d = q / uS + 0.5 - uOff;
      if (uTile > 0.5) d = fract(d); else if (d.x < 0.0 || d.y < 0.0 || d.x > 1.0 || d.y > 1.0) { gl_FragColor = vec4(0.0); return; }
      gl_FragColor = texture2D(uD, vec2(d.x, 1.0 - d.y)); }`;
  const VS_Q = `attribute vec2 aPos; varying vec2 v; void main(){ v = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS_C = `precision highp float; varying vec2 v; uniform sampler2D uB, uM, uL, uW; uniform vec2 uPx;
    uniform float uDisp, uShade, uHigh, uOp, uAvg, uClip, uMode;
    void main(){
      vec4 b = texture2D(uB, v);
      float gx = texture2D(uL, v + vec2(uPx.x * 2.0, 0.0)).r - texture2D(uL, v - vec2(uPx.x * 2.0, 0.0)).r;
      float gy = texture2D(uL, v + vec2(0.0, uPx.y * 2.0)).r - texture2D(uL, v - vec2(0.0, uPx.y * 2.0)).r;
      vec2 off = vec2(gx, gy) * uDisp * 25.0 * uPx;
      vec4 d = texture2D(uW, v + off);
      float m = uClip > 0.5 ? texture2D(uM, v).a : 1.0;
      float lum = dot(b.rgb, vec3(0.299, 0.587, 0.114));
      vec3 c = d.rgb;
      if (uMode < 0.5) { float sh = clamp(lum / max(uAvg, 0.05), 0.0, 1.7); c = c * mix(1.0, sh, uShade); c += max(lum - uAvg, 0.0) * uHigh; }
      else if (uMode < 1.5) c = c * mix(vec3(1.0), b.rgb / max(uAvg, 0.05), 1.0) * 0.98;
      else if (uMode < 2.5) c = 1.0 - (1.0 - c) * (1.0 - b.rgb);
      else c = mix(2.0 * c * b.rgb, 1.0 - 2.0 * (1.0 - c) * (1.0 - b.rgb), step(0.5, b.rgb));
      float a = d.a * m * uOp;
      gl_FragColor = vec4(mix(b.rgb, clamp(c, 0.0, 1.0), a), 1.0);
    }`;
  E.initGL = () => {
    if (E.gl) return;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }) || c.getContext('experimental-webgl');
    if (!gl) throw new Error('Нет WebGL — мокапы недоступны на этом компьютере');
    E.canvas = c; E.gl = gl;
    const prog = (vs, fs) => {
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    E.pWarp = prog(VS_WARP, FS_WARP); E.pComp = prog(VS_Q, FS_C);
    E.tex = {}; for (const k of ['B', 'M', 'L', 'D', 'W']) E.tex[k] = gl.createTexture();
    E.fbo = gl.createFramebuffer();
    E.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    E.vbo = gl.createBuffer(); E.ibo = gl.createBuffer();
  };
  const setTex = (gl, t, src, fmt) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (fmt) gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, fmt.w, fmt.h, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, fmt.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  };
  E.render = () => {
    if (!E.base) return null;
    E.initGL();
    const gl = E.gl, { W, H } = E, c = E.canvas;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; E.dirty.base = E.dirty.mask = true; E.wSize = null; }
    if (E.dirty.base) {
      setTex(gl, E.tex.B, E.base);
      // яркость переворачиваем вручную (FLIP_Y не действует на массивы)
      const fl = new Uint8Array(W * H); for (let y = 0; y < H; y++) fl.set(E.lumBlur.subarray((H - 1 - y) * W, (H - y) * W), y * W);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); setTex(gl, E.tex.L, null, { w: W, h: H, data: fl });
      E.dirty.base = false;
    }
    if (E.dirty.mask) {
      let src = E.mask;
      if (E.opt.soft > 0) { const s = document.createElement('canvas'); s.width = W; s.height = H; const g = s.getContext('2d'); g.filter = `blur(${E.opt.soft}px)`; g.drawImage(E.mask, 0, 0); src = s; }
      setTex(gl, E.tex.M, src); E._me = E.maskEmpty(); E.dirty.mask = false;
      E.avg = E.maskStats().avg || 0.5;
    }
    if (E.dirty.design && E.design) { setTex(gl, E.tex.D, E.design); E.dirty.design = false; }
    // 1) дизайн по сетке → текстура W
    if (!E.wSize) {
      gl.bindTexture(gl.TEXTURE_2D, E.tex.W);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.bindFramebuffer(gl.FRAMEBUFFER, E.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, E.tex.W, 0);
      E.wSize = true;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.fbo);
    gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (E.design) {
      const { nx, ny } = E.mesh, S = 10, NU = nx * S, NV = ny * S;
      const vb = new Float32Array((NU + 1) * (NV + 1) * 4);
      let k = 0;
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const u = i / NU, v = j / NV, [x, y] = E.evalMesh(u, v); vb[k++] = x; vb[k++] = y; vb[k++] = u; vb[k++] = v; }
      const ib = new Uint16Array(NU * NV * 6); k = 0;
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c2 = a + NU + 1, d = c2 + 1; ib.set([a, b, c2, b, d, c2], k); k += 6; }
      gl.useProgram(E.pWarp);
      gl.bindBuffer(gl.ARRAY_BUFFER, E.vbo); gl.bufferData(gl.ARRAY_BUFFER, vb, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, E.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ib, gl.DYNAMIC_DRAW);
      const aP = gl.getAttribLocation(E.pWarp, 'aPos'), aU = gl.getAttribLocation(E.pWarp, 'aUv');
      gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aU); gl.vertexAttribPointer(aU, 2, gl.FLOAT, false, 16, 8);
      // соотношение сторон области и посадка дизайна
      const P = E.pt, aw = (Math.hypot(P(nx, 0)[0] - P(0, 0)[0], P(nx, 0)[1] - P(0, 0)[1]) + Math.hypot(P(nx, ny)[0] - P(0, ny)[0], P(nx, ny)[1] - P(0, ny)[1])) / 2;
      const ah = (Math.hypot(P(0, ny)[0] - P(0, 0)[0], P(0, ny)[1] - P(0, 0)[1]) + Math.hypot(P(nx, ny)[0] - P(nx, 0)[0], P(nx, ny)[1] - P(nx, 0)[1])) / 2;
      const aa = aw / Math.max(1, ah), da = E.design.width / E.design.height, o = E.opt;
      let s = [1, 1];
      if (o.fit === 'contain') s = da > aa ? [1, aa / da] : [da / aa, 1];
      else if (o.fit === 'cover') s = da > aa ? [da / aa, 1] : [1, aa / da];
      s = [s[0] * o.scale, s[1] * o.scale];
      gl.uniform2f(gl.getUniformLocation(E.pWarp, 'uSize'), W, H);
      gl.uniform2f(gl.getUniformLocation(E.pWarp, 'uS'), s[0], s[1]);
      gl.uniform2f(gl.getUniformLocation(E.pWarp, 'uOff'), o.dx, o.dy);
      gl.uniform1f(gl.getUniformLocation(E.pWarp, 'uRot'), o.rot * Math.PI / 180);
      gl.uniform1f(gl.getUniformLocation(E.pWarp, 'uAsp'), aa);
      gl.uniform1f(gl.getUniformLocation(E.pWarp, 'uTile'), o.tile ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, E.tex.D); gl.uniform1i(gl.getUniformLocation(E.pWarp, 'uD'), 0);
      gl.drawElements(gl.TRIANGLES, ib.length, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(aU);
    }
    // 2) сведение с фото: складки, тени, блики, форма объекта
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(E.pComp);
    gl.bindBuffer(gl.ARRAY_BUFFER, E.quad);
    const aQ = gl.getAttribLocation(E.pComp, 'aPos'); gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    [['uB', 'B'], ['uM', 'M'], ['uL', 'L'], ['uW', 'W']].forEach(([u, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, E.tex[t]); gl.uniform1i(gl.getUniformLocation(E.pComp, u), i); });
    const o = E.opt, U = n => gl.getUniformLocation(E.pComp, n);
    gl.uniform2f(U('uPx'), 1 / W, 1 / H);
    gl.uniform1f(U('uDisp'), o.disp); gl.uniform1f(U('uShade'), o.shade); gl.uniform1f(U('uHigh'), o.high); gl.uniform1f(U('uOp'), o.opacity);
    gl.uniform1f(U('uAvg'), E.avg || 0.5); gl.uniform1f(U('uClip'), o.clip && !E._me ? 1 : 0);
    gl.uniform1f(U('uMode'), { normal: 0, multiply: 1, screen: 2, overlay: 3 }[o.blend] || 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return c;
  };
  E.blob = (type = 'image/png', q = 0.92) => { const c = E.render(); return new Promise(r => c.toBlob(r, type, q)); };

  // ---------- шаблон мокапа ----------
  E.toTemplate = async () => ({
    app: 'Вектор · Мокап', version: 1,
    base: await Polza.dataURL(E.baseBlob), mask: E.mask.toDataURL('image/png'),
    mesh: { nx: E.mesh.nx, ny: E.mesh.ny, pts: E.mesh.pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]) },
    opt: Object.assign({}, E.opt), size: [E.W, E.H],
  });
  E.fromTemplate = async (t) => {
    await E.setBase(t.base);
    const img = await Polza.loadImage(t.mask);
    E.maskCtx().drawImage(img, 0, 0, E.W, E.H); E.dirty.mask = true;
    Object.assign(E.opt, t.opt || {});
    const k = t.size ? E.W / t.size[0] : 1;
    E.mesh = { nx: t.mesh.nx, ny: t.mesh.ny, pts: t.mesh.pts.map(p => [p[0] * k, p[1] * k]) };
  };
  return E;
}

// ---------------- студия ----------------
const Mockup = {
  el: null, E: null, tool: 'mesh', wandTol: 32, brushR: 30, showMask: true, showMesh: true,
  async open({ base, design } = {}) {
    if (!Mockup.el) Mockup.build();
    Mockup.el.style.display = '';
    if (base) await Mockup.withBusy('Загружаю основу…', () => Mockup.setBase(base));
    if (design) await Mockup.withBusy('Загружаю дизайн…', () => Mockup.E.setDesign(design));
    Mockup.refresh();
  },
  close() { if (Mockup.el) Mockup.el.style.display = 'none'; },
  async withBusy(label, fn) { return withBusy(label, fn); },
  build() {
    Mockup.E = MockupEngine();
    const el = h('div', { class: 'mockup' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    const sec = (t, ...kids) => h('div', { class: 'mk-sec' }, h('div', { class: 'mk-st' }, t), ...kids);
    const sl = (key, label, min, max, step, fmt) => {
      const val = h('span', { class: 'muted' });
      const inp = h('input', { type: 'range', min, max, step, value: Mockup.E.opt[key], oninput: e => { Mockup.E.opt[key] = +e.target.value; val.textContent = fmt ? fmt(+e.target.value) : e.target.value; if (key === 'wrap' || key === 'curve') Mockup.remesh(); Mockup.draw(); } });
      val.textContent = fmt ? fmt(Mockup.E.opt[key]) : Mockup.E.opt[key];
      inp.dataset.k = key;
      return h('label', { class: 'mk-sl' }, h('span', {}, label), inp, val);
    };
    const tools = h('div', { class: 'row' });
    const toolBtn = (k, l, t) => h('button', { class: 'pbt', 'data-tool': k, title: t, onclick: () => Mockup.setTool(k) }, l);
    tools.append(toolBtn('mesh', '✥ Сетка', 'Тяните точки сетки, чтобы посадить дизайн'), toolBtn('wand', '🪄 Палочка', 'Щелчок — добавить область похожего цвета, Alt+щелчок — убрать'),
      toolBtn('add', '🖌 Кисть +', 'Дорисовать объект'), toolBtn('erase', '🧽 Ластик', 'Стереть лишнее из объекта'));
    Mockup.sizeIn = h('input', { type: 'range', min: 4, max: 200, value: Mockup.brushR, oninput: e => { Mockup.brushR = +e.target.value; } });
    Mockup.tolIn = h('input', { type: 'range', min: 4, max: 120, value: Mockup.wandTol, oninput: e => { Mockup.wandTol = +e.target.value; } });
    const modeSel = UI.sel([['shape', 'По форме объекта'], ['cylinder', 'Цилиндр (кружка, бутылка, банка)'], ['flat', 'Плоскость в перспективе']], 'shape', v => { Mockup.E.opt.mode = v; Mockup.remesh(); Mockup.draw(); }, '', 250);
    Mockup.modeSel = modeSel;
    const gridSel = UI.sel([2, 3, 4, 5, 6, 8, 10].map(n => [n, n + '×' + n]), 6, v => { Mockup.E.mesh.nx = Mockup.E.mesh.ny = +v; Mockup.remesh(); Mockup.draw(); }, 'Точек сетки', 80);
    const fitSel = UI.sel([['cover', 'Заполнить'], ['contain', 'Целиком'], ['stretch', 'Растянуть']], 'cover', v => { Mockup.E.opt.fit = v; Mockup.draw(); }, '', 110);
    const blendSel = UI.sel([['normal', 'Обычный с тенями'], ['multiply', 'Умножение (печать)'], ['screen', 'Экран (светлый принт)'], ['overlay', 'Перекрытие']], 'normal', v => { Mockup.E.opt.blend = v; Mockup.draw(); }, '', 190);
    const tile = h('input', { type: 'checkbox', onchange: e => { Mockup.E.opt.tile = e.target.checked; Mockup.draw(); } });
    const clip = h('input', { type: 'checkbox', checked: true, onchange: e => { Mockup.E.opt.clip = e.target.checked; Mockup.draw(); } });
    Mockup.side = h('div', { class: 'mk-panel' },
      sec('1. Основа — фото объекта',
        h('div', { class: 'row' }, B('С компьютера…', 'Фото футболки, кружки, упаковки, вывески…', () => Mockup.pickBase()), B('Из «Вектора»', 'Выделенное изображение', () => Mockup.baseFromVektor()), B('Сгенерировать (ИИ)…', 'Фото-основа моделью Polza', () => Mockup.genBase())),
        h('div', { class: 'row' }, B('Открыть шаблон…', 'Сохранённый мокап .vkmock', () => Mockup.openTemplate()), B('Сохранить шаблон…', 'Основа, объект и посадка — для следующих дизайнов', () => Mockup.saveTemplate()))),
      sec('2. Объект — куда ляжет дизайн',
        h('div', { class: 'row' }, B('✦ Найти объект (ИИ)', 'Выделить главный объект моделью Polza', () => Mockup.maskAI(), 'primary'), B('Весь кадр', '', () => { Mockup.E.maskFull(); Mockup.remesh(); Mockup.draw(); }), B('Инвертировать', '', () => { Mockup.E.maskInvert(); Mockup.remesh(); Mockup.draw(); }), B('Очистить', '', () => { Mockup.E.maskClear(); Mockup.remesh(); Mockup.draw(); })),
        tools, h('label', { class: 'mk-sl' }, h('span', {}, 'Кисть'), Mockup.sizeIn), h('label', { class: 'mk-sl' }, h('span', {}, 'Палочка: допуск'), Mockup.tolIn),
        h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: true, onchange: e => { Mockup.showMask = e.target.checked; Mockup.drawOverlay(); } }), ' показывать объект'),
        h('label', { class: 'row' }, clip, ' дизайн только на объекте (по силуэту)')),
      sec('3. Дизайн',
        h('div', { class: 'row' }, B('С компьютера…', 'PNG, JPG, SVG', () => Mockup.pickDesign()), B('Из «Вектора»', 'Выделенные объекты (или страница)', () => Mockup.designFromVektor()), B('Из «Фигмы»', 'Выделение в «Фигме»', () => Mockup.designFromFigma())),
        h('div', { class: 'row' }, fitSel, h('label', { class: 'row' }, tile, ' повтор (узор)')),
        sl('scale', 'Размер', 0.2, 3, 0.01, v => Math.round(v * 100) + '%'), sl('dx', 'Сдвиг ↔', -0.6, 0.6, 0.005), sl('dy', 'Сдвиг ↕', -0.6, 0.6, 0.005), sl('rot', 'Поворот', -180, 180, 1, v => v + '°')),
      sec('4. Посадка по форме',
        h('div', { class: 'row' }, modeSel, gridSel), sl('wrap', 'Обхват цилиндра', 0.1, 1, 0.01), sl('curve', 'Изгиб по дуге', -1.5, 1.5, 0.01),
        h('div', { class: 'row' }, B('Заново по объекту', 'Пересчитать сетку по силуэту', () => { Mockup.remesh(); Mockup.draw(); }), h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: true, onchange: e => { Mockup.showMesh = e.target.checked; Mockup.drawOverlay(); } }), ' сетка'))),
      sec('5. Реализм',
        blendSel, sl('disp', 'Складки (рельеф)', 0, 30, 0.5), sl('shade', 'Тени объекта', 0, 1, 0.01), sl('high', 'Блики', 0, 1.5, 0.01), sl('opacity', 'Плотность печати', 0, 1, 0.01), sl('soft', 'Мягкость края', 0, 6, 0.5)),
      sec('6. Результат',
        h('div', { class: 'row' }, B('Сохранить PNG…', '', () => Mockup.save('png')), B('JPG…', '', () => Mockup.save('jpg'))),
        h('div', { class: 'row' }, B('→ Вектор', 'Поставить на страницу', () => Mockup.send('vektor')), B('→ Фигма', '', () => Mockup.send('figma')), B('→ Моушн', '', () => Mockup.send('motion'))),
        h('div', { class: 'row' }, B('Серия дизайнов…', 'Несколько файлов дизайна → мокапы в папку', () => Mockup.batch()), B('✦ Фотореализм (ИИ)', 'Дорисовать фактуру и свет моделью Polza', () => Mockup.photoreal()))));
    Mockup.view = h('div', { class: 'mk-viewport' });
    Mockup.stageBox = h('div', { class: 'mk-stagebox' });
    Mockup.overlay = h('canvas', { class: 'mk-overlay' });
    Mockup.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); Mockup.svg.setAttribute('class', 'mk-mesh');
    Mockup.empty = h('div', { class: 'mk-empty' }, h('h3', {}, 'Мокап за три шага'), h('p', {}, '1. Выберите фото объекта — футболка, кружка, пакет, коробка, вывеска, экран.'), h('p', {}, '2. «Найти объект» — ИИ выделит его (или палочкой/кистью).'), h('p', {}, '3. Добавьте дизайн — он ляжет по форме объекта со складками, тенями и бликами.'));
    Mockup.stageBox.append(Mockup.overlay, Mockup.svg);
    Mockup.view.append(Mockup.stageBox, Mockup.empty);
    el.append(h('div', { class: 'wsbar' }, h('b', {}, 'Мокап-студия'), h('span', { class: 'muted' }, ' — дизайн принимает форму объекта'), h('span', { class: 'grow' }), B('⚙ Polza', '', () => Polza.settingsDialog()), B('Закрыть', '', () => Mockup.close(), 'primary')),
      h('div', { class: 'mk-body' }, Mockup.view, Mockup.side));
    document.body.append(el);
    Mockup.el = el;
    new ResizeObserver(() => Mockup.layout()).observe(Mockup.view);
    Mockup.bindView();
    Mockup.setTool('mesh');
    el.addEventListener('keydown', e => e.stopPropagation());
  },
  setTool(k) { Mockup.tool = k; Mockup.side.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === k)); Mockup.drawOverlay(); },
  async setBase(src) {
    await Mockup.E.setBase(src);
    Mockup.E.maskClear(); Mockup.E.autoMesh();
    Mockup.layout();
  },
  remesh() { if (Mockup.E.base) Mockup.E.autoMesh(Mockup.E.opt.mode); },
  // ---------- вид ----------
  layout() {
    const E = Mockup.E; if (!E || !E.base) { if (Mockup.empty) Mockup.empty.style.display = ''; return; }
    Mockup.empty.style.display = 'none';
    const r = Mockup.view.getBoundingClientRect();
    const k = Math.min((r.width - 30) / E.W, (r.height - 30) / E.H);
    Mockup.k = k;
    const w = E.W * k, hh = E.H * k;
    Object.assign(Mockup.stageBox.style, { width: w + 'px', height: hh + 'px' });
    E.initGL();
    if (E.canvas.parentNode !== Mockup.stageBox) Mockup.stageBox.prepend(E.canvas);
    E.canvas.className = 'mk-gl';
    Mockup.overlay.width = E.W; Mockup.overlay.height = E.H;
    Mockup.svg.setAttribute('viewBox', `0 0 ${E.W} ${E.H}`);
    Mockup.draw();
  },
  refresh() { Mockup.layout(); },
  draw() {
    if (!Mockup.E.base) return;
    cancelAnimationFrame(Mockup._raf);
    Mockup._raf = requestAnimationFrame(() => { try { Mockup.E.render(); } catch (e) { console.error(e); UI.toast(e.message, true); } Mockup.drawOverlay(); });
  },
  drawOverlay() {
    const E = Mockup.E; if (!E.base) return;
    const g = Mockup.overlay.getContext('2d');
    g.clearRect(0, 0, E.W, E.H);
    if (Mockup.showMask && ['wand', 'add', 'erase'].includes(Mockup.tool) || (Mockup.showMask && !E.design)) {
      g.globalAlpha = 0.35; g.drawImage(E.mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#ff2d55'; g.fillRect(0, 0, E.W, E.H);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    }
    // сетка и точки
    const svg = Mockup.svg; svg.innerHTML = '';
    if (!Mockup.showMesh || Mockup.tool !== 'mesh') return;
    const { nx, ny } = E.mesh, sw = 1.2 / (Mockup.k || 1);
    const line = pts => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); p.setAttribute('points', pts.map(q => q.join(',')).join(' ')); p.setAttribute('class', 'mk-line'); p.setAttribute('stroke-width', sw); svg.append(p); };
    const N = 24;
    for (let j = 0; j <= ny; j++) { const a = []; for (let s = 0; s <= N; s++) a.push(E.evalMesh(s / N, j / ny)); line(a); }
    for (let i = 0; i <= nx; i++) { const a = []; for (let s = 0; s <= N; s++) a.push(E.evalMesh(i / nx, s / N)); line(a); }
    const flat = E.opt.mode === 'flat';
    E.mesh.pts.forEach((p, idx) => {
      const i = idx % (nx + 1), j = Math.floor(idx / (nx + 1));
      if (flat && !((i === 0 || i === nx) && (j === 0 || j === ny))) return;
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', 6 / (Mockup.k || 1)); c.setAttribute('stroke-width', sw * 1.5);
      c.setAttribute('class', 'mk-pt'); c.dataset.idx = idx;
      svg.append(c);
    });
  },
  toImg(e) { const r = Mockup.stageBox.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * Mockup.E.W, y: (e.clientY - r.top) / r.height * Mockup.E.H }; },
  bindView() {
    const box = Mockup.stageBox;
    box.addEventListener('pointerdown', e => {
      const E = Mockup.E; if (!E.base) return;
      e.preventDefault();
      const p = Mockup.toImg(e);
      box.setPointerCapture(e.pointerId);
      if (Mockup.tool === 'wand') { E.wand(p.x, p.y, Mockup.wandTol, !e.altKey); Mockup.remesh(); Mockup.draw(); return; }
      if (Mockup.tool === 'add' || Mockup.tool === 'erase') {
        const add = Mockup.tool === 'add', r = Mockup.brushR / (Mockup.k || 1) * 0.5;
        E.brush(p.x, p.y, r, add); Mockup.drawOverlay();
        const mv = ev => { const q = Mockup.toImg(ev); E.brush(q.x, q.y, r, add); Mockup.drawOverlay(); };
        const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); Mockup.remesh(); Mockup.draw(); };
        box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
        return;
      }
      // сетка: ближайшая точка
      const { nx, ny } = E.mesh, flat = E.opt.mode === 'flat';
      let best = -1, bd = 14 / (Mockup.k || 1);
      E.mesh.pts.forEach((q, idx) => {
        const i = idx % (nx + 1), j = Math.floor(idx / (nx + 1));
        if (flat && !((i === 0 || i === nx) && (j === 0 || j === ny))) return;
        const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; best = idx; }
      });
      const start = p, orig = E.mesh.pts.map(q => q.slice());
      const mv = ev => {
        const q = Mockup.toImg(ev), dx = q.x - start.x, dy = q.y - start.y;
        if (best >= 0) { E.mesh.pts[best] = [orig[best][0] + dx, orig[best][1] + dy]; if (flat) E.perspective(); }
        else E.mesh.pts = orig.map(o => [o[0] + dx, o[1] + dy]); // тянуть мимо точек — двигать всю сетку
        Mockup.draw();
      };
      const up = () => { box.removeEventListener('pointermove', mv); box.removeEventListener('pointerup', up); };
      box.addEventListener('pointermove', mv); box.addEventListener('pointerup', up);
    });
    box.addEventListener('wheel', e => {
      if (!Mockup.E.design) return;
      e.preventDefault();
      Mockup.E.opt.scale = Math.max(0.2, Math.min(3, Mockup.E.opt.scale * (e.deltaY < 0 ? 1.05 : 1 / 1.05)));
      const s = Mockup.side.querySelector('input[data-k="scale"]'); if (s) { s.value = Mockup.E.opt.scale; s.dispatchEvent(new Event('input')); }
    }, { passive: false });
  },
  // ---------- источники ----------
  async pickBase() {
    const [f] = await Host.pickFiles('.png,.jpg,.jpeg,.webp', false, 'Фото объекта для мокапа');
    if (f) await withBusy('Загружаю основу…', async () => { await Mockup.setBase(await Host.blobOf(f)); });
  },
  async baseFromVektor() {
    const o = App.selObjs().find(x => x.type === 'image');
    if (!o) return UI.toast('Выделите в «Векторе» фотографию', true);
    await withBusy('Загружаю основу…', () => Mockup.setBase(o.href));
  },
  genBase() {
    const prompt = h('textarea', { rows: 4, class: 'wide', value: 'Plain white t-shirt on a hanger, front view, studio lighting, soft shadows, photorealistic, empty chest area' });
    UI.dialog('Фото-основа для мокапа (Polza)', h('div', { class: 'form' }, h('label', {}, 'Что на фото', prompt), Polza.pickRow('image'), h('p', { class: 'muted' }, 'Чистый объект без принта: футболка, худи, кружка, шопер, коробка, банка, билборд…')),
      [{ label: 'Отмена' }, { label: 'Сгенерировать', primary: true, action: () => {
        withBusy('Генерирую основу…', async onStatus => { const b = await Polza.generateImage(prompt.value.trim(), { onStatus }); await Mockup.setBase(b); await Mockup.E.maskAI(onStatus).catch(() => { }); Mockup.remesh(); Mockup.draw(); });
      } }]);
  },
  async maskAI() {
    if (!Mockup.E.base) return UI.toast('Сначала выберите фото-основу', true);
    if (!await Polza.choose(['bg', 'edit'], 'Найти объект (ИИ)')) return;
    await withBusy('ИИ ищет объект…', async onStatus => { await Mockup.E.maskAI(onStatus); Mockup.remesh(); Mockup.draw(); UI.toast('Объект выделен. Поправьте палочкой или кистью, если нужно'); });
  },
  async pickDesign() {
    const [f] = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.svg', false, 'Дизайн, принт, логотип');
    if (f) await withBusy('Загружаю дизайн…', async () => { await Mockup.E.setDesign(await Host.blobOf(f)); Mockup.draw(); });
  },
  async vektorSelectionBlob() {
    const kind = App.sel.length ? 'sel' : 'page';
    const r = IO.svgFor(kind, true);
    if (!r) throw new Error('Пустая страница');
    const dpi = Math.min(600, 2000 / Math.max(r.w, r.h) * 25.4);
    return (await IO.rasterize(r.svg, r.w, r.h, dpi, 'png', null)).blob;
  },
  async designFromVektor() { await withBusy('Беру дизайн…', async () => { await Mockup.E.setDesign(await Mockup.vektorSelectionBlob()); Mockup.draw(); }); },
  async designFromFigma() {
    try { const b = await FigmaWS.selectionImage(); await Mockup.E.setDesign(b); Mockup.el.style.display = ''; Mockup.draw(); }
    catch (e) { UI.toast(e.message, true); }
  },
  // ---------- результат ----------
  need() { if (!Mockup.E.base) { UI.toast('Нет фото-основы', true); return false; } if (!Mockup.E.design) { UI.toast('Нет дизайна', true); return false; } return true; },
  async save(fmt) {
    if (!Mockup.need()) return;
    const b = await Mockup.E.blob(fmt === 'jpg' ? 'image/jpeg' : 'image/png');
    await Host.saveFile('мокап.' + fmt, b, b.type);
  },
  async send(where) {
    if (!Mockup.need()) return;
    const b = await Mockup.E.blob();
    Mockup.close();
    if (where === 'vektor') { WS.show('vektor'); await IO.importRaster(b, 'Мокап'); }
    else if (where === 'figma') { const api = await FigmaWS.api(); await api.placeImages([{ bytes: await b.arrayBuffer(), name: 'мокап.png', type: 'image/png' }]); }
    else { WS.show('motion'); await Motion.addImages([{ name: 'Мокап', blob: b }]); }
  },
  async batch() {
    if (!Mockup.E.base) return UI.toast('Нет фото-основы', true);
    const files = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.svg', true, 'Дизайны для серии мокапов');
    if (!files.length) return;
    const folder = await Host.pickFolder('Куда сохранить мокапы');
    if (!folder) return;
    await withBusy('Серия мокапов…', async () => {
      for (let i = 0; i < files.length; i++) {
        UI.busy(`Мокап ${i + 1} из ${files.length}…`);
        await Mockup.E.setDesign(await Host.blobOf(files[i]));
        const b = await Mockup.E.blob();
        await Host.writeToFolder(folder, 'мокап-' + files[i].name.replace(/\.\w+$/, '') + '.png', b);
      }
      Mockup.draw();
      UI.toast('Готово: мокапов ' + files.length);
    });
  },
  async photoreal() {
    if (!Mockup.need()) return;
    if (!await Polza.choose(['edit'], 'Фотореализм (ИИ)')) return;
    await withBusy('ИИ дорабатывает реализм…', async onStatus => {
      const b = await Mockup.E.blob();
      const out = await Polza.generateImage('Make the printed design look naturally printed on the object: keep the design artwork, its colors, position and the whole photo composition exactly the same; add realistic material texture, lighting, folds and shading on the print. Do not change anything else.', { images: [b], onStatus });
      const url = URL.createObjectURL(out);
      UI.dialog('Фотореализм (Polza)', h('img', { src: url, style: { maxWidth: '78vw', maxHeight: '70vh' } }), [
        { label: 'Сохранить…', action: () => { Host.saveFile('мокап-ии.png', out, out.type); return false; } },
        { label: '→ Вектор', action: () => { Mockup.close(); WS.show('vektor'); IO.importRaster(out, 'Мокап'); } },
        { label: 'Закрыть', primary: true }]);
    });
  },
  async saveTemplate() {
    if (!Mockup.E.base) return UI.toast('Нет фото-основы', true);
    await Host.saveFile('мокап.vkmock', JSON.stringify(await Mockup.E.toTemplate()), 'application/json', 'vkmock');
  },
  async openTemplate() {
    const [f] = await Host.pickFiles('.vkmock,.json', false, 'Шаблон мокапа');
    if (!f) return;
    await withBusy('Открываю шаблон…', async () => {
      await Mockup.E.fromTemplate(JSON.parse(new TextDecoder().decode(await f.read())));
      Mockup.syncControls(); Mockup.layout();
    });
  },
  syncControls() {
    const o = Mockup.E.opt;
    Mockup.side.querySelectorAll('input[data-k]').forEach(i => { i.value = o[i.dataset.k]; i.dispatchEvent(new Event('input')); });
    Mockup.modeSel.value = o.mode;
  },
};

// мокап одной командой: для «Нод» и агентов
async function makeMockup({ base, design, mode = 'shape', mask = 'ai', fit = 'cover', blend = 'normal', disp, shade, onStatus } = {}) {
  const E = MockupEngine();
  await E.setBase(base);
  if (mask === 'ai') { try { await E.maskAI(onStatus); } catch (e) { E.maskFull(); } }
  else E.maskFull();
  Object.assign(E.opt, { mode, fit, blend });
  if (disp !== undefined) E.opt.disp = disp;
  if (shade !== undefined) E.opt.shade = shade;
  E.autoMesh(mode);
  await E.setDesign(design);
  const blob = await E.blob();
  try { E.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { }
  return blob;
}
