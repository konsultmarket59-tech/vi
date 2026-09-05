// Видео-сторис: сборка вертикальных роликов из своего или стокового видео.
//
// Модуль вырос из накопленной вручную методики монтажа talking-head роликов:
// живые куски с плавающими плашками чередуются с полноэкранными моушн-вставками,
// звук при этом не прерывается. Раньше каждая такая сцена собиралась заново
// руками в HTML и терялась вместе с контейнером; здесь она стала описанием,
// которое сохраняется и повторяется.
//
// Главное решение — КАК рисуется оверлей.
//
// Всё, что накладывается на видео (плашки, таймлайны, иконки, SVG, кольцо
// вокруг головы, инфографика), рисуется браузером: HTML, CSS и SVG. Средствами
// одного ffmpeg такое не выразить — ни стекла, ни теней, ни скруглений с
// антиалиасингом, ни анимации SVG. Готовые кадры с прозрачностью потом
// накладываются на видео тем же ffmpeg.
//
// Из этого следует второе решение: НИКАКИХ CSS-анимаций. Сцена умеет только
// одно — показать себя в конкретный момент времени: window.seek(t) расставляет
// элементы для секунды t и ничего не помнит между вызовами. Поэтому кадр в
// предпросмотре и кадр в готовом файле считаются одним и тем же кодом и не
// могут разойтись. CSS-анимация зависела бы от реального времени, и рендер
// давал бы не то, что человек видел на экране.
//
// Модуль не требует electron: снимок кадра и запуск ffmpeg приходят из main.cjs.

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");

// --- бренд и заготовки ----------------------------------------------------

/** Палитра по умолчанию. Человек может поменять любой цвет в форме. */
const BRAND = {
  pink: "#FF2F6D",
  cyan: "#00D9FF",
  black: "#0A0A0A",
  white: "#FFFFFF",
};

const CANVAS_PRESETS = [
  { id: "story", name: "Вертикальное 1080×1920", width: 1080, height: 1920 },
  { id: "square", name: "Квадрат 1080×1080", width: 1080, height: 1080 },
  { id: "wide", name: "Горизонтальное 1920×1080", width: 1920, height: 1080 },
];

/** Как элемент появляется. Значения совпадают с именами в scene.js. */
const APPEAR = [
  { id: "slide-left", name: "выезд слева" },
  { id: "slide-right", name: "выезд справа" },
  { id: "slide-up", name: "выезд снизу" },
  { id: "scale", name: "увеличение из точки" },
  { id: "fade", name: "проявление" },
  { id: "draw", name: "прорисовка (для SVG)" },
];

const LAYER_KINDS = [
  { id: "pill", name: "Плашка с текстом" },
  { id: "timeline", name: "Таймлайн" },
  { id: "icon", name: "Иконка" },
  { id: "svg", name: "SVG с компьютера" },
  { id: "head", name: "Голова в кружке" },
  { id: "graphics", name: "Графика по тексту" },
  { id: "backdrop", name: "Полноэкранная вставка" },
];

const GRAPHICS_KINDS = [
  { id: "network", name: "Майнд-карта (хаб и узлы)" },
  { id: "dashboard", name: "Дашборд с цифрами" },
  { id: "flow", name: "Блок-схема" },
  { id: "bars", name: "Диаграмма-столбцы" },
];

const num = (v, fallback = 0) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const str = (v, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);

// --- описание ролика ------------------------------------------------------

let seq = 0;
const newId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

function normalizeLayer(raw = {}, index = 0) {
  const kind = LAYER_KINDS.some((k) => k.id === raw.kind) ? raw.kind : "pill";
  const base = {
    id: str(raw.id, newId()),
    kind,
    start: Math.max(0, num(raw.start, index * 1.2)),
    duration: Math.max(0.2, num(raw.duration, 3)),
    appear: APPEAR.some((a) => a.id === raw.appear) ? raw.appear : "slide-left",
    appearDur: Math.max(0, num(raw.appearDur, 0.48)),
    exit: APPEAR.some((a) => a.id === raw.exit) ? raw.exit : "fade",
    exitDur: Math.max(0, num(raw.exitDur, 0.3)),
    // Положение в процентах холста: ролик может быть любого размера, а вёрстка
    // в пикселях привязала бы сцену к одному формату.
    x: num(raw.x, 6),
    y: num(raw.y, 12 + index * 10),
    width: num(raw.width, 0),
  };

  if (kind === "pill") {
    return {
      ...base,
      text: str(raw.text, "ТЕКСТ"),
      bg: str(raw.bg, index % 3 === 1 ? BRAND.pink : index % 3 === 2 ? BRAND.cyan : BRAND.black),
      fg: str(raw.fg, index % 3 === 2 ? BRAND.black : BRAND.white),
      font: str(raw.font, ""),
      fontSize: num(raw.fontSize, 72),
      radius: num(raw.radius, 0),
      borderWidth: num(raw.borderWidth, 0),
      borderColor: str(raw.borderColor, BRAND.white),
      // Скос даёт те самые угловатые параллелограммы вместо прямоугольников.
      skew: num(raw.skew, 0),
      glass: !!raw.glass,
      shadow: !!raw.shadow,
      shadowColor: str(raw.shadowColor, BRAND.cyan),
      uppercase: raw.uppercase !== false,
    };
  }
  if (kind === "timeline") {
    return {
      ...base,
      steps: (Array.isArray(raw.steps) ? raw.steps : []).map((s2) => str(s2)).filter(Boolean),
      orientation: raw.orientation === "vertical" ? "vertical" : "horizontal",
      bg: str(raw.bg, ""),
      accent: str(raw.accent, BRAND.pink),
      track: str(raw.track, "rgba(255,255,255,0.25)"),
      font: str(raw.font, ""),
      fontSize: num(raw.fontSize, 34),
      fg: str(raw.fg, BRAND.white),
    };
  }
  if (kind === "icon") {
    return { ...base, svg: str(raw.svg), color: str(raw.color, BRAND.cyan), size: num(raw.size, 160) };
  }
  if (kind === "svg") {
    return {
      ...base,
      svg: str(raw.svg),
      sourcePath: str(raw.sourcePath),
      size: num(raw.size, 320),
      color: str(raw.color, ""),
    };
  }
  if (kind === "head") {
    return {
      ...base,
      size: num(raw.size, 340),
      ringA: str(raw.ringA, BRAND.pink),
      ringB: str(raw.ringB, BRAND.cyan),
      ringWidth: num(raw.ringWidth, 10),
      // Откуда в исходном кадре вырезается лицо — заполняется в форме.
      cropX: num(raw.cropX, 0),
      cropY: num(raw.cropY, 0),
      cropSize: num(raw.cropSize, 950),
    };
  }
  if (kind === "graphics") {
    return {
      ...base,
      graphics: GRAPHICS_KINDS.some((g) => g.id === raw.graphics) ? raw.graphics : "network",
      hub: str(raw.hub, ""),
      nodes: (Array.isArray(raw.nodes) ? raw.nodes : []).map((n) => str(n)).filter(Boolean),
      accentNode: str(raw.accentNode, ""),
      accent: str(raw.accent, BRAND.pink),
      fg: str(raw.fg, BRAND.white),
      nodeBg: str(raw.nodeBg, BRAND.black),
      font: str(raw.font, ""),
      fontSize: num(raw.fontSize, 28),
    };
  }
  return {
    ...base,
    from: str(raw.from, BRAND.pink),
    to: str(raw.to, BRAND.cyan),
    halftone: raw.halftone !== false,
    // Полноэкранная вставка закрывает видео целиком — звук при этом идёт дальше.
    opacity: Math.min(1, Math.max(0, num(raw.opacity, 1))),
  };
}

