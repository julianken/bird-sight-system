/**
 * Adaptive cluster-grid logic for the `<AdaptiveGridMarker>` component
 * (epic #539, spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`).
 *
 * This module is the pure-logic + types layer that backs the marker:
 *
 *   - `toPositiveInt` / `PositiveInt`: branded type for `hiddenCount`, so
 *     a `grid-overflow` shape cannot be constructed with a non-positive
 *     hidden count (spec §4.1).
 *   - `pickGridShape(uniqueFamilies, pointCount, isMobile) → GridShape`:
 *     the §4.1 sizing-rules table encoded as a function. Returns a
 *     discriminated union (`grid` / `grid-overflow` / `pill`) so callers
 *     can narrow at the type level — `pill` is unreachable for the
 *     marker component, which only accepts `ResolvedGrid`.
 *   - `buildAdaptiveTiles(leaves, silhouettesById, shape) → AdaptiveTile[]`:
 *     the pure tile-builder. Aggregates leaves by family, resolves each
 *     family against the supplied silhouette catalogue, and produces a
 *     `rendered | fallback | pending` tile per visible slot. Pure by
 *     contract — does NOT read from any module-scoped ref (spec §5.3
 *     Concern C, point 3).
 *   - `aggregateClusterFamilies`: moved verbatim from `cluster-mosaic.ts`
 *     (Phase 2 deletes the source). Behavior preserved: descending count,
 *     ascending familyCode tie-break, null-familyCode dropout.
 */

export type PositiveInt = number & { readonly __brand: 'PositiveInt' };

export function toPositiveInt(n: number): PositiveInt {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`Expected a positive integer, got ${n}. Value must be a positive integer.`);
  }
  return n as PositiveInt;
}

export type Dim = 1 | 2 | 3 | 4;

export type GridShape =
  | { tag: 'grid'; cols: Dim; rows: Dim }
  | { tag: 'grid-overflow'; cols: Dim; rows: Dim; hiddenCount: PositiveInt }
  | { tag: 'pill' };

/** What `<AdaptiveGridMarker>` accepts — pill is rendered by a sibling component. */
export type ResolvedGrid = Exclude<GridShape, { tag: 'pill' }>;

/**
 * Helper, not a stored field — derived deterministically from the shape's
 * dimensions. `grid` uses every cell; `grid-overflow` reserves the last
 * cell for the "+N more" indicator.
 */
export function visibleCapacity(shape: ResolvedGrid): number {
  return shape.tag === 'grid'
    ? shape.cols * shape.rows
    : shape.cols * shape.rows - 1;
}

const MAX_FAMILIES = 16;
const MAX_OBSERVATIONS = 64;
const MOBILE_GRID_OVERFLOW_VISIBLE = 8;

/**
 * Pick the grid shape for a cluster, per spec §4.1.
 *
 * Order of precedence:
 *   1. Pill fallback when uniqueFamilies > 16 OR pointCount > 64.
 *   2. Mobile cap: on isMobile, families > 8 → 3×3 grid-overflow.
 *   3. Desktop sizing table (1, 2, 3-4, 5-9, 10-16).
 */
export function pickGridShape(
  uniqueFamilies: number,
  pointCount: number,
  isMobile: boolean,
): GridShape {
  if (uniqueFamilies > MAX_FAMILIES || pointCount > MAX_OBSERVATIONS) {
    return { tag: 'pill' };
  }
  if (isMobile && uniqueFamilies > MOBILE_GRID_OVERFLOW_VISIBLE) {
    return {
      tag: 'grid-overflow',
      cols: 3,
      rows: 3,
      hiddenCount: toPositiveInt(uniqueFamilies - MOBILE_GRID_OVERFLOW_VISIBLE),
    };
  }
  if (uniqueFamilies === 1) return { tag: 'grid', cols: 1, rows: 1 };
  if (uniqueFamilies === 2) return { tag: 'grid', cols: 2, rows: 1 };
  if (uniqueFamilies <= 4) return { tag: 'grid', cols: 2, rows: 2 };
  if (uniqueFamilies <= 9) return { tag: 'grid', cols: 3, rows: 3 };
  return { tag: 'grid', cols: 4, rows: 4 };
}

/**
 * Minimal shape of a cluster leaf as returned by maplibre-gl 5.x's
 * `GeoJSONSource.getClusterLeaves`. Only `properties.familyCode` is read;
 * everything else (geometry, id, type discriminator) is ignored. Kept
 * structurally typed so test fixtures don't have to construct full
 * MapGeoJSONFeature instances.
 *
 * Copied from `cluster-mosaic.ts` so this module is independent of the
 * legacy file (Phase 2 deletes that file atomically).
 */
