// ИИ-агент (Polza.ai или любой OpenAI-совместимый сервис): получает задачу, материалы
// (папки и файлы с ролями) и работает с документом через инструменты — читает файлы,
// смотрит на картинки и на свой результат, верстает, меняет тексты, цены и фото, экспортирует.
'use strict';

const Agent = {
  settings: { baseUrl: 'https://polza.ai/api/v1', apiKey: '', model: 'anthropic/claude-sonnet-5', temperature: 0.3, maxSteps: 60, maxTokens: 8000 },
  materials: [],   // { id, role, kind: 'folder'|'file', name, folder?, file? }
  chat: [],        // сообщения для показа: { role, text, tools?, image? }
  history: [],     // сообщения для модели (без системного)
  running: false, stopFlag: false,
  startHpos: null,
  ROLES: [['sources', 'Исходники (фото, графика)'], ['brand', 'Дизайн-система / брендбук'], ['example', 'Пример макета'], ['data', 'Прайс / данные / тексты'], ['output', 'Папка для результата'], ['other', 'Прочее']],

  load() {
    try { Object.assign(Agent.settings, JSON.parse(localStorage.getItem('vektor.agent') || '{}')); } catch (e) { }
  },
  saveSettings() { try { localStorage.setItem('vektor.agent', JSON.stringify(Agent.settings)); } catch (e) { } },
  roleName(r) { return (Agent.ROLES.find(x => x[0] === r) || [, r])[1]; },

  // ================= материалы =================
  async addFolder(role = 'sources') {
    const f = await Host.pickFolder(role === 'output' ? 'Папка для готовых файлов' : 'Папка с материалами');
    if (!f) return;
    Agent.materials.push({ id: 'm' + Date.now(), role, kind: 'folder', name: f.name, folder: f });
    UI.toast(`Папка «${f.name}»: файлов ${f.files.length}`);
    Agent.renderMaterials();
  },
  async addFiles(role = 'data') {
    const files = await Host.pickFiles('', true, 'Файлы для агента');
    for (const f of files) Agent.materials.push({ id: 'm' + Date.now() + Math.random(), role, kind: 'file', name: f.name, file: f });
    Agent.renderMaterials();
  },
  // все файлы материалов с путями вида «роль/папка/подпапка/файл»
  allFiles() {
    const out = [];
    for (const m of Agent.materials) {
      if (m.kind === 'folder') for (const f of m.folder.files) out.push({ path: m.name + '/' + f.rel, role: m.role, size: f.size, entry: f });
      else out.push({ path: m.name, role: m.role, size: m.file.size, entry: m.file });
    }
    return out;
  },
  findFile(p) {
    const all = Agent.allFiles();
    const norm = s => String(s).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
    const q = norm(p);
    return all.find(f => norm(f.path) === q) || all.find(f => norm(f.path).endsWith('/' + q)) || all.find(f => norm(f.entry.name) === q.split('/').pop());
  },
  outputFolder() { const m = Agent.materials.find(x => x.role === 'output' && x.kind === 'folder'); return m && m.folder; },

  // ================= запросы к модели =================
  async callModel(messages, tools) {
    const s = Agent.settings;
    if (!s.apiKey) throw new Error('Не задан API-ключ. Откройте настройки агента (⚙) и вставьте ключ Polza.ai.');
    const body = { model: s.model, messages, temperature: +s.temperature, max_tokens: +s.maxTokens };
    if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
    const url = s.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    let res;
    try {
      res = await Host.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.apiKey }, body: JSON.stringify(body) });
    } catch (e) {
      throw new Error('Нет связи с ' + url + (Host.desktop ? '' : ' (в браузере запрос мог быть заблокирован политикой CORS — используйте настольную версию)') + ': ' + e.message);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Ошибка API (${res.status}): ${text.slice(0, 600)}`);
    let js; try { js = JSON.parse(text); } catch (e) { throw new Error('Непонятный ответ API: ' + text.slice(0, 300)); }
    if (js.error) throw new Error('Ошибка API: ' + (js.error.message || JSON.stringify(js.error)).slice(0, 600));
    return js;
  },
  async listModels() {
    try {
      const r = await Host.fetch(Agent.settings.baseUrl.replace(/\/+$/, '') + '/models', { headers: Agent.settings.apiKey ? { Authorization: 'Bearer ' + Agent.settings.apiKey } : {} });
      const js = await r.json();
      return (js.data || js.models || []).map(m => m.id || m.name).filter(Boolean).sort();
    } catch (e) { return []; }
  },

  systemPrompt() {
    const P = App.doc.pages;
    return `Ты — опытный дизайнер-верстальщик и работаешь внутри векторного редактора «Вектор» (аналог CorelDRAW).
Пользователь — маркетинговое агентство. Задачи: сверстать листовку/баннер/пост по образцу или брендбуку, обновить цены по прайсу, сделать серию баннеров по шаблону с заменой текстов, цен и фото, отрисовать графику в векторе в фирменных цветах и т. п.

Как устроен редактор:
- Единицы — миллиметры, начало координат — левый верхний угол страницы, ось Y вниз. Кегль — в пунктах. Цвета — #rrggbb (можно «cmyk(c,m,y,k)» в процентах).
- Документ состоит из страниц (сейчас ${P.length}, текущая ${App.doc.pageIndex + 1}: ${G.round(App.pg().w, 1)}×${G.round(App.pg().h, 1)} мм). Объекты: rect, ellipse, polygon, path, text (фигурный или абзацный с рамкой width), image, group, powerclip (фото внутри рамки), blend.
- Все изменения видны пользователю сразу и отменяются через Ctrl+Z.

Порядок работы:
1. Посмотри материалы (list_materials). Прочитай нужные файлы (read_file): прайсы, тексты, брендбук. Картинки, примеры макетов и брендбуки в CDR/PDF смотри глазами (view_file).
2. Если есть пример макета — открой его (import_design) и меняй в нём тексты, цены и фото, сохраняя стиль. Если нужно несколько баннеров по одному шаблону — дублируй страницу (duplicate_page) на каждый вариант.
3. Соблюдай фирменные цвета, шрифты, отступы и иерархию из брендбука/примера. Шрифты из папки материалов подключай через load_font.
4. Проверяй результат: get_document (структура, размеры, тексты) и view_page (картинка страницы). Тексты не должны вылезать за края и перекрываться — при необходимости уменьши кегль (fit_text) или расширь рамку.
5. Если пользователь просит файлы — экспортируй (export). При наличии папки для результата файлы кладутся туда.
6. В конце коротко по-русски перечисли, что сделано, и что стоит проверить человеку. Не выдумывай цены и факты: бери их из материалов; если данных нет — спроси.
Работай инструментами, не описывай план без действий. Объекты называй осмысленно (параметр name), это помогает при правках.`;
  },

  // ================= инструменты =================
  tools() {
    const T = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
    const num = d => ({ type: 'number', description: d }), str = d => ({ type: 'string', description: d }), bool = d => ({ type: 'boolean', description: d });
    const color = str('Цвет: #rrggbb, cmyk(c,m,y,k) или none');
    const box = { x: num('X левого края, мм'), y: num('Y верхнего края, мм'), w: num('Ширина, мм'), h: num('Высота, мм') };
    const style = { fill: color, stroke: color, stroke_width: num('Толщина абриса, мм'), opacity: num('Непрозрачность 0..1'), rotation: num('Поворот, градусы против часовой'), name: str('Имя объекта') };
    const textP = { text: str('Текст; \\n — новая строка'), font: str('Семейство шрифта'), size: num('Кегль, пт'), color, align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] }, bold: bool('Полужирный'), italic: bool('Курсив'), line_height: num('Межстрочный интервал, доля кегля (1.2)'), letter_spacing: num('Трекинг, % кегля'), width: num('Ширина рамки абзацного текста, мм (если задана — текст переносится)'), height: num('Высота рамки, мм') };
    return [
      T('list_materials', 'Список прикреплённых пользователем материалов: папок и файлов с их ролями и содержимым.', { role: str('Показать только эту роль: sources, brand, example, data, output, other') }),
      T('search_files', 'Поиск файлов в материалах по части имени или расширению.', { query: str('Часть имени, например «латте» или «.jpg»'), role: str('Роль') }, ['query']),
      T('read_file', 'Прочитать файл из материалов как текст: таблицы Excel/CSV (прайсы), Word, PDF, TXT, JSON, SVG; для CDR/VKT/PDF-макетов — структура объектов, тексты, цвета и шрифты.', { path: str('Путь файла как в list_materials'), sheet: str('Лист Excel (необязательно)'), max_rows: num('Сколько строк таблицы вернуть (по умолчанию 300)') }, ['path']),
      T('view_file', 'Посмотреть файл глазами: фото, картинку, страницу PDF или CDR-макета.', { path: str('Путь файла'), page: num('Номер страницы для PDF/CDR (с 1)') }, ['path']),
      T('get_document', 'Структура документа: страницы, объекты с id, типами, координатами (мм), цветами, текстами и шрифтами; палитра и шрифты документа.', { page: str('Номер страницы (с 1), «current» или «all»'), depth: num('Глубина раскрытия групп (по умолчанию 2)') }),
      T('view_page', 'Картинка страницы документа — проверить, как выглядит результат.', { page: num('Номер страницы (с 1), по умолчанию текущая') }),
      T('go_page', 'Сделать страницу текущей.', { page: num('Номер страницы с 1') }, ['page']),
      T('add_page', 'Добавить пустую страницу после текущей (или в конец).', { w: num('Ширина, мм'), h: num('Высота, мм'), name: str('Имя страницы'), color: str('Цвет фона страницы') }),
      T('duplicate_page', 'Копия страницы со всем содержимым (для серии макетов по одному шаблону). Возвращает номер новой страницы.', { page: num('Какую страницу копировать (с 1), по умолчанию текущую'), name: str('Имя новой страницы') }),
      T('delete_page', 'Удалить страницу.', { page: num('Номер страницы с 1') }, ['page']),
      T('set_page', 'Размер, имя и фон страницы.', { w: num('Ширина, мм'), h: num('Высота, мм'), name: str('Имя'), color: str('Цвет фона'), all_pages: bool('Применить ко всем страницам') }),
      T('create_shape', 'Создать фигуру на текущей странице.', Object.assign({ type: { type: 'string', enum: ['rect', 'ellipse', 'polygon', 'star', 'line'] }, corner_radius: num('Скругление прямоугольника, мм'), sides: num('Углов/лучей'), x2: num('Для line: X конца'), y2: num('Для line: Y конца') }, box, style), ['type']),
      T('create_text', 'Создать текст. Если задана width — абзацный текст с переносом в рамке; иначе фигурный (одна строка на каждый \\n). X,Y — левый верхний угол (для center/right у фигурного текста X — точка выравнивания). Возвращает фактические габариты — проверь, что текст помещается.', Object.assign({ x: num('X, мм'), y: num('Y верха, мм') }, textP, { rotation: num('Поворот, градусы'), name: str('Имя') }), ['text', 'x', 'y']),
      T('place_image', 'Поставить фото/картинку из материалов. fit: cover — заполнить рамку x,y,w,h с обрезкой (PowerClip), contain — вписать целиком, stretch — растянуть. frame_id — поместить внутрь существующей фигуры-рамки.', Object.assign({ path: str('Путь файла'), fit: { type: 'string', enum: ['cover', 'contain', 'stretch'] }, frame_id: str('id фигуры-рамки'), name: str('Имя') }, box), ['path']),
      T('replace_image', 'Заменить фото в объекте (картинка или PowerClip) на другое из материалов, сохранив рамку и положение.', { id: str('id объекта'), path: str('Путь нового файла') }, ['id', 'path']),
      T('draw_svg', 'Нарисовать векторную графику: передай SVG-разметку (иконка, логотип, орнамент, фигура). Импортируется редактируемыми кривыми и вписывается в рамку x,y,w,h.', Object.assign({ svg: str('Полная разметка <svg …>…</svg>'), name: str('Имя группы') }, box), ['svg']),
      T('vectorize_image', 'Перерисовать растровую графику (логотип, иконку, рисунок) в векторные кривые с заданной палитрой — например, в фирменных цветах.', Object.assign({ path: str('Файл из материалов'), image_id: str('…или id картинки в документе'), colors: { type: 'array', items: { type: 'string' }, description: 'Палитра, например ["#e30613","#ffffff","#1d1d1b"]; если не задана — подбирается автоматически' }, num_colors: num('Число цветов, если палитра не задана (по умолчанию 6)'), detail: { type: 'string', enum: ['low', 'medium', 'high'] }, name: str('Имя группы') }, box)),
      T('update_object', 'Изменить объект: положение/размер (x,y,w,h в мм — габарит), поворот, цвета, текст, шрифт, кегль, выравнивание, имя, видимость, скругление.', Object.assign({ id: str('id объекта'), visible: bool('Видимость'), corner_radius: num('Скругление, мм') }, box, style, textP), ['id']),
      T('fit_text', 'Подобрать кегль текста, чтобы он поместился в заданную ширину/высоту.', { id: str('id текста'), max_width: num('Макс. ширина, мм'), max_height: num('Макс. высота, мм'), min_size: num('Минимальный кегль, пт'), max_size: num('Максимальный кегль, пт') }, ['id']),
      T('find_objects', 'Найти объекты на текущей странице (или на всех): по тексту, имени, типу или цвету.', { text: str('Часть текста'), name: str('Часть имени'), type: str('Тип'), color: str('Цвет заливки #rrggbb'), all_pages: bool('Искать на всех страницах') }),
      T('delete_objects', 'Удалить объекты.', { ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
      T('duplicate_objects', 'Дублировать объекты со сдвигом.', { ids: { type: 'array', items: { type: 'string' } }, dx: num('Сдвиг X, мм'), dy: num('Сдвиг Y, мм') }, ['ids']),
      T('arrange', 'Порядок, группировка и выравнивание.', { ids: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['front', 'back', 'forward', 'backward', 'group', 'ungroup', 'align_left', 'align_right', 'align_top', 'align_bottom', 'align_hcenter', 'align_vcenter', 'center_page', 'distribute_h', 'distribute_v', 'powerclip'] }, to: { type: 'string', enum: ['page', 'selection', 'last'], description: 'Относительно чего выравнивать' }, container_id: str('Для powerclip: id рамки') }, ['ids', 'action']),
      T('set_effect', 'Эффекты: тень, прозрачность, контур, выдавливание, оболочка (дуга и т. п.), градиент.', { id: str('id объекта'), shadow: bool('Тень вкл/выкл'), envelope: { type: 'string', enum: ['none', 'arcUp', 'arcDown', 'bulge', 'pinch', 'flagUp', 'perspective', 'trapezoid'] }, envelope_strength: num('Сила 0..1'), contour_steps: num('Шагов контура (0 — убрать)'), contour_offset: num('Шаг контура, мм'), contour_color: str('Цвет последнего шага'), extrude_depth: num('Глубина выдавливания, мм (0 — убрать)'), extrude_angle: num('Угол выдавливания'), gradient: { type: 'array', items: { type: 'string' }, description: 'Два цвета линейного градиента' }, gradient_angle: num('Угол градиента') }, ['id']),
      T('import_design', 'Открыть макет из материалов (CDR любой версии, PDF/AI, SVG, VKT). as: new_document — новым документом (по умолчанию), append_pages — добавить страницы в конец, into_page — на текущую страницу.', { path: str('Путь файла'), as: { type: 'string', enum: ['new_document', 'append_pages', 'into_page'] } }, ['path']),
      T('load_font', 'Подключить файл шрифта (.ttf/.otf) из материалов. Возвращает имя семейства.', { path: str('Путь файла') }, ['path']),
      T('generate_image', 'Сгенерировать картинку моделью Polza (платно — только когда пользователь просит или без этого не обойтись) и поставить на страницу.', Object.assign({ prompt: str('Описание, лучше на английском'), refs: { type: 'array', items: { type: 'string' }, description: 'Референсы: пути файлов в материалах или id изображений в документе' }, fit: { type: 'string', enum: ['cover', 'contain', 'stretch'] }, name: str('Имя') }, box), ['prompt']),
      T('make_mockup', 'Мокап: положить дизайн на фото объекта (футболка, кружка, упаковка, вывеска) так, что дизайн принимает форму объекта, со складками и тенями. Результат ставится на страницу.', Object.assign({ base: str('Фото объекта: путь в материалах или id изображения'), design: str('Дизайн: путь в материалах, id объекта/группы или «selection» — выделенное'), mode: { type: 'string', enum: ['shape', 'cylinder', 'flat'], description: 'shape — по силуэту, cylinder — кружка/бутылка, flat — плоскость (вывеска, экран)' }, blend: { type: 'string', enum: ['normal', 'multiply', 'screen'] }, name: str('Имя') }, box), ['base', 'design']),
      T('remove_background', 'Вырезать фон у изображения в документе (Polza).', { id: str('id изображения') }, ['id']),
      T('upscale_image', 'Увеличить разрешение изображения в документе (Polza).', { id: str('id изображения') }, ['id']),
            T('export', 'Сохранить результат: png, jpg, svg, pdf, cdr (через установленный CorelDRAW; version — номер версии: 17 = X7, 20 = 2018, 24 = 2022) или vkt. Если прикреплена папка для результата — файлы сохраняются туда.', { format: { type: 'string', enum: ['png', 'jpg', 'svg', 'pdf', 'cdr', 'vkt'] }, pages: str('«current», «all» или номера через запятую'), dpi: num('Разрешение для PNG/JPG (по умолчанию 300)'), file_name: str('Имя файла без расширения'), version: num('Версия CorelDRAW для cdr') }, ['format']),
    ];
  },

  // ---------- помощники ----------
  r1: v => Math.round(v * 10) / 10,
  boxOf(o) { const b = Model.worldBox(o); return G.boxValid(b) ? { x: Agent.r1(b.x1), y: Agent.r1(b.y1), w: Agent.r1(b.x2 - b.x1), h: Agent.r1(b.y2 - b.y1) } : null; },
  color(c) {
    if (c === undefined || c === null) return undefined;
    const s = String(c).trim();
    if (!s || s === 'none' || s === 'transparent') return null;
    const m = s.match(/cmyk\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*\)/i);
    if (m) return Color.fromCmyk(+m[1], +m[2], +m[3], +m[4]);
    return Color.normalize(s.startsWith('#') || /^[a-z]/i.test(s) ? s : '#' + s) || '#000000';
  },
  summarize(o, depth = 2) {
    const s = { id: o.id, type: o.type };
    if (o.name) s.name = o.name;
    const b = Agent.boxOf(o); if (b) Object.assign(s, b);
    if (o.type === 'text') {
      Object.assign(s, { text: o.text, font: o.font, size: o.size, align: o.align });
      if (o.bold) s.bold = true; if (o.italic) s.italic = true;
      if (o.frame) s.frame_w = Agent.r1(o.frame.w);
    }
    const leaf = !['group', 'powerclip', 'blend'].includes(o.type) ? o : null;
    if (leaf && leaf.fill && leaf.fill.type !== 'none' && leaf.fill.color) s.fill = leaf.fill.type === 'solid' ? leaf.fill.color : `${leaf.fill.type}(${leaf.fill.color},${leaf.fill.color2})`;
    if (leaf && leaf.stroke && leaf.stroke.color && leaf.stroke.width > 0) s.stroke = `${leaf.stroke.color} ${leaf.stroke.width}мм`;
    if (o.type === 'image') s.image = o.name || 'image';
    const rot = o.m ? G.round(-Mx.angle(o.m), 1) : 0; if (rot && o.type !== 'group') s.rotation = rot;
    if (o.opacity !== undefined && o.opacity < 1) s.opacity = o.opacity;
    if (!o.visible) s.hidden = true;
    if (o.type === 'powerclip') { s.frame = Agent.summarize(o.container, 0); s.contents = o.children.map(c => Agent.summarize(c, depth - 1)); }
    else if (o.children) {
      if (depth > 0) s.children = o.children.slice(0, 60).map(c => Agent.summarize(c, depth - 1));
      else s.children_count = o.children.length;
      if (o.children.length > 60 && depth > 0) s.more = o.children.length - 60;
    }
    return s;
  },
  docSummary(pageArg, depth = 2) {
    const d = App.doc;
    const out = { pages: d.pages.map((P, i) => ({ n: i + 1, name: P.name, w: G.round(P.w, 1), h: G.round(P.h, 1), objects: P.layers.reduce((s, l) => s + l.objects.length, 0) })), current: d.pageIndex + 1 };
    const list = pageArg === 'all' ? d.pages.map((_, i) => i) : [pageArg && pageArg !== 'current' ? (+pageArg - 1) : d.pageIndex];
    out.content = list.map(i => {
      const P = d.pages[i]; if (!P) return { page: i + 1, error: 'нет страницы' };
      const objs = [];
      for (const L of P.layers) for (const o of L.objects) objs.push(Agent.summarize(o, depth));
      return { page: i + 1, objects: objs.reverse() }; // сверху — передний план
    });
    // палитра и шрифты документа
    const colors = new Map(), fonts = new Set();
    Model.walkDoc(d, o => {
      if (o.fill && o.fill.type !== 'none' && o.fill.color) colors.set(o.fill.color, (colors.get(o.fill.color) || 0) + 1);
      if (o.stroke && o.stroke.color && o.stroke.width > 0) colors.set(o.stroke.color, (colors.get(o.stroke.color) || 0) + 1);
      if (o.type === 'text') fonts.add(o.font + (o.bold ? ' Bold' : ''));
    });
    out.palette = [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(x => x[0]);
    out.fonts = [...fonts];
    return out;
  },
  obj(id) {
    let o = Model.get(id);
    if (!o) {
      // объект может быть на другой странице
      for (let i = 0; i < App.doc.pages.length && !o; i++) { const f = Model.find(id, App.doc.pages[i]); if (f) { App.goPage(i); o = f.obj; } }
    }
    if (!o) throw new Error('Нет объекта ' + id);
    return o;
  },
  // поставить объект в габарит x,y,w,h (что не задано — оставить)
  setBox(o, a) {
    const b = Model.worldBox(o);
    const bw = b.x2 - b.x1 || 1, bh = b.y2 - b.y1 || 1;
    const nx = a.x ?? b.x1, ny = a.y ?? b.y1;
    let sx = a.w ? a.w / bw : 1, sy = a.h ? a.h / bh : 1;
    if (a.w && !a.h && o.type !== 'text') sy = sx;
    if (a.h && !a.w && o.type !== 'text') sx = sy;
    if (o.type === 'text' && (a.w || a.h)) {
      if (o.frame) { if (a.w) o.frame.w = a.w; if (a.h) o.frame.h = a.h; sx = sy = 1; }
      else sx = sy = 1; // размер фигурного текста задаётся кеглем
    }
    let T = Mx.mul(Mx.translate(nx, ny), Mx.mul(Mx.scale(sx, sy), Mx.translate(-b.x1, -b.y1)));
    Model.applyT(o, T);
  },
  applyStyle(o, a) {
    for (const leaf of Model.leaves(o)) {
      if (a.fill !== undefined) { const c = Agent.color(a.fill); leaf.fill = c ? Object.assign({ color2: '#ffffff', angle: 0 }, leaf.fill, { type: leaf.fill && (leaf.fill.type === 'linear' || leaf.fill.type === 'radial') ? leaf.fill.type : 'solid', color: c }) : { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 }; }
      if (leaf.type === 'text' && a.color !== undefined) { const c = Agent.color(a.color); leaf.fill = { type: c ? 'solid' : 'none', color: c || '#000000', color2: '#ffffff', angle: 0 }; }
      if (a.stroke !== undefined) { const c = Agent.color(a.stroke); leaf.stroke = Object.assign(Model.defaults().stroke, leaf.stroke || {}, { color: c }); if (c && !(leaf.stroke.width > 0)) leaf.stroke.width = 0.3; }
      if (a.stroke_width !== undefined) { leaf.stroke = Object.assign(Model.defaults().stroke, leaf.stroke || {}, { width: +a.stroke_width }); if (+a.stroke_width > 0 && !leaf.stroke.color) leaf.stroke.color = '#000000'; }
      if (a.opacity !== undefined) leaf.opacity = G.clamp(+a.opacity, 0, 1);
    }
    if (a.name !== undefined) o.name = a.name;
    if (a.visible !== undefined) o.visible = !!a.visible;
    if (a.rotation !== undefined) {
      const cur = o.m && o.type !== 'group' ? -Mx.angle(o.m) : 0;
      const b = Model.worldBox(o);
      Model.applyT(o, Mx.rotate(-(+a.rotation - cur), (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2));
    }
  },
  applyText(o, a) {
    if (o.type !== 'text') return;
    if (a.text !== undefined) o.text = String(a.text);
    if (a.font) o.font = a.font;
    if (a.size) o.size = +a.size;
    if (a.align) o.align = a.align;
    if (a.bold !== undefined) o.bold = !!a.bold;
    if (a.italic !== undefined) o.italic = !!a.italic;
    if (a.line_height) o.lh = +a.line_height;
    if (a.letter_spacing !== undefined) o.ls = +a.letter_spacing;
    if (a.width) o.frame = { w: +a.width, h: +(a.height || (o.frame && o.frame.h) || 10) };
  },
  async readEntry(f) { return f.entry.read(); },
  async blobURL(buf, type) {
    return new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(new Blob([buf], { type })); });
  },
  // картинка для модели: уменьшенная JPEG
  async shrinkImage(url, max = 1200) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        res({ url: c.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => res(null);
      img.src = url;
    });
  },
  mime(ext) { return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' }[ext] || 'application/octet-stream'; },
  // страницы макета из файла (CDR, PDF, SVG, VKT)
  async designPages(f) {
    const ext = Host.extOf(f.entry.name), buf = await Agent.readEntry(f);
    if (ext === 'cdr' || ext === 'cdt') return IO.readCDR(buf, f.entry.path);
    if (ext === 'pdf' || ext === 'ai') return (await PDFImport.open(buf)).pages;
    if (ext === 'vkt' || ext === 'json') { const d = App.migrate(JSON.parse(new TextDecoder().decode(buf))); return d.pages.map(P => ({ w: P.w, h: P.h, objects: P.layers.flatMap(l => l.objects) })); }
    if (ext === 'svg') {
      // SVG разбирается в текущий документ, поэтому — во временную страницу
      const saved = App.doc, tmp = Model.newDoc(); App.doc = tmp;
      let size;
      try { size = IO.importSVGText(new TextDecoder().decode(buf), null, true); } finally { App.doc = saved; }
      return [{ w: size ? size.w : 210, h: size ? size.h : 297, objects: tmp.pages[0].layers[0].objects }];
    }
    throw new Error('Это не макет: ' + f.entry.name);
  },
  // картинка страницы макета из файла
  async renderDesign(f, pageNo = 1) {
    const ext = Host.extOf(f.entry.name);
    if (ext === 'pdf' || ext === 'ai') return (await PDFImport.render(await Agent.readEntry(f), pageNo)).url;
    const pages = await Agent.designPages(f);
    const P = pages[Math.min(pages.length, Math.max(1, pageNo)) - 1];
    const page = { w: P.w, h: P.h, color: '#ffffff', layers: [{ id: 'x', visible: true, objects: P.objects }] };
    return { url: await IO.pageImage(page), pages: pages.length };
  },

  // ---------- выполнение инструментов ----------
  async exec(name, a) {
    const commit = (label) => App.commit('Агент: ' + label);
    switch (name) {
      case 'list_materials': {
        const mats = Agent.materials.filter(m => !a.role || m.role === a.role);
        if (!mats.length) return { materials: [], note: 'Пользователь пока ничего не прикрепил. Можно работать с текущим документом или попросить прикрепить материалы.' };
        return {
          materials: mats.map(m => m.kind === 'folder'
            ? { role: m.role, role_name: Agent.roleName(m.role), folder: m.name, files: m.folder.files.slice(0, 400).map(f => `${m.name}/${f.rel} (${Math.round((f.size || 0) / 1024)} КБ)`), more: Math.max(0, m.folder.files.length - 400) }
            : { role: m.role, role_name: Agent.roleName(m.role), file: m.name }),
        };
      }
      case 'search_files': {
        const q = String(a.query || '').toLowerCase();
        return { files: Agent.allFiles().filter(f => (!a.role || f.role === a.role) && f.path.toLowerCase().includes(q)).slice(0, 200).map(f => f.path) };
      }
      case 'read_file': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        return Agent.readFileText(f, a);
      }
      case 'view_file': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        const ext = Host.extOf(f.entry.name);
        if (/^(png|jpe?g|webp|gif|bmp|svg)$/.test(ext)) {
          const im = await Agent.shrinkImage(await Agent.blobURL(await Agent.readEntry(f), Agent.mime(ext)));
          if (!im) throw new Error('Не удалось открыть картинку');
          return { ok: true, width_px: im.w, height_px: im.h, _image: im.url, _caption: f.path };
        }
        const r = await Agent.renderDesign(f, a.page || 1);
        const url = typeof r === 'string' ? r : r.url;
        return { ok: true, _image: (await Agent.shrinkImage(url)).url, _caption: f.path + ' стр. ' + (a.page || 1) };
      }
      case 'get_document': return Agent.docSummary(a.page, a.depth ?? 2);
      case 'view_page': {
        const P = a.page ? App.doc.pages[a.page - 1] : App.pg();
        if (!P) throw new Error('Нет страницы ' + a.page);
        return { ok: true, _image: await IO.pageImage(P), _caption: 'Страница ' + (a.page || App.doc.pageIndex + 1) + ` (${G.round(P.w, 1)}×${G.round(P.h, 1)} мм)` };
      }
      case 'go_page': App.goPage(a.page - 1); return { current: App.doc.pageIndex + 1 };
      case 'add_page': {
        const P = Actions.addPage();
        if (a.w) P.w = +a.w; if (a.h) P.h = +a.h; if (a.name) P.name = a.name; if (a.color) P.color = Agent.color(a.color) || '#ffffff';
        commit('страница'); App.zoomPage();
        return { page: App.doc.pageIndex + 1, w: P.w, h: P.h };
      }
      case 'duplicate_page': {
        const i = a.page ? a.page - 1 : App.doc.pageIndex;
        const P = Actions.addPage(i, App.doc.pages[i]);
        if (a.name) P.name = a.name;
        commit('копия страницы');
        return { page: App.doc.pageIndex + 1, note: 'Объекты копии получили новые id — смотри get_document.' };
      }
      case 'delete_page': {
        if (App.doc.pages.length < 2) throw new Error('Последнюю страницу удалить нельзя');
        App.doc.pages.splice(a.page - 1, 1); App.doc.pageIndex = Math.min(App.doc.pageIndex, App.doc.pages.length - 1); App.sel = [];
        commit('удаление страницы'); return { pages: App.doc.pages.length };
      }
      case 'set_page': {
        for (const P of a.all_pages ? App.doc.pages : [App.pg()]) {
          if (a.w) P.w = +a.w; if (a.h) P.h = +a.h; if (a.color) P.color = Agent.color(a.color) || '#ffffff'; if (a.name && !a.all_pages) P.name = a.name;
        }
        commit('страница'); App.zoomPage();
        return { w: App.pg().w, h: App.pg().h };
      }
      case 'create_shape': {
        const w = +a.w || 50, hh = +a.h || 30;
        let o;
        if (a.type === 'line') o = Model.make('path', { subs: [{ closed: false, nodes: [Path.node(+a.x || 0, +a.y || 0), Path.node(+(a.x2 ?? (+a.x + w)), +(a.y2 ?? a.y))] }] });
        else if (a.type === 'ellipse') o = Model.make('ellipse', { w, h: hh, mode: 'ellipse', a1: 0, a2: 360 });
        else if (a.type === 'polygon' || a.type === 'star') o = Model.make('polygon', { w, h: hh, sides: +a.sides || 5, star: a.type === 'star', inner: 0.45 });
        else o = Model.make('rect', { w, h: hh, r: +a.corner_radius || 0 });
        if (a.type !== 'line') o.m = Mx.translate(+a.x || 0, +a.y || 0);
        o.fill = { type: 'none', color: '#000000', color2: '#ffffff', angle: 0 };
        o.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
        if (a.type === 'line' && a.stroke === undefined) { o.stroke.color = '#000000'; o.stroke.width = 0.5; }
        Agent.applyStyle(o, a);
        Actions.insert([o], false); commit('фигура');
        return { id: o.id, ...Agent.boxOf(o) };
      }
      case 'create_text': {
        const o = Model.make('text', { text: String(a.text), font: a.font || 'Arial', size: +a.size || 24, align: a.align || 'left', bold: !!a.bold, italic: !!a.italic, lh: +a.line_height || 1.2, ls: +a.letter_spacing || 0 });
        if (a.width) o.frame = { w: +a.width, h: +a.height || 10 };
        o.fill = { type: 'solid', color: Agent.color(a.color || '#000000') || '#000000', color2: '#ffffff', angle: 0 };
        o.m = Mx.translate(+a.x, +a.y);
        if (a.name) o.name = a.name;
        if (a.rotation) Agent.applyStyle(o, { rotation: a.rotation });
        Actions.insert([o], false); commit('текст');
        await Fonts.otf(o.font, o.bold, o.italic);
        const box = Agent.boxOf(o), P = App.pg();
        const warn = box.x < -0.5 || box.y < -0.5 || box.x + box.w > P.w + 0.5 || box.y + box.h > P.h + 0.5 ? 'Текст выходит за край страницы' : undefined;
        return { id: o.id, ...box, lines: Text.layout(o).lines.length, warning: warn };
      }
      case 'place_image': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        const ext = Host.extOf(f.entry.name);
        const buf = await Agent.readEntry(f);
        const o = await IO.importRaster(new Blob([buf], { type: Agent.mime(ext) }), a.name || f.entry.name, null, 10);
        if (!o) throw new Error('Не удалось прочитать картинку');
        return Agent.fitImage(o, a);
      }
      case 'replace_image': {
        const o = Agent.obj(a.id);
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        const url = await Agent.blobURL(await Agent.readEntry(f), Agent.mime(Host.extOf(f.entry.name)));
        const dims = await Agent.shrinkImage(url, 64);
        const asp = dims ? dims.w / dims.h : 1;
        let target = o.type === 'image' ? o : o.type === 'powerclip' ? Model.leaves({ type: 'group', children: o.children }).find(x => x.type === 'image') : null;
        if (!target) throw new Error('В объекте нет картинки');
        // новая картинка заполняет ту же область, что и старая (с обрезкой по рамке PowerClip)
        const b = Model.worldBox(target);
        target.href = url; target.name = f.entry.name;
        const W = b.x2 - b.x1, H = b.y2 - b.y1;
        let w = W, hh = W / asp; if (hh < H) { hh = H; w = H * asp; }
        target.m = Mx.translate(b.x1 + (W - w) / 2, b.y1 + (H - hh) / 2); target.w = w; target.h = hh;
        if (o.type === 'image') { // простая картинка — оборачиваем в рамку, чтобы сохранить габарит
          const frame = Model.make('rect', { w: W, h: H, r: 0 }); frame.m = Mx.translate(b.x1, b.y1);
          frame.fill = { type: 'none' }; frame.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
          const fnd = Model.find(o.id);
          const pc = Model.make('powerclip', { container: frame, children: [o], name: o.name });
          fnd.list[fnd.list.indexOf(o)] = pc;
          commit('замена фото'); return { id: pc.id, ...Agent.boxOf(pc) };
        }
        commit('замена фото'); return { id: o.id, ...Agent.boxOf(o) };
      }
      case 'draw_svg': {
        const before = App.sel.slice();
        const size = IO.importSVGText(String(a.svg), null);
        if (!size) throw new Error('SVG не разобран — проверь разметку');
        const o = Model.get(App.sel[0]);
        if (!o || App.sel.join() === before.join()) throw new Error('В SVG нет объектов');
        if (a.name) o.name = a.name;
        if (a.x !== undefined || a.w) Agent.setBox(o, a);
        commit('графика');
        return { id: o.id, ...Agent.boxOf(o) };
      }
      case 'vectorize_image': return Agent.vectorize(a);
      case 'update_object': {
        const o = Agent.obj(a.id);
        Agent.applyText(o, a);
        if (o.type === 'rect' && a.corner_radius !== undefined) o.r = +a.corner_radius;
        Agent.applyStyle(o, a);
        if (['x', 'y', 'w', 'h'].some(k => a[k] !== undefined)) Agent.setBox(o, a);
        commit('правка');
        return { id: o.id, ...Agent.boxOf(o), ...(o.type === 'text' ? { lines: Text.layout(o).lines.length } : {}) };
      }
      case 'fit_text': {
        const o = Agent.obj(a.id); if (o.type !== 'text') throw new Error('Это не текст');
        const minS = +a.min_size || 6, maxS = +a.max_size || o.size;
        const fits = () => { const b = Model.worldBox(o); return (!a.max_width || b.x2 - b.x1 <= a.max_width + 0.01) && (!a.max_height || b.y2 - b.y1 <= a.max_height + 0.01); };
        o.size = maxS;
        let lo = minS, hi = maxS;
        if (!fits()) { for (let i = 0; i < 18; i++) { o.size = (lo + hi) / 2; if (fits()) lo = o.size; else hi = o.size; } o.size = G.round(lo, 1); }
        commit('кегль');
        return { id: o.id, size: o.size, ...Agent.boxOf(o) };
      }
      case 'find_objects': {
        const res = [];
        const pages = a.all_pages ? App.doc.pages.map((P, i) => [P, i]) : [[App.pg(), App.doc.pageIndex]];
        for (const [P, i] of pages) Model.walkDoc(P, o => {
          if (a.type && o.type !== a.type) return;
          if (a.text && !(o.type === 'text' && o.text.toLowerCase().includes(String(a.text).toLowerCase()))) return;
          if (a.name && !(o.name || '').toLowerCase().includes(String(a.name).toLowerCase())) return;
          if (a.color && !(o.fill && o.fill.color && o.fill.color.toLowerCase() === String(Agent.color(a.color)).toLowerCase())) return;
          if (!a.type && !a.text && !a.name && !a.color) return;
          const s = { page: i + 1, id: o.id, type: o.type, name: o.name || undefined };
          if (o.type === 'text') s.text = o.text;
          if (i === App.doc.pageIndex) Object.assign(s, Agent.boxOf(o));
          res.push(s);
        });
        return { found: res.slice(0, 200), total: res.length };
      }
      case 'delete_objects': Actions.removeIds(a.ids || []); App.sel = []; commit('удаление'); return { deleted: (a.ids || []).length };
      case 'duplicate_objects': {
        const ids = [];
        for (const id of a.ids || []) {
          const f = Model.find(id); if (!f) continue;
          const c = Model.clone(f.obj); Model.applyT(c, Mx.translate(+a.dx || 0, +a.dy || 0));
          f.list.splice(f.list.indexOf(f.obj) + 1, 0, c); ids.push(c.id);
        }
        commit('дубликаты'); return { ids, boxes: ids.map(id => Agent.boxOf(Model.get(id))) };
      }
      case 'arrange': {
        App.sel = (a.ids || []).filter(id => Model.find(id));
        if (!App.sel.length) throw new Error('Нет таких объектов');
        const act = a.action;
        if (['front', 'back'].includes(act)) Actions.order(act);
        else if (act === 'forward') Actions.order('up');
        else if (act === 'backward') Actions.order('down');
        else if (act === 'group') Actions.group();
        else if (act === 'ungroup') Actions.ungroup();
        else if (act.startsWith('align_')) Actions.align(act.slice(6), a.to === 'selection' ? 'sel' : a.to || 'page');
        else if (act === 'center_page') Actions.centerPage();
        else if (act === 'distribute_h') Actions.distribute('hspace');
        else if (act === 'distribute_v') Actions.distribute('vspace');
        else if (act === 'powerclip') { const ids = App.sel.slice(); Tools.pick.pickContainer = ids; Actions.powerclipFinish(a.container_id); }
        return { selection: App.sel.slice(), boxes: App.sel.map(id => Agent.boxOf(Model.get(id))) };
      }
      case 'set_effect': {
        const o = Agent.obj(a.id);
        App.sel = [o.id];
        for (const leaf of Model.leaves(o)) {
          if (a.shadow !== undefined) leaf.shadow = a.shadow ? { dx: 1.5, dy: 1.5, blur: 1.2, color: '#000000', opacity: 0.4 } : null;
          if (a.contour_steps !== undefined) { if (+a.contour_steps > 0) leaf.contour = { steps: +a.contour_steps, offset: +a.contour_offset || 1.5, dir: 'outside', fill: Agent.color(a.contour_color || '#ffffff'), stroke: null, join: 'round' }; else delete leaf.contour; }
          if (a.extrude_depth !== undefined) { if (+a.extrude_depth > 0) leaf.extrude = { depth: +a.extrude_depth, angle: a.extrude_angle ?? -45, persp: 0, color: null, shade: true }; else delete leaf.extrude; }
          if (a.gradient && a.gradient.length >= 2) leaf.fill = { type: 'linear', color: Agent.color(a.gradient[0]), color2: Agent.color(a.gradient[1]), angle: +a.gradient_angle || 0 };
        }
        if (a.envelope) { if (a.envelope === 'none') Actions.envelope('none'); else Actions.envelope(a.envelope, a.envelope_strength ?? 0.25); }
        commit('эффект');
        return { id: o.id, ...Agent.boxOf(o) };
      }
      case 'import_design': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        const pages = await Agent.designPages(f);
        const how = a.as || 'new_document';
        if (how === 'new_document') IO.docFromPages(pages, f.entry.name);
        else if (how === 'append_pages') {
          const start = App.doc.pages.length;
          for (const pg of pages) { const P = Model.newPage(pg.w, pg.h, App.doc.pages.length + 1); P.layers[0].objects = pg.objects; App.doc.pages.push(P); }
          App.doc.pageIndex = start; commit('макет');
        } else { IO.placePages(pages, f.entry.name); }
        return Object.assign({ opened: f.path, pages: pages.length }, Agent.docSummary('current', 1));
      }
      case 'load_font': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path);
        const fam = await Fonts.addFontFile(f.entry.name, await Agent.readEntry(f));
        if (!fam) throw new Error('Не удалось прочитать шрифт');
        return { family: fam };
      }
      case 'export': return Agent.export(a);
      case 'generate_image': {
        const refs = [];
        for (const r of a.refs || []) {
          const o = Model.get(r);
          if (o && o.type === 'image') { refs.push(o.href); continue; }
          const f = Agent.findFile(r); if (f) refs.push(await Host.blobOf(f.entry));
        }
        const blob = await Polza.generateImage(a.prompt, { images: refs });
        const o = await IO.importRaster(blob, a.name || 'Генерация');
        if (o && (a.x !== undefined || a.w)) Agent.setBox(o, a);
        commit('генерация');
        return { id: o && o.id, ...(o ? Agent.boxOf(o) : {}), _image: await Polza.thumb(blob, 768), _caption: 'сгенерированная картинка' };
      }
      case 'make_mockup': {
        const src = async (ref) => {
          if (ref === 'selection') return Mockup.vektorSelectionBlob();
          const o = Model.get(ref);
          if (o && o.type === 'image') return (await fetch(o.href)).blob();
          if (o) { const keep = App.sel; App.sel = [o.id]; try { return await Mockup.vektorSelectionBlob(); } finally { App.sel = keep; } }
          const f = Agent.findFile(ref); if (!f) throw new Error('Не найдено: ' + ref);
          return Host.blobOf(f.entry);
        };
        const blob = await makeMockup({ base: await src(a.base), design: await src(a.design), mode: a.mode || 'shape', blend: a.blend || 'normal' });
        const o = await IO.importRaster(blob, a.name || 'Мокап');
        if (o && (a.x !== undefined || a.w)) Agent.setBox(o, a);
        commit('мокап');
        return { id: o && o.id, ...(o ? Agent.boxOf(o) : {}), _image: await Polza.thumb(blob, 900), _caption: 'мокап' };
      }
      case 'remove_background': case 'upscale_image': {
        const o = Agent.obj(a.id); if (o.type !== 'image') throw new Error('Это не изображение');
        const blob = name === 'remove_background' ? await Polza.removeBackground(o.href) : await Polza.upscale(o.href);
        o.href = await Polza.dataURL(blob);
        commit(name === 'remove_background' ? 'без фона' : 'апскейл');
        return { id: o.id, ok: true };
      }
      default: throw new Error('Неизвестный инструмент ' + name);
    }
  },

  fitImage(o, a) {
    const fit = a.fit || 'cover';
    const asp = o.w / o.h;
    if (a.frame_id) {
      const fr = Agent.obj(a.frame_id), b = Model.worldBox(fr), W = b.x2 - b.x1, H = b.y2 - b.y1;
      let w = W, hh = W / asp; if (hh < H) { hh = H; w = H * asp; }
      o.m = Mx.translate(b.x1 + (W - w) / 2, b.y1 + (H - hh) / 2); o.w = w; o.h = hh;
      App.sel = [o.id]; Tools.pick.pickContainer = [o.id]; Actions.powerclipFinish(fr.id);
      return { id: App.sel[0], ...Agent.boxOf(Model.get(App.sel[0])) };
    }
    const X = a.x ?? (App.pg().w - o.w) / 2, Y = a.y ?? (App.pg().h - o.h) / 2;
    const W = a.w || (a.h ? a.h * asp : o.w), H = a.h || (a.w ? a.w / asp : o.h);
    if (fit === 'stretch') { o.w = W; o.h = H; o.m = Mx.translate(X, Y); }
    else if (fit === 'contain') { let w = W, hh = W / asp; if (hh > H) { hh = H; w = H * asp; } o.w = w; o.h = hh; o.m = Mx.translate(X + (W - w) / 2, Y + (H - hh) / 2); }
    else {
      let w = W, hh = W / asp; if (hh < H) { hh = H; w = H * asp; }
      o.w = w; o.h = hh; o.m = Mx.translate(X + (W - w) / 2, Y + (H - hh) / 2);
      if (Math.abs(w - W) > 0.1 || Math.abs(hh - H) > 0.1) {
        // обрезка по рамке — как PowerClip в Corel
        const frame = Model.make('rect', { w: W, h: H, r: 0 }); frame.m = Mx.translate(X, Y);
        frame.fill = { type: 'none' }; frame.stroke = Object.assign(Model.defaults().stroke, { color: null, width: 0 });
        const f = Model.find(o.id);
        const pc = Model.make('powerclip', { container: frame, children: [o], name: a.name || o.name });
        f.list[f.list.indexOf(o)] = pc;
        App.commit('Агент: фото');
        return { id: pc.id, ...Agent.boxOf(pc) };
      }
    }
    if (a.name) o.name = a.name;
    App.commit('Агент: фото');
    return { id: o.id, ...Agent.boxOf(o) };
  },

  async readFileText(f, a) {
    const ext = Host.extOf(f.entry.name);
    const buf = await Agent.readEntry(f);
    const LIM = 60000;
    const cut = s => s.length > LIM ? s.slice(0, LIM) + `\n…[обрезано, всего ${s.length} символов]` : s;
    if (['txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm', 'xml'].includes(ext)) {
      let t = new TextDecoder('utf-8').decode(buf);
      if (t.includes('�')) t = new TextDecoder('windows-1251').decode(buf);
      return { text: cut(t) };
    }
    if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
      const XLSX = await Host.lib('xlsx');
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const maxRows = +a.max_rows || 300;
      const sheets = (a.sheet ? [a.sheet] : wb.SheetNames).filter(n => wb.Sheets[n]);
      const out = { sheets: wb.SheetNames, tables: {} };
      for (const n of sheets.slice(0, 6)) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).filter(r => r.some(c => String(c).trim()));
        out.tables[n] = rows.slice(0, maxRows).map(r => r.map(c => String(c).replace(/\s+/g, ' ').trim()).join(' | ')).join('\n');
        if (rows.length > maxRows) out.tables[n] += `\n…ещё ${rows.length - maxRows} строк (max_rows)`;
      }
      return out;
    }
    if (ext === 'docx') {
      const mammoth = await Host.lib('mammoth');
      const r = await mammoth.extractRawText({ arrayBuffer: buf });
      return { text: cut(r.value) };
    }
    if (ext === 'pdf' || ext === 'ai') { const r = await PDFImport.text(buf); return { pages: r.numPages, text: cut(r.text) }; }
    if (ext === 'svg') {
      const t = new TextDecoder().decode(buf);
      const colors = [...new Set((t.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).map(c => c.toLowerCase()))].slice(0, 30);
      return { colors, svg: cut(t) };
    }
    if (['cdr', 'cdt', 'vkt'].includes(ext)) {
      const pages = await Agent.designPages(f);
      const tmp = { pages: pages.map((P, i) => ({ name: 'Страница ' + (i + 1), w: P.w, h: P.h, layers: [{ objects: P.objects }] })), pageIndex: 0 };
      const saved = App.doc; App.doc = tmp;
      try { return Object.assign({ note: 'Структура макета (чтобы открыть его для правки — import_design)' }, Agent.docSummary('all', 2)); }
      finally { App.doc = saved; }
    }
    if (/^(png|jpe?g|webp|gif|bmp)$/.test(ext)) return { note: 'Это изображение — посмотри его через view_file или поставь через place_image', size_kb: Math.round(buf.byteLength / 1024) };
    if (/^(ttf|otf|woff2?)$/.test(ext)) return { note: 'Файл шрифта — подключи через load_font' };
    return { note: 'Неизвестный формат, первые байты', text: new TextDecoder('utf-8').decode(buf.slice(0, 2000)) };
  },

  async vectorize(a) {
    const tracer = await Host.lib('tracer');
    let url;
    if (a.image_id) { const o = Agent.obj(a.image_id); if (o.type !== 'image') throw new Error('Это не картинка'); url = o.href; }
    else { const f = Agent.findFile(a.path); if (!f) throw new Error('Файл не найден: ' + a.path); url = await Agent.blobURL(await Agent.readEntry(f), Agent.mime(Host.extOf(f.entry.name))); }
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось открыть картинку')); i.src = url; });
    const max = a.detail === 'high' ? 1200 : a.detail === 'low' ? 400 : 800;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
    const imgd = ctx.getImageData(0, 0, c.width, c.height);
    const opts = { ltres: 1, qtres: 1, pathomit: a.detail === 'high' ? 4 : a.detail === 'low' ? 16 : 8, rightangleenhance: true, roundcoords: 2, viewbox: true, desc: false, strokewidth: 0, linefilter: true, blurradius: a.detail === 'low' ? 2 : 0 };
    if (a.colors && a.colors.length) {
      opts.pal = a.colors.map(Agent.color).filter(Boolean).map(hx => { const r = Color.hexToRgb(hx); return { r: r.r, g: r.g, b: r.b, a: 255 }; });
      opts.colorsampling = 0; opts.colorquantcycles = 1;
    } else { opts.numberofcolors = +a.num_colors || 6; opts.colorsampling = 2; opts.colorquantcycles = 3; }
    let svg = tracer.imagedataToSVG(imgd, opts);
    // прозрачные области ImageTracer рисует с opacity 0 — убираем их
    svg = svg.replace(/<path[^>]*opacity="0"[^>]*\/>/g, '');
    const before = App.sel.slice();
    IO.importSVGText(svg, null);
    const o = Model.get(App.sel[0]);
    if (!o || App.sel.join() === before.join()) throw new Error('Векторизация не дала контуров');
    o.name = a.name || 'Векторизованная графика';
    // убрать белый фон, если палитра не просила белый явно
    if (o.children && !(a.colors || []).some(c => /^#?f{3}(f{3})?$/i.test(String(c).replace('#', '')))) {
      o.children = o.children.filter(ch => !(ch.fill && ch.fill.type === 'solid' && /^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/i.test(ch.fill.color) && Model.worldBox(ch).x2 - Model.worldBox(ch).x1 > 0.9 * (Model.worldBox(o).x2 - Model.worldBox(o).x1)));
    }
    const b = Model.worldBox(o), W = b.x2 - b.x1, H = b.y2 - b.y1;
    if (a.w || a.h || a.x !== undefined) Agent.setBox(o, { x: a.x, y: a.y, w: a.w || (a.h ? a.h * W / H : undefined), h: a.h || (a.w ? a.w * H / W : undefined) });
    App.commit('Агент: векторизация');
    return { id: o.id, ...Agent.boxOf(o), paths: o.children ? o.children.length : 1 };
  },

  async export(a) {
    const fmt = a.format, base = a.file_name || IO.baseName();
    let idx;
    if (!a.pages || a.pages === 'current') idx = [App.doc.pageIndex];
    else if (a.pages === 'all') idx = App.doc.pages.map((_, i) => i);
    else idx = String(a.pages).split(/[,\s]+/).map(n => +n - 1).filter(i => App.doc.pages[i]);
    const out = Agent.outputFolder();
    const saved = [];
    const put = async (name, data) => {
      if (out) saved.push(await Host.writeToFolder(out, name, data));
      else { const r = await Host.saveFile(name, data instanceof Uint8Array ? new Blob([data]) : data); if (r) saved.push(r); }
    };
    if (fmt === 'vkt') { await put(base + '.vkt', IO.json()); return { saved }; }
    if (fmt === 'pdf') {
      if (Host.desktop && vkHost.printPDF) {
        const html = IO.printHTML(idx.map(i => App.doc.pages[i]));
        const target = out ? null : await vkHost.saveDialog({ defaultPath: base + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        const sep = vkHost.platform === 'win32' ? '\\' : '/';
        const p = out && out.root ? out.root + sep + base + '.pdf' : target;
        if (!p) return { saved: [] };
        const r = await vkHost.printPDF(html, p);
        if (!r.ok) throw new Error(r.error);
        return { saved: [p] };
      }
      IO.print(); return { note: 'Открыто окно печати — пользователь сохранит PDF сам' };
    }
    if (fmt === 'cdr') {
      if (!Host.desktop) throw new Error('CDR сохраняется только в настольной версии с установленным CorelDRAW. Предложи PDF или SVG.');
      const probe = await vkHost.corelProbe();
      if (!probe.ok) throw new Error('CorelDRAW недоступен: ' + probe.error);
      const sep = vkHost.platform === 'win32' ? '\\' : '/';
      const p = out && out.root ? out.root + sep + base + '.cdr' : await vkHost.saveDialog({ defaultPath: base + '.cdr', filters: [{ name: 'CorelDRAW', extensions: ['cdr'] }] });
      if (!p) return { saved: [] };
      const pages = idx.map(i => App.doc.pages[i]).map(P => ({ w: P.w, h: P.h, svg: Render.exportSVG(P, { background: false }).replace('<defs>', `<rect id="vk-page-frame" width="${P.w}" height="${P.h}" fill="none" stroke="none"/>\n<defs>`) }));
      const r = await vkHost.corelBuild(pages, p, +a.version || 17);
      if (!r.ok) throw new Error('CorelDRAW: ' + r.error);
      return { saved: [p] };
    }
    for (const i of idx) {
      const P = App.doc.pages[i];
      const suffix = idx.length > 1 ? '-' + String(i + 1).padStart(2, '0') + (P.name && !/^Страница \d+$/.test(P.name) ? '-' + P.name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) : '') : '';
      const r = IO.svgFor('page', fmt === 'png' && a.transparent, P);
      if (fmt === 'svg') await put(base + suffix + '.svg', new TextEncoder().encode(r.svg));
      else { const { blob } = await IO.rasterize(r.svg, r.w, r.h, +a.dpi || 300, fmt, fmt === 'jpg' ? (P.color || '#ffffff') : null); await put(base + suffix + '.' + fmt, new Uint8Array(await blob.arrayBuffer())); }
    }
    return { saved, folder: out ? out.name : undefined };
  },

  // ================= диалог с моделью =================
  async send(text) {
    if (Agent.running) return;
    text = String(text || '').trim();
    if (!text) return;
    if (Tools.text.editing) Tools.text.commit();
    Agent.running = true; Agent.stopFlag = false;
    Agent.startHpos = App.hpos;
    Agent.chat.push({ role: 'user', text });
    const mats = Agent.materials.length ? '\n\n[Прикреплено: ' + Agent.materials.map(m => `${Agent.roleName(m.role)} — ${m.kind === 'folder' ? 'папка «' + m.name + '» (' + m.folder.files.length + ' файлов)' : 'файл «' + m.name + '»'}`).join('; ') + ']' : '';
    Agent.history.push({ role: 'user', content: text + mats });
    Agent.renderChat();
    const tools = Agent.tools();
    let usage = { p: 0, c: 0 };
    try {
      for (let step = 0; step < +Agent.settings.maxSteps; step++) {
        if (Agent.stopFlag) { Agent.chat.push({ role: 'note', text: 'Остановлено.' }); break; }
        Agent.setStatus('Думаю…');
        const js = await Agent.callModel([{ role: 'system', content: Agent.systemPrompt() }, ...Agent.trimHistory()], tools);
        if (js.usage) { usage.p += js.usage.prompt_tokens || 0; usage.c += js.usage.completion_tokens || 0; }
        const msg = js.choices && js.choices[0] && js.choices[0].message;
        if (!msg) throw new Error('Пустой ответ модели');
        const calls = msg.tool_calls || [];
        Agent.history.push({ role: 'assistant', content: msg.content || '', ...(calls.length ? { tool_calls: calls } : {}) });
        if (msg.content && msg.content.trim()) Agent.chat.push({ role: 'assistant', text: msg.content.trim() });
        if (!calls.length) break;
        const images = [];
        for (const call of calls) {
          if (Agent.stopFlag) break;
          let args = {};
          try { args = JSON.parse(call.function.arguments || '{}'); } catch (e) { }
          const label = Agent.toolLabel(call.function.name, args);
          const entry = { role: 'tool', text: label, status: 'run' };
          Agent.chat.push(entry); Agent.renderChat(); Agent.setStatus(label);
          let result;
          try {
            result = await Agent.exec(call.function.name, args);
            entry.status = 'ok';
          } catch (e) {
            console.warn(e);
            result = { error: String(e.message || e) };
            entry.status = 'err'; entry.text += ' — ' + result.error;
          }
          if (result && result._image) {
            images.push({ url: result._image, caption: result._caption });
            entry.image = result._image;
            result = Object.assign({}, result, { _image: undefined, image: 'изображение приложено следующим сообщением' });
          }
          Agent.history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 80000) });
          Agent.renderChat();
        }
        if (images.length) {
          Agent.history.push({ role: 'user', content: [{ type: 'text', text: 'Изображения от инструментов: ' + images.map(i => i.caption).join('; ') }, ...images.map(i => ({ type: 'image_url', image_url: { url: i.url } }))] });
        }
      }
    } catch (e) {
      console.error(e);
      Agent.chat.push({ role: 'error', text: e.message || String(e) });
    } finally {
      Agent.running = false;
      if (usage.p || usage.c) Agent.chat.push({ role: 'note', text: `Токены: запрос ${usage.p.toLocaleString('ru')}, ответ ${usage.c.toLocaleString('ru')}` });
      Agent.setStatus('');
      Agent.renderChat();
      UI.refresh();
    }
  },
  // старые картинки из истории убираем — они дорогие, а модель их уже видела
  trimHistory() {
    const h = Agent.history;
    let imgCount = 0;
    const out = [];
    for (let i = h.length - 1; i >= 0; i--) {
      const m = h[i];
      if (Array.isArray(m.content)) {
        imgCount++;
        if (imgCount > 3) { out.unshift({ role: 'user', content: m.content.filter(p => p.type === 'text').map(p => p.text).join(' ') + ' [картинка скрыта для экономии]' }); continue; }
      }
      out.unshift(m);
    }
    return out;
  },
  undoAll() {
    if (Agent.startHpos === null || Agent.startHpos < 0) return;
    App.hpos = Agent.startHpos; App.restore();
    UI.toast('Изменения агента отменены');
  },
  newChat() { Agent.chat = []; Agent.history = []; Agent.renderChat(); },
  toolLabel(name, a) {
    const L = {
      list_materials: 'Смотрю материалы', search_files: 'Ищу файлы: ' + (a.query || ''), read_file: 'Читаю ' + (a.path || ''), view_file: 'Смотрю ' + (a.path || ''),
      get_document: 'Изучаю документ', view_page: 'Смотрю страницу ' + (a.page || ''), go_page: 'Страница ' + a.page, add_page: 'Новая страница', duplicate_page: 'Копирую страницу',
      delete_page: 'Удаляю страницу', set_page: 'Настраиваю страницу', create_shape: 'Рисую ' + ({ rect: 'прямоугольник', ellipse: 'эллипс', polygon: 'многоугольник', star: 'звезду', line: 'линию' }[a.type] || 'фигуру'),
      create_text: 'Пишу текст «' + String(a.text || '').slice(0, 40) + '»', place_image: 'Ставлю фото ' + (a.path || ''), replace_image: 'Меняю фото на ' + (a.path || ''), draw_svg: 'Рисую графику' + (a.name ? ' «' + a.name + '»' : ''),
      vectorize_image: 'Векторизую ' + (a.path || a.image_id || ''), update_object: 'Правлю ' + (a.text !== undefined ? '«' + String(a.text).slice(0, 40) + '»' : a.id), fit_text: 'Подбираю кегль', find_objects: 'Ищу объекты',
      delete_objects: 'Удаляю объекты', duplicate_objects: 'Дублирую', arrange: 'Упорядочиваю: ' + a.action, set_effect: 'Эффект', import_design: 'Открываю макет ' + (a.path || ''), load_font: 'Подключаю шрифт ' + (a.path || ''),
      export: 'Сохраняю ' + String(a.format || '').toUpperCase(),
      generate_image: 'Генерирую картинку (Polza)', make_mockup: 'Делаю мокап', remove_background: 'Вырезаю фон', upscale_image: 'Увеличиваю изображение',
    };
    return L[name] || name;
  },

  // ================= интерфейс =================
  el: null,
  build() {
    Agent.load();
    const el = h('div', { id: 'agentPanel', class: 'agent' });
    el.innerHTML = `
      <div class="ag-head"><b>ИИ-агент</b><span class="ag-model" title="Модель"></span><span class="grow"></span>
        <button class="ib" data-a="new" title="Новый разговор">＋</button><button class="ib" data-a="settings" title="Настройки подключения">⚙</button></div>
      <div class="ag-mats"><div class="ag-mats-t">Материалы <span class="muted">— папки и файлы для задачи</span></div><div class="ag-chips"></div>
        <div class="ag-add"><select class="ag-role"></select><button class="pbt" data-a="folder">+ Папка</button><button class="pbt" data-a="files">+ Файлы</button></div></div>
      <div class="ag-log"></div>
      <div class="ag-quick"></div>
      <div class="ag-status"></div>
      <div class="ag-input"><textarea rows="3" placeholder="Задача агенту… (Ctrl+Enter — отправить)"></textarea>
        <div class="ag-btns"><button class="pbt" data-a="undo" title="Отменить все изменения последнего задания">↶ Отменить</button><span class="grow"></span><button class="pbt" data-a="stop">■ Стоп</button><button class="primary" data-a="send">Отправить</button></div></div>`;
    const roleSel = el.querySelector('.ag-role');
    for (const [k, l] of Agent.ROLES) roleSel.append(h('option', { value: k }, l));
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const act = b.dataset.a;
      if (act === 'send') { const ta = el.querySelector('textarea'); const t = ta.value; ta.value = ''; Agent.send(t); }
      if (act === 'stop') Agent.stopFlag = true;
      if (act === 'folder') Agent.addFolder(roleSel.value);
      if (act === 'files') Agent.addFiles(roleSel.value);
      if (act === 'settings') Agent.settingsDialog();
      if (act === 'new') Agent.newChat();
      if (act === 'undo') Agent.undoAll();
      if (act === 'rm') { Agent.materials = Agent.materials.filter(m => m.id !== b.dataset.id); Agent.renderMaterials(); }
    });
    const ta = el.querySelector('textarea');
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const t = ta.value; ta.value = ''; Agent.send(t); } });
    const quick = el.querySelector('.ag-quick');
    const Q = [
      ['Листовка по образцу', 'Сверстай новую листовку в стиле прикреплённого примера и брендбука. Тексты: '],
      ['Обновить цены', 'Обнови цены в макете по прикреплённому прайсу. Покажи, какие позиции изменились.'],
      ['Серия баннеров', 'Сделай серию баннеров по шаблону: на каждую позицию из прайса — своя страница с названием, ценой и фото из папки исходников. Потом сохрани все страницы в PNG.'],
      ['Графика в SVG', 'Перерисуй прикреплённую графику в вектор в фирменных цветах из брендбука и сохрани в SVG.'],
    ];
    for (const [l, t] of Q) quick.append(h('button', { class: 'ag-q', title: t, onclick: () => { ta.value = t; ta.focus(); } }, l));
    Agent.el = el;
    Agent.renderMaterials(); Agent.renderChat();
    return el;
  },
  renderMaterials() {
    if (!Agent.el) return;
    const box = Agent.el.querySelector('.ag-chips');
    box.innerHTML = '';
    if (!Agent.materials.length) box.append(h('div', { class: 'muted small' }, 'Пока ничего. Выберите роль и добавьте папку с исходниками, брендбук (CDR/PDF), пример макета, прайс (Excel) или папку для результата.'));
    for (const m of Agent.materials) {
      box.append(h('div', { class: 'ag-chip role-' + m.role, title: m.kind === 'folder' ? m.folder.files.slice(0, 30).map(f => f.rel).join('\n') : m.name },
        h('span', { class: 'ag-chip-r' }, Agent.roleName(m.role).split(' ')[0]),
        h('span', {}, (m.kind === 'folder' ? '📁 ' + m.name + ' (' + m.folder.files.length + ')' : '📄 ' + m.name)),
        h('button', { class: 'ib', 'data-a': 'rm', 'data-id': m.id, title: 'Убрать' }, '×')));
    }
    const model = Agent.el.querySelector('.ag-model');
    model.textContent = Agent.settings.model + (Agent.settings.apiKey ? '' : ' · нет ключа');
  },
  renderChat() {
    if (!Agent.el) return;
    const log = Agent.el.querySelector('.ag-log');
    log.innerHTML = '';
    if (!Agent.chat.length) {
      log.append(h('div', { class: 'ag-empty' },
        h('p', {}, 'Поручите задачу — агент сам откроет материалы, сверстает макет в документе и проверит результат.'),
        h('p', { class: 'muted' }, 'Например: «Вот прайс и папка с фото — обнови цены в листовке и сделай 6 баннеров 1080×1080 по образцу, сохрани в PNG».')));
    }
    for (const m of Agent.chat) {
      if (m.role === 'tool') {
        const d = h('div', { class: 'ag-tool ' + (m.status || '') }, h('span', { class: 'ag-dot' }), m.text);
        if (m.image) d.append(h('img', { src: m.image, class: 'ag-thumb', onclick: () => UI.dialog('Изображение', h('img', { src: m.image, style: { maxWidth: '80vw', maxHeight: '75vh' } })) }));
        log.append(d);
      } else {
        const d = h('div', { class: 'ag-msg ' + m.role });
        d.innerHTML = Agent.md(m.text);
        log.append(d);
      }
    }
    log.scrollTop = log.scrollHeight;
    Agent.el.querySelector('[data-a="send"]').disabled = Agent.running;
    Agent.el.querySelector('[data-a="stop"]').style.display = Agent.running ? '' : 'none';
    Agent.el.querySelector('[data-a="undo"]').style.display = !Agent.running && Agent.startHpos !== null ? '' : 'none';
  },
  md(t) {
    // минимальная разметка: **жирный**, списки, переносы
    return Render.esc(String(t)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^[-•] (.*)$/gm, '<li>$1</li>').replace(/\n/g, '<br>');
  },
  setStatus(s) { if (Agent.el) { const el = Agent.el.querySelector('.ag-status'); el.textContent = s; el.style.display = s ? '' : 'none'; } },
  async settingsDialog() {
    const s = Agent.settings;
    const base = h('input', { type: 'text', class: 'wide', value: s.baseUrl });
    const key = h('input', { type: 'password', class: 'wide', value: s.apiKey, placeholder: 'Ключ Polza.ai' });
    const model = h('input', { type: 'text', class: 'wide', value: s.model, list: 'agModels' });
    const dl = h('datalist', { id: 'agModels' });
    const temp = h('input', { type: 'number', value: s.temperature, step: 0.1, min: 0, max: 2 });
    const steps = h('input', { type: 'number', value: s.maxSteps, min: 5, max: 300 });
    const load = h('button', { class: 'pbt', onclick: async () => { load.textContent = 'Загружаю…'; const list = await Agent.listModels(); dl.innerHTML = list.map(m => `<option value="${Render.esc(m)}">`).join(''); load.textContent = `Моделей: ${list.length}`; } }, 'Загрузить список моделей');
    UI.dialog('Подключение агента', h('div', { class: 'form' },
      h('p', { class: 'muted' }, 'Агент работает через Polza.ai (или другой OpenAI-совместимый сервис) по вашему ключу. Ключ хранится только на этом компьютере. Нужна модель с поддержкой инструментов и картинок (Claude, GPT, Gemini).'),
      h('label', {}, 'Адрес API', base), h('label', {}, 'API-ключ', key), h('label', {}, 'Модель', model, dl), load,
      h('label', {}, 'Температура (0 — точнее, 1 — творчески)', temp), h('label', {}, 'Максимум шагов на одну задачу', steps)),
    [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, action: () => {
      Object.assign(s, { baseUrl: base.value.trim() || 'https://polza.ai/api/v1', apiKey: key.value.trim(), model: model.value.trim() || s.model, temperature: +temp.value || 0, maxSteps: +steps.value || 60 });
      Agent.saveSettings(); Agent.renderMaterials();
    } }]);
  },
};
