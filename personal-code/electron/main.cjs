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
const report = require("./report.cjs");
const github = require("./github.cjs");
const copies = require("./copies.cjs");
const publish = require("./publish.cjs");
const sources = require("./sources.cjs");

let mainWindow = null;

// Свой журнал ошибок — тот же, что в «Личном чате»: приложение ничего никуда не
// отправляет само, но по кнопке кладёт файл с описанием на рабочий стол.
report.install();

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
// Папка с данными — одно определение на всё приложение, в settings.cjs: там же
// рядом лежит резервная копия настроек, и разъехаться этим двум местам нельзя.
const dataRootOf = settingsStore.dataRootOf;

async function applyDataRoot() {
  const settings = await settingsStore.load();
  const root = dataRootOf(settings);
  pluginArchive.init(root);
  return root;
}

/** Папка приложения внутри выбранной папки с данными: там же, где архив плагинов. */
async function appDataDir() {
  const settings = await settingsStore.load();
  const dir = path.join(dataRootOf(settings), "Личный код");
  await fs.mkdir(dir, { recursive: true });
  return dir;
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
async function runAgentTurn(root, userMessage, { openFile = null, model = "" } = {}) {
  const settings = await settingsStore.load();
  const conversation = await readConversation(root);
  // Модель выбирается для этой рабочей папки: сильная для сложных правок,
  // дешёвая для мелочей. Пусто — та, что в «Настройках».
  const chosen = String(model || conversation.model || "").trim();
  if (model !== undefined && String(model).trim()) conversation.model = String(model).trim();
  const modelSettings = chosen ? { ...settings, model: chosen } : settings;
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
  let reply = await settingsStore.callModel(modelSettings, messages);

  for (let round = 0; round < agent.TOOL_ROUND_LIMIT; round++) {
    const toolOutput =
      (await agent.runReadTools(root, reply)) ?? (webAllowed ? await websearch.runTools(reply, settings) : null);
    if (toolOutput == null) break;
    transcript.push({ role: "assistant", content: reply });
    transcript.push({ role: "user", content: toolOutput });
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: toolOutput });
    // Продолжение того же хода — той же моделью, что и начало.
    reply = await settingsStore.callModel(modelSettings, messages);
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
  // Служебная папка приложения пуста — значит, это первый запуск после
  // переустановки или переезда: настройки берём из копии рядом с данными,
  // чтобы ключ Polza, токен GitHub и прокси не пришлось вводить заново.
  await settingsStore.restoreFromBackup();
  demoAccess.init(settingsStore.stripWindowsExtendedPrefix(app.getPath("userData")));
  await applyDataRoot();
  // А если копии ещё нет (настройки заводились до появления этой возможности) —
  // делаем её сейчас, не дожидаясь, пока человек что-нибудь изменит.
  await settingsStore.backup(await settingsStore.load());
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

  // отчёт о проблеме — как в «Личном чате»
  ipcMain.handle("report:info", () => ({
    version: app.getVersion(),
    productName: "Личный код",
    tester: "",
    expiresAt: "",
    gated: false,
    log: report.summary(),
  }));
  ipcMain.handle("report:log", (_e, level, message) => report.recordFromRenderer(level, message));
  ipcMain.handle("report:write", (_e, description) =>
    report.write({ description, version: app.getVersion(), productName: "Личный код", tester: "" })
  );
  ipcMain.handle("report:reveal", (_e, file) => {
    shell.showItemInFolder(file);
    return true;
  });

  // GitHub — тот же модуль, что в «Личном чате»: подключение по токену, список
  // репозиториев, создание, коммиты и запуск сборок.
  ipcMain.handle("github:getAccount", async () => github.getAccount(await appDataDir()));
  ipcMain.handle("github:saveAccount", async (_e, account) => github.saveAccount(await appDataDir(), account));
  ipcMain.handle("github:test", (_e, token) => github.testConnection(token));
  ipcMain.handle("github:listRepos", async () => {
    const account = await github.getAccount(await appDataDir());
    return github.listRepos(account.token);
  });
  ipcMain.handle("github:createRepo", async (_e, options) => {
    const account = await github.getAccount(await appDataDir());
    return github.createRepo(account.token, options || {});
  });
  ipcMain.handle("github:listBranches", async (_e, owner, repo) => {
    const account = await github.getAccount(await appDataDir());
    return github.listBranches(account.token, owner, repo);
  });
  ipcMain.handle("github:listWorkflows", async (_e, owner, repo) => {
    const account = await github.getAccount(await appDataDir());
    return github.listWorkflows(account.token, owner, repo);
  });
  ipcMain.handle("github:runWorkflow", async (_e, owner, repo, workflowId, ref) => {
    const account = await github.getAccount(await appDataDir());
    return github.runWorkflow(account.token, owner, repo, workflowId, ref);
  });
  ipcMain.handle("github:workflowRuns", async (_e, owner, repo, workflowId, limit) => {
    const account = await github.getAccount(await appDataDir());
    return github.listWorkflowRuns(account.token, owner, repo, workflowId, limit || 10);
  });
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
  /** Модель для этой рабочей папки; пустая строка — вернуться к «Настройкам». */
  ipcMain.handle("agent:setModel", async (_e, model) => {
    const root = requireRoot();
    const conversation = await readConversation(root);
    conversation.model = String(model || "").trim();
    await writeConversation(root, conversation);
    return { model: conversation.model };
  });
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

  // Сборки: только выбор папки исходников остался нужен UI — сама сборка
  // теперь ведётся через копии (copies:publish), а не отдельным экраном.
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

  // копии «Личного чата»: демо и оплаченные
  const storedCopies = () => settingsStore.readSection("copies", []);
  ipcMain.handle("copies:plugins", () => copies.PLUGINS);
  ipcMain.handle("copies:list", async () => copies.list(await storedCopies()));
  ipcMain.handle("copies:save", async (_e, copy) => {
    const { all, saved } = copies.save(await storedCopies(), copy);
    await settingsStore.writeSection("copies", all);
    return { all, saved };
  });
  ipcMain.handle("copies:delete", async (_e, id) => {
    const all = copies.remove(await storedCopies(), id);
    await settingsStore.writeSection("copies", all);
    return all;
  });
  /** Откуда берётся код копий — показывается на вкладках сборки. */
  ipcMain.handle("copies:source", async () => {
    const settings = await settingsStore.load();
    return {
      repo: (settings.sourceRepo || "").trim() || sources.DEFAULT_SOURCE_REPO,
      branch: blueprints.DEFAULT_BRANCH,
    };
  });
  ipcMain.handle("copies:setRevoked", async (_e, id, revoked) => {
    const all = copies.setRevoked(await storedCopies(), id, revoked);
    await settingsStore.writeSection("copies", all);
    return all;
  });
  /**
   * Собирает копию в её репозитории на GitHub. Долгая операция, поэтому каждый
   * шаг уходит в окно строкой по мере выполнения.
   */
  ipcMain.handle("copies:publish", async (event, id, options) => {
    const send = (line) => {
      if (!event.sender.isDestroyed()) event.sender.send("copies:publishLog", line);
    };
    try {
      const all = copies.list(await storedCopies());
      const copy = all.find((c) => c.id === id);
      if (!copy) throw new Error("Копия не найдена.");
      const account = await github.getAccount(await appDataDir());
      const keys = await demoAccess.keyInfo();
      const settings = await settingsStore.load();
      const result = await publish.publish(copy, {
        // Пустой sourcePath — обычный случай: код берётся с GitHub, папка с
        // исходниками на компьютере не нужна.
        sourcePath: (options && options.sourcePath) || "",
        sourceRepo: (settings.sourceRepo || "").trim() || sources.DEFAULT_SOURCE_REPO,
        branch: (options && options.branch) || blueprints.DEFAULT_BRANCH,
        token: account.token,
        publicKey: keys.publicKey,
        onLog: send,
      });
      const updated = all.map((c) =>
        c.id === id ? copies.normalize({ ...c, repoFullName: result.repo, builtAt: new Date().toISOString() }) : c
      );
      await settingsStore.writeSection("copies", updated);
      send("Готово.");
      return { ok: true, all: updated, ...result };
    } catch (e) {
      send(`Остановлено: ${e.message}`);
      return { ok: false, message: e.message };
    }
  });
  /**
   * Открывает код копии как рабочую папку: клонирует её репозиторий рядом с
   * архивом плагинов, если его ещё нет, и подтягивает изменения, если есть.
   * После этого копия правится теми же вкладками «Код» и «Git», что и всё
   * остальное — отдельного редактора для копий заводить незачем.
   */
  ipcMain.handle("copies:openCode", async (_e, id) => {
    const all = copies.list(await storedCopies());
    const copy = all.find((c) => c.id === id);
    if (!copy) throw new Error("Копия не найдена.");
    if (!copy.repoFullName) throw new Error("У копии ещё нет репозитория — сначала соберите её.");
    const account = await github.getAccount(await appDataDir());
    if (!account.token) throw new Error("Не задан токен GitHub — вкладка «Настройки».");

    const dir = path.join(await appDataDir(), "Копии", copy.repoName);
    const url = `https://github.com/${copy.repoFullName}.git`;
    if (!fsSync.existsSync(path.join(dir, ".git"))) {
      await fs.mkdir(path.dirname(dir), { recursive: true });
      await git.run(path.dirname(dir), ["clone", url, dir], {
        timeout: 300_000,
        token: account.token,
        tokenUser: "x-access-token",
      });
    } else {
      await git
        .run(dir, ["pull", "--ff-only"], { timeout: 300_000, token: account.token, tokenUser: "x-access-token" })
        .catch(() => {});
    }
    return openWorkspace(dir);
  });

  /** Выдаёт файл активации для копии — по коду компьютера, который прислал человек. */
  ipcMain.handle("copies:issue", async (_e, id, days) => {
    const all = copies.list(await storedCopies());
    const copy = all.find((c) => c.id === id);
    if (!copy) throw new Error("Копия не найдена.");
    const licence = copies.licenceFor(copy, { days });
    const file = { licence, signature: await demoAccess.sign(licence) };
    const target = await dialog.showSaveDialog(mainWindow, {
      title: "Куда сохранить файл активации",
      defaultPath: `${copy.repoName || "licence"}.lic`,
      filters: [{ name: "Файл активации", extensions: ["lic"] }],
    });
    if (target.canceled || !target.filePath) return null;
    await fs.writeFile(target.filePath, JSON.stringify(file, null, 2), "utf-8");
    const updated = all.map((c) => (c.id === id ? copies.withIssuedLicence(c, licence) : c));
    await settingsStore.writeSection("copies", updated);
    return { all: updated, file: target.filePath, expiresAt: licence.expiresAt };
  });
  /** Подписанный список отзыва по всем копиям — один файл на всех. */
  ipcMain.handle("copies:exportRevocations", async () => {
    const payload = { revoked: copies.revokedIds(await storedCopies()), updatedAt: new Date().toISOString() };
    const contents = JSON.stringify({ list: payload, signature: await demoAccess.sign(payload) }, null, 2);
    const target = await dialog.showSaveDialog(mainWindow, {
      title: "Куда сохранить список отзыва",
      defaultPath: "revoked.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (target.canceled || !target.filePath) return null;
    await fs.writeFile(target.filePath, contents, "utf-8");
    return { file: target.filePath, count: payload.revoked.length };
  });

  // Ключ подписи демо-доступа. Список тестировщиков и выдачу лицензий ведёт
  // теперь copies.cjs — тестировщик и копия это одно и то же, — но сам ключ
  // (создать один раз, закрытая половина не покидает компьютер) остаётся здесь.
  ipcMain.handle("demo:keyInfo", () => demoAccess.keyInfo());
  ipcMain.handle("demo:createKeys", () => demoAccess.createKeys());

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

  /** Открыть текстовый файл с диска — отчёт о проблеме, лист ошибок, лог. */
  ipcMain.handle("app:pickTextFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Файл с описанием проблемы",
      properties: ["openFile"],
      filters: [
        { name: "Текст", extensions: ["txt", "md", "log", "json", "csv"] },
        { name: "Все файлы", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    const stat = await fs.stat(file);
    if (stat.size > 2_000_000) throw new Error("Файл слишком большой — до 2 МБ.");
    return { name: path.basename(file), path: file, content: await fs.readFile(file, "utf-8") };
  });

  ipcMain.handle("app:openExternal", (_e, url) => {
    if (!/^https?:\/\//i.test(url || "")) throw new Error("Разрешены только ссылки http(s).");
    return shell.openExternal(url);
  });
}
