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

/**
 * Rewrites ";" argument separators to ",".
 *
 * Russian Excel shows and accepts "=IF(A1>5;"да";"нет")", and that is how the user —
 * and the AI agent writing for her — naturally types a formula. The .xlsx format and
 * the formula engine both use "," regardless of locale, so the separator is converted
 * on the way in. Quoted text and array constants ({1;2}) keep their semicolons: only
 * separators outside strings and outside braces are touched.
 */
function normalizeSeparators(formula) {
  let out = "";
  let inString = false;
  let braces = 0;
  for (let i = 0; i < formula.length; i++) {
    const ch = formula[i];
    if (ch === '"') {
      // "" inside a string is an escaped quote, not the end of it.
      if (inString && formula[i + 1] === '"') {
        out += '""';
        i++;
        continue;
      }
      inString = !inString;
      out += ch;
      continue;
    }
    if (!inString && ch === "{") braces++;
    if (!inString && ch === "}") braces = Math.max(0, braces - 1);
    out += !inString && braces === 0 && ch === ";" ? "," : ch;
  }
  return out;
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
    sheet.cells[key] = {
      ...existing,
      formula: normalizeSeparators(text.slice(1)),
      value: undefined,
      computed: null,
    };
  } else {
    // Keep numbers numeric so arithmetic on them works; everything else stays text.
    const num = Number(text.replace(",", "."));
    const value = text.trim() !== "" && !isNaN(num) && /^[\d\s.,+-]+$/.test(text) ? num : text;
    sheet.cells[key] = { ...existing, formula: undefined, value, computed: value };
  }
  sheet.maxRow = Math.max(sheet.maxRow, pos.row);
  sheet.maxCol = Math.max(sheet.maxCol, pos.col);
  delete sheet.placeholder; // it has content now, so it is a real sheet
  return sheet.cells[key] || null;
}

/**
 * Writes the model back through the original workbook file, so styling and any
 * sheet features we don't model (widths, colors, images) are preserved.
 *
 * A workbook created inside the app has no file behind it yet, so there is nothing
 * to read back — it starts from an empty ExcelJS workbook instead.
 */
