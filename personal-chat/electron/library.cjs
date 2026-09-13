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
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

// Список расширений намеренно широкий. Короткий список — это не строгость, а
// молчаливый отказ: человек показывает папку, где записи очевидно есть, а
// приложение отвечает пустотой и ничего не объясняет. Сюда добавлено всё, что
// реально выходит из камер, диктофонов, телефонов и программ созвонов: MTS и
// M2TS с видеокамер, TS с регистраторов, 3GP и AMR с телефонов, MXF с
// профессиональной техники, M4B из аудиокниг, CAF с техники Apple.
const VIDEO_EXT = [
  ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".wmv", ".mpg", ".mpeg",
  ".mts", ".m2ts", ".m2t", ".ts", ".3gp", ".3g2", ".mxf", ".vob", ".f4v",
  ".flv", ".ogv", ".rm", ".rmvb", ".asf", ".divx", ".mpv", ".m4s",
];
const AUDIO_EXT = [
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma",
  ".m4b", ".aif", ".aiff", ".aifc", ".caf", ".amr", ".mka", ".weba", ".oga",
  ".ac3", ".dts", ".mp2", ".ape", ".wv", ".au", ".ra", ".voc", ".gsm",
];
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
 *
 * В `report` (если он передан) складывается то, чего в списке записей не видно:
 * сколько файлов всего просмотрено и какие расширения были пропущены. Без этого
 * пустой список неотличим от сломанного обхода — а именно так это и выглядело
 * со стороны: «при выборе папки не видит, есть ли там аудио или видео».
 */
