// Сборка «Личного чата» одной кнопкой.
//
// До этого сборка была разложена по трём вкладкам: plugins.json писался в
// «Сборках», ключ и цены — в «Демо-доступе», навыки — в «Плагинах», а сам
// установщик собирался вручную в консоли. Порядок надо было помнить, и любой
// пропущенный шаг тихо уезжал в сборку: старый ключ, вчерашние навыки, не тот
// набор модулей.
//
// Здесь этот порядок записан один раз и целиком:
//
//   1. проверить папку исходников — это действительно «Личный чат»;
//   2. привести её к канонической ветке, если она указана;
//   3. записать plugins.json — из каких модулей собирается эта версия;
//   4. записать настройки демо-доступа и ключ моделей для этой копии;
//   5. пересобрать bundled-skills целиком — убранный навык должен исчезнуть;
//   6. запустить установщик и показать, что получилось.
//
// Каждый шаг рассказывает о себе в окно по мере выполнения: сборка идёт минуты,
// и молчащая полоса прогресса — худшее, что можно показать в это время.

const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { spawn } = require("node:child_process");

const blueprints = require("./blueprints.cjs");
const demoAccess = require("./demoAccess.cjs");
const pluginArchive = require("./pluginArchive.cjs");
const git = require("./git.cjs");

// Ветка, в которой лежит канонический код «Личного чата». Сборка идёт из неё,
// чтобы в установщик не уехало то, что кто-то оставил в рабочей копии.
const CANONICAL_BRANCH = "claude/personal-claude-chat-docs-untwa4";

/** Папка исходников — та самая, а не соседняя. */
async function assertChatSources(dir) {
  if (!dir) throw new Error("Не выбрана папка с исходниками «Личного чата».");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf-8"));
  } catch {
    throw new Error(`В папке «${dir}» нет package.json — это не папка с исходниками «Личного чата».`);
  }
  if (pkg.name !== "personal-chat") {
    throw new Error(
      `В папке «${dir}» лежит проект «${pkg.name || "без имени"}», а нужен personal-chat — папка «Личного чата».`
    );
  }
  return pkg;
}

/**
 * Переводит папку исходников на нужную ветку. Незакоммиченные правки не трогаем
 * и ничего не переключаем молча: чужая незавершённая работа дороже удобства.
 */
async function useBranch(dir, branch, log) {
  if (!branch) return { branch: "", switched: false };
  if (!git.isRepo(dir)) {
    log(`Папка не под git — собираю как есть, ветка «${branch}» не проверяется.`);
    return { branch: "", switched: false };
  }
  const status = await git.status(dir);
  if (status.branch === branch) {
    log(`Ветка уже нужная: ${branch}.`);
    return { branch, switched: false };
  }
  if (status.files.length) {
    throw new Error(
      `В папке исходников есть незакоммиченные изменения (${status.files.length}), ` +
        `а сборка должна идти из ветки «${branch}» (сейчас «${status.branch}»). ` +
        "Сохраните или отмените изменения во вкладке «Git» и запустите сборку заново."
    );
  }
  log(`Переключаю исходники с «${status.branch}» на «${branch}».`);
  await git.checkoutBranch(dir, branch);
  return { branch, switched: true };
}

/** Запускает команду в папке, отдавая вывод построчно по мере появления. */
function run(dir, command, args, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: dir,
      // npm на Windows — это npm.cmd, который запускается только через оболочку.
      shell: process.platform === "win32",
      env: { ...process.env, npm_config_yes: "true" },
    });
    let tail = "";
    const onData = (chunk) => {
      const text = String(chunk);
      tail = (tail + text).slice(-4000);
      for (const line of text.split("\n")) {
        const trimmed = line.trimEnd();
        if (trimmed) log(trimmed);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e) =>
      reject(new Error(`Не удалось запустить «${command}»: ${e.message}. Установлен ли Node.js?`))
    );
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`«${command} ${args.join(" ")}» завершилась с кодом ${code}.\n${tail.trim()}`));
    });
  });
}

