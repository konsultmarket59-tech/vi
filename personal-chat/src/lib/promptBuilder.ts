export interface ParsedSkillDraft {
  name: string;
  description: string;
  content: string;
}

export function parseSkillDraft(text: string): ParsedSkillDraft | null {
  const match = text.match(/===SKILL START===([\s\S]*?)===SKILL END===/);
  if (!match) return null;
  const block = match[1];
  const nameMatch = block.match(/NAME:\s*(.+)/);
  const descMatch = block.match(/DESCRIPTION:\s*(.+)/);
  const contentMatch = block.match(/CONTENT:\s*([\s\S]*)/);
  if (!nameMatch || !contentMatch) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1]?.trim() ?? "",
    content: contentMatch[1].trim(),
  };
}

export function uid(): string {
  return crypto.randomUUID();
}


export interface ParsedMediaRequest {
  type: "image" | "video" | "audio";
  model: string;
  prompt: string;
}

export function parseMediaRequest(text: string): ParsedMediaRequest | null {
  const match = text.match(/===MEDIA GENERATE START===([\s\S]*?)===MEDIA GENERATE END===/);
  if (!match) return null;
  const block = match[1];
  const type = block.match(/TYPE:\s*(image|video|audio)/)?.[1] as ParsedMediaRequest["type"] | undefined;
  const model = block.match(/MODEL:\s*(.+)/)?.[1]?.trim();
  const prompt = block.match(/PROMPT:\s*([\s\S]*?)(?:\n===|$)/)?.[1]?.trim();
  if (!type || !model || !prompt) return null;
  return { type, model, prompt };
}

export const MEDIA_SYNTAX_HINT = `Если пользователь просит сгенерировать изображение, видео или аудио — предложи это строго в формате
(приложение распознает и покажет кнопку «Сгенерировать», сам ты медиа не создаёшь):

===MEDIA GENERATE START===
TYPE: image | video | audio
MODEL: <точный id модели из каталога polza.ai/models, например "seedream-3" для изображений или "google/veo3" для видео>
PROMPT: <промпт для генерации на английском или русском, максимально подробный>
===MEDIA GENERATE END===

Если пользователь не назвал модель — предложи разумную по умолчанию для нужного типа медиа и уточни, что её можно
сменить в настройках.`;

export interface ParsedFileEdit {
  path: string;
  content: string;
}

export function parseFileEdit(text: string): ParsedFileEdit | null {
  const match = text.match(/===FILE EDIT START===([\s\S]*?)===FILE EDIT END===/);
  if (!match) return null;
  const block = match[1];
  const path = block.match(/PATH:\s*(.+)/)?.[1]?.trim();
  const contentMatch = block.match(/CONTENT:\s*([\s\S]*)/);
  if (!path || !contentMatch) return null;
  return { path, content: contentMatch[1].trim() };
}

export const FILE_EDIT_SYNTAX_HINT = `Когда нужно создать или изменить файл в репозитории, предложи это строго в формате (приложение распознает
и покажет кнопку «Применить и закоммитить» — сам ты ничего не коммитишь):

===FILE EDIT START===
PATH: <путь файла относительно корня репозитория, например src/App.tsx>
CONTENT:
<ПОЛНОЕ новое содержимое файла целиком, не диф и не фрагмент>
===FILE EDIT END===

Если для правки нужно увидеть содержимое файла, которого нет среди прикреплённых — попроси пользователя прикрепить
его через список файлов слева (отметить галочкой), не изобретай содержимое. Можно предложить только одну правку за
раз — если изменений несколько, предлагай по очереди в отдельных ответах.`;

export interface ParsedExcelEditSegment {
  sheet: string;
  cells: { cell: string; value: string }[];
  formats: { range: string; numFmt: string }[];
}

export interface ParsedExcelEdit {
  sheets: ParsedExcelEditSegment[];
}

function excelCellKey(row: number, col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return `${s}${row}`;
}

function parseExcelCellKey(key: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(key.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: parseInt(m[2], 10) };
}

/**
 * Mirrors parseAgentEdit in electron/excel.cjs — the block the Excel agent emits.
 *
 * It has to live on both sides: the main process applies the edit, but the chat
 * window needs to recognise a proposal the moment it arrives to show the
 * confirmation banner, without a round trip.
 */
