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
  onMotionDesign?: (handoff: Omit<StoriesHandoff, "nonce">) => void;
}

/**
 * Раздел «Монтаж» — сразу редактор.
 *
 * Всё внутри него: ✨ Моушн, титры, ИИ-монтажёр, аватар — вкладки слева,
 * проекты — списком поверх. Открывается последний проект; если проектов
 * нет — новый пустой, и можно сразу кидать видео или делать моушн.
 */
export default function MontageView({ settings, skills, onOpenSettings, onMotionDesign }: Props) {
  const [options, setOptions] = useState<MontageOptions | null>(null);
  const [config, setConfig] = useState<MontageConfig | null>(null);
  const [projects, setProjects] = useState<MontageProjectSummary[]>([]);
  const [open, setOpen] = useState<MontageProject | null>(null);
  const [showProjects, setShowProjects] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState("");

  const refresh = useCallback(() => {
    window.api.montageList().then(setProjects).catch(() => {});
  }, []);

  const saveConfig = useCallback(async (patch: Partial<MontageConfig>) => {
    setConfig(await window.api.montageSaveConfig(patch));
  }, []);

  const newProject = useCallback(
    async (clipPath?: string, o: MontageOptions | null = options, c: MontageConfig | null = config) => {
      if (!o || !c) return;
      const preset = o.presets.find((p) => p.id === c.preset) || o.presets[0];
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
        captions: c.captions,
        design: c.designDir ? { dir: c.designDir } : null,
        meta: { bin } as never,
      });
      const saved = await window.api.montageSave(draft);
      refresh();
      setOpen(saved);
      setShowProjects(false);
      void window.api.montageSaveConfig({ lastProject: saved.id }).then(setConfig);
    },
    [options, config, refresh]
  );

  const openProject = useCallback(async (id: string) => {
    try {
      setOpen(await window.api.montageRead(id));
      setShowProjects(false);
      void window.api.montageSaveConfig({ lastProject: id }).then(setConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Старт: настройки, затем последний проект (или самый свежий, или новый).
  useEffect(() => {
    (async () => {
      try {
        const [o, c, list] = await Promise.all([window.api.montageOptions(), window.api.montageConfig(), window.api.montageList()]);
        setOptions(o);
        setConfig(c);
        setProjects(list);
        const id = (c.lastProject && list.some((p) => p.id === c.lastProject) && c.lastProject) || list[0]?.id;
        if (id) setOpen(await window.api.montageRead(id));
        else await newProject(undefined, o, c);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // Только при открытии раздела.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(p: MontageProjectSummary) {
    if (!window.confirm(`Удалить проект «${p.title}»? Исходные записи и собранные ролики останутся на диске.`)) return;
    await window.api.montageDelete(p.id);
    const rest = projects.filter((x) => x.id !== p.id);
    if (open?.id === p.id) {
      if (rest[0]) await openProject(rest[0].id);
      else await newProject();
    }
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
  if (!options || !config || !open) return <div className="mt-root"><p className="mt-hint">Открываю редактор…</p></div>;

  const projectsButton = (
    <button className="btn btn-secondary mt-projects-btn" onClick={() => { refresh(); setShowProjects(true); }} title="Все проекты, новый проект">
      📂 Проекты
    </button>
  );
  const settingsButton = (
    <button className="btn btn-secondary" onClick={onOpenSettings} title={settings.apiKey ? "Настройки: ключ, модель, папка готовых роликов" : "Нужен ключ модели для ИИ"}>
      ⚙{settings.apiKey ? "" : " ключ"}
    </button>
  );

  return (
    <div className="mt-root">
      {error && <div className="mt-error">{error} <button className="link-btn" onClick={() => setError(null)}>×</button></div>}

      <MontageEditor
        key={open.id}
        options={options}
        config={config}
        initial={open}
        onSaved={refresh}
        onConfig={saveConfig}
        projectsButton={projectsButton}
        settingsButton={settingsButton}
        onMotionDesign={onMotionDesign}
        agentPanel={
          <MontageAgent
            options={options}
            config={config}
            onConfig={saveConfig}
            settings={settings}
            skills={skills}
            onOpenProject={openProject}
            onProjectsChanged={refresh}
          />
        }
        avatarPanel={
          <MontageAvatar
            options={options}
            config={config}
            onDone={(path) => {
              // Готовый ролик аватара — новым проектом: субтитры и надписи к нему тем же редактором.
              void newProject(path);
            }}
          />
        }
      />

      {showProjects && (
        <div className="mt-overlay" onMouseDown={() => setShowProjects(false)}>
          <div className="mt-overlay-card mt-projects" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mt-row">
              <h3 className="mt-panel-title">Проекты</h3>
              <div className="mt-spacer" />
              <button className="btn btn-primary" onClick={() => newProject()}>+ Новый проект</button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const [f] = await window.api.montagePickMedia();
                  if (f) await newProject(f);
                }}
              >
                + Из видео
              </button>
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
              <button className="link-btn" onClick={() => setShowProjects(false)}>✕</button>
            </div>
            <div className="mt-project-grid">
              {projects.map((p) => (
                <div key={p.id} className={`mt-project ${p.id === open.id ? "current" : ""}`}>
                  <div className="mt-project-head" onClick={() => openProject(p.id)}>
                    <b>{p.title}</b>
                    <small>
                      {p.preset} · {fmtTime(p.duration)} · кусков {p.clips} · {new Date(p.updatedAt).toLocaleString("ru")}
                    </small>
                    {p.meta?.hook && <div className="mt-hook">Хук: {p.meta.hook}</div>}
                  </div>
                  <div className="mt-row">
                    <button className="btn btn-secondary" onClick={() => openProject(p.id)}>{p.id === open.id ? "Открыт" : "Открыть"}</button>
                    <button className="btn btn-secondary" disabled={!!rendering} onClick={() => renderOne(p)}>{rendering === p.id ? "Собираю…" : "Собрать mp4"}</button>
                    <button className="link-btn" onClick={() => remove(p)}>удалить</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