function normalizeSpec(raw = {}) {
  const preset =
    CANVAS_PRESETS.find((p) => p.id === raw.presetId) || CANVAS_PRESETS[0];
  const layers = (Array.isArray(raw.layers) ? raw.layers : []).map(normalizeLayer);
  const longest = layers.reduce((m, l) => Math.max(m, l.start + l.duration), 0);
  return {
    title: str(raw.title, "Ролик"),
    presetId: preset.id,
    width: preset.width,
    height: preset.height,
    fps: Math.min(60, Math.max(12, Math.round(num(raw.fps, 30)))),
    source: {
      kind: raw.source?.kind === "stock" ? "stock" : "file",
      path: str(raw.source?.path),
      query: str(raw.source?.query),
      trimStart: Math.max(0, num(raw.source?.trimStart, 0)),
    },
    musicPath: str(raw.musicPath),
    musicVolume: Math.min(2, Math.max(0, num(raw.musicVolume, 0.25))),
    // Длительность по умолчанию — пока идёт последний слой, но не меньше секунды.
    duration: Math.max(1, num(raw.duration, Math.max(1, longest))),
    fonts: Array.isArray(raw.fonts) ? raw.fonts : [],
    layers,
  };
}

// --- сцена ----------------------------------------------------------------
//
// Код сцены живёт строкой: он один и тот же и в предпросмотре, и при рендере.
// Единственный вход — seek(t): расставить всё для секунды t. Никаких CSS-анимаций
// и никакого состояния между кадрами.

