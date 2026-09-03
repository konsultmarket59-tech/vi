// Нажатие «Собрать» не должно ронять интерфейс:
//   xvfb-run -a npx electron electron/smoke-copy-build.cjs
//
// Так это и случилось: эффект прокрутки журнала был записан стрелкой без
// фигурных скобок, а scrollIntoView в этой версии Chromium возвращает Promise —
// React принял его за функцию очистки, вызвал на следующем запуске и, получив
// «не функция», снёс всё дерево. Человек увидел пустое белое окно и «ничего не
// происходит»: ни кнопок, ни причины, ни намёка, что делать.
//
// Поэтому проверяется не отдельная функция, а то же, что видит человек: после
// нажатия интерфейс жив, шаги сборки видны, а отказ объяснён по-человечески.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "copy-build-ud-"));
const docs = fs.mkdtempSync(path.join(os.tmpdir(), "copy-build-docs-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "copy-build-repo-"));
fs.writeFileSync(path.join(repo, "README.md"), "# тест\n");

app.setPath("userData", userData);
app.setPath("documents", docs);
fs.writeFileSync(
  path.join(userData, "config.json"),
  JSON.stringify({ workspace: repo, settings: { proxyMode: "direct" } })
);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  for (const dir of [userData, docs, repo]) fs.rmSync(dir, { recursive: true, force: true });
}

/** Заполняет поле так же, как человек: React слышит input. */
function fill(finder, value) {
  return `
    (() => {
      const input = ${finder};
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()
  `;
}

require("./main.cjs");

app.whenReady().then(async () => {
  const crashes = [];
  try {
    let win;
    const deadline = Date.now() + 20000;
    while (!win && Date.now() < deadline) {
      [win] = BrowserWindow.getAllWindows();
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    win.webContents.on("console-message", (event) => {
      const message = (event && event.message) || "";
      if (/TypeError|is not a function|Uncaught/.test(message)) crashes.push(message);
    });
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once("did-finish-load", resolve);
    });
    const js = (expression) => win.webContents.executeJavaScript(expression);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    while (Date.now() < deadline && !(await js(`document.querySelectorAll(".tab").length > 0`))) await wait(200);
    await js(`[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Демо").click()`);
    await wait(800);

    console.log("заполняем демо-копию");
    check(
      "ключ подписи создаётся",
      await js(`(() => { const b=[...document.querySelectorAll(".btn")].find(b=>/Создать ключ/.test(b.textContent||"")); if(b) b.click(); return !!b; })()`)
    );
    await wait(1500);
    check(
      "имя копии введено",
      await js(fill(`[...document.querySelectorAll("input")].find(i => (i.placeholder||"").includes("Мария Петрова"))`, "Мария Тестова"))
    );
    await wait(400);
    check(
      "ключ Polza введён",
      await js(fill(`[...document.querySelectorAll("input")].find(i => (i.placeholder||"").includes("человек не увидит"))`, "тестовый-ключ"))
    );
    await wait(400);

    console.log("\nнажимаем «Собрать»");
    await js(`[...document.querySelectorAll(".btn")].find(b=>b.textContent==="Собрать").click()`);

    let state = null;
    for (let i = 0; i < 15; i++) {
      await wait(1000);
      state = await js(`({
        alive: (document.getElementById("root")||{}).childElementCount || 0,
        crashScreen: !!document.querySelector(".crash-screen"),
        log: (document.querySelector(".build-log")||{}).textContent || "",
        error: (document.querySelector(".error-text")||{}).textContent || "",
      })`).catch((e) => ({ alive: 0, error: "страница не отвечает: " + e.message }));
      if (state.error || /Остановлено|Готово/.test(state.log)) break;
    }

    // Главное: интерфейс на месте. Белый экран здесь означал бы, что человек
    // остался без единой кнопки и без объяснения.
    check("интерфейс жив, а не белый экран", state.alive > 0, JSON.stringify(state));
    check("экран падения не понадобился", !state.crashScreen, JSON.stringify(state));
    check("в консоли нет исключений", crashes.length === 0, crashes.join(" | "));
    check("видно, что происходило", /GitHub|Проверяю|Скачиваю|Остановлено/.test(state.log), state.log);
    // Токена GitHub в тесте нет — отказ обязан быть человеческим, а не «Error
    // invoking remote method».
    check("отказ объяснён", /токен GitHub/i.test(state.error + state.log), state.error || state.log);
    check(
      "без внутренних имён методов",
      !/invoking remote method/i.test(state.error + state.log),
      state.error || state.log
    );

    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-copy-build.png"), img.toPNG())
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
