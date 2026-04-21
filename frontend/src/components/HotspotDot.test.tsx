import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { HotspotDot } from './HotspotDot.js';

/**
 * Render a HotspotDot and extract the rendered `r` attribute of the
 * `circle.hotspot-dot`. Keeps each test isolated — no shared DOM, no
 * `rerender` timing — and makes the assertion a plain number comparison.
 */
function renderR(species: number | null): number {
  const { container } = render(
    <svg viewBox="0 0 100 100">
      <HotspotDot x={10} y={10} numSpeciesAlltime={species} locName="A" />
    </svg>
  );
  const circle = container.querySelector('circle.hotspot-dot');
  if (!circle) throw new Error('HotspotDot did not render a circle.hotspot-dot');
  const r = circle.getAttribute('r');
  if (r === null) throw new Error('circle.hotspot-dot has no r attribute');
  return parseFloat(r);
}

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

  it('returns MIN_R for null / zero / negative species', () => {
    expect(renderR(null)).toBe(2);
    expect(renderR(0)).toBe(2);
    expect(renderR(-5)).toBe(2);
  });

  it('returns MAX_R for species at or above REF_SPECIES', () => {
    expect(renderR(450)).toBeCloseTo(7.0, 2);
    expect(renderR(500)).toBeCloseTo(7.0, 2);
    expect(renderR(1000)).toBeCloseTo(7.0, 2);
  });

  it('follows sqrt scale between MIN_R and MAX_R', () => {
    // species / REF = 0.25 -> sqrt = 0.5 -> r = 2 + 0.5 * 5 = 4.5
    expect(renderR(112.5)).toBeCloseTo(4.5, 2);
    // species / REF = 0.5625 -> sqrt = 0.75 -> r = 2 + 0.75 * 5 = 5.75
    expect(renderR(253.125)).toBeCloseTo(5.75, 2);
  });

  it('produces visible differentiation across realistic AZ range', () => {
    const r50 = renderR(50);
    const r200 = renderR(200);
    const r400 = renderR(400);
    // sqrt spacing gives r50 ≈ 3.67, r200 ≈ 5.33, r400 ≈ 6.71
    expect(r200 - r50).toBeGreaterThan(1.0);
    expect(r400 - r200).toBeGreaterThan(1.0);
    expect(r400 - r50).toBeGreaterThan(2.5);
  });

  it('bigger species -> bigger radius (monotonicity)', () => {
    expect(renderR(500)).toBeGreaterThan(renderR(50));
    expect(renderR(200)).toBeGreaterThan(renderR(100));
    expect(renderR(100)).toBeGreaterThan(renderR(50));
  });
});
