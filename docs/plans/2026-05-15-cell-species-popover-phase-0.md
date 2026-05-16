# Cell Species Popover — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread per-species observation counts through the cluster data pipeline so future phases can render `Nx <comName>` rows in hover preview / popover. No UI changes; CI green throughout.

**Architecture:** Add `speciesCode` to the cluster GeoJSON property bag + `ClusterLeafFeature` interface, introduce `SpeciesAggregate` and `aggregateClusterSpecies(leaves)`, extend `AdaptiveTile` variants with a `species: ReadonlyArray<SpeciesAggregate>` field, and thread the right slice onto each tile inside `buildAdaptiveTiles`.

**Tech Stack:** TypeScript strict · Vitest · existing `Observation` / `FamilyAggregate` types from `@bird-watch/shared-types` · MapLibre-GL 5.x · React 19.

**Issue:** #557 (subissue 1 of 4 in epic #556)
**Spec:** `docs/specs/2026-05-15-cell-species-popover-design.md` §4.1, §4.2, §4.3, §4.11

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Add `speciesCode: string | null` field to `ClusterLeafFeature.properties` interface
- [ ] Add `comName: string` field to `ClusterLeafFeature.properties` interface (currently absent — `aggregateClusterSpecies` reads it)
- [ ] Add `speciesCode` to `observationsToGeoJson`'s per-feature property block (5 new lines around `observation-layers.ts:107-117`)
- [ ] Add `comName` to `observationsToGeoJson`'s per-feature property block (already present per `observation-layers.ts:115` — verify, don't duplicate)
- [ ] Ship `SpeciesAggregate` type export in `adaptive-grid.ts`
- [ ] Ship `aggregateClusterSpecies(leaves)` function with **9 unit tests** covering: group-by-comName, sort-stability (descending count + ascending comName), null-familyCode dropout, null-speciesCode preserved, multiple slash/spuh merge by comName, count-reconciliation invariant, empty leaves, single-leaf, and the degenerate `comName` collision case (same comName, different speciesCode — accept first non-null speciesCode)
- [ ] Add `species: ReadonlyArray<SpeciesAggregate>` field to all 3 `AdaptiveTile` variants
- [ ] Update `buildAdaptiveTiles` to thread species onto every tile (count reconciliation test against `tile.count`)
- [ ] Update 3 test-fixture helpers (`rendered()`, `fallback()`, `pending()`) at `AdaptiveGridMarker.test.tsx:10-25` with `species` optional arg defaulting to `[]`
- [ ] Update 4 inline tile literals in `adaptive-grid.test.ts:175-278` to include `species: []`
- [ ] All existing tests (765+) still pass
- [ ] Playwright MCP regression smoke: dev server up, browse bird-maps.com data, zero console errors, markers render

## File structure

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/components/map/observation-layers.ts` | Modify | Add `speciesCode` to per-feature `properties` block in `observationsToGeoJson` (line ~107-117) |
| `frontend/src/components/map/adaptive-grid.ts` | Modify | Add `SpeciesAggregate` type, `aggregateClusterSpecies()`, extend `ClusterLeafFeature.properties`, extend `AdaptiveTile`, thread species in `buildAdaptiveTiles` |
| `frontend/src/components/map/adaptive-grid.test.ts` | Modify | Add 9 unit tests for `aggregateClusterSpecies`; update 4 inline tile literals to include `species: []` |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | Modify | Extend `rendered()` / `fallback()` / `pending()` helpers with `species` optional arg defaulting to `[]` |
| `frontend/src/components/map/observation-layers.test.ts` | Modify (light) | Add 1 assertion: `observationsToGeoJson(obs)` produces features with `properties.speciesCode === obs.speciesCode` |

**CSS sub-task gate (per project writing-plans extension)**: N/A for Phase 0. No new className, no component file modified, no visible UI added. Phase 0 is data-layer-only.

**Multi-viewport design-review gate**: N/A for Phase 0. No visible UI change. Phase 1 (#558) is the first phase that triggers this gate.

---

## Task 1: Set up git worktree

Per the user's instruction to use git worktrees. Isolates Phase 0 work from any in-flight sessions.

**Files:** None — git scaffolding only.

- [ ] **Step 1: Confirm `main` is clean and up to date**

Run: `git status && git fetch origin && git checkout main && git pull origin main`

Expected: `Your branch is up to date with 'origin/main'.` and `nothing to commit, working tree clean`.

- [ ] **Step 2: Create the Phase 0 worktree**

Run:
```bash
git worktree add -b feat/cell-popover-phase-0 ../bird-watch.phase-0 main
cd ../bird-watch.phase-0
```

Expected: a new worktree at `/Users/j/repos/bird-watch.phase-0` on branch `feat/cell-popover-phase-0`.

- [ ] **Step 3: Install workspace deps (worktree-scoped)**

Run: `npm install`

Expected: no lockfile changes (worktree shares the repo's package-lock.json). If `npm` reports lockfile updates, STOP — that indicates an unintended dep drift and the worktree base may be wrong.

---

## Task 2: Extend `ClusterLeafFeature.properties` interface

Add the two new fields the aggregator needs. No production code-path consumer yet — defensive type extension.

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.ts:90-129` (interface declaration)

