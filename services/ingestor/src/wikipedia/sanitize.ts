import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitization config — load-bearing every value, change deliberately.
 *
 * Allowlist mirrors what Wikipedia's REST `extract_html` produces in normal
 * operation: paragraphs, bold/italic emphasis, sup/sub for Latin names and
 * numeric annotations, line breaks, and a `<span lang="...">` for binomial
 * annotations on pages like Phainopepla. Anything else (`<script>`, inline
 * `<style>`, `<table>`, `<img>`) is dropped — Wikipedia would never serve
 * them in a summary, but defense-in-depth is the trust boundary here.
 *
 * The ALLOWED_URI_REGEXP is the second line of defense: even allowlisted
 * `<a>` tags must point at absolute http(s) URLs. Wikipedia internal anchors
 * (`#cite_note-1`) and relative `/wiki/...` links would otherwise survive
 * and dangle in the rendered frontend.
 */
const ALLOWED_TAGS = ['p', 'a', 'b', 'i', 'em', 'strong', 'sup', 'sub', 'br', 'span'];
const ALLOWED_ATTR = ['href', 'lang'];
const ALLOWED_URI_REGEXP = /^https?:\/\//;

const MIN_LENGTH = 50;
const MAX_LENGTH = 8192;

export class SanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizationError';
  }
}

/**
 * Sanitize a Wikipedia REST `extract_html` payload for safe persistence and
 * subsequent rendering in the frontend. Throws `SanitizationError` if the
 * post-sanitize length is outside `[50, 8192]` — that bound matches the
 * `species_descriptions.body` CHECK and prevents both empty-extract NULLs
 * and pathologically long bodies from reaching the DB.
 *
 * The sanitizer runs ingest-time only; the trust boundary the spec relies
 * on is `ingest sanitize → DB CHECK → license CHECK`. The frontend
 * (#373's read-API projection + #374's render layer) consumes the column
 * verbatim — no defense-in-depth runtime DOMPurify there per the spec.
 *
 * DOMPurify gotcha: when `ALLOWED_URI_REGEXP` is set, every attribute value
 * is checked against either the URI regex OR the URI_SAFE_ATTRIBUTES set
 * (which by default excludes `lang`). Without `ADD_URI_SAFE_ATTR: ['lang']`,
 * a `lang="la"` value fails both gates (it isn't an absolute URL) and the
 * attribute gets stripped — leaving `<span>Phainopepla nitens</span>` and
 * losing the i18n hint. The contract test pins this invariant.
 */
export function sanitizeWikipediaExtract(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR: ['lang'],
  });

  // DOMPurify returns a string when called with the default config. Some
  // typings allow TrustedHTML — coerce to string defensively.
  const out = typeof sanitized === 'string' ? sanitized : String(sanitized);

  if (out.length < MIN_LENGTH) {
    throw new SanitizationError(
      `Sanitized extract length ${out.length} is below MIN_LENGTH=${MIN_LENGTH}`
    );
  }
  if (out.length > MAX_LENGTH) {
    throw new SanitizationError(
      `Sanitized extract length ${out.length} exceeds MAX_LENGTH=${MAX_LENGTH}`
    );
  }
  return out;
}

/**
 * Sanitize a plain-text body for safe persistence as a `species_descriptions`
 * row with `source = 'inat'`. The iNat `/v1/taxa/{id}` `wikipedia_summary`
 * field is documented as plaintext (extracted from the same Wikipedia article
 * the REST summary endpoint serves), so there's no allow-list of HTML tags
 * to apply — but we still strip any tags as defense-in-depth (never trust
 * input) and trim whitespace.
 *
 * The same `[50, 8192]` length contract applies — matches the
 * `species_descriptions.body` CHECK and the bounds enforced by
 * `sanitizeWikipediaExtract`. Throws `SanitizationError` on out-of-bounds.
 *
 * Why a plain string-replace and not DOMPurify: this path is plaintext-only.
 * DOMPurify's allow-list is calibrated for HTML; running it would require an
 * empty allow-list (returning the textContent of the parsed tree), which is
 * heavier and depends on the same isomorphic-dompurify install. A regex
 * tag-strip is sufficient for the defense-in-depth claim and is the same
 * shape as the rest of the code base's plaintext-handling surfaces.
 */
export function sanitizeText(input: string): string {
  // First strip <script>…</script> and <style>…</style> blocks INCLUDING
  // their contents. The generic tag-strip below would otherwise leave the
  // executable body intact (`alert("XSS")` from `<script>alert("XSS")</script>`).
  // Case-insensitive `i` and dot-all `s` cover the multi-line and uppercase
  // forms a malicious payload could use.
  const noBlocks = input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

  // Strip any remaining HTML/XML tag — `<tag>`, `</tag>`, `<tag attr="...">`,
  // `<self-closing/>`. The regex is non-greedy on the `<...>` content so
  // `<a>foo<b>` doesn't strip the inner `foo` as part of one mega-match.
  const stripped = noBlocks.replace(/<[^>]*>/g, '');

  // Trim leading/trailing whitespace AFTER tag-stripping so wrappers like
  // `   <p>...</p>   ` don't smuggle whitespace past the trim.
  const out = stripped.trim();

  if (out.length < MIN_LENGTH) {
    throw new SanitizationError(
      `Sanitized text length ${out.length} is below MIN_LENGTH=${MIN_LENGTH}`
    );
  }
  if (out.length > MAX_LENGTH) {
    throw new SanitizationError(
      `Sanitized text length ${out.length} exceeds MAX_LENGTH=${MAX_LENGTH}`
    );
  }
  return out;
}
