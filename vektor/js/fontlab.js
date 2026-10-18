// «Шрифты»: кириллица для латинского шрифта. Буквы строятся из латинских глифов
// (копии, отражения, сборка из штамбов, перекладин и чаш), правятся в редакторе узлов
// и собираются в шрифт OpenType (.otf, CFF) через opentype.js.
'use strict';

// =====================================================================
// Геометрия: контуры (узлы Path) ⇄ многоугольники Clipper, булевы операции,
// обводка, подгонка кривых Безье по ломаной (Шнайдер)
// =====================================================================
const FLGeo = {
  K: 8,          // масштаб целых координат Clipper
  step: 4,       // длина шага при спрямлении кривых, ед. шрифта (на 1000)
  unit: 1,       // upm / 1000
  BIG: 1e5,

  // контуры → многоугольники (целые, ×K); f(x, y) → [x, y] — преобразование точек
  polys(contours, f) {
    const K = FLGeo.K, out = [], st = FLGeo.step * FLGeo.unit;
    for (const sp of contours || []) {
      const n = sp.nodes.length; if (n < 2) continue;
      const ring = [];
      const add = (x, y) => { if (f) [x, y] = f(x, y); ring.push({ X: Math.round(x * K), Y: Math.round(y * K) }); };
      add(sp.nodes[0].x, sp.nodes[0].y);
      for (let i = 0; i < n; i++) {
        const a = sp.nodes[i], b = sp.nodes[(i + 1) % n];
        if (Path.isLineSeg(a, b)) { add(b.x, b.y); continue; }
        const [p0, p1, p2, p3] = Path.segPts(a, b);
        const len = G.dist(p0, p1) + G.dist(p1, p2) + G.dist(p2, p3);
        const k = Math.max(3, Math.min(120, Math.ceil(len / st)));
        for (let j = 1; j <= k; j++) { const q = G.cubicPt(p0, p1, p2, p3, j / k); add(q.x, q.y); }
      }
      const l = ring[ring.length - 1];
      if (l.X === ring[0].X && l.Y === ring[0].Y) ring.pop();
      if (ring.length > 2) out.push(ring);
    }
    return out;
  },
  exec(type, subj, clip) {
    const out = new ClipperLib.Paths();
    if (!subj.length && !(clip && clip.length)) return out;
    const c = new ClipperLib.Clipper();
    c.PreserveCollinear = true; // иначе точки на пологих дугах выбрасываются и дуги путаются с прямыми
    if (subj.length) c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
    if (clip && clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
    c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return out;
  },
  // каждая часть сначала нормализуется (направление обхода у шрифтов TrueType и PostScript разное)
  union(...ps) {
    ps = ps.filter(p => p && p.length);
    if (ps.length === 1) return FLGeo.exec(ClipperLib.ClipType.ctUnion, ps[0]);
    return FLGeo.exec(ClipperLib.ClipType.ctUnion, [].concat(...ps.map(p => FLGeo.exec(ClipperLib.ClipType.ctUnion, p))));
  },
  inter(a, b) { return FLGeo.exec(ClipperLib.ClipType.ctIntersection, FLGeo.union(a), FLGeo.union(b)); },
  diff(a, b) { return FLGeo.exec(ClipperLib.ClipType.ctDifference, FLGeo.union(a), FLGeo.union(b)); },
  // смещение контура (утолщение/утоньшение) с острыми углами
  offset(p, d) {
    if (!p.length || Math.abs(d) < 0.05) return p;
    const co = new ClipperLib.ClipperOffset(4, 0.2 * FLGeo.K), out = new ClipperLib.Paths();
    co.AddPaths(FLGeo.union(p), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    co.Execute(out, d * FLGeo.K);
    return out;
  },
  // обводка открытой ломаной (pts в ед. шрифта) толщиной w (или от w до w1), торцы срезаны
  stroke(pts, w, w1 = w) {
    const L = [], R = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const hw = (w + (w1 - w) * i / (n - 1)) / 2, p = pts[i];
      L.push([p.x - dy * hw, p.y + dx * hw]); R.push([p.x + dy * hw, p.y - dx * hw]);
    }
    return FLGeo.union(FLGeo.poly([...L, ...R.reverse()]));
  },
  rect(x0, y0, x1, y1) {
    const K = FLGeo.K;
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    return [[{ X: Math.round(x0 * K), Y: Math.round(y0 * K) }, { X: Math.round(x1 * K), Y: Math.round(y0 * K) }, { X: Math.round(x1 * K), Y: Math.round(y1 * K) }, { X: Math.round(x0 * K), Y: Math.round(y1 * K) }]];
  },
  poly(pts) { const K = FLGeo.K; return [pts.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }))]; },
  // кубическая кривая как ломаная (для осевых линий штрихов)
  bez(p0, p1, p2, p3, n) { if (!n) n = Math.max(8, Math.min(400, Math.ceil((G.dist(p0, p1) + G.dist(p1, p2) + G.dist(p2, p3)) / (3 * FLGeo.unit)))); const out = []; for (let i = 0; i <= n; i++) out.push(G.cubicPt(p0, p1, p2, p3, i / n)); return out; },
  xf(p, f) {
    const K = FLGeo.K;
    return p.map(r => r.map(q => { const [x, y] = f(q.X / K, q.Y / K); return { X: Math.round(x * K), Y: Math.round(y * K) }; }));
  },
  tr(p, dx, dy = 0) { const K = FLGeo.K, ax = Math.round(dx * K), ay = Math.round(dy * K); return p.map(r => r.map(q => ({ X: q.X + ax, Y: q.Y + ay }))); },
  sc(p, sx, sy, cx = 0, cy = 0) { return FLGeo.xf(p, (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy]); },
  bbox(p) {
    const K = FLGeo.K, b = G.emptyBox();
    for (const r of p) for (const q of r) G.addPt(b, q.X / K, q.Y / K);
    return b;
  },
  // отрезки заливки на горизонтали y (правило ненулевой обмотки)
  scan(p, y, vert = false) {
    const K = FLGeo.K, v = y * K, xs = [];
    for (const r of p) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length];
        const ay = vert ? a.X : a.Y, by = vert ? b.X : b.Y, ax = vert ? a.Y : a.X, bx = vert ? b.Y : b.X;
        if ((ay <= v && by > v) || (by <= v && ay > v)) xs.push({ x: (ax + (v - ay) / (by - ay) * (bx - ax)) / K, w: by > ay ? 1 : -1 });
      }
    }
    xs.sort((a, b) => a.x - b.x);
    const runs = []; let w = 0, start = 0;
    for (const e of xs) {
      const was = w; w += e.w;
      if (was === 0 && w !== 0) start = e.x;
      else if (was !== 0 && w === 0) { if (e.x - start > 0.5) runs.push([start, e.x]); }
    }
    return runs;
  },
  vscan(p, x) { return FLGeo.scan(p, x, true); },
  area(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a.X * b.Y - b.X * a.Y; } return s / 2 / FLGeo.K / FLGeo.K; },
  // раздвинуть фигуру по вертикали x = cx на 2d, заполнив разрез (для Ф, ф)
  widen(p, cx, d) {
    const B = FLGeo.BIG;
    const L = FLGeo.tr(FLGeo.inter(p, FLGeo.rect(-B, -B, cx, B)), -d), R = FLGeo.tr(FLGeo.inter(p, FLGeo.rect(cx, -B, B, B)), d);
    const fill = FLGeo.vscan(p, cx).map(([a, b]) => FLGeo.rect(cx - d - 0.5, a, cx + d + 0.5, b)[0]);
    return FLGeo.union(L, R, fill);
  },

  // ---------- подгонка кривых: многоугольники → контуры с узлами ----------
  fit(p) {
    const K = FLGeo.K, u = FLGeo.unit, out = [];
    for (const r of p) {
      if (Math.abs(FLGeo.area(r)) < 30 * u * u) continue;
      let pts = r.map(q => ({ x: q.X / K, y: q.Y / K }));
      pts = pts.filter((q, i) => G.dist(q, pts[(i + 1) % pts.length]) > 0.05);
      if (pts.length < 3) continue;
      const sp = FLGeo.fitRing(pts);
      if (sp) out.push(sp);
    }
    return out;
  },
  fitRing(pts0) {
    const u = FLGeo.unit, LINE = 11 * u, tol2 = Math.pow(0.7 * u, 2);
    // убрать точки на прямых (между двумя длинными отрезками почти без излома)
    let pts = pts0;
    for (let pass = 0; pass < 1; pass++) {
      const n = pts.length, keep = [];
      for (let i = 0; i < n; i++) {
        const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
        const l1 = G.dist(a, b), l2 = G.dist(b, c);
        const cr = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / Math.max(1e-9, G.dist(a, c));
        if (cr < 0.15 * u && l1 > LINE && l2 > LINE) continue;
        keep.push(b);
      }
      if (keep.length < 3) break;
      pts = keep;
    }
    const n = pts.length;
    if (n < 3) return null;
    const P = i => pts[((i % n) + n) % n];
    const seg = i => { const a = P(i), b = P(i + 1); return { x: b.x - a.x, y: b.y - a.y, l: G.dist(a, b) }; };
    const segs = []; for (let i = 0; i < n; i++) segs.push(seg(i));
    const isLine = i => segs[((i % n) + n) % n].l > LINE;
    const turn = i => { const a = segs[((i - 1) % n + n) % n], b = segs[i % n]; return Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180 / Math.PI; };
    const T = []; for (let i = 0; i < n; i++) T.push(turn(i));
    const brk = new Array(n).fill(0); // 1 — угол, 2 — стык с прямой, 3 — экстремум
    const corner = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const tp = T[(i - 1 + n) % n], tn = T[(i + 1) % n], t = T[i];
      const ln = isLine(i - 1) || isLine(i);
      if (t > 50 || (t > 20 && t > 2.5 * Math.max(tp, tn)) || (ln && t > 14) || (isLine(i - 1) && isLine(i) && t > 1.5)) { corner[i] = true; brk[i] = 1; }
      else if (ln) brk[i] = 2;
    }
    // экстремумы по x и y внутри кривых (по окну ±3 точки, чтобы не ловить дрожание округления)
    const ext = new Array(n).fill(0);
    for (const ax of ['y', 'x']) {
      for (let i = 0; i < n; i++) {
        if (brk[i] || ext[i]) continue;
        let w = 3, ok = true, mx = true, mn = true;
        const v = P(i)[ax];
        for (let d = -w; d <= w; d++) { if (!d) continue; if (isLine(i + Math.min(d, 0)) && Math.abs(d) === 1) ok = false; const q = P(i + d)[ax]; if (q > v) mx = false; if (q < v) mn = false; }
        if (!ok || !(mx || mn)) continue;
        const a = P(i - w)[ax], b = P(i + w)[ax];
        if (Math.abs(a - v) < 0.05 && Math.abs(b - v) < 0.05) continue;
        let dup = false; for (let d = -4; d <= 4; d++) if (ext[(i + d + n) % n] === (ax === 'y' ? 1 : 2)) dup = true;
        if (!dup) ext[i] = ax === 'y' ? 1 : 2;
      }
    }
    for (let i = 0; i < n; i++) if (ext[i] && !brk[i]) {
      let near = false;
      for (let d = 1; d <= 2; d++) if (brk[(i + d) % n] || brk[(i - d + n) % n]) near = true;
      if (!near) brk[i] = 3;
    }
    let B = []; for (let i = 0; i < n; i++) if (brk[i]) B.push(i);
    if (!B.length) B = [0, n >> 1];
    if (B.length === 1) B.push((B[0] + (n >> 1)) % n);
    const nrm = v => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
    const est = (i, dir) => { const p0 = P(i), p1 = P(i + dir), p2 = P(i + 2 * dir); return nrm({ x: 4 * (p1.x - p0.x) - (p2.x - p0.x), y: 4 * (p1.y - p0.y) - (p2.y - p0.y) }); };
    // касательная в точке излома для дуги, уходящей вперёд (dir = 1) или назад (dir = -1)
    const tang = (i, dir, runLen) => {
      if (!corner[i]) {
        if (dir === 1 && isLine(i - 1)) return nrm(segs[(i - 1 + n) % n]);
        if (dir === -1 && isLine(i)) { const s = segs[i % n]; return nrm({ x: -s.x, y: -s.y }); }
        if (brk[i] === 3) {
          const a = P(i - 1), b = P(i + 1);
          const v = ext[i] === 1 ? { x: Math.sign(b.x - a.x) || 1, y: 0 } : { x: 0, y: Math.sign(b.y - a.y) || 1 };
          return dir === 1 ? v : { x: -v.x, y: -v.y };
        }
      }
      return runLen > 2 ? est(i, dir) : nrm({ x: P(i + dir).x - P(i).x, y: P(i + dir).y - P(i).y });
    };
    const nodes = [];
    const start = P(B[0]);
    nodes.push(Path.node(start.x, start.y));
    for (let k = 0; k < B.length; k++) {
      const i = B[k], j0 = B[(k + 1) % B.length], j = j0 > i ? j0 : j0 + n;
      const d = []; for (let q = i; q <= j; q++) d.push(P(q));
      let straight = d.length === 2;
      if (!straight) {
        const a = d[0], b = d[d.length - 1], L = G.dist(a, b);
        let md = 0; for (const q of d) md = Math.max(md, Math.abs((b.x - a.x) * (a.y - q.y) - (a.x - q.x) * (b.y - a.y)) / Math.max(L, 1e-9));
        straight = md < 0.4 * u;
      }
      if (straight) { const e = d[d.length - 1]; nodes.push(Path.node(e.x, e.y)); continue; }
      const t1 = tang(i % n, 1, d.length), t2 = tang(j % n, -1, d.length);
      const bz = []; FLGeo.fitCubic(d, 0, d.length - 1, t1, t2, tol2, bz);
      for (const c of bz) {
        const pn = nodes[nodes.length - 1]; pn.ox = c[1].x; pn.oy = c[1].y;
        const nn = Path.node(c[3].x, c[3].y); nn.ix = c[2].x; nn.iy = c[2].y; nodes.push(nn);
      }
    }
    const f = nodes[0], l = nodes.pop();
    f.ix = l.ix; f.iy = l.iy;
    for (const q of nodes) for (const k of ['x', 'y', 'ix', 'iy', 'ox', 'oy']) q[k] = Math.round(q[k]);
    const sp = { closed: true, nodes: nodes.filter((q, idx) => { const nx = nodes[(idx + 1) % nodes.length]; return nodes.length < 3 || !(q.x === nx.x && q.y === nx.y && q.ox === q.x && q.oy === q.y && nx.ix === nx.x && nx.iy === nx.y); }) };
    Path.detectSmooth(sp);
    return sp.nodes.length > 1 ? sp : null;
  },
  fitCubic(d, first, last, t1, t2, err2, out) {
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }), mul = (a, s) => ({ x: a.x * s, y: a.y * s }), sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
    const dot = (a, b) => a.x * b.x + a.y * b.y;
    const nPts = last - first + 1;
    if (nPts === 2) { const dist = G.dist(d[first], d[last]) / 3; out.push([d[first], add(d[first], mul(t1, dist)), add(d[last], mul(t2, dist)), d[last]]); return; }
    const gen = u => {
      let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
      const p0 = d[first], p3 = d[last];
      for (let i = 0; i < nPts; i++) {
        const t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
        const A0 = mul(t1, b1), A1 = mul(t2, b2);
        c00 += dot(A0, A0); c01 += dot(A0, A1); c11 += dot(A1, A1);
        const tmp = sub(d[first + i], add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
        x0 += dot(A0, tmp); x1 += dot(A1, tmp);
      }
      const det = c00 * c11 - c01 * c01;
      let aL = Math.abs(det) < 1e-12 ? 0 : (x0 * c11 - x1 * c01) / det, aR = Math.abs(det) < 1e-12 ? 0 : (c00 * x1 - c01 * x0) / det;
      const L = G.dist(p0, p3);
      if (aL < 1e-6 * L || aR < 1e-6 * L || aL > 3 * L || aR > 3 * L) aL = aR = L / 3;
      return [p0, add(p0, mul(t1, aL)), add(p3, mul(t2, aR)), p3];
    };
    const errOf = (bz, u) => {
      let m = 0, sp = (first + last) >> 1;
      for (let i = 1; i < nPts - 1; i++) {
        const q = G.cubicPt(bz[0], bz[1], bz[2], bz[3], u[i]), e = Math.pow(q.x - d[first + i].x, 2) + Math.pow(q.y - d[first + i].y, 2);
        if (e >= m) { m = e; sp = first + i; }
      }
      return [m, sp];
    };
    const reparam = (bz, u) => u.map((t, i) => {
      const p = d[first + i];
      const Q = G.cubicPt(bz[0], bz[1], bz[2], bz[3], t);
      const q1 = [0, 1, 2].map(k => mul(sub(bz[k + 1], bz[k]), 3));
      const q2 = [0, 1].map(k => mul(sub(q1[k + 1], q1[k]), 2));
      const s = 1 - t;
      const Q1 = add(add(mul(q1[0], s * s), mul(q1[1], 2 * s * t)), mul(q1[2], t * t));
      const Q2 = add(mul(q2[0], s), mul(q2[1], t));
      const num = dot(sub(Q, p), Q1), den = dot(Q1, Q1) + dot(sub(Q, p), Q2);
      return Math.abs(den) < 1e-12 ? t : G.clamp(t - num / den, 0, 1);
    });
    let u = [0];
    for (let i = 1; i < nPts; i++) u.push(u[i - 1] + G.dist(d[first + i], d[first + i - 1]));
    const tot = u[nPts - 1] || 1; u = u.map(v => v / tot);
    let bz = gen(u), [m, sp] = errOf(bz, u);
    if (m < err2) { out.push(bz); return; }
    if (m < err2 * 25) {
      for (let it = 0; it < 8; it++) {
        u = reparam(bz, u); bz = gen(u); [m, sp] = errOf(bz, u);
        if (m < err2) { out.push(bz); return; }
      }
    }
    sp = G.clamp(sp, first + 1, last - 1);
    const v = sub(d[sp - 1], d[sp + 1]), l = Math.hypot(v.x, v.y) || 1, tc = { x: v.x / l, y: v.y / l };
    FLGeo.fitCubic(d, first, sp, t1, tc, err2, out);
    FLGeo.fitCubic(d, sp, last, { x: -tc.x, y: -tc.y }, t2, err2, out);
  },

  // ---------- контуры ----------
  clone(cs) { return (cs || []).map(sp => ({ closed: sp.closed !== false, nodes: sp.nodes.map(q => ({ ...q })) })); },
  mapNodes(cs, f) {
    for (const sp of cs) for (const q of sp.nodes) {
      [q.x, q.y] = f(q.x, q.y); [q.ix, q.iy] = f(q.ix, q.iy); [q.ox, q.oy] = f(q.ox, q.oy);
    }
    return cs;
  },
  reverse(cs) { for (const sp of cs) Path.reverse(sp); return cs; },
  bboxC(cs) { const b = Path.bbox(cs || []); return G.boxValid(b) ? b : null; },
  // opentype Path → контуры
  fromOT(path) {
    let d = '';
    const f = v => +(+v).toFixed(3);
    for (const c of path.commands) {
      if (c.type === 'M') d += `M${f(c.x)} ${f(c.y)}`;
      else if (c.type === 'L') d += `L${f(c.x)} ${f(c.y)}`;
      else if (c.type === 'Q') d += `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
      else if (c.type === 'C') d += `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
      else if (c.type === 'Z') d += 'Z';
    }
    return d ? Path.parse(d).map(sp => { sp.closed = true; return sp; }) : [];
  },
  // контуры → opentype Path (направления по правилу PostScript: внешние против часовой)
  toOT(cs) {
    const p = new opentype.Path(), r = v => Math.round(v);
    for (const sp of FLGeo.orient(FLGeo.clone(cs))) {
      const n = sp.nodes.length; if (n < 2) continue;
      p.moveTo(r(sp.nodes[0].x), r(sp.nodes[0].y));
      for (let i = 0; i < n; i++) {
        const a = sp.nodes[i], b = sp.nodes[(i + 1) % n];
        if (Path.isLineSeg(a, b)) { if (i < n - 1 || r(b.x) !== r(sp.nodes[0].x) || r(b.y) !== r(sp.nodes[0].y) || true) p.lineTo(r(b.x), r(b.y)); }
        else p.curveTo(r(a.ox), r(a.oy), r(b.ix), r(b.iy), r(b.x), r(b.y));
      }
      p.close();
    }
    return p;
  },
  // убрать наложения контуров (в CFF они дают светлые швы при сглаживании)
  removeOverlaps(cs) {
    if (!cs || cs.length < 2) return cs;
    const p = FLGeo.polys(cs), un = FLGeo.union(p);
    const sum = q => Math.abs(q.reduce((s, r) => s + FLGeo.area(r), 0));
    const a0 = sum(p), a1 = sum(un);
    if (Math.abs(a0 - a1) < Math.max(1, a1 * 0.002)) return cs;
    const f = FLGeo.fit(un);
    return f.length ? f : cs;
  },
  // внешние контуры — против часовой, дырки — по часовой (по вложенности)
  orient(cs) {
    const fl = Path.flatten(cs, null, 8);
    const area = pts => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a.x * b.y - b.x * a.y; } return s / 2; };
    const inside = (pt, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
    cs.forEach((sp, i) => {
      const pts = fl[i].pts; if (pts.length < 3) return;
      let depth = 0;
      cs.forEach((o, j) => { if (j !== i && fl[j].pts.length > 2 && Math.abs(area(fl[j].pts)) > Math.abs(area(pts)) && inside(pts[0], fl[j].pts)) depth++; });
      const ccw = area(pts) > 0;
      if (ccw !== (depth % 2 === 0)) Path.reverse(sp);
    });
    return cs;
  },
};

