import type { Project } from "../lib/types";

export type View =
  | { kind: "project"; id: string }
  | { kind: "skills" }
  | { kind: "ops" }
  | { kind: "mail" }
  | { kind: "media" }
  | { kind: "settings" };

interface Props {
  projects: Project[];
  view: View;
  onSelectView: (v: View) => void;
  onProjectsChange: (projects: Project[]) => void;
}

export default function Sidebar({ projects, view, onSelectView, onProjectsChange }: Props) {
  async function createEmptyProject() {
    const project = await window.api.createProject({ name: "Новый проект", description: "", instructions: "" });
    onProjectsChange([project, ...projects]);
    onSelectView({ kind: "project", id: project.id });
  }

  async function importFromClaude() {
    const paths = await window.api.pickClaudeExportFiles();
    if (paths.length === 0) return;
    try {
      const created = await window.api.importClaudeExports(paths);
      onProjectsChange([...created, ...projects]);
      if (created[0]) onSelectView({ kind: "project", id: created[0].id });
    } catch {
      alert("Не удалось импортировать один или несколько файлов — проверьте, что это экспорт проекта Claude.ai (JSON).");
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-title">Личный чат</div>

      <div className="sidebar-section">
        <button className="btn btn-primary btn-block" onClick={createEmptyProject}>
          + Новый проект
        </button>
        <button className="btn btn-secondary btn-block" onClick={importFromClaude}>
          Импорт из Claude.ai (.json)
        </button>
      </div>

      <div className="sidebar-section sidebar-projects">
        <div className="sidebar-label">Проекты</div>
        {projects.map((p) => (
          <button
            key={p.id}
            className={view.kind === "project" && view.id === p.id ? "sidebar-item active" : "sidebar-item"}
            onClick={() => onSelectView({ kind: "project", id: p.id })}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="sidebar-section sidebar-footer">
        <button
          className={view.kind === "skills" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "skills" })}
        >
          🧩 Навыки
        </button>
        <button
          className={view.kind === "ops" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "ops" })}
        >
          💼 Операционка
        </button>
        <button
          className={view.kind === "mail" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "mail" })}
        >
          ✉️ Почта
        </button>
        <button
          className={view.kind === "media" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "media" })}
        >
          🎨 Медиа
        </button>
        <button
          className={view.kind === "settings" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "settings" })}
        >
          ⚙️ Настройки
        </button>
      </div>
    </div>
  );
}
