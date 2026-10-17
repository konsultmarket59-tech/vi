import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MontageAudio,
  MontageClip,
  MontageCleanupStats,
  MontageConfig,
  MontageOptions,
  MontageProject,
  MontageText,
  MontageTranscript,
  StoriesDesign,
  StoriesHandoff,
} from "../lib/types";
import {
  clamp,
  fileName,
  fmtTime,
  layout,
  newClip,
  newText,
  outputToSource,
  outputWords,
  projectDuration,
  round3,
  splitAt,
  uid,
} from "../lib/montage";
import MontagePreview from "./MontagePreview";
import MontageTimeline, { type Selection } from "./MontageTimeline";

interface Props {
  options: MontageOptions;
  config: MontageConfig;
  initial: MontageProject;
  onSaved: () => void;
  onClose: () => void;
  onMotionDesign: (handoff: Omit<StoriesHandoff, "nonce">) => void;
}

type BinItem = { path: string; kind: string; duration: number };
type LeftTab = "media" | "text" | "captions" | "audio" | "design" | "ai";

const LEFT_TABS: { id: LeftTab; label: string }[] = [
  { id: "media", label: "Медиа" },
  { id: "text", label: "Текст" },
  { id: "captions", label: "Субтитры" },
  { id: "audio", label: "Звук" },
  { id: "design", label: "Дизайн" },
  { id: "ai", label: "ИИ" },
];

const HISTORY_LIMIT = 80;

