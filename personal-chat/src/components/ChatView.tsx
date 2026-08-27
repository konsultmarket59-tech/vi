import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatMessage, Conversation, MediaGenerationResult, Settings, Skill } from "../lib/types";
import { MEDIA_SYNTAX_HINT, parseMediaRequest, uid, type ParsedMediaRequest } from "../lib/promptBuilder";
import { streamChat, listModels, ApiError, type ApiContentPart, type ApiMessage } from "../lib/api";
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
  /**
   * Extra read-only tools this chat offers, on top of web search. Returns text to
   * feed back to the model, or null when the reply asked for nothing. The Excel
   * agent uses it to evaluate formulas and read ranges against the live workbook.
   */
  extraTools?: (assistantText: string) => Promise<string | null>;
  /** What to show while an extraTools call is running. */
  extraToolLabel?: string;
  /**
   * Text to drop into the input box. Every distinct value is applied once, so the
   * caller can push the same question twice by bumping the counter alongside it —
   * used by the Excel grid to ask about whichever cell is selected.
   */
  prefill?: { text: string; nonce: number };
}

type ExportFormat = "pdf" | "png" | "docx" | "xlsx";

/**
 * How much conversation history is sent to the model, in characters.
 *
 * The whole chat used to go up on every turn, which is fine for twenty messages and
 * ruinous for four hundred: cost grows with the square of the conversation, and past
 * the model's context window the request simply fails. Roughly two characters per
 * token for Russian text puts this near 60k tokens of history — generous for any real
 * conversation, well inside every model's window, and leaving room for the project's
 * documents in the system prompt.
 */
const CONTEXT_CHAR_BUDGET = 120000;

/** Older messages are worth folding into a summary once a chat passes this. */
const FOLD_SUGGESTION_CHARS = 60000;

function totalChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

/**
 * The newest messages that fit in the budget, oldest-first. At least the last
 * exchange is always kept, however long it is — sending nothing would be worse than
 * sending one oversized message.
 */
function messagesWithinBudget(messages: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    used += messages[i].content.length;
    if (used > CONTEXT_CHAR_BUDGET && kept.length >= 2) break;
    kept.unshift(messages[i]);
  }
  return kept;
}

const WEB_TOOL_ROUND_LIMIT = 4;

/** Short human-readable label of what the assistant just asked the app to look up. */
function describeWebTool(assistantText: string): string {
  const query = /===WEB SEARCH===[\s\S]*?QUERY:\s*(.*)/.exec(assistantText)?.[1]?.trim();
  if (query) return `🌐 Ищу в интернете: «${query}»…`;
  const url = /===WEB FETCH===[\s\S]*?URL:\s*(\S+)/.exec(assistantText)?.[1]?.trim();
  if (url) return `🌐 Читаю страницу ${url}…`;
  return "🌐 Обращаюсь к интернету…";
}

