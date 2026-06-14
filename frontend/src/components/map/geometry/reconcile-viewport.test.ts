import { describe, it, expect, vi } from 'vitest';
import {
  reconcileToGroups,
  type Unproject,
  type LngLatLike,
} from './reconcile-viewport.js';
import { hashSubId, type DeconflictInput } from './deconflict.js';

/**
 * CHARACTERIZATION tests for the reconciler pure middle (epic #884 · U10, #895).
 *
 * These PIN today's behavior of the deconflict→displace→unproject→feature-state
 * pipeline that was lifted out of `MapCanvas.tsx`'s reconciler effect. No map,
 * no React: canned `DeconflictInput`s (already-projected `px`/`py`, exactly as
 * the imperative shell assembles them) + a stub `unproject`.
 *
 * Scope per #895 + the issue-review IMPORTANT finding: this no-map test pins
 *   - groups (anchor selection / member grouping)
 *   - offsets (displaced-silhouette offsets, incl. the negative-pseudo-id
 *     silhouette path via `-hashSubId(subId)`)
 *   - the unproject round-trip (offset → lng/lat through the injected fn)
 *   - the prevHidden diff (`toHide` / `toClear` vs the passed-in set)
 *
 * The #877 stale-id swallow and the #901/#902 `isSourceLoaded` empty-commit
 * guard STAY in the imperative shell (they depend on the live-map
 * `getClusterLeaves` rejection path / `map.isSourceLoaded`) and a no-map pure-fn
 * test cannot reach them. They remain pinned by the existing
 * `MapCanvas.test.tsx` shell suite (#901 + #875/#877), which stays green
 * unchanged after this extraction.
 */

// ── Fixtures ─────────────────────────────────────────────────────────────────

const grid4x4 = { kind: 'grid', shape: { tag: 'grid', cols: 4, rows: 4 } } as const;

/** A positive-cluster_id grid cluster input (the shell already projected px/py). */
function clusterInput(
  id: number,
  px: number,
  py: number,
  longitude = -111.9,
  latitude = 33.45,
): DeconflictInput {
  return {
    cluster_id: id,
    px,
    py,
    rendered: grid4x4,
    point_count: 32,
    uniqueFamilies: 16,
    longitude,
    latitude,
  };
}

/**
 * A silhouette input EXACTLY as the shell assembles it (~MapCanvas.tsx:1619):
 * negative pseudo-cluster_id `-hashSubId(subId)`, `rendered.kind = 'silhouette'`,
 * carries the subId. px/py are already-projected.
 */
function silhouetteInput(
  subId: string,
  px: number,
  py: number,
  longitude = -111.9,
  latitude = 33.45,
): DeconflictInput {
  return {
    cluster_id: -hashSubId(subId),
    px,
    py,
    rendered: { kind: 'silhouette' },
    point_count: 1,
    uniqueFamilies: 1,
    longitude,
    latitude,
    subId,
  };
}

/**
 * Deterministic stub unproject: maps a pixel point back to a synthetic lng/lat
 * so the round-trip is assertable. lng/lat are simple linear functions of x/y.
 */
const stubUnproject: Unproject = ([x, y]): LngLatLike => ({
  lng: -110 + x / 1000,
  lat: 40 - y / 1000,
});

// ── Characterization ─────────────────────────────────────────────────────────

