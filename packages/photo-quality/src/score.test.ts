import { describe, it, expect, vi } from 'vitest';
import { scoreImage } from './score.js';
import { FakeJudge } from './fake-judge.js';
import { defaultRubricConfig } from './rubric.config.js';
import { checkerboardJpeg, flatPng } from './fixtures.js';
import type { CriteriaScores, SpeciesContext } from './types.js';

const ctx: SpeciesContext = {
  speciesCode: 'norcar',
  comName: 'Northern Cardinal',
  sciName: 'Cardinalis cardinalis',
  family: 'Cardinalidae',
};

const great: CriteriaScores = {
  framing: 9, subjectClarity: 9, liveness: 10,
  naturalness: 9, pose: 8, background: 8, lighting: 9,
};

describe('scoreImage', () => {
  it('short-circuits a gate failure WITHOUT calling the judge', async () => {
    const judge = new FakeJudge({ criteria: great });
    const spy = vi.spyOn(judge, 'judge');
    const img = await flatPng(200, 200); // tiny + flat → fails gate
    const report = await scoreImage(img, ctx, { judge, config: defaultRubricConfig });

    expect(report.deterministic.passedGate).toBe(false);
    expect(report.verdict).toBe('reject');
    expect(report.overall).toBe(0);
    expect(report.criteria).toEqual({
      framing: 0, subjectClarity: 0, liveness: 0,
      naturalness: 0, pose: 0, background: 0, lighting: 0,
    });
    // #994 pre-filter reject: keep:false is the gate, no judge ran.
    expect(report.keep).toBe(false);
    expect(report.qualityScore).toBe(0);
    expect(report.fieldMarks).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    expect(report.rationale).toMatch(/gate/i);
  });

  it('calls the judge and composes a high overall for a great image', async () => {
    const judge = new FakeJudge({ criteria: great });
    const spy = vi.spyOn(judge, 'judge');
    const img = await checkerboardJpeg(1200, 1000); // passes the gate
    const report = await scoreImage(img, ctx, { judge, config: defaultRubricConfig });

    expect(report.deterministic.passedGate).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(report.overall).toBeGreaterThanOrEqual(defaultRubricConfig.thresholds.autoAccept);
    expect(report.verdict).toBe('great');
    expect(report.criteria).toEqual(great);
    expect(report.rubricVersion).toBe(defaultRubricConfig.version);
  });

  it('GATE is the judge keep, not the composite: a HIGH-composite photo the judge said replace is keep:false', async () => {
    // Judge returns great sub-scores (high composite) but keep:false — a sharp
    // photo whose diagnostic marks are hidden. The gate (keep) must be false
    // even though overall is auto-accept-high.
    const judge = new FakeJudge({ criteria: great, keep: false, qualityScore: 38 });
    const img = await checkerboardJpeg(1200, 1000);
    const report = await scoreImage(img, ctx, { judge, config: defaultRubricConfig });

    expect(report.overall).toBeGreaterThanOrEqual(defaultRubricConfig.thresholds.autoAccept);
    expect(report.keep).toBe(false);          // needs-replacement
    expect(report.qualityScore).toBe(38);
  });

  it('GATE is the judge keep, not the composite: a LOW-composite photo the judge kept is keep:true', async () => {
    // Mediocre sub-scores (low composite) but keep:true — the judge decided the
    // diagnostic marks are readable. The gate must keep it despite the low overall.
    const mediocre: CriteriaScores = {
      framing: 4, subjectClarity: 4, liveness: 6,
      naturalness: 5, pose: 4, background: 4, lighting: 4,
    };
    const judge = new FakeJudge({ criteria: mediocre, keep: true, qualityScore: 62 });
    const img = await checkerboardJpeg(1200, 1000);
    const report = await scoreImage(img, ctx, { judge, config: defaultRubricConfig });

    expect(report.overall).toBeLessThan(defaultRubricConfig.thresholds.autoAccept);
    expect(report.keep).toBe(true);           // kept despite low composite
    expect(report.fieldMarks.length).toBeGreaterThan(0);
  });

  it('applies the disqualifier cap when the judge flags dead', async () => {
    const judge = new FakeJudge({ criteria: great, flags: ['dead'] });
    const img = await checkerboardJpeg(1200, 1000);
    const report = await scoreImage(img, ctx, { judge, config: defaultRubricConfig });

    expect(report.overall).toBeLessThanOrEqual(20);
    expect(report.verdict).toBe('reject');
    expect(report.flags).toEqual(['dead']);
  });

  it('passes the configured judge prompt through to the judge', async () => {
    const judge = new FakeJudge({ criteria: great });
    const spy = vi.spyOn(judge, 'judge');
    const img = await checkerboardJpeg(1200, 1000);
    await scoreImage(img, ctx, { judge, config: defaultRubricConfig });
    expect(spy).toHaveBeenCalledWith(img, ctx, defaultRubricConfig.judgePrompt);
  });
});
