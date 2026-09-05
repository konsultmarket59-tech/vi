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
  accentColor: "#ff2f6d",
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
  /**
   * Документы, снятые с галочки «в контексте»: ключи вида `docs/имя.pdf` и
   * `external/имя.docx`. Файл остаётся в проекте, но не уходит в каждый запрос.
   */
  excludedDocs?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** У предустановленного навыка пусто: текст не передаётся в окно приложения. */
  content: string;
  /** Навык, вшитый в сборку автором: виден по названию, не редактируется. */
  bundled?: boolean;
  contentHidden?: boolean;
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

/** Короткое резюме проекта — контекст для разделов, у которых своего проекта нет. */
export interface ProjectProfile {
  чем_занимается: string;
  о_чём_проект: string;
  ключевые_сущности: string[];
  как_принято_называть: string;
  чего_избегать: string;
  fingerprint: string;
  updatedAt: number;
}

export interface TaskRunSummary {
  id: string;
  taskId: string;
  title: string;
  createdAt: number;
  preview: string;
  chars: number;
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
  /** Сборка с предустановленным ключом: поле ключа скрыто, показывается расход. */
  managed?: boolean;
  /**
   * Просить провайдера кэшировать неизменную часть промпта. Экономит на входе,
   * который у проектов с документами составляет основную часть счёта.
   */
  promptCache?: boolean;
  /** Ключ Pexels — нужен только разделу «Видео-сторис» для поиска по стоку. */
  pexelsKey?: string;
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
  promptCache: true,
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

export type CloudProvider = "yandex" | "google";

export interface DirectSettings {
  /** Needed only when an agency account acts for a client; empty otherwise. */
  clientLogin: string;
  /** Which Yandex account these settings belong to — Direct follows the active one. */
  accountId: string;
  accountLabel: string;
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
  id: string;
  /** What the user calls this account; defaults to the login Yandex reported. */
  label: string;
  login: string;
  token: string;
  /** From the app you create at oauth.yandex.ru — used to obtain the token. */
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Epoch ms when the access token stops working; 0 when unknown. */
  expiresAt: number;
  /** Direct's agency client login — belongs to the account, since each has its own. */
  directClientLogin: string;
}

export interface CloudAccounts {
  /** Several Yandex accounts; Disk and Direct both follow the active one. */
  yandex: { activeId: string; accounts: YandexAccount[] };
  google: { token: string };
}

export interface YandexConnectResult {
  ok: boolean;
  accounts?: CloudAccounts;
  login?: string;
  error?: string;
  /** True when the user still has to paste the confirmation code by hand. */
  needsCode?: boolean;
  /** The account that answered was already in the list, so it was refreshed, not added. */
  duplicate?: boolean;
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

export type WordBlockKind = "paragraph" | "list" | "table";

export interface WordBlock {
  index: number;
  kind: WordBlockKind;
  text: string;
  /** Word style name, e.g. Heading1 / ListParagraph; empty for plain body text. */
  style: string;
  /** 1–6 for a heading, 0 otherwise. */
  level: number;
  /** Table rows; empty for anything that isn't a table. */
  rows: string[][];
}

export interface WordDocument {
  /** Null until a document created in the app has been saved somewhere. */
  filePath: string | null;
  name: string;
  blocks: WordBlock[];
}

/** Вид документа в документообороте: от него зависят нумерация и правило даты. */
export interface DocKind {
  id: string;
  name: string;
  numbered: boolean;
  dateRule: "today" | "monthStart" | "monthEnd";
}

export interface Counterparty {
  id: string;
  name: string;
  requisitesPath: string;
}

export interface DocTemplate {
  id: string;
  name: string;
  kind: string;
  path: string;
}

export interface DocSource {
  id: string;
  name: string;
  path: string;
}

export interface DocflowConfig {
  counterparties: Counterparty[];
  templates: DocTemplate[];
  sources: DocSource[];
  /** Документ сверки — по нему считаются номера и в него пишется каждая выдача. */
  ledgerPath: string;
  archivePath: string;
  outputPath: string;
}

export interface DocflowPrepared {
  prompt: string;
  images: ChatAttachment[];
  nextNumber: number;
  date: string;
  templateBlocks: number;
  ledgerFound: boolean;
  ledgerColumns: Record<string, number>;
  problems: string[];
}

export interface DocflowMeta {
  number: string;
  date: string;
  counterparty: string;
  sum: string;
  filename: string;
}

export interface DocflowSaveResult {
  docxPath: string;
  pdfPath: string;
  /** "word" — печатал настоящий Word, "render" — приблизительная вёрстка приложения. */
  pdfVia: string;
  pdfError: string;
  ledgerRow: string[] | null;
  ledgerError: string;
}

export interface CanvasPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface VizPalette {
  id: string;
  name: string;
  background: string;
  text: string;
  muted: string;
  accent: string;
  series: string[];
}

export interface VizKind {
  id: string;
  name: string;
  hint: string;
}

export interface DatavizPrepared {
  prompt: string;
  images: ChatAttachment[];
  preset: CanvasPreset;
  palette: VizPalette;
  problems: string[];
}

export interface TaxRegime {
  id: string;
  name: string;
  rate: number;
  minRate?: number;
  vat?: number;
  hint: string;
}

export interface CostKind {
  id: "month" | "unit" | "revenue";
  name: string;
}

export interface PayrollRow {
  role: string;
  count: number;
  salary: number;
  percentOfSales: number;
}

export interface NamedAmount {
  name: string;
  monthly?: number;
  amount?: number;
}

export interface VariableCostRow {
  name: string;
  kind: "month" | "unit" | "revenue";
  value: number;
}

/** Ставки, которые задаёт закон, а не проект. Все попадают в книгу отдельными
 *  ячейками: законодательство меняется, и жёсткая константа однажды соврёт. */
export interface FinRates {
  insurance: number;
  insuranceReduced: number;
  minWage: number;
  useReducedInsurance: boolean;
  vatThreshold: number;
  vatRateLow: number;
  vatRateMid: number;
  vatLowLimit: number;
  ipFixedContribution: number;
  discountRate: number;
  inflation: number;
  npdLimit: number;
}

export interface FinModelInput {
  projectName: string;
  productName: string;
  price: number;
  unitCost: number;
  baseVolume: number;
  startYear: number;
  startMonth: number;
  horizonYears: number;
  seasonality: number[];
  rampUp: number[];
  inflation: number[];
  indexPrice: boolean;
  scenarios: { pess: number; base: number; opt: number };
  tax: {
    regime: string;
    patentYear: number;
    npdLegal: boolean;
    priceIncludesVat: boolean;
    ipWithoutStaff: boolean;
  };
  payroll: PayrollRow[];
  fixedCosts: { name: string; monthly: number }[];
  variableCosts: VariableCostRow[];
  investments: { name: string; amount: number }[];
  rates: FinRates;
  notes: string;
}

export interface FinYear {
  year: number;
  index: number;
  revenue: number;
  units: number;
  cogs: number;
  gross: number;
  payroll: number;
  insurance: number;
  fixed: number;
  variable: number;
  ebitda: number;
  tax: number;
  vat: number;
  net: number;
  minTaxTopUp: number;
  vatOnThreshold: number;
}

/** Итоги одного сценария. Помесячные строки на экран не отдаются — их до 120
 *  на сценарий, и место им в книге, а не в интерфейсе. */
export interface FinScenario {
  years: FinYear[];
  investment: number;
  payback: { months: number; label: string } | null;
  npv: number;
  irr: number | null;
  breakEvenUnits: number | null;
  breakEvenRevenue: number | null;
  marginPerUnit: number;
  totalNet: number;
  totalRevenue: number;
}

export interface FinComputed {
  input: FinModelInput;
  pess: FinScenario;
  base: FinScenario;
  opt: FinScenario;
}

/** Допущения, которые агент достал из статистики и официальных источников. */
export interface FinParams {
  baseVolume: number | null;
  seasonality: number[] | null;
  rampUp: number[] | null;
  inflation: number[] | null;
  minWage: number | null;
  sources: { inflation: string; minWage: string };
  comment: string;
}

export interface StoryPreset {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface StoryLayerKind {
  id: string;
  name: string;
}

/** Слой ролика. Поля различаются по kind — общие лежат здесь. */
export interface StoryLayer {
  id: string;
  kind: "pill" | "timeline" | "icon" | "svg" | "head" | "graphics" | "backdrop";
  start: number;
  duration: number;
  appear: string;
  appearDur: number;
  exit: string;
  exitDur: number;
  /** Положение в процентах холста: ролик бывает любого формата. */
  x: number;
  y: number;
  width: number;
  [extra: string]: unknown;
}

export interface StorySpec {
  title: string;
  presetId: string;
  width: number;
  height: number;
  fps: number;
  source: { kind: "file" | "stock"; path: string; query: string; trimStart: number };
  musicPath: string;
  musicVolume: number;
  duration: number;
  fonts: { family: string; path: string }[];
  layers: StoryLayer[];
}

export interface StoryFont {
  family: string;
  path: string;
}

export interface StoryProbe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface StoryStockVideo {
  id: string;
  preview: string;
  duration: number;
  width: number;
  height: number;
  url: string;
  author: string;
}

export interface StoryProgress {
  stage: "download" | "frames" | "encode" | "done";
  done?: number;
  total?: number;
  path?: string;
}

/** Операция плана уборки. Команды удаления нет намеренно — см. cleanup.cjs. */
export type CleanupOp =
  | { op: "mkdir"; target: string }
  | { op: "move"; from: string; to: string }
  | { op: "rename"; from: string; to: string };

export interface CleanupPrepared {
  prompt: string;
  fileCount: number;
  folderCount: number;
  truncated: boolean;
}

export interface CleanupApplied {
  done: { op: string; target?: string; from?: string; to?: string }[];
  failed: { op: CleanupOp; error: string }[];
}

export interface CleanupLedgerSheet {
  name: string;
  rows: string[][];
}

export type WordEditOp =
  | { op: "set"; index: number; text: string }
  | { op: "insert"; index: number; text: string; style: string }
  | { op: "delete"; index: number };

export interface WordEdit {
  ops: WordEditOp[];
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

/**
 * Which modules this build ships with, from plugins.json. A build without the
 * file has every module on — see electron/plugins.cjs.
 */
export interface PluginConfig {
  productName: string;
  modules: Record<string, boolean>;
  source: string;
}

/**
 * Demo access. `gated: false` means this build ships no public key and has no
 * licensing at all — the ordinary build the author uses herself.
 */
export interface LicenceStatus {
  gated: boolean;
  ok: boolean;
  reason: "" | "missing" | "machine" | "expired" | "revoked" | "signature" | "config";
  message?: string;
  machineCode: string;
  tester?: string;
  expiresAt?: string;
  daysLeft?: number;
  productName?: string;
  /** Название именно этой копии: «Личный чат Виктории». */
  displayName?: string;
}

export type UsagePeriod = "day" | "week" | "month";

export interface UsageEntry {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Часть входа, прочитанная из кэша провайдера. */
  cachedTokens?: number;
  exact: boolean;
  source: string;
}

export interface UsageModelRow {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  tokens: number;
  /** null — цена для этой модели не задана в сборке. */
  cost: number | null;
  exact: boolean;
}

export interface UsageSummary {
  period: UsagePeriod;
  from: string;
  models: UsageModelRow[];
  totals: {
    calls: number;
    tokens: number;
    cost: number | null;
    currency: string;
    estimated: boolean;
    cachedTokens: number;
  } | null;
}

export interface ReportInfo {
  version: string;
  productName: string;
  tester: string;
  expiresAt: string;
  gated: boolean;
  log: { total: number; errors: number; since: string };
}

export interface ElectronAPI {
  getConfig(): Promise<AppConfig>;
  chooseRootPath(): Promise<string | null>;
  openRootPath(): Promise<void>;

