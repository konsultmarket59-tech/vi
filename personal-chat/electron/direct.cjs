// Яндекс Директ API v5.
//
// Authorised with the same Yandex OAuth token as Яндекс Диск — one app at
// oauth.yandex.ru can hold both scopes, which is exactly how the user set hers up.
//
// The API is JSON-RPC-ish: every service is its own endpoint, every call is a POST
// with {method, params}, and errors come back inside a 200 response under "error".
// Reports are the exception — a separate endpoint returning TSV, sometimes with a
// "come back later" status instead of data.

const directknow = require("./directknow.cjs");

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const DIRECT_REPORTS = "https://api.direct.yandex.com/v5/reports";

/**
 * One API call. `clientLogin` is required when the token belongs to an agency
 * account acting for a client, and harmless to omit for a direct advertiser.
 */
/**
 * Что делать с отказом Директа.
 *
 * Код ошибки сам по себе человеку ничего не говорит, а формулировки Яндекса
 * написаны для того, кто уже знает, где эта настройка лежит. Разница между
 * «нет доступа» и «заявка не подана» — это разница между «сломалось» и «надо
 * сходить и нажать вот здесь», и её обязано объяснять приложение.
 *
 * Отдельно про 58. Это НЕ ошибка приложения и не чинится кодом: Яндекс требует,
 * чтобы у приложения был одобренный доступ к API Директа. Заявка подаётся
 * человеком в интерфейсе Директа и рассматривается несколько рабочих дней.
 * Пока она не одобрена, API не отдаёт ничего — ни кампаний, ни статистики.
 */
function howToFix(code) {
  switch (code) {
    case 58:
      return [
        "Это не сбой приложения и не чинится настройками: Яндекс требует, чтобы у вашего приложения",
        "с oauth.yandex.ru был ОДОБРЕННЫЙ доступ к API Директа. Порядок такой:",
        "",
        "1. Зайдите в Директ под тем аккаунтом, чьи кампании нужны.",
        "2. Откройте страницу заявки: https://direct.yandex.ru/registered/main.pl?cmd=apiSettings",
        "   (в интерфейсе: «Настройки» → «Настройки API» / «Доступ к API»).",
        "3. Заполните заявку на доступ к API для вашего приложения — понадобится его ID",
        "   с oauth.yandex.ru и описание, зачем нужен доступ.",
        "4. Дождитесь одобрения. Обычно несколько рабочих дней; о решении Яндекс пишет письмом.",
        "",
        "Заявка подаётся ОДИН раз на приложение, а не на каждый аккаунт: после одобрения",
        "тем же приложением можно работать со всеми вашими аккаунтами.",
      ].join("\n");
    case 53:
      return "Токен не передан или просрочен. Подключите аккаунт заново: «☁️ Облако» → «Подключение».";
    case 54:
      return (
        "У токена нет прав на Директ. В приложении на oauth.yandex.ru отметьте права Яндекс.Директа " +
        "(direct:api) и получите токен заново — права добавляются только новым токеном."
      );
    case 513:
    case 514:
      return "Слишком много запросов за раз. Подождите минуту и повторите — это ограничение Яндекса, не приложения.";
    case 152:
      return "На аккаунте закончились баллы API Директа. Они начисляются заново, обычно в течение суток.";
    case 9000:
      return (
        "Логин клиента указан для неагентского аккаунта. Если это ваш собственный аккаунт, поле " +
        "«Логин клиента» надо оставить пустым."
      );
    default:
      return "";
  }
}

