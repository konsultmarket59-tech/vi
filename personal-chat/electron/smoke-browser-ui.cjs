// Раздел «Браузер» в окне: роли, переговорка, телефон и сохранение результата.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-browser-ui.cjs
//
// Модель поддельная: локальный сервер отвечает готовым текстом. Проверяется путь
// целиком — от пункта меню до файла Word, который человек потом откроет, и до
// того же разговора, открытого с телефона по коду.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "brw-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brw-data-"));
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

// Что «сказала» модель. Одинаково на любой запрос — нам важен путь, а не текст.
const ОТВЕТ = "Моё мнение по задаче.\n\n| Шаг | Кто | Срок |\n| --- | --- | --- |\n| Проверить спрос | Аналитик | неделя |";
const запросы = [];

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      запросы.push(JSON.parse(body));
    } catch {
      /* тело не разобралось — для проверок ниже это просто пропуск */
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: ОТВЕТ } }] }));
  });
});

function cleanup() {
  try {
    server.close();
  } catch {
    /* уже закрыт */
  }
  for (const d of [userData, dataRoot]) fs.rmSync(d, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test",
      model: "m",
      temperature: 0.7,
      maxTokens: 4000,
      proxyMode: "direct",
      searchEnabled: false,
    })
  );

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
        if (await call(`!!document.querySelector(".sidebar-item")`)) break;
        await new Promise((r) => setTimeout(r, 200));
      }

      console.log("раздел на месте");
      const меню = await call(`[...document.querySelectorAll(".sidebar-item")].map(n=>n.textContent).join("|")`);
      check("пункт «Браузер» есть в меню", /Браузер/.test(меню), меню);
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Браузер")).click()`);
      await new Promise((r) => setTimeout(r, 800));
      check("строка адреса на месте", (await call(`!!document.querySelector(".brw-address")`)) === true);
      check("окно сайта на месте", (await call(`!!document.querySelector("webview")`)) === true);

      console.log("\nкоманда ролей");
      const роли = await call(`window.api.listRoles()`);
      check("ролей не меньше десяти", роли.length >= 10, String(роли.length));
      check(
        "нужные специалисты на месте",
        ["stylist", "marketer", "economist", "construction", "health"].every((id) =>
          роли.some((r) => r.id === id)
        )
      );
      await call(`[...document.querySelectorAll(".vs-tab")].find(n => n.textContent.includes("Команда")).click()`);
      await new Promise((r) => setTimeout(r, 400));
      check("карточки ролей показаны", (await call(`document.querySelectorAll(".brw-role-card").length`)) >= 10);

      console.log("\nпереговорка");
      const проект = await call(
        `window.api.createProject({ name: "Доставка", description: "", instructions: "Мы возим еду по городу." })`
      );
      const комната = await call(
        `window.api.createRoleChat({ kind: "room", roleIds: ["marketer", "economist"], rounds: 1, projectId: ${JSON.stringify(
          проект.id
        )} })`
      );
      check("разговор привязан к проекту", комната.projectId === проект.id);

      const ход = await call(
        `window.api.sendToRoles({ chatId: ${JSON.stringify(комната.id)}, text: "Стоит ли запускать доставку?" })`
      );
      check("ход начался", typeof ход.jobId === "string" && ход.jobId.length > 10);

      let состояние = { done: false };
      const ждём = Date.now() + 30000;
      while (Date.now() < ждём) {
        состояние = await call(`window.api.roleJobStatus(${JSON.stringify(ход.jobId)})`);
        if (состояние.done) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      check("ход закончился без ошибки", состояние.done && !состояние.error, состояние.error);
      check("две роли и итог встречи", состояние.messages.length === 3, String(состояние.messages.length));
      check("итог помечен", состояние.messages[2].summary === true);

      const сохранён = await call(`window.api.openRoleChat(${JSON.stringify(комната.id)})`);
      check("реплики легли в файл разговора", сохранён.messages.length === 4, String(сохранён.messages.length));
      check("реплики подписаны ролями", сохранён.messages[1].name === "Маркетолог", сохранён.messages[1].name);

      const системные = запросы.map((з) => (Array.isArray(з.messages[0].content) ? з.messages[0].content.map((p) => p.text).join("") : з.messages[0].content));
      check("роль получила свой промпт", системные.some((s) => s.includes("Ты — Маркетолог")));
      check("инструкция проекта доехала до роли", системные.some((s) => s.includes("Мы возим еду по городу")));
      check("в переговорке есть правила разговора", системные.some((s) => s.includes("ПЕРЕГОВОРКА")));
      check(
        "поиск выключен — подсказки про интернет нет",
        !системные.some((s) => s.includes("===WEB SEARCH===")),
        ""
      );

      console.log("\nтелефон");
      const статус = await call(`window.api.phoneStart(0)`);
      check("сервер для телефона поднялся", статус.running === true);
      const адрес = `http://127.0.0.1:${статус.port}`;
      const вход = await fetch(`${адрес}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: статус.code }),
      });
      const { token } = await вход.json();
      check("вход по коду с телефона работает", typeof token === "string" && token.length > 20);

      const позвать = async (method, ...args) => {
        const res = await fetch(`${адрес}/api/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ method, args }),
        });
        const данные = await res.json();
        if (!res.ok) throw new Error(данные.error);
        return данные.result;
      };
      const состояниеТелефона = await позвать("state");
      check("телефон видит те же роли", состояниеТелефона.roles.length === роли.length);
      check("телефон видит тот же разговор", состояниеТелефона.chats.some((c) => c.id === комната.id));

      const файл = await позвать("saveChat", комната.id, "docx");
      check("Word сохранён без диалога", fs.existsSync(файл) && fs.statSync(файл).size > 5000, файл);
      check("файл лёг в папку проекта", файл.includes(проект.id) || файл.includes("Доставка"), файл);
      const книга = await позвать("saveChat", комната.id, "xlsx");
      check("Excel сохранён", fs.existsSync(книга) && fs.statSync(книга).size > 3000, книга);

      await call(`window.api.phoneStop()`);
      const послеВыключения = await fetch(`${адрес}/api/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ method: "state", args: [] }),
      }).catch(() => null);
      check("после выключения телефон не достучится", послеВыключения === null);

      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    } catch (e) {
      failures++;
      console.error("Непойманная ошибка:", e);
    } finally {
      cleanup();
      finish(failures, (c) => app.exit(c));
    }
  });
});
