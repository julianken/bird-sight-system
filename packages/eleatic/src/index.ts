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
// export { makeReader, type EleaticReader } from './reader.js';

// --- Analysis module (E3) ---
// export { ... } from './analysis.js';

// --- Server factory (E4) ---
// export { createApp } from './app.js';
