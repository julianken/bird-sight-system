// frontend/scripts/map-consistency/types.ts
// Shared shapes for the map-consistency audit (epic #1266).

export type Viewport = 'desktop' | 'mobile';

export const VIEWPORTS: Record<Viewport, { width: number; height: number; dpr: number }> = {
  desktop: { width: 1440, height: 900, dpr: 1 },
  mobile: { width: 390, height: 844, dpr: 2 },
};

/** [minLng, minLat, maxLng, maxLat] — the /api/observations bbox param order. */
export type Bbox = [number, number, number, number];

export interface FamilyCount { family: string; count: number; }

/** A geo-located count: a bucket centroid (aggregated) or one observation (count 1). */
export interface GeoPoint { lng: number; lat: number; count: number; }

/** Normalized truth from the /api/observations response that served a view. */
export interface NetworkView {
  mode: 'aggregated' | 'observations' | 'unknown';
  bbox: Bbox;
  zoom: number;
  truncated: boolean;
  freshestObservationAt: string | null;
  /** Σ bucket.count (aggregated) or data.length (observations). */
  total: number;
  familyCounts: FamilyCount[];
  /** Geo-located counts for drill-down conservation (MR-0). */
  points: GeoPoint[];
  speciesCount: number | null;
  rawPath?: string;
}

export interface LedeRead { text: string; firstInt: number | null; unit: 'species' | 'sightings' | null; }

export interface MarkerRead {
  /** Which DOM form this cluster rendered as (§5.2): `grid` = the family-cell
   *  `adaptive-grid-marker` the capture has always read; `pill` = the collapsed
   *  `.cluster-pill` button (total count, NO family breakdown). pickGridShape
   *  collapses a cluster to a pill above a point/family cap, so desktop's wider
   *  bbox aggregates more points/cluster and stays a pill where mobile splits
   *  into a grid — the reported "desktop pills don't split out" bug. */
  kind: 'pill' | 'grid';
  /** The marker's own total: a pill's `aria-label "N sightings"` count, or the
   *  Σ of a grid's per-cell counts. Counts toward `renderedTotal` for both kinds. */
  total: number;
  /** The `cluster-pill--<x>` modifier (sky / sand / ember) for a pill; undefined for grids. */
  color?: string;
  /** From "Cluster: N observations, M families". null for a single-family marker
   *  and for pills (no family breakdown). */
  markerTotal: number | null;
  familyCount: number | null;
  /** Per-cell {family,count} from cell aria-labels. Empty for pills (collapsed, no cells). */
  cells: FamilyCount[];
  /** True when this marker shows a mobile "+N" overflow pill
   *  ([data-testid="adaptive-grid-marker-overflow"]) — families are hidden, so
   *  rendered < stated is legitimate for MR-2/MR-3 (carve-out `mobile-overflow`). */
  overflow: boolean;
}

export interface ViewSnapshot {
  url: string;
  scope: string;
  viewport: Viewport;
  requestedZoom: number;
  requestedCenter: { lng: number; lat: number };
  network: NetworkView;
  lede: LedeRead;
  legend: FamilyCount[];
  markers: MarkerRead[];
  consoleErrors: string[];
  consoleWarnings: string[];
  /** Set when the view can't be trusted (e.g. basemap tile-CDN failure). */
  inconclusive?: { reason: string };
}

/** One filter probe: an unfiltered baseline view plus its filtered variants at a
 *  single shared camera. MR-4 reconciles the variants against the baseline. */
export interface FilterBundle {
  unfiltered: ViewSnapshot;
  /** Per-family variants: `?family=<F>` at the same camera, keyed by family name. */
  byFamily: { family: string; view: ViewSnapshot }[];
  /** `?since=1d|7d|14d` variants at the same camera, for the monotonicity check. */
  bySince: { since: '1d' | '7d' | '14d'; view: ViewSnapshot }[];
}

/** Two captures of the SAME camera (MR-7 idempotence / intermittency). */
export interface Recapture { a: ViewSnapshot; b: ViewSnapshot; }

export interface Sample {
  id: string;
  seedPoint: { lng: number; lat: number };
  scope: string;
  views: ViewSnapshot[];
  /** MR-4 filter probe (captured for ~one sample at a mid-ladder zoom). */
  filterBundle?: FilterBundle;
  /** MR-7 re-capture pairs (~one camera per sample captured twice). */
  recaptures?: Recapture[];
}

export type VerdictStatus = 'pass' | 'fail' | 'inconclusive';
export type Severity = 'high' | 'medium' | 'low';

export interface Verdict {
  relation: string;
  status: VerdictStatus;
  sampleId: string;
  severity?: Severity;
  symptom?: string;
  numbers?: Record<string, number | null>;
  carveOuts?: string[];
  evidence?: Record<string, unknown>;
}
