import DOMPurify from "dompurify";

/**
 * Sanitizes AI-authored design markup for preview and saving.
 *
 * FORCE_BODY is what makes the design's CSS survive, and it is not optional here:
 * a design fragment normally starts with its <style> block, and the HTML parser
 * puts a leading <style> into <head>. With WHOLE_DOCUMENT off, DOMPurify returns
 * only <body> — so the entire stylesheet was being dropped, and designs rendered
 * as unstyled walls of default-serif text. FORCE_BODY parses the fragment inside
 * <body>, keeping the <style> element (allowed via ADD_TAGS) together with the
 * markup it styles.
 *
 * The usual caveat about FORCE_BODY is that it can enable mXSS tricks in old
 * browsers; that doesn't apply to how this is rendered — previews go into an
 * <iframe sandbox=""> where scripts can't run at all, and DOMPurify still strips
 * script/event-handler content regardless.
 */
export function sanitizeDesignHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ["style"], FORCE_BODY: true, WHOLE_DOCUMENT: false });
}

export function sanitizeDesignSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
}
