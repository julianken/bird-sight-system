import { describe, it, expect, vi } from 'vitest';
import { enforceDarkLabelContrast } from './basemap-label-contrast.js';

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

   `enforceDarkLabelContrast(map)` recolors only the FAILING symbol layers on a
   GENUINELY-DARK canvas (fail-open: total no-op on the light positron style),
   to an AA-passing LIGHT text + dark halo, preserving the light-style hierarchy
   (roads brightest, place a notch muted, water tinted). Idempotent + fails open.
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
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
}

/**
 * A maplibre map backed by an in-memory layer list with `getStyle`,
 * `getPaintProperty`, `getLayoutProperty`, `setPaintProperty` spies — mirrors
 * the surface `enforceDarkLabelContrast` touches (and the pattern in
 * basemap-null-filter.test.ts / artboard-layers.test.ts).
 */
function makeMockMap(layers: FakeLayer[]) {
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  return {
    layers,
    byId,
    getStyle: vi.fn(() => ({ layers: layers.map((l) => ({ id: l.id, type: l.type })) })),
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

    enforceDarkLabelContrast(map as never);

    for (const { id } of DARK_LABEL_LAYERS) {
      const color = map.byId[id].paint['text-color'] as string;
      const ratio = contrast(color, DARK_BG);
      expect(
        ratio,
        `${id} text-color ${color} must pass AA vs ${DARK_BG}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('sets a DARK halo and a readable halo-width on every recolored label', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never);
    for (const { id } of DARK_LABEL_LAYERS) {
      const halo = map.byId[id].paint['text-halo-color'] as string;
      // Halo must be dark so the light text separates from light features too.
      expect(luminance(halo), `${id} halo ${halo} should be dark`).toBeLessThan(0.2);
      expect(map.byId[id].paint['text-halo-width'] as number).toBeGreaterThanOrEqual(1);
    }
  });

  it('does NOT use pure white for any label (avoid glare)', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never);
    for (const { id } of DARK_LABEL_LAYERS) {
      const color = (map.byId[id].paint['text-color'] as string).toLowerCase();
      expect(['#ffffff', '#fff', 'rgb(255,255,255)', 'rgb(255, 255, 255)']).not.toContain(color);
    }
  });

  it('leaves symbol layers WITHOUT a text-field untouched', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never);
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

    enforceDarkLabelContrast(map as never);

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

    enforceDarkLabelContrast(map as never);

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

    enforceDarkLabelContrast(map as never);

    // Untouched: the bump must not clobber a wider halo down to 1.
    expect(map.byId['place_city'].paint['text-halo-width']).toBe(2);
    expect(
      map.setPaintProperty.mock.calls.some(
        (c) => c[0] === 'place_city' && c[1] === 'text-halo-width',
      ),
    ).toBe(false);
  });
});

describe('enforceDarkLabelContrast — fail-open on the light style', () => {
  it('makes ZERO setPaintProperty calls on the positron (light) style', () => {
    const map = makeMockMap(lightFixture());
    enforceDarkLabelContrast(map as never);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});

describe('enforceDarkLabelContrast — idempotent', () => {
  it('a second pass yields the SAME colors and makes no further changes', () => {
    const map = makeMockMap(darkFixture());
    enforceDarkLabelContrast(map as never);
    const afterFirst = Object.fromEntries(
      DARK_LABEL_LAYERS.map(({ id }) => [id, map.byId[id].paint['text-color']]),
    );
    map.setPaintProperty.mockClear();

    enforceDarkLabelContrast(map as never);

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
    enforceDarkLabelContrast(map as never);
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
    expect(() => enforceDarkLabelContrast(map as never)).not.toThrow();
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
    expect(() => enforceDarkLabelContrast(map as never)).not.toThrow();
    // Unparseable → left alone (no text-color write for that layer).
    expect(
      map.setPaintProperty.mock.calls.some(
        (c) => c[0] === 'place_expr' && c[1] === 'text-color',
      ),
    ).toBe(false);
  });
});
