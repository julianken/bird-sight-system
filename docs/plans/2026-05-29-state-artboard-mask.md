# Plan — State artboard mask + free zoom-out (#760)

Date: 2026-05-29
Epic: #760 (sub-issues #762 artboard core / #763 artboard fidelity / #764 artboard verification)
This plan: #762 — artboard core.

## Goal

When the map's scope is a single US state (`?state=US-XX`, or the state a ZIP
resolves into), render that state as a **Sketch-style artboard**: the state
shows the normal basemap + bird observations; **everything outside the state's
polygon is painted flat, opaque, theme-aware gray** ("map background") at every
zoom level. The user can **zoom out significantly** — the state shrinks on the
gray field — bounded only by a sensible artboard margin (not an infinite void).

`?scope=us` (whole-US niche) and the chooser are **UNCHANGED** (no mask, world
copies on).

## Design

### Inverse-polygon mask

A single MapLibre `fill` layer whose geometry is a world-covering rectangle with
the selected state punched out as interior holes — `[worldRing, ...stateExteriorRings]`.
MapLibre's earcut triangulation treats every ring after the first as a hole, so
**one fill paints "everywhere except the state."** It lives in geographic
coordinates, so it pans/zooms with the map. Inserted as a separate
`<Source id="state-mask">` rendered **immediately before** the observations
`<Source>`, so it sits above the basemap and below the cluster/observation
layers — birds still render inside the state.

Exterior treatment: flat **opaque** gray (no basemap tiles, no neighbors).
Theme-aware — **LIGHT `#d8d8d8`, DARK `#06090e`**. The dark value is
intentionally *darker* than positron-dark land (`#0e1116`) so the state stays
the lighter "lit" artboard element in both themes. (The prototype's
`#e7e2d6` / `#161b27` were the dark-on-dark mistake the v3 mockup corrected;
these mockup-locked values supersede them.) Updated on `[data-theme]` toggle
alongside the existing basemap swap (same MutationObserver — it now calls both
`map.setStyle(...)` and `setMaskTheme(next)`).

### Camera (artboard bounds)

Decouple the two uses of `bounds` that were welded together:

- **fit target** (entry framing): tight state bbox — UNCHANGED. Lands you framed
  on the state. The `fitBounds` call and the mount `initialViewState`
  fitBoundsOptions both keep using the tight `bounds ?? CONUS_BOUNDS`. Do NOT pad
  the fit target.
- **clamp** (`maxBounds`): the state bbox **padded outward** by `ARTBOARD_PAD`
  (1.0 ⇒ +100% per side ⇒ ≈3× envelope) so the state can shrink on gray before
  the clamp stops you. Computed via `padBounds(bounds, clampPad)`. This is the
  **single authoritative zoom-out gate** and remains a reactive prop — never an
  imperative `map.setMaxBounds()`. For `?scope=us` and legacy callers (no
  `clampPad`) the clamp stays the raw `bounds ?? CONUS_BOUNDS`.
- `MIN_ZOOM` floor lowered from `CONUS_ZOOM_NARROW` (3) to **2** as a
  non-binding **backstop only**; the padded clamp does the real limiting.
- `renderWorldCopies: false` — **conditional on `maskPolygon`** via the
  spread-conditional `{...(maskPolygon != null ? { renderWorldCopies: false } : {})}`.
  `state→us` is an in-place prop update (no remount), so unconditionally
  disabling world copies would break the `?scope=us` wide-viewport view. Gating
  on `maskPolygon` flips it off automatically when the scope clears. Pinned by a
  unit assertion (false when masked; undefined/truthy when not) so the invariant
  survives #761's always-mounted lifecycle without a remount.

### Polygon delivery — static asset (revises locked-decision #7, cosmetic only)

