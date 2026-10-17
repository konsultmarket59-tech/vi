// Инструменты CorelDRAW, которых не было в первой версии: свободное выделение, линия по двум точкам,
// ломаная, кривая по трём точкам, B-сплайн, перо, прямоугольник и эллипс по трём точкам, стандартные
// фигуры, миллиметровка, таблица, кадрирование, нож, ластик, кисти формы (сглаживание, размазывание,
// огрубление, вихрь, притяжение и отталкивание), искажение, прозрачность, тень, размерные линии,
// соединительные линии, пипетка цвета, умная заливка, художественное оформление (кисть с нажимом),
// умное рисование (распознавание фигур).
'use strict';

const T2 = {
  noFill: () => ({ type: 'none', color: '#000000', color2: '#ffffff', angle: 0 }),
  path(subs, open) {
    const o = Model.make('path', { subs });
    if (open) o.fill = T2.noFill();
    return o;
  },
  add(objs, label) { Actions.insert(objs); App.commit(label); },
  scr: p => App.toScreen(p.x, p.y),
  // угол с шагом 15° при Ctrl
  snapAngle(a, b, ctrl) {
    if (!ctrl) return b;
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 12)) * Math.PI / 12, L = G.dist(a, b);
    return { x: a.x + Math.cos(ang) * L, y: a.y + Math.sin(ang) * L };
  },
  // точка внутри многоугольника (чёт-нечёт)
  inPoly(p, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  },
  inMulti(p, mp) { // мультиполигон polygon-clipping
    for (const poly of mp) {
      if (!T2.inPoly(p, poly[0].map(([x, y]) => ({ x, y })))) continue;
      if (!poly.slice(1).some(h => T2.inPoly(p, h.map(([x, y]) => ({ x, y }))))) return true;
    }
    return false;
  },
  // объекты, к которым применяются инструменты правки: выделенные, а без выделения — под курсором
  targets(e) {
    if (App.sel.length) return App.selObjs();
    const id = e && App.hitTest(e.clientX, e.clientY);
    const o = id && Model.get(App.topIdOf(id));
    return o ? [o] : [];
  },
  // заменить объект другим (или несколькими) на том же месте в списке
  replace(o, list) {
    const f = Model.find(o.id); if (!f) return;
    f.list.splice(f.list.indexOf(o), 1, ...list);
  },
  // объект → кривая в мировых координатах (для разрушающих инструментов)
  asWorldPath(o) {
    if (o.type === 'path' && Mx.isId(o.m) && !o.envelope) return o;
    const subs = Model.worldSubs(o);
    if (!subs) return null;
    const p = Model.make('path', { subs: structuredClone(subs) });
    for (const k of ['fill', 'stroke', 'opacity', 'shadow', 'name', 'transp']) if (o[k] !== undefined && o[k] !== null) p[k] = structuredClone(o[k]);
    p.id = o.id;
    return p;
  },
  // сделать сегменты частыми прямыми (для кистей формы и искажения)
  densify(subs, step) {
    return subs.map(sp => {
      const fl = Path.flatten([sp], null, 24)[0];
      if (!fl) return sp;
      const pts = [];
      for (let i = 0; i < fl.pts.length; i++) {
        const a = fl.pts[i], b = fl.pts[(i + 1) % fl.pts.length];
        pts.push(a);
        if (i === fl.pts.length - 1 && !sp.closed) break;
        const d = G.dist(a, b), n = Math.floor(d / step);
        for (let k = 1; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
      }
      return { closed: sp.closed, nodes: pts.map(p => Path.node(p.x, p.y)) };
    });
  },
  // B-сплайн (равномерный, с закреплёнными концами) → узлы Безье
  bspline(P, closed) {
    if (P.length < 3) return P.map(p => Path.node(p.x, p.y));
    const pts = closed ? P : [P[0], P[0], ...P, P[P.length - 1], P[P.length - 1]];
    const n = pts.length, segs = closed ? n : n - 3;
    const at = i => pts[(i % n + n) % n];
    const nodes = [];
    for (let i = 0; i < segs; i++) {
      const p0 = at(i), p1 = at(i + 1), p2 = at(i + 2), p3 = at(i + 3);
      const s = { x: (p0.x + 4 * p1.x + p2.x) / 6, y: (p0.y + 4 * p1.y + p2.y) / 6 };
      const c1 = { x: (2 * p1.x + p2.x) / 3, y: (2 * p1.y + p2.y) / 3 }, c2 = { x: (p1.x + 2 * p2.x) / 3, y: (p1.y + 2 * p2.y) / 3 };
      const e = { x: (p1.x + 4 * p2.x + p3.x) / 6, y: (p1.y + 4 * p2.y + p3.y) / 6 };
      if (!nodes.length) nodes.push(Path.node(s.x, s.y));
      const last = nodes[nodes.length - 1]; last.ox = c1.x; last.oy = c1.y;
      if (closed && i === segs - 1) { nodes[0].ix = c2.x; nodes[0].iy = c2.y; break; }
      const nd = Path.node(e.x, e.y); nd.ix = c2.x; nd.iy = c2.y; nodes.push(nd);
    }
    for (const nd of nodes) nd.t = 'smooth';
    return nodes;
  },
  draftD(pts) { return pts.map((q, i) => { const s = T2.scr(q); return (i ? 'L' : 'M') + s.x + ' ' + s.y; }).join(''); },
  num(label, key, def, opts = {}) { return UI.num(label, UI.opts[key] ?? def, v => { UI.opts[key] = v; UI.saveOpts(); }, opts); },
  sel(label, key, list, def) { return h('label', { class: 'pl' }, label + ' ', UI.sel(list, UI.opts[key] || def, v => { UI.opts[key] = v; UI.saveOpts(); UI.refresh({ doc: false }); }, '', 150)); },
};

// ======================= Свободное выделение (лассо) =======================
Tools.lasso = {
  cursor: 'crosshair',
  down(e, p) { this.pts = [p]; },
  move(e, p, d) { if (d && this.pts) { this.pts.push(p); UI.refresh({ panels: false, doc: false }); } },
  up(e) {
    const pts = this.pts; this.pts = null;
    if (!pts || pts.length < 3) return UI.refresh();
    const ids = e.shiftKey ? App.sel.slice() : [];
    for (const { o, L } of Model.topLevel()) {
      if (!L.visible || L.locked || !o.visible || o.locked) continue;
      const b = Model.worldBox(o);
      const corners = [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x2, y: b.y2 }, { x: b.x1, y: b.y2 }];
      const inside = e.altKey ? corners.some(c => T2.inPoly(c, pts)) || T2.inPoly({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }, pts) : corners.every(c => T2.inPoly(c, pts));
      if (inside && !ids.includes(o.id)) ids.push(o.id);
    }
    App.setSel(ids);
  },
  overlay(out) {
    if (this.pts && this.pts.length > 1) out.push(`<path class="marquee" d="${T2.draftD(this.pts)}Z"/>`);
    Overlay.selection(out, true);
  },
};

