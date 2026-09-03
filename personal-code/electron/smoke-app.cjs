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

    console.log("\nвкладка Демо");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Демо").click()`
    );
    await waitFor(win, `document.querySelectorAll(".module-card").length > 0`, "форма копии открылась");
    const demoText = await win.webContents.executeJavaScript(text(".settings-view"));
    // Всё, что нужно для одной копии, вводится на одной странице: имя, срок,
    // ключ, конфигурация, плагины, репозиторий — и кнопка «Собрать».
    // Без ключа подписи демо-копию нельзя активировать, поэтому сборка должна
    // отказывать заранее, а не проваливаться после десяти минут push'а на GitHub.
    check("предлагает создать ключ подписи", demoText.includes("Создать ключ"), demoText.slice(0, 200));
    check("честно описывает предел защиты", demoText.includes("не от целенаправленного взлома"), "");
    check("спрашивает, кому копия", demoText.includes("Кому — имя или название компании"), "");
    check("спрашивает срок доступа", demoText.includes("Срок доступа, дней"), "");
    check("спрашивает ключ Polza", demoText.includes("Ключ Polza для этой копии"), "");
    check("объясняет, что человек ключа не видит", demoText.includes("человек его не видит и не вводит"), "");
    check("спрашивает репозиторий", demoText.includes("Репозиторий этой копии"), "");
    check("предлагает Excel и Word", demoText.includes("Excel") && demoText.includes("Word"), "");
    const pluginNames = require("./copies.cjs").PLUGINS.map((p) => p.name);
    check(
      "все восемь плагинов на месте",
      pluginNames.every((name) => demoText.includes(name)),
      pluginNames.filter((n) => !demoText.includes(n)).join(", ")
    );
    check(
      "кнопка «Собрать» на месте",
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".btn")].some(b=>b.textContent==="Собрать")`
      )
    );
    // Имя копии и название репозитория предлагаются сами — их не набирают дважды.
    await win.webContents.executeJavaScript(`
      (() => {
        const input = [...document.querySelectorAll(".input")].find(i => i.placeholder.includes("Мария Петрова"));
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "Мария Тестова");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
    check(
      "название копии предлагается по имени",
      (await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".input")].map(i=>i.placeholder).join("|")`
      )).includes("Личный чат Мария Тестова")
    );
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-demo-build.png"), img.toPNG())
    );

    console.log("\nвкладка Чистовая сборка");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Чистовая сборка").click()`
    );
    await waitFor(win, `document.querySelectorAll(".module-card").length > 0`, "форма оплаченной копии открылась");
    const paidText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("ключ Polza здесь не спрашивается", !paidText.includes("Ключ Polza для этой копии"), "");
    check("сказано, что ключ вводит сам человек", paidText.includes("Ключ вводит сам человек"), "");
    check("есть защита от копирования", paidText.includes("Защита от копирования"), "");
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-release.png"), img.toPNG())
    );

    console.log("\nвкладка Плагины");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Плагины").click()`
    );
    await waitFor(win, `!!document.querySelector(".view-title")`, "архив плагинов открылся");
    const pluginsText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("объясняет, что версии не перезаписываются", pluginsText.includes("новой версией"), pluginsText.slice(0, 200));
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-plugins.png"), img.toPNG())
    );

    console.log("\nвкладка Фикс");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Фикс").click()`
    );
    await waitFor(win, `!!document.querySelector(".view-title")`, "страница фикса открылась");
    const fixText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("объясняет, что чинится код самой копии", fixText.includes("как обычная рабочая папка"), "");
    check(
      "без собранных копий не притворяется, что готова чинить",
      fixText.includes("Собранных копий пока нет"),
      fixText.slice(0, 200)
    );
    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-code-fix.png"), img.toPNG())
    );

    console.log("\nвкладка Настройки");
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll(".tab")].find(t=>t.textContent==="Настройки").click()`
    );
    await waitFor(win, `!!document.querySelector(".settings-view")`, "настройки отрисованы");
    const settingsText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("есть раздел прокси", settingsText.includes("Прокси"), "");
    check("есть поле ключа Polza", settingsText.includes("Polza"), "");
    // По умолчанию режим «Системный» — логин и пароль прокси видны сразу
    // (прокси Windows тоже может требовать авторизацию), но поле адреса и
    // разъяснение формата появляются только в ручном режиме.
    check("логин прокси виден в системном режиме", settingsText.includes("Логин прокси"), "");
    check("поля адреса нет в системном режиме", !settingsText.includes("Адрес прокси"), "");
    const proxySelect = () =>
      `[...document.querySelectorAll("select.input")].find(s => [...s.options].some(o => o.value === "direct"))`;
    await win.webContents.executeJavaScript(`
      (() => {
        const select = ${proxySelect()};
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(select, "manual");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
    const manualText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("ручной режим показывает адрес и логин", manualText.includes("Адрес прокси") && manualText.includes("Логин прокси"), "");
    check("объясняет формат адреса и предел SOCKS5", manualText.includes("socks5://адрес:порт") && manualText.includes("SOCKS5"), "");

    await win.webContents.executeJavaScript(`
      (() => {
        const select = ${proxySelect()};
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(select, "direct");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
    const directText = await win.webContents.executeJavaScript(text(".settings-view"));
    check("прямое соединение прячет логин и пароль", !directText.includes("Логин прокси"), "");
    // Возвращаем «Системный», чтобы дальнейшие проверки не унаследовали
    // прямое соединение.
    await win.webContents.executeJavaScript(`
      (() => {
        const select = ${proxySelect()};
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(select, "system");
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()
    `);
    // Те же разделы, что и в «Личном чате»: человек ходит между двумя
    // приложениями и не должен искать одну и ту же настройку в разных местах.
    check("есть раздел «Папка с данными»", settingsText.includes("Папка с данными"), "");
    check("папка показана путём", await win.webContents.executeJavaScript(
      `(document.querySelector(".folder-path")||{}).textContent.length > 3`
    ));
    check("есть раздел «Доступ в интернет»", settingsText.includes("Доступ в интернет"), "");
    check("есть раздел «Обслуживание»", settingsText.includes("Обслуживание"), "");
    // Те же разделы и теми же словами, что в «Личном чате»: человек ходит между
    // двумя приложениями, и настройка не должна называться по-разному.
    check("есть «Настройки подключения»", settingsText.includes("Настройки подключения"), "");
    check("есть кэш промпта", settingsText.includes("Кэшировать неизменную часть промпта"), "");
    check("есть отчёт о проблеме", settingsText.includes("О программе и отчёт о проблеме"), "");
    check("есть подключение к GitHub", settingsText.includes("Токен GitHub"), "");

    // Поисковик прячется, пока поиск не разрешён, и появляется, когда разрешён.
    check("выбор поисковика скрыт, пока поиск выключен", !settingsText.includes("DuckDuckGo"), "");
    await win.webContents.executeJavaScript(
      `document.querySelector(".search-toggle input[type=checkbox]").click()`
    );
    await new Promise((r) => setTimeout(r, 300));
    check(
      "после разрешения появляется выбор поисковика",
      (await win.webContents.executeJavaScript(text(".settings-view"))).includes("DuckDuckGo")
    );
    await win.webContents.executeJavaScript(
      `document.querySelector(".search-toggle input[type=checkbox]").click()`
    );

    const report = await win.webContents.executeJavaScript(`window.api.storageReport()`);
    check("отчёт о месте считается", typeof report.totalBytes === "number", JSON.stringify(report));
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
