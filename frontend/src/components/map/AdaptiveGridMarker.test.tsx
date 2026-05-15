import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdaptiveGridMarker } from './AdaptiveGridMarker.js';
import type { AdaptiveTile, ResolvedGrid, PositiveInt } from './adaptive-grid.js';
import { toPositiveInt } from './adaptive-grid.js';

// Helpers --------------------------------------------------------------------

function rendered(
  familyCode: string,
  count: number,
  svgData = 'M0 0L24 24Z',
  color = '#C77A2E',
): AdaptiveTile {
  return { kind: 'rendered', familyCode, count, svgData, color };
}

function fallback(familyCode: string, count: number, color = '#888888'): AdaptiveTile {
  return { kind: 'fallback', familyCode, count, color };
}

function pending(familyCode: string, count: number): AdaptiveTile {
  return { kind: 'pending', familyCode, count };
}

const SHAPE_1x1: ResolvedGrid = { tag: 'grid', cols: 1, rows: 1 };
const SHAPE_2x1: ResolvedGrid = { tag: 'grid', cols: 2, rows: 1 };
const SHAPE_2x2: ResolvedGrid = { tag: 'grid', cols: 2, rows: 2 };
const SHAPE_3x3: ResolvedGrid = { tag: 'grid', cols: 3, rows: 3 };
const SHAPE_OVERFLOW: ResolvedGrid = {
  tag: 'grid-overflow',
  cols: 3,
  rows: 3,
  hiddenCount: toPositiveInt(4) as PositiveInt,
};

const noop = () => {};

