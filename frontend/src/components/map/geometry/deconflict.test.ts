import { describe, it, expect } from 'vitest';
import {
  intersect,
  aabbForShape,
  unionFind,
  bucketKey,
  buildGroups,
  displaceSilhouettes,
  resolveDisplacedCollisions,
  pairwiseOverlapRatio,
  hashSubId,
  SILHOUETTE_PX,
  type DeconflictInput,
  type DisplacedSilhouette,
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

  // Test 9b — C1 #1045: singular "observation" when point_count=1
  it('aria-label uses singular "observation" for point_count=1 and singular "family" for uniqueFamilies=1', () => {
    const A = cluster(1, 0, 0, grid1x1 as DeconflictInput['rendered'], /* count */ 1, /* uniqueFamilies */ 1);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 1 observation, 1 family. Activate to zoom in.',
    );
  });

  // Test 9c — C1 #1045: thousands separators for point_count ≥1000
  it('aria-label uses thousands separator for point_count ≥1000', () => {
    const A = cluster(1, 0, 0, grid4x4, /* count */ 16626, /* uniqueFamilies */ 42);
    const groups = buildGroups([A], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 16,626 observations, 42 families. Activate to zoom in.',
    );
  });

  // Test 10 (#1284): merged-cluster aria headline shows the conserved
  // renderedTotal across all clusters, NOT the anchor's point_count.
  // Option-A phrasing: "Cluster: {renderedTotal} observations across {K} clusters."
  it('aria-label for multi-member group shows conserved total "across K clusters" (#1284)', () => {
    // Two clusters overlap: anchor 32 + nearby 12 = 44; K = anchor + 1 nearby = 2.
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const groups = buildGroups([A, B], 8);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 44 observations across 2 clusters. Activate to zoom in.',
    );
    // Headline number === renderedTotal === the count GroupMarkerLayer renders.
    expect(groups[0].ariaLabel).toContain(`${groups[0].renderedTotal} observations`);
  });

  // Test 10b (#1284)
  it('aria-label for 3-member group shows conserved total across 3 clusters (#1284)', () => {
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const C = cluster(3, 120, 100, grid2x2, /* count */ 8, /* uniqueFamilies */ 3);
    const groups = buildGroups([A, B, C], 8);
    // 32 + 12 + 8 = 52 conserved; 3 clusters (anchor + 2 nearby).
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 52 observations across 3 clusters. Activate to zoom in.',
    );
    expect(groups[0].ariaLabel).toContain(`${groups[0].renderedTotal} observations`);
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

  // ---- renderedTotal conservation (issue #1277) ----
  //
  // buildGroups renders ONE marker per overlap component (the anchor). The
  // badge must reflect EVERY cluster the Union-Find absorbed, not just the
  // anchor's point_count — otherwise a single-family filtered view silently
  // drops the non-anchor members' counts (`Σ rendered < stated`).

  // Test 13
  it('renderedTotal sums ALL member point_counts, not just the anchor (#1277)', () => {
    // Two single-family clusters overlap at z8: anchor 32 + nearby 12 = 44.
    // The deconflict layer renders only the anchor marker — its badge must
    // carry the full 44, not the anchor's 32.
    const A = cluster(1, 100, 100, grid4x4, /* count */ 32);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12);
    const groups = buildGroups([A, B], 8);
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(1);
    expect(groups[0].anchor.point_count).toBe(32); // anchor unchanged
    expect(groups[0].renderedTotal).toBe(44); // conserved group total
  });

  // Test 13b
  it('renderedTotal of a solo group equals the anchor point_count (no merge → no change)', () => {
    const A = cluster(1, 0, 0, grid4x4, /* count */ 17);
    const B = cluster(2, 1000, 0, grid4x4, /* count */ 9); // far away, no overlap
    const groups = buildGroups([A, B], 8);
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.renderedTotal).toBe(g.anchor.point_count);
    }
  });

  // Test 13c — the conservation invariant the RCA prescribes for the audit
  it('Σ renderedTotal === Σ input point_count for clustered (non-silhouette) inputs (#1277)', () => {
    // A 3-cluster chain (one merged component) + one isolated cluster.
    const inputs = [
      cluster(1, 100, 100, grid4x4, 32),
      cluster(2, 110, 100, grid2x2, 12),
      cluster(3, 120, 100, grid2x2, 8),
      cluster(4, 1000, 100, grid4x4, 50),
    ];
    const groups = buildGroups(inputs, 8);
    const sumRendered = groups.reduce((s, g) => s + g.renderedTotal, 0);
    const sumInput = inputs.reduce((s, c) => s + c.point_count, 0);
    expect(sumRendered).toBe(sumInput); // 32+12+8+50 = 102, conserved
  });

  // Test 13d — silhouettes are EXCLUDED so the badge doesn't double-count the
  // separately-painted (displaced) silhouette symbol.
  it('renderedTotal excludes silhouette members (they paint their own symbol)', () => {
    const anchor = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const sil: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'OBS-AAA',
    };
    const groups = buildGroups([anchor, sil], 8);
    expect(groups).toHaveLength(1);
    // Only the cluster's 32 counts toward the badge; the silhouette renders
    // its own (displaced) marker, so adding its point_count would double-count.
    expect(groups[0].renderedTotal).toBe(32);
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
      cluster_id: -hashSubId(subId),
      px,
      py,
      rendered: { kind: 'silhouette' },
      point_count: 1,
      uniqueFamilies: 1,
      subId,
    };
  }

  // ---- hashSubId (U4 extraction from MapCanvas.tsx, #888) ----
  //
  // djb2-style string hash → positive int. Callers negate the result to derive
  // a NEGATIVE pseudo-cluster_id (e.g. `-hashSubId(subId)`) so silhouette inputs
  // can ride through `buildGroups` alongside real (positive) supercluster ids
  // without collision. Previously mirrored as a test-only `hashForTest`; this
  // unit moved the helper to `deconflict.ts` so its contract lives next to the
  // negative-pseudo-id consumers, and the duplicate was deleted.
  describe('hashSubId', () => {
    it('is deterministic — same input yields the same hash', () => {
      expect(hashSubId('OBS1')).toBe(hashSubId('OBS1'));
      expect(hashSubId('S12345678')).toBe(hashSubId('S12345678'));
    });

    it('returns a positive integer (caller negates for the pseudo-id)', () => {
      for (const subId of ['OBS1', 'OBS2', 'S12345678', 'L9876543', 'a', '']) {
        const h = hashSubId(subId);
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
        // Negated form is the value actually fed into DeconflictInput.cluster_id.
        expect(-h).toBeLessThanOrEqual(0);
      }
    });

    it('distinguishes distinct subIds (no trivial collision on common eBird ids)', () => {
      expect(hashSubId('OBS1')).not.toBe(hashSubId('OBS2'));
      expect(hashSubId('S12345678')).not.toBe(hashSubId('S12345679'));
    });

    it('matches the djb2 reference (5381 seed, h<<5 + h + c, |0, Math.abs)', () => {
      const ref = (s: string): number => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return Math.abs(h);
      };
      for (const subId of ['OBS1', 'OBS_E', 'OBS_W', 'S12345678', '']) {
        expect(hashSubId(subId)).toBe(ref(subId));
      }
    });
  });

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

  it('aria-label for cluster anchor + 2 silhouettes: no "across N clusters" clause (no nearby clusters), silhouettes itemized (#1284)', () => {
    const anchor = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const silA: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'OBS-AAA',
    };
    const silB: DeconflictInput = { ...silA, cluster_id: -101, px: 110, subId: 'OBS-BBB' };
    const groups = buildGroups([anchor, silA, silB], 8);
    // Only silhouettes nearby → renderedTotal === anchor (32). No "across 1 clusters"
    // (ungrammatical). Silhouettes stay itemized OUTSIDE the total.
    expect(groups[0].renderedTotal).toBe(32);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 32 observations, +2 nearby observations. Activate to zoom in.',
    );
  });

  it('aria-label for cluster + 1 cluster + 1 silhouette: total across 2 clusters, silhouette itemized separately (#1284)', () => {
    const anchor = cluster(1, 100, 100, grid4x4, /* count */ 32, /* uniqueFamilies */ 16);
    const otherCluster = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const sil: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'OBS-AAA',
    };
    const groups = buildGroups([anchor, otherCluster, sil], 8);
    // 32 + 12 = 44 conserved across 2 clusters; the silhouette (+1) stays itemized
    // and is NOT folded into the 44.
    expect(groups[0].renderedTotal).toBe(44);
    expect(groups[0].ariaLabel).toBe(
      'Cluster: 44 observations across 2 clusters, +1 nearby observation. Activate to zoom in.',
    );
  });

  it('aria-label singular vs plural for nearby observations: silhouette-only nearby, no "across" clause (#1284)', () => {
    // single silhouette → "+1 nearby observation"; no nearby clusters → no "across" clause.
    const anchor1 = cluster(1, 100, 100, grid4x4, 32, 16);
    const sil1: DeconflictInput = {
      cluster_id: -100, px: 105, py: 100, rendered: { kind: 'silhouette' },
      point_count: 1, uniqueFamilies: 1, longitude: 0, latitude: 0, subId: 'X',
    };
    expect(buildGroups([anchor1, sil1], 8)[0].ariaLabel).toBe(
      'Cluster: 32 observations, +1 nearby observation. Activate to zoom in.',
    );
  });

  // Test #1284 — badge↔aria parity: the headline's primary number equals
  // renderedTotal, which is exactly the value GroupMarkerLayer renders as the
  // pill `count` / grid `totalCount` badge. This locks the contract so the
  // visible badge and the screen-reader headline can never diverge again.
  it('merged-cluster aria headline number === renderedTotal === the badge value (#1284)', () => {
    const A = cluster(1, 100, 100, grid4x4, /* count */ 24, /* uniqueFamilies */ 12);
    const B = cluster(2, 110, 100, grid2x2, /* count */ 12, /* uniqueFamilies */ 4);
    const C = cluster(3, 120, 100, grid2x2, /* count */ 10, /* uniqueFamilies */ 3);
    const groups = buildGroups([A, B, C], 8);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    // renderedTotal is the value GroupMarkerLayer passes to ClusterPill `count`
    // and AdaptiveGridMarker `totalCount` (see GroupMarkerLayer.tsx).
    expect(g.renderedTotal).toBe(46); // 24 + 12 + 10
    // The aria headline leads with that exact number, not the anchor's 24.
    expect(g.ariaLabel.startsWith(`Cluster: ${g.renderedTotal} observations`)).toBe(true);
    expect(g.ariaLabel).not.toContain('24 observations');
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

/**
 * Displaced-twin collision/spiral pass (E6 / #1058, M-15 "Yuma clump").
 *
 * `displaceSilhouettes` shifts each silhouette only away from ITS OWN group's
 * cluster anchor — it never compares two silhouettes' final positions. At a
 * dense border, twins displaced out of adjacent groups land on top of each
 * other. `resolveDisplacedCollisions` is a pure post-step that nudges those
 * overlapping twins apart so no pair overlaps by more than 25% of the smaller
 * silhouette's bbox area (denominator pinned per #1058 reviewer addendum #2).
 */
describe('resolveDisplacedCollisions', () => {
  // Pinned overlap metric: intersection / min(areaA, areaB). All silhouette
  // bboxes are SILHOUETTE_PX squares, so min-area = SILHOUETTE_PX².
  const SIL = SILHOUETTE_PX;

  function disp(subId: string, px: number, py: number): DisplacedSilhouette {
    return { subId, px, py };
  }

  /** Worst-case pairwise overlap ratio after applying the extra offsets. */
  function worstRatioAfter(
    items: ReadonlyArray<DisplacedSilhouette>,
    extra: Map<string, { dx: number; dy: number }>,
  ): number {
    const resolved = items.map((it) => {
      const e = extra.get(it.subId) ?? { dx: 0, dy: 0 };
      return { subId: it.subId, px: it.px + e.dx, py: it.py + e.dy };
    });
    let worst = 0;
    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const a = resolved[i]!;
        const b = resolved[j]!;
        worst = Math.max(worst, pairwiseOverlapRatio(a.px, a.py, b.px, b.py));
      }
    }
    return worst;
  }

  it('pairwiseOverlapRatio pins the metric: intersection / smaller bbox area', () => {
    // Coincident centers → full overlap → ratio 1.
    expect(pairwiseOverlapRatio(100, 100, 100, 100)).toBeCloseTo(1, 5);
    // Disjoint (≥ SIL apart on an axis) → ratio 0.
    expect(pairwiseOverlapRatio(100, 100, 100 + SIL, 100)).toBeCloseTo(0, 5);
    // Half-overlap on x, full on y → (SIL/2 · SIL) / SIL² = 0.5.
    expect(pairwiseOverlapRatio(100, 100, 100 + SIL / 2, 100)).toBeCloseTo(0.5, 5);
  });

  it('is a no-op for an empty input (silhouette-only group: zero displaced twins)', () => {
    expect(resolveDisplacedCollisions([]).size).toBe(0);
  });

  it('is a no-op for a single displaced twin (≤1 → nothing to deconflict)', () => {
    const out = resolveDisplacedCollisions([disp('OBS1', 100, 100)]);
    expect(out.size).toBe(0);
  });

  it('two displaced twins landing exactly on top of each other → split apart, ≤25% overlap, bounded', () => {
    // The Yuma failure mode: twins from adjacent groups displaced onto the
    // same pixel. coincident → full overlap (ratio 1) before the pass.
    const items = [disp('OBS_A', 200, 200), disp('OBS_B', 200, 200)];
    expect(worstRatioAfter(items, new Map())).toBeCloseTo(1, 5);

    const extra = resolveDisplacedCollisions(items);
    // Worst pairwise overlap now ≤ 25% of the smaller bbox.
    expect(worstRatioAfter(items, extra)).toBeLessThanOrEqual(0.25 + 1e-6);
    // Offsets stay bounded (no runaway spiral).
    for (const off of extra.values()) {
      expect(Math.hypot(off.dx, off.dy)).toBeLessThanOrEqual(SIL * 2);
    }
  });

  it('two adjacent-group twins overlapping ~80% → resolved to ≤25%', () => {
    // Centers 6px apart on x → overlap (SIL-6)·SIL / SIL² = 22/28 ≈ 0.786.
    const items = [disp('OBS_A', 200, 200), disp('OBS_B', 206, 200)];
    expect(worstRatioAfter(items, new Map())).toBeGreaterThan(0.7);
    const extra = resolveDisplacedCollisions(items);
    expect(worstRatioAfter(items, extra)).toBeLessThanOrEqual(0.25 + 1e-6);
  });

  it('already-separated twins (>SIL apart) → no offsets emitted (pass is a no-op)', () => {
    const items = [disp('OBS_A', 100, 100), disp('OBS_B', 100 + SIL + 5, 100)];
    const extra = resolveDisplacedCollisions(items);
    // Nothing to do — either empty map or all-zero offsets.
    for (const off of extra.values()) {
      expect(off.dx).toBeCloseTo(0, 5);
      expect(off.dy).toBeCloseTo(0, 5);
    }
    expect(worstRatioAfter(items, extra)).toBeCloseTo(0, 5);
  });

  it('clump of 13 coincident twins (Yuma scale) → every pair ≤25% overlap, all bounded', () => {
    const items = Array.from({ length: 13 }, (_, i) => disp(`OBS_${i}`, 300, 300));
    expect(worstRatioAfter(items, new Map())).toBeCloseTo(1, 5);
    const extra = resolveDisplacedCollisions(items);
    expect(worstRatioAfter(items, extra)).toBeLessThanOrEqual(0.25 + 1e-6);
    for (const off of extra.values()) {
      expect(Number.isFinite(off.dx)).toBe(true);
      expect(Number.isFinite(off.dy)).toBe(true);
      expect(Math.hypot(off.dx, off.dy)).toBeLessThanOrEqual(SIL * 3);
    }
  });

  it('is deterministic — same input yields identical offsets', () => {
    const items = [
      disp('OBS_A', 200, 200),
      disp('OBS_B', 200, 200),
      disp('OBS_C', 203, 201),
    ];
    const a = resolveDisplacedCollisions(items);
    const b = resolveDisplacedCollisions(items);
    for (const it of items) {
      const oa = a.get(it.subId) ?? { dx: 0, dy: 0 };
      const ob = b.get(it.subId) ?? { dx: 0, dy: 0 };
      expect(oa.dx).toBe(ob.dx);
      expect(oa.dy).toBe(ob.dy);
    }
  });
});
