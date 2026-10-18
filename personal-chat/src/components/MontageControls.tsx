import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { MontageAudio, MontageCaptions, MontageOptions, MontageProject, MontageTranscript, StoriesDesign } from "../lib/types";
import { clamp, round3 } from "../lib/montage";
import type { Selection } from "./MontageTimeline";

export type BinItem = { path: string; kind: string; duration: number };

/** Всё, что панелям и инспектору нужно от редактора, — одним объектом. */
export interface EditorCtx {
  project: MontageProject;
  options: MontageOptions;
  scheme: string;
  time: number;
  duration: number;
  selection: Selection;
  setSelection: (s: Selection) => void;
  commit: (next: MontageProject | ((p: MontageProject) => MontageProject)) => void;
  notify: (text: string) => void;
  fail: (e: unknown) => void;
  busy: string;
  setBusy: (s: string) => void;
  transcripts: Record<string, MontageTranscript>;
  sources: string[];
  transcribeSources: () => Promise<void>;
  bin: BinItem[];
  addToBin: (items: BinItem[]) => void;
  /** Положить медиа на дорожку: main — главная, layer — слой поверх, music/sfx/voice — звук. */
  place: (item: BinItem, where: "main" | "layer" | MontageAudio["kind"]) => void;
  cleanup: (onlySelected: boolean) => Promise<void>;
  design: StoriesDesign | null;
  applyDesign: (d: StoriesDesign) => void;
  setCaptions: (patch: Partial<MontageCaptions>) => void;
  /** Поставить бегунок. */
  seek: (t: number) => void;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="mt-field">
      <span>
        {label} <b>{fmt ? fmt(draft) : draft}</b>
      </span>
      {/* Значение уходит в историю правок по отпусканию: иначе каждый пиксель ползунка — отдельная отмена. */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onMouseUp={() => draft !== value && onChange(draft)}
        onKeyUp={() => draft !== value && onChange(draft)}
        onBlur={() => draft !== value && onChange(draft)}
      />
    </label>
  );
}

export function NumberField({ label, value, step = 0.1, min, max, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const done = () => {
    const v = Number(draft.replace(",", "."));
    if (!Number.isFinite(v)) return setDraft(String(value));
    const c = clamp(v, min ?? -Infinity, max ?? Infinity);
    if (c !== value) onChange(round3(c));
    else setDraft(String(value));
  };
  return (
    <label className="mt-field mt-num">
      <span>{label}</span>
      <input type="number" step={step} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === "Enter" && done()} />
    </label>
  );
}

export function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="mt-sec" open={open}>
      <summary>{title}</summary>
      <div className="mt-sec-body">{children}</div>
    </details>
  );
}
