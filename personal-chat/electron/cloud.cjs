// Cloud storage: Яндекс Диск and Google Drive.
//
// Both are reached with a plain OAuth access token that the user pastes in — the
// app never asks for the account password and stores nothing but the token, in the
// same local data folder as every other credential here.
//
// Deliberately not implemented: NotebookLM. Google publishes no API for it at all
// (no REST endpoints, no OAuth scopes), so there is nothing to connect to; the only
// way in is the web interface by hand.

const fs = require("node:fs/promises");
const path = require("node:path");

const yandexAuth = require("./yandexAuth.cjs");

const YANDEX_API = "https://cloud-api.yandex.net/v1/disk";
const GOOGLE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

const PROVIDERS = ["yandex", "google"];

function cloudDir(root) {
  return path.join(root, "cloud");
}
function accountsFile(root) {
  return path.join(cloudDir(root), "accounts.json");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

const DEFAULT_ACCOUNTS = {
  // clientId/clientSecret drive the OAuth exchange; the token and refreshToken are
  // what it produces. A token pasted by hand still works — the OAuth fields simply
  // stay empty in that case.
  yandex: { token: "", clientId: "", clientSecret: "", refreshToken: "", expiresAt: 0 },
  google: { token: "" },
};

async function getAccounts(root) {
  const stored = await readJson(accountsFile(root), {});
  return {
    yandex: { ...DEFAULT_ACCOUNTS.yandex, ...(stored.yandex || {}) },
    google: { ...DEFAULT_ACCOUNTS.google, ...(stored.google || {}) },
  };
}

async function saveAccounts(root, accounts) {
  await ensureDir(cloudDir(root));
  const yandex = accounts?.yandex || {};
  const sanitized = {
    yandex: {
      token: (yandex.token || "").trim(),
      clientId: (yandex.clientId || "").trim(),
      clientSecret: (yandex.clientSecret || "").trim(),
      refreshToken: (yandex.refreshToken || "").trim(),
      expiresAt: Number(yandex.expiresAt) || 0,
    },
    google: { token: (accounts?.google?.token || "").trim() },
  };
  await writeJson(accountsFile(root), sanitized);
  return sanitized;
}

/**
 * Returns a usable Yandex token, renewing it first if it is expired and we have the
 * means to. Yandex tokens do expire, and the failure mode without this is a silent
 * "Не авторизован" months later with no clue as to why.
 * Returns the (possibly updated) account so the caller can persist it.
 */
async function ensureYandexToken(account) {
  const expired = account.expiresAt && account.expiresAt < Date.now() + 60_000;
  if (!expired || !account.refreshToken || !account.clientId || !account.clientSecret) {
    return { account, renewed: false };
  }
  const fresh = await yandexAuth.refreshToken(account.clientId, account.clientSecret, account.refreshToken);
  return {
    account: {
      ...account,
      token: fresh.token,
      refreshToken: fresh.refreshToken || account.refreshToken,
      expiresAt: fresh.expiresAt,
    },
    renewed: true,
  };
}

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON — download endpoints return raw bytes, handled separately
  }
  if (!res.ok) {
    let message =
      json?.message || json?.description || json?.error?.message || `${res.status} ${res.statusText}`;
    if (res.status === 401) {
      // By far the most common cause: the Client ID from the app page was pasted
      // where an OAuth token belongs. They look nothing alike but both are opaque
      // strings, so the API's bare "Не авторизован" leaves no way to tell.
      message =
        "Не авторизован. Чаще всего это значит, что вставлен Client ID приложения, а не OAuth-токен — " +
        "это разные вещи. Заполните Client ID и Client secret и нажмите «Подключить Яндекс»: " +
        "приложение само получит токен. Если токен раньше работал — возможно, он истёк, подключитесь заново.";
    }
    throw new Error(message);
  }
  return json;
}

// ---------- Яндекс Диск ----------

function yandexHeaders(token) {
  return { Authorization: `OAuth ${token}` };
}

async function yandexTest(token) {
  const json = await request(`${YANDEX_API}/`, { headers: yandexHeaders(token) });
  return { ok: true, login: json?.user?.display_name || json?.user?.login || "" };
}

function normalizeYandexEntry(item) {
  return {
    name: item.name,
    path: item.path, // e.g. "disk:/Документы/файл.xlsx"
    isFolder: item.type === "dir",
    size: item.size ?? 0,
    modified: item.modified ? new Date(item.modified).getTime() : 0,
    mimeType: item.mime_type || "",
  };
}

async function yandexList(token, folderPath) {
  const target = folderPath || "disk:/";
  const url = `${YANDEX_API}/resources?path=${encodeURIComponent(target)}&limit=200&sort=name`;
  const json = await request(url, { headers: yandexHeaders(token) });
  return (json?._embedded?.items || []).map(normalizeYandexEntry);
}

