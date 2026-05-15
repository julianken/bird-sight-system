# AdaptiveGridMarker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace today's `<MosaicMarker>` + `<ClusterPill>` + auto-spider with one component `<AdaptiveGridMarker>` whose shape scales 1×1 → 4×4 by unique-family count, with per-cell observation-count badges. Raise `clusterMaxZoom` 14 → 22 so the same component renders at every zoom and coincident-point disambiguation comes from the grid never decomposing.

**Architecture:** Three phases mapped to three PRs against `main` from feature branch `feat/adaptive-cluster-grid`. Phase 0 (prototype) is a throwaway validation pass that must clear four gates before Phase 1 begins. Phase 1 lands new files behind a feature flag (`VITE_FF_ADAPTIVE_GRID`, default off). Phase 2 atomically flips the flag, wires `MapCanvas`, and deletes the auto-spider + legacy mosaic subsystems in one PR (splitting it leaves a knip-broken intermediate state — see spec §11). Phase 3 updates documentation linkbacks.

**Tech Stack:** React 18, TypeScript, Vite 8, MapLibre GL 5 (via `react-map-gl`), Vitest 4, `@playwright/test`. No new npm dependencies.

**Spec:** `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` — read end-to-end before starting. Section references throughout this plan (§4.1, §5.1, etc.) point at the spec.

---

## Quantified plan literals (implementer checklist)

Before opening a PR for any phase, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

### Phase 0 — prototype gates

- [ ] Prototype renders ≥ 344 canned observation rows from JSON matching production API shape
- [ ] Prototype tested at 5 canonical viewports: 390×844, 768×1024, 1024×768, 1440×900, 1920×1080
- [ ] Prototype tested at 2 themes (light + dark via `data-theme` attribute toggle)
- [ ] Gate 1: p99 `mosaic-reconcile` < 16ms at 390×844 during scripted z=8 → z=15 pinch-zoom
- [ ] Gate 2: ≤ 2,500 visible markers at every canonical viewport during overview load
- [ ] Gate 3: every visible marker's hit overlay measures ≥ 44×44 (desktop) / ≥ 48×48 (coarse pointer)
- [ ] Gate 4: zero console errors AND zero console warnings during every interaction at every viewport
- [ ] 5-line learnings note written to `docs/plans/2026-05-14-adaptive-cluster-grid/prototype-learnings.md`

### Phase 1 — scaffolding behind feature flag

- [ ] 1 new component file: `frontend/src/components/map/AdaptiveGridMarker.tsx`
- [ ] 1 new logic module: `frontend/src/components/map/adaptive-grid.ts`
- [ ] 5 marker shapes supported: 1×1, 2×1, 2×2, 3×3, 4×4 (per spec §4.1 rules table)
- [ ] 1 mobile shape variant: `grid-overflow` with `hiddenCount: PositiveInt`
- [ ] `PositiveInt` branded type with `toPositiveInt(n)` constructor that throws on n < 1, n is non-integer
- [ ] 3-variant `AdaptiveTile` discriminated union: `rendered` | `fallback` | `pending`
- [ ] All className references in `AdaptiveGridMarker.tsx` have CSS rules in `styles.css` or `ds-primitives.css`
- [ ] Feature flag `VITE_FF_ADAPTIVE_GRID` declared in `frontend/.env.example` (default off in `.env`)
- [ ] 20 unit tests pass (`adaptive-grid.test.ts` — pickGridShape rules, boundaries, mobile cap, tile builder edges, memoization concerns)
- [ ] 12 component tests pass (`AdaptiveGridMarker.test.tsx` — render, badge visibility, aria-label patterns, hit-extender, dark-mode contrast, notable indicator, empty-catalogue)
- [ ] CI green on PR1 — no swap yet, all legacy code paths intact

### Phase 2 — atomic cutover

- [ ] 14 files deleted: `MosaicMarker.tsx`, `MosaicMarker.test.tsx`, `cluster-mosaic.ts`, `cluster-mosaic.test.ts`, `StackedSilhouetteMarker.tsx`, `StackedSilhouetteMarker.test.tsx`, `use-auto-spider.ts`, `use-auto-spider.test.ts`, `stack-fanout.ts`, `stack-fanout.test.ts`, `fan-layout.ts`, `fan-layout.test.ts`, `map-stack-fanout.spec.ts`, `map-cluster-mosaic.spec.ts`
- [ ] 3 files modified: `MapCanvas.tsx`, `observation-layers.ts`, `axe.spec.ts`
- [ ] `clusterMaxZoom` raised from 14 → 22 in `observation-layers.ts:152`
- [ ] `CLUSTER_MOSAIC_MAX_POINTS` constant removed from `observation-layers.ts:163`
- [ ] `inStack` property removed from GeoJSON feature shape (`observation-layers.ts:42-61`)
- [ ] All 4 filter clauses on `inStack` removed (`observation-layers.ts:121-126, 278, 336`)
- [ ] Feature flag default flipped to `on` in this PR; flag itself can be removed in a follow-up
- [ ] Memoization layers from spec §5.3 implemented in `MapCanvas.tsx`: `useMemo` (Concern A), module-scoped async cache (Concern B), `cacheGeneration` + monotonic `silhouettesVersion` (Concern C)
- [ ] New e2e: `map-adaptive-grid.spec.ts` — 8 scenarios per spec §7
- [ ] `axe.spec.ts:55` aria-label assertion extended to grid + describedby
- [ ] Design-review subagent dispatched at 5 viewports × 2 themes = 10 screenshots, all PASS
- [ ] `julianken-bot` review pass before queueing
- [ ] CI green on PR2: `test`, `lint`, `build`, `e2e`, `knip`, `orphan-classname-check` all pass

### Phase 3 — documentation

- [ ] `docs/specs/2026-04-16-bird-watch-design.md §Frontend` updated to reference adaptive-grid design
- [ ] Epic GitHub issue closed; 3 child issues closed
- [ ] `frontend/.env.example` flag entry annotated with removal-date comment

---

## Spec reference

Canonical: `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`. Sections referenced in this plan:

- §3 Decision (Approach A — Grid Everywhere)
- §4.1 Adaptive grid shape (types + sizing rules)
- §4.3 Per-cell badge (visual + contrast contract)
- §4.4 Hit-extender overlay
- §4.5 Tap behavior — parent routes the click
- §4.6 Two-tier ARIA disclosure
- §5.1 `AdaptiveGridMarker.tsx` component API
- §5.2 `adaptive-grid.ts` module API
- §5.3 Memoization (Concerns A, B, C)
- §6 File map
- §7 Test strategy
- §10 Prototype-phase gates
- §11 Sequencing

---

## File structure

