// Ответ на вопрос «подключилось или нет» в копии, которую получает тестировщик:
//   xvfb-run -a npx electron electron/smoke-connection.cjs
//
// Тестировщик остаётся один на один с настройками, и «серый текст, который надо
// вчитать» здесь дороже, чем у автора: спросить некого. Проверяется поведение
// целиком — до проверки статуса нет, верный ключ даёт зелёную галочку, правка
// данных её снимает, мёртвый адрес даёт красную ошибку с понятной причиной.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conn-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-conn-data-"));

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

const server = http.createServer((req, res) => {
  if (req.url.split("?")[0].endsWith("/models")) {
    // Настоящий сервис без ключа отвечает 401 — иначе проверка на старте с
    // пустым ключом «успешно подключалась» бы к чему угодно.
    if (!/^Bearer .+/.test(req.headers.authorization || "")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "no key" } }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-5" }, { id: "anthropic/claude-opus-5" }] })
    );
  }
  res.writeHead(404);
  res.end();
});

function cleanup() {
  server.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
}

async function waitUntil(win, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  check(label, false, `не дождались: ${expression}`);
  return false;
}

/** Правит поле так же, как человек: React слышит input. */
function setFieldScript(selector, value) {
  return `
    (() => {
      const input = ${selector};
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `;
}

/** Уводит фокус: React слушает focusout, обычный blur до onBlur не доходит. */
function blurFieldScript(selector) {
  return `
    (() => {
      const input = ${selector};
      if (!input) return false;
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      return true;
    })()
  `;
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "",
      model: "anthropic/claude-sonnet-5",
      proxyMode: "direct",
    })
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
      const js = (expression) => win.webContents.executeJavaScript(expression);

      await waitUntil(win, `document.querySelectorAll(".sidebar-item-name, .sidebar-item").length > 0`, "приложение загрузилось");
      await js(`
        (() => {
          const item = [...document.querySelectorAll("button, .sidebar-item")].find(b => /Настройки/.test(b.textContent||""));
          if (item) item.click();
          return true;
        })()
      `);
      await waitUntil(win, `!!document.querySelector(".api-key-input")`, "настройки открылись");

      console.log("\nключ Polza");
      // Пустой ключ при первом запуске — это не сбой подключения, а незаполненная
      // настройка: пугать тестировщика красным при старте нечем.
      const startupStatus = await js(
        `[...document.querySelectorAll(".conn-status")].map(n => n.className + " :: " + n.textContent).join(" | ")`
      );
      check("при пустом ключе на старте не пугает красным", !startupStatus.includes("conn-error"), startupStatus);

      await js(setFieldScript(`document.querySelector(".api-key-input")`, "test-key"));
      await new Promise((r) => setTimeout(r, 300));
      await js(blurFieldScript(`document.querySelector(".api-key-input")`));
      await waitUntil(win, `!!document.querySelector(".conn-ok")`, "после ввода ключа появилась зелёная галочка");
      const okText = await js(`(document.querySelector(".conn-ok")||{}).textContent || ""`);
      check("галочка говорит, что подключение работает", /подключение работает/i.test(okText), okText);
      check("и сколько моделей доступно", /моделей доступно 2/.test(okText), okText);

      console.log("\nправка данных снимает старую галочку");
      await js(setFieldScript(`[...document.querySelectorAll("input")].find(i => (i.value||"").includes("127.0.0.1"))`, "http://127.0.0.1:1/v1"));
      await new Promise((r) => setTimeout(r, 300));
      check(
        "старая галочка снята — она относилась к прежнему адресу",
        await js(`!!document.querySelector(".conn-stale")`),
        await js(`(document.querySelector(".conn-status")||{}).className || "статуса нет"`)
      );

      console.log("\nмёртвый адрес");
      await js(blurFieldScript(`[...document.querySelectorAll("input")].find(i => (i.value||"").includes("127.0.0.1:1"))`));
      await waitUntil(win, `!!document.querySelector(".conn-error")`, "неверный адрес даёт красную ошибку", 30000);
      const errText = await js(`(document.querySelector(".conn-error")||{}).textContent || ""`);
      check("в ошибке есть описание, а не просто «ошибка»", errText.length > 40, errText);
      check(
        "причина объяснена по-человечески, а не кодом движка",
        /порт|адрес|прокси|ключ|интернет|сертификат|не ответил/i.test(errText),
        errText
      );
      console.log("    текст ошибки:", errText.replace(/^✕/, "").trim());

      await win.webContents.capturePage().then((img) =>
        fs.writeFileSync(path.join(os.tmpdir(), "chat-connection.png"), img.toPNG())
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
