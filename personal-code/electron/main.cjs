const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const crypto = require("node:crypto");

const { proxyAwareFetch } = require("./netFetch.cjs");
// Node's built-in fetch ignores the OS/VPN proxy entirely, so every outbound
// request in this process goes through Electron's network stack instead. See
// netFetch.cjs for why this isn't simply net.fetch.
global.fetch = proxyAwareFetch;

const settingsStore = require("./settings.cjs");
const workspace = require("./workspace.cjs");
const git = require("./git.cjs");
const agent = require("./agent.cjs");
const blueprints = require("./blueprints.cjs");
const demoAccess = require("./demoAccess.cjs");
const pluginArchive = require("./pluginArchive.cjs");
const websearch = require("./websearch.cjs");
const buildPipeline = require("./build.cjs");

let mainWindow = null;

app.on("login", (event, _webContents, _details, authInfo, callback) => {
  // Only proxy challenges — the proxy password must never be offered to an
  // origin server answering 401.
  const auth = settingsStore.proxyAuth();
  if (!authInfo.isProxy || !auth.username) return;
  event.preventDefault();
  callback(auth.username, auth.password || "");
});

// ---------- workspace state ----------

let currentRoot = "";

function requireRoot() {
  if (!currentRoot) throw new Error("Папка проекта не открыта. Нажмите «Открыть папку».");
  if (!fsSync.existsSync(currentRoot)) {
    throw new Error(`Папка «${currentRoot}» больше не существует.`);
  }
  return currentRoot;
}

async function rememberWorkspace(dir) {
  const recent = await settingsStore.readSection("recentWorkspaces", []);
  const next = [dir, ...recent.filter((p) => p !== dir)].slice(0, 12);
  await settingsStore.writeSection("recentWorkspaces", next);
  await settingsStore.writeSection("workspace", dir);
  return next;
}

async function openWorkspace(dir) {
  if (!dir || !fsSync.existsSync(dir)) throw new Error(`Папка «${dir}» не найдена.`);
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) throw new Error(`«${dir}» — это не папка.`);
  currentRoot = path.resolve(dir);
  const recent = await rememberWorkspace(currentRoot);
  return { root: currentRoot, isRepo: git.isRepo(currentRoot), recent };
}

// ---------- data folder ----------

// Архив плагинов живёт в «Документы\\Личный код», пока не выбрана другая папка.
// Одно место, которое об этом знает, чтобы настройка и запуск не разошлись.
function dataRootOf(settings) {
  const chosen = (settings?.dataRoot || "").trim();
  return chosen || settingsStore.stripWindowsExtendedPrefix(app.getPath("documents"));
}

async function applyDataRoot() {
  const settings = await settingsStore.load();
  const root = dataRootOf(settings);
  pluginArchive.init(root);
  return root;
}

function conversationsDir() {
  return path.join(settingsStore.stripWindowsExtendedPrefix(app.getPath("userData")), "conversations");
}

/** Размер папки и число файлов в ней — для раздела «Обслуживание». */
async function folderSize(dir) {
  let bytes = 0;
  let files = 0;
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null);
        if (stat) {
          bytes += stat.size;
          files++;
        }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

/**
 * Что занимает место. У этого приложения ответ короткий: архив плагинов (там
 * лежат версии, которые намеренно не перезаписываются) и переписка с агентом по
 * каждой открытой папке.
 */
async function storageReport() {
  const settings = await settingsStore.load();
  const archiveRoot = path.join(dataRootOf(settings), "Личный код", "Плагины");
  const folders = [];

  const plugins = await fs.readdir(archiveRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of plugins) {
    if (!entry.isDirectory()) continue;
    const { bytes, files } = await folderSize(path.join(archiveRoot, entry.name));
    const versions = (await fs.readdir(path.join(archiveRoot, entry.name), { withFileTypes: true }).catch(() => []))
      .filter((v) => v.isDirectory() && /^v\d+$/.test(v.name)).length;
    folders.push({ name: `Плагин «${entry.name}»`, bytes, files, versions });
  }

  const conversations = await folderSize(conversationsDir());
  if (conversations.files) {
    folders.push({ name: "Переписка с агентом", bytes: conversations.bytes, files: conversations.files, versions: 0 });
  }

  folders.sort((a, b) => b.bytes - a.bytes);
  return {
    rootPath: archiveRoot,
    totalBytes: folders.reduce((sum, f) => sum + f.bytes, 0),
    folders,
  };
}

// ---------- agent conversations ----------

