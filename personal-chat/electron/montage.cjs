// Монтаж: таймлайн, чистка речи, клипы по смыслу и сборка ролика.
//
// Раздел устроен как CapCut: главная дорожка из кусков видео, дорожка текста,
// дорожка звука и субтитры по словам. Отличие одно и главное — монтажёр здесь
// ещё и агент: ему дают папку или файлы, он слушает, решает, что резать, и
// раскладывает это по тем же дорожкам, которые человек потом правит руками.
//
// Всё, что делает агент, выражается В ТЕХ ЖЕ КУСКАХ ТАЙМЛАЙНА, что и ручная
// работа. Вырезанное «э-э» — это не отдельный эффект поверх ролика, а просто
// граница между двумя кусками. Поэтому любое решение агента видно на дорожке и
// отменяется так же, как своё: растянуть кусок обратно.
//
// Логика нарезки по смыслу и проверки «клип понятен без контекста» перенесена
// из конвейера clip-factory OpenMontage (AGPL-3.0, calesthio/OpenMontage), порог
// и отступы тишины — из его silence_cutter.

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const fx = require("./montagefx.cjs");

// ---------- холст, фильтры, переходы ----------

const CANVAS_PRESETS = [
  { id: "9:16", name: "9:16 — Reels, Shorts, TikTok, Клипы ВК", width: 1080, height: 1920 },
  { id: "16:9", name: "16:9 — YouTube, презентация", width: 1920, height: 1080 },
  { id: "1:1", name: "1:1 — квадрат для ленты", width: 1080, height: 1080 },
  { id: "4:5", name: "4:5 — лента Instagram", width: 1080, height: 1350 },
  { id: "4:3", name: "4:3 — классика", width: 1440, height: 1080 },
];

/**
 * Как исходник встаёт в холст другой формы.
 * «Заполнить» режет края — для говорящей головы это обычно и нужно, а точку
 * кадрирования можно сдвинуть, чтобы лицо не уехало за край.
 */
const FIT_MODES = [
  { id: "crop", name: "Заполнить (обрезать края)" },
  { id: "blur", name: "Вписать на размытом фоне" },
  { id: "fit", name: "Вписать с полями" },
];

// Фильтры, переходы и стили субтитров живут в montagefx.cjs вместе с тем, как
// их показывает предпросмотр: одна таблица на сборку и на окно.
const FILTERS = fx.FILTERS;
const TRANSITIONS = fx.TRANSITIONS;
const CAPTION_STYLES = fx.CAPTION_STYLES;

/** Стили надписей поверх ролика. */
const TEXT_STYLES = [
  { id: "hook", name: "Хук (плашка сверху)" },
  { id: "title", name: "Заголовок по центру" },
  { id: "lower", name: "Подпись снизу" },
  { id: "label", name: "Метка" },
  { id: "plain", name: "Простой текст" },
];

const TEXT_ANIMATIONS = [
  { id: "pop", name: "Выпрыгивает" },
  { id: "fade", name: "Проявляется" },
  { id: "slide", name: "Выезжает снизу" },
  { id: "type", name: "Печатается" },
  { id: "none", name: "Без анимации" },
];

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts", ".m2ts", ".ts", ".3gp", ".wmv", ".mxf", ".flv", ".mpg", ".mpeg"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma", ".amr"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);

function mediaKind(file) {
  const ext = path.extname(String(file || "")).toLowerCase();
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (IMAGE_EXT.has(ext)) return "image";
  return "";
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const round3 = (v) => Math.round(v * 1000) / 1000;

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------- слова и паразиты ----------

/**
 * Звуки-заполнители: «э-э», «м-м», «а-а». Их режем всегда — смысла в них нет.
 *
 * Одиночное «а» сюда не входит нарочно: «а потом», «а если» — союз, и вырезать
 * его значит ломать фразу. Заполнителем считается только растянутое «аа».
 */
const SOUND_FILLER = /^(э+|ээ+м*|э+м+|а{2,}|а+м+|м{2,}|мм+|хм+|гм+|ам+|эх+|ой+-?ой|uh+|um+|erm+|hmm+|ah{2,})$/i;

/**
 * Слова-паразиты. В отличие от звуков, они бывают и нужными словами: «вот
 * почему», «ну конечно», «как бы ты поступил». Поэтому механически режутся
 * только безопасные (режим «safe»), а остальные решает агент по смыслу.
 */
const WORD_FILLERS_SAFE = ["типа", "короче", "как бы", "это самое", "так сказать", "в общем-то", "ну вот", "собственно говоря", "скажем так", "грубо говоря"];
const WORD_FILLERS_MAYBE = ["ну", "вот", "значит", "в общем", "в принципе", "собственно", "кстати", "слушай", "смотри", "понимаешь", "знаешь", "реально", "прям", "просто", "блин"];

/** Слово без пунктуации и в нижнем регистре — для сравнения, не для показа. */
function normWord(w) {
  return String(w || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/^-+|-+$/g, "");
}

/** Текст куска в слова. Пунктуация остаётся при слове — она нужна субтитрам. */
function splitWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => normWord(w) || /\d/.test(w));
}

/**
 * Время слов внутри куска, когда распознавание дало время только куску.
 *
 * Слова раскладываются не по всему куску, а только по тем его участкам, где
 * звучит речь: тишина внутри куска из расчёта выбрасывается. Иначе пауза в
 * середине фразы размазалась бы по словам, и граница реза пришлась бы на
 * середину слова. Длина слова — по числу букв плюс постоянная добавка: короткие
 * слова произносятся не пропорционально короче.
 */
function layoutWords(words, from, to, silences = []) {
  if (!words.length) return [];
  const speech = [];
  let cursor = from;
  for (const s of silences) {
    if (s.end <= from || s.start >= to) continue;
    if (s.start > cursor) speech.push([cursor, Math.min(s.start, to)]);
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < to) speech.push([cursor, to]);
  const speechTotal = speech.reduce((a, [s, e]) => a + (e - s), 0);
  // Кусок целиком попал в «тишину» — значит, порог задан грубо; раскладываем по всему куску.
  const spans = speechTotal > 0.05 ? speech : [[from, to]];
  const total = spans.reduce((a, [s, e]) => a + (e - s), 0);
  const weights = words.map((w) => normWord(w).length + 2);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  // Позиция на «речевой» оси → настоящее время.
  const toTime = (x) => {
    let left = x;
    for (const [s, e] of spans) {
      const len = e - s;
      if (left <= len + 1e-9) return s + left;
      left -= len;
    }
    return spans[spans.length - 1][1];
  };
  const out = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const a = (acc / sum) * total;
    acc += weights[i];
    const b = (acc / sum) * total;
    out.push({ w: words[i], s: round3(toTime(a)), e: round3(toTime(b)) });
  }
  return out;
}

/**
 * Слова, где у распознавания было время по словам: подрезаем хвосты, уходящие
 * в тишину. Whisper часто растягивает последнее слово фразы на всю паузу после
 * него, и рез «после слова» тогда оставлял бы паузу целиком.
 */
function trimIntoSilence(words, silences = []) {
  return words.map((word) => {
    let { s, e } = word;
    for (const sil of silences) {
      if (sil.start > s && sil.start < e && sil.end >= e - 0.02) e = sil.start;
      if (sil.end > s && sil.end < e && sil.start <= s + 0.02) s = sil.end;
    }
    return { ...word, s: round3(s), e: round3(Math.max(e, s + 0.04)) };
  });
}

/**
 * Пометить заполнители и повторы.
 *  - filler: "sound" — «э-э», режется всегда;
 *  - filler: "word" — безопасный паразит («типа», «короче»);
 *  - filler: "maybe" — возможно паразит, решает агент;
 *  - repeat: true — запинка: то же слово сразу ещё раз («я я думаю»).
 */
function markFillers(words) {
  const out = words.map((w) => ({ ...w, filler: undefined, repeat: undefined }));
  const norms = out.map((w) => normWord(w.w));
  for (let i = 0; i < out.length; i++) {
    const n = norms[i];
    if (!n) continue;
    if (SOUND_FILLER.test(n.replace(/-/g, ""))) {
      out[i].filler = "sound";
      continue;
    }
    // Многословные паразиты сверяются по склеенным соседям.
    for (const list of [WORD_FILLERS_SAFE, WORD_FILLERS_MAYBE]) {
      for (const phrase of list) {
        const parts = phrase.split(" ");
        if (parts.every((p, k) => norms[i + k] === p)) {
          const kind = list === WORD_FILLERS_SAFE ? "word" : "maybe";
          for (let k = 0; k < parts.length; k++) if (!out[i + k].filler) out[i + k].filler = kind;
        }
      }
    }
    // Запинка: то же слово подряд и почти без паузы. Режем первое — второе обычно
    // сказано уверенно и с правильной интонацией.
    const next = norms[i + 1];
    if (next && next === n && n.length <= 12 && out[i + 1].s - out[i].e < 0.6) out[i].repeat = true;
  }
  return out;
}

/**
 * Слова записи из того, что вернуло распознавание.
 * @param {{segments?: {from:number,to:number,text:string}[], words?: {w:string,s:number,e:number}[]}} asr
 * @param {{start:number,end:number}[]} silences
 */
function buildWords(asr, silences = []) {
  let words;
  let wordLevel = false;
  if (Array.isArray(asr.words) && asr.words.length) {
    wordLevel = true;
    words = trimIntoSilence(
      asr.words
        .map((w) => ({ w: String(w.w ?? w.word ?? w.text ?? "").trim(), s: num(w.s ?? w.start, 0), e: num(w.e ?? w.end, 0) }))
        .filter((w) => w.w),
      silences
    );
  } else {
    words = [];
    for (const seg of asr.segments || []) {
      words.push(...layoutWords(splitWords(seg.text), num(seg.from, 0), num(seg.to, 0), silences));
    }
  }
  words.sort((a, b) => a.s - b.s);
  return { words: markFillers(words), wordLevel };
}

/** Разбор вывода silencedetect. */
function parseSilences(stderr, total = Infinity) {
  const out = [];
  let start = null;
  for (const line of String(stderr || "").split(/\r?\n/)) {
    const a = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (a) start = Math.max(0, Number(a[1]));
    const b = line.match(/silence_end:\s*([\d.]+)/);
    if (b && start !== null) {
      out.push({ start: round3(start), end: round3(Number(b[1])) });
      start = null;
    }
  }
  // Тишина до самого конца файла не закрывается строкой silence_end.
  if (start !== null && Number.isFinite(total)) out.push({ start: round3(start), end: round3(total) });
  return out;
}

// ---------- что оставить ----------

const CLEANUP_DEFAULTS = {
  // Отступы вокруг слова, чтобы не съесть первую и последнюю согласную.
  padBefore: 0.06,
  padAfter: 0.09,
  // Пауза длиннее этой — режется, от неё остаётся keepPause.
  maxPause: 0.35,
  keepPause: 0.14,
  removeSound: true,
  removeWords: "safe", // safe | all | none
  removeRepeats: true,
  // Слишком короткий кусок между резами — скорее щелчок, чем речь.
  minPiece: 0.25,
};

/**
 * Режется ли слово при чистке.
 * @param {Set<number>} cutSet — номера слов, которые вырезал человек или агент
 */
function isCut(word, index, cutSet, opts) {
  if (cutSet && cutSet.has(index)) return true;
  if (word.keep) return false;
  if (opts.removeSound && word.filler === "sound") return true;
  if (opts.removeWords !== "none" && word.filler === "word") return true;
  if (opts.removeWords === "all" && word.filler === "maybe") return true;
  if (opts.removeRepeats && word.repeat) return true;
  return false;
}

/**
 * Куски записи, которые остаются после чистки, — в секундах исходника.
 *
 * Работает по словам, а не по громкости: громкость не отличает «э-э» от слова,
 * а по словам видно и паразита, и паузу между ними. Длинная пауза не
 * выбрасывается целиком, от неё остаётся короткий вдох — без него речь
 * склеивается в сплошной поток и звучит как ускоренная.
 *
 * @param {Array<{w:string,s:number,e:number}>} words
 * @param {{from?:number,to?:number,cut?:Set<number>}} range
 */
function planKeeps(words, range = {}, options = {}) {
  const opts = { ...CLEANUP_DEFAULTS, ...options };
  const from = num(range.from, -Infinity);
  const to = num(range.to, Infinity);
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.e <= from || w.s >= to) continue;
    if (isCut(w, i, range.cut, opts)) continue;
    kept.push({ i, s: Math.max(w.s, from), e: Math.min(w.e, to) });
  }
  const pieces = [];
  for (let k = 0; k < kept.length; k++) {
    const w = kept[k];
    const prev = kept[k - 1];
    // Соседи по записи (без вырезанного между ними) и пауза короткая — один кусок.
    const adjacent = prev && w.i === prev.i + 1;
    const gap = prev ? w.s - prev.e : Infinity;
    const last = pieces[pieces.length - 1];
    if (last && adjacent && gap <= opts.maxPause) {
      last.to = w.e + opts.padAfter;
      last.lastWord = w.i;
      continue;
    }
    if (last && adjacent && gap > opts.maxPause) {
      // Длинная пауза между соседями: оставить короткий вдох, поделив его поровну.
      const half = opts.keepPause / 2;
      last.to = Math.min(prev.e + Math.max(opts.padAfter, half), w.s);
      pieces.push({ from: Math.max(w.s - Math.max(opts.padBefore, half), last.to), to: w.e + opts.padAfter, firstWord: w.i, lastWord: w.i });
      continue;
    }
    // Между кусками было вырезанное слово: рез ровно по краям слов, без пауз.
    if (last) last.to = Math.min(last.to, prev.e + opts.padAfter, w.s);
    pieces.push({ from: Math.max(w.s - opts.padBefore, last ? last.to : -Infinity, from === -Infinity ? 0 : from - opts.padBefore, 0), to: w.e + opts.padAfter, firstWord: w.i, lastWord: w.i });
  }
  // Отступ после последнего слова не должен залезать на следующее, которое вырезано.
  for (const p of pieces) {
    const after = words[p.lastWord + 1];
    if (after && isCut(after, p.lastWord + 1, range.cut, opts)) p.to = Math.min(p.to, Math.max(after.s, words[p.lastWord].e));
    const before = words[p.firstWord - 1];
    if (before && isCut(before, p.firstWord - 1, range.cut, opts)) p.from = Math.max(p.from, Math.min(before.e, words[p.firstWord].s));
    if (Number.isFinite(to)) p.to = Math.min(p.to, to + opts.padAfter);
  }
  return pieces
    .map((p) => ({ ...p, from: round3(Math.max(0, p.from)), to: round3(p.to) }))
    .filter((p) => p.to - p.from >= opts.minPiece);
}

