const { app, BrowserWindow, ipcMain, dialog, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const crypto = require("node:crypto");
const { proxyAwareFetch, setProxyCredentials } = require("./netFetch.cjs");

// Route every outbound request in this process (Polza, GitHub, Telegram/VK/MAX, web
// search) through Electron's network stack instead of Node's built-in fetch, which
// ignores the OS/VPN proxy entirely. See netFetch.cjs for why this isn't just
// net.fetch: main-process requests can't answer a proxy's auth challenge through it.
global.fetch = proxyAwareFetch;

// Renderer-side requests (the chat itself) are a separate path: those DO belong to a
// webContents, so they come through here instead. Credentials are read from the cache
// rather than from disk so this can answer synchronously.
let cachedProxyAuth = { username: "", password: "" };

app.on("login", (event, _webContents, _details, authInfo, callback) => {
  // Only proxy challenges — never hand the proxy password to an origin server's 401.
  if (!authInfo.isProxy || !cachedProxyAuth.username) return;
  event.preventDefault();
  callback(cachedProxyAuth.username, cachedProxyAuth.password || "");
});

/**
 * Applies the saved proxy configuration to the default session (which both the
 * renderer and every main-process request go through) and refreshes the cached
 * credentials used by the two login handlers above.
 */
async function applyProxySettings(settings) {
  cachedProxyAuth = { username: settings.proxyUsername || "", password: settings.proxyPassword || "" };
  setProxyCredentials(cachedProxyAuth.username, cachedProxyAuth.password);

  const mode = settings.proxyMode || "system";
  let config;
  if (mode === "manual" && settings.proxyUrl?.trim()) {
    config = { proxyRules: settings.proxyUrl.trim() };
  } else if (mode === "direct") {
    config = { mode: "direct" };
  } else {
    config = { mode: "system" };
  }
  try {
    await session.defaultSession.setProxy(config);
  } catch (e) {
    console.error("Не удалось применить настройки прокси:", e);
  }
}

// On some Windows setups (observed with a OneDrive-redirected Documents folder)
// app.getPath() hands back a "\\?\"-prefixed extended-length path. Node's path.join
// doesn't reliably preserve that prefix and can collapse it down to a bare "\\?"
// that no longer points anywhere, breaking every fs call built from it (ENOENT on
// the very first mkdir). We don't need the extended-length form for our own short
// subpaths, so strip it defensively before joining anything onto it.
function stripWindowsExtendedPrefix(p) {
  return typeof p === "string" && p.startsWith("\\\\?\\") ? p.slice(4) : p;
}

const USER_DATA_PATH = stripWindowsExtendedPrefix(app.getPath("userData"));
const APP_CONFIG_PATH = path.join(USER_DATA_PATH, "config.json");
const DEFAULT_ROOT = path.join(stripWindowsExtendedPrefix(app.getPath("documents")), "Личный чат");
const FALLBACK_ROOT = path.join(USER_DATA_PATH, "data");

const DEFAULT_SETTINGS = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.7,
  maxTokens: 16000,
  searchEnabled: true,
  searchProvider: "duckduckgo",
  searchApiKey: "",
  proxyMode: "system",
  proxyUrl: "",
  proxyUsername: "",
  proxyPassword: "",
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
  let root = cfg.rootPath;
  try {
    await ensureDir(root);
  } catch (e) {
    // The configured/default folder turned out to be unreachable (e.g. a mangled
    // Windows path — see stripWindowsExtendedPrefix above). Fall back to a plain
    // folder inside the app's own per-user data directory so the app can still
    // start; the user can redirect it to a different folder from Settings once
    // it's running.
    console.error(`Не удалось создать папку данных "${root}", использую запасную папку:`, e);
    root = FALLBACK_ROOT;
    await ensureDir(root);
  }
  await ensureDir(path.join(root, "projects"));
  await ensureDir(path.join(root, "skills"));
  return root;
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

const SETTINGS_PATH = path.join(USER_DATA_PATH, "settings.json");

const OLD_DEFAULT_MAX_TOKENS = 4096;

async function loadSettings() {
  const s = await readJson(SETTINGS_PATH, {});
  // One-time migration: earlier versions defaulted maxTokens to 4096, which is far too
  // small for long-form deliverables (funnels, contracts) and silently cut answers short.
  // A saved value still sitting at that exact old default almost certainly means the user
  // never touched the slider, not that they deliberately chose the smallest setting — so
  // carry them forward to the new, more generous default.
  if (s.maxTokens === OLD_DEFAULT_MAX_TOKENS) s.maxTokens = DEFAULT_SETTINGS.maxTokens;
  return { ...DEFAULT_SETTINGS, ...s };
}

async function saveSettingsFile(settings) {
  await writeJson(SETTINGS_PATH, settings);
  // Proxy changes must take effect immediately, without restarting the app.
  await applyProxySettings({ ...DEFAULT_SETTINGS, ...settings });
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

const IMAGE_MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
};

async function readFileAsDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext] || "application/octet-stream";
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function saveProjectBrandLogo(id, sourcePath) {
  const root = await getRootPath();
  const dir = projectDir(root, id);
  const ext = path.extname(sourcePath) || ".png";
  const dest = path.join(dir, "brand-logo" + ext);
  await fs.copyFile(sourcePath, dest);
  const current = await readJson(path.join(dir, "project.json"), null);
  if (!current) throw new Error("Проект не найден: " + id);
  const brand = { ...(current.brand || {}), logoPath: dest };
  return updateProject(id, { brand });
}

async function saveProjectBrandQr(id, sourcePath) {
  const root = await getRootPath();
  const dir = projectDir(root, id);
  const ext = path.extname(sourcePath) || ".png";
  const dest = path.join(dir, "brand-qr" + ext);
  await fs.copyFile(sourcePath, dest);
  const current = await readJson(path.join(dir, "project.json"), null);
  if (!current) throw new Error("Проект не найден: " + id);
  const brand = { ...(current.brand || {}), qrPath: dest };
  return updateProject(id, { brand });
}

async function saveProjectBrandHeaderImage(id, sourcePath) {
  const root = await getRootPath();
  const dir = projectDir(root, id);
  const ext = path.extname(sourcePath) || ".png";
  const dest = path.join(dir, "brand-header" + ext);
  await fs.copyFile(sourcePath, dest);
  const current = await readJson(path.join(dir, "project.json"), null);
  if (!current) throw new Error("Проект не найден: " + id);
  const brand = { ...(current.brand || {}), headerImagePath: dest };
  return updateProject(id, { brand });
}

