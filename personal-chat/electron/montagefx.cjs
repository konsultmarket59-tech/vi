// Эффекты «Монтажа»: ключевые точки, видеоэффекты, фильтры, стили субтитров,
// звуковые эффекты и форматы экспорта.
//
// Всё это — ДАННЫЕ, а не код в двух местах. У каждого эффекта и фильтра здесь
// же лежит и то, как его рисует ffmpeg при сборке, и то, как его показывает
// предпросмотр (css). Окно получает эти таблицы отсюда же, поэтому новый фильтр
// добавляется одной строкой, и предпросмотр не может «забыть» о нём.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r4 = (v) => Math.round(v * 10000) / 10000;

// ---------- ключевые точки ----------

/**
 * Положение — центр слоя в долях кадра (0.5 — середина), масштаб — 1 как есть,
 * поворот — в градусах, непрозрачность — от 0 до 1.
 */
const TRANSFORM_DEFAULT = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
const TRANSFORM_PROPS = ["x", "y", "scale", "rotation", "opacity"];

const EASES = [
  { id: "smooth", name: "Плавно" },
  { id: "linear", name: "Равномерно" },
  { id: "in", name: "Разгон" },
  { id: "out", name: "Торможение" },
  { id: "back", name: "С перелётом" },
  { id: "hold", name: "Скачком" },
];

function normalizeTransform(raw = {}, def = TRANSFORM_DEFAULT) {
  return {
    x: clamp(num(raw.x, def.x), -1, 2),
    y: clamp(num(raw.y, def.y), -1, 2),
    scale: clamp(num(raw.scale, def.scale), 0.01, 10),
    rotation: clamp(num(raw.rotation, def.rotation), -3600, 3600),
    opacity: clamp(num(raw.opacity, def.opacity), 0, 1),
  };
}

function normalizeKeyframes(list, def = TRANSFORM_DEFAULT) {
  if (!Array.isArray(list)) return [];
  const out = list
    .map((k) => ({ t: Math.max(0, num(k.t, 0)), ...normalizeTransform(k, def), ease: EASES.some((e) => e.id === k.ease) ? k.ease : "smooth" }))
    .sort((a, b) => a.t - b.t);
  // Две точки в одно время — оставляем последнюю: иначе отрезок нулевой длины.
  return out.filter((k, i) => !out[i + 1] || out[i + 1].t - k.t > 1e-3);
}

function easeJs(ease, p) {
  switch (ease) {
    case "linear": return p;
    case "in": return p * p * p;
    case "out": return 1 - Math.pow(1 - p, 3);
    case "back": { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
    case "hold": return 0;
    default: return p * p * (3 - 2 * p);
  }
}

/** То же сглаживание выражением ffmpeg; P — доля пути отрезка. */
function easeExpr(ease, P) {
  switch (ease) {
    case "linear": return P;
    case "in": return `pow(${P},3)`;
    case "out": return `(1-pow(1-${P},3))`;
    case "back": return `(1+2.70158*pow(${P}-1,3)+1.70158*pow(${P}-1,2))`;
    case "hold": return "0";
    default: return `(${P})*(${P})*(3-2*(${P}))`;
  }
}

/** Значения преобразования в момент t (секунды от начала слоя). */
function sampleTransform(base, keyframes, t) {
  const b = normalizeTransform(base);
  if (!keyframes || !keyframes.length) return b;
  if (t <= keyframes[0].t) return pick(keyframes[0]);
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return pick(last);
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const c = keyframes[i + 1];
    if (t >= a.t && t < c.t) {
      const e = easeJs(a.ease, (t - a.t) / (c.t - a.t));
      const out = {};
      for (const p of TRANSFORM_PROPS) out[p] = a[p] + (c[p] - a[p]) * e;
      return out;
    }
  }
  return pick(last);
}

function pick(k) {
  return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
}

/**
 * Выражение ffmpeg для свойства по ключевым точкам.
 * @param {string} tv — переменная времени фильтра: «t» у большинства, «T» у geq
 * @param {number} offset — когда слой начинается на шкале этого фильтра
 */
function keyframeExpr(prop, base, keyframes, { tv = "t", offset = 0, map = (v) => v } = {}) {
  const b = normalizeTransform(base);
  if (!keyframes || !keyframes.length) return String(r4(map(b[prop])));
  const T = (k) => r4(offset + k.t);
  let expr = String(r4(map(keyframes[keyframes.length - 1][prop])));
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const a = keyframes[i];
    const c = keyframes[i + 1];
    const va = r4(map(a[prop]));
    const vc = r4(map(c[prop]));
    const P = `((${tv}-${T(a)})/${r4(c.t - a.t)})`;
    const seg = va === vc ? String(va) : `${va}+(${r4(vc - va)})*${easeExpr(a.ease, P)}`;
    expr = `if(lt(${tv},${T(c)}),${seg},${expr})`;
  }
  return `if(lt(${tv},${T(keyframes[0])}),${r4(map(keyframes[0][prop]))},${expr})`;
}

function animated(base, keyframes, prop) {
  if (!keyframes || keyframes.length < 2) return false;
  return keyframes.some((k) => Math.abs(k[prop] - keyframes[0][prop]) > 1e-4);
}

/**
 * Преобразование слоя фильтрами ffmpeg: поворот, масштаб, непрозрачность.
 * Вход — готовый кадр слоя (rgba); выход — его же, повёрнутый и отмасштабированный.
 * Поворот идёт ДО масштаба: размер холста поворота считается один раз, по
 * исходному кадру, и растущий слой иначе обрезался бы по старому размеру.
 */
