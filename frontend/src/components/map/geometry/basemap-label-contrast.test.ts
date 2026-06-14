import { describe, it, expect, vi } from 'vitest';
import { enforceDarkLabelContrast } from './basemap-label-contrast.js';
import {
  THEME_REGISTRY,
  resolveDescriptor,
  type BasemapDescriptor,
} from './basemap-style.js';

/* ──────────────────────────────────────────────────────────────────────────
   #1128 — dark-mode basemap label contrast.

   bird-maps dark mode swaps the basemap to a DIFFERENT style via `setStyle`
   (`BASEMAP_DARK = .../styles/dark`), not a CSS filter. That dark style ships
   LIGHT-mode label text colors, so at z14 every basemap label layer fails WCAG
   AA against the dark canvas (`background-color: rgb(12,12,12)`). The 13 dark
   symbol layers that carry a `text-field` and their real light-mode text-color:

     highway_name_motorway      hsl(0,0%,37%)        3.03  (transportation_name)
     water_name                 hsla(0,0%,0%,0.7)    1.07  (water_name)
     highway_name_other         rgba(80,78,78,1)     2.37  (transportation_name)
     place_other/suburb/village/town/city/city_large/state  rgb(101,101,101) 3.36
     place_country_other/minor/major                        rgb(101,101,101) 3.36

   #1214 (C2) refactors `enforceDarkLabelContrast(map, descriptor)` to take an
   injected `BasemapDescriptor`: it gates the STYLE-LEVEL no-op on
   `descriptor.kind === 'dark'` (replacing the background-luminance read),
   sources the recolor palette from `descriptor.darkLabelTextColors`, and
   detects labels via `isLabelLayer` (which also excludes the app's own
   `observations` symbol layers). The PER-LAYER measured-contrast gate
   (`contrastFromRgb(current, landRgb) >= AA`) STAYS — `descriptor.landColor` is
   the declared canvas the measurement runs against. Behavior-preserving for the
   BASEMAP labels (byte-identical paint writes), with a deliberate, test-backed
   exclusion of observation symbol layers.
   ────────────────────────────────────────────────────────────────────────── */

const AA = 4.5;

/* ── Local WCAG sRGB contrast math (independent re-derivation, so the test does
   not lean on the module-under-test to grade itself). Parses the rgb()/rgba()/
   hsl()/hsla()/#hex color strings the styles actually emit. ─────────────────── */

