import { useEffect, useState } from "react";
import type { Conversation, DocMeta, Project, Settings, Skill } from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  project: Project;
  skills: Skill[];
  settings: Settings;
  onProjectChange: (p: Project) => void;
  onOpenSettings: () => void;
}

type Tab = "chat" | "instructions" | "docs" | "skills";

export default function ProjectPanel({ project, skills, settings, onProjectChange, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [instructionsDraft, setInstructionsDraft] = useState(project.instructions);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [descDraft, setDescDraft] = useState(project.description);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    setInstructionsDraft(project.instructions);
    setNameDraft(project.name);
    setDescDraft(project.description);
    setTab("chat");
    loadConversations(project.id);
    loadDocs(project.id);
  }, [project.id]);

  useEffect(() => {
    window.api.buildSystemPrompt(project.id).then(setSystemPrompt);
  }, [project.id, project.instructions, project.skillIds, docs, tab]);

  async function loadConversations(projectId: string) {
    const list = await window.api.listConversations(projectId);
    setConversations(list);
    setActiveConvId(list[0]?.id ?? null);
  }

  async function loadDocs(projectId: string) {
    setDocs(await window.api.listDocs(projectId));
  }

  async function newConversation() {
    const conv: Conversation = {
      id: uid(),
      projectId: project.id,
      title: "Новый чат",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await window.api.saveConversation(project.id, conv);
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setTab("chat");
  }

  async function removeConversation(id: string) {
    if (!confirm("Удалить этот чат?")) return;
    await window.api.deleteConversation(project.id, id);
    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (activeConvId === id) setActiveConvId(rest[0]?.id ?? null);
  }

  function updateConversationLocal(conv: Conversation) {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conv.id);
      const next = idx === -1 ? [conv, ...prev] : prev.map((c) => (c.id === conv.id ? conv : c));
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async function saveHeader() {
    const updated = await window.api.updateProject(project.id, {
      name: nameDraft.trim() || project.name,
      description: descDraft,
    });
    onProjectChange(updated);
  }

  async function saveInstructions() {
    const updated = await window.api.updateProject(project.id, { instructions: instructionsDraft });
    onProjectChange(updated);
  }

  async function handlePickFiles() {
    setDocError(null);
    const paths = await window.api.pickFiles();
    if (paths.length === 0) return;
    try {
      const updatedDocs = await window.api.addDocsFromPaths(project.id, paths);
      setDocs(updatedDocs);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeDoc(fileName: string) {
    const updatedDocs = await window.api.removeDoc(project.id, fileName);
    setDocs(updatedDocs);
  }

  async function addPasted() {
    if (!pasteText.trim()) return;
    const updatedDocs = await window.api.addPastedDoc(project.id, pasteTitle.trim() || "Вставленный текст", pasteText);
    setDocs(updatedDocs);
    setPasteText("");
    setPasteTitle("");
  }

  async function toggleSkill(skillId: string) {
    const has = project.skillIds.includes(skillId);
    const nextIds = has ? project.skillIds.filter((id) => id !== skillId) : [...project.skillIds, skillId];
    const updated = await window.api.updateProject(project.id, { skillIds: nextIds });
    onProjectChange(updated);
  }

  async function openFolder() {
    await window.api.openProjectFolder(project.id);
  }

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="project-panel">
      <div className="project-header">
        <div>
          <h2>{project.name}</h2>
          {project.description && <p className="project-desc">{project.description}</p>}
        </div>
        <div className="project-tabs">
          <button className={tab === "chat" ? "tab active" : "tab"} onClick={() => setTab("chat")}>
            Чат
          </button>
          <button className={tab === "instructions" ? "tab active" : "tab"} onClick={() => setTab("instructions")}>
            Инструкции
          </button>
          <button className={tab === "docs" ? "tab active" : "tab"} onClick={() => setTab("docs")}>
            Документы ({docs.length})
          </button>
          <button className={tab === "skills" ? "tab active" : "tab"} onClick={() => setTab("skills")}>
            Навыки ({project.skillIds.length})
          </button>
          <button className="link-btn folder-link" onClick={openFolder}>
            📁 Открыть папку проекта
          </button>
        </div>
      </div>

      {tab === "chat" && (
        <div className="chat-layout">
          <div className="conv-list">
            <button className="btn btn-primary btn-block" onClick={newConversation}>
              + Новый чат
            </button>
            {conversations.map((c) => (
              <div key={c.id} className={c.id === activeConvId ? "conv-item active" : "conv-item"}>
                <span onClick={() => setActiveConvId(c.id)}>{c.title}</span>
                <button className="conv-delete" onClick={() => removeConversation(c.id)} title="Удалить">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="conv-main">
            {!settings.apiKey && (
              <div className="warning-banner">
                API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
              </div>
            )}
            {activeConv ? (
              <ChatView
                conversation={activeConv}
                systemPrompt={systemPrompt}
                settings={settings}
                onUpdate={updateConversationLocal}
                onSave={(conv) => window.api.saveConversation(project.id, conv)}
                projectId={project.id}
              />
            ) : (
              <div className="chat-empty-hint">Нет активного чата. Нажмите «+ Новый чат».</div>
            )}
          </div>
        </div>
      )}

      {tab === "instructions" && (
        <div className="panel-section">
          <label>Название проекта</label>
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveHeader} />
          <label>Описание</label>
          <input value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onBlur={saveHeader} />
          <label>Системная инструкция (роль, стиль, правила для ассистента в этом проекте)</label>
          <textarea
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            onBlur={saveInstructions}
            rows={16}
          />
          <p className="hint">Изменения сохраняются автоматически при потере фокуса поля.</p>
        </div>
      )}

      {tab === "docs" && (
        <div className="panel-section">
          <p className="hint">
            Документы хранятся как обычные файлы в папке проекта на вашем компьютере (кнопка «Открыть папку проекта»
            выше) — их можно добавлять и через это окно, и просто перетаскивая файлы в папку docs.
          </p>
          <button className="btn btn-secondary" onClick={handlePickFiles}>
            Выбрать файлы (.txt, .md, .csv, .json, .docx)
          </button>
          {docError && <div className="chat-error">{docError}</div>}

          <label>Или сохранить вставленный текст как документ</label>
          <input
            placeholder="Название документа"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
          />
          <textarea
            placeholder="Текст документа…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
          />
          <button className="btn btn-secondary" onClick={addPasted} disabled={!pasteText.trim()}>
            Добавить документ
          </button>

          <h3>Документы проекта</h3>
          {docs.length === 0 && <p className="hint">Пока нет документов.</p>}
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.name}>
                <span className="doc-name">{d.name}</span>
                <span className="doc-size">{(d.size / 1024).toFixed(1)} КБ</span>
                <button className="conv-delete" onClick={() => removeDoc(d.name)} title="Удалить">
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "skills" && (
        <div className="panel-section">
          <p className="hint">
            Выберите навыки, которые будут подключены к этому проекту. Их инструкции добавляются в системный промпт.
          </p>
          {skills.length === 0 && <p className="hint">Пока нет ни одного навыка — создайте его в разделе «Навыки».</p>}
          <ul className="skill-toggle-list">
            {skills.map((s) => (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={project.skillIds.includes(s.id)}
                    onChange={() => toggleSkill(s.id)}
                  />
                  <span className="skill-name">{s.name}</span>
                  <span className="skill-desc">{s.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
