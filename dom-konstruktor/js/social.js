/* Окно «Подпишитесь на нас»: соцсети, заголовок, текст и задержка задаются в CRM → «Контент сайта» → «Настройки сайта».
   Сервер кладёт настройки в window.__SOCIAL. Показ: через N секунд на сайте или после прокрутки половины страницы,
   не чаще раза в 14 дней (после перехода в соцсеть — раз в год). Работает и в конструкторе, и на страницах сайта. */
(function () {
'use strict';
const S = window.__SOCIAL;
if (!S || !S.on || !S.links || !S.links.length) return;
const KEY = 'ld-social', DAY = 864e5;
const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
const put = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* приватный режим */ } };
const st = get();
if (st.until && Date.now() < st.until) return;
if (/^\/crm|^\/admin/.test(location.pathname) || /[?&](crm|crmp|company)=/.test(location.search)) return;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// у каждой сети свой цветной узел из палитры бренда
const TONE = { vk: '#2784EB', telegram: '#26C6C8', whatsapp: '#2FB35A', max: '#19317B', youtube: '#F05C78', dzen: '#F49A38' };

const css = `.soc-pop{position:fixed;right:24px;bottom:24px;z-index:60;width:min(380px,calc(100vw - 32px));background:#fff;border:1px solid #D9DEE8;border-radius:16px;
box-shadow:0 18px 40px -12px rgba(13,26,69,.3);padding:20px 20px 18px;font:400 14px/1.5 Inter,system-ui,sans-serif;color:#242832;transform:translateY(16px);opacity:0;transition:transform .35s cubic-bezier(.2,.7,.2,1),opacity .35s}
.soc-pop.in{transform:none;opacity:1}
.soc-pop .soc-x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:22px;line-height:1;color:#7A8193;cursor:pointer;padding:4px 8px}
.soc-pop .soc-grid{position:absolute;inset:0 0 auto 0;height:64px;border-radius:16px 16px 0 0;background-image:linear-gradient(#EEF1F9 1px,transparent 1px),linear-gradient(90deg,#EEF1F9 1px,transparent 1px);background-size:16px 16px;z-index:0;opacity:.9}
.soc-pop>*:not(.soc-grid):not(.soc-x){position:relative;z-index:1}.soc-pop .soc-x{z-index:2}
.soc-pop h3{font:700 19px/1.25 Manrope,system-ui,sans-serif;color:#19317B;margin:6px 28px 8px 0}
.soc-pop p{margin:0 0 14px;color:#5B6272}
.soc-pop .soc-l{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.soc-pop a{display:flex;align-items:center;gap:8px;min-height:40px;padding:8px 12px;border:1px solid #D9DEE8;border-radius:6px;text-decoration:none;color:#19317B;font:600 14px Inter,system-ui,sans-serif;transition:border-color .15s,background .15s}
.soc-pop a:hover{border-color:#19317B;background:#F5F6F8}
.soc-pop a i{width:10px;height:10px;border-radius:50%;flex:none}
.soc-pop .soc-later{margin-top:12px;border:0;background:none;color:#7A8193;font:500 13px Inter,system-ui,sans-serif;cursor:pointer;padding:0}
@media (max-width:640px){.soc-pop{right:16px;left:16px;bottom:16px;width:auto}}
@media (prefers-reduced-motion:reduce){.soc-pop{transition:none}}`;

let shown = false;
function show() {
  if (shown || document.querySelector('dialog[open]')) return;
  shown = true;
  const st2 = document.createElement('style'); st2.textContent = css; document.head.appendChild(st2);
  const d = document.createElement('aside'); d.className = 'soc-pop'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', S.title || 'Подпишитесь');
  d.innerHTML = `<div class="soc-grid" aria-hidden="true"></div><button class="soc-x" type="button" aria-label="Закрыть">×</button>
    <h3>${esc(S.title || 'Подпишитесь на «Логику Дома»')}</h3><p>${esc(S.text || 'Идеи планировок, разборы проектов и цены на стройку — в наших соцсетях.')}</p>
    <div class="soc-l">${S.links.map(l => `<a href="${esc(l.u)}" target="_blank" rel="noopener" data-k="${esc(l.k)}"><i style="background:${TONE[l.k] || '#19317B'}"></i>${esc(l.n)}</a>`).join('')}</div>
    <button class="soc-later" type="button">Не сейчас</button>`;
  document.body.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('in')));
  const close = (days) => { put({ until: Date.now() + days * DAY }); d.classList.remove('in'); setTimeout(() => d.remove(), 400); };
  d.querySelector('.soc-x').onclick = () => close(14);
  d.querySelector('.soc-later').onclick = () => close(14);
  d.querySelectorAll('a').forEach(a => a.addEventListener('click', () => close(365)));
}
const delay = Math.max(5, Math.min(600, +S.delay || 30)) * 1000;
setTimeout(show, delay);
// интерес к содержимому: прокрутили больше половины страницы, но не раньше 10 секунд
const t0 = Date.now();
addEventListener('scroll', function onS() {
  const h = document.documentElement, k = (h.scrollTop + innerHeight) / Math.max(1, h.scrollHeight);
  if (k > 0.5 && Date.now() - t0 > 10000) { removeEventListener('scroll', onS); show(); }
}, { passive: true });
})();