// One conversation per workspace, so switching project switches the dialogue
// instead of carrying another project's context into it.
function conversationFile(root) {
  const hash = crypto.createHash("sha1").update(root).digest("hex").slice(0, 16);
  return path.join(
    settingsStore.stripWindowsExtendedPrefix(app.getPath("userData")),
    "conversations",
    `${hash}.json`
  );
}

async function readConversation(root) {
  try {
    const raw = await fs.readFile(conversationFile(root), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.messages) ? parsed : { root, messages: [] };
  } catch {
    return { root, messages: [] };
  }
}

async function writeConversation(root, conversation) {
  const file = conversationFile(root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...conversation, root }, null, 2), "utf-8");
}

// The conversation is replayed to the model on every turn, so it needs a ceiling.
// Oldest exchanges are dropped first; the system prompt and project map are
// rebuilt fresh each turn and are not part of this budget.
const HISTORY_CHAR_BUDGET = 120_000;

function trimHistory(messages) {
  const kept = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const size = (messages[i].content || "").length;
    if (total + size > HISTORY_CHAR_BUDGET && kept.length) break;
    total += size;
    kept.unshift(messages[i]);
  }
  return kept;
}

/**
 * One agent turn: send the message, run whatever read-only tools the model asks
 * for, and stop as soon as it produces either a plain answer, a file-edit
 * proposal, or a command to run. Nothing is written to disk here.
 */
async function runAgentTurn(root, userMessage, { openFile = null } = {}) {
  const settings = await settingsStore.load();
  const conversation = await readConversation(root);
  const context = await agent.buildContext(root, { openFile });

  const history = trimHistory(conversation.messages);
  // Поиск в интернете — такой же читающий инструмент, как чтение файла: ничего
  // не меняет, поэтому выполняется сразу, без подтверждения.
  const webAllowed = settings.searchEnabled === true;
  const messages = [
    { role: "system", content: agent.SYSTEM_PROMPT + (webAllowed ? "\n\n" + websearch.WEB_TOOLS_HINT : "") },
    { role: "system", content: "Текущий проект.\n" + context },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const transcript = [];
  let reply = await settingsStore.callModel(settings, messages);

  for (let round = 0; round < agent.TOOL_ROUND_LIMIT; round++) {
    const toolOutput =
      (await agent.runReadTools(root, reply)) ?? (webAllowed ? await websearch.runTools(reply, settings) : null);
    if (toolOutput == null) break;
    transcript.push({ role: "assistant", content: reply });
    transcript.push({ role: "user", content: toolOutput });
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: toolOutput });
    reply = await settingsStore.callModel(settings, messages);
  }

  let proposal = null;
  let command = null;
  let parseError = null;
  try {
    proposal = await agent.buildProposal(root, reply);
  } catch (e) {
    // A malformed or unmatchable edit block is reported in the chat rather than
    // half-applied, so the person can ask the agent to try again.
    parseError = e.message;
  }
  if (!proposal) command = agent.parseRunBlock(reply);

  const now = Date.now();
  conversation.messages = [
    ...conversation.messages,
    { id: crypto.randomUUID(), role: "user", content: userMessage, createdAt: now },
    ...transcript.map((m) => ({ id: crypto.randomUUID(), ...m, tool: true, createdAt: Date.now() })),
    { id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: Date.now() },
  ];
  await writeConversation(root, conversation);

  return { reply, proposal, command, parseError, messages: conversation.messages };
}

// ---------- window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 640,
    title: "Личный код",
    backgroundColor: "#f7f6f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  settingsStore.init();
  demoAccess.init(settingsStore.stripWindowsExtendedPrefix(app.getPath("userData")));
  await applyDataRoot();
  await settingsStore.applyProxy(await settingsStore.load());
  const saved = await settingsStore.readSection("workspace", "");
  if (saved && fsSync.existsSync(saved)) currentRoot = saved;
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------- IPC ----------

