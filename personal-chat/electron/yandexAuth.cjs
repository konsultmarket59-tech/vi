// Yandex OAuth, shared by Яндекс Диск and Яндекс Директ.
//
// Why this exists: creating an app at oauth.yandex.ru hands you a Client ID and a
// Client secret — not a token. Those two are credentials for *asking* Yandex for a
// token on behalf of an account, and pasting the Client ID where a token is expected
// gets a flat "Не авторизован" from every Yandex API. So the app performs the real
// authorization-code exchange instead of asking the user to find a token by hand.
//
// The flow: open Yandex's consent page → Yandex issues a short-lived confirmation
// code → exchange code + client_id + client_secret for an access token (plus a
// refresh token, since Yandex access tokens expire, typically after a year but
// sooner if the app is reconfigured).

const OAUTH_BASE = "https://oauth.yandex.ru";

function authorizeUrl(clientId) {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("Не задан Client ID.");
  // No redirect_uri is sent on purpose: Yandex then uses whatever the app itself is
  // configured with, which avoids "redirect_uri mismatch" for an app the user set up
  // without thinking about callbacks.
  return `${OAUTH_BASE}/authorize?response_type=code&client_id=${encodeURIComponent(id)}`;
}

/** Pulls the confirmation code out of a callback URL, from the query or the fragment. */
function extractCode(url) {
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get("code");
    if (fromQuery) return fromQuery;
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    return fragment.get("code");
  } catch {
    return null;
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // Yandex's own error text is the useful part; error_description explains
    // things like a code that was already used or has expired.
    const reason = body.error_description || body.error || `${res.status} ${res.statusText}`;
    throw new Error(`Яндекс не выдал токен: ${reason}`);
  }
  return {
    token: body.access_token,
    refreshToken: body.refresh_token || "",
    // expires_in is seconds; store the moment it dies so a refresh can be timed.
    expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : 0,
  };
}

function exchangeCode(clientId, clientSecret, code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) throw new Error("Не введён код подтверждения.");
  return tokenRequest({
    grant_type: "authorization_code",
    code: trimmed,
    client_id: String(clientId || "").trim(),
    client_secret: String(clientSecret || "").trim(),
  });
}

function refreshToken(clientId, clientSecret, token) {
  if (!token) throw new Error("Нет refresh-токена — пройдите подключение заново.");
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: token,
    client_id: String(clientId || "").trim(),
    client_secret: String(clientSecret || "").trim(),
  });
}

/**
 * Opens Yandex's consent page in a window of our own and waits for the confirmation
 * code to show up in the address bar.
 *
 * Watching navigation is what makes this a two-click affair instead of "find the code
 * on the page and copy it": Yandex redirects to its verification_code page carrying
 * the code, and that redirect is visible here. If the app is registered in a way that
 * only prints the code on screen, no code ever appears in a URL — the window stays
 * open and the caller falls back to the manual field, which is why this resolves with
 * null rather than throwing.
 */
function pickCodeInWindow(BrowserWindow, clientId, parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      width: 620,
      height: 760,
      title: "Вход в Яндекс",
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition: "yandex-oauth" },
    });

    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
      if (!win.isDestroyed()) win.destroy();
    };

    const onNavigate = (_event, url) => {
      const code = extractCode(url);
      if (code) finish(code);
    };
    win.webContents.on("did-navigate", onNavigate);
    win.webContents.on("did-navigate-in-page", onNavigate);
    win.webContents.on("did-redirect-navigation", (_e, url) => onNavigate(null, url));

    // Closing the window by hand means "I'll paste the code myself" (or "never mind").
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    win.loadURL(authorizeUrl(clientId));
  });
}

module.exports = { authorizeUrl, extractCode, exchangeCode, refreshToken, pickCodeInWindow };
