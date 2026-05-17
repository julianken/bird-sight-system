# Cell Species Popover — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `<ClusterListPopover>` (mobile / coarse-pointer sheet-style popover) + wire `<AdaptiveGridMarker>` outer-button tap on `pointer:coarse` to open it, all gated by the existing `VITE_FF_CELL_POPOVER` flag (default OFF). With the flag OFF, every existing test in `main` must still pass and the marker must behave identically to today (834 tests green at baseline; the existing zoom-to-expansion outer-button click is preserved on coarse).

**Architecture:** Phase 1 already gates per-cell interactivity on `flag && isPointerFine && !isCoarsePointer` — Phase 2 adds the **coarse-pointer mirror**. The outer `<AdaptiveGridMarker>` `<button>` is preserved on `pointer:coarse` (the `perCellInteractive` ternary at `AdaptiveGridMarker.tsx:138` already keeps `OuterTag = 'button'` when `isCoarsePointer === true`). A new piece of marker-owned state (`isClusterListOpen`) drives mount of `<ClusterListPopover>` when the outer-button is tapped AND the flag is ON AND `isCoarsePointer === true`. The outer-button's existing `onClick` (`handleGroupClick` → `easeTo` / `setSelectedObs`) is **bypassed** in this mode; clicks open the popover instead. Single-leaf clusters (`point_count === 1`) STILL go to the existing obs popover — same single-leaf preservation contract as Phase 1 (spec §4.10).

**Tech Stack:** TypeScript strict · React 19 · Vitest 3.x · `@testing-library/react` 16.x · `@playwright/test` 1.49.x · MapLibre-GL 5.x · existing `@bird-watch/shared-types`.

**Issue:** #559 (subissue 3 of 4 in epic #556)
**Spec:** `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4 (`<ClusterListPopover>` row), §4.5 (mobile / coarse-pointer trigger surface), §4.8 (ARIA pattern row 3), §4.10 (single-leaf preservation), §5.3 (component API).
**Depends on:** Phase 1 (PR #563, squash-merged at `112d012`). The `<AdaptiveGridMarker>` mutations from Phase 1 are the shared substrate; Phase 2 modifies the same file.

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] **1 new component** shipped behind `VITE_FF_CELL_POPOVER`: `<ClusterListPopover>` (sheet-style, `role="dialog"`, collapsible family sections, top 8 species per family + "and N more", "Done" button bottom).
- [ ] **~12 unit tests for `<ClusterListPopover>`** covering: `role="dialog"`, `aria-labelledby` resolves to the popover heading element, top-2-families-expanded-initially + remaining families collapsed, expanded-family renders top 8 species + "and N more species" footer when family.species.length > 8, footer absent when ≤8, collapsible toggle click expands a previously-collapsed family + collapses a previously-expanded family, "Done" button dismisses + returns focus to anchor element, ESC dismisses + returns focus, click-outside dismisses + returns focus, focus trap inside popover while open (Tab from last focusable cycles to first; Shift+Tab from first cycles to last), clicking a species row with `speciesCode !== null` calls `onSelectSpecies(speciesCode)` (single-arg form — Phase 3 widens to `(speciesCode, bbox)`), null-`speciesCode` rows render as `<span>` (no link role; no onSelectSpecies call when clicked).
- [ ] **2 new `<AdaptiveGridMarker>` tests** covering the coarse-pointer popover path: (a) flag-ON + `pointer:coarse` + outer-button tap opens `<ClusterListPopover>` AND suppresses the existing `onClick` (`handleGroupClick`); (b) flag-OFF + `pointer:coarse` + outer-button tap STILL invokes the existing `onClick` (zoom-to-expansion preserved as the regression baseline).
- [ ] **New className list for `<ClusterListPopover>`** — 8 classes pinned in CSS sub-task: `cluster-list-popover`, `cluster-list-popover__header`, `cluster-list-popover__heading`, `cluster-list-popover__family`, `cluster-list-popover__family-toggle`, `cluster-list-popover__rows`, `cluster-list-popover__row`, `cluster-list-popover__footer`. Plus `cluster-list-popover__family--expanded` modifier on the family group element when its section is open. The CSS sub-task (Task 8) writes a single block for the full set; the orphan-classname check is run after.
- [ ] **1 new Playwright project entry** in `frontend/playwright.config.ts` named `coarse-pointer` — uses `devices['iPad (gen 6)']` (native 768×1024 with `hasTouch: true` AND `isMobile: true`); placed as a sibling alongside `dev-server` and `preview-build` so existing test runs do NOT inherit touch emulation by default; targets `map-cell-popover.spec.ts` cases tagged `@coarse`. **Why `iPad (gen 6)` and not `iPad (gen 7)`**: gen 7 is 810×1080 — does not match a canonical viewport from `CLAUDE.md`'s 5-viewport set; gen 6 is 768×1024 which matches the canonical `iPad portrait (tablet)` row exactly. Per the bot review comment on issue #559.
- [ ] **1 new e2e scenario** in `frontend/e2e/map-cell-popover.spec.ts` at 768×1024 with touch emulation, tagged `@coarse`: tap a multi-leaf marker → cluster list popover slides up; expand a collapsed family → top species rows visible; tap a species → SpeciesDetailSurface (no bbox until Phase 3); tap "Done" → focus returns to outer marker button + popover unmounted. Verifies `pointer:coarse` partition AND end-to-end species link wiring.
- [ ] **10 design-review screenshots** (5 viewports × 2 themes) captured via Playwright MCP — focus the 390×844 (mobile) and 768×1024 (tablet portrait) viewports for popover state since those are the touch-driven cases; 1024×768 / 1440×900 / 1920×1080 also drive the path under `coarse-pointer` emulation to confirm no desktop regression with the flag ON.
- [ ] **Zero console errors and zero console warnings** at each of the 5 canonical viewports (Playwright MCP `browser_console_messages` returns empty).
- [ ] **Existing 834 tests still pass with flag OFF** (`npm run test --workspace @bird-watch/frontend` exits 0; baseline at branch tip is 834 — Phase 1 raised it from 788 to 834).
- [ ] **All new tests pass with flag ON** (`VITE_FF_CELL_POPOVER=true npm run test --workspace @bird-watch/frontend` exits 0).
- [ ] **`npm run build --workspace @bird-watch/frontend`** clean (no new TS errors).
- [ ] **Knip clean** — no new findings introduced.
- [ ] **Orphan-classname check clean** — every new className matched to a CSS selector.
- [ ] **Playwright `coarse-pointer` project runs green in CI** — verify the spec is picked up by the new project entry and runs at the iPad gen 6 device profile, NOT the default `dev-server` project.

## File map

| File | Status | Responsibility |
|---|---|---|
| `frontend/src/components/map/ClusterListPopover.tsx` | NEW | Mobile sheet-style popover; non-modal `role="dialog"`; collapsible family sections (initially top 2 expanded, rest collapsed); top 8 species per family + "and N more species"; "Done" button; ESC + click-outside + Done dismiss with focus return to anchor; focus trap while open |
| `frontend/src/components/map/ClusterListPopover.test.tsx` | NEW | ~12 unit tests |
| `frontend/src/components/map/AdaptiveGridMarker.tsx` | Modify | Add `isClusterListOpen` state + outer-button tap handler that opens popover when `flag && isCoarsePointer && !isSingleLeaf`; preserve single-leaf path; preserve flag-OFF zoom behavior; thread `onSelectSpecies` through to ClusterListPopover (single-arg form) |
| `frontend/src/components/map/AdaptiveGridMarker.test.tsx` | Modify | +2 new tests for coarse-pointer popover path; existing tests still pass |
| `frontend/src/components/ds/ds-primitives.css` | Modify | New className rules per CSS sub-task gate (8 classes + 1 modifier; light + dark + reduced-motion + forced-colors branches) |
| `frontend/playwright.config.ts` | Modify | Add `coarse-pointer` project entry (iPad gen 6 device profile) alongside existing `dev-server` and `preview-build` |
| `frontend/e2e/map-cell-popover.spec.ts` | Modify | Add `@coarse`-tagged tablet scenario; Phase 1 desktop tests untouched |

**CSS sub-task gate (per project writing-plans extension):** This plan ADDS 1 new component with className-driven styling. Every new className introduced is pinned to a CSS rule inside Task 8 (CSS rules for `<ClusterListPopover>`). The "Done" button uses the existing `.skip-link`-equivalent button styling per Phase 1's pattern — no new global selector required.

**Multi-viewport design-review gate (per project writing-plans extension):** Task 10 drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes (10 screenshots minimum), confirms zero console errors/warnings at each, and feeds the screenshot URLs into the PR body. Task 11 dispatches a `ui-design:ui-designer` subagent with `model: "opus"` for the design review pass.

---

## Task 1: Confirm worktree state and Phase 1 invariants

The Phase 2 worktree already exists at `/Users/j/repos/bird-watch/.claude/worktrees/cell-popover-phase-2` (branch `worktree-cell-popover-phase-2`, branched from `origin/main` after Phase 1 merge `112d012`).

**Files:** None — verification only.

- [ ] **Step 1: Confirm worktree state**

Run: `pwd && git log --oneline -3 && git status`

Expected:
- `pwd` → `/Users/j/repos/bird-watch/.claude/worktrees/cell-popover-phase-2`
- `git log` → topmost commit is `112d012 feat(map): cell-popover phase 1 — desktop popover + skip-link (#558) (#563)`
- `git status` → branch `worktree-cell-popover-phase-2`, working tree clean

- [ ] **Step 2: Verify Phase 1 deliverable is in place**

Run:

```bash
ls frontend/src/components/map/CellHoverPreview.tsx frontend/src/components/map/CellPopover.tsx frontend/src/feature-flags.ts
grep -n "isCellPopoverEnabled" frontend/src/feature-flags.ts
grep -n "perCellInteractive\|isCellPopoverEnabled\|CellHoverPreview\|CellPopover" frontend/src/components/map/AdaptiveGridMarker.tsx | head -10
```

Expected:
- All three files exist.
- `isCellPopoverEnabled` exported from `feature-flags.ts`.
- `AdaptiveGridMarker.tsx` imports both popover components and `isCellPopoverEnabled`; the `perCellInteractive` variable is defined and used as the gate for `pointer:fine` per-cell interactivity.

If any of these checks fail, STOP — Phase 1 has not landed at this branch tip and Phase 2 cannot proceed.

- [ ] **Step 3: Confirm baseline test count**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  834 passed (834)`. Note this number — every PR commit must keep it ≥ 834 with the flag OFF.

- [ ] **Step 4: Confirm AdaptiveGridMarker outer-button preservation contract on coarse**

Run: `grep -n "perCellInteractive\|OuterTag\|isCoarsePointer" frontend/src/components/map/AdaptiveGridMarker.tsx | head -10`

Expected: the `perCellInteractive` ternary at the OuterTag selection (around `AdaptiveGridMarker.tsx:138` and `:234`) is `flag && isPointerFine && !isCoarsePointer`. When `isCoarsePointer === true` the OuterTag is `'button'` (NOT `'div'`). This is the substrate Phase 2 depends on — the outer-button keeps `<button>` semantics on coarse-pointer so the new tap-to-open-popover behavior has a real `<button>` to attach to.

---

## Task 2: Create `<ClusterListPopover>` component with 12 failing tests (RED)

Spec §4.4 + §5.3: `role="dialog"` (non-modal), collapsible family sections (initially top 2 expanded, rest collapsed), top 8 species per family + "…and N more species" footer per-family when that family has > 8 species, "Done" button at bottom dismisses + returns focus to the anchor element (the outer marker `<button>`).

**For Phase 2: `onSelectSpecies(speciesCode)` is single-arg (matches Phase 1's `<CellPopover>` signature). Phase 3 widens to `(speciesCode, bbox)`.**

**Files:**
- NEW: `frontend/src/components/map/ClusterListPopover.tsx` (signature only — `throw new Error('not implemented')` body for RED phase)
- NEW: `frontend/src/components/map/ClusterListPopover.test.tsx`

- [ ] **Step 1: Write the test file FIRST (RED phase) — full file**

Create `frontend/src/components/map/ClusterListPopover.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClusterListPopover } from './ClusterListPopover.js';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';

