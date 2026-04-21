import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegionShape, computeExpandTransform } from './Region.js';
import type { Region as RegionT } from '@bird-watch/shared-types';

const region: RegionT = {
  id: 'sky-islands-santa-ritas',
  name: 'Santa Ritas',
  parentId: null,
  displayColor: '#FF0808',
  svgPath: 'M 200 170 L 340 170 L 340 215 L 200 215 Z',
};

// After the #94 two-pass refactor, the per-region <g> wrapper (which owns
// transform/className/data-region-id) lives in Map.tsx, not in the leaf
// components. `RegionShape` is a pure <path> renderer; the transform-when-
// expanded and transform-when-collapsed assertions have moved up to
// Map.test.tsx.

describe('RegionShape', () => {
  it('renders the polygon with the display color', () => {
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <RegionShape region={region} onSelect={() => {}} />
      </svg>
    );
    const path = container.querySelector('path.region-shape');
    expect(path?.getAttribute('fill')).toBe('#FF0808');
  });

  it('calls onSelect with the region id when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <svg viewBox="0 0 360 380">
        <RegionShape region={region} onSelect={onSelect} />
      </svg>
    );
    await user.click(screen.getByRole('button', { name: /Santa Ritas/ }));
    expect(onSelect).toHaveBeenCalledWith('sky-islands-santa-ritas');
  });

  it('sets vector-effect="non-scaling-stroke" on the region-shape path so strokes survive the .region-expanded scale transform', () => {
    // #98 regression guard — the JSX attribute is belt-and-braces for
    // Safari < 16; the CSS rule in styles.css covers modern browsers.
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <RegionShape region={region} onSelect={() => {}} />
      </svg>
    );
    const path = container.querySelector('path.region-shape');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('calls onSelect on Enter keydown', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <svg viewBox="0 0 360 380">
        <RegionShape region={region} onSelect={onSelect} />
      </svg>
    );
    const path = screen.getByRole('button', { name: /Santa Ritas/ });
    path.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('sky-islands-santa-ritas');
  });

  it('calls onSelect on Space keydown', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <svg viewBox="0 0 360 380">
        <RegionShape region={region} onSelect={onSelect} />
      </svg>
    );
    const path = screen.getByRole('button', { name: /Santa Ritas/ });
    path.focus();
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledWith('sky-islands-santa-ritas');
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
