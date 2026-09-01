// Документооборот: договоры, акты, ТЗ по типовым шаблонам.
//
// Главное отличие от раздела Word: там документ открывают и правят руками, здесь
// документ СОБИРАЕТСЯ по шаблону из справочников, которые лежат на компьютере
// пользователя. Ничего не копируется внутрь приложения — хранятся только пути,
// файлы читаются в момент работы. Поправили реквизиты у себя в папке — следующий
// договор уже с новыми.
//
// Готовый документ получается заполнением ШАБЛОНА, а не генерацией с нуля: агент
// возвращает список правок к блокам шаблона (тот же протокол, что у раздела Word),
// приложение применяет их к исходному .docx и сохраняет копию. Поэтому у результата
// ровно то же форматирование, колонтитулы, печати и поля, что у шаблона — генератор
// документов такого не даёт. Режим юриста — единственное исключение: там шаблона нет
// и документ действительно пишется с нуля.
//
// Модуль намеренно не требует electron: всё, что связано с окнами (PDF через
// печать страницы), приходит колбэком из main.cjs, а значит эту логику можно
// гонять тестами на голом Node.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const word = require("./word.cjs");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

const DOC_KINDS = [
  { id: "contract", name: "Договор", numbered: true, dateRule: "today" },
  { id: "act", name: "Акт", numbered: true, dateRule: "monthEnd" },
  { id: "spec", name: "Техническое задание", numbered: true, dateRule: "monthStart" },
  { id: "invoice", name: "Счёт", numbered: true, dateRule: "today" },
  { id: "reconciliation", name: "Акт сверки", numbered: false, dateRule: "today" },
  { id: "other", name: "Другой документ", numbered: false, dateRule: "today" },
];

function kindById(id) {
  return DOC_KINDS.find((k) => k.id === id) || DOC_KINDS[DOC_KINDS.length - 1];
}

// ---------- справочники (пути, а не копии файлов) ----------

function configFile(root) {
  return path.join(root, "docflow", "config.json");
}

const EMPTY_CONFIG = {
  counterparties: [], // { id, name, requisitesPath }
  templates: [], // { id, name, kind, path }
  sources: [], // { id, name, path } — тарифы, прайсы, прочие исходники
  ledgerPath: "", // документ сверки
  archivePath: "", // папка со всеми договорами/актами/счетами
  outputPath: "", // куда сохранять по умолчанию
};

