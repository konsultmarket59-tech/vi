import { useEffect, useState } from "react";
import type { Conversation, DesignDoc, DesignType, Project, Settings } from "../lib/types";
import { DESIGN_SYNTAX_HINT, parseDesignDraft, uid, type ParsedDesignDraft } from "../lib/promptBuilder";
import { buildDesignExportHtml } from "../lib/exportHtml";
import { sanitizeDesignHtml, sanitizeDesignSvg } from "../lib/sanitizeDesign";
import ChatView from "./ChatView";

interface Props {
  projects: Project[];
  settings: Settings;
  onOpenSettings: () => void;
}

type Mode = "gallery" | "creator";

const TYPE_LABELS: Record<DesignType, string> = {
  post: "Пост",
  document: "Документ",
  presentation: "Слайд презентации",
  "design-system": "Дизайн-система",
  website: "Сайт",
  graphic: "Графика (SVG)",
  other: "Другое",
};

function normalizeType(raw: string): DesignType {
  return (Object.keys(TYPE_LABELS) as DesignType[]).includes(raw as DesignType) ? (raw as DesignType) : "other";
}

function DesignPreview({ content, format }: { content: string; format: "html" | "svg" }) {
  if (format === "svg") {
    const clean = sanitizeDesignSvg(content);
    return <div className="design-svg-preview" dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  const clean = sanitizeDesignHtml(content);
  return <iframe sandbox="" srcDoc={clean} className="design-html-preview" title="Предпросмотр дизайна" />;
}

export default function DesignView({ projects, settings, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("gallery");
  const [projectId, setProjectId] = useState("");
  const [docs, setDocs] = useState<DesignDoc[]>([]);
  const [selected, setSelected] = useState<DesignDoc | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingDesign, setPendingDesign] = useState<ParsedDesignDraft | null>(null);

  useEffect(() => {
    refreshDocs();
    setSelected(null);
  }, [projectId]);

  useEffect(() => {
    if (mode === "creator") initAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectId]);

  async function refreshDocs() {
    setDocs(await window.api.listDesignDocs(projectId || undefined));
  }

  async function initAgent() {
    setAgentConv(null);
    setPendingDesign(null);
    const prompt = await window.api.buildDesignAgentPrompt(projectId || undefined);
    setAgentPrompt(prompt + "\n\n" + DESIGN_SYNTAX_HINT);
    const existing = await window.api.getDesignAgentConversation(projectId || undefined);
    if (existing) {
      setAgentConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last) setPendingDesign(parseDesignDraft(last.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__design_agent__",
        title: "Дизайн-ассистент",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveDesignAgentConversation(projectId || undefined, conv);
      setAgentConv(conv);
    }
  }

  async function savePendingDesign() {
    if (!pendingDesign) return;
    const format = pendingDesign.format;
    const content = format === "svg" ? sanitizeDesignSvg(pendingDesign.content) : sanitizeDesignHtml(pendingDesign.content);
    await window.api.saveDesignDoc({
      title: pendingDesign.title,
      type: normalizeType(pendingDesign.type),
      format,
      content,
      projectId: projectId || undefined,
    });
    setPendingDesign(null);
    setMode("gallery");
    await refreshDocs();
  }

  async function removeDoc(doc: DesignDoc) {
    if (!confirm(`Удалить дизайн «${doc.title}»?`)) return;
    await window.api.deleteDesignDoc(doc.id, projectId || undefined);
    if (selected?.id === doc.id) setSelected(null);
    await refreshDocs();
  }

  async function exportDoc(doc: DesignDoc, kind: "png" | "jpg" | "pdf" | "svg") {
    setExportError(null);
    try {
      if (kind === "svg") {
        await window.api.exportSvgFile({
          svg: sanitizeDesignSvg(doc.content),
          defaultName: doc.title,
          projectId: projectId || undefined,
        });
        return;
      }
      const content = doc.format === "svg" ? sanitizeDesignSvg(doc.content) : sanitizeDesignHtml(doc.content);
      const html = buildDesignExportHtml(content);
      const payload = { html, defaultName: doc.title, projectId: projectId || undefined };
      if (kind === "png") await window.api.exportToPng(payload);
      if (kind === "jpg") await window.api.exportToJpg(payload);
      if (kind === "pdf") await window.api.exportToPdf(payload);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="design-view">
      <div className="ops-toolbar">
        <h2>Дизайн</h2>
        <div>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Без привязки к проекту</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={() => window.api.openDesignFolder(projectId || undefined)}>
            📁 Открыть папку
          </button>
          <button className={mode === "creator" ? "btn btn-primary" : "btn btn-secondary"} onClick={() => setMode(mode === "creator" ? "gallery" : "creator")}>
            {mode === "creator" ? "← К галерее" : "✨ Создать дизайн"}
          </button>
        </div>
      </div>

      {mode === "gallery" && (
        <div className="design-layout">
          <div className="design-gallery">
            {docs.length === 0 && (
              <p className="hint design-empty-hint">
                Пока ничего нет. Нажмите «✨ Создать дизайн» — опишите задачу (пост, документ, слайд презентации,
                дизайн-система, страница сайта, логотип/иконка), ассистент предложит готовый вариант.
              </p>
            )}
            <ul className="design-card-list">
              {docs.map((d) => (
                <li key={d.id} className={selected?.id === d.id ? "design-card active" : "design-card"} onClick={() => setSelected(d)}>
                  <div className="design-card-preview">
                    <DesignPreview content={d.content} format={d.format} />
                  </div>
                  <div className="design-card-meta">
                    <span className="design-card-title">{d.title}</span>
                    <span className="design-card-type">{TYPE_LABELS[d.type]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="design-viewer panel-section">
              <div className="design-viewer-header">
                <h3>{selected.title}</h3>
                <button className="conv-delete" onClick={() => removeDoc(selected)} title="Удалить">
                  ×
                </button>
              </div>
              <p className="hint">{TYPE_LABELS[selected.type]}</p>
              <div className="design-viewer-preview">
                <DesignPreview content={selected.content} format={selected.format} />
              </div>
              {exportError && <div className="chat-error">{exportError}</div>}
              <div className="design-export-actions">
                {selected.format === "svg" && (
                  <button className="btn btn-secondary" onClick={() => exportDoc(selected, "svg")}>
                    Экспорт в SVG
                  </button>
                )}
                <button className="btn btn-secondary" onClick={() => exportDoc(selected, "png")}>
                  Экспорт в PNG
                </button>
                <button className="btn btn-secondary" onClick={() => exportDoc(selected, "jpg")}>
                  Экспорт в JPG
                </button>
                {selected.format === "html" && (
                  <button className="btn btn-secondary" onClick={() => exportDoc(selected, "pdf")}>
                    Экспорт в PDF
                  </button>
                )}
              </div>
              {selected.format === "html" && (
                <p className="hint">
                  Если в дизайне есть CSS-анимация, в предпросмотре она проигрывается, но при экспорте в PNG/JPG/PDF
                  сохранится только один статичный кадр — экспорт всегда статичный.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "creator" && (
        <div className="creator-layout">
          <div className="creator-header">
            <p className="hint">
              Опишите, какой дизайн нужен — пост, документ, презентация, дизайн-система, страница сайта, логотип
              или иконка. Для видео/анимационных роликов используйте раздел «🎨 Медиа».
            </p>
          </div>
          {!settings.apiKey && (
            <div className="warning-banner">
              API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
            </div>
          )}
          {pendingDesign && (
            <div className="pending-skill-banner">
              Ассистент предложил дизайн «{pendingDesign.title}» ({TYPE_LABELS[normalizeType(pendingDesign.type)]}).
              <button className="btn btn-primary" onClick={savePendingDesign}>
                Сохранить
              </button>
              <button className="btn btn-secondary" onClick={() => setPendingDesign(null)}>
                Отклонить
              </button>
            </div>
          )}
          {pendingDesign && (
            <div className="design-pending-preview">
              <DesignPreview content={pendingDesign.content} format={pendingDesign.format} />
            </div>
          )}
          {agentConv && (
            <ChatView
              conversation={agentConv}
              systemPrompt={agentPrompt}
              settings={settings}
              onUpdate={setAgentConv}
              onSave={(conv) => window.api.saveDesignAgentConversation(projectId || undefined, conv)}
              emptyHint="Например: «Сделай квадратный пост для ВКонтакте с анонсом акции» или «Собери простую иконку календаря в SVG»."
              onAssistantMessage={(content) => setPendingDesign(parseDesignDraft(content))}
            />
          )}
        </div>
      )}
    </div>
  );
}
