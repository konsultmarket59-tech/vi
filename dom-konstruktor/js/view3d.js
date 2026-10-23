/* 3D: интерьер этажа, прогулка от первого лица, дом снаружи (белая модель, стили, кровли).
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

/* стили фасада: wall — основной слой, lower/upper — 1 этаж/верхние этажи, plinth — цоколь */
DK.STYLES = {
  white: { n: 'Белая модель', wall: { c: '#f3f2ef' }, plinth: { c: '#dddcd8' }, roof: { c: '#e3e3e0' }, frame: '#ffffff', ground: '#d5d9d0' },
  modern: { n: 'Современный', wall: { tex: 'plaster', c: '#ebe8e2' }, upper: { tex: 'planken', c: '#9b6a42' }, plinth: { tex: 'panel', c: '#4a4d52' }, roof: { tex: 'falz', c: '#3a3d42' }, frame: '#3b3e44', ground: '#9fb48a' },
  classic: { n: 'Классика', wall: { tex: 'plaster', c: '#eadcc3' }, plinth: { tex: 'stone', c: '#8d8478' }, roof: { tex: 'tile', c: '#7a4632' }, frame: '#ffffff', trims: '#ffffff', ground: '#9fb48a' },
  brick: { n: 'Кирпичный', wall: { tex: 'brick', c: '#9c4f3a' }, plinth: { tex: 'stone', c: '#5f5a55' }, roof: { tex: 'tile', c: '#3d3a39' }, frame: '#f4f4f4', trims: '#e9e4dc', ground: '#9fb48a' },
  scandi: { n: 'Скандинавский', wall: { tex: 'boards', c: '#2f3134' }, plinth: { c: '#262729' }, roof: { tex: 'falz', c: '#222325' }, frame: '#1d1e20', ground: '#9fb48a' },
  chalet: { n: 'Шале', wall: { tex: 'boards', c: '#a4744a' }, lower: { tex: 'stone', c: '#a29c92' }, plinth: { tex: 'stone', c: '#77716a' }, roof: { tex: 'tile', c: '#4b3a2e' }, frame: '#5a3d26', ground: '#9fb48a' },
  hitech: { n: 'Хай-тек', wall: { tex: 'panel', c: '#f1f1f0' }, lower: { tex: 'panel', c: '#3b3e44' }, plinth: { c: '#2f3237' }, roof: { c: '#55585d' }, frame: '#2b2d31', ground: '#a8b597' },
};
DK.ROOFS = {
  gable: { n: 'Двускатная', pitch: 30 },
  hip: { n: 'Вальмовая', pitch: 25 },
  mansard: { n: 'Ломаная мансардная', pitch: 25 },
  shed: { n: 'Односкатная', pitch: 10 },
  flat: { n: 'Плоская', pitch: 0 },
};

