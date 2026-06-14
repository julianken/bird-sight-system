import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * #837 fast-follow — the bottom-left family legend must not collide with the
 * bottom-right `.map-attribution` island at phone width.
 *
 * Both surfaces anchor at `bottom: var(--card-inset)` and ride `z-index:
 * --z-overlay`. The COLLAPSED legend pill (~173px) clears the ~129px attribution
 * comfortably, but the EXPANDED legend caps at 280px — on a 390px viewport its
 * bottom-right corner overran the attribution by a ~43×25px band. The fix lifts
 * the legend above the attribution band ONLY while its entries are showing
 * (`.family-legend:has(.family-legend-entries)` at ≤480px), so the two never
 * overlap when expanded and the collapsed pill is untouched.
 *
 * This spec expands the legend (the worst case) and asserts the legend and
 * attribution rectangles do not intersect, at both 390px (mobile, where the fix
 * applies) and 768px (tablet, where the wider viewport already clears them).
 *
 * WebGL skip guard: `.family-legend` + `.map-attribution` render gated on
 * `mapVisible && scopeActive` (App.tsx), and `mapVisible` requires the maplibre
 * canvas to paint. Headless Chromium without a GL backend never fires `load`;
 * skip cleanly there (matches family-legend-viewport.spec.ts).
 */

// A handful of observations across three families, clustered in southern AZ so
// the legend renders ≥3 entries (enough to make the expanded card its full
// 280px width). Families match the silhouette fixture below.
const OBS: Observation[] = [
  { subId: 'O1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher', lat: 32.22, lng: -110.97, obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), locId: 'L1', locName: 'Tucson', howMany: 1, isNotable: false, silhouetteId: 'tyrannidae', familyCode: 'tyrannidae' },
  { subId: 'O2', speciesCode: 'gilwoo', comName: 'Gila Woodpecker', lat: 32.25, lng: -110.99, obsDt: new Date(Date.now() - 70 * 60 * 1000).toISOString(), locId: 'L2', locName: 'Saguaro', howMany: 2, isNotable: false, silhouetteId: 'picidae', familyCode: 'picidae' },
  { subId: 'O3', speciesCode: 'cacwre', comName: 'Cactus Wren', lat: 32.28, lng: -111.01, obsDt: new Date(Date.now() - 80 * 60 * 1000).toISOString(), locId: 'L3', locName: 'Desert', howMany: 1, isNotable: false, silhouetteId: 'troglodytidae', familyCode: 'troglodytidae' },
  { subId: 'O4', speciesCode: 'gambel', comName: "Gambel's Quail", lat: 32.30, lng: -110.95, obsDt: new Date(Date.now() - 90 * 60 * 1000).toISOString(), locId: 'L4', locName: 'Wash', howMany: 4, isNotable: false, silhouetteId: 'odontophoridae', familyCode: 'odontophoridae' },
];

