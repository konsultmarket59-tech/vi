const fs = require("node:fs/promises");
const path = require("node:path");

function botsDir(root) {
  return path.join(root, "chatbots");
}
function accountsFile(root) {
  return path.join(botsDir(root), "accounts.json");
}
function funnelsFile(root) {
  return path.join(botsDir(root), "funnels.json");
}
function leadsFile(root, platform) {
  return path.join(botsDir(root), "leads", `${platform}.json`);
}
function messagesFile(root, platform) {
  return path.join(botsDir(root), "messages", `${platform}.json`);
}
function threadFile(root, platform, userId) {
  // userId comes from the platform (numeric ids in practice), but sanitize anyway —
  // it ends up in a filename.
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(botsDir(root), "threads", platform, `${safe}.json`);
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

const PLATFORMS = ["telegram", "vk", "max"];
const DEFAULT_ACCOUNTS = {
  telegram: { token: "", enabled: false, aiEnabled: false, aiProjectId: "" },
  vk: { token: "", groupId: "", enabled: false, aiEnabled: false, aiProjectId: "" },
  max: { token: "", enabled: false, aiEnabled: false, aiProjectId: "" },
};

// How much of a conversation the bot keeps in mind per person. Long enough to hold
// a real consultation together, short enough that an old thread can't grow without
// bound and blow past the model's context on every reply.
const MAX_THREAD_MESSAGES = 20;
const MAX_MESSAGES_PER_PLATFORM = 1000;

async function getAccounts(root) {
  const stored = await readJson(accountsFile(root), {});
  return {
    telegram: { ...DEFAULT_ACCOUNTS.telegram, ...(stored.telegram || {}) },
    vk: { ...DEFAULT_ACCOUNTS.vk, ...(stored.vk || {}) },
    max: { ...DEFAULT_ACCOUNTS.max, ...(stored.max || {}) },
  };
}
async function saveAccounts(root, accounts) {
  await ensureDir(botsDir(root));
  await writeJson(accountsFile(root), accounts);
  return accounts;
}

async function getFunnels(root) {
  return readJson(funnelsFile(root), []);
}
async function saveFunnels(root, funnels) {
  await ensureDir(botsDir(root));
  await writeJson(funnelsFile(root), funnels);
  return funnels;
}

async function getLeads(root, platform) {
  return readJson(leadsFile(root, platform), []);
}
async function saveLeads(root, platform, leads) {
  await ensureDir(path.join(botsDir(root), "leads"));
  await writeJson(leadsFile(root, platform), leads);
}

async function getMessages(root, platform) {
  return readJson(messagesFile(root, platform), []);
}
async function appendMessage(root, platform, msg) {
  await ensureDir(path.join(botsDir(root), "messages"));
  const list = await getMessages(root, platform);
  list.push(msg);
  while (list.length > MAX_MESSAGES_PER_PLATFORM) list.shift();
  await writeJson(messagesFile(root, platform), list);
  return list;
}

async function getThread(root, platform, userId) {
  return readJson(threadFile(root, platform, userId), []);
}

async function saveThread(root, platform, userId, messages) {
  await ensureDir(path.join(botsDir(root), "threads", platform));
  const trimmed = messages.slice(-MAX_THREAD_MESSAGES);
  await writeJson(threadFile(root, platform, userId), trimmed);
  return trimmed;
}

// ---------- platform adapters ----------
// Each adapter exposes: testConnection(account), pollOnce(account, cursor) -> {cursor, events:[{userId,name,text}]}, sendMessage(account, userId, text)

const telegramAdapter = {
  async testConnection(account) {
    if (!account.token?.trim()) return { ok: false, error: "Токен не задан." };
    try {
      const res = await fetch(`https://api.telegram.org/bot${account.token}/getMe`);
      const body = await res.json();
      if (!body.ok) return { ok: false, error: body.description || "Ошибка Telegram API." };
      return { ok: true, login: body.result.username };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  async pollOnce(account, cursor) {
    const offset = cursor?.offset ?? 0;
    const res = await fetch(
      `https://api.telegram.org/bot${account.token}/getUpdates?timeout=25&offset=${offset}`
    );
    const body = await res.json();
    if (!body.ok) throw new Error(body.description || "Ошибка Telegram API.");
    const events = [];
    let nextOffset = offset;
    for (const update of body.result || []) {
      nextOffset = Math.max(nextOffset, update.update_id + 1);
      const msg = update.message;
      if (!msg?.text) continue;
      events.push({
        userId: String(msg.from.id),
        name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || String(msg.from.id),
        text: msg.text,
      });
    }
    return { cursor: { offset: nextOffset }, events };
  },
  async sendMessage(account, userId, text) {
    const res = await fetch(`https://api.telegram.org/bot${account.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: userId, text }),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(body.description || "Ошибка отправки в Telegram.");
  },
};

const VK_API_VERSION = "5.199";

const vkAdapter = {
  async testConnection(account) {
    if (!account.token?.trim() || !account.groupId?.trim()) {
      return { ok: false, error: "Токен и ID сообщества обязательны." };
    }
    try {
      const url = `https://api.vk.com/method/groups.getById?group_id=${encodeURIComponent(account.groupId)}&access_token=${encodeURIComponent(account.token)}&v=${VK_API_VERSION}`;
      const res = await fetch(url);
      const body = await res.json();
      if (body.error) return { ok: false, error: body.error.error_msg };
      return { ok: true, login: body.response?.[0]?.name || account.groupId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  async _getLongPollServer(account) {
    const url = `https://api.vk.com/method/groups.getLongPollServer?group_id=${encodeURIComponent(account.groupId)}&access_token=${encodeURIComponent(account.token)}&v=${VK_API_VERSION}`;
    const res = await fetch(url);
    const body = await res.json();
    if (body.error) throw new Error(body.error.error_msg);
    return body.response; // { key, server, ts }
  },
  async pollOnce(account, cursor) {
    let server = cursor?.server;
    if (!server) {
      server = await this._getLongPollServer(account);
    }
    const url = `${server.server}?act=a_check&key=${encodeURIComponent(server.key)}&ts=${encodeURIComponent(server.ts)}&wait=25`;
    const res = await fetch(url);
    const body = await res.json();
    const events = [];
    if (body.failed) {
      // key/ts expired or invalid — refetch server next time
      return { cursor: {}, events };
    }
    for (const update of body.updates || []) {
      if (update.type !== "message_new") continue;
      const m = update.object.message;
      events.push({ userId: String(m.from_id), name: `id${m.from_id}`, text: m.text || "" });
    }
    return { cursor: { server: { ...server, ts: body.ts } }, events };
  },
  async sendMessage(account, userId, text) {
    const url = `https://api.vk.com/method/messages.send?user_id=${encodeURIComponent(userId)}&message=${encodeURIComponent(text)}&random_id=${Date.now()}&access_token=${encodeURIComponent(account.token)}&v=${VK_API_VERSION}`;
    const res = await fetch(url, { method: "POST" });
    const body = await res.json();
    if (body.error) throw new Error(body.error.error_msg);
  },
};

const MAX_API_BASE = "https://platform-api2.max.ru";

const maxAdapter = {
  async testConnection(account) {
    if (!account.token?.trim()) return { ok: false, error: "Токен не задан." };
    try {
      const res = await fetch(`${MAX_API_BASE}/me`, { headers: { Authorization: account.token } });
      const body = await res.json();
      if (!res.ok) return { ok: false, error: body.message || "Ошибка MAX API." };
      return { ok: true, login: body.name || body.username };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  async pollOnce(account, cursor) {
    const marker = cursor?.marker;
    const url = `${MAX_API_BASE}/updates?limit=100&timeout=25${marker != null ? `&marker=${marker}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: account.token } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || "Ошибка MAX API.");
    const events = [];
    for (const update of body.updates || []) {
      if (update.update_type !== "message_created") continue;
      const msg = update.message;
      if (!msg?.body?.text) continue;
      events.push({
        userId: String(msg.sender?.user_id ?? msg.recipient?.chat_id),
        name: msg.sender?.name || String(msg.sender?.user_id ?? ""),
        text: msg.body.text,
      });
    }
    return { cursor: { marker: body.marker }, events };
  },
  async sendMessage(account, userId, text) {
    const res = await fetch(`${MAX_API_BASE}/messages?user_id=${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { Authorization: account.token, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "Ошибка отправки в MAX.");
  },
};

const ADAPTERS = { telegram: telegramAdapter, vk: vkAdapter, max: maxAdapter };

async function testConnection(platform, account) {
  return ADAPTERS[platform].testConnection(account);
}

// ---------- funnel matching ----------

function matchFunnel(funnels, platform, text, isFirstMessage) {
  const lower = text.toLowerCase();
  for (const f of funnels) {
    if (!f.platforms.includes(platform)) continue;
    if (f.trigger.type === "keyword" && f.trigger.keyword && lower.includes(f.trigger.keyword.toLowerCase())) return f;
  }
  if (isFirstMessage) {
    const startFunnel = funnels.find((f) => f.platforms.includes(platform) && f.trigger.type === "start");
    if (startFunnel) return startFunnel;
  }
  return funnels.find((f) => f.platforms.includes(platform) && f.trigger.type === "default") || null;
}

// ---------- runtime state (per-platform polling loops) ----------

const running = new Map(); // platform -> boolean
const cursors = new Map(); // platform -> adapter cursor

function isRunning(platform) {
  return running.get(platform) === true;
}

async function processIncoming(root, platform, account, event, onMessage, aiResponder) {
  const leads = await getLeads(root, platform);
  let lead = leads.find((l) => l.userId === event.userId);
  const isFirst = !lead;
  const now = Date.now();
  if (!lead) {
    lead = { userId: event.userId, name: event.name, firstSeenAt: now, funnelId: null, stepIndex: 0, nextStepDueAt: null, lastMessageAt: now };
    leads.push(lead);
  } else {
    lead.name = event.name || lead.name;
    lead.lastMessageAt = now;
  }

  const logged = { userId: event.userId, name: lead.name, direction: "in", text: event.text, at: now };
  await appendMessage(root, platform, logged);
  onMessage?.(platform, logged);

  const aiOn = account.aiEnabled && account.aiProjectId && typeof aiResponder === "function";

  if (aiOn) {
    // AI mode answers on its own, so funnels stay out of the way entirely — otherwise
    // the same incoming message would trigger both a scripted drip step and a generated
    // reply, and the person would get two answers talking over each other.
    await saveLeads(root, platform, leads);
    const history = await getThread(root, platform, event.userId);
    const withUser = [...history, { role: "user", content: event.text }];
    let reply;
    try {
      reply = await aiResponder({ platform, account, lead, messages: withUser });
    } catch (e) {
      console.error(`ИИ-ответ для ${platform}/${event.userId} не удался:`, e);
      return;
    }
    if (!reply) return;
    try {
      await ADAPTERS[platform].sendMessage(account, event.userId, reply);
    } catch (e) {
      // Don't persist the exchange if the person never actually received the answer —
      // otherwise the bot would "remember" saying something it never sent.
      console.error(`Не удалось отправить ИИ-ответ в ${platform}:`, e);
      return;
    }
    await saveThread(root, platform, event.userId, [...withUser, { role: "assistant", content: reply }]);
    const outLog = { userId: event.userId, name: lead.name, direction: "out", text: reply, at: Date.now() };
    await appendMessage(root, platform, outLog);
    onMessage?.(platform, outLog);
    return;
  }

  const funnels = await getFunnels(root);
  const funnel = matchFunnel(funnels, platform, event.text, isFirst);
  if (funnel) {
    lead.funnelId = funnel.id;
    lead.stepIndex = 0;
    lead.nextStepDueAt = now; // fire first step immediately on next scheduler tick
  }

  await saveLeads(root, platform, leads);
}

// Real long-poll servers block for ~25s when there's nothing new, which
// naturally paces this loop. This minimum delay is a safety net in case a
// server ever responds instantly with no events (flaky network, a buggy
// mock, etc.) so the loop can't spin tight and peg the event loop / hammer
// the API.
const MIN_POLL_INTERVAL_MS = 1000;

async function pollLoop(root, platform, onMessage, onStatus, aiResponder) {
  const account = (await getAccounts(root))[platform];
  const adapter = ADAPTERS[platform];
  while (isRunning(platform)) {
    const iterationStart = Date.now();
    try {
      const { cursor, events } = await adapter.pollOnce(account, cursors.get(platform));
      cursors.set(platform, cursor);
      for (const event of events) {
        await processIncoming(root, platform, account, event, onMessage, aiResponder);
      }
      onStatus?.(platform, "ok");
    } catch (e) {
      onStatus?.(platform, "error: " + e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
    const elapsed = Date.now() - iterationStart;
    if (elapsed < MIN_POLL_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_POLL_INTERVAL_MS - elapsed));
    }
  }
}

async function start(root, platform, onMessage, onStatus, aiResponder) {
  if (isRunning(platform)) return;
  running.set(platform, true);
  cursors.delete(platform);
  pollLoop(root, platform, onMessage, onStatus, aiResponder);
}

function stop(platform) {
  running.set(platform, false);
}

function getStatus() {
  const status = {};
  for (const p of PLATFORMS) status[p] = isRunning(p);
  return status;
}

async function sendManual(root, platform, userId, text) {
  const account = (await getAccounts(root))[platform];
  await ADAPTERS[platform].sendMessage(account, userId, text);
  const logged = { userId, name: userId, direction: "out", text, at: Date.now() };
  await appendMessage(root, platform, logged);
  const leads = await getLeads(root, platform);
  const lead = leads.find((l) => l.userId === userId);
  if (lead) {
    lead.lastMessageAt = Date.now();
    await saveLeads(root, platform, leads);
  }
  return logged;
}

// ---------- funnel step scheduler ----------

let schedulerTimer = null;

async function runScheduledSteps(root, onMessage) {
  for (const platform of PLATFORMS) {
    if (!isRunning(platform)) continue;
    const account = (await getAccounts(root))[platform];
    const leads = await getLeads(root, platform);
    const funnels = await getFunnels(root);
    let changed = false;
    for (const lead of leads) {
      if (!lead.funnelId || lead.nextStepDueAt == null) continue;
      if (Date.now() < lead.nextStepDueAt) continue;
      const funnel = funnels.find((f) => f.id === lead.funnelId);
      const step = funnel?.steps?.[lead.stepIndex];
      if (!step) {
        lead.nextStepDueAt = null;
        changed = true;
        continue;
      }
      try {
        await ADAPTERS[platform].sendMessage(account, lead.userId, step.text);
        const logged = { userId: lead.userId, name: lead.name, direction: "out", text: step.text, at: Date.now() };
        await appendMessage(root, platform, logged);
        onMessage?.(platform, logged);
      } catch {
        // leave step pending, will retry next tick
        continue;
      }
      lead.stepIndex += 1;
      const nextStep = funnel.steps[lead.stepIndex];
      lead.nextStepDueAt = nextStep ? Date.now() + nextStep.delayMinutes * 60000 : null;
      changed = true;
    }
    if (changed) await saveLeads(root, platform, leads);
  }
}

function startScheduler(getRoot, onMessage) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    try {
      await runScheduledSteps(await getRoot(), onMessage);
    } catch {
      // ignore transient errors, retry next tick
    }
  }, 30000);
}

module.exports = {
  PLATFORMS,
  getThread,
  saveThread,
  getAccounts,
  saveAccounts,
  getFunnels,
  saveFunnels,
  getLeads,
  getMessages,
  testConnection,
  start,
  stop,
  getStatus,
  sendManual,
  startScheduler,
};
