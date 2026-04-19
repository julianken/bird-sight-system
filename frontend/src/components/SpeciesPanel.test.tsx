import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesPanel } from './SpeciesPanel.js';
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

describe('SpeciesPanel', () => {
  it('renders nothing when speciesCode is null', () => {
    const client = makeClient({ getSpecies: vi.fn() } as unknown as Partial<ApiClient>);
    const { container } = render(
      <SpeciesPanel speciesCode={null} onDismiss={() => {}} apiClient={client} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders common, scientific, and family names when data resolves', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
    } as unknown as Partial<ApiClient>);
    render(
      <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeInTheDocument()
    );
    // Scientific name rendered in italics.
    const sci = screen.getByText('Pyrocephalus rubinus');
    expect(sci.tagName).toBe('EM');
    expect(screen.getByText('Tyrant Flycatchers')).toBeInTheDocument();
  });

  it('uses role="complementary" with aria-labelledby pointing at the heading', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
    } as unknown as Partial<ApiClient>);
    render(
      <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
    );
    const panel = screen.getByRole('complementary');
    const labelledBy = panel.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    await waitFor(() => {
      const heading = document.getElementById(labelledBy!);
      expect(heading?.textContent).toBe('Vermilion Flycatcher');
    });
  });

  it('close button calls onDismiss', async () => {
    const onDismiss = vi.fn();
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
    } as unknown as Partial<ApiClient>);
    const user = userEvent.setup();
    render(
      <SpeciesPanel speciesCode="vermfly" onDismiss={onDismiss} apiClient={client} />
    );
    await user.click(screen.getByRole('button', { name: 'Close species details' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape key calls onDismiss while the panel is open', async () => {
    const onDismiss = vi.fn();
    const client = makeClient({
      getSpecies: vi.fn().mockResolvedValue(VERMFLY),
    } as unknown as Partial<ApiClient>);
    const user = userEvent.setup();
    render(
      <SpeciesPanel speciesCode="vermfly" onDismiss={onDismiss} apiClient={client} />
    );
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not listen for Escape when closed (speciesCode null)', async () => {
    const onDismiss = vi.fn();
    const client = makeClient({ getSpecies: vi.fn() } as unknown as Partial<ApiClient>);
    const user = userEvent.setup();
    render(
      <SpeciesPanel speciesCode={null} onDismiss={onDismiss} apiClient={client} />
    );
    await user.keyboard('{Escape}');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('error state renders an inline message without tearing down the panel', async () => {
    const client = makeClient({
      getSpecies: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as Partial<ApiClient>);
    render(
      <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
    );
    // Panel (complementary landmark) still exists; error is inline.
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Could not load species details')).toBeInTheDocument()
    );
    // Close button still works even in the error state.
    expect(screen.getByRole('button', { name: 'Close species details' })).toBeInTheDocument();
  });
});
