// Backend smoke test: exercises workspace, git and the agent's parsing/diffing
// against a real temporary git repository. Run with: node electron/smoke-backend.cjs
// Nothing here needs Electron.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const workspace = require("./workspace.cjs");
const git = require("./git.cjs");
const agent = require("./agent.cjs");
const blueprints = require("./blueprints.cjs");
const demoAccess = require("./demoAccess.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-smoke-"));

function writeSample(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf-8");
}

(async () => {
  console.log("Папка теста:", root);

  writeSample(
    "src/app.js",
    ["function greet(name) {", "  return `Привет, ${name}`;", "}", "", "module.exports = { greet };", ""].join("\n")
  );
  writeSample("src/util.js", "export const sum = (a, b) => a + b;\n");
  writeSample("README.md", "# Пример\n\nТестовый проект.\n");
  writeSample("node_modules/junk/index.js", "// should never be listed\n");
  writeSample("dist/bundle.js", "// build output\n");
  fs.writeFileSync(path.join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));

  console.log("\nworkspace");
  const { tree, truncated } = await workspace.tree(root);
  const names = tree.map((n) => n.name);
  check("папка node_modules не попадает в дерево", !names.includes("node_modules"));
  check("папка dist не попадает в дерево", !names.includes("dist"));
  check("src и README видны", names.includes("src") && names.includes("README.md"), names.join(","));
  check("дерево не обрезано", truncated === false);

  const files = await workspace.listTextFiles(root);
  check("текстовые файлы перечислены", files.includes("src/app.js") && files.includes("README.md"), files.join(","));
  check("png не считается текстом", !files.includes("logo.png"));

  const read = await workspace.readFile(root, "src/app.js");
  check("файл прочитан", read.content.includes("Привет"));
  check("язык определён", read.language === "javascript", read.language);

  await expectThrows("выход за пределы папки запрещён", () => workspace.readFile(root, "../../etc/passwd"), /выходит за пределы/);
  await expectThrows("абсолютный путь тоже не выпускает", () => workspace.readFile(root, "/etc/passwd"), /выходит за пределы|не найден|ENOENT/);
  await expectThrows("двоичный файл не открывается как текст", () => workspace.readFile(root, "logo.png"), /двоичный/);

  // Ссылка внутри папки — обход границы, который «..» не ловит: путь остаётся
  // внутри, а открывается то, на что ссылка показывает.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "personal-code-outside-"));
  fs.writeFileSync(path.join(outside, "secret.txt"), "чужие данные\n", "utf-8");
  let linksSupported = true;
  try {
    fs.symlinkSync(outside, path.join(root, "ссылка"), "dir");
  } catch {
    linksSupported = false; // Windows без прав на создание ссылок
  }
  if (linksSupported) {
    await expectThrows(
      "чтение через ссылку наружу отклоняется",
      () => workspace.readFile(root, "ссылка/secret.txt"),
      /за пределы/
    );
    await expectThrows(
      "запись через ссылку наружу отклоняется",
      () => workspace.writeFile(root, "ссылка/подсунуто.txt", "нет"),
      /за пределы/
    );
    check("файл за ссылкой не изменён", !fs.existsSync(path.join(outside, "подсунуто.txt")));
    fs.unlinkSync(path.join(root, "ссылка"));
  }
  fs.rmSync(outside, { recursive: true, force: true });

  const found = await workspace.search(root, "greet");
  check("поиск находит совпадения", found.matches.some((m) => m.path === "src/app.js"), JSON.stringify(found.matches));
  const noHits = await workspace.search(root, "этого-точно-нет");
  check("поиск без совпадений возвращает пусто", noHits.matches.length === 0);

  console.log("\ngit");
  check("до init репозитория нет", git.isRepo(root) === false);
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root, stdio: "ignore" });
  check("после init репозиторий виден", git.isRepo(root) === true);

  let status = await git.status(root);
  check("новые файлы видны как untracked", status.files.some((f) => f.path === "src/app.js" && f.untracked), JSON.stringify(status.files));
  check("пустой лог не падает", (await git.log(root)).length === 0);

  await git.stageAll(root);
  status = await git.status(root);
  check("после add файлы проиндексированы", status.files.every((f) => f.staged));

  await git.commit(root, "Первый коммит", { userName: "Test", userEmail: "test@example.com" });
  status = await git.status(root);
  check("после коммита рабочая копия чистая", status.files.length === 0, JSON.stringify(status.files));
  const log = await git.log(root);
  check("коммит попал в лог", log.length === 1 && log[0].subject === "Первый коммит", JSON.stringify(log));

  await expectThrows("пустое сообщение коммита отклоняется", () => git.commit(root, "   "), /Пустое сообщение/);

  // A message with shell metacharacters must land verbatim, not be interpreted.
  writeSample("src/util.js", "export const sum = (a, b) => a + b; // touched\n");
  await git.stageAll(root);
  const nasty = 'fix: $(whoami) & `id` ; rm -rf /';
  await git.commit(root, nasty, { userName: "Test", userEmail: "test@example.com" });
  const log2 = await git.log(root);
  check("сообщение коммита не интерпретируется оболочкой", log2[0].subject === nasty, log2[0].subject);

  const branch = await git.createBranch(root, "feature/test");
  check("ветка создана и активна", branch.branch === "feature/test", branch.branch);

  console.log("\nagent: разбор инструментов");
  const toolCalls = agent.parseToolBlock("Посмотрю файл.\n===TOOL===\nREAD: src/app.js\nSEARCH: greet\n===END TOOL===");
  check("блок инструментов разобран", toolCalls?.length === 2, JSON.stringify(toolCalls));
  check("обычный текст не считается инструментом", agent.parseToolBlock("просто ответ") === null);

  const toolOutput = await agent.runReadTools(root, "===TOOL===\nREAD: src/app.js\nGIT: status\n===END TOOL===");
  check("READ вернул содержимое", toolOutput.includes("Привет"));
  check("GIT status отработал", toolOutput.includes("feature/test"), toolOutput.slice(0, 200));

  const badTool = await agent.runReadTools(root, "===TOOL===\nREAD: ../../secret\n===END TOOL===");
  check("выход за пределы в инструменте — ошибка в тексте, не падение", badTool.includes("выходит за пределы"), badTool);

  console.log("\nagent: правки");
  const replaceBlock = [
    "===CODE EDIT START===",
    "FILE: src/app.js",
    "ACTION: replace",
    "<<<<<<< НАЙТИ",
    "  return `Привет, ${name}`;",
    "=======",
    "  return `Здравствуйте, ${name}`;",
    ">>>>>>> ЗАМЕНИТЬ",
    "===CODE EDIT END===",
  ].join("\n");
  const proposal = await agent.buildProposal(root, replaceBlock);
  check("правка разобрана", proposal?.files.length === 1, JSON.stringify(proposal));
  check("после правки текст заменён", proposal.files[0].after.includes("Здравствуйте"), proposal.files[0].after);
  check("исходный файл ещё не тронут", fs.readFileSync(path.join(root, "src/app.js"), "utf-8").includes("Привет"));
  check(
    "дифф показывает одну добавленную и одну удалённую строку",
    proposal.files[0].diff.filter((r) => r.type === "add").length === 1 &&
      proposal.files[0].diff.filter((r) => r.type === "del").length === 1,
    JSON.stringify(proposal.files[0].diff)
  );

  await agent.applyProposal(root, proposal);
  check("после применения файл изменён", fs.readFileSync(path.join(root, "src/app.js"), "utf-8").includes("Здравствуйте"));

  await expectThrows(
    "несовпадающий фрагмент отклоняется",
    () =>
      agent.buildProposal(
        root,
        "===CODE EDIT START===\nFILE: src/app.js\nACTION: replace\n<<<<<<< НАЙТИ\nэтого текста нет\n=======\nновое\n>>>>>>> ЗАМЕНИТЬ\n===CODE EDIT END==="
      ),
    /не найден фрагмент/
  );

  writeSample("src/dup.js", "const x = 1;\nconst y = 2;\nconst x = 1;\n");
  await expectThrows(
    "неуникальный фрагмент отклоняется",
    () =>
      agent.buildProposal(
        root,
        "===CODE EDIT START===\nFILE: src/dup.js\nACTION: replace\n<<<<<<< НАЙТИ\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> ЗАМЕНИТЬ\n===CODE EDIT END==="
      ),
    /встречается 2 раза/
  );

  const writeProposal = await agent.buildProposal(
    root,
    [
      "===CODE EDIT START===",
      "FILE: src/new.js",
      "ACTION: write",
      "===CONTENT===",
      "export const answer = 42;",
      "===END CONTENT===",
      "===CODE EDIT END===",
    ].join("\n")
  );
  check("новый файл помечен как новый", writeProposal.files[0].isNew === true);
  await agent.applyProposal(root, writeProposal);
  check("новый файл создан", fs.existsSync(path.join(root, "src/new.js")));

  const multi = await agent.buildProposal(
    root,
    [
      "===CODE EDIT START===",
      "FILE: src/new.js",
      "ACTION: rename",
      "TO: src/answer.js",
      "FILE: src/dup.js",
      "ACTION: delete",
      "===CODE EDIT END===",
    ].join("\n")
  );
  check("несколько операций в одном блоке", multi.files.length === 2, JSON.stringify(multi.files.map((f) => f.action)));
  await agent.applyProposal(root, multi);
  check("файл переименован", fs.existsSync(path.join(root, "src/answer.js")) && !fs.existsSync(path.join(root, "src/new.js")));
  check("файл удалён", !fs.existsSync(path.join(root, "src/dup.js")));

  await expectThrows(
    "правка вне папки проекта отклоняется",
    () =>
      agent.buildProposal(
        root,
        "===CODE EDIT START===\nFILE: ../../evil.js\nACTION: write\n===CONTENT===\nx\n===END CONTENT===\n===CODE EDIT END==="
      ),
    /выходит за пределы/
  );

  // Правка показывается человеку и применяется отдельным действием. За это время
  // файл на диске мог измениться — тогда «после» из предпросмотра затёрло бы
  // чужую правку целиком.
  writeSample("src/stale.js", "const a = 1;\n");
  const staleProposal = await agent.buildProposal(
    root,
    [
      "===CODE EDIT START===",
      "FILE: src/stale.js",
      "ACTION: replace",
      "<<<<<<< НАЙТИ",
      "const a = 1;",
      "=======",
      "const a = 2;",
      ">>>>>>> ЗАМЕНИТЬ",
      "===CODE EDIT END===",
    ].join("\n")
  );
  writeSample("src/stale.js", "const a = 1;\nconst b = 3; // правка человека\n");
  await expectThrows(
    "устаревшая правка не применяется",
    () => agent.applyProposal(root, staleProposal),
    /изменился на диске/
  );
  check(
    "правка человека на месте",
    fs.readFileSync(path.join(root, "src/stale.js"), "utf-8").includes("правка человека")
  );

  // И то же самое для блока из нескольких файлов: один устаревший файл не должен
  // оставить проект применённым наполовину.
  writeSample("src/first.js", "const first = 1;\n");
  writeSample("src/second.js", "const second = 1;\n");
  const pair = await agent.buildProposal(
    root,
    [
      "===CODE EDIT START===",
      "FILE: src/first.js",
      "ACTION: replace",
      "<<<<<<< НАЙТИ",
      "const first = 1;",
      "=======",
      "const first = 2;",
      ">>>>>>> ЗАМЕНИТЬ",
      "FILE: src/second.js",
      "ACTION: replace",
      "<<<<<<< НАЙТИ",
      "const second = 1;",
      "=======",
      "const second = 2;",
      ">>>>>>> ЗАМЕНИТЬ",
      "===CODE EDIT END===",
    ].join("\n")
  );
  writeSample("src/second.js", "const second = 99;\n");
  await expectThrows("блок с устаревшим файлом отклоняется целиком", () => agent.applyProposal(root, pair), /изменился/);
  check(
    "первый файл не тронут",
    fs.readFileSync(path.join(root, "src/first.js"), "utf-8") === "const first = 1;\n",
    fs.readFileSync(path.join(root, "src/first.js"), "utf-8")
  );

  console.log("\nagent: команды");
  const command = agent.parseRunBlock("Запусти тесты.\n===RUN START===\nnode -e \"console.log(1+1)\"\n===RUN END===");
  check("команда разобрана", command?.command === 'node -e "console.log(1+1)"', JSON.stringify(command));
  const result = await agent.runCommand(root, 'node -e "console.log(40+2)"');
  check("команда выполнена, вывод получен", result.ok && result.output.includes("42"), JSON.stringify(result));
  const failed = await agent.runCommand(root, "node -e \"process.exit(3)\"");
  check("ненулевой код возврата виден", failed.ok === false && failed.code === 3, JSON.stringify(failed));

  console.log("\nblueprints");
  const { all, saved } = blueprints.save([], { name: "Только тексты", productName: "Тексты", modules: ["word", "skills"] });
  check("сборка сохранена", all.length === 1 && saved.name === "Только тексты");
  check("ядро добавляется само", saved.modules.includes("projects"), saved.modules.join(","));
  const config = blueprints.toConfig(saved);
  check("в конфиге включены выбранные модули", config.modules.word === true && config.modules.skills === true);
  check("в конфиге выключены остальные", config.modules.excel === false && config.modules.direct === false);
  const exported = await blueprints.exportTo(saved, path.join(root, "export"));
  check("plugins.json записан", fs.existsSync(exported.file));
  const parsed = JSON.parse(fs.readFileSync(exported.file, "utf-8"));
  check("записанный конфиг читается", parsed.productName === "Тексты" && parsed.modules.word === true);

  console.log("\nдемо-доступ: таблица цен");
  // Цену пишут по-русски, с запятой. Если считать запятую разделителем колонок,
  // «300,5 1500» превращается в «300» и «5» — и расход показывается втрое-в-сотни
  // раз меньше настоящего, молча.
  const decimal = demoAccess.parsePrices("модель 300,5 1500");
  check(
    "десятичная запятая — это цена, а не разделитель",
    decimal.prices["модель"]?.input === 300.5 && decimal.prices["модель"]?.output === 1500,
    JSON.stringify(decimal)
  );
  const spaced = demoAccess.parsePrices("модель 300 1500");
  check("пробелы по-прежнему разделяют", spaced.prices["модель"]?.output === 1500, JSON.stringify(spaced));
  const csv = demoAccess.parsePrices("модель,300,1500");
  check("запятые как разделители тоже понимаются", csv.prices["модель"]?.output === 1500, JSON.stringify(csv));
  const spacedCsv = demoAccess.parsePrices("модель, 300, 1500");
  check("запятая с пробелом — тоже разделитель", spacedCsv.prices["модель"]?.output === 1500, JSON.stringify(spacedCsv));
  const broken = demoAccess.parsePrices("модель 300");
  check("неполная строка объясняется, а не молчит", broken.problems.length === 1, JSON.stringify(broken));

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Тест упал:", e);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
