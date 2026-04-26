import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MosaicMarker } from './MosaicMarker.js';
import type { MosaicTile } from './cluster-mosaic.js';

function tile(partial: Partial<MosaicTile> & { familyCode: string }): MosaicTile {
  return {
    familyCode: partial.familyCode,
    count: partial.count ?? 1,
    color: partial.color ?? '#C77A2E',
    svgData: partial.svgData ?? 'M0 0L1 1Z',
    isFallback: partial.isFallback ?? false,
  };
}

describe('MosaicMarker', () => {
  it('renders a button with role + aria-label describing the cluster', () => {
    // The marker is the click surface for the existing cluster zoom-into
    // handler. Treat it as an interactive button so screen readers expose
    // the cluster size + click affordance.
    render(
      <MosaicMarker
        tiles={[tile({ familyCode: 'tyrannidae' })]}
        totalCount={3}
        onClick={() => {}}
      />,
    );
    const button = screen.getByRole('button');
    const label = button.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/cluster/i);
    expect(label).toMatch(/3/);
  });

  it('renders one <path> per tile — up to 4 — when all tiles have svgData', () => {
    render(
      <MosaicMarker
        tiles={[
          tile({ familyCode: 'tyrannidae', svgData: 'M0 0L1 1Z' }),
          tile({ familyCode: 'trochilidae', svgData: 'M2 2L3 3Z' }),
          tile({ familyCode: 'picidae', svgData: 'M4 4L5 5Z' }),
          tile({ familyCode: 'corvidae', svgData: 'M6 6L7 7Z' }),
        ]}
        totalCount={8}
        onClick={() => {}}
      />,
    );
    // The button contains one <svg> per tile cell. Look up by the data-
    // testid we attach to each tile so the assertion doesn't accidentally
    // pick up the count-badge SVG.
    const cells = screen.getAllByTestId('mosaic-tile');
    expect(cells).toHaveLength(4);
  });

  it('renders the count badge with totalCount text', () => {
    render(
      <MosaicMarker
        tiles={[tile({ familyCode: 'tyrannidae' })]}
        totalCount={7}
        onClick={() => {}}
      />,
    );
    expect(screen.getByTestId('mosaic-count-badge')).toHaveTextContent('7');
  });

  it('marks fallback tiles with data-fallback="true" so styles can dim them', () => {
    render(
      <MosaicMarker
        tiles={[
          tile({ familyCode: 'tyrannidae' }),
          tile({ familyCode: 'uncurated', svgData: null, isFallback: true }),
        ]}
        totalCount={5}
        onClick={() => {}}
      />,
    );
    const cells = screen.getAllByTestId('mosaic-tile');
    expect(cells[0]).toHaveAttribute('data-fallback', 'false');
    expect(cells[1]).toHaveAttribute('data-fallback', 'true');
  });

  it('invokes onClick with the original mouse event when the marker is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <MosaicMarker
        tiles={[tile({ familyCode: 'tyrannidae' })]}
        totalCount={3}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders with totalCount even when tiles is empty (degenerate cluster)', () => {
    // Defensive: a cluster could in theory have only null-familyCode leaves
    // (every species missing from species_meta). Renderer must not crash;
    // it should still show the count + an empty grid.
    render(
      <MosaicMarker tiles={[]} totalCount={2} onClick={() => {}} />,
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByTestId('mosaic-count-badge')).toHaveTextContent('2');
  });
});
