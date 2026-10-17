// Работа с файлами и объектами, как в меню CorelDRAW: недавние файлы, «Закрыть все», «Вернуть к
// сохранённому», шаблоны, «Собрать для вывода»; абрис в объект, соединение кривых, упрощение узлов, граница.
'use strict';

const FileOps = {
  // ---------- недавние файлы ----------
  recent() { try { return JSON.parse(localStorage.getItem('vektor.recent') || '[]'); } catch (e) { return []; } },
  addRecent(path, name) {
    if (!path) return;
    const list = FileOps.recent().filter(r => r.path !== path);
    list.unshift({ path, name: name || path.split(/[\\/]/).pop(), at: Date.now() });
    try { localStorage.setItem('vektor.recent', JSON.stringify(list.slice(0, 15))); } catch (e) { }
  },
  recentMenu() {
    const list = FileOps.recent();
    if (!list.length) return [{ label: 'Список пуст', disabled: () => true }];
    return list.map((r, i) => ({ label: `${i + 1}. ${r.name}`, action: () => FileOps.openRecent(r) }))
      .concat(['-', { label: 'Очистить список', action: () => { try { localStorage.removeItem('vektor.recent'); } catch (e) { } } }]);
  },
  async openRecent(r) {
    if (!Host.desktop) return UI.toast('Недавние файлы открываются в настольной версии. В браузере — Файл → Открыть');
    const ok = await vkHost.openRecent(r.path).catch(() => false);
    if (!ok) return UI.toast('Файл не найден: ' + r.path, true);
    return IO.openPath(r.path);
  },

  // ---------- закрыть все ----------
  closeAll() {
    Docs.stash();
    const dirty = Docs.list.filter((e, i) => i === Docs.cur ? App.dirty : e.dirty).length;
    const run = () => { while (Docs.list.length > 1) { Docs.cur = Docs.list.length - 1; App.dirty = false; Docs.list[Docs.cur].dirty = false; Docs.close(Docs.cur); } App.dirty = false; Docs.close(0); };
    if (!dirty) return run();
    UI.dialog('Закрыть все документы', h('p', {}, `Несохранённые изменения есть в документах: ${dirty}. Закрыть всё без сохранения?`), [{ label: 'Отмена' }, { label: 'Закрыть всё', primary: true, action: run }]);
  },

  // ---------- вернуть к сохранённому ----------
  revert() {
    const src = IO.path || (Docs.active() && Docs.active().src);
    if (!src || !Host.desktop) return UI.toast('У документа нет сохранённого файла на диске');
    UI.confirm('Отменить все изменения и заново открыть файл с диска?', async () => {
      const keep = Docs.cur;
      App.dirty = false; Docs.list[keep].src = null; // чтобы открытие не переключило на эту же вкладку
      await IO.openPath(src);
      if (Docs.cur !== keep && Docs.list[keep]) { Docs.list.splice(keep, 1); Docs.cur = Docs.list.length - 1; Docs.renderBar(); }
    });
  },

  // ---------- шаблоны ----------
  async templates() { return (await Docs.get('templates')) || []; },
  async saveTemplate() {
    UI.prompt('Название шаблона', App.doc.name || 'Шаблон', async name => {
      if (!name) return;
      const list = (await FileOps.templates()).filter(t => t.name !== name);
      const id = 'tpl:' + Date.now();
      await Docs.put(id, Snap.restore(Snap.take(App.doc)));
      list.unshift({ id, name, at: Date.now(), pages: App.doc.pages.length, w: App.pg().w, h: App.pg().h });
      await Docs.put('templates', list);
      UI.toast('Шаблон сохранён: ' + name);
    });
  },
  async fromTemplate() {
    const list = await FileOps.templates();
    const box = h('div', { class: 'tpl-list' });
    const draw = () => {
      box.innerHTML = '';
      if (!list.length) box.append(h('p', { class: 'muted' }, 'Шаблонов пока нет. Сохраните документ как шаблон: Файл → Сохранить как шаблон. Готовые форматы полиграфии — в «Создать из фрейма».'));
      for (const t of list) box.append(h('div', { class: 'tpl-row' },
        h('b', {}, t.name), h('span', { class: 'muted' }, ` ${G.round(t.w, 1)}×${G.round(t.h, 1)} мм, страниц ${t.pages}`), h('span', { class: 'grow' }),
        h('button', { class: 'pbt', onclick: async () => { const d = await Docs.get(t.id); if (!d) return UI.toast('Шаблон не найден'); UI.closeDialog(); const doc = App.migrate(structuredClone(d)); doc.name = t.name; Docs.newDoc(doc); } }, 'Создать'),
        h('button', { class: 'pbt', title: 'Удалить шаблон', onclick: async () => { list.splice(list.indexOf(t), 1); await Docs.put('templates', list); Docs.drop(t.id.replace(/^doc:/, '')); draw(); } }, '×')));
    };
    draw();
    UI.dialog('Создать из шаблона', box, [{ label: 'Закрыть' }]);
  },

  // ---------- собрать для вывода ----------
  // папка для типографии: документ, PDF (CMYK, вылеты, метки), все картинки отдельными файлами и список шрифтов
  async collect() {
    const base = IO.baseName().replace(/[\\/:*?"<>|]+/g, ' ');
    const files = [];
    files.push({ name: base + '.vkt', data: new TextEncoder().encode(IO.json()) });
    UI.busy('Собираю PDF…');
    try {
      const bl = typeof Prepress !== 'undefined' ? Prepress.pp(App.pg()).bleed || 0 : 0;
      files.push({ name: base + '-печать.pdf', data: await PDFWriter.build(App.doc.pages, { cmyk: true, bleed: bl, marks: bl > 0, title: App.doc.name, imageJpeg: true }) });
    } catch (e) { console.warn(e); }
    UI.busy(null);
    const fonts = new Set(); let k = 0;
    Model.walkDoc(App.doc, o => {
      if (o.type === 'text') fonts.add(o.font + (o.bold ? ' Bold' : '') + (o.italic ? ' Italic' : ''));
      if (o.type === 'image' && o.href && o.href.startsWith('data:')) {
        const m = o.href.match(/^data:image\/(\w+)/), ext = m ? m[1].replace('jpeg', 'jpg') : 'bin';
        const b64 = o.href.slice(o.href.indexOf(',') + 1), bin = atob(b64), u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        files.push({ name: `картинки/${String(++k).padStart(3, '0')} ${(o.name || 'изображение').replace(/[\\/:*?"<>|]+/g, ' ')}.${ext}`, data: u });
      }
    });
    const info = [`Документ: ${App.doc.name}`, `Страниц: ${App.doc.pages.length}`, ...App.doc.pages.map((P, i) => `  ${i + 1}. ${P.name}: ${G.round(P.w, 2)} × ${G.round(P.h, 2)} мм`),
      `Картинок: ${k}`, `Шрифты (${fonts.size}):`, ...[...fonts].map(f => '  ' + f), '', 'Собрано программой «Вектор».'].join('\r\n');
    files.push({ name: 'Состав.txt', data: new TextEncoder().encode(info) });
    if (Host.desktop || window.showDirectoryPicker) {
      const dir = await Host.pickFolder('Папка для вывода').catch(() => null);
      if (dir) {
        for (const f of files) await Host.writeToFolder(dir, base + '/' + f.name, f.data);
        UI.toast(`Собрано в папку «${base}»: файлов ${files.length}`);
        return;
      }
    }
    const zip = fflate.zipSync(Object.fromEntries(files.map(f => [base + '/' + f.name, f.data])), { level: 0 });
    await Host.saveFile(base + ' для вывода.zip', new Blob([zip], { type: 'application/zip' }), 'application/zip');
    UI.toast(`Собрано: файлов ${files.length} (ZIP)`);
  },
};

// ---------- операции с объектами из меню «Объект» CorelDRAW ----------
const ObjOps = {
  // абрис → отдельный замкнутый объект с заливкой цветом абриса
  outlineToObject() {
    const objs = App.selObjs(); if (!objs.length) return UI.toast('Выделите объект с абрисом');
    const made = [];
    for (const o of objs) for (const leaf of Model.leaves(o)) {
      const s = leaf.stroke; if (!s || !s.color || !(s.width > 0)) continue;
      const subs = Model.worldSubs(leaf); if (!subs) continue;
      const S = Effects.SCALE, co = new ClipperLib.ClipperOffset(2, 0.02 * S);
      const jt = s.join === 'round' ? ClipperLib.JoinType.jtRound : s.join === 'bevel' ? ClipperLib.JoinType.jtSquare : ClipperLib.JoinType.jtMiter;
      const et = s.cap === 'round' ? ClipperLib.EndType.etOpenRound : s.cap === 'square' ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenButt;
      for (const c of Effects.toClipper(subs)) co.AddPath(c.path, jt, c.closed ? ClipperLib.EndType.etClosedLine : et);
      const sol = new ClipperLib.Paths(); co.Execute(sol, s.width / 2 * S);
      const res = Effects.fromClipper(sol); if (!res.length) continue;
      const p = Model.make('path', { subs: res, name: 'Абрис ' + (leaf.name || '') });
      p.fill = { type: 'solid', color: s.color, color2: '#ffffff', angle: 0 }; p.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
      leaf.stroke = Object.assign({}, s, { color: null, width: 0 });
      const f = Model.find(o.id); f.list.splice(f.list.indexOf(o) + 1, 0, p); made.push(p.id);
    }
    if (!made.length) return UI.toast('У выделенных объектов нет абриса');
    App.sel = made; App.commit('Абрис в объект');
  },
  // соединить концы выделенных открытых кривых (ближайшие концы сливаются в один узел)
  joinCurves() {
    const objs = App.selObjs().filter(o => o.type === 'path');
    if (!objs.length) return UI.toast('Выделите открытые кривые');
    let subs = [];
    for (const o of objs) subs.push(...structuredClone(Model.worldSubs(o)));
    const open = subs.filter(s => !s.closed), closed = subs.filter(s => s.closed);
    const tol = 2 / App.zoom + 0.5;
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < open.length; i++) for (let j = 0; j < open.length; j++) {
        if (i === j) continue;
        const a = open[i], b = open[j], ae = a.nodes[a.nodes.length - 1];
        for (const rev of [false, true]) {
          const bn = rev ? (() => { const c = structuredClone(b); Path.reverse(c); return c.nodes; })() : b.nodes, bs = bn[0];
          if (G.dist(ae, bs) <= tol) {
            ae.ox = bs.ox; ae.oy = bs.oy;
            a.nodes.push(...bn.slice(1)); open.splice(j, 1); merged = true; break outer;
          }
        }
      }
    }
    for (const s of open) { const f = s.nodes[0], l = s.nodes[s.nodes.length - 1]; if (s.nodes.length > 2 && G.dist(f, l) <= tol) { f.ix = l.ix; f.iy = l.iy; s.nodes.pop(); s.closed = true; } }
    const p = Model.make('path', { subs: closed.concat(open), fill: structuredClone(objs[0].fill), stroke: structuredClone(objs[0].stroke) });
    T2.replace(objs[0], [p]); Actions.removeIds(objs.slice(1).map(o => o.id));
    App.sel = [p.id]; App.commit('Соединить кривые');
  },
  // упростить: убрать лишние узлы с сохранением формы
  reduceNodes() {
    const objs = App.selObjs().filter(o => ['path', 'rect', 'ellipse', 'polygon'].includes(o.type));
    if (!objs.length) return UI.toast('Выделите кривые');
    let before = 0, after = 0;
    for (const o of objs) {
      const w = T2.asWorldPath(o); if (!w) continue;
      const tol = Math.max(0.05, (UI.opts.reduceTol || 0.3));
      w.subs = Path.flatten(w.subs, null, 16).map(sp => {
        const pts = sp.closed ? sp.pts.concat([sp.pts[0]]) : sp.pts;
        let s = G.simplify(pts, tol); if (sp.closed) s.pop();
        before += sp.pts.length; after += s.length;
        return { closed: sp.closed, nodes: G.smoothNodes(s, sp.closed) };
      });
      T2.replace(Model.get(o.id) || o, [w]);
    }
    App.commit('Упростить');
    UI.toast(`Узлов было ${before}, стало ${after}`);
  },
  // граница: новый объект по внешнему контуру выделенного
  boundary() {
    const objs = App.selObjs(); if (!objs.length) return UI.toast('Выделите объекты');
    const polys = objs.map(o => Actions.toPolys(o)).filter(Boolean);
    if (!polys.length) return UI.toast('Нет замкнутых фигур');
    let res; try { res = polygonClipping.union(...polys); } catch (e) { return UI.toast('Не удалось построить границу'); }
    res = res.map(poly => [poly[0]]); // без внутренних отверстий
    const p = Actions.fromPolys(res, objs[0]); if (!p) return;
    p.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
    p.stroke = Object.assign(Model.defaults().stroke, { color: '#000000', width: 0.3 }); p.name = 'Граница';
    Actions.insert([p]); App.commit('Граница');
  },
};

