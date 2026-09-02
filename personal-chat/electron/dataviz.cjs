// Визуализация данных: дашборды, диаграммы, майнд-карты, блок-схемы.
//
// Источником может быть что угодно, что у человека уже лежит на диске: таблица,
// документ, скриншот выгрузки — или просто текст в чате. Ничего не копируется
// внутрь приложения: читаются пути, результат кладётся в указанную папку.
//
// Почему HTML, а не библиотека графиков: макет здесь — это цельная картинка со
// своей типографикой и палитрой (её задаёт человек), а не набор стандартных
// чартов. Готовый HTML печатается в PDF и снимается в PNG теми же средствами
// Electron, которыми приложение уже экспортирует документы.
//
// Как и docflow.cjs, модуль не требует electron: всё, что связано с окнами,
// приходит колбэком из main.cjs.

const fs = require("node:fs/promises");
const path = require("node:path");

// Форматы холста. Размер задаётся заранее и жёстко: макет, собранный «как
// получится», нельзя ни напечатать, ни выложить — он приезжает обрезанным.
const CANVAS_PRESETS = [
  { id: "post", name: "Пост 1080×1350", width: 1080, height: 1350 },
  { id: "square", name: "Квадрат 1080×1080", width: 1080, height: 1080 },
  { id: "story", name: "История 1080×1920", width: 1080, height: 1920 },
  { id: "slide", name: "Слайд 1920×1080", width: 1920, height: 1080 },
  { id: "a4", name: "Лист A4 794×1123", width: 794, height: 1123 },
  { id: "dashboard", name: "Дашборд 1400×1000", width: 1400, height: 1000 },
];

// Палитры. Первая — фирменная: те же цвета, что и у самого приложения, включая
// уже проверенный на различимость набор для рядов данных.
const PALETTES = [
  {
    id: "brand",
    name: "Акцентная (палитра приложения)",
    background: "#F7F6F3",
    text: "#0A0A0A",
    muted: "#5A626B",
    accent: "#FF2F6D",
    series: ["#FF2F6D", "#B23CC4", "#0095B0", "#C98A00", "#4B7BE5", "#2E9E6B"],
  },
  {
    id: "gradient",
    name: "Градиент (розовый → синий)",
    background: "linear-gradient(160deg, #FF2F6D 0%, #B23CC4 50%, #21B8F0 100%)",
    text: "#FFFFFF",
    muted: "rgba(255,255,255,0.75)",
    accent: "#FFFFFF",
    series: ["#FFFFFF", "#FFD8E4", "#C9F0FF", "#FFE9B8", "#E4D4FF", "#B9FFE3"],
  },
  {
    id: "light",
    name: "Светлая деловая",
    background: "#FFFFFF",
    text: "#1A1A1A",
    muted: "#6B7280",
    accent: "#2E9E6B",
    series: ["#2E9E6B", "#2F6FED", "#C98A00", "#C4004A", "#6B4BE5", "#0095B0"],
  },
  {
    id: "dark",
    name: "Тёмная",
    background: "#12141A",
    text: "#F2F4F8",
    muted: "#98A2B3",
    accent: "#00D9FF",
    series: ["#00D9FF", "#FF2F6D", "#B8E986", "#FFC857", "#A78BFA", "#4ADE80"],
  },
];

const VIZ_KINDS = [
  { id: "dashboard", name: "Дашборд", hint: "несколько показателей и графиков на одном листе" },
  { id: "chart", name: "График или диаграмма", hint: "один показатель крупно" },
  { id: "mindmap", name: "Майнд-карта", hint: "идея в центре, ветви вокруг" },
  { id: "flow", name: "Блок-схема", hint: "процесс по шагам, со стрелками" },
  { id: "timeline", name: "Таймлайн", hint: "этапы по времени" },
  { id: "checklist", name: "Карточка-список", hint: "перечень пунктов с отметками" },
  { id: "comparison", name: "Сравнение", hint: "до/после, мы/они, варианты рядом" },
];

function presetById(id) {
  return CANVAS_PRESETS.find((p) => p.id === id) || CANVAS_PRESETS[0];
}

function paletteById(id) {
  return PALETTES.find((p) => p.id === id) || PALETTES[0];
}

function kindById(id) {
  return VIZ_KINDS.find((k) => k.id === id) || VIZ_KINDS[0];
}

/** Палитра с ручными подменами: человек мог переопределить любой цвет. */
function resolvePalette(paletteId, overrides = {}) {
  const base = paletteById(paletteId);
  const series = Array.isArray(overrides.series) && overrides.series.length ? overrides.series : base.series;
  return {
    ...base,
    ...Object.fromEntries(Object.entries(overrides).filter(([k, v]) => k !== "series" && v)),
    series,
  };
}

