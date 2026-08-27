import { useEffect, useState } from "react";
import type { Project, Settings, Skill } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import Sidebar, { type View } from "./components/Sidebar";
import ProjectPanel from "./components/ProjectPanel";
import SkillsView from "./components/SkillsView";
import ExcelView from "./components/ExcelView";
import WordView from "./components/WordView";
import DirectView from "./components/DirectView";
import CloudView from "./components/CloudView";
import MediaView from "./components/MediaView";
import DesignView from "./components/DesignView";
import GitHubView from "./components/GitHubView";
import ChatBotsView from "./components/ChatBotsView";
import SettingsView from "./components/SettingsView";

const STARTUP_SLOW_MS = 10000;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: "settings" });
  const [loaded, setLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupSlow, setStartupSlow] = useState(false);

  useEffect(() => {
    const slowTimer = setTimeout(() => setStartupSlow(true), STARTUP_SLOW_MS);
    (async () => {
      try {
        const [p, s, cfg] = await Promise.all([
          window.api.listProjects(),
          window.api.listSkills(),
          window.api.getSettings(),
        ]);
        setProjects(p);
        setSkills(s);
        setSettings(cfg);
        setView(p.length > 0 ? { kind: "project", id: p[0].id } : { kind: "settings" });
        setLoaded(true);
      } catch (e) {
        setStartupError(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
      } finally {
        clearTimeout(slowTimer);
      }
    })();
    return () => clearTimeout(slowTimer);
  }, []);

  function updateProjectInList(updated: Project) {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  const activeProject = view.kind === "project" ? projects.find((p) => p.id === view.id) : undefined;

  if (startupError) {
    return (
      <div className="loading-screen loading-screen-error">
        <div>
          <p>Не удалось загрузить приложение.</p>
          <pre className="startup-error-details">{startupError}</pre>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="loading-screen">
        <div>
          <div>Загрузка…</div>
          {startupSlow && (
            <p className="hint startup-slow-hint">
              Загрузка идёт дольше обычного. Если папка данных приложения (обычно
              «Документы\Личный чат») находится в OneDrive/облачном хранилище, попробуйте приостановить
              синхронизацию и перезапустить приложение.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar projects={projects} view={view} onSelectView={setView} onProjectsChange={setProjects} />
      <main className="main-area">
        {view.kind === "project" && activeProject && (
          <ProjectPanel
            project={activeProject}
            skills={skills}
            settings={settings}
            onProjectChange={updateProjectInList}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {view.kind === "project" && !activeProject && (
          <div className="empty-state">Проект не найден.</div>
        )}
        {view.kind === "skills" && (
          <SkillsView
            skills={skills}
            settings={settings}
            onSkillsChange={setSkills}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {view.kind === "word" && (
          <WordView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {view.kind === "excel" && (
          <ExcelView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {view.kind === "cloud" && <CloudView projects={projects} />}
        {view.kind === "direct" && (
          <DirectView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {view.kind === "media" && (
          <MediaView projects={projects} settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {view.kind === "design" && (
          <DesignView
            projects={projects}
            skills={skills}
            settings={settings}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {view.kind === "github" && (
          <GitHubView settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {view.kind === "chatbots" && <ChatBotsView />}
        {view.kind === "settings" && <SettingsView settings={settings} onChange={setSettings} />}
      </main>
    </div>
  );
}
