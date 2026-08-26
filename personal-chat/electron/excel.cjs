// Live Excel workbooks: open a real .xlsx from anywhere on disk, edit cells and
// formulas, recalculate for real, and write the file back in place.
//
// This is deliberately different from ops.cjs, which keeps *snapshots* of imported
// sheets as JSON and never recalculates. Here the file on disk stays the source of
// truth: we load it with exceljs, keep the workbook object around, and save through
// it so styles, number formats, column widths and untouched sheets survive.
//
// Recalculation walks the dependency graph rather than re-evaluating blindly:
// fast-formula-parser's DepParser reports what each formula reads, so cells can be
// evaluated in an order where their inputs are already known, and genuine circular
// references are reported instead of looping forever.

const fs = require("node:fs/promises");
const path = require("node:path");
const FormulaParser = require("fast-formula-parser");
const { DepParser, FormulaError } = FormulaParser;
const { EXTRA_FUNCTIONS } = require("./excelFunctions.cjs");

// A range dependency is expanded cell by cell; a whole-column reference would be a
// million entries, so anything larger than this is trimmed to the sheet's real
// extent by the caller and, failing that, ignored for ordering purposes.
const MAX_RANGE_CELLS = 20000;

function colToLetters(col) {
  let s = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function lettersToCol(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function cellKey(row, col) {
  return `${colToLetters(col)}${row}`;
}

function parseCellKey(key) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(String(key).trim());
  if (!m) return null;
  return { col: lettersToCol(m[1]), row: parseInt(m[2], 10) };
}

/** exceljs cell values come in several shapes; reduce them to a plain scalar. */
function plainValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return typeof v.text === "string" ? v.text : plainValue(v.text);
    if (v.result !== undefined) return plainValue(v.result);
    if (v.hyperlink) return v.text || v.hyperlink;
    if (v.error) return v.error;
    return null;
  }
  return v;
}


/**
 * exceljs reports a merged cell's value on every cell the merge spans, so a banner
 * merged across A1:F1 comes back as that text repeated six times. Keep it only on
 * the merge's top-left cell — otherwise the grid shows duplicated headers and the
 * agent sees six copies of the same label.
 */
function blankMergedContinuations(cells, merges) {
  for (const range of merges || []) {
    const [startRef, endRef] = String(range).split(":");
    const start = parseCellKey(startRef);
    const end = endRef ? parseCellKey(endRef) : start;
    if (!start || !end) continue;
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        if (r === start.row && c === start.col) continue;
        delete cells[cellKey(r, c)];
      }
    }
  }
}

/**
 * Reads a workbook into a plain model: for each sheet, a map of "A1" -> cell.
 * A cell holds `formula` (without the leading "=") and/or a literal `value`, plus
 * `computed` — what recalculation last produced, which is what the UI displays.
 */
async function loadWorkbook(filePath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = [];
  workbook.eachSheet((worksheet) => {
    const cells = {};
    let maxRow = 0;
    let maxCol = 0;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const key = cellKey(rowNumber, colNumber);
        const record = {};
        if (cell.formula != null) {
          record.formula = cell.formula;
          record.computed = plainValue(cell.result);
        } else if (cell.sharedFormula != null) {
          // exceljs exposes shared formulas by reference; the cached result is still
          // the right thing to show, and a recalc will recompute from the master.
          record.formula = cell.formula || null;
          record.computed = plainValue(cell.result ?? cell.value);
        } else {
          record.value = plainValue(cell.value);
          record.computed = record.value;
        }
        if (cell.numFmt) record.numFmt = cell.numFmt;
        if (record.formula == null && record.value == null) return;
        cells[key] = record;
        maxRow = Math.max(maxRow, rowNumber);
        maxCol = Math.max(maxCol, colNumber);
      });
    });
    const merges = worksheet.model.merges || [];
    blankMergedContinuations(cells, merges);
    sheets.push({ name: worksheet.name, cells, maxRow, maxCol, merges });
  });

  return { filePath, name: path.basename(filePath), sheets };
}

