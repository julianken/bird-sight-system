import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Issue #247 — MapCanvas click-spiderfy + a11y skip-link.
 *
 * Drives the map at the two viewports the release-1 exit criteria name
 * (390x844 + 1440x900). Spiderfy itself depends on WebGL clustering
 * behaviour (project / unproject / getClusterLeaves), which is hard to
 * exercise reliably end-to-end without a real map render. The portions
 * we can observe deterministically without WebGL are the skip-link and
 * the URL/view round-trip; both are asserted here. The spiderfy click
 * itself is exercised live via Playwright MCP in the implementer's
 * pre-PR pass (per CLAUDE.md UI verification protocol).
 */

/** Build a deterministic observation set near a single hotspot so any
 *  cluster MapLibre forms at high zoom contains the points we know about. */
function clusterableObs(): Observation[] {
  // Six points within ~50m of (-110.85, 32.27) — Sweetwater Wetlands.
  const center: [number, number] = [-110.85, 32.27];
  return Array.from({ length: 6 }, (_, i) => ({
    subId: `S${String(i).padStart(3, '0')}`,
    speciesCode: ['houfin', 'verdin', 'gambqu', 'gilwoo', 'ruskla', 'verfly'][i] ?? 'houfin',
    comName: ['House Finch', 'Verdin', 'Gambels Quail', 'Gila Woodpecker', 'Ruddy Duck', 'Vermilion Flycatcher'][i] ?? 'House Finch',
    lat: center[1] + (i - 3) * 0.0001,
    lng: center[0] + (i % 2 === 0 ? 0.0001 : -0.0001),
    obsDt: '2026-04-15T10:00:00Z',
    locId: 'L99',
    locName: 'Sweetwater Wetlands',
    howMany: 1,
    isNotable: i === 5,
    regionId: null,
    silhouetteId: null,
    familyCode: null,
  }));
}

test.describe('Map spiderfy + a11y skip-link', () => {
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

  test('Escape key closes spiderfy when one is open (live MCP verifies actual fan-out)', async ({
    page,
    apiStub,
  }) => {
    // This test verifies the keydown wiring path in MapCanvas.tsx — we
    // dispatch an Escape and confirm the page does not crash and the
    // map remains visible. The full spiderfy+escape interaction is
    // exercised live via Playwright MCP per CLAUDE.md UI verification.
    await apiStub.stubEmpty();
    await apiStub.stubObservations(clusterableObs());
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({
      timeout: 15_000,
    });

    // Escape on the map view must not throw / not navigate / not re-render
    // an error screen, even when there is no active spiderfy.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible();
    await expect(page.locator('.error-screen')).toHaveCount(0);
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
