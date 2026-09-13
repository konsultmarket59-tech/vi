// Видео-презентации и подкасты: от источника до готового файла.
//
// Замысел.
//
// Человек даёт источник — текст, документ, расшифровку записи, — и получает не
// пересказ, а сделанную вещь: ролик-презентацию с кадрами и голосом или
// подкаст, где двое разговаривают об этом источнике.
//
// Подкаст здесь не «диктор читает текст вслух». Смысл в том, что двое ДУМАЮТ:
// сомневаются, спорят, вытаскивают неочевидное, задают вопросы, на которые в
// источнике ответа нет, и честно это называют. Согласный диалог, где второй
// поддакивает первому, — это тот же монолог, только длиннее, и слушать его
// незачем. Поэтому в задании модели прямо потребовано несогласие.
//
// Что делает код, а что модель.
//
// Модель пишет ТОЛЬКО сценарий — что говорят и что показать. Всё остальное
// делает код: разбирает сценарий по строгой разметке, заказывает картинки и
// голоса, собирает файл ffmpeg-ом. Это разделение важно: сценарий можно
// прочитать и поправить руками до того, как потрачены деньги на генерацию,
// а сборка обязана быть повторяемой.

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

const SCRIPT_KINDS = [
  {
    id: "presentation",
    name: "Видео-презентация",
    hint: "Кадры с голосом за кадром: по сцене на мысль. Для разбора, отчёта, обучающего ролика.",
  },
  {
    id: "podcast",
    name: "Подкаст на двоих",
    hint: "Двое разбирают источник вслух: сомневаются, спорят, вытаскивают неочевидное.",
  },
];

/** Голоса по умолчанию: двое должны звучать по-разному, иначе диалог не слышен. */
const DEFAULT_VOICES = { a: "", b: "" };

