// Каталог: пересборка выгрузки 1С в файл для загрузки в магазин Тильды.
//
// Что здесь происходит и почему именно так.
//
// 1С отдаёт то, что есть на самом деле: адреса, статусы, цены, фото. Каталог
// сайта требует другого: заголовков, категорий, длинных описаний и SEO по
// каждой позиции. Между этими двумя видами лежит ручная работа на несколько
// часов после каждой выгрузки — её и делает этот модуль.
//
// Три вещи, которые важнее остального:
//
// 1. ОПИСАНИЯ 1С ГРЯЗНЫЕ, и это нормально: их пишут люди в рабочем темпе.
//    В одной выгрузке встречаются «кирпиич», «Внешнаяя», «отделокой», один и
//    тот же смысл пятью формулировками и продублированное предложение подряд.
//    Поэтому описание не правится по строке, а РАЗБИРАЕТСЯ на смысл (облицовка,
//    цвет, отделка, примечания) и собирается заново в одном виде. Тогда пять
//    формулировок дают одну строку в каталоге, а опечатка не создаёт шестую.
//
// 2. ПЛОХИЕ ДАННЫЕ НЕ ПРЯЧУТСЯ. Дом с нулевой площадью, участок без цены,
//    позиция без фото — всё это уезжает в замечания, а не превращается молча в
//    «дом 0 м2» на витрине.
//
// 3. НОМЕРА ПОЗИЦИЙ СОХРАНЯЮТСЯ. У Тильды есть свой идентификатор товара; если
//    выгрузить каталог без него, магазин заведёт вторые экземпляры вместо
//    обновления существующих. Поэтому прошлый файл каталога можно подложить —
//    из него берутся номера по кадастровому.

const fs = require("node:fs/promises");
const path = require("node:path");

/** Колонки файла Тильды — в том же порядке, что и в её выгрузке. */
const TILDA_COLUMNS = [
  "Tilda UID", "Brand", "SKU", "Mark", "Category", "Title", "Description", "Text", "Photo",
  "Price", "Quantity", "Price Old", "Editions", "Modifications", "External ID", "Parent UID",
  "Characteristics:площадь дома", "Characteristics:Площадь участка",
  "Weight", "Length", "Width", "Height",
  "SEO title", "SEO descr", "SEO keywords", "FB title", "FB descr",
];

/**
 * Порядок готовности. Готовые дома идут первыми: их можно купить сегодня, и
 * именно они должны встречать человека на витрине.
 */
const READINESS_ORDER = ["готов", "стройка", "план"];

/**
 * Облицовки. Ключ — то, по чему ищется описание в библиотеке.
 *
 * Порядок значим: сначала составные варианты, потом одиночные. Иначе «сайдинг
 * под кирпич» опознаётся как кирпич — по первому же совпавшему слову, — и дом
 * получает чужое описание и чужие рендеры.
 *
 * В выражениях нельзя пользоваться \w: в JavaScript это только латиница, и на
 * русском тексте «договор\w*» молча перестаёт совпадать со словом «договору».
 * Поэтому окончания записаны явным русским классом букв.
 */