function transformChain(base, keyframes, { offset = 0, widthPx }) {
  const kf = keyframes && keyframes.length ? keyframes : null;
  const b = normalizeTransform(base);
  const parts = ["format=rgba"];
  // Прозрачность — первой: geq не переносит кадр, меняющий размер на ходу
  // (масштаб по ключевым точкам), и роняет ffmpeg. До поворота и масштаба
  // размер кадра ещё постоянный.
  if (kf && animated(b, kf, "opacity")) {
    parts.push(`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${keyframeExpr("opacity", b, kf, { tv: "T", offset })})'`);
  } else {
    const o = kf ? kf[0].opacity : b.opacity;
    if (o < 0.999) parts.push(`colorchannelmixer=aa=${r4(o)}`);
  }
  const rotAnimated = kf && animated(b, kf, "rotation");
  const rot0 = kf ? kf[0].rotation : b.rotation;
  if (rotAnimated || Math.abs(rot0) > 0.01) {
    const a = rotAnimated ? keyframeExpr("rotation", b, kf, { offset, map: (v) => (v * Math.PI) / 180 }) : String(r4((rot0 * Math.PI) / 180));
    parts.push(`rotate=a='${a}':c=none:ow='hypot(iw,ih)':oh=ow`);
  }
  if (kf && animated(b, kf, "scale")) {
    parts.push(`scale=w='max(2,trunc(${widthPx}*(${keyframeExpr("scale", b, kf, { offset })})/2)*2)':h=-2:eval=frame`);
  } else {
    const s = kf ? kf[0].scale : b.scale;
    parts.push(`scale=${Math.max(2, Math.round((widthPx * s) / 2) * 2)}:-2`);
  }
  return parts.join(",");
}

/** Координаты наложения: центр слоя в долях кадра → левый верхний угол. */
function overlayXY(base, keyframes, { offset = 0 }) {
  const kf = keyframes && keyframes.length ? keyframes : null;
  const x = kf ? keyframeExpr("x", base, kf, { offset }) : String(r4(normalizeTransform(base).x));
  const y = kf ? keyframeExpr("y", base, kf, { offset }) : String(r4(normalizeTransform(base).y));
  return { x: `(${x})*W-w/2`, y: `(${y})*H-h/2`, dynamic: !!kf };
}

// ---------- видеоэффекты ----------

/**
 * Эффекты. a — сила от 0 до 1. ff — цепочка ffmpeg; css — как показывает
 * предпросмотр: filter, наложение (vignette, grain, scan, bars) и движение.
 * В предпросмотре это приближение: шум, глитч и линза в браузере рисуются
 * иначе, — точный вид у собранного ролика.
 */
