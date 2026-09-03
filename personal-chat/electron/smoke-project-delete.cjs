// Удаление проекта: кнопка есть, проект уходит целиком, открытый экран не виснет
// на несуществующем проекте, а задачи удалённого проекта больше не срабатывают.
//   xvfb-run -a npx electron electron/smoke-project-delete.cjs

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "del-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "del-data-"));

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

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  for (const dir of [userData, dataRoot]) fs.rmSync(dir, { recursive: true, force: true });
}

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

    console.log("проект со всем содержимым");
    const keep = await call(`window.api.createProject({ name: "Остаётся", description: "", instructions: "" })`);
    const doomed = await call(
      `window.api.createProject({ name: "Делопроизводство", description: "", instructions: "Инструкции" })`
    );
    // Наполняем: документ, чат и задача по расписанию — всё это должно уйти вместе.
    const docsDir = path.join(dataRoot, "projects", doomed.id, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "договор.txt"), "текст договора");
    await call(
      `window.api.saveConversation(${JSON.stringify(doomed.id)}, { id: "c1", projectId: ${JSON.stringify(doomed.id)}, title: "Чат", messages: [], createdAt: 1, updatedAt: 1 })`
    );
    await call(
      `window.api.saveTask(${JSON.stringify(doomed.id)}, { title: "Задача", prompt: "тест", recurrence: "daily", time: "09:00", enabled: true })`
    );
    check("проект создан с документом, чатом и задачей", fs.existsSync(path.join(dataRoot, "projects", doomed.id)));
    check("задача записана", (await call(`window.api.listTasks(${JSON.stringify(doomed.id)})`)).length === 1);

    console.log("\nкнопка в интерфейсе");
    await win.webContents.reload();
    await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    await new Promise((r) => setTimeout(r, 1500));
    // Кнопка появляется по наведению, поэтому в разметке ищем её саму, а не видимость.
    const hasButton = await call(
      `[...document.querySelectorAll(".sidebar-item-remove")].length >= 2`
    );
    check("у каждого проекта есть кнопка удаления", hasButton === true);
    const title = await call(
      `([...document.querySelectorAll(".sidebar-item-remove")][0] || {}).title || ""`
    );
    check("кнопка подписана", title === "Удалить проект", title);

    console.log("\nудаление");
    const result = await call(`window.api.deleteProject(${JSON.stringify(doomed.id)})`);
    check("приложение сообщает, куда делась папка", typeof result.trashed === "boolean", JSON.stringify(result));
    check("папка проекта исчезла", !fs.existsSync(path.join(dataRoot, "projects", doomed.id)));

    const left = await call(`window.api.listProjects()`);
    check("проект пропал из списка", left.length === 1 && left[0].id === keep.id, JSON.stringify(left.map((p) => p.name)));
    check("соседний проект не тронут", fs.existsSync(path.join(dataRoot, "projects", keep.id)));

    console.log("\nхвосты");
    const tasksAfter = await call(`window.api.listTasks(${JSON.stringify(doomed.id)})`);
    check("задачи удалённого проекта больше не существуют", tasksAfter.length === 0, JSON.stringify(tasksAfter));

    // Планировщик обходит папку projects/ на каждом тике: удалённый проект не
    // должен его ронять, иначе перестали бы срабатывать и задачи живых проектов.
    const tasks = require("./tasks.cjs");
    const due = await tasks.findDueTasks(dataRoot, Date.now() + 86400000);
    check(
      "планировщик работает после удаления и не видит задач удалённого проекта",
      Array.isArray(due) && !due.some((t) => t.projectId === doomed.id),
      JSON.stringify(due.map((t) => t.projectId))
    );

    const conversations = await call(`window.api.listConversations(${JSON.stringify(doomed.id)})`);
    check("чаты удалённого проекта не читаются как пустые ошибки", Array.isArray(conversations) && conversations.length === 0);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  }
});
