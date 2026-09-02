// Задачи по расписанию должны просить провайдера кэшировать неизменную часть
// промпта так же, как это уже делает обычный чат (smoke-cache.cjs) — раньше
// runScheduledTask/callModelOnce в main.cjs собирали системное сообщение
// плоской строкой в обход buildSystemMessage(), так что каждый раунд поиска в
// интернете внутри одной задачи заново оплачивал полный контекст проекта.
//   xvfb-run -a npx electron electron/smoke-tasks-cache.cjs

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-cache-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-cache-data-"));

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

const received = [];

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
    res.writeHead(200, { "Content-Type": "application/json" });
    // Первый раунд просит про несуществующую страницу (ошибка сети вернётся
    // текстом, не бросит исключение — так и задуман websearch.runTools), второй
    // раунд отвечает обычным текстом и завершает цикл.
    const content =
      received.length === 1
        ? "===WEB FETCH===\nURL: http://127.0.0.1.invalid/несуществующая-страница\n===END==="
        : "Готовый дайджест.";
    res.end(
      JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 50000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40000 } },
      })
    );
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
    searchEnabled: true,
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

      const project = await call(
        `window.api.createProject({ name: "Дайджест", description: "", instructions: "Инструкции проекта." })`
      );
      const docsDir = path.join(dataRoot, "projects", project.id, "docs");
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, "база.md"), "Постоянная база знаний проекта. ".repeat(200));

      // Просроченная разовая задача — планировщик подхватит её на ближайшем
      // тике (раз в 30с), ничего запускать вручную не нужно.
      await call(
        `window.api.saveTask(${JSON.stringify(project.id)}, {
          title: "Дайджест SMM-рынка",
          prompt: "Тестовый запрос дайджеста.",
          recurrence: "once",
          date: "2020-01-01",
          time: "00:00",
          enabled: true,
        })`
      );

      console.log("\nзадача по расписанию");
      const until = Date.now() + 40000;
      while (received.length < 2 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 300));
      }
      check("оба раунда прошли", received.length === 2, `запросов: ${received.length}`);

      // Выдача задачи лежит в своём списке, а не среди чатов проекта.
      const runs = await call(`window.api.listTaskRuns(${JSON.stringify(project.id)})`);
      check("создана ровно одна выдача задачи", runs.length === 1, `выдач: ${runs.length}`);
      const convs = await call(`window.api.listConversations(${JSON.stringify(project.id)})`);
      check("чаты проекта задачей не засорены", (convs || []).length === 0, JSON.stringify((convs || []).map((c) => c.title)));

      const sys = received.map((r) => r.messages[0]);
      check("системное сообщение идёт первым", sys.every((m) => m.role === "system"));
      check("оно разбито на блоки с меткой кэша", sys.every((m) => Array.isArray(m.content) && m.content[0]?.cache_control?.type === "ephemeral"));
      check(
        "неизменная часть побайтово одинакова между раундами",
        sys.length === 2 && sys[0].content[0].text === sys[1].content[0].text
      );

      const day = await call(`window.api.usageSummary("day")`);
      check("кэшированный вход учтён по фоновым запросам", day.totals.cachedTokens === 80000, String(day.totals.cachedTokens));

      // Прогоняем ещё раз с несовместимым (не-Claude) шлюзом на всякий случай —
      // задача не должна ломаться, даже если для неё выберут другую модель.
      console.log("\nне-Claude модель: метку не ставим, задача всё равно работает");
      received.length = 0;
      await call(
        `window.api.saveSettings(${JSON.stringify(settings)}).then(() =>
           window.api.saveSettings(Object.assign({}, ${JSON.stringify(settings)}, { model: "openai/gpt-5" })))`
      );
      await call(
        `window.api.saveTask(${JSON.stringify(project.id)}, {
          title: "Ещё одна задача",
          prompt: "Тестовый запрос без кэша.",
          recurrence: "once",
          date: "2020-01-01",
          time: "00:00",
          enabled: true,
        })`
      );
      const until2 = Date.now() + 40000;
      while (received.length < 2 && Date.now() < until2) {
        await new Promise((r) => setTimeout(r, 300));
      }
      check(
        "для не-Claude модели системное сообщение остаётся строкой",
        received.length === 2 && typeof received[0].messages[0].content === "string",
        received.length ? JSON.stringify(received[0].messages[0]).slice(0, 150) : "нет запросов"
      );
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
