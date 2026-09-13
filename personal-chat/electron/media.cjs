const fs = require("node:fs/promises");
const path = require("node:path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Куда класть готовые файлы.
 *
 * По умолчанию — внутрь папки данных приложения. Но картинки и особенно ролики
 * весят много, копятся быстро и никакого отношения к работе приложения не
 * имеют: держать их внутри — значит раздувать то, что человек носит с собой и
 * копирует целиком. Поэтому папку можно назвать свою, на своём диске, и тогда
 * приложение остаётся лёгким, а файлы лежат там, где их и ищут.
 *
 * Привязанные к проекту попадают в подпапку с именем проекта: одна общая свалка
 * из всех проектов — это не «своя папка», а та же куча, только снаружи.
 */
function mediaDir(root, projectId, outDir, projectName) {
  const own = String(outDir || "").trim();
  if (own) {
    return projectId ? path.join(own, safeFolderName(projectName || projectId)) : own;
  }
  return projectId ? path.join(root, "projects", projectId, "media") : path.join(root, "media");
}

/** Имя подпапки из названия проекта: в именах папок можно не всё. */
function safeFolderName(name) {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, 60) || "проект";
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Сколько ждать результата.
 *
 * Прежние две минуты на картинку — цифра из времён, когда картинку рисовали
 * за двадцать секунд. Модели, которые перед рисованием ДУМАЮТ (у них тысячи
 * токенов на входе и выходе), укладываются в две минуты не всегда. Ожидание
 * кончалось, приложение говорило «превышено время», а генерация тем временем
 * спокойно доходила до конца — и оплаченный результат пропадал.
 *
 * Поэтому сроки увеличены. Но главное не в них: сам по себе срок ожидания не
 * может быть достаточно большим на все случаи, поэтому заказ ещё и
 * записывается в журнал и забирается потом. Срок — это когда перестать ждать
 * у экрана, а не когда выбросить оплаченное.
 */
const POLL_CONFIG = {
  image: { intervalMs: 3000, maxWaitMs: 900000 },
  audio: { intervalMs: 4000, maxWaitMs: 900000 },
  video: { intervalMs: 8000, maxWaitMs: 1800000 },
};

const MIME_TO_EXT = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/mp4": ".m4a",
};

function extFromUrlOrContentType(url, contentType) {
  const fromUrl = path.extname(new URL(url).pathname);
  if (fromUrl && fromUrl.length <= 5) return fromUrl;
  return MIME_TO_EXT[contentType] || ".bin";
}

