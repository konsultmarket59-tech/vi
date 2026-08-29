// Git operations on the opened workspace, driven through the git CLI.
//
// Every call goes through execFile with an argument array and no shell, so a
// branch name or commit message containing quotes, semicolons or backticks is
// data and can never become a command.
//
// Authentication for push/pull: by default we let git use whatever credential
// helper the machine already has (Git Credential Manager on Windows, the
// keychain on macOS). When a token is saved in the app's settings it is handed
// to git through an environment variable read by an inline credential helper —
// never as a command-line argument, which would be visible to every other
// process on the machine in the process list.

const { execFile } = require("node:child_process");
const path = require("node:path");
const fsSync = require("node:fs");

const DEFAULT_TIMEOUT = 60_000;
// Network operations legitimately take longer than local ones.
const NETWORK_TIMEOUT = 180_000;

const TOKEN_HELPER =
  "!f() { echo username=\"${GIT_APP_USERNAME}\"; echo password=\"${GIT_APP_TOKEN}\"; }; f";

class GitError extends Error {
  constructor(message, { code, stderr } = {}) {
    super(message);
    this.name = "GitError";
    this.code = code;
    this.stderr = stderr;
  }
}

function run(root, args, { timeout = DEFAULT_TIMEOUT, token = "", tokenUser = "" } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      // Without this git can block forever waiting for a username on stdin that
      // no one will ever type, and the call just hangs.
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
    };
    const fullArgs = [];
    if (token) {
      env.GIT_APP_TOKEN = token;
      env.GIT_APP_USERNAME = tokenUser || "x-access-token";
      fullArgs.push("-c", `credential.helper=${TOKEN_HELPER}`);
    }
    fullArgs.push(...args);

    execFile("git", fullArgs, { cwd: root, timeout, maxBuffer: 32 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") {
          return reject(
            new GitError(
              "Git не найден на компьютере. Установите Git для Windows (git-scm.com) и перезапустите приложение."
            )
          );
        }
        const detail = (stderr || stdout || err.message || "").trim();
        return reject(new GitError(detail || "Команда git завершилась с ошибкой.", { code: err.code, stderr }));
      }
      resolve(stdout);
    });
  });
}

function isRepo(root) {
  return Boolean(root) && fsSync.existsSync(path.join(root, ".git"));
}

/** Porcelain v1 status codes → a shape the UI can render directly. */
function parseStatus(raw) {
  const files = [];
  for (const line of raw.split("\0")) {
    if (!line) continue;
    const index = line[0];
    const worktree = line[1];
    const file = line.slice(3);
    if (!file) continue;
    files.push({
      path: file,
      staged: index !== " " && index !== "?",
      unstaged: worktree !== " " && worktree !== "?",
      untracked: index === "?" && worktree === "?",
      indexStatus: index,
      worktreeStatus: worktree,
    });
  }
  return files;
}