async function saveWorkbook(model, targetPath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  if (model.filePath) {
    try {
      await workbook.xlsx.readFile(model.filePath);
    } catch {
      // File is gone or was never written (new workbook) — start clean.
    }
  }

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
  if (!dest) throw new Error("Для новой книги сначала выберите, куда её сохранить.");
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

const AGENT_PROMPT_HEADER = `Ты — ИИ-агент по работе с таблицами Excel. Ниже — содержимое открытой книги: для каждой
непустой ячейки указан её адрес и значение, а для формул — сама формула и посчитанный результат.

Ты умеешь три вещи: разбирать данные, считать по ним и строить новые таблицы с формулами.

1) ПОСМОТРЕТЬ И ПОСЧИТАТЬ (без изменений в книге)
Если нужно свериться с данными или что-то вычислить до того, как предлагать правку, верни блок:

===EXCEL TOOL===
CALC: =SUMIFS(Продажи!D2:D500; Продажи!B2:B500; "Ромашка")
===EXCEL TOOL END===

или, чтобы прочитать кусок листа целиком (полезно, когда лист большой и обрезан):

===EXCEL TOOL===
READ: Продажи!A1:H40
===EXCEL TOOL END===

Приложение выполнит это по живой книге и вернёт результат тебе следующим сообщением — ничего в файле
при этом не меняется. Можно вызывать несколько раз подряд, по одному блоку за ответ. Формулу в CALC
пиши как в Excel, она считается по текущим данным книги.

2) ИЗМЕНИТЬ ИЛИ СОЗДАТЬ ТАБЛИЦУ
Чтобы предложить правку, верни блок строго такого вида (по нему приложение покажет подтверждение):

===EXCEL EDIT START===
SHEET: Расчёт маржи
ROWS: A1
Клиент | Выручка | Себестоимость | Маржа, ₽ | Маржа, %
ООО «Ромашка» | 850000 | 500000 | =B2-C2 | =IF(B2=0;0;D2/B2)
ООО «Вектор» | 420000 | 310000 | =B3-C3 | =IF(B3=0;0;D3/B3)
Итого | =SUM(B2:B3) | =SUM(C2:C3) | =SUM(D2:D3) | =IF(B4=0;0;D4/B4)

CELLS:
A6 = Средняя маржа
B6 = =AVERAGE(E2:E3)

FORMAT: B2:D4 = #,##0" ₽"
FORMAT: E2:E4 = 0.0%
===EXCEL EDIT END===

Правила блока правки:
- SHEET: точное имя листа. Если листа с таким именем нет — он будет создан, так и напиши в ответе.
- ROWS: <адрес> — целая таблица одним куском: строки идут подряд от этого адреса, столбцы разделяются
  символом "|". Пустая строка заканчивает таблицу. Пустая ячейка между "|" оставляет ячейку как была.
- CELLS: — отдельные ячейки, по одной в строке, в виде "B7 = значение".
- FORMAT: <ячейка или диапазон> = <формат числа> — необязательно. Коды пиши стандартные, как в файле xlsx:
  #,##0" ₽" для рублей, 0.0% для процентов, DD.MM.YYYY для дат (Excel сам покажет их по-русски).
- Можно указать несколько блоков SHEET: в одной правке — например, данные на одном листе, свод на другом.
- Формулы пиши с ведущим "=", как в Excel; обычные значения — без него. Разделитель аргументов — ";".
- Результаты формул вручную писать не нужно: после применения книга пересчитывается целиком.
- Никогда не применяй правку сам — приложение всегда спросит подтверждение у пользователя.
- Строй таблицы формулами, а не посчитанными числами: итоги через SUM/SUMIFS, доли и проценты — формулой,
  чтобы таблица продолжала считаться сама, когда данные поменяются.
- Если данных не хватает — сначала уточни у пользователя или прочитай нужный кусок листа через READ.
- Отвечай по-русски.

=== СОДЕРЖИМОЕ КНИГИ ===`;

function buildAgentPrompt(model) {
  const where = model.filePath ? `Файл: ${model.name}` : `Новая книга: ${model.name} (ещё не сохранена на диск)`;
  const sheetList = model.sheets.map((s) => s.name).join(", ");
  return `${AGENT_PROMPT_HEADER}\n${where}\nЛисты: ${sheetList}\n\n${toAgentText(model)}`;
}

// ---------- agent edits ----------

function truthyFlag(text) {
  const v = String(text || "").trim().toLowerCase();
  return v !== "" && !["нет", "no", "false", "0", "-"].includes(v);
}

/**
 * Parses the agent's proposed edit block into a list of per-sheet changes.
 *
 * Three ways of naming cells are accepted, because they suit different jobs: a
 * ROWS: table for laying out a whole grid at once (what "build me a table" needs),
 * CELLS: lines for touching individual cells, and FORMAT: lines for number formats.
 * A single block may carry several SHEET: sections, so one proposal can create a
 * data sheet and a summary sheet together.
 */
function parseAgentEdit(text) {
  const match = /===EXCEL EDIT START===([\s\S]*?)===EXCEL EDIT END===/.exec(text || "");
  if (!match) return null;

  const sheets = [];
  let current = null;
  let mode = null; // "cells" | "rows"
  let anchor = null;
  let rowOffset = 0;

  const pushCell = (cell, value) => {
    if (!current) return;
    const existing = current.cells.findIndex((c) => c.cell === cell);
    if (existing >= 0) current.cells[existing] = { cell, value };
    else current.cells.push({ cell, value });
  };

  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    const sheetMatch = /^SHEET:\s*(.+)$/i.exec(trimmed);
    if (sheetMatch) {
      current = { sheet: sheetMatch[1].trim(), cells: [], formats: [] };
      sheets.push(current);
      mode = null;
      continue;
    }
    if (!current) continue;

    const newMatch = /^NEW(?:\s+SHEET)?:\s*(.*)$/i.exec(trimmed);
    if (newMatch) {
      // Tolerated for compatibility with how the model may phrase it; a missing
      // sheet is created either way, and the confirmation UI says so.
      current.createIfMissing = truthyFlag(newMatch[1]);
      continue;
    }
    if (/^CELLS:\s*$/i.test(trimmed)) {
      mode = "cells";
      continue;
    }
    const rowsMatch = /^ROWS:\s*([A-Za-z]+\d+)\s*$/i.exec(trimmed);
    if (rowsMatch) {
      mode = "rows";
      anchor = parseCellKey(rowsMatch[1]);
      rowOffset = 0;
      continue;
    }
    const formatMatch = /^FORMAT:\s*([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)\s*=\s*(.+)$/i.exec(trimmed);
    if (formatMatch) {
      current.formats.push({ range: formatMatch[1].toUpperCase(), numFmt: formatMatch[2].trim() });
      continue;
    }

    if (mode === "rows") {
      if (trimmed === "") {
        mode = null;
        continue;
      }
      if (!anchor) continue;
      const parts = line.split("|");
      parts.forEach((part, i) => {
        const value = part.trim();
        if (value === "") return; // leave that cell as it is
        pushCell(cellKey(anchor.row + rowOffset, anchor.col + i), value);
      });
      rowOffset++;
      continue;
    }

    // Individual cells are accepted whether or not a CELLS: header preceded them —
    // the address makes the intent unambiguous.
    const cellMatch = /^([A-Za-z]+\d+)\s*=\s*(.*)$/.exec(trimmed);
    if (cellMatch && (mode === "cells" || mode === null)) {
      pushCell(cellMatch[1].toUpperCase(), cellMatch[2].trim());
    }
  }

  const filled = sheets.filter((s) => s.cells.length || s.formats.length);
  return filled.length ? { sheets: filled } : null;
}

/** Adds an empty sheet to the model. */
function addSheet(model, name) {
  const clean = String(name || "").trim() || `Лист${model.sheets.length + 1}`;
  const existing = model.sheets.find((s) => s.name === clean);
  if (existing) return existing;
  const sheet = { name: clean, cells: {}, maxRow: 0, maxCol: 0, merges: [] };
  model.sheets.push(sheet);
  return sheet;
}

function expandRange(range) {
  const [fromRef, toRef] = String(range).split(":");
  const from = parseCellKey(fromRef);
  const to = toRef ? parseCellKey(toRef) : from;
  if (!from || !to) return [];
  const keys = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
      keys.push(cellKey(r, c));
    }
  }
  return keys;
}