function View3D(canvas, app) {
  const T = window.THREE;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(50, 1, 0.05, 400);
  const hemi = new T.HemisphereLight(0xffffff, 0x9d978c, 0.5); scene.add(hemi);
  const sun = new T.DirectionalLight(0xfff6e8, 0.62);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target);
  const amb = new T.AmbientLight(0xffffff, 0.12); scene.add(amb);
  let root = null, mode = 'interior', fid = 'f1', cut = true, showFurn = true, picks = [];
  const orbit = { tx: 0, ty: 0, tz: 0, r: 20, az: -0.7, el: 0.75 };
  const walk = { x: 0, z: 0, y: 1.6, yaw: 0, pitch: 0, keys: {}, fid: 'f1', solid: [] };
  const texCache = {}, matCache = {};
  let white = null, wallIn = null;

  /* ---------- текстуры ---------- */
  function shade(hex, f) { const c = new T.Color(hex); c.multiplyScalar(f); return '#' + c.getHexString(); }
  function tex(kind, color) {
    const key = kind + color;
    if (texCache[key]) return texCache[key];
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'), rnd = mulberry(kind.length * 977 + parseInt(color.slice(1), 16) % 9973);
    g.fillStyle = color; g.fillRect(0, 0, 512, 512);
    if (kind === 'brick') { // 1 м: 4 кирпича × 13 рядов
      g.fillStyle = shade(color, 1.35); g.fillRect(0, 0, 512, 512);
      const rh = 512 / 13, bw = 512 / 4;
      for (let r = 0; r < 13; r++) for (let i = -1; i < 5; i++) {
        g.fillStyle = shade(color, 0.85 + rnd() * 0.3);
        g.fillRect(i * bw + (r % 2) * bw / 2 + 3, r * rh + 3, bw - 6, rh - 5);
      }
    } else if (kind === 'boards' || kind === 'planken') {
      const n = kind === 'boards' ? 7 : 8, vertical = kind === 'boards';
      for (let i = 0; i < n; i++) {
        g.fillStyle = shade(color, 0.9 + rnd() * 0.2);
        if (vertical) g.fillRect(i * 512 / n, 0, 512 / n - 4, 512); else g.fillRect(0, i * 512 / n, 512, 512 / n - 5);
        g.strokeStyle = shade(color, 0.8); g.globalAlpha = 0.25;
        for (let k = 0; k < 6; k++) { g.beginPath(); const o = rnd() * 512; if (vertical) { g.moveTo(i * 512 / n + rnd() * 60, 0); g.lineTo(i * 512 / n + rnd() * 60, 512); } else { g.moveTo(0, i * 512 / n + rnd() * 50); g.lineTo(512, i * 512 / n + rnd() * 50 + o * 0); } g.stroke(); }
        g.globalAlpha = 1;
      }
    } else if (kind === 'stone') {
      g.fillStyle = shade(color, 0.6); g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 64) for (let x = -40; x < 512;) {
        const w = 70 + rnd() * 90; g.fillStyle = shade(color, 0.8 + rnd() * 0.4);
        g.fillRect(x + 4, y + 4, w - 8, 56); x += w;
      }
    } else if (kind === 'panel') {
      g.strokeStyle = shade(color, 0.75); g.lineWidth = 4;
      for (let x = 0; x <= 512; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
      for (let y = 0; y <= 512; y += 512 / 1.6) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    } else if (kind === 'falz') {
      for (let x = 0; x < 512; x += 512 / 2) { g.fillStyle = shade(color, 1.25); g.fillRect(x, 0, 8, 512); g.fillStyle = shade(color, 0.75); g.fillRect(x + 8, 0, 5, 512); }
    } else if (kind === 'tile') {
      for (let y = 0; y < 512; y += 512 / 3) {
        const gr = g.createLinearGradient(0, y, 0, y + 512 / 3); gr.addColorStop(0, shade(color, 1.2)); gr.addColorStop(1, shade(color, 0.7));
        g.fillStyle = gr; g.fillRect(0, y, 512, 512 / 3);
        for (let x = 0; x < 512; x += 512 / 3) { g.fillStyle = shade(color, 0.65); g.fillRect(x, y, 6, 512 / 3); }
      }
    } else if (kind === 'plaster') {
      for (let i = 0; i < 9000; i++) { g.fillStyle = shade(color, 0.93 + rnd() * 0.12); g.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
    } else if (kind === 'wood') {
      for (let i = 0; i < 6; i++) { g.fillStyle = shade(color, 0.9 + rnd() * 0.2); g.fillRect(0, i * 512 / 6, 512, 512 / 6 - 3); }
    } else if (kind === 'tilefloor') {
      g.strokeStyle = shade(color, 0.85); g.lineWidth = 3;
      for (let x = 0; x <= 512; x += 512 / 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(512, x); g.stroke(); }
    }
    const t = new T.CanvasTexture(cv); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; t.encoding = T.sRGBEncoding;
    texCache[key] = t; return t;
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function mat(spec, extra) {
    spec = typeof spec === 'string' ? { c: spec } : spec;
    const key = JSON.stringify(spec) + JSON.stringify(extra || {});
    if (matCache[key]) return matCache[key];
    const o = Object.assign({ roughness: 0.92, metalness: 0 }, extra || {});
    if (spec.tex) { o.map = tex(spec.tex, spec.c); o.color = 0xffffff; } else o.color = new T.Color(spec.c);
    return (matCache[key] = new T.MeshStandardMaterial(o));
  }
  /* коробка с UV в метрах (текстура = 1 м) */
  function box(w, h, d, m, x, y, z, opt) {
    const g = new T.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), uv = g.attributes.uv;
    const dm = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dm[f][0], uv.getY(i) * dm[f][1]); }
    const mesh = new T.Mesh(g, m); mesh.position.set(x, y, z);
    mesh.castShadow = !(opt && opt.noShadow); mesh.receiveShadow = true;
    return mesh;
  }
  /* многоугольник по точкам (в одной плоскости), UV — по двум осям */
  function poly(pts, m, ua, va) {
    const pos = [], uv = [];
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) { pos.push(q[0], q[1], q[2]); uv.push(q[ua], q[va]); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }
  /* скат: UV вдоль ската и вдоль карниза */
  function slope(pts, m) {
    const a = new T.Vector3(...pts[0]), b = new T.Vector3(...pts[1]), c = new T.Vector3(...pts[pts.length - 1]);
    const u = b.clone().sub(a).normalize(), n = u.clone().cross(c.clone().sub(a)).normalize(), v = n.clone().cross(u).normalize();
    const pos = [], uv = [];
    const P = pts.map(q => new T.Vector3(...q));
    for (let i = 1; i < P.length - 1; i++) for (const q of [P[0], P[i], P[i + 1]]) { pos.push(q.x, q.y, q.z); const d = q.clone().sub(a); uv.push(d.dot(u), d.dot(v)); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new T.Mesh(g, m); mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  /* ---------- сборка ---------- */
  function build() {
    const p = app.p();
    if (root) { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    root = new T.Group(); scene.add(root); picks = [];
    const st = DK.STYLES[p.style] || DK.STYLES.white, ext = DK.extT(p);
    const fl = DK.floorsOf(p), H = DK.storey(p) / 1000, hc = p.hClear / 1000, sl = p.slab / 1000;
    const showFloors = mode === 'exterior' ? fl : fl.slice(0, fl.indexOf(fid) + 1);
    wallIn = mat({ c: '#f2f0ec' }); white = mat({ c: '#f6f5f2' });
    const plinthH = 0.6;
    const ground = p.basement ? DK.elev(p, 'b') / 1000 + 1.4 : -plinthH;
    // земля
    const gm = box(80, 0.05, 80, mat({ c: st.ground || '#e9ebe6' }), p.W / 2000, ground - 0.025, p.D / 2000, { noShadow: true });
    gm.castShadow = false; root.add(gm);
    const eX = -ext / 1000, eZ = -ext / 1000, oW = (p.W + 2 * ext) / 1000, oD = (p.D + 2 * ext) / 1000;
    // цоколь под 1 этажом без подвала
    if (!p.basement) root.add(box(oW + 0.04, plinthH, oD + 0.04, mat(st.plinth), eX + oW / 2, -plinthH / 2, eZ + oD / 2));
    for (const f of showFloors) {
      const y0 = DK.elev(p, f) / 1000, top = mode === 'interior' && f === fid;
      const hWall = top && cut ? Math.min(1.2, hc) : hc;
      const layer = f === 'b' ? (st.plinth) : (f === 'f1' ? (st.lower || st.wall) : (st.upper || st.wall));
      buildFloor(p, f, y0, hWall, hc, ext, layer, st, mode === 'exterior');
      // перекрытие под этажом (кроме 1 этажа без подвала)
      const hole = fl.indexOf(f) > 0 ? DK.stairRect(p) : null;
      if (f !== fl[0]) slab(p, y0 - sl, sl, hole, white);
      else root.add(box(p.W / 1000, 0.1, p.D / 1000, white, p.W / 2000, y0 - 0.05, p.D / 2000));
      // пол помещений
      DK.rooms(p, f).forEach(r => {
        const wet = (DK.ROOM[r.type] || {}).wet;
        const m = wet ? mat({ tex: 'tilefloor', c: '#dfe2e3' }) : mat({ tex: 'wood', c: '#cdb08a' });
        r.cells.forEach(q => root.add(box((q[2] - q[0]) / 1000, 0.012, (q[3] - q[1]) / 1000, m, (q[0] + q[2]) / 2000, y0 + 0.006, (q[1] + q[3]) / 2000, { noShadow: true })));
      });
      if (showFurn && mode !== 'exterior') p.levels[f].furn.forEach(it => root.add(furn(it, y0)));
      if (p.stair && fl.indexOf(f) < fl.length - 1) root.add(stair(p, y0));
      if (mode === 'walk' && f === fid) slab(p, y0 + hc, sl, f === fl[fl.length - 1] ? null : DK.stairRect(p), white);
    }
    if (mode === 'exterior' || mode === 'walk') {
      const yt = DK.elev(p, fl[fl.length - 1]) / 1000 + hc;
      if (mode === 'exterior') { slab(p, yt, sl, null, white); roof(p, yt + sl, ext, st); }
    }
    // солнце
    const cx = p.W / 2000, cz = p.D / 2000, R = Math.max(p.W, p.D) / 1000 * 1.6 + 8;
    sun.position.set(cx - R * 0.55, R * 0.9, cz + R * 0.75); sun.target.position.set(cx, 0, cz);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -R * 0.8; sc.right = sc.top = R * 0.8; sc.near = 1; sc.far = R * 4; sc.updateProjectionMatrix();
    scene.background = new T.Color(mode === 'exterior' ? '#dfe4ea' : '#eceeef');
    walk.solid = mode === 'walk' ? solids(p, fid) : [];
    amb.intensity = mode === 'walk' ? 0.55 : 0.12;
  }

  function slab(p, y, th, hole, m) {
    const W = p.W / 1000, D = p.D / 1000;
    if (!hole) { root.add(box(W, th, D, m, W / 2, y + th / 2, D / 2)); return; }
    const h = { x0: hole.x0 / 1000, x1: hole.x1 / 1000, z0: hole.y0 / 1000, z1: hole.y1 / 1000 };
    const add = (x0, x1, z0, z1) => { if (x1 - x0 > 0.001 && z1 - z0 > 0.001) root.add(box(x1 - x0, th, z1 - z0, m, (x0 + x1) / 2, y + th / 2, (z0 + z1) / 2)); };
    add(0, W, 0, h.z0); add(0, W, h.z1, D); add(0, h.x0, h.z0, h.z1); add(h.x1, W, h.z0, h.z1);
  }

  /* стены этажа с проёмами; у наружных — слой облицовки */
  function buildFloor(p, f, y0, hWall, hc, ext, layer, st, exterior) {
    const ws = DK.walls(p, f), ops = p.levels[f].open, e = ext / 1000;
    const clMat = mat(layer.tex ? layer : { c: layer.c });
    for (const w of ws) {
      const my = ops.filter(o => o.wall === w.id).map(o => Object.assign({}, o, DK.opSize(p, o))).sort((a, b) => a.c - b.c);
      const outer = w.kind === 'outer';
      const sections = [{ m: outer ? white : wallIn, t0: w.axis === 'x' ? w.y0 : w.x0, t1: w.axis === 'x' ? w.y1 : w.x1, a0: w.a0, a1: w.a1 }];
      if (outer && ext > 0) {
        const nw = w.id === 'N' || w.id === 'W', s0 = nw ? -ext : (w.axis === 'x' ? w.y1 : w.x1);
        sections.push({ m: clMat, t0: s0, t1: s0 + ext, a0: -ext, a1: (w.axis === 'x' ? p.W : p.D) + ext, clad: true });
      }
      for (const s of sections) {
        let a = s.a0;
        const piece = (a0, a1, h0, h1) => {
          if (a1 - a0 < 1 || h1 - h0 < 0.001) return;
          const L = (a1 - a0) / 1000, Tt = (s.t1 - s.t0) / 1000, ac = (a0 + a1) / 2000, tc = (s.t0 + s.t1) / 2000;
          const m = box(w.axis === 'x' ? L : Tt, h1 - h0, w.axis === 'x' ? Tt : L, s.m, w.axis === 'x' ? ac : tc, y0 + (h0 + h1) / 2, w.axis === 'x' ? tc : ac);
          root.add(m);
        };
        for (const o of my) {
          const o0 = o.c - o.w / 2, o1 = o.c + o.w / 2;
          piece(a, o0, 0, hWall);
          piece(o0, o1, 0, Math.min(o.sill / 1000, hWall));
          if ((o.sill + o.h) / 1000 < hWall) piece(o0, o1, (o.sill + o.h) / 1000, hWall);
          a = o1;
        }
        piece(a, s.a1, 0, hWall);
      }
      // окна и двери
      for (const o of my) root.add(opening(p, w, o, y0, hWall, e, st, exterior));
    }
    // венчающий пояс у классики
    if (exterior && st.trims && f !== 'b') {
      const W = p.W / 1000, D = p.D / 1000, y = y0 + hc - 0.08, m = mat({ c: st.trims }), th = 0.06;
      root.add(box(W + 2 * e + 2 * th, 0.16, th, m, W / 2, y, -e - th / 2)); root.add(box(W + 2 * e + 2 * th, 0.16, th, m, W / 2, y, D + e + th / 2));
      root.add(box(th, 0.16, D + 2 * e, m, -e - th / 2, y, D / 2)); root.add(box(th, 0.16, D + 2 * e, m, W + e + th / 2, y, D / 2));
    }
  }

  function opening(p, w, o, y0, hWall, e, st, exterior) {
    const g = new T.Group(), outer = w.kind === 'outer';
    const frameM = mat({ c: st.frame || '#ffffff' }, { roughness: 0.6 });
    const along = w.axis === 'x';
    const tOut = outer ? ((w.id === 'N' || w.id === 'W') ? (along ? w.y0 : w.x0) : (along ? w.y1 : w.x1)) / 1000 : w.m / 1000;
    const dirOut = outer ? ((w.id === 'N' || w.id === 'W') ? -1 : 1) : 0;
    const ow = o.w / 1000, sill = o.sill / 1000, oh = Math.min(o.h / 1000, hWall - sill);
    const ac = o.c / 1000;
    const place = (mesh, a, y, t) => { mesh.position.set(along ? a : t, y, along ? t : a); return mesh; };
    const mk = (wA, h, d, m) => box(along ? wA : d, h, along ? d : wA, m, 0, 0, 0);
    if (oh <= 0.01) return g;
    if (o.kind === 'win') {
      const tc = tOut - dirOut * 0.05, prof = 0.065, depth = 0.07;
      g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + prof / 2, tc));
      if (sill + oh <= hWall + 0.001) g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + oh - prof / 2, tc));
      g.add(place(mk(prof, oh, depth, frameM), ac - ow / 2 + prof / 2, y0 + sill + oh / 2, tc));
      g.add(place(mk(prof, oh, depth, frameM), ac + ow / 2 - prof / 2, y0 + sill + oh / 2, tc));
      const n = o.sash || (o.w >= 1300 ? 2 : 1);
      for (let i = 1; i < n; i++) g.add(place(mk(prof * 1.1, oh, depth, frameM), ac - ow / 2 + ow * i / n, y0 + sill + oh / 2, tc));
      if (!o.pano && oh > 1.2 && n <= 2) g.add(place(mk(ow, prof, depth, frameM), ac, y0 + sill + oh * 0.72, tc)); // фрамуга
      const glass = new T.MeshStandardMaterial({ color: exterior ? 0x4f6f86 : 0x9fc3d8, transparent: true, opacity: exterior ? 0.78 : 0.22, roughness: 0.05, metalness: 0.4 });
      const gl = place(mk(ow - 0.04, oh - 0.04, 0.01, glass), ac, y0 + sill + oh / 2, tc); gl.castShadow = false;
      g.add(gl);
      if (outer && !o.pano && sill > 0.1) g.add(place(mk(ow + 0.06, 0.02, e + 0.12, mat({ c: '#d7d7d4' })), ac, y0 + sill - 0.01, tOut + dirOut * (e / 2)));
      if (outer && exterior && st.trims) {
        const tm = mat({ c: st.trims }), sur = 0.12, tt = tOut + dirOut * (e + 0.02);
        g.add(place(mk(ow + 2 * sur, sur, 0.04, tm), ac, y0 + sill + oh + sur / 2, tt));
        g.add(place(mk(sur, oh, 0.04, tm), ac - ow / 2 - sur / 2, y0 + sill + oh / 2, tt));
        g.add(place(mk(sur, oh, 0.04, tm), ac + ow / 2 + sur / 2, y0 + sill + oh / 2, tt));
      }
    } else {
      const dm = mat({ c: o.kind === 'entry' ? '#4a3a2e' : '#e9e6e0' }, { roughness: 0.7 });
      const casing = mat({ c: o.kind === 'entry' ? (st.frame || '#ffffff') : '#ffffff' });
      const tc = outer ? tOut - dirOut * 0.08 : w.m / 1000, th = (w.t / 1000) + 0.02;
      g.add(place(mk(ow, 0.05, outer ? 0.1 : th, casing), ac, y0 + oh - 0.025, tc));
      g.add(place(mk(0.05, oh, outer ? 0.1 : th, casing), ac - ow / 2 + 0.025, y0 + oh / 2, tc));
      g.add(place(mk(0.05, oh, outer ? 0.1 : th, casing), ac + ow / 2 - 0.025, y0 + oh / 2, tc));
      if (o.kind === 'entry' || mode === 'exterior') {
        g.add(place(mk(ow - 0.1, oh - 0.05, 0.05, dm), ac, y0 + (oh - 0.05) / 2, tc));
      } else {
        // полотно открыто внутрь на 90°
        const leaf = new T.Mesh(new T.BoxGeometry(0.04, oh - 0.05, ow - 0.1), dm);
        const sideT = w.m / 1000 + w.t / 2000 + (ow - 0.1) / 2;
        leaf.position.set(along ? ac - ow / 2 + 0.07 : sideT, y0 + (oh - 0.05) / 2, along ? sideT : ac - ow / 2 + 0.07);
        if (!along) leaf.rotation.y = Math.PI / 2;
        leaf.castShadow = true; g.add(leaf);
      }
    }
    if (outer) {
      g.userData.pick = { kind: 'open', id: o.id };
      g.traverse(m => { if (m.isMesh) m.userData.pickRoot = g; });
      picks.push(g);
    }
    return g;
  }

  /* мебель коробками */
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

  function stair(p, y0) {
    const s = p.stair, r = DK.stairRect(p), g = new T.Group();
    const Ht = DK.storey(p) / 1000, n = Math.round(Ht * 1000 / 175), rise = Ht / n, run = s.l / 1000 / n, wd = s.w / 1000;
    const m = mat({ c: '#b88a62' });
    const dir = [[0, 1], [-1, 0], [0, -1], [1, 0]][s.rot];
    const cx = (r.x0 + r.x1) / 2000, cz = (r.y0 + r.y1) / 2000, half = s.l / 2000;
    for (let i = 0; i < n; i++) {
      const a = -half + run * (i + 0.5), x = cx + dir[0] * a, z = cz + dir[1] * a;
      const along = dir[0] !== 0;
      g.add(box(along ? run : wd, 0.04, along ? wd : run, m, x, y0 + rise * (i + 1) - 0.02, z));
    }
    return g;
  }

  /* ---------- кровли ---------- */
  function roof(p, yt, ext, st) {
    const t = p.roof.type, ov = t === 'flat' ? 0 : 0.5, e = ext / 1000;
    const x0 = -e - ov, x1 = p.W / 1000 + e + ov, z0 = -e - ov, z1 = p.D / 1000 + e + ov;
    const wx0 = -e, wx1 = p.W / 1000 + e, wz0 = -e, wz1 = p.D / 1000 + e;
    const rm = mat(st.roof, { side: T.DoubleSide, roughness: 0.75 }), wm = mat(st.upper || st.wall, { side: T.DoubleSide });
    const fasc = mat({ c: st.trims || st.frame || '#ffffff' });
    const pitch = (p.roof.pitch || DK.ROOFS[t].pitch) * Math.PI / 180, tn = Math.tan(pitch);
    const longX = (x1 - x0) >= (z1 - z0);
    let ridgeX = p.roof.ridge === 'short' ? !longX : longX; // конёк вдоль X?
    if (t === 'flat') {
      root.add(box(wx1 - wx0, 0.05, wz1 - wz0, mat({ c: '#5a5d62' }), (wx0 + wx1) / 2, yt + 0.025, (wz0 + wz1) / 2));
      const ph = 0.5, th = 0.25;
      root.add(box(wx1 - wx0, ph, th, wm, (wx0 + wx1) / 2, yt + ph / 2, wz0 + th / 2)); root.add(box(wx1 - wx0, ph, th, wm, (wx0 + wx1) / 2, yt + ph / 2, wz1 - th / 2));
      root.add(box(th, ph, wz1 - wz0, wm, wx0 + th / 2, yt + ph / 2, (wz0 + wz1) / 2)); root.add(box(th, ph, wz1 - wz0, wm, wx1 - th / 2, yt + ph / 2, (wz0 + wz1) / 2));
      root.add(box(wx1 - wx0 + 0.04, 0.05, wz1 - wz0 + 0.04, mat({ c: '#c9c9c6' }), (wx0 + wx1) / 2, yt + ph + 0.025, (wz0 + wz1) / 2));
      return;
    }
    // локальная система: u — вдоль конька, v — поперёк; в мир: (u, v) → (x, z) или (z, x)
    const U0 = ridgeX ? x0 : z0, U1 = ridgeX ? x1 : z1, V0 = ridgeX ? z0 : x0, V1 = ridgeX ? z1 : x1;
    const wU0 = ridgeX ? wx0 : wz0, wU1 = ridgeX ? wx1 : wz1, wV0 = ridgeX ? wz0 : wx0, wV1 = ridgeX ? wz1 : wx1;
    const P = (u, y, v) => ridgeX ? [u, y, v] : [v, y, u];
    const half = (wV1 - wV0) / 2, vc = (wV0 + wV1) / 2;
    const yE = yt - ov * tn; // карниз со свесом
    if (t === 'gable') {
      const yR = yt + half * tn;
      root.add(slope([P(U0, yE, V0), P(U1, yE, V0), P(U1, yR, vc), P(U0, yR, vc)], rm));
      root.add(slope([P(U1, yE, V1), P(U0, yE, V1), P(U0, yR, vc), P(U1, yR, vc)], rm));
      for (const u of [wU0, wU1]) root.add(poly([P(u, yt, wV0), P(u, yt, wV1), P(u, yR, vc)], wm, ridgeX ? 2 : 0, 1));
      for (const u of [U0, U1]) { root.add(slope([P(u, yE, V0), P(u, yR + 0.02, vc), P(u, yR - 0.16, vc), P(u, yE - 0.18, V0)], fasc)); root.add(slope([P(u, yE, V1), P(u, yR + 0.02, vc), P(u, yR - 0.16, vc), P(u, yE - 0.18, V1)], fasc)); }
    } else if (t === 'hip') {
      const hv = (V1 - V0) / 2, yR = yE + hv * tn, rl = Math.max(0, (U1 - U0) / 2 - hv), uc = (U0 + U1) / 2;
      const a = [uc - rl, yR, vc], b = [uc + rl, yR, vc];
      root.add(slope([P(U0, yE, V0), P(U1, yE, V0), P(b[0], yR, vc), P(a[0], yR, vc)], rm));
      root.add(slope([P(U1, yE, V1), P(U0, yE, V1), P(a[0], yR, vc), P(b[0], yR, vc)], rm));
      root.add(slope([P(U0, yE, V1), P(U0, yE, V0), P(a[0], yR, vc)], rm));
      root.add(slope([P(U1, yE, V0), P(U1, yE, V1), P(b[0], yR, vc)], rm));
    } else if (t === 'shed') {
      const yH = yt + (wV1 - wV0) * tn, yLo = yt - ov * tn, yHi = yH + ov * tn;
      root.add(slope([P(U0, yLo, V0), P(U1, yLo, V0), P(U1, yHi, V1), P(U0, yHi, V1)], rm));
      for (const u of [wU0, wU1]) root.add(poly([P(u, yt, wV0), P(u, yt, wV1), P(u, yH, wV1)], wm, ridgeX ? 2 : 0, 1));
      root.add(poly([P(wU0, yt, wV1), P(wU1, yt, wV1), P(wU1, yH, wV1), P(wU0, yH, wV1)], wm, ridgeX ? 0 : 2, 1));
    } else if (t === 'mansard') {
      const a = half * 0.22, yB = yt + a * Math.tan(62 * Math.PI / 180), yR = yB + (half - a) * tn;
      const vb0 = wV0 + a, vb1 = wV1 - a, yEl = yt - ov * Math.tan(62 * Math.PI / 180) * 0.3;
      root.add(slope([P(U0, yEl, V0), P(U1, yEl, V0), P(U1, yB, vb0), P(U0, yB, vb0)], rm));
      root.add(slope([P(U1, yEl, V1), P(U0, yEl, V1), P(U0, yB, vb1), P(U1, yB, vb1)], rm));
      root.add(slope([P(U0, yB, vb0), P(U1, yB, vb0), P(U1, yR, vc), P(U0, yR, vc)], rm));
      root.add(slope([P(U1, yB, vb1), P(U0, yB, vb1), P(U0, yR, vc), P(U1, yR, vc)], rm));
      for (const u of [wU0, wU1]) root.add(poly([P(u, yt, wV0), P(u, yt, wV1), P(u, yB, vb1), P(u, yR, vc), P(u, yB, vb0)], wm, ridgeX ? 2 : 0, 1));
    }
  }

  /* препятствия для прогулки: стены без дверных проёмов, мебель выше 0,3 м */
  function solids(p, f) {
    const out = [];
    for (const w of DK.walls(p, f)) {
      const doors = p.levels[f].open.filter(o => o.wall === w.id && o.kind !== 'win').map(o => [o.c - o.w / 2 + 50, o.c + o.w / 2 - 50]).sort((a, b) => a[0] - b[0]);
      let a = w.a0;
      const push = (a0, a1) => { if (a1 > a0) out.push(w.axis === 'x' ? [a0, w.y0, a1, w.y1] : [w.x0, a0, w.x1, a1]); };
      for (const d of doors) { push(a, d[0]); a = d[1]; }
      push(a, w.a1);
    }
    for (const it of p.levels[f].furn) { const F = DK.FURN[it.type]; if (F && F.h > 300 && it.type !== 'boiler') { const b = DK.furnBox(it); out.push([b.x0, b.y0, b.x1, b.y1]); } }
    return out.map(r => r.map(v => v / 1000));
  }
  function blocked(x, z) {
    const rad = 0.22;
    return walk.solid.some(r => x > r[0] - rad && x < r[2] + rad && z > r[1] - rad && z < r[3] + rad);
  }

  /* ---------- камера ---------- */
  function frame() {
    const p = app.p(), fl = DK.floorsOf(p);
    const R = Math.max(p.W, p.D) / 1000;
    orbit.tx = p.W / 2000; orbit.tz = p.D / 2000;
    if (mode === 'exterior') { orbit.ty = (DK.elev(p, fl[fl.length - 1]) / 1000 + p.hClear / 1000) / 2; orbit.r = R * 2.1 + 6; orbit.el = 0.32; orbit.az = -0.75; }
    else { orbit.ty = DK.elev(p, fid) / 1000; orbit.r = R * 1.45 + 3; orbit.el = 0.95; orbit.az = -0.6; }
  }
  function startWalk() {
    const p = app.p();
    walk.fid = fid;
    const regs = DK.rooms(p, fid);
    const entry = p.levels[fid].open.find(o => o.kind === 'entry');
    let r = regs.slice().sort((a, b) => b.area - a.area)[0];
    if (entry) { const rs = DK.opRegions(p, fid, entry, regs); if (rs[0]) r = rs[0]; }
    walk.x = r ? r.cx / 1000 : p.W / 2000; walk.z = r ? r.cy / 1000 : p.D / 2000;
    walk.yaw = 0; walk.pitch = 0;
    walk.y = DK.elev(p, fid) / 1000 + 1.6;
  }
  function placeCam() {
    if (mode === 'walk') {
      cam.position.set(walk.x, walk.y, walk.z);
      cam.rotation.order = 'YXZ'; cam.rotation.set(walk.pitch, walk.yaw, 0);
      cam.fov = 70;
    } else {
      cam.fov = 45;
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
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptr.size === 2) { const [a, b] = Array.from(ptr.values()); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), r: orbit.r }; drag = null; return; }
    if (mode === 'walk') {
      if (e.pointerType === 'mouse' && canvas.requestPointerLock && document.pointerLockElement !== canvas) canvas.requestPointerLock();
      drag = { kind: 'look', x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', half: e.clientX - canvas.getBoundingClientRect().left < canvas.clientWidth / 2 };
      return;
    }
    const h = mode === 'exterior' ? hit(e) : null;
    if (h && e.button === 0) {
      const g = h.object.userData.pickRoot;
      const pk = g.userData.pick;
      app.pick3d(pk);
      const p = app.p(), op = findOp(p, pk.id);
      if (op && op.o.kind === 'win') {
        const w = DK.walls(p, op.fid).find(v => v.id === op.o.wall);
        const n = w.axis === 'x' ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0);
        const plane = new T.Plane().setFromNormalAndCoplanarPoint(n, h.point);
        drag = { kind: 'win', op, w, plane, a0: w.axis === 'x' ? h.point.x : h.point.z, c0: op.o.c, x: e.clientX, y: e.clientY };
        return;
      }
    } else if (mode === 'exterior' && e.button === 0) app.pick3d(null);
    drag = { kind: (e.button === 2 || e.shiftKey) ? 'pan' : 'rot', x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptr.size === 2) { const [a, b] = Array.from(ptr.values()); orbit.r = Math.max(2, Math.min(150, pinch.r * pinch.d / Math.hypot(a.x - b.x, a.y - b.y))); placeCam(); return; }
    if (mode === 'walk' && document.pointerLockElement === canvas) { walk.yaw -= e.movementX * 0.0025; walk.pitch = Math.max(-1.3, Math.min(1.3, walk.pitch - e.movementY * 0.0025)); placeCam(); return; }
    if (!drag) {
      if (mode === 'exterior') canvas.style.cursor = hit(e) ? 'ew-resize' : 'grab';
      return;
    }
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
    if (drag.kind === 'rot') { orbit.az -= dx * 0.006; orbit.el = Math.max(0.05, Math.min(1.5, orbit.el + dy * 0.005)); }
    else {
      const s = orbit.r * 0.0016;
      orbit.tx -= (Math.cos(orbit.az) * dx) * s; orbit.tz -= (-Math.sin(orbit.az) * dx) * s; orbit.ty += dy * s;
    }
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
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mode === 'walk') return;
    orbit.r = Math.max(2, Math.min(150, orbit.r * Math.exp(e.deltaY * 0.001))); placeCam();
  }, { passive: false });
  window.addEventListener('keydown', (e) => { if (mode === 'walk' && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { walk.keys[e.code] = true; if (/Arrow|Space/.test(e.code)) e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { walk.keys[e.code] = false; });

  function findOp(p, id) {
    for (const f of DK.floorsOf(p)) { const o = p.levels[f].open.find(q => q.id === id); if (o) return { o, fid: f }; }
    return null;
  }

  /* ---------- цикл ---------- */
  let pending = false, last = performance.now(), running = false;
  function schedule() { pending = true; }
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (pending) { pending = false; build(); }
    if (mode === 'walk') {
      const k = walk.keys, sp = (k.ShiftLeft || k.ShiftRight ? 3.2 : 1.6) * dt;
      let f = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0), s = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (walk.touchMove) { f = Math.max(-1, Math.min(1, walk.touchMove.f)); s = Math.max(-1, Math.min(1, walk.touchMove.s)); }
      if (f || s) {
        const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw), rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
        const nx = walk.x + (fx * f + rx * s) * sp, nz = walk.z + (fz * f + rz * s) * sp;
        if (!blocked(nx, walk.z)) walk.x = nx;
        if (!blocked(walk.x, nz)) walk.z = nz;
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
      if (m === 'walk') startWalk(); else if (was !== m || opt.refit) frame();
      placeCam();
      if (!running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
    },
    stop() { running = false; if (document.pointerLockElement === canvas) document.exitPointerLock(); },
    rebuild() { schedule(); },
    fit() { frame(); placeCam(); },
    rotate(d) { orbit.az += d; placeCam(); },
    zoom(f) { orbit.r = Math.max(2, Math.min(150, orbit.r * f)); placeCam(); },
    walkFloor(f) { fid = f; build(); startWalk(); placeCam(); },
    shot() { renderer.render(scene, cam); return canvas.toDataURL('image/png'); },
    /* снимок фасада для заявки, не меняя текущий вид надолго */
    exteriorShot(w, h) {
      const keep = { mode, fid, cut, showFurn, o: Object.assign({}, orbit), size: renderer.getSize(new T.Vector2()), aspect: cam.aspect };
      mode = 'exterior'; build(); frame(); orbit.az = -0.6; orbit.el = 0.28;
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
