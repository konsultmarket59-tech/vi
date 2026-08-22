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

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.7,
  maxTokens: 4096,
};

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

export interface MailSignature {
  name: string;
  position: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  accentColor: string;
  logoPath: string;
}

export interface MailAccount {
  email: string;
  password: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  signature: MailSignature;
}

export interface MailMessageSummary {
  uid: number;
  subject: string;
  from: string;
  date: number;
  seen: boolean;
}

export interface MailMessageFull extends MailMessageSummary {
  to: string;
  text: string;
  html: string | null;
}

export interface MailTestResult {
  ok: boolean;
  errors: { imap?: string; smtp?: string };
}

export type ChatbotPlatform = "telegram" | "vk" | "max";

export interface TelegramAccount {
  token: string;
  enabled: boolean;
}
export interface VkAccount {
  token: string;
  groupId: string;
  enabled: boolean;
}
export interface MaxAccount {
  token: string;
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
  saveConversation(projectId: string, conv: Conversation): Promise<Conversation>;
  deleteConversation(projectId: string, convId: string): Promise<void>;

  pickClaudeExportFiles(): Promise<string[]>;
  importClaudeExports(filePaths: string[]): Promise<Project[]>;

  exportToPdf(payload: { html: string; defaultName: string; projectId?: string }): Promise<string | null>;
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
  getMailAccount(): Promise<MailAccount>;
  saveMailAccount(account: MailAccount): Promise<MailAccount>;
  testMailConnection(account: MailAccount): Promise<MailTestResult>;
  listMailMessages(opts?: { limit?: number }): Promise<MailMessageSummary[]>;
  getMailMessage(uid: number): Promise<MailMessageFull>;
  sendMail(payload: { to: string; subject: string; bodyText: string; includeSignature?: boolean }): Promise<string>;
  getMailAgentConversation(): Promise<Conversation | null>;
  saveMailAgentConversation(conv: Conversation): Promise<Conversation>;
  getMailDraftPrompt(): Promise<string>;
  pickMailLogo(): Promise<string | null>;
  saveMailSignatureLogo(filePath: string): Promise<MailAccount>;

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
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
