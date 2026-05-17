import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AdaptiveGridMarker } from './AdaptiveGridMarker.js';
import { markerDimensions, MIN_MARKER_PX } from './AdaptiveGridMarker.js';
import type { AdaptiveTile, ResolvedGrid, PositiveInt, SpeciesAggregate } from './adaptive-grid.js';
import { toPositiveInt } from './adaptive-grid.js';
import { setMatchMedia } from '../../test-setup.js';

// Helpers --------------------------------------------------------------------

function rendered(
  familyCode: string,
  count: number,
  svgData = 'M0 0L24 24Z',
  color = '#C77A2E',
  colorDark = '#c3772d',
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return { kind: 'rendered', familyCode, count, svgData, color, colorDark, species };
}

function fallback(
  familyCode: string,
  count: number,
  color = '#888888',
  colorDark = '#888888',
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return { kind: 'fallback', familyCode, count, color, colorDark, species };
}

function pending(
  familyCode: string,
  count: number,
  species: ReadonlyArray<SpeciesAggregate> = [],
): AdaptiveTile {
  return { kind: 'pending', familyCode, count, species };
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

  it('hides badge for cells with count === 1 even in multi-cell clusters', () => {
    // Regression for issue #552: per spec §4.3 line 124 the badge is hidden
    // when `cell.count === 1`, regardless of the cluster's total. The prior
    // `totalCount > 1 || cellCount > 1` guard caused every count=1 cell in
    // a multi-cell cluster to render a "1" badge. Fixture uses ties at 1 so
    // we pin "count=1 → silhouette-only" rather than just descending order.
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[rendered('a', 3), rendered('b', 1), rendered('c', 1), rendered('d', 1)]}
        totalCount={6}
        uniqueFamilies={4}
        ariaLabel="Cluster: 6 observations, 4 families. Activate to zoom in."
        onClick={noop}
      />,
    );
    const badges = screen.queryAllByTestId('adaptive-grid-marker-badge');
    expect(badges).toHaveLength(1); // only the count=3 cell gets a badge
    expect(badges[0].textContent).toBe('3');
  });

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

  // --- Fallback tile opacity + border affordance ---------------------------

  it('renders fallback tile at opacity 0.85 for tiles with kind === "fallback" (Phase 2: #571)', () => {
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
    expect(Number(opacity)).toBeCloseTo(0.85, 2);
  });

  it('fallback cell has inline color set to tile.color so currentColor resolves for dashed border (Phase 2: #571)', () => {
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
    // The dashed border in ds-primitives.css uses `currentColor`.
    // For currentColor to resolve to the family tile color (not the body text color),
    // the parent element must carry `color: tile.color` as an inline style.
    // jsdom does not apply stylesheets but does reflect inline style, so this is
    // the jsdom-readable contract for "border will render in tile.color".
    // The fallback() helper defaults color='#888888' (see fixture at line 21).
    // jsdom normalizes hex to rgb() when reading back inline style properties.
    expect(fallbackCell.style.color).toBe('rgb(136, 136, 136)');
  });

  it('fallback cell (button branch, pointer:fine) has inline color set and no inline border suppression so dashed class rule applies (Phase 2: #571 BLOCKER-1b)', () => {
    // Simulate a fine-pointer (desktop/mouse) viewport so the button branch fires.
    setMatchMedia(q => q === '(pointer: fine)');
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
    // Verify the button branch actually fired (not the div branch).
    expect(fallbackCell.tagName).toBe('BUTTON');
    // BLOCKER-1a regression check: color must be wired so currentColor resolves.
    // jsdom normalizes #888888 → rgb(136, 136, 136) when reading inline style.
    expect(fallbackCell.style.color).toBe('rgb(136, 136, 136)');
    // BLOCKER-1b regression check: no inline border suppression.
    // The dashed border comes from the CSS class rule
    // `.adaptive-grid-marker__cell--fallback { border: 1.5px dashed currentColor }`.
    // An inline `border: 'none'` outranks that class rule via specificity.
    // The contract here: inline style must NOT suppress the border,
    // i.e. fallbackCell.style.border must be empty string.
    expect(fallbackCell.style.border).toBe('');
  });

  // --- Pending skeleton -----------------------------------------------------

  it('renders pending skeleton (NOT opacity-0.85 fallback) when ALL tiles kind: "pending"', () => {
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
    // None of the pending cells should carry the fallback opacity (skeleton ≠ fallback).
    for (const cell of pendingCells) {
      const op = cell.style.opacity;
      expect(op === '' || Number(op) !== 0.85).toBe(true);
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

  // --- Theme-aware tile fill (Phase 1, #570) ---------------------------------

  describe('theme-aware tile fill (Phase 1, #570)', () => {
    /**
     * Reads the fill of the last SVG path in the rendered cell. Phase 3 (#572)
     * migrated fill from an HTML attribute to an inline style property so that
     * forcedColorAdjust can be set on the same element. jsdom normalises inline
     * colour values to rgb(...) — this helper converts back to lowercase hex so
     * the assertions remain in the original hex form.
     */
    function findRenderedFill(container: HTMLElement): string | null {
      const path = container.querySelector(
        '[data-testid="adaptive-grid-marker-cell-rendered"] svg path:last-child'
      ) as HTMLElement | null;
      if (!path) return null;
      // Phase 3: fill is now in inline style; fall back to attribute for
      // any paths that still carry it as an attribute (e.g. halo path).
      const raw = path.style.fill || path.getAttribute('fill');
      if (!raw) return null;
      // Normalise rgb(r, g, b) → lowercase hex for deterministic assertions.
      const rgbMatch = raw.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
      if (rgbMatch) {
        const [, r, g, b] = rgbMatch.map(Number);
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
      }
      return raw.toLowerCase();
    }

    it('light theme renders tile.color in the SVG fill', () => {
      const prior = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', 'light');
      try {
        const { container } = render(
          <AdaptiveGridMarker
            shape={SHAPE_1x1}
            tiles={[rendered('tyrannidae', 5, undefined, '#c3772d', '#C77A2E')]}
            totalCount={5}
            uniqueFamilies={1}
            ariaLabel="..."
            onClick={noop}
          />
        );
        expect(findRenderedFill(container)).toBe('#c3772d');
      } finally {
        if (prior === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', prior);
      }
    });

    it('dark theme renders tile.colorDark in the SVG fill', () => {
      const prior = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', 'dark');
      try {
        const { container } = render(
          <AdaptiveGridMarker
            shape={SHAPE_1x1}
            tiles={[rendered('tyrannidae', 5, undefined, '#c3772d', '#C77A2E')]}
            totalCount={5}
            uniqueFamilies={1}
            ariaLabel="..."
            onClick={noop}
          />
        );
        // dark theme uses colorDark = '#C77A2E' → normalised to lowercase hex.
        expect(findRenderedFill(container)).toBe('#c77a2e');
      } finally {
        if (prior === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', prior);
      }
    });

    it('theme attribute change updates the fill via useTheme MutationObserver', async () => {
      const prior = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', 'light');
      try {
        const { container } = render(
          <AdaptiveGridMarker
            shape={SHAPE_1x1}
            tiles={[rendered('tyrannidae', 5, undefined, '#c3772d', '#C77A2E')]}
            totalCount={5}
            uniqueFamilies={1}
            ariaLabel="..."
            onClick={noop}
          />
        );
        expect(findRenderedFill(container)).toBe('#c3772d');

        // Trigger theme switch — MutationObserver fires, useTheme re-renders
        act(() => {
          document.documentElement.setAttribute('data-theme', 'dark');
        });

        // Wait one tick for the observer callback + React re-render
        await new Promise(r => setTimeout(r, 50));

        // dark theme uses colorDark = '#C77A2E' → normalised to lowercase hex.
        expect(findRenderedFill(container)).toBe('#c77a2e');
      } finally {
        if (prior === null) document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', prior);
      }
    });
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

  // --- Phase 3 (#572): forced-colors support — forcedColorAdjust: 'auto' on SVG path ---

  it('rendered cell SVG path has forcedColorAdjust: "auto" in inline style (Phase 3, #572)', () => {
    const { container } = render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('accipitridae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Cooper's Hawk."
        onClick={noop}
      />,
    );
    // The silhouette path (last <path> in the SVG) must carry forcedColorAdjust: 'auto'
    // so Windows WHCM system-color remapping engages. jsdom reads inline style
    // via el.style.forcedColorAdjust or the camelCase property.
    const paths = container.querySelectorAll(
      '[data-testid="adaptive-grid-marker-cell-rendered"] svg path',
    );
    // The rendered cell has at minimum: halo path + silhouette path.
    // The silhouette path is the last one.
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const silhouettePath = paths[paths.length - 1] as HTMLElement;
    // forcedColorAdjust is set via React's style prop — readable via el.style.
    // React may map it as 'forced-color-adjust' or 'forcedColorAdjust' depending
    // on the React version's camelCase-to-CSS-prop mapping. Check both.
    const adjustValue =
      silhouettePath.style.getPropertyValue('forced-color-adjust') ||
      (silhouettePath.style as unknown as Record<string, string>).forcedColorAdjust;
    expect(adjustValue).toBe('auto');
  });

  it('fallback cell SVG path has forcedColorAdjust: "auto" in inline style (Phase 3, #572)', () => {
    const { container } = render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[fallback('mimidae', 1)]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation."
        onClick={noop}
      />,
    );
    const paths = container.querySelectorAll(
      '[data-testid="adaptive-grid-marker-cell-fallback"] svg path',
    );
    expect(paths.length).toBeGreaterThanOrEqual(1);
    const svgPath = paths[0] as HTMLElement;
    const adjustValue =
      svgPath.style.getPropertyValue('forced-color-adjust') ||
      (svgPath.style as unknown as Record<string, string>).forcedColorAdjust;
    expect(adjustValue).toBe('auto');
  });
});

describe('markerDimensions', () => {
  it('1×1 grid → 28×28 (matches MIN_MARKER_PX)', () => {
    expect(markerDimensions({ tag: 'grid', cols: 1, rows: 1 })).toEqual({ w: 28, h: 28 });
    expect(MIN_MARKER_PX).toBe(28);
  });
  it('2×1 grid → 52×28', () => {
    expect(markerDimensions({ tag: 'grid', cols: 2, rows: 1 })).toEqual({ w: 52, h: 28 });
  });
  it('2×2 grid → 52×52', () => {
    expect(markerDimensions({ tag: 'grid', cols: 2, rows: 2 })).toEqual({ w: 52, h: 52 });
  });
  it('3×3 grid → 76×76', () => {
    expect(markerDimensions({ tag: 'grid', cols: 3, rows: 3 })).toEqual({ w: 76, h: 76 });
  });
  it('4×4 grid → 100×100 (the worst-case overlap source per issue #554)', () => {
    expect(markerDimensions({ tag: 'grid', cols: 4, rows: 4 })).toEqual({ w: 100, h: 100 });
  });
});

// --- Phase 1 (#558): flag-gated per-cell trigger surface ----------------------

describe('AdaptiveGridMarker — cell popover (Phase 1, #558)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Default matchMedia stub: pointer:fine = true, pointer:coarse = false.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: fine)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('pointer:fine: <TileCell> renders as <button> with ARIA wiring', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.getAttribute('aria-haspopup')).toBe('dialog');
    expect(cell.getAttribute('aria-expanded')).toBe('false');
    // Spec §4.8: aria-describedby is only present on the ACTIVE cell.
    // Before hover/focus, no cell is active, so it must be absent.
    expect(cell.getAttribute('aria-describedby')).toBeNull();
  });

  it('pointer:fine: active cell gets aria-describedby, inactive cells do not (spec §4.8)', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x1}
        tiles={[
          rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
            { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
          ]),
          rendered('accipitridae', 3, 'M0 0L24 24Z', '#C77A2E', '#c3772d', [
            { comName: "Cooper's Hawk", count: 3, speciesCode: 'coohaw' },
          ]),
        ]}
        totalCount={8}
        uniqueFamilies={2}
        ariaLabel="Cluster: 8 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cells = screen.getAllByTestId('adaptive-grid-marker-cell-rendered');
    expect(cells).toHaveLength(2);

    // Hover the first cell to make it active.
    fireEvent.mouseEnter(cells[0]);

    // Active cell (index 0) carries aria-describedby pointing at the preview element.
    const activeDescribedBy = cells[0].getAttribute('aria-describedby');
    expect(activeDescribedBy).toMatch(/^cell-.*-preview$/);

    // Inactive cell (index 1) must NOT carry aria-describedby.
    expect(cells[1].getAttribute('aria-describedby')).toBeNull();

    // The rendered <CellHoverPreview> must have the matching id (both sides wired).
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.id).toBe(activeDescribedBy);
  });

  it('pointer:fine: hit-extender computed pointer-events is "none"', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const hit = screen.getByTestId('adaptive-grid-marker-hit');
    expect(hit.style.pointerEvents).toBe('none');
  });

  it('pointer:coarse: hit-extender computed pointer-events is "auto" (mobile preserves whole-marker tap)', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={true}
        onClick={noop}
      />
    );
    const hit = screen.getByTestId('adaptive-grid-marker-hit');
    expect(hit.style.pointerEvents).toBe('auto');
  });

  it('pointer:fine: mouseenter on a cell triggers <CellHoverPreview> render', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByText(/Hummingbirds \(5\)/)).toBeInTheDocument();
  });

  // --- Fix 1: outer element tag per perCellInteractive state (nested-button guard) ---

  it('pointer:fine → outer is <div role="group" data-testid="adaptive-grid-marker"> (no nested buttons)', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5)]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    expect(outer.tagName).toBe('DIV');
    // role="group" is name-allowed (ARIA 1.2) — aria-label is preserved.
    expect(outer.getAttribute('role')).toBe('group');
    // aria-label must still be present for SR coherence (name-prohibited regression guard).
    expect(outer.getAttribute('aria-label')).toBe('Cluster: 5 observations.');
  });

  // --- Fix 2: mouseleave timer cleanup on unmount (#558 fix2) ----------

  it('clears pending mouseLeaveTimers on unmount (#558 fix2)', async () => {
    vi.useFakeTimers();
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const { unmount, container } = render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = container.querySelector('[data-testid="adaptive-grid-marker-cell-rendered"]')!;
    // Trigger a mouseleave to start a pending 250ms timer.
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    // At this point one timer should be pending.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // Unmount — cleanup useEffect should clear the timer.
    act(() => { unmount(); });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('pointer:fine: Enter on a focused cell promotes preview to popover', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(cell.getAttribute('aria-expanded')).toBe('true');
  });

  it('pointer:fine: mouseEnter → mouseMove → CellHoverPreview has position:fixed at cursor+16/+12', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
        ])]}
        totalCount={5}
        uniqueFamilies={1}
        ariaLabel="Cluster: 5 observations."
        isCoarsePointer={false}
        onClick={noop}
      />
    );
    const cell = screen.getByTestId('adaptive-grid-marker-cell-rendered');
    fireEvent.mouseEnter(cell);
    fireEvent.mouseMove(cell, { clientX: 300, clientY: 400 });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.position).toBe('fixed');
    expect(tooltip.style.left).toBe('316px');
    expect(tooltip.style.top).toBe('412px');
  });
});

