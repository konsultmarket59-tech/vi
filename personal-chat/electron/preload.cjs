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
  pickBrandQr: () => ipcRenderer.invoke("projects:pickQr"),
  saveProjectBrandQr: (id, filePath) => ipcRenderer.invoke("projects:saveBrandQr", id, filePath),
  pickBrandHeaderImage: () => ipcRenderer.invoke("projects:pickHeaderImage"),
  saveProjectBrandHeaderImage: (id, filePath) => ipcRenderer.invoke("projects:saveBrandHeaderImage", id, filePath),
  clearProjectBrandHeaderImage: (id) => ipcRenderer.invoke("projects:clearBrandHeaderImage", id),
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke("fs:readFileAsDataUrl", filePath),

  // docs
  listDocs: (projectId) => ipcRenderer.invoke("docs:list", projectId),
  addDocsFromPaths: (projectId, filePaths) => ipcRenderer.invoke("docs:addFromPaths", projectId, filePaths),
  addPastedDoc: (projectId, name, content) => ipcRenderer.invoke("docs:addPasted", projectId, name, content),
  removeDoc: (projectId, fileName) => ipcRenderer.invoke("docs:remove", projectId, fileName),
  pickFiles: () => ipcRenderer.invoke("docs:pickFiles"),
  pickExternalDocsFolder: () => ipcRenderer.invoke("projects:pickExternalDocsFolder"),
  setProjectExternalDocsFolder: (id, folderPath) => ipcRenderer.invoke("projects:setExternalDocsFolder", id, folderPath),
  listExternalDocs: (projectId) => ipcRenderer.invoke("docs:listExternal", projectId),

  // skills
  listSkills: () => ipcRenderer.invoke("skills:list"),
  saveSkill: (skill) => ipcRenderer.invoke("skills:save", skill),
  deleteSkill: (id) => ipcRenderer.invoke("skills:delete", id),
  pickSkillImportFile: () => ipcRenderer.invoke("skills:pickImportFile"),
  pickSkillImportFolder: () => ipcRenderer.invoke("skills:pickImportFolder"),
  importSkillFromFile: (filePath) => ipcRenderer.invoke("skills:importFromFile", filePath),
  importSkillFromFolder: (folderPath) => ipcRenderer.invoke("skills:importFromFolder", folderPath),

  // conversations
  listConversations: (projectId) => ipcRenderer.invoke("conversations:list", projectId),
  saveConversation: (projectId, conv) => ipcRenderer.invoke("conversations:save", projectId, conv),
  deleteConversation: (projectId, convId) => ipcRenderer.invoke("conversations:delete", projectId, convId),

  // project design system (files/folders on the computer)
  pickDesignSystemFiles: () => ipcRenderer.invoke("projects:pickDesignSystemFiles"),
  pickDesignSystemFolder: () => ipcRenderer.invoke("projects:pickDesignSystemFolder"),
  addDesignSystemPaths: (id, paths) => ipcRenderer.invoke("projects:addDesignSystemPaths", id, paths),
  removeDesignSystemPath: (id, target) => ipcRenderer.invoke("projects:removeDesignSystemPath", id, target),
  listDesignSystemFiles: (id) => ipcRenderer.invoke("projects:listDesignSystemFiles", id),

  // chat attachments
  pickAttachments: () => ipcRenderer.invoke("attachments:pick"),

  // Документы Word
  pickWordFile: () => ipcRenderer.invoke("word:pick"),
  openWordFile: (filePath) => ipcRenderer.invoke("word:open", filePath),
  newWordDocument: (name) => ipcRenderer.invoke("word:new", name),
  setWordBlockText: (index, text) => ipcRenderer.invoke("word:setBlockText", index, text),
  deleteWordBlock: (index) => ipcRenderer.invoke("word:deleteBlock", index),
  insertWordParagraph: (afterIndex, text, style) => ipcRenderer.invoke("word:insertParagraph", afterIndex, text, style),
  applyWordAgentEdit: (edit) => ipcRenderer.invoke("word:applyAgentEdit", edit),
  saveWordFile: (saveAs) => ipcRenderer.invoke("word:save", saveAs),
  buildWordAgentPrompt: () => ipcRenderer.invoke("word:buildAgentPrompt"),
  getWordAgentConversation: () => ipcRenderer.invoke("word:getAgentConversation"),
  saveWordAgentConversation: (conv) => ipcRenderer.invoke("word:saveAgentConversation", conv),

  // Excel workbooks
  pickExcelFile: () => ipcRenderer.invoke("excel:pick"),
  openExcelFile: (filePath) => ipcRenderer.invoke("excel:open", filePath),
  newExcelWorkbook: (name) => ipcRenderer.invoke("excel:new", name),
  applyExcelAgentEdit: (edit) => ipcRenderer.invoke("excel:applyAgentEdit", edit),
  runExcelAgentTools: (text) => ipcRenderer.invoke("excel:runAgentTools", text),
  setExcelCells: (edits) => ipcRenderer.invoke("excel:setCells", edits),
  saveExcelFile: (saveAs) => ipcRenderer.invoke("excel:save", saveAs),
  buildExcelAgentPrompt: () => ipcRenderer.invoke("excel:buildAgentPrompt"),
  getExcelAgentConversation: () => ipcRenderer.invoke("excel:getAgentConversation"),
  saveExcelAgentConversation: (conv) => ipcRenderer.invoke("excel:saveAgentConversation", conv),

  // cloud storage
  getCloudAccounts: () => ipcRenderer.invoke("cloud:getAccounts"),
  saveCloudAccounts: (accounts) => ipcRenderer.invoke("cloud:saveAccounts", accounts),
  archiveConversationMessages: (projectId, conv, messages) =>
    ipcRenderer.invoke("chats:archiveMessages", projectId, conv, messages),
  getStorageReport: () => ipcRenderer.invoke("storage:report"),

  // Яндекс Директ
  getDirectSettings: () => ipcRenderer.invoke("direct:getSettings"),
  saveDirectSettings: (patch) => ipcRenderer.invoke("direct:saveSettings", patch),
  testDirectConnection: () => ipcRenderer.invoke("direct:testConnection"),
  listDirectCampaigns: () => ipcRenderer.invoke("direct:listCampaigns"),
  listDirectKeywords: (campaignIds) => ipcRenderer.invoke("direct:listKeywords", campaignIds),
  listDirectAds: (campaignIds) => ipcRenderer.invoke("direct:listAds", campaignIds),
  getDirectStats: (range) => ipcRenderer.invoke("direct:getStats", range),
  setDirectCampaignState: (id, resume) => ipcRenderer.invoke("direct:setCampaignState", id, resume),
  setDirectKeywordBid: (id, bid) => ipcRenderer.invoke("direct:setKeywordBid", id, bid),
  buildDirectAgentPrompt: (data) => ipcRenderer.invoke("direct:buildAgentPrompt", data),
  getDirectAgentConversation: () => ipcRenderer.invoke("direct:getAgentConversation"),
  saveDirectAgentConversation: (conv) => ipcRenderer.invoke("direct:saveAgentConversation", conv),

  connectYandexCloud: (payload) => ipcRenderer.invoke("cloud:connectYandex", payload),
  setActiveYandexAccount: (id) => ipcRenderer.invoke("cloud:setActiveYandex", id),
  removeYandexAccount: (id) => ipcRenderer.invoke("cloud:removeYandex", id),
  renameYandexAccount: (id, label) => ipcRenderer.invoke("cloud:renameYandex", id, label),
  testCloudConnection: (provider, token) => ipcRenderer.invoke("cloud:testConnection", provider, token),
  listCloudFiles: (provider, folder) => ipcRenderer.invoke("cloud:list", provider, folder),
  downloadCloudFile: (provider, remote, fileName) => ipcRenderer.invoke("cloud:download", provider, remote, fileName),
  downloadCloudFileToProject: (provider, remote, fileName, projectId) =>
    ipcRenderer.invoke("cloud:downloadToProject", provider, remote, fileName, projectId),
  uploadFileToCloud: (provider, remoteFolder) => ipcRenderer.invoke("cloud:uploadFile", provider, remoteFolder),

  // proxy
  testProxy: (draftSettings) => ipcRenderer.invoke("proxy:test", draftSettings),

  // web search
  runWebTools: (text) => ipcRenderer.invoke("web:runTools", text),
  webSearch: (query) => ipcRenderer.invoke("web:search", query),
  getWebToolsHint: () => ipcRenderer.invoke("meta:webToolsHint"),

  // scheduled tasks
  listTasks: (projectId) => ipcRenderer.invoke("tasks:list", projectId),
  saveTask: (projectId, task) => ipcRenderer.invoke("tasks:save", projectId, task),
  deleteTask: (projectId, id) => ipcRenderer.invoke("tasks:delete", projectId, id),
  onTaskRan: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("tasks:ran", listener);
    return () => ipcRenderer.removeListener("tasks:ran", listener);
  },

  // import
  pickClaudeExportFiles: () => ipcRenderer.invoke("import:pickClaudeExports"),
  importClaudeExports: (filePaths) => ipcRenderer.invoke("import:claudeExports", filePaths),

  // export
  exportChatToDocx: (payload) => ipcRenderer.invoke("export:toDocx", payload),
  exportChatToXlsx: (payload) => ipcRenderer.invoke("export:toXlsx", payload),
  exportToPdf: (payload) => ipcRenderer.invoke("export:toPdf", payload),
  exportToPng: (payload) => ipcRenderer.invoke("export:toPng", payload),
  exportToJpg: (payload) => ipcRenderer.invoke("export:toJpg", payload),
  exportSvgFile: (payload) => ipcRenderer.invoke("export:svgFile", payload),

  // misc
  getSkillCreatorPrompt: () => ipcRenderer.invoke("meta:skillCreatorPrompt"),
  getSkillCreatorConversation: () => ipcRenderer.invoke("skillCreator:get"),
  saveSkillCreatorConversation: (conv) => ipcRenderer.invoke("skillCreator:save", conv),

  // operations module

  // chatbots / funnels
  getChatbotAccounts: () => ipcRenderer.invoke("chatbots:getAccounts"),
  saveChatbotAccounts: (accounts) => ipcRenderer.invoke("chatbots:saveAccounts", accounts),
  testChatbotConnection: (platform, account) => ipcRenderer.invoke("chatbots:testConnection", platform, account),
  startChatbot: (platform) => ipcRenderer.invoke("chatbots:start", platform),
  stopChatbot: (platform) => ipcRenderer.invoke("chatbots:stop", platform),
  getChatbotStatus: () => ipcRenderer.invoke("chatbots:getStatus"),
  getFunnels: () => ipcRenderer.invoke("chatbots:getFunnels"),
  saveFunnels: (funnels) => ipcRenderer.invoke("chatbots:saveFunnels", funnels),
  getChatbotLeads: (platform) => ipcRenderer.invoke("chatbots:getLeads", platform),
  getChatbotMessages: (platform) => ipcRenderer.invoke("chatbots:getMessages", platform),
  sendChatbotMessage: (platform, userId, text) => ipcRenderer.invoke("chatbots:sendManual", platform, userId, text),
  onChatbotMessage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chatbots:message", listener);
    return () => ipcRenderer.removeListener("chatbots:message", listener);
  },
  onChatbotStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("chatbots:status", listener);
    return () => ipcRenderer.removeListener("chatbots:status", listener);
  },

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
listGitHubWorkflows: (owner, repo) => ipcRenderer.invoke("github:listWorkflows", owner, repo),
  runGitHubWorkflow: (owner, repo, workflowId, ref) => ipcRenderer.invoke("github:runWorkflow", owner, repo, workflowId, ref),
  listGitHubWorkflowRuns: (owner, repo, workflowId, limit) => ipcRenderer.invoke("github:listWorkflowRuns", owner, repo, workflowId, limit),
  listGitHubBranches: (owner, repo) => ipcRenderer.invoke("github:listBranches", owner, repo),
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

  // design section
  // Проекты дизайна и их ассеты
  listDesignProjects: () => ipcRenderer.invoke("design:listProjects"),
  createDesignProject: (name) => ipcRenderer.invoke("design:createProject", name),
  updateDesignProject: (id, patch) => ipcRenderer.invoke("design:updateProject", id, patch),
  removeDesignProject: (id) => ipcRenderer.invoke("design:removeProject", id),
  pickDesignAssets: (id, kind) => ipcRenderer.invoke("design:pickAssets", id, kind),
  removeDesignAsset: (id, kind, assetPath) => ipcRenderer.invoke("design:removeAsset", id, kind, assetPath),
  listDesignAssets: (id) => ipcRenderer.invoke("design:listAssets", id),
  listDesignSystems: () => ipcRenderer.invoke("design:listSystems"),
  createDesignSystem: (name) => ipcRenderer.invoke("design:createSystem", name),
  updateDesignSystem: (id, patch) => ipcRenderer.invoke("design:updateSystem", id, patch),
  removeDesignSystem: (id) => ipcRenderer.invoke("design:removeSystem", id),
  pickDesignSystemAssets: (id, kind) => ipcRenderer.invoke("design:pickSystemAssets", id, kind),
  removeDesignSystemAsset: (id, kind, assetPath) => ipcRenderer.invoke("design:removeSystemAsset", id, kind, assetPath),
  applyDesignAssets: (id, html) => ipcRenderer.invoke("design:applyAssets", id, html),
  renderDesign: (payload) => ipcRenderer.invoke("design:render", payload),
  onDesignRenderProgress: (callback) => {
    const listener = (_e, progress) => callback(progress);
    ipcRenderer.on("design:renderProgress", listener);
    return () => ipcRenderer.removeListener("design:renderProgress", listener);
  },

  listDesignDocs: (projectId) => ipcRenderer.invoke("design:list", projectId),
  saveDesignDoc: (payload) => ipcRenderer.invoke("design:save", payload.projectId, payload),
  deleteDesignDoc: (id, projectId) => ipcRenderer.invoke("design:delete", projectId, id),
  buildDesignAgentPrompt: (projectId) => ipcRenderer.invoke("design:buildAgentPrompt", projectId),
  getDesignAgentConversation: (projectId) => ipcRenderer.invoke("design:getAgentConversation", projectId),
  saveDesignAgentConversation: (projectId, conv) => ipcRenderer.invoke("design:saveAgentConversation", projectId, conv),
  openDesignFolder: (projectId) => ipcRenderer.invoke("design:openFolder", projectId),
});
