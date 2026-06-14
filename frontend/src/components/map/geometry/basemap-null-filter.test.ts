import { describe, it, expect, vi } from 'vitest';
import {
  isNullProneComparison,
  nullSafeFilter,
  sanitizeNullNumericFilters,
} from './basemap-null-filter.js';

/* ──────────────────────────────────────────────────────────────────────────
   #1027 [O8] — the upstream OpenFreeMap positron style emits 4×
   "Expected value to be of type number, but found null instead." at z14.

   Root cause: 4 layers active at z14 filter on a numeric data property that is
   NULL on many features —
     - `highway-shield-non-us`, `highway-shield-us-interstate`, `road_shield_us`
       → `["<=", ["get", "ref_length"], 6]` (roads with no `ref` carry no
         `ref_length`),
     - `boundary_3` → `[">=", ["get", "admin_level"], 3]` / `["<=", …, 6]`.
   When the comparison's left operand evaluates to null, MapLibre logs the
   warning once per layer per evaluation, dirtying a console the repo holds to a
   zero-warning bar.

   The fix is a STRUCTURAL, fail-open style transform (no hardcoded layer-id
   list — the two basemaps use different id conventions): rewrite every filter
   sub-expression of shape `[<numeric-op>, ["get", <prop>], <num>]` into
   `["all", ["has", <prop>], <original>]`. `has` short-circuits the `all` to
   `false` when the property is absent, so the null comparison is never
   evaluated — and the visual outcome is IDENTICAL to today (a null operand
   already resolved the comparison to false → no shield / no boundary). The
   property-present branch runs the original comparison unchanged.
   ────────────────────────────────────────────────────────────────────────── */

describe('isNullProneComparison', () => {
  it('flags a numeric comparison whose left operand is ["get", <prop>]', () => {
    expect(isNullProneComparison(['<=', ['get', 'ref_length'], 6])).toBe(true);
    expect(isNullProneComparison(['>=', ['get', 'admin_level'], 3])).toBe(true);
    expect(isNullProneComparison(['>', ['get', 'rank'], 3])).toBe(true);
    expect(isNullProneComparison(['<', ['get', 'rank'], 2])).toBe(true);
  });

  it('does NOT flag equality / membership ops (== / != tolerate null without warning)', () => {
    expect(isNullProneComparison(['==', ['get', 'class'], 'city'])).toBe(false);
    expect(isNullProneComparison(['!=', ['get', 'capital'], 2])).toBe(false);
  });

  it('does NOT flag a comparison whose operand is not a bare ["get", prop]', () => {
    // a `zoom` comparison never reads a (nullable) feature property
    expect(isNullProneComparison(['<=', ['zoom'], 6])).toBe(false);
    // an already-guarded coalesce operand is not bare-get
    expect(
      isNullProneComparison(['<=', ['coalesce', ['get', 'ref_length'], 99], 6]),
    ).toBe(false);
  });

  it('ignores non-arrays / short arrays', () => {
    expect(isNullProneComparison(undefined)).toBe(false);
    expect(isNullProneComparison(null)).toBe(false);
    expect(isNullProneComparison(['<='])).toBe(false);
    expect(isNullProneComparison('not-an-array')).toBe(false);
  });
});

describe('nullSafeFilter', () => {
  it('wraps a bare null-prone comparison in ["all", ["has", prop], <original>]', () => {
    const original = ['<=', ['get', 'ref_length'], 6];
    expect(nullSafeFilter(original)).toEqual([
      'all',
      ['has', 'ref_length'],
      ['<=', ['get', 'ref_length'], 6],
    ]);
  });

  it('rewrites null-prone comparisons NESTED inside an ["all", …] filter', () => {
    const original = [
      'all',
      ['<=', ['get', 'ref_length'], 6],
      ['match', ['get', 'network'], ['us-interstate'], true, false],
    ];
    expect(nullSafeFilter(original)).toEqual([
      'all',
      ['all', ['has', 'ref_length'], ['<=', ['get', 'ref_length'], 6]],
      ['match', ['get', 'network'], ['us-interstate'], true, false],
    ]);
  });

  it('rewrites BOTH comparisons in a two-sided range filter (boundary_3 shape)', () => {
    const original = [
      'all',
      ['>=', ['get', 'admin_level'], 3],
      ['<=', ['get', 'admin_level'], 6],
      ['!=', ['get', 'maritime'], 1],
    ];
    expect(nullSafeFilter(original)).toEqual([
      'all',
      ['all', ['has', 'admin_level'], ['>=', ['get', 'admin_level'], 3]],
      ['all', ['has', 'admin_level'], ['<=', ['get', 'admin_level'], 6]],
      ['!=', ['get', 'maritime'], 1],
    ]);
  });

  it('is a no-op for a filter with no null-prone comparison (returns null = unchanged)', () => {
    const original = ['==', ['get', 'class'], 'city'];
    expect(nullSafeFilter(original)).toBeNull();
  });

  it('returns null for an absent filter (nothing to rewrite)', () => {
    expect(nullSafeFilter(undefined)).toBeNull();
    expect(nullSafeFilter(null)).toBeNull();
  });

  it('is IDEMPOTENT — re-running over an already-guarded filter is a no-op', () => {
    const once = nullSafeFilter(['<=', ['get', 'ref_length'], 6]);
    expect(once).not.toBeNull();
    // the guarded form has no BARE null-prone comparison left, so a second pass
    // finds nothing to rewrite.
    expect(nullSafeFilter(once)).toBeNull();
  });
});