// =====================================================================
// Синтез кириллицы из латиницы
// =====================================================================
const FLSynth = {
  RU_UP: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
  RU_LO: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя',
  EXTRA: 'ЄІЇЎҐєіїўґ№',

  // src: u → { adv, contours }; info: { upm, italicAngle }
  run(src, info, only) {
    const S = FLSynth.ctx(src, info);
    const res = {}, fails = [];
    const list = only ? [...only] : [...FLSynth.RU_UP, ...FLSynth.RU_LO, ...FLSynth.EXTRA];
    for (const ch of list) {
      let g = null;
      try { g = S.get(ch); } catch (e) { console.warn('FontLab', ch, e); }
      if (!g) { fails.push(ch); continue; }
      res[ch.codePointAt(0)] = S.final(ch, g);
    }
    return { glyphs: res, fails, metrics: S.M };
  },

  ctx(src, info) {
    const upm = info.upm || 1000;
    FLGeo.unit = upm / 1000;
    let sl = Math.tan(-(info.italicAngle || 0) * Math.PI / 180) || 0;
    // наклон курсива точнее мерить по штамбу H (или I, l)
    for (const ch of 'HIl') {
      const g = src.get(ch.codePointAt(0)); if (!g || !g.contours || !g.contours.length) continue;
      const p = FLGeo.polys(g.contours), b = FLGeo.bbox(p), h = b.y2 - b.y1;
      const r1 = FLGeo.scan(p, b.y1 + h * 0.25), r2 = FLGeo.scan(p, b.y1 + h * 0.75);
      if (r1.length && r2.length) { const m = ((r2[0][0] + r2[0][1]) - (r1[0][0] + r1[0][1])) / 2 / (h * 0.5); sl = Math.abs(m) < 0.03 ? 0 : m; }
      break;
    }
    const B = FLGeo.BIG, R = FLGeo.rect, U = FLGeo.union, I = FLGeo.inter, D = FLGeo.diff, TR = FLGeo.tr;
    const has = ch => { const g = src.get(ch.codePointAt(0)); return !!(g && g.contours && g.contours.length); };
    const gl = ch => src.get(ch.codePointAt(0));
    const y0 = (info.capHeight || 0.7 * upm) * 0.4, desl = (x, y) => [x - (y - y0) * sl, y], resl = (x, y) => [x + (y - y0) * sl, y];
    const polyCache = {};
    const P = ch => { if (!has(ch)) return null; return polyCache[ch] || (polyCache[ch] = FLGeo.polys(gl(ch).contours, sl ? desl : null)); };
    const bbC = {};
    const bb = ch => bbC[ch] || (bbC[ch] = has(ch) ? FLGeo.bbox(P(ch)) : null);
    const lsb = ch => has(ch) ? bb(ch).x1 : null, rsb = ch => has(ch) ? gl(ch).adv - bb(ch).x2 : null;
    const or = (v, d) => (v === null || v === undefined || !isFinite(v)) ? d : v;

    // ---------- замеры ----------
    const M = { upm };
    M.C = has('H') ? bb('H').y2 : (info.capHeight || 0.7 * upm);
    M.X = has('x') ? bb('x').y2 : (info.xHeight || 0.5 * upm);
    M.ovU = has('O') ? Math.max(0, bb('O').y2 - M.C) : 0.012 * upm;
    M.ovL = has('o') ? Math.max(0, bb('o').y2 - M.X) : 0.01 * upm;
    const C = M.C, X = M.X;
    if (has('H')) {
      const rs = FLGeo.scan(P('H'), C * 0.22);
      if (rs.length >= 2) { [M.a0, M.a1] = rs[0]; [M.b0, M.b1] = rs[rs.length - 1]; }
    }
    if (M.a0 === undefined) { M.a0 = 0.08 * upm; M.a1 = M.a0 + 0.1 * C + 20; M.b1 = M.a0 + 0.62 * C; M.b0 = M.b1 - (M.a1 - M.a0); }
    M.S = M.a1 - M.a0; M.Hc = M.b0 - M.a1; M.Hw = M.b1 - M.a0;
    M.cb = [C * 0.47, C * 0.47 + M.S * 0.8];
    if (has('H')) { const v = FLGeo.vscan(P('H'), (M.a1 + M.b0) / 2); if (v.length) M.cb = v[0]; }
    M.T = M.cb[1] - M.cb[0];
    M.tt = M.T; M.tb = M.T;
    if (has('E')) {
      const e = FLGeo.scan(P('E'), C * 0.3); if (e.length) [M.e0, M.e1] = e[0];
      if (M.e1 !== undefined) {
        const v = FLGeo.vscan(P('E'), M.e1 + (bb('E').x2 - M.e1) * 0.2);
        if (v.length >= 2) { M.tb = v[0][1] - v[0][0]; M.tt = v[v.length - 1][1] - v[v.length - 1][0]; M.eTop = v[v.length - 1][0]; }
      }
    }
    if (has('n')) {
      const rs = FLGeo.scan(P('n'), X * 0.25);
      if (rs.length >= 2) { [M.n0, M.n1] = rs[0]; [M.n2, M.n3] = rs[rs.length - 1]; }
    }
    if (M.n0 === undefined) { const k = X / C; M.n0 = M.a0 * k; M.n1 = M.n0 + M.S * 0.9; M.n3 = M.n0 + M.Hw * 0.85 * k; M.n2 = M.n3 - M.S * 0.9; }
    M.s = M.n1 - M.n0;
    M.oS = M.S; M.oT = M.T * 0.8;
    if (has('O')) { const r = FLGeo.scan(P('O'), C / 2); if (r.length) M.oS = r[0][1] - r[0][0]; }
    if (has('o')) { const b = bb('o'), v = FLGeo.vscan(P('o'), (b.x1 + b.x2) / 2); if (v.length >= 2) { M.loT = v[v.length - 1][1] - v[v.length - 1][0]; M.loB = v[0][1] - v[0][0]; } const r = FLGeo.scan(P('o'), X / 2); if (r.length) M.loS = r[0][1] - r[0][0]; }
    M.loT = or(M.loT, M.T * 0.75); M.loS = or(M.loS, M.s);
    M.t = M.loT;
    M.asc = has('b') ? bb('b').y2 : has('l') ? bb('l').y2 : C * 1.05;
    M.dsc = has('p') ? bb('p').y1 : -0.22 * upm;
    M.Dd = Math.min(0.16 * C, Math.abs(M.dsc) * 0.62);
    M.leg = M.S * 1.04;
    if (has('A')) { const r = FLGeo.scan(P('A'), C * 0.62); if (r.length >= 2) M.leg = G.clamp(r[0][1] - r[0][0], M.T * 1.2, M.S * 1.15); }
    M.SB = { S: or(lsb('H'), 0.08 * upm), Sr: or(rsb('H'), 0.08 * upm), R: or(lsb('O'), 0.05 * upm), Rr: or(rsb('O'), 0.05 * upm), D: or(lsb('A'), 0.01 * upm), s: or(lsb('n'), 0.06 * upm), sr: or(rsb('n'), 0.05 * upm), r: or(lsb('o'), 0.04 * upm), rr: or(rsb('o'), 0.04 * upm) };
    M.sbK = G.clamp((M.SB.s + M.SB.sr) / Math.max(1, M.SB.S + M.SB.Sr), 0.5, 1.2);
    // уменьшение до строчных с сохранением толщины штрихов
    M.k = G.clamp((X - M.s) / Math.max(1, C - M.S), 0.5, 0.88);
    M.dk = G.clamp((M.s - M.k * M.S) / 2, -M.s * 0.3, M.s * 0.4);

    // ---------- детали ----------
    const S = M.S, s = M.s;
    let Hst = null;
    const Hstems = () => Hst || (Hst = has('H') ? D(P('H'), R(M.a1 + 0.2, M.cb[0] - 1, M.b0 - 0.2, M.cb[1] + 1))
      : U(R(M.a0, 0, M.a1, C), R(M.b0, 0, M.b1, C)));
    let stL = null;
    const stemL = () => stL || (stL = I(Hstems(), R(-B, -B, (M.a1 + M.b0) / 2, B)));
    // прописной штамб: левый край ядра в x, по высоте y0..y1 (засечки — только на концах 0 и C)
    const ustem = (x, y0 = 0, y1 = C) => {
      let p = TR(stemL(), x - M.a0);
      p = I(p, R(-B, y0 > 0 ? y0 : -B, B, y1 < C ? y1 : B));
      const ext = [];
      if (y0 < 0) ext.push(R(x, y0, x + S, C * 0.3));
      if (y1 > C) ext.push(R(x, C * 0.7, x + S, y1));
      return ext.length ? U(p, ...ext) : p;
    };
    let nL = null;
    const nStemL = () => nL || (nL = has('n') ? I(P('n'), U(R(-B, -B, M.n1 + 0.2, B), R(-B, -B, M.n1 + (M.n2 - M.n1) * 0.45, X * 0.4))) : R(M.n0, 0, M.n1, X));
    const lstem = (x, y0 = 0, y1 = X) => {
      let p = TR(nStemL(), x - M.n0);
      p = I(p, R(-B, y0 > 0 ? y0 : -B, B, y1 < X ? y1 : B));
      const ext = [];
      if (y0 < 0) ext.push(R(x, y0, x + s, X * 0.3));
      if (y1 > X) ext.push(R(x, X * 0.7, x + s, y1));
      return ext.length ? U(p, ...ext) : p;
    };
    const mirrorP = (p, ax) => FLGeo.xf(p, (x, y) => [2 * ax - x, y]);

    // результат построения: многоугольники (в «выпрямленных» координатах) → глиф с полями
    const mk = (p, l, r, how) => {
      p = U(p);
      const b = FLGeo.bbox(p);
      if (!G.boxValid(b)) return null;
      return { polys: TR(p, l - b.x1), adv: Math.round(b.x2 - b.x1 + l + r), lsb: l, rsb: r, how };
    };
    // копия латинской буквы (точные кривые)
    const cp = (ch, how) => has(ch) ? { contours: FLGeo.clone(gl(ch).contours), adv: gl(ch).adv, lsb: lsb(ch), rsb: rsb(ch), how: how || 'копия ' + ch } : null;
    const xfC = (ch, f, how) => {
      if (!has(ch)) return null;
      const cs = FLGeo.mapNodes(FLGeo.clone(gl(ch).contours), (x, y) => resl(...f(...desl(x, y))));
      return { contours: cs, adv: gl(ch).adv, how };
    };
    const mir = (ch, how) => { if (!has(ch)) return null; const a = gl(ch).adv, r = xfC(ch, (x, y) => [a - x, y], how || ch + ', отражённая'); FLGeo.reverse(r.contours); r.lsb = rsb(ch); r.rsb = lsb(ch); return r; };
    const flipV = (ch, how) => { if (!has(ch)) return null; const r = xfC(ch, (x, y) => [x, C - y], how); FLGeo.reverse(r.contours); r.lsb = lsb(ch); r.rsb = rsb(ch); return r; };
    const polysOf = g => g.polys || FLGeo.polys(g.contours, sl ? desl : null);
    const sb = g => { const b = FLGeo.bbox(polysOf(g)); return [b.x1, g.adv - b.x2]; };
    const plus = (g, extra, how) => { // добавить контуры (диакритику) к глифу
      if (!g || !extra) return null;
      const r = { ...g, how };
      if (g.contours && extra.contours) r.contours = [...FLGeo.clone(g.contours), ...extra.contours];
      else { r.polys = U(polysOf(g), extra.polys || FLGeo.polys(extra.contours, sl ? desl : null)); delete r.contours; }
      return r;
    };

    // диакритика: контуры над буквой; dx — сдвиг к центру базовой буквы
    const accentOf = (chars, upper, fallbacks) => {
      const lim = upper ? C + M.ovU * 0.6 : X + M.ovL * 0.6;
      for (const ch of chars) {
        if (!has(ch)) continue;
        const cs = gl(ch).contours.filter(sp => { const b = FLGeo.bboxC([sp]); return b && b.y1 > lim; });
        if (cs.length) return FLGeo.clone(cs);
      }
      for (const ch of fallbacks) {
        if (!has(ch)) continue;
        const cs = FLGeo.clone(gl(ch).contours), b = FLGeo.bboxC(cs);
        if (!b) continue;
        let dy = 0;
        if (b.y1 < X * 0.5) dy = (upper ? C : X) + (M.asc - X) * 0.25 - b.y1; // комбинируемый знак у базовой линии
        else if (upper) dy = C - X;
        return FLGeo.mapNodes(cs, (x, y) => [x, y + dy]);
      }
      return null;
    };
    const synthDots = upper => {
      const r = s * 0.62, y = (upper ? C : X) + (upper ? M.ovU : M.ovL) + s * 0.75 + r, gap = s * 0.55 + r;
      const circ = (cx) => { const k = 0.5523 * r; const n = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy, t: 'smooth' }); return { closed: true, nodes: [n(cx + r, y, cx + r, y - k, cx + r, y + k), n(cx, y + r, cx + k, y + r, cx - k, y + r), n(cx - r, y, cx - r, y + k, cx - r, y - k), n(cx, y - r, cx - k, y - r, cx + k, y - r)] }; };
      return [circ(-gap), circ(gap)];
    };
    const synthBreve = upper => {
      const w = (upper ? M.Hw : (M.n3 - M.n0)) * 0.42, y0 = (upper ? C : X) + (upper ? M.ovU : M.ovL) + s * 0.7, t = M.t * 0.9;
      const pts = FLGeo.bez({ x: -w / 2, y: y0 + w * 0.42 }, { x: -w / 2, y: y0 - w * 0.1 }, { x: w / 2, y: y0 - w * 0.1 }, { x: w / 2, y: y0 + w * 0.42 });
      return FLGeo.fit(FLGeo.stroke(pts, t));
    };
    const ACC = {
      dU: () => accentOf(['Ë', 'Ä', 'Ö', 'Ü', 'Ï'], true, ['¨', '̈']) || synthDots(true),
      dL: () => accentOf(['ë', 'ä', 'ö', 'ü'], false, ['¨', '̈']) || synthDots(false),
      bU: () => accentOf(['Ă', 'Ŭ', 'Ğ'], true, ['˘', '̆']) || synthBreve(true),
      bL: () => accentOf(['ă', 'ŭ', 'ğ'], false, ['˘', '̆']) || synthBreve(false),
    };
    // поставить знак по центру буквы g
    const withAcc = (g, key, how) => {
      if (!g) return null;
      const a = ACC[key](); if (!a) return null;
      const ab = FLGeo.bboxC(a), gb = FLGeo.bbox(polysOf(g));
      const gc = (gb.x1 + gb.x2) / 2 + (sl ? ((ab.y1 + ab.y2) / 2 - y0) * sl : 0), ac = (ab.x1 + ab.x2) / 2;
      const cs = FLGeo.mapNodes(a, (x, y) => [x + gc - ac, y]);
      return plus(g, { contours: cs }, how);
    };

    // ---------- рецепты ----------
    const cache = {};
    const get = ch => {
      if (ch in cache) return cache[ch];
      cache[ch] = null;
      let g = null;
      try { g = (RX[ch] || (() => null))(); } catch (e) { console.warn('FontLab: рецепт', ch, e); g = null; }
      return (cache[ch] = g);
    };
    const smallcap = (ch, how) => {
      const g = get(ch); if (!g) return null;
      const [l, r] = sb(g);
      let p = FLGeo.sc(polysOf(g), M.k, M.k, 0, 0);
      p = TR(FLGeo.offset(p, M.dk), 0, M.dk);
      return mk(p, l * M.sbK * M.k / Math.max(0.5, M.k), r * M.sbK, how || 'уменьшенная ' + ch + ' (толщина сохранена)');
    };
    const sides = (l, r) => [M.SB[l] !== undefined ? M.SB[l] : l, M.SB[r] !== undefined ? M.SB[r] : r];

    const RX = {
      'А': () => cp('A'), 'В': () => cp('B'), 'Е': () => cp('E'), 'К': () => cp('K'), 'М': () => cp('M'), 'Н': () => cp('H'),
      'О': () => cp('O'), 'Р': () => cp('P'), 'С': () => cp('C'), 'Т': () => cp('T'), 'Х': () => cp('X'),
      'Ё': () => cp('Ë', 'копия Ë') || withAcc(get('Е'), 'dU', 'Е + две точки'),
      'И': () => mir('N', 'N, отражённая'),
      'Й': () => withAcc(get('И'), 'bU', 'И + кратка'),
      'Я': () => mir('R', 'R, отражённая'),
      'Ь': () => flipV('P', 'P, перевёрнутая'),
      'Г': () => {
        if (has('E') && M.e1 !== undefined && M.eTop !== undefined) {
          const p = U(D(P('E'), R(M.e1 + 0.3, -B, B, M.eTop - 0.3)), ustem(M.e0));
          return mk(p, M.SB.S, or(rsb('E'), M.SB.Sr), 'E без средней и нижней перекладин');
        }
        return mk(U(ustem(0), R(0, C - M.tt, M.Hw * 0.75, C)), M.SB.S, M.SB.Sr * 0.5, 'штамб + перекладина');
      },
      'Б': () => {
        const b = get('Ь'); if (!b) return null;
        const bp = polysOf(b);
        const st = FLGeo.scan(bp, C * 0.8); if (!st.length) return null;
        let arm;
        if (has('E') && M.e1 !== undefined && M.eTop !== undefined) arm = TR(I(P('E'), R(M.e1 - 0.5, M.eTop - 0.5, B, B)), st[0][0] - M.e0);
        else arm = R(st[0][1] - 1, C - M.tt, st[0][0] + M.Hw * 0.78, C);
        const [l, r] = sb(b);
        return mk(U(bp, arm), l, Math.min(r, or(rsb('E'), r)), 'Ь + верхняя перекладина E');
      },
      'Ъ': () => {
        const b = get('Ь'); if (!b) return null;
        const bp = polysOf(b), st = FLGeo.scan(bp, C * 0.8); if (!st.length) return null;
        const fl = M.Hc * 0.42;
        const [, r] = sb(b);
        return mk(U(bp, R(st[0][0] - fl, C - M.tt, st[0][0] + S * 0.5, C)), or(lsb('T'), M.SB.D), r, 'Ь + флажок');
      },
      'Ы': () => {
        const b = get('Ь'); if (!b) return null;
        const bp = polysOf(b), bx = FLGeo.bbox(bp);
        return mk(U(bp, ustem(bx.x2 + M.Hc * 0.26)), sb(b)[0], M.SB.Sr, 'Ь + штамб');
      },
      'П': () => mk(U(Hstems(), R(M.a0, C - M.tt, M.b1, C)), M.SB.S, M.SB.Sr, 'штамбы H + верхняя перекладина'),
      'Ц': () => {
        const ext = S * 0.5, x1 = M.b1 + ext;
        return mk(U(Hstems(), R(M.a0, 0, x1, M.tb), R(x1 - S * 0.82, -M.Dd, x1, M.tb)), M.SB.S, M.SB.Sr * 0.45, 'штамбы H + нижняя перекладина + хвост');
      },
      'Ш': () => {
        const g = M.Hc * 0.6, xs = [M.a0, M.a0 + S + g, M.a0 + 2 * (S + g)];
        return mk(U(...xs.map(x => ustem(x)), R(M.a0, 0, xs[2] + S, M.tb)), M.SB.S, M.SB.Sr, 'три штамба + перекладина');
      },
      'Щ': () => {
        const g = M.Hc * 0.6, xs = [M.a0, M.a0 + S + g, M.a0 + 2 * (S + g)], x1 = xs[2] + S + S * 0.5;
        return mk(U(...xs.map(x => ustem(x)), R(M.a0, 0, x1, M.tb), R(x1 - S * 0.82, -M.Dd, x1, M.tb)), M.SB.S, M.SB.Sr * 0.45, 'Ш + хвост');
      },
      'Ж': () => {
        if (!has('K')) return null;
        const r = FLGeo.scan(P('K'), C * 0.12); if (!r.length) return null;
        const [k0, k1] = r[0];
        return mk(U(P('K'), mirrorP(P('K'), (k0 + k1) / 2)), or(rsb('K'), M.SB.D), or(rsb('K'), M.SB.D), 'K + отражённая K');
      },
      'З': () => {
        if (has('3')) {
          const b = bb('3'), h = b.y2 - b.y1;
          if (b.y1 > -0.08 * C && h > 0.8 * C) {
            const k = (C + 2 * M.ovU) / h;
            const p = FLGeo.sc(P('3'), 1, k, 0, b.y1);
            return mk(TR(p, 0, -M.ovU - b.y1), M.SB.R * 0.8, M.SB.R * 0.9, 'цифра 3');
          }
        }
        if (!has('B')) return null;
        const st = FLGeo.scan(P('B'), C * 0.5);
        return mk(D(P('B'), R(-B, -B, st[0][1] - 0.5, B)), M.SB.R, M.SB.Rr, 'чаши B без штамба');
      },
      'Л': () => {
        const w = M.Hw * 0.92, x0 = 0, rx = x0 + w - S, Lt = x0 + w * 0.26, hw = M.leg;
        const leg = FLGeo.stroke(FLGeo.bez({ x: Lt + hw * 0.5, y: C + 2 }, { x: Lt + hw * 0.45, y: C * 0.45 }, { x: Lt * 0.75, y: C * 0.12 }, { x: x0 + hw * 0.2, y: -2 }), hw);
        return mk(U(I(leg, R(-B, 0, B, C)), ustem(rx), R(Lt, C - M.tt, rx + S * 0.5, C)), M.SB.D + S * 0.1, M.SB.Sr, 'построена: ножка + штамб + перекладина');
      },
      'Д': () => {
        const w = M.Hw * 1.04, ext = S * 0.3, rx = w - ext - S, Lt = w * 0.3, hw = M.leg, tb = M.tb;
        const leg = FLGeo.stroke(FLGeo.bez({ x: Lt + hw * 0.5, y: C + 2 }, { x: Lt + hw * 0.4, y: C * 0.5 }, { x: S * 1.3, y: C * 0.2 }, { x: S * 0.6 + hw * 0.4, y: tb * 0.3 }), hw);
        const p = U(I(leg, R(-B, tb * 0.5, B, C)), ustem(rx, tb * 0.5), R(Lt, C - M.tt, rx + S * 0.5, C), R(0, 0, w, tb), R(0, -M.Dd, S * 0.85, tb), R(w - S * 0.85, -M.Dd, w, tb));
        return mk(p, M.SB.D + S * 0.05, M.SB.D + S * 0.05, 'построена: ножка + штамб + основание с выносными');
      },
      'У': () => {
        if (!has('y')) return cp('Y', 'копия Y');
        const b = bb('y'), k = (C + M.ovU * 0) / (b.y2 - b.y1);
        let p = FLGeo.sc(P('y'), k, k, 0, b.y1);
        const wY = has('Y') ? bb('Y').x2 - bb('Y').x1 : (b.x2 - b.x1) * k;
        const sx = G.clamp(wY / ((b.x2 - b.x1) * k + 2 * (S - k * s) / 2), 1, 1.15);
        p = FLGeo.sc(p, sx, 1, 0, 0);
        p = FLGeo.offset(p, G.clamp((S - k * s * sx) / 2, -s * 0.3, s * 0.4));
        const pb = FLGeo.bbox(p);
        return mk(TR(p, 0, -pb.y1), or(lsb('Y'), M.SB.D), or(rsb('Y'), M.SB.D), 'увеличенная y');
      },
      'Ф': () => {
        if (!has('O')) return null;
        const k = 0.76, ob = bb('O');
        let bowl = FLGeo.sc(P('O'), k, k, 0, 0);
        bowl = FLGeo.offset(bowl, (M.oS - k * M.oS) / 2 * 0.85);
        let bb2 = FLGeo.bbox(bowl);
        bowl = TR(bowl, -(bb2.x1 + bb2.x2) / 2, C / 2 - (bb2.y1 + bb2.y2) / 2);
        bowl = FLGeo.widen(bowl, 0, S * 0.5);
        void ob;
        return mk(U(bowl, ustem(-S / 2)), M.SB.R, M.SB.Rr, 'сжатая O, раздвинутая + штамб');
      },
      'Ч': () => {
        if (has('U')) {
          const rs = FLGeo.scan(P('U'), C * 0.6); if (rs.length < 2) return null;
          const u3 = rs[rs.length - 1][1], yc = C * 0.62, d = C * 0.36;
          const lift = U(I(P('U'), R(-B, yc, B, B)), TR(I(P('U'), R(-B, -B, B, yc + 0.5)), 0, d));
          return mk(U(lift, ustem(u3 - S)), or(lsb('U'), M.SB.S), M.SB.Sr, 'U с поднятой чашей + штамб');
        }
        return mk(U(ustem(0, C * 0.42), R(0, C * 0.42, M.Hw, C * 0.42 + M.T), ustem(M.Hw - S)), M.SB.S, M.SB.Sr, 'штамбы + перекладина');
      },
      'Э': () => {
        const g = mir('C'); if (!g) return null;
        const p = polysOf(g), b = FLGeo.bbox(p), cy = (b.y1 + b.y2) / 2, rs = FLGeo.scan(p, cy);
        if (!rs.length) return null;
        const last = rs[rs.length - 1];
        return mk(U(p, R(b.x1 + (b.x2 - b.x1) * 0.36, cy - M.T / 2, (last[0] + last[1]) / 2, cy + M.T / 2)), g.lsb, g.rsb, 'C, отражённая + перекладина');
      },
      'Є': () => {
        if (!has('C')) return null;
        const p = P('C'), b = FLGeo.bbox(p), cy = (b.y1 + b.y2) / 2, rs = FLGeo.scan(p, cy);
        if (!rs.length) return null;
        return mk(U(p, R((rs[0][0] + rs[0][1]) / 2, cy - M.T / 2, b.x2 - (b.x2 - b.x1) * 0.34, cy + M.T / 2)), lsb('C'), rsb('C'), 'C + перекладина');
      },
      'Ю': () => {
        if (!has('O')) return null;
        const op = P('O'), ob = bb('O'), gap = M.Hc * 0.3, ox = S + gap;
        const o = TR(op, ox - ob.x1), cy = C / 2;
        return mk(U(ustem(0), R(S - 1, cy - M.T / 2, ox + M.oS * 0.6, cy + M.T / 2), o), M.SB.S, M.SB.Rr, 'штамб + перекладина + O');
      },
      'І': () => cp('I'),
      'Ї': () => cp('Ï', 'копия Ï') || withAcc(cp('I'), 'dU', 'I + две точки'),
      'Ў': () => withAcc(get('У'), 'bU', 'У + кратка'),
      'Ґ': () => {
        const g = get('Г'); if (!g) return null;
        const p = polysOf(g), b = FLGeo.bbox(p);
        return mk(U(p, R(b.x2 - S * 0.9, C - 1, b.x2, C + C * 0.17)), g.lsb, g.rsb, 'Г + отросток');
      },
      '№': () => {
        if (!has('N') || !has('o')) return null;
        const nb = bb('N'), k = 0.62, o = FLGeo.offset(FLGeo.sc(P('o'), k, k, 0, 0), (s - k * s) / 2 * 0.7), obx = FLGeo.bbox(o);
        const gx = nb.x2 + M.Hc * 0.12 - obx.x1, oy = C - obx.y2;
        const om = TR(o, gx, oy), ob2 = FLGeo.bbox(om), yb = ob2.y1 - M.t * 1.4;
        return mk(U(P('N'), om, R(ob2.x1, yb - M.t, ob2.x2, yb)), lsb('N'), M.SB.Rr, 'N + уменьшенная o с чертой');
      },

      // ----- строчные -----
      'а': () => cp('a'), 'е': () => cp('e'), 'о': () => cp('o'), 'р': () => cp('p'), 'с': () => cp('c'), 'у': () => cp('y'), 'х': () => cp('x'),
      'ё': () => cp('ë', 'копия ë') || withAcc(get('е'), 'dL', 'е + две точки'),
      'і': () => cp('i'),
      'ї': () => cp('ï', 'копия ï') || (has('ı') ? withAcc(cp('ı'), 'dL', 'ı + две точки') : null),
      'й': () => withAcc(get('и'), 'bL', 'и + кратка'),
      'ў': () => withAcc(get('у'), 'bL', 'у + кратка'),
      'в': () => smallcap('В'), 'г': () => smallcap('Г'), 'д': () => smallcap('Д'), 'ж': () => smallcap('Ж'), 'з': () => smallcap('З'),
      'и': () => smallcap('И'), 'к': () => smallcap('К'), 'л': () => smallcap('Л'), 'м': () => smallcap('М'), 'н': () => smallcap('Н'),
      'п': () => smallcap('П'), 'т': () => smallcap('Т'), 'ц': () => smallcap('Ц'), 'ш': () => smallcap('Ш'), 'щ': () => smallcap('Щ'),
      'я': () => smallcap('Я'), 'ґ': () => {
        const g = get('г'); if (!g) return null;
        const p = polysOf(g), b = FLGeo.bbox(p);
        return mk(U(p, R(b.x2 - s * 0.9, X - 1, b.x2, X + X * 0.2)), g.lsb, g.rsb, 'г + отросток');
      },
      'ь': () => smallcap('Ь'),
      'ъ': () => {
        const b = get('ь'); if (!b) return null;
        const bp = polysOf(b), st = FLGeo.scan(bp, X * 0.8); if (!st.length) return null;
        const fl = (M.n2 - M.n1) * 0.5, [, r] = sb(b);
        return mk(U(bp, R(st[0][0] - fl, X - M.t, st[0][0] + s * 0.5, X)), or(lsb('t'), M.SB.r * 0.5), r, 'ь + флажок');
      },
      'ы': () => {
        const b = get('ь'); if (!b) return null;
        const bp = polysOf(b), bx = FLGeo.bbox(bp);
        return mk(U(bp, lstem(bx.x2 + (M.n2 - M.n1) * 0.3)), sb(b)[0], M.SB.sr, 'ь + штамб');
      },
      'э': () => {
        const g = has('c') ? mir('c') : null; if (!g) return smallcap('Э');
        const p = polysOf(g), b = FLGeo.bbox(p), cy = (b.y1 + b.y2) / 2, rs = FLGeo.scan(p, cy);
        if (!rs.length) return null;
        const last = rs[rs.length - 1], t = M.t * 0.95;
        return mk(U(p, R(b.x1 + (b.x2 - b.x1) * 0.34, cy - t / 2, (last[0] + last[1]) / 2, cy + t / 2)), g.lsb, g.rsb, 'c, отражённая + перекладина');
      },
      'є': () => {
        if (!has('c')) return smallcap('Є');
        const p = P('c'), b = FLGeo.bbox(p), cy = (b.y1 + b.y2) / 2, rs = FLGeo.scan(p, cy);
        if (!rs.length) return null;
        const t = M.t * 0.95;
        return mk(U(p, R((rs[0][0] + rs[0][1]) / 2, cy - t / 2, b.x2 - (b.x2 - b.x1) * 0.32, cy + t / 2)), lsb('c'), rsb('c'), 'c + перекладина');
      },
      'ю': () => {
        if (!has('o')) return smallcap('Ю');
        const ob = bb('o'), gap = (M.n2 - M.n1) * 0.32, ox = M.n0 + s + gap, cy = X / 2, t = M.t;
        return mk(U(lstem(M.n0), R(M.n1 - 1, cy - t / 2, ox + M.loS * 0.6, cy + t / 2), TR(P('o'), ox - ob.x1)), M.SB.s, M.SB.rr, 'штамб + перекладина + o');
      },
      'ф': () => {
        if (!has('o')) return smallcap('Ф');
        const ob = bb('o'), cx = (ob.x1 + ob.x2) / 2;
        const bowl = FLGeo.widen(P('o'), cx, s * 0.55);
        let stem = R(cx - s / 2, M.dsc, cx + s / 2, M.asc);
        if (has('p')) { const r = FLGeo.scan(P('p'), M.dsc * 0.5); if (r.length) stem = U(stem, TR(I(P('p'), R(-B, -B, B, M.dsc * 0.5)), cx - (r[0][0] + r[0][1]) / 2)); }
        if (has('b')) { const y = (X + M.asc) / 2, r = FLGeo.scan(P('b'), y); if (r.length) stem = U(stem, TR(I(P('b'), R(-B, y, B, B)), cx - (r[0][0] + r[0][1]) / 2)); }
        return mk(U(bowl, stem), M.SB.r, M.SB.rr, 'o, раздвинутая + штамб с выносными');
      },
      'ч': () => {
        if (has('u')) {
          const rs = FLGeo.scan(P('u'), X * 0.6); if (rs.length < 2) return smallcap('Ч');
          const u2 = rs[rs.length - 1][0], yc = X * 0.62, d = X * 0.34;
          const lift = U(I(P('u'), R(-B, yc, B, B)), TR(I(P('u'), R(-B, -B, B, yc + 0.5)), 0, d));
          const u3 = rs[rs.length - 1][1];
          const stem = U(I(P('u'), R(u2 - 0.5, X * 0.3, B, B)), R(u2, X * 0.1, u3, X * 0.7), TR(I(nStemL(), R(-B, -B, B, X * 0.3)), u2 - M.n0));
          return mk(U(I(lift, R(-B, -B, u2 + 0.5, B)), stem), or(lsb('u'), M.SB.s), or(rsb('u'), M.SB.sr), 'u с поднятой чашей');
        }
        return smallcap('Ч');
      },
      'б': () => {
        if (!has('o')) return null;
        const ob = bb('o'), w = ob.x2 - ob.x1, sw = M.loS * 0.98;
        const top = M.asc;
        const pts = FLGeo.bez({ x: ob.x1 + sw * 0.5, y: X * 0.5 }, { x: ob.x1 + sw * 0.5, y: X * 1.12 }, { x: ob.x1 + w * 0.2, y: top - M.t * 0.5 }, { x: ob.x2 - w * 0.06, y: top - M.t * 0.5 });
        const st0 = FLGeo.stroke(pts, sw, M.t * 1.1);
        const st = I(st0, R(-B, -B, B, top));
        return mk(U(P('o'), st), M.SB.r, M.SB.rr * 0.8, 'o + восходящий штрих');
      },
    };

    // моноширинный шрифт: все буквы одной ширины
    const advs = [...'HOnoaei'].filter(has).map(c => gl(c).adv);
    M.mono = advs.length > 3 && advs.every(a => a === advs[0]) ? advs[0] : 0;
    const final = (ch, g) => {
      let cs = g.contours ? g.contours : FLGeo.fit(g.polys);
      if (!g.contours && sl) cs = FLGeo.mapNodes(cs, resl);
      if (M.mono && g.adv !== M.mono) {
        const b = FLGeo.bboxC(cs);
        if (b) {
          const w = b.x2 - b.x1, room = M.mono - 2 * Math.max(M.mono * 0.04, Math.min(M.SB.S, M.SB.s));
          const k = w > room ? room / w : 1, nx = (M.mono - w * k) / 2;
          cs = FLGeo.mapNodes(cs, (x, y) => [nx + (x - b.x1) * k, y]);
        }
        g = { ...g, adv: M.mono };
      }
      return { u: ch.codePointAt(0), name: 'uni' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), adv: Math.max(0, Math.round(g.adv)), contours: cs, how: g.how || '', gen: true };
    };
    return { get, final, M };
  },
};

