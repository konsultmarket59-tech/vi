// Страницы домов: из строки каталога — готовый код для блока T123 в Тильде.
//
// Что здесь происходит и почему именно так.
//
// Каталог для Тильды — это витрина: плитка, цена, фото. Страницы под каждой
// плиткой раньше собирались руками, и на сорока домах это несколько дней
// работы, после которой половина страниц всё равно отличается от каталога:
// там цена обновилась, здесь фото добавили. Поэтому страница собирается из той
// же строки каталога, которую человек загружает в Тильду, — расхождению между
// витриной и страницей просто неоткуда взяться.
//
// Три вещи, которые важнее остального.
//
// 1. МИКРОРАЗМЕТКА ОПИСЫВАЕТ ТО, ЧТО ВИДНО НА СТРАНИЦЕ, и ничего сверх этого.
//    Поисковик сверяет разметку с текстом страницы, и расхождение между ними —
//    самая частая причина, по которой разметку молча перестают учитывать.
//    Поэтому цена, площадь и наличие в JSON-LD берутся из тех же полей, что и
//    видимый текст, а свойств, которых в данных нет, в разметке не появляется:
//    недостающее уходит в замечания, а не подставляется правдоподобным.
//
// 2. РАЗМЕТКИ ОТЗЫВОВ И РЕЙТИНГА ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО. Отзывов на странице
//    дома не показывают, а размечать несуществующие отзывы — прямой путь к
//    тому, что поисковик перестанет доверять разметке всего сайта.
//
// 3. СОДЕРЖИМОЕ ПОДСТАВЛЯЕТСЯ В КОД, А НЕ ТОЛЬКО РИСУЕТСЯ СКРИПТОМ. Шаблон
//    страницы собирает текст на стороне браузера; робот Яндекса выполняет
//    скрипты далеко не всегда, и такая страница выглядит для него пустой.
//    Поэтому тот же текст записывается прямо в код — скрипт потом рисует
//    ровно его же, ничего не пряча и не подменяя.

const fs = require("node:fs/promises");
const path = require("node:path");

/** Предел длины ячейки в Excel. Больше — файл просто не откроется. */
const CELL_LIMIT = 32767;

/** Колонки таблицы «адрес — код». */
const PAGE_COLUMNS = ["Адрес", "Кадастровый номер", "External ID", "Заголовок страницы", "Код HTML", "Файл"];

const str = (v) => String(v ?? "").trim();

