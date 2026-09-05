import { useEffect, useState } from "react";
import type { Brand, Conversation, DesignSystemFile, DocMeta, Project, ProjectProfile, ScheduledTask, Settings, Skill, TaskRecurrence, TaskRunSummary } from "../lib/types";
import { DEFAULT_BRAND } from "../lib/types";
import { uid } from "../lib/promptBuilder";
import { streamChat } from "../lib/api";
import type { BrandKit } from "../lib/exportHtml";
import ChatView from "./ChatView";

const WEEKDAY_NAMES = ["воскресеньям", "понедельникам", "вторникам", "средам", "четвергам", "пятницам", "субботам"];

interface TaskDraft {
  title: string;
  prompt: string;
  recurrence: TaskRecurrence;
  time: string;
  date: string;
  weekday: number;
}

const emptyTaskDraft: TaskDraft = { title: "", prompt: "", recurrence: "once", time: "09:00", date: "", weekday: 1 };

function describeTaskSchedule(t: ScheduledTask): string {
  if (t.recurrence === "daily") return `Каждый день в ${t.time}`;
  if (t.recurrence === "weekly") return `По ${WEEKDAY_NAMES[t.weekday ?? 1]} в ${t.time}`;
  if (!t.enabled && t.lastRunAt) return `Выполнена ${new Date(t.lastRunAt).toLocaleString("ru-RU")}`;
  return t.date ? `${t.date} в ${t.time}` : t.time;
}

interface Props {
  project: Project;
  skills: Skill[];
  settings: Settings;
  onProjectChange: (p: Project) => void;
  onOpenSettings: () => void;
}

type Tab = "chat" | "instructions" | "docs" | "skills" | "brand";

