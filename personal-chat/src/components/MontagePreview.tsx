import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MontageClip, MontageLayer, MontageMotion, MontageOptions, MontageProject, MontageTransform } from "../lib/types";
import { usePlayhead, type Playhead } from "../lib/playhead";
import { cssFamily, FontFaces } from "./MontageFonts";
import {
  activeTexts,
  captionCss,
  captionLines,
  layerDuration,
  gradeOverlays,
  layout,
  lookCss,
  mediaUrl,
  motionCss,
  sampleTransform,
  type OutputWord,
} from "../lib/montage";
import type { Selection } from "./MontageTimeline";

interface Props {
  project: MontageProject;
  scheme: string;
  options: MontageOptions;
  playhead: Playhead;
  /** Лёгкие копии для показа: исходник → файл 540p. */
  proxies: Record<string, string>;
  playing: boolean;
  words: OutputWord[];
  selection: Selection;
  /** Время для остального редактора — пока играет, не чаще четырёх раз в секунду. */
  onTime: (t: number) => void;
  onEnded: () => void;
  onSelect: (s: Selection) => void;
  /** Перетаскивание слоя в кадре: commit — отпустили мышь, пора в историю правок. */
  onLayerTransform: (id: string, patch: Partial<MontageTransform>, commit: boolean) => void;
  onTextMove: (id: string, x: number, y: number, commit: boolean) => void;
}

