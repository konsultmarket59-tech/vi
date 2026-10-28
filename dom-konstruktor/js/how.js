/* Главная: hero-блок над конструктором и «Как это работает» — всплывающее окно с этапами работы с платформой.
   Окно показывается при первом открытии; потом — по кнопке в hero и на странице «Как это работает». */
(function () {
'use strict';
const DK = window.DK, C = DK.CONFIG;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const rub = (v) => Number(v).toLocaleString('ru-RU') + '\u00a0₽', ic = (n, s) => DK.icon ? DK.icon(n, s || 24) : '';
const KEY = 'ld-how-seen';

// этапы: что делаете, что получаете, сколько стоит
DK.HOW_STEPS = [
  { icon: 'house', tone: 'blue', t: 'Создаёте проект дома', d: 'Выбираете форму, этажи и материал стен, расставляете помещения, двери, окна и мебель. Подсказки объясняют каждое решение, а если система видит категорическую ошибку — например, слишком большой пролёт перекрытия, котельную без окна или лестницу поперёк несущей стены, — она отметит её.', price: [['Конструктор и подсказки', 'бесплатно']] },
  { icon: 'trees', tone: 'green', t: 'Примеряете внешний вид', d: 'Кровля, отделка фасада, терраса и гараж — сразу в 3D. На вкладке «Участок» видно, как дом вписывается в ландшафт: отступы по нормам, постройки, деревья.', price: [['3D, прогулка по дому, участок', 'бесплатно']] },
  { icon: 'calculator', tone: 'orange', t: 'Снимки и стоимость', d: 'Делайте снимки прямо в процессе работы — план с экспликацией или вид в 3D. Усреднённая стоимость строительства пересчитывается на лету по индексам цен из открытых данных.', price: [['Снимки и оценка стоимости', 'бесплатно']] },
  { icon: 'file-check', tone: 'cyan', t: 'Сохраняете проект', d: 'После сохранения в кабинете доступны эскизный проект в PDF и заказ верификации: архитекторы и инженеры платформы поправят неточности и подготовят проект. Можно выбрать архитектора на платформе и доработать документацию по его расценкам.', price: [['Эскизный проект PDF', 'бесплатно'], ['Верификация и раздел АР', rub(C.verifyPrice || 15000)], ['АКР — архитектурные и конструктивные решения', 'от ' + rub(C.akrFrom || 50000)], ['Архитектор платформы', 'по его расценкам']] },
  { icon: 'users', tone: 'coral', t: 'Свой архитектор? Или вы архитектор?', d: 'Есть свой архитектор — добавьте его к проекту в кабинете или сами выгрузите файлы, совместимые с ArchiCAD, и PDF. Вы архитектор — регистрируйтесь, подтвердите диплом, создавайте проекты и выставляйте их на продажу.', price: [['Файлы для ArchiCAD (IFC, DXF) и PDF', 'бесплатно'], ['Продажа своих проектов', 'цену назначаете вы']] },
  { icon: 'hammer', tone: 'navy', t: 'Строительство', d: 'Карточки строительных компаний открыты: свяжитесь с ними сами. Или поручите нам: разошлём проект компаниям, соберём ответы и дадим развёрнутый отчёт. Либо мы представим ваши интересы: доработаем проект, разберём сметы, проведём переговоры и покажем результат — вы выберете 1–3 компании для сделки.', price: [['Связаться с компаниями самостоятельно', 'бесплатно'], ['Рассылка и отчёт, контакты открыты компаниям', 'бесплатно — платит компания за заявку'], ['Рассылка и отчёт, контакты закрыты', rub(C.reportPrice || 14900)], ['Представление ваших интересов', 'платит строительная компания при заключении договора']] },
];

function stepHtml(s, i) {
  return `<section class="how-step tone-${s.tone}" data-i="${i}" ${i ? 'hidden' : ''}>
    <div class="how-art" aria-hidden="true"><span class="how-num">${String(i + 1).padStart(2, '0')}</span><span class="how-ic">${ic(s.icon, 44)}</span><span class="how-ring"></span></div>
    <div class="how-txt"><h3>${s.t}</h3><p>${s.d}</p>
      <ul class="how-price">${s.price.map(([a, b]) => `<li><span>${a}</span><b>${b}</b></li>`).join('')}</ul></div></section>`;
}
function build() {
  if ($('#howDlg')) return;
  const d = document.createElement('dialog'); d.id = 'howDlg'; d.className = 'how-dlg';
  d.innerHTML = `<div class="dlg how"><header><div><small class="over">Как это работает</small><h2>От идеи до договора строительства</h2></div><button class="x" type="button" data-close aria-label="Закрыть">×</button></header>
    <div class="how-bar">${DK.HOW_STEPS.map((s, i) => `<button type="button" data-go="${i}" aria-label="Шаг ${i + 1}: ${s.t}"><i></i></button>`).join('')}</div>
    <div class="how-body">${DK.HOW_STEPS.map(stepHtml).join('')}</div>
    <div class="nav"><button class="btn ghost" type="button" id="howPrev">Назад</button><span class="muted" id="howCnt"></span><button class="btn primary" type="button" id="howNext">Далее</button></div></div>`;
  document.body.appendChild(d);
  let i = 0, timer = null;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const show = (k) => {
    i = Math.max(0, Math.min(DK.HOW_STEPS.length - 1, k));
    $$('.how-step', d).forEach((el, n) => { el.hidden = n !== i; el.classList.toggle('in', n === i); });
    $$('.how-bar button', d).forEach((b, n) => { b.classList.toggle('done', n < i); b.classList.toggle('cur', n === i); });
    $('#howCnt').textContent = `${i + 1} из ${DK.HOW_STEPS.length}`;
    $('#howPrev').disabled = i === 0;
    $('#howNext').textContent = i === DK.HOW_STEPS.length - 1 ? 'Начать проектировать' : 'Далее';
    clearTimeout(timer);
    // автопрокрутка, пока человек сам не нажал на шаги
    if (!reduce && d.dataset.auto === '1' && i < DK.HOW_STEPS.length - 1) timer = setTimeout(() => show(i + 1), 9000);
  };
  const stopAuto = () => { d.dataset.auto = '0'; d.classList.remove('auto'); clearTimeout(timer); };
  $('#howPrev').onclick = () => { stopAuto(); show(i - 1); };
  $('#howNext').onclick = () => { stopAuto(); if (i === DK.HOW_STEPS.length - 1) { d.close(); start(); } else show(i + 1); };
  $$('.how-bar button', d).forEach(b => b.onclick = () => { stopAuto(); show(+b.dataset.go); });
  $('[data-close]', d).onclick = () => d.close();
  d.addEventListener('close', () => { clearTimeout(timer); try { localStorage.setItem(KEY, '1'); } catch (e) { /* приватный режим */ } });
  d.open2 = (k) => { d.dataset.auto = reduce ? '0' : '1'; d.classList.toggle('auto', !reduce); d.showModal(); show(k || 0); };
}
function start() { DK.goPage && DK.goPage('project'); const w = $('#page-project .work'); if (w) w.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
DK.openHow = (k) => { build(); $('#howDlg').open2(k); };

function hero() {
  const h = $('#hero'); if (!h) return;
  h.innerHTML = `<div class="hero-grid" aria-hidden="true"></div><span class="node n1"></span><span class="node n2"></span><span class="node n3"></span><span class="node n4"></span>
    <div class="hero-in"><div class="hero-main"><small class="over">Конструктор дома</small>
      <h1>Спроектируйте свой дом онлайн</h1>
      <p>Планировка, фасад и участок в 3D, проверка ошибок и оценка стоимости строительства — бесплатно. Затем проект от архитекторов платформы и подбор подрядчика.</p>
      <div class="hero-cta"><button class="btn primary big" type="button" id="heroStart">Начать проектировать</button><button class="btn big" type="button" id="heroHow">Как это работает</button></div></div>
      <ol class="hero-steps">${DK.HOW_STEPS.map((s, i) => `<li class="tone-${s.tone}"><button type="button" data-how="${i}"><span class="dot"></span><b>${s.t}</b></button></li>`).join('')}</ol></div>`;
  $('#heroStart').onclick = start;
  $('#heroHow').onclick = () => DK.openHow(0);
  $$('[data-how]', h).forEach(b => b.onclick = () => DK.openHow(+b.dataset.how));
}
DK.howInit = function () {
  hero();
  const hp = $('#howPage'); if (hp) { hp.innerHTML = DK.HOW_STEPS.map(stepHtml).join(''); $$('.how-step', hp).forEach(el => { el.hidden = false; }); }
  $$('[data-act="how"]').forEach(b => b.onclick = (e) => { e.preventDefault(); DK.openHow(0); });
  let seen = false; try { seen = !!localStorage.getItem(KEY); } catch (e) { /* приватный режим */ }
  const q = new URLSearchParams(location.search);
  if (!seen && !q.get('crm') && !q.get('crmp') && !q.get('company') && !location.hash && !window.__PREVIEW_NOHOW) setTimeout(() => DK.openHow(0), 700);
};
})();
