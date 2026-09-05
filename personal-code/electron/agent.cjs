// The coding agent.
//
// Two kinds of model action, deliberately treated differently:
//
//   - Read-only tools (list, read, search, git status/diff) run immediately and
//     their output is fed straight back into the conversation. Nothing on disk
//     changes, so asking permission each time would only be noise.
//   - Anything that writes — editing a file, creating, deleting, renaming, or
//     running a command — is parsed into a proposal, shown with a real diff, and
//     only touches the disk after the person presses "Применить".
//
// This is the same propose-then-confirm rule the chat app uses, and it is what
// makes it safe to point the agent at a folder of real work.

const { execFile } = require("node:child_process");
const workspace = require("./workspace.cjs");
const git = require("./git.cjs");

const TOOL_ROUND_LIMIT = 8;
// How much file content a single READ may put into the conversation.
const MAX_READ_CHARS = 60_000;
const MAX_TOOL_OUTPUT = 40_000;

const SYSTEM_PROMPT = `Ты — инженер-программист, работающий внутри десктопного приложения «Личный код».
Ты видишь папку проекта на компьютере пользователя и можешь читать её и предлагать правки.

ЯЗЫК: отвечай по-русски. Код, имена файлов и команды — как есть.

КАК ТЫ РАБОТАЕШЬ
1. Сначала разберись в коде: прочитай нужные файлы, не догадывайся.
2. Потом предложи правку. Минимальную — только то, что решает задачу.
3. Не придумывай файлы и функции, которых не видел. Если чего-то не хватает — прочитай или спроси.

ИНСТРУМЕНТЫ ЧТЕНИЯ
Чтобы что-то посмотреть, выведи блок и ЗАКОНЧИ на нём ответ — результат придёт следующим сообщением:

===TOOL===
READ: путь/к/файлу.ts
LIST: путь/к/папке
SEARCH: искомый текст
GIT: status
GIT: diff
===END TOOL===

В одном блоке можно запросить несколько строк. READ можно ограничить строками: READ: файл.ts:120-260

ПРАВКИ ФАЙЛОВ
Когда готов менять код, выведи блок правок. Он НЕ применяется сам — человек подтверждает его вручную.

===CODE EDIT START===
FILE: путь/к/файлу.ts
ACTION: replace
<<<<<<< НАЙТИ
точный фрагмент существующего кода
=======
новый код
>>>>>>> ЗАМЕНИТЬ
===CODE EDIT END===

ACTION бывает:
  replace — заменить фрагмент. Фрагмент в «НАЙТИ» должен совпадать с файлом ДОСЛОВНО,
            вместе с отступами, и встречаться в файле ровно один раз. Это основной способ.
            Пар «НАЙТИ/ЗАМЕНИТЬ» в одном FILE может быть несколько подряд.
  write   — записать файл целиком (новый файл или полная перезапись):
            FILE: путь.ts
            ACTION: write
            ===CONTENT===
            содержимое файла
            ===END CONTENT===
  delete  — удалить файл
  rename  — переименовать/переместить, вторая строка: TO: новый/путь.ts

В одном блоке ===CODE EDIT START=== можно менять несколько файлов подряд.
Перед блоком коротко напиши, что меняешь и зачем.

КОМАНДЫ
Если нужно что-то запустить (тесты, сборку, установку пакета):

===RUN START===
npm test
===RUN END===

Команда тоже не выполняется сама — человек подтверждает. Одна команда на блок.

ЧЕГО НЕ ДЕЛАТЬ
— Не выводи блок правок и блок инструментов в одном ответе.
— Не пиши комментарии, объясняющие очевидное, и не оставляй пометок вида «// добавлено».
— Не трогай файлы за пределами папки проекта.
— Не вставляй в код ключи, токены и пароли.`;

// ---------- context ----------

/**
 * The project map the agent starts from: the file list, the git branch, and
 * whatever file is open in the editor. Kept small on purpose — a full dump of a
 * large repository would crowd out the actual conversation.
 */
async function buildContext(root, { openFile = null, fileLimit = 1200 } = {}) {
  const parts = [];
  parts.push(`Папка проекта: ${root}`);

  try {
    const files = await workspace.listTextFiles(root, fileLimit);
    const shown = files.slice(0, fileLimit);
    parts.push(
      `\nФайлы проекта (${files.length}${files.length > shown.length ? ", показаны первые " + shown.length : ""}):\n` +
        shown.join("\n")
    );
  } catch (e) {
    parts.push(`\nНе удалось перечислить файлы: ${e.message}`);
  }

  if (git.isRepo(root)) {
    try {
      const st = await git.status(root);
      const changed = st.files.slice(0, 40).map((f) => `  ${f.untracked ? "новый" : "изменён"} ${f.path}`);
      parts.push(
        `\nGit: ветка ${st.branch}${st.upstream ? ` → ${st.upstream}` : ""}, изменений: ${st.files.length}` +
          (changed.length ? "\n" + changed.join("\n") : "")
      );
    } catch {
      /* a broken or empty repo shouldn't block the conversation */
    }
  }

  if (openFile) {
    try {
      const file = await workspace.readFile(root, openFile);
      const body = file.content.slice(0, MAX_READ_CHARS);
      parts.push(
        `\nОткрытый сейчас файл ${openFile}:\n\`\`\`\n${body}\n\`\`\`` +
          (file.content.length > body.length ? "\n[файл обрезан]" : "")
      );
    } catch {
      /* the file may have been deleted between opening and asking */
    }
  }

  return parts.join("\n");
}

