import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import type { SpeciesOption } from './FiltersBar.js';
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
    familyCode: null,
  };
}

describe('FeedSurface', () => {
  // eBird API ToU §3 attribution moved to the app-level AttributionModal
  // (#250) and is reachable from every view via the persistent footer in
  // App.tsx. FeedSurface no longer carries a per-surface footer — the
  // assertion that lived here is now covered by the AttributionModal
  // unit tests + the e2e attribution-modal spec.

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
    // Notable signal is in the row's aria-label prefix (ARIA accname computation
    // silences child labels on labelled buttons).
    expect(
      screen.getByRole('button', { name: /^Notable sighting,/ }),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: /Vermilion/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  describe('sort toggle', () => {
    const items = [
      obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
      obs({ subId: 'S3', speciesCode: 'annhum', comName: "Anna's Hummingbird" }),
    ];
    const speciesIndex: SpeciesOption[] = [
      { code: 'vermfly', comName: 'Vermilion Flycatcher', taxonOrder: 30501, familyCode: 'tyrannidae' },
      { code: 'cacwre', comName: 'Cactus Wren', taxonOrder: 25000, familyCode: 'troglodytidae' },
      { code: 'annhum', comName: "Anna's Hummingbird", taxonOrder: null, familyCode: 'trochilidae' },
    ];

    it('renders a keyboard-accessible sort toggle above the list', () => {
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      const sortGroup = screen.getByRole('radiogroup', { name: /Sort/i });
      expect(sortGroup).toBeInTheDocument();
      // Radio-button pattern = native keyboard support (arrow keys traverse).
      const recent = within(sortGroup).getByRole('radio', { name: /Recent/i });
      const taxonomic = within(sortGroup).getByRole('radio', { name: /Taxonomic/i });
      expect(recent).toBeInTheDocument();
      expect(taxonomic).toBeInTheDocument();
    });

    it('defaults to Recent sort (preserves server order, no client re-sort)', () => {
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      const recent = screen.getByRole('radio', { name: /Recent/i }) as HTMLInputElement;
      expect(recent.checked).toBe(true);
      const rows = screen.getAllByRole('button');
      expect(rows[0]).toHaveTextContent('Vermilion Flycatcher');
      expect(rows[1]).toHaveTextContent('Cactus Wren');
      expect(rows[2]).toHaveTextContent("Anna's Hummingbird");
    });

    it('Taxonomic sort orders by taxonOrder ASC with nulls last', async () => {
      const user = userEvent.setup();
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      await user.click(screen.getByRole('radio', { name: /Taxonomic/i }));
      const rows = screen.getAllByRole('button');
      // cacwre (25000) → vermfly (30501) → annhum (null, sorted last)
      expect(rows[0]).toHaveTextContent('Cactus Wren');
      expect(rows[1]).toHaveTextContent('Vermilion Flycatcher');
      expect(rows[2]).toHaveTextContent("Anna's Hummingbird");
    });

    it('Taxonomic sort is stable under null-only input (all species sort alphabetically)', async () => {
      // Cold-load expectation: without cached SpeciesMeta, every
      // taxonOrder is null. The null-last policy says the whole group
      // sorts alphabetically by comName.
      const user = userEvent.setup();
      const nullIndex: SpeciesOption[] = [
        { code: 'vermfly', comName: 'Vermilion Flycatcher', taxonOrder: null, familyCode: null },
        { code: 'cacwre', comName: 'Cactus Wren', taxonOrder: null, familyCode: null },
        { code: 'annhum', comName: "Anna's Hummingbird", taxonOrder: null, familyCode: null },
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={nullIndex}
        />
      );
      await user.click(screen.getByRole('radio', { name: /Taxonomic/i }));
      const rows = screen.getAllByRole('button');
      // Alphabetical fallback: Anna's → Cactus → Vermilion
      expect(rows[0]).toHaveTextContent("Anna's Hummingbird");
      expect(rows[1]).toHaveTextContent('Cactus Wren');
      expect(rows[2]).toHaveTextContent('Vermilion Flycatcher');
    });

    it('toggling back to Recent restores server order', async () => {
      const user = userEvent.setup();
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      await user.click(screen.getByRole('radio', { name: /Taxonomic/i }));
      await user.click(screen.getByRole('radio', { name: /Recent/i }));
      const rows = screen.getAllByRole('button');
      expect(rows[0]).toHaveTextContent('Vermilion Flycatcher');
      expect(rows[1]).toHaveTextContent('Cactus Wren');
      expect(rows[2]).toHaveTextContent("Anna's Hummingbird");
    });

    it('hides the sort toggle while loading', () => {
      render(
        <FeedSurface
          loading={true}
          observations={[]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      expect(screen.queryByRole('radiogroup', { name: /Sort/i })).toBeNull();
    });

    it('hides the sort toggle on the empty state', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          speciesIndex={speciesIndex}
        />
      );
      expect(screen.queryByRole('radiogroup', { name: /Sort/i })).toBeNull();
    });

    it('works with no speciesIndex prop (prop is optional)', () => {
      // Back-compat: callers that haven't been updated to pass speciesIndex
      // still get a functioning Recent-sorted feed.
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
        />
      );
      const rows = screen.getAllByRole('button');
      // Rows still rendered; taxonomic toggle still present but
      // falls back to alphabetical when speciesIndex is missing.
      expect(rows).toHaveLength(3);
    });
  });
});