const EFFECTS = [
  { id: "blur", name: "Размытие", group: "Базовые", ff: (a) => `gblur=sigma=${r4(1 + a * 24)}`, css: { filter: (a) => `blur(${r4(0.4 + a * 1.4)}cqmin)` } },
  { id: "sharpen", name: "Резкость", group: "Базовые", ff: (a) => `unsharp=5:5:${r4(0.5 + a * 2)}`, css: { filter: (a) => `contrast(${r4(1 + a * 0.12)})` } },
  { id: "vignette", name: "Виньетка", group: "Базовые", ff: (a) => `vignette=angle=${r4(0.3 + a * 0.6)}`, css: { overlay: "vignette" } },
  { id: "mirror", name: "Зеркало", group: "Базовые", ff: () => "hflip", css: { transform: "scaleX(-1)" } },
  { id: "bars", name: "Кинорамка", group: "Базовые", ff: (a) => `drawbox=x=0:y=0:w=iw:h=ih*${r4(0.04 + a * 0.1)}:color=black:t=fill,drawbox=x=0:y=ih-ih*${r4(0.04 + a * 0.1)}:w=iw:h=ih*${r4(0.04 + a * 0.1)}:color=black:t=fill`, css: { overlay: "bars" } },
  { id: "grain", name: "Зерно плёнки", group: "Ретро", ff: (a) => `noise=alls=${Math.round(8 + a * 40)}:allf=t+u`, css: { overlay: "grain" } },
  { id: "vhs", name: "VHS-кассета", group: "Ретро", ff: (a) => `curves=preset=vintage,rgbashift=rh=${Math.round(2 + a * 5)}:bh=-${Math.round(2 + a * 5)},noise=alls=${Math.round(10 + a * 20)}:allf=t,eq=saturation=1.25:contrast=1.05,gblur=sigma=0.7`, css: { filter: () => "sepia(0.3) saturate(1.3) contrast(1.05) blur(0.15cqmin)", overlay: "scan" } },
  { id: "oldfilm", name: "Старое кино", group: "Ретро", ff: (a) => `hue=s=0,curves=preset=vintage,noise=alls=${Math.round(15 + a * 30)}:allf=t+u,vignette=angle=0.8`, css: { filter: () => "grayscale(1) sepia(0.4) contrast(1.1)", overlay: "grain" } },
  { id: "sepia", name: "Сепия", group: "Ретро", ff: () => "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131", css: { filter: () => "sepia(1)" } },
  { id: "bw", name: "Чёрно-белое", group: "Ретро", ff: () => "hue=s=0", css: { filter: () => "grayscale(1)" } },
  { id: "glitch", name: "Глитч", group: "Динамика", ff: (a) => `rgbashift=rh=${Math.round(4 + a * 14)}:bh=-${Math.round(4 + a * 14)}:gv=${Math.round(a * 6)},noise=alls=${Math.round(a * 30)}:allf=t,crop=iw:ih*0.96:0:'(ih*0.04)*gt(mod(t*9,1),0.8)',scale=iw:ih*1.0417`, css: { filter: (a) => `drop-shadow(${r4(0.4 + a)}cqmin 0 rgba(255,0,60,.8)) drop-shadow(-${r4(0.4 + a)}cqmin 0 rgba(0,220,255,.8))`, motion: "glitch" } },
  { id: "chroma", name: "Расслоение RGB", group: "Динамика", ff: (a) => `rgbashift=rh=${Math.round(3 + a * 12)}:bh=-${Math.round(3 + a * 12)}`, css: { filter: (a) => `drop-shadow(${r4(0.3 + a * 0.8)}cqmin 0 rgba(255,0,60,.7)) drop-shadow(-${r4(0.3 + a * 0.8)}cqmin 0 rgba(0,220,255,.7))` } },
  { id: "shake", name: "Тряска камеры", group: "Динамика", ff: (a, c) => `crop=iw*0.92:ih*0.92:x='(iw-ow)/2*(1+${r4(a)}*sin(t*29))':y='(ih-oh)/2*(1+${r4(a)}*cos(t*23))',scale=${c.W}:${c.H}`, css: { motion: "shake" } },
  { id: "pulse", name: "Пульс (наезд в ритм)", group: "Динамика", ff: (a, c) => `scale=w='iw*(1+${r4(0.03 + a * 0.08)}*abs(sin(t*PI*2)))':h=-2:eval=frame,crop=${c.W}:${c.H}`, css: { motion: "pulse" } },
  { id: "kenburns", name: "Медленный наезд", group: "Динамика", ff: (a, c) => `scale=w='iw*(1+${r4(0.05 + a * 0.2)}*t/${r4(Math.max(0.5, c.dur))})':h=-2:eval=frame,crop=${c.W}:${c.H}`, css: { motion: "kenburns" } },
  { id: "flash", name: "Вспышки", group: "Динамика", ff: (a) => `eq=brightness='${r4(0.25 + a * 0.4)}*gt(mod(t,0.5),0.42)':eval=frame`, css: { motion: "flash" } },
  { id: "strobe", name: "Стробоскоп", group: "Динамика", ff: () => `eq=brightness='-0.6*gt(mod(t,0.16),0.08)':eval=frame`, css: { motion: "strobe" } },
  { id: "glow", name: "Свечение", group: "Свет", ff: (a, c) => `split[gA${c.n}][gB${c.n}];[gB${c.n}]gblur=sigma=${Math.round(10 + a * 25)}[gC${c.n}];[gA${c.n}][gC${c.n}]blend=all_mode=screen:all_opacity=${r4(0.3 + a * 0.5)}`, css: { filter: (a) => `brightness(${r4(1 + a * 0.15)}) saturate(1.1) drop-shadow(0 0 ${r4(1 + a * 2)}cqmin rgba(255,255,255,.35))` } },
  { id: "dreamy", name: "Мечтательный", group: "Свет", ff: (a, c) => `split[dA${c.n}][dB${c.n}];[dB${c.n}]gblur=sigma=${Math.round(18 + a * 25)},eq=brightness=0.06[dC${c.n}];[dA${c.n}][dC${c.n}]blend=all_mode=softlight:all_opacity=${r4(0.4 + a * 0.5)}`, css: { filter: () => "brightness(1.08) contrast(0.92) saturate(1.1) blur(0.1cqmin)" } },
  { id: "leak", name: "Засветка плёнки", group: "Свет", ff: (a) => `colorbalance=rh=${r4(0.1 + a * 0.2)}:gh=${r4(a * 0.06)}:bh=-${r4(0.05 + a * 0.1)},curves=preset=lighter`, css: { overlay: "leak" } },
  { id: "pixelate", name: "Пиксели", group: "Стилизация", ff: (a, c) => `scale=iw/${Math.round(4 + a * 28)}:ih/${Math.round(4 + a * 28)},scale=${c.W}:${c.H}:flags=neighbor`, css: { filter: () => "contrast(1.1)", overlay: "pixels" } },
  { id: "sketch", name: "Набросок", group: "Стилизация", ff: () => "edgedetect=mode=colormix:high=0.2", css: { filter: () => "grayscale(0.4) contrast(1.6) brightness(1.1)" } },
  { id: "comic", name: "Комикс", group: "Стилизация", ff: () => "edgedetect=mode=colormix:high=0.15,lutrgb=r='bitand(val,192)':g='bitand(val,192)':b='bitand(val,192)',eq=saturation=1.6", css: { filter: () => "saturate(1.8) contrast(1.4)" } },
  { id: "posterize", name: "Плакат", group: "Стилизация", ff: () => "lutrgb=r='bitand(val,224)':g='bitand(val,224)':b='bitand(val,224)'", css: { filter: () => "contrast(1.3) saturate(1.3)" } },
  { id: "invert", name: "Негатив", group: "Стилизация", ff: () => "negate", css: { filter: () => "invert(1)" } },
  { id: "fisheye", name: "Рыбий глаз", group: "Стилизация", ff: (a) => `lenscorrection=k1=${r4(0.1 + a * 0.35)}:k2=${r4(a * 0.12)}`, css: { transform: "scale(1.06)" } },
  { id: "thermal", name: "Тепловизор", group: "Стилизация", ff: () => "format=yuv420p,pseudocolor=p=heat", css: { filter: () => "grayscale(1) sepia(1) hue-rotate(-50deg) saturate(6)" } },
  { id: "night", name: "Ночное видение", group: "Стилизация", ff: (a) => `hue=s=0,colorchannelmixer=.2:.5:.1:0:.4:1:.2:0:.1:.3:.1,noise=alls=${Math.round(10 + a * 20)}:allf=t`, css: { filter: () => "grayscale(1) sepia(1) hue-rotate(60deg) saturate(4) brightness(1.1)", overlay: "grain" } },
];

/** Цепочка ffmpeg для списка эффектов. c — {W, H, dur, n} — n делает метки уникальными. */
function effectsChain(effects, c) {
  const parts = [];
  (effects || []).forEach((e, i) => {
    const def = EFFECTS.find((x) => x.id === e.kind);
    if (!def) return;
    parts.push(def.ff(clamp(num(e.amount, 0.5), 0, 1), { ...c, n: `${c.n || 0}x${i}` }));
  });
  return parts.join(",");
}

// ---------- фильтры (цветокоррекция) ----------

/**
 * Фильтры как в CapCut: именованный набор цветокоррекции. vf — для сборки,
 * css — для предпросмотра. Плюс свой файл LUT (.cube) — так подключаются
 * профессиональные пресеты из Premiere, DaVinci и с сайтов с LUT-ами.
 */
