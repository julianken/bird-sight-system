import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta, FamilySilhouette } from '@bird-watch/shared-types';
import { __resetSilhouettesCache } from '../data/use-silhouettes.js';
import { analytics } from '../analytics.js';

// Mock posthog-js so no network call escapes the test environment, even
// if a future contributor sets `VITE_POSTHOG_KEY` in their local .env.
// Tests run with the env unset by default — `analytics` is the no-op stub
// from analytics.ts — so the assertions below spy directly on the stub's
// `capture` method.  Keeping `vi.mock('posthog-js')` matches the explicit
// guidance in issue #357 task 6.
vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
  },
}));

const VERMFLY: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

const VERMFLY_WITH_PHOTO: SpeciesMeta = {
  ...VERMFLY,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Smith',
  photoLicense: 'CC-BY-4.0',
};

const TYRANNIDAE_SILHOUETTE: FamilySilhouette = {
  familyCode: 'tyrannidae',
  color: '#C77A2E',
  svgData: 'M0 0L1 1Z',
  source: 'https://www.phylopic.org/i/x',
  license: 'CC-BY-3.0',
  commonName: 'Tyrant Flycatchers',
  creator: 'Test Creator',
};

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('SpeciesDetailSurface', () => {
  beforeEach(() => {
    __resetSilhouettesCache();
  });

  it('renders common, scientific, and family names when data resolves', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    const sci = screen.getByText('Pyrocephalus rubinus');
    expect(sci.tagName).toBe('EM');
    expect(screen.getByText('Tyrant Flycatchers')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    const client = makeClient({
      getSpecies: vi.fn().mockReturnValue(new Promise(() => {})),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    expect(screen.getByText('Loading species details…')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockRejectedValue(new Error('boom')),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByText('Could not load species details')).toBeInTheDocument()
    );
  });

  // eBird API ToU §3 attribution moved to the app-level AttributionModal
  // (#250) and is reachable from every view via the persistent footer in
  // App.tsx. SpeciesDetailSurface no longer carries a per-surface footer
  // — the loaded/loading/error footer assertions that lived here are now
  // covered by AttributionModal unit tests + the e2e attribution-modal spec.

  it('renders in-flow (no role=complementary, no close button)', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // No complementary landmark — this is an in-flow surface, not a sidebar.
    expect(screen.queryByRole('complementary')).toBeNull();
    // No close button — user navigates away via back button or SurfaceNav.
    expect(screen.queryByRole('button', { name: 'Close species details' })).toBeNull();
  });

  // ─── Photo rendering (issue #327 task-10) ─────────────────────────────
  //
  // The Read API LEFT-JOINs species_photos onto /api/species/:code (task-9)
  // and projects optional photoUrl/photoAttribution/photoLicense fields onto
  // SpeciesMeta. Frontend renders a <img> for the photo when present and
  // falls back to the existing Phylopic silhouette path on absence OR on
  // image-load error. Behavioral spec verbatim from issue #327 task-10.

  it('renders <img src={photoUrl} alt="X photo"> when photoUrl is present', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const photo = await screen.findByAltText('Vermilion Flycatcher photo');
    expect(photo.tagName).toBe('IMG');
    expect(photo).toHaveAttribute('src', 'https://photos.bird-maps.com/vermfly.jpg');
  });

  it('does not render the photo img when photoUrl is undefined/null', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // No photo img — the silhouette is the only visual.
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    // Silhouette fallback IS rendered (SVG with the family color).
    const silhouette = screen.getByTestId('species-detail-silhouette');
    expect(silhouette).toBeInTheDocument();
  });

  it('onError on the photo img triggers fallback to silhouette', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const photo = await screen.findByAltText('Vermilion Flycatcher photo');
    // Silhouette is NOT rendered while the photo img is in the tree.
    expect(screen.queryByTestId('species-detail-silhouette')).toBeNull();
    // Simulate an image-load failure (404, ECONNRESET, etc.).
    fireEvent.error(photo);
    // Photo img is gone; silhouette fallback is now visible.
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    expect(screen.getByTestId('species-detail-silhouette')).toBeInTheDocument();
  });

  it('alt text uses {comName} photo format for accessibility', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY_WITH_PHOTO,
        comName: 'Anna’s Hummingbird',
        speciesCode: 'annhum',
        photoUrl: 'https://photos.bird-maps.com/annhum.jpg',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="annhum" apiClient={client} />);
    const photo = await screen.findByAltText('Anna’s Hummingbird photo');
    expect(photo.tagName).toBe('IMG');
  });

  // ─── Phenology chart (issue #356) ──────────────────────────────────────
  //
  // PhenologyChart mounts inside the `data &&` block so it only attempts a
  // /phenology fetch once the species itself has resolved. The chart
  // component handles its own loading/error/empty states; the surface just
  // mounts it.

  it('mounts PhenologyChart inside the data block when species resolves', async () => {
    const phenology = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: i + 1 }));
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      getPhenology: vi.fn().mockResolvedValue(phenology),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    await waitFor(() => {
      expect(container.querySelector('svg.phenology-chart')).not.toBeNull();
    });
  });

  it('does not mount PhenologyChart while species is still loading', () => {
    const getPhenology = vi.fn();
    const client = makeClient({
      // Pending species fetch — PhenologyChart should NOT have mounted yet.
      getSpecies: vi.fn().mockReturnValue(new Promise(() => {})),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      getPhenology,
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    // Loading state is visible.
    expect(screen.getByText('Loading species details…')).toBeInTheDocument();
    // PhenologyChart never made the call because it never mounted.
    expect(getPhenology).not.toHaveBeenCalled();
  });

  // ─── Analytics instrumentation (issue #357 tasks 3, 4) ─────────────────
  //
  // The detail surface fires three PostHog events once per active species:
  //
  //   - `panel_opened` on mount (after the species detail resolves).
  //   - `panel_dwell_ms` on unmount with `dwell_ms = Date.now() - t0`.
  //   - `panel_scrolled_to_bottom` on first IntersectionObserver hit on
  //     the bottom sentinel.
  //
  // Tests run with `VITE_POSTHOG_KEY` unset, so `analytics` is the no-op
  // stub from `analytics.ts` (posthog.init is never called — that's the
  // load-bearing CI-cleanliness guarantee).  We spy on `analytics.capture`
  // directly to verify the events fire with the right payload.

  describe('analytics instrumentation', () => {
    it('fires panel_opened on mount with species_code', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', { species_code: 'vermfly' });
      captureSpy.mockRestore();
    });

    it('fires panel_dwell_ms on unmount with species_code and a numeric dwell_ms', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      const { unmount } = render(
        <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      // panel_opened fired on mount; clear so we isolate the unmount call.
      captureSpy.mockClear();
      unmount();
      expect(captureSpy).toHaveBeenCalledWith(
        'panel_dwell_ms',
        expect.objectContaining({
          species_code: 'vermfly',
          dwell_ms: expect.any(Number),
        }),
      );
      captureSpy.mockRestore();
    });

    it('does NOT fire panel_opened before species data resolves', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      // getSpecies never resolves — the effect's `if (!data?.speciesCode) return`
      // guard means `panel_opened` should not fire while the surface is still
      // in its loading state.
      const client = makeClient({
        getSpecies: vi.fn().mockReturnValue(new Promise(() => {})),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      expect(screen.getByText('Loading species details…')).toBeInTheDocument();
      // Check synchronously after mount — no event should have fired.
      const calls = captureSpy.mock.calls.filter(([name]) => name === 'panel_opened');
      expect(calls).toHaveLength(0);
      captureSpy.mockRestore();
    });

    it('renders the bottom sentinel inside .species-detail-body', async () => {
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      const sentinel = await screen.findByTestId('phenology-bottom-sentinel');
      expect(sentinel).toBeInTheDocument();
      // aria-hidden so SR users don't perceive an empty element at the end.
      expect(sentinel).toHaveAttribute('aria-hidden', 'true');
      // Must live inside the body so it scrolls with the panel content.
      const body = sentinel.closest('.species-detail-body');
      expect(body).not.toBeNull();
    });

    it('fires panel_scrolled_to_bottom on first sentinel intersection then disconnects', async () => {
      // Capture the IntersectionObserver instances and the callbacks the
      // component registers.  jsdom does not implement IntersectionObserver,
      // so we install a controllable mock that records each callback for
      // manual triggering — same pattern any IO-driven test in the codebase
      // would use.
      type IOInstance = {
        callback: IntersectionObserverCallback;
        observe: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        unobserve: ReturnType<typeof vi.fn>;
        takeRecords: ReturnType<typeof vi.fn>;
      };
      const observers: IOInstance[] = [];
      // Class form is required because the component uses `new IntersectionObserver(...)`
      // — vi.fn().mockImplementation(...) returns a function that's not callable
      // with `new`.  A real class wins.
      class IOMock {
        callback: IntersectionObserverCallback;
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback;
          observers.push(this as unknown as IOInstance);
        }
      }
      const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
      (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = IOMock;

      try {
        const captureSpy = vi.spyOn(analytics, 'capture');
        const client = makeClient({
          getSpecies: vi.fn().mockResolvedValue(VERMFLY),
          getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
        } as unknown as Partial<ApiClient>);
        render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
        const sentinel = await screen.findByTestId('phenology-bottom-sentinel');
        expect(observers.length).toBeGreaterThan(0);
        // Find the observer that was wired to the sentinel — the component
        // calls observer.observe(sentinelRef.current) once.
        const wired = observers.find(o => o.observe.mock.calls.some(call => call[0] === sentinel));
        expect(wired).toBeDefined();
        // Trigger the first intersection.  The component should fire
        // `panel_scrolled_to_bottom` once and then disconnect to prevent
        // future re-fires.
        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        expect(captureSpy).toHaveBeenCalledWith('panel_scrolled_to_bottom', {
          species_code: 'vermfly',
        });
        expect(wired!.disconnect).toHaveBeenCalled();

        // Second intersection must NOT re-fire — the observer is already
        // disconnected, but defensively assert the binary-only contract
        // (issue #357 task 4: no 25/50/75 thresholds).
        captureSpy.mockClear();
        act(() => {
          wired!.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            wired as unknown as IntersectionObserver,
          );
        });
        const reFires = captureSpy.mock.calls.filter(([name]) => name === 'panel_scrolled_to_bottom');
        expect(reFires).toHaveLength(0);
        captureSpy.mockRestore();
      } finally {
        if (originalIO === undefined) {
          delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
        } else {
          (globalThis as { IntersectionObserver: unknown }).IntersectionObserver = originalIO;
        }
      }
    });
  });
});
