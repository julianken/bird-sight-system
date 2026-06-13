import { test, expect, VERMFLY_OBS, SPECIES_DICT_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.describe('filter flows', () => {
  let app: AppPage;

  test.beforeEach(async ({ page, apiStub }) => {
    // /api/observations returns aggregated buckets at low zoom (#627), which
    // carry no per-observation rows — #859 moved species aggregation
    // server-side and deleted the synthetic-observation expansion the
    // frontend used to fabricate from buckets. The species typeahead derives
    // from per-observation (comName, speciesCode) pairs, so it needs a real
    // per-observation payload to resolve "Vermilion Flycatcher" → "vermfly";
    // stub before navigation.
    await apiStub.stubObservations(VERMFLY_OBS);
    // D2 (#1050): the FiltersBar species index is now dictionary-backed (bare
    // GET /api/species). Stub it so the datalist + typeahead stay hermetic —
    // without it these specs would silently hit the live seeded DB. The one
    // fixture row resolves "Vermilion Flycatcher" → "vermfly".
    await apiStub.stubSpeciesDictionary(SPECIES_DICT_FIXTURE);
    app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    // Phase 3: FiltersBar is inside a panel triggered from AppHeader.
    // Open it once in beforeEach so all filter locators resolve.
    await app.openFilters();
  });

  test('time window select updates URL and respects default-omit', async () => {
    await app.filters.selectTimeWindow('1d');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBe('1d');
    await app.filters.selectTimeWindow('14d');
    await expect.poll(() => app.getUrlParams().get('since'), { timeout: 5_000 }).toBeNull();
  });

  test('family select updates URL when options exist', async () => {
    const count = await app.filters.family.locator('option').count();
    test.skip(count <= 1, 'species_meta is empty — no families to filter by');

    const firstValue = await app.filters.family.locator('option').nth(1).getAttribute('value');
    expect(firstValue).toBeTruthy();
    await app.filters.selectFamily(firstValue!);
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 }).toBe(firstValue);

    await app.filters.family.selectOption({ label: 'All families' });
    await expect.poll(() => app.getUrlParams().get('family'), { timeout: 5_000 }).toBeNull();
  });

  test('species input does not commit on keystroke (draft isolation + no-match blur)', async ({ page }) => {
    await app.filters.species.focus();
    // Wait for the dictionary-backed datalist to populate before committing —
    // a no-match verdict is deliberately DEFERRED while the dictionary is still
    // loading (#1050: a verdict against an empty index would be a false hint),
    // so the visible-hint assertion below requires the settled state. Mirrors
    // the exact-match specs' datalist-attached gate.
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });
    await app.filters.setSpecies('Vermilio'); // partial, no exact match

    // Draft only — URL should not have species param yet.
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 3_000 }).toBeNull();

    await app.filters.species.blur();
    // After blur with no exact match, URL still has no species param.
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBeNull();

    // D2 (#1050) C78: the no-match commit must NOT be silent — a visible inline
    // status hint appears, scoped to the (national) dictionary index, and the
    // typed value is kept in the field (never a silent clear).
    const hint = page.getByRole('status').filter({ hasText: /No species matching/i });
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('No species matching "Vermilio"');
    await expect(app.filters.species).toHaveValue('Vermilio');
  });

  test('species input commits exact match on blur', async ({ page }) => {
    await app.filters.species.focus();
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });
    await app.filters.setSpecies('Vermilion Flycatcher');
    await app.filters.species.blur();
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');
  });

  test('species input commits on Enter', async ({ page }) => {
    await app.filters.species.focus();
    await expect(page.locator('datalist#species-options option').first()).toBeAttached({ timeout: 10_000 });
    await app.filters.setSpecies('Vermilion Flycatcher');
    await page.keyboard.press('Enter');
    await expect.poll(() => app.getUrlParams().get('species'), { timeout: 5_000 }).toBe('vermfly');
  });

  // O4 (#780): floating-sheet modality — map-box unchanged + backdrop/Escape dismiss.
  test('opening filters does not change the map-layer box (no layout displacement)', async ({ page }) => {
    // Get the map-layer bounding box with the panel already open (openFilters
    // fires in beforeEach). The box must not differ from the closed state —
    // position:fixed means the map-layer never re-flows regardless of the panel.
    const mapLayer = page.locator('#map-layer');
    await mapLayer.waitFor({ state: 'attached' });
    const boxOpen = await mapLayer.boundingBox();
    expect(boxOpen).not.toBeNull();

    // Close via close button, re-check dimensions.
    await page.getByRole('button', { name: /Close filters/i }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).not.toBeVisible();
    const boxClosed = await mapLayer.boundingBox();
    expect(boxClosed).not.toBeNull();

    // The map-layer box must not change between open and closed.
    expect(boxOpen!.x).toBeCloseTo(boxClosed!.x, 0);
    expect(boxOpen!.y).toBeCloseTo(boxClosed!.y, 0);
    expect(boxOpen!.width).toBeCloseTo(boxClosed!.width, 0);
    expect(boxOpen!.height).toBeCloseTo(boxClosed!.height, 0);
  });

  test('backdrop click dismisses the filters panel', async ({ page }) => {
    // Panel is open from beforeEach.
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

    // Click the backdrop (data-testid="filters-backdrop").
    await app.filtersBackdrop.click();

    // Panel should no longer be visible.
    await expect(page.getByRole('dialog', { name: 'Filters' })).not.toBeVisible();
    // Backdrop should also be gone (conditionally rendered).
    await expect(app.filtersBackdrop).not.toBeAttached();
  });

  test('Escape key dismisses the filters panel', async ({ page }) => {
    // Panel is open from beforeEach.
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Filters' })).not.toBeVisible();
  });

  // B2 (#1041): dark-mode filter controls must render themed — not native UA white.
  // Asserts that the time-window <select> background is the themed --color-bg-surface
  // (#1b2742 = rgb(27, 39, 66)) rather than the browser's default white/lightgray.
  // Pattern after basemap-dark-flip.spec.ts:264 — setAttribute, not prefers-color-scheme
  // emulation (the repo uses [data-theme] which overrides the media query).
  test('dark mode: time-window select has themed background (not native white UA chrome)', async ({ page }) => {
    // Panel is already open from beforeEach.
    // Flip theme to dark.
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });

    const select = app.filters.timeWindow;
    await expect(select).toBeVisible();

    const bg = await select.evaluate((el) =>
      window.getComputedStyle(el).backgroundColor,
    );

    // --color-bg-surface dark = #1b2742 = rgb(27, 39, 66).
    // Any browser-default white (rgb(255, 255, 255)) or lightgray would fail here.
    expect(bg).toBe('rgb(27, 39, 66)');
  });
});
