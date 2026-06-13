import { test, expect, VERMFLY_OBS, SPECIES_DICT_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * F2 (#1062) — the filters anchored-card ↔ bottom-sheet switch lives at the
 * COMPACT placement boundary (≤480px), NOT a bespoke band.
 *
 * History: the switch was originally keyed to a bespoke 639px (`@media
 * (max-width: 639px)` in styles.css), which opened a 481–639px modality gap —
 * the filters rendered as a modal bottom sheet while an expanded, still-
 * clickable legend sat above the transparent backdrop. E2 (#1054) moved the CSS
 * switch 639→480; F2 (#1062) consolidated the whole breakpoint authority onto
 * 480/1024/1440 and converged the JS `legendForceCollapsed` phone signal
 * (`useBreakpoint() === 'compact'`, ≤480) on the SAME 480 threshold, closing the
 * gap for good.
 *
 * This spec is a regression guard for that convergence (new coverage — no prior
 * spec asserted the filters presentation inside the old 481–639 band; the only
 * e2e viewport there was legend-roomy-band-cap.spec.ts at 500×844, which never
 * opens filters). If a future edit reintroduces a >480 filters breakpoint, the
 * 560px case below flips to sheet-mode and this fails.
 *
 * Card vs sheet is read off layout geometry, not CSS internals:
 *   - Anchored card (>480px): width-capped (--card-maxw-rail), top-anchored,
 *     right-aligned — its left edge is well inside the viewport and its width is
 *     a fraction of the viewport.
 *   - Bottom sheet (≤480px): `inline-size: 100%`, `inset-inline: 0`,
 *     `inset-block-end: 0` — spans the full viewport width, left edge at 0,
 *     docked to the bottom.
 *
 * Repo e2e conventions: page.goto() via the POM; hermetic API stubs (no live DB);
 * no DB writes; no per-spec retries.
 */

test.describe('F2 #1062 — filters card↔sheet boundary at ≤480', () => {
  let app: AppPage;

  test.beforeEach(async ({ page, apiStub }) => {
    // Hermetic stubs — mirror filters.spec.ts so the typeahead/datalist never
    // touch the seeded DB.
    await apiStub.stubObservations(VERMFLY_OBS);
    await apiStub.stubSpeciesInScope(SPECIES_DICT_FIXTURE);
    await apiStub.stubSpeciesDictionary(SPECIES_DICT_FIXTURE);
    app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
  });

  // 560px is squarely inside the retired 481–639 band: pre-E2 this rendered as a
  // sheet, post-F2 it must be an anchored card.
  test.describe('560×844 (inside the retired 481–639 band)', () => {
    test.use({ viewport: { width: 560, height: 844 } });

    test('the filters surface is an anchored card, not a bottom sheet', async ({ page }) => {
      await app.openFilters();
      const panel = page.getByRole('dialog', { name: 'Filters' });
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();

      // Card: left edge is inset from the viewport's left (not 0) and the panel
      // does NOT span the full 560px viewport width — both are false for the
      // full-bleed sheet (inset-inline: 0; inline-size: 100%).
      expect(box!.x).toBeGreaterThan(8);
      expect(box!.width).toBeLessThan(560 - 16);

      // Card: top-anchored under the controls pill (well above mid-viewport),
      // unlike the sheet which docks to the bottom (top edge below mid-screen).
      expect(box!.y).toBeLessThan(844 / 2);
    });
  });

  // 390px stays sheet-mode either way — the lower bracket confirming the guard
  // reads a real boundary, not a constant.
  test.describe('390×844 (phone, sheet mode)', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the filters surface is a full-bleed bottom sheet', async ({ page }) => {
      await app.openFilters();
      const panel = page.getByRole('dialog', { name: 'Filters' });
      await expect(panel).toBeVisible();

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();

      // Sheet: spans the full viewport width, left edge at 0 (allow 1px rounding).
      expect(box!.x).toBeLessThanOrEqual(1);
      expect(box!.width).toBeGreaterThanOrEqual(390 - 1);

      // Sheet: bottom-docked — its bottom edge reaches the viewport floor.
      expect(box!.y + box!.height).toBeGreaterThan(844 - 4);
    });
  });
});
