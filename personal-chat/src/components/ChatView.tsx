import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation, Settings } from "../lib/types";
import { uid } from "../lib/promptBuilder";
import { streamChat, ApiError, type ApiMessage } from "../lib/api";
import Markdown from "./Markdown";

interface Props {
  conversation: Conversation;
  systemPrompt: string;
  settings: Settings;
  onUpdate: (conv: Conversation) => void;
  onSave: (conv: Conversation) => Promise<unknown>;
  emptyHint?: string;
  onAssistantMessage?: (content: string) => void;
}

export default function ChatView({
  conversation,
  systemPrompt,
  settings,
  onUpdate,
  onSave,
  emptyHint,
  onAssistantMessage,
}: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
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
      { role: "system", content: systemPrompt },
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {conversation.messages.length === 0 && !streamingText && (
          <div className="chat-empty-hint">{emptyHint ?? "Начните диалог — сообщение ниже."}</div>
        )}
        {conversation.messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-role">{m.role === "user" ? "Вы" : "Ассистент"}</div>
            <Markdown text={m.content} />
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-role">Ассистент</div>
            <Markdown text={streamingText || "…"} />
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
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
