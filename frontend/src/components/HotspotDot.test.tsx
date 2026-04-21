import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HotspotDot } from './HotspotDot.js';

describe('HotspotDot', () => {
  it('sets vector-effect="non-scaling-stroke" on the hotspot-dot circle so the stroke width is stable across viewBox-to-viewport mappings', () => {
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <HotspotDot x={10} y={10} numSpeciesAlltime={100} locName="A" />
      </svg>
    );
    const circle = container.querySelector('circle.hotspot-dot');
    expect(circle?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('scales radius by activity', () => {
    const { container, rerender } = render(
      <svg viewBox="0 0 100 100">
        <HotspotDot x={10} y={10} numSpeciesAlltime={50} locName="A" />
      </svg>
    );
    const small = container.querySelector('circle.hotspot-dot');
    const smallR = parseFloat(small!.getAttribute('r')!);

    rerender(
      <svg viewBox="0 0 100 100">
        <HotspotDot x={10} y={10} numSpeciesAlltime={500} locName="A" />
      </svg>
    );
    const big = container.querySelector('circle.hotspot-dot');
    const bigR = parseFloat(big!.getAttribute('r')!);
    expect(bigR).toBeGreaterThan(smallR);
  });
});
