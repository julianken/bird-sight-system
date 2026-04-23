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
}

export interface FamilySilhouette {
  familyCode: string;
  color: string;
  // Nullable for families pre-curation: the `family_silhouettes` row exists
  // (so color is seeded and authoritative) but no Phylopic SVG has been
  // selected yet. Consumers render the generic fallback silhouette when
  // svgData is null. Tracked by issue #55's Phylopic curation sub-problem.
  svgData: string | null;
  source: string | null;
  license: string | null;
}

export interface IngestRun {
  id: number;
  kind: 'recent' | 'notable' | 'backfill' | 'hotspots' | 'taxonomy';
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
