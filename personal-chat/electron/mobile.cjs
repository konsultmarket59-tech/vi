// Телефон: та же команда ролей, но с телефона, через домашнюю сеть.
//
// Почему так, а не «приложение для телефона». Всё, ради чего этот раздел
// существует, лежит на компьютере: проекты, документы, ключи от моделей, готовые
// файлы. Настоящее мобильное приложение означало бы копию данных в облаке — то
// есть ровно то, чего это приложение принципиально не делает. Поэтому телефон не
// хранит ничего: он показывает то, что считает компьютер, и работает, пока
// компьютер включён и оба в одной сети (домашний Wi-Fi, раздача с телефона).
//
// Безопасность здесь — не формальность: сервер слушает все сетевые интерфейсы,
// значит, до него дотянется любое устройство в этой же сети.
//   - Без кода доступа не отдаётся ничего, кроме страницы входа.
//   - Код — шесть цифр, живёт в настройках, меняется кнопкой.
//   - Подбор кода бессмыслен: после десяти неверных попыток вход закрывается на
//     минуту, и счётчик общий для всех устройств.
//   - Пропуск после входа — случайный токен в памяти процесса: закрыли
//     приложение — все телефоны разлогинились.
// Выносить этот адрес в интернет (пробросом порта) нельзя, и об этом сказано в
// README прямым текстом.

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const DEFAULT_PORT = 8765;
const MAX_BODY_BYTES = 12 * 1024 * 1024; // фотография с телефона в base64
const LOCK_AFTER_FAILURES = 10;
const LOCK_MS = 60 * 1000;

let server = null;
let state = {
  running: false,
  port: DEFAULT_PORT,
  code: "",
  error: "",
};
const tokens = new Set();
let failures = 0;
let lockedUntil = 0;

/** Адреса, по которым компьютер виден в локальной сети. */
function localAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      out.push({ name, address: net.address });
    }
  }
  return out;
}

function newCode() {
  // Шесть цифр из криптографического генератора: код читают с экрана и набирают
  // на телефоне, поэтому он должен быть коротким, но не предсказуемым.
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function status() {
  return {
    running: state.running,
    port: state.port,
    code: state.code,
    error: state.error,
    addresses: localAddresses().map((a) => ({ ...a, url: `http://${a.address}:${state.port}` })),
    devices: tokens.size,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Файл слишком большой: больше 12 МБ телефон не передаёт."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token && tokens.has(token);
}

/**
 * Поднимает сервер.
 *
 * `methods` — таблица «имя → функция», единственный способ телефона что-то
 * сделать. Список составляет main.cjs, и в нём нет ничего, что могло бы записать
 * файл куда угодно или выполнить произвольную команду: только разговоры с
 * ролями, чтение страниц и приём фотографии в папку приложения.
 */
async function start({ port = DEFAULT_PORT, code = "", methods = {} } = {}) {
  await stop();
  state = { running: false, port: Number(port) || DEFAULT_PORT, code: code || newCode(), error: "" };
  failures = 0;
  lockedUntil = 0;

  const page = await fs.readFile(path.join(__dirname, "mobile-app.html"), "utf-8");

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(page);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/login") {
        if (Date.now() < lockedUntil) {
          sendJson(res, 429, { error: "Слишком много неверных попыток. Подождите минуту." });
          return;
        }
        const body = JSON.parse((await readBody(req)) || "{}");
        if (String(body.code || "").trim() !== state.code) {
          failures++;
          if (failures >= LOCK_AFTER_FAILURES) {
            lockedUntil = Date.now() + LOCK_MS;
            failures = 0;
          }
          sendJson(res, 403, { error: "Код не подошёл." });
          return;
        }
        failures = 0;
        const token = crypto.randomBytes(24).toString("hex");
        tokens.add(token);
        sendJson(res, 200, { token });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/call") {
        if (!authorized(req)) {
          sendJson(res, 401, { error: "Нужен вход по коду." });
          return;
        }
        const body = JSON.parse((await readBody(req)) || "{}");
        const fn = methods[body.method];
        if (typeof fn !== "function") {
          sendJson(res, 404, { error: `Телефон просит неизвестное действие «${body.method}».` });
          return;
        }
        const result = await fn(...(Array.isArray(body.args) ? body.args : []));
        sendJson(res, 200, { result: result === undefined ? null : result });
        return;
      }

      sendJson(res, 404, { error: "Нет такой страницы." });
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (e) => {
      state.error =
        e && e.code === "EADDRINUSE"
          ? `Порт ${state.port} уже занят другой программой. Укажите другой порт.`
          : e.message || String(e);
      server = null;
      reject(new Error(state.error));
    };
    server.once("error", onError);
    server.listen(state.port, "0.0.0.0", () => {
      server.removeListener("error", onError);
      // Порт 0 означает «любой свободный» — какой именно, знает только сокет.
      // Без этого в настройках был бы показан ноль, а не адрес, который работает.
      state.port = server.address().port;
      state.running = true;
      resolve();
    });
  });

  return status();
}

async function stop() {
  tokens.clear();
  if (!server) {
    state.running = false;
    return status();
  }
  const closing = server;
  server = null;
  await new Promise((resolve) => closing.close(resolve));
  state.running = false;
  return status();
}

function regenerateCode() {
  state.code = newCode();
  // Смена кода выгоняет уже вошедшие телефоны: иначе «сменить код» не защищало бы
  // от телефона, который код уже узнал.
  tokens.clear();
  return status();
}

module.exports = {
  DEFAULT_PORT,
  start,
  stop,
  status,
  regenerateCode,
  newCode,
  localAddresses,
};
