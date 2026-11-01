/* Обучение в конструкторе: при первом открытии — короткий тур по экрану с подсветкой элементов (что здесь можно сделать).
   Повторить — кнопка «Как пользоваться» над конструктором. Показ запоминается в браузере. */
(function () {
'use strict';
const DK = window.DK, $ = (s, r) => (r || document).querySelector(s);
const KEY = 'ld-tour-done';
const STEPS = [
  { sel: '#shapes', t: 'Начните с формы дома', d: 'Выберите готовую форму — это стартовая планировка. Потом тяните стены прямо на плане: дом примет любую форму.', view: 'plan' },
  { sel: '#floorsN', t: 'Этажи и высота', d: 'Один, два или три этажа, цокольный этаж и мансарда. Этажи переключаются вкладками над планом.', view: 'plan' },
  { sel: '#c2d', t: 'План — рабочее поле', d: 'Нажмите на помещение и выберите, что это: спальня, кухня, санузел. Тяните стены, окна и двери; колёсико — масштаб, пустое место — сдвиг.', view: 'plan', pad: -40 },
  { sel: '#checks', t: 'Система подскажет', d: 'В конструктор заложены базовые нормативы. Явные ошибки — слишком большой пролёт, котельная без окна, узкий коридор — появятся здесь с подсказкой, как исправить.', view: 'plan' },
  { sel: '#est', t: 'Сколько будет стоить', d: 'Ценовой ориентир строительства «тёплого контура» по средним ценам рынка пересчитывается при каждом изменении.', view: 'plan' },
  { sel: '#views', t: 'Смотрите дом в 3D', d: '«Интерьер 3D» — расставьте мебель и проверьте, хватает ли места. «Прогулка» — пройдитесь по дому. «Снаружи» — кровля, фасады и стили отделки.' },
  { sel: '#floorTabs', t: 'Участок', d: 'На вкладке «Участок» задайте размеры участка, поставьте дом, баню, гараж и деревья — отступы по нормам проверятся сами.' },
  { sel: '#shot', t: 'Снимки и эскизный проект', d: '«Снимок PNG» — бесплатно сохраните план или вид. «Реалистичная визуализация» превратит ракурс 3D в фотографию — первая бесплатно при регистрации. «Эскизный проект» — 13 листов для строителей и архитектора.', wide: '#sketchBtn' },
  { sel: '[data-act="publish"]', t: 'Сохраните проект', d: 'Сохраните проект в личный кабинет или опубликуйте в каталоге — можно назначить цену за его использование. Из кабинета — выгрузки и подбор строительной компании.', opt: true },
];
let i = 0, on = false, box, hole;
function ui() {
  if (box) return;
  const css = document.createElement('style');
  css.textContent = `.tr-hole{position:fixed;z-index:80;border-radius:12px;box-shadow:0 0 0 9999px rgba(13,26,69,.55);transition:all .25s ease;pointer-events:none;outline:2px solid #26C6C8}
  .tr-box{position:fixed;z-index:81;width:min(360px,calc(100vw - 32px));background:#fff;border-radius:16px;box-shadow:0 18px 40px -12px rgba(13,26,69,.45);padding:18px 18px 14px;font:400 14px/1.55 Inter,system-ui,sans-serif;color:#242832;transition:top .25s,left .25s}
  .tr-box small{font:600 11px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#7A8193}.tr-box h4{font:700 18px/1.3 Manrope,sans-serif;color:#19317B;margin:4px 0 6px}.tr-box p{margin:0 0 12px}
  .tr-nav{display:flex;gap:8px;align-items:center}.tr-nav .sp{flex:1}.tr-dots{display:flex;gap:4px;margin-bottom:10px}.tr-dots i{width:18px;height:3px;border-radius:2px;background:#E4E8EF}.tr-dots i.on{background:#26C6C8}
  .tr-skip{border:0;background:none;color:#7A8193;font:500 13px Inter,sans-serif;cursor:pointer;padding:6px 4px}`;
  document.head.appendChild(css);
  hole = document.createElement('div'); hole.className = 'tr-hole';
  box = document.createElement('div'); box.className = 'tr-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Как пользоваться конструктором');
  document.body.append(hole, box);
  addEventListener('resize', () => on && place()); addEventListener('scroll', () => on && place(), { passive: true });
  addEventListener('keydown', (e) => { if (!on) return; if (e.key === 'Escape') stop(); if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); });
}
const list = () => STEPS.filter(s => { const el = $(s.sel); return el && el.offsetParent !== null; });
function place() {
  const S = list()[i]; if (!S) return; const el = $(S.sel), r = el.getBoundingClientRect();
  let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
  if (S.wide && $(S.wide)) { const r2 = $(S.wide).getBoundingClientRect(); x0 = Math.min(x0, r2.left); y0 = Math.min(y0, r2.top); x1 = Math.max(x1, r2.right); y1 = Math.max(y1, r2.bottom); }
  const p = S.pad != null ? S.pad : 6; x0 -= p; y0 -= p; x1 += p; y1 += p;
  Object.assign(hole.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
  const bw = box.offsetWidth, bh = box.offsetHeight, W = innerWidth, H = innerHeight;
  let bx = x1 + 16, by = y0; // справа от элемента, иначе снизу, иначе сверху, иначе поверх
  if (bx + bw > W - 12) { bx = Math.min(Math.max(12, x0), W - bw - 12); by = y1 + 14; if (by + bh > H - 12) by = y0 - bh - 14; if (by < 12) by = Math.max(12, Math.min(H - bh - 12, y0 + 20)); }
  box.style.left = bx + 'px'; box.style.top = Math.max(12, Math.min(by, H - bh - 12)) + 'px';
}
function go(k) {
  const L = list(); if (k < 0) return; if (k >= L.length) return stop();
  i = k; const S = L[i];
  box.innerHTML = `<div class="tr-dots">${L.map((_, n) => `<i class="${n <= i ? 'on' : ''}"></i>`).join('')}</div><small>Как пользоваться · ${i + 1} из ${L.length}</small><h4>${S.t}</h4><p>${S.d}</p>
    <div class="tr-nav"><button class="tr-skip" type="button" data-x>Пропустить</button><span class="sp"></span>${i ? '<button class="btn sm ghost" type="button" data-b>Назад</button>' : ''}<button class="btn sm primary" type="button" data-n>${i === L.length - 1 ? 'Начать' : 'Далее'}</button></div>`;
  $('[data-x]', box).onclick = stop; $('[data-n]', box).onclick = () => go(i + 1); const b = $('[data-b]', box); if (b) b.onclick = () => go(i - 1);
  const el = $(S.sel), r = el.getBoundingClientRect();
  if (r.top < 70 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center' });
  requestAnimationFrame(place); setTimeout(place, 320);
}
function start() { ui(); on = true; hole.hidden = box.hidden = false; const w = $('.work'); if (w) { const r = w.getBoundingClientRect(); if (r.top > 80 || r.bottom < 200) w.scrollIntoView({ block: 'start' }); } setTimeout(() => go(0), 250); }
function stop() { on = false; if (hole) hole.hidden = box.hidden = true; try { localStorage.setItem(KEY, '1'); } catch (e) { /* приватный режим */ } }
DK.tour = start;
function init() {
  // кнопка «Как пользоваться» над конструктором
  const t = $('#workT .sec-t'); if (t && !$('#tourBtn')) { const b = document.createElement('button'); b.type = 'button'; b.id = 'tourBtn'; b.className = 'btn tertiary'; b.textContent = 'Как пользоваться'; b.onclick = start; t.appendChild(b); }
  let done = false; try { done = !!localStorage.getItem(KEY); } catch (e) { /* приватный режим */ }
  const q = new URLSearchParams(location.search);
  if (done || q.get('crm') || q.get('crmp') || q.get('company') || window.__DEMO_AS || /^#(cab|company|projects|builders|arch)/.test(location.hash)) return;
  // первый раз: когда конструктор появился на экране (прокрутили или нажали «Создать проект»)
  const w = $('.work'); if (!w || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting && e.intersectionRatio > 0.45) && !document.querySelector('dialog[open]')) { io.disconnect(); setTimeout(start, 400); } }, { threshold: [0.45, 0.6] });
  io.observe(w);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
