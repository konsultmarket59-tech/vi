import { useEffect, useState } from "react";
import type {
  Conversation,
  DirectCampaign,
  DirectKeyword,
  DirectStatRow,
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

type Tab = "campaigns" | "agent" | "settings";

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
  const [tab, setTab] = useState<Tab>("campaigns");
  const [clientLogin, setClientLogin] = useState("");
  const [connection, setConnection] = useState<string | null>(null);
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

  useEffect(() => {
    window.api.getDirectSettings().then((s) => setClientLogin(s.clientLogin));
  }, []);

  async function saveClientLogin() {
    const saved = await window.api.saveDirectSettings({ clientLogin });
    setClientLogin(saved.clientLogin);
    setNote("Сохранено");
    setTimeout(() => setNote(null), 2500);
  }

  async function test() {
    setTesting(true);
    try {
      const result = await window.api.testDirectConnection();
      setConnection(
        result.ok
          ? `Подключено: ${result.login}${result.info ? ` (${result.info})` : ""}${
              result.currency ? `, валюта ${result.currency}` : ""
            } ✓`
          : `Ошибка: ${result.error}`
      );
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
      setStats(report);
      setKeywords(keys);
      setNote(`Загружено: кампаний ${list.length}, строк статистики ${report.length}, фраз ${keys.length}`);
      setTimeout(() => setNote(null), 5000);
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
          </div>
          <div className="project-tabs">
            <button className={tab === "campaigns" ? "tab active" : "tab"} onClick={() => setTab("campaigns")}>
              Кампании
            </button>
            <button className={tab === "agent" ? "tab active" : "tab"} onClick={openAgent}>
              🤖 Агент
            </button>
            <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
              Подключение
            </button>
          </div>
        </div>

        {tab === "settings" && (
          <div className="panel-section">
            <p className="hint">
              Директ работает на том же токене Яндекса, что и «☁️ Облако». Если вы ещё не подключались —
              откройте «☁️ Облако» → «Подключение» и нажмите «Подключить Яндекс». Важно: в приложении на
              oauth.yandex.ru должны быть отмечены права <b>Яндекс.Директа</b> (вы их уже отметили) —
              иначе Директ вернёт ошибку доступа, даже если Диск работает.
            </p>
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
            {connection && <p className="hint chatbot-test-result">{connection}</p>}
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
