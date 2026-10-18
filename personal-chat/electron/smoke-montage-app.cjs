// Отдельная программа «Монтаж»: своё окно, своя служебная папка, свои вкладки.
//   npm run build && xvfb-run -a -s "-screen 0 2560x2560x24" npx electron --no-sandbox electron/smoke-montage-app.cjs
//   (SHOTS=папка — сохранить снимки окна)
//
// Стережётся главное: «Монтаж» не делит настройки и ключи с «Личным чатом»,
// а открывается сразу видеоредактором (всё — внутри него), а не чатом.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { finish } = require("./finish.cjs");

const appData = fs.mkdtempSync(path.join(os.tmpdir(), "mt-appdata-"));
app.setPath("appData", appData);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

require("./montage-main.cjs");
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    console.log("отдельная программа «Монтаж»");
    check("имя программы — «Монтаж»", app.getName() === "Монтаж", app.getName());
    check("своя служебная папка", app.getPath("userData") === path.join(appData, "Монтаж"), app.getPath("userData"));
    let win;
    const dl = Date.now() + 20000;
    while (!win && Date.now() < dl) {
      win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && /montage\.html/.test(w.webContents.getURL()));
      if (!win) await new Promise((r) => setTimeout(r, 150));
    }
    check("окно открывает видеоредактор, а не чат", !!win);
    if (win) {
      await new Promise((resolve) => (!win.webContents.isLoading() ? resolve() : win.webContents.once("did-finish-load", resolve)));
      win.setContentSize(1600, 980);
      const call = (e) => win.webContents.executeJavaScript(e);
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (expr, ms = 20000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await call(expr).catch(() => false)) return true;
          await wait(200);
        }
        return false;
      };
      const shot = async (name) => {
        if (!process.env.SHOTS) return;
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.SHOTS, `${name}.png`), img.toPNG());
      };
      const clickText = (sel, text) => call(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.includes(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);

      // Ключа нет — программа сама показывает настройки, но поверх редактора.
      check("без ключа открываются настройки", await until(`!!document.querySelector(".mt-app-settings")`));
      check("редактор уже открыт под настройками", (await call(`!!document.querySelector(".mt-editor")`)) === true);
      await clickText(".mt-app-settings button", "Готово");
      await wait(300);
      check("настройки закрываются", (await call(`!document.querySelector(".mt-app-settings")`)) === true);
      check("отдельных вкладок-страниц нет", (await call(`!document.querySelector(".mt-app-bar") && !document.querySelector(".mt-root > .mt-tabs")`)) === true);
      const rail = await call(`[...document.querySelectorAll(".mt-rail button")].map(b => b.textContent)`);
      check("всё внутри редактора: моушн, титры, монтажёр, аватар", ["Моушн", "Титры", "Монтажёр", "Аватар"].every((n) => rail.some((r) => r.includes(n))), rail.join(","));
      check("чата и боковой колонки нет", (await call(`!document.querySelector(".sidebar")`)) === true);
      check("заголовок окна — «Монтаж»", (await call(`document.title`)) === "Монтаж");
      check("данные — в своей папке, не в «Личном чате»", fs.existsSync(path.join(appData, "Монтаж")) && !fs.existsSync(path.join(appData, "personal-chat")));

      await clickText(".mt-rail button", "Моушн");
      check("✨ Моушн — панель в редакторе", await until(`!!document.querySelector(".mt-motion-panel")`));
      check("без текста кнопка не нажимается", (await call(`document.querySelector(".mt-motion-panel .mt-big").disabled`)) === true);
      await shot("1-motion-panel");

      await clickText(".mt-rail button", "Титры");
      check("титры — сетка заготовок", await until(`document.querySelectorAll(".mt-tpl").length >= 18`));
      check("у заготовок есть картинки", await until(`[...document.querySelectorAll(".mt-tpl-img")].filter(e => e.style.backgroundImage).length >= 4`, 60000));
      await call(`document.querySelector(".mt-tpl").click()`);
      check("титр лёг слоем на таймлайн", await until(`!!document.querySelector(".mt-tl-layer.motion")`));
      check("титр виден в кадре", await until(`!!document.querySelector(".mt-stage .mt-motion-frame")`));
      check("текст титра правится в инспекторе", await until(`document.querySelectorAll(".mt-motion-insp input, .mt-motion-insp textarea").length >= 1`));
      await call(`window.__mtSeek = true`);
      await shot("2-titles");

      await clickText(".mt-rail button", "Монтажёр");
      check("ИИ-монтажёр — внутри редактора", await until(`!!document.querySelector(".mt-left .mt-agent")`));
      await clickText(".mt-rail button", "Аватар");
      check("аватар — внутри редактора", await until(`!!document.querySelector(".mt-left .mt-avatar")`));

      await clickText(".mt-topbar button", "Проекты");
      check("проекты — окном поверх редактора", await until(`document.querySelectorAll(".mt-overlay .mt-project").length >= 1`));
      await shot("3-projects");
      await call(`document.querySelector(".mt-overlay").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);

      // Тяжёлый исходник (4K HEVC) — предпросмотр идёт с лёгкой копии.
      const ffmpeg = require("ffmpeg-static");
      const { execFileSync } = require("node:child_process");
      const h264 = path.join(appData, "clip-h264.mp4");
      const hevc = path.join(appData, "clip-hevc.mp4");
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30:duration=20", "-f", "lavfi", "-i", "sine=f=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "10M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", h264]);
      execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30:duration=2", "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p", hevc]);
      const id = await call(`(async () => {
        const p = await window.api.montageNormalize({ title: "плавность", canvas: { preset: "9:16", width: 1080, height: 1920, fps: 30 }, clips: [{ src: ${JSON.stringify(h264)}, kind: "video", in: 0, out: 20 }, { src: ${JSON.stringify(hevc)}, kind: "video", in: 0, out: 2 }] });
        const saved = await window.api.montageSave(p);
        await window.api.montageSaveConfig({ lastProject: saved.id });
        return saved.id;
      })()`);
      win.webContents.reload();
      await new Promise((r) => win.webContents.once("did-finish-load", r));
      check("открывается последний проект", await until(`document.querySelector(".mt-title") && document.querySelector(".mt-title").value === "плавность"`));
      await until(`!!document.querySelector(".mt-app-settings")`, 3000);
      await clickText(".mt-app-settings button", "Готово");
      check("для 4K HEVC делается лёгкая копия", await until(`window.api.montageProxy(${JSON.stringify(hevc)}).then(r => r.status === "ready")`, 90000));
      const h264proxy = await call(`window.api.montageProxy(${JSON.stringify(h264)})`);
      check("обычному H.264 копия не нужна", h264proxy.status === "none", JSON.stringify(h264proxy));
      check("полоска кадров на дорожке — из кэша", await until(`document.querySelectorAll(".mt-tl-strip i").length >= 2`, 30000));
      check("файл больше 8 МБ (как длинное видео)", fs.statSync(h264).size > 8 * 1024 * 1024, fs.statSync(h264).size);
      // Перемотка в середину на паузе — кадр должен показаться (раньше длинное видео оставалось чёрным).
      await call(`(() => { const r = document.querySelector(".mt-tl-ruler").getBoundingClientRect(); document.querySelector(".mt-tl-ruler").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + 72 + 7.8 * 40, clientY: r.top + 5 })); })()`);
      check("длинное видео показывает кадр после перемотки", await until(`(() => { const v = document.querySelector(".mt-stage video"); return v && v.readyState >= 2 && v.videoWidth > 0; })()`, 15000), await call(`JSON.stringify([...document.querySelectorAll(".mt-stage video")].map(v => [v.readyState, v.networkState, v.currentTime]))`));
      await call(`document.querySelector(".mt-play").click()`);
      await wait(2500);
      const clock = await call(`document.querySelector(".mt-clock").textContent`);
      const played = Number((clock.match(/(\d+):(\d+)/) || [0, 0, 0])[2]);
      check("воспроизведение идёт", played >= 1, clock);
      await shot("4-playing");
      await call(`document.querySelector(".mt-play").click()`);
      await wait(300);

      // Шрифтовые пары и выбор шрифта.
      await clickText(".mt-rail button", "Текст");
      check("шрифтовые пары — карточками", await until(`document.querySelectorAll(".mt-pair").length >= 12`));
      await call(`document.querySelector(".mt-pair").click()`);
      check("пара легла надписью", await until(`document.querySelectorAll(".mt-tl-text").length >= 1`));
      check("у надписи — выбор шрифта и шрифта акцента", await until(`document.querySelectorAll(".mt-right .mt-font-picker").length >= 2`));
      await call(`document.querySelector(".mt-right .mt-font-current").click()`);
      check("список шрифтов — с кириллическими встроенными", await until(`document.querySelectorAll(".mt-font-pop .mt-font-item").length >= 35`));
      await shot("5-fonts");
      await call(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
      await wait(1200);
      const readOpen = (expr) => call(`window.api.montageConfig().then(c => window.api.montageRead(c.lastProject)).then(p => ${expr})`);
      const textSaved = await readOpen("p.texts[0]");
      check("надпись сохраняется со шрифтами пары", textSaved && /\.ttf$/.test(textSaved.fontPath) && /\.ttf$/.test(textSaved.accentFontPath) && /\*/.test(textSaved.text), JSON.stringify(textSaved));

      // Коррекция и авто-улучшение.
      await call(`document.querySelector(".mt-tl-clip").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
      check("у куска — коррекция изображения", await until(`[...document.querySelectorAll(".mt-right summary")].some(s => s.textContent.includes("Коррекция"))`));
      await call(`[...document.querySelectorAll(".mt-right summary")].find(s => s.textContent.includes("Коррекция")).click()`);
      await clickText(".mt-right button", "Авто-улучшение");
      check("авто-улучшение мерит кадр и ставит ползунки", await until(`document.querySelector(".mt-status") && document.querySelector(".mt-status").textContent.includes("улучшен")`, 20000));
      await shot("6-grade");

      // Водяной знак: обвести — увидеть «после» — сохранить.
      await clickText(".mt-right button", "Убрать водяной знак");
      check("окно удаления знака с кадром", await until(`(() => { const i = document.querySelector(".mt-erase-frame img"); return i && i.naturalWidth > 0; })()`, 20000));
      const drag = (t, x, y) => call(`(() => { const f = document.querySelector(".mt-erase-frame"); const r = f.getBoundingClientRect(); f.dispatchEvent(new MouseEvent(${JSON.stringify(t)}, { bubbles: true, clientX: r.left + r.width * ${x}, clientY: r.top + r.height * ${y} })); })()`);
      // По событию за раз, как рука: между ними окно успевает обновиться.
      await drag("mousedown", 0.6, 0.85);
      await wait(80);
      await drag("mousemove", 0.8, 0.9);
      await wait(80);
      await drag("mousemove", 0.95, 0.95);
      await wait(80);
      await drag("mouseup", 0.95, 0.95);
      check("после обводки показан кадр без знака", await until(`document.querySelectorAll(".mt-erase-item").length === 1 && !document.querySelector(".mt-erase-busy")`, 20000));
      await shot("7-erase");
      await clickText(".mt-erase button", "Готово");
      await wait(1200);
      const erased = await readOpen("p.clips[0].erase");
      check("область знака сохранена в куске", erased && erased.length === 1 && erased[0].x > 0.5 && erased[0].w > 0.2, JSON.stringify(erased));

      // Эффект перетаскиванием на кусок — как в CapCut.
      await clickText(".mt-rail button", "Эффекты");
      await until(`!!document.querySelector(".mt-fx-chip")`);
      const fxBefore = (await readOpen("p.clips[0].effects.length")) || 0;
      await call(`(() => {
        const dt = new DataTransfer();
        document.querySelector(".mt-fx-chip").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
        const c = document.querySelector(".mt-tl-clip");
        c.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
        c.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      })()`);
      await wait(1200);
      check("эффект, брошенный на кусок, применён", (await readOpen("p.clips[0].effects.length")) === fxBefore + 1);

      await clickText(".mt-rail button", "Коллаж");
      check("вкладка коллажа — раскладки экрана", await until(`document.querySelectorAll(".mt-layout").length >= 4`));
      await clickText(".mt-rail button", "Титры");
      check("в титрах — интро, аутро и коллажи", await until(`["Интро", "Аутро", "Коллажи"].every(g => document.querySelector(".mt-left").textContent.includes(g))`, 15000));

      await call(`document.querySelector(".mt-tl-text").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
      check("у надписи — интервал, обводка, тень, выравнивание", await until(`["Межстрочный", "Обводка", "Тень"].every(s => document.querySelector(".mt-right").textContent.includes(s)) && !!document.querySelector(".mt-right .mt-seg")`));
      check("пару можно разгруппировать", await until(`[...document.querySelectorAll(".mt-right button")].some(b => b.textContent.includes("Разгруппировать"))`));
      await shot("8-text-look");

      await clickText(".mt-rail button", "Моушн");
      check("модель для моушна — выбором из списка", await until(`[...document.querySelectorAll(".mt-motion-panel select option")].some(o => /Claude/.test(o.textContent))`));
      void id;
    }
  } catch (e) {
    failures++;
    console.log("  FAIL непойманная ошибка —", e && e.stack ? e.stack : e);
  } finally {
    console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
    fs.rmSync(appData, { recursive: true, force: true });
    finish(failures, (c) => app.exit(c));
  }
});