// ======================= Линия по двум точкам =======================
Tools.line2 = {
  cursor: 'crosshair',
  down(e, p) { this.st = { a: App.snapPoint(p), b: App.snapPoint(p) }; },
  move(e, p, d) { if (d && this.st) { this.st.b = T2.snapAngle(this.st.a, App.snapPoint(p), e.ctrlKey); UI.status(`Длина: ${G.dist(this.st.a, this.st.b).toFixed(2)} мм`); UI.refresh({ panels: false, doc: false }); } },
  up() {
    const st = this.st; this.st = null; App.snapLines = [];
    if (!st || G.dist(st.a, st.b) < 0.2) return UI.refresh();
    T2.add([T2.path([{ closed: false, nodes: [Path.node(st.a.x, st.a.y), Path.node(st.b.x, st.b.y)] }], true)], 'Линия');
  },
  overlay(out) {
    if (this.st) { const a = T2.scr(this.st.a), b = T2.scr(this.st.b); out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`); }
    Overlay.snapLines(out);
  },
};

// ======================= Ломаная =======================
Tools.polyline = {
  cursor: 'crosshair',
  activate() { this.pts = null; },
  deactivate() { this.finish(); },
  down(e, p) {
    const q = App.snapPoint(p);
    if (this.pts && this.pts.length > 2) {
      const f = T2.scr(this.pts[0]), s = T2.scr(q);
      if (Math.hypot(f.x - s.x, f.y - s.y) < 8) return this.finish(true);
    }
    if (!this.pts) this.pts = [];
    const last = this.pts[this.pts.length - 1];
    this.pts.push(last ? T2.snapAngle(last, q, e.ctrlKey) : q);
    this.drag = true;
  },
  move(e, p, d) {
    this.cur = this.pts && this.pts.length ? T2.snapAngle(this.pts[this.pts.length - 1], App.snapPoint(p), e.ctrlKey) : p;
    // протягивание — участок от руки
    if (d && this.drag && this.pts && G.dist(this.pts[this.pts.length - 1], p) > 1 / App.zoom * 3) this.pts.push(p);
    UI.refresh({ panels: false, doc: false });
  },
  up() { this.drag = false; },
  dbl() { this.finish(); },
  finish(close = false) {
    let pts = this.pts; this.pts = null;
    if (!pts) return;
    while (pts.length > 1 && G.dist(pts[pts.length - 1], pts[pts.length - 2]) < 1e-3) pts.pop();
    if (pts.length < 2) return UI.refresh();
    T2.add([T2.path([{ closed: close, nodes: pts.map(q => Path.node(q.x, q.y)) }], !close)], 'Ломаная');
  },
  key(e) {
    if (!this.pts) return false;
    if (e.key === 'Enter' || e.key === 'Escape') { this.finish(); return true; }
    if (e.key === 'Backspace') { this.pts.pop(); if (!this.pts.length) this.pts = null; UI.refresh(); return true; }
    return false;
  },
  overlay(out) {
    if (this.pts && this.pts.length) out.push(`<path class="draft" d="${T2.draftD(this.cur ? this.pts.concat([this.cur]) : this.pts)}"/>`);
    Overlay.snapLines(out);
  },
};

// ======================= Кривая по трём точкам =======================
Tools.curve3 = {
  cursor: 'crosshair',
  down(e, p) {
    if (this.st && this.st.phase === 'bend') { this.finish(); return; }
    this.st = { phase: 'line', a: App.snapPoint(p), b: App.snapPoint(p), c: null };
  },
  move(e, p, d) {
    const st = this.st; if (!st) return;
    if (st.phase === 'line' && d) st.b = T2.snapAngle(st.a, App.snapPoint(p), e.ctrlKey);
    else if (st.phase === 'bend') st.c = App.snapPoint(p);
    UI.refresh({ panels: false, doc: false });
  },
  up() {
    const st = this.st; if (!st || st.phase !== 'line') return;
    if (G.dist(st.a, st.b) < 0.2) { this.st = null; return UI.refresh(); }
    st.phase = 'bend'; st.c = { x: (st.a.x + st.b.x) / 2, y: (st.a.y + st.b.y) / 2 };
    UI.status('Ведите мышь, чтобы изогнуть кривую, и щёлкните');
  },
  nodes() {
    const { a, b, c } = this.st;
    const q = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 }; // квадратичная через точку c
    const n0 = Path.node(a.x, a.y), n1 = Path.node(b.x, b.y);
    n0.ox = a.x + 2 / 3 * (q.x - a.x); n0.oy = a.y + 2 / 3 * (q.y - a.y);
    n1.ix = b.x + 2 / 3 * (q.x - b.x); n1.iy = b.y + 2 / 3 * (q.y - b.y);
    return [n0, n1];
  },
  finish() { const ns = this.nodes(); this.st = null; T2.add([T2.path([{ closed: false, nodes: ns }], true)], 'Кривая по 3 точкам'); },
  key(e) { if (e.key === 'Escape' && this.st) { this.st = null; UI.refresh(); return true; } return false; },
  overlay(out) {
    const st = this.st; if (!st) return;
    const vm = [App.zoom, 0, 0, App.zoom, App.panX, App.panY];
    if (st.phase === 'bend' && st.c) out.push(`<path class="draft" d="${Path.toD([{ closed: false, nodes: this.nodes() }], vm)}"/>`);
    else { const a = T2.scr(st.a), b = T2.scr(st.b); out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`); }
  },
};

// ======================= B-сплайн =======================
Tools.bspline = {
  cursor: 'crosshair',
  activate() { this.pts = null; },
  deactivate() { this.finish(); },
  down(e, p) {
    const q = App.snapPoint(p);
    if (this.pts && this.pts.length > 2) {
      const f = T2.scr(this.pts[0]), s = T2.scr(q);
      if (Math.hypot(f.x - s.x, f.y - s.y) < 8) return this.finish(true);
    }
    (this.pts = this.pts || []).push(q);
    UI.refresh({ panels: false, doc: false });
  },
  move(e, p) { this.cur = App.snapPoint(p); UI.refresh({ panels: false, doc: false }); },
  dbl() { this.finish(); },
  finish(close = false) {
    let pts = this.pts; this.pts = null;
    if (!pts) return;
    while (pts.length > 1 && G.dist(pts[pts.length - 1], pts[pts.length - 2]) < 1e-3) pts.pop();
    if (pts.length < 2) return UI.refresh();
    T2.add([T2.path([{ closed: close, nodes: T2.bspline(pts, close) }], !close)], 'B-сплайн');
  },
  key(e) {
    if (!this.pts) return false;
    if (e.key === 'Enter' || e.key === 'Escape') { this.finish(); return true; }
    if (e.key === 'Backspace') { this.pts.pop(); if (!this.pts.length) this.pts = null; UI.refresh(); return true; }
    return false;
  },
  overlay(out) {
    if (!this.pts) return;
    const all = this.cur ? this.pts.concat([this.cur]) : this.pts;
    const vm = [App.zoom, 0, 0, App.zoom, App.panX, App.panY];
    out.push(`<path class="node-outline" d="${T2.draftD(all)}" stroke-dasharray="3 3"/>`);
    if (all.length > 1) out.push(`<path class="draft" d="${Path.toD([{ closed: false, nodes: T2.bspline(all, false) }], vm)}"/>`);
    for (const q of this.pts) { const s = T2.scr(q); out.push(`<rect class="node" x="${s.x - 3.5}" y="${s.y - 3.5}" width="7" height="7"/>`); }
  },
};

// Перо — то же построение по узлам, что и «Кривая Безье»
Tools.pen = Tools.bezier;

