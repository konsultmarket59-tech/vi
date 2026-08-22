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

const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".html"];
const SUPPORTED_DOC_EXTENSIONS = [
  ".txt", ".md", ".csv", ".json", ".html", ".rtf",
  ".docx", ".doc", ".xlsx", ".xls", ".pdf",
];

function sheetToText(worksheet) {
  const lines = [];
  worksheet.eachRow((row) => {
    const cells = row.values.slice(1).map((v) => {
      if (v == null) return "";
      if (typeof v === "object" && v.text) return v.text; // rich text / hyperlink
      if (typeof v === "object" && v.result != null) return String(v.result); // formula
      return String(v);
    });
    lines.push(cells.join(" | "));
  });
  return lines.join("\n");
}

async function extractDocText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (TEXT_EXTENSIONS.includes(ext)) {
    return fs.readFile(filePath, "utf-8");
  }

  if (ext === ".rtf") {
    const raw = await fs.readFile(filePath, "utf-8");
    // Best-effort plain-text fallback: strip RTF control words/groups.
    return raw
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
      .replace(/[{}]/g, "")
      .trim();
  }

  if (ext === ".docx") {
    const mammoth = require("mammoth");
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === ".doc") {
    const WordExtractor = require("word-extractor");
    const extractor = new WordExtractor();
    const doc = await extractor.extract(filePath);
    return doc.getBody();
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    if (ext === ".xls") {
      throw new Error("Старый формат .xls не поддерживается — пересохраните файл как .xlsx.");
    }
    await workbook.xlsx.readFile(filePath);
    const parts = [];
    workbook.eachSheet((sheet) => {
      parts.push(`## Лист: ${sheet.name}`);
      parts.push(sheetToText(sheet));
    });
    return parts.join("\n\n");
  }

  if (ext === ".pdf") {
    const { PDFParse } = require("pdf-parse");
    const data = await fs.readFile(filePath);
    const parser = new PDFParse({ data });
    try {
      const result = await parser.getText();
      return result.text.replace(/-- \d+ of \d+ --\n*/g, "").trim();
    } finally {
      await parser.destroy();
    }
  }

  return `[Не удалось извлечь текст из файла "${path.basename(
    filePath
  )}" — формат не поддерживается (поддерживаются .txt, .md, .csv, .json, .rtf, .docx, .doc, .xlsx, .pdf).]`;
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

// ---------- operations module + mail (delegated to sibling modules) ----------

const ops = require("./ops.cjs");
const mail = require("./mail.cjs");
const MAIL_DRAFT_PROMPT = require("./mailDraftPrompt.cjs");

function opsScratchDir(root) {
  return path.join(root, "operations");
}

async function getOpsAgentConversation() {
  const root = await getRootPath();
  return readJson(path.join(opsScratchDir(root), "_agent_chat.json"), null);
}

async function saveOpsAgentConversation(conv) {
  const root = await getRootPath();
  await ensureDir(opsScratchDir(root));
  await writeJson(path.join(opsScratchDir(root), "_agent_chat.json"), conv);
  return conv;
}

async function getMailAgentConversation() {
  const root = await getRootPath();
  return readJson(path.join(mailDirPath(root), "_agent_chat.json"), null);
}

async function saveMailAgentConversation(conv) {
  const root = await getRootPath();
  await ensureDir(mailDirPath(root));
  await writeJson(path.join(mailDirPath(root), "_agent_chat.json"), conv);
  return conv;
}

