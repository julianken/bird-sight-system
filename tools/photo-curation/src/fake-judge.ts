import type { ImageInput, SpeciesContext, VisionJudge, JudgeOutput } from '@bird-watch/photo-quality';

const NEUTRAL: JudgeOutput = {
  fieldMarks: [],
  criteria: { framing: 5, subjectClarity: 5, liveness: 5, naturalness: 5, pose: 5, background: 5, lighting: 5 },
  flags: [],
  keep: true,
  qualityScore: 50,
  rationale: 'neutral (unregistered fake key)',
};

/**
 * Deterministic test double for VisionJudge. Keyed by image `mime` for the
 * simple tests here. No network. The PRODUCTION judge is NOT defined here and is
 * NOT an SDK call — it is a Claude Code agent the Part B `score` workflow
 * supplies (Part B, Task 8): per image it `Read`s the downloaded file, applies
 * defaultRubricConfig.judgePrompt, and returns the field-mark-aware JudgeOutput
 * {fieldMarks, criteria, flags, keep, qualityScore, rationale} (#969) as
 * StructuredOutput. No @anthropic-ai/sdk, no ANTHROPIC_API_KEY. Adding an SDK
 * judge here is a contract violation — do not.
 */
export class FakeJudge implements VisionJudge {
  constructor(private readonly canned: Record<string, JudgeOutput>) {}
  async judge(img: ImageInput, _ctx: SpeciesContext, _prompt: string): Promise<JudgeOutput> {
    return this.canned[img.mime] ?? NEUTRAL;
  }
}
