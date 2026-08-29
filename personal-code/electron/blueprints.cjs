// Blueprints: named configurations of a customised «Личный чат».
//
// A blueprint is everything one copy of the chat app needs to exist: its name,
// the modules it ships with, the folder and branch it is built from, the model
// key baked in for that copy, the skills that travel inside it, and whether it
// asks for activation. Building one (build.cjs) reads exactly this and nothing
// else, so what the Сборки tab shows is what the installer contains.
//
// Deliberately NOT here: selling licences. A blueprint can gate a copy and the
// demo tab can cancel one, which is control over copies given away — not a sale,
// and it needs no legal form. Issuing licence keys as a product still does; see
// README.

const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");

// The modules «Личный чат» can be built with. Ids match the view kinds in its
// Sidebar, which is what plugins.json switches on.
// Базовая часть (core) одинакова у всех сборок: чат с выбором модели, проекты и
// инструкции, навыки, задачи по расписанию, работа с файлами на компьютере,
// сохранение результатов и дизайн. Всё остальное — плагины, включаются по выбору.
const MODULES = [
  {
    id: "projects",
    name: "Проекты и чаты",
    core: true,
    description: "Диалоги, выбор модели, инструкции, документы, задачи по расписанию, файлы с компьютера.",
  },
  { id: "skills", name: "Навыки", core: true, description: "Библиотека навыков и конструктор навыков." },
  { id: "design", name: "Дизайн", core: true, description: "Дизайн-системы, проекты, экспорт PNG/PDF/MP4." },
  { id: "excel", name: "Excel", core: false, description: "Таблицы с формулами и агент внутри таблицы." },
  { id: "word", name: "Word", core: false, description: "Документы .docx и агент для правок." },
  { id: "media", name: "Медиа", core: false, description: "Генерация изображений." },
  { id: "cloud", name: "Облако", core: false, description: "Яндекс Диск и Google Диск." },
  { id: "direct", name: "Яндекс.Директ", core: false, description: "Статистика и управление кампаниями." },
  { id: "github", name: "GitHub", core: false, description: "Репозитории, файлы, Actions." },
  { id: "chatbots", name: "Боты", core: false, description: "Telegram / VK / MAX и воронки." },
];

const CORE_IDS = MODULES.filter((m) => m.core).map((m) => m.id);

// Ветка, в которой лежит канонический код «Личного чата»: сборка идёт из неё,
// а не из того, что осталось в рабочей копии.
const DEFAULT_BRANCH = "claude/personal-claude-chat-docs-untwa4";

function normalize(blueprint) {
  const known = new Set(MODULES.map((m) => m.id));
  const chosen = (blueprint.modules || []).filter((id) => known.has(id));
  const skills = (blueprint.skills || [])
    .map((s) => ({ id: String(s.id || ""), version: Number(s.version) || 0 }))
    .filter((s) => s.id && s.version > 0);
  return {
    id: blueprint.id || crypto.randomUUID(),
    name: (blueprint.name || "Новая сборка").trim(),
    productName: (blueprint.productName || "Личный чат").trim(),
    description: (blueprint.description || "").trim(),
    // Core modules are always present: a build with no projects is not a build.
    modules: [...new Set([...CORE_IDS, ...chosen])],

    // Откуда собирать: папка исходников и ветка с каноническим кодом.
    sourcePath: (blueprint.sourcePath || "").trim(),
    branch: blueprint.branch === undefined ? DEFAULT_BRANCH : String(blueprint.branch).trim(),

    // Доступ к моделям именно для этой копии. Пустой ключ — обычная сборка, где
    // ключ вводит сам пользователь.
    apiKey: (blueprint.apiKey || "").trim(),
    baseUrl: (blueprint.baseUrl || "https://polza.ai/api/v1").trim(),
    model: (blueprint.model || "anthropic/claude-sonnet-5").trim(),
    pricesText: String(blueprint.pricesText || ""),
    currency: (blueprint.currency || "₽").trim(),

    // Навыки из архива плагинов, которые уезжают внутрь сборки.
    skills,

    // Демо-доступ: активация по файлу и постоянная ссылка на список отзыва.
    demoGated: blueprint.demoGated === true,
    revocationUrl: (blueprint.revocationUrl || "").trim(),

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

module.exports = { MODULES, CORE_IDS, DEFAULT_BRANCH, normalize, list, save, remove, toConfig, exportTo };
