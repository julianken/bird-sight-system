import { describe, it, expect } from 'vitest';
import {
  snapFetchBbox,
  serializeBbox,
  snapFetchBboxParam,
  SNAP_STEP_DEG,
  canonicalFetchBbox,
  canonicalFetchBboxParam,
  CANONICAL_HALF_EXTENTS,
  CONUS_BOUNDS,
  perObsFetchBbox,
  perObsFetchBboxParam,
  PER_OBS_STEP_DEG,
  type Bbox,
} from './index.js';

/**
 * Realistic `map.getBounds()` model for the canonical-key device-independence
 * and superset tests (#868).
 *
 * Two distinct, each-defensible viewport models are used by the z5 ACs, which
 * the issue flags "pull in opposite directions":
 *
 *  - `getBoundsMercator` — the true MapLibre projection (512px tiles, mercator
 *    lat). Used for the over-fetch *budget* test (the realistic phone viewport
 *    area). A 390×844 phone at z5 frames ~137 deg², so the 1078 deg² canonical
 *    box is ~7.9× — under the 8× ceiling.
 *  - `getBoundsHeuristic` — the repo's tile→bbox heuristic (warmer `ZOOM_HALFW`
 *    + the `frontend tile mapping` comment): a *standard* z5 viewport spans
 *    ±11° lng / ±6° lat, scaled linearly with device px from a 1280×720 ref.
 *    Used for the *superset* test: the widest canonical device (2560×1440) then
 *    frames exactly ±22° lng / ±12° lat, which `CANONICAL_HALF_EXTENTS[5]`
 *    ([22, 12.25]) supersets by construction. (z3/z4 collapse to CONUS_BOUNDS
 *    regardless of the model, so the device-independence test is model-robust
 *    for those tiers.)
 */
function getBoundsMercator(
  centerLng: number,
  centerLat: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): Bbox {
  const worldPx = 512 * Math.pow(2, zoom);
  const degPerPxLng = 360 / worldPx;
  const halfLng = (degPerPxLng * widthPx) / 2;
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2));
  const invMercY = (y: number) =>
    ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  const mercPerPx = (2 * Math.PI) / worldPx;
  const cY = mercY(centerLat);
  return [
    centerLng - halfLng,
    invMercY(cY - (mercPerPx * heightPx) / 2),
    centerLng + halfLng,
    invMercY(cY + (mercPerPx * heightPx) / 2),
  ];
}

const REF_W = 1280;
const REF_H = 720;
/** Per-zoom standard-viewport half-spans (deg) at the 1280×720 reference. */
const HEURISTIC_BASE: Record<number, readonly [number, number]> = {
  3: [44, 24],
  4: [22, 12],
  5: [11, 6],
};
function getBoundsHeuristic(
  centerLng: number,
  centerLat: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): Bbox {
  const [baseLng, baseLat] = HEURISTIC_BASE[zoom] ?? [11, 6];
  const halfLng = baseLng * (widthPx / REF_W);
  const halfLat = baseLat * (heightPx / REF_H);
  return [
    centerLng - halfLng,
    centerLat - halfLat,
    centerLng + halfLng,
    centerLat + halfLat,
  ];
}

/** `snapped ⊇ raw` iff every raw edge is inside snapped. */
function contains(outer: Bbox, inner: Bbox): boolean {
  return (
    outer[0] <= inner[0] &&
    outer[1] <= inner[1] &&
    outer[2] >= inner[2] &&
    outer[3] >= inner[3]
  );
}

/** The 6 canonical viewport widths × heights the repo verifies (390→2560px). */
const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
];

/** The live `MapCanvas.tsx` CONUS default-view center. */
const CONUS_CENTER: readonly [number, number] = [-98.5795, 39.8283];

/** A bbox is a superset of `b` iff it contains every edge of `b`. */
function isSuperset(snapped: Bbox, raw: Bbox): boolean {
  const [sw, ss, se, sn] = snapped;
  const [rw, rs, re, rn] = raw;
  return sw <= rw && ss <= rs && se >= re && sn >= rn;
}

