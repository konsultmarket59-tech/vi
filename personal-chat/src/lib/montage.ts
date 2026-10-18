// Таймлайн «Монтажа» на стороне окна: раскладка кусков по времени, перевод
// времени ролика во время исходника и обратно. Тот же расчёт, что в
// electron/montage.cjs: предпросмотр обязан показывать ровно то, что соберётся,
// иначе человек будет править одно, а получать другое.

import type { CSSProperties, DragEvent } from "react";
import type {
  MontageAudio,
  MontageCaptionStyle,
  MontageCaptions,
  MontageClip,
  MontageMotion,
  MontageEffectDef,
  MontageFilterDef,
  MontageKeyframe,
  MontageLayer,
  MontageProject,
  MontageText,
  MontageTransform,
  MontageWord,
} from "./types";

export const round3 = (v: number) => Math.round(v * 1000) / 1000;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clipDuration(c: MontageClip) {
  return Math.max(0.04, (c.out - c.in) / (c.speed || 1));
}

export interface LayoutItem {
  id: string;
  start: number;
  end: number;
  duration: number;
  overlap: number;
}

/** Где каждый кусок стоит на выходе; переход съедает своё время. */
export function layout(clips: MontageClip[]): { items: LayoutItem[]; duration: number } {
  const items: LayoutItem[] = [];
  let t = 0;
  clips.forEach((c, i) => {
    const dur = clipDuration(c);
    let overlap = 0;
    if (i > 0 && c.transition && c.transition.kind !== "none") {
      overlap = Math.min(c.transition.duration, dur / 2, clipDuration(clips[i - 1]) / 2);
    }
    const start = Math.max(0, t - overlap);
    items.push({ id: c.id, start: round3(start), end: round3(start + dur), duration: dur, overlap });
    t = start + dur;
  });
  return { items, duration: round3(t) };
}

export function projectDuration(p: MontageProject) {
  const main = layout(p.clips).duration;
  return main || p.texts.reduce((a, t) => Math.max(a, t.end), 0);
}

/** Время ролика → кусок и время в его исходнике. */
export function outputToSource(clips: MontageClip[], t: number) {
  const { items } = layout(clips);
  for (let i = items.length - 1; i >= 0; i--) {
    if (t >= items[i].start - 1e-6) {
      const c = clips[i];
      const local = clamp(t - items[i].start, 0, items[i].duration);
      return { index: i, clip: c, time: c.in + local * c.speed, local, item: items[i] };
    }
  }
  return null;
}

export function sourceToOutput(clips: MontageClip[], src: string, t: number): number | null {
  const { items } = layout(clips);
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (c.src !== src || t < c.in - 1e-6 || t > c.out + 1e-6) continue;
    return items[i].start + (t - c.in) / c.speed;
  }
  return null;
}

export function splitAt(clips: MontageClip[], t: number): MontageClip[] {
  const hit = outputToSource(clips, t);
  if (!hit) return clips;
  const { index, clip, time } = hit;
  if (time - clip.in < 0.05 || clip.out - time < 0.05) return clips;
  const a = { ...clip, out: round3(time), fadeOut: 0 };
  const b = { ...clip, id: uid("clip"), in: round3(time), fadeIn: 0, transition: { kind: "none", duration: clip.transition.duration } };
  return [...clips.slice(0, index), a, b, ...clips.slice(index + 1)];
}

/** Слова на выходе — для субтитров в предпросмотре и монтажа по тексту. */
export interface OutputWord {
  w: string;
  s: number;
  e: number;
  clipId: string;
  src: string;
  index: number;
}

export function outputWords(clips: MontageClip[], transcripts: Record<string, { words: MontageWord[] }>): OutputWord[] {
  const { items } = layout(clips);
  const out: OutputWord[] = [];
  clips.forEach((clip, i) => {
    const tr = transcripts[clip.src];
    if (!tr) return;
    tr.words.forEach((w, index) => {
      const mid = (w.s + w.e) / 2;
      if (mid < clip.in || mid > clip.out) return;
      const s = items[i].start + (Math.max(w.s, clip.in) - clip.in) / clip.speed;
      const e = items[i].start + (Math.min(w.e, clip.out) - clip.in) / clip.speed;
      out.push({ w: w.w, s, e: Math.max(e, s + 0.05), clipId: clip.id, src: clip.src, index });
    });
  });
  return out.sort((a, b) => a.s - b.s);
}

