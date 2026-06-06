import { test, expect, VERMFLY, VERMFLY_OBS, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * Issue #151 — species detail surface (replaces SpeciesPanel sidebar).
 *
 * The detail surface mounts in-flow inside <main> when
 * `?detail=<code>&view=detail` is in the URL. It is NOT a position:fixed
 * overlay. No ESC dismiss, no close button, no overlay.
 *
 * Navigation contract: every test begins with page.goto (no shared state).
 */

test.describe('species detail surface (#151)', () => {
  test('detail URL mounts the surface with species info', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // Phase 4: the detail surface renders inside a native <dialog> (desktop)
    // or bottom-sheet (mobile) OUTSIDE <main>. Scope assertions to the dialog
    // container rather than <main>. The AttributionModal family names are in a
    // separate dialog.attribution-modal — use getByRole to avoid collisions.
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Pyrocephalus rubinus')).toBeVisible();
    // Family name appears in the detail surface; scope to species-detail-family
    // class to avoid hitting the AttributionModal Phylopic section.
    await expect(page.locator('.species-detail-family')).toHaveText(/Tyrant Flycatchers/);

    // URL carries detail and view params.
    await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
      .toBe('vermfly');
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBe('detail');
  });

  // #777: the "row click → detail" navigation test was removed with the feed
  // surface. The surviving map-marker / cell-popover species-commit → detail
  // path is covered by map-cell-popover.spec.ts (scenarios 1, 6).

  test('FiltersBar species commit narrows the map without opening detail', async ({ page, apiStub }) => {
    // /api/observations returns aggregated buckets at low zoom (#627), which
    // carry no per-observation rows — #859 moved species aggregation
    // server-side and deleted the synthetic-observation expansion. The
    // species typeahead derives from per-observation (comName, speciesCode)
    // pairs, so it needs a real-species observation stubbed in to resolve
    // "Vermilion Flycatcher" → "vermfly".
    await apiStub.stubObservations(VERMFLY_OBS);
    const app = new AppPage(page);
    await app.goto('scope=us');
    await app.waitForAppReady();

    // Phase 3: FiltersBar is inside a panel triggered from AppHeader.
    await app.openFilters();

    // Wait for species options to be populated.
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });

    // Type exact species name and press Enter to commit.
    await app.filters.setSpecies('Vermilion Flycatcher');
    await page.keyboard.press('Enter');

    // species= should be set (filter narrowing).
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');

    // detail= should NOT be set; the commit narrows the map, it does not open
    // the detail overlay. The map remains the active (default) surface.
    expect(app.getUrlParams().get('detail')).toBeNull();
    expect(app.getUrlParams().get('view')).toBeNull();

    // #688/#777/#800: Species, Feed, and Map tabs are all gone. No tablist.
    await expect(page.getByRole('tab', { name: 'Species view' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Map view' })).toHaveCount(0);
  });

  test('network failure shows inline error on detail surface', async ({ page, apiStub }) => {
    await apiStub.stubApiFailure('species', 500);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByText('Could not load species details')).toBeVisible({ timeout: 10_000 });
  });

  test('ESC closes the detail dialog/sheet and returns to map (#662)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    // Phase 4: ESC closes the native <dialog> on desktop and collapses
    // the bottom-sheet on mobile (at full snap) or dismisses it at peek/half.
    await page.keyboard.press('Escape');

    // #662 + #663: ESC dismisses the overlay. onCloseDetail resets view
    // to 'map' (DEFAULTS.view, so writeUrl OMITS ?view=) and clears the
    // detail param. Both params absent in the URL afterward.
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBeNull();
    await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
      .toBeNull();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toHaveCount(0);
    // #800: no Map tab — assert map canvas is reachable after ESC.
    await expect(page.getByRole('tab', { name: 'Map view' })).toHaveCount(0);
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 5_000 });
  });

  test('detail surface renders as <aside role="complementary"> on desktop (#663)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    // Set viewport ≥1200px so useIsCompact returns false and the rail mounts.
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    // #663 Addendum A: the rail is an <aside role="complementary">,
    // NOT a <dialog>. The complementary landmark must be present.
    await expect(page.getByRole('complementary')).toHaveCount(1);
    // Close button exists with accessible label.
    await expect(page.getByRole('button', { name: /close species detail/i })).toBeVisible();
    // The legacy position:fixed overlay class is still absent.
    await expect(page.locator('.species-panel-overlay')).toHaveCount(0);
  });

  /**
   * #801 — SpeciesDetailRail de-docked to an inset floating card.
   *
   * At ≥1200px the rail must float inset from ALL four sides of the viewport:
   *   - rect.top > 0     — map pixels visible above the card
   *   - rect.right < viewportWidth — map pixels visible to the right (inset from right edge)
   *   - rect.bottom < viewportHeight — map pixels visible below the card
   *   - rect.left > 0    — map pixels visible to the left (not a full-height dock from left:0)
   *
   * Additionally:
   *   - No border-left divider (the old edge-dock's left border must be gone)
   *   - border-radius on all four corners (--card-radius ≥ 8px confirms all-corner treatment)
   *   - --z-rail tier preserved (43 — above chrome 42, below cell/cluster popovers)
   */
  test('#801 rail is an inset floating card at 1440×900 — map pixels visible on all four sides', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    const rail = page.locator('aside.species-detail-rail');
    await expect(rail).toBeVisible();

    const m = await rail.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top:            r.top,
        right:          r.right,
        bottom:         r.bottom,
        left:           r.left,
        viewportWidth:  window.innerWidth,
        viewportHeight: window.innerHeight,
        borderLeft:     cs.borderLeftWidth,
        borderTopLeftRadius:     cs.borderTopLeftRadius,
        borderTopRightRadius:    cs.borderTopRightRadius,
        borderBottomLeftRadius:  cs.borderBottomLeftRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
      };
    });

    // All four sides must have a gap — the card floats inset, not docked.
    expect(m.top,    'rail.top > 0: map visible above the card').toBeGreaterThan(0);
    expect(m.right,  'rail.right < viewportWidth: map visible to the right').toBeLessThan(m.viewportWidth);
    expect(m.bottom, 'rail.bottom < viewportHeight: map visible below the card').toBeLessThan(m.viewportHeight);
    expect(m.left,   'rail.left > 0: not full-height docked to left edge').toBeGreaterThan(0);

    // No hard left-border divider — the old edge-dock visual.
    expect(
      parseFloat(m.borderLeft),
      'no border-left divider on the floating card',
    ).toBeLessThanOrEqual(0);

    // All four corners have border-radius (≥ 8px confirms all-corner floating treatment).
    const minRadius = 8;
    expect(parseFloat(m.borderTopLeftRadius),     'top-left radius ≥ 8px').toBeGreaterThanOrEqual(minRadius);
    expect(parseFloat(m.borderTopRightRadius),    'top-right radius ≥ 8px').toBeGreaterThanOrEqual(minRadius);
    expect(parseFloat(m.borderBottomLeftRadius),  'bottom-left radius ≥ 8px').toBeGreaterThanOrEqual(minRadius);
    expect(parseFloat(m.borderBottomRightRadius), 'bottom-right radius ≥ 8px').toBeGreaterThanOrEqual(minRadius);
  });

  test('#801 rail is an inset floating card at 1920×1080 — map pixels visible on all four sides', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

    const rail = page.locator('aside.species-detail-rail');
    await expect(rail).toBeVisible();

    const m = await rail.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        top:            r.top,
        right:          r.right,
        bottom:         r.bottom,
        left:           r.left,
        viewportWidth:  window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    expect(m.top,    'rail.top > 0: map visible above the card at 1920').toBeGreaterThan(0);
    expect(m.right,  'rail.right < 1920: map visible to the right').toBeLessThan(m.viewportWidth);
    expect(m.bottom, 'rail.bottom < 1080: map visible below the card at 1920').toBeLessThan(m.viewportHeight);
    expect(m.left,   'rail.left > 0: not docked to left edge at 1920').toBeGreaterThan(0);
  });

  /**
   * #801 Tier-2 occlusion regression guard — rail must NOT overlap the controls pill.
   *
   * At ≥1440 the rail (z-index --z-rail 43) is stacked ABOVE the controls pill
   * (z-index --z-chrome 42). If the rail's top edge encroaches into the pill's
   * vertical band, the Attribution/Filters/theme buttons are painted over and
   * unclickable. This test asserts disjoint bounding boxes: rail.top ≥ pill.bottom.
   *
   * Tested at both canonical wide viewports (1440×900 and 1920×1080).
   */
  for (const [vw, vh] of [[1440, 900], [1920, 1080]] as const) {
    test(`#801 rail does not occlude controls pill at ${vw}×${vh} — rail.top ≥ pill.bottom`, async ({ page, apiStub }) => {
      await apiStub.stubEmpty();
      await apiStub.stubSpecies('vermfly', VERMFLY);
      const app = new AppPage(page);
      await page.setViewportSize({ width: vw, height: vh });
      await app.goto('detail=vermfly&view=detail');
      await app.waitForAppReady();
      await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' })).toBeVisible({ timeout: 10_000 });

      const rects = await page.evaluate(() => {
        const rail = document.querySelector('aside.species-detail-rail');
        const pill = document.querySelector('.app-header-controls-pill');
        if (!rail || !pill) return null;
        const railR = rail.getBoundingClientRect();
        const pillR = pill.getBoundingClientRect();
        return {
          railTop:    railR.top,
          pillBottom: pillR.bottom,
          pillTop:    pillR.top,
          pillRight:  pillR.right,
          railRight:  railR.right,
        };
      });

      expect(rects, 'rail and pill elements must be present').not.toBeNull();

      // The rail's top edge must be at or below the pill's bottom edge —
      // no shared vertical band means no occlusion regardless of z-index.
      expect(
        rects!.railTop,
        `rail.top (${rects!.railTop}px) must be ≥ pill.bottom (${rects!.pillBottom}px) — no vertical overlap`,
      ).toBeGreaterThanOrEqual(rects!.pillBottom);
    });
  }
});