function species(
  comName: string,
  count: number,
  code: string | null = comName.slice(0, 6).toLowerCase(),
): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

function family(familyCode: string, count: number): FamilyAggregate {
  // FamilyAggregate shape per adaptive-grid.ts. Phase 0 exported it.
  return { familyCode, count };
}

function makeAnchor(): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-testid', 'test-anchor');
  document.body.appendChild(btn);
  btn.focus();
  return btn;
}

function speciesByFamily(
  entries: Array<[string, ReadonlyArray<SpeciesAggregate>]>,
): ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>> {
  return new Map(entries);
}

describe('<ClusterListPopover>', () => {
  it('renders role="dialog" on the root element', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sets aria-labelledby pointing at the popover heading element id', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
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

  it('renders the cluster header with total count and unique families', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5), family('flycatchers', 12)]}
        speciesByFamily={speciesByFamily([
          ['hummingbirds', [species("Anna's Hummingbird", 5)]],
          ['flycatchers', [species('Black Phoebe', 12)]],
        ])}
        totalCount={17}
        uniqueFamilies={2}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Heading copy: "Cluster: 17 observations, 2 families".
    expect(screen.getByText(/17 observations/)).toBeInTheDocument();
    expect(screen.getByText(/2 families/)).toBeInTheDocument();
  });

  it('initially expands the top 2 families and collapses the rest', () => {
    const anchor = makeAnchor();
    const fams = [
      family('flycatchers', 30),
      family('hummingbirds', 20),
      family('sandpipers', 10),
      family('hawks', 5),
    ];
    render(
      <ClusterListPopover
        families={fams}
        speciesByFamily={speciesByFamily([
          ['flycatchers', [species('Black Phoebe', 30)]],
          ['hummingbirds', [species("Anna's Hummingbird", 20)]],
          ['sandpipers', [species('Sandpiper sp.', 10, null)]],
          ['hawks', [species("Cooper's Hawk", 5)]],
        ])}
        totalCount={65}
        uniqueFamilies={4}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Top 2 expanded: species rows visible.
    expect(screen.getByText(/Black Phoebe/)).toBeInTheDocument();
    expect(screen.getByText(/Anna's Hummingbird/)).toBeInTheDocument();
    // Bottom 2 collapsed: species rows NOT in DOM.
    expect(screen.queryByText(/Sandpiper sp\./)).toBeNull();
    expect(screen.queryByText(/Cooper's Hawk/)).toBeNull();
  });

  it('caps species at top 8 per family and renders "…and N more species" footer when > 8', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <ClusterListPopover
        families={[family('flycatchers', 150)]}
        speciesByFamily={speciesByFamily([['flycatchers', many]])}
        totalCount={150}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Eight rows visible; ninth onward suppressed.
    expect(screen.queryByText(/Species 1\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Species 8\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Species 9\b/)).toBeNull();
    expect(screen.queryByText(/Species 12\b/)).toBeNull();
    expect(screen.getByText(/…and 4 more species/)).toBeInTheDocument();
  });

  it('does NOT render the "and N more species" footer when family has ≤ 8 species', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.queryByText(/more species/)).toBeNull();
  });

  it('clicking a collapsed family toggle expands its species rows', () => {
    const anchor = makeAnchor();
    const fams = [
      family('flycatchers', 30),
      family('hummingbirds', 20),
      family('sandpipers', 10),
    ];
    render(
      <ClusterListPopover
        families={fams}
        speciesByFamily={speciesByFamily([
          ['flycatchers', [species('Black Phoebe', 30)]],
          ['hummingbirds', [species("Anna's Hummingbird", 20)]],
          ['sandpipers', [species('Sandpiper sp.', 10, null)]],
        ])}
        totalCount={60}
        uniqueFamilies={3}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // sandpipers initially collapsed (3rd family).
    expect(screen.queryByText(/Sandpiper sp\./)).toBeNull();
    // Find its toggle button — bound to family display name.
    const toggle = screen.getByRole('button', { name: /Sandpipers/i });
    fireEvent.click(toggle);
    // Now expanded.
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
  });

  it('clicking the "Done" button calls onDismiss and returns focus to anchorEl', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('pressing Escape calls onDismiss and returns focus to anchorEl', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('clicking outside the popover calls onDismiss', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
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

  it('clicking a species row with non-null speciesCode calls onSelectSpecies(code) with single arg', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByRole('link', { name: /Anna's Hummingbird/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });

  it('species row with null speciesCode renders as <span> (no link role; no callback on click)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('sandpipers', 3)]}
        speciesByFamily={speciesByFamily([['sandpipers', [species('Sandpiper sp.', 3, null)]]])}
        totalCount={3}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sandpiper sp\./ })).toBeNull();
    fireEvent.click(screen.getByText(/Sandpiper sp\./));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('focus trap: Tab from last focusable inside popover wraps to first', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Identify focusable order: heading (tabIndex=-1, programmatic only), family
    // toggle button(s), species link(s), Done button. The trap cycles Tab from
    // Done → first interactive (family toggle); Shift+Tab from first interactive → Done.
    const done = screen.getByRole('button', { name: /Done/i });
    done.focus();
    expect(document.activeElement).toBe(done);
    // Tab forward; container's keydown handler intercepts and wraps focus.
    fireEvent.keyDown(done, { key: 'Tab' });
    // First interactive after wrap: the family toggle button.
    expect(document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName).toMatch(/BUTTON|button/);
    // Reverse: Shift+Tab from family toggle wraps to Done.
    const firstFocusable = document.activeElement as HTMLElement;
    fireEvent.keyDown(firstFocusable, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });
});
```

- [ ] **Step 2: Create the skeleton component file**

Create `frontend/src/components/map/ClusterListPopover.tsx`:

```tsx
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';

/**
 * `<ClusterListPopover>` — mobile / coarse-pointer sheet-style popover for
 * the full cluster (epic #556 Phase 2, issue #559, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §5.3).
 *
 * Non-modal `role="dialog"`. Collapsible family sections — initially the top
 * 2 families (highest count) are expanded; the rest are collapsed. Each
 * expanded family shows the top 8 species + "…and N more species" footer
 * when that family has more. Spuh/slash/hybrid taxa with `speciesCode ===
 * null` render as static `<span>` (no link); otherwise as `<a role="link">`.
 *
 * Dismiss surfaces: "Done" button at bottom, ESC, click-outside. Each
 * returns focus to the supplied `anchorEl` (the outer marker `<button>`).
 *
 * Phase 2 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)` for the SpeciesDetailSurface bbox-scoped
 * variant.
 */
export interface ClusterListPopoverProps {
  /** All families in the cluster, descending count order (from `aggregateClusterFamilies`). */
  families: ReadonlyArray<FamilyAggregate>;
  /** Species lookup keyed by familyCode. */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  /** Total point_count for the cluster header. */
  totalCount: number;
  /** Total unique families for the cluster header. */
  uniqueFamilies: number;
  /** Anchor element for focus return. */
  anchorEl: HTMLElement;
  /** Invoked when user dismisses (ESC, click-outside, Done). */
  onDismiss: () => void;
  /** Invoked when user clicks a species row with non-null speciesCode. */
  onSelectSpecies: (speciesCode: string) => void;
}

export function ClusterListPopover(_props: ClusterListPopoverProps) {
  throw new Error('not implemented');
}
```

- [ ] **Step 3: Run tests — all 12 must FAIL**

Run: `npm run test --workspace @bird-watch/frontend -- ClusterListPopover --run 2>&1 | tail -20`

Expected: 12 tests FAIL (all throwing `not implemented` or `Cannot read properties...`).

- [ ] **Step 4: Commit (RED)**

```bash
git add frontend/src/components/map/ClusterListPopover.tsx \
        frontend/src/components/map/ClusterListPopover.test.tsx
git commit -m "test(map): scaffold <ClusterListPopover> + 12 failing tests (#559)

RED phase per TDD. Component signature + tests; impl next commit."
```

---

## Task 3: Implement `<ClusterListPopover>` (GREEN)

**Files:**
- Modify: `frontend/src/components/map/ClusterListPopover.tsx`

- [ ] **Step 1: Replace the body with the implementation**

Replace the throw-stub in `ClusterListPopover.tsx`:

```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';

/**
 * `<ClusterListPopover>` — mobile / coarse-pointer sheet-style popover for
 * the full cluster (epic #556 Phase 2, issue #559, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §5.3).
 *
 * Non-modal `role="dialog"`. Collapsible family sections — initially the top
 * 2 families (highest count) are expanded; the rest are collapsed. Each
 * expanded family shows the top 8 species + "…and N more species" footer
 * when that family has more. Spuh/slash/hybrid taxa with `speciesCode ===
 * null` render as static `<span>` (no link); otherwise as `<a role="link">`.
 *
 * Dismiss surfaces: "Done" button at bottom, ESC, click-outside. Each
 * returns focus to the supplied `anchorEl` (the outer marker `<button>`).
 *
 * Focus trap: Tab/Shift+Tab cycles within the popover while open. The
 * heading is `tabIndex={-1}` (programmatic focus only); interactive members
 * are the family toggle buttons, species link rows, and the Done button.
 *
 * Phase 2 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)`.
 */
export interface ClusterListPopoverProps {
  families: ReadonlyArray<FamilyAggregate>;
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  totalCount: number;
  uniqueFamilies: number;
  anchorEl: HTMLElement;
  onDismiss: () => void;
  onSelectSpecies: (speciesCode: string) => void;
}

const POPOVER_CAP_PER_FAMILY = 8;
const INITIAL_EXPANDED_FAMILIES = 2;

export function ClusterListPopover(props: ClusterListPopoverProps) {
  const {
    families,
    speciesByFamily,
    totalCount,
    uniqueFamilies,
    anchorEl,
    onDismiss,
    onSelectSpecies,
  } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  // Collapse-state: top 2 families expanded, rest collapsed. Per the spec's
  // §10 plan-body open question: state resets each time the popover opens
  // (no persistence). Component-local useState achieves this — when the
  // marker unmounts/re-mounts the popover, fresh defaults apply.
  const initialExpanded = useMemo<ReadonlySet<string>>(() => {
    const top = families.slice(0, INITIAL_EXPANDED_FAMILIES).map((f) => f.familyCode);
    return new Set(top);
  }, [families]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));

  function toggleFamily(familyCode: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(familyCode)) {
        next.delete(familyCode);
      } else {
        next.add(familyCode);
      }
      return next;
    });
  }

  // Focus the heading on mount (programmatic landing). Tab subsequently
  // moves into the first interactive (family toggle button).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // ESC dismiss + focus return.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
        anchorEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
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

  // Focus trap. Tab from the last focusable (Done) wraps to the first
  // (the first family toggle); Shift+Tab from the first wraps to Done.
  function onContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const focusables = rootRef.current?.querySelectorAll<HTMLElement>(
      'button, [role="link"], a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onDone() {
    onDismiss();
    anchorEl.focus();
  }

  function onSpeciesRowClick(code: string) {
    onSelectSpecies(code);
  }

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={headingId}
      className="cluster-list-popover"
      data-testid="cluster-list-popover"
      onKeyDown={onContainerKeyDown}
    >
      <header className="cluster-list-popover__header">
        <h2
          ref={headingRef}
          id={headingId}
          className="cluster-list-popover__heading"
          tabIndex={-1}
          data-testid="cluster-list-popover-heading"
        >
          Cluster: {totalCount} observations, {uniqueFamilies} families
        </h2>
      </header>
      <div>
        {families.map((fam) => {
          const allSpecies = speciesByFamily.get(fam.familyCode) ?? [];
          const visibleSpecies = allSpecies.slice(0, POPOVER_CAP_PER_FAMILY);
          const overflow = allSpecies.length - POPOVER_CAP_PER_FAMILY;
          const isExpanded = expanded.has(fam.familyCode);
          return (
            <div
              key={fam.familyCode}
              className={
                isExpanded
                  ? 'cluster-list-popover__family cluster-list-popover__family--expanded'
                  : 'cluster-list-popover__family'
              }
              data-testid={`cluster-list-popover-family-${fam.familyCode}`}
            >
              <button
                type="button"
                className="cluster-list-popover__family-toggle"
                aria-expanded={isExpanded ? 'true' : 'false'}
                onClick={() => toggleFamily(fam.familyCode)}
              >
                {prettyFamily(fam.familyCode)} ({fam.count})
              </button>
              {isExpanded && (
                <ul className="cluster-list-popover__rows">
                  {visibleSpecies.map((s) => {
                    const clickable = s.speciesCode !== null;
                    const code = s.speciesCode;
                    if (clickable && code !== null) {
                      return (
                        <li
                          key={s.comName}
                          className="cluster-list-popover__row"
                          data-testid="cluster-list-popover-row"
                        >
                          <a
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault();
                              onSpeciesRowClick(code);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSpeciesRowClick(code);
                              }
                            }}
                          >
                            {s.count}x {s.comName}
                          </a>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.comName}
                        className="cluster-list-popover__row"
                        data-testid="cluster-list-popover-row"
                      >
                        <span>{s.count}x {s.comName}</span>
                      </li>
                    );
                  })}
                  {overflow > 0 && (
                    <li className="cluster-list-popover__row">
                      <span>…and {overflow} more species</span>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <footer className="cluster-list-popover__footer">
        <button
          ref={doneRef}
          type="button"
          className="cluster-list-popover__done"
          onClick={onDone}
        >
          Done
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Run tests — all 12 must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- ClusterListPopover --run 2>&1 | tail -10`

Expected: 12 PASS. The full frontend suite count is now 834 + 12 = 846.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  846 passed (846)`.

- [ ] **Step 4: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 5: Commit (GREEN)**

```bash
git add frontend/src/components/map/ClusterListPopover.tsx
git commit -m "feat(map): implement <ClusterListPopover> — 12 tests green (#559)

Mobile sheet popover. role=dialog, aria-labelledby heading, top-2-families-
expanded-initially with collapsible toggles, top-8 species per family +
'…and N more species' overflow, ESC + click-outside + Done dismiss with
focus return to anchor, Tab/Shift+Tab focus trap inside popover.

Phase 2 keeps the single-arg onSelectSpecies(code) signature; Phase 3 will
widen to (code, bbox)."
```

---

## Task 4: Wire `<AdaptiveGridMarker>` outer-button tap on coarse to open the popover (RED → GREEN)

The marker is already a `<button>` on `pointer:coarse` (Phase 1 preserved this). The outer-button's current `onClick` is the `handleGroupClick` prop — which does `easeTo` for multi-leaf clusters and `setSelectedObs` for single-leaf. Phase 2 introduces a **conditional bypass**: when `flag && isCoarsePointer && !isSingleLeaf`, the outer-button tap opens `<ClusterListPopover>` instead of calling `onClick`. Single-leaf clusters fall through to the existing `onClick` (preserves spec §4.10).

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.tsx`
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx`

- [ ] **Step 1: Write the 2 new failing tests FIRST (RED phase)**

Append to `frontend/src/components/map/AdaptiveGridMarker.test.tsx` (after the Phase 1 `describe('AdaptiveGridMarker — VITE_FF_CELL_POPOVER (Phase 1, #558)', ...)` block):

```tsx
// --- Phase 2 (#559): coarse-pointer cluster list popover ---------------------

describe('AdaptiveGridMarker — VITE_FF_CELL_POPOVER coarse-pointer (Phase 2, #559)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Coarse-pointer matchMedia stub: pointer:coarse = true, pointer:fine = false.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: coarse)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('flag ON + coarse + multi-leaf: outer-button tap opens <ClusterListPopover> AND suppresses onClick', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const onClick = vi.fn();
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
            { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
          ]),
          rendered('flycatchers', 12, 'M0 0L24 24Z', '#aaa', [
            { comName: 'Black Phoebe', count: 12, speciesCode: 'blkpho' },
          ]),
        ]}
        totalCount={17}
        uniqueFamilies={2}
        ariaLabel="Cluster: 17 observations, 2 families."
        isCoarsePointer={true}
        onClick={onClick}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    expect(outer.tagName).toBe('BUTTON');
    fireEvent.click(outer);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Cluster: 17 observations, 2 families/)).toBeInTheDocument();
    // onClick (zoom-to-expansion handler) must NOT fire on coarse + flag-ON.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('flag OFF + coarse + multi-leaf: outer-button tap STILL invokes onClick (zoom preserved)', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'false');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const onClick = vi.fn();
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', [
            { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
          ]),
          rendered('flycatchers', 12, 'M0 0L24 24Z', '#aaa', [
            { comName: 'Black Phoebe', count: 12, speciesCode: 'blkpho' },
          ]),
        ]}
        totalCount={17}
        uniqueFamilies={2}
        ariaLabel="Cluster: 17 observations, 2 families."
        isCoarsePointer={true}
        onClick={onClick}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    fireEvent.click(outer);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the 2 new tests — both must FAIL**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker --run 2>&1 | tail -10`

Expected: 2 new tests FAIL; the existing tests still PASS.

- [ ] **Step 3: Update `AdaptiveGridMarker.tsx` — add cluster-list popover wiring**

Edit `frontend/src/components/map/AdaptiveGridMarker.tsx`.

1. Add the import at the top (with the existing `CellHoverPreview` / `CellPopover` imports):

```ts
import { ClusterListPopover } from './ClusterListPopover.js';
import { aggregateClusterSpecies } from './adaptive-grid.js'; // NOT needed — see Step 4 below.
```

Actually — `aggregateClusterSpecies` operates on `ClusterLeafFeature[]` and `<AdaptiveGridMarker>` receives `tiles: AdaptiveTile[]` which ALREADY has `species` on each tile (Phase 0 threaded it). So the marker can derive `families` and `speciesByFamily` directly from `tiles` without re-aggregating. Drop the `aggregateClusterSpecies` import; only `ClusterListPopover` is new.

2. Inside the `AdaptiveGridMarker` function body, after the existing `perCellInteractive` definition, add:

```ts
const clusterListInteractive = flag && isCoarsePointer === true;
const [isClusterListOpen, setIsClusterListOpen] = useState<boolean>(false);
const outerRef = useRef<HTMLButtonElement | null>(null);

// Build the FamilyAggregate[] and speciesByFamily Map from tiles (Phase 0
// already threads `species` per tile; no re-aggregation needed).
const families = tiles.map((t) => ({ familyCode: t.familyCode, count: t.count }));
const speciesByFamily = new Map(tiles.map((t) => [t.familyCode, t.species]));

// Single-leaf preservation (spec §4.10): clusters with totalCount === 1 fall
// through to the existing onClick handler (which routes to setSelectedObs in
// MapCanvas). The cluster-list popover never opens for single-leaf markers.
const isSingleLeaf = props.totalCount === 1;
```

3. The `outerInteractiveProps` ternary needs a third branch for `clusterListInteractive`. Replace the existing definition with:

```ts
const OuterTag = perCellInteractive ? 'div' : 'button';
const outerInteractiveProps = perCellInteractive
  ? ({ role: 'group' as const })
  : ({
      type: 'button' as const,
      tabIndex: -1,
      ref: outerRef,
      onClick: (e: MouseEvent<HTMLElement>) => {
        if (clusterListInteractive && !isSingleLeaf) {
          // Phase 2: open the cluster-list popover instead of the parent's
          // zoom handler. Single-leaf clusters fall through to onClick
          // (preserves the existing tap-to-obs UX per spec §4.10).
          e.preventDefault();
          setIsClusterListOpen(true);
          return;
        }
        onClick(e);
      },
    });
```

Note: the existing `props.onClick` already fires for single-leaf clusters via `handleGroupClick(g)` at the `MapCanvas` site; that path stays unchanged.

4. Add the conditional `<ClusterListPopover>` mount at the end of the JSX, alongside the existing `<CellHoverPreview>` / `<CellPopover>` mount block:

```tsx
{clusterListInteractive && isClusterListOpen && outerRef.current && (
  <ClusterListPopover
    families={families}
    speciesByFamily={speciesByFamily}
    totalCount={props.totalCount}
    uniqueFamilies={props.uniqueFamilies}
    anchorEl={outerRef.current}
    onDismiss={() => setIsClusterListOpen(false)}
    onSelectSpecies={(code: string) => {
      if (onSelectSpecies) {
        onSelectSpecies(code);
      }
      // Dismiss after navigating so the popover doesn't linger over the new
      // surface. The species detail route will mount on top.
      setIsClusterListOpen(false);
    }}
  />
)}
```

5. Add `useRef` to the existing `import { useState, useId, useRef, useEffect } from 'react';` line — already present, no change.

- [ ] **Step 4: Run the 2 new tests — both must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker --run 2>&1 | tail -10`

Expected: existing AdaptiveGridMarker tests + the 2 new Phase 2 tests all PASS.

- [ ] **Step 5: Run full suite — confirm 846 + 2 = 848**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  848 passed (848)`.

- [ ] **Step 6: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/map/AdaptiveGridMarker.tsx \
        frontend/src/components/map/AdaptiveGridMarker.test.tsx
git commit -m "feat(map): outer-button tap opens <ClusterListPopover> on coarse pointer (#559)

Flag-gated (VITE_FF_CELL_POPOVER): when isCoarsePointer && !isSingleLeaf,
outer-button onClick is bypassed and opens the ClusterListPopover instead.
Single-leaf clusters fall through to the existing handler (spec §4.10).
With the flag OFF, the marker behaves identically to today — the existing
zoom-to-expansion onClick is preserved as the regression baseline.

2 new tests pin the flag-ON-tap-opens-popover and flag-OFF-tap-preserves-
zoom paths."
```

---

## Task 5: Verify single-leaf preservation across the new code path (regression guard)

The single-leaf path is a load-bearing invariant from spec §4.10. The new outer-button handler MUST NOT intercept clicks for `totalCount === 1` clusters. Phase 2 already implements the `isSingleLeaf` guard in Task 4; this task adds an explicit regression test.

**Files:**
- Modify: `frontend/src/components/map/AdaptiveGridMarker.test.tsx`

- [ ] **Step 1: Append a single-leaf regression test**

Append to the Phase 2 `describe` block in `AdaptiveGridMarker.test.tsx`:

```tsx
  it('flag ON + coarse + single-leaf (totalCount===1): outer-button tap calls onClick (NOT cluster list popover)', async () => {
    vi.stubEnv('VITE_FF_CELL_POPOVER', 'true');
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const onClick = vi.fn();
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 1, 'M0 0L24 24Z', '#888', [
          { comName: "Anna's Hummingbird", count: 1, speciesCode: 'annhum' },
        ])]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Anna's Hummingbird."
        isCoarsePointer={true}
        onClick={onClick}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    fireEvent.click(outer);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
```

- [ ] **Step 2: Run the test — must PASS**

Run: `npm run test --workspace @bird-watch/frontend -- AdaptiveGridMarker --run 2>&1 | tail -10`

Expected: PASS. If it FAILS, the `isSingleLeaf` guard in Task 4 step 3 is wrong — fix the condition.

- [ ] **Step 3: Run full suite — confirm 849**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  849 passed (849)`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/map/AdaptiveGridMarker.test.tsx
git commit -m "test(map): pin single-leaf preservation for coarse-pointer path (#559)

Regression guard: totalCount===1 + isCoarsePointer + flag ON must still
route to the parent onClick handler (sets selectedObs in MapCanvas).
Spec §4.10 invariant; new test pins it."
```

---

## Task 6: Verify that `onSelectSpecies` is already threaded from MapCanvas (no change required)

Phase 1 Task 9 already wired `onSelectSpecies` from `App.tsx` → `MapSurface` → `MapCanvas` → `<AdaptiveGridMarker>`. Phase 2's `<ClusterListPopover>` reuses the same prop; no additional wiring is needed at `MapCanvas`. This task is a verification step.

**Files:** None (verification).

- [ ] **Step 1: Confirm the prop chain is intact**

Run:

```bash
grep -n "onSelectSpecies" frontend/src/components/MapSurface.tsx frontend/src/components/map/MapCanvas.tsx frontend/src/App.tsx | head -10
```

Expected: every file in the chain passes `onSelectSpecies` through. If any is missing, Phase 1 Task 9 did not land cleanly — STOP and investigate.

- [ ] **Step 2: Confirm AdaptiveGridMarker forwards the prop to ClusterListPopover**

Run: `grep -n "onSelectSpecies" frontend/src/components/map/AdaptiveGridMarker.tsx`

Expected: at least 2 hits — one in `AdaptiveGridMarkerProps`, one in the JSX call to `<ClusterListPopover>` (and the existing Phase 1 calls to `<CellPopover>`).

- [ ] **Step 3: No commit — verification only**

---

## Task 7: Add the `coarse-pointer` Playwright project entry

Per the bot review on issue #559: `pointer:coarse` media-query state is set at **context creation time** in Playwright. `page.context().route(...)` is insufficient; the only reliable way is a per-project device profile that sets `hasTouch: true` + `isMobile: true`. The CLAUDE.md canonical viewport for `iPad portrait (tablet)` is 768×1024 — `devices['iPad (gen 6)']` matches exactly (gen 7 is 810×1080 and does NOT match a canonical viewport).

**Files:**
- Modify: `frontend/playwright.config.ts`

- [ ] **Step 1: Add the new project entry**

Edit `frontend/playwright.config.ts`. Add a `devices` import from `@playwright/test`, and add a third project entry. The full updated file:

```ts
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: '.playwright-out',
  ...(process.env.CI_PERF_GATE === 'true' ? {} : { grepInvert: /@perf/ }),
  projects: [
    {
      name: 'dev-server',
      // Exclude both preview-only specs AND coarse-pointer-only specs from
      // the default dev-server project — Phase 2 tags coarse tests with
      // `@coarse` and limits them to the new project below. The default
      // project must NOT inherit touch emulation.
      testIgnore: /.*\.preview\.spec\.ts$/,
      grepInvert: /@coarse/,
      use: {
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'preview-build',
      testMatch: /.*\.preview\.spec\.ts$/,
      use: {
        baseURL: 'http://localhost:4173',
      },
    },
    {
      // Phase 2 (#559): pointer:coarse media-query state is set at context
      // creation time, so per-test emulation via page.context().route(...) is
      // insufficient — the only reliable way is a device profile that sets
      // `hasTouch: true` AND `isMobile: true`. `iPad (gen 6)` is 768×1024
      // (matches CLAUDE.md canonical viewport for `iPad portrait (tablet)`).
      // `iPad (gen 7)` is 810×1080 and does NOT match a canonical viewport,
      // so it is explicitly NOT used here.
      //
      // Targets specs tagged `@coarse`. Currently scoped to
      // map-cell-popover.spec.ts.
      name: 'coarse-pointer',
      testIgnore: /.*\.preview\.spec\.ts$/,
      grep: /@coarse/,
      use: {
        ...devices['iPad (gen 6)'],
        baseURL: 'http://localhost:5173',
      },
    },
  ],
  webServer: [
    {
      command: `DATABASE_URL=${process.env.DATABASE_URL ?? 'postgres://birdwatch:birdwatch@localhost:5433/birdwatch'} npm run dev --workspace @bird-watch/read-api`,
      cwd: ROOT,
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev',
      cwd: __dirname,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command:
        'VITE_API_BASE_URL=http://localhost:8787 npm run build && npm run preview -- --port 4173 --strictPort',
      cwd: __dirname,
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
```

- [ ] **Step 2: Verify the new project is registered**

Run: `npx playwright test --list 2>&1 | tail -20`

Expected: listing shows the existing `[dev-server]` and `[preview-build]` projects PLUS a new `[coarse-pointer]` project. No specs are tagged `@coarse` yet (Task 9 adds the first one), so the `coarse-pointer` project should report `(no tests)` — that's expected at this commit.

- [ ] **Step 3: Confirm existing e2e specs are unaffected**

Run: `npm run e2e --workspace @bird-watch/frontend -- --project=dev-server 2>&1 | tail -10`

Expected: clean run. None of the existing specs are tagged `@coarse`; they all stay in the `dev-server` project and continue to pass.

(Note: if the project's normal e2e suite runs slow locally, scope this verification to a single spec, e.g. `npm run e2e -- --project=dev-server map-cell-popover` — Phase 1 left a stub spec that the next task extends.)

- [ ] **Step 4: Commit**

```bash
git add frontend/playwright.config.ts
git commit -m "chore(e2e): add coarse-pointer Playwright project (iPad gen 6, #559)

pointer:coarse media-query state is set at context creation time, so
per-test emulation via page.context().route(...) is insufficient — only a
device profile that sets hasTouch:true + isMobile:true reliably triggers
the coarse path. iPad gen 6 = 768×1024 (CLAUDE.md canonical viewport for
iPad portrait); iPad gen 7 is 810×1080 and does NOT match a canonical
viewport.

The dev-server project gains grepInvert: /@coarse/ so existing tests do
NOT accidentally inherit touch emulation. The coarse-pointer project is
scoped to @coarse-tagged tests in map-cell-popover.spec.ts."
```

---

## Task 8: Write CSS rules for `<ClusterListPopover>`

**Files:**
- Modify: `frontend/src/components/ds/ds-primitives.css`

- [ ] **Step 1: Append the new CSS block to ds-primitives.css**

Append at the bottom of `frontend/src/components/ds/ds-primitives.css` (after the existing `.cell-popover` block from Phase 1):

```css
/* ─────────────────────────────────────────────────────────────────────────────
   <ClusterListPopover> — Phase 2 (#559)
   Mobile / coarse-pointer sheet-style popover for the full cluster.
   Non-modal dialog. Collapsible family sections — initially top 2 expanded.
   ───────────────────────────────────────────────────────────────────────────── */

.cluster-list-popover {
  position: fixed;
  /* Slide up from the bottom of the viewport on mobile. On tablet portrait
     (768×1024), the popover sizes to its content and centers within the
     bottom 60% of the viewport. */
  left: var(--space-md);
  right: var(--space-md);
  bottom: var(--space-md);
  z-index: calc(var(--z-panel) + 7);
  max-height: 70vh;
  overflow-y: auto;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  padding: var(--space-md);
  font: var(--text-body-sm);
  color: var(--color-text-strong);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
}

.cluster-list-popover__header {
  margin-bottom: var(--space-sm);
}

.cluster-list-popover__heading {
  font: var(--text-heading-sm);
  font-weight: var(--font-weight-medium);
  margin: 0;
}

.cluster-list-popover__heading:focus,
.cluster-list-popover__heading:focus-visible {
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

.cluster-list-popover__family {
  border-bottom: 1px solid var(--color-border-subtle);
  padding: var(--space-xs) 0;
}

.cluster-list-popover__family:last-of-type {
  border-bottom: none;
}

.cluster-list-popover__family-toggle {
  all: unset;
  display: block;
  width: 100%;
  cursor: pointer;
  font-weight: var(--font-weight-medium);
  padding: var(--space-xxs) 0;
  /* The collapsed/expanded chevron is purely a CSS treatment — no extra DOM. */
}

.cluster-list-popover__family-toggle:focus,
.cluster-list-popover__family-toggle:focus-visible {
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

.cluster-list-popover__family-toggle::before {
  content: "▶ ";
  font-size: 10px;
  display: inline-block;
  width: 12px;
  color: var(--color-text-muted);
}

.cluster-list-popover__family--expanded > .cluster-list-popover__family-toggle::before {
  content: "▼ ";
}

.cluster-list-popover__rows {
  list-style: none;
  margin: 0;
  padding: 0 0 0 var(--space-sm);
}

.cluster-list-popover__row {
  padding: 2px 0;
}

.cluster-list-popover__row a[role="link"] {
  cursor: pointer;
  color: var(--color-text-link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cluster-list-popover__row a[role="link"]:hover,
.cluster-list-popover__row a[role="link"]:focus-visible {
  text-decoration-thickness: 2px;
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
  border-radius: 2px;
}

.cluster-list-popover__footer {
  margin-top: var(--space-md);
  display: flex;
  justify-content: flex-end;
}

.cluster-list-popover__done {
  all: unset;
  cursor: pointer;
  padding: var(--space-xs) var(--space-md);
  border-radius: 4px;
  background: var(--color-bg-accent);
  color: var(--color-text-on-accent);
  font-weight: var(--font-weight-medium);
  min-height: 44px; /* WCAG 2.5.5 — touch target ≥44×44 on coarse pointer. */
  min-width: 88px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cluster-list-popover__done:focus,
.cluster-list-popover__done:focus-visible {
  outline: 2px solid var(--color-text-strong);
  outline-offset: 2px;
}

/* Dark theme override. */
[data-theme="dark"] .cluster-list-popover {
  background: var(--color-bg-surface);
  border-color: var(--color-border-strong);
  color: var(--color-text-strong);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.6);
}

/* Forced-colors fallback (matches existing styles.css:1696 pattern). */
@media (forced-colors: active) {
  .cluster-list-popover {
    border: 1px solid ButtonBorder;
    background: Canvas;
    color: CanvasText;
    box-shadow: none;
  }
  .cluster-list-popover__row a[role="link"] {
    color: LinkText;
  }
  .cluster-list-popover__done {
    border: 1px solid ButtonBorder;
    background: ButtonFace;
    color: ButtonText;
  }
  .cluster-list-popover__family-toggle::before {
    color: GrayText;
  }
}

/* Reduced-motion: no slide-in animation in v1. Reserved for future. */
@media (prefers-reduced-motion: reduce) {
  .cluster-list-popover {
    /* No-op currently; reserved for future slide-in. */
  }
}
```

- [ ] **Step 2: Run existing tests + orphan-classname check**

Run:

```bash
npm run test --workspace @bird-watch/frontend -- ClusterListPopover --run 2>&1 | tail -5
bash scripts/check-orphan-classnames.sh 2>&1 | tail -10
```

Expected: ClusterListPopover tests still PASS (CSS doesn't change test outcomes). Orphan-classname check returns no findings for the 8 new classes (+ 1 modifier) introduced.

- [ ] **Step 3: Build**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ds/ds-primitives.css
git commit -m "style(map): CSS rules for <ClusterListPopover> (#559)

Eight-class style block + one modifier (--expanded) with dark-theme +
forced-colors + reduced-motion branches. Sheet-style positioning bottom-
fixed on mobile; collapsible-section chevron via ::before content; 44×44
touch-target on Done button per WCAG 2.5.5. Class list pinned by orphan-
classname check."
```

---

## Task 9: Extend `frontend/e2e/map-cell-popover.spec.ts` with the tablet `@coarse` scenario

The Phase 1 e2e spec already covers desktop hover-preview + click-promotion. Phase 2 adds one new test case tagged `@coarse` that runs under the new `coarse-pointer` Playwright project. The scenario: tap a multi-leaf marker → cluster-list popover slides up; expand a previously-collapsed family → species rows appear; tap a species → species detail surface; tap "Done" → popover dismissed, focus returns to outer marker.

**Files:**
- Modify: `frontend/e2e/map-cell-popover.spec.ts`

- [ ] **Step 1: Read the existing spec**

Run: `cat frontend/e2e/map-cell-popover.spec.ts | head -80`

Expected: Phase 1's spec exists with at least one passing test for desktop. Note the file's existing imports + page object usage.

- [ ] **Step 2: Append the @coarse scenario**

Edit `frontend/e2e/map-cell-popover.spec.ts`. Append at the end of the file:

```ts
// --- Phase 2 (#559): tablet coarse-pointer cluster-list popover --------------
//
// Runs under the `coarse-pointer` Playwright project (iPad gen 6, 768×1024,
// hasTouch:true + isMobile:true). The `@coarse` tag scopes this test to that
// project — the default `dev-server` project's grepInvert filters it out.

test('@coarse tablet portrait: tap marker opens cluster list, expand family, tap species', async ({ page }) => {
  // Hydrate with the feature flag ON via query param. (The build inlines
  // VITE_FF_CELL_POPOVER at compile time, so runtime override is via a
  // search-param the app code reads in non-prod. If that mechanism doesn't
  // exist, this test must run against a build with the flag enabled —
  // dev-server already inherits the project root's .env which defaults to
  // the flag OFF, so the test sets VITE_FF_CELL_POPOVER=true in the
  // webServer env for the coarse-pointer project. See playwright.config.ts
  // Task 7 amendment.)
  //
  // For Phase 2 simplicity, assume the dev-server is launched with
  // VITE_FF_CELL_POPOVER=true. Reviewers verify by inspecting the running
  // dev server's index.html for the flag-on conditional render.

  await page.goto('/');
  // Wait for the map render to complete (canonical pattern from
  // frontend/e2e/pages/MapAppPage; reuse if applicable).
  await page.locator('[data-testid="adaptive-grid-marker"]').first().waitFor({ state: 'visible' });

  // Tap a multi-leaf cluster marker.
  const marker = page.locator('[data-testid="adaptive-grid-marker"]').first();
  await marker.tap();

  // Cluster list popover appears.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/observations,.* families/i)).toBeVisible();

  // The first 2 families are expanded by default. Find a collapsed family
  // (a `cluster-list-popover__family` element WITHOUT the --expanded modifier)
  // and tap its toggle button.
  const collapsedToggle = page
    .locator('.cluster-list-popover__family:not(.cluster-list-popover__family--expanded) .cluster-list-popover__family-toggle')
    .first();
  await collapsedToggle.tap();
  // Some species row from a previously-collapsed family is now visible.
  await expect(page.getByTestId('cluster-list-popover-row').nth(8)).toBeVisible();

  // Tap a clickable species link.
  const link = page.getByRole('link').filter({ hasText: /\d+x/ }).first();
  await link.tap();

  // SpeciesDetailSurface renders (no bbox until Phase 3).
  await expect(page).toHaveURL(/[?&]view=detail/);

  // Navigate back to the map to verify Done-button focus return path.
  await page.goBack();
  await page.locator('[data-testid="adaptive-grid-marker"]').first().waitFor({ state: 'visible' });
  await marker.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Done/i }).tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  // Focus returned to outer marker — assert via evaluate (Playwright doesn't
  // expose `document.activeElement` directly through the locator API).
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
  expect(focusedTag).toBe('BUTTON');
});
```

- [ ] **Step 3: Update `playwright.config.ts` webServer to enable the flag for the coarse-pointer project**

This is critical: the `webServer` dev command in `playwright.config.ts` does NOT currently set `VITE_FF_CELL_POPOVER=true`, so the @coarse spec would run against a flag-OFF dev server and the popover would never appear.

Edit `frontend/playwright.config.ts`. Update the dev-server webServer command (the one that runs Vite on port 5173) to include the flag:

```ts
{
  // Start Vite dev server on port 5173 (proxies /api → 8787).
  // VITE_FF_CELL_POPOVER=true enables Phase 1 (cell popover) + Phase 2
  // (cluster list popover) features during e2e runs. The flag default in
  // .env is false; this override keeps the dev server flag-ON for tests
  // without affecting other workspaces.
  command: 'VITE_FF_CELL_POPOVER=true npm run dev',
  cwd: __dirname,
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
  timeout: 30_000,
},
```

The Phase 1 e2e was acceptable without this override because Phase 1's tests targeted the FALSE flag path (default off). Phase 2 needs flag ON to test the popover.

NOTE: this means the Phase 1 desktop test cases that depended on flag-off behavior also run with flag ON. Phase 1 already shipped its specs assuming a flag-aware test plan; review the assertions to ensure none of them break under flag ON. If any break, isolate them via a `test.describe.configure({ tag: '@flag-off' })` block + a grep filter; otherwise no change needed.

- [ ] **Step 4: Run the new spec under the new project**

Run: `npm run e2e --workspace @bird-watch/frontend -- --project=coarse-pointer map-cell-popover 2>&1 | tail -20`

Expected: the @coarse test runs (just 1 test) and PASSES. If the test fails because the popover doesn't appear, verify the flag is set in the webServer env via `curl http://localhost:5173 | grep -o 'VITE_FF_CELL_POPOVER'` while the server is up.

- [ ] **Step 5: Run the existing e2e specs under the default project to confirm no regressions**

Run: `npm run e2e --workspace @bird-watch/frontend -- --project=dev-server 2>&1 | tail -10`

Expected: all existing specs PASS. The `@coarse`-tagged test is filtered out via `grepInvert: /@coarse/` on the dev-server project (Task 7).

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e/map-cell-popover.spec.ts frontend/playwright.config.ts
git commit -m "test(e2e): @coarse tablet popover scenario + flag-ON webServer (#559)

Adds a @coarse-tagged Playwright test that runs under the new
coarse-pointer project (iPad gen 6, 768×1024). Drives: tap marker → cluster
list popover; expand collapsed family → species rows; tap species → species
detail surface; tap Done → focus returns to outer marker.

Also enables VITE_FF_CELL_POPOVER=true on the dev-server webServer command
so the e2e build runs against the flag-ON path. Phase 1 desktop specs
continue to work under flag ON."
```

---

## Task 10: Playwright MCP design-review capture (10 screenshots + zero-console)

Drives the dev server through Playwright MCP at all 5 canonical viewports × 2 themes. Captures 10 screenshots, confirms zero console errors at each, and uploads via `pr-screenshots-via-user-attachments` skill (simulated paste in chrome-devtools-mcp to produce `user-attachments/assets/<uuid>` URLs).

**Files:** None (verification + artifact capture only).

- [ ] **Step 1: Start the dev server with the flag ON**

Run:

```bash
VITE_FF_CELL_POPOVER=true npm run dev --workspace @bird-watch/frontend > /tmp/phase2-dev.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "http %{http_code}\n" http://localhost:5173/
```

Expected: `http 200`.

- [ ] **Step 2: For each of 5 viewports, capture light + dark screenshots showing the popover state**

For each `{w, h}` in `[{1920,1080}, {1440,900}, {1024,768}, {768,1024}, {390,844}]`:

**Light:**
1. `mcp__plugin_playwright_playwright__browser_navigate` → `http://localhost:5173/`.
2. `mcp__plugin_playwright_playwright__browser_resize` → `{width: w, height: h}`.
3. `mcp__plugin_playwright_playwright__browser_evaluate` → `() => document.documentElement.setAttribute('data-theme', 'light')`.
4. `mcp__plugin_playwright_playwright__browser_wait_for` → wait for the "Bird Maps" heading / map render.
5. Trigger the cluster-list-popover state:
   - On the mobile (390×844) and tablet portrait (768×1024) viewports: `browser_evaluate` to call `document.querySelector('[data-testid="adaptive-grid-marker"]').click()` since real touch events are awkward via MCP. The marker's onClick handler routes to the popover when `isCoarsePointer === true`. Confirm `isCoarsePointer` is detected by checking `window.matchMedia('(pointer: coarse)').matches` — if false (Playwright MCP defaults), patch via `Object.defineProperty(window, 'matchMedia', ...)` shim before triggering the click.
   - On desktop viewports (1024×768, 1440×900, 1920×1080): the cluster list popover does NOT appear (those are pointer:fine). Capture the marker hovered or with the Phase 1 `<CellPopover>` open to demonstrate the desktop fallback still works flag-on.
6. `mcp__plugin_playwright_playwright__browser_console_messages` → assert empty array.
7. `mcp__plugin_playwright_playwright__browser_take_screenshot` → save.

**Dark:**
1. Re-evaluate `document.documentElement.setAttribute('data-theme', 'dark')`.
2. Repeat steps 4-7.

**Important**: Do NOT use `prefers-color-scheme` emulation (per CLAUDE.md — the repo's `[data-theme]` attribute overrides the media query and emulation won't trigger it).

- [ ] **Step 3: Upload each screenshot via the `pr-screenshots-via-user-attachments` skill**

Follow `~/.claude/skills/pr-screenshots-via-user-attachments/SKILL.md` to convert each screenshot into a `user-attachments/assets/<uuid>` URL via chrome-devtools-mcp simulated paste. The skill returns one URL per screenshot.

Verify count: `gh pr view <PR_NUM> --repo julianken/bird-sight-system --json body --jq '.body | [scan("user-attachments/assets/[a-f0-9-]++")] | length'` must return ≥ 10 before bot review.

- [ ] **Step 4: Save the 10 URLs in a scratch note for the PR body (Task 13)**

Format:

```
Mobile 390×844 (light): https://github.com/user-attachments/assets/<uuid>
Mobile 390×844 (dark):  https://github.com/user-attachments/assets/<uuid>
Tablet portrait 768×1024 (light): ...
Tablet landscape 1024×768 (light): ...
Desktop 1440×900 (light): ...
Wide desktop 1920×1080 (light): ...
... (10 total)
```

- [ ] **Step 5: Stop the dev server**

Run: `kill $(lsof -ti :5173) 2>/dev/null || true`

---

## Task 11: Design-review subagent dispatch

Per CLAUDE.md "Design-review subagent invocation contract" (#445), dispatch a `ui-design:ui-designer` subagent with `model: "opus"` (explicit cross-tier override) for design review across all 5 viewports × 2 themes. The implementer ran on **sonnet** via SDD; the reviewer must run on **opus** for cross-tier discipline (NYU, January 2026).

**Files:** None.

- [ ] **Step 1: Open the PR first (Task 13) so the PR URL exists**

(This task runs AFTER Task 13, in practice — but the contract belongs here for plan clarity.)

- [ ] **Step 2: Dispatch the design-review subagent**

Use the Task tool with these arguments (NOT the `/design-review` slash command):

```
subagent_type: "ui-design:ui-designer"
model: "opus"
prompt: |
  Design-review the cell-species-popover Phase 2 PR on bird-sight-system.

  PR: https://github.com/julianken/bird-sight-system/pull/<N>

  Design intent reference:
    - Spec: docs/specs/2026-05-15-cell-species-popover-design.md §4.4, §4.5 (mobile section), §4.8 row 3, §5.3
    - Plan: docs/plans/2026-05-15-cell-species-popover-phase-2.md
    - Phase 1 PR for visual continuity reference: #563

  Screenshots (10 total, 5 viewports × 2 themes):
    Mobile 390×844 (light/dark): <url1> / <url2>
    Tablet portrait 768×1024 (l/d): <url3> / <url4>
    Tablet landscape 1024×768 (l/d): <url5> / <url6>
    Desktop 1440×900 (l/d): <url7> / <url8>
    Wide 1920×1080 (l/d): <url9> / <url10>

  Acceptance criteria from the plan's quantified-literals manifest:
    - <ClusterListPopover> renders with role=dialog
    - Top 2 families initially expanded; rest collapsed (chevron treatment visible)
    - Top 8 species per family + "…and N more species" overflow
    - Done button touch-target ≥44×44 px (WCAG 2.5.5)
    - Light + dark theme parity
    - Sheet-style positioning at mobile/tablet portrait viewports (390×844, 768×1024)
    - Desktop viewports (1440×900, 1920×1080) should NOT show the cluster-list popover
      (those are pointer:fine; Phase 1 <CellPopover> is the correct surface there)

  Verdict format: PASS / FAIL with file:line-equivalent evidence.
  Cap findings at 3 per viewport per R3.
```

- [ ] **Step 3: Resolve any FAILs**

If the subagent returns FAIL: dispatch an implementer subagent per SDD to address the finding; re-dispatch the design-reviewer once fixed; iterate until PASS at all 5 viewports.

---

## Task 12: Full sanity sweep + knip + orphan-classname check

**Files:** None (verification).

- [ ] **Step 1: Full test suite**

Run: `npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5`

Expected: `Tests  849+ passed`.

- [ ] **Step 2: Build clean**

Run: `npm run build --workspace @bird-watch/frontend 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Knip clean — no new findings**

Run: `npm run knip --workspace @bird-watch/frontend 2>&1 | tail -10`

Expected: no new findings. If knip flags `ClusterListPopover` as unused, that's a real issue — it should be referenced by `AdaptiveGridMarker.tsx` after Task 4. Inspect imports.

- [ ] **Step 4: Orphan-classname check**

Run: `bash scripts/check-orphan-classnames.sh 2>&1 | tail -10`

Expected: no new findings. Every className introduced in Tasks 2-3 is matched to a CSS selector in Task 8.

- [ ] **Step 5: Regression smoke with flag OFF**

Run:

```bash
unset VITE_FF_CELL_POPOVER
npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: still 849+ PASS (env-stubbed tests run both flag states). If the count drops below 834, a regression has crept in to the flag-OFF path — investigate before opening the PR.

- [ ] **Step 6: Flag-ON full suite**

Run:

```bash
VITE_FF_CELL_POPOVER=true npm run test --workspace @bird-watch/frontend -- --run 2>&1 | tail -5
```

Expected: 849+ PASS.

- [ ] **Step 7: E2E sweep — both projects**

Run:

```bash
npm run e2e --workspace @bird-watch/frontend -- --project=dev-server 2>&1 | tail -10
npm run e2e --workspace @bird-watch/frontend -- --project=coarse-pointer 2>&1 | tail -10
```

Expected: both green. The dev-server project must NOT pick up the `@coarse` test; the coarse-pointer project must pick up exactly 1 test (the Task 9 scenario) and PASS it.

---

## Task 13: Open PR + dispatch bot review + queue

**Files:** None.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin worktree-cell-popover-phase-2`

- [ ] **Step 2: Open the PR via the `pr-workflow` skill**

Title: `feat(map): cell-popover phase 2 — mobile cluster list popover (#559)`.

Body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim. Required sections:

1. **Diagram**: Mermaid sequence diagram showing `<AdaptiveGridMarker> outer tap → <ClusterListPopover> → family toggle → species row → onSelectSpecies(code) → SpeciesDetailSurface`.
2. **Summary**: 1-2 bullets pointing at spec §4.4 (`<ClusterListPopover>` row), §4.5 (mobile section), §5.3, and issue #559. Mention dependency on Phase 1 (PR #563).
3. **Screenshots**: 10 `user-attachments/assets/<uuid>` URLs from Task 10. Required for `frontend/**` PRs per CLAUDE.md.
4. **Test plan**: checkboxes for `npm run test` (flag OFF + flag ON), new component tests (12 ClusterListPopover + 2 AdaptiveGridMarker + 1 single-leaf regression), Playwright MCP drive at 5 viewports, `coarse-pointer` project e2e green.
5. **Plan reference**: link to this plan + issue #559 + spec.

- [ ] **Step 3: Verify CI green at HEAD before queuing**

Run: `gh pr checks <PR_NUM> --repo julianken/bird-sight-system`

Expected: `test`, `lint`, `build`, `e2e` all green. (Per CLAUDE.md memory: always verify CI green BEFORE `@Mergifyio queue`.)

If `lockfile-consistency`, `terraform-plan-drift-check`, or `orphan-classname-check` are red, those are NOT all in the Mergify queue gate but are still useful signals — fix on the same branch if they're real.

- [ ] **Step 4: Dispatch the `julianken-bot` review subagent**

Per the `pr-workflow` skill. Reviewer model: **opus** (cross-tier discipline — implementer ran on sonnet via SDD per the issue brief; reviewer must be higher tier).

- [ ] **Step 5: Resolve bot findings if any**

If REVISE: dispatch a subagent fix per the SDD loop, re-review.

- [ ] **Step 6: After APPROVE, post `@Mergifyio queue`**

Literal-string body — no prose. Per the `mergify-merge-workflow` skill.

- [ ] **Step 7: Wait for merge + close issue**

Background-watch the PR state until merged. Issue #559 auto-closes via the `closes #559` line in the PR body.

---

## Self-review

**Spec coverage check**:
- §4.4 (`<ClusterListPopover>` row): ✓ Tasks 2-3 (component + tests).
- §4.5 (mobile / coarse-pointer trigger): ✓ Task 4 (outer-button tap opens popover when flag && isCoarsePointer && !isSingleLeaf).
- §4.8 row 3 (ARIA pattern): ✓ Tasks 2-3 (role=dialog, aria-labelledby on heading, focus returns to outer button).
- §4.10 (single-leaf preservation): ✓ Task 4 step 3 + Task 5 (regression test for totalCount===1 + coarse + flag-ON).
- §5.3 (component API): ✓ Task 2 step 1 + Task 3 (matches spec API verbatim).

All Phase 2 spec sections have at least one task. ✓

**Phase-3 exclusions documented**:
- `bbox` URL threading: deferred to Phase 3 (`onSelectSpecies(code)` stays single-arg in Phase 2).
- `SpeciesDetailSurface` filtered view: deferred to Phase 3.
- Flag flip to default ON: deferred to Phase 3 (atomic per spec §10).
- Parent-spec amend: deferred to Phase 3 (folded in per #556 bot-review pass).

All Phase 3 work explicitly NOT addressed here. ✓

**Placeholder scan**:

```bash
grep -nE "TBD|TODO|XXX|placeholder text|TODO\(|todo\(|implement later|implement similarly|add appropriate" docs/plans/2026-05-15-cell-species-popover-phase-2.md
```

Expected: no matches. ✓

**className grep self-review** (project CSS sub-task gate):

```bash
grep -n "className" docs/plans/2026-05-15-cell-species-popover-phase-2.md | grep -v "grep\|CSS rules\|Step\|cluster-list-popover\|adaptive-grid-marker\|cell-popover\|cell-hover-preview"
```

Expected: every className appears either inside a component test (Tasks 2-3), the CSS sub-task (Task 8), or the conditional className-modifier rendering (Task 3 step 1's `cluster-list-popover__family--expanded` ternary). ✓

**Quantified literals manifest filled**: ✓ at the top, 13 items.

**Multi-viewport design-review gate**: ✓ Task 10 (Playwright drive) + Task 11 (subagent dispatch).

**Cross-tier discipline**: ✓ — Implementer = sonnet (per the issue brief); reviewer = opus (Task 11 + Task 13 step 4).

**Feature-flag invariant**: ✓ — every new behavior gated on `isCellPopoverEnabled()` (Phase 1's helper, reused) at module-level; with flag OFF, all 834 existing tests pass unchanged (Task 1 baseline, Task 12 sweep).

**Playwright config invariant**: ✓ — the `coarse-pointer` project is a SEPARATE entry alongside `dev-server` and `preview-build`. The `dev-server` project gains `grepInvert: /@coarse/` so existing specs do NOT inherit touch emulation. iPad gen 6 (NOT gen 7) — matches CLAUDE.md canonical viewport for tablet portrait (768×1024). Per #559 bot review.

**Phase 1 dependency**: ✓ — Phase 2 modifies `AdaptiveGridMarker.tsx` (shared substrate from Phase 1); ships AFTER Phase 1 (corrected from prior "independent of Phase 1" claim per #559 bot review).
