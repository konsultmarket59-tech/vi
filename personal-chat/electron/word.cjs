// Живые документы Word: открыть .docx с компьютера, править текст и сохранить обратно.
//
// Ключевое решение — почему тут разбор OOXML, а не «прочитать текст и собрать заново».
// .docx это zip, внутри которого word/document.xml. Если пересобирать документ
// библиотекой-генератором, теряется всё, чего нет в нашей модели: стили, колонтитулы,
// картинки, нумерация, поля, комментарии. Поэтому здесь документ не пересобирается: мы
// находим точные границы каждого абзаца в исходном XML и заменяем только их. Всё
// остальное — включая части, которые приложение вообще не понимает — остаётся байт в
// байт как было.

const fs = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

const DOC_PART = "word/document.xml";

function decodeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function encodeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Границы дочерних элементов <w:body> в исходном XML.
 *
 * Сканер, а не регулярка: таблица содержит абзацы, а абзац — вложенные теги, и
 * «найти <w:p>…</w:p>» регуляркой на первом же вложении даёт неверные границы.
 * Возвращает [{tag, start, end}] — точные позиции в строке.
 */
function scanBody(xml) {
  const bodyStart = xml.indexOf("<w:body>");
  if (bodyStart === -1) return { bodyStart: -1, bodyEnd: -1, nodes: [] };
  const contentStart = bodyStart + "<w:body>".length;
  const bodyEnd = xml.lastIndexOf("</w:body>");

  const nodes = [];
  let i = contentStart;
  while (i < bodyEnd) {
    // Имя тега должно совпадать целиком: <w:pPr> и <w:pStyle> тоже начинаются с
    // "<w:p", и поиск по префиксу считал бы их вложенными абзацами — из-за этого
    // весь документ выглядел одним огромным абзацем.
    const match = /<(w:p|w:tbl)(?=[\s/>])([^>]*)>/g;
    match.lastIndex = i;
    const found = match.exec(xml);
    if (!found || found.index >= bodyEnd) break;

    const tag = found[1];
    const openStart = found.index;
    const openEnd = found.index + found[0].length;

    if (found[0].endsWith("/>")) {
      nodes.push({ tag, start: openStart, end: openEnd });
      i = openEnd;
      continue;
    }

    const nested = new RegExp(`<${tag}(?=[\\s/>])[^>]*>|</${tag}>`, "g");
    nested.lastIndex = openEnd;
    let depth = 1;
    let cursor = openEnd;
    let step;
    while (depth > 0 && (step = nested.exec(xml))) {
      if (step[0].startsWith("</")) depth--;
      else if (!step[0].endsWith("/>")) depth++;
      cursor = step.index + step[0].length;
    }
    nodes.push({ tag, start: openStart, end: cursor });
    i = cursor;
  }
  return { bodyStart: contentStart, bodyEnd, nodes };
}

/** Видимый текст элемента: <w:t> плюс переводы строк и табуляции. */
function textOf(xmlFragment) {
  let out = "";
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/?>|<w:tab\s*\/?>/g;
  let m;
  while ((m = re.exec(xmlFragment))) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith("<w:br")) out += "\n";
    else out += "\t";
  }
  return out;
}

function styleOf(paragraphXml) {
  return /<w:pStyle\s+w:val="([^"]+)"/.exec(paragraphXml)?.[1] || "";
}

/** Уровень заголовка из имени стиля Word (Heading1, "Заголовок 1", …). */
function headingLevel(style) {
  const m = /^(?:heading|Heading|Заголовок\s*)(\d)/.exec(style) || /(\d)$/.exec(style.startsWith("Heading") ? style : "");
  return m ? Number(m[1]) : 0;
}

/** Ячейки таблицы построчно. */
function parseTable(tableXml) {
  const rows = [];
  const rowRe = /<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableXml))) {
    const cells = [];
    const cellRe = /<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(textOf(cellMatch[1]).trim());
    rows.push(cells);
  }
  return rows;
}

/** Открывает документ в модель блоков; исходный XML сохраняется для записи обратно. */
async function loadDocument(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const part = zip.file(DOC_PART);
  if (!part) throw new Error("Это не похоже на документ Word: внутри нет word/document.xml.");
  const xml = await part.async("string");
  const { nodes } = scanBody(xml);

  const blocks = nodes.map((node, index) => {
    const fragment = xml.slice(node.start, node.end);
    if (node.tag === "w:tbl") {
      return { index, kind: "table", text: "", style: "", level: 0, rows: parseTable(fragment) };
    }
    const style = styleOf(fragment);
    return {
      index,
      kind: /<w:numPr[\s>]/.test(fragment) ? "list" : "paragraph",
      text: textOf(fragment),
      style,
      level: headingLevel(style),
      rows: [],
    };
  });

  return { filePath, name: path.basename(filePath), xml, blocks, zip };
}

/** Модель без непередаваемых частей — то, что уходит в интерфейс. */
function documentPayload(model) {
  return {
    filePath: model.filePath,
    name: model.name,
    blocks: model.blocks.map(({ index, kind, text, style, level, rows }) => ({ index, kind, text, style, level, rows })),
  };
}

