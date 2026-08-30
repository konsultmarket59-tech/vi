// Checks that a plugins.json produced by «Личный код» actually changes the built
// app: modules disappear from the menu and the product name is used.
//   xvfb-run -a npx electron electron/smoke-plugins.cjs
//
// Runs twice in one process is not possible (plugins.json is read at startup), so
// this test writes the config first, then verifies, then restores whatever was
// there before.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "personal-chat-plugins-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-chat-plugins-data-"));
const pluginsFile = path.join(__dirname, "..", "plugins.json");
const hadFile = fs.existsSync(pluginsFile);
const previous = hadFile ? fs.readFileSync(pluginsFile, "utf-8") : null;

fs.writeFileSync(
  pluginsFile,
  JSON.stringify(
    {
      productName: "Тексты Динамики",
      modules: {
        projects: true,
        skills: false,
        word: true,
        excel: false,
        media: false,
        cloud: false,
        direct: false,
        github: false,
        chatbots: false,
      },
    },
    null,
    2
  )
);

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

require("./main.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  if (hadFile) fs.writeFileSync(pluginsFile, previous);
  else fs.rmSync(pluginsFile, { force: true });
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  try {
    let win;
    const deadline = Date.now() + 20000;
    while (!win && Date.now() < deadline) {
      [win] = BrowserWindow.getAllWindows();
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    if (!win) throw new Error("окно не появилось");
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once("did-finish-load", resolve);
    });

    let menu = "";
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      menu = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".sidebar-footer .sidebar-item")].map(n=>n.textContent).join("|")`
      );
      if (menu) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("\nсборка «только тексты»");
    check("включённые модули на месте", menu.includes("Word"), menu);
    check(
      "выключенные модули скрыты",
      !menu.includes("Excel") && !menu.includes("Директ") && !menu.includes("GitHub") && !menu.includes("Чат-боты"),
      menu
    );
    // Навыки входят в неотключаемую базу: даже с modules.skills = false раздел
    // остаётся, потому что база одинакова у всех сборок.
    check("база остаётся, даже если её выключить в конфиге", menu.includes("Навыки"), menu);
    check("Настройки нельзя выключить — они на месте", menu.includes("Настройки"), menu);

    const title = await win.webContents.executeJavaScript(
      `(document.querySelector(".sidebar-title")||{}).textContent || ""`
    );
    check("название приложения взято из конфига", title.trim() === "Тексты Динамики", title);
    check("заголовок окна тоже", (await win.webContents.executeJavaScript("document.title")) === "Тексты Динамики");

    await win.webContents.capturePage().then((img) =>
      fs.writeFileSync(path.join(os.tmpdir(), "personal-chat-blueprint.png"), img.toPNG())
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