// ======================= Прямоугольник и эллипс по трём точкам =======================
function threePointTool(type) {
  return {
    cursor: 'crosshair',
    down(e, p) {
      if (this.st && this.st.phase === 'h') { this.finish(); return; }
      this.st = { phase: 'base', a: App.snapPoint(p), b: App.snapPoint(p), hh: 0 };
    },
    move(e, p, d) {
      const st = this.st; if (!st) return;
      if (st.phase === 'base' && d) st.b = T2.snapAngle(st.a, App.snapPoint(p), e.ctrlKey);
      else if (st.phase === 'h') {
        const dx = st.b.x - st.a.x, dy = st.b.y - st.a.y, L = Math.hypot(dx, dy) || 1;
        st.hh = ((p.x - st.a.x) * -dy + (p.y - st.a.y) * dx) / L; // расстояние со знаком от основания
      }
      UI.refresh({ panels: false, doc: false });
    },
    up() {
      const st = this.st; if (!st || st.phase !== 'base') return;
      if (G.dist(st.a, st.b) < 0.2) { this.st = null; return UI.refresh(); }
      st.phase = 'h'; UI.status('Ведите мышь — высота, щелчок — готово');
    },
    build() {
      const { a, b, hh } = this.st;
      const w = G.dist(a, b), ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, H = Math.abs(hh) || 0.01;
      const o = type === 'rect' ? Model.make('rect', { w, h: H, r: UI.opts.rectR || 0 }) : Model.make('ellipse', { w, h: H, mode: 'ellipse', a1: 0, a2: 360 });
      // поворот вокруг начала основания; отрицательная высота — фигура по другую сторону
      o.m = Mx.mul(Mx.translate(a.x, a.y), Mx.mul(Mx.rotate(ang), Mx.translate(0, hh < 0 ? -H : 0)));
      return o;
    },
    finish() { const o = this.build(); this.st = null; T2.add([o], 'Новый объект: ' + Model.typeName(o)); },
    key(e) { if (e.key === 'Escape' && this.st) { this.st = null; UI.refresh(); return true; } return false; },
    overlay(out) {
      const st = this.st; if (!st) return;
      if (st.phase === 'base') { const a = T2.scr(st.a), b = T2.scr(st.b); out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`); return; }
      const defs = []; UI.preview(Render.obj(this.build(), defs, {}), defs.join(''));
    },
  };
}
Tools.rect3 = threePointTool('rect');
Tools.ellipse3 = threePointTool('ellipse');

// ======================= Стандартные фигуры =======================
const COMMON_SHAPES = {
  arrow: ['Стрелка', (w, h) => [[0, .3], [.6, .3], [.6, 0], [1, .5], [.6, 1], [.6, .7], [0, .7]]],
  arrow2: ['Двойная стрелка', (w, h) => [[0, .5], [.25, 0], [.25, .3], [.75, .3], [.75, 0], [1, .5], [.75, 1], [.75, .7], [.25, .7], [.25, 1]]],
  chevron: ['Шеврон', () => [[0, 0], [.7, 0], [1, .5], [.7, 1], [0, 1], [.3, .5]]],
  pentagon: ['Указатель', () => [[0, 0], [.75, 0], [1, .5], [.75, 1], [0, 1]]],
  cross: ['Крест', () => [[.35, 0], [.65, 0], [.65, .35], [1, .35], [1, .65], [.65, .65], [.65, 1], [.35, 1], [.35, .65], [0, .65], [0, .35], [.35, .35]]],
  check: ['Галочка', () => [[0, .55], [.15, .4], [.38, .62], [.85, .1], [1, .25], [.38, .9]]],
  lightning: ['Молния', () => [[.4, 0], [.85, 0], [.6, .38], [.95, .38], [.25, 1], [.45, .55], [.1, .55]]],
  banner: ['Лента', () => [[0, .15], [1, .15], [.85, .5], [1, .85], [0, .85], [.15, .5]]],
  callout: ['Выноска', () => [[0, 0], [1, 0], [1, .7], [.45, .7], [.2, 1], [.25, .7], [0, .7]]],
  trapezoid: ['Трапеция', () => [[.2, 0], [.8, 0], [1, 1], [0, 1]]],
  parallelogram: ['Параллелограмм', () => [[.25, 0], [1, 0], [.75, 1], [0, 1]]],
  diamond: ['Ромб', () => [[.5, 0], [1, .5], [.5, 1], [0, .5]]],
  hexagon: ['Шестиугольник', () => [[.25, 0], [.75, 0], [1, .5], [.75, 1], [.25, 1], [0, .5]]],
  heart: ['Сердце', null],
  cloud: ['Облако', null],
};
T2.commonShape = (kind, w, h) => {
  if (kind === 'heart') {
    const nd = (x, y, ix, iy, ox, oy, t) => Object.assign(Path.node(x * w, y * h), { ix: ix * w, iy: iy * h, ox: ox * w, oy: oy * h, t });
    return [{ closed: true, nodes: [
      nd(.5, .28, .45, .05, .55, .05, 'cusp'), nd(1, .3, .95, -.05, 1.05, .6, 'smooth'),
      nd(.5, 1, .75, .8, .25, .8, 'cusp'), nd(0, .3, -.05, .6, .05, -.05, 'smooth'),
    ] }];
  }
  if (kind === 'cloud') {
    const pts = []; const N = 9;
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pts.push({ x: (.5 + Math.cos(a) * .42) * w, y: (.5 + Math.sin(a) * .36) * h }); }
    const nodes = pts.map((p, i) => {
      const q = pts[(i + 1) % N], m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, c = { x: w / 2, y: h / 2 };
      const out = { x: m.x + (m.x - c.x) * .45, y: m.y + (m.y - c.y) * .45 };
      return { p, out };
    });
    return [{ closed: true, nodes: nodes.map(({ p }, i) => {
      const prev = nodes[(i + N - 1) % N].out, next = nodes[i].out;
      return Object.assign(Path.node(p.x, p.y), { ix: prev.x, iy: prev.y, ox: next.x, oy: next.y, t: 'cusp' });
    }) }];
  }
  const pts = COMMON_SHAPES[kind][1](w, h);
  return [{ closed: true, nodes: pts.map(([x, y]) => Path.node(x * w, y * h)) }];
};
Tools.shapes = boxTool('path', (w, h) => Model.make('path', { subs: T2.commonShape(UI.opts.commonShape || 'arrow', w, h), name: COMMON_SHAPES[UI.opts.commonShape || 'arrow'][0] }));
Tools.shapes.propbar = add => add(T2.sel('Фигура', 'commonShape', Object.entries(COMMON_SHAPES).map(([k, v]) => [k, v[0]]), 'arrow'));

// ======================= Миллиметровка и таблица =======================
Tools.graph = boxTool('group', () => null);
Tools.graph.build = function () {
  const r = this.rect(); const g = Tools.graph.makeAt(r); return g;
};
Tools.graph.makeAt = r => {
  const cols = Math.max(1, UI.opts.gridCols || 4), rows = Math.max(1, UI.opts.gridRows || 3), cw = r.w / cols, ch = r.h / rows;
  const children = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) children.push(Model.make('rect', { w: cw, h: ch, m: Mx.translate(r.x + j * cw, r.y + i * ch) }));
  return Model.make('group', { children, name: `Миллиметровка ${cols}×${rows}` });
};
Tools.graph.propbar = add => add(T2.num('Столбцов', 'gridCols', 4, { min: 1, max: 99, w: 44 }), T2.num('Строк', 'gridRows', 3, { min: 1, max: 99, w: 44 }));
Tools.table = boxTool('group', () => null);
Tools.table.build = function () {
  const r = this.rect();
  const cols = Math.max(1, UI.opts.tableCols || 3), rows = Math.max(1, UI.opts.tableRows || 3), cw = r.w / cols, ch = r.h / rows;
  const children = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const cell = Model.make('rect', { w: cw, h: ch, m: Mx.translate(r.x + j * cw, r.y + i * ch), name: `Ячейка ${i + 1}:${j + 1}` });
    cell.fill = i === 0 ? { type: 'solid', color: '#eef2f7', color2: '#ffffff', angle: 0 } : { type: 'solid', color: '#ffffff', color2: '#ffffff', angle: 0 };
    cell.stroke = Object.assign(Model.defaults().stroke, { color: '#555555', width: 0.25 });
    children.push(cell);
  }
  return Model.make('group', { children, name: `Таблица ${rows}×${cols}` });
};
Tools.table.propbar = add => add(T2.num('Строк', 'tableRows', 3, { min: 1, max: 99, w: 44 }), T2.num('Столбцов', 'tableCols', 3, { min: 1, max: 99, w: 44 }),
  h('span', { class: 'pl muted' }, 'Текст в ячейки — инструментом «Текст»'));

// ======================= Кадрирование =======================
Tools.crop = {
  cursor: 'crosshair',
  down(e, p) { this.st = { a: p, b: p }; },
  move(e, p, d) { if (d && this.st) { this.st.b = p; UI.refresh({ panels: false, doc: false }); } },
  up() {
    const st = this.st; if (!st) return;
    this.r = { x1: Math.min(st.a.x, st.b.x), y1: Math.min(st.a.y, st.b.y), x2: Math.max(st.a.x, st.b.x), y2: Math.max(st.a.y, st.b.y) };
    this.st = null;
    if (this.r.x2 - this.r.x1 < 0.5 || this.r.y2 - this.r.y1 < 0.5) { this.r = null; return UI.refresh(); }
    UI.status('Двойной щелчок или Enter — кадрировать, Esc — отмена'); UI.refresh({ panels: false, doc: false });
  },
  dbl() { this.apply(); },
  key(e) {
    if (!this.r) return false;
    if (e.key === 'Enter') { this.apply(); return true; }
    if (e.key === 'Escape') { this.r = null; UI.refresh(); return true; }
    return false;
  },
  apply() {
    const r = this.r; this.r = null; if (!r) return;
    const clipPoly = [[[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2], [r.x1, r.y1]]];
    const list = App.sel.length ? App.selObjs() : Model.topLevel().filter(({ L, o }) => L.visible && !L.locked && o.visible && !o.locked).map(x => x.o);
    let n = 0;
    for (const o of list) {
      const b = Model.worldBox(o);
      if (b.x1 >= r.x1 && b.y1 >= r.y1 && b.x2 <= r.x2 && b.y2 <= r.y2) continue; // целиком внутри
      if (b.x2 < r.x1 || b.x1 > r.x2 || b.y2 < r.y1 || b.y1 > r.y2) { T2.replace(o, []); n++; continue; } // целиком снаружи
      const polys = ['path', 'rect', 'ellipse', 'polygon'].includes(o.type) && !o.contour && !o.extrude ? Actions.toPolys(o) : null;
      if (polys) {
        const res = polygonClipping.intersection(polys, clipPoly);
        const p = res.length ? Actions.fromPolys(res, o) : null;
        if (p) p.id = o.id;
        T2.replace(o, p ? [p] : []);
      } else {
        // картинки, тексты и группы — во фрейм размера кадра (обрезанное не теряется)
        const cont = Model.make('rect', { w: r.x2 - r.x1, h: r.y2 - r.y1, m: Mx.translate(r.x1, r.y1), name: 'Кадр' });
        cont.fill = T2.noFill(); cont.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
        const pc = Model.make('powerclip', { container: cont, children: [o] }); delete pc.fill; delete pc.stroke;
        T2.replace(o, [pc]);
      }
      n++;
    }
    App.sel = App.sel.filter(id => Model.find(id));
    App.commit('Кадрирование');
    UI.toast(n ? `Кадрировано объектов: ${n}` : 'Нечего кадрировать — всё внутри рамки');
  },
  overlay(out) {
    const r = this.st ? { x1: Math.min(this.st.a.x, this.st.b.x), y1: Math.min(this.st.a.y, this.st.b.y), x2: Math.max(this.st.a.x, this.st.b.x), y2: Math.max(this.st.a.y, this.st.b.y) } : this.r;
    if (!r) return;
    const a = App.toScreen(r.x1, r.y1), b = App.toScreen(r.x2, r.y2), W = App.stageRect();
    out.push(`<path d="M0 0H${W.width}V${W.height}H0Z M${a.x} ${a.y}V${b.y}H${b.x}V${a.y}Z" fill="rgba(0,0,0,.35)" fill-rule="evenodd"/>`);
    out.push(`<rect class="marquee" x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}"/>`);
  },
};

// ======================= Нож =======================
Tools.knife = {
  cursor: 'crosshair',
  down(e, p) { this.pts = [App.snapPoint(p)]; this.free = false; },
  move(e, p, d) {
    if (!d || !this.pts) return;
    if (e.shiftKey || this.free) { this.free = true; this.pts.push(p); } else this.pts[1] = T2.snapAngle(this.pts[0], App.snapPoint(p), e.ctrlKey);
    UI.refresh({ panels: false, doc: false });
  },
  up(e) {
    const pts = this.pts; this.pts = null;
    if (!pts || pts.length < 2 || G.dist(pts[0], pts[pts.length - 1]) < 0.3) return UI.refresh();
    // разрез — тонкая полоса вдоль линии ножа
    const wdt = 0.02, strip = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = G.dist(a, b) || 1, nx = -(b.y - a.y) / L * wdt, ny = (b.x - a.x) / L * wdt;
      strip.push([[[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny], [a.x + nx, a.y + ny]]]);
    }
    const cut = strip.length > 1 ? polygonClipping.union(...strip) : strip;
    const list = (App.sel.length ? App.selObjs() : Model.topLevel().map(x => x.o)).filter(o => ['path', 'rect', 'ellipse', 'polygon'].includes(o.type) && o.visible && !o.locked);
    const made = [];
    for (const o of list) {
      const polys = Actions.toPolys(o); if (!polys) continue;
      let res; try { res = polygonClipping.difference(polys, cut); } catch (er) { continue; }
      if (res.length < 2) continue;
      const parts = res.map(poly => { const p = Actions.fromPolys([poly], o); return p; }).filter(Boolean);
      T2.replace(o, parts); made.push(...parts.map(p => p.id));
    }
    if (!made.length) { UI.toast('Нож: линия не пересекает замкнутые фигуры'); return UI.refresh(); }
    App.sel = made; App.commit('Нож');
  },
  overlay(out) { if (this.pts && this.pts.length > 1) out.push(`<path class="draft" d="${T2.draftD(this.pts)}" stroke-dasharray="5 3"/>`); },
  propbar: add => add(h('span', { class: 'pl muted' }, 'Протяните линию разреза через фигуры. Shift — разрез от руки, Ctrl — шаг 15°')),
};

