import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * Pure helpers backing the issue #248 cluster-mosaic feature.
 *
 * Two pieces split out of MapCanvas so the reconciler can stay focused on
 * marker lifecycle (mount/unmount) while the data-shaping logic gets unit
 * tests against canned input:
 *
 *   1. `aggregateClusterFamilies` — reduces a getClusterLeaves() result into
 *      a sorted [{familyCode, count}] list. Sort is descending by count,
 *      then ascending by familyCode for ties (deterministic for snapshot
 *      tests + visual stability across pan/zoom; user shouldn't see TL/TR
 *      swap when two families tie at count=1).
 *
 *   2. `buildMosaicTiles` — joins the aggregated families against the
 *      silhouettes prop, taking the top-`MOSAIC_TILE_COUNT`. Each tile gets
 *      the family's color + svgData. Missing svgData (uncurated rows per
 *      #245) or missing family entry (unseeded code) flags `isFallback:
 *      true`; the renderer paints those at 50% opacity with a generic
 *      placeholder shape.
 */

/**
 * Maximum number of tiles in the 2×2 mosaic. Pinned as a public constant so
 * a future shift to a 3×3 grid moves this value rather than scattering
 * magic numbers across MapCanvas + MosaicMarker.
 */
export const MOSAIC_TILE_COUNT = 4;

/**
 * Minimal shape of a cluster leaf as returned by maplibre-gl 5.x's
 * `GeoJSONSource.getClusterLeaves`. Only `properties.familyCode` is read;
 * everything else (geometry, id, type discriminator) is ignored. Kept
 * structurally typed so test fixtures don't have to construct full
 * MapGeoJSONFeature instances.
 */
export interface ClusterLeafFeature {
  type: 'Feature';
  properties: {
    familyCode: string | null;
  } & Record<string, unknown>;
}

export interface FamilyAggregate {
  familyCode: string;
  count: number;
}

export interface MosaicTile {
  familyCode: string;
  /** Number of leaves in this cluster matching this family. */
  count: number;
  color: string;
  /**
   * Path-`d` string from family_silhouettes.svg_data, or null when the
   * source row is uncurated (#245 will replace placeholders with real
   * Phylopic SVGs). Renderer treats null + missing-family-row uniformly.
   */
  svgData: string | null;
  /**
   * True when the silhouettes prop has no entry for `familyCode` OR the
   * matching entry has `svgData === null`. The renderer paints fallback
   * tiles at reduced opacity with a generic placeholder shape so users
   * still see "something is here" without the family color reading as
   * authoritative.
   */
  isFallback: boolean;
}

/**
 * Reduce the leaves of a single cluster into a sorted
 * [{familyCode, count}] list. Leaves with `properties.familyCode === null`
 * are skipped — they cannot drive a mosaic tile (no family to look up).
 *
 * Sort: descending count, ascending familyCode for ties. The tie-breaker
 * is what keeps mosaic tile order stable across renders; without it, two
 * families tied at count=1 could swap positions on every reconciler pass.
 */
export function aggregateClusterFamilies(
  leaves: ClusterLeafFeature[],
): FamilyAggregate[] {
  const counts = new Map<string, number>();
  for (const leaf of leaves) {
    const code = leaf.properties.familyCode;
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([familyCode, count]) => ({ familyCode, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.familyCode.localeCompare(b.familyCode);
    });
}

/**
 * Join the top-N family aggregates against the silhouettes prop and emit
 * up to `MOSAIC_TILE_COUNT` tiles. Order is preserved from the input
 * (which `aggregateClusterFamilies` returns sorted) so the caller controls
 * positional placement (TL → TR → BL → BR).
 *
 * Lookup is O(N + S) where N = unique families in the cluster and S =
 * silhouettes prop length. Both are bounded by the # of AZ bird families
 * (~80), so the linear scan is fine — no Map memo needed.
 */
export function buildMosaicTiles(
  families: FamilyAggregate[],
  silhouettes: FamilySilhouette[],
): MosaicTile[] {
  const lookup = new Map<string, FamilySilhouette>();
  for (const s of silhouettes) lookup.set(s.familyCode, s);

  const top = families.slice(0, MOSAIC_TILE_COUNT);
  return top.map((entry) => {
    const silhouette = lookup.get(entry.familyCode);
    if (!silhouette) {
      return {
        familyCode: entry.familyCode,
        count: entry.count,
        // No silhouette row → no authoritative color; fall back to neutral.
        color: '#888888',
        svgData: null,
        isFallback: true,
      };
    }
    return {
      familyCode: entry.familyCode,
      count: entry.count,
      color: silhouette.color,
      svgData: silhouette.svgData,
      // svgData null = uncurated row (Phylopic curation pending per #245).
      // Same fallback behavior as a missing family row — the renderer
      // doesn't need to distinguish the two cases.
      isFallback: silhouette.svgData === null,
    };
  });
}
