import { useEffect, useState } from "react";
import type { Conversation, GitHubBranch, GitHubRepo, GitHubTree, GitHubWorkflow, GitHubWorkflowRun, Settings } from "../lib/types";
import { FILE_EDIT_SYNTAX_HINT, parseFileEdit, uid, type ParsedFileEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  repo: GitHubRepo;
  settings: Settings;
  onBack: () => void;
  onOpenSettings: () => void;
}

type WorkspaceTab = "code" | "actions";

const RUN_POLL_MS = 6000;

function runLabel(run: GitHubWorkflowRun): string {
  if (run.status !== "completed") return run.status === "queued" ? "в очереди" : "выполняется";
  if (run.conclusion === "success") return "успешно";
  if (run.conclusion === "failure") return "ошибка";
  if (run.conclusion === "cancelled") return "отменён";
  return run.conclusion ?? "завершён";
}

function runClass(run: GitHubWorkflowRun): string {
  if (run.status !== "completed") return "run-status run-running";
  if (run.conclusion === "success") return "run-status run-success";
  if (run.conclusion === "failure") return "run-status run-failure";
  return "run-status";
}

const MAX_FILE_CHARS = 40000;
const MAX_TOTAL_CHARS = 250000;

export default function GitHubRepoWorkspace({ repo, settings, onBack, onOpenSettings }: Props) {
  const [tree, setTree] = useState<GitHubTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [attached, setAttached] = useState<Map<string, string>>(new Map());
  const [attaching, setAttaching] = useState<string | null>(null);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ParsedFileEdit | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitOk, setCommitOk] = useState<string | null>(null);
  const [showEditPreview, setShowEditPreview] = useState(false);

  const [tab, setTab] = useState<WorkspaceTab>("code");
  const [workflows, setWorkflows] = useState<GitHubWorkflow[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState<number | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [runs, setRuns] = useState<GitHubWorkflowRun[]>([]);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionsNote, setActionsNote] = useState<string | null>(null);

  useEffect(() => {
    loadTree();
    loadConversation();
  }, [repo.owner, repo.name]);

  useEffect(() => {
    if (tab === "actions") loadActions();
  }, [tab, repo.owner, repo.name]);

  // While a run is in flight, keep the list fresh so the result shows up without
  // the user having to click anything.
  useEffect(() => {
    if (tab !== "actions") return;
    if (!runs.some((r) => r.status !== "completed")) return;
    const timer = setInterval(() => refreshRuns(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [tab, runs, selectedWorkflow]);

  async function loadActions() {
    setActionsError(null);
    try {
      const [wfs, brs] = await Promise.all([
        window.api.listGitHubWorkflows(repo.owner, repo.name),
        window.api.listGitHubBranches(repo.owner, repo.name),
      ]);
      setWorkflows(wfs);
      setBranches(brs);
      setSelectedWorkflow((prev) => prev ?? wfs[0]?.id ?? null);
      setSelectedBranch((prev) => prev || repo.defaultBranch || brs[0]?.name || "");
      setRuns(await window.api.listGitHubWorkflowRuns(repo.owner, repo.name, wfs[0]?.id, 10));
    } catch (e) {
      setActionsError(e instanceof Error ? e.message : String(e));
    }
  }

  async function refreshRuns(workflowId?: number) {
    try {
      setRuns(await window.api.listGitHubWorkflowRuns(repo.owner, repo.name, workflowId ?? selectedWorkflow ?? undefined, 10));
    } catch (e) {
      setActionsError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startWorkflow() {
    if (!selectedWorkflow || !selectedBranch) return;
    setStarting(true);
    setActionsError(null);
    setActionsNote(null);
    try {
      await window.api.runGitHubWorkflow(repo.owner, repo.name, selectedWorkflow, selectedBranch);
      setActionsNote(`Запущено на ветке ${selectedBranch}. Сборка занимает пару минут.`);
      // GitHub needs a moment before the new run appears in the list.
      setTimeout(() => refreshRuns(), 3000);
    } catch (e) {
      setActionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  async function loadTree() {
    setLoadingTree(true);
    setTreeError(null);
    try {
      setTree(await window.api.getGitHubTree(repo.owner, repo.name));
    } catch (e) {
      setTreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTree(false);
    }
  }

  async function loadConversation() {
    const existing = await window.api.getGitHubAgentConversation(repo.owner, repo.name);
    if (existing) {
      setConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      setPendingEdit(last ? parseFileEdit(last.content) : null);
    } else {
      const fresh: Conversation = {
        id: uid(),
        projectId: `__github_${repo.owner}_${repo.name}__`,
        title: repo.fullName,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveGitHubAgentConversation(repo.owner, repo.name, fresh);
      setConv(fresh);
    }
  }

  async function toggleAttach(path: string) {
    if (attached.has(path)) {
      setAttached((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      return;
    }
    setAttaching(path);
    try {
      const file = await window.api.getGitHubFile(repo.owner, repo.name, path);
      setAttached((prev) => new Map(prev).set(path, file.content));
    } catch (e) {
      alert(`Не удалось прочитать ${path}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAttaching(null);
    }
  }

  function buildSystemPrompt(): string {
    const parts = [
      `Ты работаешь с репозиторием ${repo.fullName} на GitHub (ветка ${tree?.branch ?? repo.defaultBranch}).`,
      FILE_EDIT_SYNTAX_HINT,
    ];
    if (tree) {
      parts.push(
        `\n=== СПИСОК ФАЙЛОВ (${tree.entries.length}${tree.truncated ? "+, список обрезан" : ""}) ===\n` +
          tree.entries.map((e) => e.path).join("\n")
      );
    }
    if (attached.size > 0) {
      parts.push("\n=== ПРИКРЕПЛЁННЫЕ ФАЙЛЫ (актуальное содержимое) ===");
      for (const [path, content] of attached) {
        const truncated = content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + "\n[...обрезано...]" : content;
        parts.push(`\n--- Файл: ${path} ---\n${truncated}`);
      }
    }
    let full = parts.join("\n");
    if (full.length > MAX_TOTAL_CHARS) full = full.slice(0, MAX_TOTAL_CHARS) + "\n[...контекст обрезан по лимиту...]";
    return full;
  }

  async function applyEdit() {
    if (!pendingEdit) return;
    setCommitting(true);
    setCommitError(null);
    setCommitOk(null);
    try {
      let sha: string | undefined;
      const existsInTree = tree?.entries.some((e) => e.path === pendingEdit.path);
      if (existsInTree) {
        const current = await window.api.getGitHubFile(repo.owner, repo.name, pendingEdit.path);
        sha = current.sha;
      }
      const result = await window.api.commitGitHubFile(
        repo.owner,
        repo.name,
        pendingEdit.path,
        pendingEdit.content,
        `Правка через Личный чат: ${pendingEdit.path}`,
        sha
      );
      setCommitOk(`Закоммичено: ${pendingEdit.path} (${result.commitSha?.slice(0, 7) ?? "ok"})`);
      setPendingEdit(null);
      if (attached.has(pendingEdit.path)) {
        setAttached((prev) => new Map(prev).set(pendingEdit.path, pendingEdit.content));
      }
      await loadTree();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="github-workspace">
      <div className="ops-toolbar">
        <div>
          <button className="link-btn" onClick={onBack}>
            ← К репозиториям
          </button>
          <h2>{repo.fullName}</h2>
        </div>
        <div className="project-tabs">
          <button className={tab === "code" ? "tab active" : "tab"} onClick={() => setTab("code")}>
            Код
          </button>
          <button className={tab === "actions" ? "tab active" : "tab"} onClick={() => setTab("actions")}>
            Сборка (Actions)
          </button>
          {tab === "code" && (
            <button className="btn btn-secondary" onClick={loadTree} disabled={loadingTree}>
              {loadingTree ? "Загрузка…" : "Обновить дерево"}
            </button>
          )}
        </div>
      </div>

      {!settings.apiKey && (
        <div className="warning-banner">
          API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
        </div>
      )}

      {tab === "actions" && (
        <div className="panel-section">
          <p className="hint">
            Здесь запускаются рабочие процессы (workflows) репозитория — например сборка нового установочного
            файла приложения. Запуск всегда берёт последний коммит выбранной ветки; это именно «Run workflow»,
            а не «Re-run» старого запуска (тот пересобрал бы старый код).
          </p>
          {actionsError && <div className="chat-error">{actionsError}</div>}
          {workflows.length === 0 && !actionsError && <p className="hint">В репозитории нет workflow-файлов.</p>}

          {workflows.length > 0 && (
            <>
              <label>Процесс</label>
              <select
                value={selectedWorkflow ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedWorkflow(id);
                  refreshRuns(id);
                }}
              >
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.path.replace(".github/workflows/", "")})
                  </option>
                ))}
              </select>

              <label>Ветка</label>
              <select value={selectedBranch} onChange={(e) => setSelectedBranch(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>

              <div className="settings-actions">
                <button className="btn btn-primary" onClick={startWorkflow} disabled={starting || !selectedWorkflow}>
                  {starting ? "Запускаю…" : "▶ Запустить"}
                </button>
                <button className="btn btn-secondary" onClick={() => refreshRuns()}>
                  Обновить список
                </button>
              </div>
              {actionsNote && <p className="hint">{actionsNote}</p>}

              <h3>Последние запуски</h3>
              {runs.length === 0 && <p className="hint">Запусков пока не было.</p>}
              <ul className="run-list">
                {runs.map((r) => (
                  <li key={r.id}>
                    <span className={runClass(r)}>{runLabel(r)}</span>
                    <span className="run-main">
                      <span className="run-title">
                        #{r.runNumber} · {r.branch}
                      </span>
                      <span className="run-commit">{r.headCommitMessage}</span>
                    </span>
                    <span className="run-date">{new Date(r.createdAt).toLocaleString("ru-RU")}</span>
                    <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="link-btn">
                      открыть ↗
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="github-layout" style={{ display: tab === "code" ? undefined : "none" }}>
        <div className="github-tree">
          <p className="hint">Отметьте файлы, чтобы агент видел их содержимое.</p>
          {treeError && <div className="chat-error">{treeError}</div>}
          {tree?.truncated && <p className="hint">Дерево очень большое, показаны первые файлы.</p>}
          <ul className="github-tree-list">
            {tree?.entries.map((e) => (
              <li key={e.path} className={e.binary ? "github-tree-binary" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={attached.has(e.path)}
                    disabled={e.binary || attaching === e.path}
                    onChange={() => toggleAttach(e.path)}
                  />
                  <span>{e.path}</span>
                  {attaching === e.path && <span className="hint"> загрузка…</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="github-chat">
          {pendingEdit && (
            <div className="pending-skill-banner github-edit-banner">
              <div>
                Предложена правка: <code>{pendingEdit.path}</code> ({pendingEdit.content.length} символов).{" "}
                <button className="link-btn" onClick={() => setShowEditPreview((v) => !v)}>
                  {showEditPreview ? "Скрыть" : "Показать"} содержимое
                </button>
              </div>
              {showEditPreview && <pre className="github-edit-preview">{pendingEdit.content}</pre>}
              <div>
                <button className="btn btn-primary" onClick={applyEdit} disabled={committing}>
                  {committing ? "Коммит…" : "Применить и закоммитить"}
                </button>
                <button className="btn btn-secondary" onClick={() => setPendingEdit(null)} disabled={committing}>
                  Отклонить
                </button>
              </div>
            </div>
          )}
          {commitError && <div className="chat-error">Не удалось закоммитить: {commitError}</div>}
          {commitOk && <p className="saved-note">{commitOk}</p>}
          {conv && (
            <ChatView
              conversation={conv}
              systemPrompt={buildSystemPrompt()}
              settings={settings}
              onUpdate={setConv}
              onSave={(c) => window.api.saveGitHubAgentConversation(repo.owner, repo.name, c)}
              emptyHint="Спросите про код или попросите внести правку — отметьте нужные файлы слева, чтобы агент их видел."
              onAssistantMessage={(content) => {
                setPendingEdit(parseFileEdit(content));
                setCommitOk(null);
                setCommitError(null);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