async function clearProjectBrandHeaderImage(id) {
  const root = await getRootPath();
  const dir = projectDir(root, id);
  const current = await readJson(path.join(dir, "project.json"), null);
  if (!current) throw new Error("Проект не найден: " + id);
  const brand = { ...(current.brand || {}), headerImagePath: "" };
  return updateProject(id, { brand });
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

async function listExternalDocs(projectId) {
  const root = await getRootPath();
  const meta = await readJson(path.join(projectDir(root, projectId), "project.json"), null);
  if (!meta?.externalDocsPath) return [];
  let entries;
  try {
    entries = await fs.readdir(meta.externalDocsPath, { withFileTypes: true });
  } catch (e) {
    // Surface this instead of silently reporting "no files" — a real access problem
    // (folder moved/renamed, permissions, a OneDrive path that isn't actually reachable)
    // used to look identical to an empty folder, which made the missing-docs bug
    // impossible for the user to tell apart from "there's genuinely nothing there".
    throw new Error(`Не удалось прочитать папку "${meta.externalDocsPath}": ${e.message}`);
  }
  const docs = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_DOC_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;
    const stat = await fs.stat(path.join(meta.externalDocsPath, entry.name));
    docs.push({ name: entry.name, size: stat.size, mtime: stat.mtimeMs });
  }
  docs.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return docs;
}

// ---------- skills ----------

async function listSkills() {
  const root = await getRootPath();
  const dir = skillsDir(root);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    // "_"-prefixed files in this folder are scratch state, not skills — e.g. the Skill
    // Creator's own conversation is saved right alongside real skills as
    // "_creator_chat.json". It has no `name` field (it's a Conversation, not a Skill),
    // so without this exclusion it used to get picked up here and crash the sort below
    // with "Cannot read properties of undefined (reading 'localeCompare')" — which,
    // since this list loads at startup, took down the entire app the moment anyone had
    // ever opened the Skill Creator once.
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith("_")) continue;
    const data = await readJson(path.join(dir, entry.name), null);
    if (!data) continue;
    skills.push({ id: entry.name.replace(/\.json$/, ""), ...data });
  }
  skills.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
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

function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { name: "", description: "", body: raw.trim() };
  const [, fm, body] = match;
  const meta = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { name: meta.name || "", description: meta.description || "", body: body.trim() };
}

function humanizeFileStem(stem) {
  return stem.replace(/[-_]+/g, " ").trim();
}

async function importSkillFromFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  const { name, description, body } = parseSkillFrontmatter(raw);
  const fallbackName = humanizeFileStem(path.basename(filePath, path.extname(filePath)));
  return { name: name || fallbackName, description, content: body || raw.trim() };
}

async function importSkillFromFolder(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const skillEntry = entries.find((e) => e.isFile() && /^skill\.md$/i.test(e.name));
  if (!skillEntry) throw new Error('В выбранной папке не найден файл SKILL.md.');
  const raw = await fs.readFile(path.join(folderPath, skillEntry.name), "utf-8");
  const { name, description, body } = parseSkillFrontmatter(raw);
  const fallbackName = humanizeFileStem(path.basename(folderPath));
  const parts = [body || raw.trim()];
  const resources = entries.filter((e) => e.isFile() && e.name !== skillEntry.name);
  for (const entry of resources) {
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_DOC_EXTENSIONS.includes(ext)) continue;
    try {
      const text = await extractDocText(path.join(folderPath, entry.name));
      parts.push(`\n--- Файл: ${entry.name} ---\n${truncate(text, MAX_DOC_CHARS)}`);
    } catch {
      // skip unreadable resource file
    }
  }
  return { name: name || fallbackName, description, content: parts.join("\n") };
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

// ---------- feature modules (delegated to sibling modules) ----------

