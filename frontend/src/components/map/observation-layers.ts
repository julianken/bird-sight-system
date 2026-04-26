import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import type { LayerProps } from 'react-map-gl/maplibre';
import { FAMILY_COLOR_FALLBACK } from '../../data/family-color.js';

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

export const CLUSTER_MAX_ZOOM = 14;
export const CLUSTER_RADIUS = 50;
/**
 * Mosaic-vs-circle threshold (issue #248). Clusters with `point_count` AT OR
 * BELOW this value render an HTML `<Marker>` 2×2 family-silhouette mosaic in
 * MapCanvas. Larger clusters keep the colored count circle. The two surfaces
 * are mutually exclusive — the cluster-circle and cluster-count layers both
 * filter to `point_count > CLUSTER_MOSAIC_MAX_POINTS` to prevent visual
 * double-rendering. Bumping this threshold also bumps the React reconciler's
 * DOM-marker count; HTML markers don't scale beyond ~5k visible (DOM perf).
 */
export const CLUSTER_MOSAIC_MAX_POINTS = 8;

/* ── Layer specs ───────────────────────────────────────────────────────── */

/**
 * Build the cluster-circle layer spec. Uses step expressions for graduated
 * circle sizes based on point_count.
 */
export function buildClusterLayerSpec(): LayerProps {
  return {
    id: 'clusters',
    type: 'circle',
    source: 'observations',
    // Issue #248: mosaic markers handle clusters with point_count <= 8.
    // Cap this layer at the complement so the circle doesn't render under
    // the HTML mosaic. CLUSTER_MOSAIC_MAX_POINTS is the single boundary
    // token shared with the React reconciler in MapCanvas.
    filter: [
      'all',
      ['has', 'point_count'],
      ['>', ['get', 'point_count'], CLUSTER_MOSAIC_MAX_POINTS],
    ],
    paint: {
      'circle-color': [
        'step',
        ['get', 'point_count'],
        '#51bbd6',
        100,
        '#f1f075',
        750,
        '#f28cb1',
      ],
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        20,
        100,
        30,
        750,
        40,
      ],
    },
  };
}

/**
 * Build the cluster-count symbol layer spec — renders the observation count
 * inside each cluster circle.
 */
export function buildClusterCountLayerSpec(): LayerProps {
  return {
    id: 'cluster-count',
    type: 'symbol',
    source: 'observations',
    // Same threshold as the cluster circle layer (issue #248). The mosaic
    // marker carries its own count badge; rendering this symbol on top of
    // the mosaic would double-render the number.
    filter: [
      'all',
      ['has', 'point_count'],
      ['>', ['get', 'point_count'], CLUSTER_MOSAIC_MAX_POINTS],
    ],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      // Must be a font that exists in the basemap style's glyph stack.
      // OpenFreeMap positron ships Noto Sans {Regular,Bold,Italic} only —
      // MapLibre's default ["Open Sans Regular","Arial Unicode MS Regular"]
      // 404s against tiles.openfreemap.org/fonts/...
      'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': readToken('--color-text-strong', '#1a1a1a'),
    },
  };
}

/**
 * Build the invisible cluster hit-test layer spec (issue #248). The visible
 * cluster circle layer is filtered to `point_count > CLUSTER_MOSAIC_MAX_POINTS`,
 * so small clusters aren't rendered to the canvas — and `queryRenderedFeatures`
 * only returns features that ARE rendered. This layer covers all clusters with
 * fully transparent paint so the React reconciler can pull small clusters out
 * for HTML mosaic-marker materialization. Mirrors maplibre's official
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
      // Radius is wide enough to cover a worst-case 22+22+gap mosaic
      // composite — taps near a tile edge still register against the
      // cluster center. The mosaic-vs-circle threshold is point_count <= 8;
      // at 22px tiles + 2px gap + 4px badge overhang the marker is roughly
      // 50px wide, so a 25-radius hit circle gives a reasonable tap target.
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
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': ['get', 'silhouetteId'],
      // 0.85 keeps a 32-viewBox SDF roughly in the 24-28px range on the
      // map — same visual scale as the FamilyLegend chip preview.
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
      'icon-opacity': [
        'case',
        ['==', ['get', 'silhouetteId'], FALLBACK_SILHOUETTE_ID],
        0.5,
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
    },
  };
}
