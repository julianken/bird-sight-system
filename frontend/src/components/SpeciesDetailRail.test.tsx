import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailRail } from './SpeciesDetailRail.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';
import { __resetSpeciesDetailCache } from '../data/use-species-detail.js';

beforeEach(() => {
  __resetSpeciesDetailCache();
});

const VERMFLY_WITH_PHOTO: SpeciesMeta = {
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus',
  familyCode: 'songbird',
  familyName: 'Tyrant Flycatchers',
  taxonOrder: 4400,
  photoUrl: 'https://photos.bird-maps.com/vermfly.jpg',
  photoAttribution: 'Jane Smith',
  photoLicense: 'CC-BY-4.0',
};

function makeClient(): ApiClient {
  const client = new ApiClient({ baseUrl: '' });
  client.getSpecies = vi.fn().mockResolvedValue(VERMFLY_WITH_PHOTO);
  client.getSilhouettes = vi.fn().mockResolvedValue([]);
  return client;
}

describe('<SpeciesDetailRail>', () => {
  it('renders as <aside role="complementary"> (NOT a <dialog>) with aria-labelledby="detail-title"', async () => {
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
      />
    );
    // The rail must NOT use dialog semantics — that would re-introduce the
    // top-layer + inert-backdrop problem the #663 Addendum A pivot fixes.
    expect(screen.queryByRole('dialog')).toBeNull();
    const aside = await screen.findByRole('complementary');
    expect(aside).toHaveAttribute('aria-labelledby', 'detail-title');
    expect(aside.tagName).toBe('ASIDE');
  });

  it('focuses the close button on mount', async () => {
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
      />
    );
    const closeBtn = await screen.findByRole('button', { name: /close species detail/i });
    await waitFor(() => expect(document.activeElement).toBe(closeBtn));
  });

  it('ESC closes and calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    await screen.findByRole('complementary');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('close-button click calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    const closeBtn = await screen.findByRole('button', { name: /close species detail/i });
    await userEvent.click(closeBtn);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('restores focus to the trigger element on close when trigger is still in the document', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open detail';
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        triggerRef={{ current: trigger }}
      />
    );
    await screen.findByRole('complementary');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    document.body.removeChild(trigger);
  });

  it('falls back to fallbackFocusSelector when trigger is detached from document', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger (will be detached)';
    document.body.appendChild(trigger);
    trigger.focus();

    const fallbackTab = document.createElement('button');
    fallbackTab.id = 'species-detail-rail-test-fallback-tab';
    document.body.appendChild(fallbackTab);

    const onClose = vi.fn();
    render(
      <SpeciesDetailRail
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        triggerRef={{ current: trigger }}
        fallbackFocusSelector="#species-detail-rail-test-fallback-tab"
      />
    );
    await screen.findByRole('complementary');

    document.body.removeChild(trigger);
    expect(document.contains(trigger)).toBe(false);

    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(fallbackTab));

    document.body.removeChild(fallbackTab);
  });
});
