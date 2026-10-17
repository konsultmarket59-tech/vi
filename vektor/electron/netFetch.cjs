// Запросы главного процесса — через сетевой стек Electron, как в «Личном чате»:
// встроенный в Node fetch не видит системный прокси и VPN, а net.fetch не умеет
// отвечать на запрос пароля прокси. net.request умеет — на нём и собран fetch.
// Ответ отдаётся потоком: чат «Фигмы» получает ответ модели по мере генерации.
const { net } = require("electron");
const { Readable } = require("node:stream");

let proxyCredentials = { username: "", password: "" };
function setProxyCredentials(username, password) { proxyCredentials = { username: username || "", password: password || "" }; }

function headerPairs(headers) {
  const out = [];
  if (!headers) return out;
  if (typeof headers.forEach === "function" && !Array.isArray(headers)) { headers.forEach((v, k) => out.push([k, v])); return out; }
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, String(v)]);
  for (const [k, v] of Object.entries(headers)) out.push([k, String(v)]);
  return out;
}
function toResponseHeaders(raw) {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw || {})) for (const x of Array.isArray(v) ? v : [v]) { try { h.append(k, String(x)); } catch { } }
  return h;
}
const abortError = () => new DOMException("The operation was aborted.", "AbortError");

function proxyAwareFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input && input.url;
  const signal = init.signal;
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    let request;
    try { request = net.request({ method: (init.method || "GET").toUpperCase(), url, redirect: "follow" }); } catch (e) { return reject(e); }
    for (const [k, v] of headerPairs(init.headers)) { try { request.setHeader(k, v); } catch { } }
    // на запрос пароля отвечаем один раз и только прокси, не самому сайту
    let tried = false;
    request.on("login", (authInfo, callback) => {
      if (!authInfo.isProxy || !proxyCredentials.username || tried) return callback();
      tried = true;
      callback(proxyCredentials.username, proxyCredentials.password);
    });
    if (signal) signal.addEventListener("abort", () => { try { request.abort(); } catch { } reject(abortError()); }, { once: true });
    request.on("response", (res) => {
      const status = res.statusCode;
      const bodyless = status === 204 || status === 205 || status === 304 || (init.method || "GET").toUpperCase() === "HEAD";
      const body = bodyless ? null : Readable.toWeb(res);
      try { resolve(new Response(body, { status, statusText: res.statusMessage || "", headers: toResponseHeaders(res.headers) })); }
      catch (e) { reject(e); }
    });
    request.on("error", reject);
    const b = init.body;
    if (b != null) request.write(typeof b === "string" ? b : Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b));
    request.end();
  });
}

module.exports = { proxyAwareFetch, setProxyCredentials };
