const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // config / data folder
  getConfig: () => ipcRenderer.invoke("config:get"),
  chooseRootPath: () => ipcRenderer.invoke("config:chooseRootPath"),
  openRootPath: () => ipcRenderer.invoke("config:openRootPath"),

  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),

  // projects
  listProjects: () => ipcRenderer.invoke("projects:list"),
  createProject: (data) => ipcRenderer.invoke("projects:create", data),
  updateProject: (id, patch) => ipcRenderer.invoke("projects:update", id, patch),
  deleteProject: (id) => ipcRenderer.invoke("projects:delete", id),
  buildSystemPrompt: (id) => ipcRenderer.invoke("projects:buildSystemPrompt", id),
  openProjectFolder: (id) => ipcRenderer.invoke("projects:openFolder", id),
  pickBrandLogo: () => ipcRenderer.invoke("projects:pickLogo"),
  saveProjectBrandLogo: (id, filePath) => ipcRenderer.invoke("projects:saveBrandLogo", id, filePath),
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke("fs:readFileAsDataUrl", filePath),

  // docs
  listDocs: (projectId) => ipcRenderer.invoke("docs:list", projectId),
  addDocsFromPaths: (projectId, filePaths) => ipcRenderer.invoke("docs:addFromPaths", projectId, filePaths),
  addPastedDoc: (projectId, name, content) => ipcRenderer.invoke("docs:addPasted", projectId, name, content),
  removeDoc: (projectId, fileName) => ipcRenderer.invoke("docs:remove", projectId, fileName),
  pickFiles: () => ipcRenderer.invoke("docs:pickFiles"),

  // skills
  listSkills: () => ipcRenderer.invoke("skills:list"),
  saveSkill: (skill) => ipcRenderer.invoke("skills:save", skill),
  deleteSkill: (id) => ipcRenderer.invoke("skills:delete", id),

  // conversations
  listConversations: (projectId) => ipcRenderer.invoke("conversations:list", projectId),
  saveConversation: (projectId, conv) => ipcRenderer.invoke("conversations:save", projectId, conv),
  deleteConversation: (projectId, convId) => ipcRenderer.invoke("conversations:delete", projectId, convId),

  // import
  pickClaudeExportFiles: () => ipcRenderer.invoke("import:pickClaudeExports"),
  importClaudeExports: (filePaths) => ipcRenderer.invoke("import:claudeExports", filePaths),

  // export
  exportToPdf: (payload) => ipcRenderer.invoke("export:toPdf", payload),
  exportToPng: (payload) => ipcRenderer.invoke("export:toPng", payload),

  // misc
  getSkillCreatorPrompt: () => ipcRenderer.invoke("meta:skillCreatorPrompt"),
  getSkillCreatorConversation: () => ipcRenderer.invoke("skillCreator:get"),
  saveSkillCreatorConversation: (conv) => ipcRenderer.invoke("skillCreator:save", conv),

  // operations module
  listOpsSheets: () => ipcRenderer.invoke("ops:list"),
  saveOpsSheet: (sheet) => ipcRenderer.invoke("ops:save", sheet),
  deleteOpsSheet: (id) => ipcRenderer.invoke("ops:delete", id),
  buildOpsAgentPrompt: () => ipcRenderer.invoke("ops:buildAgentPrompt"),
  applyOpsEdit: (edit) => ipcRenderer.invoke("ops:applyEdit", edit),
  getOpsAgentConversation: () => ipcRenderer.invoke("ops:getAgentConversation"),
  saveOpsAgentConversation: (conv) => ipcRenderer.invoke("ops:saveAgentConversation", conv),
  pickXlsx: () => ipcRenderer.invoke("ops:pickXlsx"),
  importOpsXlsx: (filePath) => ipcRenderer.invoke("ops:importXlsx", filePath),

  // GitHub
  getGitHubAccount: () => ipcRenderer.invoke("github:getAccount"),
  saveGitHubAccount: (account) => ipcRenderer.invoke("github:saveAccount", account),
  testGitHubConnection: (token) => ipcRenderer.invoke("github:testConnection", token),
  listGitHubRepos: () => ipcRenderer.invoke("github:listRepos"),
  createGitHubRepo: (data) => ipcRenderer.invoke("github:createRepo", data),
  getGitHubTree: (owner, repo) => ipcRenderer.invoke("github:getTree", owner, repo),
  getGitHubFile: (owner, repo, filePath, ref) => ipcRenderer.invoke("github:getFileContent", owner, repo, filePath, ref),
  commitGitHubFile: (owner, repo, filePath, content, message, sha, branch) =>
    ipcRenderer.invoke("github:commitFile", owner, repo, filePath, content, message, sha, branch),
  getGitHubAgentConversation: (owner, repo) => ipcRenderer.invoke("github:getAgentConversation", owner, repo),
  saveGitHubAgentConversation: (owner, repo, conv) => ipcRenderer.invoke("github:saveAgentConversation", owner, repo, conv),

  // media generation
  generateMedia: (payload) => ipcRenderer.invoke("media:generate", payload),
  listMediaGenerations: (projectId) => ipcRenderer.invoke("media:list", projectId),
  openMediaFolder: (projectId) => ipcRenderer.invoke("media:openFolder", projectId),
  pickReferenceImage: () => ipcRenderer.invoke("media:pickReferenceImage"),
  onMediaProgress: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("media:progress", listener);
    return () => ipcRenderer.removeListener("media:progress", listener);
  },

  // mail
  getMailAccount: () => ipcRenderer.invoke("mail:getAccount"),
  saveMailAccount: (account) => ipcRenderer.invoke("mail:saveAccount", account),
  testMailConnection: (account) => ipcRenderer.invoke("mail:testConnection", account),
  listMailMessages: (opts) => ipcRenderer.invoke("mail:listMessages", opts),
  getMailMessage: (uid) => ipcRenderer.invoke("mail:getMessage", uid),
  sendMail: (payload) => ipcRenderer.invoke("mail:sendMail", payload),
  getMailAgentConversation: () => ipcRenderer.invoke("mail:getAgentConversation"),
  saveMailAgentConversation: (conv) => ipcRenderer.invoke("mail:saveAgentConversation", conv),
  getMailDraftPrompt: () => ipcRenderer.invoke("meta:mailDraftPrompt"),
  pickMailLogo: () => ipcRenderer.invoke("mail:pickLogo"),
  saveMailSignatureLogo: (filePath) => ipcRenderer.invoke("mail:saveSignatureLogo", filePath),
});
