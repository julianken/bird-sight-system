/**
 * Camera / viewport configuration for the map: CONUS framing constants, the
 * pan/zoom bounds, the viewport-responsive initial-zoom helper, and the
 * scope-framing `fitBounds` padding.
 *
 * Extracted verbatim from `MapCanvas.tsx` (epic #884, unit U2 / #886) as a
 * behavior-preserving move. Pure data + one SSR-guarded pure function — no
 * React, no MapLibre, no live `mapRef` (the imperative camera machinery —
 * `clampBounds`/`padBounds`/`cameraForBounds`/`setMaxBounds` — stays in
 * `MapCanvas.tsx` for U12). Idiom mirrors the sibling `deconflict.ts`.
 */

/**
 * CONUS center — default initial view.
 *
 * Frames the continental United States. Per the "going national" umbrella
 * plan (`docs/plans/2026-05-17-going-national.md` §5.1), the map default
 * shifts from Arizona-centered (lng -111.0937, lat 34.0489, zoom 6) to the
 * geographic center of CONUS. Zoom is viewport-responsive: zoom 3 on narrow
 * screens (<700px), zoom 4 on desktop. Desktop framing (1440, 1920) shows
 * the full lower-48 with comfortable margin.
 *
 * Mobile caveat: at 390×844 the header (nav + stats card + the "Bird
 * families in view" panel rendered open by default) consumes roughly 60% of
 * the vertical space, so a geographically-centered viewport biases north.
 * In practice the Gulf coast, Florida, and southern Texas may clip below
 * the panel edge while the southern Canadian provinces remain visible at
 * the top. The AZ→CONUS pivot is still demonstrated (Arizona cluster
 * badges visible mid-map); tightening mobile framing (drop to zoom 2, bias
 * center south, or factor chrome height into pickInitialZoom) is tracked
 * as follow-up — see PR #612 review.
 *
 * At AZ-only ingest this briefly shows a sparser map outside Arizona; that
 * intermediate state is acceptable and resolves once the ingestor flips.
 */
const CONUS_LONGITUDE = -98.5795;
const CONUS_LATITUDE = 39.8283;
export const CONUS_ZOOM_NARROW = 3;
export const CONUS_ZOOM_WIDE = 4;
export const CONUS_NARROW_BREAKPOINT_PX = 700;

/**
 * Pan/zoom bounds for the map. Kept consistent with the server-side bbox cap
 * in `services/read-api/src/validate.ts` (45° lng × 25° lat at z>=6 / per-obs
 * mode) so the natural viewport at z=6 stays under the cap on any canonical
 * viewport (1920×1080 → 42.2° × 23.7°).
 *
 * - `MIN_ZOOM = 2` is the zoom-out backstop (#760/#762 state-artboard mask). The
 *   real zoom-out limit for a state scope is the PADDED `maxBounds` clamp
 *   (`padBounds(bounds, clampPad)`), which stops the camera once the state has
 *   shrunk to ~1/3 of the viewport on the gray artboard field. The floor was
 *   lowered from `CONUS_ZOOM_NARROW` (3) so a small state (e.g. DC, RI) can
 *   still be zoomed out far enough to read as an artboard. At z<6 the API is in
 *   aggregated mode anyway, so unbounded bboxes don't matter; this bound is
 *   purely a UX backstop. `CONUS_ZOOM_NARROW` (3) is unchanged for the
 *   CONUS-default framing math below.
 * - `CONUS_BOUNDS` keeps pan inside CONUS + a margin for coastal/border obs.
 *   This is the client-side enforcement of the server's bbox cap: if the
 *   server cap in `services/read-api/src/validate.ts` (see cap derivation)
 *   changes, this constant must change too — they're a linked pair.
 *   AK and HI are out of frame because of these map bounds (ingest already
 *   pulls `/recent/US` per PR #669); widening bounds to include them is
 *   the unblock, not an ingest change.
 *
 * Scope selector (#736): `CONUS_BOUNDS` is the FALLBACK clamp — used when no
 * scope `bounds` prop is supplied (legacy callers / `?scope=us`). When a state
 * scope is active, App.tsx (#740) passes that state's envelope as the `bounds`
 * prop and the reactive `maxBounds` re-clamps to it (finding (a) — never an
 * imperative `map.setMaxBounds()`). The constant was renamed from `MAX_BOUNDS`
 * to make the CONUS-fallback role explicit; the validate.ts linked-pair tie
 * above is unchanged.
 */
