import { buffer } from '@turf/buffer';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

/**
 * State-artboard FIDELITY layer manipulation (#760/#763 — SUB2).
 *
 * #762 lands the inverse-mask FILL (source `state-mask` / layer `state-mask-fill`):
 * flat opaque theme-aware gray everywhere except the selected state. With the
 * fill alone the basemap symbol layers still render across the whole world, so
 * OTHER-state labels bleed onto the gray and labels straddling the state border
 * get sliced by the opaque fill. This module makes the artboard look *finished*:
 *
 *   1. `applyLabelIsolation` — merge a `['within', isolationPolygon]` test into
 *      each basemap symbol layer so exterior labels do not render and none are
 *      sliced; interior labels render whole. Captures + restores originals.
 *   2. `sinkStrayLayersBelowMask` — move stray basemap fill/line layers (country
 *      boundaries, coastlines, glaciers) painted ABOVE the mask beneath it so
 *      nothing bleeds onto the gray.
 *   3. `addFloatLayers` / `removeFloatLayers` — a blurred halo + a crisp,
 *      a11y-load-bearing outline above the mask so the artboard "floats".
 *
 * All functions take a minimal structural `ArtboardMap` (see below), NOT
 * react-map-gl's full `MapInstance`, so the helper is unit-testable against a
 * tiny spy object with no React render and no WebGL.
 *
 * GeoJSON structural types are imported from `geojson` (the @types/geojson
 * module), NOT from `maplibre-gl` — maplibre@5.x does not re-export them (see
 * the same note in `mask.ts`). `import type`, erased at build.
 */

/**
 * The canonical mask FILL layer id from #762 — the z-order anchor. Stray
 * basemap layers are sunk BELOW it; the float (halo/outline) layers go ABOVE
 * it (added with this id as the `beforeId` so they insert just above the fill,
 * beneath the observation/cluster layers).
 */
export const MASK_LAYER_ID = 'state-mask-fill';

/** Stable, app-owned float-layer ids so re-apply can guard + remove idempotently. */
export const ARTBOARD_HALO_ID = 'state-artboard-halo';
export const ARTBOARD_OUTLINE_ID = 'state-artboard-outline';

/**
 * Float-layer paint tokens.
 *
 * The crisp outline is the WCAG 1.4.11 load-bearing boundary: the mask fill
 * alone is ≈1.05:1 (dark `#06090e`) / ≈1.26:1 (light `#d8d8d8`) against the
 * adjacent in-state land, which fails the 3:1 non-text-contrast target. The
 * outline therefore carries an explicit ≥3:1 target against BOTH (i) the mask
 * fill and (ii) the adjacent land, in both themes:
 *
 *   LIGHT outline `#1a1d24` (near-black):
 *     vs mask fill `#d8d8d8` (L≈0.690) → contrast ≈ 12.3:1  ✓
 *     vs positron land (`#f8f4f0`, L≈0.940) → contrast ≈ 16.3:1  ✓
 *   DARK outline `#e8edf4` (near-white):
 *     vs mask fill `#06090e` (L≈0.0027) → contrast ≈ 16.4:1  ✓
 *     vs positron-dark land (`#0e1116`, L≈0.0055) → contrast ≈ 15.6:1  ✓
 *
 * (Ratios computed with the WCAG relative-luminance formula; recorded in the
 * PR body.) The halo is a soft drop-shadow in light / a soft glow in dark — it
 * reinforces the "float" but is NOT the load-bearing boundary, so its contrast
 * is not asserted.
 */
const OUTLINE_LIGHT = '#1a1d24';
const OUTLINE_DARK = '#e8edf4';
const HALO_LIGHT = '#3a3f4a'; // soft dark drop-shadow on the light gray field
const HALO_DARK = '#7fd0ff'; // soft cyan glow on the near-black dark field
const OUTLINE_WIDTH = 1.5;
const HALO_WIDTH = 6;
const HALO_BLUR = 4;
const HALO_OPACITY = 0.55;