const FILTERS = [
  { id: "none", name: "Без фильтра", group: "", vf: "", css: "" },
  { id: "vivid", name: "Сочный", group: "Популярные", vf: "eq=saturation=1.3:contrast=1.06", css: "saturate(1.3) contrast(1.06)" },
  { id: "warm", name: "Тёплый", group: "Популярные", vf: "colorbalance=rs=0.07:gs=0.02:bs=-0.07:rm=0.04:bm=-0.04", css: "sepia(0.18) saturate(1.1)" },
  { id: "cold", name: "Холодный", group: "Популярные", vf: "colorbalance=rs=-0.06:bs=0.08:rm=-0.03:bm=0.05", css: "hue-rotate(-12deg) saturate(0.95)" },
  { id: "cinema", name: "Кино (бирюза и оранж)", group: "Популярные", vf: "colorbalance=rs=0.05:bs=-0.05:rh=-0.04:bh=0.06,eq=contrast=1.05:saturation=1.1", css: "contrast(1.05) saturate(1.1) hue-rotate(-6deg)" },
  { id: "film", name: "Плёнка", group: "Популярные", vf: "curves=preset=vintage", css: "sepia(0.25) contrast(0.95)" },
  { id: "matte", name: "Матовый", group: "Популярные", vf: "curves=all='0/0.08 0.5/0.5 1/0.92',eq=saturation=0.9", css: "contrast(0.85) brightness(1.05) saturate(0.9)" },
  { id: "hdr", name: "HDR", group: "Популярные", vf: "unsharp=5:5:0.8,eq=contrast=1.15:saturation=1.2,curves=preset=increase_contrast", css: "contrast(1.25) saturate(1.25)" },
  { id: "contrast", name: "Контраст", group: "Популярные", vf: "curves=preset=medium_contrast", css: "contrast(1.18)" },
  { id: "soft", name: "Мягкий", group: "Популярные", vf: "curves=preset=lighter,eq=saturation=0.9", css: "brightness(1.06) saturate(0.9) contrast(0.92)" },
  { id: "drama", name: "Драма", group: "Кино", vf: "curves=preset=strong_contrast,eq=saturation=0.8,vignette=angle=0.6", css: "contrast(1.35) saturate(0.8) brightness(0.95)" },
  { id: "noir", name: "Нуар", group: "Кино", vf: "hue=s=0,curves=preset=strong_contrast", css: "grayscale(1) contrast(1.45)" },
  { id: "bw", name: "Чёрно-белый", group: "Кино", vf: "hue=s=0,eq=contrast=1.1", css: "grayscale(1) contrast(1.1)" },
  { id: "bleach", name: "Обесцвеченный", group: "Кино", vf: "eq=saturation=0.45:contrast=1.2", css: "saturate(0.45) contrast(1.2)" },
  { id: "teal", name: "Бирюзовые тени", group: "Кино", vf: "colorbalance=rs=-0.1:gs=0.02:bs=0.1:rh=0.06:bh=-0.04", css: "hue-rotate(-15deg) saturate(1.1)" },
  { id: "blockbuster", name: "Блокбастер", group: "Кино", vf: "colorbalance=rs=-0.08:bs=0.1:rh=0.1:gh=0.03:bh=-0.08,eq=contrast=1.12:saturation=1.15", css: "contrast(1.12) saturate(1.15) hue-rotate(-8deg)" },
  { id: "kodak", name: "Кодак", group: "Плёнка", vf: "colorbalance=rm=0.05:gm=0.02:bm=-0.05,curves=preset=vintage,eq=saturation=1.15", css: "sepia(0.2) saturate(1.2) contrast(1.05)" },
  { id: "fuji", name: "Фуджи", group: "Плёнка", vf: "colorbalance=gs=0.04:bs=0.03:gm=0.03,eq=saturation=1.1:contrast=1.04", css: "hue-rotate(6deg) saturate(1.1)" },
  { id: "polaroid", name: "Полароид", group: "Плёнка", vf: "curves=all='0/0.1 1/0.95',colorbalance=rs=0.05:bs=0.05:gh=0.04,eq=saturation=0.85", css: "contrast(0.85) sepia(0.15) saturate(0.85) brightness(1.05)" },
  { id: "retro70", name: "Ретро 70-х", group: "Плёнка", vf: "colorbalance=rs=0.12:gs=0.05:bs=-0.12,curves=preset=vintage,eq=saturation=0.85", css: "sepia(0.45) saturate(0.9) hue-rotate(-8deg)" },
  { id: "faded", name: "Выцветший", group: "Плёнка", vf: "curves=all='0/0.15 1/0.88',eq=saturation=0.7", css: "contrast(0.75) saturate(0.7) brightness(1.08)" },
  { id: "summer", name: "Лето", group: "Сезоны", vf: "colorbalance=rs=0.08:gs=0.04:bs=-0.06,eq=saturation=1.25:brightness=0.03", css: "saturate(1.25) brightness(1.04) sepia(0.12)" },
  { id: "autumn", name: "Осень", group: "Сезоны", vf: "colorbalance=rs=0.12:gs=0.02:bs=-0.1,hue=h=-8,eq=saturation=1.1", css: "sepia(0.3) saturate(1.2) hue-rotate(-10deg)" },
  { id: "winter", name: "Зима", group: "Сезоны", vf: "colorbalance=rs=-0.08:gs=0.0:bs=0.12,eq=saturation=0.75:brightness=0.04", css: "hue-rotate(-20deg) saturate(0.75) brightness(1.06)" },
  { id: "spring", name: "Весна", group: "Сезоны", vf: "colorbalance=gs=0.06:rs=0.02,eq=saturation=1.15:brightness=0.04", css: "hue-rotate(10deg) saturate(1.15) brightness(1.05)" },
  { id: "sunset", name: "Закат", group: "Природа", vf: "colorbalance=rs=0.15:gs=0.02:bs=-0.08:rh=0.08:bh=-0.1,eq=saturation=1.2", css: "sepia(0.35) saturate(1.4) hue-rotate(-18deg)" },
  { id: "forest", name: "Лес", group: "Природа", vf: "colorbalance=gs=0.08:rs=-0.03:bs=-0.03,eq=saturation=1.1:contrast=1.05", css: "hue-rotate(18deg) saturate(1.15)" },
  { id: "ocean", name: "Океан", group: "Природа", vf: "colorbalance=bs=0.12:gs=0.04:rs=-0.06,eq=saturation=1.15", css: "hue-rotate(-30deg) saturate(1.2)" },
  { id: "food", name: "Еда", group: "Природа", vf: "colorbalance=rs=0.06:gs=0.03:bs=-0.05,eq=saturation=1.3:contrast=1.06:brightness=0.03", css: "saturate(1.35) contrast(1.06) brightness(1.04)" },
  { id: "neon", name: "Неон", group: "Стиль", vf: "colorbalance=rs=0.1:bs=0.15:gs=-0.08,eq=saturation=1.5:contrast=1.15", css: "saturate(1.6) contrast(1.15) hue-rotate(-25deg)" },
  { id: "cyber", name: "Киберпанк", group: "Стиль", vf: "colorbalance=rs=0.12:gs=-0.1:bs=0.18:rh=0.1:bh=0.1,eq=contrast=1.15:saturation=1.3", css: "saturate(1.5) contrast(1.15) hue-rotate(-40deg)" },
  { id: "pastel", name: "Пастель", group: "Стиль", vf: "curves=all='0/0.12 1/1',eq=saturation=0.7:brightness=0.06", css: "saturate(0.7) brightness(1.1) contrast(0.85)" },
  { id: "pink", name: "Розовый", group: "Стиль", vf: "colorbalance=rs=0.1:bs=0.06:gs=-0.04,eq=saturation=1.05", css: "hue-rotate(-30deg) saturate(1.1) sepia(0.1)" },
  { id: "lavender", name: "Лаванда", group: "Стиль", vf: "colorbalance=rs=0.05:bs=0.12:gs=-0.05,eq=saturation=0.9", css: "hue-rotate(-50deg) saturate(0.9)" },
  { id: "mono-blue", name: "Синий монохром", group: "Стиль", vf: "hue=s=0,colorchannelmixer=.3:.4:.2:0:.35:.45:.2:0:.5:.6:.4", css: "grayscale(1) sepia(1) hue-rotate(180deg) saturate(2.5)" },
  { id: "moody", name: "Мрачный", group: "Стиль", vf: "eq=brightness=-0.06:saturation=0.75:contrast=1.15,colorbalance=bs=0.05", css: "brightness(0.9) saturate(0.75) contrast(1.15)" },
];

