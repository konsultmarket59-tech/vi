// Exporting chat results to Word (.docx) and Excel (.xlsx).
//
// PDF and PNG go through a hidden browser window: they're pictures of rendered
// HTML, fine for sending someone a finished page but useless for editing. Word and
// Excel need the opposite — real document structure — so this module doesn't touch
// HTML at all. It reads the assistant's markdown with `marked`'s lexer and rebuilds
// it as native Word paragraphs/tables and native spreadsheet cells, so a content
// plan lands in Excel as an editable table rather than a screenshot of one.

const fs = require("node:fs/promises");

// marked v18 is ESM-only, so it can't be require()d from this CommonJS file.
// One dynamic import, cached, keeps that detail in one place.
let markedPromise = null;
function getMarked() {
  if (!markedPromise) markedPromise = import("marked").then((m) => m.marked);
  return markedPromise;
}

/** Flattens marked's inline tokens into runs carrying their formatting. */
function inlineRuns(tokens, inherited = {}) {
  const runs = [];
  for (const token of tokens || []) {
    switch (token.type) {
      case "strong":
        runs.push(...inlineRuns(token.tokens, { ...inherited, bold: true }));
        break;
      case "em":
        runs.push(...inlineRuns(token.tokens, { ...inherited, italics: true }));
        break;
      case "del":
        runs.push(...inlineRuns(token.tokens, { ...inherited, strike: true }));
        break;
      case "codespan":
        runs.push({ ...inherited, text: token.text, code: true });
        break;
      case "link":
        // The URL is kept visible: an exported document is often printed or
        // forwarded, where a hidden hyperlink is simply lost.
        runs.push(...inlineRuns(token.tokens, { ...inherited, link: token.href }));
        break;
      case "br":
        runs.push({ ...inherited, text: "\n" });
        break;
      case "image":
        runs.push({ ...inherited, text: token.text ? `[${token.text}]` : "[изображение]" });
        break;
      default:
        if (token.tokens) runs.push(...inlineRuns(token.tokens, inherited));
        else if (token.text != null) runs.push({ ...inherited, text: token.text });
    }
  }
  return runs;
}

/** Plain text of a run list. Links keep their URL, which a cell can't show. */
function runsToText(runs, withLinks = false) {
  return (runs || []).map((r) => (withLinks && r.link ? `${r.text} (${r.link})` : r.text)).join("");
}

function cellText(cell) {
  return runsToText(inlineRuns(cell.tokens)).trim();
}

/**
 * Turns one message's markdown into a flat list of blocks:
 * {kind:"heading"|"paragraph"|"listItem"|"code"|"table"|"rule"}.
 */
async function parseBlocks(markdown) {
  const marked = await getMarked();
  const blocks = [];

  const walk = (tokens, listDepth = 0) => {
    for (const token of tokens || []) {
      switch (token.type) {
        case "heading":
          blocks.push({ kind: "heading", level: token.depth, runs: inlineRuns(token.tokens) });
          break;
        case "paragraph":
          blocks.push({ kind: "paragraph", runs: inlineRuns(token.tokens) });
          break;
        case "text":
          if (token.tokens) blocks.push({ kind: "paragraph", runs: inlineRuns(token.tokens) });
          else if (token.text?.trim()) blocks.push({ kind: "paragraph", runs: [{ text: token.text }] });
          break;
        case "blockquote":
          walk(token.tokens, listDepth);
          break;
        case "list":
          token.items.forEach((item, i) => {
            const marker = token.ordered ? `${(token.start || 1) + i}. ` : "• ";
            // A list item's own paragraph becomes the bullet line; anything nested
            // under it (sub-lists, extra paragraphs) is walked one level deeper.
            const [first, ...rest] = item.tokens || [];
            const firstRuns = first ? inlineRuns(first.tokens || [{ text: first.text ?? "" }]) : [];
            blocks.push({ kind: "listItem", depth: listDepth, marker, runs: firstRuns });
            if (rest.length) walk(rest, listDepth + 1);
          });
          break;
        case "code":
          blocks.push({ kind: "code", text: token.text });
          break;
        case "table":
          blocks.push({
            kind: "table",
            header: token.header.map(cellText),
            rows: token.rows.map((row) => row.map(cellText)),
          });
          break;
        case "hr":
          blocks.push({ kind: "rule" });
          break;
        case "space":
          break;
        default:
          if (token.tokens) walk(token.tokens, listDepth);
      }
    }
  };

  walk(marked.lexer(markdown || ""));
  return blocks;
}