/**
 * Minimal structural slice of the maplibre `Map` instance this module needs.
 * Defined locally (not imported from maplibre-gl) so the helper is trivially
 * mockable in unit tests and decoupled from react-map-gl's `MapInstance` churn.
 * The real `map` from `mapRef.current.getMap()` is structurally compatible.
 */
export interface ArtboardMap {
  getStyle: () => { layers?: Array<{ id: string; type: string }> } | undefined;
  getFilter: (layerId: string) => unknown;
  setFilter: (layerId: string, filter: unknown) => void;
  getLayer: (layerId: string) => unknown;
  moveLayer: (layerId: string, beforeId?: string) => void;
  addLayer: (layer: Record<string, unknown>, beforeId?: string) => void;
  removeLayer: (layerId: string) => void;
  triggerRepaint: () => void;
}

/**
 * Captured original filters, keyed by layer id, so isolation can be torn down
 * exactly (a layer with no original restores to `undefined` = "no filter").
 *
 * Kept private (not exported): the `MapCanvas.tsx` call site annotates the
 * handle with `ReturnType<typeof applyLabelIsolation>`, so this alias needs no
 * cross-file export. (Per #763: a cross-file-consumed export would be knip-clean
 * too — this is a readability choice, not a CI requirement.)
 */
type SavedFilters = Record<string, unknown>;

/**
 * The basemap symbol-layer name heuristic. Matched against the layer id with a
 * conservative place/label token pattern. Positron(light) and dark layer IDs
 * are NOT stable across the two styles, so we match by TYPE + NAME, never by a
 * hardcoded id list.
 *
 * **Fails OPEN by design:** a new/unmatched symbol layer in a future basemap
 * release simply renders exterior (detectable in QA) rather than throwing or
 * blanking the whole map. We never blanket-isolate every symbol layer.
 */
const SYMBOL_NAME_PATTERN =
  /(^|[-_])(place|settlement|poi|label|town|city|village|state|country)([-_]|$)/i;

/**
 * True iff the layer is a `symbol` layer whose id matches the place/label name
 * heuristic. Exported for a deterministic unit test of the selectivity +
 * fail-open contract.
 */
export function isIsolatableSymbolLayer(layer: { id: string; type: string }): boolean {
  return layer.type === 'symbol' && SYMBOL_NAME_PATTERN.test(layer.id);
}

/** Basemap layer types that can bleed onto the gray if painted above the mask. */
function isStrayBasemapLayer(layer: { id: string; type: string }): boolean {
  if (layer.type !== 'fill' && layer.type !== 'line') return false;
  // Never sink the mask itself or our own float layers.
  if (
    layer.id === MASK_LAYER_ID ||
    layer.id === ARTBOARD_HALO_ID ||
    layer.id === ARTBOARD_OUTLINE_ID
  ) {
    return false;
  }
  return true;
}

/**
 * Return an OUTWARD-buffered copy of the state polygon for the `within` LABEL
 * test ONLY. The mask FILL keeps the EXACT unbuffered `maskPolygon` so the gray
 * edge stays aligned with the server's `ST_Intersects` data-clip (#733).
 *
 * Why buffer: the `maskPolygon` is 5%-mapshaper-simplified, so its edge does
 * NOT coincide with the basemap's native label anchors. `['within', geom]`
 * returns FALSE for a point ON or OUTSIDE the boundary, so a legitimate INTERIOR
 * city near the border (e.g. Yuma, AZ) can fall on the wrong side of the
 * simplified edge and VANISH. An outward buffer pulls the test boundary out past
 * the simplified edge so near-border interior anchors survive.
 *
 * **Units:** `@turf/buffer`'s distance is KILOMETERS by default — NOT degrees.
 * `~0.05–0.1°` would be the wrong unit (and the "bbox strictly larger" check
 * would still pass, so the mistake would be silent). We use ~8 km — wide enough
 * to clear the 5%-simplified edge, narrow enough not to re-admit across-the-
 * border foreign-state labels (verified BOTH directions in the manual review).
 *
 * Returns a bare geometry object (`Polygon` | `MultiPolygon`) — the shape the
 * `['within', geom]` expression consumes — NOT a wrapped `Feature`. turf may
 * collapse a `MultiPolygon` whose parts merge after buffering into a single
 * `Polygon`, so both geometry types are handled.
 */
