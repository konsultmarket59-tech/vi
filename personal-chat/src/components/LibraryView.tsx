import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Conversation,
  LibraryConfig,
  LibraryEngineStatus,
  LibraryFile,
  LibraryHit,
  LibraryProgress,
  LibraryReading,
  Settings,
  Skill,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";
import Splitter from "./Splitter";

/**
 * Видеотека: разговор с содержимым своих записей.
 *
 * Главное свойство раздела — ответ не может быть придуман незаметно. Модель
 * видит только найденные куски расшифровок, каждое утверждение обязано нести
 * ссылку на файл и минуту, а после ответа приложение сверяет ссылки с самими
 * расшифровками. Поэтому список источников показан рядом с ответом: проверить
 * должно быть проще, чем поверить.
 */

function formatBytes(bytes: number): string {
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + " ГБ";
  if (bytes > 1e6) return Math.round(bytes / 1e6) + " МБ";
  return Math.round(bytes / 1e3) + " КБ";
}

function formatMinutes(seconds: number): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

function stamp(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

export default function LibraryView({ settings, skills, onOpenSettings }: Props) {
  const [config, setConfig] = useState<LibraryConfig | null>(null);
  const [engine, setEngine] = useState<LibraryEngineStatus | null>(null);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [orphans, setOrphans] = useState<{ path: string; name: string }[]>([]);
  const [missing, setMissing] = useState(false);
  // Опись обхода: сколько файлов просмотрено и что пропущено. Без неё пустой
  // список неотличим от сломанного обхода.
  const [survey, setSurvey] = useState<{
    seen: number;
    folders: number;
    other: { ext: string; count: number }[];
    missingSources: string[];
    unreadable: { dir: string; error: string }[];
    vault: string;
  }>({ seen: 0, folders: 0, other: [], missingSources: [], unreadable: [], vault: "" });
  const [reading, setReading] = useState<LibraryReading | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LibraryProgress | null>(null);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [hits, setHits] = useState<LibraryHit[]>([]);
  const [narrowed, setNarrowed] = useState<{ narrowed: boolean; titles: string[] } | null>(null);
  const [checked, setChecked] = useState<{ problems: string[]; unsupported: number } | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number; autoSend?: boolean }>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    const scan = await window.api.libraryScan();
    setFiles(scan.files);
    setOrphans(scan.orphans || []);
    setMissing(scan.missing);
    setSurvey({
      seen: scan.seen || 0,
      folders: scan.folders || 0,
      other: scan.other || [],
      missingSources: scan.missingSources || [],
      unreadable: scan.unreadable || [],
      vault: scan.vault || "",
    });
  }, []);

  useEffect(() => {
    window.api.libraryConfig().then(setConfig);
    window.api.libraryEngineStatus().then(setEngine);
    void refresh();
    return window.api.onLibraryProgress((p) => {
      setProgress(p);
      if (p.stage === "done") {
        setBusy(false);
        void refresh();
      }
    });
  }, [refresh]);

  const pending = useMemo(() => files.filter((f) => !f.transcribed), [files]);
  const ready = useMemo(() => files.filter((f) => f.transcribed), [files]);
  const unmarked = useMemo(() => files.filter((f) => f.transcribed && !f.polished), [files]);
  const readySeconds = useMemo(() => ready.reduce((s, f) => s + f.seconds, 0), [ready]);

  async function patchConfig(changes: Partial<LibraryConfig>) {
    const next = await window.api.librarySaveConfig(changes);
    setConfig(next);
    setEngine(await window.api.libraryEngineStatus());
    if (changes.folderPath !== undefined) void refresh();
  }

  async function transcribe(paths: string[], options?: { force?: boolean }) {
    if (!paths.length) return;
    setError("");
    setBusy(true);
    setProgress({ stage: "file", index: 0, total: paths.length });
    try {
      const result = await window.api.libraryTranscribe(paths, options);
      if (result.failed.length) {
        // Причина важнее списка имён: «не найдена программа расшифровки» и
        // «файл повреждён» требуют разных действий, а раньше было видно только
        // то, что что-то не вышло.
        const причины = [...new Set(result.failed.map((f) => f.error))];
        setError(
          `Не удалось расшифровать ${result.failed.length} из ${paths.length}: ${причины.join("; ")}`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
    await refresh();
  }

  /** Разбор второй моделью для того, что уже расшифровано. */
  async function polish(paths: string[]) {
    if (!paths.length) return;
    setError("");
    setBusy(true);
    setProgress({ stage: "polish", index: 0, total: paths.length });
    try {
      const result = await window.api.libraryPolish(paths);
      if (result.failed.length) {
        setError(`Не удалось разобрать: ${result.failed.map((f) => f.error).join("; ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
    await refresh();
  }

  /** Вопрос уходит агенту вместе с найденными кусками — и ни с чем больше. */
  async function ask(text: string) {
    if (!text.trim()) return;
    setError("");
    setChecked(null);
    try {
      const prepared = await window.api.libraryAsk(text);
      setHits(prepared.hits);
      setNarrowed({
        narrowed: !!prepared.narrowed,
        titles: (prepared.marks || []).map((m) => m.title),
      });
      if (!conv) {
        setConv({
          id: uid(),
          projectId: "library",
          title: "Вопрос к записям",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      setNonce((n) => n + 1);
      setPrefill({ text: prepared.prompt, nonce: nonce + 1, autoSend: true });
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function retell(filePath: string) {
    setError("");
    setChecked(null);
    try {
      const prepared = await window.api.libraryRetell(filePath);
      setHits(prepared.hits);
      setNarrowed(null);
      if (!conv) {
        setConv({
          id: uid(),
          projectId: "library",
          title: "Пересказ записи",
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      setNonce((n) => n + 1);
      setPrefill({ text: prepared.prompt, nonce: nonce + 1, autoSend: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Ответ проверяется сразу, как пришёл: несуществующая ссылка или утверждение
  // без источника должны быть видны рядом с ответом, а не остаться на совести
  // читателя.
  const onAssistantMessage = useCallback(
    async (text: string) => {
      if (!hits.length) return;
      setChecked(await window.api.libraryVerify(text, hits));
    },
    [hits]
  );

  if (!settings.apiKey) {
    return (
      <div className="ops-view">
        <div className="empty-state">
          <p>Для разговора с записями нужен ключ доступа к модели.</p>
          <button className="btn btn-primary" onClick={onOpenSettings}>
            Открыть настройки
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="vs-body">
          <div className="vs-form">
            <p className="vs-lead">
              Укажите папку с записями — приложение прочитает их на месте, расшифрует и даст
              разговаривать с содержимым. <b>Файлы никуда не копируются</b>: в приложении остаётся
              только текст расшифровки со ссылками на минуты.
            </p>

            <section className="vs-block">
              <h3>Откуда брать записи</h3>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const next = await window.api.libraryAddSources("folder");
                    if (next) {
                      setConfig(next);
                      await refresh();
                    }
                  }}
                >
                  Добавить папку
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const next = await window.api.libraryAddSources("file");
                    if (next) {
                      setConfig(next);
                      await refresh();
                    }
                  }}
                >
                  Добавить запись
                </button>
              </div>
              {config?.sources?.length ? (
                <ul className="lib-sources">
                  {config.sources.map((src) => (
                    <li key={src}>
                      <span className="vs-path" title={src}>
                        {src}
                      </span>
                      <button
                        className="link-btn"
                        onClick={async () => {
                          const next = await window.api.libraryRemoveSource(src);
                          setConfig(next);
                          await refresh();
                        }}
                      >
                        Убрать
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="vs-hint">Источников пока нет. Можно указать и папку целиком, и одну запись.</p>
              )}

              {/*
                Опись обхода. Раньше при пустом списке приложение молчало, и было
                не понять, то ли записей нет, то ли их не разглядели. Теперь
                видно, сколько файлов просмотрено и какие расширения пропущены.
              */}
              {!!config?.sources?.length && (
                <p className="vs-hint">
                  Просмотрено файлов: {survey.seen}
                  {survey.folders ? ` в ${survey.folders} папках` : ""}. Записей найдено:{" "}
                  {files.length}. Расшифровано: {ready.length}
                  {readySeconds ? ` (${formatMinutes(readySeconds)} речи)` : ""}. Ждут очереди:{" "}
                  {pending.length}.
                </p>
              )}
              {!files.length && !!survey.seen && (
                <p className="vs-warn">
                  Видео и аудио среди этих файлов нет.{" "}
                  {survey.other.length
                    ? "Что попалось: " +
                      survey.other.map((o) => `${o.ext} — ${o.count}`).join(", ") +
                      "."
                    : ""}{" "}
                  Если запись в этом списке всё-таки есть, напишите — расширение добавим.
                </p>
              )}
              {!!files.length && !!survey.other.length && (
                <p className="vs-hint">
                  Пропущено не-медиа: {survey.other.map((o) => `${o.ext} — ${o.count}`).join(", ")}.
                </p>
              )}
              {!!survey.missingSources.length && (
                <p className="vs-warn">
                  Недоступно: {survey.missingSources.join(", ")} — диск отключён, файл унесён или
                  выбран файл не того вида.
                </p>
              )}
              {!!survey.unreadable.length && (
                <p className="vs-warn">
                  Не удалось заглянуть в {survey.unreadable.length} папок — нет прав доступа.
                </p>
              )}
              {missing && <p className="vs-warn">Источники недоступны — возможно, диск отключён.</p>}
              {!!orphans.length && (
                <p className="vs-warn">
                  Расшифровок без записи: {orphans.length} — файлы унесены или источник убран. По
                  ссылкам из них идти будет некуда.
                </p>
              )}
            </section>

            <section className="vs-block">
              <h3>Куда сохранять расшифровки</h3>
              <p className="vs-hint">
                Расшифровка часа записи — это час работы, и лежать она должна там, куда вы можете
                заглянуть: унести на другой компьютер, положить в общую папку. Если папку не
                указать, расшифровки останутся в данных приложения.
              </p>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const next = await window.api.libraryPickVault();
                    if (next) {
                      setConfig(next);
                      await refresh();
                    }
                  }}
                >
                  Выбрать папку
                </button>
                <span className="vs-path" title={survey.vault}>
                  {survey.vault || "в данных приложения"}
                </span>
                {!!survey.vault && (
                  <button className="link-btn" onClick={() => window.api.libraryOpenVault()}>
                    Открыть
                  </button>
                )}
              </div>
              <p className="vs-hint">
                Уже расшифрованную запись приложение узнаёт по содержимому, а не по имени файла:
                переименуйте её или перенесите в другую папку — читать заново не станет.
              </p>
            </section>

            <section className="vs-block">
              <h3>Чем расшифровывать</h3>
              <div className="vs-tabs">
                <button
                  className={config?.engine !== "local" && config?.engine !== "remote" ? "vs-tab on" : "vs-tab"}
                  onClick={() => patchConfig({ engine: "builtin" })}
                >
                  Встроенное
                </button>
                <button
                  className={config?.engine === "remote" ? "vs-tab on" : "vs-tab"}
                  onClick={() => patchConfig({ engine: "remote" })}
                >
                  Через платный сервис
                </button>
                <button
                  className={config?.engine === "local" ? "vs-tab on" : "vs-tab"}
                  onClick={() => patchConfig({ engine: "local" })}
                >
                  Свой whisper.cpp
                </button>
              </div>

              {config?.engine === "remote" ? (
                <p className="vs-hint">
                  Быстро — час записи за минуты, — но <b>запись уходит на чужой сервер</b>. Если на
                  записях клиентские дела, это решение принимаете вы. Используется ключ и адрес из
                  общих настроек приложения.
                </p>
              ) : config?.engine === "local" ? (
                <>
                  <p className="vs-hint">
                    Для тех, у кого whisper.cpp уже стоит: он быстрее встроенного и слышит лучше.
                    Если его нет — ставить не нужно, вернитесь на «Встроенное».
                  </p>
                  <div className="vs-row">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        const file = await window.api.libraryPickFile("Программа whisper-cli");
                        if (file) await patchConfig({ binPath: file });
                      }}
                    >
                      Программа
                    </button>
                    <span className="vs-path">{config?.binPath || "не указана"}</span>
                  </div>
                  <div className="vs-row">
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => {
                        const file = await window.api.libraryPickFile("Файл модели");
                        if (file) await patchConfig({ modelPath: file });
                      }}
                    >
                      Модель
                    </button>
                    <span className="vs-path">{config?.modelPath || "не указана"}</span>
                  </div>
                  {engine && !engine.ready && <p className="vs-warn">{engine.reason}</p>}
                  {engine?.ready && <p className="vs-hint">Готово к работе.</p>}
                </>
              ) : (
                <>
                  {/*
                    Встроенный путь. Прежний вариант требовал поставить
                    whisper.cpp и скачать модель руками — для человека, которому
                    надо расшифровать запись, это не «бесплатно», а «невозможно».
                  */}
                  <p className="vs-hint">
                    Бесплатно, ставить нечего, материал не покидает компьютер. Один раз скачиваются
                    веса модели — дальше расшифровка идёт без сети совсем. Расплата — время:
                    примерно час работы на час записи.
                  </p>

                  {engine?.builtinReady ? (
                    <p className="vs-hint">
                      Готово к работе. Модель занимает {formatBytes(engine.cacheBytes)}.{" "}
                      <button
                        className="link-btn"
                        onClick={async () => {
                          await window.api.libraryRemoveSpeechModel();
                          setEngine(await window.api.libraryEngineStatus());
                        }}
                      >
                        удалить
                      </button>
                    </p>
                  ) : (
                    <p className="vs-warn">
                      Веса модели ещё не скачаны — без них расшифровывать нечем. Это одно нажатие.
                    </p>
                  )}

                  <div className="lib-models">
                    {(engine?.models || []).map((m) => (
                      <button
                        key={m.id}
                        className={
                          (config?.speechModel || engine?.models?.[1]?.id) === m.id
                            ? "lib-model on"
                            : "lib-model"
                        }
                        onClick={() => patchConfig({ speechModel: m.id })}
                      >
                        <b>
                          {m.name} <span className="vs-hint">{m.size}</span>
                        </b>
                        <span className="vs-hint">{m.hint}</span>
                      </button>
                    ))}
                  </div>

                  <button
                    className="btn btn-primary btn-small"
                    disabled={busy}
                    onClick={async () => {
                      setError("");
                      setBusy(true);
                      setProgress({ stage: "model", progress: 0 });
                      try {
                        await window.api.libraryDownloadSpeechModel(config?.speechModel || undefined);
                        setEngine(await window.api.libraryEngineStatus());
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                        setProgress(null);
                      }
                    }}
                  >
                    {engine?.builtinReady ? "Скачать заново" : "Скачать модель"}
                  </button>

                  {/*
                    Оговорка про качество нужна здесь, а не в оправданиях потом:
                    модель такого размера слышит хуже платного сервиса, и это
                    ровно тот случай, ради которого ниже стоит второй шаг с
                    сильной моделью.
                  */}
                  <p className="vs-hint">
                    Встроенная модель слышит хуже платного сервиса: путает имена, названия и числа.
                    Поэтому ниже включён разбор второй моделью — она читает расшифровку и правит
                    расслышанное. Дёшево услышать и умно прочитать вместе выходит лучше, чем каждое
                    по отдельности.
                  </p>
                </>
              )}
            </section>

            <section className="vs-block">
              <h3>Кто разбирает расшифровку</h3>
              <p className="vs-hint">
                Расшифровщик слышит звук и больше ничего: он не знает, что «Фейбл» — это название,
                не ставит запятых по смыслу и не видит, где кончилась одна тема и началась другая.
                Это умеет обычная модель — и это вторая, отдельная работа. Она правит расслышанное,
                приводит текст в читаемый вид и расставляет метки: с какой минуты по какую о чём
                речь. Дальше вопрос ищет сначала по меткам и читает только нужную тему, а не все
                двадцать часов.
              </p>
              <label className="vs-check">
                <input
                  type="checkbox"
                  checked={config?.polish !== false}
                  onChange={(e) => patchConfig({ polish: e.target.checked })}
                />
                Разбирать сразу после расшифровки
              </label>
              <div className="vs-row">
                <span className="vs-label">Модель разбора</span>
                <input
                  type="text"
                  value={config?.polishModel || ""}
                  placeholder={settings.model || "как в общих настройках"}
                  onChange={(e) => setConfig(config ? { ...config, polishModel: e.target.value } : config)}
                  onBlur={(e) => patchConfig({ polishModel: e.target.value.trim() })}
                />
              </div>
              <p className="vs-hint">
                Сырая расшифровка при этом не выбрасывается: ссылки в ответах проверяются по ней —
                отвечать надо за то, что вы услышите, открыв запись на этой минуте.
              </p>
              {!!unmarked.length && (
                <button
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() => polish(unmarked.map((f) => f.path))}
                >
                  Разобрать без меток ({unmarked.length})
                </button>
              )}
            </section>

            <section className="vs-block">
              <h3>Записи</h3>
              <div className="vs-row">
                <button
                  className="btn btn-primary btn-small"
                  disabled={busy || !pending.length}
                  onClick={() => transcribe(pending.map((f) => f.path))}
                >
                  Расшифровать всё ({pending.length})
                </button>
                {busy && (
                  <button className="btn btn-secondary btn-small" onClick={() => window.api.libraryStop()}>
                    Остановить
                  </button>
                )}
              </div>
              {busy && progress && (
                <p className="vs-hint">
                  {progress.stage === "audio" && `Читаю звук: ${progress.name}`}
                  {progress.stage === "transcribe" &&
                    `Расшифровываю ${progress.name}${
                      progress.progress ? ` — ${Math.round(progress.progress * 100)}%` : ""
                    }`}
                  {progress.stage === "file" && `Запись ${(progress.index || 0) + 1} из ${progress.total}`}
                  {progress.stage === "model" &&
                    `Скачиваю модель распознавания${
                      progress.progress ? ` — ${Math.round(progress.progress * 100)}%` : "…"
                    }`}
                  {progress.stage === "reused" && `Уже расшифровано, читаю готовое: ${progress.name}`}
                  {progress.stage === "polish" &&
                    `Разбираю расшифровку ${progress.name}${
                      progress.progress ? ` — ${Math.round(progress.progress * 100)}%` : ""
                    }`}
                  {progress.stage === "polishFailed" && `Разбор не вышел: ${progress.name}`}
                  {progress.stage === "failed" && `Не вышло: ${progress.name}`}
                </p>
              )}
              {error && <p className="vs-warn">{error}</p>}
              <div className="lib-files">
                {files.map((f) => (
                  <div key={f.path} className="lib-file">
                    <span className="lib-file-name" title={f.path}>
                      {f.kind === "видео" ? "🎬" : "🎵"} {f.name}
                    </span>
                    <span className="lib-file-meta">
                      {f.folder !== "." ? f.folder + " · " : ""}
                      {formatBytes(f.bytes)}
                      {f.seconds ? " · " + formatMinutes(f.seconds) : ""}
                    </span>
                    {f.transcribed ? (
                      <>
                        <span className="lib-badge">
                          {f.polished ? `меток: ${f.marks || 0}` : "расшифровано"}
                        </span>
                        {f.moved && (
                          <span className="lib-badge lib-badge-moved" title="Запись узнана по содержимому">
                            узнана по содержимому
                          </span>
                        )}
                        <button
                          className="link-btn"
                          onClick={async () => {
                            try {
                              setReading(await window.api.libraryRead(f.path));
                            } catch (e) {
                              setError(e instanceof Error ? e.message : String(e));
                            }
                          }}
                        >
                          Читать
                        </button>
                        {!f.polished && (
                          <button className="link-btn" disabled={busy} onClick={() => polish([f.path])}>
                            Разобрать
                          </button>
                        )}
                        <button className="link-btn" onClick={() => retell(f.path)}>
                          Пересказать
                        </button>
                        <button
                          className="link-btn"
                          disabled={busy}
                          onClick={() => transcribe([f.path], { force: true })}
                        >
                          Заново
                        </button>
                        <button
                          className="link-btn"
                          onClick={async () => {
                            await window.api.libraryForget(f.path);
                            await refresh();
                          }}
                        >
                          Забыть
                        </button>
                      </>
                    ) : (
                      <button className="link-btn" disabled={busy} onClick={() => transcribe([f.path])}>
                        Расшифровать
                      </button>
                    )}
                  </div>
                ))}
                {!files.length && <p className="vs-hint">Записей нет — добавьте папку или отдельную запись.</p>}
              </div>
            </section>
          </div>

          <Splitter
            id="видеотека-агент"
            variable="--vs-right-width"
            fallback={340}
            min={240}
            max={760}
            side="right"
            label="Граница окна агента"
          />
          <div className="vs-right vs-right-agent">
            <section className="vs-block">
              <h3>Спросить у записей</h3>
              <textarea
                rows={3}
                value={question}
                placeholder="Например: где я говорила про бюджеты на клипы? Есть ли подтверждение, что мы решили не запускать кампанию?"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask(question);
                  }
                }}
              />
              <button
                className="btn btn-primary btn-block"
                disabled={!question.trim() || !ready.length}
                onClick={() => ask(question)}
              >
                Найти в записях и ответить
              </button>
              {!ready.length && <p className="vs-hint">Сначала расшифруйте хотя бы одну запись.</p>}
            </section>

            {checked && (checked.problems.length > 0 || checked.unsupported > 0) && (
              <div className="lib-check">
                <strong>Ответ стоит перепроверить</strong>
                {checked.problems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                {checked.unsupported > 0 && (
                  <p>
                    Утверждений без ссылки на запись: {checked.unsupported}. Всё, что не подкреплено
                    ссылкой, могло быть додумано.
                  </p>
                )}
              </div>
            )}

            {narrowed?.narrowed && !!narrowed.titles.length && (
              <p className="vs-hint">
                Искали не по всем записям, а по найденным темам: {narrowed.titles.join("; ")}.
              </p>
            )}

            {!!hits.length && (
              <section className="vs-block">
                <h3>Источники ответа</h3>
                <p className="vs-hint">Откройте запись на этом времени и проверьте.</p>
                <ol className="lib-hits">
                  {hits.map((h, i) => (
                    <li key={`${h.file}-${h.from}-${i}`}>
                      <b>
                        {h.name} · {stamp(h.from)}
                      </b>
                      <span>{h.text.slice(0, 180)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {conv && (
              <div className="vs-agent">
                <div className="vs-agent-head">
                  <strong>Ответ по записям</strong>
                  <button className="btn btn-secondary btn-small" onClick={() => setConv(null)}>
                    Закрыть
                  </button>
                </div>
                <ChatView
                  conversation={conv}
                  systemPrompt="Ты отвечаешь строго по расшифровкам записей, которые тебе дают в сообщении. Никаких сведений сверх них."
                  settings={settings}
                  skills={skills}
                  onUpdate={setConv}
                  onSave={async () => {}}
                  prefill={prefill}
                  emptyHint="Задайте вопрос слева — сюда придёт ответ со ссылками на записи."
                  onAssistantMessage={onAssistantMessage}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {reading && (
        <div className="lib-reader-back" onClick={() => setReading(null)}>
          <div className="lib-reader" onClick={(e) => e.stopPropagation()}>
            <div className="lib-reader-head">
              <strong>{reading.name}</strong>
              <span className="vs-hint">
                {reading.polishedAt
                  ? `разобрано моделью ${reading.polishModel || "по умолчанию"}`
                  : "сырая расшифровка — разбор ещё не делался"}
              </span>
              <button className="btn btn-secondary btn-small" onClick={() => setReading(null)}>
                Закрыть
              </button>
            </div>
            {!!reading.marks.length && (
              <ol className="lib-outline">
                {reading.marks.map((m) => (
                  <li key={`${m.from}-${m.title}`}>
                    <b>
                      {stamp(m.from)}–{stamp(m.to)}
                    </b>{" "}
                    {m.title}
                    {m.keywords.length ? <span className="vs-hint"> · {m.keywords.join(", ")}</span> : null}
                  </li>
                ))}
              </ol>
            )}
            <pre className="lib-reader-text">{reading.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
