import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MontageClip, MontageKeyframe, MontageProject } from "../lib/types";
import { captionLines, clamp, fileName, fmtTime, getDrag, itemLabel, layerDuration, layout, mediaUrl, round3, type DragPayload, type OutputWord } from "../lib/montage";
import { usePlayhead, type Playhead } from "../lib/playhead";

export type Selection = { kind: "clip" | "text" | "audio" | "layer"; id: string } | null;

/** Куда бросили: на кусок/слой или на дорожку в момент времени. */
export type DropTarget = { kind: "clip" | "layer"; id: string } | { lane: "main" | "layer" | "music" | "sfx"; time: number; track?: number };

interface Props {
  project: MontageProject;
  playhead: Playhead;
  scheme: string;
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
  /** Брошено из панели: эффект, фильтр, переход — на кусок; файл — на дорожку. */
  onDropItem: (data: DragPayload, at: DropTarget) => void;
}

const HEAD = 72;

type Drag =
  | { kind: "clip-in" | "clip-out"; id: string; x0: number; orig: MontageClip }
  | { kind: "move" | "start" | "end"; list: "texts" | "layers" | "audio"; id: string; x0: number; y0: number; start: number; end: number; inn: number; out: number; track?: number };

type Strip = { path: string; count: number; duration: number; height: number } | null;
type Wave = { path: string; duration: number; width: number } | null;

// Полоска кадров и волна — одна на исходник на всё время работы окна: сколько
// бы кусков ни было из одного файла и как ни менялся масштаб, ffmpeg
// запускается один раз (и то лишь при первом открытии — дальше с диска).
const strips = new Map<string, Promise<Strip>>();
const waves = new Map<string, Promise<Wave>>();
function useCached<T>(map: Map<string, Promise<T>>, src: string, load: (s: string) => Promise<T>, skip: boolean): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (skip || !src) return;
    let alive = true;
    if (!map.has(src)) map.set(src, load(src).catch(() => null as T));
    map.get(src)!.then((r) => alive && setV(r));
    return () => {
      alive = false;
    };
  }, [map, src, load, skip]);
  return v;
}

/**
 * Кадры куска из полоски исходника: ячейки по высоте дорожки, каждая берёт
 * ближайший кадр полоски. Без запросов к ffmpeg при прокрутке и зуме.
 */
function Filmstrip({ src, scheme, from, to, width, height, kind }: { src: string; scheme: string; from: number; to: number; width: number; height: number; kind: string }) {
  const strip = useCached(strips, src, window.api.montageFilmstrip, kind !== "video" && kind !== "image");
  const [aspect, setAspect] = useState(16 / 9);
  const url = strip ? mediaUrl(scheme, strip.path) : "";
  useEffect(() => {
    if (!url || !strip) return;
    const img = new Image();
    img.onload = () => setAspect(img.naturalWidth / strip.count / img.naturalHeight || 16 / 9);
    img.src = url;
  }, [url, strip]);
  if (!strip || !url) return null;
  const cellW = height * aspect;
  const cells = Math.max(1, Math.min(60, Math.ceil(width / cellW)));
  const out = [];
  for (let i = 0; i < cells; i++) {
    const t = from + ((i + 0.5) / cells) * (to - from);
    const idx = strip.count <= 1 ? 0 : clamp(Math.floor((t / Math.max(0.01, strip.duration)) * strip.count), 0, strip.count - 1);
    out.push(
      <i
        key={i}
        style={{ left: i * cellW, width: cellW, backgroundImage: `url("${url}")`, backgroundSize: `${strip.count * cellW}px ${height}px`, backgroundPosition: `${-idx * cellW}px 0` }}
      />
    );
  }
  return <div className="mt-tl-strip">{out}</div>;
}

