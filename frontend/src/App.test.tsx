import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LngLatBounds } from 'maplibre-gl';
import type React from 'react';

// Phase 4 / #663: useIsCompact (and, since F2 #1062, useBreakpoint — which now
// backs the phone-scoped `isPhone` signal) call window.matchMedia. JSDOM does
// not implement it — polyfill with a stub that returns non-compact (wide
// desktop) by default so App renders SpeciesDetailRail rather than the
// sheet when state.detail is set, and so `isPhone` reads false.
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

// #830 item D: AttributionModal is controlled-open and calls dialog.showModal()
// / dialog.close(). jsdom predates the top-layer dialog spec, so patch the
// prototype to mirror open/close (set/remove the `open` attribute, dispatch the
// native close event) — same polyfill the AttributionModal unit test uses.
(() => {
  if (typeof HTMLDialogElement === 'undefined') return;
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
    __patched?: boolean;
  };
  if ((proto.showModal as unknown as { __patched?: boolean } | undefined)?.__patched) return;
  const showModal = function (this: HTMLDialogElement) {
    (this as unknown as { open: boolean }).open = true;
    this.setAttribute('open', '');
  };
  const close = function (this: HTMLDialogElement) {
    (this as unknown as { open: boolean }).open = false;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  Object.defineProperty(showModal, '__patched', { value: true });
  proto.showModal = showModal as () => void;
  proto.close = close as () => void;
})();

// Hoist mock fns so they exist before any module-level code runs.
const {
  mockGetHotspots,
  mockGetObservations,
  mockGetSilhouettes,
  mockGetStates,
  mockGetSpeciesDictionary,
  mockUrlState,
  mapSurfaceRef,
  mockPrefetchMapCanvas,
  overlayRenderCounts,
} = vi.hoisted(() => ({
  mockGetHotspots: vi.fn(),
  mockGetObservations: vi.fn(),
  mockGetSilhouettes: vi.fn(),
  // #1175: controllable species dictionary so the lede suite can SEED it and
  // assert the aggregated-mode species qualifier resolves from the dictionary
  // (a cold dictionary would silently assert the fallback, not the fix).
  mockGetSpeciesDictionary: vi.fn(),
  // O9 (#781): spy on the scope-gated MapCanvas chunk prefetch. App must call
  // it on a scoped landing + each scope-pick, and NEVER on the unscoped
  // chooser landing (the #740/C6 fetch-light landing guarantee).
  mockPrefetchMapCanvas: vi.fn(),
  // #740 (C6): App now fetches /api/states for the scope chooser/control
  // `<select>` and the state-scope camera envelope. Every test stubs it.
  mockGetStates: vi.fn(),
  mockUrlState: {
    state: {
      since: '14d' as const,
      notable: false,
      speciesCode: null as string | null,
      familyCode: null as string | null,
      view: 'map' as 'map' | 'detail',
      // #735/#738: scope drives the runtime region label. `us` resolves to
      // "USA" with no /api/states table needed, so the region-label wiring
      // tests assert a deterministic region without inventing a states
      // fetch (owned by #740). Per-test overrides set scope explicitly.
      scope: { kind: 'us' as const } as
        | { kind: 'unscoped' }
        | { kind: 'us' }
        | { kind: 'state'; stateCode: string },
    },
    set: vi.fn(),
  },
  // Capture handle for the zoom/bbox state-race regression (issue #690) AND the
  // #740 scope-camera assertions. The MapSurface stub assigns the latest
  // `onViewportChange` prop + the scope camera props here on every render so
  // tests can drive App.tsx's viewport callback (the way MapCanvas's `idle`
  // event would) and assert the framed bounds/flyTo.
  mapSurfaceRef: {
    onViewportChange: null as
      | ((bounds: unknown, zoom: number) => void)
      | null,
    // #777: App threads its `onSelectSpecies` down to MapSurface (the
    // species-commit path that used to be a feed-row click). The stub captures
    // it so tests can invoke App's callback directly, the way a real map
    // marker / popover click would.
    onSelectSpecies: null as
      | ((speciesCode: string) => void)
      | null,
    boundsKey: undefined as string | undefined,
    scopeBounds: undefined as [[number, number], [number, number]] | undefined,
    flyTo: undefined as
      | { center: [number, number]; zoom: number; key: string }
      | undefined,
    renderCount: 0,
  },
  // O8 (#784): render-count tracking for the two memoized App-root overlays.
  // Incremented by the counting wrappers in vi.mock below; asserted in the O8 suite.
  overlayRenderCounts: {
    familyLegend: 0,
    scopeControl: 0,
  },
}));

// Global default for the species dictionary: empty (the prior class-field
// default). vi.restoreAllMocks() does NOT reset a plain vi.fn(), so this persists
// across suites; only tests that explicitly seed it (the #1175 lede case) differ.
mockGetSpeciesDictionary.mockResolvedValue([]);

// Stub url-state before App imports it. #738: App now imports the exported
// DEFAULTS to compute `noFiltersActive` (`since === DEFAULTS.since`), so the
// mock must expose it. Only `since` is read by App; mirror the real default.
vi.mock('./state/url-state.js', () => ({
  useUrlState: () => mockUrlState,
  readMigrationFlag: () => false,
  DEFAULTS: {
    speciesCode: null,
    familyCode: null,
    since: '14d',
    notable: false,
    view: 'map',
    detail: null,
    scope: { kind: 'unscoped' },
  },
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
    onSelectSpecies?: (speciesCode: string) => void;
    boundsKey?: string;
    scopeBounds?: [[number, number], [number, number]];
    flyTo?: { center: [number, number]; zoom: number; key: string };
  }) => {
    mapSurfaceRef.onViewportChange = props.onViewportChange ?? null;
    mapSurfaceRef.onSelectSpecies = props.onSelectSpecies ?? null;
    mapSurfaceRef.boundsKey = props.boundsKey;
    mapSurfaceRef.scopeBounds = props.scopeBounds;
    mapSurfaceRef.flyTo = props.flyTo;
    mapSurfaceRef.renderCount += 1;
    return <div data-testid="map-surface-stub" />;
  },
}));

// O9 (#781): stub the prefetch module so the scope-gated warm-up is observable
// (and a strict no-op) under jsdom. App imports `prefetchMapCanvas` from
// './prefetch.js'; tests assert WHEN it is and is not called.
vi.mock('./prefetch.js', () => ({
  prefetchMapCanvas: mockPrefetchMapCanvas,
}));

// O8 (#784): render-counting mocks for FamilyLegend + ScopeControl.
//
// TWO-LAYER LOAD-BEARING DESIGN:
//
// Layer 1 — structural guard ($$typeof check): the mock verifies at
//   initialization time that the production export IS a React.memo component
//   (via `$$typeof === Symbol.for('react.memo')`). If memo is removed from
//   production, the mock substitutes a component that throws during render,
//   making ALL tests in this file fail with a clear message. This is what
//   makes the mutation test (remove production memo → tests fail) work.
//
// Layer 2 — behavioral counter (render body count): the mock wraps the inner
//   implementation (FamilyLegendImpl / ScopeControlImpl, accessed via .type)
//   with a counting function, then re-applies React.memo around it. The counter
//   only runs when OUR memo allows the render through — i.e., when props are
//   NOT shallowly equal. The O8 suite asserts that counter=0 after a nowTick
//   bump (which doesn't change these components' props). If OUR memo were
//   removed, the counter would increment on every App re-render, failing the test.
//
// Why not Profiler? React.Profiler fires onRender whenever the Profiler node
//   itself commits (even when a memo'd child bails), making it unsuitable for
//   detecting memo bailouts in this test environment (React 18.3.1 / jsdom /
//   vitest). Confirmed empirically: Profiler phase='update' fires with delta=1
//   on a parent force-update even when the memo'd child produces zero actual
//   render work (actualDuration > 0 despite memo bail).
vi.mock('./components/FamilyLegend.js', async () => {
  const real = await vi.importActual<typeof import('./components/FamilyLegend.js')>('./components/FamilyLegend.js');
  const { memo, createElement } = await import('react');

  // Layer 1: structural guard — fail loudly if production memo is removed.
  const REACT_MEMO_TYPE = Symbol.for('react.memo');
  if ((real.FamilyLegend as unknown as { $$typeof?: symbol }).$$typeof !== REACT_MEMO_TYPE) {
    // Production memo was removed (O8 regression). Substitute a component that
    // throws during render so ALL O8 tests fail with a diagnostic message.
    const O8RegressionGuard = function FamilyLegendO8Broken() {
      throw new Error(
        'O8 REGRESSION DETECTED: FamilyLegend production React.memo was removed. ' +
        'Restore `export const FamilyLegend = memo(FamilyLegendImpl)` in FamilyLegend.tsx',
      );
    };
    return { ...real, FamilyLegend: O8RegressionGuard };
  }

  // Layer 2: behavioral counter — wrap inner impl, re-apply memo.
  // The counter fires only when OUR memo allows the render through.
  // .type is the inner FamilyLegendImpl function on a React.memo component.
  const innerImpl = (real.FamilyLegend as unknown as { type: (props: Parameters<typeof real.FamilyLegend>[0]) => React.JSX.Element }).type;
  const WrappedFamilyLegend = memo(function FamilyLegendCounting(props: Parameters<typeof real.FamilyLegend>[0]) {
    overlayRenderCounts.familyLegend += 1;
    return createElement(innerImpl as React.ComponentType<typeof props>, props);
  });
  WrappedFamilyLegend.displayName = 'FamilyLegend';
  return { ...real, FamilyLegend: WrappedFamilyLegend };
});

vi.mock('./components/ScopeControl.js', async () => {
  const real = await vi.importActual<typeof import('./components/ScopeControl.js')>('./components/ScopeControl.js');
  const { memo, createElement } = await import('react');

  // Layer 1: structural guard.
  const REACT_MEMO_TYPE = Symbol.for('react.memo');
  if ((real.ScopeControl as unknown as { $$typeof?: symbol }).$$typeof !== REACT_MEMO_TYPE) {
    const O8RegressionGuard = function ScopeControlO8Broken() {
      throw new Error(
        'O8 REGRESSION DETECTED: ScopeControl production React.memo was removed. ' +
        'Restore `export const ScopeControl = React.memo(ScopeControlImpl)` in ScopeControl.tsx',
      );
    };
    return { ...real, ScopeControl: O8RegressionGuard };
  }

  // Layer 2: behavioral counter.
  const innerImpl = (real.ScopeControl as unknown as { type: (props: Parameters<typeof real.ScopeControl>[0]) => React.JSX.Element }).type;
  const WrappedScopeControl = memo(function ScopeControlCounting(props: Parameters<typeof real.ScopeControl>[0]) {
    overlayRenderCounts.scopeControl += 1;
    return createElement(innerImpl as React.ComponentType<typeof props>, props);
  });
  WrappedScopeControl.displayName = 'ScopeControl';
  return { ...real, ScopeControl: WrappedScopeControl };
});

// Stub the ApiClient constructor so useBirdData / useStates receive a
// controllable mock.
vi.mock('./api/client.js', async () => {
  const actual = await vi.importActual<typeof import('./api/client.js')>('./api/client.js');
  return {
    ...actual,
    ApiClient: class {
      getHotspots = mockGetHotspots;
      getObservations = mockGetObservations;
      getSilhouettes = mockGetSilhouettes;
      getStates = mockGetStates;
      // #740 test: the C6 "detail is not a scope" case sets state.detail, which
      // mounts useSpeciesDetail → client.getSpecies. Stub it (resolves a minimal
      // SpeciesMeta) so the hook doesn't throw; the chooser-precedence assertion
      // doesn't depend on the species payload.
      getSpecies = vi.fn().mockResolvedValue({
        speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', sciName: 'Pyrocephalus rubinus',
      });
      // #859/#1175: App mounts useSpeciesDictionary → client.getSpeciesDictionary.
      // Routed through the hoisted mock (default []) so the lede suite can seed it
      // to assert the aggregated-mode species qualifier (#1175).
      getSpeciesDictionary = mockGetSpeciesDictionary;
      // #species: App mounts useSpeciesInScope → client.getSpeciesInScope to
      // source the FiltersBar combobox. Stub it (empty represented set) so the
      // hook doesn't throw; these scope/legend/lede tests don't assert on the
      // species combobox contents.
      getSpeciesInScope = vi.fn().mockResolvedValue([]);
    },
  };
});

