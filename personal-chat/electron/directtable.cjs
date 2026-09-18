/**
 * Одна таблица кампаний по всем подключённым аккаунтам.
 *
 * В самом Директе аккаунты живут порознь: чтобы сравнить кампанию из одного с
 * кампанией из другого, надо выйти и зайти заново. Здесь они сведены в один
 * список — ровно ради того, чтобы сравнение было видно глазами, без пересчёта
 * в голове.
 *
 * Считается всё тоже здесь, а не моделью. Причина та же, что и в разборе:
 * ДРР и ROI — это числа, по которым отключают кампании, и они должны
 * получаться одинаково каждый раз. Модель подключается уже поверх готовых
 * чисел, чтобы объяснить, откуда они взялись.
 */

function num(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Делит, не выдумывая результат там, где делить не на что. */
function ratio(верх, низ, множитель = 1) {
  const a = num(верх);
  const b = num(низ);
  if (!b) return null;
  return (a / b) * множитель;
}

/**
 * Состояния кампании так, как их называет Директ.
 *
 * Фильтры в интерфейсе Директа устроены не по одному полю: «идут показы» — это
 * и state, и status, и оплата одновременно. Поэтому состояние сводится к одному
 * понятному слову здесь, а не в вёрстке.
 */
const STATES = [
  { id: "все", title: "Все" },
  { id: "показы", title: "Идут показы" },
  { id: "остановлена", title: "Остановлены" },
  { id: "модерация", title: "На модерации" },
  { id: "черновик", title: "Черновики" },
  { id: "отклонена", title: "Отклонены" },
  { id: "архив", title: "В архиве" },
];

function stateOf(campaign) {
  const state = String(campaign.state || "").toUpperCase();
  const status = String(campaign.status || "").toUpperCase();
  if (state === "ARCHIVED") return "архив";
  if (status === "DRAFT") return "черновик";
  if (status === "MODERATION") return "модерация";
  if (status === "REJECTED") return "отклонена";
  // Кампания может быть включена и принята модерацией — и всё равно не
  // показываться, потому что на счёте нет денег. В Директе такая кампания
  // тоже не считается работающей, и считать её работающей здесь значило бы
  // прятать самую дорогую причину простоя.
  if (String(campaign.statusPayment || "").toUpperCase() === "DISALLOWED") return "остановлена";
  if (state === "ON" && status === "ACCEPTED") return "показы";
  return "остановлена";
}

/** Почему кампания не показывается — то, что в Директе написано мелким текстом. */
function whyNotRunning(campaign) {
  const state = String(campaign.state || "").toUpperCase();
  const payment = String(campaign.statusPayment || "").toUpperCase();
  if (state === "ARCHIVED") return "Кампания в архиве — показы по ней не идут и не пойдут, пока её не разархивируют.";
  if (String(campaign.status || "").toUpperCase() === "DRAFT") return "Черновик: кампания ещё не отправлена на модерацию.";
  if (String(campaign.status || "").toUpperCase() === "MODERATION") return "Кампания на модерации — показы начнутся после проверки.";
  if (String(campaign.status || "").toUpperCase() === "REJECTED") return "Модерация отклонила кампанию: показов не будет, пока замечания не исправлены.";
  if (payment === "DISALLOWED") return "Показы запрещены по оплате: на счёте не хватает денег.";
  if (state === "SUSPENDED") return "Кампания остановлена вручную.";
  if (state === "OFF") return "Кампания выключена.";
  return "";
}

/**
 * Столбцы таблицы.
 *
 * `explain` — не украшение. По клику в ячейку человек спрашивает «почему такое
 * значение», и ответ должен начинаться с того, что этот показатель вообще
 * означает и из чего складывается; дальше уже подключается модель с числами
 * конкретной кампании.
 */
const COLUMNS = [
  {
    id: "account",
    title: "Аккаунт",
    kind: "текст",
    group: "Кампания",
    explain: "Аккаунт Яндекса, которому принадлежит кампания. Деньги, модерация и статистика у каждого аккаунта свои.",
  },
  { id: "name", title: "Кампания", kind: "текст", group: "Кампания", explain: "Название кампании так, как оно задано в Директе." },
  {
    id: "state",
    title: "Статус",
    kind: "текст",
    group: "Кампания",
    explain:
      "Идут ли показы прямо сейчас. Статус складывается из трёх вещей сразу: включена ли кампания, прошла ли модерацию и хватает ли денег на счёте.",
  },
  {
    id: "strategy",
    title: "Бюджет и стратегия",
    kind: "текст",
    group: "Кампания",
    explain:
      "Дневной бюджет и тип кампании. Стратегия решает, за что Директ торгуется на аукционе: за клики, за конверсии или за долю показов — от этого зависят и цена клика, и стабильность расхода.",
  },
  {
    id: "placement",
    title: "Места",
    kind: "текст",
    group: "Кампания",
    explain:
      "Где показывается кампания: поиск, рекламная сеть (РСЯ) или и то и другое. Показатели поиска и сети сравнивать между собой нельзя: в сети CTR всегда ниже, а отказы выше — это нормально и не признак плохой кампании.",
  },
  { id: "startDate", title: "Начало", kind: "дата", group: "Кампания", explain: "Дата запуска кампании в Директе." },
  {
    id: "cost",
    title: "Расход, ₽",
    kind: "деньги",
    group: "Деньги",
    explain: "Сколько списано за выбранный период, с НДС. Это факт из отчёта Директа, а не прогноз.",
  },
  { id: "impressions", title: "Показы", kind: "число", group: "Трафик", explain: "Сколько раз объявления были показаны." },
  { id: "clicks", title: "Клики", kind: "число", group: "Трафик", explain: "Сколько раз по объявлениям перешли." },
  {
    id: "ctr",
    title: "CTR, %",
    kind: "процент",
    group: "Трафик",
    explain:
      "Клики, делённые на показы. Показывает, отвечает ли объявление запросу. В поиске нормой считают от 5–10 %, в сети 0,3–0,6 % — это разные шкалы. Низкий CTR в поиске почти всегда означает несовпадение запроса и текста объявления.",
  },
  {
    id: "cpc",
    title: "CPC, ₽",
    kind: "деньги",
    group: "Деньги",
    explain:
      "Средняя цена клика: расход, делённый на клики. Она не назначается, а получается на аукционе: чем выше CTR и качество объявления, тем дешевле обходится та же позиция.",
  },
  {
    id: "cpm",
    title: "Ср. цена 1000 показов, ₽",
    kind: "деньги",
    group: "Деньги",
    explain:
      "Расход на тысячу показов. Показывает, дорого ли достаётся сам охват. Растёт, когда аукцион разогрет или когда выбрана слишком узкая аудитория.",
  },
  {
    id: "conversions",
    title: "Конверсии",
    kind: "число",
    group: "Результат",
    explain:
      "Достижения целей Метрики за период. Считаются только те цели, которые выбраны в отчёте: если целей несколько, число зависит от того, какие из них учтены.",
  },
  {
    id: "conversionRate",
    title: "Конверсия, %",
    kind: "процент",
    group: "Результат",
    explain:
      "Конверсии, делённые на клики. Это показатель не рекламы, а связки «объявление — посадочная страница»: реклама приводит человека, а превращает его в заявку уже сайт.",
  },
  {
    id: "cpa",
    title: "CPA, ₽",
    kind: "деньги",
    group: "Результат",
    explain:
      "Цена одной конверсии: расход, делённый на конверсии. Главное число для оценки кампании — но только когда конверсий набралось хотя бы несколько десятков, иначе это случайность, а не цена.",
  },
  {
    id: "revenue",
    title: "Доход, ₽",
    kind: "деньги",
    group: "Результат",
    explain:
      "Доход из электронной коммерции Метрики. Появляется только если на сайте настроена передача стоимости заказа; без этого столбец останется пустым — и это настройка Метрики, а не сбой приложения.",
  },
  {
    id: "drr",
    title: "ДРР, %",
    kind: "процент",
    group: "Результат",
    explain:
      "Доля рекламных расходов: расход, делённый на доход. Отвечает на вопрос «сколько копеек рекламы в каждом рубле выручки». Считается только там, где Метрика передаёт доход.",
  },
  {
    id: "roi",
    title: "ROI, %",
    kind: "процент",
    group: "Результат",
    explain:
      "Возврат вложений: прибыль, делённая на расход. ROI 0 % — реклама вышла в ноль, отрицательный — работает в убыток. Считается по доходу из Метрики, поэтому наследует все её неточности.",
  },
  {
    id: "bounceRate",
    title: "Отказы, %",
    kind: "процент",
    group: "Качество",
    explain:
      "Доля визитов, где человек ушёл почти сразу. Высокие отказы при нормальном CTR — это разрыв между обещанием в объявлении и тем, что человек увидел на странице: не та цена, не тот город, долгая загрузка.",
  },
  {
    id: "pageviews",
    title: "Глубина просмотра",
    kind: "число",
    group: "Качество",
    explain: "Сколько страниц смотрит человек за визит. Косвенно говорит, попал ли он туда, куда рассчитывал.",
  },
];

/** Столбцы, которые видно сразу; остальные включаются галочками. */
const DEFAULT_COLUMNS = [
  "account",
  "name",
  "state",
  "cost",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "conversions",
  "cpa",
];

const MONEY_KINDS = new Set(["деньги"]);

/**
 * Сводит кампании и статистику всех аккаунтов в один список строк.
 *
 * Кампания без статистики остаётся в списке: «работает, но не потратила ни
 * рубля» — это как раз то, что нужно увидеть, а не то, что нужно спрятать.
 */
function buildRows(accounts, { goals = [] } = {}) {
  const rows = [];
  for (const account of accounts || []) {
    const byId = new Map();
    for (const row of account.stats || []) byId.set(String(row.CampaignId ?? ""), row);

    for (const campaign of account.campaigns || []) {
      const stat = byId.get(String(campaign.id)) || {};
      byId.delete(String(campaign.id));
      rows.push(makeRow(account, campaign, stat, goals));
    }
    // Статистика по кампании, которой нет в списке (например, удалённой):
    // деньги по ней потрачены настоящие, поэтому строка остаётся.
    for (const [id, stat] of byId) {
      rows.push(
        makeRow(
          account,
          { id: Number(id) || id, name: String(stat.CampaignName || `Кампания ${id}`), state: "", status: "" },
          stat,
          goals
        )
      );
    }
  }
  return rows;
}

function makeRow(account, campaign, stat, goals) {
  const cost = num(stat.Cost);
  const impressions = num(stat.Impressions);
  const clicks = num(stat.Clicks);
  const conversions = num(stat.Conversions);
  const revenue = num(stat.Revenue);
  const строка = {
    accountId: account.id,
    account: account.label || account.login || account.id,
    campaignId: campaign.id,
    name: campaign.name || "",
    state: stateOf(campaign),
    stateNote: whyNotRunning(campaign),
    strategy: [campaign.type || "", campaign.dailyBudget ? `бюджет ${campaign.dailyBudget} ₽/день` : ""]
      .filter(Boolean)
      .join(", "),
    placement: placementOf(campaign),
    startDate: campaign.startDate || "",
    cost,
    impressions,
    clicks,
    ctr: stat.Ctr !== undefined ? num(stat.Ctr) : ratio(clicks, impressions, 100),
    cpc: stat.AvgCpc !== undefined ? num(stat.AvgCpc) : ratio(cost, clicks),
    cpm: ratio(cost, impressions, 1000),
    conversions: stat.Conversions === undefined ? null : conversions,
    conversionRate: stat.ConversionRate !== undefined ? num(stat.ConversionRate) : ratio(conversions, clicks, 100),
    cpa: stat.CostPerConversion !== undefined ? num(stat.CostPerConversion) : ratio(cost, conversions),
    revenue: stat.Revenue === undefined ? null : revenue,
    drr: ratio(cost, revenue, 100),
    roi: stat.Profit !== undefined ? ratio(num(stat.Profit), cost, 100) : ratio(revenue - cost, cost, 100),
    bounceRate: stat.BounceRate === undefined ? null : num(stat.BounceRate),
    pageviews: stat.AvgPageviews === undefined ? null : num(stat.AvgPageviews),
  };
  // Конверсии по каждой выбранной цели — отдельными столбцами, как «Автоцель:
  // отправка формы» в самом Директе.
  for (const goal of goals) {
    const id = String(goal.id ?? goal);
    строка[`goal_${id}`] = stat[`Conversions_${id}`] === undefined ? null : num(stat[`Conversions_${id}`]);
  }
  return строка;
}

function placementOf(campaign) {
  const type = String(campaign.type || "").toUpperCase();
  if (type.includes("DYNAMIC") || type.includes("SMART") || type.includes("MOBILE_APP")) return "Поиск и сети";
  if (type === "TEXT_CAMPAIGN") return "Поиск и сети";
  if (type === "PERFORMANCE") return "Сети";
  return campaign.type || "";
}

/** Столбцы по целям — их набор зависит от аккаунта, поэтому строятся отдельно. */
function goalColumns(goals) {
  return (goals || []).map((goal) => ({
    id: `goal_${goal.id ?? goal}`,
    title: goal.name ? `Цель: ${goal.name}` : `Цель ${goal.id ?? goal}`,
    kind: "число",
    group: "Результат",
    explain:
      "Конверсии по одной конкретной цели Метрики. Разбивка по целям показывает, приводит ли кампания именно те действия, ради которых она запущена, а не любые.",
  }));
}

/** Отбор по состоянию — тот же, что в интерфейсе Директа. */
function filterRows(rows, { state = "все", accountIds = [], search = "" } = {}) {
  const запрос = String(search || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (state && state !== "все" && row.state !== state) return false;
    if (accountIds.length && !accountIds.includes(row.accountId)) return false;
    if (запрос && !String(row.name || "").toLowerCase().includes(запрос)) return false;
    return true;
  });
}

