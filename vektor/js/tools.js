// Инструменты панели слева. Каждый: down/move/up/dbl/key/overlay/activate.
'use strict';

const HANDLE = 8; // размер маркера, px

// сохранить исходники выделения перед перетаскиванием и восстанавливать на каждом шаге
const Drag = {
  orig: null,
  begin(ids = App.sel) {
    Drag.orig = ids.map(id => structuredClone(Model.get(id)));
  },
  reset() {
    if (!Drag.orig) return [];
    return Drag.orig.map(src => {
      const f = Model.find(src.id);
      const c = structuredClone(src);
      f.list[f.list.indexOf(f.obj)] = c;
      return c;
    });
  },
  end() { Drag.orig = null; },
};

const Tools = {};

// ======================= Указатель =======================
Tools.pick = {
  cursor: 'default',
  pickContainer: null,
  // маркеры текущего выделения в экранных координатах
  handles() {
    const b = Model.selBox();
    if (!b) return [];
    const p1 = App.toScreen(b.x1, b.y1), p2 = App.toScreen(b.x2, b.y2);
    const pad = 6;
    const x1 = p1.x - pad, y1 = p1.y - pad, x2 = p2.x + pad, y2 = p2.y + pad, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    if (!App.rotateMode) {
      return [
        { k: 'nw', x: x1, y: y1 }, { k: 'n', x: mx, y: y1 }, { k: 'ne', x: x2, y: y1 }, { k: 'e', x: x2, y: my },
        { k: 'se', x: x2, y: y2 }, { k: 's', x: mx, y: y2 }, { k: 'sw', x: x1, y: y2 }, { k: 'w', x: x1, y: my },
      ];
    }
    const c = App.rotCenter || { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    const cs = App.toScreen(c.x, c.y);
    return [
      { k: 'r-nw', x: x1, y: y1 }, { k: 'r-ne', x: x2, y: y1 }, { k: 'r-se', x: x2, y: y2 }, { k: 'r-sw', x: x1, y: y2 },
      { k: 'k-n', x: mx, y: y1 }, { k: 'k-s', x: mx, y: y2 }, { k: 'k-e', x: x2, y: my }, { k: 'k-w', x: x1, y: my },
      { k: 'center', x: cs.x, y: cs.y },
    ];
  },
  handleAt(e) {
    const r = App.stageRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (const h of Tools.pick.handles()) if (Math.abs(h.x - x) <= HANDLE && Math.abs(h.y - y) <= HANDLE) return h;
    return null;
  },
  guideAt(e) {
    const r = App.stageRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const g = App.doc.guides;
    for (let i = 0; i < g.v.length; i++) if (Math.abs(App.toScreen(g.v[i], 0).x - sx) < 4) return { dir: 'v', i };
    for (let i = 0; i < g.h.length; i++) if (Math.abs(App.toScreen(0, g.h[i]).y - sy) < 4) return { dir: 'h', i };
    return null;
  },
  down(e, p) {
    const T = Tools.pick;
    T.st = null;
    if (T.pickContainer) { Actions.powerclipFinish(App.hitTest(e.clientX, e.clientY)); return; }
    const h = App.sel.length ? T.handleAt(e) : null;
    const b = Model.selBox();
    if (h) {
      Drag.begin();
      T.st = { mode: 'handle', h, start: p, box: b, center: App.rotCenter || { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } };
      return;
    }
    const gd = App.view.snapGuides !== null && T.guideAt(e);
    const id = App.hitTest(e.clientX, e.clientY, e.ctrlKey);
    if (gd && !id) { T.st = { mode: 'guide', g: gd }; return; }
    if (id) {
      const top = e.ctrlKey ? id : App.topIdOf(id);
      const already = App.sel.includes(top);
      if (e.shiftKey) {
        if (already) App.sel = App.sel.filter(x => x !== top); else App.sel.push(top);
        App.rotateMode = false; UI.refresh();
        if (!App.sel.includes(top)) return;
      } else if (!already) { App.sel = [top]; App.rotateMode = false; App.rotCenter = null; UI.refresh(); }
      T.st = { mode: 'maybeMove', start: p, sx: e.clientX, sy: e.clientY, toggleRotate: already && !e.shiftKey, alt: e.altKey };
      return;
    }
    if (!e.shiftKey) { App.sel = []; App.rotateMode = false; }
    T.st = { mode: 'marquee', start: p, cur: p, add: e.shiftKey, touch: e.altKey };
    UI.refresh();
  },
  move(e, p, dragging) {
    const T = Tools.pick, st = T.st;
    if (!dragging || !st) {
      const st2 = UI.$('#stage');
      const h = App.sel.length && T.handleAt(e);
      let cur = '';
      if (T.pickContainer) cur = 'crosshair';
      else if (h) cur = h.k === 'center' ? 'move' : h.k.startsWith('r-') ? 'alias' : h.k.startsWith('k-') ? (h.k === 'k-n' || h.k === 'k-s' ? 'ew-resize' : 'ns-resize')
        : { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[h.k];
      else if (T.guideAt(e)) cur = T.guideAt(e).dir === 'v' ? 'col-resize' : 'row-resize';
      else if (App.hitTest(e.clientX, e.clientY)) cur = 'move';
      st2.style.cursor = cur;
      return;
    }
    if (st.mode === 'maybeMove') {
      if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) < 3) return;
      if (st.alt) {
        // Alt+перетаскивание — оставить копию на месте
        const copies = App.selObjs().map(o => Model.clone(o));
        Actions.placeAfter(copies);
      }
      st.mode = 'move'; Drag.begin(); st.box = Model.selBox();
    }
    if (st.mode === 'move') {
      Drag.reset();
      let dx = p.x - st.start.x, dy = p.y - st.start.y;
      if (e.ctrlKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const b = st.box;
      const s = App.snapBox({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy }, App.sel);
      dx += e.ctrlKey && !dx ? 0 : s.dx; dy += e.ctrlKey && !dy ? 0 : s.dy;
      App.selObjs().forEach(o => Model.applyT(o, Mx.translate(dx, dy)));
      if (App.rotCenter && st.rc0 === undefined) st.rc0 = { ...App.rotCenter };
      if (st.rc0) App.rotCenter = { x: st.rc0.x + dx, y: st.rc0.y + dy };
      UI.status(`Смещение: ${dx.toFixed(2)} × ${dy.toFixed(2)} мм`);
      UI.refresh({ panels: false });
    } else if (st.mode === 'handle') T.dragHandle(e, p);
    else if (st.mode === 'marquee') { st.cur = p; UI.refresh({ panels: false }); }
    else if (st.mode === 'guide') {
      const g = App.doc.guides;
      if (st.g.dir === 'v') g.v[st.g.i] = p.x; else g.h[st.g.i] = p.y;
      UI.refresh({ panels: false });
    }
  },
  dragHandle(e, p) {
    const st = Tools.pick.st, { h, box: b } = st;
    const objs = Drag.reset();
    let T = null;
    const W = b.x2 - b.x1 || 1e-6, H = b.y2 - b.y1 || 1e-6;
    if (h.k === 'center') {
      App.rotCenter = App.snapPoint(p);
      UI.refresh({ panels: false }); return;
    }
    if (h.k.startsWith('r-')) {
      const c = st.center;
      let a = (Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(st.start.y - c.y, st.start.x - c.x)) * 180 / Math.PI;
      if (e.ctrlKey) a = Math.round(a / 15) * 15;
      T = Mx.rotate(a, c.x, c.y);
      UI.status(`Поворот: ${(-a).toFixed(1)}°`);
    } else if (h.k.startsWith('k-')) {
      if (h.k === 'k-n' || h.k === 'k-s') {
        const ay = h.k === 'k-n' ? b.y2 : b.y1, hy = h.k === 'k-n' ? b.y1 : b.y2;
        let ang = Math.atan2(p.x - st.start.x, hy - ay) * 180 / Math.PI;
        if (e.ctrlKey) ang = Math.round(ang / 15) * 15;
        T = Mx.skew(ang, 0, 0, ay);
        UI.status(`Наклон по горизонтали: ${ang.toFixed(1)}°`);
      } else {
        const ax = h.k === 'k-w' ? b.x2 : b.x1, hx = h.k === 'k-w' ? b.x1 : b.x2;
        let ang = Math.atan2(p.y - st.start.y, hx - ax) * 180 / Math.PI;
        if (e.ctrlKey) ang = Math.round(ang / 15) * 15;
        T = Mx.skew(0, ang, ax, 0);
        UI.status(`Наклон по вертикали: ${ang.toFixed(1)}°`);
      }
    } else {
      // масштаб: угол — пропорционально (Alt — свободно), сторона — растяжение; Shift — от центра
      const k = h.k;
      const fromC = e.shiftKey;
      const ax = fromC ? (b.x1 + b.x2) / 2 : k.includes('w') ? b.x2 : b.x1;
      const ay = fromC ? (b.y1 + b.y2) / 2 : k.includes('n') ? b.y2 : b.y1;
      const hx = k.includes('w') ? b.x1 : b.x2, hy = k.includes('n') ? b.y1 : b.y2;
      const sp = App.snapPoint(p, App.sel);
      let sx = k.includes('e') || k.includes('w') ? (sp.x - ax) / (hx - ax) : 1;
      let sy = k.includes('n') || k.includes('s') ? (sp.y - ay) / (hy - ay) : 1;
      if (k.length === 2 && !e.altKey) { const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = sy = s; }
      if (e.ctrlKey) { sx = Math.round(sx); sy = Math.round(sy); if (!sx) sx = 1; if (!sy) sy = 1; }
      if (Math.abs(sx) < 1e-4) sx = 1e-4; if (Math.abs(sy) < 1e-4) sy = 1e-4;
      T = Mx.scale(sx, sy, ax, ay);
      UI.status(`Масштаб: ${(sx * 100).toFixed(1)}% × ${(sy * 100).toFixed(1)}%   (${Math.abs(W * sx).toFixed(2)} × ${Math.abs(H * sy).toFixed(2)} мм)`);
    }
    objs.forEach(o => Model.applyT(o, T));
    UI.refresh({ panels: false });
  },
  up(e, p) {
    const T = Tools.pick, st = T.st;
    T.st = null; App.snapLines = [];
    if (!st) return;
    if (st.mode === 'maybeMove') {
      if (st.toggleRotate) { App.rotateMode = !App.rotateMode; if (!App.rotateMode) App.rotCenter = null; }
      UI.refresh();
    } else if (st.mode === 'move' || st.mode === 'handle') {
      Drag.end();
      if (st.mode === 'handle' && st.h.k === 'center') { UI.refresh(); return; }
      App.commit('Преобразование');
    } else if (st.mode === 'marquee') {
      const r = { x1: Math.min(st.start.x, p.x), y1: Math.min(st.start.y, p.y), x2: Math.max(st.start.x, p.x), y2: Math.max(st.start.y, p.y) };
      if (r.x2 - r.x1 > 0.01 || r.y2 - r.y1 > 0.01) {
        const ids = st.add ? App.sel.slice() : [];
        for (const { o, L } of Model.topLevel()) {
          if (!L.visible || L.locked || !o.visible || o.locked) continue;
          const b = Model.worldBox(o);
          if (!G.boxValid(b)) continue;
          if ((st.touch ? G.boxTouch(b, r) : G.boxInside(b, r)) && !ids.includes(o.id)) ids.push(o.id);
        }
        App.sel = ids;
      }
      UI.refresh();
    } else if (st.mode === 'guide') {
      // направляющая, утащенная за пределы холста, удаляется
      const r = App.stageRect();
      const out = e.clientX < r.left || e.clientY < r.top || e.clientX > r.right || e.clientY > r.bottom;
      if (out) App.doc.guides[st.g.dir].splice(st.g.i, 1);
      App.commit('Направляющая');
    }
  },
  dbl(e, p) {
    const id = App.hitTest(e.clientX, e.clientY, e.ctrlKey);
    if (!id) return;
    const o = Model.get(id);
    if (o.type === 'text') { App.sel = [App.topIdOf(id) === id ? id : App.topIdOf(id)]; Tools.text.edit(o); }
    else if (['path', 'rect', 'ellipse', 'polygon'].includes(o.type) && App.topIdOf(id) === id) { App.sel = [id]; App.setTool('shape'); }
  },
  context(e, p) {
    const id = App.hitTest(e.clientX, e.clientY);
    if (id && !App.sel.includes(App.topIdOf(id))) { App.sel = [App.topIdOf(id)]; UI.refresh(); }
    UI.contextMenu(e.clientX, e.clientY);
  },
  overlay(o) {
    const st = Tools.pick.st;
    if (st && st.mode === 'marquee') {
      const a = App.toScreen(st.start.x, st.start.y), b = App.toScreen(st.cur.x, st.cur.y);
      o.push(`<rect class="marquee${st.touch ? ' touch' : ''}" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`);
    }
    Overlay.selection(o);
  },
};

// ======================= Форма (узлы) =======================
Tools.shape = {
  cursor: 'default',
  selNodes: new Set(),
  activate() { Tools.shape.selNodes = new Set(); if (App.sel.length > 1) App.sel = [App.sel[0]]; },
  target() {
    const o = App.sel.length === 1 ? Model.get(App.sel[0]) : null;
    return o && ['path', 'rect', 'ellipse', 'polygon'].includes(o.type) ? o : null;
  },
  // точки редактирования в экранных координатах
  points() {
    const o = Tools.shape.target();
    if (!o) return [];
    const m = o.m, S = (x, y) => { const q = Mx.apply(m, x, y); return App.toScreen(q.x, q.y); };
    const out = [];
    if (o.type === 'path') {
      o.subs.forEach((sp, si) => sp.nodes.forEach((n, ni) => {
        const key = si + ':' + ni;
        out.push({ kind: 'node', si, ni, key, ...S(n.x, n.y), first: ni === 0 && !sp.closed });
        if (Tools.shape.selNodes.has(key)) {
          const hasPrev = sp.closed || ni > 0, hasNext = sp.closed || ni < sp.nodes.length - 1;
          if (hasPrev && (n.ix !== n.x || n.iy !== n.y)) out.push({ kind: 'hin', si, ni, ...S(n.ix, n.iy), ax: S(n.x, n.y) });
          if (hasNext && (n.ox !== n.x || n.oy !== n.y)) out.push({ kind: 'hout', si, ni, ...S(n.ox, n.oy), ax: S(n.x, n.y) });
        }
      }));
    } else if (o.type === 'rect') {
      const r = o.r || 0;
      [[r, 0], [o.w - r, 0], [o.w, r], [o.w, o.h - r], [o.w - r, o.h], [r, o.h], [0, o.h - r], [0, r]].forEach(([x, y], i) => out.push({ kind: 'corner', i, ...S(x, y) }));
    } else if (o.type === 'ellipse') {
      const P = a => { const t = a * Math.PI / 180; return S(o.w / 2 + o.w / 2 * Math.cos(t), o.h / 2 - o.h / 2 * Math.sin(t)); };
      out.push({ kind: 'ang', which: 'a1', ...P(o.a1 || 0) });
      if (o.mode !== 'ellipse') out.push({ kind: 'ang', which: 'a2', ...P(o.a2 ?? 360) });
    } else if (o.type === 'polygon') {
      const { pts } = Shapes.polygonPts(o.w, o.h, o.sides, true, o.star ? o.inner : Math.cos(Math.PI / o.sides));
      pts.forEach((q, i) => out.push({ kind: i % 2 ? 'inner' : 'outer', i, ...S(q.x, q.y) }));
    }
    return out;
  },
  pointAt(e, kinds) {
    const r = App.stageRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const pts = Tools.shape.points();
    // ручки приоритетнее узлов
    for (const pr of [['hin', 'hout'], ['node', 'corner', 'ang', 'inner', 'outer']]) {
      for (const q of pts) if (pr.includes(q.kind) && (!kinds || kinds.includes(q.kind)) && Math.abs(q.x - x) <= 6 && Math.abs(q.y - y) <= 6) return q;
    }
    return null;
  },
  toLocal(o, p) { return Mx.apply(Mx.inv(o.m), p.x, p.y); },
  // ближайший сегмент пути
  segmentAt(o, p, tolPx = 6) {
    const q = Tools.shape.toLocal(o, p);
    let best = null;
    const scale = Math.hypot(o.m[0], o.m[1]) || 1;
    o.subs.forEach((sp, si) => Path.segments(sp).forEach(([i, j]) => {
      const [p0, p1, p2, p3] = Path.segPts(sp.nodes[i], sp.nodes[j]);
      const r = G.nearestOnCubic(p0, p1, p2, p3, q);
      if (!best || r.d < best.d) best = { si, i, j, t: r.t, d: r.d };
    }));
    return best && best.d * scale * App.zoom < tolPx ? best : null;
  },
  down(e, p) {
    const T = Tools.shape;
    T.st = null;
    const o = T.target();
    const q = o && T.pointAt(e);
    if (q) {
      if (q.kind === 'node') {
        if (e.shiftKey) { T.selNodes.has(q.key) ? T.selNodes.delete(q.key) : T.selNodes.add(q.key); }
        else if (!T.selNodes.has(q.key)) T.selNodes = new Set([q.key]);
      }
      Drag.begin([o.id]);
      T.st = { mode: 'point', q, start: p, moved: false };
      UI.refresh();
      return;
    }
    if (o && o.type === 'path') {
      const seg = T.segmentAt(o, p);
      if (seg) {
        // щелчок по сегменту — выделить его начальный узел; перетаскивание — изогнуть сегмент
        T.selNodes = new Set([seg.si + ':' + seg.i]);
        Drag.begin([o.id]);
        T.st = { mode: 'bend', seg, start: p };
        UI.refresh(); return;
      }
    }
    const id = App.hitTest(e.clientX, e.clientY);
    if (id && id !== (o && o.id)) {
      App.sel = [App.topIdOf(id)]; T.selNodes = new Set(); UI.refresh(); return;
    }
    T.st = { mode: 'marquee', start: p, cur: p, add: e.shiftKey };
    if (!e.shiftKey) T.selNodes = new Set();
    UI.refresh();
  },
  move(e, p, dragging) {
    const T = Tools.shape, st = T.st;
    if (!dragging || !st) {
      const o = T.target();
      UI.$('#stage').style.cursor = o && T.pointAt(e) ? 'pointer' : o && o.type === 'path' && T.segmentAt(o, p) ? 'copy' : '';
      return;
    }
    if (st.mode === 'marquee') { st.cur = p; UI.refresh({ panels: false }); return; }
    const [o] = Drag.reset();
    if (st.mode === 'bend') {
      // изгиб: двигаем обе ручки сегмента вслед за курсором
      const sp = o.subs[st.seg.si], a = sp.nodes[st.seg.i], b = sp.nodes[st.seg.j];
      const l0 = T.toLocal(o, st.start), l1 = T.toLocal(o, p);
      const dx = l1.x - l0.x, dy = l1.y - l0.y, t = st.seg.t;
      if (Path.isLineSeg(a, b)) {
        a.ox = a.x + (b.x - a.x) / 3; a.oy = a.y + (b.y - a.y) / 3;
        b.ix = b.x + (a.x - b.x) / 3; b.iy = b.y + (a.y - b.y) / 3;
      }
      const w1 = (1 - t) * 1.5, w2 = t * 1.5;
      a.ox += dx * w1 * 1.33; a.oy += dy * w1 * 1.33; b.ix += dx * w2 * 1.33; b.iy += dy * w2 * 1.33;
      Tools.shape.fixSmooth(sp, st.seg.i, 'out'); Tools.shape.fixSmooth(sp, st.seg.j, 'in');
      UI.refresh({ panels: false }); return;
    }
    const q = st.q;
    const L = T.toLocal(o, App.snapPoint(p, q.kind === 'node' ? [] : []));
    const l0 = T.toLocal(o, st.start);
    if (q.kind === 'node') {
      let dx = L.x - l0.x, dy = L.y - l0.y;
      if (e.ctrlKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (const key of T.selNodes) {
        const [si, ni] = key.split(':').map(Number), n = o.subs[si] && o.subs[si].nodes[ni];
        if (!n) continue;
        n.x += dx; n.y += dy; n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy;
      }
    } else if (q.kind === 'hin' || q.kind === 'hout') {
      const sp = o.subs[q.si], n = sp.nodes[q.ni];
      if (q.kind === 'hin') { n.ix = L.x; n.iy = L.y; } else { n.ox = L.x; n.oy = L.y; }
      T.fixSmooth(sp, q.ni, q.kind === 'hin' ? 'in' : 'out');
    } else if (q.kind === 'corner') {
      // скругление углов прямоугольника: расстояние от угла вдоль стороны
      const cx = L.x < o.w / 2 ? 0 : o.w, cy = L.y < o.h / 2 ? 0 : o.h;
      o.r = G.clamp([0, 1, 4, 5].includes(q.i) ? Math.abs(L.x - cx) : Math.abs(L.y - cy), 0, Math.min(o.w, o.h) / 2);
    } else if (q.kind === 'ang') {
      // перетаскивание узла эллипса: внутри — сектор, снаружи — дуга (как в CorelDRAW)
      const nx = (L.x - o.w / 2) / (o.w / 2), ny = -(L.y - o.h / 2) / (o.h / 2);
      let a = Math.atan2(ny, nx) * 180 / Math.PI; if (a < 0) a += 360;
      if (e.ctrlKey) a = Math.round(a / 15) * 15;
      const inside = nx * nx + ny * ny < 1;
      if (o.mode === 'ellipse') { o.mode = inside ? 'pie' : 'arc'; o.a1 = a; o.a2 = 0; }
      else { o[q.which] = a; o.mode = inside ? 'pie' : 'arc'; }
      UI.status(`Начальный угол ${(o.a1 || 0).toFixed(1)}°, конечный ${(o.a2 || 0).toFixed(1)}°`);
    } else if (q.kind === 'inner' || q.kind === 'outer') {
      const { map } = Shapes.polygonPts(o.w, o.h, o.sides, true, o.star ? o.inner : Math.cos(Math.PI / o.sides));
      const ux = (L.x - map.ox) / map.sx, uy = (L.y - map.oy) / map.sy;
      const r = Math.hypot(ux, uy);
      if (q.kind === 'inner') { o.star = true; o.inner = G.clamp(r, 0.02, 3); }
      UI.status(o.star ? `Острота лучей: ${Math.round((1 - o.inner) * 100)}` : '');
    }
    st.moved = true;
    UI.refresh({ panels: false });
  },
  // выдерживать гладкость узла при перетаскивании одной ручки
  fixSmooth(sp, ni, side) {
    const n = sp.nodes[ni];
    if (!n || n.t === 'cusp') return;
    const [hx, hy] = side === 'in' ? [n.ix, n.iy] : [n.ox, n.oy];
    const dx = n.x - hx, dy = n.y - hy, len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const otherLen = n.t === 'sym' ? len : Math.hypot((side === 'in' ? n.ox : n.ix) - n.x, (side === 'in' ? n.oy : n.iy) - n.y);
    if (otherLen < 1e-9) return;
    const ox = n.x + dx / len * otherLen, oy = n.y + dy / len * otherLen;
    if (side === 'in') { n.ox = ox; n.oy = oy; } else { n.ix = ox; n.iy = oy; }
  },
  up(e, p) {
    const T = Tools.shape, st = T.st;
    T.st = null; App.snapLines = [];
    if (!st) return;
    if (st.mode === 'marquee') {
      const o = T.target();
      if (o && o.type === 'path') {
        const a = App.toScreen(st.start.x, st.start.y), b = App.toScreen(p.x, p.y);
        const r = { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
        for (const q of T.points()) if (q.kind === 'node' && q.x >= r.x1 && q.x <= r.x2 && q.y >= r.y1 && q.y <= r.y2) T.selNodes.add(q.key);
      } else if (!o) {
        // рамкой можно выбрать объект для редактирования
        const id = App.hitTest(e.clientX, e.clientY); if (id) App.sel = [App.topIdOf(id)];
      }
      UI.refresh(); return;
    }
    Drag.end();
    if (st.moved || st.mode === 'bend') App.commit('Редактирование узлов'); else UI.refresh();
  },
  dbl(e, p) {
    const T = Tools.shape, o = T.target();
    if (!o) return;
    if (o.type !== 'path') {
      UI.toast('Чтобы править узлы, преобразуйте объект в кривые (Ctrl+Q)'); return;
    }
    const q = T.pointAt(e, ['node']);
    if (q) { T.selNodes = new Set([q.key]); T.deleteNodes(); return; }
    const seg = T.segmentAt(o, p, 8);
    if (seg) T.insertAt(o, seg.si, seg.i, seg.t);
  },
  insertAt(o, si, i, t) {
    const sp = o.subs[si], n = sp.nodes.length, j = (i + 1) % n;
    const a = sp.nodes[i], b = sp.nodes[j];
    let nn;
    if (Path.isLineSeg(a, b)) nn = Path.node(G.lerp(a.x, b.x, t), G.lerp(a.y, b.y, t));
    else {
      const [L, R] = G.splitCubic(...Path.segPts(a, b), t);
      a.ox = L[1].x; a.oy = L[1].y; b.ix = R[2].x; b.iy = R[2].y;
      nn = { x: L[3].x, y: L[3].y, ix: L[2].x, iy: L[2].y, ox: R[1].x, oy: R[1].y, t: 'smooth' };
    }
    sp.nodes.splice(i + 1, 0, nn);
    Tools.shape.selNodes = new Set([si + ':' + (i + 1)]);
    App.commit('Добавить узел');
  },
  selected() {
    const o = Tools.shape.target();
    if (!o || o.type !== 'path') return [];
    return [...Tools.shape.selNodes].map(k => k.split(':').map(Number)).filter(([si, ni]) => o.subs[si] && o.subs[si].nodes[ni]);
  },
  addNodes() {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (!sel.length) return UI.toast('Выделите узел — новый встанет посередине следующего сегмента');
    // с конца, чтобы не сбивать индексы
    sel.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    for (const [si, ni] of sel) {
      const sp = o.subs[si];
      if (!sp.closed && ni === sp.nodes.length - 1) continue;
      const n = sp.nodes.length, j = (ni + 1) % n, a = sp.nodes[ni], b = sp.nodes[j];
      if (Path.isLineSeg(a, b)) sp.nodes.splice(ni + 1, 0, Path.node((a.x + b.x) / 2, (a.y + b.y) / 2));
      else {
        const [L, R] = G.splitCubic(...Path.segPts(a, b), 0.5);
        a.ox = L[1].x; a.oy = L[1].y; b.ix = R[2].x; b.iy = R[2].y;
        sp.nodes.splice(ni + 1, 0, { x: L[3].x, y: L[3].y, ix: L[2].x, iy: L[2].y, ox: R[1].x, oy: R[1].y, t: 'smooth' });
      }
    }
    Tools.shape.selNodes = new Set();
    App.commit('Добавить узлы');
  },
  deleteNodes() {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (!sel.length) return;
    sel.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    for (const [si, ni] of sel) o.subs[si].nodes.splice(ni, 1);
    o.subs = o.subs.filter(sp => sp.nodes.length >= 2);
    Tools.shape.selNodes = new Set();
    if (!o.subs.length) { Actions.removeIds([o.id]); App.sel = []; }
    App.commit('Удалить узлы');
  },
  setType(t) {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (!sel.length) return UI.toast('Выделите узлы');
    for (const [si, ni] of sel) {
      const n = o.subs[si].nodes[ni]; n.t = t;
      if (t !== 'cusp') {
        let dx = n.ox - n.ix, dy = n.oy - n.iy, len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        dx /= len; dy /= len;
        const li = t === 'sym' ? len / 2 : Math.hypot(n.x - n.ix, n.y - n.iy), lo = t === 'sym' ? len / 2 : Math.hypot(n.ox - n.x, n.oy - n.y);
        n.ix = n.x - dx * li; n.iy = n.y - dy * li; n.ox = n.x + dx * lo; n.oy = n.y + dy * lo;
      }
    }
    App.commit('Тип узла');
  },
  segType(curve) {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (!sel.length) return UI.toast('Выделите узел в начале сегмента');
    for (const [si, ni] of sel) {
      const sp = o.subs[si];
      if (!sp.closed && ni === sp.nodes.length - 1) continue;
      const a = sp.nodes[ni], b = sp.nodes[(ni + 1) % sp.nodes.length];
      if (curve) {
        if (!Path.isLineSeg(a, b)) continue;
        a.ox = a.x + (b.x - a.x) / 3; a.oy = a.y + (b.y - a.y) / 3; b.ix = b.x + (a.x - b.x) / 3; b.iy = b.y + (a.y - b.y) / 3;
      } else { a.ox = a.x; a.oy = a.y; b.ix = b.x; b.iy = b.y; a.t = b.t = 'cusp'; }
    }
    App.commit(curve ? 'В кривую' : 'В линию');
  },
  breakAt() {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (sel.length !== 1) return UI.toast('Выделите один узел для разрыва');
    const [si, ni] = sel[0], sp = o.subs[si];
    if (sp.closed) {
      const nodes = sp.nodes.slice(ni).concat(sp.nodes.slice(0, ni));
      const dup = structuredClone(nodes[0]);
      nodes[0].ix = nodes[0].x; nodes[0].iy = nodes[0].y; dup.ox = dup.x; dup.oy = dup.y;
      nodes.push(dup);
      o.subs[si] = { closed: false, nodes };
    } else {
      if (ni === 0 || ni === sp.nodes.length - 1) return UI.toast('Это уже конечный узел');
      const a = sp.nodes.slice(0, ni + 1), b = [structuredClone(sp.nodes[ni])].concat(sp.nodes.slice(ni + 1));
      o.subs.splice(si, 1, { closed: false, nodes: a }, { closed: false, nodes: b });
    }
    Tools.shape.selNodes = new Set();
    App.commit('Разрыв кривой');
  },
  joinNodes() {
    const o = Tools.shape.target(), sel = Tools.shape.selected();
    if (sel.length !== 2) return UI.toast('Выделите два конечных узла (Shift+щелчок)');
    const [[s1, n1], [s2, n2]] = sel;
    const A = o.subs[s1], B = o.subs[s2];
    const isEnd = (sp, n) => !sp.closed && (n === 0 || n === sp.nodes.length - 1);
    if (!isEnd(A, n1) || !isEnd(B, n2)) return UI.toast('Соединять можно только концы открытых кривых');
    if (s1 === s2) { A.closed = true; }
    else {
      if (n1 === 0) Path.reverse(A);
      if (n2 !== 0) Path.reverse(B);
      A.nodes.push(...B.nodes);
      o.subs.splice(s2, 1);
    }
    Tools.shape.selNodes = new Set();
    App.commit('Соединение узлов');
  },
  toggleClose() {
    const o = Tools.shape.target();
    if (!o || o.type !== 'path') return;
    const sel = Tools.shape.selected();
    const sis = sel.length ? [...new Set(sel.map(s => s[0]))] : o.subs.map((_, i) => i);
    for (const si of sis) o.subs[si].closed = !o.subs[si].closed;
    App.commit('Замкнуть/разомкнуть');
  },
  reverse() {
    const o = Tools.shape.target();
    if (!o || o.type !== 'path') return;
    o.subs.forEach(sp => Path.reverse(sp)); Tools.shape.selNodes = new Set();
    App.commit('Обратить направление');
  },
  key(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && Tools.shape.selected().length) { Tools.shape.deleteNodes(); return true; }
    if (e.key.startsWith('Arrow') && Tools.shape.selected().length) {
      const o = Tools.shape.target(), step = e.shiftKey ? App.superNudge : e.ctrlKey ? App.microNudge : App.nudge;
      const d = { x: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, y: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0 };
      const v = Mx.applyVec(Mx.inv(o.m), d.x, d.y);
      for (const [si, ni] of Tools.shape.selected()) { const n = o.subs[si].nodes[ni]; for (const [a, b] of [['x', 'y'], ['ix', 'iy'], ['ox', 'oy']]) { n[a] += v.x; n[b] += v.y; } }
      App.commit('Сдвиг узлов'); return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') {
      const o = Tools.shape.target();
      if (o && o.type === 'path') { Tools.shape.selNodes = new Set(o.subs.flatMap((sp, si) => sp.nodes.map((_, ni) => si + ':' + ni))); UI.refresh(); return true; }
    }
    return false;
  },
  context(e) { UI.contextMenu(e.clientX, e.clientY); },
  overlay(out) {
    const T = Tools.shape, o = T.target();
    if (o) {
      // контур объекта тонкой линией
      const subs = Model.worldSubs(o);
      const vm = [App.zoom, 0, 0, App.zoom, App.panX, App.panY];
      out.push(`<path class="node-outline" d="${Path.toD(subs, vm)}"/>`);
      for (const q of T.points()) {
        if (q.kind === 'hin' || q.kind === 'hout') {
          out.push(`<line class="hline" x1="${q.ax.x}" y1="${q.ax.y}" x2="${q.x}" y2="${q.y}"/><circle class="hdot" cx="${q.x}" cy="${q.y}" r="3.5"/>`);
        }
      }
      for (const q of T.points()) {
        if (q.kind === 'hin' || q.kind === 'hout') continue;
        const sel = q.kind === 'node' && T.selNodes.has(q.key);
        const nd = q.kind === 'node' ? o.subs[q.si].nodes[q.ni] : null;
        const shape = nd && nd.t !== 'cusp' ? 'circle' : 'rect';
        const cls = 'node' + (sel ? ' sel' : '') + (q.first ? ' first' : '') + (q.kind === 'inner' ? ' inner' : '');
        out.push(shape === 'circle' ? `<circle class="${cls}" cx="${q.x}" cy="${q.y}" r="4"/>` : `<rect class="${cls}" x="${q.x - 4}" y="${q.y - 4}" width="8" height="8"/>`);
      }
    }
    const st = T.st;
    if (st && st.mode === 'marquee') {
      const a = App.toScreen(st.start.x, st.start.y), b = App.toScreen(st.cur.x, st.cur.y);
      out.push(`<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`);
    }
  },
};

// ======================= Фигуры по рамке =======================
function boxTool(type, make) {
  return {
    cursor: 'crosshair',
    down(e, p) { this.st = { start: App.snapPoint(p), cur: p }; },
    move(e, p, dragging) {
      if (!dragging || !this.st) { App.snapPoint(p); UI.refresh({ panels: false, doc: false }); return; }
      this.st.cur = App.snapPoint(p);
      this.st.ctrl = e.ctrlKey; this.st.shift = e.shiftKey;
      const r = this.rect();
      UI.status(`${Math.abs(r.w).toFixed(2)} × ${Math.abs(r.h).toFixed(2)} мм`);
      UI.refresh({ panels: false, doc: false });
    },
    rect() {
      const { start: a, cur: b, ctrl, shift } = this.st;
      let w = b.x - a.x, h = b.y - a.y;
      if (ctrl) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      let x = a.x, y = a.y;
      if (shift) { x = a.x - w; y = a.y - h; w *= 2; h *= 2; }
      return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
    },
    build() {
      const r = this.rect();
      const o = make(r.w, r.h);
      o.m = Mx.translate(r.x, r.y);
      return o;
    },
    up(e, p) {
      if (!this.st) return;
      const r = this.rect();
      App.snapLines = [];
      if (r.w < 0.3 && r.h < 0.3) {
        // щелчок без рамки — выбрать объект под курсором
        this.st = null;
        const id = App.hitTest(e.clientX, e.clientY);
        App.setSel(id ? [App.topIdOf(id)] : []);
        return;
      }
      const o = this.build();
      this.st = null;
      Actions.insert([o]);
      App.commit('Новый объект: ' + Model.typeName(o));
    },
    overlay(out) {
      if (!this.st) return;
      const o = this.build();
      const defs = [];
      UI.preview(Render.obj(o, defs, {}), defs.join(''));
      Overlay.snapLines(out);
    },
    context(e) { Tools.pick.context(e); },
  };
}
Tools.rect = boxTool('rect', (w, h) => Model.make('rect', { w, h, r: UI.opts.rectR || 0 }));
Tools.ellipse = boxTool('ellipse', (w, h) => {
  const mode = UI.opts.ellMode || 'ellipse';
  return Model.make('ellipse', { w, h, mode, a1: 0, a2: mode === 'ellipse' ? 360 : 270 });
});
Tools.polygon = boxTool('polygon', (w, h) => Model.make('polygon', { w, h, sides: UI.opts.polySides || 5, star: false, inner: 0.5 }));
Tools.star = boxTool('polygon', (w, h) => Model.make('polygon', { w, h, sides: UI.opts.starPoints || 5, star: true, inner: UI.opts.starInner || 0.45 }));
Tools.spiral = boxTool('path', (w, h) => Model.make('path', { subs: Shapes.spiral(w, h, UI.opts.spiralTurns || 4) }));

// ======================= Свободная рука =======================
Tools.freehand = {
  cursor: 'crosshair',
  down(e, p) {
    const T = Tools.freehand;
    if (T.line) {
      // второй щелчок — конец прямой линии
      const a = T.line, b = T.lineEnd(e, p);
      T.line = null;
      const o = Model.make('path', { subs: [{ closed: false, nodes: [Path.node(a.x, a.y), Path.node(b.x, b.y)] }] });
      o.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      Actions.insert([o]); App.commit('Линия'); return;
    }
    T.pts = [App.snapPoint(p)]; T.sx = e.clientX; T.sy = e.clientY;
  },
  lineEnd(e, p) {
    let b = App.snapPoint(p);
    if (e.ctrlKey) {
      const a = Tools.freehand.line, ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * Math.PI / 12, L = G.dist(a, b);
      b = { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L };
    }
    return b;
  },
  move(e, p, dragging) {
    const T = Tools.freehand;
    if (T.line) { T.cur = T.lineEnd(e, p); UI.refresh({ panels: false, doc: false }); return; }
    if (!dragging || !T.pts) return;
    T.pts.push(p);
    UI.refresh({ panels: false, doc: false });
  },
  up(e, p) {
    const T = Tools.freehand;
    if (!T.pts) return;
    const moved = Math.hypot(e.clientX - T.sx, e.clientY - T.sy);
    if (moved < 4) { T.line = T.pts[0]; T.cur = T.pts[0]; T.pts = null; UI.status('Щёлкните, где закончится линия (Ctrl — шаг 15°, Esc — отмена)'); return; }
    let pts = G.simplify(T.pts, (UI.opts.smooth ?? 1.2) / App.zoom);
    T.pts = null;
    if (pts.length < 2) return;
    const closed = pts.length > 3 && G.dist(pts[0], pts[pts.length - 1]) < 10 / App.zoom;
    if (closed) pts.pop();
    const o = Model.make('path', { subs: [{ closed, nodes: G.smoothNodes(pts, closed) }] });
    if (!closed) o.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
    Actions.insert([o]); App.commit('Свободная кривая');
  },
  key(e) { if (e.key === 'Escape' && Tools.freehand.line) { Tools.freehand.line = null; UI.refresh(); return true; } return false; },
  overlay(out) {
    const T = Tools.freehand;
    if (T.pts && T.pts.length > 1) out.push(`<polyline class="draft" points="${T.pts.map(q => { const s = App.toScreen(q.x, q.y); return s.x + ',' + s.y; }).join(' ')}"/>`);
    if (T.line && T.cur) {
      const a = App.toScreen(T.line.x, T.line.y), b = App.toScreen(T.cur.x, T.cur.y);
      out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
    }
    Overlay.snapLines(out);
  },
};

// ======================= Кривая Безье (перо) =======================
Tools.bezier = {
  cursor: 'crosshair',
  nodes: null,
  activate() { Tools.bezier.nodes = null; },
  deactivate() { Tools.bezier.finish(); },
  down(e, p) {
    const T = Tools.bezier;
    const q = App.snapPoint(p);
    if (T.nodes && T.nodes.length >= 2) {
      const f = App.toScreen(T.nodes[0].x, T.nodes[0].y), s = App.toScreen(q.x, q.y);
      if (Math.hypot(f.x - s.x, f.y - s.y) < 8) { T.finish(true); return; }
    }
    if (!T.nodes) T.nodes = [];
    T.nodes.push(Path.node(q.x, q.y));
    T.dragging = true;
    UI.refresh({ panels: false, doc: false });
  },
  move(e, p, dragging) {
    const T = Tools.bezier;
    T.cur = App.snapPoint(p);
    if (dragging && T.dragging && T.nodes) {
      // перетаскивание — вытягиваем симметричные ручки
      const n = T.nodes[T.nodes.length - 1];
      n.ox = p.x; n.oy = p.y; n.ix = 2 * n.x - p.x; n.iy = 2 * n.y - p.y; n.t = 'sym';
    }
    UI.refresh({ panels: false, doc: false });
  },
  up() { Tools.bezier.dragging = false; },
  dbl() { Tools.bezier.finish(); },
  finish(close = false) {
    const T = Tools.bezier;
    let ns = T.nodes; T.nodes = null;
    if (!ns) return;
    // двойной щелчок добавляет лишний узел в ту же точку
    while (ns.length > 1 && G.dist(ns[ns.length - 1], ns[ns.length - 2]) < 1e-3) ns.pop();
    if (ns.length < 2) { UI.refresh(); return; }
    const first = ns[0];
    if (!close) { first.ix = first.x; first.iy = first.y; const l = ns[ns.length - 1]; l.ox = l.x; l.oy = l.y; }
    const o = Model.make('path', { subs: [{ closed: close, nodes: ns }] });
    if (!close) o.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
    Actions.insert([o]); App.commit('Кривая Безье');
  },
  key(e) {
    const T = Tools.bezier;
    if (!T.nodes) return false;
    if (e.key === 'Enter' || e.key === 'Escape') { T.finish(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { T.nodes.pop(); if (!T.nodes.length) T.nodes = null; UI.refresh(); return true; }
    if (e.key === ' ') { T.finish(); App.setTool('pick'); return true; }
    return false;
  },
  overlay(out) {
    const T = Tools.bezier;
    const vm = [App.zoom, 0, 0, App.zoom, App.panX, App.panY];
    if (T.nodes && T.nodes.length) {
      const ns = T.nodes.slice();
      if (T.cur && !T.dragging) ns.push(Path.node(T.cur.x, T.cur.y));
      out.push(`<path class="draft" d="${Path.toD([{ closed: false, nodes: ns }], vm)}"/>`);
      T.nodes.forEach((n, i) => {
        const s = App.toScreen(n.x, n.y);
        out.push(`<rect class="node${i === 0 ? ' first' : ''}" x="${s.x - 4}" y="${s.y - 4}" width="8" height="8"/>`);
      });
      const l = T.nodes[T.nodes.length - 1];
      if (l.ox !== l.x || l.oy !== l.y) {
        const a = App.toScreen(l.ix, l.iy), b = App.toScreen(l.ox, l.oy);
        out.push(`<line class="hline" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle class="hdot" cx="${a.x}" cy="${a.y}" r="3"/><circle class="hdot" cx="${b.x}" cy="${b.y}" r="3"/>`);
      }
    }
    Overlay.snapLines(out);
  },
};

// ======================= Текст =======================
Tools.text = {
  cursor: 'text',
  editing: null,
  down(e, p) {
    const id = App.hitTest(e.clientX, e.clientY, true);
    const o = id && Model.get(id);
    if (o && o.type === 'text') { App.sel = [App.topIdOf(id)]; Tools.text.edit(o); return; }
    const q = App.snapPoint(p);
    const t = Model.make('text', Object.assign({ text: '' }, Tools.text.style()));
    t.m = Mx.translate(q.x, q.y);
    Actions.insert([t]);
    UI.refresh();
    Tools.text.edit(t, true);
  },
  style() {
    return { font: UI.opts.font || 'Arial', size: UI.opts.fontSize || 24, bold: !!UI.opts.bold, italic: !!UI.opts.italic, align: UI.opts.align || 'left', lh: 1.2 };
  },
  edit(o, isNew = false) {
    const ta = UI.$('#textEditor');
    Tools.text.editing = { id: o.id, isNew, before: o.text };
    const place = () => {
      const obj = Model.get(o.id); if (!obj) return;
      const m = obj.m, s = App.toScreen(m[4], m[5]);
      const sc = Math.hypot(m[0], m[1]) * App.zoom;
      const fs = obj.size * PT_MM * sc;
      Object.assign(ta.style, {
        display: 'block', left: s.x + 'px', top: s.y + 'px', fontFamily: `"${obj.font}"`, fontSize: fs + 'px',
        lineHeight: (obj.lh || 1.2) * fs + 'px', fontWeight: obj.bold ? 'bold' : 'normal', fontStyle: obj.italic ? 'italic' : 'normal',
        textAlign: obj.align || 'left', color: obj.fill && obj.fill.color || '#000',
        transform: `rotate(${Mx.angle(m)}deg) translateX(${obj.align === 'center' ? '-50%' : obj.align === 'right' ? '-100%' : '0'})`,
        transformOrigin: '0 0', paddingTop: (fs * 0.85 - fs * 0.8 - (((obj.lh || 1.2) - 1) * fs) / 2) + 'px',
      });
      const lines = ta.value.split('\n');
      ta.style.width = Math.max(30, Math.max(...lines.map(l => l.length)) * fs * 0.62 + fs) + 'px';
      ta.style.height = lines.length * (obj.lh || 1.2) * fs + fs * 0.3 + 'px';
    };
    ta.value = o.text;
    place();
    ta.oninput = () => {
      const obj = Model.get(o.id); if (!obj) return;
      obj.text = ta.value; place(); UI.refresh({ panels: false });
    };
    ta.onkeydown = ev => {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ta.blur(); }
      ev.stopPropagation();
    };
    ta.onblur = () => Tools.text.commit();
    Tools.text.place = place;
    UI.$('#docG').classList.add('editing-' + o.id);
    ta.focus(); ta.select();
    UI.refresh();
  },
  commit() {
    const ed = Tools.text.editing;
    if (!ed) return;
    Tools.text.editing = null;
    const ta = UI.$('#textEditor');
    ta.style.display = 'none'; ta.onblur = null;
    const o = Model.get(ed.id);
    if (o) {
      o.text = ta.value.replace(/\s+$/, '');
      if (!o.text.trim()) { Actions.removeIds([o.id]); App.sel = App.sel.filter(i => i !== o.id); }
      if (o.text !== ed.before || ed.isNew) { App.commit('Текст'); return; }
    }
    UI.refresh();
  },
  context(e) { Tools.pick.context(e); },
  overlay(out) { Overlay.selection(out, true); },
};

// ======================= Масштаб и панорама =======================
Tools.zoom = {
  cursor: 'zoom-in',
  down(e, p) { Tools.zoom.st = { start: p, cur: p, out: e.button === 2 || e.shiftKey, sx: e.clientX, sy: e.clientY }; },
  move(e, p, d) { if (d && Tools.zoom.st) { Tools.zoom.st.cur = p; UI.refresh({ panels: false, doc: false }); } },
  up(e, p) {
    const st = Tools.zoom.st; Tools.zoom.st = null;
    if (!st) return;
    if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) > 5 && !st.out) {
      App.zoomBox({ x1: Math.min(st.start.x, p.x), y1: Math.min(st.start.y, p.y), x2: Math.max(st.start.x, p.x), y2: Math.max(st.start.y, p.y) }, 10);
    } else App.setZoom(App.zoom * (st.out ? 0.5 : 2), e.clientX, e.clientY);
  },
  context() { },
  overlay(out) {
    const st = Tools.zoom.st;
    if (st) {
      const a = App.toScreen(st.start.x, st.start.y), b = App.toScreen(st.cur.x, st.cur.y);
      out.push(`<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(a.x - b.x)}" height="${Math.abs(a.y - b.y)}"/>`);
    }
  },
};
Tools.pan = {
  cursor: 'grab',
  down(e) { Tools.pan.st = { sx: e.clientX, sy: e.clientY, px: App.panX, py: App.panY }; },
  move(e, p, d) {
    const st = Tools.pan.st;
    if (d && st) { App.panX = st.px + e.clientX - st.sx; App.panY = st.py + e.clientY - st.sy; UI.refresh({ panels: false }); }
  },
  up() { Tools.pan.st = null; },
};

// ======================= Пипетка и заливка =======================
Tools.eyedropper = {
  cursor: 'crosshair',
  picked: null,
  activate() { Tools.eyedropper.picked = null; },
  down(e) {
    const T = Tools.eyedropper;
    const id = App.hitTest(e.clientX, e.clientY, true);
    if (!id) { T.picked = null; UI.status('Пипетка: щёлкните по объекту, чтобы взять его стиль'); UI.refresh(); return; }
    const o = Model.get(id);
    if (!T.picked || e.shiftKey) {
      T.picked = { fill: structuredClone(o.fill), stroke: structuredClone(o.stroke), opacity: o.opacity, shadow: structuredClone(o.shadow) };
      UI.toast('Стиль взят. Щёлкайте по объектам, чтобы применить (Shift — взять заново)');
      UI.refresh();
    } else {
      const top = Model.get(App.topIdOf(id));
      for (const leaf of Model.leaves(top)) Object.assign(leaf, structuredClone(T.picked));
      App.commit('Применение стиля');
    }
  },
};
Tools.ifill = {
  cursor: 'crosshair',
  down(e, p) {
    let id = App.sel[0];
    const hit = App.hitTest(e.clientX, e.clientY);
    if (hit) { id = App.topIdOf(hit); App.sel = [id]; }
    if (!id) return UI.toast('Выделите объект, затем протяните линию градиента');
    Drag.begin([id]);
    Tools.ifill.st = { id, start: p };
  },
  move(e, p, d) {
    const st = Tools.ifill.st;
    if (!d || !st) return;
    const [o] = Drag.reset();
    let a = Math.atan2(-(p.y - st.start.y), p.x - st.start.x) * 180 / Math.PI;
    if (e.ctrlKey) a = Math.round(a / 15) * 15;
    for (const leaf of Model.leaves(o)) {
      const f = leaf.fill || {};
      const c1 = f.type === 'none' || !f.color ? '#000000' : f.color;
      const c2 = f.type === 'linear' || f.type === 'radial' ? f.color2 : '#ffffff';
      leaf.fill = { type: e.shiftKey ? 'radial' : 'linear', color: c1, color2: c2, angle: Math.round(a) };
    }
    st.cur = p; st.moved = true;
    UI.status(`Градиент: угол ${Math.round(a)}° (Shift — радиальный)`);
    UI.refresh({ panels: false });
  },
  up() {
    const st = Tools.ifill.st; Tools.ifill.st = null; Drag.end();
    if (st && st.moved) App.commit('Градиентная заливка');
  },
  overlay(out) {
    const st = Tools.ifill.st;
    if (st && st.cur) {
      const a = App.toScreen(st.start.x, st.start.y), b = App.toScreen(st.cur.x, st.cur.y);
      out.push(`<line class="gradline" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><rect class="node" x="${a.x - 4}" y="${a.y - 4}" width="8" height="8"/><rect class="node sel" x="${b.x - 4}" y="${b.y - 4}" width="8" height="8"/>`);
    }
    Overlay.selection(out, true);
  },
};

// ======================= Рисование оверлея =======================
const Overlay = {
  selection(out, passive = false) {
    const b = Model.selBox();
    if (!b) return;
    const p1 = App.toScreen(b.x1, b.y1), p2 = App.toScreen(b.x2, b.y2);
    out.push(`<rect class="selbox" x="${p1.x - 6}" y="${p1.y - 6}" width="${p2.x - p1.x + 12}" height="${p2.y - p1.y + 12}"/>`);
    if (App.sel.length > 1) {
      // тонкие рамки отдельных объектов
      for (const o of App.selObjs()) {
        const ob = Model.worldBox(o), a = App.toScreen(ob.x1, ob.y1), c = App.toScreen(ob.x2, ob.y2);
        out.push(`<rect class="subbox" x="${a.x}" y="${a.y}" width="${c.x - a.x}" height="${c.y - a.y}"/>`);
      }
    }
    if (passive) return;
    for (const h of Tools.pick.handles()) {
      if (h.k === 'center') out.push(`<g class="rcenter" transform="translate(${h.x} ${h.y})"><circle r="5"/><circle r="1.5"/></g>`);
      else if (h.k.startsWith('r-')) {
        const rot = { 'r-nw': 0, 'r-ne': 90, 'r-se': 180, 'r-sw': 270 }[h.k];
        out.push(`<g class="rhandle" transform="translate(${h.x} ${h.y}) rotate(${rot})"><path d="M-6 3 A9 9 0 0 1 3 -6 M3 -6 l-3 -3 M3 -6 l-3 3 M-6 3 l-3 -3 M-6 3 l3 -3"/></g>`);
      } else if (h.k.startsWith('k-')) {
        const v = h.k === 'k-n' || h.k === 'k-s';
        out.push(`<g class="rhandle" transform="translate(${h.x} ${h.y})"><path d="${v ? 'M-7 0 H7 M-7 0 l3 -3 M-7 0 l3 3 M7 0 l-3 -3 M7 0 l-3 3' : 'M0 -7 V7 M0 -7 l-3 3 M0 -7 l3 3 M0 7 l-3 -3 M0 7 l3 -3'}"/></g>`);
      } else out.push(`<rect class="handle" x="${h.x - 4}" y="${h.y - 4}" width="8" height="8"/>`);
    }
    Overlay.snapLines(out);
  },
  snapLines(out) {
    const r = App.stageRect();
    for (const l of App.snapLines) {
      if (l.x !== undefined) { const x = App.toScreen(l.x, 0).x; out.push(`<line class="snapline" x1="${x}" y1="0" x2="${x}" y2="${r.height}"/>`); }
      if (l.y !== undefined) { const y = App.toScreen(0, l.y).y; out.push(`<line class="snapline" x1="0" y1="${y}" x2="${r.width}" y2="${y}"/>`); }
    }
  },
};