function num(v) {
  const n = Number(String(v ?? "").replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripTags(s) {
  return String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/ /g, " ")
    .trim();
}

function money(n) {
  return `${Math.round(num(n)).toLocaleString("ru-RU")} ₽`;
}

function area(v) {
  const n = num(v);
  if (!n) return "";
  return Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
}

/**
 * Разбор описания из каталога на вступление и разделы.
 *
 * Описание в каталоге — это HTML со списками и жирными подзаголовками, ровно
 * в том виде, в каком его принимает магазин Тильды. Заголовок раздела —
 * короткая строка целиком жирным без точки в конце («Конструктив»,
 * «Инженерия»); пункт — «<strong>Ключ.</strong> значение» либо просто текст.
 */
function parseText(raw) {
  const s = String(raw ?? "")
    .replace(/<\/?ul[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n")
    .replace(/<\/li>|<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<p[^>]*>/gi, "\n");
  const intro = { lead: "", paras: [], items: [] };
  const sections = [];
  let current = null;

  for (const line of s.split("\n")) {
    const plain = stripTags(line);
    if (!plain) continue;
    const strongs = [...line.matchAll(/<strong>([\s\S]*?)<\/strong>/gi)].map((m) => stripTags(m[1]));
    const wholeBold = strongs.length > 0 && strongs.join("").trim() === plain;

    if (wholeBold && plain.length < 40 && !plain.endsWith(".")) {
      current = { title: plain.replace(/:$/, ""), items: [] };
      sections.push(current);
      continue;
    }
    if (wholeBold && current === null && !intro.lead) {
      intro.lead = plain;
      continue;
    }
    const m = /^\s*<strong>([\s\S]*?)<\/strong>([\s\S]*)/i.exec(line);
    const item =
      m && stripTags(m[2])
        ? { k: stripTags(m[1]).replace(/[.\s]+$/, ""), v: stripTags(m[2]) }
        : { k: "", v: plain };

    if (current === null) {
      if (item.k) intro.items.push(item);
      else intro.paras.push(item.v);
    } else {
      current.items.push(item);
    }
  }
  return { intro, sections };
}

/** Комплектации: «Название — 1 200 000 ₽ под ключ» разбирается на имя и цену. */
function parsePackages(items) {
  return (items || []).map((it) => {
    const head = it.k || it.v;
    const m = /^(.+?)\s+[—-]\s+([\d\s ]+)\s*₽\s*(.*)$/.exec(head);
    if (!m) return { name: head, price: 0, priceNote: "", text: it.k ? it.v : "" };
    return {
      name: m[1].trim(),
      price: Number(m[2].replace(/\D/g, "")) || 0,
      priceNote: m[3].trim().replace(/\.$/, ""),
      text: it.k ? it.v : "",
    };
  });
}

const READY_LABEL = { готов: "Готов к заселению", стройка: "Строится", план: "В проекте" };
const READY_SHORT = { готов: "Готов", стройка: "Стройка", план: "Проект" };

/**
 * Дом из строки каталога.
 *
 * Строка каталога — это то, что уезжает в магазин Тильды. Брать данные оттуда,
 * а не из выгрузки 1С напрямую, важно ровно по одной причине: на витрине и на
 * странице дома должны стоять одни и те же цена, площадь и фото.
 */
function houseFromRow(row) {
  const title = str(row.Title);
  const comma = title.indexOf(",");
  const village = comma >= 0 ? title.slice(0, comma).trim() : title;
  const address = comma >= 0 ? title.slice(comma + 1).trim() : "";

  const { intro, sections } = parseText(row.Text);
  let packages = [];
  const terms = [];
  const build = [];
  for (const sec of sections) {
    const t = sec.title.toLowerCase();
    if (t.includes("комплектац")) packages = parsePackages(sec.items);
    else if (t.includes("услови")) terms.push(...sec.items);
    else if (sec.items.length) build.push(sec);
  }
  const readiness = str(row.Mark);
  // Готовый дом продаётся в конкретном виде — выбор комплектаций ему не нужен.
  if (readiness === "готов") packages = [];

  const houseArea = area(row["Characteristics:площадь дома"]);
  const plotArea = area(row["Characteristics:Площадь участка"]);
  const statusLabel = READY_LABEL[readiness] || "В продаже";

  const subtitleParts = [str(row.Description)];
  if (plotArea) subtitleParts.push(`Участок ${plotArea} сот. входит в стоимость.`);

  const facts = [["Дом", `${houseArea} м²`]];
  if (plotArea) facts.push(["Участок", `${plotArea} сот.`]);
  facts.push(["Готовность", READY_SHORT[readiness] || "—"]);

  const specs = [["Посёлок", village]];
  if (address) specs.push(["Адрес", address]);
  specs.push(["Площадь дома", `${houseArea} м²`]);
  if (plotArea) specs.push(["Участок", `${plotArea} сот.`]);
  specs.push(["Состояние", statusLabel], ["Кадастровый номер", str(row.SKU)]);

  return {
    externalId: str(row["External ID"]),
    cadastral: str(row.SKU),
    title,
    village,
    address,
    houseArea,
    plotArea,
    price: Math.round(num(row.Price)),
    readiness,
    statusLabel,
    subtitle: subtitleParts.filter(Boolean).join(" "),
    aboutTitle: `Дом ${houseArea} м² в посёлке «${village}»`,
    seoTitle: str(row["SEO title"]),
    seoDescr: str(row["SEO descr"]),
    intro,
    facts,
    specs,
    packages,
    sections: build,
    terms,
    photos: str(row.Photo).split(/\s+/).filter(Boolean),
  };
}

/**
 * Наличие для разметки.
 *
 * Строящийся дом — это предзаказ, а не товар на складе: обещать поисковику
 * «в наличии» там, где дома ещё нет, значит расходиться с тем, что написано на
 * самой странице.
 */
function availabilityOf(readiness) {
  if (readiness === "готов") return "https://schema.org/InStock";
  if (readiness === "стройка" || readiness === "план") return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
}

/**
 * Микроразметка страницы: один @graph, а не несколько независимых блоков.
 *
 * Product с Offer — то, что поисковики действительно понимают у карточки
 * объекта. Рядом SingleFamilyResidence: он не даёт отдельного сниппета, но это
 * честное описание того, что продаётся, и его читают системы, которые
 * собирают знания об объекте. Хлебные крошки добавляются только когда известен
 * адрес сайта: выдуманный адрес хуже отсутствующего.
 *
 * Чего здесь нет: рейтинга и отзывов. На странице дома их не показывают, а
 * размечать то, чего человек на странице не видит, — прямой способ лишить
 * доверия разметку всего сайта.
 */
function jsonLd(house, config = {}) {
  const site = str(config.site).replace(/\/+$/, "");
  const pageUrl = pageUrlFor(house, config);
  const org = str(config.organization);
  const phone = str(config.phone);
  const region = str(config.region);
  const country = str(config.country) || "RU";

  const seller = org
    ? { "@type": "Organization", name: org, ...(site ? { url: site } : {}), ...(phone ? { telephone: phone } : {}) }
    : null;

  const offer = {
    "@type": "Offer",
    price: String(house.price),
    priceCurrency: "RUB",
    availability: availabilityOf(house.readiness),
    ...(pageUrl ? { url: pageUrl } : {}),
    ...(seller ? { seller } : {}),
  };

  const address = {
    "@type": "PostalAddress",
    addressCountry: country,
    ...(region ? { addressRegion: region } : {}),
    addressLocality: house.village,
    ...(house.address ? { streetAddress: house.address } : {}),
  };

  const product = {
    "@type": "Product",
    "@id": pageUrl ? `${pageUrl}#product` : undefined,
    // Название объекта, а не заголовок страницы: в SEO-заголовке стоит ещё и
    // цена, и в разметке она разошлась бы с ценой предложения при первом же
    // обновлении каталога.
    name: `Дом ${house.houseArea} м², ${house.title}`,
    description: house.subtitle || house.seoDescr,
    sku: house.cadastral,
    ...(house.photos.length ? { image: house.photos } : {}),
    ...(pageUrl ? { url: pageUrl } : {}),
    offers: offer,
    additionalProperty: [
      { "@type": "PropertyValue", name: "Площадь дома", value: house.houseArea, unitText: "м²" },
      ...(house.plotArea
        ? [{ "@type": "PropertyValue", name: "Площадь участка", value: house.plotArea, unitText: "сот." }]
        : []),
      { "@type": "PropertyValue", name: "Готовность", value: house.statusLabel },
      { "@type": "PropertyValue", name: "Кадастровый номер", value: house.cadastral },
    ],
  };

  const residence = {
    "@type": "SingleFamilyResidence",
    ...(pageUrl ? { "@id": `${pageUrl}#residence` } : {}),
    name: `Дом ${house.houseArea} м², ${house.title}`,
    address,
    ...(house.houseArea
      ? { floorSize: { "@type": "QuantitativeValue", value: num(house.houseArea.replace(",", ".")), unitCode: "MTK" } }
      : {}),
    ...(house.photos.length ? { photo: house.photos } : {}),
  };

  const graph = [product, residence];

  if (site) {
    const catalog = str(config.catalogUrl) || `${site}/catalog`;
    graph.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: site },
        { "@type": "ListItem", position: 2, name: "Каталог домов", item: catalog },
        { "@type": "ListItem", position: 3, name: `Дом ${house.houseArea} м², ${house.address || house.village}` },
      ],
    });
  }

  return JSON.parse(JSON.stringify({ "@context": "https://schema.org", "@graph": graph }));
}

