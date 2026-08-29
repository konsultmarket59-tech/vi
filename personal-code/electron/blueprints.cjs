// Blueprints: named configurations of a customised «Личный чат».
//
// A blueprint says what a particular build of the chat app is called and which
// of its modules it ships with. Exporting one writes a plugins.json that the
// chat app reads at startup, so the configuration made here has a real effect
// on a real build rather than being a description of one.
//
// Deliberately NOT implemented here: issuing or revoking licence keys. That is
// waiting on the legal form of the product; see README. Nothing in this file
// pretends to do it.

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

// The modules «Личный чат» can be built with. Ids match the view kinds in its
// Sidebar, which is what plugins.json switches on.
const MODULES = [
  { id: "projects", name: "Проекты и чаты", core: true, description: "Проекты, диалоги, документы, задачи." },
  { id: "skills", name: "Навыки", core: false, description: "Библиотека навыков и конструктор навыков." },
  { id: "excel", name: "Excel", core: false, description: "Таблицы с формулами и агент внутри таблицы." },
  { id: "word", name: "Word", core: false, description: "Документы .docx и агент для правок." },
  { id: "design", name: "Дизайн", core: false, description: "Дизайн-системы, проекты, экспорт PNG/PDF/MP4." },
  { id: "media", name: "Медиа", core: false, description: "Генерация изображений." },
  { id: "cloud", name: "Облако", core: false, description: "Яндекс Диск и Google Диск." },
  { id: "direct", name: "Яндекс.Директ", core: false, description: "Статистика и управление кампаниями." },
  { id: "github", name: "GitHub", core: false, description: "Репозитории, файлы, Actions." },
  { id: "chatbots", name: "Боты", core: false, description: "Telegram / VK / MAX и воронки." },
];

const CORE_IDS = MODULES.filter((m) => m.core).map((m) => m.id);

function normalize(blueprint) {
  const known = new Set(MODULES.map((m) => m.id));
  const chosen = (blueprint.modules || []).filter((id) => known.has(id));
  return {
    id: blueprint.id || crypto.randomUUID(),
    name: (blueprint.name || "Новая сборка").trim(),
    productName: (blueprint.productName || "Личный чат").trim(),
    description: (blueprint.description || "").trim(),
    // Core modules are always present: a build with no projects is not a build.
    modules: [...new Set([...CORE_IDS, ...chosen])],
    createdAt: blueprint.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
}

function list(stored) {
  return (stored || []).map((b) => normalize(b));
}

function save(stored, blueprint) {
  const next = normalize(blueprint);
  const all = list(stored);
  const index = all.findIndex((b) => b.id === next.id);
  if (index === -1) all.unshift(next);
  else all[index] = { ...all[index], ...next };
  return { all, saved: next };
}

function remove(stored, id) {
  return list(stored).filter((b) => b.id !== id);
}

/** The file the chat app reads. Kept minimal so it stays readable by hand. */
function toConfig(blueprint) {
  const enabled = {};
  for (const module of MODULES) enabled[module.id] = blueprint.modules.includes(module.id);
  return {
    productName: blueprint.productName,
    blueprint: blueprint.name,
    generatedAt: new Date().toISOString(),
    modules: enabled,
  };
}

/**
 * Writes plugins.json into a folder. Given the source folder of the chat app the
 * file lands next to package.json, which is where its build picks it up; given
 * any other folder it is simply written there for the developer to place.
 */
async function exportTo(blueprint, targetDir) {
  const normalized = normalize(blueprint);
  const file = path.join(targetDir, "plugins.json");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(toConfig(normalized), null, 2), "utf-8");
  const disabled = MODULES.filter((m) => !normalized.modules.includes(m.id));
  return {
    file,
    productName: normalized.productName,
    enabledCount: normalized.modules.length,
    disabled: disabled.map((m) => m.name),
  };
}

module.exports = { MODULES, CORE_IDS, normalize, list, save, remove, toConfig, exportTo };
