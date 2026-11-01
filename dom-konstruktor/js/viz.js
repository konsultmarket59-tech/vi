/* Реалистичная визуализация: снимок текущего 3D-вида (снаружи или интерьер) уходит на сервер, сервер генерирует
   фотореалистичную картинку через API «Пользы» и списывает 1 визуализацию с баланса (при ошибке — возвращает).
   Пополнение баланса — пакеты по ссылке банка и коды активации в личном кабинете. */
(function () {
'use strict';
const DK = window.DK, $ = (s, r) => (r || document).querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const word = (n) => n % 10 === 1 && n % 100 !== 11 ? 'визуализация' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'визуализации' : 'визуализаций';
const aspectOf = (w, h) => { const r = w / h, A = [['16:9', 16 / 9], ['3:2', 1.5], ['4:3', 4 / 3], ['1:1', 1]]; return A.reduce((b, a) => Math.abs(a[1] - r) < Math.abs(b[1] - r) ? a : b)[0]; };
let shot = null, busy = false;

function dlg() {
  let d = $('#vizDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'vizDlg'; d.className = 'vz-dlg'; document.body.appendChild(d); }
  return d;
}
async function open() {
  const M = DK.Market;
  if (!M.user()) { DK.toast && DK.toast('Войдите или зарегистрируйтесь — первая визуализация в подарок, если она включена'); M.openCabinet('client'); return; }
  shot = DK.appApi.shot3d(); if (!shot) { DK.toast && DK.toast('Откройте вид «Снаружи» или «Интерьер 3D» и выберите ракурс'); return; }
  const d = dlg(); paint(d, null); d.showModal();
  try { const r = await M.api('/api/renders'); paint(d, r); } catch (e) { paint(d, { error: e.message }); }
}
function paint(d, st, result, err) {
  const bal = st && st.balance != null ? st.balance : null, ready = st ? st.ready : true;
  d.innerHTML = `<div class="dlg"><header style="display:flex;justify-content:space-between;gap:12px"><div><small class="over">${shot.kind === 'ext' ? 'Дом снаружи' : 'Интерьер'}</small><h2 style="margin:2px 0 0">Реалистичная визуализация</h2></div><button class="x" type="button" data-x aria-label="Закрыть">×</button></header>
    <div class="vz-pair"><figure><img src="${shot.data}" alt="Снимок из конструктора"><figcaption>Ваш ракурс из конструктора</figcaption></figure>
      <figure>${result ? `<a href="${esc(result)}" target="_blank" rel="noopener"><img src="${esc(result)}" alt="Реалистичная визуализация"></a><figcaption>Готово — сохранено в личном кабинете</figcaption>` : busy ? '<div class="vz-wait"><div><i></i>Генерируем… обычно 20–60 секунд.<br>Не закрывайте окно.</div></div>' : `<div class="vz-wait"><div>${err ? `<b style="color:#F05C78">${esc(err)}</b>` : 'Здесь появится фотореалистичная картинка: золотой час, контровой свет, сад вокруг дома. Архитектура, окна и материалы — как в вашем проекте.'}</div></div>`}</figure></div>
    <details class="more"><summary>Как это работает</summary>Снимок текущего вида уходит в сервис генерации, он дорисовывает свет, материалы и окружение, не меняя дом. Людей, машин и надписей на картинке не будет. Если генерация не удалась, визуализация возвращается на баланс. Ракурс меняйте мышью в 3D до нажатия кнопки.</details>
    <div class="vz-bar"><span class="vz-bal">${bal == null ? 'Баланс загружается…' : `На балансе: <b>${bal}</b> ${word(bal)}`}</span>
      <span class="row" style="display:flex;gap:8px;flex-wrap:wrap">${result ? `<a class="btn" href="${esc(result)}" download="vizualizaciya.jpg">Скачать</a>` : ''}
        ${!ready ? '<span class="muted">Генерация скоро появится — купленные визуализации сохранятся.</span>' : bal === 0 ? '<button class="btn primary" type="button" data-buy>Пополнить баланс</button>' : `<button class="btn primary" type="button" data-go${busy || bal == null ? ' disabled' : ''}>${result ? 'Ещё вариант' : 'Сделать визуализацию'} — 1 ${word(1)}</button>`}</span></div></div>`;
  $('[data-x]', d).onclick = () => d.close();
  const buy = $('[data-buy]', d); if (buy) buy.onclick = () => { d.close(); DK.Market.openCabinet('client'); setTimeout(() => { const v = document.querySelector('.viz'); if (v) v.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 600); };
  const go = $('[data-go]', d); if (go) go.onclick = () => run(d, st);
}
async function run(d, st) {
  if (busy) return; busy = true; paint(d, st);
  try {
    const P = DK.appApi.project();
    const r = await DK.Market.api('/api/render', { image: shot.data, kind: shot.kind, aspect: aspectOf(shot.w, shot.h), title: P.cloudTitle || P.name || '' });
    busy = false; paint(d, Object.assign({}, st, { balance: r.balance }), r.url + '?t=' + Date.now());
  } catch (e) {
    busy = false; let b = st && st.balance; try { b = (await DK.Market.api('/api/renders')).balance; } catch (x) { /* баланс прежний */ }
    paint(d, Object.assign({}, st, { balance: b }), null, e.message);
  }
}
document.addEventListener('DOMContentLoaded', bind); if (document.readyState !== 'loading') bind();
function bind() { const b = $('#vizBtn'); if (b && !b.dataset.on) { b.dataset.on = '1'; b.onclick = open; } }
DK.openViz = open;
})();
