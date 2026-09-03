// Клининг и визуализация — ядро обоих модулей.
//   node electron/smoke-cleanup.cjs
//
// Клининг двигает чужие файлы, поэтому здесь проверяется в первую очередь то, что
// защищает данные: выход за пределы папки, отсутствие удаления, полный откат и
// сохранность файла при совпадении имён.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const cleanup = require("./cleanup.cjs");
const dataviz = require("./dataviz.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-"));

function write(rel, content = "x") {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

async function main() {
  console.log("опись папки");
  write("screenshot_2026-08-01.png");
  write("screenshot_2026-08-02.png");
  write("Акт 41.docx", "АКТ № 41 от 31.07.2026, ИП Павлов, SMM за июль");
  write("июль/Акт 12.docx", "АКТ № 12 от 31.07.2025");
  write("Болдино воронка.txt", "Контентная воронка по Болдино");

  const scanned = await cleanup.scan(tmp);
  check("файлы найдены рекурсивно", scanned.files.length === 5, String(scanned.files.length));
  check("подпапка замечена", scanned.folders.includes("июль"), JSON.stringify(scanned.folders));
  check(
    "скриншот отличается от обычной картинки по имени",
    cleanup.kindOf("screenshot_1.png") === "скриншот" && cleanup.kindOf("logo.png") === "изображение"
  );
  check("документ распознан", scanned.files.find((f) => f.name === "Акт 41.docx").kind === "документ");

  const inventory = await cleanup.describe(tmp, scanned, (p) => fsp.readFile(p, "utf-8"));
  check("в описи видно, где лежит файл", inventory.includes("июль/Акт 12.docx"), "");
  check("у документа дочитано содержимое", inventory.includes("ИП Павлов"), "");
  check("у картинок содержимое не читается", !inventory.includes("screenshot_2026-08-01.png — документ"));

  console.log("\nграница папки");
  check(
    "путь наружу отклоняется",
    (() => {
      try {
        cleanup.resolveInside(tmp, "../секреты.txt");
        return false;
      } catch {
        return true;
      }
    })()
  );
  check(
    "путь внутрь разрешён",
    cleanup.resolveInside(tmp, "Скриншоты/файл.png") === path.join(tmp, "Скриншоты", "файл.png")
  );

  console.log("\nразбор плана");
  const plan = cleanup.parsePlan(`Разложил скриншоты и документы по годам.

===ПЛАН===
MKDIR: Скриншоты
MOVE: screenshot_2026-08-01.png -> Скриншоты/screenshot_2026-08-01.png
MOVE: screenshot_2026-08-02.png -> Скриншоты/screenshot_2026-08-02.png
RENAME: июль -> июль 2025
DELETE: Болдино воронка.txt
===КОНЕЦ===`);
  check("команды разобраны", plan.ops.length === 4, JSON.stringify(plan.ops.map((o) => o.op)));
  check("удаление не существует как команда", !plan.ops.some((o) => o.op === "delete"), JSON.stringify(plan.ops));

  console.log("\nвыполнение и откат");
  const applied = await cleanup.applyPlan(tmp, plan);
  check("операции выполнены", applied.failed.length === 0, JSON.stringify(applied.failed));
  check("скриншоты переехали", fs.existsSync(path.join(tmp, "Скриншоты", "screenshot_2026-08-01.png")));
  check("папка переименована с годом", fs.existsSync(path.join(tmp, "июль 2025", "Акт 12.docx")));
  check("файл, который просили удалить, на месте", fs.existsSync(path.join(tmp, "Болдино воронка.txt")));

  const undone = await cleanup.undoPlan(tmp, applied.done);
  check("откат прошёл без ошибок", undone.failed.length === 0, JSON.stringify(undone.failed));
  check("файлы вернулись на место", fs.existsSync(path.join(tmp, "screenshot_2026-08-01.png")));
  check("папка вернула прежнее имя", fs.existsSync(path.join(tmp, "июль", "Акт 12.docx")));
  check("созданная пустая папка убрана", !fs.existsSync(path.join(tmp, "Скриншоты")));

  console.log("\nсовпадение имён");
  write("Отчёты/Акт 41.docx", "другой файл");
  const collision = await cleanup.applyPlan(tmp, {
    ops: [{ op: "move", from: "Акт 41.docx", to: "Отчёты/Акт 41.docx" }],
  });
  check("перенос выполнен", collision.failed.length === 0, JSON.stringify(collision.failed));
  check("прежний файл не затёрт", fs.readFileSync(path.join(tmp, "Отчёты", "Акт 41.docx"), "utf-8") === "другой файл");
  check("новый сохранён под другим именем", fs.existsSync(path.join(tmp, "Отчёты", "Акт 41 (2).docx")));

  console.log("\nплан наружу не исполняется");
  const escape = await cleanup.applyPlan(tmp, {
    ops: [{ op: "move", from: "Болдино воронка.txt", to: "../украдено.txt" }],
  });
  check("операция отклонена", escape.failed.length === 1 && escape.done.length === 0, JSON.stringify(escape));
  check("файл остался на месте", fs.existsSync(path.join(tmp, "Болдино воронка.txt")));
  check("наружу ничего не создано", !fs.existsSync(path.join(path.dirname(tmp), "украдено.txt")));

  console.log("\nуборка в несколько кругов");
  const many = path.join(tmp, "кругами");
  fs.mkdirSync(many, { recursive: true });
  fs.writeFileSync(path.join(many, "screen_1.png"), "a");
  fs.writeFileSync(path.join(many, "Договор 3.docx"), "b");

  // Круг первый: разложили скриншоты.
  const round1 = await cleanup.applyPlan(many, {
    ops: [
      { op: "mkdir", target: "Скриншоты" },
      { op: "move", from: "screen_1.png", to: "Скриншоты/screen_1.png" },
    ],
  });
  // Опись после круга должна показывать НОВОЕ состояние — иначе следующий план
  // строится по путям, которых уже нет.
  const rescan = await cleanup.scan(many);
  check(
    "после круга папка видна уже разобранной",
    rescan.folders.includes("Скриншоты") && rescan.files.some((f) => f.path === "Скриншоты/screen_1.png"),
    JSON.stringify(rescan.files.map((f) => f.path))
  );

  // Круг второй: разложили документ.
  const round2 = await cleanup.applyPlan(many, {
    ops: [
      { op: "mkdir", target: "Договоры" },
      { op: "move", from: "Договор 3.docx", to: "Договоры/Договор 3.docx" },
    ],
  });
  check("оба круга выполнены", round1.failed.length === 0 && round2.failed.length === 0);
  check("файлы разложены по двум папкам", fs.existsSync(path.join(many, "Договоры", "Договор 3.docx")));

  // Отмена копит журнал ОБОИХ кругов: человек, нажимая отмену, ждёт папку такой,
  // какой она была до начала уборки, а не до последнего шага.
  const allDone = [...round1.done, ...round2.done];
  const undoneAll = await cleanup.undoPlan(many, allDone);
  check("откат всей уборки прошёл", undoneAll.failed.length === 0, JSON.stringify(undoneAll.failed));
  check("файлы первого круга вернулись", fs.existsSync(path.join(many, "screen_1.png")));
  check("файлы второго круга вернулись", fs.existsSync(path.join(many, "Договор 3.docx")));
  check(
    "созданные папки убраны обе",
    !fs.existsSync(path.join(many, "Скриншоты")) && !fs.existsSync(path.join(many, "Договоры"))
  );

  console.log("\nсверка документов");
  const ledger = cleanup.parseLedger(`===СВЕРКА===
ЛИСТ: Договоры
Номер | Дата | Предмет | Контрагент | Файл
12 | 01.03.2026 | Продвижение | ИП Павлов | Договор 12.docx
 | 15.04.2026 | Приложение №1 к договору 12 | ИП Павлов | Приложение 1.docx
ЛИСТ: Акты
Номер | Дата | Предмет | Сумма | Контрагент | Файл
41 | 31.07.2026 | SMM за июль | 110000 | ИП Павлов | Акт 41.docx
ЛИСТ: ТЗ
Номер | Дата | Предмет | Сумма | Контрагент | Файл
ЛИСТ: Счета
Номер | Дата | Сумма | Основание | Контрагент | Файл
===КОНЕЦ===`);
  check("четыре листа", ledger.sheets.length === 4, ledger.sheets.map((s) => s.name).join(", "));
  check("порядок листов сохранён", ledger.sheets[0].name === "Договоры" && ledger.sheets[3].name === "Счета");
  check("приложение осталось строкой под договором", ledger.sheets[0].rows[2][2].includes("Приложение"), "");
  check("пустой номер у приложения не потерял столбцы", ledger.sheets[0].rows[2].length === 5, String(ledger.sheets[0].rows[2].length));
  check("лист без данных остаётся с заголовками", ledger.sheets[2].rows.length === 1);

  const xlsxPath = path.join(tmp, "Сверка.xlsx");
  await cleanup.writeLedgerWorkbook(ledger.sheets, xlsxPath);
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  check("книга собрана из четырёх листов", wb.worksheets.length === 4, String(wb.worksheets.length));
  check("данные на месте", wb.getWorksheet("Акты").getRow(2).getCell(4).value === "110000", "");
  check("шапка выделена жирным", wb.getWorksheet("Договоры").getRow(1).font?.bold === true);

  console.log("\nвизуализация: промпт и разбор");
  const preset = dataviz.presetById("post");
  const palette = dataviz.resolvePalette("brand", { accent: "#00D9FF" });
  check("размер холста подставлен", preset.width === 1080 && preset.height === 1350);
  check("ручная подмена цвета применилась", palette.accent === "#00D9FF");
  check("остальные цвета палитры на месте", palette.series.length === 6 && palette.text === "#0A0A0A");

  const prompt = dataviz.buildPrompt({
    kindId: "mindmap",
    preset,
    palette,
    references: [{ name: "данные.csv", text: "месяц,расход\nиюль,110000" }],
    extraStyle: "минимализм, много воздуха",
  });
  check("вид визуализации назван", prompt.includes("Майнд-карта"));
  check("точный размер задан", prompt.includes("1080×1350"));
  check("палитра передана", prompt.includes("#00D9FF") && prompt.includes("#0A0A0A"));
  check("пожелания по стилю переданы", prompt.includes("минимализм"));
  check("исходник вложен", prompt.includes("июль,110000"));
  check("запрещены внешние ресурсы", prompt.includes("внешние ссылки"));

  const parsed = dataviz.parseResult(`Показал расход по месяцам.

===ВИЗУАЛИЗАЦИЯ===
TITLE: Расход за лето
===HTML===
<div style="width:1080px;height:1350px">макет</div>
===КОНЕЦ===`);
  check("заголовок разобран", parsed.title === "Расход за лето", parsed?.title);
  check("разметка разобрана", parsed.html.includes("макет"));
  check("без блока — null", dataviz.parseResult("просто ответ") === null);
  check("без разметки — null, а не пустой макет", dataviz.parseResult("===ВИЗУАЛИЗАЦИЯ===\nTITLE: Пусто\n===КОНЕЦ===") === null);

  const page = dataviz.wrapDocument("<div>тело</div>", preset, palette);
  check("страница получает точный размер", page.includes("width: 1080px") && page.includes("height: 1350px"));
  check("размер страницы задан и для печати", page.includes("@page { size: 1080px 1350px"));
  check("фон палитры применён", page.includes("#F7F6F3"));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Непойманная ошибка:", e);
  process.exit(1);
});
