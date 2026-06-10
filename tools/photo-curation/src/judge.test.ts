import { describe, it, expect } from 'vitest';
import { FakeJudge } from './judge.js';
import type { ImageInput, SpeciesContext } from '@bird-watch/photo-quality';

const img: ImageInput = { buffer: Buffer.from('x'), mime: 'image/jpeg' };
const ctx: SpeciesContext = { speciesCode: 'amerob', comName: 'American Robin', sciName: 'Turdus migratorius', family: 'Turdidae' };

describe('FakeJudge', () => {
  it('returns the canned criteria/flags/rationale for a registered key', async () => {
    const judge = new FakeJudge({
      'image/jpeg': {
        criteria: { framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8 },
        flags: [],
        rationale: 'canned good',
      },
    });
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out.criteria.subjectClarity).toBe(9);
    expect(out.flags).toEqual([]);
    expect(out.rationale).toBe('canned good');
  });

  it('falls back to a neutral mid response for an unregistered key', async () => {
    const judge = new FakeJudge({});
    const out = await judge.judge(img, ctx, 'prompt');
    expect(out.criteria.framing).toBe(5);
    expect(out.flags).toEqual([]);
  });
});
