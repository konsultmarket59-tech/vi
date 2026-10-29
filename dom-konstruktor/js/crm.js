/* CRM сотрудников: заявки и карточка клиента, расчёт с ручной правкой, рассылка компаниям, их ответы, цены материалов. */
(function () {
'use strict';
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = (v) => Math.round(+v || 0).toLocaleString('ru-RU') + ' ₽', mln = (v) => (Math.round((+v || 0) / 1e5) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1 }) + ' млн ₽';
const dt = (s) => s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const STATUS = { new: 'Новая', call: 'Созвон', tz: 'ТЗ', calc: 'Расчёты', report: 'Отчёт клиенту', meeting: 'Встреча', paid: 'Лид оплачен', closed: 'Закрыта' };
const GRADE = { hot: 'Горячий', warm: 'Тёплый', cold: 'Холодный' };
let token = localStorage.getItem('crm-token') || '', me = null, META = null, section = 'leads';

// картинки по токену — как data:-адрес (blob: блокируют часть встраиваний и просмотрщиков)
const dataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2600); }
async function api(path, data, method) {
  const r = await fetch(path, { method: method || (data ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: data ? JSON.stringify(data) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { /* пусто */ }
  if (r.status === 401) { showLogin(); throw new Error(j.error || 'Нужен вход'); }
  if (!r.ok) throw new Error(j.error || 'Ошибка ' + r.status);
  return j;
}
function showLogin() { $('#loginView').hidden = false; $('#appView').hidden = true; }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  try { const r = await api('/api/crm/login', { email: f.email.value, password: f.password.value }); token = r.token; localStorage.setItem('crm-token', token); start(); }
  catch (er) { $('#loginErr').textContent = er.message; }
};
$('#logout').onclick = () => { localStorage.removeItem('crm-token'); token = ''; showLogin(); };
$$('#nav button').forEach(b => b.onclick = () => go(b.dataset.s));

async function start() {
  try { META = await api('/api/crm/me'); me = META.user; } catch (e) { return showLogin(); }
  $('#loginView').hidden = true; $('#appView').hidden = false;
  $('#who').textContent = `${me.name} · ${{ admin: 'администратор', estimator: 'сметчик', manager: 'менеджер', marketer: 'маркетолог' }[me.staffRole]}`;
  // разделы по ролям: маркетолог — контент и проекты; контент — администратору и маркетологу
  const allow = me.staffRole === 'admin' ? null : me.staffRole === 'marketer' ? ['content', 'projects'] : ['leads', 'projects', 'companies', 'viz', 'prices', 'grid', 'outbox', 'staff'];
  $$('#nav button').forEach(b => { b.hidden = !!allow && !allow.includes(b.dataset.s); });
  await DK.loadPrices();
  const h = location.hash.slice(1);
  if (h && /^\d/.test(h) && (!allow || allow.includes('leads'))) openLead(h); else if (h.startsWith('cms:')) go('content'); else go(allow ? allow[0] : 'leads');
}
async function go(s) {
  if (section === 'content' && s !== 'content' && DK.CMS && !(await DK.CMS.leave())) return;
  section = s; $$('#nav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.s === s)));
  if (s === 'content') return DK.CMS.render($('#main'), { api, toast, me });
  ({ leads: renderLeads, projects: renderProjects, companies: renderCompanies, prices: renderPrices, grid: renderGrid, outbox: renderOutbox, staff: renderStaff, viz: renderViz })[s]();
}

/* ---------- реалистичные визуализации: коды активации, баланс, пакеты ---------- */
let vizTab = 'codes', vizQ = '';
async function renderViz() {
  history.replaceState(null, '', location.pathname);
  const d = await api('/api/crm/viz'), r = d.report, S = d.settings, m = $('#main'), isAdmin = me.staffRole === 'admin';
  const st = (c) => c.void ? ['аннулирован', 'rejected'] : c.usedBy ? ['активирован', 'approved'] : c.issuedTo ? ['выдан', 'pending'] : ['свободен', ''];
  m.innerHTML = `<h1>Реалистичные визуализации</h1>
  <div class="kpi"><div>Свободных кодов<b>${r.free}</b></div><div>Выдано, не активировано<b>${r.issued}</b></div><div>Активировано кодов<b>${r.used}</b></div><div>Начислено по кодам<b>${r.activated}</b></div><div>Израсходовано<b>${r.spent}</b></div></div>
  <div class="box" style="margin-top:14px"><b>Как продаётся пакет</b><div class="muted">1. Покупатель оплачивает пакет по ссылке банка (ссылки — во вкладке «Пакеты и цены»). 2. Банк присылает вам уведомление об оплате. 3. Здесь нажмите «Выдать код»: код на нужный пакет уйдёт покупателю письмом. 4. Покупатель вводит код в личном кабинете — визуализации начисляются.</div></div>
  <div class="tabs row" style="margin:16px 0 12px">${[['codes', 'Коды'], ['people', 'Пользователи'], ['packs', 'Пакеты и цены']].map(([k, n]) => `<button class="btn sm ${vizTab === k ? 'primary' : ''}" data-vt="${k}">${n}</button>`).join('')}</div><div id="vizBody"></div>`;
  $$('[data-vt]').forEach(b => b.onclick = () => { vizTab = b.dataset.vt; renderViz(); });
  const body = $('#vizBody'), packs = S.packs.map(p => p.n);
  if (vizTab === 'codes') {
    body.innerHTML = `<div class="grid2"><form class="box" id="vIssue"><h2 style="margin-top:0">Выдать код покупателю</h2><div class="muted">Берётся свободный код нужного пакета и уходит письмом на почту покупателя.</div>
        <div class="row" style="margin-top:8px"><select name="n">${packs.map(n => `<option value="${n}">${n} визуализаций</option>`).join('')}</select><input name="email" type="email" placeholder="Почта покупателя" required></div>
        <input name="note" placeholder="Заметка: номер платежа, телефон" style="margin-top:8px"><div style="margin-top:8px"><button class="btn primary">Выдать код и отправить письмо</button></div><div id="vIssueRes" class="muted" style="margin-top:8px"></div></form>
      <form class="box" id="vMake"><h2 style="margin-top:0">Выпустить коды</h2><div class="muted">Запас кодов для продажи. Каждый код активируется один раз.</div>
        <div class="row" style="margin-top:8px"><label class="f">Визуализаций в коде<input name="n" type="number" min="1" max="1000" value="${packs[1] || 10}"></label><label class="f">Сколько кодов<input name="count" type="number" min="1" max="500" value="10"></label></div>
        <input name="note" placeholder="Заметка: партия для блогера, акция" style="margin-top:8px"><div style="margin-top:8px"><button class="btn">Выпустить</button></div></form></div>
    <div class="row" style="margin:14px 0"><input id="vq" placeholder="Поиск: код, почта, заметка" style="max-width:320px" value="${esc(vizQ)}"><button class="btn sm ghost" id="vCsv">Скачать свободные коды (CSV)</button></div>
    <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>Код</th><th class="num">Визуализаций</th><th>Статус</th><th>Кому выдан / кто активировал</th><th>Заметка</th><th>Выпущен</th><th></th></tr></thead><tbody id="vRows"></tbody></table></div>`;
    const draw = () => {
      const q = vizQ.toLowerCase(), rows = d.codes.filter(c => !q || [c.code, c.issuedTo, c.usedName, c.note].join(' ').toLowerCase().includes(q));
      $('#vRows').innerHTML = rows.slice(0, 400).map(c => { const [t, cl] = st(c); return `<tr><td><code>${esc(c.code)}</code></td><td class="num">${c.n}</td><td><span class="badge ${cl}">${t}</span></td>
        <td>${c.usedBy ? esc(c.usedName) + '<br><small class="muted">' + dt(c.usedAt) + '</small>' : c.issuedTo ? esc(c.issuedTo) + '<br><small class="muted">' + dt(c.issuedAt) + ' · ' + esc(c.issuedBy || '') + '</small>' : ''}</td>
        <td>${esc(c.note || '')}</td><td><small>${dt(c.at)}</small></td><td>${!c.usedBy && !c.void ? `<button class="btn sm ghost" data-void="${esc(c.code)}">Аннулировать</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Кодов пока нет — выпустите первую партию</td></tr>';
      $$('[data-void]').forEach(b => b.onclick = async () => { if (!confirm('Аннулировать код ' + b.dataset.void + '? Активировать его будет нельзя.')) return; try { await api('/api/crm/viz/void', { code: b.dataset.void }); toast('Код аннулирован'); renderViz(); } catch (e) { toast(e.message); } });
    };
    draw(); $('#vq').oninput = (e) => { vizQ = e.target.value; draw(); };
    $('#vCsv').onclick = () => { const free = d.codes.filter(c => !c.usedBy && !c.issuedTo && !c.void); const csv = 'code;visualizations;note\n' + free.map(c => [c.code, c.n, (c.note || '').replace(/;/g, ',')].join(';')).join('\n'); const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csv); a.download = 'kody-vizualizacij.csv'; a.click(); };
    $('#vMake').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { const x = await api('/api/crm/viz/codes', { n: +f.n.value, count: +f.count.value, note: f.note.value }); toast('Выпущено кодов: ' + x.codes.length); renderViz(); } catch (er) { toast(er.message); } };
    $('#vIssue').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { const x = await api('/api/crm/viz/issue', { n: +f.n.value, email: f.email.value, note: f.note.value }); $('#vIssueRes').innerHTML = `Код <b>${esc(x.code.code)}</b> ${x.sent ? 'отправлен на ' + esc(f.email.value) : 'выдан. Письмо не ушло (почта не настроена) — отправьте код покупателю сами'}.`; f.email.value = ''; f.note.value = ''; toast('Код выдан'); } catch (er) { toast(er.message); } };
  } else if (vizTab === 'people') {
    body.innerHTML = `<form class="box" id="vGrant" style="max-width:720px"><h2 style="margin-top:0">Начислить или списать</h2><div class="muted">Компенсация, подарок, исправление ошибки. Отрицательное число — списание.</div>
      <div class="row" style="margin-top:8px"><input name="email" type="email" placeholder="Почта пользователя" required><input name="n" type="number" value="1" style="max-width:100px"><input name="note" placeholder="Причина"><button class="btn primary">Провести</button></div></form>
      <div class="box" style="padding:0;overflow:auto;margin-top:14px"><table><thead><tr><th>Пользователь</th><th>Почта</th><th class="num">Баланс</th></tr></thead><tbody>${d.people.sort((a, b) => b.balance - a.balance).map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td class="num">${x.balance}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Пока ни у кого нет визуализаций</td></tr>'}</tbody></table></div>`;
    $('#vGrant').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { const x = await api('/api/crm/viz/grant', { email: f.email.value, n: +f.n.value, note: f.note.value }); toast('Готово, баланс: ' + x.balance); renderViz(); } catch (er) { toast(er.message); } };
  } else {
    body.innerHTML = `<form class="box" id="vPacks" style="max-width:860px"><h2 style="margin-top:0">Пакеты в личном кабинете</h2><div class="muted">Ссылка на оплату — из личного кабинета банка (ЮKassa, Т-Банк, Продамус, Робокасса): «Платёжная ссылка» на сумму пакета. Покупатель платит на странице банка, чек присылает банк.</div>
      <table style="margin-top:10px"><thead><tr><th class="num">Визуализаций</th><th class="num">Цена, ₽</th><th>Ссылка на оплату</th></tr></thead><tbody>${S.packs.concat([{ n: '', price: '', url: '' }]).map((p, i) => `<tr><td><input name="n${i}" type="number" min="1" value="${p.n}" style="width:90px"${isAdmin ? '' : ' disabled'}></td><td><input name="p${i}" type="number" min="0" value="${p.price}" style="width:110px"${isAdmin ? '' : ' disabled'}></td><td><input name="u${i}" value="${esc(p.url)}" placeholder="https://…" ${isAdmin ? '' : ' disabled'}></td></tr>`).join('')}</tbody></table>
      <label class="f" style="max-width:360px;margin-top:10px">Подарок за регистрацию, визуализаций<input name="welcome" type="number" min="0" max="10" value="${S.welcome || 0}"${isAdmin ? '' : ' disabled'}></label>
      ${isAdmin ? '<div style="margin-top:10px"><button class="btn primary">Сохранить</button></div>' : '<div class="muted">Цены и ссылки меняет администратор.</div>'}</form>`;
    if (isAdmin) $('#vPacks').onsubmit = async (e) => { e.preventDefault(); const f = e.target, pk = []; for (let i = 0; i <= S.packs.length; i++) { const n = +f['n' + i].value; if (n > 0) pk.push({ n, price: +f['p' + i].value || 0, url: f['u' + i].value.trim() }); } try { await api('/api/crm/viz/settings', { packs: pk, welcome: +f.welcome.value }, 'PUT'); toast('Сохранено'); renderViz(); } catch (er) { toast(er.message); } };
  }
}

/* ---------- заявки ---------- */
let leadFilter = { status: '', q: '' };
async function renderLeads() {
  history.replaceState(null, '', location.pathname);
  const list = await api('/api/crm/leads');
  const hot = list.filter(l => l.grade === 'hot'), pipe = list.filter(l => !['closed', 'paid'].includes(l.status));
  const m = $('#main');
  m.innerHTML = `<h1>Заявки</h1><div class="kpi"><div>Всего<b>${list.length}</b></div><div>В работе<b>${pipe.length}</b></div><div>Горячих<b>${hot.length}</b></div><div>Цена горячих лидов<b>${mln(hot.reduce((s, l) => s + l.leadPrice, 0))}</b></div></div>
  <div class="row" style="margin:14px 0"><input id="lq" placeholder="Поиск: имя, телефон, город, номер" style="max-width:320px" value="${esc(leadFilter.q)}"><select id="ls" style="max-width:200px"><option value="">Все статусы</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${leadFilter.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Город</th><th class="num">Площадь</th><th class="num">Расчёт / вилка</th><th>Лид</th><th>Статус</th><th class="num">Ответы</th></tr></thead><tbody id="lt"></tbody></table></div>`;
  const draw = () => {
    const q = leadFilter.q.toLowerCase();
    $('#lt').innerHTML = list.filter(l => (!leadFilter.status || l.status === leadFilter.status) && (!q || [l.id, l.name, l.phone, l.city].join(' ').toLowerCase().includes(q))).map(l => `<tr class="click" data-id="${l.id}">
      <td>${esc(l.id)}</td><td>${dt(l.at)}</td><td>${esc(l.name)}<br><small class="muted">${esc(l.phone)}</small></td><td>${esc(l.city)}</td><td class="num">${l.area ? Math.round(l.area) + ' м²' : ''}</td>
      <td class="num">${l.est ? mln(l.est) : l.range ? l.range[0] + '–' + l.range[1] + ' млн' : ''}</td><td><span class="badge ${l.grade}">${GRADE[l.grade]}</span>${l.leadPrice ? `<br><small>${rub(l.leadPrice)}</small>` : ''}</td>
      <td>${STATUS[l.status] || l.status}${(l.deal || []).length ? `<br><small class="badge warm">сделка: ${esc(l.deal.join(', '))}</small>` : ''}</td><td class="num">${l.bids}/${l.rfq ? 'отпр.' : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Заявок нет</td></tr>';
    $$('#lt tr.click').forEach(tr => tr.onclick = () => openLead(tr.dataset.id));
  };
  $('#lq').oninput = (e) => { leadFilter.q = e.target.value; draw(); }; $('#ls').onchange = (e) => { leadFilter.status = e.target.value; draw(); };
  draw();
}

let L = null, tab = 'client', companiesCache = null, rf = null;
async function openLead(id) {
  section = 'leads'; $$('#nav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.s === 'leads')));
  history.replaceState(null, '', '#' + id);
  L = await api('/api/crm/lead/' + id); ov = null; if (tab === 'calc' && !L.project) tab = 'client';
  drawLead();
}
function drawLead() {
  const a = L.answers || {}, c = L.client || {};
  $('#main').innerHTML = `<div class="row"><button class="btn sm ghost" id="back">← Заявки</button><h1 style="margin:0">Заявка ${esc(L.id)}</h1>
    <span class="badge ${L.grade}">${GRADE[L.grade]} лид</span><span class="muted">${L.leadPrice ? 'цена лида ' + rub(L.leadPrice) + ' (от ' + mln(L.homeValue) + ')' : ''}</span><span class="sp" style="flex:1"></span>
    <select id="st" style="max-width:180px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${L.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
  <div class="tabs">${[['client', 'Клиент'], ['project', 'Эскиз и ТЗ'], ['calc', 'Расчёт'], ['bids', 'Компании и ответы'], ['log', 'История']].map(([k, n]) => `<button data-t="${k}" aria-pressed="${tab === k}">${n}</button>`).join('')}</div><div id="tab"></div>`;
  $('#back').onclick = () => go('leads');
  $('#st').onchange = (e) => save({ status: e.target.value });
  // ответы компаний и история приходят без нас — перечитываем заявку
  $$('.tabs button').forEach(b => b.onclick = async () => { tab = b.dataset.t; if (tab === 'bids' || tab === 'log') { try { L = await api('/api/crm/lead/' + L.id); } catch (e) { /* покажем что есть */ } } drawLead(); });
  ({ client: tabClient, project: tabProject, calc: tabCalc, bids: tabBids, log: tabLog })[tab]();
}
async function save(d, msg) { L = await api('/api/crm/lead/' + L.id, d); toast(msg || 'Сохранено'); drawLead(); }

function tabClient() {
  const a = L.answers || {}, c = Object.assign({ name: a.name, phone: a.phone, city: a.city }, L.client || {}), q = L.qual || {};
  $('#tab').innerHTML = `<div class="grid2"><div class="box"><h2 style="margin-top:0">Карточка клиента</h2><form id="cf" class="grid2">
    ${[['name', 'Имя'], ['phone', 'Телефон'], ['email', 'Эл. почта'], ['city', 'Город'], ['address', 'Адрес участка'], ['plotNo', 'Кадастровый номер'], ['source', 'Источник']].map(([k, n]) => `<label class="f">${n}<input name="${k}" value="${esc(c[k] || '')}"></label>`).join('')}
    <label class="f">Менеджер<input name="manager" value="${esc(L.manager || me.name)}"></label>
    <div style="grid-column:1/-1"><button class="btn primary">Сохранить карточку</button></div></form>
    <h2>Анкета клиента</h2>${a.service ? `<div><span class="badge ${a.service === 'closed' ? 'pending' : 'approved'}">${{ open: 'рассылка и отчёт, контакты открыты — платит компания', closed: 'контакты закрыты — отчёт за ' + Number(DK.CONFIG.reportPrice || 14900).toLocaleString('ru-RU') + ' ₽', agent: 'представляем интересы — оплачивает компания при договоре' }[a.service] || a.service}</span></div>` : ''}<div class="muted">Участок: ${esc(a.plot)} · уклон: ${esc(a.slope)} · срок: ${esc(a.term)} · бюджет: ${esc(a.cls)} · материал: ${esc(a.material)}${a.time ? ' · звонить: ' + esc(a.time) : ''}</div>${a.note ? `<p>${esc(a.note)}</p>` : ''}</div>
  <div class="box"><h2 style="margin-top:0">Квалификация и цена лида</h2><form id="qf">${Object.entries(META.qual).map(([k, n]) => `<label class="row"><input type="checkbox" name="${k}"${q[k] ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
    <label class="f" style="margin-top:10px">Согласованная стоимость домовладения, ₽<input name="agreed" type="number" step="10000" value="${L.agreed || ''}" placeholder="${Math.round(L.homeValue || 0)}"></label>
    <div style="margin:10px 0"><span class="badge ${L.grade}">${GRADE[L.grade]}</span> Сетка: холодный ${META.settings.grid.cold} %, тёплый ${META.settings.grid.warm} %, горячий ${META.settings.grid.hot} % от стоимости.<br><b>Цена лида: ${rub(L.leadPrice)}</b></div>
    <button class="btn primary">Сохранить квалификацию</button></form>
    <h2>Заметки</h2><form id="nf" class="row"><input name="note" placeholder="Созвонились, договорились…"><button class="btn">Добавить</button></form>
    <div class="timeline">${(L.notes || []).slice().reverse().map(n => `<div><small>${dt(n.at)} · ${esc(n.by || '')}</small><br>${esc(n.text)}</div>`).join('')}</div></div></div>`;
  $('#cf').onsubmit = (e) => { e.preventDefault(); const f = e.target, cl = {}; ['name', 'phone', 'email', 'city', 'address', 'plotNo', 'source'].forEach(k => cl[k] = f[k].value); save({ client: cl, manager: f.manager.value }); };
  $('#qf').onsubmit = (e) => { e.preventDefault(); const f = e.target, ql = {}; Object.keys(META.qual).forEach(k => ql[k] = f[k].checked); save({ qual: ql, agreed: +f.agreed.value || 0 }); };
  $('#nf').onsubmit = (e) => { e.preventDefault(); if (e.target.note.value.trim()) save({ note: e.target.note.value }); };
}
function tabProject() {
  const files = L.files || [];
  $('#tab').innerHTML = `<div class="box"><div class="row"><h2 style="margin:0">Эскиз</h2><span style="flex:1"></span>${L.project ? `<a class="btn primary" href="/?crm=${encodeURIComponent(L.id)}" target="_blank">Открыть эскиз в конструкторе (снять размеры)</a>` : '<span class="muted">Проект не приложен</span>'}</div>
    <div class="thumbs" style="margin-top:10px">${files.map(f => `<a href="#" data-f="${esc(f)}"><img alt="${esc(f)}" data-src="/api/crm/lead/${L.id}/file/${encodeURIComponent(f)}"></a>`).join('')}</div></div>
  <div class="grid2"><div class="box"><h2 style="margin-top:0">Описание проекта</h2><ul>${(L.brief || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>${(L.changes || []).length ? `<h2>Скорректировано по анкете</h2><ul>${L.changes.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div>
  <div class="box"><h2 style="margin-top:0">Техзадание</h2><div class="muted">Пункты увидят компании. По одному в строке.</div><textarea id="tz" rows="14">${esc((L.tz && L.tz.length ? L.tz : (L.project ? DK.tzItems(L.project) : [])).join('\n'))}</textarea><button class="btn primary" id="tzSave" style="margin-top:8px">Сохранить ТЗ</button>
  ${(L.notesAuto || []).length ? `<h2>Проверить</h2><ul>${L.notesAuto.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}</div></div>`;
  // картинки — через токен
  $$('#tab img[data-src]').forEach(async (img) => { try { const r = await fetch(img.dataset.src, { headers: { Authorization: 'Bearer ' + token } }); img.src = await dataUrl(await r.blob()); } catch (e) { /* нет файла */ } });
  $$('#tab a[data-f]').forEach(a => a.onclick = (e) => { e.preventDefault(); const im = $('img', a); if (im.src) window.open(im.src, '_blank'); });
  $('#tzSave').onclick = () => save({ tz: $('#tz').value.split('\n').map(s => s.trim()).filter(Boolean) }, 'ТЗ сохранено');
}

/* тело расчёта: автоматические объёмы и цены, правка вручную по строке, накладные */
let ov = null;
function tabCalc() {
  if (!L.project) { $('#tab').innerHTML = '<div class="box muted">В заявке нет проекта — расчёт по объёмам недоступен.</div>'; return; }
  const p = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(L.project))));
  if (!ov) ov = JSON.parse(JSON.stringify((L.est && L.est.ov) || {}));
  const cls = (L.est && L.est.cls) || (L.answers || {}).cls || 'comfort';
  const e = DK.estimate(p, { ov, cls }), canEdit = me.staffRole !== 'manager';
  const groups = []; e.rows.forEach(r => { let g = groups.find(x => x.g === r.g); if (!g) groups.push(g = { g: r.g, rows: [] }); g.rows.push(r); });
  const pct = (k, f) => ov[k] && ov[k][f] != null ? ov[k][f] : DK.PRICES[k][f];
  $('#tab').innerHTML = `<div class="kpi"><div>Итого тёплый контур<b>${rub(e.total)}</b></div><div>Вилка для клиента<b>${mln(e.min)} – ${mln(e.max)}</b></div><div>За м² (${Math.round(e.area)} м²)<b>${rub(e.perM2)}</b></div><div>Материалы<b>${mln(e.mat)}</b></div></div>
  <div class="row" style="margin:12px 0"><span class="muted">Класс комплектации:</span><select id="cls" style="max-width:160px"${canEdit ? '' : ' disabled'}>${Object.entries(DK.EST_CLASS).map(([k, v]) => `<option value="${k}"${cls === k ? ' selected' : ''}>${v.n}</option>`).join('')}</select>
    <span class="muted">Жёлтым — правка вручную. Пустое поле — значение по объёмам проекта и прайсу.</span><span style="flex:1"></span><button class="btn" id="csv">Скачать CSV</button>${canEdit ? '<button class="btn" id="reset">Сбросить правки</button><button class="btn primary" id="saveCalc">Сохранить расчёт</button>' : ''}</div>
  <div class="box" style="padding:0;overflow:auto"><table class="est"><thead><tr><th>Работа / материал</th><th class="num">Кол-во</th><th>Ед.</th><th class="num">Материал, ₽/ед.</th><th class="num">Работа, ₽/ед.</th><th class="num">Сумма</th><th></th></tr></thead><tbody>
  ${groups.map(g => `<tr class="g"><td colspan="5">${esc(g.g)}</td><td class="num">${rub(e.groups[g.g])}</td><td></td></tr>` + g.rows.map(r => `<tr class="${r.auto ? '' : 'man'}" data-id="${r.id}"><td>${esc(r.n)}${r.note ? `<br><small class="muted">${esc(r.note)}</small>` : ''}</td>
    <td class="num"><input data-f="q" value="${r.q}"${canEdit ? '' : ' disabled'}></td><td>${esc(r.u)}</td><td class="num"><input data-f="m" value="${r.m}"${canEdit ? '' : ' disabled'}></td><td class="num"><input data-f="w" value="${r.w}"${canEdit ? '' : ' disabled'}></td>
    <td class="num">${rub(r.sm + r.sw)}</td><td>${r.auto ? '' : '<button class="btn sm ghost" data-r="1" title="Вернуть автоматическое">↺</button>'}</td></tr>`).join('')).join('')}
  <tr class="g"><td colspan="7">Накладные</td></tr>
  <tr><td>Доставка, спецтехника, бытовка, геодезия — % от материалов</td><td class="num"><input data-p="logistics:m" value="${pct('logistics', 'm')}"${canEdit ? '' : ' disabled'}></td><td>%</td><td colspan="2"></td><td class="num">${rub(e.logi)}</td><td></td></tr>
  <tr><td>Леса, временные сети, вывоз мусора — % от работ и материалов</td><td class="num"><input data-p="siteWork:w" value="${pct('siteWork', 'w')}"${canEdit ? '' : ' disabled'}></td><td>%</td><td colspan="2"></td><td class="num">${rub(e.site)}</td><td></td></tr>
  <tr><td>Организация работ и прибыль подрядчика — %</td><td class="num"><input data-p="margin:w" value="${pct('margin', 'w')}"${canEdit ? '' : ' disabled'}></td><td>%</td><td colspan="2"></td><td class="num">${rub(e.marg)}</td><td></td></tr>
  <tr class="g"><td colspan="5">Итого</td><td class="num">${rub(e.total)}</td><td></td></tr></tbody></table></div>
  ${L.est ? `<div class="muted">Сохранено: ${dt(L.est.at)}, ${esc(L.est.by)} — ${rub(L.est.total)}</div>` : ''}`;
  const auto = DK.estimate(p, { cls });
  $$('#tab tr[data-id] input').forEach(inp => inp.onchange = () => {
    const id = inp.closest('tr').dataset.id, f = inp.dataset.f, v = +String(inp.value).replace(',', '.'), base = auto.rows.find(r => r.id === id);
    ov[id] = ov[id] || {};
    if (inp.value === '' || (base && Math.abs(base[f] - v) < 1e-9)) delete ov[id][f]; else ov[id][f] = v;
    if (!Object.keys(ov[id]).length) delete ov[id];
    tabCalc();
  });
  $$('#tab input[data-p]').forEach(inp => inp.onchange = () => { const [k, f] = inp.dataset.p.split(':'); ov[k] = ov[k] || {}; ov[k][f] = +inp.value || 0; tabCalc(); });
  $$('#tab button[data-r]').forEach(b => b.onclick = () => { delete ov[b.closest('tr').dataset.id]; tabCalc(); });
  if ($('#cls')) $('#cls').onchange = (ev) => { L.est = Object.assign({}, L.est || {}, { cls: ev.target.value }); tabCalc(); };
  if ($('#reset')) $('#reset').onclick = () => { ov = {}; tabCalc(); };
  if ($('#saveCalc')) $('#saveCalc').onclick = () => { const c2 = $('#cls').value, r = DK.estimate(p, { ov, cls: c2 }); save({ est: { ov, cls: c2, total: Math.round(r.total), min: Math.round(r.min), max: Math.round(r.max) } }, 'Расчёт сохранён'); };
  $('#csv').onclick = () => {
    const lines = [['Раздел', 'Наименование', 'Кол-во', 'Ед.', 'Материал', 'Работа', 'Сумма']].concat(e.rows.map(r => [r.g, r.n, r.q, r.u, r.m, r.w, Math.round(r.sm + r.sw)]), [['', 'Накладные', '', '', '', '', Math.round(e.logi + e.site + e.marg)], ['', 'Итого', '', '', '', '', Math.round(e.total)]]);
    const blob = new Blob(['﻿' + lines.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `raschet-${L.id}.csv`; a.click();
  };
}

/* рассылка компаниям и сравнение ответов */
async function tabBids() {
  if (!companiesCache) companiesCache = await api('/api/crm/companies');
  const city = (L.client || {}).city || (L.answers || {}).city || '';
  if (!rf || rf.lead !== L.id) rf = { lead: L.id, city, bank: '', accr: false, escrow: false };
  const approved = companiesCache.filter(c => c.status === 'approved');
  const cityOpts = Array.from(new Set([city].concat(approved.flatMap(c => c.cities || c.regions || [c.city])).filter(Boolean)));
  const ok = approved.filter(c => (!rf.city || DK.cityMatch(c.cities || c.regions || [c.city], rf.city)) && (!rf.accr || (c.banks || []).length) && (!rf.bank || (c.banks || []).includes(rf.bank)) && (!rf.escrow || c.escrow));
  const sent = new Set((L.rfq || []).flatMap(r => r.companies)), bids = L.bids || [], rows = META.rows, share = new Set(L.shareWith || []), deal = new Set(L.deal || []);
  const tags = (c) => `${(c.banks || []).length ? `<span class="badge approved" title="${esc(c.banks.join(', '))}">банки: ${c.banks.length}</span>` : '<span class="badge">без аккредитации</span>'} ${c.escrow ? '<span class="badge approved">эскроу</span>' : ''}`;
  // наш расчёт по тем же строкам
  let ours = null;
  if (L.project) {
    const e = DK.estimate(DK.normalize(DK.migrate(JSON.parse(JSON.stringify(L.project)))), { ov: (L.est && L.est.ov) || {}, cls: (L.est && L.est.cls) || 'comfort' });
    const map = { 'Фундамент': 'found', 'Стены': 'walls', 'Перекрытия': 'slabs', 'Кровля': 'roof', 'Окна и двери': 'windows', 'Утепление фасада': 'facade', 'Пристройки': 'ext' };
    ours = {}; Object.keys(rows).forEach(k => ours[k] = 0);
    Object.entries(e.groups).forEach(([g, v]) => { ours[map[g] || 'other'] += v * (1 + (e.logi + e.site + e.marg) / e.base); });
    ours.total = e.total;
  }
  $('#tab').innerHTML = `<div class="box"><h2 style="margin-top:0">Отправить эскизный проект на расчёт</h2>
    <div class="muted">Компании получат письмо на почту и запрос в личном кабинете: эскиз, ТЗ и единую форму расчёта. Контакты клиента скрыты, пока вы их не откроете.</div>
    <div class="row" style="margin:10px 0"><label class="f" style="max-width:260px">Город строительства<select id="rfCity"><option value="">Все города</option>${cityOpts.map(c => `<option${rf.city === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="f" style="max-width:220px">Банк<select id="rfBank"><option value="">Любой</option>${DK.BANKS.map(b => `<option${rf.bank === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <label class="row" style="margin-top:16px"><input type="checkbox" id="rfAccr"${rf.accr ? ' checked' : ''}> есть аккредитация в банках</label><label class="row" style="margin-top:16px"><input type="checkbox" id="rfEsc"${rf.escrow ? ' checked' : ''}> строят по эскроу</label>
      <span class="muted" style="margin-top:16px">Подходит: ${ok.length} из ${approved.length}</span></div>
    <table style="margin:10px 0"><thead><tr><th><input type="checkbox" id="rcAll" title="Отметить всех"></th><th>Компания</th><th>Города работы</th><th>Банки и эскроу</th><th>Почта</th><th>Статус</th></tr></thead><tbody>${ok.map(c => `<tr><td><input type="checkbox" class="rc" value="${c.id}"${sent.has(c.id) ? ' disabled' : ''}></td><td>${esc(c.name)}${c.rating ? ` <small class="muted">★ ${c.rating}</small>` : ''}</td><td><small>${esc((c.cities || c.regions || [c.city]).join(', '))}</small></td><td>${tags(c)}</td><td><small>${esc(Array.from(new Set([c.email].concat(c.accounts || []).filter(Boolean))).join(', '))}</small></td><td>${sent.has(c.id) ? 'отправлено' : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">${approved.length ? 'Под фильтр никто не подходит — смените город или снимите условия.' : 'Нет проверенных компаний — одобрите их в разделе «Компании».'}</td></tr>`}</tbody></table>
    <div class="row"><input id="rmsg" placeholder="Комментарий для компаний (необязательно)"><button class="btn primary" id="rsend">Отправить на расчёт</button></div></div>
  <div class="box" style="overflow:auto"><h2 style="margin-top:0">Ответы компаний</h2>${bids.length ? `<table><thead><tr><th>Раздел</th>${ours ? '<th class="num">Наш расчёт</th>' : ''}${bids.map(b => `<th class="num">${esc(b.name)}<br><small>${dt(b.at)}</small></th>`).join('')}</tr></thead><tbody>
    ${Object.entries(rows).map(([k, n]) => `<tr><td>${esc(n)}</td>${ours ? `<td class="num muted">${rub(ours[k])}</td>` : ''}${bids.map(b => `<td class="num">${rub(b.rows[k])}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>Итого</b></td>${ours ? `<td class="num"><b>${rub(ours.total)}</b></td>` : ''}${bids.map(b => `<td class="num"><b>${rub(b.total)}</b>${ours ? `<br><small class="${b.total < ours.total * 0.85 ? 'err' : 'muted'}">${Math.round((b.total / ours.total - 1) * 100)} % к нашему</small>` : ''}</td>`).join('')}</tr>
    <tr><td>Срок, мес.</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td class="num">${b.term || '—'}</td>`).join('')}</tr>
    <tr><td>Комментарий</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td><small>${esc(b.comment)}</small></td>`).join('')}</tr>
    <tr><td>Контакты клиента</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td><label class="row"><input type="checkbox" class="sh" value="${b.company}"${share.has(b.company) ? ' checked' : ''}> открыть</label></td>`).join('')}</tr>
    <tr><td>Сделка</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td style="text-align:right"><button class="btn sm ${deal.has(b.company) ? 'gold' : 'ghost'}" data-deal="${b.company}">${deal.has(b.company) ? '✓ Идём на сделку' : 'Готовы к сделке'}</button></td>`).join('')}</tr></tbody></table>
    <div class="muted">Красным — расчёт дешевле нашего больше чем на 15 %: проверьте состав работ.</div>` : '<div class="muted">Ответов пока нет.</div>'}</div>`;
  $('#rsend').onclick = async () => {
    const ids = $$('.rc:checked').map(i => i.value); if (!ids.length) return toast('Отметьте компании');
    // ТЗ: если менеджер не заполнил — пункты из проекта
    const tz = L.tz && L.tz.length ? null : L.project ? DK.tzItems(DK.normalize(DK.migrate(JSON.parse(JSON.stringify(L.project))))) : null;
    try { L = await api(`/api/crm/lead/${L.id}/rfq`, { companies: ids, message: $('#rmsg').value, tz }); toast('Отправлено: ' + ids.length); drawLead(); } catch (e) { toast(e.message); }
  };
  $$('.sh').forEach(i => i.onchange = () => save({ shareWith: $$('.sh:checked').map(x => x.value) }, i.checked ? 'Контакты открыты компании' : 'Контакты скрыты'));
  $$('[data-deal]').forEach(b => b.onclick = () => { const id = b.dataset.deal, on = !deal.has(id), nd = Array.from(deal).filter(x => x !== id).concat(on ? [id] : []);
    save(Object.assign({ deal: nd }, on && !share.has(id) ? { shareWith: Array.from(share).concat(id) } : {}), on ? 'Отмечено: идём на сделку, контакты клиента открыты компании' : 'Сделка снята'); });
  $('#rfCity').onchange = (e) => { rf.city = e.target.value; tabBids(); };
  $('#rfBank').onchange = (e) => { rf.bank = e.target.value; tabBids(); };
  $('#rfAccr').onchange = (e) => { rf.accr = e.target.checked; tabBids(); };
  $('#rfEsc').onchange = (e) => { rf.escrow = e.target.checked; tabBids(); };
  $('#rcAll').onchange = (e) => $$('.rc:not(:disabled)').forEach(i => { i.checked = e.target.checked; });
}
function tabLog() {
  const items = [].concat((L.log || []).map(x => ({ at: x.at, t: x.text })), (L.notes || []).map(n => ({ at: n.at, t: (n.by ? n.by + ': ' : '') + n.text })), [{ at: L.at, t: 'Заявка с сайта' }]).sort((a, b) => b.at.localeCompare(a.at));
  $('#tab').innerHTML = `<div class="box timeline">${items.map(i => `<div><small>${dt(i.at)}</small><br>${esc(i.t)}</div>`).join('')}</div>`;
}

/* ---------- проекты пользователей: модерация ---------- */
const PST = { published: 'опубликован', private: 'в кабинете автора', hidden: 'скрыт автором', blocked: 'заблокирован' };
const PSTC = { published: 'approved', private: '', hidden: 'pending', blocked: 'rejected' };
let projFilter = { q: '', st: '', bad: false, ver: false };
const VST = { requested: 'ждёт оплаты', paid: 'оплачено', in_work: 'в работе', verified: 'проверено', rejected: 'отклонено', outdated: 'устарела', none: 'снята' };
const VSTC = { requested: 'pending', paid: 'pending', in_work: 'pending', verified: 'approved', rejected: 'rejected', outdated: '', none: '' };
const vWait = (x) => x.verify && ['requested', 'paid', 'in_work'].includes(x.verify.status);
const authImg = (root) => $$('img[data-src]', root).forEach(async (img) => { try { const r = await fetch(img.dataset.src, { headers: { Authorization: 'Bearer ' + token } }); if (r.ok) img.src = await dataUrl(await r.blob()); } catch (e) { /* нет */ } });
async function renderProjects() {
  history.replaceState(null, '', location.pathname);
  const list = await api('/api/crm/projects');
  $('#main').innerHTML = `<h1>Проекты пользователей</h1><div class="kpi"><div>Всего<b>${list.length}</b></div><div>Опубликовано<b>${list.filter(x => x.status === 'published').length}</b></div><div>Подняты<b>${list.filter(x => x.boost).length}</b></div><div>Заблокировано<b>${list.filter(x => x.status === 'blocked').length}</b></div><div>На верификации<b>${list.filter(vWait).length}</b></div><div>Проверено<b>${list.filter(x => x.verify && x.verify.status === 'verified').length}</b></div></div>
  <div class="row" style="margin:14px 0"><input id="pq" placeholder="Поиск: название, автор, почта" style="max-width:300px" value="${esc(projFilter.q)}"><select id="pst" style="max-width:200px"><option value="">Все статусы</option>${Object.entries(PST).map(([k, v]) => `<option value="${k}"${projFilter.st === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <label class="row"><input type="checkbox" id="pbad"${projFilter.bad ? ' checked' : ''}> с замечаниями</label><label class="row"><input type="checkbox" id="pver"${projFilter.ver ? ' checked' : ''}> на верификации</label><span class="muted">Фильтр качества не даёт сохранить проект с ошибками — здесь видно, что прошло.</span></div><div class="pgrid" id="pg"></div>`;
  const draw = () => {
    const q = projFilter.q.toLowerCase();
    const rows = list.filter(x => (!projFilter.st || x.status === projFilter.st) && (!projFilter.bad || (x.quality && x.quality.warns)) && (!projFilter.ver || vWait(x)) && (!q || [x.title, x.owner.name, x.owner.email].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => (vWait(b) ? 2 : 0) + (b.boost ? 1 : 0) - (vWait(a) ? 2 : 0) - (a.boost ? 1 : 0));
    $('#pg').innerHTML = rows.map(x => `<div class="pcard${x.status === 'blocked' ? ' blocked' : ''}" data-id="${x.id}">${x.cover ? `<img alt="" data-src="/api/crm/project/${x.id}/file/${encodeURIComponent(x.cover)}">` : '<div class="noimg"></div>'}
      <div class="pb"><b>${x.boost ? '<span class="boost">▲ </span>' : ''}${esc(x.title)}</b><small class="muted">${Math.round(x.area)} м² · ${x.floors} эт. · ${esc(x.owner.name)}${x.owner.archStatus === 'verified' ? ' ✓' : ''}</small>
      <div class="row"><span class="badge ${PSTC[x.status]}">${PST[x.status] || x.status}</span>${x.quality ? `<span class="badge" title="Оценка качества при сохранении">качество ${x.quality.score}</span>` : ''}${x.verify ? `<span class="badge ${VSTC[x.verify.status] || ''}" title="Верификация">верификация: ${VST[x.verify.status] || x.verify.status}</span>` : ''}${x.rating.n ? `<small>★ ${x.rating.avg} (${x.rating.n})</small>` : ''}</div>
      <small class="muted">${dt(x.updatedAt)}${x.requests ? ' · запросов: ' + x.requests : ''}</small></div></div>`).join('') || '<div class="muted">Проектов нет</div>';
    authImg($('#pg')); $$('#pg .pcard').forEach(c => c.onclick = () => openProj(c.dataset.id));
  };
  $('#pq').oninput = (e) => { projFilter.q = e.target.value; draw(); }; $('#pst').onchange = (e) => { projFilter.st = e.target.value; draw(); }; $('#pbad').onchange = (e) => { projFilter.bad = e.target.checked; draw(); }; $('#pver').onchange = (e) => { projFilter.ver = e.target.checked; draw(); };
  draw();
}
/* верификация: архитектор и инженер платформы проверяют проект и при необходимости правят его в конструкторе */
function verifyBox(x, can) {
  const v = x.verify, st = v ? v.status : '', P = (v && v.price) || DK.CONFIG.verifyPrice || 15000;
  const btn = (s2, t, cls) => `<button class="btn ${cls || ''}" data-ver="${s2}">${t}</button>`;
  const acts = !can ? '' : !v || ['rejected', 'outdated', 'none'].includes(st) ? btn('paid', 'Принять оплату без заявки')
    : st === 'requested' ? btn('paid', 'Оплата получена', 'primary') + btn('rejected', 'Отклонить')
    : st === 'paid' ? btn('in_work', 'Взять в работу', 'primary') + btn('rejected', 'Отклонить')
    : st === 'in_work' ? `<a class="btn" href="/?crmp=${encodeURIComponent(x.id)}&fix=1" target="_blank">Исправить в конструкторе</a>${btn('verified', 'Проверено — поставить отметку', 'primary')}${btn('rejected', 'Отклонить')}`
    : st === 'verified' ? btn('none', 'Снять отметку') : '';
  return `<div class="box" style="max-width:820px"><h2 style="margin-top:0">Верификация ${v ? `<span class="badge ${VSTC[st] || ''}">${VST[st] || st}</span>` : ''}${v && v.fixed ? ' <span class="badge">исправлен архитектором</span>' : ''}</h2>
    <div class="muted">Архитектор и инженер платформы проверяют планировку и конструктив, при необходимости исправляют проект. После отметки «Проверено» на карточке в каталоге появляется значок, проект поднимается выше. Если автор изменит проект, отметка снимется.</div>
    ${v ? `<div style="margin:8px 0">Заявка ${dt(v.requestedAt)} · стоимость ${rub(P)}${v.note ? ' · ' + esc(v.note) : ''}</div><div class="timeline">${(v.log || []).slice().reverse().map(l => `<div><small>${dt(l.at)}${l.by ? ' · ' + esc(l.by) : ''}</small><br>${esc(l.text)}</div>`).join('')}</div>` : '<div style="margin:8px 0">Автор верификацию не заказывал.</div>'}
    ${acts ? `<div class="row" style="margin-top:10px;flex-wrap:wrap">${['requested', 'paid'].includes(st) || !v ? `<label class="row">Цена, ₽ <input id="vPrice" type="number" min="0" step="500" value="${P}" style="width:110px"></label>` : ''}${acts}</div>` : ''}</div>`;
}
async function openProj(id) {
  const x = await api('/api/crm/project/' + id), q = x.qualityNow || { errs: [], warns: [], score: 0 }, canMod = me.staffRole !== 'estimator';
  $('#main').innerHTML = `<div class="row"><button class="btn sm ghost" id="pback">← Проекты</button><h1 style="margin:0">${x.boost ? '▲ ' : ''}${esc(x.title)}</h1><span class="badge ${PSTC[x.status]}">${PST[x.status]}</span>${x.blockReason ? `<span class="err">${esc(x.blockReason)}</span>` : ''}</div>
  <div class="row" style="margin:12px 0"><a class="btn primary" href="/?crmp=${encodeURIComponent(x.id)}" target="_blank">Открыть в конструкторе</a><button class="btn" id="pIfc">Скачать IFC (ArchiCAD, Revit)</button><button class="btn" id="pDxf">Скачать DXF (планы)</button><span style="flex:1"></span>
    ${canMod ? `${x.status !== 'blocked' ? `<button class="btn ${x.boost ? 'gold' : ''}" id="pBoost">${x.boost ? '▲ Поднят — снять' : '▲ Поднять вверх'}</button>` : ''}
    ${x.status === 'blocked' ? '<button class="btn" id="pUnblock">Разблокировать</button>' : '<button class="btn" id="pBlock" style="border-color:var(--err);color:var(--err)">Заблокировать</button>'}` : ''}</div>
  <div class="box"><div class="thumbs">${x.files.map(f => `<img alt="" data-src="/api/crm/project/${x.id}/file/${encodeURIComponent(f)}">`).join('')}</div>${x.about ? `<p>${esc(x.about)}</p>` : ''}</div>
  <div class="grid2"><div class="box"><h2 style="margin-top:0">Проект</h2><div>${Math.round(x.area)} м² · ${x.floors} эт. · ${esc(x.size || '')} · ${x.price ? rub(x.price) : 'бесплатно'} · ${x.license === 'build' ? 'право построить' : 'для ознакомления'}</div>
    <div class="muted">Создан ${dt(x.at)}, обновлён ${dt(x.updatedAt)} · ★ ${x.rating.avg} (${x.rating.n}) · запросов: ${x.requests}</div>
    <h2>Автор</h2><div>${esc(x.owner.name)} ${x.owner.archStatus === 'verified' ? '<span class="badge approved">архитектор ✓</span>' : ''}<br>${esc(x.owner.email)} ${esc(x.owner.phone)} ${esc(x.owner.city)}</div>
    ${x.requestsList.length ? `<h2>Запросы покупателей</h2><div class="timeline">${x.requestsList.map(r => `<div><small>${dt(r.at)}</small><br>${esc(r.name)}, ${esc(r.phone)} ${esc(r.comment || '')}</div>`).join('')}</div>` : ''}</div>
  <div class="box"><h2 style="margin-top:0">Качество сейчас: ${q.score} из 100</h2><div class="muted">${q.ok ? 'Проверки пройдены' : 'Есть ошибки — автор не смог бы сохранить проект в таком виде'}</div>
    <ul class="qlist">${q.errs.map(c => `<li class="err">${esc(c.txt)}</li>`).join('')}${q.warns.map(c => `<li class="warn">${esc(c.txt)}</li>`).join('')}</ul>
    <h2>Модерация</h2><div class="timeline">${x.modLog.slice().reverse().map(l => `<div><small>${dt(l.at)} · ${esc(l.by)}</small><br>${esc(l.text)}</div>`).join('') || '<span class="muted">Действий не было</span>'}</div>
    ${canMod ? '<form id="pnote" class="row" style="margin-top:8px"><input name="note" placeholder="Заметка модератора"><button class="btn">Добавить</button></form>' : ''}</div></div>
  ${verifyBox(x, canMod && me.staffRole !== 'marketer')}
  <div class="box" style="max-width:820px"><h2 style="margin-top:0">SEO страницы проекта</h2><div class="muted">Страница: <a href="/proekty/${encodeURIComponent(x.id)}/" target="_blank">/proekty/${esc(x.id)}/</a>. Пустые поля заполняются автоматически из названия, площади и описания.</div>
    <form id="pseo" class="grid2" style="margin-top:8px"><label class="f" style="grid-column:1/-1">Заголовок для поиска (title) <span class="muted" id="ptc"></span><input name="title" value="${esc(x.seo.title || '')}" placeholder="${esc(x.title)} — проект дома ${Math.round(x.area)} м²"></label>
    <label class="f" style="grid-column:1/-1">Описание (description) <span class="muted" id="pdc"></span><textarea name="desc" rows="2" placeholder="Проект дома ${Math.round(x.area)} м², ${x.floors} эт. …">${esc(x.seo.desc || '')}</textarea></label>
    <label class="f">Ключевые фразы<input name="keywords" value="${esc(x.seo.keywords || '')}" placeholder="проект дома ${Math.round(x.area)} м2"></label><label class="row" style="margin-top:18px"><input type="checkbox" name="noindex"${x.seo.noindex ? ' checked' : ''}> скрыть от поиска</label>
    ${canMod ? '<div><button class="btn primary">Сохранить SEO</button></div>' : ''}</form></div>`;
  authImg($('#main'));
  const mod = async (d, msg) => { try { await api('/api/crm/project/' + id, d); toast(msg); openProj(id); } catch (e) { toast(e.message); } };
  $('#pback').onclick = () => go('projects');
  if ($('#pBoost')) $('#pBoost').onclick = () => mod({ boost: !x.boost }, x.boost ? 'Снят с поднятия' : 'Проект поднят вверх каталога');
  $$('[data-ver]').forEach(b => b.onclick = () => {
    const st = b.dataset.ver, ask = { verified: 'Комментарий автору (что проверили и исправили):', rejected: 'Причина (уйдёт автору на почту):', none: 'Почему снимаете отметку:' }[st];
    const note = ask ? prompt(ask, st === 'verified' ? (x.verify && x.verify.fixed ? 'Проверили планировку и конструктив, внесли исправления.' : 'Проверили планировку и конструктив, замечаний нет.') : '') : '';
    if (note === null) return;
    const price = $('#vPrice') ? +$('#vPrice').value : undefined;
    mod({ verify: st, note, price }, 'Верификация: ' + VST[st]);
  });
  if ($('#pUnblock')) $('#pUnblock').onclick = () => mod({ status: 'published' }, 'Проект снова опубликован');
  if ($('#pBlock')) $('#pBlock').onclick = () => {
    const r = prompt('Причина блокировки (уйдёт автору на почту):', q.errs.length ? 'Проект с ошибками: ' + q.errs[0].txt : 'Мусор / тестовый проект, не планировка дома');
    if (r !== null) mod({ status: 'blocked', reason: r }, 'Проект заблокирован');
  };
  const pf = $('#pseo'), cnt = () => { $('#ptc').textContent = '· ' + pf.title.value.length + ' / 65'; $('#pdc').textContent = '· ' + pf.desc.value.length + ' / 160'; };
  pf.title.oninput = pf.desc.oninput = cnt; cnt();
  pf.onsubmit = (e) => { e.preventDefault(); mod({ seo: { title: pf.title.value, desc: pf.desc.value, keywords: pf.keywords.value, noindex: pf.noindex.checked } }, 'SEO проекта сохранено'); };
  if ($('#pnote')) $('#pnote').onsubmit = (e) => { e.preventDefault(); if (e.target.note.value.trim()) mod({ note: e.target.note.value }, 'Заметка сохранена'); };
  const prep = () => { const p = DK.normalize(DK.migrate(JSON.parse(JSON.stringify(x.project)))); ['b', 'f1', 'f2', 'f3'].forEach(k => { if (!p.levels[k]) p.levels[k] = DK.emptyLevel(); }); return p; };
  $('#pIfc').onclick = () => DK.exportIFC ? DK.download(DK.exportIFC(prep(), { name: x.title }), `${x.id}.ifc`, 'application/x-step') : toast('Экспорт недоступен');
  $('#pDxf').onclick = () => DK.exportDXF ? DK.download(DK.exportDXF(prep()), `${x.id}.dxf`, 'application/dxf') : toast('Экспорт недоступен');
}

/* ---------- компании ---------- */
async function renderCompanies() {
  history.replaceState(null, '', location.pathname);
  const list = companiesCache = await api('/api/crm/companies');
  $('#main').innerHTML = `<h1>Строительные компании</h1><div class="muted" style="margin-bottom:10px">Одобренные компании получают запросы на расчёт и видны в каталоге. После одобрения компании уходит письмо.</div>
  <div class="row" style="margin-bottom:10px"><input id="cq" placeholder="Поиск: название, город, банк" style="max-width:320px"><label class="row"><input type="checkbox" id="cEsc"> только эскроу</label></div>
  <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>Компания</th><th>Города работы</th><th>Банки</th><th>Эскроу</th><th>Контакты</th><th>ИНН</th><th>Статус</th><th>Рейтинг</th></tr></thead><tbody>
  ${list.map(c => `<tr data-id="${c.id}" data-q="${esc([c.name, c.city].concat(c.cities || c.regions || [], c.banks || []).join(' ').toLowerCase())}" data-esc="${c.escrow ? 1 : 0}"><td><b>${esc(c.name)}</b><br><small class="muted">${dt(c.at)} · офис: ${esc(c.city)}</small></td>
    <td><input class="ccit" value="${esc((c.cities || c.regions || []).join(', '))}" title="Через запятую" style="min-width:180px"></td>
    <td><details><summary><small>${(c.banks || []).length ? esc(c.banks.join(', ')) : 'нет аккредитации'}</small></summary><div class="chipsC">${DK.BANKS.map(b => `<label class="row"><input type="checkbox" class="cbank" value="${esc(b)}"${(c.banks || []).includes(b) ? ' checked' : ''}> ${esc(b)}</label>`).join('')}</div></details></td>
    <td><input type="checkbox" class="cesc"${c.escrow ? ' checked' : ''}></td>
    <td>${esc(c.phone)}<br><small>${esc(c.email || '')}</small><br><small class="muted">${esc((c.accounts || []).join(', '))}</small></td><td>${esc(c.inn || '')}</td>
    <td><select class="cs">${['pending', 'approved', 'rejected'].map(s => `<option value="${s}"${c.status === s ? ' selected' : ''}>${{ pending: 'На проверке', approved: 'Одобрена', rejected: 'Отклонена' }[s]}</option>`).join('')}</select></td>
    <td><input class="cr" type="number" min="0" max="5" step="0.1" value="${c.rating || ''}" style="width:70px"></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Компаний нет</td></tr>'}</tbody></table></div>`;
  const flt = () => { const q = $('#cq').value.toLowerCase(), e = $('#cEsc').checked; $$('#main tr[data-id]').forEach(tr => { tr.hidden = (q && !tr.dataset.q.includes(q)) || (e && tr.dataset.esc !== '1'); }); };
  $('#cq').oninput = flt; $('#cEsc').onchange = flt;
  $$('#main tr[data-id]').forEach(tr => {
    $('.cs', tr).onchange = async (e) => { try { await api('/api/crm/company/' + tr.dataset.id, { status: e.target.value }); toast('Статус обновлён'); } catch (er) { toast(er.message); } };
    $('.cr', tr).onchange = async (e) => { try { await api('/api/crm/company/' + tr.dataset.id, { rating: +e.target.value }); toast('Рейтинг сохранён'); } catch (er) { toast(er.message); } };
    const prof = async () => { try { await api('/api/crm/company/' + tr.dataset.id, { cities: $('.ccit', tr).value, banks: $$('.cbank:checked', tr).map(i => i.value), escrow: $('.cesc', tr).checked }); companiesCache = null; toast('Профиль компании сохранён'); } catch (er) { toast(er.message); } };
    $('.ccit', tr).onchange = prof; $('.cesc', tr).onchange = prof; $$('.cbank', tr).forEach(i => i.onchange = prof);
  });
}

/* ---------- цены материалов и работ ---------- */
async function renderPrices() {
  history.replaceState(null, '', location.pathname);
  const srv = await api('/api/crm/prices'), canEdit = me.staffRole !== 'manager', groups = {};
  Object.entries(DK.PRICES_DEFAULT).forEach(([k, v]) => { (groups[v.g] = groups[v.g] || []).push([k, v]); });
  const cur = (k, f) => srv.prices && srv.prices[k] && srv.prices[k][f] != null ? srv.prices[k][f] : DK.PRICES_DEFAULT[k][f];
  $('#main').innerHTML = `<h1>Цены материалов и работ</h1><div class="muted">По этим ценам сайт считает вилку стоимости, а CRM — тело расчёта. ${srv.updatedAt ? `Обновлено ${dt(srv.updatedAt)}, ${esc(srv.by)}.` : 'Сейчас действуют цены по умолчанию (осень 2026).'}</div>
  <div class="row" style="margin:12px 0"><span style="flex:1"></span>${canEdit ? '<button class="btn" id="pDef">Вернуть цены по умолчанию</button><button class="btn primary" id="pSave">Сохранить цены</button>' : '<span class="muted">Цены правит сметчик</span>'}</div>
  <div class="box" style="padding:0;overflow:auto"><table class="est"><thead><tr><th>Позиция</th><th>Ед.</th><th class="num">Материал, ₽</th><th class="num">Работа, ₽</th><th class="num">По умолчанию</th></tr></thead><tbody>
  ${Object.entries(groups).map(([g, rows]) => `<tr class="g"><td colspan="5">${esc(g)}</td></tr>` + rows.map(([k, v]) => `<tr data-k="${k}"><td>${esc(v.n)}</td><td>${esc(v.u)}</td><td class="num"><input data-f="m" value="${cur(k, 'm')}"${canEdit ? '' : ' disabled'}></td><td class="num"><input data-f="w" value="${cur(k, 'w')}"${canEdit ? '' : ' disabled'}></td><td class="num muted">${v.m} / ${v.w}</td></tr>`).join('')).join('')}</tbody></table></div>`;
  if (!canEdit) return;
  $('#pSave').onclick = async () => {
    const prices = {}; $$('#main tr[data-k]').forEach(tr => { prices[tr.dataset.k] = { m: +$('[data-f=m]', tr).value || 0, w: +$('[data-f=w]', tr).value || 0 }; });
    try { await api('/api/crm/prices', { prices }, 'PUT'); Object.entries(prices).forEach(([k, v]) => Object.assign(DK.PRICES[k], v)); toast('Цены сохранены — сайт считает по ним'); renderPrices(); } catch (e) { toast(e.message); }
  };
  $('#pDef').onclick = async () => { if (!confirm('Вернуть все цены по умолчанию?')) return; await api('/api/crm/prices', { prices: {} }, 'PUT'); DK.PRICES = JSON.parse(JSON.stringify(DK.PRICES_DEFAULT)); renderPrices(); };
}

/* ---------- сетка цены лида ---------- */
function renderGrid() {
  history.replaceState(null, '', location.pathname);
  const g = META.settings.grid;
  $('#main').innerHTML = `<h1>Сетка цены лида</h1><div class="box" style="max-width:720px"><p>Цена лида для строительной компании — процент от стоимости домовладения (согласованной с клиентом или нашего расчёта).</p>
  <table><thead><tr><th>Лид</th><th>Признаки</th><th class="num">% от стоимости</th></tr></thead><tbody>
  <tr><td><span class="badge cold">Холодный</span></td><td>Запрос расчёта, клиент сравнивает</td><td class="num"><input id="gc" type="number" step="0.1" value="${g.cold}" style="width:80px"></td></tr>
  <tr><td><span class="badge warm">Тёплый</span></td><td>Есть участок и (деньги или готов строиться сейчас)</td><td class="num"><input id="gw" type="number" step="0.1" value="${g.warm}" style="width:80px"></td></tr>
  <tr><td><span class="badge hot">Горячий</span></td><td>${Object.values(META.qual).join(', ')}</td><td class="num"><input id="gh" type="number" step="0.1" value="${g.hot}" style="width:80px"></td></tr></tbody></table>
  ${me.staffRole === 'admin' ? '<button class="btn primary" id="gSave" style="margin-top:10px">Сохранить</button>' : '<div class="muted">Меняет администратор</div>'}</div>`;
  if ($('#gSave')) $('#gSave').onclick = async () => { META.settings = await api('/api/crm/settings', { grid: { cold: +$('#gc').value, warm: +$('#gw').value, hot: +$('#gh').value } }, 'PUT'); toast('Сетка сохранена'); };
}

/* ---------- почта ---------- */
async function renderOutbox() {
  history.replaceState(null, '', location.pathname);
  const list = await api('/api/crm/outbox');
  $('#main').innerHTML = `<h1>Почта</h1><div class="muted" style="margin-bottom:10px">Журнал писем: запросы компаниям, уведомления о расчётах и новых заявках. Если почта не настроена (SMTP_HOST), письма сохраняются здесь.</div>
  <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>Когда</th><th>Кому</th><th>Тема</th><th>Статус</th></tr></thead><tbody>${list.map(m => `<tr><td>${dt(m.at)}</td><td>${esc(m.to)}</td><td>${esc(m.subject)}<details><summary class="muted">текст</summary><pre style="white-space:pre-wrap;font:12px var(--mono)">${esc(m.text)}</pre></details></td><td>${m.sent ? '<span class="badge approved">отправлено</span>' : `<span class="badge pending">${esc(m.error || 'не отправлено')}</span>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Писем нет</td></tr>'}</tbody></table></div>`;
}

/* ---------- сотрудники ---------- */
async function renderStaff() {
  history.replaceState(null, '', location.pathname);
  const list = await api('/api/crm/staff');
  $('#main').innerHTML = `<h1>Сотрудники</h1><div class="box"><table><thead><tr><th>Имя</th><th>Почта</th><th>Роль</th></tr></thead><tbody>${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${{ admin: 'Администратор', estimator: 'Сметчик', manager: 'Менеджер', marketer: 'Маркетолог' }[u.staffRole]}</td></tr>`).join('')}</tbody></table></div>
  ${me.staffRole === 'admin' ? `<div class="box" style="max-width:720px"><h2 style="margin-top:0">Добавить сотрудника</h2><form id="sf" class="grid2"><label class="f">Имя<input name="name" required></label><label class="f">Эл. почта<input name="email" type="email" required></label>
  <label class="f">Пароль (от 8 символов)<input name="password" type="password" minlength="8" required></label><label class="f">Роль<select name="staffRole"><option value="manager">Менеджер — заявки и клиенты</option><option value="estimator">Сметчик — цены и расчёты</option><option value="marketer">Маркетолог — контент сайта, статьи, SEO</option><option value="admin">Администратор — всё</option></select></label>
  <div><button class="btn primary">Добавить</button></div></form></div>` : ''}`;
  if ($('#sf')) $('#sf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('/api/crm/staff', { name: f.name.value, email: f.email.value, password: f.password.value, staffRole: f.staffRole.value }); toast('Сотрудник добавлен'); renderStaff(); } catch (er) { toast(er.message); } };
}

window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && /^\d/.test(h) && (!L || L.id !== h)) openLead(h); });
if (token) start(); else showLogin();
})();
