// Архив плагинов: запас готовых дополнений к «Личному чату», который лежит на
// компьютере автора.
//
// Плагин здесь — это именованный набор материалов (навыки и, при необходимости,
// исходники модуля) с историей версий. Когда нужен новый плагин, агент в
// «Личном коде» пишет его прямо в репозитории; отсюда он забирается в архив
// новой версией — либо поверх существующего плагина, либо как отдельный.
//
// Версии не перезаписываются: каждая ложится в свою папку. Обновление плагина —
// это новая версия рядом со старой, а не замена, поэтому всегда можно вернуться
// к тому, что уже отдано тестировщикам.
//
// Всё хранится обычными файлами в «Документы\Личный код\Плагины», без базы
// данных: папку можно открыть, скопировать, положить в резервную копию.

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

let rootDir = null;

function init(documentsPath) {
  rootDir = path.join(documentsPath, "Личный код", "Плагины");
}

function root() {
  if (!rootDir) throw new Error("Архив плагинов не инициализирован.");
  return rootDir;
}

function slugify(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 50);
  return base || "plugin";
}

/** Версии — целые числа по возрастанию: v1, v2, v3. Понятнее, чем даты. */
function versionFolder(n) {
  return `v${n}`;
}

function parseVersion(name) {
  const match = /^v(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function listVersions(pluginDir) {
  const entries = await fs.readdir(pluginDir, { withFileTypes: true }).catch(() => []);
  const versions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const number = parseVersion(entry.name);
    if (number === null) continue;
    const dir = path.join(pluginDir, entry.name);
    const manifest = await readJson(path.join(dir, "plugin.json"), {});
    const skills = (await fs.readdir(path.join(dir, "skills")).catch(() => [])).filter((f) => f.endsWith(".json"));
    const sources = (await fs.readdir(path.join(dir, "source")).catch(() => [])).length;
    versions.push({
      version: number,
      dir,
      note: manifest.note || "",
      createdAt: manifest.createdAt || "",
      skills: skills.length,
      sources,
    });
  }
  versions.sort((a, b) => b.version - a.version);
  return versions;
}

async function list() {
  const dir = root();
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(dir, entry.name);
    const meta = await readJson(path.join(pluginDir, "plugin.json"), {});
    const versions = await listVersions(pluginDir);
    plugins.push({
      id: entry.name,
      name: meta.name || entry.name,
      description: meta.description || "",
      dir: pluginDir,
      latest: versions[0]?.version || 0,
      versions,
    });
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return plugins;
}

/**
 * Кладёт новую версию плагина в архив.
 *
 * `pluginId` пустой — создаётся новый плагин; заданный — добавляется версия к
 * существующему. Второе и есть «обновить», первое — «сохранить отдельно»;
 * различие делается здесь одним параметром, а не двумя разными операциями,
 * потому что содержимое в обоих случаях складывается одинаково.
 */
async function addVersion({ pluginId = "", name = "", description = "", note = "", skills = [], sourcePaths = [] }) {
  const dir = root();
  const cleanName = String(name || "").trim();
  if (!pluginId && !cleanName) throw new Error("Не указано название плагина.");

  const id = pluginId || (await uniqueId(dir, slugify(cleanName)));
  const pluginDir = path.join(dir, id);
  await fs.mkdir(pluginDir, { recursive: true });

  const existingMeta = await readJson(path.join(pluginDir, "plugin.json"), {});
  await fs.writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        id,
        name: cleanName || existingMeta.name || id,
        description: description || existingMeta.description || "",
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  const versions = await listVersions(pluginDir);
  const next = (versions[0]?.version || 0) + 1;
  const versionDir = path.join(pluginDir, versionFolder(next));
  await fs.mkdir(versionDir, { recursive: true });

  const cleanSkills = (skills || []).filter((s) => s?.name && typeof s.content === "string");
  if (cleanSkills.length) {
    const skillsDir = path.join(versionDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
    const used = new Set();
    for (const skill of cleanSkills) {
      let fileName = slugify(skill.name);
      let n = 2;
      while (used.has(fileName)) fileName = `${slugify(skill.name)}-${n++}`;
      used.add(fileName);
      await fs.writeFile(
        path.join(skillsDir, fileName + ".json"),
        JSON.stringify(
          {
            name: skill.name,
            description: skill.description || "",
            content: skill.content,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          null,
          2
        ),
        "utf-8"
      );
    }
  }

  // Исходники модуля копируются как есть — архив должен быть самодостаточным,
  // иначе через полгода версия окажется ссылкой на файл, которого уже нет.
  const copied = [];
  for (const source of sourcePaths || []) {
    if (!source || !fsSync.existsSync(source)) continue;
    const target = path.join(versionDir, "source", path.basename(source));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true });
    copied.push(path.basename(source));
  }

  await fs.writeFile(
    path.join(versionDir, "plugin.json"),
    JSON.stringify(
      {
        id,
        name: cleanName || existingMeta.name || id,
        version: next,
        note: String(note || "").trim(),
        skills: cleanSkills.map((s) => s.name),
        sources: copied,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  return { id, version: next, dir: versionDir, skills: cleanSkills.length, sources: copied.length };
}

async function uniqueId(dir, base) {
  let id = base;
  let n = 2;
  while (fsSync.existsSync(path.join(dir, id))) id = `${base}-${n++}`;
  return id;
}

async function removePlugin(id) {
  const target = path.join(root(), id);
  if (!fsSync.existsSync(target)) throw new Error("Плагин не найден.");
  await fs.rm(target, { recursive: true, force: true });
  return true;
}

/**
 * Собирает выбранные версии плагинов в папку bundled-skills сборки «Личного
 * чата». Папка полностью пересобирается: иначе навык, убранный из набора,
 * тихо остался бы в сборке от прошлого раза.
 */
async function exportToBuild(chatDir, selections) {
  const targetDir = path.join(chatDir, "bundled-skills");
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });

  const included = [];
  const missing = [];
  for (const { id, version } of selections || []) {
    const versionDir = path.join(root(), id, versionFolder(version));
    const skillsDir = path.join(versionDir, "skills");
    const files = (await fs.readdir(skillsDir).catch(() => [])).filter((f) => f.endsWith(".json"));
    if (!files.length) {
      missing.push(`${id} v${version}`);
      continue;
    }
    for (const file of files) {
      // Имя файла — id навыка внутри сборки, поэтому плагин в нём обязателен:
      // два плагина легко могут содержать навык с одинаковым названием.
      await fs.copyFile(path.join(skillsDir, file), path.join(targetDir, `${id}--${file}`));
    }
    included.push({ id, version, skills: files.length });
  }
  return { targetDir, included, missing };
}

module.exports = { init, root, list, addVersion, removePlugin, exportToBuild, slugify };
