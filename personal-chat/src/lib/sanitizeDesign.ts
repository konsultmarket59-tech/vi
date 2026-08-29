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
/**
 * DOMPurify's default scheme list with "asset:" added.
 *
 * A design refers to a project's logo or photo as src="ASSET:logos-1", and the app
 * swaps those for the real file only when the design is shown or exported — that
 * indirection is what lets an edited logo on disk appear in designs made months ago.
 * Without this the reference is stripped as an unknown scheme and the link to the
 * project's materials is lost at the first sanitize. It grants nothing: an
 * unsubstituted asset: URL is simply an image that fails to load, and no scheme can
 * execute script in an <iframe sandbox=""> anyway.
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

export function sanitizeDesignHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["style"],
    FORCE_BODY: true,
    WHOLE_DOCUMENT: false,
    ALLOWED_URI_REGEXP,
  });
}

export function sanitizeDesignSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ALLOWED_URI_REGEXP });
}