/** Итоги по отобранным строкам: суммы складываются, доли пересчитываются. */
function totalsOf(rows) {
  const сумма = (поле) => (rows || []).reduce((acc, row) => acc + num(row[поле]), 0);
  const cost = сумма("cost");
  const clicks = сумма("clicks");
  const impressions = сумма("impressions");
  const conversions = сумма("conversions");
  const revenue = сумма("revenue");
  return {
    campaigns: (rows || []).length,
    cost,
    impressions,
    clicks,
    conversions,
    revenue,
    // Средние нельзя усреднять — их пересчитывают по суммам, иначе маленькая
    // кампания весит столько же, сколько основная.
    ctr: ratio(clicks, impressions, 100),
    cpc: ratio(cost, clicks),
    cpm: ratio(cost, impressions, 1000),
    conversionRate: ratio(conversions, clicks, 100),
    cpa: ratio(cost, conversions),
    drr: ratio(cost, revenue, 100),
    roi: ratio(revenue - cost, cost, 100),
  };
}

function formatValue(value, kind) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "текст" || kind === "дата") return String(value);
  const n = num(value);
  if (MONEY_KINDS.has(kind)) return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (kind === "процент") return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

module.exports = {
  COLUMNS,
  DEFAULT_COLUMNS,
  STATES,
  stateOf,
  whyNotRunning,
  buildRows,
  goalColumns,
  filterRows,
  totalsOf,
  formatValue,
};
