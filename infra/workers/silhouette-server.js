// ── silhouette-server: public read-only proxy in front of bird-maps-silhouettes R2 ──
//
// Exposes `https://silhouettes.bird-maps.com/<key>` → `r2://bird-maps-silhouettes/<key>`.
// Bound to the `SILHOUETTES` R2 binding (see infra/terraform/silhouettes.tf).
//
// Mirrors the photo-server contract (#502): the admin-api uploads operator-curated
// SVG silhouettes to content-hashed keys of the form `family/<code>.<sha8>.svg`;
// once written, the key is never overwritten. New uploads under the same family
// land at a new key, the family_silhouettes.svg_url column is repointed, and the
// old key is left behind (orphan cleanup is operator-initiated, see runbook).
// That makes hit responses safe to mark `immutable` with a one-year max-age.
// Misses get a short 60s cache to absorb traffic on not-yet-uploaded families
// without pinning a 404 forever.

/**
 * Resolve the HTTP Content-Type for a given object key based on its
 * extension. Unknown / missing extensions fall through to
 * `application/octet-stream` per RFC 2046.
 *
 * Exported so the unit test can exercise the lookup table without spinning
 * up the full Worker runtime.
 *
 * @param {string} key
 * @returns {string}
 */
export function contentTypeFor(key) {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = key.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

export default {
  /**
   * @param {Request} request
   * @param {{ SILHOUETTES: R2Bucket }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    const object = await env.SILHOUETTES.get(key);

    if (object === null) {
      return new Response(null, {
        status: 404,
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': contentTypeFor(key),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  },
};
