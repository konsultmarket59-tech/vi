// Рендер дизайна в точный размер: статичный PNG и анимационный MP4.
//
// Две вещи, из-за которых это отдельный модуль, а не пара строк.
//
// 1. Снимок окна ограничен экраном. Пост 1080×1350 на ноутбуке с высотой экрана
//    1080 снимался обрезанным — и молча: файл получался «правильный», просто без
//    нижней части макета. Поэтому макет рендерится полосами: страница сдвигается
//    трансформом, каждая полоса снимается отдельно и они склеиваются в исходный
//    размер. Если макет и так помещается на экран, полоса одна и ничего не меняется.
//
// 2. Ролик нельзя снимать «в реальном времени»: захват не поспевает за кадрами и
//    видео выходит рваным. Здесь время не идёт само — приложение останавливает все
//    анимации и вручную ставит каждой нужный момент (Web Animations API), поэтому на
//    выходе ровно fps × длительность кадров, сколько бы ни рисовался каждый.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { BrowserWindow, screen } = require("electron");

const MAX_DURATION_SEC = 60;
const DEFAULT_FPS = 30;
// Запас под рамку окна и панель задач: окно выше рабочей области система обрежет.
const SCREEN_MARGIN = 80;

function ffmpegPath() {
  const raw = require("ffmpeg-static");
  if (!raw) throw new Error("ffmpeg не найден в сборке приложения.");
  // В собранном приложении модули лежат в архиве app.asar, откуда бинарник не
  // запустить; electron-builder распаковывает его рядом (см. asarUnpack).
  return raw.replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep).replace("app.asar/", "app.asar.unpacked/");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { maxBuffer: 1024 * 1024 * 16 }, (error, _stdout, stderr) => {
      // ffmpeg пишет ход работы в stderr и при успехе — об ошибке говорит код возврата.
      if (error) reject(new Error(`ffmpeg: ${String(stderr || error.message).split("\n").slice(-6).join(" ").trim()}`));
      else resolve();
    });
  });
}

/** Сколько полос нужно и какой они высоты для макета заданного размера. */
function planTiles(height) {
  const usable = Math.max(400, (screen.getPrimaryDisplay()?.workAreaSize?.height || height) - SCREEN_MARGIN);
  const tileHeight = Math.min(height, usable);
  const count = Math.ceil(height / tileHeight);
  return { tileHeight, count };
}

function page(html, width, tileHeight) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:${width}px;height:${tileHeight}px;overflow:hidden;background:#fff}
    #pc-shift{position:absolute;top:0;left:0;will-change:transform}
  </style></head><body><div id="pc-shift">${html}</div>
  <script>
    const shift = document.getElementById('pc-shift');
    window.__pcShift = (y) => { shift.style.transform = 'translateY(' + (-y) + 'px)'; return true; };
    window.__pcSeek = (timeMs) => {
      const animations = document.getAnimations ? document.getAnimations() : [];
      for (const animation of animations) {
        animation.pause();
        try {
          animation.currentTime = timeMs;
        } catch {
          // Бесконечная анимация не принимает время за пределами цикла — приводим
          // его к её собственному циклу.
          const total = animation.effect && animation.effect.getComputedTiming().duration;
          if (total) animation.currentTime = timeMs % total;
        }
      }
      return animations.length;
    };
    window.__pcReady = true;
  </script></body></html>`;
}

async function openStage(html, width, tileHeight, workDir) {
  const pageFile = path.join(workDir, "stage.html");
  await fs.writeFile(pageFile, page(html, width, tileHeight), "utf-8");
  const win = new BrowserWindow({
    show: false,
    width,
    height: tileHeight,
    useContentSize: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
  });
  await win.loadFile(pageFile);
  await win.webContents.executeJavaScript("window.__pcReady === true");
  return win;
}

/** Снимает все полосы одного кадра и возвращает пути к их файлам. */
async function captureTiles(win, { width, height, tileHeight, count }, workDir, prefix) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const offset = i * tileHeight;
    const thisHeight = Math.min(tileHeight, height - offset);
    if (count > 1) await win.webContents.executeJavaScript(`window.__pcShift(${offset})`);
    let image = await win.webContents.capturePage();
    const size = image.getSize();
    // Последняя полоса короче окна — обрезаем, иначе склейка выйдет длиннее макета.
    if (size.height !== thisHeight || size.width !== width) {
      image = image.crop({ x: 0, y: 0, width: Math.min(width, size.width), height: Math.min(thisHeight, size.height) });
    }
    const file = path.join(workDir, `${prefix}-t${i}.png`);
    await fs.writeFile(file, image.toPNG());
    files.push(file);
  }
  return files;
}

/** Статичный макет в PNG точного размера. */
async function renderPng({ html, width = 1080, height = 1080, outPath }) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pc-render-"));
  const plan = { width, height, ...planTiles(height) };
  const win = await openStage(html, width, plan.tileHeight, workDir);
  let tiles;
  try {
    tiles = await captureTiles(win, plan, workDir, "frame");
  } finally {
    win.destroy();
  }

  if (tiles.length === 1) {
    await fs.copyFile(tiles[0], outPath);
  } else {
    await runFfmpeg([
      "-y",
      ...tiles.flatMap((f) => ["-i", f]),
      "-filter_complex", `vstack=inputs=${tiles.length}`,
      outPath,
    ]);
  }
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  return { path: outPath, width, height, tiles: tiles.length };
}

/** Анимационный ролик в MP4. */
async function renderMp4({ html, width = 1080, height = 1080, fps = DEFAULT_FPS, durationSec = 5, outPath, onProgress }) {
  const duration = Math.min(Math.max(Number(durationSec) || 5, 0.5), MAX_DURATION_SEC);
  const rate = Math.min(Math.max(Math.round(Number(fps) || DEFAULT_FPS), 5), 60);
  // H.264 не кодирует нечётные стороны — приводим заранее, иначе ffmpeg упадёт уже
  // после того, как все кадры сняты.
  const w = Math.round(width / 2) * 2;
  const h = Math.round(height / 2) * 2;
  const frameCount = Math.max(1, Math.round(duration * rate));

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pc-motion-"));
  const plan = { width: w, height: h, ...planTiles(h) };
  const win = await openStage(html, w, plan.tileHeight, workDir);

  try {
    for (let i = 0; i < frameCount; i++) {
      const timeMs = (i / rate) * 1000;
      await win.webContents.executeJavaScript(`window.__pcSeek(${timeMs})`);
      await captureTiles(win, plan, workDir, `f${String(i).padStart(5, "0")}`);
      onProgress?.({ frame: i + 1, total: frameCount });
    }
  } finally {
    win.destroy();
  }

  // По одной последовательности кадров на полосу — склейка и кодирование одним
  // запуском ffmpeg, а не по процессу на кадр.
  const inputs = [];
  for (let t = 0; t < plan.count; t++) {
    inputs.push("-framerate", String(rate), "-i", path.join(workDir, `f%05d-t${t}.png`));
  }
  const filter = plan.count > 1 ? ["-filter_complex", `vstack=inputs=${plan.count}`] : [];
  await runFfmpeg([
    "-y",
    ...inputs,
    ...filter,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    // Без yuv420p ролик не откроется в половине плееров и не примут соцсети.
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ]);

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  return { path: outPath, frames: frameCount, fps: rate, durationSec: duration, width: w, height: h };
}

module.exports = { renderPng, renderMp4, MAX_DURATION_SEC, DEFAULT_FPS };
