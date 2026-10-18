// Удаление фона нейросетью — по кадрам, локально.
//
// «Человек» — MODNet (матирование портрета, Apache-2.0): быстрая, подходит
// для говорящей головы и людей в полный рост. «Любой объект» — BiRefNet lite
// (MIT): точнее на предметах и сложных краях, но заметно медленнее. Модели
// скачиваются с Hugging Face при первом использовании и дальше лежат на диске.
//
// Результат — видео-маска (белое — объект) той же длины, что кусок: её
// использует сборка (прозрачность слоя или замена фона главного видео) и
// предпросмотр. Маска сглаживается по времени — край не «кипит» от кадра к кадру.

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MODELS = {
  person: { id: "Xenova/modnet", name: "Человек (быстро)" },
  object: { id: "onnx-community/BiRefNet_lite-ONNX", name: "Любой объект (точнее, медленнее)" },
};
const QUALITY = { fast: 256, good: 384, best: 512 };

let loaded = null;
async function loadModel(kind, cacheDir, onProgress) {
  const key = `${kind}|${cacheDir}`;
  if (loaded && loaded.key === key) return loaded;
  const T = await import("@huggingface/transformers");
  if (cacheDir) {
    await fs.mkdir(cacheDir, { recursive: true });
    T.env.cacheDir = cacheDir;
  }
  // Для проверок модель подкладывается из папки — без сети.
  if (process.env.MONTAGE_MODELS_DIR) {
    T.env.localModelPath = process.env.MONTAGE_MODELS_DIR;
    T.env.allowRemoteModels = false;
  }
  T.env.allowLocalModels = true;
  const progress_callback = (p) => {
    if (onProgress && p && p.status === "progress" && p.total) onProgress({ stage: "download", progress: p.loaded / p.total, file: p.file });
  };
  const dtype = process.env.MONTAGE_BG_DTYPE || (kind === "person" ? "fp32" : "fp16");
  if (kind === "person") {
    const model = await T.AutoModel.from_pretrained(MODELS.person.id, { dtype, progress_callback });
    loaded = { key, kind, T, model };
  } else {
    const pipe = await T.pipeline("background-removal", MODELS.object.id, { dtype, progress_callback });
    loaded = { key, kind, T, pipe };
  }
  return loaded;
}

/** Размер входа модели: короткая сторона — по качеству, стороны кратны 32. */
function modelSize(w, h, quality) {
  const S = QUALITY[quality] || QUALITY.good;
  const k = S / Math.min(w, h);
  const r32 = (v) => Math.max(32, Math.round((v * k) / 32) * 32);
  return { w: r32(w), h: r32(h) };
}

/** Маска одного кадра (RGB) → Uint8 серый того же размера. */
async function maskFrame(m, rgb, w, h) {
  if (m.kind === "person") {
    const n = w * h;
    const data = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      data[i] = rgb[i * 3] / 127.5 - 1;
      data[n + i] = rgb[i * 3 + 1] / 127.5 - 1;
      data[2 * n + i] = rgb[i * 3 + 2] / 127.5 - 1;
    }
    const input = new m.T.Tensor("float32", data, [1, 3, h, w]);
    const out = await m.model({ input });
    const t = out.output || Object.values(out)[0];
    const src = t.data;
    const res = new Uint8Array(n);
    for (let i = 0; i < n; i++) res[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
    return res;
  }
  // Общий путь: конвейер сам готовит вход модели и возвращает картинку с альфой.
  const img = new m.T.RawImage(new Uint8ClampedArray(rgb), w, h, 3);
  const out = await m.pipe(img);
  const r = Array.isArray(out) ? out[0] : out;
  const rr = r.width === w && r.height === h ? r : await r.resize(w, h);
  const n = w * h;
  const res = new Uint8Array(n);
  const ch = rr.channels;
  for (let i = 0; i < n; i++) res[i] = rr.data[i * ch + ch - 1];
  return res;
}

function probeSize(bin, file) {
  return new Promise((resolve) => {
    const p = spawn(bin, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => {
      const v = err.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
      const rot = err.match(/rotation of (-?[\d.]+)/);
      let w = v ? Number(v[1]) : 0;
      let h = v ? Number(v[2]) : 0;
      if (rot && Math.abs(Math.abs(Number(rot[1])) - 90) < 1) [w, h] = [h, w];
      resolve({ w, h });
    });
    p.on("error", () => resolve({ w: 0, h: 0 }));
  });
}

/**
 * Видео-маска куска [from, from+dur] исходника.
 * maskFps — сколько кадров в секунду считает модель (остальные — из соседних).
 */
