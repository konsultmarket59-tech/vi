import { useEffect, useRef, useState } from "react";
import type { ChatCopy, CopySource, DemoKeyInfo, PublishResult } from "../lib/types";
import { errorText } from "./ConnectionStatus";

interface Props {
  /** demo — ключ вшит и скрыт от человека; paid — человек работает со своим ключом. */
  kind: "demo" | "paid";
}

function emptyCopy(kind: "demo" | "paid"): Partial<ChatCopy> {
  return {
    kind,
    name: "",
    note: "",
    office: ["excel", "word"],
    plugins: [],
    apiKey: "",
    baseUrl: "https://polza.ai/api/v1",
    model: "anthropic/claude-sonnet-5",
    pricesText: "",
    days: kind === "demo" ? 5 : 365,
    copyProtection: true,
    machineCode: "",
    revocationUrl: "",
    repoName: "",
  };
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru-RU");
}

function daysLeft(iso: string): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  return Number.isFinite(end) ? Math.ceil((end - Date.now()) / 86400000) : null;
}

/**
 * Копии «Личного чата» для людей: демо и оплаченные.
 *
 * Одна страница на всю жизнь копии — кому она, из чего собрана, где её
 * репозиторий, когда кончается доступ и как его закрыть. Разделять это по
 * вкладкам было ошибкой: имя в лицензии, название в сборке и репозиторий
 * разъезжались просто потому, что заводились в разных местах.
 */