// ---------- переходы ----------

/** Переходы: имя фильтра xfade и как его изображает предпросмотр. */
const TRANSITIONS = [
  { id: "none", name: "Склейка", css: "cut" },
  { id: "fade", name: "Растворение", css: "fade" },
  { id: "fadeblack", name: "Через чёрный", css: "black" },
  { id: "fadewhite", name: "Вспышка", css: "white" },
  { id: "dissolve", name: "Зерно", css: "fade" },
  { id: "slideleft", name: "Сдвиг влево", css: "slide-left" },
  { id: "slideright", name: "Сдвиг вправо", css: "slide-right" },
  { id: "slideup", name: "Сдвиг вверх", css: "slide-up" },
  { id: "slidedown", name: "Сдвиг вниз", css: "slide-down" },
  { id: "smoothleft", name: "Плавный сдвиг", css: "slide-left" },
  { id: "smoothup", name: "Плавно вверх", css: "slide-up" },
  { id: "zoomin", name: "Наезд", css: "zoom" },
  { id: "circleopen", name: "Круг", css: "circle" },
  { id: "circleclose", name: "Круг внутрь", css: "circle" },
  { id: "wipeleft", name: "Шторка влево", css: "wipe-left" },
  { id: "wiperight", name: "Шторка вправо", css: "wipe-right" },
  { id: "wipeup", name: "Шторка вверх", css: "wipe-up" },
  { id: "radial", name: "Радар", css: "radial" },
  { id: "pixelize", name: "Пиксели", css: "fade" },
  { id: "hblur", name: "Размытие", css: "blur" },
  { id: "diagtl", name: "Диагональ", css: "wipe-left" },
  { id: "squeezev", name: "Сжатие", css: "zoom" },
  { id: "rectcrop", name: "Прямоугольник", css: "circle" },
  { id: "distance", name: "Дистанция", css: "fade" },
];

// ---------- субтитры ----------

/**
 * Стили субтитров — данными, а не кодом. Из одной записи собираются и
 * субтитры для сборки (ASS), и вид в предпросмотре.
 *
 *  color/outline/active.color: hex, «accent» (акцент проекта) или «user»
 *    (цвет, выбранный человеком);
 *  reveal: line — строка целиком; accumulate — слова появляются по мере речи
 *    (будущие нарисованы прозрачными, чтобы строка не прыгала); word — одно слово;
 *  active: что происходит с говорящимся словом — цвет, масштаб, плашка,
 *    свечение, подчёркивание, анимация.
 */
