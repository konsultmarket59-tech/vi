// Раздел «Сайты» в окне: материалы, сборка, просмотр блока и код для Тильды.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-sites-ui.cjs
//
// Модель настоящая не нужна: поднимаем поддельный сервер, который отвечает
// размеченным ответом агента. Проверяется путь от кнопки до кода, который
// человек понесёт в Тильду, — а не то, как пишет модель.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { finish } = require("./smoke-finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sites-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sites-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sites-work-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const ОТВЕТ = [
  "=== ПЛАН ===",
  "Аудитория: семьи с детьми. Целевое действие — заявка на просмотр.",
  "",
  "=== БЛОК 1 ===",
  "--- НАЗВАНИЕ ---",
  "Первый экран",
  "--- СТРАНИЦА ---",
  "главная",
  "--- ЗАДАЧА ---",
  "Показать дом и позвать на просмотр.",
  "--- HTML ---",
  '<h2 class="t">Дом у леса</h2><p>Готов к заселению</p>',
  "--- CSS ---",
  "h2 { font-size: 32px } .t { color: #222 }",
  "--- JS ---",
  "",
  "=== ФОРМА 1 ===",
  "Блок Тильды «Форма». Поля: имя, телефон.",
  "",
  "=== ЗАМЕТКИ ===",
  "[УТОЧНИТЬ: цена]",
].join("\n");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: ОТВЕТ } }] }));
  });
});

function cleanup() {
  try { server.close(); } catch { /* уже закрыт */ }
  for (const d of [userData, dataRoot, workDir]) fs.rmSync(d, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { cleanup(); process.exit(1); });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test", model: "m", temperature: 0.7, maxTokens: 4000,
      proxyMode: "direct", searchEnabled: false,
    })
  );

  // Материалы, которые «лежат на компьютере».
  const текстДир = path.join(workDir, "тексты");
  fs.mkdirSync(текстДир);
  fs.writeFileSync(path.join(текстДир, "о посёлке.txt"), "Дома у леса, газобетон, участок 8 соток.", "utf-8");

  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      let win;
      const deadline = Date.now() + 25000;
      while (!win && Date.now() < deadline) {
        [win] = BrowserWindow.getAllWindows();
        if (!win) await new Promise((r) => setTimeout(r, 100));
      }
      if (!win) throw new Error("окно не появилось");
      await new Promise((resolve) => {
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once("did-finish-load", resolve);
      });
      const call = (js) => win.webContents.executeJavaScript(js);

      const until = Date.now() + 20000;
      while (Date.now() < until) {
        if (await call(`!!document.querySelector(".sidebar-footer .sidebar-item")`)) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      console.log("раздел на месте");
      const меню = await call(`[...document.querySelectorAll(".sidebar-footer .sidebar-item")].map(n=>n.textContent).join("|")`);
      check("пункт «Сайты» есть в меню", /Сайты/.test(меню), меню);
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Сайты")).click()`);
      await new Promise((r) => setTimeout(r, 600));
      check("раздел открылся", (await call(`!!document.querySelector(".vs-form")`)) === true);

      console.log("\nместо занято делом, а не объяснениями");
      // Раздел с ключами Тильды убран: он занимал экран, объясняя, чего сделать
      // нельзя. Невозможность экспорта — факт, но он не стоит места в разделе.
      const текст = await call(`document.body.textContent`);
      check("объяснений про невозможность экспорта в разделе нет",
        !/все — на чтение|метода, который создаёт/.test(текст), "");
      check("полей для ключей Тильды нет",
        !/Публичный ключ|Секретный ключ/.test(текст), "");
      check("сказано, что референсы агент видит", /он видит/.test(текст), "");

      console.log("\nсборка сайта");
      await call(`window.api.sitesSaveConfig(${JSON.stringify({
        sources: { text: текстДир }, outputDir: workDir,
      })})`);
      const собран = await call(`window.api.sitesGenerate({ title: "Дом у леса", kind: "лендинг", goal: "заявка" })`);
      check("сайт собрался", собран && собран.blocks.length === 1, JSON.stringify(собран && собран.blocks.length));
      check("план разобран", /целевое действие/i.test(собран.plan), собран.plan);
      check("задание на форму отделено", собран.forms.length === 1, JSON.stringify(собран.forms));

      console.log("\nкод, который человек несёт в Тильду");
      const код = await call(`window.api.sitesBlockHtml(${JSON.stringify(собран.blocks[0])})`);
      check("стили ограничены блоком", /\.dyn-1 h2\{/.test(код), код.slice(0, 200));
      check("целой страницы в коде нет", !/<html|<body/i.test(код), код.slice(0, 120));
      check("разметка на месте", /Дом у лесу|Дом у леса/.test(код), код.slice(0, 200));

      console.log("\nвыгрузка в папку");
      const выгрузка = await call(`window.api.sitesExport(${JSON.stringify(собран)})`);
      check("файлы блоков записаны", выгрузка.blocks.length === 1 && fs.existsSync(выгрузка.blocks[0]),
        JSON.stringify(выгрузка.blocks));
      check("памятка записана", fs.existsSync(выгрузка.readmeFile));

      console.log("\nлимит Тильды считается до обращения к ней");
      const лимит = await call(`window.api.sitesTildaLimit()`);
      check("счётчик показывает 150", лимит.limit === 150 && лимит.left === 150, JSON.stringify(лимит));
      // Без ключей запрос не должен уходить вовсе.
      const безКлючей = await call(`window.api.sitesTilda("projects", {}).then(() => "прошло").catch(e => e.message)`);
      check("без ключей запрос отклонён на месте", /ключи Тильды/.test(безКлючей), безКлючей);
      const послеОтказа = await call(`window.api.sitesTildaLimit()`);
      check("отказ не потратил запрос из лимита", послеОтказа.left === 150, JSON.stringify(послеОтказа));

      console.log("\nсекретный ключ не уходит в окно");
      await call(`window.api.sitesSaveConfig(${JSON.stringify({ publickey: "pub", secretkey: "СЕКРЕТ" })})`);
      const конфиг = await call(`window.api.sitesConfig()`);
      check("вместо ключа окну отдана метка", конфиг.secretkey === "сохранён", JSON.stringify(конфиг.secretkey));
      check("но известно, что ключ задан", конфиг.hasSecret === true, JSON.stringify(конфиг));
      // Метка не должна затереть настоящий ключ при следующем сохранении.
      await call(`window.api.sitesSaveConfig(${JSON.stringify({ projectId: "7" })})`);
      const снова = await call(`window.api.sitesConfig()`);
      check("настоящий ключ не затёрт меткой", снова.hasSecret === true, JSON.stringify(снова));
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e && e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanup();
      finish(failures, (c) => app.exit(c));
    }
  });
});

app.on("window-all-closed", () => {});
