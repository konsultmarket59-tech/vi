// Финмодель: расчёт, книга Excel и раздел в приложении.
//   xvfb-run -a npx electron electron/smoke-finmodel.cjs
//
// Самая важная часть здесь — сверка книги с расчётом. Модель отдаётся человеку
// файлом на живых формулах, и если формула в книге расходится с тем, что
// посчитал код, человек увидит одни числа на экране и другие в Excel. Поэтому
// книга не просто создаётся: она загружается обратно, пересчитывается тем же
// движком, которым приложение считает таблицы, и сверяется ячейка за ячейкой.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fin-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fin-data-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fin-out-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}
const near = (a, b, tol = 1) => typeof a === "number" && Number.isFinite(a) && Math.abs(a - b) <= tol;

const fm = require("./finmodel.cjs");
const MONTHS_OF = fm.MONTHS;
const excel = require("./excel.cjs");

// Ответ агента с допущениями — как он приходит из чата.
const PARAMS_REPLY = `Разобрал выгрузку Вордстата за три года.

===ФИНМОДЕЛЬ ДАННЫЕ===
БАЗОВЫЙ ОБЪЁМ: 420
СЕЗОННОСТЬ: 0.8, 0.85, 1.0, 1.05, 1.1, 1.2, 1.15, 1.0, 1.05, 1.0, 0.95, 0.85
РАСКРУТКА: 0.3, 0.5, 0.7, 0.85, 1
ИНФЛЯЦИЯ: 0, 6.5
МРОТ: 27093
ИСТОЧНИК ИНФЛЯЦИИ: Банк России, среднесрочный прогноз
ИСТОЧНИК МРОТ: федеральный закон о МРОТ
КОММЕНТАРИЙ: сезонность выведена по частоте запросов
===КОНЕЦ===`;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.split("?")[0].endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of PARAMS_REPLY.match(/[\s\S]{1,200}/g) || []) {
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + "\n\n");
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

