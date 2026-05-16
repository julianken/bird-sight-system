# Cell Species Popover — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `<CellHoverPreview>` + `<CellPopover>` + per-cell `<TileCell>` interaction (hover/focus/click) + a minimum-viable "Explore map markers" skip-link in `MapSurface`, all gated by `VITE_FF_CELL_POPOVER` (default OFF). With the flag OFF, every existing test in `main` must still pass and the marker must behave identically to today (788 tests green).

**Architecture:** A new feature-flag helper in `frontend/src/feature-flags.ts` reads `import.meta.env.VITE_FF_CELL_POPOVER`. `<AdaptiveGridMarker>` is extended so each `<TileCell>` becomes a `<button>` when the flag is on AND `pointer:fine` matches; the existing hit-extender overlay's `pointerEvents` toggles to `'none'` in that mode. Per-cell `mouseenter`/`focus` shows `<CellHoverPreview>` (top-3 species, `role="tooltip"`); `click`/Enter/Space promotes to `<CellPopover>` (top-8 species + clickable rows, `role="dialog"`). `MapSurface` grows a second skip-link, "Explore map markers", that targets the first `<TileCell>`. Suppressed (`aria-hidden`, `tabIndex={-1}`) when `groups.length === 0`.

**Tech Stack:** TypeScript strict · React 19 · Vitest 3.x · `@testing-library/react` 16.x · `@playwright/test` 1.49.x · MapLibre-GL 5.x · existing `@bird-watch/shared-types`.

**Issue:** #558 (subissue 2 of 4 in epic #556)
**Spec:** `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §4.5, §4.6, §4.7, §4.8, §4.10, §5.1, §5.2

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] **2 new components** shipped behind `VITE_FF_CELL_POPOVER`: `<CellHoverPreview>`, `<CellPopover>`
- [ ] **1 new feature-flag helper** at `frontend/src/feature-flags.ts` exporting `isCellPopoverEnabled()` (read-once + memoized)
- [ ] **1 new env declaration** in `frontend/src/vite-env.d.ts` adding `readonly VITE_FF_CELL_POPOVER?: string` to `ImportMetaEnv`
- [ ] **1 new `.env.example` line** at `/Users/j/repos/bird-watch/.env.example`: `VITE_FF_CELL_POPOVER=false` with a dated comment explaining the flag
- [ ] **~12 unit tests for `<CellHoverPreview>`** covering: top-3 cap, `role="tooltip"`, family-header text format, footer absent when species.length≤3, footer present "Click for more" when >3, footer text matches verbatim, descending count order in render, `id` propagation for `aria-describedby`, `prefers-reduced-motion` collapses fade animation to 0ms, forced-colors fallback uses `ButtonText`/`ButtonBorder` per the `styles.css:1696` pattern, empty `species` array renders no rows, count formatting matches `Nx <comName>` template
- [ ] **~15 unit tests for `<CellPopover>`** covering: top-8 cap + "…and N more" footer when species.length>8, footer absent when ≤8, footer text reads "Click or tap for full list" verbatim, `role="dialog"`, non-modal `aria-modal` absent (or `false`), `aria-labelledby` resolves to the popover heading element, ESC dismiss + focus return to anchor, click-outside dismiss, clickable rows have `role="link"` only when `speciesCode !== null`, rows render as `<span>` when `speciesCode === null` (no link, no `role`), clicking a clickable row calls `onSelectSpecies(speciesCode)` with single arg (Phase 3 will widen to `(speciesCode, bbox)`), keyboard Enter on a focused row triggers `onSelectSpecies`, focus moves to popover heading on open, count reconciliation rendered correctly (`(47)` header)
- [ ] **~6 new tests in `AdaptiveGridMarker.test.tsx`**: flag-OFF baseline (every existing assertion still passes); flag-ON + pointer:fine — cell becomes `<button>` with `tabIndex={0}`, `aria-haspopup="dialog"`, `aria-expanded="false"`; flag-ON + pointer:fine — hit-extender computed `pointer-events: 'none'`; flag-ON + pointer:coarse — hit-extender computed `pointer-events: 'auto'`; flag-ON + pointer:fine — cell `mouseenter` triggers preview render; flag-ON + pointer:fine — Enter on focused cell promotes preview to popover and sets `aria-expanded="true"`
- [ ] **~5 new tests in `MapSurface.test.tsx`**: flag-OFF baseline (existing 4 skip-link tests still pass); flag-ON — second skip-link "Explore map markers" renders; flag-ON — skip-link is visually-hidden until focus via `.skip-link` class; flag-ON — clicking skip-link calls `onExploreMapMarkers` prop; flag-ON + empty viewport — skip-link is `aria-hidden="true"` and `tabIndex={-1}`
- [ ] **New className list for `<CellHoverPreview>`** — 5 classes pinned in CSS sub-task: `cell-hover-preview`, `cell-hover-preview__header`, `cell-hover-preview__rows`, `cell-hover-preview__row`, `cell-hover-preview__footer`
- [ ] **New className list for `<CellPopover>`** — 7 classes pinned in CSS sub-task: `cell-popover`, `cell-popover__header`, `cell-popover__heading`, `cell-popover__rows`, `cell-popover__row`, `cell-popover__row--clickable`, `cell-popover__footer`
- [ ] **Hit-extender `pointerEvents` ternary** at `AdaptiveGridMarker.tsx:139` toggles `'auto'` ↔ `'none'` and is pinned by a unit test snapshotting the computed style
- [ ] **"Explore map markers" skip-link** reachable from `Tab` key on `MapSurface` mount; activates focus on first `<TileCell>` of the first marker (verified by Playwright MCP at 1440×900)
- [ ] **10 design-review screenshots** (5 viewports × 2 themes) captured via Playwright MCP, attached as `user-attachments/assets/<uuid>` URLs in PR body
- [ ] **Zero console errors and zero console warnings** at each of the 5 canonical viewports (Playwright MCP `browser_console_messages` returns empty)
- [ ] **Existing 788 tests still pass with flag OFF** (`npm run test --workspace @bird-watch/frontend` exits 0)
- [ ] **All new tests pass with flag ON** (`VITE_FF_CELL_POPOVER=true npm run test --workspace @bird-watch/frontend` exits 0)
- [ ] **`npm run build --workspace @bird-watch/frontend`** clean (no new TS errors)
- [ ] **Knip clean** — no new findings introduced

## File map

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/components/map/CellHoverPreview.tsx` | NEW | Top-3 species preview, `role="tooltip"`, footer "Click for more" when species.length>3 |
| `frontend/src/components/map/CellHoverPreview.test.tsx` | NEW | ~12 unit tests (top-3 cap, role, footer presence/absence, prefers-reduced-motion, forced-colors, id propagation) |
| `frontend/src/components/map/CellPopover.tsx` | NEW | Top-8 + "…and N more" footer "Click or tap for full list", `role="dialog"`, clickable rows when `speciesCode !== null`, ESC/click-outside dismiss + focus return |
| `frontend/src/components/map/CellPopover.test.tsx` | NEW | ~15 unit tests (top-8 cap, role, focus management, ESC, clickable vs static rows, onSelectSpecies wiring) |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Modify | Per-cell pointer/keyboard handlers (desktop-only via `pointer:fine` + flag); hit-extender ternary `'none'` ↔ `'auto'`; ARIA `aria-haspopup`/`aria-expanded`/`aria-describedby` per spec §4.8 |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | Modify | ~6 new tests covering the flag-gated behaviors; existing 21 tests still pass |
| `frontend/src/components/MapSurface.tsx` | Modify | Second "Explore map markers" skip-link; suppressed when `groups.length === 0` |
| `frontend/src/components/MapSurface.test.tsx` | Modify | ~5 new skip-link tests; existing 4 still pass |
| `frontend/src/feature-flags.ts` | NEW | Exports `isCellPopoverEnabled()` — single read-point for `import.meta.env.VITE_FF_CELL_POPOVER === 'true'` |
| `frontend/src/feature-flags.test.ts` | NEW | 4 unit tests covering truthy/falsy/missing/non-canonical env values |
| `frontend/src/vite-env.d.ts` | Modify | Add `readonly VITE_FF_CELL_POPOVER?: string` to `ImportMetaEnv` interface |
| `frontend/src/styles.css` | Modify | (Skip-link CSS already covers `.skip-link` for the new "Explore map markers" link — no new selector needed; document this in CSS sub-task) |
| `frontend/src/components/ds/ds-primitives.css` | Modify | New CSS rules for all 12 popover + preview classNames (light + dark + reduced-motion + forced-colors) |
| `/Users/j/repos/bird-watch/.env.example` | Modify | Add `VITE_FF_CELL_POPOVER=false` line with dated comment |

