export interface DocMeta {
  name: string;
  size: number;
  mtime: number;
}

export interface Brand {
  companyName: string;
  tagline: string;
  accentColor: string;
  footerText: string;
  logoPath: string;
  qrPath?: string;
  contactPhone?: string;
  contactEmail?: string;
  headerImagePath?: string;
}

export const DEFAULT_BRAND: Brand = {
  companyName: "",
  tagline: "",
  accentColor: "#c96442",
  footerText: "",
  logoPath: "",
  qrPath: "",
  contactPhone: "",
  contactEmail: "",
  headerImagePath: "",
};

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  skillIds: string[];
  brand?: Brand;
  externalDocsPath?: string;
  /** Files/folders on the computer holding this project's design system. */
  designSystemPaths?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type Role = "user" | "assistant";

export interface DesignSystemFile {
  path: string;
  name: string;
  from?: string;
  missing?: boolean;
}

export type AttachmentKind = "text" | "image" | "video" | "audio" | "other";

export interface ChatAttachment {
  name: string;
  path: string;
  kind: AttachmentKind;
  size: number;
  /** Extracted document text, filled in at attach time for text-ish files. */
  text?: string;
  /** Set when the file could not be read/extracted. */
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  attachments?: ChatAttachment[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  messages: ChatMessage[];
  model?: string;
  /**
   * Agent chats only: the assistant message whose proposed change was already
   * applied or rejected, so the confirmation banner doesn't come back on reopen.
   */
  handledEditId?: string;
  /**
   * Condensed account of messages that were folded away, sent to the model in place
   * of them. Set by "свернуть историю"; the originals go to an archive file.
   */
  summary?: string;
  createdAt: number;
  updatedAt: number;
}

export type TaskRecurrence = "once" | "daily" | "weekly";

export interface ScheduledTask {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  recurrence: TaskRecurrence;
  time: string; // "HH:MM", 24h, local time
  date?: string; // "YYYY-MM-DD" — only for recurrence "once"
  weekday?: number; // 0 (Sun) – 6 (Sat) — only for recurrence "weekly"
  enabled: boolean;
  lastRunAt?: number;
  lastConversationId?: string;
  nextRunAt: number | null; // epoch ms; null once a "once" task has fired
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  proxyMode?: "system" | "manual" | "direct";
  proxyUrl?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  searchEnabled?: boolean;
  searchProvider?: "duckduckgo" | "tavily";
  searchApiKey?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.7,
  maxTokens: 16000,
  proxyMode: "system",
  proxyUrl: "",
  proxyUsername: "",
  proxyPassword: "",
  searchEnabled: true,
  searchProvider: "duckduckgo",
  searchApiKey: "",
};

export interface StorageEntry {
  name: string;
  bytes: number;
  files: number;
}

export interface StorageReport {
  rootPath: string;
  totalBytes: number;
  folders: StorageEntry[];
  /** Chats whose history is long enough to be worth folding down. */
  heavyChats: { projectId: string; projectName: string; convId: string; title: string; messages: number; chars: number }[];
}

export interface AppConfig {
  rootPath: string;
}

export type CellValue = string | number;

export interface OpsSheet {
  id: string;
  name: string;
  rows: CellValue[][];
  order: number;
  updatedAt: number;
}

export interface OpsEdit {
  sheet: string;
  action: "add_row" | "update_row" | "delete_row";
  rowIndex?: number;
  values?: CellValue[];
}

export type ChatbotPlatform = "telegram" | "vk" | "max";

interface AiBotConfig {
  /** Answer incoming messages with the model instead of scripted funnels. */
  aiEnabled?: boolean;
  /** Project whose instructions/skills/documents back the bot's answers. */
  aiProjectId?: string;
}

export interface TelegramAccount extends AiBotConfig {
  token: string;
  enabled: boolean;
}
export interface VkAccount extends AiBotConfig {
  token: string;
  groupId: string;
  enabled: boolean;
}
export interface MaxAccount extends AiBotConfig {
  token: string;
  /** Bot API host. Empty means "use the app's default"; the test can fill it in. */
  apiBase: string;
  enabled: boolean;
}

export interface ChatbotAccounts {
  telegram: TelegramAccount;
  vk: VkAccount;
  max: MaxAccount;
}

export interface ChatbotTestResult {
  ok: boolean;
  login?: string;
  error?: string;
  /** MAX only: the API host that answered, when it differs from the saved one. */
  switched?: string;
}

export type ChatbotStatusMap = Record<ChatbotPlatform, boolean>;

export interface FunnelStep {
  delayMinutes: number;
  text: string;
}

export interface FunnelTrigger {
  type: "keyword" | "start" | "default";
  keyword?: string;
}

export interface Funnel {
  id: string;
  name: string;
  trigger: FunnelTrigger;
  platforms: ChatbotPlatform[];
  steps: FunnelStep[];
}

export interface Lead {
  userId: string;
  name: string;
  firstSeenAt: number;
  funnelId: string | null;
  stepIndex: number;
  nextStepDueAt: number | null;
  lastMessageAt: number;
}

export interface ChatbotMessage {
  userId: string;
  name: string;
  direction: "in" | "out";
  text: string;
  at: number;
}

export interface GitHubAccount {
  token: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  private: boolean;
  updatedAt: number;
  defaultBranch: string;
}

export interface GitHubTreeEntry {
  path: string;
  size: number;
  binary: boolean;
}

export interface GitHubTree {
  branch: string;
  truncated: boolean;
  entries: GitHubTreeEntry[];
}

export interface GitHubFileContent {
  path: string;
  content: string;
  sha: string;
}

export interface GitHubCommitResult {
  path: string;
  sha?: string;
  commitSha?: string;
}

export interface GitHubTestResult {
  ok: boolean;
  login?: string;
  error?: string;
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  runNumber: number;
  status: string;
  conclusion: string | null;
  branch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  headCommitMessage: string;
}

export interface GitHubBranch {
  name: string;
  sha?: string;
}

export type MediaType = "image" | "video" | "audio";

export interface MediaGenerationRequest {
  type: MediaType;
  model: string;
  prompt: string;
  referenceImagePath?: string;
  extraParamsJson?: string;
  projectId?: string;
}

export interface MediaGenerationResult {
  id: string;
  type: MediaType;
  model: string;
  prompt: string;
  fileName: string;
  localPath: string;
  createdAt: number;
  costRub?: number;
}

export type DesignType = "post" | "document" | "presentation" | "design-system" | "website" | "graphic" | "other";
export type DesignFormat = "html" | "svg";

export interface DesignDoc {
  id: string;
  title: string;
  type: DesignType;
  format: DesignFormat;
  content: string;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export type CloudProvider = "yandex" | "google";

export interface DirectSettings {
  /** Needed only when an agency account acts for a client; empty otherwise. */
  clientLogin: string;
}

export interface DirectTestResult {
  ok: boolean;
  login?: string;
  info?: string;
  currency?: string;
  error?: string;
}

export interface DirectCampaign {
  id: number;
  name: string;
  type: string;
  status: string;
  state: string;
  statusPayment: string;
  /** In account currency; the API's micro-units are converted on the way in. */
  dailyBudget: number;
  startDate: string;
}

export interface DirectKeyword {
  id: number;
  keyword: string;
  adGroupId: number;
  status: string;
  state: string;
  bid: number;
}

export interface DirectAd {
  id: number;
  campaignId: number;
  adGroupId: number;
  status: string;
  state: string;
  title: string;
  title2: string;
  text: string;
  href: string;
}

/** One row of the campaign performance report; keys are the API's field names. */
export interface DirectStatRow {
  CampaignId: number;
  CampaignName: string;
  Impressions: number;
  Clicks: number;
  Ctr: number;
  Cost: number;
  AvgCpc: number;
  Conversions: number | string;
}

export interface DirectAction {
  action: "suspend" | "resume" | "bid";
  target: number;
  value?: number;
  why: string;
}

export interface YandexAccount {
  token: string;
  /** From the app you create at oauth.yandex.ru — used to obtain the token. */
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working; 0 when unknown. */
  expiresAt: number;
}

export interface CloudAccounts {
  yandex: YandexAccount;
  google: { token: string };
}

export interface YandexConnectResult {
  ok: boolean;
  accounts?: CloudAccounts;
  login?: string;
  error?: string;
  /** True when the user still has to paste the confirmation code by hand. */
  needsCode?: boolean;
}

export interface CloudEntry {
  name: string;
  path: string;
  isFolder: boolean;
  size: number;
  modified: number;
  mimeType: string;
}

export interface CloudTestResult {
  ok: boolean;
  login?: string;
  error?: string;
}

export interface ExcelCell {
  value?: string | number | boolean | null;
  formula?: string;
  computed?: string | number | boolean | null;
  numFmt?: string;
}

export interface ExcelSheet {
  name: string;
  cells: Record<string, ExcelCell>;
  maxRow: number;
  maxCol: number;
}

/** One sheet's worth of a change the Excel agent proposed. */
export interface ExcelEditSegment {
  sheet: string;
  cells: { cell: string; value: string }[];
  formats: { range: string; numFmt: string }[];
}

export interface ExcelRecalcResult {
  evaluated: number;
  total: number;
  errors: { cell: string; error: string }[];
  circular: string[];
}

export interface ExcelWorkbook {
  /** Null until a workbook created inside the app has been saved somewhere. */
  filePath: string | null;
  name: string;
  sheets: ExcelSheet[];
  recalc: ExcelRecalcResult | null;
}

export interface ExcelEdit {
  sheets: ExcelEditSegment[];
}

/**
 * What the Word/Excel exports need. Unlike the PDF/PNG exports this carries the
 * messages themselves rather than rendered HTML — the main process rebuilds them
 * as document structure so tables stay editable.
 */
export interface ChatExportPayload {
  title: string;
  sections: { role?: "user" | "assistant"; content: string }[];
  brand?: { accentColor?: string; contactLines?: string[] };
  defaultName: string;
  projectId?: string;
}

export interface ElectronAPI {
  getConfig(): Promise<AppConfig>;
  chooseRootPath(): Promise<string | null>;
  openRootPath(): Promise<void>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  listProjects(): Promise<Project[]>;
  createProject(data: { name: string; description: string; instructions: string }): Promise<Project>;
  updateProject(id: string, patch: Partial<Omit<Project, "id">>): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  buildSystemPrompt(id: string): Promise<string>;
  openProjectFolder(id: string): Promise<void>;
  pickBrandLogo(): Promise<string | null>;
  saveProjectBrandLogo(id: string, filePath: string): Promise<Project>;
  pickBrandQr(): Promise<string | null>;
  saveProjectBrandQr(id: string, filePath: string): Promise<Project>;
  pickBrandHeaderImage(): Promise<string | null>;
  saveProjectBrandHeaderImage(id: string, filePath: string): Promise<Project>;
  clearProjectBrandHeaderImage(id: string): Promise<Project>;
  readFileAsDataUrl(filePath: string): Promise<string>;

