// Раздел «Монтаж»: обработчики окна, хранение, расшифровка по словам, сборка
// и аватар. Вынесено из main.cjs отдельным модулем: раздел большой, а главный
// файл и так на шесть тысяч строк. Всё, что раздел берёт у приложения (путь к
// ffmpeg, папку данных, настройки модели, разбор дизайн-системы), приходит
// параметрами — двух разных представлений об одном не появляется.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const montage = require("./montage.cjs");
const avatar = require("./avatar.cjs");
const fx = require("./montagefx.cjs");
const stock = require("./stock.cjs");
const library = require("./library.cjs");
const speech = require("./speech.cjs");
const motionAgent = require("./motionAgent.cjs");
const motionTemplates = require("./motionTemplates.cjs");
const motionLib = require("./motion.cjs");
const motionRender = require("./motionRender.cjs");
const fontLibrary = require("./fontLibrary.cjs");
const bgremove = require("./bgremove.cjs");

const SCHEME = "montage-media";

const KEY_NAMES = ["eleven", "fal", "heygen", "pexels", "pixabay", "freesound", "jamendo"];

function keyStatus(k) {
  const out = { voices: Object.keys(k.voices || {}).length };
  for (const name of KEY_NAMES) out[name] = !!k[name];
  return out;
}

/**
 * Модели распознавания для монтажа.
 *
 * Монтажу нужно время КАЖДОГО слова: резать «э-э» посреди фразы можно, только
 * зная, где оно. Это умеют выгрузки «_timestamped». Обычная модель «Видеотеки»
 * тоже подойдёт — тогда слова раскладываются по фразе расчётом, и рез бывает
 * неточен на долю секунды.
 */
const MONTAGE_SPEECH_MODELS = [
  { id: "onnx-community/whisper-base_timestamped", name: "Для монтажа — время каждого слова", size: "~80 МБ", hint: "Рекомендуется: резы ложатся точно между словами." },
  { id: "onnx-community/whisper-small_timestamped", name: "Для монтажа — точная", size: "~250 МБ", hint: "Слышит лучше, работает втрое дольше." },
  { id: "onnx-community/whisper-tiny_timestamped", name: "Для монтажа — быстрая", size: "~45 МБ", hint: "Быстро, но путает слова." },
  ...speech.SPEECH_MODELS.map((m) => ({ ...m, name: `${m.name} (как в «Видеотеке», время по фразам)` })),
];

/** Схема для показа локальных файлов в плеере — до готовности приложения. */
function registerScheme(protocol) {
  try {
    protocol.registerSchemesAsPrivileged([
      { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
    ]);
  } catch {
    // Главный модуль загружен уже после готовности приложения — так делают
    // проверки других разделов. Плеер «Монтажа» им не нужен, а падать всему
    // приложению из-за этого нельзя.
  }
}

const MIME = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".mts": "video/mp2t", ".m2ts": "video/mp2t", ".3gp": "video/3gpp",
};

// Шрифты отдаются тоже: субтитры в предпросмотре набираются тем же файлом, что и в сборке.
const FONT_MIME = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".ttc": "font/collection" };

/**
 * Отдача локального файла плееру — с поддержкой запроса по кусочкам.
 *
 * Без ответа на Range видео не перематывается: плеер просит «с байта N», а
 * получает файл с начала. Отдаются только медиафайлы: окно приложения не
 * должно читать через эту схему что попало с диска.
 */
function handleProtocol(protocol) {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const ext = path.extname(filePath).toLowerCase();
      if (!MIME[ext] && !FONT_MIME[ext]) return new Response("Не медиафайл", { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
      const stat = await fs.stat(filePath);
      const size = stat.size;
      const range = request.headers.get("range");
      // Разрешение для окна приложения: шрифт субтитров в предпросмотре грузится
      // по правилам CORS, и без этого заголовка браузер его молча отбрасывает.
      const headers = { "Content-Type": MIME[ext] || FONT_MIME[ext], "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/);
        let start = m && m[1] ? Number(m[1]) : 0;
        let end = m && m[2] ? Number(m[2]) : size - 1;
        if (m && !m[1] && m[2]) {
          start = Math.max(0, size - Number(m[2]));
          end = size - 1;
        }
        end = Math.min(end, size - 1);
        if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Access-Control-Allow-Origin": "*" } });
        const stream = fsSync.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
        });
      }
      return new Response(Readable.toWeb(fsSync.createReadStream(filePath)), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
    } catch {
      return new Response("Файл не найден", { status: 404 });
    }
  });
}

