import { useEffect, useState } from "react";
import type {
  CanvasPreset,
  ChatAttachment,
  Conversation,
  DatavizPrepared,
  Settings,
  Skill,
  VizKind,
  VizPalette,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

function fileName(p: string): string {
  return p ? p.split(/[\\/]/).pop() || p : "";
}

export default function DataVizView({ settings, skills, onOpenSettings }: Props) {
  const [presets, setPresets] = useState<CanvasPreset[]>([]);
  const [palettes, setPalettes] = useState<VizPalette[]>([]);
  const [kinds, setKinds] = useState<VizKind[]>([]);

  const [kindId, setKindId] = useState("dashboard");
  const [presetId, setPresetId] = useState("post");
  const [paletteId, setPaletteId] = useState("brand");
  const [overrides, setOverrides] = useState<Partial<VizPalette>>({});
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [extraStyle, setExtraStyle] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [formats, setFormats] = useState<string[]>(["png", "pdf", "html"]);

  const [prepared, setPrepared] = useState<DatavizPrepared | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; attachments?: ChatAttachment[]; autoSend?: boolean; nonce: number } | undefined>();
  const [result, setResult] = useState<{ title: string; html: string } | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [parseProblem, setParseProblem] = useState("");
  const [savedPaths, setSavedPaths] = useState<{ png?: string; pdf?: string; html?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.datavizOptions().then((o) => {
      setPresets(o.presets);
      setPalettes(o.palettes);
      setKinds(o.kinds);
    });
  }, []);

  const preset = presets.find((p) => p.id === presetId);
  const palette = palettes.find((p) => p.id === paletteId);
  const activeSeries = overrides.series || palette?.series || [];
  // Предпросмотр всегда в одну колонку фиксированной ширины: панель бывает узкой,
  // а макет — 1920 пикселей шириной.
  const previewWidth = 320;
  const previewScale = previewWidth / (preset?.width || 1080);

  async function prepare() {
    setError(null);
    setResult(null);
    setSavedPaths(null);
    setPreviewHtml("");
    setBusy(true);
    try {
      const ready = await window.api.prepareDataviz({
        kindId,
        presetId,
        paletteId,
        paletteOverrides: overrides,
        sourcePaths,
        extraStyle,
      });
      setPrepared(ready);
      // Каждая сборка — новый разговор: макеты делаются по одному, а прошлый
      // в контексте и мешает, и оплачивается заново на каждом запросе.
      setConv({
        id: uid(),
        projectId: "__dataviz__",
        title: kinds.find((k) => k.id === kindId)?.name || "Визуализация",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      setPrefill({
        text: sourcePaths.length ? "Построй визуализацию по этим данным. " : "Построй визуализацию: ",
        attachments: ready.images,
        nonce: Date.now(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAssistantMessage(content: string) {
    setSavedPaths(null);
    setParseProblem("");
    const parsed = await window.api.parseDatavizResult(content).catch(() => null);
    setResult(parsed);
    if (parsed) {
      setPreviewHtml(await window.api.previewDataviz(parsed.html, presetId, paletteId, overrides));
      return;
    }
    setPreviewHtml("");
    // Молчание здесь — худшее, что можно сделать: человек видит пустое место и не
    // понимает, ждать ему или переделывать. Причин ровно две, и обе различимы.
    if (content.includes("===ВИЗУАЛИЗАЦИЯ===")) {
      setParseProblem(
        "Агент начал макет, но не дописал его до конца — ответ оборвался. Обычно это упирается в лимит " +
          "«Max tokens» в настройках: макет на весь холст длинный. Поднимите лимит или попросите макет проще."
      );
    } else {
      setParseProblem(
        "Агент ответил, но не прислал макет в нужном формате — сохранять нечего. Нажмите «Переделать»: " +
          "приложение напомнит ему формат."
      );
    }
  }

  /** Просит агента вернуть ответ в том формате, который приложение умеет сохранить. */
  function askAgain() {
    setParseProblem("");
    setPrefill({
      text:
        "Пришли, пожалуйста, тот же макет строго в формате из инструкции: блок ===ВИЗУАЛИЗАЦИЯ=== " +
        "со строкой TITLE, затем ===HTML=== с разметкой целиком и закрывающая строка ===КОНЕЦ===. " +
        "Разметку не сокращай и не оборачивай в markdown.",
      autoSend: true,
      nonce: Date.now(),
    });
  }

  async function save() {
    if (!result) return;
    if (!outputDir) {
      setError("Не выбрана папка, куда сохранять.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setSavedPaths(
        await window.api.saveDataviz({
          html: result.html,
          title: result.title,
          presetId,
          paletteId,
          paletteOverrides: overrides,
          outputDir,
          formats,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function setSeriesColor(index: number, color: string) {
    const base = [...activeSeries];
    base[index] = color;
    setOverrides((prev) => ({ ...prev, series: base }));
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📊</span>
            <h2>Визуализация данных</h2>
          </div>
        </div>

        {!settings.apiKey && (
          <div className="warning-banner">
            API-ключ не задан.{" "}
            <button className="link-btn" onClick={onOpenSettings}>
              Открыть настройки
            </button>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}

        <div className="docflow-body">
          <div className="docflow-side">
            <div className="docflow-form">
              <div className="docflow-field">
                <label>Что построить</label>
                <select value={kindId} onChange={(e) => setKindId(e.target.value)}>
                  {kinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <p className="hint">{kinds.find((k) => k.id === kindId)?.hint}</p>
              </div>

              <div className="docflow-field">
                <label>Размер</label>
                <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="docflow-field">
                <label>Палитра</label>
                <select
                  value={paletteId}
                  onChange={(e) => {
                    setPaletteId(e.target.value);
                    setOverrides({});
                  }}
                >
                  {palettes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {palette && (
                  <>
                    <div className="viz-swatches">
                      {activeSeries.map((color, i) => (
                        <label key={i} className="viz-swatch" title={`Цвет ряда ${i + 1}`}>
                          <input type="color" value={color} onChange={(e) => setSeriesColor(i, e.target.value)} />
                        </label>
                      ))}
                    </div>
                    <div className="viz-color-row">
                      <label>
                        Акцент
                        <input
                          type="color"
                          value={overrides.accent || palette.accent}
                          onChange={(e) => setOverrides((p) => ({ ...p, accent: e.target.value }))}
                        />
                      </label>
                      <label>
                        Текст
                        <input
                          type="color"
                          value={overrides.text || palette.text}
                          onChange={(e) => setOverrides((p) => ({ ...p, text: e.target.value }))}
                        />
                      </label>
                    </div>
                    {Object.keys(overrides).length > 0 && (
                      <button className="link-btn" onClick={() => setOverrides({})}>
                        вернуть цвета палитры
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="docflow-field">
                <label>Данные</label>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const picked = await window.api.pickDocflowFile("data");
                    if (picked.length > 0) setSourcePaths((prev) => [...prev, ...picked]);
                  }}
                >
                  + Таблица, документ, скриншот
                </button>
                {sourcePaths.map((p) => (
                  <div key={p} className="docflow-path-row">
                    <span className="docflow-path">{fileName(p)}</span>
                    <button className="link-btn" onClick={() => setSourcePaths((prev) => prev.filter((x) => x !== p))}>
                      убрать
                    </button>
                  </div>
                ))}
                <p className="hint">Можно ничего не прикладывать и просто описать данные словами в чате.</p>
              </div>

              <div className="docflow-field">
                <label>Пожелания по стилю</label>
                <textarea
                  rows={2}
                  value={extraStyle}
                  onChange={(e) => setExtraStyle(e.target.value)}
                  placeholder="минимализм, крупные цифры, без рамок"
                />
              </div>

              <div className="docflow-field">
                <label>Куда сохранить</label>
                <div className="docflow-inline">
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={async () => {
                      const picked = await window.api.pickDocflowFolder();
                      if (picked) setOutputDir(picked);
                    }}
                  >
                    Выбрать папку
                  </button>
                  {outputDir && <span className="docflow-path">{outputDir}</span>}
                </div>
                <div className="docflow-inline">
                  {["png", "pdf", "html"].map((f) => (
                    <label key={f} className="docflow-check">
                      <input
                        type="checkbox"
                        checked={formats.includes(f)}
                        onChange={(e) =>
                          setFormats((prev) => (e.target.checked ? [...prev, f] : prev.filter((x) => x !== f)))
                        }
                      />
                      {f.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>

              <button className="btn btn-primary btn-block" onClick={prepare} disabled={busy}>
                {busy ? "Готовлю…" : "Собрать задание для агента"}
              </button>
            </div>
          </div>

          <div className="docflow-main">
            {prepared && (
              <div className="docflow-prepared">
                <span className="docflow-badge">
                  Холст: {preset?.width}×{preset?.height}
                </span>
                {prepared.images.length > 0 && <span className="docflow-badge">Скриншотов: {prepared.images.length}</span>}
                {prepared.problems.map((p) => (
                  <span key={p} className="docflow-badge docflow-badge-warn">
                    {p}
                  </span>
                ))}
              </div>
            )}

            {parseProblem && (
              <div className="viz-problem">
                <span>{parseProblem}</span>
                <button className="btn btn-secondary btn-small" onClick={askAgain}>
                  Переделать
                </button>
              </div>
            )}

            {result && (
              <div className="viz-result">
                <div
                  className="viz-preview-wrap"
                  // Размер коробки — уже уменьшенный. transform не меняет разметку:
                  // без этого коробка занимала полные 1080×1350, вылезала за окно и
                  // выталкивала кнопку сохранения за его правый край.
                  style={{ width: previewWidth, height: Math.round((preset?.height || 1350) * previewScale) }}
                >
                  {/* Разметку от модели показываем в изолированном фрейме без скриптов:
                      в окне самого приложения ей выполняться незачем.

                      Фрейм появляется ТОЛЬКО с готовой разметкой и пересоздаётся по
                      ключу на каждый новый макет. Пустой фрейм, которому srcdoc
                      подставляют следом, оставался белым: загрузка пустого документа
                      и загрузка разметки — две гонки, и выигрывала пустая. Проверено
                      отдельным опытом, а не додумано. */}
                  {previewHtml ? (
                    <iframe
                      key={`${result.title}:${previewHtml.length}`}
                      className="viz-preview"
                      sandbox=""
                      srcDoc={previewHtml}
                      style={{
                        width: preset?.width,
                        height: preset?.height,
                        transform: `scale(${previewScale})`,
                      }}
                      title="Предпросмотр"
                    />
                  ) : (
                    <div className="viz-preview-loading">Готовлю предпросмотр…</div>
                  )}
                </div>
                <div className="viz-result-actions">
                  <strong>{result.title}</strong>
                  <button className="btn btn-primary" onClick={save} disabled={busy || formats.length === 0}>
                    Сохранить
                  </button>
                  {savedPaths && (
                    <div className="docflow-saved">
                      {Object.entries(savedPaths).map(([format, filePath]) => (
                        <div key={format}>
                          <strong>{format.toUpperCase()}:</strong> {filePath}
                        </div>
                      ))}
                      <button className="btn btn-secondary btn-small" onClick={() => window.api.openDocflowFolder(outputDir)}>
                        Открыть папку
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {conv ? (
              <ChatView
                conversation={conv}
                systemPrompt={prepared?.prompt || ""}
                settings={settings}
                skills={skills}
                prefill={prefill}
                onUpdate={setConv}
                onSave={async () => {}}
                emptyHint="Например: «Дашборд по расходу на рекламу за три месяца, главный вывод — где сливается бюджет»."
                onAssistantMessage={onAssistantMessage}
              />
            ) : (
              <div className="empty-state">Настройте макет слева и нажмите «Собрать задание для агента».</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