/** Строки субтитров — тот же разрез, что у сборки. */
export function captionLines(words: OutputWord[], wordsPerLine = 4, maxChars = 28) {
  const lines: { words: OutputWord[]; start: number; end: number }[] = [];
  let cur: OutputWord[] = [];
  const flush = () => {
    if (cur.length) lines.push({ words: cur, start: cur[0].s, end: cur[cur.length - 1].e });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.s - prev.e > 0.7) flush();
    const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (cur.length >= wordsPerLine || (cur.length && chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  lines.forEach((l, i) => {
    const next = lines[i + 1];
    const hold = next ? Math.min(next.start, l.end + 0.6) : l.end + 0.4;
    l.end = Math.max(l.end, hold);
  });
  return lines;
}

export function activeTexts(texts: MontageText[], t: number) {
  return texts.filter((x) => t >= x.start && t < x.end);
}

/** Адрес файла для плеера: локальные файлы отдаёт своя схема приложения. */
export function mediaUrl(scheme: string, file: string) {
  return `${scheme}://media/${encodeURIComponent(file)}`;
}

export function fmtTime(t: number, withFrames = false) {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  const s = Math.floor(v % 60);
  const tail = withFrames ? `.${String(Math.floor((v % 1) * 10))}` : "";
  return `${m}:${String(s).padStart(2, "0")}${tail}`;
}

export const fileName = (p: string) => (p ? p.split(/[\\/]/).pop() || p : "");

// ---------- ключевые точки ----------

export const TRANSFORM_DEFAULT: MontageTransform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
export const LAYER_TRANSFORM: MontageTransform = { x: 0.5, y: 0.5, scale: 0.45, rotation: 0, opacity: 1 };
const PROPS: (keyof MontageTransform)[] = ["x", "y", "scale", "rotation", "opacity"];

/** То же сглаживание, что у сборки (montagefx.cjs → easeJs). */
export function ease(kind: string, p: number) {
  switch (kind) {
    case "linear": return p;
    case "in": return p * p * p;
    case "out": return 1 - Math.pow(1 - p, 3);
    case "back": { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
    case "hold": return 0;
    default: return p * p * (3 - 2 * p);
  }
}

export function sampleTransform(base: MontageTransform, kfs: MontageKeyframe[], t: number): MontageTransform {
  if (!kfs || !kfs.length) return base;
  const pick = (k: MontageKeyframe) => ({ x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity });
  if (t <= kfs[0].t) return pick(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return pick(last);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const c = kfs[i + 1];
    if (t >= a.t && t < c.t) {
      const e = ease(a.ease, (t - a.t) / (c.t - a.t));
      const out = { ...base };
      for (const p of PROPS) out[p] = a[p] + (c[p] - a[p]) * e;
      return out;
    }
  }
  return pick(last);
}

/**
 * Изменить преобразование в момент t. Как в CapCut: пока ключевых точек нет,
 * меняется само преобразование; если есть — правка ставит или двигает точку
 * в этом моменте, и движение меняется только здесь.
 */
export function setTransformAt<T extends { transform: MontageTransform; keyframes: MontageKeyframe[] }>(item: T, t: number, patch: Partial<MontageTransform>): T {
  if (!item.keyframes.length) return { ...item, transform: { ...item.transform, ...patch } };
  const cur = sampleTransform(item.transform, item.keyframes, t);
  const at = item.keyframes.findIndex((k) => Math.abs(k.t - t) < 0.04);
  const kf: MontageKeyframe = { ...(at >= 0 ? item.keyframes[at] : { t: round3(t), ease: "smooth", ...cur }), ...patch };
  const keyframes = at >= 0 ? item.keyframes.map((k, i) => (i === at ? kf : k)) : [...item.keyframes, kf].sort((a, b) => a.t - b.t);
  return { ...item, keyframes };
}

export function addKeyframe<T extends { transform: MontageTransform; keyframes: MontageKeyframe[] }>(item: T, t: number): T {
  if (item.keyframes.some((k) => Math.abs(k.t - t) < 0.04)) return item;
  const cur = sampleTransform(item.transform, item.keyframes, t);
  return { ...item, keyframes: [...item.keyframes, { t: round3(t), ease: "smooth", ...cur }].sort((a, b) => a.t - b.t) };
}

/** Готовые движения одной кнопкой — набор ключевых точек на весь кусок. */
export function motionPreset(id: string, dur: number, base: MontageTransform): MontageKeyframe[] {
  const k = (t: number, p: Partial<MontageTransform>, e = "smooth"): MontageKeyframe => ({ t: round3(t), ease: e, ...base, ...p });
  const s = base.scale;
  switch (id) {
    case "zoom-in": return [k(0, { scale: s }), k(dur, { scale: s * 1.25 })];
    case "zoom-out": return [k(0, { scale: s * 1.25 }), k(dur, { scale: s })];
    case "pan-left": return [k(0, { x: base.x + 0.06, scale: s * 1.15 }), k(dur, { x: base.x - 0.06, scale: s * 1.15 })];
    case "pan-right": return [k(0, { x: base.x - 0.06, scale: s * 1.15 }), k(dur, { x: base.x + 0.06, scale: s * 1.15 })];
    case "pop-in": return [k(0, { scale: s * 0.2, opacity: 0 }, "back"), k(Math.min(0.45, dur / 2), { scale: s, opacity: 1 })];
    case "slide-in": return [k(0, { x: base.x + 0.7 }, "out"), k(Math.min(0.5, dur / 2), { x: base.x })];
    case "drop-in": return [k(0, { y: base.y - 0.6 }, "back"), k(Math.min(0.55, dur / 2), { y: base.y })];
    case "spin-in": return [k(0, { scale: s * 0.3, rotation: -180, opacity: 0 }, "out"), k(Math.min(0.6, dur / 2), { scale: s, rotation: 0, opacity: 1 })];
    case "fade-out": return [k(Math.max(0, dur - 0.5), { opacity: 1 }), k(dur, { opacity: 0 })];
    case "tilt": return [k(0, { rotation: -4, scale: s * 1.08 }), k(dur, { rotation: 4, scale: s * 1.08 })];
    default: return [];
  }
}

export const MOTION_PRESETS = [
  { id: "zoom-in", name: "Наезд" },
  { id: "zoom-out", name: "Отъезд" },
  { id: "pan-left", name: "Панорама влево" },
  { id: "pan-right", name: "Панорама вправо" },
  { id: "pop-in", name: "Выпрыгивает" },
  { id: "slide-in", name: "Въезжает" },
  { id: "drop-in", name: "Падает сверху" },
  { id: "spin-in", name: "Влетает с поворотом" },
  { id: "tilt", name: "Покачивание" },
  { id: "fade-out", name: "Гаснет в конце" },
];

export function layerDuration(l: MontageLayer) {
  return Math.max(0.04, (l.out - l.in) / (l.speed || 1));
}

// ---------- вид в предпросмотре ----------

/** CSS-фильтр куска: цвет, фильтр (с силой) и эффекты. */
export function lookCss(adj: MontageClip["adjust"], effects: MontageClip["effects"], filters: MontageFilterDef[], fxDefs: MontageEffectDef[]) {
  // Коррекция в окне — приближение того, что сделает ffmpeg: экспозиция и тени —
  // яркостью, света и чёткость — контрастом, сочность — насыщенностью.
  const ex = adj?.exposure || 0;
  const sh = adj?.shadows || 0;
  const hl = adj?.highlights || 0;
  const bright = (1 + (adj?.brightness || 0)) * Math.pow(2, ex * 0.6) * (1 + sh * 0.05 + hl * 0.03);
  const contrast = (adj?.contrast ?? 1) * (1 - sh * 0.1 + hl * 0.06) * (1 + (adj?.clarity || 0) * 0.12);
  const sat = (adj?.saturation ?? 1) * (1 + (adj?.vibrance || 0) * 0.55);
  const parts = [`brightness(${round3(bright)})`, `contrast(${round3(contrast)})`, `saturate(${round3(sat)})`];
  const sharp = Math.round(((adj?.sharpness || 0) + (adj?.clarity || 0) * 0.4) * 5);
  if (sharp > 0) parts.push(`url(#mt-sharpen-${Math.min(5, sharp)})`);
  if ((adj?.denoise || 0) > 0.05) parts.push(`blur(${round3((adj?.denoise || 0) * 0.08)}cqmin)`);
  const f = filters.find((x) => x.id === adj?.filter);
  if (f && f.css && (adj?.filterAmount ?? 1) > 0.05) parts.push(f.css);
  for (const e of effects || []) {
    const d = fxDefs.find((x) => x.id === e.kind);
    if (d && d.css.filter) parts.push(e.amount < 0.5 ? d.cssFilterLow || d.css.filter : e.amount > 0.5 ? d.cssFilterHigh || d.css.filter : d.css.filter);
  }
  return parts.join(" ");
}

/** Движение эффектов (тряска, пульс, вспышки) в момент local. */
export function motionCss(effects: MontageClip["effects"], fxDefs: MontageEffectDef[], local: number, dur: number) {
  let tx = 0;
  let ty = 0;
  let sc = 1;
  let bright = 1;
  let mirror = false;
  const overlays: string[] = [];
  for (const e of effects || []) {
    const d = fxDefs.find((x) => x.id === e.kind);
    if (!d) continue;
    const a = e.amount;
    if (d.css.overlay) overlays.push(d.css.overlay);
    if (d.css.transform === "scaleX(-1)") mirror = true;
    switch (d.css.motion) {
      case "shake": tx += Math.sin(local * 29) * 2.5 * a; ty += Math.cos(local * 23) * 2.5 * a; sc *= 1.09; break;
      case "pulse": sc *= 1 + (0.03 + a * 0.08) * Math.abs(Math.sin(local * Math.PI * 2)); break;
      case "kenburns": sc *= 1 + (0.05 + a * 0.2) * (local / Math.max(0.5, dur)); break;
      case "flash": if (local % 0.5 > 0.42) bright *= 1.25 + a * 0.4; break;
      case "strobe": if (local % 0.16 > 0.08) bright *= 0.4; break;
      case "glitch": if ((local * 9) % 1 > 0.8) tx += 1.5; break;
    }
  }
  const transform = `translate(${tx}%, ${ty}%) scale(${mirror ? -sc : sc}, ${sc})`;
  return { transform, brightness: bright, overlays };
}

/** Вид субтитров по стилю — те же данные, что у сборки (montagefx.cjs). */
export function captionCss(st: MontageCaptionStyle, cap: MontageCaptions) {
  const color = (c?: string, d = "#FFFFFF") => (c === "accent" ? cap.highlight : c === "user" ? cap.color : c === "transparent" ? "transparent" : c || d);
  const outline = (st.outlineW ?? 4) / 10.8;
  const shadow = (st.shadow ?? 2) / 10.8;
  const shadows: string[] = [];
  if (st.glow) shadows.push(`0 0 ${st.glow / 5}cqmin ${color(st.outline)}`, `0 0 ${st.glow / 2.5}cqmin ${color(st.outline)}`);
  if (shadow) shadows.push(`${shadow}cqmin ${shadow}cqmin 0 ${color(st.shadowColor, "rgba(0,0,0,.55)")}`);
  const base: CSSProperties = {
    color: color(st.color),
    fontWeight: st.bold === false ? 500 : 800,
    fontStyle: st.italic ? "italic" : undefined,
    textTransform: st.upper || cap.upper ? "uppercase" : st.lower ? "lowercase" : undefined,
    WebkitTextStroke: !st.box && outline ? `${outline}cqmin ${color(st.outline, "#000")}` : undefined,
    paintOrder: "stroke fill",
    textShadow: shadows.join(", ") || undefined,
    background: st.box ? color(st.box, "#000") : undefined,
    opacity: undefined,
    fontFamily: st.font && !cap.fontPath ? st.font : undefined,
    transform: st.rotate ? `rotate(${st.rotate}deg)` : undefined,
    fontSize: `${((cap.size * (st.sizeMul || 1)) / 1080) * 100}cqmin`,
  };
  const a = st.active || {};
  const active: CSSProperties = {
    color: a.color ? color(a.color) : undefined,
    transform: a.scale ? `scale(${a.scale})` : undefined,
    background: a.box ? color(a.box) : undefined,
    borderRadius: a.box ? "0.6cqmin" : undefined,
    padding: a.box ? "0 0.8cqmin" : undefined,
    textDecoration: a.underline ? "underline" : undefined,
    textTransform: a.upper ? "uppercase" : undefined,
    WebkitTextStroke: a.box ? "0" : undefined,
  };
  return { base, active };
}

export function newClip(src: string, kind: string, duration: number): MontageClip {
  return {
    id: uid("clip"),
    src,
    kind,
    in: 0,
    out: round3(kind === "image" ? 3 : Math.max(0.1, duration || 5)),
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    transition: { kind: "none", duration: 0.4 },
    fit: "",
    focusX: 0.5,
    focusY: 0.5,
    zoom: 1,
    adjust: { brightness: 0, contrast: 1, saturation: 1, filter: "none", filterAmount: 1, lut: "" },
    effects: [],
    transform: { ...TRANSFORM_DEFAULT },
    keyframes: [],
    reverse: false,
    audioEffect: "none",
    label: "",
  };
}

export function newLayer(src: string, kind: string, duration: number, start: number, track = 1): MontageLayer {
  return {
    id: uid("layer"),
    src,
    kind,
    track,
    start: round3(start),
    in: 0,
    out: round3(kind === "image" ? 3 : Math.max(0.2, Math.min(duration || 5, 60))),
    speed: 1,
    volume: 1,
    muted: true,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...LAYER_TRANSFORM },
    keyframes: [],
    effects: [],
    adjust: { brightness: 0, contrast: 1, saturation: 1, filter: "none", filterAmount: 1, lut: "" },
    mask: "none",
    chroma: { enabled: false, color: "#00FF00", similarity: 0.18, blend: 0.08 },
    label: "",
  };
}

export function newAudio(src: string, kind: MontageAudio["kind"], start: number, duration: number): MontageAudio {
  const music = kind === "music";
  return {
    id: uid("audio"), kind, effect: "none", src, start: round3(start), in: 0, out: round3(Math.max(0.1, duration || 3)),
    volume: music ? 0.25 : 1, fadeIn: music ? 0.5 : 0, fadeOut: music ? 1.5 : 0.05, duck: music, loop: false,
  };
}

export function newText(start: number, text = "Текст", style = "title"): MontageText {
  return { id: uid("text"), text, start: round3(start), end: round3(start + 2.5), style, animation: "pop", position: "", size: 0, color: "", bg: "", upper: true, x: null, y: null };
}

/** Пустой моушн с заданными полями. */
export function motionOf(patch: Partial<MontageMotion>): MontageMotion {
  return { html: "", template: "", fields: {}, duration: 5, transparent: false, designDir: "", title: "", storyboard: [], assets: {}, ...patch };
}

/** Кусок главной дорожки из моушн-ролика. */
export function newMotionClip(motion: MontageMotion): MontageClip {
  const c = newClip("", "motion", motion.duration);
  return { ...c, src: `motion://${c.id}`, motion, label: motion.title || "Моушн" };
}

/** Титр-моушн слоем поверх видео — на весь кадр. */
export function newMotionLayer(motion: MontageMotion, start: number, track = 1): MontageLayer {
  const l = newLayer("", "motion", motion.duration, start, track);
  return { ...l, src: `motion://${l.id}`, motion: { ...motion, transparent: true }, out: round3(motion.duration), muted: true, transform: { ...l.transform, scale: 1 }, label: motion.title || "Титр" };
}

/** Подпись блока на дорожке: у моушна — название, у файла — имя. */
export function itemLabel(it: { src: string; label?: string; kind?: string; motion?: MontageMotion }): string {
  if (it.label) return it.label;
  if (it.kind === "motion") return it.motion?.title || "Моушн";
  return fileName(it.src);
}

/** Слои поверх кадра для коррекции в окне: температура, оттенок, виньетка, зерно. */
export function gradeOverlays(adj: MontageClip["adjust"]): CSSProperties[] {
  const out: CSSProperties[] = [];
  const t = adj?.temperature || 0;
  if (Math.abs(t) > 0.01) out.push({ background: t > 0 ? "rgb(255,150,40)" : "rgb(40,130,255)", mixBlendMode: "soft-light", opacity: Math.abs(t) * 0.7 });
  const g = adj?.tint || 0;
  if (Math.abs(g) > 0.01) out.push({ background: g > 0 ? "rgb(255,60,200)" : "rgb(60,255,90)", mixBlendMode: "soft-light", opacity: Math.abs(g) * 0.5 });
  const v = adj?.vignette || 0;
  if (v > 0.01) out.push({ background: `radial-gradient(ellipse at center, transparent ${Math.round(60 - v * 25)}%, rgba(0,0,0,${round3(0.35 + v * 0.5)}) 100%)` });
  return out;
}

// ---------- перетаскивание из панелей на таймлайн ----------

/** Что тащат: эффект, фильтр, переход, файл из «Медиа» или заготовку титра. */
export type DragPayload =
  | { type: "effect" | "filter" | "transition"; id: string; name?: string }
  | { type: "media"; path: string; kind: string; duration: number };

const DRAG_MIME = "application/x-montage";

export function setDrag(e: DragEvent, data: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(data));
  e.dataTransfer.effectAllowed = "copy";
  dragNow = data;
}

/** Текущее перетаскивание — во время dragover данные события читать нельзя. */
export let dragNow: DragPayload | null = null;
export function endDrag() {
  dragNow = null;
}

export function getDrag(e: DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    return raw ? (JSON.parse(raw) as DragPayload) : dragNow;
  } catch {
    return dragNow;
  }
}

