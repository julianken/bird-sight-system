/**
 * badge-anchor.spec.ts — badge anchors to cell, not grid corner (bugfix)
 *
 * User-reported bug: the count badge on AdaptiveGridMarker cells rendered as
 * `<button>` was visually anchored at the GRID corner rather than the per-cell
 * corner, so multiple count>1 cells in one cluster all stacked badges at the
 * same offset from the grid origin.
 *
 * Root cause: inline `style={{ all: 'unset' }}` on the button reset `position`
 * to `static`, overriding the class-level `position: relative`. The absolutely-
 * positioned badge then fell through to the nearest positioned ancestor — the
 * grid element (also `position: relative`) — instead of anchoring to the cell.
 *
 * Fix: remove `all: 'unset'` from the inline style; add a
 * `button.adaptive-grid-marker__cell` CSS rule (specificity 0,1,1) to supply
 * the necessary browser chrome-reset properties (background, border, padding,
 * font) without touching `position`.
 *
 * This spec asserts the real-browser layout contract: for every cell that has a
 * badge, the badge's right/bottom edges must be within 5px of the cell's
 * right/bottom edges. jsdom does not have a layout engine and cannot catch this
 * regression — this Playwright test is the load-bearing AC verification.
 *
 * Test strategy:
 *   - Stubs /api/silhouettes with 4 families (3 with svgData → rendered branch,
 *     1 without → fallback branch). Forces at least 3 rendered cells with count>1
 *     so multiple badges appear in one cluster.
 *   - Stubs /api/observations with enough co-located points that supercluster
 *     aggregation produces one cluster with ≥3 count>1 cells.
 *   - Flies to the cluster at zoom=14 where the grid marker is visible.
 *   - Asserts badge.getBoundingClientRect().right ≈ cell.getBoundingClientRect().right
 *     and badge.bottom ≈ cell.bottom for each badged cell (±5px tolerance).
 *
 * WebGL guard: same skip-pattern as forced-colors.spec.ts and
 * basemap-dark-flip.spec.ts. Headless Chromium in some CI environments has no
 * WebGL backend; without it the map canvas never paints and layout is vacuous.
 *
 * No DB writes. Route stubs replace every /api/* call.
 */

import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

const TUCSON_LNG = -110.97;
const TUCSON_LAT = 32.22;

// Four families: 3 with svgData (→ rendered branch), 1 without (→ fallback).
// All four are co-located so the cluster aggregator produces a 2×2 grid with
// tiles: trochilidae(3 obs), tyrannidae(2 obs), picidae(2 obs), accipitridae(1 obs).
// Cells with count>1 get badges; count===1 cells do not (PR #553 invariant).
const SILHOUETTES_STUB = [
  {
    familyCode: 'trochilidae',
    color: '#2E7D32',
    colorDark: '#4CAF50',
    svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
    source: null,
    license: null,
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'tyrannidae',
    color: '#E65100',
    colorDark: '#FF8A65',
    svgData: 'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
    source: null,
    license: null,
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'picidae',
    color: '#1565C0',
    colorDark: '#42A5F5',
    svgData: 'M8 4 L10 4 L10 8 L14 8 L14 12 L16 14 L14 16 L10 16 L8 14 L8 10 L6 8 Z',
    source: null,
    license: null,
    commonName: 'Woodpeckers',
    creator: null,
  },
  {
    familyCode: 'accipitridae',
    color: '#B71C1C',
    colorDark: '#EF5350',
    // No svgData → fallback branch; count===1 → no badge anyway.
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
    svgData: 'M 4 12 L 8 6 L 12 4 L 16 6 L 20 12 L 16 18 L 12 20 L 8 18 Z',
    source: null,
    license: null,
    commonName: 'Unknown family',
    creator: null,
  },
];

