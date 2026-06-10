/**
 * `@bird-watch/photo-quality` — the single shared scoring core for the photo
 * curation epic. The curation CLI (Slice 4) and the batched `score` workflow
 * (Slice 4b / #971) all import scoreImage + composeOverall + defaultRubricConfig
 * + the VisionJudge interface from here, so "same criteria for new photos" is
 * structural, not a copy. This package is PURE — it exports the VisionJudge
 * INTERFACE and a FakeJudge test double, never an SDK judge; the production
 * judge is a Claude Code agent supplied by the Slice-4b workflow.
 */

export type {
  ImageInput,
  SpeciesContext,
  CriteriaScores,
  Verdict,
  DeterministicReport,
  QualityReport,
  VisionJudge,
  RubricConfig,
  DisqualifierFlag,
} from './types.js';
export { DISQUALIFIER_FLAGS, CRITERIA_KEYS } from './types.js';

export { scoreImage } from './score.js';
export { assessDeterministic } from './deterministic.js';
export { composeOverall, applyCaps, toVerdict, composeReport } from './composite.js';
export { contentHash, scoreCacheKey } from './content-hash.js';
export { defaultRubricConfig } from './rubric.config.js';
export { FakeJudge } from './fake-judge.js';
