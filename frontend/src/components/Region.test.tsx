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
});

describe('computeExpandTransform scale cap (ticket 04 / issue #88)', () => {
  // Bboxes derived from migrations/1700000008000_seed_regions.sql +
  // 1700000011000_fix_region_boundaries.sql + 1700000012000_fix_sky_islands_boundaries.sql.
  // Keep this table in sync if a future migration moves any region.
  // Paths are simplified axis-aligned rectangles with the same bbox as the
  // real polygon — computeExpandTransform only reads the bbox, so only the
  // bbox has to match the migration geometry for this cap assertion to be
  // load-bearing.
  const CASES: Array<{ id: string; path: string; w: number; h: number }> = [
    { id: 'colorado-plateau',        path: 'M 0 0 L 360 0 L 360 180 L 0 180 Z',                                       w: 360,     h: 180     },
    { id: 'mogollon-rim',            path: 'M 46.552 160 L 360 160 L 360 253.333 L 46.552 253.333 Z',                  w: 313.448, h: 93.333  },
    { id: 'sonoran-phoenix',         path: 'M 52.759 206.667 L 238.966 206.667 L 238.966 366.667 L 52.759 366.667 Z', w: 186.207, h: 160.0   },
    { id: 'lower-colorado',          path: 'M 0 46.667 L 52.759 46.667 L 52.759 376.667 L 0 376.667 Z',                w: 52.759,  h: 330.0   },
    { id: 'sonoran-tucson',          path: 'M 207.931 233.333 L 360 233.333 L 360 380 L 207.931 380 Z',                w: 152.069, h: 146.667 },
    // Post-migration-12000: Santa Ritas was clamped to its sonoran-tucson
    // parent's west wall, so bbox is w=27.931, h=36.666 (was 40.3×38.0 in
    // the original ticket scale table).
    { id: 'sky-islands-santa-ritas', path: 'M 238.966 326.667 L 266.897 326.667 L 266.897 363.333 L 238.966 363.333 Z', w: 27.931,  h: 36.666 },
    { id: 'sky-islands-huachucas',   path: 'M 265.0 336.7 L 297.9 336.7 L 297.9 373.3 L 265.0 373.3 Z',                w: 32.9,    h: 36.6    },
    { id: 'sky-islands-chiricahuas', path: 'M 325.9 318.7 L 360.0 318.7 L 360.0 365.3 L 325.9 365.3 Z',                w: 34.1,    h: 46.6    },
    { id: 'grand-canyon',            path: 'M 52.8 33.3 L 189.3 33.3 L 189.3 90.0 L 52.8 90.0 Z',                      w: 136.5,   h: 56.7    },
  ];
  const VB = { w: 360, h: 380 };
  const CAP = 0.60;

  for (const { id, path, w, h } of CASES) {
    it(`caps ${id}: scaled bbox <= ${CAP}·viewBox on both axes`, () => {
      const t = computeExpandTransform(path, VB);
      const match = t.match(/scale\(([-\d.]+)\)$/);
      expect(match, `expected scale(n) suffix, got: ${t}`).toBeTruthy();
      const scale = parseFloat(match![1]!);
      const expectedCapScale = Math.min((VB.w * CAP) / w, (VB.h * CAP) / h);
      // The capped scale should be exactly capScale (every seeded region is
      // small enough that capScale < targetScale — see the ticket's scale
      // table). A regression that drops the cap will multiply this by
      // 1/CAP × EXPAND_PAD/CAP depending on the axis.
      expect(scale).toBeCloseTo(expectedCapScale, 6);
      // Core invariant: scaled bbox fits inside CAP of the viewBox.
      expect(scale * w).toBeLessThanOrEqual(VB.w * CAP + 1e-9);
      expect(scale * h).toBeLessThanOrEqual(VB.h * CAP + 1e-9);
    });
  }
});
