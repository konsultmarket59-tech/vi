import { useEffect, useMemo, useRef, useState } from "react";
import type { MontageClip, MontageProject } from "../lib/types";
import { captionLines, clamp, fileName, fmtTime, layout, round3, type OutputWord } from "../lib/montage";

export type Selection = { kind: "clip" | "text" | "audio"; id: string } | null;

interface Props {
  project: MontageProject;
  time: number;
  pps: number;
  selection: Selection;
  words: OutputWord[];
  sourceDurations: Record<string, number>;
  onSeek: (t: number) => void;
  onSelect: (s: Selection) => void;
  /** Правка во время перетаскивания: без записи в историю правок. */
  onLive: (p: MontageProject) => void;
  /** Конец перетаскивания: одна запись в историю на всё движение. */
  onCommit: (p: MontageProject) => void;
}

type Drag =
  | { kind: "clip-in" | "clip-out"; id: string; x0: number; orig: MontageClip }
  | { kind: "text-move" | "text-start" | "text-end"; id: string; x0: number; start: number; end: number }
  | { kind: "audio-move" | "audio-out"; id: string; x0: number; start: number; out: number };

/** Полоска кадров для куска — грузится лениво и кешируется в окне. */
function useThumbs(clip: MontageClip, height: number) {
  const [uri, setUri] = useState("");
  const count = clamp(Math.round((clip.out - clip.in) / 2), 2, 12);
  useEffect(() => {
    let alive = true;
    window.api
      .montageThumbs(clip.src, { count, height, from: clip.in, to: clip.out })
      .then((u) => alive && setUri(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clip.src, clip.in, clip.out, count, height]);
  return uri;
}

function ClipBlock({ clip, left, width, selected, onDown, onSelect, onDropBefore }: {
  clip: MontageClip;
  left: number;
  width: number;
  selected: boolean;
  onDown: (e: React.MouseEvent, edge: "in" | "out") => void;
  onSelect: () => void;
  onDropBefore: (draggedId: string) => void;
}) {
  const thumbs = useThumbs(clip, 44);
  return (
    <div
      className={`mt-tl-clip ${selected ? "sel" : ""} ${clip.kind}`}
      style={{ left, width: Math.max(4, width) }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/montage-clip", clip.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/montage-clip");
        if (id && id !== clip.id) onDropBefore(id);
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${fileName(clip.src)} · ${fmtTime(clip.in, true)}–${fmtTime(clip.out, true)}${clip.speed !== 1 ? ` · ×${clip.speed}` : ""}`}
    >
      {thumbs && <div className="mt-tl-thumbs" style={{ backgroundImage: `url(${thumbs})` }} />}
      <span className="mt-tl-label">
        {clip.transition.kind !== "none" && <i className="mt-tl-tr">⧓</i>}
        {clip.speed !== 1 && `×${clip.speed} `}
        {clip.zoom > 1 && "🔍 "}
        {clip.label || fileName(clip.src)}
      </span>
      <div className="mt-tl-edge l" onMouseDown={(e) => onDown(e, "in")} draggable={false} />
      <div className="mt-tl-edge r" onMouseDown={(e) => onDown(e, "out")} draggable={false} />
    </div>
  );
}

export default function MontageTimeline({ project, time, pps, selection, words, sourceDurations, onSeek, onSelect, onLive, onCommit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<MontageProject>(project);
  live.current = project;
  const { items, duration } = useMemo(() => layout(project.clips), [project.clips]);
  const total = Math.max(duration, project.texts.reduce((a, t) => Math.max(a, t.end), 0), 5) + 4;
  const width = total * pps;

  const lines = useMemo(
    () => (project.captions.enabled ? captionLines(words, project.captions.wordsPerLine || 4) : []),
    [project.captions.enabled, project.captions.wordsPerLine, words]
  );

  // Перетаскивание: мышь отпущена где угодно — движение заканчивается.
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const dt = (e.clientX - drag.x0) / pps;
      const p = live.current;
      if (drag.kind === "clip-in" || drag.kind === "clip-out") {
        const o = drag.orig;
        const srcDur = sourceDurations[o.src] || (o.kind === "image" ? 3600 : o.out + 3600);
        const clips = p.clips.map((c) => {
          if (c.id !== drag.id) return c;
          // Сдвиг по таймлайну — в секунды исходника, с учётом скорости.
          if (drag.kind === "clip-in") return { ...c, in: round3(clamp(o.in + dt * o.speed, 0, o.out - 0.1)) };
          return { ...c, out: round3(clamp(o.out + dt * o.speed, o.in + 0.1, srcDur)) };
        });
        onLive({ ...p, clips });
      } else if (drag.kind.startsWith("text")) {
        const d = drag as Extract<Drag, { kind: "text-move" | "text-start" | "text-end" }>;
        const texts = p.texts.map((t) => {
          if (t.id !== d.id) return t;
          if (d.kind === "text-move") {
            const s = Math.max(0, d.start + dt);
            return { ...t, start: round3(s), end: round3(s + (d.end - d.start)) };
          }
          if (d.kind === "text-start") return { ...t, start: round3(clamp(d.start + dt, 0, d.end - 0.2)) };
          return { ...t, end: round3(Math.max(d.start + 0.2, d.end + dt)) };
        });
        onLive({ ...p, texts });
      } else {
        const d = drag as Extract<Drag, { kind: "audio-move" | "audio-out" }>;
        const audio = p.audio.map((a) => {
          if (a.id !== d.id) return a;
          if (d.kind === "audio-move") return { ...a, start: round3(Math.max(0, d.start + dt)) };
          const srcDur = sourceDurations[a.src] || d.out + 3600;
          return { ...a, out: round3(clamp(d.out + dt, a.in + 0.2, a.loop ? 36000 : srcDur)) };
        });
        onLive({ ...p, audio });
      }
    };
    const up = () => {
      setDrag(null);
      onCommit(live.current);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up, { once: true });
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, pps, sourceDurations, onLive, onCommit]);

  // Бегунок не уезжает за край, пока играет.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, pps]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onSeek(clamp((e.clientX - rect.left + el.scrollLeft - 72) / pps, 0, duration || total));
  };

  const step = pps >= 80 ? 1 : pps >= 30 ? 2 : pps >= 12 ? 5 : pps >= 5 ? 10 : 30;
  const ticks = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  const moveClipBefore = (draggedId: string, targetId: string) => {
    const clips = [...project.clips];
    const from = clips.findIndex((c) => c.id === draggedId);
    const moved = clips.splice(from, 1)[0];
    const to = clips.findIndex((c) => c.id === targetId);
    clips.splice(to, 0, moved);
    onCommit({ ...project, clips });
  };

  return (
    <div className="mt-tl" ref={ref}>
      <div className="mt-tl-inner" style={{ width: width + 72 }}>
        <div className="mt-tl-ruler" onMouseDown={seekFromEvent}>
          {ticks.map((t) => (
            <span key={t} style={{ left: 72 + t * pps }}>{fmtTime(t)}</span>
          ))}
        </div>

        <div className="mt-tl-track" data-name="Текст">
          <div className="mt-tl-head">T</div>
          <div className="mt-tl-lane" onMouseDown={(e) => { seekFromEvent(e); onSelect(null); }}>
            {project.texts.map((t) => (
              <div
                key={t.id}
                className={`mt-tl-text ${selection?.kind === "text" && selection.id === t.id ? "sel" : ""}`}
                style={{ left: t.start * pps, width: Math.max(6, (t.end - t.start) * pps) }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "text", id: t.id });
                  setDrag({ kind: "text-move", id: t.id, x0: e.clientX, start: t.start, end: t.end });
                }}
                title={t.text}
              >
                <span>{t.text}</span>
                <div className="mt-tl-edge l" onMouseDown={(e) => { e.stopPropagation(); onSelect({ kind: "text", id: t.id }); setDrag({ kind: "text-start", id: t.id, x0: e.clientX, start: t.start, end: t.end }); }} />
                <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); onSelect({ kind: "text", id: t.id }); setDrag({ kind: "text-end", id: t.id, x0: e.clientX, start: t.start, end: t.end }); }} />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-tl-track main" data-name="Видео">
          <div className="mt-tl-head">🎬</div>
          <div className="mt-tl-lane" onMouseDown={(e) => { seekFromEvent(e); onSelect(null); }}>
            {project.clips.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                left={items[i].start * pps}
                width={items[i].duration * pps}
                selected={selection?.kind === "clip" && selection.id === c.id}
                onSelect={() => onSelect({ kind: "clip", id: c.id })}
                onDown={(e, edge) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onSelect({ kind: "clip", id: c.id });
                  setDrag({ kind: edge === "in" ? "clip-in" : "clip-out", id: c.id, x0: e.clientX, orig: c });
                }}
                onDropBefore={(id) => moveClipBefore(id, c.id)}
              />
            ))}
          </div>
        </div>

        {project.captions.enabled && (
          <div className="mt-tl-track thin" data-name="Субтитры">
            <div className="mt-tl-head">CC</div>
            <div className="mt-tl-lane">
              {lines.map((l, i) => (
                <div key={i} className="mt-tl-cap" style={{ left: l.start * pps, width: Math.max(2, (l.end - l.start) * pps) }} title={l.words.map((w) => w.w).join(" ")}>
                  {l.words.map((w) => w.w).join(" ")}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-tl-track" data-name="Звук">
          <div className="mt-tl-head">♪</div>
          <div className="mt-tl-lane" onMouseDown={(e) => { seekFromEvent(e); onSelect(null); }}>
            {project.audio.map((a) => (
              <div
                key={a.id}
                className={`mt-tl-audio ${selection?.kind === "audio" && selection.id === a.id ? "sel" : ""}`}
                style={{ left: a.start * pps, width: Math.max(6, (a.out - a.in) * pps) }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "audio", id: a.id });
                  setDrag({ kind: "audio-move", id: a.id, x0: e.clientX, start: a.start, out: a.out });
                }}
                title={fileName(a.src)}
              >
                <span>♪ {fileName(a.src)}{a.duck ? " · приглушается под голос" : ""}</span>
                <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); setDrag({ kind: "audio-out", id: a.id, x0: e.clientX, start: a.start, out: a.out }); }} />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-tl-playhead" style={{ left: 72 + time * pps }} />
      </div>
    </div>
  );
}
