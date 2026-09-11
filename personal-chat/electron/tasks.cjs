const fs = require("node:fs/promises");
const path = require("node:path");

function tasksDir(root, projectId) {
  return path.join(root, "projects", projectId, "tasks");
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

function uid() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function list(root, projectId) {
  const dir = tasksDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const task = await readJson(path.join(dir, entry.name), null);
    if (task) items.push(task);
  }
  items.sort((a, b) => a.createdAt - b.createdAt);
  return items;
}

// Computes the next epoch-ms occurrence for a task from a given moment. For
// "once" tasks this is just the configured date+time (even if already in the
// past — the scheduler will then fire it on its next tick, catching up
// rather than silently dropping it). For "daily"/"weekly" it always returns
// a moment strictly after `fromTime`, rolling over to the next day/week if
// today's/this week's slot has already passed.
function computeNextRun(task, fromTime = Date.now()) {
  const [hh, mm] = String(task.time || "09:00")
    .split(":")
    .map((n) => parseInt(n, 10) || 0);

  if (task.recurrence === "daily") {
    const next = new Date(fromTime);
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= fromTime) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  if (task.recurrence === "weekly") {
    const targetWeekday = typeof task.weekday === "number" ? task.weekday : 0;
    const next = new Date(fromTime);
    next.setHours(hh, mm, 0, 0);
    let diff = targetWeekday - next.getDay();
    if (diff < 0) diff += 7;
    if (diff === 0 && next.getTime() <= fromTime) diff = 7;
    next.setDate(next.getDate() + diff);
    return next.getTime();
  }

  // "once"
  if (!task.date) return null;
  const [y, mo, d] = task.date.split("-").map((n) => parseInt(n, 10));
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d, hh, mm, 0, 0).getTime();
}

// ---------- период и разметка дайджеста ----------

const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatDay(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * За какой промежуток задача отчитывается.
 *
 * Считается здесь, а не моделью: «за неделю с такого по такое» — это факт, и
 * выдумывать его нельзя. Первый запуск отсчитывает назад один период
 * повторения, дальше — от прошлого запуска, чтобы между выпусками не
 * образовалось дырки и ни одна новость не потерялась дважды.
 */
function coveredPeriod(task, now = Date.now()) {
  const span = task.recurrence === "weekly" ? 7 * 24 : task.recurrence === "daily" ? 24 : 24;
  const fallback = now - span * 60 * 60 * 1000;
  const from = task.lastRunAt && task.lastRunAt < now ? task.lastRunAt : fallback;
  return { from, to: now, fromText: formatDay(from), toText: formatDay(now) };
}

/**
 * Что именно просят у модели в задаче-дайджесте.
 *
 * Разметка родилась из живой жалобы: задача возвращала две ссылки и ни слова
 * пояснений, а по темам, где новостей не нашлось, просто молчала — и было не
 * понять, то ли ничего не произошло, то ли поиск не сработал. Поэтому здесь
 * три жёстких требования: назвать период словами, разобрать каждую тему из
 * задания отдельно и про пустую тему сказать вслух, что нового нет, приложив
 * самое свежее близкое по смыслу.
 */
function buildDigestPrompt(task, period) {
  return [
    task.prompt,
    "",
    "---",
    `Сегодня ${formatDay(period.to)}. Отчёт за период с ${period.fromText} по ${period.toText}.`,
    "",
    "Как оформить ответ:",
    `1. Начни строкой «Период: с ${period.fromText} по ${period.toText}».`,
    "2. Разбери КАЖДУЮ тему из задания отдельным подзаголовком — даже те, по которым ничего не нашлось.",
    "3. Внутри темы — список новостей, свежие сверху. Каждый пункт: дата, что произошло, одно-два",
    "   предложения, почему это важно, и ссылка на источник. Одной ссылки без пояснения недостаточно.",
    "4. Если по теме за период ничего заметного не произошло — так и напиши: «за период с",
    `   ${period.fromText} по ${period.toText} ничего заметного не произошло», и следом дай самое`,
    "   свежее и близкое по смыслу, что удалось найти, с датой — чтобы было видно, насколько оно старое.",
    "5. В конце — короткий вывод: на что обратить внимание на следующей неделе.",
    "6. Ничего не выдумывай. Если источник не открылся, скажи об этом прямо, а не пересказывай наугад.",
  ].join("\n");
}

async function save(root, projectId, task) {
  const dir = tasksDir(root, projectId);
  await ensureDir(dir);
  const now = Date.now();
  const id = task.id || uid();
  const existing = task.id ? await readJson(path.join(dir, id + ".json"), null) : null;
  const enabled = task.enabled ?? existing?.enabled ?? true;
  const merged = { ...existing, ...task, id, projectId, enabled };
  const record = {
    id,
    projectId,
    title: merged.title,
    prompt: merged.prompt,
    recurrence: merged.recurrence || "once",
    time: merged.time || "09:00",
    date: merged.date,
    weekday: merged.weekday,
    enabled,
    // «Дайджест» просит разложить новости по темам с периодом и честным «ничего
    // нового»; «свободный» отдаёт задание модели как есть — для напоминаний и
    // всего, чему разметка дайджеста только мешает.
    format: merged.format === "free" ? "free" : "digest",
    lastRunAt: merged.lastRunAt,
    lastConversationId: merged.lastConversationId,
    lastError: merged.lastError || "",
    lastErrorAt: merged.lastErrorAt || null,
    nextRunAt: enabled ? computeNextRun(merged, now) : null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJson(path.join(dir, id + ".json"), record);
  return record;
}

async function remove(root, projectId, id) {
  await fs.rm(path.join(tasksDir(root, projectId), id + ".json"), { force: true });
}

async function findDueTasks(root, now = Date.now()) {
  const projectsRoot = path.join(root, "projects");
  const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  const due = [];
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) continue;
    const projectTasks = await list(root, entry.name);
    for (const task of projectTasks) {
      if (task.enabled && task.nextRunAt != null && task.nextRunAt <= now) due.push(task);
    }
  }
  return due;
}

