/* CMS в CRM для маркетолога: страницы и статьи из блоков (как в Тильде), SEO любой страницы с подсказками для поиска и нейросетей,
   настройки сайта (контакты, соцсети, счётчики) и медиатека. Сохраняет через /api/crm/cms/*, сайт собирает HTML на сервере (pages.js). */
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dt = (s) => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
let api, toast, me, main, list = [], cur = null, curPath = null, dirty = false, slugTouched = false, filter = { kind: '', q: '' };
const KIND = { home: 'Главная', list: 'Раздел', service: 'Услуга', post: 'Статья', page: 'Страница' };

/* ---------- транслит для адресов ---------- */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().split('').map(c => TR[c] != null ? TR[c] : c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'stranica';

/* ---------- блоки ---------- */
const F = (k, n, type, o) => Object.assign({ k, n, type }, o || {});
const BLOCKS = {
  text: { n: 'Текст', i: '¶', d: 'Абзацы, подзаголовки, списки, ссылки', f: [F('html', '', 'rich')], def: { html: '<h2>Подзаголовок</h2><p>Текст абзаца.</p>' } },
  hero: { n: 'Обложка', i: '▣', d: 'Крупный заголовок с картинкой и кнопкой', f: [F('title', 'Заголовок', 'text'), F('text', 'Подзаголовок', 'area'), F('btn', 'Текст кнопки', 'text'), F('href', 'Ссылка кнопки', 'text', { ph: '/#lead' }), F('img', 'Фон', 'img')], def: { title: 'Заголовок обложки', text: '', btn: 'Подобрать строителя', href: '/#lead', img: '' } },
  image: { n: 'Картинка', i: '🖼', d: 'Фото или схема с подписью', f: [F('src', 'Картинка', 'img'), F('alt', 'Описание для поиска (alt)', 'text'), F('caption', 'Подпись', 'text')], def: { src: '', alt: '', caption: '' } },
  gallery: { n: 'Галерея', i: '▦', d: 'Несколько фото сеткой', f: [F('items', 'Фото', 'items', { sub: [F('src', 'Картинка', 'img'), F('alt', 'Описание (alt)', 'text')] })], def: { items: [] } },
  cards: { n: 'Карточки', i: '▤', d: 'Преимущества, тарифы, ссылки на разделы', f: [F('title', 'Заголовок блока', 'text'), F('items', 'Карточки', 'items', { sub: [F('title', 'Заголовок', 'text'), F('text', 'Текст', 'area'), F('href', 'Ссылка (необязательно)', 'text')] })], def: { title: '', items: [{ title: 'Преимущество', text: 'Коротко о нём', href: '' }] } },
  steps: { n: 'Шаги', i: '①', d: 'Как это работает — по этапам', f: [F('title', 'Заголовок блока', 'text'), F('items', 'Шаги', 'items', { sub: [F('title', 'Шаг', 'text'), F('text', 'Пояснение', 'area')] })], def: { title: 'Как это работает', items: [{ title: 'Первый шаг', text: '' }] } },
  faq: { n: 'Вопросы и ответы', i: '?', d: 'FAQ — с разметкой FAQPage для поиска и нейросетей', f: [F('title', 'Заголовок блока', 'text'), F('items', 'Вопросы', 'items', { sub: [F('q', 'Вопрос', 'text'), F('a', 'Ответ', 'area')] })], def: { title: 'Частые вопросы', items: [{ q: '', a: '' }] } },
  table: { n: 'Таблица', i: '▥', d: 'Цены, сравнения, нормы', f: [F('title', 'Заголовок блока', 'text'), F('rows', 'Строки: ячейки через |, первая строка — заголовки', 'area', { rows: 6 })], def: { title: '', rows: 'Раздел | Цена\nФундамент | 1,2 млн ₽' } },
  columns: { n: 'Две колонки', i: '◫', d: 'Текст в две колонки', f: [F('left', 'Левая колонка', 'rich'), F('right', 'Правая колонка', 'rich')], def: { left: '<p>Слева</p>', right: '<p>Справа</p>' } },
  links: { n: 'Читайте также', i: '↪', d: 'Перелинковка: карточки других статей и страниц сайта', f: [F('title', 'Заголовок блока', 'text'), F('items', 'Страницы', 'pages')], def: { title: 'Читайте также', items: [] } },
  audio: { n: 'Аудио', i: '♪', d: 'Подкаст, голосовое, запись разговора — файл MP3 или ссылка', f: [F('src', 'Аудиофайл', 'media', { accept: 'audio/*' }), F('caption', 'Подпись', 'text')], def: { src: '', caption: '' } },
  code: { n: 'Код', i: '{ }', d: 'Показать фрагмент кода или текста как есть (моноширинным)', f: [F('code', 'Текст кода', 'area', { rows: 6, mono: true })], def: { code: '' } },
  quote: { n: 'Цитата', i: '❝', d: 'Отзыв клиента или мнение эксперта', f: [F('text', 'Текст', 'area'), F('author', 'Автор', 'text')], def: { text: '', author: '' } },
  video: { n: 'Видео', i: '▶', d: 'Ссылка на YouTube, RuTube, VK Видео или свой файл MP4', f: [F('url', 'Ссылка на видео (YouTube, RuTube, VK)', 'text'), F('file', 'или файл MP4 / WebM', 'media', { accept: 'video/mp4,video/webm' }), F('caption', 'Подпись', 'text')], def: { url: '', file: '', caption: '' } },
  cta: { n: 'Призыв к действию', i: '➜', d: 'Тёмная плашка с кнопками', f: [F('title', 'Заголовок', 'text'), F('text', 'Текст', 'area'), F('btn', 'Кнопка', 'text'), F('href', 'Ссылка', 'text'), F('btn2', 'Вторая кнопка', 'text'), F('href2', 'Ссылка второй кнопки', 'text')], def: { title: 'Спланируйте дом бесплатно', text: '', btn: 'Открыть конструктор', href: '/', btn2: 'Подобрать строителя', href2: '/#lead' } },
  button: { n: 'Кнопка', i: '⬭', d: 'Одна кнопка-ссылка', f: [F('text', 'Текст', 'text'), F('href', 'Ссылка', 'text'), F('style', 'Вид', 'select', { opts: [['gold', 'Жёлтая'], ['', 'Контурная']] })], def: { text: 'Подробнее', href: '/', style: 'gold' } },
  contacts: { n: 'Контакты', i: '☎', d: 'Телефон, почта, адрес из настроек сайта', f: [F('title', 'Заголовок', 'text')], def: { title: 'Контакты' } },
  constructor: { n: 'Блок конструктора', i: '⌂', d: 'Стандартный призыв открыть конструктор', f: [], def: {} },
  divider: { n: 'Разделитель', i: '—', d: 'Линия между частями', f: [], def: {} },
  html: { n: 'HTML-код', i: '</>', d: 'Виджет, карта, форма — вставка кода', f: [F('code', 'Код', 'area', { rows: 6, mono: true })], def: { code: '' } },
};

/* кнопки визуального редактора */
const RT_CMDS = [['bold', 'Ж', 'Жирный'], ['italic', 'К', 'Курсив'], ['underline', 'Ч', 'Подчёркнутый'], ['strikeThrough', 'З̶', 'Зачёркнутый'], ['mark', '▮', 'Выделить маркером'], ['|'],
  ['h2', 'H2', 'Подзаголовок'], ['h3', 'H3', 'Подзаголовок 2'], ['h4', 'H4', 'Подзаголовок 3'], ['p', '¶', 'Абзац'], ['insertUnorderedList', '•', 'Список'], ['insertOrderedList', '1.', 'Нумерованный список'], ['blockquote', '❝', 'Цитата'], ['pre', '{ }', 'Блок кода'], ['code', '<>', 'Код в строке'], ['insertHorizontalRule', '—', 'Линия'], ['|'],
  ['img', '🖼 Фото', 'Вставить фото в текст'], ['page', '↪ Страница сайта', 'Ссылка на статью, услугу или страницу сайта (перелинковка)'], ['link', '🔗', 'Ссылка на любой адрес'], ['unlink', '⛓', 'Убрать ссылку'], ['contacts', '☎ Контакты', 'Вставить контакты из настроек сайта — обновятся сами'], ['|'], ['removeFormat', '⌫', 'Очистить оформление']];

/* ---------- SEO и GEO: проверка страницы ---------- */
const plain = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function seo(r) {
  const brand = (window.DK && DK.CONFIG && DK.CONFIG.brand) || 'Логика Дома';
  const title = r.seoTitle || `${r.title || ''} — ${brand}`, desc = r.desc || '', bl = r.blocks || [];
  const html = bl.map(b => [b.html, b.left, b.right].filter(Boolean).join(' ')).join(' ');
  const text = [r.lead, plain(html)].concat(bl.flatMap(b => [b.text, b.title, b.caption].concat((b.items || []).flatMap(x => [x.title, x.text, x.q, x.a])))).filter(Boolean).join(' ');
  const wordsN = text.split(/\s+/).filter(Boolean).length, h2 = (html.match(/<h2/gi) || []).length + bl.filter(b => b.title && b.t !== 'text').length;
  const faqN = bl.filter(b => b.t === 'faq').reduce((s, b) => s + (b.items || []).filter(x => x.q && x.a).length, 0);
  const imgs = bl.flatMap(b => b.t === 'image' ? [b] : b.t === 'gallery' ? (b.items || []) : []).filter(x => x.src), noAlt = imgs.filter(x => !String(x.alt || '').trim()).length + (html.match(/<img(?![^>]*alt="[^"]+")[^>]*>/gi) || []).length;
  const links = (html.match(/href="\/[^"]*"/g) || []).length + bl.filter(b => /^\//.test(b.href || '') || /^\//.test(b.href2 || '')).length + bl.flatMap(b => b.items || []).filter(x => /^\//.test(x.href || '')).length;
  const kw = String(r.keywords || '').split(',')[0].trim().toLowerCase();
  const it = [], add = (ok, txt, tip) => it.push({ ok, txt, tip });
  add(title.length >= 30 && title.length <= 65, `Заголовок для поиска (title): ${title.length} симв.`, 'Оптимально 30–65 символов: главный запрос в начале, бренд в конце');
  add(desc.length >= 70 && desc.length <= 160, `Описание (description): ${desc.length} симв.`, '70–160 символов: польза страницы и призыв, без повторов заголовка');
  if (r.kind === 'home') { add(!!kw, kw ? `Ключевая фраза: «${kw}»` : 'Ключевые фразы не заданы', 'Через запятую, главная — первой'); return score(it); }
  add(!!(r.title || '').trim(), 'Заголовок страницы (H1) заполнен', 'Один H1 на страницу');
  add((r.lead || '').length >= 80 && (r.lead || '').length <= 320, `Короткий ответ в начале: ${(r.lead || '').length} симв.`, 'Нейросети и «быстрые ответы» цитируют первые 1–3 предложения: прямой ответ на вопрос из заголовка, 80–320 символов');
  const minW = r.kind === 'page' ? 120 : 300;
  add(wordsN >= minW, `Объём текста: ${wordsN} слов`, `Для ${r.kind === 'page' ? 'страницы' : 'статьи и услуги'} — от ${minW} слов: раскройте тему полностью`);
  if (r.kind !== 'page' && r.kind !== 'list') add(h2 >= 2, `Подзаголовков H2: ${h2}`, 'Разбейте текст на разделы с понятными подзаголовками — по ним поиск и нейросети собирают ответ');
  if (r.kind === 'post' || r.kind === 'service') add(faqN >= 2, `Вопросов в FAQ: ${faqN}`, 'Добавьте блок «Вопросы и ответы» (от 2 вопросов): это разметка FAQPage и готовые ответы для ИИ-поиска');
  add(!noAlt, noAlt ? `Картинок без описания (alt): ${noAlt}` : `Картинки с описанием: ${imgs.length}`, 'Опишите, что на картинке — это читают поиск по картинкам и экранные дикторы');
  if (r.kind !== 'list') add(links >= 2, `Внутренних ссылок: ${links}`, 'Сошлитесь минимум на 2 страницы сайта: конструктор, услуги, статьи');
  if (kw) add((title + ' ' + (r.title || '') + ' ' + (r.lead || '')).toLowerCase().includes(kw), `Ключевая фраза «${kw}» в заголовке или ответе`, 'Главный запрос должен быть в title, H1 или первом абзаце');
  else add(false, 'Ключевые фразы не заданы', 'Укажите 1–3 запроса через запятую: «дом из газобетона цена, …»');
  if (r.kind === 'post') { add(!!r.date, 'Дата публикации указана', 'Дата — сигнал свежести для поиска'); add(!!r.cover, r.cover ? 'Обложка есть' : 'Нет обложки', 'Обложка показывается в карточке блога и в соцсетях'); }
  return score(it);
}
const score = (it) => ({ items: it, score: Math.round(it.filter(x => x.ok).length / Math.max(1, it.length) * 100) });
const scoreBadge = (s) => `<span class="badge ${s >= 80 ? 'approved' : s >= 50 ? 'pending' : 'rejected'}" title="Оценка SEO">${s}</span>`;

/* ---------- список страниц ---------- */
async function renderList() {
  if (!(await leave())) return;
  cur = null; history.replaceState(null, '', location.pathname);
  list = await api('/api/crm/cms');
  main.innerHTML = `<h1>Контент сайта</h1><div class="muted" style="margin-bottom:10px">Страницы, услуги и статьи собираются из блоков. У каждой — свой заголовок и описание для поиска, подсказки по SEO и ответам нейросетей. Изменения видны на сайте сразу после «Сохранить» со статусом «Опубликовано».</div>
  <div class="row" style="margin-bottom:12px"><button class="btn primary" data-new="post">+ Статья</button><button class="btn" data-new="page">+ Страница</button><button class="btn" data-new="service">+ Услуга</button><span style="flex:1"></span><button class="btn ghost" id="cmsSite">Настройки сайта</button><button class="btn ghost" id="cmsMedia">Медиатека</button></div>
  <div class="row" style="margin-bottom:10px"><div class="tabs" style="margin:0">${[['', 'Все'], ['page', 'Страницы'], ['service', 'Услуги'], ['post', 'Статьи'], ['list', 'Разделы и главная']].map(([k, n]) => `<button data-k="${k}" aria-pressed="${filter.kind === k}">${n}</button>`).join('')}</div><input id="cmsQ" placeholder="Поиск по названию и адресу" style="max-width:280px" value="${esc(filter.q)}"></div>
  <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>Страница</th><th>Адрес</th><th>Тип</th><th>Статус</th><th class="num">SEO</th><th>Изменено</th></tr></thead><tbody id="cmsT"></tbody></table></div>`;
  const draw = () => {
    const q = filter.q.toLowerCase();
    $('#cmsT').innerHTML = list.filter(r => (!filter.kind || r.kind === filter.kind || (filter.kind === 'list' && r.kind === 'home')) && (!q || (r.title + ' ' + r.name + ' ' + r.path).toLowerCase().includes(q)))
      .sort((a, b) => ['home', 'list', 'page', 'service', 'post'].indexOf(a.kind) - ['home', 'list', 'page', 'service', 'post'].indexOf(b.kind) || String(b.date || b.updatedAt || '').localeCompare(String(a.date || a.updatedAt || '')))
      .map(r => `<tr class="click" data-p="${esc(r.path)}"><td><b>${esc(r.name || r.title)}</b>${r.kind === 'post' && r.date ? `<br><small class="muted">${esc(r.date)}</small>` : ''}</td><td><small>${esc(r.path)}</small></td><td>${KIND[r.kind]}${r.custom ? '' : ' <small class="muted">исходная</small>'}</td>
        <td><span class="badge ${r.status === 'published' ? 'approved' : 'pending'}">${r.status === 'published' ? 'опубликовано' : 'черновик'}</span>${r.edited && !r.custom ? ' <small class="muted">изменено</small>' : ''}</td><td class="num">${scoreBadge(seo(r).score)}</td><td><small>${r.updatedAt ? dt(r.updatedAt) + (r.by ? ' · ' + esc(r.by) : '') : '—'}</small></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Ничего не найдено</td></tr>';
    $$('#cmsT tr').forEach(tr => tr.onclick = () => edit(tr.dataset.p));
  };
  $$('.tabs [data-k]', main).forEach(b => b.onclick = () => { filter.kind = b.dataset.k; $$('.tabs [data-k]', main).forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); });
  $('#cmsQ').oninput = (e) => { filter.q = e.target.value; draw(); };
  $$('[data-new]', main).forEach(b => b.onclick = () => create(b.dataset.new));
  $('#cmsSite').onclick = renderSite; $('#cmsMedia').onclick = () => renderMedia();
  draw();
}
async function leave() { if (!dirty) return true; if (!confirm('Есть несохранённые изменения. Уйти без сохранения?')) return false; dirty = false; return true; }

/* ---------- новая страница: заготовки как шаблоны Тильды ---------- */
function create(kind) {
  const T = {
    post: { title: 'Новая статья', name: '', lead: '', date: new Date().toISOString().slice(0, 10), blocks: [{ t: 'text', html: '<h2>Первый раздел</h2><p>Текст.</p><h2>Второй раздел</h2><p>Текст.</p>' }, { t: 'faq', title: 'Частые вопросы', items: [{ q: '', a: '' }, { q: '', a: '' }] }, { t: 'constructor' }] },
    page: { title: 'Новая страница', name: '', lead: '', blocks: [{ t: 'hero', title: 'Заголовок обложки', text: '', btn: 'Подобрать строителя', href: '/#lead', img: '' }, { t: 'text', html: '<h2>Подзаголовок</h2><p>Текст.</p>' }, { t: 'cta', title: 'Спланируйте дом бесплатно', text: '', btn: 'Открыть конструктор', href: '/', btn2: 'Подобрать строителя', href2: '/#lead' }] },
    service: { title: 'Новая услуга', name: '', lead: '', price: 'По договорённости', blocks: [{ t: 'text', html: '<h2>Что входит</h2><ul><li>Пункт</li></ul>' }, { t: 'steps', title: 'Как проходит работа', items: [{ title: 'Заявка', text: '' }, { title: 'Созвон', text: '' }] }, { t: 'faq', title: 'Частые вопросы', items: [{ q: '', a: '' }] }] },
  }[kind];
  const pre = { post: '/blog/', service: '/uslugi/', page: '/' }[kind];
  cur = Object.assign({ kind, status: 'draft', seoTitle: '', desc: '', keywords: '', ogImage: '', noindex: false, inMenu: false, custom: true, isNew: true, path: pre + slugify(T.title) + '/' }, JSON.parse(JSON.stringify(T)));
  curPath = cur.path; slugTouched = false; dirty = true; drawEditor();
}
async function edit(p) {
  if (!(await leave())) return;
  const r = await api('/api/crm/cms/page?path=' + encodeURIComponent(p));
  cur = JSON.parse(JSON.stringify(r)); curPath = r.path; slugTouched = true; dirty = false;
  history.replaceState(null, '', '#cms:' + r.path); drawEditor();
}

/* ---------- редактор ---------- */
function drawEditor() {
  const r = cur, home = r.kind === 'home', isList = r.kind === 'list';
  const pre = r.path.replace(/[^/]+\/$/, ''), slug = r.path === '/' ? '' : r.path.slice(pre.length).replace(/\/$/, '');
  main.innerHTML = `<div class="cms-top"><button class="btn sm ghost" id="cBack">← Контент</button><h1 style="margin:0;flex:1;min-width:200px">${esc(r.name || r.title || 'Без названия')}</h1>
    <select id="cSt" style="max-width:170px"><option value="published"${r.status === 'published' ? ' selected' : ''}>Опубликовано</option><option value="draft"${r.status !== 'published' ? ' selected' : ''}>Черновик</option></select>
    ${home ? '' : '<button class="btn" id="cPrev">Предпросмотр</button>'}${!r.isNew && r.status === 'published' ? `<a class="btn ghost" href="${esc(r.path)}" target="_blank">На сайте ↗</a>` : ''}
    ${r.custom && !r.isNew ? '<button class="btn ghost" id="cDel" style="color:var(--err);border-color:var(--err)">Удалить</button>' : ''}${!r.custom && r.edited ? '<button class="btn ghost" id="cReset">Вернуть исходный текст</button>' : ''}
    <button class="btn primary" id="cSave">Сохранить</button></div>
  <div class="cms-grid"><div class="cms-main">
    ${home ? `<div class="box"><b>Главная — это конструктор.</b><p class="muted" style="margin:6px 0 0">Здесь задаются заголовок, описание и картинка для поиска и соцсетей. Тексты интерфейса конструктора правятся в коде.</p></div>` : `
    <div class="box cms-fields"><label class="f">Заголовок страницы (H1)<input data-k="title" value="${esc(r.title)}"></label>
      <label class="f">Короткое название — в меню, карточках и хлебных крошках<input data-k="name" value="${esc(r.name || '')}" placeholder="${esc(r.title)}"></label>
      <label class="f">Короткий ответ в начале страницы <span class="muted">— 1–3 предложения: его цитируют поиск и нейросети</span><textarea data-k="lead" rows="3">${esc(r.lead || '')}</textarea></label>
      ${r.kind === 'post' ? `<div class="grid2"><label class="f">Дата публикации<input type="date" data-k="date" value="${esc(r.date || '')}"></label>${imgField('cover', 'Обложка статьи', r.cover)}</div>` : ''}
      ${r.kind === 'service' ? `<label class="f">Стоимость<input data-k="price" value="${esc(r.price || '')}" placeholder="от 15 000 ₽ / Бесплатно"></label>` : ''}
      ${isList ? '<div class="muted">Карточки услуг или статей на этой странице собираются автоматически. Блоки ниже покажутся под ними.</div>' : ''}</div>
    <div id="cBlocks"></div>`}
  </div>
  <aside class="cms-side"><div class="box"><h2 style="margin-top:0">SEO и выдача</h2>
    <label class="f">Адрес страницы${r.custom ? '' : ' <span class="muted">— у исходной страницы не меняется</span>'}<div class="row" style="flex-wrap:nowrap"><span class="muted" style="white-space:nowrap">${esc(pre)}</span><input id="cSlug" value="${esc(slug)}"${r.custom ? '' : ' disabled'}><span class="muted">/</span></div></label>
    ${r.custom && r.kind === 'page' ? '' : ''}
    <label class="f">Заголовок для поиска (title) <span class="muted cnt" data-for="seoTitle"></span><input data-k="seoTitle" value="${esc(r.seoTitle || '')}" placeholder="${esc((r.title || '') + ' — ' + ((window.DK && DK.CONFIG.brand) || ''))}"></label>
    <label class="f">Описание (description) <span class="muted cnt" data-for="desc"></span><textarea data-k="desc" rows="3">${esc(r.desc || '')}</textarea></label>
    <label class="f">Ключевые фразы через запятую<input data-k="keywords" value="${esc(r.keywords || '')}" placeholder="дом из газобетона цена, тёплый контур"></label>
    ${imgField('ogImage', 'Картинка для соцсетей (Open Graph, 1200 × 630)', r.ogImage)}
    <label class="row"><input type="checkbox" data-k="noindex"${r.noindex ? ' checked' : ''}> Скрыть от поиска (noindex)</label>
    ${r.custom && r.kind === 'page' ? `<label class="row"><input type="checkbox" data-k="inMenu"${r.inMenu ? ' checked' : ''}> Показать в подвале сайта</label>` : ''}
    <div class="snip" id="cSnip"></div></div>
    <div class="box"><h2 style="margin-top:0">Проверка <span id="cScore"></span></h2><ul class="seol" id="cSeo"></ul></div></aside></div>`;
  $('#cBack').onclick = () => renderList();
  $('#cSt').onchange = (e) => { r.status = e.target.value; touch(); };
  $('#cSave').onclick = save;
  if ($('#cPrev')) $('#cPrev').onclick = previewPage;
  if ($('#cDel')) $('#cDel').onclick = async () => { if (!confirm(`Удалить страницу ${r.path}?`)) return; await api('/api/crm/cms/page?path=' + encodeURIComponent(r.path), null, 'DELETE'); dirty = false; toast('Страница удалена'); renderList(); };
  if ($('#cReset')) $('#cReset').onclick = async () => { if (!confirm('Вернуть исходный текст и SEO? Ваши правки этой страницы пропадут.')) return; await api('/api/crm/cms/reset', { path: r.path }); dirty = false; toast('Исходный текст возвращён'); edit(r.path); };
  $$('[data-k]', main).forEach(inp => { const k = inp.dataset.k; inp.oninput = inp.onchange = () => { r[k] = inp.type === 'checkbox' ? inp.checked : inp.value; if (k === 'title' && r.isNew && !slugTouched) { $('#cSlug').value = slugify(inp.value); setSlug(); } touch(); }; });
  if ($('#cSlug')) $('#cSlug').oninput = () => { slugTouched = true; setSlug(); touch(); };
  bindImgs(main, (k, v) => { r[k] = v; touch(); });
  if ($('#cBlocks')) drawBlocks();
  side();
}
function setSlug() { const v = slugify($('#cSlug').value); const pre = cur.path.replace(/[^/]+\/$/, ''); cur.path = pre + v + '/'; }
function touch() { dirty = true; side(); }
function side() {
  const r = cur, s = seo(r), brand = (window.DK && DK.CONFIG.brand) || '';
  $$('.cnt', main).forEach(c => { const v = String(r[c.dataset.for] || (c.dataset.for === 'seoTitle' ? (r.title || '') + ' — ' + brand : '')).length; c.textContent = `· ${v}`; c.style.color = (c.dataset.for === 'seoTitle' ? v >= 30 && v <= 65 : v >= 70 && v <= 160) ? 'var(--ok)' : 'var(--warn)'; });
  const t = r.seoTitle || `${r.title || ''} — ${brand}`;
  $('#cSnip').innerHTML = `<div class="muted" style="font-size:11px;margin-bottom:4px">Так страница выглядит в Яндексе и Google</div><div class="sn-t">${esc(t.length > 70 ? t.slice(0, 68) + '…' : t)}</div><div class="sn-u">${esc(location.host)}${esc(r.path)}</div><div class="sn-d">${esc((r.desc || r.lead || '').slice(0, 165))}${(r.desc || r.lead || '').length > 165 ? '…' : ''}</div>`;
  $('#cScore').innerHTML = scoreBadge(s.score);
  $('#cSeo').innerHTML = s.items.map(x => `<li class="${x.ok ? 'ok' : 'no'}"><b>${esc(x.txt)}</b>${x.ok ? '' : `<span>${esc(x.tip)}</span>`}</li>`).join('');
}

/* поле картинки: ссылка, загрузка, выбор из медиатеки */
const imgField = (k, n, v, extra) => `<div class="f imgf" data-img="${k}"${extra || ''}><span>${esc(n)}</span><div class="row" style="flex-wrap:nowrap"><input class="imgv" value="${esc(v || '')}" placeholder="/media/… или https://…"><button type="button" class="btn sm" data-up>Загрузить</button><button type="button" class="btn sm ghost" data-lib>Медиатека</button></div>${v ? `<img class="thumb" src="${esc(v)}" alt="">` : ''}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>`;
function bindImgs(root, set) {
  $$('.imgf', root).forEach(w => {
    if (w.dataset.bound) return; w.dataset.bound = 1;
    const k = w.dataset.img, inp = $('.imgv', w), file = $('input[type=file]', w);
    const put = (v) => { inp.value = v; let th = $('.thumb', w); if (!th && v) { th = document.createElement('img'); th.className = 'thumb'; w.insertBefore(th, file); } if (th) { th.src = v; th.hidden = !v; } set(k, v, w); };
    inp.onchange = () => put(inp.value.trim());
    $('[data-up]', w).onclick = () => file.click();
    file.onchange = async () => { const f = file.files[0]; if (!f) return; try { const u = await upload(f); put(u); toast('Картинка загружена'); } catch (e) { toast(e.message); } file.value = ''; };
    $('[data-lib]', w).onclick = () => renderMedia((u) => put(u));
  });
}
async function upload(f) {
  const big = /^(audio|video)\//.test(f.type);
  if (f.size > (big ? 40e6 : 8e6)) throw new Error(big ? 'Аудио и видео — до 40 МБ; длинные видео загрузите на RuTube или VK и вставьте ссылку' : 'Картинка больше 8 МБ');
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  return (await api('/api/crm/media', { name: f.name, data })).url;
}

/* ---------- блоки страницы ---------- */
function drawBlocks() {
  const r = cur, box = $('#cBlocks');
  box.innerHTML = r.blocks.map((b, i) => addBtn(i) + blockHtml(b, i)).join('') + addBtn(r.blocks.length);
  $$('[data-add]', box).forEach(btn => btn.onclick = () => palette(+btn.dataset.add));
  $$('.blk', box).forEach(el => {
    const i = +el.dataset.i, b = r.blocks[i], B = BLOCKS[b.t] || { f: [] };
    $('[data-up]', el).onclick = () => { if (i > 0) { r.blocks.splice(i - 1, 0, r.blocks.splice(i, 1)[0]); touch(); drawBlocks(); } };
    $('[data-down]', el).onclick = () => { if (i < r.blocks.length - 1) { r.blocks.splice(i + 1, 0, r.blocks.splice(i, 1)[0]); touch(); drawBlocks(); } };
    $('[data-dup]', el).onclick = () => { r.blocks.splice(i + 1, 0, JSON.parse(JSON.stringify(b))); touch(); drawBlocks(); };
    $('[data-del]', el).onclick = () => { if (!confirm(`Удалить блок «${B.n}»?`)) return; r.blocks.splice(i, 1); touch(); drawBlocks(); };
    $('[data-fold]', el).onclick = () => el.classList.toggle('folded');
    bindFields(el, b, B.f);
  });
}
const addBtn = (i) => `<div class="addb"><button type="button" data-add="${i}" title="Добавить блок">＋ блок</button></div>`;
function blockHtml(b, i) {
  const B = BLOCKS[b.t] || { n: b.t, i: '?', f: [] };
  return `<section class="blk" data-i="${i}"><header><span class="bi">${B.i}</span><b>${esc(B.n)}</b><span class="muted bsum">${esc(sum(b))}</span><span style="flex:1"></span>
    <button type="button" data-up title="Выше">↑</button><button type="button" data-down title="Ниже">↓</button><button type="button" data-dup title="Копия">⧉</button><button type="button" data-fold title="Свернуть">▾</button><button type="button" data-del title="Удалить">✕</button></header>
    <div class="bb">${B.f.length ? B.f.map(f => fieldHtml(f, b[f.k])).join('') : `<div class="muted">${esc(B.d)}</div>`}</div></section>`;
}
const sum = (b) => plain(b.title || b.text || b.html || b.q || b.url || '').slice(0, 60);
function fieldHtml(f, v, idx) {
  const d = idx != null ? ` data-ii="${idx}"` : '';
  if (f.type === 'rich') return `<div class="f"${d}>${f.n ? `<span>${esc(f.n)}</span>` : ''}<div class="rt-bar">${RT_CMDS.map(([c, n, t]) => `${c === '|' ? '<i class="sep"></i>' : `<button type="button" data-cmd="${c}" title="${t}">${n}</button>`}`).join('')}</div><div class="rt" contenteditable="true" data-f="${f.k}">${v || ''}</div></div>`;
  if (f.type === 'area') return `<label class="f"${d}>${esc(f.n)}<textarea data-f="${f.k}" rows="${f.rows || 3}"${f.mono ? ' style="font-family:var(--mono);font-size:12.5px"' : ''}>${esc(v || '')}</textarea></label>`;
  if (f.type === 'img') return imgField(f.k, f.n, v, ` data-f="${f.k}"${d}`);
  if (f.type === 'media') return `<div class="f mediaf" data-mk="${f.k}"><span>${esc(f.n)}</span><div class="row" style="flex-wrap:nowrap"><input class="mv" data-f="${f.k}" value="${esc(v || '')}" placeholder="/media/…"><button type="button" class="btn sm" data-mup>Загрузить файл</button></div>${v ? (/^(audio|.*\.(mp3|m4a|ogg|wav))/i.test(f.accept + v) && !/video/.test(f.accept) ? `<audio controls src="${esc(v)}"></audio>` : `<video controls src="${esc(v)}" style="max-height:160px"></video>`) : ''}<input type="file" accept="${esc(f.accept)}" hidden></div>`;
  if (f.type === 'pages') return `<div class="f"><span>${esc(f.n)}</span><div class="plinks">${(v || []).map((x, j) => `<span class="chip">${esc(x.title || x.path)} <button type="button" data-prm="${j}">✕</button></span>`).join('') || '<span class="muted">Не выбрано</span>'}</div><button type="button" class="btn sm" data-padd>+ выбрать страницы</button></div>`;
  if (f.type === 'select') return `<label class="f"${d}>${esc(f.n)}<select data-f="${f.k}">${f.opts.map(([k, n]) => `<option value="${k}"${(v || '') === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`;
  if (f.type === 'items') return `<div class="f items" data-items="${f.k}"><span>${esc(f.n)}</span>${(v || []).map((x, j) => `<div class="item" data-j="${j}"><div class="grid2">${f.sub.map(sf => fieldHtml(sf, x[sf.k])).join('')}</div><div class="row"><button type="button" class="btn sm ghost" data-iu>↑</button><button type="button" class="btn sm ghost" data-id>↓</button><button type="button" class="btn sm ghost" data-ix>Удалить</button></div></div>`).join('')}<button type="button" class="btn sm" data-iadd>+ добавить</button></div>`;
  return `<label class="f"${d}>${esc(f.n)}<input data-f="${f.k}" value="${esc(v || '')}" placeholder="${esc(f.ph || '')}"></label>`;
}
function bindFields(el, b, fields) {
  const top = (n) => n.closest('.blk, .item') ;
  // простые поля блока (не внутри списков)
  $$('[data-f]', el).forEach(inp => {
    if (inp.closest('.item')) return;
    const k = inp.dataset.f;
    if (inp.classList.contains('rt')) { inp.oninput = () => { b[k] = inp.innerHTML; touch(); }; richBind(inp); return; }
    if (inp.classList.contains('imgf')) return;
    inp.oninput = inp.onchange = () => { b[k] = inp.value; touch(); };
  });
  // файлы аудио и видео
  $$('.mediaf', el).forEach(w => {
    const k = w.dataset.mk, file = $('input[type=file]', w);
    $('[data-mup]', w).onclick = () => file.click();
    file.onchange = async () => { const f = file.files[0]; if (!f) return; try { toast('Загружаю ' + f.name + '…'); b[k] = await upload(f); touch(); drawBlocks(); toast('Файл загружен'); } catch (er) { toast(er.message); } };
  });
  // страницы для перелинковки
  if ($('[data-padd]', el)) {
    b.items = b.items || [];
    $('[data-padd]', el).onclick = () => pickPage((pg) => { if (!b.items.some(x => x.path === pg.path)) b.items.push({ path: pg.path, title: pg.name || pg.title }); touch(); drawBlocks(); }, true);
    $$('[data-prm]', el).forEach(x => x.onclick = () => { b.items.splice(+x.dataset.prm, 1); touch(); drawBlocks(); });
  }
  bindImgs(el, (k, v, w) => { const it = w.closest('.item'); if (it) { const lk = it.closest('[data-items]').dataset.items; b[lk][+it.dataset.j][k] = v; } else b[k] = v; touch(); });
  // списки: карточки, шаги, вопросы, фото
  $$('[data-items]', el).forEach(wrap => {
    if (!fields.find(x => x.k === wrap.dataset.items)) return;
    const k = wrap.dataset.items, f = fields.find(x => x.k === k), arr = b[k] = b[k] || [];
    $$('.item', wrap).forEach(it => {
      const j = +it.dataset.j;
      $$('[data-f]', it).forEach(inp => { if (inp.classList.contains('imgf')) return; inp.oninput = inp.onchange = () => { arr[j][inp.dataset.f] = inp.value; touch(); }; });
      $('[data-iu]', it).onclick = () => { if (j > 0) { arr.splice(j - 1, 0, arr.splice(j, 1)[0]); touch(); drawBlocks(); } };
      $('[data-id]', it).onclick = () => { if (j < arr.length - 1) { arr.splice(j + 1, 0, arr.splice(j, 1)[0]); touch(); drawBlocks(); } };
      $('[data-ix]', it).onclick = () => { arr.splice(j, 1); touch(); drawBlocks(); };
    });
    $('[data-iadd]', wrap).onclick = () => { const o = {}; f.sub.forEach(sf => { o[sf.k] = ''; }); arr.push(o); touch(); drawBlocks(); };
  });
  void top;
}
/* визуальный редактор текста: панель команд, вставка без чужого оформления */
function richBind(ed) {
  const bar = ed.previousElementSibling;
  $$('[data-cmd]', bar).forEach(btn => btn.onmousedown = (e) => {
    e.preventDefault(); ed.focus(); const c = btn.dataset.cmd;
    const sel = window.getSelection(), txt = sel ? String(sel) : '', range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const restore = () => { ed.focus(); if (range) { const s2 = window.getSelection(); s2.removeAllRanges(); s2.addRange(range); } };
    const done = () => ed.dispatchEvent(new Event('input'));
    if (['h2', 'h3', 'h4', 'p', 'blockquote', 'pre'].includes(c)) document.execCommand('formatBlock', false, c.toUpperCase());
    else if (c === 'link') { const u = prompt('Ссылка: /страница-сайта/ или https://…', '/'); if (u) document.execCommand('createLink', false, u); }
    else if (c === 'mark' || c === 'code') document.execCommand('insertHTML', false, `<${c}>${esc(txt || (c === 'code' ? 'код' : 'текст'))}</${c}>`);
    else if (c === 'contacts') document.execCommand('insertHTML', false, '<p>{{контакты}}</p>');
    else if (c === 'page') { pickPage((pg) => { restore(); document.execCommand('insertHTML', false, `<a href="${esc(pg.path)}">${esc(txt || pg.name || pg.title)}</a>`); done(); }); return; }
    else if (c === 'img') {
      const fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/png,image/jpeg,image/webp,image/gif';
      fi.onchange = async () => { const f = fi.files[0]; if (!f) return; try { const u = await upload(f), alt = prompt('Что на фото? (описание для поиска)', '') || ''; restore(); document.execCommand('insertHTML', false, `<img src="${esc(u)}" alt="${esc(alt)}">`); done(); toast('Фото вставлено'); } catch (er) { toast(er.message); } };
      fi.click(); return;
    }
    else document.execCommand(c, false, null);
    done();
  });
  ed.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
}
/* перелинковка: выбрать статью, услугу или страницу сайта */
async function pickPage(cb, multi) {
  if (!list.length) list = await api('/api/crm/cms');
  const d = document.createElement('div'); d.className = 'cms-modal';
  d.innerHTML = `<div class="cms-pal"><header class="row"><h2 style="margin:0;flex:1">Ссылка на страницу сайта</h2><input placeholder="Поиск" style="max-width:240px" data-q><button class="btn sm ghost" data-x>Закрыть</button></header><div class="plist"></div></div>`;
  document.body.appendChild(d);
  const draw = (q) => { $('.plist', d).innerHTML = list.filter(r => r.status === 'published' && r.path !== (cur && cur.path) && (!q || (r.title + ' ' + r.name + ' ' + r.path).toLowerCase().includes(q))).map(r => `<button type="button" data-p="${esc(r.path)}"><b>${esc(r.name || r.title)}</b><small>${KIND[r.kind]} · ${esc(r.path)}</small></button>`).join(''); $$('.plist button', d).forEach(b => b.onclick = () => { cb(list.find(r => r.path === b.dataset.p)); if (!multi) d.remove(); else b.disabled = true; }); };
  $('[data-q]', d).oninput = (e) => draw(e.target.value.toLowerCase()); $('[data-x]', d).onclick = () => d.remove(); d.onclick = (e) => { if (e.target === d) d.remove(); };
  draw('');
}
function palette(at) {
  const d = document.createElement('div'); d.className = 'cms-modal';
  d.innerHTML = `<div class="cms-pal"><header class="row"><h2 style="margin:0;flex:1">Добавить блок</h2><button class="btn sm ghost" data-x>Закрыть</button></header><div class="pal">${Object.entries(BLOCKS).map(([k, B]) => `<button type="button" data-t="${k}"><span class="bi">${B.i}</span><b>${esc(B.n)}</b><small>${esc(B.d)}</small></button>`).join('')}</div></div>`;
  document.body.appendChild(d);
  const close = () => d.remove();
  d.onclick = (e) => { if (e.target === d) close(); }; $('[data-x]', d).onclick = close;
  $$('[data-t]', d).forEach(b => b.onclick = () => { cur.blocks.splice(at, 0, Object.assign({ t: b.dataset.t }, JSON.parse(JSON.stringify(BLOCKS[b.dataset.t].def)))); close(); touch(); drawBlocks(); setTimeout(() => { const el = $(`.blk[data-i="${at}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50); });
}

/* ---------- сохранение и предпросмотр ---------- */
async function save() {
  const r = cur;
  if (!String(r.title || '').trim()) return toast('Заполните заголовок страницы');
  try {
    const out = await api('/api/crm/cms/page', { path: curPath, rec: Object.assign({}, r, { path: r.path }) }, 'PUT');
    cur = JSON.parse(JSON.stringify(out)); curPath = out.path; dirty = false; slugTouched = true;
    history.replaceState(null, '', '#cms:' + out.path);
    toast(out.status === 'published' ? 'Сохранено и опубликовано' : 'Черновик сохранён'); drawEditor();
  } catch (e) { toast(e.message); }
}
async function previewPage() {
  let html; try { html = (await api('/api/crm/cms/preview', { path: cur.path, rec: cur })).html; } catch (e) { return toast(e.message); }
  // страница рисуется внутри CRM в изолированном теневом DOM: без iframe, его блокируют встроенные просмотрщики
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let css = '';
  for (const el of Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]'))) {
    if (el.tagName === 'STYLE') { css += el.textContent; continue; }
    const href = el.getAttribute('href') || '';
    if (href.startsWith('/') && !/fonts\.css$/.test(href)) { try { css += await (await fetch(href)).text(); } catch (e) { /* нет файла */ } }
    else if (!/fonts\.css$/.test(href) && !document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }
  }
  css = css.replace(/:root/g, ':host').replace(/(^|[}\s,])body(?=[\s{,])/g, '$1.pv-body').replace(/@media\s*\((max|min)-width/g, '@container pv ($1-width');
  doc.querySelectorAll('script').forEach(x => x.remove());
  const d = document.createElement('div'); d.className = 'cms-modal';
  d.innerHTML = `<div class="cms-prev"><header class="row"><b style="flex:1">Предпросмотр: ${esc(cur.path)}</b><div class="tabs" style="margin:0"><button data-w="100%" aria-pressed="true">Компьютер</button><button data-w="390px" aria-pressed="false">Телефон</button></div><button class="btn sm ghost" data-x>Закрыть</button></header><div class="pv-wrap"><div class="pv-host"></div></div></div>`;
  document.body.appendChild(d);
  const host = $('.pv-host', d), root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}\n:host{display:block}.pv-body{container:pv / inline-size;margin:0;min-height:100%}</style><div class="pv-body">${doc.body.innerHTML}</div>`;
  root.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) { e.preventDefault(); toast('В предпросмотре ссылки не открываются: ' + (a.getAttribute('href') || '')); } });
  $$('[data-w]', d).forEach(b => b.onclick = () => { host.style.width = b.dataset.w; $$('[data-w]', d).forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
  $('[data-x]', d).onclick = () => d.remove(); d.onclick = (e) => { if (e.target === d) d.remove(); };
}

/* ---------- настройки сайта ---------- */
async function renderSite() {
  if (!(await leave())) return;
  const s = await api('/api/crm/cms/site');
  const fld = (k, n, ph) => `<label class="f">${n}<input name="${k}" value="${esc(s[k] || '')}" placeholder="${esc(ph || '')}"></label>`;
  main.innerHTML = `<div class="row"><button class="btn sm ghost" id="sBack">← Контент</button><h1 style="margin:0">Настройки сайта</h1></div>
  <form id="sForm"><div class="grid2"><div class="box"><h2 style="margin-top:0">Контакты — в подвале, на «Контактах» и в микроразметке</h2><div class="grid2">${fld('phone', 'Телефон', '+7 (342) 000-00-00')}${fld('email', 'Почта', 'info@…')}${fld('city', 'Город')}${fld('address', 'Адрес офиса')}${fld('hours', 'Часы работы', 'Пн–Пт 9:00–19:00')}${fld('legal', 'Юрлицо / ИП')}${fld('inn', 'ИНН')}</div>
    <label class="f">Текст в подвале<textarea name="footerNote" rows="2">${esc(s.footerNote || '')}</textarea></label></div>
  <div class="box"><h2 style="margin-top:0">Соцсети</h2><div class="grid2">${fld('vk', 'ВКонтакте', 'https://vk.com/…')}${fld('telegram', 'Telegram', 'https://t.me/…')}${fld('whatsapp', 'WhatsApp', 'https://wa.me/7…')}${fld('max', 'MAX', 'https://max.ru/…')}${fld('youtube', 'YouTube')}${fld('dzen', 'Дзен')}</div>
    <h2>Фото на главной</h2><div class="row" style="align-items:flex-end;gap:10px">${s.heroImage ? `<img src="${esc(s.heroImage)}" alt="" style="width:120px;aspect-ratio:4/3;object-fit:cover;border-radius:8px">` : '<span class="muted">Сейчас — рендер дома из конструктора</span>'}
      <input type="hidden" name="heroImage" value="${esc(s.heroImage || '')}"><button type="button" class="btn sm" id="sHero">Выбрать из медиатеки</button>${s.heroImage ? '<button type="button" class="btn sm ghost" id="sHeroX">Вернуть рендер</button>' : ''}</div>
    ${fld('heroAlt', 'Описание фото (alt) для поиска', 'Двухэтажный дом из газобетона')}<div class="muted">Горизонтальное фото 4:3, от 1200 px по ширине, с лицензией на коммерческое использование.</div>
    <h2>Поиск и аналитика</h2><div class="grid2">${fld('metrika', 'Яндекс Метрика — номер счётчика', '12345678')}${fld('yandexVerify', 'Яндекс Вебмастер — код подтверждения')}${fld('gsc', 'Google Search Console — код подтверждения')}</div>
    <div class="muted">Счётчик и коды подтверждения добавятся на все страницы сайта и в конструктор.</div></div></div>
  <button class="btn primary">Сохранить настройки</button></form>`;
  $('#sBack').onclick = () => renderList();
  const hero = (u) => { $('#sForm [name=heroImage]').value = u; $('#sForm').requestSubmit(); };
  $('#sHero').onclick = () => renderMedia((u) => hero(u));
  if ($('#sHeroX')) $('#sHeroX').onclick = () => hero('');
  $('#sForm').onsubmit = async (e) => { e.preventDefault(); const d = {}; $$('#sForm [name]').forEach(i => { d[i.name] = i.value; }); try { await api('/api/crm/cms/site', d, 'PUT'); toast('Настройки сохранены'); if (e.submitter == null) renderSite(); } catch (er) { toast(er.message); } };
}

/* ---------- медиатека ---------- */
async function renderMedia(pick) {
  const items = await api('/api/crm/media');
  const d = document.createElement('div'); d.className = 'cms-modal';
  d.innerHTML = `<div class="cms-pal"><header class="row"><h2 style="margin:0;flex:1">Медиатека${pick ? ' — выберите картинку' : ''}</h2><button class="btn sm primary" data-upl>Загрузить</button><button class="btn sm ghost" data-x>Закрыть</button><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/mp4,audio/ogg,video/mp4,video/webm" multiple hidden></header>
    <div class="media">${items.map(m => `<figure data-u="${esc(m.url)}">${/\.(mp3|m4a|ogg)$/.test(m.name) ? '<div class="mico">♪</div>' : /\.(mp4|webm)$/.test(m.name) ? '<div class="mico">▶</div>' : `<img src="${esc(m.url)}" alt="" loading="lazy">`}<figcaption><small>${esc(m.name)}</small><span><button type="button" class="btn sm ghost" data-copy>Ссылка</button><button type="button" class="btn sm ghost" data-rm>✕</button></span></figcaption></figure>`).join('') || '<p class="muted">Пока пусто — загрузите фото и схемы.</p>'}</div></div>`;
  document.body.appendChild(d);
  const close = () => d.remove(), file = $('input[type=file]', d);
  d.onclick = (e) => { if (e.target === d) close(); }; $('[data-x]', d).onclick = close;
  $('[data-upl]', d).onclick = () => file.click();
  file.onchange = async () => { for (const f of Array.from(file.files)) { try { await upload(f); } catch (e) { toast(e.message); } } close(); renderMedia(pick); };
  $$('figure', d).forEach(fg => {
    const u = fg.dataset.u;
    const pv = $('img, .mico', fg); pv.onclick = () => { if (pick) { pick(u); close(); } };
    $('[data-copy]', fg).onclick = async () => { try { await navigator.clipboard.writeText(u); toast('Ссылка скопирована: ' + u); } catch (e) { prompt('Ссылка на картинку', u); } };
    $('[data-rm]', fg).onclick = async () => { if (!confirm('Удалить картинку? На страницах, где она стоит, она пропадёт.')) return; await api('/api/crm/media/' + encodeURIComponent(u.split('/').pop()), null, 'DELETE'); close(); renderMedia(pick); };
  });
}

window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
window.DK = window.DK || {};
DK.CMS = {
  render(el, ctx) { main = el; api = ctx.api; toast = ctx.toast; me = ctx.me; const h = decodeURIComponent(location.hash); if (h.startsWith('#cms:')) edit(h.slice(5)); else renderList(); },
  leave, seo, BLOCKS,
};
})();
