// Навыки, предустановленные автором сборки.
//
// Лежат в папке bundled-skills внутри самой сборки. Тестировщик видит их
// название и описание — и может подключить к проекту, — но не текст навыка:
// это авторская методика, а не пользовательский файл. Свои навыки, написанные
// самим тестировщиком, остаются полностью видимыми и редактируемыми.
//
// Честно про предел: текст навыка физически лежит в приложении на чужом
// компьютере. Скрытие в интерфейсе не даёт скопировать его мимоходом, но не
// защищает от того, кто разберёт установщик. Как и с ключом доступа, это про
// аккуратность, а не про стойкость.

const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

// Префикс отличает предустановленный навык от пользовательского во всех местах,
// где встречается id: в проекте, в списке, при сохранении и удалении.
const PREFIX = "preset:";

function isBundled(id) {
  return typeof id === "string" && id.startsWith(PREFIX);
}

function candidateDirs() {
  const dirs = [path.join(__dirname, "..", "bundled-skills")];
  if (app?.isPackaged) {
    dirs.unshift(path.join(process.resourcesPath, "bundled-skills"));
    dirs.unshift(path.join(process.resourcesPath, "app", "bundled-skills"));
  }
  return dirs;
}

/** Полный список с текстами — для системного промпта. Наружу не отдаётся. */
async function load() {
  for (const dir of candidateDirs()) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const skills = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      let data;
      try {
        data = JSON.parse(await fs.readFile(path.join(dir, entry.name), "utf-8"));
      } catch (e) {
        // Один испорченный файл не должен уносить всю библиотеку.
        console.error(`Предустановленный навык ${entry.name} не разобран:`, e.message);
        continue;
      }
      if (!data?.name || typeof data.content !== "string") continue;
      skills.push({
        id: PREFIX + entry.name.replace(/\.json$/, ""),
        name: String(data.name),
        description: String(data.description || ""),
        content: data.content,
        bundled: true,
        createdAt: Number(data.createdAt) || 0,
        updatedAt: Number(data.updatedAt) || 0,
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return skills;
  }
  return [];
}

/**
 * То, что уходит в окно приложения: у предустановленных навыков текст вырезан.
 * Вырезаем именно здесь, на границе между main и интерфейсом, — так текст
 * физически не попадает в renderer, и его нельзя достать из инструментов
 * разработчика.
 */
function stripForRenderer(skills) {
  return skills.map((skill) =>
    skill.bundled ? { ...skill, content: "", contentHidden: true } : skill
  );
}

module.exports = { PREFIX, isBundled, load, stripForRenderer };
