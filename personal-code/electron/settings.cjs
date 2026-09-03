// Settings, proxy configuration and the model client.
//
// The wire format is OpenAI-compatible /chat/completions, which is what Polza.ai
// and every other aggregator we care about speak. Only baseUrl and the key change
// when switching provider, so nothing here is Polza-specific beyond the default.

const { app, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { setProxyCredentials } = require("./netFetch.cjs");
const connectionError = require("./connectionError.cjs");

// On some Windows setups (a OneDrive-redirected Documents folder does this)
// app.getPath() returns a "\\?\"-prefixed extended-length path that path.join
// mangles. We never need the extended form for our own short subpaths.
function stripWindowsExtendedPrefix(p) {
  return typeof p === "string" && p.startsWith("\\\\?\\") ? p.slice(4) : p;
}

const DEFAULT_SETTINGS = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.2,
  maxTokens: 16000,
  proxyMode: "system",
  proxyUrl: "",
  proxyUsername: "",
  proxyPassword: "",
  gitUserName: "",
  gitUserEmail: "",
  // Optional access token for pushing over HTTPS when the machine has no
  // credential helper set up. Stored in the app's own config folder, never in a
  // repository.
  gitToken: "",
  gitTokenUser: "",
  // Доступ агента в интернет — тот же набор, что и в «Личном чате», чтобы
  // настройка называлась и вела себя одинаково в обоих приложениях.
  // Кэш неизменной части промпта — то же имя настройки, что в «Личном чате».
  promptCache: true,
  searchEnabled: false,
  searchProvider: "duckduckgo",
  searchApiKey: "",
  // Папка, где лежит архив плагинов. Пустая строка — «Документы», как по
  // умолчанию; пользователь может перенести её на другой диск.
  dataRoot: "",
  // Репозиторий с каноническим «Личным чатом»: код копий берётся оттуда, а не
  // из папки на компьютере — папки может не быть вовсе.
  sourceRepo: "konsultmarket59-tech/vi",
};

let configPath = null;
let cachedProxyAuth = { username: "", password: "" };

/**
 * Папка с данными: выбранная человеком или «Документы» по умолчанию. Здесь же
 * лежат архив плагинов и токен GitHub — настройки не должны жить в другом месте.
 */
function dataRootOf(settings) {
  const chosen = (settings?.dataRoot || "").trim();
  return chosen || stripWindowsExtendedPrefix(app.getPath("documents"));
}

/**
 * Вторая копия настроек — рядом с данными, а не в служебной папке приложения.
 *
 * Служебную папку сносит переустановка «начисто», смена имени приложения или
 * переезд на другой компьютер, и тогда ключ Polza, токен GitHub и прокси нужно
 * вводить заново — притом что всё остальное (плагины, копии) лежит в папке с
 * данными и переживает это спокойно. Файл обычный, не зашифрованный: у того,
 * кто откроет папку, ключ будет перед глазами — ровно как у токена GitHub,
 * который лежит там же с самого начала.
 */
function backupFile(settings) {
  return path.join(dataRootOf(settings), "Личный код", "настройки.json");
}

/**
 * Указатель на перенесённую папку с данными — в «Документах», где приложение
 * ищет по умолчанию. Без него обещание «настройки переживут переустановку»
 * было бы правдой только для тех, кто папку не переносил: на чистом месте
 * искать её было бы негде. Секретов в файле нет, только путь.
 */
function pointerFile() {
  return path.join(stripWindowsExtendedPrefix(app.getPath("documents")), "Личный код", "папка-с-данными.txt");
}

async function backup(settings) {
  try {
    const file = backupFile(settings);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ settings, savedAt: new Date().toISOString() }, null, 2), "utf-8");
    const pointer = pointerFile();
    if (path.resolve(file) !== path.resolve(backupFile({}))) {
      await fs.mkdir(path.dirname(pointer), { recursive: true });
      await fs.writeFile(pointer, dataRootOf(settings), "utf-8");
    }
    return file;
  } catch {
    // Резервная копия — удобство, а не условие работы: недоступная папка не
    // должна мешать сохранить настройки.
    return "";
  }
}

