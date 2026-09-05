// Замер: куда уходит время между «нажал отправить» и «пошёл ответ».
//   xvfb-run -a npx electron electron/bench-chat.cjs
//
// Ответ модели измерить отсюда нельзя — интернета нет, да и время модели от нас не
// зависит. Зато можно измерить всё остальное: сборку системного промпта, разбор
// документов, чтение картинок и размер того, что уходит в запрос на каждое
// сообщение. Именно это и есть та часть задержки, на которую мы влияем.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bench-data-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

// Сервер отвечает мгновенно, поэтому всё измеренное время — наше, не модели.
let lastRequestBytes = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    lastRequestBytes = Buffer.byteLength(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "готово" } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

function ms(start) {
  return Math.round(Number(process.hrtime.bigint() - start) / 1e6);
}

const failures = [];
const rows = [];
function row(label, value) {
  rows.push([label, value]);
  console.log(`  ${label.padEnd(52)} ${value}`);
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "bench", model: "test/model", proxyMode: "direct" })
  );

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

      console.log("\nподготовка проекта");
      const project = await call(`window.api.createProject({ name: "Замер", description: "", instructions: "Ты помощник." })`);

      // Документы примерно того объёма, какой бывает у реального проекта:
      // бренд-гайд, пара договоров, выгрузка статистики.
      const docsDir = path.join(dataRoot, "projects", project.id, "docs");
      fs.mkdirSync(docsDir, { recursive: true });
      const bigText = "Раздел бренд-платформы. ".repeat(2000);
      for (const name of ["бренд.md", "договор.md", "статистика.md", "методика.md"]) {
        fs.writeFileSync(path.join(docsDir, name), bigText);
      }
      // .docx разбирается mammoth'ом — это заметно дороже простого текста.
      const docx = path.join(__dirname, "..", "node_modules", ".bench-sample.docx");
      const { Document, Packer, Paragraph } = require("docx");
      const doc = new Document({
        sections: [{ children: Array.from({ length: 400 }, () => new Paragraph("Пункт договора об оказании услуг.")) }],
      });
      fs.writeFileSync(docx, await Packer.toBuffer(doc));
      fs.copyFileSync(docx, path.join(docsDir, "договор.docx"));
      fs.rmSync(docx, { force: true });

      console.log("\nсборка системного промпта (то, что уходит в КАЖДОЕ сообщение)");
      let start = process.hrtime.bigint();
      const prompt1 = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      const first = ms(start);
      row("первая сборка, мс", first);

      start = process.hrtime.bigint();
      await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      const second = ms(start);
      row("повторная сборка, мс", second);
      if (second >= first * 0.5) failures.push("повторная сборка промпта не быстрее — кэш разбора не работает");
      row("экономии от повтора", second < first * 0.5 ? "есть (кэш работает)" : "НЕТ — документы разбираются заново");

      row("размер промпта, символов", prompt1.length.toLocaleString("ru-RU"));
      row("это примерно токенов", Math.round(prompt1.length / 3).toLocaleString("ru-RU"));

      console.log("\nотправка сообщения (сервер отвечает мгновенно)");
      // Сколько байт реально уходит на сервер за одно сообщение.
      await call(`
        (async () => {
          const settings = await window.api.getSettings();
          const res = await fetch(settings.baseUrl.replace(/\\/+$/, "") + "/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + settings.apiKey },
            body: JSON.stringify({
              model: settings.model,
              messages: [{ role: "system", content: ${JSON.stringify(prompt1)} }, { role: "user", content: "привет" }],
              stream: true,
            }),
          });
          await res.text();
          return true;
        })()
      `);
      row("уходит на сервер за одно сообщение, КБ", Math.round(lastRequestBytes / 1024).toLocaleString("ru-RU"));

      console.log("\nисключение документов из контекста");
      const docNames = ["бренд.md", "договор.md", "статистика.md", "методика.md"];
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: ${JSON.stringify(
        docNames.slice(1).map((n) => "docs/" + n)
      )} })`);
      const trimmed = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      row("после снятия трёх галочек, символов", trimmed.length.toLocaleString("ru-RU"));
      row("это примерно токенов", Math.round(trimmed.length / 3).toLocaleString("ru-RU"));
      row(
        "сокращение",
        Math.round((1 - trimmed.length / prompt1.length) * 100) + "%"
      );
      if (!trimmed.includes("бренд.md")) failures.push("оставленный документ пропал из промпта");
      if (trimmed.includes("статистика.md")) failures.push("снятый документ остался в промпте");
      if (trimmed.length >= prompt1.length * 0.6) failures.push("снятие галочек почти не сократило промпт");
      row("оставленный документ всё ещё в промпте", trimmed.includes("бренд.md") ? "да" : "НЕТ — ошибка");
      row("снятый документ ушёл из промпта", trimmed.includes("статистика.md") ? "НЕТ — ошибка" : "да");
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: [] })`);

      console.log("\nпроверка в интерфейсе");
      // Проект создан через IPC уже после загрузки окна, поэтому список проектов
      // в интерфейсе о нём ещё не знает — перезагружаем.
      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await new Promise((r) => setTimeout(r, 1200));
      await call(`
        (async () => {
          [...document.querySelectorAll(".sidebar-item-name")].find(b => b.textContent === "Замер").click();
          await new Promise(r => setTimeout(r, 400));
          [...document.querySelectorAll(".tab")].find(t => t.textContent.includes("Документ")).click();
          await new Promise(r => setTimeout(r, 500));
          return true;
        })()
      `);
      const boxes = await call(`document.querySelectorAll(".doc-include").length`);
      if (boxes !== 5) failures.push(`галочек в списке документов ${boxes}, ожидалось 5`);
      row("галочек «отдавать ассистенту» в списке", boxes);

      // Снимаем галочку кликом — так же, как это сделает человек.
      await call(`document.querySelectorAll(".doc-include")[1].click(); true`);
      await new Promise((r) => setTimeout(r, 600));
      const savedProject = (await call(`window.api.listProjects()`)).find((p) => p.id === project.id);
      if ((savedProject.excludedDocs || []).length !== 1) {
        failures.push("клик по галочке не сохранился в проекте");
      }
      row("клик по галочке сохранился", (savedProject.excludedDocs || []).length === 1 ? "да" : "НЕТ");
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: [] })`);

      console.log("\nвнешняя папка документов");
      // Внешняя папка обычно и есть самая большая часть контекста, поэтому галочки
      // нужны в первую очередь ей: без них сократить промпт там, где он больше
      // всего, было нечем.
      const externalDir = path.join(dataRoot, "внешние документы");
      fs.mkdirSync(externalDir, { recursive: true });
      fs.writeFileSync(path.join(externalDir, "внешний.md"), bigText);
      await call(
        `window.api.updateProject(${JSON.stringify(project.id)}, { externalDocsPath: ${JSON.stringify(externalDir)} })`
      );
      const withExternal = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      if (!withExternal.includes("внешний.md")) failures.push("внешний документ не попал в промпт");
      await call(
        `window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: ["external/внешний.md"] })`
      );
      const withoutExternal = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      if (withoutExternal.includes("внешний.md")) failures.push("снятый внешний документ остался в промпте");
      row("внешний документ снимается с контекста", withoutExternal.includes("внешний.md") ? "НЕТ — ошибка" : "да");
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: [] })`);

      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await new Promise((r) => setTimeout(r, 1200));
      await call(`
        (async () => {
          [...document.querySelectorAll(".sidebar-item-name")].find(b => b.textContent === "Замер").click();
          await new Promise(r => setTimeout(r, 400));
          [...document.querySelectorAll(".tab")].find(t => t.textContent.includes("Документ")).click();
          await new Promise(r => setTimeout(r, 500));
          return true;
        })()
      `);
      const withExternalBoxes = await call(`document.querySelectorAll(".doc-include").length`);
      if (withExternalBoxes !== boxes + 1) {
        failures.push(`у внешнего документа нет галочки: ${withExternalBoxes} вместо ${boxes + 1}`);
      }
      row("галочка появилась и у внешнего документа", withExternalBoxes === boxes + 1 ? "да" : "НЕТ");
      await call(`document.querySelectorAll(".doc-include")[${boxes}].click(); true`);
      await new Promise((r) => setTimeout(r, 600));
      const externalSaved = (await call(`window.api.listProjects()`)).find((p) => p.id === project.id);
      const externalKeys = (externalSaved.excludedDocs || []).filter((k) => k.startsWith("external/"));
      if (externalKeys.length !== 1) failures.push("клик по галочке внешнего документа не сохранился");
      row("клик по внешней галочке сохранился", externalKeys.length === 1 ? "да" : "НЕТ");

      console.log("\nудаление документа");
      // Галочка помнится по имени файла. Если её не убрать вместе с документом,
      // документ с тем же именем, добавленный позже, молча не попадёт в контекст.
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: ["docs/методика.md"] })`);
      await call(`window.api.removeDoc(${JSON.stringify(project.id)}, "методика.md")`);
      const afterRemove = (await call(`window.api.listProjects()`)).find((p) => p.id === project.id);
      const stale = (afterRemove.excludedDocs || []).includes("docs/методика.md");
      if (stale) failures.push("снятая галочка осталась у удалённого документа");
      row("галочка удалённого документа не остаётся", stale ? "НЕТ — осталась" : "да");
      fs.writeFileSync(path.join(docsDir, "методика.md"), bigText);
      const afterReadd = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);
      if (!afterReadd.includes("методика.md")) failures.push("документ с прежним именем не вернулся в контекст");
      row("документ с тем же именем снова в контексте", afterReadd.includes("методика.md") ? "да" : "НЕТ");
      await call(`window.api.updateProject(${JSON.stringify(project.id)}, { excludedDocs: [] })`);

      await win.webContents.capturePage().then((img) =>
        fs.writeFileSync(path.join(os.tmpdir(), "chat-docs-context.png"), img.toPNG())
      );

      console.log("\nкартинки в истории");
      const imgPath = path.join(dataRoot, "фото.png");
      // ~1.5 МБ «фотографии» — типичный размер снимка с телефона после сжатия.
      fs.writeFileSync(imgPath, Buffer.alloc(1_500_000, 7));
      start = process.hrtime.bigint();
      for (let i = 0; i < 5; i++) {
        await call(`window.api.readFileAsDataUrl(${JSON.stringify(imgPath)})`);
      }
      const imgMs = ms(start);
      row("чтение одной картинки 1,5 МБ с диска, мс", Math.round(imgMs / 5));
      row("столько же × число картинок в истории", "раньше — на каждое сообщение");
      row("теперь", "один раз за сеанс: окно чата держит их в кэше");

      console.log("\nвывод");
      console.log(
        "  Наша часть задержки — это размер того, что уходит в каждый запрос,\n" +
          "  плюс повторный разбор документов и повторное чтение картинок.\n" +
          "  Время самой модели зависит от объёма входа: чем больше промпт,\n" +
          "  тем дольше она думает до первого слова."
      );
    } catch (e) {
      failures.push("непойманная ошибка: " + e.message);
    } finally {
      if (failures.length) {
        console.log("\nПРОВАЛЕНО:");
        for (const f of failures) console.log("  - " + f);
      }
      server.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(dataRoot, { recursive: true, force: true });
      app.exit(failures.length ? 1 : 0);
    }
  });
});