/** Sets a number format on a cell that may not carry a value yet. */
function setNumFmt(model, sheetName, key, numFmt) {
  const sheet = model.sheets.find((s) => s.name === sheetName);
  if (!sheet) return;
  const pos = parseCellKey(key);
  if (!pos) return;
  const cell = sheet.cells[key];
  // A format on an empty cell would otherwise create a phantom entry that saves as
  // a blank; only style cells that actually hold something.
  if (!cell) return;
  cell.numFmt = numFmt;
}

/**
 * Applies a parsed agent edit: creates any sheet that doesn't exist yet, writes the
 * cells, then applies number formats. Returns what was created, so the UI can say so.
 */
function applyAgentEdit(model, edit) {
  const createdSheets = [];
  for (const segment of edit?.sheets || []) {
    if (!model.sheets.some((s) => s.name === segment.sheet)) {
      addSheet(model, segment.sheet);
      createdSheets.push(segment.sheet);
    }
    for (const { cell, value } of segment.cells) setCell(model, segment.sheet, cell, value);
    for (const { range, numFmt } of segment.formats || []) {
      for (const key of expandRange(range)) setNumFmt(model, segment.sheet, key, numFmt);
    }
  }
  // Drop the starter sheet if the agent built its tables elsewhere.
  if (model.sheets.length > 1) {
    model.sheets = model.sheets.filter((s) => !(s.placeholder && Object.keys(s.cells).length === 0));
  }
  return { createdSheets };
}

// ---------- read-only agent tools ----------

/**
 * Evaluates a formula against the live workbook without changing anything.
 * This is what lets the agent actually *check* a number before proposing a table,
 * instead of doing arithmetic in its head over a truncated text dump.
 */