const ops = require("./ops.cjs");
const media = require("./media.cjs");
const github = require("./github.cjs");
const chatbots = require("./chatbots.cjs");
const design = require("./design.cjs");
const tasks = require("./tasks.cjs");
const websearch = require("./websearch.cjs");
const excel = require("./excel.cjs");
const exportDocs = require("./exportDocs.cjs");
const yandexAuth = require("./yandexAuth.cjs");
const direct = require("./direct.cjs");
const cloud = require("./cloud.cjs");

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {
      // window may be closing; ignore
    }
  }
}

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

  if (meta.designSystemPaths?.length) {
    const designSystem = await readDesignSystem(meta.designSystemPaths);
    if (designSystem.trim()) {
      parts.push(
        "\n\n=== ДИЗАЙН-СИСТЕМА ПРОЕКТА ===\nЭто фирменная дизайн-система проекта — придерживайся её при " +
          "оформлении любых макетов, постов и документов." +
          designSystem
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

  if (meta.externalDocsPath) {
    try {
      const externalDocs = await listExternalDocs(projectId);
      if (externalDocs.length > 0) {
        parts.push(`\n\n=== ДОКУМЕНТЫ ИЗ ВНЕШНЕЙ ПАПКИ (${meta.externalDocsPath}) ===`);
        for (const doc of externalDocs) {
          const filePath = path.join(meta.externalDocsPath, doc.name);
          let content;
          try {
            content = await extractDocText(filePath);
          } catch (e) {
            content = `[Ошибка чтения файла: ${e.message}]`;
          }
          parts.push(`\n--- Документ: ${doc.name} ---\n${truncate(content, MAX_DOC_CHARS)}`);
        }
      }
    } catch (e) {
      // Don't let an unreachable external folder break the whole system prompt (and
      // with it, the chat) — surface it to the assistant (and, via the debug preview
      // in the UI, to the user) instead of failing silently or failing loudly.
      parts.push(`\n\n=== ДОКУМЕНТЫ ИЗ ВНЕШНЕЙ ПАПКИ ===\n[${e.message}]`);
    }
  }

  let full = parts.join("\n");
  if (full.length > MAX_TOTAL_CHARS) {
    full = full.slice(0, MAX_TOTAL_CHARS) + "\n\n[...общий контекст обрезан по лимиту...]";
  }
  return full;
}

// ---------- scheduled tasks ----------

// Non-streaming chat completion, same wire format as src/lib/api.ts's
// streamChat but called from the main process (no window/EventSource
// involved) — used to run a scheduled task's prompt unattended.
async function callModelOnce(settings, messages) {
  if (!settings.apiKey) throw new Error("Не задан API-ключ. Откройте настройки и вставьте ключ Polza.ai.");
  if (!settings.model) throw new Error("Не задана модель в настройках.");
  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ошибка API (${res.status} ${res.statusText}). ${detail.slice(0, 500)}`);
  }
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Модель вернула пустой ответ.");
  return content;
}

// Executes one due scheduled task: calls the model with the project's system
// prompt + the task's own prompt, drops the exchange into a new conversation
// in that project's regular chat list (so it shows up right alongside chats
// the user started manually), and persists the task's updated run state
// (this is what advances nextRunAt for daily/weekly tasks, or disables a
// "once" task after it fires).
async function runScheduledTask(root, task) {
  const now = Date.now();
  const systemPrompt = await buildSystemPrompt(task.projectId);
  const settings = await loadSettings();

  // Scheduled tasks are exactly the case that needs web access most ("что нового
  // у конкурентов", "новости отрасли за неделю") and the one place nobody is
  // watching, so the tool loop runs unattended here: ask the model, run whatever
  // search/fetch it requests, feed the result back, repeat until it answers in
  // plain text or we hit the round limit.
  const webOn = settings.searchEnabled !== false;
  const messages = [
    { role: "system", content: systemPrompt + (webOn ? "\n\n" + websearch.WEB_TOOLS_HINT : "") },
    { role: "user", content: task.prompt },
  ];
  let reply = await callModelOnce(settings, messages);
  if (webOn) {
    for (let round = 0; round < websearch.TOOL_ROUND_LIMIT; round++) {
      const toolOutput = await websearch.runTools(reply, settings);
      if (toolOutput == null) break;
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: toolOutput });
      reply = await callModelOnce(settings, messages);
    }
  }

  const conv = {
    id: crypto.randomUUID(),
    projectId: task.projectId,
    title: `Задача: ${task.title}`,
    messages: [
      { id: crypto.randomUUID(), role: "user", content: task.prompt, createdAt: now },
      { id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: Date.now() },
    ],
    createdAt: now,
    updatedAt: Date.now(),
  };
  await saveConversation(task.projectId, conv);
  const updated = await tasks.save(root, task.projectId, {
    ...task,
    lastRunAt: now,
    lastConversationId: conv.id,
    enabled: task.recurrence === "once" ? false : task.enabled,
  });
  broadcast("tasks:ran", { projectId: task.projectId, task: updated, conversationId: conv.id });
}




/**
 * Answers an incoming chatbot message as the linked project's assistant: the
 * project's own system prompt (instructions + skills + documents + design system)
 * plus that person's recent conversation history, so the bot consults within the
 * project's knowledge base rather than as a generic model.
 *
 * Returns null when the platform isn't linked to a project or the model can't be
 * reached — the caller treats that as "stay silent" rather than sending a broken
 * or invented answer to a real customer.
 */
async function chatbotAiResponder({ platform, account, lead, messages }) {
  if (!account.aiProjectId) return null;
  const settings = await loadSettings();
  if (!settings.apiKey) {
    console.error(`ИИ-бот ${platform}: не задан API-ключ, отвечать нечем.`);
    return null;
  }

  let projectPrompt;
  try {
    projectPrompt = await buildSystemPrompt(account.aiProjectId);
  } catch (e) {
    console.error(`ИИ-бот ${platform}: проект ${account.aiProjectId} недоступен:`, e);
    return null;
  }

  const webOn = settings.searchEnabled !== false;
  const botRules =
    "\n\n=== РЕЖИМ ЧАТ-БОТА ===\n" +
    `Ты отвечаешь в мессенджере (${platform}) реальному собеседнику по имени ${lead.name || "без имени"}. ` +
    "Пиши коротко и по-человечески, как в переписке: без markdown-разметки, без заголовков и таблиц, " +
    "обычно 1–3 абзаца. Опирайся только на информацию из материалов проекта выше. " +
    "Если чего-то не знаешь или вопрос выходит за рамки проекта — честно скажи об этом и предложи связаться " +
    "с человеком, не придумывай факты, цены и условия.";

  const apiMessages = [
    { role: "system", content: projectPrompt + botRules + (webOn ? "\n\n" + websearch.WEB_TOOLS_HINT : "") },
    ...messages,
  ];

  let reply = await callModelOnce(settings, apiMessages);
  if (webOn) {
    for (let round = 0; round < websearch.TOOL_ROUND_LIMIT; round++) {
      const toolOutput = await websearch.runTools(reply, settings);
      if (toolOutput == null) break;
      apiMessages.push({ role: "assistant", content: reply });
      apiMessages.push({ role: "user", content: toolOutput });
      reply = await callModelOnce(settings, apiMessages);
    }
  }
  return reply;
}

// ---------- project design system (files/folders living anywhere on the computer) ----------

const MAX_DESIGN_SYSTEM_FILES = 40;
const MAX_DESIGN_SYSTEM_CHARS = 40000;

/** Expands attached paths (files or folders) into a flat list of readable files. */
async function collectDesignSystemFiles(paths) {
  const files = [];
  for (const p of paths || []) {
    let stat;
    try {
      stat = await fs.stat(p);
    } catch {
      files.push({ path: p, name: path.basename(p), missing: true });
      continue;
    }
    if (stat.isDirectory()) {
      const entries = await fs.readdir(p, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (files.length >= MAX_DESIGN_SYSTEM_FILES) break;
        files.push({ path: path.join(p, entry.name), name: entry.name, from: p });
      }
    } else {
      files.push({ path: p, name: path.basename(p) });
    }
    if (files.length >= MAX_DESIGN_SYSTEM_FILES) break;
  }
  return files;
}

/**
 * Renders an attached design system as prompt text. Text-ish files are read for
 * their content (that's where tokens, spacing rules, tone-of-voice notes live);
 * images and other binaries are listed by name only — they can't be inlined into
 * a text prompt, but knowing a "logo-primary.svg" exists is still useful context.
 */
async function readDesignSystem(paths) {
  const files = await collectDesignSystemFiles(paths);
  if (files.length === 0) return "";
  const parts = [];
  const listed = [];
  for (const file of files) {
    if (file.missing) {
      listed.push(`${file.name} — файл не найден (перемещён или удалён)`);
      continue;
    }
    const ext = path.extname(file.name).toLowerCase();
    if (SUPPORTED_DOC_EXTENSIONS.includes(ext) || ext === ".svg") {
      try {
        const text = ext === ".svg" ? await fs.readFile(file.path, "utf-8") : await extractDocText(file.path);
        parts.push(`\n--- ${file.name} ---\n${truncate(text, MAX_DOC_CHARS)}`);
      } catch (e) {
        listed.push(`${file.name} — не удалось прочитать (${e.message})`);
      }
    } else {
      listed.push(file.name);
    }
  }
  let out = "";
  if (listed.length > 0) out += `\nФайлы дизайн-системы (без текстового содержимого): ${listed.join(", ")}`;
  out += parts.join("\n");
  return truncate(out, MAX_DESIGN_SYSTEM_CHARS);
}

// ---------- chat attachments (files picked from anywhere on the computer) ----------

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"];

const MAX_ATTACHMENT_CHARS = 30000;

function attachmentKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  if (SUPPORTED_DOC_EXTENSIONS.includes(ext)) return "text";
  return "other";
}

/**
 * Turns picked file paths into attachment records for a chat message. Text-ish
 * documents get their text extracted right here, at attach time, so the saved
 * conversation stays self-contained and still makes sense later even if the
 * original file is moved or deleted. Images keep only their path — they're
 * re-read as a data URL at send time, because base64 image data would bloat
 * every chat JSON on disk for no benefit.
 */
async function buildAttachments(filePaths) {
  const out = [];
  for (const filePath of filePaths) {
    const kind = attachmentKind(filePath);
    let size = 0;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      // unreadable file: still record it so the user sees what failed
    }
    const record = { name: path.basename(filePath), path: filePath, kind, size };
    if (kind === "text") {
      try {
        record.text = truncate(await extractDocText(filePath), MAX_ATTACHMENT_CHARS);
      } catch (e) {
        record.error = e.message;
      }
    }
    out.push(record);
  }
  return out;
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
  return stripWindowsExtendedPrefix(app.getPath("documents"));
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

const OFFICE_FORMATS = {
  docx: { ext: "docx", label: "Документ Word", build: (payload) => exportDocs.buildDocx(payload) },
  xlsx: { ext: "xlsx", label: "Книга Excel", build: (payload) => exportDocs.buildXlsx(payload) },
};

/**
 * Saves a chat (or a single message) as a real Word/Excel file.
 *
 * Unlike the PDF/PNG exports this never renders HTML: it takes the messages'
 * markdown and rebuilds it as document structure, so tables come out editable.
 */
async function exportChatToFile({ title, sections, brand, defaultName, projectId }, format) {
  const spec = OFFICE_FORMATS[format];
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + "." + spec.ext),
    filters: [{ name: spec.label, extensions: [spec.ext] }],
  });
  if (result.canceled || !result.filePath) return null;
  const buffer = await spec.build({ title, sections, brand });
  return exportDocs.writeBuffer(result.filePath, buffer);
}

async function captureHtmlAsImage(html, { width = 900 } = {}) {
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
    return await win.webContents.capturePage();
  } finally {
    await cleanupHiddenWindow(win, tmpFile);
  }
}

async function exportHtmlToPng({ html, defaultName, projectId }) {
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + ".png"),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const image = await captureHtmlAsImage(html);
  await fs.writeFile(result.filePath, image.toPNG());
  return result.filePath;
}

async function exportHtmlToJpg({ html, defaultName, projectId }) {
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + ".jpg"),
    filters: [{ name: "JPEG", extensions: ["jpg"] }],
  });
  if (result.canceled || !result.filePath) return null;
  const image = await captureHtmlAsImage(html);
  await fs.writeFile(result.filePath, image.toJPEG(92));
  return result.filePath;
}

async function exportSvgToFile({ svg, defaultName, projectId }) {
  const parentWin = BrowserWindow.getFocusedWindow();
  const defaultDir = await resolveExportDir(projectId);
  const result = await dialog.showSaveDialog(parentWin, {
    defaultPath: path.join(defaultDir, sanitizeFileName(defaultName) + ".svg"),
    filters: [{ name: "SVG", extensions: ["svg"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await fs.writeFile(result.filePath, svg, "utf-8");
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

  // Electron denies opening a new window/tab for target="_blank" links by default —
  // without this handler, every external link in the app (GitHub token page, the
  // Polza.ai model catalog, the model catalog, etc.) does nothing at all when
  // clicked. Send them to the user's actual browser instead of trying to open inside
  // the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  await applyProxySettings(await loadSettings());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  chatbots.startScheduler(getRootPath, (platform, message) => broadcast("chatbots:message", { platform, message }));
  tasks.startScheduler(getRootPath, runScheduledTask);
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
ipcMain.handle("projects:pickLogo", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("projects:saveBrandLogo", (_e, id, filePath) => saveProjectBrandLogo(id, filePath));
ipcMain.handle("projects:pickQr", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("projects:saveBrandQr", (_e, id, filePath) => saveProjectBrandQr(id, filePath));
ipcMain.handle("projects:pickHeaderImage", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("projects:saveBrandHeaderImage", (_e, id, filePath) => saveProjectBrandHeaderImage(id, filePath));
ipcMain.handle("projects:clearBrandHeaderImage", (_e, id) => clearProjectBrandHeaderImage(id));
ipcMain.handle("fs:readFileAsDataUrl", (_e, filePath) => readFileAsDataUrl(filePath));

ipcMain.handle("projects:pickExternalDocsFolder", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("projects:setExternalDocsFolder", (_e, id, folderPath) =>
  updateProject(id, { externalDocsPath: folderPath || "" })
);
ipcMain.handle("docs:listExternal", (_e, projectId) => listExternalDocs(projectId));

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
ipcMain.handle("skills:pickImportFile", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Навык", extensions: ["md", "txt", "skill"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("skills:pickImportFolder", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("skills:importFromFile", (_e, filePath) => importSkillFromFile(filePath));
ipcMain.handle("skills:importFromFolder", (_e, folderPath) => importSkillFromFolder(folderPath));

ipcMain.handle("conversations:list", (_e, projectId) => listConversations(projectId));
ipcMain.handle("conversations:save", (_e, projectId, conv) => saveConversation(projectId, conv));
ipcMain.handle("conversations:delete", (_e, projectId, convId) => deleteConversation(projectId, convId));

ipcMain.handle("projects:pickDesignSystemFiles", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Выберите файлы дизайн-системы",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled) return [];
  return result.filePaths;
});
ipcMain.handle("projects:pickDesignSystemFolder", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Выберите папку с дизайн-системой",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("projects:addDesignSystemPaths", async (_e, id, newPaths) => {
  const root = await getRootPath();
  const meta = await readJson(path.join(projectDir(root, id), "project.json"), null);
  const existing = meta?.designSystemPaths || [];
  const merged = [...existing];
  for (const p of newPaths) if (!merged.includes(p)) merged.push(p);
  return updateProject(id, { designSystemPaths: merged });
});
ipcMain.handle("projects:removeDesignSystemPath", async (_e, id, target) => {
  const root = await getRootPath();
  const meta = await readJson(path.join(projectDir(root, id), "project.json"), null);
  const next = (meta?.designSystemPaths || []).filter((p) => p !== target);
  return updateProject(id, { designSystemPaths: next });
});
ipcMain.handle("projects:listDesignSystemFiles", async (_e, id) => {
  const root = await getRootPath();
  const meta = await readJson(path.join(projectDir(root, id), "project.json"), null);
  return collectDesignSystemFiles(meta?.designSystemPaths || []);
});

ipcMain.handle("attachments:pick", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Выберите файлы для чата",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Все поддерживаемые", extensions: [...SUPPORTED_DOC_EXTENSIONS, ...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].map((e) => e.slice(1)) },
      { name: "Документы", extensions: SUPPORTED_DOC_EXTENSIONS.map((e) => e.slice(1)) },
      { name: "Изображения", extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) },
      { name: "Видео", extensions: VIDEO_EXTENSIONS.map((e) => e.slice(1)) },
      { name: "Аудио", extensions: AUDIO_EXTENSIONS.map((e) => e.slice(1)) },
      { name: "Все файлы", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return buildAttachments(result.filePaths);
});

// ---------- Excel workbooks (live files on disk) ----------

// One workbook is open at a time, kept in memory between IPC calls so edits and
// recalculation don't re-read the file on every keystroke.
let openWorkbook = null;

function workbookPayload(model, recalcResult) {
  return {
    filePath: model.filePath,
    name: model.name,
    sheets: model.sheets.map((s) => ({ name: s.name, cells: s.cells, maxRow: s.maxRow, maxCol: s.maxCol })),
    recalc: recalcResult || null,
  };
}

ipcMain.handle("excel:pick", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: "Выберите файл Excel",
    properties: ["openFile"],
    filters: [{ name: "Excel", extensions: ["xlsx", "xlsm"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("excel:open", async (_e, filePath) => {
  openWorkbook = await excel.loadWorkbook(filePath);
  const recalc = excel.recalculate(openWorkbook);
  return workbookPayload(openWorkbook, recalc);
});

ipcMain.handle("excel:new", async (_e, name) => {
  openWorkbook = excel.createWorkbook(name);
  return workbookPayload(openWorkbook, null);
});

/**
 * Applies an edit the Excel agent proposed and the user confirmed. Unlike the grid's
 * setCells this may also create whole sheets, so it reports which ones appeared.
 */
ipcMain.handle("excel:applyAgentEdit", async (_e, edit) => {
  if (!openWorkbook) throw new Error("Файл Excel не открыт.");
  const { createdSheets } = excel.applyAgentEdit(openWorkbook, edit);
  const recalc = excel.recalculate(openWorkbook);
  return { workbook: workbookPayload(openWorkbook, recalc), createdSheets };
});

// Read-only: evaluates a formula or dumps a range so the agent can check its numbers
// against the live workbook before proposing anything. Nothing is modified here, so
// this runs without a confirmation step, like the web-search tools.
ipcMain.handle("excel:runAgentTools", async (_e, text) => {
  if (!openWorkbook) return null;
  return excel.runAgentTools(openWorkbook, text);
});

ipcMain.handle("excel:setCells", async (_e, edits) => {
  if (!openWorkbook) throw new Error("Файл Excel не открыт.");
  for (const { sheet, cell, value } of edits) excel.setCell(openWorkbook, sheet, cell, value);
  const recalc = excel.recalculate(openWorkbook);
  return workbookPayload(openWorkbook, recalc);
});

ipcMain.handle("excel:save", async (_e, saveAs) => {
  if (!openWorkbook) throw new Error("Файл Excel не открыт.");
  let target = null;
  // A workbook created in the app has nowhere to save to yet, so it always asks.
  if (saveAs || !openWorkbook.filePath) {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win, {
      title: "Сохранить как",
      defaultPath: openWorkbook.filePath || openWorkbook.name,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  const dest = await excel.saveWorkbook(openWorkbook, target);
  if (target) {
    // After "save as" — or the first save of a new workbook — that file is the one
    // we're editing from now on.
    // After "save as" the new file becomes the one we're editing.
    openWorkbook.filePath = dest;
    openWorkbook.name = path.basename(dest);
  }
  return dest;
});

ipcMain.handle("excel:buildAgentPrompt", async () => {
  if (!openWorkbook) throw new Error("Файл Excel не открыт.");
  return excel.buildAgentPrompt(openWorkbook);
});

ipcMain.handle("excel:getAgentConversation", async () => {
  const root = await getRootPath();
  return readJson(path.join(root, "excel", "_agent_chat.json"), null);
});

ipcMain.handle("excel:saveAgentConversation", async (_e, conv) => {
  const root = await getRootPath();
  await ensureDir(path.join(root, "excel"));
  await writeJson(path.join(root, "excel", "_agent_chat.json"), conv);
  return conv;
});

// ---------- Storage report & archiving ----------
//
// The thing that actually grows without bound here is chat history: every turn sends
// the whole conversation to the model, so a long chat gets slower, more expensive and
// eventually exceeds the model's context. Disk space is a non-issue by comparison —
// text is tiny; generated media is the only heavy folder. This pair of handlers gives
// the user the numbers and a safe way to act on them.

async function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  const walk = async (current) => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return; // folder not created yet
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        try {
          const stat = await fs.stat(full);
          bytes += stat.size;
          files++;
        } catch {
          // file vanished between listing and stat — nothing to count
        }
      }
    }
  };
  await walk(dir);
  return { bytes, files };
}

const REPORT_FOLDERS = [
  ["projects", "Проекты (чаты и документы)"],
  ["media", "Сгенерированные картинки и видео"],
  ["design", "Дизайны"],
  ["skills", "Навыки"],
  ["cloud", "Загрузки из облака"],
  ["chatbots", "Чат-боты"],
  ["ops", "Операционка"],
  ["excel", "Excel-агент"],
  ["direct", "Директ"],
];

/** How long a chat has to get before folding it down is worth suggesting. */
const HEAVY_CHAT_CHARS = 60000;

ipcMain.handle("storage:report", async () => {
  const root = await getRootPath();
  const folders = [];
  let totalBytes = 0;
  for (const [dir, name] of REPORT_FOLDERS) {
    const { bytes, files } = await dirStats(path.join(root, dir));
    if (files === 0) continue;
    folders.push({ name, bytes, files });
    totalBytes += bytes;
  }
  folders.sort((a, b) => b.bytes - a.bytes);

  const heavyChats = [];
  for (const project of await listProjects()) {
    for (const conv of await listConversations(project.id)) {
      const chars = (conv.messages || []).reduce((sum, m) => sum + (m.content?.length || 0), 0);
      if (chars < HEAVY_CHAT_CHARS) continue;
      heavyChats.push({
        projectId: project.id,
        projectName: project.name,
        convId: conv.id,
        title: conv.title,
        messages: conv.messages.length,
        chars,
      });
    }
  }
  heavyChats.sort((a, b) => b.chars - a.chars);
  return { rootPath: root, totalBytes, folders, heavyChats: heavyChats.slice(0, 20) };
});

// Folding a chat down must never destroy anything: the original messages are written
// out first, under the chat's own folder, before the conversation keeps only a summary.
ipcMain.handle("chats:archiveMessages", async (_e, projectId, conv, messages) => {
  const root = await getRootPath();
  const dir = path.join(chatsDir(root, projectId), "archive");
  await ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${conv.id}-${stamp}.json`);
  await writeJson(file, { title: conv.title, archivedAt: Date.now(), messages });
  return { path: file };
});

