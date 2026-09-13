// Видеотека: папка с записями, расшифровка, поиск и ответ строго по источникам.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-library.cjs
//
// Главное, что здесь проверяется, — что ответ НЕЛЬЗЯ придумать незаметно.
// Модель видит только найденные куски расшифровок; каждое утверждение обязано
// нести ссылку на файл и минуту; ссылки сверяются с самими расшифровками.
// Гарантии это не даёт — её даёт проверка человеком по ссылке, — но делает
// выдумку видимой, а это то, ради чего раздел вообще существует.
//
// Настоящей модели распознавания речи здесь нет: она весит полтора гигабайта и
// в тест не влезает. Поэтому расшифровка подменяется на уровне её вывода —
// формата srt, — а всё, что после него (куски, индекс, поиск, задание модели,
// проверка ссылок), работает по-настоящему.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "lib-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lib-data-"));
const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lib-media-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({
    baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", model: "m",
    temperature: 0.7, maxTokens: 4000, proxyMode: "direct", searchEnabled: false,
  })
);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const library = require("./library.cjs");
const speech = require("./speech.cjs");
const ffmpeg = require("ffmpeg-static");
const { finish } = require("./finish.cjs");

function makeMedia(dest, seconds, withVideo) {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (withVideo) args.push("-f", "lavfi", "-i", `testsrc=size=320x240:rate=10:duration=${seconds}`);
  args.push("-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`);
  if (withVideo) args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  args.push("-c:a", "aac", "-shortest", dest);
  execFileSync(ffmpeg, args);
  return dest;
}

/** Значение и правда булево, а не «что-то, что похоже на да». */
function типБулев(v) {
  return v === true || v === false;
}

function cleanup() {
  for (const dir of [userData, dataRoot, mediaRoot]) fs.rmSync(dir, { recursive: true, force: true });
}

app.whenReady().then(async () => {
  try {
    console.log("что лежит в папке");
    fs.mkdirSync(path.join(mediaRoot, "март"), { recursive: true });
    makeMedia(path.join(mediaRoot, "Планёрка.mp4"), 3, true);
    makeMedia(path.join(mediaRoot, "март", "Интервью.m4a"), 2, false);
    fs.writeFileSync(path.join(mediaRoot, "заметки.txt"), "не медиа");
    const found = await library.scanFolder(mediaRoot);
    check("записи найдены, включая вложенную папку", found.length === 2, JSON.stringify(found.map((f) => f.name)));
    check("не-медиа пропущено", !found.some((f) => f.name.endsWith(".txt")));
    check("видео и аудио различаются",
      found.some((f) => f.kind === "видео") && found.some((f) => f.kind === "аудио"));

    console.log("\nзвук из записи");
    // Временный файл кладём ВНЕ папки с записями: иначе он сам попадёт в опись.
    const wav = path.join(userData, "проба.wav");
    const t0 = Date.now();
    await library.extractAudio(ffmpeg, path.join(mediaRoot, "Планёрка.mp4"), wav);
    check("звук извлечён", fs.existsSync(wav) && fs.statSync(wav).size > 1000, String(fs.statSync(wav).size));
    check("и это быстро", Date.now() - t0 < 5000, `${Date.now() - t0} мс`);
    check("оригинал не тронут", fs.existsSync(path.join(mediaRoot, "Планёрка.mp4")));
    const seconds = await library.probeDuration(ffmpeg, path.join(mediaRoot, "Планёрка.mp4"));
    check("длительность прочитана", seconds >= 2 && seconds <= 4, String(seconds));

    console.log("\nразбор расшифровки и куски");
    const srt = [];
    for (let i = 0; i < 24; i++) {
      const from = i * 5;
      const two = (n) => String(n).padStart(2, "0");
      srt.push(
        `${i + 1}\n00:${two(Math.floor(from / 60))}:${two(from % 60)},000 --> ` +
          `00:${two(Math.floor((from + 5) / 60))}:${two((from + 5) % 60)},000\nфраза номер ${i}\n`
      );
    }
    const segments = library.parseSrt(srt.join("\n"));
    check("отрезки разобраны со временем", segments.length === 24 && segments[3].from === 15,
      JSON.stringify(segments[3]));
    const chunks = library.buildChunks(segments);
    check("куски собраны", chunks.length >= 2, String(chunks.length));
    check("кусок примерно на 45 секунд", chunks[0].to - chunks[0].from <= 50, `${chunks[0].from}–${chunks[0].to}`);
    // Фраза на стыке кусков не должна пропасть: без перехлёста именно она и
    // теряется, а найти её потом нельзя ничем.
    const seam = segments.find((s2) => s2.from > chunks[0].to - 8 && s2.from < chunks[0].to);
    check("фраза со стыка попала в оба куска",
      !!seam && chunks[0].text.includes(seam.text) && chunks[1].text.includes(seam.text),
      seam && seam.text);

    console.log("\nприведение слов к основе");
    const groups = [
      ["бюджет", "бюджеты", "бюджетами", "бюджету", "бюджетов"],
      ["кампания", "кампании", "кампаниями"],
      ["клиент", "клиенты", "клиентов", "клиентам"],
      ["новость", "новости", "новостями"],
    ];
    for (const g of groups) {
      const stems = [...new Set(g.map(library.stem))];
      check(`все формы «${g[0]}» дают одну основу`, stems.length === 1, stems.join(" / "));
    }

    console.log("\nпоиск по расшифровкам");
    const docs = [
      {
        path: path.join(mediaRoot, "Планёрка.mp4"), name: "Планёрка 12.03",
        chunks: [
          { from: 0, to: 45, text: "Обсуждали бюджеты клиентов и ставки на рекламу во ВКонтакте" },
          { from: 45, to: 90, text: "Говорили про найм дизайнера в команду и сроки по макетам" },
          { from: 90, to: 135, text: "Решили не запускать кампанию с большим бюджетом до сентября" },
        ],
      },
      {
        path: path.join(mediaRoot, "март", "Интервью.m4a"), name: "Интервью с подрядчиком",
        chunks: [{ from: 0, to: 45, text: "Считаем стоимость привлечения клиента в digital" }],
      },
    ];
    const index = library.buildIndex(docs);
    const found1 = library.search(index, "бюджет");
    check("слово находится в другой форме", found1.length >= 2, JSON.stringify(found1.map((h) => h.from)));
    check("самое подходящее — первым", found1[0].text.includes("бюджет"), found1[0].text);
    check("поиск идёт по всем записям",
      library.search(index, "стоимость клиента").some((h) => h.name === "Интервью с подрядчиком"));
    check("чего в записях нет — не находится", library.search(index, "вертолёт").length === 0);

    console.log("\nответ строго по источникам");
    const hits = library.search(index, "что решили по бюджетам");
    const prompt = library.buildAnswerPrompt({ question: "Что решили по бюджетам?", hits });
    check("в задании есть сами расшифровки", prompt.includes("Решили не запускать кампанию"));
    check("утверждение без ссылки запрещено", prompt.includes("Утверждение без ссылки недопустимо"));
    check("на нет ответа положено сказать «нет»", prompt.includes("в записях этого нет"));
    check("запрещено достраивать из общих знаний", prompt.includes("Не"));
    check("источники пронумерованы", prompt.includes("[1]") && prompt.includes("[2]"));
    check("у каждого источника есть время", /\d+:\d\d–\d+:\d\d/.test(prompt), prompt.slice(0, 200));

    console.log("\nпроверка ссылок в ответе");
    const honest = library.verifyCitations("Решили не запускать кампанию с большим бюджетом до сентября [1].", hits);
    check("честный ответ нареканий не вызывает", honest.problems.length === 0 && honest.unsupported === 0,
      JSON.stringify(honest));
    const invented = library.verifyCitations("Решили удвоить бюджет на декабрь [9].", hits);
    check("ссылка на несуществующий источник поймана",
      invented.problems.some((p) => /которого нет/.test(p)), JSON.stringify(invented.problems));
    const mismatched = library.verifyCitations(
      "Компания открыла филиал в Казани и наняла тридцать новых сотрудников этой весной [1].", hits);
    check("ссылка не по делу поймана",
      mismatched.problems.some((p) => /слабо связана/.test(p)), JSON.stringify(mismatched.problems));
    const bare = library.verifyCitations(
      "Они решили полностью поменять стратегию продвижения на следующий год без обсуждения.", hits);
    check("утверждение без ссылки посчитано", bare.unsupported === 1, String(bare.unsupported));

    console.log("\nхранение: остаётся только текст");
    await library.writeDoc(dataRoot, {
      path: path.join(mediaRoot, "Планёрка.mp4"), name: "Планёрка.mp4",
      seconds: 135, chunks: docs[0].chunks, segments,
    });
    const stored = await library.readDoc(dataRoot, path.join(mediaRoot, "Планёрка.mp4"));
    check("расшифровка сохранена и читается", !!stored && stored.chunks.length === 3);
    const libSize = fs.readdirSync(path.join(dataRoot, "library"))
      .reduce((s2, n) => s2 + fs.statSync(path.join(dataRoot, "library", n)).size, 0);
    check("копий видео в данных приложения нет",
      !fs.readdirSync(path.join(dataRoot, "library")).some((n) => /\.(mp4|m4a|wav)$/i.test(n)),
      fs.readdirSync(path.join(dataRoot, "library")).join(", "));
    check("текст занимает считанные килобайты", libSize < 200000, `${Math.round(libSize / 1024)} КБ`);
    await library.removeDoc(dataRoot, path.join(mediaRoot, "Планёрка.mp4"));
    check("забыть запись можно", (await library.listDocs(dataRoot)).length === 0);

    console.log("\nлокальный движок не подменяется молча");
    const noEngine = library.localEngineStatus({ binPath: "", modelPath: "" });
    check("без программы честно сказано, чего не хватает",
      !noEngine.ready && /whisper/.test(noEngine.reason), noEngine.reason);
    const noModel = library.localEngineStatus({ binPath: __filename, modelPath: "" });
    check("без модели тоже", !noModel.ready && /модел/i.test(noModel.reason), noModel.reason);
    check("с обоими файлами — готов",
      library.localEngineStatus({ binPath: __filename, modelPath: __filename }).ready);

    console.log("\nчто видно в папке: пустой список должен быть объясним");
    // Жалоба была ровно такая: «при выборе папки не видит, есть ли там аудио
    // или видео файлы». Проверяем не только находки, но и объяснение находок.
    const широкая = path.join(mediaRoot, "широкая");
    fs.mkdirSync(широкая, { recursive: true });
    makeMedia(path.join(широкая, "Камера.mts"), 1, true);
    makeMedia(path.join(широкая, "Диктофон.m4b"), 1, false);
    fs.writeFileSync(path.join(широкая, "смета.pdf"), "не медиа");
    fs.writeFileSync(path.join(широкая, "письмо.txt"), "не медиа");
    fs.writeFileSync(path.join(широкая, "второе.txt"), "не медиа");
    const обзор = await library.scanSources([широкая]);
    check("запись с камеры (.mts) видна", обзор.files.some((f) => f.name === "Камера.mts"),
      JSON.stringify(обзор.files.map((f) => f.name)));
    check("диктофонная запись (.m4b) видна", обзор.files.some((f) => f.name === "Диктофон.m4b"));
    check("просмотренные файлы посчитаны", обзор.seen === 5, String(обзор.seen));
    check("пропущенное названо поимённо",
      обзор.other.find((o) => o.ext === ".txt")?.count === 2 &&
        обзор.other.some((o) => o.ext === ".pdf"), JSON.stringify(обзор.other));

    const пусто = fs.mkdtempSync(path.join(os.tmpdir(), "lib-пусто-"));
    fs.writeFileSync(path.join(пусто, "а.docx"), "текст");
    const обзорПустой = await library.scanSources([пусто]);
    check("в папке без записей список пуст, но обход состоялся",
      обзорПустой.files.length === 0 && обзорПустой.seen === 1, JSON.stringify(обзорПустой));

    console.log("\nисточники: и папка, и отдельная запись");
    const смешанный = await library.scanSources([
      широкая,
      path.join(mediaRoot, "Планёрка.mp4"),
      path.join(mediaRoot, "нет-такого.mp4"),
      path.join(широкая, "смета.pdf"),
    ]);
    check("отдельная запись добавилась к папке",
      смешанный.files.some((f) => f.name === "Планёрка.mp4") && смешанный.files.length === 3,
      JSON.stringify(смешанный.files.map((f) => f.name)));
    check("несуществующий источник назван", смешанный.missing.includes(path.join(mediaRoot, "нет-такого.mp4")));
    check("выбранный файл не того вида назван прямо, а не молча пропущен",
      смешанный.missing.includes(path.join(широкая, "смета.pdf")), JSON.stringify(смешанный.missing));
    const дважды = await library.scanSources([широкая, широкая]);
    check("один источник дважды не удваивает записи", дважды.files.length === 2, String(дважды.files.length));

    console.log("\nотпечаток: запись узнаётся по содержимому, а не по имени");
    const отпечаток = await library.fingerprint(path.join(mediaRoot, "Планёрка.mp4"));
    const переименованная = path.join(mediaRoot, "Планёрка (копия).mp4");
    fs.copyFileSync(path.join(mediaRoot, "Планёрка.mp4"), переименованная);
    check("переименование не меняет отпечаток",
      (await library.fingerprint(переименованная)) === отпечаток, отпечаток);
    check("другая запись — другой отпечаток",
      (await library.fingerprint(path.join(mediaRoot, "март", "Интервью.m4a"))) !== отпечаток);
    fs.rmSync(переименованная);

    console.log("\nрасшифровки лежат там, где указано");
    const хранилище = fs.mkdtempSync(path.join(os.tmpdir(), "lib-хран-"));
    const где = { root: dataRoot, vaultPath: хранилище };
    check("папка сохранения — та, что выбрана",
      library.libraryDir(где) === path.join(хранилище, "Расшифровки"), library.libraryDir(где));
    await library.writeDoc(где, {
      path: path.join(mediaRoot, "Планёрка.mp4"), name: "Планёрка.mp4", fingerprint: отпечаток,
      seconds: 135, chunks: docs[0].chunks, segments,
      engine: "local", transcribedAt: Date.now(),
    });
    check("расшифровка легла в выбранную папку",
      fs.existsSync(path.join(хранилище, "Расшифровки")) &&
        fs.readdirSync(path.join(хранилище, "Расшифровки")).some((n) => n.startsWith("зв-")),
      fs.readdirSync(path.join(хранилище, "Расшифровки")).join(", "));
    check("в данных приложения её при этом нет",
      !fs.existsSync(path.join(dataRoot, "library")) ||
        !fs.readdirSync(path.join(dataRoot, "library")).some((n) => n.startsWith("зв-")));

    const поПути = await library.findDoc(где, { path: path.join(mediaRoot, "Планёрка.mp4") });
    check("находится по пути", !!поПути && поПути.chunks.length === docs[0].chunks.length);
    const послеПереезда = await library.findDoc(где, {
      path: "D:\\\\другой\\\\диск\\\\Планёрка от 3 марта.mp4", fingerprint: отпечаток,
    });
    check("находится и после переименования с переездом — читать заново не надо",
      !!послеПереезда && послеПереезда.chunks.length === docs[0].chunks.length,
      String(!!послеПереезда));
    check("чужой отпечаток ничего не находит",
      (await library.findDoc(где, { path: "нет", fingerprint: "0".repeat(24) })) === null);

    fs.rmSync(path.join(хранилище, "Расшифровки", library.INDEX_FILE));
    const собранная = await library.readIndex(где);
    check("опись собирается заново, если её потерять",
      собранная.записи.length === 1 && собранная.записи[0].fingerprint === отпечаток,
      JSON.stringify(собранная.записи.map((e) => e.name)));
    check("опись не попадает в список расшифровок",
      (await library.listDocs(где)).length === 1, String((await library.listDocs(где)).length));

    console.log("\nвстроенное распознавание: подготовка звука");
    // Настоящую модель здесь не гоняем: веса весят десятки мегабайт и качаются
    // из сети. Зато всё, что вокруг неё, — разбор wav, нарезка на окна, сборка
    // отрезков — работает по-настоящему, и ломается обычно именно оно.
    const звук = path.join(userData, "речь.wav");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "sine=frequency=440:duration=3", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", звук]);
    const сведения = speech.wavInfo(fs.readFileSync(звук));
    check("wav от ffmpeg разобран", сведения.rate === 16000 && сведения.totalSamples === 48000,
      JSON.stringify(сведения));

    // Разбор проверяется на известных отсчётах, а не «похоже на правду».
    const отсчёты = [0, 16384, -16384, 32767, -32768];
    const данные = Buffer.alloc(отсчёты.length * 2);
    отсчёты.forEach((v, i) => данные.writeInt16LE(v, i * 2));
    const шапка = Buffer.alloc(44);
    шапка.write("RIFF", 0); шапка.writeUInt32LE(36 + данные.length, 4); шапка.write("WAVE", 8);
    шапка.write("fmt ", 12); шапка.writeUInt32LE(16, 16); шапка.writeUInt16LE(1, 20);
    шапка.writeUInt16LE(1, 22); шапка.writeUInt32LE(16000, 24); шапка.writeUInt32LE(32000, 28);
    шапка.writeUInt16LE(2, 32); шапка.writeUInt16LE(16, 34);
    шапка.write("data", 36); шапка.writeUInt32LE(данные.length, 40);
    const точный = speech.wavToFloat32(Buffer.concat([шапка, данные])).audio;
    check("отсчёты переводятся точно, без потери знака и края",
      отсчёты.every((v, i) => Math.abs(точный[i] - v / 32768) < 1e-9),
      Array.from(точный).join(", "));

    // ffmpeg кладёт перед данными служебный кусок LIST. Отсчёт «44 байта от
    // начала» съедал бы вместе с ним первые слова записи.
    const служебный = Buffer.alloc(8 + 26);
    служебный.write("LIST", 0); служебный.writeUInt32LE(26, 4); служебный.write("INFOISFT", 8);
    const размер = Buffer.alloc(4); размер.writeUInt32LE(данные.length, 0);
    const сЛишним = Buffer.concat([шапка.subarray(0, 36), служебный, Buffer.from("data"), размер, данные]);
    check("служебный кусок перед звуком не сбивает разбор",
      speech.wavToFloat32(сЛишним).audio.length === отсчёты.length &&
        Math.abs(speech.wavToFloat32(сЛишним).audio[3] - 32767 / 32768) < 1e-9);
    let неWav = "";
    try { speech.wavToFloat32(Buffer.from("это не звук вовсе")); } catch (e) { неWav = e.message; }
    check("чужой файл назван прямо, а не разобран в тишину", /не wav/i.test(неWav), неWav);

    console.log("\nдлинная запись режется на окна");
    // Шесть часов речи в виде дробных чисел — это больше гигабайта в памяти:
    // попытка взять запись целиком кончается не ошибкой, а падением.
    const шестьЧасов = speech.planWindows(6 * 3600 * 16000, 16000);
    check("шестичасовая запись разбита", шестьЧасов.length > 30, String(шестьЧасов.length));
    check("окна идут подряд и покрывают всю запись",
      шестьЧасов[0].from === 0 &&
        шестьЧасов[шестьЧасов.length - 1].from + шестьЧасов[шестьЧасов.length - 1].count === 6 * 3600 * 16000);
    const сПерехлёстом = speech.planWindows(1000, 100, { windowSeconds: 4, overlapSeconds: 1 });
    check("окна перекрываются — иначе фраза со стыка пропадёт",
      сПерехлёстом[1].from < сПерехлёстом[0].from + сПерехлёстом[0].count,
      JSON.stringify(сПерехлёстом));
    check("короткая запись — одно окно", speech.planWindows(16000, 16000).length === 1);

    console.log("\nответ модели превращается в отрезки");
    const отрезки = speech.toSegments(
      { chunks: [
        { timestamp: [0, 2.5], text: " Первая фраза." },
        { timestamp: [2.5, null], text: " Вторая, упёрлась в край окна." },
        { timestamp: [5, 6], text: "   " },
      ] },
      { offsetSeconds: 600, windowSeconds: 30 }
    );
    check("время сдвинуто на начало окна", отрезки[0].from === 600 && отрезки[0].to === 602.5,
      JSON.stringify(отрезки[0]));
    // Незакрытое время — признак того, что кусок упёрся в край окна, а не брак:
    // выбрасывать его значило бы терять целую фразу.
    check("незакрытое время закрывается концом окна",
      отрезки[1].to === 630 && отрезки[1].text.startsWith("Вторая"), JSON.stringify(отрезки[1]));
    check("пустой кусок отброшен", отрезки.length === 2, String(отрезки.length));
    check("ответ без времени всё равно не теряется",
      speech.toSegments({ text: "речь без разметки" }, { offsetSeconds: 5 })[0].text === "речь без разметки");

    const склеено = speech.mergeSegments([
      { from: 0, to: 3, text: "раз" },
      { from: 600, to: 602, text: "на стыке" },
      { from: 600.4, to: 603, text: "на стыке" },
      { from: 610, to: 612, text: "два" },
    ]);
    check("фраза из перехлёста не попадает дважды", склеено.length === 3, JSON.stringify(склеено));
    check("и берёт больший конец из двух", склеено[1].to === 603, JSON.stringify(склеено[1]));
    check("разные фразы в одно время не склеиваются",
      speech.mergeSegments([{ from: 0, to: 1, text: "а" }, { from: 0.2, to: 1, text: "б" }]).length === 2);

    console.log("\nмодели распознавания");
    check("есть из чего выбрать", speech.SPEECH_MODELS.length >= 3);
    check("у каждой сказан размер и чем она хуже соседней",
      speech.SPEECH_MODELS.every((m) => m.size && m.hint && m.name));
    check("по умолчанию — не самая грубая",
      speech.DEFAULT_MODEL !== speech.SPEECH_MODELS[0].id, speech.DEFAULT_MODEL);
    const хранилищеВесов = fs.mkdtempSync(path.join(os.tmpdir(), "веса-"));
    check("без скачанных весов готовности нет", !speech.isModelReady(хранилищеВесов, speech.DEFAULT_MODEL));
    fs.mkdirSync(path.join(хранилищеВесов, ...speech.DEFAULT_MODEL.split("/")), { recursive: true });
    check("пустая папка после сорвавшегося скачивания — тоже не готовность",
      !speech.isModelReady(хранилищеВесов, speech.DEFAULT_MODEL));
    fs.writeFileSync(path.join(хранилищеВесов, ...speech.DEFAULT_MODEL.split("/"), "model.onnx"), "x".repeat(1000));
    check("с файлами — готова", speech.isModelReady(хранилищеВесов, speech.DEFAULT_MODEL));
    check("занятое место считается",
      speech.cacheSize(хранилищеВесов) === 1000, String(speech.cacheSize(хранилищеВесов)));
    fs.rmSync(хранилищеВесов, { recursive: true, force: true });

    console.log("\nнастройки — не расшифровка");
    // config.json лежит в той же папке. Без этого он попадал в опись наравне с
    // записями, и получалось «Расшифровано: 0» и тут же «Расшифровок без
    // записи: 1».
    const сНастройками = { root: fs.mkdtempSync(path.join(os.tmpdir(), "опись-")), vaultPath: "" };
    const папка = library.libraryDir(сНастройками);
    fs.mkdirSync(папка, { recursive: true });
    fs.writeFileSync(path.join(папка, "config.json"), JSON.stringify({ engine: "builtin", folderPath: "" }));
    check("настройки не считаются расшифровкой",
      (await library.listDocs(сНастройками)).length === 0);
    check("и не попадают в опись",
      (await library.rebuildIndex(сНастройками)).записи.length === 0);
    fs.writeFileSync(path.join(папка, "чужое.json"), JSON.stringify({ что: "угодно" }));
    check("посторонний json тоже не считается расшифровкой",
      (await library.listDocs(сНастройками)).length === 0);
    fs.rmSync(сНастройками.root, { recursive: true, force: true });

    console.log("\nвторая модель: правка текста и метки");
    // Часовая запись — это около пятидесяти тысяч знаков; целиком такое в модель
    // не отправить. Здесь предел занижен нарочно, чтобы резка была видна.
    const порции = library.polishPieces({ chunks: docs[0].chunks }, { maxChars: 100 });
    check("длинная расшифровка режется на порции", порции.length === 3, String(порции.length));
    check("порции идут по порядку и не рвут кусков",
      порции.every((p2, i) => p2.chunks.length > 0 && (i === 0 || p2.from >= порции[i - 1].from)));
    check("порция не длиннее предела, если в неё влезает больше одного куска",
      порции.every((p2) => p2.chunks.length === 1 || p2.chars <= 100), JSON.stringify(порции.map((p2) => p2.chars)));
    check("ни один кусок не потерян при резке",
      порции.reduce((n, p2) => n + p2.chunks.length, 0) === docs[0].chunks.length);
    check("короткая расшифровка остаётся одной порцией",
      library.polishPieces({ chunks: docs[0].chunks }).length === 1);
    const задание = library.buildPolishPrompt(порции[0], { name: "Планёрка.mp4", part: 1, parts: 2 });
    check("в задании сказано не добавлять от себя", /НИЧЕГО НЕ ДОБАВЛЯТЬ/.test(задание));
    check("в задании есть сама расшифровка со временем", задание.includes(docs[0].chunks[0].text.slice(0, 30)));
    check("в задании указана часть", /часть 1 из 2/.test(задание));

    const ответМодели = [
      "Конечно, вот результат.",
      "=== МЕТКИ ===",
      "0:00–0:40 | Смета на посёлок | смета, бюджет",
      "- 0:40-1:10 | Спор про сроки | сроки, задержка",
      "50:00–51:00 | Выдуманная тема | чушь",
      "совсем кривая | строка",
      "=== ТЕКСТ ===",
      "[0:00] Начали со сметы по посёлку.",
      "и это продолжение той же мысли",
      "[0:40] Потом заспорили о сроках.",
      "[44:00] Реплика из несуществующей минуты.",
    ].join("\n");
    const разбор = library.parsePolish(ответМодели, { from: 0, to: 120 });
    check("метки разобраны", разбор.marks.length === 2, JSON.stringify(разбор.marks));
    check("нулевая минута не съедена при снятии маркера списка",
      разбор.marks[0].from === 0 && разбор.marks[0].title === "Смета на посёлок",
      JSON.stringify(разбор.marks[0]));
    check("маркер списка снят, а время сохранено",
      разбор.marks[1].from === 40 && разбор.marks[1].to === 70, JSON.stringify(разбор.marks[1]));
    check("слова для поиска сохранены", разбор.marks[0].keywords.includes("бюджет"));
    check("выдуманное время выброшено и посчитано", разбор.droppedMarks === 2, String(разбор.droppedMarks));
    check("правленый текст разобран", разбор.clean.length === 2, JSON.stringify(разбор.clean));
    check("строка без времени приклеена к предыдущей, а не потеряна",
      разбор.clean[0].text.includes("продолжение той же мысли"), разбор.clean[0].text);
    check("реплика из несуществующей минуты выброшена", разбор.droppedLines === 1, String(разбор.droppedLines));

    const сшито = library.mergePolish([
      { marks: [{ from: 0, to: 60, title: "Смета", keywords: ["смета"] }], clean: [{ from: 0, text: "раз" }] },
      { marks: [{ from: 50, to: 90, title: "смета", keywords: ["бюджет"] }], clean: [{ from: 60, text: "два" }] },
      { marks: [{ from: 90, to: 120, title: "Сроки", keywords: [] }], clean: [] },
    ]);
    check("одна тема на стыке порций не раздваивается",
      сшито.marks.length === 2 && сшито.marks[0].to === 90, JSON.stringify(сшито.marks));
    check("слова для поиска с обеих половин сохранены",
      сшито.marks[0].keywords.includes("смета") && сшито.marks[0].keywords.includes("бюджет"));
    check("текст сшит по порядку", сшито.clean.map((c) => c.text).join(",") === "раз,два");

    console.log("\nпоиск в два шага: сначала тема, потом строки внутри неё");
    // Слова «решили» и «сроки» рассыпаны по всей записи, потому что люди так
    // говорят. Прямой поиск честно находит нужный кусок первым, но тащит за ним
    // обрывки из совсем других тем — и модель обязана их прочитать и может на
    // них сослаться. Метка описывает кусок целиком, поэтому лишнее не попадает
    // в ответ вовсе.
    const сМетками = [
      {
        path: "/з/совещание.mp4", name: "совещание.mp4",
        chunks: [
          { from: 0, to: 40, text: "решили решили по срокам ещё раз решили уточнить сроки у поставщика бруса" },
          { from: 40, to: 80, text: "сроки согласования с администрацией посёлка, решили ждать" },
          { from: 80, to: 120, text: "сдачу дома переносим на май, подрядчик не успевает с кровлей" },
          { from: 120, to: 160, text: "решили по срокам отпусков в бухгалтерии, сроки решили не менять" },
        ],
        marks: [
          { from: 0, to: 80, title: "Поставка бруса и согласования", keywords: ["брус", "поставщик", "согласование"] },
          { from: 80, to: 120, title: "Перенос сдачи дома", keywords: ["сдача", "дом", "перенос", "май"] },
          { from: 120, to: 160, title: "Отпуска в бухгалтерии", keywords: ["отпуск", "бухгалтерия"] },
        ],
      },
    ];
    const указатель = library.buildIndex(сМетками);
    check("метки попали в указатель", указатель.markTotal === 3, String(указатель.markTotal));

    const вопрос = "что решили по сдаче дома";
    const прямо = library.search(указатель, вопрос, 3);
    check("прямой поиск тащит обрывки из чужих тем",
      прямо.length > 1 && прямо.some((h) => h.from !== 80), JSON.stringify(прямо.map((h) => h.from)));

    const путь = library.navigate(указатель, вопрос, { limit: 3 });
    check("поиск сузился до найденной темы", путь.narrowed === true, JSON.stringify(путь.marks.map((m) => m.title)));
    check("найдена именно нужная тема",
      путь.marks[0].title === "Перенос сдачи дома", JSON.stringify(путь.marks.map((m) => m.title)));
    check("в ответ ушло только то, что внутри темы",
      путь.hits.length === 1 && путь.hits[0].from === 80, JSON.stringify(путь.hits.map((h) => h.from)));

    const безМеток = library.buildIndex([{ ...сМетками[0], marks: [] }]);
    check("без меток раздел не перестаёт работать",
      library.navigate(безМеток, вопрос, { limit: 5 }).hits.length > 0);
    check("вопрос мимо всех тем не оставляет человека без ответа",
      library.navigate(указатель, "кровля", { limit: 5 }).hits.length > 0);

    console.log("\nкарта тем в задании модели — не источник");
    const сКартой = library.buildAnswerPrompt({
      question: "когда сдача",
      hits: [{ name: "совещание.mp4", from: 80, to: 120, text: "перенесли на май" }],
      marks: [{ name: "совещание.mp4", from: 80, to: 120, title: "Решение о переносе сдачи" }],
    });
    check("карта тем показана", /ГДЕ ИСКАТЬ/.test(сКартой) && сКартой.includes("Решение о переносе сдачи"));
    check("и прямо сказано, что ссылаться на неё нельзя", /ссылаться на неё нельзя/.test(сКартой));
    check("без меток карты нет",
      !/ГДЕ ИСКАТЬ/.test(library.buildAnswerPrompt({ question: "q", hits: [] })));

    console.log("\nчитаемый вид");
    check("пока разбора нет — показывается сырая расшифровка",
      library.cleanText({ chunks: [{ from: 0, text: "сырое" }] }).includes("сырое"));
    check("после разбора — правленый текст",
      library.cleanText({ chunks: [{ from: 0, text: "сырое" }], clean: [{ from: 0, text: "правленое" }] })
        === "[0:00] правленое");

    fs.rmSync(пусто, { recursive: true, force: true });
    fs.rmSync(хранилище, { recursive: true, force: true });

    console.log("\nраздел в приложении");
    require("./main.cjs");
    let win;
    const deadline = Date.now() + 25000;
    while (!win && Date.now() < deadline) {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
      if (!win) await new Promise((r) => setTimeout(r, 120));
    }
    check("окно приложения открылось", !!win);
    if (win) {
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      const call = (e) => win.webContents.executeJavaScript(e);
      await new Promise((r) => setTimeout(r, 1200));
      check("«Видеотека» есть в меню",
        (await call(`[...document.querySelectorAll(".sidebar-item")].some(n => n.textContent.includes("Видеотека"))`)) === true);
      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Видеотека")).click()`);
      await new Promise((r) => setTimeout(r, 700));
      check("раздел открывается", (await call(`!!document.querySelector(".lib-files, .vs-form")`)) === true);
      check("сказано, что файлы не копируются",
        (await call(`document.body.textContent.includes("никуда не копируются")`)) === true);
      check("выбор движка на месте",
        (await call(`[...document.querySelectorAll(".vs-tab")].map(b => b.textContent).join("|")`))
          .includes("Встроенное"));
      // По умолчанию — встроенное распознавание: материал не уезжает на чужой
      // сервер, пока человек этого не выбрал сам, и ставить при этом нечего.
      const cfg = await call(`window.api.libraryConfig()`);
      check("по умолчанию расшифровка идёт на этом компьютере", cfg.engine === "builtin", cfg.engine);
      const движок = await call(`window.api.libraryEngineStatus()`);
      check("встроенный путь знает, скачаны ли веса", типБулев(движок.builtinReady), String(движок.builtinReady));
      check("и предлагает выбрать модель", (движок.models || []).length >= 3, JSON.stringify(движок.models));
      // Без скачанных весов слушать нечем — и сказано это должно быть
      // по-человечески, а не сетевой ошибкой вида net::ERR_...
      const безВесов = await call(`window.api.libraryTranscribe(${JSON.stringify([path.join(mediaRoot, "Планёрка.mp4")])})`);
      check("без скачанных весов сказано, что нажать, а не показана сетевая ошибка",
        безВесов.failed.length === 1 && /Скачать модель/.test(безВесов.failed[0].error),
        JSON.stringify(безВесов.failed));
      // Настройка, сделанная до появления нескольких источников, не должна
      // пропасть: одна папка превращается в один источник.
      await call(`window.api.librarySaveConfig(${JSON.stringify({ folderPath: mediaRoot })})`);
      const перенесено = await call(`window.api.libraryConfig()`);
      check("старая настройка с одной папкой подхвачена",
        перенесено.sources.length === 1 && перенесено.sources[0] === mediaRoot,
        JSON.stringify(перенесено.sources));
      const scan = await call(`window.api.libraryScan()`);
      check("папка прочитана из приложения", scan.files.length === 4, JSON.stringify(scan.files.map((f) => f.name)));
      check("ничего ещё не расшифровано", scan.files.every((f) => !f.transcribed));
      check("видно, сколько файлов просмотрено", scan.seen === 8, String(scan.seen));
      check("видно, что пропущено", (scan.other || []).some((o) => o.ext === ".txt"), JSON.stringify(scan.other));
      check("сказано, где лежат расшифровки", typeof scan.vault === "string" && scan.vault.length > 0, scan.vault);

      // Приложение не должно молча уходить на платный путь, если выбран
      // whisper.cpp, а его нет.
      await call(`window.api.librarySaveConfig({ engine: "local" })`);
      const отказ = await call(`window.api.libraryTranscribe(${JSON.stringify([path.join(mediaRoot, "Планёрка.mp4")])})`);
      check("без локального движка расшифровка отказывает, а не уезжает в сеть",
        отказ.failed.length === 1 && /whisper|модел/i.test(отказ.failed[0].error),
        JSON.stringify(отказ.failed));
      const отказДвоих = await call(`window.api.libraryTranscribe(${JSON.stringify([
        path.join(mediaRoot, "Планёрка.mp4"), path.join(mediaRoot, "март", "Интервью.m4a"),
      ])})`);
      check("нехватка расшифровщика останавливает очередь, а не молотит отказы",
        отказДвоих.failed.length === 1, JSON.stringify(отказДвоих.failed.map((f) => f.error)));

      await call(`window.api.librarySaveConfig({ engine: "builtin" })`);

      console.log("\nголос");
      // Надиктованная реплика слушается тем же встроенным распознаванием, что и
      // записи: ставить ничего не надо и запись никуда не уходит.
      const безМодели = await call(`window.api.transcribeVoice(new Uint8Array([1,2,3]))
        .then(() => "", e => e.message)`);
      check("без скачанной модели голос говорит, что нажать",
        /Скачать модель/.test(безМодели) && /голоса/.test(безМодели), безМодели);
      // Микрофон без разрешения молча не работает — Chromium отказывает без
      // объяснений, и кнопка выглядит сломанной.
      check("микрофон приложению разрешён",
        (await call(`window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)`)) === true);
      check("запись голоса браузером поддерживается",
        (await call(`typeof MediaRecorder !== "undefined" &&
          ["audio/webm;codecs=opus","audio/webm","audio/mp4"].some(t => MediaRecorder.isTypeSupported(t))`)) === true);
      // Читать вслух умеет система. Голосов в этой среде нет — это нормально и
      // проверяется отдельно: приложение обязано сказать об этом, а не молчать.
      check("синтез речи в окне есть",
        (await call(`typeof window.speechSynthesis !== "undefined"`)) === true);

      // Главное обещание: уже прочитанное не читается заново.
      const своя = fs.mkdtempSync(path.join(os.tmpdir(), "lib-своя-"));
      await call(`window.api.librarySaveConfig(${JSON.stringify({ vaultPath: своя })})`);
      const отпечатокПланёрки = await library.fingerprint(path.join(mediaRoot, "Планёрка.mp4"));
      await library.writeDoc({ root: dataRoot, vaultPath: своя }, {
        path: path.join(mediaRoot, "Планёрка.mp4"), name: "Планёрка.mp4",
        fingerprint: отпечатокПланёрки, kind: "видео", seconds: 135,
        engine: "local", transcribedAt: Date.now(), segments, chunks: docs[0].chunks,
      });
      const сГотовым = await call(`window.api.libraryScan()`);
      check("готовая расшифровка видна в списке",
        сГотовым.files.find((f) => f.name === "Планёрка.mp4")?.transcribed === true,
        JSON.stringify(сГотовым.files.map((f) => [f.name, f.transcribed])));
      const повтор = await call(`window.api.libraryTranscribe(
        ${JSON.stringify([path.join(mediaRoot, "Планёрка.mp4")])}, { polish: false })`);
      check("уже расшифрованное не читается заново — берётся готовое",
        повтор.reused === 1 && повтор.failed.length === 0, JSON.stringify(повтор));

      // И даже если запись переименовали: узнаётся по содержимому.
      const подДругимИменем = path.join(mediaRoot, "Планёрка от 3 марта.mp4");
      fs.copyFileSync(path.join(mediaRoot, "Планёрка.mp4"), подДругимИменем);
      const переезд = await call(`window.api.libraryTranscribe(
        ${JSON.stringify([подДругимИменем])}, { polish: false })`);
      check("переименованная запись тоже не читается заново",
        переезд.reused === 1 && переезд.failed.length === 0, JSON.stringify(переезд));
      const чтение = await call(`window.api.libraryRead(${JSON.stringify(подДругимИменем)})`);
      check("расшифровка читается по новому пути", чтение.text.length > 50, String(чтение.text.length));
      fs.rmSync(подДругимИменем);
      fs.rmSync(своя, { recursive: true, force: true });
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});

app.on("window-all-closed", () => {});
