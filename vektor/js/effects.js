// Живые эффекты, как в CorelDRAW: Контур, Оболочка, Выдавливание, Перетекание.
// Параметры хранятся в объекте, а результат каждый раз строится заново —
// поэтому при правке исходного объекта эффект перестраивается сам.
'use strict';

const Effects = {
  SCALE: 1000, // Clipper работает в целых числах: мм × 1000

  // ---------- Оболочка ----------
  defaultEnvelope(b) {
    const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
    return {
      mode: 'curve',
      tl: { x: b.x1, y: b.y1 }, tr: { x: b.x2, y: b.y1 }, br: { x: b.x2, y: b.y2 }, bl: { x: b.x1, y: b.y2 },
      t: { x: mx, y: b.y1 }, r: { x: b.x2, y: my }, b: { x: mx, y: b.y2 }, l: { x: b.x1, y: my },
      box: { ...b },
    };
  },
  // готовые формы оболочки
  envelopePreset(b, kind, k = 0.25) {
    const e = Effects.defaultEnvelope(b);
    const H = b.y2 - b.y1, W = b.x2 - b.x1;
    if (kind === 'arcUp') { e.t.y -= H * k; e.b.y -= H * k; }
    if (kind === 'arcDown') { e.t.y += H * k; e.b.y += H * k; }
    if (kind === 'bulge') { e.t.y -= H * k; e.b.y += H * k; e.l.x -= W * k * 0.5; e.r.x += W * k * 0.5; }
    if (kind === 'pinch') { e.t.y += H * k; e.b.y -= H * k; }
    if (kind === 'flagUp') { e.tr.y -= H * k; e.br.y -= H * k; e.t.y -= H * k / 2; e.b.y -= H * k / 2; e.r.y -= H * k; }
    if (kind === 'perspective') { e.tr.y += H * k; e.br.y -= H * k; e.r.x = b.x2; }
    if (kind === 'trapezoid') { e.tl.x += W * k; e.tr.x -= W * k; e.t.x = (e.tl.x + e.tr.x) / 2; e.l.x = (e.tl.x + e.bl.x) / 2; e.r.x = (e.tr.x + e.br.x) / 2; }
    return e;
  },
  envPoint(e, u, v) {
    const q = (a, c, b, t) => {
      const C = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
      const s = 1 - t;
      return { x: s * s * a.x + 2 * s * t * C.x + t * t * b.x, y: s * s * a.y + 2 * s * t * C.y + t * t * b.y };
    };
    const T = q(e.tl, e.t, e.tr, u), B = q(e.bl, e.b, e.br, u), L = q(e.tl, e.l, e.bl, v), R = q(e.tr, e.r, e.br, v);
    const x = (1 - v) * T.x + v * B.x + (1 - u) * L.x + u * R.x - ((1 - u) * (1 - v) * e.tl.x + u * (1 - v) * e.tr.x + (1 - u) * v * e.bl.x + u * v * e.br.x);
    const y = (1 - v) * T.y + v * B.y + (1 - u) * L.y + u * R.y - ((1 - u) * (1 - v) * e.tl.y + u * (1 - v) * e.tr.y + (1 - u) * v * e.bl.y + u * v * e.br.y);
    return { x, y };
  },
  // деформация геометрии по оболочке (все координаты локальные)
  warp(subs, e) {
    const b = e.box, W = (b.x2 - b.x1) || 1, H = (b.y2 - b.y1) || 1;
    const M = (p) => Effects.envPoint(e, (p.x - b.x1) / W, (p.y - b.y1) / H);
    return subs.map(sp => {
      const out = { closed: sp.closed, nodes: [] };
      const segs = Path.segments(sp);
      const first = M(sp.nodes[0]);
      let cur = { x: first.x, y: first.y, ix: first.x, iy: first.y, ox: first.x, oy: first.y, t: 'cusp' };
      out.nodes.push(cur);
      segs.forEach(([i, j], si) => {
        const pts = Path.segPts(sp.nodes[i], sp.nodes[j]);
        const n = 6;
        let rest = pts;
        for (let k = 0; k < n; k++) {
          const t = 1 / (n - k);
          const [A, Bp] = k < n - 1 ? G.splitCubic(...rest, t) : [rest, null];
          const c1 = M(A[1]), c2 = M(A[2]), end = M(A[3]);
          cur.ox = c1.x; cur.oy = c1.y;
          const isLast = sp.closed && si === segs.length - 1 && k === n - 1;
          if (isLast) { out.nodes[0].ix = c2.x; out.nodes[0].iy = c2.y; }
          else { cur = { x: end.x, y: end.y, ix: c2.x, iy: c2.y, ox: end.x, oy: end.y, t: 'smooth' }; out.nodes.push(cur); }
          if (Bp) rest = Bp;
        }
      });
      return out;
    });
  },

  // ---------- Clipper ----------
  toClipper(subs) {
    const S = Effects.SCALE;
    return Path.flatten(subs, null, 12).filter(sp => sp.pts.length > 1).map(sp => ({ closed: sp.closed, path: sp.pts.map(p => ({ X: Math.round(p.x * S), Y: Math.round(p.y * S) })) }));
  },
  fromClipper(paths) {
    const S = Effects.SCALE;
    return paths.filter(p => p.length > 2).map(p => ({ closed: true, nodes: p.map(q => Path.node(q.X / S, q.Y / S)) }));
  },
  offset(subs, delta, join = 'round') {
    if (typeof ClipperLib === 'undefined') return [];
    const co = new ClipperLib.ClipperOffset(2, 0.05 * Effects.SCALE);
    const jt = join === 'miter' ? ClipperLib.JoinType.jtMiter : join === 'bevel' ? ClipperLib.JoinType.jtSquare : ClipperLib.JoinType.jtRound;
    for (const c of Effects.toClipper(subs)) {
      co.AddPath(c.path, jt, c.closed ? ClipperLib.EndType.etClosedPolygon : ClipperLib.EndType.etOpenRound);
    }
    const sol = new ClipperLib.Paths();
    co.Execute(sol, delta * Effects.SCALE);
    return Effects.fromClipper(sol);
  },

  // ---------- Контур ----------
  // { steps, offset, dir: 'outside'|'inside'|'center', fill, stroke, join }
  contourItems(o, wsubs) {
    const c = o.contour, items = [];
    const steps = c.dir === 'center' ? 200 : G.clamp(Math.round(c.steps || 1), 1, 200);
    const sign = c.dir === 'outside' ? 1 : -1;
    const f0 = o.fill && o.fill.type !== 'none' ? o.fill.color : null;
    const s0 = o.stroke && o.stroke.color ? o.stroke.color : null;
    const raw = [];
    for (let i = 1; i <= steps; i++) {
      const subs = Effects.offset(wsubs, sign * i * Math.max(0.05, c.offset || 2), c.join);
      if (!subs.length) break;
      raw.push(subs);
    }
    const n = raw.length;
    raw.forEach((subs, k) => {
      const t = (k + 1) / n;
      items.push({
        subs,
        fill: f0 ? { type: 'solid', color: Color.mix(f0, c.fill || f0, t) } : { type: 'none' },
        stroke: s0 ? Object.assign({}, o.stroke, { color: Color.mix(s0, c.stroke || s0, t) }) : { color: null },
      });
    });
    // внешние шаги рисуются позади (от дальнего к ближнему), внутренние — поверх
    return c.dir === 'outside' ? { before: items.reverse(), after: [] } : { before: [], after: items };
  },

  // ---------- Выдавливание ----------
  // { depth, angle, persp (0..0.9), color, shade }
  extrudeItems(o, wsubs) {
    const e = o.extrude, items = [];
    const a = (e.angle ?? -45) * Math.PI / 180;
    const dir = { x: Math.cos(a), y: -Math.sin(a) };
    const depth = e.depth || 10;
    const box = Path.bbox(wsubs), cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
    const persp = G.clamp(e.persp || 0, 0, 0.95);
    const back = (p) => {
      const s = 1 - persp;
      return { x: cx + (p.x - cx) * s + dir.x * depth, y: cy + (p.y - cy) * s + dir.y * depth };
    };
    const base = e.color || (o.fill && o.fill.type !== 'none' ? Color.mix(o.fill.color, '#000000', 0.35) : '#777777');
    const light = { x: -0.6, y: -0.8 };
    const faces = [];
    for (const sp of Path.flatten(wsubs, null, 10)) {
      const P = sp.pts, n = P.length;
      const cnt = sp.closed ? n : n - 1;
      for (let i = 0; i < cnt; i++) {
        const p1 = P[i], p2 = P[(i + 1) % n];
        const q1 = back(p1), q2 = back(p2);
        const ex = p2.x - p1.x, ey = p2.y - p1.y, L = Math.hypot(ex, ey) || 1;
        const nx = ey / L, ny = -ex / L;
        const lum = e.shade === false ? 0 : (nx * light.x + ny * light.y);
        const col = lum >= 0 ? Color.mix(base, '#ffffff', lum * 0.35) : Color.mix(base, '#000000', -lum * 0.35);
        const key = ((p1.x + p2.x) / 2) * dir.x + ((p1.y + p2.y) / 2) * dir.y;
        faces.push({ key, col, pts: [p1, p2, q2, q1] });
      }
    }
    // грани со стороны, обратной выдавливанию, закрыты остальными — рисуем их первыми
    faces.sort((A, B) => A.key - B.key);
    const backSubs = wsubs.map(sp => ({ closed: sp.closed, nodes: sp.nodes.map(nd => { const p = back(nd), i = back({ x: nd.ix, y: nd.iy }), q = back({ x: nd.ox, y: nd.oy }); return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: q.x, oy: q.y, t: nd.t }; }) }));
    items.push({ subs: backSubs, fill: { type: 'solid', color: Color.mix(base, '#000000', 0.25) }, stroke: { color: null } });
    for (const f of faces) {
      items.push({ subs: [{ closed: true, nodes: f.pts.map(p => Path.node(p.x, p.y)) }], fill: { type: 'solid', color: f.col }, stroke: { color: f.col, width: 0.05 } });
    }
    return { before: items, after: [] };
  },

  // ---------- Перетекание ----------
  // объект type 'blend': children [A, B], steps, двигаются вместе
  blendItems(bl) {
    const [A, B] = bl.children;
    if (!A || !B) return [];
    const steps = G.clamp(Math.round(bl.steps || 10), 1, 500);
    const la = Model.leaves(A)[0], lb = Model.leaves(B)[0];
    const sa = A.type === 'group' ? null : Model.worldSubs(A), sb = B.type === 'group' ? null : Model.worldSubs(B);
    const same = sa && sb && sa.length === sb.length && sa.every((sp, i) => sp.nodes.length === sb[i].nodes.length && sp.closed === sb[i].closed);
    let ra = !same && sa && sb ? Effects.resample(sa) : null, rb = ra ? Effects.resample(sb) : null;
    // начальные узлы и направление обхода подбираются так, чтобы форма не «скручивалась»
    if (same) Effects.alignNodes(sa, sb);
    if (ra) Effects.alignNodes(ra, rb);
    const mixPaint = (t) => {
      const f = structuredClone(la.fill || { type: 'none' }), s = structuredClone(la.stroke || {});
      const fb = lb.fill || {}, sb2 = lb.stroke || {};
      if (f.type === 'none' && fb.type && fb.type !== 'none') Object.assign(f, structuredClone(fb));
      if (f.color && fb.color) f.color = Color.mix(f.color, fb.color, t);
      if (f.color2 && fb.color2) f.color2 = Color.mix(f.color2, fb.color2, t);
      if (s.color && sb2.color) s.color = Color.mix(s.color, sb2.color, t);
      if (s.width !== undefined && sb2.width !== undefined) s.width = G.lerp(s.width, sb2.width, t);
      return { fill: f, stroke: s, opacity: G.lerp(la.opacity ?? 1, lb.opacity ?? 1, t) };
    };
    const items = [];
    const ba = Model.worldBox(A), bb = Model.worldBox(B);
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      let o;
      if (same || ra) {
        const P = same ? [sa, sb] : [ra, rb];
        const subs = P[0].map((sp, k) => ({
          closed: sp.closed, nodes: sp.nodes.map((n, j) => {
            const m = P[1][k].nodes[j];
            const L = key => G.lerp(n[key], m[key], t);
            return { x: L('x'), y: L('y'), ix: L('ix'), iy: L('iy'), ox: L('ox'), oy: L('oy'), t: n.t };
          }),
        }));
        o = Object.assign({ id: bl.id + '_b' + i, type: 'path', subs, m: Mx.id(), visible: true }, mixPaint(t));
      } else {
        o = structuredClone(A);
        const re = x => { x.id = bl.id + '_b' + i + '_' + x.id; if (x.children) x.children.forEach(re); };
        re(o);
        const w1 = ba.x2 - ba.x1 || 1, h1 = ba.y2 - ba.y1 || 1;
        const w = G.lerp(w1, bb.x2 - bb.x1, t), h = G.lerp(h1, bb.y2 - bb.y1, t);
        const cx = G.lerp((ba.x1 + ba.x2) / 2, (bb.x1 + bb.x2) / 2, t), cy = G.lerp((ba.y1 + ba.y2) / 2, (bb.y1 + bb.y2) / 2, t);
        let T = Mx.translate(-(ba.x1 + ba.x2) / 2, -(ba.y1 + ba.y2) / 2);
        T = Mx.mul(Mx.scale(w / w1, h / h1), T);
        T = Mx.mul(Mx.translate(cx, cy), T);
        Model.applyT(o, T);
        const paint = mixPaint(t);
        for (const leaf of Model.leaves(o)) Object.assign(leaf, structuredClone(paint));
      }
      items.push(o);
    }
    return items;
  },
  alignNodes(sa, sb) {
    sa.forEach((A, k) => {
      const B = sb[k];
      if (!A.closed || !B.closed || A.nodes.length !== B.nodes.length) return;
      const n = A.nodes.length;
      const ca = Path.bbox([A]), cb = Path.bbox([B]);
      const ax = (ca.x1 + ca.x2) / 2, ay = (ca.y1 + ca.y2) / 2, bx = (cb.x1 + cb.x2) / 2, by = (cb.y1 + cb.y2) / 2;
      const sxA = (ca.x2 - ca.x1) || 1, syA = (ca.y2 - ca.y1) || 1, sxB = (cb.x2 - cb.x1) || 1, syB = (cb.y2 - cb.y1) || 1;
      const norm = (p, cx, cy, sx, sy) => ({ x: (p.x - cx) / sx, y: (p.y - cy) / sy });
      const an = A.nodes.map(p => norm(p, ax, ay, sxA, syA));
      let best = { cost: Infinity };
      for (const rev of [false, true]) {
        const nodes = rev ? structuredClone(B.nodes) : B.nodes;
        if (rev) Path.reverse({ nodes });
        const bn = nodes.map(p => norm(p, bx, by, sxB, syB));
        for (let sh = 0; sh < n; sh++) {
          let c = 0;
          for (let i = 0; i < n; i++) { const q = bn[(i + sh) % n]; c += (q.x - an[i].x) ** 2 + (q.y - an[i].y) ** 2; }
          if (c < best.cost) best = { cost: c, rev, sh, nodes };
        }
      }
      if (best.sh || best.rev) B.nodes = best.nodes.slice(best.sh).concat(best.nodes.slice(0, best.sh));
    });
  },
  resample(subs, N = 64) {
    const fl = Path.flatten([subs[0]], null, 20)[0];
    const pts = fl.pts.slice(); if (fl.closed) pts.push(pts[0]);
    const len = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { L += G.dist(pts[i - 1], pts[i]); len.push(L); }
    const out = [];
    const cnt = fl.closed ? N : N + 1;
    for (let k = 0; k < cnt; k++) {
      const target = L * k / N;
      let i = len.findIndex(v => v >= target); if (i < 0) i = len.length - 1;
      const l0 = i ? len[i - 1] : 0, seg = len[i] - l0 || 1, u = (target - l0) / seg;
      out.push({ x: G.lerp(pts[i].x, pts[i + 1].x, u), y: G.lerp(pts[i].y, pts[i + 1].y, u) });
    }
    return [{ closed: fl.closed, nodes: G.smoothNodes(out, fl.closed) }];
  },

  // все сгенерированные части эффекта объекта: { before, after } в мировых координатах
  _cache: new WeakMap(),
  parts(o) {
    if (!o.contour && !o.extrude) return null;
    const key = JSON.stringify([o.m, o.contour, o.extrude, o.fill, o.stroke, o.envelope, o.subs, o.w, o.h, o.r, o.sides, o.star, o.inner, o.mode, o.a1, o.a2, o.text, o.font, o.size, o.frame, o.align, o.ls, o.lh]);
    const c = Effects._cache.get(o);
    if (c && c.key === key) return c.val;
    const wsubs = Model.worldSubs(o);
    let val = null;
    if (wsubs && wsubs.length) {
      val = { before: [], after: [] };
      try {
        if (o.extrude) { const r = Effects.extrudeItems(o, wsubs); val.before.push(...r.before); }
        if (o.contour) { const r = Effects.contourItems(o, wsubs); val.before.push(...r.before); val.after.push(...r.after); }
      } catch (e) { console.warn('эффект', e); }
    }
    Effects._cache.set(o, { key, val });
    return val;
  },
  partsBox(o) {
    const p = Effects.parts(o);
    let b = G.emptyBox();
    if (p) for (const it of [...p.before, ...p.after]) b = G.unionBox(b, Path.bbox(it.subs));
    return b;
  },
};
