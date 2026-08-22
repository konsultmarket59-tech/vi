export interface ParsedSkillDraft {
  name: string;
  description: string;
  content: string;
}

export function parseSkillDraft(text: string): ParsedSkillDraft | null {
  const match = text.match(/===SKILL START===([\s\S]*?)===SKILL END===/);
  if (!match) return null;
  const block = match[1];
  const nameMatch = block.match(/NAME:\s*(.+)/);
  const descMatch = block.match(/DESCRIPTION:\s*(.+)/);
  const contentMatch = block.match(/CONTENT:\s*([\s\S]*)/);
  if (!nameMatch || !contentMatch) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch?.[1]?.trim() ?? "",
    content: contentMatch[1].trim(),
  };
}

export function uid(): string {
  return crypto.randomUUID();
}

export interface ParsedOpsEdit {
  sheet: string;
  action: "add_row" | "update_row" | "delete_row";
  rowIndex?: number;
  values?: (string | number)[];
}

export function parseOpsEdit(text: string): ParsedOpsEdit | null {
  const match = text.match(/===OPS EDIT START===([\s\S]*?)===OPS EDIT END===/);
  if (!match) return null;
  const block = match[1];
  const sheet = block.match(/SHEET:\s*(.+)/)?.[1]?.trim();
  const action = block.match(/ACTION:\s*(add_row|update_row|delete_row)/)?.[1] as ParsedOpsEdit["action"] | undefined;
  if (!sheet || !action) return null;
  const rowIndexRaw = block.match(/ROW_INDEX:\s*(\d+)/)?.[1];
  const valuesRaw = block.match(/VALUES:\s*(\[[\s\S]*?\])/)?.[1];
  let values: (string | number)[] | undefined;
  if (valuesRaw) {
    try {
      values = JSON.parse(valuesRaw);
    } catch {
      return null;
    }
  }
  if ((action === "add_row" || action === "update_row") && !values) return null;
  if ((action === "update_row" || action === "delete_row") && rowIndexRaw == null) return null;
  return {
    sheet,
    action,
    rowIndex: rowIndexRaw != null ? Number(rowIndexRaw) : undefined,
    values,
  };
}

export interface ParsedMediaRequest {
  type: "image" | "video" | "audio";
  model: string;
  prompt: string;
}

export function parseMediaRequest(text: string): ParsedMediaRequest | null {
  const match = text.match(/===MEDIA GENERATE START===([\s\S]*?)===MEDIA GENERATE END===/);
  if (!match) return null;
  const block = match[1];
  const type = block.match(/TYPE:\s*(image|video|audio)/)?.[1] as ParsedMediaRequest["type"] | undefined;
  const model = block.match(/MODEL:\s*(.+)/)?.[1]?.trim();
  const prompt = block.match(/PROMPT:\s*([\s\S]*?)(?:\n===|$)/)?.[1]?.trim();
  if (!type || !model || !prompt) return null;
  return { type, model, prompt };
}

export const MEDIA_SYNTAX_HINT = `Если пользователь просит сгенерировать изображение, видео или аудио — предложи это строго в формате
(приложение распознает и покажет кнопку «Сгенерировать», сам ты медиа не создаёшь):

===MEDIA GENERATE START===
TYPE: image | video | audio
MODEL: <точный id модели из каталога polza.ai/models, например "seedream-3" для изображений или "google/veo3" для видео>
PROMPT: <промпт для генерации на английском или русском, максимально подробный>
===MEDIA GENERATE END===

Если пользователь не назвал модель — предложи разумную по умолчанию для нужного типа медиа и уточни, что её можно
сменить в настройках.`;

export interface ParsedFileEdit {
  path: string;
  content: string;
}

export function parseFileEdit(text: string): ParsedFileEdit | null {
  const match = text.match(/===FILE EDIT START===([\s\S]*?)===FILE EDIT END===/);
  if (!match) return null;
  const block = match[1];
  const path = block.match(/PATH:\s*(.+)/)?.[1]?.trim();
  const contentMatch = block.match(/CONTENT:\s*([\s\S]*)/);
  if (!path || !contentMatch) return null;
  return { path, content: contentMatch[1].trim() };
}

export const FILE_EDIT_SYNTAX_HINT = `Когда нужно создать или изменить файл в репозитории, предложи это строго в формате (приложение распознает
и покажет кнопку «Применить и закоммитить» — сам ты ничего не коммитишь):

===FILE EDIT START===
PATH: <путь файла относительно корня репозитория, например src/App.tsx>
CONTENT:
<ПОЛНОЕ новое содержимое файла целиком, не диф и не фрагмент>
===FILE EDIT END===

Если для правки нужно увидеть содержимое файла, которого нет среди прикреплённых — попроси пользователя прикрепить
его через список файлов слева (отметить галочкой), не изобретай содержимое. Можно предложить только одну правку за
раз — если изменений несколько, предлагай по очереди в отдельных ответах.`;

export interface ParsedMailDraft {
  to: string;
  subject: string;
  body: string;
}

export function parseMailDraft(text: string): ParsedMailDraft | null {
  const match = text.match(/===MAIL DRAFT START===([\s\S]*?)===MAIL DRAFT END===/);
  if (!match) return null;
  const block = match[1];
  const to = block.match(/TO:\s*(.*)/)?.[1]?.trim() ?? "";
  const subject = block.match(/SUBJECT:\s*(.*)/)?.[1]?.trim() ?? "";
  const bodyMatch = block.match(/BODY:\s*([\s\S]*)/);
  if (!bodyMatch) return null;
  return { to, subject, body: bodyMatch[1].trim() };
}
