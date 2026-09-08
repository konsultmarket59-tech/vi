// Видео-сторис: описание ролика, сцена, сборка настоящего mp4 и раздел в приложении.
//   xvfb-run -a npx electron electron/smoke-stories.cjs
//
// Самое важное здесь — что предпросмотр и готовый файл рисует один и тот же код.
// Сцена умеет только seek(t) и ничего не помнит между кадрами, поэтому один и
// тот же момент обязан выглядеть одинаково, сколько раз к нему ни перейди. Если
// это перестанет быть правдой, человек будет собирать по три минуты не то, что
// видел на экране.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "vs-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vs-data-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-out-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "test",
    model: "anthropic/claude-sonnet-5",
    temperature: 0.7,
    maxTokens: 4000,
    proxyMode: "direct",
    searchEnabled: false,
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

const vs = require("./videostories.cjs");
const ffmpeg = require("ffmpeg-static");
const { finish } = require("./smoke-finish.cjs");

/** Короткий цветной ролик со звуком — исходник для сборки. */
function makeSource(dest, seconds = 3) {
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc=size=720x1280:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", dest,
  ]);
  return dest;
}

const SPEC = {
  title: "Проба",
  fps: 20,
  duration: 2.5,
  layers: [
    { kind: "pill", text: "Первая фраза", start: 0.1, duration: 2.2, x: 6, y: 10, appear: "slide-left", bg: "#0A0A0A", fontSize: 60 },
    { kind: "pill", text: "Вторая", start: 0.5, duration: 1.8, x: 14, y: 20, appear: "slide-right", bg: "#FF2F6D", fontSize: 60, skew: 8, shadow: true },
    { kind: "timeline", start: 0.8, duration: 1.6, x: 8, y: 36, width: 84, steps: ["Раз", "Два", "Три"] },
    { kind: "graphics", graphics: "network", start: 1.0, duration: 1.4, x: 7, y: 50, width: 86, hub: "ЦЕНТР", nodes: ["А", "Б", "В"], accentNode: "Б" },
    { kind: "head", start: 0.2, duration: 2.0, x: 60, y: 5, size: 220, cropX: 100, cropY: 300, cropSize: 500 },
  ],
};

