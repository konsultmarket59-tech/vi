// Видеотека: разговор с содержимым видео- и аудиозаписей.
//
// Устройство и почему именно такое.
//
// 1. ФАЙЛЫ НЕ КОПИРУЮТСЯ. Человек указывает папку — свою, сетевую или
//    синхронизированную с облаком, — и записи остаются лежать там, где лежали.
//    Приложение хранит только расшифровку: двадцать часов записей это гигабайты
//    видео и примерно мегабайт текста.
//
// 2. РАСШИФРОВКА ЛОКАЛЬНАЯ ПО УМОЛЧАНИЮ. Модель скачивается один раз и работает
//    на процессоре; материал не покидает компьютер. Платный вариант есть, но
//    включается вручную — на записях бывают клиентские дела, и это решение
//    человека, а не приложения.
//
// 3. ОТВЕТЫ ТОЛЬКО ПО ИСТОЧНИКАМ. Модель видит не «всё, что знает про тему», а
//    найденные куски расшифровок. Каждое утверждение обязано нести ссылку на
//    файл и минуту, а на вопрос без ответа в источниках положено отвечать «в
//    записях этого нет». Ссылки потом проверяются по самим расшифровкам, так что
//    выдуманная ссылка видна сразу.
//
// 4. ПОИСК БЕЗ СЕТИ И БЕЗ ДЕНЕГ. Индекс — обычный BM25 по словам с приведением
//    русских окончаний. Векторные вложения были бы точнее, но потребовали бы
//    либо второй модели на диске, либо платного обращения на каждый вопрос, а
//    на расшифровках речи разница невелика: люди в записях говорят теми же
//    словами, которыми потом ищут.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

const VIDEO_EXT = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".mpg", ".mpeg"];
const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma"];
const MEDIA_EXT = [...VIDEO_EXT, ...AUDIO_EXT];

/** Кусок расшифровки: столько речи, чтобы мысль была целой, но ссылка точной. */
const CHUNK_SECONDS = 45;
const CHUNK_OVERLAP = 8;

function isMedia(name) {
  return MEDIA_EXT.includes(path.extname(name).toLowerCase());
}

function kindOf(name) {
  return VIDEO_EXT.includes(path.extname(name).toLowerCase()) ? "видео" : "аудио";
}

/** Время в подписи — то, что человек введёт в плеере, чтобы проверить. */
function stamp(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

// ---------- обход папки ----------

/**
 * Что лежит в папке. Рекурсивно, но без фанатизма: очень глубокая вложенность
 * почти всегда означает, что человек показал не ту папку.
 */
async function scanFolder(root, { maxDepth = 5, maxFiles = 5000 } = {}) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        await walk(full, depth + 1);
      } else if (isMedia(entry.name)) {
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          continue;
        }
        found.push({
          path: full,
          name: entry.name,
          folder: path.relative(root, dir) || ".",
          kind: kindOf(entry.name),
          bytes: stat.size,
          modified: stat.mtimeMs,
        });
      }
    }
  }
  await walk(root, 0);
  found.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return found;
}

// ---------- звук ----------

/**
 * Звук из записи в том виде, какой нужен расшифровщику: 16 кГц, моно, PCM.
 *
 * Это самая дешёвая часть работы и единственная, где видео вообще открывается:
 * замер на десятиминутном ролике 1080p — меньше секунды. Файл при этом только
 * читается, оригинал не трогается никогда.
 */
function extractAudio(ffmpegBin, sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBin,
      ["-y", "-hide_banner", "-loglevel", "error", "-i", sourcePath,
       "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", destPath],
      { maxBuffer: 1 << 24 },
      (err) => (err ? reject(new Error(`Не удалось прочитать звук из «${path.basename(sourcePath)}»: ${err.message}`)) : resolve(destPath))
    );
  });
}

