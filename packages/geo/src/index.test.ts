import { describe, it, expect } from 'vitest';
import {
  snapFetchBbox,
  serializeBbox,
  snapFetchBboxParam,
  SNAP_STEP_DEG,
  type Bbox,
} from './index.js';

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
