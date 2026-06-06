import { test, expect, STATES_FIXTURE, VERMFLY } from './fixtures.js';
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
 * Silhouettes stub for the peek-clearance guard. The FamilyLegend only mounts
 * when `silhouettes.length > 0` (FamilyLegend.tsx), so the legend-vs-sheet
 * overlap test must register a non-empty silhouettes payload — the `tyrannidae`
 * row matches AZ_OBS's `familyCode`, plus the required `_FALLBACK` row.
 * Registered AFTER setupRoutes so this more-specific route wins (LIFO).
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
 * Read the family-legend + species-detail-sheet bounding boxes and the size of
 * their vertical intersection. Returns null if either element is missing.
 * #830: replaces the old legend-vs-attribution measurement — the attribution
 * bar was removed, so the only remaining bottom-left collision risk is the
 * peek-snap detail sheet.
 */
async function measureLegendVsSheet(
  page: import('@playwright/test').Page,
): Promise<{
  sheet: { left: number; top: number; right: number; bottom: number };
  legend: { left: number; top: number; right: number; bottom: number };
  intersectY: number;
} | null> {
  return page.evaluate(() => {
    const sheet = document.querySelector('.species-detail-sheet');
    const legend = document.querySelector('.family-legend');
    if (!sheet || !legend) return null;
    const s = sheet.getBoundingClientRect();
    const l = legend.getBoundingClientRect();
    const intersectY = Math.max(
      0,
      Math.min(s.bottom, l.bottom) - Math.max(s.top, l.top),
    );
    return {
      sheet: { left: s.left, top: s.top, right: s.right, bottom: s.bottom },
      legend: { left: l.left, top: l.top, right: l.right, bottom: l.bottom },
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

    test('.scope-control is embedded in the identity card, clear of the top edge (#800 / #828)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      // #828: the scope form is collapsed behind the 🔍 disclosure — open it so
      // .scope-control is rendered (not display:none) and has a measurable rect.
      await app.openScopeDisclosure();
      await expect(app.scopeControl).toBeVisible();

      // #800: ScopeControl is now embedded inside the AppHeader identity card
      // (top-left corner card) rather than a standalone floating overlay.
      // The identity card is anchored at --card-inset (12px) from the top-left.
      // The scope-control section sits BELOW the wordmark + region + lede rows
      // inside the card, so its top must be > 12px (the card inset) and < the
      // viewport height (it's in the top-left corner, not full-screen).
      const m = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        // Read both --card-inset (12px) and --card-inset-wide (24px). At ≥1440px
        // the CSS switches the identity card to --card-inset-wide; we take the
        // max so the assertion holds regardless of viewport width.
        const cardInset = parseFloat(root.getPropertyValue('--card-inset')) || 12;
        const cardInsetWide = parseFloat(root.getPropertyValue('--card-inset-wide')) || 24;
        const effectiveInset = Math.max(cardInset, cardInsetWide);
        const sc = document.querySelector<HTMLElement>('.scope-control');
        const card = document.querySelector<HTMLElement>('.app-header-identity-card');
        if (!sc || !card) return null;
        const r = sc.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        return {
          top: r.top,
          cardTop: cr.top,
          cardInset: effectiveInset,
          viewportHeight: window.innerHeight,
        };
      });
      expect(m, '.scope-control / .app-header-identity-card not found').not.toBeNull();
      // The scope-control is inside the identity card, so its top >= the card's top.
      expect(m!.top, 'scope-control top is below identity card top').toBeGreaterThanOrEqual(m!.cardTop - 1);
      // The identity card top is at --card-inset (or --card-inset-wide at ≥1440px) from the viewport top.
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

    // ── Compact header geometry guard (#800 compact fix) ─────────────────────
    // At 390×844 the identity card (top-left) and controls pill (top-right)
    // must NOT overlap. Before the fix, the card's max-inline-size of 360px
    // extended past the pill's left edge (~214px), causing a ~160px overlap.
    // The fix caps the card to `calc(100% − card-inset − 180px − card-gap)`
    // which constrains its right edge to be left of the pill's left edge.
    // We assert bounding-box disjoint on the horizontal axis (intersectX = 0),
    // matching the legend/attribution guard pattern above.
    test('identity card and controls pill do NOT overlap at compact 390px (#800)', async ({ page, apiStub }) => {
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();

      const m = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.app-header-identity-card');
        const pill = document.querySelector<HTMLElement>('.app-header-controls-pill');
        if (!card || !pill) return null;
        const c = card.getBoundingClientRect();
        const p = pill.getBoundingClientRect();
        // Horizontal intersection: positive value means they overlap.
        const intersectX = Math.max(0, Math.min(c.right, p.right) - Math.max(c.left, p.left));
        // Vertical intersection: positive value means they overlap.
        const intersectY = Math.max(0, Math.min(c.bottom, p.bottom) - Math.max(c.top, p.top));
        return {
          card: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
          pill: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
          intersectX,
          intersectY,
        };
      });
      expect(m, '.app-header-identity-card / .app-header-controls-pill not found').not.toBeNull();
      // The two elements are horizontally disjoint: the card's right edge must be
      // to the left of the pill's left edge (sub-pixel tolerance for rounding).
      expect(
        m!.intersectX,
        `identity card (right=${m!.card.right.toFixed(1)}) overlaps controls pill ` +
          `(left=${m!.pill.left.toFixed(1)}) by ${m!.intersectX.toFixed(1)}px at 390×844 — ` +
          `compact layout regression`,
      ).toBeLessThanOrEqual(0.5);
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
  // #830 / #907 — peek-snap detail sheet clearance vs the family legend.
  //
  // The bottom-right MapLibre attribution bar was removed (#830 item A), so the
  // old legend-vs-attribution guard is gone. The remaining bottom-left collision
  // risk is the species-detail bottom sheet at its PEEK (identity-row) snap on
  // phones. #907 made the sheet open at HALF and force-collapse the legend
  // whenever a detail sheet is open at all (App.tsx `!!state.detail`), so the
  // legend is force-collapsed (header-pill height) at every detent including
  // peek. The `body:has(.species-detail-sheet--peek) .family-legend` clearance
  // rule still lifts it clear of the peek band. This guard drags the sheet down
  // to peek and asserts the legend's bottom edge sits at or ABOVE the peek
  // sheet's top edge at 390×844 (the AC viewport) — no overlap.
  // ───────────────────────────────────────────────────────────────────────────
  test.describe('#830: peek-snap detail sheet clearance vs family legend', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('family legend clears the peek detail sheet at 390×844 (no overlap)', async ({
      page,
      apiStub,
    }) => {
      await setupRoutes(page, apiStub);
      await stubSilhouettesForLegend(page);
      await apiStub.stubSpecies('vermfly', VERMFLY);
      // Start from a known (expanded) legend preference regardless of prior
      // persistence. The detail sheet force-collapses it anyway (#907), but this
      // keeps the test's starting state deterministic.
      await page.addInitScript(() => {
        try {
          window.localStorage.removeItem('family-legend-expanded');
          window.localStorage.removeItem('family-legend-expanded.v2');
        } catch {
          /* noop */
        }
      });

      const app = new AppPage(page);
      // Scope to AZ (so the legend mounts with AZ silhouettes) AND deep-link the
      // detail param so the bottom sheet opens. At 390×844 it lands at half.
      await app.goto('state=US-AZ&detail=vermfly&view=detail');
      await app.waitForAppReady();

      const sheet = page.locator('[data-testid=species-detail-sheet]');
      await expect(sheet).toBeVisible({ timeout: 10_000 });
      await expect(sheet).toHaveAttribute('data-snap-state', 'half');

      // The legend mounts once silhouettes resolve (App-root sibling — no WebGL
      // dependency).
      await expect(page.locator('.family-legend')).toBeVisible({ timeout: 10_000 });

      // Drag the sheet down from half to the peek (identity-row) detent so the
      // .species-detail-sheet--peek clearance rule is exercised. Travel ≈
      // (half height − peek) so it settles at peek, not dismiss.
      const handle = page.locator('[data-testid=species-detail-sheet-handle]');
      const hb = await handle.boundingBox();
      const sb = await sheet.boundingBox();
      if (!hb || !sb) throw new Error('handle/sheet bounding box unavailable');
      const cx = hb.x + hb.width / 2;
      const cy = hb.y + hb.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx, cy + (sb.height - 140), { steps: 20 });
      await page.mouse.up();
      await expect(sheet).toHaveAttribute('data-snap-state', 'peek');

      const m = await measureLegendVsSheet(page);
      expect(m, '.species-detail-sheet / .family-legend not found').not.toBeNull();

      // The legend's bottom edge must sit at or ABOVE the peek sheet's top edge:
      // the peek-clearance rule lifts it clear so the two never overlap.
      expect(
        m!.legend.bottom,
        `legend bottom (${m!.legend.bottom.toFixed(1)}) must clear peek sheet top ` +
          `(${m!.sheet.top.toFixed(1)}) at 390×844 ` +
          `[sheet ${JSON.stringify(m!.sheet)} legend ${JSON.stringify(m!.legend)}]`,
      ).toBeLessThanOrEqual(m!.sheet.top + 0.5);
      // And zero vertical overlap area (sub-pixel tolerance for rounding).
      expect(
        m!.intersectY,
        `legend overlaps peek sheet vertically by ${m!.intersectY.toFixed(1)}px at 390×844`,
      ).toBeLessThanOrEqual(0.5);
    });
  });
});
