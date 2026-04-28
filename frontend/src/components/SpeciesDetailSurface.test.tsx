import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

const VERMFLY: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'tyrannidae',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
};

function makeClient(overrides: Partial<ApiClient>): ApiClient {
  return Object.assign(new ApiClient(), overrides);
}

describe('SpeciesDetailSurface', () => {
  it('renders common, scientific, and family names when data resolves', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
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
    } as unknown as Partial<ApiClient>);
    render(<SpeciesDetailSurface speciesCode="vermfly" apiClient={client} />);
    expect(screen.getByText('Loading species details…')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockRejectedValue(new Error('boom')),
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
});
