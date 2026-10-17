// Рабочие пространства: «Вектор» (CorelDRAW), «Фигма» (встроенный редактор OpenPencil),
// «Моушн», «Ноды», «Make». Плюс ИИ-обработка картинок через Polza в самом «Векторе».
'use strict';

const WS = {
  current: 'vektor',
  LIST: [['vektor', 'Вектор', 'Векторная графика и вёрстка в духе CorelDRAW'], ['figma', 'Фигма', 'Интерфейсы, компоненты, автолейаут, файлы .fig, плагины'], ['photo', 'Фото', 'Растровый редактор как Photoshop, обработка как Lightroom, PSD'],
    ['motion', 'Моушн', 'Анимация кадров на фоне фото или видео, ИИ-агент, экспорт в MP4/WebM'], ['nodes', 'Ноды', 'Генерация картинок и видео цепочками моделей Polza'],
    ['make', 'Make', 'Интерактивный прототип или страница по описанию']],
  mods: {},
  init() {
    const bar = h('div', { id: 'wsTabs', class: 'wstabs' });
    for (const [k, l, t] of WS.LIST) bar.append(h('button', { class: 'wst' + (k === 'vektor' ? ' on' : ''), 'data-ws': k, title: t, onclick: () => WS.show(k) }, l));
    document.body.append(bar);
    WS.host = h('div', { id: 'wsHost', class: 'wshost' });
    document.body.append(WS.host);
    WS.mods = { figma: FigmaWS, photo: typeof PhotoWS !== 'undefined' ? PhotoWS : null, motion: typeof Motion !== 'undefined' ? Motion : null, nodes: typeof Nodes !== 'undefined' ? Nodes : null, make: typeof Make !== 'undefined' ? Make : null };
  },
  show(name) {
    if (Tools.text && Tools.text.editing) Tools.text.commit();
    UI.closeMenus();
    WS.current = name;
    document.querySelectorAll('#wsTabs .wst').forEach(b => b.classList.toggle('on', b.dataset.ws === name));
    document.body.classList.toggle('ws-other', name !== 'vektor');
    for (const [k, m] of Object.entries(WS.mods)) {
      if (!m) continue;
      if (k === name && !m.el) { m.el = m.build(); m.el.classList.add('ws-pane'); WS.host.append(m.el); }
      if (m.el) m.el.style.display = k === name ? '' : 'none';
      if (k === name && m.shown) m.shown();
    }
    if (name === 'vektor') UI.refresh();
  },
  active() { return WS.current !== 'vektor'; },
};

