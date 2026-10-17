// Модель документа: страницы, слои, объекты, габариты, преобразования и отрисовка в SVG.
'use strict';

const Model = {
  seq: 1,
  newId() { return 'o' + (Model.seq++); },

  newPage(w = 210, h = 297, n = 1) {
    const lid = 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4);
    return { id: 'P' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), name: 'Страница ' + n, w, h, color: '#ffffff',
      layers: [{ id: lid, name: 'Слой 1', visible: true, locked: false, objects: [] }], activeLayer: lid };
  },
  newDoc() {
    return { version: 2, name: 'Без имени', pages: [Model.newPage()], pageIndex: 0, guides: { h: [], v: [] }, grid: { size: 5 } };
  },
  // документ первой версии (одна страница) → страницы
  upgrade(d) {
    if (d.pages) return d;
    const p = { id: 'P1', name: 'Страница 1', w: (d.page || {}).w || 210, h: (d.page || {}).h || 297, color: (d.page || {}).color || '#ffffff',
      layers: d.layers || [], activeLayer: d.activeLayer };
    return { version: 2, name: d.name || 'Без имени', pages: [p], pageIndex: 0, guides: d.guides || { h: [], v: [] }, grid: d.grid || { size: 5 } };
  },

  syncSeq(doc) {
    let max = 0;
    Model.walkDoc(doc, o => { const n = parseInt(String(o.id).slice(1)); if (n > max) max = n; });
    Model.seq = Math.max(Model.seq, max + 1);
  },

  defaults() {
    return {
      fill: { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 },
      stroke: { color: '#000000', width: 0.2, dash: 'solid', cap: 'butt', join: 'miter', arrowStart: false, arrowEnd: false },
    };
  },

  // копия небольшого простого объекта (стиль заливки/абриса) — во много раз быстрее structuredClone
  dup(v) {
    if (Array.isArray(v)) return v.map(Model.dup);
    if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = Model.dup(v[k]); return o; }
    return v;
  },
  make(type, props = {}) {
    const d = App.defaults;
    const o = Object.assign({
      id: Model.newId(), type, name: '', visible: true, locked: false,
      m: Mx.id(), opacity: 1, shadow: null,
      fill: props.fill ? null : Model.dup(d.fill), stroke: props.stroke ? null : Model.dup(d.stroke),
    }, props);
    if (type === 'text') {
      if (!props.fill) o.fill = { type: 'solid', color: '#000000', color2: '#ffffff', angle: 0 };
      if (!props.stroke) o.stroke = Object.assign(Model.dup(d.stroke), { color: null });
      for (const [k, v] of Object.entries({ font: 'Arial', size: 24, bold: false, italic: false, align: 'left', lh: 1.2, ls: 0, frame: null })) if (o[k] === undefined) o[k] = v;
    }
    if (type === 'group' || type === 'blend' || type === 'powerclip') { delete o.fill; delete o.stroke; }
    return o;
  },

  typeName(o) {
    const n = {
      rect: 'Прямоугольник', ellipse: o.mode === 'pie' ? 'Сектор' : o.mode === 'arc' ? 'Дуга' : 'Эллипс',
      polygon: o.star ? 'Звезда' : 'Многоугольник', path: 'Кривая', text: o.frame ? 'Абзацный текст' : 'Фигурный текст', image: 'Изображение',
      group: 'Группа', powerclip: 'PowerClip', blend: 'Перетекание',
    };
    return n[o.type] || o.type;
  },
  label(o) {
    if (o.name) return o.name;
    if (o.type === 'text') return (o.frame ? 'Абзац: ' : 'Текст: ') + (o.text || '').split('\n')[0].slice(0, 24);
    if (o.type === 'group') return `Группа из ${o.children.length} объектов`;
    if (o.type === 'blend') return `Перетекание (${o.steps} шагов)`;
    let s = Model.typeName(o);
    if (o.type === 'path') s = `Кривая (${o.subs.reduce((n, sp) => n + sp.nodes.length, 0)} узлов)`;
    if (o.contour) s += ' + контур';
    if (o.extrude) s += ' + выдавливание';
    if (o.envelope) s += ' + оболочка';
    return s;
  },

  // ---- обход ----
  // doc — документ (все страницы) или страница (её слои)
  walkDoc(doc, fn) {
    const rec = (list, layer, parent) => {
      for (const o of list) {
        fn(o, layer, parent, list);
        if (o.children) rec(o.children, layer, o);
        if (o.container) fn(o.container, layer, o, null);
      }
    };
    const pages = doc.pages || [doc];
    for (const P of pages) for (const L of P.layers || []) rec(L.objects, L, null);
  },
  // поиск на текущей странице: { obj, list, index, layer, parent }
  find(id, page = App.pg()) {
    let res = null;
    const rec = (list, layer, parent) => {
      for (let i = 0; i < list.length && !res; i++) {
        const o = list[i];
        if (o.id === id) { res = { obj: o, list, index: i, layer, parent }; return; }
        if (o.children) rec(o.children, layer, o);
      }
    };
    for (const L of page.layers) { if (res) break; rec(L.objects, L, null); }
    return res;
  },
  get(id) { const f = Model.find(id); return f && f.obj; },
  layerOf(id) { const f = Model.find(id); return f && f.layer; },
  topLevel(page = App.pg()) {
    const out = [];
    for (const L of page.layers) for (const o of L.objects) out.push({ o, L });
    return out;
  },
  leaves(o, out = []) {
    if (o.type === 'group' || o.type === 'blend') o.children.forEach(c => Model.leaves(c, out));
    else if (o.type === 'powerclip') { out.push(o.container); o.children.forEach(c => Model.leaves(c, out)); }
    else out.push(o);
    return out;
  },

  // ---- геометрия ----
  // исходная геометрия без оболочки (локально)
  baseSubs(o) {
    switch (o.type) {
      case 'path': return o.subs;
      case 'rect': return Shapes.rect(o.w, o.h, o.r);
      case 'ellipse': return Shapes.ellipse(o.w, o.h, o.mode, o.a1, o.a2);
      case 'polygon': return Shapes.polygon(o.w, o.h, o.sides, o.star, o.inner);
      case 'image': return Shapes.rect(o.w, o.h, 0);
      case 'text': return Text.outlines(o);
      default: return null;
    }
  },
  _envCache: new WeakMap(),
  // геометрия с учётом оболочки (локально)
  toSubs(o) {
    if (!o.envelope || o.type === 'image') return Model.baseSubs(o);
    const key = JSON.stringify([o.envelope, o.subs, o.w, o.h, o.r, o.sides, o.star, o.inner, o.mode, o.a1, o.a2, o.text, o.font, o.size, o.frame, o.align, o.bold, o.italic, o.ls, o.lh]);
    const c = Model._envCache.get(o);
    if (c && c.key === key) return c.val;
    const base = Model.baseSubs(o);
    if (!base) return null; // шрифт ещё грузится — не кэшируем
    const val = Effects.warp(base, o.envelope);
    Model._envCache.set(o, { key, val });
    return val;
  },
  localBox(o) {
    switch (o.type) {
      case 'rect': case 'polygon': case 'image':
        if (o.envelope && o.type !== 'image') return Path.bbox(Model.toSubs(o));
        return { x1: 0, y1: 0, x2: o.w, y2: o.h };
      case 'ellipse':
        if (o.mode !== 'ellipse' || o.envelope) return Path.bbox(Model.toSubs(o));
        return { x1: 0, y1: 0, x2: o.w, y2: o.h };
      case 'path': return Path.bbox(Model.toSubs(o));
      case 'text': {
        if (o.envelope || o.tpath) { const s = Model.toSubs(o); if (s && s.length) return Path.bbox(s); }
        return Text.layout(o).box;
      }
      default: return G.emptyBox();
    }
  },
  // габарит в координатах документа (точный для кривых, с учётом эффектов)
  worldBox(o, pm = null) {
    const m = pm ? Mx.mul(pm, o.m) : o.m;
    let b = null;
    if (o.type === 'group' || o.type === 'blend') {
      b = G.emptyBox();
      for (const c of o.children) b = G.unionBox(b, Model.worldBox(c, m));
      return b;
    }
    if (o.type === 'powerclip') return Model.worldBox(o.container, m);
    if (['path', 'polygon'].includes(o.type) || (o.type === 'ellipse' && o.mode !== 'ellipse') || (o.envelope && o.type !== 'image')) {
      const s = Model.toSubs(o);
      if (s) { const subs = structuredClone(s); Path.transform(subs, m); b = Path.bbox(subs); }
    }
    if (!b || !G.boxValid(b)) b = G.xformBox(m, Model.localBox(o));
    if ((o.contour || o.extrude) && !pm) b = G.unionBox(b, Effects.partsBox(o));
    return b;
  },
  selBox(ids = App.sel) {
    let b = G.emptyBox();
    for (const id of ids) { const o = Model.get(id); if (o) b = G.unionBox(b, Model.worldBox(o)); }
    return G.boxValid(b) ? b : null;
  },

  // ---- преобразования ----
  // применить мировое преобразование T к объекту
  applyT(o, T) {
    if (o.type === 'group' || o.type === 'blend') { o.children.forEach(c => Model.applyT(c, T)); return; }
    if (o.type === 'powerclip') {
      Model.applyT(o.container, T); o.children.forEach(c => Model.applyT(c, T)); return;
    }
    o.m = Mx.mul(T, o.m);
    Model.normalize(o);
  },
  // перенос масштаба из матрицы в геометрию — чтобы абрис и скругления не искажались
  normalize(o) {
    if (o.type === 'text' && !o.frame) return; // фигурный текст масштабируется целиком
    const m = o.m;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.abs(m[0] * m[3] - m[1] * m[2]) / (sx || 1);
    if (sx < 1e-9 || sy < 1e-9) return;
    if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return;
    o.m = [m[0] / sx, m[1] / sx, m[2] / sy, m[3] / sy, m[4], m[5]];
    const S = Mx.scale(sx, sy);
    if (o.transp && o.transp.type === 'linear') { const t = o.transp; t.x1 *= sx; t.x2 *= sx; t.y1 *= sy; t.y2 *= sy; }
    if (o.type === 'path') Path.transform(o.subs, S);
    else if (o.type === 'text') { o.frame.w *= sx; o.frame.h *= sy; } // абзацный текст: меняется рамка, текст переливается
    else if (o.w !== undefined) {
      o.w *= sx; o.h *= sy;
      if (o.type === 'rect' && o.r) o.r = Math.min(o.r, o.w / 2, o.h / 2);
    }
    if (o.envelope) {
      // оболочка задана в локальных координатах — масштабируем её точки
      for (const k of ['tl', 'tr', 'br', 'bl', 't', 'r', 'b', 'l']) o.envelope[k] = Mx.apply(S, o.envelope[k].x, o.envelope[k].y);
      const bx = o.envelope.box, a = Mx.apply(S, bx.x1, bx.y1), c = Mx.apply(S, bx.x2, bx.y2);
      o.envelope.box = { x1: a.x, y1: a.y, x2: c.x, y2: c.y };
    }
  },
  // преобразовать в кривые (новый объект или null); текст — только с загруженным шрифтом
  toCurves(o) {
    if (o.type === 'group') {
      const g = structuredClone(o); g.children = o.children.map(c => Model.toCurves(c) || c); return g;
    }
    if (o.type === 'blend') return Model.breakBlend(o);
    if (!['rect', 'ellipse', 'polygon', 'text', 'path'].includes(o.type)) return null;
    if (o.type === 'path' && !o.envelope) return null;
    const s = Model.toSubs(o);
    if (!s) return null;
    const p = Model.make('path', { subs: structuredClone(s) });
    for (const k of ['m', 'fill', 'stroke', 'opacity', 'shadow', 'name', 'contour', 'extrude']) if (o[k] !== undefined && o[k] !== null) p[k] = structuredClone(o[k]);
    p.id = o.id;
    return p;
  },
  // мировая геометрия (матрица впечатана в узлы)
  worldSubs(o, pm = null) {
    const m = pm ? Mx.mul(pm, o.m) : o.m;
    const s = Model.toSubs(o);
    if (!s) return null;
    const c = structuredClone(s); Path.transform(c, m); return c;
  },
  // живое перетекание → обычная группа
  breakBlend(bl) {
    const items = Effects.blendItems(bl).map(x => Model.clone(x));
    const g = Model.make('group', { children: [structuredClone(bl.children[0]), ...items, structuredClone(bl.children[1])], name: bl.name || '' });
    g.id = bl.id;
    return g;
  },
  // эффекты (контур, выдавливание) → отдельные объекты в группе
  breakEffects(o) {
    const parts = Effects.parts(o);
    if (!parts) return null;
    const mk = it => Model.make('path', { subs: it.subs, fill: Object.assign({ color2: '#ffffff', angle: 0 }, it.fill), stroke: Object.assign(Model.defaults().stroke, it.stroke) });
    const base = structuredClone(o); delete base.contour; delete base.extrude;
    base.id = Model.newId();
    const g = Model.make('group', { children: [...parts.before.map(mk), base, ...parts.after.map(mk)] });
    g.id = o.id;
    return g;
  },

  clone(o) {
    const c = structuredClone(o);
    const re = x => { x.id = Model.newId(); if (x.children) x.children.forEach(re); if (x.container) re(x.container); };
    re(c);
    return c;
  },
};