const RU = "[а-яё]";
const CLADDINGS = [
  { key: "сайдинг-под-кирпич", label: "сайдинг «под кирпич»", match: [/сайдинг\s*["«]?\s*под\s+кирпи/i] },
  { key: "штукатурка-планкен", label: "штукатурка с планкеном", match: [new RegExp(`штукатурк${RU}*\\s*(?:\\+|с элементами из|с)\\s*планкен`, "i")] },
  { key: "профлист-планкен", label: "профлист с планкеном", match: [/профлист\s*\+?\s*планкен/i] },
  { key: "кирпич", label: "кирпич", match: [/кирпи+ч/i] },
  { key: "сайдинг", label: "сайдинг", match: [/сайдинг/i] },
  { key: "штукатурка", label: "штукатурка", match: [/штукатурк/i] },
  { key: "планкен", label: "планкен", match: [/планкен/i] },
];

const COLOURS = [
  { key: "белый", match: /цвет\s+бел/i },
  { key: "графит", match: /цвет\s+графит/i },
  { key: "серый", match: /цвет\s+сер/i },
];

function num(v, fallback = 0) {
  const raw = v && typeof v === "object" ? str(v) : v;
  const n = typeof raw === "string" ? Number(raw.replace(/\s/g, "").replace(",", ".")) : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Значение ячейки в виде строки.
 *
 * Excel отдаёт не только строки: у ячейки со ссылкой значение — объект
 * {text, hyperlink}, у форматированного текста — {richText:[…]}, у формулы —
 * {result}. Без разворачивания кадастровый номер (а он в выгрузке ссылается на
 * публичную карту) превращается в «[object Object]» и перестаёт быть ключом,
 * по которому каталог сходится с прошлой выгрузкой.
 */
function str(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p2) => p2.text).join("").trim();
    if (v.text != null) return String(v.text).trim();
    if (v.result != null) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v).trim();
}

/**
 * Разбор описания из 1С на смысл.
 *
 * Не «почистить строку», а понять, что в ней сказано. Опечатки при этом
 * перестают быть отдельными вариантами: «кирпиич» и «кирпич» дают один ключ.
 */
function parseDescription(raw) {
  const text = str(raw).replace(/\s+/g, " ");
  const cladding = CLADDINGS.find((c) => c.match.some((re) => re.test(text)));
  const colour = COLOURS.find((c) => c.match.test(text));
  // «отделокой» и «предчистовой» — одно и то же намерение.
  const finish = new RegExp(`чистов${RU}*\\s+отдел`, "i").test(text)
    // Форма хранится сразу в том падеже, в котором встанет в предложение
    // «с … отделкой»: иначе получается «с предчистовая отделкой».
    ? /предчистов/i.test(text) ? "предчистовой" : "чистовой"
    : "";
  const notes = [];
  if (new RegExp(`договор${RU}*\\s+подряд`, "i").test(text)) notes.push("Строим по договору подряда.");
  const due = new RegExp(`планируем${RU}*\\s+дат${RU}*\\s+сдачи\\s*([\\d.]+)`, "i").exec(text);
  if (due) notes.push(`Планируемая дата сдачи ${due[1]}.`);
  return {
    modular: /модульн/i.test(text),
    material: /газоблок/i.test(text) ? "газоблок" : "",
    finish,
    cladding: cladding ? cladding.key : "",
    claddingLabel: cladding ? cladding.label : "",
    colour: colour ? colour.key : "",
    notes,
    raw: text,
  };
}

/**
 * Короткое описание для карточки — собранное заново, а не подрезанное.
 *
 * Метраж из него убирается сознательно: он уже есть отдельным полем и в
 * категории, а в тексте создаёт третье место, где то же число может разойтись
 * с остальными (в выгрузке такие расхождения есть — у дома 85 м² описание
 * начинается со «Дом 100 м2»).
 */
function shortDescription(parsed) {
  const parts = [];
  const base = parsed.modular ? "Модульный дом" : "Дом";
  const material = parsed.material ? ` из ${parsed.material === "газоблок" ? "газоблока" : parsed.material}` : "";
  const finish = parsed.finish ? ` с ${parsed.finish} отделкой` : "";
  parts.push(`${base}${material}${finish}.`);
  if (parsed.claddingLabel) parts.push(`Внешняя облицовка ${parsed.claddingLabel}.`);
  if (parsed.colour) parts.push(`Цвет ${parsed.colour}.`);
  parts.push(...parsed.notes);
  return parts.join(" ");
}

// ---------- чтение выгрузки 1С ----------

/**
 * Поиск колонки по смыслу: заголовки листов пишут люди, и порядок колонок
 * между выгрузками меняется.
 *
 * Точное совпадение проверяется раньше вхождения — иначе «номер» находит
 * «кадастровый номер», и номер дома по всему каталогу оказывается кадастровым.
 */
function columnIndex(header, ...names) {
  const clean = header.map((h) => str(h).toLowerCase());
  for (const name of names) {
    const exact = clean.findIndex((h) => h === name);
    if (exact >= 0) return exact;
  }
  for (const name of names) {
    const starts = clean.findIndex((h) => h.startsWith(name));
    if (starts >= 0) return starts;
  }
  for (const name of names) {
    const inside = clean.findIndex((h) => h.includes(name));
    if (inside >= 0) return inside;
  }
  return -1;
}

/** Расширения, по которым ссылка считается картинкой. */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|heic)(\?|$)/i;

/**
 * Выгрузка 1С: два листа, дома и участки.
 *
 * Фото лежат гиперссылками на ячейках «фото 0», «фото 1» — сам текст ячейки
 * бесполезен, нужна ссылка. Поэтому лист читается вместе со ссылками.
 */
