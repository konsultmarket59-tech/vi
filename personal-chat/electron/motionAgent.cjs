// ИИ-моушн целиком: задание модели → код → проверка в браузере → исправление
// → (по желанию) взгляд арт-директора на кадры → готовая композиция.
//
// Человеку остаётся дать дизайн-систему и текст. Всё остальное — какие сцены,
// какой текст на каждой, где логотип, как всё движется — решает модель, а
// программа следит, чтобы код работал и текст не уезжал за край.

const fs = require("node:fs/promises");
const path = require("node:path");
const motion = require("./motion.cjs");
const mr = require("./motionRender.cjs");
const templates = require("./motionTemplates.cjs");
const { EXAMPLE } = require("./motionExample.cjs");
const fonts = require("./fontLibrary.cjs");

/**
 * Запрос к модели с потоком: ролик — это 15–30 тысяч знаков кода, без потока
 * человек минуту смотрит на застывший экран, а шлюз рвёт долгие ответы.
 */
async function streamModel(settings, messages, { onDelta, signal, maxTokens = 32000, usage, model } = {}) {
  if (!settings.apiKey) throw new Error("Не задан API-ключ. Откройте настройки и вставьте ключ.");
  const useModel = model || settings.model;
  if (!useModel) throw new Error("Не задана модель в настройках.");
  const url = String(settings.baseUrl || "").replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: useModel,
      messages,
      temperature: 0.7,
      max_tokens: Math.max(settings.maxTokens || 0, maxTokens),
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ошибка API (${res.status} ${res.statusText}). ${detail.slice(0, 500)}`);
  }
  let text = "";
  let reported = null;
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (delta) {
          text += delta;
          if (onDelta) onDelta(text.length, delta);
        }
        if (j.usage) reported = j.usage;
      } catch {
        // неполная строка служебного события — пропускаем
      }
    }
  }
  if (usage) {
    const prompt = messages.map((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : m.content)).join("\n");
    await usage
      .record(
        reported && (reported.prompt_tokens || reported.completion_tokens)
          ? { model: useModel, promptTokens: reported.prompt_tokens, completionTokens: reported.completion_tokens, cachedTokens: (reported.prompt_tokens_details && reported.prompt_tokens_details.cached_tokens) || 0, exact: true, source: "моушн" }
          : { model: useModel, promptTokens: usage.estimateTokens(prompt), completionTokens: usage.estimateTokens(text), exact: false, source: "моушн" }
      )
      .catch(() => {});
  }
  if (!text.trim()) throw new Error("Модель вернула пустой ответ.");
  return text;
}

/** Картинка для модели: уменьшенная копия JPEG/PNG в data-URI. */
function imageForModel(nativeImage, file, maxSide = 768) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const k = Math.min(1, maxSide / Math.max(width, height));
  const small = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: "good" }) : img;
  const png = /\.png$/i.test(file);
  const data = png ? small.toPNG() : small.toJPEG(85);
  return { uri: `data:image/${png ? "png" : "jpeg"};base64,${data.toString("base64")}`, width, height };
}

function orientation(w, h) {
  if (!w || !h) return "";
  const r = w / h;
  return `${w}×${h}, ${r > 1.2 ? "горизонтальная" : r < 0.83 ? "вертикальная" : "квадратная"}`;
}

/**
 * Картинки ролика: логотипы дизайн-системы и фото человека.
 * Возвращает имена для asset:// и то, что модель увидит глазами.
 */
function collectAssets(nativeImage, theme, photos = []) {
  const files = {};
  const info = {};
  const images = [];
  const add = (name, file, label) => {
    const img = /\.svg$/i.test(file) ? null : imageForModel(nativeImage, file);
    files[name] = file;
    info[name] = { label, size: img ? orientation(img.width, img.height) : "" };
    if (img) images.push({ name, uri: img.uri });
  };
  theme.logos.slice(0, 3).forEach((l, i) => add(i === 0 ? "logo" : `logo${i + 1}`, l.path, `логотип (${l.rel || l.name || path.basename(l.path)})`));
  photos.slice(0, 8).forEach((p, i) => add(`photo${i + 1}`, p, `фото «${path.basename(p)}»`));
  return { files, info, images };
}

function userContent(text, images) {
  if (!images.length) return text;
  return [{ type: "text", text }, ...images.flatMap((im) => [{ type: "text", text: `asset://${im.name}:` }, { type: "image_url", image_url: { url: im.uri } }])];
}

