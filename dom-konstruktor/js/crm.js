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
  $('#who').textContent = `${me.name} · ${{ admin: 'администратор', estimator: 'сметчик', manager: 'менеджер' }[me.staffRole]}`;
  await DK.loadPrices();
  const h = location.hash.slice(1);
  if (h && /^\d/.test(h)) openLead(h); else go('leads');
}
function go(s) {
  section = s; $$('#nav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.s === s)));
  ({ leads: renderLeads, companies: renderCompanies, prices: renderPrices, grid: renderGrid, outbox: renderOutbox, staff: renderStaff })[s]();
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
      <td>${STATUS[l.status] || l.status}</td><td class="num">${l.bids}/${l.rfq ? 'отпр.' : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Заявок нет</td></tr>';
    $$('#lt tr.click').forEach(tr => tr.onclick = () => openLead(tr.dataset.id));
  };
  $('#lq').oninput = (e) => { leadFilter.q = e.target.value; draw(); }; $('#ls').onchange = (e) => { leadFilter.status = e.target.value; draw(); };
  draw();
}

let L = null, tab = 'client', companiesCache = null;
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
  $$('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; drawLead(); });
  ({ client: tabClient, project: tabProject, calc: tabCalc, bids: tabBids, log: tabLog })[tab]();
}
async function save(d, msg) { L = await api('/api/crm/lead/' + L.id, d); toast(msg || 'Сохранено'); drawLead(); }

function tabClient() {
  const a = L.answers || {}, c = Object.assign({ name: a.name, phone: a.phone, city: a.city }, L.client || {}), q = L.qual || {};
  $('#tab').innerHTML = `<div class="grid2"><div class="box"><h2 style="margin-top:0">Карточка клиента</h2><form id="cf" class="grid2">
    ${[['name', 'Имя'], ['phone', 'Телефон'], ['email', 'Эл. почта'], ['city', 'Город'], ['address', 'Адрес участка'], ['plotNo', 'Кадастровый номер'], ['source', 'Источник']].map(([k, n]) => `<label class="f">${n}<input name="${k}" value="${esc(c[k] || '')}"></label>`).join('')}
    <label class="f">Менеджер<input name="manager" value="${esc(L.manager || me.name)}"></label>
    <div style="grid-column:1/-1"><button class="btn primary">Сохранить карточку</button></div></form>
    <h2>Анкета клиента</h2><div class="muted">Участок: ${esc(a.plot)} · уклон: ${esc(a.slope)} · срок: ${esc(a.term)} · бюджет: ${esc(a.cls)} · материал: ${esc(a.material)}${a.time ? ' · звонить: ' + esc(a.time) : ''}</div>${a.note ? `<p>${esc(a.note)}</p>` : ''}</div>
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
  $$('#tab img[data-src]').forEach(async (img) => { try { const r = await fetch(img.dataset.src, { headers: { Authorization: 'Bearer ' + token } }); img.src = URL.createObjectURL(await r.blob()); } catch (e) { /* нет файла */ } });
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
  const city = ((L.client || {}).city || (L.answers || {}).city || '').toLowerCase();
  const ok = companiesCache.filter(c => c.status === 'approved').sort((a, b) => (String(b.city).toLowerCase().includes(city) ? 1 : 0) - (String(a.city).toLowerCase().includes(city) ? 1 : 0));
  const sent = new Set((L.rfq || []).flatMap(r => r.companies)), bids = L.bids || [], rows = META.rows, share = new Set(L.shareWith || []);
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
    <table style="margin:10px 0"><thead><tr><th></th><th>Компания</th><th>Город</th><th>Почта</th><th>Статус</th></tr></thead><tbody>${ok.map(c => `<tr><td><input type="checkbox" class="rc" value="${c.id}"${sent.has(c.id) ? ' disabled' : ''}></td><td>${esc(c.name)}</td><td>${esc(c.city)}</td><td>${esc(Array.from(new Set([c.email].concat(c.accounts || []).filter(Boolean))).join(', '))}</td><td>${sent.has(c.id) ? 'отправлено' : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Нет проверенных компаний — одобрите их в разделе «Компании».</td></tr>'}</tbody></table>
    <div class="row"><input id="rmsg" placeholder="Комментарий для компаний (необязательно)"><button class="btn primary" id="rsend">Отправить на расчёт</button></div></div>
  <div class="box" style="overflow:auto"><h2 style="margin-top:0">Ответы компаний</h2>${bids.length ? `<table><thead><tr><th>Раздел</th>${ours ? '<th class="num">Наш расчёт</th>' : ''}${bids.map(b => `<th class="num">${esc(b.name)}<br><small>${dt(b.at)}</small></th>`).join('')}</tr></thead><tbody>
    ${Object.entries(rows).map(([k, n]) => `<tr><td>${esc(n)}</td>${ours ? `<td class="num muted">${rub(ours[k])}</td>` : ''}${bids.map(b => `<td class="num">${rub(b.rows[k])}</td>`).join('')}</tr>`).join('')}
    <tr><td><b>Итого</b></td>${ours ? `<td class="num"><b>${rub(ours.total)}</b></td>` : ''}${bids.map(b => `<td class="num"><b>${rub(b.total)}</b>${ours ? `<br><small class="${b.total < ours.total * 0.85 ? 'err' : 'muted'}">${Math.round((b.total / ours.total - 1) * 100)} % к нашему</small>` : ''}</td>`).join('')}</tr>
    <tr><td>Срок, мес.</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td class="num">${b.term || '—'}</td>`).join('')}</tr>
    <tr><td>Комментарий</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td><small>${esc(b.comment)}</small></td>`).join('')}</tr>
    <tr><td>Контакты клиента</td>${ours ? '<td></td>' : ''}${bids.map(b => `<td><label class="row"><input type="checkbox" class="sh" value="${b.company}"${share.has(b.company) ? ' checked' : ''}> открыть</label></td>`).join('')}</tr></tbody></table>
    <div class="muted">Красным — расчёт дешевле нашего больше чем на 15 %: проверьте состав работ.</div>` : '<div class="muted">Ответов пока нет.</div>'}</div>`;
  $('#rsend').onclick = async () => {
    const ids = $$('.rc:checked').map(i => i.value); if (!ids.length) return toast('Отметьте компании');
    // ТЗ: если менеджер не заполнил — пункты из проекта
    const tz = L.tz && L.tz.length ? null : L.project ? DK.tzItems(DK.normalize(DK.migrate(JSON.parse(JSON.stringify(L.project))))) : null;
    try { L = await api(`/api/crm/lead/${L.id}/rfq`, { companies: ids, message: $('#rmsg').value, tz }); toast('Отправлено: ' + ids.length); drawLead(); } catch (e) { toast(e.message); }
  };
  $$('.sh').forEach(i => i.onchange = () => save({ shareWith: $$('.sh:checked').map(x => x.value) }, i.checked ? 'Контакты открыты компании' : 'Контакты скрыты'));
}
function tabLog() {
  const items = [].concat((L.log || []).map(x => ({ at: x.at, t: x.text })), (L.notes || []).map(n => ({ at: n.at, t: (n.by ? n.by + ': ' : '') + n.text })), [{ at: L.at, t: 'Заявка с сайта' }]).sort((a, b) => b.at.localeCompare(a.at));
  $('#tab').innerHTML = `<div class="box timeline">${items.map(i => `<div><small>${dt(i.at)}</small><br>${esc(i.t)}</div>`).join('')}</div>`;
}

/* ---------- компании ---------- */
async function renderCompanies() {
  history.replaceState(null, '', location.pathname);
  const list = companiesCache = await api('/api/crm/companies');
  $('#main').innerHTML = `<h1>Строительные компании</h1><div class="muted" style="margin-bottom:10px">Одобренные компании получают запросы на расчёт и видны в каталоге. После одобрения компании уходит письмо.</div>
  <div class="box" style="padding:0;overflow:auto"><table><thead><tr><th>Компания</th><th>Город и регионы</th><th>Контакты</th><th>Аккаунт</th><th>ИНН</th><th>Статус</th><th>Рейтинг</th></tr></thead><tbody>
  ${list.map(c => `<tr data-id="${c.id}"><td><b>${esc(c.name)}</b><br><small class="muted">${dt(c.at)}</small></td><td>${esc([c.city].concat(c.regions || []).join(', '))}</td><td>${esc(c.phone)}<br>${esc(c.email || '')}</td><td>${esc((c.accounts || []).join(', ') || '—')}</td><td>${esc(c.inn || '')}</td>
    <td><select class="cs">${['pending', 'approved', 'rejected'].map(s => `<option value="${s}"${c.status === s ? ' selected' : ''}>${{ pending: 'На проверке', approved: 'Одобрена', rejected: 'Отклонена' }[s]}</option>`).join('')}</select></td>
    <td><input class="cr" type="number" min="0" max="5" step="0.1" value="${c.rating || ''}" style="width:70px"></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Компаний нет</td></tr>'}</tbody></table></div>`;
  $$('#main tr[data-id]').forEach(tr => {
    $('.cs', tr).onchange = async (e) => { try { await api('/api/crm/company/' + tr.dataset.id, { status: e.target.value }); toast('Статус обновлён'); } catch (er) { toast(er.message); } };
    $('.cr', tr).onchange = async (e) => { try { await api('/api/crm/company/' + tr.dataset.id, { rating: +e.target.value }); toast('Рейтинг сохранён'); } catch (er) { toast(er.message); } };
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
  $('#main').innerHTML = `<h1>Сотрудники</h1><div class="box"><table><thead><tr><th>Имя</th><th>Почта</th><th>Роль</th></tr></thead><tbody>${list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${{ admin: 'Администратор', estimator: 'Сметчик', manager: 'Менеджер' }[u.staffRole]}</td></tr>`).join('')}</tbody></table></div>
  ${me.staffRole === 'admin' ? `<div class="box" style="max-width:720px"><h2 style="margin-top:0">Добавить сотрудника</h2><form id="sf" class="grid2"><label class="f">Имя<input name="name" required></label><label class="f">Эл. почта<input name="email" type="email" required></label>
  <label class="f">Пароль (от 8 символов)<input name="password" type="password" minlength="8" required></label><label class="f">Роль<select name="staffRole"><option value="manager">Менеджер — заявки и клиенты</option><option value="estimator">Сметчик — цены и расчёты</option><option value="admin">Администратор — всё</option></select></label>
  <div><button class="btn primary">Добавить</button></div></form></div>` : ''}`;
  if ($('#sf')) $('#sf').onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api('/api/crm/staff', { name: f.name.value, email: f.email.value, password: f.password.value, staffRole: f.staffRole.value }); toast('Сотрудник добавлен'); renderStaff(); } catch (er) { toast(er.message); } };
}

window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && /^\d/.test(h) && (!L || L.id !== h)) openLead(h); });
if (token) start(); else showLogin();
})();
