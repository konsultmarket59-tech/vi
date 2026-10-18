// Шрифты «Монтажа»: встроенная библиотека с кириллицей, шрифты системы и
// дизайн-системы — и шрифтовые пары для заголовков и титров.
//
// Встроенные шрифты — Google Fonts под OFL: фиксированные начертания вырезаны
// из вариативных файлов и переименованы («Oswald Bold»), чтобы и окно, и
// субтитры ffmpeg (libass) находили их по одному имени. Лежат файлами вне
// архива приложения: ffmpeg читает шрифт с диска и не видит внутрь asar.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function fontsDir() {
  return path.join(__dirname, "..", "fonts").replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
}

let cached = null;
/** Встроенная библиотека: [{id, family, category, path}]. */
function library() {
  if (cached) return cached;
  try {
    const dir = fontsDir();
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "fonts.json"), "utf-8"));
    cached = meta.map((f) => ({ id: f.id, family: f.family, category: f.category, path: path.join(dir, f.file) })).filter((f) => fs.existsSync(f.path));
  } catch {
    cached = [];
  }
  return cached;
}

const CATEGORY_NAMES = { display: "Акцидентные", sans: "Гротески", serif: "С засечками", script: "Рукописные" };

/**
 * Шрифтовые пары — как в трендовых заголовках рилс: крупный плотный шрифт и
 * второй, контрастный (рукописный, курсив, тонкий) для акцентного слова.
 * head — основной, accent — для *слов в звёздочках*, body — подписи.
 */
const PAIRS = [
  { id: "reels", name: "Рилс: узкий + рукопись", head: "oswald-bold", accent: "caveat-bold", body: "montserrat-semibold", upper: true, sample: "Шрифтовые *пары*" },
  { id: "magazine", name: "Журнал", head: "playfair-black", accent: "great-vibes", body: "montserrat-light", upper: false, sample: "Новый *формат* рилс" },
  { id: "cinema", name: "Кино", head: "cormorant-bold", accent: "cormorant-italic", body: "tenor-sans", upper: true, spacing: 0.12, sample: "Тихий *вечер*" },
  { id: "minimal", name: "Минимал", head: "montserrat-black", accent: "montserrat-light", body: "montserrat-light", upper: true, sample: "Как улучшить *качество*" },
  { id: "wide", name: "Широкий", head: "unbounded-black", accent: "unbounded-medium", body: "manrope-medium", upper: true, sample: "Дом *мечты*" },
  { id: "retro", name: "Ретро", head: "rubik-mono-one", accent: "pacifico", body: "rubik-black", upper: true, sample: "Лето *80-х*" },
  { id: "neon", name: "Неон", head: "lobster", accent: "lobster", body: "montserrat-semibold", upper: false, glow: true, sample: "Завораживающий *звук*" },
  { id: "elegant", name: "Элегант", head: "prata", accent: "bad-script", body: "tenor-sans", upper: false, sample: "Утро *у моря*" },
  { id: "tech", name: "Тех", head: "russo-one", accent: "inter-bold", body: "inter-regular", upper: true, sample: "Обзор *за 60 секунд*" },
  { id: "poetry", name: "Поэзия", head: "poiret-one", accent: "great-vibes", body: "poiret-one", upper: true, sample: "Мои *мысли*" },
  { id: "tall", name: "Высокий + скрипт", head: "alumni-bold", accent: "marck-script", body: "manrope-medium", upper: true, sample: "Качество *роликов*" },
  { id: "poster", name: "Плакат", head: "fira-xc-black", accent: "caveat-bold", body: "fira-xc-black", upper: true, sample: "Распродажа *до пятницы*" },
  { id: "classic", name: "Классика", head: "yeseva-one", accent: "cormorant-italic", body: "forum", upper: false, sample: "Сила *привычки*" },
  { id: "soft", name: "Мягкий", head: "comfortaa-bold", accent: "marck-script", body: "comfortaa-bold", upper: false, sample: "Уютный *дом*" },
  { id: "heavy", name: "Тяжёлый", head: "rubik-black", accent: "caveat-bold", body: "manrope-medium", upper: true, sample: "Не делайте *так*" },
  { id: "folk", name: "Рукописный", head: "amatic-bold", accent: "neucha", body: "neucha", upper: true, sample: "Домашний *рецепт*" },
];

function byId(id) {
  return library().find((f) => f.id === id) || null;
}

/** Пара с путями к файлам: {id, name, head:{family,path}, accent, body, …}. */
function pair(id) {
  const p = PAIRS.find((x) => x.id === id);
  if (!p) return null;
  const head = byId(p.head);
  if (!head) return null;
  return { ...p, head, accent: byId(p.accent) || head, body: byId(p.body) || head };
}

function pairs() {
  return PAIRS.map((p) => pair(p.id)).filter(Boolean);
}

/** Шрифты системы: на Windows — и общие, и поставленные только для себя. */
let systemCache = null;
async function system() {
  if (systemCache) return systemCache;
  const { listFonts } = require("./videostories.cjs");
  const extra = process.platform === "win32" ? [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Microsoft", "Windows", "Fonts")] : [];
  systemCache = await listFonts(process.platform, extra).catch(() => []);
  return systemCache;
}

module.exports = { fontsDir, library, pairs, pair, byId, system, CATEGORY_NAMES, PAIRS };