const EXAMPLE_NOTE = `ОБРАЗЕЦ ПРИЁМОВ (рабочий код в нужном контракте; НЕ копируй текст, цвета и раскладку — только технику: сцены-контейнеры, маски строк, каскады, счётчик, склейка на ходу, подсветка прозрачностью):
\`\`\`html
${EXAMPLE}
\`\`\``;

/**
 * Проверить код в браузере: ошибки, пустая шкала, текст за краем.
 */
async function check(ctx, html, { width, height, theme, assets, transparent }) {
  const doc = motion.buildDoc({ html, width, height, theme, assets, transparent });
  const state = await mr.inspect(ctx.BrowserWindow, doc, { width, height, transparent, tmpDir: ctx.tmpDir });
  return { state, problems: motion.describeAudit(state) };
}

/**
 * Довести ответ модели до рабочего кода: до двух кругов исправлений.
 */
async function settle(ctx, messages, reply, o, progress) {
  let html = motion.extractCode(reply);
  if (!html) throw new Error("Модель не прислала код ролика. Попробуйте ещё раз или другую модель.");
  let result = await check(ctx, html, o);
  for (let round = 0; round < 2 && result.problems.length; round++) {
    progress({ stage: "repair", message: `Исправляю: ${result.problems[0]}`, round: round + 1 });
    messages.push({ role: "assistant", content: reply }, { role: "user", content: motion.buildRepairPrompt(result.problems) });
    reply = await streamModel(ctx.settings, messages, { signal: o.signal, usage: ctx.usage, model: o.model, onDelta: (n) => progress({ stage: "repair-write", chars: n }) });
    const fixed = motion.extractCode(reply);
    if (!fixed) break;
    const next = await check(ctx, fixed, o);
    // Исправление не всегда лучше: берём его, только если проблем не прибавилось.
    if (next.problems.length <= result.problems.length || next.state.errors.length < result.state.errors.length) {
      html = fixed;
      result = next;
    }
  }
  return { html, reply, result };
}

/**
 * Новый моушн-ролик по дизайн-системе и тексту.
 * @param {object} ctx {BrowserWindow, nativeImage, settings, usage, tmpDir, ffmpeg}
 * @param {object} o {design, text, brief, photos, width, height, duration, transparent, review, model, signal}
 */