function registerHandlers() {
  // settings
  ipcMain.handle("settings:get", () => settingsStore.load());
  ipcMain.handle("settings:save", async (_e, patch) => {
    const saved = await settingsStore.save(patch);
    // Папка с данными могла смениться — архив плагинов должен смотреть туда же,
    // куда указывают настройки, не дожидаясь перезапуска.
    await applyDataRoot();
    return saved;
  });
  ipcMain.handle("settings:dataFolder", async () => {
    const settings = await settingsStore.load();
    return path.join(dataRootOf(settings), "Личный код");
  });
  ipcMain.handle("settings:chooseDataFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Где хранить данные «Личного кода»",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const saved = await settingsStore.save({ dataRoot: result.filePaths[0] });
    await applyDataRoot();
    return { settings: saved, folder: path.join(dataRootOf(saved), "Личный код") };
  });
  ipcMain.handle("settings:openDataFolder", async () => {
    const settings = await settingsStore.load();
    const dir = path.join(dataRootOf(settings), "Личный код");
    await fs.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle("settings:storageReport", () => storageReport());
  ipcMain.handle("settings:testProxy", (_e, draft) => settingsStore.testProxy(draft || {}));
  ipcMain.handle("models:list", (_e, draft) => settingsStore.listModels(draft));

  // workspace
  ipcMain.handle("workspace:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Выберите папку с кодом",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return openWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("workspace:open", (_e, dir) => openWorkspace(dir));
  ipcMain.handle("workspace:current", async () => ({
    root: currentRoot,
    isRepo: currentRoot ? git.isRepo(currentRoot) : false,
    recent: await settingsStore.readSection("recentWorkspaces", []),
  }));
  ipcMain.handle("workspace:close", async () => {
    currentRoot = "";
    await settingsStore.writeSection("workspace", "");
    return { root: "", isRepo: false };
  });
  ipcMain.handle("workspace:tree", () => workspace.tree(requireRoot()));
  ipcMain.handle("workspace:read", (_e, rel) => workspace.readFile(requireRoot(), rel));
  ipcMain.handle("workspace:write", (_e, rel, content) => workspace.writeFile(requireRoot(), rel, content));
  ipcMain.handle("workspace:create", (_e, rel, content) => workspace.createFile(requireRoot(), rel, content || ""));
  ipcMain.handle("workspace:createDir", (_e, rel) => workspace.createDir(requireRoot(), rel));
  ipcMain.handle("workspace:delete", (_e, rel) => workspace.deletePath(requireRoot(), rel));
  ipcMain.handle("workspace:rename", (_e, from, to) => workspace.renamePath(requireRoot(), from, to));
  ipcMain.handle("workspace:search", (_e, query, options) => workspace.search(requireRoot(), query, options || {}));
  ipcMain.handle("workspace:reveal", (_e, rel) => {
    shell.showItemInFolder(workspace.resolveInside(requireRoot(), rel));
    return true;
  });

  // git
  const tokenFor = async () => {
    const settings = await settingsStore.load();
    return { token: settings.gitToken || "", tokenUser: settings.gitTokenUser || "" };
  };
  ipcMain.handle("git:status", () => git.status(requireRoot()));
  ipcMain.handle("git:diff", (_e, options) => git.diff(requireRoot(), options || {}));
  ipcMain.handle("git:showUntracked", (_e, file) => git.showUntracked(requireRoot(), file));
  ipcMain.handle("git:log", (_e, limit) => git.log(requireRoot(), limit));
  ipcMain.handle("git:branches", () => git.branches(requireRoot()));
  ipcMain.handle("git:stage", (_e, files) => git.stage(requireRoot(), files));
  ipcMain.handle("git:stageAll", () => git.stageAll(requireRoot()));
  ipcMain.handle("git:unstage", (_e, files) => git.unstage(requireRoot(), files));
  ipcMain.handle("git:discard", (_e, files) => git.discard(requireRoot(), files));
  ipcMain.handle("git:commit", async (_e, message) => {
    const settings = await settingsStore.load();
    return git.commit(requireRoot(), message, {
      userName: settings.gitUserName,
      userEmail: settings.gitUserEmail,
    });
  });
  ipcMain.handle("git:createBranch", (_e, name) => git.createBranch(requireRoot(), name));
  ipcMain.handle("git:checkout", (_e, name) => git.checkoutBranch(requireRoot(), name));
  ipcMain.handle("git:remotes", () => git.remotes(requireRoot()));
  ipcMain.handle("git:addRemote", (_e, name, url) => git.addRemote(requireRoot(), name, url));
  ipcMain.handle("git:init", () => git.initRepo(requireRoot()));
  ipcMain.handle("git:push", async (_e, options) => git.push(requireRoot(), { ...(options || {}), ...(await tokenFor()) }));
  ipcMain.handle("git:pull", async (_e, options) => git.pull(requireRoot(), { ...(options || {}), ...(await tokenFor()) }));
  ipcMain.handle("git:fetch", async (_e, options) => git.fetch(requireRoot(), { ...(options || {}), ...(await tokenFor()) }));

  // agent
  ipcMain.handle("agent:send", (_e, message, options) => runAgentTurn(requireRoot(), message, options || {}));
  ipcMain.handle("agent:history", () => readConversation(requireRoot()));
  ipcMain.handle("agent:clear", async () => {
    const root = requireRoot();
    await writeConversation(root, { root, messages: [] });
    return { root, messages: [] };
  });
  ipcMain.handle("agent:apply", async (_e, proposal) => {
    const root = requireRoot();
    const applied = await agent.applyProposal(root, proposal);
    return { applied };
  });
  ipcMain.handle("agent:run", (_e, command) => agent.runCommand(requireRoot(), command));
  // Feeding a command's output back lets the agent react to a failing test run.
  ipcMain.handle("agent:report", async (_e, text) => runAgentTurn(requireRoot(), text, {}));

  // blueprints
  ipcMain.handle("blueprints:modules", () => blueprints.MODULES);
  ipcMain.handle("blueprints:list", async () => blueprints.list(await settingsStore.readSection("blueprints", [])));
  ipcMain.handle("blueprints:save", async (_e, blueprint) => {
    const stored = await settingsStore.readSection("blueprints", []);
    const { all, saved } = blueprints.save(stored, blueprint);
    await settingsStore.writeSection("blueprints", all);
    return { all, saved };
  });
  ipcMain.handle("blueprints:delete", async (_e, id) => {
    const stored = await settingsStore.readSection("blueprints", []);
    const all = blueprints.remove(stored, id);
    await settingsStore.writeSection("blueprints", all);
    return all;
  });
  ipcMain.handle("blueprints:pickSource", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Папка с исходниками «Личного чата»",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = result.filePaths[0];
    // Проверяем сразу, а не в момент сборки: ошибиться папкой легко, а узнать об
    // этом через десять минут сборки — обидно.
    await buildPipeline.assertChatSources(dir);
    return dir;
  });
  ipcMain.handle("blueprints:build", async (event, blueprint, options) => {
    const send = (line) => {
      if (!event.sender.isDestroyed()) event.sender.send("blueprints:buildLog", line);
    };
    try {
      const result = await buildPipeline.build(blueprint, { onLog: send, ...(options || {}) });
      send("");
      return { ok: true, ...result };
    } catch (e) {
      send(`Сборка остановлена: ${e.message}`);
      return { ok: false, message: e.message };
    }
  });
  ipcMain.handle("blueprints:openRelease", (_e, dir) => shell.openPath(dir));
  ipcMain.handle("blueprints:export", async (_e, blueprint) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Куда положить plugins.json (папка исходников «Личного чата»)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return blueprints.exportTo(blueprint, result.filePaths[0]);
  });

  // demo access
  const testers = () => settingsStore.readSection("testers", []);
  ipcMain.handle("demo:keyInfo", () => demoAccess.keyInfo());
  ipcMain.handle("demo:createKeys", () => demoAccess.createKeys());
  ipcMain.handle("demo:list", async () => demoAccess.list(await testers()));
  ipcMain.handle("demo:save", async (_e, tester) => {
    const { all, saved } = demoAccess.save(await testers(), tester);
    await settingsStore.writeSection("testers", all);
    return { all, saved };
  });
  ipcMain.handle("demo:delete", async (_e, id) => {
    const all = demoAccess.remove(await testers(), id);
    await settingsStore.writeSection("testers", all);
    return all;
  });
  ipcMain.handle("demo:setRevoked", async (_e, id, revoked) => {
    const all = demoAccess.setRevoked(await testers(), id, revoked);
    await settingsStore.writeSection("testers", all);
    return all;
  });
  ipcMain.handle("demo:issue", async (_e, id, options) => {
    const result = await demoAccess.issue(await testers(), id, options || {});
    const target = await dialog.showSaveDialog(mainWindow, {
      title: "Куда сохранить файл активации",
      defaultPath: result.fileName,
      filters: [{ name: "Файл активации", extensions: ["lic"] }],
    });
    if (target.canceled || !target.filePath) return null;
    await fs.writeFile(target.filePath, result.contents, "utf-8");
    await settingsStore.writeSection("testers", result.all);
    return { all: result.all, tester: result.tester, file: target.filePath };
  });
  ipcMain.handle("demo:exportRevocations", async () => {
    const contents = await demoAccess.revocationList(await testers());
    const target = await dialog.showSaveDialog(mainWindow, {
      title: "Куда сохранить список отзыва",
      defaultPath: "revoked.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) return null;
    await fs.writeFile(target.filePath, contents, "utf-8");
    return { file: target.filePath, contents };
  });
  ipcMain.handle("demo:exportConfig", async (_e, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Папка исходников «Личного чата»",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const { pricesText, ...rest } = options || {};
    const { prices, problems } = demoAccess.parsePrices(pricesText);
    const written = await demoAccess.exportConfig(result.filePaths[0], { ...rest, prices });
    return { ...written, priceProblems: problems };
  });

  // plugin archive
  ipcMain.handle("plugins:list", () => pluginArchive.list());
  ipcMain.handle("plugins:addVersion", async (_e, payload) => {
    const data = payload || {};
    // Ветка и коммит проставляются сами из открытой папки: спрашивать о них
    // второй раз незачем, а без них потом не понять, из какого кода версия.
    let branch = data.branch || "";
    let commit = "";
    if (currentRoot && git.isRepo(currentRoot)) {
      const status = await git.status(currentRoot).catch(() => null);
      if (status) {
        if (!branch) branch = status.branch;
        commit = status.head || "";
      }
    }
    return pluginArchive.addVersion({ ...data, branch, commit });
  });
  // Ветки открытого репозитория — из них выбирается та, где живёт код плагина.
  ipcMain.handle("plugins:branches", async () => {
    if (!currentRoot || !git.isRepo(currentRoot)) return { current: "", local: [], canonical: blueprints.DEFAULT_BRANCH };
    const branches = await git.branches(currentRoot);
    return { ...branches, canonical: blueprints.DEFAULT_BRANCH };
  });
  /**
   * Переводит открытую папку на ветку плагина, чтобы дописывать его код там же,
   * где он живёт. Незакоммиченные правки не трогаем: сначала их надо сохранить
   * или отменить во вкладке «Git».
   */
  ipcMain.handle("plugins:useBranch", async (_e, branch) => {
    const root = requireRoot();
    if (!git.isRepo(root)) throw new Error("Открытая папка — не репозиторий git.");
    if (!branch) throw new Error("У плагина не указана ветка.");
    const status = await git.status(root);
    if (status.branch === branch) return { branch, switched: false, status };
    if (status.files.length) {
      throw new Error(
        `В папке есть несохранённые изменения (${status.files.length}). Сохраните или отмените их ` +
          "во вкладке «Git», иначе переключение потеряет работу."
      );
    }
    await git.checkoutBranch(root, branch);
    return { branch, switched: true, status: await git.status(root) };
  });
  ipcMain.handle("plugins:remove", (_e, id) => pluginArchive.removePlugin(id));
  ipcMain.handle("plugins:openFolder", async (_e, dir) => {
    await shell.openPath(dir || pluginArchive.root());
    return true;
  });
  ipcMain.handle("plugins:pickSources", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Файлы или папки плагина",
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("plugins:pickSkillFiles", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Файлы навыков (.md, .json)",
      filters: [{ name: "Навыки", extensions: ["md", "json", "txt", "skill"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled) return [];
    const skills = [];
    for (const file of result.filePaths) {
      const raw = await fs.readFile(file, "utf-8");
      if (file.endsWith(".json")) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.name && typeof parsed.content === "string") {
            skills.push({ name: parsed.name, description: parsed.description || "", content: parsed.content });
            continue;
          }
        } catch {
          // не JSON-навык — разберём как текст ниже
        }
      }
      // Markdown-навык: заголовки name/description во frontmatter, остальное — тело.
      const front = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
      let name = path.basename(file).replace(/\.[^.]+$/, "");
      let description = "";
      let content = raw;
      if (front) {
        content = raw.slice(front[0].length);
        for (const line of front[1].split("\n")) {
          const m = /^(name|description):\s*(.+)$/.exec(line.trim());
          if (m) {
            if (m[1] === "name") name = m[2].trim().replace(/^["']|["']$/g, "");
            else description = m[2].trim().replace(/^["']|["']$/g, "");
          }
        }
      }
      skills.push({ name, description, content: content.trim() });
    }
    return skills;
  });
  ipcMain.handle("plugins:exportToBuild", async (_e, selections) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Папка исходников «Личного чата»",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return pluginArchive.exportToBuild(result.filePaths[0], selections || []);
  });

  ipcMain.handle("app:openExternal", (_e, url) => {
    if (!/^https?:\/\//i.test(url || "")) throw new Error("Разрешены только ссылки http(s).");
    return shell.openExternal(url);
  });
}
