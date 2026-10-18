// Моушн-дизайн так, как его делает Claude Design: модель сама пишет ролик кодом.
//
// Прежний путь — агент заполняет заранее придуманные поля (плашка, таймлайн,
// иконка) — упирался в сами поля: сколько их ни добавляй, ролик выходит
// собранным из одних и тех же кубиков, а человеку приходится вводить десятки
// параметров. Здесь наоборот: человек даёт дизайн-систему и текст, модель
// пишет HTML, CSS и анимацию целиком — карточки, цифры, карты, телефоны,
// списки, свою вёрстку под каждую мысль, — а программа рендерит это кадр за
// кадром. Предпросмотр показывает тот же самый код, поэтому увиденное и
// собранное не расходятся.
//
// Анимация — GSAP: модели знают его лучше любой другой библиотеки, и он умеет
// главное для рендера — перематываться в любой момент без «проигрывания».
// Весь ролик живёт на одной шкале на паузе; программа ставит её на время кадра
// и снимает картинку. Ни часов, ни случайности — кадр в предпросмотре и в
// файле один и тот же.
//
// Принципы движения взяты из доктрины HyperFrames (motion-doctrine, cut-the-curve;
// heygen-com/hyperframes, Apache-2.0): одно направление на весь ролик, склейка
// на ходу, никакого покачивания на месте, пауза перед кульминацией.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let gsapSource = "";
function gsapJs() {
  if (!gsapSource) gsapSource = fs.readFileSync(require.resolve("gsap/dist/gsap.min.js"), "utf-8");
  return gsapSource;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };
const FONT_MIME = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" };

function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || FONT_MIME[ext] || "application/octet-stream";
  return `data:${type};base64,${fs.readFileSync(file).toString("base64")}`;
}

function hash(...parts) {
  const h = crypto.createHash("sha1");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex").slice(0, 16);
}

/** Имя переменной CSS из имени токена дизайн-системы. */
function cssName(name) {
  return String(name || "").replace(/^-+/, "").replace(/[^\w-]+/g, "-").toLowerCase();
}

/**
 * Тема ролика из дизайн-системы: палитра, шрифты, логотипы.
 * Шрифт — файлом: без файла браузер молча подставит запасной, и ролик выйдет
 * не тем шрифтом (см. раздел «Дизайн-система» в README).
 */
function themeFromDesign(design) {
  const colours = (design && design.colours ? design.colours : []).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  const vars = (design && design.vars ? design.vars : []).filter((v) => v && v.name && v.value).slice(0, 80);
  const fontFiles = (design && design.fontFiles) || [];
  const heading = fontFiles.find((f) => /bold|black|heavy|extra|display|head|title|semi/i.test(f.family)) || fontFiles[0] || null;
  const body = fontFiles.find((f) => f !== heading && /regular|book|text|body|medium|normal/i.test(f.family)) || fontFiles.find((f) => f !== heading) || heading;
  return {
    colours,
    vars,
    heading,
    body,
    logos: ((design && design.logoFiles) || []).slice(0, 6),
    description: (design && design.description) || "",
  };
}

/**
 * Полный документ композиции: шрифты и картинки вшиты, GSAP подключён,
 * шкала создана, перемотка и проверки — снаружи через window.__seek и __state.
 *
 * @param {{html:string,width:number,height:number,theme?:object,assets?:Record<string,string>,transparent?:boolean,background?:string,preview?:boolean}} o
 *   assets — имя → путь к файлу (логотипы, фото).
 */
