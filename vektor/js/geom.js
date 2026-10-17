// Геометрия: аффинные матрицы, кривые Безье, разбор и сборка SVG-путей.
// Все координаты документа — в миллиметрах.
'use strict';

const Mx = {
  id: () => [1, 0, 0, 1, 0, 0],
  // A·B — сначала B, потом A
  mul(A, B) {
    return [
      A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
    ];
  },
  inv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return Mx.id();
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  },
  apply(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; },
  applyVec(m, x, y) { return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y }; },
  translate: (tx, ty) => [1, 0, 0, 1, tx, ty],
  scale(sx, sy, cx = 0, cy = 0) { return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy]; },
  rotate(deg, cx = 0, cy = 0) {
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
  },
  // наклон: kx — по горизонтали (x += tan·(y-cy)), ky — по вертикали
  skew(kxDeg, kyDeg, cx = 0, cy = 0) {
    const tx = Math.tan(kxDeg * Math.PI / 180), ty = Math.tan(kyDeg * Math.PI / 180);
    return [1, ty, tx, 1, -tx * cy, -ty * cx];
  },
  isId(m) { return Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9; },
  str(m) { return 'matrix(' + m.map(v => +v.toFixed(6)).join(' ') + ')'; },
  angle(m) { return Math.atan2(m[1], m[0]) * 180 / Math.PI; },
};

const G = {
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  round: (v, d = 3) => +(+v).toFixed(d),

  emptyBox: () => ({ x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }),
  addPt(b, x, y) { if (x < b.x1) b.x1 = x; if (y < b.y1) b.y1 = y; if (x > b.x2) b.x2 = x; if (y > b.y2) b.y2 = y; return b; },
  unionBox(a, b) { return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) }; },
  boxValid: b => b && isFinite(b.x1) && isFinite(b.x2),
  // габарит box, пересчитанный через матрицу (по четырём углам)
  xformBox(m, b) {
    const r = G.emptyBox();
    for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]]) {
      const p = Mx.apply(m, x, y); G.addPt(r, p.x, p.y);
    }
    return r;
  },
  boxInside: (inner, outer) => inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.y1 >= outer.y1 && inner.y2 <= outer.y2,
  boxTouch: (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2),

  // --- кубические Безье ---
  cubicPt(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  },
  // точные габариты кубической кривой (через корни производной)
  cubicBox(p0, p1, p2, p3, box) {
    G.addPt(box, p0.x, p0.y); G.addPt(box, p3.x, p3.y);
    for (const k of ['x', 'y']) {
      const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
      const b = 2 * (p0[k] - 2 * p1[k] + p2[k]);
      const c = p1[k] - p0[k];
      const ts = [];
      if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
      else {
        const D = b * b - 4 * a * c;
        if (D >= 0) { const s = Math.sqrt(D); ts.push((-b + s) / (2 * a), (-b - s) / (2 * a)); }
      }
      for (const t of ts) if (t > 0 && t < 1) { const p = G.cubicPt(p0, p1, p2, p3, t); G.addPt(box, p.x, p.y); }
    }
    return box;
  },
  // деление кривой в точке t (де Кастельжо)
  splitCubic(p0, p1, p2, p3, t) {
    const L = (a, b) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const a = L(p0, p1), b = L(p1, p2), c = L(p2, p3), d = L(a, b), e = L(b, c), f = L(d, e);
    return [[p0, a, d, f], [f, e, c, p3]];
  },
  // ближайшая точка на кривой: { t, d, pt }
  nearestOnCubic(p0, p1, p2, p3, q) {
    let best = { t: 0, d: Infinity, pt: p0 };
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N, p = G.cubicPt(p0, p1, p2, p3, t), d = G.dist(p, q);
      if (d < best.d) best = { t, d, pt: p };
    }
    let step = 1 / N;
    for (let k = 0; k < 12; k++) {
      step /= 2;
      for (const t of [best.t - step, best.t + step]) {
        if (t < 0 || t > 1) continue;
        const p = G.cubicPt(p0, p1, p2, p3, t), d = G.dist(p, q);
        if (d < best.d) best = { t, d, pt: p };
      }
    }
    return best;
  },

  // Упрощение ломаной (Рамер — Дуглас — Пекер)
  simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let md = 0, mi = -1;
      const a = pts[s], b = pts[e], len = G.dist(a, b);
      for (let i = s + 1; i < e; i++) {
        const p = pts[i];
        // у замкнутого контура концы совпадают — тогда меряем просто расстояние до точки
        const d = len < 1e-9 ? G.dist(a, p) : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = true; stack.push([s, mi], [mi, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  },

  // Плавная кривая через точки (Катмулл — Ром → Безье)
  smoothNodes(pts, closed, tension = 1) {
    const n = pts.length;
    const nodes = pts.map(p => Path.node(p.x, p.y));
    if (n < 3) return nodes;
    const get = i => closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))];
    for (let i = 0; i < n; i++) {
      const p0 = get(i - 1), p1 = get(i + 1), k = tension / 6;
      const node = nodes[i];
      if (!closed && (i === 0 || i === n - 1)) {
        // концы открытой кривой: ручка направлена к соседу
        if (i === 0) { node.ox = pts[0].x + (pts[1].x - pts[0].x) / 3; node.oy = pts[0].y + (pts[1].y - pts[0].y) / 3; }
        else { node.ix = pts[n - 1].x + (pts[n - 2].x - pts[n - 1].x) / 3; node.iy = pts[n - 1].y + (pts[n - 2].y - pts[n - 1].y) / 3; }
        continue;
      }
      const dx = (p1.x - p0.x) * k, dy = (p1.y - p0.y) * k;
      node.ix = pts[i].x - dx; node.iy = pts[i].y - dy;
      node.ox = pts[i].x + dx; node.oy = pts[i].y + dy;
      node.t = 'smooth';
    }
    return nodes;
  },
};

