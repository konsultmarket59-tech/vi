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
    lastRunAt: merged.lastRunAt,
    lastConversationId: merged.lastConversationId,
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

let schedulerTimer = null;

// Ticks every 30s (mirrors chatbots.cjs's funnel-step scheduler), scans every
// project's tasks for due ones, and hands each off to `onDue(root, task)` —
// which is responsible for actually running the task (calling the model,
// creating a conversation) and persisting the updated task via `save()`. If
// `onDue` throws, the task's nextRunAt is left untouched so it's retried on
// the following tick, same retry-on-error behavior as the funnel scheduler.
function startScheduler(getRoot, onDue) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(async () => {
    try {
      const root = await getRoot();
      const due = await findDueTasks(root, Date.now());
      for (const task of due) {
        try {
          await onDue(root, task);
        } catch (e) {
          console.error(`Не удалось выполнить задачу "${task.title}":`, e);
        }
      }
    } catch {
      // ignore transient errors (e.g. root folder briefly unavailable), retry next tick
    }
  }, 30000);
}

module.exports = { list, save, remove, computeNextRun, findDueTasks, startScheduler };
