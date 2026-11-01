/* Защита форм от ботов на стороне браузера: токен формы с сервера, скрытое поле-ловушка и Яндекс SmartCaptcha,
   если на сервере задан ключ (SMARTCAPTCHA_CLIENT_KEY). Формы добавляют поля через DK.guard.data(form). */
(function () {
'use strict';
const DK = window.DK = window.DK || {};
const G = DK.guard = { t: '', key: '', ready: null, ids: new Map() };

G.init = function () {
  if (location.protocol === 'file:' || window.__PREVIEW) return (G.ready = Promise.resolve());
  G.ready = fetch((DK.CONFIG && DK.CONFIG.api || '') + '/api/form-token').then(r => r.json()).then(d => {
    G.t = d.t || ''; G.key = d.captchaKey || '';
    if (G.key && !window.smartCaptcha) { const s = document.createElement('script'); s.src = 'https://smartcaptcha.yandexcloud.net/captcha.js'; s.defer = true; document.head.appendChild(s); }
  }).catch(() => { /* сервер недоступен — формы сохранятся файлом */ });
  // токен живёт 12 часов: обновляем раз в 6
  setTimeout(G.init, 6 * 3600e3);
  return G.ready;
};
/* капча появляется, когда человек начинает заполнять форму */
function mount(form) {
  if (!G.key || !window.smartCaptcha) return;
  let box = form.querySelector('.captcha-box');
  if (!box) { box = document.createElement('div'); box.className = 'captcha-box'; const btn = form.querySelector('[type=submit]'); (btn ? btn.parentNode : form).insertBefore(box, btn ? btn : null); }
  if (!G.ids.has(box)) G.ids.set(box, window.smartCaptcha.render(box, { sitekey: G.key, hl: 'ru' }));
}
document.addEventListener('focusin', (e) => { const f = e.target.closest && e.target.closest('form[data-guard]'); if (f) mount(f); });

/* поля для отправки: токен, ловушка, ответ капчи */
G.data = async function (form) {
  await (G.ready || G.init());
  const out = { ft: G.t, website: form && form.elements && form.elements.website ? form.elements.website.value : '' };
  if (G.key) {
    const box = form && form.querySelector('.captcha-box'), id = box && G.ids.get(box);
    out.captcha = id != null && window.smartCaptcha ? window.smartCaptcha.getResponse(id) : '';
    if (!out.captcha) { if (form) mount(form); throw new Error('Подтвердите, что вы не робот'); }
  }
  return out;
};
G.reset = function (form) { const box = form && form.querySelector('.captcha-box'), id = box && G.ids.get(box); if (id != null && window.smartCaptcha) window.smartCaptcha.reset(id); };
/* скрытое поле-ловушка: человек его не видит, бот заполняет */
G.trap = '<label class="hp" aria-hidden="true">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>';
G.init();
})();
