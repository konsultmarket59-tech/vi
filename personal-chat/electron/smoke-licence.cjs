// Demo access, end to end across both apps:
//   node electron/smoke-licence.cjs
//
// The issuing side lives in «Личный код» and the checking side here, so the two
// are tested together — a licence is actually signed by demoAccess.cjs and
// actually verified by licence.cjs. If their canonical form or key format ever
// drift apart, this fails.
//
// It checks the refusals as carefully as the successes: a licence for another
// computer, an expired one, a tampered one, and — importantly — a forged
// revocation list, which must not be able to switch anyone off.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const licence = require("./licence.cjs");
const demoAccess = require("../../personal-code/electron/demoAccess.cjs");

const configFile = path.join(__dirname, "..", "licence-config.json");
const hadConfig = fs.existsSync(configFile);
const previousConfig = hadConfig ? fs.readFileSync(configFile, "utf-8") : null;

const issuerData = fs.mkdtempSync(path.join(os.tmpdir(), "lic-issuer-"));
const appData = fs.mkdtempSync(path.join(os.tmpdir(), "lic-app-"));

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
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

function writeConfig(publicKey, revocationUrl = "") {
  fs.writeFileSync(
    configFile,
    JSON.stringify({ publicKey, revocationUrl, productName: "Личный чат — демо" }, null, 2)
  );
}

function cleanup() {
  if (hadConfig) fs.writeFileSync(configFile, previousConfig);
  else fs.rmSync(configFile, { force: true });
  fs.rmSync(issuerData, { recursive: true, force: true });
  fs.rmSync(appData, { recursive: true, force: true });
}

