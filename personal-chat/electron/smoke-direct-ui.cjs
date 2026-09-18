// Раздел «Директ» в окне: «Все аккаунты» в выборе, сводная таблица кампаний,
// фильтры, выбор столбцов и разбор по клику в ячейку.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-direct-ui.cjs
//
// Настоящего Директа здесь нет: обработчик обзора подменяется на данные той же
// формы, что приходят от Яндекса. Проверяется то, что человек видит на экране,
// — а не то, как отвечает Яндекс.

const { app, BrowserWindow, ipcMain } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "direct-ui-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-ui-data-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const directtable = require("./directtable.cjs");

const АККАУНТЫ = [
  {
    id: "a1",
    label: "Болдино",
    login: "boldino",
    clientLogin: "",
    campaigns: [
      { id: 1, name: "ПОИСК // Купить дом", type: "TEXT_CAMPAIGN", state: "ON", status: "ACCEPTED", statusPayment: "ALLOWED", dailyBudget: 1000, startDate: "2026-05-01" },
      { id: 2, name: "РСЯ // Купить дом (копия)", type: "TEXT_CAMPAIGN", state: "ARCHIVED", status: "ACCEPTED", statusPayment: "ALLOWED" },
    ],
    stats: [{ CampaignId: 1, CampaignName: "ПОИСК // Купить дом", Cost: 8000, Impressions: 20000, Clicks: 400, Conversions: 8 }],
    balance: { login: "boldino", amount: 12000, currency: "RUB", debt: 0, discount: 0 },
    issues: [],
    totals: null,
    error: "",
    howToFix: "",
    balanceError: "",
  },
  {
    id: "a2",
    label: "Пылаева",
    login: "pylaeva-victorya",
    clientLogin: "",
    campaigns: [{ id: 9, name: "Ретаргетинг", type: "TEXT_CAMPAIGN", state: "SUSPENDED", status: "ACCEPTED", statusPayment: "ALLOWED" }],
    stats: [{ CampaignId: 9, CampaignName: "Ретаргетинг", Cost: 2000, Impressions: 100000, Clicks: 100, Conversions: 1 }],
    balance: null,
    issues: [],
    totals: null,
    error: "",
    howToFix: "",
    balanceError: "баланс недоступен",
  },
];

function cleanup() {
  for (const d of [userData, dataRoot]) fs.rmSync(d, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { cleanup(); process.exit(1); });
}

fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", model: "m", proxyMode: "direct", searchEnabled: false })
);

// Два подключённых аккаунта Яндекса — иначе выбирать не из чего и селектора
// в шапке просто нет. Токены здесь выдуманные: в сеть тест не ходит.
fs.mkdirSync(path.join(dataRoot, "cloud"), { recursive: true });
fs.writeFileSync(
  path.join(dataRoot, "cloud", "accounts.json"),
  JSON.stringify({
    yandex: {
      activeId: "a1",
      accounts: [
        { id: "a1", label: "Болдино", login: "boldino", token: "t1", directClientLogin: "" },
        { id: "a2", label: "Пылаева", login: "pylaeva-victorya", token: "t2", directClientLogin: "" },
      ],
    },
    google: { token: "" },
  })
);

require("./main.cjs");