import { App } from './App.js';
import { ApiError } from './api/client.js';
import { __resetSilhouettesCache } from './data/use-silhouettes.js';
import { __resetSpeciesDictionaryCache } from './data/use-species-dictionary.js';
import { __resetStatesCache } from './data/use-states.js';
import { __resetZipIndexCache } from './data/zip-lookup.js';

describe('App error screen', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    mockGetHotspots.mockRejectedValue(new ApiError(503, 'pool exhausted'));
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // O7 (#786): error is now a floating overlay, NOT a full-tree early-return.
  // The map shell STAYS mounted during a scoped data-fetch failure.

  it('shows a friendly message, not the raw error body', async () => {
    render(<App />);
    // O7: error overlay renders over the live map; title must still appear.
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // Raw body must NOT appear in the DOM
    expect(screen.queryByText(/pool exhausted/)).toBeNull();
  });

  it('O7: map shell stays mounted during a scoped error (no full-tree unmount)', async () => {
    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // The .app shell, AppHeader, and #map-layer must still be in the DOM
    expect(container.querySelector('.app')).not.toBeNull();
    expect(container.querySelector('header.app-header')).not.toBeNull();
    expect(container.querySelector('#map-layer')).not.toBeNull();
    // The map surface stub (MapSurface) is still rendered
    expect(container.querySelector('[data-testid="map-surface-stub"]')).not.toBeNull();
  });

  it('O7: error overlay has Retry and Dismiss controls', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // Retry button (StatusBlock action prop)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // Dismiss button
    expect(screen.getByRole('button', { name: 'Dismiss error' })).toBeInTheDocument();
  });

  it('O7: Dismiss hides the overlay and leaves the map mounted', async () => {
    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });
    // Dismiss the overlay
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss error' });
    await act(async () => { dismissBtn.click(); });
    // Overlay is gone
    expect(screen.queryByText("Couldn't load bird data")).toBeNull();
    // Map is still mounted
    expect(container.querySelector('#map-layer')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-surface-stub"]')).not.toBeNull();
  });

  it('O7: Retry calls refetch (re-fires the fetch without remounting MapSurface)', async () => {
    // Make the initial call fail, then succeed on the second call
    mockGetHotspots
      .mockRejectedValueOnce(new ApiError(503, 'pool exhausted'))
      .mockResolvedValue([]);
    mockGetObservations
      .mockRejectedValueOnce(new Error('initial fail'))
      .mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });

    const initialRenderCount = mapSurfaceRef.renderCount;
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    });

    // Record render count at error time — MapSurface must NOT remount on Retry
    const renderCountAtError = mapSurfaceRef.renderCount;
    expect(renderCountAtError).toBeGreaterThan(initialRenderCount);

    // Click Retry
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    await act(async () => { retryBtn.click(); });

    // After successful retry, the overlay should be gone
    await waitFor(() => {
      expect(screen.queryByText("Couldn't load bird data")).toBeNull();
    });

    // MapSurface renderCount may have increased (re-renders are fine) but
    // the key contract is that the map-surface-stub element is still the SAME
    // instance (not remounted). Since jsdom doesn't track instance identity,
    // we assert that render count is still reasonable (not reset to 0).
    expect(mapSurfaceRef.renderCount).toBeGreaterThan(0);
  });

  it('renders crafted copy, not raw error.message, for network errors', async () => {
    // Arrange: force a network-style error (non-ApiError).
    // getHotspots already rejects via beforeEach (ApiError 503); this test
    // also makes getObservations reject with a raw network error. Either
    // rejection triggers the error overlay — the ApiError case is already
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
    // Generic fallback must NOT expose the raw message.
    // O7: wait for the error overlay to appear (title text)
    await screen.findByText("Couldn't load bird data");
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

  it('O7: error overlay does NOT render while unscoped (chooser scrim takes precedence)', async () => {
    // Error on chooser landing — overlay must stay suppressed (scopeActive = false).
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'unscoped' as const },
    };
    render(<App />);
    // The error would have fired (hotspots rejects in beforeEach) but
    // scopeActive = false so the overlay must NOT appear.
    // Give the hook time to potentially surface an error
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByTestId('error-overlay')).toBeNull();
  });
});

describe('App aria-busy', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    // Successful loads so we get the normal UI (not error screen)
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // O1 (#776): aria-busy re-homed from <main> to #map-layer.
  it('sets aria-busy=true on #map-layer (not <main>) while observations are loading', () => {
    // O1 re-homes aria-busy from <main id="main-surface"> to #map-layer so
    // assistive tech announces "busy" against the region that is actually
    // changing (the map block), not the near-empty <main> shell.
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    // getObservations returns a never-resolving promise to keep loading=true
    mockGetObservations.mockReturnValue(new Promise(() => {}));
    const { container } = render(<App />);
    // Map root carries aria-busy=true while loading.
    expect(container.querySelector('#map-layer')?.getAttribute('aria-busy')).toBe('true');
    // Single-busy-node invariant: <main id="main-surface"> carries NO aria-busy.
    expect(screen.getByRole('main').hasAttribute('aria-busy')).toBe(false);
  });

  it('clears aria-busy on #map-layer once observations have loaded', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector('#map-layer')?.getAttribute('aria-busy')).toBe('false');
    });
    // Invariant: <main> still has no aria-busy after settle.
    expect(screen.getByRole('main').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Phase 6: Footer removal + Attribution via AppHeader (issue #250 → Phase 6)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
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
  it.each(['map', 'detail'] as const)(
    'no app-footer element on view=%s (footer removed in Phase 6)',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
        scope: { kind: 'us' as const },
      };
      const { container } = render(<App />);
      const footer = container.querySelector('footer.app-footer');
      expect(footer).toBeNull();
    },
  );

  it.each(['map', 'detail'] as const)(
    'Attribution trigger is reachable from AppHeader on view=%s',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
        scope: { kind: 'us' as const },
      };
      render(<App />);
      await screen.findByRole('banner');
      // AppHeader carries the "Credits" button
      const trigger = screen.getByRole('button', { name: /Credits/i });
      expect(trigger).toBeInTheDocument();
    },
  );

  it('clicking the AppHeader ⓘ button opens the AttributionModal (controlled-open, #830 item D)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    await screen.findByRole('banner');
    const dialog = document.querySelector('dialog.attribution-modal');
    expect(dialog).not.toBeNull();
    // Closed initially (open prop is false).
    expect(dialog?.hasAttribute('open')).toBe(false);
    // onOpenAttribution sets attributionOpen → the modal's open prop opens the
    // native dialog. (No leftover .attribution-trigger shim — it was deleted.)
    expect(document.querySelector('.attribution-trigger')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Credits/i }));
    expect(dialog?.hasAttribute('open')).toBe(true);
  });

  // #828 Option-A rebase over #830: #828 deletes the identity-card freshness
  // line that #830 had hosted the always-visible eBird credit in, so the
  // license-floor credit is restored to the bottom-right .map-attribution corner
  // (four-corner contract §4.8). This is the always-visible eBird-ToU-§3 anchor;
  // the full credits stay in the top-right ⓘ modal (tested above). Assert the
  // eBird link is present (licensing) AND that no in-card freshness line
  // resurfaced.
  it.each(['map', 'detail'] as const)(
    'renders the always-visible bottom-right eBird + OpenFreeMap attribution on view=%s',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
        scope: { kind: 'us' as const },
      };
      render(<App />);
      await screen.findByRole('banner');
      const attribution = document.querySelector('.map-attribution');
      expect(attribution).not.toBeNull();
      const ebird = within(attribution as HTMLElement).getByRole('link', { name: 'eBird' });
      expect(ebird).toHaveAttribute('href', 'https://ebird.org');
      expect(ebird).toHaveAttribute('rel', 'noopener noreferrer');
      expect(ebird).toHaveAttribute('target', '_blank');
      const ofm = within(attribution as HTMLElement).getByRole('link', { name: 'OpenFreeMap' });
      expect(ofm).toHaveAttribute('href', 'https://openfreemap.org');
      // The in-card freshness line stays gone (Option A relocated, not restored).
      expect(document.querySelector('.app-header-freshness')).toBeNull();
    },
  );

  it('does NOT render the bottom-right attribution on the unscoped landing', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'unscoped' as const },
    };
    render(<App />);
    await screen.findByRole('banner');
    // Unscoped → no map data shown → no always-visible data credit (the chooser
    // scrim owns the unscoped landing; eBird credit appears once a scope resolves).
    expect(document.querySelector('.map-attribution')).toBeNull();
  });
});

describe('Phase 3: AppHeader + Filters panel', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders <AppHeader> at the top of the app', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    // Wait for initial bird data fetch resolution
    await screen.findByRole('banner');
    expect(screen.getByRole('banner')).toHaveClass('app-header');
  });

  it('Filters trigger opens a panel containing <FiltersBar>; closing hides it', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    // Closed initially: the FiltersBar region should not be in the DOM
    expect(screen.queryByRole('dialog', { name: /Filters/i })).toBeNull();
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /Filters/i })).toBeInTheDocument();
    // Close button inside the panel dismisses it
    await userEvent.click(screen.getByRole('button', { name: /Close filters/i }));
    expect(screen.queryByRole('dialog', { name: /Filters/i })).toBeNull();
  });

  it('Filters badge count reflects active filters (notable + family = 2)', async () => {
    // Seed URL with active filters before mount
    mockUrlState.state = {
      since: '14d', notable: true, speciesCode: null, familyCode: 'corvidae', view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters \(2 active\)/i });
    expect(trigger).toBeInTheDocument();
  });
});