// ======================= Ластик =======================
Tools.eraser = {
  cursor: 'none',
  r() { return (UI.opts.eraserSize || 4) / 2; },
  down(e, p) { this.pts = [p]; },
  move(e, p, d) { this.cur = p; if (d && this.pts) this.pts.push(p); UI.refresh({ panels: false, doc: false }); },
  up() {
    const pts = this.pts; this.pts = null; if (!pts) return;
    const r = this.r(), step = r / 2, circles = [];
    const circ = c => { const ring = []; for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2; ring.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]); } return [ring]; };
    let last = null;
    for (const q of pts) {
      if (last) { const d = G.dist(last, q), n = Math.floor(d / step); for (let k = 1; k <= n; k++) circles.push(circ({ x: last.x + (q.x - last.x) * k / n, y: last.y + (q.y - last.y) * k / n })); }
      else circles.push(circ(q));
      last = q;
    }
    let brush; try { brush = polygonClipping.union(...circles); } catch (er) { return; }
    const box = { x1: Math.min(...pts.map(q => q.x)) - r, y1: Math.min(...pts.map(q => q.y)) - r, x2: Math.max(...pts.map(q => q.x)) + r, y2: Math.max(...pts.map(q => q.y)) + r };
    const list = (App.sel.length ? App.selObjs() : Model.topLevel().map(x => x.o)).filter(o => ['path', 'rect', 'ellipse', 'polygon'].includes(o.type) && o.visible && !o.locked);
    let n = 0;
    for (const o of list) {
      const b = Model.worldBox(o); if (b.x2 < box.x1 || b.x1 > box.x2 || b.y2 < box.y1 || b.y1 > box.y2) continue;
      const polys = Actions.toPolys(o); if (!polys) continue;
      let res; try { res = polygonClipping.difference(polys, brush); } catch (er) { continue; }
      const p = res.length ? Actions.fromPolys(res, o) : null;
      if (p) p.id = o.id;
      T2.replace(o, p ? [p] : []); n++;
    }
    App.sel = App.sel.filter(id => Model.find(id));
    if (n) App.commit('Ластик'); else UI.refresh();
  },
  overlay(out) {
    const c = this.cur; if (!c) return;
    const s = T2.scr(c), R = this.r() * App.zoom;
    out.push(`<circle class="selbox" cx="${s.x}" cy="${s.y}" r="${R}"/>`);
    if (this.pts && this.pts.length > 1) out.push(`<path d="${T2.draftD(this.pts)}" fill="none" stroke="rgba(220,40,40,.35)" stroke-width="${2 * R}" stroke-linecap="round" stroke-linejoin="round"/>`);
  },
  propbar: add => add(T2.num('Толщина ластика, мм', 'eraserSize', 4, { min: 0.2, max: 200, step: 0.5, w: 54 })),
};