// ---------- Яндекс Директ ----------
//
// Direct rides on the same Yandex OAuth token as the Disk connection, so it has no
// credentials of its own — only a client login (needed when the account is managed
// by an agency) and the last date range, kept next to the other module settings.

function directSettingsFile(root) {
  return path.join(root, "direct", "settings.json");
}

async function getDirectSettings() {
  const root = await getRootPath();
  const stored = await readJson(directSettingsFile(root), {});
  return { clientLogin: "", ...stored };
}

async function saveDirectSettings(patch) {
  const root = await getRootPath();
  const current = await getDirectSettings();
  const next = { ...current, ...patch, clientLogin: (patch.clientLogin ?? current.clientLogin ?? "").trim() };
  await ensureDir(path.join(root, "direct"));
  await writeJson(directSettingsFile(root), next);
  return next;
}

/** Token + client login, the pair every Direct call needs. */
async function directAuth() {
  const [token, settings] = await Promise.all([currentProviderToken("yandex"), getDirectSettings()]);
  if (!token) {
    throw new Error(
      "Аккаунт Яндекса не подключён. Откройте «☁️ Облако» → «Подключение» и нажмите «Подключить Яндекс» — " +
        "тот же токен используется и для Директа (не забудьте отметить права Яндекс.Директа в приложении)."
    );
  }
  return { token, clientLogin: settings.clientLogin };
}

