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
    check("дома и участки прочитаны", source.houses.length === 5 && source.plots.length === 2,
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
    const built = catalog.buildCatalog({ ...source, library: библиотека, villages, previous, photoMode: "all" });
    check("собраны все позиции", built.rows.length === 7, String(built.rows.length));

    // Готовые дома первыми — это и есть смысл сортировки.
    const marks = built.rows.map((r) => r.Mark);
    check("готовые дома идут первыми", marks[0] === "готов" && marks[1] === "готов", JSON.stringify(marks.slice(0, 4)));
    check("стройка после готовых", marks[2] === "стройка", JSON.stringify(marks.slice(0, 5)));
    check("участки в конце", marks.slice(-2).every((m) => m === ""), JSON.stringify(marks));
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
    check("фото из выгрузки прикреплены", дом.Photo.split(" ").length === 2, дом.Photo);
    check("площадь участка с запятой", дом["Characteristics:Площадь участка"] === "6,50", дом["Characteristics:Площадь участка"]);

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

      await call(`window.api.catalogSaveConfig(${JSON.stringify({ exportPath, previousPath, outputDir: workDir, photoMode: "all" })})`);
      await call(`window.api.catalogSaveLibrary(${JSON.stringify(библиотека.map((b) => ({ ...b, textPath: "", renderPaths: [], name: "" })))})`);
      const preview = await call(`window.api.catalogPreview()`);
      check("предпросмотр собрался через приложение", preview.total === 7, String(preview.total));
      check("замечания дошли до окна", preview.problems.length > 0, String(preview.problems.length));
      check("готовые первыми и в предпросмотре", preview.sample[0].Mark === "готов", preview.sample[0].Mark);

      const result = await call(`window.api.catalogBuild()`);
      check("файл сохранён", fs.existsSync(result.file), result.file);
      const written = fs.readFileSync(result.file, "utf-8");
      check("файл начинается с метки кодировки", written.charCodeAt(0) === 0xfeff);
      check("кириллица читается", written.includes("Ромашки"));
      check("в файле все позиции", catalog.parseCsv(written).length === 8, String(catalog.parseCsv(written).length));
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
