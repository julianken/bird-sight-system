# Spider v2 — auto-fan overlapping silhouettes at any zoom

## Context

Epic #251 shipped to bird-maps.com on 2026-04-26 (PR #275 + the polish PR
#278). The shipped spider model (from #247) only fans HIT-TARGETS + leader
lines on click; the visible SDF silhouette icons stay at their original
lat/lngs. Real eBird data routinely has multiple observations from the same
hotspot/feeder/blind at IDENTICAL coordinates, so at zoom > `CLUSTER_MAX_ZOOM`
(=14) those obs visually stack into an unreadable pile.

This was caught during local Playwright drive of `version-one` HEAD before
the release queued. Filed as **#277** with explicit AC. Tracked as Task #23
in the parent epic plan.

This plan redesigns the spider model from "click-to-fan-this-cluster" to
**always-fan-overlapping-icons** via a reconciler that runs on every map
`idle`, detects stacks, and renders visible silhouette markers at fan
positions. The existing click-to-fan path becomes a special case of the same
machinery.

## Issue spec

Read **#277** (`gh issue view 277 --repo julianken/bird-sight-system`) before
each task. The acceptance criteria there are the executable contract.

## Critical files

| Path | Role |
| --- | --- |
| `frontend/src/components/map/fan-layout.ts` | layout helpers (circle/spiral) — re-used by v2's auto-spider |
| `frontend/src/components/map/MapCanvas.tsx` | reconciler effect, state, JSX — the integration surface |
| `frontend/src/components/map/MosaicMarker.tsx` | reference pattern for inline-SVG markers — Spider v2 leaves use the same shape |
| `frontend/src/components/map/observation-layers.ts` | symbol-layer paint expression — needs a filter to suppress in-stack obs |
| `frontend/src/components/map/MapMarkerHitLayer.tsx` | (existing, may not need changes) hit-targets follow Marker positions |
| `frontend/e2e/map-spiderfy.spec.ts` | retire/replace with a test that proves visible-silhouette contract |

Reuse `circleLayout` / `spiralLayout` from `fan-layout.ts:78+` — those are the
same geometry primitives v2 needs. Reuse `MosaicMarker.tsx`'s inline-SVG
pattern (`<svg viewBox="0 0 24 24"><path d=... fill=color/></svg>`) for
each Spider v2 leaf.

## Tasks

Each task is independently implementable. Subagents executing this plan
should follow TDD: write a failing test first, then minimal implementation.
Per-task acceptance criteria are explicit; do not expand scope.

### Task 1 — Pure stack-detection module

**File**: `frontend/src/components/map/stack-fanout.ts` (new)
**Tests**: `frontend/src/components/map/stack-fanout.test.ts` (new)

Pure functions, no React, no maplibre runtime. Inputs are plain types; the
caller does the projection. Easy to unit-test.

```ts
export interface StackInput {
  subId: string;
  comName: string;
  familyCode: string | null;
  silhouetteId: string;
  color: string;
  isNotable: boolean;
  obsDt: string;
  locName: string | null;
  // projected screen position at the current zoom
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
 * Single-pass O(N²) — fine at N≤500 (the production density at AZ scale).
 * Optimize later if profiles say so.
 *
 * @param inputs already-projected observations
 * @param thresholdPx max screen-distance for two obs to be in the same stack
 *                    (default: 30 — empirical sweet spot at zoom 14+)
 * @returns array of stacks; each stack has 2+ members. Singleton observations
 *          are NOT returned (caller renders them via the SDF symbol layer).
 */
export function groupOverlapping(
  inputs: StackInput[],
  thresholdPx?: number,
): Stack[];

/**
 * Compute fanned screen positions for a stack's members.
 * Reuses the geometry primitives from fan-layout.ts (circle for ≤6, spiral for
 * 7-8, capped at SPIDERFY_MAX_LEAVES = 8). For stacks > 8 members, returns
 * positions for the first 8 ONLY; the caller surfaces a "+N more" badge in
 * a secondary marker.
 */
export function fanPositions(
  stack: Stack,
  radiusPx?: number, // default 70
): Array<{ subId: string; screen: { x: number; y: number } }>;
```

**Acceptance criteria**:

- [ ] `groupOverlapping` returns empty array when given 0 inputs.
- [ ] Two inputs > thresholdPx apart → two singleton groups (NOT returned;
      function returns []).
- [ ] Two inputs at identical screen coords → one stack with both members.
- [ ] 5 inputs within thresholdPx of each other → one stack with all 5.
- [ ] `fanPositions` for a 5-member stack: 5 positions evenly spaced on a
      circle, radius 70px from stack center.
- [ ] `fanPositions` for an 8-member stack: 8 positions on a spiral.
- [ ] `fanPositions` for a 12-member stack: 8 positions (capped).
- [ ] All public types exported.
- [ ] 100% test coverage for the public functions.

### Task 2 — Visible silhouette marker component

**File**: `frontend/src/components/map/StackedSilhouetteMarker.tsx` (new)
**Tests**: `frontend/src/components/map/StackedSilhouetteMarker.test.tsx` (new)

Single-purpose component: given a `silhouette` (svgData + color) + a click
handler, render an inline `<svg>` with the family-colored silhouette path,
white halo for contrast. Mirrors `MosaicMarker`'s `<SilhouetteGlyph>` helper
(which renders the same shape inside the FamilyLegend chip), but the wrapper
exposes a click handler and `data-testid="stacked-silhouette-marker"`.

**Acceptance criteria**:

- [ ] Renders `<svg viewBox="0 0 24 24">` containing the silhouette path.
- [ ] When `silhouette.svgData` is null → renders a generic placeholder
      circle (matches MosaicMarker fallback).
- [ ] Path `fill` matches `silhouette.color`.
- [ ] White halo via SVG `<path stroke="white" stroke-width="2" />` rendered
      BEHIND the colored path (paint order matters).
- [ ] `data-testid="stacked-silhouette-marker"` on the root element.
- [ ] `aria-label` includes comName + familyCode + locName + obsDt.
- [ ] `onClick` prop fires on click; defensive `stopPropagation` on the
      synthetic event.
