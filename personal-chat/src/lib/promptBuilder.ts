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

export interface ParsedDesignDraft {
  title: string;
  type: string;
  format: "html" | "svg";
  content: string;
}

export function parseDesignDraft(text: string): ParsedDesignDraft | null {
  const match = text.match(/===DESIGN START===([\s\S]*?)===DESIGN END===/);
  if (!match) return null;
  const block = match[1];
  const title = block.match(/TITLE:\s*(.+)/)?.[1]?.trim();
  const type = block.match(/TYPE:\s*(.+)/)?.[1]?.trim();
  const format = block.match(/FORMAT:\s*(html|svg)/)?.[1] as "html" | "svg" | undefined;
  const contentMatch = block.match(/CONTENT:\s*([\s\S]*)/);
  if (!title || !type || !format || !contentMatch) return null;
  return { title, type, format, content: contentMatch[1].trim() };
}

export const DESIGN_SYNTAX_HINT = `Когда пользователь просит создать дизайн (пост для соцсетей, макет документа, слайд презентации,
дизайн-систему, черновик сайта, логотип/иконку/простую векторную графику) — предложи готовый результат строго в
этом формате (приложение распознает его и покажет кнопку «Сохранить», сам ты ничего не сохраняешь):

===DESIGN START===
TITLE: <короткое название дизайна>
TYPE: post | document | presentation | design-system | website | graphic | other
FORMAT: html | svg
CONTENT:
<готовая разметка целиком>
===DESIGN END===

Правила выбора FORMAT:
- "svg" — только для действительно векторной графики (логотип, иконка, простая схема/иллюстрация): валидный
  самодостаточный <svg xmlns="http://www.w3.org/2000/svg" ...>...</svg> с явными width/height или viewBox, без
  внешних ссылок и без <script>.
- "html" — для всего остального (пост, документ, слайд презентации, дизайн-система, страница сайта): один
  самодостаточный HTML-фрагмент с инлайновыми стилями внутри <style>, с явными шириной/высотой контейнера в px,
  подходящими под задачу (например 1080×1080 для квадратного поста, 1080×1920 для истории, размер листа A4 —
  примерно 794×1123px при 96dpi — для документа, 1920×1080 для слайда презентации). Можно использовать CSS
  @keyframes/transition для лёгкой анимации в живом предпросмотре — учти, что при экспорте в PNG/JPG/PDF
  сохранится только статичный кадр, а не анимация целиком.

Если известен фирменный стиль проекта (передан в контексте) — используй его акцентный цвет, название и логотип,
если это уместно для задачи.

Для видео и анимационных роликов (motion-дизайн, готовый MP4) этот формат не подходит — в таком случае прямо
предложи пользователю раздел «🎨 Медиа» (там есть генерация видео), не пытайся выразить видео через HTML/SVG.

Предлагай только один дизайн за раз — если нужно несколько вариантов, предлагай по очереди в отдельных ответах.`;


export interface ParsedExcelEdit {
  sheet: string;
  cells: { cell: string; value: string }[];
}

/** Mirrors parseAgentEdit in electron/excel.cjs — the block the Excel agent emits. */
export function parseExcelEdit(text: string): ParsedExcelEdit | null {
  const match = /===EXCEL EDIT START===([\s\S]*?)===EXCEL EDIT END===/.exec(text || "");
  if (!match) return null;
  const block = match[1];
  const sheet = /SHEET:\s*(.+)/.exec(block)?.[1]?.trim();
  if (!sheet) return null;
  const cellsPart = block.split(/CELLS:\s*/)[1];
  if (!cellsPart) return null;
  const cells: { cell: string; value: string }[] = [];
  for (const line of cellsPart.split("\n")) {
    const m = /^\s*([A-Za-z]+\d+)\s*=\s*(.*)$/.exec(line);
    if (m) cells.push({ cell: m[1].toUpperCase(), value: m[2].trim() });
  }
  return cells.length ? { sheet, cells } : null;
}
