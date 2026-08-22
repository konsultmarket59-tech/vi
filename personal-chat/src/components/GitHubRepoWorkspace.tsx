import { useEffect, useState } from "react";
import type { Conversation, GitHubRepo, GitHubTree, Settings } from "../lib/types";
import { FILE_EDIT_SYNTAX_HINT, parseFileEdit, uid, type ParsedFileEdit } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  repo: GitHubRepo;
  settings: Settings;
  onBack: () => void;
  onOpenSettings: () => void;
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

  useEffect(() => {
    loadTree();
    loadConversation();
  }, [repo.owner, repo.name]);

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
        <button className="btn btn-secondary" onClick={loadTree} disabled={loadingTree}>
          {loadingTree ? "Загрузка…" : "Обновить дерево"}
        </button>
      </div>

      {!settings.apiKey && (
        <div className="warning-banner">
          API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
        </div>
      )}

      <div className="github-layout">
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
