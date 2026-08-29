import { renderMarkdown } from "./markdownRender";

export interface BrandKit {
  companyName: string;
  tagline: string;
  accentColor: string;
  footerText: string;
  logoDataUrl?: string;
  qrDataUrl?: string;
  contactPhone?: string;
  contactEmail?: string;
  headerImageDataUrl?: string;
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

/**
 * Darkens a colour until text set in it is readable on white (4.5:1).
 *
 * Needed because a brand accent is chosen to look good as a fill, not as body text:
 * the agency's #FF2F6D gives 3.6:1 on white, so headings and links set in it fail
 * WCAG AA — and an exported document is often printed, where it fades further. Fills
 * and rules keep the true brand colour; only text uses this. Works for any accent the
 * user sets, not just the current one.
 */
function textSafe(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));

  const contrastOnWhite = () => {
    const channel = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return 1.05 / (lum + 0.05);
  };

  // Step the colour down toward black, keeping its hue, until it is readable.
  for (let i = 0; i < 40 && contrastOnWhite() < 4.5; i++) {
    r = Math.round(r * 0.94);
    g = Math.round(g * 0.94);
    b = Math.round(b * 0.94);
  }
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function baseStyles(accent: string): string {
  return `
  html { overflow: hidden; }
  body { font-family: -apple-system, "Segoe UI", Arial, sans-serif; color: #1a1a1a; background: #ffffff;
         max-width: 800px; margin: 0 auto; padding: 32px; line-height: 1.6; font-size: 15px;
         box-sizing: border-box; overflow: hidden; }
  h1, h2, h3 { line-height: 1.3; }
  h1 { font-size: 22px; margin: 0 0 20px; }
  h2 { font-size: 18px; margin: 24px 0 10px; color: ${textSafe(accent)}; }
  a { color: ${textSafe(accent)}; }
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
  .pc-brand-header-full { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 20px; }
  .pc-brand-header-center { text-align: center; }
  .pc-brand-header-right { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
  .pc-brand-logo { max-height: 52px; max-width: 160px; }
  .pc-brand-company { font-weight: 700; font-size: 17px; color: #111; }
  .pc-brand-tagline { font-size: 12px; color: #777; margin-top: 2px; }
  .pc-brand-contacts { text-align: right; font-size: 12px; color: #555; line-height: 1.5; white-space: nowrap; }
  .pc-brand-qr { width: 64px; height: 64px; object-fit: contain; flex-shrink: 0; }
  .pc-brand-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 11px; color: #999; }
  .pc-brand-header-image-wrap { margin-bottom: 24px; }
  .pc-brand-header-image-wrap img { display: block; width: 100%; height: auto; }
`;
}

function brandHeaderHtml(brand?: BrandKit): string {
  if (brand?.headerImageDataUrl) {
    return `<div class="pc-brand-header-image-wrap"><img src="${brand.headerImageDataUrl}" alt="" /></div>`;
  }
  if (!brand || (!brand.companyName && !brand.logoDataUrl && !brand.qrDataUrl)) return "";

  const nameBlock = `
      ${brand.companyName ? `<div class="pc-brand-company">${escapeHtml(brand.companyName)}</div>` : ""}
      ${brand.tagline ? `<div class="pc-brand-tagline">${escapeHtml(brand.tagline)}</div>` : ""}`;

  if (!brand.qrDataUrl) {
    return `<div class="pc-brand-header">
    ${brand.logoDataUrl ? `<img class="pc-brand-logo" src="${brand.logoDataUrl}" alt="" />` : ""}
    <div>${nameBlock}</div>
  </div>`;
  }

  const contactsHtml =
    brand.contactPhone || brand.contactEmail
      ? `<div class="pc-brand-contacts">
        ${brand.contactPhone ? `<div>${escapeHtml(brand.contactPhone)}</div>` : ""}
        ${brand.contactEmail ? `<div>${escapeHtml(brand.contactEmail)}</div>` : ""}
      </div>`
      : "";

  return `<div class="pc-brand-header pc-brand-header-full">
    <div>${brand.logoDataUrl ? `<img class="pc-brand-logo" src="${brand.logoDataUrl}" alt="" />` : ""}</div>
    <div class="pc-brand-header-center">${nameBlock}</div>
    <div class="pc-brand-header-right">${contactsHtml}<img class="pc-brand-qr" src="${brand.qrDataUrl}" alt="QR" /></div>
  </div>`;
}

function brandFooterHtml(brand?: BrandKit): string {
  if (!brand?.footerText) return "";
  return `<div class="pc-brand-footer">${escapeHtml(brand.footerText)}</div>`;
}

function wrapDocument(title: string, bodyHtml: string, brand?: BrandKit): string {
  const accent = brand?.accentColor || "#ff2f6d";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title><style>${baseStyles(accent)}</style></head><body>${brandHeaderHtml(brand)}${bodyHtml}${brandFooterHtml(brand)}</body></html>`;
}

export function buildDesignExportHtml(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { background: #ffffff; }
  </style></head><body>${content}</body></html>`;
}

export function buildMessageExportHtml(title: string, content: string, brand?: BrandKit): string {
  const accent = brand?.accentColor || "#ff2f6d";
  return wrapDocument(title, `<div class="msg-block">${renderMarkdown(content, accent)}</div>`, brand);
}

export function buildConversationExportHtml(
  title: string,
  messages: { role: "user" | "assistant"; content: string }[],
  brand?: BrandKit
): string {
  const accent = brand?.accentColor || "#ff2f6d";
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