function parseColor(input: string): [number, number, number] {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  if (s.startsWith('rgb')) {
    const nums = s
      .slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
      .split(',')
      .map((p) => Number.parseFloat(p));
    return [nums[0], nums[1], nums[2]];
  }
  if (s.startsWith('hsl')) {
    const nums = s
      .slice(s.indexOf('(') + 1, s.lastIndexOf(')'))
      .split(',')
      .map((p) => Number.parseFloat(p));
    const [h, sat, light] = [nums[0], nums[1] / 100, nums[2] / 100];
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = light - c / 2;
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  throw new Error(`unparseable test color: ${input}`);
}

function luminance(color: string): number {
  const [r, g, b] = parseColor(color);
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const DARK_BG = 'rgb(12,12,12)';

/** The registered `dark` descriptor — the production input under test. */
const DARK_DESCRIPTOR = resolveDescriptor('dark');
/** The registered `positron` (light) descriptor — drives the kind no-op. */
const POSITRON_DESCRIPTOR = resolveDescriptor('positron');

/**
 * The exact dark-label palette, read from the descriptor (never mirrored): the
 * recolor reads `descriptor.darkLabelTextColors`, so an edit to any tier is
 * audited here automatically.
 */
const { road: ROAD, place: PLACE, water: WATER } = DARK_DESCRIPTOR.darkLabelTextColors!;

/** The 13 dark-style symbol layers that carry a text-field, at real colors. */
const DARK_LABEL_LAYERS: Array<{ id: string; textColor: string; haloWidth?: number }> = [
  { id: 'highway_name_motorway', textColor: 'hsl(0, 0%, 37%)' },
  { id: 'highway_name_other', textColor: 'rgba(80, 78, 78, 1)' },
  { id: 'water_name', textColor: 'hsla(0, 0%, 0%, 0.7)' },
  { id: 'place_other', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_suburb', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_village', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_town', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_city', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_city_large', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_state', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_country_other', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_country_minor', textColor: 'rgb(101, 101, 101)' },
  { id: 'place_country_major', textColor: 'rgb(101, 101, 101)' },
];

interface FakeLayer {
  id: string;
  type: string;
  source?: string;
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
}

/**
 * A maplibre map backed by an in-memory layer list with `getStyle`,
 * `getPaintProperty`, `getLayoutProperty`, `setPaintProperty` spies — mirrors
 * the surface `enforceDarkLabelContrast` touches (and the pattern in
 * basemap-null-filter.test.ts / artboard-layers.test.ts). `getStyle().layers`
 * carries `source` + `layout` so the helper can feed `isLabelLayer` the same
 * per-layer object it iterates.
 */
function makeMockMap(layers: FakeLayer[]) {
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  return {
    layers,
    byId,
    getStyle: vi.fn(() => ({
      layers: layers.map((l) => ({
        id: l.id,
        type: l.type,
        source: l.source,
        layout: l.layout,
      })),
    })),
    getPaintProperty: vi.fn((id: string, name: string) => byId[id]?.paint[name]),
    getLayoutProperty: vi.fn((id: string, name: string) => byId[id]?.layout[name]),
    setPaintProperty: vi.fn((id: string, name: string, value: unknown) => {
      if (byId[id]) byId[id].paint[name] = value;
    }),
  };
}

function darkFixture(): FakeLayer[] {
  return [
    { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
    { id: 'water', type: 'fill', layout: {}, paint: { 'fill-color': 'hsl(0,0%,8%)' } },
    ...DARK_LABEL_LAYERS.map((l) => ({
      id: l.id,
      type: 'symbol',
      layout: { 'text-field': ['get', 'name'] },
      paint: {
        'text-color': l.textColor,
        'text-halo-color': 'rgba(0,0,0,0.7)',
        'text-halo-width': l.haloWidth ?? 1,
      } as Record<string, unknown>,
    })),
    // A symbol layer with NO text-field — must never be touched.
    { id: 'poi_icon', type: 'symbol', layout: {}, paint: { 'icon-opacity': 1 } },
  ];
}

function lightFixture(): FakeLayer[] {
  return [
    {
      id: 'background',
      type: 'background',
      layout: {},
      paint: { 'background-color': 'rgb(242,243,240)' },
    },
    {
      id: 'highway_name_motorway',
      type: 'symbol',
      layout: { 'text-field': ['get', 'name'] },
      paint: { 'text-color': 'hsl(0,0%,37%)', 'text-halo-color': '#fff', 'text-halo-width': 1 },
    },
    {
      id: 'place_city',
      type: 'symbol',
      layout: { 'text-field': ['get', 'name'] },
      paint: { 'text-color': 'rgb(70,70,70)', 'text-halo-color': '#fff', 'text-halo-width': 1 },
    },
    {
      id: 'water_name',
      type: 'symbol',
      layout: { 'text-field': ['get', 'name'] },
      paint: { 'text-color': '#495e91', 'text-halo-color': '#fff', 'text-halo-width': 1 },
    },
  ];
}

describe('enforceDarkLabelContrast — AA after fix (dark canvas)', () => {
  it('lifts EVERY text-field label layer to ≥ 4.5 contrast vs the dark canvas', () => {
    const map = makeMockMap(darkFixture());

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    for (const { id } of DARK_LABEL_LAYERS) {
      const color = map.byId[id].paint['text-color'] as string;
      const ratio = contrast(color, DARK_BG);
      expect(
        ratio,
        `${id} text-color ${color} must pass AA vs ${DARK_BG}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('writes the exact per-tier descriptor colors (byte-identical to today)', () => {
    const map = makeMockMap(darkFixture());

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    // Road tier.
    expect(map.byId['highway_name_motorway'].paint['text-color']).toBe(ROAD);
    expect(map.byId['highway_name_other'].paint['text-color']).toBe(ROAD);
    // Water tier.
    expect(map.byId['water_name'].paint['text-color']).toBe(WATER);
    // Place tier (default).
    expect(map.byId['place_city'].paint['text-color']).toBe(PLACE);
    expect(map.byId['place_country_major'].paint['text-color']).toBe(PLACE);

    // The descriptor carries today's exact values — the refactor is behavior-
    // preserving for the basemap labels.
    expect(ROAD).toBe('#d8d8d8');
    expect(PLACE).toBe('#c4c4c4');
    expect(WATER).toBe('#9db4d8');
  });

  it('sets a DARK halo and a readable halo-width on every recolored label', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);
    for (const { id } of DARK_LABEL_LAYERS) {
      const halo = map.byId[id].paint['text-halo-color'] as string;
      // Halo must be dark so the light text separates from light features too.
      expect(luminance(halo), `${id} halo ${halo} should be dark`).toBeLessThan(0.2);
      expect(map.byId[id].paint['text-halo-width'] as number).toBeGreaterThanOrEqual(1);
    }
  });

  it('does NOT use pure white for any label (avoid glare)', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);
    for (const { id } of DARK_LABEL_LAYERS) {
      const color = (map.byId[id].paint['text-color'] as string).toLowerCase();
      expect(['#ffffff', '#fff', 'rgb(255,255,255)', 'rgb(255, 255, 255)']).not.toContain(color);
    }
  });

  it('leaves symbol layers WITHOUT a text-field untouched', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);
    expect(map.setPaintProperty.mock.calls.some((c) => c[0] === 'poi_icon')).toBe(false);
    expect(map.setPaintProperty.mock.calls.some((c) => c[0] === 'water')).toBe(false);
    expect(map.setPaintProperty.mock.calls.some((c) => c[0] === 'background')).toBe(false);
  });
});

describe('enforceDarkLabelContrast — halo-width bump on the neediest labels', () => {
  /* The bump exists precisely for the label MOST in need of a halo — one whose
     style ships a 0-width (or absent) halo. Every other fixture in this file
     pre-sets text-halo-width: 1, so without these two cases the bump branch
     (text-halo-width < 1 → 1, and the typeof !== 'number' arm) is never run. */

  it('bumps a 0-width halo up to 1 on a recolored dark label', () => {
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: {
          'text-color': 'rgb(101, 101, 101)', // 3.36 vs dark canvas → fails AA, gets recolored
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 0, // the case the bump exists for
        },
      },
    ];
    const map = makeMockMap(layers);

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    // Read back the value the fake map actually stored.
    expect(map.byId['place_city'].paint['text-halo-width']).toBe(1);
    expect(map.byId['place_city'].paint['text-halo-width'] as number).toBeGreaterThanOrEqual(1);
  });

  it('sets halo-width to 1 when text-halo-width is absent (typeof !== number arm)', () => {
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: {
          'text-color': 'rgb(101, 101, 101)', // fails AA → recolored
          'text-halo-color': 'rgba(0,0,0,0.7)',
          // text-halo-width intentionally ABSENT → getPaintProperty returns undefined
        },
      },
    ];
    const map = makeMockMap(layers);

    // Precondition: the property really is undefined before the call.
    expect(map.byId['place_city'].paint['text-halo-width']).toBeUndefined();

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    expect(map.byId['place_city'].paint['text-halo-width']).toBe(1);
    expect(map.byId['place_city'].paint['text-halo-width'] as number).toBeGreaterThanOrEqual(1);
  });

  it('leaves an already-wide (≥1) halo as the style set it', () => {
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: {
          'text-color': 'rgb(101, 101, 101)', // fails AA → recolored
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 2, // already wider than the floor
        },
      },
    ];
    const map = makeMockMap(layers);

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    // Untouched: the bump must not clobber a wider halo down to 1.
    expect(map.byId['place_city'].paint['text-halo-width']).toBe(2);
    expect(
      map.setPaintProperty.mock.calls.some(
        (c) => c[0] === 'place_city' && c[1] === 'text-halo-width',
      ),
    ).toBe(false);
  });
});

describe('enforceDarkLabelContrast — kind gate (style-level no-op)', () => {
  it('makes ZERO setPaintProperty calls for a LIGHT-kind (positron) descriptor', () => {
    // Even on a (hypothetically) dark canvas, a light-kind descriptor is a
    // total no-op: the style-level gate is `descriptor.kind !== 'dark'`, NOT a
    // background-luminance read.
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, POSITRON_DESCRIPTOR);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it('makes ZERO setPaintProperty calls on the positron (light) style', () => {
    const map = makeMockMap(lightFixture());
    enforceDarkLabelContrast(map as never, POSITRON_DESCRIPTOR);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});

describe('enforceDarkLabelContrast — per-layer MEASURED gate (mid-luminance land)', () => {
  /* The kind gate alone is not the correctness core: on a NON-near-black dark
     land (fiord, `#45516E`) a label that already passes AA against that land
     must be left alone, and only a label that fails IS recolored. This proves
     the per-layer `contrastFromRgb(current, landRgb) >= AA` measurement path,
     not just the near-black `dark` happy path. We synthesize a fiord-like
     mid-luminance dark descriptor (NOT registered live — C6 owns that) so the
     measurement runs against `#45516E`. */
  const FIORD_LIKE: BasemapDescriptor = {
    id: 'dark', // id is never branched on; only kind/landColor/darkLabelTextColors matter
    url: 'https://example.test/fiord',
    kind: 'dark',
    landColor: '#45516E',
    markerHaloColor: '#ffffff',
    floatColors: { outline: '#e8edf4', halo: '#7fd0ff' },
    // An AA-passing-vs-#45516E palette so a recolored label is itself ≥ AA.
    darkLabelTextColors: { road: '#f2f2f2', place: '#e6e6e6', water: '#b8cae6' },
  };

  it('does NOT touch a label whose current color already passes AA vs the land', () => {
    // `#e6e6e6` is ~5.7:1 vs `#45516E` — already passes, so it is skipped.
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': '#45516E' } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: { 'text-color': '#e6e6e6', 'text-halo-width': 1 },
      },
    ];
    // Precondition: the seed color really does pass AA vs the land.
    expect(contrast('#e6e6e6', '#45516E')).toBeGreaterThanOrEqual(AA);

    const map = makeMockMap(layers);
    enforceDarkLabelContrast(map as never, FIORD_LIKE);

    expect(
      map.setPaintProperty.mock.calls.some(
        (c) => c[0] === 'place_city' && c[1] === 'text-color',
      ),
    ).toBe(false);
    expect(map.byId['place_city'].paint['text-color']).toBe('#e6e6e6');
  });

  it('DOES recolor a label whose current color fails AA vs the land', () => {
    // `#6a6a6a` is ~1.5:1 vs `#45516E` — fails AA, so it is recolored to the
    // descriptor's place tier.
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': '#45516E' } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: { 'text-color': '#6a6a6a', 'text-halo-width': 1 },
      },
    ];
    // Precondition: the seed color fails AA vs the land.
    expect(contrast('#6a6a6a', '#45516E')).toBeLessThan(AA);

    const map = makeMockMap(layers);
    enforceDarkLabelContrast(map as never, FIORD_LIKE);

    expect(map.byId['place_city'].paint['text-color']).toBe('#e6e6e6');
    // …and the result clears AA vs the land.
    expect(contrast('#e6e6e6', '#45516E')).toBeGreaterThanOrEqual(AA);
  });
});

describe('enforceDarkLabelContrast — observations layers are never recolored', () => {
  /* The exclusion is inert two distinct ways, matching the actual layers (#1214
     correction B). isLabelLayer adds `source !== 'observations'`. */

  it('does NOT recolor the real `cluster-count` layer (text-color: transparent)', () => {
    // The ONE real observations symbol layer carrying a text-field is
    // `cluster-count` (observation-layers.ts:265), paint `text-color:
    // 'transparent'` (:275). `transparent` is unparseable → the helper skips it
    // at `if (!current) continue;` BEFORE any AA measurement. Assert directly
    // that it is never recolored — NOT via an AA ratio against `transparent`.
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'cluster-count',
        type: 'symbol',
        source: 'observations',
        layout: { 'text-field': ['get', 'point_count_abbreviated'] },
        paint: { 'text-color': 'transparent' },
      },
    ];
    const map = makeMockMap(layers);

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    expect(
      map.setPaintProperty.mock.calls.some((c) => c[0] === 'cluster-count'),
    ).toBe(false);
    expect(map.byId['cluster-count'].paint['text-color']).toBe('transparent');
  });

  it('does NOT recolor a SYNTHETIC observations label with a PARSEABLE AA-failing color', () => {
    // This is the load-bearing proof of correction B: a synthetic observations
    // symbol layer with a parseable, AA-FAILING `text-color` (`#222`) is STILL
    // not recolored — because `isLabelLayer`'s `source !== 'observations'`
    // filter excludes it. Under the OLD source-less detector this layer WOULD
    // have been recolored (it carries a text-field and fails AA vs the canvas).
    // Mirrors the direct-assertion technique at artboard-layers.test.ts:214.
    expect(contrast('#222', DARK_BG)).toBeLessThan(AA); // would-fail-AA precondition

    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'obs-synthetic-label',
        type: 'symbol',
        source: 'observations',
        layout: { 'text-field': ['get', 'name'] },
        paint: { 'text-color': '#222', 'text-halo-width': 1 },
      },
    ];
    const map = makeMockMap(layers);

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    expect(
      map.setPaintProperty.mock.calls.some((c) => c[0] === 'obs-synthetic-label'),
    ).toBe(false);
    expect(map.byId['obs-synthetic-label'].paint['text-color']).toBe('#222');
  });

  it('still recolors a BASEMAP label with the same failing color (proves the filter is on source, not color)', () => {
    // Control: the identical `#222` failing color on a NON-observations label IS
    // recolored — so the exclusion above is the `source` filter, not anything
    // about the color.
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'place_city',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: { 'text-color': '#222', 'text-halo-width': 1 },
      },
    ];
    const map = makeMockMap(layers);

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    expect(map.byId['place_city'].paint['text-color']).toBe(PLACE);
  });
});

