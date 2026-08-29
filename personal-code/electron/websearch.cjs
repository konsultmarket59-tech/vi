// Web search + page reading for the assistant.
//
// Two providers, because the keyless one can't be relied on alone:
//   - "duckduckgo" (default): scrapes DuckDuckGo's HTML endpoint. Needs no key, so
//     it works the moment the app is installed — but it's an undocumented HTML
//     surface, so it can break when DDG changes their markup or rate-limits.
//   - "tavily": a proper search API built for AI agents (JSON, no scraping). Needs
//     a key from tavily.com, and is the one to switch to if the default gets flaky.
//
// All requests go through global.fetch, which main.cjs has already pointed at
// Electron's net.fetch — so these calls inherit the user's system/VPN proxy and
// the proxy-auth handler, same as every other outbound call in the app.

const MAX_RESULTS = 6;
const MAX_PAGE_CHARS = 12000;
const REQUEST_TIMEOUT_MS = 20000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
  "&laquo;": "«",
  "&raquo;": "»",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&[a-zA-Z#0-9x]+;/g, (m) => {
      if (ENTITIES[m]) return ENTITIES[m];
      const num = /^&#(x?)([0-9a-fA-F]+);$/.exec(m);
      if (num) {
        const code = parseInt(num[2], num[1] ? 16 : 10);
        if (Number.isFinite(code)) return String.fromCodePoint(code);
      }
      return m;
    })
    .trim();
}

function stripTags(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

// DuckDuckGo wraps outbound links as /l/?uddg=<percent-encoded real url>. Unwrap so
// the assistant gets (and can ask us to fetch) the real destination, not a redirector.
function unwrapDuckDuckGoUrl(href) {
  if (!href) return "";
  let url = href.startsWith("//") ? "https:" + href : href;
  const match = /[?&]uddg=([^&]+)/.exec(url);
  if (match) {
    try {
      url = decodeURIComponent(match[1]);
    } catch {
      // keep the wrapped form if it isn't valid percent-encoding
    }
  }
  return url;
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  // Each result block starts at a result__a anchor; the snippet anchor/div that
  // follows it belongs to that same result.
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = linkRe.exec(html)) !== null && results.length < MAX_RESULTS) {
    const url = unwrapDuckDuckGoUrl(m[1]);
    const title = stripTags(m[2]);
    if (!url || !title) continue;
    const after = html.slice(m.index, m.index + 3000);
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(after);
    results.push({ title, url, snippet: snippetMatch ? stripTags(snippetMatch[1]) : "" });
  }
  return results;
}

async function searchDuckDuckGo(query) {
  const res = await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`DuckDuckGo вернул ${res.status} ${res.statusText}.`);
  return parseDuckDuckGoHtml(await res.text());
}

async function searchTavily(query, apiKey) {
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: MAX_RESULTS, search_depth: "basic" }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Tavily вернул ${res.status} ${res.statusText}.`);
  return (body.results || [])
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title || r.url, url: r.url, snippet: r.content || "" }));
}

async function search(query, settings = {}) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Пустой поисковый запрос.");
  if (settings.searchProvider === "tavily") {
    if (!settings.searchApiKey?.trim()) {
      throw new Error("Выбран Tavily, но не задан ключ поиска в Настройках.");
    }
    return searchTavily(q, settings.searchApiKey.trim());
  }
  return searchDuckDuckGo(q);
}

/** Fetches a page and reduces it to plain readable text for the model. */
async function fetchPage(url) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) throw new Error("Ссылка должна начинаться с http:// или https://");
  const res = await fetchWithTimeout(target, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`Страница вернула ${res.status} ${res.statusText}.`);
  const contentType = res.headers.get("content-type") || "";
  const raw = await res.text();
  if (!/html|xml|text/i.test(contentType)) {
    return { url: target, title: "", text: `[Содержимое не текстовое (${contentType}), прочитать не удалось.]` };
  }
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] || "");
  const body = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ")
    // keep block boundaries as newlines so paragraphs don't run together
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  let text = decodeEntities(body.replace(/<[^>]*>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  if (text.length > MAX_PAGE_CHARS) {
    text = text.slice(0, MAX_PAGE_CHARS) + "\n\n[...страница обрезана по лимиту...]";
  }
  return { url: target, title, text };
}

/** Formats tool output as the plain text that gets fed back to the model. */
function formatSearchResults(query, results) {
  if (results.length === 0) return `Поиск «${query}»: ничего не найдено.`;
  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`
  );
  return `Результаты поиска «${query}»:\n\n${lines.join("\n\n")}`;
}

