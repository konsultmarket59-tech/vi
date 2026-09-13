// Сайты: сборка лендинга или многостраничника из материалов на компьютере —
// в виде блоков, готовых к переносу в Тильду.
//
// Что здесь важно понимать с самого начала.
//
// 1. API ТИЛЬДЫ РАБОТАЕТ ТОЛЬКО НА ЧТЕНИЕ. В документации семь методов, и все
//    начинаются с get: список проектов, сведения о проекте, список страниц,
//    страница в четырёх видах. Метода, который создаёт или меняет страницу, не
//    существует. Значит, «залить сайт на Тильду по API» невозможно — и делать
//    вид, что возможно, нельзя: человек потратит день на настройку ключей ради
//    кнопки, которой неоткуда взяться. Готовый сайт переносится руками, а API
//    служит другому: посмотреть, что уже есть в проекте, и сверить оформление.
//
// 2. БЛОК ДОЛЖЕН БЫТЬ САМОДОСТАТОЧНЫМ. В Тильде произвольная вёрстка живёт в
//    блоке «HTML-код» (T123). Всё, что туда попадёт, окажется на одной странице
//    с чужими блоками. Поэтому стили блока обязаны быть ограничены им самим:
//    незакрытое правило вроде «h2 { … }» переформатирует всю страницу, включая
//    блоки, которые человек не трогал. Ограничение делается механически —
//    scopeCss() ниже, — а не «на совесть автора».
//
// 3. ФОРМЫ ВЁРСТАЮТСЯ, НО ПОМЕЧАЮТСЯ. Приём заявок в Тильде висит на её
//    собственных блоках формы, и свёрстанная здесь форма сама по себе заявки не
//    отправит. Но задача раздела — прототип с готовым дизайном, а
//    переподключение формы делает ИИ Тильды по этому же коду. Поэтому форма
//    рисуется целиком, а рядом ставится пометка ТИЛЬДА-ФОРМА с заданием: что
//    подключить, сохранив оформление. Так на руках и вид, и инструкция. Форма
//    без такой пометки — повод для замечания: неподключённая форма выглядит
//    рабочей и молча теряет заявки.
//
// 4. ЛИМИТ 150 ЗАПРОСОВ В ЧАС — не рекомендация. В документации сказано прямо:
//    за нагрузку аккаунт блокируют и API отключают. Счётчик ниже держит
//    скользящее окно и отказывает сам, не доводя до сервера Тильды.

const fs = require("node:fs/promises");
const path = require("node:path");

const TILDA_API = "https://api.tildacdn.info";

/** Лимит из документации Тильды: 150 запросов в час на аккаунт. */
const RATE_LIMIT = 150;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Что за материалы человек кладёт в папки и как мы их понимаем. */
const SOURCE_KINDS = [
  { id: "text", label: "Текст и материалы", hint: "О чём сайт: тексты, брифы, прайсы, описания" },
  { id: "images", label: "Изображения", hint: "Фотографии и картинки для страниц" },
  { id: "references", label: "Референсы", hint: "Скриншоты и ссылки на то, как должно выглядеть" },
  { id: "design", label: "Дизайн-система", hint: "Цвета, шрифты, компоненты — из Figma, Pixso или Claude Design" },
  { id: "logos", label: "Логотипы", hint: "Варианты логотипа под разные фоны и размеры" },
];

const TEXT_EXT = [".txt", ".md", ".rtf", ".doc", ".docx", ".pdf", ".csv", ".json", ".html", ".htm"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"];

function ext(file) {
  return path.extname(file).toLowerCase();
}

function isText(file) {
  return TEXT_EXT.includes(ext(file));
}

function isImage(file) {
  return IMAGE_EXT.includes(ext(file));
}

function str(v) {
  return v == null ? "" : String(v).trim();
}

// ---------- материалы с компьютера ----------

/**
 * Обход папки с материалами.
 *
 * Ограничения на глубину и число файлов — не перестраховка: в папку с
 * картинками легко попадает экспорт из Figma на несколько тысяч файлов, и без
 * потолка раздел встаёт на обходе ещё до того, как покажет хоть что-то.
 */
async function scanFolder(dir, { maxDepth = 4, maxFiles = 600 } = {}) {
  const found = [];
  async function walk(current, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      // Папку могли переименовать или отключить диск — об этом скажет вызывающий.
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!isText(entry.name) && !isImage(entry.name)) continue;
      let size = 0;
      try {
        size = (await fs.stat(full)).size;
      } catch {
        continue;
      }
      found.push({
        path: full,
        name: entry.name,
        kind: isImage(entry.name) ? "image" : "text",
        size,
        folder: path.relative(dir, path.dirname(full)),
      });
    }
  }
  await walk(dir, 0);
  return found;
}

