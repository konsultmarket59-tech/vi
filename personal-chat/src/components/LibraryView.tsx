import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Conversation,
  LibraryConfig,
  LibraryEngineStatus,
  LibraryFile,
  LibraryHit,
  LibraryProgress,
  Settings,
  Skill,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";

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
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LibraryProgress | null>(null);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [hits, setHits] = useState<LibraryHit[]>([]);
  const [checked, setChecked] = useState<{ problems: string[]; unsupported: number } | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number; autoSend?: boolean }>();
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    const scan = await window.api.libraryScan();
    setFiles(scan.files);
    setOrphans(scan.orphans || []);
    setMissing(scan.missing);
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
  const readySeconds = useMemo(() => ready.reduce((s, f) => s + f.seconds, 0), [ready]);

  async function patchConfig(changes: Partial<LibraryConfig>) {
    const next = await window.api.librarySaveConfig(changes);
    setConfig(next);
    setEngine(await window.api.libraryEngineStatus());
    if (changes.folderPath !== undefined) void refresh();
  }

  async function transcribe(paths: string[]) {
    if (!paths.length) return;
    setError("");
    setBusy(true);
    setProgress({ stage: "file", index: 0, total: paths.length });
    try {
      const result = await window.api.libraryTranscribe(paths);
      if (result.failed.length) {
        setError(
          `Не удалось расшифровать: ${result.failed.map((f) => f.path.split(/[\\/]/).pop()).join(", ")}`
        );
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
              <h3>Папка с записями</h3>
              <div className="vs-row">
                <button
                  className="btn btn-secondary btn-small"
                  onClick={async () => {
                    const folder = await window.api.libraryPickFolder();
                    if (folder) await patchConfig({ folderPath: folder });
                  }}
                >
                  Выбрать папку
                </button>
                <span className="vs-path">{config?.folderPath || "не выбрана"}</span>
              </div>
              {missing && <p className="vs-warn">Папка недоступна — возможно, диск отключён.</p>}
              {!!files.length && (
                <p className="vs-hint">
                  Записей: {files.length}. Расшифровано: {ready.length}
                  {readySeconds ? ` (${formatMinutes(readySeconds)} речи)` : ""}. Ждут очереди:{" "}
                  {pending.length}.
                </p>
              )}
              {!!orphans.length && (
                <p className="vs-warn">
                  Расшифровок без записи: {orphans.length} — файлы переименованы или унесены из
                  папки. По ссылкам из них идти будет некуда.
                </p>
              )}
            </section>

            <section className="vs-block">
              <h3>Чем расшифровывать</h3>
              <div className="vs-tabs">
                <button
                  className={config?.engine !== "remote" ? "vs-tab on" : "vs-tab"}
                  onClick={() => patchConfig({ engine: "local" })}
                >
                  На этом компьютере
                </button>
                <button
                  className={config?.engine === "remote" ? "vs-tab on" : "vs-tab"}
                  onClick={() => patchConfig({ engine: "remote" })}
                >
                  Через платный сервис
                </button>
              </div>
              {config?.engine !== "remote" ? (
                <>
                  <p className="vs-hint">
                    Бесплатно и материал не покидает компьютер. Расплата — время: примерно час
                    работы на час записи. Нужны программа whisper.cpp и файл модели — приложение их
                    не возит с собой, потому что это полтора гигабайта ради тех, кому раздел не
                    нужен.
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
                <p className="vs-hint">
                  Быстро — час записи за минуты, — но <b>запись уходит на чужой сервер</b>. Если на
                  записях клиентские дела, это решение принимаете вы. Используется ключ и адрес из
                  общих настроек приложения.
                </p>
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
                        <span className="lib-badge">расшифровано</span>
                        <button className="link-btn" onClick={() => retell(f.path)}>
                          Пересказать
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
                {!files.length && <p className="vs-hint">Записей нет — выберите папку.</p>}
              </div>
            </section>
          </div>

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
    </div>
  );
}
