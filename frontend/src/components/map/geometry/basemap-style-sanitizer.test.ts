import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isNullProneComparison,
  nullSafeFilter,
  sanitizeStyleNullNumeric,
  transformStyleSanitizeNull,
  loadSanitizedStyle,
} from './basemap-style-sanitizer.js';

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

/* ── sanitizeStyleNullNumeric (PRE-WORKER style-JSON pass — #1230) ─────────────
   The new `bright`/`liberty` basemaps ship POI rank filters
   (`["<", ["get","rank"], 20]` on `poi_r7`, `[">=", ["get","rank"], 1]` on
   `poi_r1`, …) that the WORKER trips on while compiling the style, BEFORE the
   main-thread `style.load` sanitizer can run. The pure style-JSON sanitizer is
   applied via `setStyle(url, { transformStyle })`, which rewrites the style
   before the worker commits it — so the worker never sees the raw null-prone
   expression and the `warnOnce` never fires.
   ──────────────────────────────────────────────────────────────────────────── */

describe('sanitizeStyleNullNumeric (pure style-JSON pass)', () => {
  it('null-guards a bright-like POI rank FILTER (the new-style-specific warner)', () => {
    const style = {
      version: 8,
      layers: [
        {
          id: 'poi_r7',
          type: 'symbol',
          minzoom: 16,
          filter: [
            'all',
            ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
            ['>=', ['get', 'rank'], 7],
            ['<', ['get', 'rank'], 20],
          ],
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out).not.toBe(style); // a new object — original untouched
    expect(out.layers[0].filter).toEqual([
      'all',
      ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
      ['all', ['has', 'rank'], ['>=', ['get', 'rank'], 7]],
      ['all', ['has', 'rank'], ['<', ['get', 'rank'], 20]],
    ]);
    // input not mutated
    expect(style.layers[0].filter).toEqual([
      'all',
      ['match', ['geometry-type'], ['MultiPoint', 'Point'], true, false],
      ['>=', ['get', 'rank'], 7],
      ['<', ['get', 'rank'], 20],
    ]);
  });

  it('null-guards a null-prone numeric comparison in a PAINT expression', () => {
    const style = {
      layers: [
        {
          id: 'l',
          type: 'symbol',
          paint: {
            // a bright-like null-prone numeric op nested in a paint case
            'text-opacity': ['case', ['<', ['get', 'rank'], 5], 0.5, 1],
            'text-color': '#000', // a plain literal — left untouched
          },
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out.layers[0].paint?.['text-opacity']).toEqual([
      'case',
      ['all', ['has', 'rank'], ['<', ['get', 'rank'], 5]],
      0.5,
      1,
    ]);
    expect(out.layers[0].paint?.['text-color']).toBe('#000');
  });

  it('null-guards a null-prone numeric comparison in a LAYOUT expression', () => {
    const style = {
      layers: [
        {
          id: 'l',
          type: 'symbol',
          layout: {
            'icon-size': ['step', ['zoom'], 1, 10, ['case', ['>', ['get', 'rank'], 3], 2, 1]],
          },
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out.layers[0].layout?.['icon-size']).toEqual([
      'step',
      ['zoom'],
      1,
      10,
      ['case', ['all', ['has', 'rank'], ['>', ['get', 'rank'], 3]], 2, 1],
    ]);
  });

  it('returns a positron-like already-safe style UNCHANGED (same reference — idempotent)', () => {
    // positron's only numeric comparisons are equality / zoom — none null-prone
    const style = {
      version: 8,
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#f4f1ea' } },
        {
          id: 'label_city',
          type: 'symbol',
          filter: ['==', ['get', 'class'], 'city'],
          layout: { 'text-field': ['get', 'name'], 'text-size': ['step', ['zoom'], 10, 8, 14] },
        },
      ],
    };
    expect(sanitizeStyleNullNumeric(style)).toBe(style); // no clone — nothing to guard
  });

  it('is IDEMPOTENT — re-sanitizing an already-guarded style is a same-reference no-op', () => {
    const style = {
      layers: [
        { id: 'poi_r1', type: 'symbol', filter: ['>=', ['get', 'rank'], 1] },
      ],
    };
    const once = sanitizeStyleNullNumeric(style);
    expect(once).not.toBe(style); // first pass cloned + guarded
    expect(sanitizeStyleNullNumeric(once)).toBe(once); // second pass = no-op
  });

  it('only clones the layers that change (untouched layers keep their reference)', () => {
    const safeLayer = { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } };
    const style = {
      layers: [
        safeLayer,
        { id: 'poi_r1', type: 'symbol', filter: ['>=', ['get', 'rank'], 1] },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out.layers[0]).toBe(safeLayer); // unchanged layer not re-allocated
    expect(out.layers[1]).not.toBe(style.layers[1]); // changed layer cloned
  });

  it('fails OPEN on a malformed style (no layers array → returned as-is)', () => {
    const bad = { version: 8 } as { layers?: unknown[] };
    expect(sanitizeStyleNullNumeric(bad)).toBe(bad);
    expect(sanitizeStyleNullNumeric(null as never)).toBeNull();
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   #947 — the dark/fiord styles set `icon-image: ["step", ["zoom"], "circle-11",
   9, ""]` on place_town/place_city/place_city_large, but their sprite ships
   `circle_11` (underscore), so MapLibre `warnOnce`s `Image "circle-11" could
   not be loaded …`. The sanitizer rewrites the hyphenated literal → "" (the same
   "no icon" the missing sprite already yields) BEFORE the worker parses, so the
   warning never fires. By VALUE-matching the literal, the same `sanitizeStyle*`
   chokepoint covers the constructor (loadSanitizedStyle) + swap/retry
   (transformStyle) paths the null-numeric guard already rides.
   ────────────────────────────────────────────────────────────────────────── */
describe('sanitizeStyleNullNumeric — missing icon-image neutralization (#947)', () => {
  it('rewrites the dark/fiord `circle-11` step icon-image to "" (behaviour-preserving)', () => {
    const style = {
      layers: [
        {
          id: 'place_city',
          type: 'symbol',
          layout: {
            'icon-image': ['step', ['zoom'], 'circle-11', 9, ''],
            'text-field': ['get', 'name'], // a sibling layout key, untouched
          },
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out).not.toBe(style); // cloned — the reference changed
    expect(out.layers[0].layout?.['icon-image']).toEqual(['step', ['zoom'], '', 9, '']);
    expect(out.layers[0].layout?.['text-field']).toEqual(['get', 'name']);
    // input not mutated
    expect(style.layers[0].layout['icon-image']).toEqual(['step', ['zoom'], 'circle-11', 9, '']);
  });

  it('leaves a present (non-missing) icon-image id UNCHANGED (same style reference)', () => {
    const style = {
      layers: [
        {
          id: 'airport',
          type: 'symbol',
          layout: { 'icon-image': 'airport_11' }, // exists in the sprite — not rewritten
        },
      ],
    };
    expect(sanitizeStyleNullNumeric(style)).toBe(style); // nothing to neutralize → no clone
  });

  it('only clones the layer carrying the missing ref (clean layers keep their reference)', () => {
    const cleanLayer = {
      id: 'airport',
      type: 'symbol',
      layout: { 'icon-image': 'airport_11' },
    };
    const style = {
      layers: [
        cleanLayer,
        {
          id: 'place_town',
          type: 'symbol',
          layout: { 'icon-image': ['step', ['zoom'], 'circle-11', 9, ''] },
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    expect(out.layers[0]).toBe(cleanLayer); // untouched layer not re-allocated
    expect(out.layers[1]).not.toBe(style.layers[1]); // neutralized layer cloned
    expect(out.layers[1].layout?.['icon-image']).toEqual(['step', ['zoom'], '', 9, '']);
  });

  it('handles a layer needing BOTH guards — one merged layout copy', () => {
    const style = {
      layers: [
        {
          id: 'place_city_large',
          type: 'symbol',
          layout: {
            'icon-image': ['step', ['zoom'], 'circle-11', 9, ''],
            'icon-size': ['case', ['>', ['get', 'rank'], 3], 2, 1], // null-prone (A)
          },
        },
      ],
    };
    const out = sanitizeStyleNullNumeric(style);
    const layout = out.layers[0].layout;
    expect(layout?.['icon-image']).toEqual(['step', ['zoom'], '', 9, '']); // (B)
    expect(layout?.['icon-size']).toEqual([
      'case',
      ['all', ['has', 'rank'], ['>', ['get', 'rank'], 3]],
      2,
      1,
    ]); // (A)
  });

  it('is IDEMPOTENT — re-sanitizing a neutralized style is a same-reference no-op', () => {
    const style = {
      layers: [
        {
          id: 'place_city',
          type: 'symbol',
          layout: { 'icon-image': ['step', ['zoom'], 'circle-11', 9, ''] },
        },
      ],
    };
    const once = sanitizeStyleNullNumeric(style);
    expect(once).not.toBe(style); // first pass neutralized + cloned
    expect(sanitizeStyleNullNumeric(once)).toBe(once); // second pass = no-op (no 'circle-11' left)
  });
});

describe('transformStyleSanitizeNull (maplibre TransformStyleFunction adapter)', () => {
  it('ignores `previous` and returns the sanitized `next` style', () => {
    const next = {
      layers: [{ id: 'poi_r1', type: 'symbol', filter: ['>=', ['get', 'rank'], 1] }],
    };
    const out = transformStyleSanitizeNull(undefined, next);
    expect(out.layers[0].filter).toEqual([
      'all',
      ['has', 'rank'],
      ['>=', ['get', 'rank'], 1],
    ]);
  });

  it('fails OPEN when `next` is nullish', () => {
    expect(transformStyleSanitizeNull(undefined, null as never)).toBeNull();
  });
});

/* ── loadSanitizedStyle (initial-paint loader — fetch → sanitize → memoize) ───
   The constructor entry point: it fetches the style JSON, null-guards it with
   `sanitizeStyleNullNumeric`, and resolves a pre-sanitized StyleSpecification
   (so the worker never sees a raw null-prone expression on the first paint).
   Memoized per url — a repeat / swap-back request shares one fetch.
   ──────────────────────────────────────────────────────────────────────────── */

describe('loadSanitizedStyle (memoized fetch + sanitize)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches the style and returns it with null-prone comparisons ["has"]-guarded', async () => {
    const rawStyle = {
      version: 8,
      layers: [
        { id: 'poi_r1', type: 'symbol', filter: ['>=', ['get', 'rank'], 1] },
      ],
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => rawStyle,
    }));
    vi.stubGlobal('fetch', fetchMock);

    // Use a UNIQUE url per test so the module-level memo cache (shared across
    // tests in the same module) never returns a value seeded by another test.
    const out = await loadSanitizedStyle('https://example.test/style-guarded');
    expect(out.layers?.[0].filter).toEqual([
      'all',
      ['has', 'rank'],
      ['>=', ['get', 'rank'], 1],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('MEMOIZES by url — a second call with the same url does NOT refetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: 8, layers: [] }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.test/style-memo';
    const first = await loadSanitizedStyle(url);
    const second = await loadSanitizedStyle(url);
    // Same fetch served both calls (cached promise), and the resolved object is
    // shared (a swap-back reuses it rather than refetching).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('REJECTS (fail-open) on a non-ok response and does not cache the failure', async () => {
    const okStyle = { version: 8, layers: [] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okStyle });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.test/style-failopen';
    await expect(loadSanitizedStyle(url)).rejects.toThrow(/503/);
    // The failed promise was evicted from the cache, so a retry refetches.
    await expect(loadSanitizedStyle(url)).resolves.toEqual(okStyle);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
