import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Region } from './Region.js';
import type { Region as RegionT, Observation } from '@bird-watch/shared-types';

const region: RegionT = {
  id: 'sky-islands-santa-ritas',
  name: 'Santa Ritas',
  parentId: null,
  displayColor: '#FF0808',
  svgPath: 'M 200 170 L 340 170 L 340 215 L 200 215 Z',
};

const obs: Observation[] = [{
  subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
  lat: 31.7, lng: -110.9, obsDt: '2026-04-15T08:00:00Z', locId: 'L1',
  locName: 'X', howMany: 1, isNotable: false,
  regionId: 'sky-islands-santa-ritas', silhouetteId: 'tyrannidae',
}];

describe('Region', () => {
  it('renders the polygon with the display color', () => {
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <Region
          region={region}
          observations={obs}
          expanded={false}
          onSelect={() => {}}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const path = container.querySelector('path.region-shape');
    expect(path?.getAttribute('fill')).toBe('#FF0808');
  });

  it('calls onSelect when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <svg viewBox="0 0 360 380">
        <Region
          region={region}
          observations={obs}
          expanded={false}
          onSelect={onSelect}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    await user.click(screen.getByRole('button', { name: /Santa Ritas/ }));
    expect(onSelect).toHaveBeenCalledWith('sky-islands-santa-ritas');
  });
});