// Разобранная выгрузка, пока файл не изменился. Разбор книги — самая дорогая
// часть сборки, а пересобирают каталог по многу раз подряд: правят имя посёлка,
// добавляют заготовку, смотрят, что получилось. Перечитывать книгу на каждый
// такой шаг незачем.
const exportCache = new Map();

async function readExport(filePath) {
  let key = "";
  try {
    const stat = await fs.stat(filePath);
    key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
    const hit = exportCache.get(key);
    if (hit) return hit;
  } catch {
    // Файла нет — пусть об этом скажет сам разбор ниже, понятной ошибкой.
  }
  const parsed = await parseExport(filePath);
  if (key) {
    exportCache.clear();
    exportCache.set(key, parsed);
  }
  return parsed;
}

async function parseExport(filePath) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const readSheet = (sheet, kind) => {
    if (!sheet) return [];
    const header = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (header[col - 1] = str(cell.value)));
    const col = {
      status: columnIndex(header, "статус"),
      readiness: columnIndex(header, "готовность"),
      cadastral: columnIndex(header, "кадастровый номер", "кадастр"),
      village: columnIndex(header, "поселок", "посёлок"),
      street: columnIndex(header, "улица"),
      // «номер» ищется точным совпадением: рядом стоит «кадастровый номер».
      house: columnIndex(header, "номер", "№", "дом"),
      plotArea: columnIndex(header, "площадь участка"),
      houseArea: columnIndex(header, "площадь дома"),
      price: columnIndex(header, "цена"),
      description: columnIndex(header, "описание"),
      link: columnIndex(header, "ссылка"),
    };
    const items = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const value = (idx) => (idx >= 0 ? row.getCell(idx + 1).value : null);
      const cadastral = str(value(col.cadastral));
      if (!cadastral) return;
      // Фото — только там, где на ячейке есть ссылка: текст «фото 0» сам по
      // себе ничего не значит.
      // Ссылки есть не только у фотографий: кадастровый номер ведёт на публичную
      // карту Росреестра, а адрес карточки — на сайт. Поэтому фото опознаются по
      // подписи ячейки («фото 0», «фото 1» — так их и называет 1С) или по
      // расширению картинки, а не по факту наличия ссылки.
      const photos = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const target = cell.hyperlink || (cell.value && cell.value.hyperlink);
        if (typeof target !== "string" || !/^https?:\/\//i.test(target)) return;
        const caption = str(cell.text || (cell.value && cell.value.text) || "");
        if (/^фото/i.test(caption) || IMAGE_EXT.test(target)) photos.push(target);
      });
      const link = str(value(col.link));
      items.push({
        kind,
        status: str(value(col.status)),
        readiness: kind === "house" ? str(value(col.readiness)) : "",
        cadastral,
        village: str(value(col.village)),
        street: str(value(col.street)),
        house: str(value(col.house)),
        plotArea: num(value(col.plotArea)),
        houseArea: kind === "house" ? num(value(col.houseArea)) : 0,
        price: num(value(col.price)),
        description: str(value(col.description)),
        link,
        // Ссылка на карточку тоже приходит гиперссылкой и попадает в фото —
        // убираем её оттуда, иначе страница уедет в каталог как картинка.
        photos: photos.filter((u) => u !== link),
      });
    });
    return items;
  };

  const houses = readSheet(
    wb.worksheets.find((w) => /дом/i.test(w.name)),
    "house"
  );
  const plots = readSheet(
    wb.worksheets.find((w) => /участ/i.test(w.name)),
    "plot"
  );
  return { houses, plots };
}

// ---------- сборка каталога ----------

/** Число соток и метража — так, как их пишет каталог: запятая и два знака. */
function decimal(value) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

/** Цена в подписи: «7 515 000 ₽». */
function money(value) {
  return Math.round(num(value)).toLocaleString("ru-RU").replace(/\u00a0/g, " ") + " ₽";
}

/**
 * SEO по каждой позиции — по шаблону, а не «когда руки дойдут».
 *
 * Именно этого поля в ручной работе не хватает чаще всего: заголовок и описание
 * пишут, а SEO оставляют пустым, и позиция не находится поиском вовсе.
 */
