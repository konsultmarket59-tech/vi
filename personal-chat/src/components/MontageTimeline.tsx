import { useEffect, useMemo, useRef, useState } from "react";
import type { MontageClip, MontageKeyframe, MontageProject } from "../lib/types";
import { captionLines, clamp, fileName, fmtTime, layerDuration, layout, round3, type OutputWord } from "../lib/montage";

export type Selection = { kind: "clip" | "text" | "audio" | "layer"; id: string } | null;

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

const HEAD = 72;

type Drag =
  | { kind: "clip-in" | "clip-out"; id: string; x0: number; orig: MontageClip }
  | { kind: "move" | "start" | "end"; list: "texts" | "layers" | "audio"; id: string; x0: number; y0: number; start: number; end: number; inn: number; out: number; track?: number };

/** Полоска кадров для куска — грузится лениво и кешируется в окне. */
function useThumbs(src: string, from: number, to: number, kind: string, height: number) {
  const [uri, setUri] = useState("");
  const count = clamp(Math.round((to - from) / 2), 2, 12);
  useEffect(() => {
    if (kind === "audio") return;
    let alive = true;
    window.api
      .montageThumbs(src, { count, height, from, to })
      .then((u) => alive && setUri(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, from, to, count, height, kind]);
  return uri;
}

function useWave(src: string, from: number, to: number, width: number, color: string) {
  const [uri, setUri] = useState("");
  const w = Math.round(clamp(width, 40, 2400) / 40) * 40;
  useEffect(() => {
    let alive = true;
    window.api
      .montageWaveform(src, { width: w, height: 30, from, to, color })
      .then((u) => alive && setUri(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [src, from, to, w, color]);
  return uri;
}

function Diamonds({ keyframes, pps }: { keyframes: MontageKeyframe[]; pps: number }) {
  return (
    <>
      {keyframes.map((k, i) => (
        <i key={i} className="mt-tl-kf" style={{ left: k.t * pps }} title={`Ключевая точка ${fmtTime(k.t, true)}`} />
      ))}
    </>
  );
}

function ClipBlock({ clip, left, width, selected, pps, onDown, onSelect, onDropBefore }: {
  clip: MontageClip;
  left: number;
  width: number;
  selected: boolean;
  pps: number;
  onDown: (e: React.MouseEvent, edge: "in" | "out") => void;
  onSelect: () => void;
  onDropBefore: (draggedId: string) => void;
}) {
  const thumbs = useThumbs(clip.src, clip.in, clip.out, clip.kind, 44);
  const badges = [
    clip.speed !== 1 && `×${clip.speed}`,
    clip.reverse && "⟲",
    clip.effects.length > 0 && `✦${clip.effects.length}`,
    clip.adjust.filter !== "none" && "◐",
    clip.adjust.lut && "LUT",
    clip.audioEffect !== "none" && "♫",
  ].filter(Boolean);
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
      title={`${fileName(clip.src)} · ${fmtTime(clip.in, true)}–${fmtTime(clip.out, true)}`}
    >
      {thumbs && <div className="mt-tl-thumbs" style={{ backgroundImage: `url(${thumbs})` }} />}
      <span className="mt-tl-label">
        {clip.transition.kind !== "none" && <i className="mt-tl-tr">⧓</i>}
        {badges.join(" ")} {clip.label || fileName(clip.src)}
      </span>
      <Diamonds keyframes={clip.keyframes} pps={pps} />
      <div className="mt-tl-edge l" onMouseDown={(e) => onDown(e, "in")} draggable={false} />
      <div className="mt-tl-edge r" onMouseDown={(e) => onDown(e, "out")} draggable={false} />
    </div>
  );
}

function AudioBlock({ a, pps, selected, onDown }: {
  a: MontageProject["audio"][number];
  pps: number;
  selected: boolean;
  onDown: (e: React.MouseEvent, part: "move" | "start" | "end") => void;
}) {
  const width = Math.max(6, (a.out - a.in) * pps);
  const wave = useWave(a.src, a.in, a.out, width, a.kind === "sfx" ? "#ffd27a" : "#7debff");
  return (
    <div
      className={`mt-tl-audio k-${a.kind} ${selected ? "sel" : ""}`}
      style={{ left: a.start * pps, width }}
      onMouseDown={(e) => onDown(e, "move")}
      title={fileName(a.src)}
    >
      {wave && <div className="mt-tl-wave" style={{ backgroundImage: `url(${wave})` }} />}
      <span>{a.kind === "sfx" ? "✺" : a.kind === "voice" ? "🎙" : "♪"} {fileName(a.src)}{a.effect !== "none" ? ` · ${a.effect}` : ""}{a.duck ? " · приседает под голос" : ""}</span>
      <div className="mt-tl-edge l" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "start"); }} />
      <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "end"); }} />
    </div>
  );
}