async function call(token, service, method, params, { clientLogin, sandbox } = {}) {
  const base = sandbox ? DIRECT_API.replace("api.direct", "api-sandbox.direct") : DIRECT_API;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const res = await fetch(`${base}/${service}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params: params || {} }),
  });

  if (res.status === 401) {
    throw new Error(
      "Яндекс Директ не принял токен. Убедитесь, что при создании приложения на oauth.yandex.ru отмечены " +
        "права Яндекс.Директа, и подключите аккаунт заново в разделе «Директ» → «Подключение»."
    );
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Директ вернул не JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (body.error) {
    // error_detail is the field that actually explains what to fix; error_string is
    // a category like "Недостаточно прав".
    const detail = body.error.error_detail || body.error.error_string || "неизвестная ошибка";
    const code = Number(body.error.error_code);
    const problem = new Error(`Директ: ${detail} (код ${code})`);
    problem.code = code;
    problem.howToFix = howToFix(code);
    if (problem.howToFix) problem.message += `\n\n${problem.howToFix}`;
    throw problem;
  }
  return body.result || {};
}

async function testConnection(token, clientLogin) {
  if (!token?.trim()) return { ok: false, error: "Нет токена — подключите аккаунт Яндекса." };
  try {
    // Clients.get is the cheapest call that proves both the token and the scope.
    const result = await call(token, "clients", "get", { FieldNames: ["Login", "ClientInfo", "Currency"] }, { clientLogin });
    const client = (result.Clients || [])[0] || {};
    return { ok: true, login: client.Login || "", info: client.ClientInfo || "", currency: client.Currency || "" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const CAMPAIGN_FIELDS = ["Id", "Name", "Type", "Status", "State", "StatusPayment", "DailyBudget", "StartDate"];

async function listCampaigns(token, clientLogin) {
  const result = await call(
    token,
    "campaigns",
    "get",
    { SelectionCriteria: {}, FieldNames: CAMPAIGN_FIELDS },
    { clientLogin }
  );
  return (result.Campaigns || []).map((c) => ({
    id: c.Id,
    name: c.Name,
    type: c.Type || "",
    status: c.Status || "",
    state: c.State || "",
    statusPayment: c.StatusPayment || "",
    // DailyBudget is in micro-units of the account currency, as everything money-ish
    // is in this API; converting once here keeps that detail out of the UI.
    dailyBudget: c.DailyBudget?.Amount ? c.DailyBudget.Amount / 1_000_000 : 0,
    startDate: c.StartDate || "",
  }));
}

async function listAdGroups(token, campaignIds, clientLogin) {
  const result = await call(
    token,
    "adgroups",
    "get",
    { SelectionCriteria: { CampaignIds: campaignIds }, FieldNames: ["Id", "Name", "CampaignId", "Status", "Type"] },
    { clientLogin }
  );
  return (result.AdGroups || []).map((g) => ({
    id: g.Id,
    name: g.Name,
    campaignId: g.CampaignId,
    status: g.Status || "",
    type: g.Type || "",
  }));
}

async function listAds(token, campaignIds, clientLogin) {
  const result = await call(
    token,
    "ads",
    "get",
    {
      SelectionCriteria: { CampaignIds: campaignIds },
      FieldNames: ["Id", "CampaignId", "AdGroupId", "Status", "State"],
      TextAdFieldNames: ["Title", "Title2", "Text", "Href"],
    },
    { clientLogin }
  );
  return (result.Ads || []).map((a) => ({
    id: a.Id,
    campaignId: a.CampaignId,
    adGroupId: a.AdGroupId,
    status: a.Status || "",
    state: a.State || "",
    title: a.TextAd?.Title || "",
    title2: a.TextAd?.Title2 || "",
    text: a.TextAd?.Text || "",
    href: a.TextAd?.Href || "",
  }));
}

async function listKeywords(token, campaignIds, clientLogin) {
  const result = await call(
    token,
    "keywords",
    "get",
    {
      SelectionCriteria: { CampaignIds: campaignIds },
      FieldNames: ["Id", "Keyword", "AdGroupId", "Status", "State", "Bid"],
    },
    { clientLogin }
  );
  return (result.Keywords || []).map((k) => ({
    id: k.Id,
    keyword: k.Keyword,
    adGroupId: k.AdGroupId,
    status: k.Status || "",
    state: k.State || "",
    bid: k.Bid ? k.Bid / 1_000_000 : 0,
  }));
}

/**
 * Campaign performance for a date range, via the Reports service.
 *
 * Reports are generated asynchronously: the first call often returns 201/202 meaning
 * "queued, ask again". processingMode=auto makes Yandex wait for small reports
 * instead of queueing them, which is what these are; the retry is the safety net for
 * when it queues anyway.
 */
/**
 * Разобрать отказ сервиса отчётов.
 *
 * Отчёты отвечают не JSON-ом, а XML-ом, и самое нужное лежит в `errorDetail`:
 * `errorMessage` — это категория вроде «Некорректный запрос», по которой чинить
 * нечего. Раньше текст просто обрезался на трёхстах знаках — ровно на том
 * месте, где написана причина, и человек видел простыню без единого полезного
 * слова.
 */
function parseReportError(xml) {
  const text = String(xml || "");
  const pick = (tag) => {
    const m = new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(text);
    return m ? m[1].trim() : "";
  };
  return {
    code: Number(pick("errorCode")) || 0,
    message: pick("errorMessage"),
    detail: pick("errorDetail"),
    requestId: pick("requestId"),
  };
}

/**
 * Поля отчёта, которые заведомо принимает любой аккаунт.
 *
 * Отступ на этот набор нужен, когда Директ отказывается от расширенного:
 * часть полей доступна не всем и не всегда, а увидеть расход и клики человек
 * должен в любом случае. Лучше базовый отчёт с оговоркой, чем пустой экран.
 */
const BASE_REPORT_FIELDS = ["CampaignId", "CampaignName", "Impressions", "Clicks", "Ctr", "Cost", "AvgCpc"];

/** Всё, что приложение умеет показывать в таблице кампаний. */
const REPORT_FIELDS = [
  ...BASE_REPORT_FIELDS,
  "Conversions",
  "ConversionRate",
  "CostPerConversion",
  // Позиции показа Яндекс из API убрал вместе со сменой аукциона, и запрос с
  // таким полем отклоняется целиком. Поэтому его здесь нет.
  "BounceRate",
  "AvgPageviews",
  "Revenue",
  "Profit",
];

/**
 * Какое из запрошенных полей не понравилось Директу.
 *
 * Директ в errorDetail пишет название поля прямым текстом — этого достаточно,
 * чтобы убрать именно его, а не весь расширенный набор. Разница существенная:
 * без этого из-за одного недоступного показателя пропадали бы и конверсии,
 * и доход, и отказы — всё, ради чего в таблицу и смотрят.
 */
function blamedField(detail, fields) {
  const текст = String(detail || "");
  return fields.find((поле) => new RegExp(`\\b${поле}\\b`).test(текст)) || "";
}

async function getStats(
  token,
  { dateFrom, dateTo, clientLogin, fields, goals, attributionModels, reportType = "CAMPAIGN_PERFORMANCE_REPORT" },
  attempt = 0,
  запасной = false,
  убрано = []
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "Content-Type": "application/json; charset=utf-8",
    processingMode: "auto",
    returnMoneyInMicros: "false",
    skipReportHeader: "true",
    skipReportSummary: "true",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const запрошено = Array.isArray(fields) && fields.length ? fields : REPORT_FIELDS;
  const набор = запасной ? BASE_REPORT_FIELDS : запрошено;

  const criteria = { DateFrom: dateFrom, DateTo: dateTo };
  // Цели запрашиваются только когда они названы: с пустым списком Директ
  // отказывает, а не возвращает «по всем целям».
  if (!запасной && Array.isArray(goals) && goals.length) criteria.Goals = goals.map(String);

  const params = {
    SelectionCriteria: criteria,
    FieldNames: набор,
    // Имя отчёта — латиницей. Оно уезжает в заголовок ответа, а заголовки
    // принимают только латиницу: кириллица здесь ломала весь запрос молча.
    ReportName: `report-${dateFrom}-${dateTo}-${Date.now()}`,
    ReportType: reportType,
    DateRangeType: "CUSTOM_DATE",
    Format: "TSV",
    IncludeVAT: "YES",
  };
  if (!запасной && criteria.Goals) {
    // С названными целями Директ требует и модель атрибуции. Последний значимый
    // переход — то, что в интерфейсе Директа стоит по умолчанию.
    params.AttributionModels =
      Array.isArray(attributionModels) && attributionModels.length ? attributionModels : ["LSC"];
  }

  const res = await fetch(DIRECT_REPORTS, { method: "POST", headers, body: JSON.stringify({ params }) });

  if (res.status === 201 || res.status === 202) {
    if (attempt >= 5) throw new Error("Отчёт слишком долго готовится. Попробуйте ещё раз через минуту.");
    const wait = Number(res.headers.get("retryIn") || 5) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
    return getStats(
      token,
      { dateFrom, dateTo, clientLogin, fields, goals, attributionModels, reportType },
      attempt + 1,
      запасной,
      убрано
    );
  }

  const text = await res.text();
  if (!res.ok) {
    const отказ = parseReportError(text);
    // Часть полей доступна не всякому аккаунту, и заранее узнать, каких именно,
    // неоткуда. Поэтому один раз пробуем базовый набор: увидеть расход и клики
    // человек должен в любом случае.
    if (!запасной && отказ.code === 8000) {
      // Сначала пробуем убрать ровно то поле, на которое Директ пожаловался,
      // и оставить всё остальное.
      const лишнее = blamedField(отказ.detail, набор.filter((поле) => !BASE_REPORT_FIELDS.includes(поле)));
      if (лишнее && убрано.length < набор.length) {
        const сузили = await getStats(
          token,
          {
            dateFrom,
            dateTo,
            clientLogin,
            fields: набор.filter((поле) => поле !== лишнее),
            goals,
            attributionModels,
            reportType,
          },
          0,
          false,
          [...убрано, лишнее]
        ).catch(() => null);
        if (сузили) return сузили;
      }
      // Не помогло — показываем хотя бы основное: расход и клики человек
      // должен увидеть в любом случае.
      const базовый = await getStats(token, { dateFrom, dateTo, clientLogin, reportType }, 0, true, убрано).catch(
        () => null
      );
      if (базовый) {
        базовый.limited = true;
        базовый.why =
          "Директ не принял расширенный набор полей" +
          (отказ.detail ? `: ${отказ.detail}` : "") +
          ". Показаны основные показатели — расход, показы, клики, CTR, цена клика.";
        return базовый;
      }
    }
    const problem = new Error(
      "Директ (отчёты): " +
        (отказ.detail || отказ.message || text.slice(0, 200)) +
        (отказ.code ? ` (код ${отказ.code})` : "") +
        (отказ.requestId ? `\nНомер запроса: ${отказ.requestId}` : "")
    );
    problem.code = отказ.code;
    problem.detail = отказ.detail;
    throw problem;
  }

  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((name, i) => {
      const raw = cells[i] ?? "";
      const num = Number(raw.replace(",", "."));
      row[name] = raw !== "" && !Number.isNaN(num) ? num : raw;
    });
    return row;
  });
  if (убрано.length) {
    rows.limited = true;
    rows.why =
      "Директ не отдал по этому аккаунту: " +
      убрано.join(", ") +
      ". Остальные показатели в таблице настоящие — эти столбцы просто останутся пустыми.";
  }
  return rows;
}

/**
 * Баланс аккаунта.
 *
 * В API v5 баланса нет вовсе — он живёт в старом Live v4, и это не выбор
 * приложения, а то, как устроен Директ. Токен и права те же самые, поэтому
 * лишних действий от человека не требуется.
 *
 * Отказ здесь не обрывает всё остальное: не увидеть баланс неприятно, но
 * кампании и статистика от этого не перестают работать.
 */
const DIRECT_LIVE_V4 = "https://api.direct.yandex.ru/live/v4/json/";

/**
 * Логин ли это.
 *
 * Аккаунт в приложении человек называет по-своему — «Болдино», «Виктория
 * Пылаева». Если такое имя уйдёт в Logins, Директ ответит, что логина не
 * существует, и баланс просто не покажется. Логин в Яндексе всегда латиницей,
 * поэтому кириллическое имя — это подпись, а не логин, и запрашивать баланс
 * надо без отбора: по самому токену.
 */
function looksLikeLogin(value) {
  return /^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(String(value || "").trim());
}

async function getBalance(token, login) {
  const отбор = looksLikeLogin(login) ? { Logins: [String(login).trim()] } : {};
  const res = await fetch(DIRECT_LIVE_V4, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      method: "AccountManagement",
      token,
      locale: "ru",
      param: { Action: "Get", SelectionCriteria: отбор },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error_code || body.error_str) {
    const problem = new Error(`Баланс: ${body.error_detail || body.error_str} (код ${body.error_code})`);
    problem.code = Number(body.error_code);
    problem.howToFix = howToFix(Number(body.error_code));
    throw problem;
  }
  const account = (body.data?.Accounts || [])[0];
  if (!account) return null;
  return {
    login: account.Login || (looksLikeLogin(login) ? String(login).trim() : ""),
    amount: Number(account.Amount || 0),
    currency: account.Currency || "RUB",
    // Долг и предупреждение о нём — то, ради чего на баланс и смотрят.
    debt: Number(account.Debt || 0),
    discount: Number(account.Discount || 0),
  };
}

/**
 * Поисковые запросы — то, по чему на самом деле показывались.
 *
 * Разница между ключевыми фразами и поисковыми запросами — это и есть место,
 * где утекают деньги: фраза «дом из бруса» ловит и «дом из бруса своими
 * руками», и «дом из бруса отзывы». Пока не видно самих запросов, минус-слова
 * добавляют наугад.
 */
async function getSearchQueries(token, { dateFrom, dateTo, clientLogin }) {
  return getStats(token, {
    dateFrom,
    dateTo,
    clientLogin,
    reportType: "SEARCH_QUERY_PERFORMANCE_REPORT",
    fields: ["Query", "CampaignId", "CampaignName", "Criterion", "MatchType", "Impressions", "Clicks", "Cost", "Conversions"],
  });
}

/**
 * Площадки рекламной сети.
 *
 * В РСЯ расход расходится по сотням площадок, и часть из них — приложения со
 * случайными нажатиями. Увидеть их можно только этим отчётом.
 */
async function getPlacements(token, { dateFrom, dateTo, clientLogin }) {
  return getStats(token, {
    dateFrom,
    dateTo,
    clientLogin,
    reportType: "CUSTOM_REPORT",
    fields: ["Placement", "AdNetworkType", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost", "Conversions"],
  });
}

/**
 * Вордстат.
 *
 * Живёт только в старом Live v4 — в API v5 его нет. Работает отложенно:
 * отчёт сначала заказывают, потом ждут, потом забирают и удаляют за собой.
 * Очередь отчётов у аккаунта небольшая, поэтому за собой надо именно убирать,
 * иначе следующий заказ упрётся в лимит.
 */
async function liveV4(token, method, param) {
  const res = await fetch(DIRECT_LIVE_V4, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ method, token, locale: "ru", param }),
  });
  const body = await res.json().catch(() => ({}));
  if (body.error_code || body.error_str) {
    const problem = new Error(`${method}: ${body.error_detail || body.error_str} (код ${body.error_code})`);
    problem.code = Number(body.error_code);
    problem.howToFix = howToFix(Number(body.error_code));
    throw problem;
  }
  return body.data;
}

async function wordstat(token, phrases, { geoIds = [], timeoutMs = 90000 } = {}) {
  const слова = (Array.isArray(phrases) ? phrases : [phrases])
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  if (!слова.length) throw new Error("Не задано ни одной фразы для Вордстата.");

  const reportId = await liveV4(token, "CreateNewWordstatReport", {
    Phrases: слова,
    GeoID: (geoIds || []).map(Number).filter(Boolean),
  });

  const начало = Date.now();
  // Отчёт готовится не мгновенно. Опрашиваем редко: частые опросы Директ
  // считает за превышение и отвечает отказом, а не ускоряет подготовку.
  for (;;) {
    const список = (await liveV4(token, "GetWordstatReportList", {})) || [];
    const наш = список.find((r) => Number(r.ReportID) === Number(reportId));
    if (наш && String(наш.StatusReport).toLowerCase() === "done") break;
    if (Date.now() - начало > timeoutMs) {
      await liveV4(token, "DeleteWordstatReport", Number(reportId)).catch(() => {});
      throw new Error("Вордстат готовит отчёт дольше обычного. Попробуйте ещё раз через минуту.");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const данные = (await liveV4(token, "GetWordstatReport", Number(reportId))) || [];
  await liveV4(token, "DeleteWordstatReport", Number(reportId)).catch(() => {
    // Не удалить отчёт — не беда: он сам вытеснится следующими.
  });

  return данные.map((item) => ({
    phrase: item.Phrase || "",
    /** Что ещё искали вместе с этой фразой — отсюда берут и ключи, и минус-слова. */
    with: (item.SearchedWith || []).map((w) => ({ phrase: w.Phrase, shows: Number(w.Shows) || 0 })),
    also: (item.SearchedAlso || []).map((w) => ({ phrase: w.Phrase, shows: Number(w.Shows) || 0 })),
  }));
}

/** Turns a campaign on or off. The only mutation exposed, and it goes through confirmation. */
async function setCampaignState(token, campaignId, resume, clientLogin) {
  const method = resume ? "resume" : "suspend";
  const result = await call(token, "campaigns", method, { SelectionCriteria: { Ids: [campaignId] } }, { clientLogin });
  const outcome = (result.ResumeResults || result.SuspendResults || [])[0];
  if (outcome?.Errors?.length) throw new Error(outcome.Errors[0].Details || outcome.Errors[0].Message);
  return { id: campaignId, state: resume ? "ON" : "SUSPENDED" };
}

/** Changes a keyword's bid, in account currency (converted to micros for the API). */
async function setKeywordBid(token, keywordId, bid, clientLogin) {
  const result = await call(
    token,
    "keywords",
    "setBids",
    { KeywordBids: [{ KeywordId: keywordId, Bid: Math.round(Number(bid) * 1_000_000) }] },
    { clientLogin }
  );
  const outcome = (result.SetBidsResults || [])[0];
  if (outcome?.Errors?.length) throw new Error(outcome.Errors[0].Details || outcome.Errors[0].Message);
  return { id: keywordId, bid: Number(bid) };
}

// ---------- agent ----------

function money(value) {
  return Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

/** Compact text picture of the account for the agent's context. */
function toAgentText({ campaigns, stats, keywords }) {
  const parts = [];
  if (campaigns?.length) {
    parts.push(
      "--- Кампании ---\n" +
        campaigns
          .map(
            (c) =>
              `#${c.id} «${c.name}» · тип ${c.type} · состояние ${c.state} · статус ${c.status}` +
              (c.dailyBudget ? ` · дневной бюджет ${money(c.dailyBudget)}` : "")
          )
          .join("\n")
    );
  }
  if (stats?.length) {
    parts.push(
      "--- Статистика за период ---\n" +
        stats
          .map(
            (r) =>
              `#${r.CampaignId} «${r.CampaignName}»: показов ${r.Impressions}, кликов ${r.Clicks}, ` +
              `CTR ${r.Ctr}%, расход ${money(r.Cost)}, средняя цена клика ${money(r.AvgCpc)}, ` +
              `конверсий ${r.Conversions ?? "—"}`
          )
          .join("\n")
    );
  }
  if (keywords?.length) {
    parts.push(
      "--- Ключевые фразы (первые 200) ---\n" +
        keywords
          .slice(0, 200)
          .map((k) => `#${k.id} «${k.keyword}» · группа ${k.adGroupId} · ставка ${money(k.bid)} · ${k.state}`)
          .join("\n")
    );
  }
  return parts.join("\n\n") || "Данных пока нет — загрузите кампании и статистику.";
}

