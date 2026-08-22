import { useEffect, useState } from "react";
import type { Brand, Conversation, DocMeta, Project, Settings, Skill } from "../lib/types";
import { DEFAULT_BRAND } from "../lib/types";
import { uid } from "../lib/promptBuilder";
import type { BrandKit } from "../lib/exportHtml";
import ChatView from "./ChatView";

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
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [docError, setDocError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [brandDraft, setBrandDraft] = useState<Brand>(project.brand ?? DEFAULT_BRAND);
  const [brandKit, setBrandKit] = useState<BrandKit | undefined>(undefined);

  useEffect(() => {
    setInstructionsDraft(project.instructions);
    setNameDraft(project.name);
    setDescDraft(project.description);
    setTab("chat");
    loadConversations(project.id);
    loadDocs(project.id);
  }, [project.id]);

  useEffect(() => {
    window.api.buildSystemPrompt(project.id).then(setSystemPrompt);
  }, [project.id, project.instructions, project.skillIds, project.externalDocsPath, docs, tab]);

  useEffect(() => {
    window.api.listExternalDocs(project.id).then(setExternalDocs);
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
      const [logoDataUrl, qrDataUrl] = await Promise.all([
        brand.logoPath ? window.api.readFileAsDataUrl(brand.logoPath) : Promise.resolve(undefined),
        brand.qrPath ? window.api.readFileAsDataUrl(brand.qrPath) : Promise.resolve(undefined),
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
            {activeConv ? (
              <ChatView
                conversation={activeConv}
                systemPrompt={systemPrompt}
                settings={settings}
                onUpdate={updateConversationLocal}
                onSave={(conv) => window.api.saveConversation(project.id, conv)}
                projectId={project.id}
                brand={brandKit}
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
          {project.externalDocsPath && (
            <ul className="doc-list">
              {externalDocs.length === 0 && (
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

          {brandKit && (brandKit.companyName || brandKit.logoDataUrl || brandKit.qrDataUrl) && (
            <>
              <h3>Предпросмотр шапки документа</h3>
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