export interface ClusterLeafFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    /** Family code. Null when the join in `observationsToGeoJson` doesn't hit. */
    familyCode: string | null;
    /**
     * eBird 6-char species code. Threaded onto each feature by
     * `observationsToGeoJson` (issue #557 / spec §4.11). `null` for
     * spuh/slash/hybrid taxa where eBird returns no code; preserved
     * by `aggregateClusterSpecies` as a non-clickable row.
     */
    speciesCode: string | null;
    /** Display common name. Always present per eBird API contract. */
    comName: string;
    /** Whether this observation is in eBird's notable list. */
    isNotable?: boolean;
  };
}

export interface FamilyAggregate {
  familyCode: string;
  count: number;
}

/**
 * Per-family lookup passed to `buildAdaptiveTiles`. The caller resolves
 * this once per reconcile from the silhouette catalogue (the upstream
 * silhouette-resolution rule from spec §5.3 Concern C). An empty map
 * signals "catalogue not loaded yet" — distinct from "loaded but no art
 * for this family" — and produces `kind: 'pending'` tiles.
 */
export type SilhouettesById = ReadonlyMap<
  string,
  { svgData: string | null; color: string; colorDark: string }
>;

/**
 * Per-cell datum the marker renders. Three variants:
 *   - `rendered`: catalogue loaded, family has CC-licensed art.
 *   - `fallback`: catalogue loaded, family has no art (uncurated /
 *     missing). Renderer paints at opacity 0.5 with a generic shape.
 *   - `pending`: catalogue not yet loaded for ANY family. Renderer
 *     paints a skeleton/shimmer so a cold-load map is distinguishable
 *     from a real coverage gap (spec §5.1 type comment).
 *
 * `species` is the per-species breakdown for this family in the cluster,
 * threaded onto every variant for Phase 1+ popovers (issue #557, spec §4.1).
 * Sum invariant: `sum(species[].count) === count`.
 *
 * `speciesCount` (#859) is the family's TRUE distinct-species count — the
 * aggregated bucket's `family.speciesCount`, which can EXCEED `species.length`
 * because `species` is capped to the backend's top-N per family. The per-family
 * `<CellPopover>` reads it to size the "+N more" overflow and decide whether to
 * offer the active drill-in. Optional: the per-observation path can't know a
 * true distinct count beyond the leaves it merged, so it omits the field and
 * the popover falls back to the rendered-row remainder.
 */
export type AdaptiveTile =
  | { kind: 'rendered'; familyCode: string; svgData: string; color: string; colorDark: string;
      count: number; species: ReadonlyArray<SpeciesAggregate>; speciesCount?: number }
  | { kind: 'fallback'; familyCode: string; color: string; colorDark: string;
      count: number; species: ReadonlyArray<SpeciesAggregate>; speciesCount?: number }
  | { kind: 'pending'; familyCode: string;
      count: number; species: ReadonlyArray<SpeciesAggregate>; speciesCount?: number };

/**
 * Reduce the leaves of a single cluster into a sorted
 * [{familyCode, count}] list. Leaves with `properties.familyCode === null`
 * are skipped — they cannot drive a tile (no family to look up).
 *
 * Sort: descending count, ascending familyCode for ties. The tie-breaker
 * keeps tile order stable across renders; without it, two families tied
 * at count=1 could swap positions on every reconciler pass.
 *
 * Moved verbatim from `cluster-mosaic.ts:80-95` per spec §6 / plan
 * Task 1.4. The legacy file is deleted in Phase 2.
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
 * Pure tile-builder for `<AdaptiveGridMarker>`. Aggregates the cluster's
 * leaves, takes the top `visibleCapacity(shape)` families (caller pads
 * visually if fewer families are present), and resolves each against the
 * `silhouettesById` map to produce a discriminated-union tile.
 *
 * Spec §5.3 Concern C (point 3): this function MUST NOT read from any
 * module-scoped ref. The caller threads the resolved catalogue
 * explicitly, so an in-flight reconcile cannot pick up a newer
 * catalogue mid-flight and produce mismatched tiles. Tests assert that
 * identical leaves with different `silhouettesById` arguments produce
 * differently-resolved tiles.
 *
 * Empty `silhouettesById` is treated as "catalogue not loaded yet" and
 * yields all-`pending` tiles, distinct from the per-family "loaded but
 * no art" `fallback` case.
 */
export function buildAdaptiveTiles(
  leaves: ClusterLeafFeature[],
  silhouettesById: SilhouettesById,
  shape: ResolvedGrid,
): ReadonlyArray<AdaptiveTile> {
  const families = aggregateClusterFamilies(leaves);
  const speciesByFamily = aggregateClusterSpecies(leaves);
  return tilesFromAggregates(families, speciesByFamily, silhouettesById, shape);
}