function mailDirPath(root) {
  return path.join(root, "mail");
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

// ---------- export (PDF / PNG) ----------

function sanitizeFileName(name) {
  return (name || "export").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "export";
}

async function resolveExportDir(projectId) {
  const root = await getRootPath();
  if (projectId) {
    const dir = docsDir(root, projectId);
    await ensureDir(dir);
    return dir;
  }
  return app.getPath("documents");
}

async function renderHtmlInHiddenWindow(html, { width = 900, height = 600 } = {}) {
  const tmpFile = path.join(
    app.getPath("temp"),
    `personal-chat-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );
  await fs.writeFile(tmpFile, html, "utf-8");
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: { offscreen: false },
  });
  await win.loadFile(tmpFile);
  return { win, tmpFile };
}

async function cleanupHiddenWindow(win, tmpFile) {
  win.destroy();
  await fs.rm(tmpFile, { force: true }).catch(() => {});
}

async function exportHtmlToPdf({ html, defaultName, projectId }) {
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + ".pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const { win, tmpFile } = await renderHtmlInHiddenWindow(html);
  try {
    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    await fs.writeFile(result.filePath, pdfBuffer);
  } finally {
    await cleanupHiddenWindow(win, tmpFile);
  }
  return result.filePath;
}

async function exportHtmlToPng({ html, defaultName, projectId }) {
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + ".png"),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) return null;

  const width = 900;
  const { win, tmpFile } = await renderHtmlInHiddenWindow(html, { width });
  try {
    // Note: document.documentElement.scrollHeight is floored at the window's
    // viewport height (a browser quirk for the root scrolling element), so it
    // over-reports for short content — measure the body box instead.
    const contentHeight = await win.webContents.executeJavaScript(
      "Math.ceil(document.body.scrollHeight)"
    );
    win.setContentSize(width, Math.max(contentHeight, 80));
    // give layout a moment to settle after the resize before capturing
    await new Promise((resolve) => setTimeout(resolve, 80));
    const image = await win.webContents.capturePage();
    await fs.writeFile(result.filePath, image.toPNG());
  } finally {
    await cleanupHiddenWindow(win, tmpFile);
  }
  return result.filePath;
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
      {
        name: "Документы",
        extensions: SUPPORTED_DOC_EXTENSIONS.map((e) => e.slice(1)),
      },
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

ipcMain.handle("export:toPdf", (_e, payload) => exportHtmlToPdf(payload));
ipcMain.handle("export:toPng", (_e, payload) => exportHtmlToPng(payload));

ipcMain.handle("meta:skillCreatorPrompt", () => SKILL_CREATOR_PROMPT);
ipcMain.handle("skillCreator:get", () => getSkillCreatorConversation());
ipcMain.handle("skillCreator:save", (_e, conv) => saveSkillCreatorConversation(conv));

// ---------- operations IPC ----------

ipcMain.handle("ops:list", async () => ops.listSheets(await getRootPath()));
ipcMain.handle("ops:save", async (_e, sheet) => ops.saveSheet(await getRootPath(), sheet));
ipcMain.handle("ops:delete", async (_e, id) => ops.deleteSheet(await getRootPath(), id));
ipcMain.handle("ops:buildAgentPrompt", async () => ops.buildAgentSystemPrompt(await getRootPath()));
ipcMain.handle("ops:applyEdit", async (_e, edit) => ops.applyEdit(await getRootPath(), edit));
ipcMain.handle("ops:getAgentConversation", () => getOpsAgentConversation());
ipcMain.handle("ops:saveAgentConversation", (_e, conv) => saveOpsAgentConversation(conv));

ipcMain.handle("ops:pickXlsx", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("ops:importXlsx", async (_e, filePath) => ops.importXlsx(await getRootPath(), filePath));

// ---------- mail IPC ----------

ipcMain.handle("mail:getAccount", async () => mail.getAccount(await getRootPath()));
ipcMain.handle("mail:saveAccount", async (_e, account) => mail.saveAccount(await getRootPath(), account));
ipcMain.handle("mail:testConnection", (_e, account) => mail.testConnection(account));
ipcMain.handle("mail:listMessages", async (_e, opts) => mail.listMessages(await mail.getAccount(await getRootPath()), opts));
ipcMain.handle("mail:getMessage", async (_e, uid) => mail.getMessage(await mail.getAccount(await getRootPath()), uid));
ipcMain.handle("mail:sendMail", async (_e, payload) => mail.sendMail(await getRootPath(), payload));
ipcMain.handle("mail:getAgentConversation", () => getMailAgentConversation());
ipcMain.handle("mail:saveAgentConversation", (_e, conv) => saveMailAgentConversation(conv));
ipcMain.handle("meta:mailDraftPrompt", () => MAIL_DRAFT_PROMPT);

ipcMain.handle("mail:pickLogo", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "svg"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("mail:saveSignatureLogo", async (_e, filePath) => mail.saveSignatureLogo(await getRootPath(), filePath));
