import { useEffect, useState } from "react";
import type { Conversation, MailAccount, MailMessageFull, MailMessageSummary, Settings } from "../lib/types";
import { parseMailDraft, uid } from "../lib/promptBuilder";
import ChatView from "./ChatView";
import Markdown from "./Markdown";

interface Props {
  settings: Settings;
  onOpenSettings: () => void;
}

type Tab = "inbox" | "compose" | "agent" | "settings";

const EMPTY_ACCOUNT: MailAccount = {
  email: "",
  password: "",
  displayName: "",
  imapHost: "imap.mail.ru",
  imapPort: 993,
  smtpHost: "smtp.mail.ru",
  smtpPort: 465,
  signature: { name: "", position: "", company: "", phone: "", email: "", website: "", accentColor: "#c96442", logoPath: "" },
};

export default function MailView({ settings, onOpenSettings }: Props) {
  const [tab, setTab] = useState<Tab>("inbox");
  const [account, setAccount] = useState<MailAccount>(EMPTY_ACCOUNT);
  const [accountDraft, setAccountDraft] = useState<MailAccount>(EMPTY_ACCOUNT);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<MailMessageFull | null>(null);

  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [includeSignature, setIncludeSignature] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentConv, setAgentConv] = useState<Conversation | null>(null);
  const [pendingDraft, setPendingDraft] = useState<ReturnType<typeof parseMailDraft>>(null);

  useEffect(() => {
    window.api.getMailAccount().then((a) => {
      setAccount(a);
      setAccountDraft(a);
    });
  }, []);

  async function saveAccountDraft() {
    const saved = await window.api.saveMailAccount(accountDraft);
    setAccount(saved);
    setAccountDraft(saved);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await window.api.testMailConnection(accountDraft);
      if (result.ok) setTestResult("Соединение успешно ✓");
      else setTestResult(`Ошибка. IMAP: ${result.errors.imap ?? "OK"}; SMTP: ${result.errors.smtp ?? "OK"}`);
    } finally {
      setTesting(false);
    }
  }

  async function pickLogo() {
    const filePath = await window.api.pickMailLogo();
    if (!filePath) return;
    const updated = await window.api.saveMailSignatureLogo(filePath);
    setAccount(updated);
    setAccountDraft(updated);
  }

  async function loadInbox() {
    setLoadingInbox(true);
    setInboxError(null);
    try {
      setMessages(await window.api.listMailMessages({ limit: 30 }));
    } catch (e) {
      setInboxError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingInbox(false);
    }
  }

  useEffect(() => {
    if (tab === "inbox" && account.email) loadInbox();
  }, [tab, account.email]);

  async function openMail(uidNum: number) {
    setOpenMessage(null);
    try {
      setOpenMessage(await window.api.getMailMessage(uidNum));
    } catch (e) {
      setInboxError(e instanceof Error ? e.message : String(e));
    }
  }

  async function send() {
    setSending(true);
    setSendError(null);
    setSendSuccess(false);
    try {
      await window.api.sendMail({ to: composeTo, subject: composeSubject, bodyText: composeBody, includeSignature });
      setSendSuccess(true);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  async function openAgent() {
    setTab("agent");
    const prompt = await window.api.getMailDraftPrompt();
    setAgentPrompt(prompt);
    const existing = await window.api.getMailAgentConversation();
    if (existing) {
      setAgentConv(existing);
      const last = [...existing.messages].reverse().find((m) => m.role === "assistant");
      if (last) setPendingDraft(parseMailDraft(last.content));
    } else {
      const conv: Conversation = {
        id: uid(),
        projectId: "__mail_agent__",
        title: "Черновик письма",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.api.saveMailAgentConversation(conv);
      setAgentConv(conv);
    }
  }

  function useDraft() {
    if (!pendingDraft) return;
    setComposeTo(pendingDraft.to);
    setComposeSubject(pendingDraft.subject);
    setComposeBody(pendingDraft.body);
    setTab("compose");
  }

  return (
    <div className="mail-view">
      <div className="ops-toolbar">
        <h2>Почта</h2>
        <div className="project-tabs">
          <button className={tab === "inbox" ? "tab active" : "tab"} onClick={() => setTab("inbox")}>
            Входящие
          </button>
          <button className={tab === "compose" ? "tab active" : "tab"} onClick={() => setTab("compose")}>
            Написать
          </button>
          <button className={tab === "agent" ? "tab active" : "tab"} onClick={openAgent}>
            🤖 Черновик с ИИ
          </button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>
            Настройки
          </button>
        </div>
      </div>

      {!account.email && tab !== "settings" && (
        <div className="warning-banner">
          Почта не настроена. <button className="link-btn" onClick={() => setTab("settings")}>Открыть настройки почты</button>
        </div>
      )}

      {tab === "inbox" && (
        <div className="mail-layout">
          <div className="mail-list">
            <button className="btn btn-secondary btn-block" onClick={loadInbox} disabled={loadingInbox}>
              {loadingInbox ? "Загрузка…" : "Обновить"}
            </button>
            {inboxError && <div className="chat-error">{inboxError}</div>}
            {messages.map((m) => (
              <div key={m.uid} className="conv-item" onClick={() => openMail(m.uid)}>
                <span>
                  <strong>{m.from}</strong>
                  <br />
                  {m.subject}
                </span>
              </div>
            ))}
          </div>
          <div className="mail-reader panel-section">
            {openMessage ? (
              <>
                <h3>{openMessage.subject}</h3>
                <p className="hint">
                  От: {openMessage.from} · {new Date(openMessage.date).toLocaleString("ru-RU")}
                </p>
                {openMessage.html ? (
                  <div className="markdown" dangerouslySetInnerHTML={{ __html: openMessage.html }} />
                ) : (
                  <Markdown text={openMessage.text} />
                )}
              </>
            ) : (
              <div className="chat-empty-hint">Выберите письмо слева.</div>
            )}
          </div>
        </div>
      )}

      {tab === "compose" && (
        <div className="panel-section">
          <label>Кому</label>
          <input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} placeholder="example@mail.ru" />
          <label>Тема</label>
          <input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
          <label>Текст письма</label>
          <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={12} />
          <label>
            <input type="checkbox" checked={includeSignature} onChange={(e) => setIncludeSignature(e.target.checked)} />{" "}
            Добавить подпись
          </label>
          {sendError && <div className="chat-error">Не удалось отправить: {sendError}</div>}
          {sendSuccess && <p className="saved-note">Письмо отправлено ✓</p>}
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={sending || !composeTo.trim() || !composeSubject.trim() || !account.email}
          >
            {sending ? "Отправка…" : "Отправить"}
          </button>
        </div>
      )}

      {tab === "agent" && (
        <div className="creator-layout">
          <div className="creator-header">
            <p className="hint">
              Опишите, о чём должно быть письмо — ассистент подготовит текст, а вы сможете отредактировать и
              отправить его сами. Приложение никогда не отправляет письма без вашего явного нажатия «Отправить».
            </p>
          </div>
          {!settings.apiKey && (
            <div className="warning-banner">
              API-ключ не задан. <button className="link-btn" onClick={onOpenSettings}>Открыть настройки</button>
            </div>
          )}
          {pendingDraft && (
            <div className="pending-skill-banner">
              Черновик готов: «{pendingDraft.subject}».
              <button className="btn btn-primary" onClick={useDraft}>
                Перенести в «Написать»
              </button>
            </div>
          )}
          {agentConv && (
            <ChatView
              conversation={agentConv}
              systemPrompt={agentPrompt}
              settings={settings}
              onUpdate={setAgentConv}
              onSave={(conv) => window.api.saveMailAgentConversation(conv)}
              emptyHint="Например: «Напиши клиенту Болдино LIFE о переносе публикации на среду»."
              onAssistantMessage={(content) => setPendingDraft(parseMailDraft(content))}
            />
          )}
        </div>
      )}

      {tab === "settings" && (
        <div className="panel-section">
          <h3>Аккаунт (mail.ru или другой IMAP/SMTP)</h3>
          <p className="hint">
            В mail.ru нужно включить доступ для внешних приложений и создать пароль приложения:
            Настройки почты → Пароль и безопасность → Пароли для внешних приложений.
          </p>
          <label>Email</label>
          <input value={accountDraft.email} onChange={(e) => setAccountDraft({ ...accountDraft, email: e.target.value })} />
          <label>Пароль приложения</label>
          <input
            type="password"
            value={accountDraft.password}
            onChange={(e) => setAccountDraft({ ...accountDraft, password: e.target.value })}
          />
          <label>Имя отправителя</label>
          <input
            value={accountDraft.displayName}
            onChange={(e) => setAccountDraft({ ...accountDraft, displayName: e.target.value })}
          />
          <div className="mail-host-row">
            <div>
              <label>IMAP хост</label>
              <input
                value={accountDraft.imapHost}
                onChange={(e) => setAccountDraft({ ...accountDraft, imapHost: e.target.value })}
              />
            </div>
            <div>
              <label>IMAP порт</label>
              <input
                type="number"
                value={accountDraft.imapPort}
                onChange={(e) => setAccountDraft({ ...accountDraft, imapPort: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>SMTP хост</label>
              <input
                value={accountDraft.smtpHost}
                onChange={(e) => setAccountDraft({ ...accountDraft, smtpHost: e.target.value })}
              />
            </div>
            <div>
              <label>SMTP порт</label>
              <input
                type="number"
                value={accountDraft.smtpPort}
                onChange={(e) => setAccountDraft({ ...accountDraft, smtpPort: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="settings-actions">
            <button className="btn btn-secondary" onClick={testConnection} disabled={testing}>
              {testing ? "Проверка…" : "Проверить соединение"}
            </button>
            <button className="btn btn-primary" onClick={saveAccountDraft}>
              Сохранить
            </button>
          </div>
          {testResult && <p className="hint">{testResult}</p>}

          <h3>Брендированная подпись</h3>
          <label>Имя</label>
          <input
            value={accountDraft.signature.name}
            onChange={(e) => setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, name: e.target.value } })}
          />
          <label>Должность</label>
          <input
            value={accountDraft.signature.position}
            onChange={(e) =>
              setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, position: e.target.value } })
            }
          />
          <label>Компания</label>
          <input
            value={accountDraft.signature.company}
            onChange={(e) =>
              setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, company: e.target.value } })
            }
          />
          <label>Телефон</label>
          <input
            value={accountDraft.signature.phone}
            onChange={(e) => setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, phone: e.target.value } })}
          />
          <label>Email для подписи</label>
          <input
            value={accountDraft.signature.email}
            onChange={(e) => setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, email: e.target.value } })}
          />
          <label>Сайт</label>
          <input
            value={accountDraft.signature.website}
            onChange={(e) =>
              setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, website: e.target.value } })
            }
          />
          <label>Акцентный цвет</label>
          <input
            type="color"
            value={accountDraft.signature.accentColor}
            onChange={(e) =>
              setAccountDraft({ ...accountDraft, signature: { ...accountDraft.signature, accentColor: e.target.value } })
            }
          />
          <label>Логотип</label>
          <div className="folder-row">
            {account.signature.logoPath && <span className="hint">Загружен: {account.signature.logoPath.split(/[\\/]/).pop()}</span>}
            <button className="btn btn-secondary" onClick={pickLogo}>
              Выбрать логотип
            </button>
          </div>
          <button className="btn btn-primary" onClick={saveAccountDraft}>
            Сохранить подпись
          </button>
        </div>
      )}
    </div>
  );
}
