/**
 * Canonical scoring contract for the photo-quality curation epic. Every
 * consumer (curation CLI, ingestor gate, review server) imports these names
 * VERBATIM — do not rename fields or reorder the flag vocabulary. The string
 * literals here are the wire/DB vocabulary stored in SQLite (criteria_json /
 * flags_json) and in species_photos metadata.
 */

export interface ImageInput {
  buffer: Buffer;
  mime: string;
  sourceUrl?: string;
}

export interface SpeciesContext {
  speciesCode: string;
  comName: string;
  sciName: string;
  family: string;
}

/** Stage-2 per-criterion sub-scores, each on a 0–10 scale. */
export interface CriteriaScores {
  framing: number;        // subject size / placement / crop
  subjectClarity: number; // focus on the bird, eye sharpness
  liveness: number;       // alive & healthy (low = dead/sick/injured)
  naturalness: number;    // wild setting (low = captive/in-hand/feeder/specimen)
  pose: number;
  background: number;
  lighting: number;
}

export type Verdict = 'great' | 'good' | 'mediocre' | 'reject';

export interface DeterministicReport {
  width: number;
  height: number;
  megapixels: number;
  sharpness: number;      // normalized variance-of-Laplacian
  exposure: number;       // 0–1, clipping penalty (1 = no clipping)
  aspectRatio: number;
  passedGate: boolean;    // false → skip the LLM, auto-reject
  failReasons: string[];
}

export interface QualityReport {
  overall: number;        // 0–100 composite
  verdict: Verdict;
  deterministic: DeterministicReport;
  criteria: CriteriaScores;
  flags: string[];
  rationale: string;      // one-line judge explanation
  rubricVersion: string;
}

/**
 * Stage-2 judge. Injected so unit tests pass a FakeJudge (no real LLM call) and
 * production passes a Claude Code agent-backed judge supplied by the Slice-4b
 * scoring workflow (#971) — a `.mjs` workflow that `Read`s the downloaded image
 * and applies defaultRubricConfig.judgePrompt. This package never depends on an
 * SDK. The judge returns ONLY the sub-scores/flags/rationale; the composite
 * `overall` + `verdict` are computed deterministically in this package
 * (composite.ts), never by the model.
 */
export interface VisionJudge {
  judge(
    img: ImageInput,
    ctx: SpeciesContext,
    prompt: string,
  ): Promise<{ criteria: CriteriaScores; flags: string[]; rationale: string }>;
}

export interface RubricConfig {
  version: string;
  deterministic: {
    minMegapixels: number;
    minSharpness: number;
    allowedAspect: [number, number]; // [lo, hi] inclusive
  };
  weights: Record<keyof CriteriaScores, number>;
  disqualifiers: { flag: string; cap: number }[];
  thresholds: { autoAccept: number; review: number; reject: number };
  judgePrompt: string; // the rubric text a Claude Code agent-judge receives
}

/**
 * Canonical disqualifier-flag vocabulary. `as const` so the literal union is
 * derivable and tests can assert the exact set. The judge MAY only emit these
 * strings; composite.ts only ever caps on a flag present in a config
 * disqualifier entry, so an off-vocabulary flag is inert (logged upstream).
 */
export const DISQUALIFIER_FLAGS = [
  'dead',
  'in-hand',
  'specimen',
  'sick',
  'distant',
  'multiple-subjects',
  'watermark',
  'captive',
  'harsh-flash',
] as const;
export type DisqualifierFlag = (typeof DISQUALIFIER_FLAGS)[number];

/** Ordered criteria keys — the canonical iteration order for weight math. */
export const CRITERIA_KEYS = [
  'framing',
  'subjectClarity',
  'liveness',
  'naturalness',
  'pose',
  'background',
  'lighting',
] as const satisfies readonly (keyof CriteriaScores)[];
