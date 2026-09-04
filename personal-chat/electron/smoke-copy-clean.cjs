// Копия для тестировщика — новая программа, в которой никто не работал:
//   xvfb-run -a npx electron electron/smoke-copy-clean.cjs
//
// Пока копия называлась так же, как канонический чат, обе брали одну и ту же
// папку «Документы\Личный чат» и одну и ту же служебную папку. На компьютере
// автора тестировщик открывал копию и видел её проекты, документы и навыки —
// то есть чужую работу вместо чистой программы. Здесь это и проверяется: рядом
// лежит папка канонического чата с проектом, а копия обязана её не заметить.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const demoAccess = require("../../personal-code/electron/demoAccess.cjs");

const COPY_NAME = "Личный чат Марии";

const documents = fs.mkdtempSync(path.join(os.tmpdir(), "copy-docs-"));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "copy-ud-"));
const issuerData = fs.mkdtempSync(path.join(os.tmpdir(), "copy-issuer-"));
const configFile = path.join(__dirname, "..", "licence-config.json");
const hadConfig = fs.existsSync(configFile);
const previousConfig = hadConfig ? fs.readFileSync(configFile, "utf-8") : null;

// Работа автора на этом же компьютере: канонический чат с проектом и навыком.
const authorRoot = path.join(documents, "Личный чат");
fs.mkdirSync(path.join(authorRoot, "projects", "novaya-zemlya", "docs"), { recursive: true });
fs.writeFileSync(
  path.join(authorRoot, "projects", "novaya-zemlya", "project.json"),
  JSON.stringify({ id: "novaya-zemlya", name: "Новая Земля", description: "продажа участков" })
);
fs.writeFileSync(path.join(authorRoot, "projects", "novaya-zemlya", "docs", "анализ.md"), "Работа автора.\n");
fs.mkdirSync(path.join(authorRoot, "skills"), { recursive: true });
fs.writeFileSync(
  path.join(authorRoot, "skills", "metod.json"),
  JSON.stringify({ id: "metod", name: "Метод Динамики", content: "Навык автора" })
);

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
  for (const dir of [documents, userData, issuerData]) fs.rmSync(dir, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

(async () => {
  demoAccess.init(issuerData);
  const keys = await demoAccess.createKeys();
  fs.writeFileSync(
    configFile,
    JSON.stringify({ publicKey: keys.publicKey, revocationUrl: "", productName: COPY_NAME }, null, 2)
  );

  app.setPath("documents", documents);
  // Служебную папку задаём сами (иначе тест писал бы в настоящую), а имя
  // приложения проверяем отдельно — именно оно разводит копии по папкам.
  app.setPath("userData", userData);

  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      check("копия называет себя своим именем", app.getName() === COPY_NAME, app.getName());

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
      const js = (expression) => win.webContents.executeJavaScript(expression);

      const config = await js(`window.api.getConfig()`);
      check(
        "папка данных — своя, по названию копии",
        config.rootPath === path.join(documents, COPY_NAME),
        config.rootPath
      );
      check("папка канонического чата не тронута", fs.existsSync(path.join(authorRoot, "projects", "novaya-zemlya")));

      const projects = await js(`window.api.listProjects()`);
      check("в копии нет проектов автора", projects.length === 0, JSON.stringify(projects.map((p) => p.name)));
      const skills = await js(`window.api.listSkills()`);
      check(
        "и нет навыков автора",
        !skills.some((s) => s.name === "Метод Динамики"),
        JSON.stringify(skills.map((s) => s.name))
      );

      // Всё, чем пользуются, на месте: пустая программа — не урезанная.
      const created = await js(`window.api.createProject({ name: "Свой проект", description: "", instructions: "" })`);
      check("свой проект заводится", !!created.id, JSON.stringify(created));
      check(
        "и ложится в папку копии",
        fs.existsSync(path.join(documents, COPY_NAME, "projects", created.id, "project.json"))
      );
      check(
        "в папке автора он не появился",
        !fs.existsSync(path.join(authorRoot, "projects", created.id))
      );
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
