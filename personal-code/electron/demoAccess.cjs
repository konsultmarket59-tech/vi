// Demo access console: issuing and cancelling access to demo copies of «Личный чат».
//
// The signing key lives here and nowhere else. It is generated on this computer,
// stored in this app's own settings folder, and never leaves it — not into the
// repository, not into a build, not into a licence file. What ships with a demo
// build is only the matching *public* key, which can verify signatures but not
// make them.
//
// Two things are produced:
//   - a licence file (.lic) per tester, bound to one computer with an end date;
//   - a revocation list, which the demo copies fetch to learn that a licence has
//     been cancelled early.
// Both are signed, so neither can be forged by someone who intercepts them, and
// an unsigned revocation list cannot be used to switch anyone off.

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

let keysPath = null;

function init(userDataPath) {
  keysPath = path.join(userDataPath, "demo-signing-key.json");
}

/** Deterministic serialisation — must match the verifier in the chat app exactly. */
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}

async function readKeys() {
  try {
    return JSON.parse(await fs.readFile(keysPath, "utf-8"));
  } catch {
    return null;
  }
}

async function keyInfo() {
  const keys = await readKeys();
  return {
    exists: Boolean(keys),
    publicKey: keys?.publicKey || "",
    createdAt: keys?.createdAt || "",
    path: keysPath,
  };
}

/**
 * Creates the signing key. Refuses to overwrite an existing one: every licence
 * already issued was signed with it, and a new key would invalidate all of them
 * at once, locking out the whole test group.
 */
