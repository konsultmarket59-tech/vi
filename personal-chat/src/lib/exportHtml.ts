import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true });

function renderMarkdown(text: string): string {
  const raw = marked.parse(text || "", { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const PRINT_STYLES = `
  html { overflow: hidden; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1a1a1a; background: #ffffff;
         max-width: 800px; margin: 0 auto; padding: 32px; line-height: 1.6; font-size: 15px;
         box-sizing: border-box; overflow: hidden; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { font-size: 22px; margin: 0 0 20px; }
  h2 { font-size: 18px; margin: 24px 0 10px; }
  .msg-block { margin-bottom: 22px; }
  .msg-role { font-size: 12px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  pre { background: #f4f4f4; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
`;

function wrapDocument(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>${PRINT_STYLES}</style></head><body>${bodyHtml}</body></html>`;
}

export function buildMessageExportHtml(title: string, content: string): string {
  return wrapDocument(title, `<div class="msg-block">${renderMarkdown(content)}</div>`);
}

export function buildConversationExportHtml(
  title: string,
  messages: { role: "user" | "assistant"; content: string }[]
): string {
  const body = messages
    .map(
      (m) =>
        `<div class="msg-block"><div class="msg-role">${m.role === "user" ? "Вы" : "Ассистент"}</div>${renderMarkdown(
          m.content
        )}</div>`
    )
    .join("\n");
  return wrapDocument(title, `<h1>${escapeHtml(title)}</h1>${body}`);
}