// =====================================================================
// Рабочее пространство «Шрифты»
// =====================================================================
const FontLab = {
  el: null,
  src: null,        // { name, buf, otf }
  base: new Map(),  // u → { gi, name, adv, contours? } — глифы исходного шрифта
  gen: {},          // u → глиф, нарисованный программой
  edits: {},        // u → глиф, исправленный вручную
  meta: { family: '', style: 'Regular' },
  view: 'cyr', sel: null,
  hist: {},
  preview: 'Съешь же ещё этих мягких французских булок, да выпей чаю.\nСЪЕШЬ ЖЕ ЕЩЁ ЭТИХ МЯГКИХ ФРАНЦУЗСКИХ БУЛОК',
  pvSize: 40,

  // ---------- данные ----------
  glyph(u) { return FontLab.edits[u] || FontLab.gen[u] || FontLab.baseGlyph(u); },
  baseGlyph(u) {
    const b = FontLab.base.get(u); if (!b) return null;
    if (!b.contours) b.contours = FLGeo.fromOT(FontLab.src.otf.glyphs.get(b.gi).path);
    return b;
  },
  kind(u) { return FontLab.edits[u] ? 'ed' : FontLab.gen[u] ? 'gen' : FontLab.base.has(u) ? 'orig' : 'none'; },
  get upm() { return FontLab.src ? FontLab.src.otf.unitsPerEm : 1000; },
  get asc() { return FontLab.src ? FontLab.src.otf.ascender : 800; },
  get desc() { return FontLab.src ? FontLab.src.otf.descender : -200; },
  info() {
    const o = FontLab.src.otf, os2 = o.tables.os2 || {};
    return { upm: o.unitsPerEm, italicAngle: o.tables.post ? o.tables.post.italicAngle : 0, capHeight: os2.sCapHeight, xHeight: os2.sxHeight };
  },
  name(o, k) { const n = o.names[k]; return n ? (n.en || Object.values(n)[0] || '') : ''; },

  async load(buf, fileName, restore) {
    const sig = String.fromCharCode(...new Uint8Array(buf.slice(0, 4)));
    if (sig === 'wOF2') throw new Error('Формат WOFF2 не поддерживается — сохраните шрифт как TTF или OTF (например, онлайн-конвертером) и откройте снова');
    let otf;
    try { otf = opentype.parse(buf); } catch (e) { throw new Error('Не удалось прочитать шрифт: ' + (e.message || e)); }
    if (!otf.supported) throw new Error('Этот шрифт не поддерживается');
    FontLab.src = { name: fileName, buf, otf };
    FontLab.base = new Map();
    for (let i = 0; i < otf.glyphs.length; i++) {
      const g = otf.glyphs.get(i);
      for (const u of g.unicodes || []) if (!FontLab.base.has(u)) FontLab.base.set(u, { u, gi: i, name: g.name, adv: g.advanceWidth });
    }
    if (restore) Object.assign(FontLab, { gen: restore.gen || {}, edits: restore.edits || {}, meta: restore.meta || FontLab.meta });
    else {
      FontLab.gen = {}; FontLab.edits = {}; FontLab.hist = {};
      const fam = FontLab.name(otf, 'preferredFamily') || FontLab.name(otf, 'fontFamily') || fileName.replace(/\.\w+$/, '');
      FontLab.meta = { family: fam + ' Cyrillic', style: FontLab.name(otf, 'preferredSubfamily') || FontLab.name(otf, 'fontSubfamily') || 'Regular' };
      const cyr = [...FLSynth.RU_UP + FLSynth.RU_LO].filter(c => FontLab.base.has(c.codePointAt(0))).length;
      FontLab.view = cyr ? 'cyr' : 'lat';
      FontLab.sel = null;
    }
    FontLab.render();
    if (!restore) FontLab.save();
  },
  sourceMap() {
    const m = new Map();
    for (const u of FontLab.base.keys()) { const g = FontLab.edits[u] || FontLab.baseGlyph(u); m.set(u, g); }
    return m;
  },
  synth(all) {
    if (!FontLab.src) return UI.toast('Сначала откройте шрифт');
    const want = [...FLSynth.RU_UP, ...FLSynth.RU_LO, ...FLSynth.EXTRA].filter(ch => {
      const u = ch.codePointAt(0);
      return !FontLab.edits[u] && (all || !FontLab.base.has(u));
    });
    if (!want.length) return UI.toast('Кириллица в шрифте уже есть целиком');
    const had = [...FLSynth.RU_UP + FLSynth.RU_LO].filter(c => FontLab.base.has(c.codePointAt(0))).length;
    const t = performance.now();
    const r = FLSynth.run(FontLab.sourceMap(), FontLab.info(), want.join(''));
    for (const [u, g] of Object.entries(r.glyphs)) FontLab.gen[u] = g;
    FontLab.view = 'cyr';
    FontLab.render(); FontLab.save();
    const n = Object.keys(r.glyphs).length;
    UI.toast(`Нарисовано букв: ${n}` + (had && !all ? ` (в шрифте уже было ${had} — дорисованы только недостающие)` : '') + (r.fails.length ? `. Не получилось: ${r.fails.join(' ')} — нужны латинские образцы` : '') + ` · ${Math.round(performance.now() - t)} мс`);
  },

  // ---------- сохранение работы ----------
  _saveT: 0,
  save() {
    clearTimeout(FontLab._saveT);
    FontLab._saveT = setTimeout(() => {
      if (!FontLab.src || typeof Docs === 'undefined') return;
      Docs.put('fontlab', { v: 1, name: FontLab.src.name, buf: FontLab.src.buf, gen: FontLab.gen, edits: FontLab.edits, meta: FontLab.meta, view: FontLab.view, sel: FontLab.sel, preview: FontLab.preview }).catch(() => { });
    }, 500);
  },
  async restore() {
    let d = null;
    try { d = await Docs.get('fontlab'); } catch (e) { }
    if (!d || !d.buf) return;
    try {
      await FontLab.load(d.buf, d.name || 'шрифт', d);
      FontLab.view = d.view || 'cyr'; if (d.preview) { FontLab.preview = d.preview; FontLab.pvInput.value = d.preview; }
      FontLab.sel = d.sel || null;
      FontLab.render();
    } catch (e) { console.warn('FontLab restore', e); }
  },

  // ---------- интерфейс ----------
  build() {
    const el = h('div', { class: 'fontlab' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    FontLab.title = h('span', { class: 'fl-title muted' }, 'Шрифт не открыт');
    const tab = (k, l) => h('button', { class: 'pbt fl-tab', 'data-v': k, onclick: () => { FontLab.view = k; FontLab.renderGrid(); FontLab.save(); } }, l);
    const bar = h('div', { class: 'wsbar' },
      B('Открыть шрифт…', 'Файл TTF, OTF или WOFF с диска', () => FontLab.openFile()),
      B('Из программы ▾', 'Шрифт, уже подключённый в «Векторе»', e => FontLab.pickApp(e.currentTarget)),
      h('span', { class: 'sep' }),
      B('Сделать кириллицу', 'Нарисовать русские буквы (и Є І Ї Ў Ґ №) из латинских глифов шрифта', () => FontLab.synth(false), 'primary'),
      B('Перерисовать всё', 'Нарисовать кириллицу заново, в том числе поверх букв, что уже есть в шрифте (ручные правки сохраняются)', () => UI.confirm('Перерисовать все кириллические буквы? Ручные правки останутся.', () => FontLab.synth(true))),
      h('span', { class: 'sep' }),
      tab('cyr', 'Кириллица'), tab('lat', 'Латиница'), tab('all', 'Все'),
      h('span', { class: 'sep' }),
      B('Собрать шрифт…', 'Собрать готовый шрифт (.otf) и сохранить на компьютер', () => FontLab.buildDialog(), 'primary'),
      B('Подключить в программу', 'Сразу пользоваться шрифтом в «Векторе»', () => FontLab.attach()),
      h('span', { class: 'grow' }), FontLab.title);
    FontLab.grid = h('div', { class: 'fl-grid' });
    FontLab.ed = h('div', { class: 'fl-editor' });
    FontLab.pvInput = h('textarea', { class: 'fl-pvtext', rows: 2, spellcheck: 'false', value: FontLab.preview, oninput: () => { FontLab.preview = FontLab.pvInput.value; FontLab.renderPreview(); FontLab.save(); } });
    FontLab.pvInput.addEventListener('keydown', e => e.stopPropagation());
    const size = h('input', { type: 'range', min: 18, max: 140, value: FontLab.pvSize, title: 'Кегль', oninput: () => { FontLab.pvSize = +size.value; FontLab.renderPreview(); } });
    FontLab.pv = h('div', { class: 'fl-pvout' });
    const pvbar = h('div', { class: 'fl-preview' }, h('div', { class: 'fl-pvctl' }, h('span', { class: 'muted' }, 'Образец текста'), FontLab.pvInput, size), FontLab.pv);
    el.append(bar, h('div', { class: 'fl-main' }, FontLab.grid, FontLab.ed), pvbar);
    FontLab.el = el;
    FontLab.bindKeys();
    new ResizeObserver(() => { FontLab.renderPreview(); if (FontLab.sel !== null) FontLab.renderEditor(); }).observe(el);
    FontLab.render();
    FontLab.restore();
    return el;
  },
  shown() { FontLab.renderPreview(); },
  render() {
    if (!FontLab.el) return;
    FontLab.title.textContent = FontLab.src ? `${FontLab.src.name} → «${FontLab.meta.family}» · глифов: ${FontLab.base.size} · кириллица: ${FontLab.cyrCount()}/66` : 'Шрифт не открыт';
    FontLab.renderGrid(); FontLab.renderEditor(); FontLab.renderPreview();
  },
  cyrCount() { return [...FLSynth.RU_UP + FLSynth.RU_LO].filter(c => FontLab.glyph(c.codePointAt(0))).length; },
  svgGlyph(g, cls) {
    const asc = FontLab.asc, desc = FontLab.desc, upm = FontLab.upm;
    const w = g ? Math.max(g.adv, upm * 0.25) : upm * 0.5;
    const pad = upm * 0.08;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + 2 * pad} ${asc - desc + 2 * pad}`);
    svg.setAttribute('class', cls || '');
    if (g) svg.innerHTML = `<line x1="0" x2="${w}" y1="${asc}" y2="${asc}" class="fl-base"/><path d="${Path.toD(g.contours, [1, 0, 0, -1, 0, asc])}"/>`;
    return svg;
  },
  listFor(view) {
    if (view === 'cyr') return [...FLSynth.RU_UP, ...FLSynth.RU_LO, ...FLSynth.EXTRA].map(c => c.codePointAt(0));
    const us = [...new Set([...FontLab.base.keys(), ...Object.keys(FontLab.gen).map(Number)])].sort((a, b) => a - b);
    if (view === 'lat') return us.filter(u => u >= 0x20 && u < 0x250 && u !== 0x20);
    return us.filter(u => u > 0x20);
  },
  renderGrid() {
    const gEl = FontLab.grid; if (!gEl) return;
    gEl.innerHTML = '';
    document.querySelectorAll('.fontlab .fl-tab').forEach(b => b.classList.toggle('on', b.dataset.v === FontLab.view));
    if (!FontLab.src) {
      gEl.append(h('div', { class: 'fl-empty' },
        h('h3', {}, 'Кириллица для латинского шрифта'),
        h('p', {}, '1. Откройте шрифт: «Открыть шрифт…» (TTF, OTF, WOFF) или «Из программы».'),
        h('p', {}, '2. Нажмите «Сделать кириллицу» — программа нарисует русские буквы из латинских в стиле шрифта.'),
        h('p', {}, '3. Щёлкните по любой букве и поправьте её: узлы, рычаги, ширину.'),
        h('p', {}, '4. «Собрать шрифт…» — готовый файл .otf сохранится на компьютер; установите его и пользуйтесь. Работа сохраняется сама.')));
      return;
    }
    for (const u of FontLab.listFor(FontLab.view)) {
      const g = FontLab.glyph(u), k = FontLab.kind(u);
      const cell = h('div', { class: 'fl-cell ' + k + (FontLab.sel === u ? ' sel' : ''), 'data-u': u, title: `${String.fromCodePoint(u)}  U+${u.toString(16).toUpperCase().padStart(4, '0')}` + (g && g.how ? ' — ' + g.how : '') + ({ gen: ' (нарисована)', ed: ' (исправлена)', none: ' (нет в шрифте)' }[k] || ''),
        onclick: () => FontLab.select(u) });
      cell.append(FontLab.svgGlyph(g), h('span', { class: 'fl-lbl' }, String.fromCodePoint(u)));
      gEl.append(cell);
    }
  },
  updateCell(u) {
    const c = FontLab.grid && FontLab.grid.querySelector(`.fl-cell[data-u="${u}"]`);
    if (!c) return;
    c.className = 'fl-cell ' + FontLab.kind(u) + (FontLab.sel === u ? ' sel' : '');
    c.firstChild.replaceWith(FontLab.svgGlyph(FontLab.glyph(u)));
  },
  select(u) {
    const prev = FontLab.sel; FontLab.sel = u;
    if (prev !== null) FontLab.updateCell(prev);
    FontLab.updateCell(u);
    FontLab.E.sel = new Set(); FontLab.E.view = null;
    FontLab.renderEditor(); FontLab.save();
  },
  renderPreview() {
    const pv = FontLab.pv; if (!pv) return;
    pv.innerHTML = '';
    if (!FontLab.src) return;
    const upm = FontLab.upm, asc = FontLab.asc, desc = FontLab.desc, sz = FontLab.pvSize;
    const k = sz / upm, maxW = Math.max(200, pv.clientWidth - 24) / k, lh = (asc - desc) * 1.08;
    let d = '', x = 0, y = asc, wMax = 0, miss = 0;
    const sp = FontLab.glyph(32) ? FontLab.glyph(32).adv : upm * 0.28;
    for (const line of FontLab.preview.split('\n')) {
      for (const word of line.split(/(\s+)/)) {
        if (/^\s+$/.test(word)) { x += sp * word.length; continue; }
        let ww = 0; for (const ch of word) { const g = FontLab.glyph(ch.codePointAt(0)); ww += g ? g.adv : upm * 0.5; }
        if (x > 0 && x + ww > maxW) { x = 0; y += lh; }
        for (const ch of word) {
          const g = FontLab.glyph(ch.codePointAt(0));
          if (g) d += Path.toD(g.contours, [1, 0, 0, -1, x, y]);
          else { miss++; d += `M${x + upm * 0.06} ${y}h${upm * 0.38}v${-upm * 0.62}h${-upm * 0.38}z`; }
          x += g ? g.adv : upm * 0.5;
        }
        wMax = Math.max(wMax, x);
      }
      x = 0; y += lh;
    }
    const H = y - lh - desc + upm * 0.05;
    pv.innerHTML = `<svg width="${wMax * k}" height="${H * k}" viewBox="0 0 ${wMax} ${H}"><path d="${d}" fill-rule="nonzero"/></svg>` + (miss ? `<div class="muted">Нет глифов: ${miss} — показаны прямоугольниками</div>` : '');
  },

  // ---------- открыть ----------
  async openFile() {
    const files = await Host.pickFiles('.ttf,.otf,.woff,.woff2', false, 'Открыть шрифт');
    if (!files.length) return;
    const f = files[0];
    await withBusy('Читаю шрифт…', async () => FontLab.load(await (await Host.blobOf(f)).arrayBuffer(), f.name));
  },
  pickApp(btn) {
    const items = [];
    const embedded = new Set(Fonts.embedded());
    for (const [fam, list] of [...Fonts.faces.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      for (const f of list) {
        if (!f.buffer && !f.fd && !f.data) continue;
        const st = { r: '', b: ' Bold', i: ' Italic', bi: ' Bold Italic' }[f.style] || '';
        items.push({ label: fam + st + (embedded.has(fam) ? ' (встроенный)' : f.source === 'local' ? ' (системный)' : ''), action: async () => {
          await withBusy('Читаю шрифт…', async () => {
            let buf = f.buffer || (f.data ? Fonts.b64ToBuf(f.data) : null);
            if (!buf && f.fd) buf = await (await f.fd.blob()).arrayBuffer();
            await FontLab.load(buf.slice(0), fam + st + '.ttf');
          });
        } });
      }
    }
    if (window.queryLocalFonts && !Fonts.localLoaded) items.push({ label: 'Показать шрифты системы…', action: async () => { if (await Fonts.loadLocal()) FontLab.pickApp(btn); } });
    if (!items.length) return UI.toast('В программе нет подходящих шрифтов');
    const r = btn.getBoundingClientRect();
    const m = UI.showMenuList(items, r.left, r.bottom);
    if (m) { m.style.maxHeight = '70vh'; m.style.overflowY = 'auto'; }
  },
};

// ---------- редактор глифа ----------
Object.assign(FontLab, {
  E: { sel: new Set(), view: null, drag: null },
  snap(u) { return JSON.stringify(FontLab.edits[u] || null); },
  pushHist(u, before) {
    if (before === FontLab.snap(u)) return;
    const H = FontLab.hist[u] || (FontLab.hist[u] = { undo: [], redo: [] });
    H.undo.push(before); if (H.undo.length > 200) H.undo.shift();
    H.redo = [];
  },
  changed(u) { FontLab.updateCell(u); FontLab.renderEditor(); FontLab.renderPreview(); FontLab.save(); },
  // глиф для правки (копия в edits при первой правке)
  editable(u) {
    if (!FontLab.edits[u]) {
      const g = FontLab.glyph(u);
      FontLab.edits[u] = g ? { u, name: g.name || 'uni' + u.toString(16).toUpperCase().padStart(4, '0'), adv: g.adv, contours: FLGeo.clone(g.contours), how: g.how || '', gen: !!g.gen }
        : { u, name: 'uni' + u.toString(16).toUpperCase().padStart(4, '0'), adv: Math.round(FontLab.upm * 0.6), contours: [], how: 'нарисована вручную' };
    }
    return FontLab.edits[u];
  },
  // изменение с отменой
  apply(fn) {
    const u = FontLab.sel; if (u === null || !FontLab.src) return;
    const before = FontLab.snap(u);
    const g = FontLab.editable(u);
    if (fn(g) === false) { if (before === 'null') delete FontLab.edits[u]; return; }
    FontLab.pushHist(u, before);
    FontLab.changed(u);
  },
  undo(redo) {
    const u = FontLab.sel, H = FontLab.hist[u]; if (!H) return;
    const from = redo ? H.redo : H.undo, to = redo ? H.undo : H.redo;
    if (!from.length) return;
    to.push(FontLab.snap(u));
    const v = JSON.parse(from.pop());
    if (v) FontLab.edits[u] = v; else delete FontLab.edits[u];
    FontLab.E.sel = new Set();
    FontLab.changed(u);
  },

  renderEditor() {
    const ed = FontLab.ed; if (!ed) return;
    ed.innerHTML = '';
    const u = FontLab.sel;
    if (!FontLab.src || u === null) { ed.append(h('div', { class: 'fl-empty' }, h('p', {}, FontLab.src ? 'Щёлкните по букве слева, чтобы поправить её.' : ''))); return; }
    const g = FontLab.glyph(u), k = FontLab.kind(u);
    const B = (label, title, fn, dis) => h('button', { class: 'pbt', title, onclick: fn, disabled: dis }, label);
    const H = FontLab.hist[u] || { undo: [], redo: [] };
    const bb = g ? FLGeo.bboxC(g.contours) : null;
    const num = (label, val, set, title) => {
      const inp = h('input', { type: 'number', class: 'fl-num', value: Math.round(val), title, step: 1 });
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', () => { const v = +inp.value; if (isFinite(v)) FontLab.apply(gg => set(gg, v)); });
      return h('label', { class: 'fl-met' }, label, inp);
    };
    const head = h('div', { class: 'fl-ehead' },
      h('span', { class: 'fl-big' }, String.fromCodePoint(u)),
      h('div', { class: 'fl-einfo' },
        h('b', {}, `U+${u.toString(16).toUpperCase().padStart(4, '0')}`),
        h('span', { class: 'muted' }, { orig: 'из исходного шрифта', gen: 'нарисована программой', ed: 'исправлена вручную', none: 'нет в шрифте — нарисуйте или возьмите из другой буквы' }[k] + (g && g.how ? ' · ' + g.how : ''))),
      h('span', { class: 'grow' }),
      num('Ширина', g ? g.adv : 0, (gg, v) => { gg.adv = Math.max(0, v); }, 'Ширина знака (advance)'),
      num('Поле слева', bb ? bb.x1 : 0, (gg, v) => { const b = FLGeo.bboxC(gg.contours); if (!b) return false; const d = v - b.x1; FLGeo.mapNodes(gg.contours, (x, y) => [x + d, y]); gg.adv += d; }, 'Левое поле: от начала знака до контура'),
      num('справа', bb && g ? g.adv - bb.x2 : 0, (gg, v) => { const b = FLGeo.bboxC(gg.contours); if (!b) return false; gg.adv = Math.round(b.x2 + v); }, 'Правое поле: от контура до конца знака'));
    const tools = h('div', { class: 'fl-etools' },
      B('↶', 'Отменить (Ctrl+Z)', () => FontLab.undo(false), !H.undo.length),
      B('↷', 'Вернуть (Ctrl+Y)', () => FontLab.undo(true), !H.redo.length),
      h('span', { class: 'sep' }),
      B('Угол / гладкий', 'Переключить тип выделенных узлов (или двойной щелчок по узлу)', () => FontLab.toggleSmooth()),
      B('Удалить узел', 'Удалить выделенные узлы (Delete)', () => FontLab.deleteNodes()),
      B('Объединить контуры', 'Слить наложенные контуры в один чистый контур', () => FontLab.apply(gg => { const p = FLGeo.union(FLGeo.polys(gg.contours)); gg.contours = FLGeo.fit(p); })),
      B('Отразить ↔', 'Отразить букву по горизонтали', () => FontLab.apply(gg => { FLGeo.mapNodes(gg.contours, (x, y) => [gg.adv - x, y]); FLGeo.reverse(gg.contours); })),
      h('span', { class: 'sep' }),
      B('Взять из буквы…', 'Заменить копией другой буквы шрифта (можно отразить)', () => FontLab.takeFrom()),
      B('Сбросить', 'Вернуть букву как была (нарисованную — нарисовать заново)', () => FontLab.reset(), k === 'orig' || k === 'none'));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'fl-canvas');
    const wrap = h('div', { class: 'fl-cwrap' }, svg);
    const hint = h('div', { class: 'fl-hint muted' }, 'Тяните узлы и рычаги · двойной щелчок по контуру — новый узел, по узлу — угол/гладкий · Delete — удалить · щелчок по заливке — весь контур · рамка — несколько узлов (Shift — добавить) · стрелки — сдвиг (Shift ×10) · колесо — масштаб, правая кнопка — сдвиг вида');
    ed.append(head, tools, wrap, hint);
    FontLab.svg = svg;
    requestAnimationFrame(() => FontLab.drawCanvas());
    FontLab.bindCanvas(svg);
  },
  fitView() {
    const svg = FontLab.svg, g = FontLab.glyph(FontLab.sel);
    const W = svg.clientWidth || 600, Hh = svg.clientHeight || 500;
    const asc = Math.max(FontLab.asc, FontLab.upm * 0.8), desc = Math.min(FontLab.desc, -FontLab.upm * 0.2);
    const adv = g ? Math.max(g.adv, FontLab.upm * 0.3) : FontLab.upm * 0.6;
    const z = Math.min(W / (adv + FontLab.upm * 0.5), Hh / (asc - desc + FontLab.upm * 0.15));
    FontLab.E.view = { z, tx: (W - adv * z) / 2, ty: (Hh - (asc - desc) * z) / 2 + asc * z };
  },
  drawCanvas() {
    const svg = FontLab.svg; if (!svg || !svg.isConnected) return;
    if (!FontLab.E.view) FontLab.fitView();
    const { z, tx, ty } = FontLab.E.view, u = FontLab.sel, g = FontLab.glyph(u);
    const S = (x, y) => [x * z + tx, -y * z + ty];
    const W = svg.clientWidth, Hh = svg.clientHeight;
    let out = '';
    const M = FLSynth.ctx ? FontLab.metricsLines() : [];
    for (const [y, l, cls] of M) { const [, sy] = S(0, y); out += `<line x1="0" x2="${W}" y1="${sy}" y2="${sy}" class="fl-g ${cls || ''}"/><text x="4" y="${sy - 3}" class="fl-gt">${l}</text>`; }
    if (g) for (const x of [0, g.adv]) { const [sx] = S(x, 0); out += `<line y1="0" y2="${Hh}" x1="${sx}" x2="${sx}" class="fl-g fl-adv"/>`; }
    if (g) {
      out += `<path class="fl-fill" d="${Path.toD(g.contours, [z, 0, 0, -z, tx, ty])}"/>`;
      g.contours.forEach((sp, ci) => { out += `<path class="fl-hit" data-ci="${ci}" d="${Path.toD([sp], [z, 0, 0, -z, tx, ty])}"/>`; });
      out += `<path class="fl-outline" d="${Path.toD(g.contours, [z, 0, 0, -z, tx, ty])}"/>`;
      const sel = FontLab.E.sel;
      let hs = '', ns = '';
      g.contours.forEach((sp, ci) => {
        const n = sp.nodes.length;
        sp.nodes.forEach((q, ni) => {
          const key = ci + ':' + ni, on = sel.has(key);
          const near = on || sel.has(ci + ':' + ((ni + 1) % n)) || sel.has(ci + ':' + ((ni - 1 + n) % n));
          const [x, y] = S(q.x, q.y);
          if (near) for (const [hx, hy, kd] of [[q.ix, q.iy, 'i'], [q.ox, q.oy, 'o']]) {
            if (Math.abs(hx - q.x) < 1e-6 && Math.abs(hy - q.y) < 1e-6) continue;
            const [a, b] = S(hx, hy);
            hs += `<line x1="${x}" y1="${y}" x2="${a}" y2="${b}" class="fl-hl"/><circle cx="${a}" cy="${b}" r="4" class="fl-h" data-ci="${ci}" data-ni="${ni}" data-k="${kd}"/>`;
          }
          ns += q.t === 'smooth' ? `<circle cx="${x}" cy="${y}" r="4.5" class="fl-n${on ? ' on' : ''}${ni === 0 ? ' first' : ''}" data-ci="${ci}" data-ni="${ni}" data-k="n"/>`
            : `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" class="fl-n${on ? ' on' : ''}${ni === 0 ? ' first' : ''}" data-ci="${ci}" data-ni="${ni}" data-k="n"/>`;
        });
      });
      out += hs + ns;
    }
    if (FontLab.E.marq) { const m = FontLab.E.marq; out += `<rect class="fl-marq" x="${Math.min(m.x0, m.x1)}" y="${Math.min(m.y0, m.y1)}" width="${Math.abs(m.x1 - m.x0)}" height="${Math.abs(m.y1 - m.y0)}"/>`; }
    svg.innerHTML = out;
  },
  metricsLines() {
    const o = FontLab.src.otf, os2 = o.tables.os2 || {};
    const bbY = ch => { const g = FontLab.glyph(ch.codePointAt(0)); const b = g && FLGeo.bboxC(g.contours); return b ? b.y2 : null; };
    const C = bbY('H') || os2.sCapHeight || 0, X = bbY('x') || os2.sxHeight || 0;
    return [[0, 'базовая', 'fl-bl'], [X, 'строчные'], [C, 'прописные'], [o.ascender, 'выносные ↑'], [o.descender, 'выносные ↓']].filter(([y]) => y);
  },
  // экран → единицы шрифта
  toFont(e) {
    const r = FontLab.svg.getBoundingClientRect(), { z, tx, ty } = FontLab.E.view;
    return { x: (e.clientX - r.left - tx) / z, y: -(e.clientY - r.top - ty) / z, sx: e.clientX - r.left, sy: e.clientY - r.top };
  },
  bindCanvas(svg) {
    svg.addEventListener('contextmenu', e => e.preventDefault());
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const v = FontLab.E.view; if (!v) return;
      const p = FontLab.toFont(e), k = Math.exp(-e.deltaY * 0.0015);
      v.z *= k; v.tx = p.sx - p.x * v.z; v.ty = p.sy + p.y * v.z;
      FontLab.drawCanvas();
    }, { passive: false });
    svg.addEventListener('pointerdown', e => {
      const u = FontLab.sel; if (u === null) return;
      const t = e.target, p = FontLab.toFont(e), E = FontLab.E;
      svg.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1) { E.drag = { pan: true, sx: e.clientX, sy: e.clientY, v: { ...E.view } }; return; }
      const ci = t.dataset.ci !== undefined ? +t.dataset.ci : -1, ni = t.dataset.ni !== undefined ? +t.dataset.ni : -1, kd = t.dataset.k;
      // двойной щелчок ловим сами: после первого щелчка холст перерисовывается и событие dblclick теряется
      const now = performance.now(), ld = E.lastDown;
      E.lastDown = { t: now, x: e.clientX, y: e.clientY, key: kd === 'n' ? ci + ':' + ni : null };
      if (ld && now - ld.t < 380 && Math.hypot(e.clientX - ld.x, e.clientY - ld.y) < 6) {
        E.lastDown = null;
        if (ld.key) { E.sel = new Set([ld.key]); FontLab.toggleSmooth(); }
        else FontLab.insertNode(p);
        return;
      }
      if (kd === 'i' || kd === 'o') { E.drag = { handle: { ci, ni, kd }, p0: p, before: FontLab.snap(u) }; FontLab.editable(u); return; }
      if (kd === 'n') {
        const key = ci + ':' + ni;
        if (e.shiftKey) { if (E.sel.has(key)) E.sel.delete(key); else E.sel.add(key); }
        else if (!E.sel.has(key)) E.sel = new Set([key]);
      } else if (ci >= 0 && t.classList.contains('fl-hit')) {
        const g = FontLab.glyph(u);
        if (!e.shiftKey) E.sel = new Set();
        g.contours[ci].nodes.forEach((_, i) => E.sel.add(ci + ':' + i));
      } else {
        if (!e.shiftKey) E.sel = new Set();
        E.marq = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, add: e.shiftKey };
        E.drag = { marq: true };
        FontLab.drawCanvas();
        return;
      }
      E.drag = { nodes: true, p0: p, last: { x: 0, y: 0 }, before: FontLab.snap(u) };
      FontLab.editable(u);
      FontLab.drawCanvas();
    });
    svg.addEventListener('pointermove', e => {
      const E = FontLab.E, d = E.drag; if (!d) return;
      const u = FontLab.sel;
      if (d.pan) { E.view.tx = d.v.tx + e.clientX - d.sx; E.view.ty = d.v.ty + e.clientY - d.sy; FontLab.drawCanvas(); return; }
      const p = FontLab.toFont(e);
      if (d.marq) { E.marq.x1 = p.sx; E.marq.y1 = p.sy; FontLab.drawCanvas(); return; }
      const g = FontLab.edits[u]; if (!g) return;
      if (d.handle) {
        const q = g.contours[d.handle.ci].nodes[d.handle.ni];
        const hx = Math.round(p.x), hy = Math.round(p.y);
        if (d.handle.kd === 'i') { q.ix = hx; q.iy = hy; } else { q.ox = hx; q.oy = hy; }
        if (q.t === 'smooth') {
          const [ax, ay, bx, by] = d.handle.kd === 'i' ? [q.ix, q.iy, q.ox, q.oy] : [q.ox, q.oy, q.ix, q.iy];
          const la = Math.hypot(ax - q.x, ay - q.y), lb = Math.hypot(bx - q.x, by - q.y);
          if (la > 0.5 && lb > 0.5) {
            const nx = q.x - (ax - q.x) / la * lb, ny = q.y - (ay - q.y) / la * lb;
            if (d.handle.kd === 'i') { q.ox = nx; q.oy = ny; } else { q.ix = nx; q.iy = ny; }
          }
        }
        d.moved = true;
      } else if (d.nodes) {
        const dx = Math.round(p.x - d.p0.x) - d.last.x, dy = Math.round(p.y - d.p0.y) - d.last.y;
        if (!dx && !dy) return;
        d.last.x += dx; d.last.y += dy;
        FontLab.moveSel(g, dx, dy);
        d.moved = true;
      }
      FontLab.drawCanvas(); FontLab.renderPreview();
    });
    const up = () => {
      const E = FontLab.E, d = E.drag; if (!d) return;
      E.drag = null;
      const u = FontLab.sel;
      if (d.marq) {
        const m = E.marq; E.marq = null;
        const g = FontLab.glyph(u), { z, tx, ty } = E.view;
        const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
        if (g) g.contours.forEach((sp, ci) => sp.nodes.forEach((q, ni) => { const sx = q.x * z + tx, sy = -q.y * z + ty; if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) E.sel.add(ci + ':' + ni); }));
        FontLab.drawCanvas(); return;
      }
      if (d.before !== undefined) {
        if (d.moved) { FontLab.pushHist(u, d.before); FontLab.changed(u); }
        else if (d.before === 'null') delete FontLab.edits[u];
      }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  },
  moveSel(g, dx, dy) {
    for (const key of FontLab.E.sel) {
      const [ci, ni] = key.split(':').map(Number);
      const q = g.contours[ci] && g.contours[ci].nodes[ni]; if (!q) continue;
      q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy;
    }
  },
  nudge(dx, dy) { if (FontLab.E.sel.size) FontLab.apply(g => FontLab.moveSel(g, dx, dy)); },
  insertNode(p) {
    const g = FontLab.glyph(FontLab.sel); if (!g) return;
    const z = FontLab.E.view.z;
    let best = null;
    g.contours.forEach((sp, ci) => {
      const n = sp.nodes.length;
      for (let i = 0; i < n; i++) {
        const a = sp.nodes[i], b = sp.nodes[(i + 1) % n];
        const pts = Path.segPts(a, b), r = G.nearestOnCubic(...pts, p);
        if (!best || r.d < best.d) best = { ...r, ci, i, line: Path.isLineSeg(a, b) };
      }
    });
    if (!best || best.d * z > 10) return;
    FontLab.apply(gg => {
      const sp = gg.contours[best.ci], n = sp.nodes.length, a = sp.nodes[best.i], b = sp.nodes[(best.i + 1) % n];
      let q;
      if (best.line) q = Path.node(Math.round(best.pt.x), Math.round(best.pt.y));
      else {
        const [l, r] = G.splitCubic(...Path.segPts(a, b), best.t);
        a.ox = l[1].x; a.oy = l[1].y; b.ix = r[2].x; b.iy = r[2].y;
        q = { x: l[3].x, y: l[3].y, ix: l[2].x, iy: l[2].y, ox: r[1].x, oy: r[1].y, t: 'smooth' };
      }
      sp.nodes.splice(best.i + 1, 0, q);
      FontLab.E.sel = new Set([best.ci + ':' + (best.i + 1)]);
    });
  },
  selNodes(g) {
    const out = [];
    for (const key of FontLab.E.sel) { const [ci, ni] = key.split(':').map(Number); if (g.contours[ci] && g.contours[ci].nodes[ni]) out.push([ci, ni]); }
    return out;
  },
  deleteNodes() {
    if (!FontLab.E.sel.size) return UI.toast('Выделите узлы');
    FontLab.apply(g => {
      const by = {};
      for (const [ci, ni] of FontLab.selNodes(g)) (by[ci] = by[ci] || []).push(ni);
      for (const ci of Object.keys(by).map(Number).sort((a, b) => b - a)) {
        const sp = g.contours[ci];
        for (const ni of by[ci].sort((a, b) => b - a)) sp.nodes.splice(ni, 1);
        if (sp.nodes.length < 3) g.contours.splice(ci, 1);
      }
      FontLab.E.sel = new Set();
    });
  },
  toggleSmooth() {
    if (!FontLab.E.sel.size) return UI.toast('Выделите узлы');
    FontLab.apply(g => {
      for (const [ci, ni] of FontLab.selNodes(g)) {
        const sp = g.contours[ci], n = sp.nodes.length, q = sp.nodes[ni], pv = sp.nodes[(ni - 1 + n) % n], nx = sp.nodes[(ni + 1) % n];
        if (q.t === 'smooth') { q.t = 'cusp'; continue; }
        q.t = 'smooth';
        let li = Math.hypot(q.ix - q.x, q.iy - q.y), lo = Math.hypot(q.ox - q.x, q.oy - q.y);
        let dx, dy;
        if (li < 0.5 && lo < 0.5) { dx = nx.x - pv.x; dy = nx.y - pv.y; li = G.dist(q, pv) / 3; lo = G.dist(q, nx) / 3; }
        else if (li < 0.5) { dx = q.ox - q.x; dy = q.oy - q.y; li = G.dist(q, pv) / 3; }
        else if (lo < 0.5) { dx = q.x - q.ix; dy = q.y - q.iy; lo = G.dist(q, nx) / 3; }
        else { dx = (q.ox - q.x) / lo - (q.ix - q.x) / li; dy = (q.oy - q.y) / lo - (q.iy - q.y) / li; }
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        q.ix = q.x - dx * li; q.iy = q.y - dy * li; q.ox = q.x + dx * lo; q.oy = q.y + dy * lo;
      }
    });
  },
  takeFrom() {
    const inp = h('input', { type: 'text', class: 'wide', maxlength: 2, placeholder: 'например, N' });
    const mh = h('input', { type: 'checkbox' }), mv = h('input', { type: 'checkbox' });
    inp.addEventListener('keydown', e => e.stopPropagation());
    UI.dialog('Взять из буквы', h('div', { class: 'form' }, h('label', {}, 'Буква-образец', inp),
      h('label', { class: 'chk' }, mh, 'Отразить по горизонтали'), h('label', { class: 'chk' }, mv, 'Перевернуть по вертикали')),
    [{ label: 'Отмена' }, { label: 'Взять', primary: true, action: () => {
      const ch = [...inp.value.trim()][0]; if (!ch) return false;
      const src = FontLab.glyph(ch.codePointAt(0));
      if (!src) { UI.toast('В шрифте нет буквы «' + ch + '»', true); return false; }
      const yc = FLGeo.bboxC(src.contours) ? (FLGeo.bboxC(src.contours).y1 + FLGeo.bboxC(src.contours).y2) / 2 : 0;
      FontLab.apply(g => {
        g.contours = FLGeo.clone(src.contours); g.adv = src.adv; g.how = 'из ' + ch + (mh.checked ? ', отражённая' : '') + (mv.checked ? ', перевёрнутая' : '');
        if (mh.checked) { FLGeo.mapNodes(g.contours, (x, y) => [g.adv - x, y]); FLGeo.reverse(g.contours); }
        if (mv.checked) { FLGeo.mapNodes(g.contours, (x, y) => [x, 2 * yc - y]); FLGeo.reverse(g.contours); }
      });
    } }]);
  },
  reset() {
    const u = FontLab.sel; if (u === null) return;
    const before = FontLab.snap(u);
    const genBefore = FontLab.gen[u];
    delete FontLab.edits[u];
    if (genBefore) {
      const r = FLSynth.run(FontLab.sourceMap(), FontLab.info(), String.fromCodePoint(u));
      if (r.glyphs[u]) FontLab.gen[u] = r.glyphs[u];
    }
    FontLab.pushHist(u, before);
    FontLab.E.sel = new Set();
    FontLab.changed(u);
  },
  bindKeys() {
    window.addEventListener('keydown', e => {
      if (typeof WS === 'undefined' || WS.current !== 'fonts' || UI.modalOpen()) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (FontLab.sel === null) return;
      const c = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      let done = true;
      if (c && (k === 'z' || k === 'я')) FontLab.undo(e.shiftKey);
      else if (c && (k === 'y' || k === 'н')) FontLab.undo(true);
      else if (c && (k === 'a' || k === 'ф')) { const g = FontLab.glyph(FontLab.sel); FontLab.E.sel = new Set(); if (g) g.contours.forEach((sp, ci) => sp.nodes.forEach((_, ni) => FontLab.E.sel.add(ci + ':' + ni))); FontLab.drawCanvas(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') FontLab.deleteNodes();
      else if (e.key === 'Escape') { FontLab.E.sel = new Set(); FontLab.drawCanvas(); }
      else if (e.key.startsWith('Arrow')) { const s = e.shiftKey ? 10 : 1; FontLab.nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? s : e.key === 'ArrowDown' ? -s : 0); }
      else done = false;
      if (done) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  },
});

// ---------- сборка шрифта ----------
Object.assign(FontLab, {
  // для кернинга: какой латинской буквой «притворяется» сторона кириллической [левая, правая]
  KERN_AS: {
    'А': 'AA', 'Б': 'EB', 'В': 'BB', 'Г': 'EF', 'Д': 'HH', 'Е': 'EE', 'Ё': 'EE', 'Ж': 'XK', 'З': ' B', 'И': 'HH', 'Й': 'HH', 'К': 'KK', 'Л': 'AH', 'М': 'MM',
    'Н': 'HH', 'О': 'OO', 'П': 'HH', 'Р': 'PP', 'С': 'CC', 'Т': 'TT', 'У': 'YY', 'Ф': 'OO', 'Х': 'XX', 'Ц': 'HH', 'Ч': 'UH', 'Ш': 'HH', 'Щ': 'HH', 'Ъ': 'TB',
    'Ы': 'HH', 'Ь': 'HB', 'Э': ' O', 'Ю': 'HO', 'Я': ' H', 'Є': 'OC', 'І': 'II', 'Ї': 'II', 'Ў': 'YY', 'Ґ': 'EF',
    'а': 'aa', 'б': 'o ', 'в': 'no', 'г': 'nr', 'е': 'ee', 'ё': 'ee', 'ж': 'xk', 'и': 'nn', 'й': 'nn', 'к': 'nk', 'л': ' n', 'м': 'nn', 'н': 'nn', 'о': 'oo',
    'п': 'nn', 'р': 'pp', 'с': 'cc', 'у': 'yy', 'ф': 'oo', 'х': 'xx', 'ц': 'nn', 'ч': 'un', 'ш': 'nn', 'щ': 'nn', 'ы': 'nn', 'ь': 'no', 'ъ': ' o', 'э': ' o',
    'ю': 'no', 'я': ' n', 'є': 'oc', 'і': 'ii', 'ї': 'ii', 'ў': 'yy', 'ґ': 'nr',
  },
  async makeFont(family, style) {
    const o = FontLab.src.otf, upm = o.unitsPerEm;
    const glyphs = [], index = new Map();
    const usedNames = new Set();
    const nm = (n, i) => { let s = String(n || 'glyph' + i).replace(/[^\w.]/g, '_'); while (usedNames.has(s)) s += '_'; usedNames.add(s); return s; };
    // исходные глифы — в прежнем порядке (GSUB продолжает работать), с правками
    const editByGi = new Map();
    for (const [u, ed] of Object.entries(FontLab.edits)) { const b = FontLab.base.get(+u); if (b) editByGi.set(b.gi, ed); }
    for (let i = 0; i < o.glyphs.length; i++) {
      const g = o.glyphs.get(i), ed = editByGi.get(i);
      const us = (g.unicodes || []).slice();
      let path = g.path;
      if (ed) path = FLGeo.toOT(FLGeo.removeOverlaps(ed.contours));
      else if (g.path && g.path.commands.length) { const cs = FLGeo.fromOT(g.path); if (cs.length > 1) { const c2 = FLGeo.removeOverlaps(cs); if (c2 !== cs) path = FLGeo.toOT(c2); } }
      const ng = new opentype.Glyph({ name: nm(g.name, i), unicode: us[0], advanceWidth: ed ? ed.adv : g.advanceWidth, path });
      ng.unicodes = us;
      glyphs.push(ng);
      for (const u of g.unicodes || []) index.set(u, i);
    }
    // новые знаки
    const extra = new Set([...Object.keys(FontLab.gen), ...Object.keys(FontLab.edits)].map(Number).filter(u => !FontLab.base.has(u)));
    for (const u of [...extra].sort((a, b) => a - b)) {
      const g = FontLab.glyph(u); if (!g) continue;
      index.set(u, glyphs.length);
      glyphs.push(new opentype.Glyph({ name: nm('uni' + u.toString(16).toUpperCase().padStart(4, '0')), unicode: u, advanceWidth: Math.round(g.adv), path: FLGeo.toOT(FLGeo.removeOverlaps(g.contours)) }));
    }
    const os2 = o.tables.os2 || {};
    const std = ['Regular', 'Bold', 'Italic', 'Bold Italic'].includes(style);
    const opts = {
      familyName: std ? family : family + ' ' + style, styleName: std ? style : 'Regular',
      unitsPerEm: upm, ascender: o.ascender, descender: o.descender,
      designer: FontLab.name(o, 'designer') || ' ', manufacturer: FontLab.name(o, 'manufacturer') || ' ',
      copyright: FontLab.name(o, 'copyright') || ' ', license: FontLab.name(o, 'license') || ' ', licenseURL: FontLab.name(o, 'licenseURL') || ' ',
      description: 'Кириллица дорисована в программе «Вектор»', version: 'Version 1.000',
      glyphs,
      tables: { os2: { usWeightClass: os2.usWeightClass || 400, usWidthClass: os2.usWidthClass || 5, fsSelection: (os2.fsSelection || 64) & 0x61 | (/italic|oblique|курсив/i.test(style) ? 1 : 0) | (/bold/i.test(style) && !/semi|demi|extra|ultra/i.test(style) ? 32 : 0) } },
    };
    if (!(opts.tables.os2.fsSelection & 33)) opts.tables.os2.fsSelection |= 64;
    opts.postScriptName = (family + '-' + style).replace(/[^A-Za-z0-9-]/g, '') || 'VektorCyrillic-Regular';
    opts.fullName = family + ' ' + style;
    const make = withGsub => {
      const f = new opentype.Font({ ...opts, tables: { os2: { ...opts.tables.os2 } } });
      if (!std) { f.names.preferredFamily = { en: family }; f.names.preferredSubfamily = { en: style }; }
      if (withGsub && o.tables.gsub) f.tables.gsub = o.tables.gsub;
      const buf = f.toArrayBuffer();
      opentype.parse(buf); // проверка
      return buf;
    };
    let buf;
    try { buf = make(true); } catch (e) { console.warn('FontLab: GSUB не записан', e); buf = make(false); }
    try { buf = FontLab.addKern(buf, FontLab.kernPairs(o, index)); } catch (e) { console.warn('FontLab: kern', e); }
    return buf;
  },
  // кернинг из GPOS напрямую (opentype.js не читает расширенные lookup 9, а ими пользуются многие шрифты)
  gposKern(buf) {
    const dv = new DataView(buf);
    if (dv.getUint32(0) === 0x774F4646) return null; // WOFF — таблицы сжаты
    let gpos = -1;
    for (let i = 0, n = dv.getUint16(4); i < n; i++) { const p = 12 + i * 16; if (dv.getUint32(p) === 0x47504F53) gpos = dv.getUint32(p + 8); }
    if (gpos < 0) return null;
    const U = o => dv.getUint16(o), I16 = o => dv.getInt16(o);
    const fl = gpos + U(gpos + 6), ll = gpos + U(gpos + 8);
    const idx = new Set();
    for (let i = 0, n = U(fl); i < n; i++) { const r = fl + 2 + i * 6; if (dv.getUint32(r) === 0x6B65726E) { const f = fl + U(r + 4); for (let k = 0, m = U(f + 2); k < m; k++) idx.add(U(f + 4 + k * 2)); } }
    const subs = [];
    for (const li of [...idx].sort((a, b) => a - b)) {
      const L = ll + U(ll + 2 + li * 2), type = U(L);
      for (let k = 0, m = U(L + 4); k < m; k++) {
        let st = L + U(L + 6 + k * 2), t = type;
        if (t === 9) { t = U(st + 2); st = st + dv.getUint32(st + 4); }
        if (t === 2) subs.push(st);
      }
    }
    if (!subs.length) return null;
    const vsize = f => { let c = 0; for (let b = f; b; b >>= 1) c += b & 1; return c * 2; };
    const xadv = (o, f) => { if (!(f & 4)) return 0; let off = 0; if (f & 1) off += 2; if (f & 2) off += 2; return I16(o + off); };
    const cov = (c, g) => {
      if (U(c) === 1) { let lo = 0, hi = U(c + 2) - 1; while (lo <= hi) { const m = (lo + hi) >> 1, v = U(c + 4 + m * 2); if (v === g) return m; if (v < g) lo = m + 1; else hi = m - 1; } return -1; }
      for (let i = 0, n = U(c + 2); i < n; i++) { const r = c + 4 + i * 6; if (g >= U(r) && g <= U(r + 2)) return U(r + 4) + g - U(r); }
      return -1;
    };
    const cls = (c, g) => {
      if (U(c) === 1) { const s0 = U(c + 2), n = U(c + 4); return g >= s0 && g < s0 + n ? U(c + 6 + (g - s0) * 2) : 0; }
      for (let i = 0, n = U(c + 2); i < n; i++) { const r = c + 4 + i * 6; if (g >= U(r) && g <= U(r + 2)) return U(r + 4); }
      return 0;
    };
    return (l, r) => {
      for (const st of subs) {
        const ci = cov(st + U(st + 2), l); if (ci < 0) continue;
        const f1 = U(st + 4), f2 = U(st + 6), s1 = vsize(f1), s2 = vsize(f2);
        if (U(st) === 1) {
          const ps = st + U(st + 10 + ci * 2), n = U(ps), rec = 2 + s1 + s2;
          let lo = 0, hi = n - 1;
          while (lo <= hi) { const m = (lo + hi) >> 1, g = U(ps + 2 + m * rec); if (g === r) return xadv(ps + 2 + m * rec + 2, f1); if (g < r) lo = m + 1; else hi = m - 1; }
        } else {
          const c1 = cls(st + U(st + 8), l), c2 = cls(st + U(st + 10), r), n2 = U(st + 14);
          return xadv(st + 16 + (c1 * n2 + c2) * (s1 + s2), f1);
        }
      }
      return 0;
    };
  },
  // пары кернинга: латиница из исходного шрифта + кириллица по образцам сторон
  kernPairs(o, index) {
    let raw = null;
    try { raw = FontLab.gposKern(FontLab.src.buf); } catch (e) { raw = null; }
    const glyphOf = ch => { const b = FontLab.base.get(ch.codePointAt(0)); return b ? o.glyphs.get(b.gi) : null; };
    const set = [];
    const lat = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?«»"\'’‘“”„()-–—/&*';
    for (const ch of lat) if (FontLab.base.has(ch.codePointAt(0))) set.push({ u: ch.codePointAt(0), L: glyphOf(ch), R: glyphOf(ch) });
    for (const [ch, s] of Object.entries(FontLab.KERN_AS)) {
      const u = ch.codePointAt(0);
      if (!index.has(u) || FontLab.base.has(u)) continue;
      set.push({ u, L: s[0] !== ' ' ? glyphOf(s[0]) : null, R: s[1] !== ' ' ? glyphOf(s[1]) : null });
    }
    const pairs = [];
    for (const a of set) {
      if (!a.R) continue;
      for (const b of set) {
        if (!b.L) continue;
        let v = 0;
        try { v = raw ? raw(a.R.index, b.L.index) : o.getKerningValue(a.R, b.L); } catch (e) { v = 0; }
        if (!v && raw) try { v = o.getKerningValue(a.R, b.L); } catch (e) { v = 0; }
        if (v) pairs.push([index.get(a.u), index.get(b.u), v]);
      }
    }
    if (pairs.length > 10900) { pairs.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2])); pairs.length = 10900; }
    pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    return pairs;
  },
  // дописать таблицу kern (формат 0) в sfnt
  addKern(buf, pairs) {
    if (!pairs.length) return buf;
    const n = pairs.length, len = 4 + 14 + 6 * n;
    const kern = new DataView(new ArrayBuffer(len));
    let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; }
    kern.setUint16(0, 0); kern.setUint16(2, 1);
    kern.setUint16(4, 0); kern.setUint16(6, 14 + 6 * n); kern.setUint16(8, 1);
    kern.setUint16(10, n); kern.setUint16(12, sr * 6); kern.setUint16(14, es); kern.setUint16(16, (n - sr) * 6);
    pairs.forEach(([l, r, v], i) => { kern.setUint16(18 + i * 6, l); kern.setUint16(20 + i * 6, r); kern.setInt16(22 + i * 6, Math.round(v)); });
    return FontLab.addTable(buf, 'kern', kern.buffer);
  },
  addTable(buf, tag, data) {
    const src = new DataView(buf), num = src.getUint16(4);
    const tables = [];
    for (let i = 0; i < num; i++) {
      const p = 12 + i * 16;
      const t = String.fromCharCode(src.getUint8(p), src.getUint8(p + 1), src.getUint8(p + 2), src.getUint8(p + 3));
      if (t === tag) continue;
      tables.push({ tag: t, data: buf.slice(src.getUint32(p + 8), src.getUint32(p + 8) + src.getUint32(p + 12)) });
    }
    tables.push({ tag, data });
    tables.sort((a, b) => a.tag < b.tag ? -1 : 1);
    const n = tables.length, hdr = 12 + 16 * n;
    let total = hdr; for (const t of tables) total += (t.data.byteLength + 3) & ~3;
    const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    let sr = 1, es = 0; while (sr * 2 <= n) { sr *= 2; es++; }
    dv.setUint32(0, src.getUint32(0)); dv.setUint16(4, n); dv.setUint16(6, sr * 16); dv.setUint16(8, es); dv.setUint16(10, n * 16 - sr * 16);
    const sum = (b, off, l) => { let s = 0; const d = new DataView(b); for (let i = 0; i < l; i += 4) s = (s + (i + 4 <= l ? d.getUint32(off + i) : (() => { let v = 0; for (let k = 0; k < 4; k++) v = (v << 8) | (i + k < l ? d.getUint8(off + i + k) : 0); return v >>> 0; })())) >>> 0; return s; };
    let off = hdr, headOff = -1;
    tables.forEach((t, i) => {
      const p = 12 + i * 16;
      for (let k = 0; k < 4; k++) dv.setUint8(p + k, t.tag.charCodeAt(k));
      const d = new Uint8Array(t.data);
      if (t.tag === 'head') { headOff = off; }
      u8.set(d, off);
      if (t.tag === 'head') dv.setUint32(off + 8, 0);
      dv.setUint32(p + 4, sum(out, off, d.byteLength)); dv.setUint32(p + 8, off); dv.setUint32(p + 12, d.byteLength);
      off += (d.byteLength + 3) & ~3;
    });
    if (headOff >= 0) dv.setUint32(headOff + 8, (0xB1B0AFBA - sum(out, 0, total)) >>> 0);
    return out;
  },
  fileBase() { return (FontLab.meta.family + '-' + FontLab.meta.style).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ''); },
  buildDialog() {
    if (!FontLab.src) return UI.toast('Сначала откройте шрифт');
    const fam = h('input', { type: 'text', class: 'wide', value: FontLab.meta.family });
    const st = h('input', { type: 'text', class: 'wide', value: FontLab.meta.style });
    const also = h('input', { type: 'checkbox', checked: true });
    const miss = [...FLSynth.RU_UP + FLSynth.RU_LO].filter(c => !FontLab.glyph(c.codePointAt(0)));
    UI.dialog('Собрать шрифт', h('div', { class: 'form' },
      h('label', {}, 'Название семейства', fam), h('label', {}, 'Начертание', st),
      h('label', { class: 'chk' }, also, 'Сразу подключить в «Вектор»'),
      h('p', { class: 'muted' }, 'Получится файл OpenType (.otf) — его можно установить в Windows и macOS двойным щелчком («Установить»). Название лучше оставить отличным от исходного шрифта, чтобы они не конфликтовали.'),
      miss.length ? h('p', { class: 'fl-warn' }, 'Нет букв: ' + miss.join(' ') + ' — нажмите «Сделать кириллицу» или нарисуйте их.') : null),
    [{ label: 'Отмена' }, { label: 'Собрать и сохранить .otf', primary: true, action: () => {
      FontLab.meta.family = fam.value.trim() || FontLab.meta.family; FontLab.meta.style = st.value.trim() || 'Regular';
      FontLab.save(); FontLab.render();
      FontLab.buildAndSave(also.checked);
    } }]);
  },
  async buildAndSave(attach) {
    const buf = await withBusy('Собираю шрифт…', () => FontLab.makeFont(FontLab.meta.family, FontLab.meta.style));
    if (!buf) return;
    FontLab.lastBuild = buf;
    const name = FontLab.fileBase() + '.otf';
    if (attach) await FontLab.attach(buf);
    const p = await Host.saveFile(name, new Blob([buf], { type: 'font/otf' }), 'font/otf', 'otf');
    if (p) UI.toast('Шрифт сохранён: ' + p + ' — откройте файл и нажмите «Установить»');
  },
  async attach(buf) {
    if (!FontLab.src) return UI.toast('Сначала откройте шрифт');
    if (!buf) buf = await withBusy('Собираю шрифт…', () => FontLab.makeFont(FontLab.meta.family, FontLab.meta.style));
    if (!buf) return null;
    const fam = await Fonts.addFontFile(FontLab.fileBase() + '.otf', buf, true);
    if (fam) { Fonts.changed(); UI.toast(`Шрифт «${fam}» подключён — выберите его в «Векторе» в списке шрифтов`); }
    return fam;
  },
});
