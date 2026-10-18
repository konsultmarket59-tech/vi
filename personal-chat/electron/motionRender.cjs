// Рендер моушн-композиции: невидимое окно браузера → кадры → ffmpeg.
//
// Кадр снимается из события отрисовки, а не запросом «сними экран»: под
// нагрузкой запрос возвращал то, что было на экране до перемотки (это
// выяснено ещё в «Видео-сторис»). Кадры уходят в ffmpeg сразу, сырыми, без
// промежуточных картинок на диске: ролик на 35 секунд — это тысяча кадров по
// восемь мегабайт.

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Открыть композицию в невидимом окне и дождаться шрифтов и картинок.
 * @param {typeof import("electron").BrowserWindow} BrowserWindow
 */
async function openDoc(BrowserWindow, doc, { width, height, transparent, tmpDir }) {
  const file = path.join(tmpDir, `motion-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fs.writeFile(file, doc, "utf-8");
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: !!transparent,
    backgroundColor: transparent ? "#00000000" : "#000000",
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  let painted = 0;
  let last = null;
  win.webContents.on("paint", (_e, _d, image) => {
    painted++;
    last = image;
  });
  try {
    await win.loadFile(file);
    // Размер — после открытия: при создании окно обрезается по высоте экрана,
    // и вертикальный кадр на обычном мониторе вышел бы обрезанным.
    win.setContentSize(width, height);
    const exec = (js) => win.webContents.executeJavaScript(js, true);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await exec("!!(window.__state && window.__state.ready)").catch(() => false)) break;
      await sleep(50);
    }
    const once = async (t) => {
      const before = painted;
      await exec(`window.__seek(${Number(t).toFixed(4)}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
      win.webContents.invalidate();
      const until = Date.now() + 1500;
      while (painted === before && Date.now() < until) await sleep(4);
      const img = last || (await win.webContents.capturePage());
      const size = img.getSize();
      // На экране с увеличением кадр приходит крупнее — приводим к размеру холста.
      return size.width === width && size.height === height ? img : img.resize({ width, height, quality: "best" });
    };
    const sig = (img) => img.resize({ width: 24, height: 24, quality: "good" }).toBitmap().toString("base64");
    let fresh = true;
    // Первый снимок после открытия (и после тяжёлой смены кадра — большие
    // размытые тени в программной отрисовке) приходит прежним. Поэтому первый
    // кадр снимается дважды, а одиночные снимки (settle: картинка заготовки,
    // лист кадров для модели) — пока картинка не перестанет меняться. В рендере
    // кадры идут подряд, и проверка только удлинила бы сборку.
    const grab = async (t, { settle = false } = {}) => {
      let img = await once(t);
      if (fresh) {
        fresh = false;
        img = await once(t);
      }
      if (settle) {
        for (let k = 0; k < 4; k++) {
          const next = await once(t);
          const same = sig(next) === sig(img);
          img = next;
          if (same) break;
        }
      }
      return img;
    };
    // Прогрев отрисовки: первые кадры после открытия приходят устаревшими.
    await once(0.001);
    await once(0);
    return {
      win,
      exec,
      grab,
      close: async () => {
        if (!win.isDestroyed()) win.destroy();
        await fs.rm(file, { force: true }).catch(() => {});
      },
    };
  } catch (e) {
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(file, { force: true }).catch(() => {});
    throw e;
  }
}

/** Проверка композиции: ошибки, длительность, вёрстка в нескольких точках. */
async function inspect(BrowserWindow, doc, opts) {
  const page = await openDoc(BrowserWindow, doc, opts);
  try {
    const duration = await page.exec("window.__duration ? window.__duration() : 0").catch(() => 0);
    const audit = [];
    const points = duration > 0 ? [0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((k) => k * duration) : [];
    for (const t of points) {
      const found = await page.exec(`window.__audit ? window.__audit(${t}) : []`).catch(() => []);
      audit.push(...found);
    }
    const errors = await page.exec("window.__state ? window.__state.errors : []").catch((e) => [String(e && e.message)]);
    return { duration: Math.round(duration * 1000) / 1000, errors, audit };
  } finally {
    await page.close();
  }
}

/** Кадры для просмотра моделью: лист кадров одной картинкой (PNG). */
async function contactSheet(BrowserWindow, doc, opts, { count = 8, ffmpeg, width = 1200 } = {}) {
  const page = await openDoc(BrowserWindow, doc, opts);
  const dir = await fs.mkdtemp(path.join(opts.tmpDir, "sheet-"));
  try {
    const duration = await page.exec("window.__duration()");
    const times = [];
    for (let i = 0; i < count; i++) times.push(((i + 0.5) / count) * duration);
    for (let i = 0; i < times.length; i++) {
      const img = await page.grab(times[i], { settle: true });
      await fs.writeFile(path.join(dir, `f${i}.png`), img.toPNG());
    }
    const cols = Math.min(4, count);
    const rows = Math.ceil(count / cols);
    const cell = Math.round(width / cols);
    const out = path.join(dir, "sheet.png");
    // Кадры по порядку, слева направо и сверху вниз; секунды каждого — в тексте запроса.
    await run(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-framerate", "1", "-i", path.join(dir, "f%d.png"), "-vf", `scale=${cell}:-2,pad=iw+8:ih+8:4:4:color=0x333333,tile=${cols}x${rows}`, "-frames:v", "1", out]);
    return { png: await fs.readFile(out), times, duration };
  } finally {
    await page.close();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.trim().split("\n").slice(-4).join("\n")))));
  });
}

/**
 * Отрендерить композицию в файл.
 * transparent → MOV ProRes 4444 с прозрачностью (титр поверх видео),
 * иначе MP4 H.264.
 */
async function renderToFile(BrowserWindow, doc, { width, height, fps = 30, duration, transparent = false, outPath, ffmpeg, tmpDir, onProgress, signal }) {
  const page = await openDoc(BrowserWindow, doc, { width, height, transparent, tmpDir });
  let proc = null;
  try {
    const dur = duration || (await page.exec("window.__duration()"));
    if (!dur || dur < 0.1) throw new Error("В композиции нет анимации — шкала пустая.");
    const frames = Math.max(1, Math.round(dur * fps));
    const codec = transparent
      ? ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
      : ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    proc = spawn(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", `${width}x${height}`, "-r", String(fps), "-i", "-", ...codec, "-r", String(fps), outPath], { windowsHide: true });
    let err = "";
    proc.stderr.on("data", (d) => (err += d));
    const done = new Promise((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim().split("\n").slice(-4).join("\n")}`))));
    });
    for (let i = 0; i < frames; i++) {
      if (signal && signal.aborted) throw new Error("Рендер остановлен.");
      const img = await page.grab(i / fps);
      const buf = img.toBitmap();
      if (!proc.stdin.write(buf)) await new Promise((r) => proc.stdin.once("drain", r));
      if (onProgress && (i % 5 === 0 || i === frames - 1)) onProgress((i + 1) / frames);
    }
    proc.stdin.end();
    await done;
    return { path: outPath, duration: frames / fps, frames };
  } catch (e) {
    if (proc && !proc.killed) proc.kill("SIGKILL");
    throw e;
  } finally {
    await page.close();
  }
}

module.exports = { openDoc, inspect, contactSheet, renderToFile };
