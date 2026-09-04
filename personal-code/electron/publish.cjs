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

const git = require("./git.cjs");
const github = require("./github.cjs");
const blueprints = require("./blueprints.cjs");
const demoAccess = require("./demoAccess.cjs");
const copies = require("./copies.cjs");
const buildPipeline = require("./build.cjs");
const sources = require("./sources.cjs");

// Сборка установщика в репозитории копии. Файл кладётся туда же, где его ждёт
// GitHub, и собирает именно эту копию.
//
// Публикация в релизы делается отдельным шагом, а electron-builder запускается
// с `--publish never`: на CI он иначе пробует выложить сборку сам, требует
// GH_TOKEN и падает — после того, как установщик уже собран. Ровно это и
// случилось на первой настоящей сборке копии.
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
      - run: npm run build
      # --publish never обязателен: на CI electron-builder сам пытается выложить
      # сборку в релизы и падает без GH_TOKEN — уже после того, как установщик
      # собран. Публикуем ниже сами, своим шагом.
      - run: npx electron-builder --win --publish never
      # Установщик уже собран, и терять его из-за сбоя публикации нельзя:
      # артефакт остаётся скачиваемым со страницы запуска в любом случае.
      - name: Установщик как артефакт запуска
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ustanovshchik
          path: release/*.exe
          if-no-files-found: warn
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
 * Порядок: взять канонический код → создать репозиторий, если его ещё нет →
 * положить туда снимок кода → дописать конфигурацию копии и рабочий процесс
 * сборки → запустить сборку.
 *
 * Код по умолчанию берётся прямо из канонического репозитория на GitHub: папки
 * с исходниками на компьютере может не быть вовсе, и требовать её значило бы
 * запрещать сборку там, где установлено одно приложение. `sourcePath` остаётся
 * как осознанное исключение — собрать из папки, которую автор правит прямо
 * сейчас, ещё не отправив изменения в канонический репозиторий.
 */
async function publish(
  copy,
  { sourcePath = "", sourceRepo = "", branch, token, publicKey = "", onLog = () => {} } = {}
) {
  const log = (line) => onLog(String(line));
  const normalized = copies.normalize(copy);
  if (!token) throw new Error("Не задан токен GitHub — вкладка «Настройки».");

  // Токен проверяется первым: код тоже скачивается из закрытого репозитория, и
  // упасть на этом внятной ошибкой лучше, чем молчаливым отказом git.
  const account = await github.testConnection(token);
  if (!account.ok) throw new Error(`GitHub не принял токен: ${account.error}`);
  const owner = account.login;
  log(`GitHub: ${owner}`);

  // Код либо берётся с GitHub (обычный случай, git на компьютере не нужен),
  // либо из папки, которую автор правит прямо сейчас — тогда снимок собирает
  // локальный git, и без него этот путь честно не работает.
  let canonical = null;
  if (sourcePath) {
    log("Проверяю папку с исходниками «Личного чата»…");
    await buildPipeline.assertChatSources(sourcePath);
    await buildPipeline.switchToBranch(sourcePath, branch, log);
  } else {
    log(`Читаю канонический «Личный чат» с GitHub (ветка ${branch})…`);
    canonical = await sources.canonicalFiles(token, { repo: sourceRepo || sources.DEFAULT_SOURCE_REPO, branch });
    log(`Файлов в чате: ${canonical.files.length}.`);
  }

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

  const message = `${normalized.displayName}: код от ${new Date().toLocaleDateString("ru-RU")}`;
  const { files, priceProblems } = await copyConfigFiles(normalized, { publicKey });
  for (const problem of priceProblems) log(`Цены: ${problem}`);
  const extraFiles = [
    ...files,
    { path: WORKFLOW_PATH, content: workflowYaml(normalized.displayName) },
  ];

  log("Кладу код чата снимком в один коммит (без истории монорепозитория)…");
  let snapshot;
  if (canonical) {
    // Код, конфигурация копии и рабочий процесс — одним коммитом: каждый
    // отдельный коммит в main запускал бы на GitHub ещё одну сборку.
    snapshot = await sources.publishSnapshot(token, {
      from: canonical,
      to: repo.fullName,
      message,
      extraFiles,
      onLog: log,
    });
  } else {
    const commit = await snapshotCommit(sourcePath, branch, message);
    await pushSnapshot(sourcePath, commit, `https://github.com/${repo.fullName}.git`, token);
    for (const file of extraFiles) {
      log(`Записываю ${file.path}…`);
      await github.commitFile(
        token,
        owner,
        repo.name,
        file.path,
        file.content,
        file.message || "Настройки сборки этой копии",
        undefined,
        "main"
      );
    }
    snapshot = { commit, files: 0 };
  }
  log("Код в репозитории.");

  // Отдельно запускать сборку не нужно и вредно: рабочий процесс подписан на
  // push в main, а код копии как раз туда и уехал. Пока здесь стоял ещё и
  // ручной запуск, на каждую сборку заводилось два одинаковых прогона — они
  // занимали вдвое больше времени и оба выкладывали установщик в один и тот же
  // релиз, наперегонки.
  log("Сборка установщика запускается на GitHub от этого коммита.");
  const started = true;

  return {
    source: canonical ? `${canonical.source.full}@${canonical.branch}` : sourcePath,
    commit: snapshot.commit,
    repo: repo.fullName,
    repoUrl: `https://github.com/${repo.fullName}`,
    actionsUrl: `https://github.com/${repo.fullName}/actions`,
    releaseUrl: `https://github.com/${repo.fullName}/releases/tag/latest`,
    started,
    files: files.map((f) => f.path),
  };
}

module.exports = { WORKFLOW_PATH, WORKFLOW_FILE, workflowYaml, snapshotCommit, copyConfigFiles, publish };