- [ ] **Step 1: Read the existing interface**

Read `frontend/src/components/map/adaptive-grid.ts` lines 90-129. Locate the `ClusterLeafFeature` interface. The current `properties` block has `familyCode: string | null`.

- [ ] **Step 2: Extend the properties block**

Edit `frontend/src/components/map/adaptive-grid.ts`. Locate the `ClusterLeafFeature` interface and update its `properties` block:

```ts
export interface ClusterLeafFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    /** Family code. Null when the join in `observationsToGeoJson` doesn't hit. */
    familyCode: string | null;
    /**
     * eBird 6-char species code. Threaded onto each feature by
     * `observationsToGeoJson` (issue #557 / spec §4.11). `null` for
     * spuh/slash/hybrid taxa where eBird returns no code; preserved
     * by `aggregateClusterSpecies` as a non-clickable row.
     */
    speciesCode: string | null;
    /** Display common name. Always present per eBird API contract. */
    comName: string;
    /** Whether this observation is in eBird's notable list. */
    isNotable?: boolean;
  };
}
```

(Add `speciesCode` and `comName` to whatever existing field list is present. `comName` may already exist; if so, leave it. Don't drop `isNotable`.)

- [ ] **Step 3: Run typecheck — expect failures from existing callers**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -20`

Expected: clean build. The new fields don't break existing callers since they're additive on an interface that's only consumed by `buildAdaptiveTiles` / `aggregateClusterFamilies`, both of which currently only read `familyCode`.

If the build FAILS due to test fixtures missing the new fields: that's caught here. Stop, note which test files mock `ClusterLeafFeature` shapes, and fix those mocks to include `speciesCode: 'XXX', comName: 'Test Species'` defaults. Then re-run.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/map/adaptive-grid.ts
git commit -m "feat(map): extend ClusterLeafFeature with speciesCode + comName (#557)"
```

---

## Task 3: Add `SpeciesAggregate` type + 9 unit tests for `aggregateClusterSpecies` (RED)

TDD red phase: write the test file first, scaffold the function signature only, confirm all 9 tests FAIL.

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.ts` (append types + function signature)
- Modify: `frontend/src/components/map/adaptive-grid.test.ts` (append test block)

- [ ] **Step 1: Append type + function signature to `adaptive-grid.ts`**

After the existing exports near the bottom of `adaptive-grid.ts`, append:

```ts
/**
 * Per-species aggregation within a family. Used by `<CellHoverPreview>`,
 * `<CellPopover>`, and `<ClusterListPopover>` (epic #556, Phase 1+).
 *
 * `comName` is the grouping key (always present per eBird API contract);
 * `speciesCode` is `null` for spuh/slash/hybrid taxa where eBird returns
 * no canonical code — the row renders but is not clickable.
 */
export interface SpeciesAggregate {
  comName: string;
  speciesCode: string | null;
  count: number;
}

/**
 * Group cluster leaves by `comName` within each `familyCode`. Used by
 * `buildAdaptiveTiles` (issue #557, spec §4.2). Sort: descending count,
 * ascending `comName`.
 *
 * - Leaves with `familyCode === null` drop (cannot bucket).
 * - Leaves with `speciesCode === null` preserved with `speciesCode: null`.
 * - Multiple leaves with same `comName` but different `speciesCode` merge
 *   (first non-null `speciesCode` wins).
 */
export function aggregateClusterSpecies(
  leaves: ClusterLeafFeature[],
): Map<string, ReadonlyArray<SpeciesAggregate>> {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Append the 9-test block to `adaptive-grid.test.ts`**

At the end of `frontend/src/components/map/adaptive-grid.test.ts`, append:

```ts
import { aggregateClusterSpecies, type SpeciesAggregate } from './adaptive-grid.js';

// Test fixture helper — local to this describe block.
function leaf(
  familyCode: string | null,
  comName: string,
  speciesCode: string | null = `${comName.slice(0, 6).toLowerCase()}1`,
): ClusterLeafFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-110, 32] },
    properties: { familyCode, speciesCode, comName },
  };
}

describe('aggregateClusterSpecies', () => {
  it('groups leaves by comName within familyCode', () => {
    const out = aggregateClusterSpecies([
      leaf('hummingbirds', "Anna's Hummingbird"),
      leaf('hummingbirds', "Anna's Hummingbird"),
      leaf('hummingbirds', "Costa's Hummingbird"),
    ]);
    expect(out.get('hummingbirds')).toEqual([
      { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 2 },
      { comName: "Costa's Hummingbird", speciesCode: "costa'1", count: 1 },
    ]);
  });

  it('sorts within family: descending count, ascending comName tiebreak', () => {
    const out = aggregateClusterSpecies([
      leaf('flycatchers', 'Vermilion Flycatcher'),
      leaf('flycatchers', 'Black Phoebe'),
      leaf('flycatchers', 'Black Phoebe'),
      leaf('flycatchers', "Say's Phoebe"),
    ]);
    const fams = out.get('flycatchers')!;
    expect(fams.map((s) => s.comName)).toEqual([
      'Black Phoebe',         // count 2
      "Say's Phoebe",         // count 1, S < V
      'Vermilion Flycatcher', // count 1
    ]);
  });

  it('drops leaves with null familyCode', () => {
    const out = aggregateClusterSpecies([
      leaf(null, 'Unknown bird sp.'),
      leaf('hummingbirds', "Anna's Hummingbird"),
    ]);
    expect(Array.from(out.keys())).toEqual(['hummingbirds']);
  });

  it('preserves leaves with null speciesCode (spuh/slash/hybrid)', () => {
    const out = aggregateClusterSpecies([
      leaf('sandpipers', 'Sandpiper sp.', null),
      leaf('sandpipers', 'Sandpiper sp.', null),
    ]);
    expect(out.get('sandpipers')).toEqual([
      { comName: 'Sandpiper sp.', speciesCode: null, count: 2 },
    ]);
  });

  it('merges multiple comName entries — first non-null speciesCode wins', () => {
    const out = aggregateClusterSpecies([
      leaf('hawks', 'Cooper\'s Hawk', null),
      leaf('hawks', 'Cooper\'s Hawk', 'coohaw'),
      leaf('hawks', 'Cooper\'s Hawk', 'coohaw'),
    ]);
    expect(out.get('hawks')).toEqual([
      { comName: "Cooper's Hawk", speciesCode: 'coohaw', count: 3 },
    ]);
  });

  it('count reconciliation: sum of family aggregate equals leaf count', () => {
    const leaves = [
      leaf('hummingbirds', "Anna's Hummingbird"),
      leaf('hummingbirds', "Anna's Hummingbird"),
      leaf('hummingbirds', "Costa's Hummingbird"),
      leaf('hawks', "Cooper's Hawk"),
    ];
    const out = aggregateClusterSpecies(leaves);
    const hummSum = out.get('hummingbirds')!.reduce((s, x) => s + x.count, 0);
    const hawkSum = out.get('hawks')!.reduce((s, x) => s + x.count, 0);
    expect(hummSum).toBe(3);
    expect(hawkSum).toBe(1);
  });

  it('empty leaves → empty map', () => {
    expect(aggregateClusterSpecies([])).toEqual(new Map());
  });

  it('single leaf → single-species single-family entry', () => {
    const out = aggregateClusterSpecies([leaf('hummingbirds', "Anna's Hummingbird")]);
    expect(out.size).toBe(1);
    expect(out.get('hummingbirds')).toEqual([
      { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 1 },
    ]);
  });

  it('degenerate: same comName with conflicting speciesCodes — first non-null wins', () => {
    const out = aggregateClusterSpecies([
      leaf('warblers', 'Yellow Warbler', 'yelwar'),
      leaf('warblers', 'Yellow Warbler', 'yelwar2'),  // hypothetical bad data
    ]);
    expect(out.get('warblers')).toEqual([
      { comName: 'Yellow Warbler', speciesCode: 'yelwar', count: 2 },
    ]);
  });
});
```

- [ ] **Step 3: Run the tests — all 9 must FAIL with "not implemented"**

Run: `npm run test --workspace @bird-watch/frontend -- adaptive-grid.test --run 2>&1 | tail -20`

Expected: 9 new `aggregateClusterSpecies` tests FAIL; all other existing tests still PASS.

- [ ] **Step 4: Commit (RED)**

```bash
git add frontend/src/components/map/adaptive-grid.ts \
        frontend/src/components/map/adaptive-grid.test.ts
git commit -m "test(map): scaffold aggregateClusterSpecies + 9 failing tests (#557)

RED phase per TDD discipline. Function signature + tests; impl in next
commit."
```

---

## Task 4: Implement `aggregateClusterSpecies` (GREEN)

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.ts` (replace stub)

- [ ] **Step 1: Replace the function body**

In `frontend/src/components/map/adaptive-grid.ts`, replace the `throw new Error('not implemented')` body of `aggregateClusterSpecies` with:

```ts
export function aggregateClusterSpecies(
  leaves: ClusterLeafFeature[],
): Map<string, ReadonlyArray<SpeciesAggregate>> {
  // First pass: group by (familyCode, comName) → { count, speciesCode }.
  // `speciesCode` value: first non-null wins; null only if every leaf has null.
  type Bucket = { speciesCode: string | null; count: number };
  const byFamily = new Map<string, Map<string, Bucket>>();

  for (const leaf of leaves) {
    const { familyCode, speciesCode, comName } = leaf.properties;
    if (familyCode === null) continue;
    let speciesMap = byFamily.get(familyCode);
    if (!speciesMap) {
      speciesMap = new Map();
      byFamily.set(familyCode, speciesMap);
    }
    const existing = speciesMap.get(comName);
    if (existing) {
      existing.count += 1;
      // First non-null speciesCode wins (defensive against bad data).
      if (existing.speciesCode === null && speciesCode !== null) {
        existing.speciesCode = speciesCode;
      }
    } else {
      speciesMap.set(comName, { speciesCode, count: 1 });
    }
  }

  // Second pass: sort each family's species (descending count, ascending comName).
  const result = new Map<string, ReadonlyArray<SpeciesAggregate>>();
  for (const [familyCode, speciesMap] of byFamily) {
    const species: SpeciesAggregate[] = Array.from(speciesMap, ([comName, bucket]) => ({
      comName,
      speciesCode: bucket.speciesCode,
      count: bucket.count,
    }));
    species.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.comName.localeCompare(b.comName);
    });
    result.set(familyCode, species);
  }
  return result;
}
```

- [ ] **Step 2: Run tests — all 9 must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- adaptive-grid.test --run 2>&1 | tail -10`

