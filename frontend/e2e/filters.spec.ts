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

  // E4 (#1056): at the 390px mobile sheet breakpoint the filters form must read
  // and tap like a mobile form — each field full-width and ≥44px tall, the
  // "Notable only" control its own full-width tappable toggle row — instead of
  // a shrunken desktop inline form. The panel switches to the bottom sheet at
  // ≤480px (E2 #1054), so 390×844 is squarely in sheet mode.
  test.describe('mobile sheet form layout (390×844)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // The four interactive controls (the close button and datalist are not
    // measured). Each is scoped to the open panel via the FiltersBar POM.
    function controls() {
      return [app.filters.timeWindow, app.filters.family, app.filters.species];
    }

    test('every field is full-width and ≥44px tall, radius preserved', async ({ page }) => {
      const panel = page.getByRole('dialog', { name: 'Filters' });
      await expect(panel).toBeVisible();

      // Inner content width = the .filters-bar content box (panel inner minus the
      // panel's padding minus the bar's own padding) — the box the stacked fields
      // should span. Read padding off the live computed style so the assertion
      // tracks the tokens, not hard-coded literals.
      const bar = panel.locator('.filters-bar');
      const innerWidth = await bar.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      });

      for (const field of controls()) {
        await expect(field).toBeVisible();
        const box = await field.boundingBox();
        expect(box).not.toBeNull();
        // ≥44px coarse-pointer floor (WCAG 2.5.5 / Apple HIG).
        expect(box!.height).toBeGreaterThanOrEqual(44);
        // Full-width: spans the panel inner content width (allow 1px rounding).
        expect(box!.width).toBeGreaterThanOrEqual(innerWidth - 1);
        // #1041/#1043 radius ladder: inner inputs keep 4px — must NOT drift to
        // --card-radius-inner (8px) at mobile.
        const radius = await field.evaluate((el) =>
          window.getComputedStyle(el).borderRadius,
        );
        expect(radius).toBe('4px');
      }
    });

    test('the Notable only row is its own ≥44px tappable toggle row', async ({ page }) => {
      const panel = page.getByRole('dialog', { name: 'Filters' });
      await expect(panel).toBeVisible();

      // The toggle ROW is the <label> wrapping the checkbox.
      const row = panel.locator('label.filters-bar__toggle-row');
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      expect(rowBox).not.toBeNull();
      expect(rowBox!.height).toBeGreaterThanOrEqual(44);
      // Full-width row within the .filters-bar content box.
      const bar = panel.locator('.filters-bar');
      const innerWidth = await bar.evaluate((el) => {
        const cs = window.getComputedStyle(el);
        return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      });
      expect(rowBox!.width).toBeGreaterThanOrEqual(innerWidth - 1);

      // Tapping the ROW (not just the ~14px glyph) flips notable in the URL.
      expect(app.getUrlParams().get('notable')).toBeNull();
      // Click near the row's right edge — away from the checkbox glyph — to
      // prove the whole row is the tap target.
      await row.click({ position: { x: rowBox!.width - 12, y: rowBox!.height / 2 } });
      await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 }).toBe('true');
      // The POM's check/uncheck path stays green — round-trip back to default.
      await app.filters.toggleNotable(false);
      await expect.poll(() => app.getUrlParams().get('notable'), { timeout: 5_000 }).toBeNull();
    });
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