/* ── sanitizeNullNumericFilters (map-level pass) ──────────────────────────── */

function makeMockMap(
  layers: Array<{ id: string; type: string; filter?: unknown }>,
) {
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  return {
    layers,
    getStyle: vi.fn(() => ({ layers })),
    getFilter: vi.fn((id: string) => byId[id]?.filter),
    setFilter: vi.fn((id: string, filter: unknown) => {
      if (byId[id]) byId[id].filter = filter;
    }),
  };
}

describe('sanitizeNullNumericFilters (style-load pass — fails OPEN)', () => {
  it('rewrites ONLY layers with a null-prone numeric comparison, by structure not id', () => {
    const map = makeMockMap([
      { id: 'background', type: 'background' },
      {
        id: 'road_shield_us',
        type: 'symbol',
        filter: ['all', ['<=', ['get', 'ref_length'], 6], ['==', ['get', 'class'], 'road']],
      },
      // hyphen-id variant — same structural rewrite, no id list
      {
        id: 'highway-shield-non-us',
        type: 'symbol',
        filter: ['<=', ['get', 'ref_length'], 6],
      },
      // a label layer with NO null-prone comparison — must be left untouched
      { id: 'label_city', type: 'symbol', filter: ['==', ['get', 'class'], 'city'] },
    ]);

    sanitizeNullNumericFilters(map as never);

    // both shield layers rewritten…
    expect(map.setFilter).toHaveBeenCalledWith('road_shield_us', [
      'all',
      ['all', ['has', 'ref_length'], ['<=', ['get', 'ref_length'], 6]],
      ['==', ['get', 'class'], 'road'],
    ]);
    expect(map.setFilter).toHaveBeenCalledWith('highway-shield-non-us', [
      'all',
      ['has', 'ref_length'],
      ['<=', ['get', 'ref_length'], 6],
    ]);
    // …the unaffected label layer is NOT touched.
    expect(
      map.setFilter.mock.calls.some((c) => c[0] === 'label_city'),
    ).toBe(false);
    expect(map.setFilter.mock.calls.some((c) => c[0] === 'background')).toBe(false);
  });

  it('is idempotent at the map level — a second pass calls setFilter zero times', () => {
    const map = makeMockMap([
      { id: 'road_shield_us', type: 'symbol', filter: ['<=', ['get', 'ref_length'], 6] },
    ]);
    sanitizeNullNumericFilters(map as never);
    map.setFilter.mockClear();
    sanitizeNullNumericFilters(map as never);
    expect(map.setFilter).not.toHaveBeenCalled();
  });

  it('fails OPEN: a getStyle/getFilter that throws does not propagate', () => {
    const map = {
      getStyle: vi.fn(() => {
        throw new Error('style churn after swap');
      }),
      getFilter: vi.fn(),
      setFilter: vi.fn(),
    };
    expect(() => sanitizeNullNumericFilters(map as never)).not.toThrow();
  });

  it('no-ops when the style has no layers (reconcile window)', () => {
    const map = {
      getStyle: vi.fn(() => ({})),
      getFilter: vi.fn(),
      setFilter: vi.fn(),
    };
    expect(() => sanitizeNullNumericFilters(map as never)).not.toThrow();
    expect(map.setFilter).not.toHaveBeenCalled();
  });
});
