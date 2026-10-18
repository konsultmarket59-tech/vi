// Отдельная программа «Монтаж»: своё окно, своя служебная папка, свои вкладки.
//   npm run build && xvfb-run -a npx electron --no-sandbox electron/smoke-montage-app.cjs
//
// Стережётся главное: «Монтаж» не делит настройки и ключи с «Личным чатом»,
// а открывается сразу видеоредактором, а не чатом.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { finish } = require("./finish.cjs");

const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mt-appdata-"));
app.setPath("appData", appData);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

require("./montage-main.cjs");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    console.log("отдельная программа «Монтаж»");
    check("имя программы — «Монтаж»", app.getName() === "Монтаж", app.getName());
    check("своя служебная папка", app.getPath("userData") === path.join(appData, "Монтаж"), app.getPath("userData"));
    let win;
    const dl = Date.now() + 20000;
    while (!win && Date.now() < dl) {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /montage\.html/.test(w.webContents.getURL()));
      if (!win) await new Promise((r) => setTimeout(r, 150));
    }
    check("окно открывает видеоредактор, а не чат", !!win);
    if (win) {
      await new Promise((resolve) => (!win.webContents.isLoading() ? resolve() : win.webContents.once("did-finish-load", resolve)));
      const call = (e) => win.webContents.executeJavaScript(e);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(1500);
      // Ключа нет — программа сама открывает настройки: без него агент не заработает.
      check("без ключа открываются настройки", (await call(`!!document.querySelector(".mt-app-settings")`)) === true);
      await call(`[...document.querySelectorAll(".mt-app-bar button")].find(b => b.textContent.trim() === "Монтаж").click()`);
      await wait(800);
      check("вкладка монтажа — четыре раздела", (await call(`document.querySelectorAll(".mt-root > .mt-tabs > button:not(.link-btn)").length`)) === 4);
      check("чата и боковой колонки нет", (await call(`!document.querySelector(".sidebar")`)) === true);
      await call(`[...document.querySelectorAll(".mt-app-bar button")].find(b => b.textContent.includes("Моушн")).click()`);
      await wait(800);
      check("моушн-дизайн — соседней вкладкой", (await call(`!!document.querySelector(".vs-form")`)) === true);
      check("заголовок окна — «Монтаж»", (await call(`document.title`)) === "Монтаж");
      check("данные — в своей папке, не в «Личном чате»", fs.existsSync(path.join(appData, "Монтаж")) && !fs.existsSync(path.join(appData, "personal-chat")));
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.stack ? e.stack : e);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(appData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
