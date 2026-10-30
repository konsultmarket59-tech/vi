/* Проекты пользователей: вход, кабинет, заявка архитектора, публикация с ценой, каталог со звёздами, запрос эскизного проекта */
(function () {
'use strict';
const DK = window.DK;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => DK.esc(s);
const TK = 'dk-token';
let token = null, user = null, readyOk;
const readyP = new Promise(r => { readyOk = r; }); // кабинет ждёт проверки входа, даже если открыт по ссылке до init()
try { token = localStorage.getItem(TK); } catch (e) { /* без хранилища — вход на сессию */ }

async function api(path, data, method) {
  if (location.protocol === 'file:') throw new Error('Регистрация и кабинеты заработают, когда сайт будет на сервере. Сейчас их можно посмотреть в демо-версии.');
  const r = await fetch((DK.CONFIG.api || '') + path, { method: method || (data ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: data ? JSON.stringify(data) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { throw new Error('Сервер площадки недоступен'); }
  if (!r.ok) { const er = new Error(j.error || 'Ошибка ' + r.status); er.status = r.status; er.data = j; throw er; }
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
  // компания: города работы, банки аккредитации
  const chip = (n, v) => `<label><input type="checkbox" name="${n}" value="${esc(v)}">${esc(v)}</label>`;
  if ($('#aCities')) $('#aCities').innerHTML = DK.CITIES.map(c => chip('city_w', c)).join('');
  if ($('#aBanks')) $('#aBanks').innerHTML = DK.BANKS.map(b => chip('bank', b)).join('');
  $$('#aReg [name=accr]').forEach(r => r.onchange = () => { $('#aBanks').hidden = $('#aReg').accr.value !== 'yes'; });
  $('#aLogin').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const r = await api('/api/auth/login', { email: f.email.value, password: f.password.value }); setToken(r.token); user = r.user; done(); }
    catch (er) { $('#aErr').textContent = er.message; }
  };
  $('#aReg').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.agree.checked) { $('#aErr').textContent = 'Нужно согласие на обработку данных и с правилами площадки'; return; }
    try {
      if (authKind === 'company') {
        // строительная компания: аккаунт и карточка, проверка менеджером в CRM
        if (!f.company.value.trim()) throw new Error('Укажите название компании');
        const cities = $$('#aCities input:checked').map(i => i.value).concat(f.regions.value.split(',').map(x => x.trim()).filter(Boolean));
        if (!cities.length) throw new Error('Отметьте города, где вы строите');
        const banks = f.accr.value === 'yes' ? $$('#aBanks input:checked').map(i => i.value) : [];
        if (f.accr.value === 'yes' && !banks.length) throw new Error('Отметьте банки, в которых есть аккредитация');
        const g = await DK.guard.data(f);
        const r = await api('/api/company/register', { ...g, name: f.company.value, contact: f.name.value, inn: f.inn.value, cities, banks, escrow: f.escrow.checked, email: f.email.value, phone: f.phone.value, city: f.city.value, password: f.password.value });
        setToken(r.token); user = r.user; $('#authDlg').close(); paintHeader(); afterAuth = null; DK.goPage('company'); return;
      }
      const g = await DK.guard.data(f);
      const r = await api('/api/auth/register', { ...g, name: f.name.value, email: f.email.value, phone: f.phone.value, city: f.city.value, password: f.password.value });
      setToken(r.token); user = r.user;
      if (f.arch.checked) {
        const files = await fileData(f.docs);
        const a = await api('/api/architect/apply', { diploma: f.diploma.value, sro: f.sro.value, site: f.site.value, about: f.about.value, files });
        user = a.user; DK.toast && DK.toast('Документы отправлены на проверку');
      }
      done();
    } catch (er) { $('#aErr').textContent = er.message; DK.guard.reset(f); }
  };
  function done() { $('#authDlg').close(); paintHeader(); const t = afterAuth; afterAuth = null; if (user && user.role === 'company') DK.goPage('company'); else if (t) t(); else DK.goPage('cab'); }
}

/* ---------- верификация: значок на карточке, статус в кабинете ---------- */
const VPRICE = () => money(DK.CONFIG.verifyPrice || 15000);
const isVer = (x) => !!(x.verify && x.verify.status === 'verified');
const VBADGE = () => `<span class="verified" title="Планировку проверили архитектор и инженер платформы и при необходимости исправили">${DK.icon ? DK.icon('badge-check', 16) : ''}Проверено</span>`;
const VSTATUS = { requested: 'заявка принята, ждёт оплаты', paid: 'оплачено, скоро возьмём в работу', in_work: 'архитектор и инженер проверяют проект', verified: 'проверено', rejected: 'отклонено — менеджер расскажет, что поправить', outdated: 'проект изменён после проверки — отметка снята', none: 'отметка снята' };

/* ---------- публикация и сохранение в кабинет: сначала фильтр качества ---------- */
let pubVis = 'published';
const qLi = (lv, c) => `<li class="${lv}">${esc(c.txt)}${c.fid ? `<button type="button" data-fid="${esc(c.fid)}">показать</button>` : ''}</li>`;
function qualityBox(q) {
  const el = $('#pubQ'); el.hidden = false; el.className = 'qbox' + (q.ok ? ' ok' : '');
  el.innerHTML = q.ok ? `<b>Проверка пройдена — проект можно сохранить</b>${q.warns.length ? `<span class="muted">Замечаний: ${q.warns.length}. Их можно поправить и позже.</span>` : ''}`
    : `<b>${q.errs.length ? `Проект пока нельзя сохранить — исправьте ошибки (${q.errs.length})` : `Слишком много замечаний: ${q.warns.length} (допустимо до ${DK.QUALITY.maxWarn}) — исправьте хотя бы часть`}</b>
      <ul>${q.errs.map(c => qLi('err', c)).join('')}${q.warns.slice(0, 12).map(c => qLi('warn', c)).join('')}</ul><div><button type="button" class="btn sm primary" id="qFix">Исправить в конструкторе</button></div>`;
  const fix = (fid) => { $('#pubDlg').close(); DK.goPage('project'); if (fid) DK.appApi.floor(fid); const c = $('#checks'); if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1600); } };
  $$('button[data-fid]', el).forEach(b => b.onclick = () => fix(b.dataset.fid));
  if ($('#qFix')) $('#qFix').onclick = () => fix(null);
  $('button[type=submit]', $('#pubForm')).disabled = !q.ok;
}
function setVis(v) {
  pubVis = v; $$('#pubVis button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  const P = DK.appApi.project(), upd = !!P.cloudId;
  $('#pubTitle').textContent = v === 'private' ? (upd ? 'Обновить проект в кабинете' : 'Сохранить проект в кабинет') : (upd ? 'Обновить и опубликовать' : 'Опубликовать проект');
  $('button[type=submit]', $('#pubForm')).textContent = v === 'private' ? 'Сохранить в кабинет' : 'Опубликовать';
}
async function openPublish(vis) {
  if (!user) { openAuth(() => openPublish(vis), 'reg'); return; }
  const P = DK.appApi.project(), A = DK.areas(P);
  const f = $('#pubForm'); f.reset(); f.title.value = P.cloudTitle || (P.name && P.name !== 'Мой дом' ? P.name : `Дом ${DK.fmtA(A.total)} м²`);
  $('#pErr').textContent = ''; $('#pubInfo').textContent = `${DK.fmtA(A.total)} м², ${DK.floorsOf(P).length} эт., ${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м${P.cloudId ? ' · обновит сохранённый проект' : ''}`;
  setVis(typeof vis === 'string' ? vis : 'published');
  $('#pubVerPrice').textContent = VPRICE();
  qualityBox(DK.quality(P));
  $('#pubDlg').showModal();
}
function bindPublish() {
  $('[data-close]', $('#pubDlg')).onclick = () => $('#pubDlg').close();
  $$('#pubVis button').forEach(b => b.onclick = () => setVis(b.dataset.v));
  $('#pubForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (!f.own.checked) { $('#pErr').textContent = 'Подтвердите, что проект ваш и вы согласны с правилами'; return; }
    const q = DK.quality(DK.appApi.project()); if (!q.ok) { qualityBox(q); return; }
    const btn = $('button[type=submit]', f), label = btn.textContent; btn.disabled = true; btn.textContent = 'Сохраняю…';
    try {
      const p = DK.appApi.project(), A = DK.areas(p), imgs = await DK.appApi.images();
      const r = await api('/api/projects', { id: p.cloudId || undefined, visibility: pubVis, title: f.title.value, about: f.about.value, price: +f.price.value || 0, license: f.license.value, project: p, images: imgs, verify: f.verify.checked,
        area: Math.round(A.total * 10) / 10, floors: DK.floorsOf(p).length, size: `${DK.fmtM(A.outW)} × ${DK.fmtM(A.outD)} м` });
      DK.appApi.setCloud(r.id, f.title.value);
      $('#pubDlg').close();
      if (r.verifyAsked) setTimeout(() => DK.toast && DK.toast('Заявка на верификацию принята — менеджер свяжется по оплате'), 1800);
      if (pubVis === 'private') { DK.toast && DK.toast(r.updated ? 'Проект обновлён в кабинете' : 'Проект сохранён в кабинет'); }
      else { DK.toast && DK.toast(r.updated ? 'Проект обновлён' : 'Проект опубликован'); DK.goPage('projects'); setTimeout(() => openProject(r.id), 300); }
    } catch (er) {
      if (er.status === 403 && /не ваш/.test(er.message)) { DK.appApi.setCloud(null); $('#pErr').textContent = 'Это чужой проект — сохраним его как ваш новый. Нажмите ещё раз.'; }
      else { $('#pErr').textContent = er.message; if (er.data && er.data.quality) qualityBox(er.data.quality); }
    }
    btn.disabled = false; btn.textContent = label;
  };
}

/* ---------- каталог проектов ---------- */
const flt = { q: '', sort: 'rating', type: '', area: '', floors: '', budget: '' };
async function renderProjects() {
  const el = $('#projList');
  const qf = $('#projQf'); if (qf && !qf.dataset.ok) { qf.dataset.ok = '1'; qf.innerHTML = DK.qfHtml(); $$('[data-qf]', qf).forEach(s => s.onchange = () => { flt[s.dataset.qf] = s.value; renderProjects(); }); }
  if (qf) $$('[data-qf]', qf).forEach(s => { s.value = flt[s.dataset.qf] || ''; });
  el.innerHTML = '<div class="muted">Загружаю…</div>';
  let list;
  try { list = await api(`/api/projects?sort=${flt.sort}&q=${encodeURIComponent(flt.q)}`); }
  catch (e) { el.innerHTML = `<div class="empty"><b>Каталог проектов на сервере площадки</b><p>${esc(e.message)}. Здесь появятся проекты пользователей и архитекторов с ценой и рейтингом.</p></div>`; return; }
  const all = list.length; list = list.filter(x => DK.qfMatch(x, flt));
  if (!list.length) { el.innerHTML = all ? '<div class="empty"><b>Нет проектов по этим условиям</b><p>Смягчите фильтр — или спроектируйте свой дом в конструкторе.</p></div>' : '<div class="empty"><b>Пока пусто</b><p>Опубликуйте свою планировку первым — кнопка «Опубликовать проект» в конструкторе.</p></div>'; return; }
  el.innerHTML = list.map(DK.projCard).join('');
  $$('.pcard2', el).forEach(a => { a.onclick = () => openProject(a.dataset.id); a.onkeydown = (e) => { if (e.key === 'Enter') a.click(); }; });
}
async function openProject(id) {
  let x; try { x = await api('/api/projects/' + id); } catch (e) { DK.toast && DK.toast(e.message); return; }
  const base = (DK.CONFIG.api || '') + `/api/projects/${x.id}/file/`;
  $('#prBody').innerHTML = `<header><div><h2>${esc(x.title)} ${isVer(x) ? VBADGE() : ''}</h2><div class="muted">${DK.fmtA(x.area)} м² · ${x.floors} эт. · ${esc(x.size || '')} · ${esc(x.author.name)} ${archBadge(x.author)}</div></div><button class="x" type="button" data-close aria-label="Закрыть">×</button></header>
    <div class="gal">${x.files.map(f => `<img src="${base}${esc(f)}" alt="">`).join('')}</div>
    ${x.about ? `<p>${esc(x.about)}</p>` : ''}
    ${isVer(x) ? `<div class="box vbox">${DK.icon ? DK.icon('badge-check', 20) : ''}<div><b>Проверено платформой</b><span>Архитектор и инженер «Логики Дома» проверили планировку и конструктив${x.verify.fixed ? ' и внесли исправления' : ''}.</span></div></div>` : ''}
    <div class="row">${stars(x.rating.avg, x.id, true)}<span class="muted" id="prRate">${x.rating.n ? x.rating.avg.toFixed(1) + ' из 5 · оценок: ' + x.rating.n : 'Оцените проект'}</span></div>
    <div class="box"><b>${money(x.price)}</b><span>${x.license === 'build' ? 'Право построить по эскизу: автор передаёт эскизный проект для строительства одного дома.' : 'Эскизный проект для ознакомления и доработки с архитектором.'} Оплата и передача — через площадку.</span></div>
    <div class="nav">${x.project ? '<button class="btn" id="prOpen">Открыть в конструкторе</button>' : '<span class="muted">Файл проекта откроется после оплаты.</span>'}<button class="btn gold" id="prReq">${x.price ? 'Запросить эскизный проект' : 'Связаться с автором'}</button></div>
    <form id="prForm" class="q" data-guard hidden>${DK.guard.trap}<div class="row2"><label class="fld">Имя<input name="name" value="${esc(user ? user.name : '')}" required></label><label class="fld">Телефон<input name="phone" type="tel" value="${esc(user ? user.phone : '')}" required></label></div>
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
  const op = $('#prOpen'); if (op) op.onclick = () => { DK.appApi.load(x.project); DK.appApi.setCloud(x.mine ? x.id : null, x.mine ? x.title : null); $('#prDlg').close(); DK.goPage('project'); DK.toast && DK.toast('Проект открыт в конструкторе — правьте под себя'); };
  $('#prReq').onclick = () => { $('#prForm').hidden = false; };
  $('#prForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const g = await DK.guard.data(f); await api(`/api/projects/${id}/request`, { ...g, name: f.name.value, phone: f.phone.value, comment: f.comment.value }); f.innerHTML = '<div class="box"><b>Запрос отправлен</b><span>Менеджер площадки свяжется с вами, согласует оплату и передачу эскизного проекта.</span></div>'; }
    catch (er) { $('#prErr').textContent = er.message; }
  };
}

/* ---------- кабинет ---------- */
const ST = { published: 'опубликован в каталоге', hidden: 'скрыт из каталога', private: 'сохранён в кабинете', blocked: 'заблокирован модератором' };
async function getProject(id) { const x = await api('/api/projects/' + id); if (!x.project) throw new Error('Файл проекта недоступен'); return x; }
/* файлы для архитектора: IFC (модель для ArchiCAD) и DXF (листы по слоям), бесплатно — для проектов на платформе */
function openCad(id, title) {
  const d = $('#cadDlg'); $('#cadTitle').textContent = title || 'Проект'; $('#cadErr').textContent = ''; d.showModal();
  const name = () => 'proekt-' + id;
  $('#cadIfc').onclick = async () => { try { const x = await getProject(id); DK.download(DK.exportIFC(x.project, { name: x.title }), name() + '.ifc', 'application/x-step'); } catch (e) { $('#cadErr').textContent = e.message; } };
  $('#cadDxf').onclick = async () => { try { const x = await getProject(id); DK.download(DK.exportDXF(x.project, { name: x.title, dimOuter: $('#cadOuter').checked, dimInner: $('#cadInner').checked }), name() + '.dxf', 'application/dxf'); } catch (e) { $('#cadErr').textContent = e.message; } };
}
/* платные выгрузки проекта: ЭП в PDF и файлы для ArchiCAD — пример состава, оплата по ссылке банка, код из письма */
const EP_SHEETS = [['1', 'Титульный лист: вид дома, площади, этажность'], ['2', 'Планы этажей: размеры, марки и экспликация помещений, преимущества планировки'], ['3', 'Разрез 1–1 с отметками; фундамент — типовая ж/б плита'],
  ['4', 'Четыре фасада с высотными отметками'], ['5', 'Виды дома в 3D с разных сторон'], ['6', 'Характеристики дома и техзадание на расчёт для строителей']];
const EP_LIST = ['Титульный лист с видом дома и ключевыми цифрами', 'План каждого этажа: размеры, марки помещений, экспликация, преимущества планировки', 'Схема участка с отступами по нормам — если участок задан во вкладке «Участок»',
  'Разрез 1–1 с высотными отметками; фундамент — типовая монолитная ж/б плита', 'Фасады со всех четырёх сторон с отметками', 'Виды дома в 3D', 'Характеристики дома и техзадание на расчёт для строительных компаний'];
const CAD_LIST = ['IFC — модель для ArchiCAD, Revit, Renga: стены, перекрытия, окна, двери, помещения с площадями', 'DXF — для ArchiCAD, AutoCAD, nanoCAD: каждый этаж на своём листе А3 с рамкой и штампом',
  'Слои: стены, перегородки, проёмы, помещения, размеры, экспликация — включаются и выключаются', 'Наружные и внутренние размеры — по вашему выбору при выгрузке'];
let unlockSet = null;
function openPay(kind, x, after) {
  let d = $('#payDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'payDlg'; d.className = 'pay-dlg'; document.body.appendChild(d); }
  const S = (unlockSet || {})[kind] || {}, price = money(S.price || (kind === 'ep' ? DK.CONFIG.sketchPrice : DK.CONFIG.cadPrice) || 3000), ep = kind === 'ep';
  d.innerHTML = `<form method="dialog" class="dlg pay"><header><div><small class="over">${esc(x.title)}</small><h2>${ep ? 'Эскизный проект в PDF' : 'Файлы для ArchiCAD'} — ${price}</h2></div><button class="x" type="submit" aria-label="Закрыть">×</button></header>
    <p class="muted">${ep ? 'Листы формата А3 по вашему проекту — для строителей, банка и архитектора. Так выглядит эскизный проект:' : 'Модель и чертежи вашего проекта для архитектора: открываются в ArchiCAD и других программах. Так выглядит лист DXF:'}</p>
    ${ep ? `<div class="pay-g">${EP_SHEETS.map(([n, t]) => `<figure><img src="brand/img/ep/${n}.jpg" alt="${esc(t)}" loading="lazy"><figcaption>${esc(t)}</figcaption></figure>`).join('')}</div>`
      : `<div class="pay-g one"><figure><img src="brand/img/ep/cad.jpg" alt="Лист DXF: план этажа с размерами, марками и экспликацией" loading="lazy"><figcaption>DXF: план этажа на листе А3 — размеры, марки помещений, экспликация, штамп</figcaption></figure></div>`}
    <details class="hint"${ep ? '' : ' open'}><summary>${ep ? 'Состав эскизного проекта' : 'Что входит'}</summary><ul>${(ep ? EP_LIST : CAD_LIST).map(t => `<li>${esc(t)}</li>`).join('')}</ul>${ep ? '<p>Эскизный проект показывает дом и планировку; в нём применяется типовой фундамент — монолитная ж/б плита. Тип фундамента под ваш участок подбирают в АКР по геологии и топосъёмке.</p>' : ''}<p>Оплата один раз за проект: после правок выгружайте сколько угодно.</p></details>
    ${ep && x.mine !== false ? '<button type="button" class="btn sm ghost" id="payPreview">Посмотреть листы своего проекта (с отметкой «Образец»)</button>' : ''}
    <div class="pay-steps"><div><b>1</b><span>${S.url ? `<a class="btn primary" href="${esc(S.url)}" target="_blank" rel="noopener">Оплатить ${price}</a>` : '<button type="button" class="btn primary" id="payAsk">Получить ссылку на оплату</button>'}<small class="muted">${S.url ? 'Оплата на странице банка, чек придёт на почту.' : 'Менеджер пришлёт ссылку на оплату на вашу почту.'}</small></span></div>
      <div><b>2</b><span>Код придёт на почту — введите его:<span class="row"><input id="payCode" placeholder="LD-XXXX-XXXX" autocomplete="off"><button type="button" class="btn" id="payGo">Открыть выгрузку</button></span><span class="err-t" id="payErr"></span></span></div></div>
  </form>`;
  d.showModal();
  $$('.pay-g img', d).forEach(im => im.onclick = () => window.open(im.src, '_blank'));
  const prev = $('#payPreview', d); if (prev) prev.onclick = () => { d.close(); openSketchFor(x.id, x.mine !== false); };
  const ask = $('#payAsk', d); if (ask) ask.onclick = async () => { ask.disabled = true; try { await api('/api/my/project/' + x.id, { payRequest: kind }); ask.textContent = 'Запрос отправлен — ждите письмо'; } catch (e) { $('#payErr', d).textContent = e.message; ask.disabled = false; } };
  $('#payGo', d).onclick = async () => {
    const code = $('#payCode', d).value.trim(); if (!code) { $('#payErr', d).textContent = 'Введите код из письма'; return; }
    try { await api('/api/my/project/' + x.id, { unlock: { kind, code } }); d.close(); DK.toast && DK.toast(ep ? 'Эскизный проект открыт — можно выгружать' : 'Файлы для ArchiCAD открыты — можно выгружать'); lockCache = null; if (after) after(); else renderCab(); }
    catch (e) { $('#payErr', d).textContent = e.message; }
  };
}
// открыта ли выгрузка у проекта: для окна ЭП в конструкторе
let lockCache = null, sketchId = null;
async function unlocked(id, kind) {
  if (!user || !id) return false;
  try { if (!lockCache) lockCache = await api('/api/my'); unlockSet = lockCache.unlock || unlockSet; const x = lockCache.projects.concat(lockCache.shared || []).find(q => q.id === id); return x ? { ok: !!(x.unlock && x.unlock[kind]), x: Object.assign({ mine: lockCache.projects.includes(x) }, x) } : false; }
  catch (e) { return false; }
}
/* эскизный проект PDF: проект открывается в конструкторе и собираются листы */
async function openSketchFor(id, mine) {
  sketchId = id;
  try { const x = await getProject(id); DK.appApi.load(x.project); if (mine) DK.appApi.setCloud(x.id, x.title); DK.goPage('project'); setTimeout(() => DK.appApi.sketch(), 300); }
  catch (e) { DK.toast && DK.toast(e.message); }
}
/* архитектор проекта: из каталога платформы или свой — по почте */
async function openTeam(id, title) {
  const d = $('#teamDlg'); $('#teamTitle').textContent = title; $('#teamErr').textContent = ''; $('#teamEmail').value = '';
  const sel = $('#teamPick'); sel.innerHTML = '<option value="">Загружаю…</option>'; d.showModal();
  try { const list = await api('/api/architects'); sel.innerHTML = '<option value="">— выберите архитектора —</option>' + list.map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.city ? ', ' + esc(a.city) : ''}</option>`).join(''); if (!list.length) sel.innerHTML = '<option value="">Пока нет подтверждённых архитекторов</option>'; }
  catch (e) { sel.innerHTML = '<option value="">Каталог недоступен</option>'; }
  $('#teamForm').onsubmit = async (e) => {
    e.preventDefault();
    const add = sel.value ? { id: sel.value } : { email: $('#teamEmail').value.trim() };
    try { await api('/api/my/project/' + id, { addArch: add }); d.close(); DK.toast && DK.toast('Архитектор добавлен — ему пришло письмо'); renderCab(); } catch (er) { $('#teamErr').textContent = er.message; }
  };
}
/* реалистичные визуализации: баланс, код активации, пакеты (оплата на странице банка), история */
const VIZ_KIND = { code: 'Код активации', grant: 'Начисление', render: 'Визуализация', refund: 'Возврат' };
function vizCard(v) {
  if (!v) return '';
  const word = (n) => n % 10 === 1 && n % 100 !== 11 ? 'визуализация' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'визуализации' : 'визуализаций';
  return `<div class="viz"><div class="viz-h"><div><b>Реалистичные визуализации</b><span class="muted">Фотореалистичный рендер дома снаружи или интерьера по снимку из конструктора</span></div><div class="viz-bal"><b>${v.balance}</b><small>${word(v.balance)}</small></div></div>
    ${v.ready ? '' : '<div class="muted viz-soon">Генерация появится на сайте в ближайшее время — купленные визуализации сохранятся на балансе.</div>'}
    <form id="vizForm" class="viz-code"><input name="code" placeholder="Код вида LD-XXXX-XXXX" autocomplete="off" required><button class="btn primary" type="submit">Активировать</button></form><div class="err-t" id="vizErr"></div>
    ${v.packs.some(p => p.url) ? `<div class="viz-packs">${v.packs.filter(p => p.url).map(p => `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noopener">${p.n} ${word(p.n)} — ${money(p.price)}</a>`).join('')}</div><div class="muted" style="font-size:12px">Оплата на странице банка. Код придёт на почту — введите его здесь.</div>` : ''}
    ${v.history.length ? `<details class="viz-hist"><summary>История</summary>${v.history.map(e => `<div><span>${new Date(e.at).toLocaleDateString('ru-RU')} · ${e.kind === 'code' ? 'Код ' + esc(e.ref) : esc(e.note || VIZ_KIND[e.kind] || e.kind)}</span><b>${e.delta > 0 ? '+' : ''}${e.delta}</b></div>`).join('')}</details>` : ''}</div>`;
}
async function renderCab() {
  const el = $('#cabBody');
  await readyP;
  if (!user) { el.innerHTML = '<div class="empty"><b>Войдите или зарегистрируйтесь</b><p>В кабинете — ваши проекты, эскизный проект в PDF, файлы для ArchiCAD, верификация и запросы покупателей.</p><button class="btn primary" id="cabLogin">Войти</button></div>'; $('#cabLogin').onclick = () => openAuth(); return; }
  let d; try { d = await api('/api/my'); } catch (e) { el.innerHTML = `<div class="empty"><b>Кабинет недоступен</b><p>${esc(e.message)}</p></div>`; return; }
  user = d.user; paintHeader();
  const st = { none: 'не подана', pending: 'на проверке', verified: 'подтверждён', rejected: 'отклонена — пришлите другие документы' }[user.archStatus];
  const vp = money(d.verifyPrice || DK.CONFIG.verifyPrice || 15000);
  unlockSet = d.unlock || unlockSet; lockCache = d;
  const U = (k) => money(((unlockSet || {})[k] || {}).price || 3000);
  // выгрузки: открытые — сразу, неоплаченные — с ценой, окно с примером и оплатой
  const expBtns = (x, mine) => `${x.unlock && x.unlock.ep ? `<button class="btn sm" data-${mine ? 'pdf' : 'pdfs'}="${esc(x.id)}">Эскизный проект PDF</button>` : `<button class="btn sm" data-pay="ep" data-id="${esc(x.id)}" data-mine="${mine ? 1 : 0}">Эскизный проект PDF · ${U('ep')}</button>`}
        ${x.unlock && x.unlock.cad ? `<button class="btn sm" data-cad="${esc(x.id)}" data-t="${esc(x.title)}">Файлы для ArchiCAD</button>` : `<button class="btn sm" data-pay="cad" data-id="${esc(x.id)}" data-mine="${mine ? 1 : 0}">Файлы для ArchiCAD · ${U('cad')}</button>`}`;
  const proj = (x) => `<article class="mine">
      <div class="row between"><b class="mt">${esc(x.title)}</b>${isVer(x) ? VBADGE() : stars(x.rating.avg)}</div>
      <div class="muted">${DK.fmtA(x.area)} м² · ${x.floors} эт. · ${ST[x.status] || x.status}${x.boost ? ' · в подборке' : ''}</div>
      ${x.status === 'blocked' ? `<div class="err-t">Причина: ${esc(x.blockReason || 'не соответствует правилам')}. Исправьте проект и напишите нам.</div>` : ''}
      <div class="acts">
        <button class="btn sm primary" data-open="${esc(x.id)}">Открыть в конструкторе</button>
        ${expBtns(x, true)}
        ${x.status === 'blocked' ? '' : `<button class="btn sm ghost" data-hide="${esc(x.id)}" data-st="${x.status === 'published' ? 'hidden' : 'published'}">${x.status === 'published' ? 'Скрыть из каталога' : 'Опубликовать в каталоге'}</button>`}
      </div>
      <div class="sub"><span class="lbl">Верификация</span>${x.verify ? `<span>${isVer(x) ? 'проверено архитектором и инженером платформы' : VSTATUS[x.verify.status] || x.verify.status}</span>` : '<span class="muted">не заказана</span>'}
        ${x.status !== 'blocked' && (!x.verify || ['rejected', 'outdated', 'none'].includes(x.verify.status)) ? `<button class="btn sm" data-verify="${esc(x.id)}">Заказать — ${vp}</button>` : ''}</div>
      <div class="sub"><span class="lbl">Архитектор</span>${(x.team || []).map(m => `<span class="chip">${esc(m.name)}${m.pending ? ' · ждёт регистрации' : ''}<button type="button" data-unteam="${esc(x.id)}" data-k="${esc(m.key)}" aria-label="Убрать">×</button></span>`).join('') || '<span class="muted">не добавлен</span>'}
        <button class="btn sm ghost" data-team="${esc(x.id)}" data-t="${esc(x.title)}">Добавить архитектора</button></div>
      ${x.status === 'blocked' ? '' : `<div class="sub"><span class="lbl">Цена в каталоге</span><input type="number" data-price="${esc(x.id)}" value="${x.price}" step="500" min="0" aria-label="Цена, ₽"> ₽ <span class="muted">0 — бесплатно</span></div>`}
      <div class="sub"><span class="lbl">Запросы</span>${x.requests.length ? x.requests.map(r => `${esc(r.name)} — ${new Date(r.at).toLocaleDateString('ru-RU')}`).join('; ') : '<span class="muted">пока нет</span>'}</div>
    </article>`;
  const shared = (x) => `<article class="mine"><div class="row between"><b class="mt">${esc(x.title)}</b>${isVer(x) ? VBADGE() : ''}</div>
      <div class="muted">${DK.fmtA(x.area)} м² · ${x.floors} эт. · заказчик ${esc(x.client.name)}${x.client.phone ? ', ' + esc(x.client.phone) : ''}${x.client.email ? ', ' + esc(x.client.email) : ''}</div>
      <div class="acts"><button class="btn sm primary" data-viewp="${esc(x.id)}">Открыть в конструкторе</button>${expBtns(x, false)}</div></article>`;
  el.innerHTML = `<div class="cols cab">
    <div class="card"><h2>${esc(user.name)}</h2><div class="muted">${esc(user.email)} · ${esc(user.phone || '')}</div>
      <div class="box"><b>Выгрузки проекта</b><span>Эскизный проект в PDF — ${U('ep')}, файлы для ArchiCAD — ${U('cad')}; оплата один раз за проект.</span><details class="hint"><summary>Подробнее</summary>Нажмите кнопку у проекта — покажем пример листов и состав. Оплата — по ссылке банка, код придёт на почту; введите его у проекта, и выгрузка откроется. После правок выгружайте сколько угодно. Добавьте своего архитектора — проект появится у него в кабинете.</details></div>
      ${vizCard(d.viz)}
      <div class="box"><b>Статус архитектора: ${st}</b><span>Вы архитектор? Подтвердите диплом — получите отметку у проектов, место в каталоге архитекторов и сможете продавать свои проекты.</span></div>
      ${user.archStatus !== 'verified' && user.archStatus !== 'pending' ? `<details class="arch-apply"><summary>Подать заявку архитектора</summary><form id="archForm" class="q"><label class="fld">Диплом (вуз, специальность, год)<input name="diploma" required></label>
        <div class="row2"><label class="fld">СРО / членство (если есть)<input name="sro"></label><label class="fld">Сайт или портфолио<input name="site"></label></div>
        <label class="fld">О себе<textarea name="about" rows="2"></textarea></label>
        <label class="fld">Скан диплома и документов (PDF, JPG, PNG, до 8 МБ)<input type="file" name="docs" accept=".pdf,.jpg,.jpeg,.png" multiple required></label>
        <div class="nav"><span class="err-t" id="arErr"></span><button class="btn primary" type="submit">Отправить на проверку</button></div></form></details>` : ''}
      <div class="row"><button class="btn" id="cabPub">Сохранить текущий проект</button><button class="btn ghost" id="cabOut">Выйти</button></div></div>
    <div class="card"><h2>Мои проекты</h2>${d.projects.length ? d.projects.map(proj).join('') : '<div class="muted">Пока нет сохранённых проектов. В конструкторе нажмите «Опубликовать проект» — можно сохранить только в кабинет, без каталога.</div>'}
      ${d.shared && d.shared.length ? `<h2 style="margin-top:16px">Проекты клиентов</h2><div class="muted">Заказчики добавили вас архитектором — можно открыть проект и выгрузить файлы.</div>${d.shared.map(shared).join('')}` : ''}
      ${d.asked.length ? `<h2 style="margin-top:16px">Мои запросы</h2>${d.asked.map(a => `<div class="mine"><b>${esc(a.title)}</b> <span class="muted">${money(a.price)} · ${a.granted ? 'доступ открыт' : 'ждёт оплаты'}</span></div>`).join('')}` : ''}
    </div></div>`;
  const vf = $('#vizForm');
  if (vf) vf.onsubmit = async (e) => {
    e.preventDefault(); const btn = $('button', vf);
    btn.disabled = true;
    try { const r = await api('/api/my/redeem', { code: vf.code.value }); DK.toast && DK.toast(`Начислено визуализаций: ${r.n}`); renderCab(); }
    catch (er) { $('#vizErr').textContent = er.message; btn.disabled = false; }
  };
  $('#cabOut').onclick = async () => { try { await api('/api/auth/logout', {}); } catch (e) { /* уже вышли */ } setToken(null); user = null; paintHeader(); renderCab(); };
  $('#cabPub').onclick = () => { DK.goPage('project'); openPublish('private'); };
  $$('[data-price]', el).forEach(i => i.onchange = async () => { await api('/api/my/project/' + i.dataset.price, { price: +i.value || 0 }); DK.toast && DK.toast('Цена сохранена'); });
  $$('[data-hide]', el).forEach(b => b.onclick = async () => { try { await api('/api/my/project/' + b.dataset.hide, { status: b.dataset.st }); renderCab(); } catch (er) { DK.toast && DK.toast(er.message); } });
  $$('[data-verify]', el).forEach(b => b.onclick = async () => {
    if (!confirm(`Архитектор и инженер платформы проверят планировку и конструктив, исправят неточности и подготовят проект в разделе АР. Стоимость — ${vp}, оплата по счёту после звонка менеджера. Отправить заявку?`)) return;
    try { await api('/api/my/project/' + b.dataset.verify, { verify: true }); DK.toast && DK.toast('Заявка на верификацию принята'); renderCab(); } catch (er) { DK.toast && DK.toast(er.message); }
  });
  $$('[data-open]', el).forEach(b => b.onclick = async () => { try { const x = await getProject(b.dataset.open); DK.appApi.load(x.project); DK.appApi.setCloud(x.id, x.title); DK.goPage('project'); } catch (er) { DK.toast && DK.toast(er.message); } });
  $$('[data-viewp]', el).forEach(b => b.onclick = async () => { try { const x = await getProject(b.dataset.viewp); DK.appApi.load(x.project); DK.appApi.setCloud(null); DK.goPage('project'); DK.toast && DK.toast('Проект заказчика открыт — ваши правки сохраняются только у вас'); } catch (er) { DK.toast && DK.toast(er.message); } });
  $$('[data-pdf]', el).forEach(b => b.onclick = () => openSketchFor(b.dataset.pdf, true));
  $$('[data-pdfs]', el).forEach(b => b.onclick = () => openSketchFor(b.dataset.pdfs, false));
  $$('[data-cad]', el).forEach(b => b.onclick = () => openCad(b.dataset.cad, b.dataset.t));
  $$('[data-pay]', el).forEach(b => b.onclick = () => { const x = d.projects.concat(d.shared || []).find(q => q.id === b.dataset.id); if (x) openPay(b.dataset.pay, Object.assign({ mine: b.dataset.mine === '1' }, x)); });
  $$('[data-team]', el).forEach(b => b.onclick = () => openTeam(b.dataset.team, b.dataset.t));
  $$('[data-unteam]', el).forEach(b => b.onclick = async () => { try { await api('/api/my/project/' + b.dataset.unteam, { removeArch: b.dataset.k }); renderCab(); } catch (er) { DK.toast && DK.toast(er.message); } });
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
    ['#cadDlg', '#teamDlg'].forEach(q => { const dl = $(q); if (dl) $$('[data-close]', dl).forEach(b => b.onclick = () => dl.close()); });
    $('#projQ').oninput = (e) => { flt.q = e.target.value; clearTimeout(this.t); this.t = setTimeout(renderProjects, 250); };
    $('#projSort').onchange = (e) => { flt.sort = e.target.value; renderProjects(); };
    refreshMe().then(readyOk, readyOk);
  },
  renderProjects, renderCab, openPublish, openProject, ready: readyP, openPay, unlocked, sketchId: () => sketchId, resetSketchId() { sketchId = null; },
  setFilter(f) { Object.assign(flt, f); },
  /* кабинет по роли: компания — кабинет заявок, остальные — кабинет пользователя */
  async openCabinet(kind) {
    await (this.ready || Promise.resolve());
    if (kind === 'company') { if (user && user.role === 'company') return DK.goPage('company'); return openAuth(() => DK.goPage(user && user.role === 'company' ? 'company' : 'cab'), 'company'); }
    if (user) return DK.goPage('cab');
    openAuth(() => DK.goPage('cab'), kind === 'arch' ? 'arch' : undefined);
  },
  user: () => user, api: (...a) => api(...a),
};
})();
