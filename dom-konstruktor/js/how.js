/* Главная по макету дизайн-системы: hero с фото и быстрым фильтром, «5 шагов к дому» с разбором каждого шага,
   затем конструктор, популярные проекты, проверенные подрядчики и баннер. «Как это работает» — те же шаги в окне. */
(function () {
'use strict';
const DK = window.DK, C = DK.CONFIG;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => DK.esc(s);
const rub = (v) => Number(v).toLocaleString('ru-RU') + ' ₽', ic = (n, s) => DK.icon ? DK.icon(n, s || 24) : '';
const KEY = 'ld-how-seen';

// пять шагов: что делаете, что получаете, сколько стоит
DK.HOW_STEPS = [
  { s: 'Идея', icon: 'house', tone: 'blue', t: 'Создаёте проект дома', d: 'Выбираете форму, этажи и материал стен, расставляете помещения, двери, окна и мебель. Подсказки объясняют каждое решение, а если система видит категорическую ошибку — например, слишком большой пролёт перекрытия, котельную без окна или лестницу поперёк несущей стены, — она отметит её.', price: [['Конструктор и подсказки', 'бесплатно']] },
  { s: 'Проект', icon: 'trees', tone: 'green', t: 'Примеряете дом на участке', d: 'Кровля, отделка фасада, терраса и гараж — сразу в 3D. На вкладке «Участок» видно, как дом вписывается в ландшафт: отступы по нормам, постройки, деревья. Снимки можно делать прямо в процессе, а усреднённая стоимость строительства пересчитывается на лету по индексам цен из открытых данных.', price: [['3D, участок, снимки', 'бесплатно'], ['Оценка стоимости строительства', 'бесплатно']] },
  { s: 'Настройка', icon: 'file-check', tone: 'cyan', t: 'Сохраняете и дорабатываете проект', d: 'Сохраните проект — в кабинете можно выгрузить эскизный проект в PDF и файлы для ArchiCAD. Верификация: архитектор платформы проверит ваш эскизный проект, внесёт правки и посадит дом именно на ваш участок. В эскизном проекте — типовой фундамент (ж/б плита); в АКР тип фундамента подбирают по геологии и топосъёмке. Можно выбрать архитектора на платформе или добавить своего. Вы архитектор? Регистрируйтесь и выставляйте проекты на продажу.', price: [['Эскизный проект PDF из кабинета', rub(C.sketchPrice || 3000)], ['Файлы для ArchiCAD (IFC, DXF по листам)', rub(C.cadPrice || 3000)], ['Верификация: проверка эскизного проекта, правки архитектора, посадка дома на ваш участок', rub(C.verifyPrice || 15000)], ['АКР — архитектурные и конструктивные решения, фундамент по геологии', 'от ' + rub(C.akrFrom || 50000)], ['Архитектор платформы', 'по его расценкам']] },
  { s: 'Подрядчик', icon: 'users', tone: 'orange', t: 'Выбираете подрядчика', d: 'Карточки строительных компаний открыты: свяжитесь с ними сами. Или поручите нам: разошлём проект компаниям и пришлём отчёт о предложениях. Либо полное сопровождение: выберем компанию, сравним стоимость и технологии, согласуем график и договор — ваши данные закрыты, пока вы не готовы встретиться с компанией.', price: [['Связаться с компаниями самостоятельно', 'бесплатно'], ['Рассылка и отчёт вам о предложениях компаний', rub(C.reportPrice || 1500)], ['Полное сопровождение: выбор компании, сравнение цен и технологий, график, договор', rub(C.fullPrice || 14900) + ' — компания вернёт при договоре']] },
  { s: 'Дом', icon: 'shield-check', tone: 'navy', t: 'Заключаете договор и строите', d: 'Вы выбираете 1–3 компании и идёте на сделку. В карточках видно, кто строит по эскроу и с какими банками аккредитован для ипотеки на ИЖС. При полном сопровождении мы согласуем график строительства и договор, а компания при подписании компенсирует вам стоимость сопровождения.', price: [['Сравнение компаний: эскроу, банки, отзывы', 'бесплатно'], ['График и договор', 'входят в полное сопровождение']] },
];

// длинное описание: первая фраза на виду, остальное — в «Подробнее»
const leadMore = (d) => { const k = d.indexOf('. '); return k < 0 || k > d.length - 40 ? `<p>${d}</p>` : `<p>${d.slice(0, k + 1)}</p><details class="hint"><summary>Подробнее</summary>${d.slice(k + 2)}</details>`; };
DK.leadMore = leadMore;
const stepHtml = (st, i) => `<section class="how-step tone-${st.tone}" data-i="${i}">
    <div class="how-art" aria-hidden="true"><span class="how-num">${String(i + 1).padStart(2, '0')}</span><span class="how-ic">${ic(st.icon, 44)}</span><span class="how-ring"></span></div>
    <div class="how-txt"><h3>${st.t}</h3>${leadMore(st.d)}
      <ul class="how-price">${st.price.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('')}</ul></div></section>`;
// StepPath: круги 44, номер Manrope, подпись Inter; пройден — Navy, текущий — Cyan, будущий — серый
const pathHtml = () => `<ol class="steppath">${DK.HOW_STEPS.map((st, i) => `<li><button type="button" data-step="${i}"><span class="sp-c">${String(i + 1).padStart(2, '0')}</span><span class="sp-l">${st.s}</span></button>${i < DK.HOW_STEPS.length - 1 ? `<span class="sp-line" aria-hidden="true">${ic('chevron-right', 12)}</span>` : ''}</li>`).join('')}</ol>`;

/* шаги с автопрокруткой: и на главной, и в окне */
function stepper(root, opts) {
  const steps = $$('.how-step', root), btns = $$('[data-step]', root);
  let i = 0, timer = null, auto = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const show = (k) => {
    i = (k + steps.length) % steps.length;
    steps.forEach((el, n) => { el.hidden = n !== i; el.classList.toggle('in', n === i); });
    btns.forEach((b, n) => { b.parentNode.classList.toggle('done', n < i); b.parentNode.classList.toggle('cur', n === i); b.setAttribute('aria-current', n === i ? 'step' : 'false'); });
    root.classList.toggle('auto', auto); root.style.setProperty('--how-t', (opts.delay / 1000) + 's');
    if (opts.onShow) opts.onShow(i);
    clearTimeout(timer); if (auto) timer = setTimeout(() => show(i + 1), opts.delay);
  };
  const stop = () => { auto = false; root.classList.remove('auto'); clearTimeout(timer); };
  btns.forEach(b => b.onclick = () => { stop(); show(+b.dataset.step); });
  root.addEventListener('toggle', (e) => { if (e.target.open) stop(); }, true); // читают подробности — не листаем
  if (opts.manual) auto = false;
  return { show, stop, start() { if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { auto = true; show(i); } }, get i() { return i; } };
}

function buildDlg() {
  if ($('#howDlg')) return;
  const d = document.createElement('dialog'); d.id = 'howDlg'; d.className = 'how-dlg';
  d.innerHTML = `<div class="dlg how"><header><div><small class="over">Как это работает</small><h2>5 шагов к дому</h2></div><button class="x" type="button" data-close aria-label="Закрыть">×</button></header>
    ${pathHtml()}<div class="how-body">${DK.HOW_STEPS.map(stepHtml).join('')}</div>
    <div class="nav"><button class="btn ghost" type="button" id="howPrev">Назад</button><button class="btn primary" type="button" id="howNext">Далее</button></div></div>`;
  document.body.appendChild(d);
  const sp = stepper(d, { delay: 9000, onShow: (i) => { $('#howPrev').disabled = i === 0; $('#howNext').textContent = i === DK.HOW_STEPS.length - 1 ? 'Начать проектировать' : 'Далее'; } });
  $('#howPrev').onclick = () => { sp.stop(); sp.show(sp.i - 1); };
  $('#howNext').onclick = () => { sp.stop(); if (sp.i === DK.HOW_STEPS.length - 1) { d.close(); toWork(); } else sp.show(sp.i + 1); };
  $('[data-close]', d).onclick = () => d.close();
  d.addEventListener('close', () => { sp.stop(); try { localStorage.setItem(KEY, '1'); } catch (e) { /* приватный режим */ } });
  d.open2 = (k) => { d.showModal(); sp.show(k || 0); };
}
DK.openHow = (k) => { buildDlg(); $('#howDlg').open2(k); };
function toWork() { DK.goPage && DK.goPage('project'); const w = $('#page-project .work'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

/* быстрый фильтр: те же поля, что в каталоге проектов */
DK.QF = {
  type: [['', 'Любой'], ['garage', 'С гаражом'], ['terrace', 'С террасой'], ['attic', 'С мансардой']],
  area: [['', 'Любая'], ['0-100', 'до 100 м²'], ['100-150', '100–150 м²'], ['150-200', '150–200 м²'], ['200-9999', 'от 200 м²']],
  floors: [['', 'Любая'], ['1', '1 этаж'], ['2', '2 этажа'], ['3', '3 этажа']],
  budget: [['', 'Любой'], ['0-4', 'до 4 млн ₽'], ['4-6', '4–6 млн ₽'], ['6-10', '6–10 млн ₽'], ['10-999', 'от 10 млн ₽']],
};
// оценка строительства «от»: площадь × нижняя граница класса «Эконом» (тёплый контур)
DK.buildFrom = (area) => Math.round((area || 0) * ((C.prices && C.prices.eco && C.prices.eco.from) || 32000) / 10000) * 10000;
DK.qfMatch = (x, f) => {
  const ft = x.feat || {}, rng = (v, s) => { if (!s) return true; const [a, b] = s.split('-').map(Number); return v >= a && v < b; };
  return (!f.type || ft[f.type]) && rng(x.area, f.area) && (!f.floors || x.floors === +f.floors) && rng(DK.buildFrom(x.area) / 1e6, f.budget);
};
const sel = (k, lbl) => `<label class="fld">${lbl}<select data-qf="${k}">${DK.QF[k].map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>`;
DK.qfHtml = () => sel('type', 'Тип дома') + sel('area', 'Площадь') + sel('floors', 'Этажность') + sel('budget', 'Бюджет строительства');

/* карточка проекта по ProjectCard: фото 4:3, бейдж, характеристики с иконками, «от … ₽», «Подробнее →» */
DK.projCard = (x) => {
  const ft = x.feat || {}, ver = x.verify && x.verify.status === 'verified', badge = ver ? '<span class="pc-badge ok">Проверено</span>' : x.boost ? '<span class="pc-badge">Популярный</span>' : (Date.now() - new Date(x.at)) < 14 * 864e5 ? '<span class="pc-badge new">Новинка</span>' : '';
  const sp = (n, t) => `<span>${ic(n, 14)}${t}</span>`;
  return `<article class="pcard2" data-id="${esc(x.id)}" tabindex="0">
    <div class="pc-img">${x.cover ? `<img src="${(C.api || '')}/api/projects/${esc(x.id)}/file/${esc(x.cover)}" alt="${esc(x.title)}" loading="lazy">` : ''}${badge}</div>
    <div class="pc-body"><h3>${esc(x.title)}</h3>
      <div class="pc-specs">${sp('ruler', DK.fmtA(x.area) + ' м²')}${ft.beds ? sp('bed-double', ft.beds) : ''}${ft.baths ? sp('bath', ft.baths) : ''}${sp('layers', x.floors + ' эт.')}</div>
      <div class="pc-price"><small>стройка от</small> ${rub(DK.buildFrom(x.area))}</div>
      <div class="pc-meta"><span>${esc(x.author ? x.author.name : '')}${x.author && x.author.verified ? ' · архитектор' : ''}</span><span>проект: ${x.price ? rub(x.price) : 'бесплатно'}</span></div>
      <span class="pc-more">Подробнее ${ic('arrow-right', 14)}</span></div></article>`;
};
/* карточка подрядчика по ContractorCard */
const orgCard = (c) => {
  const ini = String(c.name || '?').replace(/[«»"]/g, '').replace(/^(СК|ООО|ИП)\s+/, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const role = { builder: 'Строительство домов', architect: 'Архитектор', bureau: 'Архитектурное бюро' }[c.type] || '';
  const stars = c.rating ? `<span class="cc-rate"><b>${Number(c.rating).toFixed(1)}</b><span class="st">${'★'.repeat(Math.round(c.rating))}</span>${c.reviews ? `<small>${c.reviews} отзывов</small>` : ''}</span>` : '';
  return `<article class="ccard"><div class="cc-head"><span class="cc-av">${esc(ini)}</span><div><b>${esc(c.name)}</b><small>${role}</small></div></div>${stars}
    <div class="cc-meta"><span>${ic('map-pin', 14)}${esc((c.regions && c.regions.length ? c.regions : [c.city]).filter(Boolean).join(', '))}</span>${c.since ? `<span>${ic('briefcase', 14)}На рынке с ${esc(c.since)} года</span>` : ''}</div>
    <div class="cc-trust"><span class="ok">${ic('badge-check', 14)}Проверен</span>${c.escrow ? `<span>${ic('file-check', 14)}Эскроу</span>` : ''}${c.banks && c.banks.length ? `<span>${ic('building-2', 14)}${c.banks.length} ${c.banks.length === 1 ? 'банк' : c.banks.length < 5 ? 'банка' : 'банков'}</span>` : ''}</div>
    <div class="cc-act">${c.phone ? `<a class="btn primary" href="tel:${esc(String(c.phone).replace(/[^+\d]/g, ''))}">Связаться ${ic('arrow-right', 14)}</a>` : `<button class="btn primary" type="button" data-act="lead">Связаться ${ic('arrow-right', 14)}</button>`}<button class="btn" type="button" data-go="${c.type === 'builder' ? 'builders' : 'arch'}">Профиль</button></div></article>`;
};

function hero() {
  const h = $('#hero'); if (!h) return;
  // фото задаётся в CRM → «Контент сайта» → «Настройки сайта»; по умолчанию — дом, спроектированный на платформе
  const own = !!(window.__HERO && window.__HERO.src);
  const H = own ? { src: window.__HERO.src, alt: window.__HERO.alt || 'Частный дом' } : { src: "brand/img/hero-house.jpg", small: "brand/img/hero-house-1000.jpg", alt: 'Одноэтажный дом с террасами и бассейном, спроектированный в конструкторе «Логика Дома»' };
  h.innerHTML = `<img class="hero-bg" src="${esc(H.src)}"${H.small ? ` srcset="${esc(H.small)} 1000w, ${esc(H.src)} 2000w" sizes="100vw"` : ''} alt="${esc(H.alt)}" fetchpriority="high">
    <div class="hero-shade" aria-hidden="true"></div>
    <div class="hero-in"><div class="hero-main">
      <h1>Создайте свой дом. Продумайте детали. Найдите подрядчика.</h1>
      <p>Ваша личная логика дома.</p>
      <div class="hero-cta"><button class="btn big w" type="button" id="heroStart">Создать проект ${ic('chevron-right', 16)}</button><button class="btn big ow" type="button" id="heroFind">Найти подрядчика</button></div></div>
      ${own ? '' : '<span class="hero-cap">Этот дом спроектирован на платформе «Логика Дома»</span>'}</div>`;
  $('#heroStart').onclick = toWork;
  $('#heroFind').onclick = () => DK.goPage('builders');
  const q = $('#qfWrap');
  if (q) {
    q.innerHTML = `<div class="home-in"><div class="sec-t"><h2>Посмотрите, что создали другие пользователи</h2><button class="btn tertiary" type="button" data-go="projects">Все проекты ${ic('arrow-right', 14)}</button></div>
      <form class="qf-in" id="qf">${DK.qfHtml()}<button class="btn primary" type="submit">${ic('search', 16)}Найти</button></form></div>`;
    $('[data-go]', q).onclick = () => DK.goPage('projects');
    $('#qf').onsubmit = (e) => { e.preventDefault(); const f = {}; $$('[data-qf]', e.target).forEach(x => { f[x.dataset.qf] = x.value; }); DK.Market.setFilter && DK.Market.setFilter(f); DK.goPage('projects'); };
  }
}
function steps() {
  const s = $('#steps'); if (!s) return;
  s.innerHTML = `<div class="home-in"><div class="sec-t"><h2>5 шагов к дому</h2><button class="btn tertiary" type="button" data-act="how">Подробнее о каждом шаге ${ic('arrow-right', 14)}</button></div>
    <div class="stepcard">${pathHtml()}<div class="how-body">${DK.HOW_STEPS.map(stepHtml).join('')}</div></div></div>`;
  const sp = stepper(s, { delay: 8000, manual: true }); sp.show(0);
  // автопрокрутка шагов — когда блок появился на экране
  if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) { io.disconnect(); sp.start(); } }, { threshold: 0.4 }); io.observe(s); } else sp.start();
}
async function more() {
  const m = $('#homeMore'); if (!m) return;
  m.innerHTML = `<div class="home-in"><section id="hmProj" hidden><div class="sec-t"><h2>Популярные проекты</h2><button class="btn tertiary" type="button" data-go="projects">Все проекты ${ic('arrow-right', 14)}</button></div><div class="pgrid3" id="hmProjList"></div></section>
    <section id="hmOrg" hidden><div class="sec-t"><h2>Проверенные подрядчики</h2><button class="btn tertiary" type="button" data-go="builders">Все подрядчики ${ic('arrow-right', 14)}</button></div><div class="pgrid3" id="hmOrgList"></div></section>
    <section class="navy-ban"><div class="hero-grid" aria-hidden="true"></div><span class="node nd-cyan b1"></span><span class="node nd-orange b2"></span><span class="node nd-blue b3"></span><span class="node nd-coral b4"></span>
      <div><h2>Найдите проект или создайте свой</h2><p>Настройте планировку, материалы и инженерию — смета пересчитается автоматически.</p>
      <div class="hero-cta"><button class="btn big" type="button" data-go="projects">Подобрать проект</button><button class="btn big ghost-w" type="button" id="banStart">Спроектировать свой</button></div></div></section></div>`;
  $('#banStart').onclick = toWork;
  $$('[data-go]', m).forEach(b => b.onclick = () => DK.goPage(b.dataset.go));
  try {
    const r = await fetch((C.api || '') + '/api/projects'); const list = r.ok ? await r.json() : [];
    if (list.length) { $('#hmProjList').innerHTML = list.slice(0, 3).map(DK.projCard).join(''); $('#hmProj').hidden = false;
      $$('#hmProjList .pcard2').forEach(a => { a.onclick = () => DK.Market.openProject(a.dataset.id); a.onkeydown = (e) => { if (e.key === 'Enter') a.click(); }; }); }
  } catch (e) { /* без сервера — без блока */ }
  try {
    const orgs = (await DK.loadCatalog()).slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.type === 'builder') - (a.type === 'builder')).slice(0, 3);
    if (orgs.length) { $('#hmOrgList').innerHTML = orgs.map(orgCard).join(''); $('#hmOrg').hidden = false;
      $$('#hmOrgList [data-go]').forEach(b => b.onclick = () => DK.goPage(b.dataset.go)); $$('#hmOrgList [data-act="lead"]').forEach(b => b.onclick = () => document.querySelector('.top [data-act="lead"]').click()); }
  } catch (e) { /* каталог недоступен */ }
}
DK.howInit = function () {
  hero(); steps(); more();
  const hp = $('#howPage'); if (hp) { hp.innerHTML = DK.HOW_STEPS.map(stepHtml).join(''); }
  $$('[data-act="how"]').forEach(b => b.onclick = (e) => { e.preventDefault(); DK.openHow(0); });
  // окно «Как это работает» при первом открытии — по настройке (на главной шаги уже видны)
  let seen = false; try { seen = !!localStorage.getItem(KEY); } catch (e) { /* приватный режим */ }
  const q = new URLSearchParams(location.search);
  if (C.howPopup && !seen && !q.get('crm') && !q.get('crmp') && !q.get('company') && !location.hash) setTimeout(() => DK.openHow(0), 700);
};
})();
