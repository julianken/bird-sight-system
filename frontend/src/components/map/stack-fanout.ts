/**
 * Stack detection + fan-out — pure helpers behind Spider v2 (issue #277).
 *
 * Why split from `spiderfy.ts`:
 *   - The legacy spiderfy module wires layout + maplibre runtime + GeoJSON
 *     leader-line builders together. v2 needs only the layout primitives
 *     plus a new "detect co-located screen positions" pass.
 *   - These functions take plain JS values (already-projected screen coords)
 *     and return plain JS values, so they're trivially unit-testable in
 *     jsdom without any maplibre or React dependency.
 *
 * Public contract:
 *   - `groupOverlapping(inputs, thresholdPx?)` — single-pass O(N²)
 *     union-style grouping. Returns only stacks of 2+ members; singletons
 *     are dropped (caller renders them via the SDF symbol layer).
 *   - `fanPositions(stack, radiusPx?)` — wraps `computeSpiderfyLayout` from
 *     `spiderfy.ts` to translate per-leaf offsets into absolute screen
 *     positions anchored at the stack center. Caps at SPIDERFY_MAX_LEAVES;
 *     the caller surfaces a "+N more" badge for overflow (Task 3 concern).
 */

import {
  computeSpiderfyLayout,
  SPIDERFY_MAX_LEAVES,
  SPIDERFY_RADIUS_PX,
} from './spiderfy.js';

/* Default threshold below which two screen positions belong to the same
   stack. 30px is the empirical sweet spot at zoom 14+ — silhouettes are
   ~24px wide, so anything within 30px is visually overlapping. */
const DEFAULT_THRESHOLD_PX = 30;

export interface StackInput {
  subId: string;
  comName: string;
  familyCode: string | null;
  silhouetteId: string;
  color: string;
  isNotable: boolean;
  obsDt: string;
  locName: string | null;
  /** Projected screen position at the current zoom. */
  screen: { x: number; y: number };
  lngLat: [number, number];
}

export interface Stack {
  /** Center of the stack in screen coords (mean of all members). */
  center: { x: number; y: number };
  /** Center in lng/lat (mean — used as anchor for the leader-line layer). */
  centerLngLat: [number, number];
  /** Member observations. */
  members: StackInput[];
}

/**
 * Group co-located observations within `thresholdPx` of each other.
 *
 * Algorithm: a single-pass union-find-like merge. For each input, find an
 * existing stack whose center is within `thresholdPx`; if found, append and
 * recompute the center. Otherwise start a new candidate stack with this
 * input as the sole member. After the pass, drop any candidate with < 2
 * members (singletons are not the caller's concern).
 *
 * Complexity is O(N²) worst case (every input falls into the same stack
 * comparison). At AZ scale (~344 obs) that's ~118k pair compares per idle —
 * a few ms on a modern laptop. Switch to a spatial grid only if a profile
 * names this as a hotspot (see plan's "Cross-cutting concerns").
 *
 * @param inputs already-projected observations
 * @param thresholdPx max screen-distance for two obs to be in the same stack
 *                    (default: 30 — empirical sweet spot at zoom 14+)
 * @returns array of stacks; each stack has 2+ members. Singletons are
 *          dropped — the caller draws them via the SDF symbol layer.
 */
