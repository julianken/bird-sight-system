import { buffer } from '@turf/buffer';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

/**
 * State-artboard FIDELITY layer manipulation (#760/#763 — SUB2).
 *
 * #762 lands the inverse-mask FILL (source `state-mask` / layer `state-mask-fill`):
 * flat opaque theme-aware gray everywhere except the selected state. #762 renders
 * that fill as a react-map-gl `<Layer>` with NO `beforeId`, so it lands ON TOP of
 * the WHOLE basemap — including the basemap symbol (label) layers. With the fill
 * alone OTHER-state labels bleed onto the gray, and an INTERIOR label straddling
 * the (server-clipped) border gets SLICED by the opaque fill above it. This
 * module makes the artboard look *finished*:
 *
 *   1. `moveMaskBelowFirstLabel` — move `state-mask-fill` BELOW the first basemap
 *      label (`symbol`) layer so `within`-passing INTERIOR labels render ON TOP
 *      of the gray (whole, overhang onto the gray included). This is the
 *      "isolate mode" of the v3 mockup and the fix for the interior-label
 *      clipping regression — without it the mask sits above the labels and any
 *      near-border interior label is sliced by the gray.
 *   2. `applyLabelIsolation` — merge a `['within', isolationPolygon]` test into
 *      each basemap symbol layer so exterior labels do not render; interior
 *      labels render whole. Captures + restores originals.
 *   3. `sinkStrayLayersBelowMask` — move stray basemap fill/line layers (country
 *      boundaries, coastlines, glaciers) painted ABOVE the mask beneath it so
 *      nothing bleeds onto the gray.
 *   4. `addFloatLayers` / `removeFloatLayers` — a blurred halo + a crisp,
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
 * Stable, app-owned source id shared by BOTH float layers. Using one EXPLICIT
 * named source (rather than an inline `source` object per layer) is load-bearing
 * for theme swaps: an inline source is auto-named and is NOT removed by
 * `removeLayer`, so each `setStyle` swap orphaned two anonymous sources. The
 * orphans surfaced as a maplibre render-time `coalesceChanges` TypeError
 * ("Cannot convert undefined or null to object") under rapid swaps. A named
 * source we add/remove explicitly avoids the orphan entirely.
 */
export const ARTBOARD_LINE_SOURCE_ID = 'state-artboard-line';

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
  getStyle: () =>
    | { layers?: Array<{ id: string; type: string; source?: string }> }
    | undefined;
  getFilter: (layerId: string) => unknown;
  setFilter: (layerId: string, filter: unknown) => void;
  getLayer: (layerId: string) => unknown;
  getSource: (sourceId: string) => unknown;
  addSource: (sourceId: string, source: Record<string, unknown>) => void;
  removeSource: (sourceId: string) => void;
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
 * conservative place/label token pattern. The two basemaps use DIFFERENT layer
 * id conventions, so we match by TYPE + NAME, never by a hardcoded id list:
 *   - DARK (`.../styles/dark`): underscore ids — `place_city`, `place_country*`,
 *     `water_name`, `highway_name_motorway`, `highway_name_other`.
 *   - LIGHT (`.../styles/positron`): a mix of `label_*` (`label_other`,
 *     `label_city`, `label_country_1`…) AND HYPHENATED road labels
 *     (`highway-name-major`, `highway-name-minor`, `highway-name-path`),
 *     shields (`road_shield_us`, `highway-shield-us-interstate`,
 *     `highway-shield-non-us`), and `airport`.
 *
 * Tokens:
 *   - place/label tokens: `place|settlement|poi|label|town|city|village|state|
 *     country` (catches both `place_city` AND `label_city`).
 *   - `name` with EITHER an underscore OR a hyphen separator
 *     (`[-_]name([-_]|$)`) — catches the dark `water_name`/`highway_name_*` AND
 *     the light `highway-name-*`. The earlier `_name(_|$)`-only form silently
 *     missed the light basemap's hyphenated road labels, so VA-side freeway
 *     names bled onto the gray once the mask dropped below the labels (#762/#763
 *     interior-label-clipping fix). The separator class is what now catches them.
 *   - `shield` / `airport` — the light basemap renders road shields and the
 *     airport label as their own symbol layers with no place/label/name token;
 *     both are decorations tied to a road/place and must isolate with the rest.
 *
 * **`road_oneway` is still EXCLUDED** (the original calibration constraint): it
 * is an icon-only arrow layer with no place/label/`name`/`shield`/`airport`
 * token, so it does NOT match — a bare `road`/`highway` token (deliberately not
 * used) would have wrongly within-isolated that LineString arrow set, dropping
 * in-state arrows along with foreign ones. We require a label-bearing token.
 *
 * **Fails OPEN by design:** a new/unmatched symbol layer in a future basemap
 * release simply renders exterior (detectable in QA) rather than throwing or
 * blanking the whole map. We never blanket-isolate every symbol layer.
 */
