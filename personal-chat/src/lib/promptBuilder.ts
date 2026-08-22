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