/**
 * Issue #327 task-12 — e2e coverage for the photo render + silhouette
 * fallback paths on SpeciesDetailSurface at both release-1 viewports.
 *
 * The component-level unit tests (SpeciesDetailSurface.test.tsx) cover the
 * branching logic; this spec asserts the rendered DOM survives the actual
 * Vite + React + URL-state pipeline at the two viewports the release-1
 * exit criteria name (390×844 mobile, 1440×900 desktop) AND that no
 * console errors/warnings surface during either render path.
 *
 * The photo `<img>` request is stubbed via `apiStub.stubPhotoImage()` to
 * a 1×1 PNG so the photo branch stays mounted (without the stub, the
 * browser would 404 the real photos.bird-maps.com URL and the `<img>`'s
 * `onError` would silently fall back to the silhouette, masking the
 * branch this spec is asserting on).
 */
test.describe('species detail surface — photo rendering (#327 task-12)', () => {
  for (const viewport of [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ] as const) {
    test.describe(`${viewport.label} (${viewport.width}x${viewport.height})`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test('renders <img> when SpeciesMeta carries photoUrl', async ({ page, apiStub }) => {
        await apiStub.stubEmpty();
        await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
        await apiStub.stubPhotoImage();
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();

        // Phase 4: heading renders inside a <dialog> (desktop) or
        // bottom-sheet (mobile) — both are outside <main>. Scope to page.
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // The photo render branch produces an <img> inside the <Photo>
        // primitive (.photo__img). On DESKTOP the surface gives it a descriptive
        // alt ("<comName> photo"); on MOBILE the field-guide sheet renders the
        // photo DECORATIVELY (alt="") because the species name sits adjacent —
        // so the alt-text locator only works on desktop. Locate by the stable
        // .photo__img class on mobile.
        const photo = viewport.label === 'mobile'
          ? page.locator('.sheet-fg-photo .photo__img')
          : page.getByAltText('Vermilion Flycatcher photo');
        await expect(photo).toBeVisible();
        await expect(photo).toHaveAttribute('src', 'https://photos.bird-maps.com/vermfly.jpg');
        // The IMG must have actually loaded (naturalWidth>0). The stubbed
        // PNG is 1×1, so the assertion is naturalWidth >= 1. If this fails,
        // the `<img>`'s onError fired and the silhouette fallback took over
        // — which would mean the photo render branch is silently broken.
        await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
        // Silhouette is NOT rendered on the photo branch.
        // photo--silhouette class is present only when <Photo> is in the
        // fallback state (src=null or onError). Using the CSS class as the
        // locator avoids a test-only prop on the shared DS primitive.
        await expect(page.locator('.photo--silhouette')).toHaveCount(0);
      });

      test('renders silhouette fallback when SpeciesMeta has no photoUrl', async ({ page, apiStub }) => {
        // VERMFLY (the no-photo fixture) — exercises the silhouette path.
        await apiStub.stubEmpty();
        await apiStub.stubSpecies('vermfly', VERMFLY);
        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();

        // Phase 4: heading is outside <main> — scope to page.
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // No photo img.
        await expect(page.getByAltText('Vermilion Flycatcher photo')).toHaveCount(0);
        // Silhouette IS visible. Use the CSS class-based locator — the
        // silhouetteTestId prop was removed from the shared DS Photo
        // primitive; .photo--silhouette is the stable, production-present
        // selector for the fallback state.
        const silhouette = page.locator('.photo--silhouette');
        await expect(silhouette).toBeVisible();
      });
    });
  }

  // Cross-viewport, cross-fixture console-cleanliness sweep. Captures any
  // console errors or warnings emitted during the photo/silhouette render
  // pipeline at both release-1 viewports — the kind of regression unit
  // tests miss because they run under jsdom (no real <img> load, no real
  // viewport-driven layout). One test per viewport+fixture combination
  // keeps failures readable: a broken photo branch on mobile shows up as
  // a single failing test name, not a tangle of nested matrices.
  for (const viewport of [
    { width: 1440, height: 900, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ] as const) {
    for (const fixture of [
      { meta: VERMFLY_WITH_PHOTO, label: 'with-photo', stubImage: true },
      { meta: VERMFLY, label: 'no-photo', stubImage: false },
    ] as const) {
      test(`zero console errors+warnings: ${fixture.label} fixture at ${viewport.label} ${viewport.width}x${viewport.height}`, async ({ page, apiStub }) => {
        const errors: string[] = [];
        const warnings: string[] = [];
        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
          if (msg.type() === 'warning') warnings.push(msg.text());
        });

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await apiStub.stubEmpty();
        await apiStub.stubSpecies('vermfly', fixture.meta);
        if (fixture.stubImage) await apiStub.stubPhotoImage();

        const app = new AppPage(page);
        await app.goto('detail=vermfly&view=detail');
        await app.waitForAppReady();
        await expect(page.getByRole('heading', { name: 'Vermilion Flycatcher' }))
          .toBeVisible({ timeout: 10_000 });

        // Filter known third-party noise — tile/font 404s from the persistent
        // map chunk that the App preloads even on view=detail. These are
        // network-specific to the preview/dev environment and not owned by
        // this codebase. Same filter rule as map-symbol-layer.spec.ts.
        const ourErrors = errors.filter((e) =>
          !/tiles\.openfreemap\.org|fonts\.openfreemap/i.test(e),
        );
        const ourWarnings = warnings.filter((w) =>
          !/tiles\.openfreemap\.org|fonts\.openfreemap/i.test(w),
        );
        expect(ourErrors, `unexpected console errors: ${ourErrors.join('\n')}`).toEqual([]);
        expect(ourWarnings, `unexpected console warnings: ${ourWarnings.join('\n')}`).toEqual([]);
      });
    }
  }
});
