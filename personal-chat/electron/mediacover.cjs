// Оформление кадра по дизайн-системе: заголовок и логотип поверх картинки.
//
// Зачем это отдельный шаг, а не указание модели.
//
// Модель, рисующая изображение, не умеет пользоваться чужим файлом шрифта и не
// умеет воспроизводить чужой логотип. Она рисует БУКВЫ КАК ПИКСЕЛИ — похожие
// на гротеск, но не ваши; логотип выходит приблизительным, а приблизительный
// фирменный знак хуже отсутствующего. Поэтому цветокоррекция по дизайн-системе
// в промпте работает (цвет модель выдержать может), а шрифт и логотип — нет.
//
// Настоящий шрифт и настоящий логотип кладутся ПОВЕРХ готового кадра, из тех
// самых файлов, что лежат в дизайн-системе. Тогда буквы — ровно те, что в
// файле, а знак — ровно тот, что нарисован, пиксель в пиксель.
//
// Рисуется это скрытым окном браузера, как и сцены роликов: верстка и шрифты
// там работают по-настоящему, а результат снимается картинкой.

const fs = require("node:fs/promises");
const path = require("node:path");

/** Типы шрифтов: из Фигмы чаще всего выгружается woff2. */
const FONT_MIME = {
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".ttc": "font/collection",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

async function dataUri(file, table, fallback) {
  const buf = await fs.readFile(file);
  const ext = path.extname(String(file)).toLowerCase();
  return `data:${table[ext] || fallback};base64,${buf.toString("base64")}`;
}

/**
 * Раскладки.
 *
 * Не «любое положение любого элемента», а несколько готовых: выбор из четырёх
 * понятных раскладок делается за секунду, а конструктор координат — это уже
 * вторая работа поверх первой.
 */
const LAYOUTS = [
  { id: "сверху", name: "Заголовок сверху", hint: "Крупный заголовок над кадром, логотип в правом верхнем углу." },
  { id: "снизу", name: "Заголовок снизу", hint: "Заголовок в нижней трети, логотип в правом верхнем углу." },
  { id: "центр", name: "Заголовок по центру", hint: "Заголовок по центру кадра, логотип внизу." },
  { id: "только-знак", name: "Только логотип", hint: "Без текста: один фирменный знак в углу." },
];

/**
 * Размер логотипа — долей ширины кадра, а не точками.
 *
 * В точках один и тот же знак на 1080 и на 4K выходит разным: на большом кадре
 * он превращается в точку в углу. Доля держит его одинаковым на любом размере.
 *
 * Границы нужны ползунку: ниже четырёх процентов знак нечитаем, выше тридцати
 * он перестаёт быть подписью и становится содержанием кадра.
 */
const LOGO_SCALE = { min: 0.04, max: 0.3, step: 0.005, default: 0.11 };

const CORNERS = [
  { id: "справа-сверху", name: "Справа сверху" },
  { id: "слева-сверху", name: "Слева сверху" },
  { id: "справа-снизу", name: "Справа снизу" },
  { id: "слева-снизу", name: "Слева снизу" },
];

/** Доля в границах: ползунок у человека, а испорченный кадр — у приложения. */
function доляЗнака(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return LOGO_SCALE.default;
  return Math.min(LOGO_SCALE.max, Math.max(LOGO_SCALE.min, n));
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Разметка оформления.
 *
 * Размеры заданы долями кадра, а не точками: один и тот же макет должен
 * одинаково выглядеть и на 1080×1920, и на 4K, а в точках он на 4K превращается
 * в мелкую подпись в углу.
 */
function buildHtml({
  width,
  height,
  photo,
  title = "",
  subtitle = "",
  logo = "",
  fontFamily = "",
  fontUri = "",
  layout = "сверху",
  corner = "справа-сверху",
  textColor = "#ffffff",
  accentColor = "",
  uppercase = false,
  scrim = true,
  logoScale = LOGO_SCALE.default,
}) {
  const face = fontUri && fontFamily
    ? `@font-face{font-family:"${esc(fontFamily)}";src:url("${fontUri}");font-weight:100 900;font-display:block;}`
    : "";
  const stack = fontFamily ? `"${esc(fontFamily)}", system-ui, sans-serif` : "system-ui, sans-serif";

  const вертикаль =
    layout === "снизу" ? "flex-end" : layout === "центр" ? "center" : "flex-start";
  const уголСтили = {
    "справа-сверху": "top:4%;right:5%;",
    "слева-сверху": "top:4%;left:5%;",
    "справа-снизу": "bottom:4%;right:5%;",
    "слева-снизу": "bottom:4%;left:5%;",
  }[corner] || "top:4%;right:5%;";

  // Затемнение под текстом: на светлом кадре белый заголовок иначе не читается,
  // а читаемость важнее чистоты картинки.
  const градиент =
    layout === "снизу"
      ? "linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 28%, transparent 55%)"
      : layout === "центр"
        ? "radial-gradient(60% 45% at 50% 50%, rgba(0,0,0,.55), transparent 70%)"
        : "linear-gradient(to bottom, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 28%, transparent 55%)";

  const заголовок = title
    ? `<div class="t">${esc(title)
        .split("\n")
        .map((line) => `<span>${line}</span>`)
        .join("")}</div>`
    : "";
  const подпись = subtitle ? `<div class="s">${esc(subtitle)}</div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${face}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:#000}
.stage{position:relative;width:${width}px;height:${height}px}
.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:${градиент};display:${scrim && layout !== "только-знак" ? "block" : "none"}}
.box{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:${вертикаль};
  padding:7% 6%;gap:0.35em}
.t{font-family:${stack};font-weight:800;color:${esc(textColor)};
  font-size:${Math.round(width * 0.105)}px;line-height:.97;letter-spacing:-0.015em;
  text-transform:${uppercase ? "uppercase" : "none"};display:flex;flex-direction:column}
.t span:nth-child(odd){color:${esc(accentColor || textColor)}}
.s{font-family:${stack};font-weight:500;color:${esc(textColor)};opacity:.86;
  font-size:${Math.round(width * 0.032)}px;line-height:1.25;max-width:80%}
.logo{position:absolute;${уголСтили}width:${Math.round(width * доляЗнака(logoScale))}px;height:auto;display:${logo ? "block" : "none"}}
</style></head><body>
<div class="stage">
  <img class="photo" src="${photo}">
  <div class="scrim"></div>
  <div class="box">${заголовок}${подпись}</div>
  ${logo ? `<img class="logo" src="${logo}">` : ""}
</div>
<script>
// Снимок делается только когда шрифт И картинки действительно загружены. Без
// этого ожидания кадр снимается запасным шрифтом — ровно тем промахом, ради
// которого всё и затевалось, только теперь незаметным.
(async () => {
  try { await document.fonts.ready; } catch (e) { /* шрифтов может не быть вовсе */ }
  const картинки = [...document.images].map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; })
  );
  await Promise.all(картинки);
  window.__ready = true;
})();
</script>
</body></html>`;
}

/**
 * Размер кадра.
 *
 * Берётся у самой картинки, а не задаётся настройкой: оформление должно лечь на
 * кадр ровно того размера, который сгенерирован, иначе макет либо обрежется,
 * либо оставит поля.
 */
async function imageSize(file) {
  const { nativeImage } = require("electron");
  const image = nativeImage.createFromPath(String(file));
  const size = image.isEmpty() ? null : image.getSize();
  if (!size || !size.width || !size.height) {
    throw new Error(`Не удалось прочитать размер картинки: ${path.basename(String(file))}`);
  }
  return size;
}

/** Имя файла рядом с исходным кадром: видно, что это оформленная версия. */
function coverName(source) {
  const ext = path.extname(source) || ".png";
  return `${path.basename(source, ext)}-оформлено.png`;
}

module.exports = { LAYOUTS, CORNERS, LOGO_SCALE, логоДоля: доляЗнака, FONT_MIME, IMAGE_MIME, dataUri, imageSize, buildHtml, coverName };
