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
const ffmpeg = require("ffmpeg-static");

function makeMedia(dest, seconds, withVideo) {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  if (withVideo) args.push("-f", "lavfi", "-i", `testsrc=size=320x240:rate=10:duration=${seconds}`);
  args.push("-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`);
  if (withVideo) args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  args.push("-c:a", "aac", "-shortest", dest);
  execFileSync(ffmpeg, args);
  return dest;
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
          .includes("На этом компьютере"));
      // Локальный движок стоит по умолчанию: материал не должен уезжать на
      // чужой сервер, пока человек этого не выбрал сам.
      const cfg = await call(`window.api.libraryConfig()`);
      check("по умолчанию расшифровка локальная", cfg.engine === "local", cfg.engine);
      await call(`window.api.librarySaveConfig(${JSON.stringify({ folderPath: mediaRoot })})`);
      const scan = await call(`window.api.libraryScan()`);
      check("папка прочитана из приложения", scan.files.length === 2, JSON.stringify(scan.files.map((f) => f.name)));
      check("ничего ещё не расшифровано", scan.files.every((f) => !f.transcribed));
      // Приложение не должно молча уходить на платный путь, если локального нет.
      const err = await call(`window.api.libraryTranscribe(${JSON.stringify([path.join(mediaRoot, "Планёрка.mp4")])})
        .then(() => "", e => e.message)`);
      check("без локального движка расшифровка отказывает, а не уезжает в сеть",
        /whisper|модел/i.test(err), err);
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.message);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    app.exit(failures === 0 ? 0 : 1);
  }
});

app.on("window-all-closed", () => {});
