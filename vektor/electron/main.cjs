// Настольная оболочка «Вектора»: то же веб-приложение в окне Electron плюс то, чего нет у браузера:
// папки и файлы на диске (для агента), запросы к Polza.ai без ограничений CORS,
// шрифты системы и мост к установленному CorelDRAW (открытие и сохранение CDR любой версии).
const { app, BrowserWindow, dialog, shell, ipcMain, session, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Readable } = require("node:stream");
const { proxyAwareFetch, setProxyCredentials } = require("./netFetch.cjs");

// Все запросы главного процесса (Polza, Figma, файлы моделей) — через сетевой стек Electron,
// как в «Личном чате»: так учитываются системный прокси, VPN и пароль прокси.
global.fetch = proxyAwareFetch;
let cachedProxyAuth = { username: "", password: "" };
// запросы из окна программы: пароль прокси — только прокси, не сайту
app.on("login", (event, _wc, _details, authInfo, callback) => {
  if (!authInfo.isProxy || !cachedProxyAuth.username) return;
  event.preventDefault();
  callback(cachedProxyAuth.username, cachedProxyAuth.password || "");
});
const NET_SETTINGS = () => path.join(app.getPath("userData"), "network.json");
function loadNet() { try { return JSON.parse(fs.readFileSync(NET_SETTINGS(), "utf8")); } catch { return {}; } }
async function applyProxySettings(s = {}) {
  cachedProxyAuth = { username: s.proxyUsername || "", password: s.proxyPassword || "" };
  setProxyCredentials(cachedProxyAuth.username, cachedProxyAuth.password);
  const mode = s.proxyMode || "system";
  const config = mode === "manual" && (s.proxyUrl || "").trim() ? { proxyRules: s.proxyUrl.trim() } : mode === "direct" ? { mode: "direct" } : { mode: "system" };
  try { await session.defaultSession.setProxy(config); } catch (e) { console.error("Прокси не применён:", e); }
}
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const { execFile } = require("node:child_process");

// Доступ к файлам — только внутри того, что пользователь сам выбрал в диалогах
const allowedRoots = new Set();
// файлы, которые пользователь сам открывал или сохранял, — для списка «Недавние» после перезапуска
const KNOWN = () => path.join(app.getPath("userData"), "known-files.json");
let knownFiles = null;
const known = () => { if (!knownFiles) { try { knownFiles = JSON.parse(fs.readFileSync(KNOWN(), "utf8")); } catch { knownFiles = []; } } return knownFiles; };
const remember = (p) => {
  try {
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return;
    const list = known().filter(x => x !== p); list.unshift(p); knownFiles = list.slice(0, 200);
    fs.writeFileSync(KNOWN(), JSON.stringify(knownFiles));
  } catch { }
};
const allow = (p) => { allowedRoots.add(path.resolve(p)); remember(path.resolve(p)); };
const isAllowed = (p) => {
  const r = path.resolve(p);
  for (const root of allowedRoots) if (r === root || r.startsWith(root + path.sep)) return true;
  return false;
};

function fileFromArgs(argv) {
  return argv.slice(1).find((a) => /\.(vkt|svg|cdr|cdt|fig|pen|vkm|psd)$/i.test(a) && fs.existsSync(a)) || null;
}