  listDocs(projectId: string): Promise<DocMeta[]>;
  addDocsFromPaths(projectId: string, filePaths: string[]): Promise<DocMeta[]>;
  addPastedDoc(projectId: string, name: string, content: string): Promise<DocMeta[]>;
  removeDoc(projectId: string, fileName: string): Promise<DocMeta[]>;
  pickFiles(): Promise<string[]>;

  pickExternalDocsFolder(): Promise<string | null>;
  setProjectExternalDocsFolder(id: string, folderPath: string | null): Promise<Project>;
  listExternalDocs(projectId: string): Promise<DocMeta[]>;

  listSkills(): Promise<Skill[]>;
  saveSkill(skill: { id: string | null; name: string; description: string; content: string }): Promise<Skill>;
  deleteSkill(id: string): Promise<void>;
  pickSkillImportFile(): Promise<string | null>;
  pickSkillImportFolder(): Promise<string | null>;
  importSkillFromFile(filePath: string): Promise<{ name: string; description: string; content: string }>;
  importSkillFromFolder(folderPath: string): Promise<{ name: string; description: string; content: string }>;

  listConversations(projectId: string): Promise<Conversation[]>;
  /** Writes messages being folded away to a dated file, so nothing is ever lost. */
  archiveConversationMessages(
    projectId: string,
    conv: Conversation,
    messages: ChatMessage[]
  ): Promise<{ path: string }>;
  getStorageReport(): Promise<StorageReport>;
  saveConversation(projectId: string, conv: Conversation): Promise<Conversation>;
  deleteConversation(projectId: string, convId: string): Promise<void>;

