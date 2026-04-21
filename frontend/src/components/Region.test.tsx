import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Region, computeExpandTransform } from './Region.js';
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

  it('sets vector-effect="non-scaling-stroke" on the region-shape path so strokes survive the .region-expanded scale transform', () => {
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
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('has no transform attribute when collapsed', () => {
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
    const g = container.querySelector('[data-region-id="sky-islands-santa-ritas"]');
    expect(g?.getAttribute('transform')).toBeNull();
  });

  it('applies a non-empty inline transform when expanded', () => {
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <Region
          region={region}
          observations={obs}
          expanded={true}
          onSelect={() => {}}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const g = container.querySelector('[data-region-id="sky-islands-santa-ritas"]');
    const transform = g?.getAttribute('transform');
    expect(transform).toBeTruthy();
    expect(transform).toContain('translate');
    expect(transform).toContain('scale');
  });
});

describe('computeExpandTransform', () => {
  it('returns a translate + scale string for a valid path', () => {
    const t = computeExpandTransform(
      'M 200 170 L 340 170 L 340 215 L 200 215 Z',
      { w: 360, h: 380 },
    );
    expect(t).toMatch(/^translate\(.+\) scale\(.+\)$/);
  });

  it('returns empty string for an empty path', () => {
    expect(computeExpandTransform('', { w: 360, h: 380 })).toBe('');
  });

  it('centers the region and uses padding factor 0.85', () => {
    // Simple 100x100 square at origin
    const t = computeExpandTransform(
      'M 0 0 L 100 0 L 100 100 L 0 100 Z',
      { w: 360, h: 380 },
    );
    // scale should be min(360/100, 380/100) * 0.85 = 3.6 * 0.85 = 3.06
    const expectedScale = Math.min(360 / 100, 380 / 100) * 0.85;
    expect(t).toContain(`scale(${expectedScale})`);
  });
});