// ---------- Отрисовка ----------
const Render = {
  // на холсте большие data:-картинки подменяются blob:-ссылками — браузер не разбирает их заново при каждой перерисовке
  live: false, urls: new Map(),
  url(h) {
    if (!h || h.length < 8192 || !h.startsWith('data:')) return h;
    let u = Render.urls.get(h);
    if (!u) {
      try {
        const i = h.indexOf(','), meta = h.slice(5, i), b64 = /;base64/.test(meta);
        const raw = b64 ? atob(h.slice(i + 1)) : decodeURIComponent(h.slice(i + 1));
        const a = new Uint8Array(raw.length); for (let k = 0; k < raw.length; k++) a[k] = raw.charCodeAt(k);
        u = URL.createObjectURL(new Blob([a], { type: meta.split(';')[0] || 'application/octet-stream' }));
      } catch (e) { u = h; }
      Render.urls.set(h, u);
    }
    return u;
  },
  esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

  fill(o, defs) {
    const f = o.fill;
    if (!f || f.type === 'none') return 'none';
    if (f.type === 'solid') return f.color;
    const id = 'gf_' + o.id;
    const list = f.stops && f.stops.length > 1 ? f.stops : [{ o: 0, c: f.color }, { o: 1, c: f.color2 }];
    const stops = list.map(s => `<stop offset="${s.o}" stop-color="${s.c}"/>`).join('');
    if (f.type === 'linear') defs.push(`<linearGradient id="${id}" gradientTransform="rotate(${-(f.angle || 0)} .5 .5)">${stops}</linearGradient>`);
    else defs.push(`<radialGradient id="${id}" cx="${f.cx ?? 0.5}" cy="${f.cy ?? 0.5}" r=".5">${stops}</radialGradient>`);
    return `url(#${id})`;
  },
  dash(s) {
    const w = s.width || 0.2;
    if (s.dashArray && s.dashArray.length) return s.dashArray.map(v => +(v * w).toFixed(4)).join(' ');
    if (s.dash === 'dash') return `${w * 4} ${w * 2.5}`;
    if (s.dash === 'dot') return `${w * 0.01} ${w * 2}`;
    if (s.dash === 'dashdot') return `${w * 4} ${w * 2} ${w * 0.01} ${w * 2}`;
    return null;
  },
  paintAttrs(o, defs, opt = {}) {
    let a = '';
    a += ` fill="${opt.noFill ? 'none' : Render.fill(o, defs)}"`;
    if (o.type === 'path' || o.envelope) a += ' fill-rule="evenodd"';
    const s = o.stroke;
    if (!opt.noStroke && s && s.color && s.width > 0) {
      a += ` stroke="${s.color}" stroke-width="${+s.width.toFixed(4)}"`;
      // на холсте тонкие линии не тоньше пикселя (как в CorelDRAW): ширина в мм для CSS
      if (Render.live && s.width < 0.6) { const m = o.m, k = m ? Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1 : 1; a += ` data-hl style="--sw:${+(s.width * k).toFixed(4)}"`; }
      const d = Render.dash(s);
      if (d) a += ` stroke-dasharray="${d}"`;
      const cap = s.dash === 'dot' ? 'round' : s.cap;
      if (cap && cap !== 'butt') a += ` stroke-linecap="${cap}"`;
      if (s.join && s.join !== 'miter') a += ` stroke-linejoin="${s.join}"`;
      if (o.type === 'path') {
        if (s.arrowStart) { defs.push(Render.arrowDef('as_' + o.id, s.color, true)); a += ` marker-start="url(#as_${o.id})"`; }
        if (s.arrowEnd) { defs.push(Render.arrowDef('ae_' + o.id, s.color, false)); a += ` marker-end="url(#ae_${o.id})"`; }
      }
    } else a += ' stroke="none"';
    return a;
  },
  arrowDef(id, color, start) {
    return `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 2 : 8}" refY="5" markerWidth="5" markerHeight="5" orient="auto${start ? '-start-reverse' : ''}"><path d="M0 0L10 5L0 10z" fill="${color}"/></marker>`;
  },
  // градиентная прозрачность (инструмент «Прозрачность»): маска в локальных координатах объекта
  transpMask(o, defs) {
    const t = o.transp;
    if (!t || t.type !== 'linear') return '';
    const id = 'tm_' + o.id, a = 1 - (t.from || 0) / 100, b = 1 - (t.to ?? 100) / 100;
    const g = v => `rgb(${Math.round(v * 255)},${Math.round(v * 255)},${Math.round(v * 255)})`;
    defs.push(`<linearGradient id="${id}_g" gradientUnits="userSpaceOnUse" x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"><stop offset="0" stop-color="${g(a)}"/><stop offset="1" stop-color="${g(b)}"/></linearGradient>` +
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="-100000" y="-100000" width="200000" height="200000"><rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#${id}_g)"/></mask>`);
    return ` mask="url(#${id})"`;
  },
  // разметка одного «листового» объекта без матрицы
  shape(o, defs, opt = {}) {
    const paint = Render.paintAttrs(o, defs, opt) + (opt.extra || '');
    const cls = opt.cls ? ` class="${opt.cls}"` : '';
    if (o.envelope && o.type !== 'image') {
      const s = Model.toSubs(o);
      if (s) return `<path${cls} d="${Path.toD(s)}"${paint}/>`;
    }
    switch (o.type) {
      case 'rect':
        return o.r ? `<path${cls} d="${Path.toD(Shapes.rect(o.w, o.h, o.r))}"${paint}/>`
          : `<rect${cls} width="${+o.w.toFixed(4)}" height="${+o.h.toFixed(4)}"${paint}/>`;
      case 'ellipse':
        if (o.mode === 'ellipse') return `<ellipse${cls} cx="${+(o.w / 2).toFixed(4)}" cy="${+(o.h / 2).toFixed(4)}" rx="${+(o.w / 2).toFixed(4)}" ry="${+(o.h / 2).toFixed(4)}"${paint}/>`;
        return `<path${cls} d="${Path.toD(Model.toSubs(o))}"${paint}/>`;
      case 'polygon': case 'path':
        return `<path${cls} d="${Path.toD(Model.toSubs(o))}"${paint}/>`;
      case 'text': return Text.markup(o, (cls + paint).trim());
      case 'image':
        return `<image${cls} href="${Render.live ? Render.url(o.href) : o.href}" width="${+o.w.toFixed(4)}" height="${+o.h.toFixed(4)}" preserveAspectRatio="none"/>` +
          (o.stroke && o.stroke.color && o.stroke.width > 0 ? `<rect width="${o.w}" height="${o.h}" fill="none" stroke="${o.stroke.color}" stroke-width="${o.stroke.width}"/>` : '');
    }
    return '';
  },
  // невидимый широкий контур для попадания мышью в тонкие линии
  hit(o) {
    if (o.type === 'text' && !o.envelope) return '';
    const s = Model.toSubs(o);
    if (!s) return '';
    return `<path class="hit" d="${Path.toD(s)}"/>`;
  },
  wrapAttrs(o, defs) {
    let a = '';
    if (o.opacity !== undefined && o.opacity < 1) a += ` opacity="${o.opacity}"`;
    const sh = o.shadow;
    if (sh) {
      const id = 'sh_' + o.id;
      defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${sh.dx}" dy="${sh.dy}" stdDeviation="${sh.blur}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/></filter>`);
      a += ` filter="url(#${id})"`;
    }
    return a;
  },
  // сгенерированная часть эффекта (уже в мировых координатах)
  effectPart(o, it, i, defs) {
    const fake = { id: o.id + '_e' + i, type: 'path', subs: it.subs, fill: it.fill, stroke: Object.assign({ width: 0.2 }, it.stroke) };
    return Render.shape(fake, defs, {});
  },
  obj(o, defs, opt) {
    if (!o.visible) return '';
    const idA = opt.ids ? ` data-id="${o.id}"` : '';
    const wrap = Render.wrapAttrs(o, defs);
    const tr = Mx.isId(o.m) ? '' : ` transform="${Mx.str(o.m)}"`;
    if (o.type === 'group') {
      const inner = o.children.map(c => Render.obj(c, defs, opt)).join('');
      return `<g${idA}${wrap}>${tr ? `<g${tr}>${inner}</g>` : inner}</g>`;
    }
    if (o.type === 'blend') {
      const [A, B] = o.children;
      const mid = Effects.blendItems(o).map(x => Render.obj(x, defs, { ids: false })).join('');
      return `<g${idA}${wrap}>${Render.obj(A, defs, opt)}<g class="blend-steps">${mid}</g>${Render.obj(B, defs, opt)}</g>`;
    }
    if (o.type === 'powerclip') {
      const c = o.container, cid = 'pc_' + o.id;
      const ctr = Mx.isId(c.m) ? '' : ` transform="${Mx.str(c.m)}"`;
      defs.push(`<clipPath id="${cid}">${Render.shape(c, [], { noStroke: true, extra: ctr })}</clipPath>`);
      const body = `<g${ctr}>${Render.shape(c, defs, { noStroke: true })}</g>` +
        `<g clip-path="url(#${cid})">${o.children.map(ch => Render.obj(ch, defs, opt)).join('')}</g>` +
        `<g${ctr}>${Render.shape(c, defs, { noFill: true })}${opt.ids ? Render.hit(c) : ''}</g>`;
      return `<g${idA}${wrap}>${tr ? `<g${tr}>${body}</g>` : body}</g>`;
    }
    let pre = '', post = '';
    if (o.contour || o.extrude) {
      const parts = Effects.parts(o);
      if (parts) {
        pre = parts.before.map((it, i) => Render.effectPart(o, it, 'b' + i, defs)).join('');
        post = parts.after.map((it, i) => Render.effectPart(o, it, 'a' + i, defs)).join('');
      }
    }
    const body = Render.shape(o, defs, { cls: 'shape' }) + (opt.ids ? Render.hit(o) : '');
    return `<g${idA}${wrap}>${pre}<g${tr}${Render.transpMask(o, defs)}>${body}</g>${post}</g>`;
  },
  // page — страница или любой объект со слоями
  layers(page, opt = {}) {
    const defs = [];
    let body = '';
    for (const L of page.layers) {
      if (!L.visible || (opt.print && L.noPrint && !(opt.frames && L.frame))) continue;
      body += `<g${opt.ids ? ` data-layer="${L.id}"` : ''}>` + L.objects.map(o => Render.obj(o, defs, opt)).join('') + '</g>';
    }
    return { defs: defs.join(''), body };
  },
  // самостоятельный SVG-файл страницы
  exportSVG(page, opt = {}) {
    const { w, h, color } = page;
    const { defs, body } = Render.layers(page, { print: true, frames: opt.frames });
    const fonts = opt.embedFonts !== false ? Fonts.cssFor(page) : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
      (fonts ? `<style>${fonts}</style>\n` : '') +
      `<defs>${defs}</defs>\n` +
      (opt.background !== false && color ? `<rect width="${w}" height="${h}" fill="${color}"/>\n` : '') +
      body + '\n</svg>\n';
  },
};
