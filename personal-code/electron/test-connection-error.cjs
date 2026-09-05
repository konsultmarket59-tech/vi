// Проверка перевода сбоя подключения на человеческий язык:
//   node electron/test-connection-error.cjs
//
// Словарь причин живёт в двух местах: в главном процессе (connectionError.cjs)
// и в окне (ConnectionStatus.tsx) — часть запросов уходит прямо из интерфейса и
// до главного процесса не доходит. Разъехавшись, эти два списка дали бы на один
// и тот же сбой разные ответы, поэтому здесь проверяется и перевод, и то, что
// списки совпадают — в обоих приложениях.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const connectionError = require("./connectionError.cjs");

const root = path.join(__dirname, "..", "..");
const files = {
  "главный процесс, Личный код": path.join(root, "personal-code/electron/connectionError.cjs"),
  "главный процесс, Личный чат": path.join(root, "personal-chat/electron/connectionError.cjs"),
  "окно, Личный код": path.join(root, "personal-code/src/components/ConnectionStatus.tsx"),
  "окно, Личный чат": path.join(root, "personal-chat/src/components/ConnectionStatus.tsx"),
};

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log("  ok   " + label);
  } catch (e) {
    failures++;
    console.log("  FAIL " + label + " — " + e.message.split("\n")[0]);
  }
}

console.log("перевод причин");
const cases = [
  ["net::ERR_UNSAFE_PORT", /небезопасн/i],
  ["net::ERR_CONNECTION_REFUSED", /никто не отвечает/i],
  ["getaddrinfo ENOTFOUND polza.ai", /Адрес не найден/i],
  ["net::ERR_PROXY_CONNECTION_FAILED", /прокси/i],
  ["net::ERR_TOO_MANY_RETRIES", /логин и пароль/i],
  ["net::ERR_NO_SUPPORTED_PROXIES", /не поддерживается/i],
  ["connect ETIMEDOUT 1.2.3.4:443", /не ответил вовремя/i],
  ["net::ERR_INTERNET_DISCONNECTED", /интернет/i],
  ["net::ERR_CERT_AUTHORITY_INVALID", /сертификат/i],
];
for (const [raw, expected] of cases) {
  check(`«${raw}» объяснён`, () => {
    const text = connectionError.explain(new Error(raw));
    assert.match(text, expected, `получено: ${text}`);
    // Сырой код остаётся в скобках: человеку — объяснение, разработчику — код.
    assert.ok(text.length > 30, `слишком коротко: ${text}`);
  });
}

check("неопознанное показывается как есть, а не выдумывается", () => {
  const text = connectionError.explain(new Error("совершенно новая беда"));
  assert.strictEqual(text, "совершенно новая беда");
});

check("обёртка Electron с именем IPC-метода снимается", () => {
  const text = connectionError.explain(new Error("Error invoking remote method 'models:list': Error: странно"));
  assert.strictEqual(text, "странно");
});

check("ответ 401 объясняется как непринятый ключ", () => {
  assert.match(connectionError.fromStatus(401), /Ключ не принят/);
});
check("ответ 407 объясняется как логин от прокси", () => {
  assert.match(connectionError.fromStatus(407), /Прокси требует логин/);
});
check("ответ 404 отправляет проверять Base URL", () => {
  assert.match(connectionError.fromStatus(404), /\/v1/);
});

console.log("\nсловари не разъехались");
/** Достаёт сообщения из таблицы CODES — она одинаково записана в .cjs и .tsx. */
function messagesOf(file) {
  const source = fs.readFileSync(file, "utf8");
  const table = source.slice(source.indexOf("const CODES"), source.indexOf("];", source.indexOf("const CODES")));
  const found = table.match(/"([^"\\]|\\.)*"/g) || [];
  return found.map((s) => JSON.parse(s)).filter((s) => /[а-яё]/i.test(s));
}

const reference = messagesOf(files["главный процесс, Личный код"]);
check("в словаре есть все проверенные случаи", () => {
  assert.ok(reference.length >= cases.length, `в словаре ${reference.length} причин`);
});
for (const [label, file] of Object.entries(files)) {
  if (label === "главный процесс, Личный код") continue;
  check(`${label}: те же объяснения`, () => {
    const mine = messagesOf(file);
    for (const message of reference) {
      assert.ok(mine.includes(message), `нет объяснения: ${message.slice(0, 40)}…`);
    }
  });
}

check("оба приложения используют один и тот же файл словаря", () => {
  assert.strictEqual(
    fs.readFileSync(files["главный процесс, Личный код"], "utf8"),
    fs.readFileSync(files["главный процесс, Личный чат"], "utf8")
  );
  assert.strictEqual(
    fs.readFileSync(files["окно, Личный код"], "utf8"),
    fs.readFileSync(files["окно, Личный чат"], "utf8")
  );
});

console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
