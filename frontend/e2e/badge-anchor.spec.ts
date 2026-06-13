/**
 * badge-anchor.spec.ts — badge anchors INSIDE its own cell, not the grid corner
 *
 * Original bug (fixed PR #563): the count badge on AdaptiveGridMarker cells
 * rendered as `<button>` was visually anchored at the GRID corner rather than
 * the per-cell corner, so multiple count>1 cells in one cluster all stacked
 * badges at the same offset from the grid origin. Root cause: inline
 * `style={{ all: 'unset' }}` reset `position` to `static`, so the absolutely-
 * positioned badge fell through to the grid (also `position: relative`).
 *
 * E6 / #1058 (M-15 "Yuma clump"): the badge was anchored `bottom:-3px;
 * right:-3px`, OVERHANGING the 22px tile across the 2px grid gap into the
 * neighbouring cell — so at a dense border a "3" read as belonging to two
 * birds at once. The fix moves the badge to the top-right INSIDE the tile
 * (`top:0; right:0`; the 14px badge fits within the 22px cell), keeping the
 * existing 1px white box-shadow ring (the WCAG 1.4.11 contrast floor). Every
 * badge bbox must now sit fully WITHIN its owner cell's bbox and intersect no
 * neighbour.
 *
 * This spec asserts the real-browser layout contract: for every badged cell,
 * the badge bbox is contained within the cell bbox (right edge ≈ cell right
 * edge, top edge ≈ cell top edge, no left/bottom overhang). jsdom has no
 * layout engine and cannot catch this — this Playwright test is the
 * load-bearing AC verification.
 *
 * Test strategy:
 *   - Stubs /api/silhouettes with 4 families (3 with svgData → rendered branch,
 *     1 without → fallback branch). Forces at least 3 rendered cells with count>1
 *     so multiple badges appear in one cluster.
 *   - Stubs /api/observations with enough co-located points that supercluster
 *     aggregation produces one cluster with ≥3 count>1 cells.
 *   - Flies to the cluster at zoom=14 where the grid marker is visible.
 *   - Asserts the badge bbox is inside its cell bbox (top-right anchored), with
 *     a small tolerance for the box-shadow ring / subpixel rounding.
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

test.describe('Badge anchor (badge bbox must sit inside its own cell, top-right)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test(
    'each cell badge bbox is contained within its own cell (top-right anchored, no neighbour overhang)',
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

      // For each badge, verify its bbox is contained within its own cell's bbox
      // (top-right anchored), not overhanging into a neighbour. The box-shadow
      // ring is NOT part of getBoundingClientRect, so the rects compare cleanly.
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
            badgeTop: bRect.top,
            badgeRight: bRect.right,
            badgeBottom: bRect.bottom,
            badgeLeft: bRect.left,
            cellTop: cRect.top,
            cellRight: cRect.right,
            cellBottom: cRect.bottom,
            cellLeft: cRect.left,
            // Top-right anchor deltas.
            deltaTop: Math.abs(bRect.top - cRect.top),
            deltaRight: Math.abs(bRect.right - cRect.right),
            // Overhang past the cell on the bottom / left edges (positive = overhang).
            bottomOverhang: bRect.bottom - cRect.bottom,
            leftOverhang: cRect.left - bRect.left,
            cellTestId: ancestor.getAttribute('data-testid') ?? '',
          };
        });
      });

      // Every badge must be top-right anchored INSIDE its cell, with no
      // bottom/left overhang into a neighbour. 2px tolerance absorbs subpixel
      // rounding and the box-shadow ring's optical (non-layout) bleed.
      const TOL = 2;
      for (const result of results) {
        if ('error' in result) {
          throw new Error(`Badge anchor check failed: ${result.error}`);
        }
        expect(
          result.deltaRight,
          `Badge right edge (${result.badgeRight.toFixed(0)}) must be within ${TOL}px of cell right edge (${result.cellRight.toFixed(0)}) — got delta ${result.deltaRight.toFixed(1)}px. Badge must anchor top-right INSIDE its cell.`,
        ).toBeLessThanOrEqual(TOL);
        expect(
          result.deltaTop,
          `Badge top edge (${result.badgeTop.toFixed(0)}) must be within ${TOL}px of cell top edge (${result.cellTop.toFixed(0)}) — got delta ${result.deltaTop.toFixed(1)}px. Badge must anchor top-right INSIDE its cell.`,
        ).toBeLessThanOrEqual(TOL);
        expect(
          result.bottomOverhang,
          `Badge must NOT overhang its cell's bottom edge (badge bottom ${result.badgeBottom.toFixed(0)} vs cell bottom ${result.cellBottom.toFixed(0)}) — that overhang crosses the 2px grid gap into the neighbouring cell (E6 #1058).`,
        ).toBeLessThanOrEqual(TOL);
        expect(
          result.leftOverhang,
          `Badge must NOT overhang its cell's left edge (badge left ${result.badgeLeft.toFixed(0)} vs cell left ${result.cellLeft.toFixed(0)}).`,
        ).toBeLessThanOrEqual(TOL);
      }
    },
  );
});