describe('O4 (#780): Filters floating sheet — modality, dismiss, inert, aria', () => {
  // These tests cover the O4 filter-sheet contract:
  //   - inert on #map-layer set/removed
  //   - Escape and backdrop click both close panel + restore focus to trigger
  //   - aria-expanded on the trigger flips false→true→false
  //   - trigger carries aria-haspopup="dialog" and NO aria-controls

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trigger carries aria-haspopup="dialog" and no aria-controls', async () => {
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  // C51 (#1033): filters surface must be role=dialog (was role=region) so that
  // aria-haspopup="dialog" on the trigger is truthful. aria-modal="true" marks
  // it as a modal dialog (inert on #map-layer already enforces the boundary).
  it('filters surface is role=dialog named "Filters" with aria-modal=true (#1033 C51)', async () => {
    render(<App />);
    await screen.findByRole('banner');
    await userEvent.click(screen.getByRole('button', { name: /Filters/i }));
    const panel = screen.getByRole('dialog', { name: 'Filters' });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel).toHaveAttribute('aria-label', 'Filters');
  });

  it('aria-expanded on trigger flips false→true on open, true→false on close', async () => {
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Close filters/i }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('opening filters sets inert on #map-layer; closing removes it', async () => {
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    const mapLayer = container.querySelector('#map-layer');

    // Before open: no inert (the scrim useLayoutEffect is for unscoped only;
    // we are scoped here so mapLayer should not be inert)
    expect(mapLayer).not.toHaveAttribute('inert');

    await userEvent.click(trigger);
    // After open: map-layer is inert
    expect(mapLayer).toHaveAttribute('inert');

    await userEvent.click(screen.getByRole('button', { name: /Close filters/i }));
    // After close: inert removed
    expect(mapLayer).not.toHaveAttribute('inert');
  });

  it('Escape key closes the filters panel and removes inert', async () => {
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    const mapLayer = container.querySelector('#map-layer');

    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /Filters/i })).toBeInTheDocument();
    expect(mapLayer).toHaveAttribute('inert');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Filters/i })).toBeNull();
    expect(mapLayer).not.toHaveAttribute('inert');
  });

  it('backdrop click closes the filters panel and removes inert', async () => {
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    const mapLayer = container.querySelector('#map-layer');

    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /Filters/i })).toBeInTheDocument();
    expect(mapLayer).toHaveAttribute('inert');

    const backdrop = container.querySelector('[data-testid="filters-backdrop"]');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop!);
    expect(screen.queryByRole('dialog', { name: /Filters/i })).toBeNull();
    expect(mapLayer).not.toHaveAttribute('inert');
  });

  it('focus restores to the Filters trigger on close (close button path)', async () => {
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });

    await userEvent.click(trigger);
    // panel is open; close button is present
    const closeBtn = screen.getByRole('button', { name: /Close filters/i });
    expect(closeBtn).toBeInTheDocument();

    await userEvent.click(closeBtn);
    // focus should return to the trigger
    expect(document.activeElement).toBe(trigger);
  });

  // DEFECT 1 (#780 bot finding): on initial page load with filters CLOSED,
  // the useLayoutEffect close branch must NOT steal focus to the Filters
  // trigger. Focus theft only belongs on an open→close TRANSITION.
  it('does NOT steal focus to the Filters trigger on initial render (scoped URL)', async () => {
    // Scoped URL — filters closed, scopeActive=true (S1 scrim does NOT override focus).
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });
    // On mount, the Filters trigger must NOT hold focus.
    expect(document.activeElement).not.toBe(trigger);
  });

  // DEFECT 2 (#780 bot finding): focus must be trapped inside the filters
  // sheet while it is open. Tab from the last focusable element must wrap
  // back to the first (and not escape into AppHeader Attribution/theme-toggle).
  // Shift+Tab from the first focusable must wrap to the last.
  it('Tab from last focusable in sheet wraps to first (no escape to AppHeader)', async () => {
    const { container } = render(<App />);
    await screen.findByRole('banner');
    const trigger = screen.getByRole('button', { name: /Filters/i });

    await userEvent.click(trigger);
    // Panel is now open; collect all focusable elements inside it.
    const panel = container.querySelector('.filters-panel');
    expect(panel).not.toBeNull();
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(panel!.querySelectorAll<HTMLElement>(focusableSelector));
    expect(focusables.length).toBeGreaterThan(0);

    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];

    // Place focus on the last focusable element inside the sheet.
    lastFocusable.focus();
    expect(document.activeElement).toBe(lastFocusable);

    // Tab forward from last → should wrap to first (not escape to AppHeader).
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(firstFocusable);
    // Double-check: the focus is still inside the panel, not in AppHeader.
    expect(panel!.contains(document.activeElement)).toBe(true);

    // Shift+Tab from first → should wrap to last.
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(lastFocusable);
  });
});

// #828: the L2 (freshness empty-state) and L3 (nowTick/visibilitychange
// re-derivation) suites were removed with the freshness module. The freshness
// line, `deriveFreshness`, and the nowTick visibilitychange machinery no longer
// exist (the bottom-right attribution carries source/licensing instead), so
// there is no "Source unavailable" copy and no per-tab-return re-derivation to
// guard. The deleted module's own unit coverage lived in lib/freshness.test.ts
// + config/freshness.test.ts, also removed this PR. (#456 W3-A is superseded.)

describe('Clarity view tagging (#657-followup)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
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
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'map',
      scope: { kind: 'us' as const },
    };
    render(<App />);
    expect(setViewSpy).toHaveBeenCalledWith('map');
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
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({
      data: [], meta: { freshestObservationAt: null },
    });
    mockGetSilhouettes.mockResolvedValue([]);
    mapSurfaceRef.onViewportChange = null;
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map',
      scope: { kind: 'us' as const },
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

describe('S4 (#769): onViewportChange scope-gate', () => {
  // A plain object with the four getter methods App.tsx calls on a LngLatBounds
  // (jsdom can't load maplibre-gl — the same constraint the MapSurface stub and
  // the #690 block above work around).
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

  // Two arbitrary, distinct framings — chosen so the second is a clearly
  // different camera (would force a `setViewportBounds` re-render if the gate
  // were absent).
  const FRAME_A = makeBounds(-125, 24, -66, 50);
  const FRAME_B = makeBounds(-122.5, 37.3, -121.8, 37.9);

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetStates.mockResolvedValue([]);
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({
      data: [], meta: { freshestObservationAt: null },
    });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetObservations.mockClear();
    mockGetHotspots.mockClear();
    mapSurfaceRef.onViewportChange = null;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mapSurfaceRef.renderCount = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // AC: while unscoped, onViewportChange early-returns — it does NOT call
  // setViewportBounds, so a settled `idle` causes ZERO additional App renders.
  // Under S1 the map is persistently mounted behind the scrim, so the real
  // maplibre `idle` (modelled here by invoking the captured callback) DOES
  // reach App's onViewportChange even while unscoped — the early-return is the
  // mechanism that keeps it inert, NOT an unmount. This is the unit-level proof
  // that the live-map e2e proves at the network layer (net /api/observations
  // === 0 after a real unscoped idle).
  it('does NOT update viewportBounds (no re-render) when the map idles while unscoped', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    // The chooser scrim is up, but the map surface is mounted behind it (S1),
    // so the stub captures the live onViewportChange even while unscoped.
    expect(
      await screen.findByRole('region', { name: /Choose where to look at birds/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mapSurfaceRef.onViewportChange).not.toBeNull();
    });
    const onViewportChange = mapSurfaceRef.onViewportChange!;

    const rendersBefore = mapSurfaceRef.renderCount;
    // Drive a settled viewport idle while unscoped — the gate must swallow it
    // with ZERO state writes, so no re-render is committed.
    await act(async () => {
      onViewportChange(FRAME_A, 4);
    });
    await act(async () => {
      onViewportChange(FRAME_B, 9);
    });
    expect(mapSurfaceRef.renderCount).toBe(rendersBefore);
    // And the enabled=false backstop still holds: no observations fetch fired.
    expect(mockGetObservations).not.toHaveBeenCalled();
  });

  // Control case: with a scope active, the SAME callback DOES update
  // viewportBounds (re-renders) — proving the no-op above is the unscoped gate,
  // not a dead callback. (`?scope=us` framing arms the scopeMoveUntilRef window,
  // so we advance past SCOPE_MOVE_SETTLE_MS first; that window suppresses the
  // bbox *refetch*, NOT the `setViewportBounds` write the legend depends on.)
  it('DOES update viewportBounds (re-renders) when the map idles while scoped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'us' as const },
    };
    render(<App />);
    await waitFor(() => {
      expect(mapSurfaceRef.onViewportChange).not.toBeNull();
    });
    const onViewportChange = mapSurfaceRef.onViewportChange!;

    // Clear the scope-framing settle window so the idle is treated as genuine
    // user pan, not the programmatic scope-frame settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const rendersBefore = mapSurfaceRef.renderCount;
    await act(async () => {
      onViewportChange(FRAME_B, 9);
    });
    // setViewportBounds committed a new value → at least one re-render.
    expect(mapSurfaceRef.renderCount).toBeGreaterThan(rendersBefore);
  });
});

