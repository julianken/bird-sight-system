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

  test('row click navigates to detail surface without narrowing feed', async ({ page, apiStub }) => {
    await apiStub.stubSpecies('vermfly', VERMFLY);
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    // Click first feed row.
    await expect(page.locator('.feed-row').first()).toBeVisible({ timeout: 10_000 });
    await page.locator('.feed-row').first().click();

    // Should open the detail overlay. #663: new clicks write ?detail=
    // only — they do NOT set ?view=detail. The overlay renders over the
    // surface the user was on (here, feed).
    await expect.poll(() => new URL(page.url()).searchParams.get('detail'), { timeout: 5_000 })
      .toBeTruthy();
    await expect.poll(() => new URL(page.url()).searchParams.get('view'), { timeout: 5_000 })
      .toBe('feed');

    // species= filter param should NOT be set by a row click.
    const speciesParam = new URL(page.url()).searchParams.get('species');
    expect(speciesParam).toBeNull();
  });

  test('FiltersBar species commit narrows feed without opening detail', async ({ page, apiStub }) => {
    // /api/observations now (#627) returns aggregated buckets at low zoom;
    // synthetic obs carry family names as comName, so the species typeahead
    // needs a real-species observation stubbed in to resolve
    // "Vermilion Flycatcher" → "vermfly".
    await apiStub.stubObservations(VERMFLY_OBS);
    const app = new AppPage(page);
    await app.goto('view=feed');
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

    // detail= should NOT be set. View should stay on the feed dead-code
    // branch (preserved per #662 for legacy bookmark compatibility).
    expect(app.getUrlParams().get('detail')).toBeNull();
    expect(app.getUrlParams().get('view')).toBe('feed');

    // Feed tab removed in #662 and Species tab removed in #688. Only the
    // Map tab remains in the header; the ?view=feed URL state is preserved
    // for legacy bookmarks but no tab is selected on that surface.
    await expect(page.getByRole('tab', { name: 'Feed view' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Species view' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Map view' })).toHaveAttribute('aria-selected', 'false');
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
    await expect(page.getByRole('tab', { name: 'Map view' })).toHaveAttribute('aria-selected', 'true');
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

        // The photo render branch produces an <img> with alt="<comName> photo".
        // Ends-with match (`alt$=` style) via getByAltText regex avoids
        // collisions with any future alt text containing the species name.
        const photo = page.getByAltText('Vermilion Flycatcher photo');
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
        // Stub /phenology to an empty array — without this, the detail
        // surface's PhenologyChart would 404 against the dev server's
        // read-api (the endpoint isn't deployed yet) and emit a console
        // error that would fail this console-cleanliness assertion.
        await apiStub.stubPhenology('vermfly', []);
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
