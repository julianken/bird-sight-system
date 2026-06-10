import type {
  CriteriaScores,
  ImageInput,
  SpeciesContext,
  VisionJudge,
} from './types.js';

/**
 * In-memory VisionJudge test double. This package ships NO SDK judge — the
 * PRODUCTION judge is a Claude Code agent supplied by the Slice-4b scoring
 * workflow (#971), which `Read`s the downloaded image, applies
 * defaultRubricConfig.judgePrompt, and returns the same {criteria, flags,
 * rationale} shape as StructuredOutput. FakeJudge returns a canned response so
 * the rubric MATH (gate short-circuit, weights, caps, verdict) is unit-testable
 * with zero network and zero LLM calls. `calls` records every invocation so a
 * test can assert the judge was/was-not called and with what prompt.
 */
export class FakeJudge implements VisionJudge {
  readonly calls: Array<[ImageInput, SpeciesContext, string]> = [];
  private readonly response: { criteria: CriteriaScores; flags: string[]; rationale: string };

  constructor(opts: { criteria: CriteriaScores; flags?: string[]; rationale?: string }) {
    this.response = {
      criteria: opts.criteria,
      flags: opts.flags ?? [],
      rationale: opts.rationale ?? 'fake judge',
    };
  }

  async judge(
    img: ImageInput,
    ctx: SpeciesContext,
    prompt: string,
  ): Promise<{ criteria: CriteriaScores; flags: string[]; rationale: string }> {
    this.calls.push([img, ctx, prompt]);
    return this.response;
  }
}
