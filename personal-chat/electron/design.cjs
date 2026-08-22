const fs = require("node:fs/promises");
const path = require("node:path");

function designDir(root, projectId) {
  return projectId ? path.join(root, "projects", projectId, "design") : path.join(root, "design");
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

async function list(root, projectId) {
  const dir = designDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
    const doc = await readJson(path.join(dir, entry.name), null);
    if (doc) docs.push(doc);
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  return docs;
}

async function save(root, projectId, doc) {
  const dir = designDir(root, projectId);
  await ensureDir(dir);
  const now = Date.now();
  const id = doc.id || slugId();
  const existing = doc.id ? await readJson(path.join(dir, id + ".json"), null) : null;
  const record = {
    id,
    title: doc.title,
    type: doc.type,
    format: doc.format,
    content: doc.content,
    projectId: projectId || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJson(path.join(dir, id + ".json"), record);
  return record;
}

async function remove(root, projectId, id) {
  const dir = designDir(root, projectId);
  await fs.rm(path.join(dir, id + ".json"), { force: true });
}

async function getAgentConversation(root, projectId) {
  const dir = designDir(root, projectId);
  return readJson(path.join(dir, "_agent_chat.json"), null);
}

async function saveAgentConversation(root, projectId, conv) {
  const dir = designDir(root, projectId);
  await ensureDir(dir);
  await writeJson(path.join(dir, "_agent_chat.json"), conv);
  return conv;
}

function buildAgentSystemPrompt(brand) {
  const parts = [
    "Ты — дизайн-ассистент. Помогаешь создавать посты для соцсетей, макеты документов, слайды презентаций, " +
      "дизайн-системы, черновики страниц сайта и простую векторную графику (логотипы, иконки).",
  ];
  if (brand && (brand.companyName || brand.accentColor)) {
    parts.push(
      "\nФирменный стиль текущего проекта (используй, если уместно для задачи):" +
        (brand.companyName ? `\n- Название: ${brand.companyName}` : "") +
        (brand.tagline ? `\n- Слоган: ${brand.tagline}` : "") +
        (brand.accentColor ? `\n- Акцентный цвет: ${brand.accentColor}` : "")
    );
  }
  return parts.join("\n");
}

module.exports = { list, save, remove, getAgentConversation, saveAgentConversation, buildAgentSystemPrompt, designDir };
