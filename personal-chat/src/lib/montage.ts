// Таймлайн «Монтажа» на стороне окна: раскладка кусков по времени, перевод
// времени ролика во время исходника и обратно. Тот же расчёт, что в
// electron/montage.cjs: предпросмотр обязан показывать ровно то, что соберётся,
// иначе человек будет править одно, а получать другое.

import type { MontageClip, MontageProject, MontageText, MontageWord } from "./types";

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

/** CSS-фильтр для предпросмотра цветокоррекции. Сборка делает то же через eq. */
export function cssFilter(c: MontageClip) {
  const a = c.adjust || { brightness: 0, contrast: 1, saturation: 1, filter: "none" };
  const parts = [`brightness(${1 + a.brightness})`, `contrast(${a.contrast})`, `saturate(${a.saturation})`];
  const preset: Record<string, string> = {
    vivid: "saturate(1.3) contrast(1.06)",
    warm: "sepia(0.18) saturate(1.1)",
    cold: "hue-rotate(-12deg) saturate(0.95)",
    film: "sepia(0.25) contrast(0.95)",
    contrast: "contrast(1.18)",
    soft: "brightness(1.06) saturate(0.9) contrast(0.92)",
    bw: "grayscale(1) contrast(1.1)",
    cinema: "contrast(1.05) saturate(1.1) hue-rotate(-6deg)",
  };
  if (preset[a.filter]) parts.push(preset[a.filter]);
  return parts.join(" ");
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
    adjust: { brightness: 0, contrast: 1, saturation: 1, filter: "none" },
    label: "",
  };
}

export function newText(start: number, text = "Текст", style = "title"): MontageText {
  return { id: uid("text"), text, start: round3(start), end: round3(start + 2.5), style, animation: "pop", position: "", size: 0, color: "", bg: "", upper: true };
}
