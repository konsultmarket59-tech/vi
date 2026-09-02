import { useEffect, useRef, useState } from "react";
import type { Conversation, ExcelWorkbook, Settings, Skill } from "../lib/types";
import { parseExcelEdit, uid, type ParsedExcelEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

/**
 * "dock" keeps the table visible with the agent alongside — the mode for asking
 * about the cell in front of you. "agent" gives the conversation the whole window,
 * which is what long jobs like reconciling two sheets need.
 */
type Mode = "grid" | "dock" | "agent";

function colToLetters(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Renders a number the way its Excel number format asks for.
 *
 * Only the shapes that actually show up in these workbooks are handled — percents,
 * thousands separators, fixed decimals and a quoted literal like " ₽". Anything more
 * exotic falls through to the plain number, which is still readable; the real format
 * code travels with the cell and is what Excel itself will apply on open.
 */
function applyNumFmt(value: number, numFmt: string): string | null {
  const fmt = numFmt.trim();
  if (!fmt || /^general$/i.test(fmt)) return null;

  const suffix = /"([^"]*)"\s*$/.exec(fmt)?.[1] ?? "";
  const body = fmt.replace(/"[^"]*"/g, "");
  const isPercent = body.includes("%");
  const scaled = isPercent ? value * 100 : value;
  const decimals = /\.(0+)/.exec(body)?.[1].length ?? 0;
  const grouped = body.includes("#,#") || body.includes(",##");

  const text = scaled.toLocaleString("ru-RU", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return `${text}${isPercent ? "%" : ""}${suffix}`;
}

/** What a cell shows in the grid: the computed result, not the formula. */
function displayValue(cell: { value?: unknown; computed?: unknown; numFmt?: string } | undefined): string {
  if (!cell) return "";
  const v = cell.computed !== undefined && cell.computed !== null ? cell.computed : cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (cell.numFmt) {
      const formatted = applyNumFmt(v, cell.numFmt);
      if (formatted !== null) return formatted;
    }
    // Trim float noise (0.30000000000000004) without hiding genuinely long decimals.
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  }
  return String(v);
}

/** What goes in the editor when a cell is selected: the formula if there is one. */
function editValue(cell: { value?: unknown; formula?: string } | undefined): string {
  if (!cell) return "";
  if (cell.formula) return "=" + cell.formula;
  return cell.value === null || cell.value === undefined ? "" : String(cell.value);
}

/**
 * Правки из ещё не дописанного ответа.
 *
 * Готовый разбор ждёт закрывающий маркер, а он приходит последним — до него человек
 * не видел ничего. Здесь маркер дописывается искусственно, поэтому разбор ровно тот
 * же, что и у финального ответа, без второго парсера, который мог бы с ним разойтись.
 */
function parsePartialExcelEdit(text: string): Map<string, Map<string, string>> {
  const preview = new Map<string, Map<string, string>>();
  if (!text.includes("===EXCEL EDIT START===")) return preview;
  const closed = text.includes("===EXCEL EDIT END===") ? text : text + "\n===EXCEL EDIT END===";
  const parsed = parseExcelEdit(closed);
  for (const segment of parsed?.sheets ?? []) {
    const cells = new Map<string, string>();
    for (const cell of segment.cells) cells.set(cell.cell, cell.value);
    preview.set(segment.sheet, cells);
  }
  return preview;
}

