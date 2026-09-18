// Браузер: роли, переговорка и доступ с телефона — движок целиком.
//   node electron/smoke-browser.cjs
//
// Модель здесь не вызывается: ответы подставляются заглушкой. Проверяется то,
// что ломается молча и дорого, — очередь реплик (кто говорит после кого),
// обращение через @, обрезка переписки, возврат встроенной роли к исходной и
// вход с телефона по коду. Ошибка в любом из этих мест выглядит как «оно как-то
// странно отвечает», а не как отказ, поэтому проверять их надо машиной.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const roles = require("./roles.cjs");
const agents = require("./agents.cjs");
const mobile = require("./mobile.cjs");
const { finish } = require("./finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "browser-"));

async function main() {
  console.log("роли");
  const list = await roles.list(tmp);
  check("встроенные роли на месте", list.length >= 10, String(list.length));
  const stylist = list.find((r) => r.id === "stylist");
  check("стилист есть и знает про размер", Boolean(stylist) && /размер/i.test(stylist.prompt));
  check("у каждой роли есть промпт", list.every((r) => r.prompt.trim().length > 200));
  check("встроенные помечены", list.every((r) => (roles.PRESET_IDS.has(r.id) ? r.builtIn : !r.builtIn)));

  const edited = await roles.save(tmp, { ...stylist, tagline: "мой стилист", prompt: "Работай по-моему." });
  check("правка сохранилась", edited.tagline === "мой стилист");
  const afterEdit = (await roles.list(tmp)).find((r) => r.id === "stylist");
  check("правка видна в списке", afterEdit.prompt === "Работай по-моему." && afterEdit.edited === true);
  await roles.remove(tmp, "stylist");
  const afterReset = (await roles.list(tmp)).find((r) => r.id === "stylist");
  check("«вернуть как было» возвращает исходную роль", afterReset.prompt === stylist.prompt);
  check("встроенную роль нельзя потерять", (await roles.list(tmp)).some((r) => r.id === "stylist"));

  const custom = await roles.save(tmp, { name: "Юрист по подряду", prompt: "Читай договор." });
  check("своя роль получает опрятный id", custom.id === "юрист-по-подряду", custom.id);
  check("своя роль появляется в списке", (await roles.list(tmp)).some((r) => r.id === custom.id));

  console.log("\nсистемный промпт");
  const room = { roles: [list[0], stylist] };
  const prompt = roles.buildSystemPrompt({
    role: stylist,
    projectPrompt: "Проект: личный гардероб.",
    page: { url: "https://example.com/dress", title: "Платье", text: "Размер 46, состав вискоза" },
    room,
    mode: "task",
  });
  check("роль названа первой строкой", prompt.startsWith("Ты — Стилист"));
  check("контекст проекта подключён", prompt.includes("Проект: личный гардероб."));
  check("состав переговорки виден", prompt.includes("Ассистент"));
  check("правила переговорки на месте", prompt.includes("@ и его имя"));
  check("режим задания включает отчёт", prompt.includes("Источники"));
  check("текст страницы передан", prompt.includes("Размер 46"));
  const plain = roles.buildSystemPrompt({ role: stylist });
  check("без комнаты правил переговорки нет", !plain.includes("ПЕРЕГОВОРКА"));
  check("без страницы её раздела нет", !plain.includes("ОТКРЫТАЯ СТРАНИЦА"));

  console.log("\nобращения через @");
  const three = [
    { id: "marketer", name: "Маркетолог", emoji: "📣", tagline: "" },
    { id: "economist", name: "Экономист", emoji: "💹", tagline: "" },
    { id: "bizdev", name: "Директор по развитию", emoji: "🚀", tagline: "" },
  ];
  check("имя из одного слова", agents.mentionedRoleIds("@Экономист посчитай", three).join() === "economist");
  check(
    "имя из нескольких слов не достаётся соседу",
    agents.mentionedRoleIds("@Директор по развитию, твоё слово", three).join() === "bizdev"
  );
  check("регистр не важен", agents.mentionedRoleIds("@маркетолог", three).join() === "marketer");
  check("@все зовёт всех", agents.mentionedRoleIds("@все, ваше мнение", three).length === 3);
  check("без @ никого", agents.mentionedRoleIds("просто вопрос про экономиста", three).length === 0);
  check(
    "к кому обратились — тот и первый",
    agents.speakingOrder(three, "@Экономист, посчитай")[0].id === "economist"
  );
  check("остальные не теряются", agents.speakingOrder(three, "@Экономист")
    .map((r) => r.id)
    .sort()
    .join() === "bizdev,economist,marketer");

  console.log("\nпереписка и обрезка");
  const many = Array.from({ length: 50 }, (_, i) => ({
    from: i % 2 ? "me" : "marketer",
    name: "Маркетолог",
    emoji: "📣",
    content: "реплика ".repeat(60) + i,
  }));
  const short = agents.transcript(many, { budget: 2000 });
  check("переписка обрезается сверху", short.includes("начало обсуждения не поместилось"));
  check("последняя реплика всегда на месте", short.includes("49"));

  console.log("\nход переговорки");
  const chat = agents.newChat({ kind: "room", roleIds: three.map((r) => r.id), rounds: 2, title: "Запуск" });
  chat.messages.push(agents.userMessage("Стоит ли запускать доставку? @Экономист начни."));
  const saved = await agents.save(tmp, chat);
  check("разговор сохранён файлом", fs.existsSync(path.join(agents.chatsDir(tmp), `${saved.id}.json`)));

  const asked = [];
  const ask = async (role, userContent) => {
    asked.push({ id: role.id, content: userContent });
    if (/ИТОГ ВСТРЕЧИ/.test(userContent)) return "**Решение** Запускаем в одном районе.";
    return `Мнение роли ${role.name}. @Маркетолог, что скажешь?`;
  };
  const events = [];
  const produced = await agents.runDiscussion({
    chat: saved,
    roles: three,
    ask,
    onEvent: (e) => events.push(e),
  });
  check("два круга по три роли плюс итог", produced.length === 7, String(produced.length));
  check("первым говорит тот, к кому обратились", produced[0].from === "economist", produced[0].from);
  check(
    "второй круг начинает тот, к кому обратились в первом",
    produced[3].from === "marketer",
    produced[3].from
  );
  check("итог помечен", produced[6].summary === true && /Решение/.test(produced[6].content));
  check("итог ведёт первая роль списка", produced[6].from === "marketer", produced[6].from);
  check("каждая реплика видит предыдущие", asked[2].content.includes("Мнение роли Маркетолог"));
  check("задание ролям разное по кругам", asked[0].content.includes("Первый круг") && asked[3].content.includes("Последний круг"));
  check("события дошли до окна", events.filter((e) => e.type === "message").length === 7 && events.at(-1).type === "done");

  const stopped = await agents.runDiscussion({
    chat: saved,
    roles: three,
    ask,
    shouldStop: () => true,
  });
  check("остановка прекращает круг сразу", stopped.length === 0);

  const oneOnOne = agents.newChat({ kind: "role", roleIds: ["stylist"] });
  oneOnOne.messages.push(agents.userMessage("Подбери образ"));
  const single = await agents.runDiscussion({ chat: oneOnOne, roles: [stylist], ask });
  check("разговор один на один — одна реплика без итога", single.length === 1);
  check("в разговоре один на один нет «твоего хода»", !asked.at(-1).content.includes("ТВОЙ ХОД"));

  console.log("\nвыгрузка");
  const full = { ...saved, messages: [...saved.messages, ...produced] };
  const sections = agents.exportSections(full);
  check("в выгрузке видно, кто говорил", sections[1].role.includes("Экономист"), sections[1].role);
  check("реплика человека подписана", sections[0].role === "Вы");
  const onlySummary = agents.summarySections(full);
  check("только итог — одна секция", onlySummary.length === 1 && /Решение/.test(onlySummary[0].content));

  console.log("\nсписок разговоров");
  await agents.save(tmp, full);
  const listed = await agents.list(tmp);
  check("разговор в списке с числом реплик", listed[0].messageCount === 8, JSON.stringify(listed[0]));
  await agents.remove(tmp, full.id);
  check("удаление убирает файл", (await agents.list(tmp)).length === 0);

  console.log("\nтелефон");
  const port = 8900 + Math.floor(Math.random() * 90);
  const status = await mobile.start({
    port,
    code: "123456",
    methods: { привет: async (имя) => `здравствуйте, ${имя}` },
  });
  check("сервер поднялся", status.running && status.port === port);
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(base + "/");
  check("страница для телефона отдаётся", page.ok && (await page.text()).includes("Личный чат"));

  const denied = await fetch(base + "/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "привет", args: ["Вика"] }),
  });
  check("без входа ничего не отдаётся", denied.status === 401);

  const wrong = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "000000" }),
  });
  check("неверный код не пускает", wrong.status === 403);

  const ok = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456" }),
  });
  const { token } = await ok.json();
  check("верный код выдаёт пропуск", typeof token === "string" && token.length > 20);

  const called = await fetch(base + "/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method: "привет", args: ["Вика"] }),
  });
  check("разрешённое действие выполняется", (await called.json()).result === "здравствуйте, Вика");

  const unknown = await fetch(base + "/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method: "прочитайФайл", args: ["/etc/passwd"] }),
  });
  check("чужое действие недоступно", unknown.status === 404);

  mobile.regenerateCode();
  const afterNewCode = await fetch(base + "/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ method: "привет", args: ["Вика"] }),
  });
  check("новый код отключает вошедшие телефоны", afterNewCode.status === 401);

  await mobile.stop();
  check("сервер останавливается", mobile.status().running === false);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  finish(failures, (c) => process.exit(c));
}

main().catch((e) => {
  console.error("Непойманная ошибка:", e);
  process.exit(1);
});
