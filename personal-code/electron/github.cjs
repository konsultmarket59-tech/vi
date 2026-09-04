const fs = require("node:fs/promises");
const path = require("node:path");

// Адрес API можно подменить только переменной окружения — это нужно тестам,
// которые поднимают поддельный GitHub у себя: настоящий из них не дёрнешь.
const API_BASE = process.env.GITHUB_API_BASE || "https://api.github.com";

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


/**
 * Удаляет репозиторий копии. Нужен токен с правом `delete_repo` — обычный
 * «repo, workflow» его не даёт, и GitHub отвечает 403. Это не повод молчать:
 * человек должен понять, что репозиторий остался, и почему.
 */
async function deleteRepo(token, owner, repo) {
  try {
    await apiRequest(token, "DELETE", `/repos/${owner}/${repo}`);
    return { ok: true, message: `Репозиторий ${owner}/${repo} удалён.` };
  } catch (e) {
    const raw = String(e.message || e);
    if (/403|Must have admin rights|delete_repo/i.test(raw)) {
      return {
        ok: false,
        message:
          `Репозиторий ${owner}/${repo} не удалён: у токена нет права delete_repo. ` +
          "Добавьте это право токену в настройках GitHub или удалите репозиторий там вручную.",
      };
    }
    if (/404|Not Found/i.test(raw)) {
      return { ok: true, message: `Репозитория ${owner}/${repo} на GitHub уже нет.` };
    }
    return { ok: false, message: `Не удалось удалить ${owner}/${repo}: ${raw}` };
  }
}

// ---------- Git Data API: деревья, файлы, коммиты ----------
//
// Через этот раздел копия «Личного чата» уезжает в свой репозиторий целиком и
// без git на компьютере. Раньше снимок собирался локальным git (`commit-tree` и
// `push`), и на машине без установленного git сборка просто останавливалась —
// хотя весь нужный код лежит на GitHub, а не на компьютере.

/** Файлы ветки под указанной папкой: путь и sha содержимого. */
async function listTree(token, owner, repo, ref, prefix = "") {
  const json = await apiRequest(
    token,
    "GET",
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  );
  if (json.truncated) {
    throw new Error("Дерево репозитория слишком велико, GitHub отдал его не целиком.");
  }
  const head = prefix ? prefix.replace(/\/*$/, "") + "/" : "";
  return (json.tree || [])
    .filter((e) => e.type === "blob" && (!head || e.path.startsWith(head)))
    .map((e) => ({ path: head ? e.path.slice(head.length) : e.path, sha: e.sha, mode: e.mode, size: e.size || 0 }));
}

/** Содержимое файла как есть — base64, чтобы двоичные файлы не пострадали. */
async function readBlob(token, owner, repo, sha) {
  const json = await apiRequest(token, "GET", `/repos/${owner}/${repo}/git/blobs/${sha}`);
  if (json.encoding !== "base64" || json.content == null) {
    throw new Error("GitHub отдал файл в неожиданном виде.");
  }
  return json.content;
}

async function createBlob(token, owner, repo, base64) {
  const json = await apiRequest(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
    content: base64,
    encoding: "base64",
  });
  return json.sha;
}

async function createTree(token, owner, repo, entries) {
  const json = await apiRequest(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
    tree: entries.map((e) => ({ path: e.path, mode: e.mode || "100644", type: "blob", sha: e.sha })),
  });
  return json.sha;
}

async function createCommit(token, owner, repo, { message, tree, parents = [] }) {
  const json = await apiRequest(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message,
    tree,
    parents,
  });
  return json.sha;
}

/** sha ветки или пустая строка, если ветки ещё нет (только что созданный репозиторий). */
async function branchHead(token, owner, repo, branch) {
  try {
    const json = await apiRequest(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    return json.object?.sha || "";
  } catch {
    return "";
  }
}

/**
 * Ставит ветку на коммит. `force` нужен потому, что снимок каждый раз новый и
 * не является продолжением прежнего: в репозитории копии живёт один коммит с
 * текущим кодом, без истории монорепозитория.
 */
async function setBranch(token, owner, repo, branch, sha, { force = false } = {}) {
  const existing = await branchHead(token, owner, repo, branch);
  if (existing) {
    await apiRequest(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha, force });
  } else {
    await apiRequest(token, "POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
  }
  return sha;
}

// ---------- GitHub Actions ----------

/** Workflows defined in the repo (.github/workflows/*.yml). */
async function listWorkflows(token, owner, repo) {
  const json = await apiRequest(token, "GET", `/repos/${owner}/${repo}/actions/workflows`);
  return (json.workflows || []).map((w) => ({
    id: w.id,
    name: w.name,
    path: w.path,
    state: w.state,
  }));
}

/**
 * Starts a workflow run. This is the "Run workflow" button, not "Re-run" —
 * it always builds the tip of the chosen branch, which is what you want after
 * pushing a change. Re-running an old run would rebuild that run's original
 * commit instead.
 *
 * GitHub returns 204 with no body, so there's no run id to report back; the
 * caller polls listWorkflowRuns to pick up the run that just started.
 */
async function runWorkflow(token, owner, repo, workflowId, ref) {
  await apiRequest(token, "POST", `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, { ref });
  return { started: true };
}

async function listWorkflowRuns(token, owner, repo, workflowId, limit = 10) {
  const base = workflowId
    ? `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`
    : `/repos/${owner}/${repo}/actions/runs`;
  const json = await apiRequest(token, "GET", `${base}?per_page=${limit}`);
  return (json.workflow_runs || []).map((r) => ({
    id: r.id,
    name: r.name,
    runNumber: r.run_number,
    status: r.status,
    conclusion: r.conclusion,
    branch: r.head_branch,
    headSha: r.head_sha,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    htmlUrl: r.html_url,
    // Which commit message this run actually built — the detail that makes a
    // stale re-run obvious at a glance.
    headCommitMessage: r.head_commit?.message?.split("\n")[0] || "",
  }));
}

async function listBranches(token, owner, repo) {
  const json = await apiRequest(token, "GET", `/repos/${owner}/${repo}/branches?per_page=100`);
  return (json || []).map((b) => ({ name: b.name, sha: b.commit?.sha }));
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
  deleteRepo,
  getTree,
  getFileContent,
  listTree,
  readBlob,
  createBlob,
  createTree,
  createCommit,
  branchHead,
  setBranch,
  commitFile,
  getAgentConversation,
  saveAgentConversation,
  listWorkflows,
  runWorkflow,
  listWorkflowRuns,
  listBranches,
};
