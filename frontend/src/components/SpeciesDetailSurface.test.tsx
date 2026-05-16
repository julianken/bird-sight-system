import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta, FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { __resetSilhouettesCache } from '../data/use-silhouettes.js';
import { __resetSpeciesDetailCache } from '../data/use-species-detail.js';
import { analytics } from '../analytics.js';
import { FAMILY_COLOR_FALLBACK } from '../data/family-color.js';
import type { BBox } from '../state/url-state.js';

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
  // 'songbird' is a valid FamilyCode — required because Phase 4 routes
  // familyCode through <Photo> → <FamilySilhouette> → getFamilyChannel()
  // which only accepts the 7 predefined FamilyCode literals. 'tyrannidae'
  // was valid only for the pre-Phase-4 lookup path.
  familyCode: 'songbird',
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
  familyCode: 'songbird',
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
    // Reset the module-level species detail cache so one test's resolved
    // species data cannot bleed into the next test's assertions.
    __resetSpeciesDetailCache();
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
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // No photo img — the silhouette is the only visual.
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    // Phase 4: <Photo src={null}> renders <FamilySilhouette> as a
    // .family-silhouette span (no longer the old data-testid pattern
    // from SpeciesDetailVisual — FamilySilhouette carries no testid).
    expect(container.querySelector('.family-silhouette')).not.toBeNull();
  });

  it('onError on the photo img triggers fallback to silhouette', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const photo = await screen.findByAltText('Vermilion Flycatcher photo');
    // Phase 4: silhouette is NOT rendered while the photo img is shown.
    // <Photo> uses photo--silhouette class only in the silhouette state.
    expect(container.querySelector('.photo--silhouette')).toBeNull();
    // Simulate an image-load failure (404, ECONNRESET, etc.).
    fireEvent.error(photo);
    // Photo img is gone; silhouette fallback is now visible.
    // <Photo> unmounts <img> and shows <FamilySilhouette> (via .family-silhouette).
    expect(screen.queryByAltText('Vermilion Flycatcher photo')).toBeNull();
    expect(container.querySelector('.family-silhouette')).not.toBeNull();
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

  // ─── Species description mount (issue #373 / epic #368) ──────────────
  //
  // SpeciesDescription renders the per-species Wikipedia summary HTML when
  // SpeciesMeta carries a non-null `descriptionBody`. The component
  // returns `null` when the field is absent so the surface gracefully
  // degrades on CDN-stale responses predating the field.
  //
  // The mount sits BETWEEN PhenologyChart and the bottom-sentinel — the
  // sentinel must remain the LAST child of `.species-detail-body` for the
  // IntersectionObserver to fire only after the user scrolls past every
  // descendant content node.

  it('mounts SpeciesDescription when descriptionBody is present and the credit links to the article', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY,
        descriptionBody: '<p>The <em>Vermilion Flycatcher</em> is small and red.</p>',
        descriptionLicense: 'CC-BY-SA-3.0',
        descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    const section = await waitFor(() => {
      const node = container.querySelector('section.species-detail-description');
      if (!node) throw new Error('species-detail-description not yet rendered');
      return node;
    });
    expect(section).toBeInTheDocument();
    // The injected HTML rendered as DOM (not encoded as text).
    const em = section.querySelector('em');
    expect(em?.textContent).toBe('Vermilion Flycatcher');
    // Inline credit anchor: href + target + rel.
    const link = section.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(
      'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    );
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not mount SpeciesDescription when descriptionBody is absent', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
    );
    expect(container.querySelector('section.species-detail-description')).toBeNull();
  });

  it('keeps the bottom sentinel as the LAST child of .species-detail-body when description renders', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue({
        ...VERMFLY,
        descriptionBody: '<p>Body.</p>',
        descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/X',
      }),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const sentinel = await screen.findByTestId('phenology-bottom-sentinel');
    const body = sentinel.closest('.species-detail-body');
    expect(body).not.toBeNull();
    // The IntersectionObserver fires on FIRST intersection then disconnects.
    // For that to mean "scrolled past everything" the sentinel must remain
    // the final child of the body container regardless of which optional
    // sub-components mount above it.
    expect(body!.lastElementChild).toBe(sentinel);
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

  // ─── Phase 4 heading + Photo contracts ──────────────────────────────────
  //
  // Sky Atlas Phase 4 promotes SpeciesDetailSurface to a presentational body
  // component consumed by SpeciesDetailModal (desktop) and SpeciesDetailSheet
  // (mobile). The heading becomes <h1 id="detail-title" tabIndex={-1}> so
  // the modal/sheet wrappers can set aria-labelledby="detail-title" and
  // call #detail-title.focus() on open. The photo masthead uses <Photo
  // priority={true}> so LCP is served by loading="eager" fetchpriority="high".

  it('renders species name as <h1 id="detail-title" tabIndex={-1}>', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const heading = await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    expect(heading).toHaveAttribute('id', 'detail-title');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('renders <Photo priority> masthead when photoUrl is present', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    const img = await screen.findByAltText(/vermilion flycatcher photo/i);
    // <Photo priority={true}> must produce loading="eager" and fetchpriority="high"
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('falls back to <FamilySilhouette> via <Photo> when photoUrl is null', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    // <Photo src={null}> renders <FamilySilhouette> internally, which
    // emits a .family-silhouette span (no data-testid — Phase 2 component).
    await waitFor(() =>
      expect(container.querySelector('.family-silhouette')).not.toBeNull()
    );
  });

  it('masthead silhouette carries family DB color (not grey) when photoUrl is null and silhouettes resolve', async () => {
    // Bot finding on #480: Photo.color was added but SpeciesDetailSurface never
    // resolved or forwarded it. When data.photoUrl is null the silhouette must
    // render in the family's DB color, not the FAMILY_COLOR_FALLBACK grey.
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
    } as unknown as Partial<ApiClient>);
    const { container } = render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    // Wait for the silhouette to render (data and silhouettes must both resolve).
    const silhouetteEl = await waitFor(() => {
      const el = container.querySelector('.family-silhouette') as HTMLElement | null;
      if (!el) throw new Error('.family-silhouette not yet rendered');
      return el;
    });
    // The DB color (#C77A2E) from TYRANNIDAE_SILHOUETTE must be wired through
    // buildFamilyColorResolver → Photo.color → FamilySilhouette → --family-fill.
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
    expect(silhouetteEl.style.getPropertyValue('--family-fill')).not.toBe(FAMILY_COLOR_FALLBACK);
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
    it('fires panel_opened on mount with species_code and has_description=false when no description', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: false,
      });
      captureSpy.mockRestore();
    });

    // Issue #373 task 6: stratify the panel-thinness analysis post-hoc by
    // tagging `panel_opened` with `has_description: !!data.descriptionBody`.
    // The dwell event shape stays unchanged (PostHog's UI lets the analyst
    // group on the open-event property at query time).
    it('fires panel_opened with has_description=true when descriptionBody is present', async () => {
      const captureSpy = vi.spyOn(analytics, 'capture');
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue({
          ...VERMFLY,
          descriptionBody: '<p>Body.</p>',
          descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
        }),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
      render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
      );
      expect(captureSpy).toHaveBeenCalledWith('panel_opened', {
        species_code: 'vermfly',
        has_description: true,
      });
      // Defensive: dwell event shape is unchanged — no `has_description` on
      // the dwell payload (the analyst groups on the open-event property at
      // query time).
      const dwellCalls = captureSpy.mock.calls.filter(([name]) => name === 'panel_dwell_ms');
      for (const [, payload] of dwellCalls) {
        expect(payload as Record<string, unknown>).not.toHaveProperty('has_description');
      }
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

  // ─── Phase 3 bbox filter (issue #560) ─────────────────────────────────────
  //
  // SpeciesDetailSurface accepts an optional `bbox: BBox | null` prop. When
  // null/undefined the surface renders all observations (unchanged behavior).
  // When set, observations are filtered client-side (Read API has no bbox
  // support; spec §10 line 522). Inclusive bounds on all 4 edges. Memo'd by
  // [observations, bbox] for stable re-renders. Spec §5.4.

  describe('SpeciesDetailSurface bbox filter (Phase 3, #560)', () => {
    // Minimal observation factory — only fields the filter needs + locName
    // for a human-readable assertion target.
    function makeObs(subId: string, lng: number, lat: number): Observation {
      return {
        subId,
        speciesCode: 'vermfly',
        comName: 'Vermilion Flycatcher',
        lat,
        lng,
        obsDt: '2026-05-01',
        locId: `L${subId}`,
        locName: `Location ${subId}`,
        howMany: 1,
        isNotable: false,
        silhouetteId: null,
        familyCode: 'songbird',
      };
    }

    function makeClientWithObs(): ApiClient {
      return makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>);
    }

    const INSIDE = makeObs('inside', -110.5, 31.5);
    const OUTSIDE = makeObs('outside', -109, 33);
    const ON_EDGE = makeObs('edge', -110, 31);
    const BBOX: BBox = [-111, 31, -110, 32];

    it('without bbox prop, renders all observations for the species', async () => {
      const client = makeClientWithObs();
      render(
        <SpeciesDetailSurface
          speciesCode="vermfly"
          apiClient={client}
          observations={[INSIDE, OUTSIDE]}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      const items = screen.getAllByTestId('observation-item');
      expect(items).toHaveLength(2);
    });

    it('with bbox prop, filters observations to those inside the bbox', async () => {
      const client = makeClientWithObs();
      render(
        <SpeciesDetailSurface
          speciesCode="vermfly"
          apiClient={client}
          observations={[INSIDE, OUTSIDE]}
          bbox={BBOX}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      const items = screen.getAllByTestId('observation-item');
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent('inside');
    });

    it('inclusive bounds — observations on the bbox edge are included', async () => {
      const client = makeClientWithObs();
      render(
        <SpeciesDetailSurface
          speciesCode="vermfly"
          apiClient={client}
          observations={[ON_EDGE]}
          bbox={BBOX}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      const items = screen.getAllByTestId('observation-item');
      expect(items).toHaveLength(1);
    });

    it('filter is stable across re-renders with identical bbox', async () => {
      const client = makeClientWithObs();
      const observations = [INSIDE, OUTSIDE];
      const { rerender } = render(
        <SpeciesDetailSurface
          speciesCode="vermfly"
          apiClient={client}
          observations={observations}
          bbox={BBOX}
        />,
      );
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      // Re-render with the same bbox reference — memo should not recompute
      // (the filtered array reference stays stable, which downstream list
      // rendering relies on to avoid thrashing).
      rerender(
        <SpeciesDetailSurface
          speciesCode="vermfly"
          apiClient={client}
          observations={observations}
          bbox={BBOX}
        />,
      );
      const items = screen.getAllByTestId('observation-item');
      expect(items).toHaveLength(1);
    });
  });

  // ─── Phase 3 bbox banner (Task 7, #560) ──────────────────────────────────
  //
  // When `bbox` prop is non-null, SpeciesDetailSurface renders a banner
  // section with role="region" aria-label="Filtered by map area" containing
  // the filtered count and a "View all observations" button that calls
  // onClearBbox. When bbox is null/undefined, the banner must not render.

  describe('SpeciesDetailSurface bbox banner (Phase 3, #560)', () => {
    const rest = {
      speciesCode: 'vermfly',
      apiClient: makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
        getSilhouettes: vi.fn().mockResolvedValue([TYRANNIDAE_SILHOUETTE]),
      } as unknown as Partial<ApiClient>),
    };

    it('renders the banner with onClearBbox link when bbox is non-null', async () => {
      const onClearBbox = vi.fn();
      render(<SpeciesDetailSurface bbox={[-111, 31, -110, 32]} onClearBbox={onClearBbox} {...rest} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      const banner = screen.getByRole('region', { name: /Filtered by map area/i });
      expect(banner).toBeInTheDocument();
      const link = within(banner).getByRole('button', { name: /View all observations/i });
      fireEvent.click(link);
      expect(onClearBbox).toHaveBeenCalledTimes(1);
    });

    it('does not render the banner when bbox is null', async () => {
      render(<SpeciesDetailSurface bbox={null} {...rest} />);
      await waitFor(() =>
        expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument(),
      );
      expect(screen.queryByRole('region', { name: /Filtered by map area/i })).not.toBeInTheDocument();
    });
  });
});