async function scanFolder(root, { maxDepth = 8, maxFiles = 20000, report = null } = {}) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || found.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (report) report.unreadable.push({ dir, error: e && e.message ? e.message : String(e) });
      return;
    }
    if (report) report.folders++;
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      // Ярлык на папку — обычный приём в облачных папках: пропустить его
      // значит не увидеть половину записей.
      let directory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          directory = (await fs.stat(full)).isDirectory();
        } catch {
          continue;
        }
      }
      if (directory) {
        if (entry.name.startsWith(".")) continue;
        await walk(full, depth + 1);
      } else {
        if (report) report.seen++;
        if (!isMedia(entry.name)) {
          if (report) {
            const ext = path.extname(entry.name).toLowerCase() || "(без расширения)";
            report.other.set(ext, (report.other.get(ext) || 0) + 1);
          }
          continue;
        }
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

/** Пустая опись для scanFolder: что просмотрено и что пропущено. */
function newReport() {
  return { seen: 0, folders: 0, other: new Map(), unreadable: [] };
}

/**
 * Источники: и папки, и отдельные записи в одном списке.
 *
 * Раньше источник был один и только папкой. Это неудобно ровно в том случае,
 * ради которого раздел и заводят: одна длинная запись созвона лежит в
 * «Загрузках» среди сотни чужих файлов, и показывать всю папку целиком незачем.
 *
 * Заодно здесь честно считается, чего не нашлось: если в папке двести файлов и
 * ни одного знакомого расширения, человеку надо это сказать, а не показать
 * пустой список.
 */
async function scanSources(sources, opts = {}) {
  const report = newReport();
  const files = [];
  const known = new Set();
  const missing = [];
  for (const source of sources || []) {
    const target = typeof source === "string" ? source : source && source.path;
    if (!target) continue;
    let stat;
    try {
      stat = await fs.stat(target);
    } catch {
      missing.push(target);
      continue;
    }
    if (stat.isDirectory()) {
      for (const f of await scanFolder(target, { ...opts, report })) {
        if (known.has(f.path)) continue;
        known.add(f.path);
        files.push({ ...f, source: target });
      }
    } else {
      report.seen++;
      if (!isMedia(target)) {
        const ext = path.extname(target).toLowerCase() || "(без расширения)";
        report.other.set(ext, (report.other.get(ext) || 0) + 1);
        // Отдельно выбранный файл не того вида — это не «ничего не нашлось», а
        // прямая ошибка выбора, и сказать о ней надо именно так.
        missing.push(target);
        continue;
      }
      if (known.has(target)) continue;
      known.add(target);
      files.push({
        path: target,
        name: path.basename(target),
        folder: ".",
        kind: kindOf(target),
        bytes: stat.size,
        modified: stat.mtimeMs,
        source: target,
      });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return {
    files,
    missing,
    seen: report.seen,
    folders: report.folders,
    unreadable: report.unreadable,
    other: [...report.other.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([ext, count]) => ({ ext, count })),
  };
}

/**
 * Отпечаток записи — по содержимому, а не по пути.
 *
 * Расшифровка часа записи стоит часа работы, и терять её из-за того, что папку
 * переименовали или перенесли на другой диск, нельзя. Поэтому запись узнаётся по
 * размеру и по двум кускам содержимого — началу и концу. Читать файл целиком
 * незачем: два куска по сто двадцать восемь килобайт плюс точный размер
 * различают записи надёжно, а стоят миллисекунды даже на гигабайтном файле.
 */
async function fingerprint(filePath) {
  const stat = await fs.stat(filePath);
  const hash = crypto.createHash("sha1");
  hash.update(String(stat.size) + ":");
  const piece = 128 * 1024;
  const handle = await fs.open(filePath, "r");
  try {
    const headSize = Math.min(piece, stat.size);
    if (headSize > 0) {
      const head = Buffer.alloc(headSize);
      await handle.read(head, 0, headSize, 0);
      hash.update(head);
    }
    if (stat.size > piece * 2) {
      const tail = Buffer.alloc(piece);
      await handle.read(tail, 0, piece, stat.size - piece);
      hash.update(tail);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex").slice(0, 24);
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
  const marks = [];
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
    // Метки второй модели — отдельный, очень маленький слой поиска. Именно он
    // позволяет не перечитывать всё: сначала находим тему, потом читаем только
    // то, что внутри неё.
    for (const mark of doc.marks || []) {
      marks.push({
        file: doc.path,
        name: doc.name,
        from: mark.from,
        to: mark.to,
        title: mark.title,
        keywords: mark.keywords || [],
        tokens: tokenize(mark.title + " " + (mark.keywords || []).join(" ")),
      });
    }
  }
  const df = new Map();
  for (const c of chunks) {
    for (const t of new Set(c.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const markDf = new Map();
  for (const m of marks) {
    for (const t of new Set(m.tokens)) markDf.set(t, (markDf.get(t) || 0) + 1);
  }
  const avgLen = chunks.length ? chunks.reduce((s2, c) => s2 + c.tokens.length, 0) / chunks.length : 1;
  const markAvgLen = marks.length ? marks.reduce((s2, m) => s2 + m.tokens.length, 0) / marks.length : 1;
  return { chunks, df, avgLen, total: chunks.length, marks, markDf, markAvgLen, markTotal: marks.length };
}

/** Оценка BM25 одного набора записей — общая для кусков и для меток. */
function rank(entries, terms, { df, total, avgLen, limit }) {
  const k1 = 1.5;
  const b = 0.75;
  const scored = [];
  for (const entry of entries) {
    let score = 0;
    for (const term of new Set(terms)) {
      const tf = entry.tokens.filter((t) => t === term).length;
      if (!tf) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * entry.tokens.length) / avgLen)));
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b2) => b2.score - a.score);
  return scored.slice(0, limit).map((s2) => s2.entry);
}

function search(index, query, limit = 12) {
  const terms = tokenize(query);
  if (!terms.length || !index.chunks.length) return [];
  return rank(index.chunks, terms, { df: index.df, total: index.total, avgLen: index.avgLen, limit });
}

/**
 * Поиск в два шага: сначала по меткам, потом внутри найденных тем.
 *
 * Ради этого вторая модель и расставляет метки. Прямой поиск по кускам ищет
 * совпадение слов, а человек спрашивает про тему: «что решили по срокам» —
 * слова «решили» и «сроки» рассыпаны по всей записи, и в ответ лезут случайные
 * обрывки со всех двадцати часов. Метка же описывает кусок целиком, поэтому
 * сначала находится тема, а читается только то, что внутри неё.
 *
 * Если меток нет (записи ещё не разобраны) или тема не нашлась, работает обычный
 * поиск по кускам: раздел не должен переставать работать из-за того, что второй
 * шаг не сделан.
 */
function navigate(index, query, { markLimit = 5, limit = 12, minHits = 3 } = {}) {
  const terms = tokenize(query);
  if (!terms.length || !index.chunks.length) return { hits: [], marks: [], narrowed: false };
  const found = index.markTotal
    ? rank(index.marks, terms, {
        df: index.markDf,
        total: index.markTotal,
        avgLen: index.markAvgLen,
        limit: markLimit,
      })
    : [];
  if (found.length) {
    const inside = index.chunks.filter((c) =>
      found.some((m) => m.file === c.file && c.to > m.from && c.from < m.to)
    );
    const hits = rank(inside, terms, {
      df: index.df,
      total: index.total,
      avgLen: index.avgLen,
      limit,
    });
    // Метка нашлась, а внутри неё нужных слов нет — значит попали не в ту тему.
    // Тогда честнее вернуться к прямому поиску, чем отдать ответ по обрывкам.
    if (hits.length >= Math.min(minHits, inside.length)) {
      return { hits, marks: found, narrowed: true };
    }
  }
  return { hits: search(index, query, limit), marks: found, narrowed: false };
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
function buildAnswerPrompt({ question, hits, mode = "search", marks = [] }) {
  const sources = hits.map(
    (h, i) => `[${i + 1}] ${h.name} · ${stamp(h.from)}–${stamp(h.to)}\n${h.text}`
  );
  const task =
    mode === "retell"
      ? "Перескажи содержимое подробно и по порядку: о чём речь, какие мысли, какие решения."
      : "Ответь на вопрос.";
  // Путеводитель — это не источник, а карта: он говорит, ГДЕ лежит ответ, но
  // цитировать по нему нельзя, там только названия тем. Поэтому он вынесен
  // отдельным разделом и прямо назван картой.
  const guide = marks.length
    ? [
        "ГДЕ ИСКАТЬ (карта тем, не источник — ссылаться на неё нельзя):",
        ...marks.map((m) => `  ${m.name} · ${stamp(m.from)}–${stamp(m.to)} — ${m.title}`),
        "",
      ]
    : [];
  return [
    "Ты отвечаешь СТРОГО по расшифровкам записей, которые даны ниже. Ничего сверх них.",
    "",
    "ВОПРОС:",
    question,
    "",
    ...guide,
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

/**
 * Где лежат расшифровки.
 *
 * По умолчанию — в данных приложения. Но расшифровка это результат часов
 * работы, и держать её там, куда человек не заглядывает, неправильно: её хотят
 * унести на другой компьютер, положить в общую папку, забрать с собой. Поэтому
 * папку сохранения можно указать свою — тогда расшифровки лежат в ней, в
 * подпапке с понятным именем.
 */
function libraryDir(where) {
  if (where && typeof where === "object") {
    return where.vaultPath ? path.join(where.vaultPath, "Расшифровки") : path.join(where.root, "library");
  }
  return path.join(String(where), "library");
}

/** Имя описи внутри папки расшифровок. */
const INDEX_FILE = "опись.json";

/** Старое имя файла расшифровки — по пути записи. Читается ради совместимости. */
function docId(filePath) {
  let h = 0;
  const s2 = String(filePath);
  for (let i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) >>> 0;
  return h.toString(36) + "-" + path.basename(filePath).replace(/[^\wа-яё.-]+/gi, "_").slice(0, 40);
}

/**
 * Имя файла расшифровки. Если отпечаток известен — по нему: тогда переезд и
 * переименование записи не плодят второй расшифровки того же материала.
 */
function docFileName(doc) {
  return doc && doc.fingerprint ? "зв-" + doc.fingerprint + ".json" : docId(doc.path) + ".json";
}

/** Короткая запись описи: всё, что нужно списку файлов, без текста расшифровки. */
function indexEntry(doc, file) {
  return {
    file,
    fingerprint: doc.fingerprint || "",
    path: doc.path,
    name: doc.name,
    kind: doc.kind || "",
    seconds: doc.seconds || 0,
    chunks: (doc.chunks || []).length,
    marks: (doc.marks || []).length,
    engine: doc.engine || "",
    transcribedAt: doc.transcribedAt || 0,
    polishedAt: doc.polishedAt || 0,
    polishModel: doc.polishModel || "",
  };
}

/**
 * Опись расшифровок.
 *
 * Нужна затем, что список записей перечитывается при каждом заходе в раздел, а
 * сами расшифровки — это мегабайты текста на каждую запись. Читать их все ради
 * пометки «расшифровано» значило бы вешать раздел на сотне записей. Если описи
 * нет или она испорчена, она собирается заново из самих расшифровок — потерять
 * работу из-за одного повреждённого файла нельзя.
 */
async function readIndex(where) {
  const dir = libraryDir(where);
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(dir, INDEX_FILE), "utf-8"));
    if (Array.isArray(parsed && parsed.записи)) return parsed;
  } catch {
    // описи нет или она испорчена — соберём заново
  }
  return rebuildIndex(where);
}

async function writeIndex(where, index) {
  const dir = libraryDir(where);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, INDEX_FILE), JSON.stringify(index, null, 1), "utf-8");
  return index;
}

async function rebuildIndex(where) {
  const dir = libraryDir(where);
  const names = await fs.readdir(dir).catch(() => []);
  const записи = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === INDEX_FILE) continue;
    try {
      записи.push(indexEntry(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")), name));
    } catch {
      // повреждённая расшифровка не должна ронять весь раздел
    }
  }
  const index = { версия: 1, записи };
  if (names.length) await writeIndex(where, index).catch(() => {});
  return index;
}

/**
 * Найти уже готовую расшифровку.
 *
 * Сначала по отпечатку содержимого — так запись узнаётся даже после
 * переименования и переезда, — потом по пути, для расшифровок, сделанных до
 * появления отпечатков.
 */
async function findDoc(where, { path: filePath, fingerprint: fp } = {}) {
  const index = await readIndex(where);
  const entry =
    (fp && index.записи.find((e) => e.fingerprint === fp)) ||
    (filePath && index.записи.find((e) => e.path === filePath));
  if (entry) {
    try {
      return JSON.parse(await fs.readFile(path.join(libraryDir(where), entry.file), "utf-8"));
    } catch {
      return null;
    }
  }
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(libraryDir(where), docId(filePath) + ".json"), "utf-8"));
  } catch {
    return null;
  }
}

