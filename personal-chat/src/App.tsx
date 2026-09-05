import { useEffect, useState } from "react";
import type { LicenceStatus, PluginConfig, Project, Settings, Skill } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import Sidebar, { type View } from "./components/Sidebar";
import ProjectPanel from "./components/ProjectPanel";
import SkillsView from "./components/SkillsView";
import ExcelView from "./components/ExcelView";
import WordView from "./components/WordView";
import DocFlowView from "./components/DocFlowView";
import DataVizView from "./components/DataVizView";
import FinModelView from "./components/FinModelView";
import VideoStoriesView from "./components/VideoStoriesView";
import CleanupView from "./components/CleanupView";
import DirectView from "./components/DirectView";
import CloudView from "./components/CloudView";
import MediaView from "./components/MediaView";
import GitHubView from "./components/GitHubView";
import ChatBotsView from "./components/ChatBotsView";
import SettingsView from "./components/SettingsView";
import LicenceGate from "./components/LicenceGate";
import DemoBanner from "./components/DemoBanner";

const STARTUP_SLOW_MS = 10000;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  // Every module is on until plugins.json says otherwise, so a build without the
  // file behaves exactly as before.
  const [plugins, setPlugins] = useState<PluginConfig>({ productName: "Личный чат", modules: {}, source: "" });
  const [licence, setLicence] = useState<LicenceStatus | null>(null);
  const [view, setView] = useState<View>({ kind: "settings" });
  const [loaded, setLoaded] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupSlow, setStartupSlow] = useState(false);

  useEffect(() => {
    const slowTimer = setTimeout(() => setStartupSlow(true), STARTUP_SLOW_MS);
    (async () => {
      try {
        // Checked first and on its own: a demo build that is not activated must
        // not go on to read projects and settings behind the gate.
        const lic = await window.api.licenceStatus();
        setLicence(lic);
        if (lic.gated && !lic.ok) {
          setLoaded(true);
          return;
        }

        const [p, s, cfg, pluginCfg] = await Promise.all([
          window.api.listProjects(),
          window.api.listSkills(),
          window.api.getSettings(),
          window.api.getPlugins(),
        ]);
        setProjects(p);
        setSkills(s);
        setSettings(cfg);
        setPlugins(pluginCfg);
        // Имя копии из лицензии важнее названия сборки: одна и та же сборка
        // у разных людей называется по-разному.
        document.title = lic.displayName || pluginCfg.productName;
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

  if (licence?.gated && !licence.ok) {
    return (
      <LicenceGate
        status={licence}
        onActivated={(next) => {
          setLicence(next);
          // Everything the app needs was skipped while the gate was up, so the
          // simplest correct thing after activation is a clean start.
          if (next.ok) window.location.reload();
        }}
      />
    );
  }

  // A module switched off in this build must not render even if some other code
  // path selects its view.
  const enabled = (id: string) => plugins.modules[id] !== false;
  const activeView =
    view.kind === "project" || view.kind === "settings" || enabled(view.kind) ? view : { kind: "settings" as const };

  return (
    <div className="app-shell">
      <Sidebar
        projects={projects}
        view={activeView}
        modules={plugins.modules}
        productName={licence?.displayName || plugins.productName}
        onSelectView={setView}
        onProjectsChange={setProjects}
      />
      <main className="main-area">
        {licence?.gated && licence.ok && <DemoBanner status={licence} />}
        {activeView.kind === "project" && activeProject && (
          <ProjectPanel
            project={activeProject}
            skills={skills}
            settings={settings}
            onProjectChange={updateProjectInList}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {activeView.kind === "project" && !activeProject && (
          <div className="empty-state">Проект не найден.</div>
        )}
        {activeView.kind === "skills" && (
          <SkillsView
            skills={skills}
            settings={settings}
            onSkillsChange={setSkills}
            onOpenSettings={() => setView({ kind: "settings" })}
          />
        )}
        {activeView.kind === "word" && (
          <WordView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "excel" && (
          <ExcelView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "docflow" && (
          <DocFlowView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "dataviz" && (
          <DataVizView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "finmodel" && (
          <FinModelView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "stories" && (
          <VideoStoriesView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "cleanup" && (
          <CleanupView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "cloud" && <CloudView projects={projects} />}
        {activeView.kind === "direct" && (
          <DirectView settings={settings} skills={skills} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "media" && (
          <MediaView projects={projects} settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "github" && (
          <GitHubView settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />
        )}
        {activeView.kind === "chatbots" && <ChatBotsView />}
        {activeView.kind === "settings" && <SettingsView settings={settings} onChange={setSettings} />}
      </main>
    </div>
  );
}