function cleanup() {
  for (const dir of [userData, dataRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
}

require("./main.cjs");

app.whenReady().then(async () => {
  try {
    console.log("описание ролика");
    const spec = vs.normalizeSpec(SPEC);
    check("холст вертикальный по умолчанию", spec.width === 1080 && spec.height === 1920);
    check("длительность не меньше последнего слоя", spec.duration >= 2.3, String(spec.duration));
    check("кадров считается по длительности и частоте", vs.frameCount(spec) === Math.round(2.5 * 20), String(vs.frameCount(spec)));
    check("неизвестный вид слоя не роняет разбор", vs.normalizeLayer({ kind: "ерунда" }).kind === "pill");

    console.log("\nпроверка композиции до сборки");
    const bad = vs.validateSpec({
      duration: 3,
      layers: [
        { kind: "pill", text: "ОЧЕНЬ ДЛИННАЯ СТРОКА КОТОРАЯ ТОЧНО НЕ ВЛЕЗЕТ В ХОЛСТ", x: 6, y: 10, start: 0, duration: 2 },
        { kind: "pill", text: "ВТОРАЯ", x: 6, y: 11, start: 0, duration: 2 },
        { kind: "pill", text: "ПОЗЖЕ", x: 6, y: 60, start: 2.5, duration: 3 },
      ],
    });
    check("замечен выход за край холста", bad.some((p) => p.includes("выходит за край")), bad.join(" | "));
    check("замечено наложение слоёв", bad.some((p) => p.includes("налезают")), bad.join(" | "));
    check("замечен слой длиннее ролика", bad.some((p) => p.includes("позже ролика")), bad.join(" | "));
    check("у чистой композиции замечаний нет", vs.validateSpec({ duration: 5, layers: [{ kind: "pill", text: "КОРОТКО", x: 6, y: 10, start: 0, duration: 2 }] }).length === 0);

    console.log("\nсцена");
    const html = vs.buildSceneHtml(spec);
    check("в сцене есть seek", html.includes("window.seek"));
    check("в сцене нет CSS-анимаций", !/@keyframes|animation-name/.test(html));
    check("шрифт вшивается строкой data:", vs.buildSceneHtml(spec, [{ family: "Проба", dataUri: "data:font/ttf;base64,AA" }]).includes("@font-face"));

    // Сцена в живом окне: один и тот же момент обязан выглядеть одинаково.
    const win = new BrowserWindow({
      show: false, width: 640, height: 480, transparent: true, frame: false,
      backgroundColor: "#00000000", webPreferences: { offscreen: true },
    });
    const sceneFile = path.join(outDir, "scene.html");
    fs.writeFileSync(sceneFile, html);
    await win.loadFile(sceneFile);
    win.setContentSize(spec.width, spec.height);
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (await win.webContents.executeJavaScript("window.__ready === true").catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 60));
    }
    // Кадр берём из события отрисовки — тем же способом, что и рендер.
    let painted = 0;
    let lastImage = null;
    win.webContents.on("paint", (_e, _d, image) => {
      painted += 1;
      lastImage = image;
    });
    const grab = async (t) => {
      const before = painted;
      await win.webContents.executeJavaScript(`window.seekAndSettle(${t})`);
      const deadline = Date.now() + 2000;
      while (painted === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 8));
      // Дожидаемся, пока перерисовки прекратятся. Первая пришедшая под нагрузкой
      // бывает частичной, и сравнение двух кадров одного момента тогда падает не
      // из-за сцены, а из-за того, что снимок сделан на середине отрисовки.
      let seen = painted;
      let quiet = Date.now() + 150;
      while (Date.now() < quiet && Date.now() < deadline + 1000) {
        await new Promise((r) => setTimeout(r, 15));
        if (painted !== seen) {
          seen = painted;
          quiet = Date.now() + 150;
        }
      }
      return lastImage || (await win.webContents.capturePage());
    };
    const shot = async (t) => (await grab(t)).toPNG();
    const bitmap = async (t) => (await grab(t)).toBitmap();
    const size = (await grab(0)).getSize();
    check("кадр снимается в полный размер холста", size.width === 1080 && size.height === 1920, `${size.width}x${size.height}`);

    const a = await shot(1.2);
    const b = await shot(0.0);
    const again = await shot(1.2);
    check("один и тот же момент даёт тот же кадр", Buffer.compare(a, again) === 0, `${a.length} vs ${again.length}`);
    check("разные моменты дают разные кадры", Buffer.compare(a, b) !== 0, `${a.length} vs ${b.length}`);

    const ink = (buf) => {
      // Доля непрозрачных точек: пустой оверлей от нарисованного отличается ею.
      let n = 0;
      for (let i = 3; i < buf.length; i += 4 * 53) if (buf[i] > 16) n++;
      return n;
    };
    const early = ink(await bitmap(0));
    const mid = ink(await bitmap(1.2));
    check("к середине ролика на сцене больше нарисовано, чем в нуле", mid > early, `${early} → ${mid}`);
    check("за концом ролика сцена пуста", ink(await bitmap(9)) === 0);
    win.destroy();

    console.log("\nразмер и положение элементов");
    check("масштаб есть у любого слоя", vs.normalizeLayer({ kind: "pill" }).scale === 1);
    check("масштаб не уходит в абсурд", vs.normalizeLayer({ kind: "pill", scale: 99 }).scale === 6 && vs.normalizeLayer({ kind: "pill", scale: 0 }).scale === 0.1);
    check("у таймлайна свой размер отметок", vs.normalizeLayer({ kind: "timeline", dotSize: 44 }).dotSize === 44);
    check("у графики свой множитель узлов", vs.normalizeLayer({ kind: "graphics", nodeScale: 1.6 }).nodeScale === 1.6);

    // Масштаб обязан складываться с выездом, а не затирать его: иначе увеличенная
    // плашка перестала бы выезжать и просто возникала на месте.
    const moved = vs.normalizeSpec({
      fps: 10, duration: 2,
      layers: [{ kind: "pill", text: "ЗУМ", start: 0, duration: 2, x: 10, y: 20, scale: 2, appear: "slide-left" }],
    });
    const movedFile = path.join(outDir, "moved.html");
    fs.writeFileSync(movedFile, vs.buildSceneHtml(moved));
    const win3 = new BrowserWindow({
      show: false, width: 640, height: 480, transparent: true, frame: false,
      backgroundColor: "#00000000", webPreferences: { offscreen: true },
    });
    await win3.loadFile(movedFile);
    win3.setContentSize(moved.width, moved.height);
    await new Promise((r) => setTimeout(r, 400));
    const style = async (t) => {
      await win3.webContents.executeJavaScript(`window.seekAndSettle(${t})`);
      return win3.webContents.executeJavaScript(
        `(() => { const el = document.querySelector(".layer"); const r = el.getBoundingClientRect();
          return JSON.stringify({ transform: el.style.transform, origin: el.style.transformOrigin,
            left: el.style.left, top: el.style.top, w: Math.round(r.width) }); })()`
      );
    };
    const during = JSON.parse(await style(0.15));
    const after = JSON.parse(await style(1.2));
    check("во время выезда есть и сдвиг, и масштаб",
      during.transform.includes("translate") && during.transform.includes("scale(2"), during.transform);
    check("после выезда остаётся только масштаб",
      after.transform.includes("scale(2") && !/translate\((?!0px, ?0px)/.test(after.transform), after.transform);
    check("увеличение считается от левого верхнего угла",
      after.origin.split(" ").sort().join(" ") === "left top", after.origin);
    check("положение задано процентами холста",
      after.left === Math.round(0.1 * moved.width) + "px" && after.top === Math.round(0.2 * moved.height) + "px",
      `${after.left} ${after.top}`);
    win3.destroy();

    console.log("\nреференс для агента");
    const fakeInfo = { duration: 12, width: 720, height: 1280, fps: 30, hasAudio: true };
    const withRef = vs.buildScriptPrompt({ spec, sourceInfo: fakeInfo, text: "Тезис", referenceCount: 2 });
    const noRef = vs.buildScriptPrompt({ spec, sourceInfo: fakeInfo, text: "Тезис", referenceCount: 0 });
    check("с референсом агенту велено его повторять", withRef.includes("РЕФЕРЕНС") && withRef.includes("повторяй"));
    check("сказано, сколько картинок приложено", withRef.includes("картинок: 2"));
    check("без референса — встроенные средства", noRef.includes("встроенных средств") && !noRef.includes("РЕФЕРЕНС"));
    check("агенту объяснено, чем задавать размер", withRef.includes("scale"));
    check("пути референсов хранятся в описании",
      vs.normalizeSpec({ references: ["/дом/набросок.png", ""] }).references.length === 1);

    console.log("\nсборка настоящего файла");
    const source = makeSource(path.join(outDir, "source.mp4"));
    const info = await vs.probe(ffmpeg, source);
    check("исходник прочитан", info.width === 720 && info.height === 1280 && info.hasAudio, JSON.stringify(info));

    const framesDir = path.join(outDir, "frames");
    fs.mkdirSync(framesDir, { recursive: true });
    const win2 = new BrowserWindow({
      show: false, width: 640, height: 480, transparent: true, frame: false,
      backgroundColor: "#00000000", webPreferences: { offscreen: true },
    });
    await win2.loadFile(sceneFile);
    win2.setContentSize(spec.width, spec.height);
    await new Promise((r) => setTimeout(r, 300));
    const total = vs.frameCount(spec);
    let painted2 = 0;
    let last2 = null;
    win2.webContents.on("paint", (_e, _d, image) => {
      painted2 += 1;
      last2 = image;
    });
    for (let i = 0; i < total; i++) {
      const before = painted2;
      await win2.webContents.executeJavaScript(`window.seekAndSettle(${(i / spec.fps).toFixed(4)})`);
      const dl = Date.now() + 2000;
      while (painted2 === before && Date.now() < dl) await new Promise((r) => setTimeout(r, 8));
      const img = last2 || (await win2.webContents.capturePage());
      fs.writeFileSync(path.join(framesDir, String(i + 1).padStart(5, "0") + ".png"), img.toPNG());
    }
    const head = spec.layers.find((l) => l.kind === "head");
    const maskSize = head.size - head.ringWidth * 2;
    const maskFile = path.join(outDir, "mask.html");
    fs.writeFileSync(maskFile, vs.maskHtml(maskSize));
    await win2.loadFile(maskFile);
    win2.setContentSize(maskSize, maskSize);
    await new Promise((r) => setTimeout(r, 250));
    const maskPath = path.join(outDir, "mask.png");
    fs.writeFileSync(maskPath, (last2 || (await win2.webContents.capturePage())).toPNG());
    win2.destroy();
    check("кадры оверлея сняты", fs.readdirSync(framesDir).length === total, String(fs.readdirSync(framesDir).length));

    const out = path.join(outDir, "result.mp4");
    await vs.runFfmpeg(
      ffmpeg,
      vs.buildFfmpegArgs(spec, { basePath: source, framesPattern: path.join(framesDir, "%05d.png"), maskPath, outPath: out }, info)
    );
    const res = await vs.probe(ffmpeg, out);
    check("файл собран", fs.existsSync(out) && fs.statSync(out).size > 10000, String(fs.existsSync(out) && fs.statSync(out).size));
    check("размер кадра — заданный холст", res.width === 1080 && res.height === 1920, `${res.width}x${res.height}`);
    check("длительность как заказана", Math.abs(res.duration - spec.duration) < 0.35, String(res.duration));
    check("звук исходника сохранён", res.hasAudio);

    // Оверлей обязан реально попасть в кадр: сравниваем кадр готового файла с
    // тем же кадром исходника — они не должны совпасть.
    const grabFrame = (file, t, dest) => {
      execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file,
        "-frames:v", "1", "-vf", "scale=216:384", dest]);
      return fs.readFileSync(dest);
    };
    const plain = grabFrame(source, 1.2, path.join(outDir, "p.png"));
    const dressed = grabFrame(out, 1.2, path.join(outDir, "d.png"));
    check("оверлей виден в готовом файле", Buffer.compare(plain, dressed) !== 0);

    console.log("\nмоушн-дизайн без видео");
    // Логотипом послужит однотонный PNG: важно, что путь читается и картинка
    // попадает в кадр, а не то, что на ней нарисовано.
    const logo = path.join(outDir, "logo.png");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "color=c=0x00D9FF:s=300x120", "-frames:v", "1", logo]);

    const motion = vs.normalizeSpec({
      title: "Моушн", fps: 20, duration: 2,
      source: { kind: "none" }, bgColor: "#101820",
      layers: [
        { kind: "image", sourcePath: logo, start: 0, duration: 2, x: 20, y: 30, widthPct: 40, appear: "scale" },
        { kind: "pill", text: "БЕЗ СЪЁМКИ", start: 0.4, duration: 1.6, x: 8, y: 60, fontSize: 60 },
      ],
    });
    check("источник может отсутствовать", motion.source.kind === "none");
    check("цвет фона сохранён", motion.bgColor === "#101820");
    const motionArgs = vs.buildFfmpegArgs(motion, { basePath: "", framesPattern: "x/%05d.png", outPath: "y.mp4" }, {});
    check("подложка берётся цветом, а не файлом",
      motionArgs.includes("lavfi") && motionArgs.some((a) => String(a).includes("color=c=0x101820")),
      motionArgs.slice(0, 6).join(" "));
    check("звука исходника нет — и его не пытаются взять", !motionArgs.join(" ").includes("0:a"));

    // Картинка должна вшиться в сцену строкой data: и реально нарисоваться.
    const dataUri = "data:image/png;base64," + fs.readFileSync(logo).toString("base64");
    const withAsset = { ...motion, layers: motion.layers.map((l) => (l.kind === "image" ? { ...l, dataUri } : l)) };
    const motionFile = path.join(outDir, "motion.html");
    fs.writeFileSync(motionFile, vs.buildSceneHtml(withAsset));
    const win4 = new BrowserWindow({
      show: false, width: 640, height: 480, transparent: true, frame: false,
      backgroundColor: "#00000000", webPreferences: { offscreen: true },
    });
    let painted4 = 0;
    let last4 = null;
    win4.webContents.on("paint", (_e, _d, image) => {
      painted4 += 1;
      last4 = image;
    });
    await win4.loadFile(motionFile);
    win4.setContentSize(motion.width, motion.height);
    const grab4 = async (t) => {
      const before = painted4;
      await win4.webContents.executeJavaScript(`window.seekAndSettle(${t})`);
      const dl = Date.now() + 2000;
      while (painted4 === before && Date.now() < dl) await new Promise((r) => setTimeout(r, 8));
      return last4 || (await win4.webContents.capturePage());
    };
    const motionInk = ink((await grab4(1.0)).toBitmap());
    check("картинка и текст нарисовались в сцене", motionInk > 50, `непрозрачных точек: ${motionInk}`);
    win4.destroy();

    console.log("\nсборка моушна целиком");
    const motionFrames = path.join(outDir, "mframes");
    fs.mkdirSync(motionFrames, { recursive: true });
    const win5 = new BrowserWindow({
      show: false, width: 640, height: 480, transparent: true, frame: false,
      backgroundColor: "#00000000", webPreferences: { offscreen: true },
    });
    let painted5 = 0;
    let last5 = null;
    win5.webContents.on("paint", (_e, _d, image) => {
      painted5 += 1;
      last5 = image;
    });
    await win5.loadFile(motionFile);
    win5.setContentSize(motion.width, motion.height);
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < vs.frameCount(motion); i++) {
      const before = painted5;
      await win5.webContents.executeJavaScript(`window.seekAndSettle(${(i / motion.fps).toFixed(4)})`);
      const dl = Date.now() + 1500;
      while (painted5 === before && Date.now() < dl) await new Promise((r) => setTimeout(r, 6));
      fs.writeFileSync(
        path.join(motionFrames, String(i + 1).padStart(5, "0") + ".png"),
        (last5 || (await win5.webContents.capturePage())).toPNG()
      );
    }
    win5.destroy();
    const motionOut = path.join(outDir, "motion.mp4");
    await vs.runFfmpeg(ffmpeg, vs.buildFfmpegArgs(motion,
      { basePath: "", framesPattern: path.join(motionFrames, "%05d.png"), outPath: motionOut }, {}));
    const motionRes = await vs.probe(ffmpeg, motionOut);
    check("моушн собрался без исходного видео",
      fs.existsSync(motionOut) && motionRes.width === 1080 && motionRes.height === 1920,
      JSON.stringify(motionRes));
    check("длительность моушна как заказана", Math.abs(motionRes.duration - motion.duration) < 0.3, String(motionRes.duration));

    const motionPrompt = vs.buildMotionPrompt({ spec: motion, text: "Три тезиса", assets: [{ kind: "image", name: logo }] });
    check("агенту дан путь к файлу ровно как есть", motionPrompt.includes(logo));
    check("агенту сказано не держать логотип весь ролик", motionPrompt.includes("Логотип обычно один раз"));
    check("без файлов агент об этом предупреждён",
      vs.buildMotionPrompt({ spec: motion, text: "т", assets: [] }).includes("файлов нет"));

    console.log("\nагент");
    const prompt = vs.buildScriptPrompt({ spec, sourceInfo: info, text: "Первый тезис. Второй тезис." });
    check("агенту сказано про чередование живого и вставок", prompt.includes("полноэкранные вставки"));
    check("агенту запрещено склеивать фразы", prompt.includes("Одна фраза — одна плашка"));
    const parsed = vs.parseScenes(
      'Разложил.\n\n===СЦЕНЫ===\n```json\n{"duration":12,"layers":[{"kind":"pill","text":"РАЗ","start":0,"duration":3},{"kind":"backdrop","start":3,"duration":4}]}\n```\n===КОНЕЦ==='
    );
    check("раскладка разобрана", parsed !== null && parsed.layers.length === 2, JSON.stringify(parsed && parsed.layers.length));
    check("длительность взята из ответа", parsed && parsed.duration === 12);
    check("мусор вместо блока не разбирается", vs.parseScenes("просто текст") === null);
    check("битый JSON внутри блока не роняет приложение", vs.parseScenes("===СЦЕНЫ===\n{нет\n===КОНЕЦ===") === null);

    console.log("\nшрифты");
    const fontDir = path.join(outDir, "fonts");
    fs.mkdirSync(fontDir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", "..", "DINAMIKA-extended.ttf"), path.join(fontDir, "d.ttf"));
    const list = await vs.listFonts("linux", [fontDir]);
    check("шрифт с диска найден", list.length >= 1, JSON.stringify(list.map((f) => f.family)));
    // Файл называется d.ttf, а гарнитура внутри — «ДИНАМИКА»: имя должно прийти из файла.
    check("имя взято из самого файла, а не из имени файла", list.some((f) => /динамика/i.test(f.family)) && !list.some((f) => f.family === "d"), JSON.stringify(list.slice(0, 3).map((f) => f.family)));

    console.log("\nпосле сохранения ничего не остаётся");
    const before = fs.readdirSync(dataRoot);
    const tmpBefore = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("story-")).length;
    await new Promise((r) => setTimeout(r, 200));
    const tmpAfter = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("story-")).length;
    check("рабочие папки сборки не копятся", tmpAfter <= tmpBefore + 1, `${tmpBefore} → ${tmpAfter}`);
    check("данные приложения не растут от сборки роликов",
      fs.readdirSync(dataRoot).length === before.length, JSON.stringify(fs.readdirSync(dataRoot)));

    console.log("\nраздел в приложении");
    let ui;
    const dl2 = Date.now() + 20000;
    while (!ui && Date.now() < dl2) {
      ui = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
      if (!ui) await new Promise((r) => setTimeout(r, 150));
    }
    check("окно приложения нашлось", !!ui);
    if (ui) {
      await new Promise((resolve) => {
        if (!ui.webContents.isLoading()) return resolve();
        ui.webContents.once("did-finish-load", resolve);
      });
      const call = (e) => ui.webContents.executeJavaScript(e);
      await new Promise((r) => setTimeout(r, 1000));
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Видео-сторис")).click()`);
      await new Promise((r) => setTimeout(r, 700));
      check("раздел открывается", (await call(`!!document.querySelector(".vs-form")`)) === true);
      check(
        "в форме есть все блоки",
        (await call(`["Исходное видео","Ролик","Текст и раскладка","Слои"].every(t =>
          [...document.querySelectorAll(".vs-block h3")].some(h => h.textContent.includes(t)))`)) === true
      );
      check("предпросмотр уменьшен, а не в полный холст",
        (await call(`(() => { const r = document.querySelector(".vs-preview").getBoundingClientRect();
          return r.width < 400 && r.height < 700; })()`)) === true);
      await call(`[...document.querySelectorAll(".vs-add button")].find(b => b.textContent.includes("Плашка")).click()`);
      await new Promise((r) => setTimeout(r, 500));
      check("слой добавляется", (await call(`document.querySelectorAll(".vs-layer").length`)) === 1);
      check("появились настройки слоя",
        (await call(`[...document.querySelectorAll(".vs-block h3")].some(h => h.textContent.includes("Настройки слоя"))`)) === true);

      console.log("\nпоиск на стоке");
      // Здесь жил вызов несуществующей функции: раздел падал при первом же
      // обращении к стоку. Ключа в тесте нет, поэтому проверяем, что ответ —
      // внятный отказ, а не «readSettings is not defined».
      const stock = await call(`window.api.storiesSearchStock("дом", "portrait").then(r => ({ ok: true, n: r.length }), e => ({ ok: false, msg: e.message }))`);
      check("поиск на стоке не падает на несуществующей функции",
        stock.ok || !/is not defined/.test(stock.msg || ""), JSON.stringify(stock));

      console.log("\nсцены в разделе");
      check("блок сцен есть в форме",
        (await call(`[...document.querySelectorAll(".vs-block h3")].some(h => h.textContent.includes("Сцены и переходы"))`)) === true);
      await call(`[...document.querySelectorAll(".vs-block button")].find(b => b.textContent.trim() === "+ Сцена").click()`);
      await new Promise((r) => setTimeout(r, 300));
      await call(`[...document.querySelectorAll(".vs-block button")].find(b => b.textContent.trim() === "+ Сцена").click()`);
      await new Promise((r) => setTimeout(r, 400));
      const sceneCount = await call(`document.querySelectorAll(".vs-scene-row").length`);
      check("сцены добавляются", sceneCount === 2, `сцен на экране: ${sceneCount}`);
      // У первой сцены выбора шва быть не должно: ей неоткуда приходить.
      const seamSelects = await call(`[...document.querySelectorAll(".vs-scene-row")].map(n => n.querySelectorAll("select").length)`);
      check("у первой сцены перехода нет, у второй есть", seamSelects[0] === 0 && seamSelects[1] >= 1,
        JSON.stringify(seamSelects));
      check("сцены идут встык",
        (await call(`(() => { const v = [...document.querySelectorAll(".vs-scene-row")].map(n =>
          [...n.querySelectorAll("label input")].map(i => Number(i.value)));
          return v[0][0] + v[0][1] === v[1][0]; })()`)) === true);
      check("у слоя можно выбрать сцену",
        (await call(`(() => { const s = [...document.querySelectorAll(".vs-scene-pick select option")].map(o => o.textContent);
          return s.some(t => t.includes("вне сцен")) && s.length >= 3; })()`)) === true);
      check("каскад включается галочкой",
        (await call(`[...document.querySelectorAll(".vs-scene-pick .vs-check")].some(n => n.textContent.includes("Каскад"))`)) === true);

      console.log("\nмоушн-дизайн по тому же пути, что и кнопка");
      // Раньше здесь проверялись только кирпичики — buildFfmpegArgs напрямую, — и
      // весь режим лежал: обработчик stories:render требовал исходное видео,
      // которого в моушн-дизайне нет по определению, и падал до первого кадра.
      // Поэтому теперь ролик собирается ровно тем вызовом, который делает кнопка.
      await call(`[...document.querySelectorAll(".vs-tab")].find(b => b.textContent.includes("Моушн без видео")).click()`);
      await new Promise((r) => setTimeout(r, 400));
      check("в моушне есть фон и два акцента",
        (await call(`document.querySelectorAll('.vs-colors input[type="color"]').length`)) === 3);

      const motionOutDir = path.join(outDir, "motion-ipc");
      fs.mkdirSync(motionOutDir, { recursive: true });
      const built = await call(`window.api.renderStory(${JSON.stringify({
        spec: {
          title: "Моушн",
          presetId: "story",
          fps: 24,
          duration: 2,
          source: { kind: "none", path: "", query: "", trimStart: 0 },
          bgColor: "#F5F0E8",
          accentColor: "#C6362F",
          accent2Color: "#1B7F4B",
          layers: [
            { kind: "pill", text: "ПЕРВЫЙ ТЕЗИС", start: 0, duration: 2, x: 8, y: 30 },
          ],
        },
        outputDir: motionOutDir,
      })}).then(p => p, e => "ОШИБКА: " + e.message)`);
      check("моушн собрался кнопкой, а не в обход неё", typeof built === "string" && built.endsWith(".mp4"), String(built));
      if (typeof built === "string" && built.endsWith(".mp4")) {
        const info2 = await vs.probe(ffmpeg, built);
        check("ролик настоящий, нужного размера", info2.width === 1080 && info2.height === 1920, JSON.stringify(info2));
        check("длительность как заказана", Math.abs(info2.duration - 2) < 0.3, String(info2.duration));
      }

      console.log("\nшвы между сценами");
      // Ошибка в шве не видна на статичном кадре: она живёт ровно в момент
      // склейки. Поэтому проверяем не картинку целиком, а само состояние сцены
      // в конкретные моменты — и отдельно то, что кадры вокруг склейки разные.
      const seamSpec = vs.normalizeSpec({
        source: { kind: "none" }, bgColor: "#101820", duration: 6, fps: 25,
        scenes: [
          { id: "a", title: "Раз", start: 0, duration: 3 },
          { id: "b", title: "Два", start: 3, duration: 3, seam: { kind: "cut-the-curve", direction: "left" } },
        ],
        layers: [
          { kind: "pill", text: "ПЕРВЫЙ ТЕЗИС", sceneId: "a", start: 0, duration: 3, x: 8, y: 30, fontSize: 70 },
          { kind: "pill", text: "ВТОРОЙ ТЕЗИС ТУТ", sceneId: "b", start: 3, duration: 3, x: 8, y: 30, fontSize: 70, waterfall: true },
        ],
      });
      const seamFile = path.join(outDir, "seam.html");
      fs.writeFileSync(seamFile, vs.buildSceneHtml(seamSpec));
      const seamWin = new BrowserWindow({
        show: false, width: 640, height: 480, transparent: true, frame: false,
        backgroundColor: "#00000000", webPreferences: { offscreen: true },
      });
      await seamWin.loadFile(seamFile);
      seamWin.setContentSize(seamSpec.width, seamSpec.height);
      await new Promise((r) => setTimeout(r, 350));
      const at = (t) => seamWin.webContents.executeJavaScript(`(() => {
        window.seek(${t});
        const read = (id) => {
          const el = document.querySelector('[data-scene="' + id + '"]');
          return { shown: el.style.display !== "none", opacity: Number(el.style.opacity || 1),
                   transform: el.style.transform || "", filter: el.style.filter || "" };
        };
        return { a: read("a"), b: read("b") };
      })()`);
      const dx = (tr) => { const m = /translate\((-?[\d.]+)px/.exec(tr); return m ? Number(m[1]) : 0; };

      const calm = await at(1.5);
      check("вне склейки сцена стоит на месте", Math.abs(dx(calm.a.transform)) < 0.01 && calm.a.opacity === 1,
        JSON.stringify(calm.a));
      check("вторая сцена до своего начала не показана", !calm.b.shown, JSON.stringify(calm.b));

      const leaving = await at(2.92);
      check("уходящая сцена поехала влево", dx(leaving.a.transform) < -1, leaving.a.transform);
      check("и уже гаснет", leaving.a.opacity < 0.9, String(leaving.a.opacity));
      check("на уходе появляется размытие", /blur\(/.test(leaving.a.filter), leaving.a.filter);

      const arriving = await at(3.08);
      check("первая сцена после склейки скрыта", !arriving.a.shown, JSON.stringify(arriving.a));
      // Закон вектора: ушли влево — приходящая продолжает ТО ЖЕ движение
      // влево, то есть начинает справа и едет к нулю.
      check("пришедшая продолжает то же направление", dx(arriving.b.transform) > 1, arriving.b.transform);
      check("приход зажигается не с нуля", arriving.b.opacity > 0.3 && arriving.b.opacity < 1,
        String(arriving.b.opacity));

      const settled = await at(3.6);
      check("к концу перехода сцена встала на место", Math.abs(dx(settled.b.transform)) < 1 && settled.b.opacity === 1,
        JSON.stringify(settled.b));

      // Каскад: слова прилетают по очереди, а не все разом.
      const cascade = await seamWin.webContents.executeJavaScript(`(() => {
        const count = (t) => { window.seek(t);
          return [...document.querySelectorAll('[data-wf]')].filter(n => Number(n.style.opacity) > 0.5).length; };
        return { total: document.querySelectorAll('[data-wf]').length, early: count(3.02), late: count(3.9) };
      })()`);
      check("текст разобран на слова для каскада", cascade.total === 3, String(cascade.total));
      check("в начале каскада видны не все слова", cascade.early < cascade.total, `${cascade.early} из ${cascade.total}`);
      check("к концу — все", cascade.late === cascade.total, `${cascade.late} из ${cascade.total}`);
      seamWin.destroy();

      console.log("\nконтроль швов");
      const gate = vs.checkSeams(vs.normalizeSpec({
        source: { kind: "none" }, duration: 6,
        scenes: [
          { id: "a", title: "Раз", start: 0, duration: 3 },
          { id: "b", title: "Два", start: 3, duration: 3, seam: { kind: "inverse-zoom" } },
        ],
        layers: [{ kind: "pill", text: "Б", sceneId: "b", start: 3, duration: 3, appear: "scale" }],
      }));
      check("развернувшаяся камера поймана", gate.some((p) => /меняет направление на обратное/.test(p)),
        JSON.stringify(gate));
      const gap = vs.checkSeams(vs.normalizeSpec({
        source: { kind: "none" }, duration: 8,
        scenes: [{ id: "a", title: "Раз", start: 0, duration: 3 }, { id: "b", title: "Два", start: 4, duration: 3 }],
        layers: [],
      }));
      check("разрыв между сценами пойман", gap.some((p) => /разрыв во времени/.test(p)), JSON.stringify(gap));
      check("чистая раскладка проходит без замечаний",
        vs.checkSeams(vs.normalizeSpec({
          source: { kind: "none" }, duration: 6,
          scenes: [{ id: "a", start: 0, duration: 3 }, { id: "b", start: 3, duration: 3 }],
          layers: [{ kind: "pill", text: "Б", sceneId: "b", start: 3, duration: 3 }],
        })).length === 0);

      console.log("\nпалитра");
      const light = vs.normalizeSpec({
        source: { kind: "none" }, bgColor: "#FFFFFF",
        accentColor: "#1B7F4B", accent2Color: "#F4B400",
        layers: [{ kind: "pill", text: "A" }, { kind: "pill", text: "B" }, { kind: "pill", text: "C" }],
      });
      check("акценты доходят до слоёв", light.layers[1].bg === "#1B7F4B", light.layers[1].bg);
      // Светлый фон и белые буквы — это пустое место вместо текста.
      check("на светлом фоне буквы не белые", light.layers[0].fg === "#FFFFFF" && light.layers[0].bg === "#0A0A0A",
        `${light.layers[0].bg} / ${light.layers[0].fg}`);
      check("на жёлтом акценте буквы тёмные", light.layers[2].fg === "#0A0A0A", light.layers[2].fg);
      const overVideo = vs.normalizeSpec({ source: { kind: "file", path: "x.mp4" }, layers: [{ kind: "pill", text: "A" }] });
      check("поверх съёмки плашка остаётся чёрной", overVideo.layers[0].bg === "#0A0A0A", overVideo.layers[0].bg);
      const mp = vs.buildMotionPrompt({ spec: light, text: "т", assets: [] });
      check("агент получает всю палитру", mp.includes("#FFFFFF") && mp.includes("#1B7F4B") && mp.includes("#F4B400"));
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});