async function readDoc(where, filePath) {
  return findDoc(where, { path: filePath });
}

async function writeDoc(where, doc) {
  const dir = libraryDir(where);
  await fs.mkdir(dir, { recursive: true });
  const file = docFileName(doc);
  await fs.writeFile(path.join(dir, file), JSON.stringify(doc, null, 1), "utf-8");
  const index = await readIndex(where);
  const entry = indexEntry(doc, file);
  const at = index.записи.findIndex(
    (e) => (entry.fingerprint && e.fingerprint === entry.fingerprint) || e.file === file || e.path === entry.path
  );
  if (at >= 0) index.записи[at] = entry;
  else index.записи.push(entry);
  await writeIndex(where, index);
  return doc;
}

async function listDocs(where) {
  const dir = libraryDir(where);
  const names = await fs.readdir(dir).catch(() => []);
  const docs = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name === INDEX_FILE) continue;
    try {
      docs.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")));
    } catch {
      // повреждённая расшифровка не должна ронять весь раздел
    }
  }
  return docs;
}

async function removeDoc(where, filePath) {
  const dir = libraryDir(where);
  const index = await readIndex(where);
  const entry = index.записи.find((e) => e.path === filePath);
  await fs.rm(path.join(dir, entry ? entry.file : docId(filePath) + ".json"), { force: true });
  if (entry) {
    index.записи = index.записи.filter((e) => e !== entry);
    await writeIndex(where, index);
  }
  return true;
}

