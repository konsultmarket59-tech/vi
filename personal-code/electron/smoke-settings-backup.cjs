// Настройки переживают переустановку приложения:
//   xvfb-run -a npx electron electron/smoke-settings-backup.cjs
//
// Ключ Polza, токен GitHub и прокси лежали только в служебной папке приложения.
// Её сносит переустановка «начисто» и переезд на другой компьютер — и человек
// вводил всё заново, хотя плагины и копии в папке с данными при этом
// оставались на месте. Здесь проверяется вторая копия рядом с данными: она
// пишется при каждом сохранении и читается на пустом месте — но не поверх уже
// заполненных настроек, иначе старый файл побеждал бы свежую настройку.

const { app } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const settingsStore = require("./settings.cjs");

const docs = fs.mkdtempSync(path.join(os.tmpdir(), "code-docs-"));
const first = fs.mkdtempSync(path.join(os.tmpdir(), "code-ud1-"));
const second = fs.mkdtempSync(path.join(os.tmpdir(), "code-ud2-"));
const third = fs.mkdtempSync(path.join(os.tmpdir(), "code-ud3-"));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
  }
}

function cleanup() {
  for (const dir of [docs, first, second, third]) fs.rmSync(dir, { recursive: true, force: true });
}

app.setPath("documents", docs);
app.setPath("userData", first);

app.whenReady().then(async () => {
  try {
    console.log("настройки сохраняются рядом с данными");
    settingsStore.init();
    const saved = await settingsStore.save({
      apiKey: "ключ-пользы",
      gitToken: "токен-гитхаба",
      proxyMode: "manual",
      proxyUrl: "http://proxy.local:8080",
      proxyUsername: "логин",
      proxyPassword: "пароль",
      sourceRepo: "владелец/репозиторий",
      sourceBranch: "проверочная",
    });
    check("сохранение вернуло то, что дали", saved.apiKey === "ключ-пользы");

    const backup = path.join(docs, "Личный код", "настройки.json");
    check("копия настроек появилась в папке с данными", fs.existsSync(backup), backup);
    const stored = JSON.parse(fs.readFileSync(backup, "utf-8"));
    check("в копии есть ключ Polza", stored.settings.apiKey === "ключ-пользы");
    check("и токен GitHub", stored.settings.gitToken === "токен-гитхаба");
    check("и настройки прокси целиком", stored.settings.proxyUrl === "http://proxy.local:8080");
    check("и логин с паролем прокси", stored.settings.proxyPassword === "пароль");

    console.log("\nпереустановка: служебная папка пуста, настройки на месте");
    app.setPath("userData", second);
    settingsStore.init();
    const before = await settingsStore.load();
    check("на чистом месте настроек ещё нет", before.apiKey === "");
    const restored = await settingsStore.restoreFromBackup();
    check("восстановление сработало", !!restored, String(restored));
    const after = await settingsStore.load();
    check("ключ Polza вернулся", after.apiKey === "ключ-пользы");
    check("токен GitHub вернулся", after.gitToken === "токен-гитхаба");
    check("прокси вернулся целиком", after.proxyMode === "manual" && after.proxyUrl === "http://proxy.local:8080");
    check("репозиторий с исходниками вернулся", after.sourceRepo === "владелец/репозиторий");
    check("и ветка, из которой собираются копии", after.sourceBranch === "проверочная", after.sourceBranch);

    console.log("\nсвежие настройки старая копия не затирает");
    app.setPath("userData", third);
    settingsStore.init();
    await settingsStore.save({ apiKey: "новый-ключ" });
    const skipped = await settingsStore.restoreFromBackup();
    check("восстановление не тронуло заполненные настройки", skipped === null);
    check("остался новый ключ", (await settingsStore.load()).apiKey === "новый-ключ");
    check(
      "а копия обновилась под него",
      JSON.parse(fs.readFileSync(path.join(docs, "Личный код", "настройки.json"), "utf-8")).settings.apiKey ===
        "новый-ключ"
    );

    console.log("\nперенесённая папка с данными находится и на чистом месте");
    const moved = fs.mkdtempSync(path.join(os.tmpdir(), "code-data-"));
    await settingsStore.save({ dataRoot: moved, apiKey: "ключ-из-перенесённой-папки" });
    check(
      "копия настроек лежит в выбранной папке",
      fs.existsSync(path.join(moved, "Личный код", "настройки.json"))
    );
    check(
      "в «Документах» остался указатель на неё",
      fs.readFileSync(path.join(docs, "Личный код", "папка-с-данными.txt"), "utf-8").trim() === moved
    );

    const fourth = fs.mkdtempSync(path.join(os.tmpdir(), "code-ud4-"));
    app.setPath("userData", fourth);
    settingsStore.init();
    check("восстановление нашло перенесённую папку", !!(await settingsStore.restoreFromBackup()));
    check(
      "и вернуло настройки из неё",
      (await settingsStore.load()).apiKey === "ключ-из-перенесённой-папки"
    );
    fs.rmSync(fourth, { recursive: true, force: true });
    fs.rmSync(moved, { recursive: true, force: true });
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  }
});
