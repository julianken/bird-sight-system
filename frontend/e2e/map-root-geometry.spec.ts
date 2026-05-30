import { test, expect, STATES_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * #761 (S2) — full-viewport map ROOT geometry guards.
 *
 * The shell inverted: the map is no longer a windowed flex child of the padded
 * `<main>`. It was hoisted into `#map-layer` (`position: fixed; inset: 0`), a
 * SIBLING of `<main>`, and the AppHeader became `position: fixed` floating chrome
 * on `--z-chrome`. These guards encode the load-bearing geometry the inversion
 * promises and the R15 header-clearance fixes that keep the floating header from
 * occluding the top-anchored overlays.
 *
 * Steady-state contract: every geometry assertion is taken AFTER
 * `waitForAppReady()` settles. The map's corrective `map.resize()` on the
 * flex→fixed transition is S3's (#773); S2 asserts only the SETTLED box, never a
 * resize-causality claim.
 *
 * WebGL skip guard: where the canvas geometry depends on a live maplibre `load`
 * (no GPU in headless), the test skips cleanly — mirrors
 * family-legend-collapse-visibility.spec.ts. CI runs on GitHub Actions VMs with
 * software WebGL (SwiftShader), so CI exercises the full assertions.
 */

const AZ_OBS = [
  {
    subId: 'S1',
    speciesCode: 'vermfly',
    comName: 'Vermilion Flycatcher',
    lat: 32.22,
    lng: -110.97,
    obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    locId: 'L1',
    locName: 'Tucson',
    howMany: 1,
    isNotable: false,
    silhouetteId: 'tyrannidae',
    familyCode: 'tyrannidae',
  },
];

async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: { stubObservations: (o: typeof AZ_OBS) => Promise<void>; stubStates: (s?: typeof STATES_FIXTURE) => Promise<void>; stubZipIndex: () => Promise<void> },
): Promise<void> {
  await apiStub.stubObservations(AZ_OBS);
  await apiStub.stubStates();
  await apiStub.stubZipIndex();
}

test.describe('#761 (S2): full-viewport map root geometry', () => {
  test.describe('desktop (1440×900)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('.map-surface fills the viewport — no 16px gutters', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(app.mapCanvas).toBeVisible({ timeout: 15_000 });

      // Steady-state: `.map-surface` bounding rect ≈ the viewport (within 1px),
      // proving the map went full-bleed (no inset from the old `<main>` padding).
      const rect = await page.locator('.map-surface').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      expect(rect.left, 'left gutter').toBeLessThanOrEqual(1);
      expect(rect.top, 'top gutter (map sits under the floating header on purpose)').toBeLessThanOrEqual(1);
      expect(Math.abs(rect.right - 1440), 'right edge ≈ viewport width').toBeLessThanOrEqual(1);
      expect(Math.abs(rect.bottom - 900), 'bottom edge ≈ viewport height').toBeLessThanOrEqual(1);
    });

    test('.scope-control anchors to the viewport top, clearing the fixed header', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(app.scopeControl).toBeVisible();

      // The ScopeControl is a SIBLING of `.map-surface`; its `position: absolute`
      // offsets must resolve against the fixed `#map-layer` wrapper (≡ viewport).
      // Expected top = header height + --space-md (it clears the floating header),
      // and it is horizontally centered (margin-inline: auto) within the viewport.
      const m = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const headerH = parseFloat(root.getPropertyValue('--header-height'));
        const spaceMd = parseFloat(root.getPropertyValue('--space-md'));
        const sc = document.querySelector<HTMLElement>('.scope-control');
        const header = document.querySelector<HTMLElement>('.app-header');
        if (!sc || !header) return null;
        const r = sc.getBoundingClientRect();
        const hr = header.getBoundingClientRect();
        return {
          top: r.top,
          left: r.left,
          right: r.right,
          headerBottom: hr.bottom,
          expectedTop: headerH + spaceMd,
          viewportWidth: window.innerWidth,
        };
      });
      expect(m, '.scope-control / .app-header not found').not.toBeNull();
      // Anchored at header-height + --space-md from the viewport TOP (not under the header).
      expect(Math.abs(m!.top - m!.expectedTop), `scope-control top ${m!.top} ≈ ${m!.expectedTop}`).toBeLessThanOrEqual(2);
      // It clears the fixed header (its top is at or below the header's bottom edge).
      expect(m!.top, 'scope-control top clears the header bottom').toBeGreaterThanOrEqual(m!.headerBottom - 1);
      // Centered within the viewport width (margin-inline: auto): symmetric side gaps.
      const leftGap = m!.left;
      const rightGap = m!.viewportWidth - m!.right;
      expect(Math.abs(leftGap - rightGap), `centered: left gap ${leftGap.toFixed(1)} ≈ right gap ${rightGap.toFixed(1)}`).toBeLessThanOrEqual(2);
    });

    test('open filters panel clears the fixed header (close button visible)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await app.openFilters();

      const m = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.filters-panel');
        const close = document.querySelector<HTMLElement>('.filters-panel-close');
        const header = document.querySelector<HTMLElement>('.app-header');
        if (!panel || !close || !header) return null;
        return {
          panelTop: panel.getBoundingClientRect().top,
          closeTop: close.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
        };
      });
      expect(m, '.filters-panel / close / header not found').not.toBeNull();
      // R15 surface 2: the panel top edge and its close button clear the header.
      expect(m!.panelTop, 'panel top below header bottom').toBeGreaterThanOrEqual(m!.headerBottom - 1);
      expect(m!.closeTop, 'close button below header bottom').toBeGreaterThanOrEqual(m!.headerBottom - 1);
    });
  });

  test.describe('mobile (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('open filters panel clears the fixed header (close button visible)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await app.openFilters();

      const m = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.filters-panel');
        const close = document.querySelector<HTMLElement>('.filters-panel-close');
        const header = document.querySelector<HTMLElement>('.app-header');
        if (!panel || !close || !header) return null;
        return {
          panelTop: panel.getBoundingClientRect().top,
          closeTop: close.getBoundingClientRect().top,
          headerBottom: header.getBoundingClientRect().bottom,
        };
      });
      expect(m, '.filters-panel / close / header not found').not.toBeNull();
      expect(m!.panelTop, 'panel top below header bottom').toBeGreaterThanOrEqual(m!.headerBottom - 1);
      expect(m!.closeTop, 'close button below header bottom').toBeGreaterThanOrEqual(m!.headerBottom - 1);
    });
  });

  test.describe('always-mounted-under-scrim invariant (unscoped landing)', () => {
    test('#map-layer mounts idle on the unscoped scrim landing, zero /api/observations', async ({ page, apiStub }) => {
      const obsRequests: string[] = [];
      page.on('request', req => {
        if (req.url().includes('/api/observations')) obsRequests.push(req.url());
      });
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);

      // Bare URL → chooser scrim over a mounted, idle map (no default-scope injection).
      await app.gotoRaw('');
      await expect(app.chooser).toBeVisible();

      // The hoisted #map-layer is present in the DOM (map mounted, not unmounted)…
      await expect(page.locator('#map-layer')).toBeAttached();
      // …and it is NOT gated away by scopeActive — the map canvas is mounted idle.
      await expect(app.mapCanvas).toBeAttached();

      // The scopeActive fetch gate holds /api/observations at zero on the landing.
      await page.waitForTimeout(600);
      expect(obsRequests, 'zero /api/observations on the unscoped scrim landing').toHaveLength(0);
    });
  });
});
