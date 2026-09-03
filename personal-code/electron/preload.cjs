const { contextBridge, ipcRenderer } = require("electron");

// The renderer has no Node access; everything it can do is exactly what is
// listed here, and each entry lands in a main-process handler that validates
// its arguments.
contextBridge.exposeInMainWorld("api", {
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  testProxy: (draft) => ipcRenderer.invoke("settings:testProxy", draft),
  listModels: (draft) => ipcRenderer.invoke("models:list", draft),
  pickChatSources: () => ipcRenderer.invoke("blueprints:pickSource"),
  dataFolder: () => ipcRenderer.invoke("settings:dataFolder"),

  reportInfo: () => ipcRenderer.invoke("report:info"),
  logProblem: (level, message) => ipcRenderer.invoke("report:log", level, message),
  writeReport: (description) => ipcRenderer.invoke("report:write", description),
  revealReport: (file) => ipcRenderer.invoke("report:reveal", file),

  copyPlugins: () => ipcRenderer.invoke("copies:plugins"),
  copySource: () => ipcRenderer.invoke("copies:source"),
  listCopies: () => ipcRenderer.invoke("copies:list"),
  saveCopy: (copy) => ipcRenderer.invoke("copies:save", copy),
  deleteCopy: (id) => ipcRenderer.invoke("copies:delete", id),
  setCopyRevoked: (id, revoked) => ipcRenderer.invoke("copies:setRevoked", id, revoked),
  publishCopy: (id, options) => ipcRenderer.invoke("copies:publish", id, options),
  openCopyCode: (id) => ipcRenderer.invoke("copies:openCode", id),
  issueCopyLicence: (id, days) => ipcRenderer.invoke("copies:issue", id, days),
  exportCopyRevocations: () => ipcRenderer.invoke("copies:exportRevocations"),
  onPublishLog: (handler) => {
    const listener = (_e, line) => handler(line);
    ipcRenderer.on("copies:publishLog", listener);
    return () => ipcRenderer.removeListener("copies:publishLog", listener);
  },

  getGitHubAccount: () => ipcRenderer.invoke("github:getAccount"),
  saveGitHubAccount: (account) => ipcRenderer.invoke("github:saveAccount", account),
  testGitHubConnection: (token) => ipcRenderer.invoke("github:test", token),
  listGitHubRepos: () => ipcRenderer.invoke("github:listRepos"),
  createGitHubRepo: (options) => ipcRenderer.invoke("github:createRepo", options),
  listGitHubBranches: (owner, repo) => ipcRenderer.invoke("github:listBranches", owner, repo),
  listGitHubWorkflows: (owner, repo) => ipcRenderer.invoke("github:listWorkflows", owner, repo),
  runGitHubWorkflow: (owner, repo, workflowId, ref) =>
    ipcRenderer.invoke("github:runWorkflow", owner, repo, workflowId, ref),
  listGitHubWorkflowRuns: (owner, repo, workflowId, limit) =>
    ipcRenderer.invoke("github:workflowRuns", owner, repo, workflowId, limit),
  chooseDataFolder: () => ipcRenderer.invoke("settings:chooseDataFolder"),
  openDataFolder: () => ipcRenderer.invoke("settings:openDataFolder"),
  storageReport: () => ipcRenderer.invoke("settings:storageReport"),

  // workspace
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  openWorkspace: (dir) => ipcRenderer.invoke("workspace:open", dir),
  currentWorkspace: () => ipcRenderer.invoke("workspace:current"),
  closeWorkspace: () => ipcRenderer.invoke("workspace:close"),
  tree: () => ipcRenderer.invoke("workspace:tree"),
  readFile: (rel) => ipcRenderer.invoke("workspace:read", rel),
  writeFile: (rel, content) => ipcRenderer.invoke("workspace:write", rel, content),
  createFile: (rel, content) => ipcRenderer.invoke("workspace:create", rel, content),
  createDir: (rel) => ipcRenderer.invoke("workspace:createDir", rel),
  deletePath: (rel) => ipcRenderer.invoke("workspace:delete", rel),
  renamePath: (from, to) => ipcRenderer.invoke("workspace:rename", from, to),
  search: (query, options) => ipcRenderer.invoke("workspace:search", query, options),
  reveal: (rel) => ipcRenderer.invoke("workspace:reveal", rel),

  // git
  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitDiff: (options) => ipcRenderer.invoke("git:diff", options),
  gitShowUntracked: (file) => ipcRenderer.invoke("git:showUntracked", file),
  gitLog: (limit) => ipcRenderer.invoke("git:log", limit),
  gitBranches: () => ipcRenderer.invoke("git:branches"),
  gitStage: (files) => ipcRenderer.invoke("git:stage", files),
  gitStageAll: () => ipcRenderer.invoke("git:stageAll"),
  gitUnstage: (files) => ipcRenderer.invoke("git:unstage", files),
  gitDiscard: (files) => ipcRenderer.invoke("git:discard", files),
  gitCommit: (message) => ipcRenderer.invoke("git:commit", message),
  gitCreateBranch: (name) => ipcRenderer.invoke("git:createBranch", name),
  gitCheckout: (name) => ipcRenderer.invoke("git:checkout", name),
  gitRemotes: () => ipcRenderer.invoke("git:remotes"),
  gitAddRemote: (name, url) => ipcRenderer.invoke("git:addRemote", name, url),
  gitInit: () => ipcRenderer.invoke("git:init"),
  gitPush: (options) => ipcRenderer.invoke("git:push", options),
  gitPull: (options) => ipcRenderer.invoke("git:pull", options),
  gitFetch: (options) => ipcRenderer.invoke("git:fetch", options),

  // agent
  agentSend: (message, options) => ipcRenderer.invoke("agent:send", message, options),
  agentHistory: () => ipcRenderer.invoke("agent:history"),
  agentSetModel: (model) => ipcRenderer.invoke("agent:setModel", model),
  agentClear: () => ipcRenderer.invoke("agent:clear"),
  agentApply: (proposal) => ipcRenderer.invoke("agent:apply", proposal),
  agentRun: (command) => ipcRenderer.invoke("agent:run", command),
  agentReport: (text) => ipcRenderer.invoke("agent:report", text),

  // ключ подписи демо-доступа
  demoKeyInfo: () => ipcRenderer.invoke("demo:keyInfo"),
  demoCreateKeys: () => ipcRenderer.invoke("demo:createKeys"),

  // архив плагинов
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  pluginBranches: () => ipcRenderer.invoke("plugins:branches"),
  usePluginBranch: (branch) => ipcRenderer.invoke("plugins:useBranch", branch),
  addPluginVersion: (payload) => ipcRenderer.invoke("plugins:addVersion", payload),
  removePlugin: (id) => ipcRenderer.invoke("plugins:remove", id),
  openPluginFolder: (dir) => ipcRenderer.invoke("plugins:openFolder", dir),
  pickPluginSources: () => ipcRenderer.invoke("plugins:pickSources"),
  pickPluginSkillFiles: () => ipcRenderer.invoke("plugins:pickSkillFiles"),
  exportPluginsToBuild: (selections) => ipcRenderer.invoke("plugins:exportToBuild", selections),

  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  pickTextFile: () => ipcRenderer.invoke("app:pickTextFile"),
});

// Ошибки в окне сами до главного процесса не доходят, и падение, описанное как
// «просто пропало», не оставило бы в отчёте ни строки. Пересылка — это то, что
// делает отчёт о проблеме пригодным для чтения.
window.addEventListener("error", (event) => {
  ipcRenderer.invoke("report:log", "error", `${event.message} (${event.filename}:${event.lineno})`);
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  ipcRenderer.invoke("report:log", "error", reason?.stack || String(reason));
});