Expected: all 9 new tests PASS; all existing tests still PASS.

- [ ] **Step 3: Run the full build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean (`✓ built in ...`).

- [ ] **Step 4: Commit (GREEN)**

```bash
git add frontend/src/components/map/adaptive-grid.ts
git commit -m "feat(map): implement aggregateClusterSpecies — 9 tests green (#557)"
```

---

## Task 5: Extend `AdaptiveTile` discriminated union with `species` field

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.ts` (extend type definitions)

- [ ] **Step 1: Read the current `AdaptiveTile` declaration**

Read `frontend/src/components/map/adaptive-grid.ts` around lines 134-137. Confirm the 3-variant discriminated union.

- [ ] **Step 2: Extend all 3 variants**

Replace the existing `AdaptiveTile` type:

```ts
/**
 * Per-cell datum the marker renders. Three variants:
 *   - `rendered`: catalogue loaded, family has CC-licensed art.
 *   - `fallback`: catalogue loaded, family has no art (uncurated /
 *     missing). Renderer paints at opacity 0.5 with a generic shape.
 *   - `pending`: catalogue not yet loaded for ANY family. Renderer
 *     paints a skeleton/shimmer so a cold-load map is distinguishable
 *     from a real coverage gap (spec §5.1 type comment).
 *
 * `species` is the per-species breakdown for this family in the cluster,
 * threaded onto every variant for Phase 1+ popovers (issue #557, spec §4.1).
 * Sum invariant: `sum(species[].count) === count`.
 */
