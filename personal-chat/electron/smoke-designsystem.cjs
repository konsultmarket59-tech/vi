// Дизайн-система: доходит ли она до задания и до ролика.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-designsystem.cjs
//
// Жалоба звучала как «плохо слушает дизайн-систему: шрифты, логотипы, шаблоны
// не применяет». Причин оказалось две, и обе проверяются здесь.
//
// Первая: выгрузки из Фигмы и Pixso лежат ПАПКАМИ — fonts, logos, templates, —
// а сбор шёл по верхнему уровню. Человек подключал папку целиком, а до задания
// доезжали файлы из корня, и всё остальное для приложения не существовало.
//
// Вторая: шрифт в дизайн-системе — это ФАЙЛ, а не название. Строка «шрифт
// Dinamika» в задании ничего не меняет, если файла в сцене нет: браузер молча
// подставит запасной, и ролик выйдет не тем шрифтом.

const { app } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const ds = require("./designsystem.cjs");
const vs = require("./videostories.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ds-ud-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

/** Выгрузка дизайн-системы той же формы, что отдают Фигма и Pixso. */
function makeSystem(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "tokens.css"), ":root{--brand:#261A7E;--accent:#5D74FF;font-family:Dinamika}");
  for (const d of ["fonts", "logos", "templates", "node_modules", ".git"]) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, "fonts", "Dinamika-Bold.woff2"), "шрифт");
  fs.writeFileSync(path.join(root, "fonts", "Dinamika.ttf"), "шрифт");
  fs.writeFileSync(path.join(root, "logos", "logo-primary.svg"), "<svg/>");
  fs.writeFileSync(path.join(root, "logos", "лого-белый.png"), "картинка");
  fs.writeFileSync(path.join(root, "templates", "post-square.svg"), "<svg/>");
  fs.writeFileSync(path.join(root, "node_modules", "мусор.ttf"), "не наш шрифт");
  fs.writeFileSync(path.join(root, ".git", "config"), "служебное");
}

app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-sys-"));
  try {
    makeSystem(root);

    console.log("вложенные папки дизайн-системы видно");
    const { files, truncated } = await ds.collectFiles([root], { limit: 40 });
    const пути = files.map((f) => f.rel);
    check("файлы из вложенных папок собраны",
      пути.includes("fonts/Dinamika.ttf") && пути.includes("logos/logo-primary.svg") &&
        пути.includes("templates/post-square.svg"),
      пути.join(", "));
    check("корень системы тоже на месте", пути.includes("tokens.css"), пути.join(", "));
    // Служебные папки — не дизайн-система: их содержимое вытеснило бы настоящие
    // файлы из предела и ушло бы в задание вместо токенов.
    check("служебные папки пропущены",
      !пути.some((p) => p.startsWith("node_modules/") || p.startsWith(".git/")), пути.join(", "));
    check("ничего не обрезано на сорока файлах", truncated === false);

    console.log("\nприложение различает шрифты, логотипы и остальное");
    check("woff2 считается шрифтом", ds.kindOf("Dinamika-Bold.woff2") === "шрифт");
    check("и ttf тоже", ds.kindOf("Dinamika.ttf") === "шрифт");
    check("svg — картинка", ds.kindOf("post-square.svg") === "картинка");
    check("логотип опознаётся по папке", ds.looksLikeLogo("logos/logo-primary.svg") === true);
    check("и по русскому имени", ds.looksLikeLogo("logos/лого-белый.png") === true);
    check("обычный шаблон логотипом не считается", ds.looksLikeLogo("templates/post-square.svg") === false);

    const итог = ds.summary(files);
    check("шрифтов посчитано два", итог.fonts === 2, итог.fonts);
    check("логотипов — два", итог.logos === 2, итог.logos);
    check("файлы шрифтов отданы с путями", итог.fontFiles.every((f) => fs.existsSync(f.path)));

    console.log("\nпредел виден, а не молчит");
    const много = fs.mkdtempSync(path.join(os.tmpdir(), "ds-big-"));
    fs.mkdirSync(path.join(много, "icons"));
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(много, "icons", `icon-${i}.svg`), "<svg/>");
    const большая = await ds.collectFiles([много], { limit: 10 });
    check("предел соблюдён", большая.files.length === 10, большая.files.length);
    // Молча обрезанная дизайн-система и есть то, что выглядит как «не слушает».
    check("и про обрезку сказано", большая.truncated === true);
    fs.rmSync(много, { recursive: true, force: true });

    console.log("\nшрифт доезжает до сцены файлом, а не названием");
    const шрифт = path.join(root, "fonts", "Dinamika.ttf");
    const uri = await vs.fontDataUri(шрифт);
    check("ttf вшивается строкой data:", uri.startsWith("data:font/ttf;base64,"), uri.slice(0, 40));
    const uri2 = await vs.fontDataUri(path.join(root, "fonts", "Dinamika-Bold.woff2"));
    check("woff2 вшивается своим типом, а не как ttf",
      uri2.startsWith("data:font/woff2;base64,"), uri2.slice(0, 40));

    const spec = vs.normalizeSpec({ title: "Проба", fonts: [{ family: "Dinamika", path: шрифт }] });
    const html = vs.buildSceneHtml(spec, [{ family: "Dinamika", dataUri: uri }]);
    check("в сцене появляется @font-face с этим шрифтом",
      /@font-face\{font-family:"Dinamika"/.test(html) && html.includes("data:font/ttf;base64,"));
    // Без файла сцена не ругается — она молча берёт запасной шрифт. Это и есть
    // причина, по которой промах был не виден.
    check("без файла @font-face не появляется",
      !/@font-face/.test(vs.buildSceneHtml(spec, [])));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
