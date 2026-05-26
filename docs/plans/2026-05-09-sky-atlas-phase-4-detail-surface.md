# Sky Atlas — Phase 4 Detail-Surface Engineering Implementation Plan

> **Superseded by #719: phenology removed** — the phenology chart that this plan shipped into the detail surface was deleted in PR #719. The rest of this plan (modal, sheet, photo masthead, heading, family label, prose) is still current.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-flow `<SpeciesDetailSurface>` with two viewport-routed presentations that share one body component: a desktop `<dialog>` modal (Apple "Look Up" idiom — focus capture, ESC, backdrop) and a mobile bottom-sheet with three snap points (peek 96px / half 60% / full 100%−8px) whose ARIA `role` flips from `region` to `dialog` only at the full snap. Resolves the IA seam called out in the analysis report — detail had no close affordance, no back navigation, and no separation between map context and species reading.

**Architecture:** Three React components and one viewport-router branch in `<App>`. `<SpeciesDetailSurface>` becomes a presentational body component (photo masthead + heading + family + phenology + prose). `<SpeciesDetailModal>` wraps it in a native `<dialog>` reusing `AttributionModal.tsx:182–261` verbatim (same focus-capture, same `close` event single-source-of-truth). `<SpeciesDetailSheet>` wraps it in a `<div>` whose `role` and `aria-modal` flip with a snap-state machine driven by Pointer Events (no third-party drag library — touch-action discipline keeps the math local). Viewport selection lives in `<App>` via `matchMedia('(max-width: 760px)')`. iOS safe-area is one HTML meta change plus `padding-bottom: env(safe-area-inset-bottom)` on the sheet shell. Existing `SpeciesDetailSurface` analytics (`panel_opened` / `panel_dwell_ms` / `panel_scrolled_to_bottom`) lift unchanged into the new body; the `IntersectionObserver` re-roots onto the new scroll containers (modal `<div>` and sheet `<div>` — not `<main>`).

**Tech Stack:** TypeScript, React 18, Vitest 4, `@testing-library/react`, Playwright (axe), MapLibre GL 5. No new dependencies. Sheet drag uses native Pointer Events.

---

## Spec reference

This plan implements [Phase 4 of the Sky Atlas redesign](../design/02-phases/phase-4-detail-surface.md). The spec's acceptance criteria for Phase 4 (verbatim from the phase doc + cross-cutting from `architecture.md`, `accessibility.md`, `components.md`):

- Desktop modal opens from feed-row click / map popover / SpeciesAutocomplete commit; ESC closes; backdrop click closes; focus restores to trigger.
- Mobile sheet opens to peek snap on cluster tap / feed row tap; drag handle + drag-up snaps to half / full; drag-down past peek dismisses.
- At peek and half, map remains live + interactive underneath.
- At full, map gets `pointer-events: none` and `inert` set BEFORE the sheet's role flips to `dialog` — sequencing matters so SR never sees both as simultaneously browseable. On collapse the order reverses (React renders `role="region"` first, then JS removes `inert`).
- New axe assertions pass: `dialog[aria-labelledby]` resolves to a non-empty heading; `document.activeElement === #detail-title` after open; sheet at full has `role="dialog" aria-label="{species name}"`.
- LCP regression test: photo masthead loads <1s on dev hardware (Lighthouse).
- Analytics `IntersectionObserver` fires `panel_scrolled_to_bottom` inside the new scroll container (modal or sheet, NOT `<main>`).
- ESC handler scoped to focus inside the sheet — does NOT collapse the sheet when focus is on a map cluster.

This plan **depends on Phase 2 being merged** (`<Photo>`, `<FamilySilhouette>`, `<StatusBlock>` exist under `frontend/src/components/ds/`). It also depends on **G6 (iOS safe-area)** being tested on a physical iPhone X+ before the mobile sheet rolls out beyond beta. Both gates are documented in `docs/design/01-spec/open-questions.md`.

This plan is independent of Phases 3, 5, 6.

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/index.html` | Modify | Add `viewport-fit=cover` to the viewport meta so `env(safe-area-inset-bottom)` resolves to a non-zero value on iOS. |
| `frontend/src/lib/use-is-mobile.ts` | Create | Tiny hook around `matchMedia('(max-width: 760px)')` with subscribe/unsubscribe and SSR-safe initial value. Single source of truth for the desktop/mobile presentation split. |
| `frontend/src/lib/use-is-mobile.test.ts` | Create | Unit test the matchMedia mock + change-event subscription. |
| `frontend/src/components/SpeciesDetailSurface.tsx` | Modify (rewrite body) | Promote to presentational body component: consume `<Photo priority={true}>` masthead + `<h1 id="detail-title" tabIndex={-1}>`; existing analytics + `IntersectionObserver` preserved. |
| `frontend/src/components/SpeciesDetailSurface.test.tsx` | Modify | Update assertions for `<h1 id="detail-title">` (was `<h2 className="species-detail-common-name">`); add tests for `<Photo>` consumption + `priority={true}` prop. |
| `frontend/src/components/SpeciesDetailModal.tsx` | Create | Desktop `<dialog>` wrapper; reuses `AttributionModal.tsx:182–261` focus-capture / ESC / backdrop / `close`-event pattern. Initial focus on `#detail-title`, NOT close button. |
| `frontend/src/components/SpeciesDetailModal.test.tsx` | Create | `showModal()` opens; ESC closes; backdrop-click closes; `aria-labelledby="detail-title"`; focus restores to trigger. |
| `frontend/src/components/SpeciesDetailSheet.tsx` | Create | Mobile bottom-sheet with full snap-state machine (peek/half/full), Pointer Events drag, `role` flip, `inert` sequencing, scoped ESC. |
| `frontend/src/components/SpeciesDetailSheet.test.tsx` | Create | Snap transitions (peek→half→full→dismiss); role flip at full; `inert` set before `role` flip; ESC scoped to focus inside sheet. |
| `frontend/src/styles.css` | Modify | New CSS for `.species-detail-modal` + `.species-detail-sheet` + `.sheet-handle` + safe-area + `touch-action` discipline (handle `none`; sheet content `pan-y`). |
| `frontend/src/App.tsx` | Modify | Replace the `state.view === 'detail'` `<SpeciesDetailSurface>` render with viewport-routed `<SpeciesDetailModal>` (desktop) / `<SpeciesDetailSheet>` (mobile). Pass `mapContainerRef` (existing `#main-surface` ref) for `inert` toggling. |
| `frontend/e2e/axe.spec.ts` | Modify | Two new branches: detail dialog with photo (assert `aria-labelledby`, focused heading); sheet at full snap (assert `role="dialog"`, `aria-label`, map `inert`). |
| `frontend/e2e/sheet-snap.spec.ts` | Create | Playwright spec covering snap transitions, drag dismissal, role-flip ordering, ESC scoping. |

---

## Task 1: Promote `<SpeciesDetailSurface>` to consume `<Photo>` and `<h1>`

Resolves the spec's heading-element contract (`accessibility.md` §New contract — detail dialog heading + focus order). Replaces `<h2 className="species-detail-common-name">` (`SpeciesDetailSurface.tsx:219`) with `<h1 id="detail-title" tabIndex={-1}>`. Replaces the inlined `<SpeciesDetailVisual>` with `<Photo>` from Phase 2 — the photo masthead is now the surface's `<Photo priority={true}>` element. The component remains in-flow (rendered inside `<main>`) at the end of this task; the modal/sheet wrappers come in tasks 3 + 5.

`tabIndex={-1}` makes the heading programmatically focusable without putting it in the keyboard tab order — required so `dialog.querySelector('#detail-title').focus()` works in tasks 3 and 5.

**Files:**
- Modify: `frontend/src/components/SpeciesDetailSurface.tsx` (full rewrite of body)
- Modify: `frontend/src/components/SpeciesDetailSurface.test.tsx`

- [ ] **Step 1: Update existing `SpeciesDetailSurface.test.tsx` assertions to expect the new heading + `<Photo>` shape — write them as failing first.**

Find any test in `frontend/src/components/SpeciesDetailSurface.test.tsx` that asserts on `.species-detail-common-name` or `getByRole('heading', { level: 2 })` for the species name; update to expect `level: 1` and `id="detail-title"`. Add explicit assertions:

