import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * O5 (#783) — FamilyLegend mobile width cap (R6) + force-collapsed behaviour.
 *
 * Covers:
 *   - Width cap: at 390px the legend renders ≤280px regardless of expanded state
 *   - force-collapsed: data-force-collapsed="true" when another overlay holds
 *     focus on mobile (detail sheet at half/full; filters sheet)
 *   - Counter-case: iPad landscape (1024×768) does NOT force-collapse
 *   - Stored expanded preference is NOT mutated by force-collapse
 *
 * Repo e2e conventions:
 *   - Every test starts with page.goto() via the POM
 *   - data cases wait for main[data-render-complete]
 *   - No DB writes (no POST/PATCH/DELETE routes)
 *   - No per-spec retries (retries: 0 globally)
 */

/** Minimal silhouette fixture — one real family + _FALLBACK row. */
function stubSilhouettesFixture() {
  return [
    {
      familyCode: 'tyrannidae',
      color: '#E84040',
      colorDark: '#E84040',
      svgData:
        'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
      svgUrl: null,
      source: null,
      license: null,
      commonName: 'Tyrant Flycatchers',
      creator: null,
    },
    {
      familyCode: '_FALLBACK',
      color: '#555555',
      colorDark: '#555555',
      svgData:
        'M 6 12 C 6 9 8 7 11 7 C 13 7 14 8 15 9 L 18 8 L 18 10 L 16 11 L 16 14 L 14 16 L 9 16 L 6 14 Z',
      svgUrl: null,
      source: null,
      license: null,
      commonName: 'Unknown family',
      creator: null,
    },
  ];
}

/** One observation matching the stubbed family so FamilyLegend renders non-null. */
function stubObservationsFixture(): Observation[] {
  return [
    {
      subId: 'S-O5-TEST-1',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      familyCode: 'tyrannidae',
      lat: 32.2217,
      lng: -110.9265,
      locId: 'L999001',
      locName: 'Tucson, AZ',
      obsDt: '2026-05-30T12:00:00Z',
      howMany: 1,
      isNotable: false,
      silhouetteId: null,
    },
  ];
}

/**
 * Register LIFO-safe API stubs: stubEmpty first (catch-all), then the more-
 * specific observations + silhouettes handlers win (LIFO).
 */
async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('./fixtures.js').ApiStub,
): Promise<void> {
  await apiStub.stubEmpty();
  await apiStub.stubObservations(stubObservationsFixture());
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stubSilhouettesFixture()),
    });
  });
}

// ─── R6 width cap at 390px ────────────────────────────────────────────────────

test.describe('R6 — legend width cap at 390px (O5 #783)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('collapsed legend at 390px is ≤280px wide', async ({ page, apiStub }) => {
    await setupRoutes(page, apiStub);
    // Start collapsed (clear localStorage so responsive default applies)
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem('family-legend-expanded');
        window.localStorage.removeItem('family-legend-expanded.v2');
      } catch { /* noop */ }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // Wait for the legend toggle to appear
    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    // Read the legend element's bounding width
    const legendEl = page.locator('.family-legend');
    const box = await legendEl.boundingBox();
    expect(box, 'legend element not found in DOM').not.toBeNull();
    // AC: width ≤ 280px (down from ~366px in the old 760px-breakpoint rule)
    expect(
      box!.width,
      `Legend width ${box!.width.toFixed(1)}px > 280px at 390px viewport`,
    ).toBeLessThanOrEqual(280);
  });

  test('expanded legend at 390px is ≤280px wide (cold-expanded user)', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    // Simulate a user who expanded the legend on a prior desktop session:
    // localStorage says expanded=true. At 390px the cap must still hold.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v2', 'true');
      } catch { /* noop */ }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // Legend renders expanded (stored preference)
    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Width cap must hold even while expanded
    const legendEl = page.locator('.family-legend');
    const box = await legendEl.boundingBox();
    expect(box, 'legend element not found in DOM').not.toBeNull();
    expect(
      box!.width,
      `Expanded legend width ${box!.width.toFixed(1)}px > 280px at 390px viewport (cold-expanded user)`,
    ).toBeLessThanOrEqual(280);

    // Verify the stored preference was NOT mutated (the cap is CSS-only)
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('family-legend-expanded.v2'),
    );
    expect(stored).toBe('true');
  });
});