/** Builds the parser bound to a workbook model's current computed values. */
function makeParser(model) {
  const bySheet = new Map(model.sheets.map((s) => [s.name, s]));

  const readCell = (sheetName, row, col) => {
    const sheet = bySheet.get(sheetName);
    if (!sheet) return null;
    const cell = sheet.cells[cellKey(row, col)];
    if (!cell) return null;
    const v = cell.computed !== undefined ? cell.computed : cell.value;
    return v === undefined ? null : v;
  };

  return new FormulaParser({
    functions: EXTRA_FUNCTIONS,
    onCell: ({ sheet, row, col }) => readCell(sheet || model.sheets[0]?.name, row, col),
    onRange: (ref) => {
      const sheetName = ref.sheet || model.sheets[0]?.name;
      const sheet = bySheet.get(sheetName);
      // Whole-column refs (A:A) come through as row 1..1048576; clamp to what the
      // sheet actually uses so a single SUM(A:A) doesn't allocate a million cells.
      const toRow = Math.min(ref.to.row, sheet ? Math.max(sheet.maxRow, ref.from.row) : ref.to.row);
      const toCol = Math.min(ref.to.col, sheet ? Math.max(sheet.maxCol, ref.from.col) : ref.to.col);
      const rows = [];
      for (let r = ref.from.row; r <= toRow; r++) {
        const row = [];
        for (let c = ref.from.col; c <= toCol; c++) row.push(readCell(sheetName, r, c));
        rows.push(row);
      }
      return rows.length ? rows : [[null]];
    },
  });
}

/** Every cell a formula reads, as "Sheet!A1" strings. */
function dependenciesOf(depParser, formula, sheetName, row, col, model) {
  let deps;
  try {
    deps = depParser.parse(formula, { sheet: sheetName, row, col });
  } catch {
    return [];
  }
  const out = [];
  const bySheet = new Map(model.sheets.map((s) => [s.name, s]));
  for (const dep of deps || []) {
    const depSheet = dep.sheet || sheetName;
    if (dep.from && dep.to) {
      const sheet = bySheet.get(depSheet);
      const toRow = Math.min(dep.to.row, sheet ? Math.max(sheet.maxRow, dep.from.row) : dep.to.row);
      const toCol = Math.min(dep.to.col, sheet ? Math.max(sheet.maxCol, dep.from.col) : dep.to.col);
      const size = Math.max(0, toRow - dep.from.row + 1) * Math.max(0, toCol - dep.from.col + 1);
      if (size > MAX_RANGE_CELLS) continue;
      for (let r = dep.from.row; r <= toRow; r++) {
        for (let c = dep.from.col; c <= toCol; c++) out.push(`${depSheet}!${cellKey(r, c)}`);
      }
    } else if (dep.row && dep.col) {
      out.push(`${depSheet}!${cellKey(dep.row, dep.col)}`);
    }
  }
  return out;
}

function formulaErrorToText(e) {
  if (e instanceof FormulaError) return e.toString();
  const msg = String(e?.message || e);
  // Unimplemented functions are worth naming outright, otherwise a cell just shows
  // a generic error and the user has no idea which function to work around.
  const m = /Function (\w[\w.]*) is not implemented/.exec(msg);
  return m ? `#NAME? (${m[1]})` : "#ERROR!";
}

/**
 * Recalculates every formula in the workbook model, in dependency order.
 * Mutates `computed` on each formula cell and returns a summary.
 */