export function bufferIsolationPolygon(
  maskPolygon: MultiPolygon,
  distanceKm = 8,
): Polygon | MultiPolygon {
  const buffered = buffer(
    { type: 'Feature', properties: {}, geometry: maskPolygon } as Feature<MultiPolygon>,
    distanceKm,
    { units: 'kilometers' },
  );
  // Defensive: if turf ever returns undefined (degenerate input), fall back to
  // the exact polygon so labels still isolate (just without the buffer slack).
  if (!buffered?.geometry) return maskPolygon;
  return buffered.geometry as Polygon | MultiPolygon;
}

/**
 * Iterate `map.getStyle().layers`, match basemap symbol layers by the type+name
 * heuristic, capture each ORIGINAL filter, and merge `['within', isolationPolygon]`
 * into it:
 *   - no original  → `['within', isolationPolygon]`
 *   - has original → `['all', original, ['within', isolationPolygon]]`
 *
 * `isolationPolygon` MUST be the OUTWARD-BUFFERED polygon from
 * `bufferIsolationPolygon` (NOT the exact `maskPolygon` the fill uses — see that
 * function's note on near-border label survival).
 *
 * Returns the captured originals so `restoreLabelIsolation` can undo this
 * exactly when the mask unmounts (scope → us/chooser).
 *
 * Defensive idle-map flush: `setFilter` already schedules a render on its own,
 * so the trailing `triggerRepaint()` is belt-and-suspenders — a force-flush in
 * case the map is idle when the filter changes. It is NOT load-bearing (the
 * filter applies without it); it just avoids a 1-frame stale-paint window.
 */
export function applyLabelIsolation(
  map: ArtboardMap,
  isolationPolygon: Polygon | MultiPolygon,
): SavedFilters {
  const saved: SavedFilters = {};
  const style = map.getStyle();
  const layers = style?.layers ?? [];
  const withinExpr = ['within', isolationPolygon] as unknown[];

  for (const layer of layers) {
    if (!isIsolatableSymbolLayer(layer)) continue;
    const original = map.getFilter(layer.id);
    saved[layer.id] = original;
    const merged =
      original == null ? withinExpr : ['all', original, withinExpr];
    map.setFilter(layer.id, merged);
  }

  // Defensive idle-map flush (see fn doc) — NOT load-bearing.
  map.triggerRepaint();
  return saved;
}

/**
 * Restore each captured original filter (passing `undefined`/`null` clears the
 * filter back to "no filter"), then a defensive idle-map flush. Guarded so a
 * disposed map / removed layer after a style swap does not throw.
 */
export function restoreLabelIsolation(map: ArtboardMap, saved: SavedFilters): void {
  for (const [layerId, original] of Object.entries(saved)) {
    try {
      if (map.getLayer(layerId) == null) continue;
      map.setFilter(layerId, original);
    } catch {
      /* layer/style gone after a swap — defensive, matches existing guards */
    }
  }
  // Defensive idle-map flush (see applyLabelIsolation doc) — NOT load-bearing.
  map.triggerRepaint();
}

/**
 * Move every basemap fill/line layer painted ABOVE the mask beneath it via
 * `moveLayer(strayId, MASK_LAYER_ID)`, so no boundary/coastline/water-outline
 * bleeds on top of the gray. Layers already below the mask, symbol layers, the
 * mask itself, and the app-owned float layers are left untouched.
 *
 * The CALLER must have already `getLayer`-guarded `state-mask-fill` (see the
 * reconcile-sequencing blocker in MapCanvas): `moveLayer(x, 'state-mask-fill')`
 * throws `Cannot move layer before non-existing layer` if the reference layer
 * is absent. This function additionally no-ops if the mask is missing from the
 * style as a defensive backstop.
 */