function runProperties(paragraphXml) {
  // Свойства первого прогона: ими набирается новый текст, чтобы абзац не потерял
  // начертание. Абзац со смешанным форматированием станет однородным — об этом
  // приложение предупреждает пользователя.
  const firstRun = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/.exec(paragraphXml);
  return /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(firstRun?.[1] || "")?.[0] || "";
}

function paragraphProperties(paragraphXml) {
  return /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(paragraphXml)?.[0] || "";
}

function buildRuns(text, rPr) {
  return String(text)
    .split("\n")
    .map((line, i) => {
      const br = i > 0 ? "<w:br/>" : "";
      return `<w:r>${rPr}${br}<w:t xml:space="preserve">${encodeXml(line)}</w:t></w:r>`;
    })
    .join("");
}

/** Заменяет текст абзаца, сохраняя его стиль и начертание. */
function setBlockText(model, index, text) {
  const { nodes } = scanBody(model.xml);
  const node = nodes[index];
  if (!node) throw new Error(`Абзац №${index + 1} не найден.`);
  if (node.tag !== "w:p") throw new Error("Менять так можно только абзац, не таблицу.");

  const fragment = model.xml.slice(node.start, node.end);
  const openTagEnd = model.xml.indexOf(">", node.start) + 1;
  const openTag = model.xml.slice(node.start, openTagEnd);
  const rebuilt = `${openTag}${paragraphProperties(fragment)}${buildRuns(text, runProperties(fragment))}</w:p>`;
  model.xml = model.xml.slice(0, node.start) + rebuilt + model.xml.slice(node.end);
  return model;
}

/**
 * Вставляет новый абзац после указанного (или в начало, если index < 0).
 * `style` — имя стиля Word: Heading1, Heading2, ListParagraph и т.п.
 */
function insertParagraph(model, afterIndex, text, style) {
  const { bodyStart, nodes } = scanBody(model.xml);
  const previous = afterIndex >= 0 ? nodes[afterIndex] : null;
  const at = previous ? previous.end : bodyStart;

  // Пункт, вставленный в существующий список, должен получить маркер. Стиль
  // ListParagraph сам по себе его не даёт — нумерация живёт в <w:numPr>, поэтому
  // она наследуется от абзаца, после которого вставляем, если тот сам из списка.
  let numPr = "";
  if (previous && previous.tag === "w:p") {
    const fragment = model.xml.slice(previous.start, previous.end);
    numPr = /<w:numPr>[\s\S]*?<\/w:numPr>/.exec(fragment)?.[0] || "";
  }

  const pStyle = style ? `<w:pStyle w:val="${encodeXml(style)}"/>` : "";
  const pPr = pStyle || numPr ? `<w:pPr>${pStyle}${numPr}</w:pPr>` : "";
  const paragraph = `<w:p>${pPr}${buildRuns(text, "")}</w:p>`;
  model.xml = model.xml.slice(0, at) + paragraph + model.xml.slice(at);
  return model;
}

function deleteBlock(model, index) {
  const { nodes } = scanBody(model.xml);
  const node = nodes[index];
  if (!node) throw new Error(`Блок №${index + 1} не найден.`);
  model.xml = model.xml.slice(0, node.start) + model.xml.slice(node.end);
  return model;
}

/** Заново читает модель из текущего XML — после правок. */
function refresh(model) {
  const { nodes } = scanBody(model.xml);
  model.blocks = nodes.map((node, index) => {
    const fragment = model.xml.slice(node.start, node.end);
    if (node.tag === "w:tbl") {
      return { index, kind: "table", text: "", style: "", level: 0, rows: parseTable(fragment) };
    }
    const style = styleOf(fragment);
    return {
      index,
      kind: /<w:numPr[\s>]/.test(fragment) ? "list" : "paragraph",
      text: textOf(fragment),
      style,
      level: headingLevel(style),
      rows: [],
    };
  });
  return model;
}

/** Пишет документ обратно: заменяется только document.xml, остальные части как были. */
async function saveDocument(model, targetPath) {
  const dest = targetPath || model.filePath;
  if (!dest) throw new Error("Для нового документа сначала выберите, куда его сохранить.");
  model.zip.file(DOC_PART, model.xml);
  const buffer = await model.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(dest, buffer);
  return dest;
}

/** Пустой документ — минимальный валидный .docx, который Word откроет. */
async function createDocument(name) {
  const docx = require("docx");
  const doc = new docx.Document({ sections: [{ children: [new docx.Paragraph({ text: "" })] }] });
  const buffer = await docx.Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file(DOC_PART).async("string");
  const clean = String(name || "Новый документ.docx");
  const model = {
    filePath: null,
    name: clean.toLowerCase().endsWith(".docx") ? clean : `${clean}.docx`,
    xml,
    blocks: [],
    zip,
  };
  return refresh(model);
}

// ---------- агент ----------

const MAX_AGENT_CHARS = 40000;