function buildSeo(item, villageName, cladding) {
  if (item.kind === "plot") {
    const area = decimal(item.plotArea);
    return {
      title: `Участок ${area} сот. — ${villageName}, Пермь | ${money(item.price)}`,
      descr:
        `Купить участок ${area} соток в посёлке ${villageName} под Пермью. ` +
        `${item.description ? item.description.replace(/\s+/g, " ").trim().replace(/\.?$/, ".") + " " : ""}` +
        `Цена ${money(item.price)}.`,
      keywords: [
        `купить участок ${area} соток пермь`,
        "участок под ижс пермь",
        `коттеджный посёлок ${villageName.toLowerCase()}`,
        "участок от застройщика пермь",
        "купить землю недалеко от перми",
        `${villageName.toLowerCase()} пермь участок`,
      ].join(", "),
    };
  }
  const area = Math.round(item.houseArea);
  const withCladding = cladding ? ` (${cladding})` : "";
  const readyWord =
    item.readiness === "готов" ? "готов к заселению" : item.readiness === "стройка" ? "строится" : "в проекте";
  return {
    title: `Дом ${area} м²${withCladding} — ${villageName}, Пермь | ${money(item.price)}`,
    descr:
      `Купить дом ${area} м² в посёлке ${villageName} под Пермью: ${readyWord}` +
      `${cladding ? ", отделка " + cladding : ""}, ипотека и эскроу. Цена ${money(item.price)}.`,
    keywords: [
      `купить дом ${area} м2 пермь`,
      "дом в перми с участком",
      `коттеджный посёлок ${villageName.toLowerCase()}`,
      "дом от застройщика пермь",
      "купить дом недалеко от перми",
      `${villageName.toLowerCase()} пермь дом`,
    ].join(", "),
  };
}

/**
 * Прошлый файл каталога: из него берутся номера позиций.
 *
 * У магазина свой идентификатор товара. Выгрузка без него заводит вторые
 * экземпляры вместо обновления существующих — и каталог удваивается с каждой
 * пересборкой. Поэтому прошлый файл читается ради двух колонок.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const body = String(text || "").replace(/^\ufeff/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ";") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function readPrevious(filePath) {
  const rows = parseCsv(await fs.readFile(filePath, "utf-8"));
  if (!rows.length) return { bySku: new Map(), villages: new Map() };
  const header = rows[0].map((h) => str(h));
  const at = (name) => header.indexOf(name);
  const bySku = new Map();
  // Заодно вытаскиваем, как посёлки названы в каталоге: имена в 1С и на витрине
  // расходятся («Новое Мокино» → «Мокино Хоум»), и вспоминать это руками при
  // каждой пересборке — лишний способ ошибиться.
  const villages = new Map();
  for (const row of rows.slice(1)) {
    const sku = str(row[at("SKU")]);
    if (!sku) continue;
    bySku.set(sku, {
      uid: str(row[at("Tilda UID")]),
      externalId: str(row[at("External ID")]),
      category: str(row[at("Category")]),
      title: str(row[at("Title")]),
      // Фото из прошлого каталога — уже загруженные в магазин адреса. Они
      // заведомо открываются на витрине, чего про ссылки из 1С сказать нельзя.
      photo: str(row[at("Photo")]),
    });
    const cat = str(row[at("Category")]);
    const m = /Поселки>>>([^;]+)/.exec(cat);
    if (m) villages.set(sku, m[1].trim());
  }
  return { bySku, villages };
}

/**
 * Сборка каталога.
 *
 * Библиотека описаний ищется по паре «площадь + облицовка»: одна заготовка
 * обслуживает все дома этой вариации, сколько бы их ни было в выгрузке.
 */
