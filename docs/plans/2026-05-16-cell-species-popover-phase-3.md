# Cell Species Popover — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the cell-species-popover epic (#556) by (1) wiring a `bbox` URL state param + client-side `<SpeciesDetailSurface>` filter so species-row clicks scope the detail view to the source cluster's geographic footprint, (2) atomically flipping `VITE_FF_CELL_POPOVER` default ON and **deleting** the flag + all runtime conditionals in the same PR (matches PR #546's `VITE_FF_ADAPTIVE_GRID` precedent), (3) amending the parent spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2 to reverse the "per-cell tap targets are a non-goal" line for `pointer:fine`, and (4) shipping the comprehensive Playwright e2e spec from `docs/specs/2026-05-15-cell-species-popover-design.md` §7.3.

**Architecture:** A lazy + `WeakMap`-cached `getClusterBbox(group)` helper is added to `frontend/src/components/map/deconflict.ts` (the same file that owns `DeconflictGroup`). `MapCanvas`'s `onSelectSpecies` wire-down to `<AdaptiveGridMarker>` calls the helper at click time and adds `bbox` to the URL state — so the popover components (`<CellPopover>`, `<ClusterListPopover>`) keep their existing single-arg `onSelectSpecies(code: string)` signature; bbox is added by the layer that has the cluster identity (`MapCanvas`), not the popover layer. `App.tsx`'s existing `onSelectSpecies` (used by feed / species-list / popover-less surfaces) clears stale bbox by passing `bbox: null` explicitly — satisfying spec §4.9's "cross-surface clear" invariant. The flag flip in this PR is **deletion-shaped**: `frontend/src/feature-flags.ts` + `frontend/src/feature-flags.test.ts` are removed, every `isCellPopoverEnabled()` call is deleted (keeping the gated code path as the new default), `.env.example` flips `=false → =true` with a "remove this entry after 2026-08-16" comment matching the `VITE_FF_ADAPTIVE_GRID` cleanup pattern, and the `vite-env.d.ts` declaration is removed.

**Tech Stack:** TypeScript strict · React 19 · Vitest 3.x · `@testing-library/react` 16.x · `@playwright/test` 1.49.x · MapLibre-GL 5.x · existing `@bird-watch/shared-types`. **No new runtime dependencies.** (Smart-flip positioning for `<CellHoverPreview>` / `<CellPopover>` at viewport edges — Floating-UI per spec §9.5 recommendation — is **out of Phase 3 scope** and tracked as a follow-up; current positioning works at the 5 canonical viewports and the flag-flip surface area does not warrant a new dep in the cleanup PR.)

