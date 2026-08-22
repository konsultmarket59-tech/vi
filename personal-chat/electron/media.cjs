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

const POLL_CONFIG = {
  image: { intervalMs: 3000, maxWaitMs: 120000 },
  audio: { intervalMs: 4000, maxWaitMs: 180000 },
  video: { intervalMs: 8000, maxWaitMs: 600000 },
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

async function generate(root, opts) {
  const { baseUrl, apiKey, type, model, prompt, referenceImagePath, extraParamsJson, projectId, onStatus } = opts;
  if (!apiKey) throw new Error("Не задан API-ключ Polza.ai — откройте Настройки.");
  if (!model?.trim()) throw new Error("Укажите ID модели.");
  if (!prompt?.trim()) throw new Error("Укажите промпт.");

  const input = { prompt: prompt.trim() };
  if (extraParamsJson?.trim()) {
    let extra;
    try {
      extra = JSON.parse(extraParamsJson);
    } catch {
      throw new Error("Дополнительные параметры — некорректный JSON.");
    }
    Object.assign(input, extra);
  }
  if (referenceImagePath) {
    const buffer = await fs.readFile(referenceImagePath);
    const ext = path.extname(referenceImagePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    input.images = [{ type: "base64", data: `data:${mime};base64,${buffer.toString("base64")}` }];
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

  onStatus?.("pending");
  const result = await pollUntilDone(baseUrl, apiKey, createBody.id, type, onStatus);
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

  const meta = {
    id,
    type,
    model: model.trim(),
    prompt: prompt.trim(),
    fileName,
    createdAt: Date.now(),
    costRub: result?.usage?.cost_rub,
  };
  await writeJson(path.join(dir, id.replace(/[^a-zA-Z0-9_-]/g, "") + ".json"), meta);

  return { ...meta, localPath: filePath };
}

async function list(root, projectId) {
  const dir = mediaDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const meta = await readJson(path.join(dir, entry.name), null);
    if (!meta) continue;
    items.push({ ...meta, localPath: path.join(dir, meta.fileName) });
  }
  items.sort((a, b) => b.createdAt - a.createdAt);
  return items;
}

module.exports = { generate, list, mediaDir, ensureDir };