async function loadConfig(root) {
  try {
    const raw = await fs.readFile(configFile(root), "utf-8");
    const parsed = JSON.parse(raw);
    return { ...EMPTY_CONFIG, ...parsed };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

async function saveConfig(root, config) {
  const file = configFile(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const clean = { ...EMPTY_CONFIG, ...config };
  await fs.writeFile(file, JSON.stringify(clean, null, 2), "utf-8");
  return clean;
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------- чтение исходников ----------

function isImage(filePath) {
  return IMAGE_EXTENSIONS.includes(path.extname(filePath || "").toLowerCase());
}

/**
 * Один исходник для агента. Картинки (скриншоты выгрузок) текстом не читаются —
 * они уходят в модель как изображения, поэтому здесь только помечаются.
 */
async function readReference(filePath, extractText, maxChars = 30000) {
  const name = path.basename(filePath);
  try {
    await fs.stat(filePath);
  } catch {
    return { path: filePath, name, image: false, text: "", error: "файл не найден" };
  }
  if (isImage(filePath)) return { path: filePath, name, image: true, text: "" };
  try {
    const text = await extractText(filePath);
    const trimmed = text.length > maxChars ? text.slice(0, maxChars) + "\n[...обрезано по лимиту...]" : text;
    return { path: filePath, name, image: false, text: trimmed };
  } catch (e) {
    return { path: filePath, name, image: false, text: "", error: e.message };
  }
}

/** Список файлов в папке — чтобы агент видел, что вообще лежит в архиве. */
async function listFolder(folderPath, limit = 200) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile())
    .slice(0, limit)
    .map((e) => e.name);
}

// ---------- документ сверки ----------

const LEDGER_HEADER_HINTS = {
  number: ["номер", "№", "no", "number"],
  date: ["дата", "date"],
  kind: ["тип", "вид", "документ"],
  counterparty: ["контрагент", "заказчик", "клиент", "исполнитель"],
  sum: ["сумма", "стоимость", "итого", "amount"],
};

function matchHeader(cellText) {
  const value = String(cellText || "").trim().toLowerCase();
  if (!value) return "";
  for (const [field, hints] of Object.entries(LEDGER_HEADER_HINTS)) {
    if (hints.some((h) => value === h || value.startsWith(h))) return field;
  }
  return "";
}

/**
 * Читает документ сверки как таблицу. Поддерживаются .xlsx (лист целиком) и .docx
 * (последняя таблица документа). Возвращает и строки, и распознанную шапку — по
 * ней потом дописывается новая строка в те же колонки, а не «в конец как получится».
 */
async function readLedger(filePath) {
  if (!filePath) return { format: "none", rows: [], headerRow: -1, columns: {}, sheetName: "" };
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".xlsx") {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return { format: "xlsx", rows: [], headerRow: -1, columns: {}, sheetName: "" };
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const v = cell.value;
        let text = "";
        if (v == null) text = "";
        else if (typeof v === "object" && v.text) text = v.text;
        else if (typeof v === "object" && v.result != null) text = String(v.result);
        else if (v instanceof Date) text = formatDate(v);
        else text = String(v);
        values[colNumber - 1] = text;
      });
      rows.push({ rowNumber, values });
    });
    const { headerRow, columns } = detectHeader(rows);
    return { format: "xlsx", rows, headerRow, columns, sheetName: sheet.name };
  }

  if (ext === ".docx") {
    const model = await word.loadDocument(filePath);
    const tables = model.blocks.filter((b) => b.kind === "table");
    const table = tables[tables.length - 1];
    const rows = (table?.rows || []).map((values, i) => ({ rowNumber: i + 1, values }));
    const { headerRow, columns } = detectHeader(rows);
    return { format: "docx", rows, headerRow, columns, blockIndex: table?.index ?? -1, sheetName: "" };
  }

  return { format: "unsupported", rows: [], headerRow: -1, columns: {}, sheetName: "" };
}

/** Ищет строку-шапку в первых строках и раскладывает её колонки по смыслу. */
function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const columns = {};
    rows[i].values.forEach((cell, index) => {
      const field = matchHeader(cell);
      if (field && columns[field] === undefined) columns[field] = index;
    });
    if (Object.keys(columns).length >= 2) return { headerRow: i, columns };
  }
  return { headerRow: -1, columns: {} };
}

/**
 * Крайний номер документа нужного вида. Номера бывают «12», «№12», «12/АВ» —
 * берётся ведущее число, потому что именно оно инкрементируется.
 */