| File | Phase | Role |
|---|---|---|
| `prototype/adaptive-grid/index.html`, `main.tsx`, `canned-obs.json` | 0 | Throwaway prototype; deleted after gates pass |
| `docs/plans/2026-05-14-adaptive-cluster-grid/prototype-learnings.md` | 0 | 5-line note; committed to repo |
| `frontend/src/components/map/adaptive-grid.ts` | 1 | `pickGridShape`, `buildAdaptiveTiles`, `aggregateClusterFamilies` (moved), `toPositiveInt`, types |
| `frontend/src/components/map/adaptive-grid.test.ts` | 1 | Unit tests for the module |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | 1 | Pure display component |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | 1 | Component tests |
| `frontend/src/styles.css` OR `frontend/src/components/ds/ds-primitives.css` | 1 | CSS rules for every className in `AdaptiveGridMarker.tsx` |
| `frontend/.env.example`, `frontend/.env` | 1 | `VITE_FF_ADAPTIVE_GRID=false` initially |
| `frontend/src/components/map/MapCanvas.tsx` | 2 | Wire AdaptiveGridMarker; raise clusterMaxZoom; add 3-layer memo; delete auto-spider block |
| `frontend/src/components/map/observation-layers.ts` | 2 | Drop CMP=8; bump CLUSTER_MAX_ZOOM; remove inStack plumbing |
| `frontend/e2e/map-adaptive-grid.spec.ts` | 2 | New e2e suite (replaces map-cluster-mosaic.spec.ts and map-stack-fanout.spec.ts) |
| `frontend/e2e/axe.spec.ts` | 2 | Extend aria-label assertion |
| `.github/workflows/perf-gate.yml` | 2 | Dedicated workflow for the `CI_PERF_GATE`-gated wall-clock assertion (per spec §7 E2E) |
| `docs/specs/2026-04-16-bird-watch-design.md` | 3 | §Frontend cross-reference to adaptive-grid spec |

Files **deleted in Phase 2** (14 total) are enumerated in the Phase 2 manifest above.

---

## Branch + workflow

**Branch:** `feat/adaptive-cluster-grid`, cut from current `main` immediately before Phase 0 begins. All PRs land back to `main`. No long-lived sub-branches per phase — each phase commits to the feature branch, and the PR is opened against `main` with `git push origin feat/adaptive-cluster-grid` from a phase-specific tip.

**Each PR:**

1. Cherry-pick or commit the phase's work onto a phase-specific branch off `main` (e.g., `feat/adaptive-cluster-grid-phase-1`), OR open three PRs from the same branch sequentially after each phase's commit set.
2. PR body uses `.github/PULL_REQUEST_TEMPLATE.md` verbatim (5 sections). Screenshots REQUIRED on `frontend/**` changes via `pr-screenshots-via-user-attachments` skill (paste-flow, never commit PNGs).
3. Bot review via `julianken-bot` subagent (per `reviewing-as-julianken-bot` skill) — never `gh pr review` from the main session.
4. After bot approval, post `@Mergifyio queue` literal-string comment. Never `gh pr merge`.
5. CI gate before queue: `test`, `lint`, `build`, `e2e`, `knip` informational. Plus `orphan-classname-check` from Phase 1 onward.

**Recommended sub-skill for execution:** `superpowers:subagent-driven-development`. Each phase becomes one or more subagent dispatches. The implementer reviews between tasks.

---

## Epic + issue structure

Open these via `gh issue create --repo julianken/bird-sight-system` immediately after the plan is approved.

### Epic — AdaptiveGridMarker redesign

Title: `epic: adaptive cluster grid — retire mosaic + auto-spider, one marker for all zooms`

Labels: `epic`, `frontend`, `tracker`

Body skeleton:

```markdown
Track the implementation of the AdaptiveGridMarker redesign per spec
`docs/specs/2026-05-14-adaptive-cluster-grid-design.md` and plan
`docs/plans/2026-05-14-adaptive-cluster-grid.md`.

Child issues (in order):

- [ ] #N+1 — Phase 0 · Prototype validation (4 gates)
- [ ] #N+2 — Phase 1 · Scaffold AdaptiveGridMarker behind feature flag
- [ ] #N+3 — Phase 2 · Atomic cutover (swap + delete legacy)
- [ ] #N+4 — Phase 3 · Documentation linkbacks

Gates and conventions:
- Prototype gates documented in spec §10 — Phase 1 cannot start until all 4 pass
- 5-viewport × 2-theme design review required at end of Phase 2
- Phase 2 must be a single PR (knip mid-state otherwise — see spec §11)

Closes when all child issues are closed AND the design-review subagent
PASSes at every canonical viewport.
```

### Phase 0 issue

Title: `phase 0: prototype the adaptive cluster grid and clear 4 gates`. Body: copy Phase 0 task list from this plan.

### Phase 1 issue

Title: `phase 1: scaffold AdaptiveGridMarker + adaptive-grid.ts behind feature flag`. Body: copy Phase 1 task list.

### Phase 2 issue

Title: `phase 2: atomic cutover — wire AdaptiveGridMarker, delete auto-spider + legacy mosaic`. Body: copy Phase 2 task list.

### Phase 3 issue

Title: `phase 3: documentation linkbacks for adaptive cluster grid`. Body: copy Phase 3 task list.

---

# Phase 0 · Prototype validation

**Gate rule (from CLAUDE.md):** No Phase 1 task may begin until all four prototype gates pass on a working prototype. Scope: 2–4 hours.

### Task 0.1: Scaffold throwaway prototype directory

**Files:**
- Create: `prototype/adaptive-grid/index.html`
- Create: `prototype/adaptive-grid/main.tsx`
- Create: `prototype/adaptive-grid/canned-obs.json` (≥ 344 rows)
- Create: `prototype/adaptive-grid/package.json` (Vite local)

- [ ] **Step 1: Generate canned data**

Fetch ≥ 344 representative observations from the live API for the AZ dataset:

```bash
mkdir -p prototype/adaptive-grid
curl -s 'https://api.bird-maps.com/api/observations' | jq '.data[0:500]' \
  > prototype/adaptive-grid/canned-obs.json
wc -l prototype/adaptive-grid/canned-obs.json
```

Expected: file exists with at least 344 observation objects matching the `Observation` shape from `packages/shared-types/src/index.ts:10-37`.

- [ ] **Step 2: Build a minimal Vite app that mounts MapCanvas-equivalent**

Copy the relevant subset of `frontend/src/components/map/` into `prototype/adaptive-grid/src/` and stub the API call with a static import of `canned-obs.json`. Implement a quick-and-dirty `AdaptiveGridMarker` (no need for tests yet — this is throwaway code).

- [ ] **Step 3: Run prototype locally**

```bash
cd prototype/adaptive-grid && npm install && npm run dev
```