/** Сколько секунд убирает чистка — показывается человеку до того, как он нажал. */
function cleanupStats(words, range, options) {
  const pieces = planKeeps(words, range, options);
  const opts = { ...CLEANUP_DEFAULTS, ...options };
  const start = Number.isFinite(range?.from) ? range.from : words.length ? words[0].s : 0;
  const end = Number.isFinite(range?.to) ? range.to : words.length ? words[words.length - 1].e : 0;
  let sound = 0;
  let word = 0;
  let repeats = 0;
  words.forEach((w, i) => {
    if (w.e <= start || w.s >= end || !isCut(w, i, range?.cut, opts)) return;
    if (w.filler === "sound") sound++;
    else if (w.filler) word++;
    else if (w.repeat) repeats++;
  });
  const keptSeconds = pieces.reduce((a, p) => a + (p.to - p.from), 0);
  return {
    pieces: pieces.length,
    before: round3(Math.max(0, end - start)),
    after: round3(keptSeconds),
    removedSounds: sound,
    removedWords: word,
    removedRepeats: repeats,
  };
}

// ---------- таймлайн ----------

const SPEED_MIN = 0.25;
const SPEED_MAX = 4;

function defaultCaptions() {
  return {
    enabled: false,
    style: "karaoke",
    font: "",
    fontPath: "",
    size: 72,
    color: "#FFFFFF",
    highlight: "#FFD400",
    outline: "#000000",
    position: "bottom", // bottom | center | top
    upper: false,
    wordsPerLine: 4,
  };
}

function normalizeEffects(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && fx.EFFECTS.some((x) => x.id === e.kind))
    .map((e) => ({ id: e.id || uid("fx"), kind: e.kind, amount: clamp(num(e.amount, 0.5), 0, 1) }));
}

function normalizeAdjust(adj = {}) {
  return {
    brightness: clamp(num(adj.brightness, 0), -0.5, 0.5),
    contrast: clamp(num(adj.contrast, 1), 0.5, 2),
    saturation: clamp(num(adj.saturation, 1), 0, 3),
    filter: FILTERS.some((f) => f.id === adj.filter) ? adj.filter : "none",
    // Сила фильтра: 1 — как задуман, меньше — смешан с исходником.
    filterAmount: clamp(num(adj.filterAmount, 1), 0, 1),
    lut: typeof adj.lut === "string" ? adj.lut : "",
    // Профессиональная коррекция — как в Lightroom/CapCut Pro: экспозиция в
    // ступенях, температура и оттенок, сочность, света и тени, резкость,
    // чёткость (локальный контраст), виньетка, шумоподавление и зерно.
    exposure: clamp(num(adj.exposure, 0), -2, 2),
    temperature: clamp(num(adj.temperature, 0), -1, 1),
    tint: clamp(num(adj.tint, 0), -1, 1),
    vibrance: clamp(num(adj.vibrance, 0), -1, 1),
    highlights: clamp(num(adj.highlights, 0), -1, 1),
    shadows: clamp(num(adj.shadows, 0), -1, 1),
    sharpness: clamp(num(adj.sharpness, 0), 0, 1),
    clarity: clamp(num(adj.clarity, 0), 0, 1),
    vignette: clamp(num(adj.vignette, 0), 0, 1),
    denoise: clamp(num(adj.denoise, 0), 0, 1),
    grain: clamp(num(adj.grain, 0), 0, 1),
  };
}

/**
 * Коррекция кадра фильтрами ffmpeg. Порядок как в проявке: сначала шум
 * (чтобы резкость не усиливала его), потом свет и цвет, локальный контраст,
 * резкость и в самом конце виньетка и зерно.
 */
function gradeChain(a) {
  const out = [];
  const r = round3;
  if (a.denoise > 0.01) out.push(`hqdn3d=${r(1 + a.denoise * 5)}:${r(1 + a.denoise * 4)}:${r(2 + a.denoise * 7)}:${r(2 + a.denoise * 6)}`);
  if (Math.abs(a.exposure) > 0.005) out.push(`exposure=exposure=${r(a.exposure)}`);
  if (Math.abs(a.temperature) > 0.005) out.push(`colortemperature=temperature=${Math.round(6500 - a.temperature * 3000)}:mix=1:pl=1`);
  if (Math.abs(a.tint) > 0.005) out.push(`colorchannelmixer=gg=${r(1 - a.tint * 0.12)}:rr=${r(1 + Math.max(0, a.tint) * 0.04)}:bb=${r(1 + Math.max(0, a.tint) * 0.04)}`);
  if (Math.abs(a.highlights) > 0.005 || Math.abs(a.shadows) > 0.005) {
    const sh = clamp(0.25 + a.shadows * 0.13, 0.05, 0.45);
    const hl = clamp(0.75 + a.highlights * 0.13, 0.55, 0.95);
    out.push(`curves=master='0/0 0.25/${r(sh)} 0.75/${r(hl)} 1/1'`);
  }
  if (Math.abs(a.vibrance) > 0.005) out.push(`vibrance=intensity=${r(a.vibrance)}`);
  if (a.clarity > 0.01) out.push(`unsharp=lx=13:ly=11:la=${r(a.clarity * 0.9)}:cx=3:cy=3:ca=0`);
  if (a.sharpness > 0.01) out.push(`unsharp=lx=5:ly=5:la=${r(a.sharpness * 1.6)}:cx=3:cy=3:ca=0`);
  if (a.vignette > 0.01) out.push(`vignette=angle=${r(0.25 + a.vignette * 0.75)}`);
  if (a.grain > 0.01) out.push(`noise=alls=${Math.round(4 + a.grain * 22)}:allf=t`);
  return out;
}

/**
 * Моушн — анимированная композиция (HTML + GSAP): ролик ИИ-моушна или
 * заготовка титра. Хранится кодом и рендерится перед сборкой в обычный файл.
 * template + fields — заготовка (код строится заново при каждом рендере),
 * иначе html — код, написанный моделью.
 */
function normalizeMotion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const fields = raw.fields && typeof raw.fields === "object" ? Object.fromEntries(Object.entries(raw.fields).map(([k, v]) => [k, String(v ?? "")])) : {};
  const assets = raw.assets && typeof raw.assets === "object" ? Object.fromEntries(Object.entries(raw.assets).filter(([k, v]) => /^[\w.-]+$/.test(k) && typeof v === "string")) : {};
  return {
    html: String(raw.html || ""),
    template: String(raw.template || ""),
    fields,
    duration: clamp(num(raw.duration, 5), 0.2, 600),
    transparent: !!raw.transparent,
    designDir: String(raw.designDir || ""),
    // Шрифтовая пара (id из библиотеки) или "ds" — шрифты дизайн-системы.
    pair: String(raw.pair || ""),
    title: String(raw.title || ""),
    storyboard: Array.isArray(raw.storyboard) ? raw.storyboard.map(String).slice(0, 30) : [],
    assets,
  };
}

function normalizeClip(raw = {}) {
  const motion = raw.kind === "motion" ? normalizeMotion(raw.motion) : null;
  const kind = motion ? "motion" : raw.kind === "motion" ? "video" : raw.kind || mediaKind(raw.src) || "video";
  const inn = Math.max(0, num(raw.in, 0));
  const out = Math.max(inn + 0.05, num(raw.out, inn + (kind === "image" ? 3 : motion ? motion.duration : 1)));
  const tr = raw.transition || {};
  const id = raw.id || uid("clip");
  return {
    id,
    src: String(raw.src || (motion ? `motion://${id}` : "")),
    kind,
    ...(motion ? { motion } : {}),
    in: round3(inn),
    out: round3(out),
    speed: clamp(num(raw.speed, 1), SPEED_MIN, SPEED_MAX),
    volume: clamp(num(raw.volume, 1), 0, 4),
    muted: !!raw.muted,
    fadeIn: clamp(num(raw.fadeIn, 0), 0, 5),
    fadeOut: clamp(num(raw.fadeOut, 0), 0, 5),
    // Переход В этот кусок из предыдущего.
    transition: { kind: TRANSITIONS.some((t) => t.id === tr.kind) ? tr.kind : "none", duration: clamp(num(tr.duration, 0.4), 0.1, 2) },
    fit: FIT_MODES.some((f) => f.id === raw.fit) ? raw.fit : "",
    focusX: clamp(num(raw.focusX, 0.5), 0, 1),
    focusY: clamp(num(raw.focusY, 0.5), 0, 1),
    zoom: clamp(num(raw.zoom, 1), 1, 3),
    adjust: normalizeAdjust(raw.adjust),
    effects: normalizeEffects(raw.effects),
    // Положение, масштаб, поворот и прозрачность кадра — и их ключевые точки
    // (время — от начала куска на выходе).
    transform: fx.normalizeTransform(raw.transform),
    keyframes: fx.normalizeKeyframes(raw.keyframes),
    reverse: !!raw.reverse,
    audioEffect: fx.AUDIO_FX.some((a) => a.id === raw.audioEffect) ? raw.audioEffect : "none",
    // Водяные знаки, которые нужно убрать: прямоугольники в долях кадра исходника.
    erase: normalizeErase(raw.erase),
    bgRemove: kind === "video" || kind === "image" ? normalizeBg(raw.bgRemove, false) : null,
    label: String(raw.label || ""),
  };
}

/**
 * Удаление фона нейросетью. cache — готовая маска и вид для предпросмотра
 * (пути) с ключом настроек: сменились границы куска или настройки — маску
 * надо посчитать заново.
 */
function normalizeBg(raw, isLayer) {
  if (!raw || typeof raw !== "object" || !raw.enabled) return null;
  const replace = isLayer ? "transparent" : ["blur", "color", "image", "transparent"].includes(raw.replace) ? raw.replace : "blur";
  return {
    enabled: true,
    model: raw.model === "object" ? "object" : "person",
    quality: ["fast", "good", "best"].includes(raw.quality) ? raw.quality : "good",
    replace: !isLayer && replace === "transparent" ? "blur" : replace,
    color: /^#[0-9a-f]{6}$/i.test(raw.color || "") ? raw.color : "#00B140",
    image: String(raw.image || ""),
    soft: clamp(num(raw.soft, 0.5), 0, 1),
    cache: raw.cache && typeof raw.cache === "object" ? { key: String(raw.cache.key || ""), mask: String(raw.cache.mask || ""), preview: String(raw.cache.preview || "") } : null,
  };
}

/** Ключ настроек маски: те же — маска годится. */
function bgKey(item) {
  const b = item.bgRemove;
  return b ? [item.src, round3(item.in), round3(item.out), b.model, b.quality].join("|") : "";
}

function normalizeErase(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const x = clamp(num(r && r.x, 0), 0, 1);
      const y = clamp(num(r && r.y, 0), 0, 1);
      return {
        x,
        y,
        w: clamp(num(r && r.w, 0), 0, 1 - x),
        h: clamp(num(r && r.h, 0), 0, 1 - y),
        mode: r && r.mode === "smooth" ? "smooth" : "clone",
        from: ["left", "right", "up", "down"].includes(r && r.from) ? r.from : "auto",
      };
    })
    .filter((r) => r.w > 0.003 && r.h > 0.003)
    .slice(0, 8);
}

/**
 * Удаление водяного знака — граф ffmpeg на кадре исходника (до кадрирования).
 *
 * «clone» — заплатка из соседнего участка того же кадра, отражённая зеркально:
 * у шва со стороны источника пиксели продолжают сами себя, и текстура (трава,
 * стена, небо, ткань) остаётся живой, без мыльного пятна. Края заплатки мягкие,
 * но мягкая полоса лежит снаружи знака, на чистом фоне, — внутри знака замена
 * полная, ни контура, ни призрака. «smooth» — классическое заполнение по краям
 * (delogo): для мелких знаков на ровном фоне.
 */
function eraseGraph(erase, W, H, inLabel, outLabel) {
  const even = (v) => Math.max(0, Math.round(v / 2) * 2);
  const parts = [];
  let cur = inLabel;
  erase.forEach((r, i) => {
    const last = i === erase.length - 1;
    const next = last ? outLabel : `[er${i}]`;
    const x = even(r.x * W);
    const y = even(r.y * H);
    const w = Math.max(4, even(r.w * W));
    const h = Math.max(4, even(r.h * H));
    // delogo требует полосу хотя бы в пиксель от края кадра.
    const dx = Math.min(Math.max(1, x), W - 3);
    const dy = Math.min(Math.max(1, y), H - 3);
    const dw = Math.max(2, Math.min(w, W - 2 - dx));
    const dh = Math.max(2, Math.min(h, H - 2 - dy));
    const delogo = `delogo=x=${dx}:y=${dy}:w=${dw}:h=${dh}`;
    if (r.mode === "smooth") {
      parts.push(`${cur}${delogo}${next}`);
      cur = next;
      return;
    }
    const F = Math.max(4, even(Math.min(w, h) * 0.18));
    const ex = Math.max(0, x - F);
    const ey = Math.max(0, y - F);
    const ew = Math.min(W - ex, w + 2 * F);
    const eh = Math.min(H - ey, h + 2 * F);
    let from = r.from;
    if (from === "auto") {
      // Фон берём с ближней стороны, где хватает места: у широкого знака —
      // сверху или снизу (сдвиг на его высоту), у высокого — сбоку.
      const room = { left: ex, right: W - (ex + ew), up: ey, down: H - (ey + eh) };
      const horiz = Math.max(room.left, room.right) >= ew ? (room.left >= room.right ? "left" : "right") : "";
      const vert = Math.max(room.up, room.down) >= eh ? (room.up >= room.down ? "up" : "down") : "";
      from = horiz && (!vert || ew / W <= eh / H) ? horiz : vert || horiz || (room.left >= room.right ? "left" : "right");
    }
    let sx = ex;
    let sy = ey;
    if (from === "left") sx = ex - ew;
    if (from === "right") sx = ex + ew;
    if (from === "up") sy = ey - eh;
    if (from === "down") sy = ey + eh;
    sx = Math.min(Math.max(0, even(sx)), W - ew);
    sy = Math.min(Math.max(0, even(sy)), H - eh);
    const flip = from === "left" || from === "right" ? "hflip," : "vflip,";
    const S = Math.max(3, Math.round(Math.min(w, h) * 0.3));
    const alpha = `255*clip(min(min(X,W-1-X),min(Y,H-1-Y))/${F},0,1)`;
    // Частотное разделение: мелкая текстура — из соседней заплатки, а цвет и
    // яркость — из плавного заполнения по краям знака. Тогда заплатка не
    // выделяется ни на градиенте неба, ни на виньетке, ни на спаде света.
    parts.push(
      `${cur}split=3[eb${i}][es${i}][ed${i}]`,
      `[ed${i}]${delogo},crop=${ew}:${eh}:${ex}:${ey},format=gbrp,gblur=sigma=${S}[el${i}]`,
      `[es${i}]crop=${ew}:${eh}:${sx}:${sy},${flip}format=gbrp,split[ea${i}][ec${i}]`,
      `[ec${i}]gblur=sigma=${S}[eg${i}]`,
      `[ea${i}][eg${i}]blend=all_expr='clip(A-B+128,0,255)'[eh${i}]`,
      `[eh${i}][el${i}]blend=all_expr='clip(A+B-128,0,255)',format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[ep${i}]`,
      `[eb${i}][ep${i}]overlay=${ex}:${ey}:format=auto${next}`
    );
    cur = next;
  });
  return parts.join(";");
}

