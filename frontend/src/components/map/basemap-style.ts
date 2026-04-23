/**
 * Basemap for the map surface.
 *
 * Points at OpenFreeMap's hosted `positron` style — free, MapLibre-compatible,
 * includes glyphs + sources + rendering layers. Prototype finding 2
 * (docs/plans/2026-04-22-map-v1-prototype/learnings.md) notes the style emits
 * MapLibre warnings at zoom >7, but those are cosmetic upstream issues, not
 * crashes. Acceptable for v1 ship.
 *
 * Future: self-hosted PMTiles at tiles.bird-maps.com (R2 bucket + CF Worker
 * already provisioned by Plan 7 S2, but the one-time build-basemap.sh upload
 * hasn't run yet, and a full style spec with land/water/road layers + glyphs
 * still needs authoring).
 */
export const basemapStyle = 'https://tiles.openfreemap.org/styles/positron';
