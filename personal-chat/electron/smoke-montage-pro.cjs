// Шрифты и шрифтовые пары, коррекция изображения, удаление водяного знака —
// проверка по пикселям собранного ролика.
//   node electron/smoke-montage-pro.cjs

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const montage = require("./montage.cjs");
const fonts = require("./fontLibrary.cjs");
const ffmpeg = require("ffmpeg-static");
const { finish } = require("./finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

/** Кадр как сырые RGB-пиксели (уменьшенный). */
function frame(file, at, w, h, crop = "") {
  const vf = `${crop ? `crop=${crop},` : ""}scale=${w}:${h},format=rgb24`;
  return execFileSync(ffmpeg, ["-loglevel", "error", ...(at === null ? [] : ["-ss", String(at)]), "-i", file, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-"], { maxBuffer: 64 << 20 });
}
const mean = (buf) => buf.reduce((a, v) => a + v, 0) / buf.length;
const diff = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-pro-"));
  try {
    console.log("шрифты");
    const lib = fonts.library();
    check("встроенная библиотека — не меньше 35 шрифтов с файлами", lib.length >= 35 && lib.every((f) => fs.existsSync(f.path)), lib.length);
    check("есть рукописные и с засечками", lib.some((f) => f.category === "script") && lib.some((f) => f.category === "serif"));
    const pairs = fonts.pairs();
    check("шрифтовых пар не меньше 12, у каждой есть файлы", pairs.length >= 12 && pairs.every((p) => fs.existsSync(p.head.path) && fs.existsSync(p.accent.path)), pairs.length);

    // Фон — ровный серый: текст в кадре видно по отклонению от серого.
    const bg = path.join(tmp, "bg.png");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=1080x1920", "-frames:v", "1", bg]);
    const reels = fonts.pair("reels");
    const render = async (texts, name, extra = {}) => {
      const project = montage.normalizeProject({ canvas: { preset: "9:16", width: 540, height: 960, fps: 25 }, clips: [{ src: bg, kind: "image", in: 0, out: 2, ...extra }], texts, captions: { enabled: false, highlight: "#FFD400" } });
      const out = path.join(tmp, `${name}.mp4`);
      await montage.renderProject({ bin: ffmpeg, project, outPath: out, workDir: path.join(tmp, `w-${name}`), fontFiles: [] });
      return out;
    };
    const textBase = { start: 0, end: 2, style: "title", animation: "none", size: 120, x: 0.5, y: 0.5, upper: true };
    const a = await render([{ ...textBase, text: "Шрифтовые пары" }], "plain");
    const b = await render([{ ...textBase, text: "Шрифтовые *пары*", fontPath: reels.head.path, accentFontPath: reels.accent.path, accentScale: 1.3 }], "pair");
    check("ролик из одних картинок собирается (тишина не ломает выравнивание громкости)", fs.existsSync(a));
    const fa = frame(a, 1, 270, 480);
    const fb = frame(b, 1, 270, 480);
    check("надпись парой набирается другими шрифтами", diff(fa, fb) > 1.5, diff(fa, fb).toFixed(2));
    // Акцент — жёлтый: в кадре есть жёлтые пиксели (R и G высокие, B низкий).
    let yellow = 0;
    for (let i = 0; i < fb.length; i += 3) if (fb[i] > 180 && fb[i + 1] > 150 && fb[i + 2] < 90) yellow++;
    check("слово в *звёздочках* — цветом акцента", yellow > 50, yellow);
    const ass = montage.normalizeText({ text: "a *b*", fontPath: reels.head.path });
    check("у надписи сохраняются шрифт и пара", ass.fontPath === reels.head.path && ass.accentScale === 1);

    console.log("коррекция");
    const photo = path.join(tmp, "photo.png");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920", "-vf", "eq=brightness=-0.25", "-frames:v", "1", photo]);
    const renderPhoto = async (adjust, name) => {
      const project = montage.normalizeProject({ canvas: { preset: "9:16", width: 540, height: 960, fps: 25 }, clips: [{ src: photo, kind: "image", in: 0, out: 1.5, adjust }], captions: { enabled: false } });
      const out = path.join(tmp, `${name}.mp4`);
      await montage.renderProject({ bin: ffmpeg, project, outPath: out, workDir: path.join(tmp, `w-${name}`) });
      return frame(out, 0.7, 108, 192);
    };
    const orig = await renderPhoto({}, "orig");
    const exp = await renderPhoto({ exposure: 1 }, "exp");
    check("экспозиция +1 ступень осветляет кадр", mean(exp) > mean(orig) * 1.3, `${mean(orig).toFixed(1)} → ${mean(exp).toFixed(1)}`);
    const warm = await renderPhoto({ temperature: 0.8 }, "warm");
    const rb = (buf) => {
      let r = 0;
      let bl = 0;
      for (let i = 0; i < buf.length; i += 3) {
        r += buf[i];
        bl += buf[i + 2];
      }
      return r / bl;
    };
    check("теплее — красного больше относительно синего", rb(warm) > rb(orig) * 1.08, `${rb(orig).toFixed(2)} → ${rb(warm).toFixed(2)}`);
    const all = await renderPhoto({ exposure: 0.2, temperature: -0.3, tint: 0.2, vibrance: 0.4, highlights: -0.3, shadows: 0.3, sharpness: 0.5, clarity: 0.5, vignette: 0.5, denoise: 0.3, grain: 0.2 }, "all");
    check("все ползунки коррекции вместе собираются", all.length === orig.length && diff(all, orig) > 2);

    console.log("водяной знак");
    // Ровный градиент со знаком: после удаления область знака похожа на чистый
    // кадр, а не на кадр со знаком.
    const clean = path.join(tmp, "clean.png");
    const marked = path.join(tmp, "marked.png");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920,geq=r='47+185*Y/H':g='93+101*Y/H':b='138-16*Y/H',noise=alls=10:allf=u", "-frames:v", "1", clean]);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", clean, "-vf", "drawbox=x=620:y=1650:w=380:h=110:color=white@0.85:t=fill", "-frames:v", "1", marked]);
    const erase = [{ x: 600 / 1080, y: 1630 / 1920, w: 420 / 1080, h: 150 / 1920 }];
    const renderMarked = async (er, name) => {
      const project = montage.normalizeProject({ canvas: { preset: "9:16", width: 1080, height: 1920, fps: 25 }, clips: [{ src: marked, kind: "image", in: 0, out: 1, erase: er }], captions: { enabled: false } });
      const out = path.join(tmp, `${name}.mp4`);
      await montage.renderProject({ bin: ffmpeg, project, outPath: out, workDir: path.join(tmp, `w-${name}`) });
      return out;
    };
    const crop = "460:190:580:1610";
    // Сравнение усреднённых цветов (блоки 20×19 px): зерно случайное и
    // попиксельно не совпадёт, а цвет и свет обязаны совпасть.
    const cleanRegion = frame(clean, null, 23, 10, crop);
    const markedRegion = frame(marked, null, 23, 10, crop);
    const fixed = frame(await renderMarked(erase, "erased"), 0.5, 23, 10, crop);
    const smooth = frame(await renderMarked([{ ...erase[0], mode: "smooth" }], "smooth"), 0.5, 23, 10, crop);
    const dMarked = diff(markedRegion, cleanRegion);
    const dFixed = diff(fixed, cleanRegion);
    check("знак убран: область как чистый фон", dFixed < dMarked * 0.15 && dFixed < 8, `со знаком ${dMarked.toFixed(1)}, после ${dFixed.toFixed(1)}`);
    check("режим «сгладить» тоже убирает знак", diff(smooth, cleanRegion) < dMarked * 0.3, diff(smooth, cleanRegion).toFixed(1));
    // Текстура не «мылится»: разброс соседних пикселей в области как у чистого фона.
    const rough = (buf) => {
      let d = 0;
      for (let i = 3; i < buf.length; i += 3) d += Math.abs(buf[i] - buf[i - 3]);
      return d / (buf.length / 3);
    };
    const full = (f) => frame(f, f.endsWith(".png") ? null : 0.5, 1080, 1920, "380:110:620:1650");
    check("после удаления текстура живая, не мыло", rough(full(path.join(tmp, "erased.mp4"))) > rough(full(clean)) * 0.5, `${rough(full(clean)).toFixed(2)} → ${rough(full(path.join(tmp, "erased.mp4"))).toFixed(2)}`);
    check("знак у края кадра не ломает сборку", fs.existsSync(await renderMarked([{ x: 0.85, y: 0.9, w: 0.15, h: 0.1 }, { x: 0, y: 0, w: 0.2, h: 0.05, mode: "smooth" }], "edge")));

    console.log("раскладка, маски, удаление фона");
    // Два слоя в ячейках «2 сверху вниз»: верх — из первого фото, низ — из второго.
    const red = path.join(tmp, "red.png");
    const blue = path.join(tmp, "blue.png");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xE02020:s=800x600", "-frames:v", "1", red]);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2040E0:s=600x900", "-frames:v", "1", blue]);
    const renderLayers = async (layers, name, clipExtra = {}) => {
      const project = montage.normalizeProject({ canvas: { preset: "9:16", width: 540, height: 960, fps: 25 }, clips: [{ src: bg, kind: "image", in: 0, out: 1.5, ...clipExtra }], layers, captions: { enabled: false } });
      const out = path.join(tmp, `${name}.mp4`);
      await montage.renderProject({ bin: ffmpeg, project, outPath: out, workDir: path.join(tmp, `w-${name}`) });
      return out;
    };
    const px = (file, x, y) => {
      const b = execFileSync(ffmpeg, ["-loglevel", "error", "-ss", "0.7", "-i", file, "-frames:v", "1", "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"]);
      return [b[0], b[1], b[2]];
    };
    const isRed = (c) => c[0] > 170 && c[2] < 90;
    const isBlue = (c) => c[2] > 170 && c[0] < 90;
    const split = await renderLayers([
      { src: red, kind: "image", start: 0, out: 1.5, track: 1, cell: { x: 0, y: 0, w: 1, h: 0.5 } },
      { src: blue, kind: "image", start: 0, out: 1.5, track: 2, cell: { x: 0, y: 0.5, w: 1, h: 0.5 } },
    ], "split");
    check("раскладка: верх — первое видео, низ — второе, без полей", isRed(px(split, 270, 100)) && isRed(px(split, 5, 470)) && isBlue(px(split, 270, 800)) && isBlue(px(split, 535, 490)), JSON.stringify([px(split, 270, 100), px(split, 270, 800)]));

    const heart = await renderLayers([{ src: red, kind: "image", start: 0, out: 1.5, track: 1, cell: { x: 0.1, y: 0.2, w: 0.8, h: 0.45 }, mask: "heart", maskStroke: 10, maskStrokeColor: "#00FF00" }], "heart");
    const grey = (c) => Math.abs(c[0] - 64) < 20 && Math.abs(c[1] - 64) < 20 && Math.abs(c[2] - 64) < 20;
    check("маска-сердце: в центре — слой, в углу ячейки — фон", isRed(px(heart, 270, 380)) && grey(px(heart, 70, 210)), JSON.stringify([px(heart, 270, 380), px(heart, 70, 210)]));
    let green = 0;
    for (let y = 192; y < 624; y += 6) {
      const c = px(heart, 140, y);
      if (c[1] > 150 && c[0] < 120) green++;
    }
    // Обводка — зелёное кольцо по краю сердца где-то на вертикали слева.
    check("обводка маски рисуется по контуру", green >= 1, green);

    // Удаление фона: маска — белый круг на чёрном (как ответ нейросети).
    const mask = path.join(tmp, "mask.mp4");
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x448:d=2,format=gray,geq=lum='255*lte(hypot(X-128,Y-224),30)'", "-c:v", "libx264", "-pix_fmt", "yuv420p", mask]);
    const photoLayer = { src: red, kind: "image", start: 0, out: 1.5, track: 1, transform: { x: 0.5, y: 0.5, scale: 1 } };
    const bgItem = montage.normalizeProject({ layers: [{ ...photoLayer, bgRemove: { enabled: true } }] }).layers[0];
    const cut = await renderLayers([{ ...photoLayer, bgRemove: { enabled: true, cache: { key: montage.bgKey(bgItem), mask, preview: "" } } }], "bglayer");
    check("слой без фона: объект виден, фон прозрачный", isRed(px(cut, 270, 480)) && grey(px(cut, 30, 480)), JSON.stringify([px(cut, 270, 480), px(cut, 30, 480)]));
    const clipItem = montage.normalizeProject({ clips: [{ src: red, kind: "image", in: 0, out: 1.5, bgRemove: { enabled: true, replace: "color", color: "#00FF00" } }] }).clips[0];
    const project = montage.normalizeProject({ canvas: { preset: "9:16", width: 540, height: 960, fps: 25 }, clips: [{ ...clipItem, bgRemove: { ...clipItem.bgRemove, cache: { key: montage.bgKey(clipItem), mask, preview: "" } } }], captions: { enabled: false } });
    const replaced = path.join(tmp, "bgclip.mp4");
    await montage.renderProject({ bin: ffmpeg, project, outPath: replaced, workDir: path.join(tmp, "w-bgclip") });
    const g = px(replaced, 20, 480);
    check("фон главного видео заменён цветом, объект на месте", g[1] > 180 && g[0] < 80 && isRed(px(replaced, 270, 480)), JSON.stringify([g, px(replaced, 270, 480)]));

    console.log("надписи: интервал, выравнивание, обводка");
    const multi = montage.normalizeProject({ canvas: { preset: "9:16" }, clips: [{ src: bg, kind: "image", out: 2 }], texts: [{ text: "строка один\nстрока два", lineHeight: 0.7, align: "left", outline: 4, shadow: 5, x: 0.1, y: 0.4, start: 0, end: 2 }], captions: { enabled: false } });
    const dialogues = montage.buildAss(multi, [], {}).split("\n").filter((l) => l.startsWith("Dialogue"));
    const ys = dialogues.map((d) => Number((d.match(/\\pos\(\d+,(\d+)\)/) || [])[1]));
    check("межстрочный интервал: каждая строка своим событием, шаг меньше обычного", dialogues.length === 2 && ys[1] - ys[0] > 0 && ys[1] - ys[0] < 104 * 1.2, JSON.stringify(ys));
    check("выравнивание по левому краю и обводка с тенью", dialogues.every((d) => /\\an4/.test(d) && /\\bord4/.test(d) && /\\shad5/.test(d)));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.stack ? e.stack : e);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    if (!process.env.KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(tmp);
    finish(failures, (c) => process.exit(c));
  }
})();
