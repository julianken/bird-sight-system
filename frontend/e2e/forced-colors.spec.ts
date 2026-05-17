/**
 * forced-colors.spec.ts — Phase 3 (#572, epic #575)
 *
 * Smoke test for Windows High Contrast Mode (forced-colors) support on
 * AdaptiveGridMarker cells.
 *
 * Test strategy:
 *   - Stubs /api/silhouettes with one family that HAS svgData (→ rendered
 *     cell) and one that lacks svgData (→ fallback cell). Both cells appear
 *     on the map because observations are stubbed to co-locate them.
 *   - Stubs /api/observations to produce enough data that the supercluster
 *     aggregation generates at least one AdaptiveGridMarker on the visible
 *     viewport. Four observations at the same location are clustered by
 *     MapLibre's built-in GeoJSON clustering.
 *   - Calls `page.emulateMedia({ forcedColors: 'active' })` before render.
 *   - Asserts AC1a: the silhouette SVG path carries `forced-color-adjust: auto`
 *     in its computed style (proves the opt-in engaged — by default SVG content
 *     gets `forced-color-adjust: none` from the UA stylesheet).
 *   - Asserts AC1b: the cell wrapper has `border-style: solid` (proves the
 *     `@media (forced-colors: active)` block in ds-primitives.css is applied).
 *
 * WebGL guard: the map canvas requires WebGL. Headless Chromium in some CI
 * environments has no WebGL backend. We use `test.skip` so CI stays green in
 * those environments; the design-review workflow captures the real signal via
 * a full-desktop runner.
 *
 * No DB writes. Route stubs replace every /api/* call.
 */

import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

const TUCSON_LNG = -110.97;
const TUCSON_LAT = 32.22;

// Minimal silhouettes payload: one family with art (→ rendered cell) and one
// without (no svgData, so the map treats it as fallback).
const SILHOUETTES_STUB = [
  {
    familyCode: 'trochilidae',
    color: '#2E7D32',
    colorDark: '#4CAF50',
    svgData:
      'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
    source: null,
    license: null,
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'accipitridae',
    color: '#B71C1C',
    colorDark: '#EF5350',
    // No svgData → fallback render path in AdaptiveGridMarker.
    svgData: null,
    source: null,
    license: null,
    commonName: 'Hawks, Eagles, and Kites',
    creator: null,
  },
  {
    familyCode: '_FALLBACK',
    color: '#555555',
    colorDark: '#999999',
    svgData:
      'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
    source: null,
    license: null,
    commonName: 'Unknown family',
    creator: null,
  },
];

// Three observations at the same Tucson hotspot lat/lng so the supercluster
// aggregation produces a single cluster marker at most zoom levels.
const OBSERVATIONS_STUB = [
  {
    subId: 'FC-1',
    speciesCode: 'annhum',
    comName: "Anna's Hummingbird",
    lat: TUCSON_LAT,
    lng: TUCSON_LNG,
    obsDt: '2026-05-01T10:00:00Z',
    locId: 'L-FC-1',
    locName: 'Test Hotspot',
    howMany: 2,
    isNotable: false,
    silhouetteId: 'trochilidae',
    familyCode: 'trochilidae',
  },
  {
    subId: 'FC-2',
    speciesCode: 'annhum',
    comName: "Anna's Hummingbird",
    lat: TUCSON_LAT + 0.001,
    lng: TUCSON_LNG + 0.001,
    obsDt: '2026-05-01T10:05:00Z',
    locId: 'L-FC-1',
    locName: 'Test Hotspot',
    howMany: 1,
    isNotable: false,
    silhouetteId: 'trochilidae',
    familyCode: 'trochilidae',
  },
  {
    subId: 'FC-3',
    speciesCode: 'coohaw',
    comName: "Cooper's Hawk",
    lat: TUCSON_LAT + 0.002,
    lng: TUCSON_LNG + 0.002,
    obsDt: '2026-05-01T10:10:00Z',
    locId: 'L-FC-2',
    locName: 'Test Hotspot 2',
    howMany: 1,
    isNotable: false,
    silhouetteId: 'accipitridae',
    familyCode: 'accipitridae',
  },
];

async function waitForMapReady(page: import('@playwright/test').Page) {
  await page.locator('[data-testid=map-canvas]').waitFor({ state: 'visible', timeout: 15_000 });
  return page.evaluate(() => Boolean((window as Record<string, unknown>).__birdMap));
}

async function flyTo(
  page: import('@playwright/test').Page,
  lng: number,
  lat: number,
  zoom: number,
) {
  await page.evaluate(
    ([lng, lat, zoom]: [number, number, number]) => {
      const map = (window as Record<string, { flyTo?: (opts: object) => void }>).__birdMap as
        | { flyTo: (opts: object) => void }
        | undefined;
      if (map?.flyTo) map.flyTo({ center: [lng, lat], zoom, duration: 0 });
    },
    [lng, lat, zoom] as [number, number, number],
  );
  // Let the adaptive-grid reconciler commit markers.
  await page.waitForTimeout(800);
}

test.describe('Forced-colors mode (Phase 3, #572)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test(
    'rendered cell SVG path has forced-color-adjust:auto and cell border-style:solid',
    async ({ page }) => {
      // Engage forced-colors BEFORE navigation so the emulation is active when
      // the stylesheet is parsed and the SVG paths are first painted.
      await page.emulateMedia({ forcedColors: 'active' });

      // Route stubs must be registered before page.goto.
      await page.route('**/api/hotspots', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.route('**/api/silhouettes', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SILHOUETTES_STUB),
        });
      });
      await page.route('**/api/observations**', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: OBSERVATIONS_STUB,
            meta: { freshestObservationAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
          }),
        });
      });

      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const webglReady = await waitForMapReady(page);
      test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint');

      // Fly to the observation cluster at a zoom that produces a grid marker.
      await flyTo(page, TUCSON_LNG, TUCSON_LAT, 14);

      // Wait for at least one AdaptiveGridMarker to appear.
      const marker = page.locator('[data-testid="adaptive-grid-marker"]').first();
      await marker.waitFor({ state: 'visible', timeout: 10_000 });

      // Locate the first rendered cell's SVG path.
      const svgPath = page
        .locator('[data-testid^="adaptive-grid-marker-cell-rendered"] svg path')
        .last();

      // AC1a — forced-color-adjust: auto on the silhouette path.
      // This assertion fails if forcedColorAdjust:'auto' is absent from the
      // inline style, because the UA stylesheet defaults SVG to
      // forced-color-adjust:none and no @media rule can override a UA rule
      // on the element itself without the explicit inline opt-in.
      const forcedColorAdjust = await svgPath.evaluate(
        (el: Element) => getComputedStyle(el).getPropertyValue('forced-color-adjust'),
      );
      expect(
        forcedColorAdjust,
        'SVG path must have forced-color-adjust:auto (inline style opt-in)',
      ).toBe('auto');

      // AC1b — border-style: solid on the cell wrapper (proves the
      // @media (forced-colors: active) block in ds-primitives.css is applied).
      const cell = page.locator('[data-testid^="adaptive-grid-marker-cell-rendered"]').first();
      const borderStyle = await cell.evaluate(
        (el: Element) => getComputedStyle(el).borderStyle,
      );
      expect(
        borderStyle,
        'Cell must have border-style:solid under forced-colors (ds-primitives.css block)',
      ).toBe('solid');
    },
  );
});
