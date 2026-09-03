// Visual and behavioural check of the activation screen in the running app:
//   xvfb-run -a npx electron electron/smoke-gate.cjs
//
// Confirms that a demo build with no licence really does show the gate instead
// of the app, that the machine code it shows is the one the issuing side needs,
// and that activating with a proper licence lets the app through.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const demoAccess = require("../../personal-code/electron/demoAccess.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "gate-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gate-data-"));
const issuerData = fs.mkdtempSync(path.join(os.tmpdir(), "gate-issuer-"));
const configFile = path.join(__dirname, "..", "licence-config.json");
const managedFile = path.join(__dirname, "..", "managed-config.json");
const skillsDir = path.join(__dirname, "..", "bundled-skills");
const hadConfig = fs.existsSync(configFile);
const previousConfig = hadConfig ? fs.readFileSync(configFile, "utf-8") : null;
const hadManaged = fs.existsSync(managedFile);
const previousManaged = hadManaged ? fs.readFileSync(managedFile, "utf-8") : null;
const hadSkills = fs.existsSync(skillsDir);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  if (hadConfig) fs.writeFileSync(configFile, previousConfig);
  else fs.rmSync(configFile, { force: true });
  if (hadManaged) fs.writeFileSync(managedFile, previousManaged);
  else fs.rmSync(managedFile, { force: true });
  if (!hadSkills) fs.rmSync(skillsDir, { recursive: true, force: true });
  for (const dir of [userData, dataRoot, issuerData]) fs.rmSync(dir, { recursive: true, force: true });
}

async function waitFor(win, expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await win.webContents.executeJavaScript(expression);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  check(label, false, `не дождались: ${JSON.stringify(last)}`);
  return null;
}

