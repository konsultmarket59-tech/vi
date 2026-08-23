const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

function opsDir(root) {
  return path.join(root, "operations");
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

function slugify(name) {
  return (
    (name || "")
      .trim()
      .toLowerCase()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "sheet"
  );
}

async function listSheets(root) {
  const dir = opsDir(root);
  await ensureDir(dir);
  const entries = await fs.readdir(dir).catch(() => []);
  const sheets = [];
  for (const f of entries) {
    if (!f.endsWith(".json")) continue;
    const data = await readJson(path.join(dir, f), null);
    if (!data) continue;
    sheets.push({ id: f.replace(/\.json$/, ""), ...data });
  }
  sheets.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, "ru"));
  return sheets;
}

async function saveSheet(root, sheet) {
  const dir = opsDir(root);
  await ensureDir(dir);
  const existing = sheet.id ? await readJson(path.join(dir, sheet.id + ".json"), null) : null;
  let id = sheet.id;
  if (!id) {
    id = slugify(sheet.name);
    let n = 2;
    while (fsSync.existsSync(path.join(dir, id + ".json"))) {
      id = `${slugify(sheet.name)}-${n}`;
      n++;
    }
  }
  const data = {
    name: sheet.name,
    rows: sheet.rows,
    order: sheet.order ?? existing?.order ?? 999,
    updatedAt: Date.now(),
  };
  await writeJson(path.join(dir, id + ".json"), data);
  return { id, ...data };
}

async function deleteSheet(root, id) {
  await fs.rm(path.join(opsDir(root), id + ".json"), { force: true });
}

function colLettersToNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseCellRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: colLettersToNum(m[1]), row: parseInt(m[2], 10) };
}

// ExcelJS's row.values (used below) copies a merged cell's value into every column
// the merge spans — so a title banner merged across, say, A1:F1 comes back as that
// same title repeated in all 6 columns, which is exactly what made imported sheets
// with section-title rows (a very common spreadsheet pattern) unreadable: the title
// row looked like a second, bogus header, and it threw off column alignment for
// every row below it. Blank out every cell in a merge except its top-left one so
// each merged title/label only appears once, where it actually belongs.
function blankMergedContinuations(rows, merges) {
  for (const range of merges || []) {
    const [startRef, endRef] = range.split(":");
    const start = parseCellRef(startRef);
    const end = endRef ? parseCellRef(endRef) : start;
    for (let r = start.row; r <= end.row; r++) {
      if (!rows[r - 1]) continue;
      for (let c = start.col; c <= end.col; c++) {
        if (r === start.row && c === start.col) continue;
        if (c - 1 < rows[r - 1].length) rows[r - 1][c - 1] = "";
      }
    }
  }
}

function cellToPlain(v) {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return typeof v.text === "string" ? v.text : cellToPlain(v.text);
    if (v.result != null) return cellToPlain(v.result);
    if (v.hyperlink) return v.text || v.hyperlink;
    return "";
  }
  return v;
}

/** Imports every sheet of an .xlsx file as a plain grid (rows of cell values), overwriting sheets with the same name. */
async function importXlsx(root, filePath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const dir = opsDir(root);
  await ensureDir(dir);
  const existingSheets = await listSheets(root);
  const existingByName = new Map(existingSheets.map((s) => [s.name, s.id]));

  const results = [];
  let order = 0;
  workbook.eachSheet((worksheet) => {
    order++;
    const rows = [];
    let maxCol = 0;
    // includeEmpty keeps blank spacer rows in place, so array index i always maps to
    // worksheet row i+1 — required for blankMergedContinuations below, whose merge
    // ranges are given in real (1-based) worksheet row numbers. Without this, a sheet
    // with any blank row between sections (very common — it's exactly how these
    // section-title rows are visually separated) would silently compact the row
    // indices, and every merge would end up blanking the wrong row entirely.
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values.slice(1).map(cellToPlain);
      maxCol = Math.max(maxCol, values.length);
      rows.push(values);
    });
    for (const r of rows) while (r.length < maxCol) r.push("");
    blankMergedContinuations(rows, worksheet.model.merges);
    results.push({ name: worksheet.name, rows, order });
  });

  const saved = [];
  for (const s of results) {
    const id = existingByName.get(s.name);
    saved.push(await saveSheet(root, { id, name: s.name, rows: s.rows, order: s.order }));
  }
  return saved;
}