const SCENE_JS = String.raw`
// Кубическая кривая Безье с перелётом — то же ускорение, что в CSS.
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = sampleX(t) - x;
      if (Math.abs(d) < 1e-6) return sampleY(t);
      const s = slopeX(t);
      if (Math.abs(s) < 1e-6) break;
      t -= d / s;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 20; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v > x) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}
const EASE_IN = bezier(0.34, 1.5, 0.4, 1);   // с перелётом, как в гайде
const EASE_OUT = bezier(0.4, 0, 0.9, 0.4);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const SPEC = window.__SPEC__;
const stage = document.getElementById("stage");
const px = (v) => v + "px";
const pctW = (v) => (v / 100) * SPEC.width;
const pctH = (v) => (v / 100) * SPEC.height;

function fontStack(name) {
  return name ? '"' + name + '", "Dinamika", sans-serif' : '"Dinamika", system-ui, sans-serif';
}

/** Рисует один слой один раз; движение появится в seek(). */
function buildLayer(layer, index) {
  const el = document.createElement("div");
  el.className = "layer layer-" + layer.kind;
  el.dataset.index = String(index);
  el.style.left = px(pctW(layer.x));
  el.style.top = px(pctH(layer.y));
  if (layer.width) el.style.width = px(pctW(layer.width));

  if (layer.kind === "pill") {
    const inner = document.createElement("div");
    inner.className = "pill-inner";
    inner.textContent = layer.uppercase ? layer.text.toUpperCase() : layer.text;
    inner.style.fontFamily = fontStack(layer.font);
    inner.style.fontSize = px(layer.fontSize);
    inner.style.color = layer.fg;
    inner.style.padding = px(Math.round(layer.fontSize * 0.22)) + " " + px(Math.round(layer.fontSize * 0.55));
    inner.style.borderRadius = px(layer.radius);
    if (layer.glass) {
      // Стекло: полупрозрачная подложка с размытием того, что под ней.
      inner.style.background = "color-mix(in srgb, " + layer.bg + " 45%, transparent)";
      inner.style.backdropFilter = "blur(18px) saturate(1.4)";
      inner.style.border = "1px solid color-mix(in srgb, " + layer.fg + " 35%, transparent)";
    } else {
      inner.style.background = layer.bg;
    }
    if (layer.borderWidth) {
      inner.style.border = px(layer.borderWidth) + " solid " + layer.borderColor;
    }
    if (layer.shadow) {
      inner.style.boxShadow = "10px 10px 0 " + layer.shadowColor;
    }
    if (layer.skew) {
      inner.style.transform = "skewX(" + -layer.skew + "deg)";
      const t = document.createElement("span");
      t.textContent = inner.textContent;
      t.style.display = "inline-block";
      t.style.transform = "skewX(" + layer.skew + "deg)";
      inner.textContent = "";
      inner.appendChild(t);
    }
    el.appendChild(inner);
  } else if (layer.kind === "timeline") {
    const wrap = document.createElement("div");
    wrap.className = "tl " + layer.orientation;
    if (layer.bg) {
      wrap.style.background = layer.bg;
      wrap.style.padding = "28px 34px";
      wrap.style.borderRadius = "22px";
    }
    const track = document.createElement("div");
    track.className = "tl-track";
    track.style.background = layer.track;
    const fill = document.createElement("div");
    fill.className = "tl-fill";
    fill.style.background = layer.accent;
    track.appendChild(fill);
    wrap.appendChild(track);
    const list = document.createElement("div");
    list.className = "tl-steps";
    for (const s of layer.steps) {
      const step = document.createElement("div");
      step.className = "tl-step";
      const dot = document.createElement("i");
      dot.style.background = layer.track;
      const label = document.createElement("span");
      label.textContent = s;
      label.style.fontFamily = fontStack(layer.font);
      label.style.fontSize = px(layer.fontSize);
      label.style.color = layer.fg;
      step.appendChild(dot);
      step.appendChild(label);
      list.appendChild(step);
    }
    wrap.appendChild(list);
    el.appendChild(wrap);
  } else if (layer.kind === "icon" || layer.kind === "svg") {
    const box = document.createElement("div");
    box.className = "svg-box";
    box.style.width = px(layer.size);
    box.style.height = px(layer.size);
    box.innerHTML = layer.svg || "";
    const svg = box.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", String(layer.size));
      svg.setAttribute("height", String(layer.size));
      if (layer.color) {
        svg.style.color = layer.color;
        svg.querySelectorAll("[fill]:not([fill='none'])").forEach((n) => n.setAttribute("fill", layer.color));
      }
    }
    el.appendChild(box);
  } else if (layer.kind === "head") {
    // Кольцо с дыркой: середина прозрачная, туда ffmpeg вклеит круглое видео.
    const ring = document.createElement("div");
    ring.className = "ring";
    const size = layer.size;
    const inner = size / 2 - layer.ringWidth;
    ring.style.width = px(size);
    ring.style.height = px(size);
    ring.style.background =
      "conic-gradient(from 0deg, " + layer.ringA + ", " + layer.ringB + ", " + layer.ringA + ")";
    const hole = "radial-gradient(circle at 50% 50%, transparent " + inner + "px, #000 " + (inner + 0.5) + "px)";
    ring.style.webkitMaskImage = hole;
    ring.style.maskImage = hole;
    el.appendChild(ring);
  } else if (layer.kind === "graphics") {
    el.appendChild(buildGraphics(layer));
  } else if (layer.kind === "backdrop") {
    // Вставка закрывает кадр целиком, поэтому сам слой обязан быть во весь
    // холст: у слоя нулевого размера inset:0 внутри не даёт ничего.
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.width = px(SPEC.width);
    el.style.height = px(SPEC.height);
    const bd = document.createElement("div");
    bd.className = "backdrop";
    bd.style.backgroundImage = "linear-gradient(160deg, " + layer.from + " 0%, " + layer.to + " 100%)";
    bd.style.opacity = String(layer.opacity);
    el.appendChild(bd);
    if (layer.halftone) {
      const dots = document.createElement("div");
      dots.className = "halftone";
      el.appendChild(dots);
    }
  }
  return el;
}
`;

/** Инфографика: четыре вида, выбираются в форме. Раскладка считается здесь же,
 *  чтобы предпросмотр и рендер строили одну и ту же картинку. */
