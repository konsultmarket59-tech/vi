// Settings, proxy configuration and the model client.
//
// The wire format is OpenAI-compatible /chat/completions, which is what Polza.ai
// and every other aggregator we care about speak. Only baseUrl and the key change
// when switching provider, so nothing here is Polza-specific beyond the default.

const { app, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { setProxyCredentials } = require("./netFetch.cjs");

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
};

let configPath = null;
let cachedProxyAuth = { username: "", password: "" };

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
    if (res.status === 407) {
      return {
        ok: false,
        message:
          "Прокси требует логин и пароль, а те, что указаны, он не принял. Проверьте, " +
          "что это логин от прокси, а не от Polza.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Прокси работает, но API-ключ отклонён (${res.status}).` };
    }
    if (!res.ok) return { ok: false, message: `Ответ сервера: ${res.status} ${res.statusText}.` };
    return { ok: true, message: "Соединение установлено, ключ принят." };
  } catch (e) {
    const msg = String(e?.message || e);
    let hint = "";
    if (msg.includes("ERR_PROXY_CONNECTION_FAILED")) hint = " Адрес или порт прокси недоступны.";
    if (msg.includes("ERR_NAME_NOT_RESOLVED")) hint = " Не удалось разрешить имя хоста.";
    if (msg.includes("ERR_CERT")) hint = " Windows не доверяет сертификату этого адреса.";
    return { ok: false, message: msg + hint };
  } finally {
    await applyProxy(await load());
  }
}

async function listModels(settings) {
  const active = settings?.apiKey ? settings : await load();
  if (!active.apiKey) throw new Error("Не задан API-ключ. Вставьте ключ Polza в настройках.");
  const res = await fetch(active.baseUrl.replace(/\/+$/, "") + "/models", {
    headers: { Authorization: `Bearer ${active.apiKey}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Не удалось получить список моделей (${res.status}). ${detail.slice(0, 300)}`);
  }
  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((m) => ({ id: m.id, name: m.name || m.id }))
    .filter((m) => m.id)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** One non-streaming completion. The agent loop calls this per round. */
async function callModel(settings, messages, { signal } = {}) {
  if (!settings.apiKey) throw new Error("Не задан API-ключ. Вставьте ключ Polza в настройках.");
  if (!settings.model) throw new Error("Не выбрана модель.");
  const res = await fetch(settings.baseUrl.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false,
    }),
    signal,
  });
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
  init,
  load,
  save,
  readSection,
  writeSection,
  applyProxy,
  proxyAuth,
  testProxy,
  listModels,
  callModel,
  stripWindowsExtendedPrefix,
};
