// Excel: формулы, которые в приложении считаются, а в Excel давали «#ИМЯ?».
//   node electron/smoke-excel-xlfn.cjs
//
// Живая жалоба: «результат показывается хорошо, а после импорта в некоторых
// ячейках ИМЯ». Обманчивость беды в том, что на экране всё верно — приложение
// считает MINIFS и MAXIFS само, — а ошибка вылезает только после открытия файла
// в настоящем Excel. Поэтому проверять надо не то, что показано, а то, ЧТО
// ЛЕЖИТ В ФАЙЛЕ.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { toFileFormula, fromFileFormula, XLFN_FUNCTIONS } = require("./excelFunctions.cjs");
const { finish } = require("./smoke-finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

/** Достаёт формулы из готового файла так, как их прочитает Excel. */
async function formulasInFile(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out = {};
  wb.worksheets[0].eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.formula != null) out[cell.address] = cell.formula;
    });
  });
  return out;
}

async function main() {
  console.log("приставка ставится только там, где она нужна");
  // Функции из Excel 2007 хранятся коротким именем; всё, что появилось позже, —
  // с приставкой _xlfn. Перепутать нельзя ни в ту, ни в другую сторону.
  check("MINIFS получает приставку",
    toFileFormula('MINIFS(B2:B5,A2:A5,"план")') === '_xlfn.MINIFS(B2:B5,A2:A5,"план")',
    toFileFormula('MINIFS(B2:B5,A2:A5,"план")'));
  check("MAXIFS получает приставку",
    toFileFormula("MAXIFS(C:C,A:A,A3)") === "_xlfn.MAXIFS(C:C,A:A,A3)", toFileFormula("MAXIFS(C:C,A:A,A3)"));
  check("SUMIFS остаётся как есть — она из 2007-го",
    toFileFormula('SUMIFS(B2:B5,A2:A5,"план")') === 'SUMIFS(B2:B5,A2:A5,"план")',
    toFileFormula('SUMIFS(B2:B5,A2:A5,"план")'));
  check("COUNTIFS и AVERAGEIFS тоже не трогаются",
    toFileFormula("COUNTIFS(A:A,1)") === "COUNTIFS(A:A,1)" &&
      toFileFormula("AVERAGEIFS(B:B,A:A,1)") === "AVERAGEIFS(B:B,A:A,1)");
  check("обычная SUM не трогается", toFileFormula("SUM(A1:A9)") === "SUM(A1:A9)");
  check("две новые функции в одной формуле — обе с приставкой",
    toFileFormula("MAXIFS(C:C,A:A,A3)-MINIFS(C:C,A:A,A3)") === "_xlfn.MAXIFS(C:C,A:A,A3)-_xlfn.MINIFS(C:C,A:A,A3)",
    toFileFormula("MAXIFS(C:C,A:A,A3)-MINIFS(C:C,A:A,A3)"));
  check("уже готовая формула не получает приставку дважды",
    toFileFormula("_xlfn.MINIFS(A:A,B:B,1)") === "_xlfn.MINIFS(A:A,B:B,1)",
    toFileFormula("_xlfn.MINIFS(A:A,B:B,1)"));
  check("точка в имени не ломает замену",
    toFileFormula("CEILING.MATH(A1)") === "_xlfn.CEILING.MATH(A1)", toFileFormula("CEILING.MATH(A1)"));

  // Слово внутри подписи — не функция. Приставка в подписи испортила бы лист.
  const сПодписью = toFileFormula('CONCAT(A1," отсортировано по SORT и FILTER")');
  check("имя функции внутри текста не трогается",
    сПодписью.includes('" отсортировано по SORT и FILTER"'), сПодписью);
  check("а сама CONCAT приставку получает", сПодписью.startsWith("_xlfn.CONCAT("), сПодписью);
  // Похожее имя, но другое — не наш случай.
  check("MINIFSX не считается за MINIFS", toFileFormula("MINIFSX(A1)") === "MINIFSX(A1)", toFileFormula("MINIFSX(A1)"));
  check("SUMMINIFS не считается за MINIFS",
    toFileFormula("SUMMINIFS(A1)") === "SUMMINIFS(A1)", toFileFormula("SUMMINIFS(A1)"));

  console.log("\nчтение обратно: приставка не должна попадать на глаза");
  check("приставка снимается при чтении",
    fromFileFormula("_xlfn.MINIFS(A:A,B:B,1)") === "MINIFS(A:A,B:B,1)",
    fromFileFormula("_xlfn.MINIFS(A:A,B:B,1)"));
  check("снимается и _xlws.", fromFileFormula("_xlfn._xlws.FILTER(A:A,B:B)") === "FILTER(A:A,B:B)");
  check("круговорот не меняет формулу",
    fromFileFormula(toFileFormula("MAXIFS(C:C,A:A,A3)")) === "MAXIFS(C:C,A:A,A3)");

  console.log("\nнастоящий файл: что в нём окажется");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xlfn-"));
  const file = path.join(dir, "свод.xlsx");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Сводные таблицы");
  ws.getCell("A1").value = "Готовность";
  ws.getCell("B1").value = "Цена";
  [["план", 7100000], ["готов", 9150000], ["стройка", 8200000], ["план", 6212400]].forEach((r, i) => {
    ws.getCell(`A${i + 2}`).value = r[0];
    ws.getCell(`B${i + 2}`).value = r[1];
  });
  // Ровно те пять столбцов, что стоят в её сводной таблице.
  const столбцы = {
    D2: 'COUNTIFS(A2:A5,"план")',
    E2: 'AVERAGEIFS(B2:B5,A2:A5,"план")',
    F2: 'MINIFS(B2:B5,A2:A5,"план")',
    G2: 'MAXIFS(B2:B5,A2:A5,"план")',
    H2: 'SUMIFS(B2:B5,A2:A5,"план")',
  };
  for (const [cell, f] of Object.entries(столбцы)) {
    ws.getCell(cell).value = { formula: toFileFormula(f), result: 0 };
  }
  await wb.xlsx.writeFile(file);

  const вФайле = await formulasInFile(file);
  check("минимум записан с приставкой", вФайле.F2.startsWith("_xlfn.MINIFS("), вФайле.F2);
  check("максимум записан с приставкой", вФайле.G2.startsWith("_xlfn.MAXIFS("), вФайле.G2);
  check("сумма записана без приставки", вФайле.H2 === 'SUMIFS(B2:B5,A2:A5,"план")', вФайле.H2);
  check("количество записано без приставки", вФайле.D2 === 'COUNTIFS(A2:A5,"план")', вФайле.D2);
  check("среднее записано без приставки",
    вФайле.E2 === 'AVERAGEIFS(B2:B5,A2:A5,"план")', вФайле.E2);

  // Прежнее поведение: короткое имя в файле — ровно то, из-за чего Excel
  // показывал «#ИМЯ?». Тест обязан отличать одно от другого.
  const старый = path.join(dir, "как-было.xlsx");
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("Лист");
  ws2.getCell("A1").value = { formula: 'MINIFS(B2:B5,A2:A5,"план")', result: 0 };
  await wb2.xlsx.writeFile(старый);
  const вСтаром = await formulasInFile(старый);
  check("как было: в файле короткое имя, его Excel и не узнаёт",
    вСтаром.A1 === 'MINIFS(B2:B5,A2:A5,"план")' && !вСтаром.A1.includes("_xlfn."), вСтаром.A1);

  console.log("\nсписок функций");
  check("в списке есть MINIFS и MAXIFS — с них всё началось",
    XLFN_FUNCTIONS.includes("MINIFS") && XLFN_FUNCTIONS.includes("MAXIFS"));
  check("в списке нет функций из 2007-го",
    !["SUM", "SUMIFS", "COUNTIFS", "AVERAGEIFS", "IF", "VLOOKUP"].some((f) => XLFN_FUNCTIONS.includes(f)),
    XLFN_FUNCTIONS.join(","));
  check("имена в списке не повторяются",
    new Set(XLFN_FUNCTIONS).size === XLFN_FUNCTIONS.length, String(XLFN_FUNCTIONS.length));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  finish(failures, (c) => process.exit(c));
}

main().catch((e) => {
  console.error("Тест упал:", e);
  process.exit(1);
});