const SYMBOL_NAME_PATTERN =
  /(^|[-_])(place|settlement|poi|label|town|city|village|state|country|shield|airport)([-_]|$)|[-_]name([-_]|$)/i;

/**
 * True iff the layer is a basemap text-LABEL `symbol` layer that should be
 * within-isolated. Matches by the name heuristic but EXCLUDES the app's own
 * observation/cluster symbol layers (`source: 'observations'`) so the bird data
 * is never isolated even if a future basemap names a layer collisionally — a
 * belt over the name heuristic's fail-open default.
 */
export function isIsolatableSymbolLayer(layer: {
  id: string;
  type: string;
  source?: string;
}): boolean {
  if (layer.type !== 'symbol') return false;
  if (layer.source === 'observations') return false; // never isolate bird layers
  return SYMBOL_NAME_PATTERN.test(layer.id);
}

/**
 * True iff the layer is a basemap text-LABEL `symbol` layer that the mask FILL
 * should be moved BELOW (the "isolate mode" of the v3 mockup). Reuses the same
 * type+name heuristic as `isIsolatableSymbolLayer` so the mask anchors on the
 * SAME class of layer the `within` isolation operates on — but additionally
 * EXCLUDES the app-owned float layers (`state-artboard-*`). Those are `line`
 * layers (so the symbol check already drops them), but the exclusion is an
 * explicit belt in case a future float layer is ever a symbol.
 *
 * `isIsolatableSymbolLayer` already excludes `source: 'observations'` (the
 * cluster-count / unclustered-point app symbol layers), so anchoring the mask
 * here can never land it below the bird data.
 */
function isFirstLabelAnchorLayer(layer: {
  id: string;
  type: string;
  source?: string;
}): boolean {
  if (layer.id === ARTBOARD_HALO_ID || layer.id === ARTBOARD_OUTLINE_ID) {
    return false;
  }
  return isIsolatableSymbolLayer(layer);
}

/**
 * Move `state-mask-fill` BELOW the FIRST basemap label (`symbol`) layer so the
 * `within`-filtered INTERIOR labels render ON TOP of the gray — i.e. a label
 * that overhangs the (server-clipped) state boundary into the gray is drawn
 * WHOLE rather than sliced by the opaque mask fill (#762/#763 interior-label
 * clipping regression).
 *
 * Root cause this repairs: #762 renders the mask as a react-map-gl `<Layer
 * id="state-mask-fill">` with NO `beforeId`, so react-map-gl appends it ON TOP
 * of the entire basemap — including the basemap symbol/label layers. #763's
 * `sinkStrayLayersBelowMask` only moves `fill`/`line` strays below the mask
 * (never `symbol`), so the label layers stayed UNDER the mask and any interior
 * label straddling the border got clipped by the gray. Lowering the mask below
 * the first label layer puts every basemap label back on top of the gray; the
 * `within` filter (unchanged) keeps EXTERIOR labels removed, so only whole
 * interior labels — overhang onto the gray included — remain.
 *
 * **Fails OPEN.** Guards on `getLayer(maskLayerId)` (warn-and-return if the
 * mask is absent — the reconcile-sequencing window). If NO basemap symbol/label
 * layer is found, the mask is left exactly where it is (no throw, no move) —
 * the worst case is the pre-fix clipping, never a blanked map.
 *
 * Idempotent: re-running after the mask is already beneath the first label is a
 * no-op `moveLayer(maskLayerId, sameAnchor)` (MapLibre tolerates moving a layer
 * to its current relative position). The CALLER re-applies this wherever
 * fidelity runs (the `maskPolygon` effect AND the `style.load` re-apply path),
 * so the imperative move survives react-map-gl reconciles and theme swaps.
 */