function silhouetteFixture() {
  const fams = [
    { code: 'tyrannidae', color: '#E84040', name: 'Tyrant Flycatchers' },
    { code: 'picidae', color: '#F5A623', name: 'Woodpeckers' },
    { code: 'troglodytidae', color: '#5DA832', name: 'Wrens' },
    { code: 'odontophoridae', color: '#8B5CF6', name: 'New World Quail' },
  ];
  const rows = fams.map(({ code, color, name }) => ({
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

async function setupRoutes(
  page: import('@playwright/test').Page,
  apiStub: import('../fixtures.js').ApiStub,
) {
  await apiStub.stubEmpty();
  await apiStub.stubObservations(OBS);
  await page.route('**/api/silhouettes', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(silhouetteFixture()),
    });
  });
}

async function skipIfMapHookAbsent(
  page: import('@playwright/test').Page,
  testRef: typeof test,
): Promise<boolean> {
  const present = await page
    .waitForFunction(
      () => typeof (window as { __birdMap?: unknown }).__birdMap !== 'undefined',
      { timeout: 8_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!present) {
    testRef.skip(true, 'window.__birdMap not exposed — maplibre `load` did not fire (WebGL unavailable).');
  }
  return !present;
}

/** Intersect two DOMRect-likes; returns the overlap area (0 ⟺ no overlap). */
function overlapArea(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): number {
  const ix = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return ix * iy;
}

async function assertNoOverlapWhenExpanded(
  page: import('@playwright/test').Page,
  app: AppPage,
) {
  // Expand the legend (worst case — the 280px card). The mobile legend defaults
  // collapsed, so click the toggle to reveal the entries.
  const toggle = page.getByRole('button', { name: /bird families in view/i });
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // The entries list is what widens the card to 280px and what the fix keys on.
  await expect(page.locator('.family-legend-entries')).toBeVisible();

  const rects = await page.evaluate(() => {
    const legend = document.querySelector('.family-legend');
    const attr = document.querySelector('.map-attribution');
    const pick = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return { legend: pick(legend), attr: pick(attr) };
  });

  expect(rects.legend, 'legend must be present').not.toBeNull();
  expect(rects.attr, 'attribution must be present').not.toBeNull();
  const area = overlapArea(rects.legend!, rects.attr!);
  expect(
    area,
    `expanded legend (${JSON.stringify(rects.legend)}) must not overlap attribution (${JSON.stringify(rects.attr)})`,
  ).toBe(0);
}

test.describe('Legend ↔ attribution clearance (#837)', () => {
  test.describe('mobile 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the expanded legend does not overlap the bottom-right attribution', async ({ page, apiStub }) => {
      test.setTimeout(60_000);
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
      if (await skipIfMapHookAbsent(page, test)) return;
      await assertNoOverlapWhenExpanded(page, app);
    });
  });

  test.describe('tablet 768px', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('the expanded legend does not overlap the bottom-right attribution', async ({ page, apiStub }) => {
      test.setTimeout(60_000);
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
      if (await skipIfMapHookAbsent(page, test)) return;
      await assertNoOverlapWhenExpanded(page, app);
    });
  });

  // E2 (#1054): at ≥1440 the legend must adopt the wide corner gutter
  // (--card-inset-wide = 24px) like the other four corners — it was the only
  // corner missing the @media (min-width:1440px) block, leaving the bottom-left
  // at 13px while the bottom-right attribution sat at 24-25px. Assert the legend
  // sits ~24px from the left/bottom edges AND shares the attribution's bottom
  // baseline (both bottom-anchored at --card-inset-wide). 1.5px tolerance for
  // sub-pixel border/rounding.
  test.describe('desktop 1440px — shared 24px corner gutter', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('the legend sits 24px from left/bottom and shares the attribution bottom baseline', async ({ page, apiStub }) => {
      test.setTimeout(60_000);
      await setupRoutes(page, apiStub);
      const app = new AppPage(page);
      await app.goto('state=US-AZ');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
      if (await skipIfMapHookAbsent(page, test)) return;

      const m = await page.evaluate(() => {
        const legend = document.querySelector('.family-legend');
        const attr = document.querySelector('.map-attribution');
        if (!legend || !attr) return null;
        const lr = legend.getBoundingClientRect();
        const ar = attr.getBoundingClientRect();
        return {
          legendLeft: lr.left,
          legendBottomGap: window.innerHeight - lr.bottom,
          attrBottomGap: window.innerHeight - ar.bottom,
        };
      });
      expect(m, '.family-legend / .map-attribution not found').not.toBeNull();
      // 24px = --card-inset-wide.
      expect(m!.legendLeft, 'legend left gutter is the wide 24px inset').toBeLessThanOrEqual(25.5);
      expect(m!.legendLeft).toBeGreaterThanOrEqual(22.5);
      expect(m!.legendBottomGap, 'legend bottom gutter is the wide 24px inset').toBeLessThanOrEqual(25.5);
      expect(m!.legendBottomGap).toBeGreaterThanOrEqual(22.5);
      // The two bottom corners now share a baseline (both at --card-inset-wide).
      expect(
        Math.abs(m!.legendBottomGap - m!.attrBottomGap),
        'legend and attribution share the bottom baseline',
      ).toBeLessThanOrEqual(1.5);
    });
  });
});
