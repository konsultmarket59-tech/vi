export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  proxyMode: "system" | "manual" | "direct";
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
  gitUserName: string;
  gitUserEmail: string;
  gitToken: string;
  gitTokenUser: string;
  promptCache: boolean;
  searchEnabled: boolean;
  searchProvider: "duckduckgo" | "tavily";
  searchApiKey: string;
  dataRoot: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: "https://polza.ai/api/v1",
  apiKey: "",
  model: "anthropic/claude-sonnet-5",
  temperature: 0.2,
  maxTokens: 16000,
  proxyMode: "system",
  proxyUrl: "",
  proxyUsername: "",
  proxyPassword: "",
  gitUserName: "",
  gitUserEmail: "",
  gitToken: "",
  gitTokenUser: "",
  promptCache: true,
  searchEnabled: false,
  searchProvider: "duckduckgo",
  searchApiKey: "",
  dataRoot: "",
};

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  text?: boolean;
  language?: string;
  children?: TreeNode[];
}

export interface OpenedFile {
  path: string;
  content: string;
  language: string;
  size: number;
  modifiedAt: number;
}

export interface WorkspaceInfo {
  root: string;
  isRepo: boolean;
  recent?: string[];
}

export interface GitFile {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatus {
  isRepo: boolean;
  files: GitFile[];
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitCommit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface DiffRow {
  type: "same" | "add" | "del" | "gap";
  text: string;
}

export interface ProposalFile {
  path: string;
  to: string | null;
  action: "replace" | "write" | "delete" | "rename";
  isNew: boolean;
  before: string | null;
  after: string | null;
  diff: DiffRow[];
}

export interface Proposal {
  id: string;
  files: ProposalFile[];
}

export interface PendingCommand {
  id: string;
  command: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool?: boolean;
  createdAt: number;
}

export interface AgentTurn {
  reply: string;
  proposal: Proposal | null;
  command: PendingCommand | null;
  parseError: string | null;
  messages: AgentMessage[];
}

export interface CommandResult {
  ok: boolean;
  code: number;
  timedOut: boolean;
  output: string;
}

export interface BlueprintModule {
  id: string;
  name: string;
  core: boolean;
  description: string;
}

export interface Blueprint {
  id: string;
  name: string;
  productName: string;
  description: string;
  modules: string[];
  sourcePath: string;
  branch: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  pricesText: string;
  currency: string;
  skills: { id: string; version: number }[];
  demoGated: boolean;
  revocationUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface BuildResult {
  ok: boolean;
  message?: string;
  releaseDir?: string;
  installers?: { name: string; path: string; bytes: number }[];
  installerBuilt?: boolean;
  branch?: { branch: string; switched: boolean };
  modules?: { enabledCount: number; disabled: string[] };
  demo?: { managed: boolean; file: string; managedFile: string } | null;
  skills?: { included: { id: string; version: number; skills: number }[]; missing: string[] };
}

export interface DemoKeyInfo {
  exists: boolean;
  publicKey: string;
  createdAt: string;
  path: string;
}

export interface Tester {
  id: string;
  name: string;
  /** Как копия подписана у тестировщика: «Личный чат Виктории». */
  displayName: string;
  machineCode: string;
  note: string;
  revoked: boolean;
  licenceId: string;
  issuedAt: string;
  expiresAt: string;
  createdAt: number;
}

export interface PluginSkill {
  name: string;
  description: string;
  content: string;
}

export interface PluginVersion {
  version: number;
  dir: string;
  note: string;
  branch: string;
  commit: string;
  createdAt: string;
  skills: number;
  sources: number;
}

export interface ArchivedPlugin {
  id: string;
  name: string;
  description: string;
  branch: string;
  dir: string;
  latest: number;
  versions: PluginVersion[];
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface ReportInfo {
  version: string;
  productName: string;
  tester: string;
  expiresAt: string;
  gated: boolean;
  log: { total: number; errors: number; since: string };
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

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface GitHubWorkflowRun {
  id: number;
  status: string;
  conclusion: string;
  createdAt: string;
  url: string;
  branch?: string;
}

export interface StorageReport {
  rootPath: string;
  totalBytes: number;
  folders: { name: string; bytes: number; files: number; versions: number }[];
}

declare global {
  interface Window {
    api: {
      getSettings(): Promise<Settings>;
      saveSettings(patch: Partial<Settings>): Promise<Settings>;
      testProxy(draft: Partial<Settings>): Promise<{ ok: boolean; message: string }>;
      listModels(draft?: Partial<Settings>): Promise<{ id: string; name: string }[]>;
      dataFolder(): Promise<string>;
      chooseDataFolder(): Promise<{ settings: Settings; folder: string } | null>;
      openDataFolder(): Promise<string>;
      storageReport(): Promise<StorageReport>;

      reportInfo(): Promise<ReportInfo>;
      logProblem(level: string, message: string): Promise<boolean>;
      writeReport(description: string): Promise<{ file: string }>;
      revealReport(file: string): Promise<boolean>;

      getGitHubAccount(): Promise<GitHubAccount>;
      saveGitHubAccount(account: GitHubAccount): Promise<GitHubAccount>;
      testGitHubConnection(token: string): Promise<{ ok: boolean; login?: string; error?: string }>;
      listGitHubRepos(): Promise<GitHubRepo[]>;
      createGitHubRepo(options: { name: string; description?: string; private?: boolean }): Promise<GitHubRepo>;
      listGitHubBranches(owner: string, repo: string): Promise<{ name: string; sha: string }[]>;
      listGitHubWorkflows(owner: string, repo: string): Promise<GitHubWorkflow[]>;
      runGitHubWorkflow(owner: string, repo: string, workflowId: number | string, ref: string): Promise<boolean>;
      listGitHubWorkflowRuns(
        owner: string,
        repo: string,
        workflowId: number | string,
        limit?: number
      ): Promise<GitHubWorkflowRun[]>;

      pickWorkspace(): Promise<WorkspaceInfo | null>;
      openWorkspace(dir: string): Promise<WorkspaceInfo>;
      currentWorkspace(): Promise<WorkspaceInfo>;
      closeWorkspace(): Promise<WorkspaceInfo>;
      tree(): Promise<{ tree: TreeNode[]; truncated: boolean }>;
      readFile(rel: string): Promise<OpenedFile>;
      writeFile(rel: string, content: string): Promise<{ path: string; size: number; modifiedAt: number }>;
      createFile(rel: string, content?: string): Promise<{ path: string }>;
      createDir(rel: string): Promise<{ path: string }>;
      deletePath(rel: string): Promise<{ path: string }>;
      renamePath(from: string, to: string): Promise<{ path: string }>;
      search(query: string, options?: { regex?: boolean; caseSensitive?: boolean }): Promise<{ matches: SearchMatch[]; truncated: boolean }>;
      reveal(rel: string): Promise<boolean>;

      gitStatus(): Promise<GitStatus>;
      gitDiff(options?: { file?: string; staged?: boolean }): Promise<string>;
      gitShowUntracked(file: string): Promise<string>;
      gitLog(limit?: number): Promise<GitCommit[]>;
      gitBranches(): Promise<{ current: string; local: string[]; remote: string[] }>;
      gitStage(files: string[]): Promise<GitStatus>;
      gitStageAll(): Promise<GitStatus>;
      gitUnstage(files: string[]): Promise<GitStatus>;
      gitDiscard(files: string[]): Promise<GitStatus>;
      gitCommit(message: string): Promise<GitStatus>;
      gitCreateBranch(name: string): Promise<GitStatus>;
      gitCheckout(name: string): Promise<GitStatus>;
      gitRemotes(): Promise<{ name: string; url: string }[]>;
      gitAddRemote(name: string, url: string): Promise<{ name: string; url: string }[]>;
      gitInit(): Promise<GitStatus>;
      gitPush(options?: { remote?: string; branch?: string; setUpstream?: boolean }): Promise<{ ok: boolean; output: string; status: GitStatus }>;
      gitPull(options?: { remote?: string; branch?: string }): Promise<{ ok: boolean; output: string; status: GitStatus }>;
      gitFetch(options?: { remote?: string }): Promise<{ ok: boolean; output: string; status: GitStatus }>;

      agentSend(message: string, options?: { openFile?: string | null }): Promise<AgentTurn>;
      agentHistory(): Promise<{ root: string; messages: AgentMessage[] }>;
      agentClear(): Promise<{ root: string; messages: AgentMessage[] }>;
      agentApply(proposal: Proposal): Promise<{ applied: { path: string; action: string; to: string | null }[] }>;
      agentRun(command: string): Promise<CommandResult>;
      agentReport(text: string): Promise<AgentTurn>;

      blueprintModules(): Promise<BlueprintModule[]>;
      listBlueprints(): Promise<Blueprint[]>;
      saveBlueprint(blueprint: Partial<Blueprint>): Promise<{ all: Blueprint[]; saved: Blueprint }>;
      deleteBlueprint(id: string): Promise<Blueprint[]>;
      exportBlueprint(blueprint: Blueprint): Promise<{ file: string; productName: string; enabledCount: number; disabled: string[] } | null>;
      pickChatSources(): Promise<string | null>;
      buildBlueprint(blueprint: Blueprint, options?: { skipInstaller?: boolean }): Promise<BuildResult>;
      openReleaseFolder(dir: string): Promise<string>;
      onBuildLog(handler: (line: string) => void): () => void;

      demoKeyInfo(): Promise<DemoKeyInfo>;
      demoCreateKeys(): Promise<DemoKeyInfo>;
      listTesters(): Promise<Tester[]>;
      saveTester(tester: Partial<Tester>): Promise<{ all: Tester[]; saved: Tester }>;
      deleteTester(id: string): Promise<Tester[]>;
      setTesterRevoked(id: string, revoked: boolean): Promise<Tester[]>;
      issueLicence(
        id: string,
        options: { days: number; productName: string; revocationUrl: string }
      ): Promise<{ all: Tester[]; tester: Tester; file: string } | null>;
      exportRevocations(): Promise<{ file: string; contents: string } | null>;

      listPlugins(): Promise<ArchivedPlugin[]>;
      pluginBranches(): Promise<{ current: string; local: string[]; canonical: string }>;
      usePluginBranch(branch: string): Promise<{ branch: string; switched: boolean }>;
      addPluginVersion(payload: {
        pluginId: string;
        name: string;
        description: string;
        note: string;
        skills: PluginSkill[];
        sourcePaths: string[];
        branch?: string;
      }): Promise<{ id: string; version: number; dir: string; skills: number; sources: number; branch: string }>;
      removePlugin(id: string): Promise<boolean>;
      openPluginFolder(dir: string): Promise<boolean>;
      pickPluginSources(): Promise<string[]>;
      pickPluginSkillFiles(): Promise<PluginSkill[]>;
      exportPluginsToBuild(
        selections: { id: string; version: number }[]
      ): Promise<{ targetDir: string; included: { id: string; version: number; skills: number }[]; missing: string[] } | null>;

      openExternal(url: string): Promise<void>;
    };
  }
}