function LayerBlock({ l, pps, selected, onDown }: {
  l: MontageProject["layers"][number];
  pps: number;
  selected: boolean;
  onDown: (e: React.MouseEvent, part: "move" | "start" | "end") => void;
}) {
  const thumbs = useThumbs(l.src, l.in, l.out, l.kind, 30);
  return (
    <div className={`mt-tl-layer ${selected ? "sel" : ""}`} style={{ left: l.start * pps, width: Math.max(6, layerDuration(l) * pps) }} onMouseDown={(e) => onDown(e, "move")} title={fileName(l.src)}>
      {thumbs && <div className="mt-tl-thumbs" style={{ backgroundImage: `url(${thumbs})` }} />}
      <span className="mt-tl-label">
        {l.chroma.enabled ? "🟩 " : ""}
        {l.mask !== "none" ? "◯ " : ""}
        {l.label || fileName(l.src)}
      </span>
      <Diamonds keyframes={l.keyframes} pps={pps} />
      <div className="mt-tl-edge l" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "start"); }} />
      <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "end"); }} />
    </div>
  );
}

export default function MontageTimeline({ project, time, pps, selection, words, sourceDurations, onSeek, onSelect, onLive, onCommit }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const live = useRef<MontageProject>(project);
  useEffect(() => {
    live.current = project;
  }, [project]);
  const { items, duration } = useMemo(() => layout(project.clips), [project.clips]);
  const total =
    Math.max(
      duration,
      project.texts.reduce((a, t) => Math.max(a, t.end), 0),
      project.layers.reduce((a, l) => Math.max(a, l.start + layerDuration(l)), 0),
      5
    ) + 4;
  const width = total * pps;
  const layerTracks = useMemo(() => {
    const used = [...new Set(project.layers.map((l) => l.track))].sort((a, b) => b - a);
    return used;
  }, [project.layers]);

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
        return;
      }
      const d = drag as Extract<Drag, { list: string }>;
      if (d.list === "texts") {
        const texts = p.texts.map((t) => {
          if (t.id !== d.id) return t;
          if (d.kind === "move") {
            const s = Math.max(0, d.start + dt);
            return { ...t, start: round3(s), end: round3(s + (d.end - d.start)) };
          }
          if (d.kind === "start") return { ...t, start: round3(clamp(d.start + dt, 0, d.end - 0.2)) };
          return { ...t, end: round3(Math.max(d.start + 0.2, d.end + dt)) };
        });
        onLive({ ...p, texts });
      } else if (d.list === "layers") {
        // Вертикальное движение — на другую дорожку слоёв.
        const dTrack = -Math.round((e.clientY - d.y0) / 34);
        const layers = p.layers.map((l) => {
          if (l.id !== d.id) return l;
          const srcDur = sourceDurations[l.src] || (l.kind === "image" ? 3600 : d.out + 3600);
          if (d.kind === "move") return { ...l, start: round3(Math.max(0, d.start + dt)), track: clamp((d.track || 1) + dTrack, 1, 8) };
          if (d.kind === "start") {
            const shift = clamp(dt, -d.start, d.out - d.inn - 0.2);
            return { ...l, start: round3(d.start + shift), in: round3(clamp(d.inn + shift * l.speed, 0, d.out - 0.1)) };
          }
          return { ...l, out: round3(clamp(d.out + dt * l.speed, d.inn + 0.1, srcDur)) };
        });
        onLive({ ...p, layers });
      } else {
        const audio = p.audio.map((a) => {
          if (a.id !== d.id) return a;
          if (d.kind === "move") return { ...a, start: round3(Math.max(0, d.start + dt)) };
          const srcDur = sourceDurations[a.src] || d.out + 3600;
          if (d.kind === "start") {
            const shift = clamp(dt, -d.start, d.out - d.inn - 0.2);
            return { ...a, start: round3(d.start + shift), in: round3(Math.max(0, d.inn + shift)) };
          }
          return { ...a, out: round3(clamp(d.out + dt, a.in + 0.1, a.loop ? 36000 : srcDur)) };
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
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, pps]);

  const seekFromEvent = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onSeek(clamp((e.clientX - rect.left + el.scrollLeft - HEAD) / pps, 0, duration || total));
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

  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  const startDrag = (list: "texts" | "layers" | "audio", item: { id: string; start: number; end?: number; in?: number; out?: number; track?: number }, kind: "move" | "start" | "end", e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect({ kind: list === "texts" ? "text" : list === "layers" ? "layer" : "audio", id: item.id });
    setDrag({ kind, list, id: item.id, x0: e.clientX, y0: e.clientY, start: item.start, end: item.end ?? 0, inn: item.in ?? 0, out: item.out ?? 0, track: item.track });
  };
  const laneDown = (e: React.MouseEvent) => {
    seekFromEvent(e);
    onSelect(null);
  };

  const music = project.audio.filter((a) => a.kind !== "sfx");
  const sfx = project.audio.filter((a) => a.kind === "sfx");

  return (
    <div className="mt-tl" ref={ref}>
      <div className="mt-tl-inner" style={{ width: width + HEAD }}>
        <div className="mt-tl-ruler" onMouseDown={seekFromEvent}>
          {ticks.map((t) => (
            <span key={t} style={{ left: HEAD + t * pps }}>{fmtTime(t)}</span>
          ))}
        </div>

        <div className="mt-tl-track" data-name="Текст">
          <div className="mt-tl-head" title="Надписи">T</div>
          <div className="mt-tl-lane" onMouseDown={laneDown}>
            {project.texts.map((t) => (
              <div
                key={t.id}
                className={`mt-tl-text ${isSel("text", t.id) ? "sel" : ""}`}
                style={{ left: t.start * pps, width: Math.max(6, (t.end - t.start) * pps) }}
                onMouseDown={(e) => startDrag("texts", t, "move", e)}
                title={t.text}
              >
                <span>{t.text}</span>
                <div className="mt-tl-edge l" onMouseDown={(e) => startDrag("texts", t, "start", e)} />
                <div className="mt-tl-edge r" onMouseDown={(e) => startDrag("texts", t, "end", e)} />
              </div>
            ))}
          </div>
        </div>

        {layerTracks.map((track) => (
          <div key={track} className="mt-tl-track layer" data-name={`Слой ${track}`}>
            <div className="mt-tl-head" title="Слой поверх видео: картинка в картинке, стикер, перебивка">▣{track}</div>
            <div className="mt-tl-lane" onMouseDown={laneDown}>
              {project.layers.filter((l) => l.track === track).map((l) => (
                <LayerBlock key={l.id} l={l} pps={pps} selected={isSel("layer", l.id)} onDown={(e, part) => startDrag("layers", { ...l, end: l.start + layerDuration(l) }, part, e)} />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-tl-track main" data-name="Видео">
          <div className="mt-tl-head" title="Главная дорожка">🎬</div>
          <div className="mt-tl-lane" onMouseDown={laneDown}>
            {project.clips.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                pps={pps}
                left={items[i].start * pps}
                width={items[i].duration * pps}
                selected={isSel("clip", c.id)}
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

        <div className="mt-tl-track" data-name="Музыка">
          <div className="mt-tl-head" title="Музыка и голос">♪</div>
          <div className="mt-tl-lane" onMouseDown={laneDown}>
            {music.map((a) => (
              <AudioBlock key={a.id} a={a} pps={pps} selected={isSel("audio", a.id)} onDown={(e, part) => startDrag("audio", a, part, e)} />
            ))}
          </div>
        </div>

        <div className="mt-tl-track thin2" data-name="Звуки">
          <div className="mt-tl-head" title="Звуковые эффекты">✺</div>
          <div className="mt-tl-lane" onMouseDown={laneDown}>
            {sfx.map((a) => (
              <AudioBlock key={a.id} a={a} pps={pps} selected={isSel("audio", a.id)} onDown={(e, part) => startDrag("audio", a, part, e)} />
            ))}
          </div>
        </div>

        <div className="mt-tl-playhead" style={{ left: HEAD + time * pps }} />
      </div>
    </div>
  );
}
