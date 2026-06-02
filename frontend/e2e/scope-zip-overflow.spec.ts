import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * #842 — the ZIP row ([ZIP field] + [Go]) inside the EXPANDED scope disclosure
 * must stay within the top-left identity card at every viewport.
 *
 * At ≤480px the identity card is width-capped to `calc(100% - 200px)` (so it
 * never collides with the top-right controls pill). At 360–404px that leaves the
 * card's inner column NARROWER than the ZIP row's intrinsic min-content width
 * (field cap 8rem + gap + [Go] ≈ 188px). The `.scope-control__select` and
 * `.scope-control__exit-group` already take a full-width line and shrink to the
 * card, but the ZIP box kept `flex: 0 1 auto` / `min-inline-size: auto`, so it
 * refused to shrink and [Go] spilled past the card's right edge (≈32px at 390px,
 * ≈62px at 360px). The fix gives `.scope-control__zip` its own full line and
 * lets it (and `.zip-input__row`) shrink so the inner field yields width.
 *
 * This spec opens the disclosure and asserts the [Go] button's right edge sits
 * at or within the card's inner (content) right edge, at 390px (mobile, where
 * the cap bites and the bug lived) and 768px (desktop regression guard — the
 * ZIP already wrapped clear there, and the fix must not change that).
 *
 * Layout-only assertion: it needs the real flex layout, so it runs as e2e (a
 * jsdom unit test computes no box geometry). It does NOT require the WebGL map —
 * the identity card and its disclosure render from URL scope alone — so unlike
 * the legend/attribution spec there is no `__birdMap` skip guard.
 */
test.describe('Scope ZIP/Go stays inside the identity card (#842)', () => {
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

  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
  ): Promise<AppPage> {
    await apiStub.stubStates();
    await apiStub.stubEmpty();
    await page.route('**/api/observations**', async route => {
      const state = new URL(route.request().url()).searchParams.get('state');
      const data = state === 'US-AZ' ? AZ_OBS : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          meta: {
            freshestObservationAt:
              data.length > 0 ? new Date(Date.now() - 5 * 60 * 1000).toISOString() : null,
          },
        }),
      });
    });
    const app = new AppPage(page);
    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    return app;
  }

  /**
   * Open the disclosure, then assert the [Go] submit's right edge ≤ the card's
   * inner (content) right edge. Returns the measured overflow (px past the inner
   * edge; ≤0 ⟺ fully inside) for the failure message.
   */
  async function assertGoInsideCard(app: AppPage, page: import('@playwright/test').Page) {
    await app.openScopeDisclosure();
    await expect(page.locator('.zip-input__submit')).toBeVisible();

    const m = await page.evaluate(() => {
      const go = document.querySelector('.zip-input__submit');
      const card = document.querySelector('.app-header-identity-card');
      if (!go || !card) return null;
      const cs = getComputedStyle(card);
      const cb = card.getBoundingClientRect();
      // The content-box right edge: where the card's children must stay within.
      const cardInnerRight =
        cb.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const goRight = go.getBoundingClientRect().right;
      return {
        goRight: Math.round(goRight * 100) / 100,
        cardInnerRight: Math.round(cardInnerRight * 100) / 100,
        overflow: Math.round((goRight - cardInnerRight) * 100) / 100,
      };
    });

    expect(m, 'Go button and identity card must both be present').not.toBeNull();
    // ≤ 0.5px tolerance for sub-pixel rounding; the bug was tens of pixels.
    expect(
      m!.overflow,
      `the [Go] button (right=${m!.goRight}) must not spill past the card inner edge (right=${m!.cardInnerRight}); overflow=${m!.overflow}px`,
    ).toBeLessThanOrEqual(0.5);
  }

  test.describe('mobile 390px (the cap bites here)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the [Go] button stays inside the identity card', async ({ page, apiStub }) => {
      const app = await setup(page, apiStub);
      await assertGoInsideCard(app, page);
    });
  });

  test.describe('desktop 768px (regression guard)', () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test('the [Go] button stays inside the identity card', async ({ page, apiStub }) => {
      const app = await setup(page, apiStub);
      await assertGoInsideCard(app, page);
    });
  });
});
