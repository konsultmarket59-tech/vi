import { useEffect, useState } from "react";
import type { CellValue, Conversation, OpsSheet, Settings } from "../lib/types";
import { parseOpsEdit, uid, type ParsedOpsEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

type Mode = "tables" | "agent";

export default function OpsView({ settings, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("tables");
  const [sheets, setSheets] = useState<OpsSheet[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rowsDraft, setRowsDraft] = useState<CellValue[][]>([]);
  const [importing, setImporting] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ParsedOpsEdit | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    refreshSheets();
  }, []);

  useEffect(() => {
    const sheet = sheets.find((s) => s.id === activeId);
    setRowsDraft(sheet ? sheet.rows.map((r) => [...r]) : []);
  }, [activeId, sheets]);

  async function refreshSheets(selectId?: string) {
    const list = await window.api.listOpsSheets();
    setSheets(list);
    if (selectId) setActiveId(selectId);
    else if (!activeId && list.length > 0) setActiveId(list[0].id);
  }

  async function importXlsx() {
    const filePath = await window.api.pickXlsx();
    if (!filePath) return;
    setImporting(true);
    try {
      const imported = await window.api.importOpsXlsx(filePath);
      await refreshSheets(imported[0]?.id);
    } finally {
      setImporting(false);
    }
  }

  function updateCell(rowIdx: number, colIdx: number, value: string) {
    setRowsDraft((prev) => {
      const next = prev.map((r) => [...r]);
      next[rowIdx][colIdx] = value;
      return next;
    });
  }

  async function saveActiveSheet() {
    const sheet = sheets.find((s) => s.id === activeId);
    if (!sheet) return;
    const updated = await window.api.saveOpsSheet({ id: sheet.id, name: sheet.name, rows: rowsDraft, order: sheet.order });
    setSheets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function addRow() {
    const cols = rowsDraft[0]?.length ?? 1;
    setRowsDraft((prev) => [...prev, Array.from({ length: cols }, () => "")]);
  }

  function deleteRow(rowIdx: number) {
    setRowsDraft((prev) => prev.filter((_, i) => i !== rowIdx));
    setTimeout(saveActiveSheet, 0);
  }

  async function openAgent() {
    setMode("agent");
    const prompt = await window.api.buildOpsAgentPrompt();
    setAgentPrompt(prompt);
    const existing = await window.api.getOpsAgentConversation();
    if (existing) {
      setAgentConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last) setPendingEdit(parseOpsEdit(last.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__ops_agent__",
        title: "Агент операционки",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveOpsAgentConversation(conv);
      setAgentConv(conv);
    }
  }

  async function applyPendingEdit() {
    if (!pendingEdit) return;
    setApplyError(null);
    try {
      await window.api.applyOpsEdit(pendingEdit);
      setPendingEdit(null);
      await refreshSheets();
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    }
  }

  const activeSheet = sheets.find((s) => s.id === activeId);

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📊</span>
            <h2>Операционка</h2>
          </div>
          <div>
            {mode === "tables" ? (
              <>
                <button className="btn btn-secondary" onClick={importXlsx} disabled={importing}>
                  {importing ? "Импорт…" : "Импортировать xlsx"}
                </button>
                <button className="btn btn-primary" onClick={openAgent}>
                  🤖 Агент операционки
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" onClick={() => setMode("tables")}>
                ← К таблицам
              </button>
            )}
          </div>
        </div>

        {mode === "tables" && (
          <div className="ops-app-body">
            {sheets.length === 0 ? (
              <p className="hint ops-app-empty">
                Пока нет данных. Нажмите «Импортировать xlsx» и выберите файл — каждый лист станет отдельной таблицей.
              </p>
            ) : (
              <>
                <div className="ops-tabs">
                  {sheets.map((s) => (
                    <button
                      key={s.id}
                      className={s.id === activeId ? "ops-tab active" : "ops-tab"}
                      onClick={() => setActiveId(s.id)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                {activeSheet && (
                  <>
                    <div className="ops-table-toolbar">
                      <h3>{activeSheet.name}</h3>
                      <button className="btn btn-secondary" onClick={addRow}>
                        + Строка
                      </button>
                    </div>
                    <div className="ops-table-scroll">
                      <table className="ops-table">
                        <tbody>
                          {rowsDraft.map((row, rowIdx) => (
                            <tr key={rowIdx} className={rowIdx === 0 ? "ops-header-row" : undefined}>
                              <td className="ops-row-index">{rowIdx}</td>
                              {row.map((cell, colIdx) => (
                                <td key={colIdx}>
                                  <input
                                    value={cell}
                                    onChange={(e) => updateCell(rowIdx, colIdx, e.target.value)}
                                    onBlur={saveActiveSheet}
                                  />
                                </td>
                              ))}
                              <td className="ops-row-actions">
                                <button className="conv-delete" onClick={() => deleteRow(rowIdx)} title="Удалить строку">
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {mode === "agent" && (
          <div className="ops-app-body ops-app-agent">
            <p className="hint ops-agent-hint">
              Спрашивайте про данные или просите добавить/изменить/удалить запись — агент предложит точное
              изменение, вы подтверждаете перед тем как оно применится.
            </p>
            {!settings.apiKey && (
              <div className="warning-banner">
                API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
              </div>
            )}
            {applyError && <div className="chat-error">Не удалось применить изменение: {applyError}</div>}
            {pendingEdit && (
              <div className="pending-skill-banner">
                Предложено изменение — лист «{pendingEdit.sheet}», действие: {actionLabel(pendingEdit.action)}
                {pendingEdit.rowIndex != null ? `, строка ${pendingEdit.rowIndex}` : ""}.
                <button className="btn btn-primary" onClick={applyPendingEdit}>
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
                onSave={(conv) => window.api.saveOpsAgentConversation(conv)}
                emptyHint="Например: «Добавь оплату от Болдино LIFE на 50000 ₽» или «Какая маржа по СВЕРХУ?»."
                onAssistantMessage={(content) => setPendingEdit(parseOpsEdit(content))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function actionLabel(action: ParsedOpsEdit["action"]): string {
  if (action === "add_row") return "добавить строку";
  if (action === "update_row") return "изменить строку";
  return "удалить строку";
}