/**
 * Собирает все указанные папки в одну опись.
 *
 * Возвращает и замечания: пустая или недоступная папка должна быть названа, а
 * не тихо дать пустой список — иначе сайт соберётся без половины материалов, и
 * понять почему будет неоткуда.
 */
async function collectSources(sources = {}) {
  const result = {};
  const problems = [];
  for (const kind of SOURCE_KINDS) {
    const dir = str(sources[kind.id]);
    result[kind.id] = [];
    if (!dir) continue;
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) {
        problems.push(`«${kind.label}»: указан файл, а нужна папка — ${dir}`);
        continue;
      }
    } catch {
      problems.push(`«${kind.label}»: папка не открывается — ${dir}`);
      continue;
    }
    const files = await scanFolder(dir);
    result[kind.id] = files;
    if (!files.length) problems.push(`«${kind.label}»: в папке нет подходящих файлов — ${dir}`);
  }
  return { files: result, problems };
}

// ---------- ограничение частоты запросов к Тильде ----------

/**
 * Скользящее окно на час.
 *
 * Считаем сами и отказываем до обращения к серверу. В документации Тильды
 * сказано прямо: за нагрузку аккаунт блокируют, а API отключают, — цена ошибки
 * здесь не «повторите позже», а неработающий сайт.
 */
function createLimiter(limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS) {
  const hits = [];
  return {
    /** Сколько запросов ещё можно сделать прямо сейчас. */
    left(now = Date.now()) {
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      return Math.max(0, limit - hits.length);
    },
    /** Когда освободится место, если сейчас его нет. */
    nextFreeAt(now = Date.now()) {
      while (hits.length && now - hits[0] > windowMs) hits.shift();
      return hits.length ? hits[0] + windowMs : now;
    },
    take(now = Date.now()) {
      if (this.left(now) <= 0) {
        const mins = Math.ceil((this.nextFreeAt(now) - now) / 60000);
        throw new Error(
          `Исчерпан лимит Тильды: ${limit} запросов в час. ` +
            `Следующий можно сделать примерно через ${mins} мин. ` +
            "Лимит стоит на стороне Тильды, обойти его нельзя."
        );
      }
      hits.push(now);
      return true;
    },
    /** Для восстановления счётчика после перезапуска приложения. */
    load(list = []) {
      hits.length = 0;
      for (const t of list) if (typeof t === "number") hits.push(t);
    },
    saved() {
      return hits.slice();
    },
  };
}

// ---------- API Тильды (только чтение) ----------

/**
 * Методы, которые есть у Тильды. Список закрытый: чего здесь нет, того нет и в
 * документации, и придумывать это нельзя.
 */
const TILDA_METHODS = {
  projects: { path: "/v1/getprojectslist/", needs: [] },
  project: { path: "/v1/getprojectinfo/", needs: ["projectid"] },
  pages: { path: "/v1/getpageslist/", needs: ["projectid"] },
  page: { path: "/v1/getpage/", needs: ["pageid"] },
  pageFull: { path: "/v1/getpagefull/", needs: ["pageid"] },
  pageExport: { path: "/v1/getpageexport/", needs: ["pageid"] },
  pageFullExport: { path: "/v1/getpagefullexport/", needs: ["pageid"] },
};

/**
 * Запрос к API Тильды.
 *
 * Ключи уходят строкой запроса — так устроено у Тильды, выбора нет. Поэтому в
 * сообщениях об ошибке адрес обрезается до метода: иначе секретный ключ
 * оказывается в тексте ошибки, а оттуда — в отчёте о проблеме.
 */
