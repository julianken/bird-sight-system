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
 * SCOPE NOTE: Slice 1 declared minimal `CriteriaScores` / `RubricConfig` types
 * here locally; Slice 2 authored `src/types.ts` (the full pinned contract) and
 * this file now imports both from there, so the rubric literal and every
 * scoring function (`composeReport`, `assessDeterministic`, `scoreImage`) are
 * typed against ONE canonical definition — no structurally-twin types.
 */

import type { RubricConfig } from './types.js';

/**
 * The field-mark-aware rubric the vision judge receives (calibration #969). The
 * production judge is Opus and its DIRECT keep/replace decision is the GATE; the
 * seven criteria are kept for review-UI ranking/display (the composite + caps +
 * thresholds become advisory). A five-experiment, 80-photo calibration against
 * an Opus "premium field-guide editor" oracle picked this framing: making the
 * judge name the species' diagnostic field marks FIRST, then decide, recovered
 * the species-aware reasoning the cheaper holistic judges lacked (the Haiku gate
 * rated an insect 86/100 as a "Bank Swallow"). The species name/family + image
 * path are injected per-call by the scorer — this prompt hardcodes NO species.
 * Record: docs/analyses/2026-06-10-photo-scorer-calibration/report.md.
 */
const JUDGE_PROMPT = `You are the photo editor for a PREMIUM printed bird field guide, choosing the single best
identification photograph for each species. You are judging ONE photograph of the species
named in the request. Work in four steps and return everything as structured output.

STEP 1 — Diagnostic field marks. From your ornithological knowledge of this species, name the
3–6 field marks a birder uses to identify it and separate it from similar species — specific
plumage patterns, bare-part colors, or structural features.

STEP 2 — Criteria. Return an integer 0–10 for EACH:
- framing: subject size/placement; 10 = bird well-sized and uncropped, 0 = a distant speck or clipped.
- subjectClarity: focus on the bird, especially the EYE; 10 = tack-sharp, 0 = soft/motion-blurred.
- liveness: alive and healthy; 10 = alert healthy bird, 0 = dead/sick/injured.
- naturalness: wild bird in a natural setting; 10 = natural perch/habitat, 0 = in-hand/captive/feeder/studio/specimen.
- pose: diagnostic view; 10 = clean profile or three-quarter showing field marks, 0 = tail-on/obscured/head hidden.
- background: clean and non-distracting; 10 = subject cleanly separated, 0 = cluttered/camouflaging.
- lighting: even natural light, true color; 10 = ideal, 0 = harsh flash/blown highlights/crushed shadows.

STEP 3 — Disqualifier flags. Return any that clearly apply (exact strings):
"dead","in-hand","specimen","sick","distant","multiple-subjects","watermark","captive","harsh-flash".

STEP 4 — Decision. Judging THIS photo against the Step 1 diagnostic marks: how many are clearly
visible and readable? A KEEPER must show a LIVE, WILD bird; be sharp (especially the eye); be
large enough and unobstructed enough that its diagnostic marks can be read; sit in a natural
setting (NOT in a human hand, banding grip, cage/aviary, feeder/seed-tray, studio backdrop, or
museum specimen; not dead or sick); and render true color. A merely acceptable snapshot — or one
where the diagnostic marks are hidden by pose, distance, or clutter — should be REPLACED, even if
technically sharp. Be strict about wild provenance.

Return: fieldMarks (array of the Step 1 marks), the seven criteria, flags, keep (boolean — keep as
the species' guide photo, or replace), qualityScore (0–100), and a one-sentence rationale naming
which diagnostic marks are visible or missing.`;

export const defaultRubricConfig: RubricConfig = {
  // semver-shaped (QualityReport.rubricVersion keys the content-hash score
  // cache; a tune bumps this and invalidates cached scores). 0.2.0 = the #969
  // calibration: Opus field-mark prompt + direct keep/replace gate. Bumping it
  // invalidates every 0.1.0 cached score so the backlog re-scores under the new
  // judge.
  version: '0.2.0',
  deterministic: {
    // ~0.3 MP floor — below this the bird can't be read at panel size.
    minMegapixels: 0.3,
    // Normalized Laplacian-variance floor; calibrated in Slice 10. Conservative
    // draft so obviously soft images gate before the LLM (the hybrid cost saving).
    minSharpness: 0.005,
    // Reject extreme panoramas/strips; typical bird crops are 0.5–2.0 aspect.
    allowedAspect: [0.4, 2.5],
  },
  // GATE NOTE (calibration #969): weights + disqualifiers + thresholds are now
  // ADVISORY — they drive the review-UI ranking/display composite (`overall`,
  // `verdict`), NOT the gate. The production gate is the judge's DIRECT `keep`
  // (QualityReport.keep). The #994 deterministic pre-filter (below) still gates a
  // cheap reject BEFORE any vision call. These knobs are kept (not deleted) so the
  // review UI can still rank by composite and surface flag caps.
  //
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
  // Composite (0–100) cut points — ADVISORY since #969 (the gate is the judge's
  // `keep`, not these). They still map a composite to a verdict for the review
  // UI's ranking/badges and pick which flagged species `source-candidates`
  // sources alternates for (current overall < `review`).
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
