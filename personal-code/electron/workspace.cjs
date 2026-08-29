// The opened folder on disk: tree listing, file reads/writes and text search.
//
// Every path that arrives from the renderer or from the model is workspace-relative
// and goes through resolveInside(), which is the single place that stops a traversal
// like "../../.ssh/id_rsa" from ever being opened or written. Nothing in this module
// takes an absolute path from outside.

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

// Directories that are never worth walking: they are huge, generated, or contain
// credentials. .git is excluded from the tree because the Git panel reads it
// through the git CLI instead.
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-ssr",
  "build",
  "out",
  "release",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".gradle",
  ".idea",
  ".vscode",
  "target",
  "vendor",
  "Pods",
  ".DS_Store",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".md", ".markdown", ".txt", ".rst",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".php", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
  ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".env", ".properties",
  ".sql", ".graphql", ".gql", ".proto", ".xml", ".svg", ".vue", ".svelte", ".astro",
  ".gitignore", ".gitattributes", ".editorconfig", ".dockerignore", ".npmrc",
]);

// Files bigger than this are not opened in the editor or fed to the agent: a
// bundled .min.js or a checked-in dataset would blow the context budget for no
// benefit. The number is deliberately generous for hand-written source.
const MAX_TEXT_BYTES = 1_500_000;

// Guardrails on the tree walk so a mistakenly-opened home directory cannot hang
// the app while it enumerates a million files.
const MAX_DEPTH = 12;
const MAX_ENTRIES = 20_000;

/** Language id for the editor, derived from the file name. */
function languageOf(rel) {
  const name = path.basename(rel).toLowerCase();
  const ext = path.extname(name);
  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if ([".json", ".jsonc"].includes(ext)) return "json";
  if ([".html", ".htm", ".vue", ".svelte", ".astro"].includes(ext)) return "html";
  if ([".css", ".scss", ".sass", ".less"].includes(ext)) return "css";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if (ext === ".py") return "python";
  return "text";
}

function isProbablyText(rel, size) {
  if (size > MAX_TEXT_BYTES) return false;
  const name = path.basename(rel);
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Extension-less dotfiles and things like "Makefile", "Dockerfile", "LICENSE".
  if (!ext) return true;
  return false;
}

/**
 * Second half of the boundary check: the path is textually inside the root, but
 * a symbolic link inside the folder can still point anywhere on disk. Node opens
 * links transparently, so "ссылка/id_rsa" would be read from the link's target
 * without this. Checked against the real path of the nearest ancestor that
 * exists, because a file being created does not exist yet.
 */
function assertNoLinkEscape(root, absolute, rel) {
  let realRoot;
  try {
    realRoot = fsSync.realpathSync(path.resolve(root));
  } catch {
    // The folder itself is gone — the operation below will fail on its own with
    // a clearer message than anything we could invent here.
    return;
  }
  let probe = absolute;
  for (;;) {
    let real;
    try {
      real = fsSync.realpathSync(probe);
    } catch (e) {
      if (e.code !== "ENOENT") return; // unreadable, not an escape — let the caller fail
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
      continue;
    }
    const rest = path.relative(probe, absolute);
    const target = rest ? path.resolve(real, rest) : real;
    if (target !== realRoot && !target.startsWith(realRoot + path.sep)) {
      throw new Error(`Путь «${rel}» ведёт по ссылке за пределы открытой папки — отказано.`);
    }
    return;
  }
}

/**
 * Turns a workspace-relative path into an absolute one, refusing anything that
 * escapes the workspace root. This is the security boundary of the whole app —
 * both IPC handlers and the agent's file tools go through it.
 */
