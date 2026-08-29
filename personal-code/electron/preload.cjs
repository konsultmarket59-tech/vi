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
  agentClear: () => ipcRenderer.invoke("agent:clear"),
  agentApply: (proposal) => ipcRenderer.invoke("agent:apply", proposal),
  agentRun: (command) => ipcRenderer.invoke("agent:run", command),
  agentReport: (text) => ipcRenderer.invoke("agent:report", text),

  // blueprints
  blueprintModules: () => ipcRenderer.invoke("blueprints:modules"),
  listBlueprints: () => ipcRenderer.invoke("blueprints:list"),
  saveBlueprint: (blueprint) => ipcRenderer.invoke("blueprints:save", blueprint),
  deleteBlueprint: (id) => ipcRenderer.invoke("blueprints:delete", id),
  exportBlueprint: (blueprint) => ipcRenderer.invoke("blueprints:export", blueprint),

  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
});
