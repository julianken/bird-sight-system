import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailSheet, resolveContentTier } from './SpeciesDetailSheet.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { __resetSpeciesDetailCache } from '../data/use-species-detail.js';
import { analytics } from '../analytics.js';

const VERMFLY_WITH_PHOTO: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'songbird',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Smith',
  photoLicense: 'CC-BY-4.0',
};

// No-photo VERMFLY: photoUrl omitted (it is optional on SpeciesMeta), so the
// sheet passes src=null to <Photo> and the family-silhouette fallback renders.
// Mirrors the canonical e2e VERMFLY fixture (frontend/e2e/fixtures.ts).
const VERMFLY_NO_PHOTO: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'songbird',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

function makeClient(): ApiClient {
  const client = new ApiClient({ baseUrl: '' });
  client.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
  client.getSilhouettes = vi.fn().mockResolvedValue([]);
  return client;
}

function makeNoPhotoClient(): ApiClient {
  const client = new ApiClient({ baseUrl: '' });
  client.getSpecies = vi.fn().mockResolvedValue(VERMFLY_NO_PHOTO);
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
    // Reset the module-level species detail cache so a resolved entry from
    // one test cannot bleed into the next test's mock expectations.
    __resetSpeciesDetailCache();
  });

  it('opens at half snap with role="region" and aria-label "Selected sighting"', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // The field-guide sheet opens at `half` (the plate-card detent) for
    // immediate readability — NOT peek. peek is the map-preserving collapsed
    // state reached by dragging down.
    expect(sheet).toHaveAttribute('data-snap-state', 'half');
    expect(sheet).toHaveAttribute('role', 'region');
    expect(sheet).toHaveAttribute('aria-label', 'Selected sighting');
    expect(sheet).not.toHaveAttribute('aria-modal');
    // No inert on the (synthetic) main target — only set at full.
    expect(mainEl).not.toHaveAttribute('inert');
  });

  it('expand button advances half → full', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // Opens at half.
    expect(sheet).toHaveAttribute('data-snap-state', 'half');
    expect(sheet).toHaveAttribute('role', 'region');
    expect(mainEl).not.toHaveAttribute('inert');

    // One expand tap advances half → full (role flips to dialog + aria-modal).
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    expect(sheet).toHaveAttribute('data-snap-state', 'full');
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('aria-label', expect.stringMatching(/vermilion flycatcher/i));
    expect(mainEl).toHaveAttribute('inert', '');
  });

  it('open-focus at full lands on the dialog CONTAINER, not the visible name (#907 finding 2)', async () => {
    // Regression guard: focusing the visible #detail-title heading painted a
    // stray :focus-visible ring around the species name on keyboard-driven
    // open. Open-focus must land on the sheet root (role="dialog",
    // tabIndex=-1) so neither pointer nor keyboard open rings the name. The
    // dialog's accessible name is still the species name via aria-label.
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
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

    // The focus microtask runs after the snap commit — wait for it to land on
    // the dialog container.
    await waitFor(() => expect(sheet).toHaveFocus());
    // The visible species name must NOT be the focus target.
    const heading = sheet.querySelector('#detail-title');
    expect(heading).not.toBe(document.activeElement);
    // Container is programmatically focusable (no tab stop).
    expect(sheet).toHaveAttribute('tabindex', '-1');
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

    // Opens at half → one expand reaches full.
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);

    await waitFor(() => expect(sheet).toHaveAttribute('role', 'dialog'));
    obs.disconnect();

    // The half→full transition writes inert synchronously inside the click
    // handler BEFORE setSnap, so the inert mutation lands before the role flip.
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
    expect(sheet).toHaveAttribute('role', 'dialog');
    expect(mainEl).toHaveAttribute('inert', '');

    const collapse = await screen.findByRole('button', { name: /collapse/i });
    await userEvent.click(collapse);
    // First the role flips back to region (synchronous React render),
    // then JS removes inert (post-commit effect).
    await waitFor(() => expect(sheet).toHaveAttribute('role', 'region'));
    await waitFor(() => expect(mainEl).not.toHaveAttribute('inert'));
  });

  // ─── Single-pointer dismissal: the shared × (WCAG 2.5.7, #1026) ────────────
  //
  // The sheet used to offer NO single-pointer, non-drag dismissal: the only
  // affordance was the drag handle (swipe-down) — which fails WCAG 2.5.7 (a
  // dragging gesture needs a single-pointer alternative). The shared SheetHeader
  // × is that alternative; it is visible at EVERY snap and calls
  // closeWithRestore (so #910 focus-restore is preserved on this path too).
  describe('× close button (single-pointer dismissal — WCAG 2.5.7)', () => {
    it('renders the × at half (the open detent) and click → onClose', async () => {
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
      const close = screen.getByRole('button', { name: 'Close species detail' });
      expect(close).toBeInTheDocument();
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders the × at full and click → onClose', async () => {
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      const expand = await screen.findByRole('button', { name: /expand/i });
      await userEvent.click(expand);
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
      const close = screen.getByRole('button', { name: 'Close species detail' });
      expect(close).toBeInTheDocument();
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders the × at peek and click → onClose', async () => {
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      const handle = await screen.findByTestId('species-detail-sheet-handle');
      // Drag down from half to the peek detent (slow, short drag — settles to
      // the nearest detent by position, below the dismiss floor).
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 600, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 740, pointerId: 1, bubbles: true }));
      handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 740, pointerId: 1, bubbles: true }));
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'peek'));
      const close = screen.getByRole('button', { name: 'Close species detail' });
      expect(close).toBeInTheDocument();
      await userEvent.click(close);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Escape — pinned predicate (#1026) ─────────────────────────────────────
  //
  // Escape now DISMISSES the sheet (closeWithRestore → onClose), matching the
  // desktop rail + the filters sheet, rather than stepwise-collapsing detents.
  // The handler is document-level in the BUBBLE phase (so the scope popover's
  // stopPropagation claim still wins) and bails in exactly three cases:
  //   1. e.defaultPrevented (an inner widget already claimed the key)
  //   2. focus is inside an open native <dialog> (Credits closes natively)
  //   3. focus is inside a [role="dialog"] surface (portaled popovers) OR
  //      inside the map layer (mainRef) — MapLibre / popovers own Escape there.
  describe('Escape dismisses (pinned predicate)', () => {
    it('Escape with focus on document.body → onClose fires (no keyboard trap)', async () => {
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
      // Normal post-open state: focus is NOT inside the sheet (it sits on body).
      (document.activeElement as HTMLElement | null)?.blur?.();
      expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('Escape with focus inside the sheet → DISMISSES (onClose), not stepwise-collapse', async () => {
      // Inverted from the old contract: a focus-inside Escape used to step
      // full→half. It now dismisses outright (matching rail + filters).
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      const expand = await screen.findByRole('button', { name: /expand/i });
      await userEvent.click(expand);
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
      expand.focus();
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('Escape with focus inside the map layer (mainRef) → sheet stays open (carve-out 3, map owns Escape)', async () => {
      // Renamed from the old focus-scoping test: the sheet stays open NOT
      // because Escape is focus-scoped to the sheet, but because mainEl IS
      // mainRef.current (the #map-layer) — MapLibre / its controls own Escape
      // when focus is on the map.
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      const expand = await screen.findByRole('button', { name: /expand/i });
      await userEvent.click(expand);
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
      // Focus an element INSIDE mainRef.current (#map-layer) — Escape must NOT
      // close the sheet (the map owns the key there).
      const mapChild = document.createElement('button');
      mapChild.type = 'button';
      mainEl.appendChild(mapChild);
      mapChild.focus();
      await userEvent.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      expect(sheet).toHaveAttribute('data-snap-state', 'full');
    });

    it('Escape with focus inside a body-portaled [role="dialog"] → sheet stays open (carve-out 3, popover owns Escape)', async () => {
      // The Cell/ClusterList popovers createPortal to document.body so mainRef
      // containment cannot cover them; their own Escape handlers do not
      // preventDefault and register after the sheet's listener. Without the
      // [role="dialog"] half of carve-out 3 one keypress would double-close
      // popover + sheet. Both popovers focus a heading on mount, so
      // closest('[role="dialog"]') is truthy whenever one is open.
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
      // A body-portaled role="dialog" stub with a focused inner element.
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      const inner = document.createElement('button');
      inner.type = 'button';
      dialog.appendChild(inner);
      document.body.appendChild(dialog);
      inner.focus();
      await userEvent.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
      dialog.remove();
    });

    it('Escape that an inner widget already handled (defaultPrevented) → sheet stays open (carve-out 1)', async () => {
      const onClose = vi.fn();
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={onClose}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
      // A CAPTURE-phase listener that claims the key before the sheet's
      // BUBBLE-phase listener runs — this is exactly how the filters Escape
      // handler (App.tsx, capture phase) yields guard 1 when both are open.
      const claim = (e: KeyboardEvent) => {
        if (e.key === 'Escape') e.preventDefault();
      };
      document.addEventListener('keydown', claim, true);
      try {
        const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.body.dispatchEvent(evt);
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', claim, true);
      }
    });
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

    // Synthesize a Pointer Events drag-down sequence from the open (half) state
    // ending far below the peek detent so the release falls under the dismiss
    // floor (PEEK_PX * 0.6). The component drives `liveHeight` from the
    // pointerdown anchor + the running delta; a large downward delta shrinks the
    // height past the dismiss threshold.
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 700, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 700, pointerId: 1, bubbles: true }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('drag-slop (6px, #431): a 5px move does NOT translate; a 7px move tracks the finger', async () => {
    // #431: the translation must not start on the FIRST pointermove. A
    // DRAG_SLOP_PX = 6 dead-band gates BOTH the `moved` flag AND the
    // setLiveHeight translation (the old 4px gated only click suppression, so
    // the sheet jiggled on a sub-threshold tap-drag). Below the slop the height
    // stays at the detent (no inline style.height tracking); past it, it tracks.
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    const half = Math.round(window.innerHeight * 0.6);

    // A 5px upward move (under the 6px slop) must NOT move the sheet height.
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 395, pointerId: 1, bubbles: true }));
    // liveHeight stays null → the rendered px equals the detent height (half).
    // Give React a tick to (not) re-render; the height must still be the detent.
    await waitFor(() => {
      const px = Number((sheet as HTMLElement).style.height.match(/([\d.]+)px/)?.[1]);
      expect(px).toBe(half);
    });

    // Now cross the slop: a 7px move (from the 400 anchor → 393) tracks 1:1.
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 393, pointerId: 1, bubbles: true }));
    await waitFor(() => {
      const px = Number((sheet as HTMLElement).style.height.match(/([\d.]+)px/)?.[1]);
      // grow = startY - clientY = 400 - 393 = 7 → height ≈ half + 7.
      expect(px).toBeGreaterThanOrEqual(half + 7 - 1);
      expect(px).toBeLessThanOrEqual(half + 7 + 1);
    });

    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 393, pointerId: 1, bubbles: true }));
  });

  it('1:1 drag-up grows the sheet height by the drag delta', async () => {
    // jsdom has no layout; window.innerHeight defaults to 768. The sheet opens
    // at half = round(768 * 0.6) = 461px. A slow drag UP by 120px (clientY
    // 400 → 280, no flick) should drive liveHeight to ~half + 120, tracking the
    // finger 1:1 — and data-dragging flips to "true" while the gesture is live.
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const handle = await screen.findByTestId('species-detail-sheet-handle');

    const half = Math.round(window.innerHeight * 0.6);

    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 1, bubbles: true }));
    // Multiple small steps so the velocity stays well under the flick threshold.
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 340, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 280, pointerId: 1, bubbles: true }));

    await waitFor(() => expect(sheet).toHaveAttribute('data-dragging', 'true'));
    // height is `${liveHeight}px + env(...)` at non-full detents; assert the
    // px component is ≈ half + 120 (±2px rounding tolerance).
    const styleHeight = (sheet as HTMLElement).style.height;
    const px = Number(styleHeight.match(/([\d.]+)px/)?.[1]);
    expect(px).toBeGreaterThanOrEqual(half + 120 - 2);
    expect(px).toBeLessThanOrEqual(half + 120 + 2);
  });

  it('velocity flick up advances to full; flick down retracts to peek', async () => {
    // A fast UP flick (large negative dy in one tiny dt) advances a detent past
    // the position-nearest result; a fast DOWN flick retracts. We start at half
    // and assert each direction lands on the velocity-biased detent.
    const { unmount } = render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const handle = await screen.findByTestId('species-detail-sheet-handle');

    // Fast up-flick: a small upward move that, by nearest-position, would settle
    // back near half, but the velocity (>0.5px/ms up) advances it to full.
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 380, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 360, pointerId: 1, bubbles: true }));
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

    unmount();

    // Fresh mount (opens at half) for the down-flick case.
    __resetSpeciesDetailCache();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet2 = (await screen.findAllByTestId('species-detail-sheet')).at(-1)!;
    const handle2 = (await screen.findAllByTestId('species-detail-sheet-handle')).at(-1)!;
    // Fast down-flick: small downward move + velocity > 0.5px/ms down retracts
    // half → peek (one detent), NOT all the way to dismiss.
    handle2.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 2, bubbles: true }));
    handle2.dispatchEvent(new PointerEvent('pointermove', { clientY: 420, pointerId: 2, bubbles: true }));
    handle2.dispatchEvent(new PointerEvent('pointerup', { clientY: 440, pointerId: 2, bubbles: true }));
    await waitFor(() => expect(sheet2).toHaveAttribute('data-snap-state', 'peek'));
  });

  it('unmounting at full snap cleans up inert on <main> (viewport-flip regression)', async () => {
    // Simulate: mobile user opens sheet (at half), advances to full snap (inert
    // set), then rotates device. App.tsx's viewport router unmounts
    // SpeciesDetailSheet and mounts SpeciesDetailModal. Without the cleanup
    // function the inert attribute leaks onto <main> and blocks all pointer
    // events + tab order.
    const { unmount } = render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const expand = await screen.findByRole('button', { name: /expand/i });

    // Advance half → full — inert is set on <main> by goToSnap('full').
    await userEvent.click(expand);
    expect(mainEl).toHaveAttribute('inert', '');

    // Simulate the viewport flip: sheet unmounts (modal would mount next).
    unmount();

    // Cleanup must have removed inert — the modal that takes over starts clean.
    expect(mainEl).not.toHaveAttribute('inert');
  });

  // ─── Analytics instrumentation (T3 #909, re-wired off SpeciesDetailSurface) ──
  //
  // T1 (#907) stopped composing <SpeciesDetailSurface> inside the sheet, which
  // silently dropped the three detail-panel analytics events. T3 re-wires them
  // IN the sheet with the SAME event names + prop shapes as the surface
  // (SpeciesDetailSurface.tsx:78-115):
  //
  //   - `panel_opened` on species data-arrival, props {species_code, has_description}
  //   - `panel_dwell_ms` on unmount (effect cleanup), props {species_code, dwell_ms}
  //   - `panel_scrolled_to_bottom` on first IntersectionObserver hit on the
  //     bottom sentinel, prop {species_code}
  //
  // `analytics.capture` flows through `safeClarity` (clarity.ts); in jsdom
  // `window.clarity` is undefined so the wrapper no-ops. We spy on
  // `analytics.capture` directly to assert the events fire with the right shape.

  describe('analytics instrumentation', () => {
    function makeClientWith(meta: SpeciesMeta): ApiClient {
      const client = new ApiClient({ baseUrl: '' });
      client.getSpecies = vi.fn().mockResolvedValue(meta);
      client.getSilhouettes = vi.fn().mockResolvedValue([]);
      return client;
    }

    it('fires panel_opened once on data resolve with has_description=false when no description', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={vi.fn()}
          mainRef={{ current: mainEl }}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      const openCalls = captureSpy.mock.calls.filter(([name]) => name === 'panel_opened');
      expect(openCalls).toHaveLength(1);
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: false,
      });
      captureSpy.mockRestore();
    });

    it('fires panel_opened with has_description=true when descriptionBody is present', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClientWith({
            ...VERMFLY_WITH_PHOTO,
            descriptionBody: '<p>Body.</p>',
            descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
          })}
          onClose={vi.fn()}
          mainRef={{ current: mainEl }}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: true,
      });
      captureSpy.mockRestore();
    });

    it('does NOT fire panel_opened before species data resolves', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = new ApiClient({ baseUrl: '' });
      // getSpecies never resolves — the effect's data-arrival guard means
      // panel_opened must not fire while the sheet is still loading.
      client.getSpecies = vi.fn().mockReturnValue(new Promise(() => {}));
      client.getSilhouettes = vi.fn().mockResolvedValue([]);
      render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={client}
          onClose={vi.fn()}
          mainRef={{ current: mainEl }}
        />,
      );
      const sheet = await screen.findByTestId('species-detail-sheet');
      expect(sheet).toBeInTheDocument();
      const openCalls = captureSpy.mock.calls.filter(([name]) => name === 'panel_opened');
      expect(openCalls).toHaveLength(0);
      captureSpy.mockRestore();
    });

    it('fires panel_dwell_ms on unmount with species_code and a numeric dwell_ms', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const { unmount } = render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={vi.fn()}
          mainRef={{ current: mainEl }}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      // panel_opened fired on data resolve; clear so we isolate the unmount call.
      captureSpy.mockClear();
      unmount();
      expect(captureSpy).toHaveBeenCalledWith(
        'panel_dwell_ms',
        expect.objectContaining({
          species_code: 'vermfly',
          dwell_ms: expect.any(Number),
        }),
      );
      // The dwell payload carries no has_description (analyst groups on the
      // open-event property at query time) — mirror of the surface contract.
      const dwellCalls = captureSpy.mock.calls.filter(([name]) => name === 'panel_dwell_ms');
      for (const [, payload] of dwellCalls) {
        expect(payload as Record<string, unknown>).not.toHaveProperty('has_description');
      }
      captureSpy.mockRestore();
    });

    it('renders the bottom sentinel as a direct child of .sheet-fg AFTER the About block (no display:none)', async () => {
      const { container } = render(
        <SpeciesDetailSheet
          speciesCode="vermfly"
          apiClient={makeClient()}
          onClose={vi.fn()}
          mainRef={{ current: mainEl }}
        />,
      );
      const sentinel = await screen.findByTestId('detail-bottom-sentinel');
      // aria-hidden so SR users don't perceive an empty element at the end.
      expect(sentinel).toHaveAttribute('aria-hidden', 'true');
      // CRITICAL: the sentinel must be a DIRECT child of the scroll container
      // (.sheet-fg) — the tier-gated .sheet-fg-about block is display:none until
      // full and never intersects. Direct-child placement keeps it in layout.
      const scroller = container.querySelector('.sheet-fg');
      expect(scroller).not.toBeNull();
      expect(sentinel.parentElement).toBe(scroller);
      // Must sit AFTER the About block so it only intersects once the user has
      // scrolled past every content node.
      const about = container.querySelector('.sheet-fg-about');
      expect(about).not.toBeNull();
      expect(
        about!.compareDocumentPosition(sentinel) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The sentinel itself must NOT carry a tier-gated display:none class — it
      // is the only .sheet-fg child that is intersectable at every detent.
      expect(sentinel.className).not.toMatch(/sheet-fg-about|sheet-fg-taxonomy/);
    });

    // jsdom has no IntersectionObserver; install a controllable class mock that
    // records each registered callback for manual triggering — same pattern as
    // SpeciesDetailSurface.test.tsx. Returns the observer list + a restore fn so
    // both the full-detent and mid-detent cases can share the harness.
    type IOInstance = {
      callback: IntersectionObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      unobserve: ReturnType<typeof vi.fn>;
      takeRecords: ReturnType<typeof vi.fn>;
    };
    function installIOMock(): { observers: IOInstance[]; restore: () => void } {
      const observers: IOInstance[] = [];
      class IOMock {
        callback: IntersectionObserverCallback;
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push(this as unknown as IOInstance);
        }
      }
      const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = IOMock;
      return {
        observers,
        restore: () => {
          if (originalIO === undefined) {
            delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
          } else {
            (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
          }
        },
      };
    }

    it('fires panel_scrolled_to_bottom once on first sentinel intersection then disconnects (at FULL)', async () => {
      const { observers, restore } = installIOMock();
      try {
        const captureSpy = vi.spyOn(analytics, 'capture');
        const { container } = render(
          <SpeciesDetailSheet
            speciesCode="vermfly"
            apiClient={makeClient()}
            onClose={vi.fn()}
            mainRef={{ current: mainEl }}
          />,
        );
        const sentinel = await screen.findByTestId('detail-bottom-sentinel');
        expect(container).toBeTruthy();

        // Advance half → full: the observer is gated on snap === 'full' (#914),
        // so it only arms once the About content is shown and .sheet-fg scrolls.
        const expand = await screen.findByRole('button', { name: /expand/i });
        await userEvent.click(expand);
        const sheet = await screen.findByTestId('species-detail-sheet');
        await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

        expect(observers.length).toBeGreaterThan(0);
        // Find the observer wired to the sentinel.
        const wired = observers.find(o =>
          o.observe.mock.calls.some(call => call[0] === sentinel),
        );
        expect(wired).toBeDefined();

        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        expect(captureSpy).toHaveBeenCalledWith('panel_scrolled_to_bottom', {
          species_code: 'vermfly',
        });
        const fires = captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom');
        expect(fires).toHaveLength(1);
        expect(wired!.disconnect).toHaveBeenCalled();

        // Second intersection must NOT re-fire (binary-only contract).
        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        const reFires = captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom');
        expect(reFires).toHaveLength(0);
        captureSpy.mockRestore();
      } finally {
        restore();
      }
    });

    it('does NOT arm panel_scrolled_to_bottom at the MID detent — no over-count on open (#914)', async () => {
      // The bug: the observer used to arm the moment species data resolved, which
      // is the MID (half) detent on open. At mid the About/taxonomy blocks are
      // display:none, so .sheet-fg content is short and the trailing sentinel can
      // already sit within the viewport → the observer fired on open with no real
      // scroll (an over-count). The detent gate (snap === 'full') means no
      // observer is wired to the sentinel at mid, so even a simulated intersection
      // cannot fire the event.
      const { observers, restore } = installIOMock();
      try {
        const captureSpy = vi.spyOn(analytics, 'capture');
        render(
          <SpeciesDetailSheet
            speciesCode="vermfly"
            apiClient={makeClient()}
            onClose={vi.fn()}
            mainRef={{ current: mainEl }}
          />,
        );
        const sheet = await screen.findByTestId('species-detail-sheet');
        const sentinel = await screen.findByTestId('detail-bottom-sentinel');
        // Sheet opens at half → MID content tier; the observer must NOT be armed.
        await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));

        // No observer is wired to the sentinel at the mid detent.
        const wired = observers.find(o =>
          o.observe.mock.calls.some(call => call[0] === sentinel),
        );
        expect(wired).toBeUndefined();

        // Even if some pre-existing observer's callback is triggered against the
        // sentinel, the event must not fire — nothing armed it at mid.
        captureSpy.mockClear();
        for (const o of observers) {
          act(() => {
            o.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              o as unknown as IntersectionObserver,
            );
          });
        }
        const fires = captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom');
        expect(fires).toHaveLength(0);
        captureSpy.mockRestore();
      } finally {
        restore();
      }
    });

    it('fires panel_scrolled_to_bottom AT MOST ONCE per species across a full→half→full round-trip (#910 once-per-species latch)', async () => {
      // T3 bot finding: firedRef reset on every full re-arm, so a full→half→full
      // round-trip re-fired the event for the SAME species (an over-count). The
      // latch is now keyed on speciesCode — it does NOT reset when merely
      // re-entering full for the same species (resets only on a species change).
      const { observers, restore } = installIOMock();
      try {
        const captureSpy = vi.spyOn(analytics, 'capture');
        render(
          <SpeciesDetailSheet
            speciesCode="vermfly"
            apiClient={makeClient()}
            onClose={vi.fn()}
            mainRef={{ current: mainEl }}
          />,
        );
        const sheet = await screen.findByTestId('species-detail-sheet');
        const sentinel = await screen.findByTestId('detail-bottom-sentinel');

        // First full: arm + intersect → fire once.
        const expand = await screen.findByRole('button', { name: /expand/i });
        await userEvent.click(expand);
        await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
        const wired1 = observers.find(o =>
          o.observe.mock.calls.some(call => call[0] === sentinel),
        );
        expect(wired1).toBeDefined();
        captureSpy.mockClear();
        act(() => {
          wired1!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired1 as unknown as IntersectionObserver,
          );
        });
        expect(
          captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom'),
        ).toHaveLength(1);

        // full → half (the observer disarms) ...
        const collapse = await screen.findByRole('button', { name: /collapse/i });
        await userEvent.click(collapse);
        await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));

        // ... then back to full (re-arm for the SAME species). The latch must NOT
        // reset — a second intersection must not re-fire.
        const expand2 = await screen.findByRole('button', { name: /expand/i });
        await userEvent.click(expand2);
        await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
        captureSpy.mockClear();
        for (const o of observers) {
          act(() => {
            o.callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              o as unknown as IntersectionObserver,
            );
          });
        }
        expect(
          captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom'),
        ).toHaveLength(0);
        captureSpy.mockRestore();
      } finally {
        restore();
      }
    });
  });
});

