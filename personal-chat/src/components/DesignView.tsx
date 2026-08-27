import { useEffect, useRef, useState } from "react";
import type {
  Conversation,
  DesignAsset,
  DesignAssetKind,
  DesignDoc,
  DesignProject,
  DesignType,
  Project,
  Settings,
  Skill,
} from "../lib/types";
import { DESIGN_SYNTAX_HINT, parseDesignDraft, uid, type ParsedDesignDraft } from "../lib/promptBuilder";
import { buildDesignExportHtml } from "../lib/exportHtml";
import { sanitizeDesignHtml, sanitizeDesignSvg } from "../lib/sanitizeDesign";
import ChatView from "./ChatView";

interface Props {
  projects: Project[];
  skills: Skill[];
  settings: Settings;
  onOpenSettings: () => void;
}

type Mode = "gallery" | "creator" | "project";

const TYPE_LABELS: Record<DesignType, string> = {
  post: "Пост",
  document: "Документ",
  presentation: "Слайд презентации",
  "design-system": "Дизайн-система",
  website: "Сайт",
  graphic: "Графика (SVG)",
  motion: "Ролик (моушн)",
  other: "Другое",
};

const ASSET_LABELS: Record<DesignAssetKind, string> = {
  logos: "Логотипы",
  fonts: "Фирменные шрифты",
  sources: "Исходники (фото для макетов)",
  references: "Референсы (ориентир по стилю)",
  system: "Части дизайн-системы",
};

const ASSET_HINTS: Record<DesignAssetKind, string> = {
  logos: "Ассистент вставит их в макет как есть.",
  fonts:
    ".ttf/.otf/.woff — им набираются заголовки, шрифт вшивается прямо в экспорт. Если в шрифте нет кириллицы, " +
    "русский текст молча наберётся системным — проверьте на макете.",
  sources: "Фотографии, которые нужно использовать в макетах.",
  references: "Ориентир по стилистике: повторять их ассистент не будет, но будет держать в уме.",
  system: "Текст, CSS или SVG с правилами — цвета, отступы, типографика.",
};

const ASSET_ORDER: DesignAssetKind[] = ["logos", "fonts", "sources", "references", "system"];

function normalizeType(raw: string): DesignType {
  return (Object.keys(TYPE_LABELS) as DesignType[]).includes(raw as DesignType) ? (raw as DesignType) : "other";
}

/**
 * Preview of one design. `projectId` makes it resolve the project's assets, so a
 * card in the gallery shows the real logo rather than a broken image — the stored
 * markup only holds references to them.
 */
function DesignPreview({
  content,
  format,
  projectId,
}: {
  content: string;
  format: "html" | "svg";
  projectId?: string;
}) {
  const [resolved, setResolved] = useState(content);

  useEffect(() => {
    let cancelled = false;
    const needsAssets = projectId && /ASSET:[a-z]+-\d+/i.test(content);
    if (!needsAssets) {
      setResolved(content);
      return;
    }
    window.api.applyDesignAssets(projectId, content).then((html) => {
      if (!cancelled) setResolved(html);
    });
    return () => {
      cancelled = true;
    };
  }, [content, projectId]);

  if (format === "svg") {
    return <div className="design-svg-preview" dangerouslySetInnerHTML={{ __html: sanitizeDesignSvg(resolved) }} />;
  }
  return (
    <iframe sandbox="" srcDoc={sanitizeDesignHtml(resolved)} className="design-html-preview" title="Предпросмотр дизайна" />
  );
}