```typescript
  it('renders species name as <h1 id="detail-title" tabIndex={-1}>', async () => {
    apiClient.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={apiClient} />);
    const heading = await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    expect(heading).toHaveAttribute('id', 'detail-title');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('renders <Photo priority> masthead when photoUrl is present', async () => {
    apiClient.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={apiClient} />);
    const img = await screen.findByAltText(/vermilion flycatcher photo/i);
    // <Photo priority={true}> must produce loading="eager" and fetchpriority="high"
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('falls back to <FamilySilhouette> via <Photo> when photoUrl is null', async () => {
    apiClient.getSpecies = vi.fn().mockResolvedValue(VERMFLY); // no photoUrl
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={apiClient} />);
    // <Photo> renders <FamilySilhouette> internally when src === null;
    // the testid is the silhouette path, identical to the prior fallback.
    await screen.findByTestId('species-detail-silhouette');
  });
```

Use whatever fixture imports the existing tests use (`VERMFLY` / `VERMFLY_WITH_PHOTO` from `../../e2e/fixtures.js` or a unit-test fixture). If the unit-test fixture differs, mirror the fixture file already in use — do not introduce a parallel one.

- [ ] **Step 2: Run the unit tests to verify they fail.**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailSurface.test.tsx`

Expected: the three new tests fail. The first fails because the current heading is `<h2>` not `<h1>`. The second fails because the inlined `<SpeciesDetailVisual>` produces a plain `<img>` with no `loading` / `fetchpriority` attributes. The third may pass already (the silhouette-fallback testid is preserved by `<Photo>`'s internal `<FamilySilhouette>` render — but assert anyway, since the rewrite changes the path).

- [ ] **Step 3: Rewrite the component body to consume `<Photo>` and `<h1>`.**

Replace the entire contents of `frontend/src/components/SpeciesDetailSurface.tsx` with:

```tsx
import { useEffect, useRef } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import { analytics } from '../analytics.js';
import { PhenologyChart } from './PhenologyChart.js';
import { SpeciesDescription } from './SpeciesDescription.js';
import { Photo } from './ds/Photo.js';
import { StatusBlock } from './ds/StatusBlock.js';

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  apiClient: ApiClient;
}

/**
 * Presentational body of the detail surface (Phase 4). Composed inside
 * <SpeciesDetailModal> (desktop) and <SpeciesDetailSheet> (mobile);
 * never rendered directly in <main> after Phase 4 ships. The component
 * does not own scroll, dismiss, or focus-capture — those belong to its
 * wrappers.
 *
 * Heading contract (accessibility.md §New contract — detail dialog
 * heading + focus order):
 *   <h1 id="detail-title" tabIndex={-1}> is the dialog's accessible name
 *   target. Wrappers carry aria-labelledby="detail-title" and call
 *   dialog.querySelector('#detail-title').focus() after open.
 *
 * Photo contract (components.md §<Photo>):
 *   <Photo priority={true}> on the masthead → loading="eager"
 *   fetchpriority="high" so LCP stays <2.5s on mobile and <1s on dev
 *   hardware (Lighthouse).
 *
 * Analytics + IntersectionObserver are preserved unchanged from the
 * pre-Phase-4 implementation; panel_scrolled_to_bottom now fires
 * inside the wrapper's scroll container (modal or sheet), not <main>.
 */
