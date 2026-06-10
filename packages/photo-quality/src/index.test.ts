import { describe, it, expect } from 'vitest';
import * as pkg from './index.js';

describe('public surface', () => {
  it('exports the scoring entry points', () => {
    expect(typeof pkg.scoreImage).toBe('function');
    expect(typeof pkg.assessDeterministic).toBe('function');
    expect(typeof pkg.composeOverall).toBe('function');
    expect(typeof pkg.composeReport).toBe('function');
    expect(typeof pkg.contentHash).toBe('function');
    expect(typeof pkg.scoreCacheKey).toBe('function');
    expect(typeof pkg.FakeJudge).toBe('function');
    expect(pkg.defaultRubricConfig.version).toBe('0.1.0');
    // No SDK judge, no model field — the production judge is a Claude Code agent (#971).
    expect('model' in pkg.defaultRubricConfig).toBe(false);
    expect((pkg as Record<string, unknown>).ClaudeVisionJudge).toBeUndefined();
    expect((pkg as Record<string, unknown>).makeVisionJudge).toBeUndefined();
    expect([...pkg.DISQUALIFIER_FLAGS]).toHaveLength(9);
  });
});