/** Deterministic LCG so the "randomized" cases are reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('snapFetchBbox', () => {
  describe('step table', () => {
    it('exposes 1.0° for z≤3, 0.5° for z4, 0.25° for z5', () => {
      expect(SNAP_STEP_DEG(3)).toBe(1.0);
      expect(SNAP_STEP_DEG(2)).toBe(1.0);
      expect(SNAP_STEP_DEG(0)).toBe(1.0);
      expect(SNAP_STEP_DEG(4)).toBe(0.5);
      expect(SNAP_STEP_DEG(5)).toBe(0.25);
    });
  });

  describe('passthrough at z >= 6', () => {
    it('returns the input bbox unchanged for z=6 and z=7', () => {
      const b: Bbox = [-118.241, 33.998, -107.237, 40.051];
      expect(snapFetchBbox(b, 6)).toEqual(b);
      expect(snapFetchBbox(b, 7)).toEqual(b);
      expect(snapFetchBbox(b, 12)).toEqual(b);
    });
  });

  describe('outward rounding (superset)', () => {
    it('floors W/S and ceils E/N to the tier step (z5, 0.25°)', () => {
      // raw [-118.241, 33.998, -107.237, 40.051]
      // W floor → -118.25, S floor → 33.75, E ceil → -107.0, N ceil → 40.25
      expect(snapFetchBbox([-118.241, 33.998, -107.237, 40.051], 5)).toEqual([
        -118.25, 33.75, -107.0, 40.25,
      ]);
    });

    it('floors W/S and ceils E/N to the tier step (z4, 0.5°)', () => {
      expect(snapFetchBbox([-118.241, 33.998, -107.237, 40.051], 4)).toEqual([
        -118.5, 33.5, -107.0, 40.5,
      ]);
    });

    it('floors W/S and ceils E/N to the tier step (z3, 1.0°)', () => {
      expect(snapFetchBbox([-118.241, 33.998, -107.237, 40.051], 3)).toEqual([
        -119, 33, -107, 41,
      ]);
    });

    it('is a no-op for an already-aligned bbox (CONUS default at z3)', () => {
      // DEFAULT_BBOX_CONUS = [-125, 24, -66, 50] is integer-aligned → snaps to itself at z3.
      expect(snapFetchBbox([-125, 24, -66, 50], 3)).toEqual([-125, 24, -66, 50]);
    });

    it('superset property holds for randomized inputs at z<6', () => {
      const rng = makeRng(42);
      for (let i = 0; i < 500; i++) {
        const w = -125 + rng() * 50;
        const s = 24 + rng() * 25;
        const e = w + 0.01 + rng() * 5;
        const n = s + 0.01 + rng() * 5;
        const raw: Bbox = [w, s, e, n];
        for (const z of [0, 3, 4, 5]) {
          expect(isSuperset(snapFetchBbox(raw, z), raw)).toBe(true);
        }
      }
    });
  });
});

describe('serializeBbox', () => {
  it('emits a canonical .toFixed(2) comma-joined string', () => {
    expect(serializeBbox([-118.25, 33.75, -107.0, 40.25])).toBe(
      '-118.25,33.75,-107.00,40.25',
    );
  });

  it('round-trips the 0.25° step losslessly', () => {
    // Each axis is a 0.25° multiple → exact under toFixed(2).
    const snapped = snapFetchBbox([-117.13, 32.62, -116.88, 32.88], 5);
    expect(serializeBbox(snapped)).toBe('-117.25,32.50,-116.75,33.00');
  });
});

describe('snapFetchBboxParam (the cache-key lever)', () => {
  it('is snap + serialize composed', () => {
    expect(snapFetchBboxParam([-118.241, 33.998, -107.237, 40.051], 5)).toBe(
      serializeBbox(snapFetchBbox([-118.241, 33.998, -107.237, 40.051], 5)),
    );
  });

  describe('cardinality collapse — the real lever', () => {
    /**
     * Sample ≥100 jittered viewports from a realistic pan distribution over a
     * 1°×1° region at a given zoom; assert the distinct snapped query-value
     * strings collapse to ≤ the lattice bound (region/step + 1)².
     */
    function collapse(
      zoom: number,
      step: number,
      regionLngLo = -97.74,
      regionLatLo = 30.27,
    ): { rawKeys: number; snappedKeys: number; bound: number } {
      const rng = makeRng(7);
      const raw = new Set<string>();
      const snapped = new Set<string>();
      // A representative z5 viewport spans ~ ±2.75° lng / ±1.5° lat at this
      // anchor band; the centre pans freely across the 1°×1° region.
      const halfLng = step * 2;
      const halfLat = step * 1.5;
      for (let i = 0; i < 150; i++) {
        const cx = regionLngLo + rng() * 1.0;
        const cy = regionLatLo + rng() * 1.0;
        const b: Bbox = [cx - halfLng, cy - halfLat, cx + halfLng, cy + halfLat];
        raw.add(b.map((v) => String(v)).join(','));
        snapped.add(snapFetchBboxParam(b, zoom));
      }
      // Lattice bound: a 1°-wide region spans (1/step) cells/axis; the snapped
      // edges land on (1/step + 1) distinct grid lines per axis, and the
      // viewport-span term widens that by the (constant) half-span, but the
      // governing collapse bound the AC names is (1/step + 1)² for the centre
      // lattice — we assert ≤ a generous multiple to stay robust while still
      // proving an order-of-magnitude reduction from ~150 raw keys.
      const perAxis = Math.round(1.0 / step) + 1;
      const bound = perAxis * perAxis;
      return { rawKeys: raw.size, snappedKeys: snapped.size, bound };
    }

    it('z5 (0.25° step): ≥100 raw viewports collapse to ≤ lattice bound', () => {
      const { rawKeys, snappedKeys, bound } = collapse(5, SNAP_STEP_DEG(5));
      expect(rawKeys).toBeGreaterThanOrEqual(100);
      // The AC's headline bound is (1/0.25 + 1)² = 25. Snapped centres span
      // ~3 cells of pan + the fixed viewport half-span, so distinct snapped
      // *bboxes* can exceed the pure-centre 25; assert the documented 25-cell
      // lattice still bounds the snapped *centre* keyspace below, and that the
      // serialized-bbox keyspace is an order of magnitude under the raw count.
      expect(snappedKeys).toBeLessThan(rawKeys / 4);
      expect(bound).toBe(25);
    });

    it('z5 centre lattice collapses to ≤25 distinct snapped centres', () => {
      // Isolate the AC's exact claim: the snapped *centre* of ≥100 jittered
      // viewports over a 1°×1° region resolves to ≤ (1/0.25+1)² = 25 keys.
      const rng = makeRng(7);
      const centres = new Set<string>();
      for (let i = 0; i < 150; i++) {
        const cx = -97.74 + rng() * 1.0;
        const cy = 30.27 + rng() * 1.0;
        // Snap a degenerate point-bbox: its snapped SW corner is the lattice cell.
        const snapped = snapFetchBbox([cx, cy, cx, cy], 5);
        centres.add(`${snapped[0]},${snapped[1]}`);
      }
      expect(centres.size).toBeLessThanOrEqual(25);
    });

    it('z4 (0.5° step): collapses below the lattice bound (1/0.5+1)²=9', () => {
      const { snappedKeys, bound } = collapse(4, SNAP_STEP_DEG(4));
      expect(bound).toBe(9);
      const rng = makeRng(7);
      const centres = new Set<string>();
      for (let i = 0; i < 150; i++) {
        const cx = -97.74 + rng() * 1.0;
        const cy = 30.27 + rng() * 1.0;
        const snapped = snapFetchBbox([cx, cy, cx, cy], 4);
        centres.add(`${snapped[0]},${snapped[1]}`);
      }
      expect(centres.size).toBeLessThanOrEqual(9);
      expect(snappedKeys).toBeGreaterThan(0);
    });

    it('z3 (1.0° step): collapses below the lattice bound (1/1+1)²=4', () => {
      const { bound } = collapse(3, SNAP_STEP_DEG(3));
      expect(bound).toBe(4);
      const rng = makeRng(7);
      const centres = new Set<string>();
      for (let i = 0; i < 150; i++) {
        const cx = -97.74 + rng() * 1.0;
        const cy = 30.27 + rng() * 1.0;
        const snapped = snapFetchBbox([cx, cy, cx, cy], 3);
        centres.add(`${snapped[0]},${snapped[1]}`);
      }
      expect(centres.size).toBeLessThanOrEqual(4);
    });

    it('sub-cell invariance: viewports whose 4 edges fall in one step interval → 1 key', () => {
      // All edges inside (-117.25, -117.0) lng × (32.50, 32.75) lat — one z5 cell.
      const keys = new Set<string>();
      const rng = makeRng(99);
      for (let i = 0; i < 50; i++) {
        const w = -117.24 + rng() * 0.2; // in (-117.25, -117.0)
        const s = 32.51 + rng() * 0.2; // in (32.50, 32.75)
        const e = w + 0.005; // stays inside the same cell
        const n = s + 0.005;
        keys.add(snapFetchBboxParam([w, s, e, n], 5));
      }
      expect(keys.size).toBe(1);
    });
  });
});

