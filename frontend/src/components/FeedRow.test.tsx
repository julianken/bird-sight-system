import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Observation } from '@bird-watch/shared-types';
import { FeedRow } from './FeedRow.js';

const NOW = new Date(2026, 3, 15, 15, 0, 0, 0);

const BASE_OBS: Observation = {
  subId: 'S001',
  speciesCode: 'vermfly',
  comName: 'Vermilion Flycatcher',
  lat: 32.2,
  lng: -110.9,
  obsDt: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
  locId: 'L001',
  locName: 'Sabino Canyon',
  howMany: 1,
  isNotable: false,
  regionId: null,
  silhouetteId: null,
  familyCode: 'tyrannidae',
};

describe('FeedRow', () => {
  it('renders a <FamilySilhouette> thumb in the leading slot', () => {
    render(
      <FeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    // Phase 2's <FamilySilhouette layout="thumb"> renders with
    // data-testid="family-silhouette" and data-family="tyrannidae"
    const thumb = screen.getByTestId('family-silhouette');
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveAttribute('data-family', 'tyrannidae');
    expect(thumb).toHaveAttribute('data-layout', 'thumb');
  });

  it('renders the null-family neutral path when familyCode is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, familyCode: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    const thumb = screen.getByTestId('family-silhouette');
    expect(thumb).toHaveAttribute('data-family', 'null');
  });

  it('renders comName, locName, and relative time', () => {
    render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(screen.getByText('Vermilion Flycatcher')).toBeInTheDocument();
    expect(screen.getByText('Sabino Canyon')).toBeInTheDocument();
    expect(screen.getByText('15 min ago')).toBeInTheDocument();
  });

  it('renders a count chip "×N" when howMany > 1', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: 5 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('×5')).toBeInTheDocument();
  });

  it('renders "—" when howMany is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('omits count chip when howMany is 1 (solo sighting)', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: 1 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.queryByText(/×\d/)).toBeNull();
  });

  it('applies feed-row-notable class modifier when isNotable is true', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: true }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    // Flat row notable is a class modifier only — no separate glyph badge.
    // The ARIA label still carries the Notable signal in the accessible name.
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('feed-row-notable');
  });

  it('preserves the five-slot ARIA accessible name contract', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: true, howMany: 7 }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Notable sighting, Vermilion Flycatcher, 7 birds, at Sabino Canyon, 15 min ago',
    );
  });

  it('omits notable prefix, count, and location when absent', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, isNotable: false, howMany: 1, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Vermilion Flycatcher, 15 min ago',
    );
  });

  it('announces "count unknown" when howMany is null', () => {
    render(
      <FeedRow
        observation={{ ...BASE_OBS, howMany: null, locName: null }}
        now={NOW}
        onSelectSpecies={() => {}}
      />
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Vermilion Flycatcher, count unknown, 15 min ago',
    );
  });

  it('fires onSelectSpecies with the species code on click', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedRow
        observation={BASE_OBS}
        now={NOW}
        onSelectSpecies={onSelectSpecies}
      />
    );
    await user.click(screen.getByRole('button'));
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('fires onSelectSpecies on Enter keypress', async () => {
    const onSelectSpecies = vi.fn();
    const user = userEvent.setup();
    render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={onSelectSpecies} />
    );
    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenCalledWith('vermfly');
  });

  it('is a React.memo component', () => {
    const MemoSymbol = Symbol.for('react.memo');
    expect(
      (FeedRow as unknown as { $$typeof: symbol }).$$typeof
    ).toBe(MemoSymbol);
  });

  it('renders inside an <li> so it composes correctly inside <ol>', () => {
    const { container } = render(
      <FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={() => {}} />
    );
    expect(container.firstChild?.nodeName).toBe('LI');
  });

  describe('DB color binding (NEW-3 fix)', () => {
    it('renders grey fallback when no color prop is provided', () => {
      // Without the color prop, the silhouette falls back to the null-family
      // grey (#5a6472) because tyrannidae is not in the 7-item FamilyCode union.
      render(<FeedRow observation={BASE_OBS} now={NOW} onSelectSpecies={() => {}} />);
      const silhouette = screen.getByTestId('family-silhouette') as HTMLElement;
      // Without color prop: grey fallback from NULL_FAMILY_CHANNEL
      expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#5a6472');
    });

    it('uses the color prop to tint the FamilySilhouette with DB color', () => {
      // When the parent threads the DB color down, it must reach the silhouette.
      render(
        <FeedRow
          observation={BASE_OBS}
          now={NOW}
          onSelectSpecies={() => {}}
          color="#C77A2E"
        />
      );
      const silhouette = screen.getByTestId('family-silhouette') as HTMLElement;
      expect(silhouette.style.getPropertyValue('--family-fill')).toBe('#C77A2E');
    });
  });
});
