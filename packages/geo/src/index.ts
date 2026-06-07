/**
 * `@bird-watch/geo` — pure geometry helpers shared by the frontend request
 * path and the ingestor cache-warmer (issue #866).
 *
 * The single job of this package is to make `/api/observations` cache keys
 * COLLIDE. BEFORE this package, the frontend serialized the full-precision
 * float viewport bbox straight into the query string, so every pan/zoom minted
 * a unique Cloudflare cache key → guaranteed MISS by construction. That was the
 * pre-fix baseline (~0.67% zone-wide / ~5% /api HIT ratio measured 2026-06-03).
 * `snapFetchBbox` rounds the *fetch* bbox to a coarse, shared, deterministic
 * grid so nearby viewports resolve to one key, and `serializeBbox` emits the
 * one canonical decimal string both call sites produce — the actual collision
 * lever.
 *
 * **This collision layer is SHIPPED and prod-validated** (#866/#867 float-snap →
 * #868/#869 canonical-extent keys → #870/#871 s-maxage→cadence tune): organic
 * caching is live and cold-load national views hit a warmed key. The snapping
 * is wired into BOTH call sites (`client.ts` getObservations + the cache-warmer),
 * so the 0.67% figure above is HISTORY, not current state. The only remaining
 * raw-float path is the `zoom >= 6` per-observation passthrough (see
 * `snapFetchBbox` below) — a tracked v1 non-goal, not regressed by this package.
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

// ── #868 — canonical-extent cache keys ──────────────────────────────────────
//
// `snapFetchBbox` (above, #866/#867) snaps the viewport *edges* outward to a
// shared grid. That is scheme (b) "cell-aligned": it collapses pan/float
// cardinality but the key still depends on the pixel-viewport EXTENT — a 390px
// phone and a 1440px desktop at the same center mint different keys (different
// edges → different snapped edges). Prod validation (2026-06-04) confirmed the
// MISS persists: the desktop cold load requested `-130,20,-65,52` but the
// warmer had warmed `-125,24,-66,50`.
//
// `canonicalFetchBbox` is scheme (a) "fixed-size": it DISCARDS the viewport
// edges and reconstructs the box from `(snapped-center, integer-zoom)` + a
// per-zoom fixed half-extent. Every device at the same view → ONE key. The
// cold-load keyspace collapses to 2 keys (z3 narrow-device tier, z4 wide-device
// tier) because `MapCanvas.tsx` uses a fixed CONUS center + a breakpoint-driven
// zoom. Organic caching then carries the load across device classes.
//
// Applies ONLY at `zoom < 6` (aggregated mode). At z>=6 it is a passthrough,
// exactly like `snapFetchBbox`: `validate.ts` enforces the 45×25 area cap only
// at z>=6, and reconstructing a fixed box there would either 400 (too large) or
// drop on-screen observations (too small). Per-observation canonicalization is
// a tracked non-goal.

/**
 * The camera `maxBounds` envelope in `MapCanvas.tsx` (`CONUS_BOUNDS` there) —
 * the outer clamp for every canonical box, and the named prod-MISSed desktop
 * bbox. The reconstructed box is clamped to this first (so it never fetches
 * off-CONUS ocean) and then to the globe.
 *
 * NB this is NOT centered on the snapped CONUS view center: the z3 snapped
 * center is `[-99, 40]`, whose distance to the east edge `-65` is 34° while the
 * distance to the west edge `-130` is only 31°. `CANONICAL_HALF_EXTENTS[3]`'s
 * `HALF_W = 34` is what makes the clamped z3 box land EXACTLY on `CONUS_BOUNDS`
 * (the CONUS-binding test); a `31` would under-reach the east edge to `-68`.
 */
export const CONUS_BOUNDS: Bbox = [-130, 20, -65, 52];