**CSS sub-task gate (per project writing-plans extension):** This plan ADDS 2 new components with className-driven styling. Every new className introduced is pinned to a CSS rule inside Task 10 (CSS rules for `<CellHoverPreview>`) and Task 11 (CSS rules for `<CellPopover>`). The skip-link reuses the existing `.skip-link` selector at `styles.css:107-138` — no new CSS rule required, but documented in Task 9.

**Multi-viewport design-review gate (per project writing-plans extension):** Task 13 drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes (10 screenshots minimum), confirms zero console errors/warnings at each, and feeds the screenshot URLs into the PR body. Task 14 dispatches a `ui-design:ui-designer` subagent with `model: "opus"` for the design review pass.

---

## Task 1: Set up the worktree and confirm Phase 0 invariants

The Phase 1 worktree already exists at `/Users/j/repos/bird-watch/.claude/worktrees/cell-popover-phase-1` (branch `worktree-cell-popover-phase-1`, branched from `origin/main` after Phase 0 merge `55b3449`).

**Files:** None — verification only.

- [ ] **Step 1: Confirm worktree state**

Run: `pwd && git log --oneline -3 && git status`

Expected:
- `pwd` → `/Users/j/repos/bird-watch/.claude/worktrees/cell-popover-phase-1`
- `git log` → topmost commit is `55b3449 feat(map): cell-popover phase 0 — data layer threading (#557) (#562)`
- `git status` → branch `worktree-cell-popover-phase-1`, working tree clean

- [ ] **Step 2: Verify Phase 0 `species` threading is in place**

Run: `grep -n "SpeciesAggregate\|species:" frontend/src/components/map/adaptive-grid.ts | head -10`

Expected: `SpeciesAggregate` interface exported and 3 `species: ReadonlyArray<SpeciesAggregate>` field declarations on the `AdaptiveTile` union. If this fails, STOP — Phase 0 has not landed in main and Phase 1 cannot proceed.

- [ ] **Step 3: Confirm baseline test count**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  788 passed (788)`. Note this number — every PR commit must keep it ≥ 788 with the flag OFF.

- [ ] **Step 4: Confirm `vite-env.d.ts` location**

Run: `cat frontend/src/vite-env.d.ts`

Expected: file exists with `ImportMetaEnv` interface containing `VITE_API_BASE_URL` and `VITE_POSTHOG_KEY` fields. (No existing `VITE_FF_*` declaration — Phase 0 didn't need one because `VITE_FF_ADAPTIVE_GRID` was already cleaned up in PR #546.)

---

## Task 2: Add `VITE_FF_CELL_POPOVER` to `.env.example` and `vite-env.d.ts`

**Files:**
- Modify: `/Users/j/repos/bird-watch/.env.example` (workspace-root file, NOT `frontend/.env.example`)
- Modify: `frontend/src/vite-env.d.ts`

- [ ] **Step 1: Read the workspace `.env.example`**

Run: `cat /Users/j/repos/bird-watch/.env.example`

Expected: contains `VITE_POSTHOG_KEY=` (line ~12) and `VITE_FF_ADAPTIVE_GRID=true` (line ~16). The Phase 0 plan did not modify this file; Phase 1 adds the new flag declaration here.

- [ ] **Step 2: Append the new flag at the bottom of the file**

Edit `/Users/j/repos/bird-watch/.env.example`. Append after the `VITE_FF_ADAPTIVE_GRID` line:

```
# Cell species popover — default OFF until Phase 3 atomic flag-flip
# (per spec docs/specs/2026-05-15-cell-species-popover-design.md §10).
# Phase 1 (#558) ships <CellHoverPreview> + <CellPopover> + per-cell
# trigger surface + "Explore map markers" skip-link behind this flag.
VITE_FF_CELL_POPOVER=false
```

- [ ] **Step 3: Extend `ImportMetaEnv` in vite-env.d.ts**

Edit `frontend/src/vite-env.d.ts`. Update the interface block to add the new field (keep the existing fields):

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  /**
   * Cell species popover (epic #556, Phase 1+, spec
   * docs/specs/2026-05-15-cell-species-popover-design.md §10).
   * String literal "true" enables the feature flag; anything else
   * disables it. Read via `isCellPopoverEnabled()` in feature-flags.ts.
   */
  readonly VITE_FF_CELL_POPOVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4: Confirm typecheck still passes**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean (`✓ built in ...`).

- [ ] **Step 5: Commit**

```bash
git add .env.example frontend/src/vite-env.d.ts
git commit -m "feat(map): declare VITE_FF_CELL_POPOVER flag (#558)

Adds the feature-flag env var declaration to .env.example and the
vite-env.d.ts ImportMetaEnv interface. No behavior change yet —
flag is unread by code until feature-flags.ts (next commit)."
```

---

## Task 3: Create `feature-flags.ts` with `isCellPopoverEnabled()` (TDD RED → GREEN)

The flag is read at module-load time and memoized. Module-scope read avoids per-render `import.meta.env` lookups (which esbuild substitutes at build time anyway, but explicit memoization makes the contract clearer and gives tests a single mock point).

**Files:**
- NEW: `frontend/src/feature-flags.ts`
- NEW: `frontend/src/feature-flags.test.ts`

- [ ] **Step 1: Write the test file FIRST (RED phase)**

Create `frontend/src/feature-flags.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('feature-flags', () => {
  beforeEach(() => {
    vi.resetModules(); // re-import so the top-level env read re-runs.
  });

  it('isCellPopoverEnabled() returns true when VITE_FF_CELL_POPOVER === "true"', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(true);
  });

  it('isCellPopoverEnabled() returns false when VITE_FF_CELL_POPOVER === "false"', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'false');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });

  it('isCellPopoverEnabled() returns false when VITE_FF_CELL_POPOVER is undefined', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', undefined as unknown as string);
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });

  it('isCellPopoverEnabled() returns false for non-canonical truthy values', async () => {
    // Defensive: only the literal string "true" enables. "1", "yes",
    // "TRUE" (case-different), etc. all DISABLE — strict matching keeps
    // the build/runtime contract simple.
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'TRUE');
    const { isCellPopoverEnabled } = await import('./feature-flags.js');
    expect(isCellPopoverEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Create the implementation file**

Create `frontend/src/feature-flags.ts`:

```ts
/**
 * Feature-flag helpers (epic #556, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §10).
 *
 * Each flag is read once at module load and memoized. esbuild inlines
 * `import.meta.env.*` at build time so the function bodies become
 * compile-time constants in production; the memoization is for clarity
 * and to give tests a single mock point.
 */

/**
 * Cell species popover — gates the Phase 1+ per-cell hover preview /
 * click popover / "Explore map markers" skip-link behind a runtime flag.
 * Default OFF (see `.env.example`). Flips to ON in Phase 3 (#560) as an
 * atomic cutover that also removes the runtime branching.
 *
 * Contract: returns `true` ONLY when `VITE_FF_CELL_POPOVER === 'true'`
 * (literal string match). Any other value — undefined, empty string,
 * "1", "yes", "TRUE" — returns false. Strict matching keeps the
 * runtime check unambiguous.
 */
const cellPopoverEnabled = import.meta.env.VITE_FF_CELL_POPOVER === 'true';

export function isCellPopoverEnabled(): boolean {
  return cellPopoverEnabled;
}
```

- [ ] **Step 3: Run the tests — confirm all 4 pass**

Run: `npm run test --workspace @bird-watch/frontend -- feature-flags.test --run 2>&1 | tail -10`

Expected: 4 tests PASS. If any fail, inspect the `vi.stubEnv` behavior — `vi.resetModules()` is required before each re-import because the const is captured at module-load.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/feature-flags.ts frontend/src/feature-flags.test.ts
git commit -m "feat(map): isCellPopoverEnabled() feature-flag helper (#558)

Single-read memoized accessor for VITE_FF_CELL_POPOVER. Strict-equality
on 'true' string literal; everything else (undefined, empty, '1',
'TRUE') disables. 4 unit tests cover the 4 cases."
```

---

## Task 4: Create `<CellHoverPreview>` component with 12 failing tests (RED)

Spec §4.4 (preview): `role="tooltip"`, top 3 species rows, footer reads exactly **"Click for more"** when family has >3 species.

**Files:**
- NEW: `frontend/src/components/map/CellHoverPreview.tsx` (signature only — `throw new Error('not implemented')` body for body-only state)
- NEW: `frontend/src/components/map/CellHoverPreview.test.tsx`

- [ ] **Step 1: Write the test file FIRST (RED phase) — full file**

Create `frontend/src/components/map/CellHoverPreview.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CellHoverPreview } from './CellHoverPreview.js';
import type { SpeciesAggregate } from './adaptive-grid.js';

function species(comName: string, count: number, code: string | null = comName.slice(0, 6).toLowerCase()): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

describe('<CellHoverPreview>', () => {
  it('renders role="tooltip" on the root element', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="cell-1-hummingbirds-preview"
      />
    );
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('propagates the id prop onto the tooltip element', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="cell-1-hummingbirds-preview"
      />
    );
    expect(screen.getByRole('tooltip').id).toBe('cell-1-hummingbirds-preview');
  });

  it('renders the family header text in the format "<FamilyName> (N)"', () => {
    // The component resolves familyCode → display name via prettyFamily().
    // "hummingbirds" → "Hummingbirds" per the existing pretty-name table.
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={8}
        species={[species("Anna's Hummingbird", 8)]}
        id="x"
      />
    );
    expect(screen.getByText(/Hummingbirds \(8\)/)).toBeInTheDocument();
  });

  it('caps rows at top 3 species — ignores any beyond the 3rd', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={20}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
          species('Western Wood-Pewee', 1),
          species('Cassin\'s Kingbird', 1),
        ]}
        id="x"
      />
    );
    expect(screen.getByText('Black Phoebe', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Vermilion Flycatcher', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Say's Phoebe", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Western Wood-Pewee', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("Cassin's Kingbird", { exact: false })).not.toBeInTheDocument();
  });

  it('renders species in descending count order (consumer-supplied order preserved)', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={18}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
        ]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]).toHaveTextContent('Black Phoebe');
    expect(rows[1]).toHaveTextContent('Vermilion Flycatcher');
    expect(rows[2]).toHaveTextContent("Say's Phoebe");
  });

  it('shows the "Click for more" footer when species.length > 3', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={20}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
          species('Western Wood-Pewee', 1),
        ]}
        id="x"
      />
    );
    expect(screen.getByText('Click for more')).toBeInTheDocument();
  });

  it('does NOT show the footer when species.length === 3', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={18}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
        ]}
        id="x"
      />
    );
    expect(screen.queryByText('Click for more')).not.toBeInTheDocument();
  });

  it('does NOT show the footer when species.length === 1', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    expect(screen.queryByText('Click for more')).not.toBeInTheDocument();
  });

  it('renders the count-x-comName template "Nx <comName>" for each row', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={8}
        species={[species("Anna's Hummingbird", 5), species("Costa's Hummingbird", 3)]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]).toHaveTextContent("5x Anna's Hummingbird");
    expect(rows[1]).toHaveTextContent("3x Costa's Hummingbird");
  });

  it('renders no rows when species array is empty (defensive)', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={0}
        species={[]}
        id="x"
      />
    );
    expect(screen.queryAllByTestId('cell-hover-preview-row')).toHaveLength(0);
  });

  it('uses the .cell-hover-preview className on the root for stylesheet wiring', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    expect(screen.getByRole('tooltip').className).toContain('cell-hover-preview');
  });

  it('emits .cell-hover-preview__row className on each row for stylesheet wiring', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]?.className).toContain('cell-hover-preview__row');
  });
});
```

- [ ] **Step 2: Create the skeleton component file**

Create `frontend/src/components/map/CellHoverPreview.tsx`:

```tsx
import type { SpeciesAggregate } from './adaptive-grid.js';

