import { useEffect, useState } from "react";
import type { Blueprint, BlueprintModule } from "../lib/types";

const EMPTY: Partial<Blueprint> = {
  name: "Новая сборка",
  productName: "Личный чат",
  description: "",
  modules: ["projects", "skills"],
};

export default function BlueprintsView() {
  const [modules, setModules] = useState<BlueprintModule[]>([]);
  const [list, setList] = useState<Blueprint[]>([]);
  const [draft, setDraft] = useState<Partial<Blueprint>>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([window.api.blueprintModules(), window.api.listBlueprints()])
      .then(([m, b]) => {
        setModules(m);
        setList(b);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function toggleModule(id: string) {
    setDraft((prev) => {
      const current = prev.modules ?? [];
      return {
        ...prev,
        modules: current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
      };
    });
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { all, saved } = await window.api.saveBlueprint(draft);
      setList(all);
      setDraft(saved);
      setNotice("Сборка сохранена.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportConfig() {
    if (!draft.id) {
      setError("Сначала сохраните сборку.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await window.api.exportBlueprint(draft as Blueprint);
      if (!result) return;
      setNotice(
        `Записан ${result.file}. Включено модулей: ${result.enabledCount}.` +
          (result.disabled.length ? ` Отключены: ${result.disabled.join(", ")}.` : "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить сборку?")) return;
    setList(await window.api.deleteBlueprint(id));
    if (draft.id === id) setDraft(EMPTY);
  }

  const chosen = draft.modules ?? [];

  return (
    <div className="settings-view">
      <h2 className="view-title">Сборки «Личного чата»</h2>
      <p className="hint">
        Здесь описывается, из каких модулей собирается конкретная версия «Личного чата»: например,
        версия только для копирайтинга или только для отчётности. Экспорт кладёт файл plugins.json
        в папку с исходниками — при следующей сборке приложение соберётся с этим набором разделов.
      </p>

      <section className="card">
        <h3 className="card-title">Сохранённые сборки</h3>
        {list.length === 0 && <p className="hint">Пока ни одной.</p>}
        {list.map((item) => (
          <div key={item.id} className="blueprint-row">
            <button type="button" className="blueprint-name" onClick={() => setDraft(item)}>
              <strong>{item.name}</strong>
              <span className="hint"> — {item.productName}, модулей: {item.modules.length}</span>
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
        <input
          className="input"
          value={draft.name ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
        />

        <label className="field-label">Название приложения (что увидит пользователь)</label>
        <input
          className="input"
          value={draft.productName ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, productName: e.target.value }))}
        />

        <label className="field-label">Описание</label>
        <textarea
          className="textarea"
          rows={2}
          value={draft.description ?? ""}
          onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
        />

        <label className="field-label">Модули</label>
        <div className="module-grid">
          {modules.map((module) => {
            const on = module.core || chosen.includes(module.id);
            return (
              <label key={module.id} className={`module-card${on ? " module-card-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={module.core}
                  onChange={() => toggleModule(module.id)}
                />
                <span>
                  <strong>{module.name}</strong>
                  {module.core && <span className="hint"> — всегда включён</span>}
                  <span className="module-desc">{module.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="sticky-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
            Сохранить
          </button>
          <button type="button" className="btn" onClick={exportConfig} disabled={busy || !draft.id}>
            Выгрузить plugins.json
          </button>
          {notice && <span className="notice-text">{notice}</span>}
          {error && <span className="error-text">{error}</span>}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Лицензионные ключи</h3>
        <p className="hint">
          Выдача и отзыв ключей доступа здесь намеренно не сделаны. Это не техническая, а
          юридическая часть: чтобы продавать лицензии, нужны оформленное правообладание, лицензионный
          договор (или EULA) и субъект, от чьего имени выдаются ключи. Как только юридическая форма
          будет определена, раздел можно добавить — сама конфигурация модулей выше к тому времени уже
          будет работать и станет его основой.
        </p>
      </section>
    </div>
  );
}
