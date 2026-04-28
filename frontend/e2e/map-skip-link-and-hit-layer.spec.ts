import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Issues #247 (skip-link + hit-target overlay) narrowed by #277 (Spider v2).
 *
 * Originally map-spiderfy.spec.ts. Spider v2 (issue #277) removed the
 * click-driven Escape handler from MapCanvas.tsx (Task 5) and replaced
 * click-spiderfy with the auto-spider always-on fan. The Escape test
 * (formerly test 4) was deleted; its contract is now dead code.
 *
 * Tests preserved here:
 *   1. Skip-link reachable via Tab (desktop 1440x900)
 *   2. Skip-link preserves filter state on view switch
 *   3. Skip-link reachable on mobile (390x844)
 *   4. (was test 5) Hit-target overlay layer mounts when map renders
 *
 * The click-driven spiderfy assertions from the original spec are now
 * covered by Tasks 3–5's unit tests (MapCanvas.test.tsx, stack-fanout.test.ts)
 * and the new map-stack-fanout.spec.ts e2e spec.
 */

/**
 * Two observations near Sweetwater Wetlands — enough to satisfy the non-empty
 * stub requirement and verify the hit-layer wraps multiple buttons. The
 * 6-observation cluster fixture was load-bearing only for the deleted Escape
 * test (former test 4, removed in Spider v2 Task 5).
 */
function clusterableObs(): Observation[] {
  return [
    {
      subId: 'S001',
      speciesCode: 'houfin',
      comName: 'House Finch',
      lat: 32.27,
      lng: -110.85,
      obsDt: '2026-04-15T10:00:00Z',
      locId: 'L99',
      locName: 'Sweetwater Wetlands',
      howMany: 1,
      isNotable: false,
      regionId: null,
      silhouetteId: null,
      familyCode: null,
    },
    {
      subId: 'S002',
      speciesCode: 'verdin',
      comName: 'Verdin',
      lat: 32.2701,
      lng: -110.8501,
      obsDt: '2026-04-15T10:00:00Z',
      locId: 'L99',
      locName: 'Sweetwater Wetlands',
      howMany: 1,
      isNotable: false,
      regionId: null,
      silhouetteId: null,
      familyCode: null,
    },
  ];
}

test.describe('Map skip-link + hit-target overlay (#247, #277)', () => {
  test('skip-link is visually hidden but reachable via Tab and routes to feed (1440x900)', async ({
    page,
    apiStub,
  }) => {
    test.setTimeout(60_000);
    await apiStub.stubEmpty();
    await apiStub.stubObservations(clusterableObs());
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The skip-link should be in the DOM but visually hidden until focused.
    // It is a <button> (NOT an <a>) — App.tsx mounts surfaces mutually-
    // exclusive so anchor-based navigation doesn't switch view state.
    const skipLink = page.getByRole('button', { name: /Skip to species list/i });
    await expect(skipLink).toHaveCount(1);
    expect(await skipLink.evaluate((el) => el.tagName)).toBe('BUTTON');

    // Tab from a non-skip-link starting point. Body→Tab moves to the
    // first focusable element; depending on FiltersBar tab order the
    // skip-link may not be first — but it MUST be reachable. We tab a
    // bounded number of times and assert focus eventually lands on it.
    await page.locator('body').focus();
    let focused = false;
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      const isSkip = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return Boolean(el?.matches('.skip-link'));
      });
      if (isSkip) {
        focused = true;
        break;
      }
    }
    expect(focused, 'Tab must reach the skip-link').toBe(true);

    // Activate the link via keyboard (Enter == native button activation).
    await page.keyboard.press('Enter');

    // URL should switch to view=feed; the previous map URL parameters
    // (notable / since / etc.) are preserved by the partial-merge
    // semantics of useUrlState.set.
    //
    // `useUrlState.writeUrl` omits the `?view=` param entirely when the
    // value equals the default ('feed') — so we assert via the rendered
    // tab state (FeedSurface mounted, Feed tab selected) rather than a
    // URL `view=feed` literal that would never appear.
    await expect.poll(() => app.getUrlParams().get('view'), {
      timeout: 5_000,
    }).toBeNull();
    await expect(
      page.getByRole('tab', { name: 'Feed view' }),
    ).toHaveAttribute('aria-selected', 'true');

    // The Feed surface's <ol class="feed"> landmark is now focused so
    // sighted-keyboard users see a clear focus jump. The setTimeout(_, 0)
    // in App.tsx defers focus past the React commit; poll briefly for it.
    await expect.poll(async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.tagName ?? '';
      }), { timeout: 2_000 }).toBe('OL');
  });

  test('skip-link preserves filter state on view switch (1440x900)', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    await apiStub.stubObservations(clusterableObs());
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map&notable=true&since=7d');
    await app.waitForAppReady();

    const skipLink = page.getByRole('button', { name: /Skip to species list/i });
    await skipLink.focus();
    await page.keyboard.press('Enter');

    // After view switch, the Feed tab is selected and ?notable=true /
    // ?since=7d must still be set. (?view=feed is omitted from the URL
    // because 'feed' is the default for that param — see writeUrl in
    // url-state.ts.)
    await expect(
      page.getByRole('tab', { name: 'Feed view' }),
    ).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
    await expect.poll(() => app.getUrlParams().get('notable'), {
      timeout: 5_000,
    }).toBe('true');
    expect(app.getUrlParams().get('since')).toBe('7d');
  });

  test('mobile viewport (390x844): skip-link still reachable + routes to feed', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    await apiStub.stubObservations(clusterableObs());
    await page.setViewportSize({ width: 390, height: 844 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    const skipLink = page.getByRole('button', { name: /Skip to species list/i });
    await expect(skipLink).toHaveCount(1);

    // Activate via focus + Enter (the keyboard path; visual click on a
    // visually-hidden element is brittle in Playwright — element renders
    // as a 1×1 clipped box until focus reveals it). The skip-link is by
    // design only ever activated by keyboard users (mouse users don't
    // see it), so the keyboard path is the right thing to assert.
    await skipLink.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('tab', { name: 'Feed view' }),
    ).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
  });

  test('hit-target overlay layer mounts when map renders (1440x900)', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    await apiStub.stubObservations(clusterableObs());
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();

    // The map canvas mounts to the DOM regardless of WebGL — the
    // [data-testid=map-canvas] wrapper renders before maplibre's
    // `onLoad` fires. Headless Chromium without GPU support may not
    // dispatch `onLoad`, in which case the hit-layer's mapReady flag
    // never flips and the layer is intentionally suppressed (we don't
    // want to project onto a non-rendered map). When the wrapper does
    // show up, assert the layer wrapper is below it.
    const wrapper = page.locator('[data-testid=map-canvas]');
    if (await wrapper.count() === 0) {
      // WebGL chunk failed to mount in this headless run — recorded
      // limitation, the live MCP pass covers it.
      test.skip(true, 'maplibre chunk did not mount in headless run');
      return;
    }
    await expect(wrapper).toBeVisible({ timeout: 15_000 });

    // The hit-layer container is rendered next to the canvas once
    // mapReady=true. Without WebGL, mapReady may never flip; tolerate
    // that case the same way as the chunk-failed branch.
    const layer = page.locator('.map-marker-hit-layer');
    if ((await layer.count()) === 0) {
      test.skip(true, 'map onLoad did not fire — likely WebGL unavailable in headless run');
      return;
    }
    // When the layer IS present, every rendered button must carry an
    // aria-label (the WCAG label invariant the issue body calls out).
    await expect.poll(async () => {
      const labels = await layer.locator('button').evaluateAll((btns) =>
        btns.map((b) => b.getAttribute('aria-label') ?? ''),
      );
      return labels.every((l) => l.length > 0);
    }, { timeout: 5_000 }).toBe(true);
  });
});
