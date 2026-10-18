// Монтаж: чистка речи по словам, план агента, субтитры, настоящая сборка mp4 и раздел в приложении.
//   npm run build && xvfb-run -a npx electron --no-sandbox electron/smoke-montage.cjs
//
// Главное, что здесь стережётся:
//  - «э-э» и паузы режутся, а нужные слова («вот почему», «а потом») — нет;
//  - сотня резов не уводит звук от картинки: длительность выхода — ровно сумма
//    кусков, округлённых до кадра;
//  - план агента встаёт на таймлайн по номерам слов, надпись — на своё слово
//    уже после всех резов;
//  - ролик собирается тем же вызовом, который делает кнопка «Экспорт».

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "mt-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mt-data-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "mt-out-"));

app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "test", model: "anthropic/claude-sonnet-5", temperature: 0.7, maxTokens: 4000, proxyMode: "direct", searchEnabled: false })
);
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 400) : ""}`);
  }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const m = require("./montage.cjs");
const avatar = require("./avatar.cjs");
const fxlib = require("./montagefx.cjs");
const stock = require("./stock.cjs");
const library = require("./library.cjs");
const ffmpeg = require("ffmpeg-static");
const { finish } = require("./finish.cjs");

/**
 * Исходник «с речью»: тон, который молчит на 2–3 секундах, — ровно то, что
 * найдёт поиск тишины. Картинка — счётчик, чтобы кадры отличались.
 */
function makeSource(dest, seconds = 6, size = "360x640") {
  execFileSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=25:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-af", "volume='if(between(t,2,3),0,1)':eval=frame",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", dest,
  ]);
  return dest;
}

function frames(file) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", file, "-map", "0:v", "-f", "null", "-"], { encoding: "utf-8" });
  const all = [...String(r.stderr).matchAll(/frame=\s*(\d+)/g)];
  return all.length ? Number(all[all.length - 1][1]) : 0;
}

function rgbAt(file, t, w = 90, h = 160) {
  return execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 24 });
}

function diff(a, b) {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(a[i] - b[i]);
  return d / Math.max(1, a.length);
}

function cleanup() {
  for (const dir of [userData, dataRoot, outDir]) fs.rmSync(dir, { recursive: true, force: true });
}

require("./main.cjs");

app.whenReady().then(async () => {
  try {
    console.log("слова и паразиты");
    const asr = {
      segments: [
        { from: 0, to: 4, text: "Привет, э-э, это типа мой первый ролик." },
        { from: 5.5, to: 9, text: "Я я думаю, что вот почему это работает." },
        { from: 9.2, to: 11, text: "А потом ну короче всё." },
      ],
    };
    const silences = [{ start: 1.2, end: 1.6 }, { start: 4, end: 5.5 }];
    const { words, wordLevel } = m.buildWords(asr, silences);
    const byWord = (w) => words.find((x) => m.normWord(x.w) === w);
    check("время фраз раскладывается по словам", !wordLevel && words.length === 20, String(words.length));
    check("слова не попадают в тишину внутри фразы", words.every((w) => !silences.some((s) => w.s > s.start + 0.01 && w.e < s.end - 0.01)));
    check("«э-э» — звук-заполнитель", byWord("э-э")?.filler === "sound");
    check("«типа» и «короче» — безопасные паразиты", byWord("типа")?.filler === "word" && byWord("короче")?.filler === "word");
    check("«вот» помечен как возможный, а не режется сам", byWord("вот")?.filler === "maybe");
    check("союз «а» паразитом не считается", !byWord("а")?.filler);
    check("запинка «я я» найдена", words.find((w) => w.w === "Я")?.repeat === true);

    const pieces = m.planKeeps(words);
    const keptText = words.filter((w) => pieces.some((p) => w.s >= p.from - 1e-6 && w.e <= p.to + 1e-6)).map((w) => m.normWord(w.w));
    check("«э-э» вырезано", !keptText.includes("э-э"));
    check("«типа» вырезано", !keptText.includes("типа"));
    check("«вот почему» осталось", keptText.includes("вот") && keptText.includes("почему"));
    check("«а потом» осталось", keptText.includes("а") && keptText.includes("потом"));
    check("первое «я» из запинки вырезано, второе осталось", keptText.filter((w) => w === "я").length === 1, keptText.join(" "));
    const longPause = pieces.find((p, i) => pieces[i + 1] && pieces[i + 1].from - p.to > 1);
    check("длинная пауза между фразами вырезана", !!longPause || pieces.every((p) => !(p.from < 4.5 && p.to > 5.2)), JSON.stringify(pieces));
    check("отступ не съедает начало следующего слова", pieces.every((p, i) => !pieces[i + 1] || p.to <= pieces[i + 1].from + 1e-6), JSON.stringify(pieces));
    const all = m.planKeeps(words, {}, { removeWords: "all" });
    check("режим «все паразиты» режет и «вот»", !words.filter((w) => all.some((p) => w.s >= p.from && w.e <= p.to)).some((w) => m.normWord(w.w) === "вот"));
    const stats = m.cleanupStats(words, {});
    check("статистика чистки считает убранное", stats.removedSounds === 1 && stats.removedWords === 2 && stats.removedRepeats === 1 && stats.after < stats.before, JSON.stringify(stats));

    check("тишина из вывода ffmpeg разбирается", JSON.stringify(m.parseSilences("[silencedetect] silence_start: 1.5\n[silencedetect] silence_end: 2.25 | silence_duration: 0.75\nsilence_start: 9", 10)) === JSON.stringify([{ start: 1.5, end: 2.25 }, { start: 9, end: 10 }]));
    check("время слов от модели подрезается по тишине", m.trimIntoSilence([{ w: "конец", s: 1, e: 3 }], [{ start: 1.6, end: 4 }])[0].e === 1.6);

    console.log("\nтаймлайн");
    const p0 = m.normalizeProject({
      clips: [
        { src: "/a.mp4", in: 0, out: 4 },
        { src: "/a.mp4", in: 5, out: 9, transition: { kind: "fade", duration: 0.5 } },
        { src: "/b.png", in: 0, out: 2, speed: 2 },
      ],
    });
    const lay = m.layout(p0.clips);
    check("переход съедает своё время", near(lay.items[1].start, 3.5, 1e-6) && near(lay.duration, 8.5, 1e-6), JSON.stringify(lay));
    check("скорость сокращает кусок", near(lay.items[2].duration, 1, 1e-6));
    check("время исходника → время ролика", near(m.sourceToOutput(p0.clips, "/a.mp4", 6), 4.5, 1e-6));
    check("время ролика → кусок и исходник", m.outputToSource(p0.clips, 4.5).index === 1 && near(m.outputToSource(p0.clips, 4.5).time, 6, 1e-6));
    const split = m.splitAt(p0.clips, 1);
    check("разрез делит кусок надвое", split.length === 4 && split[0].out === 1 && split[1].in === 1);
    const tw = m.buildWords({ words: [{ w: "раз", s: 0.5, e: 0.9 }, { w: "два", s: 1.0, e: 1.4 }, { w: "три", s: 1.5, e: 1.9 }] }).words;
    const cut = m.cutWordsFromClip(m.normalizeClip({ src: "/a.mp4", in: 0, out: 3 }), tw, new Set([1]));
    check("монтаж по тексту: вырезано ровно слово, края куска целы", cut.length === 2 && cut[0].in === 0 && cut[0].out === 1 && cut[1].in === 1.4 && cut[1].out === 3, JSON.stringify(cut.map((c) => [c.in, c.out])));
    check("кусок без речи монтаж по тексту не трогает", m.cutWordsFromClip(m.normalizeClip({ src: "/a.mp4", in: 5, out: 8 }), tw, new Set([1])).length === 1);
    check("скорость больше 2 — цепочкой atempo", m.atempoChain(3).join(",") === "atempo=2,atempo=1.5");
    check("пустой проект не собирается", m.validateProject(m.normalizeProject({})).some((x) => /нет ни одного куска/.test(x)));

    console.log("\nсубтитры");
    const capProject = m.normalizeProject({ clips: [{ src: "/a.mp4", in: 0, out: 3 }], captions: { enabled: true, style: "karaoke", highlight: "#FF2F6D" }, texts: [{ text: "Хук {в скобках}", start: 0, end: 2, style: "hook" }] });
    const ow = m.outputWords(capProject, { "/a.mp4": { words: tw } });
    const ass = m.buildAss(capProject, ow, { family: "Dinamika" });
    check("шрифт субтитров — по семейству из файла", /Style: Caption,Dinamika,/.test(ass));
    check("цвет акцента переведён в ASS (BGR)", ass.includes("&H006D2FFF"));
    check("по событию на каждое слово при подсветке", (ass.match(/,Caption,/g) || []).length === 3);
    check("фигурные скобки в тексте не ломают разметку", !/\{в скобках\}/i.test(ass) && /\(в скобках\)/i.test(ass));
    check("хук — отдельным стилем", ass.includes(",T_hook,,"));
    const lines = m.captionLines(ow.concat([{ w: "конец.", s: 2.0, e: 2.3 }, { w: "Новая", s: 4, e: 4.3 }]), { wordsPerLine: 4 });
    check("строка рвётся на точке и паузе", lines.length === 2 && lines[1].words[0].w === "Новая");

    console.log("\nплан агента");
    const files = [{ path: "/rec.mp4", name: "rec.mp4", words: m.buildWords({ words: [
      { w: "Итак,", s: 0, e: 0.4 }, { w: "сегодня", s: 0.5, e: 0.9 }, { w: "главное:", s: 1.0, e: 1.5 }, { w: "ну", s: 1.6, e: 1.8 },
      { w: "деньги", s: 1.9, e: 2.4 }, { w: "любят", s: 2.5, e: 2.9 }, { w: "тишину.", s: 3.0, e: 3.6 }, { w: "э-э", s: 4.5, e: 5.0 },
      { w: "Поэтому", s: 5.2, e: 5.7 }, { w: "молчите.", s: 5.8, e: 6.4 },
    ] }).words }];
    const prompt = m.buildAgentPrompt({ files });
    check("в задании агенту — номера слов", prompt.includes("F1:w0–w") && prompt.includes("‹ну›") && prompt.includes("[э-э]"));
    const answer = `Сделал один клип.\n===МОНТАЖ===\n\`\`\`json\n{"clips":[{"name":"Тишина","hook":"Деньги любят тишину","pieces":[{"from":"F1:w2","to":"F1:w9"}],"cut":["F1:w3"],"texts":[{"at":"F1:w8","text":"Молчите","style":"title","duration":1.5},{"at":"F1:w99","text":"нет такого"}],"captions":"bold"}]}\n\`\`\``;
    const plan = m.parsePlan(answer);
    check("план разбирается и без закрывающей метки", plan && plan.clips.length === 1 && plan.clips[0].captions === "bold");
    check("кривой ответ — не план, а null", m.parsePlan("===МОНТАЖ===\n{битый json") === null);
    const { project: agentProject, problems } = m.planToProject(plan.clips[0], files, { canvas: { preset: "9:16" }, punchIn: 0.1 });
    const agentWords = m.outputWords(agentProject, { "/rec.mp4": files[0] }).map((w) => m.normWord(w.w));
    check("вырезанное агентом «ну» ушло", !agentWords.includes("ну"), agentWords.join(" "));
    check("«э-э» ушло само", !agentWords.includes("э-э"));
    check("вступление вне кусков не попало", !agentWords.includes("итак") && !agentWords.includes("сегодня"));
    check("каждый второй кусок с наездом", agentProject.clips.length >= 2 && agentProject.clips[1].zoom > 1, JSON.stringify(agentProject.clips.map((c) => c.zoom)));
    const title = agentProject.texts.find((t) => t.text === "Молчите");
    const expectAt = m.sourceToOutput(agentProject.clips, "/rec.mp4", 5.2);
    check("надпись встала на своё слово после резов", title && near(title.start, expectAt, 1e-6), `${title && title.start} vs ${expectAt}`);
    check("хук поставлен сам, раз агент его назвал", agentProject.texts.some((t) => t.style === "hook" && t.start === 0));
    check("неверная ссылка агента — замечание, а не падение", problems.some((x) => x.includes("w99")));

    console.log("\nсборка mp4");
    const src = makeSource(path.join(outDir, "исходник с пробелом.mp4"));
    const sil = await m.detectSilences(ffmpeg, src, { total: 6 });
    check("тишина в записи найдена", sil.some((s) => near(s.start, 2, 0.15) && near(s.end, 3, 0.15)), JSON.stringify(sil));
    const png = path.join(outDir, "logo.png");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=120x60", "-frames:v", "1", png]);
    const music = path.join(outDir, "music.mp3");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-c:a", "libmp3lame", music]);
    const fontFile = path.resolve(__dirname, "..", "..", "DINAMIKA-extended.ttf");

    const project = {
      title: "Проверка",
      canvas: { preset: "9:16", width: 360, height: 640, fps: 25 },
      clips: [
        { src, in: 0, out: 2 },
        { src, in: 3, out: 6, transition: { kind: "fade", duration: 0.4 }, zoom: 1.2, adjust: { filter: "warm", brightness: 0.05 } },
        { src: png, kind: "image", in: 0, out: 1, transition: { kind: "slideleft", duration: 0.3 } },
      ],
      texts: [{ text: "Хук", start: 0, end: 1.5, style: "hook" }],
      audio: [{ src: music, start: 0.5, in: 0, out: 3, volume: 0.3, duck: true }],
      captions: { enabled: true, style: "karaoke" },
      logo: { path: png, corner: "top-right", size: 0.15 },
    };
    const expected = m.layout(m.normalizeProject(project).clips).duration;
    const transcripts = { [src]: { words: m.buildWords({ words: [{ w: "раз", s: 0.2, e: 0.8 }, { w: "два", s: 1, e: 1.6 }, { w: "три", s: 3.2, e: 3.9 }] }).words } };
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
    const out1 = path.join(outDir, "ролик.mp4");
    const stages = new Set();
    const r1 = await m.renderProject({ bin: ffmpeg, project, transcripts, outPath: out1, workDir: work, fontFiles: fs.existsSync(fontFile) ? [{ path: fontFile, family: "DINAMIKA" }] : [], onProgress: (p) => stages.add(p.stage) });
    fs.rmSync(work, { recursive: true, force: true });
    const info = await m.probeMedia(ffmpeg, out1);
    check("ролик собран", fs.existsSync(out1) && info.hasVideo && info.hasAudio);
    check("размер кадра — как у холста", info.width === 360 && info.height === 640, `${info.width}x${info.height}`);
    check("длительность — как на таймлайне", near(info.duration, expected, 0.1), `${info.duration} vs ${expected}`);
    check("субтитры попали в сборку", r1.captions === 3);
    check("прогресс сообщается по шагам", ["pieces", "join", "encode", "done"].every((s) => stages.has(s)), [...stages].join(","));

    // Сотня резов: длительность выхода — ровно сумма кусков. Если звук и
    // картинка округляются по-разному, расхождение растёт с каждым резом.
    const many = { canvas: { width: 160, height: 284, fps: 25 }, clips: [] };
    for (let i = 0; i < 40; i++) many.clips.push({ src, in: round(i * 0.13 % 5.5), out: round((i * 0.13 % 5.5) + 0.21) });
    const outMany = path.join(outDir, "резы.mp4");
    const w2 = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
    await m.renderProject({ bin: ffmpeg, project: { ...many, audioFx: { loudnorm: false } }, outPath: outMany, workDir: w2 });
    fs.rmSync(w2, { recursive: true, force: true });
    const sumFrames = many.clips.reduce((a, c) => a + Math.round((c.out - c.in) * 25), 0);
    const gotFrames = frames(outMany);
    const manyInfo = await m.probeMedia(ffmpeg, outMany);
    check("40 резов: кадров ровно столько, сколько в кусках", Math.abs(gotFrames - sumFrames) <= 1, `${gotFrames} vs ${sumFrames}`);
    check("40 резов: звук не длиннее и не короче картинки", near(manyInfo.duration, sumFrames / 25, 0.06), `${manyInfo.duration} vs ${sumFrames / 25}`);

    // Субтитры и правда нарисованы: кадр с ними отличается от кадра без них.
    const capOn = path.join(outDir, "с-субтитрами.mp4");
    const capOff = path.join(outDir, "без-субтитров.mp4");
    const base = { canvas: { width: 360, height: 640, fps: 25 }, clips: [{ src, in: 0, out: 1.5 }], audioFx: { loudnorm: false } };
    const tr = { [src]: { words: m.buildWords({ words: [{ w: "ПРОВЕРКА", s: 0.1, e: 1.4 }] }).words } };
    for (const [file, enabled] of [[capOn, true], [capOff, false]]) {
      const w = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
      await m.renderProject({ bin: ffmpeg, project: { ...base, captions: { enabled, style: "box", size: 90 } }, transcripts: tr, outPath: file, workDir: w });
      fs.rmSync(w, { recursive: true, force: true });
    }
    check("субтитры видны в кадре", diff(rgbAt(capOn, 0.7), rgbAt(capOff, 0.7)) > 1, String(diff(rgbAt(capOn, 0.7), rgbAt(capOff, 0.7))));

    // Чистка тишины на настоящей записи: пауза 2–3 с уходит.
    const words6 = m.buildWords({ segments: [{ from: 0, to: 2, text: "один два три" }, { from: 3, to: 6, text: "четыре пять шесть семь" }] }, sil).words;
    const cleaned = m.cleanClip(m.normalizeClip({ src, in: 0, out: 6 }), words6, {});
    const cleanedDur = cleaned.reduce((a, c) => a + (c.out - c.in), 0);
    check("секундная пауза вырезана, речь осталась", cleanedDur > 4.6 && cleanedDur < 5.5, String(cleanedDur));

    console.log("\nэффекты, фильтры, звуки");
    // Каждая запись таблиц обязана собираться: опечатка в одном фильтре
    // роняла бы экспорт всего ролика, а заметили бы её только у человека.
    const runOk = (args) => spawnSync(ffmpeg, args, { encoding: "utf-8" }).status === 0;
    const fxBad = fxlib.EFFECTS.filter((e) => !runOk(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x284:r=25:d=0.3", "-filter_complex", `[0:v]${fxlib.effectsChain([{ kind: e.id, amount: 1 }], { W: 160, H: 284, dur: 1, n: 0 })},format=yuv420p[v]`, "-map", "[v]", "-f", "null", "-"]));
    check(`все ${fxlib.EFFECTS.length} видеоэффектов собираются`, fxBad.length === 0, fxBad.map((e) => e.id).join(", "));
    const flBad = fxlib.FILTERS.filter((f) => f.vf && !runOk(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=160x284:r=25:d=0.2", "-vf", f.vf, "-f", "null", "-"]));
    check(`все ${fxlib.FILTERS.length - 1} фильтров собираются`, flBad.length === 0, flBad.map((f) => f.id).join(", "));
    const afBad = fxlib.AUDIO_FX.filter((f) => f.af && !runOk(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=0.3", "-ar", "48000", "-af", f.af, "-f", "null", "-"]));
    check(`все ${fxlib.AUDIO_FX.length - 1} звуковых эффектов голоса собираются`, afBad.length === 0, afBad.map((f) => f.id).join(", "));
    const sfxBad = fxlib.SFX.filter((x) => !runOk(fxlib.sfxArgs(x.id, path.join(outDir, `sfx-${x.id}.wav`))));
    check(`все ${fxlib.SFX.length} звуков библиотеки синтезируются`, sfxBad.length === 0, sfxBad.map((x) => x.id).join(", "));
    check("стилей субтитров больше двадцати", fxlib.CAPTION_STYLES.length >= 20, String(fxlib.CAPTION_STYLES.length));
    const capBad = fxlib.CAPTION_STYLES.filter((st) => {
      const pr = m.normalizeProject({ clips: [{ src: "/a.mp4", in: 0, out: 3 }], captions: { enabled: true, style: st.id } });
      const ass = m.buildAss(pr, m.outputWords(pr, { "/a.mp4": { words: tw } }));
      return !ass.includes(",Caption,,") || /undefined|NaN/.test(ass);
    });
    check("каждый стиль субтитров даёт чистый ASS", capBad.length === 0, capBad.map((x) => x.id).join(", "));

    console.log("\nключевые точки");
    const kf = fxlib.normalizeKeyframes([{ t: 2, x: 0.75 }, { t: 0, x: 0.25, ease: "linear" }]);
    check("точки сортируются по времени", kf[0].t === 0 && kf[1].t === 2);
    check("между точками — интерполяция", near(fxlib.sampleTransform({}, kf, 1).x, 0.5, 1e-9));
    check("до первой и после последней — крайние значения", fxlib.sampleTransform({}, kf, -1).x === 0.25 && fxlib.sampleTransform({}, kf, 9).x === 0.75);
    const expr = fxlib.keyframeExpr("x", {}, kf, { offset: 1 });
    const evalAt = (t) => Function("t", "lt", "if_", `return ${expr.replace(/if\(/g, "if_(")}`)(t, (a, b) => (a < b ? 1 : 0), (c, a, b) => (c ? a : b));
    check("выражение ffmpeg совпадает с расчётом окна", near(evalAt(2), 0.5, 1e-6) && near(evalAt(0), 0.25, 1e-6) && near(evalAt(5), 0.75, 1e-6), `${evalAt(0)} ${evalAt(2)} ${evalAt(5)}`);

    console.log("\nслои: картинка в картинке, хромакей, движение");
    const blue = path.join(outDir, "синий.mp4");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x0000FF:s=360x640:r=25:d=3", "-f", "lavfi", "-i", "sine=d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", blue]);
    const greenRed = path.join(outDir, "хромакей.mp4");
    execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x00FF00:s=200x200:r=25:d=3", "-f", "lavfi", "-i", "color=c=0xFF0000:s=60x60:r=25:d=3", "-filter_complex", "[0][1]overlay=70:70", "-c:v", "libx264", "-pix_fmt", "yuv420p", greenRed]);
    const pixel = (file, t, fx, fy) => {
      const raw = rgbAt(file, t, 90, 160);
      const i = (Math.round(fy * 159) * 90 + Math.round(fx * 89)) * 3;
      return [raw[i], raw[i + 1], raw[i + 2]];
    };
    const isRed = ([r, g, b]) => r > 150 && g < 90 && b < 90;
    const isBlue = ([r, g, b]) => b > 150 && r < 90 && g < 90;
    const layerProject = {
      canvas: { width: 360, height: 640, fps: 25 },
      clips: [{ src: blue, in: 0, out: 3 }],
      layers: [{ src: greenRed, kind: "video", start: 0, in: 0, out: 3, chroma: { enabled: true, similarity: 0.25 }, keyframes: [{ t: 0, x: 0.3, y: 0.5, scale: 0.5, ease: "linear" }, { t: 2.5, x: 0.7, y: 0.5, scale: 0.5 }] }],
      audioFx: { loudnorm: false },
    };
    const outLayer = path.join(outDir, "слой.mp4");
    const wl = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
    await m.renderProject({ bin: ffmpeg, project: layerProject, outPath: outLayer, workDir: wl });
    fs.rmSync(wl, { recursive: true, force: true });
    check("слой поверх кадра: в начале красный квадрат слева", isRed(pixel(outLayer, 0.04, 0.3, 0.5)), JSON.stringify(pixel(outLayer, 0.04, 0.3, 0.5)));
    check("ключевые точки двигают слой: в конце квадрат справа", isRed(pixel(outLayer, 2.6, 0.7, 0.5)) && !isRed(pixel(outLayer, 2.6, 0.3, 0.5)), JSON.stringify([pixel(outLayer, 2.6, 0.7, 0.5), pixel(outLayer, 2.6, 0.3, 0.5)]));
    check("хромакей убрал зелёный фон слоя", isBlue(pixel(outLayer, 0.04, 0.3 - 0.2, 0.5)), JSON.stringify(pixel(outLayer, 0.04, 0.1, 0.5)));

    console.log("\nформаты экспорта");
    const small = { canvas: { width: 360, height: 640, fps: 25 }, clips: [{ src, in: 0, out: 1.5, effects: [{ kind: "vhs", amount: 0.5 }], reverse: true, keyframes: [{ t: 0, scale: 1 }, { t: 1.5, scale: 1.3, rotation: 5 }] }], texts: [{ text: "Тест", start: 0, end: 1, style: "hook", x: 0.3, y: 0.7 }], audioFx: { loudnorm: false } };
    for (const [format, size, expect] of [["webm", "360", { v: true, a: true, w: 360 }], ["mp4-hevc", "720", { v: true, a: true, w: 720 }], ["gif", "source", { v: true, a: false, w: 240 }], ["mp3", "source", { v: false, a: true }], ["mov", "source", { v: true, a: true, w: 360 }]]) {
      const ext = fxlib.EXPORT_FORMATS.find((f) => f.id === format).ext;
      const out = path.join(outDir, `экспорт-${format}${ext}`);
      const w = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
      let info = null;
      try {
        await m.renderProject({ bin: ffmpeg, project: small, outPath: out, workDir: w, exportOptions: { format, size, gifWidth: 240 } });
        info = await m.probeMedia(ffmpeg, out);
      } catch (e) {
        info = { error: e.message };
      }
      fs.rmSync(w, { recursive: true, force: true });
      check(`экспорт ${format}`, info && !info.error && info.hasVideo === expect.v && info.hasAudio === expect.a && (!expect.w || info.width === expect.w), JSON.stringify(info));
    }
    const lut = path.join(outDir, "тёплый lut.cube");
    let cube = "LUT_3D_SIZE 2\n";
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) cube += `${r ? 1 : 0.2} ${g} ${b * 0.5}\n`;
    fs.writeFileSync(lut, cube);
    const outLut = path.join(outDir, "lut.mp4");
    const wlut = fs.mkdtempSync(path.join(os.tmpdir(), "mt-work-"));
    await m.renderProject({ bin: ffmpeg, project: { canvas: { width: 360, height: 640, fps: 25 }, clips: [{ src: blue, in: 0, out: 1, adjust: { lut } }], audioFx: { loudnorm: false } }, outPath: outLut, workDir: wlut });
    fs.rmSync(wlut, { recursive: true, force: true });
    const lutPx = pixel(outLut, 0.5, 0.5, 0.5);
    check("LUT из файла с пробелом в имени применяется", lutPx[2] < 160, JSON.stringify(lutPx));

    console.log("\nсток (ответы сервисов подменены)");
    const stockCalls = [];
    const stockFetch = async (url, init = {}) => {
      stockCalls.push({ url: String(url), headers: init.headers || {} });
      const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => "", arrayBuffer: async () => Buffer.from("ID3файл"), headers: { get: () => "7" } });
      if (url.includes("api.pexels.com/videos")) return json({ videos: [{ id: 1, duration: 9, image: "t.jpg", url: "p", user: { name: "Автор" }, video_files: [{ link: "https://v/360.mp4", width: 360, height: 640 }, { link: "https://v/1080.mp4", width: 1080, height: 1920 }, { link: "https://v/4k.mp4", width: 2160, height: 3840 }] }] });
      if (url.includes("pixabay.com/api/videos")) return json({ hits: [{ id: 2, duration: 5, tags: "город", user: "pix", pageURL: "pg", videos: { large: { url: "https://v/l.mp4", width: 1920, height: 1080, thumbnail: "th" }, small: { url: "https://v/s.mp4", width: 640, height: 360 } } }] });
      if (url.includes("api.openverse.org")) return json({ results: [{ id: "ov1", title: "Whoosh", url: "https://cdn/whoosh.mp3", creator: "Кто-то", license: "by", license_version: "4.0", foreign_landing_url: "https://fs/1", duration: 1200 }] });
      if (url.includes("freesound.org")) return json({ results: [{ id: 7, name: "click", duration: 0.2, previews: { "preview-hq-mp3": "https://fs/c.mp3" }, license: "https://creativecommons.org/publicdomain/zero/1.0/", username: "u" }] });
      if (url.includes("jamendo.com")) return json({ results: [{ id: 9, name: "Song", artist_name: "Band", duration: 120, audio: "https://j/a.mp3", audiodownload: "https://j/d.mp3", license_ccurl: "cc" }] });
      return json({});
    };
    const pexels = await stock.search({ provider: "pexels", kind: "video", query: "город", keys: { pexels: "PK" }, fetchImpl: stockFetch });
    check("Pexels: выбран файл ближе к Full HD, не 4K", pexels[0].url === "https://v/1080.mp4" && stockCalls[0].headers.Authorization === "PK");
    const pix = await stock.search({ provider: "pixabay", kind: "video", query: "город", keys: { pixabay: "X" }, fetchImpl: stockFetch });
    check("Pixabay: видео найдено", pix[0].url === "https://v/l.mp4");
    const ov = await stock.search({ provider: "openverse", kind: "sfx", query: "whoosh", keys: {}, fetchImpl: stockFetch });
    check("Openverse работает без ключа, звуки — категория sound_effect", ov.length === 1 && stockCalls.some((c) => c.url.includes("category=sound_effect")) && ov[0].duration === 1.2);
    const fsd = await stock.search({ provider: "freesound", kind: "sfx", query: "click", keys: { freesound: "F" }, fetchImpl: stockFetch });
    const jam = await stock.search({ provider: "jamendo", kind: "music", query: "rock", keys: { jamendo: "J" }, fetchImpl: stockFetch });
    check("Freesound и Jamendo разбираются", fsd[0].url === "https://fs/c.mp3" && jam[0].url === "https://j/d.mp3");
    const noKey = await stock.search({ provider: "pexels", kind: "video", query: "x", keys: {}, fetchImpl: stockFetch }).catch((e) => e.message);
    check("без ключа — понятный отказ с адресом, где его взять", /бесплатный ключ/.test(noKey) && /pexels\.com/.test(noKey), noKey);
    const stockDir = path.join(outDir, "сток");
    const got = await stock.download(ov[0], stockDir, { fetchImpl: stockFetch });
    check("скачанное лежит в папке стока по виду материала", fs.existsSync(got) && got.includes(path.join("сток", "звуки")));
    const again = await stock.download(ov[0], stockDir, { fetchImpl: async () => { throw new Error("повторная загрузка"); } });
    check("уже скачанное не качается повторно", again === got);
    const credits = await stock.creditsFor(stockDir, [got]);
    check("подпись автора для CC BY попадает в описание", credits.includes("Кто-то") && credits.includes("BY"), credits);

    console.log("\nаватар (сервисы подменены)");
    const calls = [];
    const fake = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
      const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => new ArrayBuffer(8) });
      if (url.endsWith("/voices/add")) return json({ voice_id: "v-123" });
      if (url.includes("/text-to-speech/")) return json({});
      if (url.includes("storage/upload/initiate")) return json({ upload_url: "https://up/x", file_url: `https://cdn/${calls.length}` });
      if (url === "https://up/x") return json({});
      if (url.startsWith("https://queue.fal.run/")) return json({ status_url: "https://q/status", response_url: "https://q/result" });
      if (url === "https://q/status") return json({ status: calls.filter((c) => c.url === "https://q/status").length > 1 ? "COMPLETED" : "IN_QUEUE" });
      if (url === "https://q/result") return json({ video: { url: "https://cdn/out.mp4" } });
      return { ok: false, status: 404, text: async () => "нет", json: async () => ({}) };
    };
    const sample = path.join(outDir, "голос.mp3");
    execFileSync(ffmpeg, avatar.voiceSampleArgs(src, sample));
    check("образец голоса вырезается из видео", fs.statSync(sample).size > 1000);
    const voiceId = await avatar.cloneVoice({ apiKey: "KEY", name: "Я", samplePaths: [sample], fetchImpl: fake });
    check("клон голоса возвращает номер", voiceId === "v-123" && calls[0].headers["xi-api-key"] === "KEY");
    await avatar.synthesize({ apiKey: "KEY", voiceId, text: "Привет", dest: path.join(outDir, "tts.mp3"), fetchImpl: fake });
    const ttsCall = calls.find((c) => c.url.includes("text-to-speech"));
    check("озвучка идёт клонированным голосом", ttsCall.url.includes("/v-123") && JSON.parse(ttsCall.body).voice_settings.similarity_boost >= 0.85);
    const url = await avatar.falRun({ apiKey: "FK", model: "fal-ai/sync-lipsync/v2", input: { a: 1 }, pollMs: 5, fetchImpl: fake });
    check("очередь fal.ai опрашивается до готовности", url.video.url === "https://cdn/out.mp4" && calls.filter((c) => c.url === "https://q/status").length === 2);
    const lip = await avatar.lipsync({ apiKey: "FK", videoPath: src, audioPath: sample, fetchImpl: async (u, i) => (String(u) === "https://q/status" ? { ok: true, status: 200, json: async () => ({ status: "COMPLETED" }) } : fake(u, i)) });
    check("синхронизация губ отдаёт ссылку на видео", lip === "https://cdn/out.mp4");
    const failing = async () => ({ ok: false, status: 401, text: async () => "bad key KEY", json: async () => ({}) });
    const err = await avatar.cloneVoice({ apiKey: "KEY", samplePaths: [sample], fetchImpl: failing }).catch((e) => e.message);
    check("отказ по ключу объяснён, а сам ключ в ошибку не попал", /Ключ не принят/.test(err) && !err.includes("KEY"), err);

    console.log("\nраздел в приложении");
    let ui;
    const dl = Date.now() + 20000;
    while (!ui && Date.now() < dl) {
      ui = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
      if (!ui) await new Promise((r) => setTimeout(r, 150));
    }
    check("окно приложения нашлось", !!ui);
    if (ui) {
      await new Promise((resolve) => (!ui.webContents.isLoading() ? resolve() : ui.webContents.once("did-finish-load", resolve)));
      const call = (e) => ui.webContents.executeJavaScript(e);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(1000);

      const range = await call(`fetch("montage-media://media/" + encodeURIComponent(${JSON.stringify(src)}), { headers: { Range: "bytes=0-99" } }).then(async r => ({ status: r.status, len: (await r.arrayBuffer()).byteLength }))`);
      check("плеер получает файл по кусочкам (Range)", range.status === 206 && range.len === 100, JSON.stringify(range));
      const denied = await call(`fetch("montage-media://media/" + encodeURIComponent(${JSON.stringify(path.join(userData, "settings.json"))})).then(r => r.status)`);
      check("через схему плеера не читаются не-медиафайлы", denied === 403, String(denied));

      // Расшифровка подкладывается готовой: модели распознавания в тесте нет,
      // а всё после неё работает по-настоящему.
      const fp = await library.fingerprint(src);
      const tdir = path.join(dataRoot, "montage", "transcripts");
      fs.mkdirSync(tdir, { recursive: true });
      fs.writeFileSync(path.join(tdir, `${fp}.json`), JSON.stringify({ fingerprint: fp, path: src, name: path.basename(src), duration: 6, words: words6, wordLevel: false, silences: sil }));
      await call(`window.api.montageSaveConfig({ outputDir: ${JSON.stringify(outDir)}, sources: [${JSON.stringify(outDir)}] })`);
      const scan = await call(`window.api.montageScan([${JSON.stringify(outDir)}])`);
      const scanned = scan.files.find((f) => f.path === src);
      check("папка просматривается, расшифровка узнаётся по содержимому", scanned && scanned.transcribed && scan.files.some((f) => f.kind === "image"), JSON.stringify(scan.files.map((f) => [f.name, f.kind, f.transcribed])));
      const prepared = await call(`window.api.montagePrepareAgent({ paths: [${JSON.stringify(src)}] })`);
      check("задание агенту собрано из расшифровки", prepared.prompt.includes("F1:w0") && prepared.missing.length === 0);
      const created = await call(`window.api.montageApplyPlan({ paths: [${JSON.stringify(src)}], plan: { clips: [{ name: "Клип агента", hook: "Хук", description: "Описание #тест", pieces: [{ from: "F1:w0", to: "F1:w6" }], cut: ["F1:w4"], texts: [], captions: "karaoke", transition: "none" }] } })`);
      check("план агента стал проектом", created.length === 1 && created[0].id, JSON.stringify(created));
      const listed = await call(`window.api.montageList()`);
      check("проект в списке", listed.some((p) => p.title === "Клип агента"));
      const rendered = await call(`window.api.montageRenderMany([${JSON.stringify(created[0].id)}])`);
      check("клип собирается кнопкой «Собрать все»", rendered[0] && rendered[0].path && fs.existsSync(rendered[0].path), JSON.stringify(rendered));
      check("рядом с роликом — описание для публикации", rendered[0].path && fs.readFileSync(rendered[0].path.replace(/\.mp4$/, ".txt"), "utf-8").includes("#тест"));

      await call(`[...document.querySelectorAll(".sidebar-item")].find(n => n.textContent.includes("Монтаж")).click()`);
      await wait(800);
      check("раздел открывается", (await call(`!!document.querySelector(".mt-root")`)) === true);
      check("раздел открывается сразу редактором", (await call(`!!document.querySelector(".mt-editor")`)) === true);
      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Монтажёр")).click()`);
      await wait(800);
      check("источник из настроек виден в монтажёре", (await call(`document.querySelectorAll(".mt-file").length`)) >= 2);
      await call(`[...document.querySelectorAll(".mt-topbar button")].find(b => b.textContent.includes("Проекты")).click()`);
      await wait(400);
      await call(`[...document.querySelectorAll(".mt-overlay .mt-project")].find(p => p.textContent.includes("Клип агента")).querySelector("button").click()`);
      await wait(1500);
      const clipsBefore = await call(`document.querySelectorAll(".mt-tl-clip").length`);
      check("редактор открыл проект агента", clipsBefore >= 1 && !!(await call(`!!document.querySelector(".mt-stage video")`)), String(clipsBefore));
      check("текст ролика виден для монтажа по тексту", (await call(`document.querySelectorAll(".mt-words span").length`)) > 0);
      await call(`[...document.querySelectorAll(".mt-toolbar button")].find(b => b.textContent.includes("Разрезать")).click()`);
      await wait(300);
      await call(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true }))`);
      await wait(200);
      await call(`[...document.querySelectorAll(".mt-toolbar button")].find(b => b.textContent.includes("Разрезать")).click()`);
      await wait(400);
      const clipsAfter = await call(`document.querySelectorAll(".mt-tl-clip").length`);
      check("«Разрезать» делит кусок под бегунком", clipsAfter === clipsBefore + 1, `${clipsBefore} → ${clipsAfter}`);
      await call(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }))`);
      await wait(400);
      check("Ctrl+Z отменяет разрез", (await call(`document.querySelectorAll(".mt-tl-clip").length`)) === clipsBefore);
      await call(`[...document.querySelectorAll(".mt-toolbar button")].find(b => b.textContent.includes("Текст")).click()`);
      await wait(300);
      await call(`document.querySelector(".mt-text-preset.s-hook").click()`);
      await wait(300);
      check("надпись добавляется на дорожку текста", (await call(`document.querySelectorAll(".mt-tl-text").length`)) >= 1);
      check("у надписи открылись настройки", (await call(`[...document.querySelectorAll(".mt-inspector h4")].some(h => h.textContent.includes("Надпись"))`)) === true);
      await wait(1000);
      const saved = await call(`window.api.montageList().then(l => l.find(p => p.title === "Клип агента"))`);
      const reread = await call(`window.api.montageRead(${JSON.stringify(created[0].id)})`);
      check("правки сохраняются сами", saved && reread.texts.length >= 2, JSON.stringify(reread.texts.map((t) => t.text)));
      // Перетаскивание надписи мышью в кадре — у неё появляется своё место.
      await call(`(() => { const el = document.querySelector(".mt-overlay-text"); const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + 45, clientY: r.top + 85 }));
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: r.left + 45, clientY: r.top + 85 })); })()`);
      await wait(1200);
      const moved = await call(`window.api.montageRead(${JSON.stringify(created[0].id)})`);
      const hook = moved.texts.find((t) => t.style === "hook" && t.x !== null);
      check("надпись перетаскивается мышью в кадре", !!hook && hook.y > 0.1, JSON.stringify(moved.texts.map((t) => [t.text, t.x, t.y])));

      // Эффект из панели — на выбранный кусок.
      await call(`document.querySelector(".mt-tl-clip").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Эффекты")).click()`);
      await wait(300);
      await call(`[...document.querySelectorAll(".mt-fx-chip")].find(b => b.textContent.includes("VHS")).click()`);
      await wait(300);
      check("эффект из панели лёг на выбранный кусок", (await call(`document.querySelector(".mt-tl-clip .mt-tl-label").textContent.includes("✦1")`)) === true);
      // Ключевая точка из инспектора — ромбик на куске.
      await call(`[...document.querySelectorAll(".mt-inspector button")].find(b => b.textContent.includes("Ключевая точка")).click()`);
      await wait(300);
      check("ключевая точка видна ромбиком на таймлайне", (await call(`document.querySelectorAll(".mt-tl-clip .mt-tl-kf").length`)) === 1);
      // Звук из библиотеки — на дорожку звуков.
      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Звуки")).click()`);
      await wait(300);
      await call(`[...document.querySelectorAll(".mt-stock-row")].find(r => r.textContent.includes("Вжух")).querySelector(".btn").click()`);
      await wait(1500);
      check("звуковой эффект встал на свою дорожку", (await call(`document.querySelectorAll(".mt-tl-audio.k-sfx").length`)) === 1);
      // Слой поверх видео из медиатеки.
      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Медиа")).click()`);
      await wait(300);
      await call(`document.querySelector(".mt-bin-actions button[title^='Слоем']").click()`);
      await wait(1200);
      check("слой из медиатеки — на дорожке слоёв и в кадре", (await call(`document.querySelectorAll(".mt-tl-layer").length`)) === 1 && (await call(`document.querySelectorAll(".mt-layer").length`)) >= 1);
      check("у слоя открылись настройки с маской и хромакеем", (await call(`[...document.querySelectorAll(".mt-inspector summary")].some(s => s.textContent.includes("Форма и фон"))`)) === true);
      // Переход из панели — на стык.
      await call(`[...document.querySelectorAll(".mt-toolbar button")].find(b => b.textContent.includes("Разрезать")).click()`);
      await wait(300);
      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Переходы")).click()`);
      await wait(300);
      await call(`[...document.querySelectorAll(".mt-fx-chip")].find(b => b.textContent.includes("Растворение")).click()`);
      await wait(1000);
      const withTr = await call(`window.api.montageRead(${JSON.stringify(created[0].id)})`);
      check("переход встал на стык", withTr.clips.some((c) => c.transition.kind === "fade"), JSON.stringify(withTr.clips.map((c) => c.transition.kind)));
      // Экспорт сразу в два формата.
      await call(`[...document.querySelectorAll(".mt-topbar button")].find(b => b.textContent.includes("Экспорт")).click()`);
      await wait(500);
      check("окно экспорта открывается", (await call(`!!document.querySelector(".mt-modal")`)) === true);
      const many = await call(`window.api.montageExportMany(${JSON.stringify({ ...withTr, layers: [] })}, [{ format: "gif", gifWidth: 160 }, { format: "mp3" }])`);
      check("экспорт в несколько форматов за раз", many.length === 2 && many.every((r) => r.path && fs.existsSync(r.path)) && /\.gif$/.test(many[0].path) && /\.mp3$/.test(many[1].path), JSON.stringify(many));
      await call(`[...document.querySelectorAll(".mt-modal button")].find(b => b.textContent.includes("Закрыть")).click()`);
      await wait(200);

      await call(`[...document.querySelectorAll(".mt-rail button")].find(b => b.textContent.includes("Аватар")).click()`);
      await wait(400);
      check("вкладка аватара открывается", (await call(`!!document.querySelector(".mt-avatar")`)) === true);
      const keys = await call(`window.api.montageSaveAvatarKeys({ eleven: "секрет" })`);
      check("ключи сохраняются, а окну отдаётся только «задан»", keys.eleven === true && !JSON.stringify(keys).includes("секрет"));
      check("ключи лежат не в папке данных", !JSON.stringify(fs.readdirSync(path.join(dataRoot, "montage"))).includes("keys"));
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.stack ? e.stack : e);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    cleanup();
    finish(failures, (c) => app.exit(c));
  }
});

function round(v) {
  return Math.round(v * 1000) / 1000;
}