async function tildaCall(method, params = {}, { limiter, fetchImpl = fetch } = {}) {
  const spec = TILDA_METHODS[method];
  if (!spec) throw new Error(`Неизвестный метод Тильды: ${method}`);
  const publickey = str(params.publickey);
  const secretkey = str(params.secretkey);
  if (!publickey || !secretkey) {
    throw new Error("Не заданы ключи Тильды. Настройки сайта → Экспорт → API, тариф Business.");
  }
  for (const need of spec.needs) {
    if (!str(params[need])) throw new Error(`Для этого запроса нужен ${need}.`);
  }

  if (limiter) limiter.take();

  const query = new URLSearchParams({ publickey, secretkey });
  for (const need of spec.needs) query.set(need, str(params[need]));
  if (params.webconfig) query.set("webconfig", str(params.webconfig));

  let res;
  try {
    res = await fetchImpl(`${TILDA_API}${spec.path}?${query.toString()}`);
  } catch (e) {
    throw new Error(`Тильда недоступна (${spec.path}): ${e.message}`);
  }
  if (!res.ok) throw new Error(`Тильда ответила ${res.status} на ${spec.path}`);

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Тильда вернула не JSON на ${spec.path}`);
  }
  if (data.status !== "FOUND") {
    // В ответе с ошибкой Тильда кладёт пояснение в разные поля — берём, что есть.
    const why = str(data.message) || str(data.error) || JSON.stringify(data).slice(0, 200);
    throw new Error(`Тильда отказала на ${spec.path}: ${why}`);
  }
  return data.result;
}

// ---------- блоки под Тильду ----------

/**
 * Ограничение стилей блока им самим.
 *
 * Блок попадает на страницу к чужим блокам. Правило «h2 { color: red }» без
 * ограничения перекрасит заголовки во всех остальных блоках страницы — человек
 * будет искать причину в блоках, которых не касался. Поэтому каждый селектор
 * получает приставку с классом самого блока.
 *
 * Разбор устроен просто и намеренно: полноценный парсер CSS здесь не нужен,
 * нужна предсказуемость. Вложенные правила (@media, @supports) обрабатываются
 * рекурсивно, а правила вроде @keyframes и @font-face внутри не трогаются —
 * у них не селекторы, а имена шагов.
 */
const AT_RULES_WITH_SELECTORS = /^@(?:media|supports|layer|container)\b/i;
const AT_RULES_VERBATIM = /^@(?:keyframes|-webkit-keyframes|font-face|import|charset|namespace|counter-style|property)\b/i;

function scopeCss(css, scope) {
  const source = String(css || "");
  const out = [];
  let i = 0;

  function readBlock(start) {
    // Возвращает индекс закрывающей скобки, парной открывающей на start.
    let depth = 0;
    for (let j = start; j < source.length; j++) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") {
        depth -= 1;
        if (depth === 0) return j;
      }
    }
    return source.length - 1;
  }

  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open === -1) break;
    const head = source.slice(i, open).trim();
    const close = readBlock(open);
    const body = source.slice(open + 1, close);

    if (AT_RULES_VERBATIM.test(head)) {
      out.push(`${head}{${body}}`);
    } else if (AT_RULES_WITH_SELECTORS.test(head)) {
      out.push(`${head}{${scopeCss(body, scope)}}`);
    } else if (head) {
      const scoped = head
        .split(",")
        .map((sel) => {
          const s = sel.trim();
          if (!s) return "";
          // Корневые селекторы внутри блока смысла не имеют: переносим их на сам блок.
          if (/^(?::root|html|body)\b/i.test(s)) return `${scope}${s.replace(/^(?::root|html|body)/i, "")}`.trim();
          if (s.startsWith(scope)) return s;
          return `${scope} ${s}`;
        })
        .filter(Boolean)
        .join(", ");
      out.push(`${scoped}{${body}}`);
    }
    i = close + 1;
  }
  return out.join("\n");
}

/** Имя класса-обёртки блока: оно же и есть ограничитель стилей. */
function blockScope(id) {
  return `.dyn-${String(id || "block").replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/**
 * Собирает блок в тот вид, в котором его вставляют в блок «HTML-код» Тильды.
 *
 * Скрипт блока заворачивается в собственную область видимости: на странице
 * Тильды таких блоков может быть несколько, и объявленная на верхнем уровне
 * переменная во втором блоке уронит первый.
 */
function buildBlockHtml(block) {
  const scope = blockScope(block.id);
  const cls = scope.slice(1);
  const css = scopeCss(block.css || "", scope);
  const js = str(block.js);
  const parts = [];
  if (css) parts.push(`<style>\n${css}\n</style>`);
  parts.push(`<div class="${cls}">\n${str(block.html)}\n</div>`);
  if (js) {
    parts.push(
      `<script>\n(function(){\n  var root = document.currentScript.parentNode.querySelector(".${cls}");\n${js}\n})();\n</script>`
    );
  }
  return parts.join("\n");
}

/**
 * Проверка блока перед тем, как человек понесёт его в Тильду.
 *
 * Всё, что здесь ловится, — это то, что в Тильде проявится не сразу: сайт
 * соберётся, блок вставится, а поломается соседний блок или потеряются заявки.
 */
function checkBlock(block) {
  const problems = [];
  const html = str(block.html);
  if (!html) problems.push("Блок пустой.");
  if (/<\/?(?:html|head|body)\b/i.test(html)) {
    problems.push("В блоке есть теги html/head/body — в блок «HTML-код» вставляется только содержимое.");
  }
  if (/<style\b/i.test(html) || /<script\b/i.test(html)) {
    problems.push("Стили и скрипт передаются отдельными полями, а не внутри html — иначе они не будут ограничены блоком.");
  }
  // Форма — не ошибка, а то, что предстоит доподключить в Тильде. Молчать о ней
  // нельзя: неподключённая форма выглядит рабочей и молча теряет заявки.
  if (/<form\b/i.test(html) && !/ТИЛЬДА-ФОРМА/i.test(html)) {
    problems.push(
      "Форма без пометки ТИЛЬДА-ФОРМА. Поставьте рядом комментарий с заданием для ИИ Тильды: " +
        "пока форму не переподключат к приёмникам Тильды, заявки из неё никуда не уйдут."
    );
  }
  // Ссылки на файлы с компьютера на сайте превращаются в пустое место.
  const local = html.match(/(?:src|href)\s*=\s*["'](?:file:\/\/|[A-Za-z]:\\|\/Users\/|\/home\/)[^"']*/i);
  if (local) problems.push(`Ссылка на файл с компьютера — на сайте она не откроется: ${local[0].slice(0, 80)}`);
  return problems;
}

/** Все замечания по сайту разом — блоки плюс общие. */
function checkSite(site) {
  const problems = [];
  const seen = new Set();
  for (const block of site.blocks || []) {
    for (const p of checkBlock(block)) problems.push(`«${block.title || block.id}»: ${p}`);
    if (seen.has(block.id)) problems.push(`Два блока с одинаковым номером «${block.id}» — стили одного попадут на другой.`);
    seen.add(block.id);
  }
  return problems;
}

// ---------- дизайн-система ----------
//
// «Сделай в нашем стиле» без опоры превращается в «сделай красиво по-своему».
// Поэтому из материалов дизайн-системы вытаскиваются конкретные значения —
// цвета и шрифты, — и уходят агенту как ограничение, а не как пожелание.

/** Цвета из любого текста дизайн-системы: hex, rgb и переменные CSS. */
function extractTokens(text) {
  const body = String(text || "");
  const colours = [];
  const seen = new Set();
  for (const m of body.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]{5,40}\)/g)) {
    const value = m[0].toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    colours.push(value);
  }
  const fonts = [];
  for (const m of body.matchAll(/font-family\s*:\s*([^;{}\n]+)/gi)) {
    const value = m[1].trim().replace(/["']/g, "");
    if (value && !fonts.includes(value)) fonts.push(value);
  }
  // Именованные переменные — самое ценное: у них есть смысл, а не только значение.
  const vars = [];
  for (const m of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}\n]+)/g)) {
    const name = m[1];
    if (!vars.some((v) => v.name === name)) vars.push({ name, value: m[2].trim() });
  }
  return { colours: colours.slice(0, 24), fonts: fonts.slice(0, 8), vars: vars.slice(0, 40) };
}

