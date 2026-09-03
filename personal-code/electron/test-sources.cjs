// Канонический код берётся из GitHub, а не из папки на компьютере:
//   node electron/test-sources.cjs
//
// Проверяется на настоящем репозитории (локальном — чтобы тест не зависел от
// сети и от чужого токена): что скачивается только папка чата, что повторный
// запуск подтягивает новые коммиты, что смена репозитория не оставляет старый
// код и что из полученной папки собирается тот самый снимок, который уезжает
// в репозиторий копии.

const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const sources = require("./sources.cjs");
const git = require("./git.cjs");
const publish = require("./publish.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-sources-"));
const CANONICAL = "claude/personal-claude-chat-docs-untwa4";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
  }
}
async function expectThrows(label, fn, pattern) {
  try {
    await fn();
    failures++;
    console.log(`  FAIL ${label} — ожидалась ошибка, её не было`);
  } catch (e) {
    check(label, pattern ? pattern.test(e.message) : true, e.message);
  }
}

/** Размер папки целиком — без внешних команд, чтобы тест шёл и на Windows. */
function folderSize(dir) {
  let bytes = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += folderSize(full);
    else if (entry.isFile()) bytes += fs.statSync(full).size;
  }
  return bytes;
}

function run(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
}

/** Репозиторий, похожий на настоящий: папка чата и тяжёлые файлы рядом с ней. */
function makeUpstream(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "personal-chat", "electron"), { recursive: true });
  fs.mkdirSync(path.join(dir, "music"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "personal-chat", "package.json"),
    JSON.stringify({ name: "personal-chat", version: "1.0.0" }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "personal-chat", "electron", "main.cjs"), "// чат\n");
  // Тяжёлая часть монорепозитория: её быть в скачанной папке не должно.
  fs.writeFileSync(path.join(dir, "music", "track.wav"), Buffer.alloc(2 * 1024 * 1024, 7));
  fs.writeFileSync(path.join(dir, "personal-code.txt"), "другое приложение\n");

  run(dir, ["init", "-q", "-b", CANONICAL]);
  run(dir, ["config", "user.email", "test@example.com"]);
  run(dir, ["config", "user.name", "Тест"]);
  // Без этого локальный сервер откажет в неполном клоне (--filter).
  run(dir, ["config", "uploadpack.allowFilter", "true"]);
  run(dir, ["add", "-A"]);
  run(dir, ["commit", "-q", "-m", "первый коммит"]);
  return dir;
}

(async () => {
  const upstream = makeUpstream("канонический");
  const url = `file://${upstream}`;
  const mirror = path.join(root, "Исходники");
  const log = [];

  console.log("первое скачивание");
  const first = await sources.ensure(mirror, { repo: url, branch: CANONICAL, onLog: (l) => log.push(l) });
  check("вернулась папка чата", fs.existsSync(path.join(first.path, "package.json")), first.path);
  check(
    "это действительно «Личный чат»",
    JSON.parse(fs.readFileSync(path.join(first.path, "package.json"), "utf-8")).name === "personal-chat"
  );
  const mirrorRoot = path.dirname(first.path);
  check("тяжёлые папки монорепозитория не скачаны", !fs.existsSync(path.join(mirrorRoot, "music", "track.wav")));
  check(`скачано мало — ${Math.round(folderSize(mirrorRoot) / 1024)} КБ`, folderSize(mirrorRoot) < 4 * 1024 * 1024);
  check("шаги видны человеку", log.some((l) => /Скачиваю канонический код/.test(l)), log.join(" | "));

  console.log("\nповторный запуск подтягивает новое");
  fs.writeFileSync(path.join(upstream, "personal-chat", "electron", "main.cjs"), "// чат, версия 2\n");
  run(upstream, ["add", "-A"]);
  run(upstream, ["commit", "-q", "-m", "второй коммит"]);
  const second = await sources.ensure(mirror, { repo: url, branch: CANONICAL, onLog: () => {} });
  check(
    "код обновился до последнего коммита",
    fs.readFileSync(path.join(second.path, "electron", "main.cjs"), "utf-8").includes("версия 2")
  );
  check("папка та же, а не вторая рядом", second.path === first.path);
  check("вернулся коммит, из которого собран снимок", /^[0-9a-f]{7,}$/.test(second.head), second.head);

  console.log("\nиз скачанного собирается снимок для копии");
  const commit = await publish.snapshotCommit(second.path, CANONICAL, "снимок");
  const bare = path.join(root, "копия.git");
  run(root, ["init", "-q", "--bare", bare]);
  // Снимок должен уходить целиком: неполный клон не имеет права оставить
  // недостающие файлы на потом — в репозитории копии их взять будет негде.
  await git.run(path.dirname(second.path), ["push", bare, `${commit}:refs/heads/main`]);
  const files = run(root, ["-C", bare, "ls-tree", "--name-only", "-r", "main"]).split("\n");
  check("в снимке лежит чат", files.includes("package.json") && files.includes("electron/main.cjs"), files.join(", "));
  check("и ничего из остального монорепозитория", !files.some((f) => f.startsWith("music/")), files.join(", "));
  check(
    "в снимке свежая версия файла",
    run(root, ["-C", bare, "show", "main:electron/main.cjs"]).includes("версия 2")
  );

  console.log("\nошибки объясняются, а не молчат");
  await expectThrows(
    "чужая ветка — понятная ошибка",
    () => sources.ensure(path.join(root, "Исходники-2"), { repo: url, branch: "нет-такой-ветки", onLog: () => {} }),
    /ветк|branch|not found/i
  );
  await expectThrows(
    "мусор вместо репозитория — понятная ошибка",
    () => sources.ensure(path.join(root, "Исходники-3"), { repo: "просто текст", branch: CANONICAL }),
    /владелец\/репозиторий/
  );
  await expectThrows(
    "без ветки не начинаем",
    () => sources.ensure(mirror, { repo: url, branch: "" }),
    /каноническая ветка/
  );

  console.log("\nсмена репозитория не оставляет старый код");
  const other = makeUpstream("другой");
  fs.writeFileSync(path.join(other, "personal-chat", "метка.txt"), "другой источник\n");
  run(other, ["add", "-A"]);
  run(other, ["commit", "-q", "-m", "метка"]);
  // Тот же слог папки: важно, что содержимое заменяется, а не смешивается.
  const swapped = await sources.ensure(mirror, { repo: `file://${other}`, branch: CANONICAL, onLog: () => {} });
  check("код взят из нового репозитория", fs.existsSync(path.join(swapped.path, "метка.txt")));

  console.log("\nв репозитории без папки чата сборка не начнётся");
  const wrong = path.join(root, "без-чата");
  fs.mkdirSync(wrong, { recursive: true });
  fs.writeFileSync(path.join(wrong, "README.md"), "# пусто\n");
  run(wrong, ["init", "-q", "-b", CANONICAL]);
  run(wrong, ["config", "user.email", "test@example.com"]);
  run(wrong, ["config", "user.name", "Тест"]);
  run(wrong, ["config", "uploadpack.allowFilter", "true"]);
  run(wrong, ["add", "-A"]);
  run(wrong, ["commit", "-q", "-m", "пусто"]);
  await expectThrows(
    "нет папки personal-chat — говорим об этом прямо",
    () => sources.ensure(path.join(root, "Исходники-4"), { repo: `file://${wrong}`, branch: CANONICAL, onLog: () => {} }),
    /нет папки personal-chat/
  );

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Тест упал:", e);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
