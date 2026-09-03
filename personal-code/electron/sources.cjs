// Канонический «Личный чат» — прямо с GitHub, без git и без папки на компьютере.
//
// Сначала сборка требовала папку с исходниками монорепозитория; потом код стал
// скачиваться сам, но через git — и на компьютере без установленного git всё
// останавливалось словами «Git не найден». Хотя весь нужный код лежит на
// GitHub, а не на компьютере, и GitHub умеет отдавать и принимать его сам.
//
// Поэтому снимок собирается через Git Data API: читаем дерево канонической
// ветки, берём из него только папку personal-chat, перекладываем файлы в
// репозиторий копии и ставим ветку main на новый коммит. Ни git, ни временных
// папок, ни истории монорепозитория — в копии оказывается ровно чат.
//
// Файлов там около сотни и меньше двух мегабайт: перекладывание занимает
// секунды и укладывается в любые лимиты GitHub.

const github = require("./github.cjs");

/** Репозиторий, где живёт канонический «Личный чат». */
const DEFAULT_SOURCE_REPO = "konsultmarket59-tech/vi";
/** Папка чата внутри репозитория — именно она уезжает в копию. */
const CHAT_DIR = "personal-chat";
/** Ветка копии всегда main: репозиторий существует ради одной сборки. */
const COPY_BRANCH = "main";

/** «владелец/репозиторий» → части; заодно ловит опечатку до похода в сеть. */
function splitRepo(repo) {
  const name = String(repo || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const [owner, shortName] = name.split("/");
  if (!owner || !shortName || name.split("/").length !== 2) {
    throw new Error(`«${repo}» не похоже на репозиторий GitHub. Ожидается вид «владелец/репозиторий».`);
  }
  return { owner, name: shortName, full: `${owner}/${shortName}` };
}

/**
 * Список файлов «Личного чата» в канонической ветке — с путями уже без
 * префикса personal-chat, такими, какими они лягут в репозиторий копии.
 */
async function canonicalFiles(token, { repo = DEFAULT_SOURCE_REPO, branch } = {}) {
  if (!branch) throw new Error("Не указана каноническая ветка «Личного чата».");
  const source = splitRepo(repo);
  let files;
  try {
    files = await github.listTree(token, source.owner, source.name, branch, CHAT_DIR);
  } catch (e) {
    throw new Error(
      `Не удалось прочитать ${source.full}, ветка ${branch}: ${e.message} ` +
        "Проверьте название репозитория и ветки в «Настройках» и права токена GitHub."
    );
  }
  if (!files.length) {
    throw new Error(
      `В ветке «${branch}» репозитория ${source.full} нет папки ${CHAT_DIR} — проверьте, та ли это ветка.`
    );
  }
  return { source, branch, files };
}

/**
 * Перекладывает эти файлы в репозиторий копии одним коммитом без родителя.
 *
 * Без родителя — намеренно: в копии лежит текущий код, а не история чужого
 * монорепозитория. Поэтому ветка ставится принудительно.
 */
async function publishSnapshot(token, { from, to, message, extraFiles = [], onLog = () => {} }) {
  const log = (line) => onLog(String(line));
  const target = splitRepo(to);
  const entries = [];
  let done = 0;
  let lastReport = 0;

  for (const file of from.files) {
    const content = await github.readBlob(token, from.source.owner, from.source.name, file.sha);
    const sha = await github.createBlob(token, target.owner, target.name, content);
    entries.push({ path: file.path, mode: file.mode, sha });
    done++;
    // Сотня файлов идёт секунды, но молчащее окно выглядит зависшим.
    if (done === from.files.length || done - lastReport >= 20) {
      log(`Перекладываю файлы чата: ${done} из ${from.files.length}…`);
      lastReport = done;
    }
  }

  // Конфигурация копии и рабочий процесс сборки едут тем же коммитом. Отдельными
  // коммитами каждый из них запускал бы на GitHub ещё одну сборку — пять
  // установщиков вместо одного.
  for (const file of extraFiles) {
    log(`Записываю ${file.path}…`);
    const sha = await github.createBlob(
      token,
      target.owner,
      target.name,
      Buffer.from(file.content, "utf-8").toString("base64")
    );
    entries.push({ path: file.path, mode: "100644", sha });
  }

  const tree = await github.createTree(token, target.owner, target.name, entries);
  const commit = await github.createCommit(token, target.owner, target.name, { message, tree, parents: [] });
  await github.setBranch(token, target.owner, target.name, COPY_BRANCH, commit, { force: true });
  return { commit, files: entries.length, branch: COPY_BRANCH, paths: entries.map((e) => e.path) };
}

module.exports = { DEFAULT_SOURCE_REPO, CHAT_DIR, COPY_BRANCH, splitRepo, canonicalFiles, publishSnapshot };
