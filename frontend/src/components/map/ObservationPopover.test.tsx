import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { ObservationPopover } from './ObservationPopover.js';

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
    regionId: null,
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
});
