// Финансовая модель: прогноз продаж, доходы и расходы, налоги, окупаемость.
//
// Главное решение этого модуля — что считает код, а что агент.
//
// Считает КОД, целиком и детерминированно: выручку, себестоимость, ФОТ со
// взносами, расходы, налоги, прибыль, окупаемость, точку безубыточности, NPV и
// IRR. Модель, в которой числа придумала языковая модель, бесполезна: её нельзя
// ни проверить, ни защитить перед инвестором, а ошибка в одной цифре тянет за
// собой всю таблицу.
//
// Агент делает ровно две вещи, которые коду не по силам:
//   1. Читает статистику (выгрузку продаж, Вордстат) и выводит из неё кривую
//      спроса: базовый объём, сезонность по месяцам, скорость раскрутки.
//   2. Читает УЖЕ ПОСЧИТАННЫЕ числа и пишет по ним заключение экономиста.
// Во втором проходе агент видит результат расчёта, а не исходные данные, —
// поэтому его рекомендации опираются на настоящие цифры, а не на догадку.
//
// Ставки налогов и взносов — не константы внутри формул, а видимая таблица в
// книге. Налоговое законодательство меняется, и модуль, который «знает» ставку
// намертво, однажды начнёт молча врать. Здесь каждая ставка лежит отдельной
// ячейкой со ссылкой на источник, формулы ссылаются на неё, и человек может
// поправить ставку в Excel, не трогая приложение.
//
// Модуль не требует electron: всё, что связано с окнами и диалогами, приходит
// из main.cjs.

const fs = require("node:fs/promises");
const path = require("node:path");

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

/** Системы налогообложения. `hint` показывается человеку в форме. */
const TAX_REGIMES = [
  {
    id: "usn6",
    name: "УСН «Доходы»",
    rate: 0.06,
    hint: "Налог с выручки. Уменьшается на страховые взносы, но не больше чем наполовину.",
  },
  {
    id: "usn15",
    name: "УСН «Доходы минус расходы»",
    rate: 0.15,
    minRate: 0.01,
    hint: "Налог с прибыли. По итогам года платится не меньше 1% от выручки — даже при убытке.",
  },
  {
    id: "osno",
    name: "ОСНО",
    rate: 0.25,
    vat: 0.2,
    hint: "НДС с выручки плюс налог на прибыль. Для ИП вместо налога на прибыль — НДФЛ.",
  },
  {
    id: "psn",
    name: "Патент (ПСН)",
    rate: 0,
    hint: "Фиксированная стоимость патента за год. Впишите её в поле «Стоимость патента».",
  },
  {
    id: "npd",
    name: "НПД (самозанятый)",
    rate: 0.06,
    hint: "4% с продаж физлицам, 6% — юрлицам. Нельзя нанимать людей, лимит выручки за год.",
  },
  {
    id: "ausn6",
    name: "АУСН «Доходы»",
    rate: 0.08,
    hint: "Повышенная ставка, но страховые взносы за сотрудников не платятся.",
  },
  {
    id: "ausn20",
    name: "АУСН «Доходы минус расходы»",
    rate: 0.2,
    minRate: 0.03,
    hint: "Повышенная ставка вместо взносов. Минимальный налог — 3% от выручки.",
  },
];

/**
 * Ставки по умолчанию. ЭТО НЕ ИСТИНА В ПОСЛЕДНЕЙ ИНСТАНЦИИ, а стартовые
 * значения: каждое попадает в книгу отдельной строкой с пометкой «проверьте» и
 * местом для источника. Агент дополнительно ищет актуальные значения в сети.
 */
const DEFAULT_RATES = {
  insurance: 0.3,
  insuranceReduced: 0.15,
  minWage: 22440,
  useReducedInsurance: true,
  vatThreshold: 60000000,
  vatRateLow: 0.05,
  vatRateMid: 0.07,
  vatLowLimit: 250000000,
  ipFixedContribution: 53658,
  discountRate: 0.2,
  inflation: 0.04,
  npdLimit: 2400000,
};

/** Как ведёт себя статья переменных расходов при росте продаж. */
const COST_KINDS = [
  { id: "month", name: "фикс. сумма в месяц" },
  { id: "unit", name: "на единицу продукта" },
  { id: "revenue", name: "% от выручки" },
];