export const MIN_ZOOM = 2;
export const CONUS_BOUNDS: [[number, number], [number, number]] = [
  [-130, 20],
  [-65, 52],
];

export function pickInitialZoom(): number {
  if (typeof window === 'undefined') return CONUS_ZOOM_WIDE;
  return window.innerWidth < CONUS_NARROW_BREAKPOINT_PX
    ? CONUS_ZOOM_NARROW
    : CONUS_ZOOM_WIDE;
}

export const INITIAL_VIEW = {
  longitude: CONUS_LONGITUDE,
  latitude: CONUS_LATITUDE,
  zoom: pickInitialZoom(),
} as const;

/**
 * Single source of truth for the scope-framing `fitBounds` padding (#800, #761).
 *
 * Re-derived after the AppHeader → two floating corner cards migration (#800).
 * The old value (top: 152) was sized to clear TWO stacked full-width bands:
 * the fixed `.app-header` bar (48px) AND the top-center `.scope-control` overlay
 * (up to 88px wrapped at 390px, giving ~148px total). Those bands are now GONE.
 *
 * Replacement: two CORNER cards (not full-width bands) sit at:
 *   - TOP-LEFT: `.app-header-identity-card` — anchored at `--card-inset` (12px)
 *     from the top-left. When fully populated (scoped with lede + scope rows) its
 *     bottom edge reaches ~170px on desktop, but it is only `--card-maxw-identity`
 *     (360px) wide — it does NOT span the full viewport width. The center and
 *     right of the map framing are completely clear of top occlusion.
 *   - TOP-RIGHT: `.app-header-controls-pill` — anchored at `--card-inset` (12px).
 *     Content-width (~160px wide, ~52px tall). Bottom edge ≈ 12 + 52 = 64px.
 *
 * Because neither card spans the full viewport width, a uniform top padding
 * equal to the tallest card's bottom would over-frame the map on desktop. A
 * value of 80px clears the controls pill (the rightmost card, ~64px tall) with a
 * comfortable margin, and keeps most of the top-left identity card's area visible
 * in the framed view. The identity card (max 360px wide) only partially overlaps
 * the top-left corner of the framed state — acceptable for typical state data
 * distributions (density is rarely highest at the very top-left corner).
 *
 * bottom/left/right: unchanged at 48px — the bottom-left family legend and
 * MapLibre attribution bar set the bottom constraint; left/right are symmetric
 * insets that provide breathing room from the viewport edge.
 *
 * Single source of truth for BOTH fitBounds call sites in this file.
 */
export const FIT_BOUNDS_PADDING = { top: 80, bottom: 48, left: 48, right: 48 } as const;

/**
 * Minimum fraction of the viewport span that must keep overlapping the state
 * bbox at the hardest pan, in a state scope (#1059 / M-30 — the masked-void
 * fix). DECOUPLED from `mask.ts`'s `ARTBOARD_PAD` (1.0) by design: `ARTBOARD_PAD`
 * sizes the static zoom-OUT gate (state shrinks to ~1/3 of the viewport on the
 * gray field before the clamp halts), and the mask geometry pins it at 1.0
 * (`mask.test.ts`); this constant is a separate zoom-IN backstop and must not be
 * conflated with it. 0.2 ⇒ at least 20% of the viewport span still shows
 * state-bbox area even when the camera is panned hard against the clamp edge, so
 * a 100%-void viewport is unreachable at any zoom.
 */
export const MIN_STATE_ONSCREEN = 0.2;

