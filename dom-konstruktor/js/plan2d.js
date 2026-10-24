/* Редактор плана этажа на canvas */
(function () {
'use strict';
const DK = window.DK;

const COL = {
  bg: '#eceeef', sheet: '#ffffff', ink: '#2b2e33', muted: '#7b8088',
  gas: '#dcdee1', insul: '#f0e3a6', bearing: '#b8644a', part: '#dca48c',
  clad: { plaster: '#cbc5bb', brick: '#a9533b', fibro: '#878c93', planken: '#a77a52', siding: '#9aa3a8' },
  glass: '#5f9fc4', wet: 'rgba(63,134,194,.10)', wetLine: '#3f86c2', sel: '#e3a21a', stair: '#8a8f97', rail: '#4a4f57',
};

function Plan2D(canvas, app) {
  const ctx = canvas.getContext('2d');
  const view = { k: 0.05, ox: 40, oy: 40 };
  let tool = 'select', toolArg = null, drag = null, hover = null, draft = null, dpr = 1, hoverEdge = null;
  const pointers = new Map();
  let pinch = null;

  function size() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    render();
  }
  /* границы чертежа: дом с облицовкой, размерные цепочки, террасы и балконы */
  function bounds(p) {
    const m = DK.extT(p) + 1900, b = { x0: -m, y0: -m, x1: p.W + m, y1: p.D + m };
    (p.ext || []).forEach(x => { const r = DK.extRect(p, x); if (r) { b.x0 = Math.min(b.x0, r.x0 - 600); b.y0 = Math.min(b.y0, r.y0 - 600); b.x1 = Math.max(b.x1, r.x1 + 600); b.y1 = Math.max(b.y1, r.y1 + 600); } });
    return b;
  }
  function fit() {
    const p = app.p(), r = canvas.getBoundingClientRect(), b = bounds(p);
    const k = Math.min((r.width - 40) / (b.x1 - b.x0), (r.height - 70) / (b.y1 - b.y0));
    view.k = Math.max(0.01, k);
    view.ox = (r.width - (b.x1 + b.x0) * view.k) / 2; view.oy = (r.height - (b.y1 + b.y0) * view.k) / 2 + 20;
    render();
  }
  const toW = (sx, sy) => ({ x: (sx - view.ox) / view.k, y: (sy - view.oy) / view.k });
  const snap = (v, s) => Math.round(v / (s || 50)) * (s || 50);

  /* ---------- рисование ---------- */
  function path(c, pts, X, Y) { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(X(q.x), Y(q.y)) : c.moveTo(X(q.x), Y(q.y))); c.closePath(); }
  function draw(c, v, p, fid, o) {
    o = o || {};
    const k = v.k, X = (x) => v.ox + x * k, Y = (y) => v.oy + y * k, L = (l) => l * k;
    const ws = DK.walls(p, fid), lv = p.levels[fid], ext = DK.extT(p), t = DK.ts(p);
    const regs = DK.rooms(p, fid), cl = DK.SPEC.clad[p.clad] || DK.SPEC.clad.plaster;
    c.save();
    // облицовка, зазор, утеплитель, несущий слой
    c.fillStyle = COL.clad[p.clad] || '#aaa'; path(c, DK.offsetPoly(p, ext), X, Y); c.fill();
    if (cl.gap) { c.fillStyle = '#fff'; path(c, DK.offsetPoly(p, ext - cl.t), X, Y); c.fill(); }
    if (p.insul) { c.fillStyle = COL.insul; path(c, DK.offsetPoly(p, p.insul), X, Y); c.fill(); }
    drawExts(c, p, fid, X, Y, L, o.sel);
    c.fillStyle = COL.gas; path(c, p.poly, X, Y); c.fill();
    c.fillStyle = COL.sheet; path(c, DK.offsetPoly(p, -t), X, Y); c.fill();
    // помещения
    regs.forEach(r => {
      const R = DK.ROOM[r.type] || DK.ROOM.none;
      c.fillStyle = r.type === 'void' ? '#f3f4f6' : R.wet ? '#eef5fa' : (r.type === 'none' ? '#fbfbfb' : '#fff');
      r.cells.forEach(q => c.fillRect(X(q[0]), Y(q[1]), L(q[2] - q[0]) + 0.5, L(q[3] - q[1]) + 0.5));
      if (r.type === 'void') {
        c.save(); c.beginPath(); r.cells.forEach(q => c.rect(X(q[0]), Y(q[1]), L(q[2] - q[0]), L(q[3] - q[1]))); c.clip();
        c.strokeStyle = 'rgba(43,46,51,.25)'; c.lineWidth = 1;
        line(c, X(r.x0), Y(r.y0), X(r.x1), Y(r.y1)); line(c, X(r.x1), Y(r.y0), X(r.x0), Y(r.y1));
        c.restore();
      }
    });
    if (o.sel && o.sel.kind === 'room') {
      const r = regs.at(o.sel.x, o.sel.y);
      if (r) { c.fillStyle = 'rgba(227,162,26,.14)'; r.cells.forEach(q => c.fillRect(X(q[0]), Y(q[1]), L(q[2] - q[0]) + 0.5, L(q[3] - q[1]) + 0.5)); }
    }
    // мокрая зона
    if (p.wet) {
      const z = p.wet;
      c.fillStyle = COL.wet; c.fillRect(X(z.x), Y(z.y), L(z.w), L(z.h));
      c.save(); c.beginPath(); c.rect(X(z.x), Y(z.y), L(z.w), L(z.h)); c.clip();
      c.strokeStyle = 'rgba(63,134,194,.2)'; c.lineWidth = 1;
      for (let s = -L(z.h); s < L(z.w); s += 10) line(c, X(z.x) + s, Y(z.y) + L(z.h), X(z.x) + s + L(z.h), Y(z.y));
      c.restore();
      c.setLineDash([6, 4]); c.strokeStyle = COL.wetLine; c.lineWidth = tool === 'wet' ? 2 : 1.2; c.strokeRect(X(z.x), Y(z.y), L(z.w), L(z.h)); c.setLineDash([]);
    }
    if (!o.clean) {
      c.save(); path(c, DK.offsetPoly(p, -t), X, Y); c.clip();
      c.strokeStyle = 'rgba(0,0,0,.035)'; c.lineWidth = 1;
      for (let x = 1000; x < p.W; x += 1000) line(c, X(x), Y(0), X(x), Y(p.D));
      for (let y = 1000; y < p.D; y += 1000) line(c, X(0), Y(y), X(p.W), Y(y));
      c.restore();
    }
    if (p.stair) drawStair(c, p, fid, X, Y, L, o.sel && o.sel.kind === 'stair');
    if (o.furn !== false) lv.furn.forEach(f => drawFurn(c, f, X, Y, L, o.sel && o.sel.kind === 'furn' && o.sel.id === f.id));
    // стены
    const order = { outer: 0, bearing: 1, part: 2 };
    ws.slice().sort((a, b) => order[a.kind] - order[b.kind]).forEach(w => {
      if (w.rail) return;
      c.fillStyle = w.kind === 'outer' ? COL.gas : w.kind === 'bearing' ? COL.bearing : COL.part;
      c.fillRect(X(w.x0), Y(w.y0), L(w.x1 - w.x0), L(w.y1 - w.y0));
      if (w.kind !== 'part') hatch(c, X(w.x0), Y(w.y0), L(w.x1 - w.x0), L(w.y1 - w.y0), w.kind === 'outer' ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.35)', w.kind === 'outer' ? 7 : 5);
    });
    c.strokeStyle = COL.ink; c.lineWidth = 1.4;
    path(c, p.poly, X, Y); c.stroke(); path(c, DK.offsetPoly(p, -t), X, Y); c.stroke();
    ws.filter(w => w.kind !== 'outer').forEach(w => {
      const selW = o.sel && o.sel.kind === 'part' && o.sel.id === w.id;
      if (w.rail) {
        c.strokeStyle = COL.rail; c.lineWidth = 2;
        if (w.axis === 'x') line(c, X(w.x0), Y(w.m), X(w.x1), Y(w.m)); else line(c, X(w.m), Y(w.y0), X(w.m), Y(w.y1));
        c.lineWidth = 1;
        for (let a = w.a0; a <= w.a1; a += 600) w.axis === 'x' ? line(c, X(a), Y(w.m) - 3, X(a), Y(w.m) + 3) : line(c, X(w.m) - 3, Y(a), X(w.m) + 3, Y(a));
      } else {
        c.lineWidth = 1; c.strokeStyle = 'rgba(43,46,51,.65)';
        if (w.axis === 'x') { line(c, X(w.x0), Y(w.y0), X(w.x1), Y(w.y0)); line(c, X(w.x0), Y(w.y1), X(w.x1), Y(w.y1)); }
        else { line(c, X(w.x0), Y(w.y0), X(w.x0), Y(w.y1)); line(c, X(w.x1), Y(w.y0), X(w.x1), Y(w.y1)); }
      }
      if (selW) {
        c.strokeStyle = COL.sel; c.lineWidth = 3; c.strokeRect(X(w.x0) - 1, Y(w.y0) - 1, L(w.x1 - w.x0) + 2, L(w.y1 - w.y0) + 2);
        c.fillStyle = COL.sel;
        const ends = w.axis === 'x' ? [[w.x0, w.m], [w.x1, w.m]] : [[w.m, w.y0], [w.m, w.y1]];
        ends.forEach(([ex, ey]) => { c.beginPath(); c.arc(X(ex), Y(ey), 5, 0, 7); c.fill(); });
      }
    });
    // наружная стена под курсором или выбранная
    const he = (o.sel && o.sel.kind === 'edge' && o.sel.id) || (!o.clean && hoverEdge);
    if (he) {
      const w = ws.find(x => x.id === he);
      if (w) { c.strokeStyle = COL.sel; c.lineWidth = o.sel && o.sel.id === he ? 4 : 2.5; const e = w.edge;
        if (e.axis === 'x') line(c, X(e.lo), Y(e.line), X(e.hi), Y(e.line)); else line(c, X(e.line), Y(e.lo), X(e.line), Y(e.hi)); }
    }
    lv.open.forEach(op => drawOpening(c, p, fid, ws, regs, op, X, Y, L, ext, o.sel && o.sel.kind === 'open' && o.sel.id === op.id));
    // подписи помещений
    regs.forEach(r => {
      const R = DK.ROOM[r.type] || DK.ROOM.none;
      const fs = Math.max(9, Math.min(14, L(900)));
      if (L(r.x1 - r.x0) < 40 || L(r.y1 - r.y0) < 24) return;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = r.type === 'none' ? COL.muted : COL.ink;
      c.font = `600 ${fs}px Raleway, sans-serif`;
      const cy = Y(r.cy) - fs * 0.7;
      const num = o.numbers && o.numbers[fid] && o.numbers[fid].get(r.i);
      c.fillText(num ? num + '. ' + R.n : R.n, X(r.cx), cy);
      c.font = `500 ${fs * 0.9}px "JetBrains Mono", monospace`;
      c.fillStyle = COL.ink; c.fillText(DK.fmtA(r.area) + ' м²', X(r.cx), cy + fs * 1.25);
      if (r.rect && o.dims !== false) {
        c.fillStyle = COL.muted; c.font = `500 ${fs * 0.75}px "JetBrains Mono", monospace`;
        c.fillText(Math.round(r.x1 - r.x0) + ' × ' + Math.round(r.y1 - r.y0), X(r.cx), cy + fs * 2.35);
      }
    });
    if (p.wet && L(p.wet.w) > 70) {
      c.font = `700 ${Math.max(9, Math.min(11, L(600)))}px Raleway, sans-serif`; c.fillStyle = COL.wetLine; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText('МОКРАЯ ЗОНА', X(p.wet.x) + 5, Y(p.wet.y) + 4);
    }
    if (o.dims !== false) dims(c, p, fid, ws, X, Y, L, ext, o.dimOpen);
    c.restore();
  }
  function extsOn(p, fid) { return (p.ext || []).filter(x => x.kind === 'balcony' ? x.fid === fid : fid === 'f1'); }
  function drawExts(c, p, fid, X, Y, L, sel) {
    for (const x of extsOn(p, fid)) {
      const r = DK.extRect(p, x); if (!r) continue;
      const e = r.e, R = [X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0)];
      c.fillStyle = x.kind === 'balcony' ? '#e4e6e9' : '#eadfcb'; c.fillRect(R[0], R[1], R[2], R[3]);
      c.save(); c.beginPath(); c.rect(R[0], R[1], R[2], R[3]); c.clip(); c.strokeStyle = 'rgba(120,90,60,.28)'; c.lineWidth = 1;
      if (x.kind !== 'balcony') { if (e.axis === 'x') for (let a = r.x0; a < r.x1; a += 140) line(c, X(a), R[1], X(a), R[1] + R[3]); else for (let a = r.y0; a < r.y1; a += 140) line(c, R[0], Y(a), R[0] + R[2], Y(a)); }
      c.restore();
      c.strokeStyle = COL.ink; c.lineWidth = 1.2; c.strokeRect(R[0], R[1], R[2], R[3]);
      // ограждение или остекление по свободным сторонам
      const roof = x.roof || 'open', far = r.far, a0 = x.c - x.w / 2, a1 = x.c + x.w / 2;
      const seg = (s0, s1, t0, t1) => e.axis === 'x' ? line(c, X(s0), Y(t0), X(s1), Y(t1)) : line(c, X(t0), Y(s0), X(t1), Y(s1));
      c.lineWidth = roof === 'glazed' ? 3 : 2.2; c.strokeStyle = roof === 'glazed' ? COL.glass : COL.rail;
      if (x.kind === 'balcony' || roof === 'glazed') { seg(a0, a1, far, far); seg(a0, a0, r.face, far); seg(a1, a1, r.face, far); }
      else if (x.kind === 'terrace') { const gap = 600; seg(a0, x.c - gap, far, far); seg(x.c + gap, a1, far, far); seg(a0, a0, r.face, far); seg(a1, a1, r.face, far); }
      c.fillStyle = COL.ink;
      DK.extColumns(p, x).forEach(q => c.fillRect(X(q.x - 150), Y(q.y - 150), L(300), L(300)));
      const fs = Math.max(9, Math.min(13, L(800)));
      c.font = `600 ${fs}px Raleway, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = COL.ink;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      if (R[2] > 50 && R[3] > 24) { c.fillText(DK.EXT[x.kind].n, X(cx), Y(cy) - fs * 0.6); c.font = `500 ${fs * 0.9}px "JetBrains Mono", monospace`; c.fillText(DK.fmtA(x.w * x.d / 1e6) + ' м²', X(cx), Y(cy) + fs * 0.6); }
      if (sel && sel.kind === 'ext' && sel.id === x.id) {
        c.strokeStyle = COL.sel; c.lineWidth = 2.5; c.strokeRect(R[0] - 2, R[1] - 2, R[2] + 4, R[3] + 4);
        c.fillStyle = '#fff'; c.lineWidth = 2;
        extHandles(p, x).forEach(h => { c.beginPath(); c.rect(X(h.x) - 5, Y(h.y) - 5, 10, 10); c.fill(); c.stroke(); });
      }
    }
  }
  function extHandles(p, x) {
    const r = DK.extRect(p, x), e = r.e, a0 = x.c - x.w / 2, a1 = x.c + x.w / 2, mid = (r.face + r.far) / 2;
    const P = (a, t, k) => e.axis === 'x' ? { x: a, y: t, k } : { x: t, y: a, k };
    return [P(x.c, r.far, 'd'), P(a0, mid, 'w0'), P(a1, mid, 'w1')];
  }
  function line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  function hatch(c, x, y, w, h, col, step) {
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.strokeStyle = col; c.lineWidth = 1;
    for (let s = -h; s < w; s += step) line(c, x + s, y + h, x + s + h, y);
    c.restore();
  }

  function drawOpening(c, p, fid, ws, regs, op, X, Y, L, ext, sel) {
    const w = ws.find(v => v.id === op.wall);
    if (!w) return;
    const a0 = op.c - op.w / 2, a1 = op.c + op.w / 2, outer = w.kind === 'outer';
    let t0 = w.axis === 'x' ? w.y0 : w.x0, t1 = w.axis === 'x' ? w.y1 : w.x1;
    if (outer) { if (w.out < 0) t0 -= ext; else t1 += ext; }
    const R = w.axis === 'x' ? [X(a0), Y(t0), L(a1 - a0), L(t1 - t0)] : [X(t0), Y(a0), L(t1 - t0), L(a1 - a0)];
    c.fillStyle = COL.sheet; c.fillRect(R[0], R[1], R[2], R[3]);
    c.strokeStyle = COL.ink; c.lineWidth = 1;
    const P = (a, s) => w.axis === 'x' ? [X(a), Y(s)] : [X(s), Y(a)];
    const ln = (a, b, s0, s1) => { const q0 = P(a, s0), q1 = P(b, s1); line(c, q0[0], q0[1], q1[0], q1[1]); };
    const f0 = w.axis === 'x' ? w.y0 : w.x0, f1 = w.axis === 'x' ? w.y1 : w.x1;
    ln(a0, a0, f0, f1); ln(a1, a1, f0, f1);
    const m = w.m;
    if (op.kind === 'win') {
      c.strokeStyle = COL.glass; c.lineWidth = op.pano ? 3 : 1.6;
      ln(a0, a1, m, m);
      c.strokeStyle = COL.ink; c.lineWidth = 1;
      ln(a0, a1, m - w.t / 2 + 20, m - w.t / 2 + 20); ln(a0, a1, m + w.t / 2 - 20, m + w.t / 2 - 20);
      const n = op.sash || (op.w >= 1300 ? 2 : 1);
      for (let i = 1; i < n; i++) { const a = a0 + (a1 - a0) * i / n; ln(a, a, m - 60, m + 60); }
    } else if (op.kind === 'pass') {
      c.setLineDash([4, 4]); c.strokeStyle = COL.muted; ln(a0, a1, f0, f0); ln(a0, a1, f1, f1); c.setLineDash([]);
    } else {
      const sw = DK.doorSwing(p, fid, op, w, regs), r = a1 - a0 - 60;
      const face = m + sw.side * w.t / 2, ha = sw.hingeLo ? a0 + 30 : a1 - 30, oa = sw.hingeLo ? ha + r : ha - r;
      const H = P(ha, face), Lf = P(ha, face + sw.side * r), Cl = P(oa, face);
      c.strokeStyle = op.kind === 'entry' ? COL.ink : '#5c6168'; c.lineWidth = op.kind === 'entry' ? 2 : 1.3;
      line(c, H[0], H[1], Lf[0], Lf[1]);
      c.lineWidth = 0.8; c.setLineDash([3, 3]);
      const t1a = Math.atan2(Lf[1] - H[1], Lf[0] - H[0]), t2a = Math.atan2(Cl[1] - H[1], Cl[0] - H[0]);
      let d = t2a - t1a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      c.beginPath(); c.arc(H[0], H[1], L(r), t1a, t2a, d < 0); c.stroke(); c.setLineDash([]);
    }
    if (sel) {
      c.strokeStyle = COL.sel; c.lineWidth = 2.5; c.strokeRect(R[0] - 2, R[1] - 2, R[2] + 4, R[3] + 4);
      // ручки ширины на концах проёма
      c.fillStyle = '#fff'; c.lineWidth = 2;
      for (const a of [a0, a1]) { const q = P(a, m); c.beginPath(); c.rect(q[0] - 5, q[1] - 5, 10, 10); c.fill(); c.stroke(); }
      c.fillStyle = COL.ink; c.font = '600 11px "JetBrains Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'bottom';
      const q = P(op.c, w.axis === 'x' ? (w.out < 0 ? t0 : t1) : (w.out < 0 ? t0 : t1));
      c.fillText(op.w + ' мм', q[0], q[1] - 6);
    }
  }

  function drawFurn(c, f, X, Y, L, sel) {
    const F = DK.FURN[f.type]; if (!F) return;
    const T = f.type, base = F.base || T, ang = DK.furnAngle(f) * Math.PI / 180;
    c.save();
    c.translate(X(f.x), Y(f.y)); c.rotate(ang);
    const Z = DK.furnSize(f), w = L(Z.w), d = L(Z.d), l = (x0, y0, x1, y1) => line(c, x0, y0, x1, y1);
    c.fillStyle = F.c; c.strokeStyle = '#6f747b'; c.lineWidth = 1;
    const round = ['tableR', 'coffeeR', 'pouf', 'tank', 'plant', 'lampCeil', 'lampFloor', 'lampTable', 'umbrella', 'barstool'].includes(base);
    if (base === 'kitchenL' || base === 'sofaL') { const s0 = L(base === 'kitchenL' ? 600 : 950); c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, base === 'sofaL' ? d / 2 : -d / 2 + s0); c.lineTo(base === 'sofaL' ? w / 2 - s0 : -w / 2 + s0, base === 'sofaL' ? d / 2 : -d / 2 + s0); c.lineTo(base === 'sofaL' ? w / 2 - s0 : -w / 2 + s0, base === 'sofaL' ? -d / 2 + s0 : d / 2); c.lineTo(base === 'sofaL' ? -w / 2 : -w / 2, base === 'sofaL' ? -d / 2 + s0 : d / 2); c.closePath(); c.fill(); c.stroke(); }
    else if (base === 'kitchenU') { const s0 = L(600); c.beginPath(); c.moveTo(-w / 2, -d / 2); c.lineTo(w / 2, -d / 2); c.lineTo(w / 2, d / 2); c.lineTo(w / 2 - s0, d / 2); c.lineTo(w / 2 - s0, -d / 2 + s0); c.lineTo(-w / 2 + s0, -d / 2 + s0); c.lineTo(-w / 2 + s0, d / 2); c.lineTo(-w / 2, d / 2); c.closePath(); c.fill(); c.stroke(); }
    else if (round && base !== 'plant' && !base.startsWith('lamp')) { c.beginPath(); c.arc(0, 0, Math.min(w, d) / 2, 0, 7); c.fill(); c.stroke(); }
    else if (!round) { rr(c, -w / 2, -d / 2, w, d, Math.min(4, L(60))); c.fill(); c.stroke(); }
    c.strokeStyle = 'rgba(60,64,70,.55)';
    // верхние шкафы кухни — пунктиром вдоль стены
    if (DK.KITCHENS.includes(T) && f.upper !== false) { c.setLineDash([4, 3]); l(-w / 2, -d / 2 + L(350), w / 2, -d / 2 + L(350)); if (base !== 'kitchen') l(-w / 2 + L(350), -d / 2, -w / 2 + L(350), d / 2); if (base === 'kitchenU') l(w / 2 - L(350), -d / 2, w / 2 - L(350), d / 2); c.setLineDash([]); }
    if (base === 'bed160' || base === 'bed90' || base === 'bunk' || base === 'cot') { c.fillStyle = '#fff'; const two = base === 'bed160', pw = two ? (w - L(240)) / 2 : w - L(160);
      for (let i = 0; i < (two ? 2 : 1); i++) { rr(c, -w / 2 + L(80) + i * (pw + L(80)), -d / 2 + L(80), pw, L(380), 3); c.fill(); c.stroke(); }
      l(-w / 2, -d / 2 + L(560), w / 2, -d / 2 + L(560)); if (base === 'bunk') { c.setLineDash([3, 3]); l(-w / 2, d / 2, w / 2, -d / 2); c.setLineDash([]); } }
    else if (base === 'sofa' || base === 'armchair' || base === 'sofaOffice') { rr(c, -w / 2 + 1, -d / 2 + 1, w - 2, L(220), 3); c.stroke(); rr(c, -w / 2 + 1, -d / 2 + 1, L(180), d - 2, 3); c.stroke(); rr(c, w / 2 - L(180) - 1, -d / 2 + 1, L(180), d - 2, 3); c.stroke(); }
    else if (base === 'toilet') { c.beginPath(); c.ellipse(0, L(90), w / 2 - 2, d / 2 - L(170), 0, 0, Math.PI * 2); c.stroke(); l(-w / 2, -d / 2 + L(170), w / 2, -d / 2 + L(170)); }
    else if (base === 'sink') { const n = Z.w > 900 ? 2 : 1; for (let i = 0; i < n; i++) { c.beginPath(); c.ellipse(-w / 2 + w * (i + 0.5) / n, L(30), w / n / 2 - L(80), d / 2 - L(110), 0, 0, Math.PI * 2); c.stroke(); } }
    else if (base === 'bath' || base === 'bathC') { rr(c, -w / 2 + L(70), -d / 2 + L(70), w - L(140), d - L(140), L(250)); c.stroke(); }
    else if (base === 'shower') { l(-w / 2, -d / 2, w / 2, d / 2); l(w / 2, -d / 2, -w / 2, d / 2); }
    else if (base === 'kitchen') { for (let x = -w / 2 + L(600); x < w / 2; x += L(600)) l(x, -d / 2, x, d / 2); c.beginPath(); c.arc(-w / 2 + L(900), 0, L(160), 0, Math.PI * 2); c.stroke(); }
    else if (base === 'table' || base === 'tableR') {
      c.fillStyle = '#d9d2c6'; const n = F.chairs || 0;
      const ch = (x, y) => { rr(c, x - L(200), y - L(200), L(400), L(400), 3); c.fill(); c.stroke(); };
      if (base === 'tableR') for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / 4, r = w / 2 + L(180); ch(Math.cos(a) * r, Math.sin(a) * r); }
      else { const per = Math.max(1, Math.floor((n - (n >= 6 ? 2 : 0)) / 2)); for (const sg of [-1, 1]) for (let i = 0; i < per; i++) ch(-w / 2 + w / per * (i + 0.5), sg * (d / 2 + L(200))); if (n >= 6) for (const sg of [-1, 1]) ch(sg * (w / 2 + L(200)), 0); }
    }
    else if (base === 'tv') { c.lineWidth = 3; c.strokeStyle = '#141518'; l(-w * 0.36, -d / 2 + L(60), w * 0.36, -d / 2 + L(60)); }
    else if (base === 'boiler' || base === 'washer') { c.beginPath(); c.arc(0, 0, Math.min(w, d) / 3, 0, Math.PI * 2); c.stroke(); }
    else if (base === 'wardrobe' || base === 'hallway') { l(-w / 2, d / 2 - L(40), w / 2, d / 2 - L(40)); l(0, -d / 2, 0, d / 2); }
    else if (base === 'shelf') { for (let x = -w / 2 + L(250); x < w / 2; x += L(250)) l(x, -d / 2, x, d / 2); }
    else if (base === 'rug') { c.setLineDash([4, 3]); rr(c, -w / 2 + L(80), -d / 2 + L(80), w - L(160), d - L(160), 2); c.stroke(); c.setLineDash([]); }
    else if (base === 'plant') { c.fillStyle = F.c; for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; c.beginPath(); c.ellipse(Math.cos(a) * w / 4, Math.sin(a) * w / 4, w / 4, w / 7, a, 0, 7); c.fill(); } }
    else if (base.startsWith('lamp')) { c.fillStyle = '#fff6dc'; c.beginPath(); c.arc(0, 0, Math.min(w, d) / 2, 0, 7); c.fill(); c.stroke(); l(-w / 2, 0, w / 2, 0); l(0, -d / 2, 0, d / 2); }
    else if (base === 'fireplace') { c.fillStyle = '#ff9b42'; c.fillRect(-w * 0.25, d / 2 - L(160), w * 0.5, L(100)); }
    else if (base === 'lounger') { l(-w / 2, -d / 2 + L(600), w / 2, -d / 2 + L(600)); }
    c.restore();
    if (sel) {
      c.save(); c.translate(X(f.x), Y(f.y)); c.rotate(ang);
      c.strokeStyle = COL.sel; c.lineWidth = 2.5; c.strokeRect(-w / 2 - 2, -d / 2 - 2, w + 4, d + 4);
      rotHandle(c, 0, -d / 2 - 22);
      // квадратик в углу — размер предмета
      c.fillStyle = '#fff'; c.lineWidth = 1.5; c.fillRect(w / 2 - 5, d / 2 - 5, 10, 10); c.strokeRect(w / 2 - 5, d / 2 - 5, 10, 10);
      c.restore();
    }
  }
  function rotHandle(c, x, y) {
    c.strokeStyle = COL.sel; c.lineWidth = 1.5; line(c, x, y + 14, x, y + 6);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); c.stroke();
    c.beginPath(); c.arc(x, y, 3.5, -2.4, 1.4); c.stroke();
  }
  function rr(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  /* лестница по маршам: ступени, площадки, стрелка подъёма */
  function drawStair(c, p, fid, X, Y, L, sel) {
    const fl = DK.floorsOf(p), bottom = fl[0] === fid, s = p.stair;
    if (fl.length < 2) return;
    const parts = DK.stairParts(s), n = Math.round(DK.storey(p) / 175), r = DK.stairRect(p);
    const W = (u, v) => { const q = DK.stairToWorld(s, u, v); return [X(q[0]), Y(q[1])]; };
    const poly = (pts) => { c.beginPath(); pts.forEach((q, i) => { const a = W(q[0], q[1]); i ? c.lineTo(a[0], a[1]) : c.moveTo(a[0], a[1]); }); c.closePath(); };
    c.fillStyle = '#f4f4f4'; c.fillRect(X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0));
    // выход наверх: красная зона, если за верхней ступенью стена
    if (!bottom && !DK.stairExitOk(p, fid)) { const z = DK.stairExit(p); c.fillStyle = 'rgba(200,60,50,.18)'; c.fillRect(X(z.x0), Y(z.y0), L(z.x1 - z.x0), L(z.y1 - z.y0)); c.strokeStyle = '#c83c32'; c.setLineDash([4, 3]); c.strokeRect(X(z.x0), Y(z.y0), L(z.x1 - z.x0), L(z.y1 - z.y0)); c.setLineDash([]); }
    c.strokeStyle = COL.stair; c.lineWidth = 0.8;
    const arrow = [];
    if (parts.spiral) {
      const S = parts.spiral, ctr = W(S.cu, S.cv);
      c.beginPath(); c.arc(ctr[0], ctr[1], L(S.r), 0, 7); c.stroke();
      c.beginPath(); c.arc(ctr[0], ctr[1], L(110), 0, 7); c.stroke();
      const k = Math.round(n * 1.05);
      for (let i = 0; i <= k; i++) { const a = -Math.PI / 2 + i / k * Math.PI * 2 * S.turn, q = [S.cu + Math.cos(a) * S.r, S.cv + Math.sin(a) * S.r];
        const e = W(q[0], q[1]); line(c, ctr[0], ctr[1], e[0], e[1]); }
      for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + i / 8 * Math.PI * 2 * S.turn; arrow.push([S.cu + Math.cos(a) * S.r * 0.65, S.cv + Math.sin(a) * S.r * 0.65]); }
    } else {
      const tot = parts.flights.reduce((a, f) => a + (f.d[0] ? f.u1 - f.u0 : f.v1 - f.v0), 0);
      parts.flights.forEach(f => {
        const len = f.d[0] ? f.u1 - f.u0 : f.v1 - f.v0, k = Math.max(2, Math.round(n * len / tot));
        poly([[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]]); c.stroke();
        for (let i = 1; i < k; i++) {
          const q = i / k;
          if (f.d[0]) { const u = f.u0 + (f.u1 - f.u0) * q; const a = W(u, f.v0), b = W(u, f.v1); line(c, a[0], a[1], b[0], b[1]); }
          else { const v = f.v0 + (f.v1 - f.v0) * q; const a = W(f.u0, v), b = W(f.u1, v); line(c, a[0], a[1], b[0], b[1]); }
        }
        const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
        const st = [f.d[0] > 0 ? f.u0 + 150 : f.d[0] < 0 ? f.u1 - 150 : cu, f.d[1] > 0 ? f.v0 + 150 : f.d[1] < 0 ? f.v1 - 150 : cv];
        const en = [f.d[0] > 0 ? f.u1 : f.d[0] < 0 ? f.u0 : cu, f.d[1] > 0 ? f.v1 : f.d[1] < 0 ? f.v0 : cv];
        if (!arrow.length) arrow.push(st);
        arrow.push(en);
      });
      parts.lands.forEach(Lnd => { poly([[Lnd.u0, Lnd.v0], [Lnd.u1, Lnd.v0], [Lnd.u1, Lnd.v1], [Lnd.u0, Lnd.v1]]); c.stroke(); });
      // стрелка через площадку: поправляем точки на середины площадок
      if (parts.lands.length && arrow.length === 3) { const Lnd = parts.lands[0]; arrow[1] = [ (Lnd.u0 + Math.min(Lnd.u1, Lnd.u0 + 1000)) / 2, (Lnd.v0 + Lnd.v1) / 2 ];
        if (s.type === 'U') arrow.splice(2, 0, [Lnd.u1 - 500, (Lnd.v0 + Lnd.v1) / 2]); }
    }
    c.strokeStyle = COL.ink; c.lineWidth = 1.2;
    c.beginPath(); arrow.forEach((q, i) => { const a = W(q[0], q[1]); i ? c.lineTo(a[0], a[1]) : c.moveTo(a[0], a[1]); }); c.stroke();
    if (arrow.length > 1) {
      const a = W(...arrow[arrow.length - 2]), b = W(...arrow[arrow.length - 1]), an = Math.atan2(b[1] - a[1], b[0] - a[0]);
      line(c, b[0], b[1], b[0] - 8 * Math.cos(an - 0.45), b[1] - 8 * Math.sin(an - 0.45)); line(c, b[0], b[1], b[0] - 8 * Math.cos(an + 0.45), b[1] - 8 * Math.sin(an + 0.45));
      const s0 = W(...arrow[0]); c.fillStyle = COL.ink; c.beginPath(); c.arc(s0[0], s0[1], 3, 0, 7); c.fill();
    }
    c.lineWidth = 1.2; c.strokeRect(X(r.x0), Y(r.y0), L(r.x1 - r.x0), L(r.y1 - r.y0));
    if (!bottom) { c.setLineDash([5, 4]); c.strokeStyle = COL.muted; line(c, X(r.x0), Y(r.y0), X(r.x1), Y(r.y1)); line(c, X(r.x1), Y(r.y0), X(r.x0), Y(r.y1)); c.setLineDash([]); }
    if (sel) { c.strokeStyle = COL.sel; c.lineWidth = 2.5; c.strokeRect(X(r.x0) - 2, Y(r.y0) - 2, L(r.x1 - r.x0) + 4, L(r.y1 - r.y0) + 4); rotHandle(c, X((r.x0 + r.x1) / 2), Y(r.y0) - 22); }
  }

  function dims(c, p, fid, ws, X, Y, L, ext, dimOpen) {
    c.strokeStyle = COL.ink; c.fillStyle = COL.ink; c.lineWidth = 0.8;
    c.font = '500 11px "JetBrains Mono", monospace';
    const hd = (x0, x1, y, label) => {
      line(c, X(x0), Y(y), X(x1), Y(y));
      for (const x of [x0, x1]) line(c, X(x) - 4, Y(y) + 4, X(x) + 4, Y(y) - 4);
      if (L(x1 - x0) > 26) { c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(label || Math.round(x1 - x0), X((x0 + x1) / 2), Y(y) - 3); }
    };
    const vd = (y0, y1, x, label) => {
      line(c, X(x), Y(y0), X(x), Y(y1));
      for (const y of [y0, y1]) line(c, X(x) - 4, Y(y) + 4, X(x) + 4, Y(y) - 4);
      if (L(y1 - y0) > 26) { c.save(); c.translate(X(x) - 3, Y((y0 + y1) / 2)); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(label || Math.round(y1 - y0), 0, 0); c.restore(); }
    };
    // общие габариты: с облицовкой и по несущему слою
    const o3 = ext + 1500, o2 = ext + 1050;
    hd(-ext, p.W + ext, -o3); vd(-ext, p.D + ext, -o3);
    hd(0, p.W, -o2); vd(0, p.D, -o2);
    // длина каждой наружной стены — снаружи у ребра
    const E = DK.edges(p), lv = p.levels[fid];
    for (const e of E) {
      const off = e.line + e.out * (ext + 450);
      if (e.axis === 'x') hd(e.lo, e.hi, off); else vd(e.lo, e.hi, off);
      if (!dimOpen) continue;
      const ops = lv.open.filter(o => o.wall === e.id).sort((a, b) => a.c - b.c);
      if (!ops.length) continue;
      const pts = [e.lo].concat(...ops.map(o => [o.c - o.w / 2, o.c + o.w / 2]), [e.hi]);
      const off2 = e.line + e.out * (ext + 800);
      for (let i = 0; i < pts.length - 1; i++) e.axis === 'x' ? hd(pts[i], pts[i + 1], off2) : vd(pts[i], pts[i + 1], off2);
    }
  }

  function render() {
    const p = app.p(); if (!p) return;
    const r = canvas.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, r.width, r.height);
    draw(ctx, view, p, app.fid(), { sel: app.sel(), dimOpen: app.opt('dimOpen'), furn: app.opt('furn') });
    if (draft) {
      const X = (x) => view.ox + x * view.k, Y = (y) => view.oy + y * view.k;
      const h = DK.SPEC.part.t / 2;
      ctx.fillStyle = 'rgba(227,162,26,.55)';
      if (draft.y1 === draft.y2) ctx.fillRect(X(Math.min(draft.x1, draft.x2)), Y(draft.y1 - h), Math.abs(draft.x2 - draft.x1) * view.k, 2 * h * view.k);
      else ctx.fillRect(X(draft.x1 - h), Y(Math.min(draft.y1, draft.y2)), 2 * h * view.k, Math.abs(draft.y2 - draft.y1) * view.k);
      const len = Math.abs(draft.x2 - draft.x1) + Math.abs(draft.y2 - draft.y1);
      ctx.font = '600 12px "JetBrains Mono", monospace'; ctx.fillStyle = COL.ink; ctx.textAlign = 'left';
      ctx.fillText(len + ' мм', X(draft.x2) + 10, Y(draft.y2) - 10);
    }
    if (drag && drag.kind === 'edge' && drag.label) {
      ctx.font = '600 12px "JetBrains Mono", monospace'; ctx.fillStyle = COL.ink; ctx.textAlign = 'left';
      ctx.fillText(drag.label, drag.sx + 14, drag.sy - 12);
    }
    if (hover && tool !== 'select') {
      ctx.strokeStyle = COL.sel; ctx.lineWidth = 1;
      const X = view.ox + hover.x * view.k, Y = view.oy + hover.y * view.k;
      line(ctx, X - 8, Y, X + 8, Y); line(ctx, X, Y - 8, X, Y + 8);
    }
  }

  /* ---------- попадания ---------- */
  function hitOpen(p, fid, x, y) {
    const ws = DK.walls(p, fid), tol = 8 / view.k, ext = DK.extT(p);
    return p.levels[fid].open.slice().reverse().find(o => {
      const w = ws.find(v => v.id === o.wall); if (!w) return false;
      const a = w.axis === 'x' ? x : y, b = w.axis === 'x' ? y : x;
      const lo = w.m - w.t / 2 - tol - (w.kind === 'outer' && w.out < 0 ? ext : 0), hi = w.m + w.t / 2 + tol + (w.kind === 'outer' && w.out > 0 ? ext : 0);
      return a > o.c - o.w / 2 - tol && a < o.c + o.w / 2 + tol && b > lo && b < hi;
    });
  }
  /* ручка поворота выбранной мебели или лестницы, в экранных координатах */
  function hitSize(p, fid, sx, sy) {
    const s = app.sel(); if (!s || s.kind !== 'furn') return null;
    const f = p.levels[fid].furn.find(q => q.id === s.id); if (!f) return null;
    const Z = DK.furnSize(f), a = DK.furnAngle(f) * Math.PI / 180, u = Z.w / 2 * view.k, v = Z.d / 2 * view.k;
    const hx = view.ox + f.x * view.k + u * Math.cos(a) - v * Math.sin(a), hy = view.oy + f.y * view.k + u * Math.sin(a) + v * Math.cos(a);
    return Math.hypot(sx - hx, sy - hy) < 9 ? f : null;
  }
  function hitRot(p, fid, sx, sy) {
    const s = app.sel(); if (!s) return null;
    if (s.kind === 'furn') {
      const f = p.levels[fid].furn.find(q => q.id === s.id); if (!f) return null;
      const a = DK.furnAngle(f) * Math.PI / 180, r = DK.furnSize(f).d * view.k / 2 + 22;
      const hx = view.ox + f.x * view.k + Math.sin(a) * r, hy = view.oy + f.y * view.k - Math.cos(a) * r;
      return Math.hypot(sx - hx, sy - hy) < 10 ? { f } : null;
    }
    if (s.kind === 'stair' && p.stair) {
      const r = DK.stairRect(p), hx = view.ox + (r.x0 + r.x1) / 2 * view.k, hy = view.oy + r.y0 * view.k - 22;
      return Math.hypot(sx - hx, sy - hy) < 10 ? { stair: true } : null;
    }
    return null;
  }
  function hitExt(p, fid, x, y) {
    return extsOn(p, fid).slice().reverse().find(q => { const r = DK.extRect(p, q); return r && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1; });
  }
  function hitExtHandle(p, fid, x, y) {
    const s = app.sel(); if (!s || s.kind !== 'ext') return null;
    const q = (p.ext || []).find(v => v.id === s.id); if (!q) return null;
    const tol = 9 / view.k, h = extHandles(p, q).find(v => Math.abs(v.x - x) < tol && Math.abs(v.y - y) < tol);
    return h ? { x: q, k: h.k } : null;
  }
  function hitOpenEnd(p, fid, x, y) {
    const s = app.sel(); if (!s || s.kind !== 'open') return null;
    const o = p.levels[fid].open.find(q => q.id === s.id); if (!o) return null;
    const w = DK.walls(p, fid).find(v => v.id === o.wall); if (!w) return null;
    const tol = 9 / view.k;
    for (const side of [-1, 1]) {
      const a = o.c + side * o.w / 2, px = w.axis === 'x' ? a : w.m, py = w.axis === 'x' ? w.m : a;
      if (Math.abs(px - x) < tol && Math.abs(py - y) < tol) return { o, w, side };
    }
    return null;
  }
  function hitFurn(p, fid, x, y) {
    return p.levels[fid].furn.slice().reverse().find(f => DK.furnHit(f, x, y));
  }
  function hitWall(p, fid, x, y, kinds) {
    const tol = 8 / view.k, ext = DK.extT(p);
    const rank = { part: 0, bearing: 1, outer: 2 };
    return DK.walls(p, fid).filter(w => !kinds || kinds.includes(w.kind)).sort((a, b) => rank[a.kind] - rank[b.kind]).find(w => {
      let x0 = w.x0 - tol, x1 = w.x1 + tol, y0 = w.y0 - tol, y1 = w.y1 + tol;
      if (w.kind === 'outer') {
        if (w.axis === 'x') { if (w.out < 0) y0 -= ext; else y1 += ext; x0 = w.edge.lo; x1 = w.edge.hi; }
        else { if (w.out < 0) x0 -= ext; else x1 += ext; y0 = w.edge.lo; y1 = w.edge.hi; }
      }
      return x > x0 && x < x1 && y > y0 && y < y1;
    });
  }
  function hitStair(p, x, y) { const r = DK.stairRect(p); return r && DK.floorsOf(p).length > 1 && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1; }
  function hitPartEnd(p, fid, x, y) {
    const tol = 10 / view.k;
    for (const q of p.levels[fid].parts) for (const k of ['1', '2']) if (Math.hypot(q['x' + k] - x, q['y' + k] - y) < tol) return { q, k };
    return null;
  }

  function snapPt(p, fid, x, y, axisLock) {
    const ws = DK.walls(p, fid), tol = 10 / view.k, t = DK.ts(p);
    let sx = snap(x), sy = snap(y), bx = tol, by = tol;
    for (const w of ws) {
      if (axisLock !== 'x') for (const fx of [w.x0, w.x1, w.axis === 'y' ? w.m : null]) if (fx != null && Math.abs(fx - x) < bx && y > w.y0 - tol && y < w.y1 + tol) { bx = Math.abs(fx - x); sx = fx; }
      if (axisLock !== 'y') for (const fy of [w.y0, w.y1, w.axis === 'x' ? w.m : null]) if (fy != null && Math.abs(fy - y) < by && x > w.x0 - tol && x < w.x1 + tol) { by = Math.abs(fy - y); sy = fy; }
    }
    return { x: Math.max(t, Math.min(sx, p.W - t)), y: Math.max(t, Math.min(sy, p.D - t)) };
  }

  /* ---------- мышь ---------- */
  function pos(e) { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 2) { const [a, b] = Array.from(pointers.values()); pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), k: view.k, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 }; drag = null; draft = null; return; }
    const { sx, sy } = pos(e), w = toW(sx, sy), p = app.p(), fid = app.fid();
    if (e.button === 1 || e.button === 2 || e.shiftKey) { drag = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy, moved: true }; return; }
    if (tool === 'wall') { const s = snapPt(p, fid, w.x, w.y); draft = { x1: s.x, y1: s.y, x2: s.x, y2: s.y }; drag = { kind: 'draft' }; render(); return; }
    if (tool === 'win' || tool === 'door' || tool === 'pass') { placeOpening(p, fid, w.x, w.y); return; }
    if (tool === 'furn') { placeFurn(p, fid, w.x, w.y); return; }
    if (tool === 'bump') { placeBump(p, fid, w.x, w.y); return; }
    if (tool === 'terrace' || tool === 'porch' || tool === 'balcony') { placeExt(p, fid, w.x, w.y); return; }
    if (tool === 'wet' && p.wet) {
      const z = p.wet, tol = 10 / view.k;
      const ed = { l: Math.abs(w.x - z.x) < tol, r: Math.abs(w.x - z.x - z.w) < tol, t: Math.abs(w.y - z.y) < tol, b: Math.abs(w.y - z.y - z.h) < tol };
      const insideZ = w.x > z.x - tol && w.x < z.x + z.w + tol && w.y > z.y - tol && w.y < z.y + z.h + tol;
      if (insideZ) { drag = { kind: 'wet', ed: (ed.l || ed.r || ed.t || ed.b) ? ed : null, w0: w, z0: Object.assign({}, z) }; return; }
    }
    if (tool === 'erase') { erase(p, fid, w.x, w.y); return; }
    const xh = hitExtHandle(p, fid, w.x, w.y);
    if (xh) { drag = { kind: 'xh', x: xh.x, k: xh.k }; return; }
    const rh = hitRot(p, fid, sx, sy);
    if (rh) { drag = { kind: 'frot', t: rh }; return; }
    const hs = hitSize(p, fid, sx, sy);
    if (hs) { const Z = DK.furnSize(hs), a = DK.furnAngle(hs) * Math.PI / 180, u = -Z.w / 2, v = -Z.d / 2;
      drag = { kind: 'fsize', f: hs, fx: hs.x + u * Math.cos(a) - v * Math.sin(a), fy: hs.y + u * Math.sin(a) + v * Math.cos(a) }; return; }
    const he2 = hitOpenEnd(p, fid, w.x, w.y);
    if (he2) { drag = { kind: 'oend', o: he2.o, side: he2.side, wl: he2.w }; return; }
    const o = hitOpen(p, fid, w.x, w.y);
    if (o) { app.select({ kind: 'open', id: o.id }); drag = { kind: 'open', o, w0: w, c0: o.c }; return; }
    const f = app.opt('furn') !== false && hitFurn(p, fid, w.x, w.y);
    if (f) { app.select({ kind: 'furn', id: f.id }); drag = { kind: 'furn', f, w0: w, x0: f.x, y0: f.y }; return; }
    const pe = hitPartEnd(p, fid, w.x, w.y);
    if (pe) { app.select({ kind: 'part', id: pe.q.id }); drag = { kind: 'pend', pe, ax: pe.q.y1 === pe.q.y2 ? 'x' : 'y' }; return; }
    const pw = hitWall(p, fid, w.x, w.y, ['part']);
    if (pw) { const part = p.levels[fid].parts.find(q => q.id === pw.id); app.select({ kind: 'part', id: pw.id }); drag = { kind: 'part', part, w0: w, s: Object.assign({}, part), ax: pw.axis }; return; }
    if (hitWall(p, fid, w.x, w.y, ['bearing'])) { app.select({ kind: 'bearing' }); drag = { kind: 'none' }; return; }
    const xx = hitExt(p, fid, w.x, w.y);
    if (xx) { app.select({ kind: 'ext', id: xx.id }); drag = { kind: 'xm', x: xx, w0: w, c0: xx.c }; return; }
    if (hitStair(p, w.x, w.y)) { app.select({ kind: 'stair' }); drag = { kind: 'stair', w0: w, x0: p.stair.x, y0: p.stair.y }; return; }
    const ow = hitWall(p, fid, w.x, w.y, ['outer']);
    if (ow) { app.select({ kind: 'edge', id: ow.id }); drag = { kind: 'edge', id: ow.id, axis: ow.axis, w0: w, snap: JSON.stringify(p), ox: view.ox, oy: view.oy, sx, sy }; return; }
    drag = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy, click: w };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pos(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = Array.from(pointers.values()), d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      zoomAt(pinch.mx, pinch.my, pinch.k * d / pinch.d / view.k); return;
    }
    const { sx, sy } = pos(e), w = toW(sx, sy), p = app.p(), fid = app.fid();
    hover = tool !== 'select' ? snapPt(p, fid, w.x, w.y) : null;
    if (!drag) {
      const he = (tool === 'select' || tool === 'bump') && !hitOpen(p, fid, w.x, w.y) ? hitWall(p, fid, w.x, w.y, ['outer']) : null;
      const nh = he ? he.id : null;
      if (nh !== hoverEdge || hover) { hoverEdge = nh; render(); }
      const oe = tool === 'select' && hitOpenEnd(p, fid, w.x, w.y);
      if (oe) { canvas.style.cursor = oe.w.axis === 'x' ? 'ew-resize' : 'ns-resize'; return; }
      canvas.style.cursor = tool === 'select' ? (hitOpen(p, fid, w.x, w.y) || hitFurn(p, fid, w.x, w.y) ? 'move' : he ? (he.axis === 'x' ? 'ns-resize' : 'ew-resize') : hitPartEnd(p, fid, w.x, w.y) ? 'crosshair' : 'default') : 'crosshair';
      return;
    }
    if (drag.kind === 'pan') {
      if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) < 4) return;
      drag.moved = true; view.ox = drag.ox + sx - drag.sx; view.oy = drag.oy + sy - drag.sy; render(); return;
    }
    if (drag.kind === 'draft') {
      const dx = Math.abs(w.x - draft.x1), dy = Math.abs(w.y - draft.y1);
      if (dx >= dy) { const s = snapPt(p, fid, w.x, draft.y1, 'y'); draft.x2 = s.x; draft.y2 = draft.y1; }
      else { const s = snapPt(p, fid, draft.x1, w.y, 'x'); draft.y2 = s.y; draft.x2 = draft.x1; }
      render(); return;
    }
    drag.moved = true;
    if (drag.kind === 'xm') {
      const e = DK.extRect(p, drag.x).e, d = e.axis === 'x' ? w.x - drag.w0.x : w.y - drag.w0.y;
      drag.x.c = Math.max(e.lo + drag.x.w / 2, Math.min(snap(drag.c0 + d, 100), e.hi - drag.x.w / 2));
    } else if (drag.kind === 'xh') {
      const x = drag.x, r = DK.extRect(p, x), e = r.e, a = e.axis === 'x' ? w.x : w.y, t = e.axis === 'x' ? w.y : w.x;
      if (drag.k === 'd') x.d = Math.max(800, Math.min(snap(Math.abs(t - r.face), 100), x.kind === 'balcony' ? 3000 : 8000));
      else {
        const fixed = drag.k === 'w0' ? x.c + x.w / 2 : x.c - x.w / 2;
        let lo = drag.k === 'w0' ? Math.max(e.lo, snap(a, 100)) : fixed, hi = drag.k === 'w0' ? fixed : Math.min(e.hi, snap(a, 100));
        if (hi - lo >= 1000) { x.w = hi - lo; x.c = (lo + hi) / 2; }
      }
    } else if (drag.kind === 'fsize') {
      // тянется угол, противоположный стоит на месте
      const f = drag.f, F = DK.FURN[f.type], A = DK.furnAngle(f) * Math.PI / 180, dx = w.x - drag.fx, dy = w.y - drag.fy;
      const u = dx * Math.cos(-A) - dy * Math.sin(-A), v = dx * Math.sin(-A) + dy * Math.cos(-A);
      for (const [k, val] of [['w', u], ['d', v]]) { const nv = DK.furnClamp(F[k], Math.round(val / 50) * 50); if (nv === F[k]) delete f[k]; else f[k] = nv; }
      const Z = DK.furnSize(f);
      f.x = Math.round(drag.fx + Z.w / 2 * Math.cos(A) - Z.d / 2 * Math.sin(A)); f.y = Math.round(drag.fy + Z.w / 2 * Math.sin(A) + Z.d / 2 * Math.cos(A));
    } else if (drag.kind === 'frot') {
      if (drag.t.f) {
        const f = drag.t.f, deg = Math.atan2(w.x - f.x, -(w.y - f.y)) * 180 / Math.PI;
        f.a = ((Math.round(deg / (e.altKey ? 1 : 15)) * (e.altKey ? 1 : 15)) % 360 + 360) % 360; delete f.rot;
      } else {
        const r = DK.stairRect(p), deg = Math.atan2(w.x - (r.x0 + r.x1) / 2, -(w.y - (r.y0 + r.y1) / 2)) * 180 / Math.PI;
        if (drag.d0 == null) { drag.d0 = deg; drag.r0 = p.stair.rot; }
        const rot = ((drag.r0 + Math.round((deg - drag.d0) / 90)) % 4 + 4) % 4;
        if (rot !== p.stair.rot) { const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2; p.stair.rot = rot; const r2 = DK.stairRect(p); p.stair.x += Math.round(cx - (r2.x0 + r2.x1) / 2); p.stair.y += Math.round(cy - (r2.y0 + r2.y1) / 2); }
      }
    } else if (drag.kind === 'oend') {
      const o = drag.o, wl = drag.wl, lim = DK.opLimits(p, wl, o), a = wl.axis === 'x' ? w.x : w.y;
      const fixed = drag.side < 0 ? o.c + o.w / 2 : o.c - o.w / 2;
      let nw = snap(Math.abs(fixed - a), 50);
      nw = Math.max(lim.min, Math.min(nw, lim.max));
      let c = drag.side < 0 ? fixed - nw / 2 : fixed + nw / 2;
      if (c - nw / 2 < wl.a0 || c + nw / 2 > wl.a1) return;
      o.w = nw; o.c = c;
    } else if (drag.kind === 'open') {
      const ws = DK.walls(p, fid), wl = ws.find(v => v.id === drag.o.wall);
      const d = wl.axis === 'x' ? w.x - drag.w0.x : w.y - drag.w0.y;
      drag.o.c = Math.max(wl.a0 + drag.o.w / 2, Math.min(snap(drag.c0 + d), wl.a1 - drag.o.w / 2));
    } else if (drag.kind === 'furn') {
      drag.f.x = snap(drag.x0 + w.x - drag.w0.x); drag.f.y = snap(drag.y0 + w.y - drag.w0.y);
    } else if (drag.kind === 'part') {
      const t = DK.ts(p), q = drag.part, s = drag.s;
      if (drag.ax === 'x') { const ny = Math.max(t + 60, Math.min(snap(s.y1 + w.y - drag.w0.y, 10), p.D - t - 60)); q.y1 = q.y2 = ny; }
      else { const nx = Math.max(t + 60, Math.min(snap(s.x1 + w.x - drag.w0.x, 10), p.W - t - 60)); q.x1 = q.x2 = nx; }
    } else if (drag.kind === 'pend') {
      const q = drag.pe.q, k = drag.pe.k, sp = snapPt(p, fid, w.x, w.y, drag.ax === 'x' ? 'y' : 'x');
      if (drag.ax === 'x') q['x' + k] = sp.x; else q['y' + k] = sp.y;
    } else if (drag.kind === 'stair') {
      p.stair.x = snap(drag.x0 + w.x - drag.w0.x); p.stair.y = snap(drag.y0 + w.y - drag.w0.y); DK.normalize(p);
    } else if (drag.kind === 'edge') {
      const d = snap(drag.axis === 'x' ? w.y - drag.w0.y : w.x - drag.w0.x, 100);
      Object.assign(p, JSON.parse(drag.snap));
      const ok = DK.moveEdge(p, drag.id, d);
      const mx = Math.min(...p.poly.map(v => v.x)), my = Math.min(...p.poly.map(v => v.y));
      DK.normalize(p);
      view.ox = drag.ox + mx * view.k; view.oy = drag.oy + my * view.k;
      const e = DK.edges(p).find(x => x.id === drag.id);
      drag.label = ok ? (d > 0 ? '+' : '') + d + ' мм' + (e ? ' · стена ' + (e.hi - e.lo) : '') : 'так нельзя';
      drag.sx = sx; drag.sy = sy;
    } else if (drag.kind === 'wet') {
      const z = p.wet, z0 = drag.z0, dx = snap(w.x - drag.w0.x), dy = snap(w.y - drag.w0.y), ed = drag.ed;
      if (!ed) { z.x = z0.x + dx; z.y = z0.y + dy; }
      else {
        if (ed.l) { z.x = Math.min(z0.x + dx, z0.x + z0.w - 1000); z.w = z0.w - (z.x - z0.x); }
        if (ed.r) z.w = Math.max(1000, z0.w + dx);
        if (ed.t) { z.y = Math.min(z0.y + dy, z0.y + z0.h - 1000); z.h = z0.h - (z.y - z0.y); }
        if (ed.b) z.h = Math.max(1000, z0.h + dy);
      }
      DK.normalize(p);
    }
    app.live(); render();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const p = app.p(), fid = app.fid();
    if (!drag) return;
    if (drag.kind === 'draft' && draft) {
      const len = Math.abs(draft.x2 - draft.x1) + Math.abs(draft.y2 - draft.y1);
      if (len >= 300) {
        const q = { id: DK.id('w'), x1: Math.min(draft.x1, draft.x2), y1: Math.min(draft.y1, draft.y2), x2: Math.max(draft.x1, draft.x2), y2: Math.max(draft.y1, draft.y2) };
        p.levels[fid].parts.push(q); app.commit('Перегородка ' + len + ' мм'); app.select({ kind: 'part', id: q.id });
      }
      draft = null; drag = null; render(); return;
    }
    if (drag.kind === 'pan' && !drag.moved && drag.click) {
      const r = DK.rooms(p, fid).at(drag.click.x, drag.click.y);
      app.select(r ? { kind: 'room', x: drag.click.x, y: drag.click.y } : null);
      if (r && tool === 'select') app.roomPop(drag.sx, drag.sy);
    } else if (drag.moved && drag.kind !== 'pan') app.commit();
    drag = null; render();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (hoverEdge && !drag) { hoverEdge = null; render(); } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const { sx, sy } = pos(e); zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(sx, sy, f) {
    const k2 = Math.max(0.008, Math.min(0.6, view.k * f)), w = toW(sx, sy);
    view.k = k2; view.ox = sx - w.x * k2; view.oy = sy - w.y * k2; render();
  }

  function placeOpening(p, fid, x, y) {
    const w = hitWall(p, fid, x, y, tool === 'win' ? ['outer'] : tool === 'pass' ? ['part', 'bearing'] : null);
    if (!w) { app.toast(tool === 'win' ? 'Окно ставится на наружную стену' : tool === 'pass' ? 'Проём без двери — во внутренней стене' : 'Нажмите на стену'); return; }
    if (w.rail) { app.toast('В ограждении проём не нужен'); return; }
    const kind = tool === 'win' ? 'win' : tool === 'pass' ? 'pass' : (w.kind === 'outer' ? 'entry' : 'door');
    const width = kind === 'win' ? 1500 : kind === 'entry' ? 1000 : kind === 'pass' ? 1200 : 800;
    if (w.a1 - w.a0 < width + 100) { app.toast('Стена короче проёма'); return; }
    const c = Math.max(w.a0 + width / 2 + 50, Math.min(snap(w.axis === 'x' ? x : y), w.a1 - width / 2 - 50));
    const o = { id: DK.id('o'), wall: w.id, c, w: width, kind };
    if (kind === 'win') o.sash = 2;
    if (kind === 'win' && fid === 'b') { o.sill = 1500; o.h = 900; }
    p.levels[fid].open.push(o);
    app.commit(kind === 'win' ? 'Окно' : kind === 'pass' ? 'Проём' : 'Дверь'); app.select({ kind: 'open', id: o.id });
    if (kind === 'pass' && w.kind === 'bearing') app.toast('Проём в несущей стене — в ТЗ добавлена перемычка');
    app.setTool('select');
  }
  function placeExt(p, fid, x, y) {
    const k = tool, w = hitWall(p, fid, x, y, ['outer']);
    if (!w) { app.toast('Нажмите на наружную стену'); return; }
    if (k === 'balcony' && (fid === 'f1' || fid === 'b')) { app.toast('Балкон — со второго этажа и выше. На первом этаже — терраса'); return; }
    if (k !== 'balcony' && fid !== 'f1') { app.toast('Терраса и крыльцо — на плане 1 этажа'); return; }
    const D = DK.EXT[k], e = w.edge;
    let c = snap(w.axis === 'x' ? x : y, 100), wd = D.w;
    const win = p.levels[fid].open.find(o => o.wall === w.id && (o.pano || o.kind !== 'win') && Math.abs(o.c - c) < 3000);
    if (win) { c = win.c; wd = Math.max(D.w, win.w + (k === 'porch' ? 1200 : 2000)); }
    wd = Math.min(wd, e.hi - e.lo);
    const q = { id: DK.id('x'), kind: k, wall: w.id, c: Math.max(e.lo + wd / 2, Math.min(c, e.hi - wd / 2)), w: wd, d: D.d, roof: k === 'terrace' ? 'open' : k === 'porch' ? 'covered' : undefined };
    if (k === 'balcony') q.fid = fid;
    p.ext = (p.ext || []).concat(q);
    app.commit(D.n); app.select({ kind: 'ext', id: q.id }); app.setTool('select');
    if (!DK.extExit(p, q) && k !== 'porch') app.toast(`${D.n}: поставьте дверь или панорамное окно для выхода`);
  }
  function placeFurn(p, fid, x, y) {
    const f = { id: DK.id('f'), type: toolArg, x: snap(x), y: snap(y), rot: 0 };
    if (DK.FURN[toolArg].noUpper) f.upper = false;
    p.levels[fid].furn.push(f); app.commit(DK.FURN[toolArg].n); app.select({ kind: 'furn', id: f.id }); app.setTool('select');
  }
  function placeBump(p, fid, x, y) {
    const w = hitWall(p, fid, x, y, ['outer']);
    if (!w) { app.toast('Нажмите на наружную стену'); return; }
    const snapS = JSON.stringify(p);
    const ok = DK.addBump(p, w.id, snap(w.axis === 'x' ? x : y, 100), 3000, 1200);
    if (!ok) { Object.assign(p, JSON.parse(snapS)); app.toast('Здесь выступ не помещается'); return; }
    const mx = Math.min(...p.poly.map(v => v.x)), my = Math.min(...p.poly.map(v => v.y));
    app.commit('Выступ');
    view.ox += mx * view.k; view.oy += my * view.k;
    app.setTool('select'); render();
  }
  function erase(p, fid, x, y) {
    const lv = p.levels[fid];
    const o = hitOpen(p, fid, x, y); if (o) { lv.open = lv.open.filter(q => q !== o); app.commit('Удалён проём'); return; }
    const xx = hitExt(p, fid, x, y); if (xx) { p.ext = p.ext.filter(q => q !== xx); app.commit('Удалено'); return; }
    const f = hitFurn(p, fid, x, y); if (f) { lv.furn = lv.furn.filter(q => q !== f); app.commit('Удалена мебель'); return; }
    const w = hitWall(p, fid, x, y, ['part']); if (w) { lv.parts = lv.parts.filter(q => q.id !== w.id); lv.open = lv.open.filter(q => q.wall !== w.id); app.commit('Удалена перегородка'); }
  }

  function toImage(fid, opt) {
    opt = opt || {};
    const p = app.p(), b = bounds(p), px = opt.width || 1800;
    const k = px / (b.x1 - b.x0), hpx = Math.round((b.y1 - b.y0) * k) + 60;
    const cv = document.createElement('canvas'); cv.width = px; cv.height = hpx;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, px, hpx);
    c.fillStyle = COL.ink; c.font = '700 22px Raleway, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    const A = DK.rooms(p, fid).filter(r => r.type !== 'void').reduce((s, r) => s + r.area, 0);
    if (!opt.noTitle) c.fillText(DK.floorName(fid) + ' · ' + DK.fmtA(A) + ' м²', 24, 18);
    draw(c, { k, ox: -b.x0 * k, oy: -b.y0 * k + 50 }, p, fid, { clean: true, dimOpen: true, numbers: opt.numbers });
    return cv.toDataURL('image/png');
  }

  window.addEventListener('resize', () => { size(); fit(); });
  return {
    size, fit, render, toImage, view,
    setTool(t, arg) { tool = t; toolArg = arg || null; draft = null; render(); },
    tool: () => tool,
  };
}
DK.Plan2D = Plan2D;
})();