// ---------- read-only tools ----------

function parseToolBlock(text) {
  const match = text.match(/===TOOL===\s*([\s\S]*?)===END TOOL===/);
  if (!match) return null;
  const calls = [];
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const name = line.slice(0, sep).trim().toUpperCase();
    const arg = line.slice(sep + 1).trim();
    if (["READ", "LIST", "SEARCH", "GIT"].includes(name)) calls.push({ name, arg });
  }
  return calls.length ? calls : null;
}

async function runReadTool(root, call) {
  if (call.name === "READ") {
    // "file.ts:120-260" narrows a long file to the interesting part.
    const range = call.arg.match(/^(.*?):(\d+)-(\d+)$/);
    const rel = range ? range[1] : call.arg;
    const file = await workspace.readFile(root, rel);
    let body = file.content;
    let header = `Файл ${rel}`;
    if (range) {
      const from = Math.max(1, Number(range[2]));
      const to = Math.max(from, Number(range[3]));
      body = file.content.split("\n").slice(from - 1, to).join("\n");
      header += `, строки ${from}-${to}`;
    }
    if (body.length > MAX_READ_CHARS) {
      body = body.slice(0, MAX_READ_CHARS);
      header += " [обрезан]";
    }
    return `${header}:\n\`\`\`\n${body}\n\`\`\``;
  }

  if (call.name === "LIST") {
    const files = await workspace.listTextFiles(root);
    const prefix = call.arg.replace(/^\/+|\/+$/g, "");
    const filtered = prefix ? files.filter((f) => f.startsWith(prefix + "/") || f === prefix) : files;
    return `Файлы в «${prefix || "."}» (${filtered.length}):\n${filtered.slice(0, 500).join("\n")}`;
  }

  if (call.name === "SEARCH") {
    const { matches, truncated } = await workspace.search(root, call.arg);
    if (!matches.length) return `Поиск «${call.arg}»: ничего не найдено.`;
    const rows = matches.map((m) => `${m.path}:${m.line}: ${m.text.trim()}`);
    return `Поиск «${call.arg}» (${matches.length}${truncated ? "+" : ""}):\n${rows.join("\n")}`;
  }

  if (call.name === "GIT") {
    const what = call.arg.toLowerCase();
    if (what.startsWith("diff")) {
      const out = await git.diff(root, {});
      return out.trim() ? `git diff:\n\`\`\`diff\n${out.slice(0, MAX_TOOL_OUTPUT)}\n\`\`\`` : "git diff: изменений нет.";
    }
    const st = await git.status(root);
    if (!st.isRepo) return "В этой папке нет git-репозитория.";
    const rows = st.files.map((f) => `${f.untracked ? "??" : f.indexStatus + f.worktreeStatus} ${f.path}`);
    return `git status: ветка ${st.branch}\n${rows.join("\n") || "рабочая копия чистая"}`;
  }

  return `Неизвестный инструмент: ${call.name}`;
}

async function runReadTools(root, text) {
  const calls = parseToolBlock(text);
  if (!calls) return null;
  const outputs = [];
  for (const call of calls) {
    try {
      outputs.push(await runReadTool(root, call));
    } catch (e) {
      outputs.push(`${call.name}: ${call.arg} — ошибка: ${e.message}`);
    }
  }
  let joined = outputs.join("\n\n");
  if (joined.length > MAX_TOOL_OUTPUT) joined = joined.slice(0, MAX_TOOL_OUTPUT) + "\n[вывод обрезан]";
  return `Результат запроса:\n\n${joined}`;
}

// ---------- edit proposals ----------

/**
 * Parses a ===CODE EDIT START=== block into a list of per-file operations.
 * Malformed blocks throw with a message the agent can be told about, rather
 * than being half-applied.
 */