// ─── force-collapsed: detail sheet at half/full on mobile ─────────────────────

test.describe('force-collapsed — detail sheet at half/full (O5 #783)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('legend is data-force-collapsed whenever the detail sheet is open on mobile', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    // Expanded legend in localStorage so it would show entries without force-collapse
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v2', 'true');
      } catch { /* noop */ }
    });
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    // The field-guide sheet opens at half — already past the overlay band.
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');

    // #907: App.tsx now force-collapses the legend whenever a detail sheet is
    // open AT ALL (the `!!state.detail` signal) — the small sheet preserves the
    // map and the legend would otherwise bury it. So the legend is force-
    // collapsed at the open (half) detent.
    await expect(page.locator('.family-legend')).toHaveAttribute(
      'data-force-collapsed',
      'true',
    );
    // Entries must not render while force-collapsed
    await expect(page.locator('.family-legend-entries')).not.toBeVisible();

    // Dragging down to the peek (identity-row) detent keeps it force-collapsed:
    // the sheet is still open (state.detail set), so the `!!state.detail` signal
    // holds even though peek itself is below the half/full overlay band.
    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const hb = await handle.boundingBox();
    const sb = await sheet.boundingBox();
    if (!hb || !sb) throw new Error('handle/sheet bounding box unavailable');
    const cx = hb.x + hb.width / 2;
    const cy = hb.y + hb.height / 2;
    // Drag down by ~ (half height − peek) so it settles at peek, not dismiss.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + (sb.height - 140), { steps: 20 });
    await page.mouse.up();
    await expect(sheet).toHaveAttribute('data-snap-state', 'peek');
    await expect(page.locator('.family-legend')).toHaveAttribute(
      'data-force-collapsed',
      'true',
    );

    // The stored preference must be intact (not mutated to false)
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('family-legend-expanded.v2'),
    );
    expect(stored).toBe('true');
  });

});

// ─── force-collapsed counter-case: 1024×768 (iPad landscape) ─────────────────

test.describe('force-collapsed counter-case — iPad landscape 1024×768 (O5 #783)', () => {
  // Must be in its own describe block to use test.use at the file scope level
  test.use({ viewport: { width: 1024, height: 768 } });

  test('legend is NOT force-collapsed at 1024×768 when sheet advances to half snap', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v2', 'true');
      } catch { /* noop */ }
    });
    const app = new AppPage(page);
    // At 1024px isCompact=true so the sheet renders (not the rail)
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    // The sheet opens at half snap (field-guide default).
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');

    // At 1024px (>480px, isPhone=false) the legend must NOT be force-collapsed
    // even though the sheet is open at half snap — locks in the ≤480px scope.
    // (The #907 `!!state.detail` force-collapse is also gated on isPhone, so it
    // does not fire here.)
    const legendEl = page.locator('.family-legend');
    const hasForceCollapsed = await legendEl.getAttribute('data-force-collapsed');
    expect(
      hasForceCollapsed,
      'Legend must NOT be force-collapsed at 1024×768 — isPhone is false above 480px',
    ).not.toBe('true');
  });
});

// ─── force-collapsed: filters sheet open on mobile ───────────────────────────

test.describe('force-collapsed — filters sheet open (O5 #783)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('legend is force-collapsed when filters panel is open on mobile', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v2', 'true');
      } catch { /* noop */ }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // Wait for legend to appear
    const legendEl = page.locator('.family-legend');
    await expect(legendEl).toBeVisible({ timeout: 10_000 });

    // Before opening filters: NOT force-collapsed
    await expect(legendEl).not.toHaveAttribute('data-force-collapsed', 'true');

    // Open the filters panel
    await app.filtersTrigger.click();
    await expect(page.locator('.filters-panel')).toBeVisible({ timeout: 5_000 });

    // Legend must be force-collapsed while filters are open on mobile
    await expect(legendEl).toHaveAttribute('data-force-collapsed', 'true');

    // Close filters — force-collapse lifts
    const closeBtn = page.locator('.filters-panel-close');
    await closeBtn.click();
    await expect(page.locator('.filters-panel')).not.toBeVisible();
    await expect(legendEl).not.toHaveAttribute('data-force-collapsed', 'true');
  });
});
