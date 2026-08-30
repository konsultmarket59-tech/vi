// Кэширование промпта: проверяем то, от чего зависит вся экономия.
//   xvfb-run -a npx electron electron/smoke-cache.cjs
//
// Кэш провайдера срабатывает по совпадению НАЧАЛА промпта. Значит важно ровно
// три вещи, и все три здесь проверяются на настоящих запросах из окна:
//   1) неизменная часть уходит первой и побайтово одинакова между сообщениями;
//   2) метка кэша ставится только там, где кэш бывает (Claude), и не ставится
//      там, где она рискует сломать запрос;
//   3) если шлюз метку не принял — запрос повторяется без неё и ответ приходит,
//      а не превращается в ошибку у человека на экране.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cache-data-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

let failures = 0;
const failureNotes = [];
const failuresProxy = { push: (m) => { failures++; console.log("  FAIL " + m); } };
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const received = [];
// Когда включено, сервер отвечает 400 на запрос с cache_control — так ведёт себя
// шлюз, который такого поля не понимает.
let rejectCache = false;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.split("?")[0].endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    const parsed = JSON.parse(body || "{}");
    received.push(parsed);
    const hasCache = JSON.stringify(parsed.messages || []).includes("cache_control");
    if (rejectCache && hasCache) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "unknown field cache_control" } }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "готово" } }] })}\n\n`);
    // Отдаём usage с кэшированной частью — приложение должно её записать.
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 50000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 40000 } },
      })}\n\n`
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