  pickClaudeExportFiles(): Promise<string[]>;
  importClaudeExports(filePaths: string[]): Promise<Project[]>;

  exportToPdf(payload: { html: string; defaultName: string; projectId?: string }): Promise<string | null>;
  exportChatToDocx(payload: ChatExportPayload): Promise<string | null>;
  exportChatToXlsx(payload: ChatExportPayload): Promise<string | null>;
  exportToPng(payload: { html: string; defaultName: string; projectId?: string }): Promise<string | null>;

  getSkillCreatorPrompt(): Promise<string>;
  getSkillCreatorConversation(): Promise<Conversation | null>;
  saveSkillCreatorConversation(conv: Conversation): Promise<Conversation>;

  // operations module
  listOpsSheets(): Promise<OpsSheet[]>;
  saveOpsSheet(sheet: { id?: string | null; name: string; rows: CellValue[][]; order?: number }): Promise<OpsSheet>;
  deleteOpsSheet(id: string): Promise<void>;
  buildOpsAgentPrompt(): Promise<string>;
  applyOpsEdit(edit: OpsEdit): Promise<OpsSheet>;
  getOpsAgentConversation(): Promise<Conversation | null>;
  saveOpsAgentConversation(conv: Conversation): Promise<Conversation>;
  pickXlsx(): Promise<string | null>;
  importOpsXlsx(filePath: string): Promise<OpsSheet[]>;

