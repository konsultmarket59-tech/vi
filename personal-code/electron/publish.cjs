// Публикация копии «Личного чата» в её собственный репозиторий на GitHub и
// запуск сборки установщика там же.
//
// Почему копия живёт в отдельном репозитории, а не в ветке общего: у копии своя
// конфигурация (какие модули включены, каким ключом она работает, как называется
// в окне) и свой установщик, который собирается по кнопке. Отдельный репозиторий
// — это ещё и место, куда потом уходят исправления именно для этого человека,
// не задевая остальных.
//
// Что уезжает в репозиторий: только папка personal-chat из канонической ветки,
// снимком в один коммит. Ни истории монорепозитория, ни «Личного кода» там нет —
// в копии не должно быть ничего, кроме самого чата.
//
// Репозиторий создаётся ЗАКРЫТЫМ. В нём лежит managed-config.json с ключом
// Polza — тем самым, который всё равно окажется внутри установщика на чужом
// компьютере. Закрытый репозиторий не делает ключ секретным, он лишь не
// добавляет к этому ещё и публичный доступ; настоящая защита та же, что и
// раньше — отдельный ключ с небольшим балансом, который не жалко отозвать.

const path = require("node:path");
const fs = require("node:fs/promises");

const git = require("./git.cjs");
const github = require("./github.cjs");
const blueprints = require("./blueprints.cjs");
const demoAccess = require("./demoAccess.cjs");
const copies = require("./copies.cjs");
const buildPipeline = require("./build.cjs");

// Сборка установщика в репозитории копии. Файл кладётся туда же, где его ждёт
// GitHub, и собирает именно эту копию.
const WORKFLOW_PATH = ".github/workflows/build.yml";
const WORKFLOW_FILE = "build.yml";

function workflowYaml(displayName) {
  return `name: Сборка «${displayName}»

on:
  workflow_dispatch: {}
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run electron:build:win
      - name: Публикация установщика
        uses: softprops/action-gh-release@v2
        with:
          tag_name: latest
          name: "${displayName} — установщик"
          body: |
            Сборка ${displayName}.
            Portable-версия запускается без установки, Setup-версия ставится обычным установщиком.
          prerelease: true
          files: release/*.exe
`;
}

/**
 * Снимок папки personal-chat из указанной ветки — один коммит, без истории
 * монорепозитория. Возвращает sha коммита, который можно запушить.
 */
async function snapshotCommit(sourceRoot, branch, message, parent = "") {
  const repoRoot = path.resolve(sourceRoot, "..");
  const ref = branch || "HEAD";
  const tree = (await git.run(repoRoot, ["rev-parse", `${ref}:personal-chat`])).trim();
  const args = ["commit-tree", tree, "-m", message];
  if (parent) args.push("-p", parent);
  return (await git.run(repoRoot, args)).trim();
}

/** Ветка копии на GitHub всегда main: репозиторий существует ради одной сборки. */
async function pushSnapshot(sourceRoot, commit, url, token) {
  const repoRoot = path.resolve(sourceRoot, "..");
  await git.run(repoRoot, ["push", url, `${commit}:refs/heads/main`, "--force"], {
    timeout: 300_000,
    token,
    tokenUser: "x-access-token",
  });
}

/** Файлы, которые делают копию именно этой копией. */
async function copyConfigFiles(copy, { publicKey = "" } = {}) {
  const blueprint = blueprints.normalize(copies.toBlueprint(copy));
  const { prices, problems } = demoAccess.parsePrices(copy.pricesText);
  const files = [
    {
      path: "plugins.json",
      content: JSON.stringify(blueprints.toConfig(blueprint), null, 2),
      message: `Конфигурация копии: ${copy.displayName}`,
    },
  ];

  if (copy.apiKey) {
    files.push({
      path: "managed-config.json",
      content: JSON.stringify(
        { apiKey: copy.apiKey, baseUrl: copy.baseUrl, model: copy.model, currency: copy.currency, prices },
        null,
        2
      ),
      message: "Ключ моделей этой копии",
    });
  }

  if (blueprint.demoGated) {
    if (!publicKey) throw new Error("Нет ключа подписи — создайте его во вкладке «Демо».");
    files.push({
      path: "licence-config.json",
      content: JSON.stringify(
        { publicKey, revocationUrl: copy.revocationUrl, productName: copy.displayName },
        null,
        2
      ),
      message: "Настройки активации копии",
    });
  }

  return { files, priceProblems: problems };
}

