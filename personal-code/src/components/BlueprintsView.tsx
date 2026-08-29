import { useEffect, useRef, useState } from "react";
import type { ArchivedPlugin, Blueprint, BlueprintModule, BuildResult } from "../lib/types";

const EMPTY: Partial<Blueprint> = {
  name: "Новая сборка",
  productName: "Личный чат",
  description: "",
  modules: ["projects", "skills"],
  sourcePath: "",
  branch: "claude/personal-claude-chat-docs-untwa4",
  apiKey: "",
  baseUrl: "https://polza.ai/api/v1",
  model: "anthropic/claude-sonnet-5",
  pricesText: "",
  currency: "₽",
  skills: [],
  demoGated: true,
  revocationUrl: "",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function BlueprintsView() {
  const [modules, setModules] = useState<BlueprintModule[]>([]);
  const [plugins, setPlugins] = useState<ArchivedPlugin[]>([]);
  const [list, setList] = useState<Blueprint[]>([]);
  const [draft, setDraft] = useState<Partial<Blueprint>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([window.api.blueprintModules(), window.api.listBlueprints(), window.api.listPlugins()])
      .then(([m, b, p]) => {
        setModules(m);
        setList(b);
        setPlugins(p);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Строки сборки приходят по мере выполнения, а не пачкой в конце: сборка идёт
  // минуты, и молчащее окно в это время выглядит как зависшее.
  useEffect(() => window.api.onBuildLog((line) => setLog((prev) => [...prev, line])), []);
  useEffect(() => logEnd.current?.scrollIntoView({ block: "end" }), [log]);

  function patch(next: Partial<Blueprint>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function toggleModule(id: string) {
    const current = draft.modules ?? [];
    patch({ modules: current.includes(id) ? current.filter((m) => m !== id) : [...current, id] });
  }

  function toggleSkill(id: string, version: number) {
    const current = draft.skills ?? [];
    const already = current.find((s) => s.id === id);
    if (already && already.version === version) patch({ skills: current.filter((s) => s.id !== id) });
    else patch({ skills: [...current.filter((s) => s.id !== id), { id, version }] });
  }

  async function save(): Promise<Blueprint | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { all, saved } = await window.api.saveBlueprint(draft);
      setList(all);
      setDraft(saved);
      setNotice("Сборка сохранена.");
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function pickSources() {
    setError("");
    try {
      const dir = await window.api.pickChatSources();
      if (dir) patch({ sourcePath: dir });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function build() {
    const saved = await save();
    if (!saved) return;
    if (!saved.sourcePath) {
      setError("Сначала выберите папку с исходниками «Личного чата».");
      return;
    }
    setBuilding(true);
    setResult(null);
    setLog([]);
    setError("");
    setNotice("");
    try {
      const built = await window.api.buildBlueprint(saved);
      setResult(built);
      if (!built.ok) setError(built.message || "Сборка не удалась.");
      else setNotice("Сборка готова.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить сборку?")) return;
    setList(await window.api.deleteBlueprint(id));
    if (draft.id === id) setDraft(EMPTY);
  }

  const chosen = draft.modules ?? [];
  const chosenSkills = draft.skills ?? [];

  return (
    <div className="settings-view">
      <h2 className="view-title">Сборки «Личного чата»</h2>
      <p className="hint">
        Здесь описывается конкретная копия «Личного чата»: как называется, из каких модулей состоит,
        с каким ключом Polza работает и какие навыки вшиты внутрь. Кнопка «Собрать» делает всё
        подряд — записывает настройки в исходники, пересобирает набор навыков и запускает установщик,
        рассказывая по дороге, что происходит.
      </p>

      <section className="card">
        <h3 className="card-title">Сохранённые сборки</h3>
        {list.length === 0 && <p className="hint">Пока ни одной.</p>}
        {list.map((item) => (
          <div key={item.id} className="blueprint-row">
            <button type="button" className="blueprint-name" onClick={() => setDraft(item)}>
              <strong>{item.name}</strong>
              <span className="hint">
                {" "}
                — {item.productName}, модулей: {item.modules.length}
                {item.skills?.length ? `, плагинов: ${item.skills.length}` : ""}
                {item.apiKey ? ", ключ вшит" : ""}
              </span>
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(item.id)}>
              Удалить
            </button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => setDraft(EMPTY)}>
          Новая сборка
        </button>
      </section>

      <section className="card">
        <h3 className="card-title">{draft.id ? "Редактирование" : "Новая сборка"}</h3>

        <label className="field-label">Название сборки (для себя)</label>
        <input className="input" value={draft.name ?? ""} onChange={(e) => patch({ name: e.target.value })} />

        <label className="field-label">Название приложения (что увидит пользователь)</label>
        <input
          className="input"
          value={draft.productName ?? ""}
          onChange={(e) => patch({ productName: e.target.value })}
        />

        <label className="field-label">Описание</label>
        <textarea
          className="textarea"
          rows={2}
          value={draft.description ?? ""}
          onChange={(e) => patch({ description: e.target.value })}
        />

        <label className="field-label">Модули</label>
        <div className="module-grid">
          {modules.map((module) => {
            const on = module.core || chosen.includes(module.id);
            return (
              <label key={module.id} className={`module-card${on ? " module-card-on" : ""}`}>
                <input type="checkbox" checked={on} disabled={module.core} onChange={() => toggleModule(module.id)} />
                <span>
                  <strong>{module.name}</strong>
                  {module.core && <span className="hint"> — всегда включён</span>}
                  <span className="module-desc">{module.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Откуда собирать</h3>
        <p className="hint">
          Папка с исходниками «Личного чата» и ветка, из которой берётся код. Ветка по умолчанию —
          та, где лежит канонический код; если в папке остались незакоммиченные правки, сборка
          остановится и скажет об этом, а не увезёт их в установщик.
        </p>
        <div className="row">
          <code className="folder-path">{draft.sourcePath || "папка не выбрана"}</code>
          <button type="button" className="btn" onClick={pickSources}>
            Выбрать папку
          </button>
        </div>
        <label className="field-label">Ветка репозитория</label>
        <input
          className="input"
          placeholder="можно оставить пустым — собирать как есть"
          value={draft.branch ?? ""}
          onChange={(e) => patch({ branch: e.target.value })}
        />
      </section>

      <section className="card">
        <h3 className="card-title">Ключ Polza для этой копии</h3>
        <p className="hint">
          Ключ вшивается в сборку: тестировщику не нужно ничего вводить, а в настройках копии вместо
          поля ключа он увидит расход. Для группы заведите <b>отдельный ключ с небольшим балансом</b>{" "}
          — он физически лежит на чужом компьютере, и отозвать его должно быть не жалко. Пустой ключ
          — обычная сборка, где человек вводит свой.
        </p>
        <label className="field-label">API-ключ</label>
        <input
          className="input"
          type="password"
          placeholder="ключ Polza для этой копии"
          value={draft.apiKey ?? ""}
          onChange={(e) => patch({ apiKey: e.target.value })}
        />
        <div className="row">
          <div className="col">
            <label className="field-label">Адрес API</label>
            <input className="input" value={draft.baseUrl ?? ""} onChange={(e) => patch({ baseUrl: e.target.value })} />
          </div>
          <div className="col">
            <label className="field-label">Модель по умолчанию</label>
            <input className="input" value={draft.model ?? ""} onChange={(e) => patch({ model: e.target.value })} />
          </div>
        </div>
        <label className="field-label">Цены моделей (модель, вход, выход за 1 млн токенов)</label>
        <textarea
          className="textarea"
          rows={3}
          placeholder={"anthropic/claude-sonnet-5 300 1500\nanthropic/claude-opus-5 900 4500"}
          value={draft.pricesText ?? ""}
          onChange={(e) => patch({ pricesText: e.target.value })}
        />
        <p className="hint">
          По ним копия считает расход. Модель без цены показывается в токенах, без выдуманной суммы.
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">Навыки, вшитые в сборку</h3>
        <p className="hint">
          Из архива плагинов. Автор навыка виден по названию и описанию, а сам текст внутрь окна не
          передаётся. Список пересобирается целиком при каждой сборке, поэтому снятый плагин из копии
          действительно исчезает.
        </p>
        {plugins.length === 0 && <p className="hint">Архив плагинов пуст — вкладка «Плагины».</p>}
        {plugins.map((plugin) => {
          const picked = chosenSkills.find((s) => s.id === plugin.id);
          return (
            <div key={plugin.id} className="plugin-row">
              <div className="plugin-main">
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(picked)}
                    onChange={() => toggleSkill(plugin.id, picked ? picked.version : plugin.latest)}
                  />{" "}
                  <strong>{plugin.name}</strong>
                </label>
                {plugin.description && <span className="hint">{plugin.description}</span>}
              </div>
              {picked && (
                <select
                  className="input input-sm"
                  value={picked.version}
                  onChange={(e) => toggleSkill(plugin.id, Number(e.target.value))}
                >
                  {plugin.versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} — навыков: {v.skills}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3 className="card-title">Активация копии</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.demoGated !== false}
            onChange={(e) => patch({ demoGated: e.target.checked })}
          />{" "}
          Копия требует файл активации
        </label>
        <p className="hint">
          С активацией копия работает только на том компьютере, для которого выдан файл, и только до
          указанной даты. Файлы выдаются во вкладке «Демо-доступ». Без активации получится обычная
          сборка — такая нужна для себя, её нельзя заблокировать.
        </p>
        {draft.demoGated !== false && (
          <>
            <label className="field-label">Ссылка на список отзыва (необязательно)</label>
            <input
              className="input"
              placeholder="https://…/revoked.json"
              value={draft.revocationUrl ?? ""}
              onChange={(e) => patch({ revocationUrl: e.target.value })}
            />
            <p className="hint">
              Копия читает файл по этой ссылке раз в 12 часов. Ссылки нет — доступ всё равно кончится
              по дате, просто отключить досрочно будет нечем.
            </p>
          </>
        )}
      </section>

      <div className="sticky-actions">
        <button type="button" className="btn btn-primary" onClick={build} disabled={busy || building}>
          {building ? "Собираю…" : "Собрать"}
        </button>
        <button type="button" className="btn" onClick={save} disabled={busy || building}>
          Только сохранить
        </button>
        {notice && <span className="notice-text">{notice}</span>}
        {error && <span className="error-text">{error}</span>}
      </div>

      {(log.length > 0 || building) && (
        <section className="card">
          <h3 className="card-title">Что происходит</h3>
          <pre className="build-log">
            {log.join("\n")}
            <div ref={logEnd} />
          </pre>
          {result?.ok && result.installers && result.installers.length > 0 && (
            <>
              <h4 className="field-label">Готовые файлы</h4>
              <ul className="storage-list">
                {result.installers.map((file) => (
                  <li key={file.path}>
                    <span className="storage-name">{file.name}</span>
                    <span className="storage-size">{formatBytes(file.bytes)}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn"
                onClick={() => result.releaseDir && window.api.openReleaseFolder(result.releaseDir)}
              >
                Открыть папку со сборкой
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