// --- Phase 2 (#559): coarse-pointer cluster list popover ---------------------

describe('AdaptiveGridMarker — cell popover coarse-pointer (Phase 2, #559)', () => {
  beforeEach(() => {
    vi.resetModules();
    // Coarse-pointer matchMedia stub: pointer:coarse = true, pointer:fine = false.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === '(pointer: coarse)',
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('coarse + multi-leaf: outer-button tap opens <ClusterListPopover> AND suppresses onClick', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const onClick = vi.fn();
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('hummingbirds', 5, 'M0 0L24 24Z', '#888', '#888', [
            { comName: "Anna's Hummingbird", count: 5, speciesCode: 'annhum' },
          ]),
          rendered('flycatchers', 12, 'M0 0L24 24Z', '#aaa', '#aaa', [
            { comName: 'Black Phoebe', count: 12, speciesCode: 'blkpho' },
          ]),
        ]}
        totalCount={17}
        uniqueFamilies={2}
        ariaLabel="Cluster: 17 observations, 2 families."
        isCoarsePointer={true}
        onClick={onClick}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    expect(outer.tagName).toBe('BUTTON');
    fireEvent.click(outer);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Cluster: 17 observations, 2 families/)).toBeInTheDocument();
    // onClick (zoom-to-expansion handler) must NOT fire on coarse + flag-ON.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('coarse + single-leaf (totalCount===1): outer-button tap calls onClick (NOT cluster list popover)', async () => {
    const { AdaptiveGridMarker } = await import('./AdaptiveGridMarker.js');
    const onClick = vi.fn();
    render(
      <AdaptiveGridMarker
        shape={SHAPE_1x1}
        tiles={[rendered('hummingbirds', 1, 'M0 0L24 24Z', '#888', '#888', [
          { comName: "Anna's Hummingbird", count: 1, speciesCode: 'annhum' },
        ])]}
        totalCount={1}
        uniqueFamilies={1}
        ariaLabel="Single observation: Anna's Hummingbird."
        isCoarsePointer={true}
        onClick={onClick}
      />
    );
    const outer = screen.getByTestId('adaptive-grid-marker');
    fireEvent.click(outer);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cell button chrome-reset cascade (badge-anchor bugfix)
// ---------------------------------------------------------------------------
// Verifies that neither the rendered-branch button nor the fallback-branch
// button carries an inline `all: unset` declaration. `all: unset` resets
// `position` to `static`, which overrides the class-level `position: relative`
// and causes the absolutely-positioned badge to escape to the nearest
// grid-level positioned ancestor — the user-visible bug: every badge in a
// multi-cell cluster stacks at the same grid corner.
//
// We do NOT use getBoundingClientRect here because jsdom returns {0,0,0,0}
// for all rects (no layout engine). The contract is tested directly: if no
// inline `all:` declaration is present, the class-level `position: relative`
// survives, and badge anchoring is correct. The real-browser layout assertion
// is covered by badge-anchor.spec.ts (Playwright e2e).
// ---------------------------------------------------------------------------

describe('cell button chrome-reset cascade (badge-anchor bugfix)', () => {
  it('rendered cell (button branch, pointer:fine) does NOT carry inline `all: unset` so class `position: relative` survives for badge anchoring', () => {
    setMatchMedia(q => q === '(pointer: fine)');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          rendered('tyrannidae', 5),
          rendered('trochilidae', 3),
          rendered('picidae', 2),
          rendered('corvidae', 1),
        ]}
        totalCount={11}
        uniqueFamilies={4}
        ariaLabel="Cluster: 11 observations, 4 families. Activate to zoom in."
        onClick={() => {}}
      />,
    );
    const cell = screen.getAllByTestId('adaptive-grid-marker-cell-rendered')[0];
    expect(cell.tagName).toBe('BUTTON');
    // The bug: `all: unset` inline overrides class's `position: relative`,
    // so the badge (position: absolute) escapes to the grid's positioned
    // ancestor instead of anchoring to the cell. Direct test of the contract:
    // no inline `all:` declaration of any kind.
    expect(cell.getAttribute('style') ?? '').not.toMatch(/\ball\s*:/);
  });

  it('fallback cell (button branch, pointer:fine) does NOT carry inline `all: unset` (regression pin from PR #579)', () => {
    setMatchMedia(q => q === '(pointer: fine)');
    render(
      <AdaptiveGridMarker
        shape={SHAPE_2x2}
        tiles={[
          fallback('mimidae', 5),
          fallback('turdidae', 3),
          fallback('parulidae', 2),
          fallback('cardinalidae', 1),
        ]}
        totalCount={11}
        uniqueFamilies={4}
        ariaLabel="Cluster: 11 observations, 4 families. Activate to zoom in."
        onClick={() => {}}
      />,
    );
    const cell = screen.getAllByTestId('adaptive-grid-marker-cell-fallback')[0];
    expect(cell.tagName).toBe('BUTTON');
    expect(cell.getAttribute('style') ?? '').not.toMatch(/\ball\s*:/);
  });
});