function recalculate(model) {
  const depParser = new DepParser();
  const parser = makeParser(model);

  // Collect formula cells and their dependencies.
  const nodes = new Map(); // "Sheet!A1" -> {sheetName, row, col, cell, deps}
  for (const sheet of model.sheets) {
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!cell.formula) continue;
      const pos = parseCellKey(key);
      if (!pos) continue;
      nodes.set(`${sheet.name}!${key}`, {
        sheetName: sheet.name,
        row: pos.row,
        col: pos.col,
        cell,
        deps: dependenciesOf(depParser, cell.formula, sheet.name, pos.row, pos.col, model),
      });
    }
  }

  // Depth-first topological order over formula cells only; dependencies that are
  // plain values need no ordering because they're already final.
  const order = [];
  const state = new Map(); // id -> "visiting" | "done"
  const circular = [];

  const visit = (id) => {
    const status = state.get(id);
    if (status === "done") return;
    if (status === "visiting") {
      circular.push(id);
      return;
    }
    const node = nodes.get(id);
    if (!node) return; // literal cell — nothing to order
    state.set(id, "visiting");
    for (const dep of node.deps) if (nodes.has(dep)) visit(dep);
    state.set(id, "done");
    order.push(id);
  };
  for (const id of nodes.keys()) visit(id);

  const circularSet = new Set(circular);
  let evaluated = 0;
  const errors = [];

  for (const id of order) {
    const node = nodes.get(id);
    if (circularSet.has(id)) {
      node.cell.computed = "#CIRCULAR!";
      errors.push({ cell: id, error: "циклическая ссылка" });
      continue;
    }
    try {
      const result = parser.parse(node.cell.formula, { sheet: node.sheetName, row: node.row, col: node.col });
      node.cell.computed =
        result instanceof FormulaError ? result.toString() : result === undefined ? null : result;
      if (result instanceof FormulaError) errors.push({ cell: id, error: result.toString() });
      else evaluated++;
    } catch (e) {
      node.cell.computed = formulaErrorToText(e);
      errors.push({ cell: id, error: formulaErrorToText(e) });
    }
  }

  return { evaluated, total: nodes.size, errors, circular };
}

/** Applies a single cell edit. A leading "=" makes it a formula. */
function setCell(model, sheetName, key, raw) {
  const sheet = model.sheets.find((s) => s.name === sheetName);
  if (!sheet) throw new Error(`Лист "${sheetName}" не найден.`);
  const pos = parseCellKey(key);
  if (!pos) throw new Error(`Некорректный адрес ячейки: ${key}`);

  const text = raw == null ? "" : String(raw);
  const existing = sheet.cells[key] || {};

  if (text.trim() === "") {
    delete sheet.cells[key];
  } else if (text.startsWith("=")) {
    sheet.cells[key] = { ...existing, formula: text.slice(1), value: undefined, computed: null };
  } else {
    // Keep numbers numeric so arithmetic on them works; everything else stays text.
    const num = Number(text.replace(",", "."));
    const value = text.trim() !== "" && !isNaN(num) && /^[\d\s.,+-]+$/.test(text) ? num : text;
    sheet.cells[key] = { ...existing, formula: undefined, value, computed: value };
  }
  sheet.maxRow = Math.max(sheet.maxRow, pos.row);
  sheet.maxCol = Math.max(sheet.maxCol, pos.col);
  return sheet.cells[key] || null;
}

/**
 * Writes the model back through the original workbook file, so styling and any
 * sheet features we don't model (widths, colors, images) are preserved.
 */
async function saveWorkbook(model, targetPath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(model.filePath);

  for (const sheet of model.sheets) {
    let worksheet = workbook.getWorksheet(sheet.name);
    if (!worksheet) worksheet = workbook.addWorksheet(sheet.name);

    // Clear cells that were deleted in the model but still exist in the file.
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const key = cellKey(rowNumber, colNumber);
        if (!sheet.cells[key]) cell.value = null;
      });
    });

    for (const [key, record] of Object.entries(sheet.cells)) {
      const pos = parseCellKey(key);
      if (!pos) continue;
      const cell = worksheet.getCell(pos.row, pos.col);
      if (record.formula) {
        // Writing the cached result too means Excel shows the value immediately,
        // without asking to recalculate on open.
        cell.value = { formula: record.formula, result: record.computed ?? 0 };
      } else {
        cell.value = record.value ?? null;
      }
      if (record.numFmt) cell.numFmt = record.numFmt;
    }
  }

  const dest = targetPath || model.filePath;
  await workbook.xlsx.writeFile(dest);
  return dest;
}