  // mail

  // chatbots / funnels
  getChatbotAccounts(): Promise<ChatbotAccounts>;
  saveChatbotAccounts(accounts: ChatbotAccounts): Promise<ChatbotAccounts>;
  testChatbotConnection(platform: ChatbotPlatform, account: TelegramAccount | VkAccount | MaxAccount): Promise<ChatbotTestResult>;
  startChatbot(platform: ChatbotPlatform): Promise<ChatbotStatusMap>;
  stopChatbot(platform: ChatbotPlatform): Promise<ChatbotStatusMap>;
  getChatbotStatus(): Promise<ChatbotStatusMap>;
  getFunnels(): Promise<Funnel[]>;
  saveFunnels(funnels: Funnel[]): Promise<Funnel[]>;
  getChatbotLeads(platform: ChatbotPlatform): Promise<Lead[]>;
  getChatbotMessages(platform: ChatbotPlatform): Promise<ChatbotMessage[]>;
  sendChatbotMessage(platform: ChatbotPlatform, userId: string, text: string): Promise<ChatbotMessage>;
  onChatbotMessage(callback: (payload: { platform: ChatbotPlatform; message: ChatbotMessage }) => void): () => void;
  onChatbotStatus(callback: (payload: { platform: ChatbotPlatform; status: string }) => void): () => void;

  // GitHub
  getGitHubAccount(): Promise<GitHubAccount>;
  saveGitHubAccount(account: GitHubAccount): Promise<GitHubAccount>;
  testGitHubConnection(token: string): Promise<GitHubTestResult>;
  listGitHubRepos(): Promise<GitHubRepo[]>;
  createGitHubRepo(data: { name: string; description: string; private: boolean }): Promise<GitHubRepo>;
  getGitHubTree(owner: string, repo: string): Promise<GitHubTree>;
  getGitHubFile(owner: string, repo: string, filePath: string, ref?: string): Promise<GitHubFileContent>;
  commitGitHubFile(
    owner: string,
    repo: string,
    filePath: string,
    content: string,
    message: string,
    sha?: string,
    branch?: string
  ): Promise<GitHubCommitResult>;
  listGitHubWorkflows(owner: string, repo: string): Promise<GitHubWorkflow[]>;
  runGitHubWorkflow(owner: string, repo: string, workflowId: number, ref: string): Promise<{ started: boolean }>;
  listGitHubWorkflowRuns(owner: string, repo: string, workflowId?: number, limit?: number): Promise<GitHubWorkflowRun[]>;
  listGitHubBranches(owner: string, repo: string): Promise<GitHubBranch[]>;
  getGitHubAgentConversation(owner: string, repo: string): Promise<Conversation | null>;
  saveGitHubAgentConversation(owner: string, repo: string, conv: Conversation): Promise<Conversation>;

  // media generation
  generateMedia(payload: MediaGenerationRequest): Promise<MediaGenerationResult>;
  listMediaGenerations(projectId?: string): Promise<MediaGenerationResult[]>;
  openMediaFolder(projectId?: string): Promise<void>;
  pickReferenceImage(): Promise<string | null>;
  onMediaProgress(callback: (status: string) => void): () => void;

  // design section
  listDesignDocs(projectId?: string): Promise<DesignDoc[]>;
  saveDesignDoc(payload: {
    id?: string | null;
    title: string;
    type: DesignType;
    format: DesignFormat;
    content: string;
    projectId?: string;
  }): Promise<DesignDoc>;
  deleteDesignDoc(id: string, projectId?: string): Promise<void>;
  buildDesignAgentPrompt(projectId?: string): Promise<string>;
  getDesignAgentConversation(projectId?: string): Promise<Conversation | null>;
  saveDesignAgentConversation(projectId: string | undefined, conv: Conversation): Promise<Conversation>;
  openDesignFolder(projectId?: string): Promise<void>;