const AGENT_PROMPT_HEADER = `Ты — специалист по контекстной рекламе в Яндекс Директе. Ниже — данные рекламного
аккаунта: кампании, статистика за выбранный период и ключевые фразы со ставками.

Твоя работа — разбирать эти цифры и говорить, что с ними делать: где сливается бюджет, какие фразы стоит
отключить, где ставка не окупается, что не так со структурой кампаний. Опирайся на цифры из данных ниже, не
придумывай их. Считай CPA, долю расхода, окупаемость — там, где для этого хватает данных; если не хватает,
прямо скажи, каких именно данных не хватает.

Если нужно что-то изменить в аккаунте, верни блок строго такого вида — приложение покажет подтверждение,
и изменение произойдёт, только когда пользователь его подтвердит:

===DIRECT ACTION START===
ACTION: suspend | resume | bid
TARGET: <ID кампании для suspend/resume, ID фразы для bid>
VALUE: <новая ставка в рублях — только для bid>
WHY: <одно предложение: зачем это делать>
===DIRECT ACTION END===

Правила:
- Одно действие за раз. Если нужно несколько — предлагай по очереди, объясняя порядок.
- Никогда не выполняй действие сам и не пиши, что оно уже сделано.
- Всегда объясняй решение цифрами из данных: «расход 12 400 ₽, ни одной конверсии за 30 дней».
- Отвечай по-русски, без воды.

=== ДАННЫЕ АККАУНТА ===`;