function buildDoc({ html, width, height, theme = null, assets = {}, transparent = false, background = "#000", preview = false }) {
  const t = theme || themeFromDesign(null);
  const fontFaces = [];
  const addFont = (f, family) => {
    if (!f || !f.path) return;
    try {
      // Один файл — на все жирности: иначе браузер «дорисует» жирность сам, и
      // рукописный шрифт пары выйдет размазанным.
      fontFaces.push(`@font-face{font-family:"${family}";src:url("${dataUri(f.path)}");font-weight:100 900;font-display:block}`);
    } catch {
      // нечитаемый файл — останется запасной шрифт
    }
  };
  addFont(t.heading, "DS Heading");
  if (t.body && t.body !== t.heading) addFont(t.body, "DS Body");
  if (t.accent && t.accent !== t.heading) addFont(t.accent, "DS Accent");
  const bodyFamily = t.body && t.body !== t.heading ? '"DS Body"' : t.heading ? '"DS Heading"' : "";
  const vars = [
    `--font-heading:${t.heading ? '"DS Heading",' : ""}"Inter","Segoe UI",Arial,sans-serif`,
    `--font-body:${bodyFamily ? bodyFamily + "," : ""}"Inter","Segoe UI",Arial,sans-serif`,
    ...(t.accent ? [`--font-accent:${t.accent !== t.heading ? '"DS Accent"' : '"DS Heading"'},var(--font-heading)`] : []),
    ...t.colours.map((c, i) => `--c${i + 1}:${c}`),
    ...t.vars.filter((v) => !/url\(|expression/i.test(v.value)).map((v) => `--${cssName(v.name)}:${v.value}`),
  ];

  // Картинки: asset://имя → данные внутри документа. Окно рендера и рамка
  // предпросмотра не обязаны видеть диск человека.
  let body = String(html || "");
  const names = new Set([...body.matchAll(/asset:\/\/([\w.-]+)/g)].map((m) => m[1]));
  for (const name of names) {
    const file = assets[name];
    let uri = "";
    try {
      if (file) uri = dataUri(file);
    } catch {
      uri = "";
    }
    body = body.split(`asset://${name}`).join(uri || "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
  }

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
${fontFaces.join("\n")}
:root{${vars.join(";")}}
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${transparent ? "transparent" : background}}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#stage *{box-sizing:border-box}
/* CSS-анимации и переходы живут по часам, а не по шкале: в рендере они дали бы не тот кадр. */
#stage *,#stage *::before,#stage *::after{animation:none!important;transition:none!important}
</style>
<script>window.__state={errors:[],ready:false};window.addEventListener("error",function(e){window.__state.errors.push(String(e.message||e))});</script>
<script>${gsapJs()}</script>
</head><body><div id="stage">${body.replace(/<script\b[\s\S]*?<\/script>/gi, "")}</div>
<script>
(function(){
  // Вся анимация — на шкале на паузе. Глобальная шкала тоже стоит: даже
  // случайный gsap.to вне tl перематывается вместе со всеми, а не по часам.
  gsap.ticker.lagSmoothing(0);
  gsap.globalTimeline.pause();
  // Иначе дошедшая до конца шкала удаляется из общей, и перемотка назад
  // (предпросмотр, лист кадров) её больше не двигает — кадр застывает.
  gsap.globalTimeline.autoRemoveChildren = false;
  window.__T0 = gsap.globalTimeline.time();
  window.tl = gsap.timeline();
  window.STAGE = { width: ${width}, height: ${height}, el: document.getElementById("stage") };
  Math.random = (function(){ var s = 1234567; return function(){ s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; })();
})();
</script>
<script>window.__run = [];</script>
${[...String(html || "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `<script>window.__run.push(function(){try{${m[1]}\n}catch(e){window.__state.errors.push("Скрипт: "+(e&&e.message||e))}});</script>`).join("\n")}
<script>
(function(){
  window.__duration = function(){ return Math.max(0, (window.DURATION || 0), tl.duration()); };
  window.__seek = function(t){ gsap.globalTimeline.seek(window.__T0 + Math.max(0, t), false); };
  // Код композиции запускается, когда шрифты и картинки уже на месте: иначе
  // замеры текста (подгонка под ширину, позиция под строкой) считаются по
  // запасному шрифту, и в кадре всё съезжает.
  window.__want = 0;
  var imgs = Array.prototype.slice.call(document.images).map(function(img){ return img.complete ? Promise.resolve() : new Promise(function(r){ img.onload = img.onerror = r; }); });
  Promise.all([document.fonts.ready].concat(imgs)).then(function(){
    for (var i = 0; i < window.__run.length; i++) window.__run[i]();
    window.__seek(window.__want);
    window.__state.ready = true;
  });
  // Проверка вёрстки: текст за краем кадра и слишком мелкий текст — то, что
  // модель не видит, пока пишет код, а человек замечает сразу.
  window.__audit = function(t){
    var st = document.getElementById("stage").getBoundingClientRect();
    var pad = 4;
    var collect = function(){
      var list = [];
      var els = document.querySelectorAll("#stage *");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.childNodes.length) continue;
        var hasText = false;
        for (var k = 0; k < el.childNodes.length; k++) { var n = el.childNodes[k]; if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; } }
        if (!hasText) continue;
        var op = 1, p = el;
        while (p && p !== document.body) { var cs0 = getComputedStyle(p); var o = parseFloat(cs0.opacity); if (!isNaN(o)) op *= o; if (cs0.visibility === "hidden" || cs0.display === "none") op = 0; p = p.parentElement; }
        if (op < 0.5) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        list.push({ el: el, r: r });
      }
      return list;
    };
    window.__seek(t);
    var now = collect();
    // Элемент в движении (уезжает на склейке, прилетает) не проверяем: за
    // краем он законно. Сравниваем с положением через долю секунды.
    window.__seek(t + 0.2);
    var later = new Map(collect().map(function(x){ return [x.el, x.r]; }));
    window.__seek(t);
    var out = [];
    for (var j = 0; j < now.length; j++) {
      var el = now[j].el, r = now[j].r, r2 = later.get(el);
      if (!r2 || Math.abs(r2.left - r.left) + Math.abs(r2.top - r.top) + Math.abs(r2.width - r.width) > 2) continue;
      var txt = el.textContent.trim().slice(0, 40);
      if (r.left < st.left - pad || r.right > st.right + pad || r.top < st.top - pad || r.bottom > st.bottom + pad) out.push({ kind: "edge", text: txt, t: t });
      var fs = parseFloat(getComputedStyle(el).fontSize) * (r.height / Math.max(1, el.offsetHeight || r.height));
      if (fs && fs < ${Math.round(Math.min(width, height) * 0.024)}) out.push({ kind: "small", text: txt, t: t, size: Math.round(fs) });
    }
    return out;
  };
  ${preview ? `window.addEventListener("message", function(e){ var d = e.data || {}; if (typeof d.seek === "number") { window.__want = d.seek; if (window.__state.ready) window.__seek(d.seek); } });` : ""}
})();
</script>
</body></html>`;
}

/** Код композиции из ответа модели: блок ```html … ``` или всё после «===КОД===». */
function extractCode(text) {
  const src = String(text || "");
  const fence = [...src.matchAll(/```(?:html)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  if (fence.length) return fence.sort((a, b) => b.length - a.length)[0].trim();
  // Модель упёрлась в предел длины и не закрыла блок — берём то, что есть.
  const open = src.search(/```(?:html)?\s*\n/i);
  if (open >= 0) return src.slice(open).replace(/^```(?:html)?\s*\n/i, "").trim();
  if (/<(div|section|style|svg)\b/i.test(src)) return src.slice(src.search(/<(div|section|style|svg)\b/i)).trim();
  return "";
}

/** Раскадровка — строки до блока кода: показываются человеку как план ролика. */
function extractStoryboard(text) {
  const src = String(text || "");
  const before = src.split(/```/)[0];
  return before
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.)]|[-•—]|сцена|слайд)/i.test(l))
    .slice(0, 30);
}

const DOCTRINE = `ПРИНЦИПЫ ДВИЖЕНИЯ (обязательны — без них ролик выглядит как стопка слайдов)
1. Одно направление на весь ролик (по умолчанию — влево): сцена уходит влево, следующая приходит справа, продолжая то же движение. Не меняй направление туда-обратно.
2. Склейка на ходу: уход ускоряется (power4.in, ~0.4–0.5 с), приход начинается уже в движении и тормозит (power4.out, та же длина). Никогда не начинай сцену с полной остановки и не замирай перед склейкой.
3. Особые векторы — со смыслом: вверх — вывод/кульминация; приближение (scale растёт, «пролёт сквозь») — углубление в мысль; отдаление — «прилетело что-то большое». Знак масштаба на уходе и приходе одинаков.
4. Внутри сцены — поэтапные появления: элементы прилетают каскадом (stagger 0.05–0.12 с, общий разброс ≤ 0.5 с), заголовок по словам или строкам снизу с маской (overflow:hidden у строки), карточки — back.out(1.5), цифры считаются (tween числа с onUpdate → textContent с форматированием по-русски).
5. Сцена живёт до самого ухода: после появления — продолжай рассказывать (подсветка шагов, растущий график, движение «камеры» по деталям, новые строки). Запрещены покачивания и «дыхание» на месте (sine-петли, пульсация без причины).
6. Перед главной цифрой или выводом — пауза 0.3–0.7 с.
7. Одно появление ≤ 0.8 с; уход ≈ 75% появления. Запрещены bounce и elastic.`;

const DESIGN_RULES = `УРОВЕНЬ ДИЗАЙНА — как у Claude Design и топовых моушн-студий
- Каждая мысль — своя вёрстка, а не одна плашка с текстом: UI-карточки с иконками, крупные цифры с подписью, список шагов с прогрессом, прайс/таблица строками, карта с точками и расстояниями, телефон с интерфейсом, сравнение «было/стало», цитата, код, QR/контакты, фото в карточке со скруглением. Выбирай форму по смыслу текста.
- Типографика: заголовки крупные и плотные (на холсте 1080 ширины — 84–150 px, межстрочный 0.95–1.05, жирность из шрифта дизайн-системы), основной текст 38–56 px, подписи 26–32 px капсом с разрядкой. Не больше 2 шрифтов (var(--font-heading), var(--font-body)).
- Сетка и поля: поля по краям ≥ 7% ширины; в вертикальном 9:16 держи важное в средней зоне (верхние 10% и нижние 18% перекрывает интерфейс соцсетей). Выравнивание по одной линии внутри сцены.
- Цвет: строго палитра дизайн-системы. Один акцент на сцену. Фон — из палитры (тёмный или светлый — как в дизайн-системе), можно мягкий градиент/сетка/шум из её же цветов.
- Глубина: тени, стекло (backdrop-filter: blur) и обводки — сдержанно, как в продуктовом UI.
- Иконки — аккуратные inline SVG (stroke 2–2.5, скругления), в стиле одной линейки.
- Логотип: крупно в первой и последней сцене, в остальных — небольшой в углу (если логотип дан). Не искажай пропорции (height фиксированная, width:auto).
- Текст пиши сам из исходного материала: заголовок 2–7 слов, цифры и факты — только из текста. Нет в тексте цены, телефона или адреса — не выдумывай. Если в тексте есть контакты — финальная сцена с призывом и контактами.
- Ритм: сцена 2.5–4.5 с; первая сцена — хук за 1.5–2 с; финал держится 2–3 с.`;

function contract({ width, height, duration, transparent }) {
  return `ТЕХНИЧЕСКИЙ КОНТРАКТ (программа рендерит твой код покадрово — нарушение = сломанный ролик)
- Ответ: сначала коротко раскадровка (по строке на сцену: «1. …»), затем РОВНО ОДИН блок \`\`\`html … \`\`\` с <style>…</style>, разметкой и <script>…</script>. Без <html>, <head>, <body> — их добавит программа.
- Твоя разметка вставляется внутрь #stage размером ${width}×${height} px. Позиционируй абсолютно (px или %), каждую сцену — отдельным абсолютным контейнером на весь кадр.
- Анимация — только GSAP 3 (объект gsap уже подключён) и только в готовую шкалу \`tl\` (не создавай свою, не вызывай tl.play()). Позиции на шкале задавай явно: tl.to(sel, {...}, 3.2) или метками. Программа сама перематывает шкалу покадрово.
- ЗАПРЕЩЕНО: CSS-анимации и transition, setTimeout/setInterval/requestAnimationFrame, Date, видео, внешние ссылки (шрифты, картинки, скрипты из интернета), плагины GSAP (SplitText и т.п.). Разбивку текста на слова делай сам: оберни слова в <span> в разметке.
- Начальное состояние: всё, что появляется позже, скрыто с самого начала (opacity:0 в CSS или tl.set(…, {autoAlpha:0}, 0)). На кадре 0 — только первая сцена.
- Длительность: ~${duration} с. Окончание ролика = конец шкалы; финальную паузу задай tl.to({}, {duration: 1.5}).
- Шрифты: font-family: var(--font-heading) и var(--font-body) — файлы шрифтов дизайн-системы уже подключены. Цвета — var(--c1)…, переменные дизайн-системы (список ниже) или hex из палитры.
- Картинки: <img src="asset://ИМЯ"> — только имена из списка ниже.
- ${transparent ? "Фон ПРОЗРАЧНЫЙ: это титр поверх видео. Не заливай кадр фоном — только сами элементы титра; читаемость обеспечь плашками и тенью." : "Фон рисуешь сам — первым слоем на весь кадр (цвет или градиент из палитры)."}`;
}

function designBlock(theme, assets) {
  const lines = [];
  if (theme.colours.length) lines.push(`Палитра (переменные): ${theme.colours.map((c, i) => `--c${i + 1}: ${c}`).join(", ")}`);
  if (theme.vars.length) lines.push(`Переменные дизайн-системы: ${theme.vars.slice(0, 50).map((v) => `--${cssName(v.name)}: ${v.value}`).join("; ")}`);
  lines.push(`Шрифты: заголовки — ${theme.heading ? theme.heading.family : "системный гротеск"}, текст — ${theme.body ? theme.body.family : "системный гротеск"}.`);
  if (theme.accent) lines.push(`Акцентный шрифт пары — ${theme.accent.family} (var(--font-accent)): им набирай одно-два ключевых слова в заголовке (рукописный/курсивный контраст к основному), строчными, крупнее основного на 10–30%. Основной шрифт — плотный, часто заглавными.`);
  if (theme.description) lines.push(`Описание системы:\n${theme.description.slice(0, 4000)}`);
  const list = Object.entries(assets);
  lines.push(list.length ? `Картинки (asset://имя):\n${list.map(([name, a]) => `- ${name}: ${a.label}${a.size ? `, ${a.size}` : ""}`).join("\n")}` : "Картинок нет — обходись вёрсткой, иконками и типографикой.");
  return lines.join("\n");
}

/**
 * Задание на моушн-ролик.
 * @param {{width:number,height:number,duration:number,text:string,brief?:string,theme:object,assets:Record<string,{label:string,size?:string}>,transparent?:boolean}} o
 */
function buildMotionPrompt(o) {
  return [
    `Ты — моушн-дизайнер уровня топовой студии и одновременно фронтенд-разработчик. Сделай ${o.transparent ? "анимированный титр поверх видео" : "законченный моушн-ролик"} ${o.width}×${o.height} по дизайн-системе и материалу ниже. Ролик должен выглядеть дорого и продуманно: как сделанный вручную в After Effects по брендбуку.`,
    DESIGN_RULES,
    DOCTRINE,
    contract(o),
    `ДИЗАЙН-СИСТЕМА — закон, а не пожелание\n${designBlock(o.theme, o.assets)}`,
    o.brief ? `ЗАДАЧА ОТ ЧЕЛОВЕКА\n${o.brief}` : "",
    o.text ? `МАТЕРИАЛ (из него ты сам пишешь текст сцен — коротко и по делу)\n${o.text.slice(0, 24000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRepairPrompt(problems) {
  return `Программа запустила твой код и нашла проблемы:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nИсправь их и верни код ЦЕЛИКОМ тем же форматом (один блок \`\`\`html). Дизайн и раскадровку не меняй, кроме того, что нужно для исправления.`;
}

function buildReviewPrompt() {
  return `Вот кадры твоего ролика (подпись — секунда). Посмотри на них как арт-директор: текст за краем или обрезан, элементы налезают друг на друга, нечитаемо (мелко, низкий контраст), пустые или «мёртвые» кадры, логотип искажён или не на месте, цвета вне палитры, сцены похожи друг на друга как слайды.\nЕсли всё хорошо — ответь «ОК». Если есть что улучшить — верни исправленный код ЦЕЛИКОМ (один блок \`\`\`html), сохранив идею.`;
}

function buildEditPrompt(instruction) {
  return `Правка от человека: ${instruction}\n\nВерни исправленный код ЦЕЛИКОМ тем же форматом (один блок \`\`\`html). Всё, о чём не просили, оставь как было.`;
}

/** Описание проблем проверки для повторного запроса модели. */
function describeAudit(state) {
  const out = [];
  for (const e of state.errors || []) out.push(`Ошибка JavaScript: ${e}`);
  if (!state.duration || state.duration < 0.5) out.push("Шкала tl пустая — анимация не добавлена в tl.");
  const edge = (state.audit || []).filter((a) => a.kind === "edge");
  const small = (state.audit || []).filter((a) => a.kind === "small");
  const uniq = (list) => [...new Map(list.map((a) => [a.text, a])).values()].slice(0, 8);
  for (const a of uniq(edge)) out.push(`Текст за краем кадра на ${a.t.toFixed(1)} с: «${a.text}» — уменьши, перенеси строку или сдвинь.`);
  for (const a of uniq(small)) out.push(`Слишком мелкий текст (${a.size}px) на ${a.t.toFixed(1)} с: «${a.text}».`);
  return out;
}

module.exports = {
  gsapJs,
  hash,
  themeFromDesign,
  buildDoc,
  extractCode,
  extractStoryboard,
  buildMotionPrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  buildEditPrompt,
  describeAudit,
  DOCTRINE,
  DESIGN_RULES,
};
