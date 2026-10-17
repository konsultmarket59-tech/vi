// Аватар: вы говорите новый текст своим голосом и своим лицом.
//
// Как это устроено и чего ждать честно.
//
// «Сто процентов как я» не делает никто, включая HeyGen: и голос, и губы
// синтезируются. Насколько похоже — решает исходник: чистый звук без музыки,
// лицо в кадре прямо, рот не закрыт рукой и микрофоном. Приложение помогает
// именно в этом — само вырезает из вашего видео речь без пауз и шума для
// голоса, а для губ берёт сам ролик.
//
// Пути два:
//
// 1. «Своё видео» — ElevenLabs клонирует голос по вашей речи и озвучивает новый
//    текст, затем модель синхронизации губ (sync.so через fal.ai) переделывает
//    рот в вашем же видео под новую озвучку. Лицо, свет, одежда, фон — ваши
//    настоящие, меняется только рот. Это самый похожий на вас результат.
//
// 2. «HeyGen» — если у вас уже сделан цифровой двойник в HeyGen (Instant
//    Avatar) и клон голоса там же: приложение отправляет текст и забирает
//    готовый ролик. Двойника HeyGen создаёт сам, в своём кабинете.
//
// Материал уходит на чужие серверы — это решение человека, приложение само на
// этот путь не переключается.

const fs = require("node:fs/promises");
const path = require("node:path");

const ELEVEN = "https://api.elevenlabs.io/v1";
const FAL_QUEUE = "https://queue.fal.run";
const FAL_STORAGE = "https://rest.alpha.fal.ai/storage/upload/initiate";
const HEYGEN = "https://api.heygen.com";