The mask needs the state polygon **client-side**; today geometry is kept
server-side (`packages/db-client/src/state-boundaries.ts`, locked decision #7).
This change ships a **cosmetic, simplified** polygon to the client.

#7's intent — the server stays the data-clip authority — is **preserved**:
`ST_Intersects` still does the real clipping; the client polygon is render-only
and derives from the **same** `data/us-state-polygons.geojson`, so the gray edge
matches the data-clip edge exactly.

Delivery is a **static asset** `frontend/public/state-polygons.json` (the
established `zip-index.json` convention), **emitted net-new from the SAME run as
the boundaries migration** by appending a polygon-stripping emit block to
`scripts/generate-state-boundaries.mjs` (resolves reviewer finding 3 — there is
NO standalone `generate-state-mask-polygons.mjs`, and nothing to delete). The
asset is lazy-fetched once and module-cached. Shape: a `code → MultiPolygon
geometry` map (FeatureCollection wrapper + properties dropped). No new API
route. No DB writes.

## File structure

- `scripts/generate-state-boundaries.mjs` — the one run-once generator now emits
  **three** artifacts in a single invocation: the SQL `INSERT` block (stdout),
  `data/us-state-polygons.geojson`, and `frontend/public/state-polygons.json`
  (`{ "US-AL": <geometry>, … }`). Already knip-ignored; no new script ignore.
- `frontend/public/state-polygons.json` — committed generated asset.
- `frontend/src/data/state-polygons.ts` — module-cached lazy fetch of
  `/state-polygons.json` + `useStatePolygon(code)` hook (mirrors the
  `use-states.ts` / `use-silhouettes.ts` module-cache discipline; exports
  `__resetStatePolygonsCache()` test helper). `STATE_POLYGONS_VERSION` = 1.
- `frontend/src/components/map/mask.ts` — `buildMaskFeature`, `padBounds`,
  `ARTBOARD_PAD`, `MASK_FILL_LIGHT` (`#d8d8d8`), `MASK_FILL_DARK` (`#06090e`).
  GeoJSON types imported from `geojson` (`import type`).
- `frontend/src/components/map/MapCanvas.tsx` — two new props
  (`maskPolygon?: MultiPolygon | null`, `clampPad?: number`); mask
  `<Source id="state-mask">` / `<Layer id="state-mask-fill">`; reactive
  `maskTheme` state; padded clamp decoupled from the fit target; `MIN_ZOOM=2`;
  conditional `renderWorldCopies:false`.
- `frontend/src/components/MapSurface.tsx` — threads the two new props through.
- `frontend/src/App.tsx` — resolves the polygon via `useStatePolygon` for a state
  scope and passes `maskPolygon` + `clampPad`.
- `frontend/src/components/MapLede.tsx` — adds a polite `aria-live` region so a
  chooser→state / state→state transition is announced without a focus move
  (epic a11y AC, owned by #762, unconditional).

## Tasks / acceptance criteria

1. **Polygon emit folded into the boundaries generator** — `generate-state-boundaries.mjs`
   emits `frontend/public/state-polygons.json` (a `code → geometry` map) from
   the same `canonicalFeatures` it builds for the geojson + SQL; asset committed;
   no new knip script ignore; README updated to state three artifacts.
2. **`mask.ts` util (TDD)** — `buildMaskFeature` (world outer ring + one hole per
   MultiPolygon part; Polygon → single hole; lakes/inner rings ignored);
   `padBounds` (expands by factor per side, clamps lat ±85 / lng ±180);
   `MASK_FILL_LIGHT === '#d8d8d8'`, `MASK_FILL_DARK === '#06090e'`.
3. **`state-polygons.ts` client access (TDD)** — `useStatePolygon` fetches once +
   caches; null for null/unknown code; null on fetch reject; `__resetCache` works.
4. **MapCanvas wiring (TDD)** — mask `<Source>`/`<Layer>` rendered iff `maskPolygon`;
   `fill-color` flips on `[data-theme]` toggle; padded clamp for state scope;
   `MIN_ZOOM` → 2; conditional `renderWorldCopies:false`; exact layer-count +
   source-presence assertions; reduced-motion duration on the net-new moves.
5. **App + MapSurface wiring** — `maskPolygon={statePolygon}`,
   `clampPad={isStateScope ? ARTBOARD_PAD : undefined}`.
6. **MapLede aria-live (TDD)** — polite live region announces the region label.

## Out of scope (deferred to siblings)

- Within-filter label isolation, symbol-layer heuristic matching, theme-swap
  label re-apply, stray fill/line sinking, halo/outline float layers → **#763**.
  Because the mask fill alone fails WCAG 1.4.11 non-text contrast (≈1.05:1 dark /
  ≈1.26:1 light), the load-bearing ≥3:1 boundary outline is #763's deliverable.
  **#762 ships the scope `aria-live` announcement regardless** (it is independent
  of the outline). The merged SUB1-only state is edge-invisible until #763 lands
  (outline path b — documented, not folded).
- e2e specs, `circle-11` console suppression, 5-viewport × 2-theme design-review
  → **#764**.

## Locked-decision #7 revision note

Decision #7 (`packages/db-client/src/state-boundaries.ts`) keeps state `geom`
server-side. This issue revises #7 **for cosmetic rendering only**: a simplified,
render-only polygon now ships to the client as a static asset. The server remains
the data-clip authority — `ST_Intersects` still performs the real clip — and the
client polygon derives from the SAME `data/us-state-polygons.geojson` the seed
migration was generated from (and now emitted from the SAME generator run), so
the gray mask edge matches the data-clip edge. No server route or DB access is
added.

## Asset-freshness risk (operator-run, uncaught by any gate)

CI never runs `generate-state-boundaries.mjs`; `vite` only copies the committed
`frontend/public/state-polygons.json` into the bundle. The "same generator run"
design guarantees the asset *can't drift from the seed at generation time*, but
does not guarantee the committed asset reflects the current seed. Treat
regeneration as a manual release step: if the boundaries seed is re-simplified,
an operator must re-run the generator and commit the new `state-polygons.json`.

## Prototype-gate note

The CLAUDE.md prototype gate exists to catch "looks fine in a demo, breaks at
production dimensions" rendering failures that scale with **data volume**. The
mask here is a single static fill layer — O(1) geometry, a world ring plus a few
hundred polygon vertices — that does NOT scale with observation volume, so it
introduces no new data-volume-dependent rendering risk. The gate's intent is
satisfied by the mandatory live multi-viewport Playwright verification (5
viewports × 2 themes, zero console errors/warnings, zoom-out + state-switch +
`?scope=us`-no-mask interaction checks) rather than a separate 344-row prototype.
