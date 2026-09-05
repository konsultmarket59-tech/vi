// Demo access control: a build handed to a tester runs only on the computer it
// was issued for, only until it expires, and can be switched off remotely.
//
// How it is put together, and why:
//
//   - A licence is a small signed file. It names the tester, the computer, and
//     an expiry date, and it is signed with an Ed25519 key that only the author
//     holds. The app carries the matching public key, so it can check a licence
//     with no server involved and no network at startup.
//   - Expiry is the real enforcement. A copy that never reaches the internet
//     still stops working on its own date.
//   - Revocation is the fast path: the app fetches a small signed list of
//     cancelled licences and refuses those. If it cannot reach the list it keeps
//     working until expiry, because a tester on a train must not be locked out
//     of a demo by a flaky connection.
//   - A build with no public key configured is not gated at all. That is what
//     keeps the author's own copy from ever locking her out.
//
// Honest limit: this is client-side. Everything needed to check the licence
// ships inside the app, so someone determined and technical can unpack the
// installer and remove the check. It stops copying between machines and makes
// "give the exe to a friend" not work by accident; it is not protection against
// a motivated attacker, and nothing running on someone else's computer can be.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

// How long a successful revocation check stays good before the app tries again.
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
// Network call at startup must never hold the app up for long.
const FETCH_TIMEOUT_MS = 8000;

let licencePath = null;
let statePath = null;

function init(userDataPath) {
  licencePath = path.join(userDataPath, "licence.json");
  statePath = path.join(userDataPath, "licence-state.json");
}

// ---------- build configuration ----------

/**
 * licence.json shipped with the build (never the tester's own licence — that is
 * a different file, in the user data folder). Absent means "not a demo build".
 */
function buildConfig() {
  const candidates = [path.join(__dirname, "..", "licence-config.json")];
  if (app?.isPackaged) {
    candidates.unshift(path.join(process.resourcesPath, "licence-config.json"));
    candidates.unshift(path.join(process.resourcesPath, "app", "licence-config.json"));
  }
  for (const file of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.publicKey) return null;
      return {
        publicKey: String(parsed.publicKey),
        revocationUrl: parsed.revocationUrl ? String(parsed.revocationUrl) : "",
        productName: parsed.productName ? String(parsed.productName) : "",
      };
    } catch (e) {
      // A corrupt config must not silently disable the gate on a demo build, but
      // it also must not brick the app. Treat it as "gated, cannot verify".
      console.error("licence-config.json не разобран:", e.message);
      return { publicKey: "", revocationUrl: "", productName: "", broken: true };
    }
  }
  return null;
}

// ---------- machine fingerprint ----------

let cachedFingerprint = null;

/**
 * A stable per-machine value, hashed. Reads an id the OS already keeps for its
 * own purposes rather than anything about the person: no name, no serial number
 * of anything they own leaves the machine — only a hash, and only when they
 * choose to send their activation code.
 */
function machineFingerprint() {
  if (cachedFingerprint) return cachedFingerprint;
  let raw = "";
  try {
    if (process.platform === "win32") {
      const out = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf-8", timeout: 5000, windowsHide: true }
      );
      raw = (out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i) || [])[1] || "";
    } else if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      raw = (out.match(/IOPlatformUUID"\s*=\s*"([^"]+)"/) || [])[1] || "";
    } else {
      for (const file of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
        try {
          raw = fs.readFileSync(file, "utf-8").trim();
          if (raw) break;
        } catch {
          /* try the next one */
        }
      }
    }
  } catch (e) {
    console.error("Не удалось прочитать идентификатор компьютера:", e.message);
  }

  if (!raw) {
    // Nothing readable — fall back to something stable-ish so activation still
    // works. Weaker binding, but better than refusing to run at all.
    raw = `fallback:${process.platform}:${require("node:os").hostname()}`;
  }
  // 20 hex characters — 80 bits, far more than enough to tell ten computers
  // apart, and short enough to read out over the phone. This exact string is
  // what a licence is bound to, so it must match what the author is sent: the
  // code on screen is only this value with dashes for legibility.
  cachedFingerprint = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20).toUpperCase();
  return cachedFingerprint;
}

