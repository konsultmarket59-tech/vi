// Яндекс Директ API v5.
//
// Authorised with the same Yandex OAuth token as Яндекс Диск — one app at
// oauth.yandex.ru can hold both scopes, which is exactly how the user set hers up.
//
// The API is JSON-RPC-ish: every service is its own endpoint, every call is a POST
// with {method, params}, and errors come back inside a 200 response under "error".
// Reports are the exception — a separate endpoint returning TSV, sometimes with a
// "come back later" status instead of data.

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const DIRECT_REPORTS = "https://api.direct.yandex.com/v5/reports";

/**
 * One API call. `clientLogin` is required when the token belongs to an agency
 * account acting for a client, and harmless to omit for a direct advertiser.
 */
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
    throw new Error(`Директ: ${detail} (код ${body.error.error_code})`);
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
async function getStats(token, { dateFrom, dateTo, clientLogin }, attempt = 0) {
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

  const res = await fetch(DIRECT_REPORTS, {
    method: "POST",
    headers,
    body: JSON.stringify({
      params: {
        SelectionCriteria: { DateFrom: dateFrom, DateTo: dateTo },
        FieldNames: ["CampaignId", "CampaignName", "Impressions", "Clicks", "Ctr", "Cost", "AvgCpc", "Conversions"],
        ReportName: `Отчёт ${dateFrom}—${dateTo} ${Date.now()}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
      },
    }),
  });

  if (res.status === 201 || res.status === 202) {
    if (attempt >= 5) throw new Error("Отчёт слишком долго готовится. Попробуйте ещё раз через минуту.");
    const wait = Number(res.headers.get("retryIn") || 5) * 1000;
    await new Promise((r) => setTimeout(r, Math.min(wait, 15000)));
    return getStats(token, { dateFrom, dateTo, clientLogin }, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Директ (отчёты): ${text.slice(0, 300)}`);

  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    header.forEach((name, i) => {
      const raw = cells[i] ?? "";
      const num = Number(raw.replace(",", "."));
      row[name] = raw !== "" && !Number.isNaN(num) ? num : raw;
    });
    return row;
  });
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
  return `${AGENT_PROMPT_HEADER}\n${toAgentText(data)}`;
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
  testConnection,
  listCampaigns,
  listAdGroups,
  listAds,
  listKeywords,
  getStats,
  setCampaignState,
  setKeywordBid,
  buildAgentPrompt,
  parseAgentAction,
  toAgentText,
};