export function SpeciesDetailSurface(props: SpeciesDetailSurfaceProps) {
  const { speciesCode, apiClient } = props;
  const detail = useSpeciesDetail(apiClient, speciesCode);
  const { loading, error, data } = detail;
  const { silhouettes } = useSilhouettes(apiClient);

  // Analytics: panel_opened / panel_dwell_ms (preserved from pre-Phase-4).
  useEffect(() => {
    if (!data?.speciesCode) return;
    const t0 = Date.now();
    const code = data.speciesCode;
    analytics.capture('panel_opened', {
      species_code: code,
      has_description: !!data.descriptionBody,
    });
    return () => {
      analytics.capture('panel_dwell_ms', {
        species_code: code,
        dwell_ms: Date.now() - t0,
      });
    };
  }, [data?.speciesCode]);

  // Bottom sentinel: panel_scrolled_to_bottom. Re-roots automatically
  // onto whichever ancestor scroll container hosts this body — the modal
  // <div> on desktop or the sheet <div> on mobile. IntersectionObserver
  // walks up to the nearest scrolling ancestor by default.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef<boolean>(false);
  const speciesCodeForObserver = data?.speciesCode;
  useEffect(() => {
    if (!speciesCodeForObserver) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;
    firedRef.current = false;
    const observer = new IntersectionObserver(entries => {
      const intersected = entries.some(entry => entry.isIntersecting);
      if (intersected && !firedRef.current) {
        firedRef.current = true;
        analytics.capture('panel_scrolled_to_bottom', {
          species_code: speciesCodeForObserver,
        });
        observer.disconnect();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [speciesCodeForObserver]);

  if (loading) {
    return (
      <StatusBlock
        state="loading"
        title="Loading species details…"
        surface="panel"
      />
    );
  }

  if (error) {
    return (
      <StatusBlock
        state="error"
        title="Could not load species details"
        surface="panel"
      />
    );
  }

  if (!data) {
    return null;
  }

  // The family lookup is preserved (used by <Photo> internally via the
  // silhouettes payload). The lookup itself is dead-code at this scope
  // because <Photo> threads its own family→silhouette resolution; we
  // keep the line as a sanity check that the silhouettes payload is
  // available before rendering.
  void silhouettes.find(s => s.familyCode === data.familyCode);

  return (
    <div className="species-detail-body">
      <Photo
        src={data.photoUrl ?? null}
        alt={`${data.comName} photo`}
        family={data.familyCode}
        priority={true}
        layout="masthead"
        {...(data.photoAttribution
          ? { attribution: { text: data.photoAttribution, href: data.photoAttributionUrl ?? '#' } }
          : {})}
      />
      <h1 id="detail-title" tabIndex={-1} className="detail-name">
        {data.comName}
      </h1>
      <p className="species-detail-sci-name"><em>{data.sciName}</em></p>
      <p className="species-detail-family">{data.familyName}</p>
      <PhenologyChart speciesCode={speciesCode} apiClient={apiClient} />
      <SpeciesDescription
        descriptionBody={data.descriptionBody}
        descriptionAttributionUrl={data.descriptionAttributionUrl}
      />
      <div
        ref={sentinelRef}
        data-testid="phenology-bottom-sentinel"
        aria-hidden="true"
      />
    </div>
  );
}
```

**If `data.photoAttribution` and `data.photoAttributionUrl` aren't fields on `SpeciesMeta`**, drop the `attribution` prop entirely — the photo credit threading already lives in `App.tsx` → `AttributionModal`. Verify by reading `packages/shared-types/src/species.ts` (or wherever `SpeciesMeta` is declared) before keeping the spread block.

- [ ] **Step 4: Run the unit tests to verify they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailSurface.test.tsx`

Expected: all three new tests pass plus all preserved tests. The analytics `panel_opened` / `panel_dwell_ms` / `panel_scrolled_to_bottom` tests should continue passing — the implementation is byte-identical for those paths.

- [ ] **Step 5: Run the full frontend suite to catch any consumer that imported `SpeciesDetailVisual`.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. `SpeciesDetailVisual` was a private function inside `SpeciesDetailSurface.tsx`; if any test imported it directly, the failure surfaces here.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/SpeciesDetailSurface.tsx frontend/src/components/SpeciesDetailSurface.test.tsx
git commit -m "$(cat <<'EOF'
feat(detail): consume <Photo> + <h1 id="detail-title"> (Sky Atlas Phase 4)

Promotes SpeciesDetailSurface to a presentational body that the Phase 4
modal (desktop) and sheet (mobile) wrappers compose. The species name is
now <h1 id="detail-title" tabIndex={-1}> per accessibility.md's heading
contract; the photo masthead is <Photo priority={true}> producing
loading="eager" fetchpriority="high" for LCP. Analytics + the bottom
IntersectionObserver re-root onto whatever scroll container the wrapper
provides — no behavior change.

Spec: docs/design/02-phases/phase-4-detail-surface.md
      docs/design/01-spec/accessibility.md (detail dialog heading + focus)
      docs/design/01-spec/components.md (<Photo>, priority prop)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the new axe assertion (initially failing)

Before any wrapper exists, add the axe branch that the modal must satisfy: `dialog[aria-labelledby]` resolves to a non-empty heading, and `document.activeElement === #detail-title` after open. The assertion is failing-first — the existing detail surface renders no `<dialog>`, so axe finds no dialog at all and the heading-focus check throws.

This pins the contract before the implementation. Tasks 3 and 5 make it pass.

**Files:**
- Modify: `frontend/e2e/axe.spec.ts`

- [ ] **Step 1: Add the failing axe branch for the desktop dialog photo path.**

In `frontend/e2e/axe.spec.ts`, add this test immediately after the existing `species detail surface with photoUrl has no WCAG 2/2.1 A/AA violations (desktop)` test (around line 134):

```typescript
  // Sky Atlas Phase 4 — detail dialog accessibility contract.
  // The detail surface is no longer in-flow; on desktop it renders as a
  // native <dialog> with aria-labelledby="detail-title", initial focus
  // on the heading (NOT the close button), and focus restoration to the
  // trigger on close. axe asserts on the rendered DOM at the moment the
  // dialog is open with a real photo loaded.
  test('species detail dialog (desktop) — aria-labelledby resolves; activeElement is heading', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // Wait for the dialog [open] attribute commit (mirrors the
    // AttributionModal pattern at AttributionModal.tsx:206-214 — visibility
    // alone races the open-attribute commit in headless Chromium).
    const dialog = page.locator('dialog.species-detail-modal');
    await expect(dialog).toHaveAttribute('open', '');

    // The dialog must reference a non-empty heading via aria-labelledby.
    await expect(dialog).toHaveAttribute('aria-labelledby', 'detail-title');
    const heading = page.locator('#detail-title');
    await expect(heading).toHaveText(/vermilion flycatcher/i);

    // Initial focus targets the heading, not the close button.
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('detail-title');

    // No WCAG violations under axe.
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });
```

Add the matching mobile-viewport test inside the existing `test.describe('at 390×844 mobile viewport', () => { ... })` block (around line 178), but assert against the SHEET at full snap, not a `<dialog>`:

```typescript
    // Sky Atlas Phase 4 — bottom-sheet at full snap accessibility contract.
    // The sheet is NOT a <dialog> at peek/half (map underneath stays
    // interactive); it flips to role="dialog" aria-modal="true" only at
    // full snap, with `inert` on #main-surface set BEFORE the role flip.
    test('species detail sheet (mobile) at full snap — role="dialog", map inert', async ({ page, apiStub }) => {
      await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
      await apiStub.stubPhotoImage();
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();

      const sheet = page.locator('.species-detail-sheet');
      await expect(sheet).toBeVisible();

      // The sheet opens at peek by default. Drive it to full via the
      // exposed test handle — the implementation MUST expose either a
      // `data-snap-state` attribute (preferred — declarative) or a
      // testing-only setter on `window` for the snap state. Phase 4 uses
      // `data-snap-state="peek|half|full"` on the sheet root.
      await sheet.getByRole('button', { name: /expand/i }).click();
      await sheet.getByRole('button', { name: /expand/i }).click();
      await expect(sheet).toHaveAttribute('data-snap-state', 'full');

      // At full: role flips to dialog, aria-label is the species name.
      await expect(sheet).toHaveAttribute('role', 'dialog');
      await expect(sheet).toHaveAttribute('aria-modal', 'true');
      await expect(sheet).toHaveAttribute('aria-label', /vermilion flycatcher/i);

      // The map landmark is inert — set BEFORE the role flip in JS, but
      // observable as a steady-state attribute once the transition settles.
      const main = page.locator('#main-surface');
      await expect(main).toHaveAttribute('inert', '');

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });
```

The implementation contract this test pins: the sheet exposes a "expand" button (the drag handle as a focusable button — accessibility.md §New contract — bottom-sheet ARIA: "The drag handle is the first focusable inside the sheet"). Clicking it advances one snap. Two clicks lifts peek→half→full. The implementation in task 5 honors this contract.

- [ ] **Step 2: Run the new tests to verify they fail.**

Run: `npm run test:e2e --workspace @bird-watch/frontend -- axe.spec.ts -g "Phase 4"` (Playwright filter on the new test names).

Expected: both new tests fail. The desktop test fails on `expect(dialog).toHaveAttribute('open', '')` because no `<dialog>` element exists at all yet. The mobile test fails on `expect(sheet).toBeVisible()` for the same reason.

- [ ] **Step 3: Commit.**

```bash
git add frontend/e2e/axe.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): pin Phase 4 detail dialog + sheet axe contracts (failing)

Adds two axe branches for Sky Atlas Phase 4. Initially failing — the
current detail surface renders in-flow without a <dialog> wrapper. Tasks
3 (modal) and 5 (sheet) make these pass.

Spec: docs/design/02-phases/phase-4-detail-surface.md
      docs/design/01-spec/architecture.md §axe e2e contract

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build `<SpeciesDetailModal>` (desktop `<dialog>` wrapper)

The desktop modal reuses `AttributionModal.tsx:182–261` verbatim with two surgical differences: (1) the dialog carries `aria-labelledby="detail-title"`, (2) initial focus targets `#detail-title` not the close button. Same `showModal()` open path, same `close` event single-source-of-truth focus restoration, same backdrop-click handler.

The wrapper does NOT own the body content — `<SpeciesDetailSurface>` (rewritten in task 1) renders inside.

**Files:**
- Create: `frontend/src/components/SpeciesDetailModal.tsx`
- Create: `frontend/src/components/SpeciesDetailModal.test.tsx`
- Modify: `frontend/src/styles.css` (add `.species-detail-modal` styles)

- [ ] **Step 1: Create the failing test file.**

Create `frontend/src/components/SpeciesDetailModal.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailModal } from './SpeciesDetailModal.js';
import { ApiClient } from '../api/client.js';
import { VERMFLY_WITH_PHOTO } from '../../e2e/fixtures.js';

// JSDOM does not implement HTMLDialogElement.showModal/close; polyfill
// minimally so the component's calls don't throw and the [open]
// attribute reflects the open state.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
      this.dispatchEvent(new Event('open'));
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
});

function makeClient(): ApiClient {
  const client = new ApiClient({ baseUrl: '' });
  client.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
  client.getSilhouettes = vi.fn().mockResolvedValue([]);
  return client;
}

describe('<SpeciesDetailModal>', () => {
  it('opens via showModal and exposes aria-labelledby="detail-title"', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    expect(dialog).toHaveAttribute('aria-labelledby', 'detail-title');
  });

  it('moves initial focus to #detail-title, not the close button', async () => {
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
      />
    );
    const heading = await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('ESC closes and calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('backdrop click closes (event.target === dialog)', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    const dialog = await screen.findByRole('dialog');
    // A bare click() on the dialog element bubbles with target === dialog
    // (the AttributionModal pattern: backdrop is the dialog itself when
    // clicked outside the content area).
    dialog.click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('restores focus to the trigger element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open detail';
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        triggerRef={{ current: trigger }}
      />
    );
    await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    document.body.removeChild(trigger);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (file does not exist).**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailModal.test.tsx`

Expected: all five tests fail with import error — `SpeciesDetailModal.tsx` does not yet exist.

- [ ] **Step 3: Implement `<SpeciesDetailModal>`.**

Create `frontend/src/components/SpeciesDetailModal.tsx`:

```tsx
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ApiClient } from '../api/client.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';

export interface SpeciesDetailModalProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /**
   * The element that opened the modal. Focus restores to it on close.
   * If absent, focus restores to whichever element was focused at the
   * moment of open (mirrors AttributionModal's previouslyFocusedRef).
   */
  triggerRef?: RefObject<HTMLElement | null>;
}

/**
 * Desktop detail modal (Sky Atlas Phase 4). Native <dialog> wrapper around
 * <SpeciesDetailSurface>. Reuses AttributionModal.tsx:182–261's focus
 * capture / ESC / backdrop / close-event single-source-of-truth pattern
 * verbatim, with two differences:
 *
 *   1. aria-labelledby="detail-title" (vs AttributionModal's aria-label)
 *   2. Initial focus targets #detail-title (the species heading), NOT
 *      the close button — accessibility.md §New contract — detail dialog
 *      heading + focus order.
 *
 * Open/close is controlled by the consumer: the modal calls
 * showModal() once on mount, and onClose() exactly once when any of
 * (manual close, ESC, backdrop click) fires. The consumer typically
 * unmounts the modal after onClose runs (App.tsx flips view away from
 * 'detail' via useUrlState.set).
 */
export function SpeciesDetailModal(props: SpeciesDetailModalProps) {
  const { speciesCode, apiClient, onClose, triggerRef } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Open on mount. Mirror AttributionModal.tsx:198–221 — guard double
  // showModal() throws and use queueMicrotask to defer focus past the
  // React commit.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previouslyFocusedRef.current =
      (triggerRef?.current as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);
    if (!dialog.open) {
      dialog.showModal();
    }
    queueMicrotask(() => {
      const heading = dialog.querySelector<HTMLElement>('#detail-title');
      heading?.focus();
    });
    // Mount-only effect: the dialog stays mounted until the consumer
    // unmounts it. Re-running on speciesCode change is unnecessary
    // because the body component remounts internally and the heading
    // re-focus is implicit on data-arrival via the surface's own focus
    // discipline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close-event single-source-of-truth: ESC, manual close(), backdrop
  // click → close() all converge here. Mirrors AttributionModal:234–261.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
      onClose();
    };
    const handleClick = (event: MouseEvent) => {
      // Backdrop click: target is the dialog itself only when the click
      // landed outside the content. Descendant clicks bubble with a
      // different target.
      if (event.target === dialog) {
        dialog.close();
      }
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  const onCloseClick = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="species-detail-modal"
      aria-labelledby="detail-title"
    >
      <button
        type="button"
        className="species-detail-modal-close"
        aria-label="Close species detail"
        onClick={onCloseClick}
      >
        ×
      </button>
      <SpeciesDetailSurface speciesCode={speciesCode} apiClient={apiClient} />
    </dialog>
  );
}
```

- [ ] **Step 4: Add styles for `.species-detail-modal`.**

Append to `frontend/src/styles.css`:

```css
/* Sky Atlas Phase 4 — desktop detail modal.
   Reuses AttributionModal's positioning model (centered, max-w cap,
   border-radius, surface-bg). The close button is top-right with a 32px
   tap target (chrome density tier). */
dialog.species-detail-modal {
  width: min(720px, 90vw);
  max-height: 85vh;
  padding: 0;
  border: none;
  border-radius: var(--radius-lg, 12px);
  background: var(--color-bg-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-modal, 0 8px 32px rgba(0, 0, 0, 0.18));
  overflow: auto;
}

dialog.species-detail-modal::backdrop {
  background: rgba(0, 0, 0, 0.45);
}

dialog.species-detail-modal .species-detail-modal-close {
  position: sticky;
  top: 8px;
  margin-left: auto;
  margin-right: 8px;
  display: block;
  width: 32px;
  height: 32px;
  font-size: 20px;
  line-height: 1;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-text-strong);
  z-index: 1;
}
```

- [ ] **Step 5: Run the modal tests to verify they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailModal.test.tsx`

Expected: all five tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/SpeciesDetailModal.tsx frontend/src/components/SpeciesDetailModal.test.tsx frontend/src/styles.css
git commit -m "$(cat <<'EOF'
feat(detail): SpeciesDetailModal desktop <dialog> wrapper (Sky Atlas Phase 4)

Reuses AttributionModal.tsx:182-261's focus-capture / ESC / backdrop /
close-event SOT pattern verbatim. Two differences vs AttributionModal:
aria-labelledby="detail-title" (not aria-label), and initial focus on
the heading (not the close button). Body component is the rewritten
SpeciesDetailSurface from task 1.

Spec: docs/design/02-phases/phase-4-detail-surface.md
      docs/design/01-spec/accessibility.md (heading + focus order)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire the modal into `<App>` (desktop branch only) and verify axe

Replace the `state.view === 'detail'` `<SpeciesDetailSurface>` render in `App.tsx:213–218` with a viewport-routed branch. The mobile path is a `null` placeholder for now — task 5 lands the sheet. After this task, the desktop axe assertion from task 2 turns green.

**Files:**
- Create: `frontend/src/lib/use-is-mobile.ts`
- Create: `frontend/src/lib/use-is-mobile.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/index.html` (`viewport-fit=cover`)

- [ ] **Step 1: Add `viewport-fit=cover` to `index.html`.**

Replace `frontend/index.html` line 5:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```

with:

```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

`viewport-fit=cover` is required so iOS resolves `env(safe-area-inset-bottom)` to a non-zero value. Without it, the sheet's bottom padding evaluates to `0` and the drag handle sits under the home indicator on notched devices. Pre-loaded here in task 4 so the change has shipped before the sheet ships in task 5.

- [ ] **Step 2: Create `useIsMobile` hook test (failing first).**

Create `frontend/src/lib/use-is-mobile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobile } from './use-is-mobile.js';

describe('useIsMobile', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void>;
  let mql: MediaQueryList;

  beforeEach(() => {
    listeners = [];
    mql = {
      matches: false,
      media: '(max-width: 760px)',
      onchange: null,
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'change') listeners.push(listener as (e: MediaQueryListEvent) => void);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        const idx = listeners.indexOf(listener as (e: MediaQueryListEvent) => void);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    } as unknown as MediaQueryList;
    window.matchMedia = vi.fn().mockReturnValue(mql);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns matchMedia.matches as initial value', () => {
    (mql as { matches: boolean }).matches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('updates when the media query changes', () => {
    (mql as { matches: boolean }).matches = false;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      (mql as { matches: boolean }).matches = true;
      listeners.forEach(l => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useIsMobile());
    expect(mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
```

Run: `npm run test --workspace @bird-watch/frontend -- use-is-mobile.test.ts`. Expect failure (file does not exist).

- [ ] **Step 3: Create `useIsMobile` hook.**

Create `frontend/src/lib/use-is-mobile.ts`:

```typescript
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 760px)';

/**
 * Single source of truth for the desktop / mobile presentation split.
 * The 760px breakpoint mirrors the rest of the codebase (styles.css
 * uses @media (max-width: 760px) extensively — line 282 onward).
 *
 * SSR-safe: returns `false` when `window` is undefined. The first
 * client render reads matchMedia and re-renders if mobile, which is
 * the correct order — the desktop modal is the larger DOM, so a
 * brief desktop render before flipping to sheet would cost more than
 * the inverse.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    // Sync once at mount in case the SSR path returned a stale `false`.
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
```

Run: `npm run test --workspace @bird-watch/frontend -- use-is-mobile.test.ts`. Expect all three tests pass.

- [ ] **Step 4: Wire viewport-routing into `App.tsx`.**

In `frontend/src/App.tsx`, add the imports near the others (after the existing `SpeciesDetailSurface` import line):

```typescript
import { SpeciesDetailModal } from './components/SpeciesDetailModal.js';
import { useIsMobile } from './lib/use-is-mobile.js';
```

(Remove the `import { SpeciesDetailSurface } from './components/SpeciesDetailSurface.js';` line — `<SpeciesDetailSurface>` is now consumed only inside the modal/sheet wrappers. Verify with `grep -n "SpeciesDetailSurface" frontend/src/App.tsx` after editing.)

Inside the `App` function body, add immediately after `const { state, set } = useUrlState();`:

```typescript
  const isMobile = useIsMobile();
```

Add a callback that closes the detail surface — used by both modal and sheet:

```typescript
  const onCloseDetail = useCallback(
    () => set({ view: 'feed', detail: null }),
    [set],
  );
```

Replace the existing detail render block at `App.tsx:213–218`:

```typescript
        {state.view === 'detail' && state.detail && (
          <SpeciesDetailSurface
            speciesCode={state.detail}
            apiClient={apiClient}
          />
        )}
```

with the empty placeholder (the body now lives inside the modal/sheet, rendered as siblings of `<main>`):

```typescript
        {/*
          Sky Atlas Phase 4 — detail surface routing. The body component
          (SpeciesDetailSurface) renders inside one of two wrappers:
          a native <dialog> on desktop, a bottom-sheet on mobile.
          Selection drives off useIsMobile (max-width: 760px) — same
          breakpoint the rest of styles.css uses.
          The wrappers render OUTSIDE <main>: the modal portals via the
          top-layer (native <dialog>); the sheet sits as a sibling of
          <main> so `inert` can be applied to <main> without affecting
          the sheet. Both paths are mounted inside the .app shell.
        */}
```

After the closing `</main>`, before `<footer>`, add:

```typescript
        {state.view === 'detail' && state.detail && !isMobile && (
          <SpeciesDetailModal
            key={state.detail}
            speciesCode={state.detail}
            apiClient={apiClient}
            onClose={onCloseDetail}
          />
        )}
        {/* Mobile sheet wired in task 5. */}
```

The `key={state.detail}` is load-bearing: switching species while the modal is open (e.g. from a "see also" link in the body) must remount the modal so the `useEffect` mount-only open path re-runs and focus re-targets the new heading.

`<main>`'s `tabIndex={0}` is preserved (the existing `scrollable-region-focusable` axe lesson at `App.tsx:177–179` still applies — the map still scrolls when its content overflows).

- [ ] **Step 5: Run the desktop axe assertion to verify it passes.**

Run: `npm run test:e2e --workspace @bird-watch/frontend -- axe.spec.ts -g "detail dialog .desktop."`

Expected: the desktop test from task 2 now passes — the `<dialog>` exists, has `aria-labelledby="detail-title"`, the heading is focused, and axe reports zero violations.

The mobile sheet test still fails (no sheet yet); that's task 5.

- [ ] **Step 6: Run the full unit + e2e suites.**

Run: `npm run test --workspace @bird-watch/frontend && npm run test:e2e --workspace @bird-watch/frontend`

Expected: all unit tests pass; e2e fails only on the mobile-viewport sheet test from task 2 (which task 5 fixes). If any other e2e test fails — e.g. specs that asserted on `.species-detail-surface` rendering inside `<main>` — update the locator to target `.species-detail-modal .species-detail-body` (desktop) or note that the assertion needs to move to a follow-up task. Do not silence with `.skip()`.

- [ ] **Step 7: Commit.**

```bash
git add frontend/index.html frontend/src/lib/use-is-mobile.ts frontend/src/lib/use-is-mobile.test.ts frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(detail): wire SpeciesDetailModal on desktop (Sky Atlas Phase 4)

Adds useIsMobile() (max-width: 760px — codebase convention) and routes
?view=detail to SpeciesDetailModal on desktop. Mobile branch is a
placeholder until task 5 lands the bottom-sheet. viewport-fit=cover
added to index.html so env(safe-area-inset-bottom) resolves on iOS
ahead of the sheet ship.

Spec: docs/design/02-phases/phase-4-detail-surface.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build `<SpeciesDetailSheet>` (mobile bottom-sheet)

The sheet is the Apple Maps "Look Up" idiom: three snap points (peek 96px / half 60% of viewport / full 100vh − 8px), Pointer Events drag with rubber-banding past the endpoints, role-flip at full, `inert` on `#main-surface` set BEFORE the role flips. The drag handle is a focusable button (the first focusable inside the sheet) — keyboard users advance/retract snaps via Enter/Space on the handle, exactly as accessibility.md mandates. ESC is scoped: handler returns early when focus is outside the sheet (so MapLibre's own ESC handlers run when focus is on a cluster).

This is the longest task in the plan. Implementation order: state machine + role-flip first; then drag handlers; then ESC; then styles; then verify the failing axe assertion from task 2.

**Files:**
- Create: `frontend/src/components/SpeciesDetailSheet.tsx`
- Create: `frontend/src/components/SpeciesDetailSheet.test.tsx`
- Create: `frontend/e2e/sheet-snap.spec.ts`
- Modify: `frontend/src/styles.css` (sheet + handle + safe-area)
- Modify: `frontend/src/App.tsx` (wire mobile branch)

- [ ] **Step 1: Add the unit-test file (failing first).**

Create `frontend/src/components/SpeciesDetailSheet.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailSheet } from './SpeciesDetailSheet.js';
import { ApiClient } from '../api/client.js';
import { VERMFLY_WITH_PHOTO } from '../../e2e/fixtures.js';

function makeClient(): ApiClient {
  const client = new ApiClient({ baseUrl: '' });
  client.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
  client.getSilhouettes = vi.fn().mockResolvedValue([]);
  return client;
}

describe('<SpeciesDetailSheet>', () => {
  let mainEl: HTMLElement;

  beforeEach(() => {
    // Clear any previous mainEl by explicit removeChild — replacing
    // document.body content with assignment is unsafe and the project's
    // security hooks block it.
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    mainEl = document.createElement('main');
    mainEl.id = 'main-surface';
    document.body.appendChild(mainEl);
  });

  it('opens at peek snap with role="region" and aria-label "Selected sighting"', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    expect(sheet).toHaveAttribute('data-snap-state', 'peek');
    expect(sheet).toHaveAttribute('role', 'region');
    expect(sheet).toHaveAttribute('aria-label', 'Selected sighting');
    expect(sheet).not.toHaveAttribute('aria-modal');
    expect(mainEl).not.toHaveAttribute('inert');
  });

  it('expand button advances peek → half → full', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });

    await userEvent.click(expand);
    expect(sheet).toHaveAttribute('data-snap-state', 'half');
    expect(sheet).toHaveAttribute('role', 'region'); // still region at half
    expect(mainEl).not.toHaveAttribute('inert');

    await userEvent.click(expand);
    expect(sheet).toHaveAttribute('data-snap-state', 'full');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('aria-label', expect.stringMatching(/vermilion flycatcher/i));
    expect(mainEl).toHaveAttribute('inert', '');
  });

  it('inert is set BEFORE the role flips (sequencing contract)', async () => {
    // We observe via a MutationObserver: the inert attribute must appear
    // on mainEl before the role attribute on the sheet flips to "dialog".
    const order: string[] = [];
    const obs = new MutationObserver(records => {
      for (const r of records) {
        if (r.target === mainEl && r.attributeName === 'inert') order.push('inert');
        if ((r.target as Element).getAttribute?.('data-testid') === 'species-detail-sheet'
            && r.attributeName === 'role') {
          order.push('role');
        }
      }
    });
    obs.observe(mainEl, { attributes: true, attributeFilter: ['inert'] });

    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    obs.observe(sheet, { attributes: true, attributeFilter: ['role'] });

    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await userEvent.click(expand);

    await waitFor(() => expect(sheet).toHaveAttribute('role', 'dialog'));
    obs.disconnect();

    // Filter to the half→full transition's mutations (the initial render
    // also fires events for both attributes via React's commit ordering).
    const inertIdx = order.lastIndexOf('inert');
    const roleIdx = order.lastIndexOf('role');
    expect(inertIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeGreaterThanOrEqual(0);
    expect(inertIdx).toBeLessThan(roleIdx);
  });

  it('collapse path: full → half removes inert AFTER role flips back to region', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await userEvent.click(expand);
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(mainEl).toHaveAttribute('inert', '');

    const collapse = await screen.findByRole('button', { name: /collapse/i });
    await userEvent.click(collapse);
    // First the role flips back to region (synchronous React render),
    // then JS removes inert (post-commit effect).
    await waitFor(() => expect(sheet).toHaveAttribute('role', 'region'));
    await waitFor(() => expect(mainEl).not.toHaveAttribute('inert'));
  });

  it('ESC scoped: collapses sheet only when focus is inside the sheet', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await userEvent.click(expand);
    expect(sheet).toHaveAttribute('data-snap-state', 'full');

    // Move focus outside the sheet (back into <main>) — ESC should NOT
    // collapse the sheet now.
    mainEl.tabIndex = 0;
    mainEl.focus();
    await userEvent.keyboard('{Escape}');
    expect(sheet).toHaveAttribute('data-snap-state', 'full');

    // Move focus back inside the sheet — ESC should collapse it.
    expand.focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
  });

  it('drag-down past peek dismisses (calls onClose)', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />
    );
    const handle = await screen.findByTestId('species-detail-sheet-handle');

    // Synthesize a Pointer Events drag-down sequence ending well below
    // the peek threshold. The component reads `clientY` deltas from
    // pointermove → uses pointerdown's clientY as the anchor.
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 400, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 400, pointerId: 1, bubbles: true }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailSheet.test.tsx`. Expect all seven tests fail (file does not exist).

- [ ] **Step 2: Implement `<SpeciesDetailSheet>`.**

Create `frontend/src/components/SpeciesDetailSheet.tsx`:

```tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ApiClient } from '../api/client.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';

type SnapState = 'peek' | 'half' | 'full';

const PEEK_PX = 96;
// half + full are computed at runtime against window.innerHeight so they
// honor the actual viewport (post safe-area, post URL-bar collapse on
// mobile Safari). Constants here are the FRACTIONS:
const HALF_FRACTION = 0.6;
const FULL_INSET_PX = 8;
// Drag dismissal: dragging the handle down past peek by this many pixels
// dismisses the sheet (calls onClose).
const DISMISS_THRESHOLD_PX = 160;
// Drag transition thresholds — half travel between adjacent snaps flips.
const SNAP_TRANSITION_RATIO = 0.5;

export interface SpeciesDetailSheetProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /** Ref to <main id="main-surface"> — receives `inert` at full snap. */
  mainRef: RefObject<HTMLElement | null>;
}

/**
 * Mobile bottom-sheet detail surface (Sky Atlas Phase 4). Apple Maps
 * "Look Up" idiom: three snap points (peek 96px / half 60vh / full
 * 100vh−8px). The sheet is NOT a <dialog> at peek/half — peek/half
 * leave the map underneath interactive, which a modal <dialog> by
 * definition cannot. The role flips with snap state per
 * accessibility.md §New contract — bottom-sheet ARIA:
 *
 *   peek/half → role="region", aria-label="Selected sighting"
 *   full      → role="dialog", aria-modal="true", aria-label={species}
 *
 * Sequencing at half→full: `inert` is set on mainRef.current BEFORE
 * the role attribute flips. On full→collapse the order reverses
 * (React renders region first, then JS removes inert). The advance
 * side writes `inert` synchronously inside the click/drag handler
 * BEFORE calling setSnap('full'), so the DOM observer order is
 * inert → role. The collapse side runs the inert-removal in a
 * useLayoutEffect that fires AFTER the role-attribute commit.
 *
 * The sheet height is computed from snap state; transform is applied
 * during drag.
 *
 * Drag implementation uses native Pointer Events — no third-party
 * gesture library. touch-action discipline:
 *   - .sheet-handle: touch-action: none (we own the gesture)
 *   - .species-detail-body: touch-action: pan-y (browser owns scroll)
 */
export function SpeciesDetailSheet(props: SpeciesDetailSheetProps) {
  const { speciesCode, apiClient, onClose, mainRef } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [snap, setSnap] = useState<SnapState>('peek');
  const [dragOffset, setDragOffset] = useState<number>(0); // px: positive = pulled down
  const dragStartRef = useRef<{ y: number; snap: SnapState } | null>(null);

  // Pull the species name into the sheet (for aria-label at full). The
  // body component fetches the same data via its own hook; the cache
  // (`useSpeciesDetail` is idempotent at the apiClient layer) makes this
  // a no-op second mount.
  const { data } = useSpeciesDetail(apiClient, speciesCode);
  const speciesName = data?.comName;

  // Compute snap heights against the live viewport. Recompute on
  // resize so an orientation change or mobile-Safari URL-bar collapse
  // doesn't leave the sheet half off-screen.
  const [vh, setVh] = useState<number>(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const heightFor = useCallback(
    (s: SnapState): number => {
      switch (s) {
        case 'peek':
          return PEEK_PX;
        case 'half':
          return Math.round(vh * HALF_FRACTION);
        case 'full':
          return vh - FULL_INSET_PX;
      }
    },
    [vh],
  );

  // Inert sequencing — collapse side. When `snap` transitions away
  // from 'full', the React commit runs first (the new role="region"
  // attribute lands on the sheet), then this layout effect fires and
  // removes `inert` from <main>. Observable order: role → inert-removal.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (snap !== 'full' && main.hasAttribute('inert')) {
      main.removeAttribute('inert');
    }
  }, [snap, mainRef]);

  const goToSnap = useCallback(
    (next: SnapState) => {
      const main = mainRef.current;
      // Advance into full: write inert BEFORE setSnap so the DOM mutation
      // record for inert lands before the role-attribute mutation that
      // follows the React commit. Order: inert → role.
      if (next === 'full' && main && !main.hasAttribute('inert')) {
        main.setAttribute('inert', '');
      }
      setSnap(next);
    },
    [mainRef],
  );

  const expand = useCallback(() => {
    if (snap === 'peek') goToSnap('half');
    else if (snap === 'half') goToSnap('full');
  }, [snap, goToSnap]);

  const collapse = useCallback(() => {
    if (snap === 'full') goToSnap('half');
    else if (snap === 'half') goToSnap('peek');
    else onClose();
  }, [snap, goToSnap, onClose]);

  // ESC scoped: only collapse when focus is inside the sheet. If focus
  // is on a map element (cluster button), MapLibre handles ESC itself.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (!sheet.contains(document.activeElement)) return;
      collapse();
      e.preventDefault();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapse]);

  // Pointer Events drag handlers. Bound on the handle, NOT the sheet
  // body — touch-action discipline requires the sheet body to keep its
  // native pan-y scroll behavior.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStartRef.current = { y: e.clientY, snap };
      setDragOffset(0);
    },
    [snap],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    setDragOffset(e.clientY - start.y);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      const start = dragStartRef.current;
      dragStartRef.current = null;
      const delta = e.clientY - (start?.y ?? e.clientY);
      setDragOffset(0);

      // Dismiss path: dragging down from peek by more than
      // DISMISS_THRESHOLD_PX dismisses the sheet entirely.
      if (snap === 'peek' && delta > DISMISS_THRESHOLD_PX) {
        onClose();
        return;
      }

      // Snap-transition: which adjacent snap is closest, after the drag?
      // We measure delta against the height-difference between the
      // current snap and the adjacent snap in the drag direction.
      const order: SnapState[] = ['peek', 'half', 'full'];
      const currentIdx = order.indexOf(snap);

      if (delta < 0) {
        // Drag up: maybe advance.
        const nextIdx = Math.min(order.length - 1, currentIdx + 1);
        if (nextIdx === currentIdx) return;
        const span = heightFor(order[nextIdx]) - heightFor(snap);
        if (-delta > span * SNAP_TRANSITION_RATIO) goToSnap(order[nextIdx]);
      } else if (delta > 0) {
        // Drag down: maybe retract.
        const prevIdx = Math.max(0, currentIdx - 1);
        if (prevIdx === currentIdx) return; // already at peek
        const span = heightFor(snap) - heightFor(order[prevIdx]);
        if (delta > span * SNAP_TRANSITION_RATIO) goToSnap(order[prevIdx]);
      }
    },
    [snap, heightFor, goToSnap, onClose],
  );

  // Initial focus on mount: heading first only when the sheet opens at
  // full (not peek/half — at peek/half the user expects map focus to
  // persist so they can keep clicking clusters). At full the heading
  // gets focus exactly like the desktop modal.
  useEffect(() => {
    if (snap !== 'full') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    queueMicrotask(() => {
      sheet.querySelector<HTMLElement>('#detail-title')?.focus();
    });
  }, [snap]);

  const isFull = snap === 'full';
  const height = heightFor(snap);
  const translate = Math.max(0, dragOffset);

  return (
    <div
      ref={sheetRef}
      data-testid="species-detail-sheet"
      className={`species-detail-sheet species-detail-sheet--${snap}`}
      data-snap-state={snap}
      role={isFull ? 'dialog' : 'region'}
      aria-label={isFull ? (speciesName ?? 'Species detail') : 'Selected sighting'}
      {...(isFull ? { 'aria-modal': 'true' as const } : {})}
      style={{
        height: `${height}px`,
        transform: `translateY(${translate}px)`,
      }}
    >
      <button
        ref={handleRef}
        type="button"
        data-testid="species-detail-sheet-handle"
        className="sheet-handle"
        aria-label={isFull ? 'Collapse species detail' : 'Expand species detail'}
        onClick={isFull ? collapse : expand}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span aria-hidden="true" className="sheet-handle-grip" />
      </button>
      <div className="sheet-scroll">
        <SpeciesDetailSurface speciesCode={speciesCode} apiClient={apiClient} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add styles for `.species-detail-sheet`, `.sheet-handle`, `.sheet-scroll`.**

Append to `frontend/src/styles.css`:

```css
/* Sky Atlas Phase 4 — mobile bottom-sheet.
   Snap heights are set inline by the component (per-viewport). The
   transition is short and respects motion.css's reduced-motion rule
   (the global rule collapses transition-duration to 0ms under
   prefers-reduced-motion: reduce — see Phase 0).
   Bottom padding consumes env(safe-area-inset-bottom) so the drag
   handle stays above the iOS home indicator on notched devices.
   Requires viewport-fit=cover in index.html (set in task 4 step 1). */
.species-detail-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-bg-surface);
  color: var(--color-text);
  border-top-left-radius: var(--radius-lg, 12px);
  border-top-right-radius: var(--radius-lg, 12px);
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.18);
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0);
  transition: height 200ms ease, transform 200ms ease;
  will-change: height, transform;
}

.species-detail-sheet--full {
  /* At full snap, the sheet covers the viewport sans 8px inset. Visual
     parity with the modal — same z-stack expectation. */
  z-index: 20;
}

.sheet-handle {
  /* Drag-region: own the gesture entirely; do not pan-scroll the page. */
  touch-action: none;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  background: transparent;
  border: none;
  cursor: grab;
  /* The handle is a focusable button — accessibility.md mandates
     "the drag handle is the first focusable inside the sheet". */
}

.sheet-handle:active {
  cursor: grabbing;
}

.sheet-handle-grip {
  display: block;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--color-text-muted);
}

.sheet-scroll {
  /* Body: native vertical scroll; handle owns horizontal/vertical
     gesture decisions at the top. */
  touch-action: pan-y;
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

- [ ] **Step 4: Run unit tests to verify they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailSheet.test.tsx`

Expected: all seven tests pass. The MutationObserver-ordering test is the most fragile — if it fails, double-check that `goToSnap` writes `inert` BEFORE `setSnap` synchronously (the React state batching does not interfere because attribute writes are immediate DOM operations).

- [ ] **Step 5: Wire the mobile branch into `<App>`.**

In `frontend/src/App.tsx`, add the import:

```typescript
import { SpeciesDetailSheet } from './components/SpeciesDetailSheet.js';
```

Add a ref for `<main>` so the sheet can toggle `inert`:

```typescript
  const mainRef = useRef<HTMLElement | null>(null);
```

Add `ref={mainRef}` to the existing `<main id="main-surface" ...>` element.

After the existing modal block (added in task 4), add:

```typescript
        {state.view === 'detail' && state.detail && isMobile && (
          <SpeciesDetailSheet
            key={state.detail}
            speciesCode={state.detail}
            apiClient={apiClient}
            onClose={onCloseDetail}
            mainRef={mainRef}
          />
        )}
```

- [ ] **Step 6: Add the Playwright sheet-interaction spec.**

Create `frontend/e2e/sheet-snap.spec.ts`:

```typescript
import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('SpeciesDetailSheet snap behavior', () => {
  test('opens at peek; expand button advances peek → half → full; role flips at full', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toHaveAttribute('data-snap-state', 'peek');
    await expect(sheet).toHaveAttribute('role', 'region');

    const expand = page.getByRole('button', { name: /expand/i });
    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');

    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#main-surface')).toHaveAttribute('inert', '');

    // Collapse path
    const collapse = page.getByRole('button', { name: /collapse/i });
    await collapse.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');
    await expect(page.locator('#main-surface')).not.toHaveAttribute('inert', '');
  });

  test('drag-down past peek dismisses the sheet (URL flips off detail)', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('handle bounding box unavailable');

    // Synthesize a touch drag-down from the handle to the bottom of the
    // viewport (well beyond DISMISS_THRESHOLD_PX = 160px).
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, 800, { steps: 10 });
    await page.mouse.up();

    // URL must flip away from detail
    await expect(page).toHaveURL(/view=feed/);
    await expect(page.locator('[data-testid=species-detail-sheet]')).toHaveCount(0);
  });
});
```

- [ ] **Step 7: Run the Playwright suites to verify the failing axe assertion from task 2 now passes.**

Run: `npm run test:e2e --workspace @bird-watch/frontend -- axe.spec.ts -g "Phase 4"`

Expected: both Phase-4 axe assertions pass — the desktop dialog test (already green from task 4) plus the mobile sheet-at-full test (now green).

Run: `npm run test:e2e --workspace @bird-watch/frontend -- sheet-snap.spec.ts`

Expected: both sheet-snap tests pass.

- [ ] **Step 8: Run the full unit + e2e suites.**

Run: `npm run test --workspace @bird-watch/frontend && npm run test:e2e --workspace @bird-watch/frontend`

Expected: all tests pass. If a pre-existing spec breaks because the detail surface no longer renders directly inside `<main>`, update its locator: `page.locator('.species-detail-modal .species-detail-body')` for desktop, `page.locator('.species-detail-sheet .species-detail-body')` for mobile. Document the locator change in the commit message.

- [ ] **Step 9: Commit.**

```bash
git add frontend/src/components/SpeciesDetailSheet.tsx frontend/src/components/SpeciesDetailSheet.test.tsx frontend/src/styles.css frontend/src/App.tsx frontend/e2e/sheet-snap.spec.ts
git commit -m "$(cat <<'EOF'
feat(detail): SpeciesDetailSheet mobile bottom-sheet (Sky Atlas Phase 4)