  getPlugins(): Promise<PluginConfig>;
  recordUsage(entry: UsageEntry): Promise<unknown>;
  usageSummary(period: UsagePeriod): Promise<UsageSummary>;
  reportInfo(): Promise<ReportInfo>;
  writeReport(description: string): Promise<{ file: string; entries: number }>;
  revealReport(file: string): Promise<boolean>;
  licenceStatus(options?: { allowNetwork?: boolean }): Promise<LicenceStatus>;
  activateLicence(contents: string): Promise<LicenceStatus>;
  pickLicenceFile(): Promise<LicenceStatus | null>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;

  listProjects(): Promise<Project[]>;
  createProject(data: { name: string; description: string; instructions: string }): Promise<Project>;
  updateProject(id: string, patch: Partial<Omit<Project, "id">>): Promise<Project>;
  /** `trashed: false` — корзина была недоступна и папка удалена безвозвратно. */
  deleteProject(id: string): Promise<{ trashed: boolean }>;
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
    label?: string;
  }): Promise<YandexConnectResult>;
  setActiveYandexAccount(id: string): Promise<CloudAccounts>;
  removeYandexAccount(id: string): Promise<CloudAccounts>;
  renameYandexAccount(id: string, label: string): Promise<CloudAccounts>;
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

  // Документы Word
  pickWordFile(): Promise<string | null>;
  openWordFile(filePath: string): Promise<WordDocument>;
  newWordDocument(name: string): Promise<WordDocument>;
  setWordBlockText(index: number, text: string): Promise<WordDocument>;
  deleteWordBlock(index: number): Promise<WordDocument>;
  insertWordParagraph(afterIndex: number, text: string, style?: string): Promise<WordDocument>;
  applyWordAgentEdit(edit: WordEdit): Promise<WordDocument>;
  saveWordFile(saveAs?: boolean): Promise<string | null>;
  buildWordAgentPrompt(mode?: "edit" | "analyze"): Promise<string>;
  saveWordAnalysis(markdown: string, defaultName: string): Promise<string | null>;
  getWordAgentConversation(): Promise<Conversation | null>;
  saveWordAgentConversation(conv: Conversation): Promise<Conversation>;

