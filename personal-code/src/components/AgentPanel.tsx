import { useEffect, useRef, useState } from "react";
import type { AgentMessage, CommandResult, PendingCommand, Proposal } from "../lib/types";
import { renderMarkdown, stripProtocolBlocks } from "../lib/markdown";
import DiffView from "./DiffView";

interface Props {
  // Each workspace has its own conversation on disk. This prop is what tells the
  // panel to load a different one — without it, opening another project would
  // leave the previous project's dialogue on screen.
  workspaceRoot: string;
  openFile: string | null;
  onFilesChanged: () => void;
  disabled: boolean;
  disabledReason: string;
}

export default function AgentPanel({ workspaceRoot, openFile, onFilesChanged, disabled, disabledReason }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [command, setCommand] = useState<PendingCommand | null>(null);
  const [commandResult, setCommandResult] = useState<CommandResult | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // A different workspace is a different conversation, so anything still
    // pending from the previous one must not carry over.
    setProposal(null);
    setCommand(null);
    setCommandResult(null);
    setError("");
    if (disabled || !workspaceRoot) {
      setMessages([]);
      return;
    }
    let stale = false;
    window.api
      .agentHistory()
      .then((c) => {
        if (!stale) setMessages(c.messages);
      })
      .catch(() => {
        if (!stale) setMessages([]);
      });
    return () => {
      stale = true;
    };
  }, [disabled, workspaceRoot]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, proposal, command, commandResult, busy]);

  function absorb(turn: Awaited<ReturnType<typeof window.api.agentSend>>) {
    setMessages(turn.messages);
    setProposal(turn.proposal);
    setCommand(turn.command);
    setCommandResult(null);
    if (turn.parseError) setError(turn.parseError);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError("");
    setBusy(true);
    try {
      absorb(await window.api.agentSend(text, { openFile }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    setError("");
    try {
      const { applied } = await window.api.agentApply(proposal);
      setProposal(null);
      onFilesChanged();
      setMessages((prev) => [
        ...prev,
        {
          id: `applied-${Date.now()}`,
          role: "assistant",
          content: `Правки применены: ${applied.map((a) => a.path).join(", ")}`,
          createdAt: Date.now(),
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!command) return;
    setBusy(true);
    setError("");
    try {
      const result = await window.api.agentRun(command.command);
      setCommandResult(result);
      setCommand(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Hands the command's output back so the agent can react to a failing run. */
  async function reportResult() {
    if (!commandResult) return;
    setBusy(true);
    try {
      absorb(
        await window.api.agentReport(
          `Результат команды (код ${commandResult.code}):\n\`\`\`\n${commandResult.output}\n\`\`\``
        )
      );
      setCommandResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!confirm("Очистить переписку с агентом по этому проекту?")) return;
    const cleared = await window.api.agentClear();
    setMessages(cleared.messages);
    setProposal(null);
    setCommand(null);
    setCommandResult(null);
  }

  if (disabled) {
    return (
      <div className="agent-panel">
        <div className="empty-state">{disabledReason}</div>
      </div>
    );
  }

  const visibleMessages = messages.filter((m) => !m.tool);

  return (
    <div className="agent-panel">
      <div className="agent-head">
        <span className="panel-title">Агент</span>
        {openFile && <span className="agent-context" title={openFile}>смотрит: {openFile}</span>}
        <button type="button" className="btn btn-sm" onClick={clear} disabled={busy}>
          Очистить
        </button>
      </div>

      <div className="agent-body" ref={scroller}>
        {visibleMessages.length === 0 && (
          <p className="hint agent-hint">
            Опишите задачу обычными словами: «почини ошибку в разборе даты», «добавь тест на пустой список»,
            «объясни, что делает этот файл». Агент сначала прочитает нужные файлы, потом предложит правку —
            и покажет её как дифф, пока вы не нажмёте «Применить», на диске ничего не поменяется.
          </p>
        )}
        {visibleMessages.map((message) => (
          <div key={message.id} className={`bubble bubble-${message.role}`}>
            {message.role === "assistant" ? (
              <div
                className="bubble-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(stripProtocolBlocks(message.content)) }}
              />
            ) : (
              <div className="bubble-content bubble-plain">{message.content}</div>
            )}
          </div>
        ))}
        {busy && <div className="bubble bubble-assistant"><div className="bubble-content">Думаю…</div></div>}

        {proposal && (
          <div className="proposal">
            <div className="proposal-head">
              <strong>Предложены правки — {proposal.files.length} файл(ов)</strong>
              <span className="hint">На диске пока ничего не изменилось.</span>
            </div>
            {proposal.files.map((file) => (
              <DiffView key={file.path} file={file} />
            ))}
            <div className="proposal-actions">
              <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
                Применить
              </button>
              <button type="button" className="btn" onClick={() => setProposal(null)} disabled={busy}>
                Отклонить
              </button>
            </div>
          </div>
        )}

        {command && (
          <div className="proposal">
            <div className="proposal-head">
              <strong>Агент предлагает выполнить команду</strong>
              <span className="hint">Она запустится в папке проекта.</span>
            </div>
            <pre className="command-box">{command.command}</pre>
            <div className="proposal-actions">
              <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
                Выполнить
              </button>
              <button type="button" className="btn" onClick={() => setCommand(null)} disabled={busy}>
                Отклонить
              </button>
            </div>
          </div>
        )}

        {commandResult && (
          <div className="proposal">
            <div className="proposal-head">
              <strong>{commandResult.ok ? "Команда выполнена" : `Команда завершилась с кодом ${commandResult.code}`}</strong>
              {commandResult.timedOut && <span className="hint hint-warn">Превышено время ожидания.</span>}
            </div>
            <pre className="command-box">{commandResult.output}</pre>
            <div className="proposal-actions">
              <button type="button" className="btn btn-primary" onClick={reportResult} disabled={busy}>
                Показать агенту
              </button>
              <button type="button" className="btn" onClick={() => setCommandResult(null)} disabled={busy}>
                Закрыть
              </button>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="agent-input">
        <textarea
          className="textarea"
          rows={3}
          placeholder="Что нужно сделать? (Ctrl+Enter — отправить)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !draft.trim()}>
          Отправить
        </button>
      </div>
    </div>
  );
}