function lastNumber(ledger, kindName) {
  const numberCol = ledger.columns?.number;
  if (numberCol === undefined) return 0;
  const kindCol = ledger.columns?.kind;
  const wanted = String(kindName || "").trim().toLowerCase();

  let max = 0;
  for (let i = (ledger.headerRow ?? -1) + 1; i < ledger.rows.length; i++) {
    const row = ledger.rows[i];
    if (wanted && kindCol !== undefined) {
      const rowKind = String(row.values[kindCol] || "").trim().toLowerCase();
      if (rowKind && !rowKind.startsWith(wanted) && !wanted.startsWith(rowKind)) continue;
    }
    const raw = String(row.values[numberCol] || "").trim();
    const num = parseInt(raw.replace(/^№\s*/, ""), 10);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return max;
}

/** Дописывает строку в документ сверки — в те же колонки, что и у остальных строк. */
async function appendLedgerRow(filePath, ledger, row) {
  const ext = path.extname(filePath).toLowerCase();
  const columns = ledger.columns || {};
  const width = Math.max(
    ...Object.values(columns).map((c) => c + 1),
    ...ledger.rows.map((r) => r.values.length),
    1
  );
  const values = new Array(width).fill("");
  const put = (field, value) => {
    if (columns[field] !== undefined && value !== undefined && value !== "") values[columns[field]] = value;
  };
  put("number", row.number);
  put("date", row.date);
  put("kind", row.kind);
  put("counterparty", row.counterparty);
  put("sum", row.sum);

  // Шапку распознать не удалось — не выдумываем структуру, а дописываем всё, что
  // есть, одной строкой по порядку. Пользователь увидит результат и поправит сам.
  const anyMapped = Object.keys(columns).length > 0;
  const finalValues = anyMapped
    ? values
    : [row.number, row.date, row.kind, row.counterparty, row.sum].filter((v) => v !== undefined && v !== "");

  if (ext === ".xlsx") {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("В документе сверки нет ни одного листа.");
    sheet.addRow(finalValues);
    await workbook.xlsx.writeFile(filePath);
    return { format: "xlsx", values: finalValues };
  }

  if (ext === ".docx") {
    await appendDocxTableRow(filePath, finalValues);
    return { format: "docx", values: finalValues };
  }

  throw new Error(`Документ сверки в формате «${ext || "без расширения"}» дописывать не умею — нужен .xlsx или .docx.`);
}

/**
 * Копия последней строки таблицы с подменённым текстом ячеек.
 *
 * Копируется именно XML существующей строки, а не собирается новая: так новая
 * запись наследует все границы, заливку и шрифты таблицы. Заново собранная строка
 * в чужой таблице выглядит инородно.
 */
async function appendDocxTableRow(filePath, values) {
  const JSZip = require("jszip");
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const part = zip.file("word/document.xml");
  if (!part) throw new Error("Это не похоже на документ Word: внутри нет word/document.xml.");
  let xml = await part.async("string");

  const lastTableEnd = xml.lastIndexOf("</w:tbl>");
  if (lastTableEnd === -1) throw new Error("В документе сверки нет таблицы, куда можно дописать строку.");
  const tableStart = xml.lastIndexOf("<w:tbl>", lastTableEnd);
  const table = xml.slice(tableStart, lastTableEnd);

  const rowMatches = [...table.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)];
  const templateRow = rowMatches[rowMatches.length - 1]?.[0];
  if (!templateRow) throw new Error("В таблице документа сверки нет ни одной строки-образца.");

  let cellIndex = 0;
  const newRow = templateRow.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g, (cell) => {
    const value = values[cellIndex++];
    const text = value === undefined || value === null ? "" : String(value);
    let replaced = false;
    // Текст пишется в первый <w:t> ячейки, остальные очищаются: иначе от прежней
    // записи остались бы «хвосты» в тех же ячейках.
    const withText = cell.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (m, open, _old, close) => {
      if (replaced) return `${open}${close}`;
      replaced = true;
      const openTag = open.includes("xml:space") ? open : open.replace(/>$/, ' xml:space="preserve">');
      return `${openTag}${escapeXml(text)}${close}`;
    });
    return withText;
  });

  xml = xml.slice(0, lastTableEnd) + newRow + xml.slice(lastTableEnd);
  zip.file("word/document.xml", xml);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(filePath, buffer);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- даты и номера ----------

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

/**
 * Дата документа по правилу его вида: у акта — последнее число месяца (работы
 * сданы по итогам месяца), у ТЗ — первое (задание ставится на месяц вперёд),
 * у остального — сегодня.
 */
function documentDate(kindId, month) {
  const rule = kindById(kindId).dateRule;
  if (!month || rule === "today") return formatDate(new Date());
  const [year, mon] = month.split("-").map((n) => parseInt(n, 10));
  if (!year || !mon) return formatDate(new Date());
  if (rule === "monthStart") return formatDate(new Date(year, mon - 1, 1));
  return formatDate(new Date(year, mon, 0)); // нулевой день следующего месяца = последний день этого
}