async function maskVideo({ bin, src, from = 0, dur = 0, image = false, out, kind = "person", quality = "good", maskFps = 12, cacheDir, onProgress, signal }) {
  const { w: sw, h: sh } = await probeSize(bin, src);
  if (!sw || !sh) throw new Error("Не удалось прочитать размер кадра.");
  const { w, h } = modelSize(sw, sh, quality);
  onProgress && onProgress({ stage: "model", progress: 0 });
  const m = await loadModel(kind, cacheDir, onProgress);
  const fps = image ? 1 : maskFps;
  const total = image ? 1 : Math.max(1, Math.round(dur * fps));
  const dec = spawn(bin, ["-hide_banner", "-loglevel", "error", ...(image ? [] : ["-ss", String(from), "-t", String(dur)]), "-i", src, "-vf", `fps=${fps},scale=${w}:${h}`, ...(image ? ["-frames:v", "1"] : []), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { windowsHide: true });
  const tmp = out.replace(/(\.\w+)$/, ".part$1");
  const enc = spawn(bin, ["-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${w}x${h}`, "-r", String(fps), "-i", "-", ...(image ? ["-frames:v", "1", tmp] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-pix_fmt", "yuv420p", tmp])], { windowsHide: true });
  let encErr = "";
  enc.stderr.on("data", (d) => (encErr += d));
  const encDone = new Promise((resolve, reject) => {
    enc.on("error", reject);
    enc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg маски: ${encErr.slice(-300)}`))));
  });
  const frameBytes = w * h * 3;
  let buf = Buffer.alloc(0);
  let prev = null;
  let n = 0;
  try {
    for await (const chunk of dec.stdout) {
      if (signal && signal.aborted) throw new Error("Удаление фона остановлено.");
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= frameBytes) {
        const frame = buf.subarray(0, frameBytes);
        buf = buf.subarray(frameBytes);
        let mask = await maskFrame(m, frame, w, h);
        // Сглаживание по времени: край объекта не мерцает от кадра к кадру.
        if (prev) {
          const mixed = new Uint8Array(mask.length);
          for (let i = 0; i < mask.length; i++) mixed[i] = (mask[i] * 0.65 + prev[i] * 0.35) | 0;
          mask = mixed;
        }
        prev = mask;
        if (!enc.stdin.write(Buffer.from(mask.buffer, mask.byteOffset, mask.length))) await new Promise((r) => enc.stdin.once("drain", r));
        n++;
        onProgress && onProgress({ stage: "mask", progress: Math.min(0.99, n / total) });
      }
    }
    enc.stdin.end();
    await encDone;
    await fs.rename(tmp, out);
    return { path: out, frames: n, width: w, height: h, fps };
  } catch (e) {
    dec.kill("SIGKILL");
    enc.kill("SIGKILL");
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/**
 * Готовый вид для предпросмотра (540p): слой — WebM с прозрачностью (VP9 +
 * альфа, её показывает и окно), главное видео — MP4 с заменённым фоном.
 */
async function previewFile({ bin, src, from = 0, dur = 0, image = false, mask, out, replace = "transparent", color = "#00FF00", bgImage = "", soft = 0.5 }) {
  const blur = Math.max(0.5, soft * 3);
  const inArgs = image ? ["-loop", "1", "-t", String(Math.max(1, dur)), "-i", src] : ["-ss", String(from), "-t", String(dur), "-i", src];
  const maskArgs = image ? ["-loop", "1", "-t", String(Math.max(1, dur)), "-i", mask] : ["-i", mask];
  const fg = `[0:v]scale=-2:540,setsar=1,format=rgba[fg0];[1:v]format=gray[mk0];[mk0][fg0]scale2ref[mk][fg];[mk]gblur=sigma=${blur}[mkb];[fg][mkb]alphamerge[fga]`;
  let graph;
  let codec;
  if (replace === "transparent") {
    graph = `${fg};[fga]format=yuva420p[o]`;
    codec = ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "2M", "-deadline", "realtime", "-cpu-used", "8", "-auto-alt-ref", "0"];
  } else {
    const bg =
      replace === "blur"
        ? `[0:v]scale=-2:540,setsar=1,boxblur=24:3[bg]`
        : replace === "image" && bgImage
          ? `[2:v]scale=-2:540,setsar=1[bgi];[bgi][fga]scale2ref[bg][fga2]`
          : `color=c=0x${String(color).slice(1)}:s=16x16[bgc];[bgc][fga]scale2ref[bg][fga2]`;
    const top = replace === "blur" ? "[fga]" : "[fga2]";
    graph = `${fg};${bg};[bg]${top}overlay=format=auto,format=yuv420p[o]`;
    codec = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p"];
  }
  const extra = replace === "image" && bgImage ? ["-loop", "1", "-i", bgImage] : [];
  await run(bin, ["-y", "-hide_banner", "-loglevel", "error", ...inArgs, ...maskArgs, ...extra, "-filter_complex", graph, "-map", "[o]", "-an", ...(image || dur ? ["-t", String(Math.max(1, dur))] : []), ...codec, out]);
  return out;
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

module.exports = { MODELS, QUALITY, maskVideo, previewFile, modelSize, loadModel };
