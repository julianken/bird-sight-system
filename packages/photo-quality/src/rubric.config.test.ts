import { describe, it, expect } from 'vitest';
import {
  defaultRubricConfig,
  type RubricConfig,
  type CriteriaScores,
} from './rubric.config.js';

/**
 * Slice 1 owns ONLY the rubric config + its structural invariants. scoreImage,
 * the deterministic metrics, and the VisionJudge are Slice 2. So this suite is
 * deliberately data-shape-only: it proves the config parses, that its weight
 * keys are exactly the seven CriteriaScores keys (the contract that lets the
 * composite math in Slice 2 iterate weights without a missing/extra key), that
 * the weights form a convex combination (sum to 1.0), and that the canonical
 * disqualifier caps and thresholds are present. There is no model-id assertion:
 * the judge is a Claude Code agent using the session model, so RubricConfig has
 * no `model` field. Prompt prose quality is validated by the human calibration
 * loop (spec §6/§10), not here.
 */

// The seven canonical criteria keys, pinned by the interface contract. If this
// list and Object.keys(weights) ever diverge, the composite weighting breaks.
const CRITERIA_KEYS: (keyof CriteriaScores)[] = [
  'framing',
  'subjectClarity',
  'liveness',
  'naturalness',
  'pose',
  'background',
  'lighting',
];

describe('defaultRubricConfig', () => {
  it('is a well-formed RubricConfig literal', () => {
    const cfg: RubricConfig = defaultRubricConfig;
    expect(typeof cfg.version).toBe('string');
    expect(cfg.version.length).toBeGreaterThan(0);
  });

  it('weights keys === the seven CriteriaScores keys (no missing, no extra)', () => {
    const weightKeys = Object.keys(defaultRubricConfig.weights).sort();
    expect(weightKeys).toEqual([...CRITERIA_KEYS].sort());
    // every weight is a positive finite number — no 0-weight stubs
    for (const k of CRITERIA_KEYS) {
      const w = defaultRubricConfig.weights[k];
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }
  });

  it('weights sum to 1.0 (convex combination — sum-to-1 convention)', () => {
    const sum = CRITERIA_KEYS.reduce(
      (acc, k) => acc + defaultRubricConfig.weights[k],
      0,
    );
    // tolerate float dust; the contract is exact-sum-to-1 by intent
    expect(sum).toBeCloseTo(1, 6);
  });

  it('carries the canonical disqualifier caps', () => {
    const caps = Object.fromEntries(
      defaultRubricConfig.disqualifiers.map((d) => [d.flag, d.cap]),
    );
    expect(caps).toMatchObject({
      dead: 20,
      specimen: 20,
      'in-hand': 35,
      captive: 45,
      sick: 30,
    });
  });

  it('has all three threshold cut points, ordered reject < review < autoAccept', () => {
    const { reject, review, autoAccept } = defaultRubricConfig.thresholds;
    expect(reject).toBeLessThan(review);
    expect(review).toBeLessThan(autoAccept);
  });

  it('has a non-empty judgePrompt that names every criterion and flag', () => {
    const p = defaultRubricConfig.judgePrompt;
    expect(p.length).toBeGreaterThan(200);
    for (const k of CRITERIA_KEYS) {
      expect(p).toContain(k);
    }
    for (const flag of [
      'dead', 'in-hand', 'specimen', 'sick', 'distant',
      'multiple-subjects', 'watermark', 'captive', 'harsh-flash',
    ]) {
      expect(p).toContain(flag);
    }
  });

  it('has deterministic-gate minimums', () => {
    const d = defaultRubricConfig.deterministic;
    expect(d.minMegapixels).toBeGreaterThan(0);
    expect(d.minSharpness).toBeGreaterThan(0);
    expect(d.allowedAspect[0]).toBeLessThan(d.allowedAspect[1]);
  });
});