/**
 * Возвращает настройки из резервной копии, если в служебной папке их нет.
 * Ничего не перезаписывает молча: восстановление идёт только на пустом месте,
 * иначе свежая настройка проиграла бы старому файлу.
 */
async function restoreFromBackup() {
  const config = await readConfig();
  if (config.settings && Object.keys(config.settings).length) return null;
  try {
    let file = backupFile({});
    try {
      const moved = (await fs.readFile(pointerFile(), "utf-8")).trim();
      if (moved) file = backupFile({ dataRoot: moved });
    } catch {
      // Указателя нет — значит, папку не переносили.
    }
    const saved = JSON.parse(await fs.readFile(file, "utf-8"));
    if (!saved?.settings || !Object.keys(saved.settings).length) return null;
    await writeConfig({ ...config, settings: { ...DEFAULT_SETTINGS, ...saved.settings } });
    return saved.settings;
  } catch {
    return null;
  }
}

function init() {
  configPath = path.join(stripWindowsExtendedPrefix(app.getPath("userData")), "config.json");
}

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configPath, "utf-8"));
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

async function load() {
  const config = await readConfig();
  return { ...DEFAULT_SETTINGS, ...(config.settings || {}) };
}

async function save(settings) {
  const config = await readConfig();
  const merged = { ...DEFAULT_SETTINGS, ...(config.settings || {}), ...settings };
  await writeConfig({ ...config, settings: merged });
  await backup(merged);
  // Proxy changes must take effect without restarting the app.
  await applyProxy(merged);
  return merged;
}

/** Everything except the settings blob: recent workspaces, blueprints. */
async function readSection(key, fallback) {
  const config = await readConfig();
  return config[key] === undefined ? fallback : config[key];
}

async function writeSection(key, value) {
  const config = await readConfig();
  await writeConfig({ ...config, [key]: value });
  return value;
}

/**
 * Applies proxy settings to the default session, which both the renderer and
 * every main-process request go through, and refreshes the credentials the two
 * login handlers answer challenges with.
 */
async function applyProxy(settings) {
  cachedProxyAuth = {
    username: settings.proxyUsername || "",
    password: settings.proxyPassword || "",
  };
  setProxyCredentials(cachedProxyAuth.username, cachedProxyAuth.password);

  const mode = settings.proxyMode || "system";
  let config;
  if (mode === "manual" && settings.proxyUrl?.trim()) {
    config = { proxyRules: settings.proxyUrl.trim() };
  } else if (mode === "direct") {
    config = { mode: "direct" };
  } else {
    config = { mode: "system" };
  }
  try {
    await session.defaultSession.setProxy(config);
  } catch (e) {
    console.error("Не удалось применить настройки прокси:", e);
  }
}

function proxyAuth() {
  return cachedProxyAuth;
}

/**
 * Tries the draft proxy settings against the configured model endpoint — the
 * destination that actually matters, so DNS, the proxy itself, its
 * authentication and the API key are all exercised at once. Restores the saved
 * settings afterwards so a failed test never leaves the app on a dead proxy.
 */