/** Адрес страницы по правилу вида `https://сайт/house/{sku}`. Пусто — не выдумываем. */
function pageUrlFor(house, config = {}) {
  const tpl = str(config.pageUrl);
  if (!tpl) return "";
  return tpl
    .replace(/\{sku\}/gi, encodeURIComponent(house.cadastral))
    .replace(/\{id\}/gi, encodeURIComponent(house.externalId))
    .replace(/\{cadastral\}/gi, encodeURIComponent(house.cadastral));
}

/**
 * Чего не хватает для полной разметки.
 *
 * Отдельно от сборки: страницу надо отдать в любом случае, а недостающее —
 * назвать, а не подставить похожим на правду.
 */
function checkHouse(house, config = {}) {
  const problems = [];
  const где = house.title || house.cadastral;
  if (!house.photos.length) problems.push(`«${где}» — ни одного фото: страница соберётся без галереи и без image в разметке.`);
  if (!house.price) problems.push(`«${где}» — нет цены: в разметке не будет предложения, а на странице — стоимости.`);
  if (!house.houseArea) problems.push(`«${где}» — не заполнена площадь дома.`);
  if (!house.intro.paras.length && !house.intro.lead) {
    problems.push(`«${где}» — пустое описание: на странице не будет текста, который читает поисковик.`);
  }
  if (!str(config.pageUrl)) {
    const note = "Не задан адрес страниц на сайте — в разметке не будет ссылок на страницу и хлебных крошек. Это не ошибка, но с адресом разметка полнее.";
    if (!problems.includes(note)) problems.push(note);
  }
  if (!str(config.organization)) {
    const note = "Не задано название компании — в разметке не будет продавца.";
    if (!problems.includes(note)) problems.push(note);
  }
  return problems;
}

