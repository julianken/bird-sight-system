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
    expect(sheet).toHaveAttribute('data-snap-state', 'full');

    // Move focus outside the sheet (back into <main>) — ESC should NOT
    // collapse the sheet now.
    mainEl.tabIndex = 0;
    mainEl.focus();
    await userEvent.keyboard('{Escape}');
    expect(sheet).toHaveAttribute('data-snap-state', 'full');

    // Move focus back inside the sheet — ESC should collapse it (full → half).
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