const SCENE_GRAPHICS = String.raw`
function buildGraphics(layer) {
  const box = document.createElement("div");
  box.className = "gfx gfx-" + layer.graphics;
  const font = fontStack(layer.font);
  const W = layer.width ? pctW(layer.width) : SPEC.width * 0.86;
  box.style.width = px(W);

  if (layer.graphics === "network") {
    // Хаб — полное название, узлы вокруг него; линии считаются по атану.
    const hub = document.createElement("div");
    hub.className = "gfx-hub";
    hub.textContent = layer.hub || "";
    hub.style.fontFamily = font;
    hub.style.fontSize = px(Math.round(layer.fontSize * 1.5));
    hub.style.color = layer.accent;
    box.appendChild(hub);

    const field = document.createElement("div");
    field.className = "gfx-field";
    const per = Math.ceil(layer.nodes.length / 2) || 1;
    const nodeSize = Math.min(190, Math.max(120, W / (per + 1)));
    const rows = [layer.nodes.slice(0, per), layer.nodes.slice(per)];
    const height = rows.filter((r) => r.length).length * (nodeSize + 70) + 60;
    field.style.height = px(height);

    const centre = { x: W / 2, y: 0 };
    rows.forEach((row, ri) => {
      row.forEach((name, ci) => {
        const gap = W / (row.length + 1);
        const cx = gap * (ci + 1);
        const cy = 70 + ri * (nodeSize + 70) + nodeSize / 2;
        const accent = layer.accentNode && name === layer.accentNode;

        const line = document.createElement("div");
        line.className = "gfx-line";
        const dx = cx - centre.x, dy = cy - centre.y;
        line.style.width = px(Math.hypot(dx, dy));
        line.style.left = px(centre.x);
        line.style.top = px(centre.y);
        line.style.transform = "rotate(" + (Math.atan2(dy, dx) * 180) / Math.PI + "deg)";
        line.style.background = "linear-gradient(90deg, " + layer.accent + ", " + BRANDCYAN + ")";
        field.appendChild(line);

        const node = document.createElement("div");
        node.className = "gfx-node";
        node.dataset.order = String(ri * per + ci);
        node.textContent = name;
        node.style.width = px(nodeSize);
        node.style.height = px(nodeSize);
        node.style.left = px(cx - nodeSize / 2);
        node.style.top = px(cy - nodeSize / 2);
        node.style.background = accent ? layer.accent : layer.nodeBg;
        node.style.color = layer.fg;
        node.style.fontFamily = font;
        node.style.fontSize = px(layer.fontSize);
        field.appendChild(node);
      });
    });
    box.appendChild(field);
  } else if (layer.graphics === "dashboard") {
    const grid = document.createElement("div");
    grid.className = "gfx-grid";
    layer.nodes.forEach((n, i) => {
      const tile = document.createElement("div");
      tile.className = "gfx-tile";
      tile.dataset.order = String(i);
      tile.style.background = i === 0 ? layer.accent : layer.nodeBg;
      tile.style.color = layer.fg;
      tile.style.fontFamily = font;
      // «Цифра | подпись» — всё, что до вертикальной черты, крупное.
      const [big, small] = String(n).split("|");
      const b = document.createElement("strong");
      b.textContent = (big || "").trim();
      b.style.fontSize = px(Math.round(layer.fontSize * 2.2));
      tile.appendChild(b);
      if (small) {
        const s = document.createElement("span");
        s.textContent = small.trim();
        s.style.fontSize = px(layer.fontSize);
        tile.appendChild(s);
      }
      grid.appendChild(tile);
    });
    box.appendChild(grid);
  } else if (layer.graphics === "flow") {
    const chain = document.createElement("div");
    chain.className = "gfx-chain";
    layer.nodes.forEach((n, i) => {
      if (i) {
        const arrow = document.createElement("div");
        arrow.className = "gfx-arrow";
        arrow.dataset.order = String(i);
        arrow.style.background = layer.accent;
        chain.appendChild(arrow);
      }
      const bx = document.createElement("div");
      bx.className = "gfx-box";
      bx.dataset.order = String(i);
      bx.textContent = n;
      bx.style.background = i === layer.nodes.length - 1 ? layer.accent : layer.nodeBg;
      bx.style.color = layer.fg;
      bx.style.fontFamily = font;
      bx.style.fontSize = px(layer.fontSize);
      chain.appendChild(bx);
    });
    box.appendChild(chain);
  } else {
    // Столбцы: «подпись | значение», высота считается от максимума.
    const rows = layer.nodes.map((n) => {
      const [label, value] = String(n).split("|");
      return { label: (label || "").trim(), value: Number((value || "").trim()) || 0 };
    });
    const max = Math.max(1, ...rows.map((r) => r.value));
    const chart = document.createElement("div");
    chart.className = "gfx-bars";
    rows.forEach((r, i) => {
      const col = document.createElement("div");
      col.className = "gfx-bar";
      col.dataset.order = String(i);
      const bar = document.createElement("i");
      bar.style.background = i === 0 ? layer.accent : layer.nodeBg;
      bar.dataset.full = String(Math.round((r.value / max) * 420));
      const cap = document.createElement("span");
      cap.textContent = r.label;
      cap.style.fontFamily = font;
      cap.style.fontSize = px(layer.fontSize);
      cap.style.color = layer.fg;
      const val = document.createElement("b");
      val.textContent = String(r.value);
      val.style.fontFamily = font;
      val.style.fontSize = px(layer.fontSize);
      val.style.color = layer.fg;
      col.appendChild(val);
      col.appendChild(bar);
      col.appendChild(cap);
      chart.appendChild(col);
    });
    box.appendChild(chart);
  }
  return box;
}
`;

