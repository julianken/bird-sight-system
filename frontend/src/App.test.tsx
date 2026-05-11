import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Phase 4: useIsMobile calls window.matchMedia. JSDOM does not implement
// it — polyfill with a stub that returns non-mobile (desktop) by default
// so App renders SpeciesDetailModal rather than the sheet on view=detail.
// Using vi.stubGlobal so the mock persists across the test file and is
// properly restored after each test via vi.restoreAllMocks().
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Hoist mock fns so they exist before any module-level code runs.
const { mockGetHotspots, mockGetObservations, mockGetSilhouettes, mockUrlState } = vi.hoisted(() => ({
  mockGetHotspots: vi.fn(),
  mockGetObservations: vi.fn(),
  mockGetSilhouettes: vi.fn(),
  mockUrlState: {
    state: {
      since: '14d' as const,
      notable: false,
      speciesCode: null as string | null,
      familyCode: null as string | null,
      view: 'feed' as 'feed' | 'species' | 'map',
    },
    set: vi.fn(),
  },
}));

// Stub url-state before App imports it.
vi.mock('./state/url-state.js', () => ({
  useUrlState: () => mockUrlState,
  readMigrationFlag: () => false,
}));

// Stub MapSurface to avoid loading maplibre-gl in jsdom. Since issue #55's
// color-SOT wiring added a silhouettes fetch that runs concurrently with
// App's initial render, the 'map' view aria-busy test is now reliably hot
// enough to trigger MapSurface's maplibre import — which fails in jsdom
// because `window.URL.createObjectURL` isn't polyfilled. The test only
// cares about the `<main aria-busy>` attribute, not the map itself.
vi.mock('./components/MapSurface.js', () => ({
  MapSurface: () => null,
}));

// Stub the ApiClient constructor so useBirdData receives a controllable mock.
vi.mock('./api/client.js', async () => {
  const actual = await vi.importActual<typeof import('./api/client.js')>('./api/client.js');
  return {
    ...actual,
    ApiClient: class {
      getHotspots = mockGetHotspots;
      getObservations = mockGetObservations;
      getSilhouettes = mockGetSilhouettes;
    },
  };
});

import { App } from './App.js';
import { ApiError } from './api/client.js';
import { __resetSilhouettesCache } from './data/use-silhouettes.js';

describe('App error screen', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    mockGetHotspots.mockRejectedValue(new ApiError(503, 'pool exhausted'));
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a friendly message, not the raw error body', async () => {
    render(<App />);
    // Phase 6: error screen uses <StatusBlock state="error"> — title "Couldn't load bird data"
    // must be present; raw body "pool exhausted" must NOT appear.
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // Raw body must NOT appear in the DOM
    expect(screen.queryByText(/pool exhausted/)).toBeNull();
  });

  it('renders crafted copy, not raw error.message, for network errors', async () => {
    // Arrange: force a network-style error (non-ApiError).
    // getHotspots already rejects via beforeEach (ApiError 503); this test
    // also makes getObservations reject with a raw network error. Either
    // rejection triggers the error screen — the ApiError case is already
    // covered by the 'shows a friendly message' test above. This test
    // verifies the craftedFromError body for the network-error branch.
    mockGetObservations.mockRejectedValue(new Error('Failed to fetch: net::ERR_CONNECTION_REFUSED'));

    render(<App />);

    // Crafted title must appear (StatusBlock renders it)
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // Raw error.message must NOT appear
    expect(screen.queryByText(/net::ERR_CONNECTION_REFUSED/)).toBeNull();
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });

  it('renders a friendly body for a timeout error', async () => {
    mockGetObservations.mockRejectedValue(new Error('AbortError: signal timed out'));
    render(<App />);
    expect(await screen.findByText(/try refreshing/i)).toBeInTheDocument();
  });

  it('renders a generic friendly body for an unknown error', async () => {
    mockGetObservations.mockRejectedValue(new Error('some internal error code XYZ-42'));
    render(<App />);
    // Generic fallback must NOT expose the raw message
    await screen.findByRole('status');
    expect(screen.queryByText(/XYZ-42/)).toBeNull();
  });

  it('logs raw error details to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('API error 503: pool exhausted');
    });
    spy.mockRestore();
  });
});

