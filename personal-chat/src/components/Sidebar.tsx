import { useState } from "react";
import type { Project } from "../lib/types";

export type View =
  | { kind: "project"; id: string }
  | { kind: "skills" }
  | { kind: "ops" }
  | { kind: "excel" }
  | { kind: "cloud" }
  | { kind: "direct" }
  | { kind: "media" }
  | { kind: "design" }
  | { kind: "github" }
  | { kind: "chatbots" }
  | { kind: "settings" };

interface Props {
  projects: Project[];
  view: View;
  onSelectView: (v: View) => void;
  onProjectsChange: (projects: Project[]) => void;
}

export default function Sidebar({ projects, view, onSelectView, onProjectsChange }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function startRename(p: Project) {
    setRenamingId(p.id);
    setRenameDraft(p.name);
  }

  async function commitRename(p: Project) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || name === p.name) return;
    const updated = await window.api.updateProject(p.id, { name });
    onProjectsChange(projects.map((x) => (x.id === p.id ? updated : x)));
  }

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
        {projects.map((p) =>
          renamingId === p.id ? (
            <input
              key={p.id}
              className="sidebar-item-rename-input"
              value={renameDraft}
              autoFocus
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => commitRename(p)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(p);
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <div
              key={p.id}
              className={
                view.kind === "project" && view.id === p.id ? "sidebar-item sidebar-item-project active" : "sidebar-item sidebar-item-project"
              }
            >
              <button className="sidebar-item-name" onClick={() => onSelectView({ kind: "project", id: p.id })}>
                {p.name}
              </button>
              <button className="sidebar-item-rename" onClick={() => startRename(p)} title="Переименовать проект">
                ✎
              </button>
            </div>
          )
        )}
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
          className={view.kind === "excel" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "excel" })}
        >
          📗 Excel
        </button>
        <button
          className={view.kind === "media" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "media" })}
        >
          🎨 Медиа
        </button>
        <button
          className={view.kind === "design" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "design" })}
        >
          🖌️ Дизайн
        </button>
        <button
          className={view.kind === "cloud" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "cloud" })}
        >
          ☁️ Облако
        </button>
        <button
          className={view.kind === "direct" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "direct" })}
        >
          📣 Директ
        </button>
        <button
          className={view.kind === "github" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "github" })}
        >
          🐙 GitHub
        </button>
        <button
          className={view.kind === "chatbots" ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelectView({ kind: "chatbots" })}
        >
          🤖 Чат-боты
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