/** Вставляет содержимое в пустой элемент шаблона по его id. */
function setById(html, id, inner) {
  const re = new RegExp(`(<([a-z0-9]+)[^>]*\\sid="${id}"[^>]*>)(</\\2>)`, "i");
  return html.replace(re, (all, open, _tag, close) => `${open}${inner}${close}`);
}

const ICON_KEYS = ["plot", "pen", "layers", "home", "sun"];

/**
 * Двоеточие после ключа.
 *
 * Без него «Облицовка» и «кирпич» стоят двумя строками на экране, но в тексте
 * слипаются в «Облицовкакирпич» — именно так их копируют, так их читает вслух
 * экранный диктор и так же их читает поисковик: у него текстовый слой, а не
 * картинка.
 */
function keyLabel(k) {
  const s = String(k ?? "").trim();
  if (!s) return "";
  return /[:.!?]$/.test(s) ? s : `${s}:`;
}

/**
 * Тот же текст, что нарисует скрипт, — но прямо в коде страницы.
 *
 * Робот Яндекса выполняет скрипты не всегда, и страница, которая рисуется
 * только браузером, выглядит для него пустой. Скрипт после загрузки рисует
 * ровно это же содержимое: ничего не прячется и не подменяется, просто текст
 * есть в коде с самого начала.
 */
