// Документооборот: проверяем то, где ошибка стоит дороже всего — номер, дата,
// запись в документ сверки и сохранность форматирования шаблона.
//   node electron/smoke-docflow.cjs
//
// Electron здесь не нужен: docflow.cjs намеренно написан без него.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const docflow = require("./docflow.cjs");
const word = require("./word.cjs");
const { finish } = require("./finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docflow-"));

async function makeLedgerXlsx(file) {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Сверка");
  sheet.addRow(["Ведомость документов"]);
  sheet.addRow(["№", "Дата", "Тип", "Контрагент", "Сумма"]);
  sheet.addRow(["40", "30.06.2026", "Акт", "ИП Павлов", "100000"]);
  sheet.addRow(["41", "31.07.2026", "Акт", "ИП Павлов", "110000"]);
  sheet.addRow(["7", "01.07.2026", "Техническое задание", "ИП Павлов", "110000"]);
  await wb.xlsx.writeFile(file);
}

async function makeTemplateDocx(file) {
  const docx = require("docx");
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({ text: "АКТ № ___ от ___", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({ text: "Исполнитель: ___" }),
          new docx.Paragraph({ text: "Заказчик: ___" }),
          new docx.Paragraph({ text: "Стороны подтверждают, что работы выполнены в полном объёме." }),
          new docx.Paragraph({ text: "Сумма: ___ руб." }),
        ],
      },
    ],
  });
  await fsp.writeFile(file, await docx.Packer.toBuffer(doc));
}

/**
 * Шаблон акта той же формы, что настоящий: перечень выполненных работ —
 * ТАБЛИЦА, и в шаблоне она заполнена данными ПРОШЛОГО периода. Именно на такой
 * форме раздел собирал негодный документ: даты в абзацах обновлялись, перечень
 * работ оставался августовским, и файл сохранялся как готовый.
 */
async function makeActTemplate(file) {
  const docx = require("docx");
  const row = (cells) =>
    new docx.TableRow({
      children: cells.map((t) => new docx.TableCell({ children: [new docx.Paragraph(String(t))] })),
    });
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({ text: "АКТ ПРИЁМКИ ВЫПОЛНЕННЫХ РАБОТ", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({ text: "г. Пермь «31» августа 2026 г." }),
          new docx.Paragraph({ text: "В отчетном периоде с 1 по 31 августа 2026 г. выполнены единицы контента:" }),
          new docx.Table({
            rows: [
              row(["№", "Дата публикации", "Тип контента", "Стоимость, ₽"]),
              row(["1", "31 авг. 2026г.", "Живой клип (энергоэффективность)", "5000"]),
              row(["2", "28 авг. 2026г.", "SEO-статья (сайт)", "2500"]),
              row(["3", "5 авг. 2026г.", "Живой клип (долговечность)", "5000"]),
            ],
          }),
          new docx.Paragraph({ text: "Общая стоимость: 12 500 рублей 00 копеек, НДС не облагается." }),
          new docx.Paragraph({ text: "Реквизиты и подписи сторон." }),
        ],
      },
    ],
  });
  await fsp.writeFile(file, await docx.Packer.toBuffer(doc));
}

