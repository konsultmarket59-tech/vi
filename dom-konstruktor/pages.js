/* Публичные страницы для поиска и нейросетей: услуги, блог, «О нас», контакты, политика.
   Сервер отдаёт готовый HTML (без JS) с микроразметкой schema.org (JSON-LD), хлебными крошками, canonical и Open Graph,
   а также sitemap.xml, robots.txt (поисковые и ИИ-боты разрешены) и llms.txt — краткое описание сайта для языковых моделей. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

module.exports = function pages(ctx) {
  const { send, PUBLIC_URL, ROOT } = ctx;
  const C = require('./content.js');
  // настройки бренда и контакты — те же, что у конструктора (js/config.js)
  const cfg = (() => { const sb = { window: {} }; sb.DK = sb.window.DK = {}; try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), sb); } catch (e) { /* по умолчанию */ } return sb.window.DK.CONFIG || { brand: 'Свой Дом', owner: {} }; })();
  const BRAND = cfg.brand || 'Свой Дом', OWNER = cfg.owner || {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const base = (req) => PUBLIC_URL || ('https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost'));
  const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const LOGO = `<svg class="logo-mark" viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#2F3237"/><path d="M10 24.5 24 12l14 12.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 22v14h19V22" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><rect x="21" y="27" width="6" height="9" rx="1" fill="#E3A21A"/></svg>`;
  const header = (cur) => `<header class="site-top">
  <a class="logo" href="/" aria-label="${esc(BRAND)} — на главную">${LOGO}<span class="logo-word"><b>${esc(BRAND.toUpperCase())}</b><small>конструктор и подбор строителя</small></span></a>
  <nav class="site-nav" aria-label="Разделы">
    <a href="/"${cur === 'app' ? ' aria-current="page"' : ''}>Конструктор</a><a href="/#projects">Проекты</a><a href="/#builders">Строители</a>
    <a href="/uslugi/"${cur === 'uslugi' ? ' aria-current="page"' : ''}>Услуги</a><a href="/blog/"${cur === 'blog' ? ' aria-current="page"' : ''}>Блог</a><a href="/o-nas/"${cur === 'o-nas' ? ' aria-current="page"' : ''}>О нас</a>
  </nav>
  <a class="btn gold" href="/#lead">Подобрать строителя</a>
  <details class="cab"><summary class="btn">Личный кабинет</summary><div class="cab-menu"><a href="/#cab">Для клиентов</a><a href="/#company">Для строительных компаний</a><a href="/#cab">Для архитекторов</a><a href="/crm.html">Вход для сотрудников</a></div></details>
</header>`;
  const footer = () => `<footer class="site-foot"><div class="foot-grid">
  <div><a class="logo" href="/">${LOGO}<span class="logo-word"><b>${esc(BRAND.toUpperCase())}</b><small>конструктор и подбор строителя</small></span></a>
    <p>Онлайн-конструктор частного дома, предварительная смета и подбор строительной компании.</p></div>
  <div><h4>Сервис</h4><a href="/">Конструктор дома</a><a href="/uslugi/podbor-stroitelnoj-kompanii/">Подбор строителя</a><a href="/uslugi/eskiznyj-proekt/">Эскизный проект</a><a href="/uslugi/raschet-stoimosti-doma/">Расчёт стоимости</a><a href="/#projects">Каталог проектов</a></div>
  <div><h4>Компаниям</h4><a href="/uslugi/dlya-stroitelnyh-kompanij/">Заявки для строителей</a><a href="/#company">Кабинет компании</a><a href="/#join">Регистрация исполнителя</a><a href="/#cab">Архитекторам</a></div>
  <div><h4>Информация</h4><a href="/blog/">Блог</a><a href="/o-nas/">О нас</a><a href="/kontakty/">Контакты</a><a href="/politika/">Политика обработки данных</a></div>
  <div><h4>Контакты</h4>${OWNER.phone ? `<a href="tel:${esc(OWNER.phone.replace(/[^\d+]/g, ''))}">${esc(OWNER.phone)}</a>` : ''}${OWNER.email ? `<a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a>` : ''}<span>${esc(OWNER.city || 'Пермь, работаем по России')}</span></div>
</div><div class="foot-legal">© ${new Date().getFullYear()} ${esc(BRAND)}. Расчёты на сайте — предварительные и не заменяют проект. Пролёты, котельная и отступы проверяются упрощённо.</div></footer>`;

  function org(b) {
    const o = { '@type': 'Organization', '@id': b + '/#org', name: BRAND, url: b + '/', logo: b + '/favicon.svg', description: C.about.desc };
    if (OWNER.phone) o.telephone = OWNER.phone; if (OWNER.email) o.email = OWNER.email;
    return o;
  }
  function crumbs(b, items) {
    return { '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: b + it[1] })) };
  }
  const faqLd = (faq) => faq && faq.length ? { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) } : null;
  const faqHtml = (faq) => faq && faq.length ? `<section class="faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>` : '';
  const crumbHtml = (items) => `<nav class="crumbs" aria-label="Хлебные крошки">${items.map((it, i) => i < items.length - 1 ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`).join(' / ')}</nav>`;
  const cta = `<aside class="cta-box"><h3>Спланируйте свой дом бесплатно</h3><p>Этажи и мансарда, 3D-прогулка, участок по нормам и вилка стоимости тёплого контура — за вечер.</p><div><a class="btn gold" href="/">Открыть конструктор</a> <a class="btn" href="/#lead">Подобрать строителя</a></div></aside>`;

  function page(req, o) {
    const b = base(req), canon = b + o.path;
    const ld = { '@context': 'https://schema.org', '@graph': [org(b), { '@type': 'WebSite', '@id': b + '/#site', url: b + '/', name: BRAND, inLanguage: 'ru-RU', publisher: { '@id': b + '/#org' } }].concat(o.ld || []).filter(Boolean) };
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}"><link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="${o.ogType || 'website'}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:site_name" content="${esc(BRAND)}"><meta property="og:locale" content="ru_RU"><meta property="og:image" content="${esc(b)}/img/og.png">
<meta name="twitter:card" content="summary_large_image"><meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alumni+Sans:wght@700;800&family=Raleway:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/css/pages.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head>
<body>${header(o.cur)}<main class="page">${o.body}</main>${footer()}</body></html>`;
  }

  function servicesList(req) {
    const b = base(req), items = [['Главная', '/'], ['Услуги', '/uslugi/']];
    return page(req, { path: '/uslugi/', cur: 'uslugi', title: `Услуги — ${BRAND}`, desc: 'Конструктор дома, подбор строительной компании, эскизный проект, расчёт стоимости и заявки для строителей.',
      ld: [crumbs(b, items), { '@type': 'ItemList', itemListElement: C.services.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: b + '/uslugi/' + s.slug + '/', name: s.title })) }],
      body: `${crumbHtml(items)}<h1>Услуги</h1><p class="lead">Всё для планирования частного дома и выбора строителя — от бесплатного конструктора до сравнения смет.</p>
<div class="cards">${C.services.map(s => `<a class="card" href="/uslugi/${s.slug}/"><h2>${esc(s.title)}</h2><p>${esc(s.desc)}</p><span class="price">${esc(s.price)}</span></a>`).join('')}</div>${cta}` });
  }
  function service(req, s) {
    const b = base(req), items = [['Главная', '/'], ['Услуги', '/uslugi/'], [s.title, '/uslugi/' + s.slug + '/']];
    return page(req, { path: '/uslugi/' + s.slug + '/', cur: 'uslugi', title: `${s.title} — ${BRAND}`, desc: s.desc,
      ld: [crumbs(b, items), { '@type': 'Service', name: s.title, description: s.desc, provider: { '@id': b + '/#org' }, areaServed: { '@type': 'Country', name: 'Россия' }, offers: { '@type': 'Offer', description: s.price } }, faqLd(s.faq)],
      body: `${crumbHtml(items)}<article><h1>${esc(s.h1)}</h1><p class="lead">${esc(s.lead)}</p><p class="price-line">Стоимость: <b>${esc(s.price)}</b></p>${s.html}${faqHtml(s.faq)}</article>${cta}` });
  }
  function blogList(req) {
    const b = base(req), items = [['Главная', '/'], ['Блог', '/blog/']];
    const ps = C.posts.slice().sort((a, c) => c.date.localeCompare(a.date));
    return page(req, { path: '/blog/', cur: 'blog', title: `Блог о строительстве частного дома — ${BRAND}`, desc: 'Статьи о строительстве частного дома: цены 2026 года, тёплый контур, мансарда, отступы на участке, котельная, выбор строителя.',
      ld: [crumbs(b, items), { '@type': 'Blog', name: `Блог ${BRAND}`, url: b + '/blog/', blogPost: ps.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: b + '/blog/' + p.slug + '/', datePublished: p.date })) }],
      body: `${crumbHtml(items)}<h1>Блог о строительстве дома</h1><p class="lead">Разбираем цены, нормы и решения, которые помогают построить дом без переплат.</p>
<div class="cards">${ps.map(p => `<a class="card" href="/blog/${p.slug}/"><time datetime="${p.date}">${fmtDate(p.date)}</time><h2>${esc(p.title)}</h2><p>${esc(p.desc)}</p></a>`).join('')}</div>${cta}` });
  }
  function post(req, p) {
    const b = base(req), items = [['Главная', '/'], ['Блог', '/blog/'], [p.title, '/blog/' + p.slug + '/']];
    const others = C.posts.filter(q => q !== p).slice(0, 3);
    return page(req, { path: '/blog/' + p.slug + '/', cur: 'blog', ogType: 'article', title: `${p.title} — ${BRAND}`, desc: p.desc,
      ld: [crumbs(b, items), { '@type': 'BlogPosting', headline: p.title, description: p.desc, datePublished: p.date, dateModified: C.UPDATED, inLanguage: 'ru-RU', mainEntityOfPage: b + '/blog/' + p.slug + '/', author: { '@type': 'Organization', name: `Редакция ${BRAND}`, url: b + '/o-nas/' }, publisher: { '@id': b + '/#org' } }, faqLd(p.faq)],
      body: `${crumbHtml(items)}<article><h1>${esc(p.title)}</h1><p class="meta">Редакция ${esc(BRAND)} · <time datetime="${p.date}">${fmtDate(p.date)}</time> · обновлено <time datetime="${C.UPDATED}">${fmtDate(C.UPDATED)}</time></p>
<p class="lead">${esc(p.lead)}</p>${p.html}${faqHtml(p.faq)}</article>${cta}
<section class="more"><h2>Читайте также</h2><div class="cards">${others.map(q => `<a class="card" href="/blog/${q.slug}/"><h3>${esc(q.title)}</h3></a>`).join('')}</div></section>` });
  }
  function aboutPage(req) {
    const b = base(req), items = [['Главная', '/'], ['О нас', '/o-nas/']];
    return page(req, { path: '/o-nas/', cur: 'o-nas', title: `${C.about.title}`, desc: C.about.desc,
      ld: [crumbs(b, items), { '@type': 'AboutPage', name: C.about.title, url: b + '/o-nas/', about: { '@id': b + '/#org' } }],
      body: `${crumbHtml(items)}<article><h1>${esc(C.about.title)}</h1><p class="lead">${esc(C.about.lead)}</p>${C.about.html}<h2>Контакты</h2>${contactsHtml()}</article>${cta}` });
  }
  const contactsHtml = () => `<ul class="contacts">${OWNER.phone ? `<li>Телефон: <a href="tel:${esc(OWNER.phone.replace(/[^\d+]/g, ''))}">${esc(OWNER.phone)}</a></li>` : ''}${OWNER.email ? `<li>Почта: <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a></li>` : ''}<li>Город: ${esc(OWNER.city || 'Пермь, работаем по России')}</li><li>Заявка на подбор строителя: <a href="/#lead">форма на сайте</a></li></ul>`;
  function contacts(req) {
    const b = base(req), items = [['Главная', '/'], ['Контакты', '/kontakty/']];
    return page(req, { path: '/kontakty/', title: `Контакты — ${BRAND}`, desc: `Контакты сервиса ${BRAND}: телефон, почта, заявка на подбор строительной компании.`,
      ld: [crumbs(b, items), { '@type': 'ContactPage', url: b + '/kontakty/', about: { '@id': b + '/#org' } }], body: `${crumbHtml(items)}<article><h1>Контакты</h1>${contactsHtml()}</article>${cta}` });
  }
  function policy(req) {
    const b = base(req), items = [['Главная', '/'], ['Политика обработки данных', '/politika/']];
    return page(req, { path: '/politika/', title: `Политика обработки персональных данных — ${BRAND}`, desc: 'Политика обработки персональных данных пользователей сайта в соответствии с 152-ФЗ.',
      ld: [crumbs(b, items)], body: `${crumbHtml(items)}<article><h1>Политика обработки персональных данных</h1>
<p>Оператор — ${esc(OWNER.name || BRAND)}. Мы обрабатываем имя, телефон, почту, город и сведения о проекте дома, которые вы указываете в заявке, только для подбора строительной компании и связи с вами (ст. 6 152-ФЗ).</p>
<p>Контакты передаются строительным компаниям только с вашего согласия. Данные хранятся на серверах в России, срок хранения — до отзыва согласия. Отозвать согласие можно письмом на ${OWNER.email ? esc(OWNER.email) : 'почту оператора'}.</p>
<p>Сайт использует локальное хранилище браузера, чтобы сохранять ваш проект; файлы cookie для рекламы не применяются.</p></article>` });
  }

  function sitemap(req) {
    const b = base(req), u = (loc, d, pr) => `<url><loc>${b}${loc}</loc><lastmod>${d || C.UPDATED}</lastmod><priority>${pr || '0.7'}</priority></url>`;
    let projects = [];
    try { const dir = path.join(ctx.DATA, 'projects'); projects = fs.readdirSync(dir).map(id => { try { return JSON.parse(fs.readFileSync(path.join(dir, id, 'project.json'), 'utf8')); } catch (e) { return null; } }).filter(pp => pp && pp.status === 'published'); } catch (e) { /* нет проектов */ }
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` + [u('/', C.UPDATED, '1.0'), u('/uslugi/', 0, '0.9')]
      .concat(C.services.map(s => u('/uslugi/' + s.slug + '/', 0, '0.9')), [u('/blog/', 0, '0.8')], C.posts.map(p => u('/blog/' + p.slug + '/', p.date, '0.8')), [u('/o-nas/', 0, '0.6'), u('/kontakty/', 0, '0.5'), u('/politika/', 0, '0.3')])
      .join('') + `</urlset>`;
  }
  const robots = (req) => `# Поисковые системы и ИИ-ассистенты приглашены: открыт весь публичный контент\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin.html\nDisallow: /crm.html\n\n` +
    ['Yandex', 'Googlebot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'YandexAdditional', 'GigaBot'].map(a => `User-agent: ${a}\nAllow: /\nDisallow: /api/\n`).join('\n') +
    `\nSitemap: ${base(req)}/sitemap.xml\nHost: ${base(req).replace(/^https?:\/\//, '')}\n`;
  function llms(req, full) {
    const b = base(req);
    let t = `# ${BRAND}\n\n> ${C.about.lead}\n\nКонструктор: ${b}/ — бесплатный онлайн-планировщик частного дома (этажи, мансарда, несущие стены по пролётам плит, котельная по СП 402.1325800.2018, 3D, фасад, участок с отступами по СП 53.13330, вилка стоимости тёплого контура).\n\n## Услуги\n` +
      C.services.map(s => `- [${s.title}](${b}/uslugi/${s.slug}/): ${s.lead}`).join('\n') + `\n\n## Статьи\n` + C.posts.map(p => `- [${p.title}](${b}/blog/${p.slug}/): ${p.lead}`).join('\n') +
      `\n\n## Ключевые факты\n- Предварительная стоимость тёплого контура двухэтажного дома из газобетона 150–200 м² в регионах России осенью 2026 года — около 42–55 тыс. ₽/м².\n- Горячий лид для строительной компании стоит 2 % от стоимости домовладения.\n- Отступы: дом — 3 м до соседей и 5 м до улицы; баня — 1 м до забора и 8 м до дома.\n\n## Контакты\n${OWNER.phone ? '- Телефон: ' + OWNER.phone + '\n' : ''}${OWNER.email ? '- Почта: ' + OWNER.email + '\n' : ''}- О проекте: ${b}/o-nas/\n`;
    if (full) t += '\n\n' + C.posts.concat(C.services).map(p => `## ${p.title}\n\n${p.lead}\n\n${p.html.replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()}\n\n${(p.faq || []).map(([q, a]) => `**${q}** ${a}`).join('\n')}`).join('\n\n');
    return t;
  }

  return function handle(req, res, url) {
    const p = url.pathname, html = (s) => send(res, 200, s, 'text/html; charset=utf-8'), txt = (s, t) => send(res, 200, s, t || 'text/plain; charset=utf-8');
    const noSlash = /^\/(uslugi|blog|o-nas|kontakty|politika)(\/[\w-]+)?$/.exec(p);
    if (noSlash) { res.writeHead(301, { Location: p + '/' }); res.end(); return true; }
    if (p === '/uslugi/') { html(servicesList(req)); return true; }
    if (p === '/blog/') { html(blogList(req)); return true; }
    if (p === '/o-nas/') { html(aboutPage(req)); return true; }
    if (p === '/kontakty/') { html(contacts(req)); return true; }
    if (p === '/politika/') { html(policy(req)); return true; }
    let m = /^\/uslugi\/([\w-]+)\/$/.exec(p);
    if (m) { const s = C.services.find(q => q.slug === m[1]); if (!s) return false; html(service(req, s)); return true; }
    m = /^\/blog\/([\w-]+)\/$/.exec(p);
    if (m) { const q = C.posts.find(x => x.slug === m[1]); if (!q) return false; html(post(req, q)); return true; }
    if (p === '/sitemap.xml') { txt(sitemap(req), 'application/xml; charset=utf-8'); return true; }
    if (p === '/robots.txt') { txt(robots(req)); return true; }
    if (p === '/llms.txt') { txt(llms(req, false)); return true; }
    if (p === '/llms-full.txt') { txt(llms(req, true)); return true; }
    return false;
  };
};
