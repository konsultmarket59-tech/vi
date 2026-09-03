// Раздел «Документооборот» в живом приложении: справочники сохраняются, задание
// собирается, документ сохраняется в Word и PDF, строка уходит в сверку.
//   xvfb-run -a npx electron electron/smoke-docflow-ui.cjs

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "docflow-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docflow-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "docflow-work-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

// Ответ агента подставляется целиком: настоящей модели тут нет, а проверяем мы
// путь от разобранного ответа до файлов на диске.
const AGENT_REPLY = `Заполнил акт по тарифам за август.

===ДОКУМЕНТ===
NUMBER: 42
DATE: 31.08.2026
COUNTERPARTY: ИП Павлов
SUM: 120000
FILENAME: Акт №42 от 31.08.2026
===ПРАВКИ===
SET 0: АКТ № 42 от 31.08.2026
SET 4: Сумма: 120 000 руб.
===КОНЕЦ===`;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.split("?")[0].endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: AGENT_REPLY } }], usage: {} }));
  });
});

async function makeFixtures() {
  const ExcelJS = require("exceljs");
  const docx = require("docx");

  const ledger = path.join(workDir, "Сверка.xlsx");
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Сверка");
  sheet.addRow(["№", "Дата", "Тип", "Контрагент", "Сумма"]);
  sheet.addRow(["41", "31.07.2026", "Акт", "ИП Павлов", "110000"]);
  await wb.xlsx.writeFile(ledger);

  const template = path.join(workDir, "Шаблон акта.docx");
  const doc = new docx.Document({
    sections: [
      {
        children: [
          new docx.Paragraph({ text: "АКТ № ___ от ___", heading: docx.HeadingLevel.HEADING_1 }),
          new docx.Paragraph({ text: "Исполнитель: ИП Ладыгина" }),
          new docx.Paragraph({ text: "Заказчик: ___" }),
          new docx.Paragraph({ text: "Работы выполнены в полном объёме, претензий нет." }),
          new docx.Paragraph({ text: "Сумма: ___ руб." }),
        ],
      },
    ],
  });
  fs.writeFileSync(template, await docx.Packer.toBuffer(doc));

  const requisites = path.join(workDir, "Реквизиты ИП Павлов.txt");
  fs.writeFileSync(requisites, "ИП Павлов Иван Иванович, ИНН 590000000000, р/с 40802810000000000000", "utf-8");

  const outDir = path.join(workDir, "готовые");
  fs.mkdirSync(outDir, { recursive: true });
  return { ledger, template, requisites, outDir };
}

