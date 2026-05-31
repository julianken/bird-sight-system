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

/**
 * Silhouettes stub for the attribution-clearance guard. The FamilyLegend only
 * mounts when `silhouettes.length > 0` (FamilyLegend.tsx), so the legend-vs-
 * attribution overlap test must register a non-empty silhouettes payload — the
 * `tyrannidae` row matches AZ_OBS's `familyCode`, plus the required `_FALLBACK`
 * row. Registered AFTER setupRoutes so this more-specific route wins (LIFO).
 */
async function stubSilhouettesForLegend(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          familyCode: 'tyrannidae',
          color: '#E84040',
          colorDark: '#E84040',
          svgData:
            'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',
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
          source: null,
          license: null,
          commonName: 'Unknown family',
          creator: null,
        },
      ]),
    });
  });
}

/**
 * WebGL skip guard for the attribution-clearance guard. The MapLibre
 * AttributionControl only attaches its DOM (`.maplibregl-ctrl-attrib`) after the
 * map fires `load`; headless runs without a GPU never fire it, so the
 * bounding-box overlap check would be vacuous. Skip cleanly — mirrors the
 * `__birdMap` guard in family-legend-viewport.spec.ts. CI runs software WebGL
 * (SwiftShader), so CI exercises the full assertion.
 */
async function skipIfAttributionAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const present = await page
    .locator('.maplibregl-ctrl-attrib')
    .waitFor({ state: 'attached', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!present) {
    testRef.skip(
      true,
      '.maplibregl-ctrl-attrib not attached — maplibre `load` did not fire ' +
        '(likely WebGL unavailable in headless run).',
    );
  }
  return !present;
}

/**
 * Read the attribution control + family legend bounding boxes and the size of
 * their intersection. Returns null if either element is missing.
 */
