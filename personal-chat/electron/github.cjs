const fs = require("node:fs/promises");
const path = require("node:path");

const API_BASE = "https://api.github.com";

function githubDir(root) {
  return path.join(root, "github");
}
function accountFile(root) {
  return path.join(githubDir(root), "account.json");
}
function repoWorkDir(root, owner, repo) {
  return path.join(githubDir(root), `${owner}--${repo}`);
}
function repoChatFile(root, owner, repo) {
  return path.join(repoWorkDir(root, owner, repo), "chat.json");
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

function headers(token) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiRequest(token, method, urlPath, body) {
  const res = await fetch(urlPath.startsWith("http") ? urlPath : API_BASE + urlPath, {
    method,
    headers: { ...headers(token), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.message || `Ошибка GitHub API (${res.status})`);
  }
  return json;
}

async function getAccount(root) {
  return readJson(accountFile(root), { token: "" });
}

async function saveAccount(root, account) {
  await ensureDir(githubDir(root));
  await writeJson(accountFile(root), account);
  return account;
}

async function testConnection(token) {
  if (!token?.trim()) return { ok: false, error: "Токен не задан." };
  try {
    const user = await apiRequest(token, "GET", "/user");
    return { ok: true, login: user.login };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function listRepos(token) {
  const repos = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await apiRequest(
      token,
      "GET",
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
    );
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner.login,
    description: r.description || "",
    private: r.private,
    updatedAt: new Date(r.updated_at).getTime(),
    defaultBranch: r.default_branch,
  }));
}

async function createRepo(token, { name, description, private: isPrivate }) {
  const r = await apiRequest(token, "POST", "/user/repos", {
    name,
    description: description || "",
    private: !!isPrivate,
    auto_init: true,
  });
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner.login,
    description: r.description || "",
    private: r.private,
    updatedAt: new Date(r.updated_at).getTime(),
    defaultBranch: r.default_branch,
  };
}

const MAX_TREE_ENTRIES = 3000;
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".mp4", ".mov", ".webm", ".mp3", ".wav", ".ogg",
  ".zip", ".gz", ".tar", ".7z", ".pdf",
  ".exe", ".dll", ".so", ".dylib", ".bin",
]);

async function getTree(token, owner, repo) {
  const repoInfo = await apiRequest(token, "GET", `/repos/${owner}/${repo}`);
  const branch = repoInfo.default_branch;
  const treeRes = await apiRequest(token, "GET", `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  const entries = (treeRes.tree || [])
    .filter((e) => e.type === "blob")
    .slice(0, MAX_TREE_ENTRIES)
    .map((e) => ({
      path: e.path,
      size: e.size || 0,
      binary: BINARY_EXTENSIONS.has(path.extname(e.path).toLowerCase()),
    }));
  return { branch, truncated: (treeRes.tree || []).length > MAX_TREE_ENTRIES, entries };
}

async function getFileContent(token, owner, repo, filePath, ref) {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const data = await apiRequest(token, "GET", `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}${q}`);
  if (Array.isArray(data)) throw new Error(`"${filePath}" — это папка, не файл.`);
  if (data.encoding !== "base64" || data.content == null) {
    throw new Error(`Не удалось прочитать файл (возможно, слишком большой для GitHub Contents API).`);
  }
  const buffer = Buffer.from(data.content, "base64");
  return { path: filePath, content: buffer.toString("utf-8"), sha: data.sha };
}

async function commitFile(token, owner, repo, filePath, content, message, sha, branch) {
  const body = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;
  const result = await apiRequest(
    token,
    "PUT",
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
    body
  );
  return {
    path: filePath,
    sha: result.content?.sha,
    commitSha: result.commit?.sha,
  };
}

async function getAgentConversation(root, owner, repo) {
  return readJson(repoChatFile(root, owner, repo), null);
}

async function saveAgentConversation(root, owner, repo, conv) {
  await ensureDir(repoWorkDir(root, owner, repo));
  await writeJson(repoChatFile(root, owner, repo), conv);
  return conv;
}

module.exports = {
  getAccount,
  saveAccount,
  testConnection,
  listRepos,
  createRepo,
  getTree,
  getFileContent,
  commitFile,
  getAgentConversation,
  saveAgentConversation,
};