/** Волна куска звука — вырезка из волны всего файла. */
function WaveSlice({ src, scheme, from, to, width, color }: { src: string; scheme: string; from: number; to: number; width: number; color: string }) {
  const wave = useCached(waves, src, window.api.montageWave, false);
  if (!wave || !wave.duration) return null;
  const full = (width / Math.max(0.05, to - from)) * wave.duration;
  return (
    <div
      className="mt-tl-wave"
      style={{
        WebkitMaskImage: `url("${mediaUrl(scheme, wave.path)}")`,
        WebkitMaskSize: `${full}px 100%`,
        WebkitMaskPosition: `${-(from / wave.duration) * full}px 0`,
        WebkitMaskRepeat: "no-repeat",
        background: color,
      }}
    />
  );
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

function useDropHighlight() {
  const [over, setOver] = useState(false);
  return {
    over,
    on: {
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
    },
    off: () => setOver(false),
  };
}

function ClipBlock({ clip, scheme, left, width, selected, pps, onDown, onSelect, onDropBefore, onDropFx }: {
  clip: MontageClip;
  scheme: string;
  onDropFx: (data: DragPayload) => void;
  left: number;
  width: number;
  selected: boolean;
  pps: number;
  onDown: (e: React.MouseEvent, edge: "in" | "out") => void;
  onSelect: () => void;
  onDropBefore: (draggedId: string) => void;
}) {
  const badges = [
    clip.speed !== 1 && `×${clip.speed}`,
    clip.reverse && "⟲",
    clip.effects.length > 0 && `✦${clip.effects.length}`,
    clip.adjust.filter !== "none" && "◐",
    clip.adjust.lut && "LUT",
    clip.audioEffect !== "none" && "♫",
  ].filter(Boolean);
  const hl = useDropHighlight();
  return (
    <div
      className={`mt-tl-clip ${selected ? "sel" : ""} ${clip.kind} ${hl.over ? "drop" : ""}`}
      style={{ left, width: Math.max(4, width) }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/montage-clip", clip.id)}
      onDragOver={(e) => e.preventDefault()}
      {...hl.on}
      onDrop={(e) => {
        hl.off();
        const id = e.dataTransfer.getData("text/montage-clip");
        if (id) {
          e.stopPropagation();
          if (id !== clip.id) onDropBefore(id);
          return;
        }
        const data = getDrag(e);
        // Эффект, фильтр, переход — на этот кусок; файл — дорожке (вставка в точку).
        if (data && data.type !== "media") {
          e.stopPropagation();
          onDropFx(data);
        }
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${itemLabel(clip)} · ${fmtTime(clip.in, true)}–${fmtTime(clip.out, true)}`}
    >
      {clip.kind === "motion" ? <div className="mt-tl-motion">✨</div> : <Filmstrip src={clip.src} scheme={scheme} from={clip.in} to={clip.out} width={width} height={44} kind={clip.kind} />}
      <span className="mt-tl-label">
        {clip.transition.kind !== "none" && <i className="mt-tl-tr">⧓</i>}
        {badges.join(" ")} {itemLabel(clip)}
      </span>
      <Diamonds keyframes={clip.keyframes} pps={pps} />
      <div className="mt-tl-edge l" onMouseDown={(e) => onDown(e, "in")} draggable={false} />
      <div className="mt-tl-edge r" onMouseDown={(e) => onDown(e, "out")} draggable={false} />
    </div>
  );
}

function AudioBlock({ a, scheme, pps, selected, onDown }: {
  a: MontageProject["audio"][number];
  scheme: string;
  pps: number;
  selected: boolean;
  onDown: (e: React.MouseEvent, part: "move" | "start" | "end") => void;
}) {
  const width = Math.max(6, (a.out - a.in) * pps);
  return (
    <div
      className={`mt-tl-audio k-${a.kind} ${selected ? "sel" : ""}`}
      style={{ left: a.start * pps, width }}
      onMouseDown={(e) => onDown(e, "move")}
      title={fileName(a.src)}
    >
      <WaveSlice src={a.src} scheme={scheme} from={a.in} to={a.out} width={width} color={a.kind === "sfx" ? "#ffd27a" : "#7debff"} />
      <span>{a.kind === "sfx" ? "✺" : a.kind === "voice" ? "🎙" : "♪"} {fileName(a.src)}{a.effect !== "none" ? ` · ${a.effect}` : ""}{a.duck ? " · приседает под голос" : ""}</span>
      <div className="mt-tl-edge l" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "start"); }} />
      <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "end"); }} />
    </div>
  );
}

function LayerBlock({ l, scheme, pps, selected, onDown, onDropFx }: {
  l: MontageProject["layers"][number];
  scheme: string;
  onDropFx: (data: DragPayload) => void;
  pps: number;
  selected: boolean;
  onDown: (e: React.MouseEvent, part: "move" | "start" | "end") => void;
}) {
  const width = Math.max(6, layerDuration(l) * pps);
  const hl = useDropHighlight();
  return (
    <div
      className={`mt-tl-layer ${selected ? "sel" : ""} ${l.kind === "motion" ? "motion" : ""} ${hl.over ? "drop" : ""}`}
      style={{ left: l.start * pps, width }}
      onMouseDown={(e) => onDown(e, "move")}
      title={itemLabel(l)}
      onDragOver={(e) => e.preventDefault()}
      {...hl.on}
      onDrop={(e) => {
        hl.off();
        const data = getDrag(e);
        if (data && data.type !== "media" && data.type !== "transition") {
          e.stopPropagation();
          onDropFx(data);
        }
      }}
    >
      {l.kind !== "motion" && <Filmstrip src={l.src} scheme={scheme} from={l.in} to={l.out} width={width} height={30} kind={l.kind} />}
      <span className="mt-tl-label">
        {l.kind === "motion" ? "✨ " : ""}
        {l.chroma.enabled ? "🟩 " : ""}
        {l.mask !== "none" ? "◯ " : ""}
        {itemLabel(l)}
      </span>
      <Diamonds keyframes={l.keyframes} pps={pps} />
      <div className="mt-tl-edge l" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "start"); }} />
      <div className="mt-tl-edge r" onMouseDown={(e) => { e.stopPropagation(); onDown(e, "end"); }} />
    </div>
  );
}

/** Линия бегунка — единственное на таймлайне, что движется каждый кадр. */
function PlayheadLine({ playhead, pps, scroller }: { playhead: Playhead; pps: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const time = usePlayhead(playhead);
  // Бегунок не уезжает за край, пока играет.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, pps, scroller]);
  return <div className="mt-tl-playhead" style={{ left: HEAD + time * pps }} />;
}

function MontageTimeline({ project, playhead, scheme, pps, selection, words, sourceDurations, onSeek, onSelect, onLive, onCommit, onDropItem }: Props) {
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
  // Дорожки видео над главной — всегда видны, плюс одна свободная сверху:
  // файл можно бросить на любую, и в кадре будет несколько видео сразу.
  const layerTracks = useMemo(() => {
    const max = Math.min(8, Math.max(2, ...project.layers.map((l) => l.track + 1)));
    return Array.from({ length: max }, (_, i) => max - i);
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
  const timeAt = (clientX: number) => {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, round3((clientX - rect.left + el.scrollLeft - HEAD) / pps));
  };
  const laneDrop = (lane: "main" | "layer" | "music" | "sfx", track?: number) => ({
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      const data = getDrag(e);
      if (!data) return;
      e.preventDefault();
      if (data.type === "media") {
        onDropItem(data, { lane, time: timeAt(e.clientX), track });
        return;
      }
      // Эффект брошен мимо куска — на тот, что под точкой (на главной дорожке).
      const t = timeAt(e.clientX);
      const hit = items.findIndex((it) => t >= it.start && t < it.end);
      if (hit >= 0) onDropItem(data, { kind: "clip", id: project.clips[hit].id });
    },
  });
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
          <div key={track} className="mt-tl-track layer" data-name={`Видео ${track + 1}`}>
            <div className="mt-tl-head" title="Дорожка видео поверх главной: картинка в картинке, коллаж, стикер, перебивка. Перетащите сюда файл из «Медиа».">🎞{track + 1}</div>
            <div className="mt-tl-lane" onMouseDown={laneDown} {...laneDrop("layer", track)}>
              {!project.layers.some((l) => l.track === track) && <span className="mt-tl-empty">перетащите сюда видео или фото — оно ляжет поверх</span>}
              {project.layers.filter((l) => l.track === track).map((l) => (
                <LayerBlock key={l.id} l={l} onDropFx={(d) => onDropItem(d, { kind: "layer", id: l.id })} scheme={scheme} pps={pps} selected={isSel("layer", l.id)} onDown={(e, part) => startDrag("layers", { ...l, end: l.start + layerDuration(l) }, part, e)} />
              ))}
            </div>
          </div>
        ))}

        <div className="mt-tl-track main" data-name="Видео">
          <div className="mt-tl-head" title="Главная дорожка (Видео 1)">🎬1</div>
          <div className="mt-tl-lane" onMouseDown={laneDown} {...laneDrop("main")}>
            {project.clips.map((c, i) => (
              <ClipBlock
                key={c.id}
                clip={c}
                scheme={scheme}
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
                onDropFx={(d) => onDropItem(d, { kind: "clip", id: c.id })}
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
          <div className="mt-tl-lane" onMouseDown={laneDown} {...laneDrop("music")}>
            {music.map((a) => (
              <AudioBlock key={a.id} a={a} scheme={scheme} pps={pps} selected={isSel("audio", a.id)} onDown={(e, part) => startDrag("audio", a, part, e)} />
            ))}
          </div>
        </div>

        <div className="mt-tl-track thin2" data-name="Звуки">
          <div className="mt-tl-head" title="Звуковые эффекты">✺</div>
          <div className="mt-tl-lane" onMouseDown={laneDown} {...laneDrop("sfx")}>
            {sfx.map((a) => (
              <AudioBlock key={a.id} a={a} scheme={scheme} pps={pps} selected={isSel("audio", a.id)} onDown={(e, part) => startDrag("audio", a, part, e)} />
            ))}
          </div>
        </div>

        <PlayheadLine playhead={playhead} pps={pps} scroller={ref} />
      </div>
    </div>
  );
}

export default memo(MontageTimeline);