export default function MontageEditor({ options, config, initial, onSaved, onClose, onMotionDesign }: Props) {
  // История правок одним состоянием: настоящее, прошлое и будущее меняются
  // вместе, иначе отмена и новая правка могут разойтись на один шаг.
  const [hist, setHist] = useState<{ past: MontageProject[]; present: MontageProject; future: MontageProject[] }>({ past: [], present: initial, future: [] });
  const project = hist.present;
  const past = hist.past;
  const future = hist.future;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [pps, setPps] = useState(40);
  const [tab, setTab] = useState<LeftTab>("media");
  const [transcripts, setTranscripts] = useState<Record<string, MontageTranscript>>({});
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [render, setRender] = useState<{ stage: string; progress?: number } | null>(null);
  const [result, setResult] = useState<string>("");
  const [design, setDesign] = useState<StoriesDesign | null>(null);
  const [stats, setStats] = useState<MontageCleanupStats | null>(null);
  const [wordSel, setWordSel] = useState<{ from: number; to: number } | null>(null);

  const scheme = options.scheme;
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

  /** Правка без записи в историю — название проекта, кадры перетаскивания. */
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

  const sources = useMemo(() => [...new Set(project.clips.map((c) => c.src))], [project.clips]);
  const refreshTranscripts = useCallback(async () => {
    setTranscripts(await window.api.montageTranscripts(sources));
  }, [sources]);
  useEffect(() => {
    void refreshTranscripts();
  }, [refreshTranscripts]);

  useEffect(() => {
    const need = [...new Set([...sources, ...project.audio.map((a) => a.src), ...bin.map((b) => b.path)])].filter((s) => durations[s] === undefined);
    if (!need.length) return;
    (async () => {
      const found: Record<string, number> = {};
      for (const s of need) found[s] = (await window.api.montageProbe(s).catch(() => ({ duration: 0 }))).duration || 0;
      setDurations((d) => ({ ...d, ...found }));
    })();
  }, [sources, project.audio, bin, durations]);

  useEffect(() => {
    if (!project.design?.dir) return setDesign(null);
    window.api.montageReadDesign(project.design.dir).then(setDesign).catch(() => setDesign(null));
  }, [project.design?.dir]);

  const words = useMemo(() => outputWords(project.clips, transcripts), [project.clips, transcripts]);
  const duration = projectDuration(project);

  useEffect(() => window.api.onMontageRender((p) => setRender({ stage: p.stage, progress: p.progress })), []);

  // ---------- выбранное ----------

  const selClip = selection?.kind === "clip" ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selText = selection?.kind === "text" ? project.texts.find((t) => t.id === selection.id) : undefined;
  const selAudio = selection?.kind === "audio" ? project.audio.find((a) => a.id === selection.id) : undefined;

  const patchClip = (id: string, patch: Partial<MontageClip>) => commit((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const patchText = (id: string, patch: Partial<MontageText>) => commit((p) => ({ ...p, texts: p.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  const patchAudio = (id: string, patch: Partial<MontageAudio>) => commit((p) => ({ ...p, audio: p.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  // ---------- действия ----------

  const split = useCallback(() => {
    commit((p) => ({ ...p, clips: splitAt(p.clips, time) }));
  }, [commit, time]);

  const remove = useCallback(() => {
    if (!selection) return;
    commit((p) => ({
      ...p,
      clips: selection.kind === "clip" ? p.clips.filter((c) => c.id !== selection.id) : p.clips,
      texts: selection.kind === "text" ? p.texts.filter((t) => t.id !== selection.id) : p.texts,
      audio: selection.kind === "audio" ? p.audio.filter((a) => a.id !== selection.id) : p.audio,
    }));
    setSelection(null);
  }, [commit, selection]);

  const duplicate = () => {
    if (!selection) return;
    commit((p) => {
      if (selection.kind === "clip") {
        const i = p.clips.findIndex((c) => c.id === selection.id);
        if (i < 0) return p;
        const copy = { ...p.clips[i], id: uid("clip") };
        return { ...p, clips: [...p.clips.slice(0, i + 1), copy, ...p.clips.slice(i + 1)] };
      }
      if (selection.kind === "text") {
        const t = p.texts.find((x) => x.id === selection.id);
        if (!t) return p;
        const len = t.end - t.start;
        return { ...p, texts: [...p.texts, { ...t, id: uid("text"), start: t.end, end: round3(t.end + len) }] };
      }
      return p;
    });
  };

  async function importMedia() {
    const picked = await window.api.montagePickMedia();
    if (!picked.length) return;
    const items: BinItem[] = [];
    for (const p of picked) {
      const probe = await window.api.montageProbe(p).catch(() => null);
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(p) ? "image" : probe && !probe.hasVideo ? "audio" : "video";
      items.push({ path: p, kind, duration: probe?.duration || 0 });
    }
    commit((pr) => {
      const existing = ((pr.meta as { bin?: BinItem[] }).bin || []).filter((b) => !picked.includes(b.path));
      return { ...pr, meta: { ...pr.meta, bin: [...existing, ...items] } as MontageProject["meta"] };
    });
  }

  /** Медиа из корзины — на дорожку: видео и картинки в конец ролика, звук — под бегунок. */
  function addToTimeline(item: BinItem) {
    if (item.kind === "audio") {
      const a: MontageAudio = {
        id: uid("audio"), src: item.path, start: round3(time), in: 0,
        out: round3(Math.max(1, Math.min(item.duration || 30, Math.max(5, duration - time) || 30))),
        volume: 0.25, fadeIn: 0.5, fadeOut: 1.5, duck: true, loop: false,
      };
      commit((p) => ({ ...p, audio: [...p.audio, a] }));
      setSelection({ kind: "audio", id: a.id });
      return;
    }
    const c = newClip(item.path, item.kind, item.duration);
    commit((p) => {
      // Вставка в точку бегунка: если бегунок внутри куска — после этого куска.
      const hit = outputToSource(p.clips, time);
      const at = hit && time < duration - 0.05 ? hit.index + 1 : p.clips.length;
      return { ...p, clips: [...p.clips.slice(0, at), c, ...p.clips.slice(at)] };
    });
    setSelection({ kind: "clip", id: c.id });
  }

  function addText(style: string, text: string) {
    const t = { ...newText(time, text, style), animation: style === "hook" ? "pop" : style === "lower" ? "slide" : "pop" };
    commit((p) => ({ ...p, texts: [...p.texts, t] }));
    setSelection({ kind: "text", id: t.id });
  }

  async function transcribeSources() {
    setBusy("Расшифровываю записи…");
    setError(null);
    try {
      const r = await window.api.montageTranscribe(sources.filter((s) => !transcripts[s]));
      if (r.failed.length) setError(r.failed.map((f) => `${fileName(f.path)}: ${f.error}`).join("\n"));
      await refreshTranscripts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function cleanup(onlySelected: boolean) {
    setBusy("Убираю паузы и паразиты…");
    setError(null);
    try {
      const r = await window.api.montageClean({ clips: project.clips, ids: onlySelected && selClip ? [selClip.id] : undefined });
      if (!r.touched) setNotice("Чистить нечего: у кусков нет расшифровки или в них нет речи.");
      else {
        const before = layout(project.clips).duration;
        const after = layout(r.clips).duration;
        setNotice(`Убрано ${fmtTime(before - after, true)}: было ${fmtTime(before)}, стало ${fmtTime(after)}.`);
        commit((p) => ({ ...p, clips: r.clips }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (tab !== "ai" || !project.clips.length) return;
    window.api.montageCleanupStats({ clips: project.clips }).then(setStats).catch(() => setStats(null));
  }, [tab, project.clips, transcripts]);

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

  async function exportVideo() {
    setError(null);
    setResult("");
    const problems = await window.api.montageValidate(project);
    if (problems.length) return setError(problems.join("\n"));
    setPlaying(false);
    setRender({ stage: "pieces", progress: 0 });
    try {
      const r = await window.api.montageRender(project);
      setResult(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRender(null);
    }
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

  // ---------- клавиши ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
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
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setTime((t) => Math.max(0, t - (e.shiftKey ? 1 : 1 / fps)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setTime((t) => Math.min(duration, t + (e.shiftKey ? 1 : 1 / fps)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const currentWord = words.findIndex((w) => time >= w.s && time < w.e);
  const preset = options.presets.find((p) => p.id === project.canvas.preset);

  return (
    <div className="mt-editor">
      <div className="mt-topbar">
        <button className="link-btn" onClick={onClose}>← Проекты</button>
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
        <button className="btn btn-secondary" disabled={!past.length} onClick={undo} title="Отменить (Ctrl+Z)">↶</button>
        <button className="btn btn-secondary" disabled={!future.length} onClick={redo} title="Вернуть (Ctrl+Shift+Z)">↷</button>
        <button className="btn btn-primary" disabled={!!render} onClick={exportVideo}>⬇ Экспорт</button>
      </div>

      {(error || notice || busy || render || result) && (
        <div className="mt-status">
          {busy && <span>{busy}</span>}
          {render && (
            <span>
              Сборка: {render.stage === "pieces" ? "куски" : render.stage === "join" ? "склейка" : render.stage === "encode" ? "кодирование" : render.stage}
              {render.progress !== undefined ? ` ${Math.round(render.progress * 100)}%` : ""}
              <button className="link-btn" onClick={() => window.api.montageStop()}>остановить</button>
            </span>
          )}
          {result && (
            <span className="mt-ok">
              Готово: {fileName(result)}
              <button className="link-btn" onClick={() => window.api.montageShowItem(result)}>показать в папке</button>
              <button className="link-btn" onClick={() => window.api.montageOpenPath(result)}>открыть</button>
              <button
                className="link-btn"
                onClick={() =>
                  onMotionDesign({
                    sourcePath: result,
                    text: words.map((w) => w.w).join(" "),
                    designDir: project.design?.dir || config.designDir || undefined,
                    preset: project.canvas.preset,
                    title: project.title,
                  })
                }
              >
                ✨ моушн-дизайн поверх →
              </button>
            </span>
          )}
          {notice && <span>{notice} <button className="link-btn" onClick={() => setNotice("")}>×</button></span>}
          {error && <span className="mt-error-inline">{error} <button className="link-btn" onClick={() => setError(null)}>×</button></span>}
        </div>
      )}

      <div className="mt-work">
        <aside className="mt-left">
          <div className="mt-tabs small">
            {LEFT_TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div className="mt-left-body">
            {tab === "media" && (
              <>
                <button className="btn btn-secondary btn-block" onClick={importMedia}>+ Импорт файлов</button>
                {!bin.length && <p className="mt-hint">Видео, картинки и музыка этого проекта. Нажмите на файл — он встанет на дорожку.</p>}
                <div className="mt-bin">
                  {bin.map((b) => (
                    <BinCard key={b.path} item={b} onAdd={() => addToTimeline(b)} onRemove={() => commit((p) => ({ ...p, meta: { ...p.meta, bin: bin.filter((x) => x.path !== b.path) } as MontageProject["meta"] }))} />
                  ))}
                </div>
              </>
            )}

            {tab === "text" && (
              <>
                <p className="mt-hint">Надпись встаёт под бегунок. Стиль, цвет и анимация — справа, когда надпись выбрана.</p>
                {options.textStyles.map((s) => (
                  <button key={s.id} className={`mt-text-preset s-${s.id}`} onClick={() => addText(s.id, s.id === "hook" ? "Хук ролика" : s.id === "lower" ? "Имя · должность" : s.name)}>
                    {s.name}
                  </button>
                ))}
              </>
            )}

            {tab === "captions" && (
              <CaptionsPanel project={project} options={options} commit={commit} transcribed={sources.filter((s) => transcripts[s]).length} total={sources.length} onTranscribe={transcribeSources} busy={!!busy} />
            )}

            {tab === "audio" && (
              <>
                <label className="mt-check">
                  <input type="checkbox" checked={project.audioFx.loudnorm} onChange={(e) => commit((p) => ({ ...p, audioFx: { ...p.audioFx, loudnorm: e.target.checked } }))} />
                  Громкость под соцсети (−14 LUFS)
                </label>
                <label className="mt-check">
                  <input type="checkbox" checked={project.audioFx.denoise} onChange={(e) => commit((p) => ({ ...p, audioFx: { ...p.audioFx, denoise: e.target.checked } }))} />
                  Убрать шум (гул, шипение)
                </label>
                <button
                  className="btn btn-secondary btn-block"
                  onClick={async () => {
                    const f = await window.api.montagePickFile("audio");
                    if (!f) return;
                    const d = (await window.api.montageProbe(f).catch(() => ({ duration: 30 }))).duration || 30;
                    addToTimeline({ path: f, kind: "audio", duration: d });
                  }}
                >
                  + Музыка
                </button>
                <p className="mt-hint">Музыка сама приседает, пока звучит голос, — снимите галочку у дорожки, если не нужно.</p>
              </>
            )}

            {tab === "design" && (
              <>
                <button
                  className="btn btn-secondary btn-block"
                  onClick={async () => {
                    const dir = await window.api.montagePickFolder("Папка дизайн-системы");
                    if (dir) commit((p) => ({ ...p, design: { dir } }));
                  }}
                >
                  {project.design ? "Сменить дизайн-систему" : "Подключить дизайн-систему"}
                </button>
                {design && (
                  <>
                    <div className="mt-swatches">
                      {design.colours.slice(0, 12).map((c) => (
                        <span key={c} style={{ background: c }} title={`${c} — нажмите, чтобы сделать акцентом субтитров`} onClick={() => commit((p) => ({ ...p, captions: { ...p.captions, highlight: c } }))} />
                      ))}
                    </div>
                    <p className="mt-hint">
                      {design.fontFiles.length ? `Шрифты: ${design.fontFiles.map((f) => f.family).join(", ")}` : "Файлов шрифтов в системе нет."}
                      {design.logoFiles?.length ? ` Логотипы: ${design.logoFiles.map((l) => l.name).join(", ")}.` : ""}
                    </p>
                    <button className="btn btn-primary btn-block" onClick={() => applyDesign(design)}>Применить к ролику</button>
                  </>
                )}
                <h4>Логотип</h4>
                <div className="mt-row">
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      const f = await window.api.montagePickFile("image");
                      if (f) commit((p) => ({ ...p, logo: { path: f, corner: p.logo?.corner || "top-right", size: p.logo?.size || 0.14, opacity: 1 } }));
                    }}
                  >
                    {project.logo ? "Другой файл" : "Выбрать файл"}
                  </button>
                  {project.logo && <button className="link-btn" onClick={() => commit((p) => ({ ...p, logo: null }))}>убрать</button>}
                </div>
                {project.logo && (
                  <>
                    <Field label="Угол">
                      <select value={project.logo.corner} onChange={(e) => commit((p) => ({ ...p, logo: { ...p.logo!, corner: e.target.value } }))}>
                        <option value="top-left">сверху слева</option>
                        <option value="top-right">сверху справа</option>
                        <option value="bottom-left">снизу слева</option>
                        <option value="bottom-right">снизу справа</option>
                      </select>
                    </Field>
                    <Slider label="Размер" value={project.logo.size} min={0.04} max={0.4} step={0.01} fmt={(v) => `${Math.round(v * 100)}% ширины`} onChange={(v) => commit((p) => ({ ...p, logo: { ...p.logo!, size: v } }))} />
                    <Slider label="Непрозрачность" value={project.logo.opacity} min={0.1} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => commit((p) => ({ ...p, logo: { ...p.logo!, opacity: v } }))} />
                  </>
                )}
              </>
            )}

            {tab === "ai" && (
              <>
                <h4>Паузы и паразиты</h4>
                {stats && (
                  <p className="mt-hint">
                    Сейчас {fmtTime(stats.before)} → станет {fmtTime(stats.after)}. Звуков «э-э»: {stats.removedSounds}, паразитов: {stats.removedWords}, запинок: {stats.removedRepeats}.
                    {stats.untranscribed ? ` Без расшифровки кусков: ${stats.untranscribed} — их чистка не тронет.` : ""}
                  </p>
                )}
                {sources.some((s) => !transcripts[s]) && (
                  <button className="btn btn-secondary btn-block" disabled={!!busy} onClick={transcribeSources}>Расшифровать записи проекта</button>
                )}
                <button className="btn btn-primary btn-block" disabled={!!busy} onClick={() => cleanup(false)}>🧹 Почистить весь ролик</button>
                <button className="btn btn-secondary btn-block" disabled={!!busy || !selClip} onClick={() => cleanup(true)}>Только выбранный кусок</button>
                <p className="mt-hint">
                  Режется по словам: «э-э» и «м-м» всегда, паузы — до короткого вдоха, запинки «я я», паразиты — по настройке во вкладке «ИИ-монтажёр».
                  Каждый второй кусок слегка приближается, чтобы рез не выглядел прыжком.
                </p>
                <h4>Моушн-дизайн</h4>
                <p className="mt-hint">
                  Соберите ролик (⬇ Экспорт) и нажмите «моушн-дизайн поверх» — он уйдёт в «Видео-сторис» вместе с текстом и дизайн-системой:
                  плашки, инфографика, иконки, сцены со швами.
                </p>
              </>
            )}
          </div>
        </aside>

        <section className="mt-center">
          <div className="mt-preview-wrap">
            <MontagePreview
              project={project}
              scheme={scheme}
              time={time}
              playing={playing}
              words={words}
              onTime={setTime}
              onEnded={() => setPlaying(false)}
            />
          </div>
          <div className="mt-transport">
            <button className="btn btn-secondary" onClick={() => setTime(0)} title="В начало">⏮</button>
            <button className="btn btn-primary mt-play" onClick={() => setPlaying((v) => !v)} title="Пробел">{playing ? "⏸" : "▶"}</button>
            <span className="mt-clock">{fmtTime(time, true)} / {fmtTime(duration, true)}</span>
            <span className="mt-dim">{preset ? `${project.canvas.width}×${project.canvas.height}` : ""}</span>
          </div>
        </section>

        <aside className="mt-right">
          {selClip && (
            <ClipInspector clip={selClip} options={options} srcDuration={durations[selClip.src] || 0} patch={(p) => patchClip(selClip.id, p)} transcribed={!!transcripts[selClip.src]} onClean={() => cleanup(true)} />
          )}
          {selText && <TextInspector text={selText} options={options} patch={(p) => patchText(selText.id, p)} />}
          {selAudio && <AudioInspector audio={selAudio} patch={(p) => patchAudio(selAudio.id, p)} />}
          {!selection && (
            <div className="mt-transcript">
              <h4>Текст ролика</h4>
              {!words.length && (
                <p className="mt-hint">
                  {sources.length ? "Записи не расшифрованы — расшифруйте во вкладке «ИИ» слева, и здесь можно будет резать по тексту." : "Пока пусто."}
                </p>
              )}
              {words.length > 0 && <p className="mt-hint">Щелчок — перейти к слову. Shift+щелчок — выделить кусок, Delete — вырезать его из ролика.</p>}
              {wordSel && (
                <div className="mt-row">
                  <button className="btn btn-danger" onClick={cutSelectedWords}>✂ Вырезать выделенное</button>
                  <button className="link-btn" onClick={() => setWordSel(null)}>снять</button>
                </div>
              )}
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
                          setTime(w.s + 0.001);
                        }
                      }}
                    >
                      {w.w}{" "}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="mt-toolbar">
        <button className="btn btn-secondary" onClick={split} title="Разрезать под бегунком (S)">✂ Разрезать</button>
        <button className="btn btn-secondary" disabled={!selection} onClick={remove} title="Удалить (Delete)">🗑 Удалить</button>
        <button className="btn btn-secondary" disabled={!selection || selection.kind === "audio"} onClick={duplicate}>⧉ Копия</button>
        <button className="btn btn-secondary" onClick={() => addText("title", "Текст")}>+ Текст</button>
        <button className="btn btn-secondary" disabled={!!busy || !project.clips.length} onClick={() => cleanup(false)} title="Убрать паузы, «э-э», паразиты и запинки">🧹 Почистить</button>
        <div className="mt-spacer" />
        <span className="mt-dim">Масштаб</span>
        <input type="range" min={3} max={200} value={pps} onChange={(e) => setPps(Number(e.target.value))} />
      </div>

      <MontageTimeline
        project={project}
        time={time}
        pps={pps}
        selection={selection}
        words={words}
        sourceDurations={durations}
        onSeek={(t) => {
          setPlaying(false);
          setTime(t);
        }}
        onSelect={setSelection}
        onLive={onLive}
        onCommit={onCommit}
      />
    </div>
  );
}

// ---------- мелкие части ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt?: (v: number) => string; onChange: (v: number) => void }) {
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

function NumberField({ label, value, step = 0.1, min, max, onChange }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
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

function BinCard({ item, onAdd, onRemove }: { item: BinItem; onAdd: () => void; onRemove: () => void }) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    if (item.kind === "audio") return;
    window.api.montageThumbs(item.path, { count: 1, height: 90 }).then(setThumb).catch(() => {});
  }, [item.path, item.kind]);
  return (
    <div className="mt-bin-card" onClick={onAdd} title={`${item.path}\nНажмите — добавить на дорожку`}>
      <div className="mt-bin-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        {item.kind === "audio" ? "♪" : !thumb ? "…" : ""}
        {item.duration > 0 && <i>{fmtTime(item.duration)}</i>}
      </div>
      <span>{fileName(item.path)}</span>
      <button
        className="mt-bin-x"
        title="Убрать из проекта (файл останется на диске)"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </button>
    </div>
  );
}

function CaptionsPanel({ project, options, commit, transcribed, total, onTranscribe, busy }: {
  project: MontageProject;
  options: MontageOptions;
  commit: (fn: (p: MontageProject) => MontageProject) => void;
  transcribed: number;
  total: number;
  onTranscribe: () => void;
  busy: boolean;
}) {
  const cap = project.captions;
  const set = (patch: Partial<MontageProject["captions"]>) => commit((p) => ({ ...p, captions: { ...p.captions, ...patch } }));
  return (
    <>
      <label className="mt-check">
        <input type="checkbox" checked={cap.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Субтитры по словам
      </label>
      {total > transcribed && (
        <>
          <p className="mt-hint">Расшифровано записей: {transcribed} из {total}. Субтитры берутся из расшифровки.</p>
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={onTranscribe}>Расшифровать</button>
        </>
      )}
      <div className="mt-cap-styles">
        {options.captionStyles.map((s) => (
          <button key={s.id} className={`mt-cap-style ${cap.style === s.id ? "on" : ""}`} onClick={() => set({ style: s.id, enabled: true })} title={s.hint}>
            <b className={`demo s-${s.id}`} style={{ ["--hl" as string]: cap.highlight }}>
              {s.id === "pop" ? "СЛОВО" : <>это <i>слово</i></>}
            </b>
            <small>{s.name}</small>
          </button>
        ))}
      </div>
      <Field label="Шрифт">
        <div className="mt-row">
          <button
            className="btn btn-secondary"
            onClick={async () => {
              const f = await window.api.montagePickFile("font");
              if (f) set({ fontPath: f, font: fileName(f).replace(/\.[^.]+$/, "") });
            }}
          >
            {cap.fontPath ? fileName(cap.fontPath) : "Файл шрифта…"}
          </button>
          {cap.fontPath && <button className="link-btn" onClick={() => set({ fontPath: "", font: "" })}>системный</button>}
        </div>
      </Field>
      <Slider label="Размер" value={cap.size} min={36} max={160} step={2} onChange={(v) => set({ size: v })} />
      <div className="mt-row">
        <Field label="Цвет"><input type="color" value={cap.color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Акцент"><input type="color" value={cap.highlight} onChange={(e) => set({ highlight: e.target.value })} /></Field>
        <Field label="Обводка"><input type="color" value={cap.outline} onChange={(e) => set({ outline: e.target.value })} /></Field>
      </div>
      <Field label="Где">
        <select value={cap.position} onChange={(e) => set({ position: e.target.value as MontageProject["captions"]["position"] })}>
          <option value="bottom">снизу</option>
          <option value="center">по центру</option>
          <option value="top">сверху</option>
        </select>
      </Field>
      <Slider label="Слов в строке" value={cap.wordsPerLine} min={1} max={8} step={1} onChange={(v) => set({ wordsPerLine: v })} />
      <label className="mt-check">
        <input type="checkbox" checked={cap.upper} onChange={(e) => set({ upper: e.target.checked })} />
        ЗАГЛАВНЫМИ
      </label>
    </>
  );
}

function ClipInspector({ clip, options, srcDuration, patch, transcribed, onClean }: {
  clip: MontageClip;
  options: MontageOptions;
  srcDuration: number;
  patch: (p: Partial<MontageClip>) => void;
  transcribed: boolean;
  onClean: () => void;
}) {
  return (
    <div className="mt-inspector">
      <h4 title={clip.src}>{clip.kind === "image" ? "🖼" : "🎬"} {fileName(clip.src)}</h4>
      <div className="mt-row">
        <NumberField label="С (сек исходника)" value={clip.in} min={0} max={clip.out - 0.05} onChange={(v) => patch({ in: v })} />
        <NumberField label="По" value={clip.out} min={clip.in + 0.05} max={srcDuration || undefined} onChange={(v) => patch({ out: v })} />
      </div>
      <Slider label="Скорость" value={clip.speed} min={0.25} max={4} step={0.05} fmt={(v) => `×${v}`} onChange={(v) => patch({ speed: v })} />
      {clip.kind !== "image" && (
        <>
          <Slider label="Громкость" value={clip.volume} min={0} max={3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
          <label className="mt-check">
            <input type="checkbox" checked={clip.muted} onChange={(e) => patch({ muted: e.target.checked })} /> Без звука
          </label>
        </>
      )}
      <div className="mt-row">
        <NumberField label="Появление, с" value={clip.fadeIn} min={0} max={5} onChange={(v) => patch({ fadeIn: v })} />
        <NumberField label="Затухание, с" value={clip.fadeOut} min={0} max={5} onChange={(v) => patch({ fadeOut: v })} />
      </div>
      <h4>Переход в этот кусок</h4>
      <div className="mt-row">
        <select value={clip.transition.kind} onChange={(e) => patch({ transition: { ...clip.transition, kind: e.target.value } })}>
          {options.transitions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {clip.transition.kind !== "none" && (
          <NumberField label="с" value={clip.transition.duration} min={0.1} max={2} onChange={(v) => patch({ transition: { ...clip.transition, duration: v } })} />
        )}
      </div>
      <h4>Кадр</h4>
      <Field label="Вписать">
        <select value={clip.fit} onChange={(e) => patch({ fit: e.target.value })}>
          <option value="">как у проекта</option>
          {options.fits.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </Field>
      <Slider label="Приближение" value={clip.zoom} min={1} max={2.5} step={0.02} fmt={(v) => `×${v.toFixed(2)}`} onChange={(v) => patch({ zoom: v })} />
      <Slider label="Центр по горизонтали" value={clip.focusX} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ focusX: v })} />
      <Slider label="Центр по вертикали" value={clip.focusY} min={0} max={1} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ focusY: v })} />
      <h4>Цвет</h4>
      <Field label="Фильтр">
        <select value={clip.adjust.filter} onChange={(e) => patch({ adjust: { ...clip.adjust, filter: e.target.value } })}>
          {options.filters.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </Field>
      <Slider label="Яркость" value={clip.adjust.brightness} min={-0.5} max={0.5} step={0.01} onChange={(v) => patch({ adjust: { ...clip.adjust, brightness: v } })} />
      <Slider label="Контраст" value={clip.adjust.contrast} min={0.5} max={2} step={0.01} onChange={(v) => patch({ adjust: { ...clip.adjust, contrast: v } })} />
      <Slider label="Насыщенность" value={clip.adjust.saturation} min={0} max={3} step={0.01} onChange={(v) => patch({ adjust: { ...clip.adjust, saturation: v } })} />
      {clip.kind === "video" && (
        <button className="btn btn-secondary btn-block" disabled={!transcribed} onClick={onClean} title={transcribed ? "" : "Сначала расшифруйте запись"}>
          🧹 Убрать паузы в этом куске
        </button>
      )}
    </div>
  );
}

function TextInspector({ text, options, patch }: { text: MontageText; options: MontageOptions; patch: (p: Partial<MontageText>) => void }) {
  const [draft, setDraft] = useState(text.text);
  useEffect(() => setDraft(text.text), [text.id, text.text]);
  return (
    <div className="mt-inspector">
      <h4>Надпись</h4>
      <textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== text.text && patch({ text: draft })} />
      <div className="mt-row">
        <NumberField label="С, сек" value={text.start} min={0} max={text.end - 0.1} onChange={(v) => patch({ start: v })} />
        <NumberField label="По" value={text.end} min={text.start + 0.1} onChange={(v) => patch({ end: v })} />
      </div>
      <Field label="Стиль">
        <select value={text.style} onChange={(e) => patch({ style: e.target.value })}>
          {options.textStyles.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Анимация">
        <select value={text.animation} onChange={(e) => patch({ animation: e.target.value })}>
          {options.textAnimations.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Где">
        <select value={text.position} onChange={(e) => patch({ position: e.target.value as MontageText["position"] })}>
          <option value="">по стилю</option>
          <option value="top">сверху</option>
          <option value="center">по центру</option>
          <option value="bottom">снизу</option>
        </select>
      </Field>
      <Slider label="Размер" value={text.size || 0} min={0} max={220} step={2} fmt={(v) => (v ? String(v) : "по стилю")} onChange={(v) => patch({ size: v })} />
      <div className="mt-row">
        <Field label="Цвет букв">
          <input type="color" value={text.color || "#ffffff"} onChange={(e) => patch({ color: e.target.value })} />
        </Field>
        <Field label="Подложка">
          <input type="color" value={text.bg || "#000000"} onChange={(e) => patch({ bg: e.target.value })} />
        </Field>
        {(text.color || text.bg) && <button className="link-btn" onClick={() => patch({ color: "", bg: "" })}>как в стиле</button>}
      </div>
      <label className="mt-check">
        <input type="checkbox" checked={text.upper} onChange={(e) => patch({ upper: e.target.checked })} /> ЗАГЛАВНЫМИ
      </label>
    </div>
  );
}

function AudioInspector({ audio, patch }: { audio: MontageAudio; patch: (p: Partial<MontageAudio>) => void }) {
  return (
    <div className="mt-inspector">
      <h4>♪ {fileName(audio.src)}</h4>
      <div className="mt-row">
        <NumberField label="Старт в ролике" value={audio.start} min={0} onChange={(v) => patch({ start: v })} />
        <NumberField label="С (в файле)" value={audio.in} min={0} max={audio.out - 0.2} onChange={(v) => patch({ in: v })} />
        <NumberField label="По" value={audio.out} min={audio.in + 0.2} onChange={(v) => patch({ out: v })} />
      </div>
      <Slider label="Громкость" value={audio.volume} min={0} max={2} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patch({ volume: v })} />
      <div className="mt-row">
        <NumberField label="Появление, с" value={audio.fadeIn} min={0} max={10} onChange={(v) => patch({ fadeIn: v })} />
        <NumberField label="Затухание, с" value={audio.fadeOut} min={0} max={10} onChange={(v) => patch({ fadeOut: v })} />
      </div>
      <label className="mt-check">
        <input type="checkbox" checked={audio.duck} onChange={(e) => patch({ duck: e.target.checked })} /> Приглушать под голос
      </label>
      <label className="mt-check">
        <input type="checkbox" checked={audio.loop} onChange={(e) => patch({ loop: e.target.checked })} /> Повторять по кругу
      </label>
    </div>
  );
}