export type AdaptiveTile =
  | { kind: 'rendered'; familyCode: string; svgData: string; color: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> }
  | { kind: 'fallback'; familyCode: string; color: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> }
  | { kind: 'pending'; familyCode: string;
      count: number; species: ReadonlyArray<SpeciesAggregate> };
```

- [ ] **Step 3: Run typecheck — expect failures from tile-literal callers**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -20`

Expected: type errors in `adaptive-grid.test.ts:175-278` (inline tile literals missing `species` field) AND `AdaptiveGridMarker.test.tsx:10-25` (helper functions missing the field). These are addressed by Tasks 6 and 7.

Do NOT commit yet — the build is RED.

---

## Task 6: Update test fixtures in `adaptive-grid.test.ts` for new `species` field

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.test.ts:175-278`

- [ ] **Step 1: Update the existing 4 inline tile-literal sites**

In `adaptive-grid.test.ts`, search for `kind: 'rendered'` and `kind: 'fallback'` and `kind: 'pending'` patterns. Add `species: []` to each tile literal that's missing it.

Use the existing find tool:

```bash
grep -n "kind: 'rendered'\|kind: 'fallback'\|kind: 'pending'" frontend/src/components/map/adaptive-grid.test.ts
```

For each match line, add `, species: []` before the closing `}` of the literal. Example transform:

```ts
// BEFORE
{ kind: 'rendered', familyCode: 'fam1', svgData: 'M0 0L1 1Z', color: '#f00', count: 5 }
// AFTER
{ kind: 'rendered', familyCode: 'fam1', svgData: 'M0 0L1 1Z', color: '#f00', count: 5, species: [] }
```

- [ ] **Step 2: Run tests to confirm GREEN**

Run: `npm run test --workspace @bird-watch/frontend -- adaptive-grid.test --run 2>&1 | tail -10`

Expected: all tests PASS (the new fixture extensions don't change behavior — empty species[] is the default).

- [ ] **Step 3: Run build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean. The build is back to green for this file.

(Do NOT commit yet — Task 7 finishes the second fixture file.)

---

## Task 7: Update test-fixture helpers in `AdaptiveGridMarker.test.tsx`

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx:10-25`

