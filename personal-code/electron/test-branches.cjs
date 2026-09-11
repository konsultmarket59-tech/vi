// Ветка GitHub как рабочая папка, без git на компьютере:
//   node electron/test-branches.cjs
//
// На этом держатся и «Фикс» (подтянуть чужую копию или любую ветку), и «Новый
// плагин» (ответвиться, написать, отправить, открыть PR). Проверяется против
// поддельного GitHub: что выкачивается только нужная папка, что правки уезжают
// поверх ветки — не затирая чужое, — что удалённый файл удаляется, а не
// остаётся, и что повторная отправка не считает те же файлы изменёнными снова.

const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 250) : ""}`);
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

const blobSha = (data) =>
  crypto.createHash("sha1").update(`blob ${Buffer.byteLength(data)}\0`).update(data).digest("hex");

// Поддельный GitHub, который ведёт себя как настоящий в том, что здесь важно:
// коммит меняет содержимое ветки. Без этого «повторная отправка» проверялась бы
// против неизменной выдачи и ничего не значила.
const initialFiles = {
  "personal-chat/package.json": '{ "name": "personal-chat" }',
  "personal-chat/electron/main.cjs": "// чат\n",
  "personal-chat/electron/лишний.cjs": "// этот файл потом удалим\n",
  "personal-code/electron/main.cjs": "// другое приложение\n",
  "music/track.wav": "тяжёлое",
};

const blobs = new Map(); // sha -> содержимое (строка)
const trees = new Map(); // sha -> { путь: sha содержимого }
const commits = new Map(); // sha -> { sha, tree, parents, message }
const branches = new Map(); // ветка -> sha коммита
const state = { pulls: [], calls: [], treeRequests: [] };

function put(content) {
  const sha = blobSha(content);
  blobs.set(sha, content);
  return sha;
}

const rootTree = {};
for (const [p, content] of Object.entries(initialFiles)) rootTree[p] = put(content);
trees.set("tree-0", rootTree);
commits.set("commit-0", { sha: "commit-0", tree: { sha: "tree-0" }, parents: [] });
branches.set("main", "commit-0");

function filesOfBranch(name) {
  const commit = commits.get(branches.get(name));
  return trees.get(commit.tree.sha) || {};
}

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
    let m;
    if ((m = urlPath.match(/\/git\/ref\/heads\/(.+)$/)) && req.method === "GET") {
      const sha = branches.get(decodeURIComponent(m[1]));
      return sha ? json(200, { object: { sha } }) : json(404, { message: "Not Found" });
    }
    if ((m = urlPath.match(/\/git\/trees\/(.+)$/)) && req.method === "GET") {
      const name = decodeURIComponent(m[1]);
      if (!branches.has(name)) return json(404, { message: "Not Found" });
      state.treeRequests.push(name);
      return json(200, {
        truncated: false,
        tree: Object.entries(filesOfBranch(name)).map(([p, sha]) => ({
          path: p,
          type: "blob",
          mode: "100644",
          sha,
        })),
      });
    }
    if ((m = urlPath.match(/\/git\/blobs\/([^/]+)$/)) && req.method === "GET") {
      const content = blobs.get(m[1]);
      if (content === undefined) return json(404, { message: "Not Found" });
      return json(200, { encoding: "base64", content: Buffer.from(content, "utf-8").toString("base64") });
    }
    if ((m = urlPath.match(/\/git\/commits\/([^/]+)$/)) && req.method === "GET") {
      const commit = commits.get(m[1]);
      return commit ? json(200, commit) : json(404, { message: "Not Found" });
    }
    if (urlPath.endsWith("/git/blobs") && req.method === "POST") {
      const { content } = JSON.parse(body);
      return json(201, { sha: put(Buffer.from(content, "base64").toString("utf-8")) });
    }
    if (urlPath.endsWith("/git/trees") && req.method === "POST") {
      const parsed = JSON.parse(body);
      state.treeBodies.push(parsed);
      const files = { ...(trees.get(parsed.base_tree) || {}) };
      for (const entry of parsed.tree) {
        if (entry.sha === null) delete files[entry.path];
        else files[entry.path] = entry.sha;
      }
      const sha = "tree-" + (trees.size + 1);
      trees.set(sha, files);
      return json(201, { sha });
    }
    if (urlPath.endsWith("/git/commits") && req.method === "POST") {
      const parsed = JSON.parse(body);
      const sha = "commit-" + (commits.size + 1);
      commits.set(sha, { sha, tree: { sha: parsed.tree }, message: parsed.message, parents: parsed.parents });
      return json(201, { sha });
    }
    if (urlPath.endsWith("/git/refs") && req.method === "POST") {
      const { ref, sha } = JSON.parse(body);
      branches.set(ref.replace("refs/heads/", ""), sha);
      return json(201, { ref });
    }
    if ((m = urlPath.match(/\/git\/refs\/heads\/(.+)$/)) && req.method === "PATCH") {
      branches.set(decodeURIComponent(m[1]), JSON.parse(body).sha);
      return json(200, {});
    }
    if (urlPath.endsWith("/pulls") && req.method === "POST") {
      const parsed = JSON.parse(body);
      if (state.pulls.some((p) => p.head === parsed.head)) {
        return json(422, { message: "A pull request already exists for that branch." });
      }
      state.pulls.push(parsed);
      return json(201, { number: state.pulls.length, html_url: `https://github.com/x/y/pull/${state.pulls.length}` });
    }
    if (urlPath.endsWith("/pulls") && req.method === "GET") {
      const head = decodeURIComponent((req.url.split("head=")[1] || "").split("&")[0]);
      const found = state.pulls.findIndex((p) => head.endsWith(p.head));
      if (found >= 0) return json(200, [{ number: found + 1, html_url: `https://github.com/x/y/pull/${found + 1}` }]);
      return json(200, []);
    }
    json(404, { message: "Not Found" });
  });
});
state.treeBodies = [];