(async () => {
  demoAccess.init(issuerData);
  const keys = await demoAccess.createKeys();
  fs.writeFileSync(
    configFile,
    JSON.stringify({ publicKey: keys.publicKey, revocationUrl: "", productName: "Личный чат" }, null, 2)
  );

  // Управляемая сборка: ключ предустановлен, цена задана только для одной модели.
  fs.writeFileSync(
    managedFile,
    JSON.stringify({
      apiKey: "ключ-автора-для-теста",
      baseUrl: "https://polza.ai/api/v1",
      model: "anthropic/claude-sonnet-5",
      currency: "₽",
      prices: { "anthropic/claude-sonnet-5": { input: 300, output: 1500 } },
    })
  );
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "preset.json"),
    JSON.stringify({ name: "Метод Динамики", description: "Тексты для ВК", content: "СЕКРЕТНАЯ МЕТОДИКА АВТОРА" })
  );

  app.setPath("userData", userData);
  fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      let win;
      const deadline = Date.now() + 20000;
      while (!win && Date.now() < deadline) {
        [win] = BrowserWindow.getAllWindows();
        if (!win) await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((resolve) => {
        if (!win.webContents.isLoading()) return resolve();
        win.webContents.once("did-finish-load", resolve);
      });

      console.log("\nдемо-сборка без активации");
      await waitFor(win, `!!document.querySelector(".licence-gate")`, "показан экран активации");
      check(
        "приложение за экраном не открыто",
        !(await win.webContents.executeJavaScript(`!!document.querySelector(".sidebar")`))
      );

      const shown = await win.webContents.executeJavaScript(
        `(document.querySelector(".licence-code")||{}).textContent || ""`
      );
      check("код компьютера показан целиком", /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/.test(shown.trim()), shown);

      // Условие копии видно на самом экране активации, а не только в переписке
      // с автором: тестировщик читает его до того, как начнёт работать.
      check(
        "предупреждение о непередаваемости показано",
        /не для продажи[\s\S]*не может быть передана/i.test(
          await win.webContents.executeJavaScript(
            `(document.querySelector(".licence-terms")||{}).textContent || ""`
          )
        )
      );

      await win.webContents.capturePage().then((img) =>
        fs.writeFileSync(path.join(os.tmpdir(), "chat-gate.png"), img.toPNG())
      );

      console.log("\nвыдача и активация");
      const { all } = demoAccess.save([], {
        name: "Мария Тестова",
        displayName: "Личный чат Марии",
        machineCode: shown,
      });
      const issued = await demoAccess.issue(all, all[0].id, { days: 30, productName: "Личный чат" });
      const licFile = path.join(issuerData, "test.lic");
      fs.writeFileSync(licFile, issued.contents);

      // Goes through the same IPC the "Выбрать файл активации" button uses,
      // minus the file dialog, which cannot be driven from a test.
      const result = await win.webContents.executeJavaScript(
        `window.api.activateLicence(${JSON.stringify(issued.contents)})`
      );
      check("активация принята", result.ok === true, JSON.stringify(result));
      check("имя тестировщика записано", result.tester === "Мария Тестова", result.tester);

      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await waitFor(win, `!!document.querySelector(".sidebar")`, "после активации приложение открывается");
      check(
        "экран активации больше не показывается",
        !(await win.webContents.executeJavaScript(`!!document.querySelector(".licence-gate")`))
      );

      console.log("\nимя копии");
      const sidebarTitle = await win.webContents.executeJavaScript(
        `(document.querySelector(".sidebar-title")||{}).textContent || ""`
      );
      check("копия подписана именем из лицензии", sidebarTitle.trim() === "Личный чат Марии", sidebarTitle);
      check(
        "заголовок окна тоже",
        (await win.webContents.executeJavaScript("document.title")) === "Личный чат Марии"
      );

      console.log("\nуправляемая сборка");
      const settings = await win.webContents.executeJavaScript(`window.api.getSettings()`);
      check("сборка помечена управляемой", settings.managed === true, JSON.stringify(settings.managed));
      const settingsText = await win.webContents.executeJavaScript(`
        (async () => {
          [...document.querySelectorAll(".sidebar-item")].find(b => b.textContent.includes("Настройки")).click();
          await new Promise(r => setTimeout(r, 600));
          return (document.querySelector(".settings-view")||{}).textContent || "";
        })()
      `);
      // Ищем именно подпись поля, а не слово где угодно: сообщение об ошибке
      // «В API-ключе есть символы…» тоже содержит эту строку.
      const keyLabels = await win.webContents.executeJavaScript(
        `[...document.querySelectorAll(".settings-view label")].filter(n => n.textContent.trim() === "API-ключ").length`
      );
      check("поля ключа Polza нет", keyLabels === 0, "подписей поля: " + keyLabels);
      check("вместо него показан расход", settingsText.includes("Расход моделей"), settingsText.slice(0, 200));
      check("выбор модели остался", settingsText.includes("Модель"), "");
      await win.webContents.capturePage().then((img) =>
        fs.writeFileSync(path.join(os.tmpdir(), "chat-usage.png"), img.toPNG())
      );

      console.log("\nпредустановленные навыки");
      const skills = await win.webContents.executeJavaScript(`window.api.listSkills()`);
      const preset = skills.find((s) => s.bundled);
      check("предустановленный навык виден по названию", preset?.name === "Метод Динамики", JSON.stringify(skills));
      check("его текст в окно не пришёл", preset?.content === "", JSON.stringify(preset));
      check(
        "секретный текст отсутствует во всём списке",
        !JSON.stringify(skills).includes("СЕКРЕТНАЯ МЕТОДИКА АВТОРА")
      );
      let refused = "";
      try {
        await win.webContents.executeJavaScript(
          `window.api.saveSkill(${JSON.stringify({ id: preset?.id, name: "Подмена", content: "мой текст" })})`
        );
      } catch (e) {
        refused = e.message;
      }
      check("изменить предустановленный навык нельзя", /нельзя изменить/.test(refused), refused);

      console.log("\nсрок кончился и продлён задним числом");
      // Обещание тестировщику: истёкший срок — это закрытая дверь, а не потеря
      // работы. Проверяем на настоящих файлах: заводим проект с документом,
      // подкладываем просроченную лицензию, ждём экран «срок истёк», активируем
      // заново и смотрим, что проект и документ на месте.
      const project = await win.webContents.executeJavaScript(
        `window.api.createProject({ name: "Проект до срока", description: "", instructions: "Проверка сохранности." })`
      );
      const docsDir = path.join(dataRoot, "projects", project.id, "docs");
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, "договор.md"), "Текст, который нельзя потерять.\n", "utf-8");

      const expiredLicence = {
        id: require("node:crypto").randomUUID(),
        tester: "Мария Тестова",
        displayName: "Личный чат Марии",
        machine: demoAccess.normalizeMachineCode(shown),
        product: "Личный чат",
        issuedAt: new Date(Date.now() - 60 * 86400000).toISOString(),
        expiresAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        revocationUrl: "",
      };
      fs.writeFileSync(
        path.join(userData, "licence.json"),
        JSON.stringify({ licence: expiredLicence, signature: await demoAccess.sign(expiredLicence) }, null, 2),
        "utf-8"
      );
      fs.rmSync(path.join(userData, "licence-state.json"), { force: true });

      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await waitFor(win, `!!document.querySelector(".licence-gate")`, "после окончания срока показан экран активации");
      const expiredHeading = await win.webContents.executeJavaScript(
        `(document.querySelector(".licence-heading")||{}).textContent || ""`
      );
      check("названа именно причина «срок»", /срок/i.test(expiredHeading), expiredHeading);
      check(
        "сказано, что данные сохранены",
        /остались на месте|не удаляются/i.test(
          await win.webContents.executeJavaScript(`document.querySelector(".licence-card").textContent`)
        )
      );
      check(
        "папка проекта на диске не тронута",
        fs.existsSync(path.join(dataRoot, "projects", project.id, "project.json")) &&
          fs.readFileSync(path.join(docsDir, "договор.md"), "utf-8").includes("нельзя потерять")
      );

      // Продление приходит позже окончания срока — как это и бывает.
      const renewalSource = demoAccess.save([], {
        name: "Мария Тестова",
        displayName: "Личный чат Марии",
        machineCode: shown,
      }).all;
      const renewal = await demoAccess.issue(renewalSource, renewalSource[0].id, {
        days: 30,
        productName: "Личный чат",
      });
      const renewedResult = await win.webContents.executeJavaScript(
        `window.api.activateLicence(${JSON.stringify(renewal.contents)})`
      );
      check("продление принято", renewedResult.ok === true, JSON.stringify(renewedResult));

      await win.webContents.reload();
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await waitFor(win, `!!document.querySelector(".sidebar")`, "после продления приложение снова открывается");
      const projectsAfter = await win.webContents.executeJavaScript(`window.api.listProjects()`);
      check(
        "проект на месте после продления",
        projectsAfter.some((p) => p.id === project.id),
        JSON.stringify(projectsAfter.map((p) => p.name))
      );
      const docsAfter = await win.webContents.executeJavaScript(
        `window.api.listDocs(${JSON.stringify(project.id)})`
      );
      check(
        "документ проекта на месте после продления",
        docsAfter.some((d) => d.name === "договор.md"),
        JSON.stringify(docsAfter)
      );

      console.log("\nотчёт о проблеме");
      const info = await win.webContents.executeJavaScript(`window.api.reportInfo()`);
      check("версия приложения известна", Boolean(info.version), JSON.stringify(info));
      check("имя тестировщика попадает в отчёт", info.tester === "Мария Тестова", info.tester);
      const written = await win.webContents.executeJavaScript(
        `window.api.writeReport("Тестовое описание проблемы")`
      );
      check("файл отчёта создан", fs.existsSync(written.file), written.file);
      const reportBody = JSON.parse(fs.readFileSync(written.file, "utf-8"));
      check("в отчёте есть описание", reportBody.описаниеПроблемы === "Тестовое описание проблемы");
      check("в отчёте есть версия и система", Boolean(reportBody.версия && reportBody.система.платформа));
      check(
        "в отчёте нет ключа доступа к моделям",
        !JSON.stringify(reportBody).toLowerCase().includes("apikey"),
        Object.keys(reportBody).join(",")
      );
      fs.rmSync(written.file, { force: true });
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanup();
      app.exit(failures === 0 ? 0 : 1);
    }
  });
})();