// ---------- раскладки экрана ----------

export interface MontageLayout {
  id: string;
  name: string;
  cells: { x: number; y: number; w: number; h: number }[];
}

const grid = (cols: number, rows: number) => {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c / cols, y: r / rows, w: 1 / cols, h: 1 / rows });
  return out;
};

/** Раскладки: ячейки в долях кадра. Зазор и скругление добавляются при применении. */
export const LAYOUTS: MontageLayout[] = [
  { id: "rows2", name: "2 сверху вниз", cells: grid(1, 2) },
  { id: "cols2", name: "2 рядом", cells: grid(2, 1) },
  { id: "rows3", name: "3 сверху вниз", cells: grid(1, 3) },
  { id: "grid4", name: "4 сеткой", cells: grid(2, 2) },
  { id: "grid6", name: "6 сеткой", cells: grid(2, 3) },
  { id: "big2", name: "Большое + 2", cells: [{ x: 0, y: 0, w: 1, h: 0.62 }, { x: 0, y: 0.62, w: 0.5, h: 0.38 }, { x: 0.5, y: 0.62, w: 0.5, h: 0.38 }] },
  { id: "side3", name: "Большое + 2 сбоку", cells: [{ x: 0, y: 0, w: 0.62, h: 1 }, { x: 0.62, y: 0, w: 0.38, h: 0.5 }, { x: 0.62, y: 0.5, w: 0.38, h: 0.5 }] },
  { id: "pip-br", name: "Окно справа внизу", cells: [{ x: 0.6, y: 0.66, w: 0.34, h: 0.26 }] },
  { id: "pip-tl", name: "Окно слева вверху", cells: [{ x: 0.06, y: 0.08, w: 0.34, h: 0.26 }] },
  { id: "card", name: "Карточка по центру", cells: [{ x: 0.08, y: 0.15, w: 0.84, h: 0.6 }] },
  { id: "diag2", name: "Два окна наискосок", cells: [{ x: 0.06, y: 0.08, w: 0.6, h: 0.42 }, { x: 0.34, y: 0.5, w: 0.6, h: 0.42 }] },
];

