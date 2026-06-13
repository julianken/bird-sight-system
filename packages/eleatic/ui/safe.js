// Shared browser-safety helpers for the eleatic explorer UI.
//
// The hub (hub.js) and any future page build their DOM with `innerHTML` template
// strings that interpolate EXTERNAL, UNTRUSTED data: run labels, metric keys,
// row keys, and image urls — all of which originate from whatever eval harness
// wrote the SQLite store (eleatic invents no domain). The server exposes a write
// route (POST /api/adjudications), so an unescaped payload like
// `"><img src=x onerror=alert(1)>` is a real XSS that can drive that route.
// These helpers neutralize that:
//   - `esc(s)`     HTML-escapes & < > " ' so a payload renders as inert text.
//   - `safeImg(u)` returns the URL only when it is an https URL whose host is on
//                  the CONFIGURED allowlist; otherwise a transparent 1×1
//                  placeholder.
//
// Unlike the photo-curation original (which hard-coded a bird-photo-host set),
// the allowlist here is read from `/config.js` at runtime via
// `setImageHostAllowlist(cfg.imageHostAllowlist)`. The eleatic default is the
// any-https sentinel `['https://*']` (any https host allowed) — the package
// makes no domain assumption. A deployment that wants to lock images down passes
// an explicit host list in its `--config` file. Non-https / `javascript:` /
// unparseable input always falls back to the placeholder, regardless of the
// allowlist.
//
// Plain ESM with named exports so it is importable both by the browser (served
// verbatim by the server's express.static) and by vitest in node.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape `& < > " '` so an interpolated value renders as inert text. */
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// 1×1 transparent PNG — the fallback when an image URL is not a trusted https
// URL on the allowlist. Inert: a data: URI can't run JS in <img src>.
export const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// The any-https sentinel: when this string is present in the allowlist, ANY
// https host is accepted (the eleatic zero-config default — no domain coupling).
const ANY_HTTPS = 'https://*';

// Lowercased host allowlist, set from /config.js at page init. Until configured
// it is empty — fail-closed: nothing matches, so every URL → placeholder.
let allowedHosts = new Set();
let anyHttps = false;

/**
 * Apply the image-host allowlist read from `/config.js`. Accepts the any-https
 * sentinel `'https://*'` (any https host) and/or explicit lowercased hostnames.
 * Hosts are compared case-insensitively.
 */
export function setImageHostAllowlist(hosts) {
  const list = Array.isArray(hosts) ? hosts : [];
  anyHttps = list.includes(ANY_HTTPS);
  allowedHosts = new Set(
    list.filter((h) => h !== ANY_HTTPS).map((h) => String(h).toLowerCase()),
  );
}

/**
 * Validate an image URL before it reaches `<img src>`. Returns `u` unchanged
 * only when it parses, is https, and its host is allowed (the any-https sentinel
 * or an explicit allowlist match); otherwise a transparent 1×1 data-URI
 * placeholder.
 */
export function safeImg(u) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return PLACEHOLDER;
  }
  if (parsed.protocol !== 'https:') return PLACEHOLDER;
  if (anyHttps) return u;
  if (!allowedHosts.has(parsed.host.toLowerCase())) return PLACEHOLDER;
  return u;
}
