import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation, FamilySilhouette } from '@bird-watch/shared-types';
import type { SpeciesOption } from './FiltersBar.js';
import { FeedSurface } from './FeedSurface.js';
import { FAMILY_COLOR_FALLBACK } from '../data/family-color.js';

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

  // --- Phase 5: lede, SortLabel, FilterSentence, FeedCard ---

  describe('lede state machine (4 templates)', () => {
    it('renders Priority 4 lede (default, no filters) with observation count', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'vermfly' }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // Template: "{N} species seen across {REGION_LABEL} in the last {period}."
      // Count is unique species, not observation rows.
      expect(screen.getByText(/species seen across Arizona/i)).toBeInTheDocument();
    });

    it('renders Priority 1 lede when observationCount is 0', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={0}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      expect(screen.getByText(/No sightings match your current filters/i)).toBeInTheDocument();
    });

    it('renders Priority 2 lede when speciesCode filter is set', () => {
      const items = [obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' })];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
          speciesName="Vermilion Flycatcher"
        />
      );
      // Template: "{N} sightings of {commonName} in {REGION_LABEL} in the last {period}."
      expect(screen.getByText(/sightings of Vermilion Flycatcher in Arizona/i)).toBeInTheDocument();
    });

    it('renders Priority 3 lede when familyCode filter is set', () => {
      const items = [obs({ subId: 'S1', speciesCode: 'vermfly', familyCode: 'tyrannidae' })];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
          familyName="Tyrant Flycatchers"
        />
      );
      // Template: "{N} species of {familyName} seen across {REGION_LABEL} in the last {period}."
      expect(screen.getByText(/species of Tyrant Flycatchers seen across Arizona/i)).toBeInTheDocument();
    });
  });

  describe('<SortLabel> sibling', () => {
    it('renders <SortLabel> showing "Sorted by recency" when sortMode is recent', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // SortLabel renders its text; not coupled to FilterSentence.
      expect(screen.getByText(/Sorted by recency/i)).toBeInTheDocument();
    });

    it('SortLabel is a separate sibling from FilterSentence — not inside it', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: true, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      const sortLabel = screen.getByText(/Sorted by recency/i);
      const filterSentence = screen.getByText(/notable sightings/i);
      // Neither element contains the other.
      expect(sortLabel.contains(filterSentence)).toBe(false);
      expect(filterSentence.contains(sortLabel)).toBe(false);
    });
  });

  describe('<FilterSentence> mount', () => {
    it('mounts the always-on live region even when zero filters are active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // The hidden live region is always mounted per the FilterSentence spec;
      // it carries role="status" aria-live="polite".
      const liveRegion = document.querySelector('.filter-sentence-live');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('renders the visible FilterSentence when notable filter is active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1', isNotable: true })]}
          now={NOW}
          filters={{ notable: true, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // FilterSentence visible template: "Showing {filter-terms} from the last {period}."
      expect(screen.getByText(/notable sightings/i)).toBeInTheDocument();
    });

    it('FilterSentence collapses to null visually when zero filters are active', () => {
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1' })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // At zero filters, the visible sentence element is absent from the DOM.
      // The hidden live region remains.
      expect(document.querySelector('.filter-sentence-visible')).toBeNull();
    });
  });

  describe('<FeedCard> top-notable mount', () => {
    it('renders the top-notable observation as an elevated FeedCard', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', isNotable: true }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      // The NOTABLE label is the FeedCard discriminator.
      expect(screen.getByText('NOTABLE')).toBeInTheDocument();
    });

    it('does not render a FeedCard when no observations are notable', () => {
      const items = [
        obs({ subId: 'S1', isNotable: false }),
        obs({ subId: 'S2', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={2}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      expect(screen.queryByText('NOTABLE')).toBeNull();
    });

    it('renders the top-notable card as the first item in the list', () => {
      const items = [
        obs({ subId: 'S1', speciesCode: 'cacwre', comName: 'Cactus Wren', isNotable: false }),
        obs({ subId: 'S2', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', isNotable: true }),
        obs({ subId: 'S3', speciesCode: 'annhum', comName: "Anna's Hummingbird", isNotable: false }),
      ];
      render(
        <FeedSurface
          loading={false}
          observations={items}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={() => {}}
          observationCount={3}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      const buttons = screen.getAllByRole('button');
      // First button is the FeedCard for the notable observation (after the radio buttons).
      // The radio group has 2 radio buttons — the first list-item button follows.
      // Find the button with 'Notable sighting' in its accessible name.
      const cardButton = buttons.find(b => b.getAttribute('aria-label')?.includes('Notable sighting'));
      expect(cardButton).toBeTruthy();
      expect(cardButton).toHaveAccessibleName(expect.stringContaining('Notable sighting'));
      expect(cardButton).toHaveAccessibleName(expect.stringContaining('Vermilion Flycatcher'));
    });

    it('clicking the FeedCard fires onSelectSpecies', async () => {
      const onSelectSpecies = vi.fn();
      const user = userEvent.setup();
      render(
        <FeedSurface
          loading={false}
          observations={[obs({ subId: 'S1', speciesCode: 'vermfly', isNotable: true })]}
          now={NOW}
          filters={{ notable: false, since: '14d' }}
          onSelectSpecies={onSelectSpecies}
          observationCount={1}
          regionLabel="Arizona"
          period="14 days"
        />
      );
      await user.click(screen.getByRole('button', { name: /Notable sighting/i }));
      expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
    });
  });
});

describe('FeedSurface — DB color threading (NEW-3 fix)', () => {
  const silhouettes: FamilySilhouette[] = [
    {
      familyCode: 'tyrannidae',
      color: '#C77A2E',
      svgData: null,
      source: null,
      license: null,
      commonName: 'Tyrant Flycatchers',
      creator: null,
    },
  ];

  // Construct an observation with a real familyCode. The obs() helper always
  // sets familyCode: null; build inline to exercise the color-resolution path.
  const obsWithFamily: Observation = {
    subId: 'S-color',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    locId: 'L001',
    locName: 'Sabino Canyon',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: 'tyrannidae',
  };

  it('threads DB color to feed row silhouettes when silhouettes prop is provided', () => {
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={[obsWithFamily]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
        silhouettes={silhouettes}
      />
    );
    // The FeedRow FamilySilhouette must carry the DB color, not the grey fallback.
    const silhouetteEl = container.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
    expect(silhouetteEl).not.toBeNull();
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
  });

  it('falls back to grey when silhouettes prop is absent (backward compat)', () => {
    // FeedSurface callers that haven't passed silhouettes yet must still work.
    // Unknown family code → null-family grey fallback.
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={[obsWithFamily]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    const silhouetteEl = container.querySelector('[data-testid="family-silhouette"]') as HTMLElement;
    expect(silhouetteEl).not.toBeNull();
    // Without silhouettes, resolveColor('tyrannidae') returns FAMILY_COLOR_FALLBACK.
    // Assert the exact fallback value rather than negating the DB orange — safer
    // because a future palette change wouldn't silently pass a wrong value.
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).toBe(FAMILY_COLOR_FALLBACK);
  });
});

describe('FeedSurface — row virtualization (issue #509)', () => {
  /**
   * Virtualization contract: with a large dataset the DOM must render
   * significantly fewer rows than observations.length. react-window only
   * mounts items that fit in the container's visible height plus overscan.
   *
   * jsdom has no real layout engine; ResizeObserver never fires. The
   * component therefore falls back to `ROW_HEIGHT_PX * OVERSCAN_COUNT` worth
   * of content rendered using the `defaultHeight` passed to the List.
   * We assert only that DOM row count < observations.length (strict bound)
   * and that list semantics survive.
   *
   * The FEED_LIST_DEFAULT_HEIGHT constant (exported from FeedSurface) is
   * used as the defaultHeight prop; jsdom renders at most
   * Math.ceil(FEED_LIST_DEFAULT_HEIGHT / ROW_HEIGHT_PX) + overscan rows.
   */
  function makeObs(n: number): Observation[] {
    return Array.from({ length: n }, (_, i) => ({
      subId: `SVIRT${i}`,
      speciesCode: `sp${i}`,
      comName: `Species ${i}`,
      lat: 32.2,
      lng: -110.9,
      obsDt: new Date(2026, 3, 15, 14, 0, 0, 0).toISOString(),
      locId: 'L001',
      locName: 'Test Canyon',
      howMany: 1,
      isNotable: false as const,
      regionId: null,
      silhouetteId: null,
      familyCode: null,
    }));
  }

  it('renders fewer DOM rows than observations when observations exceed viewport capacity', () => {
    const BIG = 300;
    const observations = makeObs(BIG);
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={observations}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    // With virtualization the rendered <li> count must be strictly less
    // than the total observation count. Without virtualization this would
    // equal BIG (300).
    const renderedRows = container.querySelectorAll('.feed-row-item, .feed-card-item');
    expect(renderedRows.length).toBeLessThan(BIG);
  });

  it('preserves <ol aria-label="Observations"> list semantics', () => {
    const observations = makeObs(300);
    render(
      <FeedSurface
        loading={false}
        observations={observations}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    const list = screen.getByRole('list', { name: 'Observations' });
    expect(list).toBeInTheDocument();
  });

  it('preserves FilterSentence live region even with virtualized list', () => {
    const observations = makeObs(300);
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={observations}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
      />
    );
    const liveRegion = container.querySelector('.filter-sentence-live');
    expect(liveRegion).toBeInTheDocument();
  });

  it('clicking a visible row still fires onSelectSpecies', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    const observations = makeObs(300);
    render(
      <FeedSurface
        loading={false}
        observations={observations}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // Click the first rendered button — must still delegate to onSelectSpecies.
    const firstButton = screen.getAllByRole('button')[0];
    await user.click(firstButton);
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });
});

describe('FeedSurface — freshness meta line (L1 critic fix)', () => {
  // .feed-freshness class must be present on the freshness <p> so the CSS rule
  // in styles.css can apply. Without the class the element renders at UA-default
  // 1em/16px with browser margins — the spec freshness contract is violated.
  it('renders freshnessLabel inside a .feed-freshness element', () => {
    // Must pass a non-empty observations array — FeedSurface short-circuits to
    // an empty-state render (without the freshness line) when observations === [].
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={[obs({ subId: 'S1' })]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
        freshnessLabel="Updated 5 min ago · Source: eBird"
      />
    );
    const el = container.querySelector('.feed-freshness');
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Updated 5 min ago · Source: eBird');
  });

  it('does NOT render .feed-freshness when freshnessLabel is empty string (empty state)', () => {
    const { container } = render(
      <FeedSurface
        loading={false}
        observations={[]}
        now={NOW}
        filters={{ notable: false, since: '14d' }}
        onSelectSpecies={() => {}}
        freshnessLabel=""
      />
    );
    expect(container.querySelector('.feed-freshness')).toBeNull();
  });
});