  // export (shared by chat exports and the design section)
  exportToJpg(payload: { html: string; defaultName: string; projectId?: string }): Promise<string | null>;
  exportSvgFile(payload: { svg: string; defaultName: string; projectId?: string }): Promise<string | null>;

  // project design system
  pickDesignSystemFiles(): Promise<string[]>;
  pickDesignSystemFolder(): Promise<string | null>;
  addDesignSystemPaths(id: string, paths: string[]): Promise<Project>;
  removeDesignSystemPath(id: string, target: string): Promise<Project>;
  listDesignSystemFiles(id: string): Promise<DesignSystemFile[]>;

  // chat attachments
  pickAttachments(): Promise<ChatAttachment[]>;

  // cloud storage
  getCloudAccounts(): Promise<CloudAccounts>;
  saveCloudAccounts(accounts: CloudAccounts): Promise<CloudAccounts>;
  // Яндекс Директ
  getDirectSettings(): Promise<DirectSettings>;
  saveDirectSettings(patch: Partial<DirectSettings>): Promise<DirectSettings>;
  testDirectConnection(): Promise<DirectTestResult>;
  listDirectCampaigns(): Promise<DirectCampaign[]>;
  listDirectKeywords(campaignIds: number[]): Promise<DirectKeyword[]>;
  listDirectAds(campaignIds: number[]): Promise<DirectAd[]>;
  getDirectStats(range: { dateFrom: string; dateTo: string }): Promise<DirectStatRow[]>;
  setDirectCampaignState(id: number, resume: boolean): Promise<{ id: number; state: string }>;
  setDirectKeywordBid(id: number, bid: number): Promise<{ id: number; bid: number }>;
  buildDirectAgentPrompt(data: {
    campaigns?: DirectCampaign[];
    stats?: DirectStatRow[];
    keywords?: DirectKeyword[];
  }): Promise<string>;
  getDirectAgentConversation(): Promise<Conversation | null>;
  saveDirectAgentConversation(conv: Conversation): Promise<Conversation>;

  connectYandexCloud(payload: {
    clientId: string;
    clientSecret: string;
    manualCode?: string;
  }): Promise<YandexConnectResult>;
  testCloudConnection(provider: CloudProvider, token: string): Promise<CloudTestResult>;
  listCloudFiles(provider: CloudProvider, folder?: string): Promise<CloudEntry[]>;
  downloadCloudFile(provider: CloudProvider, remote: string, fileName: string): Promise<{ path: string; size: number }>;
  downloadCloudFileToProject(
    provider: CloudProvider,
    remote: string,
    fileName: string,
    projectId: string
  ): Promise<{ path: string; size: number }>;
  uploadFileToCloud(provider: CloudProvider, remoteFolder?: string): Promise<{ name?: string; path?: string } | null>;

  // Excel workbooks
  pickExcelFile(): Promise<string | null>;
  openExcelFile(filePath: string): Promise<ExcelWorkbook>;
  newExcelWorkbook(name: string): Promise<ExcelWorkbook>;
  applyExcelAgentEdit(edit: ExcelEdit): Promise<{ workbook: ExcelWorkbook; createdSheets: string[] }>;
  runExcelAgentTools(text: string): Promise<string | null>;
  setExcelCells(edits: { sheet: string; cell: string; value: string }[]): Promise<ExcelWorkbook>;
  saveExcelFile(saveAs?: boolean): Promise<string | null>;
  buildExcelAgentPrompt(): Promise<string>;
  getExcelAgentConversation(): Promise<Conversation | null>;
  saveExcelAgentConversation(conv: Conversation): Promise<Conversation>;

  // proxy
  testProxy(draftSettings: Partial<Settings>): Promise<{ ok: boolean; ms?: number; error?: string }>;

  // web search
  runWebTools(text: string): Promise<string | null>;
  webSearch(query: string): Promise<{ title: string; url: string; snippet: string }[]>;
  getWebToolsHint(): Promise<string>;

  // scheduled tasks
  listTasks(projectId: string): Promise<ScheduledTask[]>;
  saveTask(projectId: string, task: Partial<ScheduledTask> & { title: string; prompt: string }): Promise<ScheduledTask>;
  deleteTask(projectId: string, id: string): Promise<void>;
  onTaskRan(callback: (payload: { projectId: string; task: ScheduledTask; conversationId: string }) => void): () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
