import { useEffect, useState } from "react";
import type { MediaGenerationResult, MediaType, Project, Settings } from "../lib/types";
import { listModels, type ModelInfo } from "../lib/api";

interface Props {
  projects: Project[];
  settings: Settings;
  onOpenSettings: () => void;
}

const TYPE_PLACEHOLDERS: Record<MediaType, { model: string; prompt: string }> = {
  image: { model: "seedream-3", prompt: "Минималистичная обложка поста для соцсетей, тёплые тона, без текста" },
  video: { model: "google/veo3", prompt: "Плавный облёт камеры вокруг современного жилого комплекса на закате" },
  audio: { model: "elevenlabs/sound-effect-v2", prompt: "Спокойная фоновая мелодия для рекламного ролика, 15 секунд" },
};

export default function MediaView({ projects, settings, onOpenSettings }: Props) {
  const [type, setType] = useState<MediaType>("image");
  const [model, setModel] = useState(TYPE_PLACEHOLDERS.image.model);
  const [prompt, setPrompt] = useState("");
  const [projectId, setProjectId] = useState("");
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extraParamsJson, setExtraParamsJson] = useState("");

  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MediaGenerationResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [history, setHistory] = useState<MediaGenerationResult[]>([]);
  const [historyPreview, setHistoryPreview] = useState<{ item: MediaGenerationResult; url: string } | null>(null);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    refreshHistory();
  }, [projectId]);

  useEffect(() => {
    setModels([]);
    setModelsError(null);
    listModels(settings.baseUrl, settings.apiKey, type)
      .then(setModels)
      .catch((e) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, [type, settings.baseUrl, settings.apiKey]);

  async function refreshHistory() {
    setHistory(await window.api.listMediaGenerations(projectId || undefined));
  }

  function selectType(next: MediaType) {
    setType(next);
    setModel(TYPE_PLACEHOLDERS[next].model);
  }

  async function pickReference() {
    const filePath = await window.api.pickReferenceImage();
    if (filePath) setReferenceImagePath(filePath);
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    setResult(null);
    setPreviewUrl(null);
    setStatus("Запуск…");
    const unsubscribe = window.api.onMediaProgress((s) => setStatus(s === "pending" ? "В очереди…" : s === "processing" ? "Генерация выполняется…" : s));
    try {
      const r = await window.api.generateMedia({
        type,
        model: model.trim(),
        prompt: prompt.trim(),
        referenceImagePath: referenceImagePath || undefined,
        extraParamsJson: showAdvanced ? extraParamsJson : undefined,
        projectId: projectId || undefined,
      });
      setResult(r);
      setPreviewUrl(await window.api.readFileAsDataUrl(r.localPath));
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      unsubscribe();
      setGenerating(false);
      setStatus("");
    }
  }

  async function openHistoryItem(item: MediaGenerationResult) {
    setHistoryPreview({ item, url: await window.api.readFileAsDataUrl(item.localPath) });
  }

  return (
    <div className="media-view">
      <div className="ops-toolbar">
        <h2>Медиа</h2>
        <button className="btn btn-secondary" onClick={() => window.api.openMediaFolder(projectId || undefined)}>
          📁 Открыть папку
        </button>
      </div>

      {!settings.apiKey && (
        <div className="warning-banner">
          API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
        </div>
      )}

      <div className="media-layout">
        <div className="panel-section media-form">
          <p className="hint">
            Генерация через модели, доступные по вашему ключу Polza.ai (фото, видео, аудио — единый API). Точный ID
            модели скопируйте со страницы{" "}
            <a href="https://polza.ai/models" target="_blank" rel="noreferrer">
              polza.ai/models
            </a>
            .
          </p>

          <label>Тип</label>
          <div className="media-type-tabs">
            <button className={type === "image" ? "tab active" : "tab"} onClick={() => selectType("image")}>
              Изображение
            </button>
            <button className={type === "video" ? "tab active" : "tab"} onClick={() => selectType("video")}>
              Видео
            </button>
            <button className={type === "audio" ? "tab active" : "tab"} onClick={() => selectType("audio")}>
              Аудио
            </button>
          </div>

          <label>ID модели</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={TYPE_PLACEHOLDERS[type].model}
            list="media-models-list"
          />
          <datalist id="media-models-list">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </datalist>
          {modelsError ? (
            <p className="hint">Не удалось загрузить список моделей: {modelsError}. Введите ID вручную.</p>
          ) : (
            models.length > 0 && <p className="hint">Доступно моделей типа «{type}»: {models.length} — начните вводить, появятся варианты.</p>
          )}

          <label>Промпт</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={TYPE_PLACEHOLDERS[type].prompt}
            rows={4}
          />

          {type !== "audio" && (
            <>
              <label>Референс-изображение (необязательно, для image-to-{type === "video" ? "video" : "image"})</label>
              <div className="folder-row">
                {referenceImagePath && <span className="hint">{referenceImagePath.split(/[\\/]/).pop()}</span>}
                <button className="btn btn-secondary" onClick={pickReference}>
                  Выбрать файл
                </button>
                {referenceImagePath && (
                  <button className="link-btn" onClick={() => setReferenceImagePath(null)}>
                    Убрать
                  </button>
                )}
              </div>
            </>
          )}

          <label>Проект (сохранить результат в его папку media/)</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Без привязки к проекту</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button className="link-btn" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Скрыть" : "Показать"} дополнительные параметры (JSON)
          </button>
          {showAdvanced && (
            <textarea
              value={extraParamsJson}
              onChange={(e) => setExtraParamsJson(e.target.value)}
              placeholder='{"duration": 5, "aspect_ratio": "9:16"}'
              rows={3}
            />
          )}

          {error && <div className="chat-error">{error}</div>}
          <button className="btn btn-primary" onClick={generate} disabled={generating || !model.trim() || !prompt.trim()}>
            {generating ? status || "Генерация…" : "Сгенерировать"}
          </button>

          {result && previewUrl && (
            <div className="media-result-card">
              {result.type === "image" && <img src={previewUrl} alt={result.prompt} />}
              {result.type === "video" && <video src={previewUrl} controls />}
              {result.type === "audio" && <audio src={previewUrl} controls />}
              <div className="media-result-actions">
                <span className="hint">{result.fileName}</span>
              </div>
            </div>
          )}
        </div>

        <div className="media-history">
          <h3>История</h3>
          {history.length === 0 && <p className="hint">Пока ничего не сгенерировано.</p>}
          <ul className="media-history-list">
            {history.map((item) => (
              <li key={item.id} onClick={() => openHistoryItem(item)}>
                <span className="media-history-type">{item.type}</span>
                <span className="media-history-prompt">{item.prompt.slice(0, 60)}</span>
                <span className="hint">{new Date(item.createdAt).toLocaleString("ru-RU")}</span>
              </li>
            ))}
          </ul>
          {historyPreview && (
            <div className="media-result-card">
              {historyPreview.item.type === "image" && <img src={historyPreview.url} alt="" />}
              {historyPreview.item.type === "video" && <video src={historyPreview.url} controls />}
              {historyPreview.item.type === "audio" && <audio src={historyPreview.url} controls />}
              <div className="media-result-actions">
                <span className="hint">{historyPreview.item.model}</span>
                <button className="link-btn" onClick={() => setHistoryPreview(null)}>
                  Закрыть
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
