import { useEffect, useState } from "react";
import type { GitHubAccount, Settings, StorageReport } from "../lib/types";
import ProblemReport from "./ProblemReport";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

interface Props {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export default function SettingsView({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dataFolder, setDataFolder] = useState("");
  const [report, setReport] = useState<StorageReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [github, setGithub] = useState<GitHubAccount>({ token: "" });
  const [githubDraft, setGithubDraft] = useState("");
  const [githubState, setGithubState] = useState("");

  useEffect(() => {
    window.api.dataFolder().then(setDataFolder).catch(() => setDataFolder(""));
    window.api
      .getGitHubAccount()
      .then((account) => {
        setGithub(account);
        setGithubDraft(account.token);
      })
      .catch(() => {});
  }, []);

  async function saveGitHub() {
    setError("");
    setGithubState("");
    try {
      const check = await window.api.testGitHubConnection(githubDraft.trim());
      if (!check.ok) {
        setError(`GitHub не принял токен: ${check.error}`);
        return;
      }
      const saved = await window.api.saveGitHubAccount({ token: githubDraft.trim() });
      setGithub(saved);
      setGithubState(`Подключено: ${check.login}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function changeDataFolder() {
    setError("");
    try {
      const result = await window.api.chooseDataFolder();
      if (!result) return;
      setDataFolder(result.folder);
      setDraft(result.settings);
      onChange(result.settings);
      setReport(null);
      setNotice("Папка с данными изменена. Уже сохранённые плагины остались в прежней папке — при необходимости перенесите их вручную.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadReport() {
    setReportBusy(true);
    setError("");
    try {
      setReport(await window.api.storageReport());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReportBusy(false);
    }
  }

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await window.api.saveSettings(draft);
      setDraft(saved);
      onChange(saved);
      setNotice("Настройки сохранены.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadModels() {
    setBusy(true);
    setError("");
    try {
      setModels(await window.api.listModels(draft));
      setNotice("Список моделей получен.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.api.testProxy(draft);
      if (result.ok) setNotice(result.message);
      else setError(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-view">
      <h2 className="view-title">Настройки</h2>

      <section className="card">
        <h3 className="card-title">Папка с данными</h3>
        <p className="hint">
          Архив плагинов и переписка с агентом хранятся прямо на вашем компьютере, обычными папками
          и файлами — ничего не уходит в облако и не хранится в этом приложении отдельно. Код проектов
          лежит там, где вы его открыли, и никуда не копируется.
        </p>
        <div className="row">
          <code className="folder-path">{dataFolder || "…"}</code>
          <button type="button" className="btn" onClick={changeDataFolder}>
            Выбрать другую папку
          </button>
          <button type="button" className="btn" onClick={() => window.api.openDataFolder()}>
            Открыть в проводнике
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Настройки подключения</h3>
        <p className="hint">
          Подключение к модели через Polza.ai (или любой другой OpenAI-совместимый сервис). Ключ
          хранится только на этом компьютере и никуда не отправляется, кроме указанного адреса API.
        </p>

        <label className="field-label">Base URL</label>
        <input className="input" value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />

        <label className="field-label">API-ключ</label>
        <div className="row">
          <input
            className="input"
            type={showKey ? "text" : "password"}
            placeholder="sk-..."
            value={draft.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
          />
          <button type="button" className="btn" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "Скрыть" : "Показать"}
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Модель</h3>
        <div className="row">
          <input
            className="input"
            list="model-list"
            placeholder="anthropic/claude-sonnet-5"
            value={draft.model}
            onChange={(e) => set("model", e.target.value)}
          />
          <button type="button" className="btn" onClick={loadModels} disabled={busy}>
            Обновить список
          </button>
        </div>
        <datalist id="model-list">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>
        <p className="hint">
          Начните вводить название или ID — появятся варианты. Точный идентификатор любой другой
          модели можно скопировать со страницы{" "}
          <button type="button" className="link-like" onClick={() => window.api.openExternal("https://polza.ai/models")}>
            polza.ai/models
          </button>{" "}
          — список не ограничен приложением, доступна любая модель, включённая на вашем аккаунте
          Polza.ai. Для кода лучше модель посильнее: она пишет правки, которые вы потом применяете.
        </p>

        <label className="field-label">Temperature: {draft.temperature}</label>
        <input
          className="input"
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={draft.temperature}
          onChange={(e) => set("temperature", Number(e.target.value))}
        />
        <p className="hint">Для кода лучше низкая — 0.1–0.3.</p>

        <label className="field-label">Max tokens</label>
        <input
          className="input"
          type="number"
          min={256}
          max={64000}
          value={draft.maxTokens}
          onChange={(e) => set("maxTokens", Number(e.target.value))}
        />

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.promptCache !== false}
            onChange={(e) => set("promptCache", e.target.checked)}
          />{" "}
          Кэшировать неизменную часть промпта
        </label>
        <p className="hint">
          Системная инструкция и карта проекта уходят модели с каждым раундом и каждый раз
          оплачиваются заново — на большом репозитории это основная часть счёта. С кэшем провайдер
          берёт за повторное чтение этой части примерно десятую долю цены. Работает у моделей
          Claude; если сервис такое не принимает, приложение просто повторит запрос без кэша.
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">Прокси / VPN</h3>
        <p className="hint">
          Нужно, только если интернет у вас идёт через прокси. Настройки применяются сразу после
          сохранения, перезапускать приложение не нужно.
        </p>

        <label className="field-label">Откуда брать адрес прокси</label>
        <select
          className="input"
          value={draft.proxyMode}
          onChange={(e) => set("proxyMode", e.target.value as Settings["proxyMode"])}
        >
          <option value="system">Из настроек Windows (по умолчанию)</option>
          <option value="manual">Указать адрес вручную</option>
          <option value="direct">Без прокси, напрямую</option>
        </select>

        {draft.proxyMode === "manual" && (
          <>
            <label className="field-label">Адрес прокси</label>
            <input
              className="input"
              placeholder="http://123.45.67.89:8080"
              value={draft.proxyUrl}
              onChange={(e) => set("proxyUrl", e.target.value)}
            />
            <p className="hint">
              Формат — <code>http://адрес:порт</code> (или <code>socks5://адрес:порт</code>). Логин и пароль
              вписывайте в поля ниже, а не в сам адрес: адрес с логином внутри Chromium не принимает. Учтите,
              что для SOCKS5 авторизация по логину/паролю не поддерживается — для прокси с паролем
              используйте вариант <code>http://</code>.
            </p>
          </>
        )}

        {draft.proxyMode !== "direct" && (
          <>
            <p className="hint">
              Логин и пароль — только если прокси их требует (признак — ошибка «407 Proxy Authentication
              Required»). Это данные от прокси, а не от Polza.
            </p>
            <label className="field-label">Логин прокси</label>
            <input className="input" value={draft.proxyUsername} onChange={(e) => set("proxyUsername", e.target.value)} />
            <label className="field-label">Пароль прокси</label>
            <input
              className="input"
              type="password"
              value={draft.proxyPassword}
              onChange={(e) => set("proxyPassword", e.target.value)}
            />
          </>
        )}

        <button type="button" className="btn" onClick={test} disabled={busy}>
          Проверить соединение
        </button>
      </section>

      <section className="card">
        <h3 className="card-title">Доступ в интернет</h3>
        <p className="hint">
          Разрешает агенту искать в интернете и читать страницы по ссылке — он делает это сам, когда
          для ответа нужны внешние данные: документация библиотеки, текст ошибки, изменения в API.
          Поиск — читающее действие, поэтому выполняется сразу, без подтверждения, как чтение файла.
        </p>
        <label className="checkbox-row search-toggle">
          <input
            type="checkbox"
            checked={draft.searchEnabled === true}
            onChange={(e) => set("searchEnabled", e.target.checked)}
          />{" "}
          Разрешить поиск в интернете
        </label>

        {draft.searchEnabled && (
          <>
            <label className="field-label">Поисковик</label>
            <select
              className="input"
              value={draft.searchProvider}
              onChange={(e) => set("searchProvider", e.target.value as Settings["searchProvider"])}
            >
              <option value="duckduckgo">DuckDuckGo — без ключа, работает сразу</option>
              <option value="tavily">Tavily — нужен ключ, но стабильнее</option>
            </select>
            {draft.searchProvider === "tavily" ? (
              <>
                <p className="hint">
                  Ключ бесплатно выдаётся на tavily.com — это поисковый сервис, сделанный специально
                  для ИИ-ассистентов.
                </p>
                <label className="field-label">Ключ Tavily</label>
                <input
                  className="input"
                  type="password"
                  placeholder="tvly-…"
                  value={draft.searchApiKey}
                  onChange={(e) => set("searchApiKey", e.target.value)}
                />
              </>
            ) : (
              <p className="hint">
                DuckDuckGo не требует ключа и работает сразу, но это обычная поисковая страница, а не
                официальный API — иногда может отвечать ошибкой или пустым результатом при частых
                запросах. Если поиск начнёт подводить, переключитесь на Tavily.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h3 className="card-title">Git и GitHub</h3>
        <p className="hint">
          Имя и почта подставляются в коммиты, сделанные из приложения. Токен GitHub нужен, чтобы
          приложение могло само создавать репозитории сборок, класть в них код и запускать сборку —
          он хранится в папке с данными на этом компьютере и никогда не попадает в репозиторий.
        </p>

        <label className="field-label">Токен GitHub</label>
        <div className="row">
          <input
            className="input"
            type="password"
            placeholder="ghp_… или github_pat_…"
            value={githubDraft}
            onChange={(e) => setGithubDraft(e.target.value)}
          />
          <button type="button" className="btn" onClick={saveGitHub}>
            Проверить и сохранить
          </button>
        </div>
        <p className="hint">
          Нужен «classic»-токен с правом <code>repo</code> и <code>workflow</code>: первое — чтобы
          создавать репозиторий сборки и класть в него файлы, второе — чтобы запускать сборку
          установщика.{" "}
          <button
            type="button"
            className="link-like"
            onClick={() =>
              window.api.openExternal(
                "https://github.com/settings/tokens/new?scopes=repo,workflow&description=Личный%20код"
              )
            }
          >
            Создать токен на GitHub
          </button>
        </p>
        {githubState && <p className="notice-text">{githubState}</p>}
        {!githubState && github.token && <p className="hint">Токен сохранён.</p>}
        <div className="row">
          <div className="col">
            <label className="field-label">Имя для коммитов</label>
            <input className="input" value={draft.gitUserName} onChange={(e) => set("gitUserName", e.target.value)} />
          </div>
          <div className="col">
            <label className="field-label">Почта для коммитов</label>
            <input className="input" value={draft.gitUserEmail} onChange={(e) => set("gitUserEmail", e.target.value)} />
          </div>
        </div>
        <div className="row">
          <div className="col">
            <label className="field-label">Пользователь для токена</label>
            <input
              className="input"
              placeholder="x-access-token"
              value={draft.gitTokenUser}
              onChange={(e) => set("gitTokenUser", e.target.value)}
            />
          </div>
          <div className="col">
            <label className="field-label">Токен доступа</label>
            <input
              className="input"
              type="password"
              value={draft.gitToken}
              onChange={(e) => set("gitToken", e.target.value)}
            />
          </div>
        </div>
      </section>

      <ProblemReport />

      <section className="card">
        <h3 className="card-title">Обслуживание</h3>
        <p className="hint">
          Данные лежат обычными файлами, поэтому «замусориться» приложению особо нечем. Растёт здесь
          другое — <b>архив плагинов</b>: версии намеренно не перезаписываются, каждая ложится рядом
          со старой, чтобы всегда можно было вернуться к тому, что уже отдано тестировщикам. Ненужную
          версию можно удалить во вкладке «Плагины».
        </p>
        <button type="button" className="btn" onClick={loadReport} disabled={reportBusy}>
          {reportBusy ? "Считаю…" : "Посмотреть, что занимает место"}
        </button>
        {report && (
          <div className="storage-report">
            <p className="hint">
              Всего: <b>{formatBytes(report.totalBytes)}</b> в папке <code>{report.rootPath}</code>
            </p>
            {report.folders.length === 0 ? (
              <p className="hint">Пока ничего не занято — архив плагинов пуст.</p>
            ) : (
              <ul className="storage-list">
                {report.folders.map((f) => (
                  <li key={f.name}>
                    <span className="storage-name">{f.name}</span>
                    <span className="storage-size">
                      {formatBytes(f.bytes)} · {f.files} файл(ов)
                      {f.versions ? ` · версий: ${f.versions}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="sticky-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          Сохранить
        </button>
        {notice && <span className="notice-text">{notice}</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}
