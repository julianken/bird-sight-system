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
  it('returns the canned criteria/flags/rationale verbatim', async () => {
    const judge = new FakeJudge({ criteria, flags: ['watermark'], rationale: 'fake' });
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out).toEqual({ criteria, flags: ['watermark'], rationale: 'fake' });
  });

  it('defaults flags to [] and rationale to a fixed string', async () => {
    const judge = new FakeJudge({ criteria });
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out.flags).toEqual([]);
    expect(typeof out.rationale).toBe('string');
  });

  it('records the last call args so tests can assert on them', async () => {
    const judge = new FakeJudge({ criteria });
    await judge.judge(img, ctx, 'the-prompt');
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]).toEqual([img, ctx, 'the-prompt']);
  });
});