// ---------- Текст вдоль пути (как «Текст → Текст вдоль пути» в CorelDRAW) ----------
const TextPath = {
  // выделены текст и кривая (фигура): текст ложится на её контур; кривая остаётся отдельным объектом
  fit() {
    const objs = App.selObjs();
    const t = objs.find(o => o.type === 'text');
    const p = objs.find(o => o !== t && ['path', 'rect', 'ellipse', 'polygon'].includes(o.type));
    if (!t || !p) return UI.toast('Выделите текст и кривую или фигуру (Shift+щелчок), затем «Текст вдоль пути»');
    const subs = structuredClone(Model.toSubs(p) || []).filter(sp => sp.nodes.length > 1);
    if (!subs.length) return UI.toast('У кривой нет сегментов');
    Path.transform(subs, p.m);
    // текст становится «фигурным» без поворота: масштаб матрицы переходит в кегль
    const k = Math.hypot(t.m[0], t.m[1]) || 1;
    if (Math.abs(k - 1) > 1e-6) t.size = G.round(t.size * k, 2);
    delete t.frame; delete t.envelope;
    t.m = [1, 0, 0, 1, 0, 0];
    t.tpath = { subs: subs.slice(0, 1), offset: p.type === 'ellipse' ? 75 : 0, dist: 0, flip: false };
    if (p.type === 'ellipse') t.align = 'center';
    App.sel = [t.id]; App.commit('Текст вдоль пути');
    TextPath.dialog(t.id);
  },
  straighten() {
    const ts = App.selObjs().filter(o => o.type === 'text' && o.tpath);
    if (!ts.length) return UI.toast('Выделите текст на пути');
    for (const t of ts) {
      const P = Text.pathPoly(t), q = P ? Text.pathAt(P, (t.tpath.offset || 0) / 100 * P.len) : { x: 0, y: 0 };
      delete t.tpath; t.align = 'left';
      t.m = [1, 0, 0, 1, q.x, q.y - Text.fs(t) * 0.85];
    }
    App.commit('Выпрямить текст');
  },
  // параметры: смещение по пути, расстояние от пути, сторона
  dialog(id) {
    const t0 = Model.get(id || App.sel[0]);
    if (!t0 || !t0.tpath) return UI.toast('Выделите текст на пути');
    const tid = t0.id, tp0 = Object.assign({}, t0.tpath);
    const cur = () => Model.get(tid);
    const set = (k, v) => { const t = cur(); if (!t) return; t.tpath[k] = v; UI.refresh({ panels: false }); };
    const off = h('input', { type: 'range', min: 0, max: 100, step: 0.5, value: tp0.offset || 0, oninput: e => { offN.textContent = e.target.value + ' %'; set('offset', +e.target.value); } });
    const offN = h('b', {}, (tp0.offset || 0) + ' %');
    const dist = h('input', { type: 'number', step: 0.5, value: tp0.dist || 0, style: { width: '80px' }, oninput: e => set('dist', +e.target.value || 0) });
    const flip = h('input', { type: 'checkbox', checked: !!tp0.flip, onchange: e => set('flip', e.target.checked) });
    const align = h('select', { onchange: e => { const t = cur(); if (t) { t.align = e.target.value; UI.refresh({ panels: false }); } } },
      ...[['left', 'От начала'], ['center', 'По центру'], ['right', 'К концу']].map(([v, l]) => h('option', { value: v, selected: (t0.align || 'left') === v }, l)));
    let ok = false;
    UI.dialog('Текст вдоль пути', h('div', { class: 'form' },
      h('label', {}, 'Положение на пути: ', offN, off),
      h('label', {}, 'Выключка ', align),
      h('label', {}, 'Расстояние от пути, мм ', dist),
      h('label', { class: 'row' }, flip, ' по другую сторону (отразить)'),
      h('p', { class: 'muted small' }, 'Текст и кривая — разные объекты: кривую можно скрыть (абрис «нет») или удалить. Изменить текст — двойной щелчок по нему.')),
    [{ label: 'Отмена' }, { label: 'Готово', primary: true, action: () => { ok = true; App.commit('Текст вдоль пути'); } }],
    { onClose: () => { if (ok) return; const t = cur(); if (t) { t.tpath = tp0; t.align = t0.align; UI.refresh(); } } });
  },
};