// ---------- vk://app/ — страницы программы, мост к Polza и локальные файлы ----------
// Свой адрес вместо file:// нужен встроенному редактору «Фигма» (модули, wasm) и видео с диска
// (перемотка по диапазонам). Всё отдаётся из папки программы или из папок, выбранных пользователем.
protocol.registerSchemesAsPrivileged([
  { scheme: "vk", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);
const APP_ROOT = path.resolve(__dirname, "..");
// в строке браузера по умолчанию — русское имя программы, а заголовки HTTP принимают только латиницу
app.userAgentFallback = app.userAgentFallback.replace(/[^\x20-\x7E]+/g, "Vektor");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
  ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".fig": "application/octet-stream", ".txt": "text/plain",
};
async function serveFile(p, req) {
  let st;
  try { st = await fsp.stat(p); } catch (e) { return new Response("Not found", { status: 404 }); }
  if (!st.isFile()) return new Response("Not found", { status: 404 });
  const size = st.size;
  const type = MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (m && size > 0) {
    let start = m[1] ? +m[1] : Math.max(0, size - +m[2]);
    let end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) return new Response("", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), {
      status: 206,
      headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(p)), { headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
}
async function handleVk(req) {
  const u = new URL(req.url);
  const pathname = decodeURIComponent(u.pathname);
  // /__net/https/host/path → запрос к API из главного процесса (Polza.ai без ограничений CORS)
  if (pathname.startsWith("/__net/")) {
    const mm = /^\/__net\/(https?)\/(.+)$/.exec(u.pathname);
    if (!mm) return new Response("Bad request", { status: 400 });
    const target = new URL(`${mm[1]}://${mm[2]}${u.search}`);
    if (mm[1] === "http" && !["localhost", "127.0.0.1"].includes(target.hostname)) return new Response("Forbidden", { status: 403 });
    const headers = new Headers(req.headers);
    for (const h of ["origin", "referer", "host", "cookie"]) headers.delete(h);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();
    const res = await proxyAwareFetch(target.href, { method: req.method, headers, body });
    const out = new Headers(res.headers);
    out.delete("content-encoding"); out.delete("content-length");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  }
  // /__file/?p=путь → файл с диска (только из выбранных пользователем папок)
  if (pathname === "/__file/" || pathname === "/__file") {
    const p = u.searchParams.get("p") || "";
    if (!isAllowed(p)) return new Response("Forbidden", { status: 403 });
    return serveFile(path.resolve(p), req);
  }
  const p = path.normalize(path.join(APP_ROOT, pathname === "/" ? "index.html" : pathname));
  if (p !== APP_ROOT && !p.startsWith(APP_ROOT + path.sep)) return new Response("Forbidden", { status: 403 });
  return serveFile(p, req);
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
  win.loadURL("vk://app/index.html");
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
  if (/\.(vkt|cdr|pdf|svg|ai|psd|fig)$/i.test(p)) remember(path.resolve(p));
  return p;
});
// папки, выбранные один раз и доступные между запусками: дизайн-системы (ds) и проекты «Фигмы» (proj)
for (const [kind, file] of [["ds", "design-folders.json"], ["proj", "project-folders.json"]]) {
  const F = () => path.join(app.getPath("userData"), file);
  const load = () => { try { return JSON.parse(fs.readFileSync(F(), "utf8")); } catch { return []; } };
  const save = (list) => { try { fs.writeFileSync(F(), JSON.stringify(list)); } catch { } };
  ipcMain.handle(kind + ":folders", () => {
    const list = load().filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
    for (const p of list) allowedRoots.add(path.resolve(p));
    return list;
  });
  ipcMain.handle(kind + ":add", async (e, title) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: title || "Выберите папку", properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = path.resolve(r.filePaths[0]);
    allowedRoots.add(p);
    save(load().filter(x => x !== p).concat([p]));
    return p;
  });
  ipcMain.handle(kind + ":remove", (e, p) => { save(load().filter(x => x !== path.resolve(String(p || "")))); return true; });
}
ipcMain.handle("fs:openRecent", (e, p) => {
  const r = path.resolve(String(p || ""));
  if (!known().includes(r) || !fs.existsSync(r)) return false;
  allowedRoots.add(r);
  return true;
});
ipcMain.handle("fs:reveal", (e, p) => { if (isAllowed(p)) shell.showItemInFolder(p); });

// ---------- сеть: запросы к модели идут из главного процесса (нет ограничений CORS) ----------
ipcMain.handle("net:fetch", async (e, req) => {
  const res = await fetch(req.url, { method: req.method || "GET", headers: req.headers || {}, body: req.body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, statusText: res.statusText, body: text };
});

// ---------- снимок части окна (просмотр прототипа в «Make» видит агент) ----------
ipcMain.handle("win:capture", async (e, r) => {
  const rect = r ? { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) } : undefined;
  const img = await e.sender.capturePage(rect);
  const size = img.getSize();
  const k = Math.min(1, 1400 / Math.max(size.width, 1));
  const out = k < 1 ? img.resize({ width: Math.round(size.width * k) }) : img;
  return "data:image/jpeg;base64," + out.toJPEG(80).toString("base64");
});