function clean(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

/**
 * Задание модели на сценарий презентации.
 *
 * Требование «по сцене на мысль» жёстче, чем кажется: без него модель нарезает
 * источник по абзацам, и получается озвученный текст, а не презентация.
 */
function buildPresentationPrompt({ source, minutes = 3, design, notes = "" } = {}) {
  const scenes = Math.max(3, Math.min(24, Math.round(minutes * 4)));
  return [
    "Ты делаешь видео-презентацию по источнику. Не пересказ абзац за абзацем, а разбор:",
    "одна сцена — одна мысль, которую стоит запомнить.",
    "",
    "ИСТОЧНИК:",
    clean(source),
    notes ? "\nПОЖЕЛАНИЯ ЧЕЛОВЕКА:\n" + clean(notes) : "",
    design && design.description ? "\nДИЗАЙН-СИСТЕМА (цвета и шрифты только отсюда):\n" + design.description : "",
    "",
    `Сцен: примерно ${scenes}. Верни строго такой разметкой и ничего больше:`,
    "",
    "=== СЦЕНА 1 ===",
    "--- ЗАГОЛОВОК ---",
    "Короткая фраза на экран, до семи слов",
    "--- ГОЛОС ---",
    "Что говорит диктор: две–четыре живые фразы, как человек рассказывает коллеге.",
    "--- КАДР ---",
    "Описание картинки для генерации на английском: что изображено, план, свет, стиль.",
    "",
    "ПРАВИЛА:",
    "  1. Говори только то, что есть в источнике. Чего нет — не додумывай.",
    "  2. Голос и заголовок не повторяют друг друга: заголовок называет, голос объясняет.",
    "  3. Кадр описывай предметно, без «красивая картинка на тему». Модель рисует то,",
    "     что названо, и ничего кроме.",
    "  4. Людей с узнаваемыми лицами и чужие логотипы в кадре не проси.",
    "  5. Последняя сцена — вывод, а не «спасибо за внимание».",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Задание модели на подкаст.
 *
 * Ключевое требование — несогласие. Диалог, где второй поддакивает первому,
 * это монолог в два голоса: слушать его незачем, и делать его тем более.
 */
function buildPodcastPrompt({ source, minutes = 8, names = {}, notes = "" } = {}) {
  const a = clean(names.a) || "Аня";
  const b = clean(names.b) || "Борис";
  // Примерно 150 слов в минуту живой речи, реплика — около 35 слов.
  const lines = Math.max(8, Math.min(120, Math.round((minutes * 150) / 35)));
  return [
    `Ты пишешь сценарий подкаста на двоих по источнику. Ведущие: ${a} и ${b}.`,
    "",
    "ИСТОЧНИК:",
    clean(source),
    notes ? "\nПОЖЕЛАНИЯ ЧЕЛОВЕКА:\n" + clean(notes) : "",
    "",
    `Реплик: примерно ${lines}. Верни строго такой разметкой и ничего больше:`,
    "",
    "=== РЕПЛИКА 1 ===",
    "--- КТО ---",
    "А",
    "--- ТЕКСТ ---",
    "Что говорит. Живая устная речь, одно-два предложения.",
    "",
    "(«А» — первый ведущий, «Б» — второй. Другие обозначения не используй.)",
    "",
    "ПРАВИЛА — и они не про стиль, а про смысл:",
    "  1. Двое ДУМАЮТ вслух, а не читают текст по очереди. Сомневайтесь, уточняйте,",
    "     возвращайтесь к сказанному.",
    "  2. Они обязаны в чём-то НЕ СОГЛАСИТЬСЯ. Диалог, где второй поддакивает первому, —",
    "     это монолог в два голоса, и слушать его незачем.",
    "  3. Вытаскивайте неочевидное: что из источника следует, но прямо там не сказано.",
    "     Такое помечайте словами вроде «получается, что» — чтобы слушатель отличал",
    "     вывод от цитаты.",
    "  4. Задавайте вопросы, на которые в источнике ответа НЕТ, и честно говорите, что",
    "     ответа нет. Не выдумывайте его.",
    "  5. Никаких фактов сверх источника: ни цифр, ни имён, ни дат, которых там не было.",
    "  6. Начало — без «здравствуйте, дорогие слушатели»: сразу в дело. Конец — с тем,",
    "     что осталось непонятным, а не с благодарностями.",
    "  7. Устная речь: короткие фразы, без канцелярита и без списков.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Разбор сценария презентации.
 *
 * Разметка строгая нарочно: разобранный наполовину сценарий хуже, чем никакой —
 * по нему пойдут заказывать картинки, и деньги потратятся на мусор. Всё, что не
 * разобралось, считается и показывается человеку.
 */
/**
 * Поля блока по заголовкам вида `--- ИМЯ ---`.
 *
 * Разбирается построчно, а не одним выражением. Первая попытка была
 * регулярным выражением с `$` в многострочном режиме, и оно возвращало пустоту
 * на всём: ленивый квантификатор останавливался на конце первой же строки.
 * Построчный проход и читается, и ломается понятнее.
 */
function fieldsOf(block) {
  const out = {};
  let current = null;
  for (const line of String(block || "").split("\n")) {
    const head = /^---\s*([^-]+?)\s*---\s*$/.exec(line.trim());
    if (head) {
      current = head[1].trim().toUpperCase();
      out[current] = [];
      continue;
    }
    if (current) out[current].push(line);
  }
  const result = {};
  for (const [key, lines] of Object.entries(out)) result[key] = lines.join("\n").trim();
  return result;
}

function parsePresentation(text) {
  const body = clean(text);
  const scenes = [];
  const problems = [];
  const blocks = body.split(/^===\s*СЦЕНА\s*\d+\s*===\s*$/im).slice(1);
  if (!blocks.length) return { scenes: [], problems: ["В ответе нет ни одной сцены с разметкой «=== СЦЕНА N ===»."] };
  blocks.forEach((block, i) => {
    const f = fieldsOf(block);
    const title = f["ЗАГОЛОВОК"] || "";
    const voice = f["ГОЛОС"] || "";
    const shot = f["КАДР"] || "";
    if (!voice) {
      problems.push(`Сцена ${i + 1}: нет голоса — озвучивать нечего.`);
      return;
    }
    if (!shot) problems.push(`Сцена ${i + 1}: нет описания кадра — картинку заказать не из чего.`);
    scenes.push({ index: scenes.length + 1, title, voice, shot });
  });
  return { scenes, problems };
}

/** Разбор сценария подкаста: кто говорит и что. */
function parsePodcast(text) {
  const body = clean(text);
  const lines = [];
  const problems = [];
  const blocks = body.split(/^===\s*РЕПЛИКА\s*\d+\s*===\s*$/im).slice(1);
  if (!blocks.length) return { lines: [], problems: ["В ответе нет ни одной реплики с разметкой «=== РЕПЛИКА N ===»."] };
  blocks.forEach((block, i) => {
    const f = fieldsOf(block);
    const speaker = String(f["КТО"] || "").trim().toUpperCase().replace(/[^АБAB]/g, "").slice(0, 1);
    const said = String(f["ТЕКСТ"] || "").trim();
    if (!said) {
      problems.push(`Реплика ${i + 1}: пустой текст.`);
      return;
    }
    // Латинские A и B модели путают с русскими А и Б постоянно — считаем их одним.
    const side = speaker === "Б" || speaker === "B" ? "b" : "a";
    lines.push({ index: lines.length + 1, speaker: side, text: said });
  });
  // Диалог, в котором говорит один, — не диалог. Это видно сразу и стоит
  // сказать человеку до того, как он оплатит озвучку.
  const aCount = lines.filter((l) => l.speaker === "a").length;
  if (lines.length && (aCount === 0 || aCount === lines.length)) {
    problems.push("Говорит только один ведущий — это монолог, а не подкаст. Стоит переспросить модель.");
  }
  return { lines, problems };
}

/** Сколько примерно длится озвучка: 150 слов в минуту живой речи. */
function estimateSeconds(text) {
  const words = clean(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}

function runFfmpeg(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 26 }, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(-500))) : resolve(true)
    );
  });
}

