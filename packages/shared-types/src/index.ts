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
  // Optional forward-looking fields. Plan 6 Task 10 (issue #119) lands
  // frontend consumers (taxonomic sort, family-first derived grouping)
  // that prefer these when present but fall back to silhouetteId +
  // SpeciesMeta lookups. The API doesn't populate them yet; adding them
  // to the wire type as optional keeps payloads backward-compatible and
  // lets the read-api grow them without a frontend rev.
  familyCode?: string | null;
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
  id: string;
  familyCode: string;
  svgData: string;
  color: string;
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
