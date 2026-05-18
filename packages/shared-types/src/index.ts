export interface Hotspot {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  numSpeciesAlltime: number | null;
  latestObsDt: string | null;
}

export interface Observation {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
  silhouetteId: string | null;
  // familyCode is nullable, NOT optional. The Read API populates it from
  // species_meta via a LEFT JOIN, so a species absent from species_meta
  // yields NULL — meaningful signal that callers must handle (skip-in-
  // derive, fallback-silhouette-color). Issue #57 severs the old
  // silhouetteId-as-familyCode coupling: colors now come from familyCode
  // directly, and the two identifiers are distinct at the type level.
  //
  // Cache caveat: stale CDN responses predating this field deserialize
  // with familyCode === undefined. Consumers treat undefined the same as
  // null (skip / fallback), so no Cache-Control bump is required.
  familyCode: string | null;
  // taxonOrder remains optional: it's sourced from SpeciesMeta and only
  // lands on the wire when the read-api projects it. Consumers default
  // to null when absent.
  taxonOrder?: number | null;
}

export interface SpeciesMeta {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyCode: string;
  familyName: string;
  taxonOrder: number | null;
  // Optional photo projection fields. These are derived at read time
  // (issue #327) from a LEFT JOIN to species_photos and are NEVER stored
  // on the species_meta table itself. The Read API populates them on
  // /api/species/:code when a row exists in species_photos with
  // purpose='detail-panel' for the species; absent otherwise. Cache caveat:
  // stale CDN responses predating these fields deserialize with all three
  // === undefined, which the frontend treats as "no photo" (Phylopic
  // silhouette fallback) — no Cache-Control bump is required.
  photoUrl?: string;
  photoAttribution?: string;
  photoLicense?: string;
  // Optional description projection fields. Mirrors the photo-projection
  // shape (issue #372): derived at read time from a LEFT JOIN to
  // species_descriptions and NEVER stored on species_meta itself. The Read
  // API populates them on /api/species/:code when a row exists in
  // species_descriptions for the species; absent otherwise.
  // exactOptionalPropertyTypes contract: properties are absent (not
  // `undefined`) when the JOIN produces NULLs — same as the photo fields
  // above. Cache caveat: stale CDN responses predating these fields
  // deserialize with all three === undefined, which the frontend treats as
  // "no description" (silent no-op) — no Cache-Control bump is required.
  descriptionBody?: string;
  descriptionLicense?: string;
  descriptionAttributionUrl?: string;
}

export interface FamilySilhouette {
  familyCode: string;
  color: string;
  // NULL = pending Phylopic curation (issue #55), or family flagged as
  // having no usable Phylopic silhouette (issue #245's Phylopic-less
  // policy — the row exists with an authoritative seeded color and the
  // Phylopic seed migration explicitly NULLs svgData/source/license/creator
  // together so the _FALLBACK consumer renders a generic shape with the
  // family color). The DB column is nullable per migration
  // 1700000014000_relax_family_silhouettes_svg_data_nullable.sql.
  svgData: string | null;
  // svgUrl (issue #502) is the admin-api-uploaded CDN-served SVG URL. NULL
  // for rows that haven't been overridden via the admin-api. Consumers
  // that render the silhouette as an <img> (FamilyLegend's SilhouetteGlyph,
  // SpeciesDetailSurface's SpeciesDetailSilhouette) prefer svgUrl when
  // non-null and fall back to inline path-d (svgData) when null. The map's
  // SDF sprite pipeline (MapCanvas#registerSilhouetteSprite) ALWAYS uses
  // svgData and ignores svgUrl — sprite registration is synchronous at
  // map init and an external URL would require N async fetches.
  svgUrl: string | null;
  source: string | null;
  license: string | null;
  // English common name for the family — added by migrations
  // 1700000019000 (schema) + 1700000019500 (seed) for issue #249. NULL is
  // the defensive fallback for unseeded families landing in production
  // post-seed; FamilyLegend (and any other display surface) falls back to
  // `prettyFamily(familyCode)` when commonName is null.
  commonName: string | null;
  // Phylopic creator name — added by migrations 1700000016000 (schema) +
  // 1700000017000 (seed) for issue #245. Populated when the curation
  // script captures a creator attribution from the Phylopic image
  // metadata; NULL when the family has no usable Phylopic silhouette
  // (Phylopic-less policy) or when the underlying image carries no
  // creator field. AttributionModal (#250) renders "<creator>, <license>"
  // when both are non-null.
  creator: string | null;
  // Dark-mode color for the family silhouette tile — added by migration
  // 1700000046000 (adaptive-grid contrast Phase 1, #570). Equals `color`
  // for families that already pass 3:1 against both basemaps; differs for
  // the 24 light-failing families (where `color` was darkened and
  // `colorDark` holds the original lighter hex that passes #0E1116) and
  // the 22 dark-failing families (where both columns hold the lightened
  // replacement hex). AdaptiveGridMarker reads `colorDark` in dark mode.
  colorDark: string;
}

