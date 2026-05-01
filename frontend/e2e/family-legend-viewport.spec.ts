import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Issue #351 — viewport-aware FamilyLegend counts.
 *
 * The legend's per-family counts must reflect what's currently inside
 * `map.getBounds()`, not the entire loaded API window. Pan to Tucson and
 * Flagstaff-only families should drop to 0 (omitted from the legend per
 * the existing `count === 0 ⇒ skip` rule in buildEntries); pan to
 * Flagstaff and Tucson-only families should drop out instead.
 *
 * Drives via `window.__birdMap.flyTo` (set by MapCanvas's handleLoad
 * test hook in non-prod builds) — same pattern as map-stack-fanout.spec.ts.
 *
 * Fixture has three deterministic regions:
 *   - Tucson cluster: 10 obs, lat 32.20–32.30, families A and B.
 *   - Flagstaff cluster: 10 obs, lat 35.15–35.25, families B and C.
 *   - Statewide scatter: 5 obs spread across AZ, family D.
 *   - 25 obs total, 4 families. Family A is Tucson-only; family C is
 *     Flagstaff-only (disjoint, by lat partition).
 *
 * WebGL skip guard: matches map-stack-fanout / map-cluster-mosaic specs
 * — if the maplibre chunk doesn't paint (no GPU in headless), the
 * test bails cleanly rather than failing.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadObservationsFixture(): Promise<Observation[]> {
  const raw = await fs.readFile(
    path.join(__dirname, 'fixtures', 'observations-regional-clusters.json'),
    'utf8',
  );
  return JSON.parse(raw) as Observation[];
}

/**
 * Minimal silhouettes payload for the four families A/B/C/D plus the
 * required _FALLBACK row. svgData is a simple shape so MapCanvas's SDF
 * sprite registration succeeds (the charset check rejects only XML-
 * breaking chars).
 */
function silhouetteFixture() {
  const palette = [
    { code: 'famA', color: '#E84040', name: 'Family A' },
    { code: 'famB', color: '#F5A623', name: 'Family B' },
    { code: 'famC', color: '#5DA832', name: 'Family C' },
    { code: 'famD', color: '#8B5CF6', name: 'Family D' },
  ];
  const rows = palette.map(({ code, color, name }) => ({
    familyCode: code,
    color,
    svgData: 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
    source: null,
    license: null,
    commonName: name,
    creator: null,
  }));
  rows.push({
    familyCode: '_FALLBACK',
    color: '#555555',
    svgData: 'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
    source: null,
    license: null,
    commonName: 'Unknown family',
    creator: null,
  });
  return rows;
}

/**
 * Drive the maplibre map to a given center + zoom via the
 * `window.__birdMap` test hook (set by MapCanvas.tsx's handleLoad
 * callback in non-prod builds). Returns `true` when dispatched, `false`
 * when the hook is missing — caller's WebGL guard handles the missing
 * case.
 */
async function driveMapTo(
  page: import('@playwright/test').Page,
  lng: number,
  lat: number,
  zoom: number,
): Promise<boolean> {
  return page.evaluate(
    ([lng, lat, zoom]: [number, number, number]) => {
      try {
        const map = (
          window as { __birdMap?: { flyTo: (opts: object) => void } }
        ).__birdMap;
        if (!map || typeof map.flyTo !== 'function') return false;
        map.flyTo({ center: [lng, lat], zoom, duration: 0 });
        return true;
      } catch {
        return false;
      }
    },
    [lng, lat, zoom] as [number, number, number],
  );
}

/**
 * WebGL skip guard. The map-canvas wrapper always mounts (it's a plain
 * div), but maplibre only fires `load` and exposes `__birdMap` once the
 * GL context is live. Skip the test cleanly when the hook is absent.
 */
async function skipIfMapHookAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const present = await page
    .waitForFunction(
      () =>
        typeof (window as { __birdMap?: unknown }).__birdMap !== 'undefined',
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!present) {
    testRef.skip(
      true,
      'window.__birdMap not exposed — maplibre `load` did not fire ' +
        '(likely WebGL unavailable in headless run).',
    );
  }
  return !present;
}

/**
 * Get the count text for a family by its commonName. Returns null when
 * the entry isn't rendered (count === 0 omits the entry per FamilyLegend's
 * buildEntries). Reads from the per-entry count <span> whose aria-label
 * is "{N} observations in view" — the load-bearing string under #351.
 */
