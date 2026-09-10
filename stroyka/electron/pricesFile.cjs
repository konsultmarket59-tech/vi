// Чтение прайса с диска.
//
// Всё, что требует файловой системы и библиотеки чтения xlsx, живёт здесь и
// только здесь. Разбор таблицы, единицы измерения и сопоставление названий с
// марками — в prices.cjs, и он ничего не знает ни про файлы, ни про Node.
//
// Граница проведена не для красоты: калькулятор спрашивает у прайса цену по
// названию, и пока эти две вещи лежали вместе, любой расчёт тянул за собой
// полтора мегабайта exceljs — в том числе там, где никакого файла нет.

const fs = require("node:fs/promises");
const path = require("node:path");

const prices = require("./prices.cjs");

/**
 * Читает прайс с диска.
 *
 * Возвращает и позиции, и замечания. Замечания — не мелочь: «в 14 строках нет
 * цены» лучше увидеть при загрузке, чем обнаружить нулём в смете.
 */
async function прочитатьПрайс(файл) {
  let st;
  try {
    st = await fs.stat(файл);
  } catch (e) {
    return { доступен: false, замечание: `Прайс не открывается: ${e.message}`, позиции: [] };
  }

  const ext = path.extname(файл).toLowerCase();
  let листы;
  try {
    листы = ext === ".csv"
      ? prices.читатьCsv(await fs.readFile(файл, "utf-8"))
      : await читатьXlsx(файл);
  } catch (e) {
    return { доступен: false, замечание: `Не удалось прочитать файл: ${e.message}`, позиции: [] };
  }

  const { позиции, замечания } = prices.разобратьЛисты(листы);

  return {
    доступен: true,
    файл,
    изменён: st.mtime.toISOString(),
    позиции,
    замечания,
    // Свежесть прайса — вопрос, который задают на каждом совещании по деньгам.
    днейСОбновления: Math.floor((Date.now() - st.mtime.getTime()) / 86400000),
  };
}

async function читатьXlsx(файл) {
  const ExcelJS = require("exceljs");
  const книга = new ExcelJS.Workbook();
  await книга.xlsx.readFile(файл);
  const листы = [];
  книга.eachSheet((лист) => {
    const строки = [];
    лист.eachRow({ includeEmpty: true }, (строка) => {
      const значения = [];
      строка.eachCell({ includeEmpty: true }, (ячейка, номер) => {
        значения[номер - 1] = ячейка.value;
      });
      строки.push(значения);
    });
    листы.push({ имя: лист.name, строки });
  });
  return листы;
}

module.exports = { прочитатьПрайс, читатьXlsx };
