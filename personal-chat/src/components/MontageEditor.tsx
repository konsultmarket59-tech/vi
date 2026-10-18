import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { MontageAudio, MontageCaptions, MontageClip, MontageConfig, MontageOptions, MontageProject, MontageTransform, MontageTranscript, StoriesDesign, StoriesHandoff } from "../lib/types";
import { fileName, fmtTime, layerDuration, layout, newAudio, newClip, newLayer, outputToSource, outputWords, projectDuration, round3, setTransformAt, splitAt, uid } from "../lib/montage";
import MontagePreview from "./MontagePreview";
import MontageTimeline, { type DropTarget, type Selection } from "./MontageTimeline";
import MontageExport from "./MontageExport";
import { AudioInspector, ClipInspector, LayerInspector, TextInspector } from "./MontageInspector";
import { AIPanel, AudioPanel, CaptionsPanel, DesignPanel, EffectsPanel, FiltersPanel, MediaPanel, StockPanel, TextPanel, TransitionsPanel } from "./MontagePanels";
import type { BinItem, EditorCtx } from "./MontageControls";
import { MotionInspector, MotionPanel, TitlesPanel } from "./MontageMotion";
import { LayoutPanel } from "./MontageLayouts";
import { createPlayhead, usePlayhead, usePlayheadSelect, type Playhead } from "../lib/playhead";
import type { DragPayload, OutputWord } from "../lib/montage";

interface Props {
  options: MontageOptions;
  config: MontageConfig;
  initial: MontageProject;
  onSaved: () => void;
  onConfig: (patch: Partial<MontageConfig>) => void;
  /** Кнопки и панели, которые даёт раздел: проекты, настройки, монтажёр, аватар. */
  projectsButton?: ReactNode;
  settingsButton?: ReactNode;
  agentPanel?: ReactNode;
  avatarPanel?: ReactNode;
  /** Старый путь в «Видео-сторис» — только в «Личном чате». */
  onMotionDesign?: (handoff: Omit<StoriesHandoff, "nonce">) => void;
}

type LeftTab = "media" | "motion" | "titles" | "layout" | "stock" | "audio" | "text" | "captions" | "effects" | "filters" | "transitions" | "design" | "agent" | "avatar" | "ai";

/** Колонка инструментов слева — как верхняя панель CapCut, только вертикально. */
const LEFT_TABS: { id: LeftTab; icon: string; label: string }[] = [
  { id: "media", icon: "🎞", label: "Медиа" },
  { id: "motion", icon: "✨", label: "Моушн" },
  { id: "titles", icon: "🏷", label: "Титры" },
  { id: "layout", icon: "🧩", label: "Коллаж" },
  { id: "text", icon: "T", label: "Текст" },
  { id: "captions", icon: "CC", label: "Субтитры" },
  { id: "stock", icon: "🌐", label: "Сток" },
  { id: "audio", icon: "♪", label: "Звуки" },
  { id: "effects", icon: "✦", label: "Эффекты" },
  { id: "filters", icon: "◐", label: "Фильтры" },
  { id: "transitions", icon: "⧓", label: "Переходы" },
  { id: "design", icon: "🎨", label: "Дизайн" },
  { id: "agent", icon: "🤖", label: "Монтажёр" },
  { id: "avatar", icon: "🧑", label: "Аватар" },
  { id: "ai", icon: "🧹", label: "Чистка" },
];

/** Широкие панели — там формы, а не списки. */
const WIDE: LeftTab[] = ["motion", "agent", "avatar"];

function Clock({ playhead, duration }: { playhead: Playhead; duration: number }) {
  const t = usePlayhead(playhead);
  return <span className="mt-clock">{fmtTime(t, true)} / {fmtTime(duration, true)}</span>;
}

/**
 * Текст ролика: тысячи слов. Перерисовывается, только когда меняется
 * текущее слово, а не на каждом кадре.
 */