export function moveMaskBelowFirstLabel(map: ArtboardMap, maskLayerId: string): void {
  if (map.getLayer(maskLayerId) == null) {
    console.warn(
      `[artboard] ${maskLayerId} absent; cannot move below labels (deferring)`,
    );
    return;
  }
  const layers = map.getStyle()?.layers ?? [];
  const firstLabel = layers.find((l) => isFirstLabelAnchorLayer(l));
  if (!firstLabel) return; // no basemap label layer found — fail open, leave as-is
  try {
    map.moveLayer(maskLayerId, firstLabel.id);
  } catch {
    /* defensive — layer/style churn after a swap */
  }
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
 * would still pass, so the mistake would be silent).
 *
 * **Width = 0.2 km (calibrated live, NOT the spec's 8 km starting point).** The
 * AC requires BOTH directions: near-border INTERIOR labels survive AND
 * across-the-border FOREIGN labels stay gone. The binding constraint on the AZ
 * S border is Heroica Nogales (MX): its `place_city` label anchor (−110.945,
 * 31.329) sits only ~0.4 km south of the surveyed AZ-Sonora line (lat 31.3322).
 * Live measurement of turf's buffered southern edge:
 *   - 0.2 km → lat 31.3304  → Nogales (31.329) is SOUTH of it → EXCLUDED ✓
 *   - 0.5 km → lat 31.3277  → Nogales is NORTH of it → wrongly RE-ADMITTED ✗
 *   - 8 km   → far south    → re-admits Nogales, El Sásabe, San Luis MX, Blythe
 * Meanwhile every interior near-border anchor is ≥3.5 km INSIDE the simplified
 * polygon (Yuma 4.3 km, Sasabe AZ 5.3 km, San Luis AZ 3.5 km) so they survive
 * `within → true` even un-buffered; the buffer only covers the sub-km
 * 5%-simplification anchor-drift, NOT a wide margin. 0.2 km is the largest width
 * below Nogales's ~0.4 km gap, keeping the bbox strictly larger than the exact
 * fill polygon (the within-vs-fill distinction) while excluding the on-border
 * Mexican cities. Tunable, but raising it past ~0.35 km re-admits Nogales.
 *
 * Returns a bare geometry object (`Polygon` | `MultiPolygon`) — the shape the
 * `['within', geom]` expression consumes — NOT a wrapped `Feature`. turf may
 * collapse a `MultiPolygon` whose parts merge after buffering into a single
 * `Polygon`, so both geometry types are handled.
 */
export function bufferIsolationPolygon(
  maskPolygon: MultiPolygon,
  distanceKm = 0.2,
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
 * Add the halo (blurred `line`) + crisp outline (`line`) float layers ABOVE the
 * mask, theme-aware. Both trace the state polygon's exterior. Idempotent:
 * removes any existing instance (post theme-swap re-apply) before re-adding.
 *
 * The float layers source the EXACT state polygon (not the buffered isolation
 * polygon) — they draw the visible artboard edge, which must match the gray
 * fill edge. They get their own inline line `Source`, so they do not depend on
 * the inverse-mask fill geometry.
 *
 * **Z-order:** MapLibre's `addLayer(layer, beforeId)` inserts `layer` BELOW
 * `beforeId`. To paint the floats ABOVE the mask (so they land on the gray, not
 * under it) we anchor on the layer that currently sits just ABOVE the mask
 * (the first observation/cluster layer — e.g. `clusters`). That places the
 * floats between the mask fill and the bird layers: gray fill → halo → outline
 * → observations. If no layer sits above the mask yet, we append on top.
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

  // Anchor: the first layer ABOVE the mask. addLayer(spec, anchor) inserts the
  // spec just below `anchor` → just above the mask. Skip our own float ids so a
  // re-add after a non-removed prior instance still anchors correctly.
  const layers = map.getStyle()?.layers ?? [];
  const maskIndex = layers.findIndex((l) => l.id === maskLayerId);
  let aboveMaskAnchor: string | undefined;
  if (maskIndex !== -1) {
    for (let i = maskIndex + 1; i < layers.length; i += 1) {
      const id = layers[i]?.id;
      if (id && id !== ARTBOARD_HALO_ID && id !== ARTBOARD_OUTLINE_ID) {
        aboveMaskAnchor = id;
        break;
      }
    }
  }

  // A line feature tracing every exterior ring of the state. (MapLibre draws a
  // `line` layer from a Polygon/MultiPolygon by stroking each ring.) Both float
  // layers share ONE explicit named source (see ARTBOARD_LINE_SOURCE_ID) so the
  // source is removable on teardown and never orphans across a setStyle swap.
  const outlineFeature: Feature<MultiPolygon> = {
    type: 'Feature',
    properties: {},
    geometry: maskPolygon,
  };
  map.addSource(ARTBOARD_LINE_SOURCE_ID, { type: 'geojson', data: outlineFeature });

  // Halo added first, then the crisp outline — so the outline paints ON TOP of
  // the halo (both below `aboveMaskAnchor`, i.e. just above the mask fill).
  map.addLayer(
    {
      id: ARTBOARD_HALO_ID,
      type: 'line',
      source: ARTBOARD_LINE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': haloColor,
        'line-width': HALO_WIDTH,
        'line-blur': HALO_BLUR,
        'line-opacity': HALO_OPACITY,
      },
    },
    aboveMaskAnchor,
  );
  map.addLayer(
    {
      id: ARTBOARD_OUTLINE_ID,
      type: 'line',
      source: ARTBOARD_LINE_SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': outlineColor,
        'line-width': OUTLINE_WIDTH,
      },
    },
    aboveMaskAnchor,
  );
}

