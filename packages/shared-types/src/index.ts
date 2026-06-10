/**
 * The 49 CONUS eBird region codes — the 48 contiguous states plus the
 * District of Columbia, in eBird's `US-XX` form. Alaska (`US-AK`) and Hawaii
 * (`US-HI`) are deliberately excluded: the state-scope selector (epic #726)
 * frames the lower-48 + DC, and the `state_boundaries` polygon table is seeded
 * to match this exact set.
 *
 * This is the SINGLE source of truth for the allowlist. The read-api validator
 * (`parseState`), the frontend ZIP→state contract, and the scope selector all
 * import this array (and derive `StateCode` from it) rather than re-listing the
 * codes — keeping the allowlist in one place avoids the three-way drift a
 * duplicated list would invite (locked decision #6, plan task B1).
 *
 * `as const` makes every element a string literal, which `StateCode` lifts into
 * a union; `Object.freeze` blocks accidental runtime mutation of the shared
 * array by any importer.
 */
export const CONUS_STATE_CODES = Object.freeze([
  'US-AL', 'US-AZ', 'US-AR', 'US-CA', 'US-CO', 'US-CT', 'US-DE', 'US-DC',
  'US-FL', 'US-GA', 'US-ID', 'US-IL', 'US-IN', 'US-IA', 'US-KS', 'US-KY',
  'US-LA', 'US-ME', 'US-MD', 'US-MA', 'US-MI', 'US-MN', 'US-MS', 'US-MO',
  'US-MT', 'US-NE', 'US-NV', 'US-NH', 'US-NJ', 'US-NM', 'US-NY', 'US-NC',
  'US-ND', 'US-OH', 'US-OK', 'US-OR', 'US-PA', 'US-RI', 'US-SC', 'US-SD',
  'US-TN', 'US-TX', 'US-UT', 'US-VT', 'US-VA', 'US-WA', 'US-WV', 'US-WI',
  'US-WY',
] as const);

/**
 * A member of the CONUS allowlist — the eBird `US-XX` code union derived
 * directly from `CONUS_STATE_CODES`. Bare codes (`'AZ'`) are NOT `StateCode`s;
 * `parseState` normalizes input to this form. Derive, never re-list.
 */
export type StateCode = (typeof CONUS_STATE_CODES)[number];

/**
 * A single CONUS state's display name + bounding envelope, returned by
 * `GET /api/states` (one row per `CONUS_STATE_CODES` entry, name-sorted). The
 * `bbox` tuple is `[west, south, east, north]` — the SAME lng/lat ordering as
 * `ObservationFilters.bbox` — and drives the frontend's camera `fitBounds` and
 * `MAX_BOUNDS` when a state is chosen. The underlying polygon (`geom`) is
 * NEVER projected into this shape; it stays server-side (plan tasks A3 + A4).
 */
export interface StateSummary {
  stateCode: string;
  name: string;
  bbox: [number, number, number, number];
}

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
  since?: '1d' | '7d' | '14d';
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
  /**
   * Hard server-side data boundary: a CONUS `US-XX` code (`StateCode`) that
   * clips the observation query to that state's polygon via PostGIS
   * `ST_Intersects` against `state_boundaries`. ANDs with `bbox` and every
   * other filter — `bbox`/`zoom` keep their viewport / level-of-detail roles
   * *within* the clip. ABSENCE means whole-US (the unclipped national query);
   * the explicit Whole-US escape hatch sends no `?state=` at all. Serialized
   * as `?state=US-XX`. Typed as `string` (not `StateCode`) because the value
   * arrives unvalidated off the wire — `parseState` validates it against
   * `CONUS_STATE_CODES` before it reaches the data layer (plan task B1).
   */
  stateCode?: string;
  /**
   * #873 — the active state's FIXED bounding envelope (`StateSummary.bbox`,
   * `[west, south, east, north]`), threaded from the `/api/states` table when a
   * `US-XX` scope is active. CLIENT-ONLY: it is NEVER serialized to the wire as
   * its own param — instead, in the AGGREGATED path (`zoom < 6`) the client
   * substitutes this envelope (snapped to the cache grid) for the center-varying
   * viewport bbox, so every viewport/pan of a state collapses to ONE Cloudflare
   * cache key per `(state, zoom, filters)` and the origin query is state-tight.
   * At `zoom >= 6` it is ignored (the viewport bbox keeps narrowing the dense
   * per-observation query, preserving the 10k-truncation brake). Absent until
   * the states table has loaded — the client falls back to the canonical
   * viewport key in that window.
   */
  stateBbox?: [number, number, number, number];
};

