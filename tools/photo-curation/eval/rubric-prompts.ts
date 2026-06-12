// ─────────────────────────────────────────────────────────────────────────────
// Version-keyed judge prompts + the EVAL_MODEL knob (#1037) — the two
// comparability knobs the eval reads.
//
// Principle: the rubric version is part of the DATASET, not the live code. An
// interchangeability eval grades the judge against a baseline scored under a
// specific rubric version, so the judge must be prompted with THAT version's
// text — judging a v0.2.1 baseline with the live v0.2.2 prompt turns rubric
// drift (same-species multiples OK, mild adult preference; commit 974d8c5)
// into phantom "disagreement". `judgePromptForRubricVersion` selects the
// prompt by the version `buildEvalRows` asserted over the baseline; an
// unknown version throws — never silently judge under different criteria.
//
// The map carries (a) the frozen v0.2.1 snapshot below (recovered verbatim
// from git: `git show 974d8c5^:packages/photo-quality/src/rubric.config.ts`)
// and (b) the LIVE config's version → live prompt, so when the baseline is
// someday re-scored under v0.2.2+ the pin follows automatically with no edit
// here. The snapshot text is FROZEN — a calibration tune bumps the live
// version in @bird-watch/photo-quality; it must never retouch this history.
//
// This module lives next to the eval entry (outside src/) because it is
// eval-only config: production scoring always uses the live
// defaultRubricConfig, and nothing under src/ may depend on a frozen prompt.
// ─────────────────────────────────────────────────────────────────────────────

import { defaultRubricConfig } from '@bird-watch/photo-quality';

/**
 * The v0.2.1 judge prompt, verbatim as the 902-row Opus baseline was scored
 * (every `review.sqlite` role='current' row is stamped rubric_version 0.2.1).
 * Differs from v0.2.2 by exactly two criteria changes it predates: the STEP 3
 * same-species-multiples clarification and the STEP 4 adult-plumage tiebreaker.
 */
const JUDGE_PROMPT_V0_2_1 = `You are the photo editor for a PREMIUM printed bird field guide, choosing the single best
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

/**
 * Judge prompts keyed by rubric version. Frozen snapshots first; the live
 * config's entry is spread last so a live version equal to a snapshot key
 * (impossible today, but harmless) resolves to the identical live text.
 */
const RUBRIC_PROMPTS: Readonly<Record<string, string>> = {
  '0.2.1': JUDGE_PROMPT_V0_2_1,
  [defaultRubricConfig.version]: defaultRubricConfig.judgePrompt,
};

/**
 * The judge prompt for `version`, or a hard throw when no prompt is known for
 * it (#1037 decision 1) — a baseline whose criteria we cannot reproduce must
 * never be silently judged under different ones.
 */
export function judgePromptForRubricVersion(version: string): string {
  const prompt = RUBRIC_PROMPTS[version];
  if (prompt === undefined) {
    throw new Error(
      `[rubric-prompts] no judge prompt is pinned for rubric_version '${version}' (known: ${Object.keys(RUBRIC_PROMPTS).join(', ')}) — snapshot that version's judgePrompt here before judging against its baseline`,
    );
  }
  return prompt;
}

/** Default judge model — the gate decision (#1010) is about gemini-2.5-flash. */
export const DEFAULT_EVAL_MODEL = 'gemini-2.5-flash';

/**
 * The judge model for this run: `EVAL_MODEL` when set and non-empty, else
 * {@link DEFAULT_EVAL_MODEL}. Same dataset + same pinned rubric + a different
 * `EVAL_MODEL` = directly comparable experiments — "grade the models on how
 * close they come to the original findings" is a one-env-var operation. The
 * model is recorded in the experiment metadata AND on every judgment span.
 */
export function resolveEvalModel(env: { EVAL_MODEL?: string }): string {
  return env.EVAL_MODEL || DEFAULT_EVAL_MODEL;
}
