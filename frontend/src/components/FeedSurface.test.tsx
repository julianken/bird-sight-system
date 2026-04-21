import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { FeedSurface } from './FeedSurface.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

function obs(partial: Partial<Observation>): Observation {
  return {
    subId: partial.subId ?? 'S000',
    speciesCode: partial.speciesCode ?? 'vermfly',
    comName: partial.comName ?? 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: partial.obsDt ?? new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    locId: 'L001',
    locName: partial.locName ?? 'Sabino Canyon',
    howMany: partial.howMany ?? 1,
    isNotable: partial.isNotable ?? false,
    regionId: null,
    silhouetteId: null,
  };
}

describe('FeedSurface', () => {
  it('renders a loading state while loading is true', () => {
    render(
      <FeedSurface
        loading={true}
        observations={[]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders an empty state with the generic hint when no filters are active', () => {
    render(
      <FeedSurface
        loading={false}
        observations={[]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    // Two distinguishers per the spec: "no matches for filters" vs "site
    // broken". The data pipe already separates error states from empty, so
    // the generic empty-state copy must NOT suggest an outage.
    expect(screen.getByText(/No observations/i)).toBeInTheDocument();
    // Filter-aware hints are suppressed when no narrowing filter is set.
    expect(screen.queryByText(/Notable/i)).toBeNull();
    expect(screen.queryByText(/Today/i)).toBeNull();
  });

  it('renders a filter-aware hint when notable=true produces no rows', () => {
    render(
      <FeedSurface
        loading={false}
        observations={[]}
        now={NOW}
        filters={{ notable: true, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText(/notable only/i)).toBeInTheDocument();
  });

  it('renders a filter-aware hint when since=1d produces no rows', () => {
    render(
      <FeedSurface
        loading={false}
        observations={[]}
        now={NOW}
        filters={{ notable: false, since: '1d' }}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText(/today/i)).toBeInTheDocument();
  });

  it('renders an ordered list with one row per observation', () => {
    const items = [
      obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
    ];
    render(
      <FeedSurface
        loading={false}
        observations={items}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    const list = screen.getByRole('list', { name: 'Observations' });
    expect(list.tagName).toBe('OL');
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Vermilion Flycatcher');
    expect(rows[1]).toHaveTextContent('Cactus Wren');
  });

  it('renders notable row badges even when the global ?notable filter is active', () => {
    // Scenario: user has ?notable=true — backend has already narrowed to
    // notable-only observations. Every row should STILL render the per-row
    // notable badge (redundant with the filter, but asserts that the row
    // badge is driven by observation.isNotable, not by filter state).
    render(
      <FeedSurface
        loading={false}
        observations={[obs({ isNotable: true, speciesCode: 'a1' })]}
        now={NOW}
        filters={{ notable: true, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByLabelText('Notable sighting')).toBeInTheDocument();
  });

  it('clicking a row forwards the species code to onSelectSpecies', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedSurface
        loading={false}
        observations={[obs({ subId: 'S1', speciesCode: 'vermfly' })]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={onSelectSpecies}
      />
    );
    await user.click(screen.getByRole('button'));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });
});