async function generate(ctx, o, onProgress = () => {}) {
  const theme = themeFor(o.design, o.pair || "");
  const { files, info, images } = collectAssets(ctx.nativeImage, theme, o.photos || []);
  const opts = { width: o.width, height: o.height, theme, assets: files, transparent: !!o.transparent, signal: o.signal, model: o.model };
  const prompt = [
    motion.buildMotionPrompt({ width: o.width, height: o.height, duration: o.duration || 20, text: o.text || "", brief: o.brief || "", theme, assets: info, transparent: !!o.transparent }),
    EXAMPLE_NOTE,
  ].join("\n\n");
  const messages = [{ role: "user", content: userContent(prompt, images) }];
  onProgress({ stage: "write", message: "Модель придумывает сцены и пишет ролик…", chars: 0 });
  const first = await streamModel(ctx.settings, messages, { signal: o.signal, usage: ctx.usage, model: o.model, onDelta: (n) => onProgress({ stage: "write", chars: n }) });
  const storyboard = motion.extractStoryboard(first);
  onProgress({ stage: "check", message: "Проверяю ролик в браузере…", storyboard });
  let { html, reply, result } = await settle(ctx, messages, first, opts, onProgress);

  // Взгляд на кадры: модель видит свой ролик так же, как человек, и правит
  // то, чего не видно из кода, — налезания, пустые кадры, слабый контраст.
  if (o.review && ctx.ffmpeg) {
    try {
      onProgress({ stage: "review", message: "Смотрю кадры как арт-директор…" });
      const doc = motion.buildDoc({ html, width: o.width, height: o.height, theme, assets: files, transparent: !!o.transparent, background: "#3a3f4b" });
      const sheet = await mr.contactSheet(ctx.BrowserWindow, doc, { width: o.width, height: o.height, tmpDir: ctx.tmpDir }, { ffmpeg: ctx.ffmpeg, count: 8 });
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content: [
          { type: "text", text: `${motion.buildReviewPrompt()}\nСекунды кадров слева направо, сверху вниз: ${sheet.times.map((t) => t.toFixed(1)).join(", ")}.` },
          { type: "image_url", image_url: { url: `data:image/png;base64,${sheet.png.toString("base64")}` } },
        ],
      });
      const answer = await streamModel(ctx.settings, messages, { signal: o.signal, usage: ctx.usage, model: o.model, onDelta: (n) => onProgress({ stage: "review-write", chars: n }) });
      const better = motion.extractCode(answer);
      if (better) {
        const next = await check(ctx, better, opts);
        if (!next.state.errors.length && next.state.duration > 0.5 && next.problems.length <= result.problems.length) {
          html = better;
          result = next;
        }
      }
    } catch (e) {
      if (o.signal && o.signal.aborted) throw e;
      // просмотр — улучшение, а не условие: без него ролик всё равно готов
    }
  }

  return {
    html,
    duration: result.state.duration,
    storyboard,
    problems: result.problems,
    assets: files,
    pair: theme.pair || "",
  };
}

/** Правка готового ролика словами: «сделай финал длиннее», «логотип крупнее». */
async function edit(ctx, o, onProgress = () => {}) {
  const theme = themeFor(o.design, o.pair || "");
  const files = o.assets || {};
  const info = Object.fromEntries(Object.keys(files).map((k) => [k, { label: k.startsWith("logo") ? "логотип" : "фото" }]));
  const opts = { width: o.width, height: o.height, theme, assets: files, transparent: !!o.transparent, signal: o.signal, model: o.model };
  const prompt = [
    motion.buildMotionPrompt({ width: o.width, height: o.height, duration: o.duration || 20, text: "", brief: "", theme, assets: info, transparent: !!o.transparent }),
    `ТЕКУЩИЙ КОД РОЛИКА\n\`\`\`html\n${o.html}\n\`\`\``,
    motion.buildEditPrompt(o.instruction),
  ].join("\n\n");
  const messages = [{ role: "user", content: prompt }];
  onProgress({ stage: "write", message: "Вношу правку…", chars: 0 });
  const reply = await streamModel(ctx.settings, messages, { signal: o.signal, usage: ctx.usage, model: o.model, onDelta: (n) => onProgress({ stage: "write", chars: n }) });
  onProgress({ stage: "check", message: "Проверяю…" });
  const { html, result } = await settle(ctx, messages, reply, opts, onProgress);
  return { html, duration: result.state.duration, problems: result.problems, assets: files };
}

/**
 * Код и тема моушн-элемента проекта. Заготовка строится заново — так правка
 * полей и смена дизайн-системы сразу видны.
 */
/**
 * Шрифтовая пара поверх темы: основной, акцентный и наборный шрифт.
 * Без пары и без шрифтов в дизайн-системе — нейтральная пара, а не системный
 * Arial: так и заготовки, и ИИ-моушн сразу выглядят свёрстанными.
 */