/** What the tester reads off the screen and sends: grouped for copying by hand. */
function activationCode() {
  return (machineFingerprint().match(/.{1,5}/g) || []).join("-");
}

/** Accepts the code however it was typed back: dashes, spaces, lower case. */
function normalizeMachineCode(code) {
  return String(code || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

// ---------- signing helpers ----------

/** Deterministic serialisation, so the bytes signed are the bytes verified. */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

function verifySignature(payload, signatureB64, publicKeyB64) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(canonical(payload), "utf-8"), key, Buffer.from(signatureB64, "base64"));
  } catch (e) {
    console.error("Проверка подписи не удалась:", e.message);
    return false;
  }
}

// ---------- stored licence and state ----------

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

async function readState() {
  return readJson(statePath, { lastCheckAt: 0, revoked: false, lastError: "" });
}

// ---------- revocation ----------

/**
 * Fetches the signed revocation list. Returns null when it could not be reached
 * or could not be trusted — the caller treats that as "no new information",
 * never as "revoked".
 */
async function fetchRevocations(url, publicKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.list || !body?.signature) return null;
    if (!verifySignature(body.list, body.signature, publicKey)) {
      // Someone served a list we did not sign. Ignore it — an unsigned list must
      // never be able to switch someone off, or anyone able to intercept the
      // connection could disable every copy.
      console.error("Список отзыва подписан неверно — игнорирую.");
      return null;
    }
    return Array.isArray(body.list.revoked) ? body.list.revoked.map(String) : [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- status ----------

/**
 * The single question the app asks: may this copy run?
 *
 * Returns { gated, ok, reason, ... }. gated:false means this build has no
 * licensing at all and everything below is irrelevant.
 */
/** Сколько дней выдали: разница между выдачей и окончанием, а не остаток. */
function totalDays(issuedAt, expiresAt) {
  const issued = Date.parse(issuedAt || "");
  if (!Number.isFinite(issued) || !Number.isFinite(expiresAt)) return 0;
  return Math.max(1, Math.round((expiresAt - issued) / 86400000));
}

async function status({ allowNetwork = true } = {}) {
  const config = buildConfig();
  if (!config) {
    return { gated: false, ok: true, reason: "", machineCode: activationCode() };
  }
  if (config.broken || !config.publicKey) {
    return {
      gated: true,
      ok: false,
      reason: "config",
      message: "Файл настроек демо-доступа повреждён. Обратитесь к автору приложения.",
      machineCode: activationCode(),
    };
  }

  const stored = await readJson(licencePath, null);
  if (!stored?.licence || !stored?.signature) {
    return {
      gated: true,
      ok: false,
      reason: "missing",
      message: "Приложение ещё не активировано.",
      machineCode: activationCode(),
      productName: config.productName,
    };
  }

  const licence = stored.licence;

  if (!verifySignature(licence, stored.signature, config.publicKey)) {
    return {
      gated: true,
      ok: false,
      reason: "signature",
      message: "Файл активации не проходит проверку подписи — он повреждён или выдан не для этой сборки.",
      machineCode: activationCode(),
      productName: config.productName,
    };
  }

  if (licence.machine !== machineFingerprint()) {
    return {
      gated: true,
      ok: false,
      reason: "machine",
      message: "Этот файл активации выдан для другого компьютера.",
      machineCode: activationCode(),
      productName: config.productName,
    };
  }

  const expiresAt = Date.parse(licence.expiresAt || "");
  if (!Number.isFinite(expiresAt)) {
    return {
      gated: true,
      ok: false,
      reason: "signature",
      message: "В файле активации не указан срок действия.",
      machineCode: activationCode(),
      productName: config.productName,
    };
  }
  if (Date.now() > expiresAt) {
    return {
      gated: true,
      ok: false,
      reason: "expired",
      message: `Срок демо-доступа закончился ${new Date(expiresAt).toLocaleDateString("ru-RU")}.`,
      machineCode: activationCode(),
      tester: licence.tester,
      expiresAt: licence.expiresAt,
      issuedAt: licence.issuedAt || "",
      days: totalDays(licence.issuedAt, expiresAt),
      productName: config.productName,
      displayName: licence.displayName || "",
    };
  }

  // Revocation. The list is advisory: only a correctly signed list naming this
  // licence turns the app off, and a failed check changes nothing.
  const state = await readState();
  let revoked = state.revoked === true;
  const url = licence.revocationUrl || config.revocationUrl;
  const due = Date.now() - (state.lastCheckAt || 0) > CHECK_INTERVAL_MS;

  if (allowNetwork && url && (due || revoked)) {
    const list = await fetchRevocations(url, config.publicKey);
    if (list !== null) {
      revoked = list.includes(String(licence.id));
      await writeJson(statePath, { lastCheckAt: Date.now(), revoked, lastError: "" });
    } else {
      await writeJson(statePath, { ...state, lastError: "Не удалось проверить список отзыва." });
    }
  }

  if (revoked) {
    return {
      gated: true,
      ok: false,
      reason: "revoked",
      message: "Доступ к этой копии отозван автором приложения.",
      machineCode: activationCode(),
      tester: licence.tester,
      productName: config.productName,
      displayName: licence.displayName || "",
    };
  }

  const daysLeft = Math.ceil((expiresAt - Date.now()) / 86400000);
  return {
    gated: true,
    ok: true,
    reason: "",
    machineCode: activationCode(),
    tester: licence.tester,
    expiresAt: licence.expiresAt,
    issuedAt: licence.issuedAt || "",
    // Весь срок, а не только остаток: копия говорит «демо-версия на 5 дней»
    // теми же словами, какими автор его выдавал.
    days: totalDays(licence.issuedAt, expiresAt),
    daysLeft,
    productName: config.productName,
    // Заголовок именно этой копии: «Личный чат Виктории». Приходит в лицензии,
    // поэтому одна и та же сборка у разных людей подписана по-разному.
    displayName: licence.displayName || "",
  };
}

/**
 * Installs a licence file the tester received. Verified before it is stored, so
 * a wrong or tampered file is rejected with an explanation instead of being
 * saved and failing confusingly on the next start.
 */
async function activate(fileContents) {
  const config = buildConfig();
  if (!config?.publicKey) throw new Error("Эта сборка не требует активации.");

  let parsed;
  try {
    parsed = typeof fileContents === "string" ? JSON.parse(fileContents) : fileContents;
  } catch {
    throw new Error("Это не файл активации — не удалось прочитать его содержимое.");
  }
  if (!parsed?.licence || !parsed?.signature) throw new Error("В файле нет данных активации.");
  if (!verifySignature(parsed.licence, parsed.signature, config.publicKey)) {
    throw new Error("Файл активации не проходит проверку подписи — он повреждён или выдан для другой сборки.");
  }
  if (parsed.licence.machine !== machineFingerprint()) {
    throw new Error(
      `Файл выдан для другого компьютера. Код этого компьютера: ${activationCode()} — отправьте его автору.`
    );
  }
  const expiresAt = Date.parse(parsed.licence.expiresAt || "");
  if (!Number.isFinite(expiresAt)) throw new Error("В файле активации не указан срок действия.");
  if (Date.now() > expiresAt) throw new Error("Срок действия этого файла активации уже истёк.");

  await writeJson(licencePath, parsed);
  // A fresh licence starts with a clean revocation state, otherwise a reissued
  // licence would inherit the previous one's "revoked" flag.
  await writeJson(statePath, { lastCheckAt: 0, revoked: false, lastError: "" });
  return status({ allowNetwork: false });
}

module.exports = {
  init,
  buildConfig,
  machineFingerprint,
  activationCode,
  normalizeMachineCode,
  canonical,
  verifySignature,
  status,
  activate,
  CHECK_INTERVAL_MS,
};
