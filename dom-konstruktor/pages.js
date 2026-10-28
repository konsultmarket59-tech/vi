/* Публичные страницы для поиска и нейросетей: услуги, блог, «О нас», контакты, политика и любые страницы из CMS.
   Сервер отдаёт готовый HTML (без JS) с микроразметкой schema.org (JSON-LD), хлебными крошками, canonical и Open Graph,
   а также sitemap.xml, robots.txt (поисковые и ИИ-боты разрешены) и llms.txt — краткое описание сайта для языковых моделей.
   Тексты и SEO правит маркетолог в CRM (раздел «Контент»), исходные — в content.js. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

module.exports = function pages(ctx) {
  const { send, PUBLIC_URL, ROOT, DATA } = ctx;
  const C = require('./content.js');
  // настройки бренда — те же, что у конструктора (js/config.js)
  const cfg = (() => { const sb = { window: {} }; sb.DK = sb.window.DK = {}; try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), sb); } catch (e) { /* по умолчанию */ } return sb.window.DK.CONFIG || { brand: 'Логика Дома', owner: {} }; })();
  const store = ctx.cms || require('./cms-store.js')(DATA, C, cfg);
  const BRAND = cfg.brand || 'Логика Дома';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = (req) => PUBLIC_URL || ('https://' + ((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || 'localhost'));
  const fmtDate = (d) => new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const pub = (r) => r.status === 'published';
  const day = (r) => String(r.updatedAt || C.UPDATED).slice(0, 10);

  /* разметка из редактора: только безопасные теги и атрибуты */
  const TAGS = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'br', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'figure', 'figcaption', 'span', 'code', 'pre', 'hr', 'sub', 'sup', 'mark', 'div']);
  const ATTR = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'target', 'rel', 'loading', 'width', 'height']);
  function clean(html) {
    return String(html || '').replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
        tag = tag.toLowerCase(); if (!TAGS.has(tag)) return '';
        if (m[1] === '/') return `</${tag}>`;
        const out = []; attrs.replace(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (q, n, _v, a, b, c) => {
          n = n.toLowerCase(); const v = a != null ? a : b != null ? b : c; if (!ATTR.has(n)) return q;
          if ((n === 'href' || n === 'src') && /^\s*(javascript|vbscript):/i.test(v)) return q;
          if (/^\s*data:/i.test(v) && !(n === 'src' && /^\s*data:image\/(png|jpe?g|webp|gif);/i.test(v))) return q;
          out.push(`${n}="${esc(v)}"`); return q;
        });
        return `<${tag}${out.length ? ' ' + out.join(' ') : ''}>`;
      });
  }
  const url = (u) => /^(https?:\/\/|\/|#|mailto:|tel:|data:(image\/(png|jpe?g|webp|gif)|audio\/|video\/))/i.test(String(u || '')) ? esc(u) : '#';
  function video(u) {
    u = String(u || ''); let m;
    if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/.exec(u))) return `https://www.youtube.com/embed/${m[1]}`;
    if ((m = /rutube\.ru\/video\/([\w]+)/.exec(u))) return `https://rutube.ru/play/embed/${m[1]}`;
    if ((m = /vk(?:video)?\.(?:com|ru)\/video(-?\d+)_(\d+)/.exec(u))) return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}`;
    return '';
  }

  /* ---------- иконки и логотип бренда «Логика Дома» ---------- */
  const ICONS = {};
  try { fs.readdirSync(path.join(ROOT, 'brand', 'icons')).filter(f => f.endsWith('.svg')).forEach(f => { const m = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(fs.readFileSync(path.join(ROOT, 'brand', 'icons', f), 'utf8')); if (m) ICONS[f.slice(0, -4)] = m[1].replace(/\s*\n\s*/g, ''); }); } catch (e) { /* без иконок */ }
  const ic = (n, s) => `<svg class="ic" width="${s || 20}" height="${s || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const LOGO = (h) => `<img src="/brand/logo-horizontal.svg" alt="${esc(BRAND)}" height="${h}" class="logo-img">`;
  // фон «сетка и узлы»: узел — точка Ø 10 на пересечении сетки 64 px
  const nodes = (list) => list.map(([x, y, c]) => `<i class="node" style="left:${x * 64 - 5}px;top:${y * 64 - 5}px;background:var(--ld-${c})"></i>`).join('');
  const SERVICE_ICON = { 'konstruktor-doma': 'layout-grid', 'podbor-stroitelnoj-kompanii': 'users', 'eskiznyj-proekt': 'file-text', 'raschet-stoimosti-doma': 'calculator', 'dlya-stroitelnyh-kompanij': 'building-2', 'dorabotka-eskiza-arhitektorom': 'compass' };
  const navA = (href, key, cur, t) => `<a href="${href}"${cur === key ? ' aria-current="page"' : ''}>${t}</a>`;
  const header = (cur) => `<header class="site-top"><div class="wrap">
  <a class="logo" href="/" aria-label="${esc(BRAND)} — на главную">${LOGO(38)}</a>
  <nav class="site-nav" aria-label="Разделы">${navA('/', 'app', cur, 'Конструктор')}${navA('/proekty/', 'proekty', cur, 'Проекты')}${navA('/#builders', 'builders', cur, 'Подрядчики')}${navA('/uslugi/', 'uslugi', cur, 'Услуги')}${navA('/blog/', 'blog', cur, 'Блог')}${navA('/o-nas/', 'o-nas', cur, 'О нас')}</nav>
  <details class="cab"><summary class="btn ghost sm">${ic('user', 16)}Личный кабинет</summary><div class="cab-menu"><a href="/#cab">Для клиентов</a><a href="/#company">Для строительных компаний</a><a href="/#cab">Для архитекторов</a><a href="/crm.html">Вход для сотрудников</a></div></details>
  <a class="btn primary sm" href="/#lead">Подобрать подрядчика</a>
</div></header>`;
  function footer() {
    const S = store.site(), extra = store.all().filter(r => r.custom && r.inMenu && pub(r));
    const soc = [['vk', 'ВКонтакте'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['max', 'MAX'], ['youtube', 'YouTube'], ['dzen', 'Дзен']].filter(([k]) => S[k]).map(([k, n]) => `<a href="${url(S[k])}" rel="noopener" target="_blank">${n}</a>`).join('');
    return `<footer class="site-foot"><div class="foot-grid">
  <div><a class="logo" href="/">${LOGO(32)}</a>
    <p>${esc(S.footerNote || '— технологичная платформа для выбора проектов, настройки и поиска проверенных подрядчиков.')}</p>${soc ? `<div class="soc">${soc}</div>` : ''}</div>
  <div><h4>Сервис</h4><a href="/">Конструктор дома</a><a href="/uslugi/podbor-stroitelnoj-kompanii/">Подбор подрядчика</a><a href="/uslugi/eskiznyj-proekt/">Эскизный проект</a><a href="/uslugi/raschet-stoimosti-doma/">Расчёт стоимости</a><a href="/proekty/">Каталог проектов</a></div>
  <div><h4>Компаниям</h4><a href="/uslugi/dlya-stroitelnyh-kompanij/">Заявки для подрядчиков</a><a href="/#company">Кабинет компании</a><a href="/#join">Регистрация исполнителя</a><a href="/#cab">Архитекторам</a></div>
  <div><h4>Информация</h4><a href="/blog/">Блог</a><a href="/o-nas/">О нас</a><a href="/dokumenty/">Документы</a><a href="/kontakty/">Контакты</a>${extra.map(r => `<a href="${r.path}">${esc(r.name || r.title)}</a>`).join('')}<a href="/politika/">Политика обработки данных</a></div>
  <div><h4>Контакты</h4>${S.phone ? `<a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a>` : ''}${S.email ? `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>` : ''}<span>${esc(S.city)}</span>${S.address ? `<span>${esc(S.address)}</span>` : ''}${S.hours ? `<span>${esc(S.hours)}</span>` : ''}</div>
</div><div class="foot-legal">© ${new Date().getFullYear()} ${esc(S.legal && S.legal !== BRAND ? S.legal + ' · ' + BRAND : BRAND)}${S.inn ? ', ИНН ' + esc(S.inn) : ''}. Расчёты на сайте — предварительные и не заменяют проект. Пролёты, котельная и отступы проверяются упрощённо.</div></footer>`;
  }

  /* ---------- микроразметка ---------- */
  function org(b) {
    const S = store.site(), o = { '@type': 'Organization', '@id': b + '/#org', name: BRAND, url: b + '/', logo: b + '/brand/icon-512.png', slogan: cfg.slogan, description: C.about.desc };
    if (S.phone) o.telephone = S.phone; if (S.email) o.email = S.email;
    if (S.address || S.city) o.address = { '@type': 'PostalAddress', addressLocality: S.city, streetAddress: S.address || undefined, addressCountry: 'RU' };
    const same = ['vk', 'telegram', 'youtube', 'dzen'].map(k => S[k]).filter(Boolean); if (same.length) o.sameAs = same;
    return o;
  }
  const crumbs = (b, items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: b + it[1] })) });
  const crumbHtml = (items) => `<nav class="crumbs" aria-label="Хлебные крошки">${items.map((it, i) => i < items.length - 1 ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`).join(ic('chevron-right', 14))}</nav>`;
  const faqsOf = (r) => (r.blocks || []).filter(b => b.t === 'faq').flatMap(b => b.items || []).filter(x => x.q && x.a);
  const faqLd = (r) => { const f = faqsOf(r); return f.length ? { '@type': 'FAQPage', mainEntity: f.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: String(x.a).replace(/<[^>]+>/g, '') } })) } : null; };
  const banner = (title, text, btn, href, btn2, href2) => `<aside class="cta-box"><div class="grid-bg">${nodes([[11, 1, 'cyan'], [14, 2, 'blue'], [16, 1, 'orange'], [13, 3, 'coral']])}</div><div class="cta-in"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}<div class="row">${btn ? `<a class="btn secondary" href="${url(href || '/')}">${esc(btn)}</a>` : ''}${btn2 ? `<a class="btn link-inv" href="${url(href2 || '/')}">${esc(btn2)} ${ic('arrow-right', 16)}</a>` : ''}</div></div></aside>`;
  const cta = banner('Найдите проект или создайте свой', 'Настройте планировку в конструкторе — оценка стоимости тёплого контура пересчитается автоматически.', 'Открыть конструктор', '/', 'Подобрать подрядчика', '/#lead');

  /* ---------- блоки ---------- */
  // {{контакты}}, {{телефон}}, {{почта}}, {{адрес}} в тексте — из настроек сайта
  function vars(html) {
    const S = store.site(), tel = S.phone ? `<a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a>` : '', mail = S.email ? `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>` : '';
    return html.replace(/<p>\s*\{\{контакты\}\}\s*<\/p>/g, () => contactsHtml()).replace(/\{\{контакты\}\}/g, () => contactsHtml())
      .replace(/\{\{телефон\}\}/g, tel).replace(/\{\{почта\}\}/g, mail).replace(/\{\{адрес\}\}/g, esc([S.city, S.address].filter(Boolean).join(', ')));
  }
  function contactsHtml(title) {
    const S = store.site();
    return `${title ? `<h2>${esc(title)}</h2>` : ''}<ul class="contacts">${S.phone ? `<li>Телефон: <a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a></li>` : ''}${S.email ? `<li>Почта: <a href="mailto:${esc(S.email)}">${esc(S.email)}</a></li>` : ''}<li>Город: ${esc(S.city)}</li>${S.address ? `<li>Адрес: ${esc(S.address)}</li>` : ''}${S.hours ? `<li>Часы работы: ${esc(S.hours)}</li>` : ''}<li>Заявка на подбор строителя: <a href="/#lead">форма на сайте</a></li></ul>`;
  }
  function block(b) {
    const h = (t) => t ? `<h2>${esc(t)}</h2>` : '';
    switch (b.t) {
      case 'text': return `<div class="b-text">${vars(clean(b.html))}</div>`;
      case 'audio': return b.src ? `<figure class="b-audio"><audio controls preload="none" src="${url(b.src)}"></audio>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
      case 'code': return b.code ? `<pre class="b-code"><code>${esc(b.code)}</code></pre>` : '';
      case 'links': { const it = (b.items || []).map(x => store.get(x.path)).filter(r => r && pub(r)); return it.length ? `${h(b.title || 'Читайте также')}<div class="cards">${it.map(r => `<a class="card" href="${r.path}"><h3>${esc(r.name || r.title)}</h3>${r.desc ? `<p>${esc(r.desc)}</p>` : ''}</a>`).join('')}</div>` : ''; }
      case 'hero': return `<section class="b-hero"${b.img ? ` style="--img:url('${url(b.img)}')"` : ''}><div><h2>${esc(b.title)}</h2>${b.text ? `<p>${esc(b.text)}</p>` : ''}${b.btn ? `<a class="btn secondary" href="${url(b.href || '/')}">${esc(b.btn)}</a>` : ''}</div></section>`;
      case 'image': return b.src ? `<figure class="b-img"><img src="${url(b.src)}" alt="${esc(b.alt)}" loading="lazy">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
      case 'gallery': return `<div class="b-gal">${(b.items || []).filter(x => x.src).map(x => `<figure><img src="${url(x.src)}" alt="${esc(x.alt)}" loading="lazy">${x.alt ? `<figcaption>${esc(x.alt)}</figcaption>` : ''}</figure>`).join('')}</div>`;
      case 'cards': return `${h(b.title)}<div class="cards">${(b.items || []).map(x => `<${x.href ? `a href="${url(x.href)}"` : 'div'} class="card">${x.title ? `<h3>${esc(x.title)}</h3>` : ''}${x.text ? `<p>${esc(x.text)}</p>` : ''}</${x.href ? 'a' : 'div'}>`).join('')}</div>`;
      case 'steps': return `${h(b.title)}<ol class="b-steps">${(b.items || []).map(x => `<li><b>${esc(x.title)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`).join('')}</ol>`;
      case 'faq': return (b.items || []).length ? `<section class="faq">${h(b.title || 'Частые вопросы')}${b.items.map(x => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}</section>` : '';
      case 'cta': return banner(b.title, b.text, b.btn, b.href, b.btn2, b.href2);
      case 'quote': return `<blockquote class="b-quote"><p>${esc(b.text)}</p>${b.author ? `<cite>${esc(b.author)}</cite>` : ''}</blockquote>`;
      case 'video': { if (b.file) return `<figure class="b-video"><video controls preload="metadata" src="${url(b.file)}"></video>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`; const v = video(b.url); return v ? `<figure class="b-video"><iframe src="${esc(v)}" title="${esc(b.caption || 'Видео')}" loading="lazy" allowfullscreen></iframe>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : ''; }
      case 'table': { const rows = String(b.rows || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(r => r.some(Boolean)); if (!rows.length) return '';
        return `${h(b.title)}<div class="b-table"><table><thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
      case 'columns': return `<div class="b-cols"><div>${vars(clean(b.left))}</div><div>${vars(clean(b.right))}</div></div>`;
      case 'button': return `<p class="b-btn"><a class="btn ${b.style === 'gold' ? 'primary' : 'secondary'}" href="${url(b.href || '/')}">${esc(b.text || 'Подробнее')}</a></p>`;
      case 'divider': return '<hr class="b-hr">';
      case 'contacts': return contactsHtml(b.title);
      case 'html': return String(b.code || '');
      case 'constructor': return cta;
      default: return '';
    }
  }
  const blocksHtml = (r) => (r.blocks || []).map(block).join('\n');
  // стандартный призыв — только если в странице нет своего
  const ctaOf = (r) => (r.blocks || []).some(b => b.t === 'cta' || b.t === 'constructor') ? '' : cta;
  const words = (r) => (r.lead + ' ' + (r.blocks || []).map(b => b.html || b.text || b.left || '').join(' ')).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

  /* ---------- страница ---------- */
  function page(req, r, o) {
    const b = base(req), canon = b + r.path, S = store.site();
    const title = r.seoTitle || `${r.title} — ${BRAND}`, desc = r.desc || r.lead || '';
    const og = r.ogImage || r.cover || '/img/og.png';
    const ld = { '@context': 'https://schema.org', '@graph': [org(b), { '@type': 'WebSite', '@id': b + '/#site', url: b + '/', name: BRAND, inLanguage: 'ru-RU', publisher: { '@id': b + '/#org' } }].concat(o.ld || [], [faqLd(r)]).filter(Boolean) };
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">${r.keywords ? `<meta name="keywords" content="${esc(r.keywords)}">` : ''}<link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="${r.kind === 'post' ? 'article' : 'website'}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:site_name" content="${esc(BRAND)}"><meta property="og:locale" content="ru_RU"><meta property="og:image" content="${esc(/^https?:/.test(og) ? og : b + og)}">
<meta name="twitter:card" content="summary_large_image"><meta name="robots" content="${r.noindex ? 'noindex, follow' : 'index, follow, max-snippet:-1, max-image-preview:large'}">
${S.yandexVerify ? `<meta name="yandex-verification" content="${esc(S.yandexVerify)}">` : ''}${S.gsc ? `<meta name="google-site-verification" content="${esc(S.gsc)}">` : ''}
<link rel="icon" href="/brand/favicon-32.png" type="image/png"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><meta name="theme-color" content="#19317B"><link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="stylesheet" href="/brand/ld.css">
<link rel="stylesheet" href="/css/pages.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>${metrika(S)}</head>
<body>${o.draft ? '<div class="draft-bar">Предпросмотр — страница ещё не опубликована</div>' : ''}${header(o.cur)}<main class="page${o.wide ? ' wide' : ''}">${o.hero || ''}<div class="wrap">${o.body}</div></main>${footer()}</body></html>`;
  }
  const metrika = (S) => /^\d{5,12}$/.test(String(S.metrika || '')) ? `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${S.metrika},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});</script>` : '';

  const list = (kind) => store.all().filter(r => r.kind === kind && pub(r));
  const posts = () => list('post').sort((a, c) => String(c.date || '').localeCompare(String(a.date || '')));
  /* hero: градиент белый → soft поверх сетки с узлами */
  const HERO_NODES = [[2, 1, 'cyan'], [9, 1, 'blue'], [5, 2, 'navy'], [1, 3, 'orange'], [12, 2, 'coral'], [16, 1, 'cool-gray'], [18, 3, 'cyan']];
  const hero = (items, title, lead) => `<section class="hero"><div class="grid-bg">${nodes(HERO_NODES)}</div><div class="wrap">${crumbHtml(items)}<h1>${esc(title)}</h1>${lead ? `<p class="sub">${esc(lead)}</p>` : ''}</div></section>`;
  const head = (items, r) => `${crumbHtml(items)}<h1>${esc(r.title)}</h1><span class="accent-line" aria-hidden="true"></span>${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}`;
  const more = (t) => `<span class="more">${t || 'Подробнее'} ${ic('arrow-right', 16)}</span>`;
  const postCard = (p) => `<a class="card post" href="${p.path}"><div class="thumb">${p.cover ? `<img src="${url(p.cover)}" alt="" loading="lazy">` : `<span class="thumb-grid">${ic('file-text', 28)}</span>`}</div><div class="card-body">${p.date ? `<time datetime="${esc(p.date)}">${fmtDate(p.date)}</time>` : ''}<h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p>${more('Читать')}</div></a>`;

  function render(req, r, draft) {
    const b = base(req);
    if (r.path === '/uslugi/') {
      const items = [['Главная', '/'], ['Услуги', '/uslugi/']], sv = list('service');
      return page(req, r, { cur: 'uslugi', draft, wide: true, hero: hero(items, r.title, r.lead), ld: [crumbs(b, items), { '@type': 'ItemList', itemListElement: sv.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: b + s.path, name: s.name || s.title })) }],
        body: `<div class="cards">${sv.map(s => `<a class="card svc" href="${s.path}"><span class="svc-ic">${ic(SERVICE_ICON[s.path.split('/')[2]] || 'house', 22)}</span><h3>${esc(s.name || s.title)}</h3><p>${esc(s.desc)}</p><div class="card-foot">${s.price ? `<span class="badge soft">${esc(s.price)}</span>` : '<span></span>'}${more()}</div></a>`).join('')}</div>${blocksHtml(r)}${ctaOf(r)}` });
    }
    if (r.path === '/blog/') {
      const items = [['Главная', '/'], ['Блог', '/blog/']], ps = posts();
      return page(req, r, { cur: 'blog', draft, wide: true, hero: hero(items, r.title, r.lead), ld: [crumbs(b, items), { '@type': 'Blog', name: `Блог ${BRAND}`, url: b + '/blog/', blogPost: ps.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: b + p.path, datePublished: p.date })) }],
        body: `<div class="cards">${ps.map(postCard).join('')}</div>${blocksHtml(r)}${ctaOf(r)}` });
    }
    if (r.kind === 'service') {
      const items = [['Главная', '/'], ['Услуги', '/uslugi/'], [r.name || r.title, r.path]];
      return page(req, r, { cur: 'uslugi', draft, ld: [crumbs(b, items), { '@type': 'Service', name: r.name || r.title, description: r.desc, provider: { '@id': b + '/#org' }, areaServed: { '@type': 'Country', name: 'Россия' }, offers: r.price ? { '@type': 'Offer', description: r.price } : undefined }],
        body: `<article class="article">${head(items, r)}${r.price ? `<p class="price-line">${ic('calculator', 16)}Стоимость: <b>${esc(r.price)}</b></p>` : ''}${blocksHtml(r)}</article>${ctaOf(r)}` });
    }
    if (r.kind === 'post') {
      const items = [['Главная', '/'], ['Блог', '/blog/'], [r.title, r.path]], others = posts().filter(q => q.path !== r.path).slice(0, 3);
      return page(req, r, { cur: 'blog', draft, ld: [crumbs(b, items), { '@type': 'BlogPosting', headline: r.title, description: r.desc, image: r.cover ? (/^https?:/.test(r.cover) ? r.cover : b + r.cover) : undefined, datePublished: r.date, dateModified: day(r), inLanguage: 'ru-RU', wordCount: words(r), keywords: r.keywords || undefined, mainEntityOfPage: b + r.path, author: { '@type': 'Organization', name: `Редакция ${BRAND}`, url: b + '/o-nas/' }, publisher: { '@id': b + '/#org' } }],
        body: `<article class="article">${crumbHtml(items)}${r.cover ? `<img class="cover" src="${url(r.cover)}" alt="${esc(r.title)}">` : ''}<h1>${esc(r.title)}</h1><p class="meta">Редакция ${esc(BRAND)}${r.date ? ` · <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time>` : ''} · обновлено <time datetime="${day(r)}">${fmtDate(day(r))}</time></p><span class="accent-line" aria-hidden="true"></span>
${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}${blocksHtml(r)}</article>${ctaOf(r)}
${others.length ? `<section class="more-sec"><h2>Читайте также</h2><div class="cards">${others.map(postCard).join('')}</div></section>` : ''}` });
    }
    // обычная страница: «О нас», контакты, политика и новые страницы из CMS
    const items = [['Главная', '/'], [r.name || r.title, r.path]];
    const kindLd = r.path === '/o-nas/' ? { '@type': 'AboutPage', name: r.title, url: b + r.path, about: { '@id': b + '/#org' } } : r.path === '/kontakty/' ? { '@type': 'ContactPage', url: b + r.path, about: { '@id': b + '/#org' } } : { '@type': 'WebPage', name: r.title, url: b + r.path, dateModified: day(r) };
    return page(req, r, { cur: r.path.replace(/\//g, ''), draft, ld: [crumbs(b, items), kindLd], body: `<article class="article">${head(items, r)}${blocksHtml(r)}</article>${r.path === '/politika/' ? '' : ctaOf(r)}` });
  }

  /* ---------- проекты пользователей: каталог и страница каждого проекта ---------- */
  function projects() {
    const dir = path.join(DATA, 'projects'); let a = [];
    try { a = fs.readdirSync(dir).map(id => { try { return JSON.parse(fs.readFileSync(path.join(dir, id, 'project.json'), 'utf8')); } catch (e) { return null; } }).filter(x => x && x.status === 'published'); } catch (e) { /* нет */ }
    // проверенные платформой и поднятые модератором — первыми
    return a.sort((x, y) => (verified(y) ? 2 : 0) + (y.boost ? 1 : 0) - (verified(x) ? 2 : 0) - (x.boost ? 1 : 0) || String(y.updatedAt || y.at).localeCompare(String(x.updatedAt || x.at)));
  }
  const verified = (pr) => !!(pr.verify && pr.verify.status === 'verified');
  const VERIFIED = `<span class="verified" title="Планировку проверили архитектор и инженер платформы и при необходимости исправили">${ic('badge-check', 16)}Проверено</span>`;
  const rating = (pr) => { const v = Object.values(pr.votes || {}); return { avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : 0, n: v.length }; };
  const cover = (pr) => { const f = (pr.files || []).find(x => x.startsWith('exterior')) || (pr.files || [])[0]; return f ? `/api/projects/${pr.id}/file/${f}` : ''; };
  const money = (v) => v ? Number(v).toLocaleString('ru-RU') + ' ₽' : 'бесплатно';
  const ownerName = (pr) => { try { const u = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'), 'utf8')).find(x => x.id === pr.owner); return u ? { name: u.name, arch: u.archStatus === 'verified' } : { name: 'Автор' }; } catch (e) { return { name: 'Автор' }; } };
  // сведения о планировке из модели: экспликация, преимущества, сводка — те же числа, что в конструкторе
  const facts = (pr) => { try { const M = ctx.model; if (!M || !pr.project) return null; const q = M.prep(pr.project); return { ex: M.DK.explication(q), perks: M.DK.planPerks(q), sum: M.DK.planSummary(q) }; } catch (e) { return null; } };
  function projSeo(pr) {
    const s = pr.seo || {}, fl = pr.floors > 1 ? `${pr.floors} этажа` : 'одноэтажный';
    return { title: s.title || `${pr.title} — проект дома ${Math.round(pr.area)} м², ${fl} — ${BRAND}`,
      desc: s.desc || `Проект дома ${Math.round(pr.area)} м², ${fl}${pr.size ? ', ' + pr.size : ''}. ${String(pr.about || '').slice(0, 90)} Планировки этажей и 3D, откройте в конструкторе.`.replace(/\s+/g, ' ').slice(0, 170),
      keywords: s.keywords || `проект дома ${Math.round(pr.area)} м2, планировка дома ${fl}`, noindex: !!s.noindex };
  }
  const spec = (i, t) => `<span>${ic(i, 14)}${t}</span>`;
  function projCard(p) {
    const rt = rating(p), c = cover(p), f = facts(p), beds = f ? (f.sum.find(x => /спал/.test(x.t)) || {}).n : null, baths = f ? (f.sum.find(x => /санузл/.test(x.t)) || {}).n : null;
    return `<a class="card proj" href="/proekty/${p.id}/"><div class="thumb">${c ? `<img src="${esc(c)}" alt="${esc(p.title)}" loading="lazy">` : ''}${p.boost ? '<span class="badge navy">Популярный</span>' : ''}</div>
<div class="card-body"><h3>${esc(p.title)}</h3>${verified(p) ? VERIFIED : ''}<div class="specs">${spec('ruler', DKfmt(p.area) + ' м²')}${beds ? spec('bed-double', beds) : ''}${baths ? spec('bath', baths) : ''}${spec('layers', p.floors + ' эт.')}</div>
${rt.n ? `<div class="rating"><b>${rt.avg.toFixed(1)}</b> <span class="stars">★</span> ${rt.n}</div>` : ''}<div class="price">${p.price ? `<small>эскиз </small>${Number(p.price).toLocaleString('ru-RU')} ₽` : '<small>эскиз </small>бесплатно'}</div>${more()}</div></a>`;
  }
  function projectsList(req, r) {
    const b = base(req), items = [['Главная', '/'], [r.name || r.title, r.path]], ps = projects();
    return page(req, r, { cur: 'proekty', wide: true, hero: hero(items, r.title, r.lead), ld: [crumbs(b, items), { '@type': 'ItemList', itemListElement: ps.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: b + '/proekty/' + p.id + '/', name: p.title })) }],
      body: `<div class="list-head"><span>Найдено ${ps.length} ${ps.length % 10 === 1 && ps.length % 100 !== 11 ? 'проект' : ps.length % 10 >= 2 && ps.length % 10 <= 4 && (ps.length % 100 < 10 || ps.length % 100 >= 20) ? 'проекта' : 'проектов'}</span><span class="muted">${ic('badge-check', 14)} «Проверено» — планировку проверили архитектор и инженер платформы</span></div>
<div class="cards">${ps.map(projCard).join('') || '<p class="empty">Проектов пока нет. Опубликуйте первый из конструктора.</p>'}</div>${blocksHtml(r)}${ctaOf(r)}` });
  }
  function projectPage(req, pr) {
    const b = base(req), S = projSeo(pr), rt = rating(pr), au = ownerName(pr), items = [['Главная', '/'], ['Проекты домов', '/proekty/'], [pr.title, '/proekty/' + pr.id + '/']], f = facts(pr);
    const imgs = (pr.files || []).map(fn => `/api/projects/${pr.id}/file/${fn}`);
    const r = { path: '/proekty/' + pr.id + '/', kind: 'project', title: pr.title, seoTitle: S.title, desc: S.desc, keywords: S.keywords, noindex: S.noindex, ogImage: imgs[0] || '', blocks: [], updatedAt: pr.updatedAt || pr.at };
    const prod = { '@type': 'Product', name: pr.title, description: S.desc, image: imgs.map(u => b + u), category: 'Проект частного дома', brand: { '@type': 'Brand', name: BRAND },
      offers: { '@type': 'Offer', price: String(pr.price || 0), priceCurrency: 'RUB', availability: 'https://schema.org/InStock', url: b + r.path },
      additionalProperty: [{ '@type': 'PropertyValue', name: 'Площадь', value: Math.round(pr.area * 10) / 10, unitText: 'м²' }, { '@type': 'PropertyValue', name: 'Этажей', value: pr.floors }].concat(verified(pr) ? [{ '@type': 'PropertyValue', name: 'Проверено архитектором и инженером', value: 'да' }] : []) };
    if (rt.n) prod.aggregateRating = { '@type': 'AggregateRating', ratingValue: rt.avg, ratingCount: rt.n, bestRating: 5 };
    const tile = (i, cap, val) => `<div class="tile">${ic(i, 20)}<small>${cap}</small><b>${val}</b></div>`;
    const ex = f ? `<div class="explication"><h3>Экспликация помещений</h3>${f.ex.groups.map(g => `<div class="ex-g">${esc(g.title)}</div>${g.rooms.map(rm => `<div class="ex-r"><span class="ex-n${rm.wet ? ' wet' : ''}">${rm.n}</span>${ic(rm.icon, 14)}<span>${esc(rm.name)}</span><span class="ex-a">${DKfmt(rm.area)}</span></div>`).join('')}`).join('')}<div class="ex-t"><span>Всего помещений</span><span>${DKfmt(f.ex.total)} м²</span></div></div>` : '';
    const perks = f && f.perks.length ? `<section class="perks"><h2>Преимущества планировки</h2><div class="perk-grid">${f.perks.map(k => `<div class="perk"><span class="perk-ic">${ic(k.icon, 22)}</span><b>${esc(k.title)}</b><small>${esc(k.text)}</small></div>`).join('')}</div></section>` : '';
    return page(req, r, { cur: 'proekty', wide: true, ld: [crumbs(b, items), prod],
      body: `${crumbHtml(items)}<div class="proj-head"><h1>${esc(pr.title)}</h1>${verified(pr) ? VERIFIED : ''}${pr.boost ? '<span class="badge navy">Популярный</span>' : ''}</div>
<p class="meta">${esc(au.name)}${au.arch ? ' · архитектор' : ''}${rt.n ? ` · <b>${rt.avg.toFixed(1)}</b> <span class="stars">★</span> ${rt.n} ${rt.n % 10 === 1 && rt.n % 100 !== 11 ? 'оценка' : 'оценок'}` : ''}</p>
<div class="proj-grid"><div class="proj-main">
${imgs.length ? `<figure class="proj-hero"><img src="${esc(imgs[0])}" alt="${esc(pr.title)} — ${imgs[0].includes('exterior') ? 'вид снаружи' : 'план этажа'}"></figure>${imgs.length > 1 ? `<div class="proj-thumbs">${imgs.slice(1).map((u, i) => `<a href="${esc(u)}"><img src="${esc(u)}" alt="${esc(pr.title)} — план ${i + 1} этажа" loading="lazy"></a>`).join('')}</div>` : ''}` : ''}
<div class="tiles">${tile('ruler', 'Площадь помещений', DKfmt(pr.area) + ' м²')}${tile('layers', 'Этажей', pr.floors)}${f && f.sum[0] ? tile('bed-double', f.sum[0].t[0].toUpperCase() + f.sum[0].t.slice(1), f.sum[0].n) : ''}${pr.size ? tile('maximize', 'Габариты', esc(pr.size)) : ''}</div>
${perks}${pr.about ? `<section><h2>О проекте</h2><p class="about">${esc(pr.about)}</p></section>` : ''}</div>
<aside class="proj-side">${verified(pr) ? `<div class="vbox">${ic('badge-check', 20)}<div><b>Проверено платформой</b><small>Архитектор и инженер «Логики Дома» проверили планировку и при необходимости исправили</small></div></div>` : ''}
<div class="price-box"><small>Эскизный проект</small><b>${pr.price ? Number(pr.price).toLocaleString('ru-RU') + ' ₽' : 'бесплатно'}</b><span class="muted">${pr.license === 'build' ? 'Право построить один дом по эскизу' : 'Эскиз для ознакомления и доработки'}</span></div>
<a class="btn primary lg full" href="/#project=${esc(pr.id)}">Открыть в конструкторе</a><a class="btn secondary full" href="/#lead">Подобрать подрядчика</a>${ex}</aside></div>
<section class="more-sec"><h2>Другие проекты</h2><div class="cards">${projects().filter(x => x.id !== pr.id).slice(0, 3).map(projCard).join('')}</div></section>` });
  }
  const DKfmt = (v) => (Math.round((+v || 0) * 10) / 10).toFixed(1).replace('.', ',');

  /* главная — SPA конструктора: подставляем SEO из CMS */
  function home(req) {
    const r = store.get('/'), S = store.site();
    let h = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    if (r) {
      const t = esc(r.seoTitle || r.title), d = esc(r.desc);
      h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`).replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
        .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`).replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`);
      if (r.keywords) h = h.replace('</title>', `</title><meta name="keywords" content="${esc(r.keywords)}">`);
      if (r.ogImage) h = h.replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(/^https?:/.test(r.ogImage) ? r.ogImage : base(req) + r.ogImage)}$2`);
      if (r.noindex) h = h.replace('</title>', '</title><meta name="robots" content="noindex, follow">');
    }
    // фото на главной — из настроек сайта (медиатека CRM), иначе рендер из конструктора
    if (/^\/media\/[\w.-]+\.(jpe?g|png|webp)$/.test(S.heroImage || '')) h = h.replace('</head>', `<script>window.__HERO=${JSON.stringify({ src: S.heroImage, alt: S.heroAlt || '' }).replace(/</g, '\\u003c')}</script></head>`);
    const extra = (S.yandexVerify ? `<meta name="yandex-verification" content="${esc(S.yandexVerify)}">` : '') + (S.gsc ? `<meta name="google-site-verification" content="${esc(S.gsc)}">` : '') + metrika(S);
    if (extra) h = h.replace('</head>', extra + '</head>');
    return h;
  }

  function sitemap(req) {
    const b = base(req), u = (loc, d, pr) => `<url><loc>${b}${loc}</loc><lastmod>${d}</lastmod><priority>${pr}</priority></url>`;
    const pr = { home: '1.0', list: '0.9', service: '0.9', post: '0.8', page: '0.6' };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      store.all().filter(r => pub(r) && !r.noindex).map(r => u(r.path, r.kind === 'post' && !r.edited ? r.date : day(r), r.path === '/politika/' ? '0.3' : pr[r.kind] || '0.6')).join('') +
      projects().filter(x => !projSeo(x).noindex).map(x => u('/proekty/' + x.id + '/', String(x.updatedAt || x.at).slice(0, 10), x.boost ? '0.8' : '0.7')).join('') + `</urlset>`;
  }
  const robots = (req) => `# Поисковые системы и ИИ-ассистенты приглашены: открыт весь публичный контент\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin.html\nDisallow: /crm.html\n\n` +
    ['Yandex', 'Googlebot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'YandexAdditional', 'GigaBot'].map(a => `User-agent: ${a}\nAllow: /\nDisallow: /api/\n`).join('\n') +
    `\nSitemap: ${base(req)}/sitemap.xml\nHost: ${base(req).replace(/^https?:\/\//, '')}\n`;
  const plain = (r) => (r.blocks || []).map(b => b.t === 'faq' ? (b.items || []).map(x => `**${x.q}** ${x.a}`).join('\n') : b.t === 'table' ? String(b.rows || '') : String(b.html || b.text || b.left || '') + ' ' + String(b.right || '')).join('\n').replace(/<\/(p|h2|h3|li|tr)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
  function llms(req, full) {
    const b = base(req), S = store.site(), A = store.all().filter(r => pub(r) && !r.noindex);
    let t = `# ${BRAND}\n\n> ${C.about.lead}\n\nКонструктор: ${b}/ — бесплатный онлайн-планировщик частного дома (этажи, мансарда, несущие стены по пролётам плит, котельная по СП 402.1325800.2018, 3D, фасад, участок любой формы с отступами по СП 53.13330, вилка стоимости тёплого контура, экспорт IFC для ArchiCAD).\n\n## Услуги\n` +
      A.filter(r => r.kind === 'service').map(s => `- [${s.name || s.title}](${b}${s.path}): ${s.lead || s.desc}`).join('\n') + `\n\n## Статьи\n` + A.filter(r => r.kind === 'post').map(p => `- [${p.title}](${b}${p.path}): ${p.lead || p.desc}`).join('\n') +
      (A.some(r => r.kind === 'page' && r.custom) ? `\n\n## Страницы\n` + A.filter(r => r.kind === 'page' && r.custom).map(p => `- [${p.title}](${b}${p.path}): ${p.lead || p.desc}`).join('\n') : '') +
      `\n\n## Ключевые факты\n- Предварительная стоимость тёплого контура двухэтажного дома из газобетона 150–200 м² в регионах России осенью 2026 года — около 42–55 тыс. ₽/м².\n- Горячий лид для строительной компании стоит 2 % от стоимости домовладения.\n- Отступы: дом — 3 м до соседей и 5 м до улицы; баня — 1 м до забора и 8 м до дома.\n\n## Контакты\n${S.phone ? '- Телефон: ' + S.phone + '\n' : ''}${S.email ? '- Почта: ' + S.email + '\n' : ''}- Город: ${S.city}\n- О проекте: ${b}/o-nas/\n`;
    if (full) t += '\n\n' + A.filter(r => r.kind !== 'home' && r.kind !== 'list').map(p => `## ${p.title}\n\n${p.lead || ''}\n\n${plain(p)}`).join('\n\n');
    return t;
  }

  function handle(req, res, u) {
    const p = u.pathname, html = (s) => send(res, 200, s, 'text/html; charset=utf-8'), txt = (s, t) => send(res, 200, s, t || 'text/plain; charset=utf-8');
    if (p === '/' || p === '/index.html') { html(home(req)); return true; }
    if (p === '/sitemap.xml') { txt(sitemap(req), 'application/xml; charset=utf-8'); return true; }
    if (p === '/robots.txt') { txt(robots(req)); return true; }
    if (p === '/llms.txt') { txt(llms(req, false)); return true; }
    if (p === '/llms-full.txt') { txt(llms(req, true)); return true; }
    const mm = /^\/media\/([\w-]+\.(png|jpe?g|webp|gif|mp3|m4a|ogg|mp4|webm))$/.exec(p);
    if (mm) {
      const f = path.join(DATA, 'media', mm[1]); if (!fs.existsSync(f)) return false;
      const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm' }[mm[2]];
      const size = fs.statSync(f).size, rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      // перемотка аудио и видео: ответ по диапазону байтов
      if (rg) { const a = rg[1] ? +rg[1] : Math.max(0, size - +rg[2]), z = rg[1] && rg[2] ? Math.min(+rg[2], size - 1) : size - 1;
        if (a >= size || a > z) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return true; }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': z - a + 1, 'Cache-Control': 'public, max-age=604800' }); fs.createReadStream(f, { start: a, end: z }).pipe(res); return true; }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=604800' }); fs.createReadStream(f).pipe(res); return true;
    }
    const pm = /^\/proekty\/([\w-]+)\/?$/.exec(p);
    if (pm) { const pr = projects().find(x => x.id === pm[1]); if (!pr) return false; if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); res.end(); return true; } html(projectPage(req, pr)); return true; }
    if (/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p) && store.get(p + '/')) { res.writeHead(301, { Location: p + '/' }); res.end(); return true; }
    const r = /\/$/.test(p) && p !== '/' ? store.get(p) : null;
    if (r && pub(r)) { html(r.path === '/proekty/' ? projectsList(req, r) : render(req, r)); return true; }
    return false;
  }
  handle.preview = (req, r) => r.path === '/proekty/' ? projectsList(req, Object.assign({ blocks: [] }, r)) : render(req, Object.assign({ blocks: [], status: 'draft' }, r), r.status !== 'published');
  handle.projectPage = projectPage; handle.projects = projects;
  handle.store = store;
  return handle;
};