// ---------- Пути: узлы с ручками ----------
// узел: { x, y, ix, iy (входящая ручка), ox, oy (исходящая), t: 'cusp'|'smooth'|'sym' }
// сегмент i → i+1 — кубическая кривая (node.o, next.i); если ручки совпадают с узлами — прямая.
const Path = {
  node: (x, y, t = 'cusp') => ({ x, y, ix: x, iy: y, ox: x, oy: y, t }),
  isLineSeg(a, b) {
    return Math.abs(a.ox - a.x) < 1e-9 && Math.abs(a.oy - a.y) < 1e-9 && Math.abs(b.ix - b.x) < 1e-9 && Math.abs(b.iy - b.y) < 1e-9;
  },
  segPts(a, b) { return [{ x: a.x, y: a.y }, { x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, { x: b.x, y: b.y }]; },
  segments(sp) {
    const out = [], n = sp.nodes.length;
    const cnt = sp.closed ? n : n - 1;
    for (let i = 0; i < cnt; i++) out.push([i, (i + 1) % n]);
    return out;
  },
  toD(subs, m) {
    const P = m ? (x, y) => Mx.apply(m, x, y) : (x, y) => ({ x, y });
    const f = v => +v.toFixed(4);
    let d = '';
    for (const sp of subs) {
      if (!sp.nodes.length) continue;
      const s = P(sp.nodes[0].x, sp.nodes[0].y);
      d += `M${f(s.x)} ${f(s.y)}`;
      for (const [i, j] of Path.segments(sp)) {
        const a = sp.nodes[i], b = sp.nodes[j];
        const e = P(b.x, b.y);
        if (Path.isLineSeg(a, b)) d += `L${f(e.x)} ${f(e.y)}`;
        else {
          const c1 = P(a.ox, a.oy), c2 = P(b.ix, b.iy);
          d += `C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(e.x)} ${f(e.y)}`;
        }
      }
      if (sp.closed) d += 'Z';
    }
    return d;
  },
  bbox(subs) {
    const b = G.emptyBox();
    for (const sp of subs) {
      if (sp.nodes.length === 1) G.addPt(b, sp.nodes[0].x, sp.nodes[0].y);
      for (const [i, j] of Path.segments(sp)) {
        const [p0, p1, p2, p3] = Path.segPts(sp.nodes[i], sp.nodes[j]);
        G.cubicBox(p0, p1, p2, p3, b);
      }
    }
    return b;
  },
  transform(subs, m) {
    for (const sp of subs) for (const n of sp.nodes) {
      let p = Mx.apply(m, n.x, n.y); n.x = p.x; n.y = p.y;
      p = Mx.apply(m, n.ix, n.iy); n.ix = p.x; n.iy = p.y;
      p = Mx.apply(m, n.ox, n.oy); n.ox = p.x; n.oy = p.y;
    }
  },
  // ломаная для булевых операций и перетекания
  flatten(subs, m, segSteps = 16) {
    return subs.map(sp => {
      const pts = [];
      const P = (x, y) => m ? Mx.apply(m, x, y) : { x, y };
      if (!sp.nodes.length) return { closed: sp.closed, pts };
      pts.push(P(sp.nodes[0].x, sp.nodes[0].y));
      for (const [i, j] of Path.segments(sp)) {
        const a = sp.nodes[i], b = sp.nodes[j];
        if (Path.isLineSeg(a, b)) { pts.push(P(b.x, b.y)); continue; }
        const [p0, p1, p2, p3] = Path.segPts(a, b);
        for (let k = 1; k <= segSteps; k++) { const q = G.cubicPt(p0, p1, p2, p3, k / segSteps); pts.push(P(q.x, q.y)); }
      }
      if (sp.closed && pts.length > 1 && G.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
      return { closed: sp.closed, pts };
    });
  },
  reverse(sp) {
    sp.nodes.reverse();
    for (const n of sp.nodes) { [n.ix, n.ox] = [n.ox, n.ix]; [n.iy, n.oy] = [n.oy, n.iy]; }
  },

  // Разбор атрибута d (все команды SVG, включая дуги)
  parse(d) {
    const toks = String(d).match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
    let i = 0, cmd = '', cx = 0, cy = 0, sx = 0, sy = 0, lc = null, lq = null;
    const subs = []; let cur = null;
    const isNum = () => i < toks.length && !/^[a-z]$/i.test(toks[i]);
    const num = () => parseFloat(toks[i++]);
    const moveTo = (x, y) => { cur = { closed: false, nodes: [Path.node(x, y)] }; subs.push(cur); cx = sx = x; cy = sy = y; };
    const ensure = () => { if (!cur || cur.closed) moveTo(cx, cy); };
    const lineTo = (x, y) => { ensure(); cur.nodes.push(Path.node(x, y)); cx = x; cy = y; };
    const cubicTo = (x1, y1, x2, y2, x, y) => {
      ensure();
      const last = cur.nodes[cur.nodes.length - 1]; last.ox = x1; last.oy = y1;
      const n = Path.node(x, y); n.ix = x2; n.iy = y2; cur.nodes.push(n); cx = x; cy = y;
    };
    while (i < toks.length) {
      if (!isNum()) cmd = toks[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      let wasC = false, wasQ = false;
      switch (C) {
        case 'M': { const x = num() + ox, y = num() + oy; moveTo(x, y); cmd = rel ? 'l' : 'L'; break; }
        case 'L': lineTo(num() + ox, num() + oy); break;
        case 'H': lineTo(num() + ox, cy); break;
        case 'V': lineTo(cx, num() + oy); break;
        case 'C': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy, x = num() + ox, y = num() + oy; cubicTo(a, b, c, e, x, y); lc = { x: c, y: e }; wasC = true; break; }
        case 'S': {
          const r = lc ? { x: 2 * cx - lc.x, y: 2 * cy - lc.y } : { x: cx, y: cy };
          const c = num() + ox, e = num() + oy, x = num() + ox, y = num() + oy;
          cubicTo(r.x, r.y, c, e, x, y); lc = { x: c, y: e }; wasC = true; break;
        }
        case 'Q': {
          const qx = num() + ox, qy = num() + oy, x = num() + ox, y = num() + oy;
          cubicTo(cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y);
          lq = { x: qx, y: qy }; wasQ = true; break;
        }
        case 'T': {
          const q = lq ? { x: 2 * cx - lq.x, y: 2 * cy - lq.y } : { x: cx, y: cy };
          const x = num() + ox, y = num() + oy;
          cubicTo(cx + 2 / 3 * (q.x - cx), cy + 2 / 3 * (q.y - cy), x + 2 / 3 * (q.x - x), y + 2 / 3 * (q.y - y), x, y);
          lq = q; wasQ = true; break;
        }
        case 'A': {
          const rx = num(), ry = num(), rot = num(), fa = num(), fs = num(), x = num() + ox, y = num() + oy;
          const segs = Path.arcToCubics(cx, cy, rx, ry, rot, fa, fs, x, y);
          if (!segs.length) lineTo(x, y);
          for (const s of segs) cubicTo(...s);
          break;
        }
        case 'Z': {
          if (cur && !cur.closed) {
            const f = cur.nodes[0], l = cur.nodes[cur.nodes.length - 1];
            if (cur.nodes.length > 1 && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) {
              f.ix = l.ix; f.iy = l.iy; cur.nodes.pop();
            }
            cur.closed = true;
          }
          cx = sx; cy = sy; break;
        }
        default: i++;
      }
      if (!wasC) lc = null;
      if (!wasQ) lq = null;
    }
    for (const sp of subs) Path.detectSmooth(sp);
    return subs.filter(sp => sp.nodes.length > 1 || sp.closed);
  },
  detectSmooth(sp) {
    for (const n of sp.nodes) {
      const ax = n.x - n.ix, ay = n.y - n.iy, bx = n.ox - n.x, by = n.oy - n.y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-6 && lb > 1e-6 && Math.abs(ax * by - ay * bx) / (la * lb) < 0.01 && ax * bx + ay * by > 0) n.t = 'smooth';
      else n.t = n.t || 'cusp';
    }
  },
  // дуга SVG → набор кубических кривых
  arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) return [];
    const phi = phiDeg * Math.PI / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let coef = Math.sqrt(Math.max(0, num / den));
    if (!!fa === !!fs) coef = -coef;
    const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
    const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a;
    };
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
    const out = [], step = dt / n, k = 4 / 3 * Math.tan(step / 4);
    const pt = (t) => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp });
    const der = (t) => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp });
    let t = t1;
    for (let s = 0; s < n; s++) {
      const a = pt(t), da = der(t), b = pt(t + step), db = der(t + step);
      out.push([a.x + k * da.x, a.y + k * da.y, b.x - k * db.x, b.y - k * db.y, b.x, b.y]);
      t += step;
    }
    if (out.length) { const l = out[out.length - 1]; l[4] = x2; l[5] = y2; }
    return out;
  },
};

