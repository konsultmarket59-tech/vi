import { useEffect, useState } from "react";
import ConnectionStatus, {
  CHECKING,
  STALE,
  errorText,
  failed,
  ok,
  type ConnectionStatusValue,
} from "./ConnectionStatus";
import type { Settings, StorageReport } from "../lib/types";
import { listModels, type ModelInfo } from "../lib/api";
import { CURATED_CHAT_MODELS, mergeModelLists } from "../lib/curatedModels";
import ProblemReport from "./ProblemReport";
import UsagePanel from "./UsagePanel";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} ГБ`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export default function SettingsView({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rootPath, setRootPath] = useState("");
  const [chatModels, setChatModels] = useState<ModelInfo[]>(CURATED_CHAT_MODELS);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [report, setReport] = useState<StorageReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  // По одному состоянию на подключение: и успех, и отказ должны быть видны с
  // одного взгляда, а не одинаковым серым текстом.
  const [proxyStatus, setProxyStatus] = useState<ConnectionStatusValue | null>(null);
  const [modelStatus, setModelStatus] = useState<ConnectionStatusValue | null>(null);

  useEffect(() => {
    window.api.getConfig().then((cfg) => setRootPath(cfg.rootPath));
    refreshModels({ silent: true });
  }, []);

  /**
   * Список моделей — заодно и проверка подключения: если он получен, значит
   * адрес, ключ и прокси работают вместе. Поэтому ответ показывается статусом,
   * а не строчкой «не удалось загрузить список».
   */
  async function refreshModels({ silent = false } = {}) {
    setLoadingModels(true);
    if (!silent) setModelStatus(CHECKING);
    setModelsError(null);
    try {
      const live = await listModels(draft.baseUrl, draft.apiKey, "chat");
      setChatModels(mergeModelLists(CURATED_CHAT_MODELS, live));
      setModelStatus(ok(`Подключение работает: ключ принят, моделей доступно ${live.length}.`));
    } catch (e) {
      const text = errorText(e);
      setModelsError(text);
      // При автопроверке на старте молчим, если ключа ещё нет: пустое поле —
      // это не сбой подключения, а ещё не заполненная настройка.
      if (!silent || draft.apiKey.trim()) setModelStatus(failed(text));
    } finally {
      setLoadingModels(false);
    }
  }

  /** Проверка после ввода: ключ введён и ещё не проверен — проверяем сами. */
  function checkModelsOnBlur() {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim()) return;
    if (modelStatus && (modelStatus.state === "ok" || modelStatus.state === "checking")) return;
    void refreshModels();
  }

  async function loadReport() {
    setReportLoading(true);
    try {
      setReport(await window.api.getStorageReport());
    } finally {
      setReportLoading(false);
    }
  }

  async function testProxy() {
    setTestingProxy(true);
    setProxyStatus(CHECKING);
    try {
      // Tests the values currently in the form, so there's no need to save first.
      const result = await window.api.testProxy(draft);
      setProxyStatus(
        result.ok
          ? ok(`Соединение работает — ответ за ${result.ms} мс.`)
          : failed(result.error ? errorText(result.error) : "Не удалось подключиться.")
      );
    } catch (e) {
      setProxyStatus(failed(errorText(e)));
    } finally {
      setTestingProxy(false);
    }
  }

  /**
   * Проверка после ввода данных прокси — только когда проверять уже есть что:
   * в ручном режиме без адреса проверка гарантированно провалится и напугает
   * человека посреди набора.
   */
  function checkProxyOnBlur() {
    if (draft.proxyMode === "manual" && !(draft.proxyUrl ?? "").trim()) return;
    if (proxyStatus && (proxyStatus.state === "ok" || proxyStatus.state === "checking")) return;
    void testProxy();
  }

  // Что перестаёт быть проверенным при правке поля: зелёная галочка от старого
  // ключа над новым, непроверенным, просто врёт.
  const MODEL_FIELDS: (keyof Settings)[] = ["baseUrl", "apiKey", "model"];
  const PROXY_FIELDS: (keyof Settings)[] = ["proxyMode", "proxyUrl", "proxyUsername", "proxyPassword"];

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
    if (MODEL_FIELDS.includes(key)) setModelStatus(STALE);
    if (PROXY_FIELDS.includes(key)) setProxyStatus(STALE);
  }

  async function save() {
    await window.api.saveSettings(draft);
    onChange(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function changeFolder() {
    const newPath = await window.api.chooseRootPath();
    if (newPath) setRootPath(newPath);
  }

  return (
    <div className="panel-section settings-view">
      <h2>Папка с данными</h2>
      <p className="hint">
        Все проекты, документы, чаты и навыки хранятся прямо на вашем компьютере, в обычных папках и файлах — ничего
        не уходит в облако и не хранится в этом приложении отдельно.
      </p>
      <div className="folder-row">
        <code className="folder-path">{rootPath || "…"}</code>
        <button className="btn btn-secondary" onClick={changeFolder}>
          Выбрать другую папку
        </button>
        <button className="btn btn-secondary" onClick={() => window.api.openRootPath()}>
          Открыть в проводнике
        </button>
      </div>

      {/* В сборке с предустановленным ключом адрес и ключ не показываются: их
          задаёт автор сборки. Вместо них — расход по моделям. Выбор модели
          остаётся: это часть базовой функциональности. */}
      {draft.managed ? (
        <UsagePanel />
      ) : (
        <>
          <h2>Настройки подключения</h2>
          <p className="hint">
            Подключение к модели через Polza.ai (или любой другой OpenAI-совместимый сервис). Ключ хранится только на
            этом компьютере и никуда не отправляется, кроме указанного адреса API.
          </p>

          <label>Base URL</label>
          <input
            value={draft.baseUrl}
            onChange={(e) => update("baseUrl", e.target.value)}
            onBlur={checkModelsOnBlur}
          />

          <label>API-ключ</label>
          <div className="key-row">
            <input
              className="api-key-input"
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              onBlur={checkModelsOnBlur}
              placeholder="sk-..."
            />
            <button className="btn btn-secondary" onClick={() => setShowKey((v) => !v)}>
              {showKey ? "Скрыть" : "Показать"}
            </button>
            <button className="btn btn-secondary" onClick={() => refreshModels()} disabled={loadingModels}>
              {loadingModels ? "Проверяю…" : "Проверить подключение"}
            </button>
          </div>
          <ConnectionStatus status={modelStatus} />
        </>
      )}

      <h2>Модель</h2>
      <div className="key-row">
        <input
          value={draft.model}
          onChange={(e) => update("model", e.target.value)}
          placeholder="anthropic/claude-sonnet-5"
          list="chat-models-list"
        />
        <button className="btn btn-secondary" onClick={() => refreshModels()} disabled={loadingModels}>
          {loadingModels ? "Загрузка…" : "Обновить список"}
        </button>
      </div>
      <datalist id="chat-models-list">
        {chatModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </datalist>
      {modelsError && (
        <p className="hint">
          Полный список моделей загрузить не удалось, поэтому ниже — заготовленный список часто
          используемых. ID любой другой модели можно ввести вручную.
        </p>
      )}
      {/* В демо-сборке ключ вшит и человеку не показывается — значит, и сервис,
          на котором он заведён, ему ни о чём не говорит и решать ничего не
          помогает. Вместо названия сервиса — адрес, по которому можно спросить,
          какие модели подключены именно к этой копии. */}
      {draft.managed ? (
        <p className="hint">
          Начните вводить название или ID — появятся варианты. Список моделей, подключённых к вашей
          демо-версии, можно запросить у разработчика:{" "}
          <a href="mailto:hello@dynamicbrands.ru">hello@dynamicbrands.ru</a>.
        </p>
      ) : (
        <p className="hint">
          Начните вводить название или ID — появятся варианты (среди них — заготовленный список: Claude Sonnet 5,
          Claude Opus 5, Claude Fable 5, Gemini 3.5 Flash-Lite, Kimi K3, и всё, что удалось загрузить с Polza.ai).
          Точный идентификатор любой другой модели можно скопировать со страницы{" "}
          <a href="https://polza.ai/models" target="_blank" rel="noreferrer">
            polza.ai/models
          </a>{" "}
          — список не ограничен приложением, доступна любая модель, включённая на вашем аккаунте Polza.ai.
        </p>
      )}

      <label>Temperature: {draft.temperature}</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={draft.temperature}
        onChange={(e) => update("temperature", Number(e.target.value))}
      />

      <label>Max tokens</label>
      <input
        type="number"
        min={256}
        max={64000}
        value={draft.maxTokens}
        onChange={(e) => update("maxTokens", Number(e.target.value))}
      />

      <label>
        <input
          type="checkbox"
          checked={draft.promptCache !== false}
          onChange={(e) => update("promptCache", e.target.checked)}
        />{" "}
        Кэшировать неизменную часть промпта
      </label>
      <p className="hint">
        Инструкции проекта, навыки и документы уходят модели с каждым сообщением и каждый раз
        оплачиваются заново — на проектах с документами это основная часть счёта. С кэшем
        провайдер берёт за повторное чтение этой части примерно десятую долю цены. Работает у
        моделей Claude; если сервис такое не принимает, приложение просто повторит запрос без
        кэша. Проверить, сработало ли, можно в разделе «Расход моделей» — там видно, сколько
        входа пришло из кэша.
      </p>

      <h2>Доступ в интернет</h2>
      <p className="hint">
        Разрешает ассистенту искать в интернете и читать страницы по ссылке — он делает это сам, когда для
        ответа нужны свежие данные (новости, цены, что публикуют конкуренты). Это же работает и в задачах по
        расписанию, которые выполняются без вас.
      </p>
      <label>
        <input
          type="checkbox"
          checked={draft.searchEnabled !== false}
          onChange={(e) => update("searchEnabled", e.target.checked)}
        />{" "}
        Разрешить поиск в интернете
      </label>

      {draft.searchEnabled !== false && (
        <>
          <label>Поисковик</label>
          <select
            value={draft.searchProvider ?? "duckduckgo"}
            onChange={(e) => update("searchProvider", e.target.value as "duckduckgo" | "tavily")}
          >
            <option value="duckduckgo">DuckDuckGo — без ключа, работает сразу</option>
            <option value="tavily">Tavily — нужен ключ, но стабильнее</option>
          </select>
          {draft.searchProvider === "tavily" ? (
            <>
              <p className="hint">
                Ключ бесплатно выдаётся на{" "}
                <a href="https://tavily.com" target="_blank" rel="noreferrer">
                  tavily.com
                </a>{" "}
                — это поисковый сервис, сделанный специально для ИИ-ассистентов.
              </p>
              <label>Ключ Tavily</label>
              <input
                type={showKey ? "text" : "password"}
                value={draft.searchApiKey ?? ""}
                onChange={(e) => update("searchApiKey", e.target.value)}
                placeholder="tvly-…"
              />
            </>
          ) : (
            <p className="hint">
              DuckDuckGo не требует ключа и работает сразу, но это обычная поисковая страница, а не
              официальный API — иногда может отвечать ошибкой или пустым результатом при частых запросах.
              Если поиск начнёт подводить, переключитесь на Tavily.
            </p>
          )}
        </>
      )}

      <h2>Прокси / VPN</h2>
      <p className="hint">
        Нужно, только если интернет у вас идёт через прокси. Настройки применяются сразу после сохранения,
        перезапускать приложение не нужно.
      </p>

      <label>Откуда брать адрес прокси</label>
      <select
        value={draft.proxyMode ?? "system"}
        onChange={(e) => update("proxyMode", e.target.value as "system" | "manual" | "direct")}
        onBlur={checkProxyOnBlur}
      >
        <option value="system">Из настроек Windows (по умолчанию)</option>
        <option value="manual">Указать адрес вручную</option>
        <option value="direct">Без прокси, напрямую</option>
      </select>

      {draft.proxyMode === "manual" && (
        <>
          <label>Адрес прокси</label>
          <input
            value={draft.proxyUrl ?? ""}
            onChange={(e) => update("proxyUrl", e.target.value)}
            onBlur={checkProxyOnBlur}
            placeholder="http://123.45.67.89:8080"
          />
          <p className="hint">
            Формат — <code>http://адрес:порт</code> (или <code>socks5://адрес:порт</code>). Логин и пароль
            вписывайте в поля ниже, а не в сам адрес: адрес с логином внутри Chromium не принимает.
            Учтите, что для SOCKS5 авторизация по логину/паролю не поддерживается — для прокси с паролем
            используйте вариант <code>http://</code>.
          </p>
        </>
      )}

      {draft.proxyMode !== "direct" && (
        <>
          <p className="hint">
            Логин и пароль — только если прокси их требует (признак — ошибка «407 Proxy Authentication
            Required»). Это данные от прокси, а не от сервиса моделей.
          </p>
          <label>Логин прокси</label>
          <input
            value={draft.proxyUsername ?? ""}
            onChange={(e) => update("proxyUsername", e.target.value)}
            onBlur={checkProxyOnBlur}
          />
          <label>Пароль прокси</label>
          <div className="key-row">
            <input
              type={showKey ? "text" : "password"}
              value={draft.proxyPassword ?? ""}
              onChange={(e) => update("proxyPassword", e.target.value)}
              onBlur={checkProxyOnBlur}
            />
          </div>
        </>
      )}

      <div className="settings-actions">
        <button className="btn btn-secondary" onClick={testProxy} disabled={testingProxy}>
          {testingProxy ? "Проверяю…" : "Проверить соединение"}
        </button>
      </div>
      <ConnectionStatus status={proxyStatus} />

      <button className="btn btn-primary" onClick={save}>
        Сохранить настройки
      </button>
      {saved && <span className="saved-note">Сохранено ✓</span>}

      <ProblemReport />

      <h2>Обслуживание</h2>
      <p className="hint">
        Данные лежат обычными файлами на вашем компьютере, поэтому «замусориться» приложению особо нечем:
        место занимают в основном сгенерированные картинки и видео. По-настоящему растёт другое —{" "}
        <b>длина переписки в чате</b>: модель каждый раз перечитывает диалог целиком, поэтому длинный чат
        отвечает медленнее и стоит дороже. Приложение само отправляет только последнюю часть переписки, а в
        самом чате предлагает свернуть раннюю часть в краткое изложение (полный текст при этом сохраняется в
        файл).
      </p>
      <div className="settings-actions">
        <button className="btn btn-secondary" onClick={loadReport} disabled={reportLoading}>
          {reportLoading ? "Считаю…" : "Посмотреть, что занимает место"}
        </button>
      </div>
      {report && (
        <div className="storage-report">
          <p className="hint">
            Всего: <b>{formatBytes(report.totalBytes)}</b> в папке <code>{report.rootPath}</code>
          </p>
          <ul className="doc-list">
            {report.folders.map((f) => (
              <li key={f.name}>
                <span className="doc-name">{f.name}</span>
                <span className="doc-size">
                  {formatBytes(f.bytes)} · {f.files} файл(ов)
                </span>
              </li>
            ))}
          </ul>
          {report.heavyChats.length > 0 ? (
            <>
              <p className="hint">
                Длинные чаты — их стоит свернуть прямо в чате кнопкой «Свернуть историю в резюме»:
              </p>
              <ul className="doc-list">
                {report.heavyChats.map((c) => (
                  <li key={c.convId}>
                    <span className="doc-name">
                      {c.projectName} — {c.title}
                    </span>
                    <span className="doc-size">
                      {c.messages} сообщ. · {Math.round(c.chars / 1000)} тыс. симв.
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="hint">Длинных чатов нет — сворачивать пока нечего.</p>
          )}
        </div>
      )}
    </div>
  );
}