const num = (v, fallback = 0) => {
  const n = typeof v === "string" ? Number(v.replace(/\s/g, "").replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Приводит форму к тому виду, на который рассчитан расчёт: без дыр и NaN. */
function normalizeInput(raw = {}) {
  const horizonYears = Math.min(10, Math.max(1, Math.round(num(raw.horizonYears, 5))));
  const startMonth = Math.min(12, Math.max(1, Math.round(num(raw.startMonth, 1))));
  const startYear = Math.round(num(raw.startYear, new Date().getFullYear()));

  const seasonality = Array.from({ length: 12 }, (_, i) => {
    const v = num(raw.seasonality?.[i], 1);
    return v > 0 ? v : 1;
  });

  const totalMonths = horizonYears * 12;
  const rampRaw = Array.isArray(raw.rampUp) ? raw.rampUp : [];
  const rampUp = Array.from({ length: totalMonths }, (_, i) => {
    if (i < rampRaw.length) return Math.max(0, num(rampRaw[i], 1));
    // Дальше горизонта заданной раскрутки держим последнее значение: проект,
    // вышедший на мощность, на ней и остаётся.
    return rampRaw.length ? Math.max(0, num(rampRaw[rampRaw.length - 1], 1)) : 1;
  });

  const inflationRaw = Array.isArray(raw.inflation) ? raw.inflation : [];
  const rates = { ...DEFAULT_RATES, ...(raw.rates || {}) };
  const inflation = Array.from({ length: horizonYears }, (_, i) =>
    i < inflationRaw.length ? num(inflationRaw[i], rates.inflation) : num(rates.inflation, 0.04)
  );

  return {
    projectName: String(raw.projectName || "").trim() || "Проект",
    productName: String(raw.productName || "").trim() || "Продукт",
    price: num(raw.price),
    unitCost: num(raw.unitCost),
    baseVolume: num(raw.baseVolume),
    startYear,
    startMonth,
    horizonYears,
    seasonality,
    rampUp,
    inflation,
    indexPrice: raw.indexPrice !== false,
    scenarios: {
      pess: num(raw.scenarios?.pess, 0.7) || 0.7,
      base: num(raw.scenarios?.base, 1) || 1,
      opt: num(raw.scenarios?.opt, 1.25) || 1.25,
    },
    tax: {
      regime: String(raw.tax?.regime || "usn6"),
      patentYear: num(raw.tax?.patentYear),
      npdLegal: raw.tax?.npdLegal !== false,
      priceIncludesVat: !!raw.tax?.priceIncludesVat,
      ipWithoutStaff: !!raw.tax?.ipWithoutStaff,
    },
    payroll: (Array.isArray(raw.payroll) ? raw.payroll : [])
      .map((p) => ({
        role: String(p.role || "").trim(),
        count: num(p.count),
        salary: num(p.salary),
        percentOfSales: num(p.percentOfSales),
      }))
      .filter((p) => p.role || p.count || p.salary || p.percentOfSales),
    fixedCosts: (Array.isArray(raw.fixedCosts) ? raw.fixedCosts : [])
      .map((c) => ({ name: String(c.name || "").trim(), monthly: num(c.monthly) }))
      .filter((c) => c.name || c.monthly),
    variableCosts: (Array.isArray(raw.variableCosts) ? raw.variableCosts : [])
      .map((c) => ({
        name: String(c.name || "").trim(),
        kind: COST_KINDS.some((k) => k.id === c.kind) ? c.kind : "month",
        value: num(c.value),
      }))
      .filter((c) => c.name || c.value),
    investments: (Array.isArray(raw.investments) ? raw.investments : [])
      .map((c) => ({ name: String(c.name || "").trim(), amount: num(c.amount) }))
      .filter((c) => c.name || c.amount),
    rates,
    notes: String(raw.notes || "").trim(),
  };
}

/**
 * Накопленный индекс цен к году `y`. inflation[i] — рост года i к предыдущему,
 * поэтому первый год всегда базовый (индекс 1), а inflation[0] не применяется:
 * не к чему. Так же устроена и та модель, с которой этот модуль списан:
 * «расходы каждого последующего года по сравнению с предыдущим».
 */
function priceIndex(inflation, y) {
  let k = 1;
  for (let i = 1; i <= y; i++) k *= 1 + (inflation[i] || 0);
  return k;
}

function regimeById(id) {
  return TAX_REGIMES.find((r) => r.id === id) || TAX_REGIMES[0];
}

/**
 * Налог за месяц. Считается по месяцам ради денежного потока; правила, которые
 * по закону работают за год (минимальный налог на УСН-15, лимит НПД), досчитаны
 * отдельно в `annualAdjustments` — иначе в убыточные месяцы налог завышается.
 */
function monthlyTax(input, m) {
  const regime = regimeById(input.tax.regime);
  const rates = input.rates;
  const revenue = m.revenue;
  const expenses = m.cogs + m.payroll + m.percentPay + m.insurance + m.fixed + m.variable;

  switch (regime.id) {
    case "usn6": {
      const gross = revenue * regime.rate;
      // Взносы уменьшают налог, но не более чем наполовину. ИП без работников —
      // исключение: он вправе снять налог полностью.
      const cap = input.tax.ipWithoutStaff ? gross : gross * 0.5;
      return { tax: Math.max(0, gross - Math.min(m.insurance, cap)), vat: 0 };
    }
    case "usn15":
      return { tax: Math.max(0, (revenue - expenses) * regime.rate), vat: 0 };
    case "osno": {
      const vat = input.tax.priceIncludesVat
        ? revenue - revenue / (1 + regime.vat)
        : revenue * regime.vat;
      const profit = revenue - expenses;
      return { tax: Math.max(0, profit) * regime.rate, vat };
    }
    case "psn":
      return { tax: num(input.tax.patentYear) / 12, vat: 0 };
    case "npd":
      return { tax: revenue * (input.tax.npdLegal ? 0.06 : 0.04), vat: 0 };
    case "ausn6":
      return { tax: revenue * regime.rate, vat: 0 };
    case "ausn20":
      return { tax: Math.max(0, (revenue - expenses) * regime.rate), vat: 0 };
    default:
      return { tax: 0, vat: 0 };
  }
}

/** Ставка НДС на упрощёнке при превышении порога выручки. */
function usnVatRate(annualRevenue, rates) {
  if (annualRevenue <= rates.vatThreshold) return 0;
  return annualRevenue <= rates.vatLowLimit ? rates.vatRateLow : rates.vatRateMid;
}

/** Один сценарий целиком: помесячно, по годам и итогами. */
function computeScenario(input, multiplier) {
  const regime = regimeById(input.tax.regime);
  const rates = input.rates;
  const totalMonths = input.horizonYears * 12;
  const investment = input.investments.reduce((s, i) => s + i.amount, 0);

  const salaryFund = input.payroll.reduce((s, p) => s + p.count * p.salary, 0);
  const salesPercent = input.payroll.reduce((s, p) => s + p.percentOfSales, 0);
  // АУСН и НПД освобождают от страховых взносов за сотрудников.
  const insuranceRate =
    regime.id === "ausn6" || regime.id === "ausn20" || regime.id === "npd"
      ? 0
      : rates.useReducedInsurance
        ? rates.insuranceReduced
        : rates.insurance;

  const months = [];
  for (let t = 0; t < totalMonths; t++) {
    const y = Math.floor(t / 12);
    const calMonth = (input.startMonth - 1 + t) % 12;
    const costIdx = priceIndex(input.inflation, y);
    const priceIdx = input.indexPrice ? costIdx : 1;

    const season = input.seasonality[calMonth];
    const ramp = input.rampUp[t] ?? 1;
    const units = input.baseVolume * season * ramp * multiplier;

    const revenue = units * input.price * priceIdx;
    const cogs = units * input.unitCost * costIdx;
    const gross = revenue - cogs;

    const payroll = salaryFund * costIdx;
    const percentPay = (revenue * salesPercent) / 100;
    const insurance = insuranceFor(input, revenue, costIdx, insuranceRate, rates);

    const fixed = input.fixedCosts.reduce((s, c) => s + c.monthly, 0) * costIdx;
    const variable = input.variableCosts.reduce((s, c) => {
      if (c.kind === "unit") return s + c.value * units * costIdx;
      if (c.kind === "revenue") return s + (revenue * c.value) / 100;
      return s + c.value * costIdx;
    }, 0);

    const row = {
      t, year: y, calMonth,
      label: `${MONTHS[calMonth]} ${input.startYear + Math.floor((input.startMonth - 1 + t) / 12)}`,
      units, revenue, cogs, gross, payroll, percentPay, insurance, fixed, variable,
    };
    row.ebitda = gross - payroll - percentPay - insurance - fixed - variable;
    const { tax, vat } = monthlyTax(input, row);
    row.tax = tax;
    row.vat = vat;
    row.net = row.ebitda - tax - vat;
    months.push(row);
  }

  // Годовые правила. Минимальный налог на УСН-15 и АУСН-20 считается по итогам
  // года и добирается в декабре; НДС на упрощёнке включается при превышении
  // порога выручки — оба правила месячным расчётом не выражаются.
  const years = [];
  for (let y = 0; y < input.horizonYears; y++) {
    const slice = months.filter((m) => m.year === y);
    const sum = (k) => slice.reduce((s, m) => s + m[k], 0);
    const yearRevenue = sum("revenue");

    let extraTax = 0;
    if (regime.minRate) {
      const minTax = yearRevenue * regime.minRate;
      const accrued = sum("tax");
      extraTax = Math.max(0, minTax - accrued);
    }
    let vatExtra = 0;
    if (regime.id === "usn6" || regime.id === "usn15") {
      const vr = usnVatRate(yearRevenue, rates);
      if (vr > 0) vatExtra = yearRevenue * vr;
    }
    if (extraTax || vatExtra) {
      const last = slice[slice.length - 1];
      last.tax += extraTax;
      last.vat += vatExtra;
      last.net -= extraTax + vatExtra;
    }
    years.push({
      year: input.startYear + y,
      index: y,
      revenue: yearRevenue,
      units: sum("units"),
      cogs: sum("cogs"),
      gross: sum("gross"),
      payroll: sum("payroll") + sum("percentPay"),
      insurance: sum("insurance"),
      fixed: sum("fixed"),
      variable: sum("variable"),
      ebitda: sum("ebitda"),
      tax: sum("tax"),
      vat: sum("vat"),
      net: sum("net"),
      minTaxTopUp: extraTax,
      vatOnThreshold: vatExtra,
    });
  }

  // Денежный поток: инвестиции — нулевым месяцем, до старта продаж.
  let acc = -investment;
  for (const m of months) {
    acc += m.net;
    m.cumulative = acc;
  }

  const paybackIndex = months.findIndex((m) => m.cumulative >= 0);
  const flows = [-investment, ...months.map((m) => m.net)];

  // Точка безубыточности — на первый месяц выхода на мощность, чтобы не мерить
  // её по стартовому месяцу, когда продаж почти нет.
  const marginPerUnit = input.price - input.unitCost - unitVariable(input);
  const monthlyFixed =
    salaryFund +
    insuranceFor(input, 0, 1, insuranceRate, rates) +
    input.fixedCosts.reduce((s, c) => s + c.monthly, 0) +
    input.variableCosts.filter((c) => c.kind === "month").reduce((s, c) => s + c.value, 0);

  return {
    months,
    years,
    investment,
    payback: paybackIndex >= 0 ? { months: paybackIndex + 1, label: months[paybackIndex].label } : null,
    npv: npv(flows, input.rates.discountRate / 12),
    irr: irr(flows),
    breakEvenUnits: marginPerUnit > 0 ? monthlyFixed / marginPerUnit : null,
    breakEvenRevenue: marginPerUnit > 0 ? (monthlyFixed / marginPerUnit) * input.price : null,
    marginPerUnit,
    totalNet: months.reduce((s, m) => s + m.net, 0),
    totalRevenue: months.reduce((s, m) => s + m.revenue, 0),
  };
}

/**
 * Страховые взносы за месяц. Льготный тариф малого бизнеса действует НЕ на всю
 * зарплату: до МРОТ взносы платятся по общей ставке и только часть сверх него —
 * по льготной. Плоские 15% занижают ФОТ примерно на треть, а недооценённые
 * взносы — самая частая причина, по которой модель сходится на бумаге и не
 * сходится в жизни.
 */
function insuranceFor(input, revenue, costIdx, insuranceRate, rates) {
  if (!insuranceRate) return 0;
  const reduced = insuranceRate === rates.insuranceReduced;
  const minWage = num(rates.minWage);
  let total = 0;
  for (const p of input.payroll) {
    const count = p.count || 0;
    if (!count) continue;
    // Процент от продаж — тоже оплата труда, и взносы на него начисляются.
    const perPerson = p.salary * costIdx + (revenue * p.percentOfSales) / 100 / count;
    if (!reduced || perPerson <= minWage) {
      total += count * perPerson * (reduced ? rates.insurance : insuranceRate);
    } else {
      total += count * (minWage * rates.insurance + (perPerson - minWage) * rates.insuranceReduced);
    }
  }
  return total;
}

/** Переменные расходы, приходящиеся на одну единицу продукта. */
function unitVariable(input) {
  return input.variableCosts.reduce((s, c) => {
    if (c.kind === "unit") return s + c.value;
    if (c.kind === "revenue") return s + (input.price * c.value) / 100;
    return s;
  }, 0);
}

function npv(flows, rate) {
  return flows.reduce((s, f, i) => s + f / Math.pow(1 + rate, i), 0);
}

/**
 * Внутренняя норма доходности — делением отрезка пополам. Метод Ньютона на
 * денежных потоках с несколькими сменами знака расходится, а этот сходится
 * всегда, если корень в отрезке есть.
 */
function irr(flows) {
  const f = (r) => flows.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0);
  let lo = -0.9999;
  let hi = 10;
  let flo = f(lo);
  let fhi = f(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const monthly = (lo + hi) / 2;
  return Math.pow(1 + monthly, 12) - 1;
}

/** Все три сценария разом. */
function compute(raw) {
  const input = normalizeInput(raw);
  return {
    input,
    pess: computeScenario(input, input.scenarios.pess),
    base: computeScenario(input, input.scenarios.base),
    opt: computeScenario(input, input.scenarios.opt),
  };
}

module.exports = {
  MONTHS,
  TAX_REGIMES,
  DEFAULT_RATES,
  COST_KINDS,
  normalizeInput,
  compute,
  computeScenario,
  regimeById,
  usnVatRate,
  unitVariable,
  insuranceFor,
  npv,
  irr,
  priceIndex,
};

// ---------------------------------------------------------------------------
// Книга Excel
//
// Книга собирается на ЖИВЫХ формулах, а не на готовых числах. Модель, выданная
// числами, мертва: поменяв цену, человек должен получить пересчёт, а не идти
// обратно в приложение. Поэтому все ставки, объёмы и статьи расходов лежат
// отдельными ячейками, а расчётные листы на них ссылаются.
//
// Из функций используются только те, что переживают пересчёт и во встроенном
// просмотрщике приложения (SUM, SUMIF, IF, MIN/MAX, SUMPRODUCT, INDEX). NPV и
// IRR встроенный движок не умеет, поэтому дисконтирование разложено отдельной
// колонкой, а IRR подписана как значение, посчитанное приложением.

const SHEET_IN = "Исходные";
const SHEET_RATES = "Ставки";
const SHEET_SUM = "Итоги";
const SHEET_ADVICE = "Заключение";

const MONEY = "# ##0";
const COEF = "0.000";
const PCT = "0.0%";

const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0EEE9" } };
const EDIT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF4FB" } };
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7E9EF" } };

function title(ws, row, text) {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: 12 };
  return row + 1;
}

function header(ws, row, cells) {
  cells.forEach((t, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = t;
    c.font = { bold: true };
    c.fill = HEAD_FILL;
  });
  return row + 1;
}

/** Ячейка, которую человек вправе править: подсвечена, чтобы это было видно. */
function editable(ws, row, col, value, fmt) {
  const c = ws.getCell(row, col);
  c.value = value;
  c.fill = EDIT_FILL;
  if (fmt) c.numFmt = fmt;
  return c;
}

/** Лист исходных данных. Возвращает адреса, на которые ссылаются формулы. */
function writeInputs(wb, input) {
  const ws = wb.addWorksheet(SHEET_IN);
  ws.getColumn(1).width = 42;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 16;

  const ref = {};
  let r = 1;
  ws.getCell(r, 1).value = `Финансовая модель — ${input.projectName}`;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r += 1;
  ws.getCell(r, 1).value =
    "Голубые ячейки можно менять — вся книга пересчитается. Серые считаются формулами.";
  r += 2;

  r = title(ws, r, "ПРОДУКТ");
  ws.getCell(r, 1).value = "Название продукта";
  editable(ws, r, 2, input.productName);
  r += 1;
  ws.getCell(r, 1).value = "Цена за единицу, ₽";
  editable(ws, r, 2, input.price, MONEY);
  ref.price = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Себестоимость единицы, ₽";
  editable(ws, r, 2, input.unitCost, MONEY);
  ref.unitCost = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Маржа на единицу, ₽";
  ws.getCell(r, 2).value = { formula: `${ref.price}-${ref.unitCost}` };
  ws.getCell(r, 2).numFmt = MONEY;
  r += 1;
  ws.getCell(r, 1).value = "Маржинальность";
  ws.getCell(r, 2).value = { formula: `IF(${ref.price}=0,0,(${ref.price}-${ref.unitCost})/${ref.price})` };
  ws.getCell(r, 2).numFmt = PCT;
  r += 2;

  r = title(ws, r, "ОБЪЁМ И ГОРИЗОНТ");
  ws.getCell(r, 1).value = "Базовый объём, ед./мес (100% мощности, средний сезон)";
  editable(ws, r, 2, input.baseVolume, MONEY);
  ref.baseVolume = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Старт продаж";
  ws.getCell(r, 2).value = `${MONTHS[input.startMonth - 1]} ${input.startYear}`;
  r += 1;
  ws.getCell(r, 1).value = "Горизонт, лет";
  ws.getCell(r, 2).value = input.horizonYears;
  r += 2;

  r = title(ws, r, "СЦЕНАРИИ (множитель к базовому объёму)");
  ws.getCell(r, 1).value = "Пессимистичный";
  editable(ws, r, 2, input.scenarios.pess, COEF);
  ref.scenPess = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Базовый";
  editable(ws, r, 2, input.scenarios.base, COEF);
  ref.scenBase = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Оптимистичный";
  editable(ws, r, 2, input.scenarios.opt, COEF);
  ref.scenOpt = `$B$${r}`;
  r += 2;

  r = title(ws, r, "СЕЗОННОСТЬ (доля от среднего месяца)");
  r = header(ws, r, ["Месяц", "Коэффициент"]);
  ref.seasonFirst = r;
  for (let i = 0; i < 12; i++) {
    ws.getCell(r, 1).value = MONTHS[i];
    editable(ws, r, 2, input.seasonality[i], COEF);
    r += 1;
  }
  r += 1;

  r = title(ws, r, "ШТАТ");
  r = header(ws, r, ["Должность", "Человек", "Оклад, ₽", "% от продаж"]);
  ref.payrollFirst = r;
  const payroll = input.payroll.length ? input.payroll : [{ role: "—", count: 0, salary: 0, percentOfSales: 0 }];
  for (const p of payroll) {
    ws.getCell(r, 1).value = p.role || "—";
    editable(ws, r, 2, p.count, "0");
    editable(ws, r, 3, p.salary, MONEY);
    editable(ws, r, 4, p.percentOfSales, "0.00");
    r += 1;
  }
  ref.payrollLast = r - 1;
  ws.getCell(r, 1).value = "ИТОГО оклады в месяц";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = {
    formula: `SUMPRODUCT($B$${ref.payrollFirst}:$B$${ref.payrollLast},$C$${ref.payrollFirst}:$C$${ref.payrollLast})`,
  };
  ws.getCell(r, 2).numFmt = MONEY;
  ws.getCell(r, 2).fill = TOTAL_FILL;
  ref.salaryFund = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "ИТОГО % от продаж";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = { formula: `SUM($D$${ref.payrollFirst}:$D$${ref.payrollLast})` };
  ws.getCell(r, 2).numFmt = "0.00";
  ws.getCell(r, 2).fill = TOTAL_FILL;
  ref.salesPercent = `$B$${r}`;
  r += 2;

  r = title(ws, r, "ПОСТОЯННЫЕ РАСХОДЫ (в месяц)");
  r = header(ws, r, ["Статья", "Сумма, ₽"]);
  const fixedFirst = r;
  const fixed = input.fixedCosts.length ? input.fixedCosts : [{ name: "—", monthly: 0 }];
  for (const c of fixed) {
    ws.getCell(r, 1).value = c.name || "—";
    editable(ws, r, 2, c.monthly, MONEY);
    r += 1;
  }
  ws.getCell(r, 1).value = "ИТОГО постоянные";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = { formula: `SUM($B$${fixedFirst}:$B$${r - 1})` };
  ws.getCell(r, 2).numFmt = MONEY;
  ws.getCell(r, 2).fill = TOTAL_FILL;
  ref.fixedTotal = `$B$${r}`;
  r += 2;

  r = title(ws, r, "ПЕРЕМЕННЫЕ РАСХОДЫ");
  r = header(ws, r, ["Статья", "Как считается", "Значение"]);
  const varFirst = r;
  const variable = input.variableCosts.length
    ? input.variableCosts
    : [{ name: "—", kind: "month", value: 0 }];
  for (const c of variable) {
    ws.getCell(r, 1).value = c.name || "—";
    editable(ws, r, 2, COST_KINDS.find((k) => k.id === c.kind)?.name || c.kind);
    editable(ws, r, 3, c.value, "# ##0.00");
    r += 1;
  }
  const varLast = r - 1;
  const kindName = (id) => COST_KINDS.find((k) => k.id === id).name;
  const sumif = (id) =>
    `SUMIF($B$${varFirst}:$B$${varLast},"${kindName(id)}",$C$${varFirst}:$C$${varLast})`;
  ws.getCell(r, 1).value = "ИТОГО в месяц";
  ws.getCell(r, 3).value = { formula: sumif("month") };
  ws.getCell(r, 3).numFmt = MONEY;
  ws.getCell(r, 3).fill = TOTAL_FILL;
  ref.varMonth = `$C$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "ИТОГО на единицу";
  ws.getCell(r, 3).value = { formula: sumif("unit") };
  ws.getCell(r, 3).numFmt = "# ##0.00";
  ws.getCell(r, 3).fill = TOTAL_FILL;
  ref.varUnit = `$C$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "ИТОГО % от выручки";
  ws.getCell(r, 3).value = { formula: sumif("revenue") };
  ws.getCell(r, 3).numFmt = "0.00";
  ws.getCell(r, 3).fill = TOTAL_FILL;
  ref.varRevenue = `$C$${r}`;
  r += 2;

  r = title(ws, r, "ИНВЕСТИЦИИ");
  r = header(ws, r, ["Статья", "Сумма, ₽"]);
  const invFirst = r;
  const inv = input.investments.length ? input.investments : [{ name: "—", amount: 0 }];
  for (const c of inv) {
    ws.getCell(r, 1).value = c.name || "—";
    editable(ws, r, 2, c.amount, MONEY);
    r += 1;
  }
  ws.getCell(r, 1).value = "ИТОГО инвестиции";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = { formula: `SUM($B$${invFirst}:$B$${r - 1})` };
  ws.getCell(r, 2).numFmt = MONEY;
  ws.getCell(r, 2).fill = TOTAL_FILL;
  ref.investTotal = `$B$${r}`;
  r += 2;

  r = title(ws, r, "РАСКРУТКА (доля от базового объёма по месяцам проекта)");
  r = header(ws, r, ["Месяц проекта", "Доля"]);
  ref.rampFirst = r;
  for (let i = 0; i < input.rampUp.length; i++) {
    ws.getCell(r, 1).value = i + 1;
    editable(ws, r, 2, input.rampUp[i], COEF);
    r += 1;
  }
  return ref;
}

/** Лист ставок. Всё, что задаёт закон, а не проект, — и всё под сомнением. */
function writeRates(wb, input, sources) {
  const ws = wb.addWorksheet(SHEET_RATES);
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 16;
  ws.getColumn(3).width = 70;

  const regime = regimeById(input.tax.regime);
  const ref = {};
  let r = 1;
  ws.getCell(r, 1).value = "Ставки и допущения";
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r += 1;
  ws.getCell(r, 1).value =
    "Ставки меняются законом. Приложение подставило значения на момент расчёта — проверьте их " +
    "и при необходимости поправьте прямо здесь: формулы ссылаются на эти ячейки.";
  r += 2;

  r = header(ws, r, ["Показатель", "Значение", "Источник / комментарий"]);
  const row = (name, value, fmt, note) => {
    ws.getCell(r, 1).value = name;
    editable(ws, r, 2, value, fmt);
    ws.getCell(r, 3).value = note || "";
    const addr = `$B$${r}`;
    r += 1;
    return addr;
  };

  ws.getCell(r, 1).value = "Система налогообложения";
  ws.getCell(r, 2).value = regime.name;
  ws.getCell(r, 3).value = regime.hint;
  r += 1;
  ref.taxRate = row("Ставка налога", regime.rate, PCT, sources.taxRate || "Проверьте актуальную ставку.");
  ref.minRate = row("Минимальный налог, % от выручки за год", regime.minRate || 0, PCT,
    regime.minRate ? "Платится, если налог за год оказался меньше." : "Для этого режима не применяется.");
  ref.patent = row("Стоимость патента за год, ₽", num(input.tax.patentYear), MONEY,
    regime.id === "psn" ? "Считается по калькулятору ФНС для вашего региона." : "Только для патента.");
  ref.insurance = row("Страховые взносы, общий тариф", input.rates.insurance, PCT,
    sources.insurance || "На часть зарплаты в пределах МРОТ.");
  ref.insuranceReduced = row("Страховые взносы, льготный тариф МСП", input.rates.insuranceReduced, PCT,
    "На часть зарплаты сверх МРОТ — для малого и среднего бизнеса.");
  ref.minWage = row("МРОТ, ₽", input.rates.minWage, MONEY, sources.minWage || "Проверьте МРОТ на год расчёта.");
  ref.vatThreshold = row("Порог выручки для НДС на УСН, ₽", input.rates.vatThreshold, MONEY,
    sources.vatThreshold || "Выше порога упрощенец платит НДС. Проверьте порог и ставки.");
  ref.discount = row("Ставка дисконтирования, годовая", input.rates.discountRate, PCT,
    "Во сколько вы оцениваете стоимость денег и риск проекта.");
  r += 1;

  r = title(ws, r, "ИНФЛЯЦИЯ ПО ГОДАМ");
  ws.getCell(r, 1).value = sources.inflation || "Источник не указан — проверьте значения.";
  r += 1;
  r = header(ws, r, ["Год", "Рост к предыдущему году", "Накопленный индекс"]);
  ref.inflFirst = r;
  for (let y = 0; y < input.horizonYears; y++) {
    ws.getCell(r, 1).value = input.startYear + y;
    editable(ws, r, 2, input.inflation[y], PCT);
    if (y === 0) {
      ws.getCell(r, 3).value = 1;
    } else {
      ws.getCell(r, 3).value = { formula: `C${r - 1}*(1+B${r})` };
    }
    ws.getCell(r, 3).numFmt = COEF;
    r += 1;
  }
  ref.idx = (y) => `${SHEET_RATES}!$C$${ref.inflFirst + y}`;
  return ref;
}

const COLS = {
  month: 1, season: 2, ramp: 3, units: 4, price: 5, revenue: 6, cogs: 7, gross: 8,
  salary: 9, percentPay: 10, insurance: 11, fixed: 12, variable: 13, ebitda: 14,
  tax: 15, minTop: 16, vat: 17, net: 18, flow: 19, cumulative: 20, discounted: 21,
};
const L = (n) => {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};

/**
 * Расчётный лист одного сценария: месяц — строка, статья — колонка.
 *
 * Правила, которые по закону работают за год, а не за месяц, вынесены в
 * отдельные колонки: доплата до минимального налога и НДС при превышении порога
 * считаются от годовой выручки. Складывать их в ту же колонку, что и месячный
 * налог, нельзя — формула начала бы ссылаться сама на себя.
 */
function writeScenarioSheet(wb, input, name, scenarioRef, inRef, ratesRef) {
  const ws = wb.addWorksheet(name);
  const regime = regimeById(input.tax.regime);
  const IN = `${SHEET_IN}!`;
  const RT = `${SHEET_RATES}!`;

  ws.getColumn(1).width = 16;
  for (let c = 2; c <= 21; c++) ws.getColumn(c).width = 14;

  let r = 1;
  ws.getCell(r, 1).value = `${name} — ${input.projectName}`;
  ws.getCell(r, 1).font = { bold: true, size: 13 };
  r += 2;

  const invRow = r;
  ws.getCell(r, 1).value = "Инвестиции";
  ws.getCell(r, COLS.flow).value = { formula: `-${IN}${inRef.investTotal}` };
  ws.getCell(r, COLS.cumulative).value = { formula: `${L(COLS.flow)}${r}` };
  ws.getCell(r, COLS.discounted).value = { formula: `${L(COLS.flow)}${r}` };
  for (const c of [COLS.flow, COLS.cumulative, COLS.discounted]) ws.getCell(r, c).numFmt = MONEY;
  r += 1;

  const headRow = r;
  r = header(ws, r, [
    "Месяц", "Сезонность", "Раскрутка", "Объём, ед.", "Цена, ₽", "Выручка",
    "Себестоимость", "Валовая прибыль", "Оклады", "Оплата % от продаж",
    "Страховые взносы", "Постоянные расходы", "Переменные расходы", "EBITDA",
    "Налог", "Доплата до мин. налога", "НДС", "Чистая прибыль",
    "Денежный поток", "Накопленным итогом", "Дисконтированный поток",
  ]);
  const firstRow = r;

  // Вспомогательные колонки: взносы по каждой должности отдельно. Ступень по
  // МРОТ одной формулой на весь штат не выражается, а прятать её в число —
  // значит лишить человека возможности проверить ФОТ.
  const helpCol = 23;
  const payroll = input.payroll.length ? input.payroll : [{ role: "—", count: 0, salary: 0, percentOfSales: 0 }];
  const insuranceMode =
    regime.id === "ausn6" || regime.id === "ausn20" || regime.id === "npd"
      ? "none"
      : input.rates.useReducedInsurance
        ? "tiered"
        : "flat";
  ws.getCell(headRow, helpCol - 1).value = "Взносы по должностям:";
  ws.getCell(headRow, helpCol - 1).font = { bold: true };
  payroll.forEach((p, i) => {
    const c = ws.getCell(headRow, helpCol + i);
    c.value = p.role || `Должность ${i + 1}`;
    c.font = { bold: true };
    c.fill = HEAD_FILL;
    ws.getColumn(helpCol + i).width = 18;
  });

  // Годовые суммы — тоже на этом же листе, чтобы лист был самодостаточным.
  const yearCol = helpCol + payroll.length + 1;
  ws.getColumn(yearCol).width = 10;
  ws.getColumn(yearCol + 1).width = 18;
  ws.getCell(headRow, yearCol).value = "Год";
  ws.getCell(headRow, yearCol + 1).value = "Выручка за год";
  ws.getCell(headRow, yearCol).font = { bold: true };
  ws.getCell(headRow, yearCol + 1).font = { bold: true };

  const totalMonths = input.horizonYears * 12;
  const yearRevCell = (y) => `$${L(yearCol + 1)}$${firstRow + y}`;

  for (let t = 0; t < totalMonths; t++) {
    const y = Math.floor(t / 12);
    const calMonth = (input.startMonth - 1 + t) % 12;
    const idx = ratesRef.idx(y);
    const priceIdx = input.indexPrice ? idx : "1";
    const row = firstRow + t;
    const at = (key) => `${L(COLS[key])}${row}`;

    ws.getCell(row, COLS.month).value =
      `${MONTHS[calMonth]} ${input.startYear + Math.floor((input.startMonth - 1 + t) / 12)}`;
    ws.getCell(row, COLS.season).value = { formula: `${IN}$B$${inRef.seasonFirst + calMonth}` };
    ws.getCell(row, COLS.ramp).value = { formula: `${IN}$B$${inRef.rampFirst + t}` };
    ws.getCell(row, COLS.units).value = {
      formula: `${IN}${inRef.baseVolume}*${at("season")}*${at("ramp")}*${IN}${scenarioRef}`,
    };
    ws.getCell(row, COLS.price).value = { formula: `${IN}${inRef.price}*${priceIdx}` };
    ws.getCell(row, COLS.revenue).value = { formula: `${at("units")}*${at("price")}` };
    ws.getCell(row, COLS.cogs).value = { formula: `${at("units")}*${IN}${inRef.unitCost}*${idx}` };
    ws.getCell(row, COLS.gross).value = { formula: `${at("revenue")}-${at("cogs")}` };
    ws.getCell(row, COLS.salary).value = { formula: `${IN}${inRef.salaryFund}*${idx}` };
    ws.getCell(row, COLS.percentPay).value = {
      formula: `${at("revenue")}*${IN}${inRef.salesPercent}/100`,
    };

    // Взносы по должностям.
    payroll.forEach((p, i) => {
      const cnt = `${IN}$B$${inRef.payrollFirst + i}`;
      const sal = `${IN}$C$${inRef.payrollFirst + i}`;
      const pct = `${IN}$D$${inRef.payrollFirst + i}`;
      const per = `(${sal}*${idx}+${at("revenue")}*${pct}/100/MAX(1,${cnt}))`;
      let f;
      if (insuranceMode === "none") f = "0";
      else if (insuranceMode === "flat") f = `${cnt}*${per}*${RT}${ratesRef.insurance}`;
      else
        f =
          `${cnt}*IF(${per}<=${RT}${ratesRef.minWage},${per}*${RT}${ratesRef.insurance},` +
          `${RT}${ratesRef.minWage}*${RT}${ratesRef.insurance}+(${per}-${RT}${ratesRef.minWage})*${RT}${ratesRef.insuranceReduced})`;
      const cell = ws.getCell(row, helpCol + i);
      cell.value = { formula: f };
      cell.numFmt = MONEY;
    });
    ws.getCell(row, COLS.insurance).value = {
      formula: `SUM(${L(helpCol)}${row}:${L(helpCol + payroll.length - 1)}${row})`,
    };

    ws.getCell(row, COLS.fixed).value = { formula: `${IN}${inRef.fixedTotal}*${idx}` };
    ws.getCell(row, COLS.variable).value = {
      formula:
        `${IN}${inRef.varMonth}*${idx}+${IN}${inRef.varUnit}*${at("units")}*${idx}` +
        `+${at("revenue")}*${IN}${inRef.varRevenue}/100`,
    };
    ws.getCell(row, COLS.ebitda).value = {
      formula: `${at("gross")}-${at("salary")}-${at("percentPay")}-${at("insurance")}-${at("fixed")}-${at("variable")}`,
    };

    const expenses = `(${at("cogs")}+${at("salary")}+${at("percentPay")}+${at("insurance")}+${at("fixed")}+${at("variable")})`;
    const rate = `${RT}${ratesRef.taxRate}`;
    let taxFormula = "0";
    if (regime.id === "usn6") {
      const cap = input.tax.ipWithoutStaff
        ? `${at("revenue")}*${rate}`
        : `${at("revenue")}*${rate}*0.5`;
      taxFormula = `MAX(0,${at("revenue")}*${rate}-MIN(${at("insurance")},${cap}))`;
    } else if (regime.id === "usn15" || regime.id === "ausn20" || regime.id === "osno") {
      taxFormula = `MAX(0,(${at("revenue")}-${expenses})*${rate})`;
    } else if (regime.id === "psn") {
      taxFormula = `${RT}${ratesRef.patent}/12`;
    } else if (regime.id === "npd") {
      taxFormula = `${at("revenue")}*${input.tax.npdLegal ? 0.06 : 0.04}`;
    } else if (regime.id === "ausn6") {
      taxFormula = `${at("revenue")}*${rate}`;
    }
    ws.getCell(row, COLS.tax).value = { formula: taxFormula };

    // Доплата до минимального налога — только в последнем месяце года.
    const isDec = t % 12 === 11 || t === totalMonths - 1;
    if (regime.minRate && isDec) {
      const from = firstRow + y * 12;
      ws.getCell(row, COLS.minTop).value = {
        formula:
          `MAX(0,${yearRevCell(y)}*${RT}${ratesRef.minRate}-SUM(${L(COLS.tax)}${from}:${L(COLS.tax)}${row}))`,
      };
    } else {
      ws.getCell(row, COLS.minTop).value = 0;
    }

    // НДС: на упрощёнке — при превышении годового порога, на ОСНО — всегда.
    let vatFormula = "0";
    if (regime.id === "osno") {
      vatFormula = input.tax.priceIncludesVat
        ? `${at("revenue")}-${at("revenue")}/(1+${regime.vat})`
        : `${at("revenue")}*${regime.vat}`;
    } else if (regime.id === "usn6" || regime.id === "usn15") {
      vatFormula =
        `IF(${yearRevCell(y)}>${RT}${ratesRef.vatThreshold},${at("revenue")}*` +
        `IF(${yearRevCell(y)}<=${input.rates.vatLowLimit},${input.rates.vatRateLow},${input.rates.vatRateMid}),0)`;
    }
    ws.getCell(row, COLS.vat).value = { formula: vatFormula };

    ws.getCell(row, COLS.net).value = {
      formula: `${at("ebitda")}-${at("tax")}-${at("minTop")}-${at("vat")}`,
    };
    ws.getCell(row, COLS.flow).value = { formula: at("net") };
    // Первый месяц продолжает строку инвестиций, а не строку заголовка: над ним
    // лежит шапка таблицы, и ссылка на неё давала #VALUE! в первой же ячейке.
    ws.getCell(row, COLS.cumulative).value = {
      formula: `${L(COLS.cumulative)}${t === 0 ? invRow : row - 1}+${at("flow")}`,
    };
    ws.getCell(row, COLS.discounted).value = {
      formula: `${at("flow")}/(1+${RT}${ratesRef.discount}/12)^${t + 1}`,
    };

    for (const c of [COLS.units, COLS.price, COLS.revenue, COLS.cogs, COLS.gross, COLS.salary,
      COLS.percentPay, COLS.insurance, COLS.fixed, COLS.variable, COLS.ebitda, COLS.tax,
      COLS.minTop, COLS.vat, COLS.net, COLS.flow, COLS.cumulative, COLS.discounted]) {
      ws.getCell(row, c).numFmt = MONEY;
    }
    ws.getCell(row, COLS.season).numFmt = COEF;
    ws.getCell(row, COLS.ramp).numFmt = COEF;
  }

  // Годовые суммы выручки — на них ссылаются НДС и минимальный налог.
  for (let y = 0; y < input.horizonYears; y++) {
    const from = firstRow + y * 12;
    const to = Math.min(firstRow + y * 12 + 11, firstRow + totalMonths - 1);
    ws.getCell(firstRow + y, yearCol).value = input.startYear + y;
    ws.getCell(firstRow + y, yearCol + 1).value = {
      formula: `SUM(${L(COLS.revenue)}${from}:${L(COLS.revenue)}${to})`,
    };
    ws.getCell(firstRow + y, yearCol + 1).numFmt = MONEY;
  }

  const lastRow = firstRow + totalMonths - 1;
  const totalRow = lastRow + 1;
  ws.getCell(totalRow, 1).value = "ИТОГО за горизонт";
  ws.getCell(totalRow, 1).font = { bold: true };
  for (const key of ["units", "revenue", "cogs", "gross", "salary", "percentPay", "insurance",
    "fixed", "variable", "ebitda", "tax", "minTop", "vat", "net"]) {
    const c = ws.getCell(totalRow, COLS[key]);
    c.value = { formula: `SUM(${L(COLS[key])}${firstRow}:${L(COLS[key])}${lastRow})` };
    c.numFmt = MONEY;
    c.fill = TOTAL_FILL;
    c.font = { bold: true };
  }
  return { firstRow, lastRow, totalRow, invRow, sheet: name };
}

/**
 * Итоги и сравнение сценариев.
 *
 * Всё, что можно выразить формулой, выражено формулой — иначе, поправив цену,
 * человек увидит новую выручку и старую окупаемость. Внутренняя норма
 * доходности решается подбором, встроенный движок её не умеет, поэтому она
 * записана числом и прямо помечена как посчитанная приложением.
 */
function writeSummary(wb, input, marks, computed, inRef, ratesRef) {
  const ws = wb.addWorksheet(SHEET_SUM);
  ws.getColumn(1).width = 48;
  for (let c = 2; c <= 4; c++) ws.getColumn(c).width = 20;
  const IN = `${SHEET_IN}!`;
  const RT = `${SHEET_RATES}!`;

  let r = 1;
  ws.getCell(r, 1).value = `Итоги — ${input.projectName}`;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r += 2;

  // Постоянная часть расходов — для точки безубыточности. По одной строке на
  // должность: ступень взносов по МРОТ иначе не показать.
  r = title(ws, r, "ПОСТОЯННАЯ ЧАСТЬ РАСХОДОВ В МЕСЯЦ");
  const constFirst = r;
  ws.getCell(r, 1).value = "Оклады";
  ws.getCell(r, 2).value = { formula: `${IN}${inRef.salaryFund}` };
  r += 1;
  const payroll = input.payroll.length ? input.payroll : [{ role: "—", count: 0, salary: 0 }];
  const insuranceMode =
    ["ausn6", "ausn20", "npd"].includes(input.tax.regime)
      ? "none"
      : input.rates.useReducedInsurance
        ? "tiered"
        : "flat";
  payroll.forEach((p, i) => {
    const cnt = `${IN}$B$${inRef.payrollFirst + i}`;
    const sal = `${IN}$C$${inRef.payrollFirst + i}`;
    let f;
    if (insuranceMode === "none") f = "0";
    else if (insuranceMode === "flat") f = `${cnt}*${sal}*${RT}${ratesRef.insurance}`;
    else
      f =
        `${cnt}*IF(${sal}<=${RT}${ratesRef.minWage},${sal}*${RT}${ratesRef.insurance},` +
        `${RT}${ratesRef.minWage}*${RT}${ratesRef.insurance}+(${sal}-${RT}${ratesRef.minWage})*${RT}${ratesRef.insuranceReduced})`;
    ws.getCell(r, 1).value = `Взносы — ${p.role || `должность ${i + 1}`}`;
    ws.getCell(r, 2).value = { formula: f };
    r += 1;
  });
  ws.getCell(r, 1).value = "Постоянные расходы";
  ws.getCell(r, 2).value = { formula: `${IN}${inRef.fixedTotal}` };
  r += 1;
  ws.getCell(r, 1).value = "Переменные с фикс. суммой в месяц";
  ws.getCell(r, 2).value = { formula: `${IN}${inRef.varMonth}` };
  r += 1;
  ws.getCell(r, 1).value = "ИТОГО постоянная часть";
  ws.getCell(r, 1).font = { bold: true };
  ws.getCell(r, 2).value = { formula: `SUM(B${constFirst}:B${r - 1})` };
  ws.getCell(r, 2).fill = TOTAL_FILL;
  const constTotal = `$B$${r}`;
  for (let i = constFirst; i <= r; i++) ws.getCell(i, 2).numFmt = MONEY;
  r += 2;

  r = title(ws, r, "ЭКОНОМИКА ЕДИНИЦЫ");
  ws.getCell(r, 1).value = "Маржа с единицы после переменных расходов, ₽";
  ws.getCell(r, 2).value = {
    formula:
      `${IN}${inRef.price}-${IN}${inRef.unitCost}-${IN}${inRef.varUnit}` +
      `-${IN}${inRef.price}*${IN}${inRef.varRevenue}/100`,
  };
  ws.getCell(r, 2).numFmt = MONEY;
  const marginCell = `$B$${r}`;
  r += 1;
  ws.getCell(r, 1).value = "Точка безубыточности, ед./мес";
  ws.getCell(r, 2).value = {
    formula: `IF(${marginCell}<=0,"маржа не покрывает переменные расходы",${constTotal}/${marginCell})`,
  };
  ws.getCell(r, 2).numFmt = MONEY;
  r += 1;
  ws.getCell(r, 1).value = "Точка безубыточности, ₽/мес";
  ws.getCell(r, 2).value = {
    formula: `IF(${marginCell}<=0,"—",${constTotal}/${marginCell}*${IN}${inRef.price})`,
  };
  ws.getCell(r, 2).numFmt = MONEY;
  r += 2;

  r = title(ws, r, "СЦЕНАРИИ");
  r = header(ws, r, ["Показатель", "Пессимистичный", "Базовый", "Оптимистичный"]);
  const order = ["pess", "base", "opt"];
  const line = (label, make, fmt = MONEY) => {
    ws.getCell(r, 1).value = label;
    order.forEach((key, i) => {
      const cell = ws.getCell(r, i + 2);
      cell.value = make(marks[key], computed[key]);
      cell.numFmt = fmt;
    });
    r += 1;
  };

  const col = (m, key) => `'${m.sheet}'!${L(COLS[key])}${m.totalRow}`;
  line("Выручка за горизонт", (m) => ({ formula: col(m, "revenue") }));
  line("Валовая прибыль", (m) => ({ formula: col(m, "gross") }));
  line("Налоги и НДС", (m) => ({
    formula: `${col(m, "tax")}+${col(m, "minTop")}+${col(m, "vat")}`,
  }));
  line("Чистая прибыль за горизонт", (m) => ({ formula: col(m, "net") }));
  line("Инвестиции", () => ({ formula: `${IN}${inRef.investTotal}` }));
  line("Накопленный итог на конец горизонта", (m) => ({
    formula: `'${m.sheet}'!${L(COLS.cumulative)}${m.lastRow}`,
  }));
  line(
    "Окупаемость, мес. (пока накопленный итог в минусе)",
    (m) => ({
      formula: `COUNTIF('${m.sheet}'!${L(COLS.cumulative)}${m.firstRow}:${L(COLS.cumulative)}${m.lastRow},"<0")`,
    }),
    "0"
  );
  line("NPV (чистая приведённая стоимость)", (m) => ({
    formula: `SUM('${m.sheet}'!${L(COLS.discounted)}${m.invRow}:${L(COLS.discounted)}${m.lastRow})`,
  }));
  line(
    "IRR, годовая — посчитана приложением, не формулой",
    (_m, res) => (res.irr === null ? "не определяется" : res.irr),
    PCT
  );
  line(
    "Рентабельность по чистой прибыли",
    (m) => ({ formula: `IF(${col(m, "revenue")}=0,0,${col(m, "net")}/${col(m, "revenue")})` }),
    PCT
  );
  r += 1;
  ws.getCell(r, 1).value =
    "IRR решается подбором, встроенный просмотрщик приложения такую функцию не считает. " +
    "В Excel её можно проверить формулой ВСД по колонке «Денежный поток».";
  return ws;
}

/** Заключение экономиста — текстом, как его написал агент. */
function writeAdvice(wb, input, advice) {
  const ws = wb.addWorksheet(SHEET_ADVICE);
  ws.getColumn(1).width = 120;
  let r = 1;
  ws.getCell(r, 1).value = `Заключение экономиста — ${input.projectName}`;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r += 2;
  const text = String(advice || "").trim();
  if (!text) {
    ws.getCell(r, 1).value = "Заключение не запрашивалось.";
    return ws;
  }
  for (const para of text.split(/\n/)) {
    const cell = ws.getCell(r, 1);
    cell.value = para;
    cell.alignment = { wrapText: true, vertical: "top" };
    if (/^[А-ЯЁA-Z0-9][^a-zа-яё]*$/.test(para.trim()) && para.trim().length > 3) {
      cell.font = { bold: true };
    }
    r += 1;
  }
  return ws;
}

/**
 * Собирает книгу и кладёт её в указанную папку. Ничего не копирует внутрь
 * приложения: путь приходит снаружи, файл остаётся у человека.
 */
async function save(raw, { destDir, fileName, advice = "", sources = {} } = {}) {
  const ExcelJS = require("exceljs");
  const computed = compute(raw);
  const input = computed.input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Личный чат";
  wb.created = new Date();

  const inRef = writeInputs(wb, input);
  const ratesRef = writeRates(wb, input, sources);
  const marks = {
    pess: writeScenarioSheet(wb, input, "Расчёт песс", inRef.scenPess, inRef, ratesRef),
    base: writeScenarioSheet(wb, input, "Расчёт база", inRef.scenBase, inRef, ratesRef),
    opt: writeScenarioSheet(wb, input, "Расчёт опт", inRef.scenOpt, inRef, ratesRef),
  };
  writeSummary(wb, input, marks, computed, inRef, ratesRef);
  writeAdvice(wb, input, advice);

  const safe = (fileName || `Финмодель — ${input.projectName}`)
    .replace(/[\\/:*?"<>|]/g, " ")
    .trim();
  const dest = path.join(destDir, safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`);
  await fs.mkdir(destDir, { recursive: true });
  await wb.xlsx.writeFile(dest);
  return { path: dest, computed };
}

module.exports.writeInputs = writeInputs;
module.exports.writeRates = writeRates;
module.exports.writeScenarioSheet = writeScenarioSheet;
module.exports.writeSummary = writeSummary;
module.exports.save = save;
module.exports.COLS = COLS;
module.exports.L = L;

// ---------------------------------------------------------------------------
// Агент
//
// Два прохода, и порядок здесь важен. В первом агент читает статистику и
// достаёт из неё то, что нельзя вычислить формулой: сезонность, скорость выхода
// на мощность, базовый объём, актуальные ставки и инфляцию из официальных
// источников. Во втором он видит УЖЕ ПОСЧИТАННУЮ модель и пишет по ней
// заключение. Если поменять проходы местами, заключение будет написано по
// придуманным числам — а это ровно то, ради чего финмодель не делают.

const money = (v) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v || 0));

/** Первый проход: вытащить кривую спроса из данных и найти официальные ставки. */
function buildParamsPrompt({ input, dataPaths = [], searchRates = true }) {
  const horizon = input.horizonYears * 12;
  const lines = [
    "Ты аналитик. Тебе нужно подготовить исходные допущения для финансовой модели.",
    "",
    `Проект: ${input.projectName}`,
    `Продукт: ${input.productName}, цена ${money(input.price)} ₽ за единицу.`,
    `Горизонт: ${input.horizonYears} лет, старт — ${MONTHS[input.startMonth - 1]} ${input.startYear}.`,
  ];
  if (input.notes) lines.push("", "Особенности бизнес-модели, как их описал человек:", input.notes);

  if (dataPaths.length) {
    lines.push(
      "",
      "ДАННЫЕ. Прочитай эти файлы инструментом чтения файлов и опирайся на них:",
      ...dataPaths.map((p) => `  ${p}`),
      "",
      "Если это выгрузка продаж — считай сезонность прямо по ней.",
      "Если это выгрузка Вордстата (частота запросов по месяцам) — продаж там нет, есть спрос.",
      "Из динамики запросов выводи ФОРМУ кривой: сезонность и скорость роста. Сам уровень",
      "продаж из Вордстата не берётся — его задаёт человек базовым объёмом, а ты можешь",
      "предложить свою оценку и объяснить, из чего она вышла."
    );
  } else {
    lines.push(
      "",
      "Файлов со статистикой нет. Опирайся на отраслевые ориентиры и прямо скажи,",
      "что это оценка, а не расчёт по данным."
    );
  }

  if (searchRates) {
    lines.push(
      "",
      "ОФИЦИАЛЬНЫЕ ДАННЫЕ. Найди поиском в интернете и укажи с источником:",
      "  — инфляцию: фактическую за последний год и официальный прогноз/цель на годы модели",
      "    (Росстат, Банк России, Минэкономразвития);",
      "  — действующий МРОТ на год старта;",
      "  — актуальную ставку по выбранной системе налогообложения и порог выручки для НДС.",
      "Если что-то найти не удалось — так и напиши, не выдумывай цифру."
    );
  }

  lines.push(
    "",
    "ОТВЕТ. Сначала коротко объясни, из чего вышли числа. Затем — блок ровно в таком виде:",
    "",
    "===ФИНМОДЕЛЬ ДАННЫЕ===",
    "БАЗОВЫЙ ОБЪЁМ: <число единиц в месяц при полной мощности в средний сезон>",
    "СЕЗОННОСТЬ: <12 чисел через запятую, январь…декабрь, среднее около 1>",
    `РАСКРУТКА: <${horizon} чисел через запятую — доля от базового объёма по месяцам проекта>`,
    `ИНФЛЯЦИЯ: <${input.horizonYears} чисел через запятую в процентах, первый год базовый>`,
    "МРОТ: <число или пусто>",
    "ИСТОЧНИК ИНФЛЯЦИИ: <откуда взято>",
    "ИСТОЧНИК МРОТ: <откуда взято>",
    "КОММЕНТАРИЙ: <одной строкой: на чём основаны допущения>",
    "===КОНЕЦ===",
    "",
    "Чисел в списках должно быть ровно столько, сколько запрошено. Разделитель — запятая,",
    "дробная часть — через точку. Без markdown внутри блока."
  );
  return lines.join("\n");
}

function parseNumberList(text, count) {
  if (!text) return null;
  const parts = String(text)
    .split(/[,;]/)
    .map((s) => Number(String(s).trim().replace("%", "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  return Array.from({ length: count }, (_, i) => (i < parts.length ? parts[i] : parts[parts.length - 1]));
}

/** Разбор ответа первого прохода. Возвращает null, если блока нет. */
function parseParams(text, input) {
  const body = String(text || "");
  const m = /===ФИНМОДЕЛЬ ДАННЫЕ===([\s\S]*?)===КОНЕЦ===/i.exec(body);
  if (!m) return null;
  const block = m[1];
  const field = (name) => {
    const re = new RegExp(`^${name}:[^\\S\\r\\n]*(.*)$`, "im");
    const found = re.exec(block);
    return found ? found[1].trim() : "";
  };

  const horizon = input.horizonYears * 12;
  const seasonality = parseNumberList(field("СЕЗОННОСТЬ"), 12);
  const rampUp = parseNumberList(field("РАСКРУТКА"), horizon);
  const inflationPct = parseNumberList(field("ИНФЛЯЦИЯ"), input.horizonYears);
  const baseVolume = Number(String(field("БАЗОВЫЙ ОБЪЁМ")).replace(/\s/g, "").replace(",", "."));
  const minWage = Number(String(field("МРОТ")).replace(/\s/g, "").replace(",", "."));

  return {
    baseVolume: Number.isFinite(baseVolume) && baseVolume > 0 ? baseVolume : null,
    seasonality,
    rampUp,
    // Проценты приходят как «4» или «4.5», а расчёту нужна доля.
    inflation: inflationPct ? inflationPct.map((v) => (Math.abs(v) > 1 ? v / 100 : v)) : null,
    minWage: Number.isFinite(minWage) && minWage > 0 ? minWage : null,
    sources: {
      inflation: field("ИСТОЧНИК ИНФЛЯЦИИ"),
      minWage: field("ИСТОЧНИК МРОТ"),
    },
    comment: field("КОММЕНТАРИЙ"),
  };
}

/** Второй проход: заключение по уже посчитанным числам. */
function buildAdvicePrompt(computed) {
  const input = computed.input;
  const regime = regimeById(input.tax.regime);
  const scen = (name, r) => {
    const y1 = r.years[0];
    return [
      `${name}:`,
      `  выручка за горизонт ${money(r.totalRevenue)} ₽, чистая прибыль ${money(r.totalNet)} ₽`,
      `  первый год: выручка ${money(y1.revenue)} ₽, EBITDA ${money(y1.ebitda)} ₽, налоги ${money(y1.tax + y1.vat)} ₽, чистая ${money(y1.net)} ₽`,
      `  окупаемость: ${r.payback ? `${r.payback.months} мес. (${r.payback.label})` : "за горизонт не наступает"}`,
      `  NPV ${money(r.npv)} ₽, IRR ${r.irr === null ? "не определяется" : (r.irr * 100).toFixed(1) + "%"}`,
      `  точка безубыточности: ${r.breakEvenUnits === null ? "не достигается — маржа не покрывает переменные расходы" : `${money(r.breakEvenUnits)} ед./мес (${money(r.breakEvenRevenue)} ₽)`}`,
    ].join("\n");
  };

  return [
    "Ты экономист. Ниже — ПОСЧИТАННАЯ финансовая модель. Числа менять нельзя: они получены",
    "расчётом, а не оценкой. Твоя работа — прочитать их и дать заключение.",
    "",
    `Проект: ${input.projectName}. Продукт: ${input.productName}.`,
    `Цена ${money(input.price)} ₽, себестоимость ${money(input.unitCost)} ₽, маржа ${money(input.price - input.unitCost)} ₽ (${input.price ? (((input.price - input.unitCost) / input.price) * 100).toFixed(1) : 0}%).`,
    `Маржа после переменных расходов: ${money(computed.base.marginPerUnit)} ₽ с единицы.`,
    `Система налогообложения: ${regime.name}.`,
    `Инвестиции: ${money(computed.base.investment)} ₽.`,
    input.notes ? `\nОсобенности бизнес-модели: ${input.notes}` : "",
    "",
    scen("ПЕССИМИСТИЧНЫЙ", computed.pess),
    scen("БАЗОВЫЙ", computed.base),
    scen("ОПТИМИСТИЧНЫЙ", computed.opt),
    "",
    "Напиши заключение по такой структуре, обычным текстом без markdown-разметки:",
    "",
    "ВЕРДИКТ — стоит ли браться, одним абзацем и без обтекаемых формулировок.",
    "ЧТО ДЕРЖИТ МОДЕЛЬ — за счёт чего она сходится или не сходится: маржа, объём, ФОТ, налоги.",
    "ГЛАВНЫЕ РИСКИ — 3–5 штук, с указанием, какая цифра при этом ломается и насколько.",
    "ЧТО ИЗМЕНИТЬ — конкретные рычаги с числами: на сколько поднять цену, срезать расходы,",
    "  ускорить раскрутку, чтобы окупаемость уложилась в разумный срок.",
    "ЧЕГО НЕ ХВАТАЕТ В ДАННЫХ — что человек не задал и из-за чего расчёт может врать.",
    "",
    "Оперируй числами из расчёта, а не общими словами. Если модель убыточна — скажи это прямо",
    "и посчитай, при каком объёме или цене она выходит в ноль.",
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports.buildParamsPrompt = buildParamsPrompt;
module.exports.parseParams = parseParams;
module.exports.buildAdvicePrompt = buildAdvicePrompt;
module.exports.parseNumberList = parseNumberList;