// ---------- вторая модель: разбор расшифровки ----------
//
// Расшифровщик слышит звук и больше ничего. Он не знает, что «Фейбл» — это
// название, а не «фейл», не ставит запятых по смыслу и не понимает, где кончилась
// одна тема и началась другая. Всё это умеет обычная языковая модель — но её
// незачем заставлять слушать звук, это другая работа и другая цена.
//
// Отсюда разделение: одна модель слушает, вторая читает. Вторая получает сырую
// расшифровку и возвращает две вещи:
//
//   1. ТЕКСТ в читаемом виде — с исправленными на слух ошибками, знаками
//      препинания и абзацами, но БЕЗ добавлений. Время у каждого куска остаётся
//      прежним, иначе ссылки перестанут вести куда надо.
//
//   2. МЕТКИ — оглавление по смыслу: с какой минуты по какую идёт какая тема и
//      какими словами её будут искать. Ради них всё и затевалось: на вопрос по
//      двадцати часам записей не нужно перечитывать двадцать часов, достаточно
//      найти нужные метки и прочитать только то, что внутри.
//
// Сырая расшифровка при этом НЕ ВЫБРАСЫВАЕТСЯ. Проверка ссылок идёт по ней:
// правленый текст — это пересказ пусть и близкий, а отвечать надо за то, что
// человек действительно услышит, открыв запись на этой минуте.

/** Столько знаков уходит в модель за один раз. */
const POLISH_PIECE_CHARS = 9000;

/**
 * Расшифровка режется на порции по размеру, а не по числу кусков.
 *
 * Часовая запись — это примерно пятьдесят тысяч знаков: целиком в один запрос
 * такое отправлять и дорого, и бессмысленно, ответ выйдет поверхностным. Резать
 * надо по границам кусков, чтобы ни одна фраза не разорвалась пополам.
 */
