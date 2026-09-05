// Копия «Личного чата» уезжает в свой репозиторий без git на компьютере:
//   node electron/test-sources.cjs
//
// Проверка идёт против поддельного GitHub, поднятого здесь же: настоящий из
// теста не подёргаешь, а проверять надо именно разговор с ним — что читается
// только папка personal-chat, что файлы попадают в репозиторий копии целиком
// (включая двоичные), что коммит без родителя, а ветка ставится принудительно.
//
// Почему это важно: раньше снимок собирал локальный git, и на компьютере без
// него сборка останавливалась словами «Git не найден» — при том что весь код
// лежит на GitHub.

const assert = require("node:assert");
const http = require("node:http");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
  }
}
async function expectThrows(label, fn, pattern) {
  try {
    await fn();
    failures++;
    console.log(`  FAIL ${label} — ожидалась ошибка, её не было`);
  } catch (e) {
    check(label, pattern ? pattern.test(e.message) : true, e.message);
  }
}

// Канонический репозиторий: чат вперемешку с тяжёлыми папками монорепозитория.
const CANONICAL = {
  "personal-chat/package.json": '{ "name": "personal-chat" }',
  "personal-chat/electron/main.cjs": "// чат\n",
  "personal-chat/build/icon.ico": Buffer.from([0, 1, 2, 250, 251, 252]).toString("base64"),
  "music/track.wav": "тяжёлое",
  "personal-code/electron/main.cjs": "// другое приложение\n",
  "README.md": "# монорепозиторий\n",
};

const state = { blobs: new Map(), trees: [], commits: [], refs: new Map(), calls: [] };

function shaOf(text) {
  return require("node:crypto").createHash("sha1").update(text).digest("hex");
}

const server = http.createServer((req, res) => {
  const [urlPath] = req.url.split("?");
  state.calls.push(`${req.method} ${urlPath}`);
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const json = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // дерево канонической ветки
    let m = urlPath.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/(.+)$/);
    if (m && req.method === "GET") {
      if (decodeURIComponent(m[3]) !== "каноническая") return json(404, { message: "Not Found" });
      return json(200, {
        truncated: false,
        tree: Object.entries(CANONICAL).map(([p, content]) => ({
          path: p,
          type: "blob",
          mode: "100644",
          sha: "src-" + shaOf(p).slice(0, 8),
          size: content.length,
        })),
      });
    }
    // чтение файла канонического репозитория
    m = urlPath.match(/^\/repos\/([^/]+)\/([^/]+)\/git\/blobs\/(.+)$/);
    if (m && req.method === "GET") {
      const found = Object.entries(CANONICAL).find(([p]) => "src-" + shaOf(p).slice(0, 8) === m[3]);
      if (!found) return json(404, { message: "Not Found" });
      const [p, content] = found;
      // Двоичный файл в канонической ветке уже лежит в base64 — как и отдаёт GitHub.
      const base64 = p.endsWith(".ico") ? content : Buffer.from(content, "utf-8").toString("base64");
      return json(200, { encoding: "base64", content: base64 });
    }
    // запись файла в репозиторий копии
    if (urlPath.endsWith("/git/blobs") && req.method === "POST") {
      const { content } = JSON.parse(body);
      const sha = "dst-" + shaOf(content).slice(0, 8);
      state.blobs.set(sha, content);
      return json(201, { sha });
    }
    if (urlPath.endsWith("/git/trees") && req.method === "POST") {
      const tree = JSON.parse(body).tree;
      state.trees.push(tree);
      return json(201, { sha: "tree-1" });
    }
    if (urlPath.endsWith("/git/commits") && req.method === "POST") {
      const commit = JSON.parse(body);
      state.commits.push(commit);
      return json(201, { sha: "commit-1" });
    }
    m = urlPath.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/);
    if (m && req.method === "GET") {
      const sha = state.refs.get(m[1]);
      return sha ? json(200, { object: { sha } }) : json(404, { message: "Not Found" });
    }
    if (urlPath.endsWith("/git/refs") && req.method === "POST") {
      const { ref, sha } = JSON.parse(body);
      state.refs.set(ref.replace("refs/heads/", ""), sha);
      return json(201, { ref });
    }
    m = urlPath.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/);
    if (m && req.method === "PATCH") {
      const { sha, force } = JSON.parse(body);
      state.refs.set(m[1], sha);
      state.forced = force;
      return json(200, { object: { sha } });
    }
    json(404, { message: "Not Found" });
  });
});