  // документооборот
  getDocflowConfig(): Promise<DocflowConfig>;
  saveDocflowConfig(config: DocflowConfig): Promise<DocflowConfig>;
  docflowKinds(): Promise<DocKind[]>;
  parseDocflowResult(text: string): Promise<{ meta: DocflowMeta; ops: WordEditOp[]; markdown: string } | null>;
  pickDocflowFile(kind: "template" | "ledger" | "data"): Promise<string[]>;
  pickDocflowFolder(): Promise<string | null>;
  listDocflowFolder(folderPath: string): Promise<string[]>;
  openDocflowFolder(folderPath: string): Promise<void>;
  prepareDocflow(request: {
    kindId: string;
    mode: "template" | "lawyer";
    month?: string;
    templatePath?: string;
    requisitesPath?: string;
    dataPaths?: string[];
    sourcePaths?: string[];
    ledgerPath?: string;
    counterpartyName?: string;
  }): Promise<DocflowPrepared>;
  saveDocflowResult(payload: {
    mode: "template" | "lawyer";
    templatePath?: string;
    ops?: WordEditOp[];
    markdown?: string;
    meta: DocflowMeta;
    outputDir: string;
    kindId: string;
    ledgerPath?: string;
    writeLedger: boolean;
  }): Promise<DocflowSaveResult>;