const WordList = memo(function WordList({ words, transcripts, wordSel, setWordSel, seek, playhead }: {
  words: OutputWord[];
  transcripts: Record<string, MontageTranscript>;
  wordSel: { from: number; to: number } | null;
  setWordSel: (s: { from: number; to: number } | null) => void;
  seek: (t: number) => void;
  playhead: Playhead;
}) {
  const currentWord = usePlayheadSelect(playhead, (time) => {
    // Слова идут по порядку — двоичный поиск вместо перебора тысяч слов на кадр.
    let lo = 0;
    let hi = words.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (time < words[mid].s) hi = mid - 1;
      else if (time >= words[mid].e) lo = mid + 1;
      else return mid;
    }
    return -1;
  });
  return (
    <div className="mt-words">
      {words.map((w, i) => {
        const inSel = wordSel && i >= Math.min(wordSel.from, wordSel.to) && i <= Math.max(wordSel.from, wordSel.to);
        const filler = transcripts[w.src]?.words[w.index]?.filler;
        return (
          <span
            key={`${w.clipId}-${w.index}`}
            className={`${i === currentWord ? "now" : ""} ${inSel ? "sel" : ""} ${filler ? `f-${filler}` : ""}`}
            onClick={(e) => {
              if (e.shiftKey && wordSel) setWordSel({ from: wordSel.from, to: i });
              else if (e.shiftKey) setWordSel({ from: i, to: i });
              else {
                setWordSel({ from: i, to: i });
                seek(w.s + 0.001);
              }
            }}
          >
            {w.w}{" "}
          </span>
        );
      })}
    </div>
  );
});

const HISTORY_LIMIT = 80;

