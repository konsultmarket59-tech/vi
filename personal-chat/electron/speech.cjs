// Расшифровка речи на этом компьютере — без сторонних программ.
//
// Почему так.
//
// Первый вариант раздела требовал поставить whisper.cpp и скачать файл модели
// руками. Для человека, которому нужно расшифровать запись, это не «бесплатно»,
// а «невозможно»: он открывает раздел и упирается в требование установить
// программу, о которой впервые слышит.
//
// Здесь распознавание встроено в приложение. Работает оно на onnxruntime —
// он приезжает вместе с приложением обычной зависимостью, собран под N-API и
// потому запускается под Electron без пересборки. Ставить и настраивать нечего.
//
// Скачивается ровно одно: веса модели, один раз, самим приложением, с полосой
// прогресса. Дальше они лежат на диске, и расшифровка идёт без сети совсем —
// материал компьютер не покидает.
//
// ЧЕСТНАЯ ОГОВОРКА ПРО КАЧЕСТВО. Модель, которая помещается в такой обиход,
// слышит хуже платного сервиса: путает имена, названия и числа. Это не повод от
// неё отказываться — ровно на этот случай в разделе есть второй шаг, где
// сильная языковая модель читает расшифровку и правит расслышанное. Дёшево
// услышать и умно прочитать — вместе выходит лучше, чем каждое по отдельности.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

/**
 * Модели распознавания.
 *
 * Размер здесь — не мелочь, а главное свойство выбора: он определяет и время
 * скачивания, и скорость работы, и то, сколько слов придётся править потом.
 * Цифры — размер квантованных весов, которые реально качаются.
 */
const SPEECH_MODELS = [
  {
    id: "onnx-community/whisper-tiny",
    name: "Быстрая",
    size: "~45 МБ",
    hint: "Скачивается за минуту и работает быстрее всех. Слышит грубо: годится, чтобы найти нужное место в записи, а не чтобы читать.",
  },
  {
    id: "onnx-community/whisper-base",
    name: "Обычная",
    size: "~80 МБ",
    hint: "Разумная середина и выбор по умолчанию. Разбирает русскую речь связно, имена и числа приходится править.",
  },
  {
    id: "onnx-community/whisper-small",
    name: "Точная",
    size: "~250 МБ",
    hint: "Слышит заметно лучше, работает примерно втрое дольше. Для записей, которые потом цитируют.",
  },
];

const DEFAULT_MODEL = "onnx-community/whisper-base";

/**
 * Звук из wav в тот вид, которого ждёт модель: дробные числа от −1 до 1.
 *
 * Заголовок разбирается по кускам, а не отсчётом «44 байта от начала»: ffmpeg
 * кладёт перед данными служебный кусок LIST с названием программы, и жёсткое
 * смещение съедало бы начало записи вместе с первыми словами.
 */
function wavToFloat32(buffer, { from = 0, count = Infinity } = {}) {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Это не wav — звук не удалось прочитать.");
  }
  let offset = 12;
  let dataStart = -1;
  let dataLength = 0;
  let channels = 1;
  let rate = 16000;
  let bits = 16;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      rate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, buffer.length - body);
      break;
    }
    // Куски выравниваются по чётной границе — нечётный размер дополняется байтом.
    offset = body + size + (size % 2);
  }
  if (dataStart < 0) throw new Error("В wav нет звуковых данных.");
  if (bits !== 16) throw new Error(`Ожидались 16 бит на отсчёт, а в файле ${bits}.`);

  const totalSamples = Math.floor(dataLength / 2 / channels);
  const start = Math.max(0, Math.min(totalSamples, Math.floor(from)));
  const end = Math.max(start, Math.min(totalSamples, start + Math.floor(count)));
  const out = new Float32Array(end - start);
  for (let i = 0; i < out.length; i++) {
    // Несколько каналов сводятся в один усреднением: модель слушает моно, а
    // выбросить второй канал значило бы потерять то, что сказано только в нём.
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buffer.readInt16LE(dataStart + ((start + i) * channels + c) * 2);
    }
    out[i] = sum / channels / 32768;
  }
  return { audio: out, rate, channels, totalSamples };
}

/** Сколько всего отсчётов в wav — чтобы считать окна, не читая файл целиком. */
function wavInfo(buffer) {
  const { rate, channels, totalSamples } = wavToFloat32(buffer, { from: 0, count: 0 });
  return { rate, channels, totalSamples, seconds: totalSamples / (rate || 16000) };
}

/**
 * Окна, на которые режется длинная запись.
 *
 * Шестичасовая запись в виде дробных чисел — это гигабайт с лишним в памяти;
 * попытка обработать её целиком кончается не ошибкой, а падением приложения.
 * Поэтому звук идёт окнами, а времена внутри окна сдвигаются на его начало.
 *
 * Перехлёст нужен ровно затем же, зачем в кусках расшифровки: фраза, сказанная
 * на стыке окон, без него пропадает целиком — её не слышит ни одно окно.
 */
function planWindows(totalSamples, rate, { windowSeconds = 600, overlapSeconds = 2 } = {}) {
  const size = Math.max(1, Math.round(windowSeconds * rate));
  const overlap = Math.max(0, Math.round(overlapSeconds * rate));
  const windows = [];
  let from = 0;
  while (from < totalSamples) {
    const count = Math.min(size, totalSamples - from);
    windows.push({ from, count, offsetSeconds: from / rate });
    if (from + count >= totalSamples) break;
    from += Math.max(1, count - overlap);
  }
  return windows;
}