Expected: dev server at http://localhost:5173 renders the map with grid markers.

- [ ] **Step 4: Commit prototype scaffolding**

```bash
git add prototype/adaptive-grid/
git commit -m "plan(adaptive-grid): scaffold prototype validation"
```

### Task 0.2: Run the 4 prototype gates

**Files:**
- Modify: `prototype/adaptive-grid/main.tsx` (add `performance.mark` instrumentation)

- [ ] **Step 1: Add reconcile-time instrumentation**

Wrap the equivalent of `MapCanvas.tsx:716`'s `setMosaics` call:

```ts
performance.mark('mosaic-reconcile-start');
// ... reconciler runs ...
performance.mark('mosaic-reconcile-end');
performance.measure('mosaic-reconcile', 'mosaic-reconcile-start', 'mosaic-reconcile-end');
```

- [ ] **Step 2: Drive Playwright MCP through the 4 gates at 5 viewports × 2 themes**

For each viewport (390×844, 768×1024, 1024×768, 1440×900, 1920×1080) AND each theme (light, dark via `document.documentElement.setAttribute('data-theme', 'dark')`):

1. `mcp__plugin_playwright_playwright__browser_navigate` to http://localhost:5173
2. `mcp__plugin_playwright_playwright__browser_resize` to the viewport
3. Pinch-zoom z=8 → z=15 via `browser_evaluate` driving `map.setZoom()`
4. Read `performance.getEntriesByName('mosaic-reconcile').map(e => e.duration)` — compute p99
5. Count visible markers: `document.querySelectorAll('[data-testid=adaptive-grid-marker], [data-testid=cluster-pill]').length`
6. Sample 5 markers' `getBoundingClientRect()` — assert `width ≥ 44 && height ≥ 44` (or 48 on coarse-pointer emulation)
7. `mcp__plugin_playwright_playwright__browser_console_messages` — assert empty array

Record results in a table.

- [ ] **Step 3: Write the 5-line learnings note**

Create `docs/plans/2026-05-14-adaptive-cluster-grid/prototype-learnings.md` with exactly 5 lines summarizing what worked, what surprised you, what changed about the proposed design (if anything), and the measured numbers per gate.

- [ ] **Step 4: Commit the learnings note**

```bash
git add docs/plans/2026-05-14-adaptive-cluster-grid/prototype-learnings.md
git commit -m "plan(adaptive-grid): prototype learnings — 4/4 gates PASS"
```

- [ ] **Step 5: GATE — all four pass?**

If ANY gate fails, stop. Open a discussion issue, revisit spec §10, do not proceed to Phase 1. The prototype is the cheap escape hatch.

### Task 0.3: Tear down prototype + scaffold the real feature branch

- [ ] **Step 1: Remove prototype directory** (we keep the learnings note in `docs/plans/`):

```bash
git rm -r prototype/adaptive-grid
git commit -m "plan(adaptive-grid): tear down prototype (gates passed)"
```

- [ ] **Step 2: Cut feature branch from main**

```bash
git switch main && git pull
git switch -c feat/adaptive-cluster-grid
```

- [ ] **Step 3: Update Epic issue**

Check off the Phase 0 box on the Epic; reference the learnings note commit SHA.

---

# Phase 1 · Scaffold AdaptiveGridMarker behind feature flag

**Branch:** `feat/adaptive-cluster-grid` (continuing).
**PR target:** `main`.
**PR title:** `feat(map): scaffold AdaptiveGridMarker behind VITE_FF_ADAPTIVE_GRID (issue N+2)`.

**Strategy:** Write the new files; do NOT modify `MapCanvas.tsx` yet. The new component is dead code at the end of this phase — reachable only when the env flag is set. CI green throughout because no swap happens.

### Task 1.1: Declare feature flag in env files

**Files:**
- Modify: `frontend/.env.example`
- Modify: `frontend/.env` (gitignored locally — also `.env.development` if it exists)

- [ ] **Step 1: Add flag line to `.env.example`**

Append at the end of `frontend/.env.example`:

```
# Adaptive cluster grid (epic #N) — flip to true for the new marker; default false until Phase 2 swap
VITE_FF_ADAPTIVE_GRID=false
```

- [ ] **Step 2: Add to local `.env`** (do NOT commit if `.env` is gitignored; just keep parity)

- [ ] **Step 3: Commit**

```bash
git add frontend/.env.example
git commit -m "feat(map): add VITE_FF_ADAPTIVE_GRID feature flag (off by default)"
```

### Task 1.2: Implement `toPositiveInt` branded type

**Files:**
- Create: `frontend/src/components/map/adaptive-grid.ts`
- Create: `frontend/src/components/map/adaptive-grid.test.ts`

- [ ] **Step 1: Write failing tests for `toPositiveInt`**

```ts
// adaptive-grid.test.ts
import { describe, expect, it } from 'vitest';
import { toPositiveInt } from './adaptive-grid';

describe('toPositiveInt', () => {
  it('returns the value for a positive integer', () => {
    expect(toPositiveInt(1)).toBe(1);
    expect(toPositiveInt(42)).toBe(42);
  });

  it('throws on zero', () => {
    expect(() => toPositiveInt(0)).toThrow(/must be a positive integer/i);
  });

  it('throws on negative', () => {
    expect(() => toPositiveInt(-1)).toThrow(/must be a positive integer/i);
  });

  it('throws on non-integer', () => {
    expect(() => toPositiveInt(1.5)).toThrow(/must be a positive integer/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npm run -w @bird-watch/frontend test -- adaptive-grid.test.ts
```

Expected: 4 FAIL (`toPositiveInt` not found).

- [ ] **Step 3: Implement minimal `toPositiveInt`**

Create `adaptive-grid.ts` with just:

```ts
export type PositiveInt = number & { readonly __brand: 'PositiveInt' };

export function toPositiveInt(n: number): PositiveInt {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`Expected a positive integer, got ${n}. Value must be a positive integer.`);
  }
  return n as PositiveInt;
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/adaptive-grid.ts frontend/src/components/map/adaptive-grid.test.ts
git commit -m "feat(map): add toPositiveInt branded-type constructor"
```

### Task 1.3: Implement `pickGridShape` with all shape rules

**Files:** modify `adaptive-grid.ts` and `adaptive-grid.test.ts`.

- [ ] **Step 1: Write failing tests covering every rule from the spec §7 manifest**

