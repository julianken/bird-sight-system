/**
 * `@bird-watch/geo` — pure geometry helpers shared by the frontend request
 * path and the ingestor cache-warmer (issue #866).
 *
 * The single job of this package is to make `/api/observations` cache keys
 * COLLIDE. The frontend serializes the full-precision float viewport bbox
 * straight into the query string, so every pan/zoom mints a unique Cloudflare
 * cache key → guaranteed MISS by construction (zone-wide HIT ratio was 0.67%).
 * `snapFetchBbox` rounds the *fetch* bbox to a coarse, shared, deterministic
 * grid so nearby viewports resolve to one key, and `serializeBbox` emits the
 * one canonical decimal string both call sites produce — the actual collision
 * lever.
 *
 * **Source-only, consumer-compiled.** This package ships no `dist` build: its
 * `package.json` `exports.default` points at `./src/index.ts`. The frontend's
 * Vite bundler inlines the source; the ingestor relies on Node's native TS
 * type-stripping at runtime (Node ≥23 strips types by default). Everything
 * here must therefore stay type-strippable — pure functions and `const`s with
 * annotations only, NO enums / namespaces / parameter-properties.
 *
 * @see services/read-api/src/app.ts:240 — the `zoom < 6` aggregated branch.
 * @see infra/terraform/cache-rule.tf — the CF cache rule keying on raw URI.
 */

/** `[west, south, east, north]` in degrees (lng, lat, lng, lat). */
export type Bbox = [number, number, number, number];

/**
 * Per-zoom-tier snap step in degrees. Each step is a small integer multiple of
 * the server's aggregation bucket (`1 / gridMultiplier`, app.ts:241) AND an
 * exact multiple of 0.25° so `.toFixed(2)` serialization is lossless:
 *
 * | zoom tier | server bucket | SNAP_STEP_DEG | notes                       |
 * |-----------|---------------|---------------|-----------------------------|
 * | z ≤ 3     | 0.5°          | 1.0°          | CONUS; default bbox aligned |
 * | z = 4     | 0.25°         | 0.5°          | multi-state; 2× bucket      |
 * | z = 5     | 0.125°        | 0.25°         | metro; 2× bucket            |
 *
 * Only consulted for `zoom < 6`; at/above 6 `snapFetchBbox` is a passthrough.
 */
export function SNAP_STEP_DEG(zoom: number): number {
  if (zoom <= 3) return 1.0;
  if (zoom === 4) return 0.5;
  return 0.25; // zoom === 5 (the only remaining tier below the z<6 boundary)
}

/** Round `v` DOWN to the nearest `step` multiple (used for the W/S edges). */
function floorTo(v: number, step: number): number {
  return Math.floor(v / step) * step;
}

/** Round `v` UP to the nearest `step` multiple (used for the E/N edges). */
function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step) * step;
}

/**
 * Snap the FETCH bbox to the shared cache grid.
 *
 * - `zoom >= 6` (per-observation mode): **passthrough** — returns the input
 *   bbox unchanged. Outward-snapping a bbox already at the validate.ts area cap
 *   (maxLngSpan 45 / maxLatSpan 25, enforced only at zoom ≥ 6) would push it
 *   past the cap → a 400 where the raw request passed. Per-observation snapping
 *   is a tracked v1 non-goal (needs clamp-to-cap logic).
 * - `zoom < 6` (aggregated mode): rounds each axis **OUTWARD** (floor W/S, ceil
 *   E/N) to `SNAP_STEP_DEG(zoom)`. Outward = superset: the snapped bbox always
 *   contains the input, so we never under-fetch and drop edge observations.
 *   MapLibre clips the extra off-screen data, so there is no visible change.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function snapFetchBbox(bbox: Bbox, zoom: number): Bbox {
  if (zoom >= 6) return bbox;
  const step = SNAP_STEP_DEG(zoom);
  const [w, s, e, n] = bbox;
  return [floorTo(w, step), floorTo(s, step), ceilTo(e, step), ceilTo(n, step)];
}

/**
 * Canonical bbox serializer — the single string both the frontend and the
 * warmer emit. `.toFixed(2)` matches the warmer's pre-existing centroid format
 * (run-cache-warm.ts) and is lossless because every snapped axis is a 0.25°
 * multiple. Identical param value on both call sites ⇒ identical cache key
 * (the CF rule already sets `ignore_query_strings_order = true`, so only the
 * param-set + values must match, not whole-URL byte identity).
 */
export function serializeBbox(bbox: Bbox): string {
  return bbox.map((v) => v.toFixed(2)).join(',');
}

/**
 * Convenience: `snapFetchBbox` then `serializeBbox`. This is the value both
 * `client.ts` and `run-cache-warm.ts` put in `?bbox=` so they collide.
 */
export function snapFetchBboxParam(bbox: Bbox, zoom: number): string {
  return serializeBbox(snapFetchBbox(bbox, zoom));
}
