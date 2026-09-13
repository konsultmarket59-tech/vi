import { useEffect, useState } from "react";
import type {
  MediaGenerationResult,
  MediaKit,
  MediaKitChoice,
  MediaKitEntry,
  MediaLine,
  MediaPending,
  MediaReference,
  MediaScene,
  MediaScriptKind,
  MediaScriptProgress,
  MediaType,
  Project,
  Settings,
  StoriesDesign,
} from "../lib/types";
import { listModels, type ModelInfo } from "../lib/api";
import MentionBox, { type MentionItem } from "./MentionBox";
import { CURATED_IMAGE_MODELS, CURATED_VIDEO_MODELS, mergeModelLists } from "../lib/curatedModels";

const CURATED_BY_TYPE: Record<MediaType, ModelInfo[]> = {
  image: CURATED_IMAGE_MODELS,
  video: CURATED_VIDEO_MODELS,
  audio: [],
};

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
  // Референсов может быть сколько угодно, и у каждого есть имя: в промпте к
  // ним обращаются через @ и говорят про каждый своё.
  const [references, setReferences] = useState<MediaReference[]>([]);
  const [resolved, setResolved] = useState<{
    prompt: string; images: { name: string }[]; missing: string[]; note: string;
    commands: string[]; unknownCommands: string[];
  } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [extraParamsJson, setExtraParamsJson] = useState("");

  // Набор приёмов: движения камеры, ракурсы, схемы света и стили. Промпт из них
  // собирается в главном процессе — строки живут там же, где описания.
  const [kit, setKit] = useState<MediaKit | null>(null);
  const [choice, setChoice] = useState<MediaKitChoice>({});
  const [subject, setSubject] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [design, setDesign] = useState<StoriesDesign | null>(null);
  const [openGroup, setOpenGroup] = useState<string>("");
  // Своя папка для готовых файлов. Хранится в настройках, но выбирается здесь:
  // думают о ней ровно в тот момент, когда смотрят на растущую историю.
  const [mediaFolder, setMediaFolder] = useState(settings.mediaFolder || "");
  const [moving, setMoving] = useState(false);
  // Заготовка промпта и то, чем заполнены её места. Выбранное здесь никуда не
  // уходит само: промпт собирается только по нажатию, и человек видит текст.
  const [templateId, setTemplateId] = useState("");
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<MediaPending[]>([]);
  const [collecting, setCollecting] = useState("");
  // Номер заказа из личного кабинета: заказ мог быть сделан в прошлой версии
  // приложения или вовсе не здесь, а оплачен всё равно.
  const [orderId, setOrderId] = useState("");

  // Видео-презентации и подкасты: модель пишет только сценарий, картинки,
  // голоса и сборку делает приложение.
  const [mode, setMode] = useState<"single" | "script">("single");
  const [scriptKinds, setScriptKinds] = useState<MediaScriptKind[]>([]);
  const [scriptKind, setScriptKind] = useState("presentation");
  const [source, setSource] = useState("");
  const [minutes, setMinutes] = useState("3");
  const [notes, setNotes] = useState("");
  const [nameA, setNameA] = useState("Аня");
  const [nameB, setNameB] = useState("Борис");
  const [scriptText, setScriptText] = useState("");
  const [scenes, setScenes] = useState<MediaScene[]>([]);
  const [lines, setLines] = useState<MediaLine[]>([]);
  const [scriptProblems, setScriptProblems] = useState<string[]>([]);
  const [voiceModel, setVoiceModel] = useState("");
  const [voiceA, setVoiceA] = useState("");
  const [voiceB, setVoiceB] = useState("");
  const [scriptProgress, setScriptProgress] = useState<MediaScriptProgress | null>(null);
  const [built, setBuilt] = useState("");

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

  // Промпт разбирается по мере набора: опечатку в имени референса надо
  // показать до того, как генерация оплачена, а не после.
  useEffect(() => {
    if (!prompt.trim() && !references.length) {
      setResolved(null);
      return;
    }
    let живо = true;
    const t = window.setTimeout(() => {
      window.api
        .mediaResolvePrompt(prompt, references)
        .then((r) => живо && setResolved(r))
        .catch(() => {});
    }, 250);
    return () => {
      живо = false;
      window.clearTimeout(t);
    };
  }, [prompt, references]);

  // Сторож незабранных работает в главном процессе и забирает готовое сам.
  // Окно узнаёт об этом и обновляет историю: иначе человек смотрит на список,
  // в котором уже лежит его картинка, и не видит её до перезахода в раздел.
  useEffect(() => {
    return window.api.onMediaCollected(() => {
      refreshHistory();
    });
  }, [projectId]);

  useEffect(() => {
    window.api.mediaKit().then(setKit);
    window.api.mediaScriptKinds().then(setScriptKinds);
    return window.api.onMediaScriptProgress(setScriptProgress);
  }, []);

  useEffect(() => {
    setModels(CURATED_BY_TYPE[type]);
    setModelsError(null);
    listModels(settings.baseUrl, settings.apiKey, type)
      .then((fetched) => setModels(mergeModelLists(CURATED_BY_TYPE[type], fetched)))
      .catch((e) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, [type, settings.baseUrl, settings.apiKey]);

  async function refreshHistory() {
    setHistory(await window.api.listMediaGenerations(projectId || undefined));
    setPending(await window.api.listPendingMedia());
  }

  /**
   * Забрать оплаченный, но не дождавшийся результат.
   *
   * Ожидание у экрана и судьба заказа — разные вещи: деньги сняты в момент
   * создания, и результат обязан достаться человеку, сколько бы он ни считался.
   */
  async function collect(id: string) {
    setError(null);
    setCollecting(id);
    try {
      const r = await window.api.collectMedia(id);
      if (r.ready && r.item) {
        setResult(r.item);
        setPreviewUrl(await window.api.readFileAsDataUrl(r.item.localPath));
      } else {
        setError("Ещё не готово — модель считает. Попробуйте через минуту.");
      }
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCollecting("");
    }
  }

  function selectType(next: MediaType) {
    setType(next);
    setModel(TYPE_PLACEHOLDERS[next].model);
    // Поля у типов разные: оставить заполненную длительность ролика при
    // переходе на картинку значит отправить модели поле, которого она не знает.
    setParams({});
    // Заготовка принадлежит своему типу: оставить видеосценарий выбранным при
    // переходе на картинку значит собрать промпт, который эта модель не поймёт.
    setTemplateId("");
    setSlots({});
    if (next === "audio") setChoice({});
  }

  /** Приёмы выбираются по одному в группе: второй щелчок снимает выбор. */
  function pick(group: keyof MediaKitChoice, id: string) {
    setChoice((prev) => ({ ...prev, [group]: prev[group] === id ? undefined : id }));
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
        references,
        extraParamsJson: showAdvanced ? extraParamsJson : undefined,
        projectId: projectId || undefined,
        kit: choice,
        subject: subject.trim() || undefined,
        params,
        design,
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

  /** Сценарий одним нажатием: приложение само спрашивает модель. */
  async function askForScript() {
    setError(null);
    setBuilt("");
    setGenerating(true);
    setStatus("Модель пишет сценарий…");
    try {
      const written = await window.api.mediaWriteScript({
        kind: scriptKind,
        source,
        minutes: Number(minutes) || 3,
        notes,
        names: { a: nameA, b: nameB },
        design,
      });
      setScriptText(written.text);
      setScenes(written.scenes || []);
      setLines(written.lines || []);
      setScriptProblems(written.problems);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setStatus("");
    }
  }

  /** То же задание, но в буфер: сценарий иногда пишут в другом чате. */
  async function copyScriptPrompt() {
    setError(null);
    try {
      const { prompt: p } = await window.api.mediaScriptPrompt({
        kind: scriptKind,
        source,
        minutes: Number(minutes) || 3,
        notes,
        names: { a: nameA, b: nameB },
        design,
      });
      await navigator.clipboard.writeText(p);
      setStatus("Задание скопировано — вставьте его в чат с моделью и принесите ответ сюда.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function parseScript() {
    setError(null);
    setBuilt("");
    try {
      const parsed = await window.api.mediaParseScript(scriptKind, scriptText);
      setScenes(parsed.scenes || []);
      setLines(parsed.lines || []);
      setScriptProblems(parsed.problems);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function buildScript() {
    setError(null);
    setBuilt("");
    setGenerating(true);
    try {
      const result =
        scriptKind === "podcast"
          ? await window.api.buildMediaPodcast({
              lines, voiceModel: voiceModel.trim(), voiceA, voiceB, projectId: projectId || undefined,
            })
          : await window.api.buildMediaPresentation({
              scenes, imageModel: model.trim(), voiceModel: voiceModel.trim(), voice: voiceA,
              projectId: projectId || undefined, design, kit: choice, params,
            });
      setBuilt(result.path);
      if (result.failed.length) {
        setError(
          `Не собралось частей: ${result.failed.length}. ` +
            [...new Set(result.failed.map((f) => f.error))].join("; ")
        );
      }
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setScriptProgress(null);
    }
  }

  async function openHistoryItem(item: MediaGenerationResult) {
    setHistoryPreview({ item, url: await window.api.readFileAsDataUrl(item.localPath) });
  }

  const chosenStyle = kit ? kit.styles.find((x) => x.id === choice.style) || null : null;
  // Заготовки показываются только те, что для этого типа: предлагать
  // раскадровку ролика на вкладке картинки — значит звать выбрать негодное.
  const templatesForType = kit ? kit.templates.filter((t) => t.kind === type) : [];
  const chosenTemplate = kit ? kit.templates.find((x) => x.id === templateId) || null : null;

  /**
   * Собрать промпт по заготовке и положить его в поле.
   *
   * Именно в поле, а не «внутрь», мимо глаз: заготовка — это тридцать строк
   * указаний, и отправлять их не глядя нельзя. В поле их видно, можно
   * поправить руками, дописать своё и позвать референсы через @ — всё как с
   * обычным промптом.
   */
  /** Выбрать (или убрать) свою папку и запомнить её в настройках. */
  async function chooseFolder(dir: string) {
    setMediaFolder(dir);
    await window.api.saveSettings({ ...settings, mediaFolder: dir });
    await refreshHistory();
  }

  /** Перенести накопленное: без этого выбор папки решает задачу наполовину. */
  async function moveToFolder() {
    setMoving(true);
    setError(null);
    try {
      const r = await window.api.mediaMoveToFolder(projectId || undefined);
      setError(
        r.moved
          ? `Перенесено файлов: ${r.moved}${r.kept ? `, уже были на месте: ${r.kept}` : ""}.`
          : "Переносить нечего — всё уже в вашей папке."
      );
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMoving(false);
    }
  }

  async function applyTemplate() {
    if (!chosenTemplate) return;
    try {
      const filled = await window.api.mediaFillTemplate(chosenTemplate.id, slots);
      setPrompt(filled.prompt);
      setError(filled.empty.length ? `Не заполнено: ${filled.empty.join(", ")} — эти места остались в тексте в квадратных скобках.` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function entryName(list: MediaKitEntry[], id: string | undefined, label: string) {
    const found = id ? list.find((x) => x.id === id) : null;
    return found ? `${label}: ${found.name}` : "";
  }

  /**
   * Группа приёмов. Свёрнута по умолчанию: шесть стилей, девять ракурсов, девять
   * схем света и двадцать два движения камеры, развёрнутые разом, — это стена, в
   * которой ничего не выбрать.
   */
  function kitGroup(title: string, group: keyof MediaKitChoice, list: MediaKitEntry[]) {
    const open = openGroup === group;
    const current = list.find((x) => x.id === choice[group]);
    return (
      <div className="media-kit-group">
        <button className="media-kit-head" onClick={() => setOpenGroup(open ? "" : group)}>
          <span>{title}</span>
          <span className="hint">{current ? current.name : "не выбрано"}</span>
          <span>{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <div className="media-kit-list">
            {list.map((item) => (
              <button
                key={item.id}
                className={choice[group] === item.id ? "media-kit-item on" : "media-kit-item"}
                onClick={() => pick(group, item.id)}
              >
                <b>
                  {item.name}
                  {item.en ? ` · ${item.en}` : ""}
                </b>
                {item.what && <span className="media-kit-what">{item.what}</span>}
                {item.why && <span className="media-kit-why">{item.why}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
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
          <div className="media-scroll">
          <p className="hint">
            {settings.managed ? (
              <>
                Генерация фото, видео и аудио — теми моделями, что подключены к вашей сборке. Какие
                именно, можно спросить у разработчика:{" "}
                <a href="mailto:hello@dynamicbrands.ru">hello@dynamicbrands.ru</a>. ID нужной модели
                вводится в поле ниже.
              </>
            ) : (
              <>
                Генерация через модели, доступные по вашему ключу Polza.ai (фото, видео, аудио —
                единый API). Точный ID модели скопируйте со страницы{" "}
                <a href="https://polza.ai/models" target="_blank" rel="noreferrer">
                  polza.ai/models
                </a>
                .
              </>
            )}
          </p>

          <div className="media-type-tabs media-mode-tabs">
            <button className={mode === "single" ? "tab active" : "tab"} onClick={() => setMode("single")}>
              Одна генерация
            </button>
            <button className={mode === "script" ? "tab active" : "tab"} onClick={() => setMode("script")}>
              Презентация и подкаст
            </button>
          </div>

          {mode === "script" && (
            <>
              <label>Что делаем</label>
              <div className="media-type-tabs">
                {scriptKinds.map((k) => (
                  <button
                    key={k.id}
                    className={scriptKind === k.id ? "tab active" : "tab"}
                    onClick={() => {
                      setScriptKind(k.id);
                      setScenes([]);
                      setLines([]);
                      setScriptProblems([]);
                    }}
                  >
                    {k.name}
                  </button>
                ))}
              </div>
              <p className="hint">{scriptKinds.find((k) => k.id === scriptKind)?.hint}</p>

              <label>Источник</label>
              <textarea
                value={source}
                onChange={(e) => setSource(e.target.value)}
                rows={6}
                placeholder="Текст, расшифровка встречи, выдержка из документа — то, о чём будет презентация или разговор."
              />

              <div className="media-params">
                <label className="media-param">
                  <span>Примерная длина, мин</span>
                  <input type="number" min={1} max={40} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </label>
                {scriptKind === "podcast" && (
                  <>
                    <label className="media-param">
                      <span>Первый ведущий</span>
                      <input value={nameA} onChange={(e) => setNameA(e.target.value)} />
                    </label>
                    <label className="media-param">
                      <span>Второй ведущий</span>
                      <input value={nameB} onChange={(e) => setNameB(e.target.value)} />
                    </label>
                  </>
                )}
              </div>

              <label>Пожелания (необязательно)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Для кого, чего избегать, на чём сделать упор"
              />

              {/*
                Сценарий пишет модель в обычном чате, а не приложение молча: его
                надо прочитать и поправить ДО того, как потрачены деньги на
                картинки и озвучку.
              */}
              <div className="folder-row">
                <button className="btn btn-secondary" onClick={askForScript} disabled={generating || !source.trim()}>
                  {generating && status ? status : "Написать сценарий"}
                </button>
                <button className="link-btn" onClick={copyScriptPrompt} disabled={!source.trim()}>
                  скопировать задание
                </button>
              </div>
              <p className="hint">
                Сценарий пишет модель, а кадры и голоса заказываются только после того, как вы его
                прочитаете и поправите: так деньги тратятся на то, что уже одобрено. Задание можно и
                скопировать — если сценарий хочется написать в другом чате или с навыком.
              </p>

              <label>Ответ модели — сценарий</label>
              <textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                rows={8}
                placeholder="Вставьте сюда ответ модели целиком"
              />
              <button className="btn btn-secondary" onClick={parseScript} disabled={!scriptText.trim()}>
                Разобрать сценарий
              </button>

              {!!scriptProblems.length && (
                <div className="media-script-problems">
                  {scriptProblems.map((p2) => (
                    <p key={p2}>{p2}</p>
                  ))}
                </div>
              )}

              {!!scenes.length && (
                <>
                  <p className="hint">Сцен разобрано: {scenes.length}. Правьте прямо здесь.</p>
                  <div className="media-script-list">
                    {scenes.map((sc, i) => (
                      <div key={sc.index} className="media-script-row">
                        <input
                          value={sc.title}
                          placeholder="заголовок"
                          onChange={(e) =>
                            setScenes(scenes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                          }
                        />
                        <textarea
                          rows={2}
                          value={sc.voice}
                          placeholder="что говорит голос"
                          onChange={(e) =>
                            setScenes(scenes.map((x, j) => (j === i ? { ...x, voice: e.target.value } : x)))
                          }
                        />
                        <textarea
                          rows={2}
                          value={sc.shot}
                          placeholder="описание кадра для генерации"
                          onChange={(e) =>
                            setScenes(scenes.map((x, j) => (j === i ? { ...x, shot: e.target.value } : x)))
                          }
                        />
                        <button className="link-btn" onClick={() => setScenes(scenes.filter((_, j) => j !== i))}>
                          убрать сцену
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {!!lines.length && (
                <>
                  <p className="hint">
                    Реплик разобрано: {lines.length} — {lines.filter((l) => l.speaker === "a").length} у первого,{" "}
                    {lines.filter((l) => l.speaker === "b").length} у второго.
                  </p>
                  <div className="media-script-list">
                    {lines.map((ln, i) => (
                      <div key={ln.index} className="media-script-row media-script-line">
                        <button
                          className="media-speaker"
                          title="Поменять, кто говорит"
                          onClick={() =>
                            setLines(
                              lines.map((x, j) => (j === i ? { ...x, speaker: x.speaker === "a" ? "b" : "a" } : x))
                            )
                          }
                        >
                          {ln.speaker === "a" ? nameA : nameB}
                        </button>
                        <textarea
                          rows={2}
                          value={ln.text}
                          onChange={(e) =>
                            setLines(lines.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                          }
                        />
                        <button className="link-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                          убрать
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <label>Модель озвучки</label>
              <input
                value={voiceModel}
                onChange={(e) => setVoiceModel(e.target.value)}
                placeholder="ID модели синтеза речи"
              />
              <div className="media-params">
                <label className="media-param">
                  <span>{scriptKind === "podcast" ? "Голос первого" : "Голос диктора"}</span>
                  <input value={voiceA} onChange={(e) => setVoiceA(e.target.value)} />
                </label>
                {scriptKind === "podcast" && (
                  <label className="media-param">
                    <span>Голос второго</span>
                    <input value={voiceB} onChange={(e) => setVoiceB(e.target.value)} />
                  </label>
                )}
              </div>
              {scriptKind === "podcast" && voiceA && voiceB && voiceA === voiceB && (
                <p className="hint">
                  Голоса совпадают — диалог будет не слышен. Сборка такой подкаст не примет.
                </p>
              )}
              {scriptKind === "presentation" && (
                <p className="hint">Кадры рисует модель из поля «ID модели» выше, с выбранными приёмами.</p>
              )}

              {scriptProgress && (
                <p className="hint">
                  {scriptProgress.stage === "image" &&
                    `Кадр ${scriptProgress.index} из ${scriptProgress.total}: ${scriptProgress.title || ""}`}
                  {scriptProgress.stage === "voice" &&
                    `Озвучиваю ${scriptProgress.index} из ${scriptProgress.total}`}
                  {scriptProgress.stage === "assemble" && "Собираю файл…"}
                  {scriptProgress.stage === "failed" && `Не вышло: ${scriptProgress.error || ""}`}
                </p>
              )}
              {built && <div className="media-result-card">Готово: {built}</div>}
            </>
          )}

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

          {!!templatesForType.length && (
            <div className="media-forms">
              <label>Заготовка промпта (необязательно)</label>
              <p className="hint">
                Целый сценарий, а не строка стиля: что неприкосновенно, что происходит по секундам,
                что запрещено. Заполните места и нажмите «Собрать» — текст ляжет в поле промпта,
                где его можно поправить.
              </p>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setSlots({});
                }}
              >
                <option value="">Без заготовки</option>
                {templatesForType.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {chosenTemplate && (
                <>
                  <p className="hint">{chosenTemplate.why}</p>
                  {chosenTemplate.needsPhoto && !references.length && !referenceImagePath && (
                    <p className="hint">
                      Эта заготовка рассчитана на вашу картинку — приложите её референсом, иначе
                      модель будет придумывать сцену с нуля.
                    </p>
                  )}
                  {chosenTemplate.slots.map((slot) => (
                    <div key={slot.key} className="media-form-slot">
                      <label>
                        {slot.name}
                        {slot.block && <span className="hint"> — можно не заполнять</span>}
                      </label>
                      <textarea
                        rows={2}
                        value={slots[slot.key] || ""}
                        placeholder={slot.sample}
                        onChange={(e) => setSlots({ ...slots, [slot.key]: e.target.value })}
                      />
                      <span className="media-param-hint">{slot.hint}</span>
                    </div>
                  ))}
                  <button className="btn btn-secondary" onClick={applyTemplate}>
                    Собрать промпт
                  </button>
                </>
              )}
            </div>
          )}

          <label>Промпт</label>
          <MentionBox
            value={prompt}
            onChange={setPrompt}
            placeholder={TYPE_PLACEHOLDERS[type].prompt}
            rows={5}
            mentions={references.map((r) => ({
              id: r.id,
              insert: r.name,
              title: r.kind === "image" ? "картинка" : "текст",
              hint: r.kind === "text" ? r.text.slice(0, 60) : r.file,
            }))}
            commands={(kit?.commands || []).map((c): MentionItem => ({
              id: c.id,
              insert: c.id,
              title: c.why,
              hint: c.group,
            }))}
            emptyMentionHint="Референсов пока нет — добавьте их кнопкой ниже, и они появятся здесь."
          />
          <p className="hint">
            <b>@</b> — список референсов: выберите нужный и объясните, что с ним сделать.{" "}
            <b>/</b> — короткие команды формата.
          </p>
          {resolved && (
            <>
              {!!resolved.missing.length && (
                <p className="media-script-problems">
                  Таких референсов нет: {resolved.missing.map((m) => "@" + m).join(", ")}. Проверьте
                  имя — иначе модель получит его как обычный текст.
                </p>
              )}
              {!!resolved.unknownCommands.length && (
                <p className="hint">
                  Не команда: {resolved.unknownCommands.map((c) => "/" + c).join(", ")} — уйдёт как
                  обычный текст.
                </p>
              )}
              {!!resolved.note && <p className="hint">{resolved.note}</p>}
            </>
          )}

          <label>Референсы</label>
          <p className="hint">
            Сколько угодно картинок и текстов, у каждого своё имя. Референсом может быть и текст —
            например то, что должно быть написано в макете: он уедет в промпт дословно.
          </p>
          <div className="folder-row">
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const added = await window.api.mediaAddReferences("image", references.map((r) => r.name));
                if (added.length) setReferences([...references, ...added]);
              }}
            >
              + картинки
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const added = await window.api.mediaAddReferences("text", references.map((r) => r.name));
                if (added.length) setReferences([...references, ...added]);
              }}
            >
              + текстовый файл
            </button>
            <button
              className="link-btn"
              onClick={() => {
                // Текст, набранный руками, — самый частый случай: «вот что
                // должно быть написано». Заводить ради него файл незачем.
                const имена = references.map((r) => r.name);
                let имя = "текст";
                let n = 2;
                while (имена.includes(имя)) имя = `текст_${n++}`;
                setReferences([
                  ...references,
                  { id: `${Date.now()}`, kind: "text", name: имя, path: "", file: "", text: "" },
                ]);
              }}
            >
              написать текст
            </button>
          </div>
          {!!references.length && (
            <div className="media-refs">
              {references.map((r, i) => (
                <div key={r.id} className="media-ref">
                  <div className="media-ref-head">
                    <span className="media-ref-kind">{r.kind === "image" ? "🖼" : "📝"}</span>
                    <input
                      className="media-ref-name"
                      value={r.name}
                      title="Имя, которым референс зовут через @"
                      onChange={(e) =>
                        setReferences(
                          references.map((x, j) =>
                            j === i ? { ...x, name: e.target.value.replace(/\s+/g, "_") } : x
                          )
                        )
                      }
                    />
                    <span className="hint">{r.file || (r.kind === "text" ? "свой текст" : "")}</span>
                    <button
                      className="link-btn"
                      onClick={() => setReferences(references.filter((_, j) => j !== i))}
                    >
                      убрать
                    </button>
                  </div>
                  {r.kind === "text" && (
                    <textarea
                      rows={2}
                      value={r.text}
                      placeholder="что должно быть написано в макете"
                      onChange={(e) =>
                        setReferences(references.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {type !== "audio" && (
            <>
              <label>Один референс по-старому (необязательно)</label>
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

          {kit && type !== "audio" && (
            <>
              <label>Приёмы</label>
              <p className="hint">
                Промпт собирается из выбранного: сначала что в кадре, потом стиль, ракурс, свет и
                движение камеры. Ничего не выбрано — уходит только ваш текст.
              </p>
              {kitGroup("Стиль", "style", kit.styles)}
              {type === "image" && kitGroup("Ракурс", "angle", kit.shotAngles)}
              {kitGroup("Свет", "lighting", kit.lighting)}
              {type === "video" && (
                <>
                  {kitGroup("Камера", "camera", kit.cameraMoves)}
                  {/*
                    Темп — не украшение к списку движений. Одна и та же
                    траектория плавно и рывком передаёт разные чувства, и без
                    него половина списка теряет смысл.
                  */}
                  {choice.camera && kitGroup("Темп", "pace", kit.paces)}
                </>
              )}
              {(choice.style || choice.camera || choice.angle || choice.lighting) && (
                <div className="media-chosen">
                  {[
                    entryName(kit.styles, choice.style, "стиль"),
                    entryName(kit.shotAngles, choice.angle, "ракурс"),
                    entryName(kit.lighting, choice.lighting, "свет"),
                    entryName(kit.cameraMoves, choice.camera, "камера"),
                    entryName(kit.paces, choice.pace, "темп"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  <button className="link-btn" onClick={() => setChoice({})}>
                    сбросить
                  </button>
                </div>
              )}
              {chosenStyle?.needsPhoto && !referenceImagePath && (
                <p className="hint">
                  Этот стиль рассчитан на обработку вашей фотографии — приложите её референсом ниже,
                  иначе модель нарисует предмет с нуля.
                </p>
              )}
              {chosenStyle && (
                <>
                  <label>Что в кадре (для стиля)</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="кроссовки, дом, портрет девушки"
                  />
                  <p className="hint">
                    Подставляется в строку стиля. Пусто — возьмётся начало промпта.
                  </p>
                </>
              )}
            </>
          )}

          {kit && !!(kit.fields[type] || []).length && (
            <>
              <label>Параметры модели</label>
              <div className="media-params">
                {(kit.fields[type] || []).map((f) => (
                  <label key={f.key} className="media-param">
                    <span>{f.name}</span>
                    {f.kind === "choice" ? (
                      <select
                        value={params[f.key] || ""}
                        onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}
                      >
                        <option value="">как у модели</option>
                        {(f.options || []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.kind === "flag" ? (
                      <input
                        type="checkbox"
                        checked={params[f.key] === "true"}
                        onChange={(e) => setParams({ ...params, [f.key]: e.target.checked ? "true" : "" })}
                      />
                    ) : (
                      <input
                        type={f.kind === "number" ? "number" : "text"}
                        value={params[f.key] || ""}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        onChange={(e) => setParams({ ...params, [f.key]: e.target.value })}
                      />
                    )}
                    {/*
                      Пояснение видно всегда, а не только во всплывающей
                      подсказке: настройка, назначение которой надо угадывать,
                      с тем же успехом могла бы не существовать.
                    */}
                    {f.hint && <span className="media-param-hint">{f.hint}</span>}
                  </label>
                ))}
              </div>
              {/*
                Честная оговорка вместо обещания «все команды всех моделей»: у
                каждой модели свой набор полей, единого справочника у шлюза нет.
                Здесь то, что принимают почти все, а остальное — ниже, в JSON.
              */}
              <p className="hint">
                Здесь поля, которые принимают почти все модели. Незаполненное не отправляется — модель
                берёт своё умолчание. Всё, что есть только у одной модели, пишется JSON-ом ниже и
                кладётся поверх этих полей.
              </p>
            </>
          )}

          <label>Дизайн-система</label>
          <div className="folder-row">
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const dir = await window.api.sitesPickFolder("Папка с дизайн-системой");
                if (!dir) return;
                try {
                  setDesign(await window.api.readMediaDesign(dir));
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Выбрать папку
            </button>
            {design && (
              <button className="link-btn" onClick={() => setDesign(null)}>
                Убрать
              </button>
            )}
          </div>
          {design && (
            <p className="hint">
              {design.problem
                ? design.problem
                : `${design.dir} — цветов: ${design.colours.length}, шрифтов: ${design.fonts.length}, ` +
                  `переменных: ${design.vars.length}. Уходит в промпт запретом придумывать другие.`}
            </p>
          )}

          <label>Папка для готовых файлов</label>
          <p className="hint">
            Картинки и особенно ролики весят много и копятся быстро. Пока они лежат внутри
            приложения, они раздувают именно его. Назовите свою папку — и файлы будут
            складываться туда, а приложение останется лёгким.
          </p>
          <div className="folder-row">
            {mediaFolder ? (
              <span className="hint">{mediaFolder}</span>
            ) : (
              <span className="hint">Сейчас: внутри папки данных приложения</span>
            )}
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const dir = await window.api.sitesPickFolder("Папка для готовых файлов");
                if (dir) await chooseFolder(dir);
              }}
            >
              Выбрать папку
            </button>
            {mediaFolder && (
              <>
                <button className="btn btn-secondary" disabled={moving} onClick={moveToFolder}>
                  {moving ? "Переношу…" : "Перенести накопленное"}
                </button>
                <button className="link-btn" onClick={() => chooseFolder("")}>
                  Вернуть внутрь
                </button>
              </>
            )}
          </div>

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
          </div>

          {/*
            Действие прилипает к низу столбца. Раньше кнопка стояла в конце
            длинной ленты настроек, и до неё надо было домотать — «даже кнопку
            сгенерировать не видно».
          */}
          <div className="media-actions">
          {mode === "script" ? (
            <button
              className="btn btn-primary"
              onClick={buildScript}
              disabled={
                generating ||
                !voiceModel.trim() ||
                (scriptKind === "podcast" ? !lines.length : !scenes.length || !model.trim())
              }
            >
              {generating ? "Собираю…" : scriptKind === "podcast" ? "Собрать подкаст" : "Собрать презентацию"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={generate} disabled={generating || !model.trim() || !prompt.trim()}>
              {generating ? status || "Генерация…" : "Сгенерировать"}
            </button>
          )}

          </div>

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
          {/*
            Незабранные заказы. Деньги за генерацию снимаются в момент
            создания заказа, а не в момент, когда картинка доехала до окна.
            Поэтому заказ записывается на диск сразу и живёт тут, пока его не
            заберут: ожидание у экрана и судьба оплаченного — разные вещи.
          */}
          {!!pending.length && (
            <div className="media-pending">
              <h3>Незабранные</h3>
              <p className="hint">
                Заказ оплачен, но результат ещё не скачан — обычно потому, что модель считала
                дольше, чем приложение ждало у экрана. Ничего не пропало: приложение проверяет
                эти заказы само, раз в несколько минут, и забирает готовое. Кнопка — чтобы не
                ждать очередной проверки.
              </p>
              {pending.map((p2) => (
                <div key={p2.id} className="media-pending-item">
                  <span className="media-pending-prompt" title={p2.prompt}>
                    {p2.prompt.slice(0, 70) || p2.model}
                  </span>
                  <span className="hint">
                    {p2.model} · {new Date(p2.createdAt).toLocaleString("ru-RU")}
                  </span>
                  <div className="folder-row">
                    <button
                      className="btn btn-primary"
                      disabled={collecting === p2.id}
                      onClick={() => collect(p2.id)}
                    >
                      {collecting === p2.id ? "Забираю…" : "Забрать"}
                    </button>
                    <button
                      className="link-btn"
                      onClick={async () => {
                        await window.api.forgetPendingMedia(p2.id);
                        await refreshHistory();
                      }}
                    >
                      забыть
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="media-pending">
            <h3>Забрать по номеру заказа</h3>
            <p className="hint">
              Если заказ сделан в прошлой версии приложения, в личном кабинете Polza или в другой
              программе, приложение о нём не знает — но оплачен он всё равно. Номер заказа виден в
              личном кабинете; по нему результат забирается так же.
            </p>
            <div className="folder-row">
              <input
                value={orderId}
                placeholder="номер заказа"
                onChange={(e) => setOrderId(e.target.value.trim())}
              />
              <button
                className="btn btn-secondary"
                disabled={!orderId || collecting === orderId}
                onClick={() => collect(orderId)}
              >
                {collecting === orderId ? "Забираю…" : "Забрать"}
              </button>
            </div>
          </div>

          <h3>История</h3>
          {history.length === 0 && <p className="hint">Пока ничего не сгенерировано.</p>}
          <ul className="media-history-list">
            {history.map((item) => (
              <li key={item.id} onClick={() => openHistoryItem(item)}>
                <span className="media-history-type">{item.type}</span>
                <span className="media-history-prompt">
                  {item.prompt.slice(0, 60) || item.fileName}
                </span>
                {item.orphan && (
                  <span className="hint" title="Файл лежит в папке, но описи к нему нет">
                    без описи
                  </span>
                )}
                {item.recipe && <span className="media-history-recipe">{item.recipe}</span>}
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
