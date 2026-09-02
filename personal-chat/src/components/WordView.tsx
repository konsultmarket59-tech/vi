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
type AgentMode = "edit" | "analyze";

/**
 * Правки из ещё не дописанного ответа.
 *
 * Обычный разбор ждёт закрывающий маркер, а он приходит последним — до него человек
 * не видел ничего. Здесь маркер конца не нужен: строки разбираются по мере поступления,
 * поэтому правка подсвечивается в документе, пока агент её ещё диктует.
 */
function parsePartialEdit(text: string): Map<number, string> {
  const preview = new Map<number, string>();
  const start = text.indexOf("===WORD EDIT START===");
  if (start === -1) return preview;
  const body = text.slice(start + "===WORD EDIT START===".length).split("===WORD EDIT END===")[0];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    const set = /^SET\s+(\d+)\s*:\s*([\s\S]*)$/i.exec(line);
    if (set) preview.set(Number(set[1]), set[2]);
    const del = /^DELETE\s+(\d+)$/i.exec(line);
    if (del) preview.set(Number(del[1]), "");
  }
  return preview;
}

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
  /** "edit" — агент предлагает правки, "analyze" — только разбирает и ничего не меняет. */
  const [agentMode, setAgentMode] = useState<AgentMode>("edit");
  /** Правки, которые агент диктует прямо сейчас: показываются в документе по ходу ответа. */
  const [livePreview, setLivePreview] = useState<Map<number, string>>(new Map());
  const [lastAnalysis, setLastAnalysis] = useState("");

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

  /**
   * Открывает агента с ЧИСТЫМ разговором.
   *
   * Прошлая переписка по документу намеренно не восстанавливается: по одному и тому
   * же файлу работа каждый раз новая, а старые правки в контексте и мешают агенту,
   * и заново оплачиваются на каждом запросе.
   */
  async function openAgent(nextMode: Mode = "dock", forMode: AgentMode = agentMode) {
    setMode(nextMode);
    try {
      setAgentPrompt(await window.api.buildWordAgentPrompt(forMode));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setPendingEdit(null);
    setLivePreview(new Map());
    setLastAnalysis("");
    handledEditIdRef.current = null;
    const conv: Conversation = {
      id: uid(),
      projectId: "__word_agent__",
      title: forMode === "analyze" ? "Анализ документа" : "Агент Word",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await window.api.saveWordAgentConversation(conv);
    setAgentConv(conv);
  }

  async function switchAgentMode(next: AgentMode) {
    setAgentMode(next);
    await openAgent(mode === "doc" ? "dock" : mode, next);
  }

  async function saveAnalysis() {
    if (!lastAnalysis) return;
    setBusy(true);
    try {
      const dest = await window.api.saveWordAnalysis(lastAnalysis, `Анализ — ${doc?.name?.replace(/\.docx$/i, "") || "документ"}`);
      if (dest) showNote(`Анализ сохранён: ${dest}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
        <div className="word-mode-switch">
          <button
            className={agentMode === "edit" ? "tab active" : "tab"}
            onClick={() => switchAgentMode("edit")}
          >
            Правки
          </button>
          <button
            className={agentMode === "analyze" ? "tab active" : "tab"}
            onClick={() => switchAgentMode("analyze")}
          >
            Анализ
          </button>
        </div>
        <p className="hint ops-agent-hint">
          {agentMode === "edit"
            ? "Агент видит весь документ по блокам и правит только то, о чём вы попросили — остальной текст и всё форматирование остаются как были. Правка сначала подсвечивается прямо в документе, применяете её вы. Файл на диске меняется только после «Сохранить». Под полем ввода есть 🎯 — можно подключить навык."
            : "Разбор без правок: ошибки, противоречия, риски, выводы, отчёт по документу. Сам документ в этом режиме не меняется — результат можно сохранить отдельным файлом."}
        </p>
        {agentMode === "analyze" && lastAnalysis && (
          <div className="excel-pending-actions">
            <button className="btn btn-primary" onClick={saveAnalysis} disabled={busy}>
              Сохранить результат в документ
            </button>
          </div>
        )}
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
            onStreamingText={(text) => {
              if (agentMode === "edit") setLivePreview(parsePartialEdit(text));
            }}
            onAssistantMessage={(content) => {
              handledEditIdRef.current = null;
              setEditExpanded(false);
              setLivePreview(new Map());
              if (agentMode === "analyze") {
                setLastAnalysis(content);
                setPendingEdit(null);
              } else {
                setPendingEdit(parseWordEdit(content));
              }
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
                    {doc.blocks.map((b) => {
                      // Правка, которую агент диктует прямо сейчас. Показывается тут же,
                      // в самом документе: старый текст зачёркнут, новый под ним — видно,
                      // что именно меняется, ещё до подтверждения.
                      const incoming = livePreview.has(b.index) ? livePreview.get(b.index) : undefined;
                      return (
                        <div
                          key={b.index}
                          className={
                            "word-block" +
                            (b.index === selected ? " active" : "") +
                            (b.level ? ` word-h${b.level}` : "") +
                            (b.kind === "list" ? " word-list" : "") +
                            (incoming !== undefined ? " word-block-incoming" : "")
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
                          ) : incoming !== undefined ? (
                            <span className="word-block-text">
                              <span className="word-text-old">{b.text}</span>
                              {incoming ? (
                                <span className="word-text-new">{incoming}</span>
                              ) : (
                                <span className="word-text-removed">удаляется</span>
                              )}
                            </span>
                          ) : (
                            <span className="word-block-text">{b.text || <span className="hint">(пусто)</span>}</span>
                          )}
                        </div>
                      );
                    })}
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
