import { useEffect, useMemo, useState } from "react";
import type {
  ChatAttachment,
  Conversation,
  Counterparty,
  DocKind,
  DocSource,
  DocTemplate,
  DocflowConfig,
  DocflowMeta,
  DocflowPrepared,
  DocflowSaveResult,
  Settings,
  Skill,
  WordEditOp,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";
import NamePrompt, { type NamePromptRequest } from "./NamePrompt";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

type Tab = "make" | "refs" | "lawyer";

const EMPTY_CONFIG: DocflowConfig = {
  counterparties: [],
  templates: [],
  sources: [],
  ledgerPath: "",
  archivePath: "",
  outputPath: "",
};

function fileName(p: string): string {
  return p ? p.split(/[\\/]/).pop() || p : "";
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function DocFlowView({ settings, skills, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("make");
  const [config, setConfig] = useState<DocflowConfig>(EMPTY_CONFIG);
  const [kinds, setKinds] = useState<DocKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Задание на документ
  const [kindId, setKindId] = useState("act");
  const [month, setMonth] = useState(currentMonth());
  const [templateId, setTemplateId] = useState("");
  const [templatePathOverride, setTemplatePathOverride] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [dataPaths, setDataPaths] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [writeLedger, setWriteLedger] = useState(true);
  const [outputDir, setOutputDir] = useState("");

  // Работа агента
  const [prepared, setPrepared] = useState<DocflowPrepared | null>(null);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; attachments?: ChatAttachment[]; nonce: number } | undefined>();
  const [pending, setPending] = useState<{ meta: DocflowMeta; ops: WordEditOp[]; markdown: string } | null>(null);
  const [saved, setSaved] = useState<DocflowSaveResult | null>(null);
  const [namePrompt, setNamePrompt] = useState<NamePromptRequest | null>(null);

  const mode: "template" | "lawyer" = tab === "lawyer" ? "lawyer" : "template";

  useEffect(() => {
    window.api.getDocflowConfig().then((cfg) => {
      setConfig(cfg);
      setOutputDir(cfg.outputPath || "");
    });
    window.api.docflowKinds().then(setKinds);
  }, []);

  const kind = useMemo(() => kinds.find((k) => k.id === kindId), [kinds, kindId]);
  const template = config.templates.find((t) => t.id === templateId);
  const templatePath = templatePathOverride || template?.path || "";
  const counterparty = config.counterparties.find((c) => c.id === counterpartyId);

  function showNote(text: string, ms = 8000) {
    setNote(text);
    setTimeout(() => setNote(null), ms);
  }

  async function persist(next: DocflowConfig) {
    setConfig(next);
    await window.api.saveDocflowConfig(next);
  }

  function askName(title: string, initial: string, onSubmit: (value: string) => void) {
    setNamePrompt({ title, initial, onSubmit });
  }

  // ---------- справочники ----------

  async function addCounterparty() {
    const picked = await window.api.pickDocflowFile("data");
    if (picked.length === 0) return;
    askName("Название контрагента", fileName(picked[0]).replace(/\.[^.]+$/, ""), (name) => {
      const entry: Counterparty = { id: uid(), name, requisitesPath: picked[0] };
      persist({ ...config, counterparties: [...config.counterparties, entry] });
    });
  }

  async function addTemplate() {
    const picked = await window.api.pickDocflowFile("template");
    if (picked.length === 0) return;
    askName("Название шаблона", fileName(picked[0]).replace(/\.docx$/i, ""), (name) => {
      const entry: DocTemplate = { id: uid(), name, kind: kindId, path: picked[0] };
      persist({ ...config, templates: [...config.templates, entry] });
    });
  }

  async function addSource() {
    const picked = await window.api.pickDocflowFile("data");
    if (picked.length === 0) return;
    askName("Название исходника (например «Тарифы»)", fileName(picked[0]).replace(/\.[^.]+$/, ""), (name) => {
      const entry: DocSource = { id: uid(), name, path: picked[0] };
      persist({ ...config, sources: [...config.sources, entry] });
    });
  }

  async function pickLedger() {
    const picked = await window.api.pickDocflowFile("ledger");
    if (picked.length > 0) await persist({ ...config, ledgerPath: picked[0] });
  }

  async function pickFolderInto(field: "archivePath" | "outputPath") {
    const picked = await window.api.pickDocflowFolder();
    if (!picked) return;
    await persist({ ...config, [field]: picked });
    if (field === "outputPath") setOutputDir(picked);
  }

  // ---------- подготовка задания ----------

  async function prepare() {
    setError(null);
    setSaved(null);
    setPending(null);
    setBusy(true);
    try {
      const result = await window.api.prepareDocflow({
        kindId,
        mode,
        month,
        templatePath: mode === "lawyer" ? "" : templatePath,
        requisitesPath: counterparty?.requisitesPath || "",
        dataPaths,
        sourcePaths: config.sources.filter((s) => sourceIds.includes(s.id)).map((s) => s.path),
        ledgerPath: config.ledgerPath,
        counterpartyName: counterparty?.name || "",
      });
      setPrepared(result);

      // Каждая подготовка — новый разговор: документы делаются по одному, и
      // прошлый акт в контексте только мешает следующему (и оплачивается заново).
      const fresh: Conversation = {
        id: uid(),
        projectId: "__docflow__",
        title: `${kind?.name || "Документ"} — ${counterparty?.name || "без контрагента"}`,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setConv(fresh);

      const hint =
        mode === "lawyer"
          ? "Составь документ. Условия: "
          : `Подготовь ${kind?.name.toLowerCase() || "документ"} по шаблону${month ? ` за ${month}` : ""}. Отступления от шаблона: `;
      setPrefill({ text: hint, attachments: result.images, nonce: Date.now() });
      if (result.problems.length > 0) showNote("Не удалось прочитать: " + result.problems.join("; "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAssistantMessage(content: string) {
    setSaved(null);
    try {
      setPending(await window.api.parseDocflowResult(content));
    } catch {
      setPending(null);
    }
  }

  async function saveResult() {
    if (!pending) return;
    if (!outputDir) {
      setError("Не выбрана папка, куда сохранить документ.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await window.api.saveDocflowResult({
        mode,
        templatePath: mode === "lawyer" ? "" : templatePath,
        ops: pending.ops,
        markdown: pending.markdown,
        meta: pending.meta,
        outputDir,
        kindId,
        ledgerPath: config.ledgerPath,
        writeLedger: writeLedger && Boolean(config.ledgerPath),
      });
      setSaved(result);
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---------- разметка ----------

  function renderTaskForm() {
    return (
      <div className="docflow-form">
        <div className="docflow-field">
          <label>Вид документа</label>
          <select value={kindId} onChange={(e) => setKindId(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          {kind && (
            <p className="hint">
              {kind.numbered ? "Номер берётся из документа сверки (крайний + 1). " : "Без нумерации. "}
              {kind.dateRule === "monthEnd"
                ? "Дата — последнее число выбранного месяца."
                : kind.dateRule === "monthStart"
                  ? "Дата — первое число выбранного месяца."
                  : "Дата — сегодняшняя."}
            </p>
          )}
        </div>

        {kind && kind.dateRule !== "today" && (
          <div className="docflow-field">
            <label>Месяц</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}

        {mode === "template" && (
          <div className="docflow-field">
            <label>Шаблон</label>
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setTemplatePathOverride("");
              }}
            >
              <option value="">— выбрать из справочника —</option>
              {config.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="docflow-inline">
              <button
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  const picked = await window.api.pickDocflowFile("template");
                  if (picked.length > 0) {
                    setTemplatePathOverride(picked[0]);
                    setTemplateId("");
                  }
                }}
              >
                Указать файл разово
              </button>
              {templatePath && <span className="docflow-path">{fileName(templatePath)}</span>}
            </div>
            <p className="hint">
              Можно приложить документ за прошлый месяц — он и будет шаблоном: агент возьмёт из него и
              структуру, и реквизиты.
            </p>
          </div>
        )}

        <div className="docflow-field">
          <label>Контрагент (реквизиты)</label>
          <select value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}>
            <option value="">— без отдельных реквизитов —</option>
            {config.counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {config.sources.length > 0 && (
          <div className="docflow-field">
            <label>Исходники (тарифы, прайсы)</label>
            {config.sources.map((s) => (
              <label key={s.id} className="docflow-check">
                <input
                  type="checkbox"
                  checked={sourceIds.includes(s.id)}
                  onChange={(e) =>
                    setSourceIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        )}

        <div className="docflow-field">
          <label>Данные для документа</label>
          <div className="docflow-inline">
            <button
              className="btn btn-secondary btn-small"
              onClick={async () => {
                const picked = await window.api.pickDocflowFile("data");
                if (picked.length > 0) setDataPaths((prev) => [...prev, ...picked]);
              }}
            >
              + Выгрузки, отчёты, скриншоты
            </button>
          </div>
          {dataPaths.map((p) => (
            <div key={p} className="docflow-path-row">
              <span className="docflow-path">{fileName(p)}</span>
              <button className="link-btn" onClick={() => setDataPaths((prev) => prev.filter((x) => x !== p))}>
                убрать
              </button>
            </div>
          ))}
          <p className="hint">Excel, CSV и текст читаются целиком; скриншоты уходят агенту картинками.</p>
        </div>

        <div className="docflow-field">
          <label>Куда сохранить</label>
          <div className="docflow-inline">
            <button className="btn btn-secondary btn-small" onClick={() => pickFolderInto("outputPath")}>
              Выбрать папку
            </button>
            {outputDir && <span className="docflow-path">{outputDir}</span>}
          </div>
          <label className="docflow-check">
            <input type="checkbox" checked={writeLedger} onChange={(e) => setWriteLedger(e.target.checked)} />
            Записать в документ сверки
            {!config.ledgerPath && <span className="hint"> (сверка не выбрана — вкладка «Справочники»)</span>}
          </label>
        </div>

        <button className="btn btn-primary btn-block" onClick={prepare} disabled={busy || (mode === "template" && !templatePath)}>
          {busy ? "Готовлю…" : "Собрать задание для агента"}
        </button>
      </div>
    );
  }

  function renderPrepared() {
    if (!prepared) return null;
    return (
      <div className="docflow-prepared">
        <span className={prepared.ledgerFound ? "docflow-badge" : "docflow-badge docflow-badge-warn"}>
          {prepared.ledgerFound ? "Сверка прочитана" : "Сверка не прочитана"}
        </span>
        {prepared.nextNumber > 0 && <span className="docflow-badge">Номер: {prepared.nextNumber}</span>}
        <span className="docflow-badge">Дата: {prepared.date}</span>
        {prepared.templateBlocks > 0 && <span className="docflow-badge">Блоков шаблона: {prepared.templateBlocks}</span>}
        {prepared.images.length > 0 && <span className="docflow-badge">Скриншотов: {prepared.images.length}</span>}
      </div>
    );
  }

  function renderPending() {
    if (!pending) return null;
    const { meta } = pending;
    return (
      <div className="pending-skill-banner">
        <div className="excel-pending-summary">
          <strong>Документ готов к сохранению</strong>
        </div>
        <div className="docflow-meta">
          {meta.number && <span>№ {meta.number}</span>}
          {meta.date && <span>от {meta.date}</span>}
          {meta.counterparty && <span>{meta.counterparty}</span>}
          {meta.sum && <span>{meta.sum}</span>}
          <span>
            {mode === "lawyer"
              ? `${pending.markdown.length} символов текста`
              : `${pending.ops.length} правок к шаблону`}
          </span>
        </div>
        <p className="hint">Файл: {meta.filename || "имя подставит приложение"}.docx + .pdf</p>
        <div className="excel-pending-actions">
          <button className="btn btn-primary" onClick={saveResult} disabled={busy}>
            Сохранить в Word и PDF
          </button>
          <button className="btn btn-secondary" onClick={() => setPending(null)}>
            Отклонить
          </button>
        </div>
      </div>
    );
  }

  function renderSaved() {
    if (!saved) return null;
    return (
      <div className="docflow-saved">
        <div>
          <strong>Сохранено:</strong> {saved.docxPath}
        </div>
        {saved.pdfPath ? (
          <div>
            <strong>PDF:</strong> {saved.pdfPath}
            {saved.pdfVia === "render" && (
              <span className="hint">
                {" "}
                — собран самим приложением (Word не найден), вёрстка приблизительная: проверьте перед отправкой
              </span>
            )}
          </div>
        ) : (
          <div className="hint">PDF не собран: {saved.pdfError}</div>
        )}
        {saved.ledgerRow && <div className="hint">В сверку записано: {saved.ledgerRow.filter(Boolean).join(" | ")}</div>}
        {saved.ledgerError && <div className="hint">В сверку записать не удалось: {saved.ledgerError}</div>}
        <button className="btn btn-secondary btn-small" onClick={() => window.api.openDocflowFolder(outputDir)}>
          Открыть папку
        </button>
      </div>
    );
  }

  function renderRefs() {
    return (
      <div className="panel-section docflow-refs">
        <p className="hint">
          Здесь только пути к вашим файлам — ничего не копируется внутрь приложения. Поправили реквизиты или
          шаблон у себя в папке, и следующий документ уже с новыми.
        </p>

        <h3>Контрагенты</h3>
        {config.counterparties.map((c) => (
          <div key={c.id} className="docflow-path-row">
            <span>
              <strong>{c.name}</strong> <span className="docflow-path">{fileName(c.requisitesPath)}</span>
            </span>
            <button
              className="link-btn"
              onClick={() => persist({ ...config, counterparties: config.counterparties.filter((x) => x.id !== c.id) })}
            >
              убрать
            </button>
          </div>
        ))}
        <button className="btn btn-secondary btn-small" onClick={addCounterparty}>
          + Реквизиты контрагента
        </button>

        <h3>Шаблоны</h3>
        {config.templates.map((t) => (
          <div key={t.id} className="docflow-path-row">
            <span>
              <strong>{t.name}</strong> <span className="docflow-path">{fileName(t.path)}</span>
            </span>
            <button
              className="link-btn"
              onClick={() => persist({ ...config, templates: config.templates.filter((x) => x.id !== t.id) })}
            >
              убрать
            </button>
          </div>
        ))}
        <button className="btn btn-secondary btn-small" onClick={addTemplate}>
          + Шаблон (.docx)
        </button>

        <h3>Исходники</h3>
        {config.sources.map((s) => (
          <div key={s.id} className="docflow-path-row">
            <span>
              <strong>{s.name}</strong> <span className="docflow-path">{fileName(s.path)}</span>
            </span>
            <button
              className="link-btn"
              onClick={() => persist({ ...config, sources: config.sources.filter((x) => x.id !== s.id) })}
            >
              убрать
            </button>
          </div>
        ))}
        <button className="btn btn-secondary btn-small" onClick={addSource}>
          + Тарифы, прайс, справочник
        </button>

        <h3>Документ сверки</h3>
        <div className="docflow-inline">
          <button className="btn btn-secondary btn-small" onClick={pickLedger}>
            Выбрать файл (.xlsx или .docx)
          </button>
          {config.ledgerPath && <span className="docflow-path">{config.ledgerPath}</span>}
        </div>
        <p className="hint">
          По нему считается следующий номер и в него дописывается строка на каждый выданный документ.
        </p>

        <h3>Папки</h3>
        <div className="docflow-inline">
          <button className="btn btn-secondary btn-small" onClick={() => pickFolderInto("archivePath")}>
            Архив документов
          </button>
          {config.archivePath && <span className="docflow-path">{config.archivePath}</span>}
        </div>
        <div className="docflow-inline">
          <button className="btn btn-secondary btn-small" onClick={() => pickFolderInto("outputPath")}>
            Куда сохранять по умолчанию
          </button>
          {config.outputPath && <span className="docflow-path">{config.outputPath}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📁</span>
            <h2>Документооборот</h2>
          </div>
        </div>

        <div className="project-tabs">
          <button className={tab === "make" ? "tab active" : "tab"} onClick={() => setTab("make")}>
            Документы
          </button>
          <button className={tab === "lawyer" ? "tab active" : "tab"} onClick={() => setTab("lawyer")}>
            Юрист
          </button>
          <button className={tab === "refs" ? "tab active" : "tab"} onClick={() => setTab("refs")}>
            Справочники
          </button>
        </div>

        {!settings.apiKey && (
          <div className="warning-banner">
            API-ключ не задан.{" "}
            <button className="link-btn" onClick={onOpenSettings}>
              Открыть настройки
            </button>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        {note && <div className="hint docflow-note">{note}</div>}

        {tab === "refs" ? (
          renderRefs()
        ) : (
          <div className="docflow-body">
            <div className="docflow-side">
              {tab === "lawyer" && (
                <p className="hint">
                  Режим юриста: шаблон не нужен. Опишите, какой документ и на каких условиях нужен — агент
                  напишет его с нуля так, чтобы он защищал ваши интересы и не противоречил закону, и прямо
                  назовёт оставшиеся риски.
                </p>
              )}
              {renderTaskForm()}
            </div>
            <div className="docflow-main">
              {renderPrepared()}
              {renderPending()}
              {renderSaved()}
              {conv ? (
                <ChatView
                  conversation={conv}
                  systemPrompt={prepared?.prompt || ""}
                  settings={settings}
                  skills={skills}
                  prefill={prefill}
                  onUpdate={setConv}
                  onSave={async () => {}}
                  emptyHint="Например: «Подготовь акт за август по тарифам, работы — SMM-ведение и таргет»."
                  onAssistantMessage={onAssistantMessage}
                />
              ) : (
                <div className="empty-state">
                  Заполните задание слева и нажмите «Собрать задание для агента».
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <NamePrompt request={namePrompt} onClose={() => setNamePrompt(null)} />
    </div>
  );
}
