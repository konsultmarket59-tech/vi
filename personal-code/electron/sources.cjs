// Канонический «Личный чат» — прямо с GitHub, без папки на компьютере.
//
// Раньше сборка копии требовала, чтобы у автора лежала папка с исходниками
// монорепозитория, и без неё кнопка «Собрать» просто отказывалась работать.
// На компьютере с одним лишь установленным приложением такой папки нет и
// взяться ей неоткуда, а канонический код всё это время лежит в репозитории.
// Здесь приложение забирает его само и держит рабочую копию у себя.
//
// Копия «тонкая» намеренно: в монорепозитории лежат музыка и видеоматериалы
// (около 170 МБ), а для сборки чата нужна одна папка personal-chat (около 2 МБ).
// Поэтому клон делается неглубоким (--depth 1), без файловых объектов
// (--filter=blob:none) и с выборочной выкладкой только нужной папки (--sparse):
// скачивается ровно то, что уезжает в репозиторий копии.
//
// Эта папка принадлежит приложению, а не человеку: она обновляется до
// канонической ветки принудительно. Свои правки автор ведёт в рабочей папке
// вкладки «Код», а не здесь.

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");

const git = require("./git.cjs");

/** Репозиторий, где живёт канонический «Личный чат». */
const DEFAULT_SOURCE_REPO = "konsultmarket59-tech/vi";
/** Папка чата внутри репозитория — именно она уезжает в копию. */
const CHAT_DIR = "personal-chat";

const CLONE_TIMEOUT = 600_000;

/**
 * owner/repo → адрес; заодно ловит опечатку до того, как её увидит git.
 *
 * Готовый адрес пропускается как есть: обычная запись — «владелец/репозиторий»,
 * но приложение не обязано отказывать тому, у кого код лежит не на github.com.
 */
function repoUrl(repo) {
  const raw = String(repo || "").trim();
  if (/^(https?|file|ssh|git):\/\//i.test(raw)) {
    const name = raw.replace(/\.git$/i, "").split("/").slice(-2).join("/");
    return { name, url: raw };
  }
  const name = raw.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) {
    throw new Error(`«${repo}» не похоже на репозиторий GitHub. Ожидается вид «владелец/репозиторий».`);
  }
  return { name, url: `https://github.com/${name}.git` };
}

async function currentOrigin(dir) {
  try {
    return (await git.run(dir, ["remote", "get-url", "origin"])).trim();
  } catch {
    return "";
  }
}

/**
 * Готовит локальную копию канонического кода и возвращает путь к папке чата —
 * тот самый, который раньше выбирался руками.
 *
 * `token` нужен, потому что репозиторий закрытый: без него git спросил бы логин
 * у пустого терминала и завис бы, чего ждать никто не станет.
 */
async function ensure(mirrorDir, { repo = DEFAULT_SOURCE_REPO, branch, token = "", onLog = () => {} } = {}) {
  const log = (line) => onLog(String(line));
  if (!branch) throw new Error("Не указана каноническая ветка «Личного чата».");
  const { name, url } = repoUrl(repo);
  // Имя папки — из имени репозитория, но только из безопасных символов: адрес
  // приходит из настроек, и превращать его в путь как есть нельзя.
  const dir = path.join(mirrorDir, name.replace(/[^\w.-]+/g, "-") || "источник");
  const auth = { timeout: CLONE_TIMEOUT, token, tokenUser: "x-access-token" };

  // Сменился репозиторий — старая папка не про него; чинить её сложнее, чем завести заново.
  if (fsSync.existsSync(path.join(dir, ".git")) && (await currentOrigin(dir)) !== url) {
    log("Репозиторий с кодом изменился — забираю его заново.");
    await fs.rm(dir, { recursive: true, force: true });
  }

  if (!fsSync.existsSync(path.join(dir, ".git"))) {
    log(`Скачиваю канонический код из ${name} (ветка ${branch})…`);
    await fs.mkdir(mirrorDir, { recursive: true });
    await fs.rm(dir, { recursive: true, force: true });
    await git.run(
      mirrorDir,
      ["clone", "--depth", "1", "--single-branch", "--branch", branch, "--filter=blob:none", "--sparse", url, dir],
      auth
    );
    // Без этого в папку выложился бы весь репозиторий, включая музыку и видео.
    await git.run(dir, ["sparse-checkout", "set", CHAT_DIR], auth);
  } else {
    log(`Обновляю канонический код из ${name} (ветка ${branch})…`);
    await git.run(dir, ["fetch", "--depth", "1", "origin", branch], auth);
    // Папка принадлежит приложению: приводим её к канонической ветке целиком,
    // не спрашивая — своих правок здесь быть не должно.
    await git.run(dir, ["checkout", "-B", branch, "FETCH_HEAD", "--force"], auth);
    await git.run(dir, ["reset", "--hard", "FETCH_HEAD"], auth);
    await git.run(dir, ["sparse-checkout", "set", CHAT_DIR], auth);
  }

  const chatPath = path.join(dir, CHAT_DIR);
  if (!fsSync.existsSync(path.join(chatPath, "package.json"))) {
    throw new Error(
      `В ветке «${branch}» репозитория ${name} нет папки ${CHAT_DIR} — проверьте, та ли это ветка.`
    );
  }
  const head = (await git.run(dir, ["rev-parse", "--short", "HEAD"])).trim();
  log(`Код на месте: ${name}@${branch} (${head}).`);
  return { path: chatPath, repo: name, branch, head };
}

module.exports = { DEFAULT_SOURCE_REPO, CHAT_DIR, repoUrl, ensure };