async function testProxy(draft) {
  const settings = { ...(await load()), ...draft };
  await applyProxy(settings);
  // Chromium caches proxy credentials for the session once they work, so without
  // clearing them a wrong password can still appear to succeed.
  try {
    await session.defaultSession.clearAuthCache();
  } catch {
    /* not fatal — the test just becomes less strict */
  }
  try {
    const res = await fetch(settings.baseUrl.replace(/\/+$/, "") + "/models", {
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
    });
    if (res.status === 407) return { ok: false, message: connectionError.fromStatus(407) };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Прокси работает, но ключ API отклонён (${res.status}).` };
    }
    if (!res.ok) {
      const byStatus = connectionError.fromStatus(res.status);
      return { ok: false, message: byStatus || `Ответ сервера: ${res.status} ${res.statusText}.` };
    }
    return { ok: true, message: "Соединение установлено, ключ принят." };
  } catch (e) {
    return { ok: false, message: connectionError.explain(e, { what: "Адрес API" }) };
  } finally {
    await applyProxy(await load());
  }
}

async function listModels(settings) {
  const active = settings?.apiKey ? settings : await load();
  if (!active.apiKey) throw new Error("Не задан API-ключ. Вставьте ключ Polza в настройках.");
  let res;
  try {
    res = await fetch(active.baseUrl.replace(/\/+$/, "") + "/models", {
      headers: { Authorization: `Bearer ${active.apiKey}` },
    });
  } catch (e) {
    // Понятная причина собирается здесь, а не в окне: так её одинаково видят и
    // настройки, и всё остальное, что дёргает список моделей.
    throw new Error(connectionError.explain(e, { what: "Адрес API" }));
  }
  if (!res.ok) {
    const byStatus = connectionError.fromStatus(res.status);
    const detail = await res.text().catch(() => "");
    throw new Error(byStatus || `Сервис ответил ${res.status} ${res.statusText}. ${detail.slice(0, 200)}`.trim());
  }
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Тот же признак, что и в «Личном чате»: cache_control — это про модели
// Anthropic, остальные могут отклонить запрос из-за него.
function supportsPromptCaching(model) {
  return /(^|\/)(anthropic|claude)/i.test(model || "");
}

// Помнит на время работы приложения, принимает ли шлюз cache_control: одного
// отказа достаточно, чтобы больше не пробовать и не терять время на повторах.
let cacheFieldWorks;

/**
 * Помечает неизменную часть разговора как кэшируемую. У агента это системная
 * инструкция и карта проекта — они уходят одинаковыми в каждый раунд, а
 * оплачиваются без кэша каждый раз заново.
 *
 * Метка ставится на последнее системное сообщение: кэш работает по префиксу, а
 * дальше идёт переписка, которая меняется от раунда к раунду.
 */
function withCacheMarkers(messages) {
  let lastSystem = -1;
  messages.forEach((m, i) => {
    if (m.role === "system") lastSystem = i;
  });
  if (lastSystem === -1) return messages;
  return messages.map((m, i) =>
    i === lastSystem && typeof m.content === "string"
      ? { ...m, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : m
  );
}

function stripCacheMarkers(messages) {
  return messages.map((m) =>
    Array.isArray(m.content) ? { ...m, content: m.content.map((part) => part.text).join("\n\n") } : m
  );
}

/** One non-streaming completion. The agent loop calls this per round. */
async function callModel(settings, messages, { signal } = {}) {
  if (!settings.apiKey) throw new Error("Не задан API-ключ. Вставьте ключ Polza в настройках.");
  if (!settings.model) throw new Error("Не выбрана модель.");

  const wantCache =
    settings.promptCache !== false && supportsPromptCaching(settings.model) && cacheFieldWorks !== false;
  const send = (payload) =>
    fetch(settings.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages: payload,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        stream: false,
      }),
      signal,
    });

  const sent = wantCache ? withCacheMarkers(messages) : messages;
  let res = await send(sent);

  // Шлюз может не принять cache_control — тогда повторяем без него, а не
  // показываем человеку ошибку из-за необязательной оптимизации.
  if (!res.ok && wantCache && sent !== messages) {
    cacheFieldWorks = false;
    res = await send(stripCacheMarkers(sent));
  } else if (res.ok && wantCache && sent !== messages) {
    cacheFieldWorks = true;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ошибка API (${res.status} ${res.statusText}). ${detail.slice(0, 500)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Модель вернула пустой ответ.");
  return content;
}

module.exports = {
  DEFAULT_SETTINGS,
  supportsPromptCaching,
  withCacheMarkers,
  init,
  load,
  save,
  dataRootOf,
  backupFile,
  backup,
  restoreFromBackup,
  readSection,
  writeSection,
  applyProxy,
  proxyAuth,
  testProxy,
  listModels,
  callModel,
  stripWindowsExtendedPrefix,
};
