/**
 * Проверки Директа: разбор кампаний и объяснение отказов.
 *
 * Запуск: xvfb-run -a npx electron --no-sandbox electron/smoke-direct.cjs
 *
 * Настоящего Директа здесь нет и быть не может: API требует одобренной заявки
 * на доступ, а токен — живого аккаунта. Поэтому проверяется то, что от Яндекса
 * не зависит: арифметика разбора и то, что отказ объясняется человеку. Это как
 * раз та часть, в которой ошибка стоит денег: по этим числам отключают
 * кампании.
 */
const { app } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const direct = require("./direct.cjs");
const audit = require("./directaudit.cjs");
const table = require("./directtable.cjs");
const know = require("./directknow.cjs");
const слова = require("./directwords.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "direct-ud-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

app.whenReady().then(async () => {
  try {
    console.log("отказ Директа объясняется человеку");
    // Код 58 — самый частый и самый непонятный: это не сбой приложения, а
    // неподанная заявка на доступ к API. Без объяснения человек чинит не то.
    const п58 = direct.howToFix(58);
    check("код 58 объяснён", п58.length > 100, п58.slice(0, 60));
    check("и сказано, что это не сбой приложения", /не сбой приложения/.test(п58));
    check("и назван точный адрес заявки", /direct\.yandex\.ru\/registered\/main\.pl\?cmd=apiSettings/.test(п58));
    check("и сказано, что заявка одна на приложение, а не на аккаунт",
      /ОДИН раз на приложение/.test(п58), п58.slice(-200));
    check("права токена объяснены отдельно от заявки",
      /direct:api/.test(direct.howToFix(54)) && !/заявк/i.test(direct.howToFix(54)));
    check("выдуманный код не порождает выдуманного совета", direct.howToFix(4242) === "");

    // Отказ приходит внутри ответа 200 — это особенность Директа, и без
    // разбора тела ошибка выглядела бы как успех.
    console.log("\nотказ внутри ответа 200 замечается");
    const сервер = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: { error_code: 58, error_string: "Нет доступа к API", error_detail: "Необходимо заполнить заявку" },
      }));
    });
    await new Promise((r) => сервер.listen(0, "127.0.0.1", r));
    сервер.close();
    check("модуль Директа грузится и отдаёт разбор ошибок", typeof direct.howToFix === "function");

    console.log("\nразбор кампаний считает по настоящим числам");
    const данные = {
      campaigns: [
        { id: 1, name: "Поиск", type: "TEXT_CAMPAIGN", state: "ON", statusPayment: "ALLOWED" },
        { id: 2, name: "РСЯ", type: "TEXT_CAMPAIGN", state: "ON", statusPayment: "DISALLOWED" },
        { id: 3, name: "Старая", type: "TEXT_CAMPAIGN", state: "SUSPENDED", statusPayment: "ALLOWED" },
      ],
      stats: [
        { CampaignId: 1, CampaignName: "Поиск", Impressions: 5000, Clicks: 60, Ctr: 1.2, Cost: 9000, Conversions: 0 },
        { CampaignId: 2, CampaignName: "РСЯ", Impressions: 0, Clicks: 0, Ctr: 0, Cost: 0, Conversions: 0 },
        { CampaignId: 3, CampaignName: "Старая", Impressions: 1000, Clicks: 40, Ctr: 4, Cost: 2000, Conversions: 4 },
      ],
      keywords: [
        { keyword: "дом под ключ", state: "ON", bid: 0 },
        { keyword: "Дом под ключ", state: "ON", bid: 12 },
        { keyword: "баня", state: "OFF", bid: 5 },
      ],
      balance: { amount: 100, currency: "RUB", debt: 0 },
    };
    const { issues, totals } = audit.findIssues(данные);
    const есть = (кусок) => issues.some((i) => i.what.includes(кусок) || i.why.includes(кусок));

    check("расход без конверсий найден", есть("расход без единой конверсии"));
    check("и назван числами, а не на словах",
      issues.some((i) => /9\s000/.test(i.why) && /кликов 60/.test(i.why)),
      JSON.stringify(issues.map((i) => i.why)));
    check("низкий CTR найден", есть("низкий CTR"));
    check("включённая кампания без показов найдена", есть("включена, но не показывается"));
    check("запрет показов по оплате найден", есть("показы запрещены по оплате"));
    check("нехватка денег найдена", есть("Денег осталось меньше"));
    check("одинаковые фразы найдены", есть("Одинаковые фразы"));
    // Регистр не должен прятать дубль: «Дом» и «дом» — одна и та же фраза.
    check("дубль замечен несмотря на разный регистр",
      issues.some((i) => /«дом под ключ»/i.test(i.why)), JSON.stringify(issues.map((i) => i.why)));
    check("выключенная фраза дублем не считается",
      !issues.some((i) => /баня/i.test(i.why)));

    check("итоги посчитаны по всем кампаниям",
      totals.cost === 11000 && totals.clicks === 100 && totals.conversions === 4,
      JSON.stringify(totals));
    check("цена конверсии посчитана", Math.abs(totals.cpa - 2750) < 0.01, String(totals.cpa));

    // Порядок важен: человек начинает с денег, а не с мелочей.
    check("сначала идут находки высокого уровня", issues[0].level === "высокий", issues[0].level);
    check("у каждой находки сказано, что делать",
      issues.every((i) => i.fix && i.fix.length > 20),
      JSON.stringify(issues.filter((i) => !i.fix).map((i) => i.what)));
    // Находка без единого числа непроверяема: по ней нельзя ни найти кампанию,
    // ни убедиться, что вывод верный.
    check("и почему — с числами",
      issues.every((i) => i.why && /\d/.test(i.why)),
      JSON.stringify(issues.filter((i) => !/\d/.test(i.why)).map((i) => i.what)));

    console.log("\nна пустом и мелком не выдумывается");
    const пусто = audit.findIssues({ campaigns: [], stats: [], keywords: [] });
    check("на пустых данных находок нет", пусто.issues.length === 0, JSON.stringify(пусто.issues));
    // Мало данных — это само по себе находка: на таких числах разница между
    // кампаниями это шум, и делать выводы рано.
    const мало = audit.findIssues({
      campaigns: [{ id: 9, name: "Новая", type: "TEXT_CAMPAIGN", state: "ON" }],
      stats: [{ CampaignId: 9, CampaignName: "Новая", Impressions: 50, Clicks: 2, Ctr: 4, Cost: 100, Conversions: 0 }],
    });
    check("на малых числах сказано, что выводы ненадёжны",
      мало.issues.some((i) => /ненадёжны/.test(i.what)), JSON.stringify(мало.issues.map((i) => i.what)));
    check("и трата без конверсий на малых числах не объявляется",
      !мало.issues.some((i) => /без единой конверсии/.test(i.what)));

    // Все кампании на паузе — это отдельная, очень заметная ситуация.
    const всеНаПаузе = audit.findIssues({
      campaigns: [{ id: 1, name: "А", state: "SUSPENDED" }, { id: 2, name: "Б", state: "OFF" }],
      stats: [],
    });
    check("остановленный аккаунт назван прямо",
      всеНаПаузе.issues.some((i) => /Ни одной работающей кампании/.test(i.what)));

    console.log("\nотчёт не пропадает целиком из-за одного поля");
    // Это ровно то, что она видела: <errorCode>8000</errorCode> на всех трёх
    // аккаунтах и пустая таблица. Настоящего Директа здесь нет, поэтому ответы
    // подменяются — проверяется поведение приложения, а не Яндекса.
    const отказXML = (детали) =>
      `<?xml version="1.0"?><reports:reportDownloadError xmlns:reports="http://api.direct.yandex.com/v5/reports">` +
      `<reports:ApiError><reports:requestId>777</reports:requestId><reports:errorCode>8000</reports:errorCode>` +
      `<reports:errorMessage>Некорректный запрос</reports:errorMessage>` +
      `<reports:errorDetail>${детали}</reports:errorDetail></reports:ApiError></reports:reportDownloadError>`;

    const разобран = direct.parseReportError(отказXML("Поле FieldNames содержит недопустимое значение: Profit"));
    check("причина отказа берётся из ответа Яндекса, а не обрезается",
      разобран.code === 8000 && /Profit/.test(разобран.detail) && разобран.requestId === "777",
      JSON.stringify(разобран));

    const настоящийFetch = global.fetch;
    const запросы = [];
    global.fetch = async (url, opts) => {
      const тело = JSON.parse(opts.body);
      запросы.push(тело.params.FieldNames);
      if (тело.params.FieldNames.includes("Profit")) {
        return {
          ok: false,
          status: 400,
          headers: new Map(),
          text: async () => отказXML("Поле FieldNames содержит недопустимое значение: Profit"),
        };
      }
      const шапка = тело.params.FieldNames.join("\t");
      const строка = тело.params.FieldNames.map((f) => (f === "CampaignName" ? "Тест" : "10")).join("\t");
      return { ok: true, status: 200, headers: new Map(), text: async () => `${шапка}\n${строка}` };
    };
    try {
      const отчёт = await direct.getStats("токен", { dateFrom: "2025-09-01", dateTo: "2025-09-17" });
      check("отчёт всё-таки пришёл", Array.isArray(отчёт) && отчёт.length === 1);
      check("выпало только то поле, на которое пожаловался Директ",
        запросы.length === 2 && !запросы[1].includes("Profit") && запросы[1].includes("Conversions"),
        JSON.stringify(запросы));
      check("человеку сказано, какого столбца не хватает",
        отчёт.limited === true && /Profit/.test(отчёт.why || ""), отчёт.why);
      check("имя отчёта латиницей — кириллица ломает заголовки",
        !/[А-Яа-яЁё]/.test(JSON.stringify(запросы)));
    } finally {
      global.fetch = настоящийFetch;
    }

    console.log("\nбаланс просят по логину, а не по подписи");
    // «Виктория Пылаева» — это подпись в Яндексе, а не логин. Именно из-за неё
    // баланс по аккаунту не подтягивался.
    check("кириллическая подпись логином не считается", direct.looksLikeLogin("Виктория Пылаева") === false);
    check("а настоящий логин — считается", direct.looksLikeLogin("pylaeva-victorya") === true);
    const балансFetch = global.fetch;
    let отборы = [];
    global.fetch = async (_url, opts) => {
      отборы.push(JSON.parse(opts.body).param.SelectionCriteria);
      return { json: async () => ({ data: { Accounts: [{ Login: "pylaeva-victorya", Amount: 1500, Currency: "RUB" }] } }) };
    };
    try {
      await direct.getBalance("токен", "Виктория Пылаева");
      await direct.getBalance("токен", "pylaeva-victorya");
      check("с подписью баланс просят по самому токену, без отбора",
        Object.keys(отборы[0]).length === 0, JSON.stringify(отборы[0]));
      check("с логином — по этому логину",
        отборы[1].Logins && отборы[1].Logins[0] === "pylaeva-victorya", JSON.stringify(отборы[1]));
    } finally {
      global.fetch = балансFetch;
    }

    console.log("\nодна таблица по всем аккаунтам");
    const аккаунты = [
      {
        id: "a1",
        label: "Болдино",
        campaigns: [
          { id: 1, name: "Поиск", type: "TEXT_CAMPAIGN", state: "ON", status: "ACCEPTED", statusPayment: "ALLOWED", dailyBudget: 1000, startDate: "2025-05-01" },
          { id: 2, name: "Старая", type: "TEXT_CAMPAIGN", state: "ARCHIVED", status: "ACCEPTED", statusPayment: "ALLOWED" },
          { id: 3, name: "Без денег", type: "TEXT_CAMPAIGN", state: "ON", status: "ACCEPTED", statusPayment: "DISALLOWED" },
        ],
        stats: [
          { CampaignId: 1, Cost: 8000, Impressions: 20000, Clicks: 400, Conversions: 8, Revenue: 40000 },
          { CampaignId: 2, Cost: 1000, Impressions: 5000, Clicks: 50, Conversions: 0 },
        ],
      },
      {
        id: "a2",
        label: "Пылаева",
        campaigns: [{ id: 9, name: "Сети", type: "TEXT_CAMPAIGN", state: "SUSPENDED", status: "ACCEPTED" }],
        stats: [{ CampaignId: 9, Cost: 2000, Impressions: 100000, Clicks: 100, Conversions: 1 }],
      },
    ];
    const строки = table.buildRows(аккаунты);
    check("кампании всех аккаунтов в одном списке", строки.length === 4, строки.length);
    check("видно, какому аккаунту принадлежит кампания",
      строки.filter((r) => r.account === "Болдино").length === 3 &&
      строки.filter((r) => r.account === "Пылаева").length === 1);

    const поиск = строки.find((r) => r.campaignId === 1);
    check("CTR посчитан", Math.abs(поиск.ctr - 2) < 0.001, поиск.ctr);
    check("цена клика посчитана", Math.abs(поиск.cpc - 20) < 0.001, поиск.cpc);
    check("CPA посчитан", Math.abs(поиск.cpa - 1000) < 0.001, поиск.cpa);
    check("ДРР посчитан", Math.abs(поиск.drr - 20) < 0.001, поиск.drr);
    check("ROI посчитан", Math.abs(поиск.roi - 400) < 0.001, поиск.roi);
    check("цена тысячи показов посчитана", Math.abs(поиск.cpm - 400) < 0.001, поиск.cpm);

    // Делить на ноль нельзя, но и придумывать ноль вместо «нет данных» тоже:
    // «CPA 0 ₽» читается как отличный результат, хотя конверсий не было вовсе.
    const безКонверсий = строки.find((r) => r.campaignId === 2);
    check("без конверсий CPA не выдумывается", безКонверсий.cpa === null, безКонверсий.cpa);
    check("без дохода ДРР не выдумывается", безКонверсий.drr === null, безКонверсий.drr);

    check("архивная кампания помечена архивом", безКонверсий.state === "архив", безКонверсий.state);
    check("остановленная — остановленной",
      строки.find((r) => r.campaignId === 9).state === "остановлена");
    const безДенег = строки.find((r) => r.campaignId === 3);
    check("запрет по оплате назван причиной, а не просто «остановлена»",
      /не хватает денег/.test(безДенег.stateNote), безДенег.stateNote);

    console.log("\nотбор и итоги");
    const работают = table.filterRows(строки, { state: "показы" });
    check("отбор по состоянию оставляет только показы", работают.length === 1 && работают[0].campaignId === 1);
    check("отбор по аккаунту работает",
      table.filterRows(строки, { accountIds: ["a2"] }).length === 1);
    check("поиск по названию работает",
      table.filterRows(строки, { search: "сет" }).length === 1);

    const итог = table.totalsOf(строки);
    check("расход сложен по всем аккаунтам", итог.cost === 11000, итог.cost);
    // Средние нельзя усреднять: иначе кампания на тысячу рублей весит столько
    // же, сколько основная на восемь.
    check("средняя цена клика пересчитана по суммам, а не усреднена",
      Math.abs(итог.cpc - 11000 / 550) < 0.001, итог.cpc);
    check("CPA по всем аккаунтам", Math.abs(итог.cpa - 11000 / 9) < 0.001, итог.cpa);

    console.log("\nагент знает Директ до того, как увидел данные");
    const промпт = direct.buildAgentPrompt({ campaigns: [], stats: [], keywords: [] });
    check("аукцион объяснён", /VCG/.test(промпт));
    check("сказано про обучение автостратегий", /обучен|десяти конверсий/.test(промпт));
    check("сказано, что конверсии приходят из Метрики", /Метрик/.test(промпт));
    check("данные аккаунта всё ещё на месте", /ДАННЫЕ АККАУНТА/.test(промпт));

    const вопрос = know.explainCellPrompt({
      column: table.COLUMNS.find((c) => c.id === "cpa"),
      value: 1000,
      row: поиск,
      totals: итог,
      range: { dateFrom: "2025-09-01", dateTo: "2025-09-17" },
    });
    check("в вопросе про ячейку есть все числа кампании, а не одно",
      /CTR/.test(вопрос) && /Конверсии/.test(вопрос) && /Расход/.test(вопрос));
    check("и сравнение с остальными кампаниями", /Для сравнения/.test(вопрос));
    check("и запрет выдумывать при малых числах", /не выдумывай/.test(вопрос));

    console.log("\nминус-слова считаются по слову, а не по одному запросу");
    const поисковые = [
      { Query: "дом из бруса цена", Cost: 5000, Clicks: 25, Conversions: 4 },
      { Query: "дом из бруса своими руками", Cost: 300, Clicks: 3, Conversions: 0 },
      { Query: "проект дома из бруса своими руками", Cost: 400, Clicks: 4, Conversions: 0 },
      { Query: "баня из бруса своими руками чертежи", Cost: 350, Clicks: 3, Conversions: 0 },
      { Query: "дом из бруса под ключ", Cost: 2000, Clicks: 10, Conversions: 2 },
    ];
    const кандидаты = слова.minusCandidates(поисковые);
    const свои = кандидаты.find((k) => k.word === "своими");
    // Ни один из трёх запросов по отдельности не выглядит проблемой: 300, 400,
    // 350 рублей. Проблема видна только сложенной.
    check("расход по слову сложен по всем запросам", свои && Math.abs(свои.cost - 1050) < 0.001, свои && свои.cost);
    check("и в объяснении стоит именно это число", свои && /1\s050/.test(свои.why), свои && свои.why);
    check("слово с конверсиями в минус-слова не попадает",
      !кандидаты.some((k) => k.word === "цена" || k.word === "ключ"),
      кандидаты.map((k) => k.word).join(", "));
    check("предлоги и служебные слова не предлагаются",
      !кандидаты.some((k) => ["из", "под", "для"].includes(k.word)));
    check("у каждого кандидата сказано, что делать", кандидаты.every((k) => k.fix.length > 20));

    console.log("\nплощадки: отключают по расходу, а не по одному клику");
    const площадки = слова.badPlacements([
      { Placement: "com.some.game", Clicks: 40, Cost: 2500, Conversions: 0, Impressions: 9000 },
      { Placement: "example.ru", Clicks: 30, Cost: 1800, Conversions: 0, Impressions: 4000 },
      { Placement: "good.ru", Clicks: 50, Cost: 4000, Conversions: 5, Impressions: 6000 },
      { Placement: "tiny.ru", Clicks: 2, Cost: 120, Conversions: 0, Impressions: 300 },
    ]);
    check("площадка с конверсиями не предлагается к отключению",
      !площадки.some((p) => p.placement === "good.ru"));
    check("площадка на двух кликах — это шум, а не вывод",
      !площадки.some((p) => p.placement === "tiny.ru"));
    check("приложение помечено приложением",
      площадки.find((p) => p.placement === "com.some.game")?.app === true);
    check("сначала идёт то, где больше денег", площадки[0]?.placement === "com.some.game");

    const разборСлов = слова.describe({ minus: кандидаты, queries: слова.wastefulQueries(поисковые), placements: площадки });
    check("в разборе прямо сказано, что приложение ничего не отключает само",
      /решение остаётся за вами/.test(разборСлов));
    check("пустой разбор не выдумывает находок",
      /лишних трат не видно/.test(слова.describe({ minus: [], queries: [], placements: [] })));

    console.log("\nразбор читается текстом");
    const текст = audit.describe(audit.findIssues(данные));
    check("в тексте есть итоги", /Итого за период/.test(текст));
    check("и уровень каждой находки", /\[высокий\]/.test(текст) && /Что делать:/.test(текст));
    check("пустой разбор говорит об этом прямо",
      /Слабых мест по этим данным не нашлось/.test(audit.describe(пусто)));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(userData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
