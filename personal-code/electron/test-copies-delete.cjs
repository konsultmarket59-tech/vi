// Удаление копии закрывает доступ, а не прячет строчку:
//   node electron/test-copies-delete.cjs
//
// «Удалила демо и собрала такую же новую с тем же именем» — самый обычный
// сценарий, и в нём легко получить путаницу: старый файл активации на руках у
// тестировщика подписан тем же ключом и выдан на тот же компьютер, а значит
// подойдёт и к новой копии. Поэтому при удалении ключи уезжают в постоянный
// список отзыва, который живёт отдельно от записей о копиях.
//
// Репозиторий на GitHub при этом остаётся, если о нём не попросили отдельно:
// это необратимо, и решать должен человек. Оба пути проверяются против
// поддельного GitHub, поднятого здесь же.

const http = require("node:http");

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
  }
}

const copies = require("./copies.cjs");

console.log("память о выданных ключах");
let store = copies.save([], {
  name: "Игорь",
  kind: "demo",
  apiKey: "ключ-демо",
  machineCode: "25A607886C45D028D2E1",
  days: 5,
}).all;
const copy = store[0];

// Выдали ключ, потом отозвали, потом выдали второй — как это и бывает.
const first = copies.licenceFor(copy, { days: 5 });
store = store.map((c) => (c.id === copy.id ? copies.withIssuedLicence(c, first) : c));
store = copies.setRevoked(store, copy.id, true);
const second = copies.licenceFor(store[0], { days: 5 });
store = store.map((c) => (c.id === copy.id ? copies.withIssuedLicence(c, second) : c));

const ids = copies.licenceIdsOf(store[0]);
check("оба выданных ключа помнятся", ids.includes(first.id) && ids.includes(second.id), ids.join(", "));

// Удаление: ключи переезжают в постоянный список, запись исчезает.
const retired = [...new Set([...copies.licenceIdsOf(store[0])])];
const afterDelete = copies.remove(store, copy.id);
check("записи о копии больше нет", afterDelete.length === 0, JSON.stringify(afterDelete));
check(
  "но ключи остались в списке отзыва",
  copies.revokedIds(afterDelete, retired).includes(first.id) &&
    copies.revokedIds(afterDelete, retired).includes(second.id),
  copies.revokedIds(afterDelete, retired).join(", ")
);
// Ровно тот случай, ради которого всё это: собрали новую копию с тем же именем.
const rebuilt = copies.save(afterDelete, {
  name: "Игорь",
  kind: "demo",
  apiKey: "ключ-демо",
  machineCode: "25A607886C45D028D2E1",
  days: 5,
}).all;
check("новая копия с тем же именем заводится", rebuilt.length === 1, JSON.stringify(rebuilt.map((c) => c.displayName)));
check(
  "и занимает тот же репозиторий",
  rebuilt[0].repoName === copy.repoName,
  `${rebuilt[0].repoName} vs ${copy.repoName}`
);
check(
  "старые ключи закрыты и для неё",
  copies.revokedIds(rebuilt, retired).includes(first.id),
  copies.revokedIds(rebuilt, retired).join(", ")
);
const newLicence = copies.licenceFor(rebuilt[0], { days: 5 });
check(
  "а новый ключ — новый и не закрыт",
  newLicence.id !== first.id && !copies.revokedIds(rebuilt, retired).includes(newLicence.id),
  newLicence.id
);

console.log("\nрепозиторий удаляется только по просьбе");
const calls = [];
let mode = "ok";
const server = http.createServer((req, res) => {
  calls.push(`${req.method} ${req.url}`);
  if (req.method === "DELETE" && mode === "ok") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "DELETE" && mode === "forbidden") {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ message: "Must have admin rights to Repository." }));
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ message: "Not Found" }));
});

server.listen(0, "127.0.0.1", async () => {
  process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`;
  const github = require("./github.cjs");
  try {
    const ok = await github.deleteRepo("test-token", "vlad", "lichnyy-chat-igor");
    check("удаление проходит", ok.ok === true, JSON.stringify(ok));
    check("и об этом сказано человеку", /удалён/i.test(ok.message), ok.message);
    check("запрос ушёл именно на удаление", calls.includes("DELETE /repos/vlad/lichnyy-chat-igor"), calls.join(" | "));

    mode = "forbidden";
    const denied = await github.deleteRepo("test-token", "vlad", "lichnyy-chat-igor");
    check("отказ не выдаётся за успех", denied.ok === false, JSON.stringify(denied));
    // Это самый вероятный отказ: обычный токен «repo, workflow» удалять не умеет.
    check("названа причина и что делать", /delete_repo/.test(denied.message), denied.message);

    mode = "missing";
    const gone = await github.deleteRepo("test-token", "vlad", "lichnyy-chat-igor");
    check("уже удалённый репозиторий — не ошибка", gone.ok === true, JSON.stringify(gone));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    server.close();
    process.exit(failures === 0 ? 0 : 1);
  }
});
