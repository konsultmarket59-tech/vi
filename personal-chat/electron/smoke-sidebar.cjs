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
const { finish } = require("./smoke-finish.cjs");

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

    console.log("\nграница колонки двигается мышью");
    // Окна у всех разные: то нужен широкий список проектов, то весь экран под
    // таблицу. Граница между колонкой и рабочей областью — подвижная.
    const тянем = await call(`(async () => {
      const bar = document.querySelector(".splitter");
      if (!bar) return { нет: true };
      const колонка = document.querySelector(".sidebar");
      const было = Math.round(колонка.getBoundingClientRect().width);
      const r = bar.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const опции = { bubbles: true, clientY: y, pointerId: 1, isPrimary: true, button: 0 };
      bar.dispatchEvent(new PointerEvent("pointerdown", { ...опции, clientX: x }));
      bar.dispatchEvent(new PointerEvent("pointermove", { ...опции, clientX: x + 120 }));
      bar.dispatchEvent(new PointerEvent("pointerup", { ...опции, clientX: x + 120 }));
      await new Promise(r2 => setTimeout(r2, 60));
      return {
        было,
        стало: Math.round(колонка.getBoundingClientRect().width),
        // Сохранённое значение — то, что переживёт перезапуск.
        запомнено: localStorage.getItem("граница:боковая-колонка"),
      };
    })()`);
    check("разделитель на месте", !тянем.нет, JSON.stringify(тянем));
    if (!тянем.нет) {
      check("колонка стала шире после перетаскивания",
        тянем.стало - тянем.было > 100, `${тянем.было} → ${тянем.стало} px`);
      check("новая ширина запомнена", Number(тянем.запомнено) === тянем.стало,
        `${тянем.запомнено} против ${тянем.стало}`);
      console.log(`     (${тянем.было} → ${тянем.стало} px, запомнено ${тянем.запомнено})`);

      // Шире окна колонку не растянуть: иначе рабочая область исчезнет совсем.
      const предел = await call(`(async () => {
        const bar = document.querySelector(".splitter");
        const колонка = document.querySelector(".sidebar");
        const r = bar.getBoundingClientRect();
        const опции = { bubbles: true, clientY: r.top + 5, pointerId: 2, isPrimary: true, button: 0 };
        bar.dispatchEvent(new PointerEvent("pointerdown", { ...опции, clientX: r.left }));
        bar.dispatchEvent(new PointerEvent("pointermove", { ...опции, clientX: r.left + 5000 }));
        bar.dispatchEvent(new PointerEvent("pointerup", { ...опции, clientX: r.left + 5000 }));
        await new Promise(r2 => setTimeout(r2, 60));
        return { ширина: Math.round(колонка.getBoundingClientRect().width), окно: window.innerWidth };
      })()`);
      check("колонка не съедает всё окно", предел.ширина <= 520, JSON.stringify(предел));
      check("рабочей области осталось место",
        предел.окно - предел.ширина > 300, JSON.stringify(предел));

      // Двойной щелчок возвращает исходную ширину — и забывает запомненную.
      const сброс = await call(`(async () => {
        const bar = document.querySelector(".splitter");
        bar.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await new Promise(r2 => setTimeout(r2, 60));
        return {
          ширина: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
          запомнено: localStorage.getItem("граница:боковая-колонка"),
        };
      })()`);
      check("двойной щелчок вернул исходную ширину", сброс.ширина === 260, JSON.stringify(сброс));
      check("и запомненное значение забыто", сброс.запомнено === null, JSON.stringify(сброс));

      // Запомненная ширина должна пережить перезапуск окна.
      await call(`localStorage.setItem("граница:боковая-колонка", "410")`);
      await call(`location.reload()`);
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await new Promise((r) => setTimeout(r, 1500));
      const после = await call(`Math.round(document.querySelector(".sidebar").getBoundingClientRect().width)`);
      check("запомненная ширина пережила перезапуск", после === 410, String(после));
    }

    console.log("\nагент рядом с таблицей в Excel и Word");
    // Классы excel-split / excel-grid-pane / excel-agent-pane стояли в разметке
    // этих разделов, а правил у них не было ни одного: «рядом» получалось
    // только на словах, панели шли одна под другой. Проверяем саму раскладку.
    const рядом = await call(`(() => {
      const box = document.createElement("div");
      box.className = "ops-app-body excel-split";
      box.style.cssText = "position:fixed;left:0;top:0;width:900px;height:300px";
      box.innerHTML = '<div class="excel-grid-pane"></div><div class="excel-agent-pane"></div>';
      document.body.appendChild(box);
      const таблица = box.querySelector(".excel-grid-pane").getBoundingClientRect();
      const агент = box.querySelector(".excel-agent-pane").getBoundingClientRect();
      const итог = {
        рядом: Math.abs(таблица.top - агент.top) < 2 && агент.left >= таблица.right - 2,
        ширинаАгента: Math.round(агент.width),
        ширинаТаблицы: Math.round(таблица.width),
      };
      // И граница двигает именно эту панель.
      document.documentElement.style.setProperty("--dock-agent-width", "520px");
      итог.послеГраницы = Math.round(box.querySelector(".excel-agent-pane").getBoundingClientRect().width);
      document.documentElement.style.removeProperty("--dock-agent-width");
      box.remove();
      return итог;
    })()`);
    check("панели стоят рядом, а не одна под другой", рядом.рядом === true, JSON.stringify(рядом));
    check("таблице досталась вся оставшаяся ширина",
      рядом.ширинаТаблицы + рядом.ширинаАгента >= 898, JSON.stringify(рядом));
    check("граница двигает окно агента", рядом.послеГраницы === 520, JSON.stringify(рядом));
    console.log(`     (таблица ${рядом.ширинаТаблицы} px, агент ${рядом.ширинаАгента} px → ${рядом.послеГраницы} px)`);

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
    finish(failures, (c) => app.exit(c));
  }
});

app.on("window-all-closed", () => {});
