import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { MontageClip, MontageLayer, MontageOptions, MontageProject, MontageTransform } from "../lib/types";
import {
  activeTexts,
  captionCss,
  captionLines,
  layerDuration,
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
  time: number;
  playing: boolean;
  words: OutputWord[];
  selection: Selection;
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
export default function MontagePreview({ project, scheme, options, time, playing, words, selection, onTime, onEnded, onSelect, onLayerTransform, onTextMove }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const media = useRef<Map<string, HTMLMediaElement>>(new Map());
  const timeRef = useRef(time);
  useEffect(() => {
    timeRef.current = time;
  }, [time]);
  const { items, duration } = useMemo(() => layout(project.clips), [project.clips]);
  const { width: W, height: H } = project.canvas;

  // ---------- что видно в момент time ----------

  const visibleMain: { clip: MontageClip; index: number; local: number }[] = [];
  let preloadMain: MontageClip | null = null;
  items.forEach((it, i) => {
    if (time >= it.start - 1e-6 && time < it.end) visibleMain.push({ clip: project.clips[i], index: i, local: time - it.start });
    else if (!preloadMain && it.start > time && it.start - time < 1.5) preloadMain = project.clips[i];
  });
  // Последний кадр ролика показываем, а не чёрный экран.
  if (!visibleMain.length && project.clips.length && time >= duration - 1e-6) {
    const i = project.clips.length - 1;
    visibleMain.push({ clip: project.clips[i], index: i, local: items[i].duration });
  }
  const layers = [...project.layers].sort((a, b) => a.track - b.track);
  const visibleLayers = layers.filter((l) => time >= l.start && time < l.start + layerDuration(l));
  const preloadLayers = layers.filter((l) => l.start > time && l.start - time < 1.5);

  // ---------- часы ----------

  useEffect(() => {
    if (!playing) return;
    const wall0 = performance.now();
    const t0 = timeRef.current >= duration - 0.05 ? 0 : timeRef.current;
    let raf = 0;
    const tick = () => {
      const t = t0 + (performance.now() - wall0) / 1000;
      if (t >= duration) {
        onTime(duration);
        onEnded();
        return;
      }
      onTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Часы перезапускаются только по «играть/стоп» и смене длины ролика.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  // ---------- подтягивание видео и звука к часам ----------

  useEffect(() => {
    const targets = new Map<string, { at: number; rate: number; volume: number; reverse?: boolean }>();
    for (const v of visibleMain) {
      const c = v.clip;
      if (c.kind === "image") continue;
      const at = c.reverse ? c.out - v.local * c.speed : c.in + v.local * c.speed;
      targets.set(`c:${c.id}`, { at, rate: c.speed, volume: c.muted ? 0 : Math.min(1, c.volume), reverse: c.reverse });
    }
    for (const l of visibleLayers) {
      if (l.kind === "image") continue;
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
          {c.kind === "image" ? (
            <img className="mt-stage-media" src={mediaUrl(scheme, c.src)} style={mediaStyle} alt="" />
          ) : (
            <video ref={reg(`c:${c.id}`)} className="mt-stage-media" src={mediaUrl(scheme, c.src)} style={mediaStyle} playsInline preload="auto" />
          )}
          <FxOverlays list={mo.overlays} />
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
          aspectRatio: l.mask === "circle" ? "1" : undefined,
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
        title={l.chroma.enabled ? "Хромакей виден в собранном ролике" : "Тащите, чтобы подвинуть; колесо — размер"}
      >
        {l.kind === "image" ? (
          <img src={mediaUrl(scheme, l.src)} style={mediaStyle} alt="" draggable={false} />
        ) : (
          <video ref={reg(`l:${l.id}`)} src={mediaUrl(scheme, l.src)} style={mediaStyle} playsInline preload="auto" />
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
      {visibleMain.map((v, k) => renderClip(v.clip, v.local, k === 0 ? outT : inT, k + 1))}
      {preloadMain && renderClip(preloadMain, 0, {}, 0, true)}
      {trans?.flash && <div className="mt-flash" style={{ background: trans.flash, opacity: trans.flashOpacity }} />}
      {!project.clips.length && <div className="mt-stage-empty">Добавьте видео на дорожку — слева «Медиа», «Сток» или вкладка «ИИ-монтажёр»</div>}
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
              fontFamily: cap.fontPath ? "mt-caption" : undefined,
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
              ? (t.upper ? t.text.toUpperCase() : t.text).slice(0, Math.ceil(t.text.length * Math.min(1, (time - t.start) / Math.max(0.3, (t.end - t.start) / 2))))
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