const LAYER_TRANSFORM = { x: 0.5, y: 0.5, scale: 0.45, rotation: 0, opacity: 1 };

/** Формы маски слоя. Картинки форм — в папке masks (белая форма на чёрном). */
const LAYER_MASKS = ["none", "circle", "rounded", "rect", "oval", "heart", "star", "hexagon", "arch", "diamond", "blob", "triangle", "squircle"];
const MASK_FILES = { circle: "circle.png", heart: "heart.png", star: "star.png", hexagon: "hexagon.png", arch: "arch.png", diamond: "diamond.png", blob: "blob.png", triangle: "triangle.png", squircle: "squircle.png", oval: "circle.png" };
function masksDir() {
  return path.join(__dirname, "..", "masks").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

/**
 * Маска слоя файлами под точный размер кадра слоя: форма (с мягким краем) и
 * кольцо обводки по внутреннему краю. Обычный круг и скругление без обводки и
 * мягкости по-прежнему считаются выражением прямо в графе.
 */
async function prepareMask(bin, layer, w, h, workDir, idx) {
  const needsFile = layer.mask !== "none" && (layer.maskFeather > 0 || layer.maskStroke > 0 || !["circle", "rounded"].includes(layer.mask));
  if (!needsFile) return null;
  const base = path.join(workDir, `mask-base-${idx}.png`);
  const out = path.join(workDir, `mask-${idx}.png`);
  const minSide = Math.min(w, h);
  if (layer.mask === "rounded" || layer.mask === "rect") {
    const R = layer.mask === "rect" ? 0 : Math.round(minSide * 0.12);
    const expr = R ? `255*if(gt(abs(X-W/2),W/2-${R})*gt(abs(Y-H/2),H/2-${R}),lte(hypot(abs(X-W/2)-(W/2-${R}),abs(Y-H/2)-(H/2-${R})),${R}),1)` : "255";
    await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${w}x${h}`, "-vf", `format=gray,geq=lum='${expr}'`, "-frames:v", "1", base]);
  } else {
    const file = path.join(masksDir(), MASK_FILES[layer.mask] || "circle.png");
    // Овал тянется на весь кадр слоя, остальные формы — сохраняют пропорции.
    const fit = layer.mask === "oval" ? `scale=${w}:${h}` : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black`;
    await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-i", file, "-vf", `${fit},format=gray`, "-frames:v", "1", base]);
  }
  const feather = Math.round(layer.maskFeather * minSide);
  await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-i", base, "-vf", feather > 0 ? `gblur=sigma=${Math.max(1, feather / 2)}` : "null", "-frames:v", "1", out]);
  let stroke = null;
  const sw = Math.round(layer.maskStroke * (minSide / 1080) * 2.2);
  if (sw > 0) {
    // Кольцо = форма минус форма, «съеденная» на толщину обводки.
    stroke = path.join(workDir, `mask-stroke-${idx}.png`);
    const erode = Array.from({ length: Math.min(60, sw) }, () => "erosion").join(",");
    await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-i", base, "-filter_complex", `[0]format=gray,split[a][b];[b]pad=iw+2:ih+2:1:1:black,${erode},crop=iw-2:ih-2:1:1[e];[a][e]blend=all_mode=subtract`, "-frames:v", "1", stroke]);
  }
  return { mask: out, stroke, color: layer.maskStrokeColor };
}

/**
 * Слой поверх главной дорожки — картинка в картинке, стикер, логотип,
 * перебивка с хромакеем. scale — ширина слоя в долях ширины кадра.
 */
function normalizeLayer(raw = {}) {
  const motion = raw.kind === "motion" ? normalizeMotion(raw.motion) : null;
  const kind = motion ? "motion" : raw.kind === "motion" ? "video" : raw.kind || mediaKind(raw.src) || "video";
  const inn = Math.max(0, num(raw.in, 0));
  const out = Math.max(inn + 0.1, num(raw.out, inn + (kind === "image" ? 3 : motion ? motion.duration : 5)));
  const ch = raw.chroma || {};
  const id = raw.id || uid("layer");
  // Титр-моушн нарисован на весь кадр — по умолчанию слой во всю ширину.
  const defaults = motion ? { ...LAYER_TRANSFORM, scale: 1 } : LAYER_TRANSFORM;
  return {
    id,
    src: String(raw.src || (motion ? `motion://${id}` : "")),
    kind,
    ...(motion ? { motion } : {}),
    track: clamp(Math.round(num(raw.track, 1)), 1, 8),
    start: round3(Math.max(0, num(raw.start, 0))),
    in: round3(inn),
    out: round3(out),
    speed: clamp(num(raw.speed, 1), SPEED_MIN, SPEED_MAX),
    volume: clamp(num(raw.volume, 1), 0, 4),
    muted: raw.muted === undefined ? false : !!raw.muted,
    fadeIn: clamp(num(raw.fadeIn, 0), 0, 5),
    fadeOut: clamp(num(raw.fadeOut, 0), 0, 5),
    transform: fx.normalizeTransform(raw.transform, defaults),
    keyframes: fx.normalizeKeyframes(raw.keyframes, defaults),
    effects: normalizeEffects(raw.effects),
    adjust: normalizeAdjust(raw.adjust),
    mask: LAYER_MASKS.includes(raw.mask) ? raw.mask : "none",
    // Мягкость края маски (доля меньшей стороны) и обводка по контуру (px при 1080).
    maskFeather: clamp(num(raw.maskFeather, 0), 0, 0.2),
    maskStroke: clamp(num(raw.maskStroke, 0), 0, 40),
    maskStrokeColor: /^#[0-9a-f]{6}$/i.test(raw.maskStrokeColor || "") ? raw.maskStrokeColor : "#FFFFFF",
    // Ячейка раскладки (доли кадра): слой заполняет её с обрезкой по центру
    // кадрирования — так собираются экран-сплит, коллажи, «картинка в рамке».
    cell: normalizeCell(raw.cell),
    bgRemove: kind === "video" || kind === "image" ? normalizeBg(raw.bgRemove, true) : null,
    focusX: clamp(num(raw.focusX, 0.5), 0, 1),
    focusY: clamp(num(raw.focusY, 0.5), 0, 1),
    chroma: {
      enabled: !!ch.enabled,
      color: /^#[0-9a-f]{6}$/i.test(ch.color || "") ? ch.color : "#00FF00",
      similarity: clamp(num(ch.similarity, 0.18), 0.01, 0.6),
      blend: clamp(num(ch.blend, 0.08), 0, 0.5),
    },
    label: String(raw.label || ""),
  };
}

function normalizeCell(c) {
  if (!c || typeof c !== "object") return null;
  const x = clamp(num(c.x, 0), 0, 1);
  const y = clamp(num(c.y, 0), 0, 1);
  const w = clamp(num(c.w, 0), 0, 1 - x);
  const h = clamp(num(c.h, 0), 0, 1 - y);
  return w > 0.02 && h > 0.02 ? { x: round3(x), y: round3(y), w: round3(w), h: round3(h) } : null;
}

function layerDuration(layer) {
  return Math.max(0.04, (layer.out - layer.in) / (layer.speed || 1));
}

function normalizeText(raw = {}) {
  const start = Math.max(0, num(raw.start, 0));
  return {
    id: raw.id || uid("text"),
    text: String(raw.text ?? "Текст"),
    start: round3(start),
    end: round3(Math.max(start + 0.2, num(raw.end, start + 2.5))),
    style: TEXT_STYLES.some((s) => s.id === raw.style) ? raw.style : "title",
    animation: TEXT_ANIMATIONS.some((a) => a.id === raw.animation) ? raw.animation : "pop",
    position: ["top", "center", "bottom"].includes(raw.position) ? raw.position : "",
    size: clamp(num(raw.size, 0), 0, 400),
    color: raw.color || "",
    bg: raw.bg || "",
    upper: raw.upper === undefined ? true : !!raw.upper,
    // Шрифт файлом (встроенная библиотека, система, дизайн-система) и второй
    // шрифт пары — для *слов в звёздочках*: так собираются заголовки из
    // шрифтовых пар, «КАЧЕСТВО роликов» с рукописным акцентом.
    fontPath: String(raw.fontPath || ""),
    accentFontPath: String(raw.accentFontPath || ""),
    accentColor: /^#[0-9a-f]{6}$/i.test(raw.accentColor || "") ? raw.accentColor : "",
    accentScale: clamp(num(raw.accentScale, 1), 0.5, 2.5),
    spacing: clamp(num(raw.spacing, 0), -0.1, 0.6),
    glow: !!raw.glow,
    // Межстрочный интервал (1 — как в шрифте), выравнивание, обводка и тень.
    lineHeight: clamp(num(raw.lineHeight, 1), 0.5, 2.5),
    align: ["left", "center", "right"].includes(raw.align) ? raw.align : "",
    outline: clamp(num(raw.outline, 0), 0, 30),
    outlineColor: /^#[0-9a-f]{6}$/i.test(raw.outlineColor || "") ? raw.outlineColor : "",
    shadow: clamp(num(raw.shadow, 0), 0, 40),
    shadowColor: /^#[0-9a-f]{6}$/i.test(raw.shadowColor || "") ? raw.shadowColor : "",
    shadowBlur: clamp(num(raw.shadowBlur, 0), 0, 20),
    // Своё место в кадре (доли), если надпись перетащили мышью в предпросмотре.
    x: Number.isFinite(Number(raw.x)) && raw.x !== null && raw.x !== "" ? clamp(Number(raw.x), 0, 1) : null,
    y: Number.isFinite(Number(raw.y)) && raw.y !== null && raw.y !== "" ? clamp(Number(raw.y), 0, 1) : null,
  };
}

function normalizeAudio(raw = {}) {
  const inn = Math.max(0, num(raw.in, 0));
  // Звуковой эффект — короткий и громкий, под голос не приседает; музыка — фоном.
  const kind = ["music", "sfx", "voice"].includes(raw.kind) ? raw.kind : "music";
  return {
    kind,
    effect: fx.AUDIO_FX.some((a) => a.id === raw.effect) ? raw.effect : "none",
    id: raw.id || uid("audio"),
    src: String(raw.src || ""),
    start: round3(Math.max(0, num(raw.start, 0))),
    in: round3(inn),
    out: round3(Math.max(inn + 0.1, num(raw.out, inn + 30))),
    volume: clamp(num(raw.volume, kind === "music" ? 0.25 : 1), 0, 4),
    fadeIn: clamp(num(raw.fadeIn, kind === "music" ? 0.5 : 0), 0, 10),
    fadeOut: clamp(num(raw.fadeOut, kind === "music" ? 1.5 : 0.05), 0, 10),
    // Приглушать музыку, пока звучит голос.
    duck: raw.duck === undefined ? kind === "music" : !!raw.duck,
    loop: !!raw.loop,
  };
}

function normalizeProject(raw = {}) {
  const preset = CANVAS_PRESETS.find((p) => p.id === raw?.canvas?.preset) || CANVAS_PRESETS[0];
  const canvas = raw.canvas || {};
  const even = (v, d) => Math.max(16, Math.round(num(v, d) / 2) * 2);
  return {
    id: raw.id || uid("prj"),
    title: String(raw.title || "Новый проект"),
    createdAt: num(raw.createdAt, Date.now()),
    updatedAt: num(raw.updatedAt, Date.now()),
    canvas: {
      preset: preset.id,
      width: even(canvas.width, preset.width),
      height: even(canvas.height, preset.height),
      fps: clamp(Math.round(num(canvas.fps, 30)), 12, 60),
      fit: FIT_MODES.some((f) => f.id === canvas.fit) ? canvas.fit : "crop",
      background: canvas.background || "#000000",
    },
    clips: (raw.clips || []).map(normalizeClip).filter((c) => c.src),
    texts: (raw.texts || []).map(normalizeText),
    audio: (raw.audio || []).map(normalizeAudio).filter((a) => a.src),
    layers: (raw.layers || []).map(normalizeLayer).filter((l) => l.src),
    captions: { ...defaultCaptions(), ...(raw.captions || {}) },
    logo: raw.logo && raw.logo.path
      ? { path: String(raw.logo.path), corner: raw.logo.corner || "top-right", size: clamp(num(raw.logo.size, 0.14), 0.03, 0.5), opacity: clamp(num(raw.logo.opacity, 1), 0.1, 1) }
      : null,
    audioFx: {
      denoise: !!raw.audioFx?.denoise,
      loudnorm: raw.audioFx?.loudnorm === undefined ? true : !!raw.audioFx.loudnorm,
    },
    design: raw.design && raw.design.dir ? { dir: String(raw.design.dir) } : null,
    // Откуда проект: клип агента помнит свой хук и описание для публикации.
    meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {},
  };
}

/** Длительность куска на выходе — с учётом скорости. */
function clipDuration(clip) {
  return Math.max(0.04, (clip.out - clip.in) / (clip.speed || 1));
}

/**
 * Где каждый кусок стоит на выходе. Переход съедает время: следующий кусок
 * начинается раньше, чем кончился предыдущий, на длину перехода.
 */
function layout(clips) {
  const out = [];
  let t = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const dur = clipDuration(c);
    let overlap = 0;
    if (i > 0 && c.transition && c.transition.kind !== "none") {
      overlap = Math.min(c.transition.duration, dur / 2, clipDuration(clips[i - 1]) / 2);
    }
    const start = Math.max(0, t - overlap);
    out.push({ id: c.id, start: round3(start), end: round3(start + dur), duration: dur, overlap });
    t = start + dur;
  }
  return { items: out, duration: round3(t) };
}

function projectDuration(project) {
  const main = layout(project.clips).duration;
  const texts = Math.max(
    project.texts.reduce((a, t) => Math.max(a, t.end), 0),
    (project.layers || []).reduce((a, l) => Math.max(a, l.start + layerDuration(l)), 0)
  );
  // Музыка ролик не удлиняет: дорожка звука под ролик, а не ролик под музыку.
  return main || texts;
}

/** Время исходника → время на выходе. null — это место вырезано. */
function sourceToOutput(clips, src, t) {
  const { items } = layout(clips);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.src !== src || t < c.in - 1e-6 || t > c.out + 1e-6) continue;
    return items[i].start + (t - c.in) / c.speed;
  }
  return null;
}

/** Время на выходе → кусок и время в исходнике. Для предпросмотра. */
function outputToSource(clips, t) {
  const { items } = layout(clips);
  for (let i = items.length - 1; i >= 0; i--) {
    if (t >= items[i].start - 1e-6) {
      const c = clips[i];
      const local = clamp(t - items[i].start, 0, items[i].duration);
      return { index: i, clip: c, time: c.in + local * c.speed, local };
    }
  }
  return null;
}

