// Раздел «Дизайн»: проекты, их ассеты и сохранённые макеты.
//
// Проект здесь — не то же самое, что проект приложения. Это рабочая папка одной
// задачи или одного бренда: в ней лежат пути к логотипам, фирменным шрифтам,
// исходным фотографиям, референсам и кускам дизайн-системы, которые лежат у
// пользователя на компьютере. Файлы не копируются — хранятся только пути, и они
// перечитываются каждый раз, поэтому правка логотипа на диске сразу видна здесь.

const fs = require("node:fs/promises");
const path = require("node:path");

const ASSET_KINDS = ["logos", "fonts", "sources", "references", "system"];

const ASSET_KIND_LABELS = {
  logos: "Логотипы",
  fonts: "Фирменные шрифты",
  sources: "Исходники (фото, которые нужно использовать)",
  references: "Референсы (ориентир по стилю)",
  system: "Части дизайн-системы",
};

const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);
const TEXT_EXTS = new Set([".txt", ".md", ".json", ".css", ".svg"]);

// Реальный ограничитель — размер запроса к модели: текстовый кусок дизайн-системы
// целиком полезен, но не мегабайтами.
const MAX_TEXT_ASSET_CHARS = 20000;

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function designRoot(root) {
  return path.join(root, "design");
}
function projectsFile(root) {
  return path.join(designRoot(root), "projects.json");
}
function systemsFile(root) {
  return path.join(designRoot(root), "systems.json");
}

