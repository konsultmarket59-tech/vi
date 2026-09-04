// Одна кнопка «Собрать» — одна сборка на GitHub:
//   node electron/test-publish.cjs
//
// Было две: рабочий процесс копии подписан на push в main, а приложение после
// push'а ещё и запускало его вручную. Два одинаковых прогона занимали вдвое
// больше времени раннера и оба выкладывали установщик в один релиз наперегонки.
//
// Здесь весь путь «Собрать» проходится против поддельного GitHub: создаётся
// репозиторий, уезжает снимок кода с конфигурацией копии и рабочим процессом —
// и проверяется, что запрос на ручной запуск не уходит вовсе, а коммит один.

const http = require("node:http");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const CANONICAL_BRANCH = "main";
const CHAT_FILES = {
  "personal-chat/package.json": '{ "name": "personal-chat" }',
  "personal-chat/electron/main.cjs": "// чат\n",
  "music/track.wav": "тяжёлое",
};

const state = { calls: [], repos: [], blobs: new Map(), trees: [], commits: [], refs: new Map() };
const sha = (text) => require("node:crypto").createHash("sha1").update(text).digest("hex").slice(0, 12);

const server = http.createServer((req, res) => {
  const [urlPath] = req.url.split("?");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    state.calls.push(`${req.method} ${urlPath}`);
    const json = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (urlPath === "/user") return json(200, { login: "vlad" });
    if (urlPath === "/user/repos" && req.method === "GET") return json(200, state.repos);
    if (urlPath === "/user/repos" && req.method === "POST") {
      const { name } = JSON.parse(body);
      const repo = { id: 1, name, full_name: `vlad/${name}`, owner: { login: "vlad" }, private: true };
      state.repos.push(repo);
      return json(201, repo);
    }
    if (/\/git\/trees\/.+$/.test(urlPath) && req.method === "GET") {
      return json(200, {
        truncated: false,
        tree: Object.entries(CHAT_FILES).map(([p, content]) => ({
          path: p,
          type: "blob",
          mode: "100644",
          sha: "src-" + sha(p),
          size: content.length,
        })),
      });
    }
    if (/\/git\/blobs\/.+$/.test(urlPath) && req.method === "GET") {
      const found = Object.entries(CHAT_FILES).find(([p]) => "src-" + sha(p) === urlPath.split("/").pop());
      if (!found) return json(404, { message: "Not Found" });
      return json(200, { encoding: "base64", content: Buffer.from(found[1], "utf-8").toString("base64") });
    }
    if (urlPath.endsWith("/git/blobs") && req.method === "POST") {
      const { content } = JSON.parse(body);
      const id = "dst-" + sha(content);
      state.blobs.set(id, content);
      return json(201, { sha: id });
    }
    if (urlPath.endsWith("/git/trees") && req.method === "POST") {
      state.trees.push(JSON.parse(body).tree);
      return json(201, { sha: "tree-1" });
    }
    if (urlPath.endsWith("/git/commits") && req.method === "POST") {
      state.commits.push(JSON.parse(body));
      return json(201, { sha: "commit-" + state.commits.length });
    }
    if (/\/git\/ref\/heads\//.test(urlPath) && req.method === "GET") {
      const branch = urlPath.split("/git/ref/heads/")[1];
      const value = state.refs.get(branch);
      return value ? json(200, { object: { sha: value } }) : json(404, { message: "Not Found" });
    }
    if (urlPath.endsWith("/git/refs") && req.method === "POST") {
      const { ref, sha: value } = JSON.parse(body);
      state.refs.set(ref.replace("refs/heads/", ""), value);
      return json(201, { ref });
    }
    if (/\/git\/refs\/heads\//.test(urlPath) && req.method === "PATCH") {
      state.refs.set(urlPath.split("/git/refs/heads/")[1], JSON.parse(body).sha);
      return json(200, {});
    }
    json(404, { message: "Not Found" });
  });
});

server.listen(0, "127.0.0.1", async () => {
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`;
  const publish = require("./publish.cjs");
  const copies = require("./copies.cjs");

  try {
    const copy = copies.save([], {
      name: "Ирина",
      kind: "demo",
      apiKey: "ключ-демо",
      days: 5,
      office: ["excel", "word"],
      plugins: ["docflow"],
    }).all[0];

    const log = [];
    const result = await publish.publish(copy, {
      sourceRepo: "vlad/моно",
      branch: CANONICAL_BRANCH,
      token: "test-token",
      publicKey: "открытый-ключ",
      onLog: (line) => log.push(line),
    });

    console.log("сборка запускается один раз");
    check(
      "ручной запуск не запрашивается",
      !state.calls.some((c) => /dispatches/.test(c)),
      state.calls.filter((c) => /actions/.test(c)).join(" | ")
    );
    check("коммит ровно один", state.commits.length === 1, String(state.commits.length));
    check("и он без родителя", state.commits[0].parents.length === 0);
    check("ветка main поставлена на него", state.refs.get("main") === "commit-1", String(state.refs.get("main")));
    check("человеку сказано, что сборка пошла", log.some((l) => /запускается на GitHub/i.test(l)), log.join(" | "));

    console.log("\nв репозиторий копии уехало всё нужное");
    const paths = state.trees[0].map((e) => e.path).sort();
    check("код чата на месте", paths.includes("package.json") && paths.includes("electron/main.cjs"), paths.join(", "));
    check("лишнего из монорепозитория нет", !paths.some((p) => p.startsWith("music")), paths.join(", "));
    check("конфигурация копии", paths.includes("plugins.json"), paths.join(", "));
    check("ключ демо-копии", paths.includes("managed-config.json"), paths.join(", "));
    check("настройки активации", paths.includes("licence-config.json"), paths.join(", "));
    check("рабочий процесс сборки", paths.includes(".github/workflows/build.yml"), paths.join(", "));

    const workflowEntry = state.trees[0].find((e) => e.path === ".github/workflows/build.yml");
    const workflow = Buffer.from(state.blobs.get(workflowEntry.sha), "base64").toString("utf-8");
    check("рабочий процесс подписан на push в main", /push:\s*\n\s*branches: \[main\]/.test(workflow), workflow.slice(0, 200));
    check("и не публикует релиз сам", workflow.includes("--publish never"), workflow.slice(0, 200));

    console.log("\nчто вернулось в окно");
    check("репозиторий копии назван", result.repo === `vlad/${copy.repoName}`, result.repo);
    check("ссылка на сборки есть", /\/actions$/.test(result.actionsUrl), result.actionsUrl);
    check("отмечено, что сборка запущена", result.started === true, String(result.started));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
});