const MONTH_NAMES = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

function monthLabel(month) {
  if (!month) return "";
  const [year, mon] = month.split("-").map((n) => parseInt(n, 10));
  if (!year || !mon) return month;
  return `${MONTH_NAMES[mon - 1]} ${year}`;
}

// ---------- протокол агента ----------

const DOCFLOW_SYNTAX = `Готовый документ возвращай СТРОГО в таком виде — приложение разберёт его, покажет
предпросмотр и сохранит только после подтверждения человеком:

===ДОКУМЕНТ===
NUMBER: <номер документа, если он есть; иначе оставь пустым>
DATE: <дата документа в формате ДД.ММ.ГГГГ>
COUNTERPARTY: <контрагент>
SUM: <сумма документа цифрами, если она есть; иначе пусто>
FILENAME: <имя файла без расширения, например: Акт №42 от 31.08.2026 — ИП Павлов>
===ПРАВКИ===
SET 3: новый текст третьего блока шаблона
INSERT AFTER 5 [Heading2]: новый заголовок
DELETE 7
===КОНЕЦ===

Правила заполнения шаблона:
- Блоки шаблона пронумерованы ниже в квадратных скобках. SET заменяет текст блока целиком,
  сохраняя его стиль и начертание; INSERT AFTER вставляет новый абзац после блока
  (INSERT AFTER -1 — в самое начало); DELETE удаляет блок.
- Меняй ТОЛЬКО те блоки, где действительно меняются данные: номер, дата, реквизиты, предмет,
  суммы, перечень работ. Остальной текст шаблона не трогай — он выверен юридически.
- Текст внутри таблиц шаблона так менять нельзя. Если данные должны попасть в таблицу —
  скажи об этом словами в ответе, документ всё равно будет сохранён.
- Никогда не пиши, что уже сохранил документ: сохраняет приложение после подтверждения.
- Отвечай по-русски. Перед блоком ===ДОКУМЕНТ=== коротко объясни, что заполнил и откуда взял
  цифры — это то, что человек будет проверять.`;

const LAWYER_SYNTAX = `Готовый документ возвращай СТРОГО в таком виде — приложение разберёт его, покажет
предпросмотр и сохранит только после подтверждения человеком:

===ДОКУМЕНТ===
NUMBER: <номер, если он нужен; иначе пусто>
DATE: <дата в формате ДД.ММ.ГГГГ>
COUNTERPARTY: <контрагент>
SUM: <сумма цифрами, если она есть; иначе пусто>
FILENAME: <имя файла без расширения>
===ТЕКСТ===
<полный текст документа в разметке markdown: ## — заголовок раздела, обычные строки — абзацы,
"- " — пункты списка, таблицы в формате markdown>
===КОНЕЦ===`;

/** Разбирает ответ агента: метаданные плюс либо правки к шаблону, либо текст целиком. */
function parseResult(text) {
  const block = /===ДОКУМЕНТ===([\s\S]*?)===КОНЕЦ===/.exec(text || "");
  if (!block) return null;
  const body = block[1];

  const metaPart = body.split(/===(?:ПРАВКИ|ТЕКСТ)===/)[0];
  const field = (name) => {
    // Пробелы только горизонтальные: с обычным \s* пустое поле («NUMBER:» и сразу
    // перенос строки) съедало перевод строки и забирало значение следующего поля —
    // документ без номера получал номером свою же дату.
    const m = new RegExp(`^${name}:[^\\S\\r\\n]*(.*)$`, "im").exec(metaPart);
    return (m?.[1] || "").trim();
  };
  const meta = {
    number: field("NUMBER"),
    date: field("DATE"),
    counterparty: field("COUNTERPARTY"),
    sum: field("SUM"),
    filename: field("FILENAME"),
  };

  const editsMatch = /===ПРАВКИ===([\s\S]*)$/.exec(body);
  if (editsMatch) {
    const parsed = word.parseAgentEdit(`===WORD EDIT START===${editsMatch[1]}===WORD EDIT END===`);
    return { meta, ops: parsed?.ops || [], markdown: "" };
  }

  const textMatch = /===ТЕКСТ===([\s\S]*)$/.exec(body);
  if (textMatch) return { meta, ops: [], markdown: textMatch[1].trim() };

  return { meta, ops: [], markdown: "" };
}