function prefill(html, house) {
  const p = (s) => esc(s);
  let out = html;
  out = setById(out, "nzhKicker", p(`${house.village} · ${house.address}`));
  out = setById(out, "nzhTitle", p(`Дом ${house.houseArea} м²`));
  out = setById(out, "nzhSub", p(house.subtitle));
  out = setById(out, "nzhPrice", p(money(house.price)));
  out = setById(
    out,
    "nzhFacts",
    house.facts.map((f) => `<div class="nzh-fact"><dt>${p(f[0])}</dt><dd>${p(f[1])}</dd></div>`).join("")
  );
  out = setById(out, "nzhAboutTitle", p(house.aboutTitle));
  out = setById(out, "nzhLead", p(house.intro.lead || ""));
  out = setById(out, "nzhAboutText", house.intro.paras.map((x) => `<p>${p(x)}</p>`).join(""));
  out = setById(
    out,
    "nzhKv",
    house.intro.items
      .map(
        (it, i) =>
          `<li data-ico="${ICON_KEYS[i % ICON_KEYS.length]}"><div><b>${p(keyLabel(it.k))}</b> <span>${p(it.v)}</span></div></li>`
      )
      .join("")
  );
  out = setById(out, "nzhSpecs", house.specs.map((s) => `<div><dt>${p(s[0])}</dt><dd>${p(s[1])}</dd></div>`).join(""));
  out = setById(out, "nzhMapTitle", p(`Посёлок «${house.village}»`));
  // Галерея — настоящими картинками с подписями: по ним страницу находят в
  // поиске по картинкам, а человек без скриптов всё равно видит дом.
  out = setById(
    out,
    "nzhGallery",
    house.photos
      .map(
        (src, i) =>
          `<button type="button" class="nzh-g" aria-label="Открыть: ${p(house.title)}, фото ${i + 1}">` +
          `<img loading="lazy" src="${p(src)}" alt="${p(`${house.title}, фото ${i + 1}`)}">` +
          `<span class="nzh-g__scrim"></span></button>`
      )
      .join("")
  );
  return out;
}

/**
 * Код страницы для блока «HTML-код» в Тильде.
 *
 * `sharedStyles: true` вынимает из страницы общий стиль — восемнадцать
 * килобайт, одинаковых у всех домов. На сорока домах это лишние семьсот
 * килобайт в каждой выгрузке и код, который перестаёт помещаться в ячейку
 * таблицы. Стиль тогда вставляется один раз в настройки сайта.
 */
function renderPage(house, config = {}, template = "") {
  let out = template;
  out = out.replace("__TITLE_TAG__", "");
  out = out.replace("__DRAW_IMG__", "");
  out = out.replace("__MAP_SRC__", esc(str(config.mapSrc)));
  out = out.replace("__EXTRA_MEDIA__", "[\n    /* сюда — свои фото и видео */\n  ]");
  out = out.replace("__PREVIEW_FALLBACK__", "[]");
  out = out.replace(
    "__HOUSE_JSON__",
    JSON.stringify(house, null, 2).replace(/<\//g, "<\\/")
  );

  // Настройки блока: попап записи и телефон правятся в одном месте.
  if (str(config.bookingPopup)) {
    out = out.replace(/bookingPopup: "[^"]*"/, `bookingPopup: "${esc(str(config.bookingPopup))}"`);
  }
  if (str(config.phone)) {
    out = out.replace(/phone: "[^"]*"/, `phone: "${esc(str(config.phone))}"`);
  }
  if (config.mortgage) {
    const m = config.mortgage;
    out = out.replace(
      /mortgage: \{[^}]*\}/,
      `mortgage: { rate: ${num(m.rate) || 6}, termYears: ${num(m.termYears) || 30}, downPercent: ${num(m.downPercent) || 20} }`
    );
  }

  out = prefill(out, house);

  const разметка =
    `<script type="application/ld+json">\n${JSON.stringify(jsonLd(house, config), null, 2).replace(/<\//g, "<\\/")}\n</script>\n`;

  let styles = "";
  if (config.sharedStyles) {
    const m = /<style>[\s\S]*?<\/style>\n?/.exec(out);
    if (m) {
      styles = m[0];
      out = out.replace(m[0], "");
    }
  }

  return { html: разметка + out, styles };
}

