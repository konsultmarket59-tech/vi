// Launches the real app against a throwaway workspace and checks that the UI
// actually renders and that its IPC round-trips work. Run with:
//   xvfb-run -a npx electron electron/smoke-app.cjs
//
// This drives the production main.cjs — it does not stub anything — so a broken
// preload, a missing handler or a renderer crash fails here rather than on the
// user's machine.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-ud-"));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-repo-"));

fs.mkdirSync(path.join(repo, "src"), { recursive: true });
fs.writeFileSync(path.join(repo, "src", "app.js"), "export function greet(name) {\n  return `Привет, ${name}`;\n}\n");
fs.writeFileSync(path.join(repo, "README.md"), "# Тестовый проект\n");
execFileSync("git", ["init", "-b", "main"], { cwd: repo, stdio: "ignore" });
execFileSync("git", ["config", "user.email", "smoke@example.com"], { cwd: repo, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "Smoke"], { cwd: repo, stdio: "ignore" });
execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "ignore" });
execFileSync("git", ["commit", "-m", "Первый коммит"], { cwd: repo, stdio: "ignore" });
// One uncommitted change so the Git tab has something real to show.
fs.writeFileSync(path.join(repo, "src", "app.js"), "export function greet(name) {\n  return `Здравствуйте, ${name}`;\n}\n");

// Must happen before main.cjs reads it at whenReady.
app.setPath("userData", userData);
fs.writeFileSync(
  path.join(userData, "config.json"),
  JSON.stringify({ workspace: repo, recentWorkspaces: [repo], settings: { apiKey: "" } }, null, 2)
);

require("./main.cjs");

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