function slug(name) {
  return (
    Array.from(String(name || "ролик"))
      // Управляющие символы в имени файла Windows не принимает.
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join("")
      .replace(/[<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "ролик"
  );
}

async function freeName(dir, base, ext) {
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base}${i === 1 ? "" : `-${i}`}${ext}`);
    if (!fsSync.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

/**
 * @param {object} ctx
 * @param {import("electron").IpcMain} ctx.ipcMain
 */
function register(ctx) {
  const { ipcMain, dialog, BrowserWindow, shell, app, ffmpegPath, getRootPath, loadSettings, readDesignFolder, speechCacheDir, nativeImage, usage, extractDocText } = ctx;

  const montageRoot = async () => path.join(await getRootPath(), "montage");
  const projectsDir = async () => path.join(await montageRoot(), "projects");
  const transcriptsDir = async () => path.join(await montageRoot(), "transcripts");
  const configFile = async () => path.join(await montageRoot(), "config.json");
  // Ключи сервисов — в системной папке приложения, а не в папке данных: папку
  // данных люди синхронизируют с облаком и показывают коллегам.
  const keysFile = () => path.join(app.getPath("userData"), "montage-keys.json");

  const defaultConfig = () => ({
    sources: [],
    outputDir: "",
    designDir: "",
    engine: "builtin",
    speechModel: MONTAGE_SPEECH_MODELS[0].id,
    remoteModel: "whisper-1",
    language: "ru",
    preset: "9:16",
    // Модель для ИИ-моушна; пусто — та же, что в общих настройках.
    motionModel: "",
    motionReview: true,
    lastProject: "",
    cleanup: { ...montage.CLEANUP_DEFAULTS, punchIn: 0.08 },
    captions: montage.defaultCaptions(),
  });

  async function readConfig() {
    try {
      const saved = JSON.parse(await fs.readFile(await configFile(), "utf-8"));
      const d = defaultConfig();
      return { ...d, ...saved, cleanup: { ...d.cleanup, ...(saved.cleanup || {}) }, captions: { ...d.captions, ...(saved.captions || {}) } };
    } catch {
      return defaultConfig();
    }
  }

  async function saveConfig(patch) {
    const merged = { ...(await readConfig()), ...(patch || {}) };
    await fs.mkdir(await montageRoot(), { recursive: true });
    await fs.writeFile(await configFile(), JSON.stringify(merged, null, 2), "utf-8");
    return merged;
  }

  async function readKeys() {
    try {
      return JSON.parse(await fs.readFile(keysFile(), "utf-8"));
    } catch {
      return { eleven: "", fal: "", heygen: "", pexels: "", pixabay: "", freesound: "", jamendo: "", voices: {} };
    }
  }

  const win = () => BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const pick = async (options) => {
    const r = await dialog.showOpenDialog(win(), options);
    return r.canceled ? [] : r.filePaths;
  };

  // ---------- расшифровки ----------

  /** Отпечаток → расшифровка. Узнаётся по содержимому: переименование не сбивает. */
  const fpCache = new Map();
  async function fingerprintOf(filePath) {
    const stat = await fs.stat(filePath);
    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    if (fpCache.has(key)) return fpCache.get(key);
    const fp = await library.fingerprint(filePath);
    fpCache.set(key, fp);
    return fp;
  }

  async function readTranscript(filePath) {
    try {
      const fp = await fingerprintOf(filePath);
      const t = JSON.parse(await fs.readFile(path.join(await transcriptsDir(), `${fp}.json`), "utf-8"));
      return { ...t, path: filePath, name: path.basename(filePath) };
    } catch {
      return null;
    }
  }

  async function transcriptsFor(paths) {
    const out = {};
    for (const p of new Set(paths)) {
      const t = await readTranscript(p);
      if (t) out[p] = t;
    }
    return out;
  }

  /** Платная расшифровка с временем слов — через ключ из общих настроек. */
  async function transcribeRemoteWords({ settings, model, audioPath, language }) {
    if (!settings.apiKey) throw new Error("Для расшифровки через сервис нужен API-ключ в настройках.");
    const data = await fs.readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([data]), path.basename(audioPath));
    form.append("model", model || "whisper-1");
    form.append("language", language || "ru");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    const res = await fetch(`${String(settings.baseUrl || "").replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Сервис расшифровки ответил ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    const body = await res.json();
    const words = (body.words || []).map((w) => ({ w: w.word, s: w.start, e: w.end }));
    if (words.length) return { words, wordLevel: true };
    return { segments: (body.segments || []).map((s) => ({ from: s.start, to: s.end, text: s.text })), wordLevel: false };
  }

  let queue = null;

  // ---------- обработчики ----------

  ipcMain.handle("montage:options", () => ({
    presets: montage.CANVAS_PRESETS,
    fits: montage.FIT_MODES,
    ...fx.publicTables(),
    stockProviders: stock.PROVIDERS,
    textStyles: montage.TEXT_STYLES,
    textAnimations: montage.TEXT_ANIMATIONS,
    cleanup: montage.CLEANUP_DEFAULTS,
    speechModels: MONTAGE_SPEECH_MODELS,
    lipsyncModels: avatar.LIPSYNC_MODELS,
    scheme: SCHEME,
    masksDir: montage.masksDir(),
  }));

  ipcMain.handle("montage:config", () => readConfig());
  ipcMain.handle("montage:saveConfig", (_e, patch) => saveConfig(patch));

  ipcMain.handle("montage:pickMedia", () =>
    pick({
      title: "Видео, звук и картинки для монтажа",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Медиа", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mts", "m2ts", "ts", "3gp", "wmv", "mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "png", "jpg", "jpeg", "webp", "gif"] },
        { name: "Все файлы", extensions: ["*"] },
      ],
    })
  );
  ipcMain.handle("montage:pickFolder", async (_e, title) => (await pick({ title: title || "Папка", properties: ["openDirectory", "createDirectory"] }))[0] || null);
  ipcMain.handle("montage:pickFile", async (_e, kind) => {
    const filters = {
      font: [{ name: "Шрифты", extensions: ["ttf", "otf", "woff", "woff2", "ttc"] }],
      image: [{ name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
      lut: [{ name: "LUT", extensions: ["cube", "3dl"] }],
      overlay: [{ name: "Видео и картинки", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi", "png", "jpg", "jpeg", "webp", "gif"] }],
      audio: [{ name: "Звук", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"] }],
      video: [{ name: "Видео", extensions: ["mp4", "mov", "m4v", "mkv", "webm", "avi"] }],
    }[kind] || [{ name: "Все файлы", extensions: ["*"] }];
    return (await pick({ properties: ["openFile"], filters }))[0] || null;
  });

  /** Что лежит в папках и файлах: видео, звук и картинки. */
  ipcMain.handle("montage:scan", async (_e, sources) => {
    const list = (sources || []).filter(Boolean);
    const scan = await library.scanSources(list);
    const files = scan.files.map((f) => ({ path: f.path, name: f.name, kind: montage.mediaKind(f.path) || f.kind, bytes: f.bytes, folder: f.folder }));
    // Картинки «Видеотека» не считает медиа, а монтажу они нужны.
    for (const src of list) {
      let st;
      try {
        st = await fs.stat(src);
      } catch {
        continue;
      }
      const add = (p, bytes) => {
        if (montage.mediaKind(p) === "image" && !files.some((f) => f.path === p)) files.push({ path: p, name: path.basename(p), kind: "image", bytes, folder: "." });
      };
      if (st.isDirectory()) {
        const entries = await fs.readdir(src, { withFileTypes: true }).catch(() => []);
        for (const e of entries) if (e.isFile()) add(path.join(src, e.name), 0);
      } else add(src, st.size);
    }
    const transcribed = await transcriptsFor(files.filter((f) => f.kind !== "image").map((f) => f.path));
    return {
      files: files.map((f) => ({ ...f, transcribed: !!transcribed[f.path], wordLevel: !!transcribed[f.path]?.wordLevel, duration: transcribed[f.path]?.duration || 0 })),
      missing: scan.missing,
      seen: scan.seen,
    };
  });

  ipcMain.handle("montage:probe", (_e, file) => montage.probeMedia(ffmpegPath(), file));

  /** Полоска кадров для куска на дорожке — одной картинкой. */
  const thumbCache = new Map();
  ipcMain.handle("montage:thumbs", async (_e, file, { count = 8, height = 56, from = 0, to = 0 } = {}) => {
    const key = `${file}|${count}|${height}|${from}|${to}`;
    if (thumbCache.has(key)) return thumbCache.get(key);
    const kind = montage.mediaKind(file);
    const dest = path.join(app.getPath("temp"), `montage-thumb-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    try {
      if (kind === "image") {
        await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=-2:${height}`, "-frames:v", "1", dest]);
      } else if (count === 1) {
        // Один кадр — быстрым переходом, без декодирования всего файла.
        const at = to > from ? (from + to) / 2 : Math.min(1, ((await montage.probeMedia(ffmpegPath(), file)).duration || 2) / 2);
        await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", file, "-vf", `scale=-2:${height}`, "-frames:v", "1", "-q:v", "5", dest]);
      } else {
        const span = Math.max(0.5, to > from ? to - from : (await montage.probeMedia(ffmpegPath(), file)).duration || 10);
        const step = span / count;
        await montage.runFfmpeg(ffmpegPath(), [
          "-y", "-hide_banner", "-loglevel", "error",
          "-ss", String(from), "-t", String(span), "-i", file,
          "-vf", `fps=1/${step.toFixed(3)},scale=-2:${height},tile=${count}x1`,
          "-frames:v", "1", "-q:v", "6", dest,
        ]);
      }
      const uri = `data:image/jpeg;base64,${(await fs.readFile(dest)).toString("base64")}`;
      thumbCache.set(key, uri);
      if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value);
      return uri;
    } catch {
      return "";
    } finally {
      await fs.rm(dest, { force: true }).catch(() => {});
    }
  });

  /** Волна звука для дорожки. */
  ipcMain.handle("montage:waveform", async (_e, file, { width = 600, height = 48, from = 0, to = 0, color = "#7debff" } = {}) => {
    const dest = path.join(app.getPath("temp"), `montage-wave-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    try {
      const args = ["-y", "-hide_banner", "-loglevel", "error"];
      if (to > from) args.push("-ss", String(from), "-t", String(to - from));
      args.push("-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${Math.max(50, Math.round(width))}x${Math.round(height)}:colors=${color}:scale=sqrt`, "-frames:v", "1", dest);
      await montage.runFfmpeg(ffmpegPath(), args);
      return `data:image/png;base64,${(await fs.readFile(dest)).toString("base64")}`;
    } catch {
      return "";
    } finally {
      await fs.rm(dest, { force: true }).catch(() => {});
    }
  });


  // ---------- лёгкие копии и полоски для быстрого монтажа ----------

  const cacheDir = async (sub) => {
    const d = path.join(await montageRoot(), "cache", sub);
    await fs.mkdir(d, { recursive: true });
    return d;
  };
  async function sourceKey(file) {
    const st = await fs.stat(file);
    return motionLib.hash(file, st.size, st.mtimeMs);
  }

  /**
   * Лёгкая копия для предпросмотра: 540 по короткой стороне, H.264, ключевой
   * кадр каждые полсекунды — перемотка мгновенная, плеер не задыхается.
   * Делается в фоне по одной; сборка всегда идёт из оригинала.
   */
  const proxyJobs = new Map();
  const proxyQueue = [];
  let proxyBusy = false;
  async function pumpProxies() {
    if (proxyBusy) return;
    const job = proxyQueue.shift();
    if (!job) return;
    proxyBusy = true;
    const tmp = job.out.replace(/\.mp4$/, ".part.mp4");
    try {
      const info = await montage.probeMedia(ffmpegPath(), job.file);
      const portrait = info.height > info.width;
      const scale = portrait ? "scale=540:-2" : "scale=-2:540";
      await new Promise((resolve, reject) => {
        const { spawn } = require("node:child_process");
        const p = spawn(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-i", job.file, "-vf", `${scale},fps=30`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-g", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", tmp], { windowsHide: true });
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        p.stdout.on("data", (d) => {
          const m = String(d).match(/out_time_ms=(\d+)/g);
          if (m && info.duration) {
            const t = Number(m[m.length - 1].split("=")[1]) / 1e6;
            for (const w of BrowserWindow.getAllWindows()) w.webContents.send("montage-proxy", { file: job.file, progress: Math.min(0.99, t / info.duration) });
          }
        });
        p.on("error", reject);
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-300)))));
      });
      await fs.rename(tmp, job.out);
      job.resolve(job.out);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send("montage-proxy", { file: job.file, progress: 1, proxy: job.out });
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      job.resolve("");
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send("montage-proxy", { file: job.file, error: String(e && e.message) });
    } finally {
      proxyBusy = false;
      pumpProxies();
    }
  }

  ipcMain.handle("montage:proxy", async (_e, file) => {
    try {
      if (montage.mediaKind(file) !== "video") return { status: "none" };
      const out = path.join(await cacheDir("proxies"), `${await sourceKey(file)}.mp4`);
      if (fsSync.existsSync(out)) return { status: "ready", path: out };
      if (proxyJobs.has(out)) return { status: "pending" };
      const info = await montage.probeMedia(ffmpegPath(), file);
      if (!montage.needsProxy(info, file)) return { status: "none" };
      const done = new Promise((resolve) => proxyQueue.push({ file, out, resolve }));
      proxyJobs.set(out, done);
      done.then(() => proxyJobs.delete(out));
      pumpProxies();
      return { status: "pending" };
    } catch {
      return { status: "none" };
    }
  });

  /**
   * Полоска кадров на весь исходник — одна картинка на файл, с диска. Дорожка
   * режет её под каждый кусок сама: раньше каждый кусок и каждое изменение
   * зума запускали ffmpeg заново, и длинный исходник декодировался целиком.
   */
  const stripJobs = new Map();
  ipcMain.handle("montage:filmstrip", async (_e, file) => {
    const kind = montage.mediaKind(file);
    if (kind !== "video" && kind !== "image") return null;
    const key = await sourceKey(file).catch(() => "");
    if (!key) return null;
    if (stripJobs.has(key)) return stripJobs.get(key);
    const job = (async () => {
      const dir = await cacheDir("strips");
      const meta = path.join(dir, `${key}.json`);
      try {
        return JSON.parse(await fs.readFile(meta, "utf-8"));
      } catch {
        // ещё не делали
      }
      const out = path.join(dir, `${key}.jpg`);
      const H = 64;
      let result;
      if (kind === "image") {
        await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=-2:${H}`, "-frames:v", "1", out]);
        result = { path: out, count: 1, duration: 0, height: H };
      } else {
        const info = await montage.probeMedia(ffmpegPath(), file);
        const duration = info.duration || 1;
        const count = Math.max(4, Math.min(120, Math.round(duration / 2)));
        const step = duration / count;
        // Только ключевые кадры: декодер не разворачивает весь файл, и
        // полоска часового исходника готова за секунды.
        await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-skip_frame", "nokey", "-i", file, "-vf", `fps=1/${step.toFixed(4)},scale=-2:${H},tile=${count}x1`, "-an", "-vsync", "vfr", "-frames:v", "1", "-q:v", "5", out]).catch(async () => {
          await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=1/${step.toFixed(4)},scale=-2:${H},tile=${count}x1`, "-an", "-frames:v", "1", "-q:v", "5", out]);
        });
        result = { path: out, count, duration, height: H, step };
      }
      await fs.writeFile(meta, JSON.stringify(result), "utf-8");
      return result;
    })().catch(() => null);
    stripJobs.set(key, job);
    return job;
  });

  /** Волна звука на весь исходник — одна на файл; дорожка показывает нужный кусок. */
  const waveJobs = new Map();
  async function fullWave(file) {
    const key = await sourceKey(file);
    if (waveJobs.has(key)) return waveJobs.get(key);
    const job = (async () => {
      const dir = await cacheDir("waves");
      const meta = path.join(dir, `${key}.json`);
      try {
        return JSON.parse(await fs.readFile(meta, "utf-8"));
      } catch {
        // ещё не делали
      }
      const info = await montage.probeMedia(ffmpegPath(), file);
      if (!info.hasAudio) return null;
      const width = Math.max(400, Math.min(16000, Math.round((info.duration || 10) * 25)));
      const out = path.join(dir, `${key}.png`);
      await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${width}x60:colors=#ffffff:scale=sqrt`, "-frames:v", "1", out]);
      const result = { path: out, duration: info.duration, width };
      await fs.writeFile(meta, JSON.stringify(result), "utf-8");
      return result;
    })().catch(() => null);
    waveJobs.set(key, job);
    return job;
  }
  ipcMain.handle("montage:wave", (_e, file) => fullWave(file).catch(() => null));


  /**
   * Авто-улучшение кадра: замер яркости, разброса и насыщенности (signalstats)
   * в нескольких точках куска → экспозиция, света/тени, сочность, чёткость.
   * Как кнопка «Авто» в Lightroom: разумная отправная точка, дальше — руками.
   */
  ipcMain.handle("montage:autoEnhance", async (_e, file, { from = 0, to = 0 } = {}) => {
    const { spawn } = require("node:child_process");
    const kind = montage.mediaKind(file);
    const span = to > from ? to - from : 0;
    const times = kind === "image" ? [0] : span ? [from + span * 0.2, from + span * 0.5, from + span * 0.8] : [from];
    const stats = [];
    for (const t of times) {
      const out = await new Promise((resolve) => {
        const args = ["-hide_banner", "-loglevel", "error", ...(kind === "image" ? [] : ["-ss", String(Math.max(0, t))]), "-i", file, "-frames:v", "1", "-vf", "scale=480:-2,signalstats,metadata=print:file=-", "-f", "null", "-"];
        const p = spawn(ffmpegPath(), args, { windowsHide: true });
        let txt = "";
        p.stdout.on("data", (d) => (txt += d));
        p.on("error", () => resolve(""));
        p.on("close", () => resolve(txt));
      });
      const get = (k) => {
        const m = out.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`));
        return m ? Number(m[1]) : NaN;
      };
      const y = get("YAVG");
      if (Number.isFinite(y)) stats.push({ y, low: get("YLOW"), high: get("YHIGH"), sat: get("SATAVG") });
    }
    if (!stats.length) throw new Error("Не удалось измерить кадр.");
    const avg = (k) => stats.reduce((a, s) => a + (Number.isFinite(s[k]) ? s[k] : 0), 0) / stats.length;
    const y = avg("y");
    const low = avg("low");
    const high = avg("high");
    const sat = avg("sat");
    const r2 = (v) => Math.round(v * 100) / 100;
    const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
    return {
      exposure: r2(clampN(Math.log2(118 / Math.max(8, y)) * 0.7, -1, 1)),
      contrast: r2(high - low < 150 ? 1.1 : high - low < 190 ? 1.05 : 1),
      highlights: r2(high > 240 ? -0.35 : high > 225 ? -0.15 : 0),
      shadows: r2(low < 12 ? 0.3 : low < 25 ? 0.15 : 0),
      vibrance: r2(sat < 30 ? 0.4 : sat < 50 ? 0.25 : 0.1),
      clarity: 0.25,
      sharpness: 0.3,
      denoise: r2(y < 70 ? 0.3 : 0),
      measured: { y: Math.round(y), low: Math.round(low), high: Math.round(high), sat: Math.round(sat) },
    };
  });


  /** Кадр исходника до и после удаления водяного знака — тот же граф, что в сборке. */
  ipcMain.handle("montage:eraseFrame", async (_e, file, at = 0, erase = []) => {
    const info = await montage.probeMedia(ffmpegPath(), file);
    if (!info.width || !info.height) throw new Error("Не удалось прочитать размер кадра.");
    const list = montage.normalizeErase(erase);
    const dest = path.join(app.getPath("temp"), `montage-erase-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    const isImage = montage.mediaKind(file) === "image";
    try {
      const graph = list.length ? `${montage.eraseGraph(list, info.width, info.height, "[0:v]", "[c]")};[c]scale='min(1280,iw)':-2[o]` : "[0:v]scale='min(1280,iw)':-2[o]";
      await montage.runFfmpeg(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", ...(isImage ? [] : ["-ss", String(Math.max(0, at))]), "-i", file, "-filter_complex", graph, "-map", "[o]", "-frames:v", "1", "-q:v", "3", dest]);
      return { uri: `data:image/jpeg;base64,${(await fs.readFile(dest)).toString("base64")}`, width: info.width, height: info.height };
    } finally {
      await fs.rm(dest, { force: true }).catch(() => {});
    }
  });

  ipcMain.handle("montage:transcript", (_e, file) => readTranscript(file));
  ipcMain.handle("montage:transcripts", (_e, paths) => transcriptsFor(paths || []));

  /**
   * Расшифровать записи по словам. Уже расшифрованное не читается заново —
   * узнаётся по содержимому, как в «Видеотеке».
   */
  ipcMain.handle("montage:transcribe", async (event, paths, options = {}) => {
    if (queue) throw new Error("Расшифровка уже идёт.");
    const config = await readConfig();
    const settings = await loadSettings();
    const send = (payload) => {
      try {
        event.sender.send("montage-progress", payload);
      } catch {
        // окно закрыли посреди работы
      }
    };
    const bin = ffmpegPath();
    const dir = await transcriptsDir();
    await fs.mkdir(dir, { recursive: true });
    const work = await fs.mkdtemp(path.join(app.getPath("temp"), "montage-asr-"));
    const q = { stopped: false };
    queue = q;
    const done = [];
    const failed = [];
    try {
      for (let i = 0; i < paths.length; i++) {
        if (q.stopped) break;
        const filePath = paths[i];
        const name = path.basename(filePath);
        try {
          if (montage.mediaKind(filePath) === "image") continue;
          if (!options.force && (await readTranscript(filePath))) {
            send({ stage: "reused", index: i, total: paths.length, name });
            done.push(filePath);
            continue;
          }
          send({ stage: "audio", index: i, total: paths.length, name });
          const wav = path.join(work, "audio.wav");
          await library.extractAudio(bin, filePath, wav);
          const info = await montage.probeMedia(bin, filePath);
          send({ stage: "silence", index: i, total: paths.length, name });
          const silences = await montage.detectSilences(bin, wav, { total: info.duration });
          let asr;
          if (config.engine === "remote") {
            send({ stage: "remote", index: i, total: paths.length, name });
            const ogg = path.join(work, "audio.ogg");
            await library.extractAudioCompressed(bin, filePath, ogg);
            asr = await transcribeRemoteWords({ settings, model: config.remoteModel, audioPath: ogg, language: config.language });
          } else {
            const modelId = config.speechModel || MONTAGE_SPEECH_MODELS[0].id;
            try {
              asr = await speech.transcribeWords({
                wavPath: wav,
                modelId,
                cacheDir: await speechCacheDir(),
                language: config.language === "en" ? "english" : "russian",
                shouldStop: () => q.stopped,
                onProgress: (p) => send({ ...p, stage: p.stage === "download" ? "model" : p.stage, index: i, total: paths.length, name, modelId }),
              });
            } catch (e) {
              const reason = e instanceof Error ? e.message : String(e);
              throw new Error(
                `Модель распознавания «${modelId}» не загрузилась: ${reason}\n` +
                  "Если нет доступа к huggingface.co, выберите модель, уже скачанную в «Видеотеке», или расшифровку через сервис."
              );
            }
          }
          const { words, wordLevel } = montage.buildWords(asr, silences);
          const fp = await fingerprintOf(filePath);
          const doc = { fingerprint: fp, path: filePath, name, duration: info.duration || asr.seconds || 0, words, wordLevel, silences, engine: config.engine, at: Date.now() };
          await fs.writeFile(path.join(dir, `${fp}.json`), JSON.stringify(doc), "utf-8");
          done.push(filePath);
          send({ stage: "file-done", index: i, total: paths.length, name, words: words.length, wordLevel });
        } catch (e) {
          failed.push({ path: filePath, error: e instanceof Error ? e.message : String(e) });
          send({ stage: "file-failed", index: i, total: paths.length, name, error: e instanceof Error ? e.message : String(e) });
        }
      }
    } finally {
      queue = null;
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
    send({ stage: "done" });
    return { done, failed, stopped: q.stopped };
  });

  ipcMain.handle("montage:stop", () => {
    if (queue) queue.stopped = true;
    if (renderAbort) renderAbort.abort();
    return true;
  });

  /** Задание агенту: расшифровки выбранных записей + дизайн-система. */
  ipcMain.handle("montage:prepareAgent", async (_e, request = {}) => {
    const paths = (request.paths || []).filter((p) => montage.mediaKind(p) !== "image");
    const files = [];
    const missing = [];
    for (const p of paths) {
      const t = await readTranscript(p);
      if (t) files.push(t);
      else missing.push(path.basename(p));
    }
    let designText = "";
    if (request.designDir) {
      try {
        designText = (await readDesignFolder(request.designDir)).description || "";
      } catch {
        designText = "";
      }
    }
    const preset = montage.CANVAS_PRESETS.find((p) => p.id === request.preset) || montage.CANVAS_PRESETS[0];
    return {
      prompt: files.length ? montage.buildAgentPrompt({ files, design: designText, canvas: preset }) : "",
      files: files.map((f) => ({ path: f.path, name: f.name, words: f.words.length, duration: f.duration, wordLevel: f.wordLevel })),
      missing,
    };
  });

  ipcMain.handle("montage:parsePlan", (_e, text) => montage.parsePlan(text));

  /** План агента → проекты на таймлайне, по проекту на клип. */
  ipcMain.handle("montage:applyPlan", async (_e, request = {}) => {
    const { plan, paths = [], preset, designDir } = request;
    if (!plan || !plan.clips || !plan.clips.length) throw new Error("В ответе агента нет ни одного клипа.");
    const config = await readConfig();
    const files = [];
    for (const p of paths.filter((x) => montage.mediaKind(x) !== "image")) {
      const t = await readTranscript(p);
      if (t) files.push(t);
    }
    const presetObj = montage.CANVAS_PRESETS.find((p) => p.id === (preset || config.preset)) || montage.CANVAS_PRESETS[0];
    const captions = { ...config.captions };
    let logo = null;
    if (designDir) {
      const design = await readDesignFolder(designDir).catch(() => null);
      if (design) {
        if (design.fontFiles && design.fontFiles[0] && !captions.fontPath) {
          captions.fontPath = design.fontFiles[0].path;
          captions.font = design.fontFiles[0].family;
        }
        // Акцент субтитров — первый цвет системы, который не белый и не чёрный.
        const accent = (design.colours || []).find((c) => /^#[0-9a-f]{6}$/i.test(c) && !/^#(f{6}|0{6})$/i.test(c));
        if (accent) captions.highlight = accent;
        if (design.logoFiles && design.logoFiles[0]) logo = { path: design.logoFiles[0].path, corner: "top-right", size: 0.14 };
      }
    }
    const created = [];
    const dir = await projectsDir();
    for (const clip of plan.clips) {
      const { project, problems } = montage.planToProject(clip, files, {
        canvas: { preset: presetObj.id, width: presetObj.width, height: presetObj.height, fps: 30, fit: "crop" },
        captions,
        cleanup: config.cleanup,
        punchIn: config.cleanup.punchIn ?? 0.08,
        design: designDir ? { dir: designDir } : null,
      });
      if (logo && request.logo !== false) project.logo = logo;
      // Записи, из которых нарезан клип, — сразу в медиатеку проекта: добавить
      // соседний кусок той же записи руками должно быть можно без поиска файла.
      project.meta.bin = [...new Set(project.clips.map((c) => c.src))].map((src) => {
        const f = files.find((x) => x.path === src);
        return { path: src, kind: montage.mediaKind(src) || "video", duration: (f && f.duration) || 0 };
      });
      if (!project.clips.length) {
        created.push({ id: "", title: clip.name, problems: [...problems, "Ни одного куска не осталось — клип не создан."] });
        continue;
      }
      const saved = await montage.writeProject(dir, project);
      created.push({ id: saved.id, title: saved.title, duration: montage.projectDuration(saved), problems });
    }
    return created;
  });

  ipcMain.handle("montage:list", async () => montage.listProjects(await projectsDir()));
  ipcMain.handle("montage:read", async (_e, id) => montage.readProject(await projectsDir(), id));
  ipcMain.handle("montage:save", async (_e, project) => montage.writeProject(await projectsDir(), project));
  ipcMain.handle("montage:delete", async (_e, id) => {
    await montage.deleteProject(await projectsDir(), id);
    return true;
  });
  ipcMain.handle("montage:normalize", (_e, project) => montage.normalizeProject(project));
  ipcMain.handle("montage:validate", (_e, project) => montage.validateProject(montage.normalizeProject(project)));

  /** Убрать паузы и паразиты в кусках (все, если ids не заданы). */
  ipcMain.handle("montage:clean", async (_e, { clips, ids, options } = {}) => {
    const config = await readConfig();
    const opts = { ...config.cleanup, ...(options || {}) };
    const transcripts = await transcriptsFor(clips.map((c) => c.src));
    const out = [];
    let touched = 0;
    for (const raw of clips) {
      const clip = montage.normalizeClip(raw);
      const tr = transcripts[clip.src];
      if ((ids && !ids.includes(clip.id)) || !tr || clip.kind !== "video") {
        out.push(clip);
        continue;
      }
      const pieces = montage.cleanClip(clip, tr.words, opts);
      // Кусок без речи (перебивка, проход) чистка не трогает: резать в нём нечего.
      const hasWords = tr.words.some((w) => w.s >= clip.in && w.e <= clip.out);
      if (!hasWords) {
        out.push(clip);
        continue;
      }
      touched++;
      out.push(...pieces);
    }
    return { clips: out, touched };
  });

  ipcMain.handle("montage:cleanupStats", async (_e, { clips, options } = {}) => {
    const config = await readConfig();
    const opts = { ...config.cleanup, ...(options || {}) };
    const transcripts = await transcriptsFor(clips.map((c) => c.src));
    const sum = { before: 0, after: 0, removedSounds: 0, removedWords: 0, removedRepeats: 0, pieces: 0, untranscribed: 0 };
    for (const raw of clips) {
      const clip = montage.normalizeClip(raw);
      const tr = transcripts[clip.src];
      if (!tr) {
        if (clip.kind === "video") sum.untranscribed++;
        continue;
      }
      const s = montage.cleanupStats(tr.words, { from: clip.in, to: clip.out }, opts);
      for (const k of ["before", "after", "removedSounds", "removedWords", "removedRepeats", "pieces"]) sum[k] += s[k];
    }
    return sum;
  });

  ipcMain.handle("montage:cutWords", async (_e, { clip, indices }) => {
    const tr = await readTranscript(clip.src);
    if (!tr) throw new Error("У этого куска нет расшифровки — сначала расшифруйте запись.");
    return montage.cutWordsFromClip(montage.normalizeClip(clip), tr.words, new Set(indices || []));
  });


  // ---------- моушн ----------

  const motionCacheDir = async () => path.join(await montageRoot(), "motion-cache");
  motionAgent.setImageShrinker(async (file) => {
    const st = await fs.stat(file);
    if (st.size < 900 * 1024) return file;
    const dir = path.join(await motionCacheDir(), "images");
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `${motionLib.hash(file, st.size, st.mtimeMs)}.jpg`);
    if (fsSync.existsSync(out)) return out;
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return file;
    const { width, height } = img.getSize();
    const k = Math.min(1, 1600 / Math.max(width, height));
    await fs.writeFile(out, (k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "good" }) : img).toJPEG(86));
    return out;
  });
  const motionCtx = (settings) => ({ BrowserWindow, nativeImage, usage, settings, ffmpeg: ffmpegPath(), tmpDir: app.getPath("temp") });
  let motionAbort = null;

  /** Текст статьи или поста из файла: docx, pdf, txt, md, html. */
  ipcMain.handle("montage:readText", async (_e, file) => {
    if (!file) return "";
    if (/\.(txt|md|csv|json|html?)$/i.test(file)) return (await fs.readFile(file, "utf-8")).slice(0, 60000);
    if (extractDocText) return String((await extractDocText(file)) || "").slice(0, 60000);
    return "";
  });
  ipcMain.handle("montage:pickText", async () => (await pick({ title: "Статья, пост или сценарий", properties: ["openFile"], filters: [{ name: "Текст", extensions: ["txt", "md", "docx", "pdf", "rtf", "html", "htm"] }] }))[0] || null);
  ipcMain.handle("montage:pickImages", async () => pick({ title: "Фото для ролика", properties: ["openFile", "multiSelections"], filters: [{ name: "Картинки", extensions: ["png", "jpg", "jpeg", "webp"] }] }));

  /**
   * ИИ-моушн: дизайн-система + текст → готовая композиция.
   * Ход работы — событиями «montage-motion»: человек видит, что модель пишет.
   */
  ipcMain.handle("montage:motionGenerate", async (event, request = {}) => {
    const settings = await loadSettings();
    const config = await readConfig();
    const design = request.designDir ? await readDesignFolder(request.designDir).catch(() => null) : null;
    motionAbort = new AbortController();
    const send = (p) => {
      try {
        event.sender.send("montage-motion", p);
      } catch {
        // окно закрыли
      }
    };
    try {
      const r = await motionAgent.generate(
        motionCtx(settings),
        {
          design,
          text: String(request.text || ""),
          brief: String(request.brief || ""),
          photos: request.photos || [],
          width: request.width || 1080,
          height: request.height || 1920,
          duration: request.duration || 20,
          transparent: !!request.transparent,
          pair: String(request.pair || ""),
          review: request.review !== undefined ? !!request.review : config.motionReview !== false,
          model: request.model || config.motionModel || "",
          signal: motionAbort.signal,
        },
        send
      );
      return { ...r, designDir: request.designDir || "" };
    } finally {
      motionAbort = null;
    }
  });

  ipcMain.handle("montage:motionEdit", async (event, request = {}) => {
    const settings = await loadSettings();
    const config = await readConfig();
    const m = request.motion || {};
    const design = m.designDir ? await readDesignFolder(m.designDir).catch(() => null) : null;
    motionAbort = new AbortController();
    const send = (p) => {
      try {
        event.sender.send("montage-motion", p);
      } catch {
        // окно закрыли
      }
    };
    try {
      return await motionAgent.edit(
        motionCtx(settings),
        { design, html: m.html, assets: m.assets || {}, instruction: String(request.instruction || ""), width: request.width || 1080, height: request.height || 1920, duration: m.duration, transparent: !!m.transparent, pair: m.pair || "", model: request.model || config.motionModel || "", signal: motionAbort.signal },
        send
      );
    } finally {
      motionAbort = null;
    }
  });

  ipcMain.handle("montage:motionStop", () => {
    if (motionAbort) motionAbort.abort();
    return true;
  });

  /** Документ моушна для рамки предпросмотра. */
  ipcMain.handle("montage:motionDoc", (_e, m, size = {}) => motionAgent.docFor(montage.normalizeMotion(m), { width: size.width || 1080, height: size.height || 1920, readDesignFolder, preview: true }));

  /** Заготовки титров. */
  ipcMain.handle("montage:templates", () => motionTemplates.list());

  /** Шрифты: встроенная библиотека с кириллицей и шрифтовые пары. */
  ipcMain.handle("montage:fonts", () => ({ library: fontLibrary.library(), pairs: fontLibrary.pairs(), categories: fontLibrary.CATEGORY_NAMES }));
  ipcMain.handle("montage:systemFonts", () => fontLibrary.system());

  /** Картинка заготовки для сетки: кадр с середины на сером фоне, кэш на диске. */
  ipcMain.handle("montage:templateThumb", async (_e, id, designDir = "", pair = "") => {
    const dir = path.join(await motionCacheDir(), "thumbs");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}-${motionLib.hash(designDir, pair, "v2")}.jpg`);
    if (fsSync.existsSync(file)) return file;
    const r = await motionAgent.resolve({ template: id, fields: pair ? { __pair: pair } : {}, designDir, assets: {} }, readDesignFolder);
    const doc = motionLib.buildDoc({ html: r.html, width: 1080, height: 1920, theme: r.theme, assets: r.assets, background: "#3a3f4b" });
    const page = await motionRender.openDoc(BrowserWindow, doc, { width: 1080, height: 1920, tmpDir: app.getPath("temp") });
    try {
      const img = await page.grab(Math.min(r.duration * 0.55, 2.4), { settle: true });
      await fs.writeFile(file, img.resize({ width: 216 }).toJPEG(82));
    } finally {
      await page.close();
    }
    return file;
  });

  /** Отрендерить моушн отдельным файлом (кнопка «Сохранить как видео»). */
  ipcMain.handle("montage:motionExport", async (event, m, size = {}) => {
    const config = await readConfig();
    const outDir = await outputDirFor(config);
    const norm = montage.normalizeMotion(m);
    const r = await motionAgent.resolve(norm, readDesignFolder);
    const doc = motionLib.buildDoc({ html: r.html, width: size.width || 1080, height: size.height || 1920, theme: r.theme, assets: r.assets, transparent: norm.transparent });
    const out = await freeName(outDir, slug(norm.title || "моушн"), norm.transparent ? ".mov" : ".mp4");
    motionAbort = new AbortController();
    try {
      return await motionRender.renderToFile(BrowserWindow, doc, {
        width: size.width || 1080,
        height: size.height || 1920,
        fps: size.fps || 30,
        transparent: norm.transparent,
        outPath: out,
        ffmpeg: ffmpegPath(),
        tmpDir: app.getPath("temp"),
        signal: motionAbort.signal,
        onProgress: (p) => event.sender.send("montage-motion", { stage: "render", progress: p }),
      });
    } finally {
      motionAbort = null;
    }
  });


  // ---------- удаление фона ----------

  const bgCacheDir = async () => {
    const d = path.join(await montageRoot(), "cache", "bg");
    await fs.mkdir(d, { recursive: true });
    return d;
  };
  const modelsDir = () => (speechCacheDir ? speechCacheDir() : path.join(app.getPath("userData"), "models"));
  let bgAbort = null;
  const bgJobs = new Map();

  /** Маска куска (кэш по ключу настроек). image — картинка: маска одним кадром. */
  async function bgMaskFor(item, onProgress) {
    const key = montage.bgKey(item);
    const st = await fs.stat(item.src);
    const image = montage.mediaKind(item.src) === "image";
    const out = path.join(await bgCacheDir(), `${motionLib.hash(key, st.size, st.mtimeMs, "m1")}.${image ? "png" : "mp4"}`);
    if (fsSync.existsSync(out)) return { key, mask: out };
    if (bgJobs.has(out)) return bgJobs.get(out);
    const job = (async () => {
      bgAbort = bgAbort || new AbortController();
      const cacheDir = typeof modelsDir() === "string" ? modelsDir() : await modelsDir();
      await bgremove.maskVideo({ bin: ffmpegPath(), src: item.src, from: item.in, dur: Math.max(0.1, item.out - item.in), image, out, kind: item.bgRemove.model, quality: item.bgRemove.quality, cacheDir, onProgress, signal: bgAbort.signal });
      return { key, mask: out };
    })();
    bgJobs.set(out, job);
    try {
      return await job;
    } finally {
      bgJobs.delete(out);
    }
  }

  /** Маска + готовый вид для предпросмотра (540p). */
  ipcMain.handle("montage:bgPrepare", async (event, raw, which = "clip") => {
    const item = which === "layer" ? montage.normalizeProject({ layers: [raw] }).layers[0] : montage.normalizeProject({ clips: [raw] }).clips[0];
    if (!item || !item.bgRemove) throw new Error("Удаление фона выключено.");
    const send = (p) => {
      try {
        event.sender.send("montage-bg", { id: raw.id, ...p });
      } catch {
        // окно закрыли
      }
    };
    try {
      const { key, mask } = await bgMaskFor(item, send);
      const b = item.bgRemove;
      const image = montage.mediaKind(item.src) === "image";
      const transparent = which === "layer" || b.replace === "transparent";
      const prevKey = motionLib.hash(mask, transparent ? "t" : b.replace, b.color, b.image, b.soft, "p1");
      const preview = path.join(await bgCacheDir(), `${prevKey}.${transparent ? "webm" : "mp4"}`);
      if (!fsSync.existsSync(preview)) {
        send({ stage: "preview", progress: 0.99 });
        await bgremove.previewFile({ bin: ffmpegPath(), src: item.src, from: item.in, dur: image ? Math.max(1, item.out - item.in) : item.out - item.in, image, mask, out: preview, replace: transparent ? "transparent" : b.replace, color: b.color, bgImage: b.image, soft: b.soft });
      }
      send({ stage: "done", progress: 1 });
      return { key, mask, preview };
    } finally {
      bgAbort = null;
    }
  });
  ipcMain.handle("montage:bgStop", () => {
    if (bgAbort) bgAbort.abort();
    return true;
  });
  ipcMain.handle("montage:bgModels", () => bgremove.MODELS);

  ipcMain.handle("montage:readDesign", (_e, dir) => readDesignFolder(dir));
  ipcMain.handle("montage:showItem", (_e, p) => shell.showItemInFolder(p));
  ipcMain.handle("montage:openPath", (_e, p) => shell.openPath(p));

  // ---------- сборка ----------

  let renderAbort = null;

  async function outputDirFor(config) {
    if (config.outputDir) return config.outputDir;
    const dir = path.join(await montageRoot(), "готовые");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async function fontFilesFor(project) {
    const fonts = [];
    if (project.captions && project.captions.fontPath) fonts.push({ path: project.captions.fontPath, family: project.captions.font, role: "caption" });
    if (project.design && project.design.dir) {
      const design = await readDesignFolder(project.design.dir).catch(() => null);
      const files = (design && design.fontFiles) || [];
      if (files[0] && !fonts.length) fonts.push({ path: files[0].path, family: files[0].family, role: "caption" });
      // Второй шрифт системы (обычно заголовочный) — для надписей.
      const headline = files.find((f) => /bold|black|heavy|display|head|title|extra/i.test(f.family)) || files[1];
      if (headline) fonts.push({ path: headline.path, family: headline.family, role: "text" });
    }
    return fonts;
  }

  async function renderOne(event, raw, { outDir, index = 0, total = 1, exportOptions = {} } = {}) {
    const project = montage.normalizeProject(raw);
    const send = (p) => {
      try {
        event.sender.send("montage-render", { ...p, index, total, title: project.title });
      } catch {
        // окно закрыли
      }
    };
    const format = fx.EXPORT_FORMATS.find((f) => f.id === exportOptions.format) || fx.EXPORT_FORMATS[0];
    const outPath = await freeName(outDir, slug(project.title) + (exportOptions.suffix || ""), format.ext);
    const work = await fs.mkdtemp(path.join(app.getPath("temp"), "montage-render-"));
    renderAbort = new AbortController();
    try {
      await motionAgent.prerender(motionCtx(), project, { cacheDir: await motionCacheDir(), readDesignFolder, onProgress: send, signal: renderAbort.signal });
      // Маски удаления фона: готовые берутся из кэша, недостающие считаются сейчас.
      const withBg = [...project.clips, ...project.layers].filter((x) => x.bgRemove);
      for (const [i, item] of withBg.entries()) {
        const { key, mask } = await bgMaskFor(item, (p) => send({ stage: "bg", progress: (i + (p.progress || 0)) / withBg.length, message: `Удаляю фон: ${i + 1} из ${withBg.length}` }));
        item.bgRemove.cache = { ...(item.bgRemove.cache || {}), key, mask };
      }
      const result = await montage.renderProject({
        bin: ffmpegPath(),
        project,
        transcripts: await transcriptsFor(project.clips.map((c) => c.src)),
        outPath,
        workDir: work,
        fontFiles: await fontFilesFor(project),
        onProgress: send,
        signal: renderAbort.signal,
        exportOptions,
      });
      // Описание для публикации и подпись авторов стока (её просит CC BY) —
      // рядом с роликом, чтобы не искать их в приложении.
      const used = [...project.clips.map((c) => c.src), ...project.layers.map((l) => l.src), ...project.audio.map((a) => a.src)];
      const credits = await stock.creditsFor(await stockDir(), used).catch(() => "");
      const text = [project.meta && project.meta.hook, project.meta && project.meta.description, credits].filter(Boolean).join("\n\n");
      if (text) await fs.writeFile(outPath.replace(/\.[^.]+$/, ".txt"), text + "\n", "utf-8").catch(() => {});
      return result;
    } finally {
      renderAbort = null;
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  ipcMain.handle("montage:render", async (event, project, exportOptions) => {
    const config = await readConfig();
    return renderOne(event, project, { outDir: await outputDirFor(config), exportOptions: exportOptions || {} });
  });

  /**
   * Несколько форматов за раз: «mp4 для Reels + GIF для сайта + mp3 для подкаста».
   * Каждый собирается своим проходом — форматы различаются размером и кодеком.
   */
  ipcMain.handle("montage:exportMany", async (event, project, targets = []) => {
    const config = await readConfig();
    const outDir = await outputDirFor(config);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      try {
        results.push({ target: targets[i], ...(await renderOne(event, project, { outDir, index: i, total: targets.length, exportOptions: targets[i] })) });
      } catch (e) {
        results.push({ target: targets[i], error: e instanceof Error ? e.message : String(e) });
        if (/остановлена/.test(String(e && e.message))) break;
      }
    }
    return results;
  });

  ipcMain.handle("montage:renderMany", async (event, ids, exportOptions) => {
    const config = await readConfig();
    const outDir = await outputDirFor(config);
    const dir = await projectsDir();
    const results = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const project = await montage.readProject(dir, ids[i]);
        results.push({ id: ids[i], ...(await renderOne(event, project, { outDir, index: i, total: ids.length, exportOptions: exportOptions || {} })) });
      } catch (e) {
        results.push({ id: ids[i], error: e instanceof Error ? e.message : String(e) });
        if (/остановлена/.test(String(e && e.message))) break;
      }
    }
    return results;
  });

  // ---------- звуки и сток ----------

  /** Звуковой эффект из библиотеки — собирается один раз и лежит в данных. */
  ipcMain.handle("montage:sfx", async (_e, id) => {
    const dir = path.join(await montageRoot(), "звуки");
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${id}.wav`);
    if (!fsSync.existsSync(dest)) await montage.runFfmpeg(ffmpegPath(), fx.sfxArgs(id, dest));
    return dest;
  });

  const stockDir = async () => path.join(await montageRoot(), "сток");

  ipcMain.handle("montage:stockSearch", async (_e, request = {}) => {
    const k = await readKeys();
    const settings = await loadSettings().catch(() => ({}));
    // Ключ Pexels уже мог быть задан в «Видео-сторис» — второй раз не просим.
    const keys = { ...k, pexels: k.pexels || settings.pexelsKey || "" };
    return stock.search({ ...request, keys });
  });

  ipcMain.handle("montage:stockDownload", async (event, item) => {
    const send = (progress) => {
      try {
        event.sender.send("montage-stock", { id: item.id, provider: item.provider, progress });
      } catch {
        // окно закрыли
      }
    };
    const dest = await stock.download(item, await stockDir(), { onProgress: send });
    send(1);
    return dest;
  });

  // ---------- аватар ----------

  ipcMain.handle("montage:avatarKeys", async () => {
    const k = await readKeys();
    // Окну отдаются не ключи, а то, что они заданы.
    return keyStatus(k);
  });
  ipcMain.handle("montage:saveAvatarKeys", async (_e, patch = {}) => {
    const k = await readKeys();
    for (const key of KEY_NAMES) if (typeof patch[key] === "string" && patch[key].trim()) k[key] = patch[key].trim();
    if (patch.forgetVoices) k.voices = {};
    await fs.mkdir(path.dirname(keysFile()), { recursive: true });
    await fs.writeFile(keysFile(), JSON.stringify(k, null, 2), "utf-8");
    return keyStatus(k);
  });

  ipcMain.handle("montage:heygenList", async () => {
    const k = await readKeys();
    if (!k.heygen) throw new Error("Нужен ключ HeyGen.");
    const [avatars, voices] = await Promise.all([avatar.heygenAvatars({ apiKey: k.heygen }), avatar.heygenVoices({ apiKey: k.heygen })]);
    return { avatars, voices };
  });

  /**
   * Сделать ролик аватара.
   * mode "own": голос — клон по вашему видео, губы — синхронизация в нём же.
   * mode "heygen": двойник и голос из кабинета HeyGen.
   */
  ipcMain.handle("montage:avatarRun", async (event, request = {}) => {
    const k = await readKeys();
    const config = await readConfig();
    const outDir = await outputDirFor(config);
    const send = (stage, extra = {}) => {
      try {
        event.sender.send("montage-avatar", { stage, ...extra });
      } catch {
        // окно закрыли
      }
    };
    const text = String(request.text || "").trim();
    if (!text) throw new Error("Вставьте текст, который должен сказать аватар.");
    const base = slug(request.title || text.split(/\s+/).slice(0, 6).join(" "));

    if (request.mode === "heygen") {
      if (!k.heygen) throw new Error("Нужен ключ HeyGen.");
      if (!request.avatarId || !request.voiceId) throw new Error("Выберите двойника и голос HeyGen.");
      const preset = montage.CANVAS_PRESETS.find((p) => p.id === request.preset) || montage.CANVAS_PRESETS[0];
      send("heygen");
      const url = await avatar.heygenGenerate({
        apiKey: k.heygen, avatarId: request.avatarId, photo: !!request.photo, voiceId: request.voiceId, text,
        width: preset.width, height: preset.height, onStatus: (s) => send("heygen", { status: s }),
      });
      send("download");
      const dest = await freeName(outDir, `${base}-аватар`, ".mp4");
      await avatar.download(url, dest);
      send("done", { path: dest });
      return { path: dest };
    }

    const video = request.videoPath;
    if (!video || !fsSync.existsSync(video)) throw new Error("Укажите своё видео — по нему делается и голос, и лицо.");
    if (!k.eleven) throw new Error("Нужен ключ ElevenLabs — для клона голоса.");
    if (!k.fal) throw new Error("Нужен ключ fal.ai — для синхронизации губ.");
    const work = await fs.mkdtemp(path.join(app.getPath("temp"), "montage-avatar-"));
    try {
      // Голос клонируется один раз на запись: тот же ролик — тот же голос, без
      // лишних клонов в кабинете ElevenLabs.
      const voiceSource = request.voicePath || video;
      const fp = await fingerprintOf(voiceSource);
      k.voices = k.voices || {};
      let voiceId = k.voices[fp];
      if (!voiceId) {
        send("sample");
        const sample = path.join(work, "голос.mp3");
        await montage.runFfmpeg(ffmpegPath(), avatar.voiceSampleArgs(voiceSource, sample));
        send("clone");
        voiceId = await avatar.cloneVoice({ apiKey: k.eleven, name: `Мой голос — ${path.basename(voiceSource)}`, samplePaths: [sample] });
        k.voices[fp] = voiceId;
        await fs.writeFile(keysFile(), JSON.stringify(k, null, 2), "utf-8");
      }
      send("speech");
      const speechFile = path.join(work, "озвучка.mp3");
      await avatar.synthesize({ apiKey: k.eleven, voiceId, text, dest: speechFile, speed: Number(request.speed) || 1 });
      const audioOut = await freeName(outDir, `${base}-озвучка`, ".mp3");
      await fs.copyFile(speechFile, audioOut);
      // Видео для губ: не длиннее двух минут и в разумном размере — модель
      // берёт деньги за секунды и мегабайты, а лишнее ей не нужно.
      send("prepare");
      const face = path.join(work, "лицо.mp4");
      await montage.runFfmpeg(ffmpegPath(), [
        "-y", "-hide_banner", "-loglevel", "error", "-ss", String(Number(request.from) || 0), "-t", "120", "-i", video,
        "-vf", "scale='min(1080,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", face,
      ]);
      send("lipsync");
      const url = await avatar.lipsync({ apiKey: k.fal, videoPath: face, audioPath: speechFile, model: request.model, onStatus: (s, q) => send("lipsync", { status: s, queue: q }) });
      send("download");
      const dest = await freeName(outDir, `${base}-аватар`, ".mp4");
      await avatar.download(url, dest);
      send("done", { path: dest, audio: audioOut });
      return { path: dest, audio: audioOut };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });
}

module.exports = { SCHEME, MONTAGE_SPEECH_MODELS, registerScheme, handleProtocol, register };
