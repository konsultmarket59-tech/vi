import { useEffect, useRef, useState } from "react";
import type { CloudAccounts, CloudEntry, CloudProvider, Project } from "../lib/types";

interface Props {
  projects: Project[];
}

type Tab = "files" | "settings";

const EMPTY_ACCOUNTS: CloudAccounts = {
  yandex: { token: "", clientId: "", clientSecret: "", refreshToken: "", expiresAt: 0 },
  google: { token: "" },
};

const PROVIDER_LABEL: Record<CloudProvider, string> = { yandex: "Яндекс Диск", google: "Google Диск" };

/** Where "up one level" leads, per provider's addressing scheme. */
function parentFolder(provider: CloudProvider, folder: string, trail: { name: string; path: string }[]): string {
  if (provider === "yandex") {
    const clean = folder.replace(/\/$/, "");
    const cut = clean.lastIndexOf("/");
    return cut <= "disk:".length ? "disk:/" : clean.slice(0, cut);
  }
  // Google Drive has no paths — walk the breadcrumb we built on the way in.
  return trail.length > 1 ? trail[trail.length - 2].path : "root";
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export default function CloudView({ projects }: Props) {
  const [tab, setTab] = useState<Tab>("files");
  const [accounts, setAccounts] = useState<CloudAccounts>(EMPTY_ACCOUNTS);
  const [provider, setProvider] = useState<CloudProvider>("yandex");
  const [testResult, setTestResult] = useState<Partial<Record<CloudProvider, string>>>({});
  const [testing, setTesting] = useState<CloudProvider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [showManualCode, setShowManualCode] = useState(false);

  const [folder, setFolder] = useState("disk:/");
  const [trail, setTrail] = useState<{ name: string; path: string }[]>([{ name: "Корень", path: "disk:/" }]);
  const [entries, setEntries] = useState<CloudEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [targetProject, setTargetProject] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Shows a status line, cancelling any pending auto-clear first. Without that
   * cancellation a timer armed by an earlier action (e.g. "Сохранено") fires later
   * and wipes a newer, unrelated message — which is exactly how a successful
   * download ended up showing no confirmation at all.
   */
  function showNote(text: string, autoClearMs?: number) {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = null;
    setNote(text);
    if (autoClearMs) {
      noteTimer.current = setTimeout(() => {
        noteTimer.current = null;
        setNote(null);
      }, autoClearMs);
    }
  }

  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  useEffect(() => {
    window.api.getCloudAccounts().then(setAccounts);
  }, []);

  useEffect(() => {
    const root = provider === "yandex" ? "disk:/" : "root";
    setFolder(root);
    setTrail([{ name: "Корень", path: root }]);
  }, [provider]);

  useEffect(() => {
    if (tab === "files") loadFolder(folder);
  }, [tab, provider, folder]);

  async function loadFolder(target: string) {
    if (!accounts[provider].token) {
      setEntries([]);
      setError(
        provider === "yandex"
          ? "Яндекс Диск не подключён — откройте вкладку «Подключение» и нажмите «Подключить Яндекс»."
          : `${PROVIDER_LABEL[provider]} не подключён — вставьте токен на вкладке «Подключение».`
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(await window.api.listCloudFiles(provider, target));
    } catch (e) {
      setEntries([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function openFolder(entry: CloudEntry) {
    setTrail((prev) => [...prev, { name: entry.name, path: entry.path }]);
    setFolder(entry.path);
  }

  function goUp() {
    const parent = parentFolder(provider, folder, trail);
    setTrail((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setFolder(parent);
  }

  async function saveAccountsDraft() {
    setAccounts(await window.api.saveCloudAccounts(accounts));
    showNote("Сохранено", 2500);
  }

  /**
   * Runs the OAuth exchange. `useManualCode` is the fallback for apps registered so
   * that Yandex only prints the code on the page instead of putting it in a URL.
   */
  async function connectYandex(useManualCode: boolean) {
    setConnecting(true);
    setTestResult((prev) => ({ ...prev, yandex: undefined }));
    try {
      const result = await window.api.connectYandexCloud({
        clientId: accounts.yandex.clientId,
        clientSecret: accounts.yandex.clientSecret,
        manualCode: useManualCode ? manualCode : "",
      });
      if (result.accounts) setAccounts(result.accounts);
      if (result.ok) {
        setShowManualCode(false);
        setManualCode("");
        setTestResult((prev) => ({
          ...prev,
          yandex: `Подключено${result.login ? `: ${result.login}` : ""} ✓ Токен сохранён на этом компьютере.`,
        }));
      } else {
        if (result.needsCode) setShowManualCode(true);
        setTestResult((prev) => ({ ...prev, yandex: `Ошибка: ${result.error}` }));
      }
    } catch (e) {
      setTestResult((prev) => ({ ...prev, yandex: `Ошибка: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setConnecting(false);
    }
  }

  async function testProvider(p: CloudProvider) {
    setTesting(p);
    try {
      const result = await window.api.testCloudConnection(p, p === "yandex" ? "" : accounts[p].token);
      setTestResult((prev) => ({
        ...prev,
        [p]: result.ok ? `Подключено${result.login ? `: ${result.login}` : ""} ✓` : `Ошибка: ${result.error}`,
      }));
    } finally {
      setTesting(null);
    }
  }

  async function download(entry: CloudEntry) {
    setError(null);
    setNote(null);
    try {
      if (targetProject) {
        const r = await window.api.downloadCloudFileToProject(provider, entry.path, entry.name, targetProject);
        showNote(`Скачано в документы проекта: ${r.path}`);
      } else {
        const r = await window.api.downloadCloudFile(provider, entry.path, entry.name);
        showNote(`Скачано: ${r.path}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function upload() {
    setError(null);
    setNote(null);
    try {
      const r = await window.api.uploadFileToCloud(provider, folder);
      if (r) {
        showNote(`Загружено: ${r.name ?? r.path}`);
        loadFolder(folder);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="ops-view">
      <div className="ops-toolbar">
        <h2>☁️ Облако</h2>
        <div className="project-tabs">
          <button className={tab === "files" ? "tab active" : "tab"} onClick={() => setTab("files")}>
            Файлы
          </button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
            Подключение
          </button>
        </div>
      </div>

      {tab === "settings" && (
        <div className="panel-section">
          <h3>Яндекс Диск</h3>
          <p className="hint">
            На{" "}
            <a href="https://oauth.yandex.ru/" target="_blank" rel="noreferrer">
              oauth.yandex.ru
            </a>{" "}
            создайте приложение и отметьте права <code>cloud_api:disk.read</code> и{" "}
            <code>cloud_api:disk.write</code>. Яндекс выдаст <b>Client ID</b> и <b>Client secret</b> — это не
            токен, а ключи, по которым приложение само получит токен для вашего аккаунта. Впишите их сюда и
            нажмите «Подключить Яндекс»: откроется окно входа в Яндекс, и после подтверждения токен сохранится
            здесь, на этом компьютере.
          </p>
          <label>Client ID</label>
          <input
            value={accounts.yandex.clientId}
            onChange={(e) => setAccounts({ ...accounts, yandex: { ...accounts.yandex, clientId: e.target.value } })}
          />
          <label>Client secret</label>
          <input
            type="password"
            value={accounts.yandex.clientSecret}
            onChange={(e) =>
              setAccounts({ ...accounts, yandex: { ...accounts.yandex, clientSecret: e.target.value } })
            }
          />
          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => connectYandex(false)} disabled={connecting}>
              {connecting ? "Подключение…" : "Подключить Яндекс"}
            </button>
            <button className="btn btn-secondary" onClick={() => testProvider("yandex")} disabled={testing === "yandex"}>
              {testing === "yandex" ? "Проверка…" : "Проверить"}
            </button>
          </div>

          {showManualCode && (
            <>
              <label>Код подтверждения из Яндекса</label>
              <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} />
              <p className="hint">
                Если Яндекс показал код на странице, а не вернул его автоматически — скопируйте код сюда.
              </p>
              <div className="settings-actions">
                <button className="btn btn-primary" onClick={() => connectYandex(true)} disabled={connecting}>
                  Обменять код на токен
                </button>
              </div>
            </>
          )}

          {accounts.yandex.token && (
            <p className="hint">
              Токен получен и сохранён
              {accounts.yandex.expiresAt
                ? ` (действует до ${new Date(accounts.yandex.expiresAt).toLocaleDateString("ru-RU")}, продлевается автоматически)`
                : ""}
              .
            </p>
          )}
          {testResult.yandex && <p className="hint chatbot-test-result">{testResult.yandex}</p>}

          <h3>Google Диск</h3>
          <p className="hint">
            Нужен OAuth access-token с доступом к Google Drive. Быстрый способ получить его для своего
            аккаунта —{" "}
            <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer">
              OAuth&nbsp;Playground
            </a>
            : выберите Drive API v3 (scope <code>https://www.googleapis.com/auth/drive</code>), разрешите
            доступ и скопируйте access-token. Учтите: такой токен живёт около часа, потом его нужно получить
            заново — постоянное подключение требует собственного приложения в Google Cloud.
          </p>
          <label>Токен Google Диска</label>
          <input
            type="password"
            value={accounts.google.token}
            onChange={(e) => setAccounts({ ...accounts, google: { token: e.target.value } })}
          />
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={() => testProvider("google")} disabled={testing === "google"}>
              {testing === "google" ? "Проверка…" : "Проверить"}
            </button>
            <button className="btn btn-primary" onClick={saveAccountsDraft}>
              Сохранить
            </button>
          </div>
          {testResult.google && <p className="hint">{testResult.google}</p>}
          {note && <p className="hint">{note}</p>}

          <h3>NotebookLM</h3>
          <p className="hint">
            Подключить не получится: у NotebookLM нет публичного API — Google не предоставляет ни адресов для
            запросов, ни прав доступа к нему. Работать с ним можно только вручную через сайт. Обходной путь:
            выгрузить нужные материалы из NotebookLM в Google Документы, а их уже читать отсюда через Google
            Диск.
          </p>
        </div>
      )}

      {tab === "files" && (
        <div className="panel-section cloud-files">
          <div className="folder-row">
            <select value={provider} onChange={(e) => setProvider(e.target.value as CloudProvider)}>
              <option value="yandex">Яндекс Диск</option>
              <option value="google">Google Диск</option>
            </select>
            <button className="btn btn-secondary" onClick={goUp} disabled={trail.length <= 1}>
              ↑ Наверх
            </button>
            <button className="btn btn-secondary" onClick={() => loadFolder(folder)} disabled={loading}>
              {loading ? "Загрузка…" : "Обновить"}
            </button>
            <button className="btn btn-secondary" onClick={upload}>
              ⬆ Загрузить файл сюда
            </button>
          </div>

          <p className="hint">Путь: {trail.map((t) => t.name).join(" / ")}</p>

          <label>Скачивать в документы проекта</label>
          <select value={targetProject} onChange={(e) => setTargetProject(e.target.value)}>
            <option value="">— просто в папку загрузок приложения —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Если выбрать проект, скачанный файл сразу попадёт в его документы и станет частью базы знаний.
          </p>

          {error && <div className="chat-error">{error}</div>}
          {note && <p className="hint">{note}</p>}

          <ul className="doc-list">
            {entries.length === 0 && !loading && !error && <p className="hint">Папка пуста.</p>}
            {entries.map((entry) => (
              <li key={entry.path}>
                <span className="doc-name">
                  {entry.isFolder ? "📁 " : "📄 "}
                  {entry.isFolder ? (
                    <button className="link-btn" onClick={() => openFolder(entry)}>
                      {entry.name}
                    </button>
                  ) : (
                    entry.name
                  )}
                </span>
                <span className="doc-size">{formatSize(entry.size)}</span>
                {!entry.isFolder && (
                  <button className="btn btn-secondary" onClick={() => download(entry)}>
                    Скачать
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
