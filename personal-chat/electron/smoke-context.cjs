// Контекст проекта: дубли документов, профиль проекта и отделение выдач задач
// от чатов.
//   xvfb-run -a npx electron electron/smoke-context.cjs

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-data-"));
const external = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-ext-"));

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
  for (const dir of [userData, dataRoot, external]) fs.rmSync(dir, { recursive: true, force: true });
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

    console.log("один документ в двух местах");
    const project = await call(
      `window.api.createProject({ name: "Проект", description: "", instructions: "Инструкции проекта." })`
    );
    const body = "УНИКАЛЬНАЯ-СТРОКА-ДОГОВОРА " + "текст ".repeat(50);
    // Один и тот же файл: и внутри проекта, и во внешней папке, подключённой к нему.
    const docsDir = path.join(dataRoot, "projects", project.id, "docs");
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, "договор.txt"), body);
    fs.writeFileSync(path.join(external, "договор.txt"), body);
    // И один файл, который есть ТОЛЬКО во внешней папке.
    fs.writeFileSync(path.join(external, "только-внешний.txt"), "ТОЛЬКО-ВНЕШНИЙ-МАРКЕР");
    // И тёзка с другим размером — это другая версия, её терять нельзя.
    fs.writeFileSync(path.join(docsDir, "смета.txt"), "смета версия один");
    fs.writeFileSync(path.join(external, "смета.txt"), "смета версия два, она длиннее первой заметно");

    await call(`window.api.setProjectExternalDocsFolder(${JSON.stringify(project.id)}, ${JSON.stringify(external)})`);
    const prompt = await call(`window.api.buildSystemPrompt(${JSON.stringify(project.id)})`);

    const occurrences = prompt.split("УНИКАЛЬНАЯ-СТРОКА-ДОГОВОРА").length - 1;
    check("одинаковый файл попал в промпт один раз, а не два", occurrences === 1, `вхождений: ${occurrences}`);
    check("приложение сказало, что пропустило дубль", prompt.includes("Не продублированы"), "");
    check("файл только из внешней папки на месте", prompt.includes("ТОЛЬКО-ВНЕШНИЙ-МАРКЕР"));
    check(
      "разные версии тёзки сохранены обе",
      prompt.includes("смета версия один") && prompt.includes("смета версия два"),
      ""
    );

    console.log("\nв коде нет чужого бизнеса");
    const cleanupPrompt = await call(
      `window.api.prepareCleanup({ folderPath: ${JSON.stringify(external)}, mode: "tidy", notes: "" }).then(r => r.prompt)`
    );
    const docflowPrompt = await call(
      `window.api.prepareDocflow({ kindId: "act", mode: "template", month: "2026-08", dataPaths: [], sourcePaths: [] }).then(r => r.prompt)`
    );
    const leaked = ["Сверху", "Динамик", "Болдино", "ИП Павлов", "Филатов"];
    for (const word of leaked) {
      check(
        `«${word}» не приходит агенту из кода`,
        !cleanupPrompt.includes(word) && !docflowPrompt.includes(word),
        word
      );
    }

    console.log("\nпрофиль проекта");
    const before = await call(`window.api.readProjectProfile(${JSON.stringify(project.id)})`);
    check("без профиля так и сказано", before.profile === null && before.stale === true);

    const request = await call(`window.api.buildProfileRequest(${JSON.stringify(project.id)})`);
    check("в запросе есть название проекта", request.includes("Проект"));
    check("в запросе есть инструкции", request.includes("Инструкции проекта."));
    check("запрошен именно JSON", request.includes('"чем_занимается"'));

    const answer = `\`\`\`json
{
  "чем_занимается": "маркетинг и документы",
  "о_чём_проект": "ведение клиента и его отчётности",
  "ключевые_сущности": ["Клиент А", "Клиент Б"],
  "как_принято_называть": "папки «месяц год»",
  "чего_избегать": ""
}
\`\`\``;
    const saved = await call(`window.api.saveProjectProfile(${JSON.stringify(project.id)}, ${JSON.stringify(answer)})`);
    check("профиль разобран из ответа в тройных кавычках", saved.о_чём_проект === "ведение клиента и его отчётности", JSON.stringify(saved));
    check("ключевые сущности сохранены", saved.ключевые_сущности.length === 2);

    const after = await call(`window.api.readProjectProfile(${JSON.stringify(project.id)})`);
    check("сохранённый профиль читается и не помечен устаревшим", after.profile !== null && after.stale === false);

    // Меняем проект — профиль должен стать устаревшим, иначе человек будет думать,
    // что другие разделы знают про новые документы.
    fs.writeFileSync(path.join(docsDir, "новый.txt"), "ещё один документ");
    const stale = await call(`window.api.readProjectProfile(${JSON.stringify(project.id)})`);
    check("после изменения проекта профиль помечен устаревшим", stale.stale === true);

    console.log("\nконтекст в разделах без проекта");
    const digest = await call(`window.api.userContextDigest()`);
    check("справка собрана из профиля", digest.includes("ведение клиента"), digest.slice(0, 120));
    check("справка предупреждает не смешивать проекты", digest.includes("Не переноси данные одного проекта"));

    const wordPrompt = await call(
      `window.api.newWordDocument("тест.docx").then(() => window.api.buildWordAgentPrompt("analyze"))`
    );
    check("режим анализа Word получает контекст человека", wordPrompt.includes("ЧЕМ ЗАНИМАЕТСЯ ЧЕЛОВЕК"), "");
    check("и он из данных пользователя, а не из кода", wordPrompt.includes("Клиент А"));

    console.log("\nвыдачи задач отдельно от чатов");
    // Кладём выдачу так же, как это делает планировщик.
    const runsDir = path.join(dataRoot, "projects", project.id, "task-runs");
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, "run1.json"),
      JSON.stringify({
        id: "run1",
        projectId: project.id,
        taskId: "t1",
        taskTitle: "Дайджест",
        title: "Задача: Дайджест",
        messages: [
          { id: "m1", role: "user", content: "задание", createdAt: 1 },
          { id: "m2", role: "assistant", content: "готовый дайджест рынка", createdAt: 2 },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );

    const runs = await call(`window.api.listTaskRuns(${JSON.stringify(project.id)})`);
    check("выдача видна в своём списке", runs.length === 1 && runs[0].title === "Дайджест", JSON.stringify(runs));
    check("в списке есть превью", runs[0].preview.includes("готовый дайджест"), runs[0].preview);

    const chats = await call(`window.api.listConversations(${JSON.stringify(project.id)})`);
    check("в списке чатов её нет", chats.length === 0, JSON.stringify(chats.map((c) => c.title)));

    const run = await call(`window.api.readTaskRun(${JSON.stringify(project.id)}, "run1")`);
    check("выдача открывается целиком", run.messages.length === 2);

    const left = await call(`window.api.deleteTaskRun(${JSON.stringify(project.id)}, "run1")`);
    check("выдача удаляется отдельно от чатов", left.length === 0);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  }
});
