const fs = require("node:fs/promises");
const path = require("node:path");

function mailDir(root) {
  return path.join(root, "mail");
}
function accountFile(root) {
  return path.join(mailDir(root), "account.json");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

const DEFAULT_ACCOUNT = {
  email: "",
  password: "",
  displayName: "",
  imapHost: "imap.mail.ru",
  imapPort: 993,
  smtpHost: "smtp.mail.ru",
  smtpPort: 465,
  signature: {
    name: "",
    position: "",
    company: "",
    phone: "",
    email: "",
    website: "",
    accentColor: "#c96442",
    logoPath: "",
  },
};

async function getAccount(root) {
  const stored = await readJson(accountFile(root), {});
  return {
    ...DEFAULT_ACCOUNT,
    ...stored,
    signature: { ...DEFAULT_ACCOUNT.signature, ...(stored.signature || {}) },
  };
}

async function saveAccount(root, account) {
  await ensureDir(mailDir(root));
  await writeJson(accountFile(root), account);
  return account;
}

async function saveSignatureLogo(root, sourcePath) {
  await ensureDir(mailDir(root));
  const ext = path.extname(sourcePath) || ".png";
  const dest = path.join(mailDir(root), "signature-logo" + ext);
  await fs.copyFile(sourcePath, dest);
  const account = await getAccount(root);
  account.signature.logoPath = dest;
  await saveAccount(root, account);
  return account;
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function renderSignatureHtml(sig) {
  if (!sig || (!sig.name && !sig.company)) return "";
  const accent = sig.accentColor || "#c96442";
  const logoCell = sig.logoPath
    ? `<td style="padding-right:16px;vertical-align:top;"><img src="cid:signature-logo" alt="" style="max-height:64px;max-width:160px;display:block;border:0;"></td>`
    : "";
  const lines = [];
  if (sig.phone) lines.push(escapeHtml(sig.phone));
  if (sig.email) lines.push(`<a href="mailto:${escapeHtml(sig.email)}" style="color:${accent};text-decoration:none;">${escapeHtml(sig.email)}</a>`);
  if (sig.website) lines.push(`<a href="${escapeHtml(sig.website)}" style="color:${accent};text-decoration:none;">${escapeHtml(sig.website)}</a>`);
  return `<table cellpadding="0" cellspacing="0" style="font-family:Arial,sans-serif;font-size:13px;color:#333;border-top:2px solid ${accent};padding-top:10px;margin-top:16px;"><tr>${logoCell}<td style="vertical-align:top;">
    <div style="font-weight:bold;font-size:14px;color:#111;">${escapeHtml(sig.name)}</div>
    ${sig.position ? `<div style="color:${accent};">${escapeHtml(sig.position)}</div>` : ""}
    ${sig.company ? `<div>${escapeHtml(sig.company)}</div>` : ""}
    <div style="margin-top:6px;">${lines.join("<br>")}</div>
  </td></tr></table>`;
}

function renderSignatureText(sig) {
  if (!sig || (!sig.name && !sig.company)) return "";
  return ["--", sig.name, sig.position, sig.company, sig.phone, sig.email, sig.website].filter(Boolean).join("\n");
}

function textToHtmlParagraphs(text) {
  return (text || "")
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

// Keep these well below the libraries' defaults (90s for imapflow) so a
// wrong host/blocked port/no internet fails with a clear message instead of
// leaving the UI looking frozen for a minute and a half.
const CONNECT_TIMEOUT_MS = 10000;
const GREETING_TIMEOUT_MS = 8000;
const SOCKET_TIMEOUT_MS = 20000;

function makeImapClient(account) {
  const { ImapFlow } = require("imapflow");
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: { user: account.email, pass: account.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

function makeSmtpTransport(account) {
  const nodemailer = require("nodemailer");
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: { user: account.email, pass: account.password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

async function testConnection(account) {
  const errors = {};
  try {
    const client = makeImapClient(account);
    await client.connect();
    await client.logout();
  } catch (e) {
    errors.imap = e.message;
  }
  try {
    await makeSmtpTransport(account).verify();
  } catch (e) {
    errors.smtp = e.message;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

async function listMessages(account, { limit = 30 } = {}) {
  if (!account.email || !account.password) throw new Error("Сначала настройте почтовый аккаунт в разделе Почта.");
  const client = makeImapClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const total = client.mailbox.exists;
      if (total === 0) return [];
      const start = Math.max(1, total - limit + 1);
      const messages = [];
      for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true, uid: true })) {
        messages.push({
          uid: msg.uid,
          subject: msg.envelope?.subject || "(без темы)",
          from: (msg.envelope?.from || []).map((a) => a.name || a.address).join(", "),
          date: msg.envelope?.date ? new Date(msg.envelope.date).getTime() : 0,
          seen: msg.flags ? msg.flags.has("\\Seen") : false,
        });
      }
      messages.sort((a, b) => b.date - a.date);
      return messages;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function getMessage(account, uid) {
  const client = makeImapClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg) throw new Error("Сообщение не найдено.");
      const { simpleParser } = require("mailparser");
      const parsed = await simpleParser(msg.source);
      return {
        uid,
        subject: parsed.subject || "(без темы)",
        from: parsed.from?.text || "",
        to: parsed.to?.text || "",
        date: parsed.date ? parsed.date.getTime() : 0,
        text: parsed.text || "",
        html: parsed.html || null,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function sendMail(root, { to, subject, bodyText, includeSignature = true }) {
  const account = await getAccount(root);
  if (!account.email || !account.password) throw new Error("Сначала настройте почтовый аккаунт в разделе Почта.");

  let html = textToHtmlParagraphs(bodyText);
  let text = bodyText || "";
  const attachments = [];

  if (includeSignature) {
    const sigHtml = renderSignatureHtml(account.signature);
    const sigText = renderSignatureText(account.signature);
    if (sigHtml) html += sigHtml;
    if (sigText) text += "\n\n" + sigText;
    if (account.signature.logoPath) {
      attachments.push({ filename: "logo" + path.extname(account.signature.logoPath), path: account.signature.logoPath, cid: "signature-logo" });
    }
  }

  const mailOptions = {
    from: account.displayName ? `"${account.displayName}" <${account.email}>` : account.email,
    to,
    subject,
    text,
    html,
    attachments,
  };

  const info = await makeSmtpTransport(account).sendMail(mailOptions);

  // Best-effort: also save a copy into the IMAP "Sent" folder. Not fatal if it fails
  // (folder name / support varies), the message has already been delivered above.
  try {
    const nodemailer = require("nodemailer");
    const rawTransport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const { message } = await rawTransport.sendMail(mailOptions);
    const client = makeImapClient(account);
    await client.connect();
    try {
      await client.append("Sent", message, ["\\Seen"]);
    } finally {
      await client.logout().catch(() => {});
    }
  } catch {
    // ignore — best effort only
  }

  return info.messageId;
}

module.exports = {
  getAccount,
  saveAccount,
  saveSignatureLogo,
  testConnection,
  listMessages,
  getMessage,
  sendMail,
  renderSignatureHtml,
  renderSignatureText,
};