// ---------- сеть: прокси и проверка подключения (как в «Личном чате») ----------
ipcMain.handle("net:getSettings", () => { const s = loadNet(); return { proxyMode: s.proxyMode || "system", proxyUrl: s.proxyUrl || "", proxyUsername: s.proxyUsername || "", hasPassword: !!s.proxyPassword }; });
ipcMain.handle("net:setSettings", async (e, s) => {
  const cur = loadNet();
  const next = { proxyMode: s.proxyMode || "system", proxyUrl: s.proxyUrl || "", proxyUsername: s.proxyUsername || "", proxyPassword: s.proxyPassword === undefined ? cur.proxyPassword || "" : s.proxyPassword };
  await fsp.mkdir(path.dirname(NET_SETTINGS()), { recursive: true });
  await fsp.writeFile(NET_SETTINGS(), JSON.stringify(next, null, 1), "utf8");
  await applyProxySettings(next);
  return true;
});
ipcMain.handle("net:test", async (e, { baseUrl, apiKey }) => {
  await session.defaultSession.clearAuthCache();
  const url = String(baseUrl || "https://polza.ai/api/v1").replace(/\/+$/, "") + "/models";
  const t0 = Date.now();
  try {
    const res = await proxyAwareFetch(url, { headers: apiKey ? { Authorization: "Bearer " + apiKey } : {} });
    const ms = Date.now() - t0;
    if (res.status === 401 || res.status === 403) return { ok: false, ms, error: "Сервер отклонил ключ (" + res.status + "). Проверьте API-ключ." };
    if (res.status === 407) return { ok: false, ms, error: "Прокси просит пароль (407): укажите логин и пароль прокси." };
    if (!res.ok) return { ok: false, ms, error: "Соединение есть, но сервер ответил " + res.status + " " + res.statusText };
    let models = 0; try { const js = await res.json(); models = (js.data || js.models || []).length; } catch { }
    return { ok: true, ms, models };
  } catch (err) {
    const m = String(err && err.message || err);
    const hint = /ERR_PROXY|ERR_TUNNEL/.test(m) ? "прокси недоступен или не пропускает" : /ERR_NAME_NOT_RESOLVED/.test(m) ? "адрес не найден (DNS) — нет интернета или его блокирует сеть" : /ERR_CONNECTION|ERR_TIMED_OUT|ERR_NETWORK/.test(m) ? "нет соединения — проверьте интернет, VPN или прокси" : /CERT/.test(m) ? "ошибка сертификата — сеть подменяет защищённое соединение" : m;
    return { ok: false, error: "Не удалось подключиться: " + hint };
  }
});
// ключ, модель и прокси — из «Личного чата» на этом же компьютере
ipcMain.handle("pc:importSettings", async () => {
  const appData = app.getPath("appData");
  const names = ["Личный чат", "personal-chat", "Personal Chat"];
  try { for (const d of await fsp.readdir(appData)) if (!names.includes(d)) names.push(d); } catch { }
  for (const n of names) {
    const f = path.join(appData, n, "settings.json");
    let s; try { s = JSON.parse(await fsp.readFile(f, "utf8")); } catch { continue; }
    if (!s || !s.apiKey || !("proxyMode" in s || /polza/i.test(s.baseUrl || ""))) continue;
    return { ok: true, source: n, apiKey: s.apiKey, baseUrl: s.baseUrl || "https://polza.ai/api/v1", model: s.model || "", proxyMode: s.proxyMode || "system", proxyUrl: s.proxyUrl || "", proxyUsername: s.proxyUsername || "", proxyPassword: s.proxyPassword || "" };
  }
  return { ok: false };
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
  if ($job.op -eq 'pdf') {
    # файл любой версии — в PDF средствами самого Corel: фото, PowerClip и эффекты сохраняются как есть
    $doc = $app.OpenDocument($job.input)
    $s = $doc.PDFSettings
    foreach ($kv in @(@('PublishRange', 0), @('DownsampleColor', $false), @('DownsampleGray', $false), @('DownsampleMono', $false), @('TextAsCurves', $false), @('EmbedFonts', $true), @('ComplexFillsAsBitmaps', $false), @('Linearize', $false))) {
      try { $s.($kv[0]) = $kv[1] } catch { }
    }
    $doc.PublishToPDF($job.output)
    $n = $doc.Pages.Count
    $v = 0; try { $v = [int]$doc.SourceFileVersion } catch { }
    $doc.Close()
    Write-Output ('OK ' + $n + ' ' + $v); exit 0
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
    # точные CMYK: импортированные RGB-цвета перекрашиваются в значения документа
    if ($null -ne $job.cmyk) {
      $map = @{}
      foreach ($p in $job.cmyk.PSObject.Properties) { $map[$p.Name.ToLower()] = $p.Value }
      $fix = {
        param($col)
        try {
          $hex = ('#{0:x2}{1:x2}{2:x2}' -f [int]$col.RGBRed, [int]$col.RGBGreen, [int]$col.RGBBlue)
          $v = $map[$hex]
          if ($null -ne $v) { $col.CMYKAssign([int]$v[0], [int]$v[1], [int]$v[2], [int]$v[3]) } else { $col.ConvertToCMYK() }
        } catch { }
      }
      foreach ($pg in $doc.Pages) {
        foreach ($s in $pg.Shapes.FindShapes()) {
          try {
            if ($s.Fill.Type -eq 1) { & $fix $s.Fill.UniformColor }
            if ($s.Fill.Type -eq 2) { foreach ($fc in $s.Fill.Fountain.Colors) { & $fix $fc.Color } ; & $fix $s.Fill.Fountain.StartColor; & $fix $s.Fill.Fountain.EndColor }
            if ($s.Outline.Type -eq 1) { & $fix $s.Outline.Color }
            if ($job.bitmapsCmyk -and $s.Type -eq 5) { $s.Bitmap.ConvertTo(5) }
          } catch { }
        }
      }
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

async function runCorel(job, timeout = 180000) {
  if (process.platform !== "win32") return { ok: false, error: "Связь с CorelDRAW работает только в Windows" };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vektor-corel-"));
  const script = path.join(dir, "corel.ps1"), jobFile = path.join(dir, "job.json");
  await fsp.writeFile(script, "﻿" + PS_SCRIPT, "utf8");
  await fsp.writeFile(jobFile, JSON.stringify(job), "utf8");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, jobFile], { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
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
// открыть CDR через CorelDRAW: Corel публикует документ в PDF, «Вектор» читает PDF
ipcMain.handle("corel:pdf", async (e, input) => {
  if (!isAllowed(input)) throw new Error("Нет доступа к файлу");
  const out = path.join(os.tmpdir(), "vektor-" + Date.now() + ".pdf");
  const r = await runCorel({ op: "pdf", input, output: out }, 600000);
  if (!r.ok) return r;
  try {
    const b = await fsp.readFile(out);
    const [pages, version] = String(r.info || "").split(/\s+/).map(Number);
    return { ok: true, pages, version, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  } catch (err) { return { ok: false, error: "CorelDRAW не создал PDF" }; }
  finally { fsp.rm(out, { force: true }).catch(() => { }); }
});
// собрать CDR нужной версии из страниц-SVG
ipcMain.handle("corel:build", async (e, pages, output, version, opts = {}) => {
  if (!isAllowed(output) && !isAllowed(path.dirname(output))) throw new Error("Нет доступа к папке");
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vektor-svg-"));
  const list = [];
  for (let i = 0; i < pages.length; i++) {
    const f = path.join(dir, `page${i + 1}.svg`);
    await fsp.writeFile(f, pages[i].svg, "utf8");
    list.push({ w: pages[i].w, h: pages[i].h, svg: f });
  }
  const r = await runCorel({ op: "build", pages: list, output, version, cmyk: opts && opts.cmyk || null, bitmapsCmyk: !!(opts && opts.bitmapsCmyk) });
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
  app.whenReady().then(async () => {
    await applyProxySettings(loadNet());
    protocol.handle("vk", (req) => handleVk(req).catch((e) => new Response(String(e && e.message || e), { status: 502 })));
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
