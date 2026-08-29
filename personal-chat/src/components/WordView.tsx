import { useEffect, useRef, useState } from "react";
import type { Conversation, Settings, Skill, WordBlock, WordDocument } from "../lib/types";
import { parseWordEdit, uid, type ParsedWordEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

/** "dock" keeps the document visible with the agent beside it; "agent" gives it the window. */
type Mode = "doc" | "dock" | "agent";

const STYLE_CHOICES = [
  { value: "", label: "Обычный текст" },
  { value: "Heading1", label: "Заголовок 1" },
  { value: "Heading2", label: "Заголовок 2" },
  { value: "Heading3", label: "Заголовок 3" },
  { value: "ListParagraph", label: "Пункт списка" },
];

function blockLabel(block: WordBlock): string {
  if (block.kind === "table") return `Таблица · ${block.rows.length} строк`;
  if (block.level) return `Заголовок ${block.level}`;
  if (block.kind === "list") return "Пункт списка";
  return "Абзац";
}

export default function WordView({ settings, skills, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("doc");
  const [doc, setDoc] = useState<WordDocument | null>(null);
  const [selected, setSelected] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [insertStyle, setInsertStyle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ParsedWordEdit | null>(null);
  const [editExpanded, setEditExpanded] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | undefined>();
  const handledEditIdRef = useRef<string | null>(null);

  const block = doc?.blocks.find((b) => b.index === selected);

  useEffect(() => {
    setDraft(block?.text ?? "");
  }, [selected, doc]);

  function showNote(text: string, ms = 5000) {
    setNote(text);
    setTimeout(() => setNote(null), ms);
  }

  /** Same reasoning as in Excel: the conversation belongs to the open document. */
  async function resetAgentForNewDocument() {
    setAgentConv(null);
    setPendingEdit(null);
    setEditExpanded(false);
    handledEditIdRef.current = null;
    if (mode !== "doc") await openAgent(mode);
  }

  async function openFile() {
    setError(null);
    const filePath = await window.api.pickWordFile();
    if (!filePath) return;
    setBusy(true);
    try {
      const opened = await window.api.openWordFile(filePath);
      setDoc(opened);
      setSelected(opened.blocks[0]?.index ?? 0);
      await resetAgentForNewDocument();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function newDocument() {
    setError(null);
    setBusy(true);
    try {
      const created = await window.api.newWordDocument("Новый документ.docx");
      setDoc(created);
      setSelected(0);
      await resetAgentForNewDocument();
      showNote("Документ создан. Он появится на диске, когда вы нажмёте «Сохранить».");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commitDraft() {
    if (!doc || !block || block.kind === "table") return;
    if (draft === block.text) return;
    setBusy(true);
    setError(null);
    try {
      setDoc(await window.api.setWordBlockText(selected, draft));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function insertAfter() {
    if (!doc) return;
    setBusy(true);
    try {
      const updated = await window.api.insertWordParagraph(selected, "Новый абзац", insertStyle);
      setDoc(updated);
      setSelected(selected + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeBlock() {
    if (!doc || !block) return;
    if (!confirm(`Удалить блок №${selected + 1}?`)) return;
    setBusy(true);
    try {
      const updated = await window.api.deleteWordBlock(selected);
      setDoc(updated);
      setSelected(Math.max(0, selected - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(saveAs: boolean) {
    setBusy(true);
    setError(null);
    try {
      const dest = await window.api.saveWordFile(saveAs);
      if (dest) {
        showNote(`Сохранено: ${dest}`);
        if (saveAs) setDoc((d) => (d ? { ...d, filePath: dest, name: dest.split(/[\\/]/).pop() ?? d.name } : d));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openAgent(nextMode: Mode = "dock") {
    setMode(nextMode);
    try {
      setAgentPrompt(await window.api.buildWordAgentPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const existing = await window.api.getWordAgentConversation();
    if (existing) {
      setAgentConv(existing);
      handledEditIdRef.current = existing.handledEditId ?? null;
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last && last.id !== handledEditIdRef.current) setPendingEdit(parseWordEdit(last.content));
      else setPendingEdit(null);
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__word_agent__",
        title: "Агент Word",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveWordAgentConversation(conv);
      setAgentConv(conv);
    }
  }

  /** Asks the agent about the block in front of you, with its text already quoted. */
  async function askAboutSelection() {
    if (!block) return;
    const quoted = block.kind === "table" ? "таблица" : `«${block.text.slice(0, 200)}»`;
    setPrefill({ text: `Блок ${selected} (${blockLabel(block)}): ${quoted}. `, nonce: Date.now() });
    if (mode === "doc") await openAgent("dock");
  }

  function markEditHandled() {
    const last = [...(agentConv?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    if (last && agentConv) {
      const withMark = { ...agentConv, handledEditId: last.id };
      setAgentConv(withMark);
      window.api.saveWordAgentConversation(withMark);
      handledEditIdRef.current = last.id;
    }
    setPendingEdit(null);
  }

  async function applyPendingEdit() {
    if (!pendingEdit) return;
    setBusy(true);
    setError(null);
    try {
      setDoc(await window.api.applyWordAgentEdit(pendingEdit));
      markEditHandled();
      setAgentPrompt(await window.api.buildWordAgentPrompt());
      showNote("Правка применена. Файл на диске меняется только после «Сохранить».");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function describeOp(op: ParsedWordEdit["ops"][number]): string {
    if (op.op === "set") return `Заменить блок ${op.index}: «${op.text.slice(0, 80)}»`;
    if (op.op === "delete") return `Удалить блок ${op.index}`;
    return `Вставить после ${op.index}${op.style ? ` [${op.style}]` : ""}: «${op.text.slice(0, 80)}»`;
  }

  function renderAgentPanel(compact: boolean) {
    return (
      <div className={compact ? "excel-agent-pane" : "ops-app-body ops-app-agent"}>
        <p className="hint ops-agent-hint">
          Агент видит весь документ по блокам и может переписывать абзацы, добавлять заголовки и пункты,
          удалять лишнее. Любое изменение он сначала предлагает — применяете вы. Файл на диске меняется
          только когда вы нажмёте «Сохранить». Под полем ввода есть 🎯 — можно подключить навык.
        </p>
        {!settings.apiKey && (
          <div className="warning-banner">
            API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        {pendingEdit && (
          <div className="pending-skill-banner excel-pending-edit">
            <div className="excel-pending-summary">
              <strong>Предложена правка: {pendingEdit.ops.length} действ.</strong>
              <button className="link-btn" onClick={() => setEditExpanded((v) => !v)}>
                {editExpanded ? "свернуть" : "показать подробно"}
              </button>
            </div>
            {editExpanded && (
              <div className="excel-pending-details">
                {pendingEdit.ops.map((op, i) => (
                  <div key={i} className="excel-pending-sheet">
                    {describeOp(op)}
                  </div>
                ))}
              </div>
            )}
            <div className="excel-pending-actions">
              <button className="btn btn-primary" onClick={applyPendingEdit} disabled={busy}>
                Применить
              </button>
              <button className="btn btn-secondary" onClick={markEditHandled}>
                Отклонить
              </button>
            </div>
          </div>
        )}
        {agentConv && (
          <ChatView
            conversation={agentConv}
            systemPrompt={agentPrompt}
            settings={settings}
            skills={skills}
            prefill={prefill}
            onUpdate={setAgentConv}
            onSave={(conv) => window.api.saveWordAgentConversation(conv)}
            emptyHint="Например: «Перепиши третий абзац строже» или «Добавь раздел про сроки после пункта 2»."
            onAssistantMessage={(content) => {
              handledEditIdRef.current = null;
              setEditExpanded(false);
              setPendingEdit(parseWordEdit(content));
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📘</span>
            <h2>Word {doc && <span className="excel-file-name">— {doc.name}</span>}</h2>
          </div>
          <div>
            {mode !== "agent" ? (
              <>
                <button className="btn btn-secondary" onClick={openFile} disabled={busy}>
                  Открыть файл
                </button>
                <button className="btn btn-secondary" onClick={newDocument} disabled={busy}>
                  Новый документ
                </button>
                {doc && (
                  <>
                    <button className="btn btn-secondary" onClick={() => save(false)} disabled={busy}>
                      Сохранить
                    </button>
                    <button className="btn btn-secondary" onClick={() => save(true)} disabled={busy}>
                      Сохранить как…
                    </button>
                    {mode === "dock" ? (
                      <>
                        <button className="btn btn-secondary" onClick={() => setMode("agent")}>
                          ⤢ Развернуть агента
                        </button>
                        <button className="btn btn-secondary" onClick={() => setMode("doc")}>
                          Закрыть агента
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-primary" onClick={() => openAgent("dock")}>
                        🤖 Агент Word
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <button className="btn btn-secondary" onClick={() => setMode("dock")}>
                ← К документу
              </button>
            )}
          </div>
        </div>

        {mode !== "agent" && (
          <div className={mode === "dock" ? "ops-app-body excel-split" : "ops-app-body"}>
            <div className="excel-grid-pane">
              {!doc ? (
                <p className="hint ops-app-empty">
                  Откройте документ Word с компьютера — он останется на своём месте, приложение работает прямо
                  с ним. Меняется только текст, который вы правите: стили, колонтитулы, картинки, нумерация и
                  всё остальное оформление сохраняются как были. «Новый документ» создаёт пустой файл.
                </p>
              ) : (
                <>
                  <div className="word-toolbar">
                    <select value={insertStyle} onChange={(e) => setInsertStyle(e.target.value)}>
                      {STYLE_CHOICES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn-secondary" onClick={insertAfter} disabled={busy}>
                      + Вставить после выбранного
                    </button>
                    <button className="btn btn-secondary" onClick={removeBlock} disabled={busy || !block}>
                      Удалить блок
                    </button>
                    <button className="btn btn-secondary word-ask-btn" onClick={askAboutSelection} disabled={!block}>
                      🤖 Спросить про блок {selected}
                    </button>
                  </div>

                  {error && <div className="chat-error">{error}</div>}
                  {note && <p className="hint">{note}</p>}

                  <div className="word-editor">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitDraft}
                      placeholder={block?.kind === "table" ? "Таблицы правятся в самом Word" : "Текст блока"}
                      disabled={busy || block?.kind === "table"}
                      rows={3}
                    />
                    <span className="hint">
                      {block ? `Блок ${selected} · ${blockLabel(block)}` : "Выберите блок"}
                      {block && block.kind !== "table" && (
                        <>
                          {" · "}при правке абзац становится однородным по начертанию: если внутри было и жирное,
                          и обычное, всё примет вид первого фрагмента
                        </>
                      )}
                    </span>
                  </div>

                  <div className="word-blocks">
                    {doc.blocks.map((b) => (
                      <div
                        key={b.index}
                        className={
                          "word-block" +
                          (b.index === selected ? " active" : "") +
                          (b.level ? ` word-h${b.level}` : "") +
                          (b.kind === "list" ? " word-list" : "")
                        }
                        onClick={() => setSelected(b.index)}
                      >
                        <span className="word-block-index">{b.index}</span>
                        {b.kind === "table" ? (
                          <table className="ops-table word-block-table">
                            <tbody>
                              {b.rows.map((row, r) => (
                                <tr key={r}>
                                  {row.map((cell, c) => (
                                    <td key={c}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <span className="word-block-text">{b.text || <span className="hint">(пусто)</span>}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {mode === "dock" && renderAgentPanel(true)}
          </div>
        )}

        {mode === "agent" && renderAgentPanel(false)}
      </div>
    </div>
  );
}
