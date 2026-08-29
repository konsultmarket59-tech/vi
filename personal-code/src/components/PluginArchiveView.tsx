import { useCallback, useEffect, useState } from "react";
import type { ArchivedPlugin, PluginSkill } from "../lib/types";

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ru-RU");
}

export default function PluginArchiveView() {
  const [plugins, setPlugins] = useState<ArchivedPlugin[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Черновик новой версии.
  const [targetId, setTargetId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [skills, setSkills] = useState<PluginSkill[]>([]);
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);

  // Что уходит в сборку: плагин → выбранная версия.
  const [selected, setSelected] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    try {
      setPlugins(await window.api.listPlugins());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function act<T>(fn: () => Promise<T>, success = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (success) setNotice(success);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function resetDraft() {
    setTargetId("");
    setName("");
    setDescription("");
    setNote("");
    setSkills([]);
    setSourcePaths([]);
  }

  const targetPlugin = plugins.find((p) => p.id === targetId);

  return (
    <div className="settings-view">
      <h2 className="view-title">Плагины</h2>
      <p className="hint">
        Запас готовых дополнений к «Личному чату». Плагин — это набор навыков и, если нужно,
        исходников модуля. Каждое сохранение кладётся новой версией: старые остаются на месте,
        поэтому всегда можно вернуться к тому, что уже отдано тестировщикам.
      </p>

      <section className="card">
        <div className="card-head-row">
          <h3 className="card-title">В архиве ({plugins.length})</h3>
          <button type="button" className="btn btn-sm" onClick={() => window.api.openPluginFolder("")}>
            Открыть папку архива
          </button>
        </div>

        {plugins.length === 0 && (
          <p className="hint">
            Пока пусто. Когда агент во вкладке «Код» напишет плагин, соберите его сюда — укажите
            ниже файлы навыков и, если есть, исходники модуля.
          </p>
        )}

        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-row">
            <div className="plugin-main">
              <strong>{plugin.name}</strong>
              <span className="hint">
                {plugin.description || "без описания"} · версий: {plugin.versions.length}
              </span>
              <div className="plugin-versions">
                {plugin.versions.map((version) => (
                  <label key={version.version} className="plugin-version">
                    <input
                      type="radio"
                      name={`version-${plugin.id}`}
                      checked={selected[plugin.id] === version.version}
                      onChange={() => setSelected((prev) => ({ ...prev, [plugin.id]: version.version }))}
                    />
                    <span>
                      v{version.version}
                      {version.version === plugin.latest && " (последняя)"} · навыков: {version.skills}
                      {version.sources ? ` · файлов: ${version.sources}` : ""}
                      {version.createdAt && ` · ${formatDate(version.createdAt)}`}
                      {version.note && ` — ${version.note}`}
                    </span>
                  </label>
                ))}
                {selected[plugin.id] !== undefined && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setSelected((prev) => {
                      const next = { ...prev };
                      delete next[plugin.id];
                      return next;
                    })}
                  >
                    Не включать в сборку
                  </button>
                )}
              </div>
            </div>
            <div className="plugin-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setTargetId(plugin.id);
                  setName(plugin.name);
                  setDescription(plugin.description);
                  setNotice(`Новая версия будет добавлена к «${plugin.name}».`);
                }}
              >
                Обновить до новой версии
              </button>
              <button type="button" className="btn btn-sm" onClick={() => window.api.openPluginFolder(plugin.dir)}>
                Показать файлы
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Удалить «${plugin.name}» со всеми версиями? Это необратимо.`)) return;
                  act(async () => {
                    await window.api.removePlugin(plugin.id);
                    await reload();
                  }, "Плагин удалён.");
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h3 className="card-title">
          {targetPlugin ? `Новая версия: ${targetPlugin.name}` : "Новый плагин"}
        </h3>
        {targetPlugin && (
          <p className="hint">
            Будет добавлена версия v{targetPlugin.latest + 1}. Прежние версии останутся в архиве.{" "}
            <button type="button" className="link-like" onClick={resetDraft}>
              Сохранить отдельным плагином
            </button>
          </p>
        )}

        <label className="field-label">Название</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(targetPlugin)} />

        <label className="field-label">Описание</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />

        <label className="field-label">Что изменилось в этой версии</label>
        <input
          className="input"
          placeholder="например: добавлен разбор договоров"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <label className="field-label">Навыки ({skills.length})</label>
        {skills.map((skill, index) => (
          <div key={index} className="plugin-skill">
            <span>{skill.name}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSkills((prev) => prev.filter((_, i) => i !== index))}
            >
              Убрать
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const picked = await window.api.pickPluginSkillFiles();
              if (picked.length) setSkills((prev) => [...prev, ...picked]);
            })
          }
        >
          Добавить файлы навыков
        </button>

        <label className="field-label">Исходники модуля ({sourcePaths.length})</label>
        {sourcePaths.map((source) => (
          <div key={source} className="plugin-skill">
            <code>{source}</code>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSourcePaths((prev) => prev.filter((p) => p !== source))}
            >
              Убрать
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const picked = await window.api.pickPluginSources();
              if (picked.length) setSourcePaths((prev) => [...new Set([...prev, ...picked])]);
            })
          }
        >
          Добавить файлы или папки
        </button>
        <p className="hint">
          Файлы копируются в архив целиком, а не запоминаются ссылкой: через полгода версия должна
          открываться, даже если исходники в репозитории давно переписаны.
        </p>

        <div className="sticky-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || (!targetPlugin && !name.trim()) || (!skills.length && !sourcePaths.length)}
            onClick={() =>
              act(async () => {
                const result = await window.api.addPluginVersion({
                  pluginId: targetId,
                  name,
                  description,
                  note,
                  skills,
                  sourcePaths,
                });
                await reload();
                resetDraft();
                setNotice(`Сохранено: ${result.id} v${result.version}.`);
              })
            }
          >
            Сохранить в архив
          </button>
          {targetPlugin && (
            <button type="button" className="btn" onClick={resetDraft}>
              Отмена
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Выгрузить в сборку</h3>
        <p className="hint">
          Навыки выбранных версий кладутся в папку сборки «Личного чата». В приложении тестировщика
          они видны по названию, но их текст не передаётся в окно и не редактируется. Папка
          пересобирается целиком, поэтому убранный плагин действительно исчезает из следующей сборки.
        </p>
        <p className="hint">
          Выбрано: {Object.keys(selected).length ? Object.keys(selected).length + " плагин(ов)" : "ничего"}.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const selections = Object.entries(selected).map(([id, version]) => ({ id, version }));
              const result = await window.api.exportPluginsToBuild(selections);
              if (!result) return;
              const skillCount = result.included.reduce((sum, item) => sum + item.skills, 0);
              setNotice(
                `В ${result.targetDir}: плагинов ${result.included.length}, навыков ${skillCount}.` +
                  (result.missing.length ? ` Без навыков и потому пропущены: ${result.missing.join(", ")}.` : "") +
                  " Теперь соберите «Личный чат» заново."
              );
            })
          }
        >
          Выгрузить выбранное
        </button>
      </section>

      {notice && <p className="notice-text">{notice}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
