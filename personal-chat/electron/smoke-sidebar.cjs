// Проверяет, что список проектов виден и прокручивается, когда включены все
// разделы, а окно невысокое.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-sidebar.cjs
//
// Беда, ради которой написан тест: разделов в меню стало пятнадцать, они росли
// вниз без ограничения и выдавливали проекты за нижний край колонки. На ноутбуке
// проектов не было видно совсем, и добраться до них было нечем — прокрутки не
// было ни у списка, ни у колонки.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "personal-chat-sidebar-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "personal-chat-sidebar-data-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));

require("./main.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

/** Меряет колонку: видно ли список проектов и достаётся ли до последнего. */
const MEASURE = `(() => {
  const box = document.querySelector(".sidebar-projects");
  const bar = document.querySelector(".sidebar");
  const foot = document.querySelector(".sidebar-footer");
  if (!box || !bar || !foot) return { missing: true };
  const items = [...box.querySelectorAll(".sidebar-item-project")];
  box.scrollTop = box.scrollHeight;
  const last = items[items.length - 1];
  const lastBox = last ? last.getBoundingClientRect() : null;
  const boxRect = box.getBoundingClientRect();
  return {
    items: items.length,
    projectsHeight: Math.round(boxRect.height),
    projectsScrolls: box.scrollHeight > box.clientHeight + 1,
    modules: foot.querySelectorAll(".sidebar-item").length,
    footScrolls: foot.scrollHeight > foot.clientHeight + 1,
    // Колонка целиком не должна вылезать за окно: если вылезла, часть меню
    // недостижима — прокрутки у самой колонки нет.
    barOverflow: Math.round(bar.scrollHeight - bar.clientHeight),
    // Последний проект после прокрутки списка обязан оказаться внутри него.
    lastVisible: !!lastBox && lastBox.bottom <= boxRect.bottom + 1 && lastBox.top >= boxRect.top - 1,
    windowHeight: window.innerHeight,
  };
})()`;

app.whenReady().then(async () => {
  try {
    let win;
    const deadline = Date.now() + 20000;
    while (!win && Date.now() < deadline) {
      [win] = BrowserWindow.getAllWindows();
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    if (!win) throw new Error("окно не появилось");
    await new Promise((resolve) => {
      if (!win.webContents.isLoading()) return resolve();
      win.webContents.once("did-finish-load", resolve);
    });
    const call = (js) => win.webContents.executeJavaScript(js);

    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (await call(`!!document.querySelector(".sidebar-footer .sidebar-item")`)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Восемь проектов и невысокое окно — обычный ноутбук.
    for (let i = 1; i <= 8; i++) {
      await call(
        `window.api.createProject({ name: ${JSON.stringify("Проект " + i)}, description: "", instructions: "" })`
      );
    }
    await call(`location.reload()`);
    await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    const ready = Date.now() + 20000;
    while (Date.now() < ready) {
      if ((await call(`document.querySelectorAll(".sidebar-item-project").length`)) >= 8) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    win.setBounds({ width: 1180, height: 620 });
    await new Promise((r) => setTimeout(r, 500));

    console.log("\nневысокое окно, все разделы включены");
    const m = await call(MEASURE);
    check("разделов в меню действительно много", m.modules >= 10, JSON.stringify(m));
    check("окно низкое", m.windowHeight < 640, String(m.windowHeight));
    check("список проектов не схлопнулся", m.projectsHeight > 80, JSON.stringify(m));
    check("все восемь проектов в списке", m.items === 8, JSON.stringify(m));
    check("до последнего проекта можно прокрутить", m.lastVisible === true, JSON.stringify(m));
    check("колонка целиком за окно не вылезает", m.barOverflow <= 1, JSON.stringify(m));
    console.log(
      `     (список ${m.projectsHeight} px, прокрутка списка ${m.projectsScrolls ? "есть" : "не нужна"}, ` +
        `прокрутка разделов ${m.footScrolls ? "есть" : "не нужна"})`
    );

    // Та же мерка на прежних правилах: список рос без ограничения, а разделы
    // занимали столько, сколько хотели. Если тест не различает эти два случая,
    // он ничего не проверяет.
    await call(`(() => {
      const s = document.createElement("style");
      s.id = "as-before";
      s.textContent =
        ".sidebar { overflow: visible !important; }" +
        ".sidebar-projects { flex: none !important; overflow: visible !important; min-height: 0 !important; }" +
        ".sidebar-footer { max-height: none !important; overflow: visible !important; flex: none !important; }";
      document.head.appendChild(s);
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    const before = await call(MEASURE);
    check(
      "на прежних правилах колонка вылезала за окно — тест это ловит",
      before.barOverflow > 1,
      JSON.stringify(before)
    );
    console.log(`     (было: колонка выше окна на ${before.barOverflow} px и без прокрутки)`);
    await call(`document.getElementById("as-before").remove()`);

    console.log("\nвысокое окно");
    win.setBounds({ width: 1180, height: 1000 });
    await new Promise((r) => setTimeout(r, 500));
    const tall = await call(MEASURE);
    check("на высоком окне прокрутка списку не нужна", tall.projectsScrolls === false, JSON.stringify(tall));
    check("и проекты по-прежнему все видны", tall.items === 8 && tall.lastVisible === true, JSON.stringify(tall));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  }
});

app.on("window-all-closed", () => {});