export default function CopiesView({ kind }: Props) {
  const [list, setList] = useState<ChatCopy[]>([]);
  const [plugins, setPlugins] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Partial<ChatCopy>>(emptyCopy(kind));
  // Код берётся из канонического репозитория на GitHub. Папка на компьютере —
  // осознанное исключение: собрать из того, что автор правит прямо сейчас.
  const [source, setSource] = useState<CopySource | null>(null);
  const [sourcePath, setSourcePath] = useState("");
  const [fromFolder, setFromFolder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);
  const [keyInfo, setKeyInfo] = useState<DemoKeyInfo | null>(null);

  const demo = kind === "demo";

  useEffect(() => {
    Promise.all([window.api.listCopies(), window.api.copyPlugins(), window.api.demoKeyInfo()])
      .then(([c, p, k]) => {
        setList(c);
        setPlugins(p);
        setKeyInfo(k);
      })
      .catch((e) => setError(errorText(e)));
    // Откуда берётся код — отдельно и со своей обработкой отказа: это подпись
    // под формой, и ни задерживать из-за неё список копий, ни терять его, если
    // она не ответит, нельзя.
    window.api
      .copySource()
      .then(setSource)
      .catch(() => setSource(null));
  }, []);

  useEffect(() => {
    setDraft(emptyCopy(kind));
  }, [kind]);
  useEffect(() => window.api.onPublishLog((line) => setLog((prev) => [...prev, line])), []);
  useEffect(() => {
    // Фигурные скобки здесь обязательны: scrollIntoView в этой версии Chromium
    // возвращает Promise, а React считает возвращённое из эффекта значение
    // функцией очистки и вызывает его на следующем запуске. Со стрелкой без
    // скобок это роняло весь интерфейс в белый экран при нажатии «Собрать».
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log]);

  const mine = list.filter((c) => c.kind === kind);
  const demos = list.filter((c) => c.kind === "demo");

  function patch(next: Partial<ChatCopy>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function togglePlugin(id: string) {
    const current = draft.plugins ?? [];
    patch({ plugins: current.includes(id) ? current.filter((p) => p !== id) : [...current, id] });
  }

  function toggleOffice(id: string) {
    const current = draft.office ?? [];
    patch({ office: current.includes(id) ? current.filter((p) => p !== id) : [...current, id] });
  }

  async function act<T>(fn: () => Promise<T>, success = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      if (success) setNotice(success);
      return value;
    } catch (e) {
      // errorText снимает обёртку Electron: имя IPC-метода человеку ничего не
      // говорит и только прячет настоящую причину.
      setError(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<ChatCopy | null> {
    const saved = await act(async () => {
      const { all, saved } = await window.api.saveCopy(draft);
      setList(all);
      setDraft(saved);
      return saved;
    }, "Сохранено.");
    return saved;
  }

  async function pickSources() {
    const dir = await act(() => window.api.pickChatSources());
    if (dir) setSourcePath(dir);
  }

  async function build() {
    if (demo && !keyInfo?.exists) {
      setError("Сначала создайте ключ подписи выше — без него демо-копию нельзя активировать.");
      return;
    }
    const saved = await save();
    if (!saved) return;
    if (fromFolder && !sourcePath) {
      setError("Выберите папку с исходниками «Личного чата» или вернитесь к коду с GitHub.");
      return;
    }
    setLog([]);
    setResult(null);
    setBusy(true);
    try {
      // Пустой sourcePath — обычный случай: приложение само скачает канонический код.
      const built = await window.api.publishCopy(saved.id, { sourcePath: fromFolder ? sourcePath : "" });
      setResult(built);
      if (built.ok) {
        if (built.all) setList(built.all);
        setNotice(`Сборка запущена в ${built.repo}.`);
      } else {
        setError(built.message || "Сборка не запустилась.");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-view">
      <h2 className="view-title">{demo ? "Демо" : "Чистовая сборка"}</h2>
      <p className="hint">
        {demo ? (
          <>
            Копия для тестирования: работает на одном компьютере, ограниченный срок, ключ Polza
            вшит и человеку не показывается. По кнопке «Собрать» в вашем GitHub появляется закрытый
            репозиторий этой копии, туда уезжает код чата с её конфигурацией и запускается сборка
            установщика.
          </>
        ) : (
          <>
            Оплаченная копия: то же самое, но ключ Polza человек вводит свой и видит его в
            настройках. Репозиторий берётся тот же, что был у демо — доработки идут туда же, а не в
            новое место. Привязка к компьютеру остаётся защитой от копирования.
          </>
        )}{" "}
        Данных внутри копии нет: документы, навыки и проекты человек заводит сам, как в
        каноническом чате.
      </p>

      {demo && (
        <section className="card">
          <h3 className="card-title">Ключ подписи</h3>
          {!keyInfo?.exists && (
            <>
              <p className="hint">
                Ключ создаётся один раз на этом компьютере. Им подписываются файлы активации — без
                него их невозможно ни выдать, ни подделать. Закрытая половина ключа остаётся здесь
                и никуда не отправляется; в сборку попадает только открытая, которая умеет
                проверять подпись, но не ставить её.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => act(async () => setKeyInfo(await window.api.demoCreateKeys()), "Ключ создан.")}
              >
                Создать ключ
              </button>
            </>
          )}
          {keyInfo?.exists && (
            <>
              <p className="hint">
                Ключ создан {formatDate(keyInfo.createdAt)}. Файл: {keyInfo.path}
              </p>
              <p className="hint hint-warn">
                Не удаляйте и не пересоздавайте его: все уже выданные файлы активации подписаны им
                и перестанут проходить проверку.
              </p>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h3 className="card-title">{demo ? "Выданные демо" : "Оплаченные копии"} ({mine.length})</h3>
        {mine.length === 0 && <p className="hint">Пока ни одной.</p>}
        {mine.map((copy) => {
          const left = daysLeft(copy.expiresAt);
          return (
            <div key={copy.id} className="plugin-row">
              <div className="plugin-main">
                <button type="button" className="blueprint-name" onClick={() => setDraft(copy)}>
                  <strong>{copy.displayName}</strong>
                  <span className="hint">
                    {copy.repoFullName ? ` — ${copy.repoFullName}` : " — ещё не собрана"}
                    {copy.plugins.length ? `, плагинов: ${copy.plugins.length}` : ""}
                  </span>
                </button>
                <span className="hint">
                  {copy.revoked
                    ? "доступ отозван"
                    : copy.expiresAt
                      ? `доступ до ${formatDate(copy.expiresAt)}${left !== null ? ` (осталось дней: ${left})` : ""}`
                      : "файл активации ещё не выдан"}
                  {copy.builtAt && ` · собрана ${formatDate(copy.builtAt)}`}
                </span>
              </div>
              <div className="plugin-actions">
                {copy.repoFullName && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => window.api.openExternal(`https://github.com/${copy.repoFullName}/actions`)}
                  >
                    Сборка на GitHub
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const issued = await window.api.issueCopyLicence(copy.id);
                      if (!issued) return;
                      setList(issued.all);
                      setNotice(
                        `Файл активации сохранён: ${issued.file}. Действует до ${formatDate(issued.expiresAt)}.`
                      );
                    })
                  }
                >
                  Выдать доступ
                </button>
                <button
                  type="button"
                  className={copy.revoked ? "btn btn-sm" : "btn btn-sm btn-danger"}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      setList(await window.api.setCopyRevoked(copy.id, !copy.revoked));
                    }, copy.revoked ? "Доступ возвращён." : "Доступ отозван — выгрузите список отзыва.")
                  }
                >
                  {copy.revoked ? "Вернуть доступ" : "Отозвать"}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Удалить запись «${copy.displayName}»? Репозиторий на GitHub останется.`)) return;
                    act(async () => setList(await window.api.deleteCopy(copy.id)), "Запись удалена.");
                  }}
                >
                  Удалить
                </button>
              </div>
            </div>
          );
        })}
        <div className="row">
          <button type="button" className="btn" onClick={() => setDraft(emptyCopy(kind))}>
            {demo ? "Новая демо-копия" : "Новая оплаченная копия"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const saved = await window.api.exportCopyRevocations();
                if (saved) setNotice(`Список отзыва сохранён: ${saved.file}. Отозванных: ${saved.count}.`);
              })
            }
          >
            Выгрузить список отзыва
          </button>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">{draft.id ? "Изменение копии" : demo ? "Новая демо-копия" : "Новая копия"}</h3>

        <label className="field-label">Кому — имя или название компании</label>
        <input
          className="input"
          placeholder="Мария Петрова или ООО «Ромашка»"
          value={draft.name ?? ""}
          onChange={(e) =>
            patch({
              name: e.target.value,
              // Пока имя не правили руками, название копии и репозитория идут за ним.
              displayName: draft.id ? draft.displayName : "",
              repoName: draft.id ? draft.repoName : "",
            })
          }
        />

        <div className="row">
          <div className="col">
            <label className="field-label">Название в окне у человека</label>
            <input
              className="input"
              placeholder={draft.name ? `Личный чат ${draft.name}` : "Личный чат"}
              value={draft.displayName ?? ""}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </div>
          <div className="col">
            <label className="field-label">{demo ? "Срок доступа, дней" : "Срок действия файла, дней"}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={draft.days ?? 5}
              onChange={(e) => patch({ days: Number(e.target.value) })}
            />
          </div>
        </div>

        <label className="field-label">Репозиторий этой копии</label>
        <input
          className="input"
          placeholder={draft.name ? "заполнится само" : "personal-chat-…"}
          value={draft.repoName ?? ""}
          onChange={(e) => patch({ repoName: e.target.value })}
        />
        {!demo && demos.length > 0 && (
          <>
            <label className="field-label">Взять репозиторий у демо-копии</label>
            <select
              className="input"
              value={draft.fromCopyId ?? ""}
              onChange={(e) => {
                const source = demos.find((d) => d.id === e.target.value);
                patch(
                  source
                    ? {
                        fromCopyId: source.id,
                        repoName: source.repoName,
                        office: source.office,
                        plugins: source.plugins,
                        displayName: source.displayName,
                        name: draft.name || source.name,
                      }
                    : { fromCopyId: "" }
                );
              }}
            >
              <option value="">— не переносить —</option>
              {demos.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName} ({d.repoName})
                </option>
              ))}
            </select>
            <p className="hint">
              Оплаченная копия продолжает жить в том же репозитории, что и демо: правки, которые вы
              туда уже внесли, никуда не деваются.
            </p>
          </>
        )}

        <h4 className="field-label">Конфигурация</h4>
        <p className="hint">
          База включена всегда — чат с выбором модели, проекты и инструкции, навыки, задачи по
          расписанию, файлы с компьютера. Всё как в каноническом чате, только без чужих данных.
        </p>
        <div className="module-grid">
          {[
            { id: "excel", name: "Excel", description: "Таблицы с формулами и агент внутри таблицы." },
            { id: "word", name: "Word", description: "Документы .docx и агент для правок." },
          ].map((m) => (
            <label
              key={m.id}
              className={`module-card${(draft.office ?? []).includes(m.id) ? " module-card-on" : ""}`}
            >
              <input
                type="checkbox"
                checked={(draft.office ?? []).includes(m.id)}
                onChange={() => toggleOffice(m.id)}
              />
              <span>
                <strong>{m.name}</strong>
                <span className="module-desc">{m.description}</span>
              </span>
            </label>
          ))}
        </div>

        <h4 className="field-label">Плагины в этой копии</h4>
        <div className="module-grid">
          {plugins.map((p) => (
            <label
              key={p.id}
              className={`module-card${(draft.plugins ?? []).includes(p.id) ? " module-card-on" : ""}`}
            >
              <input
                type="checkbox"
                checked={(draft.plugins ?? []).includes(p.id)}
                onChange={() => togglePlugin(p.id)}
              />
              <span>
                <strong>{p.name}</strong>
              </span>
            </label>
          ))}
        </div>

        <h4 className="field-label">Доступ к моделям</h4>
        {demo ? (
          <>
            <p className="hint">
              Ключ вшивается в копию: человек его не видит и не вводит, а в настройках вместо поля
              ключа видит свой расход. Заведите для демо <b>отдельный ключ с небольшим балансом</b> —
              по окончании тестирования вы его просто отзываете, и копия становится бесполезной.
            </p>
            <label className="field-label">Ключ Polza для этой копии</label>
            <input
              className="input"
              type="password"
              placeholder="ключ, который человек не увидит"
              value={draft.apiKey ?? ""}
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
            <label className="field-label">Цены моделей (модель, вход, выход за 1 млн токенов)</label>
            <textarea
              className="textarea"
              rows={3}
              placeholder={"anthropic/claude-sonnet-5 300 1500"}
              value={draft.pricesText ?? ""}
              onChange={(e) => patch({ pricesText: e.target.value })}
            />
            <p className="hint">По ним копия показывает расход. Модель без цены — только токены, без суммы.</p>
          </>
        ) : (
          <p className="hint">
            Ключ вводит сам человек в настройках копии — поле ключа ему видно, расход он оплачивает
            со своего аккаунта Polza. Приложение здесь ключ не хранит и в сборку не кладёт.
          </p>
        )}

        <h4 className="field-label">Активация и защита</h4>
        {demo ? (
          <p className="hint">
            Демо-копия всегда просит файл активации: она работает на одном компьютере и до
            указанной даты. Срок — главная защита: копия умирает сама, даже без интернета.
          </p>
        ) : (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.copyProtection !== false}
              onChange={(e) => patch({ copyProtection: e.target.checked })}
            />{" "}
            Защита от копирования: копия работает только на компьютере, для которого выдан файл
          </label>
        )}

        <label className="field-label">Код компьютера (когда человек его пришлёт)</label>
        <input
          className="input"
          placeholder="ABCDE-12345-ABCDE-12345"
          value={draft.machineCode ?? ""}
          onChange={(e) => patch({ machineCode: e.target.value })}
        />
        <p className="hint">
          Код виден на экране активации у человека. Он нужен только для выдачи файла — собрать копию
          можно и без него.
        </p>

        <label className="field-label">Ссылка на список отзыва (необязательно)</label>
        <input
          className="input"
          placeholder="https://…/revoked.json"
          value={draft.revocationUrl ?? ""}
          onChange={(e) => patch({ revocationUrl: e.target.value })}
        />

        <h4 className="field-label">Откуда брать код</h4>
        {fromFolder ? (
          <>
            <div className="row">
              <code className="folder-path">
                {sourcePath || "папка с исходниками «Личного чата» не выбрана"}
              </code>
              <button type="button" className="btn" onClick={pickSources}>
                Выбрать папку
              </button>
            </div>
            <p className="hint">
              Сборка пойдёт из этой папки — тем кодом, что лежит в ней прямо сейчас. Для этого
              пути нужен установленный git: снимок папки собирает он.{" "}
              <button
                type="button"
                className="link-like"
                onClick={() => {
                  setFromFolder(false);
                  setSourcePath("");
                }}
              >
                Вернуться к коду с GitHub
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="conn-status conn-ok" role="status">
              <span className="conn-mark" aria-hidden="true">
                ✓
              </span>
              <span className="conn-text">
                Код берётся с GitHub: <code>{source?.repo || "…"}</code>, ветка{" "}
                <code>{source?.branch || "…"}</code>. Папка на компьютере не нужна — приложение
                скачает его само перед сборкой.
              </span>
            </p>
            <p className="hint">
              GitHub сам передаёт код в репозиторий копии — на этом компьютере ничего не
              скачивается, и git для этого не нужен. Репозиторий и ветку можно поменять в
              «Настройках».{" "}
              <button type="button" className="link-like" onClick={() => setFromFolder(true)}>
                Собрать из папки на компьютере
              </button>
            </p>
          </>
        )}
        <p className="hint">
          В репозиторий копии уезжает снимок папки personal-chat из канонической ветки — одним
          коммитом, без истории и без «Личного кода».
        </p>
      </section>

      <div className="sticky-actions">
        <button type="button" className="btn btn-primary" onClick={build} disabled={busy}>
          {busy ? "Собираю…" : "Собрать"}
        </button>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          Только сохранить
        </button>
        {notice && <span className="notice-text">{notice}</span>}
        {error && <span className="error-text">{error}</span>}
      </div>

      {demo && (
        <section className="card">
          <h3 className="card-title">Насколько это надёжно</h3>
          <p className="hint">
            Привязка к компьютеру и срок действия проверяются внутри самого приложения — значит,
            всё нужное для проверки лежит на компьютере тестировщика. Человек с техническими
            навыками может распаковать установщик и убрать проверку. Это защищает от того, чтобы
            копию просто передали дальше или запустили на втором компьютере, но не от
            целенаправленного взлома — и ничто, работающее на чужой машине, от этого защитить не
            может.
          </p>
          <p className="hint">
            Для группы из десяти известных вам людей этого достаточно. Настоящая защита на этапе
            фокус-группы — не техническая: расписка о неразглашении и то, что вы знаете каждого в
            лицо.
          </p>
        </section>
      )}

      {(log.length > 0 || busy) && (
        <section className="card">
          <h3 className="card-title">Что происходит</h3>
          <pre className="build-log">
            {log.join("\n")}
            <div ref={logEnd} />
          </pre>
          {result?.ok && (
            <div className="row">
              <button type="button" className="btn" onClick={() => window.api.openExternal(result.actionsUrl!)}>
                Открыть сборку на GitHub
              </button>
              <button type="button" className="btn" onClick={() => window.api.openExternal(result.releaseUrl!)}>
                Готовый установщик
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