server.listen(0, "127.0.0.1", async () => {
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`;
  const sources = require("./sources.cjs");

  try {
    console.log("читаем канонический чат");
    const canonical = await sources.canonicalFiles("test-token", { repo: "владелец/моно", branch: "каноническая" });
    const paths = canonical.files.map((f) => f.path).sort();
    check("взята только папка чата", paths.length === 3, paths.join(", "));
    check("пути без префикса personal-chat", paths.includes("package.json"), paths.join(", "));
    check("вложенные файлы на месте", paths.includes("electron/main.cjs"), paths.join(", "));
    check("тяжёлые папки монорепозитория не взяты", !paths.some((p) => p.includes("music")), paths.join(", "));
    check("«Личного кода» в копии нет", !paths.some((p) => p.includes("personal-code")), paths.join(", "));

    console.log("\nперекладываем в репозиторий копии");
    const log = [];
    const result = await sources.publishSnapshot("test-token", {
      from: canonical,
      to: "владелец/личный-чат-мария",
      message: "снимок",
      onLog: (l) => log.push(l),
    });
    check("все файлы записаны", result.files === 3, String(result.files));
    check("ветка копии — main", result.branch === "main", result.branch);
    check("шаги видны человеку", log.some((l) => /Перекладываю файлы/.test(l)), log.join(" | "));

    const tree = state.trees[0];
    check("дерево собрано из тех же путей", tree.length === 3 && tree.every((e) => e.type === "blob"));
    const icon = tree.find((e) => e.path === "build/icon.ico");
    check(
      "двоичный файл перенесён байт в байт",
      state.blobs.get(icon.sha) === CANONICAL["personal-chat/build/icon.ico"],
      state.blobs.get(icon.sha)
    );
    const text = tree.find((e) => e.path === "package.json");
    check(
      "текстовый файл перенесён как есть",
      Buffer.from(state.blobs.get(text.sha), "base64").toString("utf-8") === CANONICAL["personal-chat/package.json"]
    );

    const commit = state.commits[0];
    check("коммит без родителя — истории монорепозитория в копии нет", commit.parents.length === 0);
    check("коммит с понятным сообщением", commit.message === "снимок", commit.message);
    check("ветка поставлена на этот коммит", state.refs.get("main") === "commit-1", String(state.refs.get("main")));

    console.log("\nконфигурация копии едет тем же коммитом");
    state.trees.length = 0;
    state.commits.length = 0;
    const withConfig = await sources.publishSnapshot("test-token", {
      from: canonical,
      to: "владелец/личный-чат-мария",
      message: "снимок с настройками",
      extraFiles: [
        { path: "plugins.json", content: '{"modules":[]}' },
        { path: ".github/workflows/build.yml", content: "name: Сборка\n" },
      ],
    });
    check("код и настройки в одном дереве", withConfig.files === 5, String(withConfig.files));
    check(
      "рабочий процесс на месте",
      withConfig.paths.includes(".github/workflows/build.yml"),
      withConfig.paths.join(", ")
    );
    // Отдельные коммиты в main запускали бы на GitHub по сборке на каждый.
    check("коммит по-прежнему один", state.commits.length === 1, String(state.commits.length));
    const cfg = state.trees[0].find((e) => e.path === "plugins.json");
    check(
      "настройки записаны как текст",
      Buffer.from(state.blobs.get(cfg.sha), "base64").toString("utf-8") === '{"modules":[]}'
    );

    console.log("\nповторная сборка поверх прежней");
    state.trees.length = 0;
    state.commits.length = 0;
    await sources.publishSnapshot("test-token", { from: canonical, to: "владелец/личный-чат-мария", message: "второй" });
    check("ветка переставлена принудительно", state.forced === true, String(state.forced));
    check("снова один коммит без родителя", state.commits[0].parents.length === 0);

    console.log("\nошибки объясняются, а не молчат");
    await expectThrows(
      "чужая ветка — понятная ошибка",
      () => sources.canonicalFiles("test-token", { repo: "владелец/моно", branch: "нет-такой" }),
      /Не удалось прочитать/
    );
    await expectThrows(
      "мусор вместо репозитория",
      () => sources.canonicalFiles("test-token", { repo: "просто текст", branch: "каноническая" }),
      /владелец\/репозиторий/
    );
    await expectThrows(
      "без ветки не начинаем",
      () => sources.canonicalFiles("test-token", { repo: "владелец/моно", branch: "" }),
      /каноническая ветка/
    );

    console.log("\nгит не понадобился");
    check(
      "весь разговор — только с GitHub API",
      state.calls.every((c) => /^(GET|POST|PATCH) \/repos\//.test(c)),
      state.calls.slice(0, 3).join(" | ")
    );
    assert.ok(state.calls.length > 5);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
});
