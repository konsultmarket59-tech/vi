// Задача по времени: один запуск — один ответ, и внятный дайджест вместо
// двух голых ссылок.
//   node electron/smoke-tasks-digest.cjs
//
// Здесь ловятся две живые жалобы.
//
// Первая: «на одну задачу пришло два ответа». Защита от повторов жила в памяти
// процесса, а память умирает вместе с процессом. Дайджест с поиском по сети
// идёт минутами; стоило приложению за это время закрыться — при следующем
// старте задача снова оказывалась просроченной и выполнялась заново. Проверка
// ниже именно это и разыгрывает: обрыв посередине прогона, потом новый тик.
//
// Вторая: «выдало только 2 ссылки, ничего не расписал, а по пустым темам
// промолчал». Разметка запроса теперь обязана называть период словами и
// требовать разбора каждой темы, включая те, по которым новостей нет.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tasks = require("./tasks.cjs");
const { finish } = require("./smoke-finish.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

async function main() {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "tasks-digest-"));
  const projectId = "proj-1";
  await fs.mkdir(path.join(root, "projects", projectId, "tasks"), { recursive: true });
  const getRoot = async () => root;

  console.log("один запуск — один ответ, даже если приложение оборвалось посередине");
  const weekly = await tasks.save(root, projectId, {
    title: "Дайджест СММ",
    prompt: "Новости рынка SMM, кейсы, кампании с большими бюджетами",
    recurrence: "weekly",
    weekday: new Date().getDay(),
    time: "00:00",
    enabled: true,
  });
  // Делаем задачу просроченной — так же, как выглядит пропущенный срок.
  const file = path.join(root, "projects", projectId, "tasks", weekly.id + ".json");
  const overdue = { ...JSON.parse(await fs.readFile(file, "utf-8")), nextRunAt: Date.now() - 60000 };
  await fs.writeFile(file, JSON.stringify(overdue), "utf-8");

  let started = 0;
  // Прогон, который начинается и НЕ доходит до конца: ровно то, что происходит,
  // когда окно приложения закрывается на середине долгой задачи.
  const crashingRun = async (r, t) => {
    started++;
    await tasks.claim(r, t.projectId, t, Date.now());
    throw new Error("приложение закрылось посреди задачи");
  };
  await tasks._tick(getRoot, crashingRun);
  await new Promise((r) => setTimeout(r, 100));
  check("первый срок отработан один раз", started === 1, `запусков: ${started}`);

  const afterCrash = JSON.parse(await fs.readFile(file, "utf-8"));
  check(
    "срок сдвинут вперёд ещё до обращения к модели",
    afterCrash.nextRunAt > Date.now(),
    `nextRunAt: ${new Date(afterCrash.nextRunAt).toISOString()}`
  );

  // «Перезапуск приложения»: новый тик на том же диске.
  await tasks._tick(getRoot, crashingRun);
  await new Promise((r) => setTimeout(r, 100));
  check("после перезапуска задача не выполняется повторно", started === 1, `запусков: ${started}`);

  console.log("\nразметка дайджеста");
  const now = new Date(2026, 8, 5, 9, 0).getTime();
  const period = tasks.coveredPeriod({ recurrence: "weekly" }, now);
  check("период — неделя назад", period.fromText === "29 августа 2026", period.fromText);
  check("период кончается сегодня", period.toText === "5 сентября 2026", period.toText);

  const prompt = tasks.buildDigestPrompt(
    { prompt: "Дайджест смм, новости рынка, крутые кейсы, кампании с большими бюджетами" },
    period
  );
  check("задание человека сохранено целиком", prompt.includes("крутые кейсы"), prompt.slice(0, 80));
  check("период назван словами", prompt.includes("с 29 августа 2026 по 5 сентября 2026"));
  check("требуется разобрать каждую тему", /КАЖДУЮ тему/.test(prompt));
  check("требуется дата и суть, а не голая ссылка", /Одной ссылки без пояснения недостаточно/.test(prompt));
  check("пустая тема проговаривается вслух", /ничего заметного не произошло/.test(prompt));
  check("к пустой теме просят самое свежее близкое", /самое[\s\S]{0,40}свежее и близкое по смыслу/.test(prompt));
  check("запрещено выдумывать", /Ничего не выдумывай/.test(prompt));

  console.log("\nпериод следующего выпуска стыкуется с прошлым");
  const second = tasks.coveredPeriod({ recurrence: "weekly", lastRunAt: now }, now + 7 * 24 * 3600 * 1000);
  check("следующий выпуск начинается там, где кончился прошлый", second.from === now, String(second.from));

  console.log("\nсвободный формат не трогает задание");
  const free = await tasks.save(root, projectId, {
    title: "Напоминание",
    prompt: "Напомни выставить акты",
    recurrence: "daily",
    time: "10:00",
    format: "free",
  });
  check("формат сохраняется", free.format === "free", free.format);
  const digestDefault = await tasks.save(root, projectId, {
    title: "Без формата",
    prompt: "что-то",
    recurrence: "daily",
    time: "10:00",
  });
  check("по умолчанию — дайджест", digestDefault.format === "digest", digestDefault.format);

  await fs.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  finish(failures, (c) => process.exit(c));
}

main();