// ---------- Редактирование содержимого PowerClip (как «Изменить PowerClip» в CorelDRAW) ----------
// Содержимое временно достаётся из фрейма: его можно двигать, масштабировать, добавлять и удалять объекты.
// «Готово» собирает PowerClip обратно — в него входит всё, что лежит над фреймом в том же списке.
const PCEdit = {
  // состояние режима хранится на самом фрейме (cont.pcEdit) — поэтому отмена/повтор и вкладки документов его не ломают
  get cur() {
    if (!App.doc) return null;
    for (const L of App.pg().layers) for (const o of L.objects) if (o.pcEdit) return o;
    return null;
  },
  enter(pc) {
    pc = pc || App.selObjs().find(o => o.type === 'powerclip');
    if (!pc) return UI.toast('Выделите объект PowerClip');
    if (PCEdit.cur) PCEdit.finish();
    const f = Model.find(pc.id); if (!f) return;
    const cont = pc.container;
    cont.pcEdit = { pc: pc.id, name: pc.name || '', wasLocked: !!cont.locked, before: f.list.map(o => o.id), kids: pc.children.map(o => o.id) };
    f.list.splice(f.list.indexOf(pc), 1, cont, ...pc.children);
    cont.locked = true;
    App.sel = pc.children.map(c => c.id);
    App.commit('Изменить PowerClip');
  },
  finish() {
    const cont = PCEdit.cur; if (!cont) return;
    const c = cont.pcEdit, f = Model.find(cont.id);
    delete cont.pcEdit; cont.locked = c.wasLocked;
    const before = new Set(c.before), kidIds = new Set(c.kids);
    const at = f.list.indexOf(cont);
    const kids = f.list.slice(at + 1).filter(o => kidIds.has(o.id) || !before.has(o.id));
    if (!kids.length) { App.sel = [cont.id]; App.commit('PowerClip: пустой фрейм'); return; }
    for (const k of [cont, ...kids]) f.list.splice(f.list.indexOf(k), 1);
    const pc = Model.make('powerclip', { container: cont, children: kids });
    delete pc.fill; delete pc.stroke;
    if (c.name) pc.name = c.name;
    f.list.splice(Math.min(at, f.list.length), 0, pc);
    App.sel = [pc.id]; App.commit('PowerClip: готово');
  },
  bar(on) {
    let el = document.getElementById('pcbar');
    if (!on) { if (el) el.remove(); return; }
    if (!el) {
      el = h('div', { id: 'pcbar', class: 'pcbar' }, h('span', {}, 'Изменение содержимого PowerClip — двигайте, масштабируйте, добавляйте объекты'),
        h('button', { class: 'primary', onclick: () => PCEdit.finish() }, 'Готово'));
      (document.querySelector('.canvaswrap') || document.body).append(el);
    }
  },
  // контур фрейма поверх, пока идёт редактирование
  overlay(out) {
    const o = PCEdit.cur;
    PCEdit.bar(!!o);
    if (!o) return;
    const subs = Model.toSubs(o);
    if (subs) {
      for (const f of Path.flatten(subs, o.m)) {
        const pts = f.pts.map(p => App.toScreen(p.x, p.y)).map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
        out.push(`<${f.closed ? 'polygon' : 'polyline'} class="pc-frame" points="${pts}"/>`);
      }
    }
  },
  // содержимое: вписать (с сохранением пропорций), заполнить, по центру
  fit(mode) {
    const pcs = App.selObjs().filter(o => o.type === 'powerclip');
    if (!pcs.length) return UI.toast('Выделите объект PowerClip');
    for (const pc of pcs) {
      const fb = Model.worldBox(pc.container);
      let cb = G.emptyBox(); for (const ch of pc.children) cb = G.unionBox(cb, Model.worldBox(ch));
      if (!G.boxValid(cb) || !G.boxValid(fb)) continue;
      const fw = fb.x2 - fb.x1, fh = fb.y2 - fb.y1, cw = cb.x2 - cb.x1, ch2 = cb.y2 - cb.y1;
      let sx = 1, sy = 1;
      if (mode === 'fit') sx = sy = Math.min(fw / cw, fh / ch2);
      else if (mode === 'fill') sx = sy = Math.max(fw / cw, fh / ch2);
      else if (mode === 'stretch') { sx = fw / cw; sy = fh / ch2; }
      const ccx = (cb.x1 + cb.x2) / 2, ccy = (cb.y1 + cb.y2) / 2, fcx = (fb.x1 + fb.x2) / 2, fcy = (fb.y1 + fb.y2) / 2;
      const T = Mx.mul([1, 0, 0, 1, fcx, fcy], Mx.mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -ccx, -ccy]));
      for (const ch of pc.children) Model.applyT(ch, T);
    }
    App.commit({ fit: 'Вписать содержимое', fill: 'Заполнить фрейм', stretch: 'Растянуть содержимое', center: 'Содержимое по центру' }[mode]);
  },
};
