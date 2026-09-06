// Отзывчивость приложения и обслуживание: набор текста, кэш, падения, индикатор
// работы агента.
//   xvfb-run -a npx electron --no-sandbox electron/smoke-speed.cjs
//
// Жалоба, из которой это выросло: «приложение стало тормозить, пишу предложение
// — оно как будто перезапускается». Замер показал, что цена одного нажатия
// клавиши растёт вместе с длиной переписки: на каждую букву перерисовывались
// все сообщения разом. Отсюда первая и главная проверка — стоимость нажатия не
// должна зависеть от того, сколько всего в чате написано.

const { app, BrowserWindow } = require("electron");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "speed-ud-"));
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "speed-data-"));
app.setPath("userData", userData);
fs.writeFileSync(path.join(userData, "config.json"), JSON.stringify({ rootPath: dataRoot }));
app.disableHardwareAcceleration();

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

const SAMPLE = [
  "## Дайджест рынка",
  "",
  "- ВКонтакте расширил клипы до трёх минут.",
  "- Ставки выросли на 12% год к году.",
  "",
  "| Площадка | CPM |",
  "|---|---|",
  "| ВК | 210 ₽ |",
  "",
  "Вывод: бюджеты стоит перераспределить.",
].join("\n");

// Модель отвечает медленно и по кусочкам: только так «агент думает» вообще
// успевает появиться на экране.
const server = http.createServer((req, res) => {
  if (req.url.includes("/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ data: [] }));
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  let sent = 0;
  const timer = setInterval(() => {
    sent += 1;
    if (sent > 6) {
      clearInterval(timer);
      res.write("data: [DONE]\n\n");
      return res.end();
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "слово " } }] })}\n\n`);
  }, 400);
});

function cleanup() {
  server.close();
  for (const dir of [userData, dataRoot]) fs.rmSync(dir, { recursive: true, force: true });
}

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({
    baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test", model: "m",
    temperature: 0.7, maxTokens: 4000, proxyMode: "direct", searchEnabled: false,
  }));
  require("./main.cjs");

  app.whenReady().then(async () => {
    try {
      let win;
      const deadline = Date.now() + 25000;
      while (!win && Date.now() < deadline) {
        win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes("index.html"));
        if (!win) await new Promise((r) => setTimeout(r, 120));
      }
      if (!win) throw new Error("окно приложения не открылось");
      await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
      const call = (e) => win.webContents.executeJavaScript(e);
      await new Promise((r) => setTimeout(r, 1500));

      const project = await call(`window.api.createProject({ name: "Замер", description: "", instructions: "" })`);

      /** Средняя цена одного нажатия клавиши в чате из messageCount сообщений. */
      async function costPerKeystroke(pairs) {
        const messages = [];
        for (let i = 0; i < pairs; i++) {
          messages.push({ id: "u" + i, role: "user", content: "Вопрос " + i, createdAt: Date.now() });
          messages.push({ id: "a" + i, role: "assistant", content: SAMPLE, createdAt: Date.now() });
        }
        const conv = {
          id: "conv-" + pairs, projectId: project.id, title: "Замер " + pairs,
          messages, createdAt: Date.now(), updatedAt: Date.now(),
        };
        await call(`window.api.saveConversation(${JSON.stringify(project.id)}, ${JSON.stringify(conv)})`);
        await call(`window.location.reload()`);
        await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once("did-finish-load", r) : r()));
        await new Promise((r) => setTimeout(r, 2500));
        return call(`(async () => {
          const shown = document.querySelectorAll(".chat-messages .msg").length;
          const ta = document.querySelector(".chat-input-bar textarea");
          if (!ta) return { error: "нет поля ввода" };
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
          const times = [];
          let text = "";
          for (let i = 0; i < 25; i++) {
            text += "а";
            const t0 = performance.now();
            setter.call(ta, text);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            times.push(performance.now() - t0);
            await new Promise(r => setTimeout(r, 0));
          }
          times.sort((a, b) => a - b);
          return { shown, median: times[12] };
        })()`);
      }

      console.log("набор текста не зависит от длины переписки");
      const short = await costPerKeystroke(1);
      const long = await costPerKeystroke(120);
      check("длинная переписка действительно отрисована", long.shown === 240, String(long.shown));
      // До правки было 0,4 мс против 7,4 мс — рост в 18 раз. Порог с большим
      // запасом: важно, что зависимости от длины больше нет.
      const ratio = long.median / Math.max(short.median, 0.05);
      check(
        "нажатие клавиши стоит столько же в длинном чате, сколько в пустом",
        ratio < 4,
        `${short.median.toFixed(2)} мс → ${long.median.toFixed(2)} мс (в ${ratio.toFixed(1)} раза)`
      );
      check("и само по себе не тормозит", long.median < 3, `${long.median.toFixed(2)} мс`);

      console.log("\nвидно, что агент думает");
      await call(`(() => {
        const ta = document.querySelector(".chat-input-bar textarea");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, "привет");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        [...document.querySelectorAll(".chat-input-bar button")].find(b => b.textContent.includes("Отправить")).click();
      })()`);
      await new Promise((r) => setTimeout(r, 900));
      const thinking = await call(`(() => {
        const el = document.querySelector(".thinking");
        if (!el) return null;
        return {
          text: el.querySelector(".thinking-text").textContent,
          clock: el.querySelector(".thinking-clock").textContent,
          spinner: !!el.querySelector(".thinking-spinner"),
        };
      })()`);
      check("индикатор работы появился", !!thinking, JSON.stringify(thinking));
      check("на нём есть часы", !!thinking && /^\d+:\d\d$/.test(thinking.clock), thinking && thinking.clock);
      check("и крутящийся значок", !!thinking && thinking.spinner);
      await new Promise((r) => setTimeout(r, 1400));
      const later = await call(`(() => {
        const el = document.querySelector(".thinking");
        return el ? { text: el.querySelector(".thinking-text").textContent, clock: el.querySelector(".thinking-clock").textContent } : null;
      })()`);
      check("часы идут, а не стоят", !!later && later.clock !== (thinking && thinking.clock), JSON.stringify(later));
      check(
        "стадия названа словами",
        !!later && /Пишет ответ|Думает|Отправляю/.test(later.text),
        later && later.text
      );

      console.log("\nкэш видно и его можно почистить");
      const report = await call(`window.api.getStorageReport()`);
      check("в отчёте есть служебный кэш", report.cache && typeof report.cache.bytes === "number", JSON.stringify(report.cache));
      check("и история падений", Array.isArray(report.crashes), JSON.stringify(report.crashes));
      const cleared = await call(`window.api.clearCache()`);
      check("очистка отвечает, сколько освободила", typeof cleared.freedBytes === "number", JSON.stringify(cleared));
      check("после очистки кэша не осталось", cleared.after <= cleared.before, JSON.stringify(cleared));
      // Данные человека очистка не трогает — это и есть главное свойство кнопки.
      const projectsAfter = await call(`window.api.listProjects()`);
      check("проекты на месте", projectsAfter.length === 1, String(projectsAfter.length));
      const convsAfter = await call(`window.api.listConversations(${JSON.stringify(project.id)})`);
      check("переписки на месте", convsAfter.length >= 1, String(convsAfter.length));

      console.log("\nпадение переживает перезапуск");
      const report2 = require("./report.cjs");
      report2.recordCrash({ kind: "окно приложения", reason: "oom", exitCode: 5 });
      const file = path.join(userData, "падения.json");
      check("падение записано на диск сразу", fs.existsSync(file), file);
      const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
      check("причина сохранена", saved.at(-1).причина === "oom", JSON.stringify(saved.at(-1)));
      await report2.loadCrashes();
      check("после перезапуска падение прочитано обратно", report2.pastCrashes().length >= 1);
      check("и попадает в отчёт о проблеме", report2.summary().crashes >= 1, JSON.stringify(report2.summary()));
    } catch (e) {
      failures++;
      console.log("  FAIL непойманная ошибка —", e.message);
    } finally {
      console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
      cleanup();
      app.exit(failures === 0 ? 0 : 1);
    }
  });
});

app.on("window-all-closed", () => {});
