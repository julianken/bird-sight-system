import {
  buildGroups,
  displaceSilhouettes,
  resolveDisplacedCollisions,
  type DeconflictGroup,
  type DeconflictInput,
  type DisplacedSilhouette,
} from './deconflict.js';

/**
 * Pure middle of the adaptive-grid reconciler (epic #884 · U10, #895).
 *
 * Lifted out of `MapCanvas.tsx`'s reconciler effect. This function owns the
 * deterministic, synchronous transformation that sits BETWEEN the imperative
 * shell's two halves:
 *
 *   shell (assemble `inputs`) → reconcileToGroups(...) → shell (commit)
 *
 * The shell STAYS in `MapCanvas.tsx` and owns every map-touching concern:
 *   - `queryRenderedFeatures` (cluster + unclustered-point queries)
 *   - BOTH `map.project` calls — projection runs WHILE assembling `inputs`,
 *     before this function is reached. "The caller owns projection." The
 *     `inputs` crossing into here already carry projected `px`/`py`
 *     (`DeconflictInput.px`/`py`, "already projected" — deconflict.ts).
 *   - `getClusterLeaves` and its #877 stale-id (`isStaleClusterId`) swallow
 *   - the #902 `isSourceLoaded` empty-commit guard
 *   - the `cacheGeneration`/`leafCache` race-guard
 *   - `setFeatureState`/`removeFeatureState` (driven by the returned
 *     `featureStateDiff`)
 *   - advancing `prevHiddenSubIdsRef.current = nextHidden` after applying the
 *     diff (this function computes the diff against the PASSED-IN
 *     `prevHiddenSubIds` but does NOT own the ref).
 *
 * The ONLY map dependency injected here is `unproject`: turning the displaced
 * pixel offsets coming OUT of `displaceSilhouettes` back into lng/lat. `project`
 * is deliberately NOT injected — every `map.project` call lives in the shell
 * while `inputs` is assembled, so a `project` param would be dead (or worse,
 * lure a caller into dragging the QRF/projection loop across this boundary and
 * re-tangling the irreducible shell).
 *
 * Pure + sync: no React, no MapLibre instance, no async.
 */

/** Minimal structural type for a maplibre `LngLat` (`map.unproject` return). */
export interface LngLatLike {
  lng: number;
  lat: number;
}

/**
 * Injected pixel → lng/lat conversion (maplibre `map.unproject`). Accepts a
 * `[x, y]` pixel pair and returns the geographic coordinate. Structurally typed
 * so the production caller passes `map.unproject` directly and tests pass a
 * stub.
 */
export type Unproject = (point: [number, number]) => LngLatLike;

/** Per-displaced-silhouette render offset, keyed by subId. */
export interface SilhouetteOffset {
  /** Pixel-space x displacement applied at render time. */
  dx: number;
  /** Pixel-space y displacement applied at render time. */
  dy: number;
  /** Unprojected lng of the displaced position (offset round-tripped). */
  longitude: number;
  /** Unprojected lat of the displaced position (offset round-tripped). */
  latitude: number;
}

/**
 * Feature-state diff for the displaced-silhouette `hidden` flag, returned as
 * DATA. The shell applies `toHide` via `setFeatureState({hidden:true})` and
 * `toClear` via `removeFeatureState(...,'hidden')`, then advances the ref.
 */
export interface FeatureStateDiff {
  /** subIds newly displaced this pass (were NOT hidden last pass). */
  toHide: string[];
  /** subIds displaced last pass but no longer displaced (clear `hidden`). */
  toClear: string[];
}

/** Result of the pure reconcile middle. */
export interface ReconcileResult {
  /** Deconflicted anchor groups — fed to `setGroups`. */
  groups: DeconflictGroup[];
  /** Displaced-silhouette offsets (incl. unprojected lng/lat) — `setSilhouetteOffsets`. */
  offsets: Map<string, SilhouetteOffset>;
  /** Feature-state diff vs `prevHiddenSubIds` — applied by the shell. */
  featureStateDiff: FeatureStateDiff;
}