/**
 * One family's slice of an aggregated grid cell (#859). Carries its own exact
 * counts plus the top-N species by observation count, so a low-zoom popover can
 * render REAL species names (resolved against the GET /api/species dictionary)
 * without a per-click fetch. The previous wire shape carried only the family
 * CODE (`families: string[]`); the frontend then fabricated synthetic
 * per-observation rows and lazily refetched species per click — the bug class
 * #859 deletes by moving species aggregation server-side (compute-on-write).
 *
 * - `count` / `speciesCount` are EXACT for this family in this cell (the
 *   "+N more" affordance and the family legend both read the exact counts, never
 *   the capped `species` array length).
 * - `species` is capped to the top-8 by observation count (ties broken by
 *   `code` asc for determinism). See `getObservationsAggregated`
 *   (`TOP_SPECIES_PER_FAMILY`) for the cap const + payload rationale.
 */
export interface AggregatedFamily {
  /** Family code (e.g. "turdidae"); drives silhouette + legend color. */
  code: string;
  /** Observations of this family in this cell — EXACT, never capped. */
  count: number;
  /** Distinct species of this family in this cell — EXACT; powers "+N more". */
  speciesCount: number;
  /** Top-8 species of this family in this cell, by observation count desc. */
  species: Array<{ code: string; count: number }>;
  /**
   * Colloquial family display name (issue #920, epic #924) —
   * `COALESCE(family_silhouettes.common_name, species_meta.family_name)`.
   * OPTIONAL for back-compat with pre-PR4 cached payloads: no producer projects
   * it until PR4 wires the live + precompute CTEs, and stale CDN bodies predating
   * that change deserialize with `name === undefined`. The frontend resolver
   * (`resolveFamilyName`) treats `undefined`/`null` identically and falls through
   * to the silhouette `commonName`, so a name-less payload renders correctly.
   */
  name?: string | null;
}

/**
 * One coarse-grid bucket returned by the aggregated /api/observations mode
 * (zoom < 6). The bucket lat/lng is the grid center.
 *
 * - `count` is the EXACT total observation count in the cell (over ALL rows,
 *   including species whose family is unknown — see the NULL-family note in
 *   `getObservationsAggregated`).
 * - `speciesCount` is the EXACT total distinct species in the cell.
 * - `families` nests each family's exact counts + top-8 species (#859), ordered
 *   by family observation count desc (ties by code asc). Species whose family is
 *   unknown (no `species_meta` row) are EXCLUDED from `families` but still
 *   counted in the bucket `count`/`speciesCount` totals — mirroring the prior
 *   `array_remove(..., NULL)` behavior.
 *
 * Issue #627 (grid), #859 (nested species).
 */
export interface AggregatedBucket {
  lat: number;
  lng: number;
  count: number;
  speciesCount: number;
  families: AggregatedFamily[];
}

/**
 * One row of the species dictionary returned by `GET /api/species` (#859). A
 * flat, long-lived `code → { comName, familyCode }` lookup the frontend fetches
 * once and joins against the species codes carried in `AggregatedFamily.species`
 * (and anywhere else a code needs a display name without a per-species fetch).
 * Names change rarely, so the endpoint is cached aggressively (see the
 * 'species-dict' tier in cache-headers.ts).
 */
export interface SpeciesDictEntry {
  code: string;
  comName: string;
  familyCode: string;
}

/**
 * One row of `GET /api/species/with-photos` (#992). The complete set of
 * species that currently have a `species_photos(purpose='detail-panel')` row,
 * returned in ONE response so the photo-curation `sync` tool can enumerate the
 * ~715 observed-with-photos species without walking the full 17.8k taxonomy and
 * issuing a per-species detail call. An INNER JOIN against `species_photos`
 * guarantees `photoUrl`/`photoAttribution`/`photoLicense` are always present
 * (unlike the optional projection on `SpeciesMeta`), so these are required
 * (non-optional) fields here.
 */
export interface SpeciesWithPhoto {
  code: string;
  comName: string;
  sciName: string;
  family: string;
  photoUrl: string;
  photoAttribution: string;
  photoLicense: string;
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
 *
 * `meta.truncated` (issue #727, plan task B6) signals that the per-observation
 * query hit its row brake (`LIMIT 10000`, or `5000` for a species-filtered
 * query) and the body is a partial set. It is OPTIONAL on BOTH branches:
 * - stale CDN bodies predating the field deserialize cleanly (consumers treat
 *   `undefined` as "not truncated" — no Cache-Control bump required);
 * - the aggregated path never paginates, so it omits the field entirely (it is
 *   declared on the aggregated branch only for shape parity, never set there).
 * The per-observation path sets `truncated: true` only when the brake fired;
 * it omits the field otherwise rather than emitting `truncated: false`.
 */
export type ObservationsResponse =
  | {
      mode: 'observations';
      data: Observation[];
      meta: { freshestObservationAt: string | null; truncated?: boolean };
    }
  | {
      mode: 'aggregated';
      buckets: AggregatedBucket[];
      meta: { freshestObservationAt: string | null; truncated?: boolean };
    };