app.whenReady().then(async () => {
  try {
    // Обзор подменяем: ходить в настоящий Директ отсюда нечем и незачем.
    ipcMain.removeHandler("direct:overview");
    ipcMain.handle("direct:overview", async () => {
      const rows = directtable.buildRows(АККАУНТЫ);
      return {
        range: { dateFrom: "2026-08-01", dateTo: "2026-09-17" },
        accounts: АККАУНТЫ,
        rows,
        columns: directtable.COLUMNS,
        defaultColumns: directtable.DEFAULT_COLUMNS,
        states: directtable.STATES,
        totals: directtable.totalsOf(rows),
      };
    });
    ipcMain.removeHandler("direct:explainCell");
    ipcMain.handle("direct:explainCell", async (_e, { columnId }) => ({
      column: columnId,
      value: null,
      text: "Разбор ячейки: цена клика получается на аукционе, а не назначается.",
    }));

    let win;
    const deadline = Date.now() + 25000;
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
      if (await call(`!!document.querySelector(".sidebar-item")`)) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("раздел открывается");
    await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Директ")).click()`);
    await new Promise((r) => setTimeout(r, 600));
    check("раздел на экране", (await call(`!!document.querySelector(".project-tabs")`)) === true);

    console.log("\nвкладка «Кампании» показывает сводную таблицу");
    // Одна вкладка — один блок. Дубль означал бы, что часть разметки осталась
    // от прошлой версии и человек видит две разные таблицы подряд.
    await call(`[...document.querySelectorAll(".tab")].find(n => n.textContent.trim() === "Кампании").click()`);
    await new Promise((r) => setTimeout(r, 400));
    check("кнопка загрузки одна", (await call(`[...document.querySelectorAll("button")].filter(n => n.textContent.includes("Загрузить данные")).length`)) === 1);

    await call(`[...document.querySelectorAll("button")].find(n => n.textContent.includes("Загрузить данные")).click()`);
    const ждём = Date.now() + 15000;
    while (Date.now() < ждём) {
      if (await call(`!!document.querySelector(".direct-table")`)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    check("таблица появилась", (await call(`!!document.querySelector(".direct-table")`)) === true);

    const строк = await call(`document.querySelectorAll(".direct-table tbody tr").length`);
    check("кампании всех аккаунтов в одной таблице", строк === 3, строк);
    const текстТаблицы = await call(`document.querySelector(".direct-table").textContent`);
    check("видно кампании обоих аккаунтов",
      /Болдино/.test(текстТаблицы) && /Пылаева/.test(текстТаблицы), текстТаблицы.slice(0, 200));

    console.log("\nфильтры как в Директе");
    await call(`[...document.querySelectorAll(".chip")].find(n => n.textContent.includes("Идут показы")).click()`);
    await new Promise((r) => setTimeout(r, 300));
    check("остаётся только то, что показывается",
      (await call(`document.querySelectorAll(".direct-table tbody tr").length`)) === 1);
    await call(`[...document.querySelectorAll(".chip")].find(n => n.textContent.includes("В архиве")).click()`);
    await new Promise((r) => setTimeout(r, 300));
    check("архив отбирается отдельно",
      (await call(`document.querySelectorAll(".direct-table tbody tr").length`)) === 1);
    await call(`[...document.querySelectorAll(".chip")].find(n => n.textContent.trim().startsWith("Все")).click()`);
    await new Promise((r) => setTimeout(r, 300));

    console.log("\nстолбцы выбираются галочками");
    await call(`[...document.querySelectorAll(".link-btn")].find(n => n.textContent.includes("столбцы")).click()`);
    await new Promise((r) => setTimeout(r, 300));
    const былоСтолбцов = await call(`document.querySelectorAll(".direct-table thead th").length`);
    await call(`[...document.querySelectorAll(".checkbox-row")].find(n => n.textContent.includes("ДРР")).querySelector("input").click()`);
    await new Promise((r) => setTimeout(r, 300));
    const сталоСтолбцов = await call(`document.querySelectorAll(".direct-table thead th").length`);
    check("столбец добавляется", сталоСтолбцов === былоСтолбцов + 1, `${былоСтолбцов} → ${сталоСтолбцов}`);
    check("и это именно ДРР", /ДРР/.test(await call(`document.querySelector(".direct-table thead").textContent`)));

    console.log("\nразбор по клику в ячейку");
    await call(`document.querySelector(".direct-table tbody tr td.num").click()`);
    const ответ = Date.now() + 10000;
    while (Date.now() < ответ) {
      if (await call(`!!document.querySelector(".direct-cell-answer pre")`)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    check("агент ответил про ячейку",
      /аукционе/.test(await call(`document.querySelector(".direct-cell-answer")?.textContent || ""`)));

    console.log("\n«Все аккаунты» есть в выборе аккаунта");
    const выбор = await call(`[...document.querySelectorAll(".direct-account-picker option")].map(o => o.textContent).join("|")`);
    check("пункт «Все аккаунты» на месте", /Все аккаунты/.test(выбор), выбор);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});
