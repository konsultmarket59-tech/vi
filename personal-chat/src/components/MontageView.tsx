import { useCallback, useEffect, useState } from "react";
import "../montage.css";
import type { MontageConfig, MontageOptions, MontageProject, MontageProjectSummary, Settings, Skill, StoriesHandoff } from "../lib/types";
import { fileName, fmtTime } from "../lib/montage";
import MontageAgent from "./MontageAgent";
import MontageEditor from "./MontageEditor";
import MontageAvatar from "./MontageAvatar";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
  onMotionDesign: (handoff: Omit<StoriesHandoff, "nonce">) => void;
}

type Tab = "agent" | "projects" | "editor" | "avatar";

/**
 * Раздел «Монтаж».
 *
 * Четыре места, по шагам работы: ИИ-монтажёр режет записи на ролики; проекты —
 * всё, что нарезано и смонтировано; редактор — таймлайн как в CapCut, где любое
 * решение агента правится руками; аватар — новый текст вашим голосом и лицом.
 */
export default function MontageView({ settings, skills, onOpenSettings, onMotionDesign }: Props) {
  const [options, setOptions] = useState<MontageOptions | null>(null);
  const [config, setConfig] = useState<MontageConfig | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [projects, setProjects] = useState<MontageProjectSummary[]>([]);
  const [open, setOpen] = useState<MontageProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState("");

  const refresh = useCallback(() => {
    window.api.montageList().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([window.api.montageOptions(), window.api.montageConfig()])
      .then(([o, c]) => {
        setOptions(o);
        setConfig(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    refresh();
  }, [refresh]);

  const saveConfig = useCallback(async (patch: Partial<MontageConfig>) => {
    setConfig(await window.api.montageSaveConfig(patch));
  }, []);

  async function openProject(id: string) {
    try {
      setOpen(await window.api.montageRead(id));
      setTab("editor");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function newProject(clipPath?: string) {
    if (!options || !config) return;
    const preset = options.presets.find((p) => p.id === config.preset) || options.presets[0];
    const clips = [];
    let bin: { path: string; kind: string; duration: number }[] = [];
    if (clipPath) {
      const probe = await window.api.montageProbe(clipPath);
      clips.push({ src: clipPath, kind: "video", in: 0, out: probe.duration });
      bin = [{ path: clipPath, kind: "video", duration: probe.duration }];
    }
    const draft = await window.api.montageNormalize({
      title: clipPath ? fileName(clipPath).replace(/\.[^.]+$/, "") : "Новый проект",
      canvas: { preset: preset.id, width: preset.width, height: preset.height, fps: 30, fit: "crop", background: "#000000" },
      clips: clips as never,
      captions: config.captions,
      design: config.designDir ? { dir: config.designDir } : null,
      meta: { bin } as never,
    });
    const saved = await window.api.montageSave(draft);
    refresh();
    setOpen(saved);
    setTab("editor");
  }

  async function remove(p: MontageProjectSummary) {
    if (!window.confirm(`Удалить проект «${p.title}»? Исходные записи и собранные ролики останутся на диске.`)) return;
    await window.api.montageDelete(p.id);
    if (open?.id === p.id) setOpen(null);
    refresh();
  }

  async function renderOne(p: MontageProjectSummary) {
    setRendering(p.id);
    setError(null);
    try {
      const [r] = await window.api.montageRenderMany([p.id]);
      if (r.error) setError(r.error);
      else if (r.path) await window.api.montageShowItem(r.path);
    } finally {
      setRendering("");
    }
  }

  if (error && !options) return <div className="mt-root"><div className="mt-error">{error}</div></div>;
  if (!options || !config) return <div className="mt-root"><p className="mt-hint">Загрузка…</p></div>;

  return (
    <div className="mt-root">
      <div className="mt-tabs">
        <button className={tab === "agent" ? "on" : ""} onClick={() => setTab("agent")}>🤖 ИИ-монтажёр</button>
        <button className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")}>📂 Проекты {projects.length ? `(${projects.length})` : ""}</button>
        <button className={tab === "editor" ? "on" : ""} onClick={() => (open ? setTab("editor") : newProject())}>✂️ Редактор{open ? `: ${open.title}` : ""}</button>
        <button className={tab === "avatar" ? "on" : ""} onClick={() => setTab("avatar")}>🧑 Аватар</button>
        <div className="mt-spacer" />
        <button
          className="link-btn"
          title={config.outputDir || "Папка «готовые» в данных приложения"}
          onClick={async () => {
            const dir = await window.api.montagePickFolder("Куда сохранять готовые ролики");
            if (dir) await saveConfig({ outputDir: dir });
          }}
        >
          Готовые ролики: {config.outputDir ? fileName(config.outputDir) : "папка приложения"}
        </button>
        {!settings.apiKey && (
          <button className="link-btn" onClick={onOpenSettings}>нужен ключ модели для агента</button>
        )}
      </div>

      {error && <div className="mt-error">{error} <button className="link-btn" onClick={() => setError(null)}>×</button></div>}

      {tab === "agent" && (
        <MontageAgent
          options={options}
          config={config}
          onConfig={saveConfig}
          settings={settings}
          skills={skills}
          onOpenProject={openProject}
          onProjectsChanged={refresh}
        />
      )}

      {tab === "projects" && (
        <div className="mt-projects">
          <div className="mt-row">
            <button className="btn btn-primary" onClick={() => newProject()}>+ Пустой проект</button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const [f] = await window.api.montagePickMedia();
                if (f) await newProject(f);
              }}
            >
              + Проект из видео
            </button>
          </div>
          {!projects.length && <p className="mt-hint">Проектов пока нет. Начните с «ИИ-монтажёра» — он сам нарежет записи на ролики.</p>}
          <div className="mt-project-grid">
            {projects.map((p) => (
              <div key={p.id} className="mt-project">
                <div className="mt-project-head" onClick={() => openProject(p.id)}>
                  <b>{p.title}</b>
                  <small>
                    {p.preset} · {fmtTime(p.duration)} · кусков {p.clips} · {new Date(p.updatedAt).toLocaleString("ru")}
                  </small>
                  {p.meta?.hook && <div className="mt-hook">Хук: {p.meta.hook}</div>}
                </div>
                <div className="mt-row">
                  <button className="btn btn-secondary" onClick={() => openProject(p.id)}>Открыть</button>
                  <button className="btn btn-secondary" disabled={!!rendering} onClick={() => renderOne(p)}>{rendering === p.id ? "Собираю…" : "Собрать mp4"}</button>
                  <button className="link-btn" onClick={() => remove(p)}>удалить</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "editor" && open && (
        <MontageEditor
          key={open.id}
          options={options}
          config={config}
          initial={open}
          onSaved={refresh}
          onClose={() => setTab("projects")}
          onMotionDesign={onMotionDesign}
        />
      )}

      {tab === "avatar" && (
        <MontageAvatar
          options={options}
          config={config}
          onDone={(path) => {
            // Готовый ролик аватара сразу становится проектом: субтитры и надписи
            // к нему добавляются тем же редактором.
            void newProject(path).then(() => setTab("avatar"));
          }}
        />
      )}
    </div>
  );
}
