// Каталог: пересборка выгрузки 1С в файл для магазина Тильды.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-catalog.cjs
//
// Данные здесь ВЫДУМАННЫЕ, но форма — точно как в настоящей выгрузке, включая
// её неровности: опечатки в описаниях, метраж, не совпадающий с текстом, нули
// вместо площади, ссылка на публичную карту в ячейке кадастрового номера.
// Настоящие адреса, цены и кадастровые номера в репозиторий не попадают.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cat-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cat-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "cat-work-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", model: "m", temperature: 0.7, maxTokens: 4000, proxyMode: "direct", searchEnabled: false })
);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const catalog = require("./catalog.cjs");
const { finish } = require("./smoke-finish.cjs");

/** Выгрузка той же формы, что даёт 1С, — со всеми её неровностями. */
async function makeExport(dest) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();

  const houses = wb.addWorksheet("Дома в продаже");
  houses.addRow(["статус", "готовность", "кадастровый номер", "поселок", "улица", "номер",
    "площадь участка, сот", "площадь дома", "цена дома с участком", "описание", "ссылка"]);
  const rows = [
    ["в продаже", "план", "00:00:0000001:1001", "Ромашкино", "Луговая", "3", 6.5, 100,
     7100000, "Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка кирпиич."],
    ["в продаже", "готов", "00:00:0000001:1002", "Ромашкино", "Луговая", "5", 8.0, 85,
     9100000, "Дом 85 м2 из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг. Цвет белый."],
    ["в продаже", "стройка", "00:00:0000002:2001", "Сосновка", "Боровая", "7", 7.25, 100,
     8200000, "Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг \"под кирпич\"."],
    ["в продаже", "готов", "00:00:0000002:2002", "Сосновка", "Боровая", "9", 9.0, 120,
     10500000, "Дом с предчистовой отделкой из газоблока 120 м2. Внешняя облицовка кирпич. Внешняя облицовка кирпич."],
    // Неровность из жизни: площадь не заполнена, а в тексте метраж есть.
    ["в продаже", "план", "00:00:0000002:2003", "Сосновка", "Боровая", "11", 0, 0,
     8300000, "Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг."],
    // Два квартала в одном посёлке 1С: на витрине у них разные имена.
    ["в продаже", "план", "00:00:0000004:4001", "ПКР", "Нефритовая", "2", 6.0, 100,
     7700000, "Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка кирпич."],
    ["в продаже", "план", "00:00:0000004:4002", "ПКР", "Перламутровая", "5", 6.0, 100,
     7800000, "Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка кирпич."],
  ];
  for (const r of rows) {
    const row = houses.addRow(r);
    // Кадастровый номер в настоящей выгрузке — ссылка на публичную карту.
    row.getCell(3).value = { text: r[2], hyperlink: "https://pkk.rosreestr.ru/" };
    if (r[2] !== "00:00:0000002:2003") {
      row.getCell(12).value = { text: "фото 0", hyperlink: `https://example.test/${r[2].slice(-4)}/1.png` };
      row.getCell(13).value = { text: "фото 1", hyperlink: `https://example.test/${r[2].slice(-4)}/2.png` };
    }
  }

  const plots = wb.addWorksheet("Участки в продаже");
  plots.addRow(["статус", "кадастровый номер", "поселок", "улица", "номер",
    "площадь участка, сот", "цена участка", "описание"]);
  const plotRows = [
    ["в продаже", "00:00:0000003:3001", "Ромашкино", "Полевая", "2", 8.58, 343200, "ИЖС, дороги, электричество"],
    ["в продаже", "00:00:0000003:3002", "Сосновка", "Полевая", "4", 6.0, 180000, "СНТ"],
    // Улица и номер не заполнены — в названии не должно остаться висящих запятых.
    ["в продаже", "00:00:0000003:3003", "ПКР", "", "", 7.0, 210000, "СНТ"],
  ];
  for (const r of plotRows) {
    const row = plots.addRow(r);
    row.getCell(2).value = { text: r[1], hyperlink: "https://pkk.rosreestr.ru/" };
    row.getCell(9).value = { text: "фото 0", hyperlink: `https://example.test/${r[1].slice(-4)}/1.jpeg` };
  }
  await wb.xlsx.writeFile(dest);
  return dest;
}

/**
 * Прошлый файл каталога: номера позиций и имена посёлков на витрине.
 *
 * Пишется тем же toCsv, что и продукт, а не сборкой строки через join(";").
 * Первая версия этого теста собирала строку руками — и точка с запятой внутри
 * категории («…дом 100 м2;Поселки>>>…») разорвала строку на две, после чего
 * половина проверок падала на ровном месте. Настоящая выгрузка магазина такие
 * поля кавычит; тест обязан вести себя так же.
 */
function makePrevious(dest) {
  const body = catalog.toCsv([
    { "Tilda UID": "111111111111", SKU: "00:00:0000001:1001", "External ID": "AAA",
      Category: "Метраж дома>>>дом 100 м2;Поселки>>>Ромашки", Title: "Ромашкино, Луговая, 3",
      // Снимки, уже загруженные в магазин: у них адреса витрины, а не стороннего сайта.
      Photo: "https://static.tildacdn.com/stor1/дом-1001-a.png https://static.tildacdn.com/stor1/дом-1001-b.png" },
    { "Tilda UID": "222222222222", SKU: "00:00:0000003:3001", "External ID": "BBB",
      Category: "Земельные участки;Поселки>>>Ромашки", Title: "Ромашкино, Полевая, 2",
      Photo: "https://static.tildacdn.com/stor1/участок-3001.png" },
    // Позиция, которой в новой выгрузке уже нет — продана.
    { "Tilda UID": "333333333333", SKU: "00:00:0000009:9999", Category: "Земельные участки;Поселки>>>Ромашки" },
  ]);
  fs.writeFileSync(dest, "﻿" + body, "utf-8");
  return dest;
}