/**
 * Системный промпт задания. Здесь же — все жёсткие правила про номер и дату:
 * они посчитаны приложением из документа сверки, а не оставлены на усмотрение
 * модели, потому что «посчитай сам следующий номер» она периодически проваливает.
 */
function buildPrompt({ kindId, month, references, ledgerText, nextNumber, date, templateText, mode, counterpartyName }) {
  const kind = kindById(kindId);
  const parts = [];

  if (mode === "lawyer") {
    parts.push(
      `Ты — юрист, который готовит документы для агентства. Твоя задача — составить документ так, чтобы он
защищал интересы твоего доверителя (стороны, от имени которой документ составляется), был исполнимым и не
противоречил действующему законодательству Российской Федерации.

Требования к работе:
- Используй те условия, которые назвал человек. Если условие юридически рискованно или ничтожно —
  скажи об этом прямо в ответе и предложи формулировку, которая работает.
- Не выдумывай реквизиты, суммы и сроки, которых тебе не дали: оставь для них явные места вида «____».
- Прямо перечисли, что в документе намеренно сделано в пользу доверителя, и какие риски остались.
- Ссылайся на нормы права там, где это уместно, но не превращай документ в реферат.`
    );
    parts.push(`\nВид документа: ${kind.name}.`);
  } else {
    parts.push(
      `Ты — помощник по документообороту агентства. Ты заполняешь ТИПОВОЙ ШАБЛОН документа реальными данными.

Что важно:
- Шаблон юридически выверен — меняются только данные, а не формулировки.
- Все цифры бери из приложенных исходников (выгрузки, тарифы, отчёты), а не из головы. Если данных
  не хватает — скажи, каких именно, и не подставляй правдоподобные значения.
- Если в исходниках есть скриншоты — читай их так же внимательно, как таблицы.`
    );
    parts.push(`\nВид документа: ${kind.name}.`);
  }

  if (counterpartyName) parts.push(`Контрагент: ${counterpartyName}.`);
  if (month) parts.push(`Отчётный период: ${monthLabel(month)}.`);

  const numbering = [];
  if (kind.numbered) {
    numbering.push(
      nextNumber
        ? `Номер документа: ${nextNumber}. Он уже посчитан приложением по документу сверки (крайний номер + 1) — используй именно его, не пересчитывай.`
        : `Номер документа приложение посчитать не смогло — определи его сам по документу сверки ниже (крайний номер этого вида + 1) и укажи в поле NUMBER.`
    );
  }
  numbering.push(
    `Дата документа: ${date}. Она рассчитана по правилу для этого вида документа — используй именно её.`
  );
  parts.push("\n" + numbering.join("\n"));

  for (const ref of references || []) {
    if (ref.image) {
      parts.push(`\n=== ИСХОДНИК (изображение): ${ref.title || ref.name} ===\n[приложено картинкой к сообщению]`);
      continue;
    }
    if (ref.error) {
      parts.push(`\n=== ${ref.title || ref.name} ===\n[не удалось прочитать: ${ref.error}]`);
      continue;
    }
    parts.push(`\n=== ${ref.title || ref.name} ===\n${ref.text}`);
  }

  if (ledgerText) parts.push(`\n=== ДОКУМЕНТ СВЕРКИ (последние записи) ===\n${ledgerText}`);

  if (templateText) {
    parts.push(`\n=== ШАБЛОН ДОКУМЕНТА (блоки пронумерованы) ===\n${templateText}`);
  }

  parts.push("\n" + (mode === "lawyer" ? LAWYER_SYNTAX : DOCFLOW_SYNTAX));
  return parts.join("\n");
}

