import type { AggregatedBucket, FamilySilhouette, Observation } from '@bird-watch/shared-types';
import type { LayerProps } from 'react-map-gl/maplibre';
import { FAMILY_COLOR_FALLBACK } from '@/data/family-color.js';
import { CLUSTER_TIER_BOUNDARIES } from '@/config/cluster.js';

// Epic #539 cutover: `inStack` plumbing is retired. The auto-spider
// subsystem that produced it has been deleted along with its filter
// clauses on the unclustered-point and notable-ring layers.

/**
 * Sentinel id matching the `_FALLBACK` row in `family_silhouettes`
 * (migration 1700000018000_seed_family_silhouettes_fallback.sql). Used as
 * the icon-image identifier for observations whose family has no usable
 * silhouette in the seed (either no row, or row exists with svgData NULL).
 *
 * The leading underscore matters: PostgreSQL's locale-aware default
 * collation (en_US.UTF-8 on most installs) does NOT sort `_FALLBACK`
 * before lowercase letters the way ASCII (`COLLATE "C"`) would. The
 * silhouettes-DB tests deliberately assert the *locale* order — see
 * packages/db-client/src/silhouettes.test.ts — so don't normalize the
 * SELECT to COLLATE "C" without updating those tests.
 */
export const FALLBACK_SILHOUETTE_ID = '_FALLBACK';

/**
 * GeoJSON FeatureCollection type for observations — narrowed so callers get
 * geometry + property types without pulling in the full `@types/geojson` dep.
 */
export interface ObservationFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      subId: string;
      comName: string;
      locName: string | null;
      obsDt: string;
      howMany: number | null;
      isNotable: boolean;
      // familyCode is the join key the cluster-mosaic reconciler aggregates
      // by (issue #248). Threaded through here — NOT looked up at render
      // time — because GeoJSONSource.getClusterLeaves only returns properties
      // that were on the input feature. Kept null-not-undefined to match the
      // Observation type contract; consumers treat null as "skip this leaf".
      familyCode: string | null;
      speciesCode: string | null;   // NEW (issue #557)
      /**
       * Sprite identifier for the icon-image lookup (issue #246). Resolves to:
       *   - the observation's `silhouetteId` when the matching family row
       *     has a non-null svgData (the sprite was registered via addImage).
       *   - `FALLBACK_SILHOUETTE_ID` ('_FALLBACK') when the row is missing,
       *     when svgData is null (no usable Phylopic silhouette per #245),
       *     or when the join didn't hit at all.
       */
      silhouetteId: string;
      /** Family color from the silhouettes join; FAMILY_COLOR_FALLBACK on miss. */
      color: string;
    };
  }>;
}

/**
 * Convert an array of Observations into a GeoJSON FeatureCollection suitable
 * for a MapLibre GeoJSON source with clustering enabled.
 *
 * `silhouettes` is the response from `/api/silhouettes` (typically threaded
 * down from App.tsx via `useSilhouettes`). It supplies:
 *   1. The per-feature `color` property the SDF symbol layer tints with.
 *   2. The svgData-presence check that decides whether to paint the
 *      observation's own silhouette or the fallback shape.
 *
 * Pass `[]` when silhouettes haven't loaded yet — every feature gets
 * `silhouetteId: '_FALLBACK'` and `color: FAMILY_COLOR_FALLBACK`. The map
 * still renders; once the silhouettes prop populates the GeoJSON rebuilds.
 */