/** Разрезать кусок в точке выхода t. */
function splitAt(clips, t) {
  const hit = outputToSource(clips, t);
  if (!hit) return clips;
  const { index, clip, time } = hit;
  if (time - clip.in < 0.05 || clip.out - time < 0.05) return clips;
  const a = { ...clip, out: round3(time) };
  const b = { ...clip, id: uid("clip"), in: round3(time), transition: { kind: "none", duration: clip.transition.duration } };
  return [...clips.slice(0, index), a, b, ...clips.slice(index + 1)];
}

/**
 * Вырезать слова из куска: кусок распадается на части между вырезанным.
 * Так работает монтаж по тексту — удалили слова в расшифровке, и на дорожке
 * появился рез ровно там.
 */
function cutWordsFromClip(clip, words, cutSet) {
  // Края куска не трогаются: в нём может быть и кадр без речи, и пауза перед
  // первым словом, которую человек оставил нарочно. Режется ровно вырезанное.
  const holes = [];
  words.forEach((w, i) => {
    if (!cutSet.has(i)) return;
    const mid = (w.s + w.e) / 2;
    if (mid < clip.in || mid > clip.out) return;
    const last = holes[holes.length - 1];
    if (last && last.last === i - 1) {
      last.to = w.e;
      last.last = i;
    } else holes.push({ from: w.s, to: w.e, last: i });
  });
  if (!holes.length) return [clip];
  const pieces = [];
  let cursor = clip.in;
  for (const h of holes) {
    if (h.from - cursor > 0.04) pieces.push({ from: cursor, to: h.from });
    cursor = Math.max(cursor, h.to);
  }
  if (clip.out - cursor > 0.04) pieces.push({ from: cursor, to: clip.out });
  return piecesToClips(clip, pieces.map((p) => ({ from: round3(p.from), to: round3(p.to) })));
}

/**
 * Куски записи → куски таймлайна, с теми же настройками, что у исходного.
 * Подряд идущие резы в говорящей голове видно как «прыжок» кадра; чтобы его
 * спрятать, чередуется лёгкий наезд — тот же приём, что у монтажёров вручную.
 */
function piecesToClips(base, pieces, { punchIn = 0 } = {}) {
  return pieces.map((p, k) => ({
    ...base,
    id: k === 0 && base.id ? base.id : uid("clip"),
    in: p.from,
    out: p.to,
    zoom: punchIn && k % 2 === 1 ? round3(Math.max(base.zoom || 1, 1 + punchIn)) : base.zoom || 1,
    transition: k === 0 ? base.transition || { kind: "none", duration: 0.4 } : { kind: "none", duration: 0.4 },
    fadeIn: k === 0 ? base.fadeIn || 0 : 0,
    fadeOut: k === pieces.length - 1 ? base.fadeOut || 0 : 0,
  }));
}

/** Убрать паузы и паразиты в куске таймлайна. */
function cleanClip(clip, words, options = {}) {
  const pieces = planKeeps(words, { from: clip.in, to: clip.out }, options);
  if (!pieces.length) return [];
  return piecesToClips(clip, pieces, { punchIn: options.punchIn || 0 });
}

// ---------- субтитры (ASS) ----------

/** #RRGGBB → &HAABBGGRR, как пишет цвета ASS. alpha: 0 — непрозрачно. */
function assColor(hex, alpha = 0) {
  const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
  const h = m ? m[1] : "FFFFFF";
  const a = clamp(Math.round(alpha * 255), 0, 255).toString(16).padStart(2, "0").toUpperCase();
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

function assTime(t) {
  const v = Math.max(0, t);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = Math.floor(v % 60);
  const cs = Math.floor((v * 100) % 100 + 1e-6);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function assEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

/** Светлый ли цвет — чтобы буквы на подложке были читаемы. */
function isLight(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

/**
 * Слова на выходе: из каждого куска таймлайна — слова его записи, со временем
 * на выходе. Вырезанные слова сюда не попадают сами собой: они лежат между
 * кусками.
 */
function outputWords(project, transcripts) {
  const { items } = layout(project.clips);
  const out = [];
  project.clips.forEach((clip, i) => {
    const tr = transcripts[clip.src];
    if (!tr || !Array.isArray(tr.words)) return;
    for (const w of tr.words) {
      const mid = (w.s + w.e) / 2;
      if (mid < clip.in || mid > clip.out) continue;
      const s = items[i].start + (Math.max(w.s, clip.in) - clip.in) / clip.speed;
      const e = items[i].start + (Math.min(w.e, clip.out) - clip.in) / clip.speed;
      out.push({ w: w.w, s: round3(s), e: round3(Math.max(e, s + 0.05)) });
    }
  });
  return out.sort((a, b) => a.s - b.s);
}

/**
 * Слова → строки субтитров. Строка рвётся на точке, на паузе и по числу слов:
 * фраза, разорванная посередине мысли, читается хуже, чем чуть более длинная.
 */
function captionLines(words, { wordsPerLine = 4, maxChars = 28 } = {}) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (cur.length) lines.push({ words: cur, start: cur[0].s, end: cur[cur.length - 1].e });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && w.s - prev.e > 0.7) flush();
    const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (cur.length >= wordsPerLine || (cur.length && chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  // Строка держится до следующей, а не гаснет на последней букве: мигание на
  // каждой короткой паузе утомляет сильнее, чем лишние полсекунды текста.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    const hold = next ? Math.min(next.start, lines[i].end + 0.6) : lines[i].end + 0.4;
    lines[i].end = Math.max(lines[i].end, hold);
  }
  return lines;
}

/**
 * Файл субтитров и надписей.
 * @param {object} project
 * @param {object[]} words — слова на выходе (outputWords)
 * @param {{family?:string, textFamily?:string}} fonts — семейства, найденные в файлах шрифтов
 */
/** Где стоит надпись по стилю (доли кадра) — для построчной раскладки. */
const TEXT_ANCHORS = {
  hook: { x: 0.5, y: 0.14 },
  title: { x: 0.5, y: 0.5 },
  lower: { x: 0.5, y: 0.78 },
  label: { x: 0.5, y: 0.08 },
  plain: { x: 0.5, y: 0.68 },
};

function buildAss(project, words, fonts = {}) {
  const { width: W, height: H } = project.canvas;
  const cap = { ...defaultCaptions(), ...project.captions };
  const family = (fonts.family || cap.font || "Arial").replace(/,/g, " ");
  const textFamily = (fonts.textFamily || family).replace(/,/g, " ");
  const scale = Math.min(W, H) / 1080;
  const capSize = Math.round(num(cap.size, 72) * scale);
  const style = cap.style;
  const posAlign = cap.position === "top" ? 8 : cap.position === "center" ? 5 : 2;
  const marginV = cap.position === "center" ? 0 : Math.round(H * (cap.position === "top" ? 0.12 : 0.16));
  const accent = cap.highlight || "#FFD400";

  const st = CAPTION_STYLES.find((x) => x.id === style) || CAPTION_STYLES[0];
  const colorOf = (c, fallback = "#FFFFFF") => (c === "accent" ? accent : c === "user" ? cap.color || "#FFFFFF" : c === "transparent" ? null : c || fallback);
  const sc = (v) => Math.max(0, Math.round(v * scale));
  const fill = colorOf(st.color);
  const capFamily = fonts.family ? family : (st.font || cap.font || "Arial").replace(/,/g, " ");
  const capSizeStyled = Math.round(capSize * (st.sizeMul || 1));
  const stAlign = st.align === "left" ? (cap.position === "top" ? 7 : cap.position === "center" ? 4 : 1) : st.position === "center" ? 5 : posAlign;
  const stMarginV = st.position === "center" ? 0 : marginV;
  const boxed = !!st.box;
  const boxCol = boxed ? assColor(colorOf(st.box, "#000000"), st.boxAlpha ?? 0.35) : null;
  const outCol = assColor(colorOf(st.outline, "#000000"));
  const shadowCol = assColor(colorOf(st.shadowColor, "#000000"), st.shadowColor ? 0 : 0.45);

  const styles = [
    `Style: Caption,${capFamily},${capSizeStyled},${fill ? assColor(fill) : assColor("#FFFFFF", 1)},${assColor(accent)},${boxed ? boxCol : outCol},${boxed ? boxCol : shadowCol},${st.bold === false ? 0 : 1},${st.italic ? 1 : 0},0,0,100,100,0,${-(st.rotate || 0)},${boxed ? 3 : 1},${boxed ? sc(14) : sc(st.outlineW ?? 4)},${boxed ? 0 : sc(st.shadow ?? 2)},${stAlign},${Math.round(W * 0.07)},${Math.round(W * 0.07)},${stMarginV},1`,
  ];
  const textStyles = {
    hook: { size: 76, align: 8, marginV: 0.1, box: true },
    title: { size: 104, align: 5, marginV: 0, box: false },
    lower: { size: 56, align: 1, marginV: 0.2, box: true },
    label: { size: 46, align: 7, marginV: 0.06, box: true },
    plain: { size: 64, align: 2, marginV: 0.3, box: false },
  };
  for (const [id, s] of Object.entries(textStyles)) {
    const bg = id === "hook" || id === "label" ? accent : "#000000";
    const fg = isLight(bg) && s.box ? "#0A0A0A" : "#FFFFFF";
    styles.push(
      `Style: T_${id},${textFamily},${Math.round(s.size * scale)},${assColor(fg)},${assColor(accent)},${s.box ? assColor(bg) : assColor("#000000")},${s.box ? assColor(bg) : assColor("#000000", 0.5)},1,0,0,0,100,100,0,0,${s.box ? 3 : 1},${s.box ? Math.round(18 * scale) : Math.round(5 * scale)},0,${s.align},${Math.round(W * 0.07)},${Math.round(W * 0.07)},${Math.round(H * s.marginV)},1`
    );
  }

  const events = [];
  const ev = (layer, start, end, styleName, text) =>
    events.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${text}`);

  if (cap.enabled && words.length) {
    const upper = !!cap.upper || !!st.upper;
    const caseOf = (w, forceUpper) => {
      const t = forceUpper || upper ? w.toUpperCase() : st.lower ? w.toLowerCase() : w;
      return assEscape(t);
    };
    const act = st.active || {};
    const S = Math.round((act.scale || 1) * 100);
    const activeTags = () => {
      const t = [];
      const c = colorOf(act.color, "");
      if (c) t.push(`\\c${assColor(c)}\\1a&H00&`);
      if (act.box) t.push(`\\3c${assColor(colorOf(act.box))}\\4c${assColor(colorOf(act.box))}\\bord${sc(16)}\\shad0\\blur0`);
      if (act.underline) t.push("\\u1");
      if (act.anim === "pop") t.push(`\\fscx${Math.round(S * 0.7)}\\fscy${Math.round(S * 0.7)}\\t(0,90,\\fscx${Math.round(S * 1.08)}\\fscy${Math.round(S * 1.08)})\\t(90,170,\\fscx${S}\\fscy${S})`);
      else if (act.anim === "bounce") t.push(`\\fscx${S}\\fscy${S}\\t(0,90,\\fscy${Math.round(S * 1.28)})\\t(90,190,\\fscy${S})`);
      else if (act.anim === "fade") t.push("\\alpha&HFF&\\t(0,200,\\alpha&H00&)");
      else if (act.anim === "jitter") t.push(`\\xshad${sc(-5)}\\yshad${sc(2)}\\4c${assColor("#FF0040")}`);
      else if (S !== 100) t.push(`\\fscx${S}\\fscy${S}`);
      return t.join("");
    };
    // Свечение — отдельным слоем под буквами: размытая обводка без заливки.
    // Размой ту же заливку — и буквы станут мутными, а не светящимися.
    const glowCopy = (start, end, text) => {
      if (!st.glow) return;
      const g = colorOf(st.outline, accent);
      ev(0, start, end, "Caption", `{\\1a&HFF&\\3c${assColor(g)}\\bord${sc((st.outlineW || 4) + st.glow)}\\blur${sc(st.glow)}\\shad0}${text.replace(/\{[^}]*\}/g, "")}`);
    };
    const emit = (start, end, text) => {
      if (end - start < 0.01) return;
      glowCopy(start, end, text);
      ev(1, start, end, "Caption", text);
    };
    const quiet = !act.color && !act.box && !act.underline && !act.anim && !act.scale && st.reveal === "line";
    if (st.reveal === "word") {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const next = words[i + 1];
        const end = next ? Math.min(next.s, w.e + 0.5) : w.e + 0.4;
        emit(w.s, Math.max(end, w.s + 0.12), `{${activeTags()}}${caseOf(w.w, act.upper)}`);
      }
    } else {
      const per = Math.max(1, Math.min(st.per || 4, cap.wordsPerLine || st.per || 4));
      const maxChars = per <= 3 ? 20 : per >= 6 ? 40 : 30;
      for (const line of captionLines(words, { wordsPerLine: per, maxChars })) {
        if (quiet) {
          emit(line.start, line.end, line.words.map((w) => caseOf(w.w)).join(" "));
          continue;
        }
        // По событию на каждое слово: строка та же, меняется говорящееся.
        line.words.forEach((w, k) => {
          const start = k === 0 ? line.start : w.s;
          const end = k === line.words.length - 1 ? line.end : line.words[k + 1].s;
          const text = line.words
            .map((x, j) => {
              if (j === k) return `{${activeTags()}}${caseOf(x.w, act.upper)}{\\r}`;
              // Будущие слова при накоплении нарисованы прозрачными — строка
              // сразу встаёт на своё место и не прыгает с каждым новым словом.
              if (st.reveal === "accumulate" && j > k) return `{\\alpha&HFF&}${caseOf(x.w)}{\\r}`;
              return caseOf(x.w);
            })
            .join(" ")
            .replace(/\{\}/g, "");
          emit(start, end, text);
        });
      }
    }
  }

  const textFg = (styleId) => {
    const st2 = textStyles[styleId] || textStyles.title;
    const bg = styleId === "hook" || styleId === "label" ? accent : "#000000";
    return isLight(bg) && st2.box ? "#0A0A0A" : "#FFFFFF";
  };
  for (const t of project.texts) {
    const baseSize = Math.round((t.size || (textStyles[t.style] || textStyles.title).size) * scale);
    const fam = (fonts.byPath && t.fontPath && fonts.byPath[t.fontPath]) || "";
    const accFam = (fonts.byPath && t.accentFontPath && fonts.byPath[t.accentFontPath]) || fam;
    const mainColor = t.color || textFg(t.style);
    // Тэги вида букв — повторяются после каждого акцентного куска, чтобы
    // вернуть основной шрифт, цвет и размер.
    const look = [];
    if (fam) look.push(`\\fn${fam.replace(/[\\{}]/g, "")}\\b0\\i0`);
    if (t.size || fam) look.push(`\\fs${baseSize}`);
    if (t.color) look.push(`\\c${assColor(t.color)}`);
    if (t.spacing) look.push(`\\fsp${Math.round(t.spacing * baseSize)}`);
    const style = [];
    if (t.bg) style.push(`\\3c${assColor(t.bg)}\\4c${assColor(t.bg)}`);
    // Обводка и тень поверх стиля: толщина — в долях размера кадра 1080.
    if (t.outline > 0) style.push(`\\bord${round3(t.outline * scale)}\\3c${assColor(t.outlineColor || "#000000")}`);
    if (t.shadow > 0) style.push(`\\shad${round3(t.shadow * scale)}\\4c${assColor(t.shadowColor || "#000000")}\\4a&H50&${t.shadowBlur ? `\\blur${round3(t.shadowBlur * scale)}` : ""}`);
    const dur = Math.max(0.2, t.end - t.start);
    const ms = (v) => Math.round(Math.min(v, dur / 3) * 1000);
    const anim = [];
    if (t.animation === "pop") anim.push(`\\fscx60\\fscy60\\t(0,${ms(0.12)},\\fscx110\\fscy110)\\t(${ms(0.12)},${ms(0.22)},\\fscx100\\fscy100)\\fad(60,${ms(0.2)})`);
    else if (t.animation === "fade") anim.push(`\\fad(${ms(0.35)},${ms(0.3)})`);
    else if (t.animation === "slide") anim.push(`\\fad(80,${ms(0.25)})\\frx50\\t(0,${ms(0.3)},\\frx0)`);
    const animTags = anim.join("");
    const hasAccent = /\*[^*]+\*/.test(t.text);
    const accSize = Math.round(baseSize * (t.accentScale || 1));
    const accLook = `${accFam ? `\\fn${accFam.replace(/[\\{}]/g, "")}\\b0\\i0` : ""}\\fs${accSize}\\c${assColor(t.accentColor || accent)}\\fsp0`;
    // Строка текста в ASS: акцентные куски — вторым шрифтом пары. В паре
    // заглавными пишется только основной шрифт: «ШРИФТОВЫЕ пары».
    const lineBody = (line) => {
      if (!hasAccent) return assEscape(t.upper ? line.toUpperCase() : line);
      return line
        .split(/\*([^*]+)\*/)
        .map((seg, i) => {
          if (!seg) return "";
          if (i % 2 === 1) return `{${accLook}${animTags}}${assEscape(seg)}{${look.join("")}\\c${assColor(mainColor)}${animTags}}`;
          return assEscape(t.upper ? seg.toUpperCase() : seg);
        })
        .join("")
        .replace(/\{\}/g, "");
    };
    const lines = String(t.text).split(/\r?\n/);
    const placed = t.x !== null && t.x !== undefined && t.y !== null && t.y !== undefined;
    const lh = t.lineHeight || 1;
    const alignAn = t.align === "left" ? 4 : t.align === "right" ? 6 : 5;
    // Межстрочный интервал в ASS не задаётся — каждая строка ставится своим
    // событием с точной высотой. Так же — при выравнивании по краю.
    const perLine = lines.length > 1 && (Math.abs(lh - 1) > 0.01 || (t.align && t.align !== "center"));
    const events = [];
    if (perLine || (placed && t.align && t.align !== "center")) {
      const def = TEXT_ANCHORS[t.style] || TEXT_ANCHORS.title;
      const ax = Math.round((placed ? t.x : def.x) * W);
      const ay = (placed ? t.y : t.position === "top" ? 0.14 : t.position === "bottom" ? 0.8 : t.position === "center" ? 0.5 : def.y) * H;
      const step = baseSize * 1.2 * lh;
      lines.forEach((line, i) => {
        const y = Math.round(ay + (i - (lines.length - 1) / 2) * step);
        events.push({ tags: `\\an${alignAn}\\pos(${ax},${y})`, body: lineBody(line), raw: line });
      });
    } else {
      const pos = placed ? `\\an5\\pos(${Math.round(t.x * W)},${Math.round(t.y * H)})` : t.position ? `\\an${t.position === "top" ? 8 : t.position === "center" ? 5 : 2}` : "";
      events.push({ tags: pos, body: lines.map(lineBody).join("\\N"), raw: t.text });
    }
    for (const e of events) {
      const head = `${e.tags}${look.join("")}${style.join("")}${animTags}`;
      // Свечение — размытая обводка отдельным слоем под буквами.
      if (t.glow && t.animation !== "type") {
        const g = t.accentColor || accent;
        ev(1, t.start, t.end, `T_${t.style}`, `{${head}\\1a&HFF&\\3c${assColor(g)}\\bord${Math.round(baseSize * 0.12)}\\blur${Math.round(baseSize * 0.18)}\\shad0}${e.body.replace(/\\c&H[0-9A-F]+&/g, "")}`);
      }
      if (t.animation === "type") {
        // Печатается: по событию на каждую добавленную букву, последнее держится.
        // Режется исходный текст, а экранируется каждый кусок: иначе срез мог бы
        // прийтись посреди «\N» и оставить в кадре обратную косую черту.
        const plain = String(e.raw).replace(/\*/g, "");
        const chars = Array.from(t.upper ? plain.toUpperCase() : plain);
        const step = Math.min(0.06, (dur * 0.5) / Math.max(1, chars.length));
        for (let i = 1; i <= chars.length; i++) {
          const st = t.start + (i - 1) * step;
          const en = i === chars.length ? t.end : t.start + i * step;
          ev(2, st, en, `T_${t.style}`, `{${head}}` + assEscape(chars.slice(0, i).join("")));
        }
        continue;
      }
      ev(2, t.start, t.end, `T_${t.style}`, `{${head}}${e.body}`.replace(/^\{\}/, ""));
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

// ---------- сборка через ffmpeg ----------

/** atempo принимает 0.5–2; скорость вне этого — цепочкой. */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2) {
    parts.push("atempo=2");
    s /= 2;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${round3(s)}`);
  return parts;
}