/**
 * `<CellHoverPreview>` — compact hover preview for an adaptive-grid cell
 * (epic #556 Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 3 species per family in descending count order. Footer "Click for
 * more" appears ONLY when the family has > 3 species — telling the user
 * to click for the full `<CellPopover>`. Tooltip role; no focus
 * management (tooltips don't take focus per WAI-ARIA tooltip pattern).
 */
export interface CellHoverPreviewProps {
  /** Family code; resolved to display name via `prettyFamily`. */
  familyCode: string;
  /** Total observations of this family in the cluster (badge value). */
  familyCount: number;
  /** Species in descending count order; consumer slices to ≤ 3 if desired. */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Required id used by the trigger's `aria-describedby`. */
  id: string;
}

export function CellHoverPreview(_props: CellHoverPreviewProps) {
  throw new Error('not implemented');
}
```

- [ ] **Step 3: Run tests — all 12 must FAIL**

Run: `npm run test --workspace @bird-watch/frontend -- CellHoverPreview --run 2>&1 | tail -20`

Expected: 12 tests FAIL (all throwing `not implemented` or `Cannot read properties...`).

- [ ] **Step 4: Commit (RED)**

```bash
git add frontend/src/components/map/CellHoverPreview.tsx \
        frontend/src/components/map/CellHoverPreview.test.tsx
git commit -m "test(map): scaffold <CellHoverPreview> + 12 failing tests (#558)

