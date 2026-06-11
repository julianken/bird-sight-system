import { assessDeterministic } from './deterministic.js';
import { composeReport } from './composite.js';
import type {
  CriteriaScores,
  ImageInput,
  QualityReport,
  RubricConfig,
  SpeciesContext,
  VisionJudge,
} from './types.js';

const ZERO_CRITERIA: CriteriaScores = {
  framing: 0,
  subjectClarity: 0,
  liveness: 0,
  naturalness: 0,
  pose: 0,
  background: 0,
  lighting: 0,
};

/**
 * Score one image against the rubric. Stage 1 (deterministic, free) gates;
 * a gate failure SHORT-CIRCUITS — the judge is never called (the hybrid cost
 * saving), and the report is an auto-reject with zeroed criteria. On a pass,
 * the injected VisionJudge supplies the 0–10 sub-scores + flags + rationale,
 * and the composite (weights → disqualifier caps → verdict) is computed here,
 * not by the model. Pure except for the judge call delegated to opts.judge.
 */
export async function scoreImage(
  img: ImageInput,
  ctx: SpeciesContext,
  opts: { judge: VisionJudge; config: RubricConfig },
): Promise<QualityReport> {
  const { judge, config } = opts;
  const deterministic = await assessDeterministic(img, config.deterministic);

  if (!deterministic.passedGate) {
    // #994 pre-filter reject: junk image, never judged. keep:false is the gate.
    return {
      overall: 0,
      verdict: 'reject',
      deterministic,
      criteria: { ...ZERO_CRITERIA },
      flags: [],
      fieldMarks: [],
      keep: false,
      qualityScore: 0,
      rationale: `deterministic gate failed: ${deterministic.failReasons.join(', ')}`,
      rubricVersion: config.version,
    };
  }

  const { fieldMarks, criteria, flags, keep, qualityScore, rationale } =
    await judge.judge(img, ctx, config.judgePrompt);
  // overall/verdict rank for the review UI; `keep` is the GATE (#969).
  const composed = composeReport(criteria, flags, config, { keep, qualityScore });

  return {
    overall: composed.overall,
    verdict: composed.verdict,
    deterministic,
    criteria,
    flags,
    fieldMarks,
    keep: composed.keep,
    qualityScore: composed.qualityScore,
    rationale,
    rubricVersion: config.version,
  };
}