export function observationsToGeoJson(
  observations: Observation[],
  silhouettes: readonly FamilySilhouette[] = [],
): ObservationFeatureCollection {
  // Build a lookup keyed by lowercased familyCode so the join is
  // case-tolerant. Silhouettes are seeded lowercase but defensive for
  // future seed entries.
  const byFamily = new Map<string, FamilySilhouette>();
  for (const s of silhouettes) byFamily.set(s.familyCode.toLowerCase(), s);

  return {
    type: 'FeatureCollection',
    features: observations.map((o) => {
      const familyKey = o.familyCode?.toLowerCase() ?? null;
      const sil = familyKey ? byFamily.get(familyKey) : undefined;
      // The icon-image (#246) points at a registered sprite. We only
      // register a sprite for silhouettes whose svgData is non-null, so
      // the fallback path covers (a) no row, (b) row with svgData null,
      // (c) null familyCode. The color comes from the row when present
      // so we still tint the fallback shape with the family's seeded color.
      const silhouetteId =
        sil && sil.svgData !== null && o.silhouetteId
          ? sil.familyCode
          : FALLBACK_SILHOUETTE_ID;
      const color = sil?.color ?? FAMILY_COLOR_FALLBACK;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [o.lng, o.lat] as [number, number],
        },
        properties: {
          subId: o.subId,
          comName: o.comName,
          locName: o.locName,
          obsDt: o.obsDt,
          howMany: o.howMany,
          isNotable: o.isNotable,
          familyCode: o.familyCode ?? null,
          // NEW (issue #557):
          speciesCode: o.speciesCode ?? null,
          silhouetteId,
          color,
        },
      };
    }),
  };
}

/**
 * GeoJSON FeatureCollection for the aggregated low-zoom render path (#859).
 * One feature per `AggregatedBucket`. Unlike the synthetic-observation
 * expansion this REPLACES, each feature carries the bucket's REAL data:
 *
 *   - `count` / `speciesCount`: exact bucket totals. Fed into the cluster
 *     source's `clusterProperties` summing accumulators so a cluster of buckets
 *     knows its true observation/species totals (the cluster `point_count`
 *     counts buckets, not observations).
 *   - `familiesJson`: the bucket's `families` (with per-family species + counts)
 *     serialized to JSON. maplibre cluster leaves only preserve scalar/string
 *     properties through `getClusterLeaves`, so the array must be a string; the
 *     popover code parses it back when merging a cluster's member buckets.
 *   - `familyCode` / `silhouetteId` / `color`: the DOMINANT family (first in the
 *     count-desc `families` list) drives the marker silhouette + tint, mirroring
 *     `observationsToGeoJson`'s per-observation resolution.
 */
export interface BucketFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      count: number;
      speciesCount: number;
      familiesJson: string;
      familyCode: string | null;
      silhouetteId: string;
      color: string;
    };
  }>;
}

export function bucketsToGeoJson(
  buckets: AggregatedBucket[],
  silhouettes: readonly FamilySilhouette[] = [],
): BucketFeatureCollection {
  const byFamily = new Map<string, FamilySilhouette>();
  for (const s of silhouettes) byFamily.set(s.familyCode.toLowerCase(), s);

  return {
    type: 'FeatureCollection',
    features: buckets.map((b) => {
      // The dominant family (highest count) — families arrive count-desc from
      // the wire — drives the single marker silhouette for the bucket.
      const dominant = b.families[0]?.code ?? null;
      const familyKey = dominant?.toLowerCase() ?? null;
      const sil = familyKey ? byFamily.get(familyKey) : undefined;
      const silhouetteId =
        sil && sil.svgData !== null && dominant ? sil.familyCode : FALLBACK_SILHOUETTE_ID;
      const color = sil?.color ?? FAMILY_COLOR_FALLBACK;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [b.lng, b.lat] as [number, number],
        },
        properties: {
          count: b.count,
          speciesCount: b.speciesCount,
          familiesJson: JSON.stringify(b.families),
          familyCode: dominant,
          silhouetteId,
          color,
        },
      };
    }),
  };
}

/* ── Colour helpers ────────────────────────────────────────────────────────
   MapLibre style specs require concrete colour values (not CSS variables).
   Read the design tokens at call time so the spec objects stay in sync with
   the theme without hex literals in this module. */

export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return val || fallback;
}

/** Resolve --color-accent-notable-fg (dark amber) for notable rings. */
export function notableColor(): string {
  return readToken('--color-accent-notable-fg', '#b8860b');
}

/* ── Cluster source defaults ───────────────────────────────────────────── */

/**
 * Epic #539 cutover: raised from 14 → 22. Above this zoom level the
 * supercluster source stops clustering and individual observations render
 * as unclustered points. The adaptive-grid approach disambiguates
 * coincident observations via grid shape (1×1, 2×1) up to the maximum
 * sane render zoom, so clustering remains active much longer than the
 * legacy 14-cap allowed. The companion `<Source>` JSX in MapCanvas must
 * also set `maxzoom={24}` (Phase 0 finding F4) — without it MapLibre
 * warns that source maxzoom (default 18) must exceed clusterMaxZoom.
 */
