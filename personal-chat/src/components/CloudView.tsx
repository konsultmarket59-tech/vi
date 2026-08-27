import { useEffect, useRef, useState } from "react";
import type { CloudAccounts, CloudEntry, CloudProvider, Project, YandexAccount } from "../lib/types";
import NamePrompt, { type NamePromptRequest } from "./NamePrompt";

interface Props {
  projects: Project[];
}

type Tab = "files" | "settings";

const EMPTY_ACCOUNTS: CloudAccounts = { yandex: { activeId: "", accounts: [] }, google: { token: "" } };

/** What to call an account in the UI when it has no label of its own. */
function accountName(account: YandexAccount): string {
  return account.label || account.login || "Без названия";
}

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
  // The connect form is its own draft: credentials belong to the account being added,
  // not to whichever account happens to be selected right now.
  const [draftClientId, setDraftClientId] = useState("");
  const [draftClientSecret, setDraftClientSecret] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [namePrompt, setNamePrompt] = useState<NamePromptRequest | null>(null);

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

  const yandexAccounts = accounts.yandex.accounts;

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
    const connected = provider === "yandex" ? yandexAccounts.length > 0 : !!accounts.google.token;
    if (!connected) {
      setEntries([]);
      setError(
        provider === "yandex"
          ? "Яндекс Диск не подключён — откройте вкладку «Подключение» и добавьте аккаунт."
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
        clientId: draftClientId,
        clientSecret: draftClientSecret,
        label: draftLabel,
        manualCode: useManualCode ? manualCode : "",
      });
      if (result.accounts) setAccounts(result.accounts);
      if (result.ok) {
        setShowManualCode(false);
        setManualCode("");
        // The form stays open on a duplicate: the next thing she needs is another
        // attempt under a different account, not a closed form and a false sense of
        // having added one.
        if (!result.duplicate) {
          setShowConnectForm(false);
          setDraftClientId("");
          setDraftClientSecret("");
          setDraftLabel("");
        }
        setTestResult((prev) => ({
          ...prev,
          yandex: result.duplicate
            ? `Это тот же аккаунт, что уже в списке (${result.login}) — он обновлён, новый не добавился. ` +
              "В окне входа Яндекс подставляет последний использованный аккаунт: нажмите «Подключить» ещё раз " +
              "и в открывшемся окне выберите «Войти в другой аккаунт» (или сначала выйдите из текущего)."
            : `Подключено${result.login ? `: ${result.login}` : ""} ✓ Токен сохранён на этом компьютере.`,
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

  async function switchAccount(id: string) {
    setAccounts(await window.api.setActiveYandexAccount(id));
    setTestResult((prev) => ({ ...prev, yandex: undefined }));
    // The folder listing belongs to the old account — start over at its root.
    setTrail([{ name: "Корень", path: "disk:/" }]);
    setFolder("disk:/");
  }

  async function removeAccount(account: YandexAccount) {
    if (!confirm(`Отключить аккаунт «${accountName(account)}»? Токен и переписка агента Директа по нему будут удалены.`)) {
      return;
    }
    setAccounts(await window.api.removeYandexAccount(account.id));
  }

  function renameAccount(account: YandexAccount) {
    setNamePrompt({
      title: "Название аккаунта",
      initial: accountName(account),
      onSubmit: async (label) => setAccounts(await window.api.renameYandexAccount(account.id, label)),
    });
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
      <NamePrompt request={namePrompt} onClose={() => setNamePrompt(null)} />
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
          <h3>Яндекс — аккаунты</h3>
          <p className="hint">
            Аккаунтов может быть несколько: у каждого свой Диск и <b>свой Директ</b>. Выбранный аккаунт —
            тот, с которым работают и «Файлы» здесь, и раздел «📣 Директ».
          </p>

          {yandexAccounts.length > 0 ? (
            <ul className="doc-list account-list">
              {yandexAccounts.map((a) => (
                <li key={a.id} className={a.id === accounts.yandex.activeId ? "account-row active" : "account-row"}>
                  <label className="account-pick">
                    <input
                      type="radio"
                      name="yandex-account"
                      checked={a.id === accounts.yandex.activeId}
                      onChange={() => switchAccount(a.id)}
                    />
                    <span className="doc-name">
                      {accountName(a)}
                      {a.login && a.label && a.label !== a.login && <span className="hint"> · {a.login}</span>}
                      {a.directClientLogin && <span className="hint"> · Директ: {a.directClientLogin}</span>}
                    </span>
                  </label>
                  <span className="doc-size">
                    {a.expiresAt ? `до ${new Date(a.expiresAt).toLocaleDateString("ru-RU")}` : ""}
                  </span>
                  <button className="btn btn-secondary" onClick={() => renameAccount(a)}>
                    Переименовать
                  </button>
                  <button className="btn btn-secondary" onClick={() => removeAccount(a)}>
                    Отключить
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Пока ни одного аккаунта не подключено.</p>
          )}

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => setShowConnectForm((v) => !v)}>
              {showConnectForm ? "Скрыть форму" : "+ Подключить аккаунт Яндекса"}
            </button>
            {yandexAccounts.length > 0 && (
              <button className="btn btn-secondary" onClick={() => testProvider("yandex")} disabled={testing === "yandex"}>
                {testing === "yandex" ? "Проверка…" : "Проверить выбранный"}
              </button>
            )}
          </div>

          {showConnectForm && (
            <>
              <p className="hint">
                На{" "}
                <a href="https://oauth.yandex.ru/" target="_blank" rel="noreferrer">
                  oauth.yandex.ru
                </a>{" "}
                создайте приложение и отметьте права <code>cloud_api:disk.read</code>,{" "}
                <code>cloud_api:disk.write</code> и Яндекс.Директа. Яндекс выдаст <b>Client ID</b> и{" "}
                <b>Client secret</b> — это не токен, а ключи, по которым приложение само получит токен.
                Нажмите «Подключить»: откроется окно входа — <b>войдите в тот аккаунт, который добавляете</b>.
              </p>
              <label>Название (как вам удобно называть этот аккаунт)</label>
              <input
                value={draftLabel}
                placeholder="например, Динамика или Сверху"
                onChange={(e) => setDraftLabel(e.target.value)}
              />
              <label>Client ID</label>
              <input value={draftClientId} onChange={(e) => setDraftClientId(e.target.value)} />
              <label>Client secret</label>
              <input
                type="password"
                value={draftClientSecret}
                onChange={(e) => setDraftClientSecret(e.target.value)}
              />
              <p className="hint">
                Одно приложение на oauth.yandex.ru подходит для всех аккаунтов — Client ID и secret вписывайте
                те же самые. Различаться будет только аккаунт, под которым вы войдёте в открывшемся окне.
                Окно каждый раз открывается «с нуля», без запомненного входа, поэтому Яндекс спросит логин.
                Если он всё же показал уже знакомый аккаунт — выберите в окне «Войти в другой аккаунт».
              </p>
              <div className="settings-actions">
                <button className="btn btn-primary" onClick={() => connectYandex(false)} disabled={connecting}>
                  {connecting ? "Подключение…" : "Подключить"}
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
            </>
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