// ─── F8/F9/F10 a11y contract (T4 #910) ──────────────────────────────────────
//
// F8 — real focus trap at full. At full the sheet is role=dialog/aria-modal but
//   inert only covers #map-layer; Tab used to escape into the still-tabbable
//   AppHeader. The sheet now installs a Tab/Shift+Tab wrap (mirror of the
//   filters-panel trap in App.tsx) active ONLY at snap==='full'.
// F9 — focus restore on close. The sheet captures document.activeElement on
//   mount and restores it (if still attached) on EVERY close path; else falls
//   back to #main-surface.
// F10 — announce on reaching a readable detent. A visually-hidden
//   aria-live="polite" region inside the sheet root announces once per readable
//   detent (first peek→half), not re-firing on full→half, and never at peek.

describe('<SpeciesDetailSheet> — F8 focus trap at full (#910)', () => {
  let mainEl: HTMLElement;
  let headerBtn: HTMLButtonElement;

  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    // A real <main id="main-surface"> so the F9 fallback (and its non-null
    // assertion) resolves; an AppHeader control sibling so the trap has an
    // off-sheet focusable to (not) escape to.
    mainEl = document.createElement('main');
    mainEl.id = 'main-surface';
    mainEl.tabIndex = 0;
    document.body.appendChild(mainEl);
    headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.textContent = 'Filters';
    document.body.appendChild(headerBtn);
    __resetSpeciesDetailCache();
  });

  it('F9 fallback target #main-surface is present in the DOM (cannot silently no-op)', () => {
    // The restore fallback queries #main-surface; if that element is ever
    // renamed/removed the fallback drops focus onto <body> silently. This guard
    // asserts the fallback selector resolves in the test harness DOM.
    expect(document.querySelector('#main-surface')).not.toBeNull();
  });

  it('Tab from the LAST focusable in the sheet wraps to the first (stays in sheet, AppHeader not reachable)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector));
    expect(items.length).toBeGreaterThan(0);
    const first = items[0]!;
    const last = items[items.length - 1]!;

    // Land on the last focusable, then Tab forward — the wrap must return focus
    // to the first sheet focusable, never to the AppHeader Filters button.
    last.focus();
    expect(last).toHaveFocus();
    await userEvent.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(headerBtn).not.toHaveFocus();
    expect(first).toHaveFocus();
  });

  it('Shift+Tab from the FIRST focusable wraps to the last (stays in sheet)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector));
    const first = items[0]!;
    const last = items[items.length - 1]!;

    first.focus();
    expect(first).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(headerBtn).not.toHaveFocus();
    expect(last).toHaveFocus();
  });

  it('the trap is NOT installed at half (Tab can leave the sheet) and not at peek', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // Opens at half — NOT full. At half the map underneath is interactive, so
    // a trap would be wrong (and the role is region, not dialog).
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector));
    const last = items[items.length - 1]!;
    last.focus();
    // No wrap handler at half → Tab is NOT preventDefault'd. We assert the
    // sheet did NOT force focus back to its first element (the half-detent
    // behavior is the browser's native order; the trap must be absent).
    await userEvent.tab();
    expect(items[0]).not.toHaveFocus();
  });

  it('the trap tears down when leaving full → half (Tab no longer wrapped)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));

    // Collapse back to half — the trap must be removed.
    const collapse = await screen.findByRole('button', { name: /collapse/i });
    await userEvent.click(collapse);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector));
    const last = items[items.length - 1]!;
    last.focus();
    await userEvent.tab();
    // No wrap at half → focus is not forced back to the first item.
    expect(items[0]).not.toHaveFocus();
  });
});

