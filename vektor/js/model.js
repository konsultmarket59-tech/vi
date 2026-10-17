// Модель документа: слои, объекты, габариты, преобразования и отрисовка в SVG.
'use strict';

const PT_MM = 25.4 / 72; // 1 пункт в мм

const Model = {
  seq: 1,
  newId() { return 'o' + (Model.seq++); },

  newDoc() {
    return {
      version: 1,
      name: 'Без имени',
      page: { w: 210, h: 297, color: '#ffffff' },
      layers: [{ id: 'L1', name: 'Слой 1', visible: true, locked: false, objects: [] }],
      activeLayer: 'L1',
      guides: { h: [], v: [] },
      grid: { size: 5 },
    };
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

  make(type, props) {
    const d = App.defaults;
    const o = Object.assign({
      id: Model.newId(), type, name: '', visible: true, locked: false,
      m: Mx.id(), opacity: 1, shadow: null,
      fill: structuredClone(d.fill), stroke: structuredClone(d.stroke),
    }, props);
    if (type === 'text' && !props.fill) {
      o.fill = { type: 'solid', color: '#000000', color2: '#ffffff', angle: 0 };
      o.stroke = Object.assign(structuredClone(d.stroke), { color: null });
    }
    return o;
  },

  typeName(o) {
    const n = {
      rect: 'Прямоугольник', ellipse: o.mode === 'pie' ? 'Сектор' : o.mode === 'arc' ? 'Дуга' : 'Эллипс',
      polygon: o.star ? 'Звезда' : 'Многоугольник', path: 'Кривая', text: 'Текст', image: 'Изображение',
      group: 'Группа', powerclip: 'PowerClip',
    };
    return n[o.type] || o.type;
  },
  label(o) {
    if (o.name) return o.name;
    if (o.type === 'text') return 'Текст: ' + (o.text || '').split('\n')[0].slice(0, 24);
    if (o.type === 'group') return `Группа из ${o.children.length} объектов`;
    if (o.type === 'path') {
      const n = o.subs.reduce((s, sp) => s + sp.nodes.length, 0);
      return `Кривая (${n} узлов)`;
    }
    return Model.typeName(o);
  },

  // ---- обход ----
  walkDoc(doc, fn) {
    const rec = (list, layer, parent) => {
      for (const o of list) {
        fn(o, layer, parent, list);
        if (o.children) rec(o.children, layer, o);
        if (o.container) fn(o.container, layer, o, null);
      }
    };
    for (const L of doc.layers) rec(L.objects, L, null);
  },
  // { obj, list, index, layer, parent }
  find(id, doc = App.doc) {
    let res = null;
    const rec = (list, layer, parent) => {
      for (let i = 0; i < list.length && !res; i++) {
        const o = list[i];
        if (o.id === id) { res = { obj: o, list, index: i, layer, parent }; return; }
        if (o.children) rec(o.children, layer, o);
      }
    };
    for (const L of doc.layers) { if (res) break; rec(L.objects, L, null); }
    return res;
  },
  get(id) { const f = Model.find(id); return f && f.obj; },
  layerOf(id) { const f = Model.find(id); return f && f.layer; },
  topLevel() {
    const out = [];
    for (const L of App.doc.layers) for (const o of L.objects) out.push({ o, L });
    return out;
  },
  leaves(o, out = []) {
    if (o.type === 'group') o.children.forEach(c => Model.leaves(c, out));
    else if (o.type === 'powerclip') { out.push(o.container); o.children.forEach(c => Model.leaves(c, out)); }
    else out.push(o);
    return out;
  },

  // ---- габариты ----
  localBox(o) {
    switch (o.type) {
      case 'rect': case 'ellipse': case 'polygon': case 'image':
        if (o.type === 'ellipse' && o.mode !== 'ellipse') return Path.bbox(Model.toSubs(o));
        return { x1: 0, y1: 0, x2: o.w, y2: o.h };
      case 'path': return Path.bbox(o.subs);
      case 'text': return Model.measureText(o);
      default: return G.emptyBox();
    }
  },
  // габарит в координатах документа (точный для кривых)
  worldBox(o, pm = null) {
    const m = pm ? Mx.mul(pm, o.m) : o.m;
    if (o.type === 'group') {
      let b = G.emptyBox();
      for (const c of o.children) b = G.unionBox(b, Model.worldBox(c, m));
      return b;
    }
    if (o.type === 'powerclip') return Model.worldBox(o.container, m);
    if (o.type === 'path' || o.type === 'ellipse' && o.mode !== 'ellipse' || o.type === 'polygon') {
      const subs = structuredClone(Model.toSubs(o)); Path.transform(subs, m); return Path.bbox(subs);
    }
    return G.xformBox(m, Model.localBox(o));
  },
  selBox(ids = App.sel) {
    let b = G.emptyBox();
    for (const id of ids) { const o = Model.get(id); if (o) b = G.unionBox(b, Model.worldBox(o)); }
    return G.boxValid(b) ? b : null;
  },

  _measure: null, _mcache: new Map(),
  measureText(o) {
    const key = [o.text, o.font, o.size, o.bold, o.italic, o.align, o.lh].join('|');
    if (Model._mcache.has(key)) return Object.assign({}, Model._mcache.get(key));
    if (!Model._measure) {
      Model._measure = document.getElementById('measure');
    }
    Model._measure.innerHTML = Render.textMarkup(o, 'fill="#000"');
    let b;
    try {
      const r = Model._measure.firstChild.getBBox();
      b = { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height };
      if (!r.width && !r.height) throw 0;
    } catch (e) {
      const fs = o.size * PT_MM; b = { x1: 0, y1: 0, x2: fs * 0.6, y2: fs * 1.2 };
    }
    if (Model._mcache.size > 500) Model._mcache.clear();
    Model._mcache.set(key, b);
    return Object.assign({}, b);
  },

  // ---- преобразования ----
  // применить мировое преобразование T к объекту
  applyT(o, T) {
    if (o.type === 'group') { o.children.forEach(c => Model.applyT(c, T)); return; }
    if (o.type === 'powerclip') {
      Model.applyT(o.container, T); o.children.forEach(c => Model.applyT(c, T)); return;
    }
    o.m = Mx.mul(T, o.m);
    Model.normalize(o);
  },
  // перенос масштаба из матрицы в геометрию — чтобы абрис и скругления не искажались
  normalize(o) {
    if (o.type === 'text') return;
    const m = o.m;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.abs(m[0] * m[3] - m[1] * m[2]) / (sx || 1);
    if (sx < 1e-9 || sy < 1e-9) return;
    if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) return;
    o.m = [m[0] / sx, m[1] / sx, m[2] / sy, m[3] / sy, m[4], m[5]];
    if (o.type === 'path') Path.transform(o.subs, Mx.scale(sx, sy));
    else if (o.w !== undefined) {
      o.w *= sx; o.h *= sy;
      if (o.type === 'rect' && o.r) o.r = Math.min(o.r, o.w / 2, o.h / 2);
    }
  },
  // геометрия любого объекта как набор контуров (локально)
  toSubs(o) {
    switch (o.type) {
      case 'path': return o.subs;
      case 'rect': return Shapes.rect(o.w, o.h, o.r);
      case 'ellipse': return Shapes.ellipse(o.w, o.h, o.mode, o.a1, o.a2);
      case 'polygon': return Shapes.polygon(o.w, o.h, o.sides, o.star, o.inner);
      case 'image': return Shapes.rect(o.w, o.h, 0);
      default: return null;
    }
  },
  // преобразовать в кривые (возвращает новый объект или null)
  toCurves(o) {
    if (o.type === 'group') {
      const g = structuredClone(o); g.children = o.children.map(c => Model.toCurves(c) || c); return g;
    }
    if (!['rect', 'ellipse', 'polygon'].includes(o.type)) return null;
    const subs = structuredClone(Model.toSubs(o));
    const p = Model.make('path', { subs });
    for (const k of ['m', 'fill', 'stroke', 'opacity', 'shadow', 'name']) p[k] = structuredClone(o[k]);
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

  clone(o) {
    const c = structuredClone(o);
    const re = x => { x.id = Model.newId(); if (x.children) x.children.forEach(re); if (x.container) re(x.container); };
    re(c);
    return c;
  },
};

// ---------- Отрисовка ----------
const Render = {
  esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },

  fill(o, defs) {
    const f = o.fill;
    if (!f || f.type === 'none') return 'none';
    if (f.type === 'solid') return f.color;
    const id = 'gf_' + o.id;
    const stops = `<stop offset="0" stop-color="${f.color}"/><stop offset="1" stop-color="${f.color2}"/>`;
    if (f.type === 'linear') defs.push(`<linearGradient id="${id}" gradientTransform="rotate(${-(f.angle || 0)} .5 .5)">${stops}</linearGradient>`);
    else defs.push(`<radialGradient id="${id}" cx=".5" cy=".5" r=".5">${stops}</radialGradient>`);
    return `url(#${id})`;
  },
  dash(s) {
    const w = s.width || 0.2;
    if (s.dash === 'dash') return `${w * 4} ${w * 2.5}`;
    if (s.dash === 'dot') return `${w * 0.01} ${w * 2}`;
    if (s.dash === 'dashdot') return `${w * 4} ${w * 2} ${w * 0.01} ${w * 2}`;
    return null;
  },
  paintAttrs(o, defs, opt = {}) {
    let a = '';
    a += ` fill="${opt.noFill ? 'none' : Render.fill(o, defs)}"`;
    if (o.type === 'path') a += ' fill-rule="evenodd"';
    const s = o.stroke;
    if (!opt.noStroke && s && s.color && s.width > 0) {
      a += ` stroke="${s.color}" stroke-width="${+s.width.toFixed(4)}"`;
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
  textMarkup(o, attrs) {
    const fs = o.size * PT_MM, lh = (o.lh || 1.2) * fs;
    const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
    const lines = String(o.text || '').split('\n');
    const fam = Render.esc(o.font || 'Arial');
    let s = `<text ${attrs} font-family="${fam}" font-size="${+fs.toFixed(4)}"` +
      (o.bold ? ' font-weight="bold"' : '') + (o.italic ? ' font-style="italic"' : '') +
      (anchor !== 'start' ? ` text-anchor="${anchor}"` : '') + ' xml:space="preserve">';
    lines.forEach((ln, i) => { s += `<tspan x="0" y="${+(fs * 0.85 + i * lh).toFixed(4)}">${Render.esc(ln) || ' '}</tspan>`; });
    return s + '</text>';
  },
  // разметка одного «листового» объекта без матрицы
  shape(o, defs, opt = {}) {
    const paint = Render.paintAttrs(o, defs, opt) + (opt.extra || '');
    const cls = opt.cls ? ` class="${opt.cls}"` : '';
    switch (o.type) {
      case 'rect':
        return o.r ? `<path${cls} d="${Path.toD(Shapes.rect(o.w, o.h, o.r))}"${paint}/>`
          : `<rect${cls} width="${+o.w.toFixed(4)}" height="${+o.h.toFixed(4)}"${paint}/>`;
      case 'ellipse':
        if (o.mode === 'ellipse') return `<ellipse${cls} cx="${+(o.w / 2).toFixed(4)}" cy="${+(o.h / 2).toFixed(4)}" rx="${+(o.w / 2).toFixed(4)}" ry="${+(o.h / 2).toFixed(4)}"${paint}/>`;
        return `<path${cls} d="${Path.toD(Model.toSubs(o))}"${paint}/>`;
      case 'polygon': case 'path':
        return `<path${cls} d="${Path.toD(Model.toSubs(o))}"${paint}/>`;
      case 'text': return Render.textMarkup(o, (cls + paint).trim());
      case 'image':
        return `<image${cls} href="${o.href}" width="${+o.w.toFixed(4)}" height="${+o.h.toFixed(4)}" preserveAspectRatio="none"/>` +
          (o.stroke && o.stroke.color && o.stroke.width > 0 ? `<rect width="${o.w}" height="${o.h}" fill="none" stroke="${o.stroke.color}" stroke-width="${o.stroke.width}"/>` : '');
    }
    return '';
  },
  // невидимый широкий контур для попадания мышью в тонкие линии
  hit(o) {
    const d = o.type === 'text' ? null : Path.toD(Model.toSubs(o) || []);
    if (!d) return '';
    return `<path class="hit" d="${d}"/>`;
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
  obj(o, defs, opt) {
    if (!o.visible) return '';
    const idA = opt.ids ? ` data-id="${o.id}"` : '';
    const wrap = Render.wrapAttrs(o, defs);
    const tr = Mx.isId(o.m) ? '' : ` transform="${Mx.str(o.m)}"`;
    if (o.type === 'group') {
      const inner = o.children.map(c => Render.obj(c, defs, opt)).join('');
      return `<g${idA}${wrap}>${tr ? `<g${tr}>${inner}</g>` : inner}</g>`;
    }
    if (o.type === 'powerclip') {
      const c = o.container, cid = 'pc_' + o.id;
      const ctr = Mx.isId(c.m) ? '' : ` transform="${Mx.str(c.m)}"`;
      defs.push(`<clipPath id="${cid}">${Render.shape(c, [], { noStroke: true, extra: ctr }).replace(/ fill="[^"]*"/, '')}</clipPath>`);
      const body = `<g${ctr}>${Render.shape(c, defs, { noStroke: true })}</g>` +
        `<g clip-path="url(#${cid})">${o.children.map(ch => Render.obj(ch, defs, opt)).join('')}</g>` +
        `<g${ctr}>${Render.shape(c, defs, { noFill: true })}${opt.ids ? Render.hit(c) : ''}</g>`;
      return `<g${idA}${wrap}>${tr ? `<g${tr}>${body}</g>` : body}</g>`;
    }
    const body = Render.shape(o, defs, { cls: 'shape' }) + (opt.ids ? Render.hit(o) : '');
    return `<g${idA}${wrap}><g${tr}>${body}</g></g>`;
  },
  layers(doc, opt = {}) {
    const defs = [];
    let body = '';
    for (const L of doc.layers) {
      if (!L.visible) continue;
      body += `<g${opt.ids ? ` data-layer="${L.id}"` : ''}>` + L.objects.map(o => Render.obj(o, defs, opt)).join('') + '</g>';
    }
    return { defs: defs.join(''), body };
  },
  // самостоятельный SVG-файл страницы
  exportSVG(doc, opt = {}) {
    const { w, h, color } = doc.page;
    const { defs, body } = Render.layers(doc, {});
    const fonts = opt.embedFonts !== false ? Fonts.cssFor(doc) : '';
    return `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"${opt.pxW ? '' : ''}>\n` +
      (fonts ? `<style>${fonts}</style>\n` : '') +
      `<defs>${defs}</defs>\n` +
      (opt.background !== false && color ? `<rect width="${w}" height="${h}" fill="${color}"/>\n` : '') +
      body + '\n</svg>\n';
  },
};

// ---------- Шрифты ----------
const Fonts = {
  system: ['Arial', 'Times New Roman', 'Verdana', 'Georgia', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'Segoe UI', 'Calibri', 'Cambria'],
  embedded() { return (window.VK_FONTS || []).map(f => f.family); },
  all() { return Fonts.embedded().concat(Fonts.system); },
  load() {
    for (const f of window.VK_FONTS || []) {
      try {
        const bin = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
        const ff = new FontFace(f.family, bin.buffer);
        document.fonts.add(ff);
        ff.load().then(() => { Model._mcache.clear(); if (typeof UI !== 'undefined' && App.doc) UI.refresh(); }).catch(() => {});
      } catch (e) { console.warn('шрифт', f.family, e); }
    }
  },
  // @font-face для шрифтов, которые использованы в документе
  cssFor(doc) {
    const used = new Set();
    Model.walkDoc(doc, o => { if (o.type === 'text') used.add(o.font); });
    return (window.VK_FONTS || []).filter(f => used.has(f.family))
      .map(f => `@font-face{font-family:"${f.family}";src:url(data:font/${f.format === 'woff2' ? 'woff2' : 'ttf'};base64,${f.data}) format("${f.format}");}`).join('');
  },
};
