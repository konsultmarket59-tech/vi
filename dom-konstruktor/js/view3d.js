/* 3D: интерьер этажа, прогулка по всему дому, дом снаружи (белая модель или отделка по зонам, кровли).
   three.js r128 подгружается по требованию. Единицы сцены — метры; план X → X, план Y → Z, высота — Y. */
(function () {
'use strict';
const DK = window.DK;
const LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js', 'https://unpkg.com/three@0.128.0/build/three.min.js', 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js'];
let libPromise = null;
DK.loadThree = function () {
  if (window.THREE) return Promise.resolve();
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (i >= LIBS.length) { libPromise = null; reject(new Error('Не удалось загрузить three.js')); return; }
      const s = document.createElement('script'); s.src = LIBS[i++]; s.async = true;
      s.onload = () => resolve(); s.onerror = () => { s.remove(); next(); };
      document.head.appendChild(s);
    };
    next();
  });
  return libPromise;
};

function View3D(canvas, app) {
  const T = window.THREE;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(50, 1, 0.05, 500);
  const hemi = new T.HemisphereLight(0xe8f0ff, 0x8a8170, 0.62); scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff3e0, 1.05);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);
  const amb = new T.AmbientLight(0xffffff, 0.08); scene.add(amb);
  let root = null, mode = 'interior', fid = 'f1', cut = true, showFurn = true, picks = [];
  const orbit = { tx: 0, ty: 0, tz: 0, r: 20, az: -0.7, el: 0.75 };
  const walk = { x: 0, z: 0, h: 0, yaw: 0, pitch: 0, keys: {} };
  let walkData = null;
  const texCache = {}, matCache = {};
  let white = null, wallIn = null;

  /* ---------- текстуры: серые узоры, цвет задаёт материал ---------- */
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function tex(kind) {
    if (texCache[kind]) return texCache[kind];
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d'), rnd = mulberry(kind.length * 7919 + kind.charCodeAt(0));
    const gray = (v) => { const c = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${c},${c},${c})`; };
    const noise = (n, lo, hi, sz) => { for (let i = 0; i < n; i++) { g.fillStyle = gray(lo + rnd() * (hi - lo)); g.globalAlpha = 0.35; g.fillRect(rnd() * S, rnd() * S, sz || 2, sz || 2); } g.globalAlpha = 1; };
    g.fillStyle = gray(1); g.fillRect(0, 0, S, S);
    if (kind === 'plaster') { noise(26000, 0.82, 1, 2); }
    else if (kind === 'smooth') { noise(5000, 0.94, 1, 2); }
    else if (kind === 'brick') {
      g.fillStyle = gray(0.72); g.fillRect(0, 0, S, S);
      const rh = S / 13, bw = S / 4;
      for (let r = 0; r < 13; r++) for (let i = -1; i < 5; i++) { g.fillStyle = gray(0.82 + rnd() * 0.18); g.fillRect(i * bw + (r % 2) * bw / 2 + 3, r * rh + 3, bw - 6, rh - 5); }
      noise(8000, 0.7, 1, 2);
    } else if (kind === 'stone') {
      g.fillStyle = gray(0.45); g.fillRect(0, 0, S, S);
      for (let y = 0; y < S; y += 72) for (let x = -60; x < S;) { const w = 80 + rnd() * 110; g.fillStyle = gray(0.68 + rnd() * 0.32); g.beginPath(); g.ellipse(x + w / 2, y + 36, w / 2 - 5, 31, 0, 0, 7); g.fill(); x += w; }
      noise(9000, 0.5, 1, 3);
    } else if (kind === 'ledge') {
      g.fillStyle = gray(0.3); g.fillRect(0, 0, S, S);
      for (let y = 0; y < S;) { const h = 18 + rnd() * 34; for (let x = -100; x < S;) { const w = 70 + rnd() * 200; g.fillStyle = gray(0.55 + rnd() * 0.45); g.fillRect(x + 2, y + 2, w - 3, h - 3); x += w; } y += h; }
      noise(9000, 0.4, 1, 2);
    } else if (kind === 'siding') { // нахлёст 150 мм
      const bh = S / 6.67;
      for (let y = 0; y < S; y += bh) { const gr = g.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, gray(1)); gr.addColorStop(1, gray(0.84)); g.fillStyle = gr; g.fillRect(0, y, S, bh); g.fillStyle = gray(0.55); g.fillRect(0, y + bh - 4, S, 4); }
      noise(6000, 0.85, 1, 2);
    } else if (kind === 'bnb') { // вертикальная доска с планкой через 300 мм
      noise(5000, 0.9, 1, 2);
      for (let x = 0; x < S; x += S / 3.33) { g.fillStyle = gray(0.7); g.fillRect(x, 0, 4, S); g.fillStyle = gray(1); g.fillRect(x + 4, 0, 10, S); g.fillStyle = gray(0.8); g.fillRect(x + 14, 0, 4, S); }
    } else if (kind === 'planken') {
      const bh = S / 8.3;
      for (let y = 0; y < S; y += bh) { g.fillStyle = gray(0.82 + rnd() * 0.18); g.fillRect(0, y, S, bh - 6); g.fillStyle = gray(0.35); g.fillRect(0, y + bh - 6, S, 6);
        g.globalAlpha = 0.18; for (let k = 0; k < 8; k++) { g.strokeStyle = gray(0.5); g.beginPath(); const yy = y + rnd() * (bh - 8); g.moveTo(0, yy); g.bezierCurveTo(S / 3, yy + 4, S * 2 / 3, yy - 4, S, yy + 2); g.stroke(); } g.globalAlpha = 1; }
    } else if (kind === 'panel') {
      noise(4000, 0.92, 1, 2);
      g.fillStyle = gray(0.6); for (let x = 0; x <= S; x += S / 0.83 / 1.2) g.fillRect(x - 2, 0, 4, S); for (let y = 0; y <= S; y += S / 1.6 * 1.6 / 1.6) g.fillRect(0, y - 2, S, 4);
    } else if (kind === 'shingle') { // ряды 200 мм, лепестки 330 мм
      g.fillStyle = gray(0.25); g.fillRect(0, 0, S, S);
      const rh = S / 5, tw = S / 3;
      for (let r = 0; r < 5; r++) for (let i = -1; i < 4; i++) { g.fillStyle = gray(0.62 + rnd() * 0.38); g.fillRect(i * tw + (r % 2) * tw / 2 + 2, r * rh + 2, tw - 4, rh - 3); }
      noise(30000, 0.3, 1, 2);
    } else if (kind === 'mtile') { // волна 350 мм по высоте, 185 мм по ширине
      const rh = S / 2.86;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x += 2) {
        const v = 0.72 + 0.22 * Math.sin((x / S) * Math.PI * 2 * 5.4) * 0.5 + 0.18 * ((y % rh) / rh);
        g.fillStyle = gray(v); g.fillRect(x, y, 2, 1);
      }
      for (let y = 0; y < S; y += rh) { g.fillStyle = gray(0.35); g.fillRect(0, y, S, 5); }
    } else if (kind === 'falz') {
      noise(3000, 0.9, 1, 2);
      for (let x = 0; x < S; x += S / 2) { g.fillStyle = gray(1); g.fillRect(x, 0, 7, S); g.fillStyle = gray(0.55); g.fillRect(x + 7, 0, 6, S); }
    } else if (kind === 'wood') {
      for (let i = 0; i < 6; i++) { g.fillStyle = gray(0.85 + rnd() * 0.15); g.fillRect(0, i * S / 6, S, S / 6 - 3); }
    } else if (kind === 'tilefloor') {
      g.strokeStyle = gray(0.82); g.lineWidth = 3;
      for (let x = 0; x <= S; x += S / 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(S, x); g.stroke(); }
    } else if (kind === 'grass') { g.fillStyle = gray(0.85); g.fillRect(0, 0, S, S); noise(40000, 0.55, 1, 3); }
    else if (kind === 'concrete') { noise(20000, 0.8, 1, 2); g.fillStyle = gray(0.7); g.fillRect(0, 0, S, 3); }
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; t.encoding = T.sRGBEncoding;
    texCache[kind] = t; return t;
  }
  const BUMP = { brick: 0.012, stone: 0.03, ledge: 0.03, siding: 0.02, bnb: 0.015, planken: 0.01, shingle: 0.02, mtile: 0.03, falz: 0.01, plaster: 0.004, panel: 0.006 };
  function lin(hex) { return new T.Color(hex).convertSRGBToLinear(); }
  function mat(spec, extra) {
    spec = typeof spec === 'string' ? { c: spec } : spec;
    const key = (spec.m || '') + spec.c + JSON.stringify(extra || {});
    if (matCache[key]) return matCache[key];
    const o = Object.assign({ roughness: 0.9, metalness: 0, color: lin(spec.c) }, extra || {});
    if (spec.m && spec.m !== 'flat') { o.map = tex(spec.m); if (BUMP[spec.m]) { o.bumpMap = o.map; o.bumpScale = BUMP[spec.m]; } }
    if (spec.m === 'falz' || spec.m === 'mtile') { o.metalness = 0.35; o.roughness = 0.5; }
    return (matCache[key] = new T.MeshStandardMaterial(o));
  }
  function box(w, h, d, m, x, y, z, opt) {
    const g = new T.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), uv = g.attributes.uv;
    const dm = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dm[f][0], uv.getY(i) * dm[f][1]); }
    const mesh = new T.Mesh(g, m); mesh.position.set(x, y, z);
    mesh.castShadow = !(opt && opt.noShadow); mesh.receiveShadow = true;
    return mesh;
  }
  function poly(pts, m, ua, va) {
    const pos = [], uv = [];
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) { pos.push(q[0], q[1], q[2]); uv.push(q[ua], q[va]); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  /* плоскость ската: UV вдоль карниза и вдоль ската, в метрах */
  function slope(pts, m) {
    const a = new T.Vector3(...pts[0]), b = new T.Vector3(...pts[1]), c = new T.Vector3(...pts[pts.length - 1]);
    const u = b.clone().sub(a).normalize(), n = u.clone().cross(c.clone().sub(a)).normalize(), v = n.clone().cross(u).normalize();
    const pos = [], uv = [], P = pts.map(q => new T.Vector3(...q));
    for (let i = 1; i < P.length - 1; i++) for (const q of [P[0], P[i], P[i + 1]]) { pos.push(q.x, q.y, q.z); const d = q.clone().sub(a); uv.push(d.dot(u), d.dot(v)); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  /* скат с толщиной: верх — кровля, низ — подшива, торцы — ветровая/лобовая доска */
  function roofPlane(pts, rm, sm, fm) {
    const th = 0.14, low = pts.map(q => [q[0], q[1] - th, q[2]]);
    root.add(slope(pts, rm));
    root.add(slope(low.slice().reverse(), sm));
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; root.add(slope([pts[i], low[i], low[j], pts[j]], fm)); }
  }
  function extrudePoly(pts, y0, h, m) {
    const sh = new T.Shape(pts.map(q => new T.Vector2(q.x / 1000, -q.y / 1000)));
    const g = new T.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false });
    const mesh = new T.Mesh(g, m); mesh.rotation.x = -Math.PI / 2; mesh.position.y = y0;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  function skyTex() {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#8fb2d8'); gr.addColorStop(0.55, '#cfdeec'); gr.addColorStop(1, '#eef2f4');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new T.CanvasTexture(cv); t.encoding = T.sRGBEncoding; return t;
  }
  const SKY = skyTex();

  /* ---------- сборка ---------- */
  function build() {
    const p = app.p(), F = DK.facadeOf(p);
    if (root) { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    root = new T.Group(); scene.add(root); picks = [];
    const ext = DK.extT(p), e = ext / 1000, fl = DK.floorsOf(p), hc = p.hClear / 1000, sl = p.slab / 1000;
    const showFloors = mode === 'interior' ? fl.slice(0, fl.indexOf(fid) + 1) : fl;
    wallIn = mat({ c: '#f2f0ec' }); white = mat({ c: '#f4f3f0' });
    const outside = mode !== 'interior';
    const plinthH = 0.6, gy = p.basement ? DK.elev(p, 'b') / 1000 + 1.4 : -plinthH;
    const cx = p.W / 2000, cz = p.D / 2000;
    const gm = box(160, 0.05, 160, outside ? mat({ m: 'grass', c: '#86a06c' }) : mat({ c: '#dfe2dc' }), cx, gy - 0.025, cz, { noShadow: true });
    gm.castShadow = false; root.add(gm);
    if (!p.basement) root.add(extrudePoly(DK.offsetPoly(p, ext + 25), gy, -gy, mat(F.plinth)));
    const M = DK.mainRect(p);
    const onMain = (w) => w.axis === 'x' ? ((w.line === M.y0 || w.line === M.y1) && w.edge.lo >= M.x0 - 1 && w.edge.hi <= M.x1 + 1)
                                         : ((w.line === M.x0 || w.line === M.x1) && w.edge.lo >= M.y0 - 1 && w.edge.hi <= M.y1 + 1);
    const zone = (f, w) => {
      if (f === 'b') return F.plinth;
      const a = F.accentOn;
      const acc = (a === 'upper' && (f === 'f2' || f === 'f3')) || (a === 'lower' && f === 'f1' && fl.length > (p.basement ? 2 : 1)) || (a === 'wings' && !onMain(w));
      return acc ? F.accent : F.main;
    };
    for (const f of showFloors) {
      const y0 = DK.elev(p, f) / 1000, idx = fl.indexOf(f);
      const cutTop = mode === 'interior' && f === fid && cut;
      const hWall = cutTop ? Math.min(1.2, hc) : hc;
      const regs = DK.rooms(p, f);
      buildFloor(p, f, y0, hWall, hc, ext, F, zone, regs, cutTop ? hWall : hc + sl, f === 'f1' && !p.basement ? F.wainscot / 1000 : 0);
      if (idx > 0) slabCells(p, y0 - sl, sl, holesOf(p, f, regs), white);
      else slabCells(p, y0 - 0.1, 0.1, [], white);
      regs.forEach(r => {
        if (r.type === 'void') return;
        const wet = (DK.ROOM[r.type] || {}).wet;
        const m = wet ? mat({ m: 'tilefloor', c: '#dfe2e3' }) : mat({ m: 'wood', c: '#c9a77d' });
        r.cells.forEach(q => root.add(box((q[2] - q[0]) / 1000, 0.012, (q[3] - q[1]) / 1000, m, (q[0] + q[2]) / 2000, y0 + 0.006, (q[1] + q[3]) / 2000, { noShadow: true })));
      });
      const voids = regs.filter(r => r.type === 'void');
      const inVoid = (it) => voids.some(r => r.cells.some(c => it.x > c[0] && it.x < c[2] && it.y > c[1] && it.y < c[3]));
      if (showFurn && mode !== 'exterior') p.levels[f].furn.forEach(it => { if (!inVoid(it)) root.add(furn(it, y0)); });
      if (p.stair && idx < fl.length - 1) stair3d(p, y0);
      if (outside && F.belt && f !== 'b' && idx < fl.length - 1) belt(p, y0 + hc + sl / 2, ext, mat({ c: F.trim }));
    }
    if (outside) {
      const top = fl[fl.length - 1], yt = DK.elev(p, top) / 1000 + hc;
      slabCells(p, yt, sl, [], white);
      roof(p, yt + sl, ext, F);
      if (F.corners) corners(p, ext, mat({ c: F.trim }), DK.elev(p, fl[0]) / 1000 - (p.basement ? 0 : 0), yt + sl);
      if (!p.basement) porch(p, ext, F);
    }
    const R = Math.max(p.W, p.D) / 1000 * 1.6 + 8;
    sun.position.set(cx - R * 0.6, R * 0.95, cz + R * 0.8); sun.target.position.set(cx, 0, cz);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 0.8; sc.right = sc.top = R * 0.8; sc.near = 1; sc.far = R * 4; sc.updateProjectionMatrix();
    scene.background = outside ? SKY : new T.Color('#eceeef');
    amb.intensity = mode === 'walk' ? 0.5 : mode === 'interior' ? 0.18 : 0.06;
    walkData = mode === 'walk' ? walkPrep(p) : null;
  }

  function holesOf(p, f, regs) {
    const h = [];
    const r = DK.stairRect(p); if (r) h.push(r);
    regs.filter(q => q.type === 'void').forEach(q => q.cells.forEach(c => h.push({ x0: c[0], y0: c[1], x1: c[2], y1: c[3] })));
    return h;
  }
  /* плита перекрытия по контуру дома с проёмами: ячейки сжатой сетки, слитые по строкам */
  function slabCells(p, y, th, holes, m) {
    const xs = Array.from(new Set(p.poly.map(v => v.x).concat(...holes.map(h => [h.x0, h.x1])))).sort((a, b) => a - b);
    const ys = Array.from(new Set(p.poly.map(v => v.y).concat(...holes.map(h => [h.y0, h.y1])))).sort((a, b) => a - b);
    for (let j = 0; j < ys.length - 1; j++) {
      let run = null;
      const flush = () => { if (run) { root.add(box((run[1] - run[0]) / 1000, th, (ys[j + 1] - ys[j]) / 1000, m, (run[0] + run[1]) / 2000, y + th / 2, (ys[j] + ys[j + 1]) / 2000)); run = null; } };
      for (let i = 0; i < xs.length - 1; i++) {
        const x = (xs[i] + xs[i + 1]) / 2, yy = (ys[j] + ys[j + 1]) / 2;
        const ok = DK.inside(p.poly, x, yy) && !holes.some(h => x > h.x0 && x < h.x1 && yy > h.y0 && yy < h.y1);
        if (ok) { if (run) run[1] = xs[i + 1]; else run = [xs[i], xs[i + 1]]; } else flush();
      }
      flush();
    }
  }

  /* стены этажа: несущий слой, облицовка по зонам, перегородки, ограждения, проёмы */
  function buildFloor(p, f, y0, hWall, hc, ext, F, zone, regs, hClad, wains) {
    const ws = DK.walls(p, f), ops = p.levels[f].open;
    for (const w of ws) {
      const my = ops.filter(o => o.wall === w.id).map(o => Object.assign({}, o, DK.opSize(p, o))).sort((a, b) => a.c - b.c);
      if (w.rail) { railing(w, y0); continue; }
      const outer = w.kind === 'outer';
      const pieces = (sec, hLo, hHi, m) => {
        const seg = (a0, a1, h0, h1) => {
          if (a1 - a0 < 1 || h1 - h0 < 0.001) return;
          const L = (a1 - a0) / 1000, Tt = (sec.t1 - sec.t0) / 1000, ac = (a0 + a1) / 2000, tc = (sec.t0 + sec.t1) / 2000;
          root.add(box(w.axis === 'x' ? L : Tt, h1 - h0, w.axis === 'x' ? Tt : L, m, w.axis === 'x' ? ac : tc, y0 + (h0 + h1) / 2, w.axis === 'x' ? tc : ac));
        };
        let a = sec.a0;
        for (const o of my) {
          const o0 = o.c - o.w / 2, o1 = o.c + o.w / 2, s = o.sill / 1000, top = (o.sill + o.h) / 1000;
          if (o1 <= sec.a0 || o0 >= sec.a1) continue;
          seg(a, o0, hLo, hHi);
          seg(o0, o1, hLo, Math.min(hHi, s));
          seg(o0, o1, Math.max(hLo, top), hHi);
          a = o1;
        }
        seg(a, sec.a1, hLo, hHi);
      };
      const t0 = w.axis === 'x' ? w.y0 : w.x0, t1 = w.axis === 'x' ? w.y1 : w.x1;
      pieces({ t0, t1, a0: w.a0, a1: w.a1 }, 0, hWall, outer ? white : wallIn);
      if (outer && ext > 0) {
        const cr = DK.cladRect(p, w, ext), zm = mat(zone(f, w));
        if (wains > 0) { pieces(cr, 0, Math.min(wains, hClad), mat(F.plinth)); pieces(cr, wains, hClad, zm); }
        else pieces(cr, 0, hClad, zm);
      }
      for (const o of my) root.add(opening(p, f, w, o, y0, hWall, ext / 1000, F, regs));
    }
  }
  function railing(w, y0) {
    const m = mat({ c: '#2f3237' }, { metalness: 0.5, roughness: 0.4 }), gl = new T.MeshStandardMaterial({ color: 0xcfe3ec, transparent: true, opacity: 0.3, roughness: 0.05 });
    const L = (w.a1 - w.a0) / 1000, ac = (w.a0 + w.a1) / 2000, mm = w.m / 1000, ax = w.axis === 'x';
    root.add(box(ax ? L : 0.05, 0.05, ax ? 0.05 : L, m, ax ? ac : mm, y0 + 1.0, ax ? mm : ac));
    root.add(box(ax ? L : 0.012, 0.85, ax ? 0.012 : L, gl, ax ? ac : mm, y0 + 0.5, ax ? mm : ac, { noShadow: true }));
    for (let a = w.a0; a <= w.a1 + 1; a += Math.max(600, (w.a1 - w.a0) / Math.ceil((w.a1 - w.a0) / 1200))) root.add(box(0.04, 1.0, 0.04, m, ax ? a / 1000 : mm, y0 + 0.5, ax ? mm : a / 1000));
  }
  function belt(p, y, ext, m) {
    for (const w of DK.walls(p, 'f1').filter(v => v.kind === 'outer')) {
      const cr = DK.cladRect(p, w, ext), L = (cr.a1 - cr.a0) / 1000 + 0.12, ac = (cr.a0 + cr.a1) / 2000;
      const tc = (w.out < 0 ? cr.t0 : cr.t1) / 1000 + w.out * 0.03;
      root.add(w.axis === 'x' ? box(L, 0.2, 0.06, m, ac, y, tc) : box(0.06, 0.2, L, m, tc, y, ac));
    }
  }
  function corners(p, ext, m, y0, y1) {
    const P = DK.offsetPoly(p, ext + 15), E = DK.edges(p);
    P.forEach((q, i) => { if (E[(i - 1 + E.length) % E.length].convexB) root.add(box(0.15, y1 - y0, 0.15, m, q.x / 1000, (y0 + y1) / 2, q.y / 1000)); });
  }
  function porch(p, ext, F) {
    const ent = p.levels.f1.open.find(o => o.kind === 'entry'); if (!ent) return;
    const w = DK.walls(p, 'f1').find(v => v.id === ent.wall); if (!w) return;
    const n = w.out, face = (w.line + n * ext) / 1000, ac = ent.c / 1000, wd = ent.w / 1000 + 1.4, cm = mat({ m: 'concrete', c: '#c9c6bf' });
    const P = (along, out, wA, dOut, y, h) => w.axis === 'x' ? box(wA, h, dOut, cm, along, y, face + n * out) : box(dOut, h, wA, cm, face + n * out, y, along);
    root.add(P(ac, 0.7, wd, 1.4, -0.3, 0.6));
    for (let k = 1; k <= 3; k++) root.add(P(ac, 1.4 + 0.15 + (k - 1) * 0.3, wd, 0.3, -0.6 + (0.6 - k * 0.15) / 2, 0.6 - k * 0.15));
    root.add(P(ac, 2.3 + 3.5, 1.3, 7, -0.595, 0.02));
  }

  function opening(p, f, w, o, y0, hWall, e, F, regs) {
    const g = new T.Group(), outer = w.kind === 'outer', along = w.axis === 'x';
    const frameM = mat({ c: F.frame }, { roughness: 0.55 });
    const tOut = outer ? w.line / 1000 : w.m / 1000, dirOut = outer ? w.out : 0;
    const ow = o.w / 1000, sill = o.sill / 1000, oh = Math.min(o.h / 1000, hWall - sill), ac = o.c / 1000;
    const place = (mesh, a, y, t) => { mesh.position.set(along ? a : t, y, along ? t : a); return mesh; };
    const mk = (wA, h, d, m) => box(along ? wA : d, h, along ? d : wA, m, 0, 0, 0);
    if (oh <= 0.01) return g;
    if (o.kind === 'win') {
      const tc = tOut - dirOut * 0.06, prof = 0.07, depth = 0.08;
      g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + prof / 2, tc));
      if (sill + oh <= hWall + 0.001) g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + oh - prof / 2, tc));
      g.add(place(mk(prof, oh, depth, frameM), ac - ow / 2 + prof / 2, y0 + sill + oh / 2, tc));
      g.add(place(mk(prof, oh, depth, frameM), ac + ow / 2 - prof / 2, y0 + sill + oh / 2, tc));
      const n = o.sash || (o.w >= 1300 ? 2 : 1);
      for (let i = 1; i < n; i++) g.add(place(mk(prof * 1.2, oh, depth, frameM), ac - ow / 2 + ow * i / n, y0 + sill + oh / 2, tc));
      if (!o.pano && oh > 1.2 && n <= 2) g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + oh * 0.74, tc));
      const glass = new T.MeshStandardMaterial({ color: mode === 'exterior' ? lin('#3e5566') : lin('#b9d3e2'), transparent: true, opacity: mode === 'exterior' ? 0.82 : 0.22, roughness: 0.04, metalness: 0.6 });
      const gl = place(mk(ow - 0.04, oh - 0.04, 0.01, glass), ac, y0 + sill + oh / 2, tc); gl.castShadow = false;
      g.add(gl);
      if (outer && !o.pano && sill > 0.1) g.add(place(mk(ow + 0.08, 0.025, e + 0.1, mat({ c: F.frame === '#ffffff' ? '#e6e6e3' : F.frame })), ac, y0 + sill - 0.012, tOut + dirOut * (e / 2 + 0.02)));
      if (outer && mode !== 'interior' && F.surrounds) {
        const tm = mat({ c: F.trim }), sur = 0.14, tt = tOut + dirOut * (e + 0.02), b = o.pano ? 0 : 1;
        g.add(place(mk(ow + 2 * sur, sur, 0.05, tm), ac, y0 + sill + oh + sur / 2, tt));
        if (b) g.add(place(mk(ow + 2 * sur, sur * 0.8, 0.06, tm), ac, y0 + sill - sur * 0.4, tt));
        g.add(place(mk(sur, oh, 0.05, tm), ac - ow / 2 - sur / 2, y0 + sill + oh / 2, tt));
        g.add(place(mk(sur, oh, 0.05, tm), ac + ow / 2 + sur / 2, y0 + sill + oh / 2, tt));
      }
    } else if (o.kind === 'pass') {
      // проём без двери — без коробки
    } else {
      const entry = o.kind === 'entry';
      const dm = mat({ c: entry ? F.door : '#ebe7e0' }, { roughness: 0.6 });
      const casing = mat({ c: entry ? F.frame : '#ffffff' });
      const tc = outer ? tOut - dirOut * 0.1 : w.m / 1000, th = (w.t / 1000) + 0.02;
      g.add(place(mk(ow, 0.05, outer ? 0.1 : th, casing), ac, y0 + oh - 0.025, tc));
      g.add(place(mk(0.05, oh, outer ? 0.1 : th, casing), ac - ow / 2 + 0.025, y0 + oh / 2, tc));
      g.add(place(mk(0.05, oh, outer ? 0.1 : th, casing), ac + ow / 2 - 0.025, y0 + oh / 2, tc));
      const sw = DK.doorSwing(p, f, o, w, regs);
      const closed = entry && mode !== 'walk';
      if (closed) {
        g.add(place(mk(ow - 0.1, oh - 0.05, 0.05, dm), ac, y0 + (oh - 0.05) / 2, tc));
        const glass = new T.MeshStandardMaterial({ color: lin('#3e5566'), roughness: 0.05, metalness: 0.6 });
        g.add(place(mk(0.16, oh * 0.7, 0.06, glass), ac - ow / 2 + 0.22, y0 + oh * 0.5, tc));
        g.add(place(mk(0.04, 0.3, 0.08, mat({ c: '#b8b8b5' }, { metalness: 0.8, roughness: 0.3 })), ac + ow / 2 - 0.15, y0 + 1.0, tc));
      } else {
        const len = ow - 0.1, face = (outer ? tc : w.m / 1000) + sw.side * (outer ? 0.05 : w.t / 2000), ha = sw.hingeLo ? ac - ow / 2 + 0.05 : ac + ow / 2 - 0.05;
        const leaf = along ? box(0.04, oh - 0.05, len, dm, ha, y0 + (oh - 0.05) / 2, face + sw.side * len / 2) : box(len, oh - 0.05, 0.04, dm, face + sw.side * len / 2, y0 + (oh - 0.05) / 2, ha);
        g.add(leaf);
      }
    }
    if (outer) {
      g.userData.pick = { kind: 'open', id: o.id };
      g.traverse(m => { if (m.isMesh) m.userData.pickRoot = g; });
      picks.push(g);
    }
    return g;
  }

  function furn(it, y0) {
    const F = DK.FURN[it.type], g = new T.Group();
    if (!F) return g;
    const w = F.w / 1000, d = F.d / 1000, h = F.h / 1000, m = mat({ c: F.c }, { roughness: 0.85 });
    const soft = mat({ c: '#f7f5f0' }), dark = mat({ c: '#3a3c40' }), wood = mat({ c: '#8e6a4b' });
    const add = (bw, bh, bd, mm, x, y, z) => g.add(box(bw, bh, bd, mm, x, y, z));
    const T0 = it.type;
    if (T0.startsWith('bed')) {
      add(w, 0.3, d, wood, 0, 0.15, 0); add(w - 0.06, 0.22, d - 0.12, soft, 0, 0.41, 0.04);
      add(w, h - 0.3, 0.08, wood, 0, 0.3 + (h - 0.3) / 2, -d / 2 + 0.04);
      add(w - 0.1, 0.06, d * 0.55, m, 0, 0.54, d * 0.2);
      const n = T0 === 'bed160' ? 2 : 1;
      for (let i = 0; i < n; i++) add(n === 2 ? w / 2 - 0.15 : w - 0.2, 0.12, 0.35, soft, n === 2 ? (i ? 1 : -1) * w / 4 : 0, 0.58, -d / 2 + 0.3);
    } else if (T0 === 'sofa' || T0 === 'armchair') {
      add(w, 0.42, d, m, 0, 0.21, 0); add(w, h - 0.42, 0.22, m, 0, 0.42 + (h - 0.42) / 2, -d / 2 + 0.11);
      add(0.18, 0.62, d, m, -w / 2 + 0.09, 0.31, 0); add(0.18, 0.62, d, m, w / 2 - 0.09, 0.31, 0);
    } else if (T0 === 'table' || T0 === 'desk' || T0 === 'coffee') {
      add(w, 0.04, d, m, 0, h - 0.02, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.05, h - 0.04, 0.05, m, sx * (w / 2 - 0.06), (h - 0.04) / 2, sz * (d / 2 - 0.06));
      if (T0 === 'table') for (const sz of [-1, 1]) for (const q of [-1, 0, 1]) { add(0.42, 0.45, 0.42, mat({ c: '#d9d2c6' }), q * 0.48, 0.225, sz * (d / 2 + 0.28)); add(0.42, 0.45, 0.05, mat({ c: '#d9d2c6' }), q * 0.48, 0.67, sz * (d / 2 + 0.47)); }
    } else if (T0 === 'kitchen' || T0 === 'kitchenS' || T0 === 'island') {
      add(w, 0.86, d, m, 0, 0.43, 0); add(w + 0.02, 0.04, d + 0.02, mat({ c: '#d8d4cc' }), 0, 0.88, 0);
      add(0.55, 0.01, 0.45, dark, -w / 2 + 0.9, 0.905, 0);
      if (T0 !== 'island') add(w, 0.7, 0.35, m, 0, 1.55 + 0.35, -d / 2 + 0.175);
    } else if (T0 === 'toilet') {
      add(w * 0.9, 0.4, 0.2, m, 0, 0.6, -d / 2 + 0.1); add(w * 0.85, 0.4, d - 0.2, m, 0, 0.2, 0.1);
    } else if (T0 === 'sink') {
      add(w, 0.15, d, m, 0, h - 0.075, 0); add(w * 0.8, h - 0.15, d * 0.8, mat({ c: '#c9b79c' }), 0, (h - 0.15) / 2, 0);
    } else if (T0 === 'bath') {
      add(w, h, d, m, 0, h / 2, 0); add(w - 0.12, 0.02, d - 0.12, mat({ c: '#cfe3ec' }), 0, h - 0.04, 0);
    } else if (T0 === 'shower') {
      add(w, 0.06, d, m, 0, 0.03, 0);
      const gl = new T.MeshStandardMaterial({ color: 0xcfe3ec, transparent: true, opacity: 0.35 });
      add(w, 1.95, 0.01, gl, 0, 1.0, d / 2); add(0.01, 1.95, d, gl, w / 2, 1.0, 0);
    } else if (T0 === 'boiler') {
      add(w, h, d, m, 0, F.wall / 1000 + h / 2, 0); add(0.08, 1.2, 0.08, mat({ c: '#c9c9c9' }), 0, F.wall / 1000 + h + 0.5, -d / 4);
    } else if (T0 === 'car') {
      add(w, 0.75, d, m, 0, 0.55, 0); add(w * 0.88, 0.5, d * 0.5, mat({ c: '#59606a' }), 0, 1.15, 0.1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.22, 0.6, 0.6, dark, sx * (w / 2 - 0.12), 0.3, sz * (d / 2 - 0.8));
    } else add(w, h, d, m, 0, h / 2, 0);
    g.position.set(it.x / 1000, y0 + 0.012, it.y / 1000);
    g.rotation.y = -it.rot * Math.PI / 2;
    return g;
  }

  /* лестница: марши ступенями, площадки плитой, винтовая — секторами вокруг стойки */
  function stair3d(p, y0) {
    const s = p.stair, P = DK.stairParts(s), Ht = DK.storey(p) / 1000, n = Math.round(Ht * 1000 / 175);
    const m = mat({ m: 'wood', c: '#b98b5e' }), rail = mat({ c: '#2f3237' }, { metalness: 0.5, roughness: 0.4 });
    const W = (u, v) => DK.stairToWorld(s, u, v).map(q => q / 1000);
    if (P.spiral) {
      const S = P.spiral, ctr = W(S.cu, S.cv), k = Math.round(n * 1.05);
      root.add(box(0.12, Ht, 0.12, rail, ctr[0], y0 + Ht / 2, ctr[1]));
      for (let i = 0; i < k; i++) {
        const fr = (i + 0.5) / k, a = -Math.PI / 2 + fr * Math.PI * 2 * S.turn, r = S.r / 1000;
        const dir = DK.stairDir(s, [Math.cos(a), Math.sin(a)]);
        const st = box(r, 0.04, 0.36, m, ctr[0] + dir[0] * r / 2, y0 + Ht * (i + 1) / (k + 1), ctr[1] + dir[1] * r / 2);
        st.rotation.y = -Math.atan2(dir[1], dir[0]);
        root.add(st);
      }
      return;
    }
    const tot = P.flights.reduce((a, f) => a + (f.d[0] ? f.u1 - f.u0 : f.v1 - f.v0), 0);
    for (const f of P.flights) {
      const len = f.d[0] ? f.u1 - f.u0 : f.v1 - f.v0, k = Math.max(2, Math.round(n * len / tot)), step = len / k;
      for (let i = 0; i < k; i++) {
        const pr = (i + 0.5) * step;
        const u = f.d[0] > 0 ? f.u0 + pr : f.d[0] < 0 ? f.u1 - pr : (f.u0 + f.u1) / 2;
        const v = f.d[1] > 0 ? f.v0 + pr : f.d[1] < 0 ? f.v1 - pr : (f.v0 + f.v1) / 2;
        const c = W(u, v), wd = (f.d[0] ? f.v1 - f.v0 : f.u1 - f.u0) / 1000;
        const dw = DK.stairDir(s, f.d), alongX = dw[0] !== 0;
        const hgt = y0 + Ht * (f.h0 + (f.h1 - f.h0) * (i + 1) / (k + (P.flights.length > 1 && f === P.flights[0] ? 0 : 0))) ;
        root.add(box(alongX ? step / 1000 + 0.02 : wd, 0.04, alongX ? wd : step / 1000 + 0.02, m, c[0], hgt - 0.02, c[1]));
      }
    }
    for (const L of P.lands) {
      const a = W(L.u0, L.v0), b = W(L.u1, L.v1);
      root.add(box(Math.abs(b[0] - a[0]), 0.06, Math.abs(b[1] - a[1]), m, (a[0] + b[0]) / 2, y0 + Ht * L.h - 0.03, (a[1] + b[1]) / 2));
    }
  }

  /* ---------- кровли: разбиение контура на прямоугольники, крылья заходят в основной объём ---------- */
  function roof(p, yt, ext, F) {
    const t = p.roof.type, e = ext / 1000;
    const rm = mat(F.roof, { side: T.DoubleSide, roughness: 0.8 }), sm = mat({ c: F.soffit }, { side: T.DoubleSide }), fm = mat({ c: F.soffit });
    const gm = mat(F.gable || (DK.floorsOf(p).length > 1 && F.accentOn === 'upper' ? F.accent : F.main), { side: T.DoubleSide });
    if (t === 'flat') {
      const P = DK.offsetPoly(p, ext);
      root.add(extrudePoly(P, yt, 0.05, mat({ c: '#5a5d62' })));
      const pm = mat(F.accentOn === 'upper' ? F.accent : F.main), cap = mat({ c: F.trim });
      for (const w of DK.walls(p, 'f1').filter(v => v.kind === 'outer')) {
        const cr = DK.cladRect(p, w, ext), L = (cr.a1 - cr.a0) / 1000, ac = (cr.a0 + cr.a1) / 2000;
        const tc = (w.out < 0 ? cr.t0 + 125 : cr.t1 - 125) / 1000;
        root.add(w.axis === 'x' ? box(L, 0.55, 0.25, pm, ac, yt + 0.275, tc) : box(0.25, 0.55, L, pm, tc, yt + 0.275, ac));
        root.add(w.axis === 'x' ? box(L + 0.02, 0.04, 0.3, cap, ac, yt + 0.57, tc) : box(0.3, 0.04, L + 0.02, cap, tc, yt + 0.57, ac));
      }
      return;
    }
    const rects = DK.decompose(p).map(r => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, j: {} }));
    for (let k = 1; k < rects.length; k++) {
      const r = rects[k];
      for (let q = 0; q < k; q++) {
        const o = rects[q], ox = Math.min(r.x1, o.x1) - Math.max(r.x0, o.x0), oz = Math.min(r.y1, o.y1) - Math.max(r.y0, o.y0);
        if (r.y0 === o.y1 && ox > 0) { r.y0 -= (o.y1 - o.y0) / 2; r.j.z0 = 1; break; }
        if (r.y1 === o.y0 && ox > 0) { r.y1 += (o.y1 - o.y0) / 2; r.j.z1 = 1; break; }
        if (r.x0 === o.x1 && oz > 0) { r.x0 -= (o.x1 - o.x0) / 2; r.j.x0 = 1; break; }
        if (r.x1 === o.x0 && oz > 0) { r.x1 += (o.x1 - o.x0) / 2; r.j.x1 = 1; break; }
      }
    }
    rects.forEach((r, k) => {
      const W = { x0: r.x0 / 1000 - (r.j.x0 ? 0 : e), x1: r.x1 / 1000 + (r.j.x1 ? 0 : e), z0: r.y0 / 1000 - (r.j.z0 ? 0 : e), z1: r.y1 / 1000 + (r.j.z1 ? 0 : e) };
      const longX = (W.x1 - W.x0) >= (W.z1 - W.z0);
      const ridgeX = k === 0 && p.roof.ridge === 'short' ? !longX : longX;
      roofRect(W, r.j, ridgeX, t, yt, (p.roof.pitch || DK.ROOFS[t].pitch) * Math.PI / 180, rm, sm, fm, gm);
    });
  }
  function roofRect(W, J, ridgeX, t, yt, pitch, rm, sm, fm, gm) {
    const ov = 0.55, tn = Math.tan(pitch);
    const wU0 = ridgeX ? W.x0 : W.z0, wU1 = ridgeX ? W.x1 : W.z1, wV0 = ridgeX ? W.z0 : W.x0, wV1 = ridgeX ? W.z1 : W.x1;
    const jU0 = ridgeX ? J.x0 : J.z0, jU1 = ridgeX ? J.x1 : J.z1, jV0 = ridgeX ? J.z0 : J.x0, jV1 = ridgeX ? J.z1 : J.x1;
    const U0 = wU0 - (jU0 ? 0 : ov), U1 = wU1 + (jU1 ? 0 : ov), V0 = wV0 - (jV0 ? 0 : ov), V1 = wV1 + (jV1 ? 0 : ov);
    const P = (u, y, v) => ridgeX ? [u, y, v] : [v, y, u];
    const half = (wV1 - wV0) / 2, vc = (wV0 + wV1) / 2, yE = yt - ov * tn;
    const uvA = ridgeX ? 2 : 0;
    if (t === 'gable') {
      const yR = yt + half * tn;
      roofPlane([P(U0, yE, V0), P(U1, yE, V0), P(U1, yR, vc), P(U0, yR, vc)], rm, sm, fm);
      roofPlane([P(U1, yE, V1), P(U0, yE, V1), P(U0, yR, vc), P(U1, yR, vc)], rm, sm, fm);
      if (!jU0) root.add(poly([P(wU0, yt, wV0), P(wU0, yt, wV1), P(wU0, yR, vc)], gm, uvA, 1));
      if (!jU1) root.add(poly([P(wU1, yt, wV0), P(wU1, yt, wV1), P(wU1, yR, vc)], gm, uvA, 1));
    } else if (t === 'hip') {
      const hv = (V1 - V0) / 2, yR = yE + hv * tn, uc = (U0 + U1) / 2, rl = Math.max(0, (U1 - U0) / 2 - hv);
      const a = uc - rl, b = uc + rl;
      roofPlane([P(U0, yE, V0), P(U1, yE, V0), P(b, yR, vc), P(a, yR, vc)], rm, sm, fm);
      roofPlane([P(U1, yE, V1), P(U0, yE, V1), P(a, yR, vc), P(b, yR, vc)], rm, sm, fm);
      roofPlane([P(U0, yE, V1), P(U0, yE, V0), P(a, yR, vc)], rm, sm, fm);
      roofPlane([P(U1, yE, V0), P(U1, yE, V1), P(b, yR, vc)], rm, sm, fm);
    } else if (t === 'shed') {
      const yH = yt + (wV1 - wV0) * tn, yLo = yt - ov * tn, yHi = yH + ov * tn;
      roofPlane([P(U0, yLo, V0), P(U1, yLo, V0), P(U1, yHi, V1), P(U0, yHi, V1)], rm, sm, fm);
      for (const u of [wU0, wU1]) root.add(poly([P(u, yt, wV0), P(u, yt, wV1), P(u, yH, wV1)], gm, uvA, 1));
      root.add(poly([P(wU0, yt, wV1), P(wU1, yt, wV1), P(wU1, yH, wV1), P(wU0, yH, wV1)], gm, ridgeX ? 0 : 2, 1));
    } else if (t === 'mansard') {
      const a = half * 0.22, k1 = Math.tan(62 * Math.PI / 180), yB = yt + a * k1, yR = yB + (half - a) * tn;
      const vb0 = wV0 + a, vb1 = wV1 - a, yEl = yt - ov * k1 * 0.25;
      roofPlane([P(U0, yEl, V0), P(U1, yEl, V0), P(U1, yB, vb0), P(U0, yB, vb0)], rm, sm, fm);
      roofPlane([P(U1, yEl, V1), P(U0, yEl, V1), P(U0, yB, vb1), P(U1, yB, vb1)], rm, sm, fm);
      roofPlane([P(U0, yB, vb0), P(U1, yB, vb0), P(U1, yR, vc), P(U0, yR, vc)], rm, sm, fm);
      roofPlane([P(U1, yB, vb1), P(U0, yB, vb1), P(U0, yR, vc), P(U1, yR, vc)], rm, sm, fm);
      for (const u of [wU0, wU1]) if (!(u === wU0 ? jU0 : jU1)) root.add(poly([P(u, yt, wV0), P(u, yt, wV1), P(u, yB, vb1), P(u, yR, vc), P(u, yB, vb0)], gm, uvA, 1));
    }
  }

  /* ---------- прогулка: высота пола в точке, стены по этажам, лестница как пандус ---------- */
  function walkPrep(p) {
    const fl = DK.floorsOf(p), H = DK.storey(p) / 1000;
    const floors = fl.map(f => {
      const regs = DK.rooms(p, f), solid = [];
      for (const w of DK.walls(p, f)) {
        const doors = p.levels[f].open.filter(o => o.wall === w.id && o.kind !== 'win').map(o => [o.c - o.w / 2 + 60, o.c + o.w / 2 - 60]).sort((a, b) => a[0] - b[0]);
        let a = w.a0;
        const push = (a0, a1) => { if (a1 > a0) solid.push(w.axis === 'x' ? [a0, w.y0, a1, w.y1] : [w.x0, a0, w.x1, a1]); };
        for (const d of doors) { push(a, d[0]); a = d[1]; }
        push(a, w.a1);
      }
      for (const it of p.levels[f].furn) { const F = DK.FURN[it.type]; if (F && F.h > 300 && it.type !== 'boiler') { const b = DK.furnBox(it); solid.push([b.x0, b.y0, b.x1, b.y1]); } }
      return { f, e: DK.elev(p, f) / 1000, solid: solid.map(r => r.map(v => v / 1000)), voids: regs.filter(r => r.type === 'void') };
    });
    return { p, fl, H, floors, sr: DK.stairRect(p) };
  }
  function groundAt(x, z, h) {
    const D = walkData, p = D.p, X = x * 1000, Z = z * 1000;
    const sh = DK.stairHeight(p, X, Z);
    if (sh != null) {
      let best = null;
      for (let k = 0; k < D.floors.length - 1; k++) { const g = D.floors[k].e + sh * D.H; if (best == null || Math.abs(g - h) < Math.abs(best - h)) best = g; }
      if (best != null) return best;
    }
    const cur = D.floors.reduce((a, b) => Math.abs(b.e - h) < Math.abs(a.e - h) ? b : a);
    if (!DK.inside(p.poly, X, Z)) return cur.f === 'f1' || cur.f === D.fl[0] ? cur.e : null;
    if (D.sr && X > D.sr.x0 && X < D.sr.x1 && Z > D.sr.y0 && Z < D.sr.y1 && cur !== D.floors[0]) return null;
    if (cur.voids.some(r => r.cells.some(c => X > c[0] && X < c[2] && Z > c[1] && Z < c[3]))) return null;
    return cur.e;
  }
  function blockedAt(x, z, h) {
    const D = walkData, rad = 0.22;
    const ctx = D.floors.filter(f => f.e <= h + 0.3).pop() || D.floors[0];
    return ctx.solid.some(r => x > r[0] - rad && x < r[2] + rad && z > r[1] - rad && z < r[3] + rad);
  }
  function tryMove(nx, nz) {
    const g = groundAt(nx, nz, walk.h);
    if (g == null || Math.abs(g - walk.h) > 0.45 || blockedAt(nx, nz, g)) return false;
    walk.x = nx; walk.z = nz; walk.h = g; return true;
  }

  /* ---------- камера ---------- */
  function frame() {
    const p = app.p(), fl = DK.floorsOf(p), R = Math.max(p.W, p.D) / 1000;
    orbit.tx = p.W / 2000; orbit.tz = p.D / 2000;
    if (mode === 'exterior') { orbit.ty = (DK.elev(p, fl[fl.length - 1]) / 1000 + p.hClear / 1000) / 2; orbit.r = R * 2.0 + 7; orbit.el = 0.24; orbit.az = -0.62; }
    else { orbit.ty = DK.elev(p, fid) / 1000; orbit.r = R * 1.45 + 3; orbit.el = 0.95; orbit.az = -0.6; }
  }
  function startWalk(f) {
    const p = app.p(), regs = DK.rooms(p, f), ent = p.levels[f].open.find(o => o.kind === 'entry');
    let r = regs.filter(q => q.type !== 'void').sort((a, b) => b.area - a.area)[0];
    if (ent) { const rs = DK.opRegions(p, f, ent, regs); if (rs[0]) r = rs[0]; }
    walk.x = r ? r.cx / 1000 : p.W / 2000; walk.z = r ? r.cy / 1000 : p.D / 2000;
    walk.h = DK.elev(p, f) / 1000; walk.pitch = 0;
    if (ent && f === 'f1') {
      const w = DK.walls(p, f).find(v => v.id === ent.wall);
      if (w) {
        const back = (w.line - w.out * (DK.ts(p) + 1100)) / 1000;
        if (w.axis === 'x') { walk.x = ent.c / 1000; walk.z = back; } else { walk.x = back; walk.z = ent.c / 1000; }
        walk.yaw = w.axis === 'x' ? (w.out > 0 ? 0 : Math.PI) : w.out * Math.PI / 2;
      }
    }
  }
  function placeCam() {
    if (mode === 'walk') {
      cam.position.set(walk.x, walk.h + 1.6, walk.z);
      cam.rotation.order = 'YXZ'; cam.rotation.set(walk.pitch, walk.yaw, 0);
      cam.fov = 72;
    } else {
      cam.fov = mode === 'exterior' ? 38 : 45;
      const c = Math.cos(orbit.el);
      cam.position.set(orbit.tx + orbit.r * c * Math.sin(orbit.az), orbit.ty + orbit.r * Math.sin(orbit.el), orbit.tz + orbit.r * c * Math.cos(orbit.az));
      cam.lookAt(orbit.tx, orbit.ty, orbit.tz);
    }
    cam.updateProjectionMatrix();
  }

  /* ---------- ввод ---------- */
  const ptr = new Map();
  let drag = null, pinch = null;
  const ray = new T.Raycaster();
  function hit(e) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -(e.clientY - r.top) / r.height * 2 + 1 }, cam);
    const hs = ray.intersectObjects(picks, true);
    return hs.length ? hs[0] : null;
  }
  function findOp(p, id) {
    for (const f of DK.floorsOf(p)) { const o = p.levels[f].open.find(q => q.id === id); if (o) return { o, fid: f }; }
    return null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = Array.from(ptr.values()); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: orbit.r }; drag = null; return; }
    if (mode === 'walk') {
      if (e.pointerType === 'mouse' && canvas.requestPointerLock && document.pointerLockElement !== canvas) { try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (err) { /* без захвата мыши */ } }
      drag = { kind: 'look', x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', half: e.clientX - canvas.getBoundingClientRect().left < canvas.clientWidth / 2 };
      return;
    }
    const h = mode === 'exterior' ? hit(e) : null;
    if (h && e.button === 0) {
      const pk = h.object.userData.pickRoot.userData.pick;
      app.pick3d(pk);
      const p = app.p(), op = findOp(p, pk.id);
      if (op && op.o.kind === 'win') {
        const w = DK.walls(p, op.fid).find(v => v.id === op.o.wall);
        const n = w.axis === 'x' ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0);
        drag = { kind: 'win', op, w, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, h.point), a0: w.axis === 'x' ? h.point.x : h.point.z, c0: op.o.c, x: e.clientX, y: e.clientY };
        return;
      }
    } else if (mode === 'exterior' && e.button === 0) app.pick3d(null);
    drag = { kind: (e.button === 2 || e.shiftKey) ? 'pan' : 'rot', x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptr.size === 2) { const [a, b] = Array.from(ptr.values()); orbit.r = Math.max(2, Math.min(180, pinch.r * pinch.d / Math.hypot(a.x - b.x, a.y - b.y))); placeCam(); return; }
    if (mode === 'walk' && document.pointerLockElement === canvas) { walk.yaw -= e.movementX * 0.0025; walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - e.movementY * 0.0025)); placeCam(); return; }
    if (!drag) { if (mode === 'exterior') canvas.style.cursor = hit(e) ? 'ew-resize' : 'grab'; return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.kind === 'look') {
      if (drag.touch && drag.half) { walk.touchMove = { f: -dy / 60, s: dx / 60 }; return; }
      walk.yaw -= dx * 0.004; walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - dy * 0.004)); drag.x = e.clientX; drag.y = e.clientY; placeCam(); return;
    }
    if (drag.kind === 'win') {
      const r = canvas.getBoundingClientRect(), pt = new T.Vector3();
      ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -(e.clientY - r.top) / r.height * 2 + 1 }, cam);
      if (!ray.ray.intersectPlane(drag.plane, pt)) return;
      const a = drag.w.axis === 'x' ? pt.x : pt.z, o = drag.op.o;
      const c = Math.round((drag.c0 + (a - drag.a0) * 1000) / 50) * 50;
      o.c = Math.max(drag.w.a0 + o.w / 2, Math.min(c, drag.w.a1 - o.w / 2));
      drag.moved = true; app.live(); schedule();
      return;
    }
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.kind === 'rot') { orbit.az -= dx * 0.006; orbit.el = Math.max(0.03, Math.min(1.5, orbit.el + dy * 0.005)); }
    else { const s = orbit.r * 0.0016; orbit.tx -= (Math.cos(orbit.az) * dx) * s; orbit.tz -= (-Math.sin(orbit.az) * dx) * s; orbit.ty += dy * s; }
    placeCam();
  });
  const up = (e) => {
    ptr.delete(e.pointerId);
    if (pinch) { if (ptr.size < 2) pinch = null; return; }
    if (drag && drag.kind === 'win' && drag.moved) app.commit('Окно сдвинуто');
    if (drag && drag.kind === 'look') walk.touchMove = null;
    drag = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (mode === 'walk') return; orbit.r = Math.max(2, Math.min(180, orbit.r * Math.exp(e.deltaY * 0.001))); placeCam(); }, { passive: false });
  window.addEventListener('keydown', (e) => { if (mode === 'walk' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { walk.keys[e.code] = true; if (/Arrow|Space/.test(e.code)) e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { walk.keys[e.code] = false; });

  /* ---------- цикл ---------- */
  let pending = false, last = performance.now(), running = false;
  function schedule() { pending = true; }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (pending) { pending = false; build(); }
    if (mode === 'walk' && walkData) {
      const k = walk.keys, sp = (k.ShiftLeft || k.ShiftRight ? 3.0 : 1.5) * dt;
      let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (walk.touchMove) { f = Math.max(-1, Math.min(1, walk.touchMove.f)); s = Math.max(-1, Math.min(1, walk.touchMove.s)); }
      if (f || s) {
        const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
        const nx = walk.x + (fx * f + rx * s) * sp, nz = walk.z + (fz * f + rz * s) * sp;
        // мелкими шагами, чтобы плавно подниматься по ступеням
        if (!tryMove(nx, nz)) { tryMove(nx, walk.z); tryMove(walk.x, nz); }
        const cur = walkData.floors.filter(q => q.e <= walk.h + 0.3).pop();
        if (cur && cur.f !== fid) { fid = cur.f; app.walkFloor && app.walkFloor(fid); }
      }
      placeCam();
    }
    renderer.render(scene, cam);
    requestAnimationFrame(loop);
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; placeCam();
  }
  window.addEventListener('resize', resize);

  return {
    show(m, f, opt) {
      const was = mode;
      mode = m; fid = f; cut = opt.cut; showFurn = opt.furn;
      if (document.pointerLockElement === canvas && m !== 'walk') document.exitPointerLock();
      build(); resize();
      if (m === 'walk') { if (was !== 'walk' || opt.refit) startWalk(f); } else if (was !== m || opt.refit) frame();
      placeCam();
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
    },
    stop() { running = false; if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    rebuild() { schedule(); },
    fit() { frame(); placeCam(); },
    zoom(f) { orbit.r = Math.max(2, Math.min(180, orbit.r * f)); placeCam(); },
    walkFloor(f) { fid = f; startWalk(f); placeCam(); },
    shot() { renderer.render(scene, cam); return canvas.toDataURL('image/png'); },
    walkState: () => walk,
    exteriorShot(w, h) {
      const keep = { mode, fid, cut, showFurn, o: Object.assign({}, orbit), size: renderer.getSize(new T.Vector2()), aspect: cam.aspect };
      mode = 'exterior'; build(); frame(); orbit.az = -0.6; orbit.el = 0.22;
      renderer.setSize(w, h, false); cam.aspect = w / h; placeCam(); renderer.render(scene, cam);
      const url = canvas.toDataURL('image/jpeg', 0.88);
      mode = keep.mode; fid = keep.fid; cut = keep.cut; showFurn = keep.showFurn; Object.assign(orbit, keep.o);
      renderer.setSize(keep.size.x, keep.size.y, false); cam.aspect = keep.aspect; build(); placeCam(); renderer.render(scene, cam);
      return url;
    },
    resize,
  };
}
DK.View3D = View3D;
})();