- [ ] **Step 1: Read the existing helpers**

Read lines 1-40 of `frontend/src/components/map/AdaptiveGridMarker.test.tsx`. Identify the `rendered()`, `fallback()`, `pending()` helper functions.

- [ ] **Step 2: Extend each helper with `species` optional arg**

Update the helpers (preserve their existing signatures, add an optional `species` parameter defaulting to `[]`):

```ts
function rendered(
  familyCode: string,
  count: number,
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return {
    kind: 'rendered',
    familyCode,
    svgData: 'M0 0L1 1Z',
    color: '#888',
    count,
    species,
  };
}

function fallback(
  familyCode: string,
  count: number,
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return {
    kind: 'fallback',
    familyCode,
    color: '#888',
    count,
    species,
  };
}

function pending(
  familyCode: string,
  count: number,
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return {
    kind: 'pending',
    familyCode,
    count,
    species,
  };
}
```

Add the import at the top of the file (with the existing `AdaptiveTile` import):

```ts
import type { AdaptiveTile, SpeciesAggregate } from './adaptive-grid.js';
```

- [ ] **Step 3: Run tests + build**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker.test --run 2>&1 | tail -5
npm run build --workspace @bird-watch/frontend 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 4: Commit Tasks 5+6+7 together**

```bash
git add frontend/src/components/map/adaptive-grid.ts \
        frontend/src/components/map/adaptive-grid.test.ts \
        frontend/src/components/map/AdaptiveGridMarker.test.tsx
git commit -m "feat(map): extend AdaptiveTile with species field + fixture updates (#557)

Adds `species: ReadonlyArray<SpeciesAggregate>` to all 3 AdaptiveTile
variants. Updates 4 inline tile literals in adaptive-grid.test.ts and
3 helper functions in AdaptiveGridMarker.test.tsx to default species
to []. Existing component renders unaffected — species is not yet
consumed by AdaptiveGridMarker (Phase 1 wires it)."
```

