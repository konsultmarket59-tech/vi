// Архив плагинов: версии, обновление против отдельного плагина, выгрузка в сборку.
//   node electron/smoke-plugin-archive.cjs

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const archive = require("./pluginArchive.cjs");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-archive-"));
const chatDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-chat-"));
const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-source-"));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  for (const dir of [home, chatDir, sourceDir]) fs.rmSync(dir, { recursive: true, force: true });
}

const skill = (name, content) => ({ name, description: `описание ${name}`, content });

(async () => {
  archive.init(home);

  console.log("\nсоздание");
  const first = await archive.addVersion({
    name: "Договоры",
    description: "Работа с документами",
    note: "первая версия",
    skills: [skill("Акты", "текст про акты")],
  });
  check("плагин создан первой версией", first.version === 1, JSON.stringify(first));

  let plugins = await archive.list();
  check("плагин виден в архиве", plugins.length === 1 && plugins[0].name === "Договоры", JSON.stringify(plugins));
  check("последняя версия — первая", plugins[0].latest === 1);

  console.log("\nобновление до новой версии");
  const second = await archive.addVersion({
    pluginId: plugins[0].id,
    note: "добавлены ТЗ",
    skills: [skill("Акты", "текст про акты, версия 2"), skill("ТЗ", "текст про ТЗ")],
  });
  check("версия увеличилась", second.version === 2, JSON.stringify(second));

  plugins = await archive.list();
  check("плагин остался один", plugins.length === 1, String(plugins.length));
  check("версий стало две", plugins[0].versions.length === 2);
  check("старая версия на месте", plugins[0].versions.some((v) => v.version === 1 && v.skills === 1));
  check("в новой версии два навыка", plugins[0].versions.find((v) => v.version === 2).skills === 2);
  check("подпись версии сохранена", plugins[0].versions[0].note === "добавлены ТЗ", plugins[0].versions[0].note);

  console.log("\nсохранение отдельным плагином");
  const separate = await archive.addVersion({ name: "Договоры", skills: [skill("Иное", "другой текст")] });
  plugins = await archive.list();
  check("одинаковое название не перезаписывает существующий", plugins.length === 2, JSON.stringify(plugins.map((p) => p.id)));
  check("новому плагину дан свой id", separate.id !== first.id, `${separate.id} / ${first.id}`);
  check("у отдельного плагина своя первая версия", separate.version === 1);

  console.log("\nисходники копируются, а не запоминаются ссылкой");
  fs.writeFileSync(path.join(sourceDir, "module.cjs"), "// код плагина");
  const withSource = await archive.addVersion({
    name: "Модуль",
    skills: [skill("Навык модуля", "текст")],
    sourcePaths: [path.join(sourceDir, "module.cjs")],
  });
  check("исходник скопирован", fs.existsSync(path.join(withSource.dir, "source", "module.cjs")));
  fs.rmSync(sourceDir, { recursive: true, force: true });
  check(
    "копия переживает исчезновение оригинала",
    fs.readFileSync(path.join(withSource.dir, "source", "module.cjs"), "utf-8") === "// код плагина"
  );

  console.log("\nвыгрузка в сборку");
  plugins = await archive.list();
  const dogovory = plugins.find((p) => p.name === "Договоры" && p.versions.length === 2);
  const exported = await archive.exportToBuild(chatDir, [{ id: dogovory.id, version: 2 }]);
  const bundled = fs.readdirSync(exported.targetDir);
  check("навыки выбранной версии выгружены", bundled.length === 2, bundled.join(","));
  check("имя файла содержит id плагина", bundled.every((f) => f.startsWith(dogovory.id + "--")), bundled.join(","));
  const written = bundled.map((f) => JSON.parse(fs.readFileSync(path.join(exported.targetDir, f), "utf-8")));
  const acts = written.find((s) => s.name === "Акты");
  check("выгружена именно вторая версия навыка", acts?.content.includes("версия 2"), JSON.stringify(written.map((s) => s.name)));
  check("второй навык версии тоже на месте", written.some((s) => s.name === "ТЗ"));

  // Повторная выгрузка с другим набором должна убрать прежние навыки.
  const again = await archive.exportToBuild(chatDir, [{ id: dogovory.id, version: 1 }]);
  const afterAgain = fs.readdirSync(again.targetDir);
  check("папка пересобирается целиком", afterAgain.length === 1, afterAgain.join(","));
  const v1 = JSON.parse(fs.readFileSync(path.join(again.targetDir, afterAgain[0]), "utf-8"));
  check("осталась именно первая версия", !v1.content.includes("версия 2"), v1.content);

  const empty = await archive.exportToBuild(chatDir, []);
  check("пустой выбор очищает папку", fs.readdirSync(empty.targetDir).length === 0);

  console.log("\nветка, в которой живёт код плагина");
  // Плагин пишется в конкретной ветке репозитория и сливается обратно в неё же.
  // Архив это запоминает: иначе через полгода не ответить, откуда версия.
  const branched = await archive.addVersion({
    name: "Отчёты ОРД",
    description: "Акты и статистика",
    branch: "claude/personal-claude-chat-docs-untwa4",
    commit: "abc1234",
    skills: [{ name: "Акт по маркировке", description: "Заполняет акт", content: "Правила…" }],
  });
  check("ветка сохранена вместе с версией", branched.branch === "claude/personal-claude-chat-docs-untwa4", branched.branch);

  let listed = await archive.list();
  const reports = listed.find((p) => p.id === branched.id);
  check("ветка видна в списке плагинов", reports.branch === "claude/personal-claude-chat-docs-untwa4", reports.branch);
  check("ветка и коммит видны у версии", reports.versions[0].commit === "abc1234", JSON.stringify(reports.versions[0]));

  // Следующая версия того же плагина остаётся в той же ветке, даже если про неё
  // не напомнили: иначе доработка тихо уехала бы в другую конфигурацию.
  const next = await archive.addVersion({
    pluginId: branched.id,
    note: "поправлены формулировки",
    skills: [{ name: "Акт по маркировке", description: "Заполняет акт", content: "Правила, версия 2…" }],
  });
  check("новая версия наследует ветку плагина", next.branch === "claude/personal-claude-chat-docs-untwa4", next.branch);

  console.log("\nудаление");
  await archive.removePlugin(dogovory.id);
  plugins = await archive.list();
  check("плагин удалён со всеми версиями", !plugins.some((p) => p.id === dogovory.id), JSON.stringify(plugins.map((p) => p.id)));

  let threw = false;
  try {
    await archive.removePlugin("нет-такого");
  } catch {
    threw = true;
  }
  check("удаление несуществующего — ошибка, а не молчание", threw);

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Тест упал:", e);
  cleanup();
  process.exit(1);
});
