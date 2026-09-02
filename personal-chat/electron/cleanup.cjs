// Клининг: разбор папки по подпапкам и сверка документов в ней.
//
// Модуль двигает и переименовывает ЧУЖИЕ файлы на компьютере человека, поэтому
// устроен строже остальных:
//   1. Агент ничего не делает сам — он только предлагает план (создать папку,
//      перенести файл, переименовать), а выполняет его приложение после явного
//      подтверждения.
//   2. Удаления нет вообще. Ни в протоколе, ни в исполнении: разобрать папку
//      можно перемещением, а «прибраться» ценой потери файла нельзя.
//   3. Каждое выполнение пишет журнал отмены, и любой разбор откатывается
//      целиком одной кнопкой. Разбор чужого архива без отмены — это ловушка.
//   4. Ни один путь не может выйти за пределы выбранной папки: пути проверяются
//      перед каждой операцией, а не только при построении плана.

const fs = require("node:fs/promises");
const path = require("node:path");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic"];
const DOC_EXTENSIONS = [".docx", ".doc", ".pdf", ".xlsx", ".xls", ".txt", ".md", ".rtf", ".csv", ".pptx"];

const MAX_FILES = 600;
const MAX_READ_FILES = 40;
const MAX_READ_CHARS = 2500;

function extOf(name) {
  return path.extname(name).toLowerCase();
}

function kindOf(name) {
  const ext = extOf(name);
  if (IMAGE_EXTENSIONS.includes(ext)) return /^(screenshot|снимок|скрин)/i.test(name) ? "скриншот" : "изображение";
  if (DOC_EXTENSIONS.includes(ext)) return "документ";
  return "файл";
}

/**
 * Единственная граница безопасности: путь обязан остаться внутри выбранной папки.
 *
 * Проверяется у КАЖДОЙ операции перед выполнением, а не при разборе плана: план
 * приходит от модели, и «../../» в имени папки — ровно то, чего здесь быть не должно.
 */
