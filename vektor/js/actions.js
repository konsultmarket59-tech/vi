// Команды меню: правка, упорядочивание, группы, выравнивание, формирование, PowerClip, перетекание.
'use strict';

const Actions = {
  need(n = 1, msg) {
    if (App.sel.length < n) { UI.toast(msg || (n === 1 ? 'Сначала выделите объект' : `Выделите не меньше ${n} объектов`)); return false; }
    return true;
  },
  undo() { App.undo(); },
  redo() { App.redo(); },

  newDoc() {
    UI.confirm('Создать новый документ? Несохранённые изменения будут потеряны.', () => {
      App.doc = Model.newDoc(); App.sel = []; App.fileName = null; App.dirty = false;
      App.history = [JSON.stringify(App.doc)]; App.hpos = 0;
      App.autosave(); App.zoomPage(); UI.refresh();
    });
  },

  // удаление из списков
  removeIds(ids) {
    for (const id of ids) { const f = Model.find(id); if (f) f.list.splice(f.list.indexOf(f.obj), 1); }
  },
  del() {
    if (!App.sel.length) return;
    Actions.removeIds(App.sel); App.sel = []; App.commit('Удаление');
  },
  selectAll() {
    const ids = [];
    for (const L of App.doc.layers) if (L.visible && !L.locked) for (const o of L.objects) if (!o.locked && o.visible) ids.push(o.id);
    App.setSel(ids);
  },
  cycle(dir) {
    const all = Model.topLevel().filter(({ o, L }) => L.visible && !L.locked && o.visible && !o.locked).map(x => x.o.id);
    if (!all.length) return;
    let i = App.sel.length ? all.indexOf(App.sel[0]) : -1;
    i = (i + dir + all.length) % all.length;
    App.setSel([all[i]]);
  },
  // вставить объекты в активный слой поверх
  insert(objs, select = true) {
    const L = App.activeLayer();
    L.objects.push(...objs);
    if (select) App.sel = objs.map(o => o.id);
    App.rotateMode = false;
  },
  duplicate() {
    if (!Actions.need()) return;
    const copies = App.selObjs().map(o => { const c = Model.clone(o); Model.applyT(c, Mx.translate(App.dupOffset, App.dupOffset)); return c; });
    Actions.placeAfter(copies);
    App.commit('Дублирование');
  },
  duplicateInPlace() {
    if (!Actions.need()) return;
    Actions.placeAfter(App.selObjs().map(o => Model.clone(o)));
    App.commit('Копия на месте');
  },
  // копии ставятся сразу над оригиналами
  placeAfter(copies) {
    App.sel.forEach((id, i) => {
      const f = Model.find(id);
      f.list.splice(f.list.indexOf(f.obj) + 1, 0, copies[i]);
    });
    App.sel = copies.map(c => c.id);
  },

  // ---- буфер обмена ----
  copy() {
    if (!App.sel.length) return false;
    App.clipboard = JSON.stringify(App.selObjs());
    return true;
  },
  toSystemClipboard(e) {
    try {
      e.clipboardData.setData('application/x-vektor', App.clipboard);
      const doc = { ...App.doc, layers: [{ id: 'c', name: 'c', visible: true, objects: JSON.parse(App.clipboard) }] };
      const b = Model.selBox();
      let svg = Render.exportSVG(doc, { background: false });
      if (b) svg = svg.replace(/width="[^"]*mm" height="[^"]*mm" viewBox="[^"]*"/, `width="${(b.x2 - b.x1).toFixed(2)}mm" height="${(b.y2 - b.y1).toFixed(2)}mm" viewBox="${b.x1} ${b.y1} ${b.x2 - b.x1} ${b.y2 - b.y1}"`);
      e.clipboardData.setData('text/plain', svg);
      e.clipboardData.setData('image/svg+xml', svg);
    } catch (err) { /* системный буфер недоступен — остаётся внутренний */ }
  },
  paste(json = App.clipboard) {
    if (!json) return UI.toast('Буфер обмена пуст');
    let objs;
    try { objs = JSON.parse(json); } catch (e) { return; }
    objs = objs.map(o => Model.clone(o));
    Actions.insert(objs);
    App.commit('Вставка');
  },
  pasteEvent(e) {
    const cd = e.clipboardData;
    const own = cd && cd.getData('application/x-vektor');
    if (own) return Actions.paste(own);
    if (cd) {
      for (const it of cd.items) {
        if (it.kind === 'file' && /^image\//.test(it.type)) { IO.importFile(it.getAsFile()); return; }
      }
      const txt = cd.getData('text/plain');
      if (txt && /<svg[\s>]/i.test(txt)) { IO.importSVGText(txt); return; }
      if (txt && !App.clipboard) {
        // обычный текст — создаём фигурный текст в центре страницы
        const o = Model.make('text', { text: txt.slice(0, 2000), font: 'Arial', size: 24, align: 'left', bold: false, italic: false, lh: 1.2 });
        o.m = Mx.translate(App.doc.page.w / 4, App.doc.page.h / 4);
        Actions.insert([o]); App.commit('Вставка текста'); return;
      }
    }
    Actions.paste();
  },
  cut() { if (Actions.copy()) Actions.del(); },

  // ---- порядок ----
  order(how) {
    if (!Actions.need()) return;
    // по слоям, сохраняя взаимный порядок выбранных
    const groups = new Map();
    for (const id of App.sel) { const f = Model.find(id); if (!groups.has(f.list)) groups.set(f.list, []); groups.get(f.list).push(f.obj); }
    for (const [list, objs] of groups) {
      objs.sort((a, b) => list.indexOf(a) - list.indexOf(b));
      if (how === 'front' || how === 'back') {
        for (const o of objs) list.splice(list.indexOf(o), 1);
        how === 'front' ? list.push(...objs) : list.unshift(...objs);
      } else if (how === 'up') {
        for (let i = objs.length - 1; i >= 0; i--) {
          const k = list.indexOf(objs[i]);
          if (k < list.length - 1 && !objs.includes(list[k + 1])) { list.splice(k, 1); list.splice(k + 1, 0, objs[i]); }
        }
      } else if (how === 'down') {
        for (const o of objs) {
          const k = list.indexOf(o);
          if (k > 0 && !objs.includes(list[k - 1])) { list.splice(k, 1); list.splice(k - 1, 0, o); }
        }
      } else if (how === 'reverse') {
        const idx = objs.map(o => list.indexOf(o)).sort((a, b) => a - b);
        const rev = objs.slice().reverse();
        idx.forEach((k, i) => { list[k] = rev[i]; });
      }
    }
    App.commit('Порядок');
  },
  moveToLayer(layerId) {
    if (!Actions.need()) return;
    const L = App.doc.layers.find(l => l.id === layerId);
    const objs = App.selObjs();
    Actions.removeIds(App.sel);
    L.objects.push(...objs);
    App.commit('На другой слой');
  },

  // ---- группы ----
  group() {
    if (!Actions.need(2, 'Для группы выделите два объекта или больше')) return;
    const objs = Actions.zSorted();
    const top = objs[objs.length - 1];
    const list = Model.find(top.id).list;
    // группа встаёт на место верхнего объекта (с поправкой на изъятые ниже него)
    const at = list.indexOf(top) - objs.filter(o => o !== top && list.includes(o)).length;
    Actions.removeIds(objs.map(o => o.id));
    const g = Model.make('group', { children: objs });
    delete g.fill; delete g.stroke;
    list.splice(at, 0, g);
    App.sel = [g.id]; App.commit('Группа');
  },
  // выбранные объекты в порядке «снизу вверх»
  zSorted(ids = App.sel) {
    const order = [];
    Model.walkDoc(App.doc, o => order.push(o.id));
    return ids.map(id => Model.get(id)).filter(Boolean).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  },
  ungroup() {
    const gs = App.selObjs().filter(o => o.type === 'group');
    if (!gs.length) return UI.toast('Выделите группу');
    const ids = [];
    for (const g of gs) {
      const f = Model.find(g.id);
      f.list.splice(f.list.indexOf(g), 1, ...g.children);
      ids.push(...g.children.map(c => c.id));
    }
    App.sel = ids.concat(App.sel.filter(id => !gs.find(g => g.id === id) && Model.find(id)));
    App.commit('Отмена группы');
  },
  ungroupAll() {
    let any = true, n = 0;
    while (any) {
      any = false;
      for (const o of App.selObjs()) if (o.type === 'group') { any = true; n++; }
      if (any) { const before = App.sel.slice(); Actions.ungroup(); if (App.sel.join() === before.join()) break; }
    }
    if (!n) UI.toast('Выделите группу');
  },

  // ---- кривые ----
  toCurves() {
    if (!Actions.need()) return;
    let n = 0, skipped = 0;
    for (const id of App.sel) {
      const f = Model.find(id), c = Model.toCurves(f.obj);
      if (c) { f.list[f.list.indexOf(f.obj)] = c; n++; } else if (f.obj.type !== 'path') skipped++;
    }
    if (skipped) UI.toast('Текст и изображения в кривые не переводятся: нужен исходный шрифт');
    if (n) App.commit('Преобразовать в кривые');
  },
  combine() {
    if (!Actions.need(2, 'Выделите два объекта или больше')) return;
    const objs = Actions.zSorted();
    const subs = [];
    for (const o of objs) for (const leaf of Model.leaves(o)) {
      const s = Model.worldSubs(leaf);
      if (s) subs.push(...s);
    }
    if (!subs.length) return;
    const base = objs[0];
    const leaf0 = Model.leaves(base)[0];
    const p = Model.make('path', { subs, fill: structuredClone(leaf0.fill), stroke: structuredClone(leaf0.stroke), opacity: leaf0.opacity });
    const f = Model.find(objs[objs.length - 1].id);
    f.list.splice(f.list.indexOf(f.obj) + 1, 0, p);
    Actions.removeIds(objs.map(o => o.id));
    App.sel = [p.id]; App.commit('Объединение');
  },
  breakApart() {
    const ps = App.selObjs().filter(o => o.type === 'path' && o.subs.length > 1);
    if (!ps.length) return UI.toast('Выделите объединённую кривую (из нескольких контуров)');
    const ids = [];
    for (const p of ps) {
      const f = Model.find(p.id), at = f.list.indexOf(p);
      const parts = p.subs.map(sp => { const c = structuredClone(p); c.id = Model.newId(); c.subs = [sp]; return c; });
      f.list.splice(at, 1, ...parts);
      ids.push(...parts.map(c => c.id));
    }
    App.sel = ids; App.commit('Разъединение');
  },

  // ---- зеркало / поворот ----
  mirror(h) {
    if (!Actions.need()) return;
    const b = Model.selBox(), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    App.selObjs().forEach(o => Model.applyT(o, h ? Mx.scale(-1, 1, cx, cy) : Mx.scale(1, -1, cx, cy)));
    App.commit('Зеркало');
  },
  rotate(deg) {
    if (!Actions.need()) return;
    const b = Model.selBox(), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    App.selObjs().forEach(o => Model.applyT(o, Mx.rotate(deg, cx, cy)));
    App.commit('Поворот');
  },
  clearTransform() {
    if (!Actions.need()) return;
    for (const o of App.selObjs()) {
      if (o.type === 'group' || o.type === 'powerclip') continue;
      const b = Model.worldBox(o), c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
      const lb = Model.localBox(o);
      o.m = Mx.translate(c.x - (lb.x1 + lb.x2) / 2, c.y - (lb.y1 + lb.y2) / 2);
    }
    App.commit('Сброс преобразований');
  },

  // ---- выравнивание и распределение ----
  // по умолчанию — по последнему выделенному (как в CorelDRAW); один объект — по странице
  align(how, to) {
    if (!Actions.need()) return;
    const objs = App.selObjs();
    let ref;
    if (!to) to = objs.length === 1 ? 'page' : 'last';
    if (to === 'page') ref = { x1: 0, y1: 0, x2: App.doc.page.w, y2: App.doc.page.h };
    else if (to === 'last') ref = Model.worldBox(objs[objs.length - 1]);
    else if (to === 'first') ref = Model.worldBox(objs[0]);
    else ref = Model.selBox();
    for (const o of objs) {
      const b = Model.worldBox(o);
      let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x1 - b.x1;
      if (how === 'right') dx = ref.x2 - b.x2;
      if (how === 'hcenter') dx = (ref.x1 + ref.x2) / 2 - (b.x1 + b.x2) / 2;
      if (how === 'top') dy = ref.y1 - b.y1;
      if (how === 'bottom') dy = ref.y2 - b.y2;
      if (how === 'vcenter') dy = (ref.y1 + ref.y2) / 2 - (b.y1 + b.y2) / 2;
      if (dx || dy) Model.applyT(o, Mx.translate(dx, dy));
    }
    App.commit('Выравнивание');
  },
  centerPage() {
    if (!Actions.need()) return;
    const b = Model.selBox();
    const T = Mx.translate(App.doc.page.w / 2 - (b.x1 + b.x2) / 2, App.doc.page.h / 2 - (b.y1 + b.y2) / 2);
    App.selObjs().forEach(o => Model.applyT(o, T));
    App.commit('По центру страницы');
  },
  distribute(how) {
    if (!Actions.need(3, 'Для распределения выделите три объекта или больше')) return;
    const items = App.selObjs().map(o => ({ o, b: Model.worldBox(o) }));
    const horiz = ['left', 'hcenter', 'right', 'hspace'].includes(how);
    const key = { left: b => b.x1, hcenter: b => (b.x1 + b.x2) / 2, right: b => b.x2, top: b => b.y1, vcenter: b => (b.y1 + b.y2) / 2, bottom: b => b.y2, hspace: b => b.x1, vspace: b => b.y1 }[how];
    items.sort((a, b) => key(a.b) - key(b.b));
    const n = items.length;
    if (how === 'hspace' || how === 'vspace') {
      const size = b => horiz ? b.x2 - b.x1 : b.y2 - b.y1;
      const start = horiz ? items[0].b.x1 : items[0].b.y1;
      const end = horiz ? Math.max(...items.map(i => i.b.x2)) : Math.max(...items.map(i => i.b.y2));
      const total = items.reduce((s, i) => s + size(i.b), 0);
      const gap = (end - start - total) / (n - 1);
      let pos = start;
      for (const it of items) {
        const d = pos - (horiz ? it.b.x1 : it.b.y1);
        Model.applyT(it.o, horiz ? Mx.translate(d, 0) : Mx.translate(0, d));
        pos += size(it.b) + gap;
      }
    } else {
      const a = key(items[0].b), z = key(items[n - 1].b);
      items.forEach((it, i) => {
        const d = a + (z - a) * i / (n - 1) - key(it.b);
        Model.applyT(it.o, horiz ? Mx.translate(d, 0) : Mx.translate(0, d));
      });
    }
    App.commit('Распределение');
  },

  // ---- формирование (сварка, обрезка, пересечение) ----
  toPolys(o) {
    const out = [];
    for (const leaf of Model.leaves(o)) {
      const subs = Model.worldSubs(leaf);
      if (!subs) continue;
      for (const sp of Path.flatten(subs, null, 24)) {
        if (sp.pts.length < 3) continue;
        const ring = sp.pts.map(p => [p.x, p.y]); ring.push(ring[0].slice());
        out.push([ring]);
      }
    }
    // контуры одного объекта объединяем по чёт-нечётному правилу через XOR
    if (!out.length) return null;
    try { return out.length === 1 ? out : polygonClipping.xor(...out); } catch (e) { return out; }
  },
  fromPolys(mp, styleFrom) {
    const subs = [];
    for (const poly of mp) for (const ring of poly) {
      const pts = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
      const s = G.simplify(pts.concat([pts[0]]), 0.01).slice(0, -1);
      if (s.length >= 3) subs.push({ closed: true, nodes: s.map(p => Path.node(p.x, p.y)) });
    }
    if (!subs.length) return null;
    const leaf = Model.leaves(styleFrom)[0];
    return Model.make('path', { subs, fill: structuredClone(leaf.fill), stroke: structuredClone(leaf.stroke), opacity: leaf.opacity });
  },
  shaping(op) {
    if (!Actions.need(2, 'Для формирования выделите два объекта или больше')) return;
    if (typeof polygonClipping === 'undefined') return UI.toast('Библиотека формирования не загружена');
    const objs = Actions.zSorted();
    const polys = objs.map(o => Actions.toPolys(o));
    if (polys.some(p => !p)) return UI.toast('Текст и изображения нельзя использовать в формировании');
    let res, style, keep = false;
    const bottom = objs[0], top = objs[objs.length - 1];
    try {
      if (op === 'weld') { res = polygonClipping.union(...polys); style = bottom; }
      else if (op === 'intersect') { res = polygonClipping.intersection(...polys); style = bottom; keep = true; }
      else if (op === 'trim') { res = polygonClipping.difference(polys[0], ...polys.slice(1)); style = bottom; }
      else if (op === 'frontMinusBack') { res = polygonClipping.difference(polys[polys.length - 1], ...polys.slice(0, -1)); style = top; }
      else if (op === 'backMinusFront') { res = polygonClipping.difference(polys[0], ...polys.slice(1)); style = bottom; }
    } catch (e) { console.error(e); return UI.toast('Не удалось выполнить формирование'); }
    const p = res && res.length ? Actions.fromPolys(res, style) : null;
    if (!p) return UI.toast('Результат пустой — объекты не пересекаются');
    if (op === 'trim') {
      // обрезка: нижний объект заменяется результатом, остальные остаются
      const f = Model.find(bottom.id); f.list[f.list.indexOf(bottom)] = p; p.id = bottom.id;
      App.sel = [p.id];
    } else if (keep) {
      const f = Model.find(top.id); f.list.splice(f.list.indexOf(top) + 1, 0, p); App.sel = [p.id];
    } else {
      const f = Model.find(op === 'frontMinusBack' ? top.id : bottom.id);
      f.list.splice(f.list.indexOf(f.obj) + 1, 0, p);
      Actions.removeIds(objs.map(o => o.id));
      App.sel = [p.id];
    }
    App.commit('Формирование');
  },

  // ---- PowerClip ----
  powerclipStart() {
    if (!Actions.need(1, 'Выделите объекты, которые нужно поместить во фрейм')) return;
    Tools.pick.pickContainer = App.sel.slice();
    App.setTool('pick');
    UI.toast('Щёлкните по объекту-фрейму (контейнеру)');
    UI.$('#stage').classList.add('cur-target');
  },
  powerclipFinish(containerId) {
    const ids = Tools.pick.pickContainer; Tools.pick.pickContainer = null;
    UI.$('#stage').classList.remove('cur-target');
    if (!containerId || ids.includes(containerId)) return UI.toast('PowerClip отменён');
    const cont = Model.get(containerId);
    if (!['rect', 'ellipse', 'polygon', 'path', 'text'].includes(cont.type)) return UI.toast('Фреймом может быть фигура, кривая или текст');
    const contents = Actions.zSorted(ids);
    Actions.removeIds(ids);
    const pc = Model.make('powerclip', { container: cont, children: contents });
    delete pc.fill; delete pc.stroke;
    const f2 = Model.find(containerId);
    f2.list[f2.list.indexOf(cont)] = pc;
    App.sel = [pc.id]; App.commit('PowerClip');
  },
  powerclipExtract() {
    const pcs = App.selObjs().filter(o => o.type === 'powerclip');
    if (!pcs.length) return UI.toast('Выделите объект PowerClip');
    const ids = [];
    for (const pc of pcs) {
      const f = Model.find(pc.id);
      f.list.splice(f.list.indexOf(pc), 1, pc.container, ...pc.children);
      ids.push(...pc.children.map(c => c.id));
    }
    App.sel = ids; App.commit('Извлечь содержимое');
  },

  // ---- перетекание (blend) ----
  blend(steps = 10) {
    if (App.sel.length !== 2) return UI.toast('Для перетекания выделите ровно два объекта');
    const [A, B] = Actions.zSorted();
    const la = Model.leaves(A)[0], lb = Model.leaves(B)[0];
    const sa = A.type === 'group' ? null : Model.worldSubs(A), sb = B.type === 'group' ? null : Model.worldSubs(B);
    const same = sa && sb && sa.length === sb.length && sa.every((sp, i) => sp.nodes.length === sb[i].nodes.length && sp.closed === sb[i].closed);
    const ra = !same && sa && sb ? Actions.resample(sa) : null, rb = ra ? Actions.resample(sb) : null;
    const mixPaint = (t) => {
      const f = structuredClone(la.fill || { type: 'none' }), s = structuredClone(la.stroke || {});
      const fb = lb.fill || {}, sb2 = lb.stroke || {};
      if (f.type === 'none' && fb.type && fb.type !== 'none') { Object.assign(f, structuredClone(fb)); }
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
        o = Model.make('path', Object.assign({ subs }, mixPaint(t)));
      } else {
        // разные по составу объекты: копия первого, плавно подогнанная под габарит второго
        o = Model.clone(A);
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
    const g = Model.make('group', { children: items, name: `Перетекание (${steps} шагов)` });
    delete g.fill; delete g.stroke;
    const f = Model.find(A.id);
    f.list.splice(f.list.indexOf(A) + 1, 0, g);
    App.sel = [g.id]; App.commit('Перетекание');
  },
  // перевыборка контура в N равномерных точек — для перетекания несовместимых кривых
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

  // ---- стиль ----
  // применить заливку/абрис ко всем листьям выделения
  setPaint(fn, label = 'Изменение стиля', commit = true) {
    const objs = App.selObjs();
    for (const o of objs) for (const leaf of Model.leaves(o)) fn(leaf);
    if (commit) App.commit(label); else UI.refresh({ panels: false });
  },
  setFillColor(color) {
    if (!App.sel.length) {
      App.defaults.fill = color ? { type: 'solid', color, color2: '#ffffff', angle: 0 } : { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
      UI.toast('Цвет заливки по умолчанию для новых фигур изменён'); UI.refresh(); return;
    }
    Actions.setPaint(o => {
      if (!color) { o.fill = Object.assign(o.fill || {}, { type: 'none' }); return; }
      o.fill = Object.assign({ color2: '#ffffff', angle: 0 }, o.fill, { color });
      if (!o.fill.type || o.fill.type === 'none') o.fill.type = 'solid';
    }, 'Заливка');
  },
  setStrokeColor(color) {
    if (!App.sel.length) {
      App.defaults.stroke.color = color;
      UI.toast('Цвет абриса по умолчанию изменён'); UI.refresh(); return;
    }
    Actions.setPaint(o => {
      o.stroke = Object.assign(structuredClone(App.defaults.stroke), o.stroke || {}, { color });
      if (color && !(o.stroke.width > 0)) o.stroke.width = 0.2;
    }, 'Абрис');
  },
  setStrokeWidth(w) {
    if (!App.sel.length) { App.defaults.stroke.width = w; UI.refresh(); return; }
    Actions.setPaint(o => {
      o.stroke = Object.assign(structuredClone(App.defaults.stroke), o.stroke || {});
      o.stroke.width = w;
      if (!o.stroke.color && w > 0) o.stroke.color = '#000000';
    }, 'Толщина абриса');
  },

  // ---- слои ----
  addLayer() {
    const id = 'L' + Date.now().toString(36);
    App.doc.layers.push({ id, name: 'Слой ' + (App.doc.layers.length + 1), visible: true, locked: false, objects: [] });
    App.doc.activeLayer = id;
    App.commit('Новый слой');
  },
  deleteLayer(id) {
    if (App.doc.layers.length < 2) return UI.toast('Последний слой удалить нельзя');
    const L = App.doc.layers.find(l => l.id === id);
    const go = () => {
      App.doc.layers = App.doc.layers.filter(l => l !== L);
      if (App.doc.activeLayer === id) App.doc.activeLayer = App.doc.layers[App.doc.layers.length - 1].id;
      App.sel = App.sel.filter(i => Model.find(i));
      App.commit('Удаление слоя');
    };
    L.objects.length ? UI.confirm(`Удалить «${L.name}» вместе с ${L.objects.length} объектами?`, go) : go();
  },
};
