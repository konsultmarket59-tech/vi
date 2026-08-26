import { useEffect, useState } from "react";
import type { Conversation, ExcelWorkbook, Settings } from "../lib/types";
import { parseExcelEdit, uid, type ParsedExcelEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

type Mode = "grid" | "agent";

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

/** What a cell shows in the grid: the computed result, not the formula. */
function displayValue(cell: { value?: unknown; computed?: unknown } | undefined): string {
  if (!cell) return "";
  const v = cell.computed !== undefined && cell.computed !== null ? cell.computed : cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
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

export default function ExcelView({ settings, onOpenSettings }: Props) {
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

  const sheet = workbook?.sheets.find((s) => s.name === activeSheet);

  useEffect(() => {
    setEditorValue(editValue(sheet?.cells[selected]));
  }, [selected, activeSheet, workbook]);

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

  async function openAgent() {
    setMode("agent");
    try {
      setAgentPrompt(await window.api.buildExcelAgentPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    const existing = await window.api.getExcelAgentConversation();
    if (existing) {
      setAgentConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last) setPendingEdit(parseExcelEdit(last.content));
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

  async function applyPendingEdit() {
    if (!pendingEdit) return;
    setBusy(true);
    setError(null);
    try {
      setWorkbook(
        await window.api.setExcelCells(
          pendingEdit.cells.map((c) => ({ sheet: pendingEdit.sheet, cell: c.cell, value: c.value }))
        )
      );
      setPendingEdit(null);
      // The agent's view of the workbook is now stale — rebuild it.
      setAgentPrompt(await window.api.buildExcelAgentPrompt());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
            {mode === "grid" ? (
              <>
                <button className="btn btn-secondary" onClick={openFile} disabled={busy}>
                  Открыть файл
                </button>
                {workbook && (
                  <>
                    <button className="btn btn-secondary" onClick={() => save(false)} disabled={busy}>
                      Сохранить
                    </button>
                    <button className="btn btn-secondary" onClick={() => save(true)} disabled={busy}>
                      Сохранить как…
                    </button>
                    <button className="btn btn-primary" onClick={openAgent}>
                      🤖 Агент Excel
                    </button>
                  </>
                )}
              </>
            ) : (
              <button className="btn btn-secondary" onClick={() => setMode("grid")}>
                ← К таблице
              </button>
            )}
          </div>
        </div>

        {mode === "grid" && (
          <div className="ops-app-body">
            {!workbook ? (
              <p className="hint ops-app-empty">
                Откройте файл Excel с компьютера — он останется на своём месте, приложение работает прямо с ним.
                Формулы пересчитываются по-настоящему: измените ячейку — всё зависимое обновится, включая ссылки
                на другие листы. «Сохранить» пишет обратно в тот же файл, сохраняя оформление.
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
                              return (
                                <td
                                  key={c}
                                  className={
                                    (isSelected ? "excel-cell-selected " : "") + (cell?.formula ? "excel-cell-formula" : "")
                                  }
                                  onClick={() => setSelected(key)}
                                  title={cell?.formula ? "=" + cell.formula : undefined}
                                >
                                  {displayValue(cell)}
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
        )}

        {mode === "agent" && (
          <div className="ops-app-body ops-app-agent">
            <p className="hint ops-agent-hint">
              Спрашивайте про данные книги или просите изменить ячейки — агент предложит точную правку, вы
              подтверждаете. После применения формулы пересчитываются автоматически; файл на диске меняется
              только когда вы нажмёте «Сохранить».
            </p>
            {!settings.apiKey && (
              <div className="warning-banner">
                API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
              </div>
            )}
            {error && <div className="chat-error">{error}</div>}
            {pendingEdit && (
              <div className="pending-skill-banner">
                Предложена правка листа «{pendingEdit.sheet}»:{" "}
                {pendingEdit.cells.map((c) => `${c.cell} = ${c.value}`).join(", ")}
                <button className="btn btn-primary" onClick={applyPendingEdit} disabled={busy}>
                  Применить
                </button>
                <button className="btn btn-secondary" onClick={() => setPendingEdit(null)}>
                  Отклонить
                </button>
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
                onAssistantMessage={(content) => setPendingEdit(parseExcelEdit(content))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
