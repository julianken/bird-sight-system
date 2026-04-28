import { describe, it, expect } from 'vitest';
import {
  groupOverlapping,
  fanPositions,
  type StackInput,
  type Stack,
} from './stack-fanout.js';
import { SPIDERFY_MAX_LEAVES, SPIDERFY_RADIUS_PX } from './fan-layout.js';

/* ── Helpers ───────────────────────────────────────────────────────────────
   Build StackInput records cheaply. Each generated input has unique subId,
   a stable family/silhouette/color, and a screen position the test sets. */

function makeInput(
  subId: string,
  screen: { x: number; y: number },
  overrides: Partial<StackInput> = {},
): StackInput {
  return {
    subId,
    comName: 'House Finch',
    familyCode: 'fringillidae',
    silhouetteId: 'silhouette-house-finch',
    color: '#cc5566',
    isNotable: false,
    obsDt: '2026-04-25T10:00:00Z',
    locName: 'Sabino Canyon',
    screen,
    lngLat: [-110.81 + screen.x * 0.0001, 32.31 + screen.y * 0.0001],
    ...overrides,
  };
}

/* ── groupOverlapping ─────────────────────────────────────────────────────
   Pure detection of co-located screen positions. Singletons are dropped. */

describe('groupOverlapping', () => {
  it('returns an empty array when given no inputs', () => {
    expect(groupOverlapping([])).toEqual([]);
  });

  it('returns an empty array when two inputs are farther apart than thresholdPx', () => {
    // 200px gap >> default 30px threshold → both are singletons → not returned.
    const inputs = [
      makeInput('S1', { x: 100, y: 100 }),
      makeInput('S2', { x: 400, y: 400 }),
    ];
    expect(groupOverlapping(inputs)).toEqual([]);
  });

  it('groups two inputs at identical screen coords into one stack with both members', () => {
    const inputs = [
      makeInput('S1', { x: 200, y: 300 }),
      makeInput('S2', { x: 200, y: 300 }),
    ];
    const stacks = groupOverlapping(inputs);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.members).toHaveLength(2);
    expect(stacks[0]?.members.map((m) => m.subId).sort()).toEqual(['S1', 'S2']);
  });

  it('groups 5 inputs within thresholdPx into one stack with all 5 members', () => {
    // All within a ~10px box centered at (500,500); default 30px threshold.
    const inputs = [
      makeInput('S1', { x: 500, y: 500 }),
      makeInput('S2', { x: 502, y: 503 }),
      makeInput('S3', { x: 498, y: 499 }),
      makeInput('S4', { x: 505, y: 497 }),
      makeInput('S5', { x: 503, y: 501 }),
    ];
    const stacks = groupOverlapping(inputs);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.members).toHaveLength(5);
  });

  it('computes the stack center as the mean of member screen positions', () => {
    const inputs = [
      makeInput('S1', { x: 100, y: 200 }),
      makeInput('S2', { x: 110, y: 220 }),
    ];
    const stacks = groupOverlapping(inputs);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.center.x).toBeCloseTo(105, 5);
    expect(stacks[0]?.center.y).toBeCloseTo(210, 5);
  });

  it('computes the stack centerLngLat as the mean of member lng/lat', () => {
    const inputs = [
      makeInput('S1', { x: 0, y: 0 }, { lngLat: [-111, 32] }),
      makeInput('S2', { x: 0, y: 0 }, { lngLat: [-110, 34] }),
    ];
    const stacks = groupOverlapping(inputs);
    expect(stacks).toHaveLength(1);
    expect(stacks[0]?.centerLngLat[0]).toBeCloseTo(-110.5, 5);
    expect(stacks[0]?.centerLngLat[1]).toBeCloseTo(33, 5);
  });

  it('returns multiple stacks when multiple co-located clusters exist', () => {
    const inputs = [
      makeInput('A1', { x: 100, y: 100 }),
      makeInput('A2', { x: 102, y: 101 }),
      makeInput('B1', { x: 800, y: 800 }),
      makeInput('B2', { x: 802, y: 799 }),
    ];
    const stacks = groupOverlapping(inputs);
    expect(stacks).toHaveLength(2);
    const totalMembers = stacks.reduce((n, s) => n + s.members.length, 0);
    expect(totalMembers).toBe(4);
  });

  it('honors a custom thresholdPx (drops a pair beyond it)', () => {
    const inputs = [
      makeInput('S1', { x: 100, y: 100 }),
      makeInput('S2', { x: 120, y: 100 }),
    ];
    // 20px apart → grouped at default 30, not at custom 10.
    expect(groupOverlapping(inputs, 30)).toHaveLength(1);
    expect(groupOverlapping(inputs, 10)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const inputs = [
      makeInput('S1', { x: 0, y: 0 }),
      makeInput('S2', { x: 1, y: 1 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(inputs));
    groupOverlapping(inputs);
    expect(inputs).toEqual(snapshot);
  });
});

/* ── fanPositions ─────────────────────────────────────────────────────────
   Wraps `computeSpiderfyLayout` (circle ≤6, spiral 7-8) to produce
   per-leaf screen positions anchored at the stack center. Stacks > 8
   members are capped to the first 8 (caller draws a "+N more" badge). */

function makeStack(memberCount: number): Stack {
  const members: StackInput[] = [];
  for (let i = 0; i < memberCount; i += 1) {
    members.push(makeInput(`S${i + 1}`, { x: 600, y: 400 }));
  }
  return {
    center: { x: 600, y: 400 },
    centerLngLat: [-110.81, 32.31],
    members,
  };
}

describe('fanPositions', () => {
  it('returns 5 positions evenly spaced on a circle for a 5-member stack', () => {
    const stack = makeStack(5);
    const positions = fanPositions(stack);
    expect(positions).toHaveLength(5);
    // Each position is exactly SPIDERFY_RADIUS_PX from the stack center.
    for (const p of positions) {
      const dx = p.screen.x - stack.center.x;
      const dy = p.screen.y - stack.center.y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(SPIDERFY_RADIUS_PX, 5);
    }
    // Even spacing: angles step by 2π/5.
    const angles = positions.map((p) =>
      Math.atan2(p.screen.y - stack.center.y, p.screen.x - stack.center.x),
    );
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      const diff = sorted[i]! - sorted[i - 1]!;
      expect(diff).toBeCloseTo((2 * Math.PI) / 5, 3);
    }
  });

  it('returns 8 positions on a spiral for an 8-member stack (radii vary)', () => {
    const stack = makeStack(8);
    const positions = fanPositions(stack);
    expect(positions).toHaveLength(8);
    const radii = positions.map((p) =>
      Math.hypot(p.screen.x - stack.center.x, p.screen.y - stack.center.y),
    );
    // Spiral property: every adjacent pair must be strictly increasing.
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]!);
    }
    // Also confirm the range is non-trivial (not all equal).
    expect(radii[radii.length - 1]).toBeGreaterThan(radii[0]!);
  });

  it('caps a 12-member stack to 8 positions', () => {
    const stack = makeStack(12);
    const positions = fanPositions(stack);
    expect(positions).toHaveLength(SPIDERFY_MAX_LEAVES);
  });

  it('preserves member order when assigning positions (subIds match members slice)', () => {
    const stack = makeStack(4);
    const positions = fanPositions(stack);
    expect(positions.map((p) => p.subId)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('preserves the first 8 subIds (in order) when capping a 12-member stack', () => {
    const stack = makeStack(12);
    const positions = fanPositions(stack);
    expect(positions.map((p) => p.subId)).toEqual([
      'S1',
      'S2',
      'S3',
      'S4',
      'S5',
      'S6',
      'S7',
      'S8',
    ]);
  });

  it('returns an empty array for a stack with zero members (defensive)', () => {
    const stack: Stack = {
      center: { x: 0, y: 0 },
      centerLngLat: [0, 0],
      members: [],
    };
    expect(fanPositions(stack)).toEqual([]);
  });

  it('respects a custom radiusPx by scaling all circle offsets', () => {
    const stack = makeStack(6);
    const positions = fanPositions(stack, 35);
    for (const p of positions) {
      const dx = p.screen.x - stack.center.x;
      const dy = p.screen.y - stack.center.y;
      expect(Math.hypot(dx, dy)).toBeCloseTo(35, 5);
    }
  });

  it('does not mutate the stack object', () => {
    const stack = makeStack(3);
    const snapshot = JSON.parse(JSON.stringify(stack));
    fanPositions(stack);
    expect(stack).toEqual(snapshot);
  });

  it('scales spiral radii proportionally when radiusPx is halved (8-member stack)', () => {
    // With radiusPx=35 (half of SPIDERFY_RADIUS_PX=70) the scale factor is 0.5,
    // so each leaf's radius should be half the default-radius counterpart.
    // This locks in the documented behavior: the same scale factor applied
    // uniformly to both circle and spiral branches.
    const stack = makeStack(8);
    const defaultPositions = fanPositions(stack); // default radiusPx = 70
    const halfPositions = fanPositions(stack, 35); // scale = 0.5

    expect(halfPositions).toHaveLength(8);

    for (let i = 0; i < 8; i += 1) {
      const defaultR = Math.hypot(
        defaultPositions[i]!.screen.x - stack.center.x,
        defaultPositions[i]!.screen.y - stack.center.y,
      );
      const halfR = Math.hypot(
        halfPositions[i]!.screen.x - stack.center.x,
        halfPositions[i]!.screen.y - stack.center.y,
      );
      expect(halfR).toBeCloseTo(defaultR * 0.5, 5);
    }
  });
});
