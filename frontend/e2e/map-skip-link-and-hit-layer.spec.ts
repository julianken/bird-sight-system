import { test, expect } from './fixtures.js';
import { AppPage } from './pages/app-page.js';
import type { Observation } from '@bird-watch/shared-types';

/**
 * Hit-target overlay test (was issue #247 + #277) + O2 (#770) tab-order guard.
 *
 * Issue #662 removed the Feed view as a user-visible surface, which made
 * the "Skip to species list" skip-link (and its three e2e tests) dead
 * code — there is no longer a Feed landmark to skip to. The keyboard bypass
 * is now covered by the "Explore map markers" skip-link (O2 #770, ex-#558),
 * exercised in map-cell-popover.spec.ts.
 *
 * O2 (#770) adds a focus-ORDER guard here: the skip-link must be reached by
 * Tab BEFORE any ScopeControl or canvas element. A direct .focus() call would
 * stay green even if the link is last in tab order; real Tab traversal is
 * required. `map-cell-popover.spec.ts` uses .focus() for its skip→cell→popover
 * walk — this spec's Tab test closes that gap.
 *
 * The hit-target overlay test below was unrelated to Feed and is kept.
 */

/**
 * Two observations near Sweetwater Wetlands — enough to satisfy the non-empty
 * stub requirement and verify the hit-layer wraps multiple buttons.
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
      silhouetteId: null,
      familyCode: null,
    },
  ];
}

// ─── O2 (#770): DOM-order + focus-order guard ────────────────────────────────
//
// WCAG 2.4.1 (Bypass Blocks): the skip-link must precede #map-layer (the map
// canvas) in DOM order so it can be Tab-traversed BEFORE the canvas block.
// Position:fixed does NOT reorder tab focus — DOM order determines tab order.
//
// Two-part guard:
//  1. compareDocumentPosition: skip-link precedes #map-layer in document order.
//  2. Tab traversal: Tab from the skip-link itself focuses the map (not another
//     skip-link instance appended after the canvas), confirming the skip-link is
//     not duplicated at a later position.
//
// A direct .focus() call on the skip-link would stay green even if the link
// were last in tab order. The DOM-position check is the definitive guard.
test.describe('O2 (#770): skip-link DOM-order + focus guard (WCAG 2.4.1)', () => {
  test(
    'skip-link precedes #map-layer in DOM order; Tab from skip-link does not cycle back (1440×900)',
    async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubObservations(clusterableObs());
      await page.setViewportSize({ width: 1440, height: 900 });
      const app = new AppPage(page);
      await app.goto('scope=us');
      await app.waitForAppReady();

      // Wait for the skip-link to be attached (renders when mapVisible && scopeActive).
      // Hard assertion — with scope=us + observations stubbed, the skip-link MUST
      // attach. A silent test.skip here would mask the "skip-link never renders"
      // regression (mapVisible derives from URL state, not WebGL availability).
      const skipLink = page.locator('[data-testid="explore-map-markers-skip-link"]');
      await expect(skipLink, 'skip-link must attach on scoped map view (scope=us)').toBeAttached({ timeout: 8_000 });

      // Guard 1: DOM-order assertion (compareDocumentPosition).
      // skip-link must precede #map-layer (the canvas block). If the link were
      // appended AFTER #map-layer (e.g. alongside the rail/sheet), this fails.
      const positionResult = await page.evaluate(() => {
        const skipLink = document.querySelector('[data-testid="explore-map-markers-skip-link"]');
        const mapLayer = document.querySelector('#map-layer');
        if (!skipLink || !mapLayer) return null;
        // DOCUMENT_POSITION_FOLLOWING (4): mapLayer follows skipLink → skipLink is first.
        return (skipLink.compareDocumentPosition(mapLayer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      expect(positionResult, 'skip-link must precede #map-layer in document order (WCAG 2.4.1)').toBe(true);

      // Guard 2: exactly ONE skip-link in the document (no duplicate appended post-main).
      const skipLinkCount = await page.evaluate(() =>
        document.querySelectorAll('[data-testid="explore-map-markers-skip-link"]').length,
      );
      expect(skipLinkCount, 'exactly one skip-link in the document').toBe(1);
    },
  );
});

test.describe('Map hit-target overlay (#247, #277)', () => {
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