describe('enforceDarkLabelContrast — idempotent', () => {
  it('a second pass yields the SAME colors and makes no further changes', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);
    const afterFirst = Object.fromEntries(
      DARK_LABEL_LAYERS.map(({ id }) => [id, map.byId[id].paint['text-color']]),
    );
    map.setPaintProperty.mockClear();

    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);

    // No further text-color writes (already-fixed colors pass AA → skipped).
    expect(
      map.setPaintProperty.mock.calls.some((c) => c[1] === 'text-color'),
    ).toBe(false);
    for (const { id } of DARK_LABEL_LAYERS) {
      expect(map.byId[id].paint['text-color']).toBe(afterFirst[id]);
    }
  });
});

describe('enforceDarkLabelContrast — hierarchy preserved', () => {
  it('road labels end up at least as light as place labels', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR);
    const road = luminance(map.byId['highway_name_motorway'].paint['text-color'] as string);
    const place = luminance(map.byId['place_city'].paint['text-color'] as string);
    expect(road).toBeGreaterThanOrEqual(place);
  });
});

describe('enforceDarkLabelContrast — fails open on a throwing style', () => {
  it('does not propagate when getStyle throws', () => {
    const map = {
      getStyle: vi.fn(() => {
        throw new Error('style churn after swap');
      }),
      getPaintProperty: vi.fn(),
      getLayoutProperty: vi.fn(),
      setPaintProperty: vi.fn(),
    };
    expect(() => enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR)).not.toThrow();
  });

  it('skips a layer whose text-color is an expression it cannot parse', () => {
    const layers: FakeLayer[] = [
      { id: 'background', type: 'background', layout: {}, paint: { 'background-color': DARK_BG } },
      {
        id: 'place_expr',
        type: 'symbol',
        layout: { 'text-field': ['get', 'name'] },
        paint: {
          // an interpolate expression — not a parseable constant color
          'text-color': ['interpolate', ['linear'], ['zoom'], 5, '#656565', 10, '#777'],
          'text-halo-width': 1,
        },
      },
    ];
    const map = makeMockMap(layers);
    expect(() => enforceDarkLabelContrast(map as never, DARK_DESCRIPTOR)).not.toThrow();
    // Unparseable → left alone (no text-color write for that layer).
    expect(
      map.setPaintProperty.mock.calls.some(
        (c) => c[0] === 'place_expr' && c[1] === 'text-color',
      ),
    ).toBe(false);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   #1217 (C5) — a11y GATE: the dark-label recolor palette must clear the AA
   floor (4.5:1 — text labels, not the 3:1 non-text floor) against the land of
   every REGISTERED dark-kind descriptor (THEME_REGISTRY), NOT against every
   entry in `LAND_COLORS`. fiord's land is in `LAND_COLORS` but fiord is not a
   registered/live descriptor until C6 — auditing the shared live palette
   against it now would force a live dark-theme color change for a not-yet-
   shipped theme, and C5 must stay test-only (invisible until C8).

   #1214 (C2) moved the recolor palette ONTO the descriptor
   (`descriptor.darkLabelTextColors`) and deleted the module-level
   `ROAD/PLACE/WATER_TEXT` consts. So this audit now reads each registered
   dark-kind descriptor's OWN `darkLabelTextColors.{road,place,water}` and
   asserts each clears AA against THAT descriptor's `landColor`. Since the
   `dark` descriptor carries the same values the consts held (#d8d8d8 / #c4c4c4
   / #9db4d8 vs #0E1116), the gate stays green and correct. A future per-tier
   color edit on any registered dark descriptor is caught here automatically.

   When C6 registers `fiord` (navy land `#45516E`) this matrix AUTO-EXTENDS to
   it and forces the fiord decision: the shared dark water `#9db4d8` is only
   3.75:1 vs `#45516E` (an AA fail), so C6 must give fiord an AA-passing water
   (e.g. `#b8cae6` = 4.76:1) on its OWN descriptor — which the per-descriptor
   path C2 introduces makes a clean, local change.
   ────────────────────────────────────────────────────────────────────────── */

describe('#1217 — dark-label recolor tiers ≥ 4.5 AA vs every dark-kind land', () => {
  // Registered dark-kind descriptors only — NOT every LAND_COLORS entry. Each
  // descriptor supplies BOTH its land AND its own dark-label palette, so the
  // audit asserts each descriptor against its own declared colors.
  const DARK_DESCRIPTORS = Object.values(THEME_REGISTRY).filter(
    (d) => d.kind === 'dark',
  );

  it('has at least the registered `dark` descriptor (matrix never vacuously empty)', () => {
    // An empty iteration would vacuously "pass" — guard the row count.
    expect(DARK_DESCRIPTORS.length).toBeGreaterThanOrEqual(1);
    expect(DARK_DESCRIPTORS.map((d) => d.id)).toEqual(expect.arrayContaining(['dark']));
  });

  it('every registered dark descriptor declares darkLabelTextColors (registry invariant)', () => {
    for (const d of DARK_DESCRIPTORS) {
      expect(
        d.darkLabelTextColors,
        `${d.id} is a dark-kind descriptor and MUST declare darkLabelTextColors`,
      ).toBeDefined();
    }
  });

  // Deferred to C6 (recorded so its implementer is warned): when fiord is
  // registered, its dark-label water must clear ≥4.5 vs #45516E — the shared
  // #9db4d8 = 3.75:1 fails, so fiord needs its own AA-passing water (e.g. #b8cae6).
  it.todo(
    'C6: fiord descriptor must declare an AA-passing dark water vs #45516E (e.g. #b8cae6 = 4.76:1)',
  );

  for (const d of DARK_DESCRIPTORS) {
    const tiers = d.darkLabelTextColors!;
    for (const [tier, color] of Object.entries(tiers)) {
      it(`${d.id} ${tier} (${color}) ≥ 4.5 vs its own land (${d.landColor})`, () => {
        const ratio = contrast(color, d.landColor);
        expect(
          ratio,
          `${d.id} ${tier} ${color} vs land ${d.landColor} = ${ratio.toFixed(2)}:1 — below 4.5 AA`,
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
