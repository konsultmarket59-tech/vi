import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Conversation,
  Settings,
  Skill,
  StoryFont,
  StoryLayer,
  StoryLayerKind,
  StoryPreset,
  StoryProbe,
  StoryProgress,
  StorySpec,
  StoryStockVideo,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

const fileName = (p: string) => (p ? p.split(/[\\/]/).pop() || p : "");
const secs = (v: number) => `${v.toFixed(1)} с`;

/** Ширина колонки предпросмотра. Холст 1080×1920 в неё не влезет никогда. */
const PREVIEW_W = 300;

export default function VideoStoriesView({ settings, skills, onOpenSettings }: Props) {
  const [presets, setPresets] = useState<StoryPreset[]>([]);
  const [appearKinds, setAppearKinds] = useState<StoryLayerKind[]>([]);
  const [layerKinds, setLayerKinds] = useState<StoryLayerKind[]>([]);
  const [graphicsKinds, setGraphicsKinds] = useState<StoryLayerKind[]>([]);
  const [fonts, setFonts] = useState<StoryFont[]>([]);

  const [title, setTitle] = useState("Ролик");
  const [presetId, setPresetId] = useState("story");
  const [fps, setFps] = useState("30");
  const [duration, setDuration] = useState("15");
  const [sourceKind, setSourceKind] = useState<"file" | "stock">("file");
  const [sourcePath, setSourcePath] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [stock, setStock] = useState<StoryStockVideo[]>([]);
  const [musicPath, setMusicPath] = useState("");
  const [fontFamily, setFontFamily] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [layers, setLayers] = useState<StoryLayer[]>([]);
  const [selected, setSelected] = useState<string>("");

  const [probe, setProbe] = useState<StoryProbe | null>(null);
  const [sceneHtml, setSceneHtml] = useState("");
  const [poster, setPoster] = useState("");
  const [at, setAt] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [progress, setProgress] = useState<StoryProgress | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [applied, setApplied] = useState("");
  const [scriptText, setScriptText] = useState("");

  useEffect(() => {
    window.api.storiesOptions().then((o) => {
      setPresets(o.presets);
      setAppearKinds(o.appear);
      setLayerKinds(o.kinds);
      setGraphicsKinds(o.graphics);
    });
    window.api.storiesFonts().then(setFonts).catch(() => setFonts([]));
    return window.api.onStoriesProgress((p) => {
      setProgress(p);
      if (p.stage === "done") setSaved(p.path || "");
    });
  }, []);

  const preset = presets.find((p) => p.id === presetId);

  const spec = useMemo<Partial<StorySpec>>(
    () => ({
      title,
      presetId,
      fps: Number(fps) || 30,
      duration: Number(duration) || 15,
      source: { kind: sourceKind, path: sourcePath, query: stockQuery, trimStart: 0 },
      musicPath,
      musicVolume: 0.25,
      fonts: fontFamily ? fonts.filter((f) => f.family === fontFamily) : [],
      layers,
    }),
    [title, presetId, fps, duration, sourceKind, sourcePath, stockQuery, musicPath, fontFamily, fonts, layers]
  );

  // Сцена и замечания пересобираются на каждую правку: композицию видно сразу,
  // а не после нескольких минут рендера.
  useEffect(() => {
    let alive = true;
    window.api.storiesScene(spec).then((html) => alive && setSceneHtml(html));
    window.api.storiesValidate(spec).then((p) => alive && setProblems(p));
    return () => {
      alive = false;
    };
  }, [spec]);

  // Кадр исходника под сценой — с задержкой, чтобы не дёргать ffmpeg на каждый шаг.
  useEffect(() => {
    if (sourceKind !== "file" || !sourcePath) {
      setPoster("");
      return;
    }
    const timer = setTimeout(() => {
      window.api.storiesPoster(sourcePath, at, PREVIEW_W * 2).then(setPoster).catch(() => setPoster(""));
    }, 220);
    return () => clearTimeout(timer);
  }, [sourcePath, sourceKind, at]);

  const frameRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    const win = frameRef.current?.contentWindow as (Window & { seek?: (t: number) => void }) | undefined;
    try {
      win?.seek?.(at);
    } catch {
      /* сцена ещё не загрузилась — перерисуется сама */
    }
  }, [at, sceneHtml]);

  async function pickSource() {
    const files = await window.api.pickFiles();
    if (!files?.length) return;
    setSourceKind("file");
    setSourcePath(files[0]);
    const info = await window.api.storiesProbe(files[0]).catch(() => null);
    setProbe(info);
    if (info?.duration) setDuration(String(Math.min(60, Math.round(info.duration))));
  }

  async function findStock() {
    setError(null);
    setBusy(true);
    try {
      setStock(await window.api.storiesSearchStock(stockQuery, preset && preset.width > preset.height ? "landscape" : "portrait"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function addLayer(kind: string) {
    const index = layers.length;
    const base: StoryLayer = {
      id: uid(),
      kind: kind as StoryLayer["kind"],
      start: Number((index * 1.2).toFixed(1)),
      duration: 3,
      appear: kind === "svg" ? "draw" : index % 2 ? "slide-right" : "slide-left",
      appearDur: 0.48,
      exit: "fade",
      exitDur: 0.3,
      x: 6 + (index % 2) * 8,
      y: 12 + index * 9,
      width: 0,
    };
    if (kind === "pill") base.text = "НОВАЯ ФРАЗА";
    if (kind === "timeline") {
      base.steps = ["Шаг", "Шаг", "Шаг"];
      base.width = 84;
    }
    if (kind === "graphics") {
      base.graphics = "network";
      base.hub = "ГЛАВНАЯ МЫСЛЬ";
      base.nodes = ["ПЕРВОЕ", "ВТОРОЕ", "ТРЕТЬЕ"];
      base.width = 86;
    }
    if (kind === "head") {
      base.size = 340;
      base.cropSize = 700;
    }
    setLayers([...layers, base]);
    setSelected(base.id);
  }

  const patch = useCallback(
    (id: string, changes: Partial<StoryLayer>) =>
      setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l))),
    []
  );

  async function attachIcon(id: string) {
    const query = window.prompt("Что за иконка? Например: rocket, chart, phone");
    if (!query) return;
    try {
      const found = await window.api.storiesSearchIcons(query);
      if (!found.length) {
        setError("Ничего не нашлось по этому слову.");
        return;
      }
      patch(id, { svg: await window.api.storiesIcon(found[0].id, "#00D9FF"), iconId: found[0].id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function attachSvg(id: string) {
    const files = await window.api.pickFiles();
    if (!files?.length) return;
    try {
      patch(id, { svg: await window.api.storiesReadSvg(files[0]), sourcePath: files[0] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function askAgent() {
    setError(null);
    setBusy(true);
    try {
      const prepared = await window.api.prepareStoriesScript({ spec, text: scriptText });
      setSystemPrompt(prepared.prompt);
      setConv({ id: uid(), projectId: "", title: "Раскладка по сценам", messages: [], createdAt: Date.now(), updatedAt: Date.now() });
      setApplied("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAssistantMessage(content: string) {
    const parsed = await window.api.parseStoriesScript(content).catch(() => null);
    if (!parsed) {
      setApplied("Агент ответил, но не прислал блок со сценами — раскладка не изменилась.");
      return;
    }
    setLayers(parsed.layers);
    if (parsed.duration) setDuration(String(parsed.duration));
    setApplied(`Подставлено слоёв: ${parsed.layers.length}. Проверьте в предпросмотре и правьте руками.`);
  }

  async function render() {
    setError(null);
    if (!outputDir) {
      const dir = await window.api.pickCleanupFolder();
      if (!dir) return;
      setOutputDir(dir);
      return;
    }
    setBusy(true);
    setSaved("");
    setProgress(null);
    try {
      await window.api.renderStory({ spec, outputDir });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const scale = preset ? PREVIEW_W / preset.width : 0.28;
  const active = layers.find((l) => l.id === selected);

  const field = (label: string, node: React.ReactNode) => (
    <label className="vs-field">
      <span>{label}</span>
      {node}
    </label>
  );

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">🎬</span>
            <h2>Видео-сторис</h2>
          </div>
        </div>

        {!settings.apiKey && (
          <div className="warning-banner">
            API-ключ не задан — собрать ролик можно и без него, но разложить текст по сценам агент
            не сможет.{" "}
            <button className="link-btn" onClick={onOpenSettings}>
              Открыть настройки
            </button>
          </div>
        )}

        <div className="vs-body">
          <div className="vs-form">
            <p className="vs-lead">
              Ролик собирается на вашем компьютере: слои рисует браузер, склеивает ffmpeg. Кадр в
              предпросмотре и кадр в готовом файле считает один и тот же код, поэтому они не
              расходятся.
            </p>

            <section className="vs-block">
              <h3>Исходное видео</h3>
              <div className="vs-tabs">
                <button
                  className={sourceKind === "file" ? "vs-tab on" : "vs-tab"}
                  onClick={() => setSourceKind("file")}
                >
                  С компьютера
                </button>
                <button
                  className={sourceKind === "stock" ? "vs-tab on" : "vs-tab"}
                  onClick={() => setSourceKind("stock")}
                >
                  Со стока
                </button>
              </div>
              {sourceKind === "file" ? (
                <>
                  <button className="btn btn-secondary btn-small" onClick={pickSource}>
                    Выбрать файл…
                  </button>
                  {sourcePath && <p className="vs-path">{sourcePath}</p>}
                  {probe && (
                    <p className="vs-hint">
                      {probe.width}×{probe.height}, {secs(probe.duration)},{" "}
                      {probe.hasAudio ? "со звуком" : "без звука"}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="vs-row">
                    <input
                      value={stockQuery}
                      onChange={(e) => setStockQuery(e.target.value)}
                      placeholder="luxury office, city night…"
                    />
                    <button className="btn btn-secondary btn-small" onClick={findStock} disabled={busy}>
                      Найти
                    </button>
                  </div>
                  {!settings.pexelsKey && (
                    <p className="vs-hint">Для стока нужен ключ Pexels — он задаётся в настройках.</p>
                  )}
                  <div className="vs-stock">
                    {stock.map((v) => (
                      <button
                        key={v.id}
                        className={sourcePath === v.url ? "vs-stock-item on" : "vs-stock-item"}
                        onClick={() => setSourcePath(v.url)}
                        title={`${v.width}×${v.height}, ${v.duration} с, ${v.author}`}
                      >
                        <img src={v.preview} alt="" />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="vs-block">
              <h3>Ролик</h3>
              {field(
                "Название файла",
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              )}
              <div className="vs-pair">
                {field(
                  "Формат",
                  <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                {field(
                  "Кадров в секунду",
                  <input value={fps} onChange={(e) => setFps(e.target.value)} inputMode="numeric" />
                )}
              </div>
              <div className="vs-pair">
                {field(
                  "Длительность, с",
                  <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="decimal" />
                )}
                {field(
                  "Шрифт текста",
                  <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                    <option value="">по умолчанию</option>
                    {fonts.map((f) => (
                      <option key={f.path} value={f.family}>
                        {f.family}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const files = await window.api.pickFiles();
                    if (files?.length) setMusicPath(files[0]);
                  }}
                >
                  + музыка
                </button>
                {musicPath && (
                  <span className="vs-chip">
                    {fileName(musicPath)}
                    <button onClick={() => setMusicPath("")}>✕</button>
                  </span>
                )}
              </div>
            </section>

            <section className="vs-block">
              <h3>Текст и раскладка</h3>
              <textarea
                rows={4}
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                placeholder="Вставьте текст ролика. Агент разложит его по плашкам, вставкам и графике."
              />
              <button className="btn btn-secondary btn-small" onClick={askAgent} disabled={busy}>
                Разложить по сценам
              </button>
              {applied && <div className="vs-applied">{applied}</div>}
            </section>

            <section className="vs-block">
              <h3>Слои</h3>
              <div className="vs-add">
                {layerKinds.map((k) => (
                  <button key={k.id} className="btn btn-secondary btn-small" onClick={() => addLayer(k.id)}>
                    + {k.name}
                  </button>
                ))}
              </div>
              <div className="vs-layers">
                {layers.map((l) => (
                  <div
                    key={l.id}
                    className={l.id === selected ? "vs-layer on" : "vs-layer"}
                    onClick={() => setSelected(l.id)}
                  >
                    <b>{layerKinds.find((k) => k.id === l.kind)?.name || l.kind}</b>
                    <span>{String(l.text || l.hub || l.graphics || "")}</span>
                    <em>
                      {l.start.toFixed(1)}–{(l.start + l.duration).toFixed(1)} с
                    </em>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLayers(layers.filter((x) => x.id !== l.id));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {!layers.length && <p className="vs-hint">Пока пусто. Добавьте слой или попросите агента.</p>}
              </div>
            </section>

            {active && (
              <section className="vs-block">
                <h3>Настройки слоя</h3>
                <div className="vs-pair">
                  {field(
                    "Начало, с",
                    <input
                      value={String(active.start)}
                      onChange={(e) => patch(active.id, { start: Number(e.target.value) || 0 })}
                    />
                  )}
                  {field(
                    "Длительность, с",
                    <input
                      value={String(active.duration)}
                      onChange={(e) => patch(active.id, { duration: Number(e.target.value) || 0.2 })}
                    />
                  )}
                </div>
                <div className="vs-pair">
                  {field(
                    "Слева, %",
                    <input
                      value={String(active.x)}
                      onChange={(e) => patch(active.id, { x: Number(e.target.value) || 0 })}
                    />
                  )}
                  {field(
                    "Сверху, %",
                    <input
                      value={String(active.y)}
                      onChange={(e) => patch(active.id, { y: Number(e.target.value) || 0 })}
                    />
                  )}
                </div>
                {field(
                  "Появление",
                  <select
                    value={active.appear}
                    onChange={(e) => patch(active.id, { appear: e.target.value })}
                  >
                    {appearKinds.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}

                {active.kind === "pill" && (
                  <>
                    {field(
                      "Текст",
                      <textarea
                        rows={2}
                        value={String(active.text || "")}
                        onChange={(e) => patch(active.id, { text: e.target.value })}
                      />
                    )}
                    <div className="vs-pair">
                      {field(
                        "Цвет подложки",
                        <input
                          type="color"
                          value={String(active.bg || "#0A0A0A")}
                          onChange={(e) => patch(active.id, { bg: e.target.value })}
                        />
                      )}
                      {field(
                        "Цвет текста",
                        <input
                          type="color"
                          value={String(active.fg || "#FFFFFF")}
                          onChange={(e) => patch(active.id, { fg: e.target.value })}
                        />
                      )}
                    </div>
                    <div className="vs-pair">
                      {field(
                        "Кегль",
                        <input
                          value={String(active.fontSize ?? 72)}
                          onChange={(e) => patch(active.id, { fontSize: Number(e.target.value) || 40 })}
                        />
                      )}
                      {field(
                        "Скругление",
                        <input
                          value={String(active.radius ?? 0)}
                          onChange={(e) => patch(active.id, { radius: Number(e.target.value) || 0 })}
                        />
                      )}
                    </div>
                    <div className="vs-pair">
                      {field(
                        "Скос, °",
                        <input
                          value={String(active.skew ?? 0)}
                          onChange={(e) => patch(active.id, { skew: Number(e.target.value) || 0 })}
                        />
                      )}
                      {field(
                        "Обводка",
                        <input
                          value={String(active.borderWidth ?? 0)}
                          onChange={(e) => patch(active.id, { borderWidth: Number(e.target.value) || 0 })}
                        />
                      )}
                    </div>
                    <label className="vs-check">
                      <input
                        type="checkbox"
                        checked={!!active.glass}
                        onChange={(e) => patch(active.id, { glass: e.target.checked })}
                      />
                      Стекло — подложка полупрозрачная, фон под ней размыт
                    </label>
                    <label className="vs-check">
                      <input
                        type="checkbox"
                        checked={!!active.shadow}
                        onChange={(e) => patch(active.id, { shadow: e.target.checked })}
                      />
                      Тень под подложкой
                    </label>
                  </>
                )}

                {active.kind === "timeline" && (
                  <>
                    {field(
                      "Шаги через запятую",
                      <input
                        value={(active.steps as string[] | undefined)?.join(", ") || ""}
                        onChange={(e) =>
                          patch(active.id, {
                            steps: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          })
                        }
                      />
                    )}
                    {field(
                      "Фон подложки",
                      <input
                        value={String(active.bg || "")}
                        placeholder="пусто — без фона"
                        onChange={(e) => patch(active.id, { bg: e.target.value })}
                      />
                    )}
                  </>
                )}

                {active.kind === "graphics" && (
                  <>
                    {field(
                      "Вид",
                      <select
                        value={String(active.graphics || "network")}
                        onChange={(e) => patch(active.id, { graphics: e.target.value })}
                      >
                        {graphicsKinds.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {field(
                      "Центр",
                      <input
                        value={String(active.hub || "")}
                        onChange={(e) => patch(active.id, { hub: e.target.value })}
                      />
                    )}
                    {field(
                      "Элементы через запятую",
                      <textarea
                        rows={2}
                        value={(active.nodes as string[] | undefined)?.join(", ") || ""}
                        onChange={(e) =>
                          patch(active.id, {
                            nodes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          })
                        }
                      />
                    )}
                    <p className="vs-hint">
                      Для дашборда и столбцов пишите «подпись | значение» — например «Было | 30».
                    </p>
                  </>
                )}

                {active.kind === "head" && (
                  <>
                    <div className="vs-pair">
                      {field(
                        "Размер кружка",
                        <input
                          value={String(active.size ?? 340)}
                          onChange={(e) => patch(active.id, { size: Number(e.target.value) || 200 })}
                        />
                      )}
                      {field(
                        "Сторона выреза",
                        <input
                          value={String(active.cropSize ?? 700)}
                          onChange={(e) => patch(active.id, { cropSize: Number(e.target.value) || 300 })}
                        />
                      )}
                    </div>
                    <div className="vs-pair">
                      {field(
                        "Вырез: X",
                        <input
                          value={String(active.cropX ?? 0)}
                          onChange={(e) => patch(active.id, { cropX: Number(e.target.value) || 0 })}
                        />
                      )}
                      {field(
                        "Вырез: Y",
                        <input
                          value={String(active.cropY ?? 0)}
                          onChange={(e) => patch(active.id, { cropY: Number(e.target.value) || 0 })}
                        />
                      )}
                    </div>
                    <p className="vs-hint">
                      Вырез — квадрат в пикселях ИСХОДНОГО кадра, из него получается кружок. Ставьте
                      середину на кончик носа: X и Y — левый верхний угол квадрата.
                    </p>
                  </>
                )}

                {(active.kind === "icon" || active.kind === "svg") && (
                  <>
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={() => (active.kind === "icon" ? attachIcon(active.id) : attachSvg(active.id))}
                    >
                      {active.kind === "icon" ? "Найти иконку…" : "Выбрать SVG с компьютера…"}
                    </button>
                    {field(
                      "Размер",
                      <input
                        value={String(active.size ?? 160)}
                        onChange={(e) => patch(active.id, { size: Number(e.target.value) || 80 })}
                      />
                    )}
                    {!!active.svg && <p className="vs-hint">Картинка подключена.</p>}
                  </>
                )}
              </section>
            )}

            {error && <div className="vs-error">{error}</div>}
          </div>

          <div className="vs-right">
            <div className="vs-preview-head">
              <strong>Предпросмотр</strong>
              <span>{at.toFixed(1)} с</span>
            </div>
            <div
              className="vs-preview"
              style={{
                width: PREVIEW_W,
                height: Math.round((preset?.height || 1920) * scale),
              }}
            >
              {poster && <img className="vs-poster" src={poster} alt="" />}
              {sceneHtml && (
                <iframe
                  ref={frameRef}
                  key={sceneHtml.length}
                  className="vs-scene"
                  sandbox="allow-scripts"
                  srcDoc={sceneHtml}
                  style={{
                    width: preset?.width || 1080,
                    height: preset?.height || 1920,
                    transform: `scale(${scale})`,
                  }}
                  title="Сцена"
                  onLoad={() => {
                    const w = frameRef.current?.contentWindow as
                      | (Window & { seek?: (t: number) => void })
                      | undefined;
                    try {
                      w?.seek?.(at);
                    } catch {
                      /* сцена ещё не готова */
                    }
                  }}
                />
              )}
            </div>
            <input
              className="vs-scrub"
              type="range"
              min={0}
              max={Number(duration) || 15}
              step={0.1}
              value={at}
              onChange={(e) => setAt(Number(e.target.value))}
            />

            {problems.length > 0 && (
              <div className="vs-problems">
                <strong>Стоит поправить до сборки:</strong>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="vs-actions">
              <button className="btn" onClick={render} disabled={busy || !sourcePath}>
                {outputDir ? "Собрать ролик" : "Выбрать папку…"}
              </button>
            </div>
            {outputDir && <p className="vs-hint">Папка: {outputDir}</p>}
            {progress && progress.stage !== "done" && (
              <p className="vs-hint">
                {progress.stage === "download" && "Качаю ролик со стока…"}
                {progress.stage === "frames" &&
                  `Рисую кадры: ${progress.done || 0} из ${progress.total || 0}`}
                {progress.stage === "encode" && "Склеиваю видео…"}
              </p>
            )}
            {saved && <div className="vs-saved">Готово: {saved}</div>}

            {conv && (
              <div className="vs-agent">
                <div className="vs-agent-head">
                  <strong>Раскладка по сценам</strong>
                  <button className="btn btn-secondary btn-small" onClick={() => setConv(null)}>
                    Закрыть
                  </button>
                </div>
                <ChatView
                  conversation={conv}
                  systemPrompt={systemPrompt}
                  settings={settings}
                  skills={skills}
                  onUpdate={setConv}
                  onSave={async () => {}}
                  emptyHint="Напишите «разложи» — агент уже видит текст и длительность видео."
                  onAssistantMessage={onAssistantMessage}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