describe('#740 (C6): scope wiring end-to-end', () => {
  // Two CONUS states for the /api/states table. `bbox` is [w,s,e,n] (the
  // StateSummary order); App converts to [[w,s],[e,n]] for the camera.
  const STATES = [
    { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] },
    { stateCode: 'US-CA', name: 'California', bbox: [-124.41, 32.53, -114.13, 42.01] as [number, number, number, number] },
  ];

  // A plain object with the four getter methods App.tsx calls on a LngLatBounds.
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

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue(STATES);
    mockGetObservations.mockClear();
    mockGetHotspots.mockClear();
    mockGetStates.mockClear();
    mockGetSilhouettes.mockClear();
    mockUrlState.set.mockClear();
    mapSurfaceRef.onViewportChange = null;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mapSurfaceRef.renderCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC 1: Unscoped → chooser scrim over a mounted-but-INERT map, fetch suppressed.
  it('renders the ScopeChooser and fires ZERO /api/observations requests when unscoped', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    // Chooser scrim is shown over the map.
    expect(
      await screen.findByRole('region', { name: /Choose where to look at birds/i }),
    ).toBeInTheDocument();
    // #761 (S1) / O1 (#776): the map surface is mounted but INERT behind the
    // scrim (no longer a full-tree unmount). The stub is present and #map-layer
    // — the map wrapper — carries the `inert` attribute set by App's
    // inert/focus-trap effect. O1 retargeted `inert` from #main-surface to
    // #map-layer so the live MapLibre canvas is frozen, not the near-empty shell.
    expect(screen.getByTestId('map-surface-stub')).toBeInTheDocument();
    expect(container.querySelector('#map-layer')).toHaveAttribute('inert');
    // The cold-load fetch is suppressed: zero observations requests. Give any
    // mistaken effect a tick to fire.
    await waitFor(() => {
      expect(mockGetStates).toHaveBeenCalled();
    });
    expect(mockGetObservations).not.toHaveBeenCalled();
    expect(mockGetHotspots).not.toHaveBeenCalled();
  });

  // SUGGESTION (PR #758): a terminal /api/states outage must not strand the
  // chooser <select> on "Loading states…" forever. statesLoading flips false,
  // states stays [], error is non-null — App threads error into ScopeChooser,
  // which swaps the placeholder to an honest "Couldn't load states" copy. The
  // ZIP path + whole-US escape hatch remain usable.
  it('terminal /api/states outage shows honest "Couldn\'t load states" copy in the chooser, not "Loading states"', async () => {
    mockGetStates.mockRejectedValue(new Error('Failed to fetch'));
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    // After the fetch settles, the placeholder must read the honest copy.
    const select = await screen.findByRole('combobox', { name: /state/i });
    await waitFor(() => {
      const placeholder = within(select).getAllByRole('option')[0];
      expect(placeholder).toHaveTextContent(/couldn.t load states/i);
    });
    const placeholder = within(select).getAllByRole('option')[0];
    expect(placeholder).not.toHaveTextContent(/loading/i);
    // Whole-US escape hatch remains usable.
    await userEvent.click(screen.getByRole('button', { name: /Explore the whole US map/i }));
    expect(mockUrlState.set).toHaveBeenCalledWith({ scope: { kind: 'us' } });
  });

  // AC 1 (callbacks): chooser pick-state writes ?state=US-XX.
  it('chooser pick-state writes scope { kind: state, stateCode }', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    // Pick Arizona via the chooser <select> + Go.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Arizona' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText('State'), 'US-AZ');
    // #827: the chooser now has TWO "Go" buttons (State + ZIP). Scope to the
    // State <select>'s own <form> so the click targets the State Go, not the
    // always-enabled ZIP Go in the sibling role="search" form.
    {
      const stateForm = screen.getByLabelText('State').closest('form');
      if (!stateForm) throw new Error('State <select> is not inside a <form>');
      await userEvent.click(within(stateForm).getByRole('button', { name: /^Go$/i }));
    }
    expect(mockUrlState.set).toHaveBeenCalledWith({ scope: { kind: 'state', stateCode: 'US-AZ' } });
  });

  // AC 1 (callbacks): chooser whole-US writes ?scope=us.
  it('chooser "Explore the whole US map" writes scope { kind: us }', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    await userEvent.click(screen.getByRole('button', { name: /Explore the whole US map/i }));
    expect(mockUrlState.set).toHaveBeenCalledWith({ scope: { kind: 'us' } });
  });

  // AC 2: ?state=US-AZ → ?state= reaches the client + camera framed to the
  // state envelope.
  it('?state=US-AZ sends stateCode to the API and frames the camera to the AZ envelope', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    // Map surface mounts (scoped view).
    expect(await screen.findByTestId('map-surface-stub')).toBeInTheDocument();
    // The observations fetch carries ?state=US-AZ (mapped from filters.stateCode
    // by the client; here we assert the filters reach the hook).
    await waitFor(() => {
      expect(mockGetObservations).toHaveBeenCalled();
    });
    const everyCallHasState = mockGetObservations.mock.calls.every(
      ([f]) => (f as { stateCode?: string }).stateCode === 'US-AZ',
    );
    expect(everyCallHasState).toBe(true);
    // Camera framed: boundsKey === state code, scopeBounds === [[w,s],[e,n]].
    await waitFor(() => {
      expect(mapSurfaceRef.boundsKey).toBe('US-AZ');
    });
    expect(mapSurfaceRef.scopeBounds).toEqual([[-114.82, 31.33], [-109.05, 37.0]]);
    // No transient flyTo on a bare state deep-link.
    expect(mapSurfaceRef.flyTo).toBeUndefined();
  });

  // AC 3: ZIP onResolve → state scope + staged flyTo (flyTo preferred over
  // fitBounds: it is threaded as a distinct prop alongside boundsKey).
  it('ZIP onResolve sets the state scope AND stages a flyTo at the resolution zoom', async () => {
    // Start already scoped to AZ so the in-state ScopeControl ZipInput is
    // present (the resolution sets a state + flyTo without remounting).
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await screen.findByTestId('map-surface-stub');
    // #828: the in-card ScopeControl is collapsed behind the 🔍 disclosure —
    // open it so its ZipInput is revealed (mounted-but-hidden until expanded).
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));

    // Drive the ScopeControl's ZipInput onResolve via the real component: type
    // a known ZIP and submit. We stub zip-lookup's network by mocking fetch to
    // return an index containing 85701 → Tucson, AZ. Simpler: invoke the
    // ScopeControl onResolve path through the ZIP form. The zip-lookup index is
    // fetched on submit; mock global fetch to serve it.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ v: 1, states: ['US-AZ'], zips: { '85701': [32.2217, -110.9747, 0] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const zipInputs = screen.getAllByLabelText('ZIP code');
      // ScopeControl's ZipInput is the on-map one; type + submit.
      const zip = zipInputs[zipInputs.length - 1];
      await userEvent.type(zip, '85701');
      await userEvent.type(zip, '{Enter}');
      // onResolveZip writes the state scope...
      await waitFor(() => {
        expect(mockUrlState.set).toHaveBeenCalledWith({ scope: { kind: 'state', stateCode: 'US-AZ' } });
      });
      // ...and stages a flyTo at the metro zoom (ZIP_FLYTO_ZOOM = 10), centered
      // on the resolved [lng, lat]. Asserted via the MapSurface stub capture.
      await waitFor(() => {
        expect(mapSurfaceRef.flyTo).toBeDefined();
      });
      expect(mapSurfaceRef.flyTo!.zoom).toBe(10);
      expect(mapSurfaceRef.flyTo!.center).toEqual([-110.9747, 32.2217]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // AC 4: ?scope=us → CONUS map, no ?state= sent.
  it('?scope=us renders the CONUS map with boundsKey "us" and sends NO stateCode', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'us' },
    };
    render(<App />);
    expect(await screen.findByTestId('map-surface-stub')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetObservations).toHaveBeenCalled();
    });
    // Data invariant: no ?state= for whole-US.
    const noState = mockGetObservations.mock.calls.every(
      ([f]) => (f as { stateCode?: string }).stateCode === undefined,
    );
    expect(noState).toBe(true);
    await waitFor(() => {
      expect(mapSurfaceRef.boundsKey).toBe('us');
    });
    // CONUS production constant [[-130,20],[-65,52]].
    expect(mapSurfaceRef.scopeBounds).toEqual([[-130, 20], [-65, 52]]);
  });

  // AC 5: exactly ONE refetch per scope change — every camera-move settle
  // `idle` fired during the scope-change animation window must be SUPPRESSED, so
  // a programmatic fitBounds/flyTo (which can emit more than one settle idle)
  // never adds a second mid-animation fetch. After the settle window, a genuine
  // user pan refetches normally.
  it('suppresses scope-change settle idles so only one fetch fires per scope change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null,
        view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
      };
      render(<App />);
      await waitFor(() => {
        expect(mapSurfaceRef.onViewportChange).not.toBeNull();
      });
      // One fetch from the scope itself (the stateCode/enabled trigger).
      await waitFor(() => {
        expect(mockGetObservations).toHaveBeenCalledTimes(1);
      });
      const onViewportChange = mapSurfaceRef.onViewportChange!;

      // The programmatic fitBounds can settle across MULTIPLE idles (the
      // uncontrolled initial frame + the imperative move). All within the
      // ~1000ms scope-move window — every one must be suppressed.
      await act(async () => {
        onViewportChange(makeBounds(-114.82, 31.33, -109.05, 37.0), 6);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => {
        onViewportChange(makeBounds(-114.0, 33.0, -110.0, 35.0), 7);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      // Still only the single scope fetch — both settle idles were swallowed.
      expect(mockGetObservations).toHaveBeenCalledTimes(1);

      // Advance PAST the settle window, then a genuine user pan DOES refetch.
      await act(async () => { await vi.advanceTimersByTimeAsync(900); });
      await act(async () => {
        onViewportChange(makeBounds(-112.0, 33.0, -111.0, 34.0), 9);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await waitFor(() => {
        expect(mockGetObservations).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // AC 6: clear-scope (ScopeControl exit) → back to the chooser, not a CONUS
  // home. We assert the exit affordance emits scope: { kind: 'unscoped' }.
  it('ScopeControl "Change scope" exit emits scope { kind: unscoped }', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await screen.findByTestId('map-surface-stub');
    // #828: the scope form is collapsed behind the 🔍 disclosure — open it first
    // so the "Change scope" exit affordance is revealed and clickable.
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));
    await userEvent.click(screen.getByRole('button', { name: /Change scope/i }));
    expect(mockUrlState.set).toHaveBeenCalledWith({ scope: { kind: 'unscoped' } });
  });

  // AC: detail overlay does not by itself constitute a scope — an unscoped URL
  // carrying ?detail= still shows the chooser scrim, not the detail rail.
  it('an unscoped URL with a detail code still shows the chooser (detail is not a scope)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', detail: 'vermfly', scope: { kind: 'unscoped' },
    } as typeof mockUrlState.state;
    const { container } = render(<App />);
    // Pre-existing guard (a): the chooser region is shown.
    expect(
      await screen.findByRole('region', { name: /Choose where to look at birds/i }),
    ).toBeInTheDocument();
    // #761 (S1) / O1 (#776) re-baseline: the map surface is now mounted but
    // INERT behind the scrim (it was unmounted under the old early-return).
    // O1 retargeted `inert` from #main-surface to #map-layer (the map wrapper).
    expect(screen.getByTestId('map-surface-stub')).toBeInTheDocument();
    expect(container.querySelector('#map-layer')).toHaveAttribute('inert');
    // #761 (S1) NEW guard: the detail rail/sheet does NOT render on an unscoped
    // URL even though detail:'vermfly' is set — the `scopeActive` gate (App
    // task #6) stops a `?detail=` from mounting a second top-layer over the
    // scrim. SpeciesDetailRail is NOT mocked here, so key off its real DOM: the
    // rail renders <aside role="complementary"> with a "Close species detail"
    // button. Neither must be present.
    expect(screen.queryByRole('complementary', { name: /detail/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Close species detail/i })).toBeNull();
    // Pre-existing guard (b): zero /api/observations while unscoped.
    expect(mockGetObservations).not.toHaveBeenCalled();
  });

  // #761 (S1): the always-rendered shell, the mounted-but-inert map stub, and
  // the chooser region all co-exist on an unscoped render (under the old
  // early-return they were mutually exclusive). The shell is `.app`; #main-surface
  // carries `inert`; the cold-load fetch stays suppressed.
  it('unscoped render mounts the shell + inert map + chooser together, no observations fetch', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    expect(
      await screen.findByRole('region', { name: /Choose where to look at birds/i }),
    ).toBeInTheDocument();
    // The full app shell renders (it used to be replaced by the chooser).
    expect(container.querySelector('.app')).not.toBeNull();
    // The map stub and the chooser region are BOTH in the DOM simultaneously.
    expect(screen.getByTestId('map-surface-stub')).toBeInTheDocument();
    // #map-layer is inert (O1 retarget from #main-surface).
    expect(container.querySelector('#map-layer')).toHaveAttribute('inert');
    // Fetch stays suppressed.
    expect(mockGetObservations).not.toHaveBeenCalled();
    expect(mockGetHotspots).not.toHaveBeenCalled();
  });

  // A5 (#1034): initial focus moves to the ZIP input on the unscoped landing,
  // not the scrim wrapper. The scrim wrapper carries `outline:none` and must
  // NOT hold focus (a UA blue full-viewport ring on the app's first impression
  // was V14 major finding). After this fix the focus LANDING TARGET is the
  // `.zip-input__field` input inside <ZipInput>; the scrim wrapper stays in the
  // DOM as a focus-trap boundary but is no longer the ACTIVE focus target.
  it('moves initial focus to the ZIP input on the unscoped landing, not the scrim wrapper', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    const scrim = container.querySelector('.scope-chooser-scrim');
    expect(scrim).not.toBeNull();
    // Focus must be on the ZIP input, not the scrim wrapper itself.
    const zipInput = screen.getByRole('textbox', { name: /ZIP code/i });
    expect(zipInput).toHaveFocus();
    // Guard: scrim wrapper must NOT hold focus (that painted the UA blue ring).
    expect(scrim).not.toHaveFocus();
  });

  // Region label: state scope resolves to the state NAME from /api/states.
  it('threads the resolved state name as the region label for a state scope', async () => {
    mockGetStates.mockResolvedValue([
      { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.8, 31.3, -109.0, 37.0] },
    ]);
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [{
        subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.2, lng: -110.9, obsDt: new Date().toISOString(), locId: 'L1',
        locName: 'Sabino Canyon', howMany: 1, isNotable: false,
        silhouetteId: null, familyCode: 'songbird',
      }],
      meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
    });
    render(<App />);
    // The AppHeader wordmark / region-name row names the region — the resolved
    // "Arizona" name, not the bare "US-AZ" code. Check the identity card.
    // #1057: the "· " separator now lives in `.brand-region::before` (CSS), so
    // the element's text node is just the region name ("Arizona").
    await screen.findByText(/Arizona/i, { selector: '.brand-region' });
    expect(screen.queryByText(/US-AZ/, { selector: '.brand-region' })).toBeNull();
  });
});