function parseEditBlock(text) {
  const match = text.match(/===CODE EDIT START===\s*\n([\s\S]*?)===CODE EDIT END===/);
  if (!match) return null;

  const lines = match[1].split("\n");
  const operations = [];
  let current = null;
  let i = 0;

  const flush = () => {
    if (current) operations.push(current);
    current = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fileMatch = line.match(/^FILE:\s*(.+?)\s*$/);
    if (fileMatch) {
      flush();
      current = { path: fileMatch[1], action: "", edits: [] };
      i++;
      continue;
    }
    if (!current) {
      i++;
      continue;
    }

    const actionMatch = line.match(/^ACTION:\s*(\w+)\s*$/i);
    if (actionMatch) {
      current.action = actionMatch[1].toLowerCase();
      i++;
      continue;
    }

    const toMatch = line.match(/^TO:\s*(.+?)\s*$/);
    if (toMatch) {
      current.to = toMatch[1];
      i++;
      continue;
    }

    if (/^===CONTENT===\s*$/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^===END CONTENT===\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i >= lines.length) throw new Error(`Для файла «${current.path}» не закрыт блок ===CONTENT===.`);
      i++;
      current.content = body.join("\n");
      continue;
    }

    // <<<<<<< НАЙТИ ... ======= ... >>>>>>> ЗАМЕНИТЬ (English keywords accepted too)
    if (/^<{5,}\s*(НАЙТИ|FIND|SEARCH)?\s*$/i.test(line)) {
      const find = [];
      i++;
      while (i < lines.length && !/^={5,}\s*$/.test(lines[i])) {
        find.push(lines[i]);
        i++;
      }
      if (i >= lines.length) throw new Error(`Для файла «${current.path}» не найден разделитель «=======».`);
      i++;
      const replace = [];
      while (i < lines.length && !/^>{5,}\s*(ЗАМЕНИТЬ|REPLACE)?\s*$/i.test(lines[i])) {
        replace.push(lines[i]);
        i++;
      }
      if (i >= lines.length) throw new Error(`Для файла «${current.path}» не закрыт блок замены.`);
      i++;
      current.edits.push({ find: find.join("\n"), replace: replace.join("\n") });
      continue;
    }

    i++;
  }
  flush();

  if (!operations.length) return null;

  for (const op of operations) {
    if (!op.action) op.action = op.edits.length ? "replace" : op.content != null ? "write" : "";
    if (!["replace", "write", "delete", "rename"].includes(op.action)) {
      throw new Error(`Неизвестное действие «${op.action}» для файла «${op.path}».`);
    }
    if (op.action === "replace" && !op.edits.length) {
      throw new Error(`Для «${op.path}» указано replace, но нет ни одной пары НАЙТИ/ЗАМЕНИТЬ.`);
    }
    if (op.action === "write" && op.content == null) {
      throw new Error(`Для «${op.path}» указано write, но нет блока ===CONTENT===.`);
    }
    if (op.action === "rename" && !op.to) {
      throw new Error(`Для «${op.path}» указано rename, но не указан TO:.`);
    }
  }
  return operations;
}

/** Applies one operation in memory and reports what the file would become. */
async function previewOperation(root, op) {
  // Check the path before anything else. The individual branches below swallow
  // read failures (a new file legitimately has nothing to read), which would
  // otherwise hide a traversal attempt until apply time.
  workspace.resolveInside(root, op.path);
  if (op.to) workspace.resolveInside(root, op.to);

  if (op.action === "delete") {
    let before = "";
    try {
      before = (await workspace.readFile(root, op.path)).content;
    } catch {
      throw new Error(`Файл «${op.path}» не найден — удалять нечего.`);
    }
    return { ...op, before, after: null, exists: true };
  }

  if (op.action === "rename") {
    await workspace.readFile(root, op.path);
    return { ...op, before: null, after: null, exists: true };
  }

  if (op.action === "write") {
    let before = null;
    try {
      before = (await workspace.readFile(root, op.path)).content;
    } catch {
      before = null; // new file
    }
    return { ...op, before, after: op.content, exists: before !== null };
  }

  // replace
  const file = await workspace.readFile(root, op.path);
  let text = file.content;
  for (const [index, edit] of op.edits.entries()) {
    if (!edit.find) throw new Error(`Пустой фрагмент «НАЙТИ» в правке ${index + 1} файла «${op.path}».`);
    const occurrences = text.split(edit.find).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `В файле «${op.path}» не найден фрагмент из правки ${index + 1}. Он должен совпадать дословно, вместе с отступами.`
      );
    }
    if (occurrences > 1) {
      throw new Error(
        `В файле «${op.path}» фрагмент из правки ${index + 1} встречается ${occurrences} раза — нужен уникальный фрагмент.`
      );
    }
    text = text.replace(edit.find, () => edit.replace);
  }
  return { ...op, before: file.content, after: text, exists: true };
}

