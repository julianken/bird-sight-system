import { describe, it, expect } from 'vitest';
import { defaultRubricConfig } from './rubric.config.js';
import { CRITERIA_KEYS, DISQUALIFIER_FLAGS } from './types.js';

/**
 * Slice 1 owns this file + the `defaultRubricConfig` export name; Slice 2 may
 * tune the numeric VALUES and owns this contract test. The judge is a Claude
 * Code agent using the session model (Slice 4b / #971), so RubricConfig has no
 * `model` field — guarded below so an SDK model id can't creep back in. The
 * placeholder-prompt reconciliation tripwire is intentionally absent: Slice 1
 * already merged the research-derived judgePrompt, so there is no placeholder to
 * track (the prompt-completeness assertion below pins the real prompt instead).
 */

describe('defaultRubricConfig', () => {
  it('is version-stamped', () => {
    expect(defaultRubricConfig.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('weights cover exactly the 7 criteria and sum to 1', () => {
    const keys = Object.keys(defaultRubricConfig.weights).sort();
    expect(keys).toEqual([...CRITERIA_KEYS].sort());
    const sum = Object.values(defaultRubricConfig.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('carries the 5 canonical disqualifier caps', () => {
    const caps = Object.fromEntries(
      defaultRubricConfig.disqualifiers.map((d) => [d.flag, d.cap]),
    );
    expect(caps).toMatchObject({
      dead: 20, specimen: 20, 'in-hand': 35, captive: 45, sick: 30,
    });
  });

  it('orders thresholds autoAccept > review > reject', () => {
    const t = defaultRubricConfig.thresholds;
    expect(t.autoAccept).toBeGreaterThan(t.review);
    expect(t.review).toBeGreaterThan(t.reject);
  });

  it('has a non-empty judge prompt and carries no SDK model field', () => {
    expect(defaultRubricConfig.judgePrompt.length).toBeGreaterThan(0);
    // The model id was dropped in the 2026-06-10 revision (Claude-Code-native
    // judge, no SDK). Guard that it does not creep back in.
    expect('model' in defaultRubricConfig).toBe(false);
  });

  it('judge prompt names every criterion and every disqualifier flag', () => {
    const p = defaultRubricConfig.judgePrompt;
    for (const k of CRITERIA_KEYS) expect(p).toContain(k);
    for (const flag of DISQUALIFIER_FLAGS) expect(p).toContain(flag);
  });

  it('judge prompt carries the v0.2.2 same-species + adult-preference refinements', () => {
    const p = defaultRubricConfig.judgePrompt;
    // multiple-subjects clarification: flag DIFFERENT species, never conspecifics.
    expect(p).toMatch(/DIFFERENT species/i);
    expect(p).toMatch(/SAME species/i);
    // mild adult-plumage tiebreaker in the decision step.
    expect(p).toMatch(/adult/i);
    expect(p).toMatch(/tiebreaker|juvenile|immature/i);
  });

  it('has deterministic-gate minimums', () => {
    const d = defaultRubricConfig.deterministic;
    expect(d.minMegapixels).toBeGreaterThan(0);
    expect(d.minSharpness).toBeGreaterThan(0);
    expect(d.allowedAspect[0]).toBeLessThan(d.allowedAspect[1]);
  });
});
