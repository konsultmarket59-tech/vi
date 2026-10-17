// Настольная оболочка «Вектора»: то же веб-приложение в окне Electron плюс то, чего нет у браузера:
// папки и файлы на диске (для агента), запросы к Polza.ai без ограничений CORS,
// шрифты системы и мост к установленному CorelDRAW (открытие и сохранение CDR любой версии).
const { app, BrowserWindow, dialog, shell, ipcMain, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { execFile } = require("node:child_process");

// Доступ к файлам — только внутри того, что пользователь сам выбрал в диалогах
const allowedRoots = new Set();
const allow = (p) => allowedRoots.add(path.resolve(p));
const isAllowed = (p) => {
  const r = path.resolve(p);
  for (const root of allowedRoots) if (r === root || r.startsWith(root + path.sep)) return true;
  return false;
};

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(vkt|svg|cdr|cdt)$/i.test(a) && fs.existsSync(a)) || null;
}

function openFileInWindow(win, file) {
  if (!file) return;
  allow(file);
  win.webContents.executeJavaScript(`IO.openPath(${JSON.stringify(file)})`).catch((e) => console.error("Не удалось открыть файл:", e));
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
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  win.setMenu(null); // у приложения своё меню внутри окна
  win.loadFile(path.join(__dirname, "..", "index.html"));
  win.webContents.once("did-finish-load", () => openFileInWindow(win, file));
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

// ---------- файлы ----------
const SKIP_DIRS = new Set(["node_modules", ".git", "$RECYCLE.BIN", "System Volume Information"]);
async function listDir(root, maxDepth = 6, maxFiles = 3000) {
  const out = [];
  async function walk(dir, depth) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        let size = 0;
        try { size = (await fsp.stat(full)).size; } catch { }
        out.push({ path: full, rel: path.relative(root, full).split(path.sep).join("/"), name: e.name, size });
      }
    }
  }
  await walk(root, 0);
  return out;
}

