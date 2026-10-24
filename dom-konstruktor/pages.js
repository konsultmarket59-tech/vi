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
  const cfg = (() => { const sb = { window: {} }; sb.DK = sb.window.DK = {}; try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), sb); } catch (e) { /* по умолчанию */ } return sb.window.DK.CONFIG || { brand: 'Свой Дом', owner: {} }; })();
  const store = ctx.cms || require('./cms-store.js')(DATA, C, cfg);
  const BRAND = cfg.brand || 'Свой Дом';
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
          if ((n === 'href' || n === 'src') && /^\s*(javascript|data|vbscript):/i.test(v)) return q;
          out.push(`${n}="${esc(v)}"`); return q;
        });
        return `<${tag}${out.length ? ' ' + out.join(' ') : ''}>`;
      });
  }
  const url = (u) => /^(https?:\/\/|\/|#|mailto:|tel:)/i.test(String(u || '')) ? esc(u) : '#';
  function video(u) {
    u = String(u || ''); let m;
    if ((m = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{6,})/.exec(u))) return `https://www.youtube.com/embed/${m[1]}`;
    if ((m = /rutube\.ru\/video\/([\w]+)/.exec(u))) return `https://rutube.ru/play/embed/${m[1]}`;
    if ((m = /vk(?:video)?\.(?:com|ru)\/video(-?\d+)_(\d+)/.exec(u))) return `https://vk.com/video_ext.php?oid=${m[1]}&id=${m[2]}`;
    return '';
  }

  /* ---------- шапка и подвал ---------- */
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
  function footer() {
    const S = store.site(), extra = store.all().filter(r => r.custom && r.inMenu && pub(r));
    const soc = [['vk', 'ВКонтакте'], ['telegram', 'Telegram'], ['whatsapp', 'WhatsApp'], ['max', 'MAX'], ['youtube', 'YouTube'], ['dzen', 'Дзен']].filter(([k]) => S[k]).map(([k, n]) => `<a href="${url(S[k])}" rel="noopener" target="_blank">${n}</a>`).join('');
    return `<footer class="site-foot"><div class="foot-grid">
  <div><a class="logo" href="/">${LOGO}<span class="logo-word"><b>${esc(BRAND.toUpperCase())}</b><small>конструктор и подбор строителя</small></span></a>
    <p>${esc(S.footerNote || 'Онлайн-конструктор частного дома, предварительная смета и подбор строительной компании.')}</p>${soc ? `<div class="soc">${soc}</div>` : ''}</div>
  <div><h4>Сервис</h4><a href="/">Конструктор дома</a><a href="/uslugi/podbor-stroitelnoj-kompanii/">Подбор строителя</a><a href="/uslugi/eskiznyj-proekt/">Эскизный проект</a><a href="/uslugi/raschet-stoimosti-doma/">Расчёт стоимости</a><a href="/#projects">Каталог проектов</a></div>
  <div><h4>Компаниям</h4><a href="/uslugi/dlya-stroitelnyh-kompanij/">Заявки для строителей</a><a href="/#company">Кабинет компании</a><a href="/#join">Регистрация исполнителя</a><a href="/#cab">Архитекторам</a></div>
  <div><h4>Информация</h4><a href="/blog/">Блог</a><a href="/o-nas/">О нас</a><a href="/kontakty/">Контакты</a>${extra.map(r => `<a href="${r.path}">${esc(r.name || r.title)}</a>`).join('')}<a href="/politika/">Политика обработки данных</a></div>
  <div><h4>Контакты</h4>${S.phone ? `<a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a>` : ''}${S.email ? `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>` : ''}<span>${esc(S.city)}</span>${S.address ? `<span>${esc(S.address)}</span>` : ''}${S.hours ? `<span>${esc(S.hours)}</span>` : ''}</div>
</div><div class="foot-legal">© ${new Date().getFullYear()} ${esc(S.legal || BRAND)}${S.inn ? ', ИНН ' + esc(S.inn) : ''}. Расчёты на сайте — предварительные и не заменяют проект. Пролёты, котельная и отступы проверяются упрощённо.</div></footer>`;
  }

  /* ---------- микроразметка ---------- */
  function org(b) {
    const S = store.site(), o = { '@type': 'Organization', '@id': b + '/#org', name: BRAND, url: b + '/', logo: b + '/favicon.svg', description: C.about.desc };
    if (S.phone) o.telephone = S.phone; if (S.email) o.email = S.email;
    if (S.address || S.city) o.address = { '@type': 'PostalAddress', addressLocality: S.city, streetAddress: S.address || undefined, addressCountry: 'RU' };
    const same = ['vk', 'telegram', 'youtube', 'dzen'].map(k => S[k]).filter(Boolean); if (same.length) o.sameAs = same;
    return o;
  }
  const crumbs = (b, items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: b + it[1] })) });
  const crumbHtml = (items) => `<nav class="crumbs" aria-label="Хлебные крошки">${items.map((it, i) => i < items.length - 1 ? `<a href="${it[1]}">${esc(it[0])}</a>` : `<span>${esc(it[0])}</span>`).join(' / ')}</nav>`;
  const faqsOf = (r) => (r.blocks || []).filter(b => b.t === 'faq').flatMap(b => b.items || []).filter(x => x.q && x.a);
  const faqLd = (r) => { const f = faqsOf(r); return f.length ? { '@type': 'FAQPage', mainEntity: f.map(x => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: String(x.a).replace(/<[^>]+>/g, '') } })) } : null; };
  const cta = `<aside class="cta-box"><h3>Спланируйте свой дом бесплатно</h3><p>Этажи и мансарда, 3D-прогулка, участок по нормам и вилка стоимости тёплого контура — за вечер.</p><div><a class="btn gold" href="/">Открыть конструктор</a> <a class="btn" href="/#lead">Подобрать строителя</a></div></aside>`;

  /* ---------- блоки ---------- */
  function contactsHtml(title) {
    const S = store.site();
    return `${title ? `<h2>${esc(title)}</h2>` : ''}<ul class="contacts">${S.phone ? `<li>Телефон: <a href="tel:${esc(S.phone.replace(/[^\d+]/g, ''))}">${esc(S.phone)}</a></li>` : ''}${S.email ? `<li>Почта: <a href="mailto:${esc(S.email)}">${esc(S.email)}</a></li>` : ''}<li>Город: ${esc(S.city)}</li>${S.address ? `<li>Адрес: ${esc(S.address)}</li>` : ''}${S.hours ? `<li>Часы работы: ${esc(S.hours)}</li>` : ''}<li>Заявка на подбор строителя: <a href="/#lead">форма на сайте</a></li></ul>`;
  }
  function block(b) {
    const h = (t) => t ? `<h2>${esc(t)}</h2>` : '';
    switch (b.t) {
      case 'text': return `<div class="b-text">${clean(b.html)}</div>`;
      case 'hero': return `<section class="b-hero"${b.img ? ` style="--img:url('${url(b.img)}')"` : ''}><div><h2>${esc(b.title)}</h2>${b.text ? `<p>${esc(b.text)}</p>` : ''}${b.btn ? `<a class="btn gold" href="${url(b.href || '/')}">${esc(b.btn)}</a>` : ''}</div></section>`;
      case 'image': return b.src ? `<figure class="b-img"><img src="${url(b.src)}" alt="${esc(b.alt)}" loading="lazy">${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : '';
      case 'gallery': return `<div class="b-gal">${(b.items || []).filter(x => x.src).map(x => `<figure><img src="${url(x.src)}" alt="${esc(x.alt)}" loading="lazy">${x.alt ? `<figcaption>${esc(x.alt)}</figcaption>` : ''}</figure>`).join('')}</div>`;
      case 'cards': return `${h(b.title)}<div class="cards">${(b.items || []).map(x => `<${x.href ? `a href="${url(x.href)}"` : 'div'} class="card">${x.title ? `<h3>${esc(x.title)}</h3>` : ''}${x.text ? `<p>${esc(x.text)}</p>` : ''}</${x.href ? 'a' : 'div'}>`).join('')}</div>`;
      case 'steps': return `${h(b.title)}<ol class="b-steps">${(b.items || []).map(x => `<li><b>${esc(x.title)}</b>${x.text ? `<span>${esc(x.text)}</span>` : ''}</li>`).join('')}</ol>`;
      case 'faq': return (b.items || []).length ? `<section class="faq">${h(b.title || 'Частые вопросы')}${b.items.map(x => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join('')}</section>` : '';
      case 'cta': return `<aside class="cta-box"><h3>${esc(b.title)}</h3>${b.text ? `<p>${esc(b.text)}</p>` : ''}<div>${b.btn ? `<a class="btn gold" href="${url(b.href || '/')}">${esc(b.btn)}</a>` : ''} ${b.btn2 ? `<a class="btn" href="${url(b.href2 || '/')}">${esc(b.btn2)}</a>` : ''}</div></aside>`;
      case 'quote': return `<blockquote class="b-quote"><p>${esc(b.text)}</p>${b.author ? `<cite>${esc(b.author)}</cite>` : ''}</blockquote>`;
      case 'video': { const v = video(b.url); return v ? `<figure class="b-video"><iframe src="${esc(v)}" title="${esc(b.caption || 'Видео')}" loading="lazy" allowfullscreen></iframe>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>` : ''; }
      case 'table': { const rows = String(b.rows || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(r => r.some(Boolean)); if (!rows.length) return '';
        return `${h(b.title)}<div class="b-table"><table><thead><tr>${rows[0].map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
      case 'columns': return `<div class="b-cols"><div>${clean(b.left)}</div><div>${clean(b.right)}</div></div>`;
      case 'button': return `<p class="b-btn"><a class="btn ${b.style === 'gold' ? 'gold' : ''}" href="${url(b.href || '/')}">${esc(b.text || 'Подробнее')}</a></p>`;
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alumni+Sans:wght@700;800&family=Raleway:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/css/pages.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>${metrika(S)}</head>
<body>${o.draft ? '<div class="draft-bar">Предпросмотр — страница ещё не опубликована</div>' : ''}${header(o.cur)}<main class="page">${o.body}</main>${footer()}</body></html>`;
  }
  const metrika = (S) => /^\d{5,12}$/.test(String(S.metrika || '')) ? `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");ym(${S.metrika},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});</script>` : '';

  const list = (kind) => store.all().filter(r => r.kind === kind && pub(r));
  const posts = () => list('post').sort((a, c) => String(c.date || '').localeCompare(String(a.date || '')));
  function render(req, r, draft) {
    const b = base(req);
    if (r.path === '/uslugi/') {
      const items = [['Главная', '/'], ['Услуги', '/uslugi/']], sv = list('service');
      return page(req, r, { cur: 'uslugi', draft, ld: [crumbs(b, items), { '@type': 'ItemList', itemListElement: sv.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: b + s.path, name: s.name || s.title })) }],
        body: `${crumbHtml(items)}<h1>${esc(r.title)}</h1>${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}<div class="cards">${sv.map(s => `<a class="card" href="${s.path}"><h2>${esc(s.name || s.title)}</h2><p>${esc(s.desc)}</p>${s.price ? `<span class="price">${esc(s.price)}</span>` : ''}</a>`).join('')}</div>${blocksHtml(r)}${ctaOf(r)}` });
    }
    if (r.path === '/blog/') {
      const items = [['Главная', '/'], ['Блог', '/blog/']], ps = posts();
      return page(req, r, { cur: 'blog', draft, ld: [crumbs(b, items), { '@type': 'Blog', name: `Блог ${BRAND}`, url: b + '/blog/', blogPost: ps.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: b + p.path, datePublished: p.date })) }],
        body: `${crumbHtml(items)}<h1>${esc(r.title)}</h1>${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}<div class="cards">${ps.map(p => `<a class="card${p.cover ? ' has-cover' : ''}" href="${p.path}">${p.cover ? `<img src="${url(p.cover)}" alt="" loading="lazy">` : ''}<time datetime="${esc(p.date)}">${p.date ? fmtDate(p.date) : ''}</time><h2>${esc(p.title)}</h2><p>${esc(p.desc)}</p></a>`).join('')}</div>${blocksHtml(r)}${ctaOf(r)}` });
    }
    if (r.kind === 'service') {
      const items = [['Главная', '/'], ['Услуги', '/uslugi/'], [r.name || r.title, r.path]];
      return page(req, r, { cur: 'uslugi', draft, ld: [crumbs(b, items), { '@type': 'Service', name: r.name || r.title, description: r.desc, provider: { '@id': b + '/#org' }, areaServed: { '@type': 'Country', name: 'Россия' }, offers: r.price ? { '@type': 'Offer', description: r.price } : undefined }],
        body: `${crumbHtml(items)}<article><h1>${esc(r.title)}</h1>${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}${r.price ? `<p class="price-line">Стоимость: <b>${esc(r.price)}</b></p>` : ''}${blocksHtml(r)}</article>${ctaOf(r)}` });
    }
    if (r.kind === 'post') {
      const items = [['Главная', '/'], ['Блог', '/blog/'], [r.title, r.path]], others = posts().filter(q => q.path !== r.path).slice(0, 3);
      return page(req, r, { cur: 'blog', draft, ld: [crumbs(b, items), { '@type': 'BlogPosting', headline: r.title, description: r.desc, image: r.cover ? (/^https?:/.test(r.cover) ? r.cover : b + r.cover) : undefined, datePublished: r.date, dateModified: day(r), inLanguage: 'ru-RU', wordCount: words(r), keywords: r.keywords || undefined, mainEntityOfPage: b + r.path, author: { '@type': 'Organization', name: `Редакция ${BRAND}`, url: b + '/o-nas/' }, publisher: { '@id': b + '/#org' } }],
        body: `${crumbHtml(items)}<article>${r.cover ? `<img class="cover" src="${url(r.cover)}" alt="${esc(r.title)}">` : ''}<h1>${esc(r.title)}</h1><p class="meta">Редакция ${esc(BRAND)}${r.date ? ` · <time datetime="${esc(r.date)}">${fmtDate(r.date)}</time>` : ''} · обновлено <time datetime="${day(r)}">${fmtDate(day(r))}</time></p>
${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}${blocksHtml(r)}</article>${ctaOf(r)}
${others.length ? `<section class="more"><h2>Читайте также</h2><div class="cards">${others.map(q => `<a class="card" href="${q.path}"><h3>${esc(q.title)}</h3></a>`).join('')}</div></section>` : ''}` });
    }
    // обычная страница: «О нас», контакты, политика и новые страницы из CMS
    const items = [['Главная', '/'], [r.name || r.title, r.path]];
    const kindLd = r.path === '/o-nas/' ? { '@type': 'AboutPage', name: r.title, url: b + r.path, about: { '@id': b + '/#org' } } : r.path === '/kontakty/' ? { '@type': 'ContactPage', url: b + r.path, about: { '@id': b + '/#org' } } : { '@type': 'WebPage', name: r.title, url: b + r.path, dateModified: day(r) };
    return page(req, r, { cur: r.path.replace(/\//g, ''), draft, ld: [crumbs(b, items), kindLd], body: `${crumbHtml(items)}<article><h1>${esc(r.title)}</h1>${r.lead ? `<p class="lead">${esc(r.lead)}</p>` : ''}${blocksHtml(r)}</article>${r.path === '/politika/' ? '' : ctaOf(r)}` });
  }

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
    const extra = (S.yandexVerify ? `<meta name="yandex-verification" content="${esc(S.yandexVerify)}">` : '') + (S.gsc ? `<meta name="google-site-verification" content="${esc(S.gsc)}">` : '') + metrika(S);
    if (extra) h = h.replace('</head>', extra + '</head>');
    return h;
  }

  function sitemap(req) {
    const b = base(req), u = (loc, d, pr) => `<url><loc>${b}${loc}</loc><lastmod>${d}</lastmod><priority>${pr}</priority></url>`;
    const pr = { home: '1.0', list: '0.9', service: '0.9', post: '0.8', page: '0.6' };
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
      store.all().filter(r => pub(r) && !r.noindex).map(r => u(r.path, r.kind === 'post' && !r.edited ? r.date : day(r), r.path === '/politika/' ? '0.3' : pr[r.kind] || '0.6')).join('') + `</urlset>`;
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
    const mm = /^\/media\/([\w-]+\.(png|jpe?g|webp|gif))$/.exec(p);
    if (mm) { const f = path.join(DATA, 'media', mm[1]); if (!fs.existsSync(f)) return false; res.writeHead(200, { 'Content-Type': { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[mm[2]], 'Cache-Control': 'public, max-age=604800' }); fs.createReadStream(f).pipe(res); return true; }
    if (/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(p) && store.get(p + '/')) { res.writeHead(301, { Location: p + '/' }); res.end(); return true; }
    const r = /\/$/.test(p) && p !== '/' ? store.get(p) : null;
    if (r && pub(r)) { html(render(req, r)); return true; }
    return false;
  }
  handle.preview = (req, r) => render(req, Object.assign({ blocks: [], status: 'draft' }, r), r.status !== 'published');
  handle.store = store;
  return handle;
};
