// Управляемая сборка: предустановленный ключ, учёт расхода и предустановленные
// навыки.
//   node electron/smoke-managed.cjs
//
// Отдельно проверяется то, что легко сделать неправильно и незаметно:
//   - оценочный расход не должен выдаваться за точный;
//   - итоговая сумма не должна показываться, если для части моделей нет цены;
//   - текст предустановленного навыка не должен уходить в окно приложения.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");

const usage = require("./usage.cjs");
const managed = require("./managed.cjs");
const bundledSkills = require("./bundledSkills.cjs");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "managed-ud-"));
const configFile = path.join(__dirname, "..", "managed-config.json");
const skillsDir = path.join(__dirname, "..", "bundled-skills");
const hadConfig = fs.existsSync(configFile);
const previousConfig = hadConfig ? fs.readFileSync(configFile, "utf-8") : null;
const hadSkills = fs.existsSync(skillsDir);

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
}

function cleanup() {
  if (hadConfig) fs.writeFileSync(configFile, previousConfig);
  else fs.rmSync(configFile, { force: true });
  if (!hadSkills) fs.rmSync(skillsDir, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
}

(async () => {
  usage.init(userData);

  console.log("\nобычная сборка");
  fs.rmSync(configFile, { force: true });
  const plain = managed.apply({ apiKey: "мой-ключ", baseUrl: "https://polza.ai/api/v1", model: "m" });
  check("без файла настроек сборка не управляемая", plain.managed === false, JSON.stringify(plain));
  check("ключ пользователя не тронут", plain.apiKey === "мой-ключ");

  console.log("\nуправляемая сборка");
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      apiKey: "ключ-автора",
      baseUrl: "https://polza.ai/api/v1",
      model: "anthropic/claude-sonnet-5",
      currency: "₽",
      prices: { "anthropic/claude-sonnet-5": { input: 300, output: 1500 } },
    })
  );
  const overlaid = managed.apply({ apiKey: "", baseUrl: "", model: "" });
  check("ключ подставлен из сборки", overlaid.apiKey === "ключ-автора");
  check("сборка помечена как управляемая", overlaid.managed === true);
  const kept = managed.apply({ apiKey: "", baseUrl: "", model: "openai/gpt-5" });
  check("выбранная пользователем модель не сбрасывается", kept.model === "openai/gpt-5", kept.model);

  console.log("\nучёт расхода");
  await usage.record({ model: "anthropic/claude-sonnet-5", promptTokens: 1000, completionTokens: 2000, exact: true, source: "чат" });
  await usage.record({ model: "anthropic/claude-sonnet-5", promptTokens: 500, completionTokens: 100, exact: true, source: "фон" });

  let day = await usage.summary("day", managed.prices());
  check("записи попали в сводку за день", day.totals.calls === 2, JSON.stringify(day.totals));
  check("токены просуммированы", day.totals.tokens === 3600, String(day.totals.tokens));
  // 1500 входящих по 300 ₽/млн + 2100 исходящих по 1500 ₽/млн
  const expected = (1500 / 1e6) * 300 + (2100 / 1e6) * 1500;
  check("стоимость посчитана по заданным ценам", Math.abs(day.totals.cost - expected) < 1e-9, `${day.totals.cost} ≠ ${expected}`);
  check("расход помечен как точный", day.totals.estimated === false);

  await usage.record({ model: "другая/модель", promptTokens: 100, completionTokens: 100, exact: false, source: "чат" });
  day = await usage.summary("day", managed.prices());
  check("модель без цены не получает выдуманную стоимость", day.models.find((m) => m.model === "другая/модель").cost === null);
  check("итог без части цен не показывается", day.totals.cost === null, String(day.totals.cost));
  check("наличие оценки помечено", day.totals.estimated === true);

  const week = await usage.summary("week", managed.prices());
  const month = await usage.summary("month", managed.prices());
  check("неделя включает сегодняшние записи", week.totals.calls === 3, JSON.stringify(week.totals));
  check("месяц включает сегодняшние записи", month.totals.calls === 3, JSON.stringify(month.totals));
  check("начало недели не позже начала дня", new Date(week.from) <= new Date(day.from));
  check("начало месяца не позже начала недели", new Date(month.from) <= new Date(week.from));

  check("нулевая запись не сохраняется", (await usage.record({ model: "x", promptTokens: 0, completionTokens: 0 })) === null);
  check("оценка по длине считает хоть что-то", usage.estimateTokens("привет мир") > 0);

  console.log("\nпредустановленные навыки");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "copywriter.json"),
    JSON.stringify({ name: "Копирайтер", description: "Тексты для ВК", content: "СЕКРЕТНАЯ МЕТОДИКА" })
  );
  fs.writeFileSync(path.join(skillsDir, "broken.json"), "{ это не json");

  const loaded = await bundledSkills.load();
  check("навык загружен", loaded.length === 1 && loaded[0].name === "Копирайтер", JSON.stringify(loaded));
  check("испорченный файл пропущен, а не уронил загрузку", loaded.length === 1);
  check("текст доступен внутри приложения", loaded[0].content === "СЕКРЕТНАЯ МЕТОДИКА");
  check("id помечен префиксом", bundledSkills.isBundled(loaded[0].id), loaded[0].id);

  const forWindow = bundledSkills.stripForRenderer([...loaded, { id: "мой", name: "Мой", content: "видно" }]);
  check("текст предустановленного навыка в окно не уходит", forWindow[0].content === "");
  check("название и описание остаются видны", forWindow[0].name === "Копирайтер" && forWindow[0].description === "Тексты для ВК");
  check("помечено, что текст скрыт", forWindow[0].contentHidden === true);
  check("собственный навык пользователя виден целиком", forWindow[1].content === "видно");
  check(
    "секретный текст не попал в то, что уходит в окно",
    !JSON.stringify(forWindow).includes("СЕКРЕТНАЯ МЕТОДИКА"),
    JSON.stringify(forWindow)
  );

  console.log(failures === 0 ? "\nВсе проверки пройдены." : `\nПровалено проверок: ${failures}`);
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Тест упал:", e);
  cleanup();
  process.exit(1);
});
