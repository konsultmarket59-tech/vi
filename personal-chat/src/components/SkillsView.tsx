import { useEffect, useState } from "react";
import type { Conversation, Settings, Skill } from "../lib/types";
import { parseSkillDraft, uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  skills: Skill[];
  settings: Settings;
  onSkillsChange: (skills: Skill[]) => void;
  onOpenSettings: () => void;
}

interface Draft {
  id: string | null;
  name: string;
  description: string;
  content: string;
}

const emptyDraft: Draft = { id: null, name: "", description: "", content: "" };

export default function SkillsView({ skills, settings, onSkillsChange, onOpenSettings }: Props) {
  const [mode, setMode] = useState<"list" | "editor" | "creator">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creatorConv, setCreatorConv] = useState<Conversation | null>(null);
  const [creatorPrompt, setCreatorPrompt] = useState("");
  const [pendingSkill, setPendingSkill] = useState<ReturnType<typeof parseSkillDraft>>(null);

  useEffect(() => {
    if (mode === "creator" && !creatorConv) {
      initCreatorConversation();
    }
  }, [mode]);

  async function initCreatorConversation() {
    const prompt = await window.api.getSkillCreatorPrompt();
    setCreatorPrompt(prompt);
    const existing = await window.api.getSkillCreatorConversation();
    if (existing) {
      setCreatorConv(existing);
      const lastAssistant = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant) setPendingSkill(parseSkillDraft(lastAssistant.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__skill_creator__",
        title: "Создание навыка",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveSkillCreatorConversation(conv);
      setCreatorConv(conv);
    }
  }

  function openNew() {
    setDraft(emptyDraft);
    setMode("editor");
  }

  function openEdit(s: Skill) {
    setDraft({ id: s.id, name: s.name, description: s.description, content: s.content });
    setMode("editor");
  }

  async function saveDraft() {
    if (!draft.name.trim() || !draft.content.trim()) return;
    const skill = await window.api.saveSkill({
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      content: draft.content.trim(),
    });
    const next = draft.id ? skills.map((s) => (s.id === skill.id ? skill : s)) : [...skills, skill];
    onSkillsChange(next.sort((a, b) => a.name.localeCompare(b.name, "ru")));
    setMode("list");
    setPendingSkill(null);
  }

  async function removeSkill(id: string) {
    if (!confirm("Удалить навык?")) return;
    await window.api.deleteSkill(id);
    onSkillsChange(skills.filter((s) => s.id !== id));
  }

  function saveFromDraftBlock() {
    if (!pendingSkill) return;
    setDraft({ id: null, name: pendingSkill.name, description: pendingSkill.description, content: pendingSkill.content });
    setMode("editor");
  }

  return (
    <div className="skills-view">
      {mode === "list" && (
        <>
          <div className="skills-toolbar">
            <h2>Навыки</h2>
            <div>
              <button className="btn btn-secondary" onClick={() => setMode("creator")}>
                ✨ Создать навык с помощью ИИ
              </button>
              <button className="btn btn-primary" onClick={openNew}>
                + Новый навык вручную
              </button>
            </div>
          </div>
          {skills.length === 0 && (
            <p className="hint">
              Навыков пока нет. Загрузите свои профессиональные навыки (копирайтинг, делопроизводство и т.д.) вручную
              или воспользуйтесь конструктором навыков.
            </p>
          )}
          <ul className="skills-list">
            {skills.map((s) => (
              <li key={s.id} className="skill-card">
                <div>
                  <h3>{s.name}</h3>
                  <p>{s.description}</p>
                </div>
                <div className="skill-card-actions">
                  <button className="btn btn-secondary" onClick={() => openEdit(s)}>
                    Изменить
                  </button>
                  <button className="btn btn-danger" onClick={() => removeSkill(s.id)}>
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {mode === "editor" && (
        <div className="panel-section">
          <button className="link-btn" onClick={() => setMode("list")}>
            ← К списку навыков
          </button>
          <h2>{draft.id ? "Редактировать навык" : "Новый навык"}</h2>
          <label>Название</label>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label>Когда применять (описание-триггер)</label>
          <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <label>Текст навыка (полная инструкция для ассистента)</label>
          <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={16} />
          <button className="btn btn-primary" onClick={saveDraft} disabled={!draft.name.trim() || !draft.content.trim()}>
            Сохранить навык
          </button>
        </div>
      )}

      {mode === "creator" && (
        <div className="creator-layout">
          <div className="creator-header">
            <button className="link-btn" onClick={() => setMode("list")}>
              ← К списку навыков
            </button>
            <h2>Конструктор навыков</h2>
            <p className="hint">
              Опишите задачу, для которой нужен навык. Ассистент задаст уточняющие вопросы и сформулирует готовый
              навык, который можно будет сохранить.
            </p>
          </div>
          {!settings.apiKey && (
            <div className="warning-banner">
              API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
            </div>
          )}
          {pendingSkill && (
            <div className="pending-skill-banner">
              Ассистент предложил навык «{pendingSkill.name}».{" "}
              <button className="btn btn-primary" onClick={saveFromDraftBlock}>
                Сохранить как новый навык
              </button>
            </div>
          )}
          {creatorConv && (
            <ChatView
              conversation={creatorConv}
              systemPrompt={creatorPrompt}
              settings={settings}
              onUpdate={setCreatorConv}
              onSave={(conv) => window.api.saveSkillCreatorConversation(conv)}
              emptyHint="Опишите, какой навык вам нужен — например: «навык написания коммерческих предложений в моём стиле»."
              onAssistantMessage={(content) => setPendingSkill(parseSkillDraft(content))}
            />
          )}
        </div>
      )}
    </div>
  );
}