/** seek(t) — единственный вход сцены. */
const SCENE_SEEK = String.raw`
const NODES = SPEC.layers.map((layer, i) => {
  const el = buildLayer(layer, i);
  stage.appendChild(el);
  return { layer, el };
});

function applyAppear(el, kind, p, distance) {
  const e = EASE_IN(p);
  if (kind === "fade") { el.style.opacity = String(e); el.style.transform = ""; return; }
  if (kind === "scale") {
    el.style.opacity = String(clamp01(p * 1.6));
    el.style.transform = "scale(" + (0.6 + 0.4 * e) + ")";
    return;
  }
  if (kind === "draw") { el.style.opacity = "1"; el.style.transform = ""; return; }
  const dx = kind === "slide-left" ? -distance : kind === "slide-right" ? distance : 0;
  const dy = kind === "slide-up" ? distance : 0;
  el.style.opacity = String(clamp01(p * 1.6));
  el.style.transform = "translate(" + dx * (1 - e) + "px," + dy * (1 - e) + "px)";
}

window.seek = function seek(t) {
  for (const { layer, el } of NODES) {
    const local = t - layer.start;
    if (local < -1e-6 || local > layer.duration + 1e-6) {
      el.style.display = "none";
      continue;
    }
    el.style.display = "";
    const pIn = layer.appearDur > 0 ? clamp01(local / layer.appearDur) : 1;
    applyAppear(el, layer.appear, pIn, 60);

    const outStart = layer.duration - layer.exitDur;
    if (layer.exitDur > 0 && local > outStart) {
      const pOut = EASE_OUT(clamp01((local - outStart) / layer.exitDur));
      el.style.opacity = String(1 - pOut);
      if (layer.exit === "scale") el.style.transform = "scale(" + (1 - 0.25 * pOut) + ")";
    }

    // Прогресс внутри слоя — для таймлайна и появления узлов инфографики.
    const p = clamp01(local / Math.max(0.001, layer.duration));
    if (layer.kind === "timeline") {
      const fill = el.querySelector(".tl-fill");
      if (fill) {
        if (layer.orientation === "vertical") fill.style.height = p * 100 + "%";
        else fill.style.width = p * 100 + "%";
      }
      const steps = el.querySelectorAll(".tl-step");
      steps.forEach((s, i) => {
        const reached = layer.steps.length ? p >= (i + 1) / (layer.steps.length + 1) : false;
        s.querySelector("i").style.background = reached ? layer.accent : layer.track;
        s.style.opacity = reached ? "1" : "0.55";
      });
    }
    if (layer.kind === "graphics") {
      // Узлы появляются по очереди — так читается связь, а не мельтешение.
      el.querySelectorAll("[data-order]").forEach((n) => {
        const order = Number(n.dataset.order) || 0;
        const at = 0.25 + order * 0.14;
        const q = EASE_IN(clamp01((local - at) / 0.42));
        n.style.opacity = String(q);
        if (n.classList.contains("gfx-bar")) {
          const bar = n.querySelector("i");
          bar.style.height = px(Number(bar.dataset.full) * q);
        } else if (n.classList.contains("gfx-arrow")) {
          n.style.transform = "scaleY(" + q + ")";
        } else {
          n.style.transform = "scale(" + (0.75 + 0.25 * q) + ")";
        }
      });
    }
    if (layer.appear === "draw" && (layer.kind === "svg" || layer.kind === "icon")) {
      // Прорисовка: обводка вытягивается из нуля.
      el.querySelectorAll("path, line, polyline, circle, rect, ellipse, polygon").forEach((sh) => {
        let len = Number(sh.dataset.len);
        if (!len) {
          len = typeof sh.getTotalLength === "function" ? sh.getTotalLength() : 1000;
          sh.dataset.len = String(len);
          sh.style.strokeDasharray = String(len);
          if (!sh.getAttribute("stroke")) sh.setAttribute("stroke", layer.color || "currentColor");
          if (sh.getAttribute("fill") === null) sh.setAttribute("fill", "none");
        }
        sh.style.strokeDashoffset = String(len * (1 - EASE_IN(pIn)));
      });
    }
  }
  document.body.dataset.at = t.toFixed(3);

  // Подпись видимого состояния. По ней снаружи понятно, изменилось ли на экране
  // хоть что-нибудь: если нет, ждать нового кадра отрисовки бессмысленно, а
  // ожидание впустую стоило по две секунды на каждый статичный кадр.
  let signature = "";
  for (const { layer, el } of NODES) {
    if (el.style.display === "none") { signature += "|-"; continue; }
    signature += "|" + layer.id + ":" + (el.style.opacity || "1") + ":" + (el.style.transform || "");
    if (layer.kind === "timeline") {
      const fill = el.querySelector(".tl-fill");
      signature += ":" + (fill ? fill.style.width + fill.style.height : "");
    }
    if (layer.kind === "graphics") {
      el.querySelectorAll("[data-order]").forEach((n) => {
        signature += ":" + (n.style.opacity || "") + (n.style.transform || "") + (n.querySelector("i")?.style.height || "");
      });
    }
    if (layer.appear === "draw") {
      el.querySelectorAll("[stroke-dashoffset], path, line, polyline").forEach((sh) => {
        signature += ":" + (sh.style.strokeDashoffset || "");
      });
    }
  }
  return signature;
};

/**
 * Перейти к моменту и дождаться, пока браузер действительно нарисует кадр.
 *
 * Одного seek мало: слои с тенью, скосом и маской собираются отдельным проходом
 * и попадают на экран на такт позже. Снимок сразу после seek заставал их в
 * прежнем виде — один и тот же момент давал разные кадры. Два кадра ожидания
 * снимают это и обходятся дешевле фиксированной паузы.
 */
window.seekAndSettle = function (t) {
  const signature = window.seek(t);
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(signature)))
  );
};

window.__ready = true;
window.seek(0);
`;