function buildCatalog({
  houses = [],
  plots = [],
  library = [],
  villages = {},
  streetNames = [],
  previous = null,
  photoMode = "all",
  photoSource = "tilda",
  carryIds = false,
}) {
  const problems = [];
  const rows = [];
  // Номера позиций магазина переносятся только при обновлении существующего
  // каталога. Если каталог на сайте удаляют и заливают заново, старые номера
  // указывают на удалённые товары — переносить их нельзя.
  const prevBySku = carryIds && previous ? previous.bySku : new Map();
  // А фото из прошлого каталога переносятся независимо от номеров: каталог
  // можно заливать заново (номера не нужны), но снимки, уже загруженные в
  // магазин, при этом терять незачем.
  const prevAny = previous ? previous.bySku : new Map();
  let photosFromPrevious = 0;

  /**
   * Фото позиции.
   *
   * Два источника, и они не равны. В прошлом каталоге лежат адреса файлов,
   * УЖЕ ЗАГРУЖЕННЫХ В МАГАЗИН, — они заведомо открываются на витрине. Из 1С
   * приходят ссылки на сторонний сайт: они могут работать, а могут и нет, и
   * проверить это отсюда нечем.
   *
   * Поэтому при совпадении по кадастровому номеру по умолчанию берутся фото из
   * Тильды, а выгрузка 1С и рендеры заготовки заполняют остальное. Порядок
   * переключается: `photoSource: "export"` ставит 1С первым.
   */
  const photosFor = (cadastral, own, fallback = []) => {
    const carried = str((prevAny.get(cadastral) || {}).photo)
      .split(/\s+/)
      .filter(Boolean);
    const order = photoSource === "export" ? [own, carried, fallback] : [carried, own, fallback];
    const chosen = order.find((list) => list && list.length) || [];
    if (chosen === carried && carried.length) photosFromPrevious += 1;
    return photoMode === "first" ? chosen.slice(0, 1) : chosen;
  };

  /**
   * Имя посёлка для витрины.
   *
   * Правило бывает не на посёлок целиком, а на улицу: в одном посёлке 1С
   * несколько кварталов с разными названиями на сайте, и весь посёлок под одним
   * именем — уже ошибка, которая сейчас в каталоге и есть.
   */
  const villageName = (item) => {
    const street = str(item.street);
    const rule = streetNames.find(
      (r) => str(r.village) === str(item.village) && str(r.street) === street && str(r.name)
    );
    if (rule) return str(rule.name);
    return str(villages[item.village]) || str(item.village);
  };

  /**
   * Название позиции. Улица или номер иногда не заполнены — тогда в названии не
   * должно оставаться висящих запятых вроде «КРП, , 5».
   */
  const titleOf = (item, village) => {
    const parts = [village, str(item.street), str(item.house)].filter(Boolean);
    if (parts.length === 1) return `${village}, ${item.kind === "plot" ? "участок" : "дом"} ${item.cadastral}`;
    return parts.join(", ");
  };

  /**
   * Подбор заготовки описания.
   *
   * Облицовку берём из самой выгрузки — она написана в описании 1С, — и ищем
   * заготовку лесенкой, от точной к общей. Если ничего не подошло, описание
   * остаётся ПУСТЫМ: подставить туда чужой текст было бы хуже, чем не
   * подставить ничего, — на витрине оказался бы кирпич вместо сайдинга.
   *
   * Заготовка без метража и без облицовки не подходит никогда: она подошла бы
   * ко всему подряд и молча разошлась бы по всему каталогу.
   */
  const findDescription = (item, parsed) => {
    const area = Math.round(item.houseArea);
    const sameArea = (d) => Math.round(num(d.area)) === area && area > 0;
    const sameCladding = (d) => d.cladding && d.cladding === parsed.cladding;
    return (
      library.find((d) => sameArea(d) && sameCladding(d)) ||
      library.find((d) => sameArea(d) && !d.cladding) ||
      library.find((d) => sameCladding(d) && !num(d.area)) ||
      null
    );
  };
  let matched = 0;

  const sortedHouses = [...houses].sort((a, b) => {
    const ra = READINESS_ORDER.indexOf(a.readiness);
    const rb = READINESS_ORDER.indexOf(b.readiness);
    // Готовые первыми: их можно купить сегодня. Неизвестная готовность — в конец,
    // а не в начало по случайности сортировки.
    const oa = ra < 0 ? READINESS_ORDER.length : ra;
    const ob = rb < 0 ? READINESS_ORDER.length : rb;
    if (oa !== ob) return oa - ob;
    if (a.village !== b.village) return a.village.localeCompare(b.village, "ru");
    return b.houseArea - a.houseArea;
  });

  for (const item of sortedHouses) {
    const parsed = parseDescription(item.description);
    const village = villageName(item);
    const area = Math.round(item.houseArea);
    const prev = prevBySku.get(item.cadastral);
    const doc = findDescription(item, parsed);

    if (!item.houseArea) {
      problems.push(`«${village}, ${item.street}, ${item.house}» — в выгрузке не заполнена площадь дома. Категория и SEO получатся неверными.`);
    }
    if (!item.price) problems.push(`«${village}, ${item.street}, ${item.house}» — нет цены.`);
    if (!parsed.cladding) {
      problems.push(`«${village}, ${item.street}, ${item.house}» — по описанию не понять облицовку, описание из библиотеки не подобрано.`);
    } else if (!doc) {
      // Одна строка на вариацию, а не на каждый дом: иначе семнадцать
      // одинаковых замечаний вытеснят всё остальное.
      const note = `Нет заготовки описания: дом ${area} м², облицовка ${parsed.claddingLabel}. Добавьте её в библиотеку.`;
      if (!problems.includes(note)) problems.push(note);
    }

    if (doc && doc.text) matched += 1;
    const photos = photosFor(item.cadastral, item.photos, doc?.renderUrls || []);
    if (!photos.length) {
      problems.push(`«${village}, ${item.street}, ${item.house}» — нет ни одного фото ни в выгрузке, ни в прошлом каталоге, ни в заготовке.`);
    }
    const seo = buildSeo(item, village, parsed.claddingLabel);

    rows.push({
      "Tilda UID": prev?.uid || "",
      Brand: "",
      SKU: item.cadastral,
      Mark: item.readiness,
      Category: `Метраж дома>>>дом ${area} м2;Поселки>>>${village}`,
      Title: titleOf(item, village),
      Description: shortDescription(parsed),
      Text: doc?.text || "",
      Photo: photos.join(" "),
      Price: num(item.price).toFixed(2),
      Quantity: "",
      "Price Old": "",
      Editions: "",
      Modifications: "",
      "External ID": prev?.externalId || "",
      "Parent UID": "",
      "Characteristics:площадь дома": area ? String(area) : "",
      "Characteristics:Площадь участка": decimal(item.plotArea),
      Weight: "0",
      Length: "0",
      Width: "0",
      Height: "0",
      "SEO title": seo.title,
      "SEO descr": seo.descr,
      "SEO keywords": seo.keywords,
      "FB title": "",
      "FB descr": "",
    });
  }

  for (const item of [...plots].sort((a, b) => a.village.localeCompare(b.village, "ru"))) {
    const village = villageName(item);
    const prev = prevBySku.get(item.cadastral);
    if (!item.price) problems.push(`Участок «${village}, ${item.street}, ${item.house}» — нет цены.`);
    const seo = buildSeo(item, village, "");
    const note = item.description ? str(item.description).replace(/\.?$/, ".") : "";
    rows.push({
      "Tilda UID": prev?.uid || "",
      Brand: "",
      SKU: item.cadastral,
      Mark: "",
      Category: `Земельные участки;Поселки>>>${village}`,
      Title: titleOf(item, village),
      Description: item.description,
      Text: `Площадь участка: ${decimal(item.plotArea)} соток. Кадастровый номер: ${item.cadastral}.${note ? " " + note : ""}`,
      Photo: photosFor(item.cadastral, item.photos).join(" "),
      Price: num(item.price).toFixed(2),
      Quantity: "",
      "Price Old": "",
      Editions: "",
      Modifications: "",
      "External ID": prev?.externalId || "",
      "Parent UID": "",
      "Characteristics:площадь дома": "",
      "Characteristics:Площадь участка": decimal(item.plotArea),
      Weight: "0",
      Length: "0",
      Width: "0",
      Height: "0",
      "SEO title": seo.title,
      "SEO descr": seo.descr,
      "SEO keywords": seo.keywords,
      "FB title": "",
      "FB descr": "",
    });
  }

  // Посёлки, для которых витринное имя не задано: в каталог уедет внутреннее
  // название из 1С, и покупатель увидит служебное сокращение вроде «КРП».
  const unnamed = new Set();
  for (const item of [...houses, ...plots]) {
    const shown = villageName(item);
    if (shown === str(item.village) && !str(villages[item.village])) unnamed.add(str(item.village));
  }
  for (const name of unnamed) {
    problems.push(
      `Посёлок «${name}» уйдёт в каталог под этим же именем — витринное не задано. ` +
        `Если это внутреннее название, покупатель увидит его на сайте.`
    );
  }

  // Позиции, которые были в каталоге, а из выгрузки пропали: скорее всего
  // проданы. Молчать нельзя — иначе они останутся висеть на витрине.
  const nowSkus = new Set(rows.map((r) => r.SKU));
  const gone = [...(previous?.bySku.keys() || [])].filter((sku) => !nowSkus.has(sku));
  if (gone.length) {
    problems.push(
      `В прошлом каталоге были и пропали из выгрузки: ${gone.length} позиц. — вероятно, проданы. ` +
        `В новом файле их нет, но на витрине они останутся, пока не убрать их вручную.`
    );
  }

  return {
    rows,
    problems,
    counts: {
      houses: sortedHouses.length,
      plots: plots.length,
      gone: gone.length,
      described: matched,
      // Сколько позиций взяли фото из прошлого каталога: без этого числа
      // непонятно, сработало совпадение по кадастровому или нет.
      photosCarried: photosFromPrevious,
    },
  };
}