function cleanup() {
  server.close();
  for (const dir of [userData, dataRoot, workDir]) fs.rmSync(dir, { recursive: true, force: true });
}

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test",
      model: "anthropic/claude-sonnet-5",
      temperature: 0.7,
      maxTokens: 4000,
      proxyMode: "direct",
      searchEnabled: false,
    })
  );

  const fixtures = await makeFixtures();
  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      let win;
      const deadline = Date.now() + 20000;
      while (!win && Date.now() < deadline) {
        [win] = BrowserWindow.getAllWindows();
        if (!win) await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((resolve) => {
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once("did-finish-load", resolve);
      });
      const call = (expr) => win.webContents.executeJavaScript(expr);

      console.log("раздел в меню");
      await new Promise((r) => setTimeout(r, 1200));
      const menu = await call(`[...document.querySelectorAll(".sidebar-item")].map(n => n.textContent).join("|")`);
      check("«Документооборот» есть в меню", menu.includes("Документооборот"), menu);

      console.log("\nсправочники");
      const config = {
        counterparties: [{ id: "c1", name: "ИП Павлов", requisitesPath: fixtures.requisites }],
        templates: [{ id: "t1", name: "Акт типовой", kind: "act", path: fixtures.template }],
        sources: [],
        ledgerPath: fixtures.ledger,
        archivePath: "",
        outputPath: fixtures.outDir,
      };
      await call(`window.api.saveDocflowConfig(${JSON.stringify(config)})`);
      const back = await call(`window.api.getDocflowConfig()`);
      check("справочники сохранились", back.counterparties[0].name === "ИП Павлов" && back.ledgerPath === fixtures.ledger);

      console.log("\nсборка задания");
      const prepared = await call(
        `window.api.prepareDocflow(${JSON.stringify({
          kindId: "act",
          mode: "template",
          month: "2026-08",
          templatePath: fixtures.template,
          requisitesPath: fixtures.requisites,
          dataPaths: [],
          sourcePaths: [],
          ledgerPath: fixtures.ledger,
          counterpartyName: "ИП Павлов",
        })})`
      );
      check("сверка прочитана", prepared.ledgerFound === true);
      check("следующий номер посчитан приложением", prepared.nextNumber === 42, String(prepared.nextNumber));
      check("дата акта — конец месяца", prepared.date === "31.08.2026", prepared.date);
      check("блоки шаблона переданы агенту", prepared.templateBlocks === 5, String(prepared.templateBlocks));
      check("реквизиты попали в промпт", prepared.prompt.includes("ИНН 590000000000"));
      check("нечитаемых исходников нет", prepared.problems.length === 0, JSON.stringify(prepared.problems));

      console.log("\nразбор ответа агента");
      const parsed = await call(`window.api.parseDocflowResult(${JSON.stringify(AGENT_REPLY)})`);
      check("ответ разобран", parsed && parsed.ops.length === 2, JSON.stringify(parsed?.meta));

      console.log("\nсохранение документа");
      const saved = await call(
        `window.api.saveDocflowResult(${JSON.stringify({
          mode: "template",
          templatePath: fixtures.template,
          ops: [
            { op: "set", index: 0, text: "АКТ № 42 от 31.08.2026" },
            { op: "set", index: 4, text: "Сумма: 120 000 руб." },
          ],
          markdown: "",
          meta: {
            number: "42",
            date: "31.08.2026",
            counterparty: "ИП Павлов",
            sum: "120000",
            filename: "Акт №42 от 31.08.2026",
          },
          outputDir: fixtures.outDir,
          kindId: "act",
          ledgerPath: fixtures.ledger,
          writeLedger: true,
        })})`
      );
      check("файл .docx создан", fs.existsSync(saved.docxPath), saved.docxPath);
      check("имя файла взято из ответа агента", path.basename(saved.docxPath) === "Акт №42 от 31.08.2026.docx", saved.docxPath);

      const word = require("./word.cjs");
      const result = await word.loadDocument(saved.docxPath);
      check("данные подставлены", result.blocks[0].text === "АКТ № 42 от 31.08.2026", result.blocks[0].text);
      check(
        "текст шаблона не тронут",
        result.blocks[3].text === "Работы выполнены в полном объёме, претензий нет.",
        result.blocks[3].text
      );
      check("шаблон на диске остался шаблоном", (await word.loadDocument(fixtures.template)).blocks[0].text === "АКТ № ___ от ___");

      // Word на этой машине не установлен, поэтому проверяется именно запасной путь.
      check("PDF собран запасным способом", Boolean(saved.pdfPath) && fs.existsSync(saved.pdfPath), saved.pdfError);
      check("приложение честно говорит, чем собрало PDF", saved.pdfVia === "render", saved.pdfVia);

      console.log("\nзапись в документ сверки");
      check("строка дописана", Array.isArray(saved.ledgerRow), saved.ledgerError);
      const docflow = require("./docflow.cjs");
      const ledgerAfter = await docflow.readLedger(fixtures.ledger);
      const last = ledgerAfter.rows[ledgerAfter.rows.length - 1].values;
      check("в сверке номер, дата, контрагент и сумма", last[0] === "42" && last[3] === "ИП Павлов" && last[4] === "120000", last.join(" | "));
      check("следующий акт получит номер 43", docflow.lastNumber(ledgerAfter, "Акт") === 42);

      console.log("\nWord: анализ и свежий чат");
      await call(`window.api.openWordFile(${JSON.stringify(fixtures.template)})`);
      const editPrompt = await call(`window.api.buildWordAgentPrompt("edit")`);
      const analyzePrompt = await call(`window.api.buildWordAgentPrompt("analyze")`);
      check("в режиме правок объяснён формат правки", editPrompt.includes("===WORD EDIT START==="));
      check("в режиме анализа правок не предлагают", !analyzePrompt.includes("===WORD EDIT START==="));
      check("в режиме анализа сказано искать ошибки и риски", analyzePrompt.includes("ошибки") && analyzePrompt.includes("риски"));
      check("документ виден в обоих режимах", analyzePrompt.includes("АКТ № ___"));
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanup();
      app.exit(failures === 0 ? 0 : 1);
    }
  });
});