/**
 * Per-integer-zoom fixed half-extents `[HALF_W, HALF_H]` in degrees. Each is a
 * multiple of `SNAP_STEP_DEG(zoom)` (1.0 / 0.5 / 0.25) so the reconstructed
 * edges serialize losslessly under `.toFixed(2)`.
 *
 * Pinned by the #868 tests (the constants are tuned to PASS the superset +
 * device-independence + CONUS-binding ACs, not guessed):
 *
 *  - z3 `[34.0, 38.0]`: HALF_W=34 makes the clamped z3 box === `CONUS_BOUNDS`
 *    exactly (see the note above); HALF_H=38 over-reaches lat so the N/S clamp
 *    to `CONUS_BOUNDS` binds (snapped center lat 40 → 40±38 = [2, 78] → clamp).
 *  - z4 `[43.0, 24.5]`: collapses every wide-device view to `CONUS_BOUNDS` too
 *    (snapped center [-99, 40] at 0.5° step → 40±24.5 covers [15.5, 64.5] →
 *    clamp to [20, 52]; -99±43 covers [-142, -56] → clamp to [-130, -65]).
 *  - z5 `[22.25, 12.25]`: metro tier (centers are interior, no CONUS clamp).
 *    The widest canonical device (2560×1440) frames ±22°/±12° under the repo's
 *    tile→bbox heuristic. HALF_W is 22.25 (not a flat 22) because snapping the
 *    center to the 0.25° grid can shift it up to half a step (0.125°) away from
 *    the true center, which would leave the FAR edge of a ±22° view 0.125°
 *    under-fetched; 22.25 absorbs that snap shift (next 0.25° multiple above
 *    22.125) so the superset genuinely holds, while the canonical-z5 / phone
 *    over-fetch ratio stays at ~7.96× — still under the 8× budget. The superset
 *    and the budget pull in opposite directions at z5, so this is the tight
 *    pinned value, not a guess.
 */
export const CANONICAL_HALF_EXTENTS: Record<number, readonly [number, number]> = {
  3: [34.0, 38.0],
  4: [43.0, 24.5],
  5: [22.25, 12.25],
};

/** Clamp `v` into `[lo, hi]`. */
function clampTo(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Reconstruct the canonical FETCH bbox from `(snapped-center, integer-zoom)`.
 *
 * 1. `zoom >= 6` → passthrough (the input bbox, unchanged).
 * 2. center = the bbox MIDPOINT `[(w+e)/2, (s+n)/2]` — NOT `map.getCenter()`,
 *    whose Mercator skew would re-introduce per-device key variation at z5.
 * 3. snap the center to `SNAP_STEP_DEG(zoom)`.
 * 4. expand the snapped center by `CANONICAL_HALF_EXTENTS[zoom]`.
 * 5. clamp to `CONUS_BOUNDS`, then to the globe `[-180,180]×[-90,90]`.
 *
 * Pure: no I/O, no mutation of the input.
 */
export function canonicalFetchBbox(bbox: Bbox, zoom: number): Bbox {
  if (zoom >= 6) return bbox;
  const [w, s, e, n] = bbox;
  const step = SNAP_STEP_DEG(zoom);
  const cLng = Math.round((w + e) / 2 / step) * step;
  const cLat = Math.round((s + n) / 2 / step) * step;
  const [halfW, halfH] = CANONICAL_HALF_EXTENTS[zoom] ?? CANONICAL_HALF_EXTENTS[5]!;
  // Expand, then clamp to CONUS, then to the globe.
  const cw = clampTo(Math.max(cLng - halfW, CONUS_BOUNDS[0]), -180, 180);
  const cs = clampTo(Math.max(cLat - halfH, CONUS_BOUNDS[1]), -90, 90);
  const ce = clampTo(Math.min(cLng + halfW, CONUS_BOUNDS[2]), -180, 180);
  const cn = clampTo(Math.min(cLat + halfH, CONUS_BOUNDS[3]), -90, 90);
  return [cw, cs, ce, cn];
}

/**
 * `canonicalFetchBbox` then `serializeBbox`. The value both `client.ts`
 * (`getObservations`, fetch-time) and `run-cache-warm.ts` put in `?bbox=` so
 * they collide on ONE canonical key per (snapped-center, zoom).
 */
export function canonicalFetchBboxParam(bbox: Bbox, zoom: number): string {
  return serializeBbox(canonicalFetchBbox(bbox, zoom));
}
