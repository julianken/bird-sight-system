import type {
  CriteriaScores,
  ImageInput,
  JudgeOutput,
  SpeciesContext,
  VisionJudge,
} from './types.js';

/**
 * In-memory VisionJudge test double. This package ships NO SDK judge — the
 * PRODUCTION judge is a Claude Code agent supplied by the Slice-4b scoring
 * workflow (#971), which `Read`s the downloaded image, applies
 * defaultRubricConfig.judgePrompt, and returns the field-mark-aware
 * {fieldMarks, criteria, flags, keep, qualityScore, rationale} JudgeOutput
 * (#969). FakeJudge returns a canned response so the rubric MATH (gate
 * short-circuit, weights, caps, verdict) AND the keep gate are unit-testable
 * with zero network and zero LLM calls. `calls` records every invocation so a
 * test can assert the judge was/was-not called and with what prompt.
 *
 * `keep` and `qualityScore` default sensibly so existing tests that only pass
 * `criteria` still get a coherent JudgeOutput: `keep` defaults to true and
 * `qualityScore` to a clarity-weighted estimate, but a test that exercises the
 * gate passes them explicitly.
 */
export class FakeJudge implements VisionJudge {
  readonly calls: Array<[ImageInput, SpeciesContext, string]> = [];
  private readonly response: JudgeOutput;

  constructor(opts: {
    criteria: CriteriaScores;
    flags?: string[];
    rationale?: string;
    fieldMarks?: string[];
    keep?: boolean;
    qualityScore?: number;
  }) {
    this.response = {
      fieldMarks: opts.fieldMarks ?? ['fake field mark'],
      criteria: opts.criteria,
      flags: opts.flags ?? [],
      keep: opts.keep ?? true,
      qualityScore: opts.qualityScore ?? opts.criteria.subjectClarity * 10,
      rationale: opts.rationale ?? 'fake judge',
    };
  }

  async judge(
    img: ImageInput,
    ctx: SpeciesContext,
    prompt: string,
  ): Promise<JudgeOutput> {
    this.calls.push([img, ctx, prompt]);
    return this.response;
  }
}
