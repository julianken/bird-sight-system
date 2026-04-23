import type { Observation } from '@bird-watch/shared-types';
import type { LayerProps } from 'react-map-gl/maplibre';

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
    };
  }>;
}

/**
 * Convert an array of Observations into a GeoJSON FeatureCollection suitable
 * for a MapLibre GeoJSON source with clustering enabled.
 */
export function observationsToGeoJson(
  observations: Observation[],
): ObservationFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: observations.map((o) => ({
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
      },
    })),
  };
}

/* ── Colour helpers ────────────────────────────────────────────────────────
   MapLibre style specs require concrete colour values (not CSS variables).
   Read the design tokens at call time so the spec objects stay in sync with
   the theme without hex literals in this module. */

function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return val || fallback;
}

/** Resolve --color-accent-notable-fg (dark amber) for notable dots. */
export function notableColor(): string {
  return readToken('--color-accent-notable-fg', '#b8860b');
}

/** Resolve --color-text-body for common (non-notable) dots. */
export function commonColor(): string {
  return readToken('--color-text-body', '#444');
}

/** Resolve --color-text-white for text on cluster circles. */
export function clusterTextColor(): string {
  return readToken('--color-text-white', '#fff');
}

/* ── Cluster source defaults ───────────────────────────────────────────── */

export const CLUSTER_MAX_ZOOM = 14;
export const CLUSTER_RADIUS = 50;

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
    filter: ['has', 'point_count'],
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
    filter: ['has', 'point_count'],
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
 * Build the unclustered-point layer spec. Notable observations get the accent
 * colour; common ones get the body-text colour. Circle radius is 11px — large
 * enough for reliable 390x844 mobile touch targets (prototype learnings #4).
 */
export function buildUnclusteredPointLayerSpec(): LayerProps {
  return {
    id: 'unclustered-point',
    type: 'circle',
    source: 'observations',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'case',
        ['get', 'isNotable'],
        notableColor(),
        commonColor(),
      ],
      'circle-radius': 11,
      'circle-stroke-width': 1,
      'circle-stroke-color': clusterTextColor(),
    },
  };
}