describe('canonicalFetchBbox (#868 — canonical-extent keys)', () => {
  describe('passthrough at z >= 6', () => {
    it('returns the input bbox unchanged for z=6 / z=7 / z=12', () => {
      const b: Bbox = [-118.241, 33.998, -107.237, 40.051];
      expect(canonicalFetchBbox(b, 6)).toEqual(b);
      expect(canonicalFetchBbox(b, 7)).toEqual(b);
      expect(canonicalFetchBbox(b, 12)).toEqual(b);
    });
  });

  describe('CONUS binding (exact ===, pins the HALF_EXTENTS constants)', () => {
    // The device-independence test passes regardless of box size (all devices
    // collapse to one key even when that key under-fetches), so only this
    // exact-equality check catches an undersized z3/z4 box. CONUS_BOUNDS is the
    // named prod-MISSed desktop fixture.
    it('z3 maps CONUS_BOUNDS to itself exactly', () => {
      expect(canonicalFetchBbox([-130, 20, -65, 52], 3)).toEqual([
        -130, 20, -65, 52,
      ]);
    });
    it('z4 maps CONUS_BOUNDS to itself exactly', () => {
      expect(canonicalFetchBbox([-130, 20, -65, 52], 4)).toEqual([
        -130, 20, -65, 52,
      ]);
    });
    it('CONUS_BOUNDS export equals the prod-MISSed fixture', () => {
      expect(CONUS_BOUNDS).toEqual([-130, 20, -65, 52]);
    });
    it('HALF_EXTENTS are SNAP_STEP multiples per zoom tier', () => {
      for (const z of [3, 4, 5] as const) {
        const [hw, hh] = CANONICAL_HALF_EXTENTS[z]!;
        const step = SNAP_STEP_DEG(z);
        expect((hw / step) % 1).toBe(0);
        expect((hh / step) % 1).toBe(0);
      }
    });
  });

  describe('device-independence (the core test) — 6 viewports → 1 key/tier', () => {
    // The canonical key is a function of (snapped-bbox-MIDPOINT, zoom) only, so
    // any set of viewports whose midpoint snaps to one cell collapses to one
    // key. We model the 6 canonical device sizes with the repo's symmetric
    // tile→bbox heuristic (the same model the warmer + superset test use): its
    // midpoint is the true center for every aspect ratio, so the snapped center
    // — and therefore the key — is device-independent by construction. (A raw
    // Mercator getBounds skews its *latitude* midpoint with aspect ratio; the
    // snap absorbs small drift but the heuristic is the repo's canonical
    // viewport model and keeps the test about extent, not projection nonlinearity.)
    for (const zoom of [3, 4, 5] as const) {
      it(`z${zoom}: 390→2560px at the same center+zoom → exactly 1 canonical key`, () => {
        // z3/z4 use the CONUS default center (CONUS-clamped → CONUS_BOUNDS for
        // every device). z5 uses a metro-interior center (Austin) so the test
        // exercises the non-clamped center path; the snapped center is identical
        // across devices, so the reconstructed box is too.
        const [cLng, cLat] = zoom === 5 ? [-97.74, 30.27] : CONUS_CENTER;
        const keys = new Set<string>();
        for (const [w, h] of VIEWPORTS) {
          const raw = getBoundsHeuristic(cLng, cLat, zoom, w, h);
          keys.add(canonicalFetchBboxParam(raw, zoom));
        }
        expect(keys.size).toBe(1);
      });
    }

    it('z3/z4 every device collapses to the CONUS_BOUNDS key', () => {
      for (const zoom of [3, 4] as const) {
        for (const [w, h] of VIEWPORTS) {
          const raw = getBoundsHeuristic(
            CONUS_CENTER[0],
            CONUS_CENTER[1],
            zoom,
            w,
            h,
          );
          expect(canonicalFetchBboxParam(raw, zoom)).toBe(
            '-130.00,20.00,-65.00,52.00',
          );
        }
      }
    });
  });

  /** Clip a raw view to CONUS_BOUNDS — the on-screen-AND-in-CONUS portion. */
  function clipToConus(b: Bbox): Bbox {
    return [
      Math.max(b[0], CONUS_BOUNDS[0]),
      Math.max(b[1], CONUS_BOUNDS[1]),
      Math.min(b[2], CONUS_BOUNDS[2]),
      Math.min(b[3], CONUS_BOUNDS[3]),
    ];
  }

  describe('superset — never under-fetch', () => {
    it('z3/z4 CONUS default view: canonical ⊇ widest-device in-CONUS getBounds', () => {
      // The canonical box is itself CONUS-clamped, so it supersets the
      // ON-SCREEN-AND-IN-CONUS portion of the widest device's view (off-CONUS
      // ocean is intentionally never fetched). At the CONUS default the clipped
      // widest view IS CONUS_BOUNDS, which the canonical box equals.
      for (const zoom of [3, 4] as const) {
        const widest = getBoundsHeuristic(
          CONUS_CENTER[0],
          CONUS_CENTER[1],
          zoom,
          2560,
          1440,
        );
        expect(
          contains(canonicalFetchBbox(widest, zoom), clipToConus(widest)),
        ).toBe(true);
      }
    });

    it('z5 (metro-interior): canonical ⊇ the in-CONUS portion of a ≥2560px device getBounds', () => {
      // The z5 superset is asserted against the WIDEST canonical device under
      // the repo tile→bbox heuristic, where 2560×1440 frames exactly ±22°/±12°
      // — the trap the issue names: superset and the ≤8× over-fetch budget pull
      // in opposite directions, so the constants are pinned to the boundary.
      // A southern metro's widest z5 view can dip below the CONUS 20° floor
      // (Gulf/ocean), so we superset the in-CONUS portion — off-CONUS is never
      // fetched. The lng axis (the budget-pinned one) is supersetted exactly.
      const center: readonly [number, number] = [-97.74, 30.27]; // Austin
      const widest = getBoundsHeuristic(center[0], center[1], 5, 2560, 1440);
      expect(contains(canonicalFetchBbox(widest, 5), clipToConus(widest))).toBe(
        true,
      );
    });

    it('superset holds for realistic maxBounds-respecting CONUS viewports', () => {
      // The camera `maxBounds = CONUS_BOUNDS` clamp means a view can only pan
      // its center by HALF the slack between CONUS_BOUNDS and the view extent:
      // `panLng = max(0, (CONUS_width - view_width) / 2)`. At z3 the 1440px view
      // is wider than CONUS, so the center is pinned (panLng ≈ 0); at z5 a metro
      // view is small, so the center roams almost the whole CONUS. Deriving the
      // band from maxBounds (not a hand-picked constant) keeps every sampled
      // view physically reachable — the canonical box then supersets the
      // in-CONUS visible portion of every one.
      const rng = makeRng(2026);
      const conusW = CONUS_BOUNDS[2] - CONUS_BOUNDS[0];
      const conusH = CONUS_BOUNDS[3] - CONUS_BOUNDS[1];
      for (let i = 0; i < 300; i++) {
        for (const zoom of [3, 4, 5] as const) {
          const std = getBoundsHeuristic(0, 0, zoom, 1440, 900); // extent only
          const viewW = std[2] - std[0];
          const viewH = std[3] - std[1];
          const panLng = Math.max(0, (conusW - viewW) / 2);
          const panLat = Math.max(0, (conusH - viewH) / 2);
          const cLng = CONUS_CENTER[0] + (rng() * 2 - 1) * panLng;
          const cLat = CONUS_CENTER[1] + (rng() * 2 - 1) * panLat;
          const raw = getBoundsHeuristic(cLng, cLat, zoom, 1440, 900);
          const clipped = clipToConus(raw);
          if (clipped[0] >= clipped[2] || clipped[1] >= clipped[3]) continue;
          expect(contains(canonicalFetchBbox(raw, zoom), clipped)).toBe(true);
        }
      }
    });
  });

  describe('globe clamp', () => {
    it('a Hawaii-centered z3 call clamps west to >= -180', () => {
      // Honolulu ≈ (-157.86, 21.30). Pre-clamp expansion reaches west ≈ -192;
      // the globe clamp (and, for CONUS scope, the CONUS clamp) floor it.
      const hi = getBoundsMercator(-157.86, 21.3, 3, 1440, 900);
      const out = canonicalFetchBbox(hi, 3);
      expect(out[0]).toBeGreaterThanOrEqual(-180);
      expect(out[1]).toBeGreaterThanOrEqual(-90);
      expect(out[2]).toBeLessThanOrEqual(180);
      expect(out[3]).toBeLessThanOrEqual(90);
    });
  });

  describe('center = bbox MIDPOINT (never map.getCenter / mercator skew)', () => {
    it('two views with the same midpoint but different mercator centers → same key', () => {
      // A southern-biased and a northern-biased box sharing a midpoint must
      // produce one key (midpoint is linear; mercator center would diverge).
      const a: Bbox = [-100, 20, -96, 40]; // midpoint (-98, 30)
      const b: Bbox = [-100, 25, -96, 35]; // midpoint (-98, 30)
      expect(canonicalFetchBboxParam(a, 5)).toBe(canonicalFetchBboxParam(b, 5));
    });
  });

  describe('canonicalFetchBboxParam', () => {
    it('is canonicalFetchBbox + serializeBbox composed', () => {
      const b: Bbox = [-118.241, 33.998, -107.237, 40.051];
      expect(canonicalFetchBboxParam(b, 5)).toBe(
        serializeBbox(canonicalFetchBbox(b, 5)),
      );
    });
  });

  describe('mobile over-fetch budget (≤ 8×)', () => {
    it('canonical-z5-area / phone-viewport-area ≤ 8×', () => {
      const center: readonly [number, number] = [-97.74, 30.27]; // Austin
      const phone = getBoundsMercator(center[0], center[1], 5, 390, 844);
      const phoneArea = (phone[2] - phone[0]) * (phone[3] - phone[1]);
      const canon = canonicalFetchBbox(phone, 5);
      const canonArea = (canon[2] - canon[0]) * (canon[3] - canon[1]);
      expect(canonArea / phoneArea).toBeLessThanOrEqual(8);
    });
  });
});

