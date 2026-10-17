// «Ноды»: генерация цепочками — узлы текста, картинок с компьютера и моделей Polza
// (картинки, видео, текст, удаление фона, апскейл, векторизация), соединённые связями.
// Папка на входе запускает цепочку для каждого файла. Схема — файл .vkn.
'use strict';

const Nodes = {
  el: null, g: { nodes: [], edges: [] }, view: { x: 40, y: 40, k: 1 }, results: {}, status: {}, sel: null, running: false,
  // описание типов: входы, выходы, параметры
  TYPES: {
    text: { title: 'Текст', color: '#64748b', outputs: [['text', 'text']], params: [['text', 'textarea', 'Описание, промпт или любой текст']] },
    image: { title: 'Картинка с компьютера', color: '#0ea5e9', outputs: [['image', 'image']], params: [['file', 'file', 'Картинка']] },
    folder: { title: 'Папка картинок', color: '#0ea5e9', outputs: [['images', 'image']], params: [['folder', 'folder', 'Папка']], batch: true },
    figma: { title: 'Выделение из «Фигмы»', color: '#a855f7', outputs: [['image', 'image']], params: [] },
    vektor: { title: 'Страница «Вектора»', color: '#2f8f3a', outputs: [['image', 'image']], params: [['what', 'select:page=Текущая страница|sel=Выделенное', 'Что взять']] },
    template: { title: 'Шаблон текста', color: '#64748b', inputs: [['a', 'text'], ['b', 'text'], ['c', 'text']], outputs: [['text', 'text']], params: [['template', 'textarea', 'Текст с {a}, {b}, {c}']] },
    llm: { title: 'Текстовая модель', color: '#f59e0b', inputs: [['text', 'text'], ['image', 'image']], outputs: [['text', 'text']], params: [['instruction', 'textarea', 'Что сделать с текстом/картинкой'], ['model', 'model:chat', 'Модель (пусто — модель агента)']] },
    genImage: { title: 'Модель: картинка', color: '#ec4899', inputs: [['prompt', 'text'], ['refs', 'image', true]], outputs: [['image', 'image']], params: [['model', 'model:image', 'Модель Polza'], ['extra', 'json', 'Доп. параметры JSON, например {"aspect_ratio":"9:16"}']] },
    genVideo: { title: 'Модель: видео', color: '#ef4444', inputs: [['prompt', 'text'], ['image', 'image'], ['end', 'image']], outputs: [['video', 'video']], params: [['model', 'model:video', 'Модель Polza'], ['duration', 'number', 'Длительность, с'], ['extra', 'json', 'Доп. параметры JSON']] },
    removeBg: { title: 'Удалить фон', color: '#14b8a6', inputs: [['image', 'image']], outputs: [['image', 'image']], params: [['model', 'model:image:auto', 'Модель (автоматически)']] },
    upscale: { title: 'Увеличить', color: '#14b8a6', inputs: [['image', 'image']], outputs: [['image', 'image']], params: [['model', 'model:image:auto', 'Модель (автоматически)'], ['scale', 'number', 'Во сколько раз']] },
    vectorize: { title: 'В вектор (SVG)', color: '#14b8a6', inputs: [['image', 'image']], outputs: [['svg', 'svg']], params: [['model', 'model:image:auto', 'Модель (без неё — трассировка)'], ['colors', 'number', 'Цветов'], ['palette', 'text', 'Палитра: #hex через запятую']] },
    mockup: { title: 'Мокап', color: '#8b5cf6', inputs: [['base', 'image'], ['design', 'image']], outputs: [['image', 'image']], params: [['mode', 'select:shape=По форме объекта|cylinder=Цилиндр|flat=Плоскость', 'Посадка'], ['mask', 'select:ai=Объект находит ИИ|full=Весь кадр', 'Объект'], ['blend', 'select:normal=С тенями|multiply=Умножение|screen=Экран', 'Смешивание']] },
    save: { title: 'Сохранить', color: '#334155', inputs: [['in', 'any', true]], outputs: [], params: [['folder', 'folder', 'Папка (пусто — спросить)'], ['name', 'text', 'Имя файлов']] },
    toApp: { title: 'Отправить', color: '#334155', inputs: [['in', 'any', true]], outputs: [], params: [['where', 'select:vektor=В «Вектор»|figma=В «Фигму»|motion=В «Моушн»', 'Куда']] },
  },
  ORDER: ['text', 'template', 'image', 'folder', 'figma', 'vektor', 'llm', 'genImage', 'genVideo', 'removeBg', 'upscale', 'vectorize', 'mockup', 'save', 'toApp'],

  uid() { return 'n' + Math.random().toString(36).slice(2, 8); },
  node(id) { return Nodes.g.nodes.find(n => n.id === id); },
  add(type, x, y, params = {}) {
    const n = { id: Nodes.uid(), type, x, y, params: Object.assign({}, Nodes.defaults(type), params) };
    Nodes.g.nodes.push(n); Nodes.sel = n.id; Nodes.render(); Nodes.autosave();
    return n;
  },
  defaults(type) {
    return { genImage: { model: Polza.media.image }, genVideo: { model: Polza.media.video, duration: 5 }, upscale: { scale: 2 }, vectorize: { colors: 8 }, template: { template: '{a}' }, vektor: { what: 'page' } }[type] || {};
  },
  connect(from, fport, to, tport) {
    const T = Nodes.TYPES[Nodes.node(to).type];
    const inp = (T.inputs || []).find(i => i[0] === tport);
    if (!inp) return;
    if (!inp[2]) Nodes.g.edges = Nodes.g.edges.filter(e => !(e.to === to && e.tport === tport));
    if (Nodes.g.edges.some(e => e.from === from && e.fport === fport && e.to === to && e.tport === tport)) return;
    if (from === to || Nodes.reaches(to, from)) return UI.toast('Цикл в схеме нельзя');
    Nodes.g.edges.push({ from, fport, to, tport });
    Nodes.dirty(to); Nodes.render(); Nodes.autosave();
  },
  reaches(a, b) { // есть ли путь a → b
    const seen = new Set(), st = [a];
    while (st.length) { const x = st.pop(); if (x === b) return true; if (seen.has(x)) continue; seen.add(x); Nodes.g.edges.filter(e => e.from === x).forEach(e => st.push(e.to)); }
    return false;
  },
  dirty(id) { delete Nodes.results[id]; delete Nodes.status[id]; Nodes.g.edges.filter(e => e.from === id).forEach(e => Nodes.dirty(e.to)); },
  remove(id) { Nodes.g.nodes = Nodes.g.nodes.filter(n => n.id !== id); Nodes.g.edges = Nodes.g.edges.filter(e => e.from !== id && e.to !== id); Nodes.render(); Nodes.autosave(); },

  // ================= выполнение =================
  // значения: { kind: 'text'|'image'|'video'|'svg', text?, blob? }; массив — пакет (по элементу на файл)
  async evaluate(id, ctx) {
    if (Nodes.results[id]) return Nodes.results[id];
    if (ctx.stop) throw new Error('Остановлено');
    const n = Nodes.node(id), T = Nodes.TYPES[n.type];
    const ins = {};
    for (const [name, , multi] of T.inputs || []) {
      const es = Nodes.g.edges.filter(e => e.to === id && e.tport === name);
      const vals = [];
      for (const e of es) vals.push(await Nodes.evaluate(e.from, ctx));
      ins[name] = multi ? vals : vals[0];
    }
    Nodes.status[id] = { s: 'run' }; Nodes.paint(id);
    try {
      // пакет: если на входе массив — узел выполняется для каждого элемента
      const batchKey = Object.keys(ins).find(k => Array.isArray(ins[k]) && !(T.inputs.find(i => i[0] === k) || [])[2]);
      let out;
      if (batchKey) {
        out = [];
        for (let i = 0; i < ins[batchKey].length; i++) {
          if (ctx.stop) throw new Error('Остановлено');
          Nodes.status[id] = { s: 'run', note: `${i + 1} из ${ins[batchKey].length}` }; Nodes.paint(id);
          const one = {};
          for (const k in ins) one[k] = Array.isArray(ins[k]) && !(T.inputs.find(x => x[0] === k) || [])[2] ? ins[k][Math.min(i, ins[k].length - 1)] : ins[k];
          out.push(await Nodes.runNode(n, one, ctx, i));
        }
      } else out = await Nodes.runNode(n, ins, ctx, 0);
      Nodes.results[id] = out;
      Nodes.status[id] = { s: 'ok' };
      return out;
    } catch (e) {
      Nodes.status[id] = { s: 'err', note: e.message || String(e) };
      throw e;
    } finally { Nodes.paint(id); }
  },
  text(v) { if (!v) return ''; if (Array.isArray(v)) return v.map(Nodes.text).join('\n'); return v.kind === 'text' ? v.text : ''; },
  flatImages(list) { const out = []; for (const v of [].concat(list || [])) { if (Array.isArray(v)) out.push(...Nodes.flatImages(v)); else if (v && v.kind === 'image') out.push(v.blob); } return out; },
  parseJSON(s) { if (!s || !String(s).trim()) return {}; try { return JSON.parse(s); } catch (e) { throw new Error('Доп. параметры — неверный JSON'); } },
  async runNode(n, ins, ctx, idx) {
    const P = n.params, st = s => { Nodes.status[n.id] = Object.assign({}, Nodes.status[n.id], { note: s }); Nodes.paint(n.id); };
    switch (n.type) {
      case 'text': return { kind: 'text', text: P.text || '' };
      case 'template': return { kind: 'text', text: String(P.template || '').replace(/\{(a|b|c)\}/g, (m, k) => Nodes.text(ins[k])) };
      case 'image': {
        if (!P.file) throw new Error('Выберите картинку');
        const blob = P.file.path && Host.desktop ? new Blob([await vkHost.read(P.file.path)], { type: Host.mimeOf(P.file.name) }) : await (await fetch(P.file.data)).blob();
        return { kind: 'image', blob, name: P.file.name };
      }
      case 'folder': {
        const f = Nodes.folders[n.id] || (P.folder && P.folder.root && Host.desktop ? await Host.openFolderPath(P.folder.root) : null);
        if (!f) throw new Error('Выберите папку');
        const imgs = f.files.filter(x => /\.(png|jpe?g|webp|bmp|gif)$/i.test(x.name));
        if (!imgs.length) throw new Error('В папке нет картинок');
        const out = [];
        for (const x of imgs.slice(0, 200)) out.push({ kind: 'image', blob: await Host.blobOf(x), name: x.name });
        return out;
      }
      case 'figma': {
        const blob = await FigmaWS.selectionImage();
        WS.show('nodes');
        return { kind: 'image', blob, name: 'figma.png' };
      }
      case 'vektor': {
        const kind = P.what === 'sel' && App.sel.length ? 'sel' : 'page';
        const r = IO.svgFor(kind, kind === 'sel');
        const { blob } = await IO.rasterize(r.svg, r.w, r.h, 150, 'png', kind === 'sel' ? null : App.pg().color || '#ffffff');
        return { kind: 'image', blob, name: 'вектор.png' };
      }
      case 'llm': {
        const content = [{ type: 'text', text: (P.instruction || 'Обработай текст') + '\n\n' + Nodes.text(ins.text) }];
        if (ins.image && ins.image.kind === 'image') content.push({ type: 'image_url', image_url: { url: await Polza.thumb(ins.image.blob, 1024) } });
        const saved = Agent.settings.model;
        if (P.model) Agent.settings.model = P.model;
        try {
          const js = await Agent.callModel([{ role: 'system', content: 'Отвечай только результатом, без пояснений.' }, { role: 'user', content }]);
          return { kind: 'text', text: ((js.choices && js.choices[0].message.content) || '').trim() };
        } finally { Agent.settings.model = saved; }
      }
      case 'genImage': {
        const prompt = Nodes.text(ins.prompt); if (!prompt) throw new Error('Нет промпта: соедините вход «prompt» с текстом');
        const blob = await Polza.generateImage(prompt, { images: Nodes.flatImages(ins.refs), model: P.model, params: Nodes.parseJSON(P.extra), onStatus: st, signal: ctx.signal });
        return { kind: 'image', blob, name: 'генерация.png' };
      }
      case 'genVideo': {
        const prompt = Nodes.text(ins.prompt); if (!prompt) throw new Error('Нет промпта');
        const params = Object.assign(P.duration ? { duration: +P.duration } : {}, Nodes.parseJSON(P.extra));
        const blob = await Polza.generateVideo(prompt, { image: ins.image && ins.image.blob, endImage: ins.end && ins.end.blob, model: P.model, params, onStatus: st, signal: ctx.signal });
        return { kind: 'video', blob, name: 'видео.mp4' };
      }
      case 'removeBg': if (!ins.image) throw new Error('Нет картинки на входе'); return { kind: 'image', blob: await Polza.removeBackground(ins.image.blob, { model: P.model, onStatus: st, signal: ctx.signal }), name: 'без-фона.png' };
      case 'upscale': if (!ins.image) throw new Error('Нет картинки на входе'); return { kind: 'image', blob: await Polza.upscale(ins.image.blob, { scale: +P.scale || 2, model: P.model, onStatus: st, signal: ctx.signal }), name: 'апскейл.png' };
      case 'vectorize': {
        if (!ins.image) throw new Error('Нет картинки на входе');
        const palette = String(P.palette || '').split(/[,;\s]+/).filter(s => /^#?[0-9a-f]{6}$/i.test(s)).map(s => s[0] === '#' ? s : '#' + s);
        const svg = palette.length ? await Polza.trace(ins.image.blob, { colors: palette.length, palette }) : await Polza.vectorize(ins.image.blob, { colors: +P.colors || 8, model: P.model, onStatus: st });
        return { kind: 'svg', text: svg, name: 'вектор.svg' };
      }
      case 'mockup': {
        if (!ins.base || !ins.design) throw new Error('Нужны оба входа: base (фото объекта) и design');
        const blob = await makeMockup({ base: ins.base.blob, design: ins.design.blob, mode: P.mode || 'shape', mask: P.mask || 'ai', blend: P.blend || 'normal', onStatus: st });
        return { kind: 'image', blob, name: 'мокап.png' };
      }
      case 'save': {
        const items = Nodes.flatValues(ins.in);
        if (!items.length) throw new Error('Нечего сохранять');
        let folder = Nodes.folders[n.id] || (P.folder && P.folder.root && Host.desktop ? await Host.openFolderPath(P.folder.root) : null);
        if (!folder) { folder = await Host.pickFolder('Куда сохранить результаты'); if (!folder) throw new Error('Папка не выбрана'); Nodes.folders[n.id] = folder; P.folder = { name: folder.name, root: folder.root }; }
        const base = (P.name || 'результат').replace(/[\\/:*?"<>|]+/g, ' ');
        const saved = [];
        for (let i = 0; i < items.length; i++) {
          const v = items[i];
          const ext = v.kind === 'text' ? 'txt' : v.kind === 'svg' ? 'svg' : v.kind === 'video' ? ((v.blob.type || '').includes('webm') ? 'webm' : 'mp4') : ((v.blob.type || '').includes('jpeg') ? 'jpg' : (v.blob.type || '').includes('webp') ? 'webp' : 'png');
          const data = v.kind === 'text' || v.kind === 'svg' ? v.text : v.blob;
          const name = `${base}${items.length > 1 ? '-' + String(i + 1).padStart(2, '0') : ''}-${Date.now().toString(36)}.${ext}`;
          saved.push(await Host.writeToFolder(folder, name, data));
        }
        return { kind: 'text', text: 'Сохранено: ' + saved.length };
      }
      case 'toApp': {
        const items = Nodes.flatValues(ins.in);
        if (P.where === 'motion') {
          const imgs = items.filter(v => v.kind === 'image' || v.kind === 'svg').map(v => ({ name: v.name || 'кадр', blob: v.kind === 'svg' ? new Blob([v.text], { type: 'image/svg+xml' }) : v.blob }));
          const vids = items.filter(v => v.kind === 'video');
          if (!Motion.el) { WS.show('motion'); }
          if (imgs.length) await Motion.addImages(imgs);
          for (const v of vids) { const a = await Motion.addAsset({ name: v.name || 'видео.mp4', blob: v.blob, kind: 'video' }); await Motion.addAssetsAsLayers([a]); }
        } else if (P.where === 'figma') {
          const api = await FigmaWS.api();
          for (const v of items) {
            if (v.kind === 'svg') await api.pasteSVG(v.text);
            else if (v.kind === 'image') await api.placeImages([{ bytes: await v.blob.arrayBuffer(), name: v.name || 'картинка.png', type: v.blob.type || 'image/png' }]);
          }
        } else {
          WS.show('vektor');
          for (const v of items) {
            if (v.kind === 'svg') IO.importSVGText(v.text, null);
            else if (v.kind === 'image') await IO.importRaster(v.blob, v.name || 'Картинка');
            else if (v.kind === 'text') { Actions.insert([Model.make('text', { text: v.text, m: Mx.translate(10, 20) })]); }
          }
          App.commit('Из «Нод»');
        }
        WS.show(P.where || 'vektor');
        return { kind: 'text', text: 'Отправлено: ' + items.length };
      }
    }
    throw new Error('Неизвестный узел ' + n.type);
  },
  flatValues(list) { const out = []; for (const v of [].concat(list || [])) { if (Array.isArray(v)) out.push(...Nodes.flatValues(v)); else if (v) out.push(v); } return out; },
  async run(onlyId) {
    if (Nodes.running) return;
    Nodes.running = true; Nodes.ctx = { stop: false, signal: new AbortController().signal };
    const ac = new AbortController(); Nodes.ctx.signal = ac.signal; Nodes.ctx.abort = () => ac.abort();
    Nodes.runBtn.textContent = '■ Стоп';
    try {
      const sinks = onlyId ? [onlyId] : Nodes.g.nodes.filter(n => !Nodes.g.edges.some(e => e.from === n.id)).map(n => n.id);
      if (onlyId) Nodes.dirty(onlyId);
      for (const id of sinks) {
        try { await Nodes.evaluate(id, Nodes.ctx); } catch (e) { console.warn(e); UI.toast((Nodes.TYPES[Nodes.node(id).type] || {}).title + ': ' + (e.message || e), true); if (Nodes.ctx.stop) break; }
      }
    } finally {
      Nodes.running = false; Nodes.runBtn.textContent = '▶ Запустить'; Nodes.render();
    }
  },
  stop() { if (Nodes.ctx) { Nodes.ctx.stop = true; Nodes.ctx.abort && Nodes.ctx.abort(); } },

  // ================= интерфейс =================
  folders: {},
  build() {
    Nodes.load();
    const el = h('div', { class: 'nodes' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    Nodes.runBtn = B('▶ Запустить', 'Выполнить всю схему', () => Nodes.running ? Nodes.stop() : Nodes.run(), 'primary');
    const bar = h('div', { class: 'wsbar' },
      B('+ Узел ▾', 'Добавить узел', e => Nodes.addMenu(e.currentTarget.getBoundingClientRect().left, e.currentTarget.getBoundingClientRect().bottom)),
      B('Шаблоны ▾', 'Готовые схемы', e => Nodes.templatesMenu(e.currentTarget)),
      h('span', { class: 'sep' }),
      B('Новая', 'Очистить схему', () => UI.confirm('Очистить схему?', () => { Nodes.g = { nodes: [], edges: [] }; Nodes.results = {}; Nodes.status = {}; Nodes.render(); Nodes.autosave(); })),
      B('Открыть', 'Открыть схему .vkn', () => Nodes.openDialog()), B('Сохранить', 'Сохранить схему .vkn', () => Nodes.save()),
      h('span', { class: 'sep' }), Nodes.runBtn,
      B('Незабранные', 'Оплаченные заказы Polza, результат которых ещё не забран', () => Nodes.pendingDialog()),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted' }, 'Двойной щелчок по полю — добавить узел · тяните от выхода ● ко входу ● · Del — удалить'),
      B('⚙ Polza', 'Модели Polza', () => Polza.settingsDialog()));
    const area = h('div', { class: 'nd-area' });
    const world = h('div', { class: 'nd-world' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'nd-edges');
    world.append(svg);
    area.append(world);
    el.append(bar, area);
    Nodes.area = area; Nodes.world = world; Nodes.svg = svg;
    Nodes.bindArea();
    if (!Nodes.g.nodes.length) Nodes.template('photoToVideo');
    Nodes.render();
    return el;
  },
  shown() { Nodes.render(); },
  bindArea() {
    const area = Nodes.area;
    area.addEventListener('pointerdown', e => {
      if (e.target !== area && e.target !== Nodes.world && e.target !== Nodes.svg) return;
      Nodes.sel = null; Nodes.render();
      const x0 = e.clientX, y0 = e.clientY, vx = Nodes.view.x, vy = Nodes.view.y;
      area.setPointerCapture(e.pointerId);
      const mv = ev => { Nodes.view.x = vx + ev.clientX - x0; Nodes.view.y = vy + ev.clientY - y0; Nodes.applyView(); };
      const up = () => { area.removeEventListener('pointermove', mv); area.removeEventListener('pointerup', up); };
      area.addEventListener('pointermove', mv); area.addEventListener('pointerup', up);
    });
    area.addEventListener('wheel', e => {
      e.preventDefault();
      const r = area.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.max(0.25, Math.min(2, Nodes.view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      Nodes.view.x = mx - (mx - Nodes.view.x) * k / Nodes.view.k; Nodes.view.y = my - (my - Nodes.view.y) * k / Nodes.view.k; Nodes.view.k = k;
      Nodes.applyView();
    }, { passive: false });
    area.addEventListener('dblclick', e => {
      if (e.target !== area && e.target !== Nodes.world && e.target !== Nodes.svg) return;
      const p = Nodes.toWorld(e);
      Nodes.addMenu(e.clientX, e.clientY, p);
    });
    window.addEventListener('keydown', e => {
      if (WS.current !== 'nodes' || Events.typing() || UI.modalOpen()) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && Nodes.sel) { e.preventDefault(); Nodes.remove(Nodes.sel); }
    });
  },
  toWorld(e) { const r = Nodes.area.getBoundingClientRect(); return { x: (e.clientX - r.left - Nodes.view.x) / Nodes.view.k, y: (e.clientY - r.top - Nodes.view.y) / Nodes.view.k }; },
  applyView() { Nodes.world.style.transform = `translate(${Nodes.view.x}px,${Nodes.view.y}px) scale(${Nodes.view.k})`; },
  addMenu(x, y, at) {
    const p = at || (() => { const r = Nodes.area.getBoundingClientRect(); return { x: (r.width / 2 - Nodes.view.x) / Nodes.view.k - 120, y: (r.height / 2 - Nodes.view.y) / Nodes.view.k - 60 }; })();
    UI.showMenuList(Nodes.ORDER.map(t => ({ label: Nodes.TYPES[t].title, action: () => Nodes.add(t, p.x, p.y) })), x, y);
  },
  render() {
    if (!Nodes.world) return;
    Nodes.world.querySelectorAll('.nd').forEach(n => n.remove());
    for (const n of Nodes.g.nodes) Nodes.world.append(Nodes.nodeEl(n));
    Nodes.applyView();
    requestAnimationFrame(Nodes.drawEdges);
  },
  paint(id) {
    const old = Nodes.world && Nodes.world.querySelector(`.nd[data-id="${id}"]`);
    const n = Nodes.node(id);
    if (old && n) { old.replaceWith(Nodes.nodeEl(n)); Nodes.drawEdges(); }
  },
  portPos(id, port, out) {
    const el = Nodes.world.querySelector(`.nd[data-id="${id}"] .nd-port[data-port="${port}"][data-out="${out ? 1 : 0}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), w = Nodes.world.getBoundingClientRect(), k = Nodes.view.k;
    return { x: (r.left + r.width / 2 - w.left) / k, y: (r.top + r.height / 2 - w.top) / k };
  },
  drawEdges(temp) {
    const svg = Nodes.svg; if (!svg) return;
    svg.innerHTML = '';
    const path = (a, b, cls) => {
      const d = `M${a.x},${a.y} C${a.x + 80},${a.y} ${b.x - 80},${b.y} ${b.x},${b.y}`;
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('class', cls || 'nd-edge');
      svg.append(p); return p;
    };
    for (const e of Nodes.g.edges) {
      const a = Nodes.portPos(e.from, e.fport, true), b = Nodes.portPos(e.to, e.tport, false);
      if (!a || !b) continue;
      const p = path(a, b);
      p.addEventListener('click', () => { Nodes.g.edges = Nodes.g.edges.filter(x => x !== e); Nodes.dirty(e.to); Nodes.render(); Nodes.autosave(); });
      p.innerHTML = '<title>Щелчок — удалить связь</title>';
    }
    if (temp && temp.a && temp.b) path(temp.a, temp.b, 'nd-edge temp');
  },
  preview(v) {
    if (!v) return null;
    if (Array.isArray(v)) {
      const box = h('div', { class: 'nd-batch' }, v.slice(0, 12).map(x => Nodes.preview(x)));
      if (v.length > 12) box.append(h('span', { class: 'muted' }, '+' + (v.length - 12)));
      return box;
    }
    if (v.kind === 'text') return h('div', { class: 'nd-text' }, v.text.slice(0, 400));
    if (v.kind === 'svg') { const u = URL.createObjectURL(new Blob([v.text], { type: 'image/svg+xml' })); return h('img', { class: 'nd-img', src: u, onclick: () => Nodes.open(v, u) }); }
    if (!v.url) v.url = URL.createObjectURL(v.blob);
    if (v.kind === 'video') return h('video', { class: 'nd-img', src: v.url, muted: true, loop: true, autoplay: true, onclick: () => Nodes.open(v, v.url) });
    return h('img', { class: 'nd-img', src: v.url, onclick: () => Nodes.open(v, v.url) });
  },
  open(v, url) {
    const media = v.kind === 'video' ? h('video', { src: url, controls: true, autoplay: true, style: { maxWidth: '80vw', maxHeight: '70vh' } }) : h('img', { src: url, style: { maxWidth: '80vw', maxHeight: '70vh', background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0/16px 16px' } });
    UI.dialog('Результат', media, [{ label: 'Сохранить…', action: () => { Host.saveFile(v.name || (v.kind === 'video' ? 'видео.mp4' : v.kind === 'svg' ? 'вектор.svg' : 'картинка.png'), v.kind === 'svg' ? v.text : v.blob); return false; } }, { label: 'Закрыть', primary: true }]);
  },
  nodeEl(n) {
    const T = Nodes.TYPES[n.type];
    const st = Nodes.status[n.id] || {};
    const el = h('div', { class: 'nd' + (Nodes.sel === n.id ? ' sel' : '') + (st.s ? ' ' + st.s : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', '--c': T.color } });
    const head = h('div', { class: 'nd-head' }, h('span', {}, T.title), h('span', { class: 'grow' }),
      h('button', { class: 'ib', title: 'Выполнить этот узел (и всё, что перед ним)', onclick: e => { e.stopPropagation(); Nodes.run(n.id); } }, '▶'),
      h('button', { class: 'ib', title: 'Удалить', onclick: e => { e.stopPropagation(); Nodes.remove(n.id); } }, '×'));
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      Nodes.sel = n.id;
      Nodes.world.querySelectorAll('.nd').forEach(x => x.classList.toggle('sel', x === el));
      const x0 = e.clientX, y0 = e.clientY, nx = n.x, ny = n.y;
      head.setPointerCapture(e.pointerId);
      const mv = ev => { n.x = nx + (ev.clientX - x0) / Nodes.view.k; n.y = ny + (ev.clientY - y0) / Nodes.view.k; el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; Nodes.drawEdges(); };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); Nodes.autosave(); };
      head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up);
    });
    const ports = h('div', { class: 'nd-ports' });
    const ins = h('div', { class: 'nd-ins' }), outs = h('div', { class: 'nd-outs' });
    for (const [name, kind, multi] of T.inputs || []) ins.append(h('div', { class: 'nd-pr' }, h('span', { class: 'nd-port k-' + kind, 'data-port': name, 'data-out': 0, title: kind + (multi ? ' (несколько)' : '') }), h('span', {}, name)));
    for (const [name, kind] of T.outputs || []) {
      const port = h('span', { class: 'nd-port k-' + kind, 'data-port': name, 'data-out': 1, title: 'Тяните к входу другого узла' });
      port.addEventListener('pointerdown', e => Nodes.dragEdge(e, n, name));
      outs.append(h('div', { class: 'nd-pr out' }, h('span', {}, name), port));
    }
    ports.append(ins, outs);
    const body = h('div', { class: 'nd-body' });
    for (const [key, kind, label] of T.params) body.append(Nodes.paramEl(n, key, kind, label));
    el.append(head, ports, body);
    if (st.s === 'run') body.append(h('div', { class: 'nd-st' }, h('span', { class: 'spin' }), ' ' + (st.note || 'выполняется…')));
    if (st.s === 'err') body.append(h('div', { class: 'nd-st err' }, st.note));
    const res = Nodes.results[n.id];
    if (res) body.append(Nodes.preview(res));
    el.addEventListener('pointerdown', () => { Nodes.sel = n.id; });
    return el;
  },
  paramEl(n, key, kind, label) {
    const P = n.params;
    const set = v => { P[key] = v; Nodes.dirty(n.id); Nodes.autosave(); };
    const stop = i => { i.addEventListener('keydown', e => e.stopPropagation()); i.addEventListener('pointerdown', e => e.stopPropagation()); return i; };
    if (kind === 'textarea') return stop(h('textarea', { rows: 3, placeholder: label, value: P[key] || '', onchange: e => set(e.target.value) }));
    if (kind === 'text' || kind === 'json') return stop(h('input', { type: 'text', placeholder: label, value: P[key] || '', onchange: e => set(e.target.value) }));
    if (kind === 'number') return h('label', { class: 'nd-l' }, label + ' ', stop(h('input', { type: 'number', class: 'num', value: P[key] ?? '', onchange: e => set(+e.target.value) })));
    if (kind.startsWith('select:')) {
      const opts = kind.slice(7).split('|').map(s => s.split('='));
      return h('label', { class: 'nd-l' }, label + ' ', stop(UI.sel(opts, P[key] || opts[0][0], v => set(v), '', 150)));
    }
    if (kind.startsWith('model:')) {
      // модель — из списка Polza (▾) или вручную
      const [, type, auto] = kind.split(':');
      return ModelPick.el(type, P[key] || '', v => set(v), { auto: !!auto || type === 'chat', placeholder: label });
    }
    if (kind === 'file') {
      const b = h('button', { class: 'pbt', onclick: async () => {
        const [f] = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.gif,.bmp', false, 'Картинка');
        if (!f) return;
        const rec = { name: f.name, path: f.path };
        const blob = await Host.blobOf(f);
        if (!f.path) rec.data = await Polza.dataURL(blob);
        try { rec.thumb = await Polza.thumb(blob, 360, 'image/png'); } catch (e) { }
        set(rec); Nodes.paint(n.id);
      } }, P[key] ? '🖼 ' + P[key].name : 'Выбрать картинку…');
      if (!P[key] || Nodes.results[n.id]) return b;
      // превью выбранной картинки — сразу, не дожидаясь запуска
      const src = P[key].thumb || P[key].data || (P[key].path && Host.desktop ? Host.fileURL(P[key].path) : '');
      if (!src) return b;
      return h('div', { class: 'nd-file' }, b, h('img', { class: 'nd-img', src, onerror: e => { e.target.remove(); } }));
    }
    if (kind === 'folder') {
      return h('button', { class: 'pbt', onclick: async () => {
        const f = await Host.pickFolder('Папка');
        if (!f) return;
        Nodes.folders[n.id] = f; set({ name: f.name, root: f.root }); Nodes.paint(n.id);
      } }, P[key] ? '📁 ' + P[key].name : 'Выбрать папку…');
    }
    return h('span');
  },
  dragEdge(e, n, port) {
    e.stopPropagation(); e.preventDefault();
    const a = Nodes.portPos(n.id, port, true);
    const mv = ev => Nodes.drawEdges({ a, b: Nodes.toWorld(ev) });
    const up = ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const p = t && t.closest('.nd-port[data-out="0"]');
      if (p) Nodes.connect(n.id, port, p.closest('.nd').dataset.id, p.dataset.port);
      else Nodes.drawEdges();
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  },
  // ---------- шаблоны ----------
  TEMPLATES: {
    photoToVideo: ['Фото продукта → новый фон → видео', g => {
      const img = g('image', 0, 0), p1 = g('text', 0, 230, { text: 'Product on a marble table in a bright modern kitchen, soft morning light, photorealistic' });
      const bg = g('removeBg', 300, 0), gen = g('genImage', 560, 60), p2 = g('text', 560, 330, { text: 'Slow cinematic camera push-in, soft light, steam rising' });
      const vid = g('genVideo', 860, 120), save = g('save', 1160, 140, { name: 'ролик' });
      return [[img, 'image', bg, 'image'], [bg, 'image', gen, 'refs'], [p1, 'text', gen, 'prompt'], [gen, 'image', vid, 'image'], [p2, 'text', vid, 'prompt'], [vid, 'video', save, 'in']];
    }],
    batchBg: ['Папка фото → без фона → сохранить', g => {
      const f = g('folder', 0, 0), bg = g('removeBg', 300, 0), s = g('save', 600, 0, { name: 'без-фона' });
      return [[f, 'images', bg, 'image'], [bg, 'image', s, 'in']];
    }],
    promptIdeas: ['Идея → промпты моделью → картинки', g => {
      const t = g('text', 0, 0, { text: 'Баннер для кофейни: осенняя акция на латте' });
      const l = g('llm', 300, 0, { instruction: 'Напиши один подробный промпт на английском для генерации рекламной картинки по идее ниже. Только промпт.' });
      const gi = g('genImage', 600, 0), s = g('toApp', 900, 0, { where: 'vektor' });
      return [[t, 'text', l, 'text'], [l, 'text', gi, 'prompt'], [gi, 'image', s, 'in']];
    }],
    vectorBrand: ['Картинка → вектор в фирменных цветах', g => {
      const i = g('image', 0, 0), v = g('vectorize', 300, 0, { colors: 6, palette: '#E30613, #1D1D1B, #FFFFFF' }), s = g('toApp', 600, 0, { where: 'vektor' });
      return [[i, 'image', v, 'image'], [v, 'svg', s, 'in']];
    }],
    mockupSeries: ['Мокап: папка дизайнов на фото объекта', g => {
      const b = g('image', 0, 0), d = g('folder', 0, 200), m = g('mockup', 320, 60), s = g('save', 640, 60, { name: 'мокап' });
      return [[b, 'image', m, 'base'], [d, 'images', m, 'design'], [m, 'image', s, 'in']];
    }],
    figmaAnimate: ['Кадр из «Фигмы» → оживить видео → «Моушн»', g => {
      const f = g('figma', 0, 0), p = g('text', 0, 160, { text: 'Subtle parallax motion, elements gently float, smooth loop' });
      const v = g('genVideo', 300, 40), m = g('toApp', 620, 60, { where: 'motion' });
      return [[f, 'image', v, 'image'], [p, 'text', v, 'prompt'], [v, 'video', m, 'in']];
    }],
  },
  templatesMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    UI.showMenuList(Object.entries(Nodes.TEMPLATES).map(([k, [l]]) => ({ label: l, action: () => { Nodes.template(k); Nodes.render(); Nodes.autosave(); } })), r.left, r.bottom);
  },
  template(k) {
    const ox = Nodes.g.nodes.length ? Math.max(...Nodes.g.nodes.map(n => n.y)) + 360 : 0;
    const mk = (type, x, y, params) => { const n = { id: Nodes.uid(), type, x, y: y + ox, params: Object.assign({}, Nodes.defaults(type), params || {}) }; Nodes.g.nodes.push(n); return n; };
    for (const [a, ap, b, bp] of Nodes.TEMPLATES[k][1](mk)) Nodes.g.edges.push({ from: a.id, fport: ap, to: b.id, tport: bp });
  },
  // ---------- сохранение ----------
  autosave() { try { localStorage.setItem('vektor.nodes', JSON.stringify(Nodes.g)); } catch (e) { } },
  load() { try { const g = JSON.parse(localStorage.getItem('vektor.nodes') || 'null'); if (g && g.nodes) Nodes.g = g; } catch (e) { } },
  async save() {
    const name = 'схема.vkn';
    await Host.saveFile(name, JSON.stringify({ app: 'Вектор · Ноды', graph: Nodes.g }, null, 1), 'application/json', 'vkn');
  },
  async openDialog() {
    const [f] = await Host.pickFiles('.vkn,.json', false, 'Схема нод');
    if (!f) return;
    try { const js = JSON.parse(new TextDecoder().decode(await f.read())); Nodes.g = js.graph || js; Nodes.results = {}; Nodes.status = {}; Nodes.render(); Nodes.autosave(); }
    catch (e) { UI.toast('Не удалось открыть схему', true); }
  },
  pendingDialog() {
    const list = Polza.pending();
    const box = h('div', { class: 'form', style: { minWidth: '480px' } });
    if (!list.length) box.append(h('p', { class: 'muted' }, 'Незабранных заказов нет.'));
    for (const p of list) {
      const st = h('span', { class: 'muted' });
      box.append(h('div', { class: 'row' }, h('span', {}, `${new Date(p.at).toLocaleString('ru')} · ${p.model} · ${p.prompt.slice(0, 50)}`), h('span', { class: 'grow' }), st,
        h('button', { class: 'pbt', onclick: async () => {
          st.textContent = 'проверяю…';
          try {
            const b = await Polza.collect(p.id, p.type);
            if (!b) { st.textContent = 'ещё не готово'; return; }
            st.textContent = 'готово';
            await Host.saveFile('polza-' + p.id + (p.type === 'video' ? '.mp4' : '.png'), b);
          } catch (e) { st.textContent = e.message; }
        } }, 'Забрать'),
        h('button', { class: 'ib', title: 'Убрать из списка', onclick: e => { Polza.setPending(Polza.pending().filter(x => x.id !== p.id)); e.target.closest('.row').remove(); } }, '×')));
    }
    UI.dialog('Незабранные заказы Polza', box, [{ label: 'Закрыть', primary: true }]);
  },
};