function polishPieces(doc, { maxChars = POLISH_PIECE_CHARS } = {}) {
  const chunks = (doc && doc.chunks) || [];
  const pieces = [];
  let current = null;
  for (const chunk of chunks) {
    if (!current || current.chars + chunk.text.length > maxChars) {
      current = { from: chunk.from, to: chunk.to, chunks: [], chars: 0 };
      pieces.push(current);
    }
    current.chunks.push(chunk);
    current.to = chunk.to;
    current.chars += chunk.text.length;
  }
  return pieces;
}

/**
 * Задание второй модели.
 *
 * Разметка ответа нарочно простая и построчная: любой формат посложнее модели
 * ломают на длинных текстах, а разобранный наполовину ответ хуже, чем никакой.
 * Время в метках сверяется потом с настоящей длительностью — выдуманную минуту
 * приложение выбросит само.
 */
function buildPolishPrompt(piece, { name = "запись", part = 1, parts = 1 } = {}) {
  const body = piece.chunks.map((c) => `[${stamp(c.from)}] ${c.text}`).join("\n");
  return [
    "Ты приводишь в порядок автоматическую расшифровку речи. Это НЕ пересказ и НЕ",
    "сочинение: ты работаешь только с тем, что сказано.",
    "",
    `ЗАПИСЬ: ${name}${parts > 1 ? ` (часть ${part} из ${parts})` : ""}`,
    `ОТРЕЗОК: ${stamp(piece.from)}–${stamp(piece.to)}`,
    "",
    "РАСШИФРОВКА (в квадратных скобках — время куска):",
    body,
    "",
    "Верни ровно два раздела и ничего больше.",
    "",
    "=== МЕТКИ ===",
    "По одной строке на смысловой отрезок, в формате:",
    "начало–конец | название темы | слова для поиска через запятую",
    "Время — как в расшифровке (0:00 или 1:02:30). Отрезков на этот кусок обычно",
    "от двух до шести: метка на каждую фразу бесполезна, одна метка на всё — тоже.",
    "Название — то, как человек сам назвал бы этот кусок, пересказывая: «смета на",
    "посёлок», «спор про сроки», а не «обсуждение вопросов».",
    "",
    "=== ТЕКСТ ===",
    "Та же речь в читаемом виде, по строкам вида [время] текст, время — из",
    "расшифровки, менять его нельзя.",
    "Что делать: расставить знаки препинания, убрать слова-паразиты и оговорки,",
    "исправить явно неверно расслышанные слова (имена, названия, числа) по смыслу",
    "соседних фраз.",
    "Чего не делать: НИЧЕГО НЕ ДОБАВЛЯТЬ и ничего не выбрасывать по смыслу. Если",
    "фраза непонятна — оставь как есть и поставь в конце (неразборчиво).",
  ].join("\n");
}

function parseStamp(text) {
  const m = /^(?:(\d+):)?(\d+):(\d+)$/.exec(String(text || "").trim());
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 3600 : 0) + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Разбор ответа второй модели.
 *
 * Здесь принято, что модель ошибётся: перепутает тире, придумает минуту за
 * пределами отрезка, начнёт ответ с вежливого предисловия. Всё, что не разобрано
 * или не попадает в отрезок, отбрасывается и считается — молча принять
 * выдуманное время значит получить ссылку в никуда.
 */
