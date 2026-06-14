import type { Feature, MultiPolygon, Polygon, Position } from 'geojson';

/**
 * State-artboard inverse mask (#760).
 *
 * The mask is a single MapLibre `fill` layer painting "everywhere except the
 * selected state" as flat opaque gray, so a `?state=US-XX` scope reads as a
 * Sketch-style artboard: the state floats on a neutral map-background field and
 * can be zoomed out (the clamp is the state bbox padded outward — see
 * `padBounds`/`ARTBOARD_PAD`).
 *
 * MapLibre's earcut triangulation treats the first linear ring of a Polygon as
 * the exterior and EVERY subsequent ring as a hole. So a single Polygon whose
 * coordinates are `[worldRing, ...stateExteriorRings]` paints the whole world
 * minus the state — one fill, no per-feature math.
 *
 * GeoJSON structural types (`Feature`/`Polygon`/`MultiPolygon`/`Position`) are
 * imported from `geojson` (the @types/geojson module), NOT from `maplibre-gl`:
 * maplibre-gl@5.x does not re-export these structural interfaces (its dist
 * `.d.ts` only exports a runtime `GeoJSONFeature` class and the filter-spec
 * `Feature` type, which is the wrong shape). These are all `import type`, erased
 * at build, so they pull no runtime maplibre chunk.
 */

/**
 * Web-mercator-safe world rectangle. Latitude is clamped to ±85 because the
 * Web Mercator projection diverges toward the poles; ±85 is the canonical
 * MapLibre world bound. The ring is explicitly closed (first === last).
 */
const WORLD_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/**
 * Inverse mask: a world-covering polygon with the state's exterior rings punched
 * out as holes. Interior rings (lakes) of the state are intentionally ignored —
 * the artboard masks the land outside the state, not water inside it.
 */
export function buildMaskFeature(geometry: Polygon | MultiPolygon): Feature<Polygon> {
  const holes: Position[][] = [];
  if (geometry.type === 'Polygon') {
    // coordinates[0] is the exterior ring; later rings are lakes — skip them.
    if (geometry.coordinates[0]) holes.push(geometry.coordinates[0]);
  } else {
    // One exterior ring per part; [0] of each part is that part's exterior.
    for (const poly of geometry.coordinates) {
      if (poly[0]) holes.push(poly[0]);
    }
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] },
  };
}

export type LngLatBounds = [[number, number], [number, number]];

const MERC_MAX_LAT = 85;

/**
 * Expand a `[[w,s],[e,n]]` bbox outward by `factor`× its width/height per side,
 * clamping longitude to ±180 and latitude to ±85 (web-mercator safe). Used to
 * derive the artboard `maxBounds` clamp from the tight state envelope so the
 * state can shrink on the gray field before the clamp stops the zoom-out.
 */
export function padBounds([[w, s], [e, n]]: LngLatBounds, factor: number): LngLatBounds {
  const dw = (e - w) * factor;
  const dh = (n - s) * factor;
  const cx = (x: number) => Math.max(-180, Math.min(180, x));
  const cy = (y: number) => Math.max(-MERC_MAX_LAT, Math.min(MERC_MAX_LAT, y));
  return [
    [cx(w - dw), cy(s - dh)],
    [cx(e + dw), cy(n + dh)],
  ];
}

/**
 * Artboard clamp padding factor. 1.0 ⇒ +100% per side ⇒ ≈3× the state envelope,
 * so the state can shrink to roughly 1/3 of the viewport on gray before the
 * `maxBounds` clamp halts further zoom-out.
 */
export const ARTBOARD_PAD = 1.0;

/**
 * Theme-aware mask fill. These are the v3 mockup-LOCKED values (maintainer-
 * approved live), not the prototype's `#e7e2d6` / `#161b27` (a dark-on-dark
 * mistake). `#06090e` is intentionally *darker* than positron-dark land
 * (`#0e1116`) so the state stays the lighter "lit" artboard element in dark
 * mode; `#d8d8d8` is a flat neutral gray in light mode.
 */
export const MASK_FILL_LIGHT = '#d8d8d8';
export const MASK_FILL_DARK = '#06090e';
