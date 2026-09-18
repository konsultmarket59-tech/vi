// Разговоры с ролями: один на один и переговорка, где несколько специалистов
// обсуждают одну задачу между собой.
//
// Здесь только правила разговора и хранение. Сам вызов модели живёт в main.cjs и
// приходит сюда параметром `ask` — так эту часть можно проверить smoke-тестом без
// сети и без ключа, а заодно одна и та же механика работает и в окне приложения,
// и с телефона.
//
// Главное решение раздела: переговорка — это очередь, а не толпа. Роли говорят по
// одной, каждая видит всё сказанное до неё, и каждая обязана добавить своё, а не
// пересказать чужое. Если выпустить всех одновременно, получится десять
// параллельных монологов на одну и ту же тему — это выглядит как обсуждение, но
// им не является: никто никого не слышал.

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

/** Сколько знаков переписки уходит модели. Дальше — обрезаем от старых. */
const TRANSCRIPT_BUDGET = 60000;

/** Больше кругов человек почти никогда не дочитывает, а платит за каждый. */
const MAX_ROUNDS = 4;

/** Столько специалистов ещё можно прочитать. Дальше переговорка превращается в шум. */
const MAX_ROLES_IN_ROOM = 6;

function chatsDir(root) {
  return path.join(root, "browser", "chats");
}

function uid() {
  return crypto.randomUUID();
}

