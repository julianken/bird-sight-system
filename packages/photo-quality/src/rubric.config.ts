/**
 * `@bird-watch/photo-quality` rubric config — Phase-0 deliverable (spec §6, §5.1).
 *
 * ONE config, two consumers: the curation tool's bulk-review pass and the
 * ingestor's new-photo gate both import this literal, so "same criteria for new
 * photos" is structural, not a copy. Derived from
 * `docs/research/2026-06-10-bird-photo-quality-rubric.md`.
 *
 * The `version` is bumped on every calibration tune so SQLite-cached scores
 * (keyed by content hash + rubricVersion) are invalidated when the rubric moves.
 *
 * SCOPE NOTE (Slice 1): this file declares the minimal `CriteriaScores` /
 * `RubricConfig` types it needs locally. Slice 2 authors `src/index.ts` with the
 * full public interface set (`ImageInput`, `QualityReport`, `VisionJudge`,
 * `scoreImage`, …) and aligns `CriteriaScores` / `RubricConfig` to these exact
 * shapes. Keep the field names/types here identical to the pinned contract.
 */

/** Stage-2 per-criterion sub-scores, each 0–10. Pinned interface contract. */
export interface CriteriaScores {
  framing: number;
  subjectClarity: number;
  liveness: number;
  naturalness: number;
  pose: number;
  background: number;
  lighting: number;
}

/** Tunable, version-stamped rubric contract. Pinned interface contract. */
export interface RubricConfig {
  version: string;
  deterministic: {
    minMegapixels: number;
    minSharpness: number;
    allowedAspect: [number, number];
  };
  /** Per-criterion weights; SUM TO 1.0 (convex combination). composeOverall =
   *  (Σ weightᵢ·criteriaᵢ)·10 → 0..100 (criteria 0..10, weights sum to 1). */
  weights: Record<keyof CriteriaScores, number>;
  disqualifiers: { flag: string; cap: number }[];
  thresholds: { autoAccept: number; review: number; reject: number };
  judgePrompt: string;
}

/**
 * The researched rubric the vision judge receives. Enumerates all seven scored
 * criteria and the nine-flag disqualifier vocabulary so the structured-output
 * judge returns the complete CriteriaScores + flags set. Derived from the
 * research doc §2–§3; refined during calibration.
 */
const JUDGE_PROMPT = `You are grading a single photograph of a wild bird for use as the
identification photo in a digital field guide. Judgment is ID-FIRST: a sharp,
well-framed, diagnostic photo of a wild bird beats a pretty but uninformative one.

Return, as structured output, an integer 0–10 for EACH of these seven criteria:
- framing: subject size and placement in the frame; 10 = bird well-sized and
  uncropped with comfortable headroom, 0 = a distant speck or limbs clipped.
- subjectClarity: focus on the bird, especially the EYE; 10 = eye tack-sharp and
  diagnostic feather detail crisp, 0 = soft / motion-blurred / eye lost.
- liveness: alive and healthy; 10 = alert healthy bird, 0 = dead / sick / injured.
- naturalness: wild bird in a natural setting; 10 = natural perch or habitat,
  0 = in a human hand, captive, at a feeder, a studio backdrop, or a specimen.
- pose: diagnostic view; 10 = clean profile or three-quarter view showing field
  marks, 0 = tail-on / obscured / head hidden.
- background: clean and non-distracting; 10 = subject cleanly separated,
  0 = cluttered background that camouflages field marks.
- lighting: even natural light rendering true color; 10 = ideal, 0 = harsh flash
  or blown highlights / crushed shadows.

ALSO return a list of any of these disqualifier flags that apply (use the exact
strings): "dead", "in-hand", "specimen", "sick", "distant",
"multiple-subjects", "watermark", "captive", "harsh-flash". Apply a flag whenever
the condition is clearly present; these gate the photo's overall score.

ALSO return a one-sentence rationale naming the dominant strength or defect.

Be strict about wild provenance: a bird held by a person, on a banding grip, in a
cage or aviary, at a feeder/seed-tray, or a museum study-skin is NOT a field-guide
photo even if technically sharp — flag it ("in-hand" / "captive" / "specimen") and
score naturalness low.`;

export const defaultRubricConfig: RubricConfig = {
  version: '2026-06-10.0',
  deterministic: {
    // ~0.3 MP floor — below this the bird can't be read at panel size.
    minMegapixels: 0.3,
    // Normalized Laplacian-variance floor; calibrated in Slice 10. Conservative
    // draft so obviously soft images gate before the LLM (the hybrid cost saving).
    minSharpness: 0.04,
    // Reject extreme panoramas/strips; typical bird crops are 0.5–2.0 aspect.
    allowedAspect: [0.4, 2.5],
  },
  // ID-first ranking: clarity + framing dominate; naturalness + liveness carry
  // disqualifier-adjacent weight; pose/background/lighting are aesthetics.
  // WEIGHTS SUM TO 1.0 (convex combination). composeOverall multiplies the
  // weighted average of the 0–10 sub-scores by 10 to land in 0–100, so no
  // separate normalization by the weight-sum is needed. Tuned in calibration.
  weights: {
    subjectClarity: 0.24,
    framing: 0.2,
    naturalness: 0.16,
    liveness: 0.14,
    pose: 0.1,
    background: 0.08,
    lighting: 0.08,
  },
  // Canonical caps (pinned contract). A flagged image's overall is clamped to
  // its cap regardless of sub-scores. Tunable in calibration.
  disqualifiers: [
    { flag: 'dead', cap: 20 },
    { flag: 'specimen', cap: 20 },
    { flag: 'in-hand', cap: 35 },
    { flag: 'captive', cap: 45 },
    { flag: 'sick', cap: 30 },
  ],
  // Composite (0–100) cut points. ≥ autoAccept → auto-accept (ingestor gate);
  // [review, autoAccept) → queue for human review; < reject → auto-reject.
  // Draft values; calibration loop (decision #7) finalizes them.
  thresholds: {
    autoAccept: 75,
    review: 50,
    reject: 35,
  },
  judgePrompt: JUDGE_PROMPT,
  // No `model` field: the vision judge is a Claude Code agent that Reads the
  // image and applies judgePrompt using the session model — there is no SDK
  // model id to pin, and no ANTHROPIC_API_KEY.
};