  // Excel workbooks
  pickExcelFile(): Promise<string | null>;
  openExcelFile(filePath: string): Promise<ExcelWorkbook>;
  newExcelWorkbook(name: string): Promise<ExcelWorkbook>;
  applyExcelAgentEdit(edit: ExcelEdit): Promise<{ workbook: ExcelWorkbook; createdSheets: string[] }>;

  // визуализация данных
  datavizOptions(): Promise<{ presets: CanvasPreset[]; palettes: VizPalette[]; kinds: VizKind[] }>;
  prepareDataviz(request: {
    kindId: string;
    presetId: string;
    paletteId: string;
    paletteOverrides?: Partial<VizPalette>;
    sourcePaths?: string[];
    extraStyle?: string;
  }): Promise<DatavizPrepared>;
  parseDatavizResult(text: string): Promise<{ title: string; html: string } | null>;
  previewDataviz(
    html: string,
    presetId: string,
    paletteId: string,
    overrides?: Partial<VizPalette>
  ): Promise<string>;
  saveDataviz(payload: {
    html: string;
    title: string;
    presetId: string;
    paletteId: string;
    paletteOverrides?: Partial<VizPalette>;
    outputDir: string;
    formats: string[];
  }): Promise<{ png?: string; pdf?: string; html?: string }>;