async function getFamilyEntryCount(
  page: import('@playwright/test').Page,
  commonName: string,
): Promise<number | null> {
  const entry = page
    .getByTestId('family-legend-entry')
    .filter({ hasText: commonName });
  const visible = await entry.isVisible().catch(() => false);
  if (!visible) return null;
  const countText = await entry.locator('.family-legend-entry-count').textContent();
  if (countText === null) return null;
  return parseInt(countText.trim(), 10);
}

async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('./fixtures.js').ApiStub,
  observations: Observation[],
) {
  // Order matters: stubEmpty installs catch-all handlers; the more-specific
  // observations + silhouettes routes are registered after so they win
  // (Playwright route order is LIFO).
  await apiStub.stubEmpty();
  await apiStub.stubObservations(observations);
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(silhouetteFixture()),
    });
  });
}

test.describe('FamilyLegend viewport-aware counts (desktop, #351)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('legend title reads "Bird families in view" when on map view', async ({
    page,
    apiStub,
  }) => {
    const observations = await loadObservationsFixture();
    await setupRoutes(page, apiStub, observations);

    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });

    // The label is the one user-visible signal that the count narrates
    // viewport state. Pin it irrespective of WebGL availability — this
    // assertion uses no map driving.
    await expect(
      page.getByRole('button', { name: /bird families in view/i }),
    ).toBeVisible();
  });

  test('panning to Tucson omits family C; panning to Flagstaff omits family A', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const observations = await loadObservationsFixture();
    await setupRoutes(page, apiStub, observations);

    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });

    if (await skipIfMapHookAbsent(page, test)) return;

    // ---------------------------------------------------------------
    // Initial state: full statewide view at zoom 6 (MapCanvas default).
    // All four families have observations; all four entries render.
    // ---------------------------------------------------------------
    // First wait for the legend to materialize at all. The fixture has
    // 25 observations across 4 families, so we expect 4 entries.
    await expect
      .poll(
        async () => (await page.getByTestId('family-legend-entry').count()),
        { timeout: 15_000 },
      )
      .toBe(4);

    // ---------------------------------------------------------------
    // Pan to Tucson at zoom 11 (~25–35km half-width). Family C is
    // Flagstaff-only (lat 35.15–35.25); at z11 around [-110.95, 32.25],
    // the bounds cannot enclose any 35°+ lat point. Family A is
    // Tucson-only — its count must remain > 0 and family C must drop
    // to 0 ⇒ omitted from the legend entirely.
    // ---------------------------------------------------------------
    await driveMapTo(page, -110.95, 32.25, 11);

    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family A'),
        { timeout: 10_000, message: 'Family A in Tucson view' },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family C'),
        { timeout: 10_000, message: 'Family C must omit in Tucson view' },
      )
      .toBeNull();

    // ---------------------------------------------------------------
    // Pan to Flagstaff at zoom 11. Now Family A (Tucson-only) drops
    // out and Family C (Flagstaff-only) appears.
    // ---------------------------------------------------------------
    await driveMapTo(page, -111.65, 35.20, 11);

    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family C'),
        { timeout: 10_000, message: 'Family C in Flagstaff view' },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family A'),
        { timeout: 10_000, message: 'Family A must omit in Flagstaff view' },
      )
      .toBeNull();
  });
});

test.describe('FamilyLegend viewport-aware counts (mobile, #351)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile legend defaults collapsed; expand → viewport counts visible', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    const observations = await loadObservationsFixture();
    await setupRoutes(page, apiStub, observations);

    // Clear the localStorage default so the responsive collapse-on-mobile
    // applies on first paint (matches the existing family-legend.spec.ts
    // pattern).
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('family-legend-expanded');
      } catch {
        /* noop */
      }
    });

    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });

    // Toggle defaults to collapsed at <760px viewport.
    const toggle = page.getByRole('button', {
      name: /bird families in view/i,
    });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    if (await skipIfMapHookAbsent(page, test)) return;

    // Pan to Tucson before expanding so the snap-to-viewport happens
    // off-screen and the user sees the post-pan state on first reveal.
    await driveMapTo(page, -110.95, 32.25, 11);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // After expanding: Family A (Tucson-only) must be present; Family C
    // (Flagstaff-only) must be omitted.
    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family A'),
        { timeout: 10_000, message: 'Family A in Tucson view (mobile)' },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () => await getFamilyEntryCount(page, 'Family C'),
        { timeout: 10_000, message: 'Family C must omit in Tucson view (mobile)' },
      )
      .toBeNull();
  });
});