// ---------- общий чат с агентом для рабочих пространств ----------
function ChatBox({ placeholder, quick = [], empty, onSend, onStop }) {
  const el = h('div', { class: 'chatbox' });
  const log = h('div', { class: 'ag-log' });
  const status = h('div', { class: 'ag-status', style: { display: 'none' } });
  const ta = h('textarea', { rows: 3, placeholder: placeholder || 'Задача агенту… (Ctrl+Enter — отправить)' });
  const send = h('button', { class: 'primary' }, 'Отправить');
  const stop = h('button', { class: 'pbt', style: { display: 'none' } }, '■ Стоп');
  const q = h('div', { class: 'ag-quick' }, quick.map(([l, t]) => h('button', { class: 'ag-q', title: t, onclick: () => { ta.value = t; ta.focus(); } }, l)));
  // модель агента — выбирается прямо здесь из списка Polza (общая для всех агентов)
  const mp = ModelPick.el('chat', Agent.settings.model, v => { if (v) { Agent.settings.model = v; Agent.saveSettings(); if (Agent.el) Agent.renderMaterials && Agent.renderMaterials(); } }, { width: 230 });
  el.append(log, q, status, h('div', { class: 'ag-input' }, ta, h('div', { class: 'ag-btns' }, h('span', { class: 'ag-ml', title: 'Модель агента (Polza)' }, 'Модель ', mp), h('span', { class: 'grow' }), stop, send)));
  const items = [];
  const api = {
    el, running: false, stopFlag: false,
    render() {
      log.innerHTML = '';
      if (!items.length && empty) log.append(h('div', { class: 'ag-empty' }, ...[].concat(empty).map(t => h('p', {}, t))));
      for (const m of items) {
        if (m.type === 'tool') {
          const d = h('div', { class: 'ag-tool ' + (m.status || '') }, h('span', { class: 'ag-dot' }), m.label + (m.error ? ' — ' + m.error : ''));
          if (m.image) d.append(h('img', { src: m.image, class: 'ag-thumb', onclick: () => UI.dialog('Изображение', h('img', { src: m.image, style: { maxWidth: '80vw', maxHeight: '75vh' } })) }));
          log.append(d);
        } else {
          const d = h('div', { class: 'ag-msg ' + (m.type === 'assistant' ? 'assistant' : m.type) });
          d.innerHTML = Agent.md(m.text);
          log.append(d);
        }
      }
      log.scrollTop = log.scrollHeight;
      send.disabled = api.running; stop.style.display = api.running ? '' : 'none';
    },
    push(m) { items.push(m); api.render(); return m; },
    clear() { items.length = 0; api.render(); },
    status(t) { status.textContent = t || ''; status.style.display = t ? '' : 'none'; },
    // события цикла Polza.agent → строки чата
    event(labelOf) {
      return ev => {
        if (ev.type === 'status') api.status(ev.text);
        else if (ev.type === 'tool') { ev.label = labelOf ? labelOf(ev.name, ev.args) : ev.name; items.push(ev); api.status(ev.label); api.render(); }
        else if (ev.type === 'tool-done') api.render();
        else api.push(ev);
      };
    },
  };
  const go = async () => {
    const t = ta.value.trim(); if (!t || api.running) return;
    ta.value = '';
    api.running = true; api.stopFlag = false;
    api.push({ type: 'user', text: t });
    try { await onSend(t, api); } catch (e) { console.error(e); api.push({ type: 'error', text: e.message || String(e) }); }
    finally { api.running = false; api.status(''); api.render(); }
  };
  send.onclick = go;
  stop.onclick = () => { api.stopFlag = true; if (onStop) onStop(); };
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
  api.render();
  return api;
}

// ---------- ожидание и прогресс для долгих операций ----------
async function withBusy(label, fn) {
  UI.busy(label);
  try { return await fn(s => UI.busy(label + (s ? ' (' + ({ pending: 'в очереди', processing: 'идёт', in_progress: 'идёт', queued: 'в очереди' }[s] || s) + ')' : ''))); }
  catch (e) { console.error(e); UI.toast(e.message || String(e), true); return null; }
  finally { UI.busy(null); }
}