// ======================= Кисти формы: сглаживание, размазывание, огрубление, вихрь, притяжение, отталкивание =======================
function brushTool(kind, label) {
  return {
    cursor: 'none',
    r() { return (UI.opts.brushSize || 10) / 2; },
    k() { return (UI.opts.brushStrength ?? 50) / 100; },
    down(e, p) {
      const objs = T2.targets(e).filter(o => !o.locked);
      this.objs = [];
      for (const o of objs) {
        const leaves = o.type === 'path' || ['rect', 'ellipse', 'polygon'].includes(o.type) ? [o] : [];
        for (const leaf of leaves) {
          const w = T2.asWorldPath(leaf); if (!w) continue;
          w.subs = T2.densify(w.subs, Math.max(0.15, this.r() / 6));
          if (w !== leaf) T2.replace(leaf, [w]);
          this.objs.push(w);
        }
      }
      if (!this.objs.length) { UI.toast(label + ': выделите кривую или фигуру'); this.objs = null; return; }
      this.last = p; this.cur = p; this.moved = false;
      if (kind === 'roughen') this.apply(p, { x: 0, y: 0 });
    },
    move(e, p, d) {
      this.cur = p;
      if (d && this.objs) { this.apply(p, { x: p.x - this.last.x, y: p.y - this.last.y }); this.last = p; this.moved = true; }
      UI.refresh({ panels: false, doc: !!(d && this.objs) });
    },
    apply(c, dv) {
      const R = this.r(), K = this.k();
      for (const o of this.objs) for (const sp of o.subs) {
        const ns = sp.nodes;
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i], d = Math.hypot(n.x - c.x, n.y - c.y);
          if (d > R) continue;
          const f = (1 - d / R) * K; // ослабление к краю кисти
          let x = n.x, y = n.y;
          if (kind === 'attract' || kind === 'repel') { const s = (kind === 'attract' ? 1 : -1) * f * 0.25; x += (c.x - n.x) * s; y += (c.y - n.y) * s; }
          else if (kind === 'twirl') { const a = f * 0.25, cs = Math.cos(a), sn = Math.sin(a); x = c.x + (n.x - c.x) * cs - (n.y - c.y) * sn; y = c.y + (n.x - c.x) * sn + (n.y - c.y) * cs; }
          else if (kind === 'smudge') { x += dv.x * f; y += dv.y * f; }
          else if (kind === 'smooth') {
            const a = ns[(i - 1 + ns.length) % ns.length], b = ns[(i + 1) % ns.length];
            if (!sp.closed && (i === 0 || i === ns.length - 1)) continue;
            x += ((a.x + b.x) / 2 - n.x) * f; y += ((a.y + b.y) / 2 - n.y) * f;
          } else if (kind === 'roughen') {
            if (n._r) continue;
            const a = ns[(i - 1 + ns.length) % ns.length], b = ns[(i + 1) % ns.length];
            const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1, amp = (UI.opts.roughSize || 2) * f * (i % 2 ? 1 : -1);
            x += -ty / L * amp; y += tx / L * amp; n._r = 1;
          }
          const dx = x - n.x, dy = y - n.y;
          n.x = x; n.y = y; n.ix += dx; n.iy += dy; n.ox += dx; n.oy += dy;
        }
      }
    },
    up() {
      if (!this.objs) return;
      for (const o of this.objs) for (const sp of o.subs) for (const n of sp.nodes) delete n._r;
      this.objs = null;
      App.commit(label);
    },
    overlay(out) {
      const c = this.cur; if (!c) return;
      const s = T2.scr(c);
      out.push(`<circle class="selbox" cx="${s.x}" cy="${s.y}" r="${this.r() * App.zoom}"/>`);
      Overlay.selection(out, true);
    },
    propbar(add) {
      add(T2.num('Размер кисти, мм', 'brushSize', 10, { min: 0.5, max: 500, step: 0.5, w: 54 }), T2.num('Сила, %', 'brushStrength', 50, { min: 1, max: 100, w: 44 }));
      if (kind === 'roughen') add(T2.num('Высота зубцов, мм', 'roughSize', 2, { min: 0.1, max: 50, step: 0.1, w: 50 }));
    },
  };
}
Tools.smoothB = brushTool('smooth', 'Сглаживание');
Tools.smudge = brushTool('smudge', 'Размазывание');
Tools.roughen = brushTool('roughen', 'Огрубление');
Tools.twirl = brushTool('twirl', 'Вихрь');
Tools.attract = brushTool('attract', 'Притяжение');
Tools.repel = brushTool('repel', 'Отталкивание');

// ======================= Искажение: втягивание-раздувание, зигзаг, скручивание =======================
Tools.distort = {
  cursor: 'crosshair',
  down(e, p) {
    const objs = T2.targets(e).filter(o => ['path', 'rect', 'ellipse', 'polygon'].includes(o.type) && !o.locked);
    if (!objs.length) { UI.toast('Искажение: выделите фигуру или кривую'); return; }
    this.st = { start: p, items: objs.map(o => ({ o, src: T2.asWorldPath(o) })) };
    for (const it of this.st.items) { it.src = structuredClone(it.src); const b = Path.bbox(it.src.subs); it.c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }; it.size = Math.max(b.x2 - b.x1, b.y2 - b.y1) || 1; it.dense = UI.opts.distortMode === 'pushpull' ? it.src.subs : T2.densify(it.src.subs, it.size / 120); }
  },
  move(e, p, d) {
    const st = this.st; if (!d || !st) return;
    const amt = (p.x - st.start.x) / 50; // вправо — сильнее, влево — обратное
    st.amt = amt;
    for (const it of st.items) {
      const subs = structuredClone(it.dense), mode = UI.opts.distortMode || 'pushpull', c = it.c;
      for (const sp of subs) sp.nodes.forEach((n, i) => {
        const mv = (x, y) => {
          if (mode === 'pushpull') return { x: c.x + (x - c.x) * (1 + amt), y: c.y + (y - c.y) * (1 + amt) };
          if (mode === 'twister') { const r = Math.hypot(x - c.x, y - c.y) / it.size, a = amt * r * 2; const cs = Math.cos(a), sn = Math.sin(a); return { x: c.x + (x - c.x) * cs - (y - c.y) * sn, y: c.y + (x - c.x) * sn + (y - c.y) * cs }; }
          return { x, y };
        };
        if (mode === 'zipper') {
          const a = sp.nodes[(i - 1 + sp.nodes.length) % sp.nodes.length], b = sp.nodes[(i + 1) % sp.nodes.length];
          const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1, A = Math.abs(amt) * it.size * 0.05 * (i % 2 ? 1 : -1);
          n.x += -ty / L * A; n.y += tx / L * A; n.ix = n.ox = n.x; n.iy = n.oy = n.y; n.t = 'cusp';
          return;
        }
        if (mode === 'pushpull') {
          // втягивание: узлы стоят, ручки тянутся к центру; раздувание — от центра
          const k = amt;
          n.ix = n.ix + (c.x - n.ix) * -k; n.iy = n.iy + (c.y - n.iy) * -k;
          n.ox = n.ox + (c.x - n.ox) * -k; n.oy = n.oy + (c.y - n.oy) * -k;
          n.t = 'cusp';
          return;
        }
        const q = mv(n.x, n.y), qi = mv(n.ix, n.iy), qo = mv(n.ox, n.oy);
        n.x = q.x; n.y = q.y; n.ix = qi.x; n.iy = qi.y; n.ox = qo.x; n.oy = qo.y;
      });
      const np = Object.assign(structuredClone(it.src), { subs });
      T2.replace(Model.get(it.o.id) || it.o, [np]); it.o = np;
    }
    UI.status(`Искажение: ${(amt * 100).toFixed(0)}`);
    UI.refresh({ panels: false });
  },
  up() { const st = this.st; this.st = null; if (st && st.amt) { App.sel = st.items.map(it => it.o.id); App.commit('Искажение'); } },
  propbar: add => add(T2.sel('Вид', 'distortMode', [['pushpull', 'Втягивание / раздувание'], ['zipper', 'Зигзаг'], ['twister', 'Скручивание']], 'pushpull'),
    h('span', { class: 'pl muted' }, 'Тяните вправо — сильнее, влево — в обратную сторону')),
  overlay(out) { Overlay.selection(out, true); },
};

