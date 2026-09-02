import { useState } from "react";
import type { Project } from "../lib/types";

export type View =
  | { kind: "project"; id: string }
  | { kind: "skills" }
  | { kind: "excel" }
  | { kind: "word" }
  | { kind: "docflow" }
  | { kind: "dataviz" }
  | { kind: "cleanup" }
  | { kind: "cloud" }
  | { kind: "direct" }
  | { kind: "media" }
  | { kind: "github" }
  | { kind: "chatbots" }
  | { kind: "settings" };

// Order here is the order in the menu. Which of these actually appear depends on
// the build's plugins.json — see electron/plugins.cjs. Настройки is not in the
// list because it can never be switched off.
const MODULE_ITEMS = [
  { id: "skills", label: "🧩 Навыки" },
  { id: "excel", label: "📗 Excel" },
  { id: "word", label: "📘 Word" },
  { id: "docflow", label: "📁 Документооборот" },
  { id: "dataviz", label: "📊 Визуализация" },
  { id: "cleanup", label: "🧹 Клининг" },
  { id: "media", label: "🎨 Медиа" },
  { id: "cloud", label: "☁️ Облако" },
  { id: "direct", label: "📣 Директ" },
  { id: "github", label: "🐙 GitHub" },
  { id: "chatbots", label: "🤖 Чат-боты" },
] as const;

interface Props {
  projects: Project[];
  view: View;
  modules: Record<string, boolean>;
  productName: string;
  onSelectView: (v: View) => void;
  onProjectsChange: (projects: Project[]) => void;
}

export default function Sidebar({ projects, view, modules, productName, onSelectView, onProjectsChange }: Props) {
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

  /**
   * Удаляет проект целиком: чаты, документы, задачи по расписанию.
   *
   * Подтверждение перечисляет, что именно исчезнет, и куда это денется — иначе
   * человек нажимает «ок», не зная, что вместе с проектом уходят и документы,
   * которые лежали только в нём.
   */
  async function removeProject(p: Project) {
    const ok = confirm(
      `Удалить проект «${p.name}»?\n\n` +
        "Вместе с ним удалятся его чаты, документы и задачи по расписанию.\n" +
        "Папка проекта уйдёт в корзину компьютера — оттуда её можно вернуть."
    );
    if (!ok) return;
    try {
      const result = await window.api.deleteProject(p.id);
      onProjectsChange(projects.filter((x) => x.id !== p.id));
      // Открытый проект только что перестал существовать — уводим с него, иначе
      // экран остался бы на «Проект не найден».
      if (view.kind === "project" && view.id === p.id) onSelectView({ kind: "settings" });
      if (result && result.trashed === false) {
        alert(
          `Проект «${p.name}» удалён, но корзина компьютера оказалась недоступна — ` +
            "папка удалена безвозвратно."
        );
      }
    } catch (e) {
      alert(`Не удалось удалить проект: ${e instanceof Error ? e.message : String(e)}`);
    }
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
      <div className="sidebar-title">{productName}</div>

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
              <button className="sidebar-item-remove" onClick={() => removeProject(p)} title="Удалить проект">
                ✕
              </button>
            </div>
          )
        )}
      </div>

      <div className="sidebar-section sidebar-footer">
        {MODULE_ITEMS.filter((item) => modules[item.id] !== false).map((item) => (
          <button
            key={item.id}
            className={view.kind === item.id ? "sidebar-item active" : "sidebar-item"}
            onClick={() => onSelectView({ kind: item.id } as View)}
          >
            {item.label}
          </button>
        ))}
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