// =====================================================================
// «Фигма»: встроенный OpenPencil (MIT) — .fig/.pen, компоненты, автолейаут, Plugin API
// =====================================================================
const FigmaWS = {
  el: null, frame: null, ready: null,
  build() {
    const el = h('div', { class: 'figws' });
    const B = (label, title, fn) => h('button', { class: 'pbt', title, onclick: fn }, label);
    const bar = h('div', { class: 'wsbar' },
      B('Открыть .fig / .pen', 'Открыть файл Figma или Pencil с диска', () => FigmaWS.openDialog()),
      B('Из Figma по ссылке', 'Забрать кадры из Figma по ссылке и личному токену', () => FigmaWS.importByLink()),
      B('Плагины ▾', 'Плагины Figma: загрузить из папки и запустить', e => FigmaWS.pluginsMenu(e.currentTarget)),
      h('span', { class: 'sep' }),
      B('Изображение ▾', 'Коррекция, фильтры и эффекты, кадрирование, удаление фона, вставка картинки', e => FigTools.menuImage(e.currentTarget)),
      B('Вектор ▾', 'Упростить кривую, стрелки, векторизация', e => FigTools.menuVector(e.currentTarget)),
      h('span', { class: 'sep' }),
      h('span', { class: 'muted' }, 'ИИ (Polza):'),
      B('Удалить фон', 'Вырезать фон у выделенного изображения', () => FigmaWS.ai('bg')),
      B('Увеличить', 'Апскейл выделенного изображения', () => FigmaWS.ai('upscale')),
      B('В вектор', 'Векторизовать выделенное изображение в SVG-слои', () => FigmaWS.ai('vector')),
      B('Сгенерировать…', 'Картинка по описанию (выделение — как референс)', () => FigmaWS.ai('gen')),
      B('Мокап…', 'Выделение — дизайном на фото объекта (футболка, кружка, упаковка…)', async () => { let design = null; try { design = await FigmaWS.selectionImage(); } catch (e) { } Mockup.open({ design }); }),
      h('span', { class: 'sep' }),
      B('→ Вектор', 'Выделение (или страницу) — в документ «Вектора» как редактируемые кривые', () => FigmaWS.toVektor()),
      B('← из Вектора', 'Выделенное в «Векторе» — сюда', () => FigmaWS.fromVektor()),
      B('→ Моушн', 'Выделенные кадры — слоями в «Моушн»', () => FigmaWS.toMotion()),
      h('span', { class: 'grow' }),
      DS.chip(),
      B('⚙ Polza', 'Модели Polza для картинок и видео', () => Polza.settingsDialog()));
    const frame = h('iframe', { class: 'figframe', src: 'figma/index.html', allow: 'clipboard-read; clipboard-write; local-fonts' });
    const missing = h('div', { class: 'figmissing', style: { display: 'none' } },
      h('h3', {}, 'Редактор «Фигма» не собран'),
      h('p', {}, 'В настольной программе он уже внутри. Для запуска из исходников соберите его один раз: установите bun (bun.sh) и выполните в папке vektor:'),
      h('pre', {}, 'node tools/figma/build.mjs'));
    el.append(bar, frame, missing);
    FigmaWS.frame = frame;
    fetch('figma/index.html', { method: 'HEAD' }).then(r => { if (!r.ok) throw 0; }).catch(() => { frame.style.display = 'none'; missing.style.display = ''; });
    FigmaWS.ready = new Promise(res => {
      const check = () => { try { const w = frame.contentWindow; if (w && w.vkFigma) return res(w.vkFigma); } catch (e) { } setTimeout(check, 300); };
      frame.addEventListener('load', check); check();
    });
    return el;
  },
  async api() {
    if (WS.current !== 'figma') WS.show('figma');
    const t = setTimeout(() => UI.busy('Запускаю редактор…'), 400);
    try { return await FigmaWS.ready; } finally { clearTimeout(t); UI.busy(null); }
  },
  async openBuffer(buf, name) {
    const api = await FigmaWS.api();
    try { await api.open(buf instanceof ArrayBuffer ? buf : await Host.toBuffer(buf), name); } catch (e) { UI.toast('Не удалось открыть ' + name + ': ' + (e.message || e), true); }
  },
  async openDialog() {
    const files = await Host.pickFiles('.fig,.pen', true, 'Открыть файлы Figma');
    for (const f of files) await FigmaWS.openBuffer(await f.read(), f.name);
  },
  async selectionImage() {
    const api = await FigmaWS.api();
    const sel = api.selection();
    if (!sel.length) throw new Error('Выделите изображение или слой в «Фигме»');
    const buf = await api.exportPNG(2);
    if (!buf) throw new Error('Не удалось получить картинку выделения');
    return new Blob([buf], { type: 'image/png' });
  },
  async ai(kind) {
    if (kind === 'gen') return FigmaWS.genDialog();
    const api = await FigmaWS.api();
    let img;
    try { img = await FigmaWS.selectionImage(); } catch (e) { return UI.toast(e.message, true); }
    const labels = { bg: 'Удаляю фон', upscale: 'Увеличиваю', vector: 'Векторизую' };
    if (kind === 'vector') return Polza.vectorizeDialog(img, async svg => { await api.pasteSVG(svg); UI.toast('Готово: вектор добавлен рядом'); });
    if (!await Polza.choose([kind, 'edit'], { bg: 'Удалить фон', upscale: 'Апскейл' }[kind])) return;
    await withBusy(labels[kind] + '…', async onStatus => {
      if (kind === 'vector') {
        const svg = await Polza.vectorize(img, { onStatus });
        await api.pasteSVG(svg);
      } else {
        const out = kind === 'bg' ? await Polza.removeBackground(img, { onStatus }) : await Polza.upscale(img, { onStatus });
        await api.placeImages([{ bytes: await out.arrayBuffer(), name: (kind === 'bg' ? 'без фона' : 'апскейл') + '.png', type: out.type || 'image/png' }]);
      }
      UI.toast('Готово: результат добавлен рядом');
    });
  },
  genDialog() {
    const prompt = h('textarea', { rows: 4, class: 'wide', placeholder: 'Что нарисовать: «иллюстрация кофейни в плоском стиле, тёплые цвета»' });
    const useSel = h('input', { type: 'checkbox' });
    UI.dialog('Сгенерировать картинку (Polza)', h('div', { class: 'form' }, h('label', {}, 'Описание', prompt), h('label', { class: 'row' }, useSel, ' Выделение — как референс'), Polza.pickRow('image'), Polza.pickRow('edit', 'С референсом')),
      [{ label: 'Отмена' }, { label: 'Сгенерировать', primary: true, action: () => {
        const p = prompt.value.trim(); if (!p) return false;
        withBusy('Генерирую…', async onStatus => {
          const api = await FigmaWS.api();
          const images = useSel.checked ? [await FigmaWS.selectionImage()] : [];
          const out = await Polza.generateImage(p, { images, onStatus });
          await api.placeImages([{ bytes: await out.arrayBuffer(), name: 'генерация.png', type: out.type || 'image/png' }]);
        });
      } }]);
  },
  async toVektor() {
    const api = await FigmaWS.api();
    const svg = api.exportSVG();
    if (!svg) return UI.toast('Нечего переносить');
    WS.show('vektor');
    IO.importSVGText(svg, null);
    App.commit('Из «Фигмы»');
    UI.toast('Перенесено в «Вектор»');
  },
  async fromVektor() {
    if (!App.sel.length) return UI.toast('Сначала выделите объекты в «Векторе»');
    const r = IO.svgFor('sel', true);
    const api = await FigmaWS.api();
    await api.pasteSVG(r.svg);
  },
  async toMotion() {
    const api = await FigmaWS.api();
    let sel = api.selection();
    if (!sel.length) sel = api.frames();
    if (!sel.length) return UI.toast('Выделите кадры в «Фигме»');
    await withBusy('Готовлю кадры…', async () => {
      const items = [];
      for (const s of sel) {
        const buf = await api.exportPNG(2, [s.id]);
        if (buf) items.push({ blob: new Blob([buf], { type: 'image/png' }), name: s.name || 'Кадр' });
      }
      WS.show('motion');
      await Motion.addImages(items);
    });
  },

  // ---------- плагины Figma ----------
  async pluginsMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    const list = await PluginStore.list();
    UI.showMenuList([
      { label: 'Загрузить плагин из папки…', action: () => FigmaWS.loadPlugin() },
      { label: 'Где взять плагины', action: () => FigmaWS.pluginHelp() },
      ...(list.length ? ['-'] : []),
      ...list.map(p => ({ label: '▶ ' + p.name, action: () => FigmaWS.runPlugin(p) })),
      ...(list.length ? ['-', { label: 'Удалить плагин…', action: () => FigmaWS.removePlugin(list) }] : []),
    ], r.left, r.bottom);
  },
  async loadPlugin() {
    const f = await Host.pickFolder('Папка плагина Figma (с manifest.json)');
    if (!f) return;
    const man = f.files.filter(x => /(^|\/)manifest\.json$/i.test(x.rel)).sort((a, b) => a.rel.split('/').length - b.rel.split('/').length)[0];
    if (!man) return UI.toast('В папке нет manifest.json', true);
    const dir = man.rel.replace(/manifest\.json$/i, '');
    let m; try { m = JSON.parse(new TextDecoder().decode(await man.read())); } catch (e) { return UI.toast('manifest.json не разобран', true); }
    const read = async rel => {
      const p = (dir + rel).replace(/^\.\//, '').replace(/\/\.\//g, '/');
      const e = f.files.find(x => x.rel === p) || f.files.find(x => x.rel.endsWith('/' + rel.replace(/^\.\//, '')));
      if (!e) throw new Error('Нет файла плагина: ' + rel);
      return new TextDecoder().decode(await e.read());
    };
    try {
      const plugin = { id: m.id || m.name, name: m.name || f.name, code: await read(m.main), html: '', uiFiles: {} };
      if (typeof m.ui === 'string') plugin.html = await read(m.ui);
      else if (m.ui && typeof m.ui === 'object') for (const [k, v] of Object.entries(m.ui)) plugin.uiFiles[k] = await read(v);
      if (!plugin.html && plugin.uiFiles.main) plugin.html = plugin.uiFiles.main;
      await PluginStore.put(plugin);
      UI.toast('Плагин добавлен: ' + plugin.name);
      FigmaWS.runPlugin(plugin);
    } catch (e) { UI.toast(e.message, true); }
  },
  async runPlugin(p) {
    const api = await FigmaWS.api();
    try { await api.runPlugin(p); } catch (e) { console.error(e); UI.toast('Плагин «' + p.name + '»: ' + (e.message || e), true); }
  },
  removePlugin(list) {
    const sel = UI.sel(list.map(p => [p.id, p.name]), list[0].id, () => { });
    UI.dialog('Удалить плагин', sel, [{ label: 'Отмена' }, { label: 'Удалить', primary: true, action: () => { PluginStore.del(sel.value || sel.querySelector('select').value); } }]);
  },
  pluginHelp() {
    UI.dialog('Плагины Figma', h('div', { class: 'form', style: { maxWidth: '560px' } },
      h('p', {}, 'Плагин Figma — это папка с manifest.json, кодом (main) и интерфейсом (ui). Такие папки запускаются здесь через тот же Figma Plugin API: плагин создаёт и меняет слои, показывает своё окно, хранит настройки.'),
      h('p', {}, 'Где взять: у плагинов с открытым кодом (на GitHub их тысячи: поиск «figma plugin») скачайте и соберите исходники, затем «Загрузить плагин из папки». Свои плагины — из папки разработки Figma.'),
      h('p', { class: 'muted' }, 'Плагины из каталога сообщества Figma распространяются только внутри самой Figma — скачать их код напрямую нельзя. Файлы сообщества (UI-киты, шаблоны) можно: откройте файл в Figma → «Save local copy» и откройте .fig здесь, или заберите кадры кнопкой «Из Figma по ссылке». Часть функций Plugin API (командные меню, оплата, сетевые права из manifest) здесь не поддерживается.')),
    [{ label: 'Понятно', primary: true }]);
  },

  // ---------- импорт из Figma по ссылке (REST API, личный токен) ----------
  importByLink() {
    const link = h('input', { type: 'text', class: 'wide', placeholder: 'https://www.figma.com/design/XXXXXXXX/…' });
    const token = h('input', { type: 'password', class: 'wide', value: localStorage.getItem('vektor.figmaToken') || '', placeholder: 'figd_…' });
    const fmt = UI.sel([['svg', 'SVG — редактируемые слои'], ['png', 'PNG — картинки 2x']], 'svg', () => { });
    const target = UI.sel([['figma', 'В «Фигму»'], ['vektor', 'В «Вектор»'], ['motion', 'В «Моушн» (кадрами)']], 'figma', () => { });
    UI.dialog('Кадры из Figma', h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Нужен личный токен Figma: figma.com → Settings → Security → Personal access tokens (права File content: read). Токен хранится только на этом компьютере. Файлы сообщества сначала скопируйте к себе («Open in Figma»).'),
      h('label', {}, 'Ссылка на файл или кадр', link), h('label', {}, 'Личный токен', token), h('label', {}, 'Формат', fmt), h('label', {}, 'Куда', target)),
    [{ label: 'Отмена' }, { label: 'Дальше', primary: true, action: () => {
      localStorage.setItem('vektor.figmaToken', token.value.trim());
      FigmaWS.pickFrames(link.value.trim(), token.value.trim(), (fmt.value || fmt.querySelector('select').value), (target.value || target.querySelector('select').value));
    } }]);
  },
  async figmaGet(path, token) {
    const r = await fetch(Host.net('https://api.figma.com/v1' + path), { headers: { 'X-Figma-Token': token } });
    const js = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Figma API (' + r.status + '): ' + (js.err || js.message || r.statusText));
    return js;
  },
  async pickFrames(link, token, fmt, target) {
    const m = link.match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
    if (!m) return UI.toast('Не похоже на ссылку Figma', true);
    const key = m[1];
    const nodeId = (link.match(/node-id=([0-9]+[-:][0-9]+)/) || [])[1];
    const file = await withBusy('Читаю файл Figma…', () => FigmaWS.figmaGet('/files/' + key + '?depth=2', token));
    if (!file) return;
    const box = h('div', { class: 'form', style: { maxHeight: '60vh', overflow: 'auto', minWidth: '420px' } });
    const checks = [];
    for (const page of file.document.children || []) {
      box.append(h('div', { class: 'muted', style: { marginTop: '6px' } }, page.name));
      for (const n of page.children || []) {
        const c = h('input', { type: 'checkbox', checked: nodeId ? n.id === nodeId.replace('-', ':') : false });
        checks.push([c, n]);
        box.append(h('label', { class: 'row' }, c, ' ' + n.name + ' ', h('span', { class: 'muted' }, n.type.toLowerCase())));
      }
    }
    UI.dialog('«' + file.name + '» — что забрать', box, [{ label: 'Отмена' }, { label: 'Забрать', primary: true, action: () => {
      const nodes = checks.filter(([c]) => c.checked).map(([, n]) => n);
      if (!nodes.length) return false;
      FigmaWS.fetchFrames(key, token, nodes, fmt, target);
    } }]);
  },
  async fetchFrames(key, token, nodes, fmt, target) {
    await withBusy('Забираю кадры из Figma…', async () => {
      const js = await FigmaWS.figmaGet(`/images/${key}?ids=${encodeURIComponent(nodes.map(n => n.id).join(','))}&format=${fmt}${fmt === 'png' ? '&scale=2' : '&svg_outline_text=false&svg_include_id=true'}`, token);
      const out = [];
      for (const n of nodes) {
        const url = js.images && js.images[n.id];
        if (!url) continue;
        const r = await fetch(Host.net(url));
        out.push({ name: n.name, blob: await r.blob() });
      }
      if (!out.length) throw new Error('Figma не отдала изображения');
      if (target === 'motion') {
        const imgs = fmt === 'svg' ? await Promise.all(out.map(async o => ({ name: o.name, blob: new Blob([await o.blob.text()], { type: 'image/svg+xml' }) }))) : out;
        WS.show('motion'); await Motion.addImages(imgs); return;
      }
      if (target === 'vektor') {
        WS.show('vektor');
        for (const o of out) { if (fmt === 'svg') IO.importSVGText(await o.blob.text(), null); else await IO.importRaster(o.blob, o.name); }
        App.commit('Из Figma'); return;
      }
      const api = await FigmaWS.api();
      for (const o of out) {
        if (fmt === 'svg') await api.pasteSVG(await o.blob.text());
        else await api.placeImages([{ bytes: await o.blob.arrayBuffer(), name: o.name + '.png', type: 'image/png' }]);
      }
      UI.toast('Забрано кадров: ' + out.length);
    });
  },
};

// ---------- хранилище плагинов (IndexedDB) ----------
const PluginStore = {
  db() {
    return PluginStore._db || (PluginStore._db = new Promise((res, rej) => {
      const r = indexedDB.open('vektor-plugins', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('plugins', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) { const db = await PluginStore.db(); return new Promise((res, rej) => { const t = db.transaction('plugins', mode); const q = fn(t.objectStore('plugins')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); },
  list() { return PluginStore.tx('readonly', s => s.getAll()).then(x => x || []).catch(() => []); },
  put(p) { return PluginStore.tx('readwrite', s => s.put(p)); },
  del(id) { return PluginStore.tx('readwrite', s => s.delete(id)); },
};

// =====================================================================
// ИИ-обработка в «Векторе»: фон, апскейл, векторизация, генерация (через Polza)
// =====================================================================
const AIOps = {
  selImage() {
    const o = App.selObjs().find(x => x.type === 'image');
    if (!o) UI.toast('Выделите изображение');
    return o;
  },
  async replaceHref(o, blob, label) {
    o.href = await Polza.dataURL(blob);
    App.commit(label);
    UI.refresh();
  },
  async removeBg() {
    const o = AIOps.selImage(); if (!o) return;
    if (!await Polza.choose(['bg', 'edit'], 'Удалить фон')) return;
    await withBusy('Удаляю фон…', async onStatus => AIOps.replaceHref(o, await Polza.removeBackground(o.href, { onStatus }), 'Удаление фона'));
  },
  async upscale() {
    const o = AIOps.selImage(); if (!o) return;
    if (!await Polza.choose(['upscale', 'edit'], 'Увеличить (апскейл)')) return;
    await withBusy('Увеличиваю…', async onStatus => AIOps.replaceHref(o, await Polza.upscale(o.href, { onStatus }), 'Апскейл'));
  },
  async vectorize() {
    const o = AIOps.selImage(); if (!o) return;
    Polza.vectorizeDialog(o.href, async svg => {
      const b = Model.worldBox(o);
      IO.importSVGText(svg, null);
      const v = Model.get(App.sel[0]);
      if (v && v !== o) { Agent.setBox(v, { x: b.x1, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1 }); v.name = (o.name || 'Изображение') + ' (вектор)'; o.visible = false; }
      App.commit('Векторизация'); UI.refresh();
      UI.toast('Готово. Исходное изображение скрыто (Диспетчер объектов)');
    });
  },
  generate() {
    const prompt = h('textarea', { rows: 4, class: 'wide', placeholder: 'Описание картинки' });
    const useSel = h('input', { type: 'checkbox', checked: !!App.selObjs().find(x => x.type === 'image') });
    UI.dialog('Сгенерировать картинку (Polza)', h('div', { class: 'form' }, h('label', {}, 'Описание', prompt), h('label', { class: 'row' }, useSel, ' Выделенные изображения — как референсы'), Polza.pickRow('image'), Polza.pickRow('edit', 'С референсами')),
      [{ label: 'Отмена' }, { label: 'Сгенерировать', primary: true, action: () => {
        const p = prompt.value.trim(); if (!p) return false;
        const refs = useSel.checked ? App.selObjs().filter(x => x.type === 'image').map(x => x.href) : [];
        withBusy('Генерирую…', async onStatus => { await IO.importRaster(await Polza.generateImage(p, { images: refs, onStatus }), 'Генерация'); });
      } }]);
  },
  toFigma() { FigmaWS.fromVektor(); },
  async develop() {
    const o = AIOps.selImage(); if (!o) return;
    const img = await Polza.loadImage(o.href);
    Develop.open(img, { title: 'Обработка: ' + (o.name || 'фото'), done: c => { o.href = c.toDataURL(o.href.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.92); App.commit('Обработка фото'); UI.refresh(); } });
  },
  // мокап: выделенное (или страница) — дизайн; фото выбирается в студии
  async mockup() {
    let design = null;
    if (App.sel.length) { try { design = await Mockup.vektorSelectionBlob(); } catch (e) { } }
    Mockup.open({ design });
  },
  async toMotion() {
    const kind = App.sel.length ? 'sel' : 'page';
    const r = IO.svgFor(kind, kind === 'sel');
    if (!r) return;
    const { blob } = await IO.rasterize(r.svg, r.w, r.h, 200, 'png', kind === 'sel' ? null : (App.pg().color || '#ffffff'));
    WS.show('motion');
    await Motion.addImages([{ blob, name: kind === 'sel' ? 'Из Вектора' : App.pg().name || 'Страница' }]);
  },
  menu() {
    const img = () => App.selObjs().some(o => o.type === 'image');
    return { label: 'ИИ', items: [
      { label: 'Дизайн-системы (папки на компьютере)…', action: () => DS.dialog() },
      '-',
      { label: 'Удалить фон', action: AIOps.removeBg, disabled: () => !img() },
      { label: 'Увеличить (апскейл)', action: AIOps.upscale, disabled: () => !img() },
      { label: 'Векторизовать (цвета, детализация, палитра)…', action: AIOps.vectorize, disabled: () => !img() },
      { label: 'Сгенерировать картинку…', action: AIOps.generate },
      { label: 'Мокап: дизайн на фото объекта…', action: AIOps.mockup },
      { label: 'Обработка фото (как Lightroom)…', action: AIOps.develop, disabled: () => !img() },
      { label: 'Открыть картинку в «Фото» (как Photoshop)', action: () => { const o = AIOps.selImage(); if (o) PhotoWS.editFromVektor(o); }, disabled: () => !img() },
      '-',
      { label: 'Отправить в «Фигму»', action: AIOps.toFigma, disabled: () => !App.sel.length },
      { label: 'Отправить в «Моушн»', action: AIOps.toMotion },
      '-',
      { label: 'Модели Polza (выбор для каждой задачи)…', action: () => Polza.settingsDialog() },
      { label: 'Спрашивать модель перед запуском', check: () => { try { return localStorage.getItem('vektor.askModel') !== 'no'; } catch (e) { return true; } }, action: () => { try { localStorage.setItem('vektor.askModel', localStorage.getItem('vektor.askModel') === 'no' ? 'yes' : 'no'); } catch (e) { } } },
    ] };
  },
};
