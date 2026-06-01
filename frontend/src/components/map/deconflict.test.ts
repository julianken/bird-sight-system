import { describe, it, expect } from 'vitest';
import {
  intersect,
  aabbForShape,
  unionFind,
  bucketKey,
  buildGroups,
  displaceSilhouettes,
  SILHOUETTE_PX,
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

  // ---- silhouette-vs-anchor AABB suppression predicate (issue #554 scope expansion 2026-05-15) ----
  //
  // These tests exercise the `intersect()` primitive against a fixed-size
  // silhouette box (28×28, derived from MIN_MARKER_PX symmetry — icon-size 0.85
  // applied to a 32×32 source SDF lands roughly there, and 28 matches the
  // smallest grid anchor's AABB so the suppression threshold is symmetric).
  // The MapCanvas reconciler runs this predicate for every visible
  // `unclustered-point` feature × every anchor's AABB to decide which
  // subIds get added to the dynamic filter expression.

  it('silhouette (28×28) at (100,100) intersects 4×4 grid anchor (100×100) at (110,110)', () => {
    const silhouette = { x: 100 - 14, y: 100 - 14, w: 28, h: 28 };  // centered at (100,100)
    const anchorBB = aabbForShape(grid4x4, 110, 110);
    expect(intersect(silhouette, anchorBB, /* margin */ 1)).toBe(true);
  });

  it('silhouette (28×28) at (200,200) does not intersect 4×4 grid anchor at (100,100)', () => {
    const silhouette = { x: 200 - 14, y: 200 - 14, w: 28, h: 28 };
    const anchorBB = aabbForShape(grid4x4, 100, 100);
    expect(intersect(silhouette, anchorBB, /* margin */ 1)).toBe(false);
  });

  // ---- silhouette as first-class deconflict input (Strategy H, 2026-05-15) ----
  //
  // The unclustered-point symbol layer paints silhouettes; per user direction
  // they must REMAIN VISIBLE but should not visually overlap cluster anchors.
  // The deconflict module models silhouettes as a third RenderedShape variant
  // and `displaceSilhouettes` returns a bounded (≤20px) per-subId pixel
  // offset for any silhouette in a group with a cluster anchor.

  /** Test helper: build a silhouette input keyed by subId. */
  function silhouette(
    subId: string,
    px: number,
    py: number,
  ): DeconflictInput {
    return {
      cluster_id: -hashForTest(subId),
      px,
      py,
      rendered: { kind: 'silhouette' },
      point_count: 1,
      uniqueFamilies: 1,
      subId,
    };
  }
  function hashForTest(s: string): number {
    // Stable test-only hash; matches the production djb2-style helper.
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  it('aabbForShape({kind:"silhouette"}) at (100,100) → 28×28 box centered there', () => {
    expect(aabbForShape({ kind: 'silhouette' }, 100, 100)).toEqual({
      x: 86,
      y: 86,
      w: 28,
      h: 28,
    });
    expect(SILHOUETTE_PX).toBe(28);
  });

  it('silhouette-only group (no cluster anchor) → displaceSilhouettes returns empty offset map', () => {
    const s1 = silhouette('OBS1', 100, 100);
    const s2 = silhouette('OBS2', 110, 100);  // overlaps OBS1
    const groups = buildGroups([s1, s2], 8);
    const offsets = displaceSilhouettes(groups, [s1, s2]);
    expect(offsets.size).toBe(0);
  });

  it('silhouette + cluster anchor with 10px overlap → silhouette offset along anchor→silhouette vector', () => {
    // 4×4 grid at (100,100) has AABB [50..150]×[50..150]. Silhouette at (155,100)
    // overlaps slightly (silhouette AABB [141..169]×[86..114]).
    const A = cluster(1, 100, 100, grid4x4, 32);
    const s = silhouette('OBS_E', 155, 100);
    const groups = buildGroups([A, s], 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(1);
    const offsets = displaceSilhouettes(groups, [A, s]);
    expect(offsets.size).toBe(1);
    const off = offsets.get('OBS_E')!;
    // Vector is purely east (vx > 0, vy = 0). Required center distance to
    // clear: anchorHalfW + silHalf = 50 + 14 = 64. Current dist: 55. So
    // displacement = 9 along +x.
    expect(off.dx).toBeCloseTo(9, 5);
    expect(off.dy).toBeCloseTo(0, 5);
  });

  it('silhouette deeply embedded in a 4×4 grid → offset capped at 20px (maxOffsetPx)', () => {
    // Silhouette exactly coincident with the anchor center — would need
    // 64px to clear (anchor 50 + silhouette 14) but cap is 20.
    const A = cluster(1, 100, 100, grid4x4);
    const s = silhouette('OBS_C', 100, 100);
    const groups = buildGroups([A, s], 8);
    const offsets = displaceSilhouettes(groups, [A, s]);
    const off = offsets.get('OBS_C')!;
    // Magnitude is capped at 20.
    expect(Math.hypot(off.dx, off.dy)).toBeCloseTo(20, 5);
  });

  it('anchor prefers cluster over silhouette regardless of cluster_id sign', () => {
    // Cluster has id=999; silhouette has pseudo-id derived from subId hash
    // (always negative). Without the kind-priority rule, the silhouette
    // would win min(cluster_id) and become the anchor — wrong.
    const C = cluster(999, 100, 100, grid4x4);
    const s = silhouette('OBS_X', 110, 100);
    const groups = buildGroups([C, s], 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(999);
    expect(groups[0].anchor.rendered.kind).toBe('grid');
  });

  it('two silhouettes coincident at anchor center radiate to different positions', () => {
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const silA: DeconflictInput = {
      cluster_id: -100,
      px: 100,
      py: 100,
      rendered: { kind: 'silhouette' },
      point_count: 1,
      uniqueFamilies: 1,
      longitude: 0,
      latitude: 0,
      subId: 'OBS-AAA',
    };
    const silB: DeconflictInput = { ...silA, cluster_id: -101, subId: 'OBS-BBB' };
    const groups = buildGroups([A, silA, silB], 8);
    const offsets = displaceSilhouettes(groups, [A, silA, silB]);
    const offA = offsets.get('OBS-AAA');
    const offB = offsets.get('OBS-BBB');
    expect(offA).toBeDefined();
    expect(offB).toBeDefined();
    // Different directions (any of dx, dy differs)
    expect(offA!.dx !== offB!.dx || offA!.dy !== offB!.dy).toBe(true);
  });

  // Tests added per bot review of PR #555 (#554):
  // — partition silhouettes from clusters in the aria-label count

  it('aria-label for cluster anchor + 2 silhouettes uses "nearby observations" wording', () => {
    const anchor = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const silA: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'OBS-AAA',
    };
    const silB: DeconflictInput = { ...silA, cluster_id: -101, px: 110, subId: 'OBS-BBB' };
    const groups = buildGroups([anchor, silA, silB], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+2 nearby observations). Activate to zoom in.',
    );
  });

  it('aria-label for cluster + 1 cluster + 1 silhouette uses mixed wording', () => {
    const anchor = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const otherCluster = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const sil: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'OBS-AAA',
    };
    const groups = buildGroups([anchor, otherCluster, sil], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations (+12 nearby in 1 cluster, +1 nearby observation). Activate to zoom in.',
    );
  });

  it('aria-label singular vs plural for nearby observations', () => {
    // single silhouette → "1 nearby observation"
    const anchor1 = cluster(1, 100, 100, grid4x4, 32, 16);
    const sil1: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'X',
    };
    expect(buildGroups([anchor1, sil1], 8)[0].ariaLabel).toBe(
      'Cluster: 32 observations (+1 nearby observation). Activate to zoom in.',
    );
  });

  it('two silhouettes both overlapping the same anchor → both get offsets in different directions', () => {
    // 4×4 grid at (100,100); two silhouettes flanking east and west.
    const A = cluster(1, 100, 100, grid4x4);
    const sE = silhouette('OBS_E', 155, 100);  // east
    const sW = silhouette('OBS_W', 45, 100);   // west
    const groups = buildGroups([A, sE, sW], 8);
    expect(groups).toHaveLength(1);
    const offsets = displaceSilhouettes(groups, [A, sE, sW]);
    expect(offsets.size).toBe(2);
    const offE = offsets.get('OBS_E')!;
    const offW = offsets.get('OBS_W')!;
    // East silhouette moves further east (+x); west silhouette moves further west (-x).
    expect(offE.dx).toBeGreaterThan(0);
    expect(offW.dx).toBeLessThan(0);
    // Both clamped ≤ 20.
    expect(Math.hypot(offE.dx, offE.dy)).toBeLessThanOrEqual(20);
    expect(Math.hypot(offW.dx, offW.dy)).toBeLessThanOrEqual(20);
  });
});
