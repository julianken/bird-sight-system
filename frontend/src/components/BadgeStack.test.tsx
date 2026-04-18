import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeStack, layoutBadges } from './BadgeStack.js';
import type { Observation } from '@bird-watch/shared-types';

const O = (i: number, sp: string, sil: string): Observation => ({
  subId: `S${i}`, speciesCode: sp, comName: sp, lat: 32, lng: -111,
  obsDt: '2026-04-15T08:00:00Z', locId: 'L1', locName: 'X',
  howMany: 1, isNotable: false, regionId: 'r', silhouetteId: sil,
});

// Create 20 distinct observations (one per species)
const manyObs: Observation[] = Array.from({ length: 20 }, (_, i) =>
  O(i, `sp${i}`, 'tyrannidae'),
);

describe('layoutBadges', () => {
  it('groups by speciesCode with counts', () => {
    const obs = [O(1, 'vermfly', 'tyrannidae'), O(2, 'vermfly', 'tyrannidae'), O(3, 'annhum', 'trochilidae')];
    const groups = layoutBadges(obs);
    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.speciesCode === 'vermfly')?.count).toBe(2);
    expect(groups.find(g => g.speciesCode === 'annhum')?.count).toBe(1);
  });
});

describe('BadgeStack', () => {
  it('renders one Badge per species', () => {
    const obs = [O(1, 'vermfly', 'tyrannidae'), O(2, 'annhum', 'trochilidae')];
    render(
      <svg viewBox="0 0 200 200">
        <BadgeStack
          observations={obs}
          x={0} y={0} width={200} height={200}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    expect(screen.getByLabelText(/vermfly/)).toBeTruthy();
    expect(screen.getByLabelText(/annhum/)).toBeTruthy();
  });

  it('caps to 11 badges + overflow pip when collapsed and >12 species', () => {
    const { container } = render(
      <svg viewBox="0 0 1000 1000">
        <BadgeStack
          observations={manyObs}
          x={0} y={0} width={1000} height={1000}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    // Should render exactly 11 badges (MAX_COLLAPSED_BADGES - 1 = 11)
    const badges = container.querySelectorAll('.badge');
    expect(badges.length).toBe(11);
    // And an overflow pip
    const pip = container.querySelector('[data-role="overflow-pip"]');
    expect(pip).toBeTruthy();
    // Pip should show the overflow count: 20 - 11 = 9
    expect(pip?.textContent).toBe('+9');
  });

  it('renders all badges when expanded, even beyond 12', () => {
    const { container } = render(
      <svg viewBox="0 0 1000 1000">
        <BadgeStack
          observations={manyObs}
          x={0} y={0} width={1000} height={1000}
          expanded={true}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const badges = container.querySelectorAll('.badge');
    expect(badges.length).toBe(20);
    // No overflow pip when expanded
    expect(container.querySelector('[data-role="overflow-pip"]')).toBeNull();
  });

  it('shows no overflow pip when collapsed with 12 or fewer species', () => {
    const twelveObs = Array.from({ length: 12 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container } = render(
      <svg viewBox="0 0 1000 1000">
        <BadgeStack
          observations={twelveObs}
          x={0} y={0} width={1000} height={1000}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    expect(container.querySelectorAll('.badge').length).toBe(12);
    expect(container.querySelector('[data-role="overflow-pip"]')).toBeNull();
  });
});
