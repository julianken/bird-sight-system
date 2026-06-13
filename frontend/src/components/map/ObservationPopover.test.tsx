import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { ObservationPopover } from './ObservationPopover.js';

// jsdom lacks ResizeObserver. The popover's measured-height effect
// noops when the global is undefined, but stubbing it here keeps the
// effect runnable and protects future tests that exercise the
// measurement path.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ResizeObserver = StubResizeObserver;
  }
});

function makeObs(partial: Partial<Observation> = {}): Observation {
  return {
    subId: partial.subId ?? 'S001',
    speciesCode: partial.speciesCode ?? 'vermfly',
    comName: partial.comName ?? 'Vermilion Flycatcher',
    lat: partial.lat ?? 32.2,
    lng: partial.lng ?? -110.9,
    obsDt: partial.obsDt ?? '2026-04-15T10:00:00Z',
    locId: partial.locId ?? 'L001',
    locName: 'locName' in partial ? (partial.locName as string | null) : 'Sabino Canyon',
    howMany: 'howMany' in partial ? (partial.howMany as number | null) : 3,
    isNotable: partial.isNotable ?? false,
    silhouetteId: null,
    familyCode: null,
  };
}

describe('ObservationPopover', () => {
  it('renders nothing when observation is null', () => {
    render(
      <ObservationPopover
        observation={null}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the species common name + close button + detail link', () => {
    render(
      <ObservationPopover
        observation={makeObs()}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    expect(screen.getByText('Vermilion Flycatcher')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /see species details/i }),
    ).toBeInTheDocument();
  });

  it('clicking the detail link calls onSelectSpecies with speciesCode (NOT a navigation)', async () => {
    // The link must NOT be an <a href> — App.tsx mounts surfaces
    // mutually-exclusive (no #species-detail anchor exists during view=map),
    // and a hash-link wouldn't switch view state. Use the URL-state
    // setter (passed as onSelectSpecies). This mirrors the skip-link
    // pattern from #247.
    const onSelectSpecies = vi.fn();
    const obs = makeObs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker' });
    render(
      <ObservationPopover
        observation={obs}
        onClose={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />,
    );

    const link = screen.getByRole('button', { name: /see species details/i });
    // Confirm it's a button, not an anchor — preserves the URL-state
    // contract documented above.
    expect(link.tagName).toBe('BUTTON');
    expect(link.getAttribute('href')).toBeNull();

    await userEvent.click(link);
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
    expect(onSelectSpecies).toHaveBeenCalledWith('gilwoo');
  });

  it('renders the notable badge when observation is notable', () => {
    render(
      <ObservationPopover
        observation={makeObs({ isNotable: true })}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Notable')).toBeInTheDocument();
  });

  it('renders location and count rows when present', () => {
    render(
      <ObservationPopover
        observation={makeObs({ locName: 'Madera Canyon', howMany: 7 })}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    expect(screen.getByText('Madera Canyon')).toBeInTheDocument();
    expect(screen.getByText(/Count:\s*7/)).toBeInTheDocument();
  });

  it('omits the count row when howMany is null', () => {
    render(
      <ObservationPopover
        observation={makeObs({ howMany: null })}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Count:/)).not.toBeInTheDocument();
  });

  it('clicking close calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <ObservationPopover
        observation={makeObs()}
        onClose={onClose}
        onSelectSpecies={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Issue #718 — popover must anchor to the supplied screen coordinates
  // (projected from the clicked marker's lng/lat) rather than the legacy
  // top-left of the map surface. Verifies the inline-style positioning.
  it('renders at the supplied screen coordinates', () => {
    // Force a known viewport so flipX/flipY don't trigger.
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    render(
      <ObservationPopover
        observation={makeObs()}
        position={{ x: 100, y: 200 }}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    // OFFSET = 12 in the implementation. The default (no-flip) path puts
    // the popover below-right of the click.
    expect(dialog.style.left).toBe('112px');
    expect(dialog.style.top).toBe('212px');
    expect(dialog.style.position).toBe('absolute');
  });

  // Issue #718 — viewport-edge clamp: when a click lands too close to the
  // right edge to fit POPOVER_W=300 + OFFSET=12, the popover flips to the
  // left of the click.
  it('flips to the left of the click when near the right edge', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    render(
      <ObservationPopover
        observation={makeObs()}
        position={{ x: 850, y: 100 }}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    // 850 + 12 + 300 = 1162 > 1000 → flipX path.
    const left = parseInt(dialog.style.left, 10);
    expect(left).toBeLessThan(850);
    // 850 - 12 - 300 = 538.
    expect(left).toBe(538);
  });

  it('omits inline left/top when position is null (legacy harness path)', () => {
    render(
      <ObservationPopover
        observation={makeObs()}
        position={null}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    // No position → CSS rule alone governs layout; no inline left/top.
    expect(dialog.style.left).toBe('');
    expect(dialog.style.top).toBe('');
  });

  // #1031 — dialog contract (focus-in, Escape, focus-return). Mirrors the
  // CellPopover / ClusterListPopover sibling contract. Because the popover's
  // open path is coordinate-based (the triggering element is discarded at
  // click time), focus-return RE-QUERIES the live opener element by subId at
  // dismissal time rather than holding an `anchorEl` prop.
  describe('dialog contract (#1031)', () => {
    it('moves focus into the dialog (onto the heading) on mount', () => {
      render(
        <ObservationPopover
          observation={makeObs()}
          onClose={vi.fn()}
          onSelectSpecies={vi.fn()}
        />,
      );
      const dialog = screen.getByRole('dialog');
      // Focus lands inside the dialog — on the programmatically-focusable
      // heading (tabIndex=-1), matching CellPopover.
      expect(dialog.contains(document.activeElement)).toBe(true);
      const heading = screen.getByText('Vermilion Flycatcher');
      expect(document.activeElement).toBe(heading);
      expect(heading).toHaveAttribute('tabindex', '-1');
    });

    it('Escape closes and returns focus to a displaced-silhouette opener (data-subid)', async () => {
      const onClose = vi.fn();
      const opener = document.createElement('button');
      opener.setAttribute('data-subid', 'S001');
      document.body.appendChild(opener);
      render(
        <ObservationPopover
          observation={makeObs({ subId: 'S001' })}
          onClose={onClose}
          onSelectSpecies={vi.fn()}
        />,
      );
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it('Escape closes and returns focus to a hit-layer opener (data-sub-id, tabIndex=-1)', async () => {
      const onClose = vi.fn();
      const opener = document.createElement('button');
      opener.setAttribute('data-sub-id', 'S001');
      opener.tabIndex = -1; // hit-layer buttons are tabIndex={-1} — .focus() still works
      document.body.appendChild(opener);
      render(
        <ObservationPopover
          observation={makeObs({ subId: 'S001' })}
          onClose={onClose}
          onSelectSpecies={vi.fn()}
        />,
      );
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(opener);
      opener.remove();
    });

    it('× close returns focus to the originating marker button (both spellings)', async () => {
      // data-subid spelling.
      {
        const onClose = vi.fn();
        const opener = document.createElement('button');
        opener.setAttribute('data-subid', 'S001');
        document.body.appendChild(opener);
        const { unmount } = render(
          <ObservationPopover
            observation={makeObs({ subId: 'S001' })}
            onClose={onClose}
            onSelectSpecies={vi.fn()}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(opener);
        unmount();
        opener.remove();
      }
      // data-sub-id spelling.
      {
        const onClose = vi.fn();
        const opener = document.createElement('button');
        opener.setAttribute('data-sub-id', 'S002');
        document.body.appendChild(opener);
        render(
          <ObservationPopover
            observation={makeObs({ subId: 'S002' })}
            onClose={onClose}
            onSelectSpecies={vi.fn()}
          />,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(opener);
        opener.remove();
      }
    });

    it('falls back to targeting the map wrapper when no opener element resolves', async () => {
      const onClose = vi.fn();
      // No marker button in the DOM for this subId (marker left the
      // data/viewport). The map wrapper IS present.
      //
      // This wrapper deliberately mirrors PRODUCTION exactly — a bare <div>
      // with no tabIndex. Earlier this test hand-set `wrapper.tabIndex = -1`,
      // which the production wrapper (MapCanvas.tsx) did NOT have, so the test
      // gave false confidence: it asserted focus LANDED on a focusable div the
      // production code never produced. Whether the real wrapper is actually
      // focusable is now guarded honestly in MapCanvas.test.tsx ('#1031: the
      // map-canvas wrapper is programmatically focusable'). Here, in isolation
      // from the real wrapper, we assert only what this unit can honestly own:
      // that `returnFocus()`'s fallback RESOLVES and `.focus()`-targets the map
      // wrapper (rather than no-op-ing on an unresolved element / document.body).
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-testid', 'map-canvas');
      const focusSpy = vi.spyOn(wrapper, 'focus');
      document.body.appendChild(wrapper);
      render(
        <ObservationPopover
          observation={makeObs({ subId: 'GONE' })}
          onClose={onClose}
          onSelectSpecies={vi.fn()}
        />,
      );
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      // The fallback must reach the map wrapper, not silently no-op.
      expect(focusSpy).toHaveBeenCalledTimes(1);
      focusSpy.mockRestore();
      wrapper.remove();
    });
  });

  // C1 #1045: thousands separators
  it('C1 #1045: renders howMany with thousands separator for counts ≥1000', () => {
    render(
      <ObservationPopover
        observation={makeObs({ howMany: 1500 })}
        onClose={vi.fn()}
        onSelectSpecies={vi.fn()}
      />,
    );
    // "Count: 1,500" not "Count: 1500".
    expect(screen.getByText(/Count:\s*1,500/)).toBeInTheDocument();
  });
});
