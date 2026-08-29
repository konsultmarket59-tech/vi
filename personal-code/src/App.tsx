import { useCallback, useEffect, useState } from "react";
import type { OpenedFile, Settings, TreeNode, WorkspaceInfo } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/types";
import FileTree from "./components/FileTree";
import CodeEditor from "./components/CodeEditor";
import AgentPanel from "./components/AgentPanel";
import GitPanel from "./components/GitPanel";
import SettingsView from "./components/SettingsView";
import BlueprintsView from "./components/BlueprintsView";
import DemoAccessView from "./components/DemoAccessView";
import Prompt from "./components/Prompt";

type Tab = "code" | "git" | "blueprints" | "demo" | "settings";

/** The tail of a path is what identifies a project; the full path is in the tooltip. */
function shortenPath(full: string): string {
  const parts = full.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return full;
  return "… " + parts.slice(-3).join("/");
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({ root: "", isRepo: false, recent: [] });
  const [tab, setTab] = useState<Tab>("code");
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [file, setFile] = useState<OpenedFile | null>(null);
  const [buffer, setBuffer] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState<null | { kind: "create" } | { kind: "rename"; node: TreeNode }>(null);

  const refreshTree = useCallback(async () => {
    try {
      const result = await window.api.tree();
      setNodes(result.tree);
      setTruncated(result.truncated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, current] = await Promise.all([window.api.getSettings(), window.api.currentWorkspace()]);
        setSettings(cfg);
        setWorkspace(current);
        if (current.root) await refreshTree();
        if (!cfg.apiKey) setTab("settings");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [refreshTree]);

  async function openWorkspaceFrom(info: WorkspaceInfo | null) {
    if (!info) return;
    setWorkspace(info);
    setFile(null);
    setBuffer("");
    setDirty(false);
    setError("");
    await refreshTree();
  }

  async function pick() {
    try {
      await openWorkspaceFrom(await window.api.pickWorkspace());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openRecent(dir: string) {
    try {
      await openWorkspaceFrom(await window.api.openWorkspace(dir));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openFile(node: TreeNode) {
    if (node.type !== "file") return;
    if (dirty && !confirm("В открытом файле есть несохранённые изменения. Открыть другой файл и потерять их?")) return;
    setError("");
    try {
      const opened = await window.api.readFile(node.path);
      setFile(opened);
      setBuffer(opened.content);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const save = useCallback(async () => {
    if (!file) return;
    try {
      await window.api.writeFile(file.path, buffer);
      setFile({ ...file, content: buffer });
      setDirty(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [file, buffer]);

  /**
   * The agent writes files behind the editor's back, so after it applies a
   * proposal the open file is re-read from disk — otherwise the next manual save
   * would overwrite the agent's work with a stale buffer.
   */
  const afterAgentChange = useCallback(async () => {
    await refreshTree();
    if (!file) return;
    try {
      const fresh = await window.api.readFile(file.path);
      setFile(fresh);
      setBuffer(fresh.content);
      setDirty(false);
    } catch {
      // The agent may have deleted or renamed the open file.
      setFile(null);
      setBuffer("");
      setDirty(false);
    }
  }, [file, refreshTree]);

  async function deleteNode(node: TreeNode) {
    if (!confirm(`Удалить «${node.path}»? Это необратимо.`)) return;
    try {
      await window.api.deletePath(node.path);
      if (file?.path === node.path) {
        setFile(null);
        setBuffer("");
        setDirty(false);
      }
      await refreshTree();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!loaded) return <div className="loading-screen">Загрузка…</div>;

  const hasWorkspace = Boolean(workspace.root);

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="app-name">Личный код</span>

        <nav className="tabs">
          <button type="button" className={tab === "code" ? "tab tab-active" : "tab"} onClick={() => setTab("code")}>
            Код
          </button>
          <button type="button" className={tab === "git" ? "tab tab-active" : "tab"} onClick={() => setTab("git")}>
            Git
          </button>
          <button
            type="button"
            className={tab === "blueprints" ? "tab tab-active" : "tab"}
            onClick={() => setTab("blueprints")}
          >
            Сборки
          </button>
          <button
            type="button"
            className={tab === "demo" ? "tab tab-active" : "tab"}
            onClick={() => setTab("demo")}
          >
            Демо-доступ
          </button>
          <button
            type="button"
            className={tab === "settings" ? "tab tab-active" : "tab"}
            onClick={() => setTab("settings")}
          >
            Настройки
          </button>
        </nav>

        <div className="workspace-bar">
          <span className="workspace-path" title={workspace.root}>
            {workspace.root ? shortenPath(workspace.root) : "папка не открыта"}
          </span>
          <button type="button" className="btn btn-sm" onClick={pick}>
            Открыть папку
          </button>
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}

      <main className="main-area">
        {tab === "code" && !hasWorkspace && (
          <div className="empty-state empty-state-column">
            <p>Откройте папку с кодом, чтобы начать.</p>
            <button type="button" className="btn btn-primary" onClick={pick}>
              Открыть папку
            </button>
            {(workspace.recent ?? []).length > 0 && (
              <div className="recent-list">
                <p className="hint">Недавние:</p>
                {(workspace.recent ?? []).map((dir) => (
                  <button key={dir} type="button" className="recent-item" onClick={() => openRecent(dir)}>
                    {dir}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "code" && hasWorkspace && (
          <div className="code-layout">
            <aside className="tree-pane">
              <FileTree
                nodes={nodes}
                truncated={truncated}
                activePath={file?.path ?? null}
                dirtyPaths={dirty && file ? new Set([file.path]) : new Set()}
                onOpen={openFile}
                onRefresh={refreshTree}
                onCreateFile={() => setPrompt({ kind: "create" })}
                onDelete={deleteNode}
                onRename={(node) => setPrompt({ kind: "rename", node })}
              />
            </aside>

            <section className="editor-pane">
              {file ? (
                <>
                  <div className="editor-head">
                    <span className="editor-path">
                      {file.path}
                      {dirty && <span className="editor-dirty"> • не сохранено</span>}
                    </span>
                    <div className="editor-actions">
                      <button type="button" className="btn btn-sm" onClick={() => window.api.reveal(file.path)}>
                        Показать в папке
                      </button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={!dirty}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                  <CodeEditor
                    value={buffer}
                    language={file.language}
                    onChange={(next) => {
                      setBuffer(next);
                      setDirty(next !== file.content);
                    }}
                    onSave={save}
                  />
                </>
              ) : (
                <div className="empty-state">Выберите файл слева, чтобы редактировать его вручную.</div>
              )}
            </section>

            <aside className="agent-pane">
              <AgentPanel
                workspaceRoot={workspace.root}
                openFile={file?.path ?? null}
                onFilesChanged={afterAgentChange}
                disabled={!settings.apiKey}
                disabledReason="Чтобы работал агент, вставьте ключ Polza в настройках."
              />
            </aside>
          </div>
        )}

        {tab === "git" && !hasWorkspace && <div className="empty-state">Сначала откройте папку.</div>}
        {tab === "git" && hasWorkspace && <GitPanel isRepo={workspace.isRepo} onChanged={refreshTree} />}

        {tab === "blueprints" && <BlueprintsView />}
        {tab === "demo" && <DemoAccessView />}
        {tab === "settings" && <SettingsView settings={settings} onChange={setSettings} />}
      </main>

      {prompt?.kind === "create" && (
        <Prompt
          title="Новый файл"
          label="Путь относительно папки проекта"
          initialValue="src/new-file.ts"
          confirmLabel="Создать"
          onCancel={() => setPrompt(null)}
          onSubmit={async (path) => {
            setPrompt(null);
            try {
              await window.api.createFile(path, "");
              await refreshTree();
              await openFile({ name: path, path, type: "file" });
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}

      {prompt?.kind === "rename" && (
        <Prompt
          title="Переименовать"
          label="Новый путь"
          initialValue={prompt.node.path}
          confirmLabel="Переименовать"
          onCancel={() => setPrompt(null)}
          onSubmit={async (path) => {
            const node = prompt.node;
            setPrompt(null);
            try {
              await window.api.renamePath(node.path, path);
              if (file?.path === node.path) {
                setFile(null);
                setBuffer("");
                setDirty(false);
              }
              await refreshTree();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        />
      )}
    </div>
  );
}