/** Ячейки раскладки с зазором (доля кадра) — зазор режется внутрь каждой ячейки. */
export function layoutCells(l: MontageLayout, gap: number) {
  return l.cells.map((c) => ({
    x: round3(c.x + (c.x > 0.001 ? gap / 2 : gap)),
    y: round3(c.y + (c.y > 0.001 ? gap / 2 : gap)),
    w: round3(c.w - (c.x > 0.001 ? gap / 2 : gap) - (c.x + c.w < 0.999 ? gap / 2 : gap)),
    h: round3(c.h - (c.y > 0.001 ? gap / 2 : gap) - (c.y + c.h < 0.999 ? gap / 2 : gap)),
  }));
}

// ---------- маски слоя ----------

export const MASK_SHAPES: { id: MontageLayer["mask"]; name: string; file?: string }[] = [
  { id: "none", name: "Без маски" },
  { id: "rect", name: "Прямоугольник" },
  { id: "rounded", name: "Скругление" },
  { id: "circle", name: "Круг", file: "circle.png" },
  { id: "oval", name: "Овал", file: "circle.png" },
  { id: "squircle", name: "Плавный квадрат", file: "squircle.png" },
  { id: "heart", name: "Сердце", file: "heart.png" },
  { id: "star", name: "Звезда", file: "star.png" },
  { id: "hexagon", name: "Шестиугольник", file: "hexagon.png" },
  { id: "arch", name: "Арка", file: "arch.png" },
  { id: "diamond", name: "Ромб", file: "diamond.png" },
  { id: "blob", name: "Капля", file: "blob.png" },
  { id: "triangle", name: "Треугольник", file: "triangle.png" },
];