/** Хвост документа сверки — в промпт целиком он не нужен, важны последние записи. */
function ledgerToText(ledger, limit = 40) {
  if (!ledger || ledger.format === "none" || ledger.rows.length === 0) return "";
  const header = ledger.headerRow >= 0 ? [ledger.rows[ledger.headerRow]] : [];
  const body = ledger.rows.slice(Math.max(ledger.headerRow + 1, ledger.rows.length - limit));
  return [...header, ...body].map((row) => row.values.join(" | ")).join("\n");
}

// ---------- сборка результата ----------

function sanitizeFileName(name) {
  return String(name || "Документ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Заполняет шаблон правками агента и сохраняет копию — исходный шаблон не трогаем. */
async function fillTemplate(templatePath, ops, destPath) {
  const model = await word.loadDocument(templatePath);
  word.applyAgentEdit(model, { ops });
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await word.saveDocument(model, destPath);
  return destPath;
}

/**
 * PDF из .docx.
 *
 * Первый путь — настоящий Word через COM: только он даёт файл, совпадающий с тем,
 * что человек увидит, открыв документ у себя. Второй — печать разметки из окна
 * приложения: работает всегда, но это уже приблизительная вёрстка, и приложение
 * об этом честно сообщает, а не выдаёт её за экспорт из Word.
 */
async function docxToPdf(docxPath, pdfPath, { renderHtmlToPdf } = {}) {
  if (process.platform === "win32") {
    try {
      await wordComToPdf(docxPath, pdfPath);
      return { path: pdfPath, via: "word" };
    } catch {
      // Word не установлен или COM недоступен — идём в запасной путь.
    }
  }
  if (!renderHtmlToPdf) throw new Error("PDF собрать нечем: Word недоступен, а запасной способ не передан.");
  const html = await docxToHtml(docxPath);
  await renderHtmlToPdf(html, pdfPath);
  return { path: pdfPath, via: "render" };
}

function wordComToPdf(docxPath, pdfPath) {
  const script = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open(${psQuote(docxPath)}, $false, $true)
  $doc.ExportAsFixedFormat(${psQuote(pdfPath)}, 17)
  $doc.Close($false)
} finally {
  $word.Quit()
}`;
  return new Promise((resolve, reject) => {
    const file = path.join(os.tmpdir(), `docflow-${Date.now()}.ps1`);
    fsSync.writeFileSync(file, "﻿" + script, "utf-8");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
      { timeout: 120000 },
      (error) => {
        fsSync.rmSync(file, { force: true });
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Разметка документа для запасного PDF: структура сохраняется, вёрстка — нет. */
async function docxToHtml(docxPath) {
  const mammoth = require("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: await fs.readFile(docxPath) });
  return `<!doctype html><meta charset="utf-8"><style>
    body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.45; margin: 0; padding: 20mm 15mm; color: #000; }
    h1, h2, h3 { font-family: inherit; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    p { margin: 0 0 8pt; }
  </style>${value}`;
}

/** Документ юриста: шаблона нет, поэтому .docx собирается из markdown агента. */
async function buildFromMarkdown(markdown, title, destPath) {
  const exportDocs = require("./exportDocs.cjs");
  const sections = await exportDocs.parseBlocks(markdown);
  const buffer = await exportDocs.buildDocx({ title, sections, brand: null });
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await exportDocs.writeBuffer(destPath, buffer);
  return destPath;
}

module.exports = {
  DOC_KINDS,
  kindById,
  loadConfig,
  saveConfig,
  uid,
  isImage,
  readReference,
  listFolder,
  readLedger,
  detectHeader,
  lastNumber,
  appendLedgerRow,
  documentDate,
  formatDate,
  monthLabel,
  buildPrompt,
  ledgerToText,
  parseResult,
  sanitizeFileName,
  fillTemplate,
  docxToPdf,
  docxToHtml,
  buildFromMarkdown,
};