/** Длительность записи в секундах — для оценки, сколько всего работы. */
function probeDuration(ffmpegBin, file) {
  return new Promise((resolve) => {
    execFile(ffmpegBin, ["-hide_banner", "-i", file], { maxBuffer: 1 << 22 }, (_e, _out, err) => {
      const m = /Duration: (\d+):(\d+):(\d+)/.exec(String(err || ""));
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
  });
}

// ---------- расшифровка ----------

/**
 * Локальный расшифровщик — whisper.cpp.
 *
 * Приложение его НЕ ВЕЗЁТ С СОБОЙ и не скачивает молча: это отдельная программа
 * и модель на полтора гигабайта, и тащить их в установщик ради тех, кому
 * видеотека не нужна, нечестно. Вместо этого приложение проверяет, есть ли они
 * на месте, и если нет — говорит прямо, что именно поставить.
 */
function localEngineStatus({ binPath, modelPath }) {
  const bin = binPath && fsSync.existsSync(binPath);
  const model = modelPath && fsSync.existsSync(modelPath);
  return {
    ready: !!(bin && model),
    bin: !!bin,
    model: !!model,
    reason: !bin
      ? "Не найдена программа расшифровки. Укажите путь к whisper-cli (whisper.cpp) в настройках раздела."
      : !model
        ? "Не найден файл модели. Скачайте модель для русского языка (ggml-large-v3-turbo или ggml-medium) и укажите путь к ней."
        : "",
  };
}

/**
 * Разбор вывода whisper.cpp в формате srt: время начала, время конца, текст.
 * Формат стабильный и текстовый, поэтому разбирается здесь, а не отдельной
 * библиотекой — одна зависимость меньше.
 */
function parseSrt(text) {
  const out = [];
  const blocks = String(text || "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const m = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/.exec(timeLine);
    if (!m) continue;
    const toSec = (h, mi, se, ms) => Number(h) * 3600 + Number(mi) * 60 + Number(se) + Number(ms) / 1000;
    const body = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
    if (!body) continue;
    out.push({ from: toSec(m[1], m[2], m[3], m[4]), to: toSec(m[5], m[6], m[7], m[8]), text: body });
  }
  return out;
}

/**
 * Запуск локальной расшифровки. Возвращает отрезки с временем.
 *
 * onProgress получает долю выполненного: работа идёт минутами и без обратной
 * связи выглядит зависшей.
 */
function transcribeLocal({ binPath, modelPath, wavPath, language = "ru", threads = 4, onProgress }) {
  return new Promise((resolve, reject) => {
    const outBase = wavPath.replace(/\.wav$/i, "");
    const child = spawn(binPath, [
      "-m", modelPath,
      "-f", wavPath,
      "-l", language,
      "-t", String(threads),
      "-osrt",
      "-of", outBase,
      "-pp",
    ]);
    let stderr = "";
    child.stderr.on("data", (d) => {
      const text = String(d);
      stderr += text;
      const m = /progress\s*=\s*(\d+)%/i.exec(text);
      if (m && onProgress) onProgress(Number(m[1]) / 100);
    });
    child.on("error", (e) => reject(new Error(`Не удалось запустить расшифровку: ${e.message}`)));
    child.on("close", async (code) => {
      if (code !== 0) return reject(new Error(`Расшифровка завершилась с ошибкой: ${stderr.slice(-400)}`));
      try {
        resolve(parseSrt(await fs.readFile(outBase + ".srt", "utf-8")));
      } catch (e) {
        reject(new Error(`Расшифровка прошла, но результат не прочитан: ${e.message}`));
      }
    });
  });
}

// ---------- куски и поиск ----------

/**
 * Отрезки речи собираются в куски примерно по сорок пять секунд с небольшим
 * перехлёстом.
 *
 * Размер выбран не на глаз. Слишком мелкий кусок рвёт мысль пополам, и в ответ
 * попадает половина фразы; слишком крупный делает ссылку бесполезной — «где-то в
 * этих пяти минутах». Перехлёст нужен, чтобы мысль, сказанная на границе, не
 * пропала: без него ровно те фразы, что произносятся на стыке, не находятся ни
 * одним запросом.
 */
function buildChunks(segments, { seconds = CHUNK_SECONDS, overlap = CHUNK_OVERLAP } = {}) {
  const chunks = [];
  let current = null;
  for (const seg of segments) {
    if (!current) current = { from: seg.from, to: seg.to, text: seg.text };
    else if (seg.to - current.from <= seconds) {
      current.to = seg.to;
      current.text += " " + seg.text;
    } else {
      chunks.push(current);
      // Перехлёст: новый кусок начинается с хвоста предыдущего.
      const tail = segments.filter((x) => x.from >= current.to - overlap && x.from < seg.from);
      const tailText = tail.map((x) => x.text).join(" ");
      current = {
        from: tail.length ? tail[0].from : seg.from,
        to: seg.to,
        text: (tailText ? tailText + " " : "") + seg.text,
      };
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c, i) => ({ ...c, index: i, text: c.text.replace(/\s+/g, " ").trim() }));
}

/**
 * Слова запроса и текста приводятся к общему виду.
 *
 * Русские окончания срезаются грубо, без словаря: «бюджетами», «бюджету» и
 * «бюджет» должны находить друг друга, иначе поиск по расшифровке живой речи
 * промахивается на каждом втором запросе. Полноценная лемматизация тут была бы
 * лучше, но потребовала бы словаря на несколько мегабайт ради выигрыша, который
 * на разговорной речи почти не заметен.
 */
/**
 * Приведение русского слова к основе — алгоритм Портера для русского языка.
 *
 * Первый вариант просто срезал список окончаний по длине, и на этом же примере
 * сломался: «бюджет» превращался в «бюдж» (сработало глагольное «ет»), а
 * «бюджеты» — в «бюджет», и слово переставало находить само себя. Требование к
 * приведению одно и жёсткое: ВСЕ формы слова обязаны давать одну основу, иначе
 * поиск по расшифровке живой речи промахивается на каждом втором запросе.
 * Поэтому здесь описанный алгоритм с порядком шагов и областями слова, а не
 * список окончаний.
 */
const VOWELS = "аеиоуыэюя";

function stem(word) {
  let w = String(word || "").toLowerCase().replace(/ё/g, "е");
  if (w.length < 3) return w;

  // RV — часть слова после первой гласной; почти все окончания снимаются
  // только внутри неё, иначе от коротких слов ничего не остаётся.
  let rvStart = -1;
  for (let i = 0; i < w.length; i++) {
    if (VOWELS.includes(w[i])) {
      rvStart = i + 1;
      break;
    }
  }
  if (rvStart < 0) return w;

  // R2 — область, где снимаются словообразовательные суффиксы («ость»).
  let r1 = w.length;
  for (let i = 1; i < w.length; i++) {
    if (!VOWELS.includes(w[i]) && VOWELS.includes(w[i - 1])) {
      r1 = i + 1;
      break;
    }
  }
  let r2 = w.length;
  for (let i = r1 + 1; i < w.length; i++) {
    if (!VOWELS.includes(w[i]) && VOWELS.includes(w[i - 1])) {
      r2 = i + 1;
      break;
    }
  }

  const inRV = (end) => w.length - end.length >= rvStart;
  const cut = (list, needBefore) => {
    // Самое длинное подходящее окончание — иначе «ами» снимется как «и».
    const sorted = [...list].sort((a, b) => b.length - a.length);
    for (const end of sorted) {
      if (!w.endsWith(end) || !inRV(end)) continue;
      const base = w.slice(0, -end.length);
      if (needBefore && !needBefore.includes(base.slice(-1))) continue;
      w = base;
      return true;
    }
    return false;
  };

  const PERFECTIVE_1 = ["вшись", "вши", "в"];
  const PERFECTIVE_2 = ["ившись", "ывшись", "ивши", "ывши", "ив", "ыв"];
  const ADJECTIVE = [
    "ее", "ие", "ые", "ое", "ими", "ыми", "ей", "ий", "ый", "ой", "ем", "им", "ым", "ом",
    "его", "ого", "ему", "ому", "их", "ых", "ую", "юю", "ая", "яя", "ою", "ею",
  ];
  const PARTICIPLE_1 = ["ем", "нн", "вш", "ющ", "щ"];
  const PARTICIPLE_2 = ["ивш", "ывш", "ующ"];
  const REFLEXIVE = ["ся", "сь"];
  const VERB_1 = [
    "ла", "на", "ете", "йте", "ли", "й", "л", "ем", "н", "ло", "но", "ет", "ют", "ны",
    "ть", "ешь", "нно",
  ];
  const VERB_2 = [
    "ила", "ыла", "ена", "ейте", "уйте", "ите", "или", "ыли", "ей", "уй", "ил", "ыл",
    "им", "ым", "ен", "ило", "ыло", "ено", "ят", "ует", "уют", "ит", "ыт", "ены", "ить",
    "ыть", "ишь", "ую", "ю",
  ];
  const NOUN = [
    "иями", "ями", "ами", "иях", "ях", "ах", "ией", "иям", "ием", "ев", "ов", "ие", "ье",
    "еи", "ии", "ей", "ой", "ий", "ям", "ем", "ам", "ом", "ию", "ью", "ия", "ья", "а",
    "е", "и", "й", "о", "у", "ы", "ь", "ю", "я",
  ];

  // Шаг 1. Деепричастие; иначе — возвратность и затем прилагательное,
  // причастие, глагол или существительное. Порядок важен: существительное
  // проверяется последним, потому что его окончания самые короткие.
  const step1 =
    cut(PERFECTIVE_1, "ая") ||
    cut(PERFECTIVE_2) ||
    (() => {
      cut(REFLEXIVE);
      if (cut(ADJECTIVE)) {
        cut(PARTICIPLE_1, "ая") || cut(PARTICIPLE_2);
        return true;
      }
      return cut(VERB_1, "ая") || cut(VERB_2) || cut(NOUN);
    })();
  void step1;

  // Шаг 2: снять «и».
  if (w.endsWith("и") && inRV("и")) w = w.slice(0, -1);

  // Шаг 3: словообразовательный суффикс, только в R2.
  for (const end of ["ость", "ост"]) {
    if (w.endsWith(end) && w.length - end.length >= r2) {
      w = w.slice(0, -end.length);
      break;
    }
  }

  // Шаг 4: удвоенное «н», превосходная степень, мягкий знак.
  if (w.endsWith("нн")) w = w.slice(0, -1);
  else {
    for (const end of ["ейше", "ейш"]) {
      if (w.endsWith(end) && inRV(end)) {
        w = w.slice(0, -end.length);
        if (w.endsWith("нн")) w = w.slice(0, -1);
        break;
      }
    }
    if (w.endsWith("ь")) w = w.slice(0, -1);
  }
  return w;
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length > 2)
    .map(stem);
}

/**
 * Индекс по всем расшифровкам. Обычный BM25 — то же, чем ищут поисковики по
 * тексту: слово тем ценнее, чем реже встречается во всей библиотеке, и тем
 * менее ценно, чем чаще повторяется внутри одного куска.
 */
function buildIndex(documents) {
  const chunks = [];
  for (const doc of documents) {
    for (const chunk of doc.chunks || []) {
      chunks.push({
        file: doc.path,
        name: doc.name,
        from: chunk.from,
        to: chunk.to,
        text: chunk.text,
        tokens: tokenize(chunk.text),
      });
    }
  }
  const df = new Map();
  for (const c of chunks) {
    for (const t of new Set(c.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgLen = chunks.length ? chunks.reduce((s2, c) => s2 + c.tokens.length, 0) / chunks.length : 1;
  return { chunks, df, avgLen, total: chunks.length };
}

function search(index, query, limit = 12) {
  const terms = tokenize(query);
  if (!terms.length || !index.chunks.length) return [];
  const k1 = 1.5;
  const b = 0.75;
  const scored = index.chunks.map((chunk) => {
    let score = 0;
    for (const term of new Set(terms)) {
      const tf = chunk.tokens.filter((t) => t === term).length;
      if (!tf) continue;
      const n = index.df.get(term) || 0;
      const idf = Math.log(1 + (index.total - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * chunk.tokens.length) / index.avgLen)));
    }
    return { chunk, score };
  });
  return scored
    .filter((s2) => s2.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit)
    .map((s2) => s2.chunk);
}

// ---------- ответ по источникам ----------

/**
 * Задание модели.
 *
 * Здесь важно не уговорить модель быть честной, а лишить её возможности быть
 * нечестной незаметно. Она видит только найденные куски — общих знаний по теме
 * ей взять неоткуда; каждое утверждение обязано нести ссылку на файл и минуту;
 * ссылки потом сверяются с самими расшифровками, и выдуманная видна сразу.
 *
 * Это не даёт стопроцентной гарантии. Гарантию даёт только проверка человеком
 * по ссылке — поэтому ссылки и обязательны.
 */
function buildAnswerPrompt({ question, hits, mode = "search" }) {
  const sources = hits.map(
    (h, i) => `[${i + 1}] ${h.name} · ${stamp(h.from)}–${stamp(h.to)}\n${h.text}`
  );
  const task =
    mode === "retell"
      ? "Перескажи содержимое подробно и по порядку: о чём речь, какие мысли, какие решения."
      : "Ответь на вопрос.";
  return [
    "Ты отвечаешь СТРОГО по расшифровкам записей, которые даны ниже. Ничего сверх них.",
    "",
    "ВОПРОС:",
    question,
    "",
    "ИСТОЧНИКИ (номер, файл, время, расшифровка):",
    ...(sources.length ? sources : ["(ничего не нашлось)"]),
    "",
    "ПРАВИЛА:",
    `  1. ${task}`,
    "  2. После каждого утверждения — ссылка в квадратных скобках на номер источника,",
    "     например [2]. Утверждение без ссылки недопустимо.",
    "  3. Если в источниках ответа нет — так и напиши: «в записях этого нет». Не",
    "     достраивай ответ из общих знаний, даже если тема тебе знакома.",
    "  4. Если источники противоречат друг другу — покажи оба и скажи, что они расходятся.",
    "  5. Не пересказывай источники, которые к вопросу не относятся.",
    "  6. В конце — строка «Проверить:» и перечень файлов с временем, откуда взят ответ.",
  ].join("\n");
}

/**
 * Проверка ссылок в ответе.
 *
 * Модель могла сослаться на источник, которого нет, или приписать источнику то,
 * чего в нём не сказано. Первое ловится точно — номер либо в списке, либо нет.
 * Второе проверяется грубее: берём значимые слова из предложения со ссылкой и
 * смотрим, встречаются ли они в самом источнике. Совпадение ниже трети — повод
 * показать человеку, что ссылка сомнительная, а не молча ей верить.
 */
function verifyCitations(answer, hits) {
  const text = String(answer || "");
  const used = new Set();
  const problems = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const refs = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    for (const n of refs) {
      used.add(n);
      const hit = hits[n - 1];
      if (!hit) {
        problems.push(`Ссылка [${n}] указывает на источник, которого нет.`);
        continue;
      }
      const words = tokenize(sentence.replace(/\[\d+\]/g, ""));
      if (words.length < 4) continue;
      const inSource = new Set(tokenize(hit.text));
      const overlap = words.filter((w) => inSource.has(w)).length / words.length;
      if (overlap < 0.34) {
        problems.push(
          `Ссылка [${n}] (${hit.name} · ${stamp(hit.from)}) слабо связана с тем, что рядом написано — проверьте по записи.`
        );
      }
    }
  }

  const claims = sentences.filter((s2) => s2.trim().length > 40 && !/\[\d+\]/.test(s2)).length;
  return {
    problems,
    unsupported: claims,
    used: [...used].sort((a, b) => a - b),
  };
}

/**
 * Сжатый звук для платной расшифровки.
 *
 * Несжатый wav из часа записи — под сотню мегабайт, и сервисы такое не берут.
 * Речь прекрасно живёт в opus на 24 кбит/с: час укладывается примерно в десять
 * мегабайт без потери разборчивости.
 */
function extractAudioCompressed(ffmpegBin, sourcePath, destPath) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegBin,
      ["-y", "-hide_banner", "-loglevel", "error", "-i", sourcePath,
       "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", destPath],
      { maxBuffer: 1 << 24 },
      (err) => (err ? reject(new Error(`Не удалось сжать звук: ${err.message}`)) : resolve(destPath))
    );
  });
}