export function groupOverlapping(
  inputs: StackInput[],
  thresholdPx: number = DEFAULT_THRESHOLD_PX,
): Stack[] {
  if (inputs.length === 0) return [];

  // Working candidate stacks. Each entry tracks its running center so we
  // can compare against the next input without a full re-sweep.
  type Candidate = {
    members: StackInput[];
    sumX: number;
    sumY: number;
    sumLng: number;
    sumLat: number;
  };
  const candidates: Candidate[] = [];

  for (const input of inputs) {
    let merged = false;
    for (const c of candidates) {
      const cx = c.sumX / c.members.length;
      const cy = c.sumY / c.members.length;
      const dx = input.screen.x - cx;
      const dy = input.screen.y - cy;
      if (Math.hypot(dx, dy) <= thresholdPx) {
        c.members.push(input);
        c.sumX += input.screen.x;
        c.sumY += input.screen.y;
        c.sumLng += input.lngLat[0];
        c.sumLat += input.lngLat[1];
        merged = true;
        break;
      }
    }
    if (!merged) {
      candidates.push({
        members: [input],
        sumX: input.screen.x,
        sumY: input.screen.y,
        sumLng: input.lngLat[0],
        sumLat: input.lngLat[1],
      });
    }
  }

  // Drop singletons; project final candidates into Stack shape.
  const stacks: Stack[] = [];
  for (const c of candidates) {
    if (c.members.length < 2) continue;
    const n = c.members.length;
    stacks.push({
      center: { x: c.sumX / n, y: c.sumY / n },
      centerLngLat: [c.sumLng / n, c.sumLat / n],
      members: c.members.slice(),
    });
  }
  return stacks;
}

/**
 * Compute fanned screen positions for a stack's members.
 *
 * Reuses `computeSpiderfyLayout` from `spiderfy.ts` (circle for ≤6, spiral
 * for 7-8, capped at SPIDERFY_MAX_LEAVES = 8). For stacks with > 8 members
 * the first 8 are positioned and the rest are dropped here — the caller is
 * expected to surface a "+N more" badge for the overflow (Task 3).
 *
 * ## `radiusPx` scaling contract
 *
 * A scale factor `s = radiusPx / SPIDERFY_RADIUS_PX` is applied uniformly to
 * every leaf offset produced by `computeSpiderfyLayout`.
 *
 * - **Circle stacks (≤6 members):** all leaves sit exactly at radius
 *   `SPIDERFY_RADIUS_PX` in the default layout, so scaling by `s` gives each
 *   leaf a radius of exactly `radiusPx`. The geometry scales linearly and
 *   cleanly.
 *
 * - **Spiral stacks (7-8 members):** `computeSpiderfyLayout` uses hardcoded
 *   baseline and growth constants tuned to the default 70px
 *   (`SPIRAL_BASE_RADIUS = SPIDERFY_RADIUS_PX * 0.65`, `SPIRAL_GROWTH = 8`).
 *   The same scale factor `s` is applied to every dx/dy offset, so all radii
 *   are multiplied by `s` — the spiral is proportionally shrunk or grown.
 *   The spiral remains strictly monotone and visually well-separated at
 *   reasonable values (e.g. 35–140px). At very small or very large `radiusPx`
 *   values the per-leaf growth increments are also scaled, which changes the
 *   visual "tightness" of the coil; the spiral shape is preserved but not
 *   re-tuned to the new radius.
 *
 * @param stack the stack whose members need fanned-out positions
 * @param radiusPx fan radius (default 70 — matches SPIDERFY_RADIUS_PX, the
 *                 legacy spider's ring radius, so visuals remain consistent
 *                 with the leader-line layer's tuning)
 * @returns one entry per fanned leaf, with the leaf's subId and absolute
 *          screen position. Empty array when the stack has no members.
 */
export function fanPositions(
  stack: Stack,
  radiusPx: number = SPIDERFY_RADIUS_PX,
): Array<{ subId: string; screen: { x: number; y: number } }> {
  const count = Math.min(stack.members.length, SPIDERFY_MAX_LEAVES);
  if (count === 0) return [];

  const offsets = computeSpiderfyLayout(count);
  const scale = radiusPx / SPIDERFY_RADIUS_PX;
  const positions: Array<{ subId: string; screen: { x: number; y: number } }> = [];
  for (let i = 0; i < count; i += 1) {
    const offset = offsets[i];
    const member = stack.members[i];
    if (!offset || !member) continue; // defensive — count guards both
    positions.push({
      subId: member.subId,
      screen: {
        x: stack.center.x + offset.dx * scale,
        y: stack.center.y + offset.dy * scale,
      },
    });
  }
  return positions;
}
