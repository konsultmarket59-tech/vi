/* Контент сайта для CMS: страницы из блоков, SEO каждой страницы, настройки сайта.
   Исходные тексты — content.js; правки маркетолога и новые страницы лежат в data/runtime/cms.json и перекрывают исходные.
   Адрес страницы — ключ записи: /uslugi/<slug>/, /blog/<slug>/, /<slug>/ для новых страниц. */
'use strict';
const fs = require('fs'), path = require('path');

module.exports = function cmsStore(DATA, C, CFG) {
  const FILE = path.join(DATA, 'cms.json');
  const read = () => { try { return Object.assign({ pages: {}, site: {} }, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) { return { pages: {}, site: {} }; } };
  const write = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));
  const OWNER = (CFG && CFG.owner) || {}, BRAND = (CFG && CFG.brand) || 'Свой Дом';
  const RESERVED = /^\/(api|css|js|img|data|media|crm|admin|index)(\/|\.|$)/;
  const KINDS = { home: 'Главная', list: 'Раздел', service: 'Услуга', post: 'Статья', page: 'Страница' };

  const textAndFaq = (html, faq) => [{ t: 'text', html }].concat(faq && faq.length ? [{ t: 'faq', title: 'Частые вопросы', items: faq.map(([q, a]) => ({ q, a })) }] : []);
  function defaults() {
    const d = {};
    const add = (r) => { d[r.path] = Object.assign({ status: 'published', blocks: [], seoTitle: '', desc: '', keywords: '', ogImage: '', noindex: false, lead: '', inMenu: false }, r); };
    add({ path: '/', kind: 'home', name: 'Главная (конструктор)', title: `${BRAND} — конструктор дома и подбор строителя`, seoTitle: `${BRAND} — конструктор частного дома онлайн с 3D и подбор строителя`,
      desc: 'Бесплатный онлайн-конструктор частного дома: планировка, мансарда, 3D-прогулка, участок по нормам, вилка стоимости тёплого контура и подбор строительной компании.', keywords: 'конструктор дома, планировка дома онлайн, проект дома, стоимость строительства дома' });
    add({ path: '/uslugi/', kind: 'list', name: 'Услуги', title: 'Услуги', seoTitle: `Услуги — ${BRAND}`, desc: 'Конструктор дома, подбор строительной компании, эскизный проект, расчёт стоимости и заявки для строителей.',
      lead: 'Всё для планирования частного дома и выбора строителя — от бесплатного конструктора до сравнения смет.' });
    add({ path: '/blog/', kind: 'list', name: 'Блог', title: 'Блог о строительстве дома', seoTitle: `Блог о строительстве частного дома — ${BRAND}`,
      desc: 'Статьи о строительстве частного дома: цены 2026 года, тёплый контур, мансарда, отступы на участке, котельная, выбор строителя.', lead: 'Разбираем цены, нормы и решения, которые помогают построить дом без переплат.' });
    C.services.forEach(s => add({ path: `/uslugi/${s.slug}/`, kind: 'service', name: s.title, title: s.h1, seoTitle: `${s.title} — ${BRAND}`, desc: s.desc, lead: s.lead, price: s.price, keywords: s.keywords || '', blocks: textAndFaq(s.html, s.faq) }));
    C.posts.forEach(p => add({ path: `/blog/${p.slug}/`, kind: 'post', name: p.title, title: p.title, seoTitle: `${p.title} — ${BRAND}`, desc: p.desc, lead: p.lead, date: p.date, cover: p.cover || '', keywords: p.keywords || '', tags: p.tags || [], blocks: textAndFaq(p.html, p.faq) }));
    add({ path: '/o-nas/', kind: 'page', name: 'О нас', title: C.about.title, seoTitle: C.about.title, desc: C.about.desc, lead: C.about.lead, blocks: textAndFaq(C.about.html, C.about.faq).concat([{ t: 'contacts', title: 'Контакты' }]) });
    add({ path: '/kontakty/', kind: 'page', name: 'Контакты', title: 'Контакты', seoTitle: `Контакты — ${BRAND}`, desc: `Контакты сервиса ${BRAND}: телефон, почта, заявка на подбор строительной компании.`, blocks: [{ t: 'contacts' }] });
    add({ path: '/politika/', kind: 'page', name: 'Политика обработки данных', title: 'Политика обработки персональных данных', seoTitle: `Политика обработки персональных данных — ${BRAND}`,
      desc: 'Политика обработки персональных данных пользователей сайта в соответствии с 152-ФЗ.', blocks: [{ t: 'text', html: C.policy || '' }] });
    return d;
  }
  function all() {
    const def = defaults(), st = read(), out = [];
    Object.values(def).forEach(r => { const o = st.pages[r.path]; out.push(Object.assign({}, r, o || {}, { path: r.path, kind: r.kind, custom: false, edited: !!o })); });
    Object.entries(st.pages).forEach(([p, r]) => { if (!def[p]) out.push(Object.assign({ status: 'draft', blocks: [] }, r, { path: p, custom: true, edited: true })); });
    return out;
  }
  const get = (p) => all().find(r => r.path === p) || null;
  const clean = (r) => {
    const keep = ['name', 'title', 'seoTitle', 'desc', 'keywords', 'ogImage', 'noindex', 'lead', 'price', 'date', 'cover', 'tags', 'blocks', 'status', 'inMenu', 'kind'];
    const o = {}; keep.forEach(k => { if (r[k] !== undefined) o[k] = r[k]; });
    o.blocks = Array.isArray(o.blocks) ? o.blocks.slice(0, 120) : [];
    o.status = o.status === 'draft' ? 'draft' : 'published';
    return o;
  };
  function save(p, rec, by) {
    const st = read(), def = defaults(), np = rec.path || p;
    if (!/^\/([a-z0-9-]+\/)+$|^\/$/.test(np)) throw new Error('Адрес — латиница, цифры и дефис, со слэшами: /novaya-stranica/');
    if (!def[p] && RESERVED.test(np)) throw new Error('Этот адрес занят системой');
    if (def[p] && np !== p) throw new Error('Адрес исходной страницы менять нельзя — создайте новую');
    if (np !== p && (def[np] || st.pages[np])) throw new Error('Страница с таким адресом уже есть');
    const o = clean(rec); o.updatedAt = new Date().toISOString(); o.by = by || '';
    if (!def[np]) { o.kind = ['post', 'service', 'page'].includes(rec.kind) ? rec.kind : 'page'; if (np !== p) delete st.pages[p]; o.createdAt = (st.pages[p] && st.pages[p].createdAt) || o.updatedAt; }
    else o.kind = def[np].kind;
    st.pages[np] = o; write(st);
    return get(np);
  }
  function remove(p) { const st = read(); if (defaults()[p]) throw new Error('Исходную страницу удалить нельзя — снимите с публикации или сбросьте правки'); delete st.pages[p]; write(st); }
  function reset(p) { const st = read(); delete st.pages[p]; write(st); return get(p); }
  const SITE_KEYS = ['phone', 'email', 'city', 'address', 'legal', 'inn', 'hours', 'vk', 'telegram', 'whatsapp', 'max', 'youtube', 'dzen', 'metrika', 'gsc', 'yandexVerify', 'footerNote'];
  function site() { const s = read().site || {}; return Object.assign({ phone: OWNER.phone || '', email: OWNER.email || '', city: OWNER.city || 'Пермь, работаем по России', legal: OWNER.name || BRAND }, s); }
  function saveSite(d) { const st = read(); st.site = {}; SITE_KEYS.forEach(k => { if (d[k] != null) st.site[k] = String(d[k]).slice(0, 500); }); write(st); return site(); }
  return { all, get, save, remove, reset, site, saveSite, KINDS, BRAND };
};