function cleanup() {
  for (const d of [userData, dataRoot, workDir]) fs.rmSync(d, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  try {
    console.log("разбор описаний из 1С");
    const cases = [
      ["Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка кирпиич.", "кирпич"],
      ["Дом 85 м2 из газоблока с предчистовой отделкой. Внешнаяя облицовка сайдинг.", "сайдинг"],
      ['Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг "под кирпич".', "сайдинг-под-кирпич"],
      ["Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя отделка комбинированная штукатурка + планкен.", "штукатурка-планкен"],
      ["Дом 100 м2 из газоблока с предчистовой отделкой. Внешняя облицовка штукатурка с элементами из планкена", "штукатурка-планкен"],
      ["Модульный дом 58 м2 с чистовой отделкой. Внешняя отделка комбинированная профлист + планкен.", "профлист-планкен"],
    ];
    for (const [text, expected] of cases) {
      const got = catalog.parseDescription(text).cladding;
      check(`облицовка «${expected}» опознана`, got === expected, `получено «${got}»`);
    }
    // Составной вариант не должен опознаваться как одиночный: иначе дом получит
    // чужое описание и чужие рендеры.
    check(
      "«сайдинг под кирпич» — не кирпич и не сайдинг",
      catalog.parseDescription('Внешняя облицовка сайдинг "под кирпич".').cladding === "сайдинг-под-кирпич"
    );

    console.log("\nодин вид описания из пяти формулировок");
    const same = [
      "Дом 85 м2 из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг.",
      "Дом из газоблока 85м2 с предчистовой отделкой. Внешняя облицовка сайдинг.",
      "Дом 85 м2 из газоблока с предчистовой отделокой. Внешняя облицовка сайдинг.",
      "Дом с предчистовой отделкой из газоблока 85 м2. Внешняя облицовка сайдинг.  Внешняя облицовка сайдинг.",
    ].map((t) => catalog.shortDescription(catalog.parseDescription(t)));
    check("разные формулировки дают одну строку", new Set(same).size === 1, JSON.stringify([...new Set(same)]));
    check("и она правильная", same[0] === "Дом из газоблока с предчистовой отделкой. Внешняя облицовка сайдинг.", same[0]);
    check("метраж из описания убран", !/\d+\s*м2/i.test(same[0]), same[0]);
    check("падеж не поехал", !/предчистовая отделкой/.test(same[0]), same[0]);
    check("примечание про подряд сохранено",
      /Строим по договору подряда\./.test(
        catalog.shortDescription(catalog.parseDescription("Дом 60 м2 из газоблока. Внешняя отделка сайдинг. Строим по договору подряда"))
      ));

    console.log("\nчтение выгрузки");
    const exportPath = await makeExport(path.join(workDir, "выгрузка.xlsx"));
    const source = await catalog.readExport(exportPath);
    check("дома и участки прочитаны", source.houses.length === 7 && source.plots.length === 3,
      `${source.houses.length}/${source.plots.length}`);
    const first = source.houses[0];
    check("кадастровый номер — строка, а не объект", first.cadastral === "00:00:0000001:1001", first.cadastral);
    check("номер дома не подменён кадастровым", first.house === "3", first.house);
    // Ссылка на публичную карту не картинка и в каталог попасть не должна.
    check("ссылка на карту Росреестра не попала в фото",
      !source.houses.some((h) => h.photos.some((u) => /rosreestr/.test(u))),
      JSON.stringify(first.photos));
    check("фото собраны", first.photos.length === 2, JSON.stringify(first.photos));

    console.log("\nсборка каталога");
    const previousPath = makePrevious(path.join(workDir, "прошлый.csv"));
    const previous = await catalog.readPrevious(previousPath);
    const villages = {};
    for (const item of [...source.houses, ...source.plots]) {
      const name = previous.villages.get(item.cadastral);
      if (name) villages[item.village] = name;
    }
    check("имена посёлков взяты из прошлого каталога", villages["Ромашкино"] === "Ромашки", JSON.stringify(villages));

    const библиотека = [
      { id: "a", area: 100, cladding: "кирпич", text: "Длинное описание дома 100 м² в кирпиче.", renderUrls: ["https://example.test/render/100k.png"] },
      { id: "b", area: 85, cladding: "сайдинг", text: "Длинное описание дома 85 м² в сайдинге." },
      { id: "c", area: 100, cladding: "сайдинг-под-кирпич", text: "Сайдинг под кирпич, 100 м²." },
      { id: "d", area: 100, cladding: "", text: "Общее описание на 100 м²." },
    ];
    const streetNames = [{ village: "ПКР", street: "Нефритовая", name: "Самоцветы" }];
    const built = catalog.buildCatalog({
      ...source, library: библиотека, villages, streetNames, previous, photoMode: "all", carryIds: true,
    });
    check("собраны все позиции", built.rows.length === 10, String(built.rows.length));

    // Готовые дома первыми — это и есть смысл сортировки.
    const marks = built.rows.map((r) => r.Mark);
    check("готовые дома идут первыми", marks[0] === "готов" && marks[1] === "готов", JSON.stringify(marks.slice(0, 4)));
    check("стройка после готовых", marks[2] === "стройка", JSON.stringify(marks.slice(0, 5)));
    check("участки в конце", marks.slice(-3).every((m) => m === ""), JSON.stringify(marks));
    check("стадия попала в ярлык", built.rows.every((r) => r.Mark === "" || catalog.READINESS_ORDER.includes(r.Mark)));

    const дом = built.rows.find((r) => r.SKU === "00:00:0000001:1001");
    check("номер позиции магазина сохранён", дом["Tilda UID"] === "111111111111", дом["Tilda UID"]);
    check("внешний идентификатор сохранён", дом["External ID"] === "AAA", дом["External ID"]);
    check("посёлок переименован для витрины", /Поселки>>>Ромашки$/.test(дом.Category), дом.Category);
    check("категория несёт метраж", /дом 100 м2/.test(дом.Category), дом.Category);
    // Заголовок несёт имя посёлка ДЛЯ ВИТРИНЫ, а не внутреннее из 1С. В нынешнем
    // каталоге это разошлось: у части домов в названии стоит «КРП» — внутреннее
    // сокращение, которое покупатель видеть не должен, — при том что в категории
    // тот же посёлок называется «Самоцветы».
    check("заголовок несёт витринное имя посёлка", дом.Title === "Ромашки, Луговая, 3", дом.Title);
    check("описание из библиотеки подставлено", дом.Text === "Длинное описание дома 100 м² в кирпиче.", дом.Text);
    check("площадь участка с запятой", дом["Characteristics:Площадь участка"] === "6,50", дом["Characteristics:Площадь участка"]);
    // Этот дом есть и в прошлом каталоге, поэтому «все фото, а не одно»
    // проверяем на доме, которого в прошлом каталоге нет, — иначе проверка
    // молча переехала бы на другой источник.
    const безПрошлого = built.rows.find((r) => r.SKU === "00:00:0000001:1002");
    check("все фото из выгрузки прикреплены, а не одно",
      безПрошлого.Photo.split(" ").length === 2, безПрошлого.Photo);

    console.log("\nфото из прошлого каталога по кадастровому номеру");
    // Снимки в прошлом каталоге уже загружены в магазин: их адреса заведомо
    // открываются на витрине. Ссылки из 1С ведут на сторонний сайт — они могут
    // работать, а могут и нет, и проверить это отсюда нечем.
    check("у совпавшего дома фото взяты из каталога, а не из 1С",
      дом.Photo.split(" ").every((u) => u.includes("tildacdn")), дом.Photo);
    check("перенеслись все снимки позиции, а не первый",
      дом.Photo.split(" ").length === 2, дом.Photo);
    const участокСФото = built.rows.find((r) => r.SKU === "00:00:0000003:3001");
    check("перенос работает и для участков",
      участокСФото.Photo.includes("tildacdn"), участокСФото.Photo);
    check("сколько позиций взяли фото из каталога — посчитано",
      built.counts.photosCarried === 2, String(built.counts.photosCarried));
    check("там, где совпадения нет, остаются фото из 1С",
      безПрошлого.Photo.includes("example.test"), безПрошлого.Photo);

    // Перенос не должен зависеть от переноса номеров позиций: каталог можно
    // заливать заново (номера не нужны), но снимки при этом терять незачем.
    const заново = catalog.buildCatalog({
      ...source, library: библиотека, villages, streetNames, previous, photoMode: "all", carryIds: false,
    });
    const домЗаново = заново.rows.find((r) => r.SKU === "00:00:0000001:1001");
    check("фото переносятся и когда каталог заливается заново",
      домЗаново.Photo.includes("tildacdn") && !домЗаново["Tilda UID"],
      `${домЗаново.Photo} | uid «${домЗаново["Tilda UID"]}»`);

    // Обратный порядок: сначала 1С, каталог только там, где в выгрузке пусто.
    const из1С = catalog.buildCatalog({
      ...source, library: библиотека, villages, streetNames, previous,
      photoMode: "all", photoSource: "export", carryIds: true,
    });
    const дом1С = из1С.rows.find((r) => r.SKU === "00:00:0000001:1001");
    check("переключатель возвращает первенство выгрузке 1С",
      дом1С.Photo.includes("example.test") && !дом1С.Photo.includes("tildacdn"), дом1С.Photo);
    check("и тогда из каталога не переносится ничего лишнего",
      из1С.counts.photosCarried === 0, String(из1С.counts.photosCarried));

    // Только первое фото — при переносе тоже.
    const одно = catalog.buildCatalog({
      ...source, library: библиотека, villages, streetNames, previous, photoMode: "first", carryIds: true,
    });
    const домОдно = одно.rows.find((r) => r.SKU === "00:00:0000001:1001");
    check("«только первое фото» действует и на перенесённые",
      домОдно.Photo.includes("tildacdn") && !домОдно.Photo.includes(" "), домОдно.Photo);

    console.log("\nописания подставляются по облицовке из выгрузки");
    // Пять домов из семи: у дома 120 в кирпиче заготовки нет, у дома с
    // незаполненной площадью подобрать не по чему.
    check("подставлено ровно там, где заготовка есть", built.counts.described === 5,
      `${built.counts.described} из ${built.counts.houses}`);
    const кирпич100 = built.rows.find((r) => r.SKU === "00:00:0000001:1001");
    check("дом 100 в кирпиче получил своё описание",
      кирпич100.Text === "Длинное описание дома 100 м² в кирпиче.", кирпич100.Text);
    const сайдинг85 = built.rows.find((r) => r.SKU === "00:00:0000001:1002");
    check("дом 85 в сайдинге получил своё", сайдинг85.Text === "Длинное описание дома 85 м² в сайдинге.", сайдинг85.Text);
    // Главное правило: чужой текст не ставится. Дом 120 в кирпиче — заготовки на
    // него нет, и пусть лучше будет пусто, чем описание другого дома.
    const без = built.rows.find((r) => r.SKU === "00:00:0000002:2002");
    check("где заготовки нет — описание пустое", без.Text === "", `«${без.Text}»`);
    check("и об этом сказано в замечаниях",
      built.problems.some((p2) => /Нет заготовки описания: дом 120 м²/.test(p2)),
      JSON.stringify(built.problems.filter((p2) => /Нет заготовки/.test(p2))));
    // Одна строка на вариацию, а не на каждый дом.
    const повторы = built.problems.filter((p2) => /Нет заготовки описания/.test(p2));
    check("замечание о нехватке не повторяется по каждому дому",
      повторы.length === new Set(повторы).size, JSON.stringify(повторы));

    const лесенка = catalog.buildCatalog({
      houses: [{ kind: "house", village: "П", street: "У", house: "1", cadastral: "x1", houseArea: 60,
        plotArea: 5, price: 1e6, readiness: "план", description: "Дом 60 м2. Внешняя облицовка сайдинг.", photos: ["u"] }],
      plots: [], villages: { "П": "П" },
      library: [{ id: "l", area: 0, cladding: "сайдинг", text: "Сайдинг на любой метраж" }],
    });
    check("заготовка без метража подходит по облицовке",
      лесенка.rows[0].Text === "Сайдинг на любой метраж", лесенка.rows[0].Text);
    const слишкомОбщая = catalog.buildCatalog({
      houses: [{ kind: "house", village: "П", street: "У", house: "1", cadastral: "x2", houseArea: 60,
        plotArea: 5, price: 1e6, readiness: "план", description: "Дом 60 м2. Внешняя облицовка планкен.", photos: ["u"] }],
      plots: [], villages: { "П": "П" },
      library: [{ id: "l", area: 0, cladding: "", text: "ЭТО НЕ ДОЛЖНО ПОДСТАВЛЯТЬСЯ" }],
    });
    check("заготовка без метража и без облицовки не подходит никогда",
      слишкомОбщая.rows[0].Text === "", `«${слишкомОбщая.rows[0].Text}»`);

    console.log("\nкварталы: имя по улице");
    // Правило на улицу важнее правила на посёлок: в одном посёлке 1С бывает
    // несколько кварталов, и весь посёлок под одним именем — уже ошибка.
    const нефрит = built.rows.find((r) => r.SKU === "00:00:0000004:4001");
    const перламутр = built.rows.find((r) => r.SKU === "00:00:0000004:4002");
    check("улица с правилом получила своё имя", нефрит.Title === "Самоцветы, Нефритовая, 2", нефрит.Title);
    check("и оно же в категории", /Поселки>>>Самоцветы$/.test(нефрит.Category), нефрит.Category);
    check("соседняя улица правило не подхватила", перламутр.Title === "ПКР, Перламутровая, 5", перламутр.Title);
    check("имя посёлка в названии не задвоено", !/ПКР, Самоцветы/.test(нефрит.Title), нефрит.Title);
    const безУлицы = built.rows.find((r) => r.SKU === "00:00:0000003:3003");
    check("позиция без улицы не даёт висящих запятых",
      !/,\s*,/.test(безУлицы.Title) && безУлицы.Title.includes("участок"), безУлицы.Title);
    check("незаданное витринное имя замечено",
      built.problems.some((p2) => /Посёлок «ПКР»/.test(p2)), JSON.stringify(built.problems.slice(0, 3)));

    console.log("\nномера позиций переносятся только при обновлении");
    const свежий = catalog.buildCatalog({ ...source, library: библиотека, villages, streetNames, previous, carryIds: false });
    check("при заливке заново номера не переносятся",
      свежий.rows.every((r) => !r["Tilda UID"]), JSON.stringify(свежий.rows.filter((r) => r["Tilda UID"]).length));
    check("но пропавшие позиции всё равно замечены",
      свежий.problems.some((p2) => /вероятно, проданы/.test(p2)));

    console.log("\nSEO заполнено у каждой позиции");
    check("SEO title везде", built.rows.every((r) => r["SEO title"]));
    check("SEO descr везде", built.rows.every((r) => r["SEO descr"]));
    check("SEO keywords везде", built.rows.every((r) => r["SEO keywords"]));
    // В нынешнем каталоге SEO обещает «готов к заселению» и у домов в стадии
    // «план» — текст один раз написали и размножили. Здесь он обязан следовать
    // настоящей стадии.
    const план = built.rows.find((r) => r.Mark === "план");
    check("SEO не обещает готовность дому в проекте",
      !/готов к заселению/.test(план["SEO descr"]), план["SEO descr"]);
    const готов = built.rows.find((r) => r.Mark === "готов");
    check("а готовому — обещает", /готов к заселению/.test(готов["SEO descr"]), готов["SEO descr"]);
    check("цена в SEO по-человечески", /\d{1,3}( \d{3})+ ₽/.test(готов["SEO title"]), готов["SEO title"]);

    console.log("\nучастки");
    const участок = built.rows.find((r) => r.SKU === "00:00:0000003:3001");
    check("категория участка", участок.Category === "Земельные участки;Поселки>>>Ромашки", участок.Category);
    check("в тексте участка есть площадь и кадастровый",
      /Площадь участка: 8,58 соток\./.test(участок.Text) && участок.Text.includes("00:00:0000003:3001"), участок.Text);
    check("у участка нет метража дома", участок["Characteristics:площадь дома"] === "");

    console.log("\nзамечания вместо тишины");
    const p = built.problems.join(" | ");
    check("нулевая площадь замечена", /не заполнена площадь дома/.test(p), p.slice(0, 200));
    check("нехватка заготовки замечена", /Нет заготовки описания/.test(p), p.slice(0, 200));
    check("позиция без фото замечена", /нет ни одного фото/.test(p), p.slice(0, 200));
    check("пропавшая из выгрузки позиция замечена", /вероятно, проданы/.test(p), p.slice(0, 200));

    console.log("\nфайл для магазина");
    const csv = catalog.toCsv(built.rows);
    const back = catalog.parseCsv(csv);
    // Колонки ищем по имени: состав зависит от того, переносятся ли номера
    // позиций, и жёсткий номер колонки разъехался бы молча.
    const поле = (row, name) => row[back[0].indexOf(name)];
    check("номера позиций перенеслись — значит колонки-ключи на месте",
      back[0].join(";") === catalog.TILDA_COLUMNS.join(";"), back[0].slice(0, 5).join(";"));
    check("строк столько же", back.length === built.rows.length + 1, `${back.length - 1} из ${built.rows.length}`);
    // Точка с запятой внутри категории обязана пережить запись и чтение.
    const cat = back.find((r) => поле(r, "SKU") === "00:00:0000001:1001");
    check("точка с запятой внутри поля не разорвала строку",
      cat && поле(cat, "Category") === "Метраж дома>>>дом 100 м2;Поселки>>>Ромашки", cat && поле(cat, "Category"));
    const сКавычками = catalog.parseCsv(
      catalog.toCsv([{ ...built.rows[0], Text: 'он сказал "да"; и ушёл' }])
    );
    check("длинный текст с кавычками пережил запись",
      сКавычками[1][сКавычками[0].indexOf("Text")] === 'он сказал "да"; и ушёл',
      JSON.stringify(сКавычками[1][сКавычками[0].indexOf("Text")]));

    // Заливка заново: номеров позиций нет, и пустые колонки-ключи в файл не
    // попадают — иначе магазин выбирает пустую колонку уникальной и отвергает
    // каждую строку («Empty Uniq column: uid» на всех 186 позициях).
    const заново2 = catalog.buildCatalog({
      ...source, library: библиотека, villages, streetNames, previous, carryIds: false,
    });
    const шапкаЗаново = catalog.parseCsv(catalog.toCsv(заново2.rows))[0];
    check("при заливке заново пустых колонок-ключей в файле нет",
      !шапкаЗаново.includes("Tilda UID") && !шапкаЗаново.includes("External ID"),
      шапкаЗаново.slice(0, 3).join(";"));
    check("остальные колонки на месте и в прежнем порядке",
      шапкаЗаново.join(";") === catalog.TILDA_COLUMNS.filter((c2) => !catalog.ID_COLUMNS.includes(c2)).join(";"),
      шапкаЗаново.join(";").slice(0, 80));

    console.log("\nраздел в приложении");
    require("./main.cjs");
    let win;
    const deadline = Date.now() + 25000;
    while (!win && Date.now() < deadline) {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
      if (!win) await new Promise((r) => setTimeout(r, 120));
    }
    check("окно открылось", !!win);
    if (win) {
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      const call = (e) => win.webContents.executeJavaScript(e);
      await new Promise((r) => setTimeout(r, 1200));
      check("«Каталог» есть в меню",
        (await call(`[...document.querySelectorAll(".sidebar-item")].some(n => n.textContent.includes("Каталог"))`)) === true);
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Каталог")).click()`);
      await new Promise((r) => setTimeout(r, 600));
      check("раздел открывается", (await call(`!!document.querySelector(".vs-form")`)) === true);
      check("сказано, зачем нужен прошлый каталог",
        (await call(`document.body.textContent.includes("заведёт вторые экземпляры")`)) === true);
      check("сказано, что рендеры нужны ссылками",
        (await call(`document.body.textContent.includes("локальный путь на сайте превратится в пустое место")`)) === true);

      await call(`window.api.catalogSaveConfig(${JSON.stringify({
        exportPath, previousPath, outputDir: workDir, photoMode: "all", carryIds: false,
        streetNames: [{ village: "ПКР", street: "Нефритовая", name: "Самоцветы" }],
      })})`);
      // Вторая заготовка сознательно без renderUrls и renderPaths: файл на диске
      // мог быть записан прежней версией, и одно отсутствующее поле роняло весь
      // раздел. Форма приводится при чтении, а не проверяется в каждом месте.
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека)})`);
      const вычитано = await call(`window.api.catalogLibrary()`);
      check("неполная заготовка приводится к полной форме",
        вычитано.every((x) => Array.isArray(x.renderUrls) && Array.isArray(x.renderPaths)),
        JSON.stringify(вычитано.map((x) => Object.keys(x).length)));
      const preview = await call(`window.api.catalogPreview()`);
      check("предпросмотр собрался через приложение", preview.total === 10, String(preview.total));
      check("замечания дошли до окна", preview.problems.length > 0, String(preview.problems.length));
      check("готовые первыми и в предпросмотре", preview.sample[0].Mark === "готов", preview.sample[0].Mark);

      console.log("\nописание из ФАЙЛА по пути, а не из карточки");
      // Прежде библиотека в тесте хранила текст прямо в карточке, и путь к файлу
      // не проверялся вовсе — а человек указывает именно путь.
      const описанияDir = path.join(workDir, "описания");
      fs.mkdirSync(описанияDir, { recursive: true });
      const txtПуть = path.join(описанияDir, "дом 100 кирпич.txt");
      fs.writeFileSync(txtПуть, "Фундамент: монолитная плита.\n\nСтены: газобетон D400.\n", "utf-8");
      await call(`window.api.catalogSaveLibrary(${JSON.stringify([
        { id: "f1", name: "", area: 100, cladding: "кирпич", textPath: txtПуть, renderUrls: [], renderPaths: [] },
      ])})`);
      const сФайлом = await call(`window.api.catalogTable()`);
      const домИзФайла = сФайлом.rows.find((r) => r.SKU === "00:00:0000001:1001");
      check("описание подтянулось из файла по пути",
        /Фундамент: монолитная плита/.test(домИзФайла.Text), `«${домИзФайла.Text}»`);
      // Абзац из файла становится пустой строкой в разметке магазина: перевода
      // строки он не понимает, а <br /><br /> — понимает. Проверять здесь \n\n
      // было бы проверкой прежнего поведения, а не нужного.
      check("абзац из файла стал пустой строкой на витрине",
        /плита\.<br \/><br \/>Стены/.test(домИзФайла.Text), JSON.stringify(домИзФайла.Text));
      check("переводов строк в разметке не осталось",
        !/[\n\r]/.test(домИзФайла.Text), JSON.stringify(домИзФайла.Text));
      check("подставлено там, где облицовка совпала", сФайлом.counts.described >= 1,
        String(сФайлом.counts.described));
      // Битый путь не должен молчать.
      await call(`window.api.catalogSaveLibrary(${JSON.stringify([
        { id: "f2", area: 100, cladding: "кирпич", textPath: path.join(описанияDir, "нет-такого.txt"), renderUrls: [], renderPaths: [] },
      ])})`);
      const битый = await call(`window.api.catalogTable()`);
      check("нечитаемый файл описания попадает в замечания",
        битый.problems.some((p2) => /Не прочитан файл описания/.test(p2)),
        JSON.stringify(битый.problems.slice(0, 2)));
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека)})`);

      console.log("\nоформление описания доезжает до витрины");
      // Описания пишут в Word подзаголовками и списками, и ровно в таком виде
      // они должны оказаться на сайте. Раньше сюда доезжал сплошной текст, и
      // после каждой выгрузки описание переверстывали в магазине руками.
      const { Document, Packer, Paragraph, TextRun } = require("docx");
      const док = new Document({ sections: [{ children: [
        new Paragraph({ children: [new TextRun({ text: "Одноэтажный дом из газобетона.", bold: true })] }),
        new Paragraph({
          children: [new TextRun({ text: "Наружная отделка. ", bold: true }), new TextRun("Штукатурка с планкеном.")],
          bullet: { level: 0 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Планировка. ", bold: true }),
            new TextRun("Три спальни. Предусмотрен дополнительный канализационный выход."),
          ],
          bullet: { level: 0 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "Канализация. ", bold: true }), new TextRun("Септик — по посёлку.")],
          bullet: { level: 0 },
        }),
      ]}] });
      const docxПуть = path.join(описанияDir, "дом 100 кирпич.docx");
      fs.writeFileSync(docxПуть, await Packer.toBuffer(док));
      await call(`window.api.catalogSaveLibrary(${JSON.stringify([
        { id: "ф", name: "", area: 100, cladding: "кирпич", textPath: docxПуть, renderUrls: [], renderPaths: [] },
      ])})`);
      const сОформлением = await call(`window.api.catalogTable()`);
      const домОформ = сОформлением.rows.find((r) => r.SKU === "00:00:0000001:1001");
      check("полужирный подзаголовок сохранился",
        /<strong>Одноэтажный дом из газобетона\.<\/strong>/.test(домОформ.Text), домОформ.Text.slice(0, 120));
      check("список стал списком магазина",
        /<ul><li data-list="bullet">/.test(домОформ.Text), домОформ.Text.slice(0, 200));
      check("пунктов списка столько же, сколько в документе",
        (домОформ.Text.match(/<li data-list="bullet">/g) || []).length === 3,
        String((домОформ.Text.match(/<li data-list="bullet">/g) || []).length));
      check("чужих тегов в описании нет",
        !/<(?!\/?(?:strong|br|ul|li)\b)[a-zA-Z]/.test(домОформ.Text), домОформ.Text.slice(0, 200));
      // Разметка обязана пережить запись в файл и чтение обратно: иначе она
      // теряется ровно там, где её никто не проверяет.
      const csvСОформлением = catalog.toCsv([домОформ]);
      const назад = catalog.parseCsv(csvСОформлением);
      check("разметка пережила запись в файл и чтение",
        назад[1][назад[0].indexOf("Text")] === домОформ.Text,
        JSON.stringify(назад[1][назад[0].indexOf("Text")] || "").slice(0, 120));

      console.log("\nтип септика подставляется по посёлку");
      await call(`window.api.catalogSaveConfig(${JSON.stringify({
        septics: { Ромашкино: "Станция биологической очистки «Топас-5»." },
      })})`);
      const сСептиком = await call(`window.api.catalogTable()`);
      const домСептик = сСептиком.rows.find((r) => r.SKU === "00:00:0000001:1001");
      check("тип септика встал в пункт «Канализация»",
        /<strong>Канализация\. <\/strong>\s*Станция биологической очистки «Топас-5»\./.test(домСептик.Text),
        домСептик.Text.slice(-200));
      check("прежний текст про септик убран",
        !/по посёлку/.test(домСептик.Text), домСептик.Text.slice(-200));
      // Главная ловушка: в пункте «Планировка» тоже есть слово «канализационный».
      check("планировка не затронута",
        /дополнительный канализационный выход/.test(домСептик.Text), домСептик.Text.slice(0, 300));
      // Посёлок без заданного септика описание не меняет.
      const домДругогоПосёлка = сСептиком.rows.find((r) => r.SKU === "00:00:0000002:2002");
      check("посёлку без septic описание не трогается",
        !/Топас/.test(домДругогоПосёлка.Text || ""), (домДругогоПосёлка.Text || "").slice(0, 120));
      await call(`window.api.catalogSaveConfig(${JSON.stringify({ septics: {} })})`);
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека)})`);

      console.log("\nтаблица в виде магазина");
      const table = await call(`window.api.catalogTable()`);
      check("колонки те же, что у магазина",
        table.columns.join(";") === catalog.TILDA_COLUMNS.join(";"), table.columns.slice(0, 4).join(";"));
      check("отдана вся таблица, а не образец", table.rows.length === 10, String(table.rows.length));
      check("заготовки описаний пришли для выбора в ячейке",
        table.library.length === 4 && table.library.every((l) => l.label), JSON.stringify(table.library.map((l) => l.label)));
      check("у заготовки читаемое имя",
        table.library.some((l) => /дом 100 м² · кирпич/.test(l.label)), JSON.stringify(table.library.map((l) => l.label)));

      console.log("\nпочему описание не подставилось");
      // Главная жалоба: «указала пути, нажала пересобрать — в описании пусто».
      // Механизм при этом исправен: просто ни одна заготовка не совпала с парой
      // «метраж + облицовка», и сказать об этом было некому. Теперь у каждой
      // заготовки видно число домов, к которым она подошла, а рядом — список
      // вариаций, которые в выгрузке есть на самом деле.
      const подошло = Object.fromEntries(table.library.map((l) => [l.id, l.fits]));
      check("посчитано, к скольким домам подошла каждая заготовка",
        table.library.every((l) => typeof l.fits === "number"), JSON.stringify(подошло));
      check("сумма совпадений равна числу описанных домов",
        table.library.reduce((n, l) => n + l.fits, 0) === table.counts.described,
        `${JSON.stringify(подошло)} против ${table.counts.described}`);
      check("заготовка, к которой подошли дома, имеет ненулевое число",
        table.library.some((l) => l.fits > 0), JSON.stringify(подошло));

      await call(`window.api.catalogSaveLibrary(${JSON.stringify([
        { id: "мимо", name: "", area: 999, cladding: "планкен", textPath: "", renderUrls: [], renderPaths: [] },
      ])})`);
      const мимо = await call(`window.api.catalogTable()`);
      check("заготовка не по той вариации честно показывает ноль",
        мимо.library.length === 1 && мимо.library[0].fits === 0, JSON.stringify(мимо.library));
      check("и видно, что текста у неё нет",
        мимо.library[0].text === "", JSON.stringify(мимо.library[0]));
      check("вариации из выгрузки перечислены",
        мимо.variants.length > 0 && мимо.variants.every((v) => typeof v.count === "number"),
        JSON.stringify(мимо.variants));
      check("вариации отсортированы по числу домов",
        мимо.variants.every((v, i2) => i2 === 0 || мимо.variants[i2 - 1].count >= v.count),
        JSON.stringify(мимо.variants.map((v) => v.count)));
      check("999 м² планкена в выгрузке и правда нет — вот почему ноль",
        !мимо.variants.some((v) => v.area === 999 && v.cladding === "планкен"),
        JSON.stringify(мимо.variants));
      // Сумма по вариациям обязана сойтись с числом домов: иначе список врёт о
      // том, подо что заводить заготовки.
      check("вариации покрывают все дома выгрузки",
        мимо.variants.reduce((n, v) => n + v.count, 0) === мимо.counts.houses,
        `${мимо.variants.reduce((n, v) => n + v.count, 0)} против ${мимо.counts.houses}`);
      // Нечитаемый файл — другая причина пустого описания, и она называется
      // отдельно, прямо в карточке.
      await call(`window.api.catalogSaveLibrary(${JSON.stringify([
        { id: "битая", area: 100, cladding: "кирпич", textPath: path.join(описанияDir, "нет-такого.txt"), renderUrls: [], renderPaths: [] },
      ])})`);
      const сОшибкой = await call(`window.api.catalogTable()`);
      check("причина непрочитанного файла доходит до карточки",
        !!сОшибкой.library[0].error, JSON.stringify(сОшибкой.library[0]));
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека)})`);

      console.log("\nправка ячеек руками");
      const sku = "00:00:0000001:1002";
      await call(`window.api.catalogSaveEdits(${JSON.stringify({
        [sku]: { Title: "Правленое название", Text: "Своё описание руками", Price: "9999999.00" },
      })})`);
      const edited = await call(`window.api.catalogTable()`);
      const row = edited.rows.find((r) => r.SKU === sku);
      check("правка встала в таблицу", row.Title === "Правленое название", row.Title);
      check("правится любая колонка, не только описание", row.Price === "9999999.00", row.Price);
      check("правки помечены", edited.edited.some((e) => e.sku === sku && e.column === "Title"),
        JSON.stringify(edited.edited));
      // Правка привязана к кадастровому номеру, а не к номеру строки: иначе
      // новая выгрузка с другим порядком разнесла бы правки по чужим домам.
      const другой = edited.rows.find((r) => r.SKU !== sku);
      check("соседние позиции не задеты", другой.Title !== "Правленое название", другой.Title);

      console.log("\nвыгрузка в Excel и CSV");
      const result = await call(`window.api.catalogBuild()`);
      check("оба файла сохранены",
        fs.existsSync(result.csvFile) && fs.existsSync(result.xlsxFile), `${result.csvFile} | ${result.xlsxFile}`);
      const written = fs.readFileSync(result.csvFile, "utf-8");
      check("кириллица читается", written.includes("Ромашки"));
      check("в файле все позиции", catalog.parseCsv(written).length === 11, String(catalog.parseCsv(written).length));
      check("правка попала в CSV", written.includes("Правленое название"));

      console.log("\nфайл ровно того вида, в каком его отдаёт сам магазин");
      // Магазин отверг первый собранный каталог: «Empty Uniq column: uid» на
      // каждой из 186 позиций. Колонка-ключ в файле была, но пустая — при
      // заливке заново взять её значения неоткуда, их выдаёт сам магазин.
      // Поэтому правила формата сняты с ЕГО СОБСТВЕННОЙ выгрузки и закреплены
      // здесь: другого способа проверить, что файл примут, у нас нет.
      check("метки кодировки в начале НЕТ — её нет и у магазина",
        written.charCodeAt(0) !== 0xfeff, `первый знак ${written.charCodeAt(0)}`);
      check("переводы строк LF, не CRLF", !written.includes("\r"));
      check("файл кончается переводом строки", written.endsWith("\n"));
      const шапка = written.split("\n")[0].split(";");
      check("пустых колонок-ключей в файле нет",
        !шапка.includes("Tilda UID") && !шапка.includes("External ID"), шапка.slice(0, 3).join(";"));
      check("выгрузка сама говорит, какие колонки убрала",
        Array.isArray(result.dropped) && result.dropped.length === 2, JSON.stringify(result.dropped));
      check("имена с пробелом в шапке взяты в кавычки, как у магазина",
        шапка.includes('"Price Old"') && шапка.includes("Quantity"), шапка.join(";").slice(0, 90));
      // Ключом остаётся SKU: он заполнен всегда и уникален — иначе выбрасывать
      // колонки-ключи было бы нельзя.
      const разобрано = catalog.parseCsv(written);
      const колонки = разобрано[0];
      const skuАт = колонки.indexOf("SKU");
      const все = разобрано.slice(1).map((r2) => r2[skuАт]);
      check("SKU заполнен у всех позиций", все.every(Boolean), JSON.stringify(все.slice(0, 3)));
      check("SKU уникален", new Set(все).size === все.length, `${new Set(все).size} из ${все.length}`);
      check("все строки той же ширины, что шапка",
        разобрано.slice(1).every((r2) => r2.length === колонки.length),
        JSON.stringify(разобрано.slice(1).map((r2) => r2.length).slice(0, 5)));
      // Тот же писатель, которым воспроизводится выгрузка магазина: если наш
      // файл написан её диалектом, повторный проход ничего не изменит.
      const какМагазин = (v) => (/[ ;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
      const заново = разобрано.map((r2) => r2.map(какМагазин).join(";")).join("\n") + "\n";
      check("написан диалектом магазина байт в байт", заново === written,
        `наш ${written.length} знаков, пересобранный ${заново.length}`);

      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(result.xlsxFile);
      const sheet = wb.worksheets[0];
      check("книга Excel читается", !!sheet && sheet.rowCount === 11, sheet && String(sheet.rowCount));
      const header = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (c2, i2) => (header[i2 - 1] = String(c2.value || "")));
      // Книга и CSV об одном каталоге не должны расходиться составом колонок:
      // иначе непонятно, который из двух файлов поедет в магазин.
      check("в книге те же колонки, что в CSV", header.join(";") === колонки.join(";"),
        `книга: ${header.slice(0, 3).join(";")} | CSV: ${колонки.slice(0, 3).join(";")}`);
      check("шапка закреплена", sheet.views && sheet.views[0] && sheet.views[0].ySplit === 1);
      // Колонку ищем по имени, а не по номеру: состав колонок зависит от того,
      // переносятся ли номера позиций, и жёсткий номер разъехался бы молча.
      const titleАт = header.indexOf("Title") + 1;
      let нашлось = false;
      sheet.eachRow((r2) => { if (String(r2.getCell(titleАт).value || "") === "Правленое название") нашлось = true; });
      check("правка попала и в книгу Excel", нашлось);

      console.log("\nправка настроек не должна ломать кнопки");
      // Живая жалоба: «подгрузила таблицы, подгрузила описания — кнопки не
      // работают». Причина была в том, что каждая правка настройки или
      // библиотеки запускала полную пересборку и перекидывала на вкладку с
      // таблицей. Проверяем именно это: печатаем в поле библиотеки и смотрим,
      // что вкладка не съехала, а кнопки живы.
      // Настройки и библиотека в этом тесте сохранялись мимо окна — перечитываем
      // их так же, как это делает свежий запуск приложения.
      await call(`window.location.reload()`);
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      await new Promise((r) => setTimeout(r, 1500));
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Каталог")).click()`);
      await new Promise((r) => setTimeout(r, 800));
      // Сначала собираем — как она и делала, — и только потом правим настройки.
      await call(`[...document.querySelectorAll(".cat-tabs button")].find(b => /Пересобрать/.test(b.textContent)).click()`);
      await new Promise((r) => setTimeout(r, 2500));
      check("после сборки открылась таблица", (await call(`!!document.querySelector(".cat-table")`)) === true);

      // Выгрузка кнопкой: в окне должно быть сказано, что колонки-ключи убраны и
      // что уникальной колонкой в окне импорта надо выбрать SKU. Проверка через
      // прямой вызов обработчика прошла бы и тогда, когда в окне пусто.
      await call(`[...document.querySelectorAll(".cat-tabs button")].find(b => /Выгрузить/.test(b.textContent)).click()`);
      await new Promise((r) => setTimeout(r, 1500));
      const подсказка = await call(`(document.querySelector(".cat-uniq") || {}).textContent || ""`);
      check("в окне объяснено, что выбрать уникальной колонкой",
        /SKU/.test(подсказка) && /Empty Uniq column/.test(подсказка), подсказка.slice(0, 200) || "в окне пусто");
      await call(`[...document.querySelectorAll(".cat-tabs button")].find(b => /Настройка/.test(b.textContent)).click()`);
      await new Promise((r) => setTimeout(r, 400));
      const typed = await call(`(async () => {
        const inputs = [...document.querySelectorAll(".cat-card input[type=number]")];
        if (!inputs.length) return { error: "нет полей библиотеки" };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        const t0 = performance.now();
        for (const v of ["1", "12", "120"]) {
          setter.call(inputs[0], v);
          inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 120));
        }
        // Ждём заведомо дольше полной пересборки: если правка её всё-таки
        // запускает, к этому моменту вид уже перескочит на таблицу, и проверка
        // ниже это увидит. Без ожидания она ловила бы гонку, а не поведение.
        await new Promise(r => setTimeout(r, 2500));
        const rebuild = [...document.querySelectorAll(".cat-tabs button")].find(b => /Пересобрать/.test(b.textContent));
        const exportBtn = [...document.querySelectorAll(".cat-tabs button")].find(b => /Выгрузить/.test(b.textContent));
        return {
          ms: Math.round(performance.now() - t0),
          // Именно ВИДИМОСТЬ, а не наличие в разметке: панель настроек прячется
          // атрибутом hidden и остаётся в DOM, так что querySelector находил бы
          // её и на вкладке с таблицей.
          onSetupTab: [...document.querySelectorAll(".cat-tabs .vs-tab")]
            .find(b => /Настройка/.test(b.textContent)).classList.contains("on"),
          rebuildEnabled: rebuild && !rebuild.disabled,
          rebuildText: rebuild ? rebuild.textContent.trim() : "",
          exportEnabled: exportBtn && !exportBtn.disabled,
        };
      })()`);
      check("вкладка не переключилась сама на таблицу", typed.onSetupTab === true, JSON.stringify(typed));
      check("кнопка пересборки жива", typed.rebuildEnabled === true, JSON.stringify(typed));
      check("кнопка выгрузки жива", typed.exportEnabled === true, JSON.stringify(typed));
      check("правка в библиотеке идёт мгновенно", typed.ms - 2500 < 900, `${typed.ms - 2500} мс на три правки`);
      check("но сказано, что настройки изменились",
        /настройки изменились/i.test(typed.rebuildText), typed.rebuildText);
      // И выгрузка не должна молча отдать вчерашний каталог.
      const отказ = await call(`(() => {
        [...document.querySelectorAll(".cat-tabs button")].find(b => /Выгрузить/.test(b.textContent)).click();
        return new Promise(r => setTimeout(() => r((document.querySelector(".cat-bar-note") || {}).textContent || ""), 400));
      })()`);
      check("выгрузка устаревшей таблицы остановлена с объяснением",
        /Пересобрать/.test(отказ), отказ);

      console.log("\nправка не должна зависеть от размера таблицы");
      // Открытый редактор один, и набираемое значение живёт внутри него. Если
      // поднять его в состояние всей таблицы, каждая буква будет перерисовывать
      // тысячи ячеек — ровно та беда, что была в чате.
      // Возвращаем библиотеку в исходное после правки полей выше.
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека)})`);
      await call(`[...document.querySelectorAll(".cat-tabs button")].find(b => b.textContent.includes("Пересобрать")).click()`);
      await new Promise((r) => setTimeout(r, 2500));
      const cells = await call(`document.querySelectorAll(".cat-cell").length`);
      check("таблица показана целиком", cells > 100, String(cells));
      check("всегда пустые колонки скрыты",
        (await call(`document.querySelectorAll(".cat-table th").length`)) < catalog.TILDA_COLUMNS.length);
      await call(`document.querySelectorAll(".cat-cell")[5].click()`);
      await new Promise((r) => setTimeout(r, 400));
      check("редактор открылся", (await call(`!!document.querySelector(".cat-editor textarea")`)) === true);
      const typing = await call(`(async () => {
        const ta = document.querySelector(".cat-editor textarea");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        const times = []; let text = "";
        for (let i = 0; i < 25; i++) {
          text += "а";
          const t0 = performance.now();
          setter.call(ta, text);
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          times.push(performance.now() - t0);
          await new Promise(r => setTimeout(r, 0));
        }
        times.sort((a, b) => a - b);
        return { median: times[12], cells: document.querySelectorAll(".cat-cell").length };
      })()`);
      check("набор в ячейке не тормозит при полной таблице", typing.median < 3,
        `${typing.median.toFixed(2)} мс при ${typing.cells} ячейках`);
      console.log(`     (медиана ${typing.median.toFixed(2)} мс на клавишу, ячеек на экране ${typing.cells})`);
      // Выбор описания из библиотеки живёт прямо в редакторе ячейки Text.
      await call(`document.querySelector(".cat-editor button.btn-secondary").click()`);
      await new Promise((r) => setTimeout(r, 300));
      const textCol = await call(`(() => {
        const heads = [...document.querySelectorAll(".cat-table th")].map(h => h.textContent);
        const idx = heads.indexOf("Text");
        const rowCells = document.querySelectorAll(".cat-table tbody tr")[0].querySelectorAll("td");
        rowCells[idx].click();
        return idx;
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      check("в описании есть выбор из библиотеки",
        (await call(`!!document.querySelector(".cat-editor-pick")`)) === true, String(textCol));
      check("в списке — заготовки библиотеки",
        (await call(`[...document.querySelectorAll(".cat-editor-pick option")].map(o => o.textContent).join("|")`))
          .includes("дом 100 м²"));
      check("в списке сказано, сколько домов взяли эту заготовку сами",
        (await call(`[...document.querySelectorAll(".cat-editor-pick option")].map(o => o.textContent).join("|")`))
          .includes("подошла к"));

      console.log("\nописание выбирается руками там, где подбора не случилось");
      // Ради этого всё и затевалось: подбор промахнулся — человек должен уметь
      // поставить описание сам, не открывая ни одного файла.
      const выбор = await call(`(() => {
        const heads = [...document.querySelectorAll(".cat-table th")].map(h => h.textContent);
        const idx = heads.indexOf("Text");
        const rows = [...document.querySelectorAll(".cat-table tbody tr")];
        const пустая = rows.find(r => {
          const c = r.querySelectorAll("td")[idx];
          return c && c.querySelector(".cat-cell-pick");
        });
        if (!пустая) return { нет: true };
        пустая.querySelectorAll("td")[idx].click();
        return { sku: пустая.querySelectorAll("td")[heads.indexOf("SKU")].textContent };
      })()`);
      check("пустое описание приглашает выбрать, а не молчит", !выбор.нет, JSON.stringify(выбор));
      if (!выбор.нет) {
        await new Promise((r) => setTimeout(r, 400));
        const поставлено = await call(`(async () => {
          const sel = document.querySelector(".cat-editor-pick");
          const opt = [...sel.options].find(o => o.value && !o.disabled);
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
          setter.call(sel, opt.value);
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          await new Promise(r => setTimeout(r, 50));
          const ta = document.querySelector(".cat-editor textarea");
          const был = ta.value;
          [...document.querySelectorAll(".cat-editor-actions button")].find(b => /Сохранить/.test(b.textContent)).click();
          return { был };
        })()`);
        check("выбранное из библиотеки описание встало в редактор",
          поставлено.был.length > 10, JSON.stringify(поставлено.был.slice(0, 60)));
        await new Promise((r) => setTimeout(r, 500));
        const вТаблице = await call(`window.api.catalogEdits()`);
        check("и сохранилось как правка именно у этого дома",
          !!(вТаблице[выбор.sku] && вТаблице[выбор.sku].Text === поставлено.был),
          JSON.stringify(Object.keys(вТаблице)));
      }

      console.log("\nодно описание во все пустые сразу");
      const массово = await call(`(async () => {
        const bar = document.querySelector(".cat-fill");
        if (!bar) return { нет: true };
        const было = Number((bar.textContent.match(/Без описания: (\\d+)/) || [])[1]);
        const sel = bar.querySelector("select");
        const opt = [...sel.options].find(o => o.value);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(sel, opt.value);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));
        bar.querySelector("button").click();
        await new Promise(r => setTimeout(r, 600));
        const после = document.querySelector(".cat-fill");
        return { было, осталось: после ? Number((после.textContent.match(/Без описания: (\\d+)/) || [])[1]) : 0 };
      })()`);
      check("подстановка во все пустые предложена, пока пустые есть", !массово.нет, JSON.stringify(массово));
      if (!массово.нет) {
        check("пустые описания были и сосчитаны", массово.было > 0, JSON.stringify(массово));
        check("после подстановки пустых описаний не осталось",
          массово.осталось === 0, JSON.stringify(массово));
        console.log(`     (было без описания ${массово.было}, стало ${массово.осталось})`);
      }
      // Правки снимаются так же, как любые другие: подстановка — это правка, а
      // не новый сорт данных.
      await call(`window.api.catalogSaveEdits({})`);
      await call(`[...document.querySelectorAll(".cat-tabs button")].find(b => b.textContent.includes("Пересобрать")).click()`);
      await new Promise((r) => setTimeout(r, 2500));
      const снято = await call(`document.querySelectorAll(".cat-cell-pick").length`);
      check("после снятия правок пустые описания вернулись на место", снято > 0, String(снято));

      console.log("\nвыбор из библиотеки есть и в короткой строке Description");
      const вDescription = await call(`(() => {
        const heads = [...document.querySelectorAll(".cat-table th")].map(h => h.textContent);
        document.querySelectorAll(".cat-table tbody tr")[0]
          .querySelectorAll("td")[heads.indexOf("Description")].click();
        return heads.indexOf("Description");
      })()`);
      await new Promise((r) => setTimeout(r, 400));
      check("в Description тоже можно выбрать заготовку",
        (await call(`!!document.querySelector(".cat-editor-pick")`)) === true, String(вDescription));
      await call(`[...document.querySelectorAll(".cat-editor-actions button")].find(b => /Отмена/.test(b.textContent)).click()`);

      console.log("\nвариации из выгрузки видно в настройке");
      await call(`[...document.querySelectorAll(".cat-tabs .vs-tab")].find(b => /Настройка/.test(b.textContent)).click()`);
      await new Promise((r) => setTimeout(r, 300));
      const вариацииВидны = await call(`(() => {
        const box = document.querySelector(".cat-variants");
        return box ? [...box.querySelectorAll(".cat-variant")].map(b => b.textContent) : null;
      })()`);
      check("список вариаций показан в настройке",
        Array.isArray(вариацииВидны) && вариацииВидны.length > 0, JSON.stringify(вариацииВидны));
      const былоЗаготовок = (await call(`window.api.catalogLibrary()`)).length;
      await call(`[...document.querySelectorAll(".cat-variant")].find(b => !b.disabled).click()`);
      await new Promise((r) => setTimeout(r, 400));
      const сталоЗаготовок = await call(`window.api.catalogLibrary()`);
      check("нажатие на вариацию заводит заготовку под неё",
        сталоЗаготовок.length === былоЗаготовок + 1, `${былоЗаготовок} → ${сталоЗаготовок.length}`);
      const новая = сталоЗаготовок[сталоЗаготовок.length - 1];
      check("у заведённой заготовки проставлены метраж и облицовка",
        новая.area > 0 && !!новая.cladding, JSON.stringify(новая));

      console.log("\nотмена правки");
      await call(`window.api.catalogSaveEdits({})`);
      const вернулось = await call(`window.api.catalogTable()`);
      const back2 = вернулось.rows.find((r) => r.SKU === sku);
      check("после снятия правки вернулось собранное значение",
        back2.Title !== "Правленое название" && back2.Title.includes("Луговая"), back2.Title);
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});

app.on("window-all-closed", () => {});
