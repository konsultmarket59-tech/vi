/* Каталог строительных компаний и архитекторов, регистрация исполнителей */
(function () {
'use strict';
const DK = window.DK;
DK.ORG_TYPES = { builder: 'Строительная компания', architect: 'Архитектор', bureau: 'Архитектурное бюро' };
DK.MATS = { gas: 'Газобетон', brick: 'Кирпич', ceramic: 'Керамоблок', frame: 'Каркас', timber: 'Брус / клеёный брус', monolith: 'Монолит' };

let list = (DK.CATALOG_SEED || []).slice();
DK.loadCatalog = async function () {
  if (location.protocol === 'file:') return list;
  try {
    const r = await fetch((DK.CONFIG.api || '') + '/api/catalog');
    if (r.ok) { const extra = await r.json(); const ids = new Set(list.map(c => c.id)); list = list.concat(extra.filter(c => !ids.has(c.id))); }
  } catch (e) { /* без сервера — стартовый каталог */ }
  return list;
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
DK.esc = esc;

DK.renderCatalog = function (el, kind, f) {
  const want = kind === 'arch' ? ['architect', 'bureau'] : ['builder'];
  const q = (f.q || '').trim().toLowerCase();
  const items = list.filter(c => want.includes(c.type))
    .filter(c => !f.city || (c.regions || [c.city]).concat(c.city).some(x => x.toLowerCase().includes(f.city.toLowerCase())))
    .filter(c => !f.mat || (c.materials || []).includes(f.mat))
    .filter(c => !f.cls || (c.classes || []).includes(f.cls))
    .filter(c => !q || (c.name + ' ' + c.about + ' ' + c.city).toLowerCase().includes(q))
    .sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || (b.rating || 0) - (a.rating || 0));
  if (!items.length) {
    el.innerHTML = `<div class="empty"><b>Пока никого по этим условиям</b><p>Каталог пополняется: компании и архитекторы регистрируются сами и проходят проверку. Оставьте заявку на подбор — найдём исполнителя в вашем городе.</p></div>`;
    return;
  }
  el.innerHTML = items.map(c => `
    <article class="org">
      <header><div><small>${esc(DK.ORG_TYPES[c.type])}${c.verified ? ' · <span class="ok">проверено</span>' : ''}</small><h3>${esc(c.name)}</h3></div>
        <div class="rate">${c.rating ? '★ ' + Number(c.rating).toFixed(1) + '<small>' + c.reviews + ' отзывов</small>' : '<small>нет отзывов</small>'}</div></header>
      <p>${esc(c.about)}</p>
      <dl>
        <dt>Город</dt><dd>${esc((c.regions && c.regions.length ? c.regions : [c.city]).join(', '))}</dd>
        ${c.materials && c.materials.length ? `<dt>Материалы</dt><dd>${c.materials.map(m => esc(DK.MATS[m] || m)).join(', ')}</dd>` : ''}
        ${c.priceFrom ? `<dt>Цена</dt><dd>от ${Number(c.priceFrom).toLocaleString('ru-RU')} ₽/м²</dd>` : ''}
        ${c.since ? `<dt>На рынке</dt><dd>с ${esc(c.since)} года</dd>` : ''}
        ${c.address ? `<dt>Адрес</dt><dd>${esc(c.address)}</dd>` : ''}
      </dl>
      <footer>
        ${c.phone ? `<a class="btn sm" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${esc(c.phone)}</a>` : ''}
        ${c.email ? `<a class="btn sm ghost" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''}
        ${c.site ? `<a class="btn sm ghost" href="${esc(/^https?:/.test(c.site) ? c.site : 'https://' + c.site)}" target="_blank" rel="noopener">Сайт</a>` : ''}
        ${!c.phone && !c.email ? '<button class="btn sm primary" type="button" data-lead-org>Связаться через «Логику Дома»</button>' : ''}
      </footer>
    </article>`).join('');
  // без своих контактов на сайте — связь через заявку на подбор
  el.querySelectorAll('[data-lead-org]').forEach(b => b.onclick = () => { const t = document.querySelector('.top [data-act="lead"]'); if (t) t.click(); });
};

DK.registerOrg = async function (data) {
  if (location.protocol === 'file:') return { ok: false, offline: true };
  try {
    let g; try { g = await DK.guard.data(document.getElementById('joinForm')); } catch (er) { return { ok: false, error: er.message }; }
    const r = await fetch((DK.CONFIG.api || '') + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, data, g)) });
    return r.ok ? await r.json() : { ok: false, error: (await r.json().catch(() => ({}))).error };
  } catch (e) { return { ok: false, offline: true }; }
};
})();
