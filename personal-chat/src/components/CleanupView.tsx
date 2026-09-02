import { useState } from "react";
import type {
  CleanupApplied,
  CleanupLedgerSheet,
  CleanupOp,
  CleanupPrepared,
  Conversation,
  Settings,
  Skill,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

type Mode = "tidy" | "ledger";

function describeOp(op: CleanupOp): string {
  if (op.op === "mkdir") return `Создать папку «${op.target}»`;
  if (op.op === "rename") return `Переименовать «${op.from}» → «${op.to}»`;
  return `Перенести «${op.from}» → «${op.to}»`;
}

export default function CleanupView({ settings, skills, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("tidy");
  const [folderPath, setFolderPath] = useState("");
  const [notes, setNotes] = useState("");
  const [prepared, setPrepared] = useState<CleanupPrepared | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | undefined>();

  const [plan, setPlan] = useState<{ ops: CleanupOp[] } | null>(null);
  const [ledger, setLedger] = useState<{ sheets: CleanupLedgerSheet[] } | null>(null);
  const [applied, setApplied] = useState<CleanupApplied | null>(null);
  const [savedLedger, setSavedLedger] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function showNote(text: string, ms = 8000) {
    setNote(text);
    setTimeout(() => setNote(null), ms);
  }

  async function pickFolder() {
    const picked = await window.api.pickCleanupFolder();
    if (picked) {
      setFolderPath(picked);
      setPrepared(null);
      setConv(null);
      setPlan(null);
      setApplied(null);
    }
  }

  async function prepare() {
    if (!folderPath) return;
    setError(null);
    setPlan(null);
    setLedger(null);
    setApplied(null);
    setSavedLedger("");
    setBusy(true);
    try {
      const ready = await window.api.prepareCleanup({ folderPath, mode, notes });
      setPrepared(ready);
      setConv({
        id: uid(),
        projectId: "__cleanup__",
        title: mode === "ledger" ? "Сверка по папке" : "Разбор папки",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setPrefill({
        text:
          mode === "ledger"
            ? "Собери сверку по документам в этой папке. "
            : "Разбери эту папку. ",
        nonce: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAssistantMessage(content: string) {
    if (mode === "ledger") {
      setLedger(await window.api.parseCleanupLedger(content).catch(() => null));
    } else {
      setPlan(await window.api.parseCleanupPlan(content).catch(() => null));
    }
  }

  async function applyPlan() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.applyCleanupPlan(folderPath, plan);
      setApplied(result);
      setPlan(null);
      showNote(
        result.failed.length
          ? `Выполнено ${result.done.length}, не удалось ${result.failed.length}.`
          : `Готово: ${result.done.length} действий. Разбор можно отменить одной кнопкой.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!applied) return;
    setBusy(true);
    try {
      const result = await window.api.undoCleanup(folderPath, applied.done);
      setApplied(null);
      showNote(
        result.failed.length ? `Откат частичный: ${result.failed.length} действий вернуть не удалось.` : "Разбор отменён, файлы вернулись на места."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveLedger() {
    if (!ledger) return;
    setBusy(true);
    try {
      const dest = await window.api.saveCleanupLedger(
        ledger.sheets,
        `Сверка — ${folderPath.split(/[\\/]/).pop() || "папка"}`
      );
      if (dest) {
        setSavedLedger(dest);
        showNote(`Сверка сохранена: ${dest}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">🧹</span>
            <h2>Клининг</h2>
          </div>
        </div>

        <div className="project-tabs">
          <button
            className={mode === "tidy" ? "tab active" : "tab"}
            onClick={() => {
              setMode("tidy");
              setConv(null);
              setPrepared(null);
            }}
          >
            Разбор папки
          </button>
          <button
            className={mode === "ledger" ? "tab active" : "tab"}
            onClick={() => {
              setMode("ledger");
              setConv(null);
              setPrepared(null);
            }}
          >
            Сверка документов
          </button>
        </div>

        {!settings.apiKey && (
          <div className="warning-banner">
            API-ключ не задан.{" "}
            <button className="link-btn" onClick={onOpenSettings}>
              Открыть настройки
            </button>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        {note && <div className="hint docflow-note">{note}</div>}

        <div className="docflow-body">
          <div className="docflow-side">
            <div className="docflow-form">
              <div className="docflow-field">
                <label>Папка</label>
                <button className="btn btn-secondary btn-small" onClick={pickFolder}>
                  Выбрать папку
                </button>
                {folderPath && <span className="docflow-path">{folderPath}</span>}
              </div>

              <div className="docflow-field">
                <label>{mode === "ledger" ? "Что учесть в сверке" : "Как разбирать"}</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    mode === "ledger"
                      ? "например: только документы за 2026 год"
                      : "например: папки называю «месяц год», проекты — по клиенту"
                  }
                />
              </div>

              <button className="btn btn-primary btn-block" onClick={prepare} disabled={busy || !folderPath}>
                {busy ? "Смотрю папку…" : mode === "ledger" ? "Прочитать документы" : "Осмотреть папку"}
              </button>

              <p className="hint">
                {mode === "ledger"
                  ? "Агент прочитает документы и соберёт книгу Excel: договоры, акты, ТЗ и счета — по листу на вид."
                  : "Агент только предлагает план: что создать, что куда перенести. Ничего не двигается, пока вы не нажмёте «Выполнить». Удалять он не умеет вообще, а любой разбор отменяется одной кнопкой."}
              </p>
            </div>
          </div>

          <div className="docflow-main">
            {prepared && (
              <div className="docflow-prepared">
                <span className="docflow-badge">Файлов: {prepared.fileCount}</span>
                <span className="docflow-badge">Подпапок: {prepared.folderCount}</span>
                {prepared.truncated && (
                  <span className="docflow-badge docflow-badge-warn">Папка большая — взята только часть файлов</span>
                )}
              </div>
            )}

            {plan && (
              <div className="pending-skill-banner">
                <div className="excel-pending-summary">
                  <strong>План разбора: {plan.ops.length} действий</strong>
                </div>
                <div className="cleanup-plan">
                  {plan.ops.map((op, i) => (
                    <div key={i} className="cleanup-plan-row">
                      {describeOp(op)}
                    </div>
                  ))}
                </div>
                <div className="excel-pending-actions">
                  <button className="btn btn-primary" onClick={applyPlan} disabled={busy}>
                    Выполнить
                  </button>
                  <button className="btn btn-secondary" onClick={() => setPlan(null)}>
                    Отклонить
                  </button>
                </div>
              </div>
            )}

            {applied && (
              <div className="docflow-saved">
                <div>
                  <strong>Выполнено действий: {applied.done.length}</strong>
                </div>
                {applied.failed.map((f, i) => (
                  <div key={i} className="hint">
                    Не удалось: {describeOp(f.op)} — {f.error}
                  </div>
                ))}
                <div className="docflow-inline">
                  <button className="btn btn-secondary btn-small" onClick={undo} disabled={busy}>
                    Отменить разбор
                  </button>
                  <button className="btn btn-secondary btn-small" onClick={() => window.api.openDocflowFolder(folderPath)}>
                    Открыть папку
                  </button>
                </div>
              </div>
            )}

            {ledger && (
              <div className="pending-skill-banner">
                <div className="excel-pending-summary">
                  <strong>Сверка готова</strong>
                </div>
                <div className="docflow-meta">
                  {ledger.sheets.map((sheet) => (
                    <span key={sheet.name}>
                      {sheet.name}: {Math.max(0, sheet.rows.length - 1)}
                    </span>
                  ))}
                </div>
                <div className="excel-pending-actions">
                  <button className="btn btn-primary" onClick={saveLedger} disabled={busy}>
                    Сохранить в Excel
                  </button>
                  <button className="btn btn-secondary" onClick={() => setLedger(null)}>
                    Отклонить
                  </button>
                </div>
                {savedLedger && <p className="hint">Сохранено: {savedLedger}</p>}
              </div>
            )}

            {conv ? (
              <ChatView
                conversation={conv}
                systemPrompt={prepared?.prompt || ""}
                settings={settings}
                skills={skills}
                prefill={prefill}
                onUpdate={setConv}
                onSave={async () => {}}
                emptyHint={
                  mode === "ledger"
                    ? "Например: «Собери сверку, приложения покажи под своими договорами»."
                    : "Например: «Разложи по проектам и месяцам, скриншоты отдельно»."
                }
                onAssistantMessage={onAssistantMessage}
              />
            ) : (
              <div className="empty-state">Выберите папку слева и нажмите кнопку осмотра.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
