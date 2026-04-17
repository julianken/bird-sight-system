import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HotspotDot } from './HotspotDot.js';

describe('HotspotDot', () => {
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
