import { renderMarkdown } from "./markdownRender";

export interface BrandKit {
  companyName: string;
  tagline: string;
  accentColor: string;
  footerText: string;
  logoDataUrl?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CHART_CSS = `
  .pc-chart { margin: 16px 0; }
  .pc-chart-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
  .pc-chart-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; font-size: 12px; color: #444; }
  .pc-chart-legend-vertical { flex-direction: column; gap: 6px; }
  .pc-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .pc-legend-dot { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .pc-chart-pie-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
`;

function baseStyles(accent: string): string {
  return `
  html { overflow: hidden; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1a1a1a; background: #ffffff;
         max-width: 800px; margin: 0 auto; padding: 32px; line-height: 1.6; font-size: 15px;
         box-sizing: border-box; overflow: hidden; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { font-size: 22px; margin: 0 0 20px; }
  h2 { font-size: 18px; margin: 24px 0 10px; color: ${accent}; }
  a { color: ${accent}; }
  .msg-block { margin-bottom: 22px; }
  .msg-role { font-size: 12px; color: #888; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0 0 10px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th { background: ${accent}14; }
  td, th { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  pre { background: #f4f4f4; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  code { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
  ul, ol { margin: 0 0 10px; padding-left: 22px; }
  ${CHART_CSS}
  .pc-brand-header { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; margin-bottom: 24px; border-bottom: 3px solid ${accent}; }
  .pc-brand-logo { max-height: 52px; max-width: 160px; }
  .pc-brand-company { font-weight: 700; font-size: 17px; color: #111; }
  .pc-brand-tagline { font-size: 12px; color: #777; margin-top: 2px; }
  .pc-brand-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; }
`;
}

function brandHeaderHtml(brand?: BrandKit): string {
  if (!brand || (!brand.companyName && !brand.logoDataUrl)) return "";
  return `<div class="pc-brand-header">
    ${brand.logoDataUrl ? `<img class="pc-brand-logo" src="${brand.logoDataUrl}" alt="" />` : ""}
    <div>
      ${brand.companyName ? `<div class="pc-brand-company">${escapeHtml(brand.companyName)}</div>` : ""}
      ${brand.tagline ? `<div class="pc-brand-tagline">${escapeHtml(brand.tagline)}</div>` : ""}
    </div>
  </div>`;
}

function brandFooterHtml(brand?: BrandKit): string {
  if (!brand?.footerText) return "";
  return `<div class="pc-brand-footer">${escapeHtml(brand.footerText)}</div>`;
}

function wrapDocument(title: string, bodyHtml: string, brand?: BrandKit): string {
  const accent = brand?.accentColor || "#c96442";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>${baseStyles(accent)}</style></head><body>${brandHeaderHtml(brand)}${bodyHtml}${brandFooterHtml(brand)}</body></html>`;
}

export function buildMessageExportHtml(title: string, content: string, brand?: BrandKit): string {
  const accent = brand?.accentColor || "#c96442";
  return wrapDocument(title, `<div class="msg-block">${renderMarkdown(content, accent)}</div>`, brand);
}

export function buildConversationExportHtml(
  title: string,
  messages: { role: "user" | "assistant"; content: string }[],
  brand?: BrandKit
): string {
  const accent = brand?.accentColor || "#c96442";
  const body = messages
    .map(
      (m) =>
        `<div class="msg-block"><div class="msg-role">${m.role === "user" ? "Вы" : "Ассистент"}</div>${renderMarkdown(
          m.content,
          accent
        )}</div>`
    )
    .join("\n");
  return wrapDocument(title, `<h1>${escapeHtml(title)}</h1>${body}`, brand);
}
