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
  const messages = [
    { role: "system", content: agent.SYSTEM_PROMPT },
    { role: "system", content: "Текущий проект.\n" + context },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const transcript = [];
  let reply = await settingsStore.callModel(settings, messages);

  for (let round = 0; round < agent.TOOL_ROUND_LIMIT; round++) {
    const toolOutput = await agent.runReadTools(root, reply);
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
  ipcMain.handle("settings:save", (_e, patch) => settingsStore.save(patch));
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
  ipcMain.handle("blueprints:export", async (_e, blueprint) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Куда положить plugins.json (папка исходников «Личного чата»)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return blueprints.exportTo(blueprint, result.filePaths[0]);
  });

  ipcMain.handle("app:openExternal", (_e, url) => {
    if (!/^https?:\/\//i.test(url || "")) throw new Error("Разрешены только ссылки http(s).");
    return shell.openExternal(url);
  });
}
