// Планировщик задач по расписанию: одно срабатывание не должно превращаться в
// несколько, если сама задача выполняется дольше одного тика (30с).
//   node electron/smoke-tasks-dedup.cjs
//
// Баг, который здесь ловится: findDueTasks() сканирует раз в тик и считает
// задачу «просроченной», пока её nextRunAt не сдвинут — а сдвигается он только
// когда onDue() (runScheduledTask в main.cjs) полностью завершится. Долгий
// прогон (несколько раундов веб-поиска) раньше означал несколько срабатываний
// одного и того же тика подряд — реально наблюдалось как 4 чата и 4-кратный
// счёт за одну еженедельную задачу. Нет зависимости от Electron — вся логика
// в tasks.cjs работает на голом Node, так и тестируем: без ожидания настоящих
// 30-секундных тиков, дёргая экспортированный _tick() напрямую.

const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tasks = require("./tasks.cjs");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

async function main() {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), "tasks-dedup-"));
  const projectId = "proj-1";
  await fs.mkdir(path.join(root, "projects", projectId, "tasks"), { recursive: true });

  // Просроченная разовая задача — computeNextRun вернёт время в прошлом, так
  // что findDueTasks() будет находить её на каждом тике, пока onDue не сохранит
  // обновлённое состояние.
  const task = await tasks.save(root, projectId, {
    title: "Дайджест",
    prompt: "тест",
    recurrence: "once",
    date: "2020-01-01",
    time: "00:00",
    enabled: true,
  });

  let calls = 0;
  let resolveRun;
  const runStarted = new Promise((r) => (resolveRun = r));
  const onDue = async (r, t) => {
    calls++;
    resolveRun();
    // Симулируем долгий прогон (несколько раундов веб-поиска) — дольше, чем
    // промежуток между двумя вызовами _tick() ниже.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await tasks.save(r, t.projectId, { ...t, lastRunAt: Date.now(), enabled: false });
  };

  console.log("тик во время выполнения предыдущего");
  const getRoot = async () => root;
  const firstTick = tasks._tick(getRoot, onDue);
  await runStarted; // дожидаемся, что первый прогон действительно начался
  await tasks._tick(getRoot, onDue); // «следующий» тик застаёт задачу ещё выполняющейся
  await firstTick;
  await new Promise((r) => setTimeout(r, 400)); // даём первому прогону дозавершиться

  check("onDue вызван ровно один раз, а не на каждом тике", calls === 1, `вызовов: ${calls}`);

  console.log("\nследующий тик после завершения — можно снова");
  await tasks.save(root, projectId, {
    ...task,
    lastRunAt: undefined,
    enabled: true,
    date: "2020-01-01",
    time: "00:00",
  });
  await tasks._tick(getRoot, onDue);
  await new Promise((r) => setTimeout(r, 400));
  check("после завершения предыдущего прогона задача снова срабатывает", calls === 2, `вызовов: ${calls}`);

  await fs.rm(root, { recursive: true, force: true });
  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