ipcMain.handle("fs:pickFolder", async (e, title) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: title || "Выберите папку", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  allow(r.filePaths[0]);
  return r.filePaths[0];
});
ipcMain.handle("fs:pickFiles", async (e, opts = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: opts.title || "Выберите файл", filters: opts.filters, properties: ["openFile"].concat(opts.multiple ? ["multiSelections"] : []),
  });
  if (r.canceled) return [];
  r.filePaths.forEach(allow);
  return r.filePaths;
});
ipcMain.handle("fs:saveDialog", async (e, opts = {}) => {
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { title: opts.title || "Сохранить", defaultPath: opts.defaultPath, filters: opts.filters });
  if (r.canceled || !r.filePath) return null;
  allow(r.filePath);
  return r.filePath;
});
ipcMain.handle("fs:list", async (e, dir) => {
  if (!isAllowed(dir)) throw new Error("Нет доступа к папке: " + dir);
  return listDir(dir);
});
ipcMain.handle("fs:read", async (e, p) => {
  if (!isAllowed(p)) throw new Error("Нет доступа к файлу: " + p);
  const b = await fsp.readFile(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.handle("fs:write", async (e, p, data) => {
  if (!isAllowed(p) && !isAllowed(path.dirname(p))) throw new Error("Нет доступа к папке: " + path.dirname(p));
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, typeof data === "string" ? data : Buffer.from(data));
  return p;
});
ipcMain.handle("fs:reveal", (e, p) => { if (isAllowed(p)) shell.showItemInFolder(p); });

// ---------- сеть: запросы к модели идут из главного процесса (нет ограничений CORS) ----------
ipcMain.handle("net:fetch", async (e, req) => {
  const res = await fetch(req.url, { method: req.method || "GET", headers: req.headers || {}, body: req.body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, statusText: res.statusText, body: text };
});

// ---------- PDF: страницы печатаются скрытым окном Chromium в файл ----------
ipcMain.handle("print:pdf", async (e, html, out) => {
  if (!isAllowed(out) && !isAllowed(path.dirname(out))) return { ok: false, error: "Нет доступа к папке" };
  const tmp = path.join(os.tmpdir(), "vektor-print-" + Date.now() + ".html");
  await fsp.writeFile(tmp, html, "utf8");
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
    await fsp.writeFile(out, pdf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    w.destroy();
    fsp.rm(tmp, { force: true }).catch(() => { });
  }
});

// ---------- CorelDRAW через COM (только Windows и только если Corel установлен) ----------
const PS_SCRIPT = String.raw`
param([string]$JobPath)
$ErrorActionPreference = 'Stop'
$job = Get-Content -Raw -Encoding UTF8 $JobPath | ConvertFrom-Json
$ids = @('CorelDRAW.Application') + (27..13 | ForEach-Object { "CorelDRAW.Application.$_" })
$app = $null
foreach ($id in $ids) { try { $app = New-Object -ComObject $id; break } catch { } }
if ($null -eq $app) { Write-Output 'ERR: CorelDRAW не установлен на этом компьютере'; exit 2 }
try {
  if ($job.op -eq 'probe') { Write-Output ('OK ' + $app.VersionMajor); exit 0 }
  if ($job.op -eq 'convert') {
    $doc = $app.OpenDocument($job.input)
    $opt = $app.CreateStructSaveAsOptions()
    $opt.Version = [int]$job.version
    $doc.SaveAs($job.output, $opt)
    $doc.Close()
    Write-Output 'OK'; exit 0
  }
  if ($job.op -eq 'build') {
    $doc = $app.CreateDocument()
    $doc.Unit = 3
    for ($i = 0; $i -lt $job.pages.Count; $i++) {
      if ($i -gt 0) { [void]$doc.AddPages(1) }
      $pg = $doc.Pages.Item($i + 1)
      $pg.Activate()
      $pg.SetSize([double]$job.pages[$i].w, [double]$job.pages[$i].h)
      $doc.ActiveLayer.Import($job.pages[$i].svg)
      try { $f = $pg.Shapes.FindShape('vk-page-frame'); if ($f) { $f.Delete() } } catch { }
    }
    $opt = $app.CreateStructSaveAsOptions()
    $opt.Version = [int]$job.version
    $doc.SaveAs($job.output, $opt)
    $doc.Close()
    Write-Output 'OK'; exit 0
  }
  Write-Output 'ERR: неизвестная операция'; exit 3
} catch { Write-Output ('ERR: ' + $_.Exception.Message); exit 1 }
`;

async function runCorel(job) {
  if (process.platform !== "win32") return { ok: false, error: "Связь с CorelDRAW работает только в Windows" };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vektor-corel-"));
  const script = path.join(dir, "corel.ps1"), jobFile = path.join(dir, "job.json");
  await fsp.writeFile(script, "﻿" + PS_SCRIPT, "utf8");
  await fsp.writeFile(jobFile, JSON.stringify(job), "utf8");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, jobFile], { timeout: 180000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || "").trim().split(/\r?\n/).pop() || "";
      if (out.startsWith("OK")) resolve({ ok: true, info: out.slice(2).trim() });
      else resolve({ ok: false, error: out.replace(/^ERR:\s*/, "") || (err && err.message) || "Ошибка CorelDRAW" });
      fsp.rm(dir, { recursive: true, force: true }).catch(() => { });
    });
  });
}
ipcMain.handle("corel:probe", () => runCorel({ op: "probe" }));
// открыть CDR любой версии: Corel пересохраняет его в X5, а дальше файл читает сам «Вектор»
ipcMain.handle("corel:normalize", async (e, input) => {
  if (!isAllowed(input)) throw new Error("Нет доступа к файлу");
  const out = path.join(os.tmpdir(), "vektor-" + Date.now() + ".cdr");
  const r = await runCorel({ op: "convert", input, output: out, version: 15 });
  if (!r.ok) return r;
  const b = await fsp.readFile(out);
  fsp.rm(out, { force: true }).catch(() => { });
  return { ok: true, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
});
// собрать CDR нужной версии из страниц-SVG
ipcMain.handle("corel:build", async (e, pages, output, version) => {
  if (!isAllowed(output) && !isAllowed(path.dirname(output))) throw new Error("Нет доступа к папке");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vektor-svg-"));
  const list = [];
  for (let i = 0; i < pages.length; i++) {
    const f = path.join(dir, `page${i + 1}.svg`);
    await fsp.writeFile(f, pages[i].svg, "utf8");
    list.push({ w: pages[i].w, h: pages[i].h, svg: f });
  }
  const r = await runCorel({ op: "build", pages: list, output, version });
  fsp.rm(dir, { recursive: true, force: true }).catch(() => { });
  return r;
});

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
    // шрифты системы (Local Font Access API) — без лишних вопросов
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(["local-fonts", "clipboard-read", "clipboard-sanitized-write"].includes(permission)));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => ["local-fonts", "clipboard-read", "clipboard-sanitized-write"].includes(permission));
    createWindow(fileFromArgs(process.argv));
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
