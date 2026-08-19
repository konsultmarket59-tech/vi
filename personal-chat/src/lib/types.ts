export interface DocMeta {
  name: string;
  size: number;
  mtime: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  skillIds: string[];
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

  getSkillCreatorPrompt(): Promise<string>;
  getSkillCreatorConversation(): Promise<Conversation | null>;
  saveSkillCreatorConversation(conv: Conversation): Promise<Conversation>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
