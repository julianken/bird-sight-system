import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  encodeViewbox,
  decodeViewbox,
  type ViewboxCamera,
  type ViewboxViewport,
} from './viewbox-link.js';

// viewbox-link is a PURE, TOTAL-function codec (epic #1238 / C1, #1239):
// camera (+ optional capture viewport) ↔ URL hash fragment. No DOM, no app
// wiring — exhaustively unit-tested string ↔ object mapping. The decode path
// must NEVER throw and must NEVER partial-apply a camera: a hand-edited or
// truncated link degrades to a clean `null` ("normal load"), never a crash.
//
// Grammar: #map=<zoom>/<lat>/<lng>[/<bearing>[/<pitch>]][&v=<W>x<H>@<dpr>]
// Field order is zoom/lat/lng (lat 2nd, lng 3rd — MapLibre hash order).

describe('viewbox-link codec', () => {
  // ── encode → decode round-trip table ────────────────────────────────────
  describe('round-trip', () => {
    const cases: Array<{ name: string; cam: ViewboxCamera; vp?: ViewboxViewport }> = [
      {
        name: 'north-up flat (no bearing/pitch, no viewport)',
        cam: { zoom: 12.5, lat: 34.0489, lng: -111.0937 },
      },
      {
        name: 'rotated (bearing ≠ 0)',
        cam: { zoom: 14, lat: 40.7128, lng: -74.006, bearing: 45 },
      },
      {
        name: 'pitched (pitch ≠ 0, bearing 0 — bearing still emitted)',
        cam: { zoom: 9.25, lat: 47.6062, lng: -122.3321, pitch: 35 },
      },
      {
        name: 'rotated + pitched',
        cam: { zoom: 16.125, lat: 38.9072, lng: -77.0369, bearing: 270, pitch: 60 },
      },
      {
        name: 'with viewport',
        cam: { zoom: 11, lat: 33.4484, lng: -112.074 },
        vp: { w: 1440, h: 900, dpr: 2 },
      },
      {
        name: 'rotated + pitched + viewport',
        cam: { zoom: 13.75, lat: 25.7617, lng: -80.1918, bearing: 123.4, pitch: 42.5 },
        vp: { w: 390, h: 844, dpr: 3 },
      },
    ];

    for (const { name, cam, vp } of cases) {
      it(`round-trips: ${name}`, () => {
        const decoded = decodeViewbox(encodeViewbox(cam, vp));
        expect(decoded).not.toBeNull();
        // Camera survives within toFixed precision.
        expect(decoded!.camera.zoom).toBeCloseTo(cam.zoom, 3);
        expect(decoded!.camera.lat).toBeCloseTo(cam.lat, 5);
        expect(decoded!.camera.lng).toBeCloseTo(cam.lng, 5);
        if (cam.bearing && cam.bearing !== 0) {
          expect(decoded!.camera.bearing).toBeCloseTo(cam.bearing, 1);
        }
        if (cam.pitch && cam.pitch !== 0) {
          expect(decoded!.camera.pitch).toBeCloseTo(cam.pitch, 1);
        }
        // Viewport survives exactly when supplied.
        if (vp) {
          expect(decoded!.viewport).toEqual(vp);
        } else {
          expect(decoded!.viewport).toBeUndefined();
        }
      });
    }
  });

  // ── encode formatting rules ─────────────────────────────────────────────
  describe('encode', () => {
    it('returns the fragment WITHOUT a leading #', () => {
      const out = encodeViewbox({ zoom: 12, lat: 34, lng: -111 });
      expect(out.startsWith('#')).toBe(false);
      expect(out.startsWith('map=')).toBe(true);
    });

    it('omits bearing AND pitch when both are 0 (no trailing /0/0)', () => {
      expect(encodeViewbox({ zoom: 12, lat: 34, lng: -111, bearing: 0, pitch: 0 })).toBe(
        'map=12.000/34.00000/-111.00000',
      );
    });

    it('omits bearing/pitch when absent (north-up flat)', () => {
      expect(encodeViewbox({ zoom: 12, lat: 34, lng: -111 })).toBe(
        'map=12.000/34.00000/-111.00000',
      );
    });

    it('emits bearing only (no trailing pitch) when pitch is 0 but bearing ≠ 0', () => {
      expect(encodeViewbox({ zoom: 8, lat: 12, lng: 34, bearing: 90 })).toBe(
        'map=8.000/12.00000/34.00000/90.0',
      );
    });

    it('emits bearing as 0.0 when pitch ≠ 0 but bearing == 0 (slot disambiguation)', () => {
      // Slash positions must stay unambiguous: a pitched view with bearing 0
      // still emits the bearing field so pitch lands in the 5th slot.
      expect(encodeViewbox({ zoom: 8, lat: 12, lng: 34, pitch: 30 })).toBe(
        'map=8.000/12.00000/34.00000/0.0/30.0',
      );
    });

    it('uses fixed decimals — zoom toFixed(3), lat/lng toFixed(5), bearing/pitch toFixed(1)', () => {
      expect(encodeViewbox({ zoom: 6, lat: 1.5, lng: -2.5, bearing: 33, pitch: 12 })).toBe(
        'map=6.000/1.50000/-2.50000/33.0/12.0',
      );
    });

    it('serializes -110.9 and -110.90000 identically (fixed-decimal, never String(n))', () => {
      const a = encodeViewbox({ zoom: 10, lat: 30, lng: -110.9 });
      const b = encodeViewbox({ zoom: 10, lat: 30, lng: -110.9 });
      expect(a).toBe(b);
      expect(a).toContain('-110.90000');
      // round-trips back to the same value
      expect(decodeViewbox(a)!.camera.lng).toBeCloseTo(-110.9, 5);
    });

    it('appends the viewport as &v=<w>x<h>@<dpr>', () => {
      expect(
        encodeViewbox({ zoom: 12, lat: 34, lng: -111 }, { w: 1920, h: 1080, dpr: 1 }),
      ).toBe('map=12.000/34.00000/-111.00000&v=1920x1080@1');
    });

    it('places lat 2nd and lng 3rd (MapLibre field order)', () => {
      const out = encodeViewbox({ zoom: 5, lat: 11.11111, lng: 99.99999 });
      // value part after `map=`
      const fields = out.replace('map=', '').split('/');
      expect(fields[0]).toBe('5.000'); // zoom
      expect(fields[1]).toBe('11.11111'); // lat
      expect(fields[2]).toBe('99.99999'); // lng
    });
  });

  // ── decode: null on garbage (total, never throws, never partial-applies) ─
  describe('decode — null on garbage', () => {
    const garbage: Array<[string, string]> = [
      ['empty string', ''],
      ['bare hash', '#'],
      ['unknown key only', '#foo=bar'],
      ['empty map value', '#map='],
      ['one field', '#map=14'],
      ['all-NaN fields', '#map=a/b/c'],
      ['NaN in a required field (lat)', '#map=14/abc/-110'],
    ];

    for (const [name, hash] of garbage) {
      it(`returns null for ${name}: ${JSON.stringify(hash)}`, () => {
        expect(decodeViewbox(hash)).toBeNull();
      });
    }

    it('returns null when fewer than 3 fields (only zoom/lat)', () => {
      expect(decodeViewbox('#map=14/34')).toBeNull();
    });

    it('rejects trailing garbage in a required field (Number(), not parseFloat)', () => {
      // parseFloat('14abc') === 14 (lenient); Number('14abc') === NaN (strict).
      // The codec must reject the corrupted field, returning null.
      expect(decodeViewbox('#map=14abc/34/-111')).toBeNull();
    });

    it('never throws on arbitrary junk (total function)', () => {
      const junk = ['#map=////', '#&&&', '#map=1/2/3/x/y/z/w', '#=', '#map', 'map=14/34/-111'];
      for (const h of junk) {
        expect(() => decodeViewbox(h)).not.toThrow();
      }
    });
  });

  // ── decode: clamp boundaries (clamp recoverable, do not reject) ──────────
  describe('decode — clamping', () => {
    it('does NOT clamp a z16 link to the fitBounds cap of 12 (interactive max is 22)', () => {
      // The critical AC (#1239): clamping zoom to 12 would silently defeat
      // epic #1238's exact-view premise. A z16 link must reopen at z16.
      const decoded = decodeViewbox('#map=16/34/-111');
      expect(decoded!.camera.zoom).toBe(16);
    });

    it('clamps a z25 link to the interactive max CLUSTER_MAX_ZOOM (22)', () => {
      const decoded = decodeViewbox('#map=25/34/-111');
      expect(decoded!.camera.zoom).toBe(22);
    });

    it('clamps zoom below MIN_ZOOM (2) up to 2', () => {
      const decoded = decodeViewbox('#map=0.5/34/-111');
      expect(decoded!.camera.zoom).toBe(2);
    });

    it('clamps lat beyond +85.05113 to the Web Mercator limit (NOT +90)', () => {
      const decoded = decodeViewbox('#map=10/89/-111');
      expect(decoded!.camera.lat).toBeCloseTo(85.05113, 5);
      expect(decoded!.camera.lat).not.toBe(89);
      expect(decoded!.camera.lat).not.toBe(90);
    });

    it('clamps lat beyond -85.05113 to the Web Mercator limit (NOT -90)', () => {
      const decoded = decodeViewbox('#map=10/-89/-111');
      expect(decoded!.camera.lat).toBeCloseTo(-85.05113, 5);
      expect(decoded!.camera.lat).not.toBe(-90);
    });

    it('clamps lng beyond +180 to +180', () => {
      const decoded = decodeViewbox('#map=10/34/200');
      expect(decoded!.camera.lng).toBe(180);
    });

    it('clamps lng beyond -180 to -180', () => {
      const decoded = decodeViewbox('#map=10/34/-200');
      expect(decoded!.camera.lng).toBe(-180);
    });

    it('wraps an out-of-range bearing into [0,360)', () => {
      // 450 % 360 === 90; normalize keeps z/lat/lng intact.
      const decoded = decodeViewbox('#map=10/34/-111/450');
      expect(decoded!.camera.bearing).toBeCloseTo(90, 1);
      expect(decoded!.camera.zoom).toBe(10);
      expect(decoded!.camera.lat).toBe(34);
      expect(decoded!.camera.lng).toBe(-111);
    });

    it('wraps a negative bearing into [0,360)', () => {
      // -90 → 270
      const decoded = decodeViewbox('#map=10/34/-111/-90');
      expect(decoded!.camera.bearing).toBeCloseTo(270, 1);
    });

    it('clamps pitch above 60 to 60', () => {
      const decoded = decodeViewbox('#map=10/34/-111/0/85');
      expect(decoded!.camera.pitch).toBe(60);
    });

    it('clamps pitch below 0 to 0', () => {
      const decoded = decodeViewbox('#map=10/34/-111/0/-10');
      expect(decoded!.camera.pitch).toBe(0);
    });

    it('drops a NaN bearing but keeps z/lat/lng', () => {
      const decoded = decodeViewbox('#map=10/34/-111/notabearing');
      expect(decoded).not.toBeNull();
      expect(decoded!.camera.bearing).toBeUndefined();
      expect(decoded!.camera.zoom).toBe(10);
      expect(decoded!.camera.lat).toBe(34);
      expect(decoded!.camera.lng).toBe(-111);
    });

    it('drops a NaN pitch but keeps bearing + z/lat/lng', () => {
      const decoded = decodeViewbox('#map=10/34/-111/45/notapitch');
      expect(decoded).not.toBeNull();
      expect(decoded!.camera.bearing).toBeCloseTo(45, 1);
      expect(decoded!.camera.pitch).toBeUndefined();
      expect(decoded!.camera.zoom).toBe(10);
    });
  });

  // ── decode: viewport + unknown-key tolerance ────────────────────────────
  describe('decode — viewport and unknown keys', () => {
    it('parses a valid &v=<w>x<h>@<dpr>', () => {
      const decoded = decodeViewbox('#map=12/34/-111&v=1440x900@2');
      expect(decoded!.viewport).toEqual({ w: 1440, h: 900, dpr: 2 });
    });

    it('parses a fractional dpr viewport', () => {
      const decoded = decodeViewbox('#map=12/34/-111&v=800x600@1.5');
      expect(decoded!.viewport).toEqual({ w: 800, h: 600, dpr: 1.5 });
    });

    it('ignores a malformed &v= WITHOUT nulling the camera', () => {
      const malformed = [
        '#map=12/34/-111&v=garbage',
        '#map=12/34/-111&v=1440x900', // missing @dpr
        '#map=12/34/-111&v=1440@2', // missing height
        '#map=12/34/-111&v=0x900@2', // non-positive width
        '#map=12/34/-111&v=1440x-900@2', // negative height
        '#map=12/34/-111&v=1440x900@0', // non-positive dpr
        '#map=12/34/-111&v=Infinityx900@2', // non-finite
      ];
      for (const h of malformed) {
        const decoded = decodeViewbox(h);
        expect(decoded).not.toBeNull();
        expect(decoded!.camera.zoom).toBe(12);
        expect(decoded!.viewport).toBeUndefined();
      }
    });

    it('ignores unknown sub-keys (forward-compatible)', () => {
      const decoded = decodeViewbox('#map=12/34/-111&foo=1&bar=baz');
      expect(decoded).not.toBeNull();
      expect(decoded!.camera).toEqual({ zoom: 12, lat: 34, lng: -111 });
      expect(decoded!.viewport).toBeUndefined();
    });

    it('finds map= regardless of sub-key order', () => {
      const decoded = decodeViewbox('#foo=1&v=800x600@1&map=12/34/-111');
      expect(decoded).not.toBeNull();
      expect(decoded!.camera.zoom).toBe(12);
      expect(decoded!.viewport).toEqual({ w: 800, h: 600, dpr: 1 });
    });

    it('tolerates a leading # being absent', () => {
      const decoded = decodeViewbox('map=12/34/-111');
      expect(decoded).not.toBeNull();
      expect(decoded!.camera.zoom).toBe(12);
    });
  });

  // ── purity: no DOM access ───────────────────────────────────────────────
  describe('purity', () => {
    it('the module source references no window / document / DOM globals', () => {
      // Resolve the sibling source from the frontend workspace root (vitest's
      // cwd) rather than import.meta.url — under the vite transform the latter
      // is not a file: URL, so fileURLToPath() rejects it.
      const src = readFileSync(
        path.resolve(process.cwd(), 'src/state/viewbox-link.ts'),
        'utf8',
      );
      // Strip line + block comments so a "no DOM" comment can't trip the scan.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      expect(code).not.toMatch(/\bwindow\b/);
      expect(code).not.toMatch(/\bdocument\b/);
      expect(code).not.toMatch(/\blocation\b/);
      expect(code).not.toMatch(/\blocalStorage\b/);
    });
  });
});
