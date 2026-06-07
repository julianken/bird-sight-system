import { test, expect, VERMFLY, VERMFLY_WITH_PHOTO } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { AppPage } from './pages/app-page.js';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Wait until the field-guide sheet's reveal transitions have settled to full
 * opacity. axe color-contrast reads the alpha-blended computed color, so a
 * mid-transition snapshot of opacity:0→1 text reports false sub-contrast. We
 * poll the revealed elements until their computed opacity is 1 — deterministic,
 * not a fixed timeout. Resolves immediately when no sheet is present.
 *
 * Page-side-by-side (#08): the sheet body is two cross-fading pages. Only the
 * ACTIVE page's reveals matter for the scan — the inactive page is opacity:0 +
 * inert (axe skips it). We scope the poll to the active page (.sheet-page whose
 * own computed opacity is 1) so the inactive page's not-yet-revealed elements
 * never stall the wait.
 */
async function waitForRevealSettled(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page
    .waitForFunction(() => {
      const sheet = document.querySelector('.species-detail-sheet');
      if (!sheet) return true;
      // The active page is the one the #08 cross-fade has resolved to opacity:1.
      const activePage = Array.from(
        sheet.querySelectorAll('.sheet-page'),
      ).find((p) => Number(getComputedStyle(p as Element).opacity) >= 0.999);
      if (!activePage) return true;
      const revealed = activePage.querySelectorAll(
        '.sheet-fg-sci, .sheet-fg-record, .sheet-fg-teaser, .sheet-fg-teaser-text, .sheet-fg-taxonomy, .sheet-fg-about',
      );
      // Every reveal element that is laid out (not display:none in this tier)
      // must have reached full opacity.
      for (const el of Array.from(revealed)) {
        const cs = getComputedStyle(el as Element);
        if (cs.display === 'none') continue;
        if (Number(cs.opacity) < 0.999) return false;
      }
      return true;
    }, undefined, { timeout: 5_000 })
    .catch(() => { /* best-effort settle; the assertions below still run */ });
}

test.describe('axe-core WCAG scans', () => {
  test('initial load has no WCAG 2/2.1 A/AA violations', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  // Map view scans the FamilyLegend overlay (#249) at desktop and mobile
  // viewports. Replaces the historical `region expanded` skip (the
  // pre-#113 map's region-expand axe scan no longer has a target).
  // The maplibre AttributionControl needs WebGL to render and headless
  // Chromium (CI + local) ships without it. We scan the floating chrome
  // that overlays the full-bleed map: the AppHeader identity card (top-left
  // — wordmark, region h1, lede, scope-control rows) and the controls pill
  // (top-right — Filters, Attribution, ThemeToggle), plus the FamilyLegend
  // (bottom-left) and any error overlay. The `#map-layer` canvas wrapper is
  // present in the DOM (position:fixed;inset:0) but MapLibre's WebGL content
  // is not axe-readable without a GPU context. V2 (#787) re-baselined against
  // the full-bleed shell (#761 S2 + O3). #830 removed the MapLibre attribution
  // bar entirely (attribution consolidated into the ⓘ modal + the freshness-line
  // eBird link, both unit-tested), so dropping the canvas contents from the axe
  // scan does not mask a WCAG regression in the map's own controls (the modal
  // open-state is axe-scanned below).
  test('map view has no WCAG 2/2.1 A/AA violations (desktop)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    // Allow the lazy MapCanvas chunk to mount before scanning so the legend
    // is in the DOM.
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  // Phase 3: ClusterPill React markers render as <button aria-label="{N} sightings">
  // overlaid on the map canvas. This test verifies the aria-label pattern is correct
  // and the map view stays axe-clean with the pills present. Since headless Chromium
  // may lack WebGL, the map canvas may not render — gate the assertion on canvas
  // visibility and skip if WebGL is unavailable.
  test('cluster pills have "{count} sightings" aria-label when WebGL is available', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    const canvas = page.locator('[data-testid=map-canvas]');
    const canvasVisible = await canvas.isVisible({ timeout: 15_000 }).catch(() => false);
    if (!canvasVisible) {
      test.skip(true, 'map-canvas not visible — WebGL unavailable in this environment');
      return;
    }
    // Wait up to 10s for at least one cluster pill to appear. If no pills render
    // (e.g. zoom level shows only single markers), the assertion is silently
    // satisfied (0 violations, pattern correct for any that exist).
    const pills = page.getByRole('button', { name: /sightings$/ });
    const pillCount = await pills.count().catch(() => 0);
    if (pillCount > 0) {
      const pillLabel = await pills.first().getAttribute('aria-label');
      expect(pillLabel).toMatch(/^\d+ sightings$/);
    }

    // Epic #539 cutover: AdaptiveGridMarker exposes the same two-tier ARIA
    // contract spec §4.6 prescribes — a concise aria-label always, plus an
    // aria-describedby pointing at a visually-hidden <ul> of family rows
    // for multi-family grids. The label format varies by marker state:
    //   - 1×1 count=1: "Single observation: …" (no describedby)
    //   - 1×1 count=2: "2 coincident observations: <species1> and <species2>…"
    //   - grid (any size): "Cluster: N observations, M families. Activate to zoom in."
    // Any grid markers present in the viewport must carry an aria-label
    // matching one of these patterns; the describedby <ul> (when present)
    // must live in the DOM so screen readers can read it.
    const gridMarkers = page.locator('[data-testid=adaptive-grid-marker]');
    const gridCount = await gridMarkers.count().catch(() => 0);
    if (gridCount > 0) {
      const firstLabel = await gridMarkers.first().getAttribute('aria-label');
      expect(firstLabel, 'AdaptiveGridMarker is missing aria-label').toBeTruthy();
      // Patterns from spec §4.6. The marker never builds the label string
      // itself — parent owns it — so this assertion pins the parent's
      // contract.
      expect(firstLabel!).toMatch(
        /^(Single observation|\d+ coincident observations|Cluster: \d+ observations, \d+ (family|families))/,
      );
      // describedby target (if set) must exist in the DOM as a <ul>.
      const describedById = await gridMarkers.first().getAttribute('aria-describedby');
      if (describedById) {
        await expect(page.locator(`#${describedById}`)).toHaveCount(1);
      }
    }

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('error screen has no WCAG 2/2.1 A/AA violations', async ({ page, apiStub }) => {
    await apiStub.stubApiAbort('observations');
    await page.goto('/?scope=us');
    // O7 (#786): error is now a floating overlay over the live map.
    // Wait for the overlay's title to be visible.
    await expect(page.locator('[data-testid="error-overlay"] .status-block__title'))
      .toHaveText("Couldn't load bird data", { timeout: 10_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test('species detail surface has no WCAG 2/2.1 A/AA violations', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  // Issue #327 task-12 — extend axe coverage to the photo render branch.
  // The existing detail-surface scan above uses VERMFLY (no photoUrl), so
  // it only exercises the silhouette fallback path. The photo path
  // produces an `<img alt="...photo">` whose alt-text + image-alt WCAG
  // rules are scanned only when the photo is in the rendered DOM.
  // `apiStub.stubPhotoImage()` ensures the `<img>`'s `load` fires (no
  // 404→onError fallback to silhouette, which would silently mask the
  // photo branch). Both desktop (1440×900) and mobile (390×844) viewports
  // are covered because the photo's CSS layout differs at each (object-fit
  // crop bounds, container sizing) — axe validates the rendered DOM at
  // each viewport, not just the markup.
  test('species detail surface with photoUrl has no WCAG 2/2.1 A/AA violations (desktop)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
      .toBeVisible({ timeout: 10_000 });
    // Confirm the <img> is in the DOM before scanning — without it, the
    // scan would silently degrade to the silhouette branch and the test
    // name would lie about what was covered.
    await expect(page.getByAltText('Vermilion Flycatcher photo')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  // #663 — detail rail accessibility contract.
  // On desktop (≥1200px) the detail surface renders as
  // `<aside role="complementary">` (NOT a <dialog>), with
  // aria-labelledby="detail-title" and initial focus on the close button.
  // Focus restores to the trigger on close. axe asserts on the rendered
  // DOM at the moment the rail is open with a real photo loaded.
  test('species detail rail (desktop) — aria-labelledby resolves; activeElement is close button', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // The rail is an <aside role="complementary">, not a <dialog>.
    const rail = page.locator('aside.species-detail-rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('role', 'complementary');
    await expect(rail).toHaveAttribute('aria-labelledby', 'detail-title');

    // The heading referenced by aria-labelledby must resolve.
    const heading = page.locator('#detail-title');
    await expect(heading).toHaveText(/vermilion flycatcher/i);

    // Initial focus targets the close button (so screen-reader users
    // land somewhere meaningful and Tab order starts predictable).
    const focusedAriaLabel = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-label'),
    );
    expect(focusedAriaLabel).toMatch(/close species detail/i);

    // No WCAG violations under axe.
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test.describe('at 390×844 mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('species detail surface has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('vermfly', VERMFLY);
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      // #907: the field-guide sheet reveals mid-tier content with an
      // opacity/transform/blur transition (recipe-18). axe color-contrast reads
      // the computed (alpha-blended) color, so it must scan the SETTLED state —
      // wait until the revealed teaser text reaches full opacity before
      // analyzing, otherwise a mid-transition snapshot reports false sub-contrast.
      await waitForRevealSettled(page);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });

    // Issue #327 task-12 — mobile counterpart of the with-photo axe scan
    // above. The mobile viewport drives a different photo container width
    // (column-stacked layout vs side-by-side on desktop), so the
    // image-alt + landmark + reflow rules need to be scanned here too.
    test('species detail surface with photoUrl has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
      await apiStub.stubPhotoImage();
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      // #907: the field-guide sheet photo is DECORATIVE on mobile (alt="") — the
      // species name sits adjacent — so locate the rendered <img> by its stable
      // .photo__img class, not by alt text. The sheet renders the photo in BOTH
      // page-side-by-side (#08) pages; scope to the active .sheet-page--card
      // (mid detent on open) to avoid a strict-mode match on the inactive entry
      // page's duplicate photo.
      await expect(page.locator('.sheet-page--card .sheet-fg-photo .photo__img')).toBeVisible();
      await waitForRevealSettled(page);
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });

    // Sky Atlas Phase 4 — bottom-sheet at full snap accessibility contract.
    // The sheet is NOT a <dialog> at peek/half (map underneath stays
    // interactive); it flips to role="dialog" aria-modal="true" only at
    // full snap, with `inert` on #map-layer set BEFORE the role flip
    // (O1 #776: retargeted from #main-surface to #map-layer).
    test('species detail sheet (mobile) at full snap — role="dialog", map inert', async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
      await apiStub.stubPhotoImage();
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();

      const sheet = page.locator('.species-detail-sheet');
      await expect(sheet).toBeVisible();

      // The field-guide sheet opens at `half` by default; one expand tap drives
      // it to `full` (peek is reached by dragging down, not the expand button).
      // The implementation exposes a declarative `data-snap-state` attribute
      // ("peek|half|full") on the sheet root.
      await expect(sheet).toHaveAttribute('data-snap-state', 'half');
      await sheet.getByRole('button', { name: /expand/i }).click();
      await expect(sheet).toHaveAttribute('data-snap-state', 'full');

      // At full: role flips to dialog, aria-label is the species name.
      await expect(sheet).toHaveAttribute('role', 'dialog');
      await expect(sheet).toHaveAttribute('aria-modal', 'true');
      await expect(sheet).toHaveAttribute('aria-label', /vermilion flycatcher/i);

      // The map layer is inert — set BEFORE the role flip in JS, but
      // observable as a steady-state attribute once the transition settles.
      // O1 (#776): retargeted from #main-surface to #map-layer so the live
      // MapLibre canvas is frozen, not the near-empty <main> shell.
      await expect(app.mapLayer).toHaveAttribute('inert', '');

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });

    // #249 — map view at the release-1 mobile viewport scans the
    // FamilyLegend collapsed-by-default state (the chevron tab + its
    // surrounding aside landmark).
    test('map view has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });
  });

  // Issue #243 / #250 / #830 — eBird API ToU §3 attribution lives in the
  // app-level AttributionModal, opened by the AppHeader ⓘ "Credits &
  // attribution" button (the controlled-open trigger, #830 item D). The old
  // internal .attribution-trigger button was removed; reachability is now the
  // AppHeader ⓘ button, present on every view.
  test.describe('attribution reachability (issue #250 / #830)', () => {
    test('detail view exposes the AppHeader Credits trigger', async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('vermfly', VERMFLY);
      const app = new AppPage(page);
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
        .toBeVisible({ timeout: 10_000 });
      // The ⓘ Credits trigger is the AppHeader button (reachable on every view).
      await expect(app.attributionTrigger).toBeVisible();
      // The old internal shim is gone.
      await expect(page.locator('button.attribution-trigger')).toHaveCount(0);
    });

    test('map view exposes the AppHeader Credits trigger', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      await expect(app.attributionTrigger).toBeVisible();
      await expect(page.locator('button.attribution-trigger')).toHaveCount(0);
    });

    // Phase 6: app-footer removed — assert no app-footer element in DOM.
    test('no app-footer element renders (footer removed Phase 6)', async ({ page }) => {
      const app = new AppPage(page);
      for (const view of ['map'] as const) {
        await app.goto(`view=${view}`);
        await app.waitForAppReady();
        await expect(page.locator('footer.app-footer')).toHaveCount(0);
      }
    });

    // SurfaceFooter retired in #250 — assert no leftover surface-level footers.
    test('no per-surface footer.surface-footer renders anywhere', async ({ page }) => {
      const app = new AppPage(page);
      for (const view of ['map'] as const) {
        await app.goto(`view=${view}`);
        await app.waitForAppReady();
        await expect(page.locator('footer.surface-footer')).toHaveCount(0);
      }
    });
  });

  // #777: the feed-view explicit scan was removed with the feed surface. The
  // map view is covered above at desktop + mobile (see lines ~34 and ~146).

  // Issue #373 task 5 — axe scan with the AttributionModal OPEN. The
  // existing detail-surface scans cover the modal-CLOSED state, but the
  // modal contributes a non-trivial focus-trap, dialog landmark, and a
  // long list of external-link anchors that only exist in the DOM once
  // showModal() has run. WCAG 2.1.3 (Info & Relationships), 2.1.1
  // (Keyboard) and 4.1.2 (Name/Role/Value) are all sensitive to the
  // dialog's open state. Mirrors the existing paired-viewport pattern
  // (desktop + mobile via the inner describe at line ~137 below).
  //
  // Implementation note: assert the `[open]` attribute on the dialog,
  // NOT bare visibility. The codebase already documents this lesson at
  // AttributionModal.tsx:206-214 — headless-Chromium can race between
  // visibility and the dialog's open-attribute commit. Mirror that
  // pattern here.
  test('attribution modal open has no WCAG 2/2.1 A/AA violations (desktop)', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    // #830: open via the AppHeader ⓘ "Credits & attribution" button — the
    // documented real affordance, which sets the controlled `open` prop on
    // AttributionModal (item D). The header is fixed chrome on `--z-chrome`
    // (always clickable). No internal shim is involved any more.
    await app.attributionTrigger.click();
    // Wait on the [open] attribute commit — observable contract that
    // showModal() has run, focus-delegation is settled, and the dialog
    // is in the top layer.
    await expect(page.locator('dialog.attribution-modal[open]')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });

  test.describe('attribution modal open at 390×844 mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('attribution modal open has no WCAG 2/2.1 A/AA violations (mobile)', async ({ page }) => {
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();
      // #830: open via the AppHeader ⓘ "Credits & attribution" button (the
      // controlled-open trigger, item D). See the desktop test for the rationale.
      await app.attributionTrigger.click();
      await expect(page.locator('dialog.attribution-modal[open]')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      if (results.violations.length) {
        await test.info().attach('axe-violations', {
          body: JSON.stringify(results.violations, null, 2),
          contentType: 'application/json',
        });
      }
      expect(results.violations).toEqual([]);
    });
  });
});
