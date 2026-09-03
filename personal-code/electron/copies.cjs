// Копии «Личного чата»: кому выдана, из чего собрана, где её репозиторий.
//
// Раньше это были три несвязанные вещи: сборка (набор модулей), тестировщик
// (кому выдан доступ) и репозиторий, который заводили руками. На деле это одна
// сущность — копия для конкретного человека или компании, — и разъезжались они
// именно потому, что хранились порознь: имя в лицензии одно, название в сборке
// другое, репозиторий третий.
//
// Копия бывает двух видов, и различие ровно одно — кто платит за модели:
//
//   demo  — ключ Polza вшит автором, пользователь его не видит и не вводит.
//           Срок ограничен, копия привязана к компьютеру и отключается отзывом.
//   paid  — пользователь работает со своим ключом Polza и видит поле ключа.
//           Привязка к компьютеру остаётся, если её не снять: это защита от
//           копирования, а не способ отключить оплаченную работу.
//
// Никаких данных внутри копии не заводится: документы, навыки и проекты человек
// создаёт сам, как в каноническом чате.

const crypto = require("node:crypto");

// Что можно включить в копию. База (projects, skills) есть всегда; Excel и Word
// — обычная часть конфигурации; остальное — плагины, которые отмечают отдельно.
const BASE_MODULES = ["projects", "skills"];
const OFFICE_MODULES = ["excel", "word"];

const PLUGINS = [
  { id: "docflow", name: "📁 Документооборот" },
  { id: "dataviz", name: "📊 Визуализация" },
  { id: "finmodel", name: "💹 Финмодель" },
  { id: "cleanup", name: "🧹 Клининг" },
  { id: "media", name: "🎨 Медиа" },
  { id: "cloud", name: "☁️ Облако" },
  { id: "direct", name: "📣 Директ" },
  { id: "chatbots", name: "🤖 Чат-боты" },
];

const PLUGIN_IDS = PLUGINS.map((p) => p.id);

/** Имя копии в окне у пользователя: «Личный чат Марии». */
function displayNameFor(name) {
  const clean = String(name || "").trim();
  return clean ? `Личный чат ${clean}` : "Личный чат";
}

/** Имя репозитория из имени копии: латиницей, без пробелов. */
function repoNameFor(name) {
  const translit = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const slug = String(name || "")
    .toLowerCase()
    .split("")
    .map((ch) => (translit[ch] !== undefined ? translit[ch] : ch))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug ? `personal-chat-${slug}` : "personal-chat-copy";
}

