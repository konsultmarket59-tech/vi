// ИИ-моушн и заготовки титров: код → проверка → рендер → сборка ролика.
//   xvfb-run -a -s "-screen 0 2560x2560x24" npx electron --no-sandbox electron/smoke-motion.cjs
//
// Модель подменена местным сервером с тем же протоколом (поток SSE): так
// проверяется весь путь — задание, разбор ответа, проверка в браузере,
// исправление по замечаниям — без сети и без оплаты.

const { app, BrowserWindow, nativeImage } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { finish } = require("./finish.cjs");
const motion = require("./motion.cjs");
const mr = require("./motionRender.cjs");
const templates = require("./motionTemplates.cjs");
const agent = require("./motionAgent.cjs");
const montage = require("./montage.cjs");
const { EXAMPLE } = require("./motionExample.cjs");
const ffmpeg = require("ffmpeg-static");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 400) : ""}`);
  }
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

/** Сервер-«модель»: отвечает по очереди заготовленными ответами, потоком. */
function mockModel(replies) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push(JSON.parse(body));
      const text = replies[Math.min(seen.length - 1, replies.length - 1)];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (let i = 0; i < text.length; i += 400) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 400) } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 2000 } })}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/v1` })));
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mt-motion-"));
  try {
    const W = 540;
    const H = 960;
    const ctxBase = { BrowserWindow, nativeImage, ffmpeg, tmpDir: tmp, usage: { record: async () => {}, estimateTokens: (s) => Math.ceil(String(s).length / 4) } };

    console.log("разбор ответа модели");
    const reply = "Раскадровка:\n1. Хук\n2. Цифра\n```html\n<div>x</div>\n```";
    check("код из блока ```html", motion.extractCode(reply) === "<div>x</div>");
    check("раскадровка — строки сцен", motion.extractStoryboard(reply).length === 2);
    check("недописанный блок тоже читается", motion.extractCode("```html\n<style></style><div>y") === "<style></style><div>y");

    console.log("документ и проверка");
    const doc = motion.buildDoc({ html: EXAMPLE, width: W, height: H });
    const info = await mr.inspect(BrowserWindow, doc, { width: W, height: H, tmpDir: tmp });
    check("образец без ошибок", info.errors.length === 0, info.errors.join("; "));
    check("длительность — по шкале", info.duration > 14 && info.duration < 18, info.duration);
    const broken = await mr.inspect(BrowserWindow, motion.buildDoc({ html: "<div class='a'>x</div><script>tl.to('.a',{x:10,duration:1}); missing();</script>", width: W, height: H }), { width: W, height: H, tmpDir: tmp });
    check("ошибка скрипта ловится", broken.errors.some((e) => /missing/.test(e)), JSON.stringify(broken.errors));
    const edge = await mr.inspect(BrowserWindow, motion.buildDoc({ html: "<div style='position:absolute;left:400px;top:100px;font-size:80px;white-space:nowrap'>Очень длинный заголовок</div><script>tl.to({}, {duration: 2})</script>", width: W, height: H }), { width: W, height: H, tmpDir: tmp });
    check("текст за краем кадра замечен", edge.audit.some((a) => a.kind === "edge"));
    check("замечание для модели", motion.describeAudit(edge).some((s) => /за краем/.test(s)));

    console.log("заготовки титров");
    const theme = templates.templateTheme(["#0B0B12", "#5B5BF0", "#FFFFFF", "#FF5A36"]);
    const list = templates.list();
    check("заготовок не меньше 18", list.length >= 18, list.length);
    let bad = [];
    for (const t of list) {
      const b = templates.build(t.id, {}, theme, {});
      const r = await mr.inspect(BrowserWindow, motion.buildDoc({ html: b.html, width: 1080, height: 1920, transparent: true }), { width: 1080, height: 1920, transparent: true, tmpDir: tmp });
      if (r.errors.length || r.duration < 1 || r.audit.some((a) => a.kind === "edge")) bad.push(`${t.id}: ${r.errors.join(",")} ${r.duration} ${JSON.stringify(r.audit.slice(0, 2))}`);
    }
    check("все заготовки работают и не вылезают за кадр", bad.length === 0, bad.join("\n"));
    const custom = templates.build("headline-slam", { title: "Тест <b>&" }, theme, {});
    check("поля экранируются", custom.html.includes("&lt;b&gt;&amp;") && !custom.html.includes("<b>&"));

    console.log("ИИ-моушн с подменённой моделью");
    // Первый ответ с ошибкой — программа должна попросить исправить и взять второй.
    const brokenReply = "1. Хук\n2. Цена\n```html\n<div class='a'>x</div><script>tl.to('.a',{x:10,duration:1}); missing();</script>\n```";
    const goodReply = "1. Хук\n```html\n" + EXAMPLE + "\n```";
    const mock = await mockModel([brokenReply, goodReply]);
    const events = [];
    const r = await agent.generate(
      { ...ctxBase, settings: { apiKey: "test", model: "mock", baseUrl: mock.url } },
      { design: { colours: ["#0B0B12", "#5B5BF0"], fontFiles: [], logoFiles: [], vars: [] }, text: "Посёлок, 18 домов, от 7,4 млн", width: 1080, height: 1920, duration: 15, review: false },
      (p) => events.push(p)
    );
    check("модель получила дизайн и текст", /Посёлок/.test(JSON.stringify(mock.seen[0].messages)) && /--c2: #5B5BF0/.test(JSON.stringify(mock.seen[0].messages)));
    check("запрос — потоком", mock.seen[0].stream === true);
    check("ошибка ушла модели на исправление", mock.seen.length === 2 && /missing/.test(JSON.stringify(mock.seen[1].messages)), mock.seen.length);
    check("итог — исправленный код", r.html.includes("Запишитесь") && r.problems.length === 0, r.problems.join("; "));
    check("раскадровка показана", r.storyboard.length === 2);
    check("ход работы — событиями", events.some((e) => e.stage === "write" && e.chars > 0) && events.some((e) => e.stage === "repair"));
    mock.server.close();

    console.log("моушн в проекте → сборка mp4");
    const project = montage.normalizeProject({
      title: "моушн",
      canvas: { preset: "9:16", width: W, height: H, fps: 25 },
      clips: [{ kind: "motion", in: 0, out: 3, motion: { html: EXAMPLE, duration: 16 } }],
      layers: [{ kind: "motion", start: 0.5, motion: { template: "lower-third", fields: { name: "Анна" }, duration: 4.45, transparent: true } }],
    });
    check("моушн-кусок сохраняет код", project.clips[0].kind === "motion" && project.clips[0].motion.html.length > 100 && project.clips[0].src.startsWith("motion://"));
    check("титр-слой — во весь кадр", project.layers[0].kind === "motion" && project.layers[0].transform.scale === 1 && project.layers[0].out === 4.45);
    const readDesignFolder = async () => null;
    const cacheDir = path.join(tmp, "cache");
    const t0 = Date.now();
    await agent.prerender({ ...ctxBase }, project, { cacheDir, readDesignFolder });
    const firstMs = Date.now() - t0;
    check("перед сборкой моушн стал файлами", project.clips[0].kind === "video" && fs.existsSync(project.clips[0].src) && /\.mov$/.test(project.layers[0].src), JSON.stringify([project.clips[0].src, project.layers[0].src]));
    const again = montage.normalizeProject({ canvas: { preset: "9:16", width: W, height: H, fps: 25 }, clips: [{ kind: "motion", in: 0, out: 3, motion: { html: EXAMPLE, duration: 16 } }] });
    const t1 = Date.now();
    await agent.prerender({ ...ctxBase }, again, { cacheDir, readDesignFolder });
    check("второй раз — из кэша, без рендера", Date.now() - t1 < Math.max(800, firstMs / 4), `${Date.now() - t1} мс против ${firstMs}`);
    const out = path.join(tmp, "out.mp4");
    const work = path.join(tmp, "work");
    await montage.renderProject({ bin: ffmpeg, project, outPath: out, workDir: work });
    const probe = await montage.probeMedia(ffmpeg, out);
    check("ролик с моушном собран", fs.existsSync(out) && probe.hasVideo && Math.abs(probe.duration - 3) < 0.3, JSON.stringify(probe));
    let refused = "";
    try {
      await montage.renderProject({ bin: ffmpeg, project: montage.normalizeProject({ clips: [{ kind: "motion", motion: { html: EXAMPLE } }] }), outPath: out, workDir: work });
    } catch (e) {
      refused = e.message;
    }
    check("без предрендера сборка честно отказывает", /Моушн не отрендерен/.test(refused), refused);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.stack ? e.stack : e);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
