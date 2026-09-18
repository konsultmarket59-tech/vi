import { useEffect, useMemo, useState } from "react";
import ConnectionStatus, { CHECKING, errorText, failed, ok } from "./ConnectionStatus";
import type { ConnectionStatusValue } from "./ConnectionStatus";
import type {
  CloudAccounts,
  Conversation,
  DirectAudit,
  DirectCampaign,
  DirectKeyword,
  DirectOverview,
  DirectStatRow,
  DirectTableRow,
  DirectWordsReport,
  DirectWordstatItem,
  Settings,
  Skill,
} from "../lib/types";
import { parseDirectAction, uid, type ParsedDirectAction } from "../lib/promptBuilder";
import ChatView from "./ChatView";

interface Props {
  settings: Settings;
  skills: Skill[];
  onOpenSettings: () => void;
}

type Tab = "all" | "campaigns" | "words" | "agent" | "settings";

/** Yandex's state/status codes, in words. */
const STATE_LABEL: Record<string, string> = {
  ON: "работает",
  OFF: "выключена",
  SUSPENDED: "остановлена",
  ENDED: "завершена",
  CONVERTED: "перенесена",
  ARCHIVED: "в архиве",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function money(value: number): string {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

export default function DirectView({ settings, skills, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  // Все аккаунты сразу: кампании живут в трёх Директах, и вопрос «где сейчас
  // горит» — про все три одновременно. Переключаться ради этого не надо.
  const [overview, setOverview] = useState<DirectOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  // Отбор и столбцы таблицы. Выбор столбцов запоминается: собирать нужный
  // набор заново при каждом запуске — это работа, которую приложение обязано
  // взять на себя.
  const [stateFilter, setStateFilter] = useState("все");
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("cost");
  const [sortDesc, setSortDesc] = useState(true);
  const [showColumns, setShowColumns] = useState(false);
  const [chosen, setChosen] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("direct-columns");
      return saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [cell, setCell] = useState<{ title: string; value: string; text: string; loading: boolean } | null>(null);
  // Минус-слова, лишние запросы и площадки — отдельной кнопкой: отчёты тяжёлые,
  // и ждать их при каждом обновлении таблицы незачем.
  const [words, setWords] = useState<DirectWordsReport | null>(null);
  const [wordsLoading, setWordsLoading] = useState(false);
  const [wordsAccount, setWordsAccount] = useState("");
  const [wsPhrases, setWsPhrases] = useState("");
  const [wsGeo, setWsGeo] = useState("");
  const [wordstat, setWordstat] = useState<DirectWordstatItem[] | null>(null);
  const [wordstatLoading, setWordstatLoading] = useState(false);
  const [audit, setAudit] = useState<DirectAudit | null>(null);
  const [auditing, setAuditing] = useState("");
  const [clientLogin, setClientLogin] = useState("");
  const [cloudAccounts, setCloudAccounts] = useState<CloudAccounts>({
    yandex: { activeId: "", accounts: [] },
    google: { token: "" },
  });
  const [connection, setConnection] = useState<ConnectionStatusValue | null>(null);
  const [testing, setTesting] = useState(false);

  const [campaigns, setCampaigns] = useState<DirectCampaign[]>([]);
  const [stats, setStats] = useState<DirectStatRow[]>([]);
  const [keywords, setKeywords] = useState<DirectKeyword[]>([]);
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(30));
  const [dateTo, setDateTo] = useState(isoDaysAgo(1));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingAction, setPendingAction] = useState<ParsedDirectAction | null>(null);

  /** Re-reads whichever Yandex account is selected, and its Direct settings. */
  async function reloadAccount() {
    const [accounts, settings] = await Promise.all([
      window.api.getCloudAccounts(),
      window.api.getDirectSettings(),
    ]);
    setCloudAccounts(accounts);
    setClientLogin(settings.clientLogin);
  }

  useEffect(() => {
    reloadAccount();
  }, []);

  /**
   * Switching the Yandex account switches the Direct account with it, so everything
   * already on screen belongs to the previous one and has to go — otherwise last
   * account's campaigns would sit under the new account's name.
   */
  async function switchAccount(id: string) {
    await window.api.setActiveYandexAccount(id);
    setCampaigns([]);
    setStats([]);
    setKeywords([]);
    setPendingAction(null);
    setAgentConv(null);
    setConnection(null);
    setError(null);
    await reloadAccount();
  }

  const activeAccount =
    cloudAccounts.yandex.accounts.find((a) => a.id === cloudAccounts.yandex.activeId) ??
    cloudAccounts.yandex.accounts[0];

  async function saveClientLogin() {
    const saved = await window.api.saveDirectSettings({ clientLogin });
    setClientLogin(saved.clientLogin);
    setNote("Сохранено");
    setTimeout(() => setNote(null), 2500);
  }


  /**
   * Обзор по всем аккаунтам.
   *
   * Каждый аккаунт считается сам по себе и сам по себе падает: отказ одного —
   * это строка «вот с этим аккаунтом вот что», а не пустой экран вместо всех.
   */
  async function loadOverview() {
    setOverviewLoading(true);
    setNote("");
    try {
      const данные = await window.api.directOverview({});
      setOverview(данные);
      // Первый запуск: показываем набор столбцов по умолчанию, а не пустую
      // таблицу с предложением её настроить.
      if (!chosen.length) setChosen(данные.defaultColumns);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setOverviewLoading(false);
    }
  }

  function toggleColumn(id: string) {
    setChosen((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      try {
        localStorage.setItem("direct-columns", JSON.stringify(next));
      } catch {
        // Если хранилище недоступно, набор просто не запомнится — это не повод
        // ломать таблицу.
      }
      return next;
    });
  }

  /** Числа таблицы: суммы складываются, доли пересчитываются по суммам. */
  function visibleRows(): DirectTableRow[] {
    const запрос = search.trim().toLowerCase();
    const rows = (overview?.rows || []).filter((row) => {
      if (stateFilter !== "все" && row.state !== stateFilter) return false;
      if (accountFilter.length && !accountFilter.includes(row.accountId)) return false;
      if (запрос && !String(row.name || "").toLowerCase().includes(запрос)) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      const x = a[sortBy];
      const y = b[sortBy];
      if (typeof x === "number" || typeof y === "number") {
        const nx = typeof x === "number" ? x : -Infinity;
        const ny = typeof y === "number" ? y : -Infinity;
        return sortDesc ? ny - nx : nx - ny;
      }
      return sortDesc
        ? String(y ?? "").localeCompare(String(x ?? ""), "ru")
        : String(x ?? "").localeCompare(String(y ?? ""), "ru");
    });
  }

  /**
   * Итоги по тому, что сейчас видно.
   *
   * Средние не усредняются, а пересчитываются по суммам: иначе кампания на
   * триста рублей весит в среднем CPA столько же, сколько основная.
   */
  function totalsOf(rows: DirectTableRow[]): Record<string, number | null> {
    const сумма = (поле: string) =>
      rows.reduce((acc, row) => acc + (typeof row[поле] === "number" ? (row[поле] as number) : 0), 0);
    const доля = (верх: number, низ: number, множитель = 1) => (низ ? (верх / низ) * множитель : null);
    const cost = сумма("cost");
    const clicks = сумма("clicks");
    const impressions = сумма("impressions");
    const conversions = сумма("conversions");
    const revenue = сумма("revenue");
    return {
      cost,
      clicks,
      impressions,
      conversions,
      revenue,
      ctr: доля(clicks, impressions, 100),
      cpc: доля(cost, clicks),
      cpm: доля(cost, impressions, 1000),
      conversionRate: доля(conversions, clicks, 100),
      cpa: доля(cost, conversions),
      drr: доля(cost, revenue, 100),
      roi: доля(revenue - cost, cost, 100),
    };
  }

  function cellText(value: string | number | null, kind: string): string {
    if (value === null || value === undefined || value === "") return "—";
    if (kind === "текст" || kind === "дата") return String(value);
    return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }

  /**
   * «Почему тут такое число».
   *
   * Смысл кнопки не в том, чтобы показать определение показателя, а в том,
   * чтобы разобрать именно эту кампанию: те же 40 ₽ за клик в поиске и в сети
   * значат разное.
   */
  async function explainCell(row: DirectTableRow, columnId: string, title: string, value: string | number | null) {
    setCell({ title, value: cellText(value, "число"), text: "", loading: true });
    try {
      const ответ = await window.api.explainDirectCell({
        columnId,
        value,
        row,
        totals: overview?.totals || null,
        range: overview?.range || { dateFrom: "", dateTo: "" },
      });
      setCell({ title: `${title} · ${row.name}`, value: cellText(value, "число"), text: ответ.text, loading: false });
    } catch (e) {
      setCell({
        title,
        value: cellText(value, "число"),
        text: e instanceof Error ? e.message : String(e),
        loading: false,
      });
    }
  }

  const отобранные = useMemo(
    visibleRows,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, stateFilter, accountFilter, search, sortBy, sortDesc]
  );
  const итоги = useMemo(() => totalsOf(отобранные), [отобранные]);

  async function loadWords() {
    setWordsLoading(true);
    setNote("");
    try {
      setWords(await window.api.directWords({ accountId: wordsAccount || undefined }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setWordsLoading(false);
    }
  }

  async function runWordstat() {
    const фразы = wsPhrases
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!фразы.length) {
      setNote("Напишите хотя бы одну фразу — Вордстату нужно, что именно считать.");
      return;
    }
    setWordstatLoading(true);
    setNote("");
    try {
      setWordstat(
        await window.api.directWordstat({
          accountId: wordsAccount || undefined,
          phrases: фразы,
          geoIds: wsGeo
            .split(/[,\s]+/)
            .map((g) => Number(g))
            .filter(Boolean),
        })
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setWordstatLoading(false);
    }
  }

  /** Подробный разбор одного аккаунта — с фразами, которых нет в обзоре. */
  async function runAudit(accountId: string) {
    setAuditing(accountId);
    setNote("");
    try {
      setAudit(await window.api.directAudit({ accountId }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditing("");
    }
  }
  async function test() {
    setTesting(true);
    setConnection(CHECKING);
    try {
      const result = await window.api.testDirectConnection();
      setConnection(
        result.ok
          ? ok(
              `Подключено: ${result.login}${result.info ? ` (${result.info})` : ""}${
                result.currency ? `, валюта ${result.currency}` : ""
              }.`
            )
          : failed(result.error ? errorText(result.error) : "Не удалось подключиться к Яндекс.Директу.")
      );
    } catch (e) {
      setConnection(failed(errorText(e)));
    } finally {
      setTesting(false);
    }
  }

  /**
   * Pulls everything the agent reasons over in one go: the campaign list, the
   * performance report for the chosen period, and the keywords of the campaigns
   * that are actually running. Keywords for archived campaigns are skipped — they
   * would be the bulk of the data and none of the decisions.
   */
  async function loadAccount() {
    setLoading(true);
    setError(null);
    try {
      const list = await window.api.listDirectCampaigns();
      setCampaigns(list);
      const activeIds = list.filter((c) => c.state === "ON" || c.state === "SUSPENDED").map((c) => c.id);
      const [report, keys] = await Promise.all([
        window.api.getDirectStats({ dateFrom, dateTo }),
        activeIds.length ? window.api.listDirectKeywords(activeIds) : Promise.resolve([]),
      ]);
      setStats(report.rows);
      setKeywords(keys);
      setNote(
        `Загружено: кампаний ${list.length}, строк статистики ${report.rows.length}, фраз ${keys.length}` +
          (report.limited ? `\n${report.why}` : "")
      );
      // Оговорку про урезанный отчёт не прячем — иначе непонятно, почему
      // в таблице нет конверсий и дохода.
      if (!report.limited) setTimeout(() => setNote(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function openAgent() {
    setTab("agent");
    setAgentPrompt(await window.api.buildDirectAgentPrompt({ campaigns, stats, keywords }));
    const existing = await window.api.getDirectAgentConversation();
    if (existing) {
      setAgentConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      // Only offer an action that hasn't already been carried out or turned down.
      if (last && last.id !== existing.handledEditId) setPendingAction(parseDirectAction(last.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__direct_agent__",
        title: "Агент Директа",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveDirectAgentConversation(conv);
      setAgentConv(conv);
    }
  }

  function markActionHandled() {
    const last = [...(agentConv?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    if (last && agentConv) {
      const withMark = { ...agentConv, handledEditId: last.id };
      setAgentConv(withMark);
      window.api.saveDirectAgentConversation(withMark);
    }
    setPendingAction(null);
  }

  async function applyAction() {
    if (!pendingAction) return;
    setLoading(true);
    setError(null);
    try {
      let done: string;
      if (pendingAction.action === "bid") {
        await window.api.setDirectKeywordBid(pendingAction.target, pendingAction.value ?? 0);
        done = `Ставка фразы #${pendingAction.target} изменена на ${money(pendingAction.value ?? 0)}`;
      } else {
        await window.api.setDirectCampaignState(pendingAction.target, pendingAction.action === "resume");
        done = `Кампания #${pendingAction.target} ${pendingAction.action === "resume" ? "запущена" : "остановлена"}`;
      }
      markActionHandled();
      // Reload first: it reports its own progress, and would otherwise overwrite the
      // confirmation of what was just changed.
      await loadAccount();
      setNote(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function describeAction(a: ParsedDirectAction): string {
    if (a.action === "bid") return `Поставить ставку ${money(a.value ?? 0)} для фразы #${a.target}`;
    return `${a.action === "resume" ? "Запустить" : "Остановить"} кампанию #${a.target}`;
  }

  const statsById = new Map(stats.map((r) => [r.CampaignId, r]));

  return (
    <div className="ops-view">
      <div className="ops-app">
        <div className="ops-app-titlebar">
          <div className="ops-app-titlebar-title">
            <span className="ops-app-icon">📣</span>
            <h2>Яндекс Директ</h2>
            {cloudAccounts.yandex.accounts.length > 0 && (
              <select
                className="direct-account-picker"
                value={activeAccount?.id ?? ""}
                onChange={(e) => switchAccount(e.target.value)}
                title="Аккаунт Яндекса — у каждого свой Директ"
              >
                {cloudAccounts.yandex.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.login || "Без названия"}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="project-tabs">
            <button className={tab === "all" ? "tab active" : "tab"} onClick={() => setTab("all")}>
              Все аккаунты
            </button>
            <button className={tab === "campaigns" ? "tab active" : "tab"} onClick={() => setTab("campaigns")}>
              Кампании
            </button>
            <button className={tab === "words" ? "tab active" : "tab"} onClick={() => setTab("words")}>
              Слова и площадки
            </button>
            <button className={tab === "agent" ? "tab active" : "tab"} onClick={openAgent}>
              🤖 Агент
            </button>
            <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
              Подключение
            </button>
          </div>
        </div>

        {tab === "all" && (
          <div className="panel-section">
            <p className="hint">
              Все подключённые аккаунты Яндекса сразу: кампании, расход за последние 30 дней, баланс и
              найденные слабые места. Переключаться между аккаунтами для этого не нужно — и не нужно
              помнить, в каком из них что настроено.
            </p>
            <div className="folder-row">
              <button className="btn btn-primary" onClick={loadOverview} disabled={overviewLoading}>
                {overviewLoading ? "Собираю по всем аккаунтам…" : "Обновить"}
              </button>
              {overview && (
                <span className="hint">
                  Период: {overview.range.dateFrom} — {overview.range.dateTo}
                </span>
              )}
            </div>

            {overview && overview.rows.length > 0 && (
              <div className="direct-table-block">
                <div className="direct-filters">
                  {overview.states.map((st) => (
                    <button
                      key={st.id}
                      className={stateFilter === st.id ? "chip active" : "chip"}
                      onClick={() => setStateFilter(st.id)}
                    >
                      {st.title}
                      <span className="chip-count">
                        {st.id === "все"
                          ? overview.rows.length
                          : overview.rows.filter((r) => r.state === st.id).length}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="direct-filters">
                  {overview.accounts.map((acc) => (
                    <button
                      key={acc.id}
                      className={
                        accountFilter.length === 0 || accountFilter.includes(acc.id) ? "chip active" : "chip"
                      }
                      onClick={() =>
                        setAccountFilter((prev) =>
                          prev.includes(acc.id) ? prev.filter((x) => x !== acc.id) : [...prev, acc.id]
                        )
                      }
                    >
                      {acc.label || acc.login}
                    </button>
                  ))}
                  {accountFilter.length > 0 && (
                    <button className="link-btn" onClick={() => setAccountFilter([])}>
                      показать все аккаунты
                    </button>
                  )}
                  <input
                    className="input"
                    style={{ maxWidth: 220 }}
                    placeholder="Поиск по названию"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button className="link-btn" onClick={() => setShowColumns((v) => !v)}>
                    {showColumns ? "скрыть столбцы" : `столбцы (${chosen.length})`}
                  </button>
                </div>

                {showColumns && (
                  <div className="direct-columns-picker">
                    <p className="hint">
                      Отметьте показатели, которые нужны в таблице. Пустой столбец означает, что Директ или
                      Метрика этих данных не дают — например, доход считается только при настроенной
                      электронной коммерции.
                    </p>
                    {Array.from(new Set(overview.columns.map((c) => c.group))).map((group) => (
                      <div key={group} className="direct-columns-group">
                        <b>{group}</b>
                        {overview.columns
                          .filter((c) => c.group === group)
                          .map((c) => (
                            <label key={c.id} className="checkbox-row" title={c.explain}>
                              <input
                                type="checkbox"
                                checked={chosen.includes(c.id)}
                                onChange={() => toggleColumn(c.id)}
                              />
                              {c.title}
                            </label>
                          ))}
                      </div>
                    ))}
                  </div>
                )}

                <p className="hint">
                  Нажмите на любое число в таблице — агент разберёт, почему оно такое и что с этим делать.
                </p>

                <div className="direct-table-wrap">
                  <table className="direct-table">
                    <thead>
                      <tr>
                        {overview.columns
                          .filter((c) => chosen.includes(c.id))
                          .map((c) => (
                            <th
                              key={c.id}
                              title={c.explain}
                              onClick={() => {
                                if (sortBy === c.id) setSortDesc((v) => !v);
                                else {
                                  setSortBy(c.id);
                                  setSortDesc(true);
                                }
                              }}
                            >
                              {c.title}
                              {sortBy === c.id ? (sortDesc ? " ↓" : " ↑") : ""}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {отобранные.map((row) => (
                        <tr key={`${row.accountId}-${row.campaignId}`}>
                          {overview.columns
                            .filter((c) => chosen.includes(c.id))
                            .map((c) => (
                              <td
                                key={c.id}
                                className={c.kind === "текст" || c.kind === "дата" ? "" : "num"}
                                title={c.id === "state" ? row.stateNote : ""}
                                onClick={() => explainCell(row, c.id, c.title, row[c.id])}
                              >
                                {cellText(row[c.id], c.kind)}
                              </td>
                            ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        {overview.columns
                          .filter((c) => chosen.includes(c.id))
                          .map((c) => {
                            const значение = итоги[c.id];
                            return (
                              <td key={c.id} className={c.kind === "текст" || c.kind === "дата" ? "" : "num"}>
                                {c.id === "name"
                                  ? `Всего кампаний: ${отобранные.length}`
                                  : значение === undefined
                                    ? ""
                                    : cellText(значение ?? null, c.kind)}
                              </td>
                            );
                          })}
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {cell && (
                  <div className="direct-cell-answer">
                    <div className="direct-account-head">
                      <h3>{cell.title}</h3>
                      <button className="link-btn" onClick={() => setCell(null)}>
                        закрыть
                      </button>
                    </div>
                    {cell.loading ? <p className="hint">Разбираю…</p> : <pre className="pre-wrap">{cell.text}</pre>}
                  </div>
                )}
              </div>
            )}

            {overview?.accounts.map((acc) => (
              <div key={acc.id} className="direct-account">
                <div className="direct-account-head">
                  <h3>{acc.label}</h3>
                  {acc.login && <span className="hint">{acc.login}</span>}
                  {acc.balance ? (
                    <span className={acc.balance.amount <= 0 ? "direct-balance empty" : "direct-balance"}>
                      {money(acc.balance.amount)} {acc.balance.currency}
                      {acc.balance.debt ? ` · долг ${money(acc.balance.debt)}` : ""}
                    </span>
                  ) : (
                    <span className="hint" title={acc.balanceError}>
                      баланс недоступен
                    </span>
                  )}
                </div>

                {acc.error ? (
                  <div className="warning-banner">
                    {acc.error}
                    {/*
                      Код ошибки сам по себе человеку ничего не говорит. Разница
                      между «нет доступа» и «заявка не подана» — это разница
                      между «сломалось» и «надо сходить и нажать вот здесь».
                    */}
                    {acc.howToFix && <pre className="direct-howto">{acc.howToFix}</pre>}
                  </div>
                ) : (
                  <>
                    {acc.totals && (
                      <p className="hint">
                        Показов {acc.totals.impressions}, кликов {acc.totals.clicks}, CTR{" "}
                        {acc.totals.ctr.toFixed(2)}%, расход {money(acc.totals.cost)}, конверсий{" "}
                        {acc.totals.conversions}
                        {acc.totals.cpa ? `, цена конверсии ${money(acc.totals.cpa)}` : ""}
                      </p>
                    )}
                    {acc.campaigns.length === 0 ? (
                      <p className="hint">Кампаний в этом аккаунте нет.</p>
                    ) : (
                      <div className="ops-table-scroll">
                        <table className="ops-table">
                          <thead>
                            <tr>
                              <th>Кампания</th>
                              <th>Состояние</th>
                              <th>Показы</th>
                              <th>Клики</th>
                              <th>CTR</th>
                              <th>Расход</th>
                              <th>Конверсии</th>
                            </tr>
                          </thead>
                          <tbody>
                            {acc.campaigns.map((c) => {
                              const row = acc.stats.find((r) => String(r.CampaignId) === String(c.id));
                              return (
                                <tr key={c.id}>
                                  <td>{c.name}</td>
                                  <td>{STATE_LABEL[c.state] || c.state}</td>
                                  <td>{row ? row.Impressions : "—"}</td>
                                  <td>{row ? row.Clicks : "—"}</td>
                                  <td>{row ? `${row.Ctr}%` : "—"}</td>
                                  <td>{row ? money(Number(row.Cost)) : "—"}</td>
                                  <td>{row ? row.Conversions ?? "—" : "—"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {!!acc.issues.length && (
                      <div className="direct-issues">
                        <h4>Слабые места</h4>
                        {acc.issues.map((i, n) => (
                          <div key={n} className={`direct-issue level-${i.level}`}>
                            <b>{i.what}</b>
                            <span className="hint">{i.why}</span>
                            <span>{i.fix}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      className="btn btn-secondary"
                      onClick={() => runAudit(acc.id)}
                      disabled={auditing === acc.id}
                    >
                      {auditing === acc.id ? "Разбираю…" : "Разобрать подробно (с фразами)"}
                    </button>
                  </>
                )}
              </div>
            ))}

            {audit && (
              <div className="direct-account">
                <h3>Подробный разбор: {audit.account.label}</h3>
                <p className="hint">
                  {audit.range.dateFrom} — {audit.range.dateTo} · кампаний {audit.campaigns.length} · фраз{" "}
                  {audit.keywordCount}
                </p>
                {/*
                  Арифметика посчитана кодом, а не моделью: решения здесь
                  денежные, и ошибка в числе стоит настоящих денег. Каждая
                  находка несёт числа, по которым она сделана.
                */}
                <pre className="direct-howto">{audit.text}</pre>
                <div className="folder-row">
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(audit.text);
                      setNote("Разбор скопирован — можно отдать его агенту или вставить в отчёт.");
                    }}
                  >
                    Скопировать разбор
                  </button>
                  <button className="link-btn" onClick={() => setAudit(null)}>
                    закрыть
                  </button>
                </div>
              </div>
            )}

            {!overview && !overviewLoading && (
              <p className="hint">Нажмите «Обновить» — приложение обойдёт все подключённые аккаунты.</p>
            )}
          </div>
        )}

        {tab === "words" && (
          <div className="panel-section">
            <p className="hint">
              Здесь видно, по каким запросам на самом деле показывались объявления и на каких площадках сети
              потрачены деньги. Разница между ключевой фразой и реальным запросом — это и есть то место, где
              бюджет утекает незаметно: по одному запросу сорок рублей, а по слову целиком — несколько тысяч.
            </p>
            <div className="folder-row">
              <select
                className="input"
                value={wordsAccount}
                onChange={(e) => setWordsAccount(e.target.value)}
                style={{ maxWidth: 260 }}
              >
                <option value="">Аккаунт: активный</option>
                {cloudAccounts.yandex.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label || a.login}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={loadWords} disabled={wordsLoading}>
                {wordsLoading ? "Собираю отчёты…" : "Разобрать запросы и площадки"}
              </button>
              {words && (
                <span className="hint">
                  Период: {words.range.dateFrom} — {words.range.dateTo}
                </span>
              )}
            </div>

            {words && (
              <>
                {(words.queriesError || words.placementsError) && (
                  <p className="direct-howto">
                    {words.queriesError && `Отчёт по запросам не пришёл: ${words.queriesError}\n`}
                    {words.placementsError && `Отчёт по площадкам не пришёл: ${words.placementsError}`}
                  </p>
                )}

                <div className="direct-account">
                  <div className="direct-account-head">
                    <h3>Кандидаты в минус-слова</h3>
                    <span className="direct-balance">{money(words.waste.words)} ₽ без конверсий</span>
                  </div>
                  {words.minus.length === 0 ? (
                    <p className="hint">Слов, на которые уходят деньги без отдачи, не нашлось.</p>
                  ) : (
                    <div className="direct-table-wrap">
                      <table className="direct-table">
                        <thead>
                          <tr>
                            <th>Слово</th>
                            <th>Расход, ₽</th>
                            <th>Клики</th>
                            <th>Примеры запросов</th>
                          </tr>
                        </thead>
                        <tbody>
                          {words.minus.map((m) => (
                            <tr key={m.word}>
                              <td title={m.fix}>
                                {m.word}
                                {m.known ? " ⚑" : ""}
                              </td>
                              <td className="num">{money(m.cost)}</td>
                              <td className="num">{m.clicks}</td>
                              <td title={m.why}>{m.queries.slice(0, 3).join(" · ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="hint">
                    ⚑ — слово из списка тех, что почти всегда означают не покупателя. «Почти» здесь важное:
                    «отзывы» мусор для продажи и не мусор для репутационной кампании, поэтому решение остаётся
                    за вами. Приложение ничего не отключает само.
                  </p>
                </div>

                <div className="direct-account">
                  <div className="direct-account-head">
                    <h3>Площадки под отключение</h3>
                    <span className="direct-balance">{money(words.waste.placements)} ₽</span>
                  </div>
                  {words.placements.length === 0 ? (
                    <p className="hint">Площадок с заметным расходом без конверсий не нашлось.</p>
                  ) : (
                    <div className="direct-table-wrap">
                      <table className="direct-table">
                        <thead>
                          <tr>
                            <th>Площадка</th>
                            <th>Кампания</th>
                            <th>Расход, ₽</th>
                            <th>Клики</th>
                          </tr>
                        </thead>
                        <tbody>
                          {words.placements.map((p) => (
                            <tr key={`${p.placement}-${p.campaign}`}>
                              <td title={p.fix}>
                                {p.placement}
                                {p.app ? " 📱" : ""}
                              </td>
                              <td>{p.campaign}</td>
                              <td className="num">{money(p.cost)}</td>
                              <td className="num">{p.clicks}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="hint">📱 — мобильное приложение: клик там чаще всего случайный.</p>
                </div>

                <div className="folder-row">
                  <button
                    className="btn"
                    onClick={() => {
                      navigator.clipboard.writeText(words.text);
                      setNote("Разбор скопирован.");
                    }}
                  >
                    Скопировать разбор
                  </button>
                </div>
              </>
            )}

            <div className="direct-account">
              <div className="direct-account-head">
                <h3>Вордстат</h3>
              </div>
              <p className="hint">
                Сколько раз фразу спрашивают и что спрашивают рядом с ней. Отсюда берут и новые ключевые
                фразы, и минус-слова — до того, как деньги потрачены. До десяти фраз за раз, по одной в
                строке. Регион — номер из Яндекса (Пермский край — 50), можно оставить пустым.
              </p>
              <textarea
                className="input"
                rows={4}
                placeholder={"дом из бруса\nкаркасный дом под ключ"}
                value={wsPhrases}
                onChange={(e) => setWsPhrases(e.target.value)}
              />
              <div className="folder-row">
                <input
                  className="input"
                  style={{ maxWidth: 200 }}
                  placeholder="Регион, например 50"
                  value={wsGeo}
                  onChange={(e) => setWsGeo(e.target.value)}
                />
                <button className="btn btn-primary" onClick={runWordstat} disabled={wordstatLoading}>
                  {wordstatLoading ? "Вордстат считает…" : "Посчитать"}
                </button>
              </div>
              {wordstat?.map((item) => (
                <div key={item.phrase} className="direct-issues">
                  <h4>{item.phrase}</h4>
                  <div className="direct-table-wrap">
                    <table className="direct-table">
                      <thead>
                        <tr>
                          <th>Запрос</th>
                          <th>Показов в месяц</th>
                        </tr>
                      </thead>
                      <tbody>
                        {item.with.slice(0, 50).map((w) => (
                          <tr key={w.phrase}>
                            <td>{w.phrase}</td>
                            <td className="num">{money(w.shows)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {item.also.length > 0 && (
                    <p className="hint">
                      Искали также: {item.also.slice(0, 15).map((w) => w.phrase).join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div className="panel-section">
            <p className="hint">
              Директ работает на токене того аккаунта Яндекса, который выбран сверху — у каждого аккаунта
              свой Директ. Аккаунты добавляются в разделе «☁️ Облако» → «Подключение»; там же их можно
              переименовать и отключить. Важно: в приложении на oauth.yandex.ru должны быть отмечены права{" "}
              <b>Яндекс.Директа</b> — иначе Директ вернёт ошибку доступа, даже если Диск работает.
            </p>
            {activeAccount ? (
              <p className="hint">
                Сейчас выбран аккаунт: <b>{activeAccount.label || activeAccount.login || "без названия"}</b>
                {activeAccount.login && activeAccount.label !== activeAccount.login ? ` (${activeAccount.login})` : ""}.
                Настройка ниже относится именно к нему.
              </p>
            ) : (
              <div className="warning-banner">Ни один аккаунт Яндекса не подключён — добавьте его в «☁️ Облако».</div>
            )}
            <label>Логин клиента (только для агентских аккаунтов)</label>
            <input
              value={clientLogin}
              placeholder="оставьте пустым, если это ваш собственный аккаунт"
              onChange={(e) => setClientLogin(e.target.value)}
            />
            <p className="hint">
              Если вы ведёте рекламу клиента из агентского аккаунта — впишите его логин. Для своего аккаунта
              поле не нужно.
            </p>
            <div className="settings-actions">
              <button className="btn btn-secondary" onClick={test} disabled={testing}>
                {testing ? "Проверка…" : "Проверить"}
              </button>
              <button className="btn btn-primary" onClick={saveClientLogin}>
                Сохранить
              </button>
            </div>
            <ConnectionStatus status={connection} />
            {note && <p className="hint">{note}</p>}
          </div>
        )}

        {tab === "campaigns" && (
          <div className="panel-section">
            <div className="folder-row">
              <label className="direct-date">
                с <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </label>
              <label className="direct-date">
                по <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </label>
              <button className="btn btn-primary" onClick={loadAccount} disabled={loading}>
                {loading ? "Загрузка…" : "Загрузить данные"}
              </button>
            </div>
            <p className="hint">
              Загружаются кампании, статистика за выбранный период и ключевые фразы работающих кампаний. Эти же
              данные видит агент на соседней вкладке.
            </p>

            {error && <div className="chat-error">{error}</div>}
            {note && <p className="hint">{note}</p>}

            {campaigns.length > 0 && (
              <div className="ops-table-scroll">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Кампания</th>
                      <th>Состояние</th>
                      <th>Показы</th>
                      <th>Клики</th>
                      <th>CTR</th>
                      <th>Расход</th>
                      <th>Ср. цена клика</th>
                      <th>Конверсии</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => {
                      const row = statsById.get(c.id);
                      return (
                        <tr key={c.id}>
                          <td>{c.name}</td>
                          <td>{STATE_LABEL[c.state] || c.state}</td>
                          <td>{row ? row.Impressions.toLocaleString("ru-RU") : "—"}</td>
                          <td>{row ? row.Clicks.toLocaleString("ru-RU") : "—"}</td>
                          <td>{row ? `${money(row.Ctr)}%` : "—"}</td>
                          <td>{row ? money(row.Cost) : "—"}</td>
                          <td>{row ? money(row.AvgCpc) : "—"}</td>
                          <td>{row ? row.Conversions : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {campaigns.length === 0 && !loading && !error && (
              <p className="hint">
                Пока пусто. Нажмите «Загрузить данные» — если аккаунт ещё не подключён, приложение подскажет,
                что сделать.
              </p>
            )}
          </div>
        )}

        {tab === "agent" && (
          <div className="ops-app-body ops-app-agent">
            <p className="hint ops-agent-hint">
              Агент видит кампании, статистику за выбранный период и ключевые фразы со ставками. Спрашивайте
              «где сливается бюджет», «какие фразы отключить», «что не так со структурой». Любое изменение в
              аккаунте он только предлагает — применяете вы. Можно подключить навык: 🎯 под полем ввода.
            </p>
            {!settings.apiKey && (
              <div className="warning-banner">
                API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
              </div>
            )}
            {campaigns.length === 0 && (
              <div className="warning-banner">
                Данные аккаунта не загружены — агенту нечего анализировать.{" "}
                <button className="link-btn" onClick={() => setTab("campaigns")}>
                  Загрузить
                </button>
              </div>
            )}
            {error && <div className="chat-error">{error}</div>}
            {note && <p className="hint">{note}</p>}
            {pendingAction && (
              <div className="pending-skill-banner excel-pending-edit">
                <div className="excel-pending-summary">
                  <strong>Предложено: {describeAction(pendingAction)}</strong>
                </div>
                {pendingAction.why && <div className="excel-pending-sheet">Причина: {pendingAction.why}</div>}
                <div className="excel-pending-actions">
                  <button className="btn btn-primary" onClick={applyAction} disabled={loading}>
                    Применить в Директе
                  </button>
                  <button className="btn btn-secondary" onClick={markActionHandled}>
                    Отклонить
                  </button>
                </div>
              </div>
            )}
            {agentConv && (
              <ChatView
                conversation={agentConv}
                systemPrompt={agentPrompt}
                settings={settings}
                skills={skills}
                onUpdate={setAgentConv}
                onSave={(conv) => window.api.saveDirectAgentConversation(conv)}
                emptyHint="Например: «Где сливается бюджет за месяц?» или «Какие фразы стоит отключить и почему»."
                onAssistantMessage={(content) => setPendingAction(parseDirectAction(content))}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