---

## Task 8: Thread `species` onto every tile in `buildAdaptiveTiles`

**Files:**
- Modify: `frontend/src/components/map/adaptive-grid.ts` (extend `buildAdaptiveTiles` body)
- Modify: `frontend/src/components/map/adaptive-grid.test.ts` (add 1 new test for species threading)

- [ ] **Step 1: Read the current `buildAdaptiveTiles`**

Read `adaptive-grid.ts` lines 185-213.

- [ ] **Step 2: Add a failing test for species threading**

Append to `adaptive-grid.test.ts` inside the existing `buildAdaptiveTiles` describe block (search for `describe('buildAdaptiveTiles'`):

```ts
it('threads per-family species arrays onto each rendered tile (#557)', () => {
  const leaves = [
    leaf('hummingbirds', "Anna's Hummingbird"),
    leaf('hummingbirds', "Anna's Hummingbird"),
    leaf('hummingbirds', "Costa's Hummingbird"),
    leaf('hawks', "Cooper's Hawk"),
  ];
  const silhouettes: SilhouettesById = new Map([
    ['hummingbirds', { svgData: 'M0 0L1 1Z', color: '#7B2D8E' }],
    ['hawks', { svgData: 'M0 0L1 1Z', color: '#444' }],
  ]);
  const tiles = buildAdaptiveTiles(
    leaves,
    silhouettes,
    { tag: 'grid', cols: 2, rows: 2 },
  );
  // First tile = hummingbirds (count 3, descending order)
  expect(tiles[0]?.species).toEqual([
    { comName: "Anna's Hummingbird", speciesCode: "anna's1", count: 2 },
    { comName: "Costa's Hummingbird", speciesCode: "costa'1", count: 1 },
  ]);
  // Second tile = hawks
  expect(tiles[1]?.species).toEqual([
    { comName: "Cooper's Hawk", speciesCode: "cooper1", count: 1 },
  ]);
  // Count invariant
  expect(tiles[0]?.count).toBe(3);
  expect(tiles[0]?.species.reduce((s, x) => s + x.count, 0)).toBe(tiles[0]?.count);
});
```

- [ ] **Step 3: Run — expect 1 fail**

Run: `npm run test --workspace @bird-watch/frontend -- adaptive-grid.test --run -t "threads per-family" 2>&1 | tail -10`

Expected: FAIL — `species` is undefined on the returned tiles.

- [ ] **Step 4: Update `buildAdaptiveTiles` body**

Replace the `buildAdaptiveTiles` body in `adaptive-grid.ts`:

```ts
export function buildAdaptiveTiles(
  leaves: ClusterLeafFeature[],
  silhouettesById: SilhouettesById,
  shape: ResolvedGrid,
): ReadonlyArray<AdaptiveTile> {
  const families = aggregateClusterFamilies(leaves);
  const speciesByFamily = aggregateClusterSpecies(leaves);
  const visible = families.slice(0, visibleCapacity(shape));
  return visible.map((fam): AdaptiveTile => {
    const species = speciesByFamily.get(fam.familyCode) ?? [];
    if (silhouettesById.size === 0) {
      return { kind: 'pending', familyCode: fam.familyCode, count: fam.count, species };
    }
    const silhouette = silhouettesById.get(fam.familyCode);
    if (!silhouette || silhouette.svgData === null) {
      return {
        kind: 'fallback',
        familyCode: fam.familyCode,
        color: silhouette?.color ?? '#888888',
        count: fam.count,
        species,
      };
    }
    return {
      kind: 'rendered',
      familyCode: fam.familyCode,
      svgData: silhouette.svgData,
      color: silhouette.color,
      count: fam.count,
      species,
    };
  });
}
```

- [ ] **Step 5: Run — expect GREEN**

Run: `npm run test --workspace @bird-watch/frontend -- adaptive-grid.test --run 2>&1 | tail -10`