/** Line-level diff (LCS) for the confirmation view. */
function diffLines(before, after) {
  const a = (before ?? "").split("\n");
  const b = (after ?? "").split("\n");
  // Guard: the DP table is |a|*|b| cells, which is fine for source files but not
  // for a generated bundle. Beyond the cap, show the change as a wholesale swap.
  if (a.length * b.length > 4_000_000) {
    return [
      ...a.map((text) => ({ type: "del", text })),
      ...b.map((text) => ({ type: "add", text })),
    ];
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < a.length) rows.push({ type: "del", text: a[i++] });
  while (j < b.length) rows.push({ type: "add", text: b[j++] });
  return rows;
}

/** Drops long runs of unchanged lines so the diff view shows the change, not the file. */
function collapseDiff(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (skipped) {
        out.push({ type: "gap", text: `… ${skipped} строк без изменений …` });
        skipped = 0;
      }
      out.push(row);
    } else {
      skipped++;
    }
  });
  if (skipped) out.push({ type: "gap", text: `… ${skipped} строк без изменений …` });
  return out;
}

/**
 * Turns a model reply into a reviewable proposal: every operation resolved
 * against the real files, with a diff, before anything is written.
 */
async function buildProposal(root, text) {
  const operations = parseEditBlock(text);
  if (!operations) return null;
  const files = [];
  for (const op of operations) {
    const resolved = await previewOperation(root, op);
    files.push({
      path: resolved.path,
      to: resolved.to || null,
      action: resolved.action,
      isNew: resolved.action === "write" && !resolved.exists,
      before: resolved.before,
      after: resolved.after,
      diff:
        resolved.action === "rename"
          ? []
          : collapseDiff(diffLines(resolved.before, resolved.after)),
    });
  }
  return { id: `edit-${Date.now()}`, files };
}

/** Current content of a workspace file, or null when it is not there. */
async function currentContent(root, rel) {
  try {
    return (await workspace.readFile(root, rel)).content;
  } catch {
    return null;
  }
}

/**
 * Refuses a proposal whose files no longer look the way they did when the diff
 * was shown. A proposal is a snapshot: between "показать" and "Применить" the
 * person may have typed in the editor, saved, pulled, or switched branches, and
 * writing `after` — a whole file rebuilt from the old content — would silently
 * throw those changes away. Better to say so and let the agent look again.
 */
async function assertStillMatches(root, file) {
  const stale = (what) =>
    new Error(
      `Файл «${file.path}» ${what} после того, как правка была показана. ` +
        "Она не применена — попросите агента посмотреть файл заново."
    );

  if (file.action === "rename") {
    if ((await currentContent(root, file.path)) === null) throw stale("исчез или стал нечитаемым");
    if ((await currentContent(root, file.to)) !== null) {
      throw new Error(`«${file.to}» уже существует — переименование не применено.`);
    }
    return;
  }

  const now = await currentContent(root, file.path);
  if (file.isNew) {
    if (now !== null) throw new Error(`Файл «${file.path}» уже появился — правка не применена.`);
    return;
  }
  if (now === null) throw stale("исчез или стал нечитаемым");
  if (now !== file.before) throw stale("изменился на диске");
}

/**
 * Writes an already-reviewed proposal to disk. Everything is checked before the
 * first write, so a proposal that has gone stale in one file does not leave the
 * project half-edited.
 */
async function applyProposal(root, proposal) {
  for (const file of proposal.files) await assertStillMatches(root, file);

  const applied = [];
  for (const file of proposal.files) {
    if (file.action === "delete") await workspace.deletePath(root, file.path);
    else if (file.action === "rename") await workspace.renamePath(root, file.path, file.to);
    else await workspace.writeFile(root, file.path, file.after ?? "");
    applied.push({ path: file.path, action: file.action, to: file.to || null });
  }
  return applied;
}

// ---------- commands ----------

function parseRunBlock(text) {
  const match = text.match(/===RUN START===\s*\n([\s\S]*?)===RUN END===/);
  if (!match) return null;
  const command = match[1].trim();
  return command ? { id: `run-${Date.now()}`, command } : null;
}

/**
 * Runs a confirmed command in the workspace. The command string is what the
 * person read and approved, so it is executed through a shell as typed — the
 * confirmation step, not string escaping, is what makes this safe.
 */
function runCommand(root, command, timeout = 300_000) {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
    const args = isWindows ? ["/d", "/s", "/c", command] : ["-c", command];
    execFile(shell, args, { cwd: root, timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      resolve({
        ok: !err,
        code: err?.code ?? 0,
        timedOut: Boolean(err?.killed),
        output: output.slice(0, MAX_TOOL_OUTPUT) || (err ? String(err.message) : "(нет вывода)"),
      });
    });
  });
}

module.exports = {
  SYSTEM_PROMPT,
  TOOL_ROUND_LIMIT,
  buildContext,
  parseToolBlock,
  runReadTools,
  parseEditBlock,
  diffLines,
  collapseDiff,
  buildProposal,
  applyProposal,
  parseRunBlock,
  runCommand,
};