/**
 * Цвет куска: яркость/контраст/насыщенность, фильтр с силой и свой LUT.
 * n — уникальная метка: внутри одного графа несколько слоёв.
 */
function colorChain(adj, n, lutName) {
  const a = normalizeAdjust(adj || {});
  const out = gradeChain(a);
  if (a.brightness || (a.contrast ?? 1) !== 1 || (a.saturation ?? 1) !== 1) {
    out.push(`eq=brightness=${round3(a.brightness || 0)}:contrast=${round3(a.contrast ?? 1)}:saturation=${round3(a.saturation ?? 1)}`);
  }
  const preset = FILTERS.find((f) => f.id === a.filter);
  const looks = [];
  if (preset && preset.vf) looks.push(preset.vf);
  if (lutName) looks.push(`lut3d=file=${lutName}`);
  if (looks.length) {
    const amount = a.filterAmount ?? 1;
    // Сила фильтра меньше полной — смешиваем с исходником, как ползунок в CapCut.
    if (amount < 0.99) out.push(`split[fa${n}][fb${n}];[fb${n}]${looks.join(",")}[fc${n}];[fa${n}][fc${n}]blend=all_mode=normal:all_opacity=${round3(amount)}`);
    else out.push(...looks);
  }
  return out;
}

function hasTransform(item, def = fx.TRANSFORM_DEFAULT) {
  if (item.keyframes && item.keyframes.length) return true;
  const t = item.transform || def;
  return Object.keys(def).some((k) => Math.abs((t[k] ?? def[k]) - def[k]) > 1e-4);
}

/** Цепочка видео для куска: кадрирование под холст, цвет, эффекты, движение. */
function clipVideoFilter(clip, canvas, { lutName = "" } = {}) {
  const { width: W, height: H, fps } = canvas;
  const fit = clip.fit || canvas.fit || "crop";
  const z = clip.zoom || 1;
  const zw = Math.round((W * z) / 2) * 2;
  const zh = Math.round((H * z) / 2) * 2;
  const dur = clipDuration(clip);
  const color = colorChain(clip.adjust, "c", lutName);
  const effects = fx.effectsChain(clip.effects, { W, H, dur, n: "c" });
  const head = [`setpts=(PTS-STARTPTS)/${clip.speed || 1}`, `fps=${fps}`];
  // Реверс — после обрезки входа: в память ложится только сам кусок.
  if (clip.reverse) head.unshift("reverse");
  const crop = `crop=${W}:${H}:(iw-${W})*${round3(clip.focusX ?? 0.5)}:(ih-${H})*${round3(clip.focusY ?? 0.5)}`;
  const look = [...color, ...(effects ? [effects] : [])];
  let graph;
  if (fit === "fit") {
    graph = [...head, `scale=${zw}:${zh}:force_original_aspect_ratio=decrease`, `pad=${Math.max(W, zw)}:${Math.max(H, zh)}:(ow-iw)/2:(oh-ih)/2:color=${canvas.background || "black"}`, crop, ...look].join(",");
  } else if (fit === "blur") {
    graph =
      `${head.join(",")},split=2[bgsrc][fgsrc];` +
      `[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:6,eq=brightness=-0.08[bg];` +
      `[fgsrc]scale=${zw}:${zh}:force_original_aspect_ratio=decrease,crop='min(iw,${W})':'min(ih,${H})'[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2${look.length ? "," + look.join(",") : ""}`;
  } else {
    graph = [...head, `scale=${zw}:${zh}:force_original_aspect_ratio=increase`, crop, ...look].join(",");
  }
  // Положение, масштаб, поворот, прозрачность — кадр накладывается на фон
  // холста уже преобразованным. Время ключевых точек — от начала куска.
  if (hasTransform(clip)) {
    const t = fx.transformChain(clip.transform, clip.keyframes, { offset: 0, widthPx: W });
    const xy = fx.overlayXY(clip.transform, clip.keyframes, { offset: 0 });
    graph =
      `${graph},setsar=1[pre];color=c=${canvas.background || "black"}:s=${W}x${H}:r=${fps}:d=${round3(dur + 1)}[cv];` +
      `[pre]${t}[tx];[cv][tx]overlay=x='${xy.x}':y='${xy.y}':eval=${xy.dynamic ? "frame" : "init"}:shortest=1`;
  }
  const tail = ["setsar=1", "format=yuv420p"];
  if (clip.fadeIn > 0) tail.push(`fade=t=in:st=0:d=${round3(Math.min(clip.fadeIn, dur / 2))}`);
  if (clip.fadeOut > 0) tail.push(`fade=t=out:st=${round3(Math.max(0, dur - clip.fadeOut))}:d=${round3(Math.min(clip.fadeOut, dur / 2))}`);
  // Видео дотягивается последним кадром: длина куска считается по кадрам, и
  // недостающий кадр в конце дал бы рассинхрон, растущий с каждым резом.
  tail.push("tpad=stop_mode=clone:stop_duration=1");
  return `${graph},${tail.join(",")}`;
}

function audioEffect(id) {
  const e = fx.AUDIO_FX.find((x) => x.id === id);
  return e && e.af ? [e.af] : [];
}

function clipAudioFilter(clip, { denoise = false } = {}) {
  const dur = clipDuration(clip);
  const parts = ["asetpts=PTS-STARTPTS"];
  if (clip.reverse) parts.push("areverse");
  parts.push(...atempoChain(clip.speed || 1));
  parts.push(`volume=${clip.muted ? 0 : round3(clip.volume ?? 1)}`);
  if (denoise) parts.push("afftdn=nf=-25");
  parts.push(...audioEffect(clip.audioEffect));
  // Микро-затухание на каждом краю: рез посреди волны звучит щелчком.
  const edge = 0.012;
  parts.push(`afade=t=in:st=0:d=${Math.max(edge, round3(Math.min(clip.fadeIn || 0, dur / 2)))}`);
  parts.push(`afade=t=out:st=${round3(Math.max(0, dur - Math.max(edge, clip.fadeOut || 0)))}:d=${Math.max(edge, round3(Math.min(clip.fadeOut || 0, dur / 2)))}`);
  parts.push("aresample=48000", "aformat=sample_fmts=s16:channel_layouts=stereo", "apad");
  return parts.join(",");
}

/** Длительность, округлённая до целых кадров. */
function frameDuration(seconds, fps) {
  return Math.max(1, Math.round(seconds * fps)) / fps;
}

/**
 * Аргументы ffmpeg для одного куска.
 *
 * Каждый кусок сначала собирается в отдельный файл одинакового вида — размер
 * холста, частота кадров, звук без сжатия. Почему не одним графом: кусков
 * после чистки бывает под сотню, и граф на сто входов держит в памяти сто
 * декодеров одновременно. Отдельные куски держат один, а склеиваются потом
 * без перекодирования. Звук внутри кусков — PCM: у AAC на каждом стыке
 * добавляется своя задержка, и на сотне резов голос уезжал бы от губ.
 */
function buildClipArgs(clip, canvas, outPath, { hasAudio = true, denoise = false, lutName = "", srcW = 0, srcH = 0, bgMask = "" } = {}) {
  const dur = frameDuration(clipDuration(clip), canvas.fps);
  const srcDur = round3(dur * (clip.speed || 1) + 0.1);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (clip.kind === "image") {
    args.push("-loop", "1", "-framerate", String(canvas.fps), "-t", String(round3(dur + 0.1)), "-i", clip.src);
  } else {
    args.push("-ss", String(clip.in), "-t", String(srcDur), "-i", clip.src);
  }
  const silent = clip.kind === "image" || !hasAudio;
  if (silent) args.push("-f", "lavfi", "-t", String(round3(dur + 0.1)), "-i", "anullsrc=r=48000:cl=stereo");
  const vf = clipVideoFilter(clip, canvas, { lutName });
  const af = clipAudioFilter(clip, { denoise });
  const erase = clip.erase && clip.erase.length && srcW && srcH ? eraseGraph(clip.erase, srcW, srcH, "[0:v]", "[clean]") : "";
  let head = erase ? `${erase};[clean]` : "[0:v]";
  const bg = clip.bgRemove && bgMask && srcW && srcH ? clip.bgRemove : null;
  if (bg) {
    // Замена фона: объект по маске нейросети поверх размытого кадра, цвета или картинки.
    const mi = silent ? 2 : 1;
    // Маска картинки — один кадр (PNG), маска видео — видео той же длины.
    if (/\.png$/i.test(bgMask)) args.push("-loop", "1", "-t", String(round3(dur + 0.1)), "-i", bgMask);
    else args.push("-i", bgMask);
    const blur = round3(0.5 + bg.soft * 2.5);
    const g = [`${head}format=rgba,split[bfg][bsrc]`, `[${mi}:v]scale=${srcW}:${srcH},format=gray,gblur=sigma=${blur}[bm]`, `[bfg][bm]alphamerge[bfa]`];
    if (bg.replace === "color") g.push(`color=c=0x${bg.color.slice(1)}:s=${srcW}x${srcH}:r=${canvas.fps}[bbg]`, `[bsrc]nullsink`);
    else if (bg.replace === "image" && bg.image) {
      args.push("-loop", "1", "-t", String(round3(dur + 0.1)), "-i", bg.image);
      g.push(`[${mi + 1}:v]scale=${srcW}:${srcH}:force_original_aspect_ratio=increase,crop=${srcW}:${srcH},setsar=1[bbg]`, `[bsrc]nullsink`);
    } else g.push(`[bsrc]boxblur=${Math.round(Math.min(srcW, srcH) / 40)}:3[bbg]`);
    g.push(`[bbg][bfa]overlay=format=auto:shortest=1,format=yuv420p[bgdone]`);
    head = g.join(";") + ";[bgdone]";
  }
  args.push(
    "-filter_complex",
    `${head}${vf}[v];[${silent ? 1 : 0}:a]${af}[a]`,
    "-map", "[v]", "-map", "[a]",
    "-t", String(round3(dur)),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-r", String(canvas.fps),
    "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
    outPath
  );
  return { args, duration: dur };
}