// ---------- Геометрия примитивов в локальных координатах ----------
const Shapes = {
  K: 0.5522847498,
  rect(w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) {
      return [{ closed: true, nodes: [Path.node(0, 0), Path.node(w, 0), Path.node(w, h), Path.node(0, h)] }];
    }
    const k = r * (1 - Shapes.K);
    const N = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy, t: 'smooth' });
    // 8 узлов: по два на каждый угол
    return [{
      closed: true, nodes: [
        N(r, 0, k, 0, r, 0), N(w - r, 0, w - r, 0, w - k, 0),
        N(w, r, w, k, w, r), N(w, h - r, w, h - r, w, h - k),
        N(w - r, h, w - k, h, w - r, h), N(r, h, r, h, k, h),
        N(0, h - r, 0, h - k, 0, h - r), N(0, r, 0, r, 0, k),
      ],
    }];
  },
  // дуга эллипса: углы в градусах, против часовой (как в CorelDRAW), 0° — справа
  ellipse(w, h, mode = 'ellipse', a1 = 0, a2 = 360) {
    const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
    if (mode === 'ellipse') {
      const kx = rx * Shapes.K, ky = ry * Shapes.K;
      const N = (x, y, ix, iy, ox, oy) => ({ x, y, ix, iy, ox, oy, t: 'smooth' });
      return [{
        closed: true, nodes: [
          N(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky),
          N(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry),
          N(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky),
          N(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry),
        ],
      }];
    }
    let s = a1 * Math.PI / 180, e = a2 * Math.PI / 180;
    while (e <= s) e += 2 * Math.PI;
    const sweep = e - s, n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9)), step = sweep / n, k = 4 / 3 * Math.tan(step / 4);
    const P = t => ({ x: cx + rx * Math.cos(t), y: cy - ry * Math.sin(t) });
    const D = t => ({ x: -rx * Math.sin(t), y: -ry * Math.cos(t) });
    const nodes = [];
    for (let i = 0; i <= n; i++) {
      const t = s + i * step, p = P(t), d = D(t);
      const nd = { x: p.x, y: p.y, ix: p.x - k * d.x, iy: p.y - k * d.y, ox: p.x + k * d.x, oy: p.y + k * d.y, t: 'smooth' };
      if (i === 0) { nd.ix = p.x; nd.iy = p.y; nd.t = 'cusp'; }
      if (i === n) { nd.ox = p.x; nd.oy = p.y; nd.t = 'cusp'; }
      nodes.push(nd);
    }
    if (mode === 'pie') { nodes.push(Path.node(cx, cy)); return [{ closed: true, nodes }]; }
    return [{ closed: false, nodes }];
  },
  // многоугольник/звезда, вписанные в рамку w×h
  polygonPts(w, h, sides, star, inner) {
    sides = Math.max(3, Math.round(sides));
    const raw = [];
    const cnt = star ? sides * 2 : sides;
    for (let i = 0; i < cnt; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / cnt;
      const r = star && i % 2 ? inner : 1;
      raw.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    const b = G.emptyBox(); raw.forEach(p => G.addPt(b, p.x, p.y));
    const bw = b.x2 - b.x1 || 1, bh = b.y2 - b.y1 || 1;
    return {
      pts: raw.map(p => ({ x: (p.x - b.x1) / bw * w, y: (p.y - b.y1) / bh * h })),
      // отображение «единичная окружность → рамка» (для редактирования узлов)
      map: { sx: w / bw, sy: h / bh, ox: -b.x1 * w / bw, oy: -b.y1 * h / bh },
    };
  },
  polygon(w, h, sides, star, inner) {
    const { pts } = Shapes.polygonPts(w, h, sides, star, inner);
    return [{ closed: true, nodes: pts.map(p => Path.node(p.x, p.y)) }];
  },
  spiral(w, h, turns) {
    turns = Math.max(1, turns);
    const pts = [], steps = Math.round(turns * 16);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, a = t * turns * Math.PI * 2;
      pts.push({ x: Math.cos(a) * t, y: Math.sin(a) * t });
    }
    const b = G.emptyBox(); pts.forEach(p => G.addPt(b, p.x, p.y));
    const bw = b.x2 - b.x1 || 1, bh = b.y2 - b.y1 || 1;
    const fit = pts.map(p => ({ x: (p.x - b.x1) / bw * w, y: (p.y - b.y1) / bh * h }));
    return [{ closed: false, nodes: G.smoothNodes(fit, false) }];
  },
};