describe('reconcileToGroups (characterization — pinned pre-extraction behavior)', () => {
  it('emits one group per overlap component; anchor is min(cluster_id)', () => {
    // Two grid clusters overlapping at the same pixel neighborhood.
    const a = clusterInput(5, 100, 100);
    const b = clusterInput(12, 110, 100);
    const { groups } = reconcileToGroups([a, b], 8, stubUnproject, new Set());
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(5);
    expect(groups[0].memberIds).toEqual([5, 12]);
  });

  it('disjoint clusters → separate groups, no offsets, empty diff', () => {
    const a = clusterInput(1, 0, 0);
    const b = clusterInput(2, 1000, 1000);
    const unproject = vi.fn(stubUnproject);
    const { groups, offsets, featureStateDiff } = reconcileToGroups(
      [a, b],
      8,
      unproject,
      new Set(),
    );
    expect(groups).toHaveLength(2);
    expect(offsets.size).toBe(0);
    // No silhouettes displaced → unproject never called.
    expect(unproject).not.toHaveBeenCalled();
    expect(featureStateDiff).toEqual({ toHide: [], toClear: [] });
  });

  it('negative-pseudo-id silhouette overlapping a cluster anchor → displaced + unprojected', () => {
    // Cluster anchor at (100,100); silhouette 5px east — well inside the
    // anchor's inflated AABB → displaceSilhouettes returns a non-zero offset.
    const anchor = clusterInput(7, 100, 100);
    const sil = silhouetteInput('OBS-aaa', 105, 100);
    // Anchor wins (silhouette is NEVER an anchor) regardless of the negative id.
    const unproject = vi.fn(stubUnproject);
    const { groups, offsets, featureStateDiff } = reconcileToGroups(
      [anchor, sil],
      8,
      unproject,
      new Set(),
    );

    // Single overlap component; the cluster (not the negative-id silhouette) is anchor.
    expect(groups).toHaveLength(1);
    expect(groups[0].anchor.cluster_id).toBe(7);
    expect(groups[0].memberIds).toContain(-hashSubId('OBS-aaa'));

    // The silhouette was displaced.
    expect(offsets.has('OBS-aaa')).toBe(true);
    const off = offsets.get('OBS-aaa')!;
    expect(off.dx !== 0 || off.dy !== 0).toBe(true);

    // unproject was called with the DISPLACED pixel (anchor px/py + dx/dy),
    // and the returned lng/lat were stored on the offset (the round-trip).
    const displacedPx = sil.px + off.dx;
    const displacedPy = sil.py + off.dy;
    expect(unproject).toHaveBeenCalledWith([displacedPx, displacedPy]);
    expect(off.longitude).toBeCloseTo(stubUnproject([displacedPx, displacedPy]).lng, 10);
    expect(off.latitude).toBeCloseTo(stubUnproject([displacedPx, displacedPy]).lat, 10);

    // Newly displaced (prevHidden empty) → toHide carries this subId.
    expect(featureStateDiff.toHide).toEqual(['OBS-aaa']);
    expect(featureStateDiff.toClear).toEqual([]);
  });

  it('prevHidden diff: already-hidden displaced subId is NOT re-hidden', () => {
    const anchor = clusterInput(7, 100, 100);
    const sil = silhouetteInput('OBS-aaa', 105, 100);
    const { offsets, featureStateDiff } = reconcileToGroups(
      [anchor, sil],
      8,
      stubUnproject,
      new Set(['OBS-aaa']), // already hidden last pass
    );
    expect(offsets.has('OBS-aaa')).toBe(true);
    expect(featureStateDiff.toHide).toEqual([]); // not newly hidden
    expect(featureStateDiff.toClear).toEqual([]); // still displaced → not cleared
  });

  it('prevHidden diff: a subId hidden last pass but not displaced now → toClear', () => {
    // This pass has NO displacement (silhouette far from any anchor), but a
    // subId was hidden last pass → it must be cleared.
    const lonelySil = silhouetteInput('OBS-zzz', 2000, 2000);
    const { offsets, featureStateDiff } = reconcileToGroups(
      [lonelySil],
      8,
      stubUnproject,
      new Set(['OBS-was-hidden']),
    );
    expect(offsets.size).toBe(0);
    expect(featureStateDiff.toHide).toEqual([]);
    expect(featureStateDiff.toClear).toEqual(['OBS-was-hidden']);
  });

  it('silhouette-only group (no cluster anchor) is left untouched — no displacement', () => {
    // Two silhouettes overlapping each other; neither is a cluster, so
    // displaceSilhouettes leaves them alone (silhouette-only group).
    const s1 = silhouetteInput('OBS-1', 100, 100);
    const s2 = silhouetteInput('OBS-2', 104, 100);
    const unproject = vi.fn(stubUnproject);
    const { groups, offsets, featureStateDiff } = reconcileToGroups(
      [s1, s2],
      8,
      unproject,
      new Set(),
    );
    expect(groups).toHaveLength(1); // they overlap → one component
    expect(offsets.size).toBe(0); // silhouette-only group → no displacement
    expect(unproject).not.toHaveBeenCalled();
    expect(featureStateDiff).toEqual({ toHide: [], toClear: [] });
  });

  it('empty inputs → empty groups, empty offsets, empty diff', () => {
    const { groups, offsets, featureStateDiff } = reconcileToGroups(
      [],
      8,
      stubUnproject,
      new Set(),
    );
    expect(groups).toEqual([]);
    expect(offsets.size).toBe(0);
    expect(featureStateDiff).toEqual({ toHide: [], toClear: [] });
  });

  it('idempotent: same inputs twice yield identical groups/offsets', () => {
    const inputs = [clusterInput(7, 100, 100), silhouetteInput('OBS-aaa', 105, 100)];
    const r1 = reconcileToGroups(inputs, 8, stubUnproject, new Set());
    const r2 = reconcileToGroups(inputs, 8, stubUnproject, new Set());
    expect(JSON.stringify(r1.groups)).toEqual(JSON.stringify(r2.groups));
    expect(JSON.stringify([...r1.offsets])).toEqual(JSON.stringify([...r2.offsets]));
  });
});
