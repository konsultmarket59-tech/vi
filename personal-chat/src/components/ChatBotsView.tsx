import { useEffect, useState } from "react";
import type {
  ChatbotAccounts,
  ChatbotMessage,
  ChatbotPlatform,
  ChatbotStatusMap,
  Funnel,
  Lead,
  Project,
} from "../lib/types";
import { uid } from "../lib/promptBuilder";

type Tab = "settings" | "funnels" | "inbox";

const PLATFORM_LABEL: Record<ChatbotPlatform, string> = { telegram: "Telegram", vk: "ВКонтакте", max: "MAX" };
const PLATFORMS: ChatbotPlatform[] = ["telegram", "vk", "max"];

const EMPTY_ACCOUNTS: ChatbotAccounts = {
  telegram: { token: "", enabled: false, aiEnabled: false, aiProjectId: "" },
  vk: { token: "", groupId: "", enabled: false, aiEnabled: false, aiProjectId: "" },
  max: { token: "", apiBase: "", enabled: false, aiEnabled: false, aiProjectId: "" },
};

function emptyFunnel(): Funnel {
  return { id: uid(), name: "Новая воронка", trigger: { type: "keyword", keyword: "" }, platforms: [], steps: [{ delayMinutes: 0, text: "" }] };
}

export default function ChatBotsView() {
  const [tab, setTab] = useState<Tab>("settings");
  const [accounts, setAccounts] = useState<ChatbotAccounts>(EMPTY_ACCOUNTS);
  const [status, setStatus] = useState<ChatbotStatusMap>({ telegram: false, vk: false, max: false });
  const [testResult, setTestResult] = useState<Partial<Record<ChatbotPlatform, string>>>({});
  const [testing, setTesting] = useState<ChatbotPlatform | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    window.api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  /** The "answer with AI from a project's knowledge base" controls, identical on every platform. */
  function renderAiBlock(platform: ChatbotPlatform) {
    const account = accounts[platform];
    return (
      <div className="chatbot-ai-block">
        <label>
          <input
            type="checkbox"
            checked={!!account.aiEnabled}
            onChange={(e) =>
              setAccounts({ ...accounts, [platform]: { ...account, aiEnabled: e.target.checked } })
            }
          />{" "}
          Отвечать с помощью ИИ по базе проекта
        </label>
        {account.aiEnabled && (
          <>
            <label>Проект — база знаний бота</label>
            <select
              value={account.aiProjectId ?? ""}
              onChange={(e) =>
                setAccounts({ ...accounts, [platform]: { ...account, aiProjectId: e.target.value } })
              }
            >
              <option value="">— выберите проект —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="hint">
              Бот будет отвечать в рамках инструкций, навыков и документов выбранного проекта и помнить
              переписку с каждым человеком. Пока проект не выбран, ИИ-ответы не отправляются. В этом режиме
              воронки для площадки не срабатывают — отвечает только ИИ.
            </p>
          </>
        )}
      </div>
    );
  }

  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null);

  const [inboxPlatform, setInboxPlatform] = useState<ChatbotPlatform>("telegram");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [messages, setMessages] = useState<ChatbotMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    window.api.getChatbotAccounts().then(setAccounts);
    window.api.getChatbotStatus().then(setStatus);
    window.api.getFunnels().then(setFunnels);
    const unsubStatus = window.api.onChatbotStatus(() => window.api.getChatbotStatus().then(setStatus));
    return unsubStatus;
  }, []);

  useEffect(() => {
    const unsubMsg = window.api.onChatbotMessage(({ platform, message }) => {
      if (platform !== inboxPlatform) return;
      setMessages((prev) => [...prev, message]);
      refreshLeads();
    });
    return unsubMsg;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxPlatform]);

  useEffect(() => {
    if (tab === "inbox") {
      refreshLeads();
      setSelectedLead(null);
      setMessages([]);
    }
  }, [tab, inboxPlatform]);

  useEffect(() => {
    if (selectedLead) {
      window.api.getChatbotMessages(inboxPlatform).then((all) => setMessages(all.filter((m) => m.userId === selectedLead.userId)));
    }
  }, [selectedLead, inboxPlatform]);

  async function refreshLeads() {
    setLeads((await window.api.getChatbotLeads(inboxPlatform)).sort((a, b) => b.lastMessageAt - a.lastMessageAt));
  }

  async function saveAccountsField() {
    const saved = await window.api.saveChatbotAccounts(accounts);
    setAccounts(saved);
  }

  async function testPlatform(platform: ChatbotPlatform) {
    setTesting(platform);
    try {
      const result = await window.api.testChatbotConnection(platform, accounts[platform]);
      // MAX lives on more than one host; if the test found a working one that isn't the
      // saved one, fill it in so "Сохранить" keeps it.
      if (result.ok && platform === "max" && result.switched) {
        setAccounts((prev) => ({ ...prev, max: { ...prev.max, apiBase: result.switched as string } }));
      }
      setTestResult((prev) => ({
        ...prev,
        [platform]: result.ok
          ? `Подключено${result.login ? `: ${result.login}` : ""} ✓${
              result.switched ? ` (сработал адрес ${result.switched} — нажмите «Сохранить», чтобы запомнить его)` : ""
            }`
          : `Ошибка: ${result.error}`,
      }));
    } finally {
      setTesting(null);
    }
  }

  async function toggleRun(platform: ChatbotPlatform) {
    const next = status[platform] ? await window.api.stopChatbot(platform) : await window.api.startChatbot(platform);
    setStatus(next);
  }

  function openNewFunnel() {
    setEditingFunnel(emptyFunnel());
  }

  async function saveFunnelDraft() {
    if (!editingFunnel) return;
    const exists = funnels.some((f) => f.id === editingFunnel.id);
    const next = exists ? funnels.map((f) => (f.id === editingFunnel.id ? editingFunnel : f)) : [...funnels, editingFunnel];
    const saved = await window.api.saveFunnels(next);
    setFunnels(saved);
    setEditingFunnel(null);
  }

  async function deleteFunnel(id: string) {
    if (!confirm("Удалить воронку?")) return;
    const saved = await window.api.saveFunnels(funnels.filter((f) => f.id !== id));
    setFunnels(saved);
  }

  function updateStep(index: number, patch: Partial<{ delayMinutes: number; text: string }>) {
    if (!editingFunnel) return;
    const steps = editingFunnel.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setEditingFunnel({ ...editingFunnel, steps });
  }

  async function sendReply() {
    if (!selectedLead || !replyText.trim()) return;
    setSending(true);
    try {
      const msg = await window.api.sendChatbotMessage(inboxPlatform, selectedLead.userId, replyText.trim());
      setMessages((prev) => [...prev, msg]);
      setReplyText("");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chatbots-view">
      <div className="ops-toolbar">
        <h2>Чат-боты и воронки</h2>
        <div className="project-tabs">
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
            Настройки
          </button>
          <button className={tab === "funnels" ? "tab active" : "tab"} onClick={() => setTab("funnels")}>
            Воронки
          </button>
          <button className={tab === "inbox" ? "tab active" : "tab"} onClick={() => setTab("inbox")}>
            Входящие
          </button>
        </div>
      </div>

      {tab === "settings" && (
        <div className="panel-section">
          <p className="hint">
            Боты работают, пока открыто это приложение и нажата кнопка «Запустить» — это не отдельный
            круглосуточный сервер. Для площадок с высоким трафиком, где нужна гарантированная доступность 24/7,
            это стоит учитывать: пока приложение закрыто, бот не отвечает.
          </p>

          <div className="chatbot-account-card">
            <h3>Telegram {status.telegram && <span className="chatbot-status-dot" />}</h3>
            <label>Токен бота (от @BotFather)</label>
            <input
              type="password"
              value={accounts.telegram.token}
              onChange={(e) => setAccounts({ ...accounts, telegram: { ...accounts.telegram, token: e.target.value } })}
            />
            {renderAiBlock("telegram")}
            <div className="settings-actions">
              <button className="btn btn-secondary" onClick={() => testPlatform("telegram")} disabled={testing === "telegram"}>
                Проверить
              </button>
              <button className="btn btn-secondary" onClick={saveAccountsField}>
                Сохранить
              </button>
              <button className="btn btn-primary" onClick={() => toggleRun("telegram")}>
                {status.telegram ? "Остановить" : "Запустить"}
              </button>
            </div>
            {testResult.telegram && <p className="hint chatbot-test-result">{testResult.telegram}</p>}
          </div>

          <div className="chatbot-account-card">
            <h3>ВКонтакте {status.vk && <span className="chatbot-status-dot" />}</h3>
            <label>Токен сообщества</label>
            <input type="password" value={accounts.vk.token} onChange={(e) => setAccounts({ ...accounts, vk: { ...accounts.vk, token: e.target.value } })} />
            <label>ID сообщества</label>
            <input value={accounts.vk.groupId} onChange={(e) => setAccounts({ ...accounts, vk: { ...accounts.vk, groupId: e.target.value } })} />
            {renderAiBlock("vk")}
            <div className="settings-actions">
              <button className="btn btn-secondary" onClick={() => testPlatform("vk")} disabled={testing === "vk"}>
                Проверить
              </button>
              <button className="btn btn-secondary" onClick={saveAccountsField}>
                Сохранить
              </button>
              <button className="btn btn-primary" onClick={() => toggleRun("vk")}>
                {status.vk ? "Остановить" : "Запустить"}
              </button>
            </div>
            {testResult.vk && <p className="hint chatbot-test-result">{testResult.vk}</p>}
          </div>

          <div className="chatbot-account-card">
            <h3>MAX {status.max && <span className="chatbot-status-dot" />}</h3>
            <label>Токен бота</label>
            <input type="password" value={accounts.max.token} onChange={(e) => setAccounts({ ...accounts, max: { ...accounts.max, token: e.target.value } })} />
            <label>Адрес API (менять не нужно, если всё работает)</label>
            <input
              value={accounts.max.apiBase}
              placeholder="https://botapi.max.ru"
              onChange={(e) => setAccounts({ ...accounts, max: { ...accounts.max, apiBase: e.target.value } })}
            />
            <p className="hint">
              У платформы MAX бот-API встречается на разных адресах. «Проверить» само переберёт известные и
              подставит сюда тот, который ответил. Если появится ошибка про сертификат — Windows не доверяет
              сертификату сайта: нужно один раз установить «Российский доверенный корневой сертификат»
              (найдите на{" "}
              <a href="https://www.gosuslugi.ru/" target="_blank" rel="noreferrer">
                gosuslugi.ru
              </a>{" "}
              страницу «Установка сертификатов») в раздел «Доверенные корневые центры сертификации» и
              перезапустить приложение.
            </p>
            {renderAiBlock("max")}
            <div className="settings-actions">
              <button className="btn btn-secondary" onClick={() => testPlatform("max")} disabled={testing === "max"}>
                Проверить
              </button>
              <button className="btn btn-secondary" onClick={saveAccountsField}>
                Сохранить
              </button>
              <button className="btn btn-primary" onClick={() => toggleRun("max")}>
                {status.max ? "Остановить" : "Запустить"}
              </button>
            </div>
            {testResult.max && <p className="hint chatbot-test-result">{testResult.max}</p>}
          </div>
        </div>
      )}

      {tab === "funnels" && !editingFunnel && (
        <div className="panel-section">
          <button className="btn btn-primary" onClick={openNewFunnel}>
            + Новая воронка
          </button>
          <ul className="skills-list">
            {funnels.map((f) => (
              <li key={f.id} className="skill-card">
                <div>
                  <h3>{f.name}</h3>
                  <p>
                    Триггер: {f.trigger.type === "keyword" ? `слово «${f.trigger.keyword}»` : f.trigger.type === "start" ? "первое сообщение" : "по умолчанию"} ·{" "}
                    {f.platforms.map((p) => PLATFORM_LABEL[p]).join(", ") || "нет площадок"} · шагов: {f.steps.length}
                  </p>
                </div>
                <div className="skill-card-actions">
                  <button className="btn btn-secondary" onClick={() => setEditingFunnel(f)}>
                    Изменить
                  </button>
                  <button className="btn btn-danger" onClick={() => deleteFunnel(f.id)}>
                    Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "funnels" && editingFunnel && (
        <div className="panel-section">
          <button className="link-btn" onClick={() => setEditingFunnel(null)}>
            ← К списку воронок
          </button>
          <label>Название</label>
          <input value={editingFunnel.name} onChange={(e) => setEditingFunnel({ ...editingFunnel, name: e.target.value })} />

          <label>Площадки</label>
          <div className="chatbot-platform-checks">
            {PLATFORMS.map((p) => (
              <label key={p}>
                <input
                  type="checkbox"
                  checked={editingFunnel.platforms.includes(p)}
                  onChange={(e) =>
                    setEditingFunnel({
                      ...editingFunnel,
                      platforms: e.target.checked ? [...editingFunnel.platforms, p] : editingFunnel.platforms.filter((x) => x !== p),
                    })
                  }
                />{" "}
                {PLATFORM_LABEL[p]}
              </label>
            ))}
          </div>

          <label>Триггер</label>
          <select
            value={editingFunnel.trigger.type}
            onChange={(e) => setEditingFunnel({ ...editingFunnel, trigger: { ...editingFunnel.trigger, type: e.target.value as Funnel["trigger"]["type"] } })}
          >
            <option value="keyword">По ключевому слову</option>
            <option value="start">Первое сообщение от пользователя</option>
            <option value="default">По умолчанию (если ничего не подошло)</option>
          </select>
          {editingFunnel.trigger.type === "keyword" && (
            <input
              placeholder="слово или фраза, например: цена"
              value={editingFunnel.trigger.keyword ?? ""}
              onChange={(e) => setEditingFunnel({ ...editingFunnel, trigger: { ...editingFunnel.trigger, keyword: e.target.value } })}
            />
          )}

          <label>Шаги воронки</label>
          {editingFunnel.steps.map((step, i) => (
            <div key={i} className="chatbot-step-row">
              <div>
                <label>Задержка (мин), 0 — сразу</label>
                <input type="number" min={0} value={step.delayMinutes} onChange={(e) => updateStep(i, { delayMinutes: Number(e.target.value) })} />
              </div>
              <div className="chatbot-step-text">
                <label>Текст сообщения</label>
                <textarea value={step.text} onChange={(e) => updateStep(i, { text: e.target.value })} rows={3} />
              </div>
              <button
                className="conv-delete"
                onClick={() => setEditingFunnel({ ...editingFunnel, steps: editingFunnel.steps.filter((_, idx) => idx !== i) })}
                title="Удалить шаг"
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() => setEditingFunnel({ ...editingFunnel, steps: [...editingFunnel.steps, { delayMinutes: 60, text: "" }] })}
          >
            + Шаг
          </button>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={saveFunnelDraft}>
              Сохранить воронку
            </button>
          </div>
        </div>
      )}

      {tab === "inbox" && (
        <div className="chatbot-inbox">
          <div className="project-tabs chatbot-inbox-platforms">
            {PLATFORMS.map((p) => (
              <button key={p} className={inboxPlatform === p ? "tab active" : "tab"} onClick={() => setInboxPlatform(p)}>
                {PLATFORM_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="chatbot-inbox-layout">
            <div className="thread-list">
              {leads.length === 0 && <p className="hint">Пока нет обращений.</p>}
              {leads.map((l) => (
                <div key={l.userId} className={selectedLead?.userId === l.userId ? "conv-item active" : "conv-item"} onClick={() => setSelectedLead(l)}>
                  <span>
                    <strong>{l.name}</strong>
                    <br />
                    {new Date(l.lastMessageAt).toLocaleString("ru-RU")}
                  </span>
                </div>
              ))}
            </div>
            <div className="thread-reader chatbot-thread">
              {selectedLead ? (
                <>
                  <div className="chatbot-thread-messages">
                    {messages.map((m, i) => (
                      <div key={i} className={m.direction === "in" ? "msg msg-user" : "msg msg-assistant"}>
                        <div className="msg-role">{m.direction === "in" ? selectedLead.name : "Вы"}</div>
                        <div className="markdown">{m.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="chat-input-bar">
                    <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2} placeholder="Ответить…" />
                    <button className="btn btn-primary" onClick={sendReply} disabled={sending || !replyText.trim()}>
                      Отправить
                    </button>
                  </div>
                </>
              ) : (
                <div className="chat-empty-hint">Выберите контакт слева.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