RED phase per TDD. Component signature + tests; impl next commit."
```

---

## Task 5: Implement `<CellHoverPreview>` (GREEN)

**Files:**
- Modify: `frontend/src/components/map/CellHoverPreview.tsx`

- [ ] **Step 1: Replace the body with a working implementation**

Replace the throw-stub in `CellHoverPreview.tsx`:

```tsx
import type { SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';

/**
 * `<CellHoverPreview>` — compact hover preview for an adaptive-grid cell
 * (epic #556 Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 3 species per family in descending count order. Footer "Click for
 * more" appears ONLY when the family has > 3 species — telling the user
 * to click for the full `<CellPopover>`. Tooltip role; no focus
 * management (tooltips don't take focus per WAI-ARIA tooltip pattern).
 */
export interface CellHoverPreviewProps {
  /** Family code; resolved to display name via `prettyFamily`. */
  familyCode: string;
  /** Total observations of this family in the cluster (badge value). */
  familyCount: number;
  /** Species in descending count order; consumer slices to ≤ 3 if desired. */
  species: ReadonlyArray<SpeciesAggregate>;
  /** Required id used by the trigger's `aria-describedby`. */
  id: string;
}

const PREVIEW_CAP = 3;

export function CellHoverPreview(props: CellHoverPreviewProps) {
  const { familyCode, familyCount, species, id } = props;
  const visible = species.slice(0, PREVIEW_CAP);
  const hasMore = species.length > PREVIEW_CAP;

  return (
    <div
      role="tooltip"
      id={id}
      className="cell-hover-preview"
      data-testid="cell-hover-preview"
    >
      <div className="cell-hover-preview__header">
        {prettyFamily(familyCode)} ({familyCount})
      </div>
      <ul className="cell-hover-preview__rows">
        {visible.map((s) => (
          <li
            key={s.comName}
            className="cell-hover-preview__row"
            data-testid="cell-hover-preview-row"
          >
            {s.count}x {s.comName}
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="cell-hover-preview__footer">Click for more</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run tests — all 12 must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- CellHoverPreview --run 2>&1 | tail -10`

Expected: 12 PASS. The full frontend suite count is now 788 + 12 = 800.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  800 passed (800)`.

- [ ] **Step 4: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 5: Commit (GREEN)**

```bash
git add frontend/src/components/map/CellHoverPreview.tsx
git commit -m "feat(map): implement <CellHoverPreview> — 12 tests green (#558)

Top-3 species cap, role=tooltip, 'Click for more' footer when species
exceeds the cap. Reads family display name from prettyFamily(). No
focus management (WAI-ARIA tooltip pattern)."
```

---

## Task 6: Create `<CellPopover>` component with 15 failing tests (RED)

Spec §4.4 (popover): `role="dialog"` (non-modal), top 8 species + "…and N more species" footer when species.length > 8, footer copy is **"Click or tap for full list"** when species.length ≤ 8 (footer always present — copy varies), clickable rows when `speciesCode !== null`, ESC/click-outside dismiss + focus return.

**For Phase 1: `onSelectSpecies(speciesCode)` is single-arg (existing signature). Phase 3 widens to `(speciesCode, bbox)`.**

**Files:**
- NEW: `frontend/src/components/map/CellPopover.tsx`
- NEW: `frontend/src/components/map/CellPopover.test.tsx`

- [ ] **Step 1: Write the test file FIRST (RED phase)**

Create `frontend/src/components/map/CellPopover.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CellPopover } from './CellPopover.js';
import type { SpeciesAggregate } from './adaptive-grid.js';

function species(comName: string, count: number, code: string | null = comName.slice(0, 6).toLowerCase()): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

function makeAnchor(): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-testid', 'test-anchor');
  document.body.appendChild(btn);
  btn.focus();
  return btn;
}

describe('<CellPopover>', () => {
  it('renders role="dialog" on the root element', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('is non-modal — does not set aria-modal (or sets it to false)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    const modal = dialog.getAttribute('aria-modal');
    expect(modal === null || modal === 'false').toBe(true);
  });

  it('sets aria-labelledby pointing at the popover heading element id', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toBeTruthy();
  });

  it('renders the family header with "<FamilyName> (N)" format', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/Hummingbirds \(5\)/)).toBeInTheDocument();
  });

  it('caps rows at top 8 species — ignores any beyond the 8th', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <CellPopover
        familyCode="flycatchers"
        familyCount={150}
        species={many}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('cell-popover-row');
    expect(rows).toHaveLength(8);
  });

  it('shows "…and 4 more species" footer when species.length === 12', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <CellPopover
        familyCode="flycatchers"
        familyCount={150}
        species={many}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/…and 4 more species/)).toBeInTheDocument();
  });

  it('shows "Click or tap for full list" footer when species.length ≤ 8 (no overflow)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText('Click or tap for full list')).toBeInTheDocument();
  });

  it('renders rows with role="link" when speciesCode !== null', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByRole('link', { name: /Anna's Hummingbird/i })).toBeInTheDocument();
  });

  it('renders rows as <span> with NO link role when speciesCode === null (spuh/slash)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="sandpipers"
        familyCount={3}
        species={[species('Sandpiper sp.', 3, null)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sandpiper sp\./ })).toBeNull();
  });

  it('calls onSelectSpecies(speciesCode) when a clickable row is clicked', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByRole('link', { name: /Anna's Hummingbird/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });

  it('triggers onSelectSpecies on Enter key when a clickable row is focused', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const row = screen.getByRole('link', { name: /Anna's Hummingbird/i });
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
  });

  it('does NOT call onSelectSpecies when a null-code row is clicked', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="sandpipers"
        familyCount={3}
        species={[species('Sandpiper sp.', 3, null)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByText(/Sandpiper sp\./));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('calls onDismiss + returns focus to anchorEl when Escape is pressed', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('calls onDismiss when a click happens outside the popover', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the popover heading on mount', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(document.activeElement?.getAttribute('data-testid')).toBe('cell-popover-heading');
  });
});
```

- [ ] **Step 2: Create the skeleton component**

Create `frontend/src/components/map/CellPopover.tsx`:

```tsx
import type { SpeciesAggregate } from './adaptive-grid.js';

/**
 * `<CellPopover>` — full popover for an adaptive-grid cell (epic #556
 * Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 8 species per family with "…and N more species" footer when
 * species.length > 8. Clickable rows (role="link") when speciesCode is
 * non-null; static <span> for spuh/slash/hybrid taxa where eBird returns
 * no canonical code. Non-modal `role="dialog"`. ESC + click-outside
 * dismiss, focus returns to the triggering cell.
 *
 * Phase 1 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)` for the SpeciesDetailSurface bbox-scoped
 * variant.
 */
export interface CellPopoverProps {
  familyCode: string;
  familyCount: number;
  species: ReadonlyArray<SpeciesAggregate>;
  anchorEl: HTMLElement;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
}

export function CellPopover(_props: CellPopoverProps) {
  throw new Error('not implemented');
}
```

- [ ] **Step 3: Run tests — all 15 must FAIL**

Run: `npm run test --workspace @bird-watch/frontend -- CellPopover --run 2>&1 | tail -20`

Expected: 15 FAIL.

- [ ] **Step 4: Commit (RED)**

```bash
git add frontend/src/components/map/CellPopover.tsx \
        frontend/src/components/map/CellPopover.test.tsx
git commit -m "test(map): scaffold <CellPopover> + 15 failing tests (#558)

RED phase per TDD. Component signature + tests; impl next commit."
```

---

## Task 7: Implement `<CellPopover>` (GREEN)

**Files:**
- Modify: `frontend/src/components/map/CellPopover.tsx`

- [ ] **Step 1: Replace the body with the implementation**

Replace the throw-stub in `CellPopover.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';

/**
 * `<CellPopover>` — full popover for an adaptive-grid cell (epic #556
 * Phase 1, issue #558, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4).
 *
 * Top 8 species per family with "…and N more species" footer when
 * species.length > 8. Clickable rows (role="link") when speciesCode is
 * non-null; static <span> for spuh/slash/hybrid taxa where eBird returns
 * no canonical code. Non-modal `role="dialog"`. ESC + click-outside
 * dismiss, focus returns to the triggering cell.
 *
 * Phase 1 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)` for the SpeciesDetailSurface bbox-scoped
 * variant.
 */
export interface CellPopoverProps {
  familyCode: string;
  familyCount: number;
  species: ReadonlyArray<SpeciesAggregate>;
  anchorEl: HTMLElement;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
}

const POPOVER_CAP = 8;

export function CellPopover(props: CellPopoverProps) {
  const { familyCode, familyCount, species, anchorEl, onDismiss, onSelectSpecies } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const visible = species.slice(0, POPOVER_CAP);
  const overflow = species.length - POPOVER_CAP;
  const footerText =
    overflow > 0 ? `…and ${overflow} more species` : 'Click or tap for full list';

  // Move focus to the heading on mount (spec §4.8 — popover focus management).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // ESC dismiss + focus return.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent | globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
        anchorEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown as EventListener);
    return () => document.removeEventListener('keydown', onKeyDown as EventListener);
  }, [onDismiss, anchorEl]);

  // Click-outside dismiss.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onDismiss]);

  function onRowKeyDown(e: KeyboardEvent<HTMLAnchorElement>, code: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectSpecies(code);
    }
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={headingId}
      className="cell-popover"
      data-testid="cell-popover"
    >
      <header className="cell-popover__header">
        <h2
          ref={headingRef}
          id={headingId}
          className="cell-popover__heading"
          tabIndex={-1}
          data-testid="cell-popover-heading"
        >
          {prettyFamily(familyCode)} ({familyCount})
        </h2>
      </header>
      <ul className="cell-popover__rows">
        {visible.map((s) => {
          const clickable = s.speciesCode !== null;
          const code = s.speciesCode;
          if (clickable && code !== null) {
            return (
              <li key={s.comName} className="cell-popover__row cell-popover__row--clickable">
                <a
                  role="link"
                  tabIndex={0}
                  data-testid="cell-popover-row"
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectSpecies(code);
                  }}
                  onKeyDown={(e) => onRowKeyDown(e, code)}
                >
                  {s.count}x {s.comName}
                </a>
              </li>
            );
          }
          return (
            <li
              key={s.comName}
              className="cell-popover__row"
              data-testid="cell-popover-row"
            >
              <span>{s.count}x {s.comName}</span>
            </li>
          );
        })}
      </ul>
      <div className="cell-popover__footer">{footerText}</div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests — all 15 must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- CellPopover --run 2>&1 | tail -10`

Expected: 15 PASS. Full suite: 800 + 15 = 815.

- [ ] **Step 3: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 4: Commit (GREEN)**

```bash
git add frontend/src/components/map/CellPopover.tsx
git commit -m "feat(map): implement <CellPopover> — 15 tests green (#558)

Top-8 species cap, role=dialog, aria-labelledby heading, ESC + click-
outside dismiss, focus returns to anchorEl, clickable rows only when
speciesCode !== null, 'Click or tap for full list' vs '…and N more
species' footer copy decided by overflow count. Phase 1 keeps the
single-arg onSelectSpecies(code) signature; Phase 3 widens to (code,
bbox)."
```

---

## Task 8: Extend `<AdaptiveGridMarker>` — per-cell trigger surface + hit-extender toggle (RED → GREEN)

The biggest task. Adds 4 flag-gated behaviors to the existing `<AdaptiveGridMarker>`:

1. `<TileCell>` becomes a `<button>` (instead of `<div>`) when flag is ON AND pointer:fine.
2. The cell gets `tabIndex={0}` when active (per-cell keyboard session active), `aria-haspopup="dialog"`, `aria-expanded`, `aria-describedby` to preview id.
3. Hit-extender overlay style at the existing line range (current code: `pointerEvents: 'auto'` at line 139) becomes a ternary: `'none'` when `!isCoarsePointer && flag`, `'auto'` otherwise.
4. Per-cell `mouseenter` / `focus` shows `<CellHoverPreview>`; `click` / Enter / Space promotes to `<CellPopover>`; 250 ms mouseleave delay; ESC dismiss.

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx`
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx`

- [ ] **Step 1: Read the current TileCell + hit-overlay code**

Read `frontend/src/components/map/AdaptiveGridMarker.tsx` lines 110-310 to refamiliarize. The relevant landmarks:

- Hit-overlay style block at lines 132-140 — `pointerEvents: 'auto'`.
- `<span data-testid="adaptive-grid-marker-hit">` at lines 167-172.
- `TileCell` function at lines 218-293.
- `Badge` at lines 295-310.

- [ ] **Step 2: Add 6 new failing tests for the flag-gated behaviors**

Append to `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (at the end, before the final closing of the file):

```tsx
// --- Phase 1 (#558): flag-gated per-cell trigger surface ----------------------

describe('AdaptiveGridMarker — VITE_FF_CELL_POPOVER (Phase 1, #558)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Default matchMedia stub: pointer:fine = true, pointer:coarse = false.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: fine)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('flag OFF: <TileCell> renders as <div> with no per-cell ARIA (regression guard)', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'false');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    expect(cell.tagName).toBe('DIV');
    expect(cell.getAttribute('aria-haspopup')).toBeNull();
    expect(cell.getAttribute('aria-expanded')).toBeNull();
  });

  it('flag ON + pointer:fine: <TileCell> renders as <button> with ARIA wiring', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.getAttribute('aria-haspopup')).toBe('dialog');
    expect(cell.getAttribute('aria-expanded')).toBe('false');
    expect(cell.getAttribute('aria-describedby')).toMatch(/^cell-.*-preview$/);
  });

  it('flag ON + pointer:fine: hit-extender computed pointer-events is "none"', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const hit = screen.getByTestId('adaptive-grid-marker-hit');
    expect(hit.style.pointerEvents).toBe('none');
  });

  it('flag ON + pointer:coarse: hit-extender computed pointer-events is "auto" (mobile preserves whole-marker tap)', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={true}
        onClick={noop}
      />
    );
    const hit = screen.getByTestId('adaptive-grid-marker-hit');
    expect(hit.style.pointerEvents).toBe('auto');
  });

  it('flag ON + pointer:fine: mouseenter on a cell triggers <CellHoverPreview> render', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Hummingbirds \(5\)/)).toBeInTheDocument();
  });

  it('flag ON + pointer:fine: Enter on a focused cell promotes preview to popover', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(cell.getAttribute('aria-expanded')).toBe('true');
  });
});
```

Add `fireEvent`, `vi`, `beforeEach` to the existing import from `@testing-library/react` / `vitest` at the top of the file as needed.

- [ ] **Step 3: Run the new tests — all 6 must FAIL**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker --run 2>&1 | tail -20`

Expected: the 6 new tests FAIL; the existing 21 tests still PASS.

- [ ] **Step 4: Update `AdaptiveGridMarker.tsx` — extend `TileCell` + hit-extender**

Replace the body of `AdaptiveGridMarker.tsx`. The key changes:

1. Import `useState`, `useId`, `useRef`, `KeyboardEvent` from react; `useMediaQuery` from `../../hooks/use-media-query.js`; `isCellPopoverEnabled` from `../../feature-flags.js`; `CellHoverPreview` from `./CellHoverPreview.js`; `CellPopover` from `./CellPopover.js`.

2. The `AdaptiveGridMarker` function reads:
```ts
const flag = isCellPopoverEnabled();
const isPointerFine = useMediaQuery('(pointer: fine)');
const perCellInteractive = flag && isPointerFine && !isCoarsePointer;
```

3. Hit-overlay style ternary at line 139:
```ts
pointerEvents: perCellInteractive ? 'none' : 'auto',
```

4. `TileCell` becomes a `<button>` when `perCellInteractive`, with the ARIA wiring. New `TileCellProps`:
```ts
interface TileCellProps {
  tile: AdaptiveTile;
  showBadge: boolean;
  isNotable: boolean | undefined;
  perCellInteractive: boolean;
  cellId: string; // for aria-describedby preview id
  onCellMouseEnter?: () => void;
  onCellMouseLeave?: () => void;
  onCellFocus?: () => void;
  onCellBlur?: () => void;
  onCellClick?: () => void;
  onCellKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  isExpanded: boolean;
}
```

5. The `AdaptiveGridMarker` component owns the per-cell interaction state:
```ts
const [activeCell, setActiveCell] = useState<{ index: number; mode: 'preview' | 'popover' } | null>(null);
const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
const mouseLeaveTimers = useRef<Array<number | null>>([]);
const markerId = useId();
```

6. Per-cell handlers built inside `<AdaptiveGridMarker>`:

```ts
function onCellMouseEnter(i: number) {
  if (mouseLeaveTimers.current[i]) {
    window.clearTimeout(mouseLeaveTimers.current[i]!);
    mouseLeaveTimers.current[i] = null;
  }
  setActiveCell((prev) => (prev?.mode === 'popover' ? prev : { index: i, mode: 'preview' }));
}
function onCellMouseLeave(i: number) {
  // Spec §4.5: 250ms delay; skipped when click-promoted to popover.
  mouseLeaveTimers.current[i] = window.setTimeout(() => {
    setActiveCell((prev) => (prev?.index === i && prev.mode === 'preview' ? null : prev));
  }, 250);
}
function onCellFocus(i: number) {
  setActiveCell((prev) => (prev?.mode === 'popover' ? prev : { index: i, mode: 'preview' }));
}
function onCellBlur(i: number) {
  setActiveCell((prev) => (prev?.index === i && prev.mode === 'preview' ? null : prev));
}
function onCellClick(i: number) {
  setActiveCell({ index: i, mode: 'popover' });
}
function onCellKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    setActiveCell({ index: i, mode: 'popover' });
  }
}
function onPopoverDismiss() {
  setActiveCell(null);
  // Focus return handled inside <CellPopover> via anchorEl.
}
```

7. Conditional render of preview/popover at the marker's end (NOT inside the cell — both float over):

```tsx
{perCellInteractive && activeCell !== null && tiles[activeCell.index] && (
  activeCell.mode === 'preview' ? (
    <CellHoverPreview
      familyCode={tiles[activeCell.index]!.familyCode}
      familyCount={tiles[activeCell.index]!.count}
      species={tiles[activeCell.index]!.species}
      id={`cell-${markerId}-${tiles[activeCell.index]!.familyCode}-preview`}
    />
  ) : (
    cellRefs.current[activeCell.index] ? (
      <CellPopover
        familyCode={tiles[activeCell.index]!.familyCode}
        familyCount={tiles[activeCell.index]!.count}
        species={tiles[activeCell.index]!.species}
        anchorEl={cellRefs.current[activeCell.index]!}
        onDismiss={onPopoverDismiss}
        onSelectSpecies={(code: string) => {
          // Phase 1: emit single-arg, Phase 3 widens to (code, bbox).
          // The marker forwards to its parent via a new optional prop.
          if (props.onSelectSpecies) {
            props.onSelectSpecies(code);
          }
        }}
      />
    ) : null
  )
)}
```

(Add `onSelectSpecies?: (code: string) => void` to `AdaptiveGridMarkerProps`.)

8. Inside the `<button>` form of `<TileCell>`, the JSX:
```tsx
<button
  ref={(el) => { /* parent sets cellRefs.current[i] = el via callback ref threading */ }}
  type="button"
  tabIndex={perCellInteractive ? 0 : -1}
  data-testid="adaptive-grid-marker-cell-rendered" // (or -fallback / -pending)
  className="adaptive-grid-marker__cell"
  aria-label={`${prettyFamily(tile.familyCode)}, ${tile.count} observations`}
  aria-describedby={`cell-${cellId}-${tile.familyCode}-preview`}
  aria-haspopup="dialog"
  aria-expanded={isExpanded}
  onMouseEnter={onCellMouseEnter}
  onMouseLeave={onCellMouseLeave}
  onFocus={onCellFocus}
  onBlur={onCellBlur}
  onClick={(e) => { e.stopPropagation(); onCellClick?.(); }}
  onKeyDown={onCellKeyDown}
  style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