/**
 * Платная расшифровка через сервис, совместимый с OpenAI.
 *
 * Включается только вручную: запись уходит на чужой сервер, а на записях бывают
 * клиентские дела. Приложение никогда не переключается на этот путь само — даже
 * если локальный движок не найден.
 */
async function transcribeRemote({ baseUrl, apiKey, model = "whisper-1", audioPath, language = "ru", fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Для платной расшифровки нужен ключ доступа.");
  const data = await fs.readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([data]), path.basename(audioPath));
  form.append("model", model);
  form.append("language", language);
  // srt просим сразу: он несёт время, а обычный текст — нет, и ссылки на минуту
  // потом взять было бы неоткуда.
  form.append("response_format", "srt");

  const url = `${String(baseUrl || "").replace(/\/$/, "")}/audio/transcriptions`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Сервис расшифровки ответил ${res.status}: ${body.slice(0, 300)}`);
  }
  return parseSrt(await res.text());
}

// ---------- хранение ----------
//
// В приложении остаётся только текст: расшифровка и куски. Сами записи лежат
// там, где лежали, и не копируются никуда.

function libraryDir(root) {
  return path.join(root, "library");
}

/** Имя файла расшифровки. От пути записи, чтобы переезд папки был заметен. */
function docId(filePath) {
  let h = 0;
  const s2 = String(filePath);
  for (let i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) >>> 0;
  return h.toString(36) + "-" + path.basename(filePath).replace(/[^\wа-яё.-]+/gi, "_").slice(0, 40);
}

async function readDoc(root, filePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(libraryDir(root), docId(filePath) + ".json"), "utf-8"));
  } catch {
    return null;
  }
}

async function writeDoc(root, doc) {
  const dir = libraryDir(root);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, docId(doc.path) + ".json"), JSON.stringify(doc, null, 1), "utf-8");
  return doc;
}

async function listDocs(root) {
  const dir = libraryDir(root);
  const names = await fs.readdir(dir).catch(() => []);
  const docs = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      docs.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")));
    } catch {
      // повреждённая расшифровка не должна ронять весь раздел
    }
  }
  return docs;
}

async function removeDoc(root, filePath) {
  await fs.rm(path.join(libraryDir(root), docId(filePath) + ".json"), { force: true });
}

module.exports = {
  VIDEO_EXT,
  AUDIO_EXT,
  MEDIA_EXT,
  CHUNK_SECONDS,
  CHUNK_OVERLAP,
  isMedia,
  kindOf,
  stamp,
  scanFolder,
  extractAudio,
  probeDuration,
  localEngineStatus,
  parseSrt,
  transcribeLocal,
  buildChunks,
  stem,
  tokenize,
  buildIndex,
  search,
  buildAnswerPrompt,
  verifyCitations,
  extractAudioCompressed,
  transcribeRemote,
  libraryDir,
  docId,
  readDoc,
  writeDoc,
  listDocs,
  removeDoc,
};