function applyPair(theme, pairId) {
  const p = pairId ? fonts.pair(pairId) : null;
  if (!p) return theme;
  return { ...theme, heading: { family: p.head.family, path: p.head.path }, body: { family: p.body.family, path: p.body.path }, accent: { family: p.accent.family, path: p.accent.path }, accentScript: p.accent.category === "script" || /italic/i.test(p.accent.family), pair: p.id };
}

function themeFor(design, pairId) {
  const theme = motion.themeFromDesign(design);
  if (pairId === "ds" && theme.heading) return theme;
  return applyPair(theme, pairId && pairId !== "ds" ? pairId : theme.heading ? "" : "minimal");
}

async function resolve(m, readDesignFolder) {
  const design = m.designDir ? await readDesignFolder(m.designDir).catch(() => null) : null;
  const pairId = (m.fields && m.fields.__pair) || (m.template ? templates.defaultPair(m.template) : "") || m.pair || "";
  const theme = themeFor(design, pairId);
  const assets = { ...(m.assets || {}) };
  if (theme.logos[0] && !assets.logo) assets.logo = theme.logos[0].path;
  let html = m.html || "";
  let duration = m.duration;
  if (m.template) {
    const b = templates.build(m.template, m.fields || {}, { ...templates.templateTheme(theme.colours), accentScript: !!theme.accentScript }, assets);
    html = b.html;
    duration = b.duration;
  }
  return { html, theme, assets, duration };
}

/** Документ для предпросмотра (iframe) или рендера. */
async function docFor(m, { width, height, readDesignFolder, preview = false }) {
  const r = await resolve(m, readDesignFolder);
  return { doc: motion.buildDoc({ html: r.html, width, height, theme: r.theme, assets: r.assets, transparent: !!m.transparent, preview }), duration: r.duration };
}

/**
 * Перед сборкой: каждый моушн → файл (кусок — MP4, титр-слой — MOV с
 * прозрачностью). Файлы кэшируются по коду, размеру и частоте кадров: второй
 * экспорт того же проекта не рендерит моушн заново.
 */
async function prerender(ctx, project, { cacheDir, readDesignFolder, onProgress, signal }) {
  const items = [...project.clips.filter((c) => c.kind === "motion").map((c) => ({ item: c, layer: false })), ...project.layers.filter((l) => l.kind === "motion").map((l) => ({ item: l, layer: true }))];
  if (!items.length) return project;
  await fs.mkdir(cacheDir, { recursive: true });
  const { width, height, fps } = project.canvas;
  const done = new Map();
  for (let i = 0; i < items.length; i++) {
    const { item, layer } = items[i];
    const transparent = layer || !!item.motion.transparent;
    const r = await resolve(item.motion, readDesignFolder);
    const doc = motion.buildDoc({ html: r.html, width, height, theme: r.theme, assets: r.assets, transparent });
    const key = motion.hash(doc, width, height, fps, transparent);
    const out = path.join(cacheDir, `${key}.${transparent ? "mov" : "mp4"}`);
    if (!done.has(key)) {
      const exists = await fs.stat(out).then((s) => s.size > 0).catch(() => false);
      if (!exists) {
        const tmp = out.replace(/(\.\w+)$/, ".part$1");
        await mr.renderToFile(ctx.BrowserWindow, doc, {
          width,
          height,
          fps,
          transparent,
          outPath: tmp,
          ffmpeg: ctx.ffmpeg,
          tmpDir: ctx.tmpDir,
          signal,
          onProgress: (p) => onProgress && onProgress({ stage: "motion", progress: (i + p) / items.length, message: `Моушн ${i + 1} из ${items.length}` }),
        });
        await fs.rename(tmp, out);
      }
      done.set(key, out);
    }
    const file = done.get(key);
    item.src = file;
    item.kind = "video";
    // Кусок моушна — без звука; громкость не трогаем, сборка подставит тишину.
    delete item.motion;
  }
  return project;
}

module.exports = { streamModel, generate, edit, resolve, docFor, prerender, imageForModel, collectAssets, check, themeFor };
