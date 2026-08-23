import { useEffect, useState } from "react";
import type { Brand, Conversation, DocMeta, Project, ScheduledTask, Settings, Skill, TaskRecurrence } from "../lib/types";
import { DEFAULT_BRAND } from "../lib/types";
import { uid } from "../lib/promptBuilder";
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
  const [instructionsDraft, setInstructionsDraft] = useState(project.instructions);
  const [nameDraft, setNameDraft] = useState(project.name);
  const [descDraft, setDescDraft] = useState(project.description);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [externalDocs, setExternalDocs] = useState<DocMeta[]>([]);
  const [externalDocsError, setExternalDocsError] = useState<string | null>(null);
  const [showSystemPromptPreview, setShowSystemPromptPreview] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [brandDraft, setBrandDraft] = useState<Brand>(project.brand ?? DEFAULT_BRAND);
  const [brandKit, setBrandKit] = useState<BrandKit | undefined>(undefined);
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(emptyTaskDraft);

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
  }, [project.id]);

  useEffect(() => {
    return window.api.onTaskRan((payload) => {
      if (payload.projectId !== project.id) return;
      setTasks((prev) => prev.map((t) => (t.id === payload.task.id ? payload.task : t)));
      loadConversations(project.id);
    });
  }, [project.id]);

  useEffect(() => {
    window.api.buildSystemPrompt(project.id).then(setSystemPrompt);
  }, [project.id, project.instructions, project.skillIds, project.externalDocsPath, docs, tab]);

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

  async function newConversation() {
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

            <div className="conv-list-section-header conv-list-section-header-chats">
              <h4>Чаты</h4>
            </div>
            <button className="btn btn-primary btn-block" onClick={newConversation}>
              + Новый чат
            </button>
            {conversations.map((c) => (
              <div key={c.id} className={c.id === activeConvId ? "conv-item active" : "conv-item"}>
                <span onClick={() => setActiveConvId(c.id)}>{c.title}</span>
                <button className="conv-delete" onClick={() => removeConversation(c.id)} title="Удалить">
                  ×
                </button>
              </div>
            ))}
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
            {activeConv ? (
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
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.name}>
                <span className="doc-name">{d.name}</span>
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
          {project.externalDocsPath && (
            <ul className="doc-list">
              {externalDocs.length === 0 && !externalDocsError && (
                <p className="hint">В папке не найдено файлов поддерживаемых форматов.</p>
              )}
              {externalDocs.map((d) => (
                <li key={d.name}>
                  <span className="doc-name">{d.name}</span>
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