Expected: all tests PASS (the new test + the 9 from Task 3 + everything pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/map/adaptive-grid.ts \
        frontend/src/components/map/adaptive-grid.test.ts
git commit -m "feat(map): thread per-species data through buildAdaptiveTiles (#557)

Tile builder now reads aggregateClusterSpecies output and attaches
the family-scoped slice to each tile's species field. Count invariant
asserted in test (sum(species[].count) === tile.count)."
```

---

## Task 9: Add `speciesCode` to `observationsToGeoJson` source pipeline

**Files:**
- Modify: `frontend/src/components/map/observation-layers.ts:107-117` (per-feature properties block)
- Modify: `frontend/src/components/map/observation-layers.test.ts` (add assertion)

- [ ] **Step 1: Read the existing function**

Read `frontend/src/components/map/observation-layers.ts` lines 80-130. Find the `observationsToGeoJson` function and locate the `properties` block (around lines 107-117).

- [ ] **Step 2: Add `speciesCode` to the properties block**

Edit the properties block — add `speciesCode: o.speciesCode ?? null,` near `comName`:

```ts
properties: {
  subId: o.subId,
  comName: o.comName,
  locName: o.locName,
  obsDt: o.obsDt,
  howMany: o.howMany,
  isNotable: o.isNotable,
  familyCode: o.familyCode ?? null,
  // NEW (issue #557):
  speciesCode: o.speciesCode ?? null,
  silhouetteId,
  color,
},
```

Also update the `ObservationFeatureCollection` TypeScript interface (in the same file) to add the field:

```ts
properties: {
  subId: string;
  comName: string;
  locName: string | null;
  obsDt: string;
  howMany: number | null;
  isNotable: boolean;
  familyCode: string | null;
  speciesCode: string | null;   // NEW
  silhouetteId: string;
  color: string;
};
```

- [ ] **Step 3: Add assertion in `observation-layers.test.ts`**

In `frontend/src/components/map/observation-layers.test.ts`, find the existing `observationsToGeoJson` test (search for `observationsToGeoJson`). Append a new test or extend an existing one with this assertion:

```ts
it('threads speciesCode through to feature properties (#557)', () => {
  const out = observationsToGeoJson(
    [
      {
        subId: 'S1', speciesCode: 'coohaw', comName: "Cooper's Hawk",
        locName: 'Tucson', obsDt: '2026-05-15', howMany: 1, isNotable: false,
        familyCode: 'accipitridae', silhouetteId: 'accipitridae',
        lng: -110, lat: 32,
      } as Observation,
    ],
    [],
  );
  expect(out.features[0]?.properties.speciesCode).toBe('coohaw');
});
```

- [ ] **Step 4: Run + build**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- observation-layers.test --run 2>&1 | tail -10
npm run build --workspace @bird-watch/frontend 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/observation-layers.ts \
        frontend/src/components/map/observation-layers.test.ts
git commit -m "feat(map): thread speciesCode through observationsToGeoJson (#557)"
```

---

## Task 10: Full test suite + build sanity

**Files:** None.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm run test --workspace @bird-watch/frontend 2>&1 | tail -10`

Expected: all tests PASS. Note the count — should be `765 + ~10 new = ~775`.

- [ ] **Step 2: Build clean**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -10`

Expected: `✓ built in ...` with no errors.

- [ ] **Step 3: Knip clean**

Run: `npm run knip --workspace @bird-watch/frontend 2>&1 | tail -10` (if `knip` script exists; otherwise skip)

Expected: no new findings introduced. Existing knip allow-list ignored.

---

## Task 11: Playwright MCP regression smoke

Phase 0 doesn't add visible UI but it does change the cluster GeoJSON property set. Verify no regression on bird-maps.com data: dev server up, navigate, check console, screenshot.

**Files:** None (smoke only).

- [ ] **Step 1: Start dev server**

Run:
```bash
npm run dev --workspace @bird-watch/frontend > /tmp/phase0-dev.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5173/
```

Expected: `http 200`. Confirm the dev server is up.

- [ ] **Step 2: Navigate Playwright MCP to localhost:5173 at 1440×900**

Via `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5173/`.
Via `mcp__plugin_playwright_playwright__browser_resize` → `{width: 1440, height: 900}`.

Wait for `"Bird Maps"` heading to appear via `browser_wait_for`.

- [ ] **Step 3: Verify zero console errors / warnings**

Via `mcp__plugin_playwright_playwright__browser_console_messages`.

Expected: empty array (no console errors / warnings). If non-empty, STOP — Phase 0 has introduced a regression. Investigate before committing.

- [ ] **Step 4: Verify markers still render**

Via `mcp__plugin_playwright_playwright__browser_evaluate`:

```js
() => {
  const grids = document.querySelectorAll('[data-testid="adaptive-grid-marker"]').length;
  const pills = document.querySelectorAll('.cluster-pill').length;
  const sils = document.querySelectorAll('[data-testid="displaced-silhouette"]').length;
  return { grids, pills, sils, total: grids + pills + sils };
}
```

Expected: `total > 0` (some non-zero count of markers visible — depends on data freshness; current baseline is ~45-50 markers at default zoom).

- [ ] **Step 5: Capture confirmation screenshot**

Via `mcp__plugin_playwright_playwright__browser_take_screenshot` → save to `/tmp/phase0-regression-1440x900.png`.

- [ ] **Step 6: Stop dev server**

Run: `kill $(lsof -ti :5173)`.

---

## Task 12: Open PR + dispatch bot review + queue

**Files:** None.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/cell-popover-phase-0`

- [ ] **Step 2: Open the PR via gh CLI**

Use the `pr-workflow` skill's flow. Body MUST follow `.github/PULL_REQUEST_TEMPLATE.md`. Title: `feat(map): cell-popover phase 0 — data layer (#557)`.

Body should include:
- **Diagrams**: Mermaid sequence diagram showing `Observation → observationsToGeoJson → ClusterLeafFeature → aggregateClusterSpecies → AdaptiveTile.species`
- **Summary**: 1-2 bullets pointing at the spec sections (§4.1, §4.2, §4.3) and the issue (#557)
- **Screenshots**: marked `N/A — not UI` (Phase 0 is data-layer-only; the parent CLAUDE.md exemption applies)
- **Test plan**: checkboxes for `npm run typecheck && npm run test`, new tests, `npm run build`, Playwright MCP regression smoke
- **Plan reference**: link to this plan + issue #557

- [ ] **Step 3: Dispatch the `julianken-bot` review subagent**

Per the `pr-workflow` skill. Reviewer model: **sonnet** (cross-tier discipline — implementer was opus via SDD; reviewer must be lower tier per epic #556 body).

- [ ] **Step 4: Resolve bot findings if any**

If REVISE: dispatch a subagent fix per the SDD loop, re-review.

- [ ] **Step 5: After APPROVE, post `@Mergifyio queue`**

Literal-string body — no prose. Per `mergify-merge-workflow` skill.

- [ ] **Step 6: Wait for merge**

Background-watch the PR state until merged. Then close issue #557 (via the `closes #557` line in the PR body, auto-closes on merge).

---

## Self-review

**Spec coverage check**: §4.1 (data shape: ✓ Task 5), §4.2 (aggregator: ✓ Task 3+4), §4.3 (tile builder: ✓ Task 8), §4.11 (spuh/slash: ✓ Task 3 tests). All Phase 0 spec sections have at least one task. ✓

**Placeholder scan**:
```bash
grep -nE "TBD|TODO|XXX|placeholder text|TODO\(|todo\(|implement later" docs/plans/2026-05-15-cell-species-popover-phase-0.md
```
Expected: no matches. ✓

**Type consistency check**: `SpeciesAggregate` exported from `adaptive-grid.ts` (Task 3) and consumed verbatim in `adaptive-grid.test.ts` (Task 3), `AdaptiveGridMarker.test.tsx` (Task 7). `ReadonlyArray<SpeciesAggregate>` appears on every tile variant (Task 5) and in helper signatures (Task 7). ✓

**className grep** (project CSS sub-task gate):
```bash
grep -n "className" docs/plans/2026-05-15-cell-species-popover-phase-0.md | grep -v "grep\|CSS rules\|Step N:"
```
Expected: no matches. Phase 0 introduces no new className. ✓

**Quantified-literals manifest filled**: ✓ (top of plan, 12 entries).

**Multi-viewport design-review gate**: explicitly marked N/A for Phase 0 (no visible UI). ✓