const SCENE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  #stage { position: relative; overflow: hidden; background: transparent; }
  .layer { position: absolute; will-change: transform, opacity; }
  .pill-inner {
    display: inline-block; font-weight: 700; letter-spacing: 1px; line-height: 1.12;
    white-space: pre-wrap;
  }
  .ring { border-radius: 50%; }
  .backdrop { position: absolute; inset: 0; }
  /* Точки — отдельным слоем поверх градиента: складывать их в одно свойство
     background-image значило бы пересобирать градиент в каждой строке. */
  .halftone {
    position: absolute; inset: 0;
    background-image: radial-gradient(rgba(255,255,255,0.22) 2px, transparent 2px);
    background-size: 26px 26px;
  }
  .svg-box svg { width: 100%; height: 100%; display: block; }

  .tl { display: flex; gap: 22px; }
  .tl.horizontal { flex-direction: column; }
  .tl.vertical { flex-direction: row; align-items: stretch; }
  .tl-track { position: relative; border-radius: 999px; overflow: hidden; }
  .tl.horizontal .tl-track { height: 12px; width: 100%; }
  .tl.vertical .tl-track { width: 12px; min-height: 320px; }
  .tl-fill { position: absolute; left: 0; top: 0; }
  .tl.horizontal .tl-fill { height: 100%; width: 0; }
  .tl.vertical .tl-fill { width: 100%; height: 0; }
  .tl-steps { display: flex; gap: 18px; }
  .tl.horizontal .tl-steps { flex-direction: row; justify-content: space-between; }
  .tl.vertical .tl-steps { flex-direction: column; justify-content: space-between; }
  .tl-step { display: flex; align-items: center; gap: 12px; font-weight: 600; }
  .tl-step i { width: 20px; height: 20px; border-radius: 50%; flex: 0 0 auto; }

  .gfx-hub { font-weight: 700; text-align: center; text-transform: uppercase; margin-bottom: 26px; }
  .gfx-field { position: relative; }
  .gfx-line { position: absolute; height: 4px; transform-origin: 0 50%; opacity: 0.85; }
  .gfx-node {
    position: absolute; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; text-align: center; font-weight: 700; padding: 10px;
    text-transform: uppercase;
  }
  .gfx-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
  .gfx-tile {
    border-radius: 26px; padding: 28px 30px; display: flex; flex-direction: column;
    gap: 6px; font-weight: 700;
  }
  .gfx-chain { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .gfx-box {
    border-radius: 20px; padding: 22px 30px; font-weight: 700; text-align: center;
    width: 100%;
  }
  .gfx-arrow { width: 6px; height: 34px; transform-origin: 50% 0; border-radius: 3px; }
  .gfx-bars { display: flex; align-items: flex-end; gap: 22px; height: 520px; }
  .gfx-bar { display: flex; flex-direction: column; align-items: center; gap: 10px; flex: 1; justify-content: flex-end; }
  .gfx-bar i { width: 100%; border-radius: 14px 14px 0 0; display: block; }
  .gfx-bar b, .gfx-bar span { font-weight: 700; }
`;

/**
 * Страница сцены целиком. Шрифты вшиваются как data-URI: сцена рендерится в
 * скрытом окне, и ссылка на файл на диске оттуда может не открыться.
 */
function buildSceneHtml(spec, fonts = []) {
  const faces = fonts
    .filter((f) => f && f.family && f.dataUri)
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${f.dataUri}");font-weight:400 900;font-display:block;}`
    )
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
${faces}
${SCENE_CSS}
</style></head>
<body>
<div id="stage" style="width:${spec.width}px;height:${spec.height}px"></div>
<script>
window.__SPEC__ = ${JSON.stringify(spec)};
const BRANDCYAN = ${JSON.stringify(BRAND.cyan)};
${SCENE_JS}
${SCENE_GRAPHICS}
${SCENE_SEEK}
</script>
</body></html>`;
}

// --- сборка ролика --------------------------------------------------------

function runFfmpeg(bin, args, { onLine } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).slice(-1500)));
      else resolve(String(stderr || ""));
    });
    if (onLine && child.stderr) {
      child.stderr.on("data", (chunk) => String(chunk).split(/\r|\n/).forEach((l) => l && onLine(l)));
    }
  });
}

/**
 * Длительность и размер исходника. Отдельного ffprobe в комплекте нет, но
 * ffmpeg сам печатает это в поток ошибок при попытке открыть файл.
 */
async function probe(bin, file) {
  let out = "";
  try {
    await runFfmpeg(bin, ["-hide_banner", "-i", file]);
  } catch (e) {
    out = String(e.message);
  }
  const dur = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/.exec(out);
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,]/.exec(out);
  const fps = /,\s*([\d.]+)\s*fps/.exec(out);
  return {
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(out),
  };
}

/**
 * Команда сборки. Видео масштабируется с обрезкой по центру под холст, поверх
 * ложится дорожка кадров с прозрачностью, при необходимости — круглое видео
 * головы, и музыка подмешивается к родному звуку.
 */
function buildFfmpegArgs(spec, paths, info = {}) {
  const { basePath, framesPattern, maskPath, outPath } = paths;
  const head = spec.layers.find((l) => l.kind === "head");
  const args = ["-y", "-hide_banner"];

  // Исходник короче ролика — зацикливаем, иначе кадры кончатся раньше слов.
  if (info.duration && info.duration < spec.duration) args.push("-stream_loop", "-1");
  if (spec.source.trimStart > 0) args.push("-ss", String(spec.source.trimStart));
  args.push("-i", basePath);
  args.push("-framerate", String(spec.fps), "-i", framesPattern);
  let next = 2;
  let maskIdx = -1;
  if (head && maskPath) {
    // Маска — одна картинка; без зацикливания её поток кончается на первом
    // кадре и тянет за собой длину всего ролика.
    args.push("-loop", "1", "-i", maskPath);
    maskIdx = next++;
  }
  let musicIdx = -1;
  if (spec.musicPath) {
    args.push("-i", spec.musicPath);
    musicIdx = next++;
  }

  const W = spec.width;
  const H = spec.height;
  const chain = [];
  // Заполняем холст без искажения пропорций: увеличить до перекрытия и обрезать.
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${spec.fps}`;

  if (head) {
    const inner = Math.max(2, Math.round(head.size - head.ringWidth * 2));
    chain.push(`[0:v]split=2[base][face]`);
    chain.push(`[base]${fit}[bg]`);
    chain.push(
      `[face]crop=${Math.round(head.cropSize)}:${Math.round(head.cropSize)}:` +
        `${Math.round(head.cropX)}:${Math.round(head.cropY)},scale=${inner}:${inner},format=rgba[facesq]`
    );
    chain.push(`[${maskIdx}:v]scale=${inner}:${inner},format=gray[hmask]`);
    chain.push(`[facesq][hmask]alphamerge[circ]`);
    const hx = Math.round((head.x / 100) * W + head.ringWidth);
    const hy = Math.round((head.y / 100) * H + head.ringWidth);
    chain.push(
      `[bg][circ]overlay=x=${hx}:y=${hy}:enable='between(t,${head.start},${head.start + head.duration})'[withhead]`
    );
    chain.push(`[withhead][1:v]overlay=0:0:format=auto[v]`);
  } else {
    chain.push(`[0:v]${fit}[bg]`);
    chain.push(`[bg][1:v]overlay=0:0:format=auto[v]`);
  }

  const map = ["-map", "[v]"];
  if (musicIdx >= 0 && info.hasAudio) {
    chain.push(`[${musicIdx}:a]volume=${spec.musicVolume}[bgm]`);
    chain.push(`[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=0[a]`);
    map.push("-map", "[a]");
  } else if (musicIdx >= 0) {
    chain.push(`[${musicIdx}:a]volume=${spec.musicVolume}[a]`);
    map.push("-map", "[a]");
  } else if (info.hasAudio) {
    map.push("-map", "0:a");
  }

  args.push("-filter_complex", chain.join(";"), ...map);
  // Длину ролика задаёт только -t. Полагаться на -shortest нельзя: среди входов
  // есть и бесконечные (зацикленный исходник, маска), и короткие — она обрезала
  // готовый ролик до длины случайного потока.
  args.push(
    "-t", String(spec.duration),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", outPath
  );
  return args;
}

/** Сколько кадров нужно снять для этого ролика. */
function frameCount(spec) {
  return Math.max(1, Math.round(spec.duration * spec.fps));
}

