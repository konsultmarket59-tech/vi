/**
 * Сториборд: из фотографии — шесть кадров, из кадров — ролик.
 *
 * Зачем отдельно от обычной генерации. Одна картинка отвечает на вопрос «как
 * это выглядит». Ролик отвечает на вопрос «что происходит», и собрать его из
 * одной картинки нельзя: нужна последовательность, в которой каждый следующий
 * кадр продолжает предыдущий, а не живёт сам по себе. Сочинять шесть промптов
 * руками, следя за тем, чтобы герой, свет и место не менялись, — работа, ради
 * которой это и написано.
 *
 * Порядок такой: модель пишет ШЕСТЬ ОПИСАНИЙ кадров (текст, который можно
 * прочитать и поправить до трат), потом код заказывает по ним картинки, потом
 * — по желанию — оживляет каждую и склеивает. Разделение не косметическое:
 * сценарий правится бесплатно, а картинки и ролики стоят денег.
 */

const path = require("node:path");
const fs = require("node:fs/promises");

/** Сколько кадров в сториборде. Шесть — то, что просили, и то, что читается. */
const FRAMES = 6;

/**
 * Задание модели на раскадровку.
 *
 * Главное требование — НЕИЗМЕННОСТЬ: тот же герой, то же место, тот же свет.
 * Без него модель на каждом кадре рисует новую сцену, и шесть картинок не
 * складываются в историю, а выглядят как шесть разных работ.
 */
function buildStoryboardPrompt({ idea = "", frames = FRAMES, hasPhoto = false } = {}) {
  return [
    `Разбейте замысел на ${frames} кадров сториборда и опишите каждый.`,
    "",
    hasPhoto
      ? "К заданию приложена фотография. Всё, что на ней есть — герой, одежда, место, свет, — " +
        "берётся ИЗ НЕЁ и не меняется от кадра к кадру. Не придумывайте другого героя и другое место."
      : "Герой, место и свет придумываются один раз и дальше не меняются от кадра к кадру.",
    "",
    "Требования, без которых шесть картинок не станут историей:",
    "1. Один и тот же герой, одежда, место и свет во всех кадрах. Меняются только план, ракурс и то, что происходит.",
    "2. Каждый кадр продолжает предыдущий по времени. Не шесть вариантов одного, а шесть моментов подряд.",
    "3. План меняется от кадра к кадру: общий, средний, крупный, деталь. Два одинаковых плана подряд — потеря.",
    "4. Описание кадра — то, что ВИДНО. Не настроение и не смысл, а предметы, поза, ракурс, свет.",
    "5. Движение — отдельной строкой: что должно двигаться, если кадр оживить. Одно движение на кадр, медленное.",
    "",
    idea ? `Замысел: ${idea}` : "Замысел придумайте сами по фотографии.",
    "",
    "Ответ строго по разметке, без вступления и пояснений:",
    "",
    "=== КАДР 1 ===",
    "--- ЧТО В КАДРЕ ---",
    "(описание одним абзацем, по-русски)",
    "--- ДВИЖЕНИЕ ---",
    "(одно медленное движение для оживления)",
    "",
    `…и так до КАДР ${frames}.`,
  ].join("\n");
}

/**
 * Разобрать ответ модели в кадры.
 *
 * Ответ без разметки НЕ превращается в пустую раскадровку молча: пустой список
 * выглядит как «ничего не вышло», хотя текст пришёл — просто не в том виде.
 */
function parseStoryboard(text) {
  const parts = String(text || "").split(/===\s*КАДР\s*\d+\s*===/i).slice(1);
  const frames = [];
  for (const [i, part] of parts.entries()) {
    const scene = (part.split(/---\s*ДВИЖЕНИЕ\s*---/i)[0] || "")
      .replace(/---\s*ЧТО В КАДРЕ\s*---/i, "")
      .trim();
    const motion = (part.split(/---\s*ДВИЖЕНИЕ\s*---/i)[1] || "").trim();
    if (!scene) continue;
    frames.push({ index: i + 1, scene, motion });
  }
  return frames;
}