ipcMain.handle("direct:getSettings", () => getDirectSettings());
ipcMain.handle("direct:saveSettings", (_e, patch) => saveDirectSettings(patch || {}));

ipcMain.handle("direct:testConnection", async () => {
  try {
    const { token, clientLogin } = await directAuth();
    return direct.testConnection(token, clientLogin);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("direct:listCampaigns", async () => {
  const { token, clientLogin } = await directAuth();
  return direct.listCampaigns(token, clientLogin);
});

ipcMain.handle("direct:listKeywords", async (_e, campaignIds) => {
  const { token, clientLogin } = await directAuth();
  return direct.listKeywords(token, campaignIds, clientLogin);
});

ipcMain.handle("direct:listAds", async (_e, campaignIds) => {
  const { token, clientLogin } = await directAuth();
  return direct.listAds(token, campaignIds, clientLogin);
});

ipcMain.handle("direct:getStats", async (_e, range) => {
  const { token, clientLogin } = await directAuth();
  return direct.getStats(token, { ...range, clientLogin });
});

// Mutations, run only after the user confirmed the agent's proposal in the UI.
ipcMain.handle("direct:setCampaignState", async (_e, campaignId, resume) => {
  const { token, clientLogin } = await directAuth();
  return direct.setCampaignState(token, campaignId, resume, clientLogin);
});

ipcMain.handle("direct:setKeywordBid", async (_e, keywordId, bid) => {
  const { token, clientLogin } = await directAuth();
  return direct.setKeywordBid(token, keywordId, bid, clientLogin);
});

ipcMain.handle("direct:buildAgentPrompt", (_e, data) => direct.buildAgentPrompt(data || {}));

ipcMain.handle("direct:getAgentConversation", async () => {
  const root = await getRootPath();
  return readJson(path.join(root, "direct", "_agent_chat.json"), null);
});

ipcMain.handle("direct:saveAgentConversation", async (_e, conv) => {
  const root = await getRootPath();
  await ensureDir(path.join(root, "direct"));
  await writeJson(path.join(root, "direct", "_agent_chat.json"), conv);
  return conv;
});

// ---------- Cloud storage (Яндекс Диск / Google Drive) ----------

ipcMain.handle("cloud:getAccounts", async () => cloud.getAccounts(await getRootPath()));
ipcMain.handle("cloud:saveAccounts", async (_e, accounts) => cloud.saveAccounts(await getRootPath(), accounts));
ipcMain.handle("cloud:testConnection", async (_e, provider, token) => {
  if (provider !== "yandex") return cloud.testConnection(provider, token);
  // A blank token in the form means "use the one we already hold" — after the OAuth
  // exchange there is nothing for the user to paste, so there is nothing to send.
  return cloud.testConnection("yandex", (token || "").trim() || (await currentProviderToken("yandex")));
});

/**
 * The token to use for a provider right now, renewing an expired Yandex one and
 * writing the renewal back so the next call doesn't repeat the work.
 */
async function currentProviderToken(provider) {
  const root = await getRootPath();
  const accounts = await cloud.getAccounts(root);
  if (provider !== "yandex") return accounts[provider]?.token;
  const { account, renewed } = await cloud.ensureYandexToken(accounts.yandex || {});
  if (renewed) await cloud.saveAccounts(root, { ...accounts, yandex: account });
  return account.token;
}

/**
 * Runs the Yandex consent flow and stores the resulting token.
 * `manualCode` covers apps registered to only print the code on screen, where no
 * code ever appears in a URL for the window to catch.
 */
async function connectYandex({ clientId, clientSecret, manualCode }) {
  const root = await getRootPath();
  const accounts = await cloud.getAccounts(root);
  const id = (clientId || "").trim();
  const secret = (clientSecret || "").trim();
  if (!id || !secret) return { ok: false, error: "Заполните Client ID и Client secret." };

  let code = (manualCode || "").trim();
  if (!code) {
    code = await yandexAuth.pickCodeInWindow(BrowserWindow, id, BrowserWindow.getFocusedWindow());
    if (!code) {
      return {
        ok: false,
        needsCode: true,
        error:
          "Окно закрыто без кода. Если Яндекс показал код подтверждения на странице — вставьте его в поле ниже " +
          "и нажмите «Обменять код на токен».",
      };
    }
  }

  try {
    const issued = await yandexAuth.exchangeCode(id, secret, code);
    const yandex = {
      token: issued.token,
      clientId: id,
      clientSecret: secret,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
    };
    const saved = await cloud.saveAccounts(root, { ...accounts, yandex });
    const check = await cloud.testConnection("yandex", issued.token);
    return { ok: true, accounts: saved, login: check.login || "", error: check.ok ? undefined : check.error };
  } catch (e) {
    return { ok: false, needsCode: true, error: e.message };
  }
}

ipcMain.handle("cloud:connectYandex", (_e, payload) => connectYandex(payload || {}));

ipcMain.handle("cloud:list", async (_e, provider, folder) => {
  return cloud.list(provider, await currentProviderToken(provider), folder);
});

ipcMain.handle("cloud:download", async (_e, provider, remote, fileName) => {
  const root = await getRootPath();
  const dir = path.join(root, "cloud", "downloads");
  await ensureDir(dir);
  return cloud.download(provider, await currentProviderToken(provider), remote, path.join(dir, fileName));
});

// Downloads straight into a project's docs folder, so a cloud file becomes part of
// that project's knowledge base in one step.
ipcMain.handle("cloud:downloadToProject", async (_e, provider, remote, fileName, projectId) => {
  const root = await getRootPath();
  const dir = docsDir(root, projectId);
  await ensureDir(dir);
  const result = await cloud.download(provider, await currentProviderToken(provider), remote, path.join(dir, fileName));
  await updateProject(projectId, {});
  return result;
});

ipcMain.handle("cloud:uploadFile", async (_e, provider, remoteFolder) => {
  const win = BrowserWindow.getFocusedWindow();
  const picked = await dialog.showOpenDialog(win, {
    title: "Выберите файл для загрузки в облако",
    properties: ["openFile"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;
  const localPath = picked.filePaths[0];
  const name = path.basename(localPath);
  // Яндекс addresses by path, Google by parent folder id — build what each needs.
  const remote = provider === "yandex" ? `${(remoteFolder || "disk:/").replace(/\/$/, "")}/${name}` : remoteFolder;
  return cloud.upload(provider, await currentProviderToken(provider), localPath, remote, name);
});

ipcMain.handle("proxy:test", async (_e, draftSettings) => {
  // Apply the settings being tested (not the saved ones) so the button reports on
  // what's currently typed in the form, then make a real request to the model API —
  // the destination that actually matters — so DNS, the proxy, its authentication
  // and TLS are all exercised end to end rather than guessed at.
  const settings = { ...(await loadSettings()), ...(draftSettings || {}) };
  await applyProxySettings(settings);
  // Chromium caches proxy credentials for the session once they work, so without
  // clearing them a re-test would keep reporting success even after the password
  // was changed or emptied — exactly when the user most needs an honest answer.
  await session.defaultSession.clearAuthCache();
  const url = (settings.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, "") + "/models";
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {} });
    const ms = Date.now() - started;
    if (res.status === 407) {
      return {
        ok: false,
        error:
          "Прокси требует авторизацию, но логин/пароль не подошли (407). Проверьте их — " +
          "это логин от прокси, а не от Polza.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: `Соединение прошло, но сервер ответил ${res.status} ${res.statusText}.`, ms };
    }
    return { ok: true, ms };
  } catch (e) {
    const msg = String(e.message || e);
    let hint = "";
    if (msg.includes("ERR_PROXY_CONNECTION_FAILED")) hint = " Адрес или порт прокси недоступны.";
    else if (msg.includes("ERR_TOO_MANY_RETRIES")) hint = " Прокси отклоняет логин/пароль.";
    else if (msg.includes("ERR_NO_SUPPORTED_PROXIES")) hint = " Такой адрес прокси не поддерживается — уберите логин/пароль из адреса и впишите их в поля ниже.";
    else if (msg.includes("ERR_NAME_NOT_RESOLVED")) hint = " Не удалось определить адрес — проверьте написание.";
    return { ok: false, error: msg + hint };
  } finally {
    // Leave the session on the *saved* settings, so merely testing a draft doesn't
    // silently change what the rest of the app is using.
    await applyProxySettings(await loadSettings());
  }
});

ipcMain.handle("web:runTools", async (_e, text) => websearch.runTools(text, await loadSettings()));
ipcMain.handle("web:search", async (_e, query) => websearch.search(query, await loadSettings()));
ipcMain.handle("meta:webToolsHint", async () => {
  const settings = await loadSettings();
  return settings.searchEnabled === false ? "" : websearch.WEB_TOOLS_HINT;
});

ipcMain.handle("tasks:list", async (_e, projectId) => tasks.list(await getRootPath(), projectId));
ipcMain.handle("tasks:save", async (_e, projectId, task) => tasks.save(await getRootPath(), projectId, task));
ipcMain.handle("tasks:delete", async (_e, projectId, id) => tasks.remove(await getRootPath(), projectId, id));

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

ipcMain.handle("export:toDocx", (_e, payload) => exportChatToFile(payload, "docx"));
ipcMain.handle("export:toXlsx", (_e, payload) => exportChatToFile(payload, "xlsx"));
ipcMain.handle("export:toPdf", (_e, payload) => exportHtmlToPdf(payload));
ipcMain.handle("export:toPng", (_e, payload) => exportHtmlToPng(payload));
ipcMain.handle("export:toJpg", (_e, payload) => exportHtmlToJpg(payload));
ipcMain.handle("export:svgFile", (_e, payload) => exportSvgToFile(payload));

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

// ---------- GitHub IPC ----------

ipcMain.handle("github:getAccount", async () => github.getAccount(await getRootPath()));
ipcMain.handle("github:saveAccount", async (_e, account) => github.saveAccount(await getRootPath(), account));
ipcMain.handle("github:testConnection", (_e, token) => github.testConnection(token));

async function githubToken() {
  const account = await github.getAccount(await getRootPath());
  return account.token;
}

ipcMain.handle("github:listRepos", async () => github.listRepos(await githubToken()));
ipcMain.handle("github:createRepo", async (_e, data) => github.createRepo(await githubToken(), data));
ipcMain.handle("github:getTree", async (_e, owner, repo) => github.getTree(await githubToken(), owner, repo));
ipcMain.handle("github:getFileContent", async (_e, owner, repo, filePath, ref) =>
  github.getFileContent(await githubToken(), owner, repo, filePath, ref)
);
ipcMain.handle("github:commitFile", async (_e, owner, repo, filePath, content, message, sha, branch) =>
  github.commitFile(await githubToken(), owner, repo, filePath, content, message, sha, branch)
);
ipcMain.handle("github:listWorkflows", async (_e, owner, repo) => {
  const account = await github.getAccount(await getRootPath());
  return github.listWorkflows(account.token, owner, repo);
});
ipcMain.handle("github:runWorkflow", async (_e, owner, repo, workflowId, ref) => {
  const account = await github.getAccount(await getRootPath());
  return github.runWorkflow(account.token, owner, repo, workflowId, ref);
});
ipcMain.handle("github:listWorkflowRuns", async (_e, owner, repo, workflowId, limit) => {
  const account = await github.getAccount(await getRootPath());
  return github.listWorkflowRuns(account.token, owner, repo, workflowId, limit);
});
ipcMain.handle("github:listBranches", async (_e, owner, repo) => {
  const account = await github.getAccount(await getRootPath());
  return github.listBranches(account.token, owner, repo);
});

ipcMain.handle("github:getAgentConversation", async (_e, owner, repo) =>
  github.getAgentConversation(await getRootPath(), owner, repo)
);
ipcMain.handle("github:saveAgentConversation", async (_e, owner, repo, conv) =>
  github.saveAgentConversation(await getRootPath(), owner, repo, conv)
);

// ---------- chatbots / funnels IPC ----------

ipcMain.handle("chatbots:getAccounts", async () => chatbots.getAccounts(await getRootPath()));
ipcMain.handle("chatbots:saveAccounts", async (_e, accounts) => chatbots.saveAccounts(await getRootPath(), accounts));
ipcMain.handle("chatbots:testConnection", (_e, platform, account) => chatbots.testConnection(platform, account));

ipcMain.handle("chatbots:start", async (_e, platform) => {
  const root = await getRootPath();
  await chatbots.start(
    root,
    platform,
    (p, message) => broadcast("chatbots:message", { platform: p, message }),
    (p, status) => broadcast("chatbots:status", { platform: p, status }),
    chatbotAiResponder
  );
  return chatbots.getStatus();
});
ipcMain.handle("chatbots:stop", (_e, platform) => {
  chatbots.stop(platform);
  return chatbots.getStatus();
});
ipcMain.handle("chatbots:getStatus", () => chatbots.getStatus());

ipcMain.handle("chatbots:getFunnels", async () => chatbots.getFunnels(await getRootPath()));
ipcMain.handle("chatbots:saveFunnels", async (_e, funnels) => chatbots.saveFunnels(await getRootPath(), funnels));

ipcMain.handle("chatbots:getLeads", async (_e, platform) => chatbots.getLeads(await getRootPath(), platform));
ipcMain.handle("chatbots:getMessages", async (_e, platform) => chatbots.getMessages(await getRootPath(), platform));
ipcMain.handle("chatbots:sendManual", async (_e, platform, userId, text) =>
  chatbots.sendManual(await getRootPath(), platform, userId, text)
);

// ---------- media generation IPC ----------

ipcMain.handle("media:generate", async (event, payload) => {
  const root = await getRootPath();
  const settings = await loadSettings();
  return media.generate(root, {
    ...payload,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    onStatus: (status) => {
      try {
        event.sender.send("media:progress", status);
      } catch {
        // window may have closed mid-generation; ignore
      }
    },
  });
});
ipcMain.handle("media:list", async (_e, projectId) => media.list(await getRootPath(), projectId));
ipcMain.handle("media:openFolder", async (_e, projectId) => {
  const root = await getRootPath();
  const dir = media.mediaDir(root, projectId);
  await media.ensureDir(dir);
  await shell.openPath(dir);
});
ipcMain.handle("media:pickReferenceImage", async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Изображения", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------- design section IPC ----------

ipcMain.handle("design:list", async (_e, projectId) => design.list(await getRootPath(), projectId));
ipcMain.handle("design:save", async (_e, projectId, doc) => design.save(await getRootPath(), projectId, doc));
ipcMain.handle("design:delete", async (_e, projectId, id) => design.remove(await getRootPath(), projectId, id));
ipcMain.handle("design:buildAgentPrompt", async (_e, projectId) => {
  const root = await getRootPath();
  let brand;
  let designSystem = "";
  if (projectId) {
    const meta = await readJson(path.join(projectDir(root, projectId), "project.json"), null);
    brand = meta?.brand;
    if (meta?.designSystemPaths?.length) designSystem = await readDesignSystem(meta.designSystemPaths);
  }
  const base = design.buildAgentSystemPrompt(brand);
  if (!designSystem.trim()) return base;
  return `${base}\n\n=== ДИЗАЙН-СИСТЕМА ПРОЕКТА ===\nСтрого придерживайся её во всех макетах.${designSystem}`;
});
ipcMain.handle("design:getAgentConversation", async (_e, projectId) => design.getAgentConversation(await getRootPath(), projectId));
ipcMain.handle("design:saveAgentConversation", async (_e, projectId, conv) => design.saveAgentConversation(await getRootPath(), projectId, conv));
ipcMain.handle("design:openFolder", async (_e, projectId) => {
  const root = await getRootPath();
  const dir = design.designDir(root, projectId);
  await ensureDir(dir);
  await shell.openPath(dir);
});