export function parseExcelEdit(text: string): ParsedExcelEdit | null {
  const match = /===EXCEL EDIT START===([\s\S]*?)===EXCEL EDIT END===/.exec(text || "");
  if (!match) return null;

  const sheets: ParsedExcelEditSegment[] = [];
  let current: ParsedExcelEditSegment | null = null;
  let mode: "cells" | "rows" | null = null;
  let anchor: { row: number; col: number } | null = null;
  let rowOffset = 0;

  const pushCell = (cell: string, value: string) => {
    if (!current) return;
    const at = current.cells.findIndex((c) => c.cell === cell);
    if (at >= 0) current.cells[at] = { cell, value };
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

    if (/^NEW(?:\s+SHEET)?:/i.test(trimmed)) continue;
    if (/^CELLS:\s*$/i.test(trimmed)) {
      mode = "cells";
      continue;
    }
    const rowsMatch = /^ROWS:\s*([A-Za-z]+\d+)\s*$/i.exec(trimmed);
    if (rowsMatch) {
      mode = "rows";
      anchor = parseExcelCellKey(rowsMatch[1]);
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
      line.split("|").forEach((part, i) => {
        const value = part.trim();
        if (value === "" || !anchor) return;
        pushCell(excelCellKey(anchor.row + rowOffset, anchor.col + i), value);
      });
      rowOffset++;
      continue;
    }

    const cellMatch = /^([A-Za-z]+\d+)\s*=\s*(.*)$/.exec(trimmed);
    if (cellMatch && (mode === "cells" || mode === null)) {
      pushCell(cellMatch[1].toUpperCase(), cellMatch[2].trim());
    }
  }

  const filled = sheets.filter((s) => s.cells.length || s.formats.length);
  return filled.length ? { sheets: filled } : null;
}


/** Mirrors parseAgentAction in electron/direct.cjs — the block the Direct agent emits. */
export function parseDirectAction(text: string): ParsedDirectAction | null {
  const match = /===DIRECT ACTION START===([\s\S]*?)===DIRECT ACTION END===/.exec(text || "");
  if (!match) return null;
  const block = match[1];
  const action = /ACTION:\s*(\w+)/i.exec(block)?.[1]?.toLowerCase();
  const target = /TARGET:\s*(\d+)/i.exec(block)?.[1];
  const value = /VALUE:\s*([\d.,]+)/i.exec(block)?.[1];
  const why = /WHY:\s*(.+)/i.exec(block)?.[1]?.trim() || "";
  if (!action || !target) return null;
  if (action !== "suspend" && action !== "resume" && action !== "bid") return null;
  if (action === "bid" && !value) return null;
  return {
    action,
    target: Number(target),
    value: value ? Number(value.replace(",", ".")) : undefined,
    why,
  };
}

export interface ParsedDirectAction {
  action: "suspend" | "resume" | "bid";
  target: number;
  value?: number;
  why: string;
}


export interface ParsedWordEdit {
  ops: (
    | { op: "set"; index: number; text: string }
    | { op: "insert"; index: number; text: string; style: string }
    | { op: "delete"; index: number }
  )[];
}

/** Mirrors parseAgentEdit in electron/word.cjs — the block the Word agent emits. */
export function parseWordEdit(text: string): ParsedWordEdit | null {
  const match = /===WORD EDIT START===([\s\S]*?)===WORD EDIT END===/.exec(text || "");
  if (!match) return null;
  const ops: ParsedWordEdit["ops"] = [];
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const set = /^SET\s+(\d+)\s*:\s*([\s\S]*)$/i.exec(line);
    if (set) {
      ops.push({ op: "set", index: Number(set[1]), text: set[2].trim() });
      continue;
    }
    const insert = /^INSERT\s+AFTER\s+(-?\d+)\s*(?:\[([^\]]+)\])?\s*:\s*([\s\S]*)$/i.exec(line);
    if (insert) {
      ops.push({ op: "insert", index: Number(insert[1]), style: (insert[2] || "").trim(), text: insert[3].trim() });
      continue;
    }
    const del = /^DELETE\s+(\d+)$/i.exec(line);
    if (del) ops.push({ op: "delete", index: Number(del[1]) });
  }
  return ops.length ? { ops } : null;
}
