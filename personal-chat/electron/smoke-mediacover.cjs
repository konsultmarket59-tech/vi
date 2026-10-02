// Оформление кадра по дизайн-системе: настоящий шрифт и настоящий логотип.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-mediacover.cjs
//
// Почему этот шаг вообще есть. Модель, рисующая изображение, не умеет
// пользоваться чужим файлом шрифта и не воспроизводит чужой логотип: буквы она
// рисует пикселями — похожие, но не ваши. Поэтому цветокоррекция по
// дизайн-системе через промпт работает, а шрифт и знак — нет, и кладутся они
// поверх готового кадра из тех самых файлов, что лежат в системе.
//
// Проверка идёт по ПИКСЕЛЯМ, а не по разметке: разметка с @font-face может быть
// верной, а снимок всё равно сняться запасным шрифтом, если не дождаться
// загрузки. Именно так промах и выглядит — незаметно.

const { app, BrowserWindow, nativeImage } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const cover = require("./mediacover.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cover-ud-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();
// Проверка закрывает служебные окна по ходу дела, а Electron по умолчанию
// выходит, когда закрылось последнее. Без этого набор обрывался на середине —
// молча и с нулевым кодом, то есть выглядел пройденным.
app.on("window-all-closed", () => {});

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

/** Сплошной кадр заданного цвета — на нём любое наложение видно по пикселям. */
function solidPhoto(file, width, height, colour) {
  const win = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: true } });
  return new Promise((resolve) => {
    win.webContents.once("did-finish-load", async () => {
      win.setContentSize(width, height);
      await new Promise((r) => setTimeout(r, 250));
      const img = await win.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      win.destroy();
      resolve();
    });
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(`<body style="margin:0;background:${colour};width:${width}px;height:${height}px"></body>`)
    );
  });
}