/** Общий стиль: вставляется один раз в настройки сайта Тильды. */
function sharedStyles(template) {
  const m = /<style>[\s\S]*?<\/style>/.exec(template);
  return m ? m[0] : "";
}

function safeFileName(house) {
  const base = house.externalId || house.cadastral || house.title;
  return `${String(base).replace(/[^\wа-яёА-ЯЁ.-]+/gi, "-").replace(/^-+|-+$/g, "")}.html`;
}

/**
 * Страницы по всем домам каталога.
 *
 * Участки пропускаются: у них нет ни площади дома, ни комплектаций, и страница
 * дома им не подходит. Делать вид, что подходит, — значит выложить на сайт
 * сорок одинаковых пустых лендингов.
 */
function buildPages(rows, config = {}, template = "") {
  const pages = [];
  const problems = [];
  const seen = new Set();

  for (const row of rows || []) {
    if (!str(row["Characteristics:площадь дома"])) continue;
    const house = houseFromRow(row);
    problems.push(...checkHouse(house, config));

    let file = safeFileName(house);
    // Два дома с одинаковым именем файла перезаписали бы друг друга молча.
    if (seen.has(file)) {
      let n = 2;
      while (seen.has(`${file.replace(/\.html$/, "")}-${n}.html`)) n += 1;
      file = `${file.replace(/\.html$/, "")}-${n}.html`;
      problems.push(`Два дома дали одинаковое имя файла — второму дано имя ${file}.`);
    }
    seen.add(file);

    const { html } = renderPage(house, config, template);
    pages.push({
      address: house.title,
      cadastral: house.cadastral,
      externalId: house.externalId,
      title: house.seoTitle || `Дом ${house.houseArea} м², ${house.title}`,
      html,
      file,
      bytes: html.length,
      // Ячейку Excel длиннее предела таблица не переживает, поэтому длинный код
      // остаётся только файлом, а в ячейке — куда смотреть.
      fits: html.length <= CELL_LIMIT,
    });
  }

  const тесные = pages.filter((p) => !p.fits).length;
  if (тесные) {
    problems.push(
      `Код ${тесные} страниц(ы) длиннее ${CELL_LIMIT} знаков — столько в ячейку Excel не помещается. ` +
        "В таблице у них стоит имя файла, сам код лежит в папке рядом. " +
        "Чтобы код помещался в ячейку, включите «общий стиль отдельно»."
    );
  }
  return { pages, problems };
}

/** Строки таблицы «адрес — код»: то, что человек открывает рядом с каталогом. */
function pagesTable(pages) {
  return (pages || []).map((p) => ({
    Адрес: p.address,
    "Кадастровый номер": p.cadastral,
    "External ID": p.externalId,
    "Заголовок страницы": p.title,
    "Код HTML": p.fits ? p.html : `Код длиннее ячейки Excel — см. файл ${p.file}`,
    Файл: p.file,
  }));
}

/** Кладёт страницы файлами: их удобно открыть в браузере и проверить глазами. */
async function writePages(dir, pages, styles = "") {
  await fs.mkdir(dir, { recursive: true });
  for (const page of pages) {
    await fs.writeFile(path.join(dir, page.file), page.html, "utf-8");
  }
  if (styles) await fs.writeFile(path.join(dir, "общий-стиль.html"), styles, "utf-8");
  return dir;
}

async function readTemplate() {
  return fs.readFile(path.join(__dirname, "assets", "house-page.html"), "utf-8");
}

module.exports = {
  CELL_LIMIT,
  PAGE_COLUMNS,
  parseText,
  parsePackages,
  houseFromRow,
  availabilityOf,
  jsonLd,
  pageUrlFor,
  checkHouse,
  keyLabel,
  prefill,
  renderPage,
  sharedStyles,
  buildPages,
  pagesTable,
  writePages,
  readTemplate,
};
