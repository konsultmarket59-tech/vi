import { useEffect, useState } from "react";
import type { BranchChanges, WorkspaceInfo } from "../lib/types";
import { errorText } from "./ConnectionStatus";

interface Props {
  workspace: WorkspaceInfo;
}

/**
 * Отправка правок в ветку GitHub — без git на компьютере.
 *
 * Папка выкачана через GitHub API, рядом лежит снимок: какой коммит взят и с
 * какими файлами. Отсюда видно, что изменилось, и это уезжает одним коммитом
 * поверх ветки — не затирая того, что там появилось без вас.
 */
export default function BranchPanel({ workspace }: Props) {
  const [changes, setChanges] = useState<BranchChanges | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [pr, setPr] = useState<{ url: string; number: number } | null>(null);

  const branch = workspace.branch;

  async function refresh() {
    try {
      setChanges(await window.api.branchChanges());
    } catch (e) {
      setError(errorText(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, [workspace.root]);

  useEffect(() => window.api.onBranchLog((line) => setLog((prev) => [...prev, line])), []);

  async function act<T>(fn: () => Promise<T>, success = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      if (success) setNotice(success);
      return value;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  async function send() {
    setLog([]);
    const result = await act(() => window.api.pushBranch(message));
    if (!result) return;
    if (!result.ok) {
      setNotice(result.message || "Изменений нет.");
      return;
    }
    setMessage("");
    setNotice(`Отправлено: ${result.files} файлов, коммит ${(result.commit || "").slice(0, 7)}.`);
  }

  async function makePullRequest() {
    const result = await act(
      () => window.api.openPullRequest({ base: "main", title: message.trim() || undefined }),
      ""
    );
    if (result) {
      setPr(result);
      setNotice(result.created ? `Запрос на слияние №${result.number} открыт.` : `Запрос №${result.number} уже открыт.`);
    }
  }

  async function build() {
    if (!branch) return;
    const result = await act(
      () => window.api.runBranchWorkflow({ repo: branch.repo, branch: branch.branch }),
      ""
    );
    if (result) setNotice(`Сборка «${result.workflow}» запущена.`);
  }

  if (!branch) return null;

  const files = changes ? [...changes.added, ...changes.changed, ...changes.removed] : [];
  const label = (rel: string) =>
    changes?.added.includes(rel) ? "новый" : changes?.removed.includes(rel) ? "удалён" : "изменён";

  return (
    <div className="branch-panel">
      <section className="card">
        <h3 className="card-title">Ветка GitHub</h3>
        <p className="hint">
          <code>{branch.repo}</code> · ветка <code>{branch.branch}</code>
          {branch.subdir ? (
            <>
              {" "}
              · папка <code>{branch.subdir}</code>
            </>
          ) : null}
          . Git на компьютере для этого не нужен: правки уезжают через GitHub одним коммитом поверх
          ветки.
        </p>

        <div className="row">
          <button type="button" className="btn" onClick={refresh} disabled={busy}>
            Обновить список правок
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => window.api.openExternal(`https://github.com/${branch.repo}/tree/${branch.branch}`)}
          >
            Ветка на GitHub
          </button>
        </div>

        {changes && changes.total === 0 && <p className="hint">Правок нет — в папке то же, что в ветке.</p>}
        {changes && changes.total > 0 && (
          <>
            <p className="hint">Правок: {changes.total}</p>
            <ul className="branch-files">
              {files.slice(0, 50).map((rel) => (
                <li key={rel}>
                  <span className="branch-file-mark">{label(rel)}</span> <code>{rel}</code>
                </li>
              ))}
              {files.length > 50 && <li className="hint">…и ещё {files.length - 50}</li>}
            </ul>
          </>
        )}

        <label className="field-label">Что сделано — одной строкой</label>
        <input
          className="input"
          placeholder="Плагин «Сайты»: сборка страницы из материалов"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div className="row">
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !changes?.total}>
            {busy ? "Отправляю…" : "Отправить в ветку"}
          </button>
          <button type="button" className="btn" onClick={makePullRequest} disabled={busy}>
            Открыть запрос на слияние
          </button>
          <button type="button" className="btn" onClick={build} disabled={busy}>
            Запустить сборку
          </button>
        </div>

        {pr && (
          <p className="hint">
            <button type="button" className="link-like" onClick={() => window.api.openExternal(pr.url)}>
              Запрос на слияние №{pr.number}
            </button>{" "}
            — там же видно, что скажет проверка.
          </p>
        )}
        {notice && <p className="notice-text">{notice}</p>}
        {error && <p className="error-text">{error}</p>}
        {log.length > 0 && <pre className="build-log">{log.slice(-12).join("\n")}</pre>}
      </section>
    </div>
  );
}