function normalizeMachineCode(code) {
  return String(code || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function normalize(copy) {
  const kind = copy.kind === "paid" ? "paid" : "demo";
  const name = String(copy.name || "").trim();
  const chosenPlugins = (copy.plugins || []).filter((id) => PLUGIN_IDS.includes(id));
  const office = (copy.office || OFFICE_MODULES).filter((id) => OFFICE_MODULES.includes(id));
  return {
    id: copy.id || crypto.randomUUID(),
    kind,
    name,
    displayName: String(copy.displayName || "").trim() || displayNameFor(name),
    note: String(copy.note || "").trim(),

    // Конфигурация копии.
    office,
    plugins: chosenPlugins,

    // Доступ к моделям. У демо ключ вшит и скрыт, у оплаченной — свой у человека.
    apiKey: kind === "demo" ? String(copy.apiKey || "").trim() : "",
    baseUrl: String(copy.baseUrl || "https://polza.ai/api/v1").trim(),
    model: String(copy.model || "anthropic/claude-sonnet-5").trim(),
    pricesText: String(copy.pricesText || ""),
    currency: String(copy.currency || "₽").trim(),

    // Срок и привязка к компьютеру.
    days: Math.max(1, Math.min(3650, Math.round(Number(copy.days) || (kind === "demo" ? 5 : 365)))),
    // Оплаченную копию тоже привязываем к компьютеру, если владелица не снимет
    // галочку: это и есть защита от копирования.
    copyProtection: copy.copyProtection !== false,
    machineCode: normalizeMachineCode(copy.machineCode),
    revocationUrl: String(copy.revocationUrl || "").trim(),

    // Где живёт эта копия.
    repoName: String(copy.repoName || "").trim() || repoNameFor(name),
    repoFullName: String(copy.repoFullName || "").trim(),
    // У оплаченной копии — репозиторий, который был у демо: доработки идут туда
    // же, а не в новое место.
    fromCopyId: String(copy.fromCopyId || "").trim(),
    sourceBranch: String(copy.sourceBranch || "").trim(),

    // Выданный доступ.
    licenceId: String(copy.licenceId || "").trim(),
    revokedLicenceIds: Array.isArray(copy.revokedLicenceIds)
      ? [...new Set(copy.revokedLicenceIds.map(String).filter(Boolean))]
      : [],
    issuedAt: copy.issuedAt || "",
    expiresAt: copy.expiresAt || "",
    revoked: copy.revoked === true,

    builtAt: copy.builtAt || "",
    createdAt: copy.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function list(stored) {
  return (stored || []).map(normalize);
}

function validate(copy) {
  if (!copy.name) throw new Error("Не указано, для кого копия — имя или название компании.");
  if (copy.kind === "demo" && !copy.apiKey) {
    throw new Error(
      "Для демо-копии нужен ключ Polza: пользователь его не вводит и не видит. " +
        "Заведите отдельный ключ с небольшим балансом — его не жалко отозвать."
    );
  }
  if (!copy.repoName) throw new Error("Не указано название репозитория.");
}

function save(stored, copy) {
  const next = normalize(copy);
  validate(next);
  const all = list(stored);
  const index = all.findIndex((c) => c.id === next.id);
  // Оплаченная копия намеренно продолжает жить в репозитории своего демо
  // (fromCopyId) — это не столкновение, а перенос, который UI сам предлагает.
  // Совпадение имени с чужой, не связанной копией — вот что здесь ловится.
  const clash = all.find(
    (c) => c.id !== next.id && c.repoName === next.repoName && next.fromCopyId !== c.id && c.fromCopyId !== next.id
  );
  if (clash) throw new Error(`Репозиторий «${next.repoName}» уже занят копией «${clash.name}».`);
  if (index === -1) {
    all.unshift(next);
    return { all, saved: next };
  }
  // История отзывов живёт в записи копии, а форма о ней не знает.
  const merged = {
    ...all[index],
    ...next,
    revokedLicenceIds: [...new Set([...all[index].revokedLicenceIds, ...next.revokedLicenceIds])],
  };
  all[index] = merged;
  return { all, saved: merged };
}

function remove(stored, id) {
  return list(stored).filter((c) => c.id !== id);
}

/** Набор модулей для plugins.json: база + офис + отмеченные плагины. */
function modulesOf(copy) {
  return [...new Set([...BASE_MODULES, ...copy.office, ...copy.plugins])];
}

/**
 * Копия как «сборка» для конвейера build.cjs — чтобы у сборки и у копии не
 * оказалось двух разных представлений одного и того же.
 */
function toBlueprint(copy, { sourcePath = "", branch = "" } = {}) {
  return {
    id: copy.id,
    name: copy.name,
    productName: copy.displayName,
    modules: modulesOf(copy),
    sourcePath,
    branch,
    apiKey: copy.apiKey,
    baseUrl: copy.baseUrl,
    model: copy.model,
    pricesText: copy.pricesText,
    currency: copy.currency,
    skills: [],
    // Демо всегда просит активацию. Оплаченная — если не снята защита от
    // копирования: без неё файл копии работает на любом компьютере.
    demoGated: copy.kind === "demo" ? true : copy.copyProtection,
    revocationUrl: copy.revocationUrl,
  };
}

/**
 * Лицензия для копии: тот же формат, что проверяет «Личный чат», собранный из
 * данных копии. Подписывает вызывающая сторона — закрытый ключ живёт только в
 * demoAccess.cjs.
 */
function licenceFor(copy, { days = 0 } = {}) {
  const span = Math.max(1, Math.min(3650, Math.round(Number(days) || copy.days)));
  if (!copy.machineCode || copy.machineCode.length !== 20) {
    throw new Error(
      `Нужен код компьютера (20 знаков), его показывает копия на экране активации. Сейчас: «${copy.machineCode}».`
    );
  }
  return {
    id: crypto.randomUUID(),
    tester: copy.name,
    displayName: copy.displayName,
    machine: copy.machineCode,
    product: copy.displayName,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + span * 86400000).toISOString(),
    revocationUrl: copy.revocationUrl || "",
  };
}

/**
 * Записывает выданную лицензию в копию. Прежняя, если она была отозвана,
 * остаётся в списке отзыва: перевыдача не должна тихо возвращать к жизни файл,
 * доступ по которому закрыли.
 */
function withIssuedLicence(copy, licence) {
  return normalize({
    ...copy,
    licenceId: licence.id,
    issuedAt: licence.issuedAt,
    expiresAt: licence.expiresAt,
    revoked: false,
    revokedLicenceIds:
      copy.revoked && copy.licenceId ? [...copy.revokedLicenceIds, copy.licenceId] : copy.revokedLicenceIds,
  });
}

/** Что попадает в подписанный revoked.json. */
function revokedIds(stored) {
  const ids = new Set();
  for (const copy of list(stored)) {
    for (const id of copy.revokedLicenceIds) ids.add(id);
    if (copy.revoked && copy.licenceId) ids.add(copy.licenceId);
  }
  return [...ids];
}

function setRevoked(stored, id, revoked) {
  return list(stored).map((c) => (c.id === id ? normalize({ ...c, revoked: Boolean(revoked) }) : c));
}

module.exports = {
  BASE_MODULES,
  OFFICE_MODULES,
  PLUGINS,
  PLUGIN_IDS,
  displayNameFor,
  repoNameFor,
  normalizeMachineCode,
  normalize,
  list,
  save,
  remove,
  modulesOf,
  toBlueprint,
  licenceFor,
  withIssuedLicence,
  revokedIds,
  setRevoked,
};
