const fs = require("node:fs/promises");
const path = require("node:path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mediaDir(root, projectId) {
  return projectId ? path.join(root, "projects", projectId, "media") : path.join(root, "media");
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

function pendingFile(root) {
  return path.join(mediaDir(root, undefined), PENDING_FILE);
}

async function listPending(root) {
  const list = await readJson(pendingFile(root), []);
  return Array.isArray(list) ? list : [];
}

async function savePending(root, list) {
  await ensureDir(mediaDir(root, undefined));
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
async function collect(root, { baseUrl, apiKey, id, type = "image", model = "", prompt = "", projectId, recipe = "" }) {
  const res = await fetch(`${baseUrl}/media/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || body?.error || `Ошибка API (${res.status})`);
  if (body.status === "failed") {
    await dropPending(root, id);
    throw new Error(body?.error?.message || body?.error || "Генерация завершилась с ошибкой.");
  }
  if (body.status !== "completed") return { ready: false, status: body.status || "pending" };
  const saved = await download(root, body, { type, model, prompt, projectId, recipe });
  await dropPending(root, id);
  return { ready: true, item: saved };
}

/** Скачать готовое и записать рядом опись — общее для генерации и дозабора. */
async function download(root, result, { type, model, prompt, projectId, recipe = "", input = null }) {
  const mediaUrl = result?.data?.url;
  if (!mediaUrl) throw new Error("Генерация завершена, но ссылка на результат не получена.");
  const fileRes = await fetch(mediaUrl);
  if (!fileRes.ok) throw new Error(`Не удалось скачать результат (${fileRes.status}).`);
  const contentType = fileRes.headers.get("content-type") || "";
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const ext = extFromUrlOrContentType(mediaUrl, contentType);

  const dir = mediaDir(root, projectId);
  await ensureDir(dir);
  const id = result.id || `media_${Date.now()}`;
  const fileName = id.replace(/[^a-zA-Z0-9_-]/g, "") + ext;
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
  await writeJson(path.join(dir, id.replace(/[^a-zA-Z0-9_-]/g, "") + ".json"), record);
  return { ...record, localPath: filePath };
}

async function generate(root, opts) {
  const { baseUrl, apiKey, type, model, prompt, referenceImagePath, extraParamsJson, params, projectId, onStatus, meta } = opts;
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
  if (createBody.status === "completed" && createBody?.data?.url) {
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
    type, model, prompt, projectId, recipe: (meta && meta.recipe) || "", input,
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

async function list(root, projectId) {
  const dir = mediaDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === PENDING_FILE) continue;
    const meta = await readJson(path.join(dir, entry.name), null);
    if (!looksLikeItem(meta)) continue;
    items.push({ ...meta, localPath: path.join(dir, meta.fileName) });
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

module.exports = {
  PENDING_FILE,
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
