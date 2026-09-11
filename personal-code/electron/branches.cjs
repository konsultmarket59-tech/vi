// Ветка на GitHub как обычная рабочая папка — без git на компьютере.
//
// Раньше, чтобы поправить чужую копию или собрать плагин, нужен был установленный
// git: код клонировался, коммит и push делал он же. На компьютере, где стоит одно
// приложение, git не стоит — и всё останавливалось на «Git не найден», хотя
// GitHub умеет и отдавать содержимое ветки, и принимать коммит сам.
//
// Здесь ветка выкачивается в папку через Git Data API, рядом кладётся снимок —
// какой коммит взят и с какими файлами. По этому снимку потом видно, что человек
// (или агент) изменил, добавил и удалил, и ровно это уезжает обратно одним
// коммитом поверх ветки.
//
// Подпапка (`subdir`) нужна для канонического репозитория: чат лежит в
// personal-chat, а работать удобнее с ним одним. Внутри папки путей с префиксом
// нет, при отправке он возвращается на место.

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

const github = require("./github.cjs");

/** Снимок ветки: что именно выкачано и от какого коммита. */
const MANIFEST = ".ветка-github.json";

/** Файлы, которые незачем выкачивать и нечего отправлять обратно. */
const SKIP = [/^node_modules\//, /^dist\//, /^release\//, /(^|\/)\.DS_Store$/];

function splitRepo(repo) {
  const name = String(repo || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const [owner, short] = name.split("/");
  if (!owner || !short || name.split("/").length !== 2) {
    throw new Error(`«${repo}» не похоже на репозиторий GitHub. Ожидается вид «владелец/репозиторий».`);
  }
  return { owner, name: short, full: `${owner}/${short}` };
}

function manifestFile(dir) {
  return path.join(dir, MANIFEST);
}

async function readManifest(dir) {
  try {
    return JSON.parse(await fs.readFile(manifestFile(dir), "utf-8"));
  } catch {
    return null;
  }
}

/** Есть ли в этой папке ветка GitHub (а не просто чьи-то файлы). */
function isBranchFolder(dir) {
  return fsSync.existsSync(manifestFile(dir));
}

async function writeManifest(dir, manifest) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(manifestFile(dir), JSON.stringify(manifest, null, 2), "utf-8");
}

/** Все файлы папки, кроме служебных, — относительными путями. */
async function localFiles(dir, prefix = "") {
  const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true }).catch(() => []);
  const found = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (rel === MANIFEST || entry.name === ".git") continue;
    if (SKIP.some((rule) => rule.test(rel))) continue;
    if (entry.isDirectory()) found.push(...(await localFiles(dir, rel)));
    else if (entry.isFile()) found.push(rel);
  }
  return found;
}

/**
 * Выкачивает ветку в папку. Папка приводится к состоянию ветки: то, что было
 * выкачано прежде и в ветке исчезло, удаляется — иначе от прошлой правки
 * остались бы файлы-призраки.
 */
async function pull(token, { repo, branch, dir, subdir = "", onLog = () => {} }) {
  const log = (line) => onLog(String(line));
  const source = splitRepo(repo);
  if (!branch) throw new Error("Не указана ветка.");

  const head = await github.branchHead(token, source.owner, source.name, branch);
  if (!head) throw new Error(`В репозитории ${source.full} нет ветки «${branch}».`);

  log(`Читаю ветку ${source.full}@${branch}…`);
  const tree = await github.listTree(token, source.owner, source.name, branch, subdir);
  const wanted = tree.filter((file) => !SKIP.some((rule) => rule.test(file.path)));
  if (!wanted.length) {
    throw new Error(
      subdir
        ? `В ветке «${branch}» нет папки ${subdir}.`
        : `Ветка «${branch}» пуста — нечего выкачивать.`
    );
  }

  const previous = await readManifest(dir);
  const files = {};
  let done = 0;
  for (const file of wanted) {
    const dest = path.join(dir, file.path);
    // Файл, который не менялся с прошлого раза, второй раз не качаем.
    if (previous?.files?.[file.path] === file.sha && fsSync.existsSync(dest)) {
      files[file.path] = file.sha;
      continue;
    }
    const content = await github.readBlob(token, source.owner, source.name, file.sha);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, Buffer.from(content, "base64"));
    files[file.path] = file.sha;
    done++;
    if (done % 25 === 0) log(`Выкачано файлов: ${done}…`);
  }

  for (const old of Object.keys(previous?.files || {})) {
    if (!files[old]) await fs.rm(path.join(dir, old), { force: true });
  }

  const manifest = {
    repo: source.full,
    branch,
    subdir,
    head,
    files,
    pulledAt: new Date().toISOString(),
  };
  await writeManifest(dir, manifest);
  log(`Готово: ${Object.keys(files).length} файлов, коммит ${head.slice(0, 7)}.`);
  return manifest;
}