- [ ] Notable observations: amber circle ring rendered behind the silhouette
      (matches the existing notable-ring layer from #246).
- [ ] Unit tests cover all of the above.

### Task 3 — Auto-spider reconciler effect in MapCanvas

**File**: `frontend/src/components/map/MapCanvas.tsx` (modify)
**Tests**: `frontend/src/components/map/MapCanvas.test.tsx` (extend)

Add a new `useEffect` that runs on the map's `idle` event:

1. `map.queryRenderedFeatures(undefined, { layers: ['unclustered-point'] })`
   to get the currently-rendered observations.
2. Project each to screen coords via `map.project(lngLat)`.
3. Pass to `groupOverlapping` from Task 1.
4. For each detected stack: call `fanPositions` to compute the leaf screen
   coords.
5. Convert each leaf screen back to lngLat via `map.unproject({x, y})` so the
   `<Marker>` placement is map-coordinate-anchored.
6. Set a new `[stacks, setStacks]` state with the result.
7. On state change: render `<Marker>` per leaf using `StackedSilhouetteMarker`,
   plus update the existing spiderfy-leader-line source with all the new
   leader lines (one per leaf, origin = stack center, target = leaf lngLat).
8. Cleanup: pan/zoom does NOT close auto-spider (it RE-COMPUTES). Escape
   only matters for the click-driven path; auto-spider has no concept of
   closing.

**Acceptance criteria**:

- [ ] Effect re-runs on `idle` event from the map.
- [ ] When `silhouettes.length === 0` (cache miss): effect short-circuits
      (returns early, no markers rendered).
- [ ] When no stacks are present (every obs is far enough apart): markers
      array is empty; existing SDF symbol layer renders normally.
- [ ] When stacks ARE present:
  - `<Marker>` rendered per leaf at the fanned position
  - leader-line source has one LineString per leaf (origin → leaf)
  - leader-line layer mounted with same paint as #278's bumped style
    (`line-color: #444`, `line-width: 2`)
- [ ] Old click-driven `spiderfy` state is REMOVED (this task subsumes it
      via the `mosaic-click → auto-spider` unification in Task 5).
- [ ] Existing tests for the click-path are updated (or replaced) to cover
      the auto-path; no regressions in spec coverage.
- [ ] `npm run typecheck` clean.

### Task 4 — Suppress SDF symbols for in-stack obs

**File**: `frontend/src/components/map/observation-layers.ts` (modify)
**Tests**: `frontend/src/components/map/observation-layers.test.ts` (extend)

Without this, the SDF symbol layer renders in-stack obs at their ORIGINAL
lat/lngs at the same time as the StackedSilhouetteMarker renders them at fan
positions → double-render.

Approach: add a `stackedSubIds: Set<string>` prop to MapCanvas's GeoJSON
build. Each feature gets a derived `properties.inStack: boolean`. Symbol
layer's filter expression includes `['!=', ['get', 'inStack'], true]`.

The set updates whenever stacks change → GeoJSON rebuilds → symbol layer
re-evaluates filter → in-stack obs disappear from the SDF layer (their
StackedSilhouetteMarker takes over visually).

**Acceptance criteria**:

- [ ] `observationsToGeoJson` accepts a third optional argument:
      `stackedSubIds: ReadonlySet<string>` (default empty Set).
- [ ] Each feature gets `properties.inStack: boolean`.
- [ ] `buildUnclusteredPointLayerSpec` filter includes the new condition:
      `['!', ['has', 'inStack']]` OR `['!=', ['get', 'inStack'], true]`.
      Pick the maplibre-correct form (verify against context7 maplibre-gl
      docs).
- [ ] When `stackedSubIds` is empty: behavior unchanged (existing tests still
      pass).
- [ ] When a subId is in the set: feature's `inStack` = true; symbol layer
      filters it out; `queryRenderedFeatures` returns 0 for that obs.
- [ ] Unit tests cover empty set, single-stack, multi-stack.

### Task 5 — Unify mosaic-click flow with auto-spider

**File**: `frontend/src/components/map/MapCanvas.tsx` (modify)

Currently `handleMosaicClick` (PR #278) branches between easeTo and the
old click-driven `spiderfyCluster`. Spider v2 makes auto-spider always-on
at zoom ≥ CLUSTER_MAX_ZOOM, so the mosaic-click should:

1. At `currentZoom < CLUSTER_MAX_ZOOM`: zoom in (unchanged).
2. At `currentZoom >= CLUSTER_MAX_ZOOM`: NO-OP for the spider purpose —
   the auto-spider reconciler from Task 3 has already fanned the cluster's
   leaves on this idle. Instead the click should… pick one of the leaves?
   Open the popover for the largest family? **Defer this question — for v1
   of v2, just do nothing on mosaic-click at high zoom (the user already
   sees the fanned leaves and can click each individually).**

Remove the `spiderfyCluster` import + state + the spider-related JSX from
MapCanvas if no other consumer remains. Keep `circleLayout`/`spiralLayout`
in fan-layout.ts (Task 1's `fanPositions` re-uses them).

**Acceptance criteria**:

- [ ] `handleMosaicClick` simplified per above.
- [ ] `spiderfy` state in MapCanvas is REMOVED (auto-spider has no equivalent).
- [ ] `spiderfyRef`, `closeSpiderfy`, the keydown-Escape handler, the
      zoomstart-clear all REMOVED.
- [ ] `fan-layout.ts`'s top-level `fanCluster` function may be removed
      (verify nothing else imports it). Keep `circleLayout` / `spiralLayout`
      as exported helpers for `stack-fanout.ts` to import.
- [ ] `npm run test --workspace @bird-watch/frontend` still 319+/N pass.

### Task 6 — E2E spec + remove obsolete spider e2e

**File**: `frontend/e2e/map-stack-fanout.spec.ts` (new)
**File**: `frontend/e2e/map-spiderfy.spec.ts` (delete or rewrite)

E2E proves the **visible-silhouette contract**:

1. Stub `apiStub.stubObservations(...)` with 5 obs at IDENTICAL coords near
   the Tucson cluster center.
2. `goto('view=map')`, zoom to 16 over those obs.
3. Wait for `idle`.
4. Assert: 5 `[data-testid=stacked-silhouette-marker]` elements present in
   the DOM.
5. Assert: each has its family color visible (color-extract from SVG fill).
6. Click one → `ObservationPopover` opens for THAT specific obs (assert
   on the popover heading text).
7. Verify leader-line source has 5 LineString features.

Repeat at 390x844 to confirm responsive.

If the existing `map-spiderfy.spec.ts` is now redundant (covered by the new
auto-flow spec), delete it. If it still asserts something useful (skip-link?),
extract that into a separate spec.

**Acceptance criteria**:

- [ ] New e2e spec lives in `frontend/e2e/`, follows the existing
      Page Object Model + apiStub conventions.
- [ ] WebGL-skip guard at the start (mirroring #247's pattern) — if mosaic
      markers don't materialize within 5s, `test.skip(true, '...')`.
- [ ] Both viewports covered.
- [ ] Click-on-leaf → popover assertion confirms the v2 visible-silhouette
      contract (NOT just hit-target presence — that was v1).
- [ ] `npm run test:e2e --workspace @bird-watch/frontend -- --list` shows the
      new spec parses cleanly.
- [ ] If `map-spiderfy.spec.ts` is removed: it's removed in the same commit
      as the v2 spec is added (don't leave dangling).

## Cross-cutting concerns

- **Performance**: `groupOverlapping` is O(N²). At AZ density (~344 obs)
  the worst case is ~118k pair comparisons per idle. That's a few ms on a
  modern laptop. If profiling later shows hotspot: switch to a spatial grid
  (subdivide screen into 30x30px cells, only compare within neighbor cells).
  v1 of v2: keep it simple, profile if needed.
- **Coexistence with mosaic markers (#248)**: at zoom < CLUSTER_MAX_ZOOM,
  small clusters render as MosaicMarker; auto-spider doesn't fire because
  the obs in the cluster aren't queryRenderedFeatures of `unclustered-point`
  (they're inside the cluster). At zoom ≥ CLUSTER_MAX_ZOOM, no clusters
  exist; all obs are unclustered; auto-spider takes over. Clean precedence.
- **A11y**: `StackedSilhouetteMarker` includes a real `<button>` wrapper
  with full `aria-label` (Task 2 AC). Skip-link from #247 still wins for
  keyboard users; nothing to change there.
- **Mosaic-on-spider hide from PR #278**: still applies for the legacy
  click-driven path that Task 5 removes. After Task 5 the filter is dead
  code; remove it as part of Task 5.
- **TDD per CLAUDE.md**: each task writes failing tests first. No batch
  commits.

## Verification (after all 6 tasks complete)

1. `npm run test --workspace @bird-watch/frontend` — all tests green; new
   tests cover Tasks 1, 2, 3, 4 (Tasks 5/6 are integration + e2e).
2. `npm run build --workspace @bird-watch/frontend` — clean.
3. `npm run typecheck` — clean across all workspaces.
4. Local Playwright drive against the worktree's vite dev:
   - Seed 5+ obs at identical coords (or use the existing tight-cluster
     pattern from the local-test data).
   - Zoom to 16 over the stack.
   - Visually confirm: 5 distinct family-colored silhouettes fanned in a
     circle around the original stack center, with halo, leader lines
     visible at 2px #444. Each clickable.
   - At zoom 12 (clustered): mosaic marker renders; auto-spider does NOT
     fire (cluster, not unclustered).
   - At zoom 13 (unclustered, sparse): individual silhouettes; no auto-fan
     (obs separated > 30px).
   - At zoom 16 (unclustered, co-located): auto-fan; silhouettes visible
     at fan positions.
5. Console: zero errors, zero warnings.
6. Open PR to `main`. Bot review via `julianken-bot`. Mergify queue.

## Out of scope

- Performance optimizations for very high N (>1000). v1 of v2 sticks with
  O(N²) and the 30px threshold; if real production density at the AZ scope
  shows a hotspot, file a follow-up.
- "Tap a stack to see a list overlay" UX. Auto-fan is the primary
  affordance; list-overlay is a separate design exploration.
- Per-family count badges on stacks (like the mosaic count badge). Each
  StackedSilhouetteMarker is one obs; count is implicit.
- A new map-tile basemap. Halo from PR #278 already addresses
  contrast for non-stacked obs. Auto-spider's fanned silhouettes inherit
  the same halo via Task 2's component.

## Plan reference

Closes #277. Part of the post-epic-#251 cleanup. Tracked in the parent epic
plan (`docs/plans/2026-04-25-phylopic-silhouettes-epic-251/plan.md`) as the
Spider v2 task.
