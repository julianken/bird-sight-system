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
  // right edge to fit POPOVER_W=280 + OFFSET=12, the popover flips to the
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
    // 850 + 12 + 280 = 1142 > 1000 → flipX path.
    const left = parseInt(dialog.style.left, 10);
    expect(left).toBeLessThan(850);
    // 850 - 12 - 280 = 558.
    expect(left).toBe(558);
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
});