const CAPTION_STYLES = [
  { id: "karaoke", name: "Подсветка слова", hint: "Строка целиком, говорящееся слово — акцентом и крупнее.", color: "user", outline: "#000000", outlineW: 4, shadow: 2, active: { color: "accent", scale: 1.12 }, reveal: "line", per: 4 },
  { id: "bold", name: "Хормози", hint: "ЗАГЛАВНЫМИ, толстая обводка, 2–3 слова, активное акцентом.", upper: true, color: "#FFFFFF", outline: "#000000", outlineW: 8, shadow: 3, active: { color: "accent", scale: 1.18, anim: "pop" }, reveal: "line", per: 3 },
  { id: "mrbeast", name: "Мистер Бист", hint: "Крупно, по два слова, жёлто-зелёный акцент, выпрыгивают.", upper: true, color: "#FFFFFF", outline: "#000000", outlineW: 10, shadow: 5, active: { color: "#7CFF3A", scale: 1.2, anim: "pop" }, reveal: "line", per: 2, sizeMul: 1.25 },
  { id: "pop", name: "По одному слову", hint: "Одно слово в центре, выпрыгивает.", upper: true, color: "accent", outline: "#000000", outlineW: 7, shadow: 3, active: { anim: "pop" }, reveal: "word", per: 1, sizeMul: 1.35, position: "center" },
  { id: "highlighter", name: "Маркер", hint: "Говорящееся слово — на цветной плашке, как выделение маркером.", color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 0, active: { box: "accent", color: "#111111" }, reveal: "line", per: 4 },
  { id: "box", name: "Плашка", hint: "Строка на тёмной подложке, активное слово акцентом.", color: "#FFFFFF", box: "#000000", boxAlpha: 0.35, active: { color: "accent" }, reveal: "line", per: 4 },
  { id: "accumulate", name: "Появляются по слову", hint: "Слова встают по мере речи, строка не прыгает.", color: "#FFFFFF", outline: "#000000", outlineW: 5, shadow: 2, active: { color: "accent", anim: "pop" }, reveal: "accumulate", per: 5 },
  { id: "fadein", name: "Плавные", hint: "Каждое слово проявляется, когда его произносят.", color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 3, active: { anim: "fade" }, reveal: "accumulate", per: 5 },
  { id: "bounce", name: "Прыгающие", hint: "Говорящееся слово подпрыгивает.", upper: true, color: "#FFFFFF", outline: "#000000", outlineW: 6, shadow: 2, active: { color: "accent", anim: "bounce", scale: 1.1 }, reveal: "line", per: 3 },
  { id: "neon", name: "Неон", hint: "Светящиеся буквы цвета акцента.", color: "#E8E8E8", outline: "accent", outlineW: 4, glow: 6, shadow: 0, active: { color: "#FFFFFF", scale: 1.18, anim: "pop" }, reveal: "line", per: 4 },
  { id: "fire", name: "Огонь", hint: "Оранжевые с красным свечением.", upper: true, color: "#FFB000", outline: "#FF2A00", outlineW: 4, glow: 6, shadow: 0, active: { color: "#FFFFFF", scale: 1.12 }, reveal: "line", per: 3 },
  { id: "ice", name: "Лёд", hint: "Голубые с холодным свечением.", color: "#DFF8FF", outline: "#00C8FF", outlineW: 3, glow: 6, shadow: 0, active: { color: "#00E5FF", scale: 1.1 }, reveal: "line", per: 4 },
  { id: "shadow3d", name: "Объёмные", hint: "Толстая цветная тень — буквы будто выдавлены.", upper: true, color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 7, shadowColor: "accent", active: { color: "accent" }, reveal: "line", per: 3 },
  { id: "outline", name: "Контур", hint: "Прозрачные буквы с обводкой, говорящееся слово залито.", upper: true, color: "transparent", outline: "#FFFFFF", outlineW: 4, shadow: 0, active: { color: "#FFFFFF", scale: 1.08 }, reveal: "line", per: 3 },
  { id: "underline", name: "Подчёркивание", hint: "Говорящееся слово подчёркнуто.", color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 2, active: { underline: true, color: "accent" }, reveal: "line", per: 4 },
  { id: "comic", name: "Комикс", hint: "Жёлтые, наклонные, с чёрной обводкой.", upper: true, italic: true, color: "#FFE500", outline: "#000000", outlineW: 7, shadow: 4, rotate: -4, active: { color: "#FFFFFF", scale: 1.15, anim: "pop" }, reveal: "line", per: 3 },
  { id: "retro", name: "Ретро 80-х", hint: "Розовые с бирюзовой тенью.", upper: true, italic: true, color: "#FF4FA3", outline: "#2A0A3A", outlineW: 3, shadow: 5, shadowColor: "#00E5FF", active: { color: "#FFFFFF" }, reveal: "line", per: 3 },
  { id: "glitch", name: "Глитч", hint: "Красно-голубое расслоение у говорящегося слова.", upper: true, color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 3, shadowColor: "#FF0040", active: { color: "#00F0FF", anim: "jitter" }, reveal: "line", per: 3 },
  { id: "emphasis", name: "Акцент на слове", hint: "Строка мелко, говорящееся слово — крупно ЗАГЛАВНЫМИ.", color: "#FFFFFF", outline: "#000000", outlineW: 3, shadow: 2, active: { color: "accent", scale: 1.45, upper: true }, reveal: "line", per: 4 },
  { id: "minimal", name: "Минимал", hint: "Строчные, без обводки, с мягкой тенью.", lower: true, color: "#FFFFFF", outlineW: 0, shadow: 3, shadowColor: "#000000", active: { color: "#FFFFFF" }, reveal: "line", per: 6, sizeMul: 0.8, bold: false },
  { id: "news", name: "Новости", hint: "Белые на плашке цвета акцента, слева внизу.", color: "#FFFFFF", box: "accent", boxAlpha: 0, active: { color: "#111111" }, reveal: "line", per: 6, sizeMul: 0.8, align: "left" },
  { id: "typewriter", name: "Печатная машинка", hint: "Слова набираются, моноширинный шрифт.", font: "Courier New", color: "#FFFFFF", box: "#000000", boxAlpha: 0.25, active: {}, reveal: "accumulate", per: 6, sizeMul: 0.85 },
  { id: "serif", name: "Журнальный", hint: "Наклонные с засечками, спокойные — для экспертного контента.", font: "Georgia", italic: true, color: "#FFFFFF", outline: "#000000", outlineW: 2, shadow: 2, active: { color: "accent" }, reveal: "line", per: 5, bold: false },
  { id: "clean", name: "Простые", hint: "Белые с обводкой, без подсветки. Для интервью и обучающих.", color: "user", outline: "#000000", outlineW: 4, shadow: 2, active: {}, reveal: "line", per: 6 },
];

// ---------- звуковые эффекты ----------

/**
 * Звуки собираются самим ffmpeg из формул — ничего не скачивается, и прав ни
 * у кого спрашивать не надо. Вкус у таких звуков проще студийных, поэтому
 * рядом есть и поиск по бесплатным библиотекам.
 */
