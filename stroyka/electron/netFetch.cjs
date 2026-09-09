// Proxy-aware fetch for the main process.
//
// Why this exists instead of just `global.fetch = net.fetch`:
//
//   - Node's built-in fetch ignores the OS/VPN proxy entirely — requests go direct.
//   - Electron's net.fetch does honour the proxy, but there is no way to answer a
//     proxy's authentication challenge on it. `app.on("login")` only fires for
//     requests that belong to a webContents (i.e. the renderer); main-process
//     net.fetch calls never reach it and just come back as a bare 407. Verified
//     against a real local proxy demanding Basic auth.
//   - Credentials embedded in the proxy URL (http://user:pass@host:port) are
//     rejected by Chromium with ERR_NO_SUPPORTED_PROXIES, so that shortcut is out.
//
// net.request *does* expose a per-request "login" event, so this wraps it in a
// fetch-shaped API and answers the challenge there. Everything the main process
// actually needs from a Response (ok/status/statusText/json/text/arrayBuffer/
// headers.get) comes free by handing the buffered body to the standard Response
// constructor. Responses are fully buffered — nothing in the main process streams.

const { net } = require("electron");

// Kept in memory so the login handler can answer synchronously; refreshed by
// main.cjs whenever settings are saved.
let proxyCredentials = { username: "", password: "" };

function setProxyCredentials(username, password) {
  proxyCredentials = { username: username || "", password: password || "" };
}

function normalizeHeaders(headers) {
  const out = [];
  if (!headers) return out;
  if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
    headers.forEach((value, key) => out.push([key, value]));
    return out;
  }
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, String(v)]);
  for (const [k, v] of Object.entries(headers)) out.push([k, String(v)]);
  return out;
}

/** Electron gives header values as arrays; Headers wants them appended one by one. */
function toResponseHeaders(raw) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw || {})) {
    for (const v of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(key, String(v));
      } catch {
        // ignore header names Headers refuses (Electron surfaces a few pseudo-headers)
      }
    }
  }
  return headers;
}

function abortError() {
  return new DOMException("The operation was aborted.", "AbortError");
}

function proxyAwareFetch(input, init = {}) {
  const url = typeof input === "string" ? input : input?.url;
  const signal = init.signal;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());

    let request;
    try {
      request = net.request({ method: (init.method || "GET").toUpperCase(), url });
    } catch (e) {
      return reject(e);
    }

    for (const [key, value] of normalizeHeaders(init.headers)) request.setHeader(key, value);

    // Chromium re-issues the login event when the proxy rejects what we sent. Since
    // we'd only ever send the same saved password again, answering more than once
    // just burns ~30 failed auth attempts against the user's proxy before Chromium
    // gives up with ERR_TOO_MANY_RETRIES. Answer once, then decline so a wrong
    // password surfaces promptly as a plain 407.
    let loginAttempted = false;
    request.on("login", (authInfo, callback) => {
      // Only ever answer a proxy's challenge, never an origin server's own 401 —
      // the proxy password must not be offered to, say, Polza or GitHub.
      if (!authInfo.isProxy || !proxyCredentials.username || loginAttempted) return callback();
      loginAttempted = true;
      callback(proxyCredentials.username, proxyCredentials.password);
    });

    let onAbort;
    const cleanup = () => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
    };

    if (signal) {
      onAbort = () => {
        try {
          request.abort();
        } catch {
          // already finished
        }
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    request.on("response", (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("error", (e) => {
        cleanup();
        reject(e);
      });
      res.on("end", () => {
        cleanup();
        const status = res.statusCode;
        // Response refuses a body for these statuses; passing one throws.
        const bodyless = status === 204 || status === 205 || status === 304;
        try {
          resolve(
            new Response(bodyless ? null : Buffer.concat(chunks), {
              status,
              statusText: res.statusMessage || "",
              headers: toResponseHeaders(res.headers),
            })
          );
        } catch (e) {
          reject(e);
        }
      });
    });

    request.on("error", (e) => {
      cleanup();
      reject(e);
    });

    const body = init.body;
    if (body != null) {
      request.write(typeof body === "string" ? body : Buffer.from(body));
    }
    request.end();
  });
}

module.exports = { proxyAwareFetch, setProxyCredentials };