// ======================= Прозрачность (градиентная) =======================
Tools.transp = {
  cursor: 'crosshair',
  down(e, p) {
    const o = T2.targets(e)[0]; if (!o) return UI.toast('Прозрачность: выделите объект');
    App.sel = [o.id];
    this.st = { o, a: p, b: p };
  },
  move(e, p, d) { if (d && this.st) { this.st.b = e.ctrlKey ? T2.snapAngle(this.st.a, p, true) : p; this.preview(); } },
  preview() {
    const { o, a, b } = this.st;
    if (G.dist(a, b) < 0.5) return;
    const inv = Mx.inv(o.m), la = Mx.apply(inv, a.x, a.y), lb = Mx.apply(inv, b.x, b.y);
    o.transp = { type: 'linear', x1: la.x, y1: la.y, x2: lb.x, y2: lb.y, from: UI.opts.transpFrom ?? 0, to: UI.opts.transpTo ?? 100 };
    UI.refresh({ panels: false });
  },
  up(e) {
    const st = this.st; this.st = null; if (!st) return;
    if (G.dist(st.a, st.b) < 0.5) {
      // щелчок — равномерная прозрачность по значению «до»
      const v = (UI.opts.transpTo ?? 50) / 100;
      delete st.o.transp; st.o.opacity = 1 - v;
    }
    App.commit('Прозрачность');
  },
  propbar(add) {
    const o = App.selObjs()[0];
    add(T2.num('Начало, %', 'transpFrom', 0, { min: 0, max: 100, w: 44 }), T2.num('Конец, %', 'transpTo', 100, { min: 0, max: 100, w: 44 }),
      UI.btn('reset', 'Убрать прозрачность', () => { for (const x of App.selObjs()) { delete x.transp; x.opacity = 1; } App.commit('Без прозрачности'); }),
      h('span', { class: 'pl muted' }, o ? 'Протяните по объекту: от непрозрачного к прозрачному; щелчок — равномерно' : 'Выделите объект'));
  },
  overlay(out) {
    const st = this.st; if (st) { const a = T2.scr(st.a), b = T2.scr(st.b); out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><rect class="handle" x="${a.x - 4}" y="${a.y - 4}" width="8" height="8"/><rect class="handle" x="${b.x - 4}" y="${b.y - 4}" width="8" height="8" fill="#fff"/>`); }
    Overlay.selection(out, true);
  },
};

// ======================= Тень (протянуть от объекта) =======================
Tools.shadowT = {
  cursor: 'crosshair',
  down(e, p) {
    const o = T2.targets(e)[0]; if (!o) return UI.toast('Тень: выделите объект');
    App.sel = [o.id];
    this.st = { o, a: p, sh0: o.shadow ? structuredClone(o.shadow) : null };
  },
  move(e, p, d) {
    const st = this.st; if (!d || !st) return;
    st.o.shadow = { dx: G.round(p.x - st.a.x, 2), dy: G.round(p.y - st.a.y, 2), blur: UI.opts.shadowBlur ?? 2, color: UI.opts.shadowColor || '#000000', opacity: (UI.opts.shadowOpacity ?? 50) / 100 };
    UI.refresh({ panels: false });
  },
  up() { const st = this.st; this.st = null; if (st) App.commit('Тень'); },
  propbar: add => add(T2.num('Размытие, мм', 'shadowBlur', 2, { min: 0, max: 50, step: 0.5, w: 44 }), T2.num('Непрозрачность, %', 'shadowOpacity', 50, { min: 0, max: 100, w: 44 }),
    UI.btn('reset', 'Убрать тень', () => { for (const x of App.selObjs()) x.shadow = null; App.commit('Без тени'); }),
    h('span', { class: 'pl muted' }, 'Протяните от объекта в сторону тени')),
  overlay(out) { Overlay.selection(out, true); },
};

// ======================= Размерные линии =======================
Tools.dimension = {
  cursor: 'crosshair',
  down(e, p) {
    const q = App.snapPoint(p);
    if (!this.st) { this.st = { a: q, b: q, phase: 'b' }; return; }
    if (this.st.phase === 'off') { this.finish(); return; }
  },
  move(e, p, d) {
    const st = this.st; if (!st) return;
    const q = App.snapPoint(p);
    if (st.phase === 'b') st.b = q; else st.off = q;
    UI.refresh({ panels: false, doc: false });
  },
  up() {
    const st = this.st; if (!st || st.phase !== 'b') return;
    if (G.dist(st.a, st.b) < 0.2) return; // ждём второй щелчок
    st.phase = 'off'; st.off = st.b; UI.status('Ведите мышь — отступ размерной линии, щелчок — готово');
  },
  geom() {
    const { a, b, off } = this.st, mode = UI.opts.dimMode || 'aligned';
    let p1 = a, p2 = b;
    if (mode === 'horizontal') { const y = off ? off.y : a.y; p1 = { x: a.x, y }; p2 = { x: b.x, y }; }
    else if (mode === 'vertical') { const x = off ? off.x : a.x; p1 = { x, y: a.y }; p2 = { x, y: b.y }; }
    else if (off) {
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const t = (off.x - a.x) * nx + (off.y - a.y) * ny;
      p1 = { x: a.x + nx * t, y: a.y + ny * t }; p2 = { x: b.x + nx * t, y: b.y + ny * t };
    }
    const len = G.dist(p1, p2);
    return { p1, p2, len };
  },
  build() {
    const { a, b } = this.st, { p1, p2, len } = this.geom();
    const st = Object.assign(Model.defaults().stroke, { color: '#000000', width: 0.2 });
    const line = (u, v, arrows) => { const o = T2.path([{ closed: false, nodes: [Path.node(u.x, u.y), Path.node(v.x, v.y)] }], true); o.stroke = Object.assign({}, st, arrows ? { arrowStart: true, arrowEnd: true } : {}); return o; };
    const kids = [line(a, p1), line(b, p2), line(p1, p2, true)];
    const digits = UI.opts.dimDigits ?? 1;
    const t = Model.make('text', { text: len.toFixed(digits) + ' мм', size: UI.opts.dimSize || 8, align: 'center' });
    t.fill = { type: 'solid', color: '#000000', color2: '#ffffff', angle: 0 };
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI, up = ang > 90 || ang < -90 ? ang + 180 : ang;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    t.m = Mx.mul(Mx.translate(mx, my), Mx.mul(Mx.rotate(up), Mx.translate(0, -(t.size * 25.4 / 72) * 0.35)));
    kids.push(t);
    return Model.make('group', { children: kids, name: 'Размер ' + len.toFixed(digits) + ' мм' });
  },
  finish() { const g = this.build(); this.st = null; T2.add([g], 'Размерная линия'); },
  key(e) { if (e.key === 'Escape' && this.st) { this.st = null; UI.refresh(); return true; } return false; },
  overlay(out) {
    if (!this.st) return;
    if (this.st.phase === 'off') { const defs = []; UI.preview(Render.obj(this.build(), defs, {}), defs.join('')); }
    else { const a = T2.scr(this.st.a), b = T2.scr(this.st.b); out.push(`<line class="draft" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`); }
    Overlay.snapLines(out);
  },
  propbar: add => add(T2.sel('Вид', 'dimMode', [['aligned', 'Параллельный'], ['horizontal', 'Горизонтальный'], ['vertical', 'Вертикальный']], 'aligned'),
    T2.num('Знаков после запятой', 'dimDigits', 1, { min: 0, max: 3, w: 40 }), T2.num('Кегль', 'dimSize', 8, { min: 4, max: 72, w: 40 })),
};

// ======================= Соединительная линия =======================
Tools.connector = {
  cursor: 'crosshair',
  anchor(e, p) {
    // ближайшая середина стороны объекта под курсором
    const id = App.hitTest(e.clientX, e.clientY), o = id && Model.get(App.topIdOf(id));
    if (!o) return App.snapPoint(p);
    const b = Model.worldBox(o), cands = [{ x: (b.x1 + b.x2) / 2, y: b.y1 }, { x: b.x2, y: (b.y1 + b.y2) / 2 }, { x: (b.x1 + b.x2) / 2, y: b.y2 }, { x: b.x1, y: (b.y1 + b.y2) / 2 }, { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }];
    return cands.reduce((m, c) => G.dist(c, p) < G.dist(m, p) ? c : m);
  },
  down(e, p) { this.st = { a: this.anchor(e, p) }; this.st.b = this.st.a; },
  move(e, p, d) { if (d && this.st) { this.st.b = this.anchor(e, p); UI.refresh({ panels: false, doc: false }); } },
  pts() {
    const { a, b } = this.st, mode = UI.opts.connMode || 'straight';
    if (mode === 'straight') return [a, b];
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  },
  up() {
    const st = this.st; if (!st) return;
    const pts = this.pts(); this.st = null;
    if (G.dist(pts[0], pts[pts.length - 1]) < 0.3) return UI.refresh();
    const o = T2.path([{ closed: false, nodes: pts.map(q => Path.node(q.x, q.y)) }], true);
    o.stroke = Object.assign(Model.defaults().stroke, { color: App.defaults.stroke.color || '#000000', width: App.defaults.stroke.width || 0.3, arrowEnd: !!UI.opts.connArrow, join: (UI.opts.connMode || '') === 'round' ? 'round' : 'miter' });
    o.name = 'Соединительная линия';
    T2.add([o], 'Соединительная линия');
  },
  overlay(out) { if (this.st) out.push(`<path class="draft" d="${T2.draftD(this.pts())}"/>`); },
  propbar: add => add(T2.sel('Вид', 'connMode', [['straight', 'Прямая'], ['angle', 'Под прямым углом'], ['round', 'Скруглённая под прямым углом']], 'straight'),
    h('label', { class: 'pl' }, h('input', { type: 'checkbox', checked: !!UI.opts.connArrow, onchange: e => { UI.opts.connArrow = e.target.checked; UI.saveOpts(); } }), ' стрелка')),
};

// ======================= Пипетка цвета =======================
Tools.colorpick = {
  cursor: 'crosshair',
  down(e) {
    const id = App.hitTest(e.clientX, e.clientY, true), o = id && Model.get(id);
    if (!this.color) {
      if (!o) return UI.status('Пипетка цвета: щёлкните по объекту, чтобы взять цвет');
      const c = (o.fill && o.fill.type !== 'none' && o.fill.color) || (o.stroke && o.stroke.color);
      if (!c) return UI.toast('У объекта нет цвета');
      this.color = c;
      UI.status(`Взят цвет ${c}. Щелчок по объекту — заливка, Shift+щелчок — абрис, Esc — взять другой`);
      UI.refresh({ doc: false });
      return;
    }
    if (!o) return;
    const top = Model.get(App.topIdOf(id));
    for (const leaf of Model.leaves(top)) {
      if (e.shiftKey) leaf.stroke = Object.assign(leaf.stroke || Model.defaults().stroke, { color: this.color, width: leaf.stroke && leaf.stroke.width || 0.2 });
      else leaf.fill = { type: 'solid', color: this.color, color2: '#ffffff', angle: 0 };
    }
    App.commit('Пипетка цвета');
  },
  key(e) { if (e.key === 'Escape' && this.color) { this.color = null; UI.refresh({ doc: false }); return true; } return false; },
  propbar: add => add(h('span', { class: 'pl' }, 'Цвет: '), h('span', { class: 'oswatch', style: { background: Tools.colorpick.color || 'transparent', width: '22px', height: '16px', display: 'inline-block', border: '1px solid #888' } }),
    h('span', { class: 'pl muted' }, Tools.colorpick.color ? Tools.colorpick.color + ' — щелчок по объекту: заливка, Shift — абрис' : 'Щёлкните по объекту, чтобы взять цвет')),
};

// ======================= Умная заливка =======================
Tools.smartfill = {
  cursor: 'crosshair',
  down(e, p) {
    const closed = [];
    for (const { o, L } of Model.topLevel()) {
      if (!L.visible || !o.visible) continue;
      for (const leaf of Model.leaves(o)) {
        if (!['path', 'rect', 'ellipse', 'polygon'].includes(leaf.type)) continue;
        const polys = Actions.toPolys(leaf); if (polys) closed.push(polys);
      }
    }
    const inside = closed.filter(mp => T2.inMulti(p, mp));
    if (!inside.length) return UI.toast('Умная заливка: щёлкните внутри области, ограниченной фигурами');
    let res;
    try {
      res = inside.length > 1 ? polygonClipping.intersection(...inside) : inside[0];
      // фигуры, не содержащие точку, но перекрывающие область, вырезаются
      const others = closed.filter(mp => !inside.includes(mp));
      if (others.length) res = polygonClipping.difference(res, ...others);
    } catch (er) { return UI.toast('Не удалось построить область'); }
    // из нескольких кусков берём тот, где щёлкнули
    const piece = res.find(poly => T2.inMulti(p, [poly]));
    if (!piece) return UI.toast('Область не найдена');
    const o = Actions.fromPolys([piece], Model.make('rect', { w: 1, h: 1 }));
    if (!o) return;
    o.fill = { type: 'solid', color: UI.opts.smartColor || App.defaults.fill.color || '#4a90d9', color2: '#ffffff', angle: 0 };
    o.stroke = Object.assign(Model.defaults().stroke, { color: UI.opts.smartOutline ? '#000000' : null, width: UI.opts.smartOutline ? 0.2 : 0 });
    o.name = 'Умная заливка';
    T2.add([o], 'Умная заливка');
  },
  propbar: add => add(h('label', { class: 'pl' }, 'Цвет ', h('input', { type: 'color', value: UI.opts.smartColor || '#4a90d9', onchange: e => { UI.opts.smartColor = e.target.value; UI.saveOpts(); } })),
    h('label', { class: 'pl' }, h('input', { type: 'checkbox', checked: !!UI.opts.smartOutline, onchange: e => { UI.opts.smartOutline = e.target.checked; UI.saveOpts(); } }), ' абрис'),
    h('span', { class: 'pl muted' }, 'Щёлкните внутри области, образованной пересечением фигур')),
};

// ======================= Художественное оформление: кисть и каллиграфия =======================
Tools.artistic = {
  cursor: 'crosshair',
  down(e, p) { this.pts = [{ x: p.x, y: p.y, w: this.width(e), t: performance.now() }]; },
  width(e) {
    const W = UI.opts.artWidth || 3;
    if ((UI.opts.artMode || 'pressure') === 'pressure' && e.pointerType === 'pen') return W * Math.max(0.1, e.pressure || 0.5) * 1.6;
    return W;
  },
  move(e, p, d) {
    if (!d || !this.pts) return;
    const last = this.pts[this.pts.length - 1];
    if (G.dist(last, p) < 0.6 / App.zoom) return;
    let w = this.width(e);
    if (e.pointerType !== 'pen' && (UI.opts.artMode || 'pressure') === 'pressure') {
      // мышь: толщина зависит от скорости — быстрее тоньше
      const v = G.dist(last, p) * App.zoom / Math.max(1, performance.now() - last.t);
      w = (UI.opts.artWidth || 3) * G.clamp(1.3 - v * 0.6, 0.35, 1.3);
      w = last.w * 0.7 + w * 0.3;
    }
    this.pts.push({ x: p.x, y: p.y, w, t: performance.now() });
    UI.refresh({ panels: false, doc: false });
  },
  outline(pts) {
    const mode = UI.opts.artMode || 'pressure', W = UI.opts.artWidth || 3, ang = (UI.opts.artAngle ?? 45) * Math.PI / 180;
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], q = pts[i];
      let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      let w;
      if (mode === 'calligraphy') { const nx = Math.cos(ang), ny = Math.sin(ang); w = W * Math.max(0.12, Math.abs(tx * ny - ty * nx)); }
      else if (mode === 'preset') { const s = i / (n - 1 || 1); w = W * Math.sin(Math.PI * s) + W * 0.08; }
      else w = q.w;
      // сужение к концам
      const s = Math.min(i, n - 1 - i);
      if (mode !== 'calligraphy') w *= Math.min(1, 0.3 + s / 6);
      L.push({ x: q.x - ty * w / 2, y: q.y + tx * w / 2 }); R.push({ x: q.x + ty * w / 2, y: q.y - tx * w / 2 });
    }
    return L.concat(R.reverse());
  },
  up() {
    let pts = this.pts; this.pts = null;
    if (!pts || pts.length < 2) return UI.refresh();
    const ring = G.simplify(this.outline(pts), 0.05);
    const o = Model.make('path', { subs: [{ closed: true, nodes: G.smoothNodes(ring, true) }], name: 'Мазок кисти' });
    o.fill = { type: 'solid', color: App.defaults.stroke.color || '#000000', color2: '#ffffff', angle: 0 };
    o.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
    T2.add([o], 'Художественное оформление');
  },
  overlay(out) {
    if (!this.pts || this.pts.length < 2) return;
    out.push(`<path d="${T2.draftD(this.outline(this.pts))}Z" fill="rgba(0,0,0,.55)" stroke="none"/>`);
  },
  propbar: add => add(T2.sel('Вид', 'artMode', [['pressure', 'Нажим (перо) / скорость (мышь)'], ['calligraphy', 'Каллиграфия'], ['preset', 'Мазок-заготовка']], 'pressure'),
    T2.num('Ширина, мм', 'artWidth', 3, { min: 0.1, max: 100, step: 0.1, w: 50 }), T2.num('Угол пера, °', 'artAngle', 45, { min: -90, max: 90, w: 44 })),
};

// ======================= Умное рисование: распознавание фигур =======================
Tools.smartdraw = {
  cursor: 'crosshair',
  down(e, p) { this.pts = [p]; },
  move(e, p, d) { if (d && this.pts) { this.pts.push(p); UI.refresh({ panels: false, doc: false }); } },
  up() {
    const pts = this.pts; this.pts = null;
    if (!pts || pts.length < 3) return UI.refresh();
    const b = G.emptyBox(); pts.forEach(q => G.addPt(b, q.x, q.y));
    const w = b.x2 - b.x1, hh = b.y2 - b.y1, closed = G.dist(pts[0], pts[pts.length - 1]) < Math.max(w, hh) * 0.2;
    // прямая
    const a = pts[0], z = pts[pts.length - 1], L = G.dist(a, z) || 1;
    const dev = Math.max(...pts.map(q => Math.abs((q.x - a.x) * (z.y - a.y) - (q.y - a.y) * (z.x - a.x)) / L));
    let o;
    if (!closed && dev < L * 0.06) o = T2.path([{ closed: false, nodes: [Path.node(a.x, a.y), Path.node(z.x, z.y)] }], true), o.name = 'Линия';
    else if (closed) {
      // эллипс или прямоугольник: по заполнению рамки и отклонению от эллипса
      const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
      const ellErr = pts.reduce((s, q) => s + Math.abs(Math.hypot((q.x - cx) / (w / 2 || 1), (q.y - cy) / (hh / 2 || 1)) - 1), 0) / pts.length;
      const rectErr = pts.reduce((s, q) => s + Math.min(Math.abs(q.x - b.x1), Math.abs(q.x - b.x2), Math.abs(q.y - b.y1), Math.abs(q.y - b.y2)) / Math.max(w, hh), 0) / pts.length;
      if (rectErr < ellErr * 0.6 || rectErr < 0.03) o = Model.make('rect', { w, h: hh, m: Mx.translate(b.x1, b.y1) });
      else if (ellErr < 0.2) o = Model.make('ellipse', { w, h: hh, mode: 'ellipse', a1: 0, a2: 360, m: Mx.translate(b.x1, b.y1) });
      else { const s = G.simplify(pts, 2 / App.zoom); s.pop(); o = T2.path([{ closed: true, nodes: s.map(q => Path.node(q.x, q.y)) }]); }
    } else {
      const s = G.simplify(pts, 1.5 / App.zoom);
      o = T2.path([{ closed: false, nodes: G.smoothNodes(s, false) }], true);
    }
    T2.add([o], 'Умное рисование');
  },
  overlay(out) { if (this.pts && this.pts.length > 1) out.push(`<path class="draft" d="${T2.draftD(this.pts)}"/>`); },
  propbar: add => add(h('span', { class: 'pl muted' }, 'Рисуйте от руки: прямоугольник, эллипс и прямая распознаются автоматически')),
};

// ======================= Подсказки для инструментов без своей панели =======================
for (const [k, txt] of [['lasso', 'Обведите объекты. Shift — добавить к выделению, Alt — касание'], ['line2', 'Протяните линию. Ctrl — шаг 15°'],
  ['polyline', 'Щелчки — прямые участки, протягивание — от руки; двойной щелчок или Enter — конец'], ['curve3', 'Протяните от начала к концу, затем изогните и щёлкните'],
  ['bspline', 'Щелчки — опорные точки сплайна; двойной щелчок или Enter — конец'], ['rect3', 'Протяните сторону, затем задайте высоту и щёлкните'], ['ellipse3', 'Протяните ось, затем задайте высоту и щёлкните'],
  ['crop', 'Обведите область. Без выделения кадрируется вся страница. Двойной щелчок или Enter — применить']]) {
  if (!Tools[k].propbar) Tools[k].propbar = add => add(h('span', { class: 'pl muted' }, txt));
}
