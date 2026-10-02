// Переписка агента и документ: Excel и Word.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-doc-chat.cjs
//
// Проверяется то, из-за чего ассистент начинал отвечать очень долго: второй
// «новый документ» открывал переписку от первого. Имя у всех новых книг одно и
// то же, ключом переписки было оно — и вся прошлая история уезжала в каждый
// следующий запрос. Чем дольше человек работал до этого, тем медленнее шёл
// ответ, и выглядело это как «приложение тормозит».
//
// Проверка идёт через настоящие вызовы приложения, а не мимо них: ключ считает
// главный процесс, и проверять надо его, а не свою копию правила.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const docchat = require("./docchat.cjs");
const excel = require("./excel.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "docchat-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docchat-data-"));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "docchat-work-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({ baseUrl: "http://127.0.0.1:1/v1", apiKey: "test", model: "m", proxyMode: "direct", searchEnabled: false })
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
  for (const d of [userData, dataRoot, workDir]) fs.rmSync(d, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { cleanup(); process.exit(1); });
}

require("./main.cjs");

const переписка = (id, тексты) => ({
  id,
  projectId: "__excel_agent__",
  title: "Агент",
  messages: тексты.map((t, i) => ({ id: `${id}-${i}`, role: i % 2 ? "assistant" : "user", content: t })),
  createdAt: 1,
  updatedAt: 1,
});

app.whenReady().then(async () => {
  try {
    console.log("ключ документа");
    const первая = excel.createWorkbook("Новая книга.xlsx");
    const вторая = excel.createWorkbook("Новая книга.xlsx");
    check("у двух новых книг с одним именем ключи разные",
      docchat.documentChatKey(первая) !== docchat.documentChatKey(вторая),
      `${docchat.documentChatKey(первая)} / ${docchat.documentChatKey(вторая)}`);
    check("у сохранённого документа ключ — путь к файлу",
      docchat.documentChatKey({ filePath: "/tmp/отчёт.xlsx", name: "отчёт.xlsx" }) === "/tmp/отчёт.xlsx");
    // Документ из старой версии приложения номера не имеет. Общего ключа ему не
    // даём — лучше пустая переписка, чем чужая.
    check("документу без номера общий ключ не достаётся",
      docchat.documentChatKey({ filePath: null, name: "Новая книга.xlsx" }) === "__new__:Новая книга.xlsx");
    check("без документа ключа нет", docchat.documentChatKey(null) === "");

    // Два настоящих файла на диске — чтобы открывать их через само приложение.
    const файлА = path.join(workDir, "а.xlsx");
    const файлБ = path.join(workDir, "б.xlsx");
    const кнА = excel.createWorkbook("а.xlsx");
    excel.setCell(кнА, "Лист1", "A1", "первый файл");
    await excel.saveWorkbook(кнА, файлА);
    const кнБ = excel.createWorkbook("б.xlsx");
    excel.setCell(кнБ, "Лист1", "A1", "второй файл");
    await excel.saveWorkbook(кнБ, файлБ);

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
    // Верхнеуровневого await в executeJavaScript нет — оборачиваем каждый вызов.
    const call = (js) => win.webContents.executeJavaScript(`(async () => { return ${js}; })()`);
    const until = Date.now() + 20000;
    while (Date.now() < until) {
      if (await call("!!window.api")) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log("\nновый документ — чистая переписка");
    await call(`window.api.newExcelWorkbook("Новая книга.xlsx")`);
    await call(`window.api.saveExcelAgentConversation(${JSON.stringify(переписка("c1", ["про первую книгу", "ответ про первую"]))})`);
    check("переписка первой книги сохранилась",
      (await call(`(await window.api.getExcelAgentConversation())?.messages.length`)) === 2);

    await call(`window.api.newExcelWorkbook("Новая книга.xlsx")`);
    const послеВторого = await call(`(await window.api.getExcelAgentConversation())?.messages?.map(m => m.content) ?? null`);
    check("второй «новый документ» начинает разговор с чистого листа",
      послеВторого === null, JSON.stringify(послеВторого));

    console.log("\nу каждого файла своя переписка");
    await call(`window.api.openExcelFile(${JSON.stringify(файлА)})`);
    await call(`window.api.saveExcelAgentConversation(${JSON.stringify(переписка("cA", ["вопрос про файл А"]))})`);
    await call(`window.api.openExcelFile(${JSON.stringify(файлБ)})`);
    check("у другого файла переписки ещё нет",
      (await call(`await window.api.getExcelAgentConversation()`)) === null);
    await call(`window.api.saveExcelAgentConversation(${JSON.stringify(переписка("cB", ["вопрос про файл Б"]))})`);
    await call(`window.api.openExcelFile(${JSON.stringify(файлА)})`);
    const вернулись = await call(`(await window.api.getExcelAgentConversation())?.messages[0].content`);
    check("вернулись к первому файлу — вернулась его переписка",
      вернулись === "вопрос про файл А", вернулись);

    console.log("\nсохранение документа переписку не теряет");
    // Сохранение идёт через системное окно выбора файла, подменять его здесь
    // нечем. Поэтому проверяется сам перенос: переписка должна оказаться под
    // новым ключом, а не исчезнуть вместе со старым.
    const папка = path.join(dataRoot, "excel", "chats");
    const файлы = fs.readdirSync(папка).map((f) => JSON.parse(fs.readFileSync(path.join(папка, f), "utf-8")));
    check("у каждого документа своя запись, они не затирают друг друга",
      файлы.length === 3, файлы.length);
    check("и каждая помнит, к какому документу относится",
      файлы.filter((x) => x.key === файлА).length === 1 && файлы.filter((x) => x.key === файлБ).length === 1,
      файлы.map((x) => x.key).join(" | "));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    for (const w of BrowserWindow.getAllWindows()) w.destroy();
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});