/** Установщики, которые появились после сборки. */
async function builtInstallers(dir) {
  const releaseDir = path.join(dir, "release");
  const entries = await fs.readdir(releaseDir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(exe|appimage|dmg|zip)$/i.test(entry.name)) continue;
    const stat = await fs.stat(path.join(releaseDir, entry.name)).catch(() => null);
    if (stat) out.push({ name: entry.name, path: path.join(releaseDir, entry.name), bytes: stat.size });
  }
  out.sort((a, b) => b.bytes - a.bytes);
  return { releaseDir, installers: out };
}

/**
 * Собирает копию «Личного чата» по описанию сборки.
 *
 * onLog вызывается на каждой строке: и на своих шагах, и на выводе npm.
 * skipInstaller собирает всё, кроме самого установщика, — этим пользуются тесты
 * и это же полезно, когда нужно только обновить конфигурацию в исходниках.
 */
async function build(blueprint, { onLog = () => {}, skipInstaller = false } = {}) {
  const log = (line) => onLog(String(line));
  const normalized = blueprints.normalize(blueprint);
  const dir = normalized.sourcePath;

  log("Проверяю папку исходников…");
  await assertChatSources(dir);

  const branch = await useBranch(dir, normalized.branch, log);

  log("Записываю набор модулей (plugins.json)…");
  const modules = await blueprints.exportTo(normalized, dir);
  log(
    `Модулей включено: ${modules.enabledCount}` +
      (modules.disabled.length ? `, выключено: ${modules.disabled.join(", ")}` : "")
  );

  // Ключ моделей и цены — отдельный файл, лицензия — отдельный. Пустой ключ
  // означает «обычная сборка»: exportConfig сам уберёт старый managed-config.
  const { prices, problems } = demoAccess.parsePrices(normalized.pricesText);
  for (const problem of problems) log(`Цены: ${problem}`);

  let demo = null;
  if (normalized.demoGated) {
    log("Записываю настройки демо-доступа (licence-config.json)…");
    demo = await demoAccess.exportConfig(dir, {
      revocationUrl: normalized.revocationUrl,
      productName: normalized.productName,
      apiKey: normalized.apiKey,
      baseUrl: normalized.baseUrl,
      model: normalized.model,
      prices,
      currency: normalized.currency,
    });
    log(
      demo.managed
        ? "Ключ моделей вшит в сборку — тестировщику вводить ничего не нужно."
        : "Ключ моделей не задан: тестировщик введёт свой в настройках."
    );
  } else {
    // Сборка без демо-доступа: файла лицензии в ней быть не должно, иначе
    // копия неожиданно попросит активацию.
    await fs.rm(path.join(dir, "licence-config.json"), { force: true });
    log("Сборка без активации: файл licence-config.json удалён из исходников.");
  }

  log("Собираю навыки, вшиваемые в сборку…");
  const skills = await pluginArchive.exportToBuild(dir, normalized.skills);
  log(
    skills.included.length
      ? `Плагинов вшито: ${skills.included.length}, навыков: ${skills.included.reduce((n, s) => n + s.skills, 0)}.`
      : "Навыки не выбраны — папка bundled-skills пуста."
  );
  for (const miss of skills.missing) log(`Пропущено (нет файлов): ${miss}`);

  if (skipInstaller) {
    log("Установщик не собираю — так попросили.");
    return { ...(await builtInstallers(dir)), branch, modules, demo, skills, installerBuilt: false };
  }

  if (!fsSync.existsSync(path.join(dir, "node_modules"))) {
    log("Первая сборка в этой папке: ставлю зависимости, это долго…");
    await run(dir, "npm", ["ci"], log);
  }

  const target = process.platform === "win32" ? "electron:build:win" : "electron:build:linux";
  log(`Запускаю сборку установщика (${target}). Это несколько минут.`);
  await run(dir, "npm", ["run", target], log);

  const result = await builtInstallers(dir);
  log(
    result.installers.length
      ? `Готово. Файлов: ${result.installers.map((i) => i.name).join(", ")}`
      : "Сборка прошла, но установщик не найден — посмотрите вывод выше."
  );
  return { ...result, branch, modules, demo, skills, installerBuilt: true };
}

module.exports = { CANONICAL_BRANCH, assertChatSources, useBranch, builtInstallers, build };
