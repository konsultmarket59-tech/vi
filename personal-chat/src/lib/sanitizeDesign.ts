import DOMPurify from "dompurify";

export function sanitizeDesignHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ["style"], WHOLE_DOCUMENT: false });
}

export function sanitizeDesignSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