/**
 * Idempotent, guarded removal of both float layers AND their shared source (no
 * throw if absent). The source is removed LAST — maplibre errors if a source is
 * removed while a layer still references it.
 */
export function removeFloatLayers(map: ArtboardMap): void {
  for (const id of [ARTBOARD_OUTLINE_ID, ARTBOARD_HALO_ID]) {
    try {
      if (map.getLayer(id) != null) map.removeLayer(id);
    } catch {
      /* defensive — layer/style gone after a swap or disposal */
    }
  }
  try {
    if (map.getSource(ARTBOARD_LINE_SOURCE_ID) != null) {
      map.removeSource(ARTBOARD_LINE_SOURCE_ID);
    }
  } catch {
    /* defensive — source gone after a swap or disposal */
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
 * Order of operations (load-bearing):
 *   1. `moveMaskBelowFirstLabel` — lower `state-mask-fill` BENEATH the first
 *      basemap label (`symbol`) layer so `within`-filtered INTERIOR labels
 *      render ON TOP of the gray (whole, overhang onto the gray included) — the
 *      "isolate mode" of the v3 mockup; repairs the interior-label-clipping
 *      regression where a near-border label was sliced by the opaque mask.
 *   2. `sinkStrayLayersBelowMask` — move stray basemap fill/line layers painted
 *      ABOVE the mask beneath it (coastlines, boundaries) so nothing bleeds.
 *   3. `addFloatLayers` — halo + crisp outline ABOVE the mask. The crisp outline
 *      remains a clear top edge regardless of where the mask now sits.
 *
 * Step 1 runs FIRST: the float/sink anchors derive from the mask's NEW position
 * in the layer array, and the stray-sink only needs to act on fill/line layers
 * that end up above the lowered mask. Moving the mask first means the
 * subsequent `getStyle().layers` reads reflect the final mask index.
 */
export function applyArtboardFidelity(
  map: ArtboardMap,
  maskPolygon: MultiPolygon,
  theme: 'light' | 'dark',
): void {
  moveMaskBelowFirstLabel(map, MASK_LAYER_ID);
  sinkStrayLayersBelowMask(map, MASK_LAYER_ID);
  addFloatLayers(map, maskPolygon, MASK_LAYER_ID, theme);
}