>
  {/* existing silhouette / badge / fallback rendering */}
</button>
```

The `<div>` form remains for the default (non-interactive) path.

Apply these mechanically; preserve every existing visual element (SVG, Badge, fallback-svg) inside both the `<div>` and `<button>` branches.

- [ ] **Step 5: Run the 6 new tests — all PASS**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker --run 2>&1 | tail -10`

Expected: 27 PASS total (21 existing + 6 new).

- [ ] **Step 6: Run full suite — confirm 800 + 15 + 6 = 821 baseline**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  821 passed (821)`.

- [ ] **Step 7: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/map/AdaptiveGridMarker.tsx \
        frontend/src/components/map/AdaptiveGridMarker.test.tsx
git commit -m "feat(map): per-cell trigger surface on AdaptiveGridMarker (#558)

Flag-gated (VITE_FF_CELL_POPOVER): <TileCell> becomes <button> with
aria-haspopup/aria-expanded/aria-describedby; mouseenter/focus shows
<CellHoverPreview>; click/Enter/Space promotes to <CellPopover>;
250ms mouseleave delay; ESC dismiss. Hit-extender pointerEvents
toggles 'none'/'auto' based on pointer:fine + flag.

With flag OFF, marker behavior identical to today (21 existing tests
still pass). 6 new tests cover the gated paths."
```

---

## Task 9: Wire `onSelectSpecies` prop through `MapCanvas` → `<AdaptiveGridMarker>`

`<AdaptiveGridMarker>` now accepts `onSelectSpecies?: (code: string) => void`. `MapCanvas.tsx` already has an `onSelectSpecies` prop from `MapSurface` / App. Thread it down to every `<AdaptiveGridMarker>` instantiation.

**Files:**
- Modify: `frontend/src/components/map/MapCanvas.tsx`

