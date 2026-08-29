import { useState } from "react";
import type { Settings } from "../lib/types";

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
        <h3 className="card-title">Модели</h3>
        <p className="hint">
          Приложение обращается к моделям через ваш аккаунт Polza по обычному OpenAI-совместимому
          адресу. Ключ хранится только на этом компьютере, в папке настроек приложения, и никуда
          больше не отправляется.
        </p>

        <label className="field-label">Адрес API</label>
        <input className="input" value={draft.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />

        <label className="field-label">API-ключ</label>
        <input
          className="input"
          type="password"
          placeholder="Ключ Polza"
          value={draft.apiKey}
          onChange={(e) => set("apiKey", e.target.value)}
        />

        <label className="field-label">Модель</label>
        <div className="row">
          <input
            className="input"
            list="model-list"
            value={draft.model}
            onChange={(e) => set("model", e.target.value)}
          />
          <button type="button" className="btn" onClick={loadModels} disabled={busy}>
            Загрузить список
          </button>
        </div>
        <datalist id="model-list">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </datalist>

        <div className="row">
          <div className="col">
            <label className="field-label">Температура</label>
            <input
              className="input"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              onChange={(e) => set("temperature", Number(e.target.value))}
            />
            <p className="hint">Для кода лучше низкая — 0.1–0.3.</p>
          </div>
          <div className="col">
            <label className="field-label">Лимит токенов ответа</label>
            <input
              className="input"
              type="number"
              min={1000}
              max={200000}
              step={1000}
              value={draft.maxTokens}
              onChange={(e) => set("maxTokens", Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Прокси</h3>
        <p className="hint">
          Если доступ к API идёт через VPN или прокси — включите его здесь. «Системный» берёт
          настройки Windows, «Прямое соединение» игнорирует их полностью.
        </p>

        <label className="field-label">Режим</label>
        <select
          className="input"
          value={draft.proxyMode}
          onChange={(e) => set("proxyMode", e.target.value as Settings["proxyMode"])}
        >
          <option value="system">Системный (как в Windows)</option>
          <option value="manual">Свой адрес прокси</option>
          <option value="direct">Прямое соединение, без прокси</option>
        </select>

        {draft.proxyMode === "manual" && (
          <>
            <label className="field-label">Адрес прокси</label>
            <input
              className="input"
              placeholder="http://127.0.0.1:8080 или socks5://127.0.0.1:1080"
              value={draft.proxyUrl}
              onChange={(e) => set("proxyUrl", e.target.value)}
            />
            <div className="row">
              <div className="col">
                <label className="field-label">Логин прокси</label>
                <input className="input" value={draft.proxyUsername} onChange={(e) => set("proxyUsername", e.target.value)} />
              </div>
              <div className="col">
                <label className="field-label">Пароль прокси</label>
                <input
                  className="input"
                  type="password"
                  value={draft.proxyPassword}
                  onChange={(e) => set("proxyPassword", e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        <button type="button" className="btn" onClick={test} disabled={busy}>
          Проверить соединение
        </button>
      </section>

      <section className="card">
        <h3 className="card-title">Git</h3>
        <p className="hint">
          Имя и почта подставляются в коммиты, сделанные из приложения. Токен нужен только если
          компьютер не помнит доступ к GitHub — он хранится в настройках приложения и никогда не
          попадает в репозиторий.
        </p>
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
