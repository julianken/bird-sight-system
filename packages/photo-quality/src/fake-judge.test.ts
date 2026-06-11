import { describe, it, expect } from 'vitest';
import { FakeJudge } from './fake-judge.js';
import type { CriteriaScores, SpeciesContext } from './types.js';

const ctx: SpeciesContext = {
  speciesCode: 'norcar',
  comName: 'Northern Cardinal',
  sciName: 'Cardinalis cardinalis',
  family: 'Cardinalidae',
};
const criteria: CriteriaScores = {
  framing: 7, subjectClarity: 8, liveness: 9,
  naturalness: 7, pose: 6, background: 6, lighting: 7,
};
const img = { buffer: Buffer.from([1, 2, 3]), mime: 'image/png' };

describe('FakeJudge', () => {
  it('returns the canned field-mark-aware output verbatim (#969 shape)', async () => {
    const judge = new FakeJudge({
      criteria, flags: ['watermark'], rationale: 'fake',
      fieldMarks: ['crest', 'red bill'], keep: false, qualityScore: 42,
    });
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out).toEqual({
      fieldMarks: ['crest', 'red bill'],
      criteria,
      flags: ['watermark'],
      keep: false,
      qualityScore: 42,
      rationale: 'fake',
    });
  });

  it('defaults flags to [], rationale to a fixed string, keep to true, and a fieldMarks array', async () => {
    const judge = new FakeJudge({ criteria });
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out.flags).toEqual([]);
    expect(typeof out.rationale).toBe('string');
    expect(out.keep).toBe(true);
    expect(Array.isArray(out.fieldMarks)).toBe(true);
    expect(typeof out.qualityScore).toBe('number');
  });

  it('records the last call args so tests can assert on them', async () => {
    const judge = new FakeJudge({ criteria });
    await judge.judge(img, ctx, 'the-prompt');
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]).toEqual([img, ctx, 'the-prompt']);
  });
});
