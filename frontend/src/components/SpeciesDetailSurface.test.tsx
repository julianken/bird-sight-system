import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta, FamilySilhouette } from '@bird-watch/shared-types';
import { __resetSilhouettesCache } from '../data/use-silhouettes.js';

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
});