describe('App aria-busy', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    // Successful loads so we get the normal UI (not error screen)
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets aria-busy=true on <main> when loading on feed view', () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    // getObservations returns a never-resolving promise to keep loading=true
    mockGetObservations.mockReturnValue(new Promise(() => {}));
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
  });

  it('does NOT set aria-busy=true on map view even while loading', () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
    };
    mockGetObservations.mockReturnValue(new Promise(() => {}));
    render(<App />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('false');
  });
});

describe('Phase 6: Footer removal + Attribution via AppHeader (issue #250 → Phase 6)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Phase 6: The persistent footer is removed. <AppHeader> carries the
  // Attribution trigger reachable from every view, meeting eBird ToU §3
  // and CC BY-SA §4(b/c). The footer's role="contentinfo" landmark is no
  // longer needed — banner + main are sufficient per ARIA spec.
  it.each(['feed', 'species', 'map', 'detail'] as const)(
    'no app-footer element on view=%s (footer removed in Phase 6)',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
      };
      const { container } = render(<App />);
      const footer = container.querySelector('footer.app-footer');
      expect(footer).toBeNull();
    },
  );

  it.each(['feed', 'species', 'map', 'detail'] as const)(
    'Attribution trigger is reachable from AppHeader on view=%s',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
      };
      render(<App />);
      await screen.findByRole('banner');
      // AppHeader carries the "Credits & attribution" button
      const trigger = screen.getByRole('button', { name: /Credits & attribution/i });
      expect(trigger).toBeInTheDocument();
    },
  );

  it('AttributionModal Credits button is still present in the DOM (trigger can find it)', () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    const { container } = render(<App />);
    // The modal's own trigger button — className="attribution-trigger"
    // onOpenAttribution's querySelector('.attribution-trigger') must resolve.
    const credits = container.querySelector('button.attribution-trigger');
    expect(credits).not.toBeNull();
  });
});

describe('Phase 3: AppHeader + Filters panel', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders <AppHeader> at the top of the app', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    render(<App />);
    // Wait for initial bird data fetch resolution
    await screen.findByRole('banner');
    expect(screen.getByRole('banner')).toHaveClass('app-header');
  });

  it('does NOT mount <SurfaceNav> directly anymore (its tablist is now inside <AppHeader>)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    render(<App />);
    await screen.findByRole('banner');
    // There should be exactly one tablist with aria-label "Surface" — the
    // one inside <AppHeader>. The legacy <SurfaceNav> mount is removed.
    const lists = screen.getAllByRole('tablist', { name: /Surface/i });
    expect(lists).toHaveLength(1);
    expect(lists[0].closest('header.app-header')).not.toBeNull();
  });

  it('Filters trigger opens a panel containing <FiltersBar>; closing hides it', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    // Closed initially: the FiltersBar region should not be in the DOM
    expect(screen.queryByRole('region', { name: /Filters/i })).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole('region', { name: /Filters/i })).toBeInTheDocument();
    // Close button inside the panel dismisses it
    await userEvent.click(screen.getByRole('button', { name: /Close filters/i }));
    expect(screen.queryByRole('region', { name: /Filters/i })).toBeNull();
  });

  it('Filters badge count reflects active filters (notable + family = 2)', async () => {
    // Seed URL with active filters before mount
    mockUrlState.state = {
      since: '14d', notable: true, speciesCode: null, familyCode: 'corvidae', view: 'feed',
    };
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters \(2 active\)/i });
    expect(trigger).toBeInTheDocument();
  });
});