/** Папка макетов проекта. Пустой id — общая папка, как было до появления проектов. */
function designDir(root, projectId) {
  return projectId ? path.join(designRoot(root), "projects", projectId) : designRoot(root);
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

function slugId() {
  return `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function projectId() {
  return `dp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyAssets() {
  return Object.fromEntries(ASSET_KINDS.map((k) => [k, []]));
}

/**
 * Дизайн-система — самостоятельная сущность, а не свойство проекта.
 *
 * Систем у агентства несколько: своя и по одной у каждого клиента, и один проект
 * вполне может делаться в чужой системе. Поэтому системы живут отдельным списком, а
 * проект просто указывает, какая из них сейчас в работе.
 */
const SYSTEM_ASSET_KINDS = ["fonts", "logos", "rules"];

const SYSTEM_ASSET_LABELS = {
  fonts: "Шрифты",
  logos: "Логотипы",
  rules: "Правила (цвета, отступы, типографика)",
};

function emptySystemAssets() {
  return Object.fromEntries(SYSTEM_ASSET_KINDS.map((k) => [k, []]));
}

function systemId() {
  return `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeSystem(raw) {
  const assets = emptySystemAssets();
  for (const kind of SYSTEM_ASSET_KINDS) {
    const list = raw?.assets?.[kind];
    if (Array.isArray(list)) assets[kind] = list.filter((p) => typeof p === "string" && p.trim());
  }
  return {
    id: raw.id || systemId(),
    name: (raw.name || "Без названия").trim(),
    /** Палитра и правила текстом — то, что быстрее вписать, чем прикладывать файлом. */
    notes: raw.notes || "",
    assets,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

function normalizeProject(raw) {
  const assets = emptyAssets();
  for (const kind of ASSET_KINDS) {
    const list = raw?.assets?.[kind];
    if (Array.isArray(list)) assets[kind] = list.filter((p) => typeof p === "string" && p.trim());
  }
  return {
    id: raw.id || projectId(),
    name: (raw.name || "Без названия").trim(),
    /** Необязательная привязка к проекту приложения — ради его фирменного стиля. */
    linkedProjectId: raw.linkedProjectId || "",
    /** Какая дизайн-система сейчас в работе; пусто — ни одна. */
    systemId: raw.systemId || "",
    notes: raw.notes || "",
    assets,
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

// ---------- проекты ----------

async function listProjects(root) {
  const stored = await readJson(projectsFile(root), null);
  if (Array.isArray(stored)) return stored.map(normalizeProject);
  return [];
}

async function saveProjects(root, projects) {
  await ensureDir(designRoot(root));
  const list = projects.map(normalizeProject);
  await writeJson(projectsFile(root), list);
  return list;
}

async function createProject(root, name) {
  const projects = await listProjects(root);
  const project = normalizeProject({ name: name || "Новый проект" });
  await ensureDir(designDir(root, project.id));
  await saveProjects(root, [...projects, project]);
  return project;
}

async function updateProject(root, id, patch) {
  const projects = await listProjects(root);
  const next = projects.map((p) => (p.id === id ? normalizeProject({ ...p, ...patch, id, updatedAt: Date.now() }) : p));
  await saveProjects(root, next);
  return next.find((p) => p.id === id) || null;
}

async function removeProject(root, id) {
  const projects = await listProjects(root);
  await saveProjects(root, projects.filter((p) => p.id !== id));
  // Макеты проекта удаляются вместе с ним; сами файлы-ассеты на компьютере не
  // трогаются никогда — приложение хранит только пути к ним.
  await fs.rm(designDir(root, id), { recursive: true, force: true }).catch(() => {});
}

/** Добавляет пути к ассетам, не дублируя уже добавленные. */
async function addAssets(root, id, kind, paths) {
  if (!ASSET_KINDS.includes(kind)) throw new Error(`Неизвестный тип ассета: ${kind}`);
  const projects = await listProjects(root);
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error("Проект дизайна не найден.");
  const existing = new Set(project.assets[kind]);
  const merged = [...project.assets[kind], ...paths.filter((p) => !existing.has(p))];
  return updateProject(root, id, { assets: { ...project.assets, [kind]: merged } });
}

async function removeAsset(root, id, kind, assetPath) {
  const projects = await listProjects(root);
  const project = projects.find((p) => p.id === id);
  if (!project) return null;
  return updateProject(root, id, {
    assets: { ...project.assets, [kind]: project.assets[kind].filter((p) => p !== assetPath) },
  });
}

// ---------- дизайн-системы ----------

async function listSystems(root) {
  const stored = await readJson(systemsFile(root), null);
  return Array.isArray(stored) ? stored.map(normalizeSystem) : [];
}

async function saveSystems(root, systems) {
  await ensureDir(designRoot(root));
  const list = systems.map(normalizeSystem);
  await writeJson(systemsFile(root), list);
  return list;
}

async function createSystem(root, name) {
  const systems = await listSystems(root);
  const system = normalizeSystem({ name: name || "Новая дизайн-система" });
  await saveSystems(root, [...systems, system]);
  return system;
}

async function updateSystem(root, id, patch) {
  const systems = await listSystems(root);
  const next = systems.map((x) => (x.id === id ? normalizeSystem({ ...x, ...patch, id, updatedAt: Date.now() }) : x));
  await saveSystems(root, next);
  return next.find((x) => x.id === id) || null;
}

async function removeSystem(root, id) {
  const systems = await listSystems(root);
  await saveSystems(root, systems.filter((x) => x.id !== id));
  // Проекты, работавшие в этой системе, остаются без неё, а не со ссылкой в пустоту.
  const projects = await listProjects(root);
  const cleaned = projects.map((p) => (p.systemId === id ? { ...p, systemId: "" } : p));
  await saveProjects(root, cleaned);
}

async function addSystemAssets(root, id, kind, paths) {
  if (!SYSTEM_ASSET_KINDS.includes(kind)) throw new Error(`Неизвестный тип материала: ${kind}`);
  const systems = await listSystems(root);
  const system = systems.find((x) => x.id === id);
  if (!system) throw new Error("Дизайн-система не найдена.");
  const existing = new Set(system.assets[kind]);
  const merged = [...system.assets[kind], ...paths.filter((p) => !existing.has(p))];
  return updateSystem(root, id, { assets: { ...system.assets, [kind]: merged } });
}

async function removeSystemAsset(root, id, kind, assetPath) {
  const systems = await listSystems(root);
  const system = systems.find((x) => x.id === id);
  if (!system) return null;
  return updateSystem(root, id, {
    assets: { ...system.assets, [kind]: system.assets[kind].filter((p) => p !== assetPath) },
  });
}

// ---------- ассеты ----------

/** Устойчивый идентификатор ассета: путь может быть длинным и с кириллицей. */
function assetIdFor(kind, index) {
  return `${kind}-${index + 1}`;
}

/** Имя семейства для CSS. Пробелы убираем — так его труднее написать с ошибкой. */
function fontFamilyFor(filePath) {
  return path.basename(filePath, path.extname(filePath)).replace(/[^\w-]+/g, "");
}

/**
 * Читает ассеты проекта: что это, как на них ссылаться и (для шрифтов и картинок)
 * сами данные. `withData` выключают там, где нужен только перечень — например при
 * сборке промпта, куда мегабайты картинок отправлять незачем.
 */
async function readAssets(root, id, { withData = false } = {}) {
  const projects = await listProjects(root);
  const project = projects.find((p) => p.id === id);
  if (!project) return [];

  const out = [];
  for (const kind of ASSET_KINDS) {
    const paths = project.assets[kind];
    for (let i = 0; i < paths.length; i++) {
      const filePath = paths[i];
      const ext = path.extname(filePath).toLowerCase();
      const asset = {
        id: assetIdFor(kind, i),
        kind,
        path: filePath,
        name: path.basename(filePath),
        ext,
        missing: false,
        isFont: FONT_EXTS.has(ext),
        isImage: IMAGE_EXTS.has(ext),
        fontFamily: FONT_EXTS.has(ext) ? fontFamilyFor(filePath) : "",
      };
      try {
        const stat = await fs.stat(filePath);
        asset.size = stat.size;
      } catch {
        asset.missing = true;
        out.push(asset);
        continue;
      }
      // Текстовые куски дизайн-системы ассистент должен именно прочитать.
      if (TEXT_EXTS.has(ext) && !asset.isImage) {
        const text = await fs.readFile(filePath, "utf-8").catch(() => "");
        asset.text = text.slice(0, MAX_TEXT_ASSET_CHARS);
      }
      if (withData && (asset.isFont || asset.isImage)) {
        const buffer = await fs.readFile(filePath).catch(() => null);
        if (buffer) {
          asset.dataUrl = `data:${MIME_BY_EXT[ext] || "application/octet-stream"};base64,${buffer.toString("base64")}`;
        }
      }
      out.push(asset);
    }
  }
  return out;
}

/**
 * Подставляет в разметку настоящие ассеты.
 *
 * Ассистент ссылается на них как `ASSET:logos-1` — коротко и без путей, которые он
 * всё равно не знает. Здесь эти ссылки превращаются в data-URI, а шрифты получают
 * свои @font-face. Именно поэтому экспортированный PNG уносит с собой и логотип, и
 * настоящую гарнитуру: внутри файла лежат сами данные, а не ссылки на диск.
 */
function applyAssets(html, assets) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  let out = String(html || "");

  out = out.replace(/ASSET:([a-z]+-\d+)/gi, (whole, id) => {
    const asset = byId.get(id.toLowerCase());
    return asset?.dataUrl || whole;
  });

  const faces = assets
    .filter((a) => a.isFont && a.dataUrl)
    .map((a) => `@font-face{font-family:'${a.fontFamily}';src:url(${a.dataUrl});font-display:block;}`)
    .join("\n");

  return faces ? `<style>\n${faces}\n</style>\n${out}` : out;
}

/**
 * Материалы дизайн-системы, в том же виде, что и ассеты проекта.
 * Идентификаторы с приставкой sys, чтобы не столкнуться с ассетами проекта.
 */
async function readSystemAssets(root, id, { withData = false } = {}) {
  const systems = await listSystems(root);
  const system = systems.find((x) => x.id === id);
  if (!system) return [];

  const out = [];
  for (const kind of SYSTEM_ASSET_KINDS) {
    const paths = system.assets[kind];
    for (let i = 0; i < paths.length; i++) {
      const filePath = paths[i];
      const ext = path.extname(filePath).toLowerCase();
      const asset = {
        id: `sys${kind}-${i + 1}`,
        kind: `system:${kind}`,
        systemName: system.name,
        path: filePath,
        name: path.basename(filePath),
        ext,
        missing: false,
        isFont: FONT_EXTS.has(ext),
        isImage: IMAGE_EXTS.has(ext),
        fontFamily: FONT_EXTS.has(ext) ? fontFamilyFor(filePath) : "",
      };
      try {
        const stat = await fs.stat(filePath);
        asset.size = stat.size;
      } catch {
        asset.missing = true;
        out.push(asset);
        continue;
      }
      if (TEXT_EXTS.has(ext) && !asset.isImage) {
        asset.text = (await fs.readFile(filePath, "utf-8").catch(() => "")).slice(0, MAX_TEXT_ASSET_CHARS);
      }
      if (withData && (asset.isFont || asset.isImage)) {
        const buffer = await fs.readFile(filePath).catch(() => null);
        if (buffer) {
          asset.dataUrl = `data:${MIME_BY_EXT[ext] || "application/octet-stream"};base64,${buffer.toString("base64")}`;
        }
      }
      out.push(asset);
    }
  }
  return out;
}

/**
 * Всё, чем располагает проект: его собственные материалы плюс материалы выбранной
 * дизайн-системы. Одна функция на оба применения — и промпт, и подстановку — чтобы
 * ассистенту нельзя было пообещать шрифт, который потом не подставится.
 */
async function collectAssets(root, id, options = {}) {
  const projects = await listProjects(root);
  const project = projects.find((p) => p.id === id);
  const own = await readAssets(root, id, options);
  const system = project?.systemId ? await readSystemAssets(root, project.systemId, options) : [];
  return [...system, ...own];
}

/** Текстовая опись ассетов для системного промпта. */
function describeAssets(assets) {
  if (assets.length === 0) return "";
  const lines = [];

  const systemAssets = assets.filter((a) => String(a.kind).startsWith("system:"));
  if (systemAssets.length) {
    lines.push(`\n=== ДИЗАЙН-СИСТЕМА «${systemAssets[0].systemName}» — СОБЛЮДАТЬ ОБЯЗАТЕЛЬНО ===`);
    for (const kind of SYSTEM_ASSET_KINDS) {
      const group = systemAssets.filter((a) => a.kind === `system:${kind}`);
      if (!group.length) continue;
      lines.push(`\n${SYSTEM_ASSET_LABELS[kind]}:`);
      for (const asset of group) {
        if (asset.missing) {
          lines.push(`- ${asset.name} — ФАЙЛ НЕ НАЙДЕН, не используй его`);
          continue;
        }
        if (asset.isFont) {
          lines.push(
            `- ${asset.name} — ФИРМЕННЫЙ ШРИФТ. Заголовки набирай именно им: ` +
              `font-family: '${asset.fontFamily}'. @font-face приложение добавит само, подключать не нужно.`
          );
        } else if (asset.isImage) {
          lines.push(`- ${asset.name} — вставляй как <img src="ASSET:${asset.id}"> или background-image:url(ASSET:${asset.id})`);
        } else {
          lines.push(`- ${asset.name}`);
        }
        if (asset.text) lines.push(`  Содержимое:\n${asset.text}`);
      }
    }
  }

  const projectAssets = assets.filter((a) => !String(a.kind).startsWith("system:"));
  if (projectAssets.length) lines.push("\n=== МАТЕРИАЛЫ ПРОЕКТА ===");
  assets = projectAssets;
  for (const kind of ASSET_KINDS) {
    const group = assets.filter((a) => a.kind === kind);
    if (group.length === 0) continue;
    lines.push(`\n${ASSET_KIND_LABELS[kind]}:`);
    for (const asset of group) {
      if (asset.missing) {
        lines.push(`- ${asset.name} — ФАЙЛ НЕ НАЙДЕН, не используй его`);
        continue;
      }
      if (asset.isFont) {
        lines.push(
          `- ${asset.name} — ФИРМЕННЫЙ ШРИФТ. Заголовки набирай именно им: ` +
            `font-family: '${asset.fontFamily}'. @font-face приложение добавит само.`
        );
      } else if (kind === "references") {
        // Референс — ориентир, а не материал: подсказывать способ вставки нельзя,
        // иначе ассистент вклеит его в макет вместо того, чтобы сделать своё.
        lines.push(`- ${asset.name} — референс, вставлять НЕЛЬЗЯ, только ориентироваться на стилистику`);
      } else if (asset.isImage) {
        lines.push(`- ${asset.name} — вставляй как <img src="ASSET:${asset.id}"> или background-image:url(ASSET:${asset.id})`);
      } else {
        lines.push(`- ${asset.name}`);
      }
      if (asset.text) lines.push(`  Содержимое:\n${asset.text}`);
    }
  }
  return lines.join("\n");
}

// ---------- макеты ----------

async function list(root, id) {
  const dir = designDir(root, id);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
    if (entry.name === "projects.json") continue;
    const doc = await readJson(path.join(dir, entry.name), null);
    if (doc) docs.push(doc);
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  return docs;
}

async function save(root, id, doc) {
  const dir = designDir(root, id);
  await ensureDir(dir);
  const now = Date.now();
  const docId = doc.id || slugId();
  const existing = doc.id ? await readJson(path.join(dir, docId + ".json"), null) : null;
  const record = {
    id: docId,
    title: doc.title,
    type: doc.type,
    format: doc.format,
    content: doc.content,
    /** Для моушна: длительность ролика в секундах, объявленная ассистентом. */
    durationSec: doc.durationSec || 0,
    projectId: id || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJson(path.join(dir, docId + ".json"), record);
  return record;
}

async function remove(root, id, docId) {
  await fs.rm(path.join(designDir(root, id), docId + ".json"), { force: true });
}

async function getAgentConversation(root, id) {
  return readJson(path.join(designDir(root, id), "_agent_chat.json"), null);
}

async function saveAgentConversation(root, id, conv) {
  const dir = designDir(root, id);
  await ensureDir(dir);
  await writeJson(path.join(dir, "_agent_chat.json"), conv);
  return conv;
}

// ---------- миграция ----------

/**
 * Переносит макеты, сделанные до появления проектов, в проекты.
 *
 * До этого макеты лежали либо в общей папке design/, либо внутри проекта приложения
 * (projects/<id>/design). Оба варианта здесь превращаются в проекты дизайна, чтобы
 * ничего не потерялось и не пришлось искать старые работы руками.
 */
async function migrateLegacy(root, appProjects) {
  const existing = await readJson(projectsFile(root), null);
  if (Array.isArray(existing)) return existing.map(normalizeProject);

  const created = [];

  // Макеты из общей папки переезжают в собственный проект — так у каждого проекта
  // своя папка и не нужно держать особый случай «проект без id». Заодно переезжает
  // старая переписка с ассистентом, иначе она осталась бы ничьей.
  const rootEntries = await fs.readdir(designRoot(root), { withFileTypes: true }).catch(() => []);
  const rootFiles = rootEntries.filter(
    (e) => e.isFile() && e.name.endsWith(".json") && e.name !== "projects.json"
  );
  if (rootFiles.length > 0) {
    const shared = normalizeProject({ name: "Общие" });
    const targetDir = designDir(root, shared.id);
    await ensureDir(targetDir);
    for (const file of rootFiles) {
      await fs.rename(path.join(designRoot(root), file.name), path.join(targetDir, file.name)).catch(() => {});
    }
    created.push(shared);
  }

  for (const app of appProjects || []) {
    const legacyDir = path.join(root, "projects", app.id, "design");
    const entries = await fs.readdir(legacyDir, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));
    if (files.length === 0) continue;

    const project = normalizeProject({ name: app.name, linkedProjectId: app.id });
    const targetDir = designDir(root, project.id);
    await ensureDir(targetDir);
    for (const file of files) {
      await fs.rename(path.join(legacyDir, file.name), path.join(targetDir, file.name)).catch(() => {});
    }
    created.push(project);
  }

  if (created.length === 0) created.push(normalizeProject({ name: "Общие" }));
  return saveProjects(root, created);
}

// ---------- промпт ассистента ----------

function buildAgentSystemPrompt(brand, project, assets, system) {
  const parts = [
    "Ты — дизайн-ассистент. Помогаешь создавать посты для соцсетей, макеты документов, слайды презентаций, " +
      "дизайн-системы, черновики страниц сайта, простую векторную графику (логотипы, иконки) и анимационные " +
      "ролики (моушн-дизайн).",
  ];
  if (project?.name) parts.push(`\nПроект: «${project.name}».`);
  if (system?.name) {
    parts.push(
      `Дизайн-система проекта: «${system.name}». Это не пожелание, а рамка: цвета, шрифты, отступы и ` +
        "типографику бери из неё и не придумывай своих."
    );
    if (system.notes) parts.push(`Правила системы:\n${system.notes}`);
  }
  if (project?.notes) parts.push(`Заметки по проекту: ${project.notes}`);
  if (brand && (brand.companyName || brand.accentColor)) {
    parts.push(
      "\nФирменный стиль:" +
        (brand.companyName ? `\n- Название: ${brand.companyName}` : "") +
        (brand.tagline ? `\n- Слоган: ${brand.tagline}` : "") +
        (brand.accentColor ? `\n- Акцентный цвет: ${brand.accentColor}` : "")
    );
  }

  const inventory = describeAssets(assets || []);
  if (inventory) {
    parts.push(inventory);
    parts.push(
      "\nКак работать с ассетами:\n" +
        "- Логотипы и исходные фото вставляй по их ссылке ASSET:… — приложение подставит сам файл.\n" +
        "- Фирменный шрифт подключай через font-family с указанным именем; @font-face приложение добавит само.\n" +
        "- Референсы — это ориентир по стилю, а не материал для вставки: повторять их нельзя, нужно сделать " +
        "своё в близкой стилистике. Если референс — картинка, ты её не видишь: опирайся на её название и на " +
        "то, что о ней говорит пользователь.\n" +
        "- Части дизайн-системы (текст, CSS, SVG) читай и соблюдай: цвета, отступы, типографику."
    );
  }
  return parts.join("\n");
}

module.exports = {
  ASSET_KINDS,
  ASSET_KIND_LABELS,
  SYSTEM_ASSET_KINDS,
  SYSTEM_ASSET_LABELS,
  listSystems,
  createSystem,
  updateSystem,
  removeSystem,
  addSystemAssets,
  removeSystemAsset,
  readSystemAssets,
  collectAssets,
  list,
  save,
  remove,
  listProjects,
  createProject,
  updateProject,
  removeProject,
  addAssets,
  removeAsset,
  readAssets,
  applyAssets,
  describeAssets,
  migrateLegacy,
  getAgentConversation,
  saveAgentConversation,
  buildAgentSystemPrompt,
  designDir,
};
