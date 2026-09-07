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
      Category: "Метраж дома>>>дом 100 м2;Поселки>>>Ромашки", Title: "Ромашкино, Луговая, 3" },
    { "Tilda UID": "222222222222", SKU: "00:00:0000003:3001", "External ID": "BBB",
      Category: "Земельные участки;Поселки>>>Ромашки", Title: "Ромашкино, Полевая, 2" },
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
    check("все фото из выгрузки прикреплены, а не одно", дом.Photo.split(" ").length === 2, дом.Photo);
    check("площадь участка с запятой", дом["Characteristics:Площадь участка"] === "6,50", дом["Characteristics:Площадь участка"]);

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
    check("колонки те же и в том же порядке",
      back[0].join(";") === catalog.TILDA_COLUMNS.join(";"), back[0].slice(0, 5).join(";"));
    check("строк столько же", back.length === built.rows.length + 1, `${back.length - 1} из ${built.rows.length}`);
    // Точка с запятой внутри категории обязана пережить запись и чтение.
    const cat = back.find((r) => r[2] === "00:00:0000001:1001");
    check("точка с запятой внутри поля не разорвала строку",
      cat && cat[4] === "Метраж дома>>>дом 100 м2;Поселки>>>Ромашки", cat && cat[4]);
    check("длинный текст с кавычками пережил запись",
      catalog.parseCsv(catalog.toCsv([{ ...built.rows[0], Text: 'он сказал "да"; и ушёл' }]))[1][7] === 'он сказал "да"; и ушёл');

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

      console.log("\nтаблица в виде магазина");
      const table = await call(`window.api.catalogTable()`);
      check("колонки те же, что у магазина",
        table.columns.join(";") === catalog.TILDA_COLUMNS.join(";"), table.columns.slice(0, 4).join(";"));
      check("отдана вся таблица, а не образец", table.rows.length === 10, String(table.rows.length));
      check("заготовки описаний пришли для выбора в ячейке",
        table.library.length === 2 && table.library.every((l) => l.label), JSON.stringify(table.library.map((l) => l.label)));
      check("у заготовки читаемое имя",
        table.library.some((l) => /дом 100 м² · кирпич/.test(l.label)), JSON.stringify(table.library.map((l) => l.label)));

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
      check("файл начинается с метки кодировки", written.charCodeAt(0) === 0xfeff);
      check("кириллица читается", written.includes("Ромашки"));
      check("в файле все позиции", catalog.parseCsv(written).length === 11, String(catalog.parseCsv(written).length));
      check("правка попала в CSV", written.includes("Правленое название"));

      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(result.xlsxFile);
      const sheet = wb.worksheets[0];
      check("книга Excel читается", !!sheet && sheet.rowCount === 11, sheet && String(sheet.rowCount));
      const header = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (c2, i2) => (header[i2 - 1] = String(c2.value || "")));
      check("в книге те же колонки", header.join(";") === catalog.TILDA_COLUMNS.join(";"), header.slice(0, 4).join(";"));
      check("шапка закреплена", sheet.views && sheet.views[0] && sheet.views[0].ySplit === 1);
      let нашлось = false;
      sheet.eachRow((r2) => { if (String(r2.getCell(6).value || "") === "Правленое название") нашлось = true; });
      check("правка попала и в книгу Excel", нашлось);

      console.log("\nправка не должна зависеть от размера таблицы");
      // Открытый редактор один, и набираемое значение живёт внутри него. Если
      // поднять его в состояние всей таблицы, каждая буква будет перерисовывать
      // тысячи ячеек — ровно та беда, что была в чате.
      // Настройки в этом тесте менялись мимо окна, поэтому таблицу собираем так
      // же, как человек, — кнопкой.
      await call(`window.location.reload()`);
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      await new Promise((r) => setTimeout(r, 1500));
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Каталог")).click()`);
      await new Promise((r) => setTimeout(r, 800));
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
    app.exit(failures === 0 ? 0 : 1);
  }
});

app.on("window-all-closed", () => {});