/** Круглая маска рисуется браузером — у него честное сглаживание края. */
function maskHtml(size) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0} html,body{background:#000}
    #m{width:${size}px;height:${size}px;border-radius:50%;background:#fff}
  </style></head><body><div id="m"></div></body></html>`;
}

// --- шрифты с компьютера --------------------------------------------------

const FONT_DIRS = {
  win32: ["C:/Windows/Fonts"],
  darwin: ["/System/Library/Fonts", "/Library/Fonts"],
  linux: ["/usr/share/fonts", "/usr/local/share/fonts"],
};

/**
 * Настоящее имя гарнитуры из таблицы `name` файла шрифта.
 *
 * По имени файла судить нельзя: «arialbd.ttf» человеку ничего не говорит, а
 * подставить в CSS нужно именно то имя, под которым шрифт себя объявляет.
 */
function familyFromFontFile(buf) {
  try {
    let base = 0;
    if (buf.readUInt32BE(0) === 0x74746366) base = buf.readUInt32BE(12); // ttcf
    const numTables = buf.readUInt16BE(base + 4);
    for (let i = 0; i < numTables; i++) {
      const rec = base + 12 + i * 16;
      if (buf.toString("ascii", rec, rec + 4) !== "name") continue;
      const off = buf.readUInt32BE(rec + 8);
      const count = buf.readUInt16BE(off + 2);
      const strOff = off + buf.readUInt16BE(off + 4);
      let fallback = "";
      for (let j = 0; j < count; j++) {
        const r = off + 6 + j * 12;
        const platform = buf.readUInt16BE(r);
        const nameId = buf.readUInt16BE(r + 6);
        if (nameId !== 1) continue;
        const len = buf.readUInt16BE(r + 8);
        const o = strOff + buf.readUInt16BE(r + 10);
        const raw = buf.subarray(o, o + len);
        const value = platform === 1 ? raw.toString("latin1") : raw.toString("utf16le").replace(/\0/g, "");
        const decoded = platform === 1 ? value : raw.swap16 ? Buffer.from(raw).swap16().toString("utf16le") : value;
        const clean = String(decoded).replace(/[^\x20-\x7Eа-яёА-ЯЁ\-\s]/g, "").trim();
        if (clean) {
          if (platform === 3) return clean;
          fallback = fallback || clean;
        }
      }
      if (fallback) return fallback;
    }
  } catch {
    /* битый или незнакомый файл — вернём пусто и возьмём имя файла */
  }
  return "";
}

async function listFonts(platform = process.platform, extraDirs = []) {
  const dirs = [...(FONT_DIRS[platform] || FONT_DIRS.linux), ...extraDirs];
  const found = new Map();
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(ttf|otf|ttc)$/i.test(entry.name)) continue;
      const full = path.join(entry.parentPath || entry.path || dir, entry.name);
      let family = "";
      try {
        const handle = await fs.open(full, "r");
        try {
          const head = Buffer.alloc(Math.min(256 * 1024, (await handle.stat()).size));
          await handle.read(head, 0, head.length, 0);
          family = familyFromFontFile(head);
        } finally {
          await handle.close();
        }
      } catch {
        /* нет доступа — пропускаем */
      }
      const name = family || entry.name.replace(/\.(ttf|otf|ttc)$/i, "");
      if (!found.has(name)) found.set(name, { family: name, path: full });
    }
  }
  return [...found.values()].sort((a, b) => a.family.localeCompare(b.family, "ru"));
}

/** Шрифт для сцены — строкой data:, потому что скрытое окно читает не с диска. */
async function fontDataUri(file) {
  const buf = await fs.readFile(file);
  const kind = /\.otf$/i.test(file) ? "font/otf" : "font/ttf";
  return `data:${kind};base64,${buf.toString("base64")}`;
}

// --- иконки и сток --------------------------------------------------------

const ICONIFY = "https://api.iconify.design";

/** Поиск иконок. Iconify открыт и не требует ключа — как каталоги в Фигме. */
async function searchIcons(query, limit = 36) {
  if (!query.trim()) return [];
  const res = await fetch(`${ICONIFY}/search?query=${encodeURIComponent(query)}&limit=${limit}`);
  if (!res.ok) throw new Error(`Каталог иконок ответил ${res.status}`);
  const json = await res.json();
  return (json.icons || []).map((id) => ({ id, url: `${ICONIFY}/${id.replace(":", "/")}.svg` }));
}

async function fetchIconSvg(id, color) {
  const q = color ? `?color=${encodeURIComponent(color)}` : "";
  const res = await fetch(`${ICONIFY}/${id.replace(":", "/")}.svg${q}`);
  if (!res.ok) throw new Error(`Иконка ${id} не отдалась (${res.status})`);
  return res.text();
}

/** Стоковое видео. Тот же Pexels, что и в ежедневной генерации рилсов. */
async function searchStock(query, apiKey, orientation = "portrait") {
  if (!apiKey) throw new Error("Не задан ключ Pexels — без него сток недоступен.");
  const url =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}` +
    `&orientation=${orientation}&per_page=12`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(`Сток ответил ${res.status}`);
  const json = await res.json();
  return (json.videos || []).map((v) => {
    const best = (v.video_files || [])
      .filter((f) => f.file_type === "video/mp4")
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return {
      id: String(v.id),
      preview: v.image,
      duration: v.duration,
      width: best?.width || 0,
      height: best?.height || 0,
      url: best?.link || "",
      author: v.user?.name || "",
    };
  }).filter((v) => v.url);
}