/**
 * Куски группами: внутри группы — простые склейки (без перекодирования),
 * между группами — переходы.
 */
function groupByTransitions(clips) {
  const groups = [];
  clips.forEach((c, i) => {
    if (i === 0 || c.transition.kind !== "none") groups.push({ transition: i === 0 ? null : c.transition, indices: [i] });
    else groups[groups.length - 1].indices.push(i);
  });
  return groups;
}

function concatList(files) {
  // Путь в списке concat — в одинарных кавычках, кавычка внутри экранируется.
  return files.map((f) => `file '${String(f).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n";
}

/** Маска слоя: круг или скруглённый прямоугольник — альфой, до масштаба. */
function maskChain(mask) {
  if (mask === "circle") {
    return "crop='min(iw,ih)':'min(iw,ih)',geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*lte(hypot(X-W/2,Y-H/2),W/2)'";
  }
  if (mask === "rounded") {
    const R = "(min(W,H)*0.12)";
    return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(gt(abs(X-W/2),W/2-${R})*gt(abs(Y-H/2),H/2-${R}),lte(hypot(abs(X-W/2)-(W/2-${R}),abs(Y-H/2)-(H/2-${R})),${R}),1)'`;
  }
  return "";
}

/**
 * Слой поверх видео: вход, цвет, эффекты, хромакей, маска, появление,
 * преобразование по ключевым точкам. Время слоя — время ролика: кадры
 * слоя сдвинуты на его начало, и выражения ключевых точек считают от него же.
 */
function layerInput(layer, canvas) {
  const dur = layerDuration(layer);
  const srcDur = round3(dur * layer.speed + 0.1);
  if (layer.kind === "image") {
    if (/\.gif$/i.test(layer.src)) return ["-ignore_loop", "0", "-t", String(round3(dur + 0.1)), "-i", layer.src];
    return ["-loop", "1", "-framerate", String(canvas.fps), "-t", String(round3(dur + 0.1)), "-i", layer.src];
  }
  return ["-ss", String(layer.in), "-t", String(srcDur), "-i", layer.src];
}

function layerFilter(layer, idx, inputIndex, canvas, lutName, maskIn = null) {
  const { width: W, height: H, fps } = canvas;
  const dur = layerDuration(layer);
  const start = layer.start;
  const parts = [`setpts=(PTS-STARTPTS)/${layer.speed}+${start}/TB`, `fps=${fps}`];
  parts.push(...colorChain(layer.adjust, `l${idx}`, lutName));
  const eff = fx.effectsChain(layer.effects, { W, H, dur, n: `l${idx}` });
  if (eff) parts.push(eff);
  if (layer.chroma.enabled) parts.push(`chromakey=color=0x${layer.chroma.color.slice(1)}:similarity=${layer.chroma.similarity}:blend=${layer.chroma.blend}`);
  let cellXY = null;
  if (layer.cell) {
    // Ячейка: заполнить с обрезкой, сдвиг обрезки — по центру кадрирования.
    const even = (v) => Math.max(2, Math.round(v / 2) * 2);
    const cw = even(layer.cell.w * W);
    const ch = even(layer.cell.h * H);
    parts.push(`scale=${cw}:${ch}:force_original_aspect_ratio=increase`, `crop=${cw}:${ch}:'(iw-${cw})*${round3(layer.focusX)}':'(ih-${ch})*${round3(layer.focusY)}'`);
    cellXY = { x: Math.round(layer.cell.x * W), y: Math.round(layer.cell.y * H) };
  }
  parts.push("format=rgba");
  // Маска файлом: граф делится на «до маски» и «после» — между ними обводка
  // кольцом и умножение прозрачности на форму.
  let pre = "";
  if (maskIn) {
    const g = [];
    let cur = `[lp${idx}]`;
    g.push(`[${inputIndex}:v]${parts.join(",")}${cur}`);
    if (maskIn.strokeIndex !== null) {
      g.push(`[${maskIn.strokeIndex}:v]format=gray[sk${idx}]`);
      g.push(`color=c=0x${maskIn.color.slice(1)}:s=${maskIn.w}x${maskIn.h}:r=${fps},format=rgba[sc${idx}]`);
      g.push(`[sc${idx}][sk${idx}]alphamerge[sring${idx}]`);
      g.push(`${cur}[sring${idx}]overlay=0:0:format=auto:eof_action=repeat[ls${idx}]`);
      cur = `[ls${idx}]`;
    }
    g.push(`${cur}split[lc${idx}][la0${idx}]`);
    g.push(`[la0${idx}]alphaextract[laa${idx}]`);
    let alpha = `[laa${idx}]`;
    // Прозрачность слоя умножается на каждую маску: форму и маску нейросети.
    const alphas = [];
    if (maskIn.maskIndex !== null) alphas.push(`[${maskIn.maskIndex}:v]format=gray`);
    if (maskIn.bgIndex !== null) {
      const sz = maskIn.srcW && maskIn.srcH ? `scale=${maskIn.srcW}:${maskIn.srcH},` : "";
      alphas.push(maskIn.bgStill ? `[${maskIn.bgIndex}:v]${sz}format=gray,gblur=sigma=${maskIn.bgBlur}` : `[${maskIn.bgIndex}:v]setpts=(PTS-STARTPTS)/${layer.speed}+${start}/TB,fps=${fps},${sz}format=gray,gblur=sigma=${maskIn.bgBlur}`);
    }
    alphas.forEach((a, k) => {
      g.push(`${a}[lmk${idx}_${k}]`);
      if (layer.cell && k === alphas.length - 1 && maskIn.bgIndex !== null && maskIn.cellCrop) g[g.length - 1] = `${a},${maskIn.cellCrop}[lmk${idx}_${k}]`;
      g.push(`${alpha}[lmk${idx}_${k}]scale2ref[lmr${idx}_${k}][lal${idx}_${k}]`);
      g.push(`[lal${idx}_${k}][lmr${idx}_${k}]blend=all_mode=multiply:eof_action=repeat[lam${idx}_${k}]`);
      alpha = `[lam${idx}_${k}]`;
    });
    g.push(`[lc${idx}]${alpha}alphamerge[lmasked${idx}]`);
    pre = g.join(";") + ";";
    parts.length = 0;
  } else {
    const mask = maskChain(layer.mask);
    if (mask) parts.push(mask);
  }
  if (layer.fadeIn > 0) parts.push(`fade=t=in:st=${start}:d=${round3(Math.min(layer.fadeIn, dur / 2))}:alpha=1`);
  if (layer.fadeOut > 0) parts.push(`fade=t=out:st=${round3(start + dur - layer.fadeOut)}:d=${round3(Math.min(layer.fadeOut, dur / 2))}:alpha=1`);
  if (cellXY) {
    const op = layer.transform && layer.transform.opacity !== undefined ? layer.transform.opacity : 1;
    if (op < 0.999) parts.push(`colorchannelmixer=aa=${round3(op)}`);
    return {
      chain: maskIn ? `${pre}[lmasked${idx}]${parts.filter(Boolean).join(",") || "null"}[ly${idx}]` : `[${inputIndex}:v]${parts.join(",")}[ly${idx}]`,
      overlay: (from, to) => `${from}[ly${idx}]overlay=x=${cellXY.x}:y=${cellXY.y}:enable='between(t,${start},${round3(start + dur)})':eof_action=pass${to}`,
    };
  }
  parts.push(fx.transformChain(layer.transform, layer.keyframes, { offset: start, widthPx: W }));
  const xy = fx.overlayXY(layer.transform, layer.keyframes, { offset: start });
  return {
    chain: maskIn ? `${pre}[lmasked${idx}]${parts.filter(Boolean).join(",") || "null"}[ly${idx}]` : `[${inputIndex}:v]${parts.join(",")}[ly${idx}]`,
    overlay: (from, to) =>
      `${from}[ly${idx}]overlay=x='${xy.x}':y='${xy.y}':eval=${xy.dynamic ? "frame" : "init"}:enable='between(t,${start},${round3(start + dur)})':eof_action=pass${to}`,
  };
}

/**
 * Итоговый граф: переходы между группами, слои, логотип, субтитры и надписи,
 * музыка и звуковые эффекты, громкость.
 */
function buildFinalArgs({ groups, project, assFile, fontsDir, outPath, codec, layerInfo = {}, layerLuts = {}, audible = true, layerMasks = {} }) {
  const { canvas } = project;
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats"];
  groups.forEach((g) => args.push("-i", g.file));
  const filters = [];
  let v = "[0:v]";
  let a = "[0:a]";
  let total = groups[0].duration;
  if (groups.length > 1) {
    // xfade требует одинаковой шкалы времени у входов, а склейка без
    // перекодирования её не выравнивает.
    groups.forEach((_g, i) => filters.push(`[${i}:v]settb=AVTB,fps=${canvas.fps}[g${i}]`));
    v = "[g0]";
  }
  for (let i = 1; i < groups.length; i++) {
    const g = groups[i];
    const td = round3(Math.min(g.transition.duration, total / 2, g.duration / 2));
    const off = round3(Math.max(0, total - td));
    filters.push(`${v}[g${i}]xfade=transition=${g.transition.kind}:duration=${td}:offset=${off}[vx${i}]`);
    filters.push(`${a}[${i}:a]acrossfade=d=${td}:c1=tri:c2=tri[ax${i}]`);
    v = `[vx${i}]`;
    a = `[ax${i}]`;
    total = total + g.duration - td;
  }

  let inputIndex = groups.length;
  const extraAudio = [];

  // Слои по дорожкам: верхняя дорожка рисуется последней.
  const layers = [...(project.layers || [])].filter((l) => l.start < total).sort((x, y) => x.track - y.track || x.start - y.start);
  layers.forEach((layer, idx) => {
    args.push(...layerInput(layer, canvas));
    const layerIndex = inputIndex;
    let maskIn = null;
    const lm = layerMasks[layer.id];
    if (lm) {
      // Картинки маски — отдельными входами, повторяются всё время слоя.
      const hold = String(round3(layer.start + layerDuration(layer) + 1));
      args.push("-loop", "1", "-framerate", String(canvas.fps), "-t", hold, "-i", lm.mask);
      inputIndex++;
      const maskIndex = inputIndex;
      let strokeIndex = null;
      if (lm.stroke) {
        args.push("-loop", "1", "-framerate", String(canvas.fps), "-t", hold, "-i", lm.stroke);
        inputIndex++;
        strokeIndex = inputIndex;
      }
      maskIn = { maskIndex, strokeIndex, color: lm.color, w: lm.w, h: lm.h, bgIndex: null };
    }
    // Маска нейросети (удаление фона) — видео той же длины, что слой.
    const bgMask = layer.bgRemove && layer.bgRemove.cache && layer.bgRemove.cache.key === bgKey(layer) ? layer.bgRemove.cache.mask : "";
    if (bgMask) {
      const still = /\.png$/i.test(bgMask);
      if (still) args.push("-loop", "1", "-framerate", String(canvas.fps), "-t", String(round3(layer.start + layerDuration(layer) + 1)), "-i", bgMask);
      else args.push("-i", bgMask);
      inputIndex++;
      const info = layerInfo[layer.src] || {};
      const even = (v) => Math.max(2, Math.round(v / 2) * 2);
      let cellCrop = "";
      if (layer.cell && info.width && info.height) {
        // В ячейке маска обрезается так же, как кадр слоя.
        const cw = even(layer.cell.w * canvas.width);
        const ch = even(layer.cell.h * canvas.height);
        cellCrop = `scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch}:'(iw-${cw})*${round3(layer.focusX)}':'(ih-${ch})*${round3(layer.focusY)}'`;
      }
      maskIn = { ...(maskIn || { maskIndex: null, strokeIndex: null, color: "#FFFFFF", w: 0, h: 0 }), bgIndex: inputIndex, bgStill: still, srcW: layer.cell ? 0 : info.width, srcH: layer.cell ? 0 : info.height, bgBlur: round3(0.5 + layer.bgRemove.soft * 2.5), cellCrop };
    }
    const lf = layerFilter(layer, idx, layerIndex, canvas, layerLuts[layer.id] || "", maskIn);
    filters.push(lf.chain);
    filters.push(lf.overlay(v, `[vl${idx}]`));
    v = `[vl${idx}]`;
    const info = layerInfo[layer.src];
    if (layer.kind === "video" && info && info.hasAudio && !layer.muted && layer.volume > 0) {
      const dur = layerDuration(layer);
      const delay = Math.round(layer.start * 1000);
      filters.push(
        `[${layerIndex}:a]asetpts=PTS-STARTPTS,${[...atempoChain(layer.speed), `volume=${layer.volume}`].join(",")},` +
          `atrim=duration=${round3(dur)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay}[la${idx}]`
      );
      extraAudio.push({ label: `[la${idx}]`, duck: false });
    }
    inputIndex++;
  });

  if (project.logo && project.logo.path) {
    args.push("-loop", "1", "-i", project.logo.path);
    const lw = Math.round(canvas.width * project.logo.size);
    const m = Math.round(Math.min(canvas.width, canvas.height) * 0.045);
    const corner = project.logo.corner || "top-right";
    const x = corner.endsWith("left") ? `${m}` : `W-w-${m}`;
    const y = corner.startsWith("top") ? `${m}` : `H-h-${m}`;
    filters.push(`[${inputIndex}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=${project.logo.opacity}[logo]`);
    filters.push(`${v}[logo]overlay=${x}:${y}:shortest=1[vlogo]`);
    v = "[vlogo]";
    inputIndex++;
  }

  if (assFile) {
    // Пути относительные: сборка идёт из рабочей папки. Путь Windows с
    // двоеточием внутри фильтра ffmpeg пришлось бы экранировать в три слоя.
    filters.push(`${v}ass=${assFile}${fontsDir ? `:fontsdir=${fontsDir}` : ""}[vsub]`);
    v = "[vsub]";
  }

  const labels = [...extraAudio];
  (project.audio || []).forEach((m, k) => {
    if (m.start >= total) return;
    if (m.loop) args.push("-stream_loop", "-1");
    args.push("-i", m.src);
    const len = round3(Math.min(m.out - m.in, Math.max(0.1, total - m.start)));
    const delay = Math.round(m.start * 1000);
    filters.push(
      `[${inputIndex}:a]atrim=start=${m.in}:duration=${len},asetpts=PTS-STARTPTS,volume=${m.volume},` +
        [...audioEffect(m.effect), ""].join(",") +
        `afade=t=in:st=0:d=${Math.max(0.005, Math.min(m.fadeIn, len / 2))},afade=t=out:st=${round3(Math.max(0, len - m.fadeOut))}:d=${Math.max(0.005, Math.min(m.fadeOut, len / 2))},` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay}[m${k}]`
    );
    labels.push({ label: `[m${k}]`, duck: m.duck });
    inputIndex++;
  });
  if (labels.length) {
    const ducked = labels.filter((l) => l.duck);
    const plain = labels.filter((l) => !l.duck);
    const voiceParts = [];
    if (ducked.length) {
      // Музыка приседает, пока звучит голос: голос — управляющий сигнал компрессора.
      filters.push(`${a}asplit=2[voice][sc]`);
      a = "[voice]";
      const mixIn = ducked.map((l) => l.label).join("");
      filters.push(`${mixIn}amix=inputs=${ducked.length}:normalize=0[musicd]`);
      filters.push(`[musicd][sc]sidechaincompress=threshold=0.04:ratio=10:attack=15:release=350[ducked]`);
      voiceParts.push("[ducked]");
    }
    voiceParts.push(...plain.map((l) => l.label));
    filters.push(`${a}${voiceParts.join("")}amix=inputs=${1 + voiceParts.length}:normalize=0:duration=first[amix]`);
    a = "[amix]";
  }
  // На чистой тишине (ролик из картинок и моушна без музыки) loudnorm делит на
  // ноль и роняет кодер звука — выравнивать там нечего.
  if (project.audioFx && project.audioFx.loudnorm && audible) {
    // Громкость под соцсети: −14 LUFS, как у YouTube и Reels.
    filters.push(`${a}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[anorm]`);
    a = "[anorm]";
  }
  filters.push(`${v}format=yuv420p[vout]`);
  args.push(
    "-filter_complex_script", "graph.txt",
    // Звук без обработки — это поток входа, а не выход графа: в скобках ffmpeg
    // искал бы его среди меток графа и не нашёл.
    "-map", "[vout]", "-map", /^\[\d+:a\]$/.test(a) ? a.slice(1, -1) : a,
    "-t", String(round3(total)),
    ...(codec || fx.codecArgs("mp4", "normal", canvas.fps)),
    outPath
  );
  return { args, graph: filters.join(";\n"), duration: round3(total) };
}

function runFfmpeg(bin, args, { cwd, onProgress, total, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let err = "";
    let out = "";
    const abort = () => child.kill("SIGKILL");
    if (signal) signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (d) => {
      out += d.toString();
      const lines = out.split(/\r?\n/);
      out = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
        if (m && onProgress && total) onProgress(clamp(Number(m[1]) / 1e6 / total, 0, 1));
      }
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-20000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", abort);
      if (signal && signal.aborted) return reject(new Error("Сборка остановлена."));
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg завершился с ошибкой (${code}): ${err.trim().split("\n").slice(-6).join("\n")}`));
    });
  });
}

