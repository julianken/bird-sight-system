import { describe, it, expect } from 'vitest';
import {
  intersect,
  aabbForShape,
  unionFind,
  bucketKey,
  buildGroups,
  type DeconflictInput,
} from './deconflict.js';

// Shared fixtures
const grid4x4 = { kind: 'grid', shape: { tag: 'grid', cols: 4, rows: 4 } } as const;
const grid2x2 = { kind: 'grid', shape: { tag: 'grid', cols: 2, rows: 2 } } as const;
const grid1x1 = { kind: 'grid', shape: { tag: 'grid', cols: 1, rows: 1 } } as const;
const pillSand = { kind: 'pill', count: 214 } as const;

function cluster(
  id: number,
  px: number,
  py: number,
  rendered = grid4x4 as DeconflictInput['rendered'],
  point_count = 32,
  uniqueFamilies = 16,
): DeconflictInput {
  return { cluster_id: id, px, py, rendered, point_count, uniqueFamilies };
}

describe('deconflict', () => {
  // Test 1
  it('anchor selection uses min(cluster_id) unconditionally (no point_count tiebreak)', () => {
    // Two clusters overlap; A has lower id but lower count. A must still be anchor.
    const A = cluster(/* id */ 5, 100, 100, grid4x4, /* count */ 10);
    const B = cluster(/* id */ 12, 110, 100, grid4x4, /* count */ 1000);
    const groups = buildGroups([A, B], /* zoom */ 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(5);
    expect(groups[0].memberIds).toEqual([5, 12]);  // buildGroups guarantees sorted memberIds
  });

  // Test 2
  it('AABB intersect — fully disjoint → no edge', () => {
    expect(intersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 100, y: 100, w: 50, h: 50 })).toBe(false);
  });

  // Test 3
  it('AABB intersect — strictly overlapping → edge', () => {
    expect(intersect({ x: 0, y: 0, w: 50, h: 50 }, { x: 25, y: 25, w: 50, h: 50 })).toBe(true);
  });

  // Test 4
  it('AABB intersect — 1px gap with margin=1 → edge (CSS subpixel safety)', () => {
    // Two 50×50 boxes touching but not overlapping (b.x = a.x + a.w + 1 = 51).
    const a = { x: 0, y: 0, w: 50, h: 50 };
    const b = { x: 51, y: 0, w: 50, h: 50 };
    expect(intersect(a, b, /* margin */ 0)).toBe(false);
    expect(intersect(a, b, /* margin */ 1)).toBe(true);
  });

  // Test 5
  it('UF cascade transitivity: A∩B, B∩C → one component {A,B,C}', () => {
    // Three 100-wide markers chained: A at 0, B at 80, C at 160.
    // A∩B overlap (gap 80 < 100), B∩C overlap, A∩C disjoint (gap 160 > 100).
    const A = cluster(1, 0, 0);
    const B = cluster(2, 80, 0);
    const C = cluster(3, 160, 0);
    const groups = buildGroups([A, B, C], 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual([1, 2, 3]);  // buildGroups guarantees sorted memberIds
    expect(groups[0].anchor.cluster_id).toBe(1);
  });

  // Test 6
  it('UF idempotence — repeated buildGroups(same input) yields identical output', () => {
    const inputs = [cluster(1, 0, 0), cluster(2, 50, 0), cluster(3, 1000, 0)];
    const a = buildGroups(inputs, 8);
    const b = buildGroups(inputs, 8);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  // Test 7 — the directly-load-bearing test for blocker B2 (issue #554 dissent loop)
  it('spatial-bucket key stable when anchor unchanged but companions change', () => {
    // Frame 1: anchor (id=1) overlaps companion (id=2). Expect key K1.
    const f1 = buildGroups([cluster(1, 100, 100), cluster(2, 110, 100)], 8);
    // Frame 2: anchor (id=1) overlaps a DIFFERENT companion (id=99). Anchor's pixel position is unchanged.
    const f2 = buildGroups([cluster(1, 100, 100), cluster(99, 110, 100)], 8);
    expect(f1).toHaveLength(1);
    expect(f2).toHaveLength(1);
    // The companion changed but the anchor (min cluster_id) is still id=1 at (100,100). React key must match.
    expect(f1[0].key).toBe(f2[0].key);
  });

  // Test 8
  it('spatial-bucket key changes when anchor crosses a 14px bucket boundary (real pan)', () => {
    // 14 = MIN_MARKER_PX / 2. round(95/14)=7, round(97/14)=7, round(105/14)=8 → cross at 105.
    const groupA = buildGroups([cluster(1, 95, 100)], 8);
    const groupB = buildGroups([cluster(1, 97, 100)], 8);
    const groupC = buildGroups([cluster(1, 105, 100)], 8);
    expect(groupA[0].key).toBe(groupB[0].key);  // same bucket
    expect(groupA[0].key).not.toBe(groupC[0].key);  // boundary crossed
  });

  // Test 9
  it('aria-label format for solo group matches existing convention', () => {
    const A = cluster(1, 0, 0, grid2x2, /* count */ 7, /* uniqueFamilies */ 3);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 7 observations, 3 families. Activate to zoom in.',
    );
  });

  // Test 9b
  it('aria-label uses singular "family" for uniqueFamilies=1', () => {
    const A = cluster(1, 0, 0, grid1x1 as DeconflictInput['rendered'], /* count */ 1, /* uniqueFamilies */ 1);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 1 observations, 1 family. Activate to zoom in.',
    );
  });

  // Test 10
  it('aria-label for multi-member group: "Cluster: N observations (+M nearby in K clusters). Activate to zoom in."', () => {
    // Two clusters overlap: anchor with 32 obs + nearby with 12 obs = total 44; otherCount = 12; K = 1
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const groups = buildGroups([A, B], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+12 nearby in 1 cluster). Activate to zoom in.',
    );
  });

  // Test 10b
  it('aria-label for 3-member group uses plural "clusters"', () => {
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const C = cluster(3, 120, 100, grid2x2, /* count */ 8, /* uniqueFamilies */ 3);
    const groups = buildGroups([A, B, C], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+20 nearby in 2 clusters). Activate to zoom in.',
    );
  });

  // Test 11 (rewritten per julianken-bot finding — see issue #554)
  it('memberIds preservation — buildGroups emits full memberIds list (length + content)', () => {
    const inputs = [cluster(7, 100, 100), cluster(3, 110, 100), cluster(15, 120, 100)];
    const groups = buildGroups(inputs, 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual([3, 7, 15]);  // buildGroups guarantees sorted memberIds
    expect(groups[0].anchor.cluster_id).toBe(3);  // min(id)
  });

  // Test 12
  it('empty viewport → no groups, no exceptions', () => {
    expect(buildGroups([], 8)).toEqual([]);
  });

  // ---- supporting unit tests for the primitives (intersect, aabbForShape, unionFind, bucketKey) ----

  it('aabbForShape — grid centered at (100, 100) for 4×4 → 50px half-extent each way', () => {
    expect(aabbForShape(grid4x4, 100, 100)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });

  it('aabbForShape — pill (sand, count=214) at (100, 100) → 53×27 bbox', () => {
    // sand: max(34, 3*9+26) = 53 wide; h=27
    expect(aabbForShape(pillSand, 100, 100)).toEqual({
      x: 100 - 53 / 2,
      y: 100 - 27 / 2,
      w: 53,
      h: 27,
    });
  });

  it('unionFind — disjoint nodes → each is own component', () => {
    expect(unionFind(3, [])).toEqual([0, 1, 2]);
  });

  it('unionFind — chain 0-1-2 → one component', () => {
    const reps = unionFind(3, [[0, 1], [1, 2]]);
    expect(new Set(reps).size).toBe(1);
  });

  it('bucketKey — quantizes by 14px', () => {
    expect(bucketKey(100, 100, 8, 14)).toBe('bucket-7-7-8');  // round(100/14)=7
  });
});