function newChat({ kind = "role", roleIds = [], title = "", projectId = "", rounds = 2 } = {}) {
  const now = Date.now();
  return {
    id: uid(),
    kind: kind === "room" ? "room" : "role",
    title: title || (kind === "room" ? "Новая переговорка" : "Новый разговор"),
    roleIds: roleIds.slice(0, MAX_ROLES_IN_ROOM),
    projectId,
    rounds: Math.min(Math.max(rounds, 1), MAX_ROUNDS),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeChat(raw) {
  const chat = raw && typeof raw === "object" ? raw : {};
  return {
    id: chat.id || uid(),
    kind: chat.kind === "room" ? "room" : "role",
    title: (chat.title || "Без названия").toString().slice(0, 120),
    roleIds: Array.isArray(chat.roleIds) ? chat.roleIds.slice(0, MAX_ROLES_IN_ROOM) : [],
    projectId: chat.projectId || "",
    rounds: Math.min(Math.max(Number(chat.rounds) || 2, 1), MAX_ROUNDS),
    messages: Array.isArray(chat.messages) ? chat.messages : [],
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || Date.now(),
  };
}

async function list(root) {
  const dir = chatsDir(root);
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const items = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const chat = normalizeChat(JSON.parse(await fs.readFile(path.join(dir, file), "utf-8")));
      items.push({
        id: chat.id,
        kind: chat.kind,
        title: chat.title,
        roleIds: chat.roleIds,
        projectId: chat.projectId,
        rounds: chat.rounds,
        messageCount: chat.messages.length,
        updatedAt: chat.updatedAt,
        createdAt: chat.createdAt,
      });
    } catch {
      // Один нечитаемый файл не должен прятать весь список разговоров.
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

async function read(root, id) {
  const raw = await fs.readFile(path.join(chatsDir(root), `${id}.json`), "utf-8");
  return normalizeChat(JSON.parse(raw));
}

async function save(root, chat) {
  const dir = chatsDir(root);
  await fs.mkdir(dir, { recursive: true });
  const normalized = normalizeChat({ ...chat, updatedAt: Date.now() });
  await fs.writeFile(path.join(dir, `${normalized.id}.json`), JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

async function remove(root, id) {
  await fs.rm(path.join(chatsDir(root), `${id}.json`), { force: true });
  return true;
}

/** Реплика человека. */
function userMessage(content, attachments) {
  return {
    id: uid(),
    from: "me",
    name: "Вы",
    emoji: "🙋",
    content,
    attachments: attachments && attachments.length ? attachments : undefined,
    createdAt: Date.now(),
  };
}

function roleMessage(role, content, extra = {}) {
  return {
    id: uid(),
    from: role.id,
    name: role.name,
    emoji: role.emoji,
    color: role.color,
    content,
    createdAt: Date.now(),
    ...extra,
  };
}

/**
 * Кого позвали в тексте через @.
 *
 * Имена ролей бывают из двух слов («Директор по развитию»), поэтому сравниваем не
 * одно слово после @, а начало строки: @Директор, @Директор по развитию и
 * @директор — это один и тот же человек. Ещё принимаем @все — позвать всех сразу.
 */
function mentionedRoleIds(text, roles) {
  const source = String(text || "");
  // Граница слова (\b) здесь не годится: она считает словом только латиницу, и
  // «@все,» ей уже не «все». Поэтому просто смотрим, что дальше не буква.
  if (/@все(?![а-яё])/i.test(source)) return roles.map((r) => r.id);
  const found = [];
  const re = /@([^\s@.,;:!?()]+(?:\s+[^\s@.,;:!?()]+){0,3})/g;
  let match;
  while ((match = re.exec(source))) {
    const tail = match[1].toLowerCase();
    // Самое длинное подходящее имя выигрывает: «@Директор по развитию» не должен
    // достаться роли «Директор», если обе есть в комнате.
    let best = null;
    for (const role of roles) {
      const name = role.name.toLowerCase();
      if (tail === name || tail.startsWith(name + " ") || name.startsWith(tail)) {
        if (!best || role.name.length > best.name.length) best = role;
      }
    }
    if (best && !found.includes(best.id)) found.push(best.id);
  }
  return found;
}

/**
 * Порядок реплик в круге: сначала те, к кому обратились, потом остальные.
 *
 * Иначе разговор идёт по алфавиту списка: человек спрашивает стилиста, а первым
 * отвечает экономист — и дальше все обсуждают то, что сказал экономист.
 */
function speakingOrder(roles, calledText) {
  const called = mentionedRoleIds(calledText, roles);
  const first = called.map((id) => roles.find((r) => r.id === id)).filter(Boolean);
  const rest = roles.filter((r) => !called.includes(r.id));
  return [...first, ...rest];
}

/** Переписка в виде текста для модели — от старых к новым, с обрезкой сверху. */
function transcript(messages, { budget = TRANSCRIPT_BUDGET } = {}) {
  const lines = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const who = m.from === "me" ? "Человек" : `${m.emoji || ""} ${m.name}`.trim();
    const attach =
      m.attachments && m.attachments.length
        ? ` [приложено: ${m.attachments.map((a) => a.name).join(", ")}]`
        : "";
    const line = `${who}: ${m.content}${attach}`;
    used += line.length;
    if (used > budget && lines.length > 0) {
      lines.unshift("(начало обсуждения не поместилось и опущено)");
      break;
    }
    lines.unshift(line);
  }
  return lines.join("\n\n");
}

/**
 * Что именно просят у роли на этом ходу.
 *
 * Отдельным сообщением, а не подмешиванием в системный промпт: системная часть
 * кэшируется провайдером и должна оставаться одинаковой, а «сейчас твоя очередь,
 * круг второй» меняется каждый ход.
 */
function turnRequest({ role, messages, round = 0, rounds = 1, isRoom = false, mode = "chat" }) {
  const body = transcript(messages);
  if (!isRoom) {
    return body;
  }
  const stage =
    round === 0
      ? "Первый круг: скажи своё — то, чего не скажет никто другой в этой комнате."
      : round + 1 >= rounds
        ? "Последний круг: ответь на возражения коллег и скажи, к чему ты пришёл. Новых тем не открывай."
        : "Следующий круг: отреагируй на сказанное коллегами — где согласен, где нет и почему.";
  const taskNote =
    mode === "task"
      ? "\nЭто поручение: человека рядом нет. Не задавай ему вопросов — работай на допущениях и называй их."
      : "";
  return `${body}

=== ТВОЙ ХОД ===
Ты — ${role.name}. ${stage}${taskNote}
Пиши только свою реплику, без подписи и без пересказа того, что уже сказано.`;
}

/** Задание на итог: то, ради чего собирались. */
function summaryRequest({ messages, roles }) {
  return `${transcript(messages)}

=== ИТОГ ВСТРЕЧИ ===
Ты ведёшь эту встречу. Собери итог так, чтобы человек мог по нему действовать:

**Решение** — к чему пришли, одним абзацем. Если не пришли — так и напиши, и назови, что мешает.
**Разногласия** — по каким пунктам мнения разошлись и в чём суть спора (если разногласий не было, напиши «нет»).
**План** — таблица: шаг | кто делает (из участников: ${roles
    .map((r) => r.name)
    .join(", ")}) | к какому сроку | по чему поймём, что сделано.
**Риски** — три главных, с признаком, по которому их видно заранее.
**Что проверить** — чего не хватило для уверенного решения.

Не повторяй реплики целиком и не хвали участников.`;
}

/**
 * Проводит круг (или несколько) обсуждения.
 *
 * `ask(role, userContent, meta)` — вызов модели, который даёт main.cjs: он знает
 * про настройки, картинки, поиск в интернете и учёт расхода. Здесь — только
 * очередь, обрезка контекста и формулировки заданий.
 *
 * Возвращает новые сообщения. Сохранение — на вызывающей стороне: так в окне
 * приложения реплики появляются по одной, а не все разом в конце.
 */
async function runDiscussion({
  chat,
  roles,
  ask,
  onEvent = () => {},
  shouldStop = () => false,
  mode = "chat",
  withSummary,
}) {
  const isRoom = chat.kind === "room" && roles.length > 1;
  const rounds = isRoom ? Math.min(Math.max(chat.rounds || 2, 1), MAX_ROUNDS) : 1;
  const wantSummary = withSummary === undefined ? isRoom : withSummary;
  const produced = [];
  const messages = [...chat.messages];
  const lastUser = [...messages].reverse().find((m) => m.from === "me");
  let order = isRoom ? speakingOrder(roles, lastUser ? lastUser.content : "") : roles;

  for (let round = 0; round < rounds; round++) {
    for (const role of order) {
      if (shouldStop()) return produced;
      onEvent({ type: "speaking", roleId: role.id, name: role.name, emoji: role.emoji, round });
      const content = await ask(role, turnRequest({ role, messages, round, rounds, isRoom, mode }), {
        round,
        kind: "turn",
      });
      const message = roleMessage(role, content, isRoom ? { round } : {});
      messages.push(message);
      produced.push(message);
      onEvent({ type: "message", message });
    }
    if (round + 1 < rounds) {
      // Следующий круг начинают те, к кому обратились в этом: иначе адресованный
      // вопрос ждёт своей очереди по списку и половина разговора идёт мимо него.
      const calls = produced
        .slice(-order.length)
        .map((m) => m.content)
        .join("\n");
      order = speakingOrder(roles, calls);
    }
  }

  if (wantSummary && !shouldStop() && roles.length > 1) {
    const lead = roles[0];
    onEvent({ type: "speaking", roleId: lead.id, name: lead.name, emoji: lead.emoji, summary: true });
    const content = await ask(lead, summaryRequest({ messages, roles }), { kind: "summary" });
    const message = roleMessage(lead, content, { summary: true, name: `${lead.name} — итог встречи` });
    produced.push(message);
    onEvent({ type: "message", message });
  }

  onEvent({ type: "done" });
  return produced;
}

/**
 * Разговор в виде разделов для выгрузки в Word/Excel/PDF.
 *
 * Имя говорившего идёт в поле role: exportDocs печатает его как подпись к
 * разделу, и в выгруженном файле видно, кто что сказал, — иначе переговорка
 * превращается в сплошной текст без авторов.
 */
function exportSections(chat) {
  return chat.messages.map((m) => ({
    role: m.from === "me" ? "Вы" : `${m.emoji || ""} ${m.name}`.trim(),
    content: m.content,
  }));
}

/** Только итог встречи — то, что чаще всего и нужно сохранить. */
function summarySections(chat) {
  const summaries = chat.messages.filter((m) => m.summary);
  const last = summaries[summaries.length - 1];
  return last ? [{ role: last.name, content: last.content }] : exportSections(chat);
}

module.exports = {
  MAX_ROUNDS,
  MAX_ROLES_IN_ROOM,
  TRANSCRIPT_BUDGET,
  chatsDir,
  newChat,
  normalizeChat,
  list,
  read,
  save,
  remove,
  userMessage,
  roleMessage,
  mentionedRoleIds,
  speakingOrder,
  transcript,
  turnRequest,
  summaryRequest,
  runDiscussion,
  exportSections,
  summarySections,
};