/** Compact text rendering of the workbook for the AI agent's context. */
function toAgentText(model, maxCharsPerSheet = 12000) {
  const parts = [];
  for (const sheet of model.sheets) {
    const lines = [`--- Лист: ${sheet.name} (${sheet.maxRow} строк, ${sheet.maxCol} столбцов) ---`];
    for (let r = 1; r <= sheet.maxRow; r++) {
      const rowParts = [];
      for (let c = 1; c <= sheet.maxCol; c++) {
        const key = cellKey(r, c);
        const cell = sheet.cells[key];
        if (!cell) continue;
        const shown = cell.formula ? `=${cell.formula} → ${cell.computed ?? ""}` : cell.value;
        if (shown === null || shown === undefined || shown === "") continue;
        rowParts.push(`${key}: ${shown}`);
      }
      if (rowParts.length) lines.push(rowParts.join(" | "));
    }
    let text = lines.join("\n");
    if (text.length > maxCharsPerSheet) text = text.slice(0, maxCharsPerSheet) + "\n[...лист обрезан по лимиту...]";
    parts.push(text);
  }
  return parts.join("\n\n");
}

const AGENT_PROMPT_HEADER = `Ты — ассистент по работе с таблицами Excel. Ниже — содержимое открытой книги: для каждой
непустой ячейки указан её адрес и значение, а для формул — сама формула и посчитанный результат.

Ты можешь отвечать на вопросы по данным и предлагать правки. Чтобы предложить правку, верни блок строго
такого вида (по нему приложение распознаёт изменение и покажет подтверждение):

===EXCEL EDIT START===
SHEET: <точное имя листа>
CELLS:
A1 = 100
B2 = =SUM(A1:A10)
C3 = Текст
===EXCEL EDIT END===

Правила:
- Формулы пиши с ведущим "=", как в Excel. Обычные значения — без него.
- Можно менять несколько ячеек за раз, каждую с новой строки.
- Никогда не применяй правку сам — приложение покажет пользователю подтверждение.
- После правки формулы пересчитываются автоматически, результаты вручную писать не нужно.
- Если данных не хватает (не знаешь адрес ячейки или значение) — сначала уточни у пользователя.
- Отвечай по-русски.

=== СОДЕРЖИМОЕ КНИГИ ===`;

function buildAgentPrompt(model) {
  return `${AGENT_PROMPT_HEADER}\nФайл: ${model.name}\n\n${toAgentText(model)}`;
}

/** Parses the agent's proposed edit block. */
function parseAgentEdit(text) {
  const match = /===EXCEL EDIT START===([\s\S]*?)===EXCEL EDIT END===/.exec(text || "");
  if (!match) return null;
  const block = match[1];
  const sheet = /SHEET:\s*(.+)/.exec(block)?.[1]?.trim();
  if (!sheet) return null;
  const cellsPart = block.split(/CELLS:\s*/)[1];
  if (!cellsPart) return null;
  const cells = [];
  for (const line of cellsPart.split("\n")) {
    const m = /^\s*([A-Za-z]+\d+)\s*=\s*(.*)$/.exec(line);
    if (m) cells.push({ cell: m[1].toUpperCase(), value: m[2].trim() });
  }
  return cells.length ? { sheet, cells } : null;
}

module.exports = {
  loadWorkbook,
  saveWorkbook,
  recalculate,
  setCell,
  buildAgentPrompt,
  parseAgentEdit,
  toAgentText,
  colToLetters,
  lettersToCol,
  cellKey,
  parseCellKey,
};
