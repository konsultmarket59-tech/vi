import { useEffect, useState } from "react";
import type { WorkspaceInfo } from "../lib/types";
import { errorText } from "./ConnectionStatus";

interface Props {
  /** Открыть вкладку «Код»: там агент пишет и там подтверждают правки. */
  onOpenCode: (workspace: WorkspaceInfo) => void;
}

const CHAT_DIR = "personal-chat";

/** Название ветки из названия задумки: латиницей, без пробелов. */
function branchNameFrom(name: string, prefix: string): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const slug = [...name.trim().toLowerCase()]
    .map((ch) => translit[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${prefix}/${slug}` : "";
}

/**
 * Две задумки, которым нужен не копирайт чужой копии, а своё место в GitHub.
 *
 * «Новый плагин» — раздел внутрь «Личного чата»: ветка от main, код пишет агент,
 * потом обычный путь — коммит, запрос на слияние, проверка. «Новое приложение» —
 * отдельный репозиторий, который с копиями чата никак не связан.
 *
 * Папку на компьютере искать не нужно ни в том, ни в другом случае: ветка
 * выкачивается сама, и правки уезжают обратно через GitHub.
 */
export default function CreateView({ onOpenCode }: Props) {
  const [sourceRepo, setSourceRepo] = useState("");
  const [branches, setBranches] = useState<{ name: string; sha: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);

  // плагин
  const [pluginName, setPluginName] = useState("");
  const [pluginTask, setPluginTask] = useState("");
  const [pluginBranchMode, setPluginBranchMode] = useState<"new" | "existing">("new");
  const [pluginBranch, setPluginBranch] = useState("");

  // приложение
  const [appName, setAppName] = useState("");
  const [appTask, setAppTask] = useState("");
  const [appStart, setAppStart] = useState<"blank" | "chat">("blank");

  useEffect(() => {
    window.api
      .copySource()
      .then((s) => setSourceRepo(s.repo))
      .catch(() => setSourceRepo(""));
  }, []);

  useEffect(() => {
    if (!sourceRepo) return;
    window.api
      .listBranches(sourceRepo)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [sourceRepo]);

  useEffect(() => window.api.onBranchLog((line) => setLog((prev) => [...prev, line])), []);

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

  async function startPlugin() {
    if (!pluginName.trim()) {
      setError("Напишите название плагина — по нему называется и ветка.");
      return;
    }
    if (!pluginTask.trim()) {
      setError("Опишите, что плагин должен делать: это и есть задание агенту.");
      return;
    }
    setLog([]);
    const branch =
      pluginBranchMode === "existing" ? pluginBranch : branchNameFrom(pluginName, "plugin");
    if (!branch) {
      setError("Не получилось название ветки — напишите название латиницей или выберите ветку.");
      return;
    }

    await act(async () => {
      if (pluginBranchMode === "new") {
        await window.api.createBranch({ repo: sourceRepo, from: "main", name: branch });
      }
      const workspace = await window.api.openBranch({ repo: sourceRepo, branch, subdir: CHAT_DIR });
      await window.api.agentSend(
        [
          `Новый плагин «${pluginName.trim()}» для «Личного чата».`,
          `Что он должен делать:\n${pluginTask.trim()}`,
          "",
          "Рабочая папка — это папка personal-chat из ветки " + branch + ".",
          "Как устроены плагины здесь: раздел добавляется в MODULE_IDS в electron/plugins.cjs,",
          "в боковое меню в src/components/Sidebar.tsx, его экран — отдельный компонент в src/components,",
          "серверная часть — модуль в electron/ со своими ipcMain.handle и записями в electron/preload.cjs.",
          "Сначала прочитай, как сделан похожий раздел, и повтори его устройство.",
          "Покажи правки диффом — применять их буду я.",
        ].join("\n"),
        {}
      );
      onOpenCode(workspace);
      return workspace;
    }, "Ветка выкачана, задание отдано агенту — вкладка «Код».");
  }

  async function startApp() {
    if (!appName.trim()) {
      setError("Напишите название приложения — так будет называться репозиторий.");
      return;
    }
    if (!appTask.trim()) {
      setError("Опишите задумку: это задание агенту.");
      return;
    }
    setLog([]);
    await act(async () => {
      const created = await window.api.createApp({
        name: appName.trim(),
        description: appTask.trim().slice(0, 300),
        start: appStart,
      });
      const workspace = await window.api.openBranch({ repo: created.repo, branch: created.branch });
      await window.api.agentSend(
        [
          `Новое приложение «${appName.trim()}». Репозиторий ${created.repo}, ветка ${created.branch}.`,
          `Задумка:\n${appTask.trim()}`,
          "",
          appStart === "chat"
            ? "В папке — код «Личного чата» как отправная точка. Переделай его под задумку: лишнее убери."
            : "Папка почти пустая: реши, из чего собирать, и начни с самого скромного работающего варианта.",
          "Сначала предложи план в двух-трёх предложениях, потом первые правки диффом.",
        ].join("\n"),
        {}
      );
      onOpenCode(workspace);
      return workspace;
    }, "Репозиторий создан, задание отдано агенту — вкладка «Код».");
  }

  return (
    <div className="settings-view">
      <h2 className="view-title">Создать</h2>
      <p className="hint">
        Здесь начинается новое: раздел внутрь «Личного чата» или отдельное приложение. Папку на
        компьютере искать не нужно — ветка выкачивается из GitHub сама, а правки уезжают обратно
        оттуда же, во вкладке «Git».
      </p>

      <section className="card">
        <h3 className="card-title">Новый плагин для «Личного чата»</h3>
        <p className="hint">
          Плагин — это раздел в боковом меню чата: свой экран, своя логика, своё место в списке
          сборки. Работа идёт в отдельной ветке, главная не задевается.
        </p>

        <label className="field-label">Название раздела</label>
        <input
          className="input"
          placeholder="Сайты"
          value={pluginName}
          onChange={(e) => setPluginName(e.target.value)}
        />

        <label className="field-label">Что он должен делать</label>
        <textarea
          className="textarea"
          rows={5}
          placeholder="Собирает страницу под Тильду из материалов проекта: заголовок, блоки, фото. Кнопка «Собрать» — и готовый набор блоков."
          value={pluginTask}
          onChange={(e) => setPluginTask(e.target.value)}
        />

        <label className="field-label">Ветка</label>
        <div className="row">
          <select
            className="input"
            value={pluginBranchMode}
            onChange={(e) => setPluginBranchMode(e.target.value as "new" | "existing")}
          >
            <option value="new">Новая — от main</option>
            <option value="existing">Продолжить начатую</option>
          </select>
          {pluginBranchMode === "existing" ? (
            <select className="input" value={pluginBranch} onChange={(e) => setPluginBranch(e.target.value)}>
              <option value="">выберите ветку</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : (
            <code className="folder-path">{branchNameFrom(pluginName, "plugin") || "plugin/…"}</code>
          )}
        </div>

        <div className="sticky-actions">
          <button type="button" className="btn btn-primary" onClick={startPlugin} disabled={busy || !sourceRepo}>
            {busy ? "Готовлю…" : "Начать"}
          </button>
          <span className="hint">
            Дальше как обычно: агент пишет — вы смотрите диффом — «Git» отправляет в ветку и открывает
            запрос на слияние.
          </span>
        </div>
      </section>

      <section className="card">
        <h3 className="card-title">Новое приложение</h3>
        <p className="hint">
          Отдельная программа, не связанная с выпущенными копиями чата: свой репозиторий, своя
          сборка, свой установщик. Копии тестировщиков это никак не заденет.
        </p>

        <label className="field-label">Название</label>
        <input
          className="input"
          placeholder="Личный склад"
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
        />

        <label className="field-label">Задумка</label>
        <textarea
          className="textarea"
          rows={5}
          placeholder="Учёт остатков на складе: приход, расход, инвентаризация. Данные в обычных файлах на компьютере."
          value={appTask}
          onChange={(e) => setAppTask(e.target.value)}
        />

        <label className="field-label">С чего начать</label>
        <select className="input" value={appStart} onChange={(e) => setAppStart(e.target.value as "blank" | "chat")}>
          <option value="blank">С чистого листа</option>
          <option value="chat">С кода «Личного чата» как основы</option>
        </select>
        <p className="hint">
          {appStart === "chat"
            ? "В репозиторий уедет код чата — дальше агент переделывает его под задумку. Быстрее, но тащит за собой всё лишнее."
            : "В репозитории будет только описание и рабочий процесс сборки. Медленнее, зато без чужого хвоста."}
        </p>

        <div className="sticky-actions">
          <button type="button" className="btn btn-primary" onClick={startApp} disabled={busy}>
            {busy ? "Создаю…" : "Создать репозиторий и начать"}
          </button>
        </div>
      </section>

      {notice && <p className="notice-text">{notice}</p>}
      {error && <p className="error-text">{error}</p>}
      {log.length > 0 && <pre className="build-log">{log.slice(-12).join("\n")}</pre>}
    </div>
  );
}