/**
 * Собирает копию в её репозитории на GitHub.
 *
 * Порядок: проверить исходники и токен → создать репозиторий, если его ещё нет
 * → положить туда снимок канонического кода → дописать конфигурацию копии и
 * рабочий процесс сборки → запустить сборку.
 */
async function publish(copy, { sourcePath, branch, token, publicKey = "", onLog = () => {} } = {}) {
  const log = (line) => onLog(String(line));
  const normalized = copies.normalize(copy);
  if (!token) throw new Error("Не задан токен GitHub — вкладка «Настройки».");

  log("Проверяю папку с исходниками «Личного чата»…");
  await buildPipeline.assertChatSources(sourcePath);
  await buildPipeline.switchToBranch(sourcePath, branch, log);

  const account = await github.testConnection(token);
  if (!account.ok) throw new Error(`GitHub не принял токен: ${account.error}`);
  const owner = account.login;
  log(`GitHub: ${owner}`);

  let repo = null;
  const existing = await github.listRepos(token).catch(() => []);
  repo = existing.find((r) => r.name === normalized.repoName) || null;
  if (repo) {
    log(`Репозиторий уже есть: ${repo.fullName} — обновляю его.`);
  } else {
    log(`Создаю закрытый репозиторий ${normalized.repoName}…`);
    repo = await github.createRepo(token, {
      name: normalized.repoName,
      description: `${normalized.displayName} — копия «Личного чата»`,
      private: true,
    });
  }

  const url = `https://github.com/${repo.fullName}.git`;
  log("Кладу код чата снимком в один коммит (без истории монорепозитория)…");
  const commit = await snapshotCommit(
    sourcePath,
    branch,
    `${normalized.displayName}: код от ${new Date().toLocaleDateString("ru-RU")}`
  );
  await pushSnapshot(sourcePath, commit, url, token);
  log("Код в репозитории.");

  const { files, priceProblems } = await copyConfigFiles(normalized, { publicKey });
  for (const problem of priceProblems) log(`Цены: ${problem}`);
  for (const file of files) {
    log(`Записываю ${file.path}…`);
    await github.commitFile(token, owner, repo.name, file.path, file.content, file.message, undefined, "main");
  }

  log("Записываю рабочий процесс сборки…");
  await github.commitFile(
    token,
    owner,
    repo.name,
    WORKFLOW_PATH,
    workflowYaml(normalized.displayName),
    "Сборка установщика этой копии",
    undefined,
    "main"
  );

  log("Запускаю сборку установщика на GitHub…");
  let started = false;
  try {
    await github.runWorkflow(token, owner, repo.name, WORKFLOW_FILE, "main");
    started = true;
  } catch (e) {
    // Только что созданный рабочий процесс иногда ещё не виден API. Он всё
    // равно запустится сам — файл кладётся push'ем в main.
    log(`Запустить вручную не удалось (${e.message}). Сборка стартует сама от записи файлов.`);
  }

  return {
    repo: repo.fullName,
    repoUrl: `https://github.com/${repo.fullName}`,
    actionsUrl: `https://github.com/${repo.fullName}/actions`,
    releaseUrl: `https://github.com/${repo.fullName}/releases/tag/latest`,
    started,
    files: files.map((f) => f.path),
  };
}

module.exports = { WORKFLOW_PATH, WORKFLOW_FILE, workflowYaml, snapshotCommit, copyConfigFiles, publish };
