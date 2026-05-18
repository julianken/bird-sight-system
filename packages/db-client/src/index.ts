export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { createDualWritePool, isWriteSql } from './dual-write-pool.js';
export type { DualWritePoolOptions } from './dual-write-pool.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
export {
  getObservations, upsertObservations, runReconcileStamping,
  getFreshestObservationAt,
  type ObservationInput,
} from './observations.js';
export {
  getSpeciesMeta,
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
export { getSilhouettes } from './silhouettes.js';
export {
  startIngestRun, finishIngestRun, getRecentIngestRuns,
  type IngestKind, type IngestStatus, type FinishOptions,
} from './ingest-runs.js';