```ts
import { pickGridShape } from './adaptive-grid';

describe('pickGridShape', () => {
  // Desktop, no overflow
  it('1 family → 1×1', () => {
    expect(pickGridShape(1, 1, false)).toEqual({ tag: 'grid', cols: 1, rows: 1 });
  });
  it('2 families → 2×1', () => {
    expect(pickGridShape(2, 2, false)).toEqual({ tag: 'grid', cols: 2, rows: 1 });
  });
  it('3 families → 2×2', () => {
    expect(pickGridShape(3, 3, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('4 families → 2×2', () => {
    expect(pickGridShape(4, 4, false)).toEqual({ tag: 'grid', cols: 2, rows: 2 });
  });
  it('5 families → 3×3', () => {
    expect(pickGridShape(5, 5, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('9 families → 3×3', () => {
    expect(pickGridShape(9, 9, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });
  it('10 families → 4×4', () => {
    expect(pickGridShape(10, 10, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });
  it('16 families → 4×4', () => {
    expect(pickGridShape(16, 16, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Pill caps — family-cap alone
  it('family cap fires alone (17 families, 30 obs)', () => {
    expect(pickGridShape(17, 30, false)).toEqual({ tag: 'pill' });
  });

  // Pill caps — count-cap alone
  it('count cap fires alone (8 families, 65 obs)', () => {
    expect(pickGridShape(8, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: count=64 inclusive
  it('count = 64 inclusive does NOT trigger pill', () => {
    expect(pickGridShape(8, 64, false)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Boundary: count=65 with families=16 (locks > vs >= mutation)
  it('count = 65 with families = 16 → pill', () => {
    expect(pickGridShape(16, 65, false)).toEqual({ tag: 'pill' });
  });

  // Boundary: max grid
  it('families = 16, count = 64 → 4×4 (max grid, no pill)', () => {
    expect(pickGridShape(16, 64, false)).toEqual({ tag: 'grid', cols: 4, rows: 4 });
  });

  // Mobile cap
  it('mobile cap: 12 families → grid-overflow 3×3 with hiddenCount 4', () => {
    expect(pickGridShape(12, 12, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 4,
    });
  });

  // Mobile boundary: 8 families (no overflow)
  it('mobile: 8 families fits 3×3 exactly, no overflow', () => {
    expect(pickGridShape(8, 8, true)).toEqual({ tag: 'grid', cols: 3, rows: 3 });
  });

  // Mobile boundary: 9 families (first overflow)
  it('mobile: 9 families → grid-overflow with hiddenCount 1', () => {
    expect(pickGridShape(9, 9, true)).toEqual({
      tag: 'grid-overflow', cols: 3, rows: 3, hiddenCount: 1,
    });
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Expected: 16 FAIL.

- [ ] **Step 3: Implement `pickGridShape`**

Add to `adaptive-grid.ts`:

```ts
export type Dim = 1 | 2 | 3 | 4;

export type GridShape =
  | { tag: 'grid'; cols: Dim; rows: Dim }
  | { tag: 'grid-overflow'; cols: Dim; rows: Dim; hiddenCount: PositiveInt }
  | { tag: 'pill' };

export type ResolvedGrid = Exclude<GridShape, { tag: 'pill' }>;

export function visibleCapacity(shape: ResolvedGrid): number {
  return shape.tag === 'grid'
    ? shape.cols * shape.rows
    : shape.cols * shape.rows - 1;
}

const MAX_FAMILIES = 16;
const MAX_OBSERVATIONS = 64;
const MOBILE_GRID_OVERFLOW_VISIBLE = 8;

export function pickGridShape(
  uniqueFamilies: number,
  pointCount: number,
  isMobile: boolean,
): GridShape {
  if (uniqueFamilies > MAX_FAMILIES || pointCount > MAX_OBSERVATIONS) {
    return { tag: 'pill' };
  }
  if (isMobile && uniqueFamilies > MOBILE_GRID_OVERFLOW_VISIBLE) {
    return {
      tag: 'grid-overflow',
      cols: 3,
      rows: 3,
      hiddenCount: toPositiveInt(uniqueFamilies - MOBILE_GRID_OVERFLOW_VISIBLE),
    };
  }
  if (uniqueFamilies === 1) return { tag: 'grid', cols: 1, rows: 1 };
  if (uniqueFamilies === 2) return { tag: 'grid', cols: 2, rows: 1 };
  if (uniqueFamilies <= 4) return { tag: 'grid', cols: 2, rows: 2 };
  if (uniqueFamilies <= 9) return { tag: 'grid', cols: 3, rows: 3 };
  return { tag: 'grid', cols: 4, rows: 4 };
}
```

- [ ] **Step 4: Run, confirm pass**

Expected: all 16 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/adaptive-grid.ts frontend/src/components/map/adaptive-grid.test.ts
git commit -m "feat(map): add pickGridShape with all spec §4.1 rules"
```

### Task 1.4: Move `aggregateClusterFamilies` + implement `buildAdaptiveTiles`

**Files:** modify `adaptive-grid.ts` and `adaptive-grid.test.ts`.

- [ ] **Step 1: Write failing tests for `buildAdaptiveTiles`**

Cover the 4 spec §7 tile-builder rules (200 leaves descending, null-familyCode dropout, under-capacity, null-svgData → fallback) plus the upstream silhouette resolution test.

(See spec §7 for exact assertions. The test code follows the same `it()` pattern as Task 1.3.)

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Move `aggregateClusterFamilies` from `cluster-mosaic.ts` verbatim**

Copy lines 80-95 of `cluster-mosaic.ts` into `adaptive-grid.ts`. Do NOT delete from the source file in this phase — Phase 2 deletes the legacy file atomically.

- [ ] **Step 4: Implement `buildAdaptiveTiles(leaves, silhouettesById, shape)`**

```ts
import type { ObservationFeature } from './observation-layers';  // adjust import path

export type AdaptiveTile =
  | { kind: 'rendered'; familyCode: string; svgData: string; color: string; count: number }
  | { kind: 'fallback'; familyCode: string; color: string; count: number }
  | { kind: 'pending'; familyCode: string; count: number };

export type SilhouettesById = ReadonlyMap<string, { svgData: string | null; color: string }>;

export function buildAdaptiveTiles(
  leaves: ObservationFeature[],
  silhouettesById: SilhouettesById,
  shape: ResolvedGrid,
): ReadonlyArray<AdaptiveTile> {
  const families = aggregateClusterFamilies(leaves);
  const visible = families.slice(0, visibleCapacity(shape));
  return visible.map((fam) => {
    if (silhouettesById.size === 0) {
      return { kind: 'pending', familyCode: fam.familyCode, count: fam.count };
    }
    const silhouette = silhouettesById.get(fam.familyCode);
    if (!silhouette || silhouette.svgData === null) {
      return {
        kind: 'fallback',
        familyCode: fam.familyCode,
        color: silhouette?.color ?? '#999',
        count: fam.count,
      };
    }
    return {
      kind: 'rendered',
      familyCode: fam.familyCode,
      svgData: silhouette.svgData,
      color: silhouette.color,
      count: fam.count,
    };
  });
}
```

