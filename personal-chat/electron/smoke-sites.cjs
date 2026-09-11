// Сайты: сборка блоков под Тильду и разбор ответа агента.
//   node electron/smoke-sites.cjs
//
// Проверяется то, что в Тильде проявляется НЕ СРАЗУ: блок вставился, страница
// открылась, а поломался соседний блок или потерялись заявки. Такие вещи не
// видно в просмотре, поэтому их ловит тест.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sites = require("./sites.cjs");
const { finish } = require("./smoke-finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

async function main() {
  console.log("стили блока не выходят за его пределы");
  // Главная опасность блока «HTML-код»: он попадает на страницу к чужим блокам.
  const scoped = sites.scopeCss(
    "h2 { color: red } .card, .card p { padding: 4px } :root { --a: #f60 } body { margin: 0 }",
    ".dyn-1"
  );
  check("голый тег получил ограничение", /\.dyn-1 h2\{/.test(scoped), scoped);
  check("каждый селектор в перечислении ограничен",
    /\.dyn-1 \.card, \.dyn-1 \.card p\{/.test(scoped), scoped);
  check("корневые селекторы переехали на сам блок",
    (scoped.match(/^\.dyn-1\{/gm) || []).length === 2, scoped);
  check("неограниченных правил не осталось",
    !/(^|\n)\s*(?:h2|body|:root)\s*\{/.test(scoped), scoped);

  const media = sites.scopeCss("@media (max-width: 700px) { h2 { font-size: 20px } }", ".dyn-2");
  check("внутри @media селекторы тоже ограничены", /\.dyn-2 h2\{/.test(media), media);

  // Шаги анимации — не селекторы. Ограничить from/to значит сломать анимацию.
  const keyframes = sites.scopeCss("@keyframes rise { from { opacity: 0 } to { opacity: 1 } }", ".dyn-3");
  check("шаги @keyframes не тронуты",
    /@keyframes rise\{ from \{ opacity: 0 \} to \{ opacity: 1 \} \}/.test(keyframes), keyframes);
  check("в @keyframes не появилось ограничителя", !/\.dyn-3/.test(keyframes), keyframes);

  console.log("\nсборка блока для вставки в Тильду");
  const block = {
    id: "1",
    title: "Первый экран",
    html: '<h2>Дом у леса</h2><button class="cta">Посмотреть</button>',
    css: ".cta { background: #f60 } h2 { font-size: 32px }",
    js: 'root.querySelector(".cta").addEventListener("click", function () {});',
  };
  const html = sites.buildBlockHtml(block);
  check("разметка завёрнута в класс блока", /<div class="dyn-1">/.test(html), html.slice(0, 120));
  check("стили ограничены тем же классом", /\.dyn-1 h2\{/.test(html), html.slice(0, 200));
  check("скрипт заперт в своей области видимости",
    /\(function\(\)\{[\s\S]*\}\)\(\);/.test(html), html.slice(-200));
  check("скрипту дан корень блока", /var root = document\.currentScript/.test(html), html.slice(-260));
  // Два блока на одной странице не должны мешать друг другу.
  const second = sites.buildBlockHtml({ ...block, id: "2" });
  check("у второго блока другой ограничитель",
    /<div class="dyn-2">/.test(second) && /\.dyn-2 h2\{/.test(second), second.slice(0, 200));

  console.log("\nчто нельзя нести в Тильду");
  check("целая страница вместо блока — замечание",
    sites.checkBlock({ html: "<html><body><h2>Привет</h2></body></html>" })
      .some((p) => /html\/head\/body/.test(p)));
  check("стили внутри html — замечание",
    sites.checkBlock({ html: "<style>h2{color:red}</style><h2>x</h2>" })
      .some((p) => /отдельными полями/.test(p)));
  // Самое дорогое: форма выглядит рабочей, а заявки пропадают.
  const форма = sites.checkBlock({ html: '<form><input name="phone"><button>Отправить</button></form>' });
  check("свёрстанная форма названа ловушкой", форма.some((p) => /заявки из неё никуда не уйдут/.test(p)),
    JSON.stringify(форма));
  check("путь с компьютера — замечание",
    sites.checkBlock({ html: '<img src="/home/user/фото/дом.jpg">' })
      .some((p) => /на сайте она не откроется/.test(p)));
  check("обычный блок замечаний не вызывает",
    sites.checkBlock(block).length === 0, JSON.stringify(sites.checkBlock(block)));

  const двойной = sites.checkSite({ blocks: [{ id: "1", html: "<p>a</p>" }, { id: "1", html: "<p>b</p>" }] });
  check("два блока с одним номером — замечание",
    двойной.some((p) => /одинаковым номером/.test(p)), JSON.stringify(двойной));

  console.log("\nразбор ответа агента");
  const reply = [
    "=== ПЛАН ===",
    "Аудитория: семьи, целевое действие — заявка на просмотр.",
    "",
    "=== БЛОК 1 ===",
    "--- НАЗВАНИЕ ---",
    "Первый экран",
    "--- СТРАНИЦА ---",
    "главная",
    "--- ЗАДАЧА ---",
    "Показать дом и позвать на просмотр.",
    "--- HTML ---",
    '<h2>Дом у леса</h2>',
    "--- CSS ---",
    "h2 { font-size: 32px }",
    "--- JS ---",
    "",
    "=== БЛОК 2 ===",
    "--- НАЗВАНИЕ ---",
    "Как устроен дом",
    "--- СТРАНИЦА ---",
    "главная",
    "--- ЗАДАЧА ---",
    "Снять возражение о качестве.",
    "--- HTML ---",
    "<ul><li>Газобетон</li></ul>",
    "--- CSS ---",
    "li { margin: 4px }",
    "--- JS ---",
    "",
    "=== ФОРМА 1 ===",
    "Блок Тильды «Форма» T702. Поля: имя, телефон. Кнопка «Записаться на просмотр».",
    "",
    "=== ЗАМЕТКИ ===",
    "[УТОЧНИТЬ: цена дома]",
    "Загрузить фото фасада в Тильду и подставить адрес.",
  ].join("\n");

  const site = sites.parseSite(reply);
  check("план вычитан", /целевое действие/.test(site.plan), site.plan);
  check("оба блока разобраны", site.blocks.length === 2, String(site.blocks.length));
  check("поля блока на месте",
    site.blocks[0].title === "Первый экран" && site.blocks[0].html === "<h2>Дом у леса</h2>",
    JSON.stringify(site.blocks[0]));
  check("css блока не утёк в html", !/font-size/.test(site.blocks[0].html), site.blocks[0].html);
  check("задание на форму отделено от блоков",
    site.forms.length === 1 && /T702/.test(site.forms[0].spec), JSON.stringify(site.forms));
  check("заметки разобраны построчно", site.notes.length === 2, JSON.stringify(site.notes));
  check("страницы собраны", site.pages.join(",") === "главная", JSON.stringify(site.pages));

  console.log("\nлимит запросов к Тильде");
  // В документации сказано прямо: за нагрузку аккаунт блокируют и API отключают.
  // Поэтому считаем сами и отказываем до обращения к серверу.
  const limiter = sites.createLimiter(3, 60000);
  const t0 = Date.now();
  limiter.take(t0);
  limiter.take(t0);
  limiter.take(t0);
  check("три запроса прошли, место кончилось", limiter.left(t0) === 0, String(limiter.left(t0)));
  let отказ = "";
  try {
    limiter.take(t0);
  } catch (e) {
    отказ = e.message;
  }
  check("четвёртый запрос отклонён", !!отказ, отказ);
  check("в отказе сказано, когда можно снова", /через \d+ мин/.test(отказ), отказ);
  check("через час место освободилось", limiter.left(t0 + 61000) === 3, String(limiter.left(t0 + 61000)));

  console.log("\nобращение к Тильде");
  let последнийАдрес = "";
  const поддельныйFetch = async (url) => {
    последнийАдрес = url;
    return { ok: true, json: async () => ({ status: "FOUND", result: [{ id: "1", title: "Главная" }] }) };
  };
  const результат = await sites.tildaCall(
    "pages",
    { publickey: "pub", secretkey: "sec", projectid: "7" },
    { fetchImpl: поддельныйFetch }
  );
  check("ответ разобран", Array.isArray(результат) && результат[0].title === "Главная", JSON.stringify(результат));
  check("адрес собран по документации",
    последнийАдрес.startsWith("https://api.tildacdn.info/v1/getpageslist/"), последнийАдрес);
  check("обязательный параметр ушёл", /projectid=7/.test(последнийАдрес), последнийАдрес);

  // Ошибку Тильды нельзя выдавать за успех.
  let ошибка = "";
  try {
    await sites.tildaCall(
      "projects",
      { publickey: "pub", secretkey: "sec" },
      { fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ERROR", message: "wrong key" }) }) }
    );
  } catch (e) {
    ошибка = e.message;
  }
  check("ответ с ошибкой не выдаётся за успех", /wrong key/.test(ошибка), ошибка);

  // Секретный ключ не должен попасть в текст ошибки: оттуда он уедет в отчёт о проблеме.
  let сКлючом = "";
  try {
    await sites.tildaCall(
      "projects",
      { publickey: "pub", secretkey: "ОЧЕНЬ-СЕКРЕТНО" },
      { fetchImpl: async () => ({ ok: false, status: 500 }) }
    );
  } catch (e) {
    сКлючом = e.message;
  }
  check("секретный ключ не попал в сообщение об ошибке",
    !/ОЧЕНЬ-СЕКРЕТНО/.test(сКлючом), сКлючом);

  check("без ключей запрос не уходит",
    await (async () => {
      try {
        await sites.tildaCall("projects", {}, { fetchImpl: async () => { throw new Error("не должно вызваться"); } });
        return false;
      } catch (e) {
        return /ключи Тильды/.test(e.message);
      }
    })());

  // Метода записи у Тильды нет — и придумывать его нельзя.
  check("методов записи в списке нет",
    Object.keys(sites.TILDA_METHODS).every((m) => /^(?:projects|project|pages|page|pageFull|pageExport|pageFullExport)$/.test(m)),
    Object.keys(sites.TILDA_METHODS).join(","));

  console.log("\nматериалы с компьютера");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-"));
  fs.mkdirSync(path.join(dir, "тексты"));
  fs.mkdirSync(path.join(dir, "картинки"));
  fs.writeFileSync(path.join(dir, "тексты", "о проекте.txt"), "Посёлок у леса.", "utf-8");
  fs.writeFileSync(path.join(dir, "тексты", "заметки.md"), "Цены уточнить.", "utf-8");
  fs.writeFileSync(path.join(dir, "картинки", "фасад.jpg"), "не картинка, но расширение то", "utf-8");
  fs.writeFileSync(path.join(dir, "картинки", "лишнее.exe"), "мусор", "utf-8");

  const собрано = await sites.collectSources({ text: path.join(dir, "тексты"), images: path.join(dir, "картинки") });
  check("тексты найдены", собрано.files.text.length === 2, JSON.stringify(собрано.files.text.map((f) => f.name)));
  check("картинки найдены", собрано.files.images.length === 1, JSON.stringify(собрано.files.images.map((f) => f.name)));
  check("посторонние файлы отброшены",
    !собрано.files.images.some((f) => f.name.endsWith(".exe")), JSON.stringify(собрано.files.images));
  const битое = await sites.collectSources({ text: path.join(dir, "нет-такой-папки") });
  check("недоступная папка названа, а не пропущена молча",
    битое.problems.some((p) => /не открывается/.test(p)), JSON.stringify(битое.problems));

  console.log("\nвыгрузка в папку");
  const out = path.join(dir, "выгрузка");
  const полный = { ...site, id: "s1", title: "Дом у леса", forms: site.forms, notes: site.notes };
  const written = await sites.exportSite(полный, out);
  check("по файлу на блок", written.blocks.length === 2, JSON.stringify(written.blocks.map((f) => path.basename(f))));
  check("файлы пронумерованы по порядку переноса",
    path.basename(written.blocks[0]).startsWith("01 "), path.basename(written.blocks[0]));
  check("страница просмотра сохранена", fs.existsSync(written.previewFile));
  const памятка = fs.readFileSync(written.readmeFile, "utf-8");
  check("в памятке сказано, как переносить", /блок «HTML-код»/.test(памятка));
  check("в памятке названо ограничение по формам",
    /только через её собственные блоки формы/.test(памятка), памятка.slice(0, 200));
  // Условие из пользовательского соглашения Тильды при экспорте на свой сервер.
  check("в памятке есть условие «Made on Tilda»",
    /Made on Tilda/.test(памятка) && /tilda\.cc/.test(памятка));
  const просмотр = fs.readFileSync(written.previewFile, "utf-8");
  check("в просмотре оба блока", /dyn-1/.test(просмотр) && /dyn-2/.test(просмотр));

  fs.rmSync(dir, { recursive: true, force: true });

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  finish(failures, (c) => process.exit(c));
}

main().catch((e) => {
  console.error("Тест упал:", e);
  process.exit(1);
});
