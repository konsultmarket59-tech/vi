// Проверка того, что человек видит ответ на вопрос «подключилось или нет»:
//   xvfb-run -a npx electron electron/smoke-connection.cjs
//
// Раньше и успех, и ошибка выводились одинаковым серым текстом. Здесь проверяется
// поведение целиком: до проверки статуса нет, после верного ключа — зелёная
// галочка, после правки данных галочка снимается (иначе она врёт про новый ключ),
// а на мёртвом адресе — красная ошибка с описанием причины.

const { app, BrowserWindow } = require("electron");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-conn-ud-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-conn-repo-"));
fs.writeFileSync(path.join(repo, "README.md"), "# Тестовый проект\n");

// Поддельный OpenAI-совместимый сервер: настоящий до Polza из этой среды нет.
const server = http.createServer((req, res) => {
  if (req.url.endsWith("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({ data: [{ id: "test/model", name: "Test" }, { id: "test/two", name: "Two" }] })
    );
  }
  res.writeHead(404);
  res.end();
});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function waitForWindow() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const tick = () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) return resolve(win);
      if (Date.now() > deadline) return reject(new Error("окно так и не появилось"));
      setTimeout(tick, 100);
    };
    tick();
  });
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

/** Правит поле и сообщает об этом React так же, как это делает человек. */
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

/**
 * Уводит фокус с поля. React слушает focusout, а не blur: blur по стандарту не
 * всплывает, и синтетический blur до обработчика onBlur просто не доходит.
 */
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
  // Порт известен только здесь, а конфиг нужен до того, как main.cjs его прочитает.
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
          apiKey: "",
          model: "test/model",
          // «direct» держит прокси контейнера в стороне от проверки.
          proxyMode: "direct",
        },
      },
      null,
      2
    )
  );

  require("./main.cjs");
  app.whenReady().then(run);
});

async function run() {
  try {
    const win = await waitForWindow();
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once("did-finish-load", resolve);
    });
    const js = (expression) => win.webContents.executeJavaScript(expression);

    // Приложение грузится асинхронно: до появления вкладок кликать не по чему.
    await waitUntil(win, `document.querySelectorAll(".tab").length > 0`, "приложение загрузилось");
    await js(`[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Настройки").click()`);
    await waitUntil(win, `!!document.querySelector(".settings-view")`, "настройки открылись");

    console.log("\nключ Polza");
    check("до проверки статуса нет", (await js(`document.querySelectorAll(".conn-status").length`)) === 0);

    check("поле ключа найдено", await js(setFieldScript(`document.querySelector(".api-key-input")`, "test-key")));
    // Между вводом и уходом фокуса React должен перерисоваться — иначе обработчик
    // увидит ещё пустой ключ, как это было бы и у человека, печатающего вслепую.
    await new Promise((r) => setTimeout(r, 300));
    await js(blurFieldScript(`document.querySelector(".api-key-input")`));
    await waitUntil(win, `!!document.querySelector(".conn-ok")`, "после ввода ключа появилась галочка");
    const okText = await js(`(document.querySelector(".conn-ok")||{}).textContent || ""`);
    check("галочка зелёная и говорит, что подключение работает", /подключение работает/i.test(okText), okText);
    check("и сколько моделей доступно", /моделей доступно 2/.test(okText), okText);

    console.log("\nправка данных снимает старую галочку");
    await js(
      setFieldScript(`[...document.querySelectorAll(".input")].find(i => i.value.includes("127.0.0.1"))`, "http://127.0.0.1:1/v1")
    );
    await new Promise((r) => setTimeout(r, 300));
    check(
      "старая галочка снята — она относилась к прежнему адресу",
      await js(`!!document.querySelector(".conn-stale")`),
      await js(`(document.querySelector(".conn-status")||{}).className || "статуса нет"`)
    );

    console.log("\nмёртвый адрес");
    await js(blurFieldScript(`[...document.querySelectorAll(".input")].find(i => i.value.includes("127.0.0.1:1"))`));
    await waitUntil(win, `!!document.querySelector(".conn-error")`, "неверный адрес даёт красную ошибку", 30000);
    const errText = await js(`(document.querySelector(".conn-error")||{}).textContent || ""`);
    check("в ошибке есть описание причины, а не просто «ошибка»", errText.length > 40, errText);
    // Технический код Chromium сам по себе ничего не объясняет — рядом должно
    // стоять, что это значит и что проверить.
    check(
      "причина объяснена по-человечески, а не кодом движка",
      /порт|адрес|прокси|ключ|интернет|сертификат|не ответил/i.test(errText),
      errText
    );
    console.log("    текст ошибки:", errText.replace(/^✕/, "").trim());

    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-connection.png"), img.toPNG())
    );
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    server.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
    app.exit(failures === 0 ? 0 : 1);
  }
}
