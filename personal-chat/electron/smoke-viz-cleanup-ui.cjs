// Визуализация и клининг в живом приложении: макет действительно сохраняется в
// PNG/PDF/HTML нужного размера, разбор папки действительно двигает файлы и
// действительно откатывается.
//   xvfb-run -a npx electron electron/smoke-viz-cleanup-ui.cjs

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "viz-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "viz-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "viz-work-"));

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

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url.split("?")[0].endsWith("/models")) return res.end(JSON.stringify({ data: [] }));
    res.end(JSON.stringify({ choices: [{ message: { content: "ок" } }], usage: {} }));
  });
});

function cleanupDirs() {
  server.close();
  for (const dir of [userData, dataRoot, workDir]) fs.rmSync(dir, { recursive: true, force: true });
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

      console.log("разделы в меню");
      const menu = await call(`[...document.querySelectorAll(".sidebar-item")].map(n => n.textContent).join("|")`);
      check("«Визуализация» есть в меню", menu.includes("Визуализация"), menu);
      check("«Клининг» есть в меню", menu.includes("Клининг"), menu);

      console.log("\nвизуализация: задание");
      const dataFile = path.join(workDir, "расход.csv");
      fs.writeFileSync(dataFile, "месяц,расход\nиюнь,90000\nиюль,110000\nавгуст,150000", "utf-8");
      const prepared = await call(
        `window.api.prepareDataviz(${JSON.stringify({
          kindId: "chart",
          presetId: "post",
          paletteId: "brand",
          paletteOverrides: { accent: "#00D9FF" },
          sourcePaths: [dataFile],
          extraStyle: "крупные цифры",
        })})`
      );
      check("холст выбран", prepared.preset.width === 1080 && prepared.preset.height === 1350);
      check("ручной цвет попал в палитру", prepared.palette.accent === "#00D9FF", prepared.palette.accent);
      check("данные прочитаны в промпт", prepared.prompt.includes("110000"));
      check("пожелание по стилю передано", prepared.prompt.includes("крупные цифры"));

      console.log("\nвизуализация: сохранение");
      const layout = `<div style="width:1080px;height:1350px;padding:60px;box-sizing:border-box">
        <h1 style="font-size:64px;margin:0 0 40px">Расход вырос на 67%</h1>
        <svg width="900" height="500">
          <rect x="0" y="200" width="200" height="300" fill="#FF2F6D"></rect>
          <rect x="250" y="120" width="200" height="380" fill="#B23CC4"></rect>
          <rect x="500" y="0" width="200" height="500" fill="#0095B0"></rect>
        </svg>
        <p style="font-size:32px">июнь 90 000 · июль 110 000 · август 150 000</p>
      </div>`;
      const outDir = path.join(workDir, "готовые");
      const saved = await call(
        `window.api.saveDataviz(${JSON.stringify({
          html: layout,
          title: "Расход за лето",
          presetId: "post",
          paletteId: "brand",
          paletteOverrides: {},
          outputDir: outDir,
          formats: ["png", "pdf", "html"],
        })})`
      );
      check("PNG сохранён", fs.existsSync(saved.png), saved.png);
      check("PDF сохранён", fs.existsSync(saved.pdf), saved.pdf);
      check("HTML сохранён рядом", fs.existsSync(saved.html), saved.html);
      check("имя файла из заголовка", path.basename(saved.png) === "Расход за лето.png", saved.png);

      // Размер PNG читается из заголовка самого файла: подпись «1080×1350» в коде
      // ничего не доказывает, а обрезанный макет — самая вероятная поломка здесь.
      const png = fs.readFileSync(saved.png);
      const pngWidth = png.readUInt32BE(16);
      const pngHeight = png.readUInt32BE(20);
      check("PNG ровно в размер холста, а не обрезан по экрану", pngWidth === 1080 && pngHeight === 1350, `${pngWidth}×${pngHeight}`);
      check("PDF непустой", fs.statSync(saved.pdf).size > 1000, String(fs.statSync(saved.pdf).size));

      console.log("\nклининг: осмотр папки");
      const messy = path.join(workDir, "разобрать");
      fs.mkdirSync(path.join(messy, "июль"), { recursive: true });
      fs.writeFileSync(path.join(messy, "screenshot_1.png"), "x");
      fs.writeFileSync(path.join(messy, "screenshot_2.png"), "x");
      fs.writeFileSync(path.join(messy, "Акт 41.docx"), "x");
      fs.writeFileSync(path.join(messy, "июль", "старый акт.docx"), "x");

      const scan = await call(`window.api.prepareCleanup(${JSON.stringify({ folderPath: messy, mode: "tidy", notes: "" })})`);
      check("файлы посчитаны", scan.fileCount === 4, String(scan.fileCount));
      check("подпапка учтена", scan.folderCount === 1, String(scan.folderCount));
      check("опись попала в промпт", scan.prompt.includes("screenshot_1.png"));
      check("удаление агенту запрещено", scan.prompt.includes("Удалять нельзя"));

      console.log("\nклининг: разбор и откат");
      const plan = await call(
        `window.api.parseCleanupPlan(${JSON.stringify(`===ПЛАН===
MKDIR: Скриншоты
MOVE: screenshot_1.png -> Скриншоты/screenshot_1.png
MOVE: screenshot_2.png -> Скриншоты/screenshot_2.png
RENAME: июль -> июль 2025
===КОНЕЦ===`)})`
      );
      check("план разобран", plan.ops.length === 4, JSON.stringify(plan.ops.map((o) => o.op)));

      const applied = await call(`window.api.applyCleanupPlan(${JSON.stringify(messy)}, ${JSON.stringify(plan)})`);
      check("разбор выполнен без ошибок", applied.failed.length === 0, JSON.stringify(applied.failed));
      check("скриншоты в своей папке", fs.existsSync(path.join(messy, "Скриншоты", "screenshot_1.png")));
      check("папка переименована с годом", fs.existsSync(path.join(messy, "июль 2025", "старый акт.docx")));
      check("документ, который не трогали, на месте", fs.existsSync(path.join(messy, "Акт 41.docx")));

      await call(`window.api.undoCleanup(${JSON.stringify(messy)}, ${JSON.stringify(applied.done)})`);
      check("после отката скриншоты вернулись", fs.existsSync(path.join(messy, "screenshot_1.png")));
      check("после отката папка снова «июль»", fs.existsSync(path.join(messy, "июль", "старый акт.docx")));
      check("пустая папка убрана", !fs.existsSync(path.join(messy, "Скриншоты")));

      console.log("\nклининг: сверка");
      const ledgerParsed = await call(
        `window.api.parseCleanupLedger(${JSON.stringify(`===СВЕРКА===
ЛИСТ: Договоры
Номер | Дата | Предмет | Контрагент | Файл
12 | 01.03.2026 | Продвижение | ИП Павлов | Договор 12.docx
ЛИСТ: Акты
Номер | Дата | Предмет | Сумма | Контрагент | Файл
41 | 31.07.2026 | SMM | 110000 | ИП Павлов | Акт 41.docx
ЛИСТ: ТЗ
Номер | Дата | Предмет | Сумма | Контрагент | Файл
ЛИСТ: Счета
Номер | Дата | Сумма | Основание | Контрагент | Файл
===КОНЕЦ===`)})`
      );
      check("четыре листа разобраны", ledgerParsed.sheets.length === 4, String(ledgerParsed.sheets.length));
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanupDirs();
      app.exit(failures === 0 ? 0 : 1);
    }
  });
});
