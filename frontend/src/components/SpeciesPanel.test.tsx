import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesPanel } from './SpeciesPanel.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { setMatchMedia, getMockMediaQuery } from '../test-setup.js';

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

const MOBILE_QUERY = '(max-width: 767px)';

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

  describe('responsive layout (#115)', () => {
    it('renders with data-layout="drawer" when viewport matches mobile query', async () => {
      setMatchMedia(q => q === MOBILE_QUERY);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
      );
      const panel = screen.getByRole('complementary');
      expect(panel.getAttribute('data-layout')).toBe('drawer');
    });

    it('renders with data-layout="sidebar" when viewport is wider than mobile', async () => {
      setMatchMedia(() => false);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
      );
      const panel = screen.getByRole('complementary');
      expect(panel.getAttribute('data-layout')).toBe('sidebar');
    });

    it('renders an overlay sibling in drawer mode', () => {
      setMatchMedia(q => q === MOBILE_QUERY);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      const { container } = render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
      );
      const overlay = container.querySelector('.species-panel-overlay');
      expect(overlay).not.toBeNull();
    });

    it('does NOT render an overlay sibling in sidebar mode', () => {
      setMatchMedia(() => false);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      const { container } = render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
      );
      const overlay = container.querySelector('.species-panel-overlay');
      expect(overlay).toBeNull();
    });

    it('clicking the overlay dismisses the panel in drawer mode', async () => {
      setMatchMedia(q => q === MOBILE_QUERY);
      const onDismiss = vi.fn();
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      const user = userEvent.setup();
      const { container } = render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={onDismiss} apiClient={client} />
      );
      const overlay = container.querySelector('.species-panel-overlay') as HTMLElement;
      await user.click(overlay);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('updates data-layout reactively when the viewport matches change', async () => {
      setMatchMedia(() => false);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);
      render(
        <SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />
      );
      expect(screen.getByRole('complementary').getAttribute('data-layout')).toBe('sidebar');

      act(() => {
        getMockMediaQuery(MOBILE_QUERY)!.dispatchChange(true);
      });

      expect(screen.getByRole('complementary').getAttribute('data-layout')).toBe('drawer');
    });
  });

  describe('scroll-restore (#115)', () => {
    let scrollToCalls: Array<[number, number]>;
    const originalScrollTo = window.scrollTo;
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY');

    beforeEach(() => {
      scrollToCalls = [];
      (window.scrollTo as unknown) = (x: number, y: number) => {
        scrollToCalls.push([x, y]);
        Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
      };
      Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 0 });
    });

    afterEach(() => {
      window.scrollTo = originalScrollTo;
      if (originalDescriptor) {
        Object.defineProperty(window, 'scrollY', originalDescriptor);
      }
    });

    it('restores scroll position on close when panel is opened while scrolled', async () => {
      setMatchMedia(q => q === MOBILE_QUERY);
      const client = makeClient({
        getSpecies: vi.fn().mockResolvedValue(VERMFLY),
      } as unknown as Partial<ApiClient>);

      // Simulate: user scrolled to 500 on page before opening panel.
      Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 500 });

      const { rerender } = render(
        <SpeciesPanel speciesCode={null} onDismiss={() => {}} apiClient={client} />
      );

      // Open the panel — hook captures 500.
      rerender(<SpeciesPanel speciesCode="vermfly" onDismiss={() => {}} apiClient={client} />);

      // User does not scroll while open.
      // Close the panel — hook restores to 500.
      rerender(<SpeciesPanel speciesCode={null} onDismiss={() => {}} apiClient={client} />);

      expect(scrollToCalls).toEqual([[0, 500]]);
    });
  });
});