/** Polls the renderer until the expression is truthy — the UI loads asynchronously. */
async function waitFor(win, expression, label, timeout = 15000) {
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

const text = (selector) =>
  `(document.querySelector(${JSON.stringify(selector)})||{}).textContent || ""`;

app.whenReady().then(async () => {
  try {
    const win = await waitForWindow();
    win.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) console.log("  [renderer]", message);
    });
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once("did-finish-load", resolve);
    });

    console.log("\nзагрузка");
    await waitFor(win, `!!document.querySelector(".app-shell")`, "оболочка отрисована");
    check("нет ошибки старта", !(await win.webContents.executeJavaScript(text(".error-bar"))).trim());
    check(
      "путь открытой папки показан",
      (await win.webContents.executeJavaScript(text(".workspace-path"))).includes(path.basename(repo))
    );

    console.log("\nдерево файлов");
    // Without an API key the app deliberately opens on Настройки, so the Код tab
    // has to be selected before there is a tree to look at.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Код").click()`
    );
    await waitFor(win, `document.querySelectorAll(".tree-row").length > 0`, "дерево заполнено");
    const treeText = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tree-label")].map(n=>n.textContent).join(",")`
    );
    check("src и README видны в дереве", treeText.includes("src") && treeText.includes("README.md"), treeText);
    check("служебные папки скрыты", !treeText.includes("node_modules"), treeText);

    console.log("\nоткрытие файла и ручное редактирование");
    // Expand src, then click the file — the same path a person takes.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tree-name")].find(n=>n.textContent.includes("src")).click()`
    );
    await waitFor(win, `[...document.querySelectorAll(".tree-name")].some(n=>n.textContent.includes("app.js"))`, "папка раскрылась");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tree-name")].find(n=>n.textContent.includes("app.js")).click()`
    );
    await waitFor(win, `!!document.querySelector(".cm-editor")`, "редактор открылся");
    const editorText = await win.webContents.executeJavaScript(text(".cm-content"));
    check("содержимое файла в редакторе", editorText.includes("Здравствуйте"), editorText.slice(0, 120));
    check(
      "подсветка синтаксиса работает",
      await win.webContents.executeJavaScript(`document.querySelectorAll(".cm-content .ͼ1, .cm-content span[class^='ͼ']").length > 0`)
    );

    // Type into the editor with real key events and save through the real IPC
    // path — this is the manual-coding half of the app, so it gets tested the
    // way a person uses it rather than by poking CodeMirror's internals.
    await win.webContents.executeJavaScript(`document.querySelector(".cm-content").focus(); true`);
    for (const ch of "// правка") {
      win.webContents.sendInputEvent({ type: "char", keyCode: ch });
      await new Promise((r) => setTimeout(r, 12));
    }
    await waitFor(win, `!!document.querySelector(".editor-dirty")`, "появилась пометка «не сохранено»");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".editor-actions .btn")].find(b=>b.textContent==="Сохранить").click()`
    );
    await waitFor(win, `!document.querySelector(".editor-dirty")`, "пометка снялась после сохранения");
    check(
      "правка действительно записана на диск",
      fs.readFileSync(path.join(repo, "src", "app.js"), "utf-8").includes("// правка"),
      fs.readFileSync(path.join(repo, "src", "app.js"), "utf-8")
    );

    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-code.png"), img.toPNG())
    );

    console.log("\nвкладка Git");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Git").click()`
    );
    await waitFor(win, `!!document.querySelector(".git-branch")`, "панель Git отрисована");
    const branch = await win.webContents.executeJavaScript(text(".git-branch"));
    check("ветка определена", branch.trim() === "main", branch);
    const gitFiles = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".git-file-name")].map(n=>n.textContent).join(",")`
    );
    check("изменённый файл виден", gitFiles.includes("src/app.js"), gitFiles);
    const history = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".git-subject")].map(n=>n.textContent).join(",")`
    );
    check("история коммитов загружена", history.includes("Первый коммит"), history);

    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-git.png"), img.toPNG())
    );

    console.log("\nвкладка Сборки");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Сборки").click()`
    );
    await waitFor(win, `document.querySelectorAll(".module-card").length > 0`, "список модулей загружен");
    const moduleCount = await win.webContents.executeJavaScript(`document.querySelectorAll(".module-card").length`);
    check("модулей показано 10", moduleCount === 10, String(moduleCount));
    check(
      "ядро нельзя отключить",
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".module-card input")].some(i=>i.disabled && i.checked)`
      )
    );
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-blueprints.png"), img.toPNG())
    );

    console.log("\nвкладка Демо-доступ");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Демо-доступ").click()`
    );
    await waitFor(win, `!!document.querySelector(".view-title")`, "раздел открылся");
    const demoText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("предлагает создать ключ подписи", demoText.includes("Создать ключ"), demoText.slice(0, 200));
    check("честно описывает предел защиты", demoText.includes("не от целенаправленного взлома"), "");
    // Issuing must be impossible before a key exists, or a half-configured
    // build could be handed out with unsignable licences.
    check(
      "без ключа выгрузка настроек недоступна",
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".btn")].find(b=>b.textContent.includes("Записать настройки"))?.disabled === true`
      )
    );
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-demo.png"), img.toPNG())
    );

    console.log("\nвкладка Настройки");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Настройки").click()`
    );
    await waitFor(win, `!!document.querySelector(".settings-view")`, "настройки отрисованы");
    const settingsText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("есть раздел прокси", settingsText.includes("Прокси"), "");
    check("есть поле ключа Polza", settingsText.includes("Polza"), "");
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-settings.png"), img.toPNG())
    );

    console.log("\nагент без ключа");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Код").click()`
    );
    await waitFor(win, `!!document.querySelector(".agent-pane")`, "панель агента на месте");
    const agentText = await win.webContents.executeJavaScript(text(".agent-pane"));
    check("без ключа агент объясняет, что делать", agentText.includes("ключ Polza"), agentText.slice(0, 160));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    console.log("Скриншоты:", os.tmpdir() + "/personal-code-*.png");
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    app.exit(failures === 0 ? 0 : 1);
  }
});