  // финмодель
  finmodelOptions(): Promise<{
    regimes: TaxRegime[];
    costKinds: CostKind[];
    rates: FinRates;
    months: string[];
  }>;
  prepareFinmodelParams(request: {
    input: Partial<FinModelInput>;
    dataPaths?: string[];
    searchRates?: boolean;
  }): Promise<{ prompt: string; problems: string[] }>;
  parseFinmodelParams(text: string, input: Partial<FinModelInput>): Promise<FinParams | null>;
  computeFinmodel(input: Partial<FinModelInput>): Promise<FinComputed>;
  prepareFinmodelAdvice(input: Partial<FinModelInput>): Promise<string>;
  saveFinmodel(payload: {
    input: Partial<FinModelInput>;
    destDir: string;
    fileName?: string;
    advice?: string;
    sources?: { inflation?: string; minWage?: string };
  }): Promise<string>;

  // видео-сторис
  storiesOptions(): Promise<{
    presets: StoryPreset[];
    appear: StoryLayerKind[];
    kinds: StoryLayerKind[];
    graphics: StoryLayerKind[];
    brand: Record<string, string>;
  }>;
  storiesFonts(): Promise<StoryFont[]>;
  storiesProbe(file: string): Promise<StoryProbe>;
  storiesValidate(spec: Partial<StorySpec>): Promise<string[]>;
  storiesNormalize(spec: Partial<StorySpec>): Promise<StorySpec>;
  storiesSearchIcons(query: string): Promise<{ id: string; url: string }[]>;
  storiesIcon(id: string, color?: string): Promise<string>;
  storiesReadSvg(file: string): Promise<string>;
  storiesSearchStock(query: string, orientation?: string): Promise<StoryStockVideo[]>;
  storiesScene(spec: Partial<StorySpec>): Promise<string>;
  storiesPoster(file: string, at: number, width: number): Promise<string>;
  prepareStoriesScript(request: {
    spec: Partial<StorySpec>;
    text: string;
  }): Promise<{ prompt: string; info: StoryProbe | null }>;
  parseStoriesScript(text: string): Promise<{ duration: number; layers: StoryLayer[] } | null>;
  renderStory(payload: { spec: Partial<StorySpec>; outputDir: string }): Promise<string>;
  onStoriesProgress(cb: (data: StoryProgress) => void): () => void;

  // клининг
  pickCleanupFolder(): Promise<string | null>;
  prepareCleanup(request: { folderPath: string; mode: "tidy" | "ledger"; notes?: string }): Promise<CleanupPrepared>;
  parseCleanupPlan(text: string): Promise<{ ops: CleanupOp[] } | null>;
  parseCleanupLedger(text: string): Promise<{ sheets: CleanupLedgerSheet[] } | null>;
  applyCleanupPlan(folderPath: string, plan: { ops: CleanupOp[] }): Promise<CleanupApplied>;
  undoCleanup(folderPath: string, done: CleanupApplied["done"]): Promise<{ restored: unknown[]; failed: unknown[] }>;
  saveCleanupLedger(sheets: CleanupLedgerSheet[], defaultName: string): Promise<string | null>;
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
  listTaskRuns(projectId: string): Promise<TaskRunSummary[]>;
  readTaskRun(projectId: string, runId: string): Promise<Conversation | null>;
  deleteTaskRun(projectId: string, runId: string): Promise<TaskRunSummary[]>;

  // профиль проекта
  readProjectProfile(projectId: string): Promise<{ profile: ProjectProfile | null; stale: boolean }>;
  buildProfileRequest(projectId: string): Promise<string>;
  saveProjectProfile(projectId: string, answerText: string): Promise<ProjectProfile>;
  userContextDigest(): Promise<string>;
  onTaskRan(callback: (payload: { projectId: string; task: ScheduledTask; conversationId: string }) => void): () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
