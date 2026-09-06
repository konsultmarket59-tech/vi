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
const fsSync = require("node:fs");
const os = require("node:os");

// Enough to see what led to a crash, small enough to stay readable.
const MAX_ENTRIES = 300;
const MAX_ENTRY_CHARS = 2000;

const entries = [];

// Падения переживают перезапуск: журнал ошибок живёт в памяти и исчезает
// вместе с процессом, поэтому именно про падение — то единственное, что человек
// точно заметил, — в отчёте не оказывалось ни строчки. Здесь их немного и они
// маленькие, так что файл остаётся читаемым.
const MAX_CRASHES = 20;
let crashFile = null;
let crashes = [];

function crashLogPath() {
  if (!crashFile) crashFile = path.join(app.getPath("userData"), "падения.json");
  return crashFile;
}

/** Прошлые падения читаются один раз при старте — до того, как окно откроется. */
async function loadCrashes() {
  try {
    const raw = await fs.readFile(crashLogPath(), "utf-8");
    const parsed = JSON.parse(raw);
    crashes = Array.isArray(parsed) ? parsed.slice(-MAX_CRASHES) : [];
  } catch {
    crashes = [];
  }
  return crashes;
}

/**
 * Записывает падение окна на диск сразу, не откладывая: если следом умрёт и
 * главный процесс, запись всё равно уже сделана.
 */
function recordCrash({ kind, reason, exitCode }) {
  const entry = {
    at: new Date().toISOString(),
    что: kind,
    причина: reason || "",
    код: typeof exitCode === "number" ? exitCode : null,
  };
  crashes.push(entry);
  if (crashes.length > MAX_CRASHES) crashes.splice(0, crashes.length - MAX_CRASHES);
  record("main", "error", `падение окна: ${kind} ${reason || ""} код=${entry.код ?? "-"}`);
  fsSync.writeFileSync(crashLogPath(), JSON.stringify(crashes, null, 2), "utf-8");
  return entry;
}

/** Падения, случившиеся до этого запуска, — их и показывает приложение. */
function pastCrashes() {
  return crashes.slice();
}

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
  return { total: entries.length, errors, since: entries[0]?.at || "", crashes: crashes.length };
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
    падения: crashes,
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

module.exports = { install, record, recordFromRenderer, summary, write, loadCrashes, recordCrash, pastCrashes };