export const CLUSTER_MAX_ZOOM = 22;
export const CLUSTER_RADIUS = 50;

/* ── Layer specs ───────────────────────────────────────────────────────── */

/**
 * Phase 3: cluster paint is suppressed. The MapLibre cluster source still
 * runs (for `point_count` aggregation), but no canvas paint is drawn —
 * <ClusterPillOverlay> in MapCanvas reads cluster features via
 * queryRenderedFeatures({ layers: ['clusters-hit'] }) and renders a React
 * <ClusterPill> per cluster instead. The pill component imports
 * CLUSTER_TIER_BOUNDARIES from the same config module this file imports
 * from (single source of truth).
 *
 * The hit-test layer 'clusters-hit' is unchanged — it covers all clusters
 * with transparent paint so queryRenderedFeatures still returns features
 * even though no visible paint exists.
 */
export function buildClusterLayerSpec(): LayerProps {
  return {
    id: 'clusters',
    type: 'circle',
    source: 'observations',
    filter: ['boolean', false],
    paint: {
      'circle-opacity': 0,
      'circle-stroke-opacity': 0,
      'circle-color': '#000',
      'circle-radius': 0,
    },
  };
}

/**
 * Phase 3: cluster-count layer also suppressed (never renders).
 * The count is displayed by <ClusterPill>'s aria-label instead.
 */
export function buildClusterCountLayerSpec(): LayerProps {
  return {
    id: 'cluster-count',
    type: 'symbol',
    source: 'observations',
    filter: ['boolean', false],
    layout: {
      'text-field': '',
      'text-size': 12,
      'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': 'transparent',
    },
  };
}

// CLUSTER_TIER_BOUNDARIES is re-exported here for callers that need the
// full lookup; the single source of truth lives in
// frontend/src/config/cluster.ts.
export { CLUSTER_TIER_BOUNDARIES };

/**
 * Build the invisible cluster hit-test layer spec. The visible cluster
 * circle layer is paint-suppressed (epic #539: adaptive-grid markers and
 * ClusterPill carry the cluster signal), so canvas paint exists only on
 * this transparent layer. `queryRenderedFeatures({ layers: ['clusters-hit'] })`
 * returns every clustered feature in the viewport so the React reconciler
 * can materialize them as grids or pills. Mirrors maplibre's official
 * "Display HTML clusters with custom properties" example pattern.
 */
export function buildClustersHitLayerSpec(): LayerProps {
  return {
    id: 'clusters-hit',
    type: 'circle',
    source: 'observations',
    filter: ['has', 'point_count'],
    paint: {
      // Visually invisible but still hit-testable. Without these explicit
      // zeros, MapLibre defaults the colors to opaque black + 0-width
      // stroke; we want zero-bleed.
      'circle-opacity': 0,
      'circle-stroke-opacity': 0,
      'circle-color': '#000',
      'circle-stroke-color': '#000',
      'circle-stroke-width': 0,
      // Radius is wide enough to cover a worst-case 4×4 adaptive-grid
      // composite — taps near a tile edge still register against the
      // cluster center. The grid is bounded by visibleCapacity(shape);
      // at 22px tiles + 2px gap + 4px badge overhang the marker is
      // roughly 100px wide at 4×4. Keep 25 — taps elsewhere route
      // through the React marker's outer button anyway.
      'circle-radius': 25,
    },
  };
}

/**
 * Build the unclustered-point SDF symbol layer spec (issue #246).
 *
 * Each unclustered observation renders as its family silhouette, tinted
 * with the family's seeded color. The icon-image and color values come
 * from per-feature properties resolved by observationsToGeoJson at build
 * time (so the layer spec itself is static and re-creating the GeoJSON
 * is the only thing the React component does when the silhouettes prop
 * arrives).
 *
 * Sprites must be registered via map.addImage(...) BEFORE this layer is
 * added to the map. MapCanvas orchestrates the addImage Promise.all and
 * then mounts this layer — see the `handleLoad` flow in MapCanvas.tsx.
 */