describe('<SpeciesDetailSheet> — F9 focus restore on close (#910)', () => {
  let mainEl: HTMLElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    mainEl = document.createElement('main');
    mainEl.id = 'main-surface';
    mainEl.tabIndex = 0;
    document.body.appendChild(mainEl);
    // The element that "opened" the sheet — focus on mount, restored on close.
    opener = document.createElement('button');
    opener.type = 'button';
    opener.textContent = 'Open detail';
    document.body.appendChild(opener);
    __resetSpeciesDetailCache();
  });

  it('restores focus on the keyboard close path (ESC with focus inside the sheet → onClose → restore)', async () => {
    // #1026: Escape now DISMISSES the sheet outright (closeWithRestore →
    // onClose), no longer stepping detents. With focus inside the sheet (on the
    // handle) Escape fires onClose and restores focus to the opener.
    const onClose = vi.fn();
    opener.focus();
    expect(opener).toHaveFocus();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    // ESC with focus inside the sheet → closeWithRestore() → onClose.
    handle.focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('restores focus on the × single-pointer close (×→closeWithRestore→onClose→restore)', async () => {
    // #1026: the shared × is the single-pointer, non-drag close path (WCAG
    // 2.5.7). It must run through closeWithRestore so #910 focus-restore holds
    // on this path too (not only the keyboard/drag paths).
    const onClose = vi.fn();
    opener.focus();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
    await userEvent.click(screen.getByRole('button', { name: 'Close species detail' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('restores focus on drag-dismiss close', async () => {
    const onClose = vi.fn();
    opener.focus();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />,
    );
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    // A long drag-down past the dismiss floor calls onClose directly.
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 3, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 700, pointerId: 3, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 700, pointerId: 3, bubbles: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('falls back to #main-surface when the previously-focused element is detached at close', async () => {
    const onClose = vi.fn();
    opener.focus();
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        mainRef={{ current: mainEl }}
      />,
    );
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    // Detach the opener BEFORE close so document.contains(previous) is false →
    // the restore must fall back to #main-surface, not silently drop to <body>.
    opener.remove();
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 4, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 700, pointerId: 4, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 700, pointerId: 4, bubbles: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await waitFor(() => expect(mainEl).toHaveFocus());
  });
});

describe('<SpeciesDetailSheet> — F10 announce on readable detent (#910)', () => {
  let mainEl: HTMLElement;

  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    mainEl = document.createElement('main');
    mainEl.id = 'main-surface';
    mainEl.tabIndex = 0;
    document.body.appendChild(mainEl);
    __resetSpeciesDetailCache();
  });

  /** The visually-hidden live region is a descendant of the sheet root so it is
   *  announced under aria-modal at full. It carries aria-live="polite". */
  const liveRegion = (sheet: HTMLElement) =>
    sheet.querySelector<HTMLElement>('[data-testid="sheet-live-region"]');

  it('renders an aria-live="polite" region inside the sheet root (sr-only)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const region = liveRegion(sheet);
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('aria-live', 'polite');
    // Must be a DESCENDANT of the sheet root so it is announced under aria-modal.
    expect(sheet.contains(region)).toBe(true);
    // Visually hidden — the sr-only convention used app-wide.
    expect(region!.className).toMatch(/sr-only/);
  });

  it('announces the species once on opening at the readable half detent', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
    // The species name resolves and the half detent is readable → announce.
    await waitFor(() =>
      expect(liveRegion(sheet)!.textContent).toMatch(/vermilion flycatcher/i),
    );
  });

  it('does NOT re-announce on full→half (single announce per readable detent)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    await waitFor(() =>
      expect(liveRegion(sheet)!.textContent).toMatch(/vermilion flycatcher/i),
    );
    // Advance half → full. At full the heading-focus move owns the announce
    // (we do NOT double-fire the live region at full).
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
    // Clear the live region's text via a re-read marker: capture the current
    // text, return to half, and assert the live region content did NOT change
    // (no re-announce on full→half — the half detent was already announced).
    const before = liveRegion(sheet)!.textContent;
    const collapse = await screen.findByRole('button', { name: /collapse/i });
    await userEvent.click(collapse);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
    // The re-entry to half must NOT push a fresh announce (same text reference).
    expect(liveRegion(sheet)!.textContent).toBe(before);
  });

  it('does NOT announce at the peek detent (map focus is preserved)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeNoPhotoClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />,
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'half'));
    // The half open already announced; drag to peek and assert peek did not add
    // a fresh announce beyond the half one (text unchanged) — peek is below the
    // readable threshold. (We assert peek itself doesn't push an announce by
    // checking the announce count via the text not flipping to empty/peek-only.)
    const halfText = liveRegion(sheet)!.textContent;
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 5, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 600, pointerId: 5, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 740, pointerId: 5, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 740, pointerId: 5, bubbles: true }));
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'peek'));
    expect(liveRegion(sheet)!.textContent).toBe(halfText);
  });
});