/** Что не так с раскадровкой — до того, как за неё заплачено. */
function problemsOf(frames) {
  const problems = [];
  if (!frames.length) {
    problems.push("Ответ пришёл без разметки — кадры из него не собрались. Поправьте текст руками или попросите заново.");
    return problems;
  }
  if (frames.length < FRAMES) problems.push(`Кадров получилось ${frames.length}, а нужно ${FRAMES}.`);
  const noMotion = frames.filter((f) => !f.motion).map((f) => f.index);
  // Кадр без движения оживить нечем: он станет статичной секундой в ролике.
  if (noMotion.length) problems.push(`Без описания движения: кадры ${noMotion.join(", ")} — оживить их будет нечем.`);
  return problems;
}

/**
 * Промпт одной картинки сториборда.
 *
 * Неизменность повторяется в КАЖДОМ кадре, а не объявляется один раз в начале:
 * каждая картинка заказывается отдельным запросом, и модель не помнит, что
 * говорили предыдущей.
 */
function framePrompt(frame, { style = "", keep = "" } = {}) {
  return [
    frame.scene,
    keep ? `Неизменно во всех кадрах: ${keep}.` : "",
    style,
    `Storyboard frame ${frame.index} of ${FRAMES}: same character, same wardrobe, same location and same lighting as the other frames.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Промпт оживления кадра: одно медленное движение, ничего больше. */
function motionPrompt(frame) {
  return [
    frame.motion || "very slow, almost imperceptible motion",
    "One single slow continuous movement, no cuts, no camera reversal.",
    "Everything else stays exactly as in the source image: same character, same wardrobe, same set, same light.",
    "No new objects, no morphing faces, no text, no captions, no watermarks.",
  ].join(" ");
}

/**
 * Склеить готовые клипы в один ролик.
 *
 * Клипы приходят от разных заказов и могут отличаться размером кадра и частотой
 * — склейка «copy» на таком разваливается, поэтому каждый кусок приводится к
 * общему виду. Дороже по времени, зато собирается всегда.
 */
async function joinClips(runFfmpeg, bin, clips, workDir, outPath, { width = 1280, height = 720, fps = 24 } = {}) {
  if (!clips.length) throw new Error("Нет ни одного оживлённого кадра — склеивать нечего.");
  const parts = [];
  for (const [i, clip] of clips.entries()) {
    const part = path.join(workDir, `кадр-${String(i + 1).padStart(2, "0")}.mp4`);
    await runFfmpeg(bin, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", clip,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-an", part,
    ]);
    parts.push(part);
  }
  const listFile = path.join(workDir, "кадры.txt");
  await fs.writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
  await runFfmpeg(bin, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath,
  ]);
  return outPath;
}

/**
 * Собрать ролик из неподвижных кадров — когда оживлять нечем или незачем.
 *
 * Каждый кадр держится заданное время, между кадрами — жёсткая склейка. Это не
 * замена оживлению, а способ увидеть монтаж целиком, ничего не потратив на видео.
 */
async function joinStills(runFfmpeg, bin, images, workDir, outPath, { width = 1280, height = 720, fps = 24, seconds = 2 } = {}) {
  if (!images.length) throw new Error("Нет ни одного кадра — склеивать нечего.");
  const parts = [];
  for (const [i, img] of images.entries()) {
    const part = path.join(workDir, `стоп-${String(i + 1).padStart(2, "0")}.mp4`);
    await runFfmpeg(bin, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-loop", "1", "-i", img, "-t", String(seconds),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", part,
    ]);
    parts.push(part);
  }
  const listFile = path.join(workDir, "стопы.txt");
  await fs.writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
  await runFfmpeg(bin, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath,
  ]);
  return outPath;
}

module.exports = {
  FRAMES,
  buildStoryboardPrompt,
  parseStoryboard,
  problemsOf,
  framePrompt,
  motionPrompt,
  joinClips,
  joinStills,
};