/**
 * Tile builder from PRE-AGGREGATED families + species (#859 — aggregated
 * bucket mode). At low zoom each cluster leaf is a whole BUCKET carrying many
 * families with real per-family counts, so the per-leaf `aggregateClusterFamilies`
 * recount (one leaf = one observation) is wrong. The bucket path merges the
 * member buckets first (`mergeLeafBuckets`) and passes the resulting exact
 * `FamilyAggregate[]` + resolved `speciesByFamily` here directly. The
 * resolution-to-tiles logic (cap, silhouette lookup, rendered/fallback/pending)
 * is identical to `buildAdaptiveTiles` — both share this core.
 *
 * `speciesCountByFamily` (#859) carries each family's TRUE distinct-species
 * count (the bucket's `family.speciesCount`), threaded onto each tile as
 * `speciesCount` so the per-family `<CellPopover>` can size its "+N more"
 * active drill-in against reality, not the capped row count. Omitted on the
 * per-observation path (`buildAdaptiveTiles`), where no true count exists.
 */
export function tilesFromAggregates(
  families: ReadonlyArray<FamilyAggregate>,
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>,
  silhouettesById: SilhouettesById,
  shape: ResolvedGrid,
  speciesCountByFamily?: ReadonlyMap<string, number>,
): ReadonlyArray<AdaptiveTile> {
  const visible = families.slice(0, visibleCapacity(shape));
  return visible.map((fam): AdaptiveTile => {
    const species = speciesByFamily.get(fam.familyCode) ?? [];
    const speciesCount = speciesCountByFamily?.get(fam.familyCode);
    // Only attach `speciesCount` when the caller supplied one — leaving it
    // `undefined` keeps the per-observation tiles on the legacy footer path.
    const countField = speciesCount === undefined ? {} : { speciesCount };
    if (silhouettesById.size === 0) {
      return { kind: 'pending', familyCode: fam.familyCode, count: fam.count, species, ...countField };
    }
    const silhouette = silhouettesById.get(fam.familyCode);
    if (!silhouette || silhouette.svgData === null) {
      const fallbackColor = silhouette?.color ?? '#888888';
      const fallbackColorDark = silhouette?.colorDark ?? fallbackColor;
      return {
        kind: 'fallback',
        familyCode: fam.familyCode,
        color: fallbackColor,
        colorDark: fallbackColorDark,
        count: fam.count,
        species,
        ...countField,
      };
    }
    return {
      kind: 'rendered',
      familyCode: fam.familyCode,
      svgData: silhouette.svgData,
      color: silhouette.color,
      colorDark: silhouette.colorDark,
      count: fam.count,
      species,
      ...countField,
    };
  });
}

/**
 * Per-species aggregation within a family. Used by `<CellHoverPreview>`,
 * `<CellPopover>`, and `<ClusterListPopover>` (epic #556, Phase 1+).
 *
 * `comName` is the grouping key (always present per eBird API contract);
 * `speciesCode` is `null` for spuh/slash/hybrid taxa where eBird returns
 * no canonical code — the row renders but is not clickable.
 */
export interface SpeciesAggregate {
  comName: string;
  speciesCode: string | null;
  count: number;
}

/**
 * Group cluster leaves by `comName` within each `familyCode`. Used by
 * `buildAdaptiveTiles` (issue #557, spec §4.2). Sort: descending count,
 * ascending `comName`.
 *
 * - Leaves with `familyCode === null` drop (cannot bucket).
 * - Leaves with `speciesCode === null` preserved with `speciesCode: null`.
 * - Multiple leaves with same `comName` but different `speciesCode` merge
 *   (first non-null `speciesCode` wins).
 */
export function aggregateClusterSpecies(
  leaves: ClusterLeafFeature[],
): Map<string, ReadonlyArray<SpeciesAggregate>> {
  // First pass: group by (familyCode, comName) → { count, speciesCode }.
  // `speciesCode` value: first non-null wins; null only if every leaf has null.
  type Bucket = { speciesCode: string | null; count: number };
  const byFamily = new Map<string, Map<string, Bucket>>();

  for (const leaf of leaves) {
    const { familyCode, speciesCode, comName } = leaf.properties;
    if (familyCode === null) continue;
    let speciesMap = byFamily.get(familyCode);
    if (!speciesMap) {
      speciesMap = new Map();
      byFamily.set(familyCode, speciesMap);
    }
    const existing = speciesMap.get(comName);
    if (existing) {
      existing.count += 1;
      // First non-null speciesCode wins (defensive against bad data).
      if (existing.speciesCode === null && speciesCode !== null) {
        existing.speciesCode = speciesCode;
      }
    } else {
      speciesMap.set(comName, { speciesCode, count: 1 });
    }
  }

  // Second pass: sort each family's species (descending count, ascending comName).
  const result = new Map<string, ReadonlyArray<SpeciesAggregate>>();
  for (const [familyCode, speciesMap] of byFamily) {
    const species: SpeciesAggregate[] = Array.from(speciesMap, ([comName, bucket]) => ({
      comName,
      speciesCode: bucket.speciesCode,
      count: bucket.count,
    }));
    species.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.comName.localeCompare(b.comName);
    });
    result.set(familyCode, species);
  }
  return result;
}