export default function ProjectPanel({ project, skills, settings, onProjectChange, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [convRenameDraft, setConvRenameDraft] = useState("");
  const [instructionsDraft, setInstructionsDraft] = useState(project.instructions);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [descDraft, setDescDraft] = useState(project.description);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [externalDocs, setExternalDocs] = useState<DocMeta[]>([]);
  const [externalDocsError, setExternalDocsError] = useState<string | null>(null);
  const [showSystemPromptPreview, setShowSystemPromptPreview] = useState(false);
  const [designSystemFiles, setDesignSystemFiles] = useState<DesignSystemFile[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [brandDraft, setBrandDraft] = useState<Brand>(project.brand ?? DEFAULT_BRAND);
  const [brandKit, setBrandKit] = useState<BrandKit | undefined>(undefined);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTaskDraft);
  /**
   * Выдачи задач по расписанию — отдельно от чатов.
   *
   * Задача выполняется сама и каждую неделю: раньше её результаты падали в общий
   * список чатов и вытесняли оттуда те разговоры, которые человек вёл руками.
   */
  const [taskRuns, setTaskRuns] = useState<TaskRunSummary[]>([]);
  const [openRun, setOpenRun] = useState<Conversation | null>(null);
  /**
   * Резюме проекта. Нужно разделам, у которых своего проекта нет (Word, Excel,
   * визуализация, клининг): по нему они понимают сферу работы человека, не
   * перечитывая всю базу знаний — и не опираясь на примеры, вшитые в код.
   */
  const [profile, setProfile] = useState<{ profile: ProjectProfile | null; stale: boolean } | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    setInstructionsDraft(project.instructions);
    setNameDraft(project.name);
    setDescDraft(project.description);
    setTab("chat");
    setShowTaskForm(false);
    setTaskDraft(emptyTaskDraft);
    loadConversations(project.id);
    loadDocs(project.id);
    loadTasks(project.id);
    setOpenRun(null);
    window.api.listTaskRuns(project.id).then(setTaskRuns).catch(() => setTaskRuns([]));
    loadProfile();
  }, [project.id]);

  useEffect(() => {
    return window.api.onTaskRan((payload) => {
      if (payload.projectId !== project.id) return;
      setTasks((prev) => prev.map((t) => (t.id === payload.task.id ? payload.task : t)));
      window.api.listTaskRuns(project.id).then(setTaskRuns).catch(() => setTaskRuns([]));
    });
  }, [project.id]);

  useEffect(() => {
    window.api.buildSystemPrompt(project.id).then(setSystemPrompt);
  }, [project.id, project.instructions, project.skillIds, project.externalDocsPath, project.designSystemPaths, docs, tab]);

  useEffect(() => {
    window.api
      .listDesignSystemFiles(project.id)
      .then(setDesignSystemFiles)
      .catch(() => setDesignSystemFiles([]));
  }, [project.id, project.designSystemPaths]);

  useEffect(() => {
    setExternalDocsError(null);
    window.api
      .listExternalDocs(project.id)
      .then(setExternalDocs)
      .catch((e) => {
        setExternalDocs([]);
        setExternalDocsError(e instanceof Error ? e.message : String(e));
      });
  }, [project.id, project.externalDocsPath]);

  useEffect(() => {
    setBrandDraft(project.brand ?? DEFAULT_BRAND);
    // Deliberately not depending on project.brand here: this only re-initializes the
    // editable draft when switching projects. Depending on project.brand would also
    // reset the draft every time our own saveBrand() echoes back through onProjectChange
    // mid-edit, racing with (and sometimes wiping) whatever field the user just typed
    // into next before that field's own save fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    if (!project.brand) {
      setBrandKit(undefined);
      return;
    }
    const brand = project.brand;
    (async () => {
      const [logoDataUrl, qrDataUrl, headerImageDataUrl] = await Promise.all([
        brand.logoPath ? window.api.readFileAsDataUrl(brand.logoPath) : Promise.resolve(undefined),
        brand.qrPath ? window.api.readFileAsDataUrl(brand.qrPath) : Promise.resolve(undefined),
        brand.headerImagePath ? window.api.readFileAsDataUrl(brand.headerImagePath) : Promise.resolve(undefined),
      ]);
      setBrandKit({
        companyName: brand.companyName,
        tagline: brand.tagline,
        accentColor: brand.accentColor,
        footerText: brand.footerText,
        logoDataUrl,
        qrDataUrl,
        contactPhone: brand.contactPhone,
        contactEmail: brand.contactEmail,
        headerImageDataUrl,
      });
    })();
  }, [project.brand]);

  async function loadConversations(projectId: string) {
    const list = await window.api.listConversations(projectId);
    setConversations(list);
    setActiveConvId(list[0]?.id ?? null);
  }

  async function loadDocs(projectId: string) {
    setDocs(await window.api.listDocs(projectId));
  }

  async function loadTasks(projectId: string) {
    setTasks(await window.api.listTasks(projectId));
  }

  async function createTask() {
    if (!taskDraft.title.trim() || !taskDraft.prompt.trim()) return;
    if (taskDraft.recurrence === "once" && !taskDraft.date) return;
    const saved = await window.api.saveTask(project.id, {
      title: taskDraft.title.trim(),
      prompt: taskDraft.prompt.trim(),
      recurrence: taskDraft.recurrence,
      time: taskDraft.time,
      date: taskDraft.recurrence === "once" ? taskDraft.date : undefined,
      weekday: taskDraft.recurrence === "weekly" ? taskDraft.weekday : undefined,
      enabled: true,
    });
    setTasks((prev) => [...prev, saved].sort((a, b) => a.createdAt - b.createdAt));
    setTaskDraft(emptyTaskDraft);
    setShowTaskForm(false);
  }

  async function toggleTaskEnabled(t: ScheduledTask) {
    const updated = await window.api.saveTask(project.id, { ...t, enabled: !t.enabled });
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function removeTask(id: string) {
    if (!confirm("Удалить задачу?")) return;
    await window.api.deleteTask(project.id, id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function loadProfile() {
    setProfile(await window.api.readProjectProfile(project.id).catch(() => null));
  }

  /**
   * Пересобирает резюме — это отдельный запрос к модели, поэтому только по кнопке.
   * Молча тратить деньги на фоновую сборку приложение не должно.
   */
  async function rebuildProfile() {
    setProfileBusy(true);
    try {
      const request = await window.api.buildProfileRequest(project.id);
      const answer = await streamChat(
        settings,
        [{ role: "user", content: request }],
        () => {},
        undefined,
        undefined
      );
      setProfile({ profile: await window.api.saveProjectProfile(project.id, answer), stale: false });
    } catch (e) {
      alert(`Не удалось собрать профиль: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProfileBusy(false);
    }
  }

  async function newConversation() {
    setOpenRun(null);
    const conv: Conversation = {
      id: uid(),
      projectId: project.id,
      title: "Новый чат",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await window.api.saveConversation(project.id, conv);
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setTab("chat");
  }

  function startConvRename(conv: Conversation) {
    setRenamingConvId(conv.id);
    setConvRenameDraft(conv.title);
  }

  /**
   * Saves a renamed chat. The title is part of the conversation file, so this is an
   * ordinary save — and because ChatView only auto-titles chats still called
   * "Новый чат", a rename sticks even if the chat is used again afterwards.
   */
  async function commitConvRename(conv: Conversation) {
    const title = convRenameDraft.trim();
    setRenamingConvId(null);
    if (!title || title === conv.title) return;
    const updated = await window.api.saveConversation(project.id, { ...conv, title, updatedAt: Date.now() });
    updateConversationLocal(updated);
  }

  async function removeConversation(id: string) {
    if (!confirm("Удалить этот чат?")) return;
    await window.api.deleteConversation(project.id, id);
    const rest = conversations.filter((c) => c.id !== id);
    setConversations(rest);
    if (activeConvId === id) setActiveConvId(rest[0]?.id ?? null);
  }

  function updateConversationLocal(conv: Conversation) {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conv.id);
      const next = idx === -1 ? [conv, ...prev] : prev.map((c) => (c.id === conv.id ? conv : c));
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async function saveHeader() {
    const updated = await window.api.updateProject(project.id, {
      name: nameDraft.trim() || project.name,
      description: descDraft,
    });
    onProjectChange(updated);
  }

  async function saveInstructions() {
    const updated = await window.api.updateProject(project.id, { instructions: instructionsDraft });
    onProjectChange(updated);
  }

  async function handlePickFiles() {
    setDocError(null);
    const paths = await window.api.pickFiles();
    if (paths.length === 0) return;
    try {
      const updatedDocs = await window.api.addDocsFromPaths(project.id, paths);
      setDocs(updatedDocs);
    } catch (e) {
      setDocError(e instanceof Error ? e.message : String(e));
    }
  }

  const excludedDocs = project.excludedDocs ?? [];

  /**
   * Переключает документ «в контексте / не в контексте». Сохраняем сразу: это
   * влияет на каждый следующий запрос, и держать это несохранённым в форме было бы
   * источником недоразумений.
   */
  async function toggleDocInContext(key: string) {
    const next = excludedDocs.includes(key)
      ? excludedDocs.filter((k) => k !== key)
      : [...excludedDocs, key];
    onProjectChange(await window.api.updateProject(project.id, { excludedDocs: next }));
  }

  async function removeDoc(fileName: string) {
    const updatedDocs = await window.api.removeDoc(project.id, fileName);
    setDocs(updatedDocs);
  }

  async function addPasted() {
    if (!pasteText.trim()) return;
    const updatedDocs = await window.api.addPastedDoc(project.id, pasteTitle.trim() || "Вставленный текст", pasteText);
    setDocs(updatedDocs);
    setPasteText("");
    setPasteTitle("");
  }

  async function toggleSkill(skillId: string) {
    const has = project.skillIds.includes(skillId);
    const nextIds = has ? project.skillIds.filter((id) => id !== skillId) : [...project.skillIds, skillId];
    const updated = await window.api.updateProject(project.id, { skillIds: nextIds });
    onProjectChange(updated);
  }

  async function openFolder() {
    await window.api.openProjectFolder(project.id);
  }

  async function saveBrand() {
    const updated = await window.api.updateProject(project.id, { brand: brandDraft });
    onProjectChange(updated);
  }

  async function pickLogo() {
    const filePath = await window.api.pickBrandLogo();
    if (!filePath) return;
    const updated = await window.api.saveProjectBrandLogo(project.id, filePath);
    onProjectChange(updated);
  }

  async function pickQr() {
    const filePath = await window.api.pickBrandQr();
    if (!filePath) return;
    const updated = await window.api.saveProjectBrandQr(project.id, filePath);
    onProjectChange(updated);
  }

  async function pickHeaderImage() {
    const filePath = await window.api.pickBrandHeaderImage();
    if (!filePath) return;
    const updated = await window.api.saveProjectBrandHeaderImage(project.id, filePath);
    onProjectChange(updated);
  }

  async function clearHeaderImage() {
    const updated = await window.api.clearProjectBrandHeaderImage(project.id);
    onProjectChange(updated);
  }

  async function addDesignSystemFiles() {
    const paths = await window.api.pickDesignSystemFiles();
    if (paths.length === 0) return;
    onProjectChange(await window.api.addDesignSystemPaths(project.id, paths));
  }

  async function addDesignSystemFolder() {
    const folder = await window.api.pickDesignSystemFolder();
    if (!folder) return;
    onProjectChange(await window.api.addDesignSystemPaths(project.id, [folder]));
  }

  async function removeDesignSystemPath(target: string) {
    onProjectChange(await window.api.removeDesignSystemPath(project.id, target));
  }

  async function pickExternalDocsFolder() {
    const folderPath = await window.api.pickExternalDocsFolder();
    if (!folderPath) return;
    const updated = await window.api.setProjectExternalDocsFolder(project.id, folderPath);
    onProjectChange(updated);
  }

  async function clearExternalDocsFolder() {
    const updated = await window.api.setProjectExternalDocsFolder(project.id, null);
    onProjectChange(updated);
  }

  const activeConv = conversations.find((c) => c.id === activeConvId);

  return (
    <div className="project-panel">
      <div className="project-header">
        <div>
          <h2>{project.name}</h2>
          {project.description && <p className="project-desc">{project.description}</p>}
        </div>
        <div className="project-tabs">
          <button className={tab === "chat" ? "tab active" : "tab"} onClick={() => setTab("chat")}>
            Чат
          </button>
          <button className={tab === "instructions" ? "tab active" : "tab"} onClick={() => setTab("instructions")}>
            Инструкции
          </button>
          <button className={tab === "docs" ? "tab active" : "tab"} onClick={() => setTab("docs")}>
            Документы ({docs.length})
          </button>
          <button className={tab === "skills" ? "tab active" : "tab"} onClick={() => setTab("skills")}>
            Навыки ({project.skillIds.length})
          </button>
          <button className={tab === "brand" ? "tab active" : "tab"} onClick={() => setTab("brand")}>
            Дизайн
          </button>
          <button className="link-btn folder-link" onClick={openFolder}>
            📁 Открыть папку проекта
          </button>
        </div>
      </div>

      {tab === "chat" && (
        <div className="chat-layout">
          <div className="conv-list">
            <div className="conv-list-section-header">
              <h4>Задачи</h4>
              <button className="link-btn" onClick={() => setShowTaskForm((v) => !v)}>
                {showTaskForm ? "Отмена" : "+ Задача"}
              </button>
            </div>
            {showTaskForm && (
              <div className="task-form">
                <input
                  placeholder="Название задачи"
                  value={taskDraft.title}
                  onChange={(e) => setTaskDraft((d) => ({ ...d, title: e.target.value }))}
                />
                <textarea
                  placeholder="Что должен сделать ассистент"
                  value={taskDraft.prompt}
                  onChange={(e) => setTaskDraft((d) => ({ ...d, prompt: e.target.value }))}
                  rows={3}
                />
                <select
                  value={taskDraft.recurrence}
                  onChange={(e) => setTaskDraft((d) => ({ ...d, recurrence: e.target.value as TaskRecurrence }))}
                >
                  <option value="once">Один раз</option>
                  <option value="daily">Каждый день</option>
                  <option value="weekly">Каждую неделю</option>
                </select>
                {taskDraft.recurrence === "once" && (
                  <input
                    type="date"
                    value={taskDraft.date}
                    onChange={(e) => setTaskDraft((d) => ({ ...d, date: e.target.value }))}
                  />
                )}
                {taskDraft.recurrence === "weekly" && (
                  <select
                    value={taskDraft.weekday}
                    onChange={(e) => setTaskDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}
                  >
                    {WEEKDAY_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="time"
                  value={taskDraft.time}
                  onChange={(e) => setTaskDraft((d) => ({ ...d, time: e.target.value }))}
                />
                <button
                  className="btn btn-primary btn-block"
                  onClick={createTask}
                  disabled={
                    !taskDraft.title.trim() || !taskDraft.prompt.trim() || (taskDraft.recurrence === "once" && !taskDraft.date)
                  }
                >
                  Создать задачу
                </button>
              </div>
            )}
            {tasks.length === 0 && !showTaskForm && <p className="hint task-empty-hint">Нет задач по времени.</p>}
            {tasks.map((t) => (
              <div key={t.id} className="task-item">
                <label className="task-item-main">
                  <input type="checkbox" checked={t.enabled} onChange={() => toggleTaskEnabled(t)} />
                  <span className="task-item-text">
                    <span className="task-title">{t.title}</span>
                    <span className="task-meta">{describeTaskSchedule(t)}</span>
                  </span>
                </label>
                <button className="conv-delete" onClick={() => removeTask(t.id)} title="Удалить">
                  ×
                </button>
              </div>
            ))}

            {taskRuns.length > 0 && (
              <>
                <div className="conv-list-section-header">
                  <h4>Выполнено по расписанию</h4>
                </div>
                {taskRuns.map((run) => (
                  <div key={run.id} className="task-run-item">
                    <button
                      className="task-run-open"
                      onClick={async () => setOpenRun(await window.api.readTaskRun(project.id, run.id))}
                      title={run.preview}
                    >
                      <span className="task-title">{run.title}</span>
                      <span className="task-meta">
                        {new Date(run.createdAt).toLocaleString("ru-RU", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </button>
                    <button
                      className="conv-delete"
                      onClick={async () => {
                        setTaskRuns(await window.api.deleteTaskRun(project.id, run.id));
                        setOpenRun((cur) => (cur && cur.id === run.id ? null : cur));
                      }}
                      title="Удалить выдачу"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}

            <div className="conv-list-section-header conv-list-section-header-chats">
              <h4>Чаты</h4>
            </div>
            <button className="btn btn-primary btn-block" onClick={newConversation}>
              + Новый чат
            </button>
            {conversations.map((c) =>
              renamingConvId === c.id ? (
                <input
                  key={c.id}
                  className="sidebar-item-rename-input"
                  value={convRenameDraft}
                  autoFocus
                  onChange={(e) => setConvRenameDraft(e.target.value)}
                  onBlur={() => commitConvRename(c)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitConvRename(c);
                    if (e.key === "Escape") setRenamingConvId(null);
                  }}
                />
              ) : (
                <div key={c.id} className={c.id === activeConvId ? "conv-item active" : "conv-item"}>
                  <span onClick={() => setActiveConvId(c.id)}>{c.title}</span>
                  <button className="conv-rename" onClick={() => startConvRename(c)} title="Переименовать чат">
                    ✎
                  </button>
                  <button className="conv-delete" onClick={() => removeConversation(c.id)} title="Удалить">
                    ×
                  </button>
                </div>
              )
            )}
          </div>
          <div className="conv-main">
            {!settings.apiKey && (
              <div className="warning-banner">
                API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
              </div>
            )}
            <div className="system-prompt-preview-bar">
              <button className="link-btn" onClick={() => setShowSystemPromptPreview((v) => !v)}>
                {showSystemPromptPreview ? "Скрыть" : "Что видит ассистент"} ({systemPrompt.length.toLocaleString("ru-RU")}{" "}
                симв.)
              </button>
              {/* Порог примерно в 30 тысяч токенов: дальше задержка до первого слова
                  становится заметной на глаз, и это стоит показать причиной, а не
                  оставлять догадываться. */}
              {systemPrompt.length > 90000 && (
                <span className="hint context-warn">
                  Это много — модель перечитывает всё это перед каждым ответом, отсюда пауза. Снимите
                  галочки с документов, которые не нужны в этом проекте постоянно (вкладка «Документы»).
                </span>
              )}
            </div>
            {showSystemPromptPreview && (
              <div className="system-prompt-preview">
                <p className="hint">
                  Это ровно тот системный промпт (инструкции + навыки + документы), который сейчас уходит модели
                  вместе с каждым сообщением в этом проекте — если документ или навык не следует, в первую очередь
                  проверьте, попал ли он сюда.
                </p>
                <pre>{systemPrompt || "(пусто)"}</pre>
              </div>
            )}
            {openRun ? (
              <div className="task-run-view">
                <div className="task-run-view-header">
                  <strong>{openRun.title}</strong>
                  <span className="hint">
                    {new Date(openRun.createdAt).toLocaleString("ru-RU")}
                  </span>
                  <button className="link-btn" onClick={() => setOpenRun(null)}>
                    закрыть
                  </button>
                </div>
                {openRun.messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "msg msg-user" : "msg msg-assistant"}>
                    <div className="msg-role">{m.role === "user" ? "Задание" : "Результат"}</div>
                    <div className="msg-content">{m.content}</div>
                  </div>
                ))}
              </div>
            ) : activeConv ? (
              <ChatView
                conversation={activeConv}
                systemPrompt={systemPrompt}
                settings={settings}
                onUpdate={updateConversationLocal}
                onSave={(conv) => window.api.saveConversation(project.id, conv)}
                projectId={project.id}
                brand={brandKit}
                skills={skills}
              />
            ) : (
              <div className="chat-empty-hint">Нет активного чата. Нажмите «+ Новый чат».</div>
            )}
          </div>
        </div>
      )}

      {tab === "instructions" && (
        <div className="panel-section">
          <div className="profile-box">
            <div className="profile-box-head">
              <strong>Профиль проекта</strong>
              {profile?.profile && profile.stale && <span className="docflow-badge docflow-badge-warn">устарел</span>}
              <button className="btn btn-secondary btn-small" onClick={rebuildProfile} disabled={profileBusy}>
                {profileBusy ? "Собираю…" : profile?.profile ? "Пересобрать" : "Собрать"}
              </button>
            </div>
            <p className="hint">
              Короткое резюме того, что вы внесли в этот проект. По нему разделы Word, Excel, визуализации,
              клининга и документооборота понимают, чем вы занимаетесь, — не перечитывая всю базу знаний и
              не опираясь на примеры, вшитые в приложение. Собирается одним запросом к модели по кнопке.
            </p>
            {profile?.profile ? (
              <div className="profile-body">
                <div>
                  <b>Чем занимается:</b> {profile.profile.чем_занимается || "—"}
                </div>
                <div>
                  <b>О чём проект:</b> {profile.profile.о_чём_проект || "—"}
                </div>
                {profile.profile.ключевые_сущности.length > 0 && (
                  <div>
                    <b>Ключевое:</b> {profile.profile.ключевые_сущности.join(", ")}
                  </div>
                )}
                {profile.profile.как_принято_называть && (
                  <div>
                    <b>Именование:</b> {profile.profile.как_принято_называть}
                  </div>
                )}
                <div className="hint">
                  Обновлён {new Date(profile.profile.updatedAt).toLocaleString("ru-RU")}
                  {profile.stale && " · с тех пор проект изменился"}
                </div>
              </div>
            ) : (
              <p className="hint">Профиль ещё не собран — другие разделы про этот проект ничего не знают.</p>
            )}
          </div>

          <label>Название проекта</label>
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={saveHeader} />
          <label>Описание</label>
          <input value={descDraft} onChange={(e) => setDescDraft(e.target.value)} onBlur={saveHeader} />
          <label>Системная инструкция (роль, стиль, правила для ассистента в этом проекте)</label>
          <textarea
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            onBlur={saveInstructions}
            rows={16}
          />
          <p className="hint">Изменения сохраняются автоматически при потере фокуса поля.</p>
        </div>
      )}

      {tab === "docs" && (
        <div className="panel-section">
          <p className="hint">
            Документы хранятся как обычные файлы в папке проекта на вашем компьютере (кнопка «Открыть папку проекта»
            выше) — их можно добавлять и через это окно, и просто перетаскивая файлы в папку docs.
          </p>
          <button className="btn btn-secondary" onClick={handlePickFiles}>
            Выбрать файлы (.txt, .md, .csv, .json, .docx)
          </button>
          {docError && <div className="chat-error">{docError}</div>}

          <label>Или сохранить вставленный текст как документ</label>
          <input
            placeholder="Название документа"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
          />
          <textarea
            placeholder="Текст документа…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
          />
          <button className="btn btn-secondary" onClick={addPasted} disabled={!pasteText.trim()}>
            Добавить документ
          </button>

          <h3>Документы проекта</h3>
          {docs.length === 0 && <p className="hint">Пока нет документов.</p>}
          {docs.length > 0 && (
            <p className="hint">
              Галочка — «отдавать ассистенту в каждом сообщении». Документы без галочки остаются в
              проекте, но не уходят в запрос: чем меньше уезжает, тем быстрее начинается ответ.
            </p>
          )}
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.name}>
                <input
                  type="checkbox"
                  className="doc-include"
                  checked={!excludedDocs.includes(`docs/${d.name}`)}
                  onChange={() => toggleDocInContext(`docs/${d.name}`)}
                  title="Отдавать ассистенту"
                />
                <span className={excludedDocs.includes(`docs/${d.name}`) ? "doc-name doc-name-off" : "doc-name"}>
                  {d.name}
                </span>
                <span className="doc-size">{(d.size / 1024).toFixed(1)} КБ</span>
                <button className="conv-delete" onClick={() => removeDoc(d.name)} title="Удалить">
                  ×
                </button>
              </li>
            ))}
          </ul>

          <h3>Папка на компьютере</h3>
          <p className="hint">
            Вместо копирования файлов можно один раз указать папку на вашем компьютере — ассистент будет читать
            документы прямо из неё, файлы никуда не копируются, и изменения в них подхватываются автоматически при
            следующем обращении к проекту.
          </p>
          <div className="folder-row">
            {project.externalDocsPath ? (
              <span className="folder-path">{project.externalDocsPath}</span>
            ) : (
              <span className="hint">Папка не выбрана.</span>
            )}
            <button className="btn btn-secondary" onClick={pickExternalDocsFolder}>
              {project.externalDocsPath ? "Сменить папку" : "Выбрать папку"}
            </button>
            {project.externalDocsPath && (
              <button className="btn btn-danger" onClick={clearExternalDocsFolder}>
                Отключить
              </button>
            )}
          </div>
          {externalDocsError && <div className="chat-error">{externalDocsError}</div>}
          {project.externalDocsPath && externalDocs.length > 0 && (
            <p className="hint">
              Галочки работают так же, как у документов проекта: снятый документ остаётся в папке, но
              не уходит в каждый запрос. Внешняя папка обычно и есть самая большая часть контекста.
            </p>
          )}
          {project.externalDocsPath && (
            <ul className="doc-list">
              {externalDocs.length === 0 && !externalDocsError && (
                <p className="hint">В папке не найдено файлов поддерживаемых форматов.</p>
              )}
              {externalDocs.map((d) => (
                <li key={d.name}>
                  <input
                    type="checkbox"
                    className="doc-include"
                    checked={!excludedDocs.includes(`external/${d.name}`)}
                    onChange={() => toggleDocInContext(`external/${d.name}`)}
                    title="Отдавать ассистенту"
                  />
                  <span className={excludedDocs.includes(`external/${d.name}`) ? "doc-name doc-name-off" : "doc-name"}>
                    {d.name}
                  </span>
                  <span className="doc-size">{(d.size / 1024).toFixed(1)} КБ</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "brand" && (
        <div className="panel-section">
          <p className="hint">
            Фирменный стиль проекта: логотип и цвет применяются автоматически к экспортированным документам (PDF/PNG)
            и графикам в чате этого проекта — шапка с логотипом сверху, акцентный цвет в заголовках и таблицах.
          </p>

          <h3>Дизайн-система проекта</h3>
          <p className="hint">
            Привяжите к проекту дизайн-систему, которая уже сохранена у вас на компьютере — файлом или целой
            папкой. Файлы никуда не копируются: приложение читает их прямо оттуда при каждом обращении, поэтому
            правки в исходниках подхватываются сами. Текстовые файлы (описание системы, правила, токены, .svg)
            ассистент читает целиком, картинки и прочие бинарные файлы — видит по названиям. Это учитывается и в
            чате проекта, и в разделе «🖌️ Дизайн».
          </p>
          <div className="folder-row">
            <button className="btn btn-secondary" onClick={addDesignSystemFiles}>
              Выбрать файлы
            </button>
            <button className="btn btn-secondary" onClick={addDesignSystemFolder}>
              Выбрать папку
            </button>
          </div>
          {(project.designSystemPaths ?? []).length === 0 ? (
            <p className="hint">Дизайн-система не привязана.</p>
          ) : (
            <ul className="doc-list">
              {(project.designSystemPaths ?? []).map((p) => (
                <li key={p}>
                  <span className="doc-name">{p}</span>
                  <button className="conv-delete" onClick={() => removeDesignSystemPath(p)} title="Отвязать">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {designSystemFiles.length > 0 && (
            <p className="hint">
              Читается файлов: {designSystemFiles.filter((f) => !f.missing).length}
              {designSystemFiles.some((f) => f.missing) && (
                <> · не найдено: {designSystemFiles.filter((f) => f.missing).map((f) => f.name).join(", ")}</>
              )}
            </p>
          )}

          <h3>Шапка документа</h3>
          <p className="hint">
            Два варианта на выбор: собрать шапку из полей ниже (логотип/название/слоган/контакты/QR), либо один раз
            загрузить уже готовую шапку целиком одной картинкой — тогда она используется как есть, поля ниже на саму
            шапку не влияют (но акцентный цвет и подвал документа продолжают применяться).
          </p>
          {brandKit?.headerImageDataUrl ? (
            <>
              <img src={brandKit.headerImageDataUrl} alt="" className="brand-header-image-preview" />
              <div className="folder-row">
                <button className="btn btn-secondary" onClick={pickHeaderImage}>
                  Заменить картинку
                </button>
                <button className="btn btn-danger" onClick={clearHeaderImage}>
                  Убрать — собирать шапку из полей
                </button>
              </div>
            </>
          ) : (
            <div className="folder-row">
              <button className="btn btn-secondary" onClick={pickHeaderImage}>
                Загрузить готовую шапку целиком
              </button>
            </div>
          )}

          <label>Название компании / бренда</label>
          <input
            value={brandDraft.companyName}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, companyName: e.target.value }))}
            onBlur={saveBrand}
          />
          <label>Слоган / подзаголовок</label>
          <input
            value={brandDraft.tagline}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, tagline: e.target.value }))}
            onBlur={saveBrand}
          />
          <label>Акцентный цвет</label>
          <input
            type="color"
            value={brandDraft.accentColor}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, accentColor: e.target.value }))}
            onBlur={saveBrand}
          />
          <label>Текст в подвале документов (адрес, контакты, реквизиты)</label>
          <textarea
            value={brandDraft.footerText}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, footerText: e.target.value }))}
            onBlur={saveBrand}
            rows={3}
          />
          <label>Логотип</label>
          <div className="folder-row">
            {project.brand?.logoPath && <span className="hint">Загружен: {project.brand.logoPath.split(/[\\/]/).pop()}</span>}
            <button className="btn btn-secondary" onClick={pickLogo}>
              Выбрать логотип
            </button>
          </div>

          <label>Контактный телефон</label>
          <input
            value={brandDraft.contactPhone ?? ""}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, contactPhone: e.target.value }))}
            onBlur={saveBrand}
            placeholder="+7 900 000-00-00"
          />
          <label>Контактный e-mail</label>
          <input
            value={brandDraft.contactEmail ?? ""}
            onChange={(e) => setBrandDraft((prev) => ({ ...prev, contactEmail: e.target.value }))}
            onBlur={saveBrand}
            placeholder="info@company.ru"
          />
          <label>QR-код</label>
          <p className="hint">
            Если QR-код загружен, он выравнивается по правому краю шапки документа с постоянным отступом, телефон и
            e-mail (если заполнены) размещаются перед ним, а название и слоган компании при этом переходят в центр
            шапки.
          </p>
          <div className="folder-row">
            {project.brand?.qrPath && <span className="hint">Загружен: {project.brand.qrPath.split(/[\\/]/).pop()}</span>}
            <button className="btn btn-secondary" onClick={pickQr}>
              Выбрать QR-код
            </button>
          </div>

          {brandKit && !brandKit.headerImageDataUrl && (brandKit.companyName || brandKit.logoDataUrl || brandKit.qrDataUrl) && (
            <>
              <h3>Предпросмотр шапки документа (собранная из полей)</h3>
              {brandKit.qrDataUrl ? (
                <div className="brand-preview brand-preview-full" style={{ borderColor: brandKit.accentColor }}>
                  <div className="brand-preview-left">
                    {brandKit.logoDataUrl && <img src={brandKit.logoDataUrl} alt="" className="brand-preview-logo" />}
                  </div>
                  <div className="brand-preview-center">
                    {brandKit.companyName && <div className="brand-preview-company">{brandKit.companyName}</div>}
                    {brandKit.tagline && <div className="brand-preview-tagline">{brandKit.tagline}</div>}
                  </div>
                  <div className="brand-preview-right">
                    {(brandKit.contactPhone || brandKit.contactEmail) && (
                      <div className="brand-preview-contacts">
                        {brandKit.contactPhone && <div>{brandKit.contactPhone}</div>}
                        {brandKit.contactEmail && <div>{brandKit.contactEmail}</div>}
                      </div>
                    )}
                    <img src={brandKit.qrDataUrl} alt="QR" className="brand-preview-qr" />
                  </div>
                </div>
              ) : (
                <div className="brand-preview brand-preview-simple" style={{ borderColor: brandKit.accentColor }}>
                  {brandKit.logoDataUrl && <img src={brandKit.logoDataUrl} alt="" className="brand-preview-logo" />}
                  <div>
                    {brandKit.companyName && <div className="brand-preview-company">{brandKit.companyName}</div>}
                    {brandKit.tagline && <div className="brand-preview-tagline">{brandKit.tagline}</div>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "skills" && (
        <div className="panel-section">
          <p className="hint">
            Выберите навыки, которые будут подключены к этому проекту. Их инструкции добавляются в системный промпт.
          </p>
          {skills.length === 0 && <p className="hint">Пока нет ни одного навыка — создайте его в разделе «Навыки».</p>}
          <ul className="skill-toggle-list">
            {skills.map((s) => (
              <li key={s.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={project.skillIds.includes(s.id)}
                    onChange={() => toggleSkill(s.id)}
                  />
                  <span className="skill-name">{s.name}</span>
                  <span className="skill-desc">{s.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
