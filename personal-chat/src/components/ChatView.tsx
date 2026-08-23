import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation, MediaGenerationResult, Settings, Skill } from "../lib/types";
import { MEDIA_SYNTAX_HINT, parseMediaRequest, uid, type ParsedMediaRequest } from "../lib/promptBuilder";
import { streamChat, listModels, ApiError, type ApiMessage } from "../lib/api";
import { buildConversationExportHtml, buildMessageExportHtml, type BrandKit } from "../lib/exportHtml";
import { CHART_SYNTAX_HINT } from "../lib/markdownRender";
import { CURATED_CHAT_MODELS, mergeModelLists } from "../lib/curatedModels";
import Markdown from "./Markdown";

interface Props {
  conversation: Conversation;
  systemPrompt: string;
  settings: Settings;
  onUpdate: (conv: Conversation) => void;
  onSave: (conv: Conversation) => Promise<unknown>;
  projectId?: string;
  brand?: BrandKit;
  emptyHint?: string;
  onAssistantMessage?: (content: string) => void;
  skills?: Skill[];
}

function deriveFileName(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "документ";
  return firstLine.replace(/[#*`_>-]/g, "").trim().slice(0, 50) || "документ";
}

function statusLabel(status: string): string {
  if (status === "pending") return "В очереди…";
  if (status === "processing") return "Генерация выполняется…";
  return status;
}

function mediaTypeLabel(type: ParsedMediaRequest["type"]): string {
  if (type === "image") return "изображение";
  if (type === "video") return "видео";
  return "аудио";
}

export default function ChatView({
  conversation,
  systemPrompt,
  settings,
  onUpdate,
  onSave,
  projectId,
  brand,
  emptyHint,
  onAssistantMessage,
  skills,
}: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachedSkillId, setAttachedSkillId] = useState<string | null>(null);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [chatModels, setChatModels] = useState(CURATED_CHAT_MODELS);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingMedia, setPendingMedia] = useState<ParsedMediaRequest | null>(null);
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaGenerationResult | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, streamingText]);

  useEffect(() => {
    listModels(settings.baseUrl, settings.apiKey, "chat")
      .then((fetched) => setChatModels(mergeModelLists(CURATED_CHAT_MODELS, fetched)))
      .catch(() => {
        // keep the curated shortlist as-is — the picker still works without the live catalog
      });
  }, [settings.baseUrl, settings.apiKey]);

  function updateModel(model: string) {
    const updated: Conversation = { ...conversation, model: model || undefined };
    onUpdate(updated);
    onSave(updated);
  }

  useEffect(() => {
    const lastAssistant = [...conversation.messages].reverse().find((m) => m.role === "assistant");
    setPendingMedia(lastAssistant ? parseMediaRequest(lastAssistant.content) : null);
    setMediaResult(null);
    setMediaPreviewUrl(null);
    setMediaError(null);
  }, [conversation.id]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");

    const userMsg: ChatMessage = { id: uid(), role: "user", content: text, createdAt: Date.now() };
    const withUser: Conversation = {
      ...conversation,
      messages: [...conversation.messages, userMsg],
      updatedAt: Date.now(),
      title: conversation.title === "Новый чат" ? text.slice(0, 60) : conversation.title,
    };
    onUpdate(withUser);
    await onSave(withUser);

    const attachedSkill = skills?.find((s) => s.id === attachedSkillId);
    const skillPrompt = attachedSkill
      ? `\n\n--- Навык (вызван для этого сообщения): ${attachedSkill.name} ---\n${
          attachedSkill.description ? attachedSkill.description + "\n" : ""
        }${attachedSkill.content}`
      : "";
    const apiMessages: ApiMessage[] = [
      { role: "system", content: systemPrompt + skillPrompt + "\n\n" + CHART_SYNTAX_HINT + "\n\n" + MEDIA_SYNTAX_HINT },
      ...withUser.messages.map((m) => ({ role: m.role, content: m.content }) as ApiMessage),
    ];

    setBusy(true);
    setStreamingText("");
    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveSettings = conversation.model && conversation.model !== settings.model
      ? { ...settings, model: conversation.model }
      : settings;

    try {
      const full = await streamChat(
        effectiveSettings,
        apiMessages,
        (chunk) => setStreamingText((prev) => prev + chunk),
        controller.signal
      );
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: full || "(пустой ответ)",
        createdAt: Date.now(),
      };
      const finalConv: Conversation = {
        ...withUser,
        messages: [...withUser.messages, assistantMsg],
        updatedAt: Date.now(),
      };
      onUpdate(finalConv);
      await onSave(finalConv);
      onAssistantMessage?.(full);
      setPendingMedia(parseMediaRequest(full));
      setMediaResult(null);
      setMediaPreviewUrl(null);
      setMediaError(null);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else if (e instanceof DOMException && e.name === "AbortError") setError("Отменено.");
      else setError(String(e));
    } finally {
      setBusy(false);
      setStreamingText("");
      abortRef.current = null;
      setAttachedSkillId(null);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function exportMessage(m: ChatMessage, format: "pdf" | "png") {
    setExportError(null);
    try {
      const html = buildMessageExportHtml(deriveFileName(m.content), m.content, brand);
      const payload = { html, defaultName: deriveFileName(m.content), projectId };
      if (format === "pdf") await window.api.exportToPdf(payload);
      else await window.api.exportToPng(payload);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportConversation(format: "pdf" | "png") {
    setExportError(null);
    try {
      const html = buildConversationExportHtml(conversation.title, conversation.messages, brand);
      const payload = { html, defaultName: conversation.title, projectId };
      if (format === "pdf") await window.api.exportToPdf(payload);
      else await window.api.exportToPng(payload);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runMediaGeneration() {
    if (!pendingMedia) return;
    setMediaGenerating(true);
    setMediaError(null);
    setMediaStatus("Запуск…");
    const unsubscribe = window.api.onMediaProgress((status) => setMediaStatus(statusLabel(status)));
    try {
      const result = await window.api.generateMedia({
        type: pendingMedia.type,
        model: pendingMedia.model,
        prompt: pendingMedia.prompt,
        projectId,
      });
      setMediaResult(result);
      setMediaPreviewUrl(await window.api.readFileAsDataUrl(result.localPath));
      setPendingMedia(null);
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : String(e));
    } finally {
      unsubscribe();
      setMediaGenerating(false);
      setMediaStatus("");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-model-bar">
        <span className="hint">Модель:</span>
        <input
          className="chat-model-input"
          value={conversation.model ?? settings.model}
          onChange={(e) => updateModel(e.target.value)}
          list="chat-view-models-list"
          placeholder={settings.model}
        />
        <datalist id="chat-view-models-list">
          {chatModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
        {conversation.model && conversation.model !== settings.model && (
          <button className="link-btn" onClick={() => updateModel("")} title="Вернуть модель по умолчанию из настроек">
            сбросить к настройкам
          </button>
        )}
      </div>
      {conversation.messages.length > 0 && (
        <div className="chat-export-bar">
          <span className="hint">Экспорт всего чата:</span>
          <button className="link-btn" onClick={() => exportConversation("pdf")}>
            в PDF
          </button>
          <button className="link-btn" onClick={() => exportConversation("png")}>
            в PNG
          </button>
        </div>
      )}
      {pendingMedia && (
        <div className="pending-skill-banner">
          Предложена генерация: {mediaTypeLabel(pendingMedia.type)}, модель «{pendingMedia.model}» — «
          {pendingMedia.prompt.slice(0, 80)}
          {pendingMedia.prompt.length > 80 ? "…" : ""}».
          {mediaGenerating ? (
            <span className="hint"> {mediaStatus}</span>
          ) : (
            <>
              <button className="btn btn-primary" onClick={runMediaGeneration}>
                Сгенерировать
              </button>
              <button className="btn btn-secondary" onClick={() => setPendingMedia(null)}>
                Отклонить
              </button>
            </>
          )}
        </div>
      )}
      {mediaError && <div className="chat-error">Не удалось сгенерировать: {mediaError}</div>}
      {mediaResult && mediaPreviewUrl && (
        <div className="media-result-card">
          {mediaResult.type === "image" && <img src={mediaPreviewUrl} alt={mediaResult.prompt} />}
          {mediaResult.type === "video" && <video src={mediaPreviewUrl} controls />}
          {mediaResult.type === "audio" && <audio src={mediaPreviewUrl} controls />}
          <div className="media-result-actions">
            <span className="hint">{mediaResult.fileName}</span>
            <button className="link-btn" onClick={() => window.api.openMediaFolder(projectId)}>
              Открыть папку
            </button>
          </div>
        </div>
      )}
      <div className="chat-messages">
        {conversation.messages.length === 0 && !streamingText && (
          <div className="chat-empty-hint">{emptyHint ?? "Начните диалог — сообщение ниже."}</div>
        )}
        {conversation.messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "Ассистент"}</div>
            <Markdown text={m.content} accentColor={brand?.accentColor} />
            <div className="msg-export-actions">
              <button className="link-btn" onClick={() => exportMessage(m, "pdf")}>
                Экспорт в PDF
              </button>
              <button className="link-btn" onClick={() => exportMessage(m, "png")}>
                Экспорт в PNG
              </button>
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-role">Ассистент</div>
            <Markdown text={streamingText || "…"} accentColor={brand?.accentColor} />
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        {exportError && <div className="chat-error">Не удалось экспортировать: {exportError}</div>}
        <div ref={bottomRef} />
      </div>
      {skills && skills.length > 0 && (
        <div className="chat-skill-bar">
          {(() => {
            const attachedSkill = skills.find((s) => s.id === attachedSkillId);
            if (attachedSkill) {
              return (
                <span className="skill-chip">
                  🎯 {attachedSkill.name}
                  <button className="skill-chip-remove" onClick={() => setAttachedSkillId(null)} title="Убрать навык">
                    ×
                  </button>
                </span>
              );
            }
            return (
              <div className="skill-picker-wrap">
                <button className="link-btn" onClick={() => setShowSkillPicker((v) => !v)}>
                  🎯 Вызвать навык
                </button>
                {showSkillPicker && (
                  <div className="skill-picker-menu">
                    {skills.map((s) => (
                      <button
                        key={s.id}
                        className="skill-picker-item"
                        onClick={() => {
                          setAttachedSkillId(s.id);
                          setShowSkillPicker(false);
                        }}
                      >
                        <span className="skill-picker-name">{s.name}</span>
                        {s.description && <span className="skill-picker-desc">{s.description}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      <div className="chat-input-bar">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Напишите сообщение… (Enter — отправить, Shift+Enter — новая строка)"
          rows={3}
          disabled={busy}
        />
        {busy ? (
          <button className="btn btn-secondary" onClick={stop}>
            Остановить
          </button>
        ) : (
          <button className="btn btn-primary" onClick={send} disabled={!input.trim()}>
            Отправить
          </button>
        )}
      </div>
    </div>
  );
}
