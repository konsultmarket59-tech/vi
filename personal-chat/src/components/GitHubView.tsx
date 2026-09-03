import { useEffect, useState } from "react";
import ConnectionStatus, { CHECKING, STALE, errorText, failed, ok } from "./ConnectionStatus";
import type { ConnectionStatusValue } from "./ConnectionStatus";
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
  const [testResult, setTestResult] = useState<ConnectionStatusValue | null>(null);
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
      else setTab("settings"); // nothing connected yet — land straight on setup instructions, not an empty repo list
    });
  }, []);

  async function saveToken() {
    const saved = await window.api.saveGitHubAccount({ token: tokenDraft });
    setAccount(saved);
    refreshRepos();
  }

  async function testConnection() {
    if (!tokenDraft.trim()) {
      setTestResult(failed("Токен не введён."));
      return;
    }
    setTesting(true);
    setTestResult(CHECKING);
    try {
      const result = await window.api.testGitHubConnection(tokenDraft);
      setTestResult(
        result.ok ? ok(`Подключено к GitHub как ${result.login}.`) : failed(`GitHub не принял токен: ${errorText(result.error)}`)
      );
    } catch (e) {
      setTestResult(failed(errorText(e)));
    } finally {
      setTesting(false);
    }
  }

  /** Проверка сразу после ввода токена — иначе непонятно, годится он или нет. */
  function checkTokenOnBlur() {
    if (!tokenDraft.trim() || tokenDraft.trim() === account.token.trim()) return;
    if (testResult && (testResult.state === "ok" || testResult.state === "checking")) return;
    void testConnection();
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
            Для подключения нужен Personal Access Token — это как пароль, только для одного конкретного приложения,
            который можно в любой момент отозвать на GitHub, не меняя основной пароль от аккаунта.
          </p>
          <ol className="github-token-steps">
            <li>
              Нажмите кнопку ниже — откроется страница создания токена на GitHub, уже с нужной галочкой{" "}
              <code>repo</code>.
            </li>
            <li>На открывшейся странице внизу нажмите зелёную кнопку «Generate token».</li>
            <li>Скопируйте показанный токен (вида <code>ghp_…</code>) — он показывается только один раз.</li>
            <li>Вставьте его в поле «Токен» ниже и нажмите «Сохранить».</li>
          </ol>
          <a
            className="btn btn-secondary github-token-link"
            href="https://github.com/settings/tokens/new?scopes=repo&description=%D0%9B%D0%B8%D1%87%D0%BD%D1%8B%D0%B9%20%D1%87%D0%B0%D1%82"
            target="_blank"
            rel="noreferrer"
          >
            Создать токен на GitHub ↗
          </a>
          <p className="hint">
            Это создаст токен старого («classic») типа — самый простой и надёжный вариант для одного личного
            аккаунта. Если вместо этого создаёте fine-grained-токен вручную — учтите, что у него нет галочки{" "}
            <code>repo</code>: там вместо скоупов нужно выбрать конкретные репозитории и выдать им права{" "}
            <code>Contents: Read and write</code>.
          </p>
          <label>Токен</label>
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => {
              setTokenDraft(e.target.value);
              setTestResult(e.target.value.trim() === account.token.trim() ? null : STALE);
            }}
            onBlur={checkTokenOnBlur}
            placeholder="ghp_…"
          />
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Проверка…" : "Проверить"}
            </button>
            <button className="btn btn-primary" onClick={saveToken}>
              Сохранить
            </button>
          </div>
          <ConnectionStatus status={testResult} />
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
