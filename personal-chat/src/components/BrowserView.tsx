import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatAttachment,
  PhoneStatus,
  Project,
  ReadPage,
  RoleChat,
  RoleChatSummary,
  RoleModel,
  Settings,
} from "../lib/types";
import Splitter from "./Splitter";
import Markdown from "./Markdown";

/**
 * Браузер с командой ролей.
 *
 * Раздел устроен вокруг одной мысли: разговор про сайт должен идти РЯДОМ с
 * сайтом. Поэтому слева настоящая страница — с входом в личный кабинет,
 * корзиной и всем, что бывает на сайте, — а справа тот, с кем вы её обсуждаете.
 * Роль видит не «ссылку, которую вы прислали», а текст страницы в том виде, в
 * каком он открыт у вас, и по кнопке — её снимок. Это и есть разница между
 * «посмотри вот тут» и «я вижу то же, что и вы».
 *
 * Второе: специалистов несколько, и их можно собрать вместе. Переговорка — не
 * трюк, а способ получить разные мнения по одному вопросу за один заход:
 * маркетолог и экономист по одной и той же затее скажут разное, и увидеть это
 * рядом полезнее, чем спрашивать их по очереди и сводить ответы самому.
 */

interface Props {
  projects: Project[];
  settings: Settings;
}

/** Только то, чем мы пользуемся у тега <webview>. */
interface WebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
}

const HOME_URL = "https://duckduckgo.com/";

/** Адрес это или запрос — решаем здесь, как в обычной строке браузера. */
function toUrl(input: string): string {
  const raw = input.trim();
  if (!raw) return HOME_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(raw)) return `https://${raw}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`;
}

function shortUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function BrowserView({ projects, settings }: Props) {
  const [tab, setTab] = useState<"page" | "team" | "phone">("page");
  const [roles, setRoles] = useState<RoleModel[]>([]);
  const [chats, setChats] = useState<RoleChatSummary[]>([]);
  const [chat, setChat] = useState<RoleChat | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Страница
  const [address, setAddress] = useState(HOME_URL);
  const [pageUrl, setPageUrl] = useState(HOME_URL);
  const [pageTitle, setPageTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const webviewRef = useRef<WebviewElement | null>(null);

  // Ход разговора
  const [jobId, setJobId] = useState("");
  const [progress, setProgress] = useState("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"chat" | "task">("chat");
  const [sharePage, setSharePage] = useState(true);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [onlySummary, setOnlySummary] = useState(false);

  // Сборка новой переговорки
  const [picked, setPicked] = useState<string[]>([]);
  const [rounds, setRounds] = useState(2);
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<RoleModel | null>(null);

  const [phone, setPhone] = useState<PhoneStatus | null>(null);
  const [phonePort, setPhonePort] = useState(8765);

  const busy = Boolean(jobId);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const refreshChats = useCallback(async () => {
    setChats(await window.api.listRoleChats());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [roleList, chatList, tabsState] = await Promise.all([
          window.api.listRoles(),
          window.api.listRoleChats(),
          window.api.getBrowserTabs(),
        ]);
        setRoles(roleList);
        setChats(chatList);
        const last = tabsState.tabs[0];
        if (last?.url) {
          setAddress(last.url);
          setPageUrl(last.url);
        }
        if (chatList.length > 0) setChat(await window.api.openRoleChat(chatList[0].id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // Последний открытый адрес переживает перезапуск: браузер, который каждое утро
  // начинается с пустой страницы, — это не браузер, а окно для одного захода.
  useEffect(() => {
    const timer = setTimeout(() => {
      void window.api
        .saveBrowserTabs({ tabs: [{ id: "последняя", title: pageTitle, url: pageUrl }], bookmarks: [] })
        .catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [pageUrl, pageTitle]);

  // События хода приходят из главного процесса: реплики появляются по одной, а
  // не все разом в конце, и видно, кто сейчас говорит и что ищет.
  //
  // Подписка одна на всё время жизни раздела, а фильтр — по разговору, а не по
  // номеру хода. Иначе первые события («Маркетолог думает…») терялись: они
  // приходят раньше, чем окно успевает запомнить номер только что начатого хода.
  const openChatIdRef = useRef("");
  useEffect(() => {
    openChatIdRef.current = chat?.id || "";
  }, [chat?.id]);

  useEffect(() => {
    return window.api.onRoleProgress((event) => {
      if (event.chatId !== openChatIdRef.current) return;
      if (event.type === "message" && event.message) {
        const message = event.message;
        setChat((prev) =>
          prev && prev.id === event.chatId && !prev.messages.some((m) => m.id === message.id)
            ? { ...prev, messages: [...prev.messages, message] }
            : prev
        );
      }
      if (event.type === "speaking" || event.type === "tool") setProgress(event.text || "");
      if (event.type === "done") {
        setProgress("");
        setJobId("");
        if (event.error) setError(event.error);
        void (async () => {
          try {
            const fresh = await window.api.openRoleChat(event.chatId);
            setChat((prev) => (prev && prev.id === fresh.id ? fresh : prev));
            await refreshChats();
          } catch {
            // Разговор могли удалить, пока шёл ход, — обновлять тогда нечего.
          }
        })();
      }
    });
  }, [refreshChats]);

  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat?.messages.length, progress]);

  // Тег <webview> — обычный DOM-элемент, а не компонент React: события у него
  // свои, поэтому вешаем их руками.
  const attachWebview = useCallback((node: WebviewElement | null) => {
    webviewRef.current = node;
    if (!node) return;
    node.addEventListener("did-start-loading", () => setLoading(true));
    node.addEventListener("did-stop-loading", () => {
      setLoading(false);
      setPageUrl(node.getURL());
      setAddress(node.getURL());
      setPageTitle(node.getTitle());
    });
    node.addEventListener("page-title-updated", () => setPageTitle(node.getTitle()));
    node.addEventListener("did-fail-load", (e) => {
      const detail = e as unknown as { errorCode: number; errorDescription: string; validatedURL: string };
      // -3 — прерванная загрузка (человек нажал стоп или ушёл со страницы), это не ошибка.
      if (detail.errorCode === -3) return;
      setError(`Страница не открылась: ${detail.errorDescription || detail.errorCode} (${detail.validatedURL})`);
    });
  }, []);

  function go(where: string) {
    const url = toUrl(where);
    setError("");
    setAddress(url);
    setPageUrl(url);
    const node = webviewRef.current;
    if (node) void node.loadURL(url).catch(() => setError("Не удалось открыть адрес."));
  }

  /** Текст открытой страницы — то, что человек сейчас видит, включая личный кабинет. */
  async function currentPage(): Promise<ReadPage | null> {
    const node = webviewRef.current;
    if (!node || !sharePage || tab !== "page") return null;
    try {
      const text = (await node.executeJavaScript(
        "document.body ? document.body.innerText.slice(0, 20000) : ''"
      )) as string;
      return { url: node.getURL(), title: node.getTitle(), text };
    } catch {
      // Страница может запретить чтение (например, пока грузится) — тогда роль
      // получит только адрес и честно скажет, что текста не видит.
      return { url: node.getURL(), title: node.getTitle(), text: "" };
    }
  }

  async function showPageToRoles() {
    const node = webviewRef.current;
    if (!node) return;
    setError("");
    try {
      const dataUrl = await window.api.capturePage(node.getWebContentsId());
      const attachment = await window.api.saveBrowserPhoto(
        `снимок ${shortUrl(node.getURL())}.png`,
        dataUrl,
        chat?.projectId || projectId || ""
      );
      setAttachments((prev) => [...prev, attachment]);
      setNote("Снимок страницы приложен — роль увидит её так же, как вы.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addFiles() {
    try {
      const picked = await window.api.pickAttachments();
      if (picked.length > 0) setAttachments((prev) => [...prev, ...picked]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startChat(kind: "role" | "room", roleIds: string[]) {
    setError("");
    try {
      const created = await window.api.createRoleChat({
        kind,
        roleIds,
        projectId,
        rounds,
        title: kind === "room" ? "Новая переговорка" : "Новый разговор",
      });
      setChat(created);
      setPicked([]);
      await refreshChats();
      setTab("page");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    const text = input.trim();
    if (!chat || busy || (!text && attachments.length === 0)) return;
    setError("");
    setNote("");
    setInput("");
    const sent = attachments;
    setAttachments([]);
    try {
      const page = await currentPage();
      const started = await window.api.sendToRoles({
        chatId: chat.id,
        text,
        attachments: sent,
        page,
        mode,
      });
      setChat(started.chat);
      setJobId(started.jobId);
      setProgress("Отправлено…");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInput(text);
      setAttachments(sent);
    }
  }

  async function stop() {
    if (!jobId) return;
    await window.api.stopRoleJob(jobId);
    setProgress("Останавливаю после текущей реплики…");
  }

  async function saveResult(format: "docx" | "xlsx" | "pdf" | "png") {
    if (!chat) return;
    setError("");
    setNote("");
    try {
      const file = await window.api.saveRoleChatResult({
        chatId: chat.id,
        format,
        scope: onlySummary ? "summary" : "all",
      });
      if (file) setNote(`Сохранено: ${file}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openChat(id: string) {
    setError("");
    try {
      setChat(await window.api.openRoleChat(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeChat(id: string) {
    if (!confirm("Удалить этот разговор вместе со всеми репликами?")) return;
    await window.api.deleteRoleChat(id);
    if (chat?.id === id) setChat(null);
    await refreshChats();
  }

  async function loadPhone() {
    try {
      const status = await window.api.phoneStatus();
      setPhone(status);
      setPhonePort(status.port);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (tab === "phone" && !phone) void loadPhone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const roleById = (id: string) => roles.find((r) => r.id === id);
  const chatRoles = chat ? chat.roleIds.map(roleById).filter(Boolean) : [];

  return (
    <div className="ops-view brw-view">
      <div className="cat-tabs">
        <button className={tab === "page" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("page")}>
          🌐 Страница
        </button>
        <button className={tab === "team" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("team")}>
          🧑‍💼 Команда
        </button>
        <button className={tab === "phone" ? "vs-tab on" : "vs-tab"} onClick={() => setTab("phone")}>
          📱 Телефон
        </button>
        <div className="cat-tabs-actions">
          {!settings.apiKey && !settings.managed && (
            <span className="hint">Ключ модели не задан — роли отвечать не смогут.</span>
          )}
        </div>
      </div>

      {error && <p className="vs-warn cat-bar-note">{error}</p>}
      {note && <p className="vs-saved cat-bar-note">{note}</p>}

      {tab === "page" && (
        <div className="brw-body">
          <div className="brw-stage">
            <div className="brw-toolbar">
              <button
                className="btn btn-secondary btn-small"
                title="Назад"
                onClick={() => webviewRef.current?.goBack()}
              >
                ‹
              </button>
              <button
                className="btn btn-secondary btn-small"
                title="Вперёд"
                onClick={() => webviewRef.current?.goForward()}
              >
                ›
              </button>
              <button
                className="btn btn-secondary btn-small"
                title={loading ? "Остановить" : "Обновить"}
                onClick={() => (loading ? webviewRef.current?.stop() : webviewRef.current?.reload())}
              >
                {loading ? "×" : "⟳"}
              </button>
              <input
                className="brw-address"
                value={address}
                spellCheck={false}
                placeholder="Адрес сайта или поисковый запрос"
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") go(address);
                }}
              />
              <button className="btn btn-secondary btn-small" onClick={() => go(address)}>
                Открыть
              </button>
            </div>
            {/*
              Сайт живёт в отдельном процессе со своим хранилищем (partition):
              вход в личный кабинет сохраняется между запусками, но к данным
              приложения страница доступа не имеет — preload ей не выдаётся,
              см. will-attach-webview в main.cjs.
            */}
            <webview
              ref={attachWebview as unknown as React.Ref<HTMLElement>}
              className="brw-webview"
              src={pageUrl}
              partition="persist:браузер"
            />
          </div>

          <Splitter
            id="браузер-панель"
            variable="--brw-panel-width"
            fallback={420}
            min={320}
            max={760}
            side="right"
            label="Граница панели разговора"
          />

          <div className="brw-panel">
            <div className="brw-panel-head">
              <select
                className="brw-chat-select"
                value={chat?.id || ""}
                onChange={(e) => (e.target.value ? void openChat(e.target.value) : setChat(null))}
              >
                <option value="">— выберите разговор —</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.kind === "room" ? "🏛 " : "💬 "}
                    {c.title}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary btn-small" onClick={() => setTab("team")}>
                ＋ Новый
              </button>
              {chat && (
                <button className="link-btn" onClick={() => void removeChat(chat.id)}>
                  удалить
                </button>
              )}
            </div>

            {chat && (
              <div className="brw-roles-line">
                {chatRoles.map(
                  (r) =>
                    r && (
                      <span key={r.id} className="brw-role-chip" style={{ borderColor: r.color }}>
                        {r.emoji} {r.name}
                      </span>
                    )
                )}
                {chat.kind === "room" && <span className="hint">кругов обсуждения: {chat.rounds}</span>}
                {chat.projectId && (
                  <span className="hint">
                    проект: {projects.find((p) => p.id === chat.projectId)?.name || "удалён"}
                  </span>
                )}
              </div>
            )}

            <div className="brw-messages" ref={messagesRef}>
              {!chat && (
                <p className="vs-hint">
                  Разговора пока нет. Откройте вкладку «Команда»: там можно позвать одного специалиста
                  или собрать переговорку из нескольких.
                </p>
              )}
              {chat?.messages.length === 0 && (
                <p className="vs-hint">
                  Напишите, что нужно. Если открыта страница, она уйдёт вместе с вопросом —
                  роль ответит по тому, что на ней действительно написано.
                </p>
              )}
              {chat?.messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.from === "me" ? "brw-msg brw-msg-me" : m.summary ? "brw-msg brw-msg-summary" : "brw-msg"
                  }
                >
                  <div className="brw-msg-who" style={m.from === "me" ? undefined : { color: m.color }}>
                    {m.from === "me" ? "Вы" : `${m.emoji || ""} ${m.name}`}
                  </div>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="brw-msg-files">
                      {m.attachments.map((a) => (
                        <span key={a.path} className="attachment-chip">
                          🖼️ {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.from === "me" ? <p className="brw-msg-text">{m.content}</p> : <Markdown text={m.content} />}
                </div>
              ))}
              {progress && <div className="brw-progress">{progress}</div>}
            </div>

            <div className="brw-composer">
              {attachments.length > 0 && (
                <div className="brw-msg-files">
                  {attachments.map((a) => (
                    <span key={a.path} className="attachment-chip">
                      📎 {a.name}
                      <button className="link-btn" onClick={() => setAttachments((p) => p.filter((x) => x !== a))}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                rows={3}
                value={input}
                disabled={!chat}
                placeholder={
                  chat?.kind === "room"
                    ? "Задача для переговорки. Через @ можно обратиться к участнику по имени."
                    : "Что нужно от специалиста?"
                }
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="brw-composer-row">
                <button className="btn btn-secondary btn-small" onClick={addFiles} disabled={!chat}>
                  📎 Файл
                </button>
                <button className="btn btn-secondary btn-small" onClick={showPageToRoles} disabled={!chat}>
                  📸 Показать страницу
                </button>
                <label className="brw-check" title="Передавать текст открытой страницы вместе с вопросом">
                  <input type="checkbox" checked={sharePage} onChange={(e) => setSharePage(e.target.checked)} />
                  видит страницу
                </label>
                <label className="brw-check" title="Задание: роль работает сама и отдаёт готовый отчёт">
                  <input
                    type="checkbox"
                    checked={mode === "task"}
                    onChange={(e) => setMode(e.target.checked ? "task" : "chat")}
                  />
                  задание
                </label>
                {busy ? (
                  <button className="btn btn-secondary btn-small" onClick={stop}>
                    Остановить
                  </button>
                ) : (
                  <button className="btn btn-primary btn-small" onClick={send} disabled={!chat}>
                    Отправить
                  </button>
                )}
              </div>
              {chat && chat.messages.length > 0 && (
                <div className="brw-composer-row">
                  <span className="hint">Сохранить:</span>
                  <button className="link-btn" onClick={() => saveResult("docx")}>
                    Word
                  </button>
                  <button className="link-btn" onClick={() => saveResult("xlsx")}>
                    Excel
                  </button>
                  <button className="link-btn" onClick={() => saveResult("pdf")}>
                    PDF
                  </button>
                  <button className="link-btn" onClick={() => saveResult("png")}>
                    PNG
                  </button>
                  {chat.kind === "room" && (
                    <label className="brw-check">
                      <input
                        type="checkbox"
                        checked={onlySummary}
                        onChange={(e) => setOnlySummary(e.target.checked)}
                      />
                      только итог
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "team" && (
        <div className="panel-section brw-team">
          <section className="vs-block">
            <h3>Собрать разговор</h3>
            <p className="vs-hint">
              Один специалист — обычный разговор. Двое и больше — переговорка: они обсуждают задачу
              между собой кругами, а вы видите весь разговор и можете вмешаться в любой момент.
            </p>
            <div className="brw-team-controls">
              <label>
                Проект для контекста
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">без проекта</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Кругов обсуждения
                <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))}>
                  <option value={1}>1 — по одной реплике</option>
                  <option value={2}>2 — мнение и ответ на возражения</option>
                  <option value={3}>3 — длинный разбор</option>
                </select>
              </label>
              <button
                className="btn btn-primary btn-small"
                disabled={picked.length < 2}
                onClick={() => startChat("room", picked)}
              >
                🏛 Собрать переговорку ({picked.length})
              </button>
            </div>
            {picked.length >= 2 && (
              <p className="vs-hint">
                Каждый круг — это по одному обращению к модели на участника, плюс итог встречи.
                Переговорка из {picked.length} ролей в {rounds}{" "}
                {rounds === 1 ? "круг" : rounds < 5 ? "круга" : "кругов"} — это{" "}
                {picked.length * rounds + 1} обращений.
              </p>
            )}
          </section>

          <div className="brw-role-grid">
            {roles.map((r) => (
              <div key={r.id} className="vs-block brw-role-card" style={{ borderColor: picked.includes(r.id) ? r.color : undefined }}>
                <div className="brw-role-title">
                  <span className="brw-role-emoji">{r.emoji}</span>
                  <b>{r.name}</b>
                  {r.edited && <span className="hint">изменена</span>}
                </div>
                <p className="vs-hint">{r.tagline}</p>
                <p className="vs-hint">
                  Модель: {r.model || "из настроек"} · интернет: {r.web ? "да" : "нет"}
                </p>
                <div className="brw-role-actions">
                  <button className="btn btn-secondary btn-small" onClick={() => startChat("role", [r.id])}>
                    Поговорить
                  </button>
                  <label className="brw-check">
                    <input
                      type="checkbox"
                      checked={picked.includes(r.id)}
                      onChange={(e) =>
                        setPicked((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))
                      }
                    />
                    в переговорку
                  </label>
                  <button className="link-btn" onClick={() => setEditing(r)}>
                    изменить
                  </button>
                </div>
              </div>
            ))}
          </div>

          <section className="vs-block">
            <h3>Своя роль</h3>
            <p className="vs-hint">
              Если нужного специалиста в списке нет — опишите его сами: как он думает, с чего начинает
              и чего не делает никогда. Это и есть вся разница между ролями.
            </p>
            <button
              className="btn btn-secondary btn-small"
              onClick={() =>
                setEditing({
                  id: "",
                  name: "",
                  emoji: "🧠",
                  color: "#4f7cff",
                  tagline: "",
                  prompt: "",
                  model: "",
                  web: true,
                  builtIn: false,
                  edited: false,
                })
              }
            >
              ＋ Добавить роль
            </button>
          </section>

          {chats.length > 0 && (
            <section className="vs-block">
              <h3>Разговоры</h3>
              {chats.map((c) => (
                <div key={c.id} className="brw-chat-row">
                  <button
                    className="link-btn"
                    onClick={() => {
                      void openChat(c.id);
                      setTab("page");
                    }}
                  >
                    {c.kind === "room" ? "🏛" : "💬"} {c.title}
                  </button>
                  <span className="hint">
                    {c.roleIds
                      .map((id) => roleById(id)?.name)
                      .filter(Boolean)
                      .join(", ")}{" "}
                    · реплик: {c.messageCount}
                  </span>
                  <button className="link-btn" onClick={() => void removeChat(c.id)}>
                    удалить
                  </button>
                </div>
              ))}
            </section>
          )}

          {editing && (
            <RoleEditor
              key={editing.id || "новая-роль"}
              role={editing}
              onClose={() => setEditing(null)}
              onSaved={async (saved) => {
                setRoles(await window.api.listRoles());
                setEditing(null);
                setNote(`Роль «${saved.name}» сохранена.`);
              }}
              onReset={async (id) => {
                await window.api.resetRole(id);
                setRoles(await window.api.listRoles());
                setEditing(null);
                setNote("Роль возвращена к исходной.");
              }}
            />
          )}
        </div>
      )}

      {tab === "phone" && (
        <div className="panel-section">
          <section className="vs-block">
            <h3>Те же роли с телефона</h3>
            <p className="vs-hint">
              Компьютер отдаёт телефону страницу с теми же ролями, разговорами и переговорками.
              Считает при этом компьютер: телефон ничего не хранит и работает, только пока компьютер
              включён и оба устройства в одной сети — домашний Wi-Fi или раздача с телефона.
            </p>
            {phone && (
              <>
                <p>
                  Состояние:{" "}
                  <b>{phone.running ? "работает" : "выключено"}</b>
                  {phone.devices > 0 && ` · подключено устройств: ${phone.devices}`}
                </p>
                {phone.running && (
                  <>
                    <p>
                      Откройте на телефоне любой из адресов:
                      {phone.addresses.length === 0 && " (сеть не найдена — компьютер не подключён к Wi-Fi?)"}
                    </p>
                    <ul className="vs-hint">
                      {phone.addresses.map((a) => (
                        <li key={a.url}>
                          <b>{a.url}</b> — {a.name}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Код доступа: <b className="brw-code">{phone.code}</b>
                    </p>
                  </>
                )}
                <div className="brw-composer-row">
                  {phone.running ? (
                    <button
                      className="btn btn-secondary btn-small"
                      onClick={async () => setPhone(await window.api.phoneStop())}
                    >
                      Выключить
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary btn-small"
                      onClick={async () => {
                        setError("");
                        try {
                          setPhone(await window.api.phoneStart(phonePort));
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                          await loadPhone();
                        }
                      }}
                    >
                      Включить
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={async () => setPhone(await window.api.phoneNewCode())}
                  >
                    Новый код
                  </button>
                  <label className="brw-check">
                    порт
                    <input
                      type="number"
                      className="brw-port"
                      value={phonePort}
                      onChange={(e) => setPhonePort(Number(e.target.value))}
                    />
                  </label>
                </div>
                {phone.error && <p className="vs-warn">{phone.error}</p>}
              </>
            )}
            <p className="vs-hint">
              Код нужен при каждом входе с нового телефона, после десяти неверных попыток вход
              закрывается на минуту, а «Новый код» отключает уже вошедшие устройства. Пробрасывать этот
              порт в интернет нельзя: страница рассчитана на домашнюю сеть, а за ней — ваши проекты и
              оплаченный доступ к моделям.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

/** Правка роли: то, чем один специалист отличается от другого. */
function RoleEditor({
  role,
  onClose,
  onSaved,
  onReset,
}: {
  role: RoleModel;
  onClose: () => void;
  onSaved: (role: RoleModel) => void | Promise<void>;
  onReset: (id: string) => void | Promise<void>;
}) {
  // Состояние заводится от роли один раз: список выше пересоздаёт редактор с
  // новым key, когда открывают другую роль, — поэтому синхронизировать его
  // эффектом не нужно.
  const [draft, setDraft] = useState<RoleModel>(role);
  const [error, setError] = useState("");

  async function save() {
    if (!draft.name.trim()) {
      setError("У роли должно быть название.");
      return;
    }
    if (!draft.prompt.trim()) {
      setError("Опишите, как эта роль работает, — иначе она ничем не отличается от обычного чата.");
      return;
    }
    try {
      const saved = await window.api.saveRole({ ...draft, id: draft.id || draft.name });
      await onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="vs-block brw-editor">
      <h3>{draft.id ? `Роль: ${role.name}` : "Новая роль"}</h3>
      {error && <p className="vs-warn">{error}</p>}
      <div className="brw-editor-row">
        <label>
          Значок
          <input
            className="brw-emoji-input"
            value={draft.emoji}
            onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
          />
        </label>
        <label>
          Название
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          Цвет
          <input
            type="color"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
          />
        </label>
      </div>
      <label>
        Чем занимается — одной строкой
        <input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
      </label>
      <label>
        Модель для этой роли
        <input
          placeholder="пусто — модель из общих настроек"
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
        />
      </label>
      <label className="brw-check">
        <input type="checkbox" checked={draft.web} onChange={(e) => setDraft({ ...draft, web: e.target.checked })} />
        разрешён поиск в интернете
      </label>
      <label>
        Как эта роль работает
        <textarea
          rows={14}
          value={draft.prompt}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          placeholder="С чего начинает, в каком порядке думает, что выдаёт на выходе, чего не делает никогда."
        />
      </label>
      <div className="brw-composer-row">
        <button className="btn btn-primary btn-small" onClick={save}>
          Сохранить
        </button>
        <button className="btn btn-secondary btn-small" onClick={onClose}>
          Отмена
        </button>
        {role.builtIn && role.edited && (
          <button className="link-btn" onClick={() => onReset(role.id)}>
            Вернуть как было
          </button>
        )}
      </div>
    </section>
  );
}
