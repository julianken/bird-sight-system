import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { FeedCard } from './FeedCard.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const NOTABLE_OBS: Observation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.2,
  lng: -110.9,
  obsDt: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
  locId: 'L001',
  locName: 'Sabino Canyon',
  howMany: 3,
  isNotable: true,
  regionId: null,
  silhouetteId: null,
  familyCode: 'tyrannidae',
};

describe('FeedCard', () => {
  it('renders the NOTABLE meta-label', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // Text label "NOTABLE" must be present — notable token is amplification,
    // not sole signal per docs/design/01-spec/accessibility.md §color-independent.
    expect(screen.getByText('NOTABLE')).toBeInTheDocument();
  });

  it('applies the feed-card-meta class to the NOTABLE label (not decision-point)', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    const label = screen.getByText('NOTABLE');
    // Must use .feed-card-meta which maps to --color-accent-notable-fg,
    // never --color-decision-point. Verified structurally here; visual
    // token separation is enforced by the stylelint guard in package.json.
    expect(label).toHaveClass('feed-card-meta');
  });

  it('renders a <FamilySilhouette layout="inline"> at elevated scale', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    const silhouette = screen.getByTestId('family-silhouette');
    // Card uses inline layout (larger than thumb) for the elevated treatment.
    expect(silhouette).toHaveAttribute('data-layout', 'inline');
    expect(silhouette).toHaveAttribute('data-family', 'tyrannidae');
  });

  it('renders comName as the card heading', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByRole('heading', { name: /Vermilion Flycatcher/i })).toBeInTheDocument();
  });

  it('renders location and relative time in the card meta line', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByText(/Sabino Canyon/)).toBeInTheDocument();
    expect(screen.getByText('10 min ago')).toBeInTheDocument();
  });

  it('renders count chip when howMany > 1', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // NOTABLE_OBS has howMany: 3
    expect(screen.getByText('×3')).toBeInTheDocument();
  });

  it('carries a comprehensive accessible name on the interactive region', () => {
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    // Card is a button for keyboard navigation; accessible name mirrors
    // the FeedRow five-slot contract so SR experience is consistent.
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Notable sighting, Vermilion Flycatcher, 3 birds, at Sabino Canyon, 10 min ago',
    );
  });

  it('fires onSelectSpecies with the species code on click', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={onSelectSpecies} />
    );
    await user.click(screen.getByRole('button'));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('renders inside an <li> with class feed-card-item', () => {
    const { container } = render(
      <FeedCard observation={NOTABLE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(container.firstChild?.nodeName).toBe('LI');
    expect(container.firstChild).toHaveClass('feed-card-item');
  });

  it('handles null familyCode with the neutral silhouette path', () => {
    render(
      <FeedCard
        observation={{ ...NOTABLE_OBS, familyCode: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByTestId('family-silhouette')).toHaveAttribute('data-family', 'null');
  });
});
