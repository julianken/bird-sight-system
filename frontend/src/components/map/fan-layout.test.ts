import { describe, it, expect } from 'vitest';
import {
  computeSpiderfyLayout,
  SPIDERFY_RADIUS_PX,
  SPIDERFY_MAX_LEAVES,
  SPIDERFY_DURATION_MS,
} from './fan-layout.js';

/* ── Pure layout helpers ──────────────────────────────────────────────────
   These functions take pixel coordinates (or screen-projected leaves) and
   return offset/anchor data. They have no maplibre / DOM dependencies, so
   they exercise cleanly in jsdom. */

describe('computeSpiderfyLayout', () => {
  it('places ≤6 markers on a circle at SPIDERFY_RADIUS_PX', () => {
    // Six leaves → circle layout. Each offset has magnitude == radius.
    const layout = computeSpiderfyLayout(6);
    expect(layout).toHaveLength(6);
    expect(layout[0]).toEqual({ kind: 'circle', dx: expect.any(Number), dy: expect.any(Number) });
    for (const offset of layout) {
      const r = Math.hypot(offset.dx, offset.dy);
      expect(r).toBeCloseTo(SPIDERFY_RADIUS_PX, 5);
    }
  });

  it('uses spiral layout for 7-8 markers (radii vary)', () => {
    const layout = computeSpiderfyLayout(8);
    expect(layout).toHaveLength(8);
    expect(layout[0]?.kind).toBe('spiral');

    const radii = layout.map((o) => Math.hypot(o.dx, o.dy));
    // Spiral is monotonically increasing in radius — assert the last
    // marker is strictly farther from origin than the first.
    expect(radii[radii.length - 1]).toBeGreaterThan(radii[0]!);
  });

  it('returns no overlapping placements (every marker has a unique angle)', () => {
    const layout = computeSpiderfyLayout(8);
    const angles = layout.map((o) => Math.atan2(o.dy, o.dx));
    const unique = new Set(angles.map((a) => a.toFixed(3)));
    expect(unique.size).toBe(angles.length);
  });

  it('returns empty array for count === 0', () => {
    expect(computeSpiderfyLayout(0)).toEqual([]);
  });

  it('caps at SPIDERFY_MAX_LEAVES (>8 returns 8 placements)', () => {
    // Defensive cap in the layout helper — keeps placement arrays bounded
    // regardless of how many leaves the caller passes in.
    const layout = computeSpiderfyLayout(15);
    expect(layout).toHaveLength(SPIDERFY_MAX_LEAVES);
  });
});

describe('exported constants', () => {
  it('SPIDERFY_RADIUS_PX matches issue spec (70px)', () => {
    expect(SPIDERFY_RADIUS_PX).toBe(70);
  });

  it('SPIDERFY_MAX_LEAVES matches issue spec (8)', () => {
    expect(SPIDERFY_MAX_LEAVES).toBe(8);
  });

  it('SPIDERFY_DURATION_MS matches issue spec (200ms)', () => {
    expect(SPIDERFY_DURATION_MS).toBe(200);
  });
});
