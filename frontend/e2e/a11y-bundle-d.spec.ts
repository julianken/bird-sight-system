/**
 * A11y Bundle D (issue #513) — semantic structure assertions.
 *
 * Covers:
 *   A11Y-3  — Each surface has exactly one <h1> (FeedSurface).
 *   A11Y-5  — Exactly one <header role="banner"> in the document.
 *   A11Y-10 — <main> tabindex decision (retained as WCAG 2.1.1 scrollable-region-focusable fix).
 *
 * A11Y-9 (forced-colors) is a CSS-only change; axe.spec.ts already covers
 * WCAG 2.1 A/AA on every surface and will catch any forced-colors regression
 * if we later break the interactable-name path. The @media block does not
 * produce an axe violation in headless Chromium (forced-colors emulation is
 * unavailable in headless), so it is validated manually via the Playwright
 * forced-colors screenshot captures documented in the PR.
 */
import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { AppPage } from './pages/app-page.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// ---------------------------------------------------------------------------
// A11Y-3 — heading hierarchy: exactly one <h1> per surface
// ---------------------------------------------------------------------------

test.describe('A11Y-3 — one <h1> per surface', () => {
  test('feed view has exactly one <h1>', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const h1Count = await page.evaluate(
      () => document.querySelectorAll('h1').length,
    );
    expect(h1Count, 'feed view must have exactly 1 <h1>').toBe(1);
  });


  // Regression guard: SpeciesDetailSurface already has an <h1> — ensure
  // the detail rail still has exactly one (no accidental duplication
  // within the rail itself).
  //
  // Post-#663 the rail coexists with a still-mounted MapSurface
  // (mapVisible = view==='map' || view==='detail'), and MapSurface
  // contributes its own <h1> via MapLede. The two h1s live in different
  // landmarks (<main> for the map lede, <aside role="complementary">
  // for the rail) and each landmark has exactly one h1 — which is the
  // semantic property A11Y-3 is guarding against. The assertion is
  // scoped to the rail accordingly.
  test('detail view has exactly one <h1> in the rail (SpeciesDetailSurface)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', {
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus',
      familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers',
      taxonOrder: 4400,
    });
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole('complementary').getByRole('heading', { level: 1 }),
      'detail rail must have exactly 1 <h1>',
    ).toHaveCount(1);
  });

  // Mobile viewport — same assertions at 390×844 to confirm no mobile path
  // renders a different heading structure.
  test.describe('at 390×844 mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('feed view has exactly one <h1> (mobile)', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=feed');
      await app.waitForAppReady();

      const h1Count = await page.evaluate(
        () => document.querySelectorAll('h1').length,
      );
      expect(h1Count, 'feed view must have exactly 1 <h1> at mobile').toBe(1);
    });

  });

  // Axe-core passes on feed and species surfaces after h1 fix.
  test('feed view has no WCAG 2/2.1 A/AA violations after h1 fix', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations-feed-a11y-d', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// A11Y-5 — single banner landmark
// ---------------------------------------------------------------------------

test.describe('A11Y-5 — single banner landmark', () => {
  test('exactly one <header role="banner"> exists at any time', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const bannerCount = await page.evaluate(
      () =>
        document.querySelectorAll('header[role="banner"], [role="banner"]').length,
    );
    expect(bannerCount, 'must have exactly one banner landmark').toBe(1);
  });

  test('banner landmark is the AppHeader (app-header class)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const bannerClass = await page.evaluate(() => {
      const el = document.querySelector('[role="banner"]');
      return el?.className ?? '';
    });
    expect(bannerClass).toContain('app-header');
  });

  // Verify across all primary views — banner count must not change.
  // (Pre-#688 included 'species'; that surface was removed in #688.)
  for (const view of ['feed', 'map'] as const) {
    test(`banner count stays 1 on ${view} view`, async ({ page }) => {
      const app = new AppPage(page);
      await app.goto(`view=${view}`);
      await app.waitForAppReady();

      const bannerCount = await page.evaluate(
        () =>
          document.querySelectorAll('header[role="banner"], [role="banner"]').length,
      );
      expect(bannerCount).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// A11Y-10 — <main> tabindex decision
// ---------------------------------------------------------------------------

test.describe('A11Y-10 — <main> tabindex review', () => {
  /**
   * The <main id="main-surface"> element has tabIndex={0} (not -1).
   * This is the documented WCAG 2.1.1 scrollable-region-focusable fix
   * (App.tsx lines 317-323): #main-surface has `overflow-y: auto` so it
   * can scroll; keyboard users need to focus the scrollable region to
   * scroll it. tabIndex=0 is correct; tabIndex=-1 would remove it from
   * Tab order and violate WCAG 2.1.1 by making the scroll region
   * unfocusable by keyboard.
   *
   * The skip-link target is `ol.feed[aria-label="Observations"]` (NOT
   * #main-surface) — see App.tsx onSkipToFeed and MapSurface skip-link.
   * These two concerns are independent; retaining tabIndex=0 on <main>
   * satisfies both.
   */
  test('<main id="main-surface"> has tabIndex=0 (scrollable-region-focusable)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const tabIndex = await page.evaluate(() => {
      // Browser context: a Playwright Locator can't cross into page.evaluate,
      // so we select on the tag-AND-id-free `[data-render-complete]` attribute
      // (the readiness hook the map-first inversion (#761) carries forward).
      // It resolves to the same single element as `#main-surface` today.
      const main = document.querySelector('[data-render-complete]');
      return main instanceof HTMLElement ? main.tabIndex : null;
    });
    // tabIndex=0 — keyboard-focusable scrollable region per WCAG 2.1.1.
    expect(tabIndex).toBe(0);
  });
});