const SFX = [
  { id: "whoosh", name: "Вжух", group: "Переходы", src: "anoisesrc=d=0.8:c=pink:a=0.8", af: "bandpass=f=1200:width_type=o:w=2,afade=t=in:d=0.4:curve=exp,afade=t=out:st=0.4:d=0.4:curve=exp,volume=2" },
  { id: "swoosh", name: "Свист короткий", group: "Переходы", src: "anoisesrc=d=0.4:c=white:a=0.6", af: "bandpass=f=3000:width_type=o:w=1.5,afade=t=in:d=0.15,afade=t=out:st=0.15:d=0.25,volume=2" },
  { id: "riser", name: "Нарастание", group: "Переходы", src: "aevalsrc='0.5*sin(2*PI*(150*t+300*t*t))*min(1,t/1.5)':d=2" },
  { id: "boom", name: "Удар (бум)", group: "Акценты", src: "aevalsrc='0.9*sin(2*PI*(70*t-12*t*t))*exp(-2.5*t)':d=1.6", af: "lowpass=f=300,volume=1.5" },
  { id: "impact", name: "Удар с хлопком", group: "Акценты", src: "aevalsrc='0.9*sin(2*PI*(60*t-10*t*t))*exp(-3*t)+0.5*(random(0)*2-1)*exp(-25*t)':d=1.2", af: "lowpass=f=1800" },
  { id: "bassdrop", name: "Басовый спуск", group: "Акценты", src: "aevalsrc='0.9*sin(2*PI*(160*t-55*t*t))*exp(-1.2*t)':d=2", af: "lowpass=f=400" },
  { id: "pop", name: "Поп", group: "Интерфейс", src: "aevalsrc='0.8*sin(2*PI*(500*t+1500*t*t))*exp(-30*t)':d=0.15" },
  { id: "click", name: "Щелчок", group: "Интерфейс", src: "aevalsrc='0.9*(random(0)*2-1)*exp(-300*t)':d=0.05" },
  { id: "ding", name: "Дзынь", group: "Интерфейс", src: "aevalsrc='0.6*sin(2*PI*1318*t)*exp(-3.5*t)+0.3*sin(2*PI*2637*t)*exp(-5*t)':d=1.5" },
  { id: "notify", name: "Уведомление", group: "Интерфейс", src: "aevalsrc='0.5*sin(2*PI*880*t)*exp(-8*t)*lt(t,0.15)+0.5*sin(2*PI*1320*(t-0.15))*exp(-6*(t-0.15))*gte(t,0.15)':d=0.7" },
  { id: "success", name: "Успех", group: "Интерфейс", src: "aevalsrc='0.4*(sin(2*PI*784*t)*lt(t,0.12)+sin(2*PI*988*t)*gte(t,0.12)*lt(t,0.24)+sin(2*PI*1175*t)*gte(t,0.24))*exp(-3*max(0,t-0.24))':d=1" },
  { id: "error", name: "Ошибка", group: "Интерфейс", src: "aevalsrc='0.4*sgn(sin(2*PI*140*t))*(lt(t,0.18)+gte(t,0.24)*lt(t,0.45))':d=0.5", af: "lowpass=f=1500" },
  { id: "cash", name: "Касса (ка-чинг)", group: "Акценты", src: "aevalsrc='0.5*(random(0)*2-1)*exp(-40*t)+0.5*sin(2*PI*2093*max(0,t-0.08))*exp(-4*max(0,t-0.08))*gte(t,0.08)+0.3*sin(2*PI*2637*max(0,t-0.08))*exp(-5*max(0,t-0.08))*gte(t,0.08)':d=1.2" },
  { id: "glitch", name: "Глитч", group: "Акценты", src: "aevalsrc='0.6*sgn(sin(2*PI*(220+880*gt(mod(t*13,1),0.5))*t))*gt(mod(t*7,1),0.3)':d=0.5" },
  { id: "typing", name: "Печать на клавиатуре", group: "Фон", src: "aevalsrc='0.8*(random(0)*2-1)*exp(-180*mod(t,0.11))':d=1.1", af: "highpass=f=1500" },
  { id: "shutter", name: "Затвор фотоаппарата", group: "Фон", src: "aevalsrc='0.9*(random(0)*2-1)*(exp(-120*t)+exp(-120*max(0,t-0.09))*gte(t,0.09))':d=0.25", af: "highpass=f=800" },
  { id: "heart", name: "Сердцебиение", group: "Фон", src: "aevalsrc='0.9*sin(2*PI*55*t)*(exp(-25*mod(t,0.8))+0.7*exp(-25*max(0,mod(t,0.8)-0.22))*gte(mod(t,0.8),0.22))':d=1.6", af: "lowpass=f=200,volume=2" },
  { id: "tick", name: "Тиканье", group: "Фон", src: "aevalsrc='0.7*(random(0)*2-1)*exp(-400*mod(t,0.5))':d=2", af: "bandpass=f=3000" },
  { id: "drumroll", name: "Барабанная дробь", group: "Акценты", src: "aevalsrc='0.6*(random(0)*2-1)*exp(-60*mod(t,0.05))*min(1,t/1.5)':d=2", af: "lowpass=f=900,volume=1.6" },
  { id: "scratch", name: "Скрэтч пластинки", group: "Акценты", src: "aevalsrc='0.6*(random(0)*2-1)*abs(sin(2*PI*6*t))':d=0.6", af: "bandpass=f=900:width_type=o:w=1.5,volume=1.5" },
];

function sfxArgs(id, dest) {
  const s = SFX.find((x) => x.id === id);
  if (!s) throw new Error(`Нет такого звука: ${id}`);
  return ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", s.src, ...(s.af ? ["-af", s.af] : []), "-ac", "2", "-ar", "48000", dest];
}