/** Словесное описание дизайн-системы для задания агенту. */
function describeTokens(tokens) {
  if (!tokens) return "";
  const parts = [];
  if (tokens.vars.length) {
    parts.push("Переменные дизайн-системы (используй именно их):\n" + tokens.vars.map((v) => `  ${v.name}: ${v.value}`).join("\n"));
  }
  if (tokens.colours.length) parts.push("Цвета: " + tokens.colours.join(", "));
  if (tokens.fonts.length) parts.push("Шрифты: " + tokens.fonts.join(" · "));
  return parts.join("\n");
}

// ---------- стоковые изображения ----------
//
// Прототип без картинок оценить нельзя: пустые прямоугольники не показывают ни
// ритма, ни плотности, ни того, как читается заголовок поверх фотографии.
// Поэтому агент не вставляет картинки сам, а ставит метку с описанием нужного
// кадра, а приложение подставляет настоящий адрес со стока. Заменить снимок в
// Тильде потом — минутное дело, а собрать впечатление от макета без него нельзя.

/** Метка, которую агент ставит вместо картинки. */
const PHOTO_MARK = /\[ФОТО:\s*([^\]]+)\]/g;

/** Поиск фотографий на Pexels. Ключ тот же, что у видео-стока. */
async function searchPhotos(query, apiKey, { orientation = "landscape", fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("Не задан ключ Pexels — без него сток недоступен.");
  const url =
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}` +
    `&orientation=${orientation}&per_page=5`;
  const res = await fetchImpl(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Сток ответил ${res.status}`);
  const json = await res.json();
  return (json.photos || []).map((ph) => ({
    id: String(ph.id),
    url: ph.src?.large2x || ph.src?.large || ph.src?.original || "",
    thumb: ph.src?.medium || "",
    author: ph.photographer || "",
    page: ph.url || "",
    alt: ph.alt || "",
  }));
}

/** Все метки фотографий в блоках — по одной записи на уникальное описание. */
function collectPhotoMarks(blocks = []) {
  const wanted = new Map();
  for (const block of blocks) {
    for (const source of [block.html, block.css]) {
      for (const m of String(source || "").matchAll(PHOTO_MARK)) {
        const query = m[1].trim();
        if (!wanted.has(query)) wanted.set(query, []);
        if (!wanted.get(query).includes(block.id)) wanted.get(query).push(block.id);
      }
    }
  }
  return [...wanted.entries()].map(([query, blockIds]) => ({ query, blockIds }));
}

/**
 * Подставляет в блоки настоящие адреса со стока.
 *
 * Невыполненные метки остаются как есть и попадают в замечания: тихо оставить
 * пустое место хуже, чем показать, что кадр не нашёлся.
 */
