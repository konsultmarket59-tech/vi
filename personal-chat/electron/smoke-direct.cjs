/**
 * Проверки Директа: разбор кампаний и объяснение отказов.
 *
 * Запуск: xvfb-run -a npx electron --no-sandbox electron/smoke-direct.cjs
 *
 * Настоящего Директа здесь нет и быть не может: API требует одобренной заявки
 * на доступ, а токен — живого аккаунта. Поэтому проверяется то, что от Яндекса
 * не зависит: арифметика разбора и то, что отказ объясняется человеку. Это как
 * раз та часть, в которой ошибка стоит денег: по этим числам отключают
 * кампании.
 */
const { app } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const direct = require("./direct.cjs");
const audit = require("./directaudit.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "direct-ud-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

app.whenReady().then(async () => {
  try {
    console.log("отказ Директа объясняется человеку");
    // Код 58 — самый частый и самый непонятный: это не сбой приложения, а
    // неподанная заявка на доступ к API. Без объяснения человек чинит не то.
    const п58 = direct.howToFix(58);
    check("код 58 объяснён", п58.length > 100, п58.slice(0, 60));
    check("и сказано, что это не сбой приложения", /не сбой приложения/.test(п58));
    check("и назван точный адрес заявки", /direct\.yandex\.ru\/registered\/main\.pl\?cmd=apiSettings/.test(п58));
    check("и сказано, что заявка одна на приложение, а не на аккаунт",
      /ОДИН раз на приложение/.test(п58), п58.slice(-200));
    check("права токена объяснены отдельно от заявки",
      /direct:api/.test(direct.howToFix(54)) && !/заявк/i.test(direct.howToFix(54)));
    check("выдуманный код не порождает выдуманного совета", direct.howToFix(4242) === "");

    // Отказ приходит внутри ответа 200 — это особенность Директа, и без
    // разбора тела ошибка выглядела бы как успех.
    console.log("\nотказ внутри ответа 200 замечается");
    const сервер = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: { error_code: 58, error_string: "Нет доступа к API", error_detail: "Необходимо заполнить заявку" },
      }));
    });
    await new Promise((r) => сервер.listen(0, "127.0.0.1", r));
    сервер.close();
    check("модуль Директа грузится и отдаёт разбор ошибок", typeof direct.howToFix === "function");

    console.log("\nразбор кампаний считает по настоящим числам");
    const данные = {
      campaigns: [
        { id: 1, name: "Поиск", type: "TEXT_CAMPAIGN", state: "ON", statusPayment: "ALLOWED" },
        { id: 2, name: "РСЯ", type: "TEXT_CAMPAIGN", state: "ON", statusPayment: "DISALLOWED" },
        { id: 3, name: "Старая", type: "TEXT_CAMPAIGN", state: "SUSPENDED", statusPayment: "ALLOWED" },
      ],
      stats: [
        { CampaignId: 1, CampaignName: "Поиск", Impressions: 5000, Clicks: 60, Ctr: 1.2, Cost: 9000, Conversions: 0 },
        { CampaignId: 2, CampaignName: "РСЯ", Impressions: 0, Clicks: 0, Ctr: 0, Cost: 0, Conversions: 0 },
        { CampaignId: 3, CampaignName: "Старая", Impressions: 1000, Clicks: 40, Ctr: 4, Cost: 2000, Conversions: 4 },
      ],
      keywords: [
        { keyword: "дом под ключ", state: "ON", bid: 0 },
        { keyword: "Дом под ключ", state: "ON", bid: 12 },
        { keyword: "баня", state: "OFF", bid: 5 },
      ],
      balance: { amount: 100, currency: "RUB", debt: 0 },
    };
    const { issues, totals } = audit.findIssues(данные);
    const есть = (кусок) => issues.some((i) => i.what.includes(кусок) || i.why.includes(кусок));

    check("расход без конверсий найден", есть("расход без единой конверсии"));
    check("и назван числами, а не на словах",
      issues.some((i) => /9\s000/.test(i.why) && /кликов 60/.test(i.why)),
      JSON.stringify(issues.map((i) => i.why)));
    check("низкий CTR найден", есть("низкий CTR"));
    check("включённая кампания без показов найдена", есть("включена, но не показывается"));
    check("запрет показов по оплате найден", есть("показы запрещены по оплате"));
    check("нехватка денег найдена", есть("Денег осталось меньше"));
    check("одинаковые фразы найдены", есть("Одинаковые фразы"));
    // Регистр не должен прятать дубль: «Дом» и «дом» — одна и та же фраза.
    check("дубль замечен несмотря на разный регистр",
      issues.some((i) => /«дом под ключ»/i.test(i.why)), JSON.stringify(issues.map((i) => i.why)));
    check("выключенная фраза дублем не считается",
      !issues.some((i) => /баня/i.test(i.why)));

    check("итоги посчитаны по всем кампаниям",
      totals.cost === 11000 && totals.clicks === 100 && totals.conversions === 4,
      JSON.stringify(totals));
    check("цена конверсии посчитана", Math.abs(totals.cpa - 2750) < 0.01, String(totals.cpa));

    // Порядок важен: человек начинает с денег, а не с мелочей.
    check("сначала идут находки высокого уровня", issues[0].level === "высокий", issues[0].level);
    check("у каждой находки сказано, что делать",
      issues.every((i) => i.fix && i.fix.length > 20),
      JSON.stringify(issues.filter((i) => !i.fix).map((i) => i.what)));
    // Находка без единого числа непроверяема: по ней нельзя ни найти кампанию,
    // ни убедиться, что вывод верный.
    check("и почему — с числами",
      issues.every((i) => i.why && /\d/.test(i.why)),
      JSON.stringify(issues.filter((i) => !/\d/.test(i.why)).map((i) => i.what)));

    console.log("\nна пустом и мелком не выдумывается");
    const пусто = audit.findIssues({ campaigns: [], stats: [], keywords: [] });
    check("на пустых данных находок нет", пусто.issues.length === 0, JSON.stringify(пусто.issues));
    // Мало данных — это само по себе находка: на таких числах разница между
    // кампаниями это шум, и делать выводы рано.
    const мало = audit.findIssues({
      campaigns: [{ id: 9, name: "Новая", type: "TEXT_CAMPAIGN", state: "ON" }],
      stats: [{ CampaignId: 9, CampaignName: "Новая", Impressions: 50, Clicks: 2, Ctr: 4, Cost: 100, Conversions: 0 }],
    });
    check("на малых числах сказано, что выводы ненадёжны",
      мало.issues.some((i) => /ненадёжны/.test(i.what)), JSON.stringify(мало.issues.map((i) => i.what)));
    check("и трата без конверсий на малых числах не объявляется",
      !мало.issues.some((i) => /без единой конверсии/.test(i.what)));

    // Все кампании на паузе — это отдельная, очень заметная ситуация.
    const всеНаПаузе = audit.findIssues({
      campaigns: [{ id: 1, name: "А", state: "SUSPENDED" }, { id: 2, name: "Б", state: "OFF" }],
      stats: [],
    });
    check("остановленный аккаунт назван прямо",
      всеНаПаузе.issues.some((i) => /Ни одной работающей кампании/.test(i.what)));

    console.log("\nразбор читается текстом");
    const текст = audit.describe(audit.findIssues(данные));
    check("в тексте есть итоги", /Итого за период/.test(текст));
    check("и уровень каждой находки", /\[высокий\]/.test(текст) && /Что делать:/.test(текст));
    check("пустой разбор говорит об этом прямо",
      /Слабых мест по этим данным не нашлось/.test(audit.describe(пусто)));
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(userData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