Three snap points (peek 96px / half 60vh / full 100vh-8px) with
Pointer Events drag, role-flip at full, scoped ESC, drag-down dismiss.
inert is set on #main-surface BEFORE the role flips to dialog
(advance) and removed AFTER the role flips back to region (collapse) —
the sequencing contract from accessibility.md §New contract — bottom-
sheet ARIA, observable via MutationObserver in tests.

The sheet is NOT a <dialog>: at peek/half the map underneath stays
interactive, which a modal dialog by definition cannot allow.

Spec: docs/design/02-phases/phase-4-detail-surface.md
      docs/design/01-spec/accessibility.md (bottom-sheet ARIA)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Verify safe-area on physical iPhone (G6 gate)

`accessibility.md` and the phase-4 doc both gate the mobile sheet ship on G6 (iOS safe-area test). The unit + Playwright suites cover the role-flip, drag math, ESC scoping, and axe contracts — but `env(safe-area-inset-bottom)` resolves to `0` in headless Chromium and JSDOM. Only a physical iPhone X+ test confirms the drag handle clears the home indicator.

This task does not change code; it documents the verification protocol.

**Files:** none modified.

- [ ] **Step 1: Run dev server and expose to LAN.**

Run: `npm run dev --workspace @bird-watch/frontend -- --host 0.0.0.0`