/** Тишина в записи — тем же ffmpeg, порог и минимальная длина из silence_cutter. */
async function detectSilences(bin, file, { thresholdDb = -35, minDuration = 0.3, total } = {}) {
  const stderr = await new Promise((resolve, reject) => {
    const child = spawn(bin, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, "-f", "null", "-"], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(err));
  });
  return parseSilences(stderr, total);
}

/** Есть ли в файле звук — без звука кусок получает тишину. */
async function probeMedia(bin, file) {
  const stderr = await new Promise((resolve) => {
    const child = spawn(bin, ["-hide_banner", "-i", file], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(err));
  });
  const d = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = stderr.match(/Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/);
  const fps = stderr.match(/(\d+(?:\.\d+)?) fps/);
  const codec = stderr.match(/Stream #[^\n]*Video:\s*(\w+)/);
  const rot = stderr.match(/rotation of (-?[\d.]+)/) || stderr.match(/rotate\s*:\s*(-?\d+)/);
  let width = v ? Number(v[1]) : 0;
  let height = v ? Number(v[2]) : 0;
  // Телефонное видео пишется лёжа с пометкой о повороте; ffmpeg поворачивает
  // его сам, поэтому и размеры надо считать уже повёрнутые.
  if (rot && Math.abs(Math.abs(Number(rot[1])) - 90) < 1) [width, height] = [height, width];
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    hasVideo: !!v && !/Video: (png|mjpeg)[^\n]*attached pic/.test(stderr),
    hasAudio: /Stream #[^\n]*Audio:/.test(stderr),
    width,
    height,
    fps: fps ? Number(fps[1]) : 0,
    videoCodec: codec ? codec[1].toLowerCase() : "",
  };
}

/**
 * Нужна ли лёгкая копия для предпросмотра. Плеер окна тянет H.264/VP9 до
 * Full HD; HEVC с телефона, ProRes, 4K и 50–60 кадров на длинном исходнике
 * он либо не показывает вовсе, либо показывает рывками.
 */
function needsProxy(info, file) {
  if (!info || !info.hasVideo) return false;
  const ext = path.extname(String(file || "")).toLowerCase();
  if (![".mp4", ".m4v", ".webm", ".mov"].includes(ext)) return true;
  if (!["h264", "vp8", "vp9", "av1"].includes(info.videoCodec)) return true;
  if (Math.max(info.width, info.height) > 1920) return true;
  if (info.fps > 31 && info.duration > 120) return true;
  return false;
}

/**
 * Собрать проект в mp4.
 *
 * Три шага: каждый кусок — в одинаковый промежуточный файл; куски без
 * переходов — склейкой без перекодирования; группы — переходами, сверху
 * субтитры, надписи, логотип и музыка. Рабочая папка стирается в любом случае.
 */
async function renderProject({ bin, project: raw, transcripts = {}, outPath, workDir, fontFiles = [], onProgress, signal, exportOptions = {} }) {
  const project = normalizeProject(raw);
  const problems = validateProject(project);
  if (problems.length) throw new Error(problems.join("\n"));
  const report = (stage, progress, extra = {}) => onProgress && onProgress({ stage, progress, ...extra });
  await fs.mkdir(workDir, { recursive: true });

  // Размер и частота кадров экспорта. Надписи, субтитры, слои и логотип
  // заданы долями кадра, поэтому сами встают на место при любом размере.
  const format = fx.EXPORT_FORMATS.some((f) => f.id === exportOptions.format) ? exportOptions.format : "mp4";
  const size = fx.exportSize(project.canvas, exportOptions.size);
  project.canvas = { ...project.canvas, ...size, fps: clamp(Math.round(num(exportOptions.fps, project.canvas.fps)), 12, 60) };
  // Подписи и тексты считались под 1080 по короткой стороне — масштаб тот же.

  if ([...project.clips, ...project.layers].some((c) => c.kind === "motion")) throw new Error("Моушн не отрендерен в файл перед сборкой.");
  const probes = new Map();
  for (const c of [...project.clips, ...project.layers]) {
    // Картинки мерить незачем — кроме тех, где убирается водяной знак: там
    // нужен размер кадра в пикселях.
    if ((c.kind === "image" && !(c.erase && c.erase.length) && !(c.mask && c.mask !== "none") && !c.bgRemove) || probes.has(c.src)) continue;
    probes.set(c.src, await probeMedia(bin, c.src));
  }

  // LUT — файлом в рабочей папке: сборка идёт из неё, а путь Windows внутри
  // фильтра ffmpeg пришлось бы экранировать в три слоя.
  const lutNames = new Map();
  const lutFor = async (lut) => {
    if (!lut) return "";
    if (lutNames.has(lut)) return lutNames.get(lut);
    const name = `lut-${lutNames.size}${path.extname(lut).toLowerCase() || ".cube"}`;
    try {
      await fs.copyFile(lut, path.join(workDir, name));
    } catch {
      throw new Error(`Файл LUT не открывается: ${lut}`);
    }
    lutNames.set(lut, name);
    return name;
  };

  // 1. Куски.
  const segFiles = [];
  for (let i = 0; i < project.clips.length; i++) {
    if (signal && signal.aborted) throw new Error("Сборка остановлена.");
    const clip = project.clips[i];
    const info = probes.get(clip.src);
    if (clip.kind !== "image" && info && !info.hasVideo) throw new Error(`«${path.basename(clip.src)}» — это звук, а не видео. Звук кладётся на звуковую дорожку.`);
    const file = path.join(workDir, `seg-${String(i).padStart(4, "0")}.mkv`);
    const lutName = await lutFor(clip.adjust.lut);
    const { args, duration } = buildClipArgs(clip, project.canvas, path.basename(file), { hasAudio: clip.kind === "image" ? false : !!(info && info.hasAudio), denoise: project.audioFx.denoise, lutName, srcW: (info && info.width) || 0, srcH: (info && info.height) || 0, bgMask: clip.bgRemove && clip.bgRemove.cache && clip.bgRemove.cache.key === bgKey(clip) ? clip.bgRemove.cache.mask : "" });
    report("pieces", i / project.clips.length, { index: i, total: project.clips.length });
    await runFfmpeg(bin, args, { cwd: workDir, signal });
    segFiles.push({ file, duration });
  }

  // 2. Группы без переходов — склейкой.
  const groups = [];
  for (const [gi, g] of groupByTransitions(project.clips).entries()) {
    const files = g.indices.map((i) => segFiles[i]);
    const duration = files.reduce((a, f) => a + f.duration, 0);
    let file = files[0].file;
    if (files.length > 1) {
      const list = path.join(workDir, `group-${gi}.txt`);
      await fs.writeFile(list, concatList(files.map((f) => path.basename(f.file))), "utf-8");
      file = path.join(workDir, `group-${gi}.mkv`);
      await runFfmpeg(bin, ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.basename(list), "-c", "copy", path.basename(file)], { cwd: workDir, signal });
    }
    groups.push({ file: path.basename(file), duration, transition: g.transition });
  }
  report("join", 1);

  // 3. Субтитры и надписи.
  let assFile = "";
  let fontsDir = "";
  const words = project.captions.enabled ? outputWords(project, transcripts) : [];
  if (words.length || project.texts.length) {
    const fonts = { byPath: {} };
    // Шрифты надписей — каждый своим файлом: у надписи свой шрифт и шрифт акцента.
    const textFonts = [...new Set(project.texts.flatMap((t) => [t.fontPath, t.accentFontPath]).filter(Boolean))].map((p) => ({ path: p, role: "path" }));
    const usable = [...fontFiles, ...textFonts].filter((f) => f && f.path);
    if (usable.length) {
      fontsDir = "fonts";
      await fs.mkdir(path.join(workDir, fontsDir), { recursive: true });
      const { familyFromFontFile } = require("./videostories.cjs");
      for (const [k, f] of usable.entries()) {
        try {
          const buf = await fs.readFile(f.path);
          await fs.writeFile(path.join(workDir, fontsDir, `font-${k}${path.extname(f.path).toLowerCase()}`), buf);
          // ASS ищет шрифт по семейству, записанному внутри файла, а не по имени файла.
          const family = familyFromFontFile(buf) || f.family;
          if (f.role === "path") fonts.byPath[f.path] = family;
          else if (f.role === "text") fonts.textFamily = family;
          else if (!fonts.family) fonts.family = family;
        } catch {
          // нечитаемый шрифт — субтитры уйдут запасным, это видно по предупреждению
        }
      }
    }
    assFile = "captions.ass";
    await fs.writeFile(path.join(workDir, assFile), buildAss(project, words, fonts), "utf-8");
  }

  const layerLuts = {};
  for (const l of project.layers) layerLuts[l.id] = await lutFor(l.adjust.lut);
  // Маски слоёв — под точный размер слоя в момент маски: ячейка раскладки или кадр исходника.
  const layerMasks = {};
  for (const [i, l] of project.layers.entries()) {
    if (l.mask === "none") continue;
    const info = probes.get(l.src);
    const even = (v) => Math.max(2, Math.round(v / 2) * 2);
    const w = l.cell ? even(l.cell.w * project.canvas.width) : info && info.width;
    const h = l.cell ? even(l.cell.h * project.canvas.height) : info && info.height;
    if (!w || !h) continue;
    const m = await prepareMask(bin, l, w, h, workDir, i).catch(() => null);
    if (m) layerMasks[l.id] = { ...m, w, h };
  }
  const layerInfo = Object.fromEntries(probes);
  const def = fx.EXPORT_FORMATS.find((f) => f.id === format);
  // GIF и звук делаются из готового ролика: так в них ровно то же, что в mp4.
  const direct = def.kind === "video";
  const master = direct ? path.resolve(outPath) : path.join(workDir, "master.mp4");
  const codec = fx.codecArgs(direct ? format : "mp4", exportOptions.quality || "normal", project.canvas.fps);
  const audible =
    project.audio.some((a) => a.volume > 0) ||
    project.clips.some((c) => c.kind !== "image" && !c.muted && c.volume > 0 && probes.get(c.src) && probes.get(c.src).hasAudio) ||
    project.layers.some((l) => l.kind === "video" && !l.muted && l.volume > 0 && probes.get(l.src) && probes.get(l.src).hasAudio);
  const final = buildFinalArgs({ groups, project, assFile, fontsDir, outPath: master, codec, layerInfo, layerLuts, audible, layerMasks });
  await fs.writeFile(path.join(workDir, "graph.txt"), final.graph, "utf-8");
  await runFfmpeg(bin, final.args, { cwd: workDir, total: final.duration, onProgress: (p) => report("encode", p), signal });
  if (!direct) {
    report("convert", 0);
    await runFfmpeg(bin, fx.derivedArgs(format, master, path.resolve(outPath), { gifWidth: exportOptions.gifWidth, gifFps: exportOptions.gifFps }), { signal });
  }
  report("done", 1);
  return { path: outPath, duration: final.duration, captions: words.length, format, width: project.canvas.width, height: project.canvas.height };
}

// ---------- ИИ-монтажёр ----------