export default function MontageEditor({ options, config, initial, onSaved, onConfig, projectsButton, settingsButton, agentPanel, avatarPanel, onMotionDesign }: Props) {
  // История правок одним состоянием: настоящее, прошлое и будущее меняются
  // вместе, иначе отмена и новая правка могут разойтись на один шаг.
  const [hist, setHist] = useState<{ past: MontageProject[]; present: MontageProject; future: MontageProject[] }>({ past: [], present: initial, future: [] });
  const project = hist.present;
  // time — для правок и панелей; пока ролик играет, обновляется четыре раза в
  // секунду. Точное время кадра — в playhead (см. lib/playhead.ts).
  const [time, setTimeState] = useState(0);
  const playhead = useMemo(() => createPlayhead(0), []);
  const setTime = useCallback(
    (next: number | ((t: number) => number)) => {
      const v = typeof next === "function" ? next(playhead.get()) : next;
      playhead.set(v);
      setTimeState(v);
    },
    [playhead]
  );
  const [playing, setPlaying] = useState(false);
  const [proxies, setProxies] = useState<Record<string, string>>({});
  const [proxyProgress, setProxyProgress] = useState<Record<string, number>>({});
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(40);
  const [tab, setTab] = useState<LeftTab>("media");
  const [transcripts, setTranscripts] = useState<Record<string, MontageTranscript>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [design, setDesign] = useState<StoriesDesign | null>(null);
  const [wordSel, setWordSel] = useState<{ from: number; to: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const scheme = options.scheme;

  // Короткий журнал действий: если окно зависнет, по нему видно, на чём.
  const crumb = (t: string) => {
    try {
      window.api.montageCrumb(t);
    } catch {
      // журнал — не условие работы
    }
  };
  useEffect(() => crumb(`вкладка ${tab}`), [tab]);
  useEffect(() => crumb(playing ? "воспроизведение" : "пауза"), [playing]);
  useEffect(() => crumb(`выбрано ${selection ? selection.kind : "ничего"}`), [selection]);
  useEffect(() => crumb(`проект: кусков ${hist.present.clips.length}, слоёв ${hist.present.layers.length}, надписей ${hist.present.texts.length}`), [hist.present.clips.length, hist.present.layers.length, hist.present.texts.length]);
  const bin: BinItem[] = useMemo(() => ((project.meta as { bin?: BinItem[] }).bin || []), [project.meta]);

  // ---------- история правок ----------

  /** Правка с записью в историю — то, что отменяется Ctrl+Z. */
  const commit = useCallback((next: MontageProject | ((p: MontageProject) => MontageProject)) => {
    setHist((h) => {
      const value = typeof next === "function" ? next(h.present) : next;
      if (value === h.present) return h;
      return { past: [...h.past.slice(-HISTORY_LIMIT), h.present], present: value, future: [] };
    });
  }, []);

  /** Правка без записи в историю — название проекта. */
  const setProject = useCallback((fn: (p: MontageProject) => MontageProject) => {
    setHist((h) => ({ ...h, present: fn(h.present) }));
  }, []);

  // Перетаскивание: кадры движения в историю не пишутся, только итог — одной
  // записью от состояния до начала движения.
  const dragStart = useRef<MontageProject | null>(null);
  const onLive = useCallback((p: MontageProject) => {
    setHist((h) => {
      if (!dragStart.current) dragStart.current = h.present;
      return { ...h, present: p };
    });
  }, []);
  const onCommit = useCallback((p: MontageProject) => {
    const before = dragStart.current;
    dragStart.current = null;
    setHist((h) => {
      const base = before || h.present;
      if (base === p) return { ...h, present: p };
      return { past: [...h.past.slice(-HISTORY_LIMIT), base], present: p, future: [] };
    });
  }, []);
  const liveOrCommit = useCallback((fn: (p: MontageProject) => MontageProject, final: boolean) => {
    setHist((h) => {
      const next = fn(h.present);
      if (!final) {
        if (!dragStart.current) dragStart.current = h.present;
        return { ...h, present: next };
      }
      const base = dragStart.current || h.present;
      dragStart.current = null;
      return { past: [...h.past.slice(-HISTORY_LIMIT), base], present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  }, []);
  const redo = useCallback(() => {
    setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));
  }, []);

  // ---------- сохранение ----------

  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      window.api.montageSave(project).then(onSaved).catch((e) => setError(`Проект не сохранился: ${e instanceof Error ? e.message : String(e)}`));
    }, 700);
    return () => window.clearTimeout(saveTimer.current);
    // onSaved — обновить список проектов; на каждую его смену сохранять незачем.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // ---------- расшифровки и длительности ----------

  const sources = useMemo(() => [...new Set(project.clips.filter((c) => c.kind === "video").map((c) => c.src))], [project.clips]);
  const refreshTranscripts = useCallback(async () => {
    setTranscripts(await window.api.montageTranscripts(sources));
  }, [sources]);
  useEffect(() => {
    void refreshTranscripts();
  }, [refreshTranscripts]);

  // Лёгкие копии для предпросмотра: тяжёлые исходники (HEVC, 4K, ProRes,
  // 60 кадров) плеер окна не тянет — показываем копию 540p, собираем из оригинала.
  const videoSources = useMemo(
    () => [...new Set([...project.clips, ...project.layers].filter((c) => c.kind === "video").map((c) => c.src))],
    [project.clips, project.layers]
  );
  const asked = useRef(new Set<string>());
  useEffect(() => {
    for (const src of videoSources) {
      if (asked.current.has(src)) continue;
      asked.current.add(src);
      window.api
        .montageProxy(src)
        .then((r) => {
          if (r.status === "ready" && r.path) setProxies((p) => ({ ...p, [src]: r.path! }));
          if (r.status === "pending") setProxyProgress((p) => ({ ...p, [src]: 0 }));
        })
        .catch(() => {});
    }
  }, [videoSources]);
  useEffect(
    () =>
      window.api.onMontageProxy((d) => {
        if (d.proxy) {
          setProxies((p) => ({ ...p, [d.file]: d.proxy! }));
          setProxyProgress((p) => {
            const { [d.file]: _done, ...rest } = p;
            return rest;
          });
        } else if (d.error) {
          setProxyProgress((p) => {
            const { [d.file]: _failed, ...rest } = p;
            return rest;
          });
        } else if (typeof d.progress === "number") setProxyProgress((p) => ({ ...p, [d.file]: d.progress! }));
      }),
    []
  );

  useEffect(() => {
    const need = [...new Set([...project.clips.map((c) => c.src), ...project.layers.map((l) => l.src), ...project.audio.map((a) => a.src), ...bin.map((b) => b.path)])].filter((s) => durations[s] === undefined && !s.startsWith("motion://"));
    if (!need.length) return;
    let alive = true;
    (async () => {
      const found: Record<string, number> = {};
      for (const s of need) found[s] = (await window.api.montageProbe(s).catch(() => ({ duration: 0 }))).duration || 0;
      if (alive) setDurations((d) => ({ ...d, ...found }));
    })();
    return () => {
      alive = false;
    };
  }, [project.clips, project.layers, project.audio, bin, durations]);

  useEffect(() => {
    if (!project.design?.dir) {
      setDesign(null);
      return;
    }
    window.api.montageReadDesign(project.design.dir).then(setDesign).catch(() => setDesign(null));
  }, [project.design?.dir]);

  const words = useMemo(() => outputWords(project.clips, transcripts), [project.clips, transcripts]);
  const duration = projectDuration(project);

  // ---------- действия ----------

  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);

  const split = useCallback(() => {
    // Слой режется так же, как кусок: выбранный слой под бегунком — на два.
    if (selection?.kind === "layer") {
      commit((p) => {
        const l = p.layers.find((x) => x.id === selection.id);
        if (!l) return p;
        const local = time - l.start;
        if (local < 0.05 || local > layerDuration(l) - 0.05) return p;
        const cut = round3(l.in + local * l.speed);
        const a = { ...l, out: cut, keyframes: l.keyframes.filter((k) => k.t <= local) };
        const b = { ...l, id: uid("layer"), start: round3(time), in: cut, keyframes: l.keyframes.filter((k) => k.t > local).map((k) => ({ ...k, t: round3(k.t - local) })) };
        return { ...p, layers: p.layers.flatMap((x) => (x.id === l.id ? [a, b] : [x])) };
      });
      return;
    }
    commit((p) => ({ ...p, clips: splitAt(p.clips, time) }));
  }, [commit, time, selection]);

  const remove = useCallback(() => {
    if (!selection) return;
    commit((p) => ({
      ...p,
      clips: selection.kind === "clip" ? p.clips.filter((c) => c.id !== selection.id) : p.clips,
      texts: selection.kind === "text" ? p.texts.filter((t) => t.id !== selection.id) : p.texts,
      audio: selection.kind === "audio" ? p.audio.filter((a) => a.id !== selection.id) : p.audio,
      layers: selection.kind === "layer" ? p.layers.filter((l) => l.id !== selection.id) : p.layers,
    }));
    setSelection(null);
  }, [commit, selection]);

  const duplicate = () => {
    if (!selection) return;
    commit((p) => {
      if (selection.kind === "clip") {
        const i = p.clips.findIndex((c) => c.id === selection.id);
        if (i < 0) return p;
        return { ...p, clips: [...p.clips.slice(0, i + 1), { ...p.clips[i], id: uid("clip") }, ...p.clips.slice(i + 1)] };
      }
      if (selection.kind === "text") {
        const t = p.texts.find((x) => x.id === selection.id);
        if (!t) return p;
        return { ...p, texts: [...p.texts, { ...t, id: uid("text"), start: t.end, end: round3(t.end + (t.end - t.start)) }] };
      }
      if (selection.kind === "layer") {
        const l = p.layers.find((x) => x.id === selection.id);
        if (!l) return p;
        return { ...p, layers: [...p.layers, { ...l, id: uid("layer"), track: Math.min(8, l.track + 1) }] };
      }
      const a = p.audio.find((x) => x.id === selection.id);
      if (!a) return p;
      return { ...p, audio: [...p.audio, { ...a, id: uid("audio"), start: round3(a.start + (a.out - a.in)) }] };
    });
  };

  const addToBin = useCallback(
    (items: BinItem[]) =>
      commit((pr) => {
        const paths = items.map((i) => i.path);
        const existing = ((pr.meta as { bin?: BinItem[] }).bin || []).filter((b) => !paths.includes(b.path));
        return { ...pr, meta: { ...pr.meta, bin: [...existing, ...items] } as MontageProject["meta"] };
      }),
    [commit]
  );

  /** Медиа — на дорожку: главную (в точку бегунка), слоем поверх или звуком. */
  const place = useCallback(
    (item: BinItem, where: "main" | "layer" | MontageAudio["kind"]) => {
      if (where === "music" || where === "sfx" || where === "voice") {
        const len = where === "music" ? Math.min(item.duration || 30, Math.max(5, duration - time) || 30) : item.duration || 1;
        const a = newAudio(item.path, where, time, len);
        commit((p) => ({ ...p, audio: [...p.audio, a] }));
        setSelection({ kind: "audio", id: a.id });
        return;
      }
      if (where === "layer") {
        commit((p) => {
          // Свободная дорожка в этот момент — слои не налезают друг на друга на таймлайне.
          const base = newLayer(item.path, item.kind, item.duration, time);
          const len = layerDuration(base);
          let track = 1;
          while (track < 8 && p.layers.some((l) => l.track === track && l.start < time + len && l.start + layerDuration(l) > time)) track++;
          const l = { ...base, track };
          setSelection({ kind: "layer", id: l.id });
          return { ...p, layers: [...p.layers, l] };
        });
        return;
      }
      const c = newClip(item.path, item.kind, item.duration);
      commit((p) => {
        const hit = outputToSource(p.clips, time);
        const at = hit && time < duration - 0.05 ? hit.index + 1 : p.clips.length;
        return { ...p, clips: [...p.clips.slice(0, at), c, ...p.clips.slice(at)] };
      });
      setSelection({ kind: "clip", id: c.id });
    },
    [commit, time, duration]
  );

  async function transcribeSources() {
    setBusy("Расшифровываю записи…");
    setError(null);
    try {
      const r = await window.api.montageTranscribe(sources.filter((s) => !transcripts[s]));
      if (r.failed.length) setError(r.failed.map((f) => `${fileName(f.path)}: ${f.error}`).join("\n"));
      await refreshTranscripts();
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }

  async function cleanup(onlySelected: boolean) {
    setBusy("Убираю паузы и паразиты…");
    setError(null);
    try {
      const sel = selection?.kind === "clip" ? selection.id : "";
      const r = await window.api.montageClean({ clips: project.clips, ids: onlySelected && sel ? [sel] : undefined });
      if (!r.touched) setNotice("Чистить нечего: у кусков нет расшифровки или в них нет речи.");
      else {
        const before = layout(project.clips).duration;
        const after = layout(r.clips).duration;
        setNotice(`Убрано ${fmtTime(before - after, true)}: было ${fmtTime(before)}, стало ${fmtTime(after)}.`);
        commit((p) => ({ ...p, clips: r.clips }));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }

  /** Монтаж по тексту: выделенные слова вырезаются из своих кусков. */
  async function cutSelectedWords() {
    if (!wordSel) return;
    const chosen = words.slice(Math.min(wordSel.from, wordSel.to), Math.max(wordSel.from, wordSel.to) + 1);
    const byClip = new Map<string, number[]>();
    for (const w of chosen) byClip.set(w.clipId, [...(byClip.get(w.clipId) || []), w.index]);
    const next: MontageClip[] = [];
    for (const c of project.clips) {
      const indices = byClip.get(c.id);
      if (!indices) next.push(c);
      else next.push(...(await window.api.montageCutWords({ clip: c, indices })));
    }
    commit((p) => ({ ...p, clips: next }));
    setWordSel(null);
  }

  function applyDesign(d: StoriesDesign) {
    const accent = d.colours.find((c) => /^#[0-9a-f]{6}$/i.test(c) && !/^#(f{6}|0{6})$/i.test(c));
    commit((p) => ({
      ...p,
      captions: {
        ...p.captions,
        ...(d.fontFiles[0] ? { fontPath: d.fontFiles[0].path, font: d.fontFiles[0].family } : {}),
        ...(accent ? { highlight: accent } : {}),
      },
      logo: d.logoFiles?.[0] ? { path: d.logoFiles[0].path, corner: p.logo?.corner || "top-right", size: p.logo?.size || 0.14, opacity: 1 } : p.logo,
    }));
    setNotice("Дизайн-система применена: шрифт и акцент субтитров, логотип в углу. Надписи берут тот же акцент.");
  }

  /** Моушн-дизайн: ролик собирается и уезжает в «Видео-сторис» со своим текстом. */
  async function motion() {
    if (!onMotionDesign) {
      setTab("motion");
      return;
    }
    setBusy("Собираю ролик для моушн-дизайна…");
    try {
      const r = await window.api.montageRender(project, { format: "mp4", suffix: "-для-моушна" });
      onMotionDesign({ sourcePath: r.path, text: words.map((w) => w.w).join(" "), designDir: project.design?.dir || config.designDir || undefined, preset: project.canvas.preset, title: project.title });
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }

  const onLayerTransform = useCallback(
    (id: string, patch: Partial<MontageTransform>, final: boolean) =>
      liveOrCommit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? setTransformAt(l, Math.max(0, time - l.start), patch) : l)) }), final),
    [liveOrCommit, time]
  );
  const onTextMove = useCallback(
    (id: string, x: number, y: number, final: boolean) =>
      liveOrCommit((p) => ({ ...p, texts: p.texts.map((t) => (t.id === id ? { ...t, x: round3(x), y: round3(y) } : t)) }), final),
    [liveOrCommit]
  );

  // ---------- клавиши ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (exporting || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      const fps = project.canvas.fps;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === "s" || e.key === "ы") {
        e.preventDefault();
        split();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (wordSel) void cutSelectedWords();
        else remove();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "я")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "н")) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "в")) {
        e.preventDefault();
        duplicate();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTime((t) => Math.max(0, t - (e.shiftKey ? 1 : 1 / fps)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setTime((t) => Math.min(duration, t + (e.shiftKey ? 1 : 1 / fps)));
      } else if (e.key === "Home") {
        setTime(0);
      } else if (e.key === "End") {
        setTime(duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ctx: EditorCtx = {
    project, options, scheme, time, duration, selection, setSelection, commit,
    notify: setNotice, fail, busy, setBusy, transcripts, sources, transcribeSources,
    bin, addToBin, place, cleanup, design, applyDesign,
    setCaptions: (patch: Partial<MontageCaptions>) => commit((p) => ({ ...p, captions: { ...p.captions, ...patch } })),
    seek: setTime,
  };

  const selClip = selection?.kind === "clip" ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selText = selection?.kind === "text" ? project.texts.find((t) => t.id === selection.id) : undefined;
  const selAudio = selection?.kind === "audio" ? project.audio.find((a) => a.id === selection.id) : undefined;
  const selLayer = selection?.kind === "layer" ? project.layers.find((l) => l.id === selection.id) : undefined;
  /**
   * Брошено из панели. Эффект — добавляется к куску/слою, фильтр — заменяет
   * фильтр, переход — встаёт на стык перед куском; файл — ложится на ту
   * дорожку и в тот момент, куда его бросили (как в CapCut).
   */
  const onDropItem = useCallback(
    (data: DragPayload, at: DropTarget) => {
      if (data.type === "media") {
        if (!("lane" in at)) return;
        const item: BinItem = { path: data.path, kind: data.kind, duration: data.duration };
        if (!bin.some((b) => b.path === item.path)) addToBin([item]);
        crumb(`брошен файл на ${at.lane}`);
        if (at.lane === "music" || at.lane === "sfx") {
          if (item.kind !== "audio" && item.kind !== "video") return;
          const a = newAudio(item.path, at.lane, at.time, item.duration || (at.lane === "music" ? 30 : 1));
          commit((p) => ({ ...p, audio: [...p.audio, a] }));
          setSelection({ kind: "audio", id: a.id });
          return;
        }
        if (item.kind === "audio") {
          setNotice("Звук — на дорожку музыки или звуков внизу.");
          return;
        }
        if (at.lane === "layer") {
          const l = { ...newLayer(item.path, item.kind, item.duration, at.time), track: at.track || 1 };
          commit((p) => ({ ...p, layers: [...p.layers, l] }));
          setSelection({ kind: "layer", id: l.id });
          setNotice("Видео легло поверх главного. Размер и место — мышью в кадре или справа; раскладки экрана — справа, в «Раскладка».");
          return;
        }
        const c = newClip(item.path, item.kind, item.duration);
        commit((p) => {
          const { items } = layout(p.clips);
          const i = items.findIndex((it) => at.time < it.start + it.duration / 2);
          const idx = i < 0 ? p.clips.length : i;
          return { ...p, clips: [...p.clips.slice(0, idx), c, ...p.clips.slice(idx)] };
        });
        setSelection({ kind: "clip", id: c.id });
        return;
      }
      if (!("kind" in at)) return;
      crumb(`брошен ${data.type} ${data.id}`);
      if (data.type === "transition") {
        const i = project.clips.findIndex((c) => c.id === at.id);
        if (i <= 0) {
          setNotice("Переход ставится на стык: бросьте его на второй и следующие куски.");
          return;
        }
        commit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === at.id ? { ...c, transition: { kind: data.id, duration: c.transition.duration || 0.4 } } : c)) }));
        setNotice(`Переход «${data.name || data.id}» — на стык перед куском ${i + 1}.`);
        return;
      }
      const patchItem = <T extends { effects: MontageClip["effects"]; adjust: MontageClip["adjust"] }>(x: T): T =>
        data.type === "effect" ? { ...x, effects: [...x.effects, { id: uid("fx"), kind: data.id, amount: 0.5 }] } : { ...x, adjust: { ...x.adjust, filter: data.id, filterAmount: x.adjust.filterAmount || 1 } };
      commit((p) =>
        at.kind === "clip"
          ? { ...p, clips: p.clips.map((c) => (c.id === at.id ? patchItem(c) : c)) }
          : { ...p, layers: p.layers.map((l) => (l.id === at.id ? patchItem(l) : l)) }
      );
      setSelection({ kind: at.kind, id: at.id });
      setNotice(`${data.type === "effect" ? "Эффект" : "Фильтр"} «${data.name || data.id}» применён. Сила — справа.`);
    },
    // crumb — простая функция без состояния.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bin, addToBin, commit, project.clips]
  );

  const onSeek = useCallback(
    (t: number) => {
      setPlaying(false);
      setTime(t);
    },
    [setTime]
  );
  const proxyPending = Object.values(proxyProgress);

  return (
    <div className="mt-editor">
      <div className="mt-topbar">
        {projectsButton}
        <input className="mt-title" value={project.title} onChange={(e) => setProject((p) => ({ ...p, title: e.target.value }))} />
        <select
          value={project.canvas.preset}
          onChange={(e) => {
            const pr = options.presets.find((x) => x.id === e.target.value)!;
            commit((p) => ({ ...p, canvas: { ...p.canvas, preset: pr.id, width: pr.width, height: pr.height } }));
          }}
          title="Формат кадра"
        >
          {options.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={project.canvas.fit} onChange={(e) => commit((p) => ({ ...p, canvas: { ...p.canvas, fit: e.target.value } }))} title="Как исходник встаёт в кадр">
          {options.fits.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="mt-spacer" />
        {proxyPending.length > 0 && (
          <span className="mt-dim" title="Тяжёлые исходники показываются лёгкой копией — так длинное видео не тормозит. Собирается всё из оригинала.">
            ⚡ Готовлю для плавного показа: {Math.round((proxyPending.reduce((a, b) => a + b, 0) / proxyPending.length) * 100)}%
          </span>
        )}
        <button className="btn btn-secondary" disabled={!hist.past.length} onClick={undo} title="Отменить (Ctrl+Z)">↶</button>
        <button className="btn btn-secondary" disabled={!hist.future.length} onClick={redo} title="Вернуть (Ctrl+Shift+Z)">↷</button>
        <button className="btn btn-primary" onClick={async () => {
          const problems = await window.api.montageValidate(project);
          if (problems.length) return setError(problems.join("\n"));
          setPlaying(false);
          setExporting(true);
        }}>⬇ Экспорт</button>
        {settingsButton}
      </div>

      {(error || notice || busy) && (
        <div className="mt-status">
          {busy && <span>{busy}</span>}
          {notice && <span>{notice} <button className="link-btn" onClick={() => setNotice("")}>×</button></span>}
          {error && <span className="mt-error-inline">{error} <button className="link-btn" onClick={() => setError(null)}>×</button></span>}
        </div>
      )}

      <div className={`mt-work ${WIDE.includes(tab) ? "wide" : ""}`}>
        <nav className="mt-rail">
          {LEFT_TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} title={t.label}>
              <b>{t.icon}</b>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <aside className="mt-left">
          <div className="mt-left-body">
            {tab === "media" && <MediaPanel ctx={ctx} />}
            {tab === "motion" && <MotionPanel ctx={ctx} config={config} onConfig={onConfig} />}
            {tab === "titles" && <TitlesPanel ctx={ctx} config={config} />}
            {tab === "layout" && <LayoutPanel ctx={ctx} />}
            {tab === "agent" && (agentPanel || <p className="mt-hint">ИИ-монтажёр доступен в программе «Монтаж».</p>)}
            {tab === "avatar" && (avatarPanel || <p className="mt-hint">Аватар доступен в программе «Монтаж».</p>)}
            {tab === "stock" && <StockPanel ctx={ctx} />}
            {tab === "audio" && <AudioPanel ctx={ctx} />}
            {tab === "text" && <TextPanel ctx={ctx} />}
            {tab === "captions" && <CaptionsPanel ctx={ctx} />}
            {tab === "effects" && <EffectsPanel ctx={ctx} />}
            {tab === "filters" && <FiltersPanel ctx={ctx} />}
            {tab === "transitions" && <TransitionsPanel ctx={ctx} />}
            {tab === "design" && <DesignPanel ctx={ctx} />}
            {tab === "ai" && <AIPanel ctx={ctx} onMotion={motion} />}
          </div>
        </aside>

        <section className="mt-center">
          <div className="mt-preview-wrap">
            <MontagePreview
              project={project}
              scheme={scheme}
              options={options}
              playhead={playhead}
              proxies={proxies}
              playing={playing}
              words={words}
              selection={selection}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
              onSelect={setSelection}
              onLayerTransform={onLayerTransform}
              onTextMove={onTextMove}
              onDropItem={(data) => {
                // В кадр: эффект — на выбранный слой или кусок под бегунком; файл — слоем поверх.
                if (data.type === "media") {
                  let track = 1;
                  while (track < 8 && project.layers.some((l) => l.track === track && l.start <= time && l.start + layerDuration(l) > time)) track++;
                  onDropItem(data, { lane: "layer", time, track });
                  return;
                }
                if (selection?.kind === "layer" && data.type !== "transition") return onDropItem(data, { kind: "layer", id: selection.id });
                const hit = outputToSource(project.clips, time);
                if (hit) onDropItem(data, { kind: "clip", id: hit.clip.id });
              }}
            />
          </div>
          <div className="mt-transport">
            <button className="btn btn-secondary" onClick={() => setTime(0)} title="В начало (Home)">⏮</button>
            <button className="btn btn-primary mt-play" onClick={() => setPlaying((v) => !v)} title="Пробел">{playing ? "⏸" : "▶"}</button>
            <Clock playhead={playhead} duration={duration} />
            <span className="mt-dim">{project.canvas.width}×{project.canvas.height}</span>
          </div>
        </section>

        <aside className="mt-right">
          {selClip?.kind === "motion" && <MotionInspector key={selClip.id} ctx={ctx} item={selClip} layer={false} />}
          {selLayer?.kind === "motion" && <MotionInspector key={selLayer.id} ctx={ctx} item={selLayer} layer />}
          {selClip && <ClipInspector ctx={ctx} clip={selClip} />}
          {selLayer && <LayerInspector ctx={ctx} layer={selLayer} seek={(t) => setTime(t)} />}
          {selText && <TextInspector ctx={ctx} text={selText} />}
          {selAudio && <AudioInspector ctx={ctx} audio={selAudio} />}
          {!selection && (
            <div className="mt-transcript">
              <h4>Текст ролика</h4>
              {!words.length && (
                <p className="mt-hint">
                  {sources.length ? "Записи не расшифрованы — вкладка «Чистка» слева, и здесь можно будет резать по тексту." : "Выберите кусок, слой, надпись или звук — здесь появятся их настройки."}
                </p>
              )}
              {words.length > 0 && <p className="mt-hint">Щелчок — перейти к слову. Shift+щелчок — выделить кусок, Delete — вырезать его из ролика.</p>}
              {wordSel && (
                <div className="mt-row">
                  <button className="btn btn-danger" onClick={cutSelectedWords}>✂ Вырезать выделенное</button>
                  <button className="link-btn" onClick={() => setWordSel(null)}>снять</button>
                </div>
              )}
              <WordList words={words} transcripts={transcripts} wordSel={wordSel} setWordSel={setWordSel} seek={setTime} playhead={playhead} />
            </div>
          )}
        </aside>
      </div>

      <div className="mt-toolbar">
        <button className="btn btn-secondary" onClick={split} title="Разрезать под бегунком (S)">✂ Разрезать</button>
        <button className="btn btn-secondary" disabled={!selection} onClick={remove} title="Удалить (Delete)">🗑 Удалить</button>
        <button className="btn btn-secondary" disabled={!selection} onClick={duplicate} title="Копия (Ctrl+D)">⧉ Копия</button>
        <button className="btn btn-secondary" onClick={() => { setTab("text"); }}>+ Текст</button>
        <button className="btn btn-secondary" onClick={async () => {
          const f = await window.api.montagePickFile("overlay");
          if (!f) return;
          const probe = await window.api.montageProbe(f).catch(() => null);
          const item: BinItem = { path: f, kind: /\.(png|jpe?g|webp|gif)$/i.test(f) ? "image" : "video", duration: probe?.duration || 3 };
          addToBin([item]);
          place(item, "layer");
        }} title="Картинка в картинке, стикер, логотип, перебивка">▣ Слой</button>
        <button className="btn btn-secondary" disabled={!!busy || !project.clips.length} onClick={() => cleanup(false)} title="Убрать паузы, «э-э», паразиты и запинки">🧹 Почистить</button>
        <div className="mt-spacer" />
        <span className="mt-dim">Масштаб</span>
        <input type="range" min={3} max={200} value={pps} onChange={(e) => setPps(Number(e.target.value))} />
      </div>

      <MontageTimeline
        project={project}
        playhead={playhead}
        scheme={scheme}
        pps={pps}
        selection={selection}
        words={words}
        sourceDurations={durations}
        onSeek={onSeek}
        onSelect={setSelection}
        onLive={onLive}
        onCommit={onCommit}
        onDropItem={onDropItem}
      />

      {exporting && <MontageExport options={options} project={project} onClose={() => setExporting(false)} onDone={() => setNotice("Экспорт готов — файлы в папке готовых роликов.")} />}
    </div>
  );
}