describe('<SpeciesDetailSheet> — F14 reduced-motion resting end-state (#910)', () => {
  // motion.css collapses all transition/animation durations to 0ms under
  // prefers-reduced-motion. Under the page-side-by-side (#08) architecture the
  // RESTING state of every reveal/page is opacity:1 (the hidden from-state keys
  // on a NON-resting selector: [data-content='compact'] for the card-page
  // reveals, and the inactive-page base for the cross-fade). So under reduced-
  // motion (instant transition) live-tier content always lands VISIBLE, never
  // stuck invisible (F14 invariant). This asserts the resting end-states exist
  // in the authored CSS.
  // import.meta.url is not always a file:// URL under jsdom; resolve via
  // import.meta.dirname + join like tokens.css.test.ts (release-1 note).
  const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');

  it('global reduced-motion policy collapses transitions/animations to 0ms', () => {
    const motion = readFileSync(
      join(import.meta.dirname, '../styles/motion.css'),
      'utf8',
    );
    expect(motion).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(motion).toMatch(/transition-duration:\s*0ms\s*!important/);
    expect(motion).toMatch(/animation-duration:\s*0ms\s*!important/);
  });

  it('card-page reveals rest at opacity:1 (hidden from-state keys on compact, not the resting tier)', () => {
    // The unconditional card-page reveal channel is the RESTING state: opacity:1.
    expect(css).toMatch(
      /\.sheet-page--card\s+\.sheet-fg-record[\s\S]*?opacity:\s*1/,
    );
    // The HIDDEN from-state is keyed on [data-content='compact'] (NOT on the
    // resting mid tier) so mid content is present + visible at rest.
    expect(css).toMatch(
      /\[data-content='compact'\][^{]*\.sheet-page--card[^{]*\.sheet-fg-record[\s\S]*?opacity:\s*0/,
    );
  });

  it('the active page rests at opacity:1 via the #08 page-active selector', () => {
    // recipe #08: the page selected by [data-page] resolves to opacity:1, so the
    // entry page (taxonomy + About) + the card page land visible at rest under
    // reduced-motion — there is no display:none→block entry to get stuck on.
    expect(css).toMatch(
      /\.sheet-pages\[data-page='card'\]\s+\.sheet-page--card[\s\S]*?opacity:\s*1/,
    );
    expect(css).toMatch(
      /\.sheet-pages\[data-page='entry'\]\s+\.sheet-page--entry[\s\S]*?opacity:\s*1/,
    );
  });
});

describe('<SpeciesDetailSheet> — F8 false-comment cleanup + dead CSS (#910)', () => {
  const css = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8');

  it('the false "non-interactive" chrome comment is removed', () => {
    // The block claimed "chrome remains visible but non-interactive while the
    // modal sheet is open." — false once the AppHeader is reachable by Tab. F8
    // installs a real trap; the comment must go (the --z-modal rationale stays).
    expect(css).not.toMatch(/non-interactive\s+while the modal sheet is open/);
  });

  it('dead .sheet-fg-credits CSS is removed (credit comes from <SpeciesDescription>)', () => {
    // No `sheet-fg-credits` className is rendered; the credit is the
    // .species-detail-description-credit paragraph inside <SpeciesDescription>.
    expect(css).not.toMatch(/\.sheet-fg-credits\b/);
  });
});

describe('<SpeciesDetailSheet> — photoless silhouette fallback (#908 T2)', () => {
  let mainEl: HTMLElement;

  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    mainEl = document.createElement('main');
    mainEl.id = 'main-surface';
    document.body.appendChild(mainEl);
    __resetSpeciesDetailCache();
  });

  // The silhouette is a SINGLE <Photo> kept mounted across detents; only its
  // frame morphs per [data-content]. So .photo--silhouette must be present at
  // EVERY tier for a no-photo species — never a flat block. We assert presence
  // within .sheet-fg-photo (the morphing frame) at compact / mid / full.
  const silhouetteInFrame = (sheet: HTMLElement) =>
    sheet.querySelector('.sheet-fg-photo .photo--silhouette');

  it('renders .photo--silhouette at the MID tier (mount default = half snap)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeNoPhotoClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // Opens at half → MID content tier.
    await waitFor(() => expect(sheet).toHaveAttribute('data-content', 'mid'));
    // The no-photo branch renders the family silhouette glyph, not the <img>.
    expect(silhouetteInFrame(sheet)).not.toBeNull();
    expect(sheet.querySelector('.sheet-fg-photo .family-silhouette')).not.toBeNull();
    expect(sheet.querySelector('.sheet-fg-photo svg')).not.toBeNull();
    expect(sheet.querySelector('.sheet-fg-photo img')).toBeNull();
  });

  it('renders .photo--silhouette at the FULL tier (masthead detent)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeNoPhotoClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // One expand tap advances half → full → FULL (masthead) content tier.
    const expand = await screen.findByRole('button', { name: /expand/i });
    await userEvent.click(expand);
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'full'));
    await waitFor(() => expect(sheet).toHaveAttribute('data-content', 'full'));
    expect(silhouetteInFrame(sheet)).not.toBeNull();
    expect(sheet.querySelector('.sheet-fg-photo img')).toBeNull();
  });

  it('renders .photo--silhouette at the COMPACT tier (peek / 44px identity row)', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeNoPhotoClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    const handle = await screen.findByTestId('species-detail-sheet-handle');
    // Drag down from half toward peek (settles to the peek detent — 104px —
    // which resolves to the COMPACT content tier) WITHOUT crossing the dismiss
    // floor. A slow, short downward drag keeps velocity under the flick
    // threshold so it settles by position to the nearest detent (peek).
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientY: 400, pointerId: 9, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 600, pointerId: 9, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientY: 740, pointerId: 9, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientY: 740, pointerId: 9, bubbles: true }));
    await waitFor(() => expect(sheet).toHaveAttribute('data-snap-state', 'peek'));
    await waitFor(() => expect(sheet).toHaveAttribute('data-content', 'compact'));
    expect(silhouetteInFrame(sheet)).not.toBeNull();
    expect(sheet.querySelector('.sheet-fg-photo img')).toBeNull();
  });

  it('with-photo species renders the <img>, NOT the silhouette', async () => {
    render(
      <SpeciesDetailSheet
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
        mainRef={{ current: mainEl }}
      />
    );
    const sheet = await screen.findByTestId('species-detail-sheet');
    // The <img> mounts immediately (loading state) for a species with photoUrl.
    await waitFor(() => expect(sheet.querySelector('.sheet-fg-photo img')).not.toBeNull());
    expect(sheet.querySelector('.sheet-fg-photo .photo__img')).toHaveAttribute(
      'src',
      'https://photos.bird-maps.com/vermfly.jpg'
    );
    // No silhouette on the photo branch.
    expect(silhouetteInFrame(sheet)).toBeNull();
  });
});

