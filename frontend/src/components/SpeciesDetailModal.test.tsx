import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpeciesDetailModal } from './SpeciesDetailModal.js';
import { ApiClient } from '../api/client.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

// JSDOM does not implement HTMLDialogElement.showModal/close; polyfill
// minimally so the component's calls don't throw and the [open]
// attribute reflects the open state.
beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
      this.dispatchEvent(new Event('open'));
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
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

describe('<SpeciesDetailModal>', () => {
  it('opens via showModal and exposes aria-labelledby="detail-title"', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveAttribute('open'));
    expect(dialog).toHaveAttribute('aria-labelledby', 'detail-title');
  });

  it('moves initial focus to #detail-title, not the close button', async () => {
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={vi.fn()}
      />
    );
    const heading = await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('ESC closes and calls onClose', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('backdrop click closes (event.target === dialog)', async () => {
    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
      />
    );
    const dialog = await screen.findByRole('dialog');
    // A bare click() on the dialog element bubbles with target === dialog
    // (the AttributionModal pattern: backdrop is the dialog itself when
    // clicked outside the content area).
    dialog.click();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('restores focus to the trigger element on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open detail';
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    render(
      <SpeciesDetailModal
        speciesCode="vermfly"
        apiClient={makeClient()}
        onClose={onClose}
        triggerRef={{ current: trigger }}
      />
    );
    await screen.findByRole('heading', { level: 1, name: /vermilion flycatcher/i });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    document.body.removeChild(trigger);
  });
});