export function buildUnclusteredPointLayerSpec(): LayerProps {
  return {
    id: 'unclustered-point',
    type: 'symbol',
    source: 'observations',
    // Epic #539 cutover: inStack filter removed alongside auto-spider.
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'silhouetteId'],
      // Scale chain (E6 / #1058): the sprite SVG has a 24-unit viewBox
      // rastered into a 64px shell (silhouette-sprite.ts), registered with
      // `pixelRatio: 2` so maplibre lays it down at 32 CSS px; ×0.85 here ≈
      // 27px on the map — inside the documented 24-28px band and ≈ the
      // React-marker SILHOUETTE_PX (28), so the same visual scale as the
      // FamilyLegend chip preview. (Before the pixelRatio fix the 64px raster
      // rendered ≈54px — ~2× the badged markers, the M-15 "oversized canvas
      // silhouette" finding.)
      'icon-size': 0.85,
      // Without these two, MapLibre drops icons that overlap each other
      // or text labels from the basemap. At ≥CLUSTER_MAX_ZOOM zoom levels
      // overlapping silhouettes are intentional (it's how density reads).
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      // SDF tint: each feature's color property paints its own silhouette.
      // This is what gives the map the same family-color signal as the legend.
      'icon-color': ['get', 'color'],
      // White halo around each silhouette for contrast against the
      // light OpenFreeMap positron basemap. Without it, families whose
      // seed color is naturally low-saturation (accipitridae #222222,
      // cathartidae #444444, corvidae #222244, strigidae #5A4A2A,
      // troglodytidae #7A5028, plus _FALLBACK #555 at half opacity)
      // read as faint smudges. The halo is the same trick maplibre
      // text-symbol labels use to stand out against varied backgrounds —
      // see basemap-style.ts text layers for the precedent.
      'icon-halo-color': '#ffffff',
      'icon-halo-width': 1.5,
      // Fade _FALLBACK markers so missing-Phylopic families read as
      // distinct from the rest. The condition uses the literal sentinel
      // value — must stay in sync with FALLBACK_SILHOUETTE_ID above.
      //
      // The `hidden` feature-state branch (issue #554 scope expansion
      // 2026-05-15) hides the canvas-painted silhouette twin whenever
      // deconflict has displaced it to a <PresentationMarker> overlay.
      // Reads via promoteId="subId" on the GeoJSON Source so
      // setFeatureState({id: subId}, {hidden: true}) lands on the
      // right feature.
      'icon-opacity': [
        'case',
        ['boolean', ['feature-state', 'hidden'], false], 0,
        ['==', ['get', 'silhouetteId'], FALLBACK_SILHOUETTE_ID], 0.5,
        1.0,
      ],
    },
  };
}

/**
 * Build the notable-ring layer spec — paints an amber halo BEHIND each
 * notable observation's silhouette so the family-color signal in the
 * silhouette body itself is preserved (an amber-tinted SDF would lose it).
 *
 * Layer ordering matters: this layer must be added BEFORE the
 * 'unclustered-point' symbol layer in MapCanvas so the ring renders
 * underneath the silhouette (maplibre paints in source order, source-order
 * = bottom-up).
 */
export function buildNotableRingLayerSpec(): LayerProps {
  return {
    id: 'notable-ring',
    type: 'circle',
    source: 'observations',
    filter: [
      'all',
      ['!', ['has', 'point_count']],
      ['==', ['get', 'isNotable'], true],
    ],
    paint: {
      // Hollow ring — fill is transparent so the silhouette body shows
      // through with its family color.
      'circle-color': 'rgba(0,0,0,0)',
      'circle-radius': 14,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': notableColor(),
      // Hide the ring for silhouettes that deconflict displaced — the
      // displaced React twin handles its own painting at the offset
      // lng/lat, and the ring (rendered at the canvas position) would
      // detach from the body. Issue #554 scope expansion 2026-05-15.
      'circle-stroke-opacity': [
        'case',
        ['boolean', ['feature-state', 'hidden'], false], 0,
        1,
      ],
    },
  };
}
