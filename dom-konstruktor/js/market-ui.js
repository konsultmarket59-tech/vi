/* Проекты пользователей: вход, кабинет, заявка архитектора, публикация с ценой, каталог со звёздами, запрос эскизного проекта */
(function () {
'use strict';
const DK = window.DK;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => DK.esc(s);
const TK = 'dk-token';
let token = null, user = null;
try { token = localStorage.getItem(TK); } catch (e) { /* без хранилища — вход на сессию */ }

async function api(path, data, method) {
  if (location.protocol === 'file:') throw new Error('Нужен сервер площадки (node server.js)');
  const r = await fetch((DK.CONFIG.api || '') + path, { method: method || (data ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: data ? JSON.stringify(data) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { throw new Error('Сервер площадки недоступен'); }
  if (!r.ok) { const er = new Error(j.error || 'Ошибка ' + r.status); er.status = r.status; throw er; }
  return j;
}
function setToken(t) { token = t; try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch (e) { /* ignore */ } }
const stars = (v, id, big) => `<span class="stars${big ? ' big' : ''}"${id ? ` data-rate="${id}"` : ''}>${[1, 2, 3, 4, 5].map(i => `<button type="button" data-s="${i}" class="${v >= i - 0.25 ? 'on' : ''}" aria-label="${i} из 5">★</button>`).join('')}</span>`;
const money = (v) => v ? Number(v).toLocaleString('ru-RU') + ' ₽' : 'Бесплатно';
const archBadge = (u) => u.verified || u.archStatus === 'verified' ? '<span class="badge">✓ архитектор</span>' : '';

async function refreshMe() {
  if (!token) { user = null; paintHeader(); return; }
  try { user = (await api('/api/me')).user; } catch (e) { if (e.status === 401) setToken(null); user = null; }
  paintHeader();
}
function paintHeader() { const b = $('#cabBtn'); if (b) b.textContent = user ? 'Кабинет · ' + user.name.split(' ')[0] : 'Личный кабинет'; }

/* ---------- вход и регистрация ---------- */
let afterAuth = null, authKind = 'user';
function openAuth(then, tab) {
  afterAuth = then || null;
  // arch — регистрация с заявкой архитектора; company — вход и регистрация строительной компании
  authKind = tab === 'company' ? 'company' : 'user';
  $('#aArch').checked = tab === 'arch'; $('#aArchBox').hidden = tab !== 'arch';
  if ($('#aCompBox')) { $('#aCompBox').hidden = authKind !== 'company'; $('#aArch').closest('label').hidden = authKind === 'company'; }
  $('#authDlg h2').textContent = authKind === 'company' ? 'Кабинет строительной компании' : 'Личный кабинет';
  setTab(tab === 'arch' ? 'reg' : tab === 'reg' ? 'reg' : 'login'); $('#aErr').textContent = ''; $('#authDlg').showModal();
}
function setTab(t) {
  $$('#authTabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
  $('#aLogin').hidden = t !== 'login'; $('#aReg').hidden = t !== 'reg';
}
async function fileData(input) {
  const files = Array.from(input.files || []).slice(0, 6), out = [];
  for (const f of files) {
    if (f.size > 8e6) throw new Error(`${f.name}: больше 8 МБ`);
    out.push({ name: f.name, data: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }) });
  }
  return out;
}
function bindAuth() {
  $$('#authTabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
  $('[data-close]', $('#authDlg')).onclick = () => $('#authDlg').close();
  $('#aArch').onchange = (e) => { $('#aArchBox').hidden = !e.target.checked; };
  $('#aLogin').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('/api/auth/login', { email: f.email.value, password: f.password.value }); setToken(r.token); user = r.user; done(); }
    catch (er) { $('#aErr').textContent = er.message; }
  };
  $('#aReg').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.agree.checked) { $('#aErr').textContent = 'Нужно согласие на обработку данных и с правилами площадки'; return; }
    try {
      const r = await api('/api/auth/register', { name: f.name.value, email: f.email.value, phone: f.phone.value, city: f.city.value, password: f.password.value });
      setToken(r.token); user = r.user;
      if (f.arch.checked) {
        const files = await fileData(f.docs);
        const a = await api('/api/architect/apply', { diploma: f.diploma.value, sro: f.sro.value, site: f.site.value, about: f.about.value, files });
        user = a.user; DK.toast && DK.toast('Документы отправлены на проверку');
      }
      done();
    } catch (er) { $('#aErr').textContent = er.message; }
  };
  function done() { $('#authDlg').close(); paintHeader(); const t = afterAuth; afterAuth = null; if (t) t(); else DK.goPage('cab'); }
}

/* ---------- публикация ---------- */
async function openPublish() {
  if (!user) { openAuth(openPublish, 'reg'); return; }
  const A = DK.areas(DK.appApi.project());
  const f = $('#pubForm'); f.reset(); f.title.value = DK.appApi.project().name && DK.appApi.project().name !== 'Мой дом' ? DK.appApi.project().name : `Дом ${DK.fmtA(A.total)} м²`;
  $('#pErr').textContent = ''; $('#pubInfo').textContent = `${DK.fmtA(A.total)} м², ${DK.floorsOf(DK.appApi.project()).length} эт., ${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м`;
  $('#pubDlg').showModal();
}
function bindPublish() {
  $('[data-close]', $('#pubDlg')).onclick = () => $('#pubDlg').close();
  $('#pubForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.own.checked) { $('#pErr').textContent = 'Подтвердите, что проект ваш и вы согласны с правилами'; return; }
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Публикую…';
    try {
      const p = DK.appApi.project(), A = DK.areas(p), imgs = await DK.appApi.images();
      const r = await api('/api/projects', { title: f.title.value, about: f.about.value, price: +f.price.value || 0, license: f.license.value, project: p, images: imgs,
        area: Math.round(A.total * 10) / 10, floors: DK.floorsOf(p).length, size: `${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м` });
      $('#pubDlg').close(); DK.toast && DK.toast('Проект опубликован'); DK.goPage('projects'); setTimeout(() => openProject(r.id), 300);
    } catch (er) { $('#pErr').textContent = er.message; }
    btn.disabled = false; btn.textContent = 'Опубликовать';
  };
}

/* ---------- каталог проектов ---------- */
const flt = { q: '', sort: 'rating' };
async function renderProjects() {
  const el = $('#projList');
  el.innerHTML = '<div class="muted">Загружаю…</div>';
  let list;
  try { list = await api(`/api/projects?sort=${flt.sort}&q=${encodeURIComponent(flt.q)}`); }
  catch (e) { el.innerHTML = `<div class="empty"><b>Каталог проектов на сервере площадки</b><p>${esc(e.message)}. Здесь появятся проекты пользователей и архитекторов с ценой и рейтингом.</p></div>`; return; }
  if (!list.length) { el.innerHTML = '<div class="empty"><b>Пока пусто</b><p>Опубликуйте свою планировку первым — кнопка «Опубликовать проект» в конструкторе.</p></div>'; return; }
  el.innerHTML = list.map(x => `<article class="proj" data-id="${esc(x.id)}">
    ${x.cover ? `<img src="${(DK.CONFIG.api || '')}/api/projects/${esc(x.id)}/file/${esc(x.cover)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
    <div class="pb"><h3>${esc(x.title)}</h3>
      <div class="muted">${DK.fmtA(x.area)} м² · ${x.floors} эт. · ${esc(x.size || '')}</div>
      <div class="row">${stars(x.rating.avg)}<span class="muted">${x.rating.n ? x.rating.avg.toFixed(1) + ' · ' + x.rating.n : 'нет оценок'}</span></div>
      <div class="row between"><span>${esc(x.author.name)} ${archBadge(x.author)}</span><b>${money(x.price)}</b></div></div>
  </article>`).join('');
  $$('.proj', el).forEach(a => a.onclick = () => openProject(a.dataset.id));
}
async function openProject(id) {
  let x; try { x = await api('/api/projects/' + id); } catch (e) { DK.toast && DK.toast(e.message); return; }
  const base = (DK.CONFIG.api || '') + `/api/projects/${x.id}/file/`;
  $('#prBody').innerHTML = `<header><div><h2>${esc(x.title)}</h2><div class="muted">${DK.fmtA(x.area)} м² · ${x.floors} эт. · ${esc(x.size || '')} · ${esc(x.author.name)} ${archBadge(x.author)}</div></div><button class="x" type="button" data-close aria-label="Закрыть">×</button></header>
    <div class="gal">${x.files.map(f => `<img src="${base}${esc(f)}" alt="">`).join('')}</div>
    ${x.about ? `<p>${esc(x.about)}</p>` : ''}
    <div class="row">${stars(x.rating.avg, x.id, true)}<span class="muted" id="prRate">${x.rating.n ? x.rating.avg.toFixed(1) + ' из 5 · оценок: ' + x.rating.n : 'Оцените проект'}</span></div>
    <div class="box"><b>${money(x.price)}</b><span>${x.license === 'build' ? 'Право построить по эскизу: автор передаёт эскизный проект для строительства одного дома.' : 'Эскизный проект для ознакомления и доработки с архитектором.'} Оплата и передача — через площадку.</span></div>
    <div class="nav">${x.project ? '<button class="btn" id="prOpen">Открыть в конструкторе</button>' : '<span class="muted">Файл проекта откроется после оплаты.</span>'}<button class="btn gold" id="prReq">${x.price ? 'Запросить эскизный проект' : 'Связаться с автором'}</button></div>
    <form id="prForm" class="q" hidden><div class="row2"><label class="fld">Имя<input name="name" value="${esc(user ? user.name : '')}" required></label><label class="fld">Телефон<input name="phone" type="tel" value="${esc(user ? user.phone : '')}" required></label></div>
      <label class="fld">Что доработать<textarea name="comment" rows="2" placeholder="Например: добавить гараж, сделать 3 спальни"></textarea></label>
      <div class="nav"><span class="err-t" id="prErr"></span><button class="btn primary" type="submit">Отправить запрос</button></div></form>`;
  $('#prDlg').showModal();
  $('[data-close]', $('#prBody')).onclick = () => $('#prDlg').close();
  $$('.gal img', $('#prBody')).forEach(im => im.onclick = () => im.classList.toggle('big'));
  const sr = $('[data-rate]', $('#prBody'));
  $$('button', sr).forEach(b => b.onclick = async () => {
    if (!user) { $('#prDlg').close(); openAuth(() => openProject(id)); return; }
    try { const r = await api(`/api/projects/${id}/rate`, { stars: +b.dataset.s }); $('#prRate').textContent = `${r.rating.avg.toFixed(1)} из 5 · оценок: ${r.rating.n}`; $$('button', sr).forEach((q, i) => q.classList.toggle('on', i < +b.dataset.s)); }
    catch (e) { $('#prRate').textContent = e.message; }
  });
  const op = $('#prOpen'); if (op) op.onclick = () => { DK.appApi.load(x.project); $('#prDlg').close(); DK.goPage('project'); DK.toast && DK.toast('Проект открыт в конструкторе — правьте под себя'); };
  $('#prReq').onclick = () => { $('#prForm').hidden = false; };
  $('#prForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api(`/api/projects/${id}/request`, { name: f.name.value, phone: f.phone.value, comment: f.comment.value }); f.innerHTML = '<div class="box"><b>Запрос отправлен</b><span>Менеджер площадки свяжется с вами, согласует оплату и передачу эскизного проекта.</span></div>'; }
    catch (er) { $('#prErr').textContent = er.message; }
  };
}

/* ---------- кабинет ---------- */
async function renderCab() {
  const el = $('#cabBody');
  if (!user) { el.innerHTML = '<div class="empty"><b>Войдите или зарегистрируйтесь</b><p>В кабинете — ваши проекты, запросы покупателей, рейтинг и статус архитектора.</p><button class="btn primary" id="cabLogin">Войти</button></div>'; $('#cabLogin').onclick = () => openAuth(); return; }
  let d; try { d = await api('/api/my'); } catch (e) { el.innerHTML = `<div class="empty"><b>Кабинет недоступен</b><p>${esc(e.message)}</p></div>`; return; }
  user = d.user; paintHeader();
  const st = { none: 'не подана', pending: 'на проверке', verified: 'подтверждён ✓', rejected: 'отклонена — пришлите другие документы' }[user.archStatus];
  el.innerHTML = `<div class="cols">
    <div class="card"><h2>${esc(user.name)}</h2><div class="muted">${esc(user.email)} · ${esc(user.phone || '')}</div>
      <div class="box"><b>Статус архитектора: ${st}</b><span>Подтверждённые архитекторы получают отметку ✓ у проектов и попадают в каталог архитекторов.</span></div>
      ${user.archStatus !== 'verified' && user.archStatus !== 'pending' ? `<form id="archForm" class="q"><label class="fld">Диплом (вуз, специальность, год)<input name="diploma" required></label>
        <div class="row2"><label class="fld">СРО / членство (если есть)<input name="sro"></label><label class="fld">Сайт или портфолио<input name="site"></label></div>
        <label class="fld">О себе<textarea name="about" rows="2"></textarea></label>
        <label class="fld">Скан диплома и документов (PDF, JPG, PNG, до 8 МБ)<input type="file" name="docs" accept=".pdf,.jpg,.jpeg,.png" multiple required></label>
        <div class="nav"><span class="err-t" id="arErr"></span><button class="btn primary" type="submit">Отправить на проверку</button></div></form>` : ''}
      <div class="row"><button class="btn" id="cabPub">Опубликовать текущий проект</button><button class="btn ghost" id="cabOut">Выйти</button></div></div>
    <div class="card"><h2>Мои проекты</h2>${d.projects.length ? d.projects.map(x => `<div class="mine"><div class="row between"><b>${esc(x.title)}</b>${stars(x.rating.avg)}</div>
      <div class="row"><span class="muted">${DK.fmtA(x.area)} м² · ${x.status === 'published' ? 'опубликован' : 'скрыт'}</span>
      <label class="fld" style="flex-direction:row;align-items:center;gap:6px">Цена, ₽ <input type="number" data-price="${esc(x.id)}" value="${x.price}" step="500" min="0" style="width:110px"></label>
      <button class="btn sm ghost" data-hide="${esc(x.id)}" data-st="${x.status === 'published' ? 'hidden' : 'published'}">${x.status === 'published' ? 'Скрыть' : 'Показать'}</button></div>
      ${x.requests.length ? `<div class="muted">Запросы: ${x.requests.map(r => `${esc(r.name)} — ${new Date(r.at).toLocaleDateString('ru-RU')}`).join('; ')}</div>` : '<div class="muted">Запросов пока нет</div>'}</div>`).join('') : '<div class="muted">Пока нет опубликованных проектов.</div>'}
      ${d.asked.length ? `<h2 style="margin-top:12px">Мои запросы</h2>${d.asked.map(a => `<div class="mine"><b>${esc(a.title)}</b> <span class="muted">${money(a.price)} · ${a.granted ? 'доступ открыт' : 'ждёт оплаты'}</span></div>`).join('')}` : ''}
    </div></div>`;
  $('#cabOut').onclick = async () => { try { await api('/api/auth/logout', {}); } catch (e) { /* уже вышли */ } setToken(null); user = null; paintHeader(); renderCab(); };
  $('#cabPub').onclick = () => { DK.goPage('project'); openPublish(); };
  $$('[data-price]', el).forEach(i => i.onchange = async () => { await api('/api/my/project/' + i.dataset.price, { price: +i.value || 0 }); DK.toast && DK.toast('Цена сохранена'); });
  $$('[data-hide]', el).forEach(b => b.onclick = async () => { await api('/api/my/project/' + b.dataset.hide, { status: b.dataset.st }); renderCab(); });
  const af = $('#archForm');
  if (af) af.onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const files = await fileData(f.docs); await api('/api/architect/apply', { diploma: f.diploma.value, sro: f.sro.value, site: f.site.value, about: f.about.value, files }); renderCab(); }
    catch (er) { $('#arErr').textContent = er.message; }
  };
}

DK.Market = {
  init() {
    bindAuth(); bindPublish();
    // «Личный кабинет»: меню для клиентов, компаний, архитекторов и вход для сотрудников
    const menu = $('#cabMenu'), btn = $('#cabBtn');
    const toggle = (on) => { menu.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
    btn.onclick = (e) => { e.stopPropagation(); toggle(menu.hidden); };
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) toggle(false); });
    $$('[data-cab]', menu).forEach(b => b.onclick = () => { toggle(false); DK.Market.openCabinet(b.dataset.cab); });
    $$('[data-act="publish"]').forEach(b => b.onclick = openPublish);
    $('[data-close]', $('#prDlg')) && ($('[data-close]', $('#prDlg')).onclick = () => $('#prDlg').close());
    $('#projQ').oninput = (e) => { flt.q = e.target.value; clearTimeout(this.t); this.t = setTimeout(renderProjects, 250); };
    $('#projSort').onchange = (e) => { flt.sort = e.target.value; renderProjects(); };
    refreshMe();
  },
  renderProjects, renderCab, openPublish,
  /* кабинет по роли: компания — кабинет заявок, остальные — кабинет пользователя */
  openCabinet(kind) {
    if (kind === 'company') { if (user && user.role === 'company') return DK.goPage('company'); return openAuth(() => DK.goPage(user && user.role === 'company' ? 'company' : 'cab'), 'company'); }
    if (user) return DK.goPage('cab');
    openAuth(() => DK.goPage('cab'), kind === 'arch' ? 'arch' : undefined);
  },
  user: () => user, api: (...a) => api(...a),
};
})();