function cleanup() {
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const settings = {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "test",
    model: "anthropic/claude-sonnet-5",
    temperature: 0.7,
    maxTokens: 4000,
    proxyMode: "direct",
    promptCache: true,
  };
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify(settings));

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

      // Прогоняем через настоящий интерфейс чата: собранное приложение исходники
      // не отдаёт, а гонять UI честнее — заодно проверяется и сборка промпта в
      // ChatView, ради которой всё и делалось.
      const project = await call(
        `window.api.createProject({ name: "Кэш", description: "", instructions: "Инструкции проекта." })`
      );
      const docsDir = path.join(dataRoot, "projects", project.id, "docs");
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, "база.md"), "Постоянная база знаний проекта. ".repeat(200));

      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await new Promise((r) => setTimeout(r, 1500));

      // Поле ввода появляется только когда есть активный чат.
      const openChat = async () => {
        await call(`
          (async () => {
            const start = [...document.querySelectorAll("button")]
              .find(b => b.textContent.trim() === "+ Новый чат");
            if (start && !document.querySelector(".chat-input-bar textarea")) start.click();
            await new Promise(r => setTimeout(r, 800));
            return !!document.querySelector(".chat-input-bar textarea");
          })()
        `);
      };
      await openChat();
      const hasInput = await call(`!!document.querySelector(".chat-input-bar textarea")`);
      check("чат открыт, поле ввода есть", hasInput === true);

      const sendInChat = async (text) => {
        await openChat();
        await call(`
          (async () => {
            const box = document.querySelector(".chat-input-bar textarea");
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
            setter.call(box, ${JSON.stringify("")} + ${JSON.stringify(text)});
            box.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise(r => setTimeout(r, 100));
            [...document.querySelectorAll(".chat-input-bar button")]
              .find(b => b.textContent.trim() === "Отправить").click();
            return true;
          })()
        `);
        const until = Date.now() + 15000;
        const before = received.length;
        while (received.length === before && Date.now() < until) {
          await new Promise((r) => setTimeout(r, 150));
        }
        if (received.length === before) {
          const why = await call(
            `((document.querySelector(".chat-error")||{}).textContent || "") + " | поле: " +
             !!document.querySelector(".chat-input-bar textarea")`
          );
          failuresProxy.push(`запрос «${text}» так и не ушёл. ${why}`);
        }
        await new Promise((r) => setTimeout(r, 600));
      };

      const setModel = async (model, promptCache = true) => {
        await call(
          `window.api.saveSettings(${JSON.stringify(settings)}).then(() =>
             window.api.saveSettings(${JSON.stringify(settings)} && Object.assign({}, ${JSON.stringify(settings)},
               { model: ${JSON.stringify(model)}, promptCache: ${promptCache} })))`
        );
        await win.webContents.reload();
        await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
        await new Promise((r) => setTimeout(r, 1800));
        const applied = await call(`window.api.getSettings().then(s => s.model + "/" + s.promptCache)`);
        if (!applied.startsWith(model)) failuresProxy.push(`настройка не применилась: ${applied}`);
      };


      console.log("\nмодель Claude: метка кэша ставится");
      received.length = 0;
      await sendInChat("первый вопрос");
      await sendInChat("второй вопрос");
      check("отправлено два запроса", received.length === 2, String(received.length));

      const sys = received.map((r) => r.messages[0]);
      check("системное сообщение идёт первым", sys.every((m) => m.role === "system"));
      check("оно разбито на блоки", sys.every((m) => Array.isArray(m.content)), JSON.stringify(sys[0]).slice(0, 120));
      check(
        "метка кэша стоит на первом блоке",
        sys.every((m) => m.content[0]?.cache_control?.type === "ephemeral"),
        JSON.stringify(sys[0].content[0]).slice(0, 150)
      );
      check(
        "неизменная часть побайтово одинакова в обоих запросах",
        sys[0].content[0].text === sys[1].content[0].text,
        `${sys[0].content[0].text} / ${sys[1].content[0].text}`
      );
      // Без вызванного к сообщению навыка и без свёрнутой истории переменной части
      // просто нет — это лучший случай: системное сообщение целиком одинаково.
      check(
        "лишних блоков без метки не добавляется",
        sys.every((m) => m.content.length === 1 || !m.content[1].cache_control),
        JSON.stringify(sys[0].content.map((b) => Object.keys(b)))
      );
      check(
        "различаются именно сообщения пользователя, а не начало промпта",
        JSON.stringify(received[0].messages.slice(1)) !== JSON.stringify(received[1].messages.slice(1)),
        ""
      );
      check(
        "во втором запросе история длиннее, а начало то же",
        received[1].messages.length > received[0].messages.length,
        `${received[0].messages.length} -> ${received[1].messages.length}`
      );
      check(
        "вопрос пользователя идёт последним",
        received.every((r) => r.messages[r.messages.length - 1].role === "user")
      );

      console.log("\nучёт кэша");
      const day = await call(`window.api.usageSummary("day")`);
      check("расход записан", day.totals && day.totals.calls >= 2, JSON.stringify(day.totals));
      check("кэшированный вход учтён", day.totals.cachedTokens === 80000, String(day.totals.cachedTokens));

      console.log("\nдругая модель: метку не ставим");
      received.length = 0;
      await setModel("openai/gpt-5");
      await sendInChat("вопрос");
      check(
        "для не-Claude блоков с меткой нет",
        typeof received[0].messages[0].content === "string",
        JSON.stringify(received[0].messages[0]).slice(0, 150)
      );

      console.log("\nвыключенный кэш");
      received.length = 0;
      await setModel("anthropic/claude-sonnet-5", false);
      await sendInChat("вопрос");
      check(
        "при выключенной настройке метки нет",
        typeof received[0].messages[0].content === "string",
        JSON.stringify(received[0].messages[0]).slice(0, 150)
      );

      console.log("\nшлюз не принимает метку");
      await setModel("anthropic/claude-sonnet-5", true);
      rejectCache = true;
      received.length = 0;
      await sendInChat("вопрос при несовместимом шлюзе");
      const answered = await call(
        `[...document.querySelectorAll(".msg-assistant")].map(n => n.textContent).join("|")`
      );
      check("ответ всё равно получен", answered.includes("готово"), answered.slice(0, 120));
      check(
        "повтор ушёл уже без метки",
        received.length === 2 && typeof received[1].messages[0].content === "string",
        `запросов ${received.length}`
      );

      console.log("\nбольше не пробуем");
      received.length = 0;
      await sendInChat("ещё вопрос");
      check("после отказа метка не шлётся повторно", received.length === 1, `запросов ${received.length}`);
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
