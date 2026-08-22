import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation, Settings } from "../lib/types";
import { uid } from "../lib/promptBuilder";
import { streamChat, ApiError, type ApiMessage } from "../lib/api";
import { buildConversationExportHtml, buildMessageExportHtml, type BrandKit } from "../lib/exportHtml";
import { CHART_SYNTAX_HINT } from "../lib/markdownRender";
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
}

function deriveFileName(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "документ";
  return firstLine.replace(/[#*`_>-]/g, "").trim().slice(0, 50) || "документ";
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
}: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, streamingText]);

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

    const apiMessages: ApiMessage[] = [
      { role: "system", content: systemPrompt + "\n\n" + CHART_SYNTAX_HINT },
      ...withUser.messages.map((m) => ({ role: m.role, content: m.content }) as ApiMessage),
    ];

    setBusy(true);
    setStreamingText("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const full = await streamChat(
        settings,
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
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else if (e instanceof DOMException && e.name === "AbortError") setError("Отменено.");
      else setError(String(e));
    } finally {
      setBusy(false);
      setStreamingText("");
      abortRef.current = null;
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-view">
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
