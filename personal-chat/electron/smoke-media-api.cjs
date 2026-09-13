// Медиа: что на самом деле уходит в модель и что бывает с оплаченным заказом.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-media-api.cjs
//
// Настоящего обращения к платному сервису здесь нет: вместо него поднимается
// поддельный, который записывает ВСЁ, что ему прислали. Это и есть предмет
// проверки — не «код не падает», а «настройка, которую человек выставил в
// окне, доехала до модели ровно такой, какой он её выставил».
//
// Отдельно проверяется беда, из-за которой пропали деньги: генерация дошла до
// конца на стороне сервиса, а приложение перестало ждать и выбросило номер
// заказа. Заказ, за который сняты деньги, не должен пропадать никогда.

const { app } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const media = require("./media.cjs");
const mediakit = require("./mediakit.cjs");
const { finish } = require("./finish.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mapi-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mapi-data-"));
app.setPath("userData", userData);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 400) : ""}`);
  }
}

/** Поддельный сервис: помнит последний запрос и отвечает так, как велено. */
function startServer(behaviour) {
  const принято = { создание: null, опросов: 0, скачиваний: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8");
      if (req.method === "POST" && req.url.endsWith("/media")) {
        принято.создание = JSON.parse(body || "{}");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "order-1", status: behaviour.createStatus || "pending" }));
        return;
      }
      if (req.method === "GET" && /\/media\/order-1$/.test(req.url)) {
        принято.опросов += 1;
        const готово = behaviour.readyAfter !== undefined && принято.опросов >= behaviour.readyAfter;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(
          готово
            ? { id: "order-1", status: "completed", data: { url: `http://127.0.0.1:${server.address().port}/file.png` }, usage: { cost_rub: 5.95 } }
            : { id: "order-1", status: "processing" }
        ));
        return;
      }
      if (req.url.includes("file.png")) {
        принято.скачиваний += 1;
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(Buffer.from("89504e470d0a1a0a", "hex"));
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, принято, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

app.whenReady().then(async () => {
  try {
    console.log("настройки доезжают до модели ровно такими, как выставлены");
    let { server, принято, base } = await startServer({ readyAfter: 1 });
    const итог = await media.generate(dataRoot, {
      baseUrl: base,
      apiKey: "test-key",
      type: "image",
      model: "seedream-3",
      prompt: "дом у леса",
      params: mediakit.buildParams("image", {
        aspect_ratio: "9:16",
        n: "2",
        negative_prompt: "текст, водяные знаки",
        seed: "12345",
        guidance_scale: "7,5",
        steps: "30",
        output_format: "png",
      }),
    });
    const вход = принято.создание.input;
    check("модель уехала та, что выбрана", принято.создание.model === "seedream-3", JSON.stringify(принято.создание.model));
    check("промпт уехал", вход.prompt === "дом у леса", вход.prompt);
    check("пропорции уехали", вход.aspect_ratio === "9:16", String(вход.aspect_ratio));
    check("число вариантов уехало числом", вход.n === 2 && typeof вход.n === "number", JSON.stringify(вход.n));
    check("«чего не должно быть» уехало", вход.negative_prompt === "текст, водяные знаки", вход.negative_prompt);
    check("зерно уехало числом", вход.seed === 12345 && typeof вход.seed === "number", JSON.stringify(вход.seed));
    check("дробное число с запятой понято", вход.guidance_scale === 7.5, JSON.stringify(вход.guidance_scale));
    check("шаги уехали", вход.steps === 30, JSON.stringify(вход.steps));
    check("формат файла уехал", вход.output_format === "png", String(вход.output_format));
    check("результат скачан и сохранён", !!итог.localPath && fs.existsSync(итог.localPath), итог.localPath);
    check("стоимость записана", итог.costRub === 5.95, String(итог.costRub));
    check("незабранных не осталось", (await media.listPending(dataRoot)).length === 0);
    server.close();

    console.log("\nнезаполненное не отправляется вовсе");
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      params: mediakit.buildParams("image", { aspect_ratio: "1:1", seed: "", steps: "", negative_prompt: "" }),
    });
    const пустые = принято.создание.input;
    // Пустое поле хуже отсутствующего: модель на `seed: ""` спотыкается, и
    // человек видит невнятную ошибку вместо картинки.
    check("пустые поля в запрос не попали",
      !("seed" in пустые) && !("steps" in пустые) && !("negative_prompt" in пустые), JSON.stringify(пустые));
    check("заполненное при этом на месте", пустые.aspect_ratio === "1:1");
    server.close();

    console.log("\nрукописный JSON кладётся поверх полей");
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "video", model: "м", prompt: "п",
      params: mediakit.buildParams("video", { aspect_ratio: "16:9", duration: "5" }),
      extraParamsJson: '{"aspect_ratio":"9:16","своё_поле":true}',
    });
    // Кто написал параметр руками, знает про эту модель больше, чем общий
    // список полей, — его слово должно быть последним.
    check("рукописное значение победило поле формы",
      принято.создание.input.aspect_ratio === "9:16", String(принято.создание.input.aspect_ratio));
    check("поле, которого нет в форме, тоже уехало", принято.создание.input["своё_поле"] === true);
    check("остальные поля формы сохранились", принято.создание.input.duration === 5);
    server.close();

    console.log("\nкартинки-референсы");
    const кар1 = path.join(userData, "а.png");
    const кар2 = path.join(userData, "б.jpg");
    fs.writeFileSync(кар1, Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(кар2, Buffer.from("ffd8ffe000104a46", "hex"));
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      referenceImages: [кар1, кар2],
    });
    const кар = принято.создание.input.images;
    check("уехали обе картинки, в заданном порядке", кар.length === 2, JSON.stringify(кар.length));
    check("тип картинки определён по расширению",
      кар[0].data.startsWith("data:image/png;base64,") && кар[1].data.startsWith("data:image/jpeg;base64,"),
      кар.map((k) => k.data.slice(0, 24)).join(" | "));
    server.close();

    console.log("\nоплаченный заказ не пропадает");
    // Ровно тот случай, что стоил денег: сервис досчитал, а приложение
    // перестало ждать. Ожидание здесь укорочено до долей секунды, чтобы это
    // воспроизвести; в работе оно минутами.
    const прежние = { ...media.POLL_CONFIG.image };
    media.POLL_CONFIG.image.maxWaitMs = 400;
    media.POLL_CONFIG.image.intervalMs = 100;
    ({ server, принято, base } = await startServer({ readyAfter: 99 }));
    let ошибка = null;
    await media
      .generate(dataRoot, { baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "дом" })
      .catch((e) => (ошибка = e));
    check("ожидание кончилось ошибкой", !!ошибка, "ошибки не было вовсе");
    check("но сказано, что заказ не пропал",
      ошибка && /не пропал/.test(ошибка.message) && /Забрать/.test(ошибка.message), ошибка && ошибка.message);
    const ждут = await media.listPending(dataRoot);
    check("заказ записан в журнал", ждут.length === 1 && ждут[0].id === "order-1", JSON.stringify(ждут));
    check("в журнале есть чем его опознать",
      ждут[0].model === "м" && ждут[0].prompt === "дом" && ждут[0].type === "image", JSON.stringify(ждут[0]));

    // Пока не готов — это не сбой, а нормальное положение дел.
    const рано = await media.collect(dataRoot, { baseUrl: base, apiKey: "test-key", id: "order-1", type: "image" });
    check("незаконченный заказ не считается ошибкой", рано.ready === false, JSON.stringify(рано));
    check("и остаётся в журнале", (await media.listPending(dataRoot)).length === 1);
    server.close();

    // А когда сервис досчитал — результат забирается тем же номером.
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    const забрано = await media.collect(dataRoot, {
      baseUrl: base, apiKey: "test-key", id: "order-1", type: "image", model: "м", prompt: "дом",
    });
    check("оплаченный результат забран", забрано.ready === true && fs.existsSync(забрано.item.localPath),
      JSON.stringify(забрано.ready));
    check("и снят с журнала", (await media.listPending(dataRoot)).length === 0);
    check("и попал в общий список", (await media.list(dataRoot)).some((x) => x.id === "order-1"));
    // Журнал лежит в той же папке, но записью не является: попав в список как
    // «генерация», он ломал раздел на пустом месте.
    check("журнал незабранных не считается генерацией",
      (await media.list(dataRoot)).every((x) => typeof x.fileName === "string"),
      JSON.stringify((await media.list(dataRoot)).map((x) => x.fileName)));
    fs.writeFileSync(path.join(dataRoot, "media", "постороннее.json"), JSON.stringify({ что: "угодно" }));
    check("посторонний json в папке тоже не ломает список",
      (await media.list(dataRoot)).every((x) => typeof x.fileName === "string"));
    server.close();
    Object.assign(media.POLL_CONFIG.image, прежние);

    console.log("\nответ, готовый сразу");
    ({ server, принято, base } = await startServer({ createStatus: "completed", readyAfter: 1 }));
    // Некоторые модели отдают результат первым же ответом. Опрашивать нечего,
    // и делать лишний круг незачем.
    const сразу = await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
    });
    check("готовый сразу результат тоже сохраняется", !!сразу.localPath && fs.existsSync(сразу.localPath));
    server.close();
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    for (const d of [userData, dataRoot]) fs.rmSync(d, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
