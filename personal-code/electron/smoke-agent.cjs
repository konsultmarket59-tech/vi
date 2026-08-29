// End-to-end test of the agent loop against a fake OpenAI-compatible server.
//   xvfb-run -a npx electron electron/smoke-agent.cjs
//
// There is no way to reach a real model from this environment, and more to the
// point a real model would give a different answer every run. The fake server
// returns scripted replies, which lets us prove the parts that are ours: the
// request shape, the read-tool round trip, the proposal, the diff, and that
// nothing touches the disk until "Применить" is pressed.

const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-agent-ud-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-agent-repo-"));

const ORIGINAL = "export function greet(name) {\n  return `Привет, ${name}`;\n}\n";
fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src", "app.js"), ORIGINAL);

// What the fake model says, in order.
const SCRIPT = [
  "Сначала посмотрю файл.\n===TOOL===\nREAD: src/app.js\n===END TOOL===",
  [
    "Меняю приветствие на формальное.",
    "===CODE EDIT START===",
    "FILE: src/app.js",
    "ACTION: replace",
    "<<<<<<< НАЙТИ",
    "  return `Привет, ${name}`;",
    "=======",
    "  return `Здравствуйте, ${name}`;",
    ">>>>>>> ЗАМЕНИТЬ",
    "===CODE EDIT END===",
  ].join("\n"),
];

const requests = [];
let served = 0;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url.endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "test/model", name: "Test" }] }));
    }
    requests.push({ auth: req.headers.authorization, body: JSON.parse(body || "{}") });
    const content = SCRIPT[Math.min(served, SCRIPT.length - 1)];
    served++;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 400) : ""}`);
  }
}

function waitForWindow() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const tick = () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) return resolve(win);
      if (Date.now() > deadline) return reject(new Error("окно не появилось"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function waitFor(win, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await win.webContents.executeJavaScript(expression);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  check(label, false, `не дождались: ${JSON.stringify(last)}`);
  return null;
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;

  app.setPath("userData", userData);
  fs.writeFileSync(
    path.join(userData, "config.json"),
    JSON.stringify(
      {
        workspace: repo,
        recentWorkspaces: [repo],
        settings: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "test-key",
          model: "test/model",
          // "direct" keeps the container's own HTTPS_PROXY out of this test.
          proxyMode: "direct",
        },
      },
      null,
      2
    )
  );

  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      const win = await waitForWindow();
      await new Promise((resolve) => {
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once("did-finish-load", resolve);
      });
      await waitFor(win, `!!document.querySelector(".agent-pane")`, "вкладка Код открылась с ключом");

      console.log("\nдиалог с агентом");
      await win.webContents.executeJavaScript(`
        (() => {
          const box = document.querySelector(".agent-input .textarea");
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(box, "Сделай приветствие формальным");
          box.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `);
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".agent-input .btn")].find(b=>b.textContent==="Отправить").click()`
      );

      await waitFor(win, `!!document.querySelector(".proposal")`, "появилось предложение правок");

      check("модель вызвана дважды (инструмент, затем правка)", requests.length === 2, String(requests.length));
      check("ключ передан в заголовке", requests[0]?.auth === "Bearer test-key", requests[0]?.auth);
      check("модель взята из настроек", requests[0]?.body.model === "test/model", requests[0]?.body.model);
      const systemPrompts = (requests[0]?.body.messages || []).filter((m) => m.role === "system");
      check("в контекст попал список файлов проекта", JSON.stringify(systemPrompts).includes("src/app.js"));
      const secondCall = JSON.stringify(requests[1]?.body.messages || []);
      check("результат чтения файла вернулся модели", secondCall.includes("Привет, ${name}"), secondCall.slice(0, 200));

      const diffText = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".diff-row")].map(r=>r.textContent).join("\\n")`
      );
      check("дифф показывает удаляемую строку", diffText.includes("Привет"), diffText);
      check("дифф показывает добавляемую строку", diffText.includes("Здравствуйте"), diffText);

      check(
        "до подтверждения файл на диске не тронут",
        fs.readFileSync(path.join(repo, "src", "app.js"), "utf-8") === ORIGINAL
      );

      await win.webContents.capturePage().then((img) =>
        fs.writeFileSync(path.join(os.tmpdir(), "personal-code-agent.png"), img.toPNG())
      );

      console.log("\nприменение");
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".proposal-actions .btn")].find(b=>b.textContent==="Применить").click()`
      );
      await waitFor(win, `!document.querySelector(".proposal")`, "предложение исчезло после применения");
      const after = fs.readFileSync(path.join(repo, "src", "app.js"), "utf-8");
      check("файл изменён ровно так, как показывал дифф", after.includes("Здравствуйте") && !after.includes("Привет"), after);

      console.log("\nотклонение");
      served = 0;
      requests.length = 0;
      // Restore the original so the same scripted replacement matches again.
      fs.writeFileSync(path.join(repo, "src", "app.js"), ORIGINAL);
      await win.webContents.executeJavaScript(`
        (() => {
          const box = document.querySelector(".agent-input .textarea");
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          setter.call(box, "Ещё раз");
          box.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        })()
      `);
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".agent-input .btn")].find(b=>b.textContent==="Отправить").click()`
      );
      await waitFor(win, `!!document.querySelector(".proposal")`, "второе предложение появилось");
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".proposal-actions .btn")].find(b=>b.textContent==="Отклонить").click()`
      );
      await waitFor(win, `!document.querySelector(".proposal")`, "предложение исчезло после отклонения");
      check(
        "после отклонения файл остался прежним",
        fs.readFileSync(path.join(repo, "src", "app.js"), "utf-8") === ORIGINAL
      );
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      server.close();
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(userData, { recursive: true, force: true });
      app.exit(failures === 0 ? 0 : 1);
    }
  });
});