/**
 * Zoom-aware artboard clamp (#1059 — M-30: "the masked void is reachable").
 *
 * The pre-#1059 clamp was the STATIC `padBounds(bounds, clampPad)` — the state
 * envelope grown by `clampPad`× (≈3× at `ARTBOARD_PAD = 1.0`). That static band
 * is one full state-width of slack per side; at mid/high zoom the viewport is
 * far smaller than the band, so the camera can pan until the viewport sits
 * entirely inside the gray slack — a 100%-featureless void with zero affordance
 * back (verified: at z≥10 every canonical viewport spans <1 state-width of lng).
 *
 * The fix keeps the SAME reactive-`maxBounds` mechanism but caps the per-side
 * pad by the live viewport span so the band is never wider than the viewport:
 * the per-side pad (in degrees, per axis) is the smaller of
 *   - the static gate `clampPad × stateDimension` (the zoom-OUT framing), and
 *   - `(1 − MIN_STATE_ONSCREEN) × viewportSpan` (the zoom-IN backstop).
 * Because the per-side pad never exceeds `(1 − MIN_STATE_ONSCREEN) × span`, the
 * far viewport edge — when panned hard against the clamp — still overlaps the
 * state bbox by ≥ `MIN_STATE_ONSCREEN × span`. The viewport therefore ALWAYS
 * intersects the state, in every pan direction, at every zoom.
 *
 * Zoom-OUT framing is preserved exactly: when `viewportSpan` is wide (zoomed
 * out, the artboard case `ARTBOARD_PAD` was sized for), the static gate is the
 * smaller term, so the result equals `padBounds(bounds, clampPad)` — the
 * pre-#1059 value, unchanged. The clamp only TIGHTENS as you zoom in past the
 * point where the viewport span drops below the static band.
 *
 * Pure function (no React, no maplibre): `viewportSpan` is `[lngSpan, latSpan]`
 * in degrees, supplied by the caller from `map.getBounds()` on `zoomend`. When
 * `viewportSpan` is omitted (mount, before the first camera settle) it falls
 * back to the static `padBounds(bounds, clampPad)` so entry framing is
 * byte-identical to the pre-#1059 path. Latitude is clamped to ±85 (web-mercator
 * safe), matching `padBounds`.
 *
 * @param bounds       tight state envelope `[[w,s],[e,n]]`
 * @param clampPad     static artboard pad factor (`ARTBOARD_PAD`), per side
 * @param viewportSpan live `[lngSpan, latSpan]` in degrees, or undefined at mount
 */
export function zoomAwareClampBounds(
  bounds: [[number, number], [number, number]],
  clampPad: number,
  viewportSpan: [number, number] | undefined,
): [[number, number], [number, number]] {
  const [[w, s], [e, n]] = bounds;
  const stateW = e - w;
  const stateH = n - s;
  // Static per-side pad (degrees) — the pre-#1059 zoom-OUT gate.
  const staticPadW = stateW * clampPad;
  const staticPadH = stateH * clampPad;
  // Zoom-IN cap (degrees): keep ≥ MIN_STATE_ONSCREEN of the viewport on the
  // state. With no live span (mount) the cap is +∞, so the static gate wins and
  // the result equals padBounds(bounds, clampPad).
  const capW = viewportSpan
    ? (1 - MIN_STATE_ONSCREEN) * viewportSpan[0]
    : Number.POSITIVE_INFINITY;
  const capH = viewportSpan
    ? (1 - MIN_STATE_ONSCREEN) * viewportSpan[1]
    : Number.POSITIVE_INFINITY;
  const padW = Math.min(staticPadW, capW);
  const padH = Math.min(staticPadH, capH);
  const cx = (x: number) => Math.max(-180, Math.min(180, x));
  const cy = (y: number) => Math.max(-85, Math.min(85, y));
  return [
    [cx(w - padW), cy(s - padH)],
    [cx(e + padW), cy(n + padH)],
  ];
}