const SYNTAX = `Готовую визуализацию возвращай СТРОГО в таком виде — приложение покажет предпросмотр
и сохранит файлы только после подтверждения человеком:

===ВИЗУАЛИЗАЦИЯ===
TITLE: <короткое название, оно же имя файла>
===HTML===
<цельный самодостаточный HTML-фрагмент со стилями внутри <style>>
===КОНЕЦ===

Требования к разметке:
- Корневой контейнер должен иметь РОВНО заданные ниже ширину и высоту в пикселях и не выходить
  за них: макет печатается в этот размер, всё, что не поместилось, будет обрезано.
- Только HTML, CSS и встроенный SVG. JavaScript, внешние ссылки, шрифты и картинки из интернета
  не сработают — их в файле не будет.
- Графики рисуй SVG-разметкой: столбцы, линии, доли круга, стрелки, узлы. Никаких библиотек.
- Числа бери из исходников. Ничего не додумывай: если данных не хватает на заявленный график —
  скажи об этом словами и построй то, на что данных хватает.
- Подписывай оси и значения. График без чисел на макете бесполезен.
- Используй ТОЛЬКО цвета из палитры ниже, включая цвета рядов данных по порядку.
- Шрифт задавай системный: font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif.

Перед блоком ===ВИЗУАЛИЗАЦИЯ=== коротко скажи, что показал и на каких числах — это то, что человек
будет проверять.`;

function buildPrompt({ kindId, preset, palette, references, extraStyle }) {
  const kind = kindById(kindId);
  const parts = [];

  parts.push(
    `Ты — дизайнер данных. Ты превращаешь сырые данные в один цельный макет, который можно
показать клиенту: не «график по умолчанию», а осмысленная картинка, где сразу видно главное.

Что делает работу хорошей:
- Один главный вывод, вокруг которого построен макет, и он читается за три секунды.
- Заголовок говорит вывод, а не тему («Расход вырос вдвое за два месяца», а не «Расход по месяцам»).
- Ничего лишнего: без легенд, которые дублируют подписи, без сеток и рамок ради рамок.
- Числа подписаны прямо у элементов, а не спрятаны в легенде.`
  );

  parts.push(`\nЧто нужно построить: ${kind.name} — ${kind.hint}.`);
  parts.push(`Размер холста: ровно ${preset.width}×${preset.height} пикселей.`);

  parts.push(`\n=== ПАЛИТРА (только эти цвета) ===
Фон: ${palette.background}
Основной текст: ${palette.text}
Второстепенный текст: ${palette.muted}
Акцент: ${palette.accent}
Ряды данных по порядку: ${palette.series.join(", ")}`);

  if (extraStyle) parts.push(`\n=== ПОЖЕЛАНИЯ ПО СТИЛЮ ===\n${extraStyle}`);

  for (const ref of references || []) {
    if (ref.image) {
      parts.push(`\n=== ИСХОДНИК (изображение): ${ref.name} ===\n[приложено картинкой к сообщению]`);
      continue;
    }
    if (ref.error) {
      parts.push(`\n=== ${ref.name} ===\n[не удалось прочитать: ${ref.error}]`);
      continue;
    }
    parts.push(`\n=== ИСХОДНИК: ${ref.name} ===\n${ref.text}`);
  }

  parts.push("\n" + SYNTAX);
  return parts.join("\n");
}

/** Разбирает ответ: заголовок и разметка макета. */
function parseResult(text) {
  const block = /===ВИЗУАЛИЗАЦИЯ===([\s\S]*?)===КОНЕЦ===/.exec(text || "");
  if (!block) return null;
  const body = block[1];
  const title = (/^TITLE:[^\S\r\n]*(.*)$/im.exec(body.split("===HTML===")[0])?.[1] || "Визуализация").trim();
  const htmlMatch = /===HTML===([\s\S]*)$/.exec(body);
  const html = (htmlMatch?.[1] || "").trim();
  if (!html) return null;
  return { title, html };
}

/**
 * Оборачивает фрагмент от модели в страницу точного размера.
 *
 * Размер задаётся и телу страницы, и печати (@page): без этого PDF выходит на A4
 * с полями, а не в тот размер, который человек выбрал.
 */
function wrapDocument(html, preset, palette) {
  const isGradient = String(palette.background).includes("gradient");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${preset.width}px ${preset.height}px; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${preset.width}px;
    height: ${preset.height}px;
    overflow: hidden;
    ${isGradient ? `background: ${palette.background};` : `background: ${palette.background};`}
    color: ${palette.text};
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
</style></head><body>${html}</body></html>`;
}

function sanitizeFileName(name) {
  return String(name || "Визуализация")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Сохраняет макет в PNG, PDF и HTML.
 *
 * HTML кладётся рядом намеренно: это единственный формат, в котором макет потом
 * можно поправить — руками или снова через агента, — не собирая его заново.
 */
async function save({ html, title, preset, palette, outputDir, formats }, { renderPng, renderPdf }) {
  const page = wrapDocument(html, preset, palette);
  const base = sanitizeFileName(title);
  await fs.mkdir(outputDir, { recursive: true });
  const saved = {};

  if (formats.includes("png")) {
    saved.png = path.join(outputDir, `${base}.png`);
    await renderPng(page, preset.width, preset.height, saved.png);
  }
  if (formats.includes("pdf")) {
    saved.pdf = path.join(outputDir, `${base}.pdf`);
    await renderPdf(page, preset.width, preset.height, saved.pdf);
  }
  if (formats.includes("html")) {
    saved.html = path.join(outputDir, `${base}.html`);
    await fs.writeFile(saved.html, page, "utf-8");
  }
  return saved;
}

module.exports = {
  CANVAS_PRESETS,
  PALETTES,
  VIZ_KINDS,
  presetById,
  paletteById,
  kindById,
  resolvePalette,
  buildPrompt,
  parseResult,
  wrapDocument,
  sanitizeFileName,
  save,
};