server.listen(0, "127.0.0.1", async () => {
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`;
  const branchTools = require("./branches.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-"));

  try {
    console.log("выкачиваем ветку");
    const log = [];
    const manifest = await branchTools.pull("test-token", {
      repo: "vlad/моно",
      branch: "main",
      dir,
      subdir: "personal-chat",
      onLog: (l) => log.push(l),
    });
    check("в папке файлы чата", fs.existsSync(path.join(dir, "electron/main.cjs")));
    check("без префикса papки в путях", fs.existsSync(path.join(dir, "package.json")));
    check("чужого в папке нет", !fs.existsSync(path.join(dir, "personal-code")) && !fs.existsSync(path.join(dir, "music")));
    check("снимок ветки записан", branchTools.isBranchFolder(dir) && manifest.head === "commit-0", JSON.stringify(manifest.head));
    check("шаги видны человеку", log.some((l) => /Читаю ветку/.test(l)), log.join(" | "));

    console.log("\nправим, добавляем, удаляем");
    fs.writeFileSync(path.join(dir, "electron/main.cjs"), "// чат, правка\n");
    fs.mkdirSync(path.join(dir, "electron/plugins"), { recursive: true });
    fs.writeFileSync(path.join(dir, "electron/plugins/новый.cjs"), "// новый плагин\n");
    fs.rmSync(path.join(dir, "electron/лишний.cjs"));
    const diff = await branchTools.changes(dir);
    check("правка замечена", diff.changed.includes("electron/main.cjs"), JSON.stringify(diff.changed));
    check("новый файл замечен", diff.added.includes("electron/plugins/новый.cjs"), JSON.stringify(diff.added));
    check("удаление замечено", diff.removed.includes("electron/лишний.cjs"), JSON.stringify(diff.removed));

    console.log("\nотправляем одним коммитом");
    const pushed = await branchTools.push("test-token", dir, { message: "Плагин «Новый»" });
    check("отправка прошла", pushed.ok === true, JSON.stringify(pushed));
    const tree = state.treeBodies[0];
    check("правки легли поверх ветки", tree.base_tree === "tree-0", JSON.stringify(tree.base_tree));
    check(
      "пути вернули префикс папки",
      tree.tree.every((e) => e.path.startsWith("personal-chat/")),
      JSON.stringify(tree.tree.map((e) => e.path))
    );
    check(
      "удалённый файл помечен к удалению",
      tree.tree.some((e) => e.path === "personal-chat/electron/лишний.cjs" && e.sha === null),
      JSON.stringify(tree.tree)
    );
    const commit = commits.get(pushed.commit);
    check("коммит продолжает ветку, а не заменяет её", commit.parents[0] === "commit-0", JSON.stringify(commit.parents));
    check("сообщение — то, что написал человек", commit.message === "Плагин «Новый»", commit.message);
    check("ветка переставлена на новый коммит", branches.get("main") === pushed.commit);

    console.log("\nповторная отправка не повторяет то же самое");
    const again = await branchTools.push("test-token", dir, { message: "ещё раз" });
    check("менять нечего — и это сказано, а не сделано", again.ok === false && /Изменений нет/.test(again.message), JSON.stringify(again));
    await expectThrows("без сообщения коммит не уходит", async () => {
      fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "personal-chat", "version": "2" }');
      await branchTools.push("test-token", dir, { message: "  " });
    }, /сообщение коммита/);

    console.log("\nновая ветка и запрос на слияние");
    const created = await branchTools.branchFrom("test-token", { repo: "vlad/моно", from: "main", name: "плагин сайты" });
    check("пробелы в названии ветки не проходят на GitHub", created.name === "плагин-сайты", created.name);
    check("ветка создана от main", created.created === true && branches.get("плагин-сайты") === branches.get("main"));
    const same = await branchTools.branchFrom("test-token", { repo: "vlad/моно", from: "main", name: "плагин-сайты" });
    check("существующая ветка не пересоздаётся", same.created === false);

    const branchDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch2-"));
    await branchTools.pull("test-token", { repo: "vlad/моно", branch: "плагин-сайты", dir: branchDir, subdir: "personal-chat" });
    const pr = await branchTools.pullRequest("test-token", branchDir, { base: "main", title: "Плагин «Сайты»" });
    check("PR открыт", /pull\/1$/.test(pr.url), JSON.stringify(pr));
    const twice = await branchTools.pullRequest("test-token", branchDir, { base: "main", title: "Плагин «Сайты»" });
    check("второй раз возвращается тот же PR, а не ошибка", twice.created === false && twice.url === pr.url, JSON.stringify(twice));
    await expectThrows(
      "PR из главной ветки в неё же — понятная ошибка",
      () => branchTools.pullRequest("test-token", dir, { base: "main" }),
      /и есть основная/
    );
    fs.rmSync(branchDir, { recursive: true, force: true });

    console.log("\nгит не понадобился");
    check("весь разговор — только с GitHub API", state.calls.every((c) => /^(GET|POST|PATCH) \/repos\//.test(c)), state.calls[0]);
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message, e.stack?.split("\n")[1] || "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
});
