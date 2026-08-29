import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

/**
 * The protocol blocks are machinery, not prose: the edit block is already shown
 * as a reviewable diff and the command block as a command card, so leaving the
 * raw markers in the message would just duplicate them as noise.
 */
export function stripProtocolBlocks(text: string): string {
  return text
    .replace(/===CODE EDIT START===[\s\S]*?===CODE EDIT END===/g, "")
    .replace(/===RUN START===[\s\S]*?===RUN END===/g, "")
    .replace(/===TOOL===[\s\S]*?===END TOOL===/g, "")
    .trim();
}

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html);
}