async function status(root) {
  if (!isRepo(root)) return { isRepo: false, files: [], branch: "", ahead: 0, behind: 0, upstream: "" };

  const raw = await run(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const files = parseStatus(raw);

  let branch = "";
  try {
    branch = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  } catch {
    // A brand new repository with no commits has no HEAD to resolve yet.
    branch = "(нет коммитов)";
  }

  let upstream = "";
  let ahead = 0;
  let behind = 0;
  try {
    upstream = (await run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
    const counts = (await run(root, ["rev-list", "--left-right", "--count", "HEAD...@{u}"])).trim();
    const [a, b] = counts.split(/\s+/).map((n) => Number(n) || 0);
    ahead = a;
    behind = b;
  } catch {
    // No upstream configured — normal for a branch that was never pushed.
  }

  return { isRepo: true, files, branch, upstream, ahead, behind };
}

async function diff(root, { file = "", staged = false } = {}) {
  const args = ["diff", "--no-color"];
  if (staged) args.push("--staged");
  if (file) args.push("--", file);
  return run(root, args);
}

/** Diff for a file git has never seen — there is nothing to diff against, so show the content. */
async function showUntracked(root, file) {
  const workspace = require("./workspace.cjs");
  const { content } = await workspace.readFile(root, file);
  return content
    .split("\n")
    .map((line) => "+" + line)
    .join("\n");
}

async function log(root, limit = 40) {
  if (!isRepo(root)) return [];
  let raw;
  try {
    raw = await run(root, [
      "log",
      `-n${Math.max(1, Math.min(500, limit))}`,
      "--date=iso",
      "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1e",
    ]);
  } catch (e) {
    // An empty repository has no commits to log; that is not an error to surface.
    if (/does not have any commits|unknown revision/i.test(e.message)) return [];
    throw e;
  }
  return raw
    .split("\x1e")
    .map((row) => row.replace(/^\n/, ""))
    .filter(Boolean)
    .map((row) => {
      const [hash, short, author, date, subject] = row.split("\x1f");
      return { hash, short, author, date, subject };
    });
}

async function branches(root) {
  if (!isRepo(root)) return { current: "", local: [], remote: [] };
  const raw = await run(root, ["branch", "--all", "--format=%(refname:short)%09%(HEAD)"]);
  const local = [];
  const remote = [];
  let current = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [name, head] = line.split("\t");
    if (head === "*") current = name;
    if (name.startsWith("remotes/")) remote.push(name.replace(/^remotes\//, ""));
    else local.push(name);
  }
  return { current, local, remote };
}

async function stage(root, files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) throw new GitError("Не выбраны файлы.");
  await run(root, ["add", "--", ...list]);
  return status(root);
}

async function stageAll(root) {
  await run(root, ["add", "-A"]);
  return status(root);
}

async function unstage(root, files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) throw new GitError("Не выбраны файлы.");
  await run(root, ["restore", "--staged", "--", ...list]);
  return status(root);
}

async function commit(root, message, { userName = "", userEmail = "" } = {}) {
  const text = (message || "").trim();
  if (!text) throw new GitError("Пустое сообщение коммита.");
  const args = [];
  // -c keeps the identity to this one invocation instead of writing it into the
  // repository's config, which would be a surprising side effect.
  if (userName) args.push("-c", `user.name=${userName}`);
  if (userEmail) args.push("-c", `user.email=${userEmail}`);
  args.push("commit", "-m", text);
  try {
    await run(root, args);
  } catch (e) {
    if (/Please tell me who you are|empty ident name|unable to auto-detect email/i.test(e.message)) {
      throw new GitError(
        "Git не знает, от чьего имени делать коммит. Впишите имя и почту в настройках приложения."
      );
    }
    if (/nothing to commit/i.test(e.message)) {
      throw new GitError("Нечего коммитить — нет проиндексированных изменений.");
    }
    throw e;
  }
  return status(root);
}

async function createBranch(root, name, { checkout = true } = {}) {
  const clean = (name || "").trim();
  if (!clean) throw new GitError("Не указано имя ветки.");
  await run(root, checkout ? ["checkout", "-b", clean] : ["branch", clean]);
  return status(root);
}

async function checkoutBranch(root, name) {
  const clean = (name || "").trim();
  if (!clean) throw new GitError("Не указано имя ветки.");
  await run(root, ["checkout", clean]);
  return status(root);
}

async function remotes(root) {
  if (!isRepo(root)) return [];
  const raw = await run(root, ["remote", "-v"]);
  const seen = new Map();
  for (const line of raw.split("\n")) {
    const [name, url] = line.trim().split(/\s+/);
    if (name && url && !seen.has(name)) seen.set(name, url);
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

/**
 * Pushes the current branch, setting upstream on the first push so the branch
 * has somewhere to go next time. Network failures get one retry with a pause,
 * since a flaky connection is the common case rather than a real error.
 */
async function push(root, { remote = "origin", branch = "", setUpstream = true, token = "", tokenUser = "" } = {}) {
  const target = branch || (await status(root)).branch;
  if (!target || target.startsWith("(")) throw new GitError("Не определена текущая ветка.");
  const args = ["push"];
  if (setUpstream) args.push("-u");
  args.push(remote, target);

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await run(root, args, { timeout: NETWORK_TIMEOUT, token, tokenUser });
      return { ok: true, output: out.trim(), status: await status(root) };
    } catch (e) {
      lastError = e;
      if (/Authentication failed|could not read Username|403|invalid credentials/i.test(e.message)) {
        throw new GitError(
          "Git не принял учётные данные. Укажите токен доступа в настройках или войдите через диспетчер учётных данных Windows."
        );
      }
      if (!/Could not resolve|Failed to connect|timed out|Connection reset|RPC failed/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw lastError;
}

async function pull(root, { remote = "origin", branch = "", token = "", tokenUser = "" } = {}) {
  const target = branch || (await status(root)).branch;
  const args = ["pull", remote];
  if (target && !target.startsWith("(")) args.push(target);
  const out = await run(root, args, { timeout: NETWORK_TIMEOUT, token, tokenUser });
  return { ok: true, output: out.trim(), status: await status(root) };
}

async function fetch(root, { remote = "origin", token = "", tokenUser = "" } = {}) {
  const out = await run(root, ["fetch", remote], { timeout: NETWORK_TIMEOUT, token, tokenUser });
  return { ok: true, output: out.trim(), status: await status(root) };
}

async function initRepo(root) {
  if (isRepo(root)) throw new GitError("В этой папке уже есть репозиторий.");
  await run(root, ["init", "-b", "main"]);
  return status(root);
}

async function addRemote(root, name, url) {
  const cleanName = (name || "").trim();
  const cleanUrl = (url || "").trim();
  if (!cleanName || !cleanUrl) throw new GitError("Нужны имя и адрес удалённого репозитория.");
  await run(root, ["remote", "add", cleanName, cleanUrl]);
  return remotes(root);
}

/** Undoes uncommitted changes to specific files. Destructive — the UI confirms first. */
async function discard(root, files) {
  const list = (files || []).filter(Boolean);
  if (!list.length) throw new GitError("Не выбраны файлы.");
  await run(root, ["checkout", "--", ...list]);
  return status(root);
}

module.exports = {
  GitError,
  isRepo,
  status,
  diff,
  showUntracked,
  log,
  branches,
  stage,
  stageAll,
  unstage,
  commit,
  createBranch,
  checkoutBranch,
  remotes,
  push,
  pull,
  fetch,
  initRepo,
  addRemote,
  discard,
};
