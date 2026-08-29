import { useCallback, useEffect, useState } from "react";
import type { GitCommit, GitFile, GitStatus } from "../lib/types";
import Prompt from "./Prompt";

interface Props {
  isRepo: boolean;
  onChanged: () => void;
}

function statusLabel(file: GitFile): string {
  if (file.untracked) return "новый";
  if (file.indexStatus === "D" || file.worktreeStatus === "D") return "удалён";
  if (file.indexStatus === "R") return "переименован";
  return "изменён";
}

export default function GitPanel({ isRepo, onChanged }: Props) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [diff, setDiff] = useState<{ file: string; text: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState<null | "branch" | "remote">(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [nextStatus, nextLog] = await Promise.all([window.api.gitStatus(), window.api.gitLog(30)]);
      setStatus(nextStatus);
      setLog(nextLog);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, isRepo]);

  async function act<T>(fn: () => Promise<T>, successText = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      onChanged();
      if (successText) setNotice(successText);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function showDiff(file: GitFile) {
    setError("");
    try {
      const text = file.untracked
        ? await window.api.gitShowUntracked(file.path)
        : await window.api.gitDiff({ file: file.path, staged: file.staged && !file.unstaged });
      setDiff({ file: file.path, text: text || "(нет изменений)" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!status) {
    return <div className="git-panel"><p className="hint">{error || "Загрузка…"}</p></div>;
  }

  if (!status.isRepo) {
    return (
      <div className="git-panel">
        <p className="hint">В этой папке нет git-репозитория.</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => window.api.gitInit(), "Репозиторий создан.")}>
          Создать репозиторий здесь
        </button>
        {error && <p className="error-text">{error}</p>}
      </div>
    );
  }

  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  return (
    <div className="git-panel">
      <div className="git-head">
        <div>
          <span className="git-branch">{status.branch}</span>
          {status.upstream && <span className="hint"> → {status.upstream}</span>}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="hint">
              {" "}
              {status.ahead > 0 && `↑${status.ahead}`} {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
        </div>
        <div className="git-head-actions">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => window.api.gitFetch(), "Обновлено с сервера.")}>
            Fetch
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => window.api.gitPull(), "Изменения получены.")}>
            Pull
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Отправить ветку «${status.branch}» на сервер?`)) return;
              act(() => window.api.gitPush(), "Ветка отправлена.");
            }}
          >
            Push
          </button>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPrompt("branch")}>
            Ветка
          </button>
        </div>
      </div>

      <div className="git-section">
        <div className="git-section-head">
          <span className="panel-title">Изменения ({status.files.length})</span>
          {unstaged.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => window.api.gitStageAll())}>
              Добавить всё
            </button>
          )}
        </div>

        {status.files.length === 0 && <p className="hint">Рабочая копия чистая.</p>}

        {unstaged.length > 0 && (
          <>
            <p className="git-group-label">Не добавлено в коммит</p>
            {unstaged.map((file) => (
              <div key={file.path} className="git-file">
                <button type="button" className="git-file-name" onClick={() => showDiff(file)} title="Показать изменения">
                  <span className="git-file-status">{statusLabel(file)}</span>
                  {file.path}
                </button>
                <span className="git-file-actions">
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => window.api.gitStage([file.path]))}>
                    +
                  </button>
                  {!file.untracked && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy}
                      title="Отменить изменения в файле"
                      onClick={() => {
                        if (!confirm(`Отменить все несохранённые изменения в «${file.path}»? Это необратимо.`)) return;
                        act(() => window.api.gitDiscard([file.path]));
                      }}
                    >
                      ↺
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}

        {staged.length > 0 && (
          <>
            <p className="git-group-label">В коммите</p>
            {staged.map((file) => (
              <div key={file.path} className="git-file">
                <button type="button" className="git-file-name" onClick={() => showDiff(file)}>
                  <span className="git-file-status">{statusLabel(file)}</span>
                  {file.path}
                </button>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act(() => window.api.gitUnstage([file.path]))}>
                  −
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {staged.length > 0 && (
        <div className="git-commit">
          <textarea
            className="textarea"
            rows={2}
            placeholder="Сообщение коммита"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !message.trim()}
            onClick={() =>
              act(async () => {
                await window.api.gitCommit(message.trim());
                setMessage("");
              }, "Коммит создан.")
            }
          >
            Закоммитить
          </button>
        </div>
      )}

      <div className="git-section">
        <span className="panel-title">История</span>
        {log.length === 0 && <p className="hint">Коммитов пока нет.</p>}
        {log.map((commit) => (
          <div key={commit.hash} className="git-commit-row">
            <code className="git-hash">{commit.short}</code>
            <span className="git-subject">{commit.subject}</span>
            <span className="hint git-date">{commit.date.slice(0, 16)}</span>
          </div>
        ))}
      </div>

      {notice && <p className="notice-text">{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      {diff && (
        <div className="modal-backdrop" onMouseDown={() => setDiff(null)}>
          <div className="modal modal-wide" onMouseDown={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{diff.file}</h3>
            <pre className="diff-body diff-raw">
              {diff.text.split("\n").map((line, index) => (
                <div
                  key={index}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "diff-row diff-add"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "diff-row diff-del"
                        : "diff-row diff-same"
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDiff(null)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}

      {prompt === "branch" && (
        <Prompt
          title="Новая ветка"
          label="Имя ветки"
          initialValue="feature/"
          confirmLabel="Создать"
          onCancel={() => setPrompt(null)}
          onSubmit={(name) => {
            setPrompt(null);
            act(() => window.api.gitCreateBranch(name), `Ветка «${name}» создана.`);
          }}
        />
      )}
    </div>
  );
}