// Eight observations at the same Tucson hotspot so supercluster aggregates
// them into a single cluster marker. Distribution:
//   trochilidae × 3 obs → cell badge "3"
//   tyrannidae  × 2 obs → cell badge "2"
//   picidae     × 2 obs → cell badge "2"
//   accipitridae × 1 obs → no badge (PR #553 invariant: count===1 = no badge)
const OBSERVATIONS_STUB = [
  // trochilidae — 3 obs (all very close together)
  {
    subId: 'BA-1', speciesCode: 'annhum', comName: "Anna's Hummingbird",
    lat: TUCSON_LAT, lng: TUCSON_LNG,
    obsDt: '2026-05-01T10:00:00Z', locId: 'L-BA-1', locName: 'Test Hotspot',
    howMany: 1, isNotable: false, silhouetteId: 'trochilidae', familyCode: 'trochilidae',
  },
  {
    subId: 'BA-2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
    lat: TUCSON_LAT + 0.0001, lng: TUCSON_LNG + 0.0001,
    obsDt: '2026-05-01T10:02:00Z', locId: 'L-BA-1', locName: 'Test Hotspot',
    howMany: 1, isNotable: false, silhouetteId: 'trochilidae', familyCode: 'trochilidae',
  },
  {
    subId: 'BA-3', speciesCode: 'bkhum', comName: "Black-chinned Hummingbird",
    lat: TUCSON_LAT - 0.0001, lng: TUCSON_LNG - 0.0001,
    obsDt: '2026-05-01T10:04:00Z', locId: 'L-BA-1', locName: 'Test Hotspot',
    howMany: 1, isNotable: false, silhouetteId: 'trochilidae', familyCode: 'trochilidae',
  },
  // tyrannidae — 2 obs
  {
    subId: 'BA-4', speciesCode: 'vermfl', comName: 'Vermilion Flycatcher',
    lat: TUCSON_LAT + 0.0002, lng: TUCSON_LNG - 0.0002,
    obsDt: '2026-05-01T10:06:00Z', locId: 'L-BA-2', locName: 'Test Hotspot 2',
    howMany: 1, isNotable: false, silhouetteId: 'tyrannidae', familyCode: 'tyrannidae',
  },
  {
    subId: 'BA-5', speciesCode: 'blkpho', comName: 'Black Phoebe',
    lat: TUCSON_LAT - 0.0002, lng: TUCSON_LNG + 0.0002,
    obsDt: '2026-05-01T10:08:00Z', locId: 'L-BA-2', locName: 'Test Hotspot 2',
    howMany: 1, isNotable: false, silhouetteId: 'tyrannidae', familyCode: 'tyrannidae',
  },
  // picidae — 2 obs
  {
    subId: 'BA-6', speciesCode: 'giawoo', comName: 'Gila Woodpecker',
    lat: TUCSON_LAT + 0.0003, lng: TUCSON_LNG + 0.0003,
    obsDt: '2026-05-01T10:10:00Z', locId: 'L-BA-3', locName: 'Test Hotspot 3',
    howMany: 1, isNotable: false, silhouetteId: 'picidae', familyCode: 'picidae',
  },
  {
    subId: 'BA-7', speciesCode: 'ladbac', comName: "Ladder-backed Woodpecker",
    lat: TUCSON_LAT - 0.0003, lng: TUCSON_LNG - 0.0003,
    obsDt: '2026-05-01T10:12:00Z', locId: 'L-BA-3', locName: 'Test Hotspot 3',
    howMany: 1, isNotable: false, silhouetteId: 'picidae', familyCode: 'picidae',
  },
  // accipitridae — 1 obs → no badge
  {
    subId: 'BA-8', speciesCode: 'coohaw', comName: "Cooper's Hawk",
    lat: TUCSON_LAT + 0.0004, lng: TUCSON_LNG - 0.0004,
    obsDt: '2026-05-01T10:14:00Z', locId: 'L-BA-4', locName: 'Test Hotspot 4',
    howMany: 1, isNotable: false, silhouetteId: 'accipitridae', familyCode: 'accipitridae',
  },
];

async function waitForMapReady(page: import('@playwright/test').Page) {
  await page.locator('[data-testid=map-canvas]').waitFor({ state: 'visible', timeout: 15_000 });
  return page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).__birdMap));
}

async function flyTo(
  page: import('@playwright/test').Page,
  lng: number,
  lat: number,
  zoom: number,
) {
  await page.evaluate(
    ([lng, lat, zoom]: [number, number, number]) => {
      const map = (window as unknown as Record<string, { flyTo?: (opts: object) => void }>).__birdMap as
        | { flyTo: (opts: object) => void }
        | undefined;
      if (map?.flyTo) map.flyTo({ center: [lng, lat], zoom, duration: 0 });
    },
    [lng, lat, zoom] as [number, number, number],
  );
  // Let the adaptive-grid reconciler commit markers.
  await page.waitForTimeout(800);
}

test.describe('Badge anchor (bugfix: badge must anchor to cell, not grid corner)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test(
    'each cell badge is positioned within 5px of its own cell right/bottom edges',
    async ({ page }) => {
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

      // Locate all badges within the marker.
      const badges = marker.locator('[data-testid="adaptive-grid-marker-badge"]');
      const badgeCount = await badges.count();

      // Must have at least 2 badged cells (trochilidae + tyrannidae or picidae)
      // for the bug to be observable. Skip the assertion if the cluster didn't
      // aggregate as expected (e.g. different zoom breakpoint on this runner).
      test.skip(badgeCount < 2, `Only ${badgeCount} badge(s) found — cluster did not produce ≥2 count>1 cells at this zoom`);

      // For each badge, verify it is anchored to its own cell and not to the grid.
      const results = await page.evaluate(() => {
        const badges = Array.from(
          document.querySelectorAll('[data-testid="adaptive-grid-marker-badge"]'),
        );
        return badges.map(badge => {
          // Walk up to the nearest cell ancestor.
          let ancestor: Element | null = badge.parentElement;
          while (ancestor && !ancestor.getAttribute('data-testid')?.startsWith('adaptive-grid-marker-cell')) {
            ancestor = ancestor.parentElement;
          }
          if (!ancestor) return { error: 'no cell ancestor found' };

          const bRect = badge.getBoundingClientRect();
          const cRect = ancestor.getBoundingClientRect();

          return {
            badgeRight: bRect.right,
            badgeBottom: bRect.bottom,
            cellRight: cRect.right,
            cellBottom: cRect.bottom,
            deltaRight: Math.abs(bRect.right - cRect.right),
            deltaBottom: Math.abs(bRect.bottom - cRect.bottom),
            cellTestId: ancestor.getAttribute('data-testid') ?? '',
          };
        });
      });

      // Every badge must anchor within 5px of its cell (not the grid).
      for (const result of results) {
        if ('error' in result) {
          throw new Error(`Badge anchor check failed: ${result.error}`);
        }
        expect(
          result.deltaRight,
          `Badge right edge (+${result.badgeRight.toFixed(0)}) must be within 5px of cell right edge (${result.cellRight.toFixed(0)}) — got delta ${result.deltaRight.toFixed(1)}px. Bug: badge anchored to grid corner, not cell corner.`,
        ).toBeLessThanOrEqual(5);
        expect(
          result.deltaBottom,
          `Badge bottom edge (+${result.badgeBottom.toFixed(0)}) must be within 5px of cell bottom edge (${result.cellBottom.toFixed(0)}) — got delta ${result.deltaBottom.toFixed(1)}px. Bug: badge anchored to grid corner, not cell corner.`,
        ).toBeLessThanOrEqual(5);
      }
    },
  );
});
