// Учёт расхода моделей: что использовано за день, неделю, месяц и во сколько
// обошлось.
//
// Записи хранятся помесячно в папке настроек приложения, обычным JSON. Никуда не
// отправляются — это счётчик для самого пользователя и для автора, которому
// тестировщик может показать цифры.
//
// Точность. Если сервис вернул usage (сколько токенов реально потрачено) —
// пишем как есть и помечаем «точно». Если не вернул — записываем оценку по
// длине текста и помечаем «оценка», чтобы никто не принял прикидку за счёт.
// Смешивать эти две вещи молча нельзя: по неверной цифре строят финмодель.

const path = require("node:path");
const fs = require("node:fs/promises");

// Грубая, намеренно консервативная оценка: на кириллице токенизаторы дают
// примерно 2–3 символа на токен, берём 3, чтобы не занижать расход.
const CHARS_PER_TOKEN = 3;

let dir = null;

function init(userDataPath) {
  dir = path.join(userDataPath, "usage");
}

function monthFile(date) {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return path.join(dir, `${stamp}.json`);
}

async function readMonth(date) {
  try {
    const parsed = JSON.parse(await fs.readFile(monthFile(date), "utf-8"));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

async function record(entry) {
  if (!dir) return null;
  const now = new Date();
  const promptTokens = Math.max(0, Math.round(Number(entry.promptTokens) || 0));
  const completionTokens = Math.max(0, Math.round(Number(entry.completionTokens) || 0));
  if (!promptTokens && !completionTokens) return null;

  const row = {
    at: now.toISOString(),
    model: String(entry.model || "неизвестно"),
    promptTokens,
    completionTokens,
    // Часть входа, прочитанная из кэша провайдера. Ноль здесь при большом входе —
    // главный признак того, что кэш не работает и вход оплачивается полностью.
    cachedTokens: Math.max(0, Math.round(Number(entry.cachedTokens) || 0)),
    exact: entry.exact === true,
    source: String(entry.source || "чат"),
  };
  const records = await readMonth(now);
  records.push(row);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(monthFile(now), JSON.stringify({ records }, null, 2), "utf-8");
  return row;
}

/** Оценка по длине, когда сервис не вернул usage. */
function estimateTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

function costOf(model, promptTokens, completionTokens, priceTable) {
  const price = priceTable[model];
  if (!price) return null;
  const input = Number(price.input);
  const output = Number(price.output);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return (promptTokens / 1e6) * input + (completionTokens / 1e6) * output;
}

function startOf(period, now) {
  const date = new Date(now);
  if (period === "day") {
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (period === "week") {
    // Неделя с понедельника — так её считают в России.
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Сводка за период: по каждой модели — токены и стоимость. Если хотя бы одна
 * запись в периоде оценочная, весь итог помечается как оценка, иначе цифра
 * выглядела бы точнее, чем есть.
 */
async function summary(period = "day", { prices = {}, currency = "₽" } = {}) {
  if (!dir) return { period, from: "", models: [], totals: null };
  const now = new Date();
  const from = startOf(period, now);

  // Месячный файл один, но неделя и месяц могут захватывать предыдущий.
  const records = [...(await readMonth(from)), ...(from.getMonth() === now.getMonth() ? [] : await readMonth(now))];

  const byModel = new Map();
  let anyEstimated = false;
  let known = true;

  for (const row of records) {
    if (new Date(row.at) < from) continue;
    if (!row.exact) anyEstimated = true;
    const current = byModel.get(row.model) || {
      model: row.model,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      calls: 0,
      exact: true,
    };
    current.promptTokens += row.promptTokens;
    current.completionTokens += row.completionTokens;
    current.cachedTokens += row.cachedTokens || 0;
    current.calls += 1;
    if (!row.exact) current.exact = false;
    byModel.set(row.model, current);
  }

  const models = [...byModel.values()].map((entry) => {
    // Кэшированный вход у Anthropic стоит примерно десятую часть обычного, поэтому
    // считаем его отдельно — иначе экономия от кэша в отчёте не видна.
    const fresh = Math.max(0, entry.promptTokens - entry.cachedTokens);
    const cost = costOf(entry.model, fresh + entry.cachedTokens * 0.1, entry.completionTokens, prices);
    if (cost === null) known = false;
    return { ...entry, tokens: entry.promptTokens + entry.completionTokens, cost };
  });
  models.sort((a, b) => b.tokens - a.tokens);

  const tokens = models.reduce((sum, m) => sum + m.tokens, 0);
  const cost = models.reduce((sum, m) => sum + (m.cost || 0), 0);

  return {
    period,
    from: from.toISOString(),
    models,
    totals: {
      calls: models.reduce((sum, m) => sum + m.calls, 0),
      tokens,
      // null означает «часть моделей без заданной цены» — показывать сумму,
      // которая молча не учитывает половину расхода, хуже, чем не показывать.
      cost: known ? cost : null,
      currency,
      estimated: anyEstimated,
      cachedTokens: models.reduce((sum, m) => sum + (m.cachedTokens || 0), 0),
    },
  };
}

/** Удаляет файлы старше N месяцев — счётчик не должен расти вечно. */
async function prune(keepMonths = 12) {
  if (!dir) return 0;
  let removed = 0;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - keepMonths);
  const entries = await fs.readdir(dir).catch(() => []);
  for (const name of entries) {
    const match = name.match(/^(\d{4})-(\d{2})\.json$/);
    if (!match) continue;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    if (date < cutoff) {
      await fs.rm(path.join(dir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

module.exports = { init, record, summary, estimateTokens, prune, CHARS_PER_TOKEN };
