// Shared browser-safety helpers for the photo-curation review screens.
//
// Both review screens (overview.js + swap.js) build their DOM with `innerHTML`
// template strings that interpolate EXTERNAL, UNTRUSTED data: species
// comName/sciName (eBird taxonomy), free-text `attribution` ("© Photographer …"
// from iNaturalist / Wikimedia user content), and image url/photoUrl. The review
// server exposes write routes (POST /api/decision, POST /api/deny), so an
// unescaped payload like `"><img src=x onerror=alert(1)>` is a real XSS that can
// drive those routes. These helpers neutralize that:
//   - `esc(s)`     HTML-escapes & < > " ' so a payload renders as inert text.
//   - `safeImg(u)` returns the URL only when it is an https URL on the photo-host
//                  allowlist; otherwise a transparent 1×1 placeholder.
//
// Plain ESM with named exports so it is importable both by the browser
// (served verbatim by the review server's express.static) and by vitest in node.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape `& < > " '` so an interpolated value renders as inert text. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// 1×1 transparent PNG — the fallback when a candidate/current image URL is not a
// trusted https photo-host URL. Inert: a data: URI can't run JS in <img src>.
const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Only these hosts may appear in an <img src>. Everything else (other hosts,
// non-https schemes, `javascript:`, unparseable strings) → the placeholder.
const ALLOWED_HOSTS = new Set([
  'photos.bird-maps.com',
  'static.inaturalist.org',
  'inaturalist-open-data.s3.amazonaws.com',
  'upload.wikimedia.org',
]);

/**
 * Validate an image URL before it reaches `<img src>`. Returns `u` unchanged
 * only when it parses, is https, and its host is on the allowlist; otherwise a
 * transparent 1×1 data-URI placeholder.
 */
export function safeImg(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return PLACEHOLDER;
  }
  if (parsed.protocol !== 'https:') return PLACEHOLDER;
  if (!ALLOWED_HOSTS.has(parsed.host.toLowerCase())) return PLACEHOLDER;
  return u;
}
