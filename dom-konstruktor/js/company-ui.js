/* Кабинет строительной компании: запросы на расчёт, эскиз и ТЗ, единая форма расчёта. */
(function () {
'use strict';
const DK = window.DK;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rub = (v) => Math.round(+v || 0).toLocaleString('ru-RU') + ' ₽';
const dt = (s) => s ? new Date(s).toLocaleDateString('ru-RU') : '';
const tok = () => { try { return localStorage.getItem('dk-token') || ''; } catch (e) { return ''; } };

async function render(openId) {
  await (DK.Market.ready || Promise.resolve());
  const box = $('#compBody'), u = DK.Market.user();
  if (!u || u.role !== 'company') {
    box.innerHTML = `<div class="card" style="max-width:640px"><p>Кабинет для строительных компаний: запросы на расчёт по готовым эскизным проектам, техзадание и единая форма расчёта. Регистрация бесплатная, платите только за горячий лид — 2 % от стоимости домовладения.</p>
      <div class="row"><button class="btn primary" id="cLogin">Войти</button><button class="btn" id="cReg">Зарегистрировать компанию</button></div></div>`;
    $('#cLogin').onclick = () => DK.Market.openCabinet('company');
    $('#cReg').onclick = () => { DK.Market.openCabinet('company'); setTimeout(() => { const b = $('#authTabs [data-t="reg"]'); if (b) b.click(); }, 0); };
    return;
  }
  let d;
  try { d = await DK.Market.api('/api/company/me'); } catch (e) { box.innerHTML = `<p class="err-t">${esc(e.message)}</p>`; return; }
  const c = d.company;
  if (!c) { box.innerHTML = '<p>Карточка компании не найдена — напишите нам.</p>'; return; }
  const st = { pending: 'на проверке — запросы начнут приходить после одобрения', approved: 'проверена — запросы приходят на почту и сюда', rejected: 'отклонена — свяжитесь с нами' }[c.status];
  box.innerHTML = `<div class="card"><b>${esc(c.name)}</b>${c.city ? ' · ' + esc(c.city) : ''} · статус: ${esc(st)}<div class="muted">Цена лида: холодный — ${d.grid.cold} %, тёплый — ${d.grid.warm} %, горячий (${Object.values(d.qual).join(', ').toLowerCase()}) — ${d.grid.hot} % от стоимости домовладения.</div></div>
    <details class="card"><summary><b>Профиль: где строите, банки, эскроу</b> <span class="muted">— ${esc((c.cities || c.regions || []).join(', ') || 'города не указаны')}${(c.banks || []).length ? ' · банки: ' + esc(c.banks.join(', ')) : ''}${c.escrow ? ' · эскроу' : ''}</span></summary>
      <form id="cProf" class="q" style="margin-top:10px"><div class="fld">Города и районы, где строите<div class="chips">${Array.from(new Set(DK.CITIES.concat(c.cities || []))).map(x => `<label><input type="checkbox" name="cw" value="${esc(x)}"${(c.cities || []).includes(x) ? ' checked' : ''}>${esc(x)}</label>`).join('')}</div><input name="more" placeholder="Ещё города через запятую"></div>
      <div class="fld">Аккредитация в банках<div class="chips">${DK.BANKS.map(b => `<label><input type="checkbox" name="bk" value="${esc(b)}"${(c.banks || []).includes(b) ? ' checked' : ''}>${esc(b)}</label>`).join('')}</div></div>
      <label class="chk"><input type="checkbox" name="escrow"${c.escrow ? ' checked' : ''}>Готовы строить по эскроу-счёту</label>
      <div><button class="btn primary">Сохранить профиль</button></div></form></details>
    <h2>Запросы на расчёт</h2><div id="compList">${d.requests.length ? d.requests.map(r => `<div class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;cursor:pointer" data-id="${esc(r.id)}">
      <b>№ ${esc(r.id)}</b><span>${dt(r.at)}</span><span>${esc(r.city)}</span><span>${r.area ? Math.round(r.area) + ' м²' : ''}</span><span>${esc((DK.MATS && DK.MATS[r.material]) || ({ any: 'материал не важен' })[r.material] || r.material || '')}</span>
      <span style="flex:1"></span>${r.deal ? '<span class="badge ok">вас выбрали для сделки</span>' : ''}${r.myBid ? `<span class="badge">ваш расчёт ${rub(r.myBid.total)}</span>` : '<span class="badge warn">ждёт расчёта</span>'}</div>`).join('') : '<p class="muted">Запросов пока нет.</p>'}</div><div id="compReq"></div>`;
  $$('#compList [data-id]').forEach(el => el.onclick = () => openReq(el.dataset.id));
  $('#cProf').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, cities = $$('[name=cw]:checked', f).map(i => i.value).concat(f.more.value.split(',').map(x => x.trim()).filter(Boolean));
    try { await DK.Market.api('/api/company/me', { cities, banks: $$('[name=bk]:checked', f).map(i => i.value), escrow: f.escrow.checked }); DK.toast('Профиль сохранён'); render(); } catch (er) { DK.toast(er.message); }
  };
  if (openId) openReq(openId);
}
async function openReq(id) {
  const r = await DK.Market.api('/api/company/lead/' + encodeURIComponent(id)), box = $('#compReq'), b = r.myBid || { rows: {} };
  box.innerHTML = `<div class="card"><h2 style="margin-top:0">Запрос № ${esc(r.id)} — ${esc(r.city)}${r.area ? ', ' + Math.round(r.area) + ' м²' : ''}</h2>
    <div class="muted">Участок: ${esc(r.plot)} · уклон: ${esc(r.slope)} · срок: ${esc(r.term)} · класс: ${esc(r.cls)}${r.range ? ` · предварительная оценка ${r.range[0]}–${r.range[1]} млн ₽` : ''}</div>
    ${r.deal ? '<p class="card" style="background:#E6F6EB"><b>Клиент готов к сделке с вашей компанией.</b> Менеджер «Логика Дома» свяжется с вами, чтобы согласовать встречу.</p>' : ''}
    ${r.contacts ? `<p><b>Контакты клиента:</b> ${esc(r.contacts.name)}, ${esc(r.contacts.phone)}</p>` : '<p class="muted">Контакты клиента откроются, когда клиент выберет вашу компанию.</p>'}
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">${r.files.map(f => `<img data-src="/api/company/lead/${encodeURIComponent(r.id)}/file/${encodeURIComponent(f)}" alt="${esc(f)}" style="height:140px;border:1px solid #D9DEE8;border-radius:8px;background:#fff">`).join('')}</div>
    ${r.project ? `<p><a class="btn" href="/?company=${encodeURIComponent(r.id)}" target="_blank">Открыть эскиз в конструкторе — размеры, 3D, рулетка</a></p>` : ''}
    <div class="grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div><h3>Описание</h3><ul>${r.brief.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div><div><h3>Техзадание</h3><ul>${(r.tz.length ? r.tz : ['Уточняется после созвона с клиентом']).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div></div>
    <h3>Ваш расчёт — единая форма</h3><form id="bidF"><table class="tbl" style="width:100%;max-width:640px">${Object.entries(r.rows).map(([k, n]) => `<tr><td>${esc(n)}</td><td><input name="${k}" type="number" min="0" step="1000" value="${b.rows[k] || ''}" style="width:160px;text-align:right"> ₽</td></tr>`).join('')}
      <tr><td><b>Итого</b></td><td><b id="bidSum">${rub(b.total)}</b></td></tr><tr><td>Срок строительства, мес.</td><td><input name="term" type="number" min="0" step="0.5" value="${b.term || ''}" style="width:100px"></td></tr></table>
      <label class="fld" style="max-width:640px">Комментарий: что входит, что нет, условия оплаты<textarea name="comment" rows="3">${esc(b.comment || '')}</textarea></label>
      <button class="btn primary" type="submit">${r.myBid ? 'Обновить расчёт' : 'Отправить расчёт'}</button> <span class="muted">${r.myBid ? 'Отправлено ' + dt(r.myBid.at) : ''}</span></form></div>`;
  $$('#compReq img[data-src]').forEach(async (img) => { try { const x = await fetch(img.dataset.src, { headers: { Authorization: 'Bearer ' + tok() } }); const bl = await x.blob(); img.src = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(bl); }); img.onclick = () => window.open(img.src, '_blank'); } catch (e) { /* нет */ } });
  const f = $('#bidF'), keys = Object.keys(r.rows);
  const sum = () => keys.reduce((s, k) => s + (+f[k].value || 0), 0);
  keys.forEach(k => f[k].oninput = () => { $('#bidSum').textContent = rub(sum()); });
  f.onsubmit = async (e) => {
    e.preventDefault(); const rows = {}; keys.forEach(k => rows[k] = +f[k].value || 0);
    if (!sum()) return DK.toast('Заполните расчёт');
    try { await DK.Market.api(`/api/company/lead/${encodeURIComponent(r.id)}/bid`, { rows, term: +f.term.value || 0, comment: f.comment.value }); DK.toast('Расчёт отправлен'); render(r.id); }
    catch (er) { DK.toast(er.message); }
  };
  box.scrollIntoView({ behavior: 'smooth' });
}
DK.Company = { render };
})();