describe('#847: state→state switch re-seeds debouncedBbox/zoom (render-phase)', () => {
  // Two DISJOINT CONUS states. The bug: an in-app AZ→CA switch fires
  // /api/observations with { state: US-CA, bbox: PREVIOUS-settled-AZ viewport }.
  // The server ANDs stateCode (ST_Intersects) with bbox, so a stale-AZ bbox
  // never intersects CA → empty 200 → 0 markers, "No recent sightings".
  // bbox is [w,s,e,n] (the StateSummary order); App converts to [[w,s],[e,n]].
  const STATES = [
    { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] },
    { stateCode: 'US-CA', name: 'California', bbox: [-124.41, 32.53, -114.13, 42.01] as [number, number, number, number] },
  ];

  // A plain object with the four getter methods App.tsx calls on a LngLatBounds
  // (jsdom can't load maplibre-gl — same constraint as the #690/#740 blocks).
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

  // Does bbox [w,s,e,n] intersect the [w,s,e,n] envelope? (axis-aligned overlap)
  function bboxIntersects(
    bbox: [number, number, number, number],
    env: [number, number, number, number],
  ): boolean {
    const [w, s, e, n] = bbox;
    const [ew, es, ee, en] = env;
    return w <= ee && e >= ew && s <= en && n >= es;
  }

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue(STATES);
    mockGetObservations.mockClear();
    mockGetHotspots.mockClear();
    mockGetStates.mockClear();
    mockGetSilhouettes.mockClear();
    mockUrlState.set.mockClear();
    mapSurfaceRef.onViewportChange = null;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
    mapSurfaceRef.renderCount = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // PRIMARY regression: render scoped to AZ, settle an AZ viewport, then switch
  // to the DISJOINT CA. The LAST/only post-switch fetch must carry stateCode
  // 'US-CA' with a bbox intersecting CA (NOT the stale AZ viewport), and exactly
  // one post-switch fetch must fire.
  it('switching AZ→CA re-seeds the bbox so the post-switch fetch carries a CA-intersecting bbox', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null,
        view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
      };
      const { rerender } = render(<App />);
      await waitFor(() => {
        expect(mapSurfaceRef.onViewportChange).not.toBeNull();
      });
      // The scope itself fires one fetch (the stateCode/enabled trigger).
      await waitFor(() => {
        expect(mockGetObservations).toHaveBeenCalledTimes(1);
      });
      const onViewportChange = mapSurfaceRef.onViewportChange!;

      // Settle a real INTERIOR-AZ viewport: advance PAST the scope-move window,
      // fire a genuine AZ idle, then drain the 250ms debounce so debouncedBbox
      // commits. INTERIOR_AZ is strictly EAST of CA's east edge (-114.13) so it
      // is genuinely DISJOINT from the CA envelope — this is the stale bbox that,
      // unreset, de-pairs the post-switch CA fetch (the live-confirmed bug).
      const INTERIOR_AZ: [number, number, number, number] = [-112.0, 32.0, -110.0, 35.0];
      await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
      await act(async () => {
        onViewportChange(makeBounds(...INTERIOR_AZ), 6);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });

      // Sanity: the just-committed fetch carried the interior-AZ bbox + AZ state,
      // and that bbox is disjoint from the CA envelope (the precondition for the bug).
      const azCall = mockGetObservations.mock.calls.at(-1)![0] as {
        stateCode?: string; bbox?: [number, number, number, number];
      };
      expect(azCall.stateCode).toBe('US-AZ');
      expect(azCall.bbox).toEqual(INTERIOR_AZ);
      expect(bboxIntersects(INTERIOR_AZ, STATES[1].bbox)).toBe(false);

      const callsBeforeSwitch = mockGetObservations.mock.calls.length;

      // In-app switch to the DISJOINT CA scope (mutate URL state + rerender —
      // models the in-card scope-control <select> writing ?state=US-CA).
      mockUrlState.state = {
        ...mockUrlState.state,
        scope: { kind: 'state', stateCode: 'US-CA' },
      };
      await act(async () => {
        rerender(<App />);
      });
      // Let any debounce/effect work settle.
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });

      const postSwitchCalls = mockGetObservations.mock.calls.slice(callsBeforeSwitch);
      // Exactly ONE post-switch fetch (the scope change itself; no second one).
      expect(postSwitchCalls).toHaveLength(1);

      // The LAST/only post-switch fetch carries US-CA + a CA-intersecting bbox —
      // NOT the stale AZ bbox (which is disjoint from CA → the empty-200 bug).
      const last = mockGetObservations.mock.calls.at(-1)![0] as {
        stateCode?: string; bbox?: [number, number, number, number];
      };
      expect(last.stateCode).toBe('US-CA');
      expect(last.bbox).toBeDefined();
      expect(
        bboxIntersects(last.bbox!, STATES[1].bbox),
        `post-switch bbox=${last.bbox!.join(',')} must intersect the CA envelope ${STATES[1].bbox.join(',')}`,
      ).toBe(true);
      // And it must NOT be the stale AZ viewport (disjoint from CA).
      expect(
        bboxIntersects(last.bbox!, STATES[0].bbox) && !bboxIntersects(last.bbox!, STATES[1].bbox),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // #690 pairing invariant across the switch: the post-switch fetch satisfies
  // lngSpan <= 45 || zoom < 6 (no bbox-area-cap violation). The reseeded
  // zoom = 3 (aggregated) is the documented choice.
  it('post-switch fetch satisfies the #690 {bbox,zoom} consistency predicate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null,
        view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
      };
      const { rerender } = render(<App />);
      await waitFor(() => {
        expect(mapSurfaceRef.onViewportChange).not.toBeNull();
      });
      const onViewportChange = mapSurfaceRef.onViewportChange!;
      await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
      await act(async () => {
        onViewportChange(makeBounds(-114.82, 31.33, -109.05, 37.0), 6);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });

      mockUrlState.state = {
        ...mockUrlState.state,
        scope: { kind: 'state', stateCode: 'US-CA' },
      };
      await act(async () => { rerender(<App />); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });

      // Every fetch carrying a bbox/zoom pair must be internally consistent.
      for (const [filters] of mockGetObservations.mock.calls) {
        const { bbox, zoom } = filters as {
          bbox?: [number, number, number, number];
          zoom?: number;
        };
        if (!bbox || zoom === undefined) continue;
        const lngSpan = bbox[2] - bbox[0];
        const consistent = lngSpan <= 45 || zoom < 6;
        expect(
          consistent,
          `inconsistent fetch: bbox=${bbox.join(',')} (lngSpan=${lngSpan.toFixed(2)}), zoom=${zoom}`,
        ).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression-preservation: a mid-animation onViewportChange INSIDE the
  // scope-move window adds NO extra fetch (the render-phase seed must not
  // reintroduce the mid-animation double-fetch the window exists to prevent).
  it('a mid-animation idle inside the scope-move window adds no extra fetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null,
        view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
      };
      const { rerender } = render(<App />);
      await waitFor(() => {
        expect(mapSurfaceRef.onViewportChange).not.toBeNull();
      });
      await waitFor(() => {
        expect(mockGetObservations).toHaveBeenCalledTimes(1);
      });
      const onViewportChange = mapSurfaceRef.onViewportChange!;

      // Switch to CA — the scope change arms a fresh scope-move window.
      mockUrlState.state = {
        ...mockUrlState.state,
        scope: { kind: 'state', stateCode: 'US-CA' },
      };
      await act(async () => { rerender(<App />); });
      await waitFor(() => {
        expect(mockGetObservations).toHaveBeenCalledTimes(2);
      });

      // A mid-animation settle idle INSIDE the freshly-armed window: swallowed,
      // so the count stays at 2 (no extra fetch).
      await act(async () => {
        onViewportChange(makeBounds(-124.41, 32.53, -114.13, 42.01), 6);
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(mockGetObservations).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression-preservation: the render-phase seed must NOT double-fire on a
  // cold scoped mount — the FIRST render initializes prevBoundsKeyRef to the
  // mount boundsKey, so the initial scope is not treated as a change.
  // Mirrors App.test.tsx AC-5 toHaveBeenCalledTimes(1).
  it('cold scoped mount still fires exactly one fetch (prevBoundsKeyRef seed guard)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await waitFor(() => {
      expect(mockGetObservations).toHaveBeenCalledTimes(1);
    });
    // Give any mistaken second effect/render a tick to fire.
    await waitFor(() => {
      expect(mockGetObservations).toHaveBeenCalledTimes(1);
    });
    expect(mockGetObservations).toHaveBeenCalledTimes(1);
  });
});

describe('#761 (S2): map hoisted to a viewport-root #map-layer sibling of <main>', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue([
      { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] },
    ]);
    mockGetObservations.mockClear();
    mockGetHotspots.mockClear();
    mockGetStates.mockClear();
    mockGetSilhouettes.mockClear();
    mockUrlState.set.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC: the {mapVisible && …} block renders inside a #map-layer wrapper that is a
  // SIBLING of <main>, not a descendant. The bare MapSurface stub
  // (<div data-testid="map-surface-stub" />) satisfies the structure check.
  it('renders #map-layer as a sibling of <main>, NOT a descendant of #main-surface', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    const { container } = render(<App />);
    await screen.findByTestId('map-surface-stub');

    const mapLayer = container.querySelector('#map-layer');
    const mainSurface = container.querySelector('#main-surface');
    expect(mapLayer).not.toBeNull();
    expect(mainSurface).not.toBeNull();

    // #map-layer is NOT contained within #main-surface (the hoist's load-bearing
    // structural invariant — the map left the windowed <main>).
    expect(mainSurface!.contains(mapLayer)).toBe(false);
    // The map stub lives inside #map-layer, and #map-layer is NOT inside <main>.
    const mapStub = screen.getByTestId('map-surface-stub');
    expect(mapLayer!.contains(mapStub)).toBe(true);
    expect(mainSurface!.contains(mapStub)).toBe(false);
    // Both are children of the same `.app` root (siblings, not parent/child).
    const app = container.querySelector('.app');
    expect(mapLayer!.parentElement).toBe(app);
    expect(mainSurface!.parentElement).toBe(app);
  });

  // AC (#800): The "Map view" tab is REMOVED. There is no tablist or tab role
  // in the new AppHeader — the map is the always-mounted sole surface.
  // Assert the absence (was: aria-controls='map-layer' tab assertion).
  it('does NOT render a tablist or Map view tab after #800 header migration', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await screen.findByTestId('map-surface-stub');

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Map view' })).toBeNull();
    // The #map-layer is still present and holds the map.
    expect(document.querySelector('#map-layer')).not.toBeNull();
  });

  // AC: the always-mounted-under-scrim invariant survives the hoist — on the
  // unscoped scrim landing #map-layer still mounts (idle) and /api/observations
  // stays at zero (existing scopeActive fetch gate). #map-layer is NOT gated on
  // scopeActive.
  it('mounts #map-layer on the unscoped scrim landing with zero observations fetch', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    // Chooser scrim is shown; the map is mounted idle behind it.
    expect(
      await screen.findByRole('region', { name: /Choose where to look at birds/i }),
    ).toBeInTheDocument();
    expect(container.querySelector('#map-layer')).not.toBeNull();
    expect(screen.getByTestId('map-surface-stub')).toBeInTheDocument();
    // The scopeActive fetch gate holds observations at zero on the unscoped landing.
    await waitFor(() => {
      expect(mockGetStates).toHaveBeenCalled();
    });
    expect(mockGetObservations).not.toHaveBeenCalled();
  });
});