function resolveInside(root, rel) {
  if (typeof root !== "string" || !root) throw new Error("Папка проекта не открыта.");
  if (typeof rel !== "string") throw new Error("Не указан путь к файлу.");
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) throw new Error("Не указан путь к файлу.");
  const absolute = path.resolve(root, normalized);
  const rootWithSep = path.resolve(root) + path.sep;
  if (absolute !== path.resolve(root) && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Путь «${rel}» выходит за пределы открытой папки — отказано.`);
  }
  assertNoLinkEscape(root, absolute, rel);
  return absolute;
}

function toRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

/**
 * Walks the workspace into a nested tree. Returns { tree, truncated } — truncated
 * is true when the entry cap was hit, so the UI can say so instead of silently
 * showing a partial project.
 */
async function tree(root) {
  let count = 0;
  let truncated = false;

  async function walk(dir, depth) {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return [];
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes = [];
    // Directories first, then files, each alphabetically — the order a file tree
    // is expected to be in.
    entries.sort((a, b) => {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (count >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      const rel = toRelative(root, absolute);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        count++;
        nodes.push({ name: entry.name, path: rel, type: "dir", children: await walk(absolute, depth + 1) });
      } else if (entry.isFile()) {
        count++;
        let size = 0;
        try {
          size = (await fs.stat(absolute)).size;
        } catch {
          continue;
        }
        nodes.push({
          name: entry.name,
          path: rel,
          type: "file",
          size,
          text: isProbablyText(rel, size),
          language: languageOf(rel),
        });
      }
    }
    return nodes;
  }

  const nodes = await walk(root, 0);
  return { tree: nodes, truncated };
}

/** Flat list of readable text files — what the agent gets as its map of the project. */
async function listTextFiles(root, limit = 4000) {
  const out = [];
  const { tree: nodes } = await tree(root);
  const push = (list) => {
    for (const node of list) {
      if (out.length >= limit) return;
      if (node.type === "dir") push(node.children);
      else if (node.text) out.push(node.path);
    }
  };
  push(nodes);
  return out;
}

async function readFile(root, rel) {
  const absolute = resolveInside(root, rel);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`«${rel}» — это не файл.`);
  if (stat.size > MAX_TEXT_BYTES) {
    throw new Error(
      `Файл «${rel}» слишком большой (${Math.round(stat.size / 1024)} КБ) — редактор открывает до ${Math.round(MAX_TEXT_BYTES / 1024)} КБ.`
    );
  }
  const buffer = await fs.readFile(absolute);
  // A NUL byte in the first block is the standard heuristic for "this is binary".
  if (buffer.subarray(0, 8000).includes(0)) {
    throw new Error(`Файл «${rel}» двоичный — открыть как текст нельзя.`);
  }
  return {
    path: rel,
    content: buffer.toString("utf-8"),
    language: languageOf(rel),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

async function writeFile(root, rel, content) {
  const absolute = resolveInside(root, rel);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf-8");
  const stat = await fs.stat(absolute);
  return { path: rel, size: stat.size, modifiedAt: stat.mtimeMs };
}

async function createFile(root, rel, content = "") {
  const absolute = resolveInside(root, rel);
  if (fsSync.existsSync(absolute)) throw new Error(`Файл «${rel}» уже существует.`);
  return writeFile(root, rel, content);
}

async function createDir(root, rel) {
  const absolute = resolveInside(root, rel);
  await fs.mkdir(absolute, { recursive: true });
  return { path: rel };
}

async function deletePath(root, rel) {
  const absolute = resolveInside(root, rel);
  const stat = await fs.stat(absolute);
  if (stat.isDirectory()) await fs.rm(absolute, { recursive: true, force: true });
  else await fs.unlink(absolute);
  return { path: rel };
}

async function renamePath(root, fromRel, toRel) {
  const from = resolveInside(root, fromRel);
  const to = resolveInside(root, toRel);
  if (fsSync.existsSync(to)) throw new Error(`«${toRel}» уже существует.`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return { path: toRel };
}

/**
 * Plain substring or regex search across the workspace's text files. Deliberately
 * implemented in-process rather than shelling out to grep/ripgrep, which are not
 * present on a stock Windows machine.
 */
async function search(root, query, { regex = false, caseSensitive = false, maxResults = 300 } = {}) {
  if (!query || !query.trim()) return { matches: [], truncated: false };
  let matcher;
  if (regex) {
    try {
      matcher = new RegExp(query, caseSensitive ? "g" : "gi");
    } catch (e) {
      throw new Error(`Некорректное регулярное выражение: ${e.message}`);
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();

  const files = await listTextFiles(root);
  const matches = [];
  let truncated = false;

  for (const rel of files) {
    if (matches.length >= maxResults) {
      truncated = true;
      break;
    }
    let content;
    try {
      const buffer = await fs.readFile(resolveInside(root, rel));
      if (buffer.subarray(0, 8000).includes(0)) continue;
      content = buffer.toString("utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
      const line = lines[i];
      const hit = matcher ? matcher.test(line) : (caseSensitive ? line : line.toLowerCase()).includes(needle);
      if (matcher) matcher.lastIndex = 0;
      if (hit) matches.push({ path: rel, line: i + 1, text: line.slice(0, 400) });
    }
  }
  return { matches, truncated };
}

module.exports = {
  IGNORED_DIRS,
  MAX_TEXT_BYTES,
  languageOf,
  resolveInside,
  tree,
  listTextFiles,
  readFile,
  writeFile,
  createFile,
  createDir,
  deletePath,
  renamePath,
  search,
};
