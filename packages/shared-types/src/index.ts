export interface Region {
  id: string;
  name: string;
  parentId: string | null;
  displayColor: string;
  svgPath: string;
}

export interface Hotspot {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  regionId: string | null;
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
  regionId: string | null;
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
  // taxonOrder is present only on /api/species/:code responses (projected
  // from SpeciesMeta). It is never included in /api/observations payloads
  // (getObservations SELECT omits taxon_order). Consumers default to null
  // when absent.
  taxonOrder?: number | null;
}

export interface SpeciesMeta {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyCode: string;
  familyName: string;
  taxonOrder: number | null;
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
}

export interface IngestRun {
  id: number;
  kind: 'recent' | 'backfill' | 'hotspots' | 'taxonomy';
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
};
