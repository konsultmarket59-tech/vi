const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

const APP_CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_ROOT = path.join(app.getPath("documents"), "Личный чат");

const DEFAULT_SETTINGS = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.7,
  maxTokens: 4096,
};

// ---------- low-level helpers ----------

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function slugify(name) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return base || "project";
}

async function uniqueSlug(dir, baseSlug) {
  let slug = baseSlug;
  let n = 2;
  while (fsSync.existsSync(path.join(dir, slug))) {
    slug = `${baseSlug}-${n}`;
    n++;
  }
  return slug;
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

// ---------- app config (root data folder path) ----------

async function loadAppConfig() {
  const cfg = await readJson(APP_CONFIG_PATH, {});
  return { rootPath: cfg.rootPath || DEFAULT_ROOT };
}

async function saveAppConfig(cfg) {
  await writeJson(APP_CONFIG_PATH, cfg);
}

async function getRootPath() {
  const cfg = await loadAppConfig();
  await ensureDir(cfg.rootPath);
  await ensureDir(path.join(cfg.rootPath, "projects"));
  await ensureDir(path.join(cfg.rootPath, "skills"));
  return cfg.rootPath;
}

function projectsDir(root) {
  return path.join(root, "projects");
}
function skillsDir(root) {
  return path.join(root, "skills");
}
function projectDir(root, id) {
  return path.join(projectsDir(root), id);
}
function docsDir(root, id) {
  return path.join(projectDir(root, id), "docs");
}
function chatsDir(root, id) {
  return path.join(projectDir(root, id), "chats");
}

// ---------- settings (app-level, stored alongside config) ----------

const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

async function loadSettings() {
  const s = await readJson(SETTINGS_PATH, {});
  return { ...DEFAULT_SETTINGS, ...s };
}

async function saveSettingsFile(settings) {
  await writeJson(SETTINGS_PATH, settings);
}

// ---------- document text extraction ----------

const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".html", ".rtf"];

async function extractDocText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.includes(ext)) {
    return fs.readFile(filePath, "utf-8");
  }
  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return `[Не удалось извлечь текст из файла "${path.basename(
    filePath
  )}" — формат не поддерживается (поддерживаются .txt, .md, .csv, .json, .docx).]`;
}

// ---------- projects ----------

async function listProjects() {
  const root = await getRootPath();
  const dir = projectsDir(root);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readJson(path.join(dir, entry.name, "project.json"), null);
    if (!meta) continue;
    projects.push({ id: entry.name, ...meta });
  }
  projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return projects;
}

async function createProject({ name, description, instructions }) {
  const root = await getRootPath();
  const slug = await uniqueSlug(projectsDir(root), slugify(name || "project"));
  const dir = projectDir(root, slug);
  await ensureDir(path.join(dir, "docs"));
  await ensureDir(path.join(dir, "chats"));
  const now = Date.now();
  const meta = {
    name: name || "Новый проект",
    description: description || "",
    instructions: instructions || "",
    skillIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(path.join(dir, "project.json"), meta);
  return { id: slug, ...meta };
}

async function updateProject(id, patch) {
  const root = await getRootPath();
  const file = path.join(projectDir(root, id), "project.json");
  const current = await readJson(file, null);
  if (!current) throw new Error("Проект не найден: " + id);
  const updated = { ...current, ...patch, updatedAt: Date.now() };
  await writeJson(file, updated);
  return { id, ...updated };
}

async function deleteProject(id) {
  const root = await getRootPath();
  const dir = projectDir(root, id);
  await shell.trashItem(dir).catch(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
}

// ---------- docs ----------

async function listDocs(projectId) {
  const root = await getRootPath();
  const dir = docsDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stat = await fs.stat(path.join(dir, entry.name));
    docs.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs });
  }
  docs.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return docs;
}

async function addDocsFromPaths(projectId, filePaths) {
  const root = await getRootPath();
  const dir = docsDir(root, projectId);
  await ensureDir(dir);
  for (const src of filePaths) {
    const dest = path.join(dir, path.basename(src));
    await fs.copyFile(src, dest);
  }
  await updateProject(projectId, {}); // bump updatedAt
  return listDocs(projectId);
}