describe('O9 (#781): scope-gated MapCanvas prefetch wiring', () => {
  const STATES = [
    { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] },
  ];

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue(STATES);
    mockUrlState.set.mockClear();
    mockPrefetchMapCanvas.mockClear();
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The load-bearing negative: the unscoped chooser landing must NOT warm the
  // chunk (the #740/C6 fetch-light landing guarantee). prefetchMapCanvas is
  // never called while scope.kind === 'unscoped'.
  it('does NOT call prefetchMapCanvas on the unscoped chooser landing', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    // Give any mistaken scope effect a tick to fire.
    await waitFor(() => {
      expect(mockGetStates).toHaveBeenCalled();
    });
    expect(mockPrefetchMapCanvas).not.toHaveBeenCalled();
  });

  // Scoped landing: a `?state=US-AZ` deep-link mounts with scopeActive already
  // true → the scopeActive effect warms the chunk.
  it('calls prefetchMapCanvas on a scoped landing (?state=US-AZ deep-link)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await waitFor(() => {
      expect(mockPrefetchMapCanvas).toHaveBeenCalled();
    });
  });

  // Scoped landing: ?scope=us is also a real scope → warms the chunk.
  it('calls prefetchMapCanvas on a ?scope=us scoped landing', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'us' },
    };
    render(<App />);
    await waitFor(() => {
      expect(mockPrefetchMapCanvas).toHaveBeenCalled();
    });
  });

  // Scope-pick: chooser pick-state warms the chunk on the click (ahead of the
  // resulting state change + MapSurface mount).
  it('calls prefetchMapCanvas when picking a state from the chooser', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Arizona' })).toBeInTheDocument();
    });
    expect(mockPrefetchMapCanvas).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText('State'), 'US-AZ');
    // #827: the chooser now has TWO "Go" buttons (State + ZIP). Scope to the
    // State <select>'s own <form> so the click targets the State Go, not the
    // always-enabled ZIP Go in the sibling role="search" form.
    {
      const stateForm = screen.getByLabelText('State').closest('form');
      if (!stateForm) throw new Error('State <select> is not inside a <form>');
      await userEvent.click(within(stateForm).getByRole('button', { name: /^Go$/i }));
    }
    expect(mockPrefetchMapCanvas).toHaveBeenCalled();
  });

  // Scope-pick: chooser whole-US warms the chunk on the click.
  it('calls prefetchMapCanvas when picking whole-US from the chooser', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });
    expect(mockPrefetchMapCanvas).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Explore the whole US map/i }));
    expect(mockPrefetchMapCanvas).toHaveBeenCalled();
  });

  // Scope-pick: ZIP onResolve (in-state ScopeControl) warms the chunk. Start
  // already scoped so the on-map ScopeControl ZipInput is mounted. Mirrors the
  // #740 ZIP-onResolve test's fetch stub for the zip-lookup index.
  it('calls prefetchMapCanvas when resolving a ZIP via the in-state ScopeControl', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    render(<App />);
    await screen.findByTestId('map-surface-stub');
    // The scoped landing already warmed once; clear so the assertion isolates
    // the ZIP-resolve call.
    await waitFor(() => {
      expect(mockPrefetchMapCanvas).toHaveBeenCalled();
    });
    mockPrefetchMapCanvas.mockClear();
    // #828: open the 🔍 disclosure so the in-card ScopeControl ZipInput is
    // revealed (the scope form is collapsed/hidden until expanded).
    await userEvent.click(screen.getByRole('button', { name: /change region/i }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ v: 1, states: ['US-AZ'], zips: { '85701': [32.2217, -110.9747, 0] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    try {
      const zipInputs = screen.getAllByLabelText('ZIP code');
      const zip = zipInputs[zipInputs.length - 1];
      await userEvent.type(zip, '85701');
      await userEvent.type(zip, '{Enter}');
      await waitFor(() => {
        expect(mockPrefetchMapCanvas).toHaveBeenCalled();
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('O1 (#776): inert retarget to #map-layer', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mapSurfaceRef.boundsKey = undefined;
    mapSurfaceRef.scopeBounds = undefined;
    mapSurfaceRef.flyTo = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // S1 unscoped scrim: inert is set on #map-layer (not #main-surface) so the
  // live MapLibre canvas is frozen while the chooser scrim is active.
  it('sets inert on #map-layer (not #main-surface) when the unscoped scrim is shown', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    await screen.findByRole('region', { name: /Choose where to look at birds/i });

    // #map-layer carries the inert attribute (the retargeted mute).
    expect(container.querySelector('#map-layer')).toHaveAttribute('inert');
    // #main-surface does NOT carry inert (O1 retargets it off main).
    expect(container.querySelector('#main-surface')).not.toHaveAttribute('inert');
  });

  // O1 camera data-attributes: data-camera-bounds and data-scope-fitted exist on
  // the map root on a scoped path. data-scope-fitted starts "false" on a new
  // boundsKey and flips "true" after SCOPE_MOVE_SETTLE_MS.
  it('exposes data-camera-bounds on #map-layer for a scoped view', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    const { container } = render(<App />);
    await screen.findByTestId('map-surface-stub');

    // The camera attribute is present on #map-layer (the map root).
    const mapLayer = container.querySelector('#map-layer');
    expect(mapLayer).not.toBeNull();
    expect(mapLayer?.hasAttribute('data-camera-bounds')).toBe(true);
  });

  // O1: data-scope-fitted starts 'false' on mount with a boundsKey and flips
  // 'true' after the SCOPE_MOVE_SETTLE_MS timer fires.
  it('data-scope-fitted starts false and flips true after SCOPE_MOVE_SETTLE_MS', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // Install fake timers AFTER setting up state but BEFORE render so the
    // setTimeout in the boundsKey effect is captured. Use `shouldAdvanceTime:
    // false` so findByTestId's internal retry (which uses real microtask
    // scheduling) is not blocked by our clock freeze.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<App />));
    });

    const mapLayer = container!.querySelector('#map-layer');
    expect(mapLayer?.getAttribute('data-scope-fitted')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(1000); // SCOPE_MOVE_SETTLE_MS
    });

    expect(mapLayer?.getAttribute('data-scope-fitted')).toBe('true');
    vi.useRealTimers();
  });
});

describe('O2 (#770): skip-link + FamilyLegend hoisted to App-root siblings', () => {
  /**
   * These tests assert the new App-root rendering of the hoisted overlays
   * and their DOM-order invariants (WCAG 2.4.1 focus order).
   *
   * FamilyLegend returns null when silhouettes.length === 0 (its own guard),
   * so the App-root legend assertion uses a non-empty silhouettes stub.
   * The skip-link renders whenever mapVisible && scopeActive, regardless
   * of silhouettes.
   */
  const SCOPED_MAP_STATE = {
    since: '14d' as const,
    notable: false,
    speciesCode: null as string | null,
    familyCode: null as string | null,
    view: 'map' as const,
    scope: { kind: 'us' as const } as
      | { kind: 'unscoped' }
      | { kind: 'us' }
      | { kind: 'state'; stateCode: string },
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    mockUrlState.state = SCOPED_MAP_STATE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skip-link renders as an App-root element BEFORE <main id="main-surface">', () => {
    const { container } = render(<App />);
    const skipLink = container.querySelector('[data-testid="explore-map-markers-skip-link"]');
    const main = container.querySelector('#main-surface');
    expect(skipLink, 'skip-link not found in DOM on scoped map view').not.toBeNull();
    expect(main, '<main id="main-surface"> not found in DOM').not.toBeNull();

    // WCAG 2.4.1 DOM-order guard: skip-link must precede <main> so Tab
    // traversal reaches it before any ScopeControl or canvas element.
    // Node.DOCUMENT_POSITION_FOLLOWING (4) means `main` comes after `skipLink`.
    const position = skipLink!.compareDocumentPosition(main!);
    expect(
      position & Node.DOCUMENT_POSITION_FOLLOWING,
      'skip-link must precede <main> in DOM order (WCAG 2.4.1)',
    ).toBeTruthy();
  });

  it('skip-link does NOT render while unscoped', () => {
    mockUrlState.state = {
      ...SCOPED_MAP_STATE,
      scope: { kind: 'unscoped' },
    };
    const { container } = render(<App />);
    expect(
      container.querySelector('[data-testid="explore-map-markers-skip-link"]'),
    ).toBeNull();
  });

  it('skip-link is aria-hidden and tabIndex=-1 when observations are empty (hasMarkers=false)', async () => {
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    const { container } = render(<App />);
    await waitFor(() => {
      // Wait for observations to settle (empty)
      expect(container.querySelector('#map-layer')?.getAttribute('aria-busy')).toBe('false');
    });
    const skipLink = container.querySelector('[data-testid="explore-map-markers-skip-link"]') as HTMLElement | null;
    expect(skipLink).not.toBeNull();
    expect(skipLink!.getAttribute('aria-hidden')).toBe('true');
    expect(String(skipLink!.tabIndex)).toBe('-1');
  });

  // NOTE: the vacuous '.map-surface containment' assertion that used to live
  // here was removed (O2 #809 deferred nit). MapSurface is mocked to
  // `<div data-testid="map-surface-stub" />` (no .map-surface class) so
  // `.querySelector('.map-surface')` always returned null and the
  // early-return guard fired every time — the assertion was never reached.
  // The real invariant is covered by the DOM-order compareDocumentPosition
  // test above + the `#map-layer` containment test below + the e2e
  // compareDocumentPosition guard in `map-skip-link-and-hit-layer.spec.ts`.

  it('skip-link is NOT inside #map-layer (it precedes #map-layer in DOM)', () => {
    const { container } = render(<App />);
    const skipLink = container.querySelector('[data-testid="explore-map-markers-skip-link"]');
    const mapLayer = container.querySelector('#map-layer');
    if (!skipLink || !mapLayer) return;
    expect(mapLayer.contains(skipLink)).toBe(false);
  });

  // --- C47/C48 (#1030): skip-link targets a FOCUSABLE marker surface ---------
  //
  // MapSurface is stubbed in this file, so the real marker DOM is not present.
  // These tests inject fixture marker nodes (matching the production data-testid
  // / className contracts) into the document, then click the skip-link and
  // assert which one receives focus — exercising `focusFirstMarker`'s priority
  // ladder and the "never no-op on a non-focusable element" guarantee.

  const NON_EMPTY_OBS = {
    data: [
      {
        subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.2, lng: -110.9, obsDt: new Date().toISOString(), locId: 'L1',
        locName: 'Tucson', howMany: 1, isNotable: false, silhouetteId: null,
        familyCode: 'tyrannidae',
      },
    ],
    meta: { freshestObservationAt: new Date().toISOString() },
  };

  async function renderWithMarkersAndClickSkipLink(
    inject: (host: HTMLElement) => HTMLElement,
  ): Promise<{ injected: HTMLElement; skipLink: HTMLButtonElement }> {
    mockGetObservations.mockResolvedValue(NON_EMPTY_OBS);
    const { container } = render(<App />);
    // Wait for observations to settle so the skip-link's onClick guard
    // (observations.length > 0) is satisfied.
    await waitFor(() => {
      expect(container.querySelector('#map-layer')?.getAttribute('aria-busy')).toBe('false');
    });
    // Inject the fixture marker(s) into a host appended to the body (outside the
    // RTL container is fine — focusFirstMarker queries `document`).
    const host = document.createElement('div');
    document.body.appendChild(host);
    const injected = inject(host);
    const skipLink = container.querySelector(
      '[data-testid="explore-map-markers-skip-link"]',
    ) as HTMLButtonElement;
    expect(skipLink).not.toBeNull();
    act(() => {
      skipLink.click();
    });
    return { injected, skipLink };
  }

  it('falls back to the hit-layer active button when no grid cells exist (#1030 C47)', async () => {
    const { injected } = await renderWithMarkersAndClickSkipLink((host) => {
      host.innerHTML =
        '<div class="map-marker-hit-layer">' +
        '<button type="button" tabindex="0" data-sub-id="S1" aria-label="Vermilion Flycatcher, …"></button>' +
        '</div>';
      return host.querySelector('button') as HTMLElement;
    });
    expect(document.activeElement).toBe(injected);
    document.body.removeChild(injected.closest('.map-marker-hit-layer')!.parentElement!);
  });

  it('targets the coarse-pointer outer cluster button and never no-ops on a non-focusable cell (#1030 C48)', async () => {
    const { injected } = await renderWithMarkersAndClickSkipLink((host) => {
      // Coarse pointer: cells are non-focusable <div>s (same data-testid), and
      // the OUTER cluster <button> carries tabIndex=0. The skip-link must skip
      // the div and land on the focusable outer button.
      host.innerHTML =
        '<button type="button" data-testid="adaptive-grid-marker" tabindex="0" aria-label="Cluster">' +
        '<div data-testid="adaptive-grid-marker-cell-rendered"></div>' +
        '</button>';
      return host.querySelector('[data-testid="adaptive-grid-marker"]') as HTMLElement;
    });
    expect(document.activeElement).toBe(injected);
    // The non-focusable cell div did NOT receive focus.
    expect((document.activeElement as HTMLElement).getAttribute('data-testid')).toBe(
      'adaptive-grid-marker',
    );
    document.body.removeChild(injected.parentElement!);
  });

  it('prefers a focusable per-cell silhouette button over the hit layer when grid cells exist (#1030)', async () => {
    const { injected } = await renderWithMarkersAndClickSkipLink((host) => {
      // Fine pointer: per-cell silhouette <button>s exist AND a hit-layer
      // button exists. The cell button must win (priority 1).
      host.innerHTML =
        '<div class="map-marker-hit-layer">' +
        '<button type="button" tabindex="0" data-sub-id="S1" aria-label="hit"></button>' +
        '</div>' +
        '<button type="button" data-testid="adaptive-grid-marker-cell-rendered" tabindex="0" aria-label="Tyrant Flycatchers, 5 observations"></button>';
      return host.querySelector(
        '[data-testid="adaptive-grid-marker-cell-rendered"]',
      ) as HTMLElement;
    });
    expect(document.activeElement).toBe(injected);
    document.body.removeChild(injected.parentElement!);
  });
});