/** Файл в том виде, в каком его ждёт магазин: точка с запятой и кавычки. */
function toCsv(rows) {
  const escape = (v) => {
    const s2 = v == null ? "" : String(v);
    return /[";\n]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2;
  };
  const lines = [TILDA_COLUMNS.join(";")];
  for (const row of rows) lines.push(TILDA_COLUMNS.map((c) => escape(row[c])).join(";"));
  return lines.join("\n");
}

// ---------- библиотека описаний ----------
//
// Заготовка описывает ВАРИАЦИЮ, а не конкретный дом: «дом 100 м² с облицовкой
// кирпич». Одна заготовка обслуживает все такие дома в выгрузке, сколько бы их
// ни было — в этой их семнадцать.
//
// Текст описания лежит файлом на компьютере и читается при каждой сборке: так
// правка в исходном файле сама попадает в следующий каталог, а приложение не
// становится ещё одним местом, где живёт та же самая копия.

function libraryFile(root) {
  return path.join(root, "catalog", "library.json");
}

/**
 * Заготовка всегда приходит с полным набором полей.
 *
 * Форма приводится здесь, на границе чтения, а не проверяется в каждом месте,
 * где заготовку показывают: файл на диске мог быть записан прежней версией или
 * поправлен руками, и одно отсутствующее поле роняло весь раздел.
 */
function normalizeLibraryItem(raw = {}) {
  return {
    id: str(raw.id) || "d" + Math.random().toString(36).slice(2, 8),
    name: str(raw.name),
    area: num(raw.area),
    cladding: str(raw.cladding),
    textPath: str(raw.textPath),
    text: str(raw.text),
    renderUrls: (Array.isArray(raw.renderUrls) ? raw.renderUrls : []).map((u) => str(u)).filter(Boolean),
    renderPaths: (Array.isArray(raw.renderPaths) ? raw.renderPaths : []).map((u) => str(u)).filter(Boolean),
  };
}

async function readLibrary(root) {
  try {
    const data = JSON.parse(await fs.readFile(libraryFile(root), "utf-8"));
    return Array.isArray(data) ? data.map(normalizeLibraryItem) : [];
  } catch {
    return [];
  }
}

async function writeLibrary(root, items) {
  await fs.mkdir(path.dirname(libraryFile(root)), { recursive: true });
  const clean = (Array.isArray(items) ? items : []).map(normalizeLibraryItem);
  await fs.writeFile(libraryFile(root), JSON.stringify(clean, null, 2), "utf-8");
  return clean;
}

/**
 * Текст заготовки читается с диска при сборке.
 *
 * Форматы простые: обычный текст и Markdown. Word сюда тоже приходит — его
 * читает общий извлекатель текста приложения, он передаётся снаружи.
 */
async function loadLibraryTexts(items, extractText) {
  const loaded = [];
  for (const item of items) {
    let text = str(item.text);
    let error = "";
    if (item.textPath) {
      try {
        const ext = path.extname(item.textPath).toLowerCase();
        text =
          ext === ".txt" || ext === ".md"
            ? await fs.readFile(item.textPath, "utf-8")
            : await extractText(item.textPath);
      } catch (e) {
        error = `Не прочитан файл описания «${path.basename(item.textPath)}»: ${e.message}`;
      }
    }
    // Разбивка на абзацы сохраняется как есть: описание дома — не одна строка,
    // и склеенное в сплошной кусок оно на витрине не читается. Убираются только
    // пустые края и лишние переводы строк подряд.
    const kept = String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    loaded.push({ ...item, text: kept, error });
  }
  return loaded;
}

// ---------- ручные правки ----------
//
// Собранная таблица — заготовка, а не приговор. Любую ячейку человек правит
// руками до выгрузки, и правки переживают пересборку: ключ — кадастровый номер
// плюс колонка, а не номер строки. Иначе новая выгрузка из 1С, где порядок
// позиций другой, разнесла бы все правки по чужим домам.

function editsFile(root) {
  return path.join(root, "catalog", "edits.json");
}

async function readEdits(root) {
  try {
    const data = JSON.parse(await fs.readFile(editsFile(root), "utf-8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeEdits(root, edits) {
  await fs.mkdir(path.dirname(editsFile(root)), { recursive: true });
  await fs.writeFile(editsFile(root), JSON.stringify(edits, null, 1), "utf-8");
  return edits;
}

/** Наложение правок на собранные строки. Возвращает и сами строки, и что тронуто. */
function applyEdits(rows, edits = {}) {
  const touched = [];
  const out = rows.map((row) => {
    const patch = edits[row.SKU];
    if (!patch) return row;
    const next = { ...row };
    for (const [column, value] of Object.entries(patch)) {
      if (!TILDA_COLUMNS.includes(column)) continue;
      next[column] = value;
      touched.push({ sku: row.SKU, column });
    }
    return next;
  });
  // Правки к позициям, которых в новой выгрузке уже нет: молча копиться им
  // незачем, но и стирать чужой труд без спроса нельзя — просто скажем.
  const known = new Set(rows.map((r) => r.SKU));
  const orphaned = Object.keys(edits).filter((sku) => !known.has(sku));
  return { rows: out, touched, orphaned };
}

// ---------- выгрузка в Excel ----------

/**
 * Тот же каталог книгой Excel.
 *
 * Магазин принимает CSV, а Excel нужен человеку: посмотреть глазами, показать
 * коллеге, поправить в привычном месте. Поэтому книга не «тоже файл», а
 * читаемая таблица: закреплённая шапка, ширины по содержимому, перенос строк в
 * длинных описаниях.
 */
async function toXlsx(rows, destPath) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Каталог");
  sheet.columns = TILDA_COLUMNS.map((name) => ({
    header: name,
    key: name,
    width: name === "Text" ? 60 : name === "Description" || name.startsWith("SEO") ? 40 : name === "Photo" ? 44 : 18,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of rows) {
    const added = sheet.addRow(row);
    added.alignment = { vertical: "top", wrapText: true };
  }
  await wb.xlsx.writeFile(destPath);
  return destPath;
}

/** Понятное имя заготовки для списка: «дом 100 м² · кирпич». */
function describeLibraryItem(item) {
  const named = str(item.name);
  if (named) return named;
  const cladding = CLADDINGS.find((c) => c.key === item.cladding);
  const area = Math.round(num(item.area));
  return `дом ${area || "?"} м²${cladding ? " · " + cladding.label : ""}`;
}

/**
 * Сколько домов из выгрузки подходит каждой заготовке.
 *
 * Считается тем же правилом, что и подстановка, — иначе число врало бы. Нужно,
 * чтобы промах по паре «метраж + облицовка» был виден сразу: «подходит к 0
 * домов» объясняет пустое описание лучше любого сообщения об ошибке.
 */
function countMatches(houses = [], library = []) {
  const counts = {};
  for (const item of library) counts[item.id] = 0;
  for (const house of houses) {
    const parsed = parseDescription(house.description);
    const area = Math.round(house.houseArea);
    const sameArea = (d) => Math.round(num(d.area)) === area && area > 0;
    const sameCladding = (d) => d.cladding && d.cladding === parsed.cladding;
    const hit =
      library.find((d) => sameArea(d) && sameCladding(d)) ||
      library.find((d) => sameArea(d) && !d.cladding) ||
      library.find((d) => sameCladding(d) && !num(d.area)) ||
      null;
    if (hit) counts[hit.id] = (counts[hit.id] || 0) + 1;
  }
  return counts;
}

/** Вариации домов в выгрузке: подо что вообще нужны заготовки. */
function listVariants(houses = []) {
  const map = new Map();
  for (const house of houses) {
    const parsed = parseDescription(house.description);
    const area = Math.round(house.houseArea);
    const key = `${area}|${parsed.cladding}`;
    const found = map.get(key);
    if (found) found.count += 1;
    else
      map.set(key, {
        area,
        cladding: parsed.cladding,
        claddingLabel: parsed.claddingLabel,
        count: 1,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

module.exports = {
  TILDA_COLUMNS,
  READINESS_ORDER,
  CLADDINGS,
  parseDescription,
  shortDescription,
  readExport,
  decimal,
  money,
  buildSeo,
  parseCsv,
  readPrevious,
  buildCatalog,
  toCsv,
  normalizeLibraryItem,
  readLibrary,
  writeLibrary,
  loadLibraryTexts,
  readEdits,
  writeEdits,
  applyEdits,
  toXlsx,
  describeLibraryItem,
  countMatches,
  listVariants,
};
