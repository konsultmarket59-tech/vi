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
