// Настольная оболочка «Вектора»: то же веб-приложение в окне Electron.
const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// .vkt, переданный при запуске (двойной щелчок по файлу в проводнике)
function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(vkt|svg)$/i.test(a) && fs.existsSync(a)) || null;
}

function openFileInWindow(win, file) {
  if (!file) return;
  const text = fs.readFileSync(file, "utf8");
  const name = path.basename(file);
  const js = /\.svg$/i.test(file)
    ? `IO.openSVGAsDoc(${JSON.stringify(text)}, ${JSON.stringify(name)})`
    : `IO.loadText(${JSON.stringify(text)}, ${JSON.stringify(name)})`;
  win.webContents.executeJavaScript(js).catch((e) => console.error("Не удалось открыть файл:", e));
}

function createWindow(file) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Вектор",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.setMenu(null); // у приложения своё меню внутри окна
  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.webContents.once("did-finish-load", () => openFileInWindow(win, file));

  // Внешние ссылки — в браузере, а не в окне редактора
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // В Electron beforeunload молча запрещает закрытие — спрашиваем явно
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Закрыть без сохранения", "Отмена"],
      defaultId: 1,
      cancelId: 1,
      title: "Вектор",
      message: "В документе есть несохранённые изменения. Закрыть?",
    });
    if (choice === 0) event.preventDefault();
  });
  return win;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    openFileInWindow(win, fileFromArgs(argv));
  });
  app.whenReady().then(() => {
    createWindow(fileFromArgs(process.argv));
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