describe('O8 (#784): React.memo render-count regression — FamilyLegend + ScopeControl', () => {
  /**
   * LOAD-BEARING memo guards: two-layer approach.
   *
   * Layer 1 — structural guard (vi.mock, $$typeof check, top of this file):
   *   The vi.mock for FamilyLegend and ScopeControl checks at initialization
   *   time that the production export IS a React.memo component. If memo is
   *   removed from production, the mock substitutes a component that THROWS
   *   during render — all tests in this suite (and in App.test.tsx broadly)
   *   fail immediately with a clear diagnostic message. This is the mechanism
   *   that makes the mutation test (remove production memo → tests FAIL) work.
   *
   * Layer 2 — render-body counter (overlayRenderCounts):
   *   The mock wraps the inner implementation (FamilyLegendImpl / ScopeControlImpl,
   *   accessed via .type on the memo export) with a counting function, then
   *   re-applies React.memo around it. The counter increments ONLY when the
   *   wrapped memo allows the render through (props changed). On a nowTick bump,
   *   neither component's props change → memo bails → counter stays flat.
   *
   *   Why not Profiler? In React 18.3.1 / jsdom / vitest, React.Profiler fires
   *   onRender with phase='update' whenever the Profiler node's parent commits,
   *   even when the memo'd child bails and produces zero actual render work.
   *   Confirmed empirically with a pure no-hooks memo'd component: Profiler
   *   delta=1 regardless of memo. Render-body counter (module-level variable
   *   incremented inside the function that memo wraps) is the reliable tool.
   */
  const SCOPED_US_STATE = {
    since: '14d' as const,
    notable: false,
    speciesCode: null as string | null,
    familyCode: null as string | null,
    view: 'map' as const,
    scope: { kind: 'us' as const } as
      | { kind: 'unscoped' }
      | { kind: 'us' }
      | { kind: 'state'; stateCode: string },
  };

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue({ data: [], meta: { freshestObservationAt: null } });
    // Return a non-empty silhouettes list so the FamilyLegend gate passes
    // (mapVisible && scopeActive && silhouettes.length > 0) and the mock renders.
    mockGetSilhouettes.mockResolvedValue([{
      familyCode: 'tyrannidae',
      color: '#C77A2E',
      colorDark: '#C77A2E',
      svgData: 'M0 0L1 1Z',
      svgUrl: null,
      source: 'placeholder',
      license: 'CC0',
      commonName: 'Tyrant Flycatchers',
      creator: null,
    }]);
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    overlayRenderCounts.familyLegend = 0;
    overlayRenderCounts.scopeControl = 0;
    mockUrlState.state = SCOPED_US_STATE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
  });

  it('nowTick bump (visibilitychange→visible) does NOT increment FamilyLegend render-body counter', async () => {
    /**
     * App re-renders on nowTick (visibilitychange → setNowTick). FamilyLegend's
     * props (silhouettes, observations, familyCode, onFamilyToggle, etc.) don't
     * change on a tick bump → the mock's memo bails → the counting wrapper's body
     * never runs → overlayRenderCounts.familyLegend is unchanged.
     *
     * MUTATION PROOF: if the production memo is removed, the vi.mock's structural
     * guard ($$typeof check) substitutes a throwing component → this test FAILS.
     * If additionally the mock's own memo is removed, the counter body runs on
     * every App re-render → count increases → this assertion FAILS.
     */
    render(<App />);

    // Wait for data load so FamilyLegend's gate passes and the mock has rendered.
    await waitFor(() => {
      expect(overlayRenderCounts.familyLegend).toBeGreaterThan(0);
    });

    const countAfterMount = overlayRenderCounts.familyLegend;

    // Simulate a nowTick bump — the same signal App wires on visibilitychange.
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Mock's memo short-circuits: props unchanged → body doesn't run → 0 extra.
    expect(overlayRenderCounts.familyLegend).toBe(countAfterMount);
  });

  it('nowTick bump (visibilitychange→visible) does NOT increment ScopeControl render-body counter', async () => {
    render(<App />);

    // ScopeControl renders inside AppHeader on a scoped view.
    await waitFor(() => {
      expect(overlayRenderCounts.scopeControl).toBeGreaterThan(0);
    });

    const countAfterMount = overlayRenderCounts.scopeControl;

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(overlayRenderCounts.scopeControl).toBe(countAfterMount);
  });

  it('theme toggle does not produce an unbounded render cascade (ScopeControl: at most 1 extra render per toggle)', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<App />);

    await waitFor(() => {
      expect(overlayRenderCounts.scopeControl).toBeGreaterThan(0);
    });

    const countAfterMount = overlayRenderCounts.scopeControl;

    // Flip [data-theme]: triggers AppHeader to re-render (freshness reads theme
    // indirectly), but ScopeControl's direct props (scope/states/callbacks) are
    // unchanged → mock's memo should hold.
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    // Assert at most 1 additional render — any more indicates the memo is broken.
    expect(overlayRenderCounts.scopeControl - countAfterMount).toBeLessThanOrEqual(1);
  });

  it('theme toggle does not produce an unbounded render cascade (FamilyLegend: at most 1 extra render per toggle)', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<App />);

    await waitFor(() => {
      expect(overlayRenderCounts.familyLegend).toBeGreaterThan(0);
    });

    const countAfterMount = overlayRenderCounts.familyLegend;

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    expect(overlayRenderCounts.familyLegend - countAfterMount).toBeLessThanOrEqual(1);
  });
});