function applyPhotos(blocks = [], byQuery = {}) {
  const missing = new Set();
  const used = [];
  const swap = (text) =>
    String(text || "").replace(PHOTO_MARK, (whole, q) => {
      const found = byQuery[q.trim()];
      if (!found || !found.url) {
        missing.add(q.trim());
        return whole;
      }
      if (!used.some((u) => u.url === found.url)) used.push({ ...found, query: q.trim() });
      return found.url;
    });
  const next = blocks.map((b) => ({ ...b, html: swap(b.html), css: swap(b.css) }));
  return { blocks: next, missing: [...missing], used };
}

// ---------- логотип ----------
//
// Логотип агент видит, но вставить не может: файл лежит на компьютере, а путь
// с компьютера на сайте превращается в пустое место. Поэтому он ставит метку, а
// приложение подставляет сам файл строкой данных — такая картинка работает и в
// просмотре, и в Тильде, и не зависит от того, загрузили её куда-то или нет.

const LOGO_MARK = /\[ЛОГОТИП(?::\s*([^\]]+))?\]/g;

/** Метки логотипа в блоках: с уточнением, какой именно вариант нужен. */
function collectLogoMarks(blocks = []) {
  const wanted = new Map();
  for (const block of blocks) {
    for (const source of [block.html, block.css]) {
      for (const m of String(source || "").matchAll(LOGO_MARK)) {
        const hint = (m[1] || "").trim();
        if (!wanted.has(hint)) wanted.set(hint, []);
        if (!wanted.get(hint).includes(block.id)) wanted.get(hint).push(block.id);
      }
    }
  }
  return [...wanted.entries()].map(([hint, blockIds]) => ({ hint, blockIds }));
}

/**
 * Выбирает файл логотипа по уточнению из метки.
 *
 * Уточнение — слова вроде «белый», «на тёмном», «знак». Совпадение ищется по
 * имени файла: варианты логотипов почти всегда так и называются.
 */