describe('Phase 5: FeedSurface lede wiring (App → FeedSurface)', () => {
  const SPECIES_OBS = {
    subId: 'S1',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: new Date().toISOString(),
    locId: 'L1',
    locName: 'Sabino Canyon',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: 'songbird',
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Priority 1 default lede fires when no species/family filter is set', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    mockGetObservations.mockResolvedValue({ data: [SPECIES_OBS], meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() } });
    render(<App />);
    await screen.findByText(/species seen across Arizona/i);
    expect(screen.queryByText(/sightings of/i)).toBeNull();
    expect(screen.queryByText(/species of Songbird/i)).toBeNull();
  });

  it('Priority 2 lede fires (species name in lede) when speciesCode filter is active', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: 'vermfly', familyCode: null, view: 'feed',
    };
    mockGetObservations.mockResolvedValue({ data: [SPECIES_OBS], meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() } });
    render(<App />);
    // Priority 2: "{N} sightings of {name} in Arizona in the last {period}."
    // Regex anchors the period token ("14 days") to catch PERIOD_LABELS
    // regressions that produce "in the last Last 14 days." or similar.
    await screen.findByText(/sightings of Vermilion Flycatcher in Arizona in the last 14 days\./i);
  });

  it('Priority 3 lede fires (family name in lede) when familyCode filter is active (no speciesCode)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: 'songbird', view: 'feed',
    };
    mockGetObservations.mockResolvedValue({ data: [SPECIES_OBS], meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() } });
    render(<App />);
    // Priority 3: "{N} species of {family} seen across Arizona…"
    await screen.findByText(/species of Songbird seen across Arizona/i);
  });
});

describe('Phase 5: FeedSurface cross-surface FilterSentence drift regression', () => {
  // Regression for PR #429 finding: FeedSurface activeFilters memo hard-coded
  // speciesCode/familyCode as null, causing the lede to name the species but
  // the sibling FilterSentence to omit it. Both must reflect the same URL state.
  const SPECIES_OBS = {
    subId: 'S1',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: new Date().toISOString(),
    locId: 'L1',
    locName: 'Sabino Canyon',
    howMany: 1,
    isNotable: false,
    regionId: null,
    silhouetteId: null,
    familyCode: 'songbird',
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with species filter active on feed view, both lede AND FilterSentence mention the species', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: 'vermfly', familyCode: null, view: 'feed',
    };
    mockGetObservations.mockResolvedValue({ data: [SPECIES_OBS], meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() } });
    const { container } = render(<App />);
    // Lede must resolve the species name from the speciesIndex and include it.
    await screen.findByText(/sightings of Vermilion Flycatcher in Arizona in the last 14 days\./i);
    // FilterSentence visible sentence must reflect the species — either the
    // resolved common name (when speciesName is threaded from App) or the raw
    // code as a fallback. The key invariant is that the element is rendered
    // (non-null) and contains either the resolved name or the raw code.
    const filterSentenceVisible = container.querySelector('.filter-sentence__visible');
    expect(filterSentenceVisible).not.toBeNull();
    expect(filterSentenceVisible?.textContent).toMatch(/vermilion flycatcher|vermfly/i);
  });
});

describe('Phase 5: SpeciesSearchSurface activeFilters wiring (App → SpeciesSearchSurface)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders FilterSentence live region on the species surface', async () => {
    // FilterSentence always mounts an aria-live="polite" region regardless
    // of filter state — verify it is present when view=species.
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'species',
    };
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
  });

  it('FilterSentence visible sentence surfaces active filters on the species surface', async () => {
    // With notable=true, FilterSentence renders a visible .filter-sentence__visible
    // paragraph (synchronous — no debounce on the visible element, only the live
    // region). This confirms activeFilters is actually wired through from App.
    mockUrlState.state = {
      since: '14d', notable: true, speciesCode: null, familyCode: null, view: 'species',
    };
    render(<App />);
    await screen.findByRole('banner');
    // The visible paragraph is synchronously rendered when filters are active.
    const visible = document.querySelector('.filter-sentence__visible');
    expect(visible).not.toBeNull();
    expect(visible?.textContent?.toLowerCase()).toMatch(/notable/);
  });

  it('FilterSentence visible sentence renders on the species surface when speciesCode is set without notable', async () => {
    // Regression: view=species with speciesCode='annhum' (and notable=false)
    // must render .filter-sentence__visible. buildFilterTerms pushes speciesCode
    // when truthy — so the sentence should NOT collapse to null.
    // Prior to fix, this path was untested and a mount regression left the
    // visible element absent on the species surface (closes #442).
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: 'annhum', familyCode: null, view: 'species',
    };
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const visible = container.querySelector('.filter-sentence__visible');
    expect(visible).not.toBeNull();
    expect(visible?.textContent).toMatch(/annhum/i);
  });
});