// #828 — Lede dedupe: the AppHeader identity card's lede drops the region and
// the time-window from every template (the region is now the wordmark headline;
// the window is discoverable only via Filters). The producer is the `ledeText`
// useMemo in App.tsx; these tests drive the 5 variants end-to-end through the
// real AppHeader (MapSurface is stubbed, AppHeader is not) and assert the
// count-only copy from the issue's table — plus that the old "seen across
// {region} … in the last {period}." strings are gone (the #741 copy-lockstep
// contract). The cold-load suppression (#716) is unchanged and still covered by
// the map-cold-load e2e + the L2 suite above.
describe('#828: lede dedupe — count-only copy, no region, no time-window', () => {
  const STATES = [
    { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.82, 31.33, -109.05, 37.0] as [number, number, number, number] },
    { stateCode: 'US-CA', name: 'California', bbox: [-124.41, 32.53, -114.13, 42.01] as [number, number, number, number] },
  ];

  function obs(overrides: Partial<{ speciesCode: string; comName: string; familyCode: string | null }> = {}) {
    return {
      subId: `S-${Math.random().toString(36).slice(2)}`,
      speciesCode: overrides.speciesCode ?? 'vermfly',
      comName: overrides.comName ?? 'Vermilion Flycatcher',
      lat: 32.2,
      lng: -110.9,
      obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      locId: 'L1',
      locName: 'Tucson',
      howMany: 1,
      isNotable: false,
      silhouetteId: null,
      familyCode: overrides.familyCode ?? null,
    };
  }

  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
    mockGetStates.mockResolvedValue(STATES);
    mockGetSpeciesDictionary.mockResolvedValue([]); // #1175: seeded per-test below
    mockUrlState.set.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // #1175: restoreAllMocks does NOT reset a plain vi.fn(), so a per-test dict
    // seed here would otherwise persist into later describe blocks that don't
    // re-seed it. Restore the empty default so no seed bleeds across suites.
    mockGetSpeciesDictionary.mockResolvedValue([]);
  });

  it('Default (T4): "{N} sightings" — no region, no window', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [obs({ speciesCode: 'vermfly' }), obs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker' })],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    // #1047: lede always reports sightings regardless of aggregation mode.
    expect(lede).toHaveTextContent('2 sightings');
    expect(lede).not.toHaveTextContent(/species/i);
    expect(lede).not.toHaveTextContent(/seen across/i);
    expect(lede).not.toHaveTextContent(/Arizona/i);
    expect(lede).not.toHaveTextContent(/in the last/i);
  });

  // #852 — Aggregated (low-zoom / whole-state) mode must NOT report a species
  // count. At zoom < 6 the API returns coarse-grid buckets with no per-species
  // code; use-bird-data fabricates synthetic `agg-{bi}-…` codes PREFIXED by the
  // bucket index, so the SAME species spanning N cells yields N distinct codes
  // and `new Set(speciesCode).size` counts BUCKETS, not species — the live
  // "AZ 4257 species" overcount. The fix (option b): in aggregated mode the lede
  // reports the total SIGHTINGS count (sum of bucket.count = observations.length,
  // which IS correctly computable) instead of the inflated species count. The
  // per-observation-mode "{N} species" lede (T4 above) is unchanged.
  it('Aggregated mode (T4): reports total sightings, never the inflated species count', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // Three cells, each holding the SAME single species (1 distinct species
    // total across the region). The aggregated lede reports total SIGHTINGS
    // (sum of bucket.count = 50 + 50 + 50 = 150) — the wire (#859) carries no
    // distinct-species set, so a species count is intentionally not shown.
    const pic = (count: number) => ({
      code: 'picidae', count, speciesCount: 1,
      species: [{ code: 'gilwoo', count }],
    });
    mockGetObservations.mockResolvedValue({
      mode: 'aggregated',
      buckets: [
        { lat: 32.2, lng: -110.9, count: 50, speciesCount: 1, families: [pic(50)] },
        { lat: 33.4, lng: -111.9, count: 50, speciesCount: 1, families: [pic(50)] },
        { lat: 34.5, lng: -112.4, count: 50, speciesCount: 1, families: [pic(50)] },
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    // The correct, computable count is sightings — not species.
    expect(lede).toHaveTextContent('150 sightings');
    // The bug: never report a species count in aggregated mode (3 would be the
    // bucket-count overcount; any "{N} species" copy is wrong here).
    expect(lede).not.toHaveTextContent(/species/i);
  });

  // #1047 — cross-mode invariance: the SAME scope in per-observation mode must
  // also report sightings, not species, so both modes carry the same label.
  it('#1047: per-observation mode reports "N sightings" (same label as aggregated mode)', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // Per-observation payload — data array, no buckets (mode = 'per-observation').
    mockGetObservations.mockResolvedValue({
      data: [
        obs({ speciesCode: 'vermfly' }),
        obs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker' }),
        obs({ speciesCode: 'vermfly' }),
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    // 3 observations → "3 sightings"; the "species" label must never appear.
    expect(lede).toHaveTextContent('3 sightings');
    expect(lede).not.toHaveTextContent(/species/i);
  });

  it('Family filter (T3): "{N} sightings of {familyName}" — no region, no window', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: 'picidae',
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      // Two DISTINCT species in the same family so speciesCount > 1 → the lede
      // takes the family-filter branch (the single-species branch only fires at
      // speciesCount === 1 with a resolvable common name).
      data: [
        obs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker', familyCode: 'picidae' }),
        obs({ speciesCode: 'ladwoo', comName: 'Ladder-backed Woodpecker', familyCode: 'picidae' }),
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    // #1047: family-filter branch now reports sightings count, not species count.
    // familyName is resolved from the family taxonomy; the exact label is owned by
    // the family-name lookup; assert count + "sightings of" shape.
    expect(lede).toHaveTextContent(/^2 sightings of .+$/);
    expect(lede).not.toHaveTextContent(/species/i);
    expect(lede).not.toHaveTextContent(/seen across/i);
    expect(lede).not.toHaveTextContent(/Arizona/i);
    expect(lede).not.toHaveTextContent(/in the last/i);
  });

  // #1175: in AGGREGATED mode there are no per-observation rows, so the species
  // name cannot come from `observations[0].comName`. With an active species
  // filter the lede must still name it, resolved from the SEEDED dictionary.
  // (The dictionary is seeded here precisely so this asserts the FIX path — a
  // cold dictionary would fall through and silently assert the bare-count path.)
  it('Aggregated mode + active species filter (T2, #1175): names the filtered species from the dictionary', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: 'norcar', familyCode: null,
      view: 'map', scope: { kind: 'us' },
    };
    mockGetSpeciesDictionary.mockResolvedValue([
      { code: 'norcar', comName: 'Northern Cardinal', familyCode: 'cardinalidae' },
    ]);
    mockGetObservations.mockResolvedValue({
      mode: 'aggregated',
      buckets: [
        {
          lat: 38.0, lng: -97.0, count: 1823, speciesCount: 1,
          families: [{
            code: 'cardinalidae', count: 1823, speciesCount: 1,
            species: [{ code: 'norcar', count: 1823 }],
          }],
        },
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    await waitFor(() =>
      expect(lede).toHaveTextContent('1,823 sightings of Northern Cardinal'),
    );
    // The fix names the active FILTER, not a distinct-species COUNT (#1047).
    expect(lede).not.toHaveTextContent(/species/i);
  });

  it('Single species (T2): "{N} sightings of {commonName}" — no region, no window', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: 'wesblu', familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [
        obs({ speciesCode: 'wesblu', comName: 'Western Bluebird' }),
        obs({ speciesCode: 'wesblu', comName: 'Western Bluebird' }),
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    expect(lede).toHaveTextContent('2 sightings of Western Bluebird');
    expect(lede).not.toHaveTextContent(/ in (Arizona|USA)/i);
    expect(lede).not.toHaveTextContent(/in the last/i);
  });

  it('Sparse region: "No recent sightings" — no region name', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [],
      meta: { freshestObservationAt: null },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    expect(lede).toHaveTextContent('No recent sightings');
    expect(lede).not.toHaveTextContent(/Arizona/i);
    expect(lede).not.toHaveTextContent(/yet/i);
  });

  it('Filtered to empty: "No matches for these filters"', async () => {
    mockUrlState.state = {
      // A narrowing filter is active (notable) so an empty result is the
      // filter-narrowing branch, not the sparse-region branch.
      since: '14d', notable: true, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [],
      meta: { freshestObservationAt: null },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    expect(lede).toHaveTextContent('No matches for these filters');
    expect(lede).not.toHaveTextContent(/your current filters/i);
  });

  // #1283 follow-up (bot IMPORTANT): the "filter active → count the viewport"
  // rule must cover EVERY filter dimension, not just family/species. The lede's
  // `filterActive` is now the negation of the canonical `noFiltersActive`
  // predicate, so a NOTABLE-only filter (no family/species, no non-default since)
  // counts the viewport too. Regression: two per-observation rows, one inside the
  // settled viewport and one outside it, with `notable: true` and no
  // family/species. After the viewport settles to exclude the outside row, the
  // lede must report the IN-VIEW count (1), not the regional total (2) — matching
  // the legend/markers, which are already viewport-clipped. With the pre-fix
  // family/species-only predicate, `filterActive` was false here and the lede
  // showed the regional "2 sightings" while only one marker was on screen.
  it('Notable-only filter counts the VIEWPORT, not the regional total (#1283 widening)', async () => {
    mockUrlState.state = {
      since: '14d', notable: true, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // Two notable rows at DISTINCT coordinates: one in interior AZ (in view), one
    // far west (clipped out by the settled viewport below).
    const inView = {
      ...obs({ speciesCode: 'vermfly' }), subId: 'S-in', lat: 33.0, lng: -111.0,
      isNotable: true,
    };
    const outOfView = {
      ...obs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker' }),
      subId: 'S-out', lat: 33.0, lng: -120.0, isNotable: true,
    };
    mockGetObservations.mockResolvedValue({
      data: [inView, outOfView],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);

    // Before the viewport settles, viewportBounds is null → both rows count
    // (regional fallback); the lede reads the full "2 sightings".
    const lede = await screen.findByTestId('map-lede');
    await waitFor(() => expect(lede).toHaveTextContent('2 sightings'));
    await waitFor(() => expect(mapSurfaceRef.onViewportChange).not.toBeNull());

    // Settle a viewport that contains the interior-AZ row but excludes the far-west
    // one. `filterObservationsByBounds` keys off `bounds.contains([lng,lat])`, so a
    // duck-typed bounds with that method drives the clip.
    const viewport = {
      contains: ([lng, lat]: [number, number]) =>
        lng >= -114 && lng <= -109 && lat >= 31 && lat <= 37,
    } as unknown as LngLatBounds;
    await act(async () => {
      mapSurfaceRef.onViewportChange!(viewport, 7);
    });

    // The widened predicate now counts only the in-view row → "1 sighting".
    await waitFor(() => expect(lede).toHaveTextContent(/\b1 sightings?\b/));
    expect(lede).not.toHaveTextContent('2 sightings');
  });

  it('drops the period clause entirely even when freshness would have been non-stale', async () => {
    // Pre-#828, a fresh (non-stale) load appended " in the last 14 days." Now the
    // clause is gone unconditionally. Use a very-fresh timestamp (would have been
    // the period-clause-present branch) and assert no window text leaks.
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    mockGetObservations.mockResolvedValue({
      data: [obs({ speciesCode: 'vermfly' })],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    expect(lede).not.toHaveTextContent(/in the last/i);
    expect(lede).not.toHaveTextContent(/14 days/i);
  });

  // #872 — state→state stale-count guard. On a state→state scope change,
  // use-bird-data keeps the PRIOR state's `observations` mounted while the new
  // fetch is in flight (it only clears on resolve), so `observationCount` is
  // NONZERO during the load. The cold-load guard (`:1003`) only fires at
  // `observationCount === 0`, so it misses this case and the lede would show
  // the stale prior count. The fix: a placeholder branch keyed on
  // `observationsLoading` alone — the lede must NOT show the stale number while
  // a refetch is in flight, even when the carried-over count is nonzero.
  it('#872: shows a loading placeholder (not the stale count) during a state→state refetch', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // First state resolves a NONZERO species count.
    mockGetObservations.mockResolvedValue({
      data: [
        obs({ speciesCode: 'vermfly' }),
        obs({ speciesCode: 'gilwoo', comName: 'Gila Woodpecker' }),
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    const { rerender } = render(<App />);
    const lede = await screen.findByTestId('map-lede');
    // #1047: default template now reports sightings, not species count.
    expect(lede).toHaveTextContent('2 sightings');

    // Transition to a new state whose observations fetch never resolves —
    // observationsLoading flips true while the prior (nonzero) observations are
    // still mounted. This is the exact state→state window #872 describes.
    mockGetObservations.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null,
        view: 'map', scope: { kind: 'state', stateCode: 'US-CA' },
      };
      rerender(<App />);
    });

    // The lede must NOT show the stale prior count while the new fetch loads.
    await waitFor(() => {
      const ledeNow = screen.queryByTestId('map-lede');
      // Either the row is gone OR it shows a count-free placeholder — never the
      // stale "2 sightings".
      if (ledeNow) {
        expect(ledeNow).not.toHaveTextContent(/\d+\s+species/i);
        expect(ledeNow).not.toHaveTextContent(/\d+\s+sightings/i);
      }
    });
  });

  // C1 #1045: lede must render thousands separators for counts ≥1000.
  it('C1 #1045: lede uses thousands separator for sightings count ≥1000', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null,
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // Aggregated mode: 4 buckets × 500 = 2000 total sightings → "2,000 sightings"
    const pic = (count: number) => ({
      code: 'picidae', count, speciesCount: 1,
      species: [{ code: 'gilwoo', count }],
    });
    mockGetObservations.mockResolvedValue({
      mode: 'aggregated',
      buckets: [
        { lat: 32.2, lng: -110.9, count: 500, speciesCount: 1, families: [pic(500)] },
        { lat: 33.4, lng: -111.9, count: 500, speciesCount: 1, families: [pic(500)] },
        { lat: 34.5, lng: -112.4, count: 500, speciesCount: 1, families: [pic(500)] },
        { lat: 35.0, lng: -113.0, count: 500, speciesCount: 1, families: [pic(500)] },
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });
    render(<App />);
    const lede = await screen.findByTestId('map-lede');
    expect(lede).toHaveTextContent('2,000 sightings');
  });
});

// D2 (#1050) C79: filter option lists must NOT self-narrow to the filtered
// result. Family options derive from the STABLE silhouettes catalogue
// (`useSilhouettes`), not from the active fetch — so a family→family direct
// switch works without first resetting to "All families".
describe('D2 (#1050) C79: Family select lists the full family universe under an active filter', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    __resetSpeciesDictionaryCache();
    __resetStatesCache();
    __resetZipIndexCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetStates.mockResolvedValue([]);
    mapSurfaceRef.renderCount = 0;
    // The silhouettes catalogue is the stable family universe. It carries
    // MULTIPLE families even when the active fetch (familyCode=tyrannidae) has
    // been narrowed to one. familyCode keys are lowercase (#921) — the option
    // `value` must match the lowercase family code the URL carries.
    mockGetSilhouettes.mockResolvedValue([
      {
        familyCode: 'tyrannidae', color: '#C77A2E', colorDark: '#C77A2E',
        svgData: 'M0 0L1 1Z', svgUrl: null, source: 'placeholder', license: 'CC0',
        commonName: 'Tyrant Flycatchers', creator: null,
      },
      {
        familyCode: 'accipitridae', color: '#3E7CB1', colorDark: '#3E7CB1',
        svgData: 'M0 0L1 1Z', svgUrl: null, source: 'placeholder', license: 'CC0',
        commonName: 'Hawks, Eagles & Kites', creator: null,
      },
      {
        familyCode: 'corvidae', color: '#5A6B7B', colorDark: '#5A6B7B',
        svgData: 'M0 0L1 1Z', svgUrl: null, source: 'placeholder', license: 'CC0',
        commonName: 'Crows & Jays', creator: null,
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Family select still lists the full family universe with a familyCode active', async () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: 'tyrannidae',
      view: 'map', scope: { kind: 'state', stateCode: 'US-AZ' },
    };
    // The narrowed fetch carries ONLY the active family's rows (what the live
    // server returns under `familyCode=tyrannidae`). Pre-fix, the select
    // derived from THIS and collapsed to tyrannidae + "All families".
    mockGetObservations.mockResolvedValue({
      data: [
        {
          subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
          lat: 32.2, lng: -110.9, obsDt: new Date().toISOString(), locId: 'L1',
          locName: 'Tucson', howMany: 1, isNotable: false,
          silhouetteId: 'tyrannidae', familyCode: 'tyrannidae', taxonOrder: 4400,
        },
      ],
      meta: { freshestObservationAt: new Date().toISOString() },
    });

    render(<App />);
    await screen.findByRole('banner');
    await userEvent.click(screen.getByRole('button', { name: /Filters/i }));
    const familySelect = screen.getByLabelText('Family') as HTMLSelectElement;

    // The full catalogue universe is listed — NOT collapsed to the active family.
    // "All families" + 3 catalogue families = 4 options.
    const optionValues = within(familySelect)
      .getAllByRole('option')
      .map(o => (o as HTMLOptionElement).value);
    expect(optionValues).toContain('');           // "All families"
    expect(optionValues).toContain('tyrannidae'); // active family (lowercase)
    expect(optionValues).toContain('accipitridae'); // a DIFFERENT family to switch to
    expect(optionValues).toContain('corvidae');

    // The active family is the selected value — its lowercase option value must
    // match the URL's lowercase familyCode (reviewer addendum: a casing mismatch
    // would silently de-select the active family).
    expect(familySelect.value).toBe('tyrannidae');

    // A direct family→family switch works without first resetting to "All families".
    await userEvent.selectOptions(familySelect, 'accipitridae');
    expect(mockUrlState.set).toHaveBeenCalledWith(
      expect.objectContaining({ familyCode: 'accipitridae' }),
    );
  });
});
