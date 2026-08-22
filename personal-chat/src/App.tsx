import { useEffect, useState } from "react";
import type { Project, Settings, Skill } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import Sidebar, { type View } from "./components/Sidebar";
import ProjectPanel from "./components/ProjectPanel";
import SkillsView from "./components/SkillsView";
import OpsView from "./components/OpsView";
import MailView from "./components/MailView";
import MediaView from "./components/MediaView";
import GitHubView from "./components/GitHubView";
import ChatBotsView from "./components/ChatBotsView";
import SettingsView from "./components/SettingsView";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: "settings" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  function updateProjectInList(updated: Project) {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  const activeProject = view.kind === "project" ? projects.find((p) => p.id === view.id) : undefined;

  if (!loaded) {
    return <div className="loading-screen">Загрузка…</div>;
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
        {view.kind === "ops" && <OpsView settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />}
        {view.kind === "mail" && <MailView settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />}
        {view.kind === "media" && (
          <MediaView projects={projects} settings={settings} onOpenSettings={() => setView({ kind: "settings" })} />
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