function stamp(t) {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

/**
 * Расшифровка для агента: фразы с номерами слов.
 *
 * Агент режет по номерам слов, а не по секундам. Секунды модель путает и
 * выдумывает, а номер слова либо есть в тексте, либо нет — промах видно сразу.
 * Паразиты помечены прямо в тексте, чтобы агент решал по смыслу, а не искал их.
 */
function transcriptForAgent(files, { maxWordsPerFile = 14000 } = {}) {
  const lines = [];
  files.forEach((f, fi) => {
    const words = (f.words || []).slice(0, maxWordsPerFile);
    const dur = f.duration ? ` · длительность ${stamp(f.duration)}` : "";
    lines.push(`\n### Файл F${fi + 1}: ${f.name}${dur}${f.wordLevel ? "" : " · время слов приблизительное"}`);
    let phrase = [];
    const flush = () => {
      if (!phrase.length) return;
      const a = phrase[0];
      const b = phrase[phrase.length - 1];
      const text = phrase
        .map(({ w }) => {
          if (w.filler === "sound") return `[${w.w}]`;
          if (w.filler) return `‹${w.w}›`;
          if (w.repeat) return `${w.w}⁺`;
          return w.w;
        })
        .join(" ");
      lines.push(`F${fi + 1}:w${a.i}–w${b.i} [${stamp(a.w.s)}–${stamp(b.w.e)}] ${text}`);
      phrase = [];
    };
    words.forEach((w, i) => {
      const prev = phrase[phrase.length - 1];
      if (prev && (w.s - prev.w.e > 0.8 || phrase.length >= 28)) flush();
      phrase.push({ w, i });
      if (/[.!?…]$/.test(w.w) && phrase.length >= 6) flush();
    });
    flush();
    if ((f.words || []).length > maxWordsPerFile) lines.push(`(дальше файл обрезан: показаны первые ${maxWordsPerFile} слов)`);
  });
  return lines.join("\n");
}

/**
 * Задание ИИ-монтажёру.
 * @param {{files:object[], design?:string, canvas?:object, captionStyles?:object[]}} input
 */
function buildAgentPrompt({ files, design = "", canvas = CANVAS_PRESETS[0] }) {
  return `Ты — ИИ-монтажёр в видеоредакторе. Тебе дана расшифровка записей с номерами слов. Человек говорит, что сделать
(например «сделай 3 клипа по 30–60 секунд для рилс»), а ты решаешь, ЧТО вырезать и КАК подать.

КАК ЧИТАТЬ РАСШИФРОВКУ
- Строка: \`F1:w120–w148 [02:10.4–02:19.0] текст\` — файл, номера первого и последнего слова, время, текст.
- [э-э] — звук-заполнитель, его приложение вырежет само.
- ‹ну›, ‹вот›, ‹типа› — возможный паразит. Реши по смыслу: «вот почему» — нужное слово, «ну вот, значит» — мусор.
- слово⁺ — запинка, слово сказано дважды подряд; первое приложение уберёт само.
- Паузы приложение сокращает само до короткого вдоха. Тебе их искать не нужно.

КАК ВЫБИРАТЬ КЛИПЫ (критерии из clip-factory)
1. Хук в первые 2–3 секунды: клип начинается с самой сильной фразы, а не с разгона («итак», «сегодня я расскажу»).
   Если сильная фраза в середине мысли — можно вынести её в начало отдельным куском (порядок кусков задаёшь ты).
2. Клип понятен без контекста: никаких «как я уже говорил», «это», «он» без того, к чему они относятся.
   Если без контекста непонятно — расширь границы или откажись от фрагмента.
3. Клип заканчивается на развязке, а не обрывается перед ней.
4. Лучшие — не первые попавшиеся: смотри весь материал, бери разные темы и разные места записи.
5. Режь внутри клипа всё, что не работает на мысль: отступления, повторы мысли, оговорки, переформулировки
   («то есть, вернее, я хотел сказать»), неудачные дубли — если фраза сказана дважды, оставь лучший дубль.

НАДПИСИ ПО СМЫСЛУ
- hook: короткий хук сверху на первые 2–4 секунды (3–7 слов, цепляет, не пересказывает).
- title / label / lower: 1–3 надписи на ключевых мыслях — цифра, вывод, термин. Не дублируй субтитры дословно.
- Привязывай надпись к слову (at: "F1:w130"), длительность в секундах.

ФОРМАТ ОТВЕТА
Сначала коротко человеческим языком — какие клипы и почему. Затем ровно один блок:

===МОНТАЖ===
{"clips":[
  {"name":"Короткое название","hook":"Текст хука","description":"Подпись для публикации, 1–2 предложения + 3–5 хэштегов",
   "pieces":[{"from":"F1:w120","to":"F1:w148"},{"from":"F1:w160","to":"F1:w201"}],
   "cut":["F1:w133","F1:w140–w142"],
   "texts":[{"at":"F1:w120","text":"Хук на экран","style":"hook","duration":3},{"at":"F1:w170","text":"3 ошибки","style":"title","duration":2}],
   "captions":"karaoke",
   "transition":"none"}
]}
===КОНЕЦ===

- pieces — куски в порядке показа; from/to — номера слов ВКЛЮЧИТЕЛЬНО. Куски могут быть из разных файлов.
- cut — слова внутри кусков, которые надо вырезать (паразиты по смыслу, оговорки, лишнее).
- captions — стиль субтитров: karaoke | bold | pop | box | clean | none.
- transition — переход между кусками: none (обычная склейка, по умолчанию для говорящей головы) | fade | fadeblack | zoomin | slideleft.
- Номера слов бери ТОЛЬКО из расшифровки. Не выдумывай время и номера.
- Если просят не клипы, а один ролик (смонтировать запись целиком, сделать короче) — это один элемент в clips.
- Холст: ${canvas.width}×${canvas.height}.${design ? `\n\nДИЗАЙН-СИСТЕМА (тексты пиши в её тоне; цвета и шрифт приложение возьмёт из неё само):\n${design}` : ""}

РАСШИФРОВКА
${transcriptForAgent(files)}`;
}

/** «F2:w140» или «F2:w140–w142» → {file, from, to}. */
function parseWordRef(ref) {
  const m = String(ref || "").trim().match(/^F(\d+)\s*:\s*w(\d+)(?:\s*[-–—]\s*(?:F\d+\s*:\s*)?w?(\d+))?$/i);
  if (!m) return null;
  const from = Number(m[2]);
  return { file: Number(m[1]) - 1, from, to: m[3] !== undefined ? Number(m[3]) : from };
}

/** Блок ===МОНТАЖ=== из ответа агента. Терпим к потерянной закрывающей метке. */
function parsePlan(text) {
  const src = String(text || "");
  const at = src.indexOf("===МОНТАЖ===");
  if (at < 0) return null;
  let body = src.slice(at + "===МОНТАЖ===".length);
  const end = body.indexOf("===КОНЕЦ===");
  if (end >= 0) body = body.slice(0, end);
  body = body.replace(/```(?:json)?/g, "").trim();
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last < first) return null;
  let data;
  try {
    data = JSON.parse(body.slice(first, last + 1));
  } catch {
    return null;
  }
  const clips = Array.isArray(data) ? data : Array.isArray(data.clips) ? data.clips : [];
  return {
    clips: clips
      .map((c, i) => ({
        name: String(c.name || `Клип ${i + 1}`),
        hook: String(c.hook || ""),
        description: String(c.description || ""),
        pieces: (c.pieces || []).map((p) => ({ from: String(p.from || ""), to: String(p.to || p.from || "") })),
        cut: (c.cut || []).map(String),
        texts: (c.texts || []).map((t) => ({
          at: String(t.at || ""),
          text: String(t.text || ""),
          style: String(t.style || "title"),
          duration: num(t.duration, 2.5),
        })),
        captions: String(c.captions || "karaoke"),
        transition: String(c.transition || "none"),
      }))
      .filter((c) => c.pieces.length),
  };
}

/**
 * План агента → проект на таймлайне.
 *
 * Каждый кусок плана проходит обычную чистку (паузы, звуки, безопасные
 * паразиты, запинки) плюс вырезанное агентом по смыслу. Надписи из «слова»
 * переводятся во время на выходе после всех резов — поэтому надпись встаёт на
 * то самое слово, а не туда, где оно было в исходнике.
 *
 * @param {object} planClip — элемент plan.clips
 * @param {{path:string,name:string,words:object[]}[]} files — в том же порядке, что F1, F2…
 */
function planToProject(planClip, files, { canvas, captions, cleanup = {}, punchIn = 0.08, design } = {}) {
  const problems = [];
  const cutByFile = new Map();
  for (const ref of planClip.cut) {
    const r = parseWordRef(ref);
    if (!r || !files[r.file]) {
      problems.push(`Не понял, что вырезать: «${ref}».`);
      continue;
    }
    if (!cutByFile.has(r.file)) cutByFile.set(r.file, new Set());
    for (let i = Math.min(r.from, r.to); i <= Math.max(r.from, r.to); i++) cutByFile.get(r.file).add(i);
  }
  const clips = [];
  const transition = TRANSITIONS.some((t) => t.id === planClip.transition) ? planClip.transition : "none";
  planClip.pieces.forEach((piece, pi) => {
    const a = parseWordRef(piece.from);
    const b = parseWordRef(piece.to);
    if (!a || !b || a.file !== b.file || !files[a.file]) {
      problems.push(`Кусок ${pi + 1}: непонятные границы «${piece.from} – ${piece.to}».`);
      return;
    }
    const f = files[a.file];
    const words = f.words || [];
    const i0 = Math.max(0, Math.min(a.from, b.to));
    const i1 = Math.min(words.length - 1, Math.max(a.from, b.to));
    if (!words[i0] || !words[i1]) {
      problems.push(`Кусок ${pi + 1}: таких слов в «${f.name}» нет (w${a.from}–w${b.to}).`);
      return;
    }
    // Граница куска — по краям слов, с тем же отступом, что и у чистки.
    const range = { from: words[i0].s - 0.001, to: words[i1].e + 0.001, cut: cutByFile.get(a.file) };
    const pieces = planKeeps(words, range, cleanup);
    const base = normalizeClip({ src: f.path, kind: mediaKind(f.path) || "video", in: 0, out: 1, transition: { kind: pi === 0 ? "none" : transition, duration: 0.35 } });
    clips.push(...piecesToClips(base, pieces, { punchIn }));
  });

  const project = normalizeProject({
    title: planClip.name,
    canvas,
    clips,
    captions: {
      ...defaultCaptions(),
      ...(captions || {}),
      enabled: planClip.captions !== "none",
      style: CAPTION_STYLES.some((s) => s.id === planClip.captions) ? planClip.captions : (captions && captions.style) || "karaoke",
    },
    design,
    meta: { hook: planClip.hook, description: planClip.description, source: "agent" },
  });

  // Надписи: слово → время на выходе.
  for (const t of planClip.texts) {
    const r = parseWordRef(t.at);
    const f = r && files[r.file];
    const w = f && f.words[r.from];
    if (!w) {
      problems.push(`Надпись «${t.text}»: нет слова ${t.at}.`);
      continue;
    }
    let start = sourceToOutput(project.clips, f.path, w.s);
    // Слово вырезали — ставим надпись на ближайшее оставшееся после него.
    for (let k = r.from + 1; start === null && k < Math.min(f.words.length, r.from + 40); k++) {
      start = sourceToOutput(project.clips, f.path, f.words[k].s);
    }
    if (start === null) {
      problems.push(`Надпись «${t.text}»: слово ${t.at} не попало в клип.`);
      continue;
    }
    project.texts.push(normalizeText({ text: t.text, start, end: start + clamp(t.duration, 0.8, 8), style: t.style, animation: t.style === "hook" ? "pop" : "slide" }));
  }
  // Хук, о котором агент написал, но который не поставил надписью, — ставим сами.
  if (planClip.hook && !project.texts.some((t) => t.style === "hook")) {
    project.texts.unshift(normalizeText({ text: planClip.hook, start: 0, end: Math.min(3.5, projectDuration(project)), style: "hook", animation: "pop" }));
  }
  return { project, problems };
}

/** Проверка проекта перед сборкой — то, что видно заранее, а не через пять минут рендера. */
function validateProject(project) {
  const problems = [];
  if (!project.clips.length) problems.push("На главной дорожке нет ни одного куска — собирать нечего.");
  const total = projectDuration(project);
  for (const t of project.texts) {
    if (t.start >= total) problems.push(`Надпись «${t.text.slice(0, 30)}» начинается после конца ролика.`);
    if (!t.text.trim()) problems.push("Есть пустая надпись.");
  }
  project.clips.forEach((c, i) => {
    if (c.out - c.in < 0.05) problems.push(`Кусок ${i + 1} короче кадра.`);
    if (c.kind === "motion" && !c.motion.html && !c.motion.template) problems.push(`Моушн ${i + 1} пустой — в нём нет кода.`);
  });
  for (const l of project.layers || []) {
    if (l.start >= total) problems.push(`Слой «${l.kind === "motion" ? l.motion.title || "моушн" : path.basename(l.src)}» начинается после конца ролика.`);
  }
  for (const a of project.audio) {
    if (a.start >= total) problems.push(`Звук «${path.basename(a.src)}» начинается после конца ролика.`);
  }
  return problems;
}

// ---------- хранение проектов ----------

async function listProjects(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const p = normalizeProject(JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")));
      out.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, duration: projectDuration(p), clips: p.clips.length, preset: p.canvas.preset, meta: p.meta });
    } catch {
      // битый файл не должен прятать остальные проекты
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function safeId(id) {
  return String(id || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
}

async function readProject(dir, id) {
  return normalizeProject(JSON.parse(await fs.readFile(path.join(dir, `${safeId(id)}.json`), "utf-8")));
}

async function writeProject(dir, raw) {
  const project = normalizeProject({ ...raw, updatedAt: Date.now() });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${safeId(project.id)}.json`), JSON.stringify(project, null, 1), "utf-8");
  return project;
}

async function deleteProject(dir, id) {
  await fs.rm(path.join(dir, `${safeId(id)}.json`), { force: true });
}

module.exports = {
  CANVAS_PRESETS,
  FIT_MODES,
  FILTERS,
  TRANSITIONS,
  CAPTION_STYLES,
  TEXT_STYLES,
  TEXT_ANIMATIONS,
  CLEANUP_DEFAULTS,
  SOUND_FILLER,
  mediaKind,
  bgKey,
  LAYER_MASKS,
  masksDir,
  normalizeMotion,
  gradeChain,
  eraseGraph,
  normalizeErase,
  needsProxy,
  normWord,
  splitWords,
  layoutWords,
  trimIntoSilence,
  markFillers,
  buildWords,
  parseSilences,
  planKeeps,
  cleanupStats,
  defaultCaptions,
  normalizeClip,
  normalizeText,
  normalizeAudio,
  normalizeProject,
  clipDuration,
  layout,
  projectDuration,
  sourceToOutput,
  outputToSource,
  splitAt,
  cutWordsFromClip,
  piecesToClips,
  cleanClip,
  assColor,
  assTime,
  outputWords,
  captionLines,
  buildAss,
  atempoChain,
  clipVideoFilter,
  clipAudioFilter,
  frameDuration,
  buildClipArgs,
  groupByTransitions,
  concatList,
  buildFinalArgs,
  runFfmpeg,
  normalizeLayer,
  layerDuration,
  normalizeEffects,
  hasTransform,
  colorChain,
  probeMedia,
  renderProject,
  detectSilences,
  transcriptForAgent,
  buildAgentPrompt,
  parseWordRef,
  parsePlan,
  planToProject,
  validateProject,
  listProjects,
  readProject,
  writeProject,
  deleteProject,
  uid,
};