- [ ] **Step 5: Run, confirm pass**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/map/adaptive-grid.ts frontend/src/components/map/adaptive-grid.test.ts
git commit -m "feat(map): add buildAdaptiveTiles + move aggregateClusterFamilies"
```

### Task 1.5: Implement `AdaptiveGridMarker` component

**Files:**
- Create: `frontend/src/components/map/AdaptiveGridMarker.tsx`
- Create: `frontend/src/components/map/AdaptiveGridMarker.test.tsx`

- [ ] **Step 1: Write failing component tests**

Cover all 12 assertions from spec §7 component section. Use `@testing-library/react` and the existing test setup. Specifically:

- Renders 1×1 with NO badge when totalCount === 1
- Renders 1×1 with badge "5" when totalCount === 5
- Renders 2×2 with 4 per-cell badges in descending count order
- Renders fallback tile opacity 0.5 for `kind: 'fallback'`
- Renders pending skeleton (NOT opacity-0.5 fallback) when ALL tiles `kind: 'pending'`
- Renders "+N more" cell when `shape.tag === 'grid-overflow'` — assert the rendered text contains the actual `hiddenCount`
- aria-label single-observation case verbatim
- aria-label coincident-pair case verbatim
- aria-label grid case verbatim
- aria-label pill case verbatim (parent renders ClusterPill but for parity test the label)
- aria-describedby target has at most 9 list items
- Hit-extender overlay `tabIndex === -1`
- Hit-extender overlay `getBoundingClientRect()` ≥ 44×44 (`pointer:fine`) or ≥ 48×48 (`pointer:coarse`)
- Dark-mode badge `boxShadow` contains 1px white stroke
- Notable indicator (AC8): amber circle for `isNotable: true`, absent for `false`, paints before halo path

- [ ] **Step 2: Run, confirm fail**

- [ ] **Step 3: Implement `AdaptiveGridMarker.tsx`**

```tsx
import type { MouseEvent } from 'react';
import type { AdaptiveTile, ResolvedGrid } from './adaptive-grid';
import { visibleCapacity } from './adaptive-grid';

export interface AdaptiveGridMarkerProps {
  shape: ResolvedGrid;
  tiles: ReadonlyArray<AdaptiveTile>;
  totalCount: number;
  uniqueFamilies: number;
  ariaLabel: string;
  describedByListId?: string;
  describedByItems?: ReadonlyArray<string>;
  isCoarsePointer?: boolean;
  isNotable?: boolean;
  notableSpeciesName?: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function AdaptiveGridMarker(props: AdaptiveGridMarkerProps) {
  const {
    shape, tiles, totalCount, ariaLabel, describedByListId, describedByItems,
    isCoarsePointer, isNotable, onClick,
  } = props;

  const visibleN = visibleCapacity(shape);
  const cellSize = 22;
  const gap = 2;
  const padding = 3;
  const markerWidth = shape.cols * cellSize + (shape.cols - 1) * gap + 2 * padding;
  const markerHeight = shape.rows * cellSize + (shape.rows - 1) * gap + 2 * padding;
  const hitSize = isCoarsePointer ? 48 : 44;
  const overlayInset = Math.min(0, (hitSize - Math.max(markerWidth, markerHeight)) / 2);

  return (
    <button
      type="button"
      tabIndex={-1}
      data-testid="adaptive-grid-marker"
      className="adaptive-grid-marker"
      aria-label={ariaLabel}
      aria-describedby={describedByListId}
      onClick={onClick}
      style={{
        width: markerWidth,
        height: markerHeight,
        position: 'relative',
      }}
    >
      <span
        className="adaptive-grid-marker__hit"
        style={{ inset: overlayInset, position: 'absolute' }}
      />
      <div
        className="adaptive-grid-marker__grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${shape.cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${shape.rows}, ${cellSize}px)`,
          gap,
          padding,
        }}
      >
        {tiles.slice(0, visibleN).map((tile, i) => (
          <Cell key={`${tile.familyCode}-${i}`} tile={tile} showBadge={totalCount > 1 || tile.count > 1} isNotable={isNotable} />
        ))}
        {shape.tag === 'grid-overflow' && (
          <div className="adaptive-grid-marker__cell adaptive-grid-marker__overflow">
            +{shape.hiddenCount}
          </div>
        )}
      </div>
      {describedByListId && describedByItems && (
        <ul id={describedByListId} className="visually-hidden">
          {describedByItems.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      )}
    </button>
  );
}