describe('AdaptiveGridMarker', () => {
  // --- Badge visibility -----------------------------------------------------

  it('renders 1×1 with NO badge when totalCount === 1 (single observation, single family)', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Cooper's Hawk."
        onClick={noop}
      />,
    );
    expect(screen.queryByTestId('adaptive-grid-marker-badge')).toBeNull();
  });

  it('renders 1×1 with badge "5" when totalCount === 5 (single-family cluster)', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations, 1 family. Activate to zoom in."
        onClick={noop}
      />,
    );
    const badges = screen.getAllByTestId('adaptive-grid-marker-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('5');
  });

  // --- 2×2 grid: 4 per-cell badges in descending count order --------------

  it('renders 2×2 with 4 per-cell badges in descending count order', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('tyrannidae', 10),
          rendered('trochilidae', 7),
          rendered('picidae', 4),
          rendered('corvidae', 2),
        ]}
        totalCount={23}
        uniqueFamilies={4}
        ariaLabel="Cluster: 23 observations, 4 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const badges = screen.getAllByTestId('adaptive-grid-marker-badge');
    expect(badges).toHaveLength(4);
    expect(badges.map((b) => b.textContent)).toEqual(['10', '7', '4', '2']);
  });

  // --- Fallback tile opacity -----------------------------------------------

  it('renders fallback tile at opacity 0.5 for tiles with kind === "fallback"', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x1}
        tiles={[rendered('tyrannidae', 5), fallback('mimidae', 3)]}
        totalCount={8}
        uniqueFamilies={2}
        ariaLabel="Cluster: 8 observations, 2 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const fallbackCell = screen.getByTestId('adaptive-grid-marker-cell-fallback');
    // Inline style or computed opacity — accept either.
    const opacity = fallbackCell.style.opacity || window.getComputedStyle(fallbackCell).opacity;
    expect(Number(opacity)).toBeCloseTo(0.5, 2);
  });

  // --- Pending skeleton -----------------------------------------------------

  it('renders pending skeleton (NOT opacity-0.5 fallback) when ALL tiles kind: "pending"', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[pending('a', 4), pending('b', 3), pending('c', 2), pending('d', 1)]}
        totalCount={10}
        uniqueFamilies={4}
        ariaLabel="Cluster: 10 observations, 4 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const pendingCells = screen.getAllByTestId('adaptive-grid-marker-cell-pending');
    expect(pendingCells).toHaveLength(4);
    // No fallback cells should have rendered.
    expect(screen.queryByTestId('adaptive-grid-marker-cell-fallback')).toBeNull();
    // None of the pending cells should be marked opacity 0.5 (skeleton ≠ fallback).
    for (const cell of pendingCells) {
      const op = cell.style.opacity;
      expect(op === '' || Number(op) !== 0.5).toBe(true);
    }
  });

  // --- "+N more" overflow cell ---------------------------------------------

  it('renders "+N more" cell when shape.tag === "grid-overflow" with the actual hiddenCount', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_OVERFLOW}
        tiles={Array.from({ length: 8 }, (_, i) => rendered(`fam${i}`, 8 - i))}
        totalCount={20}
        uniqueFamilies={12}
        ariaLabel="Cluster: 20 observations, 12 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const overflow = screen.getByTestId('adaptive-grid-marker-overflow');
    // Must contain the actual hiddenCount (4 in our fixture).
    expect(overflow.textContent).toMatch(/\+?4/);
  });

  // --- aria-label patterns --------------------------------------------------

  it('aria-label single-observation case verbatim', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Cooper's Hawk."
        onClick={noop}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe("Single observation: Cooper's Hawk.");
  });

  it('aria-label coincident-pair case verbatim', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 2)]}
        totalCount={2}
        uniqueFamilies={2}
        ariaLabel="2 coincident observations: Cooper's Hawk and Sharp-shinned Hawk. Activate to zoom in."
        onClick={noop}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe(
      "2 coincident observations: Cooper's Hawk and Sharp-shinned Hawk. Activate to zoom in.",
    );
  });

  it('aria-label grid case verbatim', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_3x3}
        tiles={Array.from({ length: 9 }, (_, i) => rendered(`fam${i}`, 9 - i))}
        totalCount={47}
        uniqueFamilies={11}
        ariaLabel="Cluster: 47 observations, 11 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe(
      'Cluster: 47 observations, 11 families. Activate to zoom in.',
    );
  });

  // --- describedby list cap -------------------------------------------------

  it('aria-describedby target has at most 9 list items (8 families + "and N more")', () => {
    const listId = 'marker-c123-families';
    const items = [
      'Tyrannidae: 12',
      'Trochilidae: 9',
      'Picidae: 7',
      'Corvidae: 5',
      'Mimidae: 4',
      'Turdidae: 3',
      'Parulidae: 2',
      'Cardinalidae: 1',
      'and 3 more families',
    ];
    render(
      <AdaptiveGridMarker
        shape={SHAPE_3x3}
        tiles={Array.from({ length: 9 }, (_, i) => rendered(`fam${i}`, 9 - i))}
        totalCount={43}
        uniqueFamilies={11}
        ariaLabel="Cluster: 43 observations, 11 families. Activate to zoom in."
        describedByListId={listId}
        describedByItems={items}
        onClick={noop}
      />,
    );
    const ul = document.getElementById(listId);
    expect(ul).not.toBeNull();
    const lis = ul!.querySelectorAll('li');
    expect(lis.length).toBeLessThanOrEqual(9);
    expect(lis.length).toBe(9);
  });

  // --- Hit-extender contracts ----------------------------------------------

  it('hit-extender overlay element has tabIndex === -1 (inherits MapMarkerHitLayer contract)', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('a', 4),
          rendered('b', 3),
          rendered('c', 2),
          rendered('d', 1),
        ]}
        totalCount={10}
        uniqueFamilies={4}
        ariaLabel="Cluster: 10 observations, 4 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    // The outer <button> IS the click surface and must be tabIndex=-1
    // (per spec §4.7 — keyboard users navigate via the skip-link to FeedSurface).
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('tabindex')).toBe('-1');
  });

  it('per-axis hit-extender — 2×1 grid extends BOTH width AND height to ≥ 44', () => {
    // A 2×1 grid is 52×28 visible (2*22 + 2*3 padding + 2 gap = 52 wide;
    // 1*22 + 2*3 padding = 28 tall). The corrected per-axis hit-extender
    // must inflate the HEIGHT to ≥44 even though width already exceeds 44.
    // This test catches the bug from issue #541: a single-scalar `inset`
    // using max(w,h) would leave the short axis at 28px.
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x1}
        tiles={[rendered('a', 5), rendered('b', 3)]}
        totalCount={8}
        uniqueFamilies={2}
        ariaLabel="Cluster: 8 observations, 2 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const hit = screen.getByTestId('adaptive-grid-marker-hit');
    // The hit element uses inline `top/bottom/left/right` to extend outward.
    // Parse the numeric pixel values (negative inset means extends OUTWARD).
    const s = hit.style;
    // negative px values extend the box; assert the resulting bounding extent
    // (markerSize + |top| + |bottom|) ≥ 44 on both axes.
    const parsePx = (v: string): number => Number(v.replace('px', '')) || 0;
    const top = parsePx(s.top);
    const bottom = parsePx(s.bottom);
    const left = parsePx(s.left);
    const right = parsePx(s.right);

    const markerWidth = 2 * 22 + 1 * 2 + 2 * 3; // 52
    const markerHeight = 1 * 22 + 0 * 2 + 2 * 3; // 28
    const totalWidth = markerWidth + Math.abs(left) + Math.abs(right);
    const totalHeight = markerHeight + Math.abs(top) + Math.abs(bottom);

    expect(totalWidth).toBeGreaterThanOrEqual(44);
    expect(totalHeight).toBeGreaterThanOrEqual(44);
  });

  // --- Dark-mode badge box-shadow ------------------------------------------

  it('dark-mode badge has 1px white box-shadow stroke (WCAG 1.4.11 contrast)', () => {
    // Apply data-theme=dark to the documentElement before render.
    const prior = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      render(
        <AdaptiveGridMarker
          shape={SHAPE_1x1}
          tiles={[rendered('accipitridae', 5)]}
          totalCount={5}
          uniqueFamilies={1}
          ariaLabel="Cluster: 5 observations, 1 family. Activate to zoom in."
          onClick={noop}
        />,
      );
      const badge = screen.getByTestId('adaptive-grid-marker-badge');
      // Style is applied either inline OR via the .adaptive-grid-marker__badge
      // rule (Task 1.6). jsdom does not load <link> stylesheets, but inline
      // style on the badge is the implementation contract. Check inline first,
      // fall back to computed.
      const shadow =
        badge.style.boxShadow || window.getComputedStyle(badge).boxShadow || '';
      expect(shadow).toMatch(/(rgba\(255,\s*255,\s*255|#fff|white)/i);
      expect(shadow).toMatch(/1px/);
    } finally {
      if (prior === null) document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', prior);
    }
  });

  // --- Notable indicator (AC8 — inherited from StackedSilhouetteMarker) ---

  it('notable indicator: isNotable=true renders amber <circle> ring inside SVG, ordered BEFORE halo path', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Cooper's Hawk."
        isNotable={true}
        notableSpeciesName="Cooper's Hawk"
        onClick={noop}
      />,
    );
    const circles = document.querySelectorAll('svg circle');
    expect(circles.length).toBeGreaterThanOrEqual(1);
    const ring = circles[0];
    expect(ring.getAttribute('stroke')).toBe('#f59e0b');
    expect(ring.getAttribute('fill')).toBe('none');
    // DOM order: the circle must precede the silhouette <path> within the SVG.
    const svg = ring.closest('svg')!;
    const children = Array.from(svg.children);
    const ringIdx = children.indexOf(ring);
    const firstPathIdx = children.findIndex((c) => c.tagName.toLowerCase() === 'path');
    expect(ringIdx).toBeLessThan(firstPathIdx);
  });

  it('notable indicator: isNotable=false (or undefined) renders NO amber circle', () => {
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Cooper's Hawk."
        isNotable={false}
        onClick={noop}
      />,
    );
    const circles = document.querySelectorAll('svg circle');
    expect(circles.length).toBe(0);
  });
});