**Issue:** #560 (subissue 4 of 4 in epic #556).
**Spec:** `docs/specs/2026-05-15-cell-species-popover-design.md` §4.9 (bbox routing + cross-surface invariant), §5.4 (`SpeciesDetailSurface` bbox prop), §6 (file map line items in Phase 3 row), §7.3 (full e2e scenarios), §10 (atomic flag-flip framing).
**Depends on:** Phase 2 (PR #564, squash-merged at `dcc84eb`). Phase 0/1/2's data threading + components are the substrate; Phase 3 does NOT modify `<CellHoverPreview>`, `<CellPopover>`, or `<ClusterListPopover>` component internals — only the layer that wires their `onSelectSpecies` callbacks.

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] **1 new field on `UrlState`**: `bbox: BBox | null` (where `BBox = [number, number, number, number]` — `[lngMin, latMin, lngMax, latMax]`).
- [ ] **Bbox URL encoding**: 4 numbers comma-separated, each rounded to 6 decimals (~11 cm). Invalid input (3 or 5 numbers; non-finite; lng outside `[-180, 180]` or lat outside `[-90, 90]`) parses to `null` — defensive against malformed shared URLs.
- [ ] **1 new helper**: `getClusterBbox(group: DeconflictGroup): BBox` in `frontend/src/components/map/deconflict.ts`, backed by a module-scoped `WeakMap<DeconflictGroup, BBox>` cache. Lazy: computes on first call per group; returns cached value on subsequent calls within the same group's lifetime.
- [ ] **~9 unit tests for `getClusterBbox`**: returns correct min/max from leaves; single-leaf returns degenerate `[lng, lat, lng, lat]`; 6-decimal rounding applied; same group queried twice returns reference-equal arrays (cache hit); two different groups with identical leaves return separate arrays (cache scoped per group); empty leaves throws or returns a sentinel (decide in TDD — recommend throw, since empty cluster shouldn't reach this code path); ordering of leaves doesn't affect result; leaves spanning the antimeridian still produce a finite bbox; lat/lng order in the tuple is `[lngMin, latMin, lngMax, latMax]` (matches the URL serialization order, NOT the swap-prone `[lat, lng]` convention).
- [ ] **~8 unit tests for url-state bbox**: read `?bbox=` parses 4 comma-separated 6-decimal numbers; emits `?bbox=` when non-null; clears `?bbox=` when null; rounds emitted values to 6 decimals (input `34.1234567` → `34.123457`); rejects 3-number input as `null`; rejects 5-number input as `null`; rejects non-finite numbers as `null`; rejects out-of-range lng/lat as `null`.
- [ ] **~6 unit tests for `<SpeciesDetailSurface>` bbox prop**: without `bbox` prop → renders all observations for the species (unchanged behavior); with `bbox` prop → filters observations to those inside the bbox (lng/lat inclusive on min, inclusive on max); banner renders when `bbox` prop present + `bbox-filtered` aria-region label; banner absent when `bbox` is `null`/undefined; banner "View all observations" link calls `onClearBbox` once; clicking the banner does NOT clear other URL state (species code, view).
- [ ] **~3 unit tests for `App.tsx` `onSelectSpecies`**: the existing (non-popover) call clears stale bbox via `set({ ..., bbox: null })`; the new (popover-originated) wire in `MapCanvas` sets bbox via `getClusterBbox(group)`; toggling cross-surface navigation (feed → detail with bbox; detail → feed; feed → detail without bbox) leaves no stale bbox in the URL.
- [ ] **Atomic flag-flip deletion**: delete `frontend/src/feature-flags.ts`, `frontend/src/feature-flags.test.ts`, the `VITE_FF_CELL_POPOVER` declaration in `frontend/src/vite-env.d.ts`, and the 2 call sites of `isCellPopoverEnabled()` (`frontend/src/components/map/AdaptiveGridMarker.tsx:137` + `frontend/src/components/MapSurface.tsx:202`). Each call-site deletion KEEPS the gated code path as the new default.
- [ ] **`.env.example` flip**: `VITE_FF_CELL_POPOVER=false` → `=true` (or remove the entry entirely per the `VITE_FF_ADAPTIVE_GRID` precedent at lines 16–18 of the same file). Decision: **remove the entry** in this PR (matches `VITE_FF_ADAPTIVE_GRID`'s "Remove this flag after [date]" comment pattern — except we go straight to deletion since the deletion is happening in the same PR).
- [ ] **Playwright config flag-prefix removal**: `frontend/playwright.config.ts:80` webServer command `VITE_FF_CELL_POPOVER=true npm run dev` → `npm run dev` (the flag is gone; the webServer no longer needs to set it).
- [ ] **Parent-spec amend**: 1 paragraph edit in `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2 — strike the "per-cell tap targets are explicitly a non-goal" line and replace with the new dual-mode framing (`pointer:fine` gets per-cell tap targets; `pointer:coarse` preserves the original non-goal via cluster-list popover). Add a 2-line cross-reference to `docs/specs/2026-05-15-cell-species-popover-design.md`.
- [ ] **1 e2e spec extension**: rewrite `frontend/e2e/map-cell-popover.spec.ts` from its current Phase 2 trimmed form (1 `@coarse` test) to 6 scenarios per spec §7.3: desktop hover→preview→click→popover→species→bbox-URL (1440×900); desktop keyboard skip-link→cell→preview→Enter→popover→ESC→focus-return (1440×900); tablet tap→cluster-list→species→bbox-URL (`@coarse`, 768×1024); mobile tap→cluster-list→expand-family→species→`<SpeciesDetailSurface>` filtered (`@coarse`, 390×844 — emulated under the same `coarse-pointer` project); banner "View all observations" clears bbox URL param; cross-surface stale-bbox-clear (navigate feed → detail; URL must not retain prior `?bbox=`).
- [ ] **10 design-review screenshots** (5 viewports × 2 themes) captured via Playwright MCP — focus is the `<SpeciesDetailSurface>` banner state (new in this PR) AND the default flag-ON map markers (no longer behind a flag).
- [ ] **Zero console errors and zero console warnings** at each of the 5 canonical viewports.
- [ ] **All 850 tests still pass with the flag removed** (`npm run test --workspace @bird-watch/frontend` exits 0; the 4 feature-flag-mock tests are removed alongside `feature-flags.ts`, replaced by the new bbox/url-state/SpeciesDetailSurface tests — net test count should land in the 860–870 range).
- [ ] **`npm run build --workspace @bird-watch/frontend`** clean (no new TS errors; no dangling references to `feature-flags.js` after deletion).
- [ ] **Knip clean** — no new findings introduced; the deleted `feature-flags.ts` should NOT leave orphan imports anywhere.
- [ ] **Orphan-classname check clean** — every new className introduced (banner — `.species-detail-bbox-banner` + 1–2 children) matched to a CSS selector in `frontend/src/components/ds/ds-primitives.css`.
- [ ] **`coarse-pointer` Playwright project still picks up `@coarse`-tagged specs** — no project-config regression (the chromium pin + iPad-gen-6 device profile from Phase 2 stay).
- [ ] **Parent-spec amend reviewed as part of the PR** — bot's R-13 rubric will flag spec-drift if the cross-reference is missing.

## File map

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/state/url-state.ts` | Modify | Add `bbox: BBox | null` field to `UrlState`; read `?bbox=` (4 comma-sep 6-decimal numbers); emit `?bbox=` when non-null; validate input (reject 3/5-number, non-finite, out-of-range) |
| `frontend/src/state/url-state.test.ts` | Modify | +8 tests for bbox read/emit/validate/round |
| `frontend/src/components/map/deconflict.ts` | Modify | Add `getClusterBbox(group: DeconflictGroup): BBox` + module-scoped `WeakMap<DeconflictGroup, BBox>` cache |
| `frontend/src/components/map/deconflict.test.ts` | Modify | +9 tests for `getClusterBbox` (or NEW `deconflict-bbox.test.ts` if file is large) |
| `frontend/src/components/MapCanvas.tsx` OR `frontend/src/components/MapSurface.tsx` | Modify | (locate during Task 1 reconnaissance) — wire `<AdaptiveGridMarker onSelectSpecies>` to call `set({ detail, view, bbox: getClusterBbox(group) })` instead of the bare `(code) => set({ detail, view })` |
| `frontend/src/App.tsx` | Modify | Existing `onSelectSpecies` callback at line ~218 → add `bbox: null` to the `set()` arg so cross-surface navigation clears stale bbox |
| `frontend/src/components/SpeciesDetailSurface.tsx` | Modify | Accept optional `bbox: BBox \| null` prop; client-side filter observations by bbox when present; render `.species-detail-bbox-banner` above the body with "View all observations" link calling `onClearBbox` prop |
| `frontend/src/components/SpeciesDetailSurface.test.tsx` | Modify | +6 tests for bbox filter + banner render + onClearBbox plumbing |
| `frontend/src/components/ds/ds-primitives.css` | Modify | Add `.species-detail-bbox-banner` + children rules (light + dark + reduced-motion + forced-colors) |
| `frontend/src/feature-flags.ts` | **DELETE** | Flag gone; the module's only export (`isCellPopoverEnabled`) is no longer called |
| `frontend/src/feature-flags.test.ts` | **DELETE** | Tests gone with the module |
| `frontend/src/vite-env.d.ts` | Modify | Remove `readonly VITE_FF_CELL_POPOVER?: string` from the env interface |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Modify | Delete `isCellPopoverEnabled()` import + call at line 137; delete `flag &&` guard from `perCellInteractive` and `clusterListInteractive`; the gated code path is now the default |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | Modify | Remove the 2 flag-OFF regression tests (they're no longer reachable); keep flag-ON behavior as the new default |
| `frontend/src/components/MapSurface.tsx` | Modify | Delete `isCellPopoverEnabled()` import + call at line 202; the skip-link is now unconditional (subject to `onExploreMapMarkers` being provided) |
| `frontend/src/components/MapSurface.test.tsx` | Modify | Remove the flag-OFF test; keep flag-ON behavior |
| `frontend/playwright.config.ts` | Modify | webServer line 80: drop `VITE_FF_CELL_POPOVER=true` prefix (the flag is gone, default behavior matches) |
| `.env.example` | Modify | Remove the `VITE_FF_CELL_POPOVER` block (lines ~20–25 currently) entirely — flag is gone |
| `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` | Modify | §2 amend: strike "per-cell tap targets are non-goal" → replace with dual-mode framing; add cross-reference to `2026-05-15-cell-species-popover-design.md` |
| `frontend/e2e/map-cell-popover.spec.ts` | Modify | Expand 1 `@coarse` test → 6 scenarios per spec §7.3 |

**CSS sub-task gate (per project writing-plans extension):** This plan ADDS 1 new styled element family (the bbox banner). Every new className introduced — `species-detail-bbox-banner`, `species-detail-bbox-banner__text`, `species-detail-bbox-banner__link` — is pinned to a CSS rule inside Task 9 (CSS rules for the bbox banner).

**Multi-viewport design-review gate (per project writing-plans extension):** Task 14 drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes (10 screenshots minimum), confirms zero console errors/warnings at each, and feeds the screenshot URLs into the PR body. Task 15 dispatches a `ui-design:ui-designer` subagent with `model: "opus"` for the design review pass.

---

## Task 1: Confirm worktree state and Phase 2 invariants

**Files:** None (verification only).

- [ ] **Step 1: Verify the worktree is at HEAD = Phase 2 merge**

Run:

```bash
git rev-parse HEAD
git log --oneline -3
```

Expected:
- HEAD matches `origin/main` after Phase 2 merge.
- Top 3 commits include `feat(map): cell-popover phase 2 — mobile cluster list popover (#559) (#564)` as #1 (squash-merge of PR #564).

If HEAD doesn't match, the worktree needs `git fetch origin main && git reset --hard origin/main` (only safe in a fresh worktree with no local commits).

- [ ] **Step 2: Confirm baseline test count = 850**

Run:

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -3
```

Expected: `Tests  850 passed (850)`. This is the Phase 2 post-merge baseline. Phase 3's deletions (feature-flag tests) MINUS additions (bbox + url-state + SpeciesDetailSurface) should land in the 860–870 range.

- [ ] **Step 3: Confirm build is clean at HEAD**

Run:

```bash
npm run build --workspace @bird-watch/frontend 2>&1 | tail -3
```

Expected: clean build, no TS errors. One pre-existing chunk-size warning for the maplibre-gl bundle is acceptable.

- [ ] **Step 4: Locate the `onSelectSpecies` wire in `MapCanvas` / `MapSurface`**

The plan's later tasks need to know which component owns the cluster→popover wire and where `getClusterBbox(group)` should plug in. The Phase 0–2 work threaded `onSelectSpecies` through `<AdaptiveGridMarker>` from above; this step pins the exact line.

Run:

```bash
grep -rEn "onSelectSpecies" frontend/src/components/ --include="*.tsx" | grep -v "test\." | grep -v "\.spec\." | head -20
```

Expected: one or more lines in `MapCanvas.tsx` OR `MapSurface.tsx` showing where `<AdaptiveGridMarker>` is rendered with an `onSelectSpecies` prop. Note the line and exact arrow-function shape — Task 5 amends it.

Also grep for the cluster identity passed to `<AdaptiveGridMarker>`:

```bash
grep -rEn "AdaptiveGridMarker" frontend/src/components/ --include="*.tsx" | grep -v "test\." | head -20
```

Expected: shows the JSX where `<AdaptiveGridMarker>` is mounted with `tiles`, `point_count`, etc. The cluster's `DeconflictGroup` should be accessible at the same scope (or derivable from the props being passed).

- [ ] **Step 5: Commit a sentinel marker for the SDD task chain**

```bash
git commit --allow-empty -m "plan(3): cell species popover phase 3 — bbox URL + SpeciesDetailSurface + atomic flag flip (#560)

15 tasks covering Phase 3 of the cell-species-popover epic (#556):
- bbox URL state param (read/emit/round/validate)
- getClusterBbox(group) lazy + WeakMap-cached helper
- <SpeciesDetailSurface> bbox prop + client-side filter + 'View all
  observations' banner
- App.tsx onSelectSpecies bbox-clear invariant
- MapCanvas/MapSurface onSelectSpecies wire adds bbox via
  getClusterBbox(group)
- Atomic flag-flip cleanup: delete feature-flags.ts + .test.ts,
  delete VITE_FF_CELL_POPOVER from .env.example + vite-env.d.ts +
  playwright.config.ts webServer prefix, delete the 2
  isCellPopoverEnabled() call sites
- Parent-spec amend (2026-05-14-adaptive-cluster-grid-design.md §2)
- 6 e2e scenarios per spec §7.3
- 10 design-review screenshots (5 viewports × 2 themes)
- julianken-bot opus review + Mergify queue

Baseline = 850 tests at dcc84eb (Phase 2 merge). Target after plan =
860–870 (4 feature-flag tests removed; ~25 new tests across url-state,
deconflict, SpeciesDetailSurface, App). Closes #560 + epic #556."
```

This empty commit anchors the plan in the branch history; PR title will reference it.

---

## Task 2: Add `bbox` field to `UrlState` (RED → GREEN)

**Files:**
- Modify: `frontend/src/state/url-state.ts` (extend interface + read + emit)
- Modify: `frontend/src/state/url-state.test.ts` (+8 tests)

- [ ] **Step 1: Write 8 failing tests in `url-state.test.ts`**

Add a new `describe` block at the bottom of the file:

```typescript
describe('bbox URL state (Phase 3, #560)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('reads ?bbox=lngMin,latMin,lngMax,latMax as a 4-tuple', () => {
    window.history.replaceState({}, '', '/?bbox=-111.0,31.6,-110.2,33.5');
    const state = readUrl();
    expect(state.bbox).toEqual([-111.0, 31.6, -110.2, 33.5]);
  });

  it('rounds bbox values to 6 decimals on read', () => {
    window.history.replaceState({}, '', '/?bbox=-111.1234567,31.6,-110.2,33.5');
    const state = readUrl();
    // -111.1234567 rounds to -111.123457 (banker's rounding not required —
    // standard Math.round produces -111.123457 for this input).
    expect(state.bbox?.[0]).toBe(-111.123457);
  });

  it('emits ?bbox= when state.bbox is non-null', () => {
    set({ bbox: [-111.0, 31.6, -110.2, 33.5] });
    expect(window.location.search).toContain('bbox=-111%2C31.6%2C-110.2%2C33.5');
    // Decoded: ?bbox=-111,31.6,-110.2,33.5
  });

  it('clears ?bbox= when state.bbox is set to null', () => {
    window.history.replaceState({}, '', '/?bbox=-111.0,31.6,-110.2,33.5');
    set({ bbox: null });
    expect(window.location.search).not.toContain('bbox=');
  });

  it('rejects 3-number input as null (defensive against malformed URLs)', () => {
    window.history.replaceState({}, '', '/?bbox=-111.0,31.6,-110.2');
    expect(readUrl().bbox).toBe(null);
  });

  it('rejects 5-number input as null', () => {
    window.history.replaceState({}, '', '/?bbox=-111.0,31.6,-110.2,33.5,99.9');
    expect(readUrl().bbox).toBe(null);
  });

  it('rejects non-finite numbers as null', () => {
    window.history.replaceState({}, '', '/?bbox=NaN,31.6,-110.2,33.5');
    expect(readUrl().bbox).toBe(null);
  });

  it('rejects out-of-range lng/lat as null', () => {
    window.history.replaceState({}, '', '/?bbox=-200,31.6,-110.2,33.5');
    expect(readUrl().bbox).toBe(null);
    window.history.replaceState({}, '', '/?bbox=-111.0,99.6,-110.2,33.5');
    expect(readUrl().bbox).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests; confirm 8 failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/state/url-state.test.ts 2>&1 | tail -20
```

Expected: 8 NEW failing tests in the "bbox URL state" describe block. Pre-existing tests still pass.

- [ ] **Step 3: Extend `UrlState` interface + parser + emitter in `url-state.ts`**

Add the type and default:

```typescript
// Above the UrlState interface, near the existing Since/View exports:
export type BBox = readonly [number, number, number, number];

// Inside UrlState interface, after `detail: string | null`:
  bbox: BBox | null;
```

Add to DEFAULTS:

```typescript
const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'map',
  detail: null,
  bbox: null, // Phase 3 (#560) — Cluster→SpeciesDetailSurface bbox filter
};
```

Add the read logic. Inside `readUrl()`, after the existing detail-sniffing block, before the return statement:

```typescript
  // Phase 3 (#560) — bbox URL state for cluster→SpeciesDetailSurface filter.
  // Format: ?bbox=lngMin,latMin,lngMax,latMax (4 comma-separated, 6 decimals).
  // Defensive parsing: reject any malformed input as null so a corrupted
  // shared URL doesn't break rendering. Range checks: lng ∈ [-180, 180],
  // lat ∈ [-90, 90]. NaN/Infinity are rejected.
  let bbox: BBox | null = null;
  const rawBbox = p.get('bbox');
  if (rawBbox !== null) {
    const parts = rawBbox.split(',').map(Number);
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n)) &&
      parts[0] >= -180 && parts[0] <= 180 &&
      parts[2] >= -180 && parts[2] <= 180 &&
      parts[1] >= -90 && parts[1] <= 90 &&
      parts[3] >= -90 && parts[3] <= 90
    ) {
      // Round each to 6 decimals on read so downstream comparisons are stable.
      bbox = [
        round6(parts[0]),
        round6(parts[1]),
        round6(parts[2]),
        round6(parts[3]),
      ] as const;
    }
  }
```

Add `round6` helper near the top of the file (above `readUrl`):

```typescript
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
```

Update the return value of `readUrl()` to include `bbox`.

Add the emit logic. Inside `writeUrl()` (or wherever the existing `URLSearchParams` is built), after the existing detail emit:

```typescript
  if (state.bbox !== null) {
    const [lngMin, latMin, lngMax, latMax] = state.bbox.map(round6);
    p.set('bbox', `${lngMin},${latMin},${lngMax},${latMax}`);
  } else {
    p.delete('bbox');
  }
```

Wire `bbox` into the `set()` partial-update merge so `set({ bbox: ... })` works. The existing `set` function should already do shallow-merge over UrlState; just verify by adding bbox-related calls in the test file pass.

- [ ] **Step 4: Run tests; confirm 8 pass**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/state/url-state.test.ts 2>&1 | tail -10
```

Expected: all url-state tests pass (existing N + 8 new).

- [ ] **Step 5: Run the full test suite — no regression**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 858 passed (850 baseline + 8 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/state/url-state.ts frontend/src/state/url-state.test.ts
git commit -m "feat(state): add bbox URL param to UrlState (#560)

Phase 3 of cell-species-popover (#556). Adds a BBox tuple field to
UrlState that's read/emitted as ?bbox=lngMin,latMin,lngMax,latMax with
6-decimal rounding (~11 cm precision per spec §9). Defensive parsing
rejects malformed input (wrong arity, non-finite, out-of-range lng/lat)
to null so a corrupted shared URL doesn't break rendering.

8 new tests pin the read/emit/round/validate/clear contracts."
```

---

## Task 3: Add `getClusterBbox(group)` helper with `WeakMap` cache (RED → GREEN)

**Files:**
- Modify: `frontend/src/components/map/deconflict.ts` (add helper + cache)
- Modify: `frontend/src/components/map/deconflict.test.ts` (+9 tests) OR create `deconflict-bbox.test.ts` if `deconflict.test.ts` is already large

- [ ] **Step 1: Inspect `deconflict.ts` for the `DeconflictGroup` shape**

```bash
grep -nE "export (interface|type) DeconflictGroup" frontend/src/components/map/deconflict.ts
sed -n '100,130p' frontend/src/components/map/deconflict.ts  # adjust line range as needed
```

Note the `DeconflictGroup` interface — specifically the `leaves` field (or equivalent — the source of lng/lat data). Adjust the bbox helper to use the actual field name.

- [ ] **Step 2: Write 9 failing tests**

Append to `deconflict.test.ts` (or create `deconflict-bbox.test.ts` co-located):

```typescript
import { describe, it, expect } from 'vitest';
import { getClusterBbox } from './deconflict.js';
import type { DeconflictGroup } from './deconflict.js';

function makeGroup(leaves: Array<{ lng: number; lat: number }>): DeconflictGroup {
  // Construct a minimal DeconflictGroup test fixture. Adjust shape per
  // the real interface — only `leaves` (or equivalent) must be correct.
  return { /* ... */ leaves } as unknown as DeconflictGroup;
}

describe('getClusterBbox (Phase 3, #560)', () => {
  it('returns correct [lngMin, latMin, lngMax, latMax] for 3 leaves', () => {
    const group = makeGroup([
      { lng: -110.88, lat: 31.73 },
      { lng: -110.85, lat: 31.71 },
      { lng: -110.87, lat: 31.75 },
    ]);
    const bbox = getClusterBbox(group);
    expect(bbox).toEqual([-110.88, 31.71, -110.85, 31.75]);
  });

  it('returns degenerate bbox for a single leaf', () => {
    const group = makeGroup([{ lng: -110.88, lat: 31.73 }]);
    expect(getClusterBbox(group)).toEqual([-110.88, 31.73, -110.88, 31.73]);
  });

  it('rounds each coordinate to 6 decimals', () => {
    const group = makeGroup([
      { lng: -110.1234567, lat: 31.7345678 },
      { lng: -110.0987654, lat: 31.7456789 },
    ]);
    const bbox = getClusterBbox(group);
    expect(bbox).toEqual([-110.123457, 31.734568, -110.098765, 31.745679]);
  });

  it('caches the result — same group queried twice returns reference-equal arrays', () => {
    const group = makeGroup([{ lng: -110.88, lat: 31.73 }, { lng: -110.85, lat: 31.71 }]);
    const a = getClusterBbox(group);
    const b = getClusterBbox(group);
    expect(a).toBe(b); // reference equality, proving cache hit
  });

  it('caches per group — two groups with identical leaves return separate arrays', () => {
    const leaves = [{ lng: -110.88, lat: 31.73 }, { lng: -110.85, lat: 31.71 }];
    const g1 = makeGroup(leaves);
    const g2 = makeGroup([...leaves]);
    expect(getClusterBbox(g1)).not.toBe(getClusterBbox(g2));
  });

  it('handles arbitrary leaf order — result is sort-independent', () => {
    const a = getClusterBbox(makeGroup([
      { lng: -110.88, lat: 31.73 },
      { lng: -110.85, lat: 31.71 },
      { lng: -110.87, lat: 31.75 },
    ]));
    const b = getClusterBbox(makeGroup([
      { lng: -110.87, lat: 31.75 },
      { lng: -110.85, lat: 31.71 },
      { lng: -110.88, lat: 31.73 },
    ]));
    expect(a).toEqual(b);
  });

  it('handles leaves spanning the antimeridian without wrapping', () => {
    // Antimeridian: lng = ±180. A cluster straddling the antimeridian
    // is rare in Arizona but the function should still produce a
    // mathematically finite bbox; downstream filter logic decides whether
    // to interpret it as a wrap.
    const bbox = getClusterBbox(makeGroup([
      { lng: 179.9, lat: 0 },
      { lng: -179.9, lat: 0 },
    ]));
    expect(bbox).toEqual([-179.9, 0, 179.9, 0]);
  });

  it('tuple order is [lngMin, latMin, lngMax, latMax] — NOT swap-prone [lat, lng]', () => {
    const bbox = getClusterBbox(makeGroup([
      { lng: -110.88, lat: 31.73 },
      { lng: -110.85, lat: 31.71 },
    ]));
    expect(bbox[0]).toBeLessThan(bbox[2]); // lngMin < lngMax
    expect(bbox[1]).toBeLessThan(bbox[3]); // latMin < latMax
    expect(Math.abs(bbox[0])).toBeGreaterThan(100); // lng range
    expect(Math.abs(bbox[1])).toBeLessThan(50); // lat range
  });

  it('throws on empty leaves (defensive — empty cluster should never reach this code path)', () => {
    expect(() => getClusterBbox(makeGroup([]))).toThrow(/empty/i);
  });
});
```

- [ ] **Step 3: Run; confirm 9 failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/components/map/deconflict 2>&1 | tail -15
```

Expected: 9 new failures.

- [ ] **Step 4: Implement `getClusterBbox` in `deconflict.ts`**

Add to the file (find a logical spot near the existing exports):

```typescript
import type { BBox } from '../../state/url-state.js';

// Module-scoped cache — WeakMap entries auto-clear when the DeconflictGroup
// is garbage-collected (i.e., when the cluster is unmounted). No manual
// invalidation needed.
const bboxCache = new WeakMap<DeconflictGroup, BBox>();

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/**
 * Compute the geographic bounding box of a `DeconflictGroup`'s leaves.
 * Lazy + WeakMap-cached: first call per group computes; subsequent calls
 * return the cached tuple. The cache is per-group identity (not leaf
 * shape) — two groups with structurally-identical leaves get separate
 * cache entries. This is intentional: cache scope matches the group's
 * lifetime in the cluster layer.
 *
 * Output format: `[lngMin, latMin, lngMax, latMax]` — matches the URL
 * serialization order. Each coordinate is rounded to 6 decimals (~11 cm
 * precision) so the returned tuple matches what the URL would re-parse,
 * preserving stability across cluster→URL→re-parse round-trips.
 *
 * Phase 3 (#560) of cell-species-popover (#556); see spec §9.5
 * "Bbox compute-vs-cache strategy" — "Lazy + WeakMap-cached per
 * DeconflictGroup. Eager rejected."
 */
export function getClusterBbox(group: DeconflictGroup): BBox {
  const cached = bboxCache.get(group);
  if (cached) return cached;

  if (group.leaves.length === 0) {
    throw new Error('getClusterBbox: empty leaves (empty cluster should not reach this code path)');
  }

  let lngMin = Infinity;
  let latMin = Infinity;
  let lngMax = -Infinity;
  let latMax = -Infinity;
  for (const leaf of group.leaves) {
    if (leaf.lng < lngMin) lngMin = leaf.lng;
    if (leaf.lng > lngMax) lngMax = leaf.lng;
    if (leaf.lat < latMin) latMin = leaf.lat;
    if (leaf.lat > latMax) latMax = leaf.lat;
  }

  const bbox: BBox = [
    round6(lngMin),
    round6(latMin),
    round6(lngMax),
    round6(latMax),
  ];
  bboxCache.set(group, bbox);
  return bbox;
}
```

Note: if `DeconflictGroup.leaves` has a different shape (e.g. `Array<ClusterLeafFeature>` where each has `geometry.coordinates: [lng, lat]`), adjust the field access. Read the file before writing.

- [ ] **Step 5: Run; confirm 9 pass**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/components/map/deconflict 2>&1 | tail -10
```

Expected: 9 new tests pass.

- [ ] **Step 6: Run the full test suite — no regression**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 867 passed (858 from Task 2 + 9 new).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/map/deconflict.ts frontend/src/components/map/deconflict.test.ts
git commit -m "feat(map): add getClusterBbox(group) lazy + WeakMap-cached helper (#560)

Spec docs/specs/2026-05-15-cell-species-popover-design.md §9.5 resolves
the bbox compute-vs-cache strategy as 'Lazy + WeakMap-cached per
DeconflictGroup. Eager rejected.' This commit ships exactly that:
module-scoped WeakMap that auto-clears when the group is GC'd, lazy
compute on first call, reference-equal returns on subsequent calls.

9 new tests pin: correct min/max, single-leaf degenerate, 6-decimal
rounding, cache reference equality, per-group cache scope, sort-
independence, antimeridian-finite output, tuple order, empty-leaves
throw."
```

---

## Task 4: Wire `<AdaptiveGridMarker onSelectSpecies>` to include bbox via `getClusterBbox(group)` (RED → GREEN)

**Files:**
- Modify: (location confirmed in Task 1 Step 4 — likely `frontend/src/components/MapCanvas.tsx` OR `frontend/src/components/MapSurface.tsx`)
- Modify: corresponding test file (+~3 tests for the wire)

The implementer must read the file confirmed in Task 1 Step 4 before writing this task. The exact shape of the existing `onSelectSpecies={(code) => ...}` arrow function dictates the edit.

- [ ] **Step 1: Write failing tests for the wire**

Add to the test file for the component that owns the wire (e.g., `MapCanvas.test.tsx` if it exists, OR a new integration test):

```typescript
// Phase 3 (#560) — popover-originated onSelectSpecies attaches bbox
describe('onSelectSpecies popover-bbox wire', () => {
  it('calls set with bbox derived from getClusterBbox(group) when a species row is clicked', async () => {
    // Mount the parent component with a single AdaptiveGridMarker whose
    // tiles include a clickable species. Mock the deconflict group with
    // known leaves. Click the species row; assert set() received
    // bbox: getClusterBbox(group).
    // ...
  });

  it('does NOT call set if onSelectSpecies fires with an empty species code', async () => {
    // Defensive: a null speciesCode in the popover should be unreachable
    // (the popover renders <span> not <a> for null-code species), but
    // pin the behavior anyway.
    // ...
  });

  it('bbox matches the leaves of THIS cluster, not a neighboring cluster', async () => {
    // Render 2 markers with different leaf sets; click into the first;
    // assert bbox matches the first cluster's leaves exactly.
    // ...
  });
});
```

Fill in the test bodies based on the parent component's existing test patterns. The 3 tests above are the contract; the exact mount/click setup follows the existing patterns in the same file.

- [ ] **Step 2: Run; confirm failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run <test-file> 2>&1 | tail -10
```

Expected: 3 new failures (or however many you wrote).

- [ ] **Step 3: Implement the wire**

In the parent component, replace the existing arrow function:

```typescript
// BEFORE (Phase 2 single-arg form):
<AdaptiveGridMarker
  ...
  onSelectSpecies={onSelectSpecies}
/>

// AFTER (Phase 3 — wraps onSelectSpecies to attach bbox):
<AdaptiveGridMarker
  ...
  onSelectSpecies={(code) => {
    const bbox = getClusterBbox(group);
    onSelectSpecies(code, bbox);
  }}
/>
```

Where `group` is the `DeconflictGroup` corresponding to this marker (already accessible at the call site since `<AdaptiveGridMarker>` is rendered per-group). `onSelectSpecies` higher up the tree must be widened to accept the optional second argument (see Task 5).

- [ ] **Step 4: Run; confirm pass**

```bash
npm run test --workspace @bird-watch/frontend -- --run <test-file> 2>&1 | tail -10
```

Expected: 3 new tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 870 passed (867 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add <files>
git commit -m "feat(map): popover species-row click attaches cluster bbox (#560)

Wires the AdaptiveGridMarker.onSelectSpecies callback (used by both
<CellPopover> and <ClusterListPopover>) to compute the cluster's bbox
via getClusterBbox(group) and pass it to the parent onSelectSpecies.
The popover components themselves keep their single-arg signature —
bbox is added by the layer that has the cluster identity (the parent).

3 new tests pin the wire behavior."
```

---

## Task 5: Widen `App.tsx` `onSelectSpecies` signature + add `bbox: null` cross-surface clear (RED → GREEN)

**Files:**
- Modify: `frontend/src/App.tsx` (line ~218 — widen + clear stale bbox)
- Modify: `frontend/src/App.test.tsx` OR new integration test (+3 tests)

- [ ] **Step 1: Write 3 failing tests**

Tests pin:
1. Existing (non-popover) `onSelectSpecies(code)` call clears stale bbox by passing `bbox: null` to `set`.
2. Cross-surface navigation feed→detail with bbox already in URL → bbox cleared after the feed→detail transition.
3. Type-level: `onSelectSpecies` accepts an optional second arg `bbox: BBox`.

```typescript
describe('App.tsx onSelectSpecies bbox-clear invariant (#560)', () => {
  it('clears stale bbox when called without bbox argument', () => {
    window.history.replaceState({}, '', '/?detail=annhum&view=detail&bbox=-111,31,-110,32');
    // Mount App, trigger an action that calls onSelectSpecies('vermfly')
    // — e.g., click a feed row. Assert window.location.search no longer
    // contains 'bbox='.
    // ...
  });

  it('sets bbox when called with the second argument', () => {
    // Mount App, trigger onSelectSpecies('vermfly', [-111, 31, -110, 32]).
    // Assert URL has ?bbox=-111,31,-110,32.
    // ...
  });

  it('cross-surface navigation: feed → detail → feed does not leak bbox', () => {
    window.history.replaceState({}, '', '/?detail=annhum&view=detail&bbox=-111,31,-110,32');
    // Navigate to feed view. Click a species row → onSelectSpecies fires
    // without bbox. Assert no bbox in URL after the transition.
    // ...
  });
});
```

- [ ] **Step 2: Run; confirm 3 failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/App.test 2>&1 | tail -10
```

Expected: 3 new failures.

- [ ] **Step 3: Update `App.tsx` `onSelectSpecies` callback**

In `frontend/src/App.tsx` near line 218:

```typescript
// BEFORE:
const onSelectSpecies = useCallback(
  (speciesCode: string) => set({ detail: speciesCode, view: 'detail' }),
  [set]
);

// AFTER:
const onSelectSpecies = useCallback(
  (speciesCode: string, bbox: BBox | null = null) =>
    set({ detail: speciesCode, view: 'detail', bbox }),
  [set],
);
```

Note: the default `bbox = null` handles BOTH the feed/species-list path (no bbox passed) AND the popover path (bbox passed). The popover path already routes through `MapCanvas`'s wrapping function from Task 4, which calls `onSelectSpecies(code, getClusterBbox(group))`.

Import `BBox` from `./state/url-state.js`.

- [ ] **Step 4: Run; confirm 3 pass**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/App.test 2>&1 | tail -10
```

Expected: 3 new tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 873 passed (870 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat(app): onSelectSpecies clears stale bbox on cross-surface nav (#560)

Spec §4.9 invariant: onSelectSpecies(code) without bbox clears any
stale ?bbox= URL param. Widen the signature to (code, bbox = null)
so the existing non-popover call sites (feed, species list) explicitly
clear, and the popover wire from MapCanvas (Task 4) supplies the bbox.

3 new tests pin the cross-surface clear and the popover-path set."
```

---

## Task 6: Add `bbox` prop to `<SpeciesDetailSurface>` + client-side filter (RED → GREEN)

**Files:**
- Modify: `frontend/src/components/SpeciesDetailSurface.tsx` (prop + filter logic)
- Modify: `frontend/src/components/SpeciesDetailSurface.test.tsx` (+~4 tests, filter portion only — banner tests in Task 7)

- [ ] **Step 1: Write 4 failing tests for the filter**

```typescript
describe('SpeciesDetailSurface bbox filter (Phase 3, #560)', () => {
  it('without bbox prop, renders all observations for the species', () => {
    // Mount with bbox = null AND observations spanning multiple regions.
    // Assert all observations rendered.
  });

  it('with bbox prop, filters observations to those inside the bbox', () => {
    // Mount with bbox = [-111, 31, -110, 32] AND observations at
    // (lng -110.5, lat 31.5) [inside], (lng -109, lat 33) [outside].
    // Assert only the inside observation is rendered.
  });

  it('inclusive bounds — observations on the bbox edge are included', () => {
    // Mount with bbox = [-111, 31, -110, 32] AND an observation at
    // exactly lng -110, lat 31 (the corner). Assert it's included.
  });

  it('filter is stable across re-renders with identical bbox', () => {
    // Render twice with the same bbox; assert the filtered observations
    // are reference-equal (i.e., memo'd) so downstream list rendering
    // doesn't thrash.
  });
});
```

- [ ] **Step 2: Run; confirm 4 failures**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/components/SpeciesDetailSurface.test 2>&1 | tail -10
```

Expected: 4 new failures.

- [ ] **Step 3: Implement the bbox prop + filter in `SpeciesDetailSurface.tsx`**

Add to the prop interface:

```typescript
import type { BBox } from '../state/url-state.js';

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  // ... existing props ...
  /**
   * Optional cluster bbox to filter observations. When null/undefined,
   * the surface renders all observations for the species. When set,
   * only observations whose (lng, lat) falls inside the bbox are
   * rendered. Spec §4.9 — bbox routing from cell-popover.
   */
  bbox?: BBox | null;
  /**
   * Callback fired when the user clicks the "View all observations"
   * banner link. Should clear the bbox URL param. Required when bbox
   * is non-null; otherwise unused.
   */
  onClearBbox?: () => void;
}
```

Add the filter logic inside the component:

```typescript
const filteredObservations = useMemo(() => {
  if (!bbox) return observations;
  const [lngMin, latMin, lngMax, latMax] = bbox;
  return observations.filter(
    (o) =>
      o.lng >= lngMin && o.lng <= lngMax &&
      o.lat >= latMin && o.lat <= latMax,
  );
}, [observations, bbox]);
```

Replace the existing `observations` usage with `filteredObservations` everywhere in the render tree (list items, counts, map markers, etc.).

- [ ] **Step 4: Run; confirm 4 pass**

```bash
npm run test --workspace @bird-watch/frontend -- --run frontend/src/components/SpeciesDetailSurface.test 2>&1 | tail -10
```

Expected: 4 new tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 877 passed (873 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SpeciesDetailSurface.tsx frontend/src/components/SpeciesDetailSurface.test.tsx
git commit -m "feat(detail): client-side bbox filter on SpeciesDetailSurface (#560)

Adds an optional bbox: BBox | null prop. When set, observations are
filtered client-side (Read API has no server bbox; spec §10 line 522).
Inclusive bounds on all 4 edges. Memo'd by [observations, bbox] for
stable re-renders.

4 tests: null=passthrough, set=filter, edge-inclusive, memo-stable."
```

---

## Task 7: Add `<SpeciesDetailSurface>` bbox banner + `onClearBbox` plumbing

**Files:**
- Modify: `frontend/src/components/SpeciesDetailSurface.tsx` (banner JSX)
- Modify: `frontend/src/components/SpeciesDetailSurface.test.tsx` (+2 banner tests)

- [ ] **Step 1: Write 2 failing tests for the banner**

```typescript
describe('SpeciesDetailSurface bbox banner (Phase 3, #560)', () => {
  it('renders the banner with onClearBbox link when bbox is non-null', () => {
    const onClearBbox = vi.fn();
    render(<SpeciesDetailSurface bbox={[-111, 31, -110, 32]} onClearBbox={onClearBbox} {...rest} />);
    const banner = screen.getByRole('region', { name: /Filtered by map area/i });
    expect(banner).toBeInTheDocument();
    const link = within(banner).getByRole('button', { name: /View all observations/i });
    fireEvent.click(link);
    expect(onClearBbox).toHaveBeenCalledTimes(1);
  });

  it('does not render the banner when bbox is null', () => {
    render(<SpeciesDetailSurface bbox={null} {...rest} />);
    expect(screen.queryByRole('region', { name: /Filtered by map area/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; confirm 2 failures**

Expected: 2 new failures.

- [ ] **Step 3: Add the banner JSX to `SpeciesDetailSurface.tsx`**

Above the main list rendering:

```tsx
{bbox && (
  <section
    className="species-detail-bbox-banner"
    role="region"
    aria-label="Filtered by map area"
  >
    <p className="species-detail-bbox-banner__text">
      Showing {filteredObservations.length} observations in the selected map area.
    </p>
    <button
      type="button"
      className="species-detail-bbox-banner__link"
      onClick={onClearBbox}
    >
      View all observations
    </button>
  </section>
)}
```

Note: `onClearBbox` is wired by the parent `App.tsx`/`MapSurface.tsx` to call `set({ bbox: null })`. Task 8 ties this together.

- [ ] **Step 4: Run; confirm 2 pass**

Expected: 2 new tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 879 passed (877 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/SpeciesDetailSurface.tsx frontend/src/components/SpeciesDetailSurface.test.tsx
git commit -m "feat(detail): bbox-filter banner with 'View all observations' link (#560)

Adds <section class='species-detail-bbox-banner'> rendered when bbox
prop is non-null. role='region' + aria-label='Filtered by map area'.
Button text 'View all observations' calls onClearBbox.

2 tests: banner-present-when-set + banner-absent-when-null."
```

---

## Task 8: Wire `onClearBbox` callback through `App.tsx` to `set({ bbox: null })`

**Files:**
- Modify: `frontend/src/App.tsx` (add the callback + thread to `<SpeciesDetailSurface>`)

- [ ] **Step 1: Add the callback near `onSelectSpecies`**

```typescript
const onClearBbox = useCallback(() => {
  set({ bbox: null });
}, [set]);
```

- [ ] **Step 2: Thread `bbox` + `onClearBbox` props into `<SpeciesDetailSurface>` wherever it's mounted**

```typescript
<SpeciesDetailSurface
  speciesCode={...}
  bbox={state.bbox}
  onClearBbox={onClearBbox}
  // ... existing props ...
/>
```

If `<SpeciesDetailSurface>` is mounted in multiple places (e.g., desktop + mobile sheet wrappers), wire all of them.

- [ ] **Step 3: Run full test suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: still 879 passed; the wiring is plumbing only.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(app): thread bbox + onClearBbox to SpeciesDetailSurface (#560)

Plumbing — onClearBbox calls set({ bbox: null }) so the
'View all observations' button clears the URL param. bbox is read from
url-state and passed down."
```

---

## Task 9: CSS rules for `.species-detail-bbox-banner`

In `frontend/src/components/ds/ds-primitives.css`, add rules for every className introduced in Task 7. Exhaustive class list:
`.species-detail-bbox-banner`, `.species-detail-bbox-banner__text`, `.species-detail-bbox-banner__link`.

- [ ] **Step 1: Write the CSS block**

```css
/* ----------------------------------------------------------------------
   <SpeciesDetailSurface> bbox-filter banner (Phase 3 / #560)
   Renders when ?bbox= is in the URL. Surfaces the filter state with
   a "View all observations" escape hatch. Spec §4.9.
   ---------------------------------------------------------------------- */
.species-detail-bbox-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border-radius: 4px;
  background: var(--color-bg-accent);
  color: var(--color-text-on-accent);
  font: var(--text-body-sm);
}

.species-detail-bbox-banner__text {
  margin: 0;
  flex: 1 1 auto;
}

.species-detail-bbox-banner__link {
  flex: 0 0 auto;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  padding: 4px 8px;
  min-height: 44px;
  min-width: 44px;
}

.species-detail-bbox-banner__link:focus-visible {
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

[data-theme="dark"] .species-detail-bbox-banner {
  background: var(--color-bg-accent);
  color: var(--color-text-on-accent);
}

@media (forced-colors: active) {
  .species-detail-bbox-banner {
    border: 1px solid CanvasText;
  }
  .species-detail-bbox-banner__link {
    color: LinkText;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* No animations on this banner — reserved for future. */
}
```

- [ ] **Step 2: Verify every class has at least one rule**

```bash
grep -cE '^\.species-detail-bbox-banner' frontend/src/components/ds/ds-primitives.css
```

Expected: ≥ 3 (banner + text + link, plus the focus-visible variant + dark-theme variant).

- [ ] **Step 3: Run orphan-classname check**

```bash
bash scripts/check-orphan-classnames.sh 2>&1 | tail -5
```

Expected: PASS (no orphan).

- [ ] **Step 4: Run build clean**

```bash
npm run build --workspace @bird-watch/frontend 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ds/ds-primitives.css
git commit -m "style(detail): CSS rules for .species-detail-bbox-banner (#560)

3 classes pinned by orphan-classname check. Light + dark + forced-colors
+ reduced-motion (reserved) branches. 44×44 min on the link per WCAG
2.5.5."
```

---

## Task 10: Atomic flag-flip — delete `feature-flags.ts` and all `isCellPopoverEnabled()` call sites

This is the destructive step. The flag's runtime branching is replaced with the previously-gated code path being the new default.

**Files:**
- DELETE: `frontend/src/feature-flags.ts`
- DELETE: `frontend/src/feature-flags.test.ts`
- Modify: `frontend/src/vite-env.d.ts` (remove `VITE_FF_CELL_POPOVER` declaration)
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx` (delete `isCellPopoverEnabled()` import + call; delete `flag &&` guards)
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (delete the 2 flag-OFF regression tests; the gated path is now unconditional)
- Modify: `frontend/src/components/MapSurface.tsx` (delete `isCellPopoverEnabled()` import + call at line 202)
- Modify: `frontend/src/components/MapSurface.test.tsx` (delete the flag-OFF test)
- Modify: `frontend/playwright.config.ts` (drop `VITE_FF_CELL_POPOVER=true` prefix from webServer line 80)
- Modify: `.env.example` (remove the `VITE_FF_CELL_POPOVER` block — 5 lines starting around line 20)

- [ ] **Step 1: Delete the flag module + tests**

```bash
git rm frontend/src/feature-flags.ts frontend/src/feature-flags.test.ts
```

- [ ] **Step 2: Update `vite-env.d.ts`**

Remove the `readonly VITE_FF_CELL_POPOVER?: string;` line from the `ImportMetaEnv` interface. Keep the file otherwise unchanged.

- [ ] **Step 3: Update `AdaptiveGridMarker.tsx`**

Remove the import:

```typescript
// DELETE this line:
import { isCellPopoverEnabled } from '../../feature-flags.js';
```

In the component body (line ~137), delete the `flag` const and update the predicates:

```typescript
// BEFORE:
const flag = isCellPopoverEnabled();
const isPointerFine = useMediaQuery('(pointer: fine)');
const perCellInteractive = flag && isPointerFine && !isCoarsePointer;
const clusterListInteractive = flag && isCoarsePointer === true;

// AFTER:
const isPointerFine = useMediaQuery('(pointer: fine)');
const perCellInteractive = isPointerFine && !isCoarsePointer;
const clusterListInteractive = isCoarsePointer === true;
```

- [ ] **Step 4: Update `AdaptiveGridMarker.test.tsx`**

Delete the two flag-OFF regression tests (Phase 2 added them; they're no longer reachable since the flag is gone). Keep the flag-ON tests — those are the new default behavior. Identify by searching:

```bash
grep -n "flag.*OFF\|VITE_FF_CELL_POPOVER.*false\|vi.stubEnv.*false" frontend/src/components/map/AdaptiveGridMarker.test.tsx
```

Delete the relevant `it(...)` blocks.

- [ ] **Step 5: Update `MapSurface.tsx`**

Remove the import + the guard:

```typescript
// DELETE this import line:
import { isCellPopoverEnabled } from '../feature-flags.js';

// BEFORE (line ~202):
{onExploreMapMarkers && isCellPopoverEnabled() && (
  <a className="skip-link" ...>Explore map markers</a>
)}

// AFTER:
{onExploreMapMarkers && (
  <a className="skip-link" ...>Explore map markers</a>
)}
```

- [ ] **Step 6: Update `MapSurface.test.tsx`**

Delete the flag-OFF test (skip-link is now unconditional when `onExploreMapMarkers` is provided). Identify:

```bash
grep -n "VITE_FF_CELL_POPOVER\|flag.*OFF" frontend/src/components/MapSurface.test.tsx
```

Delete the relevant `it(...)` block.

- [ ] **Step 7: Update `playwright.config.ts`**

Line 80 (webServer for dev-server):

```typescript
// BEFORE:
command: 'VITE_FF_CELL_POPOVER=true npm run dev',

// AFTER:
command: 'npm run dev',
```

Update the comment block above to remove the flag-rationale lines (lines 76–79 currently). Keep the rest of the webServer config unchanged.

- [ ] **Step 8: Update `.env.example`**

Delete the `VITE_FF_CELL_POPOVER` block (5 lines):

```bash
# These 5 lines are removed:
# Cell species popover — default OFF until Phase 3 atomic flag-flip
# (per spec docs/specs/2026-05-15-cell-species-popover-design.md §10).
# Phase 1 (#558) ships <CellHoverPreview> + <CellPopover> + per-cell
# trigger surface + "Explore map markers" skip-link behind this flag.
VITE_FF_CELL_POPOVER=false
```

Replace with a single-line comment matching the `VITE_FF_ADAPTIVE_GRID` pattern:

```bash
# Cell species popover flipped default-ON 2026-05-16 (#560).
# The flag was deleted in the same PR (no rollback path retained).
```

- [ ] **Step 9: Run the full test suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: roughly 873 passed — we removed 4 feature-flag tests AND 3 flag-OFF tests across `AdaptiveGridMarker.test.tsx` + `MapSurface.test.tsx` from the 879 we had after Task 7 → 872. Acceptable range: 870–875.

If any test fails because it mocks `feature-flags.ts`, delete the mock (it's no longer needed since the module is gone) — those tests should now pass with the gated code path as the default.

- [ ] **Step 10: Build clean**

```bash
npm run build --workspace @bird-watch/frontend 2>&1 | tail -3
```

Expected: clean. If there are dangling references to `feature-flags.js`, the build will fail with `Cannot resolve module` — fix any missed call sites.

- [ ] **Step 11: Knip clean — no orphans**

```bash
npm run knip --workspace @bird-watch/frontend 2>&1 | tail -10
```

Expected: no new findings. If `feature-flags.ts` is listed as unused (it was — we just deleted it), knip should be silent. If anything else flags up as orphan because the flag-gated code path was the only consumer, decide: delete the orphan OR add an ignore rule with a dated comment matching the existing convention.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/vite-env.d.ts frontend/src/components/map/AdaptiveGridMarker.tsx frontend/src/components/map/AdaptiveGridMarker.test.tsx frontend/src/components/MapSurface.tsx frontend/src/components/MapSurface.test.tsx frontend/playwright.config.ts .env.example
git commit -m "chore: atomic flag-flip — delete VITE_FF_CELL_POPOVER (#560)

Spec §10 atomic flag-flip pattern (matches VITE_FF_ADAPTIVE_GRID
precedent at PR #546):
- DELETE frontend/src/feature-flags.ts + .test.ts (module gone)
- Remove VITE_FF_CELL_POPOVER from vite-env.d.ts
- AdaptiveGridMarker.tsx: drop isCellPopoverEnabled() + 'flag &&'
  guards; the previously-gated code path is now the default
- MapSurface.tsx: drop isCellPopoverEnabled() guard from the
  'Explore map markers' skip-link
- playwright.config.ts: drop VITE_FF_CELL_POPOVER=true webServer
  prefix (flag no longer exists)
- .env.example: replace the flag block with a single-line annotation
  noting the 2026-05-16 default-ON flip + deletion

No runtime behavior change for end users — the gated code path was
already what they'd see with the flag on. This is a code-only cleanup
that removes the dead branch alongside the env-default flip."
```

---

## Task 11: Parent-spec amend — `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2

**Files:**
- Modify: `docs/specs/2026-05-14-adaptive-cluster-grid-design.md` §2

- [ ] **Step 1: Read the current §2 section**

```bash
grep -nE "^## " docs/specs/2026-05-14-adaptive-cluster-grid-design.md | head -10
sed -n '<§2 line range>p' docs/specs/2026-05-14-adaptive-cluster-grid-design.md
```

Look for the line that reads something like "per-cell tap targets are explicitly a non-goal" (paraphrasing — exact wording may differ).

- [ ] **Step 2: Edit §2 to reverse the non-goal for `pointer:fine`**

Replace the non-goal line with the dual-mode framing:

```markdown
- **Per-cell tap targets — dual-mode (reversed for `pointer:fine` per
  cell-popover spec `2026-05-15-cell-species-popover-design.md`):**
  - `pointer:fine` (mouse + trackpad): per-cell tap targets ARE a goal.
    The `<CellHoverPreview>` and `<CellPopover>` components let users
    inspect and navigate per-family from each tile cell.
  - `pointer:coarse` (touch): per-cell tap targets remain a non-goal.
    WCAG 2.5.5 prohibits 22×22 cells on touch; the whole-marker (48×48)
    tap surface opens a `<ClusterListPopover>` instead.
```

(Adjust the surrounding context to match the existing prose style of the spec.)

Add a cross-reference at the top of §2 (or wherever cross-refs live in this spec):

```markdown
> **Related:** `docs/specs/2026-05-15-cell-species-popover-design.md`
> reverses the per-cell tap-target non-goal for `pointer:fine`. The
> reversal landed in epic #556 (PRs #561–#564 + #PHASE-3-PR).
```

- [ ] **Step 3: Run knip + orphan-classname (no expected change — sanity)**

Spec edits don't affect knip or orphan-classname; confirm no regression:

```bash
npm run knip --workspace @bird-watch/frontend 2>&1 | tail -5
bash scripts/check-orphan-classnames.sh 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-05-14-adaptive-cluster-grid-design.md
git commit -m "docs(spec): amend adaptive-cluster-grid §2 — dual-mode per-cell tap (#560)

Reverses the 'per-cell tap targets are a non-goal' line for pointer:fine
to reflect the cell-popover spec (2026-05-15) landing in epic #556.
pointer:coarse preserves the original non-goal via cluster-list popover
(WCAG 2.5.5 rationale unchanged).

Adds a cross-reference to the cell-popover spec for downstream readers."
```

---

## Task 12: Extend `frontend/e2e/map-cell-popover.spec.ts` — 6 scenarios per spec §7.3

**Files:**
- Modify: `frontend/e2e/map-cell-popover.spec.ts` — rewrite the trimmed Phase 2 form into 6 scenarios.

This is the largest spec extension; treat it as one task but commit per scenario if it grows. Per spec §7.3 (lines 453–460), the scenarios are:

1. **Desktop @ 1440×900 (no `@coarse` tag, runs under `dev-server`)**: hover the Tucson Hummingbirds cell → preview shows top 3 species; click promotes to popover; click "Anna's Hummingbird" → URL changes to `?view=detail&detail=anhumm&bbox=…`; SpeciesDetailSurface renders with bbox banner.
2. **Desktop keyboard @ 1440×900**: activate the new "Explore map markers" skip-link → focus lands on the first cell; preview appears on focus; Enter opens popover; ESC dismisses; focus returns to cell. Arrow keys move focus between cells; Tab moves to the next marker's first cell.
3. **Tablet @ 768×1024 (`@coarse`, runs under `coarse-pointer`)**: tap marker → cluster list popover slides up (NOT per-cell — confirms the `pointer:coarse` partition). Tap a species → URL contains bbox.
4. **Mobile @ 390×844 (`@coarse`, emulated via the same `coarse-pointer` project at the mobile viewport)**: tap marker → cluster list popover slides up; expand "Wrens" → tap "Cactus Wren" → SpeciesDetailSurface filtered (banner present).
5. **Banner "View all observations"**: after navigating to a bbox-filtered detail surface, click the banner link → URL `?bbox=` cleared; banner disappears; full observation list rendered.
6. **Cross-surface stale-bbox clear**: load `/?view=detail&detail=anhumm&bbox=-111,31,-110,32`; navigate to feed → click a feed row that calls `onSelectSpecies('vermfly')` → URL has `?detail=vermfly&view=detail` with NO `?bbox=`.

- [ ] **Step 1: Replace the existing Phase 2 spec body with the 6 scenarios**

The exact spec content is too large to inline here; the implementer should base each scenario on the existing Phase 2 `@coarse` test pattern at `frontend/e2e/map-cell-popover.spec.ts` (post-trim, ~57 lines). Key patterns:

- Each scenario gets its own `test(...)` block.
- Scenarios 3 + 4 are tagged `@coarse` so they run only under the `coarse-pointer` Playwright project.
- Scenarios 1, 2, 5, 6 run under the default `dev-server` project (NOT tagged `@coarse`).
- Use the same selectors confirmed in Phase 2: `[data-testid="adaptive-grid-marker"]`, `getByRole('dialog')`, `.cluster-list-popover__rows a[role="link"]`, `getByRole('button', { name: /View all observations/i })`.
- Use `.click({ force: true })` for `<a role="link">` without href (Phase 2 lesson — actionability check thrashes otherwise).

Each scenario should:
1. Navigate (`page.goto('/')` or `page.goto('/?detail=...&bbox=...')`).
2. Wait for the relevant landmark to render (map markers, banner, etc.).
3. Drive the interaction.
4. Assert the expected URL state and/or rendered content.

- [ ] **Step 2: Run discovery — confirm 4 scenarios discovered under `dev-server`, 2 under `coarse-pointer`**

```bash
npm run test:e2e --workspace @bird-watch/frontend -- --project=dev-server --list 2>&1 | grep "map-cell-popover" | head -10
npm run test:e2e --workspace @bird-watch/frontend -- --project=coarse-pointer --list 2>&1 | grep "map-cell-popover" | head -10
```

Expected: dev-server lists 4 (scenarios 1, 2, 5, 6); coarse-pointer lists 2 (scenarios 3, 4).

- [ ] **Step 3: Local-run NOT required**

Local e2e requires a seeded DB. CI seed (e2e.yml) provides 5 observations across 4 families after the Phase 2 augmentation. Local-run is deferred to CI — the contract is "discovery + CI green".

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/map-cell-popover.spec.ts
git commit -m "test(e2e): full 6-scenario cell-popover spec per design §7.3 (#560)

Replaces the Phase 2 trimmed form with the comprehensive scenarios:
1. Desktop hover→preview→click→popover→species→bbox-URL (1440×900)
2. Desktop keyboard skip-link→cell→preview→Enter→popover→ESC (1440×900)
3. Tablet tap→cluster-list→species→bbox-URL (@coarse, 768×1024)
4. Mobile tap→cluster-list→expand-family→species→filter (@coarse, 390×844)
5. Banner 'View all observations' clears bbox URL param
6. Cross-surface stale-bbox-clear: detail→feed→detail leaves no bbox

Scenarios 3+4 tagged @coarse → run under coarse-pointer project.
Scenarios 1+2+5+6 run under dev-server (grepInvert: /@coarse/)."
```

---

## Task 13: Playwright MCP design-review capture (10 screenshots + zero-console)

Identical pattern to Phase 2 Task 10. The implementer drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes, focusing on the `<SpeciesDetailSurface>` bbox banner state (new in this PR) AND the default flag-ON map markers.

**Files:** None (capture only).

- [ ] **Step 1: Start the dev server**

```bash
npm run dev --workspace @bird-watch/frontend > /tmp/phase3-dev.log 2>&1 &
sleep 8
curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5173/
```

Expected: `http 200`. The flag is gone, so no `VITE_FF_CELL_POPOVER=true` prefix is needed; the popover behavior is now default.

- [ ] **Step 2: Capture at each of the 5 viewports × 2 themes**

For each `{w, h}` in `[{1920,1080}, {1440,900}, {1024,768}, {768,1024}, {390,844}]`:

**Light:**
1. `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5173/?detail=annhum&view=detail&bbox=-111,31,-110,32` (so the banner is visible).
2. `mcp__plugin_playwright_playwright__browser_resize` → `{width: w, height: h}`.
3. `mcp__plugin_playwright_playwright__browser_evaluate` → `() => document.documentElement.setAttribute('data-theme', 'light')`.
4. Wait for the `<SpeciesDetailSurface>` to render.
5. `browser_console_messages` → assert empty.
6. `browser_take_screenshot` → save.

**Dark:** Re-evaluate `data-theme=dark`; repeat capture.

- [ ] **Step 3: Upload via `pr-screenshots-via-user-attachments` skill (after PR is opened in Task 16)**

Defer to Task 16's PR-open step; the skill needs an open PR to paste into.

- [ ] **Step 4: Stop the dev server**

```bash
kill $(lsof -ti :5173) 2>/dev/null || true
```

---

## Task 14: Sanity sweep — knip + orphan-classname + flag-removed test pass

**Files:** None (verification).

- [ ] **Step 1: Full test suite**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 870–880 passed (range accounts for the 4 feature-flag tests removed + ~25 new tests across Tasks 2–8).

- [ ] **Step 2: Build clean**

```bash
npm run build --workspace @bird-watch/frontend 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Knip clean**

```bash
npm run knip --workspace @bird-watch/frontend 2>&1 | tail -10
```

Expected: no new findings. The deleted `feature-flags.ts` should NOT leave orphans (no consumer remains).

- [ ] **Step 4: Orphan-classname check**

```bash
bash scripts/check-orphan-classnames.sh 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Regression smoke — no flag-prefix needed since flag is gone**

```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

This is the same as Step 1 since the flag is no longer a variable. Confirms the deletion didn't break anything.

- [ ] **Step 6: E2E discovery sanity**

```bash
npm run test:e2e --workspace @bird-watch/frontend -- --project=dev-server --list 2>&1 | tail -5
npm run test:e2e --workspace @bird-watch/frontend -- --project=coarse-pointer --list 2>&1 | tail -5
```

Expected: dev-server lists ≥240 tests (235 baseline + 4 new Phase 3 scenarios + others); coarse-pointer lists exactly 2 (Phase 2's `@coarse` + Phase 3's mobile `@coarse`).

---

## Task 15: Design-review subagent dispatch

Per `CLAUDE.md` "Design-review subagent invocation contract" (#445), dispatch a `ui-design:ui-designer` subagent with `model: "opus"` for design review across all 5 viewports × 2 themes.

**Files:** None.

- [ ] **Step 1: Open the PR first (Task 16) so the PR URL exists**

(This task runs AFTER Task 16, in practice — but the contract belongs here for plan clarity.)

- [ ] **Step 2: Dispatch the design-review subagent**

```
subagent_type: "ui-design:ui-designer"
model: "opus"
prompt: |
  Design-review the cell-species-popover Phase 3 PR on bird-sight-system.

  PR: https://github.com/julianken/bird-sight-system/pull/<N>

  Design intent reference:
    - Spec: docs/specs/2026-05-15-cell-species-popover-design.md §4.9 (bbox
      routing), §5.4 (SpeciesDetailSurface bbox prop), §7.3 (e2e), §10
      (atomic flag-flip framing)
    - Plan: docs/plans/2026-05-16-cell-species-popover-phase-3.md
    - Phase 2 PR for visual continuity reference: #564
    - Parent-spec amend: docs/specs/2026-05-14-adaptive-cluster-grid-design.md §2

  Screenshots (10 total, 5 viewports × 2 themes): <fill in user-attachments URLs>

  Acceptance criteria from the plan's quantified-literals manifest:
    - bbox banner renders when ?bbox= is in URL (role=region, aria-label='Filtered by map area')
    - "View all observations" button is ≥44×44 (WCAG 2.5.5)
    - banner reads as a clear filter-state surface (not chrome)
    - Light + dark theme parity
    - Forced-colors + reduced-motion branches present
    - No regressions in the cluster-list-popover or cell-popover visuals at any viewport
    - Flag-removed default behavior matches Phase 1/2's flag-ON visuals exactly

  Verdict format: PASS / FAIL with file:line-equivalent evidence.
  Cap findings at 3 per viewport per R3.
```

- [ ] **Step 3: Resolve any FAILs**

If the subagent returns FAIL: dispatch an implementer subagent per SDD to address the finding; re-dispatch the design-reviewer once fixed; iterate until PASS at all 5 viewports.

---

## Task 16: Open PR + dispatch bot review + queue

**Files:** None.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin worktree-cell-popover-phase-3
```

- [ ] **Step 2: Open the PR via the `pr-workflow` skill**

Title: `feat(map): cell-popover phase 3 — bbox URL + SpeciesDetailSurface + atomic flag flip (#560)`.

Body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Required sections:

1. **Diagram**: Mermaid sequence diagram showing `<CellPopover>/<ClusterListPopover> species-row click → MapCanvas onSelectSpecies(code) → getClusterBbox(group) → set({ detail, view, bbox }) → <SpeciesDetailSurface> filtered + banner`.
2. **Summary**: 1-2 bullets pointing at spec §4.9, §5.4, §7.3, §10 and issue #560. Mention dependency on Phase 2 (PR #564). State the atomic flag-flip + deletion explicitly.
3. **Screenshots**: 10 `user-attachments/assets/<uuid>` URLs from Task 13.
4. **Test plan**: checkboxes for full test suite (target 870–880), build, e2e (`dev-server` + `coarse-pointer`), Playwright MCP drive.
5. **Plan reference**: link to this plan + issue #560 + spec.

- [ ] **Step 3: Verify CI green at HEAD before queuing**

```bash
gh pr checks <PR_NUM> --repo julianken/bird-sight-system
```

Expected: `test`, `lint`, `build`, `e2e` all green. (Per CLAUDE.md memory: always verify CI green BEFORE `@Mergifyio queue`.)

The new e2e step `coarse-pointer` MUST appear green AND the new 4 scenarios under `dev-server` MUST all pass — the seed augmentation from Phase 2 is sufficient.

- [ ] **Step 4: Upload the 10 screenshots via `pr-screenshots-via-user-attachments`**

Skill: `pr-screenshots-via-user-attachments`. Drive the simulated-paste flow via `chrome-devtools-mcp`. After upload, edit the PR body to label each URL by viewport + theme.

- [ ] **Step 5: Dispatch the `julianken-bot` review subagent**

Per the `pr-workflow` skill. Reviewer model: **opus** (cross-tier discipline — implementer ran on sonnet via SDD per the issue brief; reviewer must be higher tier).

- [ ] **Step 6: Resolve bot findings if any**

If REVISE: dispatch a subagent fix per the SDD loop, re-review.

- [ ] **Step 7: Dispatch the design-review subagent (Task 15)**

Now that the PR URL + screenshot URLs exist, dispatch per Task 15.

- [ ] **Step 8: After both reviewers APPROVE, post `@Mergifyio queue`**

Literal-string body — no prose. Per the `mergify-merge-workflow` skill.

- [ ] **Step 9: Wait for merge + close issue + epic**

Background-watch the PR state until merged. Issue #560 auto-closes via the `closes #560` line in the PR body. Epic #556 closes when all 4 sub-issues are closed (it should auto-close on this merge if the epic tracking is GitHub-native — verify post-merge).

---

## Self-review

**Spec coverage check**:
- §4.9 (bbox routing + cross-surface clear): ✓ Tasks 2 (URL state), 3 (helper), 4 (popover wire), 5 (cross-surface clear), 6+7 (banner + filter).
- §5.4 (`SpeciesDetailSurface` bbox prop): ✓ Tasks 6 (prop + filter), 7 (banner + onClearBbox), 8 (App.tsx wire).
- §7.3 (e2e): ✓ Task 12 (6 scenarios).
- §10 (atomic flag-flip): ✓ Task 10 (delete + cleanup), Task 11 (parent-spec amend).

All Phase 3 spec sections have at least one task. ✓

**Phase 3 exclusions explicitly documented**:
- Smart-flip positioning (Floating-UI dep): deferred to a follow-up issue. Not in scope per the architecture note in the plan header.
- Tier-2 refactors (`<Popover>` primitive, `<SpeciesCount>` primitive — spec §9 Tier-2): deferred. The drift between `<CellPopover>` and `<ClusterListPopover>` is acknowledged in the spec but extracted-primitive work is out of Phase 3.
- Server-side bbox in `/api/observations`: spec §10 confirms client-side filtering is the chosen path; server-side is a deferred follow-up if data volume grows.

All Phase 3 deferrals explicit. ✓

**Placeholder scan**:

```bash
grep -nE "TBD|TODO|XXX|placeholder text|TODO\(|todo\(|implement later|implement similarly|add appropriate" docs/plans/2026-05-16-cell-species-popover-phase-3.md
```

Expected: no matches.

**Type consistency**:
- `BBox` exported from `frontend/src/state/url-state.ts` (Task 2); imported by `deconflict.ts` (Task 3), `App.tsx` (Task 5), `SpeciesDetailSurface.tsx` (Task 6). All same alias.
- `getClusterBbox(group: DeconflictGroup): BBox` signature consistent across Tasks 3 + 4.
- `onSelectSpecies(code: string, bbox?: BBox | null)` signature in `App.tsx` consistent across Tasks 4 + 5.

All types align. ✓

**CSS sub-task gate**:

```bash
grep -n "className" docs/plans/2026-05-16-cell-species-popover-phase-3.md | grep -v "grep\|CSS rules\|Step\|MUST\|orphan-classname\|className=\"\\.species-detail" | head -20
```

The 3 introduced classNames (`species-detail-bbox-banner`, `__text`, `__link`) all have rules in Task 9. ✓

**Multi-viewport design-review gate**:
- Task 13 captures 5 viewports × 2 themes.
- Task 15 dispatches `ui-design:ui-designer` opus subagent with the 10 URLs.

Both gates satisfied. ✓

---

## Notes for the executor

- Phase 3 is **the** cleanup PR for the epic. Resist scope-creep: the smart-flip-positioning question and the Tier-2 primitive extractions are explicit non-goals here. File follow-up issues for both before opening this PR if they're not already tracked.
- Atomic flag-flip means **all** of the deletion happens in **one** PR. No splitting into "flip default, delete next PR" — the flag's existence is itself a maintenance cost and the cleanup pattern in this repo (per `VITE_FF_ADAPTIVE_GRID`) ships them together.
- The parent-spec amend (Task 11) is small but load-bearing — without it, the parent spec contradicts the cell-popover spec on the "per-cell tap targets are a non-goal" line. Keep the cross-reference precise.
- The e2e seed in `.github/workflows/e2e.yml` (4 species, 5 observations across 4 families at Madera + Tucson) is sufficient for all 6 Phase 3 scenarios. Do NOT augment the seed further unless a scenario's locator can't resolve — and if so, the augmentation goes in a separate commit with a clear "why" in the message.
