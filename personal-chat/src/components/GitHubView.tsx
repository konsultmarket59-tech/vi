import { useEffect, useState } from "react";
import type { GitHubAccount, GitHubRepo, Settings } from "../lib/types";
import GitHubRepoWorkspace from "./GitHubRepoWorkspace";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

type Tab = "repos" | "settings";

export default function GitHubView({ settings, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("repos");
  const [account, setAccount] = useState<GitHubAccount>({ token: "" });
  const [tokenDraft, setTokenDraft] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrivate, setNewPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    window.api.getGitHubAccount().then((a) => {
      setAccount(a);
      setTokenDraft(a.token);
      if (a.token) refreshRepos();
    });
  }, []);

  async function saveToken() {
    const saved = await window.api.saveGitHubAccount({ token: tokenDraft });
    setAccount(saved);
    refreshRepos();
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.api.testGitHubConnection(tokenDraft);
      setTestResult(result.ok ? `Подключено как ${result.login} ✓` : `Ошибка: ${result.error}`);
    } finally {
      setTesting(false);
    }
  }

  async function refreshRepos() {
    setLoadingRepos(true);
    setReposError(null);
    try {
      setRepos(await window.api.listGitHubRepos());
    } catch (e) {
      setReposError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRepos(false);
    }
  }

  async function createRepo() {
    setCreating(true);
    setCreateError(null);
    try {
      const repo = await window.api.createGitHubRepo({ name: newName.trim(), description: newDescription.trim(), private: newPrivate });
      setRepos((prev) => [repo, ...prev]);
      setShowCreate(false);
      setNewName("");
      setNewDescription("");
      setSelectedRepo(repo);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  if (selectedRepo) {
    return (
      <GitHubRepoWorkspace
        repo={selectedRepo}
        settings={settings}
        onBack={() => setSelectedRepo(null)}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <div className="github-view">
      <div className="ops-toolbar">
        <h2>GitHub</h2>
        <div className="project-tabs">
          <button className={tab === "repos" ? "tab active" : "tab"} onClick={() => setTab("repos")}>
            Репозитории
          </button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
            Настройки
          </button>
        </div>
      </div>

      {tab === "settings" && (
        <div className="panel-section">
          <p className="hint">
            Нужен Personal Access Token (fine-grained или classic) со скоупом{" "}
            <code>repo</code>. Создать: GitHub → Settings → Developer settings → Personal access tokens.
          </p>
          <label>Токен</label>
          <input type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)} placeholder="ghp_…" />
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Проверка…" : "Проверить"}
            </button>
            <button className="btn btn-primary" onClick={saveToken}>
              Сохранить
            </button>
          </div>
          {testResult && <p className="hint">{testResult}</p>}
          {account.token && <p className="hint">Токен сохранён локально в github/account.json.</p>}
        </div>
      )}

      {tab === "repos" && (
        <div className="panel-section">
          {!account.token && (
            <div className="warning-banner">
              GitHub не подключён. <button className="link-btn" onClick={() => setTab("settings")}>Открыть настройки GitHub</button>
            </div>
          )}
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={refreshRepos} disabled={loadingRepos || !account.token}>
              {loadingRepos ? "Загрузка…" : "Обновить список"}
            </button>
            <button className="btn btn-primary" onClick={() => setShowCreate((v) => !v)} disabled={!account.token}>
              + Создать репозиторий
            </button>
          </div>

          {showCreate && (
            <div className="github-create-form">
              <label>Название</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} />
              <label>Описание</label>
              <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
              <label>
                <input type="checkbox" checked={newPrivate} onChange={(e) => setNewPrivate(e.target.checked)} /> Приватный
              </label>
              {createError && <div className="chat-error">{createError}</div>}
              <button className="btn btn-primary" onClick={createRepo} disabled={creating || !newName.trim()}>
                {creating ? "Создание…" : "Создать"}
              </button>
            </div>
          )}

          {reposError && <div className="chat-error">{reposError}</div>}
          <ul className="github-repo-list">
            {repos.map((r) => (
              <li key={r.id} className="skill-card" onClick={() => setSelectedRepo(r)}>
                <div>
                  <h3>
                    {r.fullName} {r.private && <span className="hint">(приватный)</span>}
                  </h3>
                  <p>{r.description || "без описания"}</p>
                </div>
                <span className="hint">{new Date(r.updatedAt).toLocaleDateString("ru-RU")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