Note the printed `Network: http://192.168.x.x:5173/` URL.

- [ ] **Step 2: Open the URL on a physical iPhone X / 11 / 12 / 13 / 14 / 15 (any device with a home indicator).**

Navigate to `?detail=<any species code>` on the LAN URL. Tap the sheet handle. Visually confirm:

1. At peek: the drag handle's bottom edge sits at least 8px above the home indicator's top edge.
2. At full: the bottom-most content row is fully visible (not occluded by the indicator).
3. Drag the sheet up and down — the handle stays clear of the indicator throughout the gesture.

If any of (1)–(3) fail, the `viewport-fit=cover` change from task 4 step 1 didn't take effect. Verify `index.html` shipped with `viewport-fit=cover` in the Network tab; clear browser cache and retry.

- [ ] **Step 3: Record the pass in `docs/design/01-spec/open-questions.md`.**

Update the G6 row in `open-questions.md` from "open" to "pass — verified <date> on iPhone <model>". Commit:

```bash
git add docs/design/01-spec/open-questions.md
git commit -m "$(cat <<'EOF'
docs(design): close G6 (iOS safe-area) gate — Sky Atlas Phase 4 verified

Verified env(safe-area-inset-bottom) resolves correctly on iPhone <model>
with the viewport-fit=cover meta from index.html. Drag handle clears the
home indicator at peek, half, and full snap.

Spec: docs/design/01-spec/open-questions.md (G6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If you cannot run this verification yourself (no physical iPhone available), STOP. Do not open the PR until G6 is closed by someone who can. Note this in the PR body's Test Plan section as "blocked on G6 — see open-questions.md".

---

## Task 7: Re-wire the IntersectionObserver for the new scroll roots

Task 1's rewrite already preserves the `IntersectionObserver` — it walks up to the nearest scrolling ancestor. On desktop the ancestor is the `<dialog class="species-detail-modal">` (`overflow: auto` set in task 3 step 4). On mobile it's `.sheet-scroll` (`overflow-y: auto` set in task 5 step 3). This task verifies the analytics fires from each.

**Files:** none modified (verification-only).

- [ ] **Step 1: Run the unit tests for `SpeciesDetailSurface` that cover the bottom-sentinel.**

Run: `npm run test --workspace @bird-watch/frontend -- SpeciesDetailSurface.test.tsx`

Expected: any pre-Phase-4 test that asserts `analytics.capture('panel_scrolled_to_bottom', ...)` continues to pass — the observer is reattached on mount inside whatever scroll root the wrapper provides.

If those tests do not exist, that's the pre-Phase-4 status quo (analytics tested at integration level only); skip to step 2.

- [ ] **Step 2: Manual verification — fire `panel_scrolled_to_bottom` from the modal.**

Run dev server. With the detail modal open at desktop viewport, scroll inside the modal to the bottom. In the network/PostHog inspector, confirm `panel_scrolled_to_bottom` fires once with `species_code: <code>`.

Repeat at mobile viewport (Chrome DevTools device emulation 390×844). Open the sheet, drive to full, scroll inside the sheet body (`.sheet-scroll`) to the bottom. Confirm the same event fires.

- [ ] **Step 3: If verification passes, no commit.** This task is a checkpoint, not a code change.

If verification fails (event does not fire), the most likely cause is the sentinel `<div>` is being unmounted before the observer connects (e.g. the modal's mount-only effect is running before the body's data has loaded). Fix by ensuring the body's bottom sentinel is rendered only after `data` resolves — already the case in task 1's rewrite, but double-check the `data && (...)` gate.

---

## Task 8: Run the full validation suite end-to-end

Same checks Mergify will require: `test`, `lint`, `build`, `e2e`. Plus an extra Lighthouse LCP sniff per the phase doc's acceptance criterion (photo masthead loads <1s on dev hardware).

**Files:** none modified.

- [ ] **Step 1: Run the full unit test suite from repo root.**

Run: `npm test`

Expected: all unit tests pass across all workspaces.

- [ ] **Step 2: Run the lint suite.**

Run: `npm run lint`

Expected: no errors. The new components add `useLayoutEffect`, `useRef<HTMLElement | null>`, and pointer-event handlers — `react-hooks/exhaustive-deps` is the most likely offender. Fix in place; do not silence with `eslint-disable` except where the comment in `SpeciesDetailModal.tsx`'s mount-only effect already calls out.

- [ ] **Step 3: Run the frontend build.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds. Inspect the bundle size delta — sheet + modal + hook should add <8KB gzipped (no new dependencies; pure React + DOM APIs). If the diff is >12KB, investigate (likely cause: an accidental import of a heavy module).

- [ ] **Step 4: Run the e2e suite.**

Run: `npm run test:e2e --workspace @bird-watch/frontend`

Expected: all Playwright specs pass, including:
- `axe.spec.ts` — both Phase-4 branches (desktop dialog, mobile sheet at full)
- `sheet-snap.spec.ts` — sheet snap transitions and drag dismissal
- All preserved specs

- [ ] **Step 5: Lighthouse LCP check.**

Run dev server: `npm run dev --workspace @bird-watch/frontend`

In Chrome DevTools → Lighthouse → Mobile preset → Performance only. Audit `http://localhost:5173/?detail=vermfly&view=detail`. The phase-4 doc requires LCP <1s on dev hardware, <2.5s on real hardware.