export default function ExcelView({ settings, skills, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("grid");
  const [workbook, setWorkbook] = useState<ExcelWorkbook | null>(null);
  const [activeSheet, setActiveSheet] = useState("");
  const [selected, setSelected] = useState<string>("A1");
  const [editorValue, setEditorValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ParsedExcelEdit | null>(null);
  /**
   * Ячейки, которые агент диктует прямо сейчас: лист → адрес → новое значение.
   * Подсвечиваются в таблице по ходу ответа, как правки абзацев в Word.
   */
  const [livePreview, setLivePreview] = useState<Map<string, Map<string, string>>>(new Map());
  const [editExpanded, setEditExpanded] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | undefined>();

  /**
   * Id of the assistant message whose proposal was already applied or rejected.
   *
   * Without this the banner came back every time the agent was opened: the proposal
   * is re-derived from the last assistant message, and applying it doesn't change
   * that message. Stored with the conversation so it survives a restart.
   */
  const handledEditIdRef = useRef<string | null>(null);

  /** Shows the proposal from an assistant message unless it was already dealt with. */
  function offerEditFrom(message: { id: string; content: string } | undefined) {
    if (!message || message.id === handledEditIdRef.current) {
      setPendingEdit(null);
      return;
    }
    setPendingEdit(parseExcelEdit(message.content));
    setEditExpanded(false);
  }

  function markEditHandled() {
    const last = [...(agentConv?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    if (last) {
      handledEditIdRef.current = last.id;
      const withMark = { ...(agentConv as Conversation), handledEditId: last.id };
      setAgentConv(withMark);
      window.api.saveExcelAgentConversation(withMark);
    }
    setPendingEdit(null);
  }

  const sheet = workbook?.sheets.find((s) => s.name === activeSheet);

  useEffect(() => {
    setEditorValue(editValue(sheet?.cells[selected]));
  }, [selected, activeSheet, workbook]);

  /**
   * Forgets the conversation about the previous file.
   *
   * The agent's chat belongs to the document that is open: leaving it on screen after
   * opening another workbook meant the assistant kept discussing a file that was no
   * longer there. If the agent panel is open, it reloads for the new document.
   */
  async function resetAgentForNewDocument() {
    setAgentConv(null);
    setPendingEdit(null);
    setEditExpanded(false);
    handledEditIdRef.current = null;
    if (mode !== "grid") await openAgent(mode);
  }

  async function newWorkbook() {
    setError(null);
    setBusy(true);
    try {
      const wb = await window.api.newExcelWorkbook("Новая книга.xlsx");
      setWorkbook(wb);
      setActiveSheet(wb.sheets[0]?.name ?? "");
      setSelected("A1");
      await resetAgentForNewDocument();
      setSavedNote("Книга создана. Она появится на диске, когда вы нажмёте «Сохранить».");
      setTimeout(() => setSavedNote(null), 6000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openFile() {
    setError(null);
    const filePath = await window.api.pickExcelFile();
    if (!filePath) return;
    setBusy(true);
    try {
      const wb = await window.api.openExcelFile(filePath);
      setWorkbook(wb);
      setActiveSheet(wb.sheets[0]?.name ?? "");
      setSelected("A1");
      await resetAgentForNewDocument();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commitEdit() {
    if (!workbook || !sheet) return;
    if (editorValue === editValue(sheet.cells[selected])) return;
    setBusy(true);
    setError(null);
    try {
      setWorkbook(await window.api.setExcelCells([{ sheet: activeSheet, cell: selected, value: editorValue }]));
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
      const dest = await window.api.saveExcelFile(saveAs);
      if (dest) {
        setSavedNote(`Сохранено: ${dest}`);
        setTimeout(() => setSavedNote(null), 4000);
        if (saveAs) setWorkbook((wb) => (wb ? { ...wb, filePath: dest, name: dest.split(/[\\/]/).pop() ?? wb.name } : wb));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openAgent(nextMode: Mode = "agent") {
    setMode(nextMode);
    try {
      setAgentPrompt(await window.api.buildExcelAgentPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const existing = await window.api.getExcelAgentConversation();
    if (existing) {
      setAgentConv(existing);
      handledEditIdRef.current = existing.handledEditId ?? null;
      offerEditFrom([...existing.messages].reverse().find((m) => m.role === "assistant"));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__excel_agent__",
        title: "Агент Excel",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveExcelAgentConversation(conv);
      setAgentConv(conv);
    }
  }

  /**
   * Opens the agent next to the table with a question about the selected cell
   * already typed out. The cell's own formula goes into the question because that
   * is almost always what "как получается это значение" is really asking about.
   */
  async function askAboutSelection() {
    const cell = sheet?.cells[selected];
    const shown = cell?.formula ? `формула =${cell.formula}, значение ${displayValue(cell)}` : displayValue(cell) || "пусто";
    setPrefill({ text: `Ячейка ${selected} на листе «${activeSheet}» (${shown}). `, nonce: Date.now() });
    if (mode === "grid") await openAgent("dock");
  }

  async function applyPendingEdit() {
    if (!pendingEdit) return;
    setBusy(true);
    setError(null);
    try {
      const { workbook: updated, createdSheets } = await window.api.applyExcelAgentEdit(pendingEdit);
      setWorkbook(updated);
      // Land the user on a sheet the edit actually touched — a freshly built table
      // is invisible otherwise, because it lives on a tab that isn't open.
      const target = createdSheets[0] || pendingEdit.sheets[0]?.sheet;
      if (target && updated.sheets.some((sh) => sh.name === target)) setActiveSheet(target);
      markEditHandled();
      setMode("grid");
      setSavedNote(
        createdSheets.length
          ? `Готово. Создан${createdSheets.length > 1 ? "ы листы" : " лист"}: ${createdSheets.join(", ")}. Файл на диске меняется только после «Сохранить».`
          : "Готово. Файл на диске меняется только после «Сохранить»."
      );
      setTimeout(() => setSavedNote(null), 8000);
      // The agent's view of the workbook is now stale — rebuild it.
      setAgentPrompt(await window.api.buildExcelAgentPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Total cells a proposal would write, for the confirmation banner. */
  function editSize(edit: ParsedExcelEdit): number {
    return edit.sheets.reduce((sum, seg) => sum + seg.cells.length, 0);
  }

  /**
   * The agent panel, rendered either docked beside the table or on its own. Sharing
   * one definition keeps the proposal banner and the tool wiring identical in both.
   */
  function renderAgentPanel(compact: boolean) {
    return (
      <div className={compact ? "excel-agent-pane" : "ops-app-body ops-app-agent"}>
          <p className="hint ops-agent-hint">
            Агент видит всю книгу, умеет считать по ней (проверяет цифры прямо в таблице, а не «на глаз») и
            строить целые таблицы с формулами — при необходимости на новых листах. Любое изменение он сначала
            предлагает, применяете его вы. Файл на диске меняется только когда вы нажмёте «Сохранить».
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
                <strong>
                  Предложена правка: {editSize(pendingEdit)} яч.
                  {" · "}
                  {pendingEdit.sheets
                    .map((seg) => {
                      const isNew = !workbook?.sheets.some((sh) => sh.name === seg.sheet);
                      return `«${seg.sheet}»${isNew ? " (новый лист)" : ""}`;
                    })
                    .join(", ")}
                </strong>
                <button className="link-btn" onClick={() => setEditExpanded((v) => !v)}>
                  {editExpanded ? "свернуть" : "показать ячейки"}
                </button>
              </div>
              {editExpanded && (
                <div className="excel-pending-details">
                  {pendingEdit.sheets.map((seg) => (
                    <div key={seg.sheet} className="excel-pending-sheet">
                      <b>{seg.sheet}:</b> {seg.cells.map((c) => `${c.cell} = ${c.value}`).join(", ")}
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
              onUpdate={setAgentConv}
              onSave={(conv) => window.api.saveExcelAgentConversation(conv)}
              emptyHint="Например: «Посчитай маржу по каждому клиенту» или «Поставь оклад Виктории 150000»."
              onStreamingText={(text) => setLivePreview(parsePartialExcelEdit(text))}
              onAssistantMessage={(content) => {
                setLivePreview(new Map());
                // A fresh answer is by definition unhandled, whatever came before.
                handledEditIdRef.current = null;
                setEditExpanded(false);
                setPendingEdit(parseExcelEdit(content));
              }}
              extraTools={(text) => window.api.runExcelAgentTools(text)}
              extraToolLabel="🧮 Считаю по книге…"
              skills={skills}
              prefill={prefill}
            />
          )}
      </div>
    );
  }

  const recalcErrors = workbook?.recalc?.errors ?? [];

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📗</span>
            <h2>Excel {workbook && <span className="excel-file-name">— {workbook.name}</span>}</h2>
          </div>
          <div>
            {mode !== "agent" ? (
              <>
                <button className="btn btn-secondary" onClick={openFile} disabled={busy}>
                  Открыть файл
                </button>
                <button className="btn btn-secondary" onClick={newWorkbook} disabled={busy}>
                  Новая книга
                </button>
                {workbook && (
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
                        <button className="btn btn-secondary" onClick={() => setMode("grid")}>
                          Закрыть агента
                        </button>
                      </>
                    ) : (
                      <button className="btn btn-primary" onClick={() => openAgent("dock")}>
                        🤖 Агент Excel
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <button className="btn btn-secondary" onClick={() => setMode("dock")}>
                ← К таблице
              </button>
            )}
          </div>
        </div>

        {mode !== "agent" && (
          <div className={mode === "dock" ? "ops-app-body excel-split" : "ops-app-body"}>
            <div className="excel-grid-pane">
            {!workbook ? (
              <p className="hint ops-app-empty">
                Откройте файл Excel с компьютера — он останется на своём месте, приложение работает прямо с ним.
                Формулы пересчитываются по-настоящему: измените ячейку — всё зависимое обновится, включая ссылки
                на другие листы. «Сохранить» пишет обратно в тот же файл, сохраняя оформление.
                <br />
                <br />
                «Новая книга» создаёт пустую таблицу — дальше можно просто попросить агента построить нужный
                расчёт, и он соберёт листы и формулы сам.
              </p>
            ) : (
              <>
                <div className="ops-tabs">
                  {workbook.sheets.map((s) => (
                    <button
                      key={s.name}
                      className={s.name === activeSheet ? "ops-tab active" : "ops-tab"}
                      onClick={() => {
                        setActiveSheet(s.name);
                        setSelected("A1");
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                <div className="excel-formula-bar">
                  <span className="excel-cell-ref">{selected}</span>
                  <input
                    value={editorValue}
                    onChange={(e) => setEditorValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditorValue(editValue(sheet?.cells[selected]));
                    }}
                    placeholder="Значение или формула, например =SUM(A1:A10)"
                    disabled={busy}
                  />
                  <button
                    className="btn btn-secondary excel-ask-btn"
                    onClick={askAboutSelection}
                    title="Спросить агента про эту ячейку"
                  >
                    🤖 Спросить про {selected}
                  </button>
                </div>

                {workbook.recalc && (
                  <p className="hint excel-recalc-note">
                    Формул пересчитано: {workbook.recalc.evaluated} из {workbook.recalc.total}
                    {recalcErrors.length > 0 && (
                      <> · с ошибками: {recalcErrors.length} (первая — {recalcErrors[0].cell}: {recalcErrors[0].error})</>
                    )}
                  </p>
                )}
                {error && <div className="chat-error">{error}</div>}
                {savedNote && <p className="hint">{savedNote}</p>}

                {sheet && (
                  <div className="ops-table-scroll">
                    <table className="ops-table excel-table">
                      <thead>
                        <tr>
                          <th className="ops-row-index" />
                          {Array.from({ length: Math.max(sheet.maxCol, 1) }, (_, i) => (
                            <th key={i}>{colToLetters(i + 1)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: Math.max(sheet.maxRow, 1) }, (_, r) => (
                          <tr key={r}>
                            <td className="ops-row-index">{r + 1}</td>
                            {Array.from({ length: Math.max(sheet.maxCol, 1) }, (_, c) => {
                              const key = `${colToLetters(c + 1)}${r + 1}`;
                              const cell = sheet.cells[key];
                              const isSelected = key === selected;
                              // Значение, которое агент диктует прямо сейчас: показывается
                              // вместо старого, пока правка не подтверждена или отклонена.
                              const incoming = livePreview.get(sheet.name)?.get(key);
                              return (
                                <td
                                  key={c}
                                  className={
                                    (isSelected ? "excel-cell-selected " : "") +
                                    (cell?.formula ? "excel-cell-formula " : "") +
                                    (incoming !== undefined ? "excel-cell-incoming" : "")
                                  }
                                  onClick={() => setSelected(key)}
                                  title={
                                    incoming !== undefined
                                      ? `Было: ${displayValue(cell) || "(пусто)"} → станет: ${incoming}`
                                      : cell?.formula
                                        ? "=" + cell.formula
                                        : undefined
                                  }
                                >
                                  {incoming !== undefined ? incoming : displayValue(cell)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
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
