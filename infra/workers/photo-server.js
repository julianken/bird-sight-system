// ── photo-server: public read-only proxy in front of birdwatch-photos R2 ──
//
// Exposes `https://photos.bird-maps.com/<key>` → `r2://birdwatch-photos/<key>`.
// Bound to the `PHOTOS` R2 binding (see infra/terraform/photos.tf).
//
// Key derivation: request.url.pathname.slice(1) — so a request for
//   https://photos.bird-maps.com/vermfly.webp
// reads R2 key
//   vermfly.webp
//
// Caching contract: photos are write-once at R2 keys. If a species photo is
// replaced (e.g. iNaturalist license change → re-fetch), the new photo is
// uploaded under a NEW key and the species_photos row is updated to point at
// it; the old key is never overwritten. That makes hit responses safe to mark
// `immutable` with a one-year max-age. Misses get a short 60s cache to
// absorb traffic on not-yet-ingested species without pinning a 404 forever.

/**
 * Resolve the HTTP Content-Type for a given object key (e.g. R2 key, URL
 * path, filename) based on its extension. Unknown / missing extensions
 * fall through to `application/octet-stream` per RFC 2046.
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
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export default {
  /**
   * @param {Request} request
   * @param {{ PHOTOS: R2Bucket }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1);

    const object = await env.PHOTOS.get(key);

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
