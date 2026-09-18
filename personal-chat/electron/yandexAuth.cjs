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
  //
  // force_confirm=yes makes Yandex show the consent screen even when it has already
  // been given for this app. Without it, connecting a second account went straight
  // through with no screen at all — and no chance to notice it was the wrong account.
  return `${OAUTH_BASE}/authorize?response_type=code&force_confirm=yes&client_id=${encodeURIComponent(id)}`;
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
/**
 * Общая, ПОСТОЯННАЯ сессия окна входа.
 *
 * Раньше каждое подключение шло в чистой сессии — чтобы Яндекс не подсунул молча
 * уже подключённый аккаунт. Побочный эффект оказался дороже пользы: логин и
 * пароль приходилось вводить заново для каждого аккаунта, а их три, и будут ещё.
 *
 * Правильный ответ — не стирать память, а СПРАШИВАТЬ. За это отвечает
 * `force_confirm=yes` в адресе: Яндекс показывает экран подтверждения всегда, и
 * когда в сессии несколько аккаунтов — показывает их списком, с «Добавить
 * аккаунт» рядом. Один раз вошли — дальше выбираете из списка.
 *
 * Страховка от «молча не тот аккаунт» осталась, но переехала туда, где ей место:
 * после обмена кода на токен приложение спрашивает у Яндекса, чей это логин, и
 * сверяет со списком. Проверять итог надёжнее, чем надеяться на пустые куки.
 */
const OAUTH_PARTITION = "persist:yandex-oauth";

/** Забыть входы в окне: нужный аккаунт «залип» или компьютер общий. */
async function forgetSessions(session) {
  await session.fromPartition(OAUTH_PARTITION).clearStorageData();
}

function pickCodeInWindow(BrowserWindow, clientId, parent, { fresh = false } = {}) {
  return new Promise((resolve) => {
    const partition = OAUTH_PARTITION;
    const win = new BrowserWindow({
      parent,
      width: 620,
      height: 760,
      title: "Вход в Яндекс — войдите под тем аккаунтом, который добавляете",
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, partition },
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

    // Закрыли окно руками — значит «вставлю код сам» или «передумала».
    win.on("closed", () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    });

    /**
     * Не загрузилось — сказать почему, а не показывать белый экран.
     *
     * Белое окно без единого слова — худшее из возможных сообщений: человек не
     * знает, ждать ему или закрывать, и уж точно не знает, что чинить. Причина
     * же обычно простая и называется одним предложением: нет сети, мешает
     * прокси, или Client ID такой, какого у Яндекса нет.
     */
    // Причина показывается ОДИН раз. Показ причины сам по себе уводит окно на
    // другой адрес, и прерванная загрузка тут же рапортует «ERR_ABORTED» —
    // если это не остановить, служебная ошибка затирает настоящую, и человек
    // читает бессмыслицу вместо объяснения.
    let причинаПоказана = false;
    const показатьПричину = (текст) => {
      if (win.isDestroyed() || причинаПоказана) return;
      причинаПоказана = true;
      const html =
        "<!doctype html><meta charset=\"utf-8\">" +
        "<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:28px;color:#111}" +
        "h1{font-size:16px;margin:0 0 10px}code{background:#f2f3f5;padding:1px 4px;border-radius:4px}" +
        "ul{padding-left:18px}li{margin-bottom:6px}</style>" +
        `<h1>Страница входа Яндекса не открылась</h1><p>${текст}</p>` +
        "<p>Что бывает чаще всего:</p><ul>" +
        "<li>нет интернета или он идёт через прокси, который приложение не знает — проверьте «Настройки» → подключение;</li>" +
        "<li>в поле <code>Client ID</code> попал не тот номер или лишние символы — сверьте его на oauth.yandex.ru;</li>" +
        "<li>приложение на oauth.yandex.ru удалено или у него сменился идентификатор.</li>" +
        "</ul><p>Закройте это окно и попробуйте снова, когда причина устранена.</p>";
      win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)).catch(() => {});
    };

    // Ошибка -3 — это отмена самим приложением (мы сами уводим окно), про неё
    // сообщать нечего. Всё остальное человек должен увидеть.
    win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || settled || errorCode === -3) return;
      показатьПричину(
        `Яндекс не ответил: <code>${String(errorDescription || errorCode)}</code>.` +
          (validatedURL ? `<br>Адрес: <code>${String(validatedURL).slice(0, 120)}</code>` : "")
      );
    });

    // Чистим память только если попросили: обычный порядок — помнить входы.
    (fresh ? win.webContents.session.clearStorageData().catch(() => {}) : Promise.resolve())
      .then(() => {
        if (win.isDestroyed()) return;
        let url;
        try {
          url = authorizeUrl(clientId);
        } catch (e) {
          показатьПричину(String((e && e.message) || e));
          return;
        }
        // loadURL отклоняется при сетевом отказе — без этого перехвата окно
        // так и оставалось белым, а причина терялась в никуда.
        win.loadURL(url).catch((e) => показатьПричину(String((e && e.message) || e)));
      });
  });
}

module.exports = { authorizeUrl, extractCode, exchangeCode, refreshToken, pickCodeInWindow, forgetSessions, OAUTH_PARTITION };