/** Что изменилось в папке с момента выкачивания. */
async function changes(dir) {
  const manifest = await readManifest(dir);
  if (!manifest) return null;
  const present = await localFiles(dir);
  const added = [];
  const changed = [];
  for (const rel of present) {
    const known = manifest.files[rel];
    if (!known) {
      added.push(rel);
      continue;
    }
    // Сравниваем по тому же, по чему считает git: sha1 от "blob <длина>\0<содержимое>".
    const data = await fs.readFile(path.join(dir, rel));
    const sha = require("node:crypto")
      .createHash("sha1")
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest("hex");
    if (sha !== known) changed.push(rel);
  }
  const removed = Object.keys(manifest.files).filter((rel) => !present.includes(rel));
  return { manifest, added, changed, removed, total: added.length + changed.length + removed.length };
}

/**
 * Отправляет правки одним коммитом поверх ветки.
 *
 * Коммит с родителем и деревом поверх текущего: всё, чего человек не трогал,
 * остаётся как было, даже если в ветке это появилось уже после выкачивания.
 */
async function push(token, dir, { message, onLog = () => {} } = {}) {
  const log = (line) => onLog(String(line));
  const diff = await changes(dir);
  if (!diff) throw new Error("Эта папка не выкачана из GitHub — отправлять нечего.");
  if (!diff.total) return { ok: false, message: "Изменений нет — отправлять нечего." };
  if (!String(message || "").trim()) throw new Error("Нужно сообщение коммита — одной строкой, что сделано.");

  const { manifest } = diff;
  const source = splitRepo(manifest.repo);
  const prefix = manifest.subdir ? manifest.subdir.replace(/\/+$/, "") + "/" : "";

  const current = await github.branchHead(token, source.owner, source.name, manifest.branch);
  if (!current) throw new Error(`Ветки «${manifest.branch}» в ${source.full} больше нет.`);
  const base = await github.commitInfo(token, source.owner, source.name, current);

  const entries = [];
  for (const rel of [...diff.added, ...diff.changed]) {
    const data = await fs.readFile(path.join(dir, rel));
    const sha = await github.createBlob(token, source.owner, source.name, data.toString("base64"));
    entries.push({ path: prefix + rel, sha });
    log(`Отправляю ${rel}…`);
  }
  for (const rel of diff.removed) entries.push({ path: prefix + rel, sha: null });

  const tree = await github.createTreeOn(token, source.owner, source.name, base.tree, entries);
  const commit = await github.createCommit(token, source.owner, source.name, {
    message: String(message).trim(),
    tree,
    parents: [current],
  });
  await github.setBranch(token, source.owner, source.name, manifest.branch, commit);

  // Снимок обновляем по тому, что реально уехало: иначе следующий «Отправить»
  // посчитал бы те же файлы изменёнными второй раз.
  const after = await github.listTree(token, source.owner, source.name, manifest.branch, manifest.subdir);
  const files = {};
  for (const file of after) {
    if (!SKIP.some((rule) => rule.test(file.path))) files[file.path] = file.sha;
  }
  await writeManifest(dir, { ...manifest, head: commit, files, pushedAt: new Date().toISOString() });

  log(`Коммит ${commit.slice(0, 7)} в ветке ${manifest.branch}.`);
  return {
    ok: true,
    commit,
    branch: manifest.branch,
    repo: source.full,
    files: diff.total,
    url: `https://github.com/${source.full}/commit/${commit}`,
  };
}

/** Новая ветка от другой ветки — чтобы правки шли не в главную. */
async function branchFrom(token, { repo, from, name }) {
  const source = splitRepo(repo);
  const clean = String(name || "").trim().replace(/\s+/g, "-");
  if (!clean) throw new Error("Нужно название ветки.");
  const existing = await github.branchHead(token, source.owner, source.name, clean);
  if (existing) return { name: clean, sha: existing, created: false };
  const start = await github.branchHead(token, source.owner, source.name, from);
  if (!start) throw new Error(`Ветки «${from}», от которой ответвляться, в ${source.full} нет.`);
  await github.createBranch(token, source.owner, source.name, clean, start);
  return { name: clean, sha: start, created: true };
}

/** Запрос на слияние для выкачанной ветки. */
async function pullRequest(token, dir, { base = "main", title, body = "" } = {}) {
  const manifest = await readManifest(dir);
  if (!manifest) throw new Error("Эта папка не выкачана из GitHub.");
  const source = splitRepo(manifest.repo);
  if (manifest.branch === base) {
    throw new Error(`Ветка «${manifest.branch}» и есть основная — запрос на слияние не нужен.`);
  }
  return github.createPullRequest(token, source.owner, source.name, {
    head: manifest.branch,
    base,
    title: String(title || "").trim() || `Правки в ${manifest.branch}`,
    body,
  });
}

module.exports = {
  MANIFEST,
  splitRepo,
  isBranchFolder,
  readManifest,
  pull,
  changes,
  push,
  branchFrom,
  pullRequest,
};