function parsePolish(answer, piece) {
  const text = String(answer || "").replace(/\r\n/g, "\n");
  const marksPart = /===\s*МЕТКИ\s*===([\s\S]*?)(?:===\s*ТЕКСТ\s*===|$)/i.exec(text);
  const textPart = /===\s*ТЕКСТ\s*===([\s\S]*)$/i.exec(text);
  const from = piece ? piece.from : 0;
  const to = piece ? piece.to : Number.MAX_SAFE_INTEGER;
  const slack = 60;

  const marks = [];
  let droppedMarks = 0;
  for (const line of String(marksPart ? marksPart[1] : "").split("\n")) {
    // Маркер списка снимается, а вот время снимать нельзя: первый вариант этой
    // строки срезал «0» у «0:00–1:30» и выбрасывал каждую метку, начинавшуюся
    // с нулевой минуты. Поэтому маркер обязан отделяться пробелом.
    const raw = line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
    if (!raw || raw.startsWith("===")) continue;
    const m = /^(\S+)\s*[–—−-]\s*(\S+)\s*\|\s*([^|]+?)\s*(?:\|\s*(.*))?$/.exec(raw);
    if (!m) {
      if (raw.includes("|")) droppedMarks++;
      continue;
    }
    const start = parseStamp(m[1]);
    const end = parseStamp(m[2]);
    const title = m[3].trim();
    if (start == null || end == null || !title || end <= start) {
      droppedMarks++;
      continue;
    }
    if (start < from - slack || start > to + slack) {
      droppedMarks++;
      continue;
    }
    marks.push({
      from: Math.max(from, start),
      to: Math.min(to, Math.max(end, start + 1)),
      title,
      keywords: String(m[4] || "")
        .split(/[,;]/)
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 12),
    });
  }
  marks.sort((a, b) => a.from - b.from);

  const clean = [];
  let droppedLines = 0;
  for (const line of String(textPart ? textPart[1] : "").split("\n")) {
    const raw = line.trim();
    if (!raw || raw.startsWith("===")) continue;
    const m = /^\[\s*([\d:]+)\s*\]\s*(.+)$/.exec(raw);
    if (!m) {
      // Строка без времени — продолжение предыдущей, а не мусор.
      if (clean.length && !/^(вот|готово|конечно|ниже)\b/i.test(raw)) clean[clean.length - 1].text += " " + raw;
      else droppedLines++;
      continue;
    }
    const at = parseStamp(m[1]);
    if (at == null || at < from - slack || at > to + slack) {
      droppedLines++;
      continue;
    }
    clean.push({ from: Math.max(from, at), text: m[2].trim() });
  }
  clean.sort((a, b) => a.from - b.from);

  return { marks, clean, droppedMarks, droppedLines };
}

/** Сшивает разбор порций в один: метки по порядку, текст по порядку. */
function mergePolish(parts) {
  const marks = [];
  const clean = [];
  let droppedMarks = 0;
  let droppedLines = 0;
  for (const part of parts || []) {
    marks.push(...(part.marks || []));
    clean.push(...(part.clean || []));
    droppedMarks += part.droppedMarks || 0;
    droppedLines += part.droppedLines || 0;
  }
  marks.sort((a, b) => a.from - b.from);
  clean.sort((a, b) => a.from - b.from);
  // Метки на стыке порций иногда налезают друг на друга — вторая половина
  // темы попадает и в конец одной порции, и в начало следующей.
  const merged = [];
  for (const mark of marks) {
    const last = merged[merged.length - 1];
    if (last && mark.from < last.to && mark.title.toLowerCase() === last.title.toLowerCase()) {
      last.to = Math.max(last.to, mark.to);
      last.keywords = [...new Set([...last.keywords, ...mark.keywords])].slice(0, 12);
      continue;
    }
    merged.push(mark);
  }
  return { marks: merged, clean, droppedMarks, droppedLines };
}

/** Оглавление записи — то, что видно человеку и уходит в путеводитель модели. */
function outline(doc) {
  return (doc.marks || []).map((m) => ({
    file: doc.path,
    name: doc.name,
    from: m.from,
    to: m.to,
    title: m.title,
    keywords: m.keywords || [],
  }));
}

/** Правленый текст одной записи — для чтения глазами. */
function cleanText(doc) {
  const lines = doc.clean || [];
  if (!lines.length) return (doc.chunks || []).map((c) => `[${stamp(c.from)}] ${c.text}`).join("\n\n");
  return lines.map((l) => `[${stamp(l.from)}] ${l.text}`).join("\n\n");
}

module.exports = {
  VIDEO_EXT,
  AUDIO_EXT,
  MEDIA_EXT,
  CHUNK_SECONDS,
  CHUNK_OVERLAP,
  POLISH_PIECE_CHARS,
  INDEX_FILE,
  isMedia,
  kindOf,
  stamp,
  parseStamp,
  scanFolder,
  scanSources,
  fingerprint,
  extractAudio,
  probeDuration,
  localEngineStatus,
  parseSrt,
  transcribeLocal,
  buildChunks,
  stem,
  tokenize,
  buildIndex,
  rank,
  search,
  navigate,
  buildAnswerPrompt,
  verifyCitations,
  extractAudioCompressed,
  transcribeRemote,
  polishPieces,
  buildPolishPrompt,
  parsePolish,
  mergePolish,
  outline,
  cleanText,
  libraryDir,
  docId,
  docFileName,
  readIndex,
  writeIndex,
  rebuildIndex,
  findDoc,
  readDoc,
  writeDoc,
  listDocs,
  removeDoc,
};