// ---------- Цвет ----------
const Color = {
  hexToRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  },
  rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(G.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); },
  toCmyk(hex) {
    const { r, g, b } = Color.hexToRgb(hex);
    const R = r / 255, Gg = g / 255, B = b / 255, k = 1 - Math.max(R, Gg, B);
    if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
    return { c: Math.round((1 - R - k) / (1 - k) * 100), m: Math.round((1 - Gg - k) / (1 - k) * 100), y: Math.round((1 - B - k) / (1 - k) * 100), k: Math.round(k * 100) };
  },
  fromCmyk(c, m, y, k) {
    return Color.rgbToHex(255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100));
  },
  mix(a, b, t) {
    const A = Color.hexToRgb(a), B = Color.hexToRgb(b);
    return Color.rgbToHex(G.lerp(A.r, B.r, t), G.lerp(A.g, B.g, t), G.lerp(A.b, B.b, t));
  },
  // любой CSS-цвет → #rrggbb (через canvas)
  normalize(css) {
    if (!css || css === 'none' || css === 'transparent') return null;
    if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
    const m = String(css).match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/i);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return Color.rgbToHex(+m[1], +m[2], +m[3]);
    }
    const ctx = Color._ctx || (Color._ctx = document.createElement('canvas').getContext('2d'));
    ctx.fillStyle = '#000'; ctx.fillStyle = css;
    return /^#/.test(ctx.fillStyle) ? ctx.fillStyle : Color.normalize(ctx.fillStyle);
  },
};