/**
 * Type-narrowed variant of Observation for sightings confirmed as notable.
 * FeedCard (and any elevated-card consumer) accepts only NotableObservation —
 * the type system enforces that callers narrow before passing, eliminating the
 * structural trust the old Observation prop required.
 *
 * The caller (FeedSurface) already guards with `o.isNotable` before passing
 * to FeedCard; this type makes that guard a compile-time contract.
 */
export type NotableObservation = Observation & { isNotable: true };

export interface IngestRun {
  id: number;
  kind: 'recent' | 'notable' | 'backfill' | 'hotspots' | 'taxonomy' | 'photos' | 'prune';
  startedAt: string;
  finishedAt: string | null;
  obsFetched: number | null;
  obsUpserted: number | null;
  status: 'running' | 'success' | 'partial' | 'failure';
  errorMessage: string | null;
}

// All terminal statuses — what finishIngestRun accepts. Excludes 'running' (the initial state).
export type IngestRunTerminalStatus = Exclude<IngestRun['status'], 'running'>;

export type ObservationFilters = {
  since?: '1d' | '7d' | '14d' | '30d';
  notable?: boolean;
  speciesCode?: string;
  familyCode?: string;
  /**
   * Viewport bounding box as `[west, south, east, north]` (lng,lat,lng,lat).
   * Wired by `MapCanvas` viewport changes to constrain the observations
   * payload to the visible region — the Phase 2 going-national pre-condition
   * that prevents pulling the full CONUS observation set on every map load.
   * Serialized as `?bbox=west,south,east,north` on the wire.
   */
  bbox?: [number, number, number, number];
  /**
   * Map zoom level. When `bbox` is set and `zoom < 6` the read-api returns
   * a coarse-grid aggregated bucket payload instead of per-observation rows
   * to keep the CONUS-view payload below the Phase 2 <2 MB gate. Issue #627.
   */
  zoom?: number;
};

/**
 * One coarse-grid bucket returned by the aggregated /api/observations mode
 * (zoom < 6). The bucket lat/lng is the grid center; `count` is the total
 * observations in the cell; `families` is the de-duplicated list of family
 * codes (may include nulls collapsed out, per the SQL `FILTER (WHERE family IS NOT NULL)`).
 * Issue #627.
 */
export interface AggregatedBucket {
  lat: number;
  lng: number;
  count: number;
  speciesCount: number;
  families: string[];
}

/**
 * Discriminated-union response from GET /api/observations.
 *
 * - `mode === 'observations'` (default; also when zoom >= 6 with bbox):
 *   per-observation rows as before. Spec: docs/design/01-spec/voice-and-content.md
 *   §Freshness label state machine. Issue #456 W3-A.
 * - `mode === 'aggregated'` (issue #627): coarse-grid aggregation buckets.
 *   Triggered server-side when `bbox` is present and `zoom < 6`.
 *
 * `meta.freshestObservationAt` carries the same MAX(ingested_at) signal in
 * both modes so the frontend's freshness state machine stays consumer-agnostic.
 */
export type ObservationsResponse =
  | {
      mode: 'observations';
      data: Observation[];
      meta: { freshestObservationAt: string | null };
    }
  | {
      mode: 'aggregated';
      buckets: AggregatedBucket[];
      meta: { freshestObservationAt: string | null };
    };
