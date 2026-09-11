import { useEffect, useState } from "react";
import type { ChatCopy, WorkspaceInfo } from "../lib/types";
import { errorText } from "./ConnectionStatus";

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
  // Второй источник правки: любая ветка на GitHub — код плагина, канонический
  // чат, чужая доработка. Папку на компьютере искать не нужно, и git не нужен.
  const [source, setSource] = useState<"copy" | "branch">("copy");
  const [repos, setRepos] = useState<{ fullName: string }[]>([]);
  const [repo, setRepo] = useState("");
  const [branches, setBranches] = useState<{ name: string }[]>([]);
  const [branch, setBranch] = useState("");
  const [subdir, setSubdir] = useState("");
  const [log, setLog] = useState<string[]>([]);
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

  useEffect(() => {
    // Канонический репозиторий — первый в списке: чаще всего правят именно его.
    window.api
      .copySource()
      .then((s) => {
        setRepo((prev) => prev || s.repo);
        setSubdir((prev) => prev || "personal-chat");
      })
      .catch(() => {});
    window.api
      .listBranchRepos()
      .then(setRepos)
      .catch(() => setRepos([]));
  }, []);

  useEffect(() => {
    if (!repo) return;
    window.api
      .listBranches(repo)
      .then((all) => {
        setBranches(all);
        setBranch((prev) => (all.some((b) => b.name === prev) ? prev : all[0]?.name || ""));
      })
      .catch(() => setBranches([]));
  }, [repo]);

  useEffect(() => window.api.onBranchLog((line) => setLog((prev) => [...prev, line])), []);

  /** Выкачивает ветку и открывает её как рабочую папку. */
  async function openBranch(handOverTask = "") {
    if (!repo || !branch) {
      setError("Выберите репозиторий и ветку.");
      return;
    }
    setLog([]);
    await act(async () => {
      const workspace = await window.api.openBranch({ repo, branch, subdir: subdir.trim() });
      if (handOverTask) await window.api.agentSend(handOverTask, {});
      onOpenCode(workspace);
      return workspace;
    }, handOverTask ? "Ветка выкачана, агент разбирается — вкладка «Код»." : "Ветка открыта — вкладка «Код».");
  }

  async function act<T>(fn: () => Promise<T>, success = ""): Promise<T | null> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await fn();
      if (success) setNotice(success);
      return value;
    } catch (e) {
      setError(errorText(e));
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
        Что-то сломалось у человека, которому вы выдали копию, — или в плагине, который вы делаете.
        Здесь нужный код открывается как рабочая папка: он выкачивается из GitHub (git на этом
        компьютере не нужен), агент разбирается и предлагает правку — вы её смотрите диффом и
        подтверждаете, как везде. Отправляет правку обратно вкладка «Git».
      </p>

      <section className="card">
        <h3 className="card-title">Что правим</h3>
        <div className="row">
          <label className="radio-line">
            <input
              type="radio"
              checked={source === "copy"}
              onChange={() => setSource("copy")}
            />{" "}
            Копию тестировщика
          </label>
          <label className="radio-line">
            <input
              type="radio"
              checked={source === "branch"}
              onChange={() => setSource("branch")}
            />{" "}
            Ветку на GitHub — чат или плагин
          </label>
        </div>
      </section>

      {source === "branch" && (
        <section className="card">
          <h3 className="card-title">Ветка</h3>
          <div className="row">
            <select className="input" value={repo} onChange={(e) => setRepo(e.target.value)}>
              {!repos.some((r) => r.fullName === repo) && repo && <option value={repo}>{repo}</option>}
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName}>
                  {r.fullName}
                </option>
              ))}
            </select>
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <label className="field-label">Папка внутри репозитория (необязательно)</label>
          <input
            className="input"
            placeholder="personal-chat"
            value={subdir}
            onChange={(e) => setSubdir(e.target.value)}
          />
          <p className="hint">
            В общем репозитории чат лежит в <code>personal-chat</code> — тогда в рабочей папке будет
            только он. У копии тестировщика код лежит в корне: поле оставьте пустым.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => openBranch()} disabled={busy}>
              {busy ? "Выкачиваю…" : "Подтянуть и открыть"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                openBranch(
                  [
                    `Ветка ${branch} репозитория ${repo}${subdir.trim() ? `, папка ${subdir.trim()}` : ""}.`,
                    description.trim() ? `Что не так:\n${description.trim()}` : "",
                    reportText.trim() ? `Отчёт о проблеме (${reportName}):\n\n${reportText.trim().slice(0, 20000)}` : "",
                    "Разберись по коду и предложи правку. Сначала прочитай нужные файлы.",
                  ]
                    .filter(Boolean)
                    .join("\n\n")
                )
              }
              disabled={busy || (!description.trim() && !reportText.trim())}
            >
              Отдать агенту
            </button>
          </div>
          {log.length > 0 && <pre className="build-log">{log.slice(-8).join("\n")}</pre>}
        </section>
      )}

      {source === "copy" && copies.length === 0 && (
        <section className="card">
          <p className="hint">
            Собранных копий пока нет. Соберите копию во вкладке «Демо» или «Чистовая сборка» — после
            этого её можно будет чинить отсюда.
          </p>
        </section>
      )}

      {source === "copy" && copies.length > 0 && (
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
