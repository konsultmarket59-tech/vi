import { useEffect, useMemo, useRef } from "react";
import type { MontageProject } from "../lib/types";
import { activeTexts, captionLines, cssFilter, layout, mediaUrl, outputToSource, type OutputWord } from "../lib/montage";

interface Props {
  project: MontageProject;
  scheme: string;
  time: number;
  playing: boolean;
  words: OutputWord[];
  onTime: (t: number) => void;
  onEnded: () => void;
}

/**
 * Предпросмотр таймлайна без сборки.
 *
 * Один видеоэлемент ходит по кускам: на границе куска он перескакивает в
 * следующий — внутри того же файла это просто перемотка, она почти мгновенна.
 * Время ролика ведёт само видео, а не таймер: таймер расходится с картинкой на
 * первой же подгрузке, и субтитры начинают опаздывать от губ.
 *
 * Переходы здесь показываются склейкой — их видно только в собранном ролике.
 */
export default function MontagePreview({ project, scheme, time, playing, words, onTime, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const clockRef = useRef<{ wall: number; t: number } | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  const { items, duration } = useMemo(() => layout(project.clips), [project.clips]);
  const hit = outputToSource(project.clips, time);
  const clip = hit?.clip;
  const { width: W, height: H } = project.canvas;

  // Кадр под бегунком, когда не играем: перемотка видео на время исходника.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip || clip.kind === "image" || playing) return;
    const url = mediaUrl(scheme, clip.src);
    if (v.dataset.src !== url) {
      v.dataset.src = url;
      v.src = url;
    }
    const target = hit!.time;
    if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
    // hit пересчитывается из time и clip — отдельной зависимостью не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, clip?.src, time, playing, scheme]);

  // Воспроизведение: видео ведёт время, на границе куска — переход к следующему.
  useEffect(() => {
    const v = videoRef.current;
    if (!playing) {
      v?.pause();
      audioRefs.current.forEach((a) => a.pause());
      clockRef.current = null;
      return;
    }
    let raf = 0;
    let index = outputToSource(project.clips, timeRef.current)?.index ?? 0;
    const enter = (i: number, at: number) => {
      const c = project.clips[i];
      if (!c) return;
      if (c.kind === "image" || !v) {
        clockRef.current = { wall: performance.now(), t: at };
        v?.pause();
        return;
      }
      clockRef.current = null;
      const url = mediaUrl(scheme, c.src);
      if (v.dataset.src !== url) {
        v.dataset.src = url;
        v.src = url;
      }
      v.currentTime = c.in + (at - items[i].start) * c.speed;
      v.playbackRate = c.speed;
      v.volume = Math.min(1, c.muted ? 0 : c.volume);
      void v.play().catch(() => {});
    };
    enter(index, timeRef.current);
    const tick = () => {
      const c = project.clips[index];
      if (!c) {
        onEnded();
        return;
      }
      let t: number;
      if (clockRef.current) t = clockRef.current.t + (performance.now() - clockRef.current.wall) / 1000;
      else t = items[index].start + ((v?.currentTime ?? c.in) - c.in) / c.speed;
      if (t >= items[index].end - 0.015) {
        index++;
        if (index >= project.clips.length) {
          onTime(duration);
          onEnded();
          return;
        }
        enter(index, items[index].start);
        t = items[index].start;
      }
      onTime(t);
      syncAudio(t);
      raf = requestAnimationFrame(tick);
    };
    const syncAudio = (t: number) => {
      for (const a of project.audio) {
        const el = audioRefs.current.get(a.id);
        if (!el) continue;
        const local = t - a.start;
        const len = a.out - a.in;
        if (local < 0 || local > len) {
          if (!el.paused) el.pause();
          continue;
        }
        const target = a.in + local;
        if (Math.abs(el.currentTime - target) > 0.3) el.currentTime = target;
        el.volume = Math.min(1, a.volume);
        if (el.paused) void el.play().catch(() => {});
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Перезапуск только по старту/остановке и смене таймлайна.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, project.clips, project.audio, scheme]);

  const texts = activeTexts(project.texts, time);
  const cap = project.captions;
  const line = useMemo(() => {
    if (!cap.enabled || !words.length) return null;
    const per = cap.style === "bold" ? Math.min(3, cap.wordsPerLine || 3) : cap.style === "pop" ? 1 : cap.wordsPerLine || 4;
    return captionLines(words, per, cap.style === "bold" ? 20 : 30).find((l) => time >= l.start && time < l.end) || null;
  }, [cap.enabled, cap.style, cap.wordsPerLine, words, time]);

  const fit = clip?.fit || project.canvas.fit;
  const mediaStyle: React.CSSProperties = clip
    ? {
        objectFit: fit === "crop" ? "cover" : "contain",
        objectPosition: `${clip.focusX * 100}% ${clip.focusY * 100}%`,
        transform: clip.zoom > 1 ? `scale(${clip.zoom})` : undefined,
        transformOrigin: `${clip.focusX * 100}% ${clip.focusY * 100}%`,
        filter: cssFilter(clip),
      }
    : {};

  // Шрифт из файла — тем же файлом, что уйдёт в сборку.
  const fontFace = cap.fontPath ? `@font-face{font-family:"mt-caption";src:url("${mediaUrl(scheme, cap.fontPath)}")}` : "";

  return (
    <div className="mt-stage" style={{ aspectRatio: `${W} / ${H}`, background: project.canvas.background }}>
      {fontFace && <style>{fontFace}</style>}
      {fit === "blur" && clip && clip.kind !== "image" && <div className="mt-stage-blur" />}
      <video ref={videoRef} className="mt-stage-media" style={{ ...mediaStyle, display: clip && clip.kind !== "image" ? "block" : "none" }} playsInline preload="auto" />
      {clip && clip.kind === "image" && <img className="mt-stage-media" src={mediaUrl(scheme, clip.src)} style={mediaStyle} alt="" />}
      {!clip && <div className="mt-stage-empty">Добавьте видео на дорожку — слева «Медиа» или вкладка «ИИ-монтажёр»</div>}
      {project.audio.map((a) => (
        <audio
          key={a.id}
          ref={(el) => {
            if (el) audioRefs.current.set(a.id, el);
            else audioRefs.current.delete(a.id);
          }}
          src={mediaUrl(scheme, a.src)}
          preload="auto"
        />
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
        return (
          <div
            key={t.id}
            className={`mt-overlay-text s-${t.style} p-${t.position || "auto"} a-${t.animation}`}
            style={{
              fontSize: t.size ? `${(t.size / Math.min(W, H)) * 100}cqmin` : undefined,
              color: t.color || undefined,
              background: t.bg || undefined,
              fontFamily: cap.fontPath ? "mt-caption" : undefined,
              ["--p" as string]: String(progress),
            }}
          >
            {t.animation === "type" ? (t.upper ? t.text.toUpperCase() : t.text).slice(0, Math.ceil(t.text.length * Math.min(1, (time - t.start) / Math.max(0.3, (t.end - t.start) / 2)))) : t.upper ? t.text.toUpperCase() : t.text}
          </div>
        );
      })}
      {line && (
        <div
          className={`mt-caption s-${cap.style} p-${cap.position}`}
          style={{ fontFamily: cap.fontPath ? "mt-caption" : undefined, color: cap.color, fontSize: `${(cap.size / 1080) * 100}cqmin`, ["--hl" as string]: cap.highlight }}
        >
          {cap.style === "pop"
            ? (() => {
                const w = words.find((x) => time >= x.s && time < x.e + 0.4);
                return w ? <span className="on">{cap.upper ? w.w.toUpperCase() : w.w}</span> : null;
              })()
            : line.words.map((w, i) => {
                const on = cap.style !== "clean" && time >= w.s && (i === line.words.length - 1 || time < line.words[i + 1].s);
                return (
                  <span key={i} className={on ? "on" : ""}>
                    {cap.upper || cap.style === "bold" ? w.w.toUpperCase() : w.w}{" "}
                  </span>
                );
              })}
        </div>
      )}
    </div>
  );
}