/** Документ в виде текста для контекста агента — с номерами блоков. */
function toAgentText(model) {
  const lines = [];
  for (const block of model.blocks) {
    if (block.kind === "table") {
      lines.push(`[${block.index}] ТАБЛИЦА (${block.rows.length} строк):`);
      for (const row of block.rows.slice(0, 30)) lines.push(`    ${row.join(" | ")}`);
      continue;
    }
    const label = block.level ? `H${block.level}` : block.kind === "list" ? "список" : "абзац";
    lines.push(`[${block.index}] ${label}: ${block.text}`);
  }
  let text = lines.join("\n");
  if (text.length > MAX_AGENT_CHARS) text = text.slice(0, MAX_AGENT_CHARS) + "\n[...документ обрезан по лимиту...]";
  return text;
}

const AGENT_PROMPT_HEADER = `Ты — ассистент по работе с документами Word. Ниже — содержимое открытого документа: каждый
блок пронумерован, указан его тип (H1…H6 — заголовок, абзац, список, таблица) и текст.

Ты можешь отвечать на вопросы по документу, разбирать его и предлагать правки. Чтобы предложить правку,
верни блок строго такого вида — приложение покажет подтверждение, и изменение произойдёт только когда
пользователь его подтвердит:

===WORD EDIT START===
SET 3: новый текст третьего блока
INSERT AFTER 5 [Heading2]: Новый заголовок
INSERT AFTER 5: Обычный новый абзац
DELETE 7
===WORD EDIT END===

Правила:
- Номера блоков — те, что в квадратных скобках ниже. Не путай их с нумерацией страниц.
- SET заменяет текст блока целиком. Стиль и начертание абзаца сохраняются.
- INSERT AFTER вставляет новый абзац после указанного блока; в квадратных скобках можно указать стиль
  Word (Heading1, Heading2, ListParagraph). INSERT AFTER -1 вставляет в самое начало документа.
- DELETE удаляет блок целиком.
- Команд может быть несколько, каждая с новой строки; они применяются сверху вниз.
- Менять текст внутри таблиц пока нельзя — если правка нужна в таблице, скажи об этом словами.
- Никогда не применяй правку сам и не пиши, что уже применил.
- Отвечай по-русски.

=== СОДЕРЖИМОЕ ДОКУМЕНТА ===`;

const ANALYSIS_PROMPT_HEADER = `Ты — аналитик документов. Ниже — содержимое открытого документа Word: каждый блок
пронумерован, указан его тип (H1…H6 — заголовок, абзац, список, таблица) и текст.

В этом режиме ты НИЧЕГО не правишь и не предлагаешь правок — ты разбираешь документ и отвечаешь на
вопрос человека. Что делать хорошо:
- Находить ошибки: противоречия между пунктами, пропущенные условия, размытые формулировки, неверные
  суммы и даты, ссылки на несуществующие пункты и приложения.
- Показывать риски и то, чем они грозят на практике, а не просто называть их.
- Давать выводы и наблюдения, которые из документа не видны с первого чтения.
- Собирать отчёт по документу, если об этом просят.

Правила:
- Ссылайся на номера блоков в квадратных скобках — по ним человек найдёт место в документе.
- Не выдумывай того, чего в документе нет. Если чего-то не хватает для вывода — так и скажи.
- Отвечай по-русски, структурно: заголовки, списки, таблицы — так результат сразу годится в отчёт.

=== СОДЕРЖИМОЕ ДОКУМЕНТА ===`;

/** `mode`: "edit" — можно предлагать правки, "analyze" — только разбор без правок. */
function buildAgentPrompt(model, mode = "edit") {
  const where = model.filePath ? `Файл: ${model.name}` : `Новый документ: ${model.name} (ещё не сохранён)`;
  const header = mode === "analyze" ? ANALYSIS_PROMPT_HEADER : AGENT_PROMPT_HEADER;
  return `${header}\n${where}\n\n${toAgentText(model)}`;
}

/** Разбирает предложенную агентом правку. */
function parseAgentEdit(text) {
  const match = /===WORD EDIT START===([\s\S]*?)===WORD EDIT END===/.exec(text || "");
  if (!match) return null;
  const ops = [];
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

/**
 * Применяет разобранную правку.
 *
 * Порядок важен: вставки и удаления сдвигают нумерацию последующих блоков, поэтому
 * сначала выполняются все SET (они номера не двигают), а вставки и удаления — от
 * конца документа к началу, чтобы каждая следующая операция всё ещё видела те
 * номера, которые пользователь подтверждал.
 */
function applyAgentEdit(model, edit) {
  const ops = edit?.ops || [];
  for (const op of ops.filter((o) => o.op === "set")) setBlockText(model, op.index, op.text);

  const structural = ops.filter((o) => o.op !== "set").sort((a, b) => b.index - a.index);
  for (const op of structural) {
    if (op.op === "delete") deleteBlock(model, op.index);
    else insertParagraph(model, op.index, op.text, op.style);
  }
  return refresh(model);
}

module.exports = {
  loadDocument,
  createDocument,
  saveDocument,
  documentPayload,
  setBlockText,
  insertParagraph,
  deleteBlock,
  refresh,
  buildAgentPrompt,
  parseAgentEdit,
  applyAgentEdit,
  toAgentText,
};
