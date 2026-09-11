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
// 3. ФОРМЫ — ОСОБЫЙ СЛУЧАЙ. Приём заявок в Тильде висит на её собственных
//    блоках формы: настроенные приёмники (почта, CRM, уведомления) знают только
//    про них. Форма, свёрстанная внутри HTML-блока, выглядит как форма, но
//    заявки из неё никуда не уходят — и узнаётся это обычно по потерянным
//    лидам. Поэтому форма отдаётся не вёрсткой, а заданием: какой нативный блок
//    взять и какие поля в нём завести.
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
  if (/<form\b/i.test(html)) {
    problems.push(
      "В блоке свёрстана форма. Приём заявок в Тильде работает только через её собственные блоки формы: " +
        "свёрстанная здесь форма выглядит рабочей, но заявки из неё никуда не уйдут. Опишите форму заданием."
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

// ---------- разбор ответа агента ----------

/**
 * Агент отдаёт сайт размеченным текстом, а не JSON.
 *
 * JSON здесь хуже: в блоках много HTML с кавычками и переводами строк, и на
 * экранировании модель ошибается тем чаще, чем длиннее блок. Разметка же
 * восстанавливается даже из частично испорченного ответа.
 */
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
      return found ? found[1].trim() : "";
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
Ты одновременно копирайтер, UX-редактор и дизайнер интерфейсов. Твоя работа не
«сверстать красиво», а привести посетителя к целевому действию. Каждый блок
должен отвечать на вопрос «почему человек читает это именно здесь и что делает
дальше».

=== ЧТО ТЫ ПОЛУЧАЕШЬ ===
Материалы с компьютера: текст о проекте, изображения, референсы, дизайн-систему
и логотипы. Опирайся на них. Фактов, которых нет в материалах (цены, сроки,
гарантии, имена), не придумывай: если факт нужен, поставь заметную метку
[УТОЧНИТЬ: что именно] и напиши об этом в заметках.

=== ПОРЯДОК РАБОТЫ ===
1. Сначала план: кто аудитория, какое действие целевое, какие возражения нужно
   снять и в каком порядке идут экраны. План отдаёшь до блоков.
2. Потом блоки — по одному на смысловой экран.

=== ЖЁСТКИЕ ОГРАНИЧЕНИЯ ТИЛЬДЫ ===
Блок вставляется в блок «HTML-код» (T123) на страницу, где уже есть чужие блоки.
Отсюда правила, нарушать которые нельзя:
1. Никаких тегов html, head, body — только содержимое.
2. Стили в поле CSS, скрипт в поле JS, разметка в поле HTML. Не вкладывай
   <style> и <script> внутрь HTML: их не получится ограничить блоком.
3. В CSS пиши обычные селекторы — приложение само ограничит их этим блоком.
   Но не рассчитывай на глобальные сбросы: в блоке нет ни normalize, ни своих
   переменных, объявляй всё, что используешь.
4. НЕ ВЁРСТАЙ ФОРМЫ. Приём заявок в Тильде работает только через её
   собственные блоки формы. Вместо вёрстки отдай задание: === ФОРМА <номер> ===
   и в нём — какой блок Тильды взять, какие поля завести, что писать на кнопке,
   куда вести после отправки.
5. Картинки — по адресам, а не путями с компьютера: локальный путь на сайте
   превращается в пустое место. Если нужное изображение есть в материалах,
   сошлись на его имя файла и скажи в заметках, что его надо загрузить в Тильду
   и подставить адрес.
6. Шрифты и внешние библиотеки не подключай: страница Тильды уже грузит своё, а
   лишняя загрузка бьёт по скорости. Обходись системными шрифтами и своим CSS.

=== ДВИЖЕНИЕ ===
Движение должно работать на смысл, а не «оживлять». Правила:
— анимируй появление содержимого по мере прокрутки, а не бесконечные покачивания;
— один экран — одно заметное движение, остальное тише;
— только transform и opacity: они не заставляют браузер пересчитывать раскладку;
— обязательно уважай @media (prefers-reduced-motion: reduce) — выключай анимации;
— ничего, что двигается само по себе дольше пары секунд после появления.

=== ФОРМАТ ОТВЕТА ===
=== ПЛАН ===
<аудитория, целевое действие, порядок экранов и зачем каждый>

=== БЛОК 1 ===
--- НАЗВАНИЕ ---
<короткое имя, по которому его узнают>
--- СТРАНИЦА ---
<главная или имя страницы>
--- ЗАДАЧА ---
<что этот экран делает для посетителя и для заявки>
--- HTML ---
<разметка без html/head/body>
--- CSS ---
<стили обычными селекторами>
--- JS ---
<скрипт или пусто; переменная root уже указывает на корень блока>

=== ФОРМА 1 ===
<задание на нативный блок формы Тильды>

=== ЗАМЕТКИ ===
<что уточнить, что загрузить, на что обратить внимание>
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
    site.forms && site.forms.length
      ? "Формы вёрсткой не передаются: приём заявок в Тильде работает только через её собственные блоки формы.\n" +
        "Задания на формы:\n\n" +
        site.forms.map((f) => `### Форма ${f.id}\n\n${f.spec}`).join("\n\n")
      : "Форм в этом сайте нет.",
    "",
    "## Изображения",
    "",
    "Картинки нужно загрузить в Тильду и подставить полученные адреса вместо меток в блоках:",
    "путь к файлу на компьютере на сайте превращается в пустое место.",
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
  buildSiteBrief,
  buildPreview,
  readSite,
  writeSite,
  listSites,
  exportSite,
  sitesDir,
};