/** Длительность готового аудиофайла — по ней режется картинка под голос. */
function audioSeconds(bin, file) {
  return new Promise((resolve) => {
    execFile(bin, ["-hide_banner", "-i", file], { maxBuffer: 1 << 22 }, (_e, _o, err) => {
      const m = /Duration: (\d+):(\d+):(\d+)\.(\d+)/.exec(String(err || ""));
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number("0." + m[4]) : 0);
    });
  });
}

/**
 * Сборка презентации: на каждую сцену — своя картинка, растянутая ровно на
 * длину своего голоса.
 *
 * Собирается посценно, а не одним фильтром: часовая презентация одним вызовом
 * ffmpeg упирается в число входов, а по кускам она собирается любой длины, и
 * сорвавшаяся сцена не уносит с собой остальные.
 */
async function buildPresentationVideo(bin, scenes, workDir, outPath, { width = 1920, height = 1080, fps = 25 } = {}) {
  const parts = [];
  for (const scene of scenes) {
    if (!scene.imagePath || !scene.audioPath) continue;
    const seconds = Math.max(1, await audioSeconds(bin, scene.audioPath));
    const part = path.join(workDir, `часть-${String(parts.length + 1).padStart(3, "0")}.mp4`);
    await runFfmpeg(bin, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-loop", "1", "-i", scene.imagePath,
      "-i", scene.audioPath,
      "-t", String(seconds),
      "-vf",
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium",
      "-c:a", "aac", "-b:a", "160k", "-shortest", part,
    ]);
    parts.push(part);
  }
  if (!parts.length) throw new Error("Ни одна сцена не собралась — нечего склеивать.");
  const listFile = path.join(workDir, "части.txt");
  // Имена экранируются по правилам concat: апостроф в пути ломает список.
  await fs.writeFile(listFile, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
  await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath]);
  return outPath;
}

/** Склейка реплик подкаста в один файл. */
async function buildPodcastAudio(bin, files, workDir, outPath) {
  if (!files.length) throw new Error("Ни одна реплика не озвучена — склеивать нечего.");
  const listFile = path.join(workDir, "реплики.txt");
  await fs.writeFile(listFile, files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
  // Перекодируем, а не копируем: реплики приходят разными кодеками и частотами,
  // и copy в таком случае даёт файл, который часть плееров не открывает.
  await runFfmpeg(bin, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:a", "libmp3lame", "-b:a", "160k", "-ar", "44100", outPath,
  ]);
  return outPath;
}

module.exports = {
  SCRIPT_KINDS,
  DEFAULT_VOICES,
  buildPresentationPrompt,
  buildPodcastPrompt,
  parsePresentation,
  parsePodcast,
  estimateSeconds,
  audioSeconds,
  buildPresentationVideo,
  buildPodcastAudio,
};