async function yandexDownload(token, remotePath, destPath) {
  const meta = await request(
    `${YANDEX_API}/resources/download?path=${encodeURIComponent(remotePath)}`,
    { headers: yandexHeaders(token) }
  );
  if (!meta?.href) throw new Error("Яндекс Диск не выдал ссылку на скачивание.");
  const fileRes = await fetch(meta.href);
  if (!fileRes.ok) throw new Error(`Не удалось скачать файл (${fileRes.status}).`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  await fs.writeFile(destPath, buffer);
  return { path: destPath, size: buffer.length };
}

async function yandexUpload(token, localPath, remotePath) {
  const meta = await request(
    `${YANDEX_API}/resources/upload?path=${encodeURIComponent(remotePath)}&overwrite=true`,
    { headers: yandexHeaders(token) }
  );
  if (!meta?.href) throw new Error("Яндекс Диск не выдал ссылку на загрузку.");
  const body = await fs.readFile(localPath);
  const putRes = await fetch(meta.href, { method: meta.method || "PUT", body });
  if (!putRes.ok) throw new Error(`Не удалось загрузить файл (${putRes.status}).`);
  return { path: remotePath };
}

// ---------- Google Drive ----------

function googleHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function googleTest(token) {
  const json = await request(`${GOOGLE_API}/about?fields=user`, { headers: googleHeaders(token) });
  return { ok: true, login: json?.user?.emailAddress || json?.user?.displayName || "" };
}

function normalizeGoogleEntry(item) {
  return {
    name: item.name,
    path: item.id, // Drive addresses files by id, not by path
    isFolder: item.mimeType === "application/vnd.google-apps.folder",
    size: Number(item.size ?? 0),
    modified: item.modifiedTime ? new Date(item.modifiedTime).getTime() : 0,
    mimeType: item.mimeType || "",
  };
}

async function googleList(token, folderId) {
  const parent = folderId || "root";
  const q = encodeURIComponent(`'${parent}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime)");
  const json = await request(`${GOOGLE_API}/files?q=${q}&fields=${fields}&pageSize=200&orderBy=folder,name`, {
    headers: googleHeaders(token),
  });
  return (json?.files || []).map(normalizeGoogleEntry);
}

// Google-native documents can't be downloaded as-is; they have to be exported to a
// real file format first. These are the sensible equivalents.
const GOOGLE_EXPORT_TYPES = {
  "application/vnd.google-apps.document":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.google-apps.spreadsheet":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.google-apps.presentation":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const GOOGLE_EXPORT_EXTENSIONS = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};

async function googleDownload(token, fileId, destPath) {
  const meta = await request(`${GOOGLE_API}/files/${fileId}?fields=name,mimeType`, {
    headers: googleHeaders(token),
  });
  const exportType = GOOGLE_EXPORT_TYPES[meta?.mimeType];
  const url = exportType
    ? `${GOOGLE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportType)}`
    : `${GOOGLE_API}/files/${fileId}?alt=media`;
  const fileRes = await fetch(url, { headers: googleHeaders(token) });
  if (!fileRes.ok) throw new Error(`Не удалось скачать файл (${fileRes.status}).`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Give an exported Google Doc the extension its new format deserves.
  let finalPath = destPath;
  const wantExt = exportType ? GOOGLE_EXPORT_EXTENSIONS[exportType] : null;
  if (wantExt && !finalPath.toLowerCase().endsWith(wantExt)) finalPath += wantExt;

  await fs.writeFile(finalPath, buffer);
  return { path: finalPath, size: buffer.length, exported: !!exportType };
}

async function googleUpload(token, localPath, folderId, name) {
  const body = await fs.readFile(localPath);
  const metadata = {
    name: name || path.basename(localPath),
    ...(folderId && folderId !== "root" ? { parents: [folderId] } : {}),
  };
  // Multipart upload: one request carrying both the metadata and the bytes.
  const boundary = "pc-" + Date.now().toString(36);
  const parts = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const json = await request(`${GOOGLE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
    method: "POST",
    headers: { ...googleHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` },
    body: parts,
  });
  return { id: json?.id, name: json?.name };
}

// ---------- provider dispatch ----------

async function testConnection(provider, token) {
  if (!token?.trim()) return { ok: false, error: "Токен не задан." };
  try {
    return provider === "yandex" ? await yandexTest(token.trim()) : await googleTest(token.trim());
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function list(provider, token, folder) {
  if (!token?.trim()) throw new Error("Сначала подключите облако — вставьте токен в разделе «Облако».");
  return provider === "yandex" ? yandexList(token.trim(), folder) : googleList(token.trim(), folder);
}

async function download(provider, token, remote, destPath) {
  if (!token?.trim()) throw new Error("Сначала подключите облако — вставьте токен в разделе «Облако».");
  return provider === "yandex"
    ? yandexDownload(token.trim(), remote, destPath)
    : googleDownload(token.trim(), remote, destPath);
}

async function upload(provider, token, localPath, remote, name) {
  if (!token?.trim()) throw new Error("Сначала подключите облако — вставьте токен в разделе «Облако».");
  return provider === "yandex"
    ? yandexUpload(token.trim(), localPath, remote)
    : googleUpload(token.trim(), localPath, remote, name);
}

module.exports = {
  PROVIDERS,
  ensureYandexToken,
  getAccounts,
  saveAccounts,
  testConnection,
  list,
  download,
  upload,
};
