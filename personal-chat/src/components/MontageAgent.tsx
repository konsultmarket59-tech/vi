import { useEffect, useMemo, useState } from "react";
import type {
  Conversation,
  MontageConfig,
  MontageMediaFile,
  MontageOptions,
  MontagePlan,
  MontageProgress,
  Settings,
  Skill,
  StoriesDesign,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import { fileName, fmtTime } from "../lib/montage";
import ChatView from "./ChatView";

interface Props {
  options: MontageOptions;
  config: MontageConfig;
  onConfig: (patch: Partial<MontageConfig>) => Promise<void>;
  settings: Settings;
  skills: Skill[];
  onOpenProject: (id: string) => void;
  onProjectsChanged: () => void;
}

/**
 * Заготовки задания. Человек обычно хочет одно из немногих — дать кнопку
 * быстрее, чем ждать, пока он сформулирует.
 */
const GOALS = [
  "Сделай 3 клипа по 30–60 секунд для Reels и Клипов ВК: сильный хук в начале, законченная мысль, надписи по смыслу.",
  "Смонтируй запись целиком в один ролик: убери паузы, «э-э», слова-паразиты, оговорки и неудачные дубли.",
  "Найди 5 самых цепляющих моментов по 15–25 секунд — короткие хуки для Shorts.",
  "Сделай тизер на 30 секунд из лучших фраз, в начале — самая сильная.",
  "Сделай обучающий ролик на 2–3 минуты по главной теме записи, с заголовками разделов.",
];

const STAGE: Record<string, string> = {
  audio: "достаю звук",
  silence: "ищу паузы",
  model: "качаю модель распознавания",
  transcribe: "слушаю",
  remote: "отправил в сервис расшифровки",
  reused: "уже расшифровано",
  "file-done": "готово",
  "file-failed": "ошибка",
};

export default function MontageAgent({ options, config, onConfig, settings, skills, onOpenProject, onProjectsChanged }: Props) {
  const [files, setFiles] = useState<MontageMediaFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanInfo, setScanInfo] = useState("");
  const [progress, setProgress] = useState<MontageProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [design, setDesign] = useState<StoriesDesign | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [prefill, setPrefill] = useState<{ text: string; nonce: number; autoSend?: boolean } | undefined>();
  const [plan, setPlan] = useState<MontagePlan | null>(null);
  const [planPaths, setPlanPaths] = useState<string[]>([]);
  const [created, setCreated] = useState<{ id: string; title: string; duration?: number; problems: string[] }[]>([]);
  const [goal, setGoal] = useState(GOALS[0]);

  useEffect(() => window.api.onMontageProgress(setProgress), []);

  useEffect(() => {
    void rescan(config.sources);
    // Источники меняются только через этот же раздел — пересканируем по ним явно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!config.designDir) {
      setDesign(null);
      return;
    }
    window.api.montageReadDesign(config.designDir).then(setDesign).catch(() => setDesign(null));
  }, [config.designDir]);

  async function rescan(sources: string[]) {
    if (!sources.length) {
      setFiles([]);
      setScanInfo("");
      return;
    }
    try {
      const r = await window.api.montageScan(sources);
      setFiles(r.files);
      setScanInfo(
        r.files.length
          ? ""
          : `Просмотрено файлов: ${r.seen}. Видео, звука и картинок среди них нет.` + (r.missing.length ? ` Не открылось: ${r.missing.join(", ")}.` : "")
      );
      // Новые записи выбраны сразу — чаще всего ради них источник и добавляли.
      setSelected((prev) => (prev.size ? new Set([...prev].filter((p) => r.files.some((f) => f.path === p))) : new Set(r.files.filter((f) => f.kind === "video").map((f) => f.path))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addFolder() {
    const dir = await window.api.montagePickFolder("Папка с записями — на компьютере или на съёмном диске");
    if (!dir) return;
    const sources = [...new Set([...config.sources, dir])];
    await onConfig({ sources });
    await rescan(sources);
  }

  async function addFiles() {
    const picked = await window.api.montagePickMedia();
    if (!picked.length) return;
    const sources = [...new Set([...config.sources, ...picked])];
    await onConfig({ sources });
    await rescan(sources);
    setSelected((prev) => new Set([...prev, ...picked]));
  }

  async function removeSource(src: string) {
    const sources = config.sources.filter((s) => s !== src);
    await onConfig({ sources });
    await rescan(sources);
  }

  const chosen = useMemo(() => files.filter((f) => selected.has(f.path) && f.kind !== "image"), [files, selected]);
  const notTranscribed = chosen.filter((f) => !f.transcribed);

  async function transcribe(force = false) {
    setError(null);
    setBusy(true);
    try {
      const targets = force ? chosen : notTranscribed;
      const r = await window.api.montageTranscribe(targets.map((f) => f.path), { force });
      if (r.failed.length) setError(r.failed.map((f) => `${fileName(f.path)}: ${f.error}`).join("\n"));
      await rescan(config.sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  /** Открыть разговор: агент видит расшифровки выбранных записей и дизайн-систему. */
  async function startAgent(text?: string) {
    setError(null);
    if (!chosen.length) return setError("Выберите хотя бы одну запись.");
    if (notTranscribed.length) return setError(`Сначала расшифруйте: ${notTranscribed.map((f) => f.name).join(", ")}.`);
    setBusy(true);
    try {
      const prepared = await window.api.montagePrepareAgent({ paths: chosen.map((f) => f.path), designDir: config.designDir, preset: config.preset });
      if (!prepared.prompt) throw new Error("Расшифровок для выбранных записей не нашлось.");
      setSystemPrompt(prepared.prompt);
      setPlanPaths(chosen.map((f) => f.path));
      setPlan(null);
      setCreated([]);
      setConv({ id: uid(), projectId: "", title: "ИИ-монтажёр", messages: [], createdAt: Date.now(), updatedAt: Date.now() });
      setPrefill({ text: text || goal, nonce: Date.now(), autoSend: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAssistantMessage(content: string) {
    const parsed = await window.api.montageParsePlan(content).catch(() => null);
    if (parsed && parsed.clips.length) setPlan(parsed);
  }

  async function applyPlan() {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const result = await window.api.montageApplyPlan({ plan, paths: planPaths, preset: config.preset, designDir: config.designDir || undefined });
      setCreated(result);
      onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Без агента: каждая запись целиком — в свой проект, сразу почищенная.
   * Для случая «просто убери паузы и мычание», где спрашивать модель незачем.
   */
  async function quickClean() {
    setError(null);
    if (!chosen.length) return setError("Выберите записи.");
    if (notTranscribed.length) return setError(`Сначала расшифруйте: ${notTranscribed.map((f) => f.name).join(", ")}.`);
    setBusy(true);
    try {
      const out: typeof created = [];
      const preset = options.presets.find((p) => p.id === config.preset) || options.presets[0];
      for (const f of chosen) {
        const probe = await window.api.montageProbe(f.path);
        const base = await window.api.montageNormalize({
          title: `${f.name.replace(/\.[^.]+$/, "")} — чистовой`,
          canvas: { preset: preset.id, width: preset.width, height: preset.height, fps: 30, fit: "crop", background: "#000000" },
          clips: [{ src: f.path, kind: f.kind, in: 0, out: probe.duration } as never],
          captions: { ...config.captions, enabled: true },
          design: config.designDir ? { dir: config.designDir } : null,
          meta: { bin: [{ path: f.path, kind: f.kind, duration: probe.duration }] } as never,
        });
        const cleaned = await window.api.montageClean({ clips: base.clips });
        const saved = await window.api.montageSave({ ...base, clips: cleaned.clips });
        const before = probe.duration;
        const after = cleaned.clips.reduce((a, c) => a + (c.out - c.in), 0);
        out.push({ id: saved.id, title: saved.title, duration: after, problems: [`Было ${fmtTime(before)}, стало ${fmtTime(after)}: кусков ${cleaned.clips.length}.`] });
      }
      setCreated(out);
      onProjectsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function renderAll() {
    const ids = created.filter((c) => c.id).map((c) => c.id);
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    try {
      const results = await window.api.montageRenderMany(ids);
      const failed = results.filter((r) => r.error);
      if (failed.length) setError(failed.map((r) => r.error).join("\n"));
      const ok = results.find((r) => r.path);
      if (ok?.path) await window.api.montageShowItem(ok.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (p: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const progressLine =
    progress && progress.stage !== "done"
      ? `${progress.name || ""} — ${STAGE[progress.stage] || progress.stage}` +
        (progress.progress !== undefined && progress.stage !== "reused" ? ` ${Math.round((progress.progress || 0) * 100)}%` : "") +
        (progress.total ? ` · файл ${(progress.index || 0) + 1} из ${progress.total}` : "")
      : "";

  return (
    <div className="mt-agent">
      <div className="mt-agent-setup">
        <section className="mt-card">
          <h3>1. Откуда брать</h3>
          <p className="mt-hint">Папка на компьютере, на флешке или внешнем диске — или отдельные файлы. Ничего не копируется: записи читаются на месте.</p>
          <div className="mt-row">
            <button className="btn btn-secondary" onClick={addFolder}>📁 Папка или диск</button>
            <button className="btn btn-secondary" onClick={addFiles}>🎞 Файлы</button>
          </div>
          {config.sources.map((s) => (
            <div key={s} className="mt-source">
              <span title={s}>{s}</span>
              <button className="link-btn" onClick={() => removeSource(s)}>убрать</button>
            </div>
          ))}
          {scanInfo && <p className="mt-hint">{scanInfo}</p>}
          {files.length > 0 && (
            <div className="mt-files">
              {files.map((f) => (
                <label key={f.path} className={`mt-file ${f.kind}`}>
                  <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} disabled={f.kind === "image"} />
                  <span className="mt-file-name" title={f.path}>
                    {f.kind === "video" ? "🎬" : f.kind === "audio" ? "🎵" : "🖼"} {f.name}
                  </span>
                  <span className={`mt-badge ${f.transcribed ? "ok" : ""}`}>
                    {f.kind === "image" ? "картинка" : f.transcribed ? (f.wordLevel ? `✓ ${fmtTime(f.duration)}` : `✓ ${fmtTime(f.duration)} ~`) : "не расшифровано"}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="mt-card">
          <h3>2. Расшифровка по словам</h3>
          <p className="mt-hint">Агент режет по словам, поэтому записи сначала слушаются. Один раз: повторно не читаются, даже если файл переименовать.</p>
          <div className="mt-field">
            <span>Чем слушать</span>
            <select value={config.engine} onChange={(e) => onConfig({ engine: e.target.value as MontageConfig["engine"] })}>
              <option value="builtin">На этом компьютере — бесплатно, запись никуда не уходит</option>
              <option value="remote">Через сервис по ключу из настроек — быстрее, платно</option>
            </select>
          </div>
          {config.engine === "builtin" ? (
            <div className="mt-field">
              <span>Модель</span>
              <select value={config.speechModel} onChange={(e) => onConfig({ speechModel: e.target.value })}>
                {options.speechModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.size}
                  </option>
                ))}
              </select>
              <small>{options.speechModels.find((m) => m.id === config.speechModel)?.hint}</small>
            </div>
          ) : (
            <div className="mt-field">
              <span>Модель сервиса</span>
              <input value={config.remoteModel} onChange={(e) => onConfig({ remoteModel: e.target.value })} />
              <small>Адрес и ключ — из общих настроек ({settings.baseUrl}).</small>
            </div>
          )}
          <div className="mt-row">
            <button className="btn btn-primary" disabled={busy || !notTranscribed.length} onClick={() => transcribe(false)}>
              Расшифровать {notTranscribed.length ? `(${notTranscribed.length})` : ""}
            </button>
            <button className="btn btn-secondary" disabled={busy || !chosen.length} onClick={() => transcribe(true)} title="Заново, даже если уже расшифровано">
              Заново
            </button>
            {busy && progress && (
              <button className="btn btn-danger" onClick={() => window.api.montageStop()}>Стоп</button>
            )}
          </div>
          {progressLine && <div className="mt-progress">{progressLine}</div>}
        </section>

        <section className="mt-card">
          <h3>3. Стиль</h3>
          <div className="mt-field">
            <span>Формат</span>
            <select value={config.preset} onChange={(e) => onConfig({ preset: e.target.value })}>
              {options.presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-field">
            <span>Дизайн-система</span>
            <div className="mt-row">
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const dir = await window.api.montagePickFolder("Папка дизайн-системы");
                  if (dir) await onConfig({ designDir: dir });
                }}
              >
                {config.designDir ? "Сменить" : "Выбрать папку"}
              </button>
              {config.designDir && <button className="link-btn" onClick={() => onConfig({ designDir: "" })}>убрать</button>}
            </div>
            {design && (
              <div className="mt-design">
                <div className="mt-swatches">
                  {design.colours.slice(0, 10).map((c) => (
                    <span key={c} style={{ background: c }} title={c} />
                  ))}
                </div>
                <small>
                  {design.fontFiles.length ? `Шрифт: ${design.fontFiles[0].family}` : "Файлов шрифтов нет — субтитры будут системным шрифтом"}
                  {design.logoFiles?.length ? ` · логотип: ${design.logoFiles[0].name}` : ""}
                </small>
                {design.problem && <small className="mt-warn">{design.problem}</small>}
              </div>
            )}
          </div>
          <div className="mt-field">
            <span>Субтитры по умолчанию</span>
            <select value={config.captions.style} onChange={(e) => onConfig({ captions: { ...config.captions, style: e.target.value } })}>
              {options.captionStyles.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-field">
            <span>Слова-паразиты</span>
            <select
              value={config.cleanup.removeWords}
              onChange={(e) => onConfig({ cleanup: { ...config.cleanup, removeWords: e.target.value as MontageConfig["cleanup"]["removeWords"] } })}
            >
              <option value="safe">Резать безопасные («типа», «короче», «как бы»), остальные — по смыслу агентом</option>
              <option value="all">Резать все, включая «ну», «вот», «значит»</option>
              <option value="none">Не резать — только «э-э» и паузы</option>
            </select>
          </div>
        </section>
      </div>

      <div className="mt-agent-chat">
        <section className="mt-card">
          <h3>4. Задание монтажёру</h3>
          <div className="mt-goals">
            {GOALS.map((g) => (
              <button key={g} className={`mt-chip ${g === goal ? "on" : ""}`} onClick={() => setGoal(g)}>
                {g.split(":")[0].split(".")[0]}
              </button>
            ))}
          </div>
          <textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} />
          <div className="mt-row">
            <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => startAgent()}>
              🤖 Смонтировать с агентом
            </button>
            <button className="btn btn-secondary" disabled={busy || !chosen.length} onClick={quickClean} title="Без модели: каждая запись целиком, без пауз и «э-э»">
              Просто почистить
            </button>
          </div>
          {error && <div className="mt-error">{error}</div>}
        </section>

        {plan && (
          <section className="mt-card mt-plan">
            <h3>План монтажа — {plan.clips.length} {plan.clips.length === 1 ? "ролик" : "ролика(ов)"}</h3>
            {plan.clips.map((c, i) => (
              <div key={i} className="mt-plan-clip">
                <b>{c.name}</b>
                {c.hook && <div className="mt-hook">Хук: {c.hook}</div>}
                <small>
                  Кусков: {c.pieces.length} · вырезать по смыслу: {c.cut.length} · надписей: {c.texts.length} · субтитры: {c.captions}
                </small>
              </div>
            ))}
            <div className="mt-row">
              <button className="btn btn-primary" disabled={busy} onClick={applyPlan}>Разложить на таймлайн</button>
            </div>
          </section>
        )}

        {created.length > 0 && (
          <section className="mt-card">
            <h3>Готово к правке</h3>
            {created.map((c, i) => (
              <div key={c.id || i} className="mt-created">
                <div>
                  <b>{c.title}</b> {c.duration ? <small>· {fmtTime(c.duration)}</small> : null}
                  {c.problems.map((p, k) => (
                    <div key={k} className="mt-hint">{p}</div>
                  ))}
                </div>
                {c.id && <button className="btn btn-secondary" onClick={() => onOpenProject(c.id)}>Открыть в редакторе</button>}
              </div>
            ))}
            <div className="mt-row">
              <button className="btn btn-primary" disabled={busy} onClick={renderAll}>Собрать все в mp4</button>
            </div>
          </section>
        )}

        {conv && (
          <div className="mt-chat">
            <ChatView
              conversation={conv}
              systemPrompt={systemPrompt}
              settings={settings}
              skills={skills}
              onUpdate={setConv}
              onSave={async () => {}}
              prefill={prefill}
              emptyHint="Агент видит расшифровки выбранных записей. Скажите, какие ролики нужны."
              onAssistantMessage={onAssistantMessage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
