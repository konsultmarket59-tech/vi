// Референсы в промпте: «@имя — сделай с этим вот что».
//
// Зачем так, а не «прикрепить картинку».
//
// Одна прикреплённая картинка отвечает на вопрос «на что похоже». Но работа
// устроена иначе: вот фасад дома, вот логотип, вот текст, который должен быть
// на макете, — и про КАЖДЫЙ надо сказать своё. «Возьми ракурс с @фасад,
// плашку с @логотип, а написать надо @заголовок». Пока референс один и
// безымянный, объяснить это невозможно: модель не знает, к чему относится
// какое указание.
//
// Поэтому у каждого референса есть имя, а в промпте он зовётся по имени.
// Приложение перед отправкой разворачивает имена: картинки нумерует и
// подставляет ссылку «reference image 2», текстовые вставляет прямо в промпт
// в кавычках. Модель получает связный текст, а не набор вложений без подписей.
//
// Референсом может быть и текст: «что должно быть написано в макете» — это не
// картинка и не описание стиля, а буквальное содержимое, и оно должно доехать
// до модели дословно.

const path = require("node:path");

const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".svg"];

/**
 * Имя, которым референс зовут в промпте.
 *
 * Пробелы заменяются подчёркиванием: `@фасад дома` разобрать нельзя — непонятно,
 * где кончается имя и начинается указание. Одинаковые имена разводятся цифрой,
 * иначе два разных референса отзывались бы на одно обращение.
 */
function slugName(raw, taken = []) {
  let base = String(raw || "")
    .trim()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^\wа-яёА-ЯЁ-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) base = "референс";
  let name = base;
  let n = 2;
  while (taken.includes(name)) name = `${base}_${n++}`;
  return name;
}

function isImage(file) {
  return IMAGE_EXT.includes(path.extname(String(file || "")).toLowerCase());
}

/** Референс из файла: картинка — вложением, текст — содержимым. */
function fromFile(filePath, taken = []) {
  const base = path.basename(String(filePath || ""));
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: isImage(filePath) ? "image" : "text",
    name: slugName(base, taken),
    path: filePath,
    file: base,
    text: "",
  };
}

/** Референс, набранный руками: то, что должно быть написано в макете. */
function fromText(name, text, taken = []) {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "text",
    name: slugName(name || "текст", taken),
    path: "",
    file: "",
    text: String(text || ""),
  };
}

/** Обращения вида `@имя`, найденные в промпте, в порядке появления. */
function findMentions(prompt, references = []) {
  const body = String(prompt || "");
  const names = references.map((r) => r.name).sort((a, b) => b.length - a.length);
  const found = [];
  // Длинные имена ищутся первыми: иначе `@фасад` съел бы начало `@фасад_2`.
  const re = /@([\wа-яёА-ЯЁ-]+)/gi;
  for (const m of body.matchAll(re)) {
    const whole = m[1];
    const hit = names.find((n) => whole.toLowerCase() === n.toLowerCase()) ||
      names.find((n) => whole.toLowerCase().startsWith(n.toLowerCase()));
    found.push({ at: m.index, raw: m[0], name: hit || whole, known: !!hit });
  }
  return found;
}

/**
 * Промпт с развёрнутыми обращениями.
 *
 * Картинки нумеруются в том порядке, в каком впервые упомянуты, — так номер в
 * тексте совпадает с порядком вложений, и модель не путает, о какой речь.
 * Неизвестное имя не выбрасывается молча: человек, скорее всего, опечатался, и
 * сказать об этом надо до того, как генерация оплачена.
 */
function resolveMentions(prompt, references = []) {
  const body = String(prompt || "");
  const byName = new Map(references.map((r) => [r.name.toLowerCase(), r]));
  const images = [];
  const missing = [];
  const used = [];

  const out = body.replace(/@([\wа-яёА-ЯЁ-]+)/gi, (whole, name) => {
    const ref = byName.get(String(name).toLowerCase());
    if (!ref) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    if (!used.includes(ref.id)) used.push(ref.id);
    if (ref.kind === "image") {
      let at = images.findIndex((x) => x.id === ref.id);
      if (at < 0) {
        images.push(ref);
        at = images.length - 1;
      }
      return `reference image ${at + 1}`;
    }
    // Текстовый референс вставляется дословно и в кавычках: это не описание
    // стиля, а буквальное содержимое, и переписывать его нельзя.
    const text = String(ref.text || "").trim();
    return text ? `"${text}"` : whole;
  });

  // Ни одного обращения, но картинки приложены — отправляем их все: так
  // работал прежний единственный референс, и ломать это привычное поведение
  // из-за появления имён незачем.
  if (!images.length && !used.length) {
    for (const ref of references) if (ref.kind === "image") images.push(ref);
  }

  return { prompt: out.trim(), images, missing, used };
}

/**
 * Короткие команды, набранные прямо в промпте.
 *
 * `/anatomy` в тексте — то же самое, что выбрать команду в списке, только
 * быстрее. Из промпта команда вырезается: её английская строка добавится
 * отдельно, и оставлять в тексте `/anatomy` значило бы отправить модели
 * непонятный ей значок.
 */
function extractCommands(prompt, commands = []) {
  const body = String(prompt || "");
  const ids = new Set(commands.map((c) => c.id.toLowerCase()));
  const found = [];
  const unknown = [];
  // Кириллица ловится нарочно, хотя команд с русскими именами нет: человек
  // набрал косую черту, значит хотел команду, и «такой команды нет» полезнее
  // молчания. Требование пробела перед знаком оставляет в покое пути вида
  // c:/дом и размеры вида 16/9.
  const out = body.replace(/(^|\s)\/([a-zA-Zа-яёА-ЯЁ][\wа-яёА-ЯЁ-]*)/g, (whole, before, name) => {
    const id = String(name).toLowerCase();
    if (!ids.has(id)) {
      if (!unknown.includes(name)) unknown.push(name);
      return whole;
    }
    if (!found.includes(id)) found.push(id);
    return before;
  });
  return { prompt: out.replace(/\s{2,}/g, " ").trim(), commands: found, unknown };
}

/** Сколько картинок реально уедет и чем это грозит. */
function describeImages(images) {
  if (!images.length) return "";
  if (images.length === 1) return "Уйдёт одна картинка-референс.";
  return (
    `Уйдёт картинок-референсов: ${images.length}. ` +
    "Сколько их примет конкретная модель, знает только она: часть моделей берёт " +
    "только первую. Если результат учёл не всё — уберите лишние или разложите на " +
    "несколько генераций."
  );
}

module.exports = {
  IMAGE_EXT,
  slugName,
  isImage,
  fromFile,
  fromText,
  findMentions,
  resolveMentions,
  extractCommands,
  describeImages,
};