function Cell({ tile, showBadge, isNotable }: {
  tile: AdaptiveTile; showBadge: boolean; isNotable?: boolean;
}) {
  if (tile.kind === 'pending') {
    return <div className="adaptive-grid-marker__cell adaptive-grid-marker__cell--pending" />;
  }
  if (tile.kind === 'fallback') {
    return (
      <div className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback" style={{ opacity: 0.5 }}>
        {showBadge && <span className="adaptive-grid-marker__badge">{tile.count}</span>}
      </div>
    );
  }
  // rendered
  return (
    <div className="adaptive-grid-marker__cell">
      <svg viewBox="0 0 24 24" width="22" height="22">
        {isNotable && <circle cx="12" cy="12" r="11" stroke="#f59e0b" strokeWidth="2" fill="none" />}
        <path d={tile.svgData} fill={tile.color} stroke="white" strokeWidth="1.5" />
      </svg>
      {showBadge && <span className="adaptive-grid-marker__badge">{tile.count}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/AdaptiveGridMarker.tsx frontend/src/components/map/AdaptiveGridMarker.test.tsx
git commit -m "feat(map): add AdaptiveGridMarker pure display component"
```

### Task 1.6: Write CSS rules for AdaptiveGridMarker (CSS sub-task — REQUIRED per project rule)

**Files:**
- Modify: `frontend/src/components/ds/ds-primitives.css` (preferred — marker is a DS primitive)

In `frontend/src/components/ds/ds-primitives.css`, add rules for every className introduced in `AdaptiveGridMarker.tsx`. Exhaustive class list:

`.adaptive-grid-marker`, `.adaptive-grid-marker__hit`, `.adaptive-grid-marker__grid`, `.adaptive-grid-marker__cell`, `.adaptive-grid-marker__cell--pending`, `.adaptive-grid-marker__cell--fallback`, `.adaptive-grid-marker__badge`, `.adaptive-grid-marker__overflow`

- [ ] **Step 1: Add the rules**

```css
.adaptive-grid-marker {
  background: var(--color-bg-surface);
  border-radius: 6px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  border: none;
  padding: 0;
  cursor: pointer;
}

.adaptive-grid-marker__hit {
  /* Transparent hit-extender — sized via inline `inset` per props */
  background: transparent;
  pointer-events: auto;
}

.adaptive-grid-marker__grid {
  /* Inline display: grid; template + gap come from props */
}

.adaptive-grid-marker__cell {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
}

.adaptive-grid-marker__cell--pending {
  background: linear-gradient(110deg, rgba(0,0,0,0.06) 30%, rgba(255,255,255,0.4) 50%, rgba(0,0,0,0.06) 70%);
  background-size: 200% 100%;
  animation: adaptive-grid-pending-shimmer 1.4s ease-in-out infinite;
}

@keyframes adaptive-grid-pending-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.adaptive-grid-marker__cell--fallback {
  background: rgba(0, 0, 0, 0.03);
}

.adaptive-grid-marker__badge {
  position: absolute;
  bottom: -3px;
  right: -3px;
  background: #1a1a1a;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9);
  font-variant-numeric: tabular-nums;
}

[data-theme="dark"] .adaptive-grid-marker__badge {
  background: #1a1a1a;
  /* same box-shadow stroke — works on dark basemaps too */
}

.adaptive-grid-marker__overflow {
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
```

- [ ] **Step 2: Verify every class has at least one rule**

```bash
grep -cE '^\.(adaptive-grid-marker|adaptive-grid-marker__hit|adaptive-grid-marker__grid|adaptive-grid-marker__cell|adaptive-grid-marker__cell--pending|adaptive-grid-marker__cell--fallback|adaptive-grid-marker__badge|adaptive-grid-marker__overflow)' \
  frontend/src/styles.css \
  frontend/src/components/ds/ds-primitives.css
```

Expected: non-zero count for every class. If any returns 0, add the missing rule before committing.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ds/ds-primitives.css
git commit -m "feat(map): CSS rules for AdaptiveGridMarker primitives"
```

### Task 1.7: Open PR1

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/adaptive-cluster-grid
```

- [ ] **Step 2: Open PR via gh CLI with full template**

Use `creating-prs` skill. Body must include all 5 sections from `.github/PULL_REQUEST_TEMPLATE.md`. Screenshots: this is dead code behind a flag, but the new component is testable in isolation — capture the 5-viewport × 2-theme grid demo via the Storybook-like test harness OR mark Screenshots `N/A — flagged off, no production UI yet` with a note pointing to the Phase 0 prototype screenshots.

- [ ] **Step 3: Dispatch julianken-bot review**

Per `reviewing-as-julianken-bot` skill.

- [ ] **Step 4: After bot approval, queue**

Post `@Mergifyio queue` literal-string comment.

---

# Phase 2 · Atomic cutover

**Branch:** continue on `feat/adaptive-cluster-grid` after Phase 1 merges. Pull main, rebase, push.
**PR target:** `main`.
**PR title:** `feat(map): adaptive cluster grid cutover — delete auto-spider + mosaic (issue N+3)`.

**Strategy:** Single PR. Splitting it leaves `cluster-mosaic.ts` with a dead `aggregateClusterFamilies` export, knip fires, Mergify queue blocks. The diff is large but the conceptual change is atomic: "use the new component everywhere; delete the old."

### Task 2.1: Implement memoization layers in MapCanvas.tsx

**Files:** modify `frontend/src/components/map/MapCanvas.tsx`.

- [ ] **Step 1: Add module-scoped cache + generation counter**

At the top of `MapCanvas.tsx` (after imports, before the component):

```ts
// Module-scoped Concern B + Concern C state. NOT multi-instance safe.
// Test isolation: call __resetAdaptiveGridCacheForTesting() in beforeEach.
const leafCache = new Map<string, Promise<ReadonlyArray<AdaptiveTile>>>();
const warnedRejections = new Set<string>();
let cacheGeneration = 0;

export function __resetAdaptiveGridCacheForTesting(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test-only API');
  }
  leafCache.clear();
  warnedRejections.clear();
  cacheGeneration = 0;
}
```

- [ ] **Step 2: Write the 4 memoization tests in `MapCanvas.test.tsx`**

Per spec §7 manifest: cache hit on identical `(zoom, cluster_id, point_count)`, bust on point_count change, zoom-prefix collision test, rejected-Promise eviction, generation-counter no-op, `silhouettesVersion` invalidation.

- [ ] **Step 3: Run, confirm fail**

- [ ] **Step 4: Implement the three concerns**

Replace the reconciler at `MapCanvas.tsx:691-742` with the new shape. Key points:
- Capture `const myGen = cacheGeneration` at top of `reconcile`.
- Use zoom-prefixed key `${Math.floor(zoom)}:${clusterId}:${pointCount}` for `leafCache.get/set`.
- Attach `.catch()` cleanup at the same site as `.set()` to evict rejected Promises in the same microtask. Log via `console.warn` rate-limited by `warnedRejections.has(key) ? skip : warn-and-add`.
- Before `setMosaics(next)`, check `myGen === cacheGeneration` — no-op the commit if advanced.
- At the end of the idle handler, evict entries whose `zoom:cluster_id` is not in the current visible feature-set.
- Increment `cacheGeneration` + `leafCache.clear()` in the effect re-registration callback (the `silhouettes.length` deps trigger at line 760).
- Add a monotonic `silhouettesVersion` state variable; increment when the catalogue effect fires.

- [ ] **Step 5: Run, confirm pass**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/map/MapCanvas.tsx frontend/src/components/map/MapCanvas.test.tsx
git commit -m "feat(map): three-layer memoization for adaptive-grid reconciler"
```

### Task 2.2: Wire AdaptiveGridMarker into MapCanvas; raise clusterMaxZoom

**Files:** modify `MapCanvas.tsx`, `observation-layers.ts`.

- [ ] **Step 1: Write failing integration test asserting the new marker renders**

In `MapCanvas.test.tsx`, mount with `VITE_FF_ADAPTIVE_GRID=true` and a canned cluster of 4 families, assert `screen.queryByTestId('adaptive-grid-marker')` is present and `queryByTestId('mosaic-marker')` is absent.

- [ ] **Step 2: Run, fail**

- [ ] **Step 3: Implement the swap**

In `MapCanvas.tsx` around line 716 (the existing marker render site):

```tsx
// Parent routes the click. Marker stays pure.
const onClick = isSingleLeaf(entry.clusterId)
  ? () => openObsPanel(entry.subId)
  : () => zoomToExpansion(entry.clusterId);

const shape = pickGridShape(entry.uniqueFamilies, entry.pointCount, isMobile);
if (shape.tag === 'pill') {
  return <ClusterPill key={entry.clusterId} count={entry.pointCount} onClick={onClick} />;
}
return (
  <AdaptiveGridMarker
    key={entry.clusterId}
    shape={shape}
    tiles={entry.tiles}
    totalCount={entry.pointCount}
    uniqueFamilies={entry.uniqueFamilies}
    ariaLabel={buildAriaLabel(entry)}
    describedByListId={`marker-${entry.clusterId}-families`}
    describedByItems={buildDescribedByItems(entry)}
    isCoarsePointer={isCoarsePointer}
    isNotable={entry.isNotable}
    notableSpeciesName={entry.notableSpeciesName}
    onClick={onClick}
  />
);
```

`isSingleLeaf(clusterId)` is a helper that returns `cluster.point_count === 1`.

- [ ] **Step 4: Raise `CLUSTER_MAX_ZOOM` 14 → 22 in `observation-layers.ts:152`**

- [ ] **Step 5: Run all tests**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/map/MapCanvas.tsx frontend/src/components/map/MapCanvas.test.tsx frontend/src/components/map/observation-layers.ts
git commit -m "feat(map): wire AdaptiveGridMarker; raise clusterMaxZoom 14→22"
```

### Task 2.3: Delete auto-spider subsystem

**Files (delete entirely):**
- `frontend/src/components/map/use-auto-spider.ts`
- `frontend/src/components/map/use-auto-spider.test.ts`
- `frontend/src/components/map/stack-fanout.ts`
- `frontend/src/components/map/stack-fanout.test.ts`
- `frontend/src/components/map/fan-layout.ts`
- `frontend/src/components/map/fan-layout.test.ts`
- `frontend/src/components/map/StackedSilhouetteMarker.tsx`
- `frontend/src/components/map/StackedSilhouetteMarker.test.tsx`
- `frontend/e2e/map-stack-fanout.spec.ts`

**Files modified:**
- `MapCanvas.tsx` — remove the auto-spider block at lines 1073-1100 plus the `import StackedSilhouetteMarker` at line 43 plus the `auto-spider-leader-lines-layer` source/layer adds.
- `observation-layers.ts` — remove `inStack` plumbing at lines 42-61, 121-126, 278, 336.

- [ ] **Step 1: Delete the 9 files**

```bash
git rm frontend/src/components/map/{use-auto-spider,stack-fanout,fan-layout,StackedSilhouetteMarker}.{ts,tsx,test.ts,test.tsx} 2>/dev/null
git rm frontend/e2e/map-stack-fanout.spec.ts
```

- [ ] **Step 2: Remove imports and consuming blocks from MapCanvas.tsx**

Delete the import at line 43 and the JSX block at 1073-1100 (the `<StackedSilhouetteMarker>` mapping). Delete the `auto-spider-leader-lines-layer` source/layer additions wherever they appear in the file.

- [ ] **Step 3: Remove `inStack` plumbing in observation-layers.ts**

Drop the `inStack: boolean` field from the `ObservationProperties` type; drop the property assignment in `observationsToGeoJson`; drop the four filter clauses that branch on `inStack`.

- [ ] **Step 4: Run all tests; build; knip**

```bash
npm -w @bird-watch/frontend run test
npm -w @bird-watch/frontend run build
npm run knip
```

Expected: all green. `knip` MUST be clean — if it reports dead exports, the cleanup is incomplete. Fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/
git commit -m "feat(map): delete auto-spider subsystem (replaced by grid disambiguation)"
```

### Task 2.4: Delete legacy mosaic files

**Files (delete entirely):**
- `frontend/src/components/map/MosaicMarker.tsx`
- `frontend/src/components/map/MosaicMarker.test.tsx`
- `frontend/src/components/map/cluster-mosaic.ts`
- `frontend/src/components/map/cluster-mosaic.test.ts`
- `frontend/e2e/map-cluster-mosaic.spec.ts`

- [ ] **Step 1: Delete the 5 files**

```bash
git rm frontend/src/components/map/{MosaicMarker.tsx,MosaicMarker.test.tsx,cluster-mosaic.ts,cluster-mosaic.test.ts}
git rm frontend/e2e/map-cluster-mosaic.spec.ts
```

- [ ] **Step 2: Drop `CLUSTER_MOSAIC_MAX_POINTS = 8` in observation-layers.ts:163**

- [ ] **Step 3: Drop `import MosaicMarker` and any remaining references in MapCanvas.tsx**

- [ ] **Step 4: Flip feature flag default to `true`**

In `frontend/.env.example`:

```
VITE_FF_ADAPTIVE_GRID=true  # default-on; flag itself will be removed in a follow-up
```

- [ ] **Step 5: Run all tests; build; knip; orphan-classname-check**

```bash
npm -w @bird-watch/frontend run test
npm -w @bird-watch/frontend run build
npm run knip
bash scripts/check-orphan-classnames.sh
```

- [ ] **Step 6: Commit**

```bash
git add -A frontend/
git commit -m "feat(map): delete legacy mosaic + flip VITE_FF_ADAPTIVE_GRID default to on"
```

### Task 2.5: Write the new e2e suite

**Files:**
- Create: `frontend/e2e/map-adaptive-grid.spec.ts`

- [ ] **Step 1: Write the 8 scenarios from spec §7 E2E**

```ts
// map-adaptive-grid.spec.ts
import { test, expect } from '@playwright/test';
import { App } from './pages/app';

test.describe('adaptive cluster grid', () => {
  test('AZ overview at z=8: at least one pill visible', async ({ page }) => { /* ... */ });
  test('z=12: at least one 4×4 grid visible', async ({ page }) => { /* ... */ });
  test('z=16: at least one 2×1 or 1×1 grid visible', async ({ page }) => { /* ... */ });
  test('z=8→z=15 pinch-zoom: no auto-spider-leader-lines-layer', async ({ page }) => { /* ... */ });
  test('z=8→z=15: no inStack-keyed DOM attributes', async ({ page }) => { /* ... */ });
  test('count=1 1×1 has no [data-fallback="true"]', async ({ page }) => { /* ... */ });
  test('aria-describedby contents axe-clean', async ({ page }) => { /* ... */ });
  test('DOM marker count ≤ 2500 at every canonical viewport', async ({ page }) => { /* ... */ });
});
```

- [ ] **Step 2: Add the perf-gate workflow file**

Create `.github/workflows/perf-gate.yml`:

```yaml
name: perf-gate
on:
  pull_request:
    paths:
      - 'frontend/src/components/map/**'
      - 'frontend/e2e/map-adaptive-grid.spec.ts'
jobs:
  perf:
    runs-on: ubuntu-latest-4-cores
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm -w @bird-watch/frontend run build
      - run: CI_PERF_GATE=1 npm -w @bird-watch/frontend run test:e2e -- --grep "@perf"
```

In `map-adaptive-grid.spec.ts`, tag the wall-clock-based test with `@perf` so only the perf workflow runs it.

- [ ] **Step 3: Run e2e locally**

```bash
npm -w @bird-watch/frontend run test:e2e
```

- [ ] **Step 4: Extend `axe.spec.ts:55`**

Add an assertion for the adaptive-grid aria-label and aria-describedby `<ul>` contents.

- [ ] **Step 5: Commit**

```bash
git add frontend/e2e/map-adaptive-grid.spec.ts frontend/e2e/axe.spec.ts .github/workflows/perf-gate.yml
git commit -m "test(e2e): adaptive-grid suite + dedicated perf-gate workflow"
```

### Task 2.6: Multi-viewport design review (10 screenshots)

Per `frontend/**` review protocol (CLAUDE.md). Plan-mandated step — issue #445.

- [ ] **Step 1: Start dev server**

```bash
npm run dev -w @bird-watch/frontend
```

- [ ] **Step 2: Drive Playwright MCP through 5 viewports × 2 themes**

For each viewport (390×844, 768×1024, 1024×768, 1440×900, 1920×1080) and each theme:

- `browser_resize` to viewport
- `browser_evaluate` to set `[data-theme]`
- Navigate to surfaces touched (map view at z=8, z=12, z=16)
- `browser_console_messages` — assert empty (errors AND warnings)
- `browser_take_screenshot` — save locally for the PR body

- [ ] **Step 3: Upload screenshots via `pr-screenshots-via-user-attachments` skill**

Generate 10 `user-attachments/assets/<uuid>` URLs by simulated paste in chrome-devtools-mcp. NEVER commit PNGs to the repo.

- [ ] **Step 4: Dispatch design-review subagent**

```
Task(
  description: "adaptive-grid 10-screenshot design review",
  subagent_type: "ui-design:ui-designer",
  model: "opus",
  prompt: <brief naming PR URL, spec path, 10 screenshot URLs, AC reference, verdict format: PASS/FAIL with file:line-equivalent evidence, cap 3 findings per viewport>
)
```

- [ ] **Step 5: GATE — all 5 viewports PASS?**

If FAIL: revise per findings, re-capture, re-dispatch. Do NOT proceed to bot review with any viewport FAIL.

### Task 2.7: Open PR2

- [ ] **Step 1: Push** `git push origin feat/adaptive-cluster-grid`
- [ ] **Step 2: Open PR via `creating-prs` skill** — all 5 sections, 10 inline screenshots, link to Phase 1 PR
- [ ] **Step 3: Dispatch `julianken-bot` review subagent**
- [ ] **Step 4: After bot approval, post `@Mergifyio queue`**
- [ ] **Step 5: Watch CI — all required checks plus `perf-gate` workflow MUST pass before queue merges**

---

# Phase 3 · Documentation linkbacks

**Branch:** new branch `docs/adaptive-grid-spec-linkback` off `main` after Phase 2 merges.

### Task 3.1: Update architecture spec cross-reference

**Files:** modify `docs/specs/2026-04-16-bird-watch-design.md`.

- [ ] **Step 1: In the §Frontend section, replace any mention of `<MosaicMarker>` or auto-spider with a reference to the adaptive-grid design**

Add a paragraph after the existing frontend-architecture paragraph:

```markdown
**Cluster marker:** A single `<AdaptiveGridMarker>` component handles every
cluster at every zoom level. Shape adapts from 1×1 to 4×4 based on unique-family
count; clusters exceeding 16 unique families OR 64 observations render as a
numeric `<ClusterPill>`. See `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`
for the full design.
```

- [ ] **Step 2: Update the spec headline / dependency table if it counts components**

Run:

```bash
grep -n "MosaicMarker\|auto-spider\|cluster-mosaic" docs/specs/2026-04-16-bird-watch-design.md
```

For each match, decide: replace with the new reference, or delete if obsolete.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-04-16-bird-watch-design.md
git commit -m "docs(spec): cross-reference adaptive-grid design from architecture spec"
```

### Task 3.2: Annotate feature flag with removal date

**Files:** modify `frontend/.env.example`.

- [ ] **Step 1: Add removal-date comment**

```
# Adaptive cluster grid — default ON since 2026-05-NN.
# Remove this flag (along with all gated code paths) after 2026-08-NN if no rollback needed.
VITE_FF_ADAPTIVE_GRID=true
```

- [ ] **Step 2: Commit + close child issues + close epic**

```bash
git add frontend/.env.example
git commit -m "docs(map): annotate adaptive-grid flag with removal date"
```

After PR3 merges, close issues #N+1, #N+2, #N+3, #N+4 with cross-links to merged PRs. Close the epic.

### Task 3.3: Open PR3

- [ ] **Step 1: Push** `git push -u origin docs/adaptive-grid-spec-linkback`
- [ ] **Step 2: Open PR — Screenshots `N/A — docs-only`**
- [ ] **Step 3: Dispatch bot review**
- [ ] **Step 4: Queue via Mergify**
- [ ] **Step 5: After merge, close Epic + child issues**

---

## Self-review notes (plan author, not implementer)

**Spec coverage:** Every spec §4–§8 requirement maps to a task. Specifically:
- §4.1 sizing rules → Task 1.3 tests + impl
- §4.3 badge contrast → Task 1.6 CSS + Task 1.5 dark-mode test
- §4.4 hit-extender → Task 1.5 component impl + Task 1.5 component test
- §4.5 parent-routed click → Task 2.2 wire-in
- §4.6 two-tier aria → Task 1.5 component tests
- §4.7 inherited tabIndex → Task 1.5 component test
- §5.3 three memo concerns → Task 2.1
- §6 file map → Phase 2 manifest + Tasks 2.3, 2.4
- §7 test strategy → Tasks 1.3, 1.4, 1.5, 2.5
- §10 four gates → Phase 0 Task 0.2

**Placeholder scan:** Run `grep -nE "TBD|TODO|fill in|implement later" docs/plans/2026-05-14-adaptive-cluster-grid.md` — must return zero before publication.

**Type consistency:** `pickGridShape`, `buildAdaptiveTiles`, `AdaptiveGridMarker`, `AdaptiveTile`, `GridShape`, `ResolvedGrid`, `PositiveInt`, `toPositiveInt`, `visibleCapacity` — all match between tasks. `silhouettesById: ReadonlyMap<string, ...>` is consistent in Tasks 1.4 and 2.1. The `aggregateClusterFamilies` move is captured in Task 1.4 (copy) + Task 2.4 (delete source).

**className gate check** (per project CSS-sub-task rule):

```bash
grep -n "className" docs/plans/2026-05-14-adaptive-cluster-grid.md | grep -v "CSS rules\|Step\|grep\|grid-marker\|---"
```

Plan author verified: every className introduced in Task 1.5 has a matching rule in Task 1.6.