/** CSS маски для предпросмотра: форма картинкой, «Овал» — растянутый круг. */
export function maskCss(mask: MontageLayer["mask"], masksDir: string | undefined, scheme: string): CSSProperties {
  const shape = MASK_SHAPES.find((m) => m.id === mask);
  if (!shape || !shape.file || !masksDir) return {};
  const url = `url("${mediaUrl(scheme, `${masksDir.replace(/[\\/]$/, "")}/${shape.file}`)}")`;
  const size = mask === "oval" ? "100% 100%" : "contain";
  return { WebkitMaskImage: url, maskImage: url, WebkitMaskSize: size, maskSize: size, WebkitMaskPosition: "center", maskPosition: "center", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" } as CSSProperties;
}

// ---------- удаление фона ----------

/** Ключ маски — как в electron/montage.cjs: те же границы и модель — маска годится. */
export function bgKey(it: { src: string; in: number; out: number; bgRemove?: MontageClip["bgRemove"] }) {
  const b = it.bgRemove;
  return b ? [it.src, round3(it.in), round3(it.out), b.model, b.quality].join("|") : "";
}
export function bgPreviewKey(b: NonNullable<MontageClip["bgRemove"]>) {
  return [b.replace, b.color, b.image, b.soft].join("|");
}
/** Готовый вид с удалённым фоном для предпросмотра (или пусто). */
export function bgPreview(it: { src: string; in: number; out: number; bgRemove?: MontageClip["bgRemove"] }) {
  const b = it.bgRemove;
  return b && b.enabled && b.cache && b.cache.preview && b.cache.key === bgKey(it) ? b.cache.preview : "";
}