const LIPSYNC_MODELS = [
  { id: "fal-ai/sync-lipsync/v2", name: "sync.so lipsync-2 — лучший рот, дороже" },
  { id: "fal-ai/sync-lipsync", name: "sync.so lipsync-1.9 — быстрее и дешевле" },
  { id: "fal-ai/latentsync", name: "LatentSync — открытая модель, дёшево" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function redact(text, ...secrets) {
  let out = String(text || "");
  for (const s of secrets) if (s) out = out.split(s).join("[ключ]");
  return out;
}

async function expectOk(res, what, ...secrets) {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  const hint =
    res.status === 401 || res.status === 403
      ? " Ключ не принят — проверьте его в настройках аватара."
      : res.status === 402 || /quota|credit|balance/i.test(body)
        ? " Похоже, на счёте сервиса закончились деньги."
        : "";
  throw new Error(`${what}: сервис ответил ${res.status}.${hint} ${redact(body, ...secrets).slice(0, 400)}`);
}

/**
 * Образец голоса из видео: только речь, без пауз, с выровненной громкостью.
 *
 * Клону голоса нужна речь, а не запись: паузы и шум он тоже «выучит». Минута
 * чистой речи даёт заметно больше похожести, чем пять минут с тишиной.
 */
function voiceSampleArgs(src, dest, { maxSeconds = 120 } = {}) {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", src, "-vn",
    "-af",
    "highpass=f=70,afftdn=nf=-25," +
      "silenceremove=start_periods=1:start_threshold=-40dB:stop_periods=-1:stop_duration=0.4:stop_threshold=-40dB," +
      "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-t", String(maxSeconds),
    "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k",
    dest,
  ];
}

/** Клон голоса в ElevenLabs (Instant Voice Clone). */
async function cloneVoice({ apiKey, name, samplePaths, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Нужен ключ ElevenLabs — он в настройках аватара.");
  const form = new FormData();
  form.append("name", name || "Мой голос");
  form.append("remove_background_noise", "true");
  form.append("description", "Клон голоса из «Личного чата» — раздел «Монтаж».");
  for (const p of samplePaths) {
    const data = await fs.readFile(p);
    form.append("files", new Blob([data], { type: "audio/mpeg" }), path.basename(p));
  }
  const res = await fetchImpl(`${ELEVEN}/voices/add`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  await expectOk(res, "Клон голоса", apiKey);
  const body = await res.json();
  if (!body.voice_id) throw new Error("ElevenLabs не вернул номер голоса.");
  return body.voice_id;
}

/**
 * Озвучка текста клонированным голосом.
 * Настройки сдвинуты к похожести: similarity выше, стабильность средняя —
 * совсем стабильный голос звучит ровно и мёртво, а не как вы.
 */
async function synthesize({ apiKey, voiceId, text, dest, modelId = "eleven_multilingual_v2", speed = 1, fetchImpl = fetch }) {
  if (!text || !text.trim()) throw new Error("Нет текста для озвучки.");
  const res = await fetchImpl(`${ELEVEN}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.45, similarity_boost: 0.9, style: 0.15, use_speaker_boost: true, speed },
    }),
  });
  await expectOk(res, "Озвучка", apiKey);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** Файл в хранилище fal.ai: модели принимают ссылку, а не байты. */
async function falUpload({ apiKey, filePath, contentType, fetchImpl = fetch }) {
  const init = await fetchImpl(`${FAL_STORAGE}?storage_type=fal-cdn-v3`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType, file_name: path.basename(filePath) }),
  });
  await expectOk(init, "Загрузка файла на fal.ai", apiKey);
  const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
  if (!uploadUrl || !fileUrl) throw new Error("fal.ai не выдал адрес для загрузки.");
  const put = await fetchImpl(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: await fs.readFile(filePath) });
  await expectOk(put, "Загрузка файла на fal.ai");
  return fileUrl;
}

/** Задача в очереди fal.ai: отправить, дождаться, забрать ответ. */
async function falRun({ apiKey, model, input, onStatus, timeoutMs = 30 * 60 * 1000, pollMs = 4000, fetchImpl = fetch }) {
  const headers = { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" };
  const submit = await fetchImpl(`${FAL_QUEUE}/${model}`, { method: "POST", headers, body: JSON.stringify(input) });
  await expectOk(submit, "Синхронизация губ", apiKey);
  const queued = await submit.json();
  const statusUrl = queued.status_url;
  const responseUrl = queued.response_url;
  if (!statusUrl || !responseUrl) throw new Error("fal.ai не принял задачу.");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("Синхронизация губ идёт дольше получаса — задача брошена. Попробуйте ролик короче.");
    await sleep(pollMs);
    const st = await fetchImpl(statusUrl, { headers });
    await expectOk(st, "Статус синхронизации", apiKey);
    const body = await st.json();
    if (onStatus) onStatus(body.status, body.queue_position);
    if (body.status === "COMPLETED") break;
    if (body.status === "FAILED" || body.status === "ERROR" || body.status === "CANCELLED") {
      throw new Error(`Синхронизация губ не удалась: ${redact(JSON.stringify(body.error || body), apiKey).slice(0, 300)}`);
    }
  }
  const res = await fetchImpl(responseUrl, { headers });
  await expectOk(res, "Результат синхронизации", apiKey);
  return res.json();
}

async function download(url, dest, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  await expectOk(res, "Скачивание результата");
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * Ваше видео + новая озвучка → видео, где вы говорите новый текст.
 *
 * Видео короче озвучки — модель гоняет его вперёд-назад («bounce»): так
 * незаметнее, чем прыжок в начало. Поэтому лучше всего работает исходник,
 * где вы смотрите в камеру и почти не двигаетесь, а не прогулка по улице.
 */
async function lipsync({ apiKey, videoPath, audioPath, model = LIPSYNC_MODELS[0].id, onStatus, fetchImpl = fetch }) {
  const videoUrl = await falUpload({ apiKey, filePath: videoPath, contentType: "video/mp4", fetchImpl });
  const audioUrl = await falUpload({ apiKey, filePath: audioPath, contentType: "audio/mpeg", fetchImpl });
  const input =
    model === "fal-ai/latentsync"
      ? { video_url: videoUrl, audio_url: audioUrl, loop_mode: "pingpong" }
      : { video_url: videoUrl, audio_url: audioUrl, sync_mode: "bounce" };
  const result = await falRun({ apiKey, model, input, onStatus, fetchImpl });
  const url = result?.video?.url || result?.output?.url || result?.video_url;
  if (!url) throw new Error("Синхронизация закончилась, но ссылки на видео в ответе нет.");
  return url;
}

// ---------- HeyGen ----------

async function heygenAvatars({ apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(`${HEYGEN}/v2/avatars`, { headers: { "X-Api-Key": apiKey } });
  await expectOk(res, "Список аватаров HeyGen", apiKey);
  const body = await res.json();
  const avatars = (body?.data?.avatars || []).map((a) => ({ id: a.avatar_id, name: a.avatar_name || a.avatar_id, preview: a.preview_image_url || "" }));
  const talking = (body?.data?.talking_photos || []).map((a) => ({ id: a.talking_photo_id, name: a.talking_photo_name || a.talking_photo_id, preview: a.preview_image_url || "", photo: true }));
  return [...avatars, ...talking];
}

async function heygenVoices({ apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl(`${HEYGEN}/v2/voices`, { headers: { "X-Api-Key": apiKey } });
  await expectOk(res, "Список голосов HeyGen", apiKey);
  const body = await res.json();
  return (body?.data?.voices || []).map((v) => ({ id: v.voice_id, name: v.name || v.voice_id, language: v.language || "" }));
}

/** Ролик цифрового двойника HeyGen по тексту. */
async function heygenGenerate({ apiKey, avatarId, photo = false, voiceId, text, width = 1080, height = 1920, onStatus, pollMs = 8000, timeoutMs = 45 * 60 * 1000, fetchImpl = fetch }) {
  const character = photo ? { type: "talking_photo", talking_photo_id: avatarId } : { type: "avatar", avatar_id: avatarId, avatar_style: "normal" };
  const res = await fetchImpl(`${HEYGEN}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [{ character, voice: { type: "text", input_text: text, voice_id: voiceId } }],
      dimension: { width, height },
    }),
  });
  await expectOk(res, "Ролик HeyGen", apiKey);
  const body = await res.json();
  const videoId = body?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen не принял задачу: ${redact(JSON.stringify(body.error || body), apiKey).slice(0, 300)}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("HeyGen делает ролик дольше 45 минут — проверьте его в кабинете HeyGen.");
    await sleep(pollMs);
    const st = await fetchImpl(`${HEYGEN}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, { headers: { "X-Api-Key": apiKey } });
    await expectOk(st, "Статус ролика HeyGen", apiKey);
    const data = (await st.json())?.data || {};
    if (onStatus) onStatus(data.status);
    if (data.status === "completed" && data.video_url) return data.video_url;
    if (data.status === "failed") throw new Error(`HeyGen не смог сделать ролик: ${JSON.stringify(data.error || "").slice(0, 300)}`);
  }
}

module.exports = {
  LIPSYNC_MODELS,
  voiceSampleArgs,
  cloneVoice,
  synthesize,
  falUpload,
  falRun,
  lipsync,
  download,
  heygenAvatars,
  heygenVoices,
  heygenGenerate,
};
