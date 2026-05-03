/**
 * Basemap for the map surface.
 *
 * Points at OpenFreeMap's hosted `positron` style — free, MapLibre-compatible,
 * includes glyphs + sources + rendering layers. Prototype finding 2
 * (docs/plans/2026-04-22-map-v1-prototype/learnings.md) notes the style emits
 * MapLibre warnings at zoom >7, but those are cosmetic upstream issues, not
 * crashes. Acceptable for production.
 *
 * No self-hosted tile pipeline is planned; the unapplied map-v1 PMTiles
 * Terraform was removed in #385 once it was confirmed the live map at
 * https://bird-maps.com fetches all tiles from `tiles.openfreemap.org`.
 */
export const basemapStyle = 'https://tiles.openfreemap.org/styles/positron';