async function downloadTo(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать: ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * Проверка композиции до сборки.
 *
 * Рендер длится минуты, и узнать про уехавшую за край плашку из готового файла —
 * значит потерять эти минуты. Здесь считаются приблизительные габариты слоёв:
 * точная верстка живёт в браузере, но выход за холст и наложение видно и так.
 */
function validateSpec(raw) {
  const spec = normalizeSpec(raw);
  const problems = [];
  const boxes = [];

  for (const layer of spec.layers) {
    if (layer.start + layer.duration > spec.duration + 0.01) {
      problems.push(`«${layerTitle(layer)}» заканчивается позже ролика — не поместится целиком.`);
    }
    if (layer.kind === "backdrop") continue;

    const x = (layer.x / 100) * spec.width;
    const y = (layer.y / 100) * spec.height;
    let w = layer.width ? (layer.width / 100) * spec.width : 0;
    let h = 0;
    if (layer.kind === "pill") {
      // Ширина буквы у плотных капслочных шрифтов — примерно 0.62 кегля.
      // Обрезать эту оценку по холсту нельзя: именно её превышение и означает,
      // что плашка вылезет, а обрезанная ширина никогда бы не превысила холст.
      const longest = layer.text.split("\n").reduce((m, line) => Math.max(m, line.length), 0);
      w = w || longest * layer.fontSize * 0.62 + layer.fontSize * 1.1;
      h = layer.fontSize * 1.55 * layer.text.split("\n").length;
    } else if (layer.kind === "head") {
      w = layer.size;
      h = layer.size;
    } else if (layer.kind === "icon" || layer.kind === "svg") {
      w = layer.size;
      h = layer.size;
    } else if (layer.kind === "timeline") {
      w = w || spec.width * 0.8;
      h = layer.orientation === "vertical" ? 380 : 120 + layer.fontSize * 2;
    } else {
      w = w || spec.width * 0.86;
      h = layer.graphics === "bars" ? 560 : layer.graphics === "network" ? 620 : 420;
    }
    if (x < 0 || y < 0 || x + w > spec.width + 1 || y + h > spec.height + 1) {
      problems.push(
        `«${layerTitle(layer)}» выходит за край холста — приложение обрежет то, что вылезло.`
      );
    }
    boxes.push({ layer, x, y, w, h });
  }

  // Наложение показываем только для тех, кто одновременно на экране.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const together =
        a.layer.start < b.layer.start + b.layer.duration &&
        b.layer.start < a.layer.start + a.layer.duration;
      if (!together) continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapX > 12 && overlapY > 12) {
        problems.push(`«${layerTitle(a.layer)}» и «${layerTitle(b.layer)}» налезают друг на друга.`);
      }
    }
  }
  return problems;
}

function layerTitle(layer) {
  if (layer.kind === "pill") return layer.text.slice(0, 24);
  const kind = LAYER_KINDS.find((k) => k.id === layer.kind);
  return kind ? kind.name : layer.kind;
}

// --- агент ----------------------------------------------------------------
//
// Агент раскладывает текст по сценам: какие фразы станут плашками, где нужна
// полноэкранная вставка, что показать графикой. Он НЕ рисует и не считает
// тайминги вслепую — длительность ролика и исходника даются ему числом, а
// результат всё равно правится в форме и виден в предпросмотре до сборки.

function buildScriptPrompt({ spec, sourceInfo, text }) {
  const secs = sourceInfo?.duration ? sourceInfo.duration.toFixed(1) : "неизвестна";
  return [
    "Ты монтажёр вертикальных роликов. Разложи текст по сценам поверх видео.",
    "",
    `Холст ${spec.width}×${spec.height}, ${spec.fps} кадров в секунду.`,
    `Длительность исходного видео: ${secs} с. Длительность ролика: ${spec.duration} с.`,
    "",
    "ТЕКСТ:",
    text || "(текста нет — предложи структуру под тему ролика)",
    "",
    "ПРАВИЛА МОНТАЖА, они важнее красоты:",
    "  — Одна фраза — одна плашка. Не склеивай несколько строк в одну плашку.",
    "  — Плашки идут каскадом: то левее, то правее, с небольшим сдвигом по вертикали.",
    "  — Ролик не должен быть сплошной лентой с плашкой поверх. Чередуй живые куски",
    "    (видно видео, поверх плавают плашки) и полноэкранные вставки (слой backdrop",
    "    закрывает видео, на экране только графика). Звук при этом не прерывается.",
    "  — Плашки не должны налезать друг на друга и выходить за края холста.",
    "  — Если в тексте есть перечисление, шаги или числа — покажи их слоем graphics",
    "    или timeline, а не пятью плашками подряд.",
    "",
    "Виды слоёв: pill (плашка с текстом), backdrop (полноэкранная вставка),",
    "timeline (шкала шагов), graphics (network — майнд-карта, dashboard — цифры,",
    "flow — блок-схема, bars — столбцы), head (голова в кружке), icon, svg.",
    "",
    "ОТВЕТ. Сначала объясни структуру в двух-трёх предложениях. Затем блок:",
    "",
    "===СЦЕНЫ===",
    "```json",
    "{",
    '  "duration": 30,',
    '  "layers": [',
    '    {"kind":"pill","text":"ПЕРВАЯ ФРАЗА","start":0.3,"duration":3.2,"x":6,"y":14,"appear":"slide-left"},',
    '    {"kind":"backdrop","start":8,"duration":5},',
    '    {"kind":"graphics","graphics":"network","hub":"НАЗВАНИЕ","nodes":["УЗЕЛ","УЗЕЛ"],"accentNode":"УЗЕЛ","start":8.3,"duration":4.5,"x":7,"y":30}',
    "  ]",
    "}",
    "```",
    "===КОНЕЦ===",
    "",
    "Координаты x и y — в процентах холста. Только те поля, которые нужны:",
    "остальное приложение подставит само. Внутри блока — чистый JSON без пояснений.",
  ].join("\n");
}

/** Разбор ответа. Возвращает null, если блока со сценами нет. */
function parseScenes(text) {
  const body = String(text || "");
  const block = /===СЦЕНЫ===([\s\S]*?)===КОНЕЦ===/i.exec(body);
  if (!block) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(block[1]);
  const raw = (fenced ? fenced[1] : block[1]).trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const layers = Array.isArray(parsed) ? parsed : parsed.layers;
  if (!Array.isArray(layers) || !layers.length) return null;
  return {
    duration: num(parsed.duration, 0) || 0,
    layers: layers.map((l, i) => normalizeLayer(l, i)),
  };
}

module.exports = {
  BRAND,
  CANVAS_PRESETS,
  APPEAR,
  LAYER_KINDS,
  GRAPHICS_KINDS,
  normalizeSpec,
  normalizeLayer,
  buildSceneHtml,
  maskHtml,
  frameCount,
  buildFfmpegArgs,
  probe,
  runFfmpeg,
  listFonts,
  familyFromFontFile,
  fontDataUri,
  searchIcons,
  fetchIconSvg,
  searchStock,
  downloadTo,
  buildScriptPrompt,
  parseScenes,
  validateSpec,
  layerTitle,
};