async function main() {
  console.log("справочники");
  const root = path.join(tmp, "data");
  await fsp.mkdir(root, { recursive: true });
  const saved = await docflow.saveConfig(root, {
    counterparties: [{ id: "c1", name: "ИП Павлов", requisitesPath: "/tmp/req.docx" }],
    ledgerPath: "/tmp/ledger.xlsx",
  });
  check("конфиг сохранён и дополнен пустыми полями", saved.templates.length === 0 && saved.counterparties.length === 1);
  const loaded = await docflow.loadConfig(root);
  check("конфиг читается обратно", loaded.counterparties[0].name === "ИП Павлов" && loaded.ledgerPath === "/tmp/ledger.xlsx");
  const missing = await docflow.loadConfig(path.join(tmp, "нет-такой-папки"));
  check("без файла конфига — пустые справочники, а не падение", missing.counterparties.length === 0);

  console.log("\nдокумент сверки");
  const ledgerFile = path.join(tmp, "Сверка.xlsx");
  await makeLedgerXlsx(ledgerFile);
  const ledger = await docflow.readLedger(ledgerFile);
  check("таблица прочитана", ledger.format === "xlsx" && ledger.rows.length === 5, `строк: ${ledger.rows.length}`);
  check(
    "шапка найдена не в первой строке, а там, где она есть",
    ledger.headerRow === 1,
    `headerRow=${ledger.headerRow}`
  );
  check(
    "колонки разложены по смыслу",
    ledger.columns.number === 0 && ledger.columns.date === 1 && ledger.columns.kind === 2 && ledger.columns.sum === 4,
    JSON.stringify(ledger.columns)
  );
  check("крайний номер акта — 41, а не 7 от ТЗ", docflow.lastNumber(ledger, "Акт") === 41, String(docflow.lastNumber(ledger, "Акт")));
  check("у ТЗ своя нумерация", docflow.lastNumber(ledger, "Техническое задание") === 7, String(docflow.lastNumber(ledger, "Техническое задание")));

  await docflow.appendLedgerRow(ledgerFile, ledger, {
    number: 42,
    date: "31.08.2026",
    kind: "Акт",
    counterparty: "ИП Павлов",
    sum: 120000,
  });
  const after = await docflow.readLedger(ledgerFile);
  const lastRow = after.rows[after.rows.length - 1].values;
  check("новая запись дописана", after.rows.length === 6, `строк: ${after.rows.length}`);
  check(
    "значения встали в свои колонки",
    lastRow[0] === "42" && lastRow[1] === "31.08.2026" && lastRow[3] === "ИП Павлов",
    lastRow.join(" | ")
  );
  check("следующий номер акта теперь 42", docflow.lastNumber(after, "Акт") === 42);

  console.log("\nдаты по виду документа");
  check("акт — последнее число месяца", docflow.documentDate("act", "2026-08") === "31.08.2026", docflow.documentDate("act", "2026-08"));
  check("акт за февраль високосного года", docflow.documentDate("act", "2028-02") === "29.02.2028", docflow.documentDate("act", "2028-02"));
  check("ТЗ — первое число месяца", docflow.documentDate("spec", "2026-08") === "01.08.2026", docflow.documentDate("spec", "2026-08"));
  check("у договора дата сегодняшняя", docflow.documentDate("contract", "2026-08") === docflow.formatDate(new Date()));

  console.log("\nразбор ответа агента");
  const parsed = docflow.parseResult(`Заполнил акт по тарифам.

===ДОКУМЕНТ===
NUMBER: 42
DATE: 31.08.2026
COUNTERPARTY: ИП Павлов
SUM: 120000
FILENAME: Акт №42 от 31.08.2026
===ПРАВКИ===
SET 0: АКТ № 42 от 31.08.2026
SET 4: Сумма: 120 000 руб.
===КОНЕЦ===`);
  check("метаданные разобраны", parsed && parsed.meta.number === "42" && parsed.meta.sum === "120000", JSON.stringify(parsed?.meta));
  check("правки разобраны", parsed.ops.length === 2 && parsed.ops[0].op === "set", JSON.stringify(parsed.ops));
  check("имя файла взято из ответа", parsed.meta.filename === "Акт №42 от 31.08.2026");

  const lawyer = docflow.parseResult(`===ДОКУМЕНТ===
NUMBER:
DATE: 01.09.2026
COUNTERPARTY: ООО «Ромашка»
SUM:
FILENAME: Договор оказания услуг
===ТЕКСТ===
## 1. Предмет договора
Исполнитель обязуется оказать услуги.
===КОНЕЦ===`);
  check("режим юриста возвращает текст, а не правки", lawyer.markdown.startsWith("## 1. Предмет") && lawyer.ops.length === 0);
  check("пустые поля не ломают разбор", lawyer.meta.number === "" && lawyer.meta.counterparty === "ООО «Ромашка»");
  check("без блока документа — null, а не пустой объект", docflow.parseResult("просто текст ответа") === null);

  console.log("\nзаполнение шаблона");
  const templateFile = path.join(tmp, "Шаблон акта.docx");
  await makeTemplateDocx(templateFile);
  const templateBefore = fs.readFileSync(templateFile);
  const outFile = path.join(tmp, "результат", "Акт №42.docx");
  await docflow.fillTemplate(templateFile, parsed.ops, outFile);

  check("шаблон на диске не изменился", Buffer.compare(templateBefore, fs.readFileSync(templateFile)) === 0);
  const result = await word.loadDocument(outFile);
  check("документ сохранён и открывается", result.blocks.length === 5, `блоков: ${result.blocks.length}`);
  check("заголовок заполнен", result.blocks[0].text === "АКТ № 42 от 31.08.2026", result.blocks[0].text);
  check("сумма заполнена", result.blocks[4].text === "Сумма: 120 000 руб.", result.blocks[4].text);
  check(
    "нетронутые блоки остались как были",
    result.blocks[3].text === "Стороны подтверждают, что работы выполнены в полном объёме.",
    result.blocks[3].text
  );
  check("стиль заголовка сохранён", result.blocks[0].level === 1, `level=${result.blocks[0].level}`);

  console.log("\nперечень работ в таблице заполняется");
  // Главная проверка этого раздела. Жалоба была: «сохраняется файл с датами
  // сентября, но данные внутри акта августа — тот же документ, что плагин
  // создал в прошлом месяце».
  const actTemplate = path.join(tmp, "Шаблон акта с таблицей.docx");
  await makeActTemplate(actTemplate);

  const ответАгента = `Заполнил акт за сентябрь.

===ДОКУМЕНТ===
NUMBER: 43
DATE: 30.09.2026
COUNTERPARTY: ИП Павлов
SUM: 13200
FILENAME: Акт №43 от 30.09.2026
===ПРАВКИ===
SET 1: г. Пермь «30» сентября 2026 г.
SET 2: В отчетном периоде с 1 по 30 сентября 2026 г. выполнены единицы контента:
SET 4: Общая стоимость: 13 200 рублей 00 копеек, НДС не облагается.
TABLE 3 FROM 2:
| 1 | 03.09.2026 | Генеративное видео «Демо-дом» | 3000 |
| 2 | 07.09.2026 | Пост текст+фото (график застройки) | 1200 |
| 3 | 09.09.2026 | Живой клип (газобетон или каркасник) | 9000 |
===КОНЕЦ===`;

  const актПравки = docflow.parseResult(ответАгента);
  const таблОп = актПравки.ops.find((o) => o.op === "table");
  check("команда TABLE разобрана", !!таблОп && таблОп.index === 3 && таблОп.from === 2, JSON.stringify(таблОп && таблОп.index));
  check("строки таблицы разобраны по колонкам",
    таблОп.rows.length === 3 && таблОп.rows[0].length === 4, JSON.stringify(таблОп.rows[0]));
  check("команда TABLE не считается вставкой абзаца",
    актПравки.ops.filter((o) => o.op === "insert").length === 0, JSON.stringify(актПравки.ops.map((o) => o.op)));

  const актFile = path.join(tmp, "результат", "Акт №43.docx");
  const заполнен = await docflow.fillTemplate(actTemplate, актПравки.ops, актFile, {
    month: "2026-09",
    sum: "13200",
  });
  check("акт сохранён", fs.existsSync(заполнен.path));
  const акт = await word.loadDocument(актFile);
  const таблица = акт.blocks.find((b) => b.kind === "table");
  check("в таблице новое число строк", таблица.rows.length === 4, `строк: ${таблица.rows.length}`);
  check("шапка таблицы не тронута", таблица.rows[0][0] === "№" && таблица.rows[0][3] === "Стоимость, ₽",
    таблица.rows[0].join(" | "));
  check("перечень работ — за новый период",
    таблица.rows.slice(1).every((r) => /\.09\.2026$/.test(r[1])), JSON.stringify(таблица.rows.slice(1).map((r) => r[1])));
  check("августовских работ в документе не осталось",
    !акт.blocks.some((b) => (b.rows || []).some((r) => r.some((c) => /авг/i.test(c)))),
    JSON.stringify(таблица.rows));
  check("число колонок не поехало",
    таблица.rows.every((r) => r.length === 4), JSON.stringify(таблица.rows.map((r) => r.length)));
  check("абзацы вокруг таблицы на месте",
    акт.blocks[акт.blocks.length - 1].text === "Реквизиты и подписи сторон.",
    акт.blocks[акт.blocks.length - 1].text);

  console.log("\nпроверка перед сохранением");
  // Те же правки, но БЕЗ команды TABLE: ровно то, что раздел делал раньше.
  const безТаблицы = актПравки.ops.filter((o) => o.op !== "table");
  const проверка = await docflow.checkTemplate(actTemplate, безТаблицы, { month: "2026-09", sum: "13200" });
  check("незаполненная таблица останавливает сохранение",
    проверка.blocking.some((t) => /даты другого периода/.test(t)), JSON.stringify(проверка.blocking));
  check("в замечании названы и чужой период, и нужный",
    проверка.blocking.some((t) => /август 2026/.test(t) && /сентябрь 2026/.test(t)), JSON.stringify(проверка.blocking));

  const негодный = path.join(tmp, "результат", "негодный.docx");
  let отказал = false;
  try {
    await docflow.fillTemplate(actTemplate, безТаблицы, негодный, { month: "2026-09", sum: "13200" });
  } catch (e) {
    отказал = Boolean(e.docflowCheck);
  }
  check("файл без подтверждения не записан", отказал && !fs.existsSync(негодный));
  const силой = await docflow.fillTemplate(actTemplate, безТаблицы, негодный, {
    month: "2026-09",
    sum: "13200",
    confirm: true,
  });
  check("с подтверждением человека сохраняется", fs.existsSync(силой.path) && силой.blocking.length > 0);

  const сошлось = await docflow.checkTemplate(actTemplate, актПравки.ops, { month: "2026-09", sum: "13200" });
  check("заполненный акт проверку проходит",
    сошлось.blocking.length === 0 && сошлось.warnings.length === 0,
    JSON.stringify([сошлось.blocking, сошлось.warnings]));

  const расхождение = await docflow.checkTemplate(actTemplate, актПравки.ops, { month: "2026-09", sum: "37000" });
  // Пробел в разрядах — НЕРАЗРЫВНЫЙ: его ставит toLocaleString. Обычный пробел в
  // выражении здесь молча не совпадает, и проверка падала бы на ровном месте.
  check("расхождение суммы с таблицей останавливает сохранение",
    расхождение.blocking.some((t) => /13\s200/.test(t) && /37\s000/.test(t)), JSON.stringify(расхождение.blocking));

  console.log("\nдаты в тексте — как их пишут люди");
  const датыПрописью = docflow.datesIn("31 авг. 2026г. и «30» сентября 2026 г. и 05.12.2025");
  check("«31 авг. 2026г.» опознано", датыПрописью.has("2026-08"), JSON.stringify([...датыПрописью.keys()]));
  check("«30 сентября 2026» опознано", датыПрописью.has("2026-09"), JSON.stringify([...датыПрописью.keys()]));
  check("«05.12.2025» опознано", датыПрописью.has("2025-12"), JSON.stringify([...датыПрописью.keys()]));
  check("мая и марта не путаются",
    docflow.datesIn("1 мая 2026").has("2026-05") && docflow.datesIn("1 марта 2026").has("2026-03"));
  // Дата договора в АБЗАЦЕ — законна: «к Договору № 14 от 01.12.2025 г.». Проверка
  // смотрит только таблицы, иначе она ругалась бы на каждый акт и её перестали бы читать.
  const сДоговором = await docflow.checkTemplate(
    actTemplate,
    [...актПравки.ops, { op: "insert", index: 0, text: "К Договору № 14 от 01.12.2025 г.", style: "" }],
    { month: "2026-09", sum: "13200" }
  );
  check("дата договора в абзаце не считается ошибкой", сДоговором.blocking.length === 0,
    JSON.stringify(сДоговором.blocking));

  console.log("\nдокумент сверки в формате Word");
  const docxLedger = path.join(tmp, "Сверка.docx");
  const docx = require("docx");
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Table({
            rows: [
              ["№", "Дата", "Тип", "Контрагент", "Сумма"],
              ["1", "31.07.2026", "Акт", "ИП Филатова", "50000"],
            ].map(
              (cells) =>
                new docx.TableRow({
                  children: cells.map(
                    (t) => new docx.TableCell({ children: [new docx.Paragraph({ text: t })] })
                  ),
                })
            ),
          }),
        ],
      },
    ],
  });
  await fsp.writeFile(docxLedger, await docx.Packer.toBuffer(doc));
  const wordLedger = await docflow.readLedger(docxLedger);
  check("таблица из .docx прочитана", wordLedger.format === "docx" && wordLedger.rows.length === 2, `строк: ${wordLedger.rows.length}`);
  check("шапка найдена и в Word-таблице", wordLedger.columns.number === 0 && wordLedger.columns.sum === 4, JSON.stringify(wordLedger.columns));
  await docflow.appendLedgerRow(docxLedger, wordLedger, {
    number: 2,
    date: "31.08.2026",
    kind: "Акт",
    counterparty: "ИП Филатова",
    sum: 60000,
  });
  const wordAfter = await docflow.readLedger(docxLedger);
  check("строка дописана в Word-таблицу", wordAfter.rows.length === 3, `строк: ${wordAfter.rows.length}`);
  check(
    "значения в нужных ячейках",
    wordAfter.rows[2].values[0] === "2" && wordAfter.rows[2].values[4] === "60000",
    wordAfter.rows[2].values.join(" | ")
  );

  console.log("\nсборка промпта");
  const prompt = docflow.buildPrompt({
    kindId: "act",
    month: "2026-08",
    references: [{ title: "Реквизиты", name: "req.docx", text: "ИНН 1234567890" }],
    ledgerText: "40 | 30.06.2026 | Акт",
    nextNumber: 42,
    date: "31.08.2026",
    templateText: "[0] H1: АКТ № ___",
    mode: "template",
    counterpartyName: "ИП Павлов",
  });
  check("номер попал в промпт как посчитанный, а не как задача модели", prompt.includes("Номер документа: 42"), "");
  check("дата попала в промпт", prompt.includes("Дата документа: 31.08.2026"));
  check("период назван словами", prompt.includes("август 2026"));
  check("исходники вложены", prompt.includes("ИНН 1234567890"));
  check("формат ответа объяснён", prompt.includes("===ДОКУМЕНТ==="));

  const lawyerPrompt = docflow.buildPrompt({ kindId: "contract", mode: "lawyer", date: "01.09.2026", references: [] });
  check("в режиме юриста другой формат ответа", lawyerPrompt.includes("===ТЕКСТ===") && !lawyerPrompt.includes("===ПРАВКИ==="));
  check("в режиме юриста есть требование законности", lawyerPrompt.includes("законодательству"));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  finish(failures, (c) => process.exit(c));
}

main().catch((e) => {
  console.error("Непойманная ошибка:", e);
  process.exit(1);
});