describe('resolveContentTier (hysteresis)', () => {
  // Use a viewport where the detent heights are easy to reason about.
  // vh = 1000 → half = 600, full = 992, midFullBoundary = 796.
  // compact↔mid boundary = PEEK_PX(104) + 64 = 168.
  // Dead-band = ±24px.
  const VH = 1000;

  it('ascending crosses each boundary at boundary + 24 (up-threshold)', () => {
    // Just below the compact→mid up-threshold (168 + 24 = 192): stays compact.
    expect(resolveContentTier(191, 'compact', VH)).toBe('compact');
    // At the up-threshold: promotes to mid.
    expect(resolveContentTier(192, 'compact', VH)).toBe('mid');
    // Just below the mid→full up-threshold (796 + 24 = 820): stays mid.
    expect(resolveContentTier(819, 'mid', VH)).toBe('mid');
    // At the up-threshold: promotes to full.
    expect(resolveContentTier(820, 'mid', VH)).toBe('full');
  });

  it('descending holds the previous tier inside the ±24px dead-band', () => {
    // Coming DOWN from full, the height must drop below midFullBoundary − 24
    // (796 − 24 = 772) before demoting. Within the band (772..820) full holds.
    expect(resolveContentTier(800, 'full', VH)).toBe('full');
    expect(resolveContentTier(772, 'full', VH)).toBe('full'); // exactly the band edge holds
    expect(resolveContentTier(771, 'full', VH)).toBe('mid');  // one px past → demote
    // Coming DOWN from mid, must drop below 168 − 24 = 144 to reach compact.
    expect(resolveContentTier(150, 'mid', VH)).toBe('mid');
    expect(resolveContentTier(144, 'mid', VH)).toBe('mid');
    expect(resolveContentTier(143, 'mid', VH)).toBe('compact');
  });

  it('oscillation inside a band keeps the previous tier (no thrash)', () => {
    // A finger hovering at 180px (between the 144 demote-floor and the 192
    // promote-ceiling around the compact↔mid boundary) keeps whatever tier it
    // already had — mid stays mid, compact stays compact.
    expect(resolveContentTier(180, 'mid', VH)).toBe('mid');
    expect(resolveContentTier(180, 'compact', VH)).toBe('compact');
    // Same dead-band behavior around the mid↔full boundary at 790px.
    expect(resolveContentTier(790, 'full', VH)).toBe('full');
    expect(resolveContentTier(790, 'mid', VH)).toBe('mid');
  });

  it('promotes/demotes by more than one tier when the height jumps far', () => {
    // A large jump (e.g. a flick) from compact straight into the full band
    // promotes across both boundaries in one call.
    expect(resolveContentTier(900, 'compact', VH)).toBe('full');
    // And a collapse from full straight to the bottom demotes to compact.
    expect(resolveContentTier(50, 'full', VH)).toBe('compact');
  });
});
