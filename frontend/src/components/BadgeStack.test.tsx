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

describe('BadgeStack overflow-pip uniformity (ticket #92)', () => {
  // Santa Ritas sky-island — copied from migrations/1700000008000_seed_regions.sql.
  const SANTA_RITAS = 'M 226.6 330.0 L 239.0 325.3 L 254.5 330.0 L 266.9 341.3 L 265.0 354.7 L 252.6 363.3 L 239.0 361.3 L 227.8 352.0 L 226.6 340.0 Z';

  it('grid-path overflow-pip r matches adjacent badge r', () => {
    // 20 species in a 1000x1000 canvas -> grid layout path. With 11 visible
    // badges + "+9" pip, pip should be the same r as each badge.
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
    const badge = container.querySelector('circle.badge-circle');
    const pip = container.querySelector('[data-role="overflow-pip"] circle');
    expect(badge).not.toBeNull();
    expect(pip).not.toBeNull();
    expect(pip!.getAttribute('r')).toBe(badge!.getAttribute('r'));
  });

  it('fallback-path overflow-pip r matches adjacent badge r', () => {
    // Santa Ritas cannot fit even one MIN_BADGE_DIAMETER badge in its
    // inscribed rectangle -> pole-of-inaccessibility fallback path. After
    // unification, the pip should match badge r (not Math.max(5, r*0.4)).
    const tenObs = Array.from({ length: 10 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={tenObs}
          polygonSvgPath={SANTA_RITAS}
          x={226.6 + 8} y={325.3 + 8}
          width={40.3 - 16} height={38.0 - 16}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const badge = container.querySelector('circle.badge-circle');
    const pip = container.querySelector('[data-role="overflow-pip"] circle');
    expect(badge).not.toBeNull();
    expect(pip).not.toBeNull();
    expect(pip!.getAttribute('r')).toBe(badge!.getAttribute('r'));
  });

  it('fallback-path overflow-pip does NOT occlude the adjacent badge (regression: PR #97)', () => {
    // When the fallback-path pip was unified to `r={r}`, its translate
    // offset (`r*0.7` at the time) stopped being sufficient to keep the
    // pip outside the badge's click target. Playwright's
    // species-panel.spec.ts caught it: the pip's <circle r="13"> was
    // intercepting pointer events destined for the Santa Ritas
    // Vermilion Flycatcher badge. Guard: center-to-center distance
    // between badge and pip MUST be >= 2*r so the two tangent circles
    // never overlap.
    const tenObs = Array.from({ length: 10 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={tenObs}
          polygonSvgPath={SANTA_RITAS}
          x={226.6 + 8} y={325.3 + 8}
          width={40.3 - 16} height={38.0 - 16}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const badge = container.querySelector('.badge');
    const pip = container.querySelector('[data-role="overflow-pip"]');
    expect(badge).not.toBeNull();
    expect(pip).not.toBeNull();

    const parseTranslate = (el: Element) => {
      const transform = el.getAttribute('transform') ?? '';
      const m = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
      expect(m).not.toBeNull();
      return { x: parseFloat(m![1]!), y: parseFloat(m![2]!) };
    };
    const { x: bx, y: by } = parseTranslate(badge!);
    const { x: px, y: py } = parseTranslate(pip!);
    const r = parseFloat(
      badge!.querySelector('circle.badge-circle')!.getAttribute('r') ?? '0',
    );
    expect(r).toBeGreaterThan(0);

    const dist = Math.hypot(px - bx, py - by);
    // Invariant: pip must sit meaningfully outside the adjacent badge's
    // click target. Two unit-r circles fully clear one another at
    // center-to-center = 2r; the PR-head geometry gave ~0.99r (pip
    // entirely inside the badge, intercepting its click). After the
    // `r*1.4` fix, diagonal distance is r*1.4*√2 ≈ 1.98r — pip circles
    // just barely kiss the badge circle (~0.02r of technical overlap,
    // below the Playwright pointer-intercept threshold).
    //
    // Threshold here is `1.5 * r`: fails the PR-head `r*0.7` coefficient
    // (~0.99r) and passes the `r*1.4` fix (~1.98r), with enough margin
    // to survive micro-variations in future refactors (e.g., switching
    // from uniform r*K to an axis-aligned outward offset would sit
    // between these two values).
    expect(dist).toBeGreaterThanOrEqual(1.5 * r);
  });

  it('overflow-pip fontSize is 9 in both paths', () => {
    // Grid path
    const { container: gridC } = render(
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
    const gridPipText = gridC.querySelector('[data-role="overflow-pip"] text');
    expect(gridPipText?.getAttribute('font-size')).toBe('9');

    // Fallback path
    const tenObs = Array.from({ length: 10 }, (_, i) =>
      O(i, `sp${i}`, 'tyrannidae'),
    );
    const { container: fbC } = render(
      <svg viewBox="0 0 360 380">
        <BadgeStack
          observations={tenObs}
          polygonSvgPath={SANTA_RITAS}
          x={226.6 + 8} y={325.3 + 8}
          width={40.3 - 16} height={38.0 - 16}
          expanded={false}
          silhouetteFor={() => 'M0 0'}
          colorFor={() => '#000'}
        />
      </svg>
    );
    const fbPipText = fbC.querySelector('[data-role="overflow-pip"] text');
    expect(fbPipText?.getAttribute('font-size')).toBe('9');
  });
});
