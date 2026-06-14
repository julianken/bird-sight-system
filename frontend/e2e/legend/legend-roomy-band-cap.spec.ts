import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * #853 — family legend occludes the framed state on the 481–1023px 'roomy' band.
 *
 * What already ships (do NOT re-implement here):
 *   - #809: collapse-by-default below 1024px (App.tsx LEGEND_EXPAND_MIN_WIDTH).
 *   - #810: ≤480px width/height cap (styles.css @media max-width:480px).
 *
 * The surviving bug this spec guards: on the 481–1023px band a user with a
 * stored `family-legend-expanded.v3.roomy=true` preference (E3 #1055 re-keyed
 * the per-breakpoint pref; pre-#1055 this was the breakpoint-blind `.v2`)
 * sees the legend render expanded — and because the ≤480px cap
 * media query does NOT apply above 480px, `.family-legend-entries` falls back to
 * the desktop `max-height: 400px`. The resulting ~440px-tall panel anchored at
 * the bottom-left occludes the lower-left of the framed state.
 *
 * The fix bounds the entries panel on the 481–1023px band to a shorter,
 * scrollable max-height so a stored-expanded legend does not reach into the
 * framed state's central content. ≥1024px desktop and ≤480px behaviour are
 * unchanged (covered by family-legend-viewport.spec.ts and
 * legend-o5-cap-force-collapse.spec.ts respectively).
 *
 * Repo e2e conventions: page.goto() via the POM; data cases wait for
 * [data-render-complete]; no DB writes; no per-spec retries.
 */

/** Minimal silhouette fixture — one real family + the required _FALLBACK row. */
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
      subId: 'S-853-TEST-1',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      familyCode: 'tyrannidae',
      lat: 32.2217,
      lng: -110.9265,
      locId: 'L999853',
      locName: 'Tucson, AZ',
      obsDt: '2026-05-30T12:00:00Z',
      howMany: 1,
      isNotable: false,
      silhouetteId: null,
    },
  ];
}

async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('../fixtures.js').ApiStub,
): Promise<void> {
  // LIFO route order: catch-all first, then the specific handlers win.
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

// ─── 500×844 — the issue's primary repro viewport ────────────────────────────
test.describe('#853 — legend cap on the roomy band (500×844, stored-expanded)', () => {
  test.use({ viewport: { width: 500, height: 844 } });

  test('stored-expanded legend entries are capped well below the desktop 400px', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    // Simulate the bug-reporting user: expanded on a prior (desktop) session, so
    // the stored roomy-tier preference overrides the <1024px collapse-default
    // (#809). 500px maps to the 'roomy' tier (E3 #1055 per-breakpoint keys).
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v3.roomy', 'true');
      } catch {
        /* noop */
      }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // The stored preference still wins on the roomy band (we do NOT collapse it).
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const entries = page.locator('.family-legend-entries');
    await expect(entries).toBeVisible();

    // The entries panel must be capped on the 481–1023px band. The desktop
    // fallback is 400px; the fix bounds it to a shorter scrollable height so the
    // stored-expanded legend does not occlude the framed state's centre.
    const maxHeightPx = await entries.evaluate(
      (el) => parseFloat(getComputedStyle(el).maxHeight),
    );
    expect(
      maxHeightPx,
      `.family-legend-entries max-height ${maxHeightPx}px must be < the desktop 400px fallback on the 481–1023px band`,
    ).toBeLessThan(400);

    // The bounded legend's top edge must clear the vertical centre of the
    // viewport so the framed state's central content is not occluded.
    const legendEl = page.locator('.family-legend');
    const box = await legendEl.boundingBox();
    expect(box, 'legend element not found in DOM').not.toBeNull();
    const viewportCentreY = 844 / 2;
    expect(
      box!.y,
      `legend top edge ${box!.y.toFixed(1)}px must sit below the viewport centre (${viewportCentreY}px) so the framed state is not occluded`,
    ).toBeGreaterThan(viewportCentreY);

    // Sanity: the cap is a CSS display bound only — the stored preference is
    // not mutated (#809/#810 invariant carried forward).
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('family-legend-expanded.v3.roomy'),
    );
    expect(stored).toBe('true');
  });

  test('the legend toggle still collapses/expands on the roomy band', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v3.roomy', 'true');
      } catch {
        /* noop */
      }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.family-legend-entries')).not.toBeVisible();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.family-legend-entries')).toBeVisible();
  });
});

// ─── 768×1024 — tablet portrait, the issue's second repro viewport ───────────
test.describe('#853 — legend cap on the roomy band (768×1024, stored-expanded)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('stored-expanded legend entries are capped below 400px at tablet portrait', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('family-legend-expanded.v3.roomy', 'true');
      } catch {
        /* noop */
      }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const entries = page.locator('.family-legend-entries');
    await expect(entries).toBeVisible();
    const maxHeightPx = await entries.evaluate(
      (el) => parseFloat(getComputedStyle(el).maxHeight),
    );
    expect(
      maxHeightPx,
      `.family-legend-entries max-height ${maxHeightPx}px must be < 400px on the 481–1023px band`,
    ).toBeLessThan(400);
  });
});

// ─── ≥1024px desktop counter-case: the cap must NOT apply ────────────────────
test.describe('#853 counter-case — desktop ≥1024px keeps the 400px fallback', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('expanded legend at 1440×900 retains the desktop 400px entries max-height', async ({
    page,
    apiStub,
  }) => {
    await setupRoutes(page, apiStub);
    await page.addInitScript(() => {
      try {
        // E3 (#1055): 1440px → the 'wide' tier key.
        window.localStorage.setItem('family-legend-expanded.v3.wide', 'true');
      } catch {
        /* noop */
      }
    });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const toggle = page.getByRole('button', { name: /bird families in view/i });
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    const entries = page.locator('.family-legend-entries');
    await expect(entries).toBeVisible();
    const maxHeightPx = await entries.evaluate(
      (el) => parseFloat(getComputedStyle(el).maxHeight),
    );
    // Desktop is unchanged: the 400px fallback still applies above the band.
    expect(
      maxHeightPx,
      `desktop .family-legend-entries max-height ${maxHeightPx}px must stay at the 400px fallback`,
    ).toBe(400);
  });
});
