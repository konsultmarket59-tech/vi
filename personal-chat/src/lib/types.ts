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
}

export const DEFAULT_BRAND: Brand = {
  companyName: "",
  tagline: "",
  accentColor: "#c96442",
  footerText: "",
  logoPath: "",
};

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  skillIds: string[];
  brand?: Brand;
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
  readFileAsDataUrl(filePath: string): Promise<string>;

  listDocs(projectId: string): Promise<DocMeta[]>;
  addDocsFromPaths(projectId: string, filePaths: string[]): Promise<DocMeta[]>;
  addPastedDoc(projectId: string, name: string, content: string): Promise<DocMeta[]>;
  removeDoc(projectId: string, fileName: string): Promise<DocMeta[]>;
  pickFiles(): Promise<string[]>;

  listSkills(): Promise<Skill[]>;
  saveSkill(skill: { id: string | null; name: string; description: string; content: string }): Promise<Skill>;
  deleteSkill(id: string): Promise<void>;

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
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
