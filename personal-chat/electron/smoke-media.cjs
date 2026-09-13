// Медиа: набор приёмов, сборка промпта и поля моделей.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-media.cjs
//
// Настоящей генерации здесь нет и быть не может: она стоит денег и идёт
// минутами. Зато всё, что до неё, — проверяемо, и именно там живёт ценность
// раздела. Промпт решает в генерации больше, чем модель: разница между
// «облёт камеры вокруг дома» и «медленная орбита, герой в центре кадра» —
// это разница между роликом, который показывают, и тем, который переснимают.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const kit = require("./mediakit.cjs");
const refs = require("./mediarefs.cjs");
const script = require("./mediascript.cjs");
const ffmpeg = require("ffmpeg-static");
const { execFileSync } = require("node:child_process");
const { finish } = require("./smoke-finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "media-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "media-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "media-work-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({
    baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", model: "m",
    temperature: 0.7, maxTokens: 4000, proxyMode: "direct", searchEnabled: false,
  })
);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  for (const dir of [userData, dataRoot, workDir]) fs.rmSync(dir, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  try {
    console.log("набор приёмов");
    check("движений камеры — весь список", kit.CAMERA_MOVES.length >= 20, String(kit.CAMERA_MOVES.length));
    check("ракурсов ровно девять", kit.SHOT_ANGLES.length === 9, String(kit.SHOT_ANGLES.length));
    check("схем света ровно девять", kit.LIGHTING.length === 9, String(kit.LIGHTING.length));
    // Приёмы, названные поимённо: если какой-то пропал, список перестал быть тем,
    // ради чего его собирали.
    for (const id of ["static", "dolly-zoom", "snorricam", "push-past", "low-track", "crane-up", "drone", "pov"]) {
      check(`движение «${id}» на месте`, kit.CAMERA_MOVES.some((m) => m.id === id));
    }
    for (const id of ["overcast", "golden-backlight", "gobo", "low-key", "candlelight", "color-gel"]) {
      check(`схема света «${id}» на месте`, kit.LIGHTING.some((m) => m.id === id));
    }
    for (const id of ["mixed-media", "rhinestones", "crayon-doodle"]) {
      check(`стиль «${id}» на месте`, kit.STYLES.some((m) => m.id === id));
    }
    check("у каждого приёма есть английская строка для модели",
      [...kit.CAMERA_MOVES, ...kit.SHOT_ANGLES, ...kit.LIGHTING, ...kit.STYLES].every(
        (m) => m.prompt && /[a-z]{4}/i.test(m.prompt)
      ));
    check("у каждого движения сказано, что происходит и зачем",
      kit.CAMERA_MOVES.every((m) => m.what && m.why));
    check("имена не повторяются",
      new Set(kit.CAMERA_MOVES.map((m) => m.id)).size === kit.CAMERA_MOVES.length);

    console.log("\nкороткие команды формата");
    check("команд ровно столько, сколько в шпаргалке", kit.COMMANDS.length === 102, String(kit.COMMANDS.length));
    check("групп десять", kit.FORMAT_COMMANDS.length === 10, String(kit.FORMAT_COMMANDS.length));
    check("имена не повторяются",
      new Set(kit.COMMANDS.map((c) => c.id)).size === kit.COMMANDS.length);
    check("команда пишется через косую черту", kit.COMMANDS.every((c) => c.name.startsWith("/")));
    check("у каждой есть и русское пояснение, и строка для модели",
      kit.COMMANDS.every((c) => c.why && /[a-z]{4}/i.test(c.prompt)));
    for (const id of ["anatomy", "beforeafter", "iceberg", "billboard", "phonemockup", "storyboard", "metaphor", "dataviz"]) {
      check(`команда /${id} на месте`, kit.COMMANDS.some((c) => c.id === id));
    }

    console.log("\nприсланные стили");
    for (const id of ["dark-noir-deco", "origami", "paper-collage", "crimson-heat", "liquid-chrome",
      "iridescent-violet", "klimt", "hopper", "magritte", "hokusai", "rousseau", "bosch",
      "flir", "expired-film", "datamosh", "y2k-fisheye"]) {
      check(`стиль «${id}» на месте`, kit.ALL_STYLES.some((m) => m.id === id));
    }
    check("стиль для видео помечен и один",
      kit.ALL_STYLES.filter((m) => m.video).length === 1, JSON.stringify(kit.ALL_STYLES.filter((m) => m.video).map((m) => m.id)));
    // Промпты присланы проверенными: переписывать их «покрасивее» значило бы
    // потерять ровно то, ради чего их записывали.
    check("длинный промпт не обрезан",
      kit.ALL_STYLES.find((m) => m.id === "dark-noir-deco").prompt.length > 1500,
      String(kit.ALL_STYLES.find((m) => m.id === "dark-noir-deco").prompt.length));
    check("место под товар размечено в товарных рендерах",
      ["crimson-heat", "liquid-chrome", "iridescent-violet"].every((id) =>
        kit.ALL_STYLES.find((m) => m.id === id).prompt.includes("[PRODUCT]")));

    console.log("\nрефересы с именами");
    // Одна безымянная картинка отвечает на вопрос «на что похоже». Но работа
    // устроена иначе: вот фасад, вот логотип, вот текст — и про каждый надо
    // сказать своё. Без имён это объяснить нельзя.
    const набор = [];
    набор.push(refs.fromFile("/д/фасад дома.jpg", набор.map((r) => r.name)));
    набор.push(refs.fromFile("/д/логотип.png", набор.map((r) => r.name)));
    набор.push(refs.fromText("заголовок", "Дом у леса. Сдан.", набор.map((r) => r.name)));
    check("имя берётся из файла без расширения", набор[0].name === "фасад_дома", набор[0].name);
    check("картинка и текст различаются",
      набор[0].kind === "image" && набор[2].kind === "text", набор.map((r) => r.kind).join(","));
    // Одинаковые имена развели бы одно обращение на два разных референса.
    const сПовтором = refs.fromFile("/другое/фасад дома.jpg", ["фасад_дома"]);
    check("одинаковые имена разводятся", сПовтором.name === "фасад_дома_2", сПовтором.name);
    check("пробелы в имени заменяются — иначе обращение не разобрать",
      !/\s/.test(refs.slugName("очень длинное имя")), refs.slugName("очень длинное имя"));

    const разобрано = refs.resolveMentions(
      "Ракурс возьми с @фасад_дома, плашку с @логотип, а написать надо @заголовок. И @выдумка.",
      набор
    );
    check("картинки пронумерованы в порядке упоминания",
      /reference image 1/.test(разобрано.prompt) && /reference image 2/.test(разобрано.prompt),
      разобрано.prompt);
    check("номер в тексте совпадает с порядком вложений",
      разобрано.images[0].name === "фасад_дома" && разобрано.images[1].name === "логотип",
      разобрано.images.map((i) => i.name).join(","));
    // Текстовый референс — буквальное содержимое, а не описание стиля.
    check("текстовый референс вставлен дословно",
      разобрано.prompt.includes('"Дом у леса. Сдан."'), разобрано.prompt);
    check("опечатка в имени названа, а не проглочена",
      разобрано.missing.length === 1 && разобрано.missing[0] === "выдумка", JSON.stringify(разобрано.missing));
    check("неизвестное имя остаётся в тексте как есть", разобрано.prompt.includes("@выдумка"));

    // Привычное поведение прежнего единственного референса ломать незачем.
    const безОбращений = refs.resolveMentions("просто нарисуй дом", набор);
    check("без обращений уходят все картинки",
      безОбращений.images.length === 2, String(безОбращений.images.length));
    check("а текстовый референс сам не лезет в промпт",
      !безОбращений.prompt.includes("Дом у леса"), безОбращений.prompt);
    check("одна картинка, упомянутая дважды, отправляется один раз",
      refs.resolveMentions("@логотип сверху и @логотип снизу", набор).images.length === 1);
    check("длинное имя не съедается коротким",
      refs.resolveMentions("@фасад_дома_2", [...набор, сПовтором]).images[0].name === "фасад_дома_2");

    console.log("\nкоманды прямо в тексте промпта");
    const сКомандами = refs.extractCommands("Разбери @фасад_дома /anatomy и покажи /beforeafter", kit.COMMANDS);
    check("команды вынуты из текста",
      сКомандами.commands.join(",") === "anatomy,beforeafter", JSON.stringify(сКомандами.commands));
    // Оставить «/anatomy» в промпте значило бы отправить модели непонятный ей знак.
    check("из текста они вырезаны", !/\/anatomy/.test(сКомандами.prompt), сКомандами.prompt);
    check("остальной текст цел", сКомандами.prompt.includes("@фасад_дома"), сКомандами.prompt);
    check("несуществующая команда названа и оставлена текстом",
      refs.extractCommands("сделай /выдумка", kit.COMMANDS).unknown.length === 1);
    check("дробь внутри слова командой не считается",
      refs.extractCommands("размер 16/9 и путь c:/дом", kit.COMMANDS).commands.length === 0);

    console.log("\nсборка промпта");
    const пусто = kit.buildPrompt({ base: "Дом у леса на закате" });
    check("без выбранных приёмов уходит только текст человека", пусто === "Дом у леса на закате", пусто);

    const полный = kit.buildPrompt({
      base: "Дом у леса на закате", subject: "the house",
      style: "rhinestones", angle: "low-full", lighting: "golden-backlight",
      camera: "orbit", pace: "slow",
    });
    check("предмет подставлен вместо места под него",
      полный.includes("the house completely covered") && !полный.includes("[объект]"), полный.slice(0, 120));
    // Порядок не украшение: если приём идёт раньше предмета, модель начинает
    // рисовать приём вместо того, что просили.
    check("сначала предмет, потом приёмы",
      полный.indexOf("Дом у леса") < полный.indexOf("rhinestones"), полный.slice(0, 160));
    check("ракурс и свет на месте",
      полный.includes("low angle full-length") && полный.includes("golden hour backlight"));
    check("темп приклеен к движению, а не живёт отдельной фразой",
      /orbit shot[^.]*very slow/.test(полный), полный.slice(-160));

    const сКомандой = kit.buildPrompt({ base: "Кроссовки", command: "anatomy", style: "crimson-heat", subject: "the sneaker" });
    check("команда формата попала в промпт", /anatomical breakdown/.test(сКомандой), сКомандой.slice(0, 140));
    // Формат отвечает на вопрос «в каком виде показать» и должен стоять до
    // стиля: иначе модель рисует стиль, а формат теряется.
    check("формат идёт после темы, но до стиля",
      сКомандой.indexOf("Кроссовки") < сКомандой.indexOf("anatomical") &&
        сКомандой.indexOf("anatomical") < сКомандой.indexOf("commercial render"), сКомандой.slice(0, 200));
    check("место под товар заменено тем, что назвал человек",
      !сКомандой.includes("[PRODUCT]") && сКомандой.includes("render of the sneaker"), сКомандой.slice(0, 200));
    check("без команды её в промпте нет",
      !/anatomical breakdown/.test(kit.buildPrompt({ base: "Кроссовки" })));

    const безТемпа = kit.buildPrompt({ base: "к", camera: "orbit" });
    check("без темпа движение всё равно уходит", безТемпа.includes("orbit shot"));

    console.log("\nдизайн-система — запрет, а не пожелание");
    const сСистемой = kit.buildPrompt({
      base: "постер", design: { description: "Цвета: #101820, #C6362F\nШрифты: Onest" },
    });
    check("цвета системы попали в промпт", сСистемой.includes("#101820") && сСистемой.includes("Onest"));
    check("и сказано не придумывать другие",
      /do not invent new ones/.test(сСистемой) && /only colours and typefaces allowed/.test(сСистемой),
      сСистемой.slice(-200));
    check("система идёт последней — иначе она тонет в описании кадра",
      сСистемой.indexOf("постер") < сСистемой.indexOf("design system"));

    console.log("\nполя моделей");
    const видео = kit.buildParams("video", {
      aspect_ratio: "9:16", duration: "8", fps: "", seed: "", with_audio: true, negative_prompt: "",
    });
    check("заполненное уходит", видео.aspect_ratio === "9:16" && видео.duration === 8, JSON.stringify(видео));
    check("числа уходят числами, а не строками", typeof видео.duration === "number");
    // Пустое поле хуже отсутствующего: модель на `seed: ""` спотыкается, и
    // человек видит невнятную ошибку вместо кадра.
    check("пустое не уходит вовсе",
      !("fps" in видео) && !("seed" in видео) && !("negative_prompt" in видео), JSON.stringify(видео));
    check("галочка уходит настоящим true", видео.with_audio === true);
    check("снятая галочка не уходит", !("with_audio" in kit.buildParams("video", { with_audio: false })));
    check("чужое поле не просачивается",
      !("выдумка" in kit.buildParams("video", { выдумка: "да" })), JSON.stringify(kit.buildParams("video", { выдумка: "да" })));
    check("запятая в дробном числе понимается",
      kit.buildParams("image", { guidance_scale: "7,5" }).guidance_scale === 7.5);
    check("у каждого типа свой набор полей",
      kit.MODEL_FIELDS.image.some((f) => f.key === "steps") && !kit.MODEL_FIELDS.video.some((f) => f.key === "steps"));

    console.log("\nопись выбранного");
    const сФорматом = kit.describeChoice({ command: "iceberg", style: "klimt" });
    check("формат виден в описи выбранного",
      сФорматом.includes("/iceberg") && сФорматом.includes("Климт"), сФорматом);
    const опись = kit.describeChoice({ style: "mixed-media", camera: "dolly-zoom", pace: "smooth", lighting: "low-key" });
    check("человек видит, из чего собран промпт",
      опись.includes("Mixed Media") && опись.includes("Эффект Вертиго") && опись.includes("плавно"), опись);
    check("невыбранное в опись не лезет", !kit.describeChoice({}).length);

    console.log("\nсценарий презентации");
    const сцены = script.parsePresentation([
      "Вот сценарий:",
      "=== СЦЕНА 1 ===",
      "--- ЗАГОЛОВОК ---",
      "Смета выросла",
      "--- ГОЛОС ---",
      "Подрядчик поднял цену на треть.",
      "Это меняет весь расчёт.",
      "--- КАДР ---",
      "construction site at dawn, wide shot",
      "",
      "=== СЦЕНА 2 ===",
      "--- ЗАГОЛОВОК ---",
      "Что делать",
      "--- ГОЛОС ---",
      "Есть два пути.",
      "--- КАДР ---",
      "",
    ].join("\n"));
    check("сцены разобраны", сцены.scenes.length === 2, JSON.stringify(сцены.scenes.map((s2) => s2.title)));
    check("многострочный голос собран целиком",
      сцены.scenes[0].voice.includes("треть") && сцены.scenes[0].voice.includes("расчёт"), сцены.scenes[0].voice);
    // Сцена без кадра — не повод молча её выбросить: голос у неё есть, а вот
    // картинку заказать не из чего, и человек должен это увидеть.
    check("сцена без кадра названа, но не потеряна",
      сцены.scenes.length === 2 && сцены.problems.some((p2) => /нет описания кадра/.test(p2)),
      JSON.stringify(сцены.problems));
    check("сцена без голоса отбрасывается — озвучивать нечего",
      script.parsePresentation("=== СЦЕНА 1 ===\n--- ЗАГОЛОВОК ---\nа\n--- КАДР ---\nб").scenes.length === 0);
    check("ответ без разметки не превращается в пустой сценарий молча",
      script.parsePresentation("Конечно! Вот ваша презентация про смету.").problems.length === 1);

    console.log("\nсценарий подкаста");
    const реплики = script.parsePodcast([
      "=== РЕПЛИКА 1 ===", "--- КТО ---", "А", "--- ТЕКСТ ---", "Смотри, тут сказано про смету.",
      "=== РЕПЛИКА 2 ===", "--- КТО ---", "Б", "--- ТЕКСТ ---", "Не согласен, это другое.",
      "=== РЕПЛИКА 3 ===", "--- КТО ---", "B", "--- ТЕКСТ ---", "И вот почему.",
    ].join("\n"));
    check("реплики разобраны", реплики.lines.length === 3, JSON.stringify(реплики.lines));
    check("латинская B понимается как второй ведущий",
      реплики.lines[2].speaker === "b", реплики.lines[2].speaker);
    check("у диалога нет придирок", !реплики.problems.length, JSON.stringify(реплики.problems));
    // Монолог в два голоса — это не подкаст, и сказать об этом надо до того,
    // как человек оплатит озвучку всех реплик.
    const монолог = script.parsePodcast([
      "=== РЕПЛИКА 1 ===", "--- КТО ---", "А", "--- ТЕКСТ ---", "раз",
      "=== РЕПЛИКА 2 ===", "--- КТО ---", "А", "--- ТЕКСТ ---", "два",
    ].join("\n"));
    check("монолог пойман до оплаты озвучки",
      монолог.problems.some((p2) => /монолог/.test(p2)), JSON.stringify(монолог.problems));

    console.log("\nзадание модели");
    const заданиеП = script.buildPresentationPrompt({ source: "Смета выросла на треть.", minutes: 2 });
    check("в задании есть источник", заданиеП.includes("Смета выросла на треть"));
    check("и запрет додумывать", /не додумывай/i.test(заданиеП));
    check("и разметка, которую мы потом разбираем", заданиеП.includes("=== СЦЕНА 1 ==="));
    const заданиеПК = script.buildPodcastPrompt({ source: "текст", minutes: 8, names: { a: "Аня", b: "Борис" } });
    check("в подкасте названы ведущие", заданиеПК.includes("Аня") && заданиеПК.includes("Борис"));
    // Согласный диалог — это монолог в два голоса. Требование несогласия и
    // есть то, ради чего подкаст вообще делают.
    check("от ведущих прямо требуется не согласиться",
      /НЕ СОГЛАСИТЬСЯ/.test(заданиеПК) && /монолог в два голоса/.test(заданиеПК));
    check("и требуется вытаскивать неочевидное", /неочевидн/i.test(заданиеПК));
    check("и честно говорить, когда ответа в источнике нет",
      /ответа НЕТ/.test(заданиеПК) && /Не выдумывайте/.test(заданиеПК));
    check("больше минут — больше реплик",
      script.buildPodcastPrompt({ source: "т", minutes: 20 }).match(/Реплик: примерно (\d+)/)[1] >
        script.buildPodcastPrompt({ source: "т", minutes: 4 }).match(/Реплик: примерно (\d+)/)[1]);

    console.log("\nсборка настоящего файла");
    // Модели здесь нет, но ffmpeg настоящий: картинки и голоса подменяются
    // синтетическими, а склейка идёт та же, что и в работе.
    const кадры = [];
    for (const [i, colour, sec] of [[1, "0x2B4C7E", 2], [2, "0xC6362F", 3]]) {
      const img = path.join(workDir, `к${i}.png`);
      const snd = path.join(workDir, `г${i}.mp3`);
      execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
        "-i", `color=c=${colour}:s=640x360`, "-frames:v", "1", img]);
      execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
        "-i", `sine=frequency=${300 * i}:duration=${sec}`, snd]);
      кадры.push({ imagePath: img, audioPath: snd });
    }
    const ролик = path.join(workDir, "презентация.mp4");
    await script.buildPresentationVideo(ffmpeg, кадры, workDir, ролик, { width: 640, height: 360, fps: 24 });
    const длина = await script.audioSeconds(ffmpeg, ролик);
    check("презентация собралась", fs.existsSync(ролик) && fs.statSync(ролик).size > 10000,
      String(fs.existsSync(ролик) && fs.statSync(ролик).size));
    // Кадр держится ровно столько, сколько говорит голос: 2 + 3 секунды.
    check("каждый кадр держится столько, сколько его голос",
      Math.abs(длина - 5) < 0.5, `${длина.toFixed(2)} с вместо 5`);

    const подкаст = path.join(workDir, "подкаст.mp3");
    await script.buildPodcastAudio(ffmpeg, кадры.map((k) => k.audioPath), workDir, подкаст);
    check("подкаст склеился", fs.existsSync(подкаст) && fs.statSync(подкаст).size > 5000);
    check("и длится как сумма реплик",
      Math.abs((await script.audioSeconds(ffmpeg, подкаст)) - 5) < 0.5,
      String(await script.audioSeconds(ffmpeg, подкаст)));

    let упало = "";
    await script.buildPodcastAudio(ffmpeg, [], workDir, подкаст).catch((e) => (упало = e.message));
    check("пустой сценарий не собирается молча", /склеивать нечего/.test(упало), упало);

    console.log("\nраздел в приложении");
    require("./main.cjs");
    let win;
    const deadline = Date.now() + 25000;
    while (!win && Date.now() < deadline) {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
      if (!win) await new Promise((r) => setTimeout(r, 120));
    }
    check("окно приложения открылось", !!win);
    if (win) {
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      const call = (e) => win.webContents.executeJavaScript(e);
      await new Promise((r) => setTimeout(r, 1200));

      const наборИзОкна = await call(`window.api.mediaKit()`);
      check("набор доезжает до окна",
        наборИзОкна.cameraMoves.length === kit.CAMERA_MOVES.length && !!наборИзОкна.fields.video.length,
        JSON.stringify(Object.keys(наборИзОкна)));

      // Дизайн-система читается тем же разбором, что в «Сайтах» и роликах.
      const сисДир = path.join(workDir, "система");
      fs.mkdirSync(сисДир, { recursive: true });
      fs.writeFileSync(path.join(сисДир, "токены.css"), ":root{--фон:#101820;}\nbody{font-family:Onest;}");
      const система = await call(`window.api.readMediaDesign(${JSON.stringify(сисДир)})`);
      check("дизайн-система читается и в «Медиа»",
        система.colours.includes("#101820") && система.vars.some((v) => v.name === "--фон"),
        JSON.stringify(система.colours));

      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Медиа")).click()`);
      await new Promise((r) => setTimeout(r, 800));
      check("раздел открывается", (await call(`!!document.querySelector(".media-form")`)) === true);
      check("группы приёмов есть",
        (await call(`document.querySelectorAll(".media-kit-group").length`)) >= 2,
        String(await call(`document.querySelectorAll(".media-kit-group").length`)));
      // Группы свёрнуты: развёрнутые разом, они образуют стену, в которой
      // ничего не выбрать.
      check("и свёрнуты по умолчанию",
        (await call(`document.querySelectorAll(".media-kit-list").length`)) === 0);
      await call(`[...document.querySelectorAll(".media-kit-head")].find(b => b.textContent.includes("Свет")).click()`);
      await new Promise((r) => setTimeout(r, 300));
      check("группа раскрывается по нажатию",
        (await call(`document.querySelectorAll(".media-kit-item").length`)) === 9,
        String(await call(`document.querySelectorAll(".media-kit-item").length`)));
      check("у приёма видно, зачем он нужен, а не только как называется",
        (await call(`!!document.querySelector(".media-kit-why")`)) === true);
      await call(`[...document.querySelectorAll(".media-kit-item")].find(b => b.textContent.includes("Лоу-кей")).click()`);
      await new Promise((r) => setTimeout(r, 300));
      check("выбор виден человеку",
        (await call(`(document.querySelector(".media-chosen")||{}).textContent || ""`)).includes("Лоу-кей"));
      check("поля модели показаны",
        (await call(`document.querySelectorAll(".media-param").length`)) >= 3,
        String(await call(`document.querySelectorAll(".media-param").length`)));
      // «Даже кнопку сгенерировать не видно»: она стояла в конце длинной ленты
      // настроек. Теперь действие прилипло к низу столбца и видно всегда.
      check("кнопка действия прилипла к низу и видна без прокрутки",
        (await call(`(() => {
          const bar = document.querySelector(".media-actions");
          const form = document.querySelector(".media-form");
          if (!bar || !form) return "нет полосы действия";
          const b = bar.getBoundingClientRect(), f = form.getBoundingClientRect();
          return b.bottom <= f.bottom + 2 && b.height > 0 ? "видна" : "за краем";
        })()`)) === "видна");
      check("настройки прокручиваются отдельно от кнопки",
        (await call(`(() => {
          const sc = document.querySelector(".media-scroll");
          return sc && getComputedStyle(sc).overflowY === "auto" ? "да" : "нет";
        })()`)) === "да");
      check("команды формата есть и закрыты по умолчанию",
        (await call(`document.body.textContent.includes("Короткая команда")`)) === true &&
          (await call(`!document.querySelector(".media-kit-search")`)) === true);
      await call(`[...document.querySelectorAll(".media-kit-head")].find(b => b.textContent.includes("Короткая команда")).click()`);
      await new Promise((r) => setTimeout(r, 300));
      check("по командам можно искать — их сто с лишним",
        (await call(`!!document.querySelector(".media-kit-search")`)) === true);
      await call(`(() => {
        const i = document.querySelector(".media-kit-search");
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        set.call(i, "айсберг");
        i.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      check("поиск идёт и по русскому пояснению",
        (await call(`[...document.querySelectorAll(".media-kit-item")].some(b => b.textContent.includes("/iceberg"))`)) === true);

      // Разбор промпта доступен окну: опечатку в имени надо показать до того,
      // как генерация оплачена.
      const изОкна = await call(`window.api.mediaResolvePrompt(
        "ракурс с @фасад, надпись @текст, /anatomy и @опечатка",
        ${JSON.stringify([
          { id: "1", kind: "image", name: "фасад", path: "/д/ф.jpg", file: "ф.jpg", text: "" },
          { id: "2", kind: "text", name: "текст", path: "", file: "", text: "Дом у леса" },
        ])})`);
      check("окно видит, что уедет в модель",
        изОкна.prompt.includes("reference image 1") && изОкна.prompt.includes('"Дом у леса"'),
        изОкна.prompt);
      check("и видит опечатку в имени", изОкна.missing.join(",") === "опечатка", JSON.stringify(изОкна.missing));
      check("и команду, набранную в тексте", изОкна.commands.join(",") === "anatomy");

      check("сказано честно, что часть полей — только через JSON",
        (await call(`document.body.textContent.includes("пишется JSON-ом ниже")`)) === true);

      await call(`[...document.querySelectorAll(".media-mode-tabs .tab")].find(b => b.textContent.includes("Презентация")).click()`);
      await new Promise((r) => setTimeout(r, 400));
      check("режим презентаций и подкастов открывается",
        (await call(`document.body.textContent.includes("Написать сценарий")`)) === true);
      check("задание можно и скопировать — сценарий пишут и в другом чате",
        (await call(`document.body.textContent.includes("скопировать задание")`)) === true);
      check("подкаст есть отдельным видом",
        (await call(`document.body.textContent.includes("Подкаст на двоих")`)) === true);

      const заданиеИзОкна = await call(`window.api.mediaScriptPrompt(${JSON.stringify({
        kind: "podcast", source: "Смета выросла на треть.", minutes: 6, names: { a: "Аня", b: "Борис" },
      })})`);
      check("задание на подкаст собирается через окно",
        заданиеИзОкна.prompt.includes("Смета выросла") && /НЕ СОГЛАСИТЬСЯ/.test(заданиеИзОкна.prompt));
      // Сценарий можно и заказать одним нажатием — ключ уже настроен, носить
      // текст туда-сюда незачем. Модели в тесте нет, поэтому проверяем, что
      // вызов доходит до неё и пустой источник отсекается до обращения.
      const пустой = await call(`window.api.mediaWriteScript({ kind: "podcast", source: "  " })
        .then(() => "", e => e.message)`);
      check("пустой источник отсекается до обращения к модели",
        /писать сценарий не о чем/.test(пустой), пустой);
      const доМодели = await call(`window.api.mediaWriteScript({ kind: "podcast", source: "Смета выросла." })
        .then(() => "", e => e.message)`);
      check("с источником вызов доходит до модели",
        доМодели !== "" && !/не о чем/.test(доМодели), доМодели);

      const разбор = await call(`window.api.mediaParseScript("podcast", ${JSON.stringify(
        "=== РЕПЛИКА 1 ===\n--- КТО ---\nА\n--- ТЕКСТ ---\nраз\n=== РЕПЛИКА 2 ===\n--- КТО ---\nБ\n--- ТЕКСТ ---\nдва"
      )})`);
      check("разбор сценария доступен из окна", разбор.lines.length === 2, JSON.stringify(разбор));
      // Одинаковые голоса — не придирка: диалог в один голос не слышен, и
      // платить за озвучку такого незачем.
      const однимГолосом = await call(`window.api.buildMediaPodcast(${JSON.stringify({
        lines: [{ index: 1, speaker: "a", text: "раз" }], voiceModel: "v", voiceA: "один", voiceB: "один",
      })}).then(() => "", e => e.message)`);
      check("одинаковые голоса ведущих отклоняются до трат",
        /совпадают/.test(однимГолосом), однимГолосом);
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});