function buildAgentPrompt(data) {
  // Знания Директа идут перед данными, а не после: без них модель объясняет
  // числа общими словами про «оптимизацию», не зная ни про обучение стратегий,
  // ни про то, что конверсии приходят из Метрики.
  return `${AGENT_PROMPT_HEADER.replace("=== ДАННЫЕ АККАУНТА ===", `${directknow.KNOWLEDGE}\n\n=== ДАННЫЕ АККАУНТА ===`)}\n${toAgentText(
    data
  )}`;
}

/** Parses the agent's proposed action. */
function parseAgentAction(text) {
  const match = /===DIRECT ACTION START===([\s\S]*?)===DIRECT ACTION END===/.exec(text || "");
  if (!match) return null;
  const block = match[1];
  const action = /ACTION:\s*(\w+)/i.exec(block)?.[1]?.toLowerCase();
  const target = /TARGET:\s*(\d+)/i.exec(block)?.[1];
  const value = /VALUE:\s*([\d.,]+)/i.exec(block)?.[1];
  const why = /WHY:\s*(.+)/i.exec(block)?.[1]?.trim() || "";
  if (!action || !target) return null;
  if (!["suspend", "resume", "bid"].includes(action)) return null;
  if (action === "bid" && !value) return null;
  return { action, target: Number(target), value: value ? Number(value.replace(",", ".")) : undefined, why };
}

module.exports = {
  howToFix,
  looksLikeLogin,
  blamedField,
  parseReportError,
  REPORT_FIELDS,
  BASE_REPORT_FIELDS,
  getBalance,
  testConnection,
  listCampaigns,
  listAdGroups,
  listAds,
  listKeywords,
  getStats,
  getSearchQueries,
  getPlacements,
  wordstat,
  setCampaignState,
  setKeywordBid,
  buildAgentPrompt,
  parseAgentAction,
  toAgentText,
};