// ---------- Word ----------

const ROLE_LABEL = { user: "Вы", assistant: "Ассистент" };

function normalizeHex(color, fallback) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color || ""));
  return m ? m[1].toUpperCase() : fallback;
}

/**
 * Darkens the brand accent until it is readable — both as text on white and, since
 * contrast is symmetric, as a fill under white text.
 *
 * A brand accent is picked to look good as a fill, not to be read: the agency's
 * #FF2F6D gives 3.6:1, so a table header in white-on-pink and a 10pt role label in
 * pink both fail. These documents are also printed and photocopied, where a light
 * colour fades further. Applies to any accent the user sets, not just this one.
 */
function readableAccent(hex) {
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const contrastOnWhite = () => {
    const channel = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 1.05 / (0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) + 0.05);
  };
  for (let i = 0; i < 40 && contrastOnWhite() < 4.5; i++) {
    r = Math.round(r * 0.94);
    g = Math.round(g * 0.94);
    b = Math.round(b * 0.94);
  }
  return [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function buildDocx({ title, sections, brand }) {
  const docx = require("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle } = docx;
  const accent = readableAccent(normalizeHex(brand?.accentColor, "FF2F6D"));

  const runsToTextRuns = (runs, base = {}) =>
    (runs.length ? runs : [{ text: "" }]).map(
      (r) =>
        new TextRun({
          ...base,
          text: r.link ? `${r.text} (${r.link})` : r.text,
          bold: r.bold || base.bold,
          italics: r.italics || base.italics,
          strike: r.strike,
          font: r.code ? "Consolas" : base.font,
        })
    );

  const HEADING_BY_LEVEL = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];

  const children = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 36, color: accent })],
      spacing: { after: 240 },
    }),
  ];

  for (const section of sections) {
    if (section.role && sections.length > 1) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: ROLE_LABEL[section.role] || section.role, bold: true, color: accent, size: 20 })],
          spacing: { before: 240, after: 80 },
        })
      );
    }
    for (const block of await parseBlocks(section.content)) {
      switch (block.kind) {
        case "heading":
          children.push(
            new Paragraph({
              heading: HEADING_BY_LEVEL[Math.min(block.level, 6) - 1],
              children: runsToTextRuns(block.runs),
              spacing: { before: 200, after: 80 },
            })
          );
          break;
        case "listItem":
          children.push(
            new Paragraph({
              children: [new TextRun({ text: block.marker }), ...runsToTextRuns(block.runs)],
              indent: { left: 360 + block.depth * 360 },
              spacing: { after: 60 },
            })
          );
          break;
        case "code":
          // Word has no code block, so the monospace font plus a shaded box is what
          // keeps a snippet readable and visually separate from prose.
          children.push(
            new Paragraph({
              children: block.text.split("\n").flatMap((line, i) => [
                ...(i ? [new TextRun({ break: 1 })] : []),
                new TextRun({ text: line, font: "Consolas", size: 18 }),
              ]),
              shading: { fill: "F4F1EC" },
              spacing: { before: 120, after: 120 },
            })
          );
          break;
        case "table": {
          const headerRow = new TableRow({
            tableHeader: true,
            children: block.header.map(
              (text) =>
                new TableCell({
                  shading: { fill: accent },
                  children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF" })] })],
                })
            ),
          });
          const bodyRows = block.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text })] })] })
                ),
              })
          );
          children.push(
            new Table({ rows: [headerRow, ...bodyRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
            new Paragraph({ text: "", spacing: { after: 160 } })
          );
          break;
        }
        case "rule":
          children.push(
            new Paragraph({
              text: "",
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "DDD5C8" } },
              spacing: { before: 120, after: 120 },
            })
          );
          break;
        default:
          children.push(new Paragraph({ children: runsToTextRuns(block.runs), spacing: { after: 120 } }));
      }
    }
  }

  if (brand?.contactLines?.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: brand.contactLines.join(" · "), size: 18, color: "6B6157" })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 360 },
      })
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ---------- Excel ----------