/** Как переход выглядит в предпросмотре: стиль уходящего и приходящего куска. */
function transitionStyles(kind: string, p: number): { out: CSSProperties; in: CSSProperties; flash?: string; flashOpacity?: number } {
  switch (kind) {
    case "fade":
      return { out: {}, in: { opacity: p } };
    case "black":
      return { out: { opacity: Math.max(0, 1 - p * 2) }, in: { opacity: Math.max(0, p * 2 - 1) }, flash: "#000", flashOpacity: 0 };
    case "white":
      return { out: { opacity: p < 0.5 ? 1 : 0 }, in: { opacity: p >= 0.5 ? 1 : 0 }, flash: "#fff", flashOpacity: 1 - Math.abs(p * 2 - 1) };
    case "slide-left":
      return { out: { transform: `translateX(${-p * 100}%)` }, in: { transform: `translateX(${(1 - p) * 100}%)` } };
    case "slide-right":
      return { out: { transform: `translateX(${p * 100}%)` }, in: { transform: `translateX(${-(1 - p) * 100}%)` } };
    case "slide-up":
      return { out: { transform: `translateY(${-p * 100}%)` }, in: { transform: `translateY(${(1 - p) * 100}%)` } };
    case "slide-down":
      return { out: { transform: `translateY(${p * 100}%)` }, in: { transform: `translateY(${-(1 - p) * 100}%)` } };
    case "zoom":
      return { out: { transform: `scale(${1 + p})`, opacity: 1 - p }, in: { opacity: p } };
    case "circle":
      return { out: {}, in: { clipPath: `circle(${p * 75}% at 50% 50%)` } };
    case "radial":
      return { out: {}, in: { clipPath: `polygon(50% 50%, 50% -50%, ${50 + 150 * Math.sin(p * Math.PI * 2)}% ${50 - 150 * Math.cos(p * Math.PI * 2)}%, ${p > 0.5 ? "-50% 150%, -50% -50%," : ""} 50% 50%)` } };
    case "wipe-left":
      return { out: {}, in: { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` } };
    case "wipe-right":
      return { out: {}, in: { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } };
    case "wipe-up":
      return { out: {}, in: { clipPath: `inset(${(1 - p) * 100}% 0 0 0)` } };
    case "blur":
      return { out: { filter: `blur(${p * 3}cqmin)`, opacity: 1 - p }, in: { filter: `blur(${(1 - p) * 3}cqmin)`, opacity: p } };
    default:
      return { out: {}, in: {} };
  }
}

function transformCss(t: MontageTransform): CSSProperties {
  return {
    transform: `translate(${(t.x - 0.5) * 100}%, ${(t.y - 0.5) * 100}%) rotate(${t.rotation}deg) scale(${t.scale})`,
    opacity: t.opacity,
  };
}

function FxOverlays({ list }: { list: string[] }) {
  return (
    <>
      {[...new Set(list)].map((o) => (
        <div key={o} className={`mt-fx-${o}`} />
      ))}
    </>
  );
}


/**
 * Моушн в кадре — тот же код, что уйдёт в рендер, в рамке. Рамка рисует
 * композицию в полном размере кадра и уменьшается под окно; время ей
 * передаётся сообщением — шкала GSAP перематывается на нужный момент.
 */
export const MotionFrame = memo(function MotionFrame({ motion, width, height, local }: { motion: MontageMotion; width: number; height: number; local: number }) {
  const [doc, setDoc] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    let alive = true;
    window.api
      .montageMotionDoc(motion, { width, height })
      .then((r) => alive && setDoc(r.doc))
      .catch(() => alive && setDoc(""));
    return () => {
      alive = false;
    };
  }, [motion, width, height]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setK(el.clientWidth / width));
    ro.observe(el);
    setK(el.clientWidth / width);
    return () => ro.disconnect();
  }, [width]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ seek: local }, "*");
  }, [local, doc]);
  return (
    <div ref={box} className="mt-motion-box" style={{ aspectRatio: `${width} / ${height}` }}>
      {doc && (
        <iframe
          ref={frame}
          className="mt-motion-frame"
          srcDoc={doc}
          sandbox="allow-scripts"
          style={{ width, height, transform: `scale(${k})` }}
          onLoad={() => frame.current?.contentWindow?.postMessage({ seek: local }, "*")}
          title="моушн"
        />
      )}
    </div>
  );
});

/**
 * Где в кадре водяные знаки куска: в окне они размыты (подсказка, что знак
 * учтён), а в сборке — заменены фоном. Положение считается по геометрии
 * видео на экране: заполнение или вписывание, центр и приближение.
 */
function EraseMarks({ clip, fit }: { clip: MontageClip; fit: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const media = box?.parentElement?.querySelector(".mt-stage-media") as HTMLVideoElement | HTMLImageElement | null;
    if (!box || !media) return;
    const calc = () => {
      const vw = (media as HTMLVideoElement).videoWidth || (media as HTMLImageElement).naturalWidth;
      const vh = (media as HTMLVideoElement).videoHeight || (media as HTMLImageElement).naturalHeight;
      const cw = box.clientWidth;
      const ch = box.clientHeight;
      if (!vw || !vh || !cw || !ch) return;
      const k = fit === "crop" ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
      const w = vw * k;
      const h = vh * k;
      setGeo({ x: (cw - w) * clip.focusX, y: (ch - h) * clip.focusY, w, h });
    };
    calc();
    media.addEventListener("loadedmetadata", calc);
    media.addEventListener("load", calc);
    const ro = new ResizeObserver(calc);
    ro.observe(box);
    return () => {
      media.removeEventListener("loadedmetadata", calc);
      media.removeEventListener("load", calc);
      ro.disconnect();
    };
  }, [clip.focusX, clip.focusY, fit, clip.src]);
  return (
    <div ref={ref} className="mt-erase-marks" style={{ transform: clip.zoom > 1 ? `scale(${clip.zoom})` : undefined, transformOrigin: `${clip.focusX * 100}% ${clip.focusY * 100}%` }}>
      {geo &&
        (clip.erase || []).map((r, i) => (
          <i key={i} title="Водяной знак: в собранном ролике заменится фоном" style={{ left: geo.x + r.x * geo.w, top: geo.y + r.y * geo.h, width: r.w * geo.w, height: r.h * geo.h }} />
        ))}
    </div>
  );
}

/**
 * Предпросмотр без сборки.
 *
 * Время ведут часы окна, а каждое видео и звук подтягиваются к ним: так на
 * экране одновременно живут и два куска во время перехода, и слои поверх
 * кадра, и музыка. Видео, отставшее больше чем на четверть секунды,
 * перематывается, — иначе губы и субтитры расходятся.
 *
 * Цвет, фильтры, эффекты и движение — css; это приближение того, что сделает
 * ffmpeg. Шум, глитч, линза и хромакей точно видны только в собранном ролике.
 */
export default function MontagePreview({ project, scheme, options, playhead, proxies, playing, words, selection, onTime, onEnded, onSelect, onLayerTransform, onTextMove }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const media = useRef<Map<string, HTMLMediaElement>>(new Map());
  const time = usePlayhead(playhead);
  const { items, duration } = useMemo(() => layout(project.clips), [project.clips]);
  const videoUrl = (src: string) => mediaUrl(scheme, proxies[src] || src);
  const { width: W, height: H } = project.canvas;

  // ---------- что видно в момент time ----------

  const visibleMain: { clip: MontageClip; index: number; local: number; start: number }[] = [];
  let preloadMain: MontageClip | null = null;
  items.forEach((it, i) => {
    if (time >= it.start - 1e-6 && time < it.end) visibleMain.push({ clip: project.clips[i], index: i, local: time - it.start, start: it.start });
    else if (!preloadMain && it.start > time && it.start - time < 1.5) preloadMain = project.clips[i];
  });
  // Последний кадр ролика показываем, а не чёрный экран.
  if (!visibleMain.length && project.clips.length && time >= duration - 1e-6) {
    const i = project.clips.length - 1;
    visibleMain.push({ clip: project.clips[i], index: i, local: items[i].duration, start: items[i].start });
  }
  const layers = [...project.layers].sort((a, b) => a.track - b.track);
  const visibleLayers = layers.filter((l) => time >= l.start && time < l.start + layerDuration(l));
  const preloadLayers = layers.filter((l) => l.start > time && l.start - time < 1.5);

  // ---------- часы ----------

  // Часы идут за видео: пока главный кусок играет, время берётся из него, а
  // не из часов окна. Тогда видео не приходится перематывать вдогонку (каждая
  // перемотка — подвисание), а пока оно подгружается — время ждёт его.
  const visRef = useRef(visibleMain);
  useLayoutEffect(() => {
    visRef.current = visibleMain;
  });
  useEffect(() => {
    if (!playing) return;
    let t = playhead.get() >= duration - 0.05 ? 0 : playhead.get();
    playhead.set(t);
    let last = performance.now();
    let reported = last;
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let next = t + dt;
      const master = visRef.current.find((v) => v.clip.kind === "video" && !v.clip.reverse);
      const el = master && media.current.get(`c:${master.clip.id}`);
      if (master && el && !el.paused && !el.seeking) {
        if (el.readyState < 3) next = t;
        else {
          const mt = master.start + (el.currentTime - master.clip.in) / master.clip.speed;
          if (Math.abs(mt - next) < 0.3) next = Math.max(t, mt);
        }
      }
      t = next;
      if (t >= duration) {
        playhead.set(duration);
        onTime(duration);
        onEnded();
        return;
      }
      playhead.set(t);
      if (now - reported > 250) {
        reported = now;
        onTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      onTime(playhead.get());
    };
    // Часы перезапускаются только по «играть/стоп» и смене длины ролика.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  // ---------- подтягивание видео и звука к часам ----------

  useEffect(() => {
    const targets = new Map<string, { at: number; rate: number; volume: number; reverse?: boolean }>();
    for (const v of visibleMain) {
      const c = v.clip;
      if (c.kind === "image" || c.kind === "motion") continue;
      const at = c.reverse ? c.out - v.local * c.speed : c.in + v.local * c.speed;
      targets.set(`c:${c.id}`, { at, rate: c.speed, volume: c.muted ? 0 : Math.min(1, c.volume), reverse: c.reverse });
    }
    for (const l of visibleLayers) {
      if (l.kind === "image" || l.kind === "motion") continue;
      targets.set(`l:${l.id}`, { at: l.in + (time - l.start) * l.speed, rate: l.speed, volume: l.muted ? 0 : Math.min(1, l.volume) });
    }
    for (const a of project.audio) {
      const local = time - a.start;
      const len = a.out - a.in;
      if (local < 0 || (!a.loop && local > len)) continue;
      const fadeIn = a.fadeIn > 0 ? Math.min(1, local / a.fadeIn) : 1;
      const fadeOut = a.fadeOut > 0 ? Math.min(1, (len - local) / a.fadeOut) : 1;
      targets.set(`a:${a.id}`, { at: a.in + (a.loop ? local % len : local), rate: 1, volume: Math.min(1, a.volume * Math.max(0, Math.min(fadeIn, fadeOut))) });
    }
    media.current.forEach((el, key) => {
      const tg = targets.get(key);
      if (!tg) {
        if (!el.paused) el.pause();
        return;
      }
      el.volume = Math.max(0, Math.min(1, tg.volume));
      if (playing && !tg.reverse) {
        if (Math.abs(el.playbackRate - tg.rate) > 1e-3) el.playbackRate = tg.rate;
        if (Math.abs(el.currentTime - tg.at) > 0.25) el.currentTime = tg.at;
        if (el.paused) void el.play().catch(() => {});
      } else {
        // На паузе и в реверсе — точный кадр: браузер не умеет играть назад.
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - tg.at) > 0.03) el.currentTime = tg.at;
      }
    });
  });

  const reg = (key: string) => (el: HTMLMediaElement | null) => {
    if (el) media.current.set(key, el);
    else media.current.delete(key);
  };

  // ---------- перетаскивание в кадре ----------

  const dragging = useRef<{ kind: "layer" | "text"; id: string; x0: number; y0: number; bx: number; by: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragging.current;
      const rect = stageRef.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const x = d.bx + (e.clientX - d.x0) / rect.width;
      const y = d.by + (e.clientY - d.y0) / rect.height;
      if (d.kind === "layer") onLayerTransform(d.id, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }, false);
      else onTextMove(d.id, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), false);
    };
    const up = (e: MouseEvent) => {
      const d = dragging.current;
      const rect = stageRef.current?.getBoundingClientRect();
      dragging.current = null;
      if (!d || !rect) return;
      const x = d.bx + (e.clientX - d.x0) / rect.width;
      const y = d.by + (e.clientY - d.y0) / rect.height;
      if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) < 2) return;
      if (d.kind === "layer") onLayerTransform(d.id, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }, true);
      else onTextMove(d.id, Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), true);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onLayerTransform, onTextMove]);

  // ---------- главная дорожка ----------

  const fit = (c: MontageClip) => c.fit || project.canvas.fit;
  const renderClip = (c: MontageClip, local: number, extra: CSSProperties, z: number, hidden = false) => {
    const tf = sampleTransform(c.transform, c.keyframes, local);
    const dur = (c.out - c.in) / c.speed;
    const mo = motionCss(c.effects, options.effects, local, dur);
    const look = lookCss(c.adjust, c.effects, options.filters, options.effects) + (mo.brightness !== 1 ? ` brightness(${mo.brightness})` : "");
    const mediaStyle: CSSProperties = {
      objectFit: fit(c) === "crop" ? "cover" : "contain",
      objectPosition: `${c.focusX * 100}% ${c.focusY * 100}%`,
      transform: `${mo.transform}${c.zoom > 1 ? ` scale(${c.zoom})` : ""}`,
      transformOrigin: `${c.focusX * 100}% ${c.focusY * 100}%`,
      filter: look,
    };
    const fadeIn = c.fadeIn > 0 ? Math.min(1, local / c.fadeIn) : 1;
    const fadeOut = c.fadeOut > 0 ? Math.min(1, (dur - local) / c.fadeOut) : 1;
    return (
      <div key={c.id} className="mt-clip" style={{ zIndex: z, display: hidden ? "none" : undefined, ...extra }}>
        <div className="mt-clip-inner" style={{ ...transformCss(tf), opacity: tf.opacity * Math.max(0, Math.min(fadeIn, fadeOut)) }}>
          {fit(c) === "blur" && c.kind !== "image" && <div className="mt-stage-blur" />}
          {c.kind === "motion" && c.motion ? (
            <div className="mt-stage-media mt-stage-motion"><MotionFrame motion={c.motion} width={W} height={H} local={hidden ? 0 : local * c.speed + c.in} /></div>
          ) : c.kind === "image" ? (
            <img className="mt-stage-media" src={mediaUrl(scheme, c.src)} style={mediaStyle} alt="" />
          ) : (
            <video ref={reg(`c:${c.id}`)} className="mt-stage-media" src={videoUrl(c.src)} style={mediaStyle} playsInline preload="auto" />
          )}
          {c.erase && c.erase.length > 0 && <EraseMarks clip={c} fit={fit(c)} />}
          <FxOverlays list={[...mo.overlays, ...((c.adjust.grain || 0) > 0.05 ? ["grain"] : [])]} />
          {gradeOverlays(c.adjust).map((st, i) => (
            <div key={`g${i}`} className="mt-grade-ov" style={st} />
          ))}
        </div>
      </div>
    );
  };

  let trans: ReturnType<typeof transitionStyles> | null = null;
  if (visibleMain.length === 2) {
    const B = visibleMain[1];
    const kind = options.transitions.find((t) => t.id === B.clip.transition.kind)?.css || "fade";
    const ov = items[B.index].overlap || 0.001;
    trans = transitionStyles(kind, Math.min(1, Math.max(0, B.local / ov)));
  }

  // ---------- слой ----------

  const renderLayer = (l: MontageLayer, hidden = false) => {
    const local = time - l.start;
    const dur = layerDuration(l);
    const tf = sampleTransform(l.transform, l.keyframes, local);
    const mo = motionCss(l.effects, options.effects, local, dur);
    const fadeIn = l.fadeIn > 0 ? Math.min(1, local / l.fadeIn) : 1;
    const fadeOut = l.fadeOut > 0 ? Math.min(1, (dur - local) / l.fadeOut) : 1;
    const selected = selection?.kind === "layer" && selection.id === l.id;
    const mediaStyle: CSSProperties = {
      width: "100%",
      height: l.mask === "circle" ? "100%" : "auto",
      objectFit: "cover",
      display: "block",
      filter: lookCss(l.adjust, l.effects, options.filters, options.effects),
      transform: mo.transform,
      borderRadius: l.mask === "circle" ? "50%" : l.mask === "rounded" ? "12%" : undefined,
    };
    return (
      <div
        key={l.id}
        className={`mt-layer ${selected ? "sel" : ""} ${l.chroma.enabled ? "chroma" : ""}`}
        style={{
          display: hidden ? "none" : undefined,
          left: `${tf.x * 100}%`,
          top: `${tf.y * 100}%`,
          width: `${tf.scale * 100}%`,
          aspectRatio: l.mask === "circle" ? "1" : l.kind === "motion" ? `${W} / ${H}` : undefined,
          transform: `translate(-50%, -50%) rotate(${tf.rotation}deg)`,
          opacity: tf.opacity * Math.max(0, Math.min(fadeIn, fadeOut)),
          zIndex: 10 + l.track,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onSelect({ kind: "layer", id: l.id });
          dragging.current = { kind: "layer", id: l.id, x0: e.clientX, y0: e.clientY, bx: tf.x, by: tf.y };
        }}
        onWheel={(e) => {
          if (!selected) return;
          onLayerTransform(l.id, { scale: Math.max(0.03, Math.round(tf.scale * (e.deltaY < 0 ? 1.05 : 0.95) * 1000) / 1000) }, true);
        }}
        title={l.kind === "motion" ? "Титр — поля текста справа, в инспекторе" : l.chroma.enabled ? "Хромакей виден в собранном ролике" : "Тащите, чтобы подвинуть; колесо — размер"}
      >
        {l.kind === "motion" && l.motion ? (
          <MotionFrame motion={l.motion} width={W} height={H} local={hidden ? 0 : l.in + Math.max(0, local) * l.speed} />
        ) : l.kind === "image" ? (
          <img src={mediaUrl(scheme, l.src)} style={mediaStyle} alt="" draggable={false} />
        ) : (
          <video ref={reg(`l:${l.id}`)} src={videoUrl(l.src)} style={mediaStyle} playsInline preload="auto" />
        )}
      </div>
    );
  };

  // ---------- надписи и субтитры ----------

  const texts = activeTexts(project.texts, time);
  const cap = project.captions;
  const capStyle = options.captionStyles.find((s) => s.id === cap.style) || options.captionStyles[0];
  const line = useMemo(() => {
    if (!cap.enabled || !words.length || !capStyle) return null;
    if (capStyle.reveal === "word") {
      const w = words.find((x, i) => time >= x.s && time < (words[i + 1] ? Math.min(words[i + 1].s, x.e + 0.5) : x.e + 0.4));
      return w ? { words: [w], start: w.s, end: w.e } : null;
    }
    const per = Math.max(1, Math.min(capStyle.per || 4, cap.wordsPerLine || capStyle.per || 4));
    return captionLines(words, per, per <= 3 ? 20 : per >= 6 ? 40 : 30).find((l) => time >= l.start && time < l.end) || null;
  }, [cap.enabled, cap.wordsPerLine, capStyle, words, time]);
  const capCss = capStyle ? captionCss(capStyle, cap) : null;

  const fontFace = cap.fontPath ? `@font-face{font-family:"mt-caption";src:url("${mediaUrl(scheme, cap.fontPath)}")}` : "";
  const outT = trans?.out || {};
  const inT = trans?.in || {};

  return (
    <div
      ref={stageRef}
      className="mt-stage"
      style={{ aspectRatio: `${W} / ${H}`, background: project.canvas.background }}
      onMouseDown={() => onSelect(null)}
    >
      {fontFace && <style>{fontFace}</style>}
      {/* Резкость в окне — свёрткой SVG: CSS-фильтра резкости нет. */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        {[1, 2, 3, 4, 5].map((k) => {
          const a = k * 0.12;
          return (
            <filter key={k} id={`mt-sharpen-${k}`}>
              <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix={`0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`} />
            </filter>
          );
        })}
      </svg>
      <FontFaces paths={project.texts.flatMap((t) => [t.fontPath || "", t.accentFontPath || ""])} scheme={scheme} />
      {visibleMain.map((v, k) => renderClip(v.clip, v.local, k === 0 ? outT : inT, k + 1))}
      {preloadMain && renderClip(preloadMain, 0, {}, 0, true)}
      {trans?.flash && <div className="mt-flash" style={{ background: trans.flash, opacity: trans.flashOpacity }} />}
      {!project.clips.length && !project.layers.length && <div className="mt-stage-empty">Добавьте видео слева в «Медиа» или создайте ролик во вкладке «✨ Моушн»</div>}
      {visibleLayers.map((l) => renderLayer(l))}
      {preloadLayers.map((l) => renderLayer(l, true))}
      {project.audio.map((a) => (
        <audio key={a.id} ref={reg(`a:${a.id}`)} src={mediaUrl(scheme, a.src)} preload="auto" />
      ))}
      {project.logo && (
        <img
          className={`mt-stage-logo ${project.logo.corner}`}
          src={mediaUrl(scheme, project.logo.path)}
          style={{ width: `${project.logo.size * 100}%`, opacity: project.logo.opacity }}
          alt=""
        />
      )}
      {texts.map((t) => {
        const progress = Math.min(1, (time - t.start) / 0.25);
        const placed = t.x !== null && t.y !== null;
        const selected = selection?.kind === "text" && selection.id === t.id;
        return (
          <div
            key={t.id}
            className={`mt-overlay-text s-${t.style} p-${placed ? "free" : t.position || "auto"} a-${t.animation} ${selected ? "sel" : ""}`}
            style={{
              fontSize: t.size ? `${(t.size / Math.min(W, H)) * 100}cqmin` : undefined,
              color: t.color || undefined,
              background: t.bg || (t.style === "hook" || t.style === "label" ? cap.highlight : undefined),
              fontFamily: t.fontPath ? `"${cssFamily(t.fontPath)}"` : cap.fontPath ? "mt-caption" : undefined,
              fontWeight: t.fontPath ? 400 : undefined,
              letterSpacing: t.spacing ? `${t.spacing}em` : undefined,
              textShadow: t.glow ? `0 0 0.12em ${t.accentColor || cap.highlight}, 0 0 0.35em ${t.accentColor || cap.highlight}` : undefined,
              ...(placed ? { left: `${t.x! * 100}%`, top: `${t.y! * 100}%`, right: "auto", bottom: "auto", transform: "translate(-50%, -50%)" } : {}),
              ["--p" as string]: String(progress),
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onSelect({ kind: "text", id: t.id });
              const rect = stageRef.current!.getBoundingClientRect();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const bx = placed ? t.x! : (r.left + r.width / 2 - rect.left) / rect.width;
              const by = placed ? t.y! : (r.top + r.height / 2 - rect.top) / rect.height;
              dragging.current = { kind: "text", id: t.id, x0: e.clientX, y0: e.clientY, bx, by };
            }}
          >
            {t.animation === "type"
              ? (t.upper ? t.text.toUpperCase() : t.text).replace(/\*/g, "").slice(0, Math.ceil(t.text.length * Math.min(1, (time - t.start) / Math.max(0.3, (t.end - t.start) / 2))))
              : /\*[^*]+\*/.test(t.text)
                ? t.text.split(/\*([^*]+)\*/).map((seg, i) =>
                    i % 2 ? (
                      <span key={i} style={{ fontFamily: t.accentFontPath ? `"${cssFamily(t.accentFontPath)}"` : undefined, color: t.accentColor || cap.highlight, fontSize: `${t.accentScale || 1}em`, letterSpacing: 0, textTransform: "none", fontWeight: t.accentFontPath ? 400 : undefined }}>
                        {seg}
                      </span>
                    ) : (
                      <span key={i}>{t.upper ? seg.toUpperCase() : seg}</span>
                    )
                  )
                : t.upper
                  ? t.text.toUpperCase()
                  : t.text}
          </div>
        );
      })}
      {line && capCss && capStyle && (
        <div
          className={`mt-caption p-${capStyle.position === "center" ? "center" : cap.position} ${capStyle.align === "left" ? "left" : ""}`}
          style={{ ...capCss.base, fontFamily: cap.fontPath ? "mt-caption" : capCss.base.fontFamily }}
        >
          {line.words.map((w, i) => {
            const next = line.words[i + 1];
            const on = time >= w.s && (!next || time < next.s);
            const future = capStyle.reveal === "accumulate" && time < w.s;
            const quietStyle = !capStyle.active || Object.keys(capStyle.active).length === 0;
            return (
              <span key={i} className={on && !quietStyle ? `on a-${capStyle.active.anim || "none"}` : ""} style={{ ...(on && !quietStyle ? capCss.active : {}), opacity: future ? 0 : undefined }}>
                {w.w}{" "}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
