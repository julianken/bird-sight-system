import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
    mockGetObservations.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a friendly message, not the raw error body', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Something went wrong — please try again')).toBeInTheDocument();
    });
    // Raw body must NOT appear in the DOM
    expect(screen.queryByText(/pool exhausted/)).toBeNull();
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
    mockGetObservations.mockResolvedValue([]);
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

describe('App persistent footer (issue #250)', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
    mockGetHotspots.mockResolvedValue([]);
    mockGetObservations.mockResolvedValue([]);
    mockGetSilhouettes.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The persistent app-level footer must (a) carry role="contentinfo",
  // (b) sit AFTER <main> in the DOM (axe landmark order banner→main→
  // contentinfo), and (c) host the AttributionModal Credits trigger
  // reachable from every view.
  it.each(['feed', 'species', 'map', 'detail'] as const)(
    'renders a contentinfo footer with a Credits button on view=%s',
    async view => {
      mockUrlState.state = {
        since: '14d', notable: false, speciesCode: null, familyCode: null, view,
      };
      const { container } = render(<App />);
      const footer = container.querySelector('footer.app-footer');
      expect(footer).not.toBeNull();
      expect(footer?.getAttribute('role')).toBe('contentinfo');
      // Credits button is inside the footer.
      const credits = screen.getByRole('button', { name: /credits/i });
      expect(footer?.contains(credits)).toBe(true);
    },
  );

  it('renders the footer as the LAST child of .app, after <main>', () => {
    mockUrlState.state = {
      since: '14d', notable: false, speciesCode: null, familyCode: null, view: 'feed',
    };
    const { container } = render(<App />);
    const app = container.querySelector('.app');
    expect(app).not.toBeNull();
    const last = app?.lastElementChild;
    expect(last?.tagName).toBe('FOOTER');
    expect(last?.classList.contains('app-footer')).toBe(true);
    // <main> must precede the footer (banner→main→contentinfo order).
    const main = container.querySelector('main#main-surface');
    expect(main).not.toBeNull();
    const position = main!.compareDocumentPosition(last!);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