/**
 * Занять слот ДО запуска задачи.
 *
 * Иначе один запуск давал два ответа. Раньше время следующего запуска сдвигалось
 * только после того, как задача досчиталась, а дайджест с поиском по сети идёт
 * минутами. Стоило приложению за это время закрыться или перезапуститься — при
 * следующем старте задача снова оказывалась просроченной и выполнялась второй
 * раз. Защита в памяти процесса такой случай не ловит по определению: память
 * умирает вместе с процессом. Поэтому слот занимается на диске сразу, и любой
 * исход — успех, ошибка, падение — оставляет ровно один ответ на один срок.
 */
async function claim(root, projectId, task, now = Date.now()) {
  const dir = tasksDir(root, projectId);
  await ensureDir(dir);
  const file = path.join(dir, task.id + ".json");
  const existing = (await readJson(file, null)) || task;
  const enabled = task.recurrence === "once" ? false : existing.enabled;
  const record = {
    ...existing,
    enabled,
    runStartedAt: now,
    nextRunAt: enabled ? computeNextRun(existing, now) : null,
    updatedAt: now,
  };
  await writeJson(file, record);
  return record;
}

let schedulerTimer = null;

// A task's nextRunAt only advances once onDue() finishes (that's what save()
// inside runScheduledTask does), and onDue() itself can run for minutes — a
// digest task researching the web across several tool rounds easily does.
// Without this guard, every 30s tick in between re-scans findDueTasks(),
// finds the same task still "due" (its nextRunAt hasn't moved yet) and fires
// it again — one weekly task turning into four duplicate conversations and
// four times the bill, all from a single intended run. Tracking in-flight
// task ids here — independent of how long a run takes — is what closes that
// window, rather than trying to guess a safe tick interval.
const runningTaskIds = new Set();

// One scan-and-dispatch pass, factored out of the setInterval below so a test
// can call it directly (twice, back to back, with a slow onDue) instead of
// waiting on real 30s ticks to exercise the runningTaskIds guard.
async function tick(getRoot, onDue) {
  try {
    const root = await getRoot();
    const due = await findDueTasks(root, Date.now());
    for (const task of due) {
      if (runningTaskIds.has(task.id)) continue;
      runningTaskIds.add(task.id);
      onDue(root, task)
        .catch((e) => console.error(`Не удалось выполнить задачу "${task.title}":`, e))
        .finally(() => runningTaskIds.delete(task.id));
    }
  } catch {
    // ignore transient errors (e.g. root folder briefly unavailable), retry next tick
  }
}

// Ticks every 30s (mirrors chatbots.cjs's funnel-step scheduler), scans every
// project's tasks for due ones, and hands each off to `onDue(root, task)` —
// which is responsible for actually running the task (calling the model,
// creating a conversation) and persisting the updated task via `save()`. If
// `onDue` throws, the task's nextRunAt is left untouched so it's retried on
// the following tick, same retry-on-error behavior as the funnel scheduler.
function startScheduler(getRoot, onDue) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => tick(getRoot, onDue), 30000);
}

module.exports = {
  list,
  save,
  remove,
  computeNextRun,
  findDueTasks,
  startScheduler,
  claim,
  coveredPeriod,
  buildDigestPrompt,
  formatDay,
  _tick: tick,
};