/**
 * Где в ответе лежит результат.
 *
 * Раньше приложение искало его ровно в одном месте — `data.url`. У шлюза за
 * одним адресом стоят десятки моделей разных поставщиков, и отвечают они
 * по-разному: кто-то кладёт ссылку в `data.url`, кто-то отдаёт список
 * `data: [{ url }]`, кто-то зовёт поле `output`, `result` или `image_url`, а
 * кто-то не даёт ссылки вовсе и присылает сам файл строкой base64. Заказ при
 * этом честно выполнен, и деньги за него сняты — а приложение говорило
 * «ссылка не получена» и выбрасывало оплаченное. Ровно это и случилось с
 * GPT-5 Image Mini.
 *
 * Поэтому ищем не по известному пути, а по всему ответу: обходим его целиком и
 * берём первое, что похоже на файл. Порядок предпочтения — от самого надёжного
 * признака к самому слабому, иначе в ответе легко схватить ссылку на
 * документацию или на превью вместо самого результата.
 */
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|aac)(\?|#|$)/i;
const MEDIA_KEY = /(^|_)(url|uri|link|file|output|result|image|video|audio|src|asset|download)s?($|_)/i;
// Служебные ссылки, которые в ответах попадаются рядом с результатом и файлом
// не являются: на них уходит скачивание, и вместо картинки на диск ложится
// страница документации.
const NOT_MEDIA = /(^|\/\/)(docs?|help|support|status|www)\.|\/(docs|pricing|terms|privacy|models)(\/|$)/i;

function scoreUrl(key, value) {
  if (NOT_MEDIA.test(value)) return 0;
  if (MEDIA_EXT.test(value)) return 3;
  if (MEDIA_KEY.test(key)) return 2;
  return 0;
}

function resultPayload(result) {
  let best = null;
  const seen = new Set();
  const walk = (value, key) => {
    if (!value || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string") {
      if (/^data:[^;,]+;base64,/.test(value)) {
        const mime = value.slice(5, value.indexOf(";"));
        if (!best || best.score < 4) best = { kind: "base64", data: value.split(",")[1], mime, score: 4 };
        return;
      }
      if (/^https?:\/\//.test(value)) {
        const score = scoreUrl(key, value);
        if (score && (!best || score > best.score)) best = { kind: "url", url: value, score };
        return;
      }
      // Голый base64 без заголовка — так отдаёт часть моделей изображений
      // (поле b64_json). Короткие строки сюда не попадают: это идентификаторы
      // и подписи, а не файл.
      if (/^(b64|base64)/i.test(key) && value.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(value)) {
        if (!best || best.score < 4) best = { kind: "base64", data: value, mime: "", score: 4 };
      }
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(result, "");
  return best;
}

async function pollUntilDone(baseUrl, apiKey, id, type, onTick) {
  const cfg = POLL_CONFIG[type] || POLL_CONFIG.image;
  const start = Date.now();
  while (Date.now() - start < cfg.maxWaitMs) {
    const res = await fetch(`${baseUrl}/media/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || body?.error || `Ошибка API (${res.status})`);
    onTick?.(body.status);
    if (body.status === "completed") return body;
    if (body.status === "failed") throw new Error(body?.error?.message || body?.error || "Генерация завершилась с ошибкой.");
    await sleep(cfg.intervalMs);
  }
  throw new Error("Превышено время ожидания генерации — попробуйте ещё раз позже.");
}

// ---------- журнал незабранных заказов ----------
//
// Заказ, за который сняты деньги, не должен пропадать никогда — ни от того,
// что кончилось ожидание, ни от того, что закрыли окно, ни от того, что
// оборвалась сеть. Поэтому номер заказа записывается на диск СРАЗУ после
// создания, до первого опроса, и снимается только когда файл скачан.

/**
 * Журнал незабранных всегда лежит в папке данных приложения, а не в той, что
 * выбрал человек. Он весит килобайты, зато знает про оплаченные заказы: если
 * положить его на внешний диск и диск отключат, оплаченное перестанет
 * существовать ровно в тот момент, когда оно нужнее всего.
 */
function pendingFile(root) {
  return path.join(root, "media", PENDING_FILE);
}

async function listPending(root) {
  const list = await readJson(pendingFile(root), []);
  return Array.isArray(list) ? list : [];
}

async function savePending(root, list) {
  await ensureDir(path.join(root, "media"));
  await writeJson(pendingFile(root), list);
  return list;
}

async function addPending(root, record) {
  const list = await listPending(root);
  if (!list.some((x) => x.id === record.id)) list.push(record);
  return savePending(root, list);
}

async function dropPending(root, id) {
  const list = await listPending(root);
  return savePending(root, list.filter((x) => x.id !== id));
}

/**
 * Готовый результат по номеру заказа: скачать и положить рядом с остальными.
 *
 * Тот же путь, что и в обычной генерации, только без создания заказа — он уже
 * создан и оплачен. Если заказ ещё не готов, возвращается его состояние, а не
 * ошибка: ждать дальше — нормальное положение дел, а не сбой.
 */
async function collect(root, { baseUrl, apiKey, id, type = "image", model = "", prompt = "", projectId, recipe = "", outDir = "", projectName = "" }) {
  const res = await fetch(`${baseUrl}/media/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `Ошибка API (${res.status})`);
  if (body.status === "failed") {
    await dropPending(root, id);
    throw new Error(body?.error?.message || body?.error || "Генерация завершилась с ошибкой.");
  }
  if (body.status !== "completed") return { ready: false, status: body.status || "pending" };
  const saved = await download(root, body, { type, model, prompt, projectId, recipe, outDir, projectName });
  await dropPending(root, id);
  return { ready: true, item: saved };
}

/** Скачать готовое и записать рядом опись — общее для генерации и дозабора. */
async function download(root, result, { type, model, prompt, projectId, recipe = "", input = null, outDir = "", projectName = "" }) {
  const dir = mediaDir(root, projectId, outDir, projectName);
  await ensureDir(dir);
  const id = result.id || `media_${Date.now()}`;
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");

  const found = resultPayload(result);
  if (!found) {
    // Ответ есть, заказ выполнен, а файла в нём не нашлось. Это не повод
    // выбросить ответ: он единственное, по чему можно понять, как эта модель
    // отдаёт результат. Кладём его рядом целиком и называем файл в сообщении —
    // иначе разбираться не с чем, а деньги уже сняты.
    const dump = path.join(dir, `ответ-${safeId}.json`);
    await writeJson(dump, result);
    throw new Error(
      "Заказ выполнен, но файла в ответе модели не нашлось. Ответ целиком сохранён рядом с генерациями: " +
        `${dump}. Заказ остался в «Незабранных» — ничего не потеряно.`
    );
  }

  let buffer;
  let ext;
  if (found.kind === "base64") {
    buffer = Buffer.from(found.data.replace(/\s+/g, ""), "base64");
    ext = MIME_TO_EXT[found.mime] || (type === "video" ? ".mp4" : type === "audio" ? ".mp3" : ".png");
  } else {
    const fileRes = await fetch(found.url);
    if (!fileRes.ok) throw new Error(`Не удалось скачать результат (${fileRes.status}).`);
    const contentType = fileRes.headers.get("content-type") || "";
    buffer = Buffer.from(await fileRes.arrayBuffer());
    ext = extFromUrlOrContentType(found.url, contentType);
  }
  const fileName = safeId + ext;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, buffer);

  const record = {
    id,
    type,
    model: String(model || "").trim(),
    prompt: String(prompt || "").trim(),
    fileName,
    createdAt: Date.now(),
    costRub: result?.usage?.cost_rub,
    recipe,
    params:
      input && Object.keys(input).filter((k) => k !== "prompt" && k !== "images").length
        ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== "prompt" && k !== "images"))
        : undefined,
  };
  await writeJson(path.join(dir, safeId + ".json"), record);
  return { ...record, localPath: filePath };
}

async function generate(root, opts) {
  const { baseUrl, apiKey, type, model, prompt, referenceImagePath, extraParamsJson, params, projectId, onStatus, meta } = opts;
  const outDir = String(opts.outDir || "").trim();
  const projectName = opts.projectName || "";
  if (!apiKey) throw new Error("Не задан API-ключ Polza.ai — откройте Настройки.");
  // Ключ уезжает в заголовок, а заголовки принимают только латиницу. Без этой
  // проверки лишний русский символ в ключе даёт сообщение вида «Cannot convert
  // argument to a ByteString», по которому понять ничего нельзя.
  if (/[^\x20-\x7E]/.test(apiKey)) {
    throw new Error(
      "В ключе Polza.ai есть посторонние символы — похоже, он скопирован с лишним куском текста. " +
        "Откройте Настройки и вставьте ключ заново."
    );
  }
  if (!model?.trim()) throw new Error("Укажите ID модели.");
  if (!prompt?.trim()) throw new Error("Укажите промпт.");

  const input = { prompt: prompt.trim() };
  // Поля из формы ложатся первыми, а рукописный JSON — поверх них: если
  // человек написал параметр руками, он знает про эту модель больше, чем
  // общий список полей, и его слово должно быть последним.
  if (params && typeof params === "object") Object.assign(input, params);
  if (extraParamsJson?.trim()) {
    let extra;
    try {
      extra = JSON.parse(extraParamsJson);
    } catch {
      throw new Error("Дополнительные параметры — некорректный JSON.");
    }
    Object.assign(input, extra);
  }
  // Картинок-референсов может быть сколько угодно: работа устроена так, что
  // про каждую говорят своё — «ракурс отсюда, плашку отсюда». Порядок важен:
  // он совпадает с номерами, которые подставлены в промпт вместо обращений.
  const pictures = [];
  if (Array.isArray(opts.referenceImages)) pictures.push(...opts.referenceImages.filter(Boolean));
  else if (referenceImagePath) pictures.push(referenceImagePath);
  if (pictures.length) {
    input.images = [];
    for (const file of pictures) {
      const buffer = await fs.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const mime =
        ext === ".png" ? "image/png"
          : ext === ".webp" ? "image/webp"
            : ext === ".gif" ? "image/gif"
              : "image/jpeg";
      input.images.push({ type: "base64", data: `data:${mime};base64,${buffer.toString("base64")}` });
    }
  }

  // Папку проверяем ДО заказа. Внешний диск отключают, папку переименовывают —
  // и тогда заказ оплачен, а класть результат некуда. Дешевле упереться в это
  // до списания денег, чем после.
  if (outDir) {
    try {
      await ensureDir(mediaDir(root, projectId, outDir, projectName));
    } catch (e) {
      throw new Error(
        `Папка для готовых файлов недоступна: ${outDir}. ` +
          "Проверьте, на месте ли диск и та ли это папка — заказ не отправлен, деньги не списаны. " +
          `(${e && e.message})`
      );
    }
  }

  const createRes = await fetch(`${baseUrl}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model.trim(), input, async: true }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(createBody?.error?.message || createBody?.error || `Ошибка API (${createRes.status})`);
  }

  // Заказ создан — значит деньги уже могут быть списаны. Записываем его на
  // диск ДО первого опроса: дальше что угодно может оборваться, а забрать
  // оплаченное человек должен в любом случае.
  await addPending(root, {
    id: createBody.id,
    type,
    model: model.trim(),
    prompt: prompt.trim(),
    projectId: projectId || "",
    recipe: (meta && meta.recipe) || "",
    createdAt: Date.now(),
  });

  onStatus?.("pending");

  // Иногда ответ приходит готовым сразу — тогда опрашивать нечего.
  let result;
  if (createBody.status === "completed" && resultPayload(createBody)) {
    result = createBody;
  } else {
    try {
      result = await pollUntilDone(baseUrl, apiKey, createBody.id, type, onStatus);
    } catch (e) {
      // Ожидание кончилось — но заказ остаётся в журнале, и его можно забрать
      // позже. Сообщение обязано это сказать: иначе выглядит как потерянные
      // деньги, а деньги не потеряны.
      const problem = e instanceof Error ? e : new Error(String(e));
      problem.pendingId = createBody.id;
      if (/Превышено время/.test(problem.message)) {
        problem.message =
          "Ждать у экрана дольше нечего, но заказ не пропал: он оплачен и записан. " +
          "Заберите его в «Незабранных» ниже — кнопкой «Забрать» (обычно через минуту-другую).";
      }
      throw problem;
    }
  }
  // Из чего собран промпт — в опись рядом с файлом: через неделю по одному
  // тексту уже не вспомнить, что выбиралось, а повторить удачный кадр хочется
  // именно тогда.
  const saved = await download(root, result, {
    type, model, prompt, projectId, recipe: (meta && meta.recipe) || "", input, outDir, projectName,
  });
  await dropPending(root, saved.id);
  return saved;
}

/** Имя журнала незабранных — он лежит в той же папке, но записью не является. */
const PENDING_FILE = "незабранные.json";

/**
 * Похоже ли на опись сгенерированного.
 *
 * Проверяется не имя, а вид: в папке рядом лежат служебные файлы, и любой из
 * них, попав в список как «генерация», ломает раздел на пустом месте. Запись
 * обязана знать, в каком файле лежит результат.
 */
function looksLikeItem(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && typeof value.fileName === "string";
}

/** Расширения, по которым файл в папке считается результатом генерации. */
const RESULT_EXT = /\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|mkv|mp3|wav|ogg|m4a|flac|aac)$/i;

/**
 * Что лежит в папке генераций.
 *
 * Раньше список строился только по описям: json есть — запись есть, json нет —
 * записи нет. Опись маленькая и служебная, а файл — то, ради чего всё делалось,
 * и вешать видимость файла на судьбу служебного json неправильно. Опись может
 * не записаться, её могут удалить при уборке, файл могут принести в папку
 * руками из личного кабинета — и результат пропадал из истории, продолжая
 * лежать на диске.
 *
 * Поэтому идём от ФАЙЛОВ. Опись, если она есть, добавляет к файлу промпт,
 * модель и стоимость; если её нет, запись всё равно показывается — с тем, что
 * можно узнать из самого файла. Видеть файл без подписи лучше, чем не видеть
 * файл.
 */
async function list(root, projectId, outDir, projectName) {
  const dir = mediaDir(root, projectId, outDir, projectName);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((e) => e.isFile() && RESULT_EXT.test(e.name));
  const metaByBase = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === PENDING_FILE) continue;
    const meta = await readJson(path.join(dir, entry.name), null);
    if (looksLikeItem(meta)) metaByBase.set(meta.fileName, meta);
  }

  const items = [];
  for (const entry of files) {
    const meta = metaByBase.get(entry.name);
    if (meta) {
      items.push({ ...meta, localPath: path.join(dir, meta.fileName) });
      continue;
    }
    // Файл без описи: время берём из самого файла, тип — из расширения.
    const full = path.join(dir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    items.push({
      id: entry.name.replace(/\.[^.]+$/, ""),
      type: typeByExt(entry.name),
      model: "",
      prompt: "",
      fileName: entry.name,
      createdAt: stat ? Math.round(stat.mtimeMs) : 0,
      localPath: full,
      // Чтобы в истории было видно: это файл, про который приложение знает
      // только то, что он лежит в папке.
      orphan: true,
    });
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

function typeByExt(name) {
  const ext = path.extname(name).toLowerCase();
  if (/\.(mp4|mov|webm|mkv)$/i.test(ext)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(ext)) return "audio";
  return "image";
}

/**
 * Перенести уже накопленное в свою папку.
 *
 * Без этого выбор папки решает задачу только наполовину: новые файлы уйдут
 * наружу, а всё, что успело накопиться внутри, так и останется весом
 * приложения. Переносим файл вместе с его описью — порознь они бесполезны:
 * файл без описи выпадает из истории, опись без файла ломает её.
 *
 * Перенос идёт копированием с последующим удалением, а не переименованием:
 * своя папка обычно на другом диске, а туда `rename` не умеет. Если файл с
 * таким именем на месте уже есть, он не трогается — повторный перенос не
 * должен затирать то, что уже перенесено.
 */
async function move(root, projectId, outDir, projectName) {
  const from = mediaDir(root, projectId);
  const to = mediaDir(root, projectId, outDir, projectName);
  if (!String(outDir || "").trim()) throw new Error("Не выбрана папка, куда переносить.");
  if (path.resolve(from) === path.resolve(to)) return { moved: 0, kept: 0 };
  await ensureDir(to);
  const items = await list(root, projectId);
  let moved = 0;
  let kept = 0;
  for (const item of items) {
    const meta = path.join(from, item.id.replace(/[^a-zA-Z0-9_-]/g, "") + ".json");
    const pair = [item.localPath, meta];
    if (pair.every((f) => existsAt(path.join(to, path.basename(f))))) {
      kept += 1;
      continue;
    }
    for (const file of pair) {
      const target = path.join(to, path.basename(file));
      try {
        await fs.copyFile(file, target);
        await fs.rm(file, { force: true });
      } catch {
        // Файла может не быть вовсе (опись пережила файл) — это не повод
        // обрывать перенос остальных.
      }
    }
    moved += 1;
  }
  return { moved, kept };
}

function existsAt(file) {
  try {
    require("node:fs").accessSync(file);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  PENDING_FILE,
  safeFolderName,
  move,
  resultPayload,
  looksLikeItem,
  generate,
  collect,
  download,
  list,
  listPending,
  addPending,
  dropPending,
  pendingFile,
  mediaDir,
  ensureDir,
  POLL_CONFIG,
};