- [ ] **Step 1: Find the `<AdaptiveGridMarker>` JSX invocation**

Run: `grep -n "<AdaptiveGridMarker" frontend/src/components/map/MapCanvas.tsx`

Expected: a single hit around line 1472. The current invocation block (around lines 1472-1481):

```tsx
<AdaptiveGridMarker
  shape={anchor.rendered.shape}
  tiles={anchor.tiles ?? []}
  totalCount={anchor.point_count}
  uniqueFamilies={anchor.uniqueFamilies}
  ariaLabel={g.ariaLabel}
  isCoarsePointer={isCoarsePointer}
  isNotable={anchor.isNotable ?? false}
  onClick={() => handleGroupClick(g)}
/>
```

- [ ] **Step 2: Pass `onSelectSpecies` through if present**

Edit `frontend/src/components/map/MapCanvas.tsx`. Add an `onSelectSpecies` prop forwarding line in the marker invocation:

```tsx
<AdaptiveGridMarker
  shape={anchor.rendered.shape}
  tiles={anchor.tiles ?? []}
  totalCount={anchor.point_count}
  uniqueFamilies={anchor.uniqueFamilies}
  ariaLabel={g.ariaLabel}
  isCoarsePointer={isCoarsePointer}
  isNotable={anchor.isNotable ?? false}
  onClick={() => handleGroupClick(g)}
  {...(onSelectSpecies ? { onSelectSpecies } : {})}
/>
```

`MapCanvas` already accepts `onSelectSpecies` from `MapSurface` (props at line ~330). The conditional spread mirrors the existing patterns used in `MapSurface.tsx` (lines 224-227) to avoid passing `undefined`.

- [ ] **Step 3: Run tests + build**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- MapCanvas --run 2>&1 | tail -5
npm run build --workspace @bird-watch/frontend 2>&1 | tail -5
```

Expected: both clean. MapCanvas tests rely on jsdom's matchMedia stub which defaults to `false` for `(pointer: fine)`, so the popover path doesn't engage in MapCanvas's own tests — the wiring is exercised in the AdaptiveGridMarker tests (Task 8) and the Playwright drive (Task 13).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/map/MapCanvas.tsx
git commit -m "feat(map): thread onSelectSpecies from MapCanvas to AdaptiveGridMarker (#558)

The marker now forwards row clicks from <CellPopover> to App via the
existing onSelectSpecies prop. Phase 1 keeps the single-arg
signature; Phase 3 (#560) widens to (code, bbox)."
```

---

## Task 10: Write CSS rules for `<CellHoverPreview>`

**Files:**
- Modify: `frontend/src/components/ds/ds-primitives.css`

- [ ] **Step 1: Append new CSS block to ds-primitives.css**

Append at the bottom of `frontend/src/components/ds/ds-primitives.css`:

```css
/* ─────────────────────────────────────────────────────────────────────────────
   <CellHoverPreview> — Phase 1 (#558)
   Compact hover preview for adaptive-grid cells. Top 3 species; "Click for
   more" footer when species.length > 3. Tooltip-styled — no shadow stack,
   no focus ring.
   ───────────────────────────────────────────────────────────────────────────── */

.cell-hover-preview {
  position: absolute;
  z-index: calc(var(--z-panel) + 5);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: 4px;
  padding: var(--space-xs) var(--space-sm);
  font: var(--text-body-sm);
  color: var(--color-text-strong);
  max-width: 240px;
  pointer-events: none;
  /* Smart-flip positioning is consumer-supplied via inline style; defaults
     to below-cell when not specified. Phase 1 uses CSS-only positioning
     (left/top inline); Phase 3 may add Floating-UI for collision detection. */
}

.cell-hover-preview__header {
  font-weight: var(--font-weight-medium);
  margin-bottom: var(--space-xxs);
}

.cell-hover-preview__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cell-hover-preview__row {
  padding: 1px 0;
}

.cell-hover-preview__footer {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: var(--space-xxs);
  font-style: italic;
}

/* Dark theme override — matches the ds-primitives.css dark-mode pattern. */
[data-theme="dark"] .cell-hover-preview {
  background: var(--color-bg-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text-strong);
}

/* Forced-colors fallback (Windows High Contrast Mode + browser forced-colors
   emulation) — matches styles.css:1696 pattern. */
@media (forced-colors: active) {
  .cell-hover-preview {
    border: 1px solid ButtonBorder;
    background: Canvas;
    color: CanvasText;
  }
  .cell-hover-preview__footer {
    color: GrayText;
  }
}

/* Reduced-motion: no fade animation. The default render is instant;
   no JS animation lib in use. This block documents the contract for
   future authors. */
@media (prefers-reduced-motion: reduce) {
  .cell-hover-preview {
    /* No-op currently; reserved for future fade-in. */
  }
}
```

- [ ] **Step 2: Run existing CSS-driven tests + orphan-classname check**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- CellHoverPreview --run 2>&1 | tail -5
bash scripts/check-orphan-classnames.sh 2>&1 | tail -10
```

Expected: CellHoverPreview tests still PASS (CSS doesn't change test outcomes). Orphan check returns no findings for the new className list.

- [ ] **Step 3: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ds/ds-primitives.css
git commit -m "style(map): CSS rules for <CellHoverPreview> (#558)

Five-class style block with dark-theme + forced-colors + reduced-motion
branches. Tooltip-styled; pointer-events:none so the hover doesn't
absorb the mouse. Class list pinned by orphan-classname check."
```

---

## Task 11: Write CSS rules for `<CellPopover>`

**Files:**
- Modify: `frontend/src/components/ds/ds-primitives.css`

- [ ] **Step 1: Append new CSS block to ds-primitives.css**

Append at the bottom of `frontend/src/components/ds/ds-primitives.css`:

```css
/* ─────────────────────────────────────────────────────────────────────────────
   <CellPopover> — Phase 1 (#558)
   Non-modal dialog popover for adaptive-grid cells. Top 8 species + footer
   ("…and N more species" or "Click or tap for full list"). Clickable rows
   (role=link) when speciesCode !== null.
   ───────────────────────────────────────────────────────────────────────────── */

.cell-popover {
  position: absolute;
  z-index: calc(var(--z-panel) + 6);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  padding: var(--space-sm) var(--space-md);
  font: var(--text-body-sm);
  color: var(--color-text-strong);
  min-width: 240px;
  max-width: 320px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.cell-popover__header {
  margin-bottom: var(--space-xs);
}

.cell-popover__heading {
  font: var(--text-heading-sm);
  font-weight: var(--font-weight-medium);
  margin: 0;
  /* Focus target on popover mount; visible focus is rendered with the
     standard outline since the heading takes tabIndex=-1 for programmatic
     focus on open. */
}

.cell-popover__heading:focus,
.cell-popover__heading:focus-visible {
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

.cell-popover__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cell-popover__row {
  padding: 2px 0;
}

.cell-popover__row--clickable a[role="link"] {
  cursor: pointer;
  color: var(--color-text-link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cell-popover__row--clickable a[role="link"]:hover,
.cell-popover__row--clickable a[role="link"]:focus-visible {
  text-decoration-thickness: 2px;
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

.cell-popover__footer {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: var(--space-xs);
  font-style: italic;
}

/* Dark theme override. */
[data-theme="dark"] .cell-popover {
  background: var(--color-bg-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text-strong);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

/* Forced-colors fallback. */
@media (forced-colors: active) {
  .cell-popover {
    border: 1px solid ButtonBorder;
    background: Canvas;
    color: CanvasText;
    box-shadow: none;
  }
  .cell-popover__row--clickable a[role="link"] {
    color: LinkText;
  }
  .cell-popover__footer {
    color: GrayText;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cell-popover {
    /* No animation in v1; reserved for future scale-in/fade-in. */
  }
}
```

- [ ] **Step 2: Run tests + orphan check**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- CellPopover --run 2>&1 | tail -5
bash scripts/check-orphan-classnames.sh 2>&1 | tail -10
```

Expected: CellPopover tests still PASS; no orphan-classname findings.

- [ ] **Step 3: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ds/ds-primitives.css
git commit -m "style(map): CSS rules for <CellPopover> (#558)

Seven-class style block with dark-theme + forced-colors + reduced-motion
branches. Non-modal dialog visual treatment with subtle shadow + underlined
link rows. Class list pinned by orphan-classname check."
```

---

## Task 12: Add "Explore map markers" skip-link to `MapSurface` (RED → GREEN)

Spec §4.7 + issue #558 — Phase 1 ships this skip-link (pulled forward from earlier Phase 3 scope). The skip-link is visually hidden until focused; activating it sets focus to the first `<TileCell>`. Suppressed (`aria-hidden`, `tabIndex={-1}`) when `groups.length === 0`.