/**
 * Ответ модели — в наши отрезки со временем.
 *
 * Модель иногда отдаёт незакрытое время у последнего куска (`[12.4, null]`) —
 * это не ошибка, а признак того, что кусок упёрся в край окна. Такой отрезок
 * закрывается концом окна, а не выбрасывается: в нём обычно целая фраза.
 */
function toSegments(result, { offsetSeconds = 0, windowSeconds = 0 } = {}) {
  const chunks = Array.isArray(result && result.chunks) ? result.chunks : [];
  const segments = [];
  for (const chunk of chunks) {
    const text = String((chunk && chunk.text) || "").trim();
    if (!text) continue;
    const stamp = Array.isArray(chunk.timestamp) ? chunk.timestamp : [null, null];
    const from = Number.isFinite(stamp[0]) ? stamp[0] : 0;
    const to = Number.isFinite(stamp[1]) ? stamp[1] : Math.max(from, windowSeconds || from);
    segments.push({ from: offsetSeconds + from, to: offsetSeconds + Math.max(to, from), text });
  }
  // Если времени нет вовсе, текст всё равно не теряем: без него ссылка будет
  // указывать на начало окна, и это лучше, чем молча выброшенная речь.
  if (!segments.length) {
    const text = String((result && result.text) || "").trim();
    if (text) segments.push({ from: offsetSeconds, to: offsetSeconds + (windowSeconds || 0), text });
  }
  return segments;
}

/** Отрезки с перехлёстом склеиваются: одна фраза не должна попасть дважды. */
function mergeSegments(all) {
  const sorted = [...all].sort((a, b) => a.from - b.from);
  const out = [];
  for (const seg of sorted) {
    const last = out[out.length - 1];
    // Тот же текст, начавшийся почти там же, — это перехлёст, а не повтор речи.
    if (last && Math.abs(last.from - seg.from) < 1.5 && last.text === seg.text) {
      last.to = Math.max(last.to, seg.to);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

// ---------- сама модель ----------

let cached = null;

/**
 * Готовая к работе модель.
 *
 * Держится в памяти между записями: загрузка занимает секунды, и платить их на
 * каждой записи из папки незачем. При смене модели прежняя отпускается.
 */
async function loadRecognizer({ modelId = DEFAULT_MODEL, cacheDir, onProgress } = {}) {
  if (cached && cached.modelId === modelId && cached.cacheDir === cacheDir) return cached.recognizer;
  const { pipeline, env } = await import("@huggingface/transformers");
  if (cacheDir) {
    await fs.mkdir(cacheDir, { recursive: true });
    env.cacheDir = cacheDir;
  }
  // Местные файлы разрешены: если веса уже лежат рядом, сеть не нужна вовсе.
  env.allowLocalModels = true;
  const recognizer = await pipeline("automatic-speech-recognition", modelId, {
    dtype: "q8",
    progress_callback: (p) => {
      if (!onProgress || !p) return;
      if (p.status === "progress" && p.total) {
        onProgress({ stage: "download", file: p.file || "", loaded: p.loaded || 0, total: p.total });
      } else if (p.status === "ready") onProgress({ stage: "ready" });
    },
  });
  cached = { modelId, cacheDir, recognizer };
  return recognizer;
}

/** Отпустить модель — например, перед сменой на другую. */
function unload() {
  cached = null;
}

/**
 * Расшифровка одного wav целиком: окно за окном.
 *
 * Возвращает те же отрезки, что и прежний путь через whisper.cpp, — всё, что
 * после расшифровки (куски, поиск, метки, ссылки), продолжает работать без
 * единой правки.
 */
async function transcribeFile({
  wavPath,
  modelId = DEFAULT_MODEL,
  cacheDir,
  language = "russian",
  windowSeconds = 600,
  onProgress,
  shouldStop,
} = {}) {
  const buffer = await fs.readFile(wavPath);
  const info = wavInfo(buffer);
  const recognizer = await loadRecognizer({ modelId, cacheDir, onProgress });
  const windows = planWindows(info.totalSamples, info.rate, { windowSeconds });
  const collected = [];
  for (let i = 0; i < windows.length; i++) {
    if (shouldStop && shouldStop()) break;
    const w = windows[i];
    const { audio } = wavToFloat32(buffer, { from: w.from, count: w.count });
    const result = await recognizer(audio, {
      language,
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    collected.push(
      ...toSegments(result, { offsetSeconds: w.offsetSeconds, windowSeconds: w.count / info.rate })
    );
    if (onProgress) {
      onProgress({
        stage: "transcribe",
        progress: (i + 1) / windows.length,
        seconds: Math.round(((i + 1) * w.count) / info.rate),
        total: Math.round(info.seconds),
      });
    }
  }
  return mergeSegments(collected);
}

/** Скачаны ли уже веса: по наличию папки модели в хранилище. */
function isModelReady(cacheDir, modelId) {
  if (!cacheDir || !modelId) return false;
  const dir = path.join(cacheDir, ...String(modelId).split("/"));
  try {
    if (!fsSync.existsSync(dir)) return false;
    // Пустая папка остаётся после сорвавшегося скачивания — это не готовность.
    return fsSync.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** Сколько места занимают скачанные веса — чтобы их можно было осознанно убрать. */
function cacheSize(cacheDir) {
  let bytes = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          bytes += fsSync.statSync(full).size;
        } catch {
          // файл мог исчезнуть между обходом и замером
        }
      }
    }
  };
  if (cacheDir) walk(cacheDir);
  return bytes;
}

module.exports = {
  SPEECH_MODELS,
  DEFAULT_MODEL,
  wavToFloat32,
  wavInfo,
  planWindows,
  toSegments,
  mergeSegments,
  loadRecognizer,
  unload,
  transcribeFile,
  isModelReady,
  cacheSize,
};