/** Звуковые эффекты на звуковой дорожке (на кусок звука). */
const AUDIO_FX = [
  { id: "none", name: "Без эффекта", af: "" },
  { id: "echo", name: "Эхо", af: "aecho=0.8:0.8:250:0.35" },
  { id: "reverb", name: "Зал", af: "aecho=0.8:0.85:60|120|180:0.35|0.25|0.15" },
  { id: "phone", name: "Телефон", af: "highpass=f=400,lowpass=f=3200,volume=1.4" },
  { id: "radio", name: "Радио", af: "highpass=f=600,lowpass=f=2800,acrusher=bits=10:mode=log:aa=1,volume=1.3" },
  { id: "robot", name: "Робот", af: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75" },
  { id: "chipmunk", name: "Бурундук", af: "asetrate=48000*1.45,aresample=48000,atempo=0.69" },
  { id: "deep", name: "Низкий голос", af: "asetrate=48000*0.78,aresample=48000,atempo=1.282" },
  { id: "chorus", name: "Хор", af: "chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3" },
  { id: "tremolo", name: "Дрожь", af: "tremolo=f=6:d=0.6" },
  { id: "underwater", name: "Под водой", af: "lowpass=f=500,aecho=0.8:0.6:40:0.4" },
  { id: "megaphone", name: "Мегафон", af: "highpass=f=700,lowpass=f=3500,acompressor=threshold=0.1:ratio=8,volume=2" },
];

// ---------- экспорт ----------

const EXPORT_FORMATS = [
  { id: "mp4", name: "MP4 (H.264) — везде открывается", ext: ".mp4", kind: "video" },
  { id: "mp4-hevc", name: "MP4 (H.265) — вдвое меньше, iPhone и новые ТВ", ext: ".mp4", kind: "video" },
  { id: "webm", name: "WebM (VP9) — для сайтов", ext: ".webm", kind: "video" },
  { id: "mov", name: "MOV (ProRes) — для монтажа в другой программе", ext: ".mov", kind: "video" },
  { id: "gif", name: "GIF — анимация без звука", ext: ".gif", kind: "gif" },
  { id: "mp3", name: "MP3 — только звук", ext: ".mp3", kind: "audio" },
  { id: "wav", name: "WAV — только звук, без сжатия", ext: ".wav", kind: "audio" },
  { id: "m4a", name: "M4A (AAC) — только звук", ext: ".m4a", kind: "audio" },
];

const EXPORT_SIZES = [
  { id: "source", name: "Как у проекта", short: 0 },
  { id: "2160", name: "4K (2160p)", short: 2160 },
  { id: "1440", name: "2K (1440p)", short: 1440 },
  { id: "1080", name: "Full HD (1080p)", short: 1080 },
  { id: "720", name: "HD (720p)", short: 720 },
  { id: "480", name: "480p", short: 480 },
  { id: "360", name: "360p", short: 360 },
];

const QUALITY = { high: { crf: 17, vp9: 28, hevc: 22 }, normal: { crf: 20, vp9: 32, hevc: 26 }, small: { crf: 25, vp9: 38, hevc: 30 } };

/** Размер кадра под экспорт: короткая сторона — выбранная, пропорции — проекта. */
function exportSize(canvas, sizeId) {
  const s = EXPORT_SIZES.find((x) => x.id === sizeId);
  if (!s || !s.short) return { width: canvas.width, height: canvas.height };
  const k = s.short / Math.min(canvas.width, canvas.height);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(canvas.width * k), height: even(canvas.height * k) };
}

/** Кодеки итогового файла. */
function codecArgs(format, quality = "normal", fps = 30) {
  const q = QUALITY[quality] || QUALITY.normal;
  switch (format) {
    case "mp4-hevc":
      return ["-c:v", "libx265", "-preset", "medium", "-crf", String(q.hevc), "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
    case "webm":
      return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(q.vp9), "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-pix_fmt", "yuv420p", "-c:a", "libopus", "-b:a", "160k"];
    case "mov":
      return ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-c:a", "pcm_s16le"];
    default:
      return ["-c:v", "libx264", "-preset", "medium", "-crf", String(q.crf), "-pix_fmt", "yuv420p", "-r", String(fps), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"];
  }
}

/** Из готового ролика — GIF (двумя проходами через палитру) или только звук. */
function derivedArgs(format, master, dest, { gifWidth = 480, gifFps = 15 } = {}) {
  const base = ["-y", "-hide_banner", "-loglevel", "error", "-i", master];
  if (format === "gif") {
    return [...base, "-filter_complex", `fps=${gifFps},scale=${gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, "-loop", "0", dest];
  }
  if (format === "mp3") return [...base, "-vn", "-c:a", "libmp3lame", "-b:a", "256k", dest];
  if (format === "wav") return [...base, "-vn", "-c:a", "pcm_s16le", dest];
  if (format === "m4a") return [...base, "-vn", "-c:a", "aac", "-b:a", "256k", dest];
  throw new Error(`Неизвестный формат: ${format}`);
}

/** Таблицы для окна: без функций, только то, что можно передать. */
function publicTables() {
  const cssOf = (e) => ({ filter: e.css.filter ? e.css.filter(0.5) : "", overlay: e.css.overlay || "", motion: e.css.motion || "", transform: e.css.transform || "" });
  return {
    effects: EFFECTS.map((e) => ({ id: e.id, name: e.name, group: e.group, css: cssOf(e), cssFilterLow: e.css.filter ? e.css.filter(0) : "", cssFilterHigh: e.css.filter ? e.css.filter(1) : "" })),
    filters: FILTERS.map(({ id, name, group, css }) => ({ id, name, group, css })),
    transitions: TRANSITIONS,
    captionStyles: CAPTION_STYLES,
    sfx: SFX.map(({ id, name, group }) => ({ id, name, group })),
    audioFx: AUDIO_FX.map(({ id, name }) => ({ id, name })),
    eases: EASES,
    exportFormats: EXPORT_FORMATS,
    exportSizes: EXPORT_SIZES,
  };
}

module.exports = {
  TRANSFORM_DEFAULT,
  TRANSFORM_PROPS,
  EASES,
  EFFECTS,
  FILTERS,
  TRANSITIONS,
  CAPTION_STYLES,
  SFX,
  AUDIO_FX,
  EXPORT_FORMATS,
  EXPORT_SIZES,
  normalizeTransform,
  normalizeKeyframes,
  easeJs,
  sampleTransform,
  keyframeExpr,
  transformChain,
  overlayXY,
  effectsChain,
  sfxArgs,
  exportSize,
  codecArgs,
  derivedArgs,
  publicTables,
};