(async () => {
  demoAccess.init(issuerData);
  licence.init(appData);

  console.log("\nбез настроек демо-доступа (обычная сборка автора)");
  fs.rmSync(configFile, { force: true });
  const plain = await licence.status();
  check("сборка без ключа не блокируется", plain.gated === false && plain.ok === true, JSON.stringify(plain));
  check("код компьютера всё равно доступен", /^[0-9A-F]{5}(-[0-9A-F]{5}){3}$/.test(plain.machineCode), plain.machineCode);

  console.log("\nключ подписи");
  const keys = await demoAccess.createKeys();
  check("ключ создан", keys.exists && keys.publicKey.length > 40);
  await expectThrows("повторное создание ключа запрещено", () => demoAccess.createKeys(), /уже создан/);

  writeConfig(keys.publicKey);

  console.log("\nдемо-сборка без активации");
  const fresh = await licence.status();
  check("сборка требует активации", fresh.gated === true && fresh.ok === false && fresh.reason === "missing", JSON.stringify(fresh));
  check("название демо-версии подхвачено", fresh.productName === "Личный чат — демо", fresh.productName);

  console.log("\nвыдача");
  const machineCode = licence.machineFingerprint();
  let stored = [];
  ({ all: stored } = demoAccess.save(stored, { name: "Тестировщик Один", machineCode }));
  check("код компьютера принят в любом виде", demoAccess.normalizeMachineCode(plain.machineCode) === machineCode);

  await expectThrows(
    "слишком короткий код отклоняется",
    async () => demoAccess.save([], { name: "Кто-то", machineCode: "ABC" }),
    /20 знаков/
  );
  await expectThrows(
    "тот же компьютер нельзя записать дважды",
    async () => demoAccess.save(stored, { name: "Другой", machineCode }),
    /уже записан/
  );

  const issued = await demoAccess.issue(stored, stored[0].id, { days: 30 });
  stored = issued.all;
  check("лицензия выдана и срок записан", Boolean(stored[0].licenceId && stored[0].expiresAt), JSON.stringify(stored[0]));

  const activated = await licence.activate(issued.contents);
  check("активация прошла", activated.ok === true, JSON.stringify(activated));
  check("видно имя тестировщика", activated.tester === "Тестировщик Один", activated.tester);
  check("осталось около 30 дней", activated.daysLeft === 30 || activated.daysLeft === 29, String(activated.daysLeft));

  const afterRestart = await licence.status({ allowNetwork: false });
  check("после перезапуска активация сохраняется", afterRestart.ok === true, JSON.stringify(afterRestart));

  console.log("\nчто должно отклоняться");
  const parsed = JSON.parse(issued.contents);

  // Correctly signed, but for a different machine — this is the "передал exe
  // другу" case, and it must be refused on the machine check rather than the
  // signature check.
  const otherMachine = { ...parsed.licence, machine: "AAAAABBBBBCCCCCDDDDD" };
  const otherMachineFile = JSON.stringify({
    licence: otherMachine,
    signature: await demoAccess.sign(otherMachine),
  });
  await expectThrows("лицензия для другого компьютера", () => licence.activate(otherMachineFile), /для другого компьютера/);

  await expectThrows(
    "подделанные данные при настоящей подписи",
    () =>
      licence.activate(
        JSON.stringify({
          licence: { ...parsed.licence, expiresAt: new Date(Date.now() + 9e10).toISOString() },
          signature: parsed.signature,
        })
      ),
    /проверку подписи/
  );

  await expectThrows("испорченная подпись", () =>
    licence.activate(JSON.stringify({ licence: parsed.licence, signature: "AAAA" })), /проверку подписи/);

  await expectThrows("не тот файл вообще", () => licence.activate("это просто текст"), /не файл активации/);

  // A licence signed by a different key must not be accepted — this is what
  // stops someone generating their own and letting themselves in.
  const otherIssuer = fs.mkdtempSync(path.join(os.tmpdir(), "lic-other-"));
  const realKeys = path.join(issuerData, "demo-signing-key.json");
  const savedKeys = fs.readFileSync(realKeys, "utf-8");
  demoAccess.init(otherIssuer);
  await demoAccess.createKeys();
  const foreignTesters = demoAccess.save([], { name: "Самозванец", machineCode }).all;
  const foreign = await demoAccess.issue(foreignTesters, foreignTesters[0].id, { days: 30 });
  await expectThrows("лицензия, подписанная чужим ключом", () => licence.activate(foreign.contents), /проверку подписи/);
  demoAccess.init(issuerData);
  fs.writeFileSync(realKeys, savedKeys);
  fs.rmSync(otherIssuer, { recursive: true, force: true });

  console.log("\nсрок действия");
  const expiredIssue = await demoAccess.issue(stored, stored[0].id, { days: 1 });
  const expiredParsed = JSON.parse(expiredIssue.contents);
  // Re-sign with a date in the past rather than editing a signed file, so this
  // tests expiry and not signature checking.
  const backdated = {
    ...expiredParsed.licence,
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  };
  const backdatedFile = JSON.stringify({ licence: backdated, signature: await demoAccess.sign(backdated) });
  await expectThrows("просроченный файл не принимается", () => licence.activate(backdatedFile), /уже истёк/);

  // Install it directly to check the running app notices expiry too.
  fs.writeFileSync(path.join(appData, "licence.json"), backdatedFile);
  const expiredStatus = await licence.status({ allowNetwork: false });
  check("истёкшая копия перестаёт работать", expiredStatus.ok === false && expiredStatus.reason === "expired", JSON.stringify(expiredStatus));

  // Back to a valid licence for the revocation tests.
  fs.writeFileSync(path.join(appData, "licence.json"), issued.contents);
  fs.rmSync(path.join(appData, "licence-state.json"), { force: true });

  console.log("\nотзыв доступа");
  let serveBody = null;
  const server = http.createServer((_req, res) => {
    if (serveBody === null) {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(serveBody);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/revoked.json`;
  writeConfig(keys.publicKey, url);

  serveBody = await demoAccess.revocationList(stored);
  const notRevoked = await licence.status();
  check("пока никто не отозван — работает", notRevoked.ok === true, JSON.stringify(notRevoked));

  stored = demoAccess.setRevoked(stored, stored[0].id, true);
  serveBody = await demoAccess.revocationList(stored);
  fs.rmSync(path.join(appData, "licence-state.json"), { force: true });
  const revoked = await licence.status();
  check("отозванная копия блокируется", revoked.ok === false && revoked.reason === "revoked", JSON.stringify(revoked));

  // A list signed by nobody, or by the wrong key, must be ignored — otherwise
  // anyone able to intercept the connection could disable every copy at once.
  fs.rmSync(path.join(appData, "licence-state.json"), { force: true });
  serveBody = JSON.stringify({ list: { revoked: [JSON.parse(issued.contents).licence.id] }, signature: "AAAA" });
  const forged = await licence.status();
  check("неподписанный список отзыва игнорируется", forged.ok === true, JSON.stringify(forged));

  fs.rmSync(path.join(appData, "licence-state.json"), { force: true });
  serveBody = null; // server now answers 500
  const unreachable = await licence.status();
  check("недоступный список не выключает копию", unreachable.ok === true, JSON.stringify(unreachable));

  server.close();
  fs.rmSync(path.join(appData, "licence-state.json"), { force: true });
  const offline = await licence.status();
  check("совсем без сети копия работает до конца срока", offline.ok === true, JSON.stringify(offline));

  console.log("\nвозврат доступа");
  stored = demoAccess.setRevoked(stored, stored[0].id, false);
  const backList = JSON.parse(await demoAccess.revocationList(stored));
  check("после возврата список отзыва пуст", backList.list.revoked.length === 0, JSON.stringify(backList.list));

  console.log("\nсовместимость форматов");
  check(
    "каноническая форма одинакова в обоих приложениях",
    licence.canonical({ b: 1, a: [2, { d: 4, c: 3 }] }) === demoAccess.canonical({ b: 1, a: [2, { d: 4, c: 3 }] })
  );

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Тест упал:", e);
  cleanup();
  process.exit(1);
});