function pickLogo(files = [], hint = "") {
  const images = files.filter((f) => f.kind === "image");
  if (!images.length) return null;
  const words = String(hint || "").toLowerCase().split(/[\s,._-]+/).filter((w) => w.length > 2);
  if (words.length) {
    const scored = images
      .map((f) => ({ f, score: words.filter((w) => f.name.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score);
    if (scored[0].score > 0) return scored[0].f;
  }
  return images[0];
}

/** Подставляет в блоки готовые строки данных вместо меток логотипа. */
function applyLogos(blocks = [], byHint = {}) {
  const missing = new Set();
  const swap = (text) =>
    String(text || "").replace(LOGO_MARK, (whole, hint) => {
      const key = (hint || "").trim();
      const found = byHint[key];
      if (!found) {
        missing.add(key || "без уточнения");
        return whole;
      }
      return found;
    });
  return { blocks: blocks.map((b) => ({ ...b, html: swap(b.html), css: swap(b.css) })), missing: [...missing] };
}

// ---------- разбор ответа агента ----------

/**
 * Агент отдаёт сайт размеченным текстом, а не JSON.
 *
 * JSON здесь хуже: в блоках много HTML с кавычками и переводами строк, и на
 * экранировании модель ошибается тем чаще, чем длиннее блок. Разметка же
 * восстанавливается даже из частично испорченного ответа.
 */
/**
 * Снимает ограду markdown вокруг кода.
 *
 * Модель почти всегда оборачивает разметку в ```html … ```, и без снятия ограда
 * попадает внутрь блока. Последствия несоразмерны причине: CSS, начинающийся с
 * ```css, для браузера недействителен целиком — блок остаётся вообще без
 * стилей, а в просмотре видно текст ограды вместо страницы. Со стороны это
 * выглядит как «модель плохо рисует», хотя рисует она нормально.
 */
function stripFence(text) {
  let body = String(text || "").trim();
  // Ограда может стоять несколько раз подряд, если модель разбила кусок.
  for (let i = 0; i < 3; i++) {
    const m = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(body);
    if (!m) break;
    body = m[1].trim();
  }
  // Осталась одиночная ограда без пары — тоже убираем, иначе она видна на сайте.
  body = body.replace(/^```[a-zA-Z0-9_-]*\s*$/gm, "").trim();
  return body;
}

function parseSite(reply) {
  const text = String(reply || "");
  const site = { plan: "", pages: [], blocks: [], forms: [], notes: [] };

  const planMatch = /===\s*ПЛАН\s*===\s*([\s\S]*?)(?====\s*[А-ЯA-Z]|$)/.exec(text);
  if (planMatch) site.plan = planMatch[1].trim();

  const blockRe = /===\s*БЛОК\s+([^\s=]+)\s*===\s*([\s\S]*?)(?====\s*(?:БЛОК|ФОРМА|ПЛАН|ЗАМЕТКИ)\s|$)/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const id = m[1].trim();
    const body = m[2];
    const field = (name) => {
      const re = new RegExp(`---\\s*${name}\\s*---\\s*([\\s\\S]*?)(?=---\\s*[А-ЯA-Z]|$)`, "i");
      const found = re.exec(body);
      return found ? stripFence(found[1]) : "";
    };
    site.blocks.push({
      id,
      title: field("НАЗВАНИЕ") || id,
      page: field("СТРАНИЦА") || "главная",
      purpose: field("ЗАДАЧА"),
      html: field("HTML"),
      css: field("CSS"),
      js: field("JS"),
    });
  }

  const formRe = /===\s*ФОРМА\s+([^\s=]+)\s*===\s*([\s\S]*?)(?====\s*(?:БЛОК|ФОРМА|ПЛАН|ЗАМЕТКИ)\s|$)/g;
  while ((m = formRe.exec(text))) {
    site.forms.push({ id: m[1].trim(), spec: m[2].trim() });
  }

  const notesMatch = /===\s*ЗАМЕТКИ\s*===\s*([\s\S]*?)(?====\s*[А-ЯA-Z]|$)/.exec(text);
  if (notesMatch) site.notes = notesMatch[1].trim().split("\n").map((s) => s.trim()).filter(Boolean);

  site.pages = [...new Set(site.blocks.map((b) => b.page))];
  return site;
}

// ---------- задание агенту ----------

/**
 * Свод правил для агента.
 *
 * Половина текста — про ограничения Тильды, и это не формальность: без них
 * получается красивый сайт, который ломает страницу при вставке или теряет
 * заявки. Вторая половина — про то, ради чего сайт делается: не «нарисовать
 * красиво», а провести человека к заявке.
 */
const SITE_AGENT_PROMPT = `
=== РОЛЬ ===
Ты копирайтер, UX-редактор и дизайнер интерфейсов в одном лице. Ты делаешь не
«страницу с текстом», а ПРОТОТИП С ГОТОВЫМ ДИЗАЙНОМ: по нему принимают решение,
как сайт будет выглядеть. Поэтому вёрстка должна быть плотной и продуманной —
сетка, ритм, воздух, иерархия, состояния наведения, — а не набор абзацев подряд.

При этом дизайн работает на заявку. Каждый экран отвечает на вопрос «почему
человек читает это здесь и что делает дальше».

=== ЧТО ТЫ ПОЛУЧАЕШЬ ===
Материалы: текст о проекте, дизайн-систему, логотипы, референсы. Референсы и
логотипы могут прийти картинками — тогда смотри на них и бери оттуда приёмы:
сетку, плотность, типографику, обращение с фотографией.

Фактов, которых нет в материалах (цены, сроки, гарантии, имена), не придумывай:
ставь метку [УТОЧНИТЬ: что именно] и выноси это в заметки.

=== ДИЗАЙН-СИСТЕМА — ЗАКОН ===
Если переданы цвета, шрифты или переменные — используй ИМЕННО ИХ. Не «похожий
оттенок», не «подобный шрифт». Свои значения вводи только там, где в системе
ничего нет, и скажи об этом в заметках. Сайт должен выглядеть частью бренда, а
не отдельной работой.

=== ИЗОБРАЖЕНИЯ ===
Картинки не вставляй ни ссылками, ни путями. Вместо адреса ставь метку:
  [ФОТО: что должно быть на кадре]
Описывай по-английски и предметно — «modern brick house exterior winter», а не
«красивый дом». Приложение само подставит настоящий снимок со стока, а заменить
его в Тильде — минутное дело. Прототип без изображений оценить нельзя: пустые
прямоугольники не показывают ни ритма, ни того, как читается заголовок поверх
фотографии.

Метку можно ставить и в CSS: background: url([ФОТО: soft blurred forest]).

=== ЛОГОТИП ===
Если логотип передан — ИСПОЛЬЗУЙ ЕГО: в шапке, а если уместно, то и в подвале.
Ставь метку с уточнением, какой вариант нужен:
  [ЛОГОТИП: белый на тёмном]
Приложение подставит сам файл. Уточнение пиши словами из имени файла — они
обычно и описывают вариант. Сайт без логотипа выглядит как чужой шаблон, а не
как сайт этого бренда.

=== ФОРМЫ: ВЁРСТАЙ, НО ПОМЕЧАЙ ===
Форму рисуй целиком и в общем стиле — поля, подписи, кнопку, состояния. Это часть
прототипа.
Но приём заявок в Тильде работает через её собственные блоки формы, и эта форма
сама по себе заявки не отправит. Поэтому ПЕРЕД каждой формой ставь комментарий:
  <!-- ТИЛЬДА-ФОРМА: <что подключить: какие поля, куда уходит заявка, что после отправки> -->
По нему ИИ Тильды переподключит форму к приёмникам, сохранив оформление. Без этой
пометки форма будет выглядеть рабочей и молча терять заявки.

=== ЖЁСТКИЕ ОГРАНИЧЕНИЯ БЛОКА ===
Блок вставляется в блок «HTML-код» (T123) на страницу, где уже есть чужие блоки:
1. Никаких тегов html, head, body — только содержимое.
2. Стили в поле CSS, скрипт в поле JS, разметка в поле HTML. Не вкладывай
   <style> и <script> в HTML: их не получится ограничить блоком.
3. В CSS пиши обычные селекторы — приложение само ограничит их этим блоком.
   Но глобальных сбросов в блоке нет: объявляй всё, что используешь, включая
   box-sizing, если он тебе нужен.
4. Внешние библиотеки и шрифты не подключай: страница Тильды уже грузит своё.
   Обходись системными шрифтами и своим CSS.
5. Блок обязан быть отзывчивым: не меньше одного @media на узкий экран. Тильда
   открывается с телефона чаще, чем с компьютера.

=== ДВИЖЕНИЕ ===
Движение работает на смысл, а не «оживляет»:
— появление содержимого по мере прокрутки (IntersectionObserver), а не бесконечные покачивания;
— один экран — одно заметное движение, остальное тише;
— только transform и opacity: они не заставляют браузер пересчитывать раскладку;
— обязательный @media (prefers-reduced-motion: reduce) с выключением анимаций;
— ничего, что двигается само дольше пары секунд после появления.

=== ФОРМАТ ОТВЕТА ===
=== ПЛАН ===
<аудитория, целевое действие, порядок экранов и зачем каждый; какие приёмы взяты
из референсов и какие значения дизайн-системы использованы>

=== БЛОК 1 ===
--- НАЗВАНИЕ ---
<короткое имя, по которому его узнают>
--- СТРАНИЦА ---
<главная или имя страницы>
--- ЗАДАЧА ---
<что этот экран делает для посетителя и для заявки>
--- HTML ---
<разметка без html/head/body; картинки метками [ФОТО: …]>
--- CSS ---
<стили обычными селекторами, с @media на узкий экран>
--- JS ---
<скрипт или пусто; переменная root уже указывает на корень блока>

=== ЗАМЕТКИ ===
<что уточнить, где пришлось ввести свои значения, что заменить в Тильде>
`.trim();

/** Собирает задание агенту из материалов и пожеланий. */
function buildSiteBrief({ kind = "лендинг", goal = "", audience = "", sources = {}, texts = [], tilda = null }) {
  const parts = [];
  parts.push(`Тип сайта: ${kind}.`);
  if (goal) parts.push(`Целевое действие: ${goal}`);
  if (audience) parts.push(`Аудитория: ${audience}`);

  const list = (items, limit = 40) =>
    items.slice(0, limit).map((f) => `  - ${f.folder ? f.folder + "/" : ""}${f.name}`).join("\n");

  for (const kindSpec of SOURCE_KINDS) {
    const files = sources[kindSpec.id] || [];
    if (!files.length) continue;
    parts.push(`\n${kindSpec.label} (${files.length} файлов):\n${list(files)}`);
  }

  if (texts.length) {
    parts.push("\n=== СОДЕРЖАНИЕ ТЕКСТОВЫХ МАТЕРИАЛОВ ===");
    for (const t of texts) parts.push(`\n--- ${t.name} ---\n${t.text}`);
  }

  if (tilda && tilda.pages && tilda.pages.length) {
    parts.push(
      `\n=== ЧТО УЖЕ ЕСТЬ В ПРОЕКТЕ ТИЛЬДЫ ===\n` +
        tilda.pages.map((p) => `  - ${p.title}${p.alias ? ` (/${p.alias})` : ""}`).join("\n") +
        "\nНовые страницы не должны повторять существующие."
    );
  }

  return parts.join("\n");
}

// ---------- сохранение ----------

function sitesDir(root) {
  return path.join(root, "sites");
}

function siteFile(root, id) {
  return path.join(sitesDir(root), `${id}.json`);
}

async function readSite(root, id) {
  try {
    return JSON.parse(await fs.readFile(siteFile(root, id), "utf-8"));
  } catch {
    return null;
  }
}

async function writeSite(root, site) {
  await fs.mkdir(sitesDir(root), { recursive: true });
  await fs.writeFile(siteFile(root, site.id), JSON.stringify(site, null, 2), "utf-8");
  return site;
}

async function listSites(root) {
  try {
    const names = await fs.readdir(sitesDir(root));
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const site = await readSite(root, name.replace(/\.json$/, ""));
      if (site) out.push({ id: site.id, title: site.title, kind: site.kind, blocks: (site.blocks || []).length, updated: site.updated });
    }
    return out.sort((a, b) => str(b.updated).localeCompare(str(a.updated)));
  } catch {
    return [];
  }
}

/**
 * Страница для просмотра всего сайта целиком.
 *
 * Нужна не для красоты: блок по отдельности выглядит иначе, чем в череде
 * соседей, и пока экраны не увидены подряд, непонятно, ведёт ли сайт к заявке.
 */
function buildPreview(site) {
  const blocks = (site.blocks || []).map((b) => buildBlockHtml(b)).join("\n\n");
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(site.title || "Сайт")} — просмотр</title>
<style>
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
  /* Полоска между блоками — только в просмотре: на Тильде блоки стоят вплотную. */
  .dyn-sep { font: 11px/1 monospace; color: #999; padding: 6px 12px; background: #f6f6f6; border-top: 1px dashed #ccc; }
</style>
</head>
<body>
${blocks}
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Выгрузка сайта в папку: по файлу на блок плюс просмотр и памятка.
 *
 * По файлу на блок — потому что переносить в Тильду их придётся по одному:
 * открыл файл, скопировал, вставил в блок «HTML-код».
 */
async function exportSite(site, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const written = [];
  for (const [i, block] of (site.blocks || []).entries()) {
    const safe = String(block.title || block.id).replace(/[^\wа-яёА-ЯЁ -]/gi, "").trim().slice(0, 60);
    const name = `${String(i + 1).padStart(2, "0")} ${safe || block.id}.html`;
    const file = path.join(destDir, name);
    await fs.writeFile(file, buildBlockHtml(block), "utf-8");
    written.push(file);
  }
  const previewFile = path.join(destDir, "просмотр.html");
  await fs.writeFile(previewFile, buildPreview(site), "utf-8");

  const readme = [
    `# ${site.title || "Сайт"}`,
    "",
    "## Как перенести в Тильду",
    "",
    "1. На странице Тильды добавьте блок «HTML-код» (T123).",
    "2. Откройте файл блока, скопируйте всё содержимое и вставьте в этот блок.",
    "3. Повторите по порядку номеров файлов.",
    "",
    "Стили каждого блока уже ограничены им самим — соседние блоки страницы они не тронут.",
    "",
    "## Формы",
    "",
    "Формы свёрстаны и оформлены — это часть прототипа. Но заявки они пока НЕ ОТПРАВЛЯЮТ:",
    "приём в Тильде работает через её собственные блоки формы.",
    "",
    "В коде рядом с каждой формой стоит комментарий `ТИЛЬДА-ФОРМА` с заданием. Передайте блок",
    "ИИ Тильды с просьбой переподключить форму к приёмникам, сохранив оформление.",
    "",
    "Пока это не сделано, форма выглядит рабочей и молча теряет заявки.",
    site.forms && site.forms.length
      ? "\nОтдельные задания на формы:\n\n" + site.forms.map((f) => `### Форма ${f.id}\n\n${f.spec}`).join("\n\n")
      : "",
    "",
    "## Изображения",
    "",
    "Фотографии подставлены со стока, чтобы прототип можно было оценить целиком.",
    "В Тильде замените их своими: адреса видны прямо в коде блока.",
    site.photos && site.photos.length
      ? "\nЧто подставлено:\n" + site.photos.map((ph) => `- ${ph.query} — ${ph.author || "автор не указан"} (${ph.page})`).join("\n")
      : "",
    "",
    "Свои картинки загрузите в Тильду и подставьте полученные адреса: путь к файлу на компьютере",
    "на сайте превращается в пустое место.",
    "",
    "## Обязательное условие Тильды",
    "",
    "По пользовательскому соглашению Тильды при экспорте страниц на свой сервер на каждой",
    "странице нужно оставить отметку «Made on Tilda» со ссылкой на https://tilda.cc.",
    "Если блоки вставляются в саму Тильду, отметка уже стоит.",
    "",
    site.notes && site.notes.length ? "## Заметки агента\n\n" + site.notes.map((n) => `- ${n}`).join("\n") : "",
  ].join("\n");
  const readmeFile = path.join(destDir, "как перенести.md");
  await fs.writeFile(readmeFile, readme, "utf-8");

  return { blocks: written, previewFile, readmeFile };
}

module.exports = {
  SOURCE_KINDS,
  SITE_AGENT_PROMPT,
  TILDA_METHODS,
  RATE_LIMIT,
  scanFolder,
  collectSources,
  createLimiter,
  tildaCall,
  scopeCss,
  blockScope,
  buildBlockHtml,
  checkBlock,
  checkSite,
  parseSite,
  stripFence,
  buildSiteBrief,
  extractTokens,
  describeTokens,
  searchPhotos,
  collectPhotoMarks,
  applyPhotos,
  collectLogoMarks,
  pickLogo,
  applyLogos,
  LOGO_MARK,
  PHOTO_MARK,
  buildPreview,
  readSite,
  writeSite,
  listSites,
  exportSite,
  sitesDir,
};