// ---------- agent-proposed edits ----------

const MAX_SHEET_CHARS = 40000;
const MAX_TOTAL_CHARS = 250000;

function rowsToText(rows) {
  return rows
    .map((row, i) => `${i}: [${row.map((c) => JSON.stringify(c)).join(", ")}]`)
    .join("\n");
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n[...обрезано, лист длиннее лимита в ${max} символов...]`;
}

const OPS_AGENT_PROMPT_HEADER = `Ты — ассистент по операционке (финансы и процессы) маркетингового агентства.
Ниже приведены текущие данные — листы, каждый как таблица со строками, где первое число — индекс строки (0-based).
Твоя задача — отвечать на вопросы по этим данным и, когда пользователь просит что-то добавить/изменить/удалить,
предлагать точное изменение в строго заданном формате (это важно — по нему приложение распознаёт и предлагает
применить изменение):

===OPS EDIT START===
SHEET: <точное название листа как указано ниже>
ACTION: add_row | update_row | delete_row
ROW_INDEX: <0-based индекс строки — обязательно для update_row и delete_row, пропусти для add_row>
VALUES: [<значение1>, <значение2>, ...]  (обязательно для add_row и update_row, JSON-массив значений по столбцам; пропусти для delete_row)
===OPS EDIT END===

Правила:
- Значений в VALUES должно быть ровно столько же, сколько столбцов в существующих строках этого листа.
- Никогда не применяй изменение сам — только предлагай, приложение покажет пользователю подтверждение.
- Если данных не хватает для точного изменения (не знаешь номер строки, не все значения) — сначала уточни у пользователя.
- Можно предложить только одно изменение за раз (один блок). Если изменений несколько — предложи их по очереди в отдельных ответах.
- Отвечай по-русски, используй профессиональную терминологию агентства (ставки, себестоимость, маржа, ЛТВ и т.п.).

=== ТЕКУЩИЕ ДАННЫЕ ===`;

async function buildAgentSystemPrompt(root) {
  const sheets = await listSheets(root);
  const parts = [OPS_AGENT_PROMPT_HEADER];
  for (const sheet of sheets) {
    parts.push(`\n--- Лист: ${sheet.name} (${sheet.rows.length} строк) ---\n${truncate(rowsToText(sheet.rows), MAX_SHEET_CHARS)}`);
  }
  let full = parts.join("\n");
  if (full.length > MAX_TOTAL_CHARS) {
    full = full.slice(0, MAX_TOTAL_CHARS) + "\n[...общий контекст обрезан по лимиту...]";
  }
  return full;
}

async function applyEdit(root, edit) {
  const sheets = await listSheets(root);
  const sheet = sheets.find((s) => s.name === edit.sheet);
  if (!sheet) throw new Error(`Лист "${edit.sheet}" не найден.`);

  const rows = sheet.rows.map((r) => [...r]);
  if (edit.action === "add_row") {
    rows.push(edit.values);
  } else if (edit.action === "update_row") {
    if (edit.rowIndex == null || !rows[edit.rowIndex]) throw new Error(`Строка ${edit.rowIndex} не найдена.`);
    rows[edit.rowIndex] = edit.values;
  } else if (edit.action === "delete_row") {
    if (edit.rowIndex == null || !rows[edit.rowIndex]) throw new Error(`Строка ${edit.rowIndex} не найдена.`);
    rows.splice(edit.rowIndex, 1);
  } else {
    throw new Error(`Неизвестное действие: ${edit.action}`);
  }

  return saveSheet(root, { id: sheet.id, name: sheet.name, rows, order: sheet.order });
}

module.exports = { listSheets, saveSheet, deleteSheet, importXlsx, buildAgentSystemPrompt, applyEdit };