export function sinkStrayLayersBelowMask(map: ArtboardMap, maskLayerId: string): void {
  const layers = map.getStyle()?.layers ?? [];
  const maskIndex = layers.findIndex((l) => l.id === maskLayerId);
  if (maskIndex === -1) return; // mask not in style — nothing to anchor against
  // Layers AFTER the mask in the array are painted ABOVE it.
  for (let i = maskIndex + 1; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!layer || !isStrayBasemapLayer(layer)) continue;
    try {
      map.moveLayer(layer.id, maskLayerId);
    } catch {
      /* defensive — layer/style churn after a swap */
    }
  }
}

/**
 * Add the halo (blurred `line`) + crisp outline (`line`) float layers above the
 * mask, theme-aware. Both trace the state polygon's exterior. Idempotent:
 * removes any existing instance (post theme-swap re-apply) before re-adding.
 *
 * The float layers source the EXACT state polygon (not the buffered isolation
 * polygon) — they draw the visible artboard edge, which must match the gray
 * fill edge. They get their own line `Source` (the inline `source` on a
 * line-layer spec), so they do not depend on the inverse-mask fill geometry.
 */
export function addFloatLayers(
  map: ArtboardMap,
  maskPolygon: MultiPolygon,
  maskLayerId: string,
  theme: 'light' | 'dark',
): void {
  // Idempotent guard: a theme-swap re-apply runs against the NEW style where a
  // prior instance may linger; remove before re-add so ids stay unique.
  removeFloatLayers(map);

  const outlineColor = theme === 'dark' ? OUTLINE_DARK : OUTLINE_LIGHT;
  const haloColor = theme === 'dark' ? HALO_DARK : HALO_LIGHT;

  // A line feature tracing every exterior ring of the state. (MapLibre draws a
  // `line` layer from a Polygon/MultiPolygon by stroking each ring.)
  const outlineFeature: Feature<MultiPolygon> = {
    type: 'Feature',
    properties: {},
    geometry: maskPolygon,
  };

  // Halo first so the crisp outline paints ON TOP of it. Both inserted with the
  // mask as `beforeId` → just above the fill, beneath the observation layers.
  map.addLayer(
    {
      id: ARTBOARD_HALO_ID,
      type: 'line',
      source: { type: 'geojson', data: outlineFeature },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': haloColor,
        'line-width': HALO_WIDTH,
        'line-blur': HALO_BLUR,
        'line-opacity': HALO_OPACITY,
      },
    },
    maskLayerId,
  );
  map.addLayer(
    {
      id: ARTBOARD_OUTLINE_ID,
      type: 'line',
      source: { type: 'geojson', data: outlineFeature },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': outlineColor,
        'line-width': OUTLINE_WIDTH,
      },
    },
    maskLayerId,
  );
}

/** Idempotent, guarded removal of both float layers (no throw if absent). */
export function removeFloatLayers(map: ArtboardMap): void {
  for (const id of [ARTBOARD_OUTLINE_ID, ARTBOARD_HALO_ID]) {
    try {
      if (map.getLayer(id) != null) map.removeLayer(id);
    } catch {
      /* defensive — layer/style gone after a swap or disposal */
    }
  }
}

/**
 * Composite for the FLOAT/SINK half of artboard fidelity (item 3b). This is the
 * half that MUST run from a `maskPolygon`-watching `mapReady`-gated effect AFTER
 * react-map-gl re-adds `state-mask-fill` — NOT from `style.load` (where the
 * reference layer does not yet exist; see the reconcile-sequencing blocker in
 * MapCanvas). The label-isolation half (`applyLabelIsolation`) runs separately
 * in `style.load`.
 *
 * Order: sink stray basemap layers below the mask, THEN add the float layers
 * above it.
 */
export function applyArtboardFidelity(
  map: ArtboardMap,
  maskPolygon: MultiPolygon,
  theme: 'light' | 'dark',
): void {
  sinkStrayLayersBelowMask(map, MASK_LAYER_ID);
  addFloatLayers(map, maskPolygon, MASK_LAYER_ID, theme);
}
