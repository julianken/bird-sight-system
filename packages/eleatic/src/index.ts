/**
 * Public barrel for @bird-watch/eleatic.
 *
 * E1 (this PR) ships the write path: the store factory + class and the record
 * types. The read/analysis/server surfaces land in later epic children and get
 * exported here when they do — markers reserved below so the export order stays
 * stable and a sibling implementer knows exactly where their symbol goes. Do
 * NOT stub the unland ones; the marker is the contract.
 */

// --- Write store (E1) ---
export { openStore, EleaticStore } from './store.js';
export type { EvalRunRecord, EvalRowRecord, EvalAdjudicationRecord } from './types.js';

// --- Read query API (E2) ---
export { makeReader } from './queries.js';
export type {
  EleaticReader,
  RunDiff,
  MetricPoint,
  FacetQuery,
  FacetFilter,
  JsonScalar,
} from './queries.js';

// --- Analysis module (E3) ---
export {
  labelAgreement,
  confusionCounts,
  scoreMAE,
  auc,
  calibratedThreshold,
  ambiguityBand,
  hybridRouting,
  analyze,
  projectForAnalysis,
  aggregateScores,
} from './analysis.js';
export type { AnalysisRow, AnalysisOptions, Analysis, AnalysisSelector } from './analysis.js';

// --- Server factory (E4) ---
export { createApp } from './server/app.js';
export { startServer } from './server/serve.js';
export type { ServeOptions } from './server/serve.js';
export { resolveConfig, clientConfigSlice } from './config.js';
export type { EleaticConfig, ClientConfig, EleaticGate } from './config.js';
