import { useEffect, useState } from "react";
import type { ChatCopy, WorkspaceInfo } from "../lib/types";

interface Props {
  /** Открыть вкладку «Код»: там агент показывает правки и там их подтверждают. */
  onOpenCode: (workspace: WorkspaceInfo) => void;
}

/**
 * Починка копии, которая уже у человека.
 *
 * Тестировщик присылает файл отчёта («Создать отчёт о проблеме» в его копии) или
 * просто пишет, что не работает. Здесь это превращается в задачу агенту, но —
 * важное — в коде именно этой копии: её репозиторий выкачивается на компьютер,
 * открывается как рабочая папка, и дальше всё идёт обычным порядком — агент
 * предлагает правку диффом, вы её подтверждаете и коммитите во вкладке «Git».
 */
export default function FixView({ onOpenCode }: Props) {
  const [copies, setCopies] = useState<ChatCopy[]>([]);
  const [selected, setSelected] = useState("");
  const [reportText, setReportText] = useState("");
  const [reportName, setReportName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    window.api
      .listCopies()
      .then((all) => {
        const built = all.filter((c) => c.repoFullName);
        setCopies(built);
        if (built[0]) setSelected(built[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const copy = copies.find((c) => c.id === selected) || null;

  async function act<T>(fn: () => Promise<T>, success = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      if (success) setNotice(success);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function loadReport() {
    const picked = await act(() => window.api.pickTextFile());
    if (!picked) return;
    setReportName(picked.name);
    setReportText(picked.content);
  }

  async function openCode() {
    if (!copy) return;
    const workspace = await act(
      () => window.api.openCopyCode(copy.id),
      "Код копии открыт — вкладка «Код»."
    );
    if (workspace) onOpenCode(workspace);
  }

  async function handOver() {
    if (!copy) return;
    const task = [
      `Копия «${copy.displayName}» (репозиторий ${copy.repoFullName}).`,
      description.trim() ? `Что не работает, со слов человека:\n${description.trim()}` : "",
      reportText.trim()
        ? `Отчёт о проблеме из копии (${reportName}):\n\n${reportText.trim().slice(0, 20000)}`
        : "",
      "Разберись в причине по коду этой копии и предложи правку. Сначала прочитай нужные файлы.",
    ]
      .filter(Boolean)
      .join("\n\n");

    await act(async () => {
      const workspace = await window.api.openCopyCode(copy.id);
      await window.api.agentSend(task, {});
      onOpenCode(workspace);
    }, "Агент разбирается — правки появятся во вкладке «Код».");
  }

  return (
    <div className="settings-view">
      <h2 className="view-title">Фикс</h2>
      <p className="hint">
        Что-то сломалось у человека, которому вы выдали копию. Здесь его копия открывается как
        обычная рабочая папка: репозиторий выкачивается на компьютер, агент разбирается в коде
        именно этой копии и предлагает правку — вы её смотрите диффом и подтверждаете, как везде.
      </p>

      {copies.length === 0 && (
        <section className="card">
          <p className="hint">
            Собранных копий пока нет. Соберите копию во вкладке «Демо» или «Чистовая сборка» — после
            этого её можно будет чинить отсюда.
          </p>
        </section>
      )}

      {copies.length > 0 && (
        <>
          <section className="card">
            <h3 className="card-title">Чья копия</h3>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {copies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName} — {c.repoFullName}
                </option>
              ))}
            </select>
            {copy && (
              <div className="row">
                <button type="button" className="btn" onClick={openCode} disabled={busy}>
                  Открыть код копии
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.api.openExternal(`https://github.com/${copy.repoFullName}`)}
                >
                  Репозиторий на GitHub
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.api.openExternal(`https://github.com/${copy.repoFullName}/actions`)}
                >
                  Сборки
                </button>
              </div>
            )}
          </section>

          <section className="card">
            <h3 className="card-title">Что не работает</h3>
            <p className="hint">
              Можно подгрузить файл отчёта, который человек создал у себя кнопкой «Создать отчёт о
              проблеме» — в нём версия, система и последние ошибки приложения. Или просто написать
              своими словами.
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={loadReport} disabled={busy}>
                Подгрузить файл отчёта
              </button>
              {reportName && <span className="hint">Загружен: {reportName}</span>}
              {reportName && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setReportName("");
                    setReportText("");
                  }}
                >
                  Убрать
                </button>
              )}
            </div>

            <label className="field-label">Своими словами</label>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Например: при открытии таблицы продаж окно белеет и ничего не происходит."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </section>

          <div className="sticky-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handOver}
              disabled={busy || (!description.trim() && !reportText.trim())}
            >
              {busy ? "Работаю…" : "Отдать агенту"}
            </button>
            {notice && <span className="notice-text">{notice}</span>}
            {error && <span className="error-text">{error}</span>}
          </div>
        </>
      )}
    </div>
  );
}
