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
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Непойманная ошибка:", e);
  process.exit(1);
});