export default function DesignView({ projects, skills, settings, onOpenSettings }: Props) {
  const [mode, setMode] = useState<Mode>("gallery");
  const [designProjects, setDesignProjects] = useState<DesignProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [docs, setDocs] = useState<DesignDoc[]>([]);
  const [selected, setSelected] = useState<DesignDoc | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingDesign, setPendingDesign] = useState<ParsedDesignDraft | null>(null);
  // Preview shows the design with its real logo and typeface, so what is on screen
  // is what a saved file will contain.
  const [pendingResolved, setPendingResolved] = useState("");
  const handledDesignId = useRef<string | null>(null);

  const project = designProjects.find((p) => p.id === projectId) ?? designProjects[0];

  useEffect(() => {
    window.api.listDesignProjects().then((list) => {
      setDesignProjects(list);
      setProjectId((current) => (list.some((p) => p.id === current) ? current : list[0]?.id ?? ""));
    });
  }, []);

  useEffect(() => {
    refreshDocs();
    refreshAssets();
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (mode === "creator") initAgent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectId]);

  useEffect(() => window.api.onDesignRenderProgress(({ frame, total }) => {
    setRenderStatus(`Снимаю кадр ${frame} из ${total}…`);
  }), []);

  async function refreshDocs() {
    setDocs(await window.api.listDesignDocs(projectId || undefined));
  }

  async function refreshAssets() {
    setAssets(projectId ? await window.api.listDesignAssets(projectId) : []);
  }

  async function initAgent() {
    setAgentConv(null);
    setPendingDesign(null);
    setPendingResolved("");
    const prompt = await window.api.buildDesignAgentPrompt(projectId || undefined);
    setAgentPrompt(prompt + "\n\n" + DESIGN_SYNTAX_HINT);
    const existing = await window.api.getDesignAgentConversation(projectId || undefined);
    if (existing) {
      setAgentConv(existing);
      handledDesignId.current = existing.handledEditId ?? null;
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last && last.id !== handledDesignId.current) offerDesign(parseDesignDraft(last.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__design_agent__",
        title: "Дизайн-ассистент",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveDesignAgentConversation(projectId || undefined, conv);
      setAgentConv(conv);
    }
  }

  /** Shows a proposed design, with its project assets already substituted in. */
  async function offerDesign(draft: ParsedDesignDraft | null) {
    setPendingDesign(draft);
    if (!draft) {
      setPendingResolved("");
      return;
    }
    const withAssets = projectId ? await window.api.applyDesignAssets(projectId, draft.content) : draft.content;
    setPendingResolved(draft.format === "svg" ? sanitizeDesignSvg(withAssets) : sanitizeDesignHtml(withAssets));
  }

  /** Marks the current proposal as dealt with so it doesn't come back on reopen. */
  function markDesignHandled() {
    const last = [...(agentConv?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    if (last && agentConv) {
      const withMark = { ...agentConv, handledEditId: last.id };
      setAgentConv(withMark);
      window.api.saveDesignAgentConversation(projectId || undefined, withMark);
      handledDesignId.current = last.id;
    }
    setPendingDesign(null);
    setPendingResolved("");
  }

  // ---------- проекты ----------

  async function createProject() {
    const name = prompt("Название проекта дизайна", "Новый проект");
    if (!name) return;
    const created = await window.api.createDesignProject(name);
    setDesignProjects(await window.api.listDesignProjects());
    setProjectId(created.id);
    setMode("project");
  }

  async function renameProject() {
    if (!project) return;
    const name = prompt("Название проекта", project.name);
    if (!name) return;
    await window.api.updateDesignProject(project.id, { name });
    setDesignProjects(await window.api.listDesignProjects());
  }

  async function deleteProject() {
    if (!project) return;
    if (!confirm(`Удалить проект «${project.name}» и его макеты? Сами файлы-ассеты на компьютере останутся.`)) return;
    const rest = await window.api.removeDesignProject(project.id);
    setDesignProjects(rest);
    setProjectId(rest[0]?.id ?? "");
    setMode("gallery");
  }

  async function linkToApp(linkedProjectId: string) {
    if (!project) return;
    await window.api.updateDesignProject(project.id, { linkedProjectId });
    setDesignProjects(await window.api.listDesignProjects());
  }

  async function addAssets(kind: DesignAssetKind) {
    if (!project) return;
    const updated = await window.api.pickDesignAssets(project.id, kind);
    if (!updated) return;
    setDesignProjects(await window.api.listDesignProjects());
    await refreshAssets();
  }

  async function dropAsset(kind: DesignAssetKind, assetPath: string) {
    if (!project) return;
    await window.api.removeDesignAsset(project.id, kind, assetPath);
    setDesignProjects(await window.api.listDesignProjects());
    await refreshAssets();
  }

  // ---------- сохранение и экспорт ----------

  async function savePendingDesign() {
    if (!pendingDesign) return;
    const format = pendingDesign.format;
    const content = format === "svg" ? sanitizeDesignSvg(pendingDesign.content) : sanitizeDesignHtml(pendingDesign.content);
    await window.api.saveDesignDoc({
      title: pendingDesign.title,
      type: normalizeType(pendingDesign.type),
      format,
      content,
      durationSec: pendingDesign.durationSec,
      projectId: projectId || undefined,
    });
    markDesignHandled();
    setMode("gallery");
    await refreshDocs();
  }

  async function removeDoc(doc: DesignDoc) {
    if (!confirm(`Удалить дизайн «${doc.title}»?`)) return;
    await window.api.deleteDesignDoc(doc.id, projectId || undefined);
    if (selected?.id === doc.id) setSelected(null);
    await refreshDocs();
  }

  /**
   * Exports one design — not the conversation around it.
   *
   * PNG and MP4 go through the app's own renderer, which draws the layout at its own
   * pixel size (a 1080×1350 post is taller than most screens, and a plain screenshot
   * would silently lose the bottom of it). PDF and JPG keep using the shared HTML
   * export, which lays out on a page rather than a screen and so isn't affected.
   */
  async function exportDesign(
    source: { title: string; format: "html" | "svg"; content: string; width: number; height: number; durationSec: number },
    kind: "png" | "jpg" | "pdf" | "svg" | "mp4"
  ) {
    setExportError(null);
    setRenderStatus(null);
    try {
      if (kind === "svg") {
        const svgWithAssets = projectId ? await window.api.applyDesignAssets(projectId, source.content) : source.content;
        await window.api.exportSvgFile({
          svg: sanitizeDesignSvg(svgWithAssets),
          defaultName: source.title,
          projectId: undefined,
        });
        return;
      }

      const withAssets = projectId ? await window.api.applyDesignAssets(projectId, source.content) : source.content;
      const clean = source.format === "svg" ? sanitizeDesignSvg(withAssets) : sanitizeDesignHtml(withAssets);

      if (kind === "png" || kind === "mp4") {
        setRenderStatus(kind === "mp4" ? "Готовлю ролик…" : "Готовлю изображение…");
        const result = await window.api.renderDesign({
          kind,
          html: clean,
          width: source.width,
          height: source.height,
          durationSec: source.durationSec || 5,
          defaultName: source.title,
          projectId: projectId || undefined,
        });
        setRenderStatus(result ? `Готово: ${result.path}` : null);
        return;
      }

      const html = buildDesignExportHtml(clean);
      const payload = { html, defaultName: source.title, projectId: undefined };
      if (kind === "jpg") await window.api.exportToJpg(payload);
      if (kind === "pdf") await window.api.exportToPdf(payload);
    } catch (e) {
      setRenderStatus(null);
      setExportError(e instanceof Error ? e.message : String(e));
    }
  }

  /** A saved design remembers its type but not its size — recover it from the markup. */
  function sizeOf(doc: DesignDoc): { width: number; height: number } {
    const match = doc.content.match(/width:\s*(\d{2,5})px[\s\S]{0,200}?height:\s*(\d{2,5})px/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    const svg = doc.content.match(/viewBox="0 0 (\d+) (\d+)"/);
    if (svg) return { width: Number(svg[1]), height: Number(svg[2]) };
    return { width: 1080, height: 1080 };
  }

  function exportButtons(
    source: { title: string; format: "html" | "svg"; content: string; width: number; height: number; durationSec: number },
    isMotion: boolean
  ) {
    return (
      <div className="design-export-actions">
        {source.format === "svg" && (
          <button className="btn btn-secondary" onClick={() => exportDesign(source, "svg")}>
            SVG
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => exportDesign(source, "png")}>
          PNG
        </button>
        <button className="btn btn-secondary" onClick={() => exportDesign(source, "jpg")}>
          JPG
        </button>
        {source.format === "html" && (
          <button className="btn btn-secondary" onClick={() => exportDesign(source, "pdf")}>
            PDF
          </button>
        )}
        {isMotion && (
          <button className="btn btn-primary" onClick={() => exportDesign(source, "mp4")}>
            🎬 Сохранить MP4
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="design-view">
      <div className="ops-toolbar">
        <h2>Дизайн</h2>
        <div>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {designProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={createProject}>
            + Проект
          </button>
          <button
            className={mode === "project" ? "btn btn-primary" : "btn btn-secondary"}
            onClick={() => setMode(mode === "project" ? "gallery" : "project")}
          >
            ⚙️ Материалы проекта
          </button>
          <button className="btn btn-secondary" onClick={() => window.api.openDesignFolder(projectId || undefined)}>
            📁 Папка
          </button>
          <button
            className={mode === "creator" ? "btn btn-primary" : "btn btn-secondary"}
            onClick={() => setMode(mode === "creator" ? "gallery" : "creator")}
          >
            {mode === "creator" ? "← К галерее" : "✨ Создать дизайн"}
          </button>
        </div>
      </div>

      {mode === "project" && project && (
        <div className="panel-section design-project-panel">
          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={renameProject}>
              Переименовать проект
            </button>
            <button className="btn btn-secondary" onClick={deleteProject}>
              Удалить проект
            </button>
          </div>

          <label>Фирменный стиль из проекта приложения</label>
          <select value={project.linkedProjectId} onChange={(e) => linkToApp(e.target.value)}>
            <option value="">— не привязан —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Если привязать — ассистент получит фирменный стиль того проекта (название, слоган, акцентный цвет,
            дизайн-систему) в дополнение к материалам, добавленным здесь.
          </p>

          {ASSET_ORDER.map((kind) => {
            const group = assets.filter((a) => a.kind === kind);
            return (
              <div key={kind} className="design-asset-group">
                <h3>{ASSET_LABELS[kind]}</h3>
                <p className="hint">{ASSET_HINTS[kind]}</p>
                <ul className="doc-list">
                  {group.length === 0 && <p className="hint">Пока пусто.</p>}
                  {group.map((a) => (
                    <li key={a.path}>
                      <span className="doc-name">
                        {a.missing ? "⚠️ " : a.isFont ? "🔤 " : "🖼️ "}
                        {a.name}
                        {a.isFont && !a.missing && <span className="hint"> · font-family: {a.fontFamily}</span>}
                        {a.missing && <span className="hint"> · файл не найден по прежнему пути</span>}
                      </span>
                      <button className="conv-delete" onClick={() => dropAsset(kind, a.path)} title="Убрать">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="btn btn-secondary" onClick={() => addAssets(kind)}>
                  + Добавить файлы
                </button>
              </div>
            );
          })}

          <p className="hint">
            Файлы не копируются в приложение — хранятся только пути к ним. Правите логотип на компьютере — макеты
            подхватят новую версию сами.
          </p>
        </div>
      )}

      {mode === "gallery" && (
        <div className="design-layout">
          <div className="design-gallery">
            {docs.length === 0 && (
              <p className="hint design-empty-hint">
                В этом проекте пока пусто. Нажмите «✨ Создать дизайн» — опишите задачу (пост, документ, слайд,
                дизайн-система, страница сайта, логотип, анимационный ролик), ассистент предложит готовый вариант.
              </p>
            )}
            <ul className="design-card-list">
              {docs.map((d) => (
                <li key={d.id} className={selected?.id === d.id ? "design-card active" : "design-card"} onClick={() => setSelected(d)}>
                  <div className="design-card-preview">
                    <DesignPreview content={d.content} format={d.format} projectId={projectId || undefined} />
                  </div>
                  <div className="design-card-meta">
                    <span className="design-card-title">{d.title}</span>
                    <span className="design-card-type">{TYPE_LABELS[d.type]}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {selected && (
            <div className="design-viewer panel-section">
              <div className="design-viewer-header">
                <h3>{selected.title}</h3>
                <button className="conv-delete" onClick={() => removeDoc(selected)} title="Удалить">
                  ×
                </button>
              </div>
              <p className="hint">
                {TYPE_LABELS[selected.type]} · {sizeOf(selected).width}×{sizeOf(selected).height}
                {selected.type === "motion" && selected.durationSec ? ` · ${selected.durationSec} с` : ""}
              </p>
              <div className="design-viewer-preview">
                <DesignPreview content={selected.content} format={selected.format} projectId={projectId || undefined} />
              </div>
              {exportError && <div className="chat-error">{exportError}</div>}
              {renderStatus && <p className="hint">{renderStatus}</p>}
              {exportButtons(
                { ...selected, ...sizeOf(selected), durationSec: selected.durationSec || 0 },
                selected.type === "motion"
              )}
              {selected.type === "motion" ? (
                <p className="hint">
                  «Сохранить MP4» снимает ролик покадрово и собирает настоящее видео — это занимает от нескольких
                  секунд до минуты. PNG сохранит только первый кадр.
                </p>
              ) : (
                selected.format === "html" && (
                  <p className="hint">
                    Если в макете есть CSS-анимация, в предпросмотре она играет, но PNG/JPG/PDF сохранят один
                    статичный кадр. Для видео попросите ассистента сделать ролик (тип «моушн»).
                  </p>
                )
              )}
            </div>
          )}
        </div>
      )}

      {mode === "creator" && (
        <div className="creator-layout">
          <div className="creator-header">
            <p className="hint">
              Опишите, какой дизайн нужен — пост, документ, презентация, дизайн-система, страница сайта, логотип
              или <b>анимационный ролик</b>. Ассистент видит материалы проекта: логотипы и фото вставит сам,
              заголовки наберёт вашим шрифтом, а референсы использует как ориентир, не копируя их.
            </p>
          </div>
          {!settings.apiKey && (
            <div className="warning-banner">
              API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
            </div>
          )}
          {exportError && <div className="chat-error">{exportError}</div>}
          {pendingDesign && (
            <>
              <div className="pending-skill-banner design-pending-banner">
                <div>
                  <strong>
                    «{pendingDesign.title}» · {TYPE_LABELS[normalizeType(pendingDesign.type)]} ·{" "}
                    {pendingDesign.width}×{pendingDesign.height}
                    {pendingDesign.durationSec ? ` · ${pendingDesign.durationSec} с` : ""}
                  </strong>
                  {renderStatus && <div className="hint">{renderStatus}</div>}
                </div>
                <div className="design-pending-actions">
                  {exportButtons(pendingDesign, normalizeType(pendingDesign.type) === "motion")}
                  <div>
                    <button className="btn btn-primary" onClick={savePendingDesign}>
                      Сохранить в галерею
                    </button>
                    <button className="btn btn-secondary" onClick={markDesignHandled}>
                      Отклонить
                    </button>
                  </div>
                </div>
              </div>
              <div className="design-pending-preview">
                <DesignPreview content={pendingResolved || pendingDesign.content} format={pendingDesign.format} />
              </div>
            </>
          )}
          {agentConv && (
            <ChatView
              conversation={agentConv}
              systemPrompt={agentPrompt}
              settings={settings}
              skills={skills}
              onUpdate={setAgentConv}
              onSave={(conv) => window.api.saveDesignAgentConversation(projectId || undefined, conv)}
              emptyHint="Например: «Квадратный пост с анонсом акции» или «Ролик на 6 секунд: логотип появляется, под ним слоган»."
              onAssistantMessage={(content) => {
                handledDesignId.current = null;
                offerDesign(parseDesignDraft(content));
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
