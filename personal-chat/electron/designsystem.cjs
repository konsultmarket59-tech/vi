// Дизайн-система: какие файлы из неё доходят до задания.
//
// Почему это отдельный модуль. Дизайн-систему выгружают из Фигмы или Pixso, и
// выгружается она ПАПКАМИ: fonts, logos, components, templates. Сбор шёл только
// по верхнему уровню — всё, что лежало во вложенных папках, для приложения не
// существовало. Со стороны это выглядело как «не слушает дизайн-систему»:
// человек подключил папку целиком, а до задания доехали два файла из корня.
//
// Второе: шрифт в дизайн-системе — это ФАЙЛ, а не название. Задание вида
// «шрифт Dinamika» ничего не даёт, если самого файла в сцене нет: браузер молча
// подставит запасной, и ролик выйдет не тем шрифтом. Поэтому файлы шрифтов
// здесь опознаются отдельно — чтобы их можно было вшить, а не упомянуть.

const fs = require("node:fs/promises");
const path = require("node:path");

/** Шрифты бывают и в woff: из Фигмы выгружается чаще всего именно он. */
const FONT_EXTENSIONS = [".ttf", ".otf", ".ttc", ".woff", ".woff2"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"];

/** Папки, в которые заходить незачем: это не дизайн-система, а служебное. */
const SKIP_DIRS = new Set([".git", "node_modules", ".DS_Store", "__MACOSX", ".idea", ".vscode"]);

/** Глубже этого вложенность у выгрузок не встречается, а обход дорожает. */
const MAX_DEPTH = 6;

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (FONT_EXTENSIONS.includes(ext)) return "шрифт";
  if (IMAGE_EXTENSIONS.includes(ext)) return "картинка";
  return "другое";
}

/**
 * Похоже ли это на логотип.
 *
 * По имени файла и по папке: варианты логотипа почти всегда так и называются,
 * и отличить их от прочих картинок иначе нечем.
 */
function looksLikeLogo(rel) {
  return /(^|[\\/_. -])(логотип|лого|logo|logotype|brandmark|wordmark)/i.test(String(rel || ""));
}

/**
 * Файлы дизайн-системы, включая вложенные папки.
 *
 * Возвращает и относительный путь: «logos/logo-primary.svg» говорит модели
 * больше, чем «logo-primary.svg», — по папке видно, что это логотип, а не
 * случайная картинка.
 *
 * `limit` оставлен и здесь: выгрузка из Фигмы бывает на тысячи файлов, и
 * утащить их все в задание нельзя. Но когда предел сработал, об этом сказано —
 * молча обрезанная дизайн-система и есть то, что выглядит как «не слушает».
 */
async function collectFiles(paths, { limit = 40, maxDepth = MAX_DEPTH } = {}) {
  const files = [];
  let truncated = false;

  async function walk(dir, base, depth) {
    if (depth > maxDepth || files.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Файлы раньше папок: если предел сработает, в задание попадёт корень
    // системы, а не первая попавшаяся вложенная папка.
    const сначала = [...entries].sort((a, b) => Number(a.isDirectory()) - Number(b.isDirectory()));
    for (const entry of сначала) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, base, depth + 1);
      } else if (entry.isFile()) {
        const rel = path.relative(base, full).split(path.sep).join("/");
        files.push({ path: full, name: entry.name, rel, from: base, kind: kindOf(entry.name) });
      }
    }
  }

  for (const p of paths || []) {
    if (files.length >= limit) {
      truncated = true;
      break;
    }
    let stat;
    try {
      stat = await fs.stat(p);
    } catch {
      files.push({ path: p, name: path.basename(p), rel: path.basename(p), missing: true, kind: "другое" });
      continue;
    }
    if (stat.isDirectory()) await walk(p, p, 0);
    else {
      files.push({ path: p, name: path.basename(p), rel: path.basename(p), from: path.dirname(p), kind: kindOf(p) });
    }
  }

  return { files, truncated };
}

/** Что именно нашлось — человеку, чтобы промах был виден, а не молчал. */
function summary(files = []) {
  const шрифты = files.filter((f) => f.kind === "шрифт");
  const картинки = files.filter((f) => f.kind === "картинка");
  return {
    total: files.length,
    fonts: шрифты.length,
    images: картинки.length,
    logos: картинки.filter((f) => looksLikeLogo(f.rel)).length,
    missing: files.filter((f) => f.missing).length,
    fontFiles: шрифты.map((f) => ({ path: f.path, name: f.name, rel: f.rel })),
  };
}

module.exports = { FONT_EXTENSIONS, IMAGE_EXTENSIONS, MAX_DEPTH, kindOf, looksLikeLogo, collectFiles, summary };
