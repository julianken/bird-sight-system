import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BadgeStack, layoutBadges, MIN_BADGE_DIAMETER } from './BadgeStack.js';
import { parsePoints, distanceToPolygonEdge, pointInPolygon } from '../geo/path.js';
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

  it('renders visible species-name labels when expanded', () => {
    // Use short names (<=14 chars) so the BadgeStack test doesn't overlap
    // with Badge.test.tsx's truncation behaviour.
    const obs = [O(1, 'pygowl', 'strigidae'), O(2, 'annhum', 'trochilidae')];
    obs[0]!.comName = 'Pygmy Owl';
    obs[1]!.comName = 'Anna Hummer';
    const { container } = render(
      <svg viewBox="0 0 1000 1000">
        <BadgeStack
          observations={obs}
          x={0} y={0} width={1000} height={1000}
          expanded={true}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const labels = container.querySelectorAll('.badge-label');
    expect(labels.length).toBe(2);
    const texts = Array.from(labels).map(l => l.textContent);
    expect(texts).toContain('Pygmy Owl');
    expect(texts).toContain('Anna Hummer');
  });

  it('renders NO species-name labels when collapsed', () => {
    const obs = [O(1, 'vermfly', 'tyrannidae'), O(2, 'annhum', 'trochilidae')];
    obs[0]!.comName = 'Vermilion Flycatcher';
    obs[1]!.comName = "Anna's Hummingbird";
    const { container } = render(
      <svg viewBox="0 0 1000 1000">
        <BadgeStack
          observations={obs}
          x={0} y={0} width={1000} height={1000}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    expect(container.querySelectorAll('.badge-label').length).toBe(0);
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

describe('BadgeStack polygon containment (issue #59)', () => {
  // Santa Ritas sky-island — copied from migrations/1700000008000_seed_regions.sql.
  // Bbox is ~40×38 at (226.6, 325.3); a 30px bbox-grid badge overflows the
  // polygon edge. The layout MUST keep every badge's inscribed circle
  // entirely inside the polygon.
  const SANTA_RITAS = 'M 226.6 330.0 L 239.0 325.3 L 254.5 330.0 L 266.9 341.3 L 265.0 354.7 L 252.6 363.3 L 239.0 361.3 L 227.8 352.0 L 226.6 340.0 Z';

  // Irregular convex quad — rotated-rectangle-shaped, big enough to host a
  // small grid. Used to confirm the rotated/irregular case AC called out.
  const ROTATED_QUAD = 'M 40 0 L 120 40 L 80 120 L 0 80 Z';

  /**
   * For every rendered `<circle class="badge-circle">`, assert that a disc
   * of that radius centred at its translate-parent lies inside `polygon`.
   * JSDOM exposes transform attributes on the parent <g>, so we parse the
   * `translate(cx,cy)` from there.
   */
  function assertAllBadgesContained(
    container: HTMLElement,
    polygon: Array<{ x: number; y: number }>,
  ) {
    const badges = container.querySelectorAll('.badge');
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      const transform = badge.getAttribute('transform') ?? '';
      const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
      expect(match).not.toBeNull();
      const cx = parseFloat(match![1]!);
      const cy = parseFloat(match![2]!);
      const circle = badge.querySelector('circle.badge-circle');
      expect(circle).not.toBeNull();
      const r = parseFloat(circle!.getAttribute('r') ?? '0');
      expect(r).toBeGreaterThan(0);

      // Centre must be inside the polygon.
      expect(pointInPolygon(cx, cy, polygon)).toBe(true);
      // And distance from centre to nearest edge >= radius (the disc test,
      // AC #1 of issue #59).
      const dist = distanceToPolygonEdge(cx, cy, polygon);
      expect(dist).toBeGreaterThanOrEqual(r - 1e-6);
    }
  }

  it('keeps every badge circle fully inside a rotated/irregular polygon', () => {
    // 4 species — small enough to grid-layout inside the quad.
    const obs: Observation[] = [
      O(1, 'a', 'tyrannidae'),
      O(2, 'b', 'tyrannidae'),
      O(3, 'c', 'trochilidae'),
      O(4, 'd', 'turdidae'),
    ];
    const { container } = render(
      <svg viewBox="0 0 160 160">
        <BadgeStack
          observations={obs}
          polygonSvgPath={ROTATED_QUAD}
          x={0} y={0} width={120} height={120}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    assertAllBadgesContained(container, parsePoints(ROTATED_QUAD));
  });

  it('uses pole-of-inaccessibility fallback for a sky-island with 10 species', () => {
    // Santa Ritas cannot fit 10 × MIN_BADGE_DIAMETER badges — layout should
    // collapse to one badge at the pole of inaccessibility plus a "+9" pip.
    const tenObs: Observation[] = Array.from({ length: 10 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={tenObs}
          polygonSvgPath={SANTA_RITAS}
          // Bbox-derived props match Region.tsx's current derivation.
          x={226.6 + 8} y={325.3 + 8}
          width={40.3 - 16} height={38.0 - 16}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    // Exactly one badge plus one overflow pip.
    expect(container.querySelectorAll('.badge').length).toBe(1);
    const pip = container.querySelector('[data-role="overflow-pip"]');
    expect(pip).not.toBeNull();
    expect(pip?.textContent).toBe('+9');
    // The single badge must still be contained.
    assertAllBadgesContained(container, parsePoints(SANTA_RITAS));
  });

  it('containment holds even for a sky-island with exactly 1 species', () => {
    const oneObs: Observation[] = [O(1, 'vermfly', 'tyrannidae')];
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={oneObs}
          polygonSvgPath={SANTA_RITAS}
          x={226.6 + 8} y={325.3 + 8}
          width={40.3 - 16} height={38.0 - 16}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    expect(container.querySelectorAll('.badge').length).toBe(1);
    // No overflow pip when there's only one species.
    expect(container.querySelector('[data-role="overflow-pip"]')).toBeNull();
    assertAllBadgesContained(container, parsePoints(SANTA_RITAS));
  });

  it('never renders a badge smaller than MIN_BADGE_DIAMETER', () => {
    const obs: Observation[] = Array.from({ length: 5 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={obs}
          polygonSvgPath={SANTA_RITAS}
          x={0} y={0} width={40} height={38}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const circles = container.querySelectorAll('circle.badge-circle');
    for (const c of circles) {
      const r = parseFloat(c.getAttribute('r') ?? '0');
      expect(r * 2).toBeGreaterThanOrEqual(MIN_BADGE_DIAMETER);
    }
  });
});
