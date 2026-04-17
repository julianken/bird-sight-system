import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeStack, layoutBadges } from './BadgeStack.js';
import type { Observation } from '@bird-watch/shared-types';

const O = (i: number, sp: string, sil: string): Observation => ({
  subId: `S${i}`, speciesCode: sp, comName: sp, lat: 32, lng: -111,
  obsDt: '2026-04-15T08:00:00Z', locId: 'L1', locName: 'X',
  howMany: 1, isNotable: false, regionId: 'r', silhouetteId: sil,
});

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
});
