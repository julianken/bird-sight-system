export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
export {
  getObservations, getObservationsAggregated, upsertObservations,
  runReconcileStamping, getFreshestObservationAt,
  // #878 — precomputed per-scope aggregation grid.
  refreshGridAgg, getAggregatedGridFromCache, isPrecomputeEligible,
  resolveScopeKey, NATIONAL_SCOPE_KEY, STANDARD_GRID_MULTIPLIERS,
  type ObservationInput,
} from './observations.js';
export {
  getSpeciesMeta,
  getSpeciesDictionary,
  getSpeciesWithPhotos,
  upsertSpeciesMeta,
  findMissingSpeciesMeta,
  insertSpeciesPhoto,
  getSpeciesPhotos,
  getSpeciesPhenology,
  insertSpeciesDescription,
  type SpeciesPhoto,
  type SpeciesPhotoInput,
  type SpeciesDescriptionInput,
} from './species.js';
export { insertPhotoScores, getPhotoScores } from './photo-scores.js';
export { getSilhouettes } from './silhouettes.js';
export { resolveStateForPoint, listStatesWithBbox } from './state-boundaries.js';
export {
  startIngestRun, finishIngestRun, getRecentIngestRuns,
  type IngestKind, type IngestStatus, type FinishOptions,
} from './ingest-runs.js';
