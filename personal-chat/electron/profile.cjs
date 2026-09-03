// Профиль проекта: короткое резюме того, что человек в этот проект внёс.
//
// Зачем. Разделы вроде Word, Excel, визуализации и клининга работают с файлом или
// папкой и о самом человеке не знают ничего — а решения принимают такие, для которых
// это знание нужно: как назвать документ, в какой логике разложить папки, чей это
// вообще бизнес. Раньше этот пробел затыкался примерами в коде, и приложение
// оказывалось «заряжено» одним конкретным бизнесом: у другого человека агент ссылался
// бы на чужие проекты и контрагентов. Теперь контекст берётся ТОЛЬКО из того, что
// человек завёл у себя в проектах.
//
// Почему резюме, а не сами документы. Полная база проекта — это сотни тысяч символов,
// которые оплачиваются на каждом запросе. Резюме — несколько строк, и его достаточно,
// чтобы понимать сферу работы. Пересобирается оно по кнопке, а не само: это отдельный
// запрос к модели, и платить за него молча приложение не должно.

const fs = require("node:fs/promises");
const path = require("node:path");

function profileFile(projectPath) {
  return path.join(projectPath, "profile.json");
}

/**
 * Отпечаток содержимого проекта: по нему видно, что профиль устарел.
 *
 * Считается по инструкциям и по списку документов с размерами — читать сами файлы
 * ради проверки актуальности было бы дороже, чем пересобрать профиль.
 */
function fingerprint(meta, docs) {
  const parts = [
    String(meta?.instructions || "").length,
    String(meta?.description || "").length,
    ...(docs || []).map((d) => `${d.name}:${d.size}`).sort(),
  ];
  return parts.join("|");
}

async function read(projectPath) {
  try {
    return JSON.parse(await fs.readFile(profileFile(projectPath), "utf-8"));
  } catch {
    return null;
  }
}

async function save(projectPath, profile) {
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(profileFile(projectPath), JSON.stringify(profile, null, 2), "utf-8");
  return profile;
}

function isStale(profile, currentFingerprint) {
  if (!profile) return true;
  return profile.fingerprint !== currentFingerprint;
}

const PROFILE_SYNTAX = `Верни ТОЛЬКО JSON, без пояснений до и после, строго такого вида:

{
  "чем_занимается": "<одна фраза: сфера работы человека, как она видна из этого проекта>",
  "о_чём_проект": "<одна-две фразы: что это за проект и зачем он>",
  "ключевые_сущности": ["<клиенты, бренды, площадки, продукты — только те, что реально упомянуты>"],
  "как_принято_называть": "<если из материалов видно принятые правила именования документов и папок — опиши их; иначе пустая строка>",
  "чего_избегать": "<если из инструкций видно, чего человек не любит в работе или ответах — опиши; иначе пустая строка>"
}

Правила:
- Пиши только то, что подтверждается материалами. Ничего не додумывай: пустая строка честнее выдумки.
- Никаких персональных данных сверх того, что нужно для работы: телефоны, паспорта, адреса не переноси.
- Коротко. Это резюме, а не пересказ.`;

/** Запрос на сборку профиля: инструкции проекта, список файлов и начала документов. */
function buildRequestPrompt({ name, description, instructions, docs, samples }) {
  const parts = [
    `Ты составляешь короткое резюме рабочего проекта, чтобы другие разделы приложения понимали
контекст человека, не перечитывая всю его базу знаний.`,
    `\n=== ПРОЕКТ ===\nНазвание: ${name}`,
  ];
  if (description) parts.push(`Описание: ${description}`);
  if (instructions) parts.push(`\nИнструкции проекта:\n${instructions}`);
  if (docs?.length) parts.push(`\nДокументы в проекте:\n${docs.map((d) => `- ${d.name}`).join("\n")}`);
  for (const sample of samples || []) {
    parts.push(`\n--- Начало документа «${sample.name}» ---\n${sample.text}`);
  }
  parts.push("\n" + PROFILE_SYNTAX);
  return parts.join("\n");
}

/** Достаёт JSON из ответа: модель нередко оборачивает его в ```json. */
function parseProfile(text) {
  const raw = String(text || "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = fenced ? fenced[1] : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      чем_занимается: String(parsed.чем_занимается || "").trim(),
      о_чём_проект: String(parsed.о_чём_проект || "").trim(),
      ключевые_сущности: Array.isArray(parsed.ключевые_сущности)
        ? parsed.ключевые_сущности.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
        : [],
      как_принято_называть: String(parsed.как_принято_называть || "").trim(),
      чего_избегать: String(parsed.чего_избегать || "").trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Общий контекст для разделов, у которых своего проекта нет.
 *
 * Отдельная оговорка про «не переноси данные одного проекта в другой» здесь не
 * формальность: именно смешение проектов человек и замечает как «агент опять
 * приплёл не тот бизнес».
 */
function digest(profiles) {
  const filled = (profiles || []).filter((p) => p.profile && (p.profile.о_чём_проект || p.profile.чем_занимается));
  if (filled.length === 0) return "";

  const lines = filled.map((p) => {
    const bits = [p.profile.о_чём_проект || p.profile.чем_занимается];
    if (p.profile.ключевые_сущности?.length) bits.push(`ключевое: ${p.profile.ключевые_сущности.join(", ")}`);
    return `- ${p.name}: ${bits.join(". ")}`;
  });

  const naming = filled.map((p) => p.profile.как_принято_называть).filter(Boolean);

  return (
    "\n\n=== ЧЕМ ЗАНИМАЕТСЯ ЧЕЛОВЕК (из его же проектов) ===\n" +
    "Это краткая справка о проектах пользователя — чтобы ты понимал сферу работы и говорил на её языке.\n" +
    "Не переноси данные одного проекта в задачу по другому и не подставляй эти названия туда, где их не спрашивали.\n" +
    lines.join("\n") +
    (naming.length ? `\nПринятые правила именования: ${naming.join("; ")}` : "")
  );
}

module.exports = {
  read,
  save,
  fingerprint,
  isStale,
  buildRequestPrompt,
  parseProfile,
  digest,
  PROFILE_SYNTAX,
};