/**
 * Run the pure deconflict middle over an assembled `inputs` list.
 *
 * @param inputs      Deconflict inputs with ALREADY-PROJECTED `px`/`py` (the
 *                    shell projected lng/lat while assembling these).
 * @param floorZoom   `Math.floor(map.getZoom())` — drives the bucket key.
 * @param unproject   Injected `map.unproject`; the sole map dependency.
 * @param prevHiddenSubIds  The hidden set from the PRIOR pass (the shell owns
 *                    the ref; this fn only diffs against the passed-in set).
 */
export function reconcileToGroups(
  inputs: ReadonlyArray<DeconflictInput>,
  floorZoom: number,
  unproject: Unproject,
  prevHiddenSubIds: ReadonlySet<string>,
): ReconcileResult {
  // Deconflict (pure, sync). One group per overlap component.
  const groups = buildGroups(inputs, floorZoom);

  // Compute per-subId pixel offsets for silhouettes that overlap a cluster
  // anchor, then unproject the offset to lng/lat for the render block. The
  // unproject is a tiny per-displaced-silhouette computation — bounded by
  // silhouette count, typically <20.
  const pxOffsets = displaceSilhouettes(groups, inputs);
  const offsets = new Map<string, SilhouetteOffset>();
  // Build a quick subId → input lookup for the projection round-trip.
  const inputBySubId = new Map<string, DeconflictInput>();
  for (const inp of inputs) {
    if (inp.subId) inputBySubId.set(inp.subId, inp);
  }

  // E6 / #1058: collision/spiral cleanup. `displaceSilhouettes` only shifts each
  // twin away from its OWN cluster anchor, never against other displaced twins,
  // so at a dense border (the "Yuma clump") twins from adjacent groups land on
  // top of each other. `resolveDisplacedCollisions` is a pure post-step over the
  // ALREADY-DISPLACED px positions (input px + the offset above) that returns
  // EXTRA per-subId offsets so no displaced pair overlaps by more than 25% of
  // the smaller bbox. It is a no-op for ≤1 displaced twin and for any set whose
  // twins are already separated — so the silhouette-only-group early-exit
  // upstream (pxOffsets has no entry for those) is preserved untouched.
  const displaced: DisplacedSilhouette[] = [];
  for (const [subId, off] of pxOffsets) {
    const inp = inputBySubId.get(subId);
    if (!inp) continue;
    displaced.push({ subId, px: inp.px + off.dx, py: inp.py + off.dy });
  }
  const collisionOffsets = resolveDisplacedCollisions(displaced);

  for (const [subId, off] of pxOffsets) {
    const inp = inputBySubId.get(subId);
    if (!inp || inp.longitude === undefined || inp.latitude === undefined) continue;
    // Total offset = displaceSilhouettes' base + the collision/spiral extra.
    const extra = collisionOffsets.get(subId) ?? { dx: 0, dy: 0 };
    const dx = off.dx + extra.dx;
    const dy = off.dy + extra.dy;
    const displacedPx = inp.px + dx;
    const displacedPy = inp.py + dy;
    const ll = unproject([displacedPx, displacedPy]);
    offsets.set(subId, {
      dx,
      dy,
      longitude: ll.lng,
      latitude: ll.lat,
    });
  }

  // Feature-state diff: hide the canvas-painted twin for every newly-displaced
  // silhouette; clear feature-state for silhouettes that were displaced last
  // pass but aren't now. Returned as DATA — the shell applies it and owns the
  // ref write-back.
  const nextHidden = new Set<string>(offsets.keys());
  const toHide: string[] = [];
  const toClear: string[] = [];
  for (const subId of nextHidden) {
    if (!prevHiddenSubIds.has(subId)) toHide.push(subId);
  }
  for (const subId of prevHiddenSubIds) {
    if (!nextHidden.has(subId)) toClear.push(subId);
  }

  return { groups, offsets, featureStateDiff: { toHide, toClear } };
}