function resolveInside(root, relative) {
  if (typeof root !== "string" || !root) throw new Error("Папка не выбрана.");
  const normalized = String(relative || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = path.resolve(root, normalized);
  const rootWithSep = path.resolve(root) + path.sep;
  if (absolute !== path.resolve(root) && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Путь «${relative}» выходит за пределы выбранной папки — отказано.`);
  }
  return absolute;
}

/** Опись папки: что и где лежит, с размерами и датами. */
async function scan(root, { maxFiles = MAX_FILES } = {}) {
  const files = [];
  const folders = [];
  let truncated = false;

  async function walk(dir, relative, depth) {
    if (files.length >= maxFiles || depth > 4) {
      truncated = truncated || files.length >= maxFiles;
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        folders.push(rel);
        await walk(path.join(dir, entry.name), rel, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      files.push({
        path: rel,
        name: entry.name,
        folder: relative,
        kind: kindOf(entry.name),
        ext: extOf(entry.name),
        size: stat?.size ?? 0,
        modified: stat ? new Date(stat.mtimeMs).toISOString().slice(0, 10) : "",
      });
    }
  }

  await walk(root, "", 0);
  return { files, folders, truncated };
}

/**
 * Опись для агента.
 *
 * Имени и расширения хватает, чтобы разложить скриншоты и картинки, но не хватает,
 * чтобы понять, к какому проекту относится документ с именем «Акт 5.docx» — поэтому
 * у документов дочитывается начало текста. Читается ограниченное число файлов:
 * прочитать сотню договоров целиком дороже, чем стоит вся уборка.
 */
async function describe(root, scanned, extractText, { readLimit = MAX_READ_FILES } = {}) {
  const lines = [];
  if (scanned.folders.length) {
    lines.push("Существующие подпапки:");
    for (const folder of scanned.folders) lines.push(`  ${folder}/`);
    lines.push("");
  }
  lines.push("Файлы:");

  let read = 0;
  for (const file of scanned.files) {
    const where = file.folder ? file.folder + "/" : "(в корне папки)";
    let line = `  ${where}${file.name} — ${file.kind}, ${Math.round(file.size / 1024)} КБ, изменён ${file.modified}`;
    if (file.kind === "документ" && read < readLimit) {
      read++;
      try {
        const text = await extractText(path.join(root, file.path));
        const excerpt = text.replace(/\s+/g, " ").trim().slice(0, MAX_READ_CHARS);
        if (excerpt) line += `\n      начало документа: ${excerpt}`;
      } catch {
        // Нечитаемый файл — не повод останавливать опись: агент разложит его по имени.
      }
    }
    lines.push(line);
  }
  if (scanned.truncated) lines.push(`\n[Показаны первые ${scanned.files.length} файлов — в папке их больше.]`);
  if (read >= readLimit) lines.push(`\n[Содержимое прочитано у первых ${readLimit} документов, у остальных — только имена.]`);
  return lines.join("\n");
}

const TIDY_SYNTAX = `План уборки возвращай СТРОГО в таком виде — приложение покажет его целиком и выполнит
только после подтверждения человеком:

===ПЛАН===
MKDIR: Скриншоты
MKDIR: Проект — Клиент А
MOVE: screenshot_2026-08-01.png -> Скриншоты/screenshot_2026-08-01.png
RENAME: июль -> июль 2025
===КОНЕЦ===

Правила:
- MKDIR создаёт папку (можно вложенную: «Проект/Август 2026»).
- MOVE переносит файл: слева путь как в описи, справа — куда положить, вместе с именем файла.
- RENAME переименовывает папку или файл.
- Пути только внутри выбранной папки. «..» запрещены.
- Удалять нельзя — команды удаления не существует. Ненужное просто перекладывай в отдельную папку.
- Не выдумывай принадлежность: если по имени и содержимому непонятно, к какому проекту относится
  файл, оставь его на месте и скажи об этом словами.
- Соблюдай ТУ ЖЕ логику именования, что уже видна в существующих подпапках. Если папки называются
  «июль», «август» без года — а по датам внутри видно год, — переименуй их в «июль 2025»,
  «август 2026» и продолжай в этом формате.
- Перед планом коротко объясни логику: по какому признаку что разложено. Это то, что человек проверяет.`;

const LEDGER_SYNTAX = `Сверку возвращай СТРОГО в таком виде — приложение соберёт из этого файл Excel
после подтверждения человеком:

===СВЕРКА===
ЛИСТ: Договоры
Номер | Дата | Предмет | Контрагент | Файл
12 | 01.03.2026 | <предмет договора> | <контрагент> | Договор 12.docx
  | 15.04.2026 | Приложение №1 к договору 12 | <контрагент> | Приложение 1.docx
ЛИСТ: Акты
Номер | Дата | Предмет | Сумма | Контрагент | Файл
41 | 31.07.2026 | <предмет работ> | 110000 | <контрагент> | Акт 41.docx
ЛИСТ: ТЗ
Номер | Дата | Предмет | Сумма | Контрагент | Файл
ЛИСТ: Счета
Номер | Дата | Сумма | Основание | Контрагент | Файл
===КОНЕЦ===

Правила:
- Ровно четыре листа и ровно в этом порядке: Договоры, Акты, ТЗ, Счета.
- Первая строка каждого листа — заголовки, дальше данные. Разделитель столбцов — «|».
- Приложения к договору идут строками сразу под своим договором, с пустым номером и с указанием
  в предмете, к какому договору они относятся.
- «Основание» у счёта — договор, акт или ТЗ, по которому он выставлен.
- Если чего-то в документе нет (например, у акта нет номера) — оставь ячейку пустой,
  не придумывай значение.
- В последнем столбце всегда имя файла, из которого взяты данные: по нему человек проверит.`;

function buildPrompt({ mode, inventory, folderName, notes }) {
  const parts = [];
  if (mode === "ledger") {
    parts.push(
      `Ты — помощник по документообороту. Тебе дана опись папки «${folderName}» с документами.
Твоя задача — собрать сверку: перечислить все договоры, акты, технические задания и счета,
которые в ней есть, с их реквизитами.

Данные бери только из самих документов. Если содержимое документа не прочитано, а по имени
понятно только его вид — впиши то, что известно из имени, и оставь остальное пустым.`
    );
  } else {
    parts.push(
      `Ты — помощник, который разбирает папки на компьютере. Тебе дана опись папки «${folderName}».
Твоя задача — предложить, как её разложить: какие подпапки создать и что куда перенести.

Как думать:
- Сначала пойми, что это за папка: рабочие документы, скриншоты, материалы проектов, всё вместе.
- Ищи логику в том, что уже есть: имена файлов, существующие подпапки, даты. Продолжай ЕЁ,
  а не свою. Человек потом должен узнать свою папку.
- Скриншоты и картинки собирай отдельно, если их много.
- Документы группируй по проекту и периоду, если это видно из содержимого или имени.
- Лучше оставить файл на месте, чем положить его не туда: неправильно разложенный документ
  человек будет искать дольше, чем неразобранный.`
    );
  }

  if (notes) parts.push(`\nЧто просил человек: ${notes}`);
  parts.push(`\n=== ОПИСЬ ПАПКИ ===\n${inventory}`);
  parts.push("\n" + (mode === "ledger" ? LEDGER_SYNTAX : TIDY_SYNTAX));
  return parts.join("\n");
}

/** Разбирает план уборки. Команд удаления в протоколе нет — и здесь тоже. */
function parsePlan(text) {
  const block = /===ПЛАН===([\s\S]*?)===КОНЕЦ===/.exec(text || "");
  if (!block) return null;
  const ops = [];
  for (const rawLine of block[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const mkdir = /^MKDIR:\s*(.+)$/i.exec(line);
    if (mkdir) {
      ops.push({ op: "mkdir", target: mkdir[1].trim() });
      continue;
    }
    const move = /^MOVE:\s*(.+?)\s*->\s*(.+)$/i.exec(line);
    if (move) {
      ops.push({ op: "move", from: move[1].trim(), to: move[2].trim() });
      continue;
    }
    const rename = /^RENAME:\s*(.+?)\s*->\s*(.+)$/i.exec(line);
    if (rename) ops.push({ op: "rename", from: rename[1].trim(), to: rename[2].trim() });
  }
  return ops.length ? { ops } : null;
}

/** Разбирает сверку: четыре листа с заголовками и строками. */
function parseLedger(text) {
  const block = /===СВЕРКА===([\s\S]*?)===КОНЕЦ===/.exec(text || "");
  if (!block) return null;
  const sheets = [];
  let current = null;
  for (const rawLine of block[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sheetMatch = /^ЛИСТ:\s*(.+)$/i.exec(line);
    if (sheetMatch) {
      current = { name: sheetMatch[1].trim(), rows: [] };
      sheets.push(current);
      continue;
    }
    if (!current) continue;
    current.rows.push(line.split("|").map((c) => c.trim()));
  }
  return sheets.length ? { sheets } : null;
}

/**
 * Выполняет план и возвращает журнал отмены.
 *
 * Что уже сделано — записывается по ходу, поэтому даже прерванный на середине
 * разбор откатывается полностью. Ошибка на одной операции не останавливает
 * остальные: человеку полезнее разобранная папка с одним пропуском и внятным
 * списком того, что не вышло, чем половина работы без объяснений.
 */
async function applyPlan(root, plan) {
  const done = [];
  const failed = [];

  for (const op of plan.ops || []) {
    try {
      if (op.op === "mkdir") {
        const dir = resolveInside(root, op.target);
        const existed = await fs.stat(dir).then(() => true).catch(() => false);
        await fs.mkdir(dir, { recursive: true });
        if (!existed) done.push({ op: "mkdir", target: op.target });
        continue;
      }

      const from = resolveInside(root, op.from);
      let to = resolveInside(root, op.to);
      await fs.mkdir(path.dirname(to), { recursive: true });

      // Файл с таким именем уже есть — добавляем номер вместо того, чтобы затереть.
      if (await fs.stat(to).then(() => true).catch(() => false)) {
        const ext = path.extname(to);
        const base = to.slice(0, to.length - ext.length);
        let n = 2;
        while (await fs.stat(`${base} (${n})${ext}`).then(() => true).catch(() => false)) n++;
        to = `${base} (${n})${ext}`;
      }

      await fs.rename(from, to);
      done.push({ op: op.op, from: op.from, to: path.relative(root, to).replace(/\\/g, "/") });
    } catch (e) {
      failed.push({ op, error: e.message });
    }
  }

  return { done, failed };
}

/** Откатывает разбор: перемещения назад в обратном порядке, созданные папки — если пусты. */
async function undoPlan(root, done) {
  const restored = [];
  const failed = [];
  for (const entry of [...(done || [])].reverse()) {
    try {
      if (entry.op === "mkdir") {
        const dir = resolveInside(root, entry.target);
        const rest = await fs.readdir(dir).catch(() => null);
        // Непустую папку не трогаем: в неё могли положить что-то ещё после разбора.
        if (rest && rest.length === 0) await fs.rmdir(dir);
        continue;
      }
      const from = resolveInside(root, entry.to);
      const to = resolveInside(root, entry.from);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      restored.push(entry);
    } catch (e) {
      failed.push({ entry, error: e.message });
    }
  }
  return { restored, failed };
}

/** Собирает сверку в .xlsx: по листу на вид документа. */
async function writeLedgerWorkbook(sheets, destPath) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31));
    sheet.rows.forEach((row, index) => {
      const added = worksheet.addRow(row);
      if (index === 0) added.font = { bold: true };
    });
    worksheet.columns.forEach((column) => {
      let width = 12;
      column.eachCell?.({ includeEmpty: false }, (cell) => {
        width = Math.max(width, Math.min(60, String(cell.value ?? "").length + 2));
      });
      column.width = width;
    });
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await workbook.xlsx.writeFile(destPath);
  return destPath;
}

module.exports = {
  scan,
  describe,
  buildPrompt,
  parsePlan,
  parseLedger,
  applyPlan,
  undoPlan,
  writeLedgerWorkbook,
  resolveInside,
  kindOf,
};