/** Excel sheet names: 31 chars max, and []:*?/\ are rejected outright. */
function sheetName(raw, used) {
  let base = String(raw || "Лист").replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Лист";
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} ${n++}`.slice(0, 31);
  used.add(name);
  return name;
}

/**
 * Numbers written as text can't be summed, and a budget table exported to Excel is
 * exported precisely so it can be summed. Only unambiguous numbers are converted:
 * digits with optional sign, space/NBSP thousand separators and one decimal mark.
 * Anything carrying a unit ("45 000 ₽", "40%") stays text, where its meaning is safe.
 */
function coerceNumber(text) {
  const raw = String(text ?? "").trim();
  if (!/^-?\d[\d \u00a0]*([.,]\d+)?$/.test(raw)) return text;
  const n = Number(raw.replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : text;
}

function autoFitColumns(worksheet) {
  worksheet.columns.forEach((column) => {
    let longest = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const lines = String(cell.value ?? "").split("\n");
      for (const line of lines) longest = Math.max(longest, line.length);
    });
    // Long prose would otherwise produce a column wider than the screen.
    column.width = Math.min(longest + 2, 60);
  });
}

function styleHeaderRow(row, accentHex) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + accentHex } };
  row.alignment = { vertical: "middle", wrapText: true };
}

/**
 * Builds a workbook from the exported chat.
 *
 * Every markdown table becomes its own sheet of real cells — that is the whole
 * point of exporting to Excel, since these are usually content plans and budgets
 * that the user then edits. Text that isn't a table goes to a "Текст" sheet so
 * nothing from the answer is silently dropped.
 */
async function buildXlsx({ title, sections, brand }) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const accent = readableAccent(normalizeHex(brand?.accentColor, "FF2F6D"));
  const used = new Set();

  const textRows = [];
  let tableCount = 0;
  let lastHeading = "";

  for (const section of sections) {
    const role = section.role ? ROLE_LABEL[section.role] || section.role : "";
    for (const block of await parseBlocks(section.content)) {
      if (block.kind === "table") {
        tableCount++;
        const sheet = workbook.addWorksheet(sheetName(lastHeading || `Таблица ${tableCount}`, used));
        sheet.addRow(block.header);
        for (const row of block.rows) sheet.addRow(row.map(coerceNumber));
        styleHeaderRow(sheet.getRow(1), accent);
        sheet.views = [{ state: "frozen", ySplit: 1 }];
        autoFitColumns(sheet);
        continue;
      }
      if (block.kind === "heading") {
        lastHeading = runsToText(block.runs).trim();
        textRows.push([role, lastHeading]);
        continue;
      }
      if (block.kind === "rule") continue; // a horizontal rule has no cell equivalent
      const text = block.kind === "code" ? block.text : (block.marker || "") + runsToText(block.runs, true);
      if (text.trim()) textRows.push([role, text]);
    }
  }

  if (textRows.length) {
    const sheet = workbook.addWorksheet(sheetName("Текст", used));
    sheet.addRow(["Роль", "Текст"]);
    for (const row of textRows) sheet.addRow(row);
    styleHeaderRow(sheet.getRow(1), accent);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getColumn(1).width = 12;
    sheet.getColumn(2).width = 90;
    sheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  }

  // A workbook with no sheets at all is an invalid file, not an empty one.
  if (workbook.worksheets.length === 0) {
    const sheet = workbook.addWorksheet("Текст");
    sheet.addRow([title]);
  }

  return workbook.xlsx.writeBuffer();
}

async function writeBuffer(filePath, buffer) {
  await fs.writeFile(filePath, Buffer.from(buffer));
  return filePath;
}

module.exports = { buildDocx, buildXlsx, writeBuffer, parseBlocks };
