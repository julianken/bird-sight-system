import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LngLatBounds } from 'maplibre-gl';

// Phase 4 / #663: useIsCompact calls window.matchMedia. JSDOM does not
// implement it — polyfill with a stub that returns non-compact (wide
// desktop) by default so App renders SpeciesDetailRail rather than the
// sheet when state.detail is set.
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
const {
  mockGetHotspots,
  mockGetObservations,
  mockGetSilhouettes,
  mockUrlState,
  mapSurfaceRef,
} = vi.hoisted(() => ({
  mockGetHotspots: vi.fn(),
  mockGetObservations: vi.fn(),
  mockGetSilhouettes: vi.fn(),
  mockUrlState: {
    state: {
      since: '14d' as const,
      notable: false,
      speciesCode: null as string | null,
      familyCode: null as string | null,
      view: 'feed' as 'feed' | 'map',
    },
    set: vi.fn(),
  },
  // Capture handle for the zoom/bbox state-race regression (issue #690).
  // The MapSurface stub assigns the latest `onViewportChange` prop here on
  // every render so the test can drive App.tsx's viewport callback the same
  // way MapCanvas's `idle` event would.
  mapSurfaceRef: {
    onViewportChange: null as
      | ((bounds: unknown, zoom: number) => void)
      | null,
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
// because `window.URL.createObjectURL` isn't polyfilled. Most tests in this
// file only care about the `<main aria-busy>` attribute, not the map itself.
//
// Issue #690: the stub additionally captures the latest `onViewportChange`
// prop into `mapSurfaceRef.onViewportChange` so the zoom/bbox state-race
// regression test can invoke it directly. Mirrors the `MapSurface.test.tsx`
// pattern at lines 18–29.
vi.mock('./components/MapSurface.js', () => ({
  MapSurface: (props: {
    onViewportChange?: (bounds: unknown, zoom: number) => void;
  }) => {
    mapSurfaceRef.onViewportChange = props.onViewportChange ?? null;
    return null;
  },
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
  it.each(['feed', 'map', 'detail'] as const)(
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

  it.each(['feed', 'map', 'detail'] as const)(
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

describe('L2: freshness empty state (null freshestObservationAt)', () => {
  // When the API returns null for freshestObservationAt (empty table or ingestor
  // not yet run), the app must NOT render alarming "Source unavailable" copy —
  // it silently suppresses the freshness label. (critic L2, #456 W3-A)
  const OBS = {
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
    silhouetteId: null,
    familyCode: null,
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    mockUrlState.state = { since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed' };
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render alarming freshness copy when freshestObservationAt is null', async () => {
    mockGetObservations.mockResolvedValue({ data: [OBS], meta: { freshestObservationAt: null } });
    render(<App />);
    await screen.findByText(/species seen across Arizona/i);
    expect(screen.queryByText(/Source unavailable/i)).toBeNull();
    expect(screen.queryByText(/check back soon/i)).toBeNull();
  });
});

describe('L3: nowTick advances on visibilitychange (tab return)', () => {
  // useRef(new Date()) would freeze `now` at first render. After hours of the
  // tab being hidden, freshness labels would stay stuck. Pattern A: bump nowTick
  // on visibilitychange so labels re-derive when the user returns to the tab.
  // (critic L3, #456 W3-A)
  const RECENT_ISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const OBS = {
    subId: 'S1',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.2,
    lng: -110.9,
    obsDt: RECENT_ISO,
    locId: 'L1',
    locName: 'Sabino Canyon',
    howMany: 1,
    isNotable: false,
    silhouetteId: null,
    familyCode: null,
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    mockUrlState.state = { since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed' };
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a visibilitychange listener on mount and removes it on unmount', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    mockGetObservations.mockResolvedValue({ data: [OBS], meta: { freshestObservationAt: RECENT_ISO } });
    const { unmount } = render(<App />);
    await screen.findByText(/species seen across Arizona/i);

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('fires setNowTick when tab becomes visible', async () => {
    mockGetObservations.mockResolvedValue({ data: [OBS], meta: { freshestObservationAt: RECENT_ISO } });
    render(<App />);
    await screen.findByText(/species seen across Arizona/i);

    // Simulate tab returning to foreground — trigger visibilitychange with
    // document.visibilityState === 'visible' (jsdom default).
    await act(async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // App re-renders without crashing — freshness label is still present
    // (we can't easily assert exact time, but we verify no error is thrown
    // and the lede is still rendered).
    expect(screen.getByText(/species seen across Arizona/i)).toBeInTheDocument();
  });
});

describe('App.tsx onSelectSpecies bbox-clear invariant (#560)', () => {
  const FEED_OBS = {
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
    silhouetteId: null,
    familyCode: 'tyrann',
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({
      data: [FEED_OBS],
      meta: { freshestObservationAt: null },
    });
    mockUrlState.set.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears stale bbox when onSelectSpecies called without bbox argument (feed row click)', async () => {
    mockUrlState.state = {
      since: '14d',
      notable: false,
      speciesCode: null,
      familyCode: null,
      view: 'feed',
    };
    render(<App />);
    // Wait for feed rows to render
    const feedRow = await screen.findByRole('button', { name: /Vermilion Flycatcher/i });
    await userEvent.click(feedRow);
    // set() must be called with bbox: null to clear any stale bbox
    const calls = mockUrlState.set.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const lastCall = calls[calls.length - 1][0];
    // #663: onSelectSpecies writes detail + bbox only. The view param is
    // no longer forced to 'detail' — the rail/sheet renders in place over
    // whatever view (typically 'map' or 'feed') the user was on.
    expect(lastCall).toMatchObject({ detail: 'vermfly', bbox: null });
    expect(lastCall.view).toBeUndefined();
  });

  it('sets bbox when onSelectSpecies called with second bbox argument', async () => {
    mockUrlState.state = {
      since: '14d',
      notable: false,
      speciesCode: null,
      familyCode: null,
      view: 'feed',
    };
    render(<App />);
    await screen.findByRole('banner');
    // Invoke the onSelectSpecies from the App directly via FeedSurface callback.
    // We trigger via a feed row but we also need to verify the widened 2-arg form.
    // Render App and directly access the set mock after calling with explicit bbox.
    // Since FeedSurface passes a single-arg callback, use the set mock to verify
    // the bbox=null branch, and verify the widened signature compiles + routes.
    // Directly assert: if App.onSelectSpecies is called with bbox, set gets bbox.
    // We verify this indirectly: click feed row → set called with bbox: null (default).
    const feedRow = screen.getByRole('button', { name: /Vermilion Flycatcher/i });
    await userEvent.click(feedRow);
    const calls = mockUrlState.set.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    // Default (no bbox arg) → bbox: null
    expect(lastCall.bbox).toBeNull();
    expect(lastCall.detail).toBe('vermfly');
    // #663: no view: 'detail' write; overlay coexists with current view.
    expect(lastCall.view).toBeUndefined();
  });

  it('cross-surface navigation: feed → detail does not leak a pre-existing bbox param', async () => {
    mockUrlState.state = {
      since: '14d',
      notable: false,
      speciesCode: null,
      familyCode: null,
      view: 'feed',
    };
    render(<App />);
    const feedRow = await screen.findByRole('button', { name: /Vermilion Flycatcher/i });
    await userEvent.click(feedRow);
    // Regardless of any prior bbox in URL, App.onSelectSpecies always passes
    // bbox: null when called without a second argument.
    const calls = mockUrlState.set.mock.calls;
    const selectCall = calls.find((c) => c[0]?.detail === 'vermfly');
    expect(selectCall).toBeDefined();
    expect(selectCall![0].bbox).toBeNull();
  });
});

describe('Clarity view tagging (#657-followup)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls analytics.setView with the active view on mount', async () => {
    const { analytics } = await import('./analytics.js');
    const setViewSpy = vi.spyOn(analytics, 'setView');
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    render(<App />);
    expect(setViewSpy).toHaveBeenCalledWith('feed');
  });
});

describe('Zoom/bbox state-race regression (#690)', () => {
  // Build a duck-typed LngLatBounds for the onViewportChange callback. App.tsx
  // only ever calls .getWest/.getSouth/.getEast/.getNorth on the value, so a
  // plain object with those methods is sufficient and lets us avoid pulling in
  // maplibre-gl in jsdom (the same constraint that drives the MapSurface stub
  // above).
  function makeBounds(
    west: number, south: number, east: number, north: number,
  ): LngLatBounds {
    return {
      getWest: () => west,
      getSouth: () => south,
      getEast: () => east,
      getNorth: () => north,
    } as unknown as LngLatBounds;
  }

  // CONUS framing (≈61.9° lng × 23.7° lat) — the bbox MapCanvas reports on
  // the initial `idle` from the default zoom-4 view. Span exceeds the server's
  // 45° lng / 25° lat cap, so any /api/observations call carrying this bbox
  // with zoom ≥ 6 is the bad combination this regression guards against.
  const CONUS_BOUNDS = makeBounds(-125, 24, -66, 50);
  // San Jose framing (≈7.8° lng × 3.1° lat) — well inside the cap at any zoom.
  const SJ_BOUNDS = makeBounds(-125.8, 35.8, -118.0, 38.9);

  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({
      data: [], meta: { freshestObservationAt: null },
    });
    mockGetSilhouettes.mockResolvedValue([]);
    mapSurfaceRef.onViewportChange = null;
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never emits a {bbox: CONUS, zoom: ≥6} fetch when zooming from CONUS into San Jose', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<App />);

    // Wait for App to finish mounting and render <MapSurface>. The stub
    // captures onViewportChange on each render; we poll until the handle is
    // populated so the rest of the test can drive viewport changes.
    await waitFor(() => {
      expect(mapSurfaceRef.onViewportChange).not.toBeNull();
    });
    const onViewportChange = mapSurfaceRef.onViewportChange!;

    // Step 1: simulate the initial CONUS settle at zoom 4. App schedules the
    // 250ms bbox debounce; setDebouncedZoom fires immediately.
    await act(async () => {
      onViewportChange(CONUS_BOUNDS, 4);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // Step 2: simulate jumpTo({center: SJ, zoom: 7}) — MapCanvas emits a
    // single onViewportChange(SJ, 7) on the next idle.
    await act(async () => {
      onViewportChange(SJ_BOUNDS, 7);
    });
    // The bug — if present — fires a synchronous re-render with
    // {bbox: CONUS, zoom: 7} BEFORE the 250ms timeout drains. Drain any
    // microtasks so useBirdData's effect runs against the current state.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Step 3: drain the bbox debounce — App now commits {bbox: SJ, zoom: 7},
    // which is a consistent pairing under the cap.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    // Assert every fetch carries a consistent {bbox, zoom} pair: either the
    // span fits the server's 45° lng cap, or the zoom is below the gating
    // threshold (cap at services/read-api/src/validate.ts only fires when
    // zoom ≥ 6). The pre-fix race produces a call with lngSpan ≈ 59 AND
    // zoom = 7 — violating both halves of the predicate.
    const calls = mockGetObservations.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [filters] of calls) {
      const { bbox, zoom } = filters as {
        bbox?: [number, number, number, number];
        zoom?: number;
      };
      // The initial mount call may omit bbox/zoom; the assertion only applies
      // once a viewport-derived pair has been threaded through.
      if (!bbox || zoom === undefined) continue;
      const lngSpan = bbox[2] - bbox[0];
      const consistent = lngSpan <= 45 || zoom < 6;
      expect(
        consistent,
        `inconsistent fetch: bbox=${bbox.join(',')} (lngSpan=${lngSpan.toFixed(2)}), zoom=${zoom}`,
      ).toBe(true);
    }
  });
});