async function measureAttributionVsLegend(
  page: import('@playwright/test').Page,
): Promise<{
  attrib: { left: number; top: number; right: number; bottom: number };
  legend: { left: number; top: number; right: number; bottom: number };
  intersectX: number;
  intersectY: number;
} | null> {
  return page.evaluate(() => {
    const attrib = document.querySelector('.maplibregl-ctrl-attrib');
    const legend = document.querySelector('.family-legend');
    if (!attrib || !legend) return null;
    const a = attrib.getBoundingClientRect();
    const l = legend.getBoundingClientRect();
    const intersectX = Math.max(
      0,
      Math.min(a.right, l.right) - Math.max(a.left, l.left),
    );
    const intersectY = Math.max(
      0,
      Math.min(a.bottom, l.bottom) - Math.max(a.top, l.top),
    );
    return {
      attrib: { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
      legend: { left: l.left, top: l.top, right: l.right, bottom: l.bottom },
      intersectX,
      intersectY,
    };
  });
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

    test('.scope-control is embedded in the identity card, clear of the top edge (#800)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(app.scopeControl).toBeVisible();

      // #800: ScopeControl is now embedded inside the AppHeader identity card
      // (top-left corner card) rather than a standalone floating overlay.
      // The identity card is anchored at --card-inset (12px) from the top-left.
      // The scope-control section sits BELOW the wordmark + region + lede rows
      // inside the card, so its top must be > 12px (the card inset) and < the
      // viewport height (it's in the top-left corner, not full-screen).
      const m = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const cardInset = parseFloat(root.getPropertyValue('--card-inset')) || 12;
        const sc = document.querySelector<HTMLElement>('.scope-control');
        const card = document.querySelector<HTMLElement>('.app-header-identity-card');
        if (!sc || !card) return null;
        const r = sc.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        return {
          top: r.top,
          cardTop: cr.top,
          cardInset,
          viewportHeight: window.innerHeight,
        };
      });
      expect(m, '.scope-control / .app-header-identity-card not found').not.toBeNull();
      // The scope-control is inside the identity card, so its top >= the card's top.
      expect(m!.top, 'scope-control top is below identity card top').toBeGreaterThanOrEqual(m!.cardTop - 1);
      // The identity card top is at --card-inset from the viewport top.
      expect(m!.cardTop, 'identity card top ≈ --card-inset from viewport').toBeLessThanOrEqual(m!.cardInset + 2);
      // The scope-control top is well above the viewport midpoint (it's a top card).
      expect(m!.top, 'scope-control top is in the top half of the viewport').toBeLessThan(m!.viewportHeight / 2);
    });

    test('open filters panel clears the controls pill (close button visible) (#800)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await app.openFilters();

      // #800: the header is now a transparent wrapper (inset:0); clearance is
      // measured against the controls pill (top-right card) bottom edge instead.
      const m = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.filters-panel');
        const close = document.querySelector<HTMLElement>('.filters-panel-close');
        const pill = document.querySelector<HTMLElement>('.app-header-controls-pill');
        if (!panel || !close || !pill) return null;
        return {
          panelTop: panel.getBoundingClientRect().top,
          closeTop: close.getBoundingClientRect().top,
          pillBottom: pill.getBoundingClientRect().bottom,
        };
      });
      expect(m, '.filters-panel / close / controls-pill not found').not.toBeNull();
      // R15 surface 2 (#800 update): the panel top and close button must be below
      // the controls pill so they are not obscured by the top-right corner card.
      expect(m!.panelTop, 'panel top below controls pill bottom').toBeGreaterThanOrEqual(m!.pillBottom - 1);
      expect(m!.closeTop, 'close button below controls pill bottom').toBeGreaterThanOrEqual(m!.pillBottom - 1);
    });
  });

  test.describe('mobile (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('open filters panel clears the controls pill (close button visible) (#800)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await app.openFilters();

      const m = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.filters-panel');
        const close = document.querySelector<HTMLElement>('.filters-panel-close');
        const pill = document.querySelector<HTMLElement>('.app-header-controls-pill');
        if (!panel || !close || !pill) return null;
        return {
          panelTop: panel.getBoundingClientRect().top,
          closeTop: close.getBoundingClientRect().top,
          pillBottom: pill.getBoundingClientRect().bottom,
        };
      });
      expect(m, '.filters-panel / close / controls-pill not found').not.toBeNull();
      expect(m!.panelTop, 'panel top below controls pill bottom').toBeGreaterThanOrEqual(m!.pillBottom - 1);
      expect(m!.closeTop, 'close button below controls pill bottom').toBeGreaterThanOrEqual(m!.pillBottom - 1);
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

  // ───────────────────────────────────────────────────────────────────────────
  // #775 — basemap attribution clearance under the full-bleed map.
  //
  // The full-viewport map (#761 S2) made `.map-surface` fill 100vh. MapLibre's
  // non-compact AttributionControl (`compact={false}` — deliberately always-
  // expanded so the OSM credit shows without a click) then renders as a bottom
  // bar that, on short/narrow viewports, spans the full viewport width and wraps
  // to multiple lines — its left portion reaching into the bottom-left corner
  // where `.family-legend` lives. The legend (z-overlay) painted ON TOP of the
  // OSM / OpenFreeMap license text. That is an ODbL + eBird-ToU LICENSING defect
  // (the attribution must be fully visible), and it shipped with no test.
  //
  // Fix (#775): `.family-legend { bottom: calc(var(--space-md) +
  // var(--attribution-clearance)) }`, with --attribution-clearance tiered by
  // viewport (20/40/60px) to lift the legend ABOVE the worst-case band. These
  // guards assert ZERO overlap between the two boxes at 390/768/1024 in BOTH the
  // collapsed and expanded legend states (the expanded legend is wider, so it is
  // the harder case at 1024 where the bar already reaches x≈192).
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('#775: basemap attribution clearance vs family legend', () => {
    for (const vp of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
    ] as const) {
      test.describe(`${vp.width}×${vp.height}`, () => {
        test.use({ viewport: { width: vp.width, height: vp.height } });

        test('attribution control is not overlapped by the family legend (collapsed + expanded)', async ({
          page,
          apiStub,
        }) => {
          await setupRoutes(page, apiStub);
          await stubSilhouettesForLegend(page);
          // Start from a known legend state regardless of prior persistence.
          await page.addInitScript(() => {
            try {
              window.localStorage.removeItem('family-legend-expanded');
              window.localStorage.removeItem('family-legend-expanded.v2');
            } catch {
              /* noop */
            }
          });

          const app = new AppPage(page);
          await app.goto('state=US-AZ');
          await app.waitForAppReady();
          await expect(app.mapCanvas).toBeVisible({ timeout: 15_000 });

          if (await skipIfAttributionAbsent(page, test)) return;
          // The legend mounts once silhouettes resolve.
          await expect(page.locator('.family-legend')).toBeVisible({
            timeout: 10_000,
          });

          const toggle = page.locator('.family-legend [aria-expanded]');

          // Assert no overlap in BOTH legend states. The expanded legend is the
          // wider box (the 1024 worst case), the collapsed legend the typical
          // first-paint mobile state — both must clear the attribution band.
          for (const wantExpanded of [false, true] as const) {
            const current = await toggle.getAttribute('aria-expanded');
            if (current !== String(wantExpanded)) {
              await toggle.click();
              await expect(toggle).toHaveAttribute(
                'aria-expanded',
                String(wantExpanded),
              );
            }

            const m = await measureAttributionVsLegend(page);
            expect(
              m,
              '.maplibregl-ctrl-attrib / .family-legend not found',
            ).not.toBeNull();

            // Boxes are disjoint when EITHER axis has no intersection. The
            // licensing requirement is that the legend never covers the
            // attribution text, so we require zero overlap area (sub-pixel
            // tolerance for fractional rounding).
            const disjoint =
              m!.intersectX <= 0.5 || m!.intersectY <= 0.5;
            expect(
              disjoint,
              `legend (expanded=${wantExpanded}) overlaps attribution at ${vp.width}×${vp.height}: ` +
                `intersect ${m!.intersectX.toFixed(1)}×${m!.intersectY.toFixed(1)}px ` +
                `[attrib ${JSON.stringify(m!.attrib)} legend ${JSON.stringify(m!.legend)}]`,
            ).toBe(true);

            // Stronger, fix-specific assertion: the legend's bottom edge sits at
            // or ABOVE the attribution band's top edge — i.e. the legend is
            // lifted clear vertically, independent of the bar's horizontal span.
            expect(
              m!.legend.bottom,
              `legend bottom (${m!.legend.bottom.toFixed(1)}) must clear attribution top ` +
                `(${m!.attrib.top.toFixed(1)}) at ${vp.width}×${vp.height} (expanded=${wantExpanded})`,
            ).toBeLessThanOrEqual(m!.attrib.top + 0.5);
          }
        });
      });
    }
  });
});