Expected: LCP element is the masthead `<img>`; LCP time <1000ms. If LCP is the heading instead of the photo, `<Photo priority={true}>` is not threading `loading="eager" fetchpriority="high"` correctly — verify the `<img>` element's attributes in the Elements panel; trace to the Phase-2 `<Photo>` component if absent.

If LCP is >1000ms, check that the photo URL stub fires synchronously in the dev server (not after a delay).

- [ ] **Step 6: Commit any lint/build fixups (if needed).**

Only run if steps 2–4 surfaced any in-repo fixes.

```bash
git add <files>
git commit -m "$(cat <<'EOF'
chore(detail): lint + build fixups for Phase 4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Open the PR

Use the project PR workflow (`.claude/skills/pr-workflow/SKILL.md`) for the full opening protocol.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/sky-atlas-phase-4-detail-surface
```

- [ ] **Step 2: Open the PR using the project template.**

Per `frontend/CLAUDE.md`, the PR body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim — all 5 sections including Screenshots. Phase 4 ships visible UI under `frontend/**`, so Screenshots are REQUIRED — capture per `pr-screenshots-via-user-attachments` skill.

Required screenshots (4):
1. Desktop modal open at 1440×900 (`?detail=vermfly&view=detail`).
2. Mobile sheet at peek snap, 390×844.
3. Mobile sheet at half snap, 390×844.
4. Mobile sheet at full snap, 390×844 (with map visibly inert behind).

