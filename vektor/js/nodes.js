// «Ноды» — бесконечный холст генерации в духе Higgsfield Canvas и Freepik/Magnific Spaces.
// Узлы (текст, ассистент, список, картинки, генерация, правка, видео, апскейл, фон, вектор, сравнение,
// экспорт) соединяются связями; запуск — по узлу, по выделению или всей схемы (только устаревшие узлы),
// у каждого узла — история результатов. Проекты и результаты хранятся на компьютере (IndexedDB),
// схема переносится файлом .vknodes. ИИ — только через Polza.
'use strict';

const NX_ASPECT = [['auto', 'Авто'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4'], ['3:2', '3:2'], ['2:3', '2:3'], ['4:5', '4:5'], ['21:9', '21:9']];
// правка по картинке: готовые задачи → шаблон промпта для модели правки ({p} — текст пользователя)
const NX_PRESETS = {
  custom: ['Свой промпт', '{p}', ''],
  bg: ['Сменить фон', 'Keep the main subject exactly as it is (shape, colors, details, labels, position). Replace the background with: {p}. Match lighting and perspective, add realistic contact shadows.', 'a clean light studio backdrop'],
  interior: ['Товар в интерьере', 'Place this exact product into a realistic photo scene: {p}. Keep the product identical (shape, proportions, colors, logo and label text). Natural light, realistic shadows and reflections, professional product photography, high detail.', 'a bright modern interior, on a wooden table, soft daylight'],
  relight: ['Свет (relight)', 'Relight this image: {p}. Keep the subject, composition, identity and all details identical; change only lighting, shadows, highlights and color temperature.', 'soft warm golden-hour light from the left'],
  style: ['Перенос стиля', 'Redraw the first image in the visual style of the other reference image(s). {p} Keep the composition, pose and subject of the first image.', ''],
  angle: ['Новый ракурс', 'Show exactly the same subject from a different camera angle: {p}. Keep identity, face, outfit, colors, materials and proportions consistent. Same lighting and style, neutral background.', 'three-quarter view'],
  outpaint: ['Дорисовать края', 'The original picture is placed in the center of a larger canvas; the margins around it are only a blurred placeholder. Extend the scene into the margins seamlessly, matching perspective, lighting and style. {p} Do not change the central original part.', ''],
  inpaint: ['Заменить область', 'The second image shows the same picture with an area highlighted by a semi-transparent magenta mask. Only inside that area: {p}. Keep everything outside the area identical. Output the full picture without any mask or magenta.', 'remove the object and restore the background naturally'],
};
const NX_KIND = { text: 'текст', image: 'картинка', video: 'видео', svg: 'SVG', any: 'любое' };
const NX_CATS = [['in', 'Входы'], ['text', 'Текст и ассистент'], ['image', 'Картинки'], ['video', 'Видео'], ['proc', 'Обработка'], ['out', 'Просмотр и вывод'], ['misc', 'Оформление']];
const NX_STATUS = { pending: 'в очереди Polza', queued: 'в очереди Polza', processing: 'генерация', in_progress: 'генерация', running: 'генерация', starting: 'запуск', completed: 'готово', succeeded: 'готово' };

const Nodes = {
  el: null, g: { nodes: [], edges: [] }, view: { x: 60, y: 60, k: 1 },
  sel: new Set(), res: {}, outs: {}, live: {}, status: {}, folders: {},
  proj: { id: '', name: 'Проект' }, hist: [], hpos: -1, clip: null,
  running: false, conc: 4, snap: true, hand: false, mini: true, ready: false,

  // ================= типы узлов =================
  // inputs: [имя, вид, несколько?, подпись]; outputs: [имя, вид, подпись]; params: { k, t, l, … }
  TYPES: {
    text: { title: 'Текст', cat: 'in', ic: '¶', color: '#64748b', desc: 'Промпт, бриф или любой текст', cheap: true,
      outputs: [['text', 'text', 'текст']], params: [{ k: 'text', t: 'textarea', l: 'Промпт, бриф или любой текст', rows: 4 }] },
    list: { title: 'Список', cat: 'in', ic: '☰', color: '#64748b', desc: 'Несколько промптов или картинок: следующий узел выполнится для каждого элемента', cheap: true,
      inputs: [['in', 'any', true, 'элементы']], outputs: [['items', 'any', 'элементы']],
      params: [{ k: 'text', t: 'textarea', l: 'По одному элементу на строку', rows: 5 }, { k: 'split', t: 'select', o: 'lines=По строкам|blocks=По пустым строкам|none=Не делить', l: 'Делить текст', adv: true }] },
    image: { title: 'Картинка', cat: 'in', ic: '▣', color: '#0ea5e9', desc: 'Файл с компьютера, вставка из буфера или перетаскивание на холст', cheap: true,
      outputs: [['image', 'image', 'картинка']], params: [{ k: 'file', t: 'file', l: 'Картинка' }] },
    folder: { title: 'Папка картинок', cat: 'in', ic: '▦', color: '#0ea5e9', desc: 'Каждая картинка папки — отдельный запуск цепочки', cheap: true,
      outputs: [['images', 'image', 'картинки']], params: [{ k: 'folder', t: 'folder', l: 'Папка' }] },
    figma: { title: 'Выделение из «Фигмы»', cat: 'in', ic: '◆', color: '#a855f7', desc: 'Картинка выделенного в «Фигме»', cheap: true, volatile: true,
      outputs: [['image', 'image', 'картинка']], params: [] },
    vektor: { title: 'Страница «Вектора»', cat: 'in', ic: '✒', color: '#2f8f3a', desc: 'Страница или выделение документа «Вектора»', cheap: true, volatile: true,
      outputs: [['image', 'image', 'картинка']], params: [{ k: 'what', t: 'select', o: 'page=Текущая страница|sel=Выделенное', l: 'Что взять' }] },
    template: { title: 'Шаблон текста', cat: 'text', ic: '{}', color: '#64748b', desc: 'Склеивает тексты по шаблону {a} {b} {c}', cheap: true,
      inputs: [['a', 'text', false, 'a'], ['b', 'text', false, 'b'], ['c', 'text', false, 'c']], outputs: [['text', 'text', 'текст']],
      params: [{ k: 'template', t: 'textarea', l: 'Текст с {a}, {b}, {c}', rows: 3 }] },
    assistant: { title: 'Ассистент', cat: 'text', ic: '✦', color: '#f59e0b', w: 300, desc: 'Текстовая модель Polza: пишет и улучшает промпты, делает список вариантов по брифу',
      inputs: [['text', 'text', false, 'бриф'], ['image', 'image', true, 'картинки']], outputs: [['text', 'text', 'текст']],
      params: [
        { k: 'mode', t: 'select', o: 'list=Список вариантов промптов|write=Промпт по брифу|improve=Улучшить промпт|describe=Описать картинку промптом|custom=Своя задача', l: 'Задача' },
        { k: 'count', t: 'number', l: 'Вариантов', min: 1, max: 50, show: P => P.mode === 'list' },
        { k: 'target', t: 'select', o: 'image=для картинок|video=для видео', l: 'Промпты', show: P => P.mode !== 'custom' },
        { k: 'text', t: 'textarea', l: 'Бриф (или подключите вход)', rows: 3 },
        { k: 'instruction', t: 'textarea', l: 'Дополнительные указания', rows: 2, adv: true },
        { k: 'lang', t: 'select', o: 'en=Промпт на английском|ru=Промпт на русском', l: 'Язык', adv: true },
        { k: 'model', t: 'model', mt: 'chat', role: 'chat', l: 'Модель', adv: true }] },
    llm: { title: 'Текстовая модель', cat: 'text', ic: '✦', color: '#f59e0b', hidden: true, desc: 'Своя инструкция для текстовой модели',
      inputs: [['text', 'text', false, 'текст'], ['image', 'image', false, 'картинка']], outputs: [['text', 'text', 'текст']],
      params: [{ k: 'instruction', t: 'textarea', l: 'Что сделать с текстом/картинкой', rows: 3 }, { k: 'model', t: 'model', mt: 'chat', role: 'chat', l: 'Модель' }] },
    genImage: { title: 'Генерация картинки', cat: 'image', ic: '✧', color: '#ec4899', w: 300, desc: 'Картинка по промпту, референсы — со входа', calls: P => +P.count || 1,
      inputs: [['prompt', 'text', false, 'промпт'], ['refs', 'image', true, 'референсы']], outputs: [['image', 'image', 'картинка']],
      params: [{ k: 'prompt', t: 'textarea', l: 'Промпт (со входом — добавится к нему)', rows: 3 },
        { k: 'model', t: 'model', mt: 'image', role: 'image', l: 'Модель' }, { k: 'aspect', t: 'select', o: NX_ASPECT, l: 'Формат' },
        { k: 'count', t: 'seg', o: '1|2|3|4', l: 'Вариантов' }, { k: 'seed', t: 'seed', l: 'Seed', adv: true }, { k: 'extra', t: 'json', l: 'Доп. параметры JSON, например {"quality":"high"}', adv: true }] },
    editImage: { title: 'Правка по картинке', cat: 'image', ic: '✎', color: '#8b5cf6', w: 300, desc: 'Картинка + промпт → новая картинка', calls: P => +P.count || 1,
      inputs: [['image', 'image', false, 'картинка'], ['refs', 'image', true, 'референсы'], ['prompt', 'text', false, 'промпт']], outputs: [['image', 'image', 'картинка']],
      params: [{ k: 'preset', t: 'select', o: Object.entries(NX_PRESETS).map(([k, v]) => [k, v[0]]), l: 'Задача' },
        { k: 'prompt', t: 'textarea', l: 'Промпт', rows: 3 }, { k: 'mask', t: 'mask', l: 'Маска', show: P => P.preset === 'inpaint' },
        { k: 'model', t: 'model', mt: 'image', role: 'edit', l: 'Модель' }, { k: 'aspect', t: 'select', o: NX_ASPECT, l: 'Формат' },
        { k: 'count', t: 'seg', o: '1|2|3|4', l: 'Вариантов' }, { k: 'seed', t: 'seed', l: 'Seed', adv: true }, { k: 'extra', t: 'json', l: 'Доп. параметры JSON', adv: true }] },
    genVideo: { title: 'Генерация видео', cat: 'video', ic: '►', color: '#ef4444', w: 300, desc: 'Видео по тексту или по первому/последнему кадру',
      inputs: [['prompt', 'text', false, 'промпт'], ['image', 'image', false, 'первый кадр'], ['end', 'image', false, 'последний кадр']], outputs: [['video', 'video', 'видео']],
      params: [{ k: 'prompt', t: 'textarea', l: 'Что происходит в кадре, движение камеры', rows: 3 },
        { k: 'model', t: 'model', mt: 'video', role: 'video', l: 'Модель' }, { k: 'duration', t: 'select', o: '3=3 с|4=4 с|5=5 с|6=6 с|8=8 с|10=10 с', l: 'Длительность' },
        { k: 'aspect', t: 'select', o: NX_ASPECT.filter(a => ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(a[0])), l: 'Формат' },
        { k: 'extra', t: 'json', l: 'Доп. параметры JSON, например {"resolution":"1080p"}', adv: true }] },
    upscale: { title: 'Апскейл', cat: 'proc', ic: '⤢', color: '#14b8a6', desc: 'Увеличение: точное или творческое (дорисовка деталей)',
      inputs: [['image', 'image', false, 'картинка']], outputs: [['image', 'image', 'картинка']],
      params: [{ k: 'mode', t: 'select', o: 'precise=Точный — без изменений|creative=Творческий — дорисовать детали', l: 'Режим' }, { k: 'scale', t: 'seg', o: '2|4', l: 'Во сколько раз' },
        { k: 'prompt', t: 'textarea', l: 'Что подчеркнуть (текстуры, резкость…)', rows: 2, show: P => P.mode === 'creative' },
        { k: 'model', t: 'model', mt: 'image', role: 'upscale', l: 'Модель', adv: true }] },
    removeBg: { title: 'Удалить фон', cat: 'proc', ic: '◐', color: '#14b8a6', desc: 'Прозрачный фон: модель Polza или хромакей',
      inputs: [['image', 'image', false, 'картинка']], outputs: [['image', 'image', 'картинка']], params: [{ k: 'model', t: 'model', mt: 'image', role: 'bg', l: 'Модель', adv: true }] },
    vectorize: { title: 'В вектор (SVG)', cat: 'proc', ic: '⬠', color: '#14b8a6', desc: 'Трассировка на компьютере или модель Polza',
      inputs: [['image', 'image', false, 'картинка']], outputs: [['svg', 'svg', 'SVG']],
      params: [{ k: 'vz', t: 'vzbtn', l: '' }, { k: 'colors', t: 'number', l: 'Цветов', min: 2, max: 64 },
        { k: 'detail', t: 'select', o: 'mid=Средняя|low=Низкая|high=Высокая|max=Максимальная', l: 'Детализация' },
        { k: 'nobg', t: 'select', o: 'no=Фон оставить|yes=Фон убрать', l: 'Фон' },
        { k: 'smooth', t: 'number', l: 'Сглаживание 0–5', min: 0, max: 5, adv: true }, { k: 'palette', t: 'text', l: 'Палитра: #hex через запятую', adv: true },
        { k: 'model', t: 'model', mt: 'image', role: 'vector', l: 'Модель (пусто — трассировка)', adv: true }] },
    mockup: { title: 'Мокап', cat: 'proc', ic: '▤', color: '#8b5cf6', desc: 'Дизайн на фото объекта',
      inputs: [['base', 'image', false, 'фото объекта'], ['design', 'image', false, 'дизайн']], outputs: [['image', 'image', 'картинка']],
      params: [{ k: 'mode', t: 'select', o: 'shape=По форме объекта|cylinder=Цилиндр|flat=Плоскость', l: 'Посадка' }, { k: 'mask', t: 'select', o: 'ai=Объект находит ИИ|full=Весь кадр', l: 'Объект' }, { k: 'blend', t: 'select', o: 'normal=С тенями|multiply=Умножение|screen=Экран', l: 'Смешивание' }] },
    compare: { title: 'Сравнение', cat: 'out', ic: '◫', color: '#6366f1', w: 320, desc: 'До/после со шторкой', cheap: true, noBatch: true,
      inputs: [['a', 'image', false, 'до'], ['b', 'image', false, 'после']], outputs: [['b', 'image', 'после']], params: [] },
    save: { title: 'Экспорт в папку', cat: 'out', ic: '⤓', color: '#475569', desc: 'Сохранить результаты в папку на компьютере',
      inputs: [['in', 'any', true, 'что сохранить']], outputs: [], params: [{ k: 'folder', t: 'folder', l: 'Папка (пусто — спросить)' }, { k: 'name', t: 'text', l: 'Имя файлов' }] },
    toApp: { title: 'Отправить', cat: 'out', ic: '↗', color: '#475569', desc: 'В «Вектор», «Фигму» или «Моушн»',
      inputs: [['in', 'any', true, 'что отправить']], outputs: [], params: [{ k: 'where', t: 'select', o: 'vektor=В «Вектор»|figma=В «Фигму»|motion=В «Моушн»', l: 'Куда' }] },
    note: { title: 'Заметка', cat: 'misc', ic: '✎', color: '#eab308', desc: 'Стикер с текстом', special: true, params: [] },
    group: { title: 'Группа', cat: 'misc', ic: '▢', color: '#6366f1', desc: 'Цветная область с заголовком: двигает свои узлы', special: true, params: [] },
  },
  // пункты меню добавления: тип + готовые параметры
  PALETTE: [
    ['text'], ['list'], ['image'], ['folder'], ['figma'], ['vektor'],
    ['assistant', { mode: 'list', count: 6 }, 'Ассистент: список промптов', 'Бриф → N разных промптов (каждый станет отдельной генерацией)'],
    ['assistant', { mode: 'improve' }, 'Ассистент: улучшить промпт', 'Короткая идея → подробный промпт'],
    ['assistant', { mode: 'describe' }, 'Ассистент: описать картинку', 'Картинка → промпт для её воссоздания'],
    ['template'],
    ['genImage'], ['editImage'],
    ['editImage', { preset: 'bg' }], ['editImage', { preset: 'interior' }], ['editImage', { preset: 'relight' }], ['editImage', { preset: 'style' }],
    ['editImage', { preset: 'angle' }], ['editImage', { preset: 'outpaint', aspect: '16:9' }], ['editImage', { preset: 'inpaint' }],
    ['genVideo'], ['genVideo', {}, 'Картинка → видео', 'Оживить кадр: первый кадр со входа'],
    ['upscale'], ['upscale', { mode: 'creative' }, 'Творческий апскейл', 'Увеличить и дорисовать детали'], ['removeBg'], ['vectorize'], ['mockup'],
    ['compare'], ['save'], ['toApp'], ['note'], ['group'],
  ],
  defaults(type) {
    return ({ genImage: { aspect: 'auto', count: 1 }, editImage: { preset: 'custom', aspect: 'auto', count: 1 }, genVideo: { duration: 5, aspect: 'auto' },
      upscale: { mode: 'precise', scale: 2 }, vectorize: { colors: 8, detail: 'mid', nobg: 'no' }, template: { template: '{a}' }, vektor: { what: 'page' },
      assistant: { mode: 'list', count: 6, target: 'image', lang: 'en' }, list: { split: 'lines' }, toApp: { where: 'vektor' }, save: { name: 'результат' },
      note: { text: '', color: '#fde68a' }, group: { title: 'Группа', color: '#6366f1' } })[type] || {};
  },
  T(n) { return Nodes.TYPES[n && n.type] || Nodes.TYPES.text; },
  title(n) {
    if (n.title) return n.title;
    if (n.type === 'editImage' && n.params.preset && n.params.preset !== 'custom') return NX_PRESETS[n.params.preset] ? NX_PRESETS[n.params.preset][0] : 'Правка';
    if (n.type === 'assistant') return { list: 'Ассистент: варианты', improve: 'Ассистент: улучшить', describe: 'Ассистент: описание', write: 'Ассистент: промпт' }[n.params.mode] || 'Ассистент';
    return Nodes.T(n).title;
  },

  // ================= граф =================
  uid(p = 'n') { return p + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7); },
  node(id) { return Nodes.g.nodes.find(n => n.id === id); },
  add(type, x, y, params = {}, opts = {}) {
    const T = Nodes.TYPES[type]; if (!T) return null;
    const n = { id: Nodes.uid(), type, x: Math.round(x), y: Math.round(y), params: Object.assign({}, Nodes.defaults(type), params) };
    if (type === 'note') { n.w = 220; n.h = 160; }
    if (type === 'group') { n.w = 520; n.h = 320; }
    if (opts.title) n.title = opts.title;
    Nodes.g.nodes.push(n);
    if (!opts.silent) { Nodes.sel = new Set([n.id]); Nodes.render(); Nodes.commit(); }
    return n;
  },
  compat(out, inp) { return inp === 'any' || out === 'any' || out === inp || (out === 'svg' && inp === 'image'); },
  portKind(id, port, isOut) { const n = Nodes.node(id); const d = ((isOut ? Nodes.T(n).outputs : Nodes.T(n).inputs) || []).find(p => p[0] === port); return d ? d[1] : null; },
  connect(from, fport, to, tport, silent) {
    const a = Nodes.node(from), b = Nodes.node(to); if (!a || !b) return false;
    const inp = (Nodes.T(b).inputs || []).find(i => i[0] === tport);
    const ok = (Nodes.T(a).outputs || []).find(o => o[0] === fport);
    if (!inp || !ok) return false;
    if (!Nodes.compat(ok[1], inp[1])) { if (!silent) UI.toast(`Нельзя: выход «${ok[2] || ok[0]}» (${NX_KIND[ok[1]]}) не подходит ко входу «${inp[3] || inp[0]}» (${NX_KIND[inp[1]]})`); return false; }
    if (from === to || Nodes.reaches(to, from)) { if (!silent) UI.toast('Цикл в схеме нельзя'); return false; }
    if (Nodes.g.edges.some(e => e.from === from && e.fport === fport && e.to === to && e.tport === tport)) return false;
    if (!inp[2]) Nodes.g.edges = Nodes.g.edges.filter(e => !(e.to === to && e.tport === tport));
    Nodes.g.edges.push({ from, fport, to, tport });
    if (!silent) { Nodes.drawEdges(); Nodes.commit(); }
    return true;
  },
  reaches(a, b) {
    const seen = new Set(), st = [a];
    while (st.length) { const x = st.pop(); if (x === b) return true; if (seen.has(x)) continue; seen.add(x); Nodes.g.edges.filter(e => e.from === x).forEach(e => st.push(e.to)); }
    return false;
  },
  removeIds(ids) {
    const s = new Set(ids); if (!s.size) return;
    Nodes.g.nodes = Nodes.g.nodes.filter(n => !s.has(n.id));
    Nodes.g.edges = Nodes.g.edges.filter(e => !s.has(e.from) && !s.has(e.to));
    for (const id of s) Nodes.sel.delete(id);
    Nodes.render(); Nodes.commit();
  },
  remove(id) { Nodes.removeIds([id]); },
  rectOf(n) {
    const el = Nodes.elOf(n.id);
    return { x: n.x, y: n.y, w: n.w || (el ? el.offsetWidth : Nodes.T(n).w || 280), h: n.h || (el ? el.offsetHeight : 140) };
  },
  inside(g, n) { const r = Nodes.rectOf(n); const cx = r.x + r.w / 2, cy = r.y + Math.min(r.h, 60) / 2; return cx > g.x && cx < g.x + g.w && cy > g.y && cy < g.y + g.h; },
  groupMembers(gr) { return Nodes.g.nodes.filter(n => n !== gr && n.type !== 'group' && Nodes.inside(gr, n)); },

  // ================= подписи, кэш, устаревание =================
  hash(s) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  },
  sigParams(P) {
    const o = {};
    for (const k of Object.keys(P || {}).sort()) {
      if (k[0] === '_') continue;
      const v = P[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) o[k] = v.key || v.root || v.path || ((v.name || '') + ':' + (v.size || (v.data ? v.data.length : 0)));
      else o[k] = v;
    }
    return o;
  },
  sig(id, m = new Map()) {
    if (m.has(id)) return m.get(id);
    m.set(id, 'cycle');
    const n = Nodes.node(id); if (!n) return 'x';
    const ins = Nodes.g.edges.filter(e => e.to === id).map(e => e.tport + '<' + e.fport + ':' + Nodes.outKey(e.from, m)).sort();
    const s = Nodes.hash(JSON.stringify([n.type, Nodes.sigParams(n.params), ins]));
    m.set(id, s); return s;
  },
  outKey(id, m) {
    const n = Nodes.node(id); if (!n) return 'x';
    const T = Nodes.T(n);
    if (T.volatile) return 'v' + ((Nodes.res[id] && Nodes.res[id].key) || '0');
    if (T.cheap) return Nodes.sig(id, m);
    const r = Nodes.res[id];
    return r && r.cur ? r.cur + (r.item != null ? '#' + r.item : '') : 'none:' + Nodes.sig(id, m);
  },
  entry(id, eid) { const r = Nodes.res[id]; return r && r.hist ? r.hist.find(e => e.id === eid) : null; },
  stale(id, m) {
    const n = Nodes.node(id); if (!n) return false;
    const T = Nodes.T(n); if (T.cheap || T.special) return false;
    const r = Nodes.res[id]; if (!r || !r.cur) return 'new';
    const e = Nodes.entry(id, r.cur);
    return e && e.sig === Nodes.sig(id, m) ? false : 'changed';
  },
  output(id) {
    const n = Nodes.node(id); if (!n) return null;
    if (Nodes.T(n).cheap) return Nodes.live[id] ? Nodes.live[id].out : null;
    const r = Nodes.res[id]; if (!r || !r.cur) return null;
    let v = Nodes.outs[r.cur]; if (v === undefined || v === null) return null;
    if (r.item != null && Array.isArray(v) && v[r.item]) v = v[r.item];
    return v;
  },
  async outputAsync(id) { const r = Nodes.res[id]; if (r && r.cur) await Nodes.loadOut(r.cur); return Nodes.output(id); },
  valKey(v) { return Nodes.hash(JSON.stringify(Nodes.flat(v).map(x => [x.kind, x.name, x.blob ? x.blob.size : 0, x.text ? x.text.length : 0]))); },
  flat(list) { const out = []; for (const v of [].concat(list == null ? [] : list)) { if (Array.isArray(v)) out.push(...Nodes.flat(v)); else if (v) out.push(v); } return out; },
  text(v) { if (!v) return ''; if (Array.isArray(v)) return v.map(Nodes.text).filter(Boolean).join('\n'); return v.kind === 'text' ? v.text : ''; },

  // ================= выполнение =================
  sema(limit) {
    let active = 0; const q = [];
    const next = () => { if (active >= limit || !q.length) return; active++; const [fn, res, rej] = q.shift(); Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); }); };
    return fn => new Promise((res, rej) => { q.push([fn, res, rej]); next(); });
  },
  upstream(ids) {
    const seen = new Set(), st = [...ids];
    while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); Nodes.g.edges.filter(e => e.to === x).forEach(e => st.push(e.from)); }
    return seen;
  },
  runnable(n) { return n && !Nodes.T(n).special; },
  // запустить: узлы-цели (их входы — по необходимости), force — пересоздать даже без изменений
  async runGraph(targets, force = new Set()) {
    if (Nodes.running) { UI.toast('Уже выполняется — дождитесь или нажмите «Стоп»'); return; }
    targets = [...new Set(targets)].filter(id => Nodes.runnable(Nodes.node(id)));
    if (!targets.length) { UI.toast('Нечего запускать'); return; }
    const ac = new AbortController();
    const ctx = Nodes.ctx = { stop: false, ac, memo: {}, force, cost: {}, ran: 0, errors: 0, t0: Date.now(), sem: Nodes.sema(Nodes.conc) };
    ctx.call = (id, fn) => ctx.sem(async () => {
      if (ctx.stop) throw new Error('Остановлено');
      const sub = new AbortController(); const on = () => sub.abort();
      ac.signal.addEventListener('abort', on);
      try { const r = await fn(sub.signal); ctx.cost[id] = (ctx.cost[id] || 0) + (+sub.signal.vkCost || 0); return r; }
      finally { ac.signal.removeEventListener('abort', on); const st = Nodes.status[id]; if (st && st.s === 'run') { st.done = (st.done || 0) + 1; Nodes.paintStatus(id); } }
    });
    const m = new Map();
    for (const id of Nodes.upstream(targets)) {
      const n = Nodes.node(id);
      if (n && !Nodes.T(n).cheap && !Nodes.T(n).special && (force.has(id) || Nodes.stale(id, m))) { Nodes.status[id] = { s: 'queue' }; Nodes.paintStatus(id); }
    }
    Nodes.running = true; Nodes.updateRunUI();
    Nodes._tick = setInterval(() => { for (const id in Nodes.status) if (Nodes.status[id].s === 'run') Nodes.paintStatus(id); Nodes.updateRunUI(); }, 1000);
    try {
      await Promise.allSettled(targets.map(id => Nodes.evalNode(id, ctx)));
    } finally {
      clearInterval(Nodes._tick);
      for (const id in Nodes.status) if (Nodes.status[id].s === 'queue' || Nodes.status[id].s === 'run') { delete Nodes.status[id]; Nodes.paintStatus(id); }
      Nodes.running = false; Nodes.ctx = null;
      Nodes.updateRunUI(); Nodes.refreshStale(); Nodes.drawEdges();
      const cost = Object.values(ctx.cost).reduce((a, b) => a + b, 0);
      const t = Math.round((Date.now() - ctx.t0) / 1000);
      if (ctx.stop) UI.toast('Остановлено', true);
      else if (ctx.errors) UI.toast(`Готово с ошибками: ${ctx.errors}. Выполнено узлов: ${ctx.ran}`, true);
      else UI.toast(ctx.ran ? `Готово: узлов ${ctx.ran} за ${Nodes.fmtTime(t)}${cost ? ' · ' + Nodes.fmtCost(cost) : ''}` : 'Всё актуально — менять нечего', true);
    }
  },
  run(id) { return id ? Nodes.runGraph([id], new Set([id])) : Nodes.runAll(); },
  runAll() { return Nodes.runGraph(Nodes.g.nodes.filter(n => Nodes.runnable(n)).map(n => n.id)); },
  runSelected() {
    const ids = [...Nodes.sel].filter(id => Nodes.runnable(Nodes.node(id)));
    if (!ids.length) return Nodes.runAll();
    return Nodes.runGraph(ids, new Set(ids));
  },
  runGroup(gr) { return Nodes.runGraph(Nodes.groupMembers(gr).map(n => n.id)); },
  stop() { if (Nodes.ctx) { Nodes.ctx.stop = true; Nodes.ctx.ac.abort(); } },
  evalNode(id, ctx) { return ctx.memo[id] || (ctx.memo[id] = Nodes._eval(id, ctx)); },
  async _eval(id, ctx) {
    const n = Nodes.node(id); if (!n) return null;
    const T = Nodes.T(n); if (T.special) return null;
    const ins = {}; let failed = null;
    for (const [name, , multi] of T.inputs || []) {
      const es = Nodes.g.edges.filter(e => e.to === id && e.tport === name);
      const vals = await Promise.allSettled(es.map(e => Nodes.evalNode(e.from, ctx)));
      const ok = [];
      for (const v of vals) { if (v.status === 'rejected') failed = failed || v.reason; else if (v.value != null) ok.push(v.value); }
      ins[name] = multi ? ok : ok[0];
    }
    if (failed) {
      Nodes.status[id] = { s: 'err', note: ctx.stop ? 'Остановлено' : 'Ошибка выше по цепочке', up: true }; Nodes.paintStatus(id);
      const e = new Error('Ошибка выше по цепочке'); e.up = true; throw e;
    }
    if (ctx.stop) { delete Nodes.status[id]; Nodes.paintStatus(id); throw new Error('Остановлено'); }
    if (T.cheap) {
      try {
        const out = await Nodes.exec(n, ins, ctx);
        Nodes.live[id] = { out, ins };
        if (T.volatile) { Nodes.res[id] = { key: Nodes.valKey(out) }; }
        if (Nodes.status[id]) { delete Nodes.status[id]; Nodes.paintStatus(id); }
        if (n.type === 'compare' || n.type === 'list' || n.type === 'template' || T.volatile || n.type === 'folder') Nodes.paintOut(id);
        return out;
      } catch (e) {
        Nodes.status[id] = { s: 'err', note: e.message || String(e) }; Nodes.paintStatus(id); ctx.errors++;
        throw e;
      }
    }
    const sig = Nodes.sig(id);
    if (!ctx.force.has(id) && !Nodes.stale(id)) {
      if (Nodes.status[id]) { delete Nodes.status[id]; Nodes.paintStatus(id); }
      return Nodes.outputAsync(id);
    }
    const t0 = Date.now();
    Nodes.status[id] = { s: 'run', t0, done: 0, total: 1 }; Nodes.paintStatus(id); Nodes.drawEdges();
    try {
      const out = await Nodes.exec(n, ins, ctx);
      const st = Nodes.status[id] || {};
      const ms = Date.now() - t0, cost = ctx.cost[id] || 0;
      await Nodes.record(id, out, { sig, ms, cost });
      Nodes.status[id] = { s: 'ok', ms, cost, warn: st.warn };
      ctx.ran++;
      return Nodes.output(id);
    } catch (e) {
      console.warn(e);
      Nodes.status[id] = { s: 'err', note: ctx.stop ? 'Остановлено' : (e.message || String(e)) }; ctx.errors++;
      throw e;
    } finally { Nodes.paintOut(id); Nodes.refreshStale(); Nodes.drawEdges(); }
  },
  // пакет: если на одиночный вход пришёл список — узел выполняется для каждого элемента
  async exec(n, ins, ctx) {
    const T = Nodes.T(n);
    const bk = T.noBatch ? [] : (T.inputs || []).filter(d => !d[2] && Array.isArray(ins[d[0]])).map(d => d[0]);
    if (T.noBatch) for (const d of T.inputs || []) if (Array.isArray(ins[d[0]])) ins[d[0]] = Nodes.flat(ins[d[0]])[0];
    const st = Nodes.status[n.id];
    if (!bk.length) { if (st && st.s === 'run') { st.total = T.calls ? T.calls(n.params) : 1; } return Nodes.runNode(n, ins, ctx, 0); }
    const len = Math.max(...bk.map(k => ins[k].length));
    if (!len) throw new Error('На входе пустой список');
    if (st && st.s === 'run') { st.total = len * (T.calls ? T.calls(n.params) : 1); st.items = len; Nodes.paintStatus(n.id); }
    const res = await Promise.allSettled(Array.from({ length: len }, (_, i) => {
      const one = Object.assign({}, ins);
      for (const k of bk) one[k] = ins[k][Math.min(i, ins[k].length - 1)];
      return Nodes.runNode(n, one, ctx, i);
    }));
    const ok = res.filter(r => r.status === 'fulfilled').map(r => r.value);
    const bad = res.filter(r => r.status === 'rejected');
    if (!ok.length) throw bad[0].reason;
    if (bad.length && st) st.warn = `${bad.length} из ${len} с ошибкой: ${bad[0].reason && bad[0].reason.message}`;
    return Nodes.flat(ok);
  },
  parseJSON(s) { if (!s || !String(s).trim()) return {}; try { return JSON.parse(s); } catch (e) { throw new Error('Доп. параметры — неверный JSON'); } },
  joinPrompt(inp, own) { const a = Nodes.text(inp).trim(), b = String(own || '').trim(); return a && b ? a + (/[.!?]$/.test(a) ? ' ' : '. ') + b : a || b; },
  async imgBlob(v, what = 'картинка') {
    if (!v) return null;
    if (Array.isArray(v)) v = Nodes.flat(v)[0];
    if (!v) return null;
    if (v.kind === 'image') return v.blob;
    if (v.kind === 'svg') return Nodes.svgToPng(v.text);
    throw new Error(`На входе «${what}» ${NX_KIND[v.kind] || v.kind}, а нужна картинка`);
  },
  async imgBlobs(list) { const out = []; for (const v of Nodes.flat(list)) out.push(await Nodes.imgBlob(v)); return out.filter(Boolean); },
  async svgToPng(svg, max = 2048) {
    const img = await Polza.loadImage(new Blob([svg], { type: 'image/svg+xml' }));
    const w = img.naturalWidth || img.width || 1024, hh = img.naturalHeight || img.height || 1024, k = Math.min(4, max / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/png'));
  },
  imgParams(P, k) {
    const o = {};
    if (P.aspect && P.aspect !== 'auto') o.aspect_ratio = P.aspect;
    if (P.seed !== undefined && P.seed !== '' && P.seed !== null && isFinite(+P.seed)) o.seed = +P.seed + k;
    return Object.assign(o, Nodes.parseJSON(P.extra));
  },
  statusNote(id) { return s => { const st = Nodes.status[id]; if (st && st.s === 'run') { st.note = NX_STATUS[s] || s; Nodes.paintStatus(id); } }; },
  async chat(model, messages) {
    const S = Agent.settings, saved = S.model;
    let pr;
    if (model) S.model = model;
    // тело запроса собирается синхронно — модель можно сразу вернуть
    try { pr = Agent.callModel(messages); } finally { S.model = saved; }
    const js = await pr;
    const c = js && js.choices && js.choices[0] && js.choices[0].message && js.choices[0].message.content;
    return (Array.isArray(c) ? c.map(p => p.text || '').join('') : String(c || '')).trim();
  },
  parseList(text) {
    let s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const m = s.match(/\[[\s\S]*\]/);
    if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a.map(x => typeof x === 'string' ? x : (x && (x.prompt || x.text)) || JSON.stringify(x)).map(x => String(x).trim()).filter(Boolean); } catch (e) { } }
    return s.split(/\n+/).map(l => l.replace(/^\s*(?:\d+\s*[.)\]:-]|[-*•])\s*/, '').replace(/^["«]|["»]$/g, '').trim()).filter(l => l.length > 2);
  },
  async readFileParam(f) {
    if (!f) return null;
    if (f.key) { const b = await Nodes.getFile(f.key); if (b) return b; }
    if (f.path && Host.desktop) return new Blob([await vkHost.read(f.path)], { type: Host.mimeOf(f.name) });
    if (f.data) return (await fetch(f.data)).blob();
    throw new Error('Файл картинки не найден — выберите его заново');
  },
  async runNode(n, ins, ctx, idx) {
    const P = n.params, st = Nodes.statusNote(n.id), call = fn => ctx.call(n.id, fn);
    const many = (cnt, fn) => Promise.all(Array.from({ length: Math.max(1, Math.min(4, +cnt || 1)) }, (_, k) => call(sig => fn(sig, k))));
    const pack = list => list.length === 1 ? list[0] : list;
    switch (n.type) {
      case 'text': return { kind: 'text', text: P.text || '' };
      case 'template': return { kind: 'text', text: String(P.template || '').replace(/\{(a|b|c)\}/g, (m, k) => Nodes.text(ins[k])) };
      case 'list': {
        const split = t => P.split === 'none' ? [t] : P.split === 'blocks' ? t.split(/\n\s*\n/) : t.split(/\n/);
        const items = [];
        for (const v of Nodes.flat(ins.in)) {
          if (v.kind === 'text') split(v.text).map(s => s.trim()).filter(Boolean).forEach(s => items.push({ kind: 'text', text: s }));
          else items.push(v);
        }
        for (const s of split(String(P.text || ''))) if (s.trim()) items.push({ kind: 'text', text: s.trim() });
        if (!items.length) throw new Error('Список пуст: впишите строки или подключите вход');
        return items;
      }
      case 'image': {
        if (!P.file) throw new Error('Выберите картинку: файл, вставка или перетаскивание');
        return { kind: 'image', blob: await Nodes.readFileParam(P.file), name: P.file.name };
      }
      case 'folder': {
        const f = Nodes.folders[n.id] || (P.folder && P.folder.root && Host.desktop ? await Host.openFolderPath(P.folder.root) : null);
        if (!f) throw new Error('Выберите папку');
        Nodes.folders[n.id] = f;
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
      case 'compare': return ins.b || ins.a || null;
      case 'assistant': {
        const brief = Nodes.joinPrompt(ins.text, ins.text ? '' : P.text);
        const imgs = await Nodes.imgBlobs(ins.image);
        const tgt = P.target === 'video' ? 'видео' : 'картинки';
        const lang = P.lang === 'ru' ? 'Промпт пиши на русском языке.' : 'Промпт пиши на английском языке.';
        const N = Math.max(1, Math.min(50, +P.count || 6));
        const task = {
          list: `Придумай ${N} разных, непохожих друг на друга вариантов промпта для генерации ${tgt} по брифу ниже. Каждый промпт самодостаточный и подробный: объект, окружение, композиция, свет, стиль, ракурс камеры${P.target === 'video' ? ', действие и движение камеры' : ''}. ${lang} Верни строго JSON-массив из ${N} строк, без комментариев.`,
          write: `Напиши один подробный промпт для генерации ${tgt} по брифу ниже. ${lang} Только промпт.`,
          improve: `Улучши промпт ниже для генерации ${tgt}: сделай его конкретным и подробным (объект, окружение, композиция, свет, стиль, камера${P.target === 'video' ? ', действие и движение камеры' : ''}), убери противоречия, сохрани замысел. ${lang} Только промпт.`,
          describe: `Опиши приложенную картинку как подробный промпт, по которому генеративная модель воссоздаст похожую картинку${brief ? ' с учётом указаний ниже' : ''}. ${lang} Только промпт.`,
          custom: P.instruction || 'Обработай текст.',
        }[P.mode || 'list'];
        if (!brief && !imgs.length) throw new Error('Нет брифа: впишите его в узел или подключите вход «бриф»');
        if (P.mode === 'describe' && !imgs.length) throw new Error('Подключите картинку ко входу «картинки»');
        const content = [{ type: 'text', text: task + (P.mode !== 'custom' && P.instruction ? '\nДополнительно: ' + P.instruction : '') + (brief ? '\n\nБриф:\n' + brief : '') }];
        for (const b of imgs.slice(0, 4)) content.push({ type: 'image_url', image_url: { url: await Polza.thumb(b, 1024) } });
        const text = await call(() => Nodes.chat(P.model, [{ role: 'system', content: 'Ты — промпт-инженер для генеративных моделей картинок и видео. Отвечай только результатом, без пояснений и вступлений.' }, { role: 'user', content }]));
        if (!text) throw new Error('Модель вернула пустой ответ');
        if (P.mode === 'list') return Nodes.parseList(text).slice(0, N).map(t => ({ kind: 'text', text: t }));
        return { kind: 'text', text };
      }
      case 'llm': {
        const content = [{ type: 'text', text: (P.instruction || 'Обработай текст') + '\n\n' + Nodes.text(ins.text) }];
        const b = await Nodes.imgBlob(ins.image); if (b) content.push({ type: 'image_url', image_url: { url: await Polza.thumb(b, 1024) } });
        return { kind: 'text', text: await call(() => Nodes.chat(P.model, [{ role: 'system', content: 'Отвечай только результатом, без пояснений.' }, { role: 'user', content }])) };
      }
      case 'genImage': {
        const prompt = Nodes.joinPrompt(ins.prompt, P.prompt);
        if (!prompt) throw new Error('Нет промпта: впишите его или подключите вход «промпт»');
        const refs = await Nodes.imgBlobs(ins.refs);
        const list = await many(P.count, (signal, k) => Polza.generateImage(prompt, { images: refs, model: P.model || undefined, params: Nodes.imgParams(P, k), onStatus: st, signal }));
        return pack(list.map((blob, k) => ({ kind: 'image', blob, name: 'генерация.png', prompt })));
      }
      case 'editImage': {
        let image = await Nodes.imgBlob(ins.image);
        if (!image) throw new Error('Нет картинки на входе «картинка»');
        const refs = await Nodes.imgBlobs(ins.refs);
        const pr = NX_PRESETS[P.preset || 'custom'] || NX_PRESETS.custom;
        const user = Nodes.joinPrompt(ins.prompt, P.prompt);
        if (!user && P.preset === 'custom') throw new Error('Нет промпта: что изменить на картинке?');
        const prompt = pr[1].replace('{p}', user || pr[2]).replace(/\s+/g, ' ').trim();
        let images = [image, ...refs];
        if (P.preset === 'outpaint') images = [await Nodes.padImage(image, P.aspect), ...refs];
        if (P.preset === 'inpaint') {
          if (!P.mask || !P.mask.key) throw new Error('Нарисуйте маску: кнопка «Маска…» в узле');
          images = [image, await Nodes.maskOverlay(image, await Nodes.getFile(P.mask.key)), ...refs];
        }
        const list = await many(P.count, (signal, k) => Polza.generateImage(prompt, { images, model: P.model || Polza.media.edit, params: Nodes.imgParams(P, k), onStatus: st, signal }));
        return pack(list.map(blob => ({ kind: 'image', blob, name: 'правка.png', prompt })));
      }
      case 'genVideo': {
        const prompt = Nodes.joinPrompt(ins.prompt, P.prompt);
        const image = await Nodes.imgBlob(ins.image, 'первый кадр'), end = await Nodes.imgBlob(ins.end, 'последний кадр');
        if (!prompt && !image) throw new Error('Нужен промпт или первый кадр');
        const params = Object.assign(P.duration ? { duration: +P.duration } : {}, P.aspect && P.aspect !== 'auto' ? { aspect_ratio: P.aspect } : {}, Nodes.parseJSON(P.extra));
        const blob = await call(signal => Polza.generateVideo(prompt || 'Animate this image naturally, subtle camera motion', { image: image || undefined, endImage: end || undefined, model: P.model || undefined, params, onStatus: st, signal }));
        return { kind: 'video', blob, name: 'видео.mp4', prompt };
      }
      case 'removeBg': {
        const image = await Nodes.imgBlob(ins.image); if (!image) throw new Error('Нет картинки на входе');
        return { kind: 'image', blob: await call(signal => Polza.removeBackground(image, { model: P.model || undefined, onStatus: st, signal })), name: 'без-фона.png' };
      }
      case 'upscale': {
        const image = await Nodes.imgBlob(ins.image); if (!image) throw new Error('Нет картинки на входе');
        const scale = +P.scale || 2;
        if (P.mode === 'creative') {
          const prompt = `Upscale this image ${scale}x and enhance it: add fine realistic detail and texture, crisp edges, clean noise-free result${P.prompt ? ', ' + P.prompt : ''}. Keep composition, identity, colors and text identical.`;
          return { kind: 'image', blob: await call(signal => Polza.generateImage(prompt, { images: [image], model: P.model || Polza.media.edit, onStatus: st, signal })), name: 'апскейл.png' };
        }
        return { kind: 'image', blob: await call(signal => Polza.upscale(image, { scale, model: P.model || undefined, onStatus: st, signal })), name: 'апскейл.png' };
      }
      case 'vectorize': {
        const image = await Nodes.imgBlob(ins.image); if (!image) throw new Error('Нет картинки на входе');
        const palette = String(P.palette || '').split(/[,;\s]+/).filter(s => /^#?[0-9a-f]{6}$/i.test(s)).map(s => s[0] === '#' ? s : '#' + s);
        const vo = { detail: P.detail || 'mid', smooth: +P.smooth || 0, removeBg: P.nobg === 'yes' };
        const svg = palette.length ? await Polza.trace(image, Object.assign({ colors: palette.length, palette }, vo))
          : P.model ? await call(signal => Polza.vectorize(image, Object.assign({ colors: +P.colors || 8, model: P.model, onStatus: st, signal }, vo)))
            : await Polza.trace(image, Object.assign({ colors: +P.colors || 8 }, vo));
        return { kind: 'svg', text: svg, name: 'вектор.svg' };
      }
      case 'mockup': {
        const base = await Nodes.imgBlob(ins.base), design = await Nodes.imgBlob(ins.design);
        if (!base || !design) throw new Error('Нужны оба входа: фото объекта и дизайн');
        const blob = await call(() => makeMockup({ base, design, mode: P.mode || 'shape', mask: P.mask || 'ai', blend: P.blend || 'normal', onStatus: st }));
        return { kind: 'image', blob, name: 'мокап.png' };
      }
      case 'save': {
        const items = Nodes.flat(ins.in);
        if (!items.length) throw new Error('Нечего сохранять: подключите результаты');
        let folder = Nodes.folders[n.id] || (P.folder && P.folder.root && Host.desktop ? await Host.openFolderPath(P.folder.root) : null);
        if (!folder) { folder = await Host.pickFolder('Куда сохранить результаты'); if (!folder) throw new Error('Папка не выбрана'); Nodes.folders[n.id] = folder; P.folder = { name: folder.name, root: folder.root }; Nodes.touch(); }
        const base = (P.name || 'результат').replace(/[\\/:*?"<>|]+/g, ' ');
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        let saved = 0;
        for (let i = 0; i < items.length; i++) {
          const v = items[i];
          const name = `${base}${items.length > 1 ? '-' + String(i + 1).padStart(2, '0') : ''}-${stamp}.${Nodes.extOf(v)}`;
          await Host.writeToFolder(folder, name, v.kind === 'text' || v.kind === 'svg' ? v.text : v.blob); saved++;
        }
        return { kind: 'text', text: `Сохранено файлов: ${saved} → ${folder.name}` };
      }
      case 'toApp': {
        const items = Nodes.flat(ins.in);
        if (!items.length) throw new Error('Нечего отправлять');
        if (P.where === 'motion') {
          const imgs = items.filter(v => v.kind === 'image' || v.kind === 'svg').map(v => ({ name: v.name || 'кадр', blob: v.kind === 'svg' ? new Blob([v.text], { type: 'image/svg+xml' }) : v.blob }));
          const vids = items.filter(v => v.kind === 'video');
          if (!Motion.el) WS.show('motion');
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
            else if (v.kind === 'text') Actions.insert([Model.make('text', { text: v.text, m: Mx.translate(10, 20) })]);
          }
          App.commit('Из «Нод»');
        }
        WS.show(P.where || 'vektor');
        return { kind: 'text', text: 'Отправлено: ' + items.length };
      }
    }
    throw new Error('Неизвестный узел ' + n.type);
  },
  extOf(v) {
    if (v.kind === 'text') return 'txt';
    if (v.kind === 'svg') return 'svg';
    const t = (v.blob && v.blob.type) || '';
    if (v.kind === 'video') return t.includes('webm') ? 'webm' : t.includes('quicktime') ? 'mov' : 'mp4';
    return t.includes('jpeg') ? 'jpg' : t.includes('webp') ? 'webp' : t.includes('svg') ? 'svg' : 'png';
  },
  // дорисовка краёв: картинка в центре большего холста, поля — размытая растяжка как подсказка
  async padImage(blob, aspect) {
    const img = await Polza.loadImage(blob);
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    let tw = Math.round(W * 1.5), th = Math.round(H * 1.5);
    if (aspect && aspect !== 'auto') {
      const [a, b] = aspect.split(':').map(Number), r = a / b;
      if (W / H > r * 1.02) { tw = W; th = Math.round(W / r); } else if (W / H < r / 1.02) { th = H; tw = Math.round(H * r); } else { tw = Math.round(W * 1.4); th = Math.round(H * 1.4); }
    }
    const k = Math.min(1, 2048 / Math.max(tw, th));
    const c = document.createElement('canvas'); c.width = Math.round(tw * k); c.height = Math.round(th * k);
    const g = c.getContext('2d');
    const cover = Math.max(c.width / W, c.height / H);
    g.filter = 'blur(28px) saturate(.8)'; g.drawImage(img, (c.width - W * cover) / 2, (c.height - H * cover) / 2, W * cover, H * cover);
    g.filter = 'none'; g.drawImage(img, (c.width - W * k) / 2, (c.height - H * k) / 2, W * k, H * k);
    return new Promise(r => c.toBlob(r, 'image/png'));
  },
  async maskOverlay(image, mask) {
    const img = await Polza.loadImage(image), m = await Polza.loadImage(mask);
    const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const tg = t.getContext('2d'); tg.drawImage(m, 0, 0, c.width, c.height); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#ff00ff'; tg.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = .6; g.drawImage(t, 0, 0);
    return new Promise(r => c.toBlob(r, 'image/png'));
  },
  // значение без запуска ИИ: готовый результат или дешёвый узел (картинка, текст, список)
  async peek(id, depth = 0) {
    const n = Nodes.node(id); if (!n || depth > 30) return null;
    const T = Nodes.T(n);
    if (!T.cheap) return Nodes.outputAsync(id);
    if (T.volatile || n.type === 'folder') return Nodes.output(id);
    const ins = {};
    for (const [name, , multi] of T.inputs || []) {
      const vals = (await Promise.all(Nodes.g.edges.filter(e => e.to === id && e.tport === name).map(e => Nodes.peek(e.from, depth + 1)))).filter(v => v != null);
      ins[name] = multi ? vals : vals[0];
    }
    try { for (const k in ins) if (Array.isArray(ins[k]) && !(T.inputs.find(d => d[0] === k) || [])[2]) ins[k] = ins[k][0]; return await Nodes.runNode(n, ins, null, 0); } catch (e) { return null; }
  },
  async inputVal(id, port) { const e = Nodes.g.edges.find(x => x.to === id && x.tport === port); return e ? Nodes.peek(e.from) : null; },

  // ================= хранение: проекты, результаты, файлы =================
  async idbDel(k) {
    const db = await Docs.db(); if (!db) { delete Nodes._mem[k]; return; }
    await new Promise(res => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = tx.onerror = tx.onabort = () => res(); });
  },
  async idbKeys(prefix) {
    const db = await Docs.db(); if (!db) return Object.keys(Nodes._mem).filter(k => k.startsWith(prefix));
    return new Promise(res => {
      const out = []; const r = db.transaction('kv').objectStore('kv').openKeyCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
      r.onsuccess = () => { const c = r.result; if (c) { out.push(c.key); c.continue(); } else res(out); }; r.onerror = () => res(out);
    });
  },
  _mem: {},
  async put(k, v) { const db = await Docs.db(); if (!db) { Nodes._mem[k] = v; return; } return Docs.put(k, v); },
  async get(k) { const db = await Docs.db(); if (!db) return Nodes._mem[k]; return Docs.get(k); },
  strip(v) { if (Array.isArray(v)) return v.map(Nodes.strip); if (!v || typeof v !== 'object') return v; const o = {}; for (const k of ['kind', 'text', 'blob', 'name', 'prompt']) if (v[k] !== undefined) o[k] = v[k]; return o; },
  async loadOut(eid) {
    if (Nodes.outs[eid] !== undefined) return Nodes.outs[eid];
    if (!Nodes._loading) Nodes._loading = {};
    if (!Nodes._loading[eid]) Nodes._loading[eid] = Nodes.get('nodes:out:' + eid).then(v => { Nodes.outs[eid] = v || null; delete Nodes._loading[eid]; return Nodes.outs[eid]; });
    return Nodes._loading[eid];
  },
  async getFile(key) { if (!Nodes._files) Nodes._files = {}; if (Nodes._files[key]) return Nodes._files[key]; const b = await Nodes.get('nodes:file:' + key); if (b) Nodes._files[key] = b; return b || null; },
  async putFile(blob) { const key = Nodes.uid('f'); if (!Nodes._files) Nodes._files = {}; Nodes._files[key] = blob; await Nodes.put('nodes:file:' + key, blob); return key; },
  HIST_MAX: 40,
  async record(id, out, meta = {}) {
    const e = { id: Nodes.uid('e'), at: Date.now(), sig: meta.sig || Nodes.sig(id), ms: meta.ms || 0, cost: meta.cost || 0, n: Array.isArray(out) ? out.length : 1, manual: meta.manual || undefined };
    Nodes.outs[e.id] = out;
    await Nodes.put('nodes:out:' + e.id, Nodes.strip(out));
    const r = Nodes.res[id] || (Nodes.res[id] = { hist: [], cur: null, item: null });
    if (!r.hist) r.hist = [];
    r.hist.push(e); r.cur = e.id; r.item = null;
    while (r.hist.length > Nodes.HIST_MAX) {
      const old = r.hist.find(x => x.id !== r.cur && !x.star) || r.hist[0];
      r.hist = r.hist.filter(x => x !== old);
      if (!Nodes.refCount(old.id)) { delete Nodes.outs[old.id]; Nodes.idbDel('nodes:out:' + old.id); }
    }
    Nodes.touch();
    return e;
  },
  refCount(eid) { let c = 0; for (const id in Nodes.res) { const r = Nodes.res[id]; if (r.hist && r.hist.some(e => e.id === eid)) c++; } return c; },
  setCur(id, eid, item = null) {
    const r = Nodes.res[id]; if (!r) return;
    r.cur = eid; r.item = item;
    Nodes.loadOut(eid).then(() => { Nodes.paintOut(id); Nodes.refreshStale(); Nodes.drawEdges(); });
    Nodes.touch();
  },
  dropEntry(id, eid) {
    const r = Nodes.res[id]; if (!r || !r.hist) return;
    r.hist = r.hist.filter(e => e.id !== eid);
    if (r.cur === eid) { const last = r.hist[r.hist.length - 1]; r.cur = last ? last.id : null; r.item = null; if (last) Nodes.loadOut(last.id).then(() => Nodes.paintOut(id)); }
    if (!Nodes.refCount(eid)) { delete Nodes.outs[eid]; Nodes.idbDel('nodes:out:' + eid); }
    Nodes.paintOut(id); Nodes.refreshStale(); Nodes.touch();
  },
  async projects() { return (await Nodes.get('nodes:projects')) || []; },
  async saveProjects(list) { await Nodes.put('nodes:projects', list); },
  touch() {
    clearTimeout(Nodes._saveT);
    Nodes._saveT = setTimeout(() => Nodes.flush(), 400);
  },
  async flush() {
    clearTimeout(Nodes._saveT);
    if (!Nodes.ready || !Nodes.proj.id) return;
    const ids = new Set(Nodes.g.nodes.map(n => n.id));
    const res = {}; for (const id in Nodes.res) if (ids.has(id)) res[id] = Nodes.res[id];
    const rec = { id: Nodes.proj.id, name: Nodes.proj.name, graph: Nodes.g, res, view: Nodes.view, at: Date.now() };
    try {
      await Nodes.put('nodes:proj:' + rec.id, JSON.parse(JSON.stringify(rec)));
      const list = await Nodes.projects();
      const i = list.findIndex(p => p.id === rec.id), meta = { id: rec.id, name: rec.name, at: rec.at, count: Nodes.g.nodes.filter(n => !Nodes.T(n).special).length };
      if (i >= 0) list[i] = meta; else list.push(meta);
      await Nodes.saveProjects(list);
    } catch (e) { console.warn('Ноды: сохранение', e); }
  },
  async init() {
    let list = await Nodes.projects();
    let cur = null; try { cur = localStorage.getItem('vektor.nodes.cur'); } catch (e) { }
    if (!list.length) {
      // перенос старой схемы из localStorage
      let g = null; try { g = JSON.parse(localStorage.getItem('vektor.nodes') || 'null'); } catch (e) { }
      const id = Nodes.uid('p');
      await Nodes.put('nodes:proj:' + id, { id, name: 'Мой проект', graph: g && g.nodes ? Object.assign({ nodes: [], edges: [] }, g) : { nodes: [], edges: [] }, res: {}, at: Date.now() });
      list = [{ id, name: 'Мой проект', at: Date.now(), count: g && g.nodes ? g.nodes.length : 0 }];
      await Nodes.saveProjects(list);
      try { localStorage.removeItem('vektor.nodes'); } catch (e) { }
      cur = id;
    }
    if (!list.some(p => p.id === cur)) cur = list.slice().sort((a, b) => b.at - a.at)[0].id;
    await Nodes.openProject(cur);
    setTimeout(() => Nodes.gc().catch(e => console.warn(e)), 4000);
  },
  async openProject(id) {
    if (Nodes.ready) await Nodes.flush();
    const rec = await Nodes.get('nodes:proj:' + id);
    const r = rec || { id, name: 'Проект', graph: { nodes: [], edges: [] }, res: {} };
    Nodes.proj = { id: r.id, name: r.name || 'Проект' };
    Nodes.g = Object.assign({ nodes: [], edges: [] }, r.graph || {});
    Nodes.res = r.res || {}; Nodes.outs = {}; Nodes.live = {}; Nodes.status = {}; Nodes.sel = new Set();
    Nodes.hist = [JSON.stringify(Nodes.g)]; Nodes.hpos = 0;
    try { localStorage.setItem('vektor.nodes.cur', Nodes.proj.id); } catch (e) { }
    Nodes.ready = true;
    const fitNow = !r.view;
    if (r.view) Nodes.view = Object.assign({ x: 60, y: 60, k: 1 }, r.view);
    Nodes.render(); Nodes.updateRunUI();
    if (fitNow && Nodes.g.nodes.length) setTimeout(() => Nodes.fit(), 30);
    if (!rec) Nodes.touch();
    // результаты подгружаются из IndexedDB по мере готовности
    for (const nid in Nodes.res) { const x = Nodes.res[nid]; if (x && x.cur) Nodes.loadOut(x.cur).then(() => Nodes.paintOut(nid)); }
  },
  async newProject(name = 'Новый проект', graph) {
    await Nodes.flush();
    const id = Nodes.uid('p');
    await Nodes.put('nodes:proj:' + id, { id, name, graph: graph || { nodes: [], edges: [] }, res: {}, at: Date.now() });
    const list = await Nodes.projects(); list.push({ id, name, at: Date.now(), count: graph ? graph.nodes.length : 0 }); await Nodes.saveProjects(list);
    await Nodes.openProject(id);
    return id;
  },
  async deleteProject(id) {
    let list = (await Nodes.projects()).filter(p => p.id !== id);
    await Nodes.idbDel('nodes:proj:' + id);
    if (!list.length) { const nid = Nodes.uid('p'); list = [{ id: nid, name: 'Мой проект', at: Date.now(), count: 0 }]; await Nodes.put('nodes:proj:' + nid, { id: nid, name: 'Мой проект', graph: { nodes: [], edges: [] }, res: {}, at: Date.now() }); }
    await Nodes.saveProjects(list);
    if (id === Nodes.proj.id) { Nodes.ready = false; await Nodes.openProject(list.slice().sort((a, b) => b.at - a.at)[0].id); }
    Nodes.gc().catch(() => { });
  },
  // удалить результаты, на которые не ссылается ни один проект
  async gc() {
    const keys = await Nodes.idbKeys('nodes:out:'); if (!keys.length) return;
    const refs = new Set();
    const add = res => { for (const id in res || {}) for (const e of (res[id] && res[id].hist) || []) refs.add(e.id); };
    add(Nodes.res);
    for (const p of await Nodes.projects()) { if (p.id === Nodes.proj.id) continue; const r = await Nodes.get('nodes:proj:' + p.id); if (r) add(r.res); }
    for (const k of keys) if (!refs.has(k.slice(10))) await Nodes.idbDel(k);
  },

  // ---------- файл .vknodes ----------
  async exportFile(withResults) {
    await Nodes.flush();
    const data = { app: 'Вектор · Ноды', format: 'vknodes', v: 2, name: Nodes.proj.name, graph: Nodes.g, view: Nodes.view, res: {}, files: {}, outs: {} };
    for (const n of Nodes.g.nodes) for (const k of ['file', 'mask']) {
      const f = n.params[k]; if (f && f.key && !data.files[f.key]) { const b = await Nodes.getFile(f.key); if (b) data.files[f.key] = await Polza.dataURL(b); }
    }
    if (withResults) {
      for (const n of Nodes.g.nodes) {
        const r = Nodes.res[n.id]; if (!r || !r.hist) continue;
        data.res[n.id] = r;
        for (const e of r.hist) { const v = await Nodes.loadOut(e.id); if (v) data.outs[e.id] = await Nodes.serialize(v); }
      }
    }
    const name = (Nodes.proj.name || 'схема').replace(/[\\/:*?"<>|]+/g, ' ') + '.vknodes';
    await Host.saveFile(name, JSON.stringify(data), 'application/json', 'vknodes');
  },
  async serialize(v) { if (Array.isArray(v)) return Promise.all(v.map(Nodes.serialize)); const o = Nodes.strip(v); if (o.blob) { o.data = await Polza.dataURL(o.blob); delete o.blob; } return o; },
  async deserialize(v) { if (Array.isArray(v)) return Promise.all(v.map(Nodes.deserialize)); const o = Object.assign({}, v); if (o.data) { o.blob = await (await fetch(o.data)).blob(); delete o.data; } return o; },
  async importText(text, fileName = '') {
    let js; try { js = JSON.parse(text); } catch (e) { UI.toast('Не удалось прочитать схему: файл повреждён', true); return; }
    const graph = js.graph || (js.nodes ? js : null);
    if (!graph || !graph.nodes) { UI.toast('В файле нет схемы нод', true); return; }
    for (const [key, d] of Object.entries(js.files || {})) { const b = await (await fetch(d)).blob(); await Nodes.put('nodes:file:' + key, b); }
    for (const [eid, v] of Object.entries(js.outs || {})) await Nodes.put('nodes:out:' + eid, await Nodes.deserialize(v));
    const name = js.name || fileName.replace(/\.[^.]+$/, '') || 'Импорт';
    const id = Nodes.uid('p');
    await Nodes.put('nodes:proj:' + id, { id, name, graph: Object.assign({ nodes: [], edges: [] }, graph), res: js.res || {}, view: js.view, at: Date.now() });
    const list = await Nodes.projects(); list.push({ id, name, at: Date.now(), count: graph.nodes.length }); await Nodes.saveProjects(list);
    await Nodes.flush(); Nodes.ready = false;
    await Nodes.openProject(id);
    UI.toast('Открыт проект «' + name + '»');
  },
  async openDialog() {
    const [f] = await Host.pickFiles('.vknodes,.vkn,.json', false, 'Схема нод');
    if (!f) return;
    await Nodes.importText(new TextDecoder().decode(await f.read()), f.name);
  },
  save() { return Nodes.exportDialog(); },

  // ================= история правок и буфер =================
  commit() {
    const s = JSON.stringify(Nodes.g);
    if (s !== Nodes.hist[Nodes.hpos]) {
      Nodes.hist = Nodes.hist.slice(0, Nodes.hpos + 1); Nodes.hist.push(s);
      if (Nodes.hist.length > 150) Nodes.hist.shift();
      Nodes.hpos = Nodes.hist.length - 1;
    }
    Nodes.touch(); Nodes.refreshStale(); Nodes.updateRunUI(); Nodes.drawMini();
  },
  undo() { if (Nodes.hpos <= 0) return UI.toast('Отменять нечего'); Nodes.hpos--; Nodes.restore(); },
  redo() { if (Nodes.hpos >= Nodes.hist.length - 1) return; Nodes.hpos++; Nodes.restore(); },
  restore() {
    Nodes.g = JSON.parse(Nodes.hist[Nodes.hpos]);
    for (const id of [...Nodes.sel]) if (!Nodes.node(id)) Nodes.sel.delete(id);
    Nodes.render(); Nodes.touch(); Nodes.updateRunUI();
  },
  expandSel(ids) {
    const s = new Set(ids);
    for (const id of ids) { const n = Nodes.node(id); if (n && n.type === 'group') Nodes.groupMembers(n).forEach(m => s.add(m.id)); }
    return [...s];
  },
  clipData(ids) {
    ids = Nodes.expandSel(ids); const s = new Set(ids);
    const nodes = Nodes.g.nodes.filter(n => s.has(n.id)).map(n => JSON.parse(JSON.stringify(n)));
    const edges = Nodes.g.edges.filter(e => s.has(e.from) && s.has(e.to)).map(e => Object.assign({}, e));
    const res = {}; for (const id of ids) if (Nodes.res[id] && Nodes.res[id].hist) res[id] = JSON.parse(JSON.stringify(Nodes.res[id]));
    return { vknodes: 1, proj: Nodes.proj.id, nodes, edges, res };
  },
  copy(cut) {
    if (!Nodes.sel.size) return;
    const d = Nodes.clipData([...Nodes.sel]);
    Nodes.clip = d; Nodes._pasteN = 0;
    const txt = JSON.stringify(d); Nodes.clipText = txt;
    try { navigator.clipboard && navigator.clipboard.writeText(txt).catch(() => { }); } catch (e) { }
    UI.toast(`Скопировано узлов: ${d.nodes.length}`);
    if (cut) Nodes.removeIds(d.nodes.map(n => n.id));
  },
  // вставка данных буфера; at — точка мира для левого верхнего угла
  pasteData(d, at) {
    if (!d || !d.nodes || !d.nodes.length) return [];
    const map = {}, added = [];
    const minX = Math.min(...d.nodes.map(n => n.x)), minY = Math.min(...d.nodes.map(n => n.y));
    const off = at ? { x: at.x - minX, y: at.y - minY } : { x: 40 * (1 + (Nodes._pasteN = (Nodes._pasteN || 0) + 1) % 8), y: 40 * (1 + Nodes._pasteN % 8) };
    // группы — первыми, чтобы лежать под узлами
    const order = d.nodes.slice().sort((a, b) => (b.type === 'group') - (a.type === 'group'));
    for (const n0 of order) {
      const n = JSON.parse(JSON.stringify(n0)); n.id = Nodes.uid(); map[n0.id] = n.id;
      n.x = Math.round(n.x + off.x); n.y = Math.round(n.y + off.y);
      if (n.type === 'group') Nodes.g.nodes.unshift(n); else Nodes.g.nodes.push(n);
      added.push(n.id);
      if (d.res && d.res[n0.id] && d.proj === Nodes.proj.id) {
        Nodes.res[n.id] = JSON.parse(JSON.stringify(d.res[n0.id]));
        if (Nodes.res[n.id].cur) Nodes.loadOut(Nodes.res[n.id].cur).then(() => Nodes.paintOut(n.id));
      }
    }
    for (const e of d.edges || []) if (map[e.from] && map[e.to]) Nodes.g.edges.push({ from: map[e.from], fport: e.fport, to: map[e.to], tport: e.tport });
    Nodes.sel = new Set(added);
    Nodes.render(); Nodes.commit();
    return added;
  },
  duplicate() { if (!Nodes.sel.size) return; Nodes._pasteN = 0; Nodes.pasteData(Nodes.clipData([...Nodes.sel])); },
  pasteInternal(at) {
    let d = Nodes.clip;
    if (!d) { try { d = JSON.parse(localStorage.getItem('vektor.nodes.clip') || 'null'); } catch (e) { } }
    if (d) Nodes.pasteData(d, at);
  },
  async onPaste(e) {
    if (WS.current !== 'nodes' || UI.modalOpen() || Events.typing()) return;
    clearTimeout(Nodes._pasteWait); Nodes._pasteWait = 0;
    const dt = e.clipboardData; if (!dt) return;
    const files = [...dt.files].filter(f => /^image\//.test(f.type));
    e.preventDefault();
    const at = Nodes.mouseWorld();
    if (files.length) {
      const target = Nodes.sel.size === 1 && Nodes.node([...Nodes.sel][0]);
      if (target && target.type === 'image' && files.length === 1) return Nodes.setImage(target, files[0], files[0].name || 'вставка.png');
      return Nodes.addImages(files, at);
    }
    const txt = dt.getData('text/plain') || '';
    if (txt.startsWith('{"vknodes"')) { try { return Nodes.pasteData(JSON.parse(txt), at); } catch (er) { } }
    if (Nodes.clip && (!txt || txt === Nodes.clipText)) return Nodes.pasteInternal(at);
    if (txt.trim()) { const n = Nodes.add('text', at.x, at.y, { text: txt.trim() }); return n; }
    Nodes.pasteInternal(at);
  },
  async addImages(files, at) {
    const ids = [];
    let y = at.y;
    for (const f of files) {
      const n = Nodes.add('image', at.x, y, {}, { silent: true });
      ids.push(n.id); y += 300;
      await Nodes.setImage(n, f, f.name || 'картинка.png', true);
    }
    Nodes.sel = new Set(ids); Nodes.render(); Nodes.commit();
    return ids;
  },
  async setImage(n, blob, name, silent) {
    const key = await Nodes.putFile(blob);
    let thumb = '', w = 0, hh = 0;
    try { const img = await Polza.loadImage(blob); w = img.naturalWidth; hh = img.naturalHeight; thumb = await Polza.thumb(blob, 480, 'image/webp'); } catch (e) { }
    n.params.file = { name, key, thumb, w, h: hh, size: blob.size };
    delete Nodes.live[n.id];
    if (!silent) { Nodes.paint(n.id); Nodes.commit(); }
  },
  mouseWorld() {
    const r = Nodes.area.getBoundingClientRect(), m = Nodes._mouse;
    if (m && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom) return Nodes.toWorld(m);
    return Nodes.toWorld({ clientX: r.left + r.width / 2 - 140, clientY: r.top + r.height / 2 - 80 });
  },

  // ================= интерфейс =================
  build() {
    const el = h('div', { class: 'nodes nx' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    Nodes.projBtn = B('', 'Проекты: открыть, создать, переименовать, импорт и экспорт', () => Nodes.projectsDialog(), 'pbt nx-projbtn');
    Nodes.runBtn = B('▶ Запустить всё', 'Выполнить устаревшие и новые узлы (Ctrl+Shift+Enter)', () => Nodes.runAll(), 'primary');
    Nodes.runSelBtn = B('▶ Выбранные', 'Перезапустить выделенные узлы (Ctrl+Enter)', () => Nodes.runSelected());
    Nodes.stopBtn = B('■ Стоп', 'Остановить выполнение', () => Nodes.stop(), 'pbt nx-stop');
    Nodes.runInfo = h('span', { class: 'nx-runinfo' });
    Nodes.undoBtn = B('↶', 'Отменить (Ctrl+Z)', () => Nodes.undo(), 'pbt nx-icb');
    Nodes.redoBtn = B('↷', 'Повторить (Ctrl+Shift+Z)', () => Nodes.redo(), 'pbt nx-icb');
    const bar = h('div', { class: 'wsbar nx-bar' },
      Nodes.projBtn, B('▦ Шаблоны', 'Готовые сценарии и ваши шаблоны', () => Nodes.templatesDialog()),
      h('span', { class: 'sep' }),
      B('+ Узел', 'Добавить узел (двойной щелчок по холсту, Tab)', e => { const r = e.currentTarget.getBoundingClientRect(); Nodes.openPalette({ x: r.left, y: r.bottom + 4 }); }),
      B('✎ Заметка', 'Стикер с текстом (N)', () => { const p = Nodes.viewCenter(); Nodes.add('note', p.x - 110, p.y - 80); }),
      B('▢ Группа', 'Группа вокруг выделенного (Ctrl+G)', () => Nodes.groupSel()),
      h('span', { class: 'sep' }), Nodes.undoBtn, Nodes.redoBtn,
      h('span', { class: 'grow' }), Nodes.runInfo, Nodes.stopBtn, Nodes.runSelBtn, Nodes.runBtn,
      h('span', { class: 'sep' }),
      B('Незабранные', 'Оплаченные заказы Polza, результат которых ещё не забран', () => Nodes.pendingDialog()),
      B('⚙ Polza', 'Модели Polza по умолчанию', () => Polza.settingsDialog()),
      B('?', 'Управление и горячие клавиши', () => Nodes.helpDialog(), 'pbt nx-icb'));
    const area = h('div', { class: 'nx-area', tabindex: '-1' });
    const world = h('div', { class: 'nx-world' });
    const glayer = h('div', { class: 'nx-glayer' }), nlayer = h('div', { class: 'nx-nlayer' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'nx-edges');
    const guides = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); guides.setAttribute('class', 'nx-guides');
    world.append(glayer, svg, nlayer, guides);
    const marquee = h('div', { class: 'nx-marquee' });
    const empty = h('div', { class: 'nx-empty' },
      h('div', { class: 'nx-empty-card' },
        h('div', { class: 'nx-empty-t' }, 'Пустой холст'),
        h('p', {}, 'Соберите сценарий из узлов: текст и ассистент → генерация → правка → видео → экспорт. Или начните с готового шаблона.'),
        h('div', { class: 'nx-empty-b' },
          h('button', { class: 'primary', onclick: () => Nodes.templatesDialog() }, '▦ Шаблоны'),
          h('button', { class: 'pbt', onclick: e => { const r = e.currentTarget.getBoundingClientRect(); Nodes.openPalette({ x: r.left, y: r.bottom + 4 }); } }, '+ Добавить узел')),
        h('div', { class: 'nx-empty-h' }, 'Двойной щелчок — меню узлов · перетащите картинки сюда · Ctrl+V — вставить')));
    const zoom = h('span', { class: 'nx-zoomv', title: '100% (Shift+0)', onclick: () => Nodes.zoomTo(1) }, '100%');
    const ZB = (label, title, fn, cls = '') => h('button', { class: 'nx-zb ' + cls, title, onclick: fn }, label);
    Nodes.handBtn = ZB('✋', 'Рука: перетаскивание холста (H). Также пробел или средняя кнопка', () => { Nodes.hand = !Nodes.hand; Nodes.updateTools(); });
    Nodes.snapBtn = ZB('⌗', 'Привязка к сетке и соседним узлам (Alt при перетаскивании — без привязки)', () => { Nodes.snap = !Nodes.snap; Nodes.updateTools(); });
    Nodes.miniBtn = ZB('▣', 'Мини-карта', () => { Nodes.mini = !Nodes.mini; Nodes.updateTools(); Nodes.drawMini(); });
    const zbar = h('div', { class: 'nx-zbar' }, Nodes.handBtn, Nodes.snapBtn, h('span', { class: 'nx-zsep' }),
      ZB('−', 'Уменьшить (−)', () => Nodes.zoomBy(1 / 1.25)), zoom, ZB('+', 'Увеличить (+)', () => Nodes.zoomBy(1.25)),
      ZB('⤢', 'Показать всё (Shift+1)', () => Nodes.fit()), h('span', { class: 'nx-zsep' }), Nodes.miniBtn);
    const mini = h('canvas', { class: 'nx-mini', width: 200, height: 130, title: 'Мини-карта: щелчок — перейти' });
    const drop = h('div', { class: 'nx-drop' }, h('div', {}, 'Отпустите — картинки станут узлами'));
    area.append(world, marquee, empty, zbar, mini, drop);
    el.append(bar, area);
    Object.assign(Nodes, { el, area, world, glayer, nlayer, svg, guides, marquee, emptyEl: empty, zoomEl: zoom, miniEl: mini, dropEl: drop });
    Nodes.bindArea();
    Nodes.updateTools(); Nodes.updateRunUI();
    Nodes.init().catch(e => { console.warn(e); UI.toast('Ноды: не удалось открыть проект — ' + e.message, true); });
    return el;
  },
  shown() { Nodes.render(); },
  updateTools() {
    if (!Nodes.handBtn) return;
    Nodes.handBtn.classList.toggle('on', Nodes.hand); Nodes.snapBtn.classList.toggle('on', Nodes.snap); Nodes.miniBtn.classList.toggle('on', Nodes.mini);
    Nodes.miniEl.style.display = Nodes.mini ? '' : 'none';
    Nodes.area.classList.toggle('hand', Nodes.hand);
  },
  updateRunUI() {
    if (!Nodes.runBtn) return;
    Nodes.projBtn.textContent = '▤ ' + (Nodes.proj.name || 'Проект') + ' ▾';
    Nodes.undoBtn.disabled = Nodes.hpos <= 0; Nodes.redoBtn.disabled = Nodes.hpos >= Nodes.hist.length - 1;
    const m = new Map();
    const stale = Nodes.g.nodes.filter(n => Nodes.stale(n.id, m)).length;
    Nodes.runBtn.textContent = '▶ Запустить всё' + (stale ? ` (${stale})` : '');
    Nodes.runBtn.disabled = Nodes.running;
    Nodes.runSelBtn.disabled = Nodes.running;
    Nodes.stopBtn.style.display = Nodes.running ? '' : 'none';
    if (Nodes.running && Nodes.ctx) {
      const all = Object.values(Nodes.status);
      const run = all.filter(s => s.s === 'run').length, q = all.filter(s => s.s === 'queue').length;
      Nodes.runInfo.innerHTML = '';
      Nodes.runInfo.append(h('span', { class: 'spin' }), ` Выполняется: ${run}${q ? ' · в очереди ' + q : ''} · ${Nodes.fmtTime(Math.round((Date.now() - Nodes.ctx.t0) / 1000))}`);
    } else Nodes.runInfo.textContent = '';
  },
  fmtTime(s) { return s < 60 ? s + ' с' : Math.floor(s / 60) + ' мин ' + String(s % 60).padStart(2, '0') + ' с'; },
  fmtCost(c) { return (Math.round(c * 100) / 100).toLocaleString('ru') + ' ₽'; },
  toWorld(e) { const r = Nodes.area.getBoundingClientRect(); return { x: (e.clientX - r.left - Nodes.view.x) / Nodes.view.k, y: (e.clientY - r.top - Nodes.view.y) / Nodes.view.k }; },
  viewCenter() { const r = Nodes.area.getBoundingClientRect(); return { x: (r.width / 2 - Nodes.view.x) / Nodes.view.k, y: (r.height / 2 - Nodes.view.y) / Nodes.view.k }; },
  applyView() {
    const V = Nodes.view;
    Nodes.world.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.k})`;
    const gs = 24 * V.k;
    Nodes.area.style.backgroundSize = `${gs}px ${gs}px`;
    Nodes.area.style.backgroundPosition = `${V.x}px ${V.y}px`;
    Nodes.area.classList.toggle('far', V.k < 0.45);
    if (Nodes.zoomEl) Nodes.zoomEl.textContent = Math.round(V.k * 100) + '%';
    Nodes.drawMini();
    clearTimeout(Nodes._viewT); Nodes._viewT = setTimeout(() => Nodes.touch(), 800);
  },
  zoomAt(k, sx, sy) {
    const V = Nodes.view; k = Math.max(0.1, Math.min(3, k));
    V.x = sx - (sx - V.x) * k / V.k; V.y = sy - (sy - V.y) * k / V.k; V.k = k;
    Nodes.applyView();
  },
  zoomBy(f) { const r = Nodes.area.getBoundingClientRect(); Nodes.zoomAt(Nodes.view.k * f, r.width / 2, r.height / 2); },
  zoomTo(k) { const r = Nodes.area.getBoundingClientRect(); Nodes.zoomAt(k, r.width / 2, r.height / 2); },
  bbox(list) {
    const rs = (list || Nodes.g.nodes).map(n => Nodes.rectOf(n));
    if (!rs.length) return null;
    const x1 = Math.min(...rs.map(r => r.x)), y1 = Math.min(...rs.map(r => r.y)), x2 = Math.max(...rs.map(r => r.x + r.w)), y2 = Math.max(...rs.map(r => r.y + r.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },
  fit(list) {
    const b = Nodes.bbox(list); if (!b) return;
    const r = Nodes.area.getBoundingClientRect(), pad = 60;
    const k = Math.max(0.1, Math.min(1.2, Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h)));
    Nodes.view = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k };
    Nodes.applyView();
  },
  isEmptyTarget(t) { return t === Nodes.area || t === Nodes.world || t === Nodes.svg || t === Nodes.glayer || t === Nodes.nlayer || t === Nodes.emptyEl || (t.classList && t.classList.contains('nx-gbody')); },
  bindArea() {
    const area = Nodes.area;
    area.addEventListener('pointermove', e => { Nodes._mouse = { x: e.clientX, y: e.clientY, clientX: e.clientX, clientY: e.clientY }; });
    // панорама: пробел, средняя кнопка или режим «Рука» — перехватываем раньше узлов
    area.addEventListener('pointerdown', e => {
      UI.closeMenus(); Nodes.closePalette();
      const pan = e.button === 1 || (e.button === 0 && (Nodes.spaceDown || (Nodes.hand && Nodes.isEmptyTarget(e.target))));
      if (!pan) return;
      e.preventDefault(); e.stopPropagation();
      if (document.activeElement && Events.typing()) document.activeElement.blur();
      const x0 = e.clientX, y0 = e.clientY, vx = Nodes.view.x, vy = Nodes.view.y;
      area.classList.add('panning');
      const mv = ev => { Nodes.view.x = vx + ev.clientX - x0; Nodes.view.y = vy + ev.clientY - y0; Nodes.applyView(); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); area.classList.remove('panning'); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    }, true);
    // рамка выделения по пустому месту
    area.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !Nodes.isEmptyTarget(e.target)) return;
      if (document.activeElement && Events.typing()) document.activeElement.blur();
      area.focus({ preventScroll: true });
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      const base = add ? new Set(Nodes.sel) : new Set();
      if (!add && Nodes.sel.size) { Nodes.sel = new Set(); Nodes.updateSel(); }
      const ar = area.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      const M = Nodes.marquee;
      const mv = ev => {
        if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        moved = true;
        const x = Math.min(x0, ev.clientX) - ar.left, y = Math.min(y0, ev.clientY) - ar.top, w = Math.abs(ev.clientX - x0), hh = Math.abs(ev.clientY - y0);
        Object.assign(M.style, { display: 'block', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
        const a = Nodes.toWorld({ clientX: Math.min(x0, ev.clientX), clientY: Math.min(y0, ev.clientY) }), b = Nodes.toWorld({ clientX: Math.max(x0, ev.clientX), clientY: Math.max(y0, ev.clientY) });
        const s = new Set(base);
        for (const n of Nodes.g.nodes) {
          const r = Nodes.rectOf(n);
          const hit = n.type === 'group' ? r.x >= a.x && r.y >= a.y && r.x + r.w <= b.x && r.y + r.h <= b.y : r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y;
          if (hit) s.add(n.id);
        }
        Nodes.sel = s; Nodes.updateSel();
      };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); M.style.display = 'none'; };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    area.addEventListener('wheel', e => {
      const sc = e.target.closest && e.target.closest('textarea, .nx-scroll, .mp-pop');
      if (sc && !e.ctrlKey && sc.scrollHeight > sc.clientHeight + 1) return;
      e.preventDefault();
      const r = area.getBoundingClientRect();
      if (!e.ctrlKey && e.deltaX !== 0 && e.deltaMode === 0) { Nodes.view.x -= e.deltaX; Nodes.view.y -= e.deltaY; Nodes.applyView(); return; }
      if (e.shiftKey && !e.ctrlKey) { Nodes.view.x -= e.deltaY; Nodes.applyView(); return; }
      const f = Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 40 ? 0.01 : 0.0015));
      Nodes.zoomAt(Nodes.view.k * f, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    area.addEventListener('dblclick', e => {
      if (!Nodes.isEmptyTarget(e.target)) return;
      Nodes.openPalette({ x: e.clientX, y: e.clientY, at: Nodes.toWorld(e) });
    });
    area.addEventListener('contextmenu', e => {
      if (e.target.closest('textarea, input')) return;
      e.preventDefault();
      const nd = e.target.closest('[data-id]');
      if (nd && !Nodes.sel.has(nd.dataset.id)) { Nodes.sel = new Set([nd.dataset.id]); Nodes.updateSel(); }
      Nodes.contextMenu(e, nd ? Nodes.node(nd.dataset.id) : null);
    });
    // перетаскивание файлов на холст
    let dragDepth = 0;
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    area.addEventListener('dragenter', e => { if (!hasFiles(e)) return; dragDepth++; Nodes.dropEl.classList.add('on'); });
    area.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; Nodes.dropEl.classList.remove('on'); } });
    area.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    area.addEventListener('drop', e => { dragDepth = 0; Nodes.dropEl.classList.remove('on'); if (!hasFiles(e)) return; e.preventDefault(); Nodes.dropFiles([...e.dataTransfer.files], e); });
    const mini = Nodes.miniEl;
    mini.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const go = ev => {
        const m = Nodes._miniMap; if (!m) return;
        const r = mini.getBoundingClientRect(), ar = area.getBoundingClientRect();
        const wx = (ev.clientX - r.left - m.ox) / m.s + m.bx, wy = (ev.clientY - r.top - m.oy) / m.s + m.by;
        Nodes.view.x = ar.width / 2 - wx * Nodes.view.k; Nodes.view.y = ar.height / 2 - wy * Nodes.view.k; Nodes.applyView();
      };
      go(e);
      const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', go); window.addEventListener('pointerup', up);
    });
    window.addEventListener('keydown', Nodes.onKey);
    window.addEventListener('keyup', e => { if (e.code === 'Space') { Nodes.spaceDown = false; area.classList.remove('space'); } });
    window.addEventListener('blur', () => { Nodes.spaceDown = false; area.classList.remove('space'); });
    document.addEventListener('paste', e => Nodes.onPaste(e));
    window.addEventListener('beforeunload', () => { Nodes.flush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) Nodes.flush(); });
  },
  async dropFiles(files, e) {
    const at = Nodes.toWorld(e);
    const onNode = e.target.closest && e.target.closest('.nx-node');
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
    const proj = files.find(f => /\.(vknodes|vkn)$/i.test(f.name));
    if (proj) return Nodes.importText(await proj.text(), proj.name);
    if (onNode && imgs.length === 1) { const n = Nodes.node(onNode.dataset.id); if (n && n.type === 'image') return Nodes.setImage(n, imgs[0], imgs[0].name); }
    if (imgs.length) return Nodes.addImages(imgs, at);
    const txt = files.find(f => /\.(txt|md)$/i.test(f.name));
    if (txt) { const t = await txt.text(); Nodes.add(/\n.*\n/.test(t) ? 'list' : 'text', at.x, at.y, { text: t }); return; }
    UI.toast('Такие файлы на холст не добавляются: картинки, .txt или .vknodes');
  },
  onKey(e) {
    if (WS.current !== 'nodes' || UI.modalOpen() || Nodes.pal || !Nodes.area) return;
    if (Events.typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
    const c = e.code, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (c === 'Space') { stop(); if (!Nodes.spaceDown) { Nodes.spaceDown = true; Nodes.area.classList.add('space'); } return; }
    if (ctrl && c === 'KeyZ') { stop(); sh ? Nodes.redo() : Nodes.undo(); return; }
    if (ctrl && c === 'KeyY') { stop(); Nodes.redo(); return; }
    if (ctrl && c === 'KeyC') { stop(); Nodes.copy(); return; }
    if (ctrl && c === 'KeyX') { stop(); Nodes.copy(true); return; }
    if (ctrl && c === 'KeyV') { clearTimeout(Nodes._pasteWait); Nodes._pasteWait = setTimeout(() => { Nodes._pasteWait = 0; Nodes.pasteInternal(Nodes.mouseWorld()); }, 120); return; }
    if (ctrl && c === 'KeyD') { stop(); Nodes.duplicate(); return; }
    if (ctrl && c === 'KeyA') { stop(); Nodes.sel = new Set(Nodes.g.nodes.map(n => n.id)); Nodes.updateSel(); return; }
    if (ctrl && c === 'KeyG') { stop(); sh ? Nodes.ungroupSel() : Nodes.groupSel(); return; }
    if (ctrl && c === 'KeyS') { stop(); Nodes.flush().then(() => UI.toast('Проект сохранён на компьютере')); return; }
    if (ctrl && (c === 'Enter' || c === 'NumpadEnter')) { stop(); sh ? Nodes.runAll() : Nodes.runSelected(); return; }
    if (ctrl) return;
    if (c === 'Delete' || c === 'Backspace') { if (Nodes.sel.size) { stop(); Nodes.removeIds([...Nodes.sel]); } return; }
    if (c === 'Escape') { if (Nodes.running) return; Nodes.sel = new Set(); Nodes.updateSel(); return; }
    if ((sh && c === 'Digit1') || c === 'KeyF') { stop(); Nodes.fit(Nodes.sel.size && c === 'KeyF' ? Nodes.g.nodes.filter(n => Nodes.sel.has(n.id)) : null); return; }
    if (sh && c === 'Digit0') { stop(); Nodes.zoomTo(1); return; }
    if (c === 'Equal' || c === 'NumpadAdd') { stop(); Nodes.zoomBy(1.25); return; }
    if (c === 'Minus' || c === 'NumpadSubtract') { stop(); Nodes.zoomBy(1 / 1.25); return; }
    if (c === 'KeyH') { stop(); Nodes.hand = !Nodes.hand; Nodes.updateTools(); return; }
    if (c === 'KeyN') { stop(); const p = Nodes.mouseWorld(); Nodes.add('note', p.x, p.y); return; }
    if (c === 'Tab') { stop(); const m = Nodes._mouse || {}; Nodes.openPalette({ x: m.x || 200, y: m.y || 200, at: Nodes.mouseWorld() }); return; }
    if (c.startsWith('Arrow') && Nodes.sel.size) {
      stop(); const d = sh ? 50 : 10;
      const dx = c === 'ArrowLeft' ? -d : c === 'ArrowRight' ? d : 0, dy = c === 'ArrowUp' ? -d : c === 'ArrowDown' ? d : 0;
      for (const id of Nodes.expandSel([...Nodes.sel])) { const n = Nodes.node(id); if (n) { n.x += dx; n.y += dy; const el = Nodes.elOf(id); if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; } } }
      Nodes.drawEdges(); clearTimeout(Nodes._nudgeT); Nodes._nudgeT = setTimeout(() => Nodes.commit(), 400);
    }
  },
  elOf(id) { return Nodes.world && Nodes.world.querySelector(`[data-id="${id}"]`); },
  updateSel() {
    if (!Nodes.world) return;
    Nodes.world.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('sel', Nodes.sel.has(el.dataset.id)));
    Nodes.drawEdges();
  },
  render() {
    if (!Nodes.world) return;
    Nodes.glayer.innerHTML = ''; Nodes.nlayer.innerHTML = '';
    for (const n of Nodes.g.nodes) {
      if (n.type === 'group') Nodes.glayer.append(Nodes.groupEl(n));
      else Nodes.nlayer.append(n.type === 'note' ? Nodes.noteEl(n) : Nodes.nodeEl(n));
    }
    Nodes.emptyEl.style.display = Nodes.g.nodes.length || !Nodes.ready ? 'none' : '';
    Nodes.applyView(); Nodes.updateRunUI();
    requestAnimationFrame(() => { Nodes.drawEdges(); Nodes.drawMini(); Nodes.growGroups(); });
  },
  paint(id) {
    const old = Nodes.elOf(id), n = Nodes.node(id);
    if (!old || !n) return;
    old.replaceWith(n.type === 'group' ? Nodes.groupEl(n) : n.type === 'note' ? Nodes.noteEl(n) : Nodes.nodeEl(n));
    requestAnimationFrame(() => Nodes.drawEdges());
  },
  paintStatus(id) {
    const el = Nodes.elOf(id), n = Nodes.node(id); if (!el || !n || !el.classList.contains('nx-node')) return;
    const st = Nodes.status[id] || {};
    el.classList.remove('run', 'queue', 'err', 'ok');
    if (st.s) el.classList.add(st.s);
    const pill = el.querySelector('.nx-pill'); if (pill) Nodes.fillPill(pill, n);
    const pr = el.querySelector('.nx-prog');
    if (pr) { const show = st.s === 'run'; pr.style.display = show ? '' : 'none'; if (show) pr.firstChild.style.width = Math.min(100, Math.round(100 * (st.done || 0) / Math.max(1, st.total || 1))) + '%'; }
    if (st.s === 'err' || (!st.s && el.querySelector('.nx-err'))) Nodes.paintOut(id);
    if (Nodes.running && !Nodes._ruiT) Nodes._ruiT = requestAnimationFrame(() => { Nodes._ruiT = 0; Nodes.updateRunUI(); });
  },
  paintOut(id) {
    const el = Nodes.elOf(id), n = Nodes.node(id); if (!el || !n || !el.classList.contains('nx-node')) return;
    const box = el.querySelector('.nx-out'); if (!box) return;
    const nb = Nodes.outEl(n); box.replaceWith(nb);
    Nodes.paintStatus(id);
    requestAnimationFrame(() => { Nodes.drawEdges(); Nodes.growGroups(); });
  },
  refreshStale() {
    if (!Nodes.world) return;
    const m = new Map();
    for (const n of Nodes.g.nodes) {
      const el = Nodes.elOf(n.id); if (!el || !el.classList.contains('nx-node')) continue;
      const s = Nodes.stale(n.id, m);
      el.classList.toggle('stale', !!s);
      const pill = el.querySelector('.nx-pill'); if (pill) Nodes.fillPill(pill, n, s);
    }
    Nodes.updateRunUI();
  },
  fillPill(pill, n, stale) {
    const st = Nodes.status[n.id] || {};
    if (stale === undefined) stale = Nodes.stale(n.id);
    pill.className = 'nx-pill'; pill.innerHTML = ''; pill.title = '';
    if (st.s === 'run') {
      pill.classList.add('run');
      const t = Math.round((Date.now() - st.t0) / 1000);
      pill.append(h('span', { class: 'spin' }), ' ' + (st.total > 1 ? `${st.done || 0}/${st.total} · ` : '') + (st.note ? st.note + ' · ' : '') + t + ' с');
    } else if (st.s === 'queue') { pill.classList.add('queue'); pill.textContent = 'в очереди'; }
    else if (st.s === 'err') { pill.classList.add('err'); pill.textContent = st.up ? 'нет входа' : 'ошибка'; pill.title = st.note || ''; }
    else if (stale === 'new' && !Nodes.T(n).cheap) { pill.classList.add('new'); pill.textContent = 'новый'; pill.title = 'Ещё не запускался'; }
    else if (stale === 'changed') { pill.classList.add('stale'); pill.textContent = 'изменён'; pill.title = 'Параметры или входы изменились — результат устарел'; }
    else if (st.s === 'ok') {
      pill.classList.add('ok');
      pill.textContent = '✓ ' + Nodes.fmtTime(Math.max(1, Math.round(st.ms / 1000))) + (st.cost ? ' · ' + Nodes.fmtCost(st.cost) : '');
      if (st.warn) { pill.classList.add('warn'); pill.title = st.warn; pill.textContent += ' · ⚠'; }
    }
  },

  // ---------- карточка узла ----------
  nodeEl(n) {
    const T = Nodes.TYPES[n.type];
    if (!T) return h('div', { class: 'nx-node err', 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: '240px' } }, h('div', { class: 'nx-head' }, h('span', { class: 'nx-title' }, 'Неизвестный узел: ' + n.type)));
    const st = Nodes.status[n.id] || {};
    const el = h('div', { class: 'nx-node' + (Nodes.sel.has(n.id) ? ' sel' : '') + (st.s ? ' ' + st.s : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: (n.w || T.w || 280) + 'px' } });
    el.style.setProperty('--c', T.color);
    const pill = h('span', { class: 'nx-pill' });
    const head = h('div', { class: 'nx-head' }, h('span', { class: 'nx-ic' }, T.ic), h('span', { class: 'nx-title', title: (T.desc || '') + '\nДвойной щелчок — переименовать' }, Nodes.title(n)), h('span', { class: 'grow' }), pill,
      h('button', { class: 'nx-hb run', title: 'Запустить этот узел (и то, что перед ним, если устарело)', onclick: e => { e.stopPropagation(); Nodes.run(n.id); } }, '▶'),
      h('button', { class: 'nx-hb', title: 'Меню узла', onclick: e => { e.stopPropagation(); Nodes.sel = new Set([n.id]); Nodes.updateSel(); Nodes.contextMenu(e, n); } }, '⋯'));
    head.querySelector('.nx-title').addEventListener('dblclick', e => { e.stopPropagation(); UI.prompt('Название узла', Nodes.title(n), v => { n.title = v && v !== Nodes.T(n).title ? v : undefined; Nodes.paint(n.id); Nodes.commit(); }); });
    const prog = h('div', { class: 'nx-prog', style: { display: 'none' } }, h('i'));
    const ports = h('div', { class: 'nx-ports' });
    const ins = h('div', { class: 'nx-ins' }), outs = h('div', { class: 'nx-outs' });
    for (const [name, kind, multi, label] of T.inputs || []) {
      const port = h('span', { class: 'nx-port k-' + kind, 'data-p': name, 'data-o': '0', title: `Вход: ${label || name} (${NX_KIND[kind]}${multi ? ', можно несколько' : ''})` });
      port.addEventListener('pointerdown', e => Nodes.dragFromInput(e, n, name));
      ins.append(h('div', { class: 'nx-pr' }, port, h('span', {}, label || name)));
    }
    for (const [name, kind, label] of T.outputs || []) {
      const port = h('span', { class: 'nx-port k-' + kind, 'data-p': name, 'data-o': '1', title: `Выход: ${label || name} (${NX_KIND[kind]}). Тяните ко входу или на пустое место` });
      port.addEventListener('pointerdown', e => Nodes.dragFromOutput(e, n, name));
      outs.append(h('div', { class: 'nx-pr out' }, h('span', {}, label || name), port));
    }
    if ((T.inputs || []).length || (T.outputs || []).length) ports.append(ins, outs);
    const body = h('div', { class: 'nx-body' });
    const adv = [];
    for (const p of T.params) {
      if (p.show && !p.show(n.params)) continue;
      const c = Nodes.paramEl(n, p); if (!c) continue;
      if (p.adv) adv.push(c); else body.append(c);
    }
    if (adv.length) {
      const d = h('details', { class: 'nx-adv' }, h('summary', {}, 'Ещё параметры'), ...adv);
      if (n.params._adv) d.open = true;
      d.addEventListener('toggle', () => { n.params._adv = d.open || undefined; Nodes.touch(); requestAnimationFrame(() => Nodes.drawEdges()); });
      body.append(d);
    }
    if (!body.childNodes.length) body.classList.add('empty');
    const rz = h('div', { class: 'nx-rz', title: 'Ширина' });
    rz.addEventListener('pointerdown', e => Nodes.resizeNode(e, n, el, true));
    el.append(head, prog, ports, body, Nodes.outEl(n), rz);
    Nodes.fillPill(pill, n);
    if (Nodes.stale(n.id)) el.classList.add('stale');
    el.addEventListener('pointerdown', e => Nodes.nodeDown(e, n, el));
    // картинку можно бросить прямо на узел «Картинка»
    if (n.type === 'image') {
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dropping'); });
      el.addEventListener('dragleave', () => el.classList.remove('dropping'));
    }
    return el;
  },
  nodeDown(e, n, el) {
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest('input, textarea, select, button, .nx-port, .mpick, .nx-rz, .nx-cmp, video, summary, a, .nx-nodrag')) {
      if (!Nodes.sel.has(n.id)) { Nodes.sel = new Set([n.id]); Nodes.updateSel(); }
      return;
    }
    e.preventDefault();
    if (document.activeElement && Events.typing()) document.activeElement.blur();
    Nodes.startDrag(e, n);
  },
  // перетаскивание выделенного (группа тянет свои узлы), привязка к сетке и к соседям
  startDrag(e, n) {
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (add) { Nodes.sel.has(n.id) ? Nodes.sel.delete(n.id) : Nodes.sel.add(n.id); Nodes.updateSel(); if (!Nodes.sel.has(n.id)) return; }
    else if (!Nodes.sel.has(n.id)) { Nodes.sel = new Set([n.id]); Nodes.updateSel(); }
    const ids = Nodes.expandSel([...Nodes.sel]);
    const moving = ids.map(id => Nodes.node(id)).filter(Boolean);
    const starts = new Map(moving.map(m => [m.id, { x: m.x, y: m.y }]));
    const mset = new Set(ids);
    const others = Nodes.g.nodes.filter(o => !mset.has(o.id) && o.type !== 'group').map(o => Nodes.rectOf(o));
    const me = Nodes.rectOf(n);
    const els = new Map(moving.map(m => [m.id, Nodes.elOf(m.id)]));
    const x0 = e.clientX, y0 = e.clientY; let moved = false;
    Nodes._dragMoved = false;
    const mv = ev => {
      const k = Nodes.view.k;
      let dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true; Nodes._dragMoved = true;
      const guides = [];
      if (Nodes.snap && !ev.altKey) {
        const th = 6 / k, s = starts.get(n.id);
        const nx = s.x + dx, ny = s.y + dy;
        let bx = null, by = null;
        const cxs = [[nx, 0], [nx + me.w / 2, me.w / 2], [nx + me.w, me.w]], cys = [[ny, 0], [ny + me.h / 2, me.h / 2], [ny + me.h, me.h]];
        for (const o of others) {
          for (const [v, off] of cxs) for (const t of [o.x, o.x + o.w / 2, o.x + o.w]) if (Math.abs(v - t) < th && (!bx || Math.abs(v - t) < bx.d)) bx = { d: Math.abs(v - t), x: t - off, g: t, o };
          for (const [v, off] of cys) for (const t of [o.y, o.y + o.h / 2, o.y + o.h]) if (Math.abs(v - t) < th && (!by || Math.abs(v - t) < by.d)) by = { d: Math.abs(v - t), y: t - off, g: t, o };
        }
        if (bx) { dx = bx.x - s.x; guides.push({ x: bx.g, y1: Math.min(ny, bx.o.y), y2: Math.max(ny + me.h, bx.o.y + bx.o.h) }); } else dx = Math.round(nx / 12) * 12 - s.x;
        if (by) { dy = by.y - s.y; guides.push({ y: by.g, x1: Math.min(s.x + dx, by.o.x), x2: Math.max(s.x + dx + me.w, by.o.x + by.o.w) }); } else dy = Math.round(ny / 12) * 12 - s.y;
      }
      for (const m of moving) { const s = starts.get(m.id); m.x = Math.round(s.x + dx); m.y = Math.round(s.y + dy); const el = els.get(m.id); if (el) { el.style.left = m.x + 'px'; el.style.top = m.y + 'px'; } }
      Nodes.drawGuides(guides); Nodes.drawEdges();
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      Nodes.drawGuides([]);
      if (moved) { Nodes.commit(); setTimeout(() => { Nodes._dragMoved = false; }, 0); }
      else if (!add && Nodes.sel.size > 1) { Nodes.sel = new Set([n.id]); Nodes.updateSel(); }
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  },
  resizeNode(e, n, el, widthOnly) {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, w0 = el.offsetWidth, h0 = el.offsetHeight;
    const mv = ev => {
      const k = Nodes.view.k;
      n.w = Math.max(widthOnly ? 220 : 120, Math.round((w0 + (ev.clientX - x0) / k) / 4) * 4); el.style.width = n.w + 'px';
      if (!widthOnly) { n.h = Math.max(80, Math.round((h0 + (ev.clientY - y0) / k) / 4) * 4); el.style.height = n.h + 'px'; }
      Nodes.drawEdges();
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); Nodes.commit(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  },
  drawGuides(list) {
    const svg = Nodes.guides; svg.innerHTML = '';
    for (const g of list) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      if (g.x !== undefined) { l.setAttribute('x1', g.x); l.setAttribute('x2', g.x); l.setAttribute('y1', g.y1 - 20); l.setAttribute('y2', g.y2 + 20); }
      else { l.setAttribute('y1', g.y); l.setAttribute('y2', g.y); l.setAttribute('x1', g.x1 - 20); l.setAttribute('x2', g.x2 + 20); }
      svg.append(l);
    }
  },

  // ---------- параметры ----------
  opts(o) { return Array.isArray(o) ? o : String(o).split('|').map(s => { const i = s.indexOf('='); return i < 0 ? [s, s] : [s.slice(0, i), s.slice(i + 1)]; }); },
  paramEl(n, p) {
    const P = n.params, key = p.k;
    const set = (v, repaint) => {
      P[key] = v; Nodes.commit();
      if (repaint || Nodes.T(n).params.some(q => q.show)) Nodes.paint(n.id);
      if (n.type === 'compare') Nodes.paintOut(n.id);
      for (const e of Nodes.g.edges.filter(x => x.from === n.id)) { const t = Nodes.node(e.to); if (t && t.type === 'compare') Nodes.paintOut(t.id); }
    };
    const lab = (txt, ctl, cls = '') => h('label', { class: 'nx-f ' + cls }, h('span', { class: 'nx-fl' }, txt), ctl);
    switch (p.t) {
      case 'textarea': {
        const ta = h('textarea', { rows: p.rows || 3, placeholder: p.l, value: P[key] || '', spellcheck: 'false' });
        ta.addEventListener('input', () => { P[key] = ta.value; clearTimeout(ta._t); ta._t = setTimeout(() => { Nodes.refreshStale(); Nodes.touch(); }, 350); });
        ta.addEventListener('change', () => set(ta.value));
        return ta;
      }
      case 'text': case 'json': {
        const i = h('input', { type: 'text', placeholder: p.l, value: P[key] || '', spellcheck: 'false' });
        i.addEventListener('change', () => set(i.value));
        return i;
      }
      case 'number': {
        const i = h('input', { type: 'number', class: 'num', value: P[key] ?? '', min: p.min, max: p.max });
        i.addEventListener('change', () => set(i.value === '' ? '' : +i.value));
        return lab(p.l, i, 'row');
      }
      case 'select': {
        const opts = Nodes.opts(p.o);
        const cur = P[key] ?? opts[0][0];
        return lab(p.l, UI.sel(opts, cur, v => set(v, true), p.l), 'row');
      }
      case 'seg': {
        const opts = Nodes.opts(p.o);
        const cur = String(P[key] ?? opts[0][0]);
        const box = h('div', { class: 'nx-seg' }, opts.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: () => set(isFinite(+v) ? +v : v, true) }, l)));
        return lab(p.l, box, 'row');
      }
      case 'seed': {
        const i = h('input', { type: 'number', class: 'num', value: P[key] ?? '', placeholder: 'случайный' });
        i.addEventListener('change', () => set(i.value === '' ? '' : +i.value));
        return lab(p.l, h('span', { class: 'nx-seed' }, i, h('button', { class: 'nx-mini-b', title: 'Новый случайный seed', onclick: () => set(Math.floor(Math.random() * 1e9), true) }, '🎲'), h('button', { class: 'nx-mini-b', title: 'Каждый раз случайный', onclick: () => set('', true) }, '×')), 'row');
      }
      case 'model': {
        const def = p.role === 'chat' ? Agent.settings.model : Polza.media[p.role];
        const mp = ModelPick.el(p.mt, P[key] || '', v => set(v), { auto: true, placeholder: def ? 'По умолчанию: ' + def : 'Автоматически' });
        return lab(p.l, mp);
      }
      case 'file': {
        const f = P[key];
        const pick = async () => {
          const [x] = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.gif,.bmp', false, 'Картинка');
          if (x) await Nodes.setImage(n, await Host.blobOf(x), x.name);
        };
        const fromClip = async () => {
          try {
            const items = await navigator.clipboard.read();
            for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) return Nodes.setImage(n, await it.getType(t), 'вставка.png'); }
            UI.toast('В буфере нет картинки');
          } catch (e) { UI.toast('Нет доступа к буферу: выделите узел и нажмите Ctrl+V'); }
        };
        const src = f && (f.thumb || f.data || (f.path && Host.desktop ? Host.fileURL(f.path) : ''));
        const drop = h('div', { class: 'nx-dropzone' + (src ? ' has' : '') },
          src ? h('img', { src, onclick: async () => { if (Nodes._dragMoved) return; const b = await Nodes.readFileParam(f).catch(() => null); if (b) Nodes.openViewer([{ kind: 'image', blob: b, name: f.name }], 0); } })
            : h('div', { class: 'nx-dz-t' }, 'Перетащите картинку сюда', h('br'), 'или вставьте Ctrl+V'));
        drop.addEventListener('drop', async e => {
          const file = [...(e.dataTransfer.files || [])].find(x => /^image\//.test(x.type));
          if (!file) return; e.preventDefault(); e.stopPropagation();
          await Nodes.setImage(n, file, file.name);
        });
        return h('div', { class: 'nx-file' }, drop,
          h('div', { class: 'nx-row' }, h('button', { class: 'pbt', onclick: pick }, f ? 'Заменить…' : 'Выбрать файл…'), h('button', { class: 'pbt', onclick: fromClip, title: 'Вставить картинку из буфера обмена' }, 'Из буфера'),
            f ? h('span', { class: 'nx-dim', title: f.name }, f.w ? `${f.w}×${f.h}` : f.name) : null));
      }
      case 'folder':
        return h('button', { class: 'pbt nx-wide', onclick: async () => {
          const f = await Host.pickFolder('Папка'); if (!f) return;
          Nodes.folders[n.id] = f; set({ name: f.name, root: f.root }, true);
        } }, P[key] ? '📁 ' + P[key].name : (p.l || 'Выбрать папку…'));
      case 'mask':
        return h('div', { class: 'nx-row' }, h('button', { class: 'pbt', onclick: () => Nodes.maskDialog(n) }, P.mask ? '✎ Изменить маску…' : '✎ Нарисовать маску…'),
          P.mask && P.mask.thumb ? h('img', { class: 'nx-maskthumb', src: P.mask.thumb }) : h('span', { class: 'nx-dim' }, 'область, которую менять'));
      case 'vzbtn':
        return h('button', { class: 'pbt nx-wide', title: 'Окно векторизации с живым просмотром — результат станет выходом узла', onclick: () => Nodes.vectorizeUI(n) }, '⬠ Окно векторизации…');
    }
    return null;
  },
  async vectorizeUI(n) {
    const src = await Nodes.inputVal(n.id, 'image');
    const b = src ? await Nodes.imgBlob(src).catch(() => null) : null;
    if (!b) return UI.toast('Сначала подключите картинку (и запустите узел-источник)', true);
    Polza.vectorizeDialog(b, async (svg, o) => {
      Object.assign(n.params, { colors: o.colors, detail: o.detail, smooth: o.smooth, nobg: o.removeBg ? 'yes' : 'no', palette: (o.palette || []).join(', ') });
      Nodes.commit();
      await Nodes.record(n.id, { kind: 'svg', text: svg, name: 'вектор.svg' }, { manual: true });
      Nodes.paint(n.id); Nodes.refreshStale();
    }, 'Векторизация — узел «' + Nodes.title(n) + '»');
  },
  async maskDialog(n) {
    const src = await Nodes.inputVal(n.id, 'image');
    const blob = src ? await Nodes.imgBlob(src).catch(() => null) : null;
    if (!blob) return UI.toast('Сначала подключите картинку ко входу «картинка» (и запустите узел-источник)', true);
    const img = await Polza.loadImage(blob);
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 720 / W, 480 / H);
    const view = h('canvas', { width: Math.round(W * k), height: Math.round(H * k), class: 'nx-maskc' });
    const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
    const mg = mask.getContext('2d');
    if (n.params.mask && n.params.mask.key) { const mb = await Nodes.getFile(n.params.mask.key); if (mb) mg.drawImage(await Polza.loadImage(mb), 0, 0, W, H); }
    const size = h('input', { type: 'range', min: 4, max: 200, value: 40 }); let erase = false;
    const tint = document.createElement('canvas'); tint.width = W; tint.height = H;
    const draw = () => {
      const g = view.getContext('2d'); g.clearRect(0, 0, view.width, view.height); g.drawImage(img, 0, 0, view.width, view.height);
      const tg = tint.getContext('2d'); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, W, H); tg.drawImage(mask, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = '#ff00ff'; tg.fillRect(0, 0, W, H);
      g.globalAlpha = .55; g.drawImage(tint, 0, 0, view.width, view.height); g.globalAlpha = 1;
    };
    let last = null;
    view.addEventListener('pointerdown', e => {
      view.setPointerCapture(e.pointerId);
      const pt = ev => { const r = view.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H }; };
      last = pt(e);
      const stroke = p => {
        mg.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
        mg.strokeStyle = '#fff'; mg.fillStyle = '#fff'; mg.lineCap = 'round'; mg.lineJoin = 'round'; mg.lineWidth = +size.value / k;
        mg.beginPath(); mg.moveTo(last.x, last.y); mg.lineTo(p.x + .01, p.y); mg.stroke(); last = p; draw();
      };
      stroke(last);
      const mv = ev => stroke(pt(ev));
      const up = () => { view.removeEventListener('pointermove', mv); view.removeEventListener('pointerup', up); };
      view.addEventListener('pointermove', mv); view.addEventListener('pointerup', up);
    });
    const modeBtn = h('button', { class: 'pbt', onclick: () => { erase = !erase; modeBtn.textContent = erase ? 'Режим: ластик' : 'Режим: кисть'; } }, 'Режим: кисть');
    const box = UI.dialog('Маска: закрасьте область, которую нужно изменить', h('div', { class: 'form nx-maskd' },
      h('div', { class: 'row' }, h('label', { class: 'row' }, 'Кисть ', size), modeBtn, h('button', { class: 'pbt', onclick: () => { mg.clearRect(0, 0, W, H); draw(); } }, 'Очистить')), view),
    [{ label: 'Отмена' }, { label: 'Сохранить маску', primary: true, action: () => {
      (async () => {
        const mb = await new Promise(r => mask.toBlob(r, 'image/png'));
        const key = await Nodes.putFile(mb);
        const t = document.createElement('canvas'); t.width = 96; t.height = Math.round(96 * H / W); const tg = t.getContext('2d'); tg.drawImage(img, 0, 0, t.width, t.height); tg.globalAlpha = .6; tg.drawImage(tint, 0, 0, t.width, t.height);
        n.params.mask = { key, thumb: t.toDataURL('image/webp', .8) };
        Nodes.paint(n.id); Nodes.commit();
      })();
    } }]);
    box.classList.add('nx-dlg-wide');
    draw();
  },

  // ---------- результаты: галерея, история ----------
  outEl(n) {
    const box = h('div', { class: 'nx-out' });
    const T = Nodes.T(n), st = Nodes.status[n.id] || {};
    if (st.s === 'err' && st.note) box.append(h('div', { class: 'nx-err' }, h('span', {}, st.note), st.up ? null : h('button', { class: 'nx-mini-b', onclick: () => Nodes.run(n.id) }, 'Повторить')));
    if (n.type === 'compare') { Nodes.compareEl(n, box); return box; }
    if (T.cheap && !['list', 'template', 'figma', 'vektor', 'folder'].includes(n.type)) return box;
    const v = T.cheap ? Nodes.output(n.id) : Nodes.res[n.id] && Nodes.res[n.id].cur ? Nodes.outs[Nodes.res[n.id].cur] : null;
    const r = Nodes.res[n.id];
    if (!T.cheap && r && r.cur && Nodes.outs[r.cur] === undefined) { box.append(h('div', { class: 'nx-loading' }, 'Загружаю результат…')); return box; }
    if (v != null) {
      const items = Nodes.flat(v);
      const item = !T.cheap && r && r.item != null ? r.item : null;
      if (items.length > 1) {
        const allText = items.every(x => x.kind === 'text');
        const grid = h('div', { class: 'nx-gal' + (allText ? ' text' : '') + (items.length > 4 && !allText ? ' c3' : '') + ' nx-scroll' });
        items.forEach((x, i) => {
          const cell = h('div', { class: 'nx-cell' + (item === i ? ' pin' : item != null ? ' dim' : '') }, Nodes.media(x, false, i, () => Nodes.openViewer(items, i, n.id)),
            h('span', { class: 'nx-ix' }, i + 1));
          if (!T.cheap) cell.append(h('button', { class: 'nx-star', title: item === i ? 'Снять: на выход пойдут все варианты' : 'Только этот вариант на выход', onclick: e => { e.stopPropagation(); Nodes.setCur(n.id, r.cur, item === i ? null : i); } }, item === i ? '★' : '☆'));
          grid.append(cell);
        });
        box.append(grid);
        box.append(h('div', { class: 'nx-meta' }, item != null ? `На выходе: вариант ${item + 1} из ${items.length}` : `${items.length} ${Nodes.plural(items.length, allText ? ['вариант', 'варианта', 'вариантов'] : ['результат', 'результата', 'результатов'])} — дальше пойдут все`));
      } else if (items.length === 1) {
        const x = items[0];
        box.append(h('div', { class: 'nx-one' }, Nodes.media(x, false, 0, () => Nodes.openViewer(items, 0, n.id))));
      }
      if (!T.cheap && items.length && items.every(x => x.kind === 'text') && !['save', 'toApp'].includes(n.type)) {
        box.append(h('div', { class: 'nx-row' }, h('button', { class: 'nx-mini-b', title: 'Поправить текст вручную — станет новой версией результата', onclick: () => Nodes.editText(n, items) }, '✎ Править текст')));
      }
    }
    if (!T.cheap && r && r.hist && r.hist.length > 1) box.append(Nodes.histEl(n));
    return box;
  },
  plural(n, f) { const a = n % 10, b = n % 100; return f[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2]; },
  editText(n, items) {
    const ta = h('textarea', { rows: 12, class: 'wide', style: { width: '560px', maxWidth: '80vw' }, value: items.map(x => x.text).join(items.length > 1 ? '\n' : '') });
    UI.dialog(items.length > 1 ? 'Варианты — по одному на строку' : 'Текст результата', ta, [{ label: 'Отмена' }, { label: 'Сохранить версию', primary: true, action: () => {
      const t = ta.value.trim(); if (!t) return;
      const out = items.length > 1 ? t.split(/\n+/).map(s => s.trim()).filter(Boolean).map(s => ({ kind: 'text', text: s })) : { kind: 'text', text: t };
      Nodes.record(n.id, out, { manual: true }).then(() => { Nodes.paintOut(n.id); Nodes.refreshStale(); });
    } }]);
  },
  histEl(n) {
    const r = Nodes.res[n.id];
    const strip = h('div', { class: 'nx-hist nx-scroll' });
    const list = r.hist.slice().reverse();
    for (const e of list) {
      const th = h('button', { class: 'nx-h' + (e.id === r.cur ? ' on' : ''), title: new Date(e.at).toLocaleString('ru') + (e.n > 1 ? ` · ${e.n} шт.` : '') + (e.cost ? ' · ' + Nodes.fmtCost(e.cost) : '') + (e.manual ? ' · вручную' : '') + '\nЩелчок — сделать выходом' });
      th.addEventListener('click', ev => { ev.stopPropagation(); if (e.id !== r.cur) Nodes.setCur(n.id, e.id); });
      Nodes.loadOut(e.id).then(v => {
        const x = Nodes.flat(v)[0];
        if (!x) { th.textContent = '—'; return; }
        if (x.kind === 'image' || x.kind === 'svg') th.append(h('img', { src: Nodes.urlOf(x) }));
        else if (x.kind === 'video') th.append(h('span', {}, '►'));
        else th.append(h('span', {}, 'T'));
        if (e.n > 1) th.append(h('i', {}, e.n));
      });
      strip.append(th);
    }
    return h('div', { class: 'nx-histw' }, h('div', { class: 'nx-histh' }, h('span', {}, `История · ${r.hist.length}`), h('span', { class: 'grow' }), h('button', { class: 'nx-mini-b', onclick: () => Nodes.historyDialog(n) }, 'Все…')), strip);
  },
  urlOf(v) {
    if (v.url) return v.url;
    if (v.kind === 'svg') v.url = URL.createObjectURL(new Blob([v.text], { type: 'image/svg+xml' }));
    else if (v.blob) v.url = URL.createObjectURL(v.blob);
    return v.url || '';
  },
  media(v, big, i, onOpen) {
    const open = e => { if (Nodes._dragMoved) return; e && e.stopPropagation(); onOpen && onOpen(); };
    if (v.kind === 'text') {
      const d = h('div', { class: 'nx-txt' + (big ? ' big' : ' nx-scroll') }, v.text);
      if (!big) d.addEventListener('dblclick', open);
      return d;
    }
    if (v.kind === 'video') {
      const vd = h('video', { class: 'nx-media', src: Nodes.urlOf(v), muted: true, loop: true, autoplay: !big, playsinline: true, controls: big ? true : undefined });
      vd.muted = true;
      if (!big) { vd.classList.add('nx-nodrag'); vd.addEventListener('click', open); }
      return vd;
    }
    const img = h('img', { class: 'nx-media' + (v.kind === 'svg' ? ' svg' : ''), src: Nodes.urlOf(v), draggable: 'false' });
    if (!big) img.addEventListener('click', open);
    return img;
  },
  openViewer(items, idx = 0, nodeId) {
    let i = idx;
    const stage = h('div', { class: 'nx-vstage' }), cap = h('div', { class: 'nx-vcap' });
    const prev = h('button', { class: 'nx-vnav l', onclick: () => go(-1) }, '‹'), next = h('button', { class: 'nx-vnav r', onclick: () => go(1) }, '›');
    const go = d => { i = (i + d + items.length) % items.length; show(); };
    const show = () => {
      stage.innerHTML = ''; stage.append(Nodes.media(items[i], true));
      if (items.length > 1) stage.append(prev, next);
      const v = items[i];
      cap.textContent = (items.length > 1 ? `${i + 1} из ${items.length}` : '') + (v.prompt ? (items.length > 1 ? ' · ' : '') + v.prompt.slice(0, 220) : '');
    };
    const btns = [{ label: 'Сохранить…', action: () => { const v = items[i]; Host.saveFile((v.name || 'результат').replace(/\.[^.]+$/, '') + '.' + Nodes.extOf(v), v.kind === 'svg' || v.kind === 'text' ? v.text : v.blob); return false; } }];
    if (items.length > 1) btns.push({ label: 'Сохранить все…', action: () => { Nodes.saveAll(items); return false; } });
    if (nodeId && items.length > 1 && !Nodes.T(Nodes.node(nodeId)).cheap) btns.push({ label: 'Только этот на выход', action: () => { const r = Nodes.res[nodeId]; if (r) Nodes.setCur(nodeId, r.cur, i); } });
    if (items[i].kind === 'image' || items[i].kind === 'svg') btns.push({ label: 'В «Вектор»', action: () => { const v = items[i]; WS.show('vektor'); (v.kind === 'svg' ? Promise.resolve(IO.importSVGText(v.text, null)) : IO.importRaster(v.blob, v.name || 'Картинка')).then(() => App.commit('Из «Нод»')); } });
    btns.push({ label: 'Закрыть', primary: true });
    const box = UI.dialog('Результат', h('div', { class: 'nx-viewer' }, stage, cap), btns);
    box.classList.add('nx-dlg-view'); box.setAttribute('tabindex', '-1'); box.focus();
    box.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); });
    show();
  },
  async saveAll(items) {
    const folder = await Host.pickFolder('Куда сохранить'); if (!folder) return;
    let k = 0;
    for (const v of items) { k++; await Host.writeToFolder(folder, `результат-${String(k).padStart(2, '0')}.${Nodes.extOf(v)}`, v.kind === 'svg' || v.kind === 'text' ? v.text : v.blob); }
    UI.toast(`Сохранено: ${k}`);
  },
  async historyDialog(n) {
    const r = Nodes.res[n.id]; if (!r || !r.hist) return;
    const box = h('div', { class: 'nx-hd' });
    for (const e of r.hist.slice().reverse()) {
      const v = await Nodes.loadOut(e.id); const items = Nodes.flat(v);
      const row = h('div', { class: 'nx-hd-row' + (e.id === r.cur ? ' on' : '') },
        h('div', { class: 'nx-hd-m' }, h('b', {}, new Date(e.at).toLocaleString('ru')), h('span', {}, [e.n > 1 ? e.n + ' шт.' : '', e.ms ? Nodes.fmtTime(Math.round(e.ms / 1000)) : '', e.cost ? Nodes.fmtCost(e.cost) : '', e.manual ? 'вручную' : ''].filter(Boolean).join(' · ')),
          h('div', { class: 'nx-row' },
            e.id === r.cur ? h('span', { class: 'nx-dim' }, '● на выходе') : h('button', { class: 'pbt', onclick: () => { Nodes.setCur(n.id, e.id); UI.closeDialog(); } }, 'Сделать выходом'),
            h('button', { class: 'pbt', title: 'Удалить версию', onclick: () => { Nodes.dropEntry(n.id, e.id); row.remove(); } }, 'Удалить'))),
        h('div', { class: 'nx-hd-items' }, items.slice(0, 12).map((x, i) => Nodes.media(x, false, i, () => Nodes.openViewer(items, i, n.id)))));
      box.append(row);
    }
    const d = UI.dialog('История — ' + Nodes.title(n), box, [{ label: 'Закрыть', primary: true }]);
    d.classList.add('nx-dlg-wide');
  },
  async compareEl(n, box) {
    const a = await Nodes.inputVal(n.id, 'a').catch(() => null), b = await Nodes.inputVal(n.id, 'b').catch(() => null);
    const A = a && Nodes.flat(a)[0], Bv = b && Nodes.flat(b)[0];
    if (!A || !Bv) { box.append(h('div', { class: 'nx-dim nx-pad' }, 'Подключите «до» и «после» — появится шторка. Результаты источников должны быть готовы.')); return; }
    const ia = h('img', { src: Nodes.urlOf(A), draggable: 'false' }), ib = h('img', { src: Nodes.urlOf(Bv), draggable: 'false' });
    const line = h('div', { class: 'nx-cmp-line' });
    const cmp = h('div', { class: 'nx-cmp' }, ib, h('div', { class: 'nx-cmp-a' }, ia), line, h('span', { class: 'nx-cmp-l' }, 'до'), h('span', { class: 'nx-cmp-r' }, 'после'));
    const setX = f => { f = Math.max(0, Math.min(1, f)); n.params._cmp = f; cmp.style.setProperty('--x', (f * 100) + '%'); };
    setX(n.params._cmp ?? 0.5);
    cmp.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      const r = cmp.getBoundingClientRect(); setX((e.clientX - r.left) / r.width);
      const mv = ev => setX((ev.clientX - r.left) / r.width);
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); Nodes.touch(); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    cmp.addEventListener('dblclick', () => Nodes.openViewer([A, Bv], 1));
    box.append(cmp);
    requestAnimationFrame(() => Nodes.drawEdges());
  },

  // ---------- группы и заметки ----------
  groupEl(n) {
    const P = n.params;
    const el = h('div', { class: 'nx-group' + (Nodes.sel.has(n.id) ? ' sel' : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' } });
    el.style.setProperty('--gc', P.color || '#6366f1');
    const title = h('span', { class: 'nx-gtitle', title: 'Двойной щелчок — переименовать' }, P.title || 'Группа');
    title.addEventListener('dblclick', e => { e.stopPropagation(); UI.prompt('Название группы', P.title || 'Группа', v => { P.title = v || 'Группа'; Nodes.paint(n.id); Nodes.commit(); }); });
    const head = h('div', { class: 'nx-ghead' }, title, h('span', { class: 'grow' }),
      h('span', { class: 'nx-colors' }, ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#64748b'].map(c => h('button', { class: 'nx-dot' + (c === P.color ? ' on' : ''), style: { background: c }, title: 'Цвет', onclick: e => { e.stopPropagation(); P.color = c; Nodes.paint(n.id); Nodes.commit(); } }))),
      h('button', { class: 'nx-hb run', title: 'Запустить узлы группы', onclick: e => { e.stopPropagation(); Nodes.runGroup(n); } }, '▶'),
      h('button', { class: 'nx-hb', title: 'Убрать группу (узлы останутся)', onclick: e => { e.stopPropagation(); Nodes.removeIds([n.id]); } }, '×'));
    head.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); e.stopPropagation(); Nodes.startDrag(e, n); });
    const rz = h('div', { class: 'nx-rz2' }); rz.addEventListener('pointerdown', e => Nodes.resizeNode(e, n, el, false));
    el.append(head, h('div', { class: 'nx-gbody' }), rz);
    return el;
  },
  noteEl(n) {
    const P = n.params;
    const el = h('div', { class: 'nx-note' + (Nodes.sel.has(n.id) ? ' sel' : ''), 'data-id': n.id, style: { left: n.x + 'px', top: n.y + 'px', width: n.w + 'px', height: n.h + 'px' } });
    el.style.setProperty('--nc', P.color || '#fde68a');
    const ta = h('textarea', { placeholder: 'Заметка…', value: P.text || '', spellcheck: 'false' });
    ta.addEventListener('input', () => { P.text = ta.value; Nodes.touch(); });
    ta.addEventListener('change', () => Nodes.commit());
    const head = h('div', { class: 'nx-nhead' }, h('span', { class: 'nx-colors' }, ['#fde68a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#ddd6fe', '#e5e7eb'].map(c => h('button', { class: 'nx-dot' + (c === P.color ? ' on' : ''), style: { background: c }, onclick: e => { e.stopPropagation(); P.color = c; Nodes.paint(n.id); Nodes.commit(); } }))),
      h('span', { class: 'grow' }), h('button', { class: 'nx-hb', title: 'Удалить заметку', onclick: e => { e.stopPropagation(); Nodes.removeIds([n.id]); } }, '×'));
    head.addEventListener('pointerdown', e => { if (e.button !== 0 || e.target.closest('button')) return; e.preventDefault(); Nodes.startDrag(e, n); });
    const rz = h('div', { class: 'nx-rz2' }); rz.addEventListener('pointerdown', e => Nodes.resizeNode(e, n, el, false));
    el.append(head, ta, rz);
    el.addEventListener('pointerdown', () => { if (!Nodes.sel.has(n.id)) { Nodes.sel = new Set([n.id]); Nodes.updateSel(); } });
    return el;
  },
  groupSel() {
    const list = Nodes.g.nodes.filter(n => Nodes.sel.has(n.id) && n.type !== 'group');
    let x, y, w, hh;
    if (list.length) { const b = Nodes.bbox(list); x = b.x - 24; y = b.y - 52; w = b.w + 48; hh = b.h + 76; }
    else { const c = Nodes.viewCenter(); x = c.x - 260; y = c.y - 160; w = 520; hh = 320; }
    const gr = { id: Nodes.uid(), type: 'group', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh), params: Nodes.defaults('group') };
    Nodes.g.nodes.unshift(gr);
    Nodes.sel = new Set([gr.id]); Nodes.render(); Nodes.commit();
    return gr;
  },
  // группа подрастает, если её узлы выросли (появились результаты)
  growGroups() {
    for (const gr of Nodes.g.nodes) {
      if (gr.type !== 'group') continue;
      let w = gr.w, hh = gr.h;
      for (const m of Nodes.groupMembers(gr)) { const r = Nodes.rectOf(m); w = Math.max(w, r.x + r.w + 24 - gr.x); hh = Math.max(hh, r.y + r.h + 24 - gr.y); }
      if (w !== gr.w || hh !== gr.h) { gr.w = Math.round(w); gr.h = Math.round(hh); const el = Nodes.elOf(gr.id); if (el) { el.style.width = gr.w + 'px'; el.style.height = gr.h + 'px'; } Nodes.touch(); Nodes.drawMini(); }
    }
  },
  ungroupSel() { const ids = [...Nodes.sel].filter(id => (Nodes.node(id) || {}).type === 'group'); if (ids.length) Nodes.removeIds(ids); },
  align(how) {
    const list = Nodes.g.nodes.filter(n => Nodes.sel.has(n.id) && n.type !== 'group');
    if (list.length < 2) return;
    const rs = list.map(n => [n, Nodes.rectOf(n)]);
    if (how === 'left') { const x = Math.min(...rs.map(([, r]) => r.x)); rs.forEach(([n]) => { n.x = x; }); }
    if (how === 'top') { const y = Math.min(...rs.map(([, r]) => r.y)); rs.forEach(([n]) => { n.y = y; }); }
    if (how === 'hdist' || how === 'vdist') {
      const ax = how === 'hdist' ? 'x' : 'y', sz = how === 'hdist' ? 'w' : 'h';
      rs.sort((a, b) => a[1][ax] - b[1][ax]);
      let p = rs[0][1][ax];
      for (const [n, r] of rs) { n[ax] = Math.round(p); p += r[sz] + 40; }
    }
    Nodes.render(); Nodes.commit();
  },

  // ---------- связи ----------
  portPos(id, port, out) {
    const el = Nodes.world.querySelector(`[data-id="${id}"] .nx-port[data-p="${port}"][data-o="${out ? 1 : 0}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), w = Nodes.world.getBoundingClientRect(), k = Nodes.view.k;
    return { x: (r.left + r.width / 2 - w.left) / k, y: (r.top + r.height / 2 - w.top) / k };
  },
  curve(a, b) { const dx = Math.max(50, Math.abs(b.x - a.x) * 0.45); return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`; },
  drawEdges(temp) {
    const svg = Nodes.svg; if (!svg) return;
    svg.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';
    for (const e of Nodes.g.edges) {
      const a = Nodes.portPos(e.from, e.fport, true), b = Nodes.portPos(e.to, e.tport, false);
      if (!a || !b) continue;
      const kind = Nodes.portKind(e.from, e.fport, true) || 'any';
      const d = Nodes.curve(a, b);
      const st = Nodes.status[e.to] || {}, sf = Nodes.status[e.from] || {};
      const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d);
      p.setAttribute('class', 'nx-e k-' + kind + (st.s === 'run' || sf.s === 'run' ? ' live' : '') + (Nodes.sel.has(e.from) || Nodes.sel.has(e.to) ? ' hl' : ''));
      const hit = document.createElementNS(NS, 'path'); hit.setAttribute('d', d); hit.setAttribute('class', 'nx-ehit');
      hit.innerHTML = '<title>Щелчок — удалить связь</title>';
      hit.addEventListener('pointerdown', ev => ev.stopPropagation());
      hit.addEventListener('click', () => { Nodes.g.edges = Nodes.g.edges.filter(x => x !== e); Nodes.drawEdges(); Nodes.commit(); if (Nodes.node(e.to).type === 'compare') Nodes.paintOut(e.to); });
      svg.append(p, hit);
    }
    if (temp && temp.a && temp.b) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', temp.rev ? Nodes.curve(temp.b, temp.a) : Nodes.curve(temp.a, temp.b)); p.setAttribute('class', 'nx-e temp k-' + (temp.kind || 'any')); svg.append(p); }
  },
  highlightPorts(kind, wantOut) {
    Nodes.world.querySelectorAll('.nx-port').forEach(p => {
      const isOut = p.dataset.o === '1';
      const k = (p.className.match(/k-(\w+)/) || [])[1];
      const ok = isOut === wantOut && (wantOut ? Nodes.compat(k, kind) : Nodes.compat(kind, k));
      p.classList.toggle('can', ok); p.classList.toggle('cant', !ok);
    });
    Nodes.area.classList.toggle('linking', kind !== null);
    if (kind === null) Nodes.world.querySelectorAll('.nx-port').forEach(p => p.classList.remove('can', 'cant'));
  },
  dragFromOutput(e, n, port, startPt) {
    e.stopPropagation(); e.preventDefault();
    const kind = Nodes.portKind(n.id, port, true);
    const a = Nodes.portPos(n.id, port, true);
    Nodes.highlightPorts(kind, false);
    const x0 = e.clientX, y0 = e.clientY;
    const mv = ev => Nodes.drawEdges({ a, b: Nodes.toWorld(ev), kind });
    const up = ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      Nodes.highlightPorts(null);
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const p = t && t.closest('.nx-port[data-o="0"]');
      const card = t && t.closest('.nx-node');
      if (p) { Nodes.connect(n.id, port, p.closest('[data-id]').dataset.id, p.dataset.p); return; }
      if (card && card.dataset.id !== n.id) {
        const tn = Nodes.node(card.dataset.id);
        const inp = Nodes.bestInput(tn, kind);
        if (inp) Nodes.connect(n.id, port, tn.id, inp); else { UI.toast('У этого узла нет подходящего входа'); Nodes.drawEdges(); }
        return;
      }
      Nodes.drawEdges();
      if (!startPt && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (t && Nodes.isEmptyTarget(t)) Nodes.openPalette({ x: ev.clientX, y: ev.clientY, at: Nodes.toWorld(ev), from: { id: n.id, port, kind, dir: 'out' } });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  },
  dragFromInput(e, n, port) {
    e.stopPropagation(); e.preventDefault();
    const es = Nodes.g.edges.filter(x => x.to === n.id && x.tport === port);
    if (es.length) {
      // отцепить связь и тянуть её дальше от источника
      const ed = es[es.length - 1];
      Nodes.g.edges = Nodes.g.edges.filter(x => x !== ed);
      Nodes.drawEdges();
      const src = Nodes.node(ed.from);
      const kind = Nodes.portKind(src.id, ed.fport, true);
      const a = Nodes.portPos(src.id, ed.fport, true);
      Nodes.highlightPorts(kind, false);
      const mv = ev => Nodes.drawEdges({ a, b: Nodes.toWorld(ev), kind });
      const up = ev => {
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
        Nodes.highlightPorts(null);
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const p = t && t.closest('.nx-port[data-o="0"]');
        if (p && Nodes.connect(src.id, ed.fport, p.closest('[data-id]').dataset.id, p.dataset.p, true)) { Nodes.drawEdges(); Nodes.commit(); }
        else { Nodes.drawEdges(); Nodes.commit(); }
        if (Nodes.node(n.id).type === 'compare') Nodes.paintOut(n.id);
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      return;
    }
    const kind = Nodes.portKind(n.id, port, false);
    const b = Nodes.portPos(n.id, port, false);
    Nodes.highlightPorts(kind, true);
    const x0 = e.clientX, y0 = e.clientY;
    const mv = ev => Nodes.drawEdges({ a: b, b: Nodes.toWorld(ev), kind, rev: true });
    const up = ev => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      Nodes.highlightPorts(null);
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const p = t && t.closest('.nx-port[data-o="1"]');
      const card = t && t.closest('.nx-node');
      if (p) { Nodes.connect(p.closest('[data-id]').dataset.id, p.dataset.p, n.id, port); return; }
      if (card && card.dataset.id !== n.id) {
        const sn = Nodes.node(card.dataset.id);
        const o = (Nodes.T(sn).outputs || []).find(x => Nodes.compat(x[1], kind));
        if (o) Nodes.connect(sn.id, o[0], n.id, port); else Nodes.drawEdges();
        return;
      }
      Nodes.drawEdges();
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (t && Nodes.isEmptyTarget(t)) Nodes.openPalette({ x: ev.clientX, y: ev.clientY, at: Nodes.toWorld(ev), from: { id: n.id, port, kind, dir: 'in' } });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  },
  bestInput(tn, kind) {
    const ins = Nodes.T(tn).inputs || [];
    const free = d => d[2] || !Nodes.g.edges.some(e => e.to === tn.id && e.tport === d[0]);
    const c = ins.filter(d => Nodes.compat(kind, d[1]));
    const pick = c.find(d => d[1] === kind && free(d)) || c.find(free) || c.find(d => d[1] === kind) || c[0];
    return pick ? pick[0] : null;
  },

  // ---------- меню добавления с поиском ----------
  palItems() {
    return Nodes.PALETTE.map(([type, params, title, desc]) => {
      const T = Nodes.TYPES[type];
      const ptitle = type === 'editImage' && params && params.preset ? NX_PRESETS[params.preset][0] : null;
      return { type, params: params || {}, title: title || ptitle || T.title, desc: desc || (ptitle ? 'Правка по картинке: ' + NX_PRESETS[params.preset][1].slice(0, 70) + '…' : T.desc || ''), T };
    });
  },
  openPalette({ x, y, at, from }) {
    Nodes.closePalette();
    const q = h('input', { type: 'text', class: 'nx-pal-q', placeholder: from ? 'Что подключить? Поиск…' : 'Найти узел…', spellcheck: 'false' });
    const list = h('div', { class: 'nx-pal-l' });
    const pop = h('div', { class: 'nx-pal' }, from ? h('div', { class: 'nx-pal-h' }, from.dir === 'out' ? `Подключить выход (${NX_KIND[from.kind]}) к новому узлу` : `Новый узел для входа (${NX_KIND[from.kind]})`) : null, q, list);
    document.body.append(pop);
    const W = 340, Hh = 420;
    Object.assign(pop.style, { left: Math.max(6, Math.min(x, window.innerWidth - W - 6)) + 'px', top: Math.max(6, Math.min(y, window.innerHeight - Hh - 6)) + 'px' });
    Nodes.pal = pop;
    let items = Nodes.palItems().filter(it => !it.T.hidden);
    if (from) items = items.filter(it => from.dir === 'out' ? (it.T.inputs || []).some(d => Nodes.compat(from.kind, d[1])) : (it.T.outputs || []).some(d => Nodes.compat(d[1], from.kind)));
    let act = 0, shown = [];
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      shown = items.filter(it => !s || (it.title + ' ' + it.desc + ' ' + it.type).toLowerCase().includes(s));
      list.innerHTML = ''; act = Math.min(act, Math.max(0, shown.length - 1));
      let lastCat = null;
      shown.forEach((it, i) => {
        if (!s && it.T.cat !== lastCat) { lastCat = it.T.cat; list.append(h('div', { class: 'nx-pal-c' }, (NX_CATS.find(c => c[0] === lastCat) || [, ''])[1])); }
        const row = h('div', { class: 'nx-pal-i' + (i === act ? ' on' : '') }, h('span', { class: 'nx-ic' }, it.T.ic), h('div', {}, h('b', {}, it.title), h('span', {}, it.desc)));
        row.style.setProperty('--c', it.T.color);
        row.addEventListener('pointerenter', () => { act = i; list.querySelectorAll('.nx-pal-i').forEach((r, j) => r.classList.toggle('on', j === act)); });
        row.addEventListener('pointerdown', e => { e.preventDefault(); pick(it); });
        list.append(row);
      });
      if (!shown.length) list.append(h('div', { class: 'nx-pal-n' }, 'Ничего не найдено'));
    };
    const pick = it => {
      Nodes.closePalette();
      const p = at || Nodes.viewCenter();
      let nx = p.x, ny = p.y - 24;
      if (from && from.dir === 'in') nx = p.x - (it.T.w || 280) - 10;
      if (!at && !from) { nx = p.x - (it.T.w || 280) / 2; ny = p.y - 80; }
      const n = Nodes.add(it.type, nx, ny, JSON.parse(JSON.stringify(it.params)), { silent: true });
      if (from) {
        if (from.dir === 'out') { const inp = Nodes.bestInput(n, from.kind); if (inp) Nodes.connect(from.id, from.port, n.id, inp, true); }
        else { const o = (Nodes.T(n).outputs || []).find(d => Nodes.compat(d[1], from.kind)); if (o) Nodes.connect(n.id, o[0], from.id, from.port, true); }
      }
      Nodes.sel = new Set([n.id]); Nodes.render(); Nodes.commit();
    };
    q.addEventListener('input', () => { act = 0; draw(); });
    q.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') Nodes.closePalette();
      else if (e.key === 'ArrowDown') { e.preventDefault(); act = Math.min(shown.length - 1, act + 1); draw(); list.querySelector('.on') && list.querySelector('.on').scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); act = Math.max(0, act - 1); draw(); list.querySelector('.on') && list.querySelector('.on').scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[act]) pick(shown[act]); }
    });
    setTimeout(() => { Nodes._palOut = e => { if (Nodes.pal && !Nodes.pal.contains(e.target)) Nodes.closePalette(); }; document.addEventListener('pointerdown', Nodes._palOut, true); }, 0);
    draw(); q.focus();
  },
  closePalette() { if (Nodes.pal) { Nodes.pal.remove(); Nodes.pal = null; } if (Nodes._palOut) { document.removeEventListener('pointerdown', Nodes._palOut, true); Nodes._palOut = null; } },
  contextMenu(e, n) {
    UI.closeMenus();
    const at = Nodes.toWorld(e);
    const multi = Nodes.sel.size > 1;
    let items;
    if (n) {
      items = [
        Nodes.runnable(n) ? { label: multi ? 'Запустить выбранные' : 'Запустить', key: 'Ctrl+Enter', action: () => multi ? Nodes.runSelected() : Nodes.run(n.id) } : null,
        n.type === 'group' ? { label: 'Запустить узлы группы', action: () => Nodes.runGroup(n) } : null,
        Nodes.res[n.id] && Nodes.res[n.id].hist && Nodes.res[n.id].hist.length ? { label: 'История результатов…', action: () => Nodes.historyDialog(n) } : null,
        '-',
        { label: 'Копировать', key: 'Ctrl+C', action: () => Nodes.copy() }, { label: 'Вырезать', key: 'Ctrl+X', action: () => Nodes.copy(true) },
        { label: 'Дублировать', key: 'Ctrl+D', action: () => Nodes.duplicate() },
        n.type !== 'group' && n.type !== 'note' ? { label: 'Переименовать…', action: () => UI.prompt('Название узла', Nodes.title(n), v => { n.title = v || undefined; Nodes.paint(n.id); Nodes.commit(); }) } : null,
        { label: 'В группу', key: 'Ctrl+G', action: () => Nodes.groupSel() },
        multi ? { label: 'Выровнять', sub: [{ label: 'По левому краю', action: () => Nodes.align('left') }, { label: 'По верхнему краю', action: () => Nodes.align('top') }, { label: 'Распределить по горизонтали', action: () => Nodes.align('hdist') }, { label: 'Распределить по вертикали', action: () => Nodes.align('vdist') }] } : null,
        { label: 'Сохранить как шаблон…', action: () => Nodes.saveTemplateDialog(true) },
        '-', { label: 'Удалить', key: 'Del', action: () => Nodes.removeIds([...Nodes.sel]) },
      ];
    } else {
      items = [
        { label: 'Добавить узел…', key: 'Tab', action: () => Nodes.openPalette({ x: e.clientX, y: e.clientY, at }) },
        { label: 'Заметка', key: 'N', action: () => Nodes.add('note', at.x, at.y) },
        { label: 'Группа', action: () => { const gr = Nodes.add('group', at.x, at.y); return gr; } },
        { label: 'Вставить', key: 'Ctrl+V', action: () => Nodes.pasteInternal(at), disabled: () => !Nodes.clip },
        '-', { label: 'Выделить всё', key: 'Ctrl+A', action: () => { Nodes.sel = new Set(Nodes.g.nodes.map(x => x.id)); Nodes.updateSel(); } },
        { label: 'Показать всё', key: 'Shift+1', action: () => Nodes.fit() },
        { label: 'Запустить всё', key: 'Ctrl+Shift+Enter', action: () => Nodes.runAll() },
        '-', { label: 'Шаблоны…', action: () => Nodes.templatesDialog() },
      ];
    }
    const m = UI.showMenuList(items.filter(Boolean), e.clientX, e.clientY);
    m.classList.add('ctx');
  },

  // ---------- мини-карта ----------
  drawMini() {
    const c = Nodes.miniEl; if (!c || !Nodes.mini || !Nodes.area) return;
    if (Nodes._miniRaf) return;
    Nodes._miniRaf = requestAnimationFrame(() => {
      Nodes._miniRaf = 0;
      const g = c.getContext('2d'), W = c.width, H = c.height;
      g.clearRect(0, 0, W, H);
      const ar = Nodes.area.getBoundingClientRect(), V = Nodes.view;
      const vp = { x: -V.x / V.k, y: -V.y / V.k, w: ar.width / V.k, h: ar.height / V.k };
      const b0 = Nodes.bbox() || vp;
      const bx = Math.min(b0.x, vp.x), by = Math.min(b0.y, vp.y), bw = Math.max(b0.x + b0.w, vp.x + vp.w) - bx, bh = Math.max(b0.y + b0.h, vp.y + vp.h) - by;
      const s = Math.min((W - 12) / bw, (H - 12) / bh), ox = (W - bw * s) / 2, oy = (H - bh * s) / 2;
      Nodes._miniMap = { s, ox, oy, bx, by };
      for (const n of Nodes.g.nodes) {
        const r = Nodes.rectOf(n);
        g.fillStyle = n.type === 'group' ? (n.params.color || '#6366f1') + '33' : n.type === 'note' ? (n.params.color || '#fde68a') : Nodes.T(n).color;
        g.globalAlpha = Nodes.sel.has(n.id) ? 1 : 0.75;
        g.fillRect(ox + (r.x - bx) * s, oy + (r.y - by) * s, Math.max(2, r.w * s), Math.max(2, r.h * s));
      }
      g.globalAlpha = 1;
      g.strokeStyle = getComputedStyle(Nodes.area).getPropertyValue('--sel') || '#1f6feb'; g.lineWidth = 1.5;
      g.strokeRect(ox + (vp.x - bx) * s, oy + (vp.y - by) * s, vp.w * s, vp.h * s);
    });
  },

  // ================= шаблоны =================
  TEMPLATES: {
    productInterior: { title: 'Товар → фото в интерьере', desc: 'Фото товара без фона, 4 варианта сцены по описанию, апскейл лучшего и экспорт.', build: B => {
      const img = B.n('image', 0, 40), bg = B.n('removeBg', 330, 40);
      const p = B.n('text', 330, 260, { text: 'on a light oak table in a cozy Scandinavian living room, morning sunlight through the window, plants in the background' });
      const ed = B.n('editImage', 660, 40, { preset: 'interior', count: 4, aspect: '4:5' });
      const up = B.n('upscale', 1010, 40, { mode: 'precise', scale: 2 }), sv = B.n('save', 1340, 60, { name: 'товар-интерьер' });
      B.e(img, 'image', bg, 'image'); B.e(bg, 'image', ed, 'image'); B.e(p, 'text', ed, 'prompt'); B.e(ed, 'image', up, 'image'); B.e(up, 'image', sv, 'in');
      B.note('1. Перетащите фото товара в узел «Картинка».\n2. Опишите сцену.\n3. ▶ Запустить всё. В галерее отметьте ☆ лучший вариант — дальше пойдёт только он.', 0, -250, 420, 130);
      B.group('Товар в интерьере', '#0ea5e9', [img, bg, p, ed, up, sv]);
    } },
    characterAngles: { title: 'Персонаж → 4 ракурса', desc: 'Один референс персонажа — четыре согласованных ракурса для раскадровки или 3D.', build: B => {
      const img = B.n('image', 0, 40);
      const l = B.n('list', 0, 360, { text: 'front view, full body\nleft side profile view, full body\nback view, full body\nthree-quarter view from above' });
      const ed = B.n('editImage', 340, 120, { preset: 'angle', count: 1, aspect: '3:4' });
      const sv = B.n('save', 700, 140, { name: 'ракурс' });
      B.e(img, 'image', ed, 'image'); B.e(l, 'items', ed, 'prompt'); B.e(ed, 'image', sv, 'in');
      B.note('Каждая строка списка — отдельный ракурс. Добавьте строки — получите больше ракурсов.', 0, -210, 360, 100);
      B.group('Персонаж: ракурсы', '#8b5cf6', [img, l, ed, sv]);
    } },
    photoVideo: { title: 'Фото → видео', desc: 'Оживить фото: ассистент улучшает описание движения, модель видео делает ролик.', build: B => {
      const img = B.n('image', 0, 40), t = B.n('text', 0, 330, { text: 'медленный наезд камеры, лёгкий ветер, пар от чашки' });
      const as = B.n('assistant', 330, 300, { mode: 'improve', target: 'video' });
      const v = B.n('genVideo', 690, 80, { duration: 5 }), sv = B.n('save', 1040, 100, { name: 'ролик' });
      B.e(img, 'image', v, 'image'); B.e(t, 'text', as, 'text'); B.e(as, 'text', v, 'prompt'); B.e(v, 'video', sv, 'in');
      B.group('Фото → видео', '#ef4444', [img, t, as, v, sv]);
    } },
    briefBanners: { title: 'Бриф → 6 баннеров', desc: 'Ассистент придумывает 6 разных сцен по брифу, каждая становится картинкой.', build: B => {
      const t = B.n('text', 0, 40, { text: 'Кофейня «Зерно»: осенняя акция — второй латте в подарок. Тёплые цвета, уют, без текста на картинке.' });
      const as = B.n('assistant', 330, 40, { mode: 'list', count: 6, target: 'image' });
      const gi = B.n('genImage', 680, 40, { aspect: '16:9', count: 1 }), sv = B.n('save', 1030, 60, { name: 'баннер' });
      B.e(t, 'text', as, 'text'); B.e(as, 'text', gi, 'prompt'); B.e(gi, 'image', sv, 'in');
      B.note('Список вариантов можно поправить: «✎ Править текст» в узле ассистента. Каждая строка — отдельная генерация.', 0, -210, 420, 100);
      B.group('Бриф → баннеры', '#f59e0b', [t, as, gi, sv]);
    } },
    logoVector: { title: 'Апскейл и векторизация логотипа', desc: 'Растровый логотип → апскейл → без фона → SVG в «Вектор». Шторка «до/после».', build: B => {
      const img = B.n('image', 0, 40), up = B.n('upscale', 320, 40, { mode: 'precise', scale: 4 }), bg = B.n('removeBg', 640, 40);
      const vz = B.n('vectorize', 960, 40, { colors: 6 }), to = B.n('toApp', 1290, 60, { where: 'vektor' });
      const cmp = B.n('compare', 320, 330);
      B.e(img, 'image', up, 'image'); B.e(up, 'image', bg, 'image'); B.e(bg, 'image', vz, 'image'); B.e(vz, 'svg', to, 'in');
      B.e(img, 'image', cmp, 'a'); B.e(up, 'image', cmp, 'b');
      B.group('Логотип в вектор', '#14b8a6', [img, up, bg, vz, to, cmp]);
    } },
    sceneVariants: { title: 'Сцена: 10 вариантов', desc: 'Бриф → 10 промптов → 10 картинок квадратом, лучшие — в «Вектор».', build: B => {
      const t = B.n('text', 0, 40, { text: 'Уютная мастерская керамиста на закате' });
      const as = B.n('assistant', 330, 40, { mode: 'list', count: 10 }), gi = B.n('genImage', 680, 40, { aspect: '1:1' }), to = B.n('toApp', 1030, 60, { where: 'vektor' });
      B.e(t, 'text', as, 'text'); B.e(as, 'text', gi, 'prompt'); B.e(gi, 'image', to, 'in');
    } },
    photoToVideo: { title: 'Товар: новый фон → видео', desc: 'Убрать фон, поставить товар в новую сцену и оживить.', build: B => {
      const img = B.n('image', 0, 0), p1 = B.n('text', 0, 300, { text: 'Product on a marble table in a bright modern kitchen, soft morning light, photorealistic' });
      const bg = B.n('removeBg', 320, 0), gen = B.n('editImage', 640, 60, { preset: 'bg' }), p2 = B.n('text', 640, 400, { text: 'Slow cinematic camera push-in, soft light, steam rising' });
      const vid = B.n('genVideo', 990, 120), sv = B.n('save', 1340, 140, { name: 'ролик' });
      B.e(img, 'image', bg, 'image'); B.e(bg, 'image', gen, 'image'); B.e(p1, 'text', gen, 'prompt'); B.e(gen, 'image', vid, 'image'); B.e(p2, 'text', vid, 'prompt'); B.e(vid, 'video', sv, 'in');
    } },
    batchBg: { title: 'Папка фото → без фона', desc: 'Пакетно: каждая картинка папки без фона в другую папку.', build: B => {
      const f = B.n('folder', 0, 0), bg = B.n('removeBg', 320, 0), s = B.n('save', 640, 0, { name: 'без-фона' });
      B.e(f, 'images', bg, 'image'); B.e(bg, 'image', s, 'in');
    } },
    styleTransfer: { title: 'Перенос стиля', desc: 'Фото + референс стиля → картинка в этом стиле, 2 варианта.', build: B => {
      const a = B.n('image', 0, 0), s = B.n('image', 0, 320), ed = B.n('editImage', 330, 80, { preset: 'style', count: 2 }), cmp = B.n('compare', 690, 80);
      B.e(a, 'image', ed, 'image'); B.e(s, 'image', ed, 'refs'); B.e(a, 'image', cmp, 'a'); B.e(ed, 'image', cmp, 'b');
    } },
    mockupSeries: { title: 'Мокап: папка дизайнов', desc: 'Каждый дизайн из папки — на фото объекта.', build: B => {
      const b = B.n('image', 0, 0), d = B.n('folder', 0, 300), m = B.n('mockup', 330, 80), s = B.n('save', 680, 80, { name: 'мокап' });
      B.e(b, 'image', m, 'base'); B.e(d, 'images', m, 'design'); B.e(m, 'image', s, 'in');
    } },
    figmaAnimate: { title: 'Кадр из «Фигмы» → «Моушн»', desc: 'Выделение из «Фигмы» оживляется видеомоделью и уходит в «Моушн».', build: B => {
      const f = B.n('figma', 0, 0), p = B.n('text', 0, 160, { text: 'Subtle parallax motion, elements gently float, smooth loop' });
      const v = B.n('genVideo', 320, 40), m = B.n('toApp', 680, 60, { where: 'motion' });
      B.e(f, 'image', v, 'image'); B.e(p, 'text', v, 'prompt'); B.e(v, 'video', m, 'in');
    } },
  },
  buildTemplate(t) {
    const g = { nodes: [], edges: [] };
    const B = {
      n: (type, x, y, params) => { const n = { id: Nodes.uid(), type, x, y, params: Object.assign({}, Nodes.defaults(type), params || {}) }; g.nodes.push(n); return n; },
      e: (a, ap, b, bp) => g.edges.push({ from: a.id, fport: ap, to: b.id, tport: bp }),
      note: (text, x, y, w, hh) => g.nodes.push({ id: Nodes.uid(), type: 'note', x, y, w, h: hh, params: { text, color: '#fde68a' } }),
      group: (title, color, list) => {
        const xs = list.map(n => n.x), ys = list.map(n => n.y);
        const x1 = Math.min(...xs) - 30, y1 = Math.min(...ys) - 64;
        const x2 = Math.max(...list.map(n => n.x + (Nodes.TYPES[n.type].w || 280))) + 30, y2 = Math.max(...list.map(n => n.y + Nodes.estH(n))) + 30;
        g.nodes.unshift({ id: Nodes.uid(), type: 'group', x: x1, y: y1, w: x2 - x1, h: y2 - y1, params: { title, color } });
      },
    };
    t.build(B);
    return g;
  },
  estH(n) { if (n.h) return n.h; const T = Nodes.TYPES[n.type] || {}; return 70 + Math.max((T.inputs || []).length, (T.outputs || []).length) * 20 + (T.params || []).filter(p => !p.adv && !(p.show && !p.show(n.params))).reduce((a, p) => a + (p.t === 'textarea' ? 70 : p.t === 'file' ? 170 : 34), 0); },
  insertGraph(g, newProject, name) {
    if (newProject) return Nodes.newProject(name || 'Новый проект').then(() => Nodes.insertGraph(g));
    const c = Nodes.viewCenter();
    const b = { x: Math.min(...g.nodes.map(n => n.x)), y: Math.min(...g.nodes.map(n => n.y)) };
    const w = Math.max(...g.nodes.map(n => n.x + (n.w || (Nodes.TYPES[n.type] || {}).w || 280))) - b.x;
    const hh = Math.max(...g.nodes.map(n => n.y + Nodes.estH(n))) - b.y;
    let at = Nodes.g.nodes.length ? { x: c.x - w / 2, y: c.y - hh / 2 } : { x: 0, y: 0 };
    if (Nodes.g.nodes.length) { const ex = Nodes.bbox(); at = { x: ex.x, y: ex.y + ex.h + 120 }; }
    const ids = Nodes.pasteData({ vknodes: 1, nodes: g.nodes, edges: g.edges }, at);
    setTimeout(() => Nodes.fit(Nodes.g.nodes.filter(n => ids.includes(n.id))), 60);
    return ids;
  },
  previewSVG(g) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'nx-tpv');
    if (!g.nodes.length) return svg;
    const rect = n => ({ x: n.x, y: n.y, w: n.w || (Nodes.TYPES[n.type] || {}).w || 280, h: Math.min(n.h || Nodes.estH(n), 260) });
    const rs = g.nodes.map(rect);
    const x1 = Math.min(...rs.map(r => r.x)) - 20, y1 = Math.min(...rs.map(r => r.y)) - 20, x2 = Math.max(...rs.map(r => r.x + r.w)) + 20, y2 = Math.max(...rs.map(r => r.y + r.h)) + 20;
    svg.setAttribute('viewBox', `${x1} ${y1} ${x2 - x1} ${y2 - y1}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const byId = {}; g.nodes.forEach((n, i) => { byId[n.id] = rs[i]; });
    let html = '';
    g.nodes.forEach((n, i) => { const r = rs[i]; if (n.type === 'group') html += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${n.h}" rx="18" fill="${n.params.color}" fill-opacity=".12" stroke="${n.params.color}" stroke-opacity=".5" stroke-width="4"/>`; });
    for (const e of g.edges) { const a = byId[e.from], b = byId[e.to]; if (!a || !b) continue; html += `<path d="${Nodes.curve({ x: a.x + a.w, y: a.y + 40 }, { x: b.x, y: b.y + 40 })}" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="7"/>`; }
    g.nodes.forEach((n, i) => {
      const r = rs[i]; if (n.type === 'group') return;
      const col = n.type === 'note' ? (n.params.color || '#fde68a') : (Nodes.TYPES[n.type] || {}).color || '#888';
      html += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="16" fill="var(--panel)" stroke="${col}" stroke-width="5"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="34" rx="16" fill="${col}" opacity=".9"/>`;
    });
    svg.innerHTML = html;
    return svg;
  },
  async templatesDialog() {
    const user = (await Nodes.get('nodes:tpl')) || [];
    const wrap = h('div', { class: 'nx-tpl' });
    const card = (title, desc, g, onIns, onNew, onDel) => h('div', { class: 'nx-tcard', onclick: () => { UI.closeDialog(); onIns(); } },
      Nodes.previewSVG(g), h('b', {}, title), h('span', {}, desc || ''),
      h('div', { class: 'nx-tcard-b' },
        h('button', { class: 'pbt', onclick: e => { e.stopPropagation(); UI.closeDialog(); onIns(); } }, 'На холст'),
        h('button', { class: 'pbt', onclick: e => { e.stopPropagation(); UI.closeDialog(); onNew(); } }, 'Новым проектом'),
        onDel ? h('button', { class: 'pbt', title: 'Удалить шаблон', onclick: e => { e.stopPropagation(); onDel(e.currentTarget.closest('.nx-tcard')); } }, '×') : null));
    wrap.append(h('div', { class: 'nx-tsec' }, 'Готовые сценарии'));
    const grid = h('div', { class: 'nx-tgrid' });
    for (const [k, t] of Object.entries(Nodes.TEMPLATES)) {
      const g = Nodes.buildTemplate(t);
      grid.append(card(t.title, t.desc, g, () => Nodes.insertGraph(Nodes.buildTemplate(t)), () => Nodes.insertGraph(Nodes.buildTemplate(t), true, t.title)));
    }
    wrap.append(grid);
    wrap.append(h('div', { class: 'nx-tsec' }, 'Мои шаблоны', h('span', { class: 'grow' }),
      h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); setTimeout(() => Nodes.saveTemplateDialog(Nodes.sel.size > 0), 0); } }, Nodes.sel.size ? '+ Сохранить выделенное как шаблон' : '+ Сохранить схему как шаблон')));
    const ug = h('div', { class: 'nx-tgrid' });
    if (!user.length) ug.append(h('div', { class: 'nx-dim nx-pad' }, 'Здесь появятся ваши шаблоны: соберите схему и нажмите «Сохранить как шаблон».'));
    for (const t of user) ug.append(card(t.name, t.desc, t.graph, () => Nodes.insertGraph(JSON.parse(JSON.stringify(t.graph))), () => Nodes.insertGraph(JSON.parse(JSON.stringify(t.graph)), true, t.name),
      async el => { const list = ((await Nodes.get('nodes:tpl')) || []).filter(x => x.id !== t.id); await Nodes.put('nodes:tpl', list); el.remove(); }));
    wrap.append(ug);
    const box = UI.dialog('Шаблоны', wrap, [{ label: 'Закрыть', primary: true }]);
    box.classList.add('nx-dlg-wide');
  },
  saveTemplateDialog(selOnly) {
    const ids = selOnly && Nodes.sel.size ? [...Nodes.sel] : Nodes.g.nodes.map(n => n.id);
    if (!ids.length) return UI.toast('Схема пуста');
    const name = h('input', { type: 'text', class: 'wide', value: Nodes.proj.name || 'Мой шаблон' });
    const desc = h('input', { type: 'text', class: 'wide', placeholder: 'Короткое описание (необязательно)' });
    UI.dialog('Сохранить как шаблон', h('div', { class: 'form' }, h('label', {}, 'Название', name), h('label', {}, 'Описание', desc),
      h('p', { class: 'muted' }, `Узлов: ${Nodes.expandSel(ids).length}. Результаты генераций в шаблон не входят.`)),
    [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => {
      const d = Nodes.clipData(ids);
      for (const n of d.nodes) { delete n.params._adv; delete n.params._cmp; }
      (async () => { const list = (await Nodes.get('nodes:tpl')) || []; list.push({ id: Nodes.uid('t'), name: name.value.trim() || 'Шаблон', desc: desc.value.trim(), graph: { nodes: d.nodes, edges: d.edges }, at: Date.now() }); await Nodes.put('nodes:tpl', list); UI.toast('Шаблон сохранён'); })();
    } }]);
  },
  // совместимость со старыми вызовами
  template(k) { const t = Nodes.TEMPLATES[k]; if (t) Nodes.insertGraph(Nodes.buildTemplate(t)); },

  // ================= проекты =================
  async projectsDialog() {
    await Nodes.flush();
    const list = (await Nodes.projects()).sort((a, b) => b.at - a.at);
    const box = h('div', { class: 'nx-projs' });
    const top = h('div', { class: 'nx-row' },
      h('button', { class: 'primary', onclick: () => { UI.closeDialog(); Nodes.newProject('Проект ' + (list.length + 1)); } }, '+ Новый проект'),
      h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Nodes.openDialog(); } }, 'Открыть файл .vknodes…'),
      h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Nodes.exportDialog(); } }, 'Экспорт текущего…'));
    box.append(top);
    for (const p of list) {
      const cur = p.id === Nodes.proj.id;
      const row = h('div', { class: 'nx-proj' + (cur ? ' on' : '') },
        h('div', { class: 'nx-proj-m' }, h('b', {}, p.name), h('span', {}, `${new Date(p.at).toLocaleString('ru')} · узлов: ${p.count || 0}`)),
        cur ? h('span', { class: 'nx-dim' }, 'открыт') : h('button', { class: 'pbt', onclick: () => { UI.closeDialog(); Nodes.openProject(p.id); } }, 'Открыть'),
        h('button', { class: 'pbt', onclick: () => UI.prompt('Название проекта', p.name, async v => {
          if (!v) return; if (cur) { Nodes.proj.name = v; await Nodes.flush(); Nodes.updateRunUI(); }
          else { const r = await Nodes.get('nodes:proj:' + p.id); if (r) { r.name = v; await Nodes.put('nodes:proj:' + p.id, r); } const l = await Nodes.projects(); const x = l.find(q => q.id === p.id); if (x) x.name = v; await Nodes.saveProjects(l); }
          setTimeout(() => Nodes.projectsDialog(), 0);
        }) }, 'Переименовать'),
        h('button', { class: 'pbt', onclick: async () => {
          const r = await Nodes.get('nodes:proj:' + p.id); if (!r) return;
          UI.closeDialog(); await Nodes.newProject(p.name + ' (копия)', r.graph);
          Nodes.res = JSON.parse(JSON.stringify(r.res || {})); for (const nid in Nodes.res) { const x = Nodes.res[nid]; if (x.cur) Nodes.loadOut(x.cur).then(() => Nodes.paintOut(nid)); }
          Nodes.render(); Nodes.touch();
        } }, 'Копия'),
        h('button', { class: 'pbt', title: 'Удалить проект', onclick: () => UI.confirm(`Удалить проект «${p.name}» вместе с результатами?`, () => { Nodes.deleteProject(p.id).then(() => setTimeout(() => Nodes.projectsDialog(), 0)); }) }, '×'));
      box.append(row);
    }
    const d = UI.dialog('Проекты «Нод»', box, [{ label: 'Закрыть', primary: true }]);
    d.classList.add('nx-dlg-mid');
  },
  exportDialog() {
    const withRes = h('input', { type: 'checkbox', checked: true });
    UI.dialog('Экспорт проекта .vknodes', h('div', { class: 'form' },
      h('p', {}, 'Файл .vknodes переносит схему на другой компьютер или коллеге. Картинки входов включаются всегда.'),
      h('label', { class: 'row' }, withRes, ' Включить результаты генераций (файл будет больше)')),
    [{ label: 'Отмена' }, { label: 'Сохранить…', primary: true, action: () => { withBusy('Готовлю файл…', () => Nodes.exportFile(withRes.checked)); } }]);
  },
  helpDialog() {
    const rows = [['Двойной щелчок / Tab', 'меню узлов с поиском'], ['Тянуть от выхода ●', 'на вход — связь; на пустое место — новый узел сразу со связью'], ['Тянуть от входа', 'отцепить связь'],
      ['Рамка по пустому месту', 'выделение (Shift — добавить)'], ['Пробел / средняя кнопка / ✋', 'двигать холст'], ['Колесо, щипок', 'масштаб к курсору'],
      ['Shift+1 · F', 'показать всё · выделенное'], ['Ctrl+C / X / V / D', 'копировать, вырезать, вставить, дублировать'], ['Ctrl+Z / Ctrl+Shift+Z', 'отменить / повторить'],
      ['Ctrl+G · Ctrl+Shift+G', 'группа вокруг выделенного · убрать группу'], ['N', 'заметка'], ['Del', 'удалить'], ['Стрелки', 'сдвинуть (Shift — сильнее)'], ['Alt при перетаскивании', 'без привязки'],
      ['Ctrl+Enter', 'перезапустить выделенные'], ['Ctrl+Shift+Enter', 'запустить всё (только изменённое)'], ['Ctrl+V с картинкой', 'новый узел «Картинка» (или замена в выделенном)'],
      ['☆ в галерее', 'только этот вариант идёт дальше'], ['История', 'прошлые результаты узла: щелчок — сделать выходом']];
    UI.dialog('Ноды — управление', h('table', { class: 'nx-help' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, v)))), [{ label: 'Понятно', primary: true }]);
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