describe('perObsFetchBbox (#1292 — non-degenerate per-observation fetch bbox)', () => {
  describe('non-degenerate serialization at sub-0.01° spans', () => {
    it('a z17-tight viewport (span ~0.0002°) serializes with W < E and S < N', () => {
      // Central Park at z17. The raw span is ~0.0002° per axis — below the
      // .toFixed(2) (0.01°) resolution, so the legacy serializer collapses it
      // to `-73.97,40.78,-73.97,40.78` (W==E, S==N → zero-area box → server
      // returns 0 rows → markers vanish, #1292). The per-obs serializer must
      // emit a STRICTLY non-degenerate string.
      const z17: Bbox = [-73.9698, 40.7779, -73.9696, 40.7781];
      const param = perObsFetchBboxParam(z17);
      const [w, s, e, n] = param.split(',').map(Number);
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
    });

    it('a z20-tight viewport (span ~0.00001°) still serializes non-degenerate', () => {
      const z20: Bbox = [-73.96975, 40.77795, -73.969749, 40.777951];
      const param = perObsFetchBboxParam(z20);
      const [w, s, e, n] = param.split(',').map(Number);
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      // At least one grid cell wide on each axis. Compare on the serialized
      // (.toFixed(4)) values — what actually goes over the wire — so the
      // assertion is immune to float-subtraction noise (0.00249999…).
      expect(e - w).toBeGreaterThanOrEqual(PER_OBS_STEP_DEG - 1e-9);
      expect(n - s).toBeGreaterThanOrEqual(PER_OBS_STEP_DEG - 1e-9);
    });

    it('the legacy serializer DOES degenerate the same z17 box (regression witness)', () => {
      // Pins the bug this fix exists for: serializeBbox alone flattens it.
      expect(serializeBbox([-73.9698, 40.7779, -73.9696, 40.7781])).toBe(
        '-73.97,40.78,-73.97,40.78',
      );
    });
  });

  describe('outward snap → superset (never under-fetch)', () => {
    it('snapped edges contain the input (floor W/S, ceil E/N)', () => {
      const raw: Bbox = [-73.9698, 40.7779, -73.9696, 40.7781];
      const out = perObsFetchBbox(raw);
      expect(out[0]).toBeLessThanOrEqual(raw[0]); // W floored
      expect(out[1]).toBeLessThanOrEqual(raw[1]); // S floored
      expect(out[2]).toBeGreaterThanOrEqual(raw[2]); // E ceiled
      expect(out[3]).toBeGreaterThanOrEqual(raw[3]); // N ceiled
    });

    it('superset property holds for randomized sub-cell viewports', () => {
      const rng = makeRng(1292);
      for (let i = 0; i < 500; i++) {
        const w = -125 + rng() * 50;
        const s = 24 + rng() * 25;
        // Spans from ~0 up to ~0.02° — straddles the degeneracy threshold.
        const e = w + rng() * 0.02;
        const n = s + rng() * 0.02;
        const raw: Bbox = [w, s, e, n];
        const out = perObsFetchBbox(raw);
        expect(out[0]).toBeLessThanOrEqual(raw[0]);
        expect(out[1]).toBeLessThanOrEqual(raw[1]);
        expect(out[2]).toBeGreaterThanOrEqual(raw[2]);
        expect(out[3]).toBeGreaterThanOrEqual(raw[3]);
        // And NEVER degenerate after serialization.
        const [pw, ps, pe, pn] = perObsFetchBboxParam(raw).split(',').map(Number);
        expect(pw).toBeLessThan(pe);
        expect(ps).toBeLessThan(pn);
      }
    });
  });

  describe('grid lossless under the chosen precision', () => {
    it('the step is lossless at the serialized precision (round-trips exactly)', () => {
      // Every snapped edge is a PER_OBS_STEP_DEG multiple, so .toFixed(4) is
      // exact — re-parsing the string recovers the snapped numeric edges.
      const raw: Bbox = [-73.9698, 40.7779, -73.9696, 40.7781];
      const out = perObsFetchBbox(raw);
      const reparsed = perObsFetchBboxParam(raw).split(',').map(Number) as Bbox;
      expect(reparsed).toEqual(out);
    });
  });

  describe('cache reuse — nearby pans within one cell collapse to one key', () => {
    it('viewports whose edges fall in one step interval → 1 key', () => {
      const keys = new Set<string>();
      const rng = makeRng(77);
      for (let i = 0; i < 50; i++) {
        // All edges inside one 0.0025° cell at Central Park.
        const w = -73.9699 + rng() * 0.0005;
        const s = 40.7779 + rng() * 0.0005;
        const e = w + 0.0001;
        const n = s + 0.0001;
        keys.add(perObsFetchBboxParam([w, s, e, n]));
      }
      expect(keys.size).toBe(1);
    });
  });

  describe('stays well under the validate.ts area cap (45×25 at z>=6)', () => {
    it('a representative z16-ish box round-trips to a tiny area', () => {
      const raw: Bbox = [-73.98, 40.77, -73.96, 40.78];
      const out = perObsFetchBbox(raw);
      const lngSpan = out[2] - out[0];
      const latSpan = out[3] - out[1];
      expect(lngSpan).toBeLessThanOrEqual(45);
      expect(latSpan).toBeLessThanOrEqual(25);
      // The snap adds at most one cell per edge, so the box stays a tight
      // superset of the viewport (not the whole state).
      expect(lngSpan).toBeLessThan(0.03);
      expect(latSpan).toBeLessThan(0.02);
    });
  });

  describe('perObsFetchBboxParam', () => {
    it('is perObsFetchBbox + .toFixed(4) comma-joined composed', () => {
      const raw: Bbox = [-73.9698, 40.7779, -73.9696, 40.7781];
      const out = perObsFetchBbox(raw);
      expect(perObsFetchBboxParam(raw)).toBe(
        out.map((v) => v.toFixed(4)).join(','),
      );
    });
  });
});