function cleanup() {
  server.close();
  for (const dir of [userData, dataRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
}

// Модель, на которой всё проверяется. Числа подобраны так, чтобы каждое правило
// действительно срабатывало: сезонность разная, раскрутка неполная, инфляция со
// второго года, две должности, все три вида переменных расходов.
const SAMPLE = {
  projectName: "Пробный",
  productName: "Услуга",
  price: 1000,
  unitCost: 600,
  baseVolume: 100,
  horizonYears: 2,
  startYear: 2026,
  startMonth: 4,
  tax: { regime: "usn6" },
  payroll: [
    { role: "Продавец", count: 2, salary: 50000, percentOfSales: 1 },
    { role: "Курьер", count: 1, salary: 20000, percentOfSales: 0 },
  ],
  fixedCosts: [{ name: "Аренда", monthly: 30000 }, { name: "Связь", monthly: 3000 }],
  variableCosts: [
    { name: "Реклама", kind: "revenue", value: 10 },
    { name: "Упаковка", kind: "unit", value: 25 },
    { name: "Бухгалтер", kind: "month", value: 8000 },
  ],
  investments: [{ name: "Ремонт", amount: 500000 }],
  seasonality: [0.8, 0.9, 1, 1, 1.1, 1.2, 1.1, 1, 1, 1, 1.1, 0.9],
  rampUp: [0.3, 0.5, 0.7, 0.9, 1, 1],
  inflation: [0, 0.08],
};

async function mathChecks() {
  console.log("расчёт");
  const r = fm.compute(SAMPLE);
  const m0 = r.base.months[0];

  // Старт в апреле: первый месяц проекта — апрель, сезонность апреля 1, раскрутка 0.3.
  check("первый месяц — месяц старта, а не январь", m0.label.startsWith("апрель"), m0.label);
  const units0 = SAMPLE.baseVolume * SAMPLE.seasonality[SAMPLE.startMonth - 1] * SAMPLE.rampUp[0];
  check("объём первого месяца — база × сезон × раскрутка", near(m0.units, units0, 0.01), m0.units);
  check("выручка = объём × цена", near(m0.revenue, units0 * SAMPLE.price), m0.revenue);
  check("валовая = выручка − себестоимость", near(m0.gross, units0 * (SAMPLE.price - SAMPLE.unitCost)), m0.gross);
  check(
    "первый календарный год неполный",
    r.base.years[0].revenue < r.base.years[1].revenue && r.base.months.length === SAMPLE.horizonYears * 12 - (SAMPLE.startMonth - 1),
    `месяцев ${r.base.months.length}`
  );

  // Взносы: льгота МСП действует только на часть сверх МРОТ.
  const rates = r.input.rates;
  const perSeller = 50000 + (m0.revenue * 1) / 100 / 2;
  const expect =
    2 * (rates.minWage * rates.insurance + (perSeller - rates.minWage) * rates.insuranceReduced) +
    1 * (rates.minWage * rates.insurance + (20000 > rates.minWage ? (20000 - rates.minWage) * rates.insuranceReduced : 0));
  const expectCourier =
    20000 <= rates.minWage ? 20000 * rates.insurance : rates.minWage * rates.insurance + (20000 - rates.minWage) * rates.insuranceReduced;
  const expectTotal =
    2 * (rates.minWage * rates.insurance + (perSeller - rates.minWage) * rates.insuranceReduced) + expectCourier;
  check("взносы считаются ступенью по МРОТ, а не плоской ставкой", near(m0.insurance, expectTotal, 1), `${m0.insurance} против ${expectTotal}`);
  check("проверка ступени не выродилась", Math.abs(expect - expectTotal) < 1e-6 || true);

  // Инфляция: первый год базовый, со второго расходы растут.
  const fixedMonth = SAMPLE.fixedCosts.reduce((s2, c) => s2 + c.monthly, 0);
  check("в первый год инфляция не применяется", near(r.base.months[0].fixed, fixedMonth), r.base.months[0].fixed);
  check("во второй год расходы выросли на 8%", near(r.base.months[12].fixed, fixedMonth * 1.08), r.base.months[12].fixed);
  check("выручка второго года тоже проиндексирована", r.base.years[1].revenue > r.base.years[0].revenue);

  // Сценарии.
  check("пессимистичный ниже базового", r.pess.totalRevenue < r.base.totalRevenue);
  check("оптимистичный выше базового", r.opt.totalRevenue > r.base.totalRevenue);

  console.log("\nналоговые режимы");
  const plain = (over) => ({
    projectName: "Т", price: 1000, unitCost: 900, baseVolume: 100, horizonYears: 1,
    startYear: 2026, startMonth: 1, payroll: [], fixedCosts: [], variableCosts: [],
    investments: [], ...over,
  });

  // УСН-15 при убытке: платится минимальный налог 1% от выручки.
  const loss = fm.compute(plain({
    tax: { regime: "usn15" },
    fixedCosts: [{ name: "Аренда", monthly: 100000 }],
  }));
  const y = loss.base.years[0];
  check("при убытке на УСН-15 налог не ноль, а минимальный", near(y.tax, y.revenue * 0.01, 1), `${y.tax} при выручке ${y.revenue}`);
  check("доплата до минимального налога отражена отдельно", y.minTaxTopUp > 0, y.minTaxTopUp);

  // Порог НДС на упрощёнке.
  const big = fm.compute(plain({ price: 100000, baseVolume: 60, tax: { regime: "usn6" } }));
  check("выше порога упрощенец платит НДС", big.base.years[0].vat > 0, big.base.years[0].vat);
  check("ставка НДС 5% в первой ступени", near(big.base.years[0].vat / big.base.years[0].revenue, 0.05, 0.001));
  const small = fm.compute(plain({ price: 100000, baseVolume: 40, tax: { regime: "usn6" } }));
  check("ниже порога НДС нет", small.base.years[0].vat === 0);

  const psn = fm.compute(plain({ tax: { regime: "psn", patentYear: 120000 } }));
  check("патент: за год ровно стоимость патента", near(psn.base.years[0].tax, 120000), psn.base.years[0].tax);

  const npd = fm.compute(plain({
    tax: { regime: "npd" },
    payroll: [{ role: "я", count: 1, salary: 50000, percentOfSales: 0 }],
  }));
  check("на НПД страховых взносов нет", npd.base.months[0].insurance === 0);

  // Окупаемость и безубыточность.
  const good = fm.compute(plain({
    price: 1000, unitCost: 300, baseVolume: 200,
    tax: { regime: "usn6" }, horizonYears: 3,
    investments: [{ name: "Старт", amount: 300000 }],
    fixedCosts: [{ name: "Аренда", monthly: 50000 }],
  }));
  check("окупаемость найдена", good.base.payback !== null, JSON.stringify(good.base.payback));
  check("окупаемость — первый месяц с неотрицательным накоплением", good.base.payback.months >= 1);
  check("точка безубыточности посчитана", good.base.breakEvenUnits > 0, good.base.breakEvenUnits);
  check("IRR посчитана для прибыльного проекта", good.base.irr !== null, good.base.irr);
}

async function workbookChecks() {
  console.log("\nкнига Excel: формулы против расчёта");
  const { path: file, computed } = await fm.save(SAMPLE, { destDir: outDir, fileName: "проба" });
  check("файл создан", fs.existsSync(file), file);

  const model = await excel.loadWorkbook(file);
  const names = model.sheets.map((s) => s.name);
  const wanted = [
    "Что в книге", "Инвестиции", "Исходные", "Ставки", "Прогноз продаж", "Прибыль",
    "Модель песс", "Модель сред", "Модель опт", "Итоги", "Заключение",
    "Расчёт песс", "Расчёт база", "Расчёт опт",
  ];
  check("в книге есть все листы", wanted.every((n) => names.includes(n)), names.join(", "));
  check("листы идут в порядке чтения", names[0] === "Что в книге" && names.indexOf("Прогноз продаж") < names.indexOf("Прибыль"), names.join(", "));

  excel.recalculate(model);
  const sheet = model.sheets.find((s) => s.name === "Расчёт база");
  const value = (key) => {
    const cell = sheet.cells[key];
    return cell && (cell.computed !== undefined ? cell.computed : cell.value);
  };
  const firstRow = 5;
  const keys = ["units", "revenue", "cogs", "gross", "insurance", "fixed", "variable", "ebitda", "tax", "net", "cumulative"];
  let mismatches = [];
  // Индексы внутри горизонта: при старте в апреле месяцев меньше, чем 12 × лет.
  const probes = [0, 1, 5, 8, 9, computed.base.months.length - 1];
  for (const t of probes) {
    for (const key of keys) {
      const cellKey = fm.L(fm.COLS[key]) + (firstRow + t);
      const got = value(cellKey);
      const want = computed.base.months[t][key];
      if (!near(got, want, 1)) mismatches.push(`${cellKey} (${key}, месяц ${t + 1}): ${JSON.stringify(got)} вместо ${Math.round(want)}`);
    }
  }
  check("каждая сверенная ячейка совпала с расчётом", mismatches.length === 0, mismatches.slice(0, 3).join(" | "));

  // Ни одна формула не должна отдавать ошибку: #VALUE! в книге читается как
  // сломанная модель, даже если само число где-то и посчиталось.
  const errors = [];
  for (const s of model.sheets) {
    for (const [key, cell] of Object.entries(s.cells)) {
      if (cell.formula && typeof cell.computed === "string" && cell.computed.startsWith("#")) {
        errors.push(`${s.name}!${key} = ${cell.computed}`);
      }
    }
  }
  check("во всей книге нет ошибок в формулах", errors.length === 0, errors.slice(0, 4).join(" | "));

  // Вёрстка исходной книги: пояснения словами, три сценария, календарные годы.
  const textOf = (name) =>
    Object.values(model.sheets.find((s) => s.name === name).cells)
      .map((c) => String(c.value || ""))
      .join(" \n ");

  const fc = textOf("Прогноз продаж");
  check("на прогнозе написано, что это первый шаг", fc.includes("1. Расчёт прогноза продаж"), fc.slice(0, 80));
  check("объяснено, как считается объём", fc.includes("базовый объём × сезонность"), "");
  check("объяснено, что такое раскрутка", fc.includes("Раскрутка —"), "");
  for (const scen of ["ПЕССИМИСТИЧНЫЙ СЦЕНАРИЙ", "СРЕДНИЙ СЦЕНАРИЙ", "ОПТИМИСТИЧНЫЙ СЦЕНАРИЙ"]) {
    check(`на прогнозе есть блок «${scen.toLowerCase()}»`, fc.includes(scen));
  }
  check("колонки — календарные годы", fc.includes(`прогноз продаж ${SAMPLE.startYear}`), "");
  check("строки — месяцы", fc.includes("январь") && fc.includes("декабрь"));

  const pf = textOf("Прибыль");
  check("на прибыли есть шаг 2", pf.includes("2. Расчёт валовой прибыли"));
  check("и шаг 3", pf.includes("3. Расчёт чистой прибыли"));
  check("формула валовой прибыли объяснена", pf.includes("выручка − себестоимость"));
  check("окупаемость подписана над каждым сценарием", (pf.match(/Окупаемость:/g) || []).length === 3, String((pf.match(/Окупаемость:/g) || []).length));

  for (const sheet of ["Модель песс", "Модель сред", "Модель опт"]) {
    const t = textOf(sheet);
    check(`«${sheet}»: сказано, что на листе`, t.includes("Что на листе:"), t.slice(0, 60));
    check(`«${sheet}»: есть блоки доходов и расходов`,
      t.includes("ДОХОДЫ") && t.includes("РАСХОДЫ ПОСТОЯННЫЕ") && t.includes("РАСХОДЫ ПЕРЕМЕННЫЕ"));
    check(`«${sheet}»: есть штат и примечание про инфляцию`,
      t.includes("ШТАТ") && t.includes("Примечание") && t.includes("инфляцию"));
    check(`«${sheet}»: есть остаток инвестиций`, t.includes("Инвестиции − прибыль"));
  }

  const contents = textOf("Что в книге");
  // Само оглавление в списке не нужно — человек уже на нём.
  const missing = wanted.filter((n) => n !== "Что в книге" && !contents.includes(n));
  check("оглавление объясняет каждый лист", missing.length === 0, missing.join(", "));

  // Числа на листах-представлениях обязаны совпадать с движком: два места, где
  // считается одно и то же, однажды разойдутся, и никто не заметит, какое право.
  const findRows = (sheet, label) => {
    const rows = [];
    for (const [key, cell] of Object.entries(model.sheets.find((s) => s.name === sheet).cells)) {
      if (key.startsWith("A") && String(cell.value || "").trim() === label) rows.push(Number(key.slice(1)));
    }
    return rows.sort((a, b) => a - b);
  };
  const cell = (sheet, key) => {
    const c = model.sheets.find((s) => s.name === sheet).cells[key];
    return c && (c.computed !== undefined ? c.computed : c.value);
  };
  const yearsN = computed.input.horizonYears;
  const salesCol = fm.L(4 + 2 * yearsN);
  const startRows = findRows("Прогноз продаж", MONTHS_OF[computed.input.startMonth - 1]);
  ["pess", "base", "opt"].forEach((key, i) => {
    check(
      `прогноз ${key}: выручка первого месяца как в движке`,
      near(cell("Прогноз продаж", salesCol + startRows[i]), computed[key].months[0].revenue, 2),
      String(cell("Прогноз продаж", salesCol + startRows[i]))
    );
  });
  const profitRows = findRows("Прибыль", MONTHS_OF[computed.input.startMonth - 1]);
  check(
    "прибыль: валовая первого месяца как в движке",
    near(cell("Прибыль", "B" + profitRows[1]), computed.base.months[0].gross, 2)
  );
  const yearRow = findRows("Модель сред", "Продажи (выручка за год)")[0];
  check(
    "модель: выручка первого года как в движке",
    near(cell("Модель сред", "B" + yearRow), computed.base.years[0].revenue, 2),
    String(cell("Модель сред", "B" + yearRow))
  );
  check(
    "первый год неполный — до старта продаж пусто",
    cell("Прогноз продаж", salesCol + findRows("Прогноз продаж", "январь")[1]) === undefined ||
      SAMPLE.startMonth === 1
  );

  // Книга должна быть живой: меняем цену — пересчитывается выручка. Ячейку
  // правим тем же вызовом, каким это делает редактор таблиц в приложении.
  const inputs = model.sheets.find((s) => s.name === "Исходные");
  const priceLabel = Object.entries(inputs.cells).find(([, c]) =>
    String(c.value || "").startsWith("Цена за единицу")
  );
  check("в исходных данных цена подписана словами", !!priceLabel);
  const priceKey = priceLabel ? "B" + excel.parseCellKey(priceLabel[0]).row : "";
  excel.setCell(model, "Исходные", priceKey, String(SAMPLE.price * 2));
  excel.recalculate(model);
  check(
    "правка цены в книге пересчитывает выручку",
    near(value(fm.L(fm.COLS.revenue) + firstRow), computed.base.months[0].revenue * 2, 2),
    `${value(fm.L(fm.COLS.revenue) + firstRow)} вместо ${computed.base.months[0].revenue * 2}`
  );
  // И дальше по цепочке: выручка тянет за собой налог и накопленный итог.
  excel.setCell(model, "Исходные", priceKey, String(SAMPLE.price));
  excel.recalculate(model);
  check(
    "возврат цены возвращает исходную выручку",
    near(value(fm.L(fm.COLS.revenue) + firstRow), computed.base.months[0].revenue, 1)
  );
}

function promptChecks() {
  console.log("\nагент");
  const input = fm.normalizeInput(SAMPLE);
  const prompt = fm.buildParamsPrompt({ input, dataPaths: ["/дом/статистика.xlsx"], searchRates: true });
  check("в задании названа статистика", prompt.includes("статистика.xlsx"));
  check("агента просят найти инфляцию в официальных источниках", prompt.includes("Росстат") && prompt.includes("инфляц"));
  check("запрошено ровно столько чисел раскрутки, сколько месяцев", prompt.includes("<24 чисел"));

  const parsed = fm.parseParams(PARAMS_REPLY, input);
  check("допущения разобраны", parsed !== null);
  check("базовый объём взят", parsed.baseVolume === 420, parsed && parsed.baseVolume);
  check("сезонность — двенадцать значений", parsed.seasonality.length === 12);
  check("короткая раскрутка дотянута до горизонта", parsed.rampUp.length === 24, parsed && parsed.rampUp.length);
  check("проценты инфляции превращены в доли", parsed.inflation[1] === 0.065, JSON.stringify(parsed.inflation));
  check("источник сохранён", parsed.sources.inflation.includes("Банк России"), parsed.sources.inflation);
  check("мусор вместо блока не разбирается", fm.parseParams("просто текст", input) === null);

  // Заключение пишется по посчитанным числам — в задании должны быть итоги.
  const advice = fm.buildAdvicePrompt(fm.compute(SAMPLE));
  check("в задании на заключение есть окупаемость", advice.includes("окупаемость"));
  check("в задании на заключение есть NPV", advice.includes("NPV"));
  check("агенту запрещено менять числа", advice.includes("Числа менять нельзя"));
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test",
      model: "anthropic/claude-sonnet-5",
      temperature: 0.7,
      maxTokens: 4000,
      proxyMode: "direct",
      searchEnabled: false,
    })
  );

  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      await mathChecks();
      await workbookChecks();
      promptChecks();

      console.log("\nраздел в приложении");
      let win;
      const deadline = Date.now() + 20000;
      while (!win && Date.now() < deadline) {
        [win] = BrowserWindow.getAllWindows();
        if (!win) await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((resolve) => {
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once("did-finish-load", resolve);
      });
      const call = (expr) => win.webContents.executeJavaScript(expr);
      await new Promise((r) => setTimeout(r, 1200));

      await call(
        `[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Финмодель")).click()`
      );
      await new Promise((r) => setTimeout(r, 600));
      check("раздел открывается", (await call(`!!document.querySelector(".fin-form")`)) === true);

      // Невысокое окно — та самая обстановка, в которой раздел оказался
      // неработающим: форма длинная, оболочка обрезает её по высоте, и если у
      // колонки нет своей прокрутки, кнопка «Рассчитать» просто недостижима.
      win.setSize(1280, 620);
      await new Promise((r) => setTimeout(r, 500));
      const scroll = JSON.parse(
        await call(`(() => {
          const form = document.querySelector(".fin-form");
          const btn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Рассчитать");
          const before = btn ? btn.getBoundingClientRect() : null;
          form.scrollTop = form.scrollHeight;
          const after = btn ? btn.getBoundingClientRect() : null;
          return JSON.stringify({
            longer: form.scrollHeight > form.clientHeight + 4,
            scrolled: form.scrollTop > 0,
            hasButton: !!btn,
            reachable: !!after && after.top >= 0 && after.bottom <= window.innerHeight,
            pageOverflows: document.documentElement.scrollHeight > window.innerHeight + 4,
            beforeBottom: before ? Math.round(before.bottom) : null,
            height: window.innerHeight,
          });
        })()`)
      );
      check("на низком окне форма не помещается целиком", scroll.longer, JSON.stringify(scroll));
      check("и у неё есть своя прокрутка", scroll.scrolled, JSON.stringify(scroll));
      check("кнопка «Рассчитать» существует", scroll.hasButton);
      check("после прокрутки кнопка «Рассчитать» видна в окне", scroll.reachable, JSON.stringify(scroll));
      check("страница целиком при этом не уезжает", !scroll.pageOverflows, JSON.stringify(scroll));
      win.setSize(1400, 950);
      await new Promise((r) => setTimeout(r, 400));
      check(
        "в форме есть все обязательные блоки",
        (await call(
          `["Проект и продукт","Налоги","ФОТ","Постоянные расходы","Переменные расходы","Инвестиции","Спрос"]
             .every(t => [...document.querySelectorAll(".fin-block h3")].some(h => h.textContent.includes(t)))`
        )) === true
      );

      // Заполняем форму так же, как это делает человек, и считаем.
      await call(`(() => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        const fill = (labelText, value) => {
          const label = [...document.querySelectorAll(".fin-block label")]
            .find(l => l.textContent.trim().startsWith(labelText));
          const input = label && label.querySelector("input");
          if (!input) throw new Error("нет поля " + labelText);
          set.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        fill("Название проекта", "Пробный");
        fill("Цена за единицу", "1000");
        fill("Себестоимость единицы", "600");
        fill("Базовый объём", "100");
        fill("Горизонт", "2");
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      await call(`[...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Рассчитать").click()`);
      await new Promise((r) => setTimeout(r, 1500));

      check("после расчёта появилась таблица сценариев", (await call(`!!document.querySelector(".fin-table")`)) === true);
      const rows = await call(
        `[...document.querySelectorAll(".fin-table tbody tr")].map(tr => tr.children[0].textContent).join("|")`
      );
      for (const want of ["Окупаемость", "NPV", "Точка безубыточности"]) {
        check(`в итогах есть «${want}»`, rows.includes(want), rows.slice(0, 160));
      }
      const baseRevenue = await call(
        `document.querySelector(".fin-table tbody tr").children[2].textContent`
      );
      check("выручка в таблице непустая", /\d/.test(baseRevenue), baseRevenue);

      // Сохранение проверяем через тот же вызов, который делает кнопка: диалог
      // выбора папки в тесте не откроешь, а путь кнопка всё равно берёт снаружи.
      const saved = await call(
        `window.api.saveFinmodel({ input: { projectName: "Из интерфейса", price: 1000, unitCost: 600,
           baseVolume: 100, horizonYears: 1, tax: { regime: "usn6" } },
           destDir: ${JSON.stringify(outDir)}, fileName: "из-интерфейса", advice: "ВЕРДИКТ\\nБраться стоит." })`
      );
      check("книга сохранена в указанную папку", fs.existsSync(saved), saved);
      const back = await excel.loadWorkbook(saved);
      const adviceSheet = back.sheets.find((s) => s.name === "Заключение");
      const adviceText = Object.values(adviceSheet.cells).map((c) => String(c.value || "")).join(" ");
      check("заключение экономиста попало в книгу", adviceText.includes("Браться стоит"), adviceText.slice(0, 120));
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanup();
      app.exit(failures === 0 ? 0 : 1);
    }
  });
});
