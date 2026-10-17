// «Make»: интерактивный прототип, лендинг или мини-приложение по описанию — как Figma Make.
// Агент (Polza) пишет файлы проекта (HTML/CSS/JS), смотрит на результат в окне просмотра,
// исправляет ошибки. Картинки — из материалов на компьютере или сгенерированные в Polza.
// Код проекта выполняется в изолированном окне без доступа к программе и ключам.
'use strict';

const Make = {
  el: null, files: {}, assets: {}, versions: [], history: [], width: 'desktop', msgId: 0, waiters: {},
  START: `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Прототип</title><link rel="stylesheet" href="style.css"></head>
<body><main class="empty"><h1>Опишите, что сделать</h1><p>Лендинг, прототип приложения, форма, калькулятор, презентация продукта…</p></main>
<script src="app.js"></script></body></html>`,

  build() {
    Make.load();
    const el = h('div', { class: 'make' });
    const B = (label, title, fn, cls = 'pbt') => h('button', { class: cls, title, onclick: fn }, label);
    const wbtn = (k, l) => h('button', { class: 'pbt' + (Make.width === k ? ' on' : ''), 'data-w': k, onclick: () => Make.setWidth(k) }, l);
    Make.codeBtn = B('</> Код', 'Показать и править код', () => Make.toggleCode());
    const bar = h('div', { class: 'wsbar' },
      B('Новый', 'Новый проект', () => UI.confirm('Начать новый проект?', () => { Make.files = { 'index.html': Make.START, 'style.css': Make.baseCSS(), 'app.js': '' }; Make.assets = {}; Make.history = []; Make.chat.clear(); Make.commit('Новый'); })),
      B('Открыть папку', 'Открыть проект из папки (index.html и файлы)', () => Make.openFolder()),
      B('Сохранить ▾', 'Сохранить проект', e => { const r = e.currentTarget.getBoundingClientRect(); UI.showMenuList([{ label: 'В папку (index.html + файлы)…', action: () => Make.saveFolder() }, { label: 'Одним HTML-файлом…', action: () => Make.saveSingle() }], r.left, r.bottom); }),
      h('span', { class: 'sep' }), wbtn('desktop', '🖥 1440'), wbtn('tablet', '▭ 834'), wbtn('mobile', '📱 390'),
      h('span', { class: 'sep' }), Make.codeBtn, B('↻', 'Перезапустить просмотр', () => Make.preview()),
      B('Версии ▾', 'Вернуться к прошлой версии', e => Make.versionsMenu(e.currentTarget)),
      h('span', { class: 'grow' }),
      DS.chip(),
      B('+ Дизайн из «Фигмы»', 'Выделение в «Фигме» — картинкой-образцом для агента', () => Make.attachFigma()),
      B('+ Картинки', 'Картинки-образцы и ресурсы для проекта', () => Make.attachImages()));
    Make.frame = h('iframe', { class: 'mk-frame', sandbox: 'allow-scripts allow-forms allow-modals allow-popups' });
    Make.code = h('div', { class: 'mk-code', style: { display: 'none' } });
    const view = h('div', { class: 'mk-view' }, h('div', { class: 'mk-device' }, Make.frame), Make.code);
    Make.device = view.firstChild;
    Make.attach = h('div', { class: 'mk-attach' });
    Make.chat = ChatBox({
      placeholder: 'Что сделать: «лендинг кофейни с меню, ценами из прайса и формой записи», «прототип мобильного приложения доставки, 4 экрана с переходами»',
      empty: ['Опишите страницу или приложение — агент напишет код, проверит его в окне просмотра и исправит ошибки. Дальше просите правки обычными словами.', 'Можно приложить образец из «Фигмы», картинки, брендбук и прайс (материалы — в панели агента «Вектора»).'],
      quick: [['Лендинг', 'Сделай одностраничный лендинг: первый экран с оффером и кнопкой, преимущества, цены, отзывы, форма заявки, подвал. Современный аккуратный дизайн, адаптивно.'],
        ['Прототип приложения', 'Сделай кликабельный прототип мобильного приложения: 4–5 экранов с навигацией между ними, реалистичные данные, плавные переходы.'],
        ['По дизайну из Фигмы', 'Сверстай интерактивную страницу точно по приложенному дизайну из «Фигмы»: те же цвета, шрифты, отступы; кнопки и ссылки рабочие.']],
      onSend: (text, ui) => {
        const att = Object.values(Make.pendingImages || {});
        Make.pendingImages = {}; Make.renderAttach();
        const content = att.length ? [{ type: 'text', text }, ...att.map(a => ({ type: 'image_url', image_url: { url: a.thumb } }))] : text;
        return Polza.agent(content, { system: Make.systemPrompt, tools: Make.tools(), history: Make.history, exec: (n, a) => Make.exec(n, a), shouldStop: () => ui.stopFlag, onEvent: ui.event((n, a) => Make.toolLabel(n, a)) })
          .finally(() => Make.commit('Ответ агента'));
      },
    });
    const side = h('div', { class: 'mk-side' }, Make.attach, Make.chat.el);
    el.append(bar, h('div', { class: 'mk-main' }, side, view));
    window.addEventListener('message', e => {
      if (e.source !== (Make.frame && Make.frame.contentWindow)) return;
      const d = e.data || {};
      if (d.vkMake === 'log') { Make.logs.push(d.entry); if (Make.logs.length > 50) Make.logs.shift(); }
      if (d.vkMake === 'reply' && Make.waiters[d.id]) { Make.waiters[d.id](d.result); delete Make.waiters[d.id]; }
    });
    Make.setWidth(Make.width);
    Make.preview();
    Make.renderAttach();
    return el;
  },
  shown() { },
  baseCSS() { return `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2328}\n.empty{min-height:100vh;display:grid;place-content:center;text-align:center;color:#6b7280}\n`; },
  load() {
    try { const s = JSON.parse(localStorage.getItem('vektor.make') || 'null'); if (s && s.files) { Make.files = s.files; Make.versions = s.versions || []; } } catch (e) { }
    if (!Make.files['index.html']) Make.files = { 'index.html': Make.START, 'style.css': Make.baseCSS(), 'app.js': '' };
  },
  persist() {
    // ресурсы-картинки не сохраняем в настройках — только код (они живут в проекте на диске)
    try { localStorage.setItem('vektor.make', JSON.stringify({ files: Make.files, versions: Make.versions.slice(-15) })); } catch (e) { }
  },
  commit(label) {
    const snap = JSON.stringify(Make.files);
    const last = Make.versions[Make.versions.length - 1];
    if (!last || last.snap !== snap) Make.versions.push({ label, at: Date.now(), snap });
    if (Make.versions.length > 40) Make.versions.shift();
    Make.persist(); Make.preview(); if (Make.code.style.display !== 'none') Make.renderCode();
  },
  versionsMenu(anchor) {
    const r = anchor.getBoundingClientRect();
    UI.showMenuList(Make.versions.slice().reverse().slice(0, 20).map(v => ({ label: new Date(v.at).toLocaleTimeString('ru') + ' — ' + v.label, action: () => { Make.files = JSON.parse(v.snap); Make.persist(); Make.preview(); Make.renderCode(); } })), r.left, r.bottom);
  },
  setWidth(k) {
    Make.width = k;
    Make.device.style.width = { desktop: '100%', tablet: '834px', mobile: '390px' }[k];
    Make.device.classList.toggle('framed', k !== 'desktop');
    Make.el && Make.el.querySelectorAll('[data-w]').forEach(b => b.classList.toggle('on', b.dataset.w === k));
  },
  // ---------- сборка страницы для просмотра ----------
  logs: [],
  bridgeScript() {
    // внутри окна просмотра: ошибки и консоль → в программу; снимок страницы по запросу
    return `<script>(function(){var P=parent;function send(m){try{P.postMessage(m,'*')}catch(e){}}
function log(level,args){send({vkMake:'log',entry:{level:level,text:Array.prototype.map.call(args,function(a){try{return typeof a==='string'?a:JSON.stringify(a)}catch(e){return String(a)}}).join(' ').slice(0,500)}})}
['error','warn'].forEach(function(k){var o=console[k];console[k]=function(){log(k,arguments);o.apply(console,arguments)}});
window.addEventListener('error',function(e){log('error',[e.message+' ('+(e.filename||'')+':'+e.lineno+')'])});
window.addEventListener('unhandledrejection',function(e){log('error',['Promise: '+(e.reason&&e.reason.message||e.reason)])});
window.addEventListener('message',function(e){var d=e.data||{};if(d.vkMake!=='ask')return;
 if(d.what==='info'){var els=document.querySelectorAll('*').length;var t=(document.body&&document.body.innerText||'').slice(0,3000);
  var btn=Array.prototype.slice.call(document.querySelectorAll('button,a,input,select,textarea')).slice(0,60).map(function(b){return b.tagName.toLowerCase()+':'+(b.innerText||b.value||b.placeholder||b.getAttribute('href')||'').trim().slice(0,40)});
  send({vkMake:'reply',id:d.id,result:{title:document.title,elements:els,height:document.documentElement.scrollHeight,text:t,controls:btn}});}
 if(d.what==='scroll'){scrollTo(0,d.y||0);setTimeout(function(){send({vkMake:'reply',id:d.id,result:{y:scrollY,height:document.documentElement.scrollHeight,view:innerHeight}})},350)}
 if(d.what==='click'){try{var el=document.querySelector(d.selector);if(!el)throw new Error('нет элемента '+d.selector);el.click();send({vkMake:'reply',id:d.id,result:{ok:true}})}catch(err){send({vkMake:'reply',id:d.id,result:{error:String(err.message||err)}})}}
 if(d.what==='shot'){var go=function(){html2canvas(document.documentElement,{width:innerWidth,height:Math.min(document.documentElement.scrollHeight,d.full?6000:innerHeight),windowWidth:innerWidth,scale:Math.min(1,1200/innerWidth),useCORS:true,logging:false}).then(function(c){send({vkMake:'reply',id:d.id,result:{image:c.toDataURL('image/jpeg',.8)}})}).catch(function(err){send({vkMake:'reply',id:d.id,result:{error:String(err)}})})};
  if(window.html2canvas)go();else{var s=document.createElement('script');s.src=${JSON.stringify(new URL('vendor/html2canvas.min.js', location.href).href)};s.onload=go;s.onerror=function(){send({vkMake:'reply',id:d.id,result:{error:'нет html2canvas'}})};document.head.appendChild(s)}}
});})();<\/script>`;
  },
  assetURL(name) { const a = Make.assets[name]; return a ? a.data : null; },
  inline(html) {
    const F = Make.files;
    html = html.replace(/<link\b[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, (m, href) => F[href] !== undefined ? `<style>\n${F[href]}\n</style>` : m);
    html = html.replace(/<script\b([^>]*)src=["']([^"']+\.js)["']([^>]*)><\/script>/gi, (m, a, src, b) => F[src] !== undefined ? `<script${a}${b}>\n${F[src].replace(/<\/script/gi, '<\\/script')}\n</script>` : m);
    // ресурсы: assets/имя → встроенные данные
    html = html.replace(/(["'(])((?:\.\/)?assets\/[^"')\s]+)/g, (m, q, p) => { const u = Make.assetURL(p.replace(/^\.\//, '').replace(/^assets\//, '')); return u ? q + u : m; });
    return html;
  },
  preview() {
    if (!Make.frame) return;
    Make.logs = [];
    let html = Make.inline(Make.files['index.html'] || '');
    const br = Make.bridgeScript();
    // шрифты подключённых дизайн-систем — прямо с компьютера, через @font-face
    const ds = Make.dsCSS ? `<style data-ds>${Make.dsCSS}</style>` : '';
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + br + ds) : br + ds + html;
    Make.frame.srcdoc = html;
    if (typeof DS !== 'undefined') DS.fontCSS().then(css => { if (css !== Make.dsCSS) { Make.dsCSS = css; Make.preview(); } }).catch(() => { });
  },
  dsCSS: '',
  ask(what, extra = {}, timeout = 15000) {
    return new Promise(res => {
      const id = ++Make.msgId;
      Make.waiters[id] = res;
      Make.frame.contentWindow.postMessage(Object.assign({ vkMake: 'ask', what, id }, extra), '*');
      setTimeout(() => { if (Make.waiters[id]) { delete Make.waiters[id]; res({ error: 'окно просмотра не ответило' }); } }, timeout);
    });
  },
  async reload() { Make.preview(); await new Promise(r => { Make.frame.onload = () => r(); setTimeout(r, 4000); }); await new Promise(r => setTimeout(r, 600)); },
  // снимок просмотра: в настольной версии — настоящий снимок окна (до 3 экранов при full),
  // в браузере — html2canvas внутри окна просмотра
  async shot(full) {
    if (!(window.vkHost && vkHost.capture)) return Make.ask('shot', { full }, 30000);
    if (WS.current !== 'make') WS.show('make');
    await new Promise(r => setTimeout(r, 200));
    const rect = Make.frame.getBoundingClientRect();
    const parts = [];
    let y = 0;
    for (let i = 0; i < (full ? 3 : 1); i++) {
      const s = await Make.ask('scroll', { y });
      parts.push(await vkHost.capture({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }));
      if (!full || s.error || s.y + s.view >= s.height - 2) break;
      y = s.y + s.view;
    }
    await Make.ask('scroll', { y: 0 });
    if (parts.length === 1) return { image: parts[0] };
    const imgs = await Promise.all(parts.map(u => Polza.loadImage(u)));
    const c = document.createElement('canvas'); c.width = imgs[0].width; c.height = imgs.reduce((n, i) => n + i.height, 0);
    const g = c.getContext('2d'); let yy = 0; for (const im of imgs) { g.drawImage(im, 0, yy); yy += im.height; }
    return { image: c.toDataURL('image/jpeg', 0.8) };
  },
  // ---------- код ----------
  toggleCode() { const on = Make.code.style.display === 'none'; Make.code.style.display = on ? '' : 'none'; Make.codeBtn.classList.toggle('on', on); if (on) Make.renderCode(); },
  renderCode() {
    const box = Make.code; box.innerHTML = '';
    const names = Object.keys(Make.files);
    const cur = Make.codeFile && Make.files[Make.codeFile] !== undefined ? Make.codeFile : 'index.html';
    Make.codeFile = cur;
    const tabs = h('div', { class: 'mk-tabs' }, names.map(n => h('button', { class: 'pbt' + (n === cur ? ' on' : ''), onclick: () => { Make.codeFile = n; Make.renderCode(); } }, n)));
    const ta = h('textarea', { class: 'mk-ta', spellcheck: 'false', value: Make.files[cur] });
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); } if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); apply(); } });
    const apply = () => { Make.files[cur] = ta.value; Make.commit('Правка кода'); };
    box.append(tabs, ta, h('div', { class: 'row' }, h('span', { class: 'muted small' }, 'Ресурсы: ' + (Object.keys(Make.assets).join(', ') || 'нет')), h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: apply }, 'Применить (Ctrl+S)')));
  },
  // ---------- вложения ----------
  pendingImages: {},
  renderAttach() {
    const box = Make.attach; if (!box) return;
    box.innerHTML = '';
    const list = Object.entries(Make.pendingImages);
    if (!list.length && !Agent.materials.length) return;
    for (const [k, a] of list) box.append(h('span', { class: 'ag-chip' }, h('img', { src: a.thumb, style: { height: '22px', verticalAlign: 'middle' } }), ' ' + a.name, h('button', { class: 'ib', onclick: () => { delete Make.pendingImages[k]; Make.renderAttach(); } }, '×')));
    if (Agent.materials.length) box.append(h('span', { class: 'muted small' }, 'Материалы: ' + Agent.materials.map(m => m.name).join(', ')));
  },
  async attachImages() {
    const files = await Host.pickFiles('.png,.jpg,.jpeg,.webp,.svg,.gif', true, 'Картинки для проекта');
    for (const f of files) {
      const blob = await Host.blobOf(f);
      const name = Make.safeName(f.name);
      Make.assets[name] = { data: await Polza.dataURL(blob), type: blob.type };
      Make.pendingImages[name] = { name, thumb: await Polza.thumb(blob, 1024) };
    }
    Make.renderAttach();
    if (files.length) UI.toast('Картинки приложены и доступны в проекте как assets/…');
  },
  async attachFigma() {
    try {
      const blob = await FigmaWS.selectionImage();
      WS.show('make');
      Make.pendingImages['figma-' + Date.now()] = { name: 'дизайн из «Фигмы»', thumb: await Polza.thumb(blob, 1400, 'image/png') };
      Make.renderAttach();
    } catch (e) { WS.show('make'); UI.toast(e.message, true); }
  },
  safeName(n) { return String(n).toLowerCase().replace(/[^a-z0-9а-яё._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'file'; },
  // ---------- сохранение ----------
  async saveFolder() {
    const f = await Host.pickFolder('Папка для проекта');
    if (!f) return;
    for (const [n, c] of Object.entries(Make.files)) await Host.writeToFolder(f, n, c);
    for (const [n, a] of Object.entries(Make.assets)) await Host.writeToFolder(f, 'assets/' + n, await (await fetch(a.data)).blob());
    UI.toast('Проект сохранён в «' + f.name + '»');
    return f;
  },
  async saveSingle() { return Host.saveFile('prototype.html', Make.inline(Make.files['index.html'] || ''), 'text/html', 'html'); },
  async openFolder() {
    const f = await Host.pickFolder('Папка проекта (с index.html)');
    if (!f) return;
    const files = {}, assets = {};
    for (const x of f.files) {
      if (/\.(html|css|js|json|svg|txt|md)$/i.test(x.name) && !x.rel.startsWith('assets/') && x.size < 2e6) files[x.rel] = new TextDecoder().decode(await x.read());
      else if (/^assets\//.test(x.rel) && x.size < 2e7) { const b = await Host.blobOf(x); assets[x.rel.slice(7)] = { data: await Polza.dataURL(b), type: b.type }; }
    }
    if (!files['index.html']) return UI.toast('В папке нет index.html', true);
    Make.files = files; Make.assets = assets; Make.commit('Открыт проект');
  },

  // ---------- агент ----------
  systemPrompt() {
    return `Ты — дизайнер и фронтенд-разработчик в «Make» (как Figma Make). По описанию создаёшь работающие интерактивные прототипы, лендинги и мини-приложения.
Проект — набор файлов: index.html (подключает style.css и app.js обычными <link>/<script src>), можно добавлять свои файлы. Только чистые HTML/CSS/JavaScript, без сборки и npm. Можно подключать библиотеки с CDN (unpkg, jsdelivr, cdnjs) и Google Fonts — интернет в просмотре есть.
Картинки проекта лежат в assets/ (см. list_files) — ссылайся на них как assets/имя. Новые картинки: add_asset (из материалов пользователя) или generate_image (модель Polza, платно — только когда без этого не обойтись). Не используй случайные картинки из интернета.
Сейчас файлы: ${Object.keys(Make.files).join(', ')}; ресурсы: ${Object.keys(Make.assets).join(', ') || 'нет'}.

Как работать:
1. Если задача новая — коротко (2–4 строки) опиши, что сделаешь, и сразу делай. Пиши файлы целиком (write_file), для небольших правок — edit_file.
2. Дизайн — современный и аккуратный: сетка, воздух, иерархия, единая палитра и шрифты, адаптивность (мобильный 390, планшет 834, десктоп 1440), состояния кнопок, плавные переходы. Если приложен образец (дизайн из «Фигмы», брендбук) — повторяй его точно.
3. Интерактивность настоящая: навигация между экранами, формы с проверкой, переключатели, модальные окна, корзины, фильтры — с данными в JS.
4. После изменений ОБЯЗАТЕЛЬНО проверь: check_preview (ошибки консоли и текст страницы) и view_preview (снимок, можно на разных ширинах). Исправь найденное.
5. Если подключена дизайн-система (материалы «ДС …», блок правил ниже) — она главная: только её цвета, шрифты (они уже подключены в просмотре через @font-face под своими именами — пиши font-family как в ДС), размеры и отступы, логотипы (add_asset из папки ДС). Перед работой прочитай её гайд (read_file) и посмотри логотипы (view_file).
6. Тексты — по-русски (если не просили иначе), реалистичные, без «Lorem ipsum». Цены и факты бери из материалов, не выдумывай.
В конце — коротко, что сделано и что можно попросить дальше.`;
  },
  tools() {
    const T = Polza.tool, str = d => ({ type: 'string', description: d }), num = d => ({ type: 'number', description: d }), bool = d => ({ type: 'boolean', description: d });
    return [
      T('list_files', 'Файлы и ресурсы проекта.'),
      T('read_file', 'Прочитать файл проекта; если такого нет — файл из материалов пользователя (прайс, тексты, Excel, Word, PDF).', { path: str('Имя файла') }, ['path']),
      T('write_file', 'Создать или полностью переписать файл проекта.', { path: str('Имя файла, например index.html, style.css, app.js, pages/about.html'), content: str('Полное содержимое') }, ['path', 'content']),
      T('edit_file', 'Заменить фрагмент в файле (точное совпадение).', { path: str('Файл'), find: str('Что найти (точно, с отступами)'), replace: str('На что заменить'), all: bool('Заменить все вхождения') }, ['path', 'find', 'replace']),
      T('delete_file', 'Удалить файл проекта.', { path: str('Файл') }, ['path']),
      T('list_materials', 'Материалы пользователя (папки и файлы).'),
      T('search_files', 'Поиск в материалах.', { query: str('Часть имени') }, ['query']),
      T('view_file', 'Посмотреть картинку или документ из материалов.', { path: str('Путь'), page: num('Страница') }, ['path']),
      T('add_asset', 'Скопировать картинку из материалов в проект (assets/имя).', { path: str('Путь в материалах'), name: str('Имя в проекте, латиницей') }, ['path']),
      T('generate_image', 'Сгенерировать картинку моделью Polza и положить в assets/.', { prompt: str('Описание на английском'), name: str('Имя файла, например hero.png') }, ['prompt', 'name']),
      T('check_preview', 'Перезапустить просмотр и вернуть ошибки консоли, текст страницы, список кнопок и ссылок.'),
      T('view_preview', 'Снимок страницы в окне просмотра.', { width: { type: 'string', enum: ['desktop', 'tablet', 'mobile'] }, full_page: bool('Вся страница целиком, а не только первый экран'), click: str('CSS-селектор: сначала нажать на элемент (проверить переход)') }),
    ];
  },
  toolLabel(n, a) {
    return ({ list_files: 'Смотрю файлы', read_file: 'Читаю ' + a.path, write_file: 'Пишу ' + a.path, edit_file: 'Правлю ' + a.path, delete_file: 'Удаляю ' + a.path, list_materials: 'Смотрю материалы', search_files: 'Ищу ' + (a.query || ''),
      view_file: 'Смотрю ' + a.path, add_asset: 'Беру картинку ' + a.path, generate_image: 'Генерирую ' + a.name, check_preview: 'Проверяю страницу', view_preview: 'Смотрю результат' + (a.width ? ' (' + a.width + ')' : '') })[n] || n;
  },
  async exec(n, a) {
    const F = Make.files;
    switch (n) {
      case 'list_files': return { files: Object.entries(F).map(([k, v]) => ({ path: k, size: v.length })), assets: Object.keys(Make.assets).map(k => 'assets/' + k) };
      case 'read_file': if (F[a.path] !== undefined) return { path: a.path, content: F[a.path] }; return Agent.exec('read_file', a);
      case 'write_file': F[a.path] = String(a.content || ''); Make.persist(); Make.preview(); return { ok: true, size: F[a.path].length };
      case 'edit_file': {
        const s = F[a.path]; if (s === undefined) throw new Error('Нет файла ' + a.path);
        if (!s.includes(a.find)) throw new Error('Фрагмент не найден — прочитай файл (read_file) и повтори точно');
        F[a.path] = a.all ? s.split(a.find).join(a.replace) : s.replace(a.find, () => a.replace);
        Make.persist(); Make.preview(); return { ok: true };
      }
      case 'delete_file': delete F[a.path]; Make.persist(); return { ok: true };
      case 'list_materials': case 'search_files': case 'view_file': return Agent.exec(n, a);
      case 'add_asset': {
        const f = Agent.findFile(a.path); if (!f) throw new Error('Нет файла в материалах: ' + a.path);
        const blob = await Host.blobOf(f.entry);
        const name = Make.safeName(a.name || f.entry.name);
        Make.assets[name] = { data: await Polza.dataURL(blob), type: blob.type };
        return { path: 'assets/' + name };
      }
      case 'generate_image': {
        const blob = await Polza.generateImage(a.prompt);
        const name = Make.safeName(a.name || 'image.png');
        Make.assets[name] = { data: await Polza.dataURL(blob), type: blob.type };
        return { path: 'assets/' + name, _image: await Polza.thumb(blob, 768), _caption: name };
      }
      case 'check_preview': {
        await Make.reload();
        const info = await Make.ask('info');
        return { errors: Make.logs.filter(l => l.level === 'error').map(l => l.text), warnings: Make.logs.filter(l => l.level === 'warn').map(l => l.text).slice(0, 10), page: info };
      }
      case 'view_preview': {
        const prev = Make.width;
        if (a.width) Make.setWidth(a.width);
        await Make.reload();
        if (a.click) { const r = await Make.ask('click', { selector: a.click }); if (r.error) return r; await new Promise(r2 => setTimeout(r2, 700)); }
        const r = await Make.shot(!!a.full_page);
        if (a.width && a.width !== prev) Make.setWidth(prev);
        if (r.error) return { note: 'Снимок недоступен (' + r.error.slice(0, 120) + '). Вот текст страницы.', page: await Make.ask('info'), errors: Make.logs.filter(l => l.level === 'error').map(l => l.text) };
        return { errors: Make.logs.filter(l => l.level === 'error').map(l => l.text), _image: r.image, _caption: 'страница (' + (a.width || Make.width) + ')' };
      }
      default: throw new Error('Нет инструмента ' + n);
    }
  },
};