/** Доля пикселей заданного цвета — так видно, легло ли наложение. */
function shareOf(file, test) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  let hit = 0;
  for (let i = 0; i < buf.length; i += 4) {
    if (test(buf[i + 2], buf[i + 1], buf[i])) hit += 1;
  }
  return { share: hit / (width * height), width, height };
}

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cover-"));
  try {
    const photo = path.join(dir, "кадр.png");
    await solidPhoto(photo, 540, 960, "#2b2b2b");
    check("исходный кадр создан", fs.existsSync(photo));

    console.log("размер берётся у самой картинки");
    const size = await cover.imageSize(photo);
    check("размер прочитан", size.width === 540 && size.height === 960, JSON.stringify(size));

    console.log("\nзаголовок ложится на кадр");
    // Фирменный цвет на сером кадре: если заголовок нарисовался, пиксели этого
    // цвета появятся, а если нет — их не будет вовсе.
    const html = cover.buildHtml({
      width: size.width,
      height: size.height,
      photo: await cover.dataUri(photo, cover.IMAGE_MIME, "image/png"),
      title: "БОЛЬШЕ НЕ ОНЛАЙН",
      accentColor: "#00e5ff",
      textColor: "#ffffff",
      layout: "сверху",
    });
    const страница = path.join(dir, "cover.html");
    fs.writeFileSync(страница, html);
    const окно = new BrowserWindow({ show: false, width: size.width, height: size.height, webPreferences: { offscreen: true } });
    окно.webContents.on("did-fail-load", (_e, code, desc, url) =>
      console.log("    не загрузилось:", code, desc, String(url).slice(0, 80))
    );
    await окно.loadFile(страница);
    окно.setContentSize(size.width, size.height);
    const готово = Date.now() + 10000;
    while (Date.now() < готово) {
      if (await окно.webContents.executeJavaScript("window.__ready === true").catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    check("страница дождалась шрифтов и картинок",
      (await окно.webContents.executeJavaScript("window.__ready === true")) === true);
    const снимок = path.join(dir, "готово.png");
    fs.writeFileSync(снимок, (await окно.webContents.capturePage()).toPNG());
    окно.destroy();

    const фирменные = shareOf(снимок, (r, g, b) => b > 180 && g > 150 && r < 120);
    check("фирменный цвет появился в пикселях — заголовок нарисован",
      фирменные.share > 0.002, фирменные.share.toFixed(5));
    check("размер снимка совпадает с кадром",
      фирменные.width === 540 && фирменные.height === 960, `${фирменные.width}×${фирменные.height}`);

    console.log("\nбез текста и знака кадр не трогается лишним");
    const пусто = cover.buildHtml({ width: 10, height: 10, photo: "data:,", layout: "только-знак" });
    check("без логотипа его в разметке нет", !/class="logo"/.test(пусто));
    check("затемнение в раскладке «только знак» выключено", /\.scrim\{[^}]*display:none/.test(пусто));

    console.log("\nшрифт и логотип — файлами, а не названиями");
    const сФайлами = cover.buildHtml({
      width: 100, height: 100, photo: "data:,",
      title: "Проба", fontFamily: "Dinamika", fontUri: "data:font/woff2;base64,AA",
      logo: "data:image/svg+xml;base64,BB",
    });
    check("шрифт вшит данными файла", /@font-face\{font-family:"Dinamika";src:url\("data:font\/woff2/.test(сФайлами));
    check("логотип вставлен картинкой", /<img class="logo" src="data:image\/svg\+xml/.test(сФайлами));
    check("без файла шрифта @font-face не появляется",
      !/@font-face/.test(cover.buildHtml({ width: 10, height: 10, photo: "data:,", title: "Проба", fontFamily: "Dinamika" })));

    console.log("\nлоготип ставится по выбору, а не всегда");
    // Иногда нужна только цветокоррекция в цветах системы, и знак в углу лишний.
    const безЗнака = cover.buildHtml({ width: 100, height: 100, photo: "data:,", title: "Проба" });
    check("без файла знака его в кадре нет", !/<img class="logo"/.test(безЗнака));
    const соЗнаком = cover.buildHtml({ width: 100, height: 100, photo: "data:,", logo: "data:," });
    check("со знаком он появляется", /<img class="logo"/.test(соЗнаком));

    console.log("\nразмер знака — долей кадра, с границами");
    check("двадцать процентов от тысячи — двести точек",
      /\.logo\{[^}]*width:200px/.test(cover.buildHtml({ width: 1000, height: 1000, photo: "data:,", logo: "data:,", logoScale: 0.2 })));
    // Тот же знак на 1080 и на 4K должен занимать одну и ту же долю кадра: в
    // точках он на большом кадре превращается в точку в углу.
    check("на вчетверо большем кадре доля та же",
      /\.logo\{[^}]*width:800px/.test(cover.buildHtml({ width: 4000, height: 4000, photo: "data:,", logo: "data:,", logoScale: 0.2 })));
    check("слишком большое значение прижимается к границе", cover.логоДоля(5) === cover.LOGO_SCALE.max);
    check("слишком малое — тоже", cover.логоДоля(0) === cover.LOGO_SCALE.min);
    check("мусор вместо числа даёт значение по умолчанию", cover.логоДоля("ой") === cover.LOGO_SCALE.default);

    console.log("\nползунок показывает правду");
    // Предпросмотр знака рисуется в окне обычным CSS, а готовый файл — этим
    // модулем. Отступы у них записаны в двух местах, и если они разойдутся,
    // ползунок будет обманывать: на экране знак в одном месте, в файле в другом.
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "index.css"), "utf-8");
    const углы = { "справа-сверху": "top:4%;right:5%;", "слева-сверху": "top:4%;left:5%;",
      "справа-снизу": "bottom:4%;right:5%;", "слева-снизу": "bottom:4%;left:5%;" };
    let совпали = 0;
    for (const [угол, правило] of Object.entries(углы)) {
      const вФайле = cover.buildHtml({ width: 100, height: 100, photo: "data:,", logo: "data:,", corner: угол });
      const вОкне = new RegExp(`\\.media-shot-logo\\.${угол}\\s*\\{([^}]*)\\}`).exec(css);
      const пары = правило.split(";").filter(Boolean);
      const сходится =
        вФайле.includes(правило) && вОкне && пары.every((пара) => вОкне[1].replace(/\s/g, "").includes(пара));
      if (сходится) совпали += 1;
      else console.log(`    расхождение в углу «${угол}»: окно ${вОкне ? вОкне[1].trim() : "нет правила"}`);
    }
    check("отступы знака в предпросмотре и в готовом файле совпадают", совпали === 4, `${совпали} из 4`);

    console.log("\nимя файла говорит, что это оформленная версия");
    check("имя понятное", cover.coverName("/x/кадр.png") === "кадр-оформлено.png", cover.coverName("/x/кадр.png"));
    check("расширение всегда png", cover.coverName("/x/кадр.jpg") === "кадр-оформлено.png");
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