async function createKeys() {
  if (await readKeys()) {
    throw new Error(
      "Ключ уже создан. Если создать новый, все выданные файлы активации перестанут работать — " +
        "сначала удалите старый ключ вручную, если вы уверены."
    );
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const record = {
    createdAt: new Date().toISOString(),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
  await fs.mkdir(path.dirname(keysPath), { recursive: true });
  await fs.writeFile(keysPath, JSON.stringify(record, null, 2), "utf-8");
  // Best effort on POSIX; Windows ignores the mode, where the per-user AppData
  // folder is the protection instead.
  await fs.chmod(keysPath, 0o600).catch(() => {});
  return keyInfo();
}

async function sign(payload) {
  const keys = await readKeys();
  if (!keys) throw new Error("Сначала создайте ключ подписи.");
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(keys.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(canonical(payload), "utf-8"), privateKey).toString("base64");
}

// ---------- testers ----------

function normalizeMachineCode(code) {
  return String(code || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function normalizeTester(tester) {
  return {
    id: tester.id || crypto.randomUUID(),
    name: (tester.name || "").trim(),
    // Заголовок именно этой копии: «Личный чат Виктории». Если не задан — собираем
    // из имени, чтобы не заставлять вписывать одно и то же дважды.
    displayName: (tester.displayName || "").trim(),
    machineCode: normalizeMachineCode(tester.machineCode),
    note: (tester.note || "").trim(),
    revoked: Boolean(tester.revoked),
    licenceId: tester.licenceId || "",
    issuedAt: tester.issuedAt || "",
    expiresAt: tester.expiresAt || "",
    createdAt: tester.createdAt || Date.now(),
  };
}

function validate(tester) {
  if (!tester.name) throw new Error("Не указано имя тестировщика.");
  if (tester.machineCode.length !== 20) {
    throw new Error(
      `Код компьютера должен состоять из 20 знаков (сейчас ${tester.machineCode.length}). ` +
        "Его показывает приложение на экране активации."
    );
  }
}

function list(stored) {
  return (stored || []).map(normalizeTester);
}

function save(stored, tester) {
  const next = normalizeTester(tester);
  validate(next);
  const all = list(stored);
  const index = all.findIndex((t) => t.id === next.id);
  // Two testers with the same computer code would each overwrite the other's
  // licence file on that machine, which is confusing rather than useful.
  const clash = all.find((t) => t.id !== next.id && t.machineCode === next.machineCode);
  if (clash) throw new Error(`Этот компьютер уже записан на «${clash.name}».`);
  if (index === -1) all.unshift(next);
  else all[index] = { ...all[index], ...next };
  return { all, saved: next };
}

function remove(stored, id) {
  return list(stored).filter((t) => t.id !== id);
}

// ---------- licences ----------

/**
 * Issues a licence for one tester. Re-issuing gives a fresh licence id, so the
 * previous one can stay on the revocation list without affecting the new file.
 */
async function issue(stored, id, { days = 30, productName = "Личный чат", revocationUrl = "" } = {}) {
  const all = list(stored);
  const tester = all.find((t) => t.id === id);
  if (!tester) throw new Error("Тестировщик не найден.");
  validate(tester);
  const span = Math.max(1, Math.min(365, Math.round(Number(days) || 30)));

  const licence = {
    id: crypto.randomUUID(),
    tester: tester.name,
    displayName: tester.displayName || `${productName} ${tester.name}`.trim(),
    machine: tester.machineCode,
    product: productName,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + span * 86400000).toISOString(),
    revocationUrl: revocationUrl || "",
  };
  const file = { licence, signature: await sign(licence) };

  const updated = {
    ...tester,
    licenceId: licence.id,
    issuedAt: licence.issuedAt,
    expiresAt: licence.expiresAt,
    revoked: false,
  };
  return {
    all: all.map((t) => (t.id === id ? updated : t)),
    tester: updated,
    fileName: `${tester.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 40) || "licence"}.lic`,
    contents: JSON.stringify(file, null, 2),
  };
}

/** The signed list the demo copies fetch. Cancelled licences are named by id. */
async function revocationList(stored) {
  const revoked = list(stored)
    .filter((t) => t.revoked && t.licenceId)
    .map((t) => t.licenceId);
  const payload = { revoked, updatedAt: new Date().toISOString() };
  return JSON.stringify({ list: payload, signature: await sign(payload) }, null, 2);
}

function setRevoked(stored, id, revoked) {
  return list(stored).map((t) => (t.id === id ? { ...t, revoked: Boolean(revoked) } : t));
}

// ---------- build configuration ----------

/**
 * Writes licence-config.json into the chat app's source folder. Its presence is
 * what turns a build into a gated demo; without it the build has no licensing.
 */
async function exportConfig(
  targetDir,
  { revocationUrl = "", productName = "", apiKey = "", baseUrl = "", model = "", prices = {}, currency = "₽" } = {}
) {
  const keys = await readKeys();
  if (!keys) throw new Error("Сначала создайте ключ подписи.");
  await fs.mkdir(targetDir, { recursive: true });

  const file = path.join(targetDir, "licence-config.json");
  await fs.writeFile(
    file,
    JSON.stringify({ publicKey: keys.publicKey, revocationUrl, productName }, null, 2),
    "utf-8"
  );

  // Ключ доступа к моделям — отдельный файл: он нужен не для проверки лицензии,
  // а для работы самих запросов, и его наличие не должно молча включать или
  // выключать демо-режим.
  const managedFile = path.join(targetDir, "managed-config.json");
  let managed = false;
  if (apiKey.trim()) {
    await fs.writeFile(
      managedFile,
      JSON.stringify({ apiKey: apiKey.trim(), baseUrl, model, currency, prices }, null, 2),
      "utf-8"
    );
    managed = true;
  } else {
    // Пустой ключ означает «обычная сборка»: старый файл нужно убрать, иначе
    // прошлый ключ уедет в новую сборку незаметно для автора.
    await fs.rm(managedFile, { force: true });
  }

  return { file, managedFile: managed ? managedFile : "", revocationUrl, managed };
}

/**
 * Разбирает таблицу цен, введённую построчно:
 *   anthropic/claude-sonnet-5  300  1500
 * Числа — цена за 1 000 000 токенов: сначала входящие, потом исходящие.
 */
function parsePrices(text) {
  const prices = {};
  const problems = [];
  for (const rawLine of String(text || "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 3) {
      problems.push(`Строка «${line}»: нужно «модель цена_вход цена_выход».`);
      continue;
    }
    const model = parts[0];
    const input = Number(parts[1].replace(",", "."));
    const output = Number(parts[2].replace(",", "."));
    if (!Number.isFinite(input) || !Number.isFinite(output)) {
      problems.push(`Строка «${line}»: цены должны быть числами.`);
      continue;
    }
    prices[model] = { input, output };
  }
  return { prices, problems };
}

function formatPrices(prices) {
  return Object.entries(prices || {})
    .map(([model, price]) => `${model} ${price.input} ${price.output}`)
    .join("\n");
}

module.exports = {
  init,
  canonical,
  keyInfo,
  createKeys,
  sign,
  normalizeMachineCode,
  list,
  save,
  remove,
  issue,
  revocationList,
  setRevoked,
  exportConfig,
  parsePrices,
  formatPrices,
};