**Files:**
- Modify: `frontend/src/components/MapSurface.tsx`
- Modify: `frontend/src/components/MapSurface.test.tsx`

- [ ] **Step 1: Write the new failing tests FIRST**

Append to `frontend/src/components/MapSurface.test.tsx` (inside the existing `describe('MapSurface skip-link', ...)` block):

```tsx
// --- Phase 1 (#558): second skip-link "Explore map markers" --------------------

describe('MapSurface — VITE_FF_CELL_POPOVER skip-link (Phase 1, #558)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('flag OFF: no "Explore map markers" skip-link rendered (regression guard)', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'false');
    const { MapSurface } = await import('./MapSurface.js');
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} onExploreMapMarkers={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Explore map markers/i })).toBeNull();
  });

  it('flag ON: renders "Explore map markers" as a second skip-link', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onSkipToFeed={vi.fn()}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={true}
      />
    );
    expect(screen.getByRole('button', { name: /Explore map markers/i })).toBeInTheDocument();
  });

  it('flag ON: skip-link uses class="skip-link" so global hidden-until-focus style applies', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onSkipToFeed={vi.fn()}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={true}
      />
    );
    const link = screen.getByRole('button', { name: /Explore map markers/i });
    expect(link.className).toContain('skip-link');
  });

  it('flag ON: clicking the skip-link calls onExploreMapMarkers prop', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { MapSurface } = await import('./MapSurface.js');
    const onExplore = vi.fn();
    render(
      <MapSurface
        {...baseProps}
        onSkipToFeed={vi.fn()}
        onExploreMapMarkers={onExplore}
        hasMarkers={true}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Explore map markers/i }));
    expect(onExplore).toHaveBeenCalledTimes(1);
  });

  it('flag ON + empty viewport (hasMarkers=false): skip-link is aria-hidden and tabIndex=-1', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { MapSurface } = await import('./MapSurface.js');
    render(
      <MapSurface
        {...baseProps}
        onSkipToFeed={vi.fn()}
        onExploreMapMarkers={vi.fn()}
        hasMarkers={false}
      />
    );
    // queryByRole skips aria-hidden=true buttons; use a class-based query.
    const link = document.querySelector('[data-testid="explore-map-markers-skip-link"]') as HTMLElement | null;
    expect(link).toBeTruthy();
    expect(link!.getAttribute('aria-hidden')).toBe('true');
    expect(link!.getAttribute('tabIndex') ?? link!.tabIndex.toString()).toBe('-1');
  });
});
```

Make sure to add `vi`, `beforeEach`, `fireEvent` to the existing imports if not already there.

- [ ] **Step 2: Update `MapSurfaceProps` and `MapSurface()` body**

Edit `frontend/src/components/MapSurface.tsx`:

1. Add the new prop to the interface:

```ts
/**
 * Phase 1 (#558): skip-link handler for the new "Explore map markers"
 * skip-link. When activated, MapCanvas places focus on the first
 * <TileCell> of the first marker group. Optional — when absent, the
 * skip-link is not rendered regardless of the feature flag.
 */
onExploreMapMarkers?: () => void;
/**
 * Phase 1 (#558): whether the map currently has at least one
 * AdaptiveGrid marker visible. When false, the "Explore map markers"
 * skip-link is aria-hidden + tabIndex=-1 (cannot focus into a no-op
 * state per spec §4.7 empty-viewport policy). Defaults to true.
 */
hasMarkers?: boolean;
```

2. Update the function signature destructure and the JSX:

```tsx
export function MapSurface({
  observations,
  legendObservations,
  silhouettes,
  familyCode,
  onFamilyToggle,
  onSkipToFeed,
  onSelectSpecies,
  onViewportChange,
  onExploreMapMarkers,
  hasMarkers = true,
  // ... existing props
}: MapSurfaceProps) {
```

3. Inside the JSX, immediately after the existing `onSkipToFeed` button (around line 184), add:

```tsx
{onExploreMapMarkers && isCellPopoverEnabled() && (
  <button
    type="button"
    className="skip-link"
    data-testid="explore-map-markers-skip-link"
    aria-hidden={!hasMarkers || undefined}
    tabIndex={hasMarkers ? 0 : -1}
    onClick={() => {
      if (hasMarkers) onExploreMapMarkers();
    }}
  >
    Explore map markers
  </button>
)}
```

4. Add the feature-flag import at the top:

```ts
import { isCellPopoverEnabled } from '../feature-flags.js';
```

- [ ] **Step 3: Run new tests — all 5 must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- MapSurface --run 2>&1 | tail -10`

Expected: existing 4 tests still PASS + 5 new PASS = 9. Full suite: 821 + 5 = 826.

- [ ] **Step 4: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 5: Wire `onExploreMapMarkers` from `App.tsx`**

The implementer doesn't need to fully define what `onExploreMapMarkers` does end-to-end in Phase 1 — the focus-targeting on the first `<TileCell>` happens via the marker's own tab order once it becomes interactive (`tabIndex={0}` per Task 8). The skip-link's `onClick` calls a parent-provided function. For Phase 1, App.tsx wires it as a `document.querySelector('[data-testid="adaptive-grid-marker-cell-rendered"]') as HTMLElement | null` lookup + `el?.focus()`. This is the minimum-viable form; Phase 3 refines focus-targeting to `groups[0].anchor.px`.

Edit `frontend/src/App.tsx`. Find the JSX block that mounts `<MapSurface>` (search for `<MapSurface`). Add the new prop:

```tsx
<MapSurface
  observations={observations}
  // ... existing props
  onExploreMapMarkers={() => {
    const firstCell = document.querySelector(
      '[data-testid="adaptive-grid-marker-cell-rendered"], ' +
      '[data-testid="adaptive-grid-marker-cell-fallback"]'
    ) as HTMLElement | null;
    firstCell?.focus();
  }}
  hasMarkers={observations.length > 0}
/>
```

- [ ] **Step 6: Run full suite + build**

Run:
```bash
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
npm run build --workspace @bird-watch/frontend 2>&1 | tail -5
```

Expected: `Tests  826 passed (826)` + clean build.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/MapSurface.tsx \
        frontend/src/components/MapSurface.test.tsx \
        frontend/src/App.tsx
git commit -m "feat(map): 'Explore map markers' skip-link in MapSurface (#558)

Adds a second skip-link that places keyboard focus on the first
<TileCell>. Behind VITE_FF_CELL_POPOVER. Visually hidden until focused
(reuses .skip-link from styles.css). Suppressed via aria-hidden +
tabIndex=-1 when hasMarkers=false (empty viewport policy per spec §4.7).
App.tsx wires the handler to focus the first per-cell button via DOM
query; Phase 3 will refine this to groups[0].anchor.px."
```

---

## Task 13: Playwright MCP design-review capture (10 screenshots + zero-console)

Drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes. Captures 10 screenshots, confirms zero console errors at each, and uploads via `pr-screenshots-via-user-attachments` skill (simulated paste in chrome-devtools-mcp to produce `user-attachments/assets/<uuid>` URLs).

**Files:** None (verification + artifact capture only).

- [ ] **Step 1: Start the dev server with the flag ON**

Run:
```bash
VITE_FF_CELL_POPOVER=true npm run dev --workspace @bird-watch/frontend > /tmp/phase1-dev.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5173/
```

Expected: `http 200`.

- [ ] **Step 2: For each of 5 viewports, capture light + dark screenshots**

For each `{w, h}` in `[{1920,1080}, {1440,900}, {1024,768}, {768,1024}, {390,844}]`:

Light:
1. `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5173/`
2. `mcp__plugin_playwright_playwright__browser_resize` → `{width: w, height: h}`
3. `mcp__plugin_playwright_playwright__browser_evaluate` →
   ```js
   () => document.documentElement.setAttribute('data-theme', 'light')
   ```
4. `mcp__plugin_playwright_playwright__browser_wait_for` → "Bird Maps" heading.
5. Trigger the popover state visibly: hover the first cell via `mcp__plugin_playwright_playwright__browser_hover` on `[data-testid="adaptive-grid-marker-cell-rendered"]`; THEN click it via `mcp__plugin_playwright_playwright__browser_click` to promote to popover.
6. `mcp__plugin_playwright_playwright__browser_console_messages` → assert empty array.
7. `mcp__plugin_playwright_playwright__browser_take_screenshot` → save.

Dark:
1. Re-evaluate `document.documentElement.setAttribute('data-theme', 'dark')`.
2. Repeat steps 4-7.

**Important**: Do NOT use `prefers-color-scheme` emulation (per `CLAUDE.md` — the repo's `[data-theme]` attribute overrides the media query and emulation won't trigger it).

- [ ] **Step 3: Upload each screenshot via pr-screenshots-via-user-attachments skill**

