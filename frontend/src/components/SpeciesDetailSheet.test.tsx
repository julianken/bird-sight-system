import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailSheet, resolveContentTier } from './SpeciesDetailSheet.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { __resetSpeciesDetailCache } from '../data/use-species-detail.js';

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