```bash
gh pr create --title "feat: Sky Atlas Phase 4 — detail-surface modal + bottom-sheet" --body "$(cat <<'EOF'
## Summary
- `<SpeciesDetailModal>` (desktop): native `<dialog>` reusing AttributionModal's focus-capture / ESC / backdrop / close-event pattern. `aria-labelledby="detail-title"`; initial focus on heading not close button.
- `<SpeciesDetailSheet>` (mobile): three-snap bottom-sheet (peek 96px / half 60vh / full 100vh−8px), Pointer Events drag, role-flip at full with `inert` sequencing (inert before role-flip on advance; role-flip before inert-removal on collapse).
- `<SpeciesDetailSurface>` rewritten: `<Photo priority={true}>` masthead + `<h1 id="detail-title" tabIndex={-1}>` heading. Analytics + IntersectionObserver preserved.
- `viewport-fit=cover` in `index.html` + `padding-bottom: env(safe-area-inset-bottom)` on the sheet (G6 closed on physical iPhone — see commit).
- Two new axe branches: detail dialog + sheet at full.

## Test plan
- [x] All existing unit tests pass; assertions updated for `<h1 id="detail-title">`.
- [x] Five new modal tests (open / aria-labelledby / heading focus / ESC / backdrop / focus restore).
- [x] Seven new sheet tests (peek default / expand chain / inert-before-role / role-before-inert-removal / scoped ESC / drag dismiss).
- [x] Two new axe branches (desktop dialog, mobile sheet at full) green.
- [x] One new Playwright spec (`sheet-snap.spec.ts`) covering snap transitions + drag dismissal.
- [x] G6 (iOS safe-area) verified on physical iPhone — `open-questions.md` updated.
- [x] Lighthouse LCP <1s on dev hardware for the masthead photo.
- [x] `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e` all green.

## Screenshots
<paste user-attachments URLs here per pr-screenshots-via-user-attachments skill — desktop modal 1440×900, mobile sheet at peek/half/full at 390×844>

## Spec
docs/design/02-phases/phase-4-detail-surface.md
docs/design/01-spec/architecture.md §Detail-surface IA
docs/design/01-spec/accessibility.md §New contract — detail dialog heading + focus order, §New contract — bottom-sheet ARIA
docs/design/01-spec/components.md §<Photo> (priority prop)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md, bot review dispatches through the `julianken-bot` Agent subagent — never via `gh pr review` from the main session.

- [ ] **Step 4: After bot review approves and CI green (test, lint, build, e2e), post the Mergify queue comment.**

The comment body MUST be exactly `@Mergifyio queue` — no prose, no preamble, no explanation. Mergify uses literal-string match.

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

NEVER use `gh pr merge`.

---

## Acceptance criteria

This plan is complete when ALL of the following are true (verifiable against the phase-4 doc + spec):

- [x] Desktop: `<dialog class="species-detail-modal">` opens with `aria-labelledby="detail-title"`; ESC, backdrop, and close-button all call onClose; focus restores to trigger.
- [x] Desktop: initial focus targets `#detail-title`, NOT the close button.
- [x] Mobile: bottom-sheet opens at peek snap; expand handle advances peek → half → full; drag-down past peek dismisses; ESC scoped to focus inside the sheet.
- [x] At peek + half: map is interactive (`#main-surface` has no `inert`); sheet has `role="region"`.
- [x] At full: map has `inert`; sheet has `role="dialog" aria-modal="true" aria-label={species name}`.
- [x] Inert sequencing: `inert` set BEFORE role flips to dialog (advance); role flips back to region BEFORE inert removed (collapse) — observable via MutationObserver.
- [x] axe assertions pass: desktop dialog photo path + mobile sheet at full snap.
- [x] LCP <1s on dev hardware for the masthead photo (`<Photo priority={true}>` produces `loading="eager" fetchpriority="high"`).
- [x] `panel_scrolled_to_bottom` fires inside the new scroll containers (modal + sheet), not `<main>`.
- [x] `viewport-fit=cover` ships and G6 (iOS safe-area) is verified on a physical iPhone X+.
- [x] All existing tests pass (`npm test`, `npm run test:e2e`).
- [x] PR opens with all 5 template sections + 4 screenshots; Mergify queues it.