Follow `~/.claude/skills/pr-screenshots-via-user-attachments/SKILL.md` to convert each screenshot into a `user-attachments/assets/<uuid>` URL via chrome-devtools-mcp simulated paste. The skill returns one URL per screenshot.

Verify count: `gh pr view <PR_NUM> --repo julianken/bird-sight-system --json body --jq '.body | [scan("user-attachments/assets/[a-f0-9-]++")] | length'` must return ≥10 before bot review.

- [ ] **Step 4: Save the 10 URLs in a scratch note for the PR body (Task 16)**

Format:
```
Mobile 390×844 (light): https://github.com/user-attachments/assets/<uuid>
Mobile 390×844 (dark):  https://github.com/user-attachments/assets/<uuid>
Tablet portrait 768×1024 (light): ...
...
```

- [ ] **Step 5: Stop the dev server**

Run: `kill $(lsof -ti :5173) 2>/dev/null || true`

---

## Task 14: Design-review subagent dispatch

Per `CLAUDE.md` "Design-review subagent invocation contract" (#445), dispatch a `ui-design:ui-designer` subagent with `model: "opus"` (explicit cross-tier override) for design review across all 5 viewports × 2 themes.

**Files:** None.

- [ ] **Step 1: Open the PR first (Task 16) so the PR URL exists**

(This task runs AFTER Task 16, in practice — but the contract belongs here for plan clarity.)

- [ ] **Step 2: Dispatch the design-review subagent**

Use the Task tool with these arguments (NOT the `/design-review` slash command):

```
subagent_type: "ui-design:ui-designer"
model: "opus"   # explicit override per CLAUDE.md — agent frontmatter declares
                # model: inherit; without this the subagent inherits the
                # orchestrator's model (sonnet) and cross-tier discipline fails.
prompt: |
  Design-review the cell-species-popover Phase 1 PR on bird-sight-system.

  PR: https://github.com/julianken/bird-sight-system/pull/<N>

  Design intent reference:
    - Spec: docs/specs/2026-05-15-cell-species-popover-design.md §4.4, §4.8
    - Plan: docs/plans/2026-05-15-cell-species-popover-phase-1.md

  Screenshots (10 total, 5 viewports × 2 themes):
    Mobile 390×844 (light/dark): <url1> / <url2>
    Tablet portrait 768×1024 (l/d): <url3> / <url4>
    Tablet landscape 1024×768 (l/d): <url5> / <url6>
    Desktop 1440×900 (l/d): <url7> / <url8>
    Wide 1920×1080 (l/d): <url9> / <url10>

  Acceptance criteria from the plan's quantified-literals manifest:
    - <CellHoverPreview> renders top 3 species with role=tooltip
    - <CellPopover> renders top 8 + footer with role=dialog
    - Hover-then-click promotion is visually distinct from hover alone
    - Both themes parity (light/dark)
    - Forced-colors fallback NOT in scope for this review (a11y audit owns it)

  Verdict format: PASS / FAIL with file:line-equivalent evidence.
  Cap findings at 3 per viewport per R3.
```

- [ ] **Step 3: Resolve any FAILs**

If the subagent returns FAIL: dispatch an implementer subagent per SDD to address the finding; re-dispatch the design-reviewer once fixed; iterate until PASS at all 5 viewports.

---

## Task 15: Full sanity sweep + knip + orphan-classname check

**Files:** None (verification).

- [ ] **Step 1: Full test suite**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  826+ passed`.

- [ ] **Step 2: Build clean**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Knip clean — no new findings**

Run: `npm run knip --workspace @bird-watch/frontend 2>&1 | tail -10`

Expected: no new findings. If knip flags `CellHoverPreview` or `CellPopover` as unused, that's a real issue — they should be referenced by `AdaptiveGridMarker.tsx` after Task 8. Inspect imports.

- [ ] **Step 4: Orphan-classname check**

Run: `bash scripts/check-orphan-classnames.sh 2>&1 | tail -10`

Expected: no new findings. Every className introduced in Tasks 4-7 is matched to a CSS selector in Tasks 10-11.

- [ ] **Step 5: Regression smoke with flag OFF**

Run:
```bash
unset VITE_FF_CELL_POPOVER
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: still 826 PASS (some env-stubbed tests will run both flag states). If the count drops below 788, a regression has crept in to the flag-OFF path — investigate before opening the PR.

- [ ] **Step 6: Flag-ON full suite**

Run:
```bash
VITE_FF_CELL_POPOVER=true npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 826 PASS.

---

## Task 16: Open PR + dispatch bot review + queue

**Files:** None.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin worktree-cell-popover-phase-1`

- [ ] **Step 2: Open the PR via gh CLI**

Use the `pr-workflow` skill. Title: `feat(map): cell-popover phase 1 — hover preview + popover + skip-link (#558)`.

Body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Required sections:

1. **Diagram**: Mermaid sequence diagram showing `<TileCell> hover → <CellHoverPreview> → <TileCell> click → <CellPopover> → onSelectSpecies(code)`.
2. **Summary**: 1-2 bullets pointing at spec §4.4 / §4.5 / §4.6 / §4.7 / §4.8 / §4.10 and issue #558.
3. **Screenshots**: 10 `user-attachments/assets/<uuid>` URLs from Task 13. Required for `frontend/**` PRs.
4. **Test plan**: checkboxes for `npm run typecheck && npm run test` (flag OFF + flag ON), new component tests, full Playwright MCP drive at 5 viewports.
5. **Plan reference**: link to this plan + issue #558.

- [ ] **Step 3: Verify CI green at HEAD before queuing**

Run: `gh pr checks <PR_NUM> --repo julianken/bird-sight-system`

Expected: `test`, `lint`, `build`, `e2e` all green. (Per CLAUDE.md memory: always verify CI green BEFORE `@Mergifyio queue`.)

If `lockfile-consistency` or `terraform-plan-drift-check` are red, those are NOT in the Mergify queue gate but are still useful signals — fix on the same branch if they're real.

- [ ] **Step 4: Dispatch the `julianken-bot` review subagent**

Per the `pr-workflow` skill. Reviewer model: **opus** (cross-tier discipline — implementer ran on sonnet via SDD per the issue brief; reviewer must be higher tier).

- [ ] **Step 5: Resolve bot findings if any**

If REVISE: dispatch a subagent fix per the SDD loop, re-review.

- [ ] **Step 6: After APPROVE, post `@Mergifyio queue`**

Literal-string body — no prose. Per `mergify-merge-workflow` skill.

- [ ] **Step 7: Wait for merge + close issue**

Background-watch the PR state until merged. Issue #558 auto-closes via the `closes #558` line in the PR body.

---

## Self-review

**Spec coverage check**:
- §4.4 (components): ✓ Tasks 4-7 (CellHoverPreview + CellPopover with role/footer copy/cap)
- §4.5 (desktop trigger surface): ✓ Task 8 (mouseenter/focus/click/Enter/Space/250ms-leave/ESC)
- §4.6 (hit-extender): ✓ Task 8 (pointerEvents ternary)
- §4.7 (keyboard + skip-link): ✓ Task 12 (skip-link with empty-viewport suppression)
- §4.8 (ARIA tree): ✓ Task 8 (aria-haspopup, aria-expanded, aria-describedby, label override)
- §4.10 (single-leaf preservation): preserved via outer-button handler in MapCanvas (unchanged); cells stop event propagation in Task 8 (`e.stopPropagation()` on cell click).
- §5.1 / §5.2 (component API): ✓ Tasks 4-7 (matches spec API)

All Phase 1 spec sections have at least one task. ✓

**Placeholder scan**:
```bash
grep -nE "TBD|TODO|XXX|placeholder text|TODO\(|todo\(|implement later|implement similarly|add appropriate" docs/plans/2026-05-15-cell-species-popover-phase-1.md
```
Expected: no matches. ✓

**className grep self-review** (project CSS sub-task gate):
```bash
grep -n "className" docs/plans/2026-05-15-cell-species-popover-phase-1.md | grep -v "grep\|CSS rules\|Step\|cell-hover-preview\|cell-popover\|skip-link\|adaptive-grid-marker"
```
Expected: every className appears either inside a component test (Tasks 4-7), the corresponding CSS sub-task (Tasks 10-11), or as a documented reuse of an existing selector (`.skip-link` in Task 12). ✓

**Quantified literals manifest filled**: ✓ at the top, 14 items.

**Multi-viewport design-review gate**: ✓ Task 13 (Playwright drive) + Task 14 (subagent dispatch).

**Cross-tier discipline**: ✓ — Implementer = sonnet (per the issue brief); reviewer = opus (Task 16 step 4).

**Feature-flag invariant**: ✓ — every new behavior gated on `isCellPopoverEnabled()` (Task 3) at module-level; with flag OFF, all 788 existing tests pass unchanged (Task 1 baseline, Task 15 sweep).
