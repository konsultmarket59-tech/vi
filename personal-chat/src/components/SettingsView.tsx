import { useEffect, useState } from "react";
import type { Settings } from "../lib/types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export default function SettingsView({ settings, onChange }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rootPath, setRootPath] = useState("");

  useEffect(() => {
    window.api.getConfig().then((cfg) => setRootPath(cfg.rootPath));
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
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

      <h2>Настройки подключения</h2>
      <p className="hint">
        Подключение к модели через Polza.ai (или любой другой OpenAI-совместимый сервис). Ключ хранится только на
        этом компьютере и никуда не отправляется, кроме указанного адреса API.
      </p>

      <label>Base URL</label>
      <input value={draft.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} />

      <label>API-ключ</label>
      <div className="key-row">
        <input
          type={showKey ? "text" : "password"}
          value={draft.apiKey}
          onChange={(e) => update("apiKey", e.target.value)}
          placeholder="sk-..."
        />
        <button className="btn btn-secondary" onClick={() => setShowKey((v) => !v)}>
          {showKey ? "Скрыть" : "Показать"}
        </button>
      </div>

      <label>Модель</label>
      <input value={draft.model} onChange={(e) => update("model", e.target.value)} placeholder="anthropic/claude-sonnet-5" />
      <p className="hint">
        Точный идентификатор модели скопируйте со страницы{" "}
        <a href="https://polza.ai/models" target="_blank" rel="noreferrer">
          polza.ai/models
        </a>{" "}
        (например: anthropic/claude-sonnet-5, anthropic/claude-opus-5).
      </p>

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

      <button className="btn btn-primary" onClick={save}>
        Сохранить настройки
      </button>
      {saved && <span className="saved-note">Сохранено ✓</span>}
    </div>
  );
}
