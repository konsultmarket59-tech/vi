// Problem reports from the test group.
//
// No telemetry: nothing is sent anywhere on its own. The app keeps a small
// rolling log of its own errors, and when a tester presses "Сообщить о
// проблеме" it writes one file to the Desktop that they send back. That keeps
// the whole thing free of servers, of consent questions, and of any chance of
// quietly collecting someone's work.
//
// What goes in the file is deliberately narrow: app version, OS, the error
// lines the app itself produced, and what the tester typed. Not the contents of
// their projects, not their API key.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");

// Enough to see what led to a crash, small enough to stay readable.
const MAX_ENTRIES = 300;
const MAX_ENTRY_CHARS = 2000;

const entries = [];

function record(source, level, message) {
  const text = String(message ?? "").slice(0, MAX_ENTRY_CHARS);
  entries.push({ at: new Date().toISOString(), source, level, message: text });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/**
 * Wraps console.error/warn so everything the app already reports becomes part of
 * the log without having to touch every call site, and catches what would
 * otherwise vanish into a closed terminal.
 */
function install() {
  for (const level of ["error", "warn"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      record("main", level, args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(" "));
      original(...args);
    };
  }
  process.on("uncaughtException", (e) => record("main", "error", `uncaughtException: ${e?.stack || e}`));
  process.on("unhandledRejection", (e) => record("main", "error", `unhandledRejection: ${e?.stack || e}`));
}

/** Errors from the window, forwarded by the preload bridge. */
function recordFromRenderer(level, message) {
  record("renderer", level === "warn" ? "warn" : "error", message);
  return true;
}

function summary() {
  const errors = entries.filter((e) => e.level === "error").length;
  return { total: entries.length, errors, since: entries[0]?.at || "" };
}

/**
 * Writes the report next to the tester's other files, where they will actually
 * find it. Returns the path so the app can say exactly what to send.
 */
async function write({ description = "", version = "", productName = "", tester = "", extra = {} } = {}) {
  const now = new Date();
  const report = {
    приложение: productName || app.getName(),
    версия: version || app.getVersion(),
    составлен: now.toISOString(),
    тестировщик: tester || "",
    система: {
      платформа: process.platform,
      версияОС: os.release(),
      архитектура: process.arch,
      electron: process.versions.electron,
      память: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} ГБ`,
    },
    ...extra,
    описаниеПроблемы: description || "(не заполнено)",
    журналОшибок: entries,
  };

  let dir;
  try {
    dir = app.getPath("desktop");
    await fs.access(dir);
  } catch {
    dir = app.getPath("userData");
  }
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = path.join(dir, `отчёт-о-проблеме-${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2), "utf-8");
  return { file, entries: entries.length };
}

module.exports = { install, record, recordFromRenderer, summary, write };