async function addPastedDoc(projectId, name, content) {
  const root = await getRootPath();
  const dir = docsDir(root, projectId);
  await ensureDir(dir);
  const safeName = (name || "документ").replace(/[\\/:*?"<>|]+/g, " ").trim() || "документ";
  let fileName = safeName.endsWith(".md") ? safeName : safeName + ".md";
  let dest = path.join(dir, fileName);
  let n = 2;
  while (fsSync.existsSync(dest)) {
    fileName = `${safeName} (${n}).md`;
    dest = path.join(dir, fileName);
    n++;
  }
  await fs.writeFile(dest, content, "utf-8");
  await updateProject(projectId, {});
  return listDocs(projectId);
}

async function removeDoc(projectId, fileName) {
  const root = await getRootPath();
  const filePath = path.join(docsDir(root, projectId), fileName);
  await shell.trashItem(filePath).catch(async () => {
    await fs.rm(filePath, { force: true });
  });
  await updateProject(projectId, {});
  return listDocs(projectId);
}

// ---------- skills ----------

async function listSkills() {
  const root = await getRootPath();
  const dir = skillsDir(root);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const data = await readJson(path.join(dir, entry.name), null);
    if (!data) continue;
    skills.push({ id: entry.name.replace(/\.json$/, ""), ...data });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return skills;
}

async function saveSkill(skill) {
  const root = await getRootPath();
  const dir = skillsDir(root);
  await ensureDir(dir);
  const now = Date.now();
  let id = skill.id;
  if (!id) {
    id = await uniqueSlug(dir.replace(/\.json$/, ""), slugify(skill.name));
    // uniqueSlug checks a directory of bare names; emulate for files:
    id = slugify(skill.name);
    let n = 2;
    while (fsSync.existsSync(path.join(dir, id + ".json"))) {
      id = `${slugify(skill.name)}-${n}`;
      n++;
    }
  }
  const existing = await readJson(path.join(dir, id + ".json"), null);
  const data = {
    name: skill.name,
    description: skill.description || "",
    content: skill.content,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJson(path.join(dir, id + ".json"), data);
  return { id, ...data };
}

async function deleteSkill(id) {
  const root = await getRootPath();
  const filePath = path.join(skillsDir(root), id + ".json");
  await shell.trashItem(filePath).catch(async () => {
    await fs.rm(filePath, { force: true });
  });
}

// ---------- conversations ----------

async function listConversations(projectId) {
  const root = await getRootPath();
  const dir = chatsDir(root, projectId);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const convs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const data = await readJson(path.join(dir, entry.name), null);
    if (!data) continue;
    convs.push(data);
  }
  convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return convs;
}

async function saveConversation(projectId, conv) {
  const root = await getRootPath();
  const dir = chatsDir(root, projectId);
  await ensureDir(dir);
  await writeJson(path.join(dir, conv.id + ".json"), conv);
  return conv;
}

async function deleteConversation(projectId, convId) {
  const root = await getRootPath();
  const filePath = path.join(chatsDir(root, projectId), convId + ".json");
  await fs.rm(filePath, { force: true });
}

// ---------- skill creator scratch conversation ----------

async function getSkillCreatorConversation() {
  const root = await getRootPath();
  return readJson(path.join(skillsDir(root), "_creator_chat.json"), null);
}

async function saveSkillCreatorConversation(conv) {
  const root = await getRootPath();
  await ensureDir(skillsDir(root));
  await writeJson(path.join(skillsDir(root), "_creator_chat.json"), conv);
  return conv;
}

// ---------- system prompt assembly ----------

const SKILL_CREATOR_PROMPT = require("./skillCreatorPrompt.cjs");

const MAX_DOC_CHARS = 60000;
const MAX_TOTAL_CHARS = 350000;

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n\n[...обрезано, документ длиннее лимита в ${max} символов...]`;
}

async function buildSystemPrompt(projectId) {
  const root = await getRootPath();
  const meta = await readJson(path.join(projectDir(root, projectId), "project.json"), null);
  if (!meta) throw new Error("Проект не найден: " + projectId);

  const parts = [];
  if (meta.instructions?.trim()) parts.push(meta.instructions.trim());

  const allSkills = await listSkills();
  const activeSkills = allSkills.filter((s) => (meta.skillIds || []).includes(s.id));
  if (activeSkills.length > 0) {
    parts.push(
      "\n\n=== ПОДКЛЮЧЁННЫЕ НАВЫКИ ===\nНиже — инструкции навыков, применяй их когда задача им соответствует."
    );
    for (const skill of activeSkills) {
      parts.push(
        `\n--- Навык: ${skill.name} ---\n${skill.description ? skill.description + "\n" : ""}${skill.content}`
      );
    }
  }

  const docs = await listDocs(projectId);
  if (docs.length > 0) {
    parts.push("\n\n=== ДОКУМЕНТЫ ПРОЕКТА (база знаний) ===");
    for (const doc of docs) {
      const filePath = path.join(docsDir(root, projectId), doc.name);
      let content;
      try {
        content = await extractDocText(filePath);
      } catch (e) {
        content = `[Ошибка чтения файла: ${e.message}]`;
      }
      parts.push(`\n--- Документ: ${doc.name} ---\n${truncate(content, MAX_DOC_CHARS)}`);
    }
  }

  let full = parts.join("\n");
  if (full.length > MAX_TOTAL_CHARS) {
    full = full.slice(0, MAX_TOTAL_CHARS) + "\n\n[...общий контекст обрезан по лимиту...]";
  }
  return full;
}

// ---------- import from Claude.ai export ----------

async function importClaudeExport(filePaths) {
  const created = [];
  for (const filePath of filePaths) {
    const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
    const project = await createProject({
      name: raw.name,
      description: raw.description,
      instructions: raw.prompt_template,
    });
    for (const d of raw.docs || []) {
      const fileName = (d.filename || d.name || "документ").replace(/[\\/:*?"<>|]+/g, " ").trim();
      const withExt = /\.[a-zA-Z0-9]+$/.test(fileName) ? fileName : fileName + ".md";
      await addPastedDocRaw(project.id, withExt, d.content || "");
    }
    created.push(project);
  }
  return created;
}

async function addPastedDocRaw(projectId, fileName, content) {
  const root = await getRootPath();
  const dir = docsDir(root, projectId);
  await ensureDir(dir);
  let dest = path.join(dir, fileName);
  let n = 2;
  const base = fileName.replace(/(\.[a-zA-Z0-9]+)$/, "");
  const ext = fileName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || "";
  while (fsSync.existsSync(dest)) {
    dest = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  await fs.writeFile(dest, content, "utf-8");
}

// ---------- window ----------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- IPC wiring ----------

ipcMain.handle("config:get", async () => {
  const cfg = await loadAppConfig();
  await getRootPath();
  return cfg;
});

ipcMain.handle("config:chooseRootPath", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const rootPath = result.filePaths[0];
  await saveAppConfig({ rootPath });
  await ensureDir(path.join(rootPath, "projects"));
  await ensureDir(path.join(rootPath, "skills"));
  return rootPath;
});

ipcMain.handle("config:openRootPath", async () => {
  const root = await getRootPath();
  await shell.openPath(root);
});

ipcMain.handle("settings:get", () => loadSettings());
ipcMain.handle("settings:save", (_e, settings) => saveSettingsFile(settings));

ipcMain.handle("projects:list", () => listProjects());
ipcMain.handle("projects:create", (_e, data) => createProject(data));
ipcMain.handle("projects:update", (_e, id, patch) => updateProject(id, patch));
ipcMain.handle("projects:delete", (_e, id) => deleteProject(id));
ipcMain.handle("projects:buildSystemPrompt", (_e, id) => buildSystemPrompt(id));
ipcMain.handle("projects:openFolder", async (_e, id) => {
  const root = await getRootPath();
  await shell.openPath(projectDir(root, id));
});

ipcMain.handle("docs:list", (_e, projectId) => listDocs(projectId));
ipcMain.handle("docs:addFromPaths", (_e, projectId, filePaths) => addDocsFromPaths(projectId, filePaths));
ipcMain.handle("docs:addPasted", (_e, projectId, name, content) => addPastedDoc(projectId, name, content));
ipcMain.handle("docs:remove", (_e, projectId, fileName) => removeDoc(projectId, fileName));
ipcMain.handle("docs:pickFiles", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Документы", extensions: ["txt", "md", "csv", "json", "docx"] },
      { name: "Все файлы", extensions: ["*"] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("skills:list", () => listSkills());
ipcMain.handle("skills:save", (_e, skill) => saveSkill(skill));
ipcMain.handle("skills:delete", (_e, id) => deleteSkill(id));

ipcMain.handle("conversations:list", (_e, projectId) => listConversations(projectId));
ipcMain.handle("conversations:save", (_e, projectId, conv) => saveConversation(projectId, conv));
ipcMain.handle("conversations:delete", (_e, projectId, convId) => deleteConversation(projectId, convId));

ipcMain.handle("import:pickClaudeExports", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Экспорт Claude.ai", extensions: ["json"] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});
ipcMain.handle("import:claudeExports", (_e, filePaths) => importClaudeExport(filePaths));

ipcMain.handle("meta:skillCreatorPrompt", () => SKILL_CREATOR_PROMPT);
ipcMain.handle("skillCreator:get", () => getSkillCreatorConversation());
ipcMain.handle("skillCreator:save", (_e, conv) => saveSkillCreatorConversation(conv));