function evaluateFormula(model, formula, sheetName) {
  const parser = makeParser(model);
  const sheet = sheetName && model.sheets.some((s) => s.name === sheetName) ? sheetName : model.sheets[0]?.name;
  const text = normalizeSeparators(String(formula || "").trim().replace(/^=/, ""));
  try {
    const result = parser.parse(text, { sheet, row: 1, col: 1 });
    if (result instanceof FormulaError) return result.toString();
    return result === undefined || result === null ? "" : result;
  } catch (e) {
    return formulaErrorToText(e);
  }
}

/** Dumps a range as text lines, for when the sheet in the prompt was truncated. */
function readRange(model, ref) {
  const m = /^(?:(.+)!)?([A-Za-z]+\d+(?::[A-Za-z]+\d+)?)$/.exec(String(ref || "").trim());
  if (!m) return `Не понял адрес: ${ref}`;
  const sheetName = (m[1] || model.sheets[0]?.name || "").replace(/^'|'$/g, "");
  const sheet = model.sheets.find((s) => s.name === sheetName);
  if (!sheet) return `Лист "${sheetName}" не найден.`;
  const [fromRef, toRef] = m[2].split(":");
  const from = parseCellKey(fromRef);
  const to = toRef ? parseCellKey(toRef) : from;
  if (!from || !to) return `Не понял адрес: ${ref}`;
  const lines = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
    const parts = [];
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
      const key = cellKey(r, c);
      const cell = sheet.cells[key];
      if (!cell) continue;
      const shown = cell.formula ? `=${cell.formula} → ${cell.computed ?? ""}` : cell.value;
      if (shown === null || shown === undefined || shown === "") continue;
      parts.push(`${key}: ${shown}`);
    }
    if (parts.length) lines.push(parts.join(" | "));
  }
  return lines.length ? `${sheetName}!${m[2]}:\n${lines.join("\n")}` : `${sheetName}!${m[2]}: диапазон пуст.`;
}

/**
 * Runs the read-only tool block from an assistant reply, if there is one.
 * Returns text to feed back to the model, or null when the reply asked for nothing.
 * Errors come back as text rather than exceptions — a bad formula should let the
 * agent correct itself, not break the conversation.
 */
function runAgentTools(model, text) {
  const match = /===EXCEL TOOL===([\s\S]*?)===EXCEL TOOL END===/.exec(text || "");
  if (!match) return null;
  const block = match[1];
  const sheetName = /^\s*SHEET:\s*(.+)$/im.exec(block)?.[1]?.trim();

  const calc = /^\s*CALC:\s*(.+)$/im.exec(block)?.[1]?.trim();
  if (calc) {
    const result = evaluateFormula(model, calc, sheetName);
    return `Результат вычисления по книге:\n${calc} → ${result}\n\nПродолжай: ответь пользователю или предложи правку.`;
  }

  const read = /^\s*READ:\s*(.+)$/im.exec(block)?.[1]?.trim();
  if (read) {
    return `Содержимое диапазона:\n${readRange(model, read)}\n\nПродолжай: ответь пользователю или предложи правку.`;
  }

  return "В блоке ===EXCEL TOOL=== не нашлось ни CALC:, ни READ:. Проверь формат и повтори.";
}

/** A brand-new empty workbook, living only in memory until it's saved somewhere. */
function createWorkbook(name) {
  const clean = String(name || "").trim() || "Новая книга.xlsx";
  return {
    filePath: null,
    name: clean.toLowerCase().endsWith(".xlsx") ? clean : `${clean}.xlsx`,
    // "placeholder" marks the starter sheet: if the agent builds its own named
    // sheets instead of filling this one, an empty "Лист1" shouldn't be left behind.
    sheets: [{ name: "Лист1", cells: {}, maxRow: 0, maxCol: 0, merges: [], placeholder: true }],
  };
}

module.exports = {
  loadWorkbook,
  normalizeSeparators,
  createWorkbook,
  saveWorkbook,
  recalculate,
  setCell,
  addSheet,
  setNumFmt,
  applyAgentEdit,
  evaluateFormula,
  readRange,
  runAgentTools,
  buildAgentPrompt,
  parseAgentEdit,
  toAgentText,
  colToLetters,
  lettersToCol,
  cellKey,
  parseCellKey,
};