## What this plan deliberately does NOT include

To stay scoped per the phase-4 doc's "What this phase does NOT include" boundary:

- No changes to map / cluster pill (Phase 3).
- No changes to feed or species surface (Phase 5).
- No metadata / voice / brand changes (Phase 6).
- No `<StatusBlock>`, `<Photo>`, `<FamilySilhouette>`, `<ClusterPill>`, `<FilterSentence>` definitions — all five primitives are Phase 2 deliverables; this plan consumes `<Photo>`, `<StatusBlock>`, `<FamilySilhouette>` as already-shipped.
- No `<FilterSentence>` usage on the detail surface.
- No `[data-theme]` light/dark scaffold (Phase 1).
- No new design tokens (Phase 1).
- No third-party drag library (Hammer / use-gesture). Pointer Events + a 60-line state machine is sufficient and stays inside the touch-action discipline.
- No `position: sticky` masthead inside the sheet (the entire sheet body scrolls as one block; the photo scrolls off-screen the same as on the desktop modal).
- No "back" button inside the modal/sheet — the browser back button (Phase 0's pushState) is the canonical dismiss path; the close button + ESC + backdrop click + drag-down are amplification.
- No keyboard arrow-key snap navigation. Enter/Space on the handle button advances; Shift-Tab is the standard return path. Arrow-key support is a Phase 4.1 follow-up if user testing surfaces a need.

If during implementation you find yourself touching any of those surfaces, stop and confirm — that work belongs in a later phase's plan, not here.
