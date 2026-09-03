// Предпросмотр визуализации: то, что человек видит после ответа агента.
//   xvfb-run -a npx electron electron/smoke-viz-preview.cjs
//
// Здесь проверяются ровно те две поломки, из-за которых раздел выглядел
// неработающим, хотя макет приходил:
//   1. Рамка предпросмотра занимала полный размер холста (1080×1350) — уменьшение
//      через transform разметку не сжимает, — вылезала за окно и выталкивала за
//      его край кнопку сохранения.
//   2. Фрейм оставался белым: пустой документ и разметка грузились наперегонки,
//      и выигрывал пустой.
//
// Второе нельзя проверить, заглянув внутрь фрейма (он изолирован), поэтому
// проверяется снимком: область предпросмотра не должна быть однотонной.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "vizprev-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vizprev-data-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const LAYOUT = `Построил дашборд.

===ВИЗУАЛИЗАЦИЯ===
TITLE: Расход за лето
===HTML===
<div style="width:1080px;height:1350px;padding:60px;box-sizing:border-box">
  <h1 style="font-size:64px;margin:0 0 30px">Расход вырос на 67%</h1>
  <svg width="900" height="500">
    <rect x="0" y="200" width="200" height="300" fill="#FF2F6D"></rect>
    <rect x="250" y="120" width="200" height="380" fill="#B23CC4"></rect>
    <rect x="500" y="0" width="200" height="500" fill="#0095B0"></rect>
  </svg>
</div>
===КОНЕЦ===`;

// Обрезанный ответ: агент начал макет и не дописал — так выглядит упёршийся в
// лимит токенов ответ, и человеку об этом надо сказать словами.
const TRUNCATED = `Строю дашборд.

===ВИЗУАЛИЗАЦИЯ===
TITLE: Расход
===HTML===
<div style="width:1080px;height:1350px">
  <h1>Расход вы`;

let reply = LAYOUT;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.split("?")[0].endsWith("/models")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [] }));
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of reply.match(/[\s\S]{1,200}/g) || []) {
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + "\n\n");
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

function cleanup() {
  server.close();
  for (const dir of [userData, dataRoot]) fs.rmSync(dir, { recursive: true, force: true });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  fs.writeFileSync(
    path.join(userData, "settings.json"),
    JSON.stringify({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test",
      model: "anthropic/claude-sonnet-5",
      temperature: 0.7,
      maxTokens: 4000,
      proxyMode: "direct",
      searchEnabled: false,
    })
  );

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
      const call = (expr) => win.webContents.executeJavaScript(expr);
      await new Promise((r) => setTimeout(r, 1200));

      const openViz = async () => {
        await call(
          `[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Визуализация")).click()`
        );
        await new Promise((r) => setTimeout(r, 700));
        await call(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Собрать задание")).click()`);
        await new Promise((r) => setTimeout(r, 1200));
      };
      const send = async (text) => {
        await call(`(async () => {
          const box = document.querySelector(".chat-input-bar textarea");
          const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          set.call(box, ${JSON.stringify(text)});
          box.dispatchEvent(new Event("input", { bubbles: true }));
          await new Promise(r => setTimeout(r, 150));
          [...document.querySelectorAll(".chat-input-bar button")].find(b => b.textContent.trim() === "Отправить").click();
        })()`);
        await new Promise((r) => setTimeout(r, 4000));
      };

      console.log("готовый макет");
      await openViz();
      await send("построй дашборд");

      const geometry = JSON.parse(
        await call(`JSON.stringify({
          hasPreview: !!document.querySelector(".viz-preview"),
          wrap: (() => { const w = document.querySelector(".viz-preview-wrap"); if (!w) return null;
            const r = w.getBoundingClientRect();
            return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          save: (() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Сохранить");
            if (!b) return null; const r = b.getBoundingClientRect();
            return { x: Math.round(r.x), inWindow: r.x >= 0 && r.right <= window.innerWidth }; })(),
          windowWidth: window.innerWidth
        })`)
      );

      check("предпросмотр появился", geometry.hasPreview === true);
      check(
        "рамка уменьшена, а не в полный холст",
        geometry.wrap && geometry.wrap.w < 500 && geometry.wrap.h < 600,
        JSON.stringify(geometry.wrap)
      );
      check("рамка помещается в окно", geometry.wrap && geometry.wrap.x + geometry.wrap.w <= geometry.windowWidth, JSON.stringify(geometry.wrap));
      check("кнопка сохранения видна на экране", geometry.save && geometry.save.inWindow === true, JSON.stringify(geometry.save));

      // Внутрь изолированного фрейма не заглянуть, поэтому смотрим на пиксели.
      // Снимок берём с отступом внутрь рамки: если захватить её целиком, в кадр
      // попадут граница и фон страницы — они дадут разные цвета даже у пустого
      // фрейма, и проверка перестанет что-либо значить.
      // Кусок берём небольшой и с отступом от края: capturePage подрезает область
      // по границе окна, поэтому крупный кадр всё равно зацепит рамку и фон
      // страницы — а они дают разные цвета даже у пустого фрейма.
      const region = {
        x: geometry.wrap.x + 20,
        y: geometry.wrap.y + 20,
        width: Math.min(200, geometry.wrap.w - 40),
        height: Math.min(200, geometry.wrap.h - 40),
      };
      const shot = await win.webContents.capturePage(region);
      const bitmap = shot.toBitmap();
      const colours = new Set();
      for (let i = 0; i < bitmap.length; i += 4 * 37) {
        colours.add(`${bitmap[i]},${bitmap[i + 1]},${bitmap[i + 2]}`);
      }
      check("в предпросмотре действительно что-то нарисовано", colours.size > 3, `разных цветов: ${colours.size}`);
      fs.writeFileSync(path.join(os.tmpdir(), "viz-preview.png"), shot.toPNG());

      console.log("\nоборванный ответ");
      reply = TRUNCATED;
      await openViz();
      await send("построй ещё один");
      const problem = await call(
        `(document.querySelector(".viz-problem") || {}).textContent || ""`
      );
      check("человеку сказано, что ответ оборвался", problem.includes("оборвался"), problem.slice(0, 120));
      check("названа причина, которую можно поправить", problem.includes("Max tokens"), problem.slice(0, 160));
      check("предложено переспросить", problem.includes("Переделать") || problem.includes("переделыв"), problem.slice(0, 160));
      check(
        "сохранять при этом нечего — кнопки нет",
        (await call(`[...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Сохранить")`)) === false
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
});