const ATTACHMENT_ICONS: Record<ChatAttachment["kind"], string> = {
  text: "📄",
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  other: "📎",
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

/**
 * Builds the API message for a user turn that has files attached.
 *
 * Text documents are inlined into the prompt (their text was already extracted at
 * attach time). Images become proper image parts so vision-capable models can
 * actually look at them. Video and audio can't be sent to a chat model at all, so
 * they're passed as a named reference — enough for the assistant to reason about
 * and to hand to the media tools, without pretending it can watch or listen to them.
 */
function buildUserContent(text: string, attachments: ChatAttachment[], imageDataUrls: Map<string, string>) {
  const notes: string[] = [];
  const imageParts: ApiContentPart[] = [];

  for (const att of attachments) {
    if (att.error) {
      notes.push(`--- Файл: ${att.name} ---\n[Не удалось прочитать: ${att.error}]`);
    } else if (att.kind === "text" && att.text) {
      notes.push(`--- Файл: ${att.name} ---\n${att.text}`);
    } else if (att.kind === "image") {
      const dataUrl = imageDataUrls.get(att.path);
      if (dataUrl) imageParts.push({ type: "image_url", image_url: { url: dataUrl } });
      else notes.push(`--- Изображение: ${att.name} (${att.path}) — не удалось прочитать файл ---`);
    } else {
      notes.push(
        `--- ${att.kind === "video" ? "Видеофайл" : att.kind === "audio" ? "Аудиофайл" : "Файл"}: ${att.name} ---\n` +
          `Путь: ${att.path}, размер ${formatSize(att.size)}. Содержимое такого файла модели напрямую не передаётся — ` +
          `опирайся на то, что скажет о нём пользователь.`
      );
    }
  }

  const combined = notes.length > 0 ? `${text}\n\n=== ПРИЛОЖЕННЫЕ ФАЙЛЫ ===\n\n${notes.join("\n\n")}` : text;
  if (imageParts.length === 0) return combined;
  return [{ type: "text", text: combined } as ApiContentPart, ...imageParts];
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
  extraTools,
  extraToolLabel,
  prefill,
}: Props) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [attachedSkillId, setAttachedSkillId] = useState<string | null>(null);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [chatModels, setChatModels] = useState(CURATED_CHAT_MODELS);
  const [webToolsHint, setWebToolsHint] = useState("");
  const [webToolStatus, setWebToolStatus] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [trimmedCount, setTrimmedCount] = useState(0);
  const [folding, setFolding] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<ParsedMediaRequest | null>(null);
  const [mediaGenerating, setMediaGenerating] = useState(false);
  const [mediaStatus, setMediaStatus] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaGenerationResult | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Applied per nonce rather than per text, so asking about the same cell twice in
  // a row still puts the question back in the box.
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    inputRef.current?.focus();
  }, [prefill?.nonce]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, streamingText]);

  useEffect(() => {
    // Empty string when web access is switched off in Settings, which is also what
    // keeps the hint out of the system prompt entirely in that case.
    window.api.getWebToolsHint().then(setWebToolsHint).catch(() => setWebToolsHint(""));
  }, [settings.searchEnabled, settings.searchProvider]);

  useEffect(() => {
    listModels(settings.baseUrl, settings.apiKey, "chat")
      .then((fetched) => setChatModels(mergeModelLists(CURATED_CHAT_MODELS, fetched)))
      .catch(() => {
        // keep the curated shortlist as-is — the picker still works without the live catalog
      });
  }, [settings.baseUrl, settings.apiKey]);

  async function pickAttachments() {
    setAttaching(true);
    try {
      const picked = await window.api.pickAttachments();
      if (picked.length > 0) setAttachments((prev) => [...prev, ...picked]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttaching(false);
    }
  }

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
    // Attachments alone are a valid turn ("посмотри этот файл") — don't require typed text.
    if ((!text && attachments.length === 0) || busy) return;
    setError(null);
    setInput("");
    const sentAttachments = attachments;
    setAttachments([]);

    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
      createdAt: Date.now(),
    };
    const withUser: Conversation = {
      ...conversation,
      messages: [...conversation.messages, userMsg],
      updatedAt: Date.now(),
      title:
        conversation.title === "Новый чат"
          ? (text || sentAttachments.map((a) => a.name).join(", ")).slice(0, 60)
          : conversation.title,
    };
    onUpdate(withUser);
    await onSave(withUser);

    const attachedSkill = skills?.find((s) => s.id === attachedSkillId);
    const skillPrompt = attachedSkill
      ? `\n\n--- Навык (вызван для этого сообщения): ${attachedSkill.name} ---\n${
          attachedSkill.description ? attachedSkill.description + "\n" : ""
        }${attachedSkill.content}`
      : "";
    // Only the tail of a long chat travels with each request; anything folded away
    // earlier is represented by its summary, and anything merely over budget is
    // reported to the user rather than dropped silently.
    const sentMessages = messagesWithinBudget(withUser.messages);
    const droppedCount = withUser.messages.length - sentMessages.length;
    setTrimmedCount(droppedCount);

    const historyNote = withUser.summary
      ? `\n\n--- Что было раньше в этом чате (краткое изложение) ---\n${withUser.summary}`
      : "";
    const dropNote = droppedCount
      ? `\n\n(Примечание: ${droppedCount} более ранних сообщений этого чата не переданы — они не поместились в контекст. ` +
        "Если пользователь ссылается на что-то, чего ты не видишь, попроси напомнить.)"
      : "";

    const apiMessages: ApiMessage[] = [
      {
        role: "system",
        content:
          systemPrompt + skillPrompt + "\n\n" + CHART_SYNTAX_HINT + "\n\n" + MEDIA_SYNTAX_HINT +
          (webToolsHint ? "\n\n" + webToolsHint : "") + historyNote + dropNote,
      },
      ...(await Promise.all(
        sentMessages.map(async (m) => {
          if (!m.attachments || m.attachments.length === 0) {
            return { role: m.role, content: m.content } as ApiMessage;
          }
          // Images live on disk, not in the saved chat — read them back now.
          const imageDataUrls = new Map<string, string>();
          for (const att of m.attachments.filter((a) => a.kind === "image")) {
            try {
              imageDataUrls.set(att.path, await window.api.readFileAsDataUrl(att.path));
            } catch {
              // fall through: buildUserContent notes the unreadable image by name
            }
          }
          return { role: m.role, content: buildUserContent(m.content, m.attachments, imageDataUrls) } as ApiMessage;
        })
      )),
    ];

    setBusy(true);
    setStreamingText("");
    const controller = new AbortController();
    abortRef.current = controller;

    const effectiveSettings = conversation.model && conversation.model !== settings.model
      ? { ...settings, model: conversation.model }
      : settings;

    try {
      let full = await streamChat(
        effectiveSettings,
        apiMessages,
        (chunk) => setStreamingText((prev) => prev + chunk),
        controller.signal
      );

      // Web-tool loop. Search and page reads are read-only, so unlike the app's
      // mutating actions (media generation, file edits, ops edits) they don't go
      // through propose-then-confirm — they just run and get fed back, and only
      // the assistant's final prose is what lands in the saved conversation.
      for (let round = 0; round < WEB_TOOL_ROUND_LIMIT; round++) {
        const extraOutput = extraTools ? await extraTools(full) : null;
        const toolOutput = extraOutput ?? (await window.api.runWebTools(full));
        if (toolOutput == null) break;
        setWebToolStatus(extraOutput != null ? extraToolLabel || "⏳ Считаю…" : describeWebTool(full));
        apiMessages.push({ role: "assistant", content: full });
        apiMessages.push({ role: "user", content: toolOutput });
        setStreamingText("");
        full = await streamChat(
          effectiveSettings,
          apiMessages,
          (chunk) => setStreamingText((prev) => prev + chunk),
          controller.signal
        );
      }
      setWebToolStatus("");

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
      setWebToolStatus("");
      abortRef.current = null;
      setAttachedSkillId(null);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  /**
   * Brand details the Word/Excel exports can use. They lay out their own document,
   * so they take the colour and contacts rather than the rendered HTML header.
   */
  function exportBrand() {
    if (!brand) return undefined;
    const contactLines = [brand.companyName, brand.contactPhone, brand.contactEmail].filter(
      (line): line is string => !!line
    );
    return { accentColor: brand.accentColor, contactLines };
  }

  /**
   * Folds the older half of a long chat into a written summary.
   *
   * The originals are archived to a file *before* anything is removed, so this is
   * lossless from the user's point of view: the chat gets light again, the model
   * keeps the gist, and the full text stays on disk. The most recent exchanges are
   * left intact — those are the ones still being worked on.
   */
  async function foldHistory() {
    const messages = conversation.messages;
    if (messages.length < 8) return;
    const keepFrom = Math.max(2, messages.length - 6);
    const older = messages.slice(0, keepFrom);
    const recent = messages.slice(keepFrom);
    if (!confirm(`Свернуть ${older.length} ранних сообщений в краткое изложение? Полный текст сохранится в файл.`)) {
      return;
    }

    setFolding(true);
    setError(null);
    try {
      const { path: archivePath } = await window.api.archiveConversationMessages(
        projectId ?? "",
        conversation,
        older
      );

      const transcript = older
        .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
        .join("\n\n");
      const summary = await streamChat(
        settings,
        [
          {
            role: "system",
            content:
              "Ты сжимаешь переписку так, чтобы по изложению можно было продолжить работу. Сохрани: принятые " +
              "решения, готовые формулировки и цифры, договорённости, открытые вопросы. Убери приветствия, " +
              "повторы и рассуждения. Пиши по-русски, структурировано, до 400 слов.",
          },
          { role: "user", content: (conversation.summary ? conversation.summary + "\n\n" : "") + transcript },
        ],
        () => {},
        undefined
      );

      const folded: Conversation = {
        ...conversation,
        summary,
        messages: recent,
        updatedAt: Date.now(),
      };
      onUpdate(folded);
      await onSave(folded);
      setTrimmedCount(0);
      setExportError(null);
      alert(`Готово. Полная переписка сохранена: ${archivePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFolding(false);
    }
  }

  async function exportMessage(m: ChatMessage, format: ExportFormat) {
    setExportError(null);
    try {
      const defaultName = deriveFileName(m.content);
      if (format === "docx" || format === "xlsx") {
        const payload = {
          title: defaultName,
          sections: [{ role: m.role, content: m.content }],
          brand: exportBrand(),
          defaultName,
          projectId,
        };
        if (format === "docx") await window.api.exportChatToDocx(payload);
        else await window.api.exportChatToXlsx(payload);
        return;
      }
      const html = buildMessageExportHtml(defaultName, m.content, brand);
      const payload = { html, defaultName, projectId };
      if (format === "pdf") await window.api.exportToPdf(payload);
      else await window.api.exportToPng(payload);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportConversation(format: ExportFormat) {
    setExportError(null);
    try {
      if (format === "docx" || format === "xlsx") {
        const payload = {
          title: conversation.title,
          sections: conversation.messages.map((m) => ({ role: m.role, content: m.content })),
          brand: exportBrand(),
          defaultName: conversation.title,
          projectId,
        };
        if (format === "docx") await window.api.exportChatToDocx(payload);
        else await window.api.exportChatToXlsx(payload);
        return;
      }
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
      {(trimmedCount > 0 || totalChars(conversation.messages) > FOLD_SUGGESTION_CHARS) && (
        <div className="chat-fold-bar">
          <span className="hint">
            {trimmedCount > 0
              ? `Чат длинный: ${trimmedCount} ранних сообщений уже не помещаются в память модели.`
              : `Чат разросся (${Math.round(totalChars(conversation.messages) / 1000)} тыс. симв.) — каждый ответ обходится дороже и медленнее.`}
          </span>
          <button className="link-btn" onClick={foldHistory} disabled={folding || busy}>
            {folding ? "Сворачиваю…" : "Свернуть историю в резюме"}
          </button>
        </div>
      )}
      {conversation.summary && (
        <div className="chat-fold-bar">
          <span className="hint">
            📝 Ранняя часть переписки свёрнута в изложение — ассистент её помнит, полный текст в папке
            чата (<code>archive</code>).
          </span>
        </div>
      )}
      {conversation.messages.length > 0 && (
        <div className="chat-export-bar">
          <span className="hint">Экспорт всего чата:</span>
          <button className="link-btn" onClick={() => exportConversation("pdf")}>
            в PDF
          </button>
          <button className="link-btn" onClick={() => exportConversation("png")}>
            в PNG
          </button>
          <button className="link-btn" onClick={() => exportConversation("docx")}>
            в Word
          </button>
          <button className="link-btn" onClick={() => exportConversation("xlsx")}>
            в Excel
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
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg-attachments">
                {m.attachments.map((att, i) => (
                  <span key={`${att.path}-${i}`} className="attachment-chip">
                    {ATTACHMENT_ICONS[att.kind]} {att.name}
                  </span>
                ))}
              </div>
            )}
            <Markdown text={m.content} accentColor={brand?.accentColor} />
            <div className="msg-export-actions">
              <button className="link-btn" onClick={() => exportMessage(m, "pdf")}>
                Экспорт в PDF
              </button>
              <button className="link-btn" onClick={() => exportMessage(m, "png")}>
                Экспорт в PNG
              </button>
              <button className="link-btn" onClick={() => exportMessage(m, "docx")}>
                в Word
              </button>
              <button className="link-btn" onClick={() => exportMessage(m, "xlsx")}>
                в Excel
              </button>
            </div>
          </div>
        ))}
        {busy && (
          <div className="msg msg-assistant">
            <div className="msg-role">Ассистент</div>
            {webToolStatus && <div className="web-tool-status">{webToolStatus}</div>}
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
      {attachments.length > 0 && (
        <div className="chat-attachments-bar">
          {attachments.map((att, i) => (
            <span key={`${att.path}-${i}`} className={att.error ? "attachment-chip attachment-chip-error" : "attachment-chip"}>
              {ATTACHMENT_ICONS[att.kind]} {att.name}
              <span className="attachment-size">{formatSize(att.size)}</span>
              {att.error && <span className="attachment-error" title={att.error}>не прочитан</span>}
              <button
                className="skill-chip-remove"
                onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                title="Убрать файл"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="chat-input-bar">
        <button
          className="btn btn-secondary attach-btn"
          onClick={pickAttachments}
          disabled={busy || attaching}
          title="Прикрепить файл с компьютера"
        >
          {attaching ? "…" : "+"}
        </button>
        <textarea
          ref={inputRef}
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
          <button className="btn btn-primary" onClick={send} disabled={!input.trim() && attachments.length === 0}>
            Отправить
          </button>
        )}
      </div>
    </div>
  );
}
