import { describe, it, expect } from 'vitest';
import { runRow, type RunRowInput } from './run-row.js';
import type { ImageInput, SpeciesContext, JudgeOutput, VisionJudge } from '@bird-watch/photo-quality';

/**
 * The tool's `tsc` is EXCLUDED from CI (the build gate runs the workspace
 * builds, not this tool's), so this vitest file is the ONLY safety net for the
 * row→judge wiring that `photo-judge.eval.ts` depends on. It exercises the exact
 * mapping the eval task relies on: an `EvalRow.input` becomes an `ImageInput`
 * (via the injected `readImage`) + a `SpeciesContext`, and the judge is called
 * with the rubric prompt. No network, no real judge, no filesystem.
 */

const VALID_OUTPUT: JudgeOutput = {
  fieldMarks: ['rufous breast', 'gray head'],
  criteria: { framing: 8, subjectClarity: 9, liveness: 10, naturalness: 9, pose: 7, background: 8, lighting: 8 },
  flags: [],
  keep: true,
  qualityScore: 85,
  rationale: 'sharp wild adult',
};

/** Records every (img, ctx, prompt) it is asked to judge; returns a canned output. */
class FakeJudge implements VisionJudge {
  readonly calls: Array<[ImageInput, SpeciesContext, string]> = [];
  constructor(private readonly out: JudgeOutput = VALID_OUTPUT) {}
  async judge(img: ImageInput, ctx: SpeciesContext, prompt: string): Promise<JudgeOutput> {
    this.calls.push([img, ctx, prompt]);
    return this.out;
  }
}

const INPUT: RunRowInput = {
  imagePath: '/thumbs/amerob.jpg',
  speciesCode: 'amerob',
  comName: 'American Robin',
  sciName: 'Turdus migratorius',
  family: 'Turdidae',
};

describe('runRow', () => {
  it('reads the image, builds the species context, and returns the judge output', async () => {
    const judge = new FakeJudge();
    const readImage = (p: string): ImageInput => ({ buffer: Buffer.from(`bytes:${p}`), mime: 'image/jpeg' });

    const out = await runRow({ judge, readImage, prompt: 'rubric prompt v1' }, INPUT);

    expect(out).toEqual(VALID_OUTPUT);
    expect(judge.calls).toHaveLength(1);
    const [img, ctx, prompt] = judge.calls[0]!;
    expect(img.buffer).toEqual(Buffer.from('bytes:/thumbs/amerob.jpg'));
    expect(img.mime).toBe('image/jpeg');
    expect(ctx).toEqual({
      speciesCode: 'amerob',
      comName: 'American Robin',
      sciName: 'Turdus migratorius',
      family: 'Turdidae',
    });
    expect(prompt).toBe('rubric prompt v1');
  });

  it('passes the imagePath through to readImage exactly once', async () => {
    const judge = new FakeJudge();
    const seen: string[] = [];
    const readImage = (p: string): ImageInput => {
      seen.push(p);
      return { buffer: Buffer.from('x'), mime: 'image/png' };
    };

    await runRow({ judge, readImage, prompt: 'p' }, INPUT);

    expect(seen).toEqual(['/thumbs/amerob.jpg']);
  });

  it('threads the source path onto the ImageInput sourceUrl (so the span records it)', async () => {
    const judge = new FakeJudge();
    const readImage = (p: string): ImageInput => ({ buffer: Buffer.from('x'), mime: 'image/jpeg', sourceUrl: p });

    await runRow({ judge, readImage, prompt: 'p' }, INPUT);

    const [img] = judge.calls[0]!;
    expect(img.sourceUrl).toBe('/thumbs/amerob.jpg');
  });
});
