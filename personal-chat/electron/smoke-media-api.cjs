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
        const порт = server.address().port;
        res.end(JSON.stringify(
          готово
            ? (behaviour.shape
                ? behaviour.shape(порт)
                : { id: "order-1", status: "completed", data: { url: `http://127.0.0.1:${порт}/file.png` }, usage: { cost_rub: 5.95 } })
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

    console.log("\nприложенный референс доезжает из любого поля");
    // Здесь была самая дорогая из ошибок: окно всегда шлёт список — пусть и
    // пустой, — и старое одиночное поле молча выбрасывалось. Со стороны это
    // выглядело как «модель не слушает референс»; на деле картинки в запросе
    // не было вовсе.
    {
      const фото1 = path.join(dataRoot, "р1.png");
      const фото2 = path.join(dataRoot, "р2.jpg");
      fs.writeFileSync(фото1, Buffer.from("89504e470d0a1a0a", "hex"));
      fs.writeFileSync(фото2, Buffer.from("ffd8ffe0", "hex"));

      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "image", model: "м", prompt: "п",
        referenceImagePath: фото1,
        referenceImages: [],
      });
      check("одиночный референс уезжает, даже когда список пуст",
        (принято.создание.input.images || []).length === 1,
        JSON.stringify((принято.создание.input.images || []).length));
      server.close();

      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "image", model: "м", prompt: "п",
        referenceImages: [фото1, фото2],
      });
      const кар = принято.создание.input.images || [];
      check("несколько референсов уезжают все и по порядку",
        кар.length === 2 && /image\/png/.test(кар[0].data) && /image\/jpeg/.test(кар[1].data),
        JSON.stringify(кар.length));
      server.close();

      // Один и тот же файл из обоих источников — одна картинка, не две:
      // дубль сбивает нумерацию, на которую ссылается промпт.
      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "image", model: "м", prompt: "п",
        referenceImagePath: фото1,
        referenceImages: [фото1, фото2],
      });
      check("один и тот же файл не уезжает дважды",
        (принято.создание.input.images || []).length === 2,
        JSON.stringify((принято.создание.input.images || []).length));
      server.close();

      // У моделей, которые ждут одну картинку, поле называется иначе, и
      // список они молча не замечают.
      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "image", model: "м", prompt: "п",
        referenceImages: [фото1, фото2],
        imageField: "image",
      });
      check("названное поле на одну картинку получает первую",
        typeof принято.создание.input.image === "object" && !принято.создание.input.images,
        JSON.stringify(Object.keys(принято.создание.input)));
      server.close();

      // Ключевые кадры: «оживить от одного фото к другому» — это не референс
      // стиля, а начало и конец движения, и поля у них отдельные.
      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "video", model: "м", prompt: "п",
        firstFrame: фото1, lastFrame: фото2,
      });
      check("первый и последний кадры уезжают отдельными полями",
        !!принято.создание.input.image && !!принято.создание.input.end_image,
        JSON.stringify(Object.keys(принято.создание.input)));
      check("и не смешиваются с общим списком картинок", !принято.создание.input.images);
      server.close();

      // Имена полей у ключевых кадров тоже разные у разных моделей.
      ({ server, принято, base } = await startServer({ readyAfter: 1 }));
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "k", type: "video", model: "м", prompt: "п",
        firstFrame: фото1, lastFrame: фото2,
        firstFrameField: "start_frame", lastFrameField: "last_frame",
      });
      check("имена полей ключевых кадров можно назвать своими",
        !!принято.создание.input.start_frame && !!принято.создание.input.last_frame,
        JSON.stringify(Object.keys(принято.создание.input)));
      server.close();
    }

    console.log("\nтип поля подгоняется по отказу модели");
    // У шлюза один адрес, а моделей за ним десятки: kling ждёт duration строкой,
    // другие — числом. Справочника нет, зато отказ называет и поле, и тип.
    {
      let попыток = 0;
      const сервер = http.createServer((req, res) => {
        const куски = [];
        req.on("data", (c) => куски.push(c));
        req.on("end", () => {
          if (req.method === "POST" && req.url.endsWith("/media")) {
            попыток += 1;
            const тело = JSON.parse(куски.join("") || "{}");
            if (typeof тело.input.duration !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: { message: "Поле input.duration должно быть строкой" } }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              id: "ok-1", status: "completed",
              data: { url: `http://127.0.0.1:${сервер.address().port}/f.png` },
            }));
            return;
          }
          if (req.url.includes("f.png")) {
            res.writeHead(200, { "Content-Type": "image/png" });
            res.end(Buffer.from("89504e470d0a1a0a", "hex"));
            return;
          }
          res.writeHead(404);
          res.end("{}");
        });
      });
      await new Promise((r) => сервер.listen(0, "127.0.0.1", r));
      const итог2 = await media.generate(dataRoot, {
        baseUrl: `http://127.0.0.1:${сервер.address().port}`, apiKey: "test-key",
        type: "video", model: "kling/v2.6", prompt: "п",
        params: mediakit.buildParams("video", { duration: "8" }),
      });
      check("заказ прошёл со второй попытки, с поправленным типом", !!итог2.localPath && попыток === 2, String(попыток));
      check("в описи записано то, что реально уехало", итог2.params.duration === "8", JSON.stringify(итог2.params));
      сервер.close();
    }
    // Отказ не про тип показывается как есть: выдумывать поправку не из чего.
    check("отказ не про тип не переигрывается",
      media.coerceFromError({ duration: 8 }, "Недостаточно средств") === null);
    check("и поля, которого нет, не выдумывается",
      media.coerceFromError({ fps: 24 }, "Поле input.duration должно быть строкой") === null);

    console.log("\nфайл в папке виден в истории даже без описи");
    // Опись маленькая и служебная, файл — то, ради чего всё делалось. Вешать
    // видимость файла на судьбу json неправильно: опись могут удалить при
    // уборке, файл могут принести руками из личного кабинета.
    const безОписи = fs.mkdtempSync(path.join(os.tmpdir(), "mapi-orph-"));
    fs.writeFileSync(path.join(безОписи, "картинка.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    fs.writeFileSync(path.join(безОписи, "ролик.mp4"), "x");
    fs.writeFileSync(path.join(безОписи, "звук.mp3"), "x");
    fs.writeFileSync(path.join(безОписи, "заметки.txt"), "я не генерация");
    const сироты = await media.list(dataRoot, undefined, безОписи);
    check("файлы без описи попали в историю", сироты.length === 3, JSON.stringify(сироты.map((x) => x.fileName)));
    check("и помечены как «без описи»", сироты.every((x) => x.orphan === true));
    check("тип определён по расширению",
      сироты.find((x) => x.fileName === "ролик.mp4").type === "video"
        && сироты.find((x) => x.fileName === "звук.mp3").type === "audio"
        && сироты.find((x) => x.fileName === "картинка.png").type === "image",
      JSON.stringify(сироты.map((x) => [x.fileName, x.type])));
    check("посторонний файл генерацией не считается",
      !сироты.some((x) => x.fileName === "заметки.txt"));
    check("у каждой записи есть путь к настоящему файлу",
      сироты.every((x) => fs.existsSync(x.localPath)));
    // Там, где опись есть, она и используется: промпт и модель берутся из неё,
    // а не выдумываются из имени файла.
    fs.writeFileSync(path.join(безОписи, "картинка.json"), JSON.stringify({
      id: "картинка", type: "image", model: "м", prompt: "дом у леса", fileName: "картинка.png", createdAt: 1,
    }));
    const сОписью = await media.list(dataRoot, undefined, безОписи);
    check("опись, если она есть, подписывает файл",
      сОписью.find((x) => x.fileName === "картинка.png").prompt === "дом у леса");
    check("и такой файл сиротой уже не считается",
      !сОписью.find((x) => x.fileName === "картинка.png").orphan);
    check("дважды один файл в списке не появляется",
      сОписью.filter((x) => x.fileName === "картинка.png").length === 1);

    console.log("\nсвоя папка для готовых файлов");
    // Картинки и ролики весят много: держать их внутри приложения — значит
    // раздувать именно его. Файл должен ложиться туда, куда сказано.
    const своя = fs.mkdtempSync(path.join(os.tmpdir(), "mapi-out-"));
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    const внеПриложения = await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п", outDir: своя,
    });
    check("файл лёг в свою папку, а не внутрь приложения",
      внеПриложения.localPath.startsWith(своя), внеПриложения.localPath);
    check("и история читается оттуда же",
      (await media.list(dataRoot, undefined, своя)).some((x) => x.id === внеПриложения.id));
    // Журнал незабранных остаётся в папке данных: он весит килобайты, зато
    // знает про оплаченные заказы. На внешнем диске он исчезнет вместе с
    // диском — ровно тогда, когда нужнее всего.
    check("журнал незабранных остался в папке приложения",
      fs.existsSync(path.join(dataRoot, "media", "незабранные.json")),
      fs.readdirSync(своя).join(", "));
    check("и в свою папку он не уехал", !fs.existsSync(path.join(своя, "незабранные.json")));
    server.close();

    // Проект — своя подпапка внутри выбранной, по ИМЕНИ проекта: человек ищет
    // файлы в проводнике, и «p_17583…» ему там ничего не скажет.
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    const вПроект = await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      outDir: своя, projectId: "p_123", projectName: "Болдино LIFE",
    });
    check("файлы проекта лежат в подпапке с его именем",
      вПроект.localPath.includes(path.join(своя, "Болдино LIFE")), вПроект.localPath);
    check("в имени папки нет запрещённых знаков",
      media.safeFolderName('Про/ект: "раз"') === "Про ект раз", media.safeFolderName('Про/ект: "раз"'));
    server.close();

    // Папку проверяем ДО заказа: внешний диск отключают, папку переименовывают,
    // и тогда заказ оплачен, а класть результат некуда.
    ({ server, принято, base } = await startServer({ readyAfter: 1 }));
    const занято = path.join(своя, "не-папка");
    fs.writeFileSync(занято, "я файл");
    let недоступна = "";
    try {
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п", outDir: занято,
      });
    } catch (e) {
      недоступна = e.message;
    }
    check("недоступная папка отлавливается до заказа",
      /недоступна/.test(недоступна) && /деньги не списаны/.test(недоступна), недоступна);
    check("и заказ на сервер не уходил вовсе", принято.создание === null);
    server.close();

    console.log("\nперенос накопленного");
    // Выбор папки без переноса решает задачу наполовину: новое уйдёт наружу, а
    // накопленное останется весом приложения.
    const куда = fs.mkdtempSync(path.join(os.tmpdir(), "mapi-move-"));
    const былоВнутри = (await media.list(dataRoot)).length;
    const перенос = await media.move(dataRoot, undefined, куда);
    check("перенесено всё, что лежало внутри", перенос.moved === былоВнутри, `${перенос.moved} из ${былоВнутри}`);
    check("внутри приложения не осталось генераций", (await media.list(dataRoot)).length === 0);
    check("а в своей папке они читаются", (await media.list(dataRoot, undefined, куда)).length === былоВнутри);
    check("файлы и правда лежат на диске",
      (await media.list(dataRoot, undefined, куда)).every((x) => fs.existsSync(x.localPath)));
    // Журнал переносу не подлежит: он не генерация.
    check("журнал незабранных перенос не тронул",
      fs.existsSync(path.join(dataRoot, "media", "незабранные.json")) && !fs.existsSync(path.join(куда, "незабранные.json")));
    const повтор = await media.move(dataRoot, undefined, куда);
    check("повторный перенос ничего не ломает", повтор.moved === 0, JSON.stringify(повтор));

    console.log("\nответ, готовый сразу");
    ({ server, принято, base } = await startServer({ createStatus: "completed", readyAfter: 1 }));
    // Некоторые модели отдают результат первым же ответом. Опрашивать нечего,
    // и делать лишний круг незачем.
    const сразу = await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
    });
    check("готовый сразу результат тоже сохраняется", !!сразу.localPath && fs.existsSync(сразу.localPath));
    server.close();

    // За одним адресом шлюза стоят десятки моделей разных поставщиков, и
    // отвечают они по-разному. Пока результат искали ровно в `data.url`,
    // выполненный и оплаченный заказ любой другой формы объявлялся потерянным —
    // ровно это и случилось с GPT-5 Image Mini.
    console.log("\nрезультат находится в ответе любой формы");
    const формы = {
      "список data": (порт) => ({ id: "order-1", status: "completed", data: [{ url: `http://127.0.0.1:${порт}/file.png` }] }),
      "поле output": (порт) => ({ id: "order-1", status: "completed", output: { url: `http://127.0.0.1:${порт}/file.png` } }),
      "ссылка прямо в result": (порт) => ({ id: "order-1", status: "completed", result: `http://127.0.0.1:${порт}/file.png` }),
      "вложенный список images": (порт) => ({
        id: "order-1", status: "completed",
        data: { images: [{ image_url: `http://127.0.0.1:${порт}/file.png` }] },
      }),
      "ссылка без расширения под ключом url": (порт) => ({
        id: "order-1", status: "completed", data: { url: `http://127.0.0.1:${порт}/file.png?x=1` },
      }),
    };
    for (const [имя, форма] of Object.entries(формы)) {
      ({ server, принято, base } = await startServer({ readyAfter: 1, shape: форма }));
      const r = await media.generate(dataRoot, {
        baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      });
      check(`результат найден: ${имя}`, !!r.localPath && fs.existsSync(r.localPath), r.localPath);
      check(`незабранных не осталось: ${имя}`, (await media.listPending(dataRoot)).length === 0);
      server.close();
    }

    // Часть моделей не даёт ссылки вовсе и присылает сам файл строкой. Скачивать
    // нечего — файл уже в руках, его надо просто записать.
    console.log("\nфайл приходит строкой, без ссылки");
    const пнг = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    for (const [имя, форма] of Object.entries({
      "data:-строка": () => ({ id: "order-1", status: "completed", data: { url: `data:image/png;base64,${пнг}` } }),
      "поле b64_json": () => ({ id: "order-1", status: "completed", data: [{ b64_json: пнг.repeat(40) }] }),
    })) {
      ({ server, принято, base } = await startServer({ readyAfter: 1, shape: форма }));
      const r = await media.generate(dataRoot, {
        baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      });
      check(`файл записан из строки: ${имя}`, !!r.localPath && fs.existsSync(r.localPath), r.localPath);
      check(`и он не пустой: ${имя}`, fs.statSync(r.localPath).size > 0);
      check(`скачивать при этом не ходили: ${имя}`, принято.скачиваний === 0, String(принято.скачиваний));
      server.close();
    }

    // Ссылка на документацию рядом с результатом — не результат. Если скачать
    // её, на диск ляжет страница вместо картинки.
    console.log("\nслужебные ссылки за результат не принимаются");
    ({ server, принято, base } = await startServer({
      readyAfter: 1,
      shape: (порт) => ({
        id: "order-1", status: "completed",
        docs: "https://docs.polza.ai/models",
        data: { url: `http://127.0.0.1:${порт}/file.png` },
      }),
    }));
    const сслк = await media.generate(dataRoot, {
      baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
    });
    check("взята ссылка на файл, а не на документацию", сслк.localPath.endsWith(".png"), сслк.localPath);
    server.close();

    // Если файла в ответе нет совсем — ответ не выбрасывается: он единственное,
    // по чему можно понять, как эта модель отдаёт результат.
    console.log("\nответ без файла сохраняется целиком, а заказ остаётся");
    ({ server, принято, base } = await startServer({
      readyAfter: 1,
      shape: () => ({ id: "order-нечего", status: "completed", note: "готово" }),
    }));
    let сообщение = "";
    try {
      await media.generate(dataRoot, {
        baseUrl: base, apiKey: "test-key", type: "image", model: "м", prompt: "п",
      });
    } catch (e) {
      сообщение = e.message;
    }
    check("сказано, что заказ выполнен и ничего не потеряно", /ничего не потеряно/.test(сообщение), сообщение);
    check("назван файл с ответом", /ответ-.*\.json/.test(сообщение), сообщение);
    const путьОтвета = (сообщение.match(/\S+ответ-\S+\.json/) || [""])[0].replace(/\.$/, "");
    check("и этот файл действительно лежит на диске", !!путьОтвета && fs.existsSync(путьОтвета), путьОтвета);
    check("заказ остался в незабранных", (await media.listPending(dataRoot)).some((x) => x.id === "order-1"));
    check("сохранённый ответ не попал в историю как генерация",
      (await media.list(dataRoot)).every((x) => typeof x.fileName === "string"));
    server.close();
    await media.dropPending(dataRoot, "order-1");
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message, e && e.stack ? "\n" + e.stack.slice(0, 400) : "");
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    for (const d of [userData, dataRoot]) fs.rmSync(d, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