function formatPage(page) {
  return `Содержимое страницы ${page.url}${page.title ? ` («${page.title}»)` : ""}:\n\n${page.text}`;
}

// ---------- assistant-facing tool protocol ----------

// The instruction block appended to the system prompt wherever web access is on.
// Kept here (main process) as the single source of truth: the renderer pulls it
// over IPC rather than keeping its own copy, so the wording and the parser below
// can never drift apart.
const WEB_TOOLS_HINT = `У тебя есть доступ в интернет. Когда для ответа нужны свежие или внешние данные
(новости, цены, что публикуют конкуренты, содержимое конкретной страницы) — не выдумывай их и не говори,
что у тебя нет доступа. Вместо этого верни в ответе один из блоков ниже, и приложение само выполнит запрос
и пришлёт тебе результат следующим сообщением:

===WEB SEARCH===
QUERY: поисковый запрос
===END===

===WEB FETCH===
URL: https://полная-ссылка-на-страницу
===END===

Правила:
- Один блок за раз. Получив результаты, при необходимости запроси следующий.
- Блок должен быть единственным содержимым ответа — не смешивай его с текстом для пользователя.
- Ссылки для WEB FETCH бери из результатов поиска или от пользователя, не придумывай их.
- Получив результаты, обязательно указывай в итоговом ответе ссылки на источники.`;

const TOOL_ROUND_LIMIT = 4;

/**
 * Finds the first tool block in an assistant message. Only the first is honored —
 * the hint above asks for one at a time, and running a batch of unreviewed fetches
 * from a single reply is exactly the kind of runaway we don't want.
 */
function parseToolCall(text) {
  const searchMatch = /===WEB SEARCH===([\s\S]*?)===END===/.exec(text || "");
  if (searchMatch) {
    const query = /QUERY:\s*(.*)/.exec(searchMatch[1])?.[1]?.trim();
    if (query) return { kind: "search", query };
  }
  const fetchMatch = /===WEB FETCH===([\s\S]*?)===END===/.exec(text || "");
  if (fetchMatch) {
    const url = /URL:\s*(\S+)/.exec(fetchMatch[1])?.[1]?.trim();
    if (url) return { kind: "fetch", url };
  }
  return null;
}

/**
 * Runs whatever tool the assistant asked for and returns the text to feed back.
 * Returns null when the message contains no tool request, which is the caller's
 * signal that the assistant's turn is finished.
 *
 * Errors are returned as text rather than thrown: a failed search should let the
 * model recover (retry differently, or tell the user it couldn't look it up), not
 * abort the whole conversation turn.
 */
async function runTools(text, settings = {}) {
  const call = parseToolCall(text);
  if (!call) return null;
  try {
    if (call.kind === "search") {
      return formatSearchResults(call.query, await search(call.query, settings));
    }
    return formatPage(await fetchPage(call.url));
  } catch (e) {
    const what = call.kind === "search" ? `поиска «${call.query}»` : `загрузки страницы ${call.url}`;
    return `Ошибка ${what}: ${e.message}\n\nСообщи об этом пользователю или попробуй другой запрос.`;
  }
}

module.exports = {
  search,
  fetchPage,
  formatSearchResults,
  formatPage,
  parseDuckDuckGoHtml,
  parseToolCall,
  runTools,
  WEB_TOOLS_HINT,
  TOOL_ROUND_LIMIT,
  MAX_RESULTS,
};
