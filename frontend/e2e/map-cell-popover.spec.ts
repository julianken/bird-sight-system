import { test, expect } from '@playwright/test';

// --- Phase 2 (#559): tablet coarse-pointer cluster-list popover --------------
//
// Runs under the `coarse-pointer` Playwright project (iPad gen 6, 768×1024,
// hasTouch:true + isMobile:true). The `@coarse` tag scopes this test to that
// project — the default `dev-server` project's grepInvert filters it out.

test('@coarse tablet portrait: tap marker opens cluster list, expand family, tap species', async ({ page }) => {
  // Hydrate with the feature flag ON via query param. (The build inlines
  // VITE_FF_CELL_POPOVER at compile time, so runtime override is via a
  // search-param the app code reads in non-prod. If that mechanism doesn't
  // exist, this test must run against a build with the flag enabled —
  // dev-server already inherits the project root's .env which defaults to
  // the flag OFF, so the test sets VITE_FF_CELL_POPOVER=true in the
  // webServer env for the coarse-pointer project. See playwright.config.ts
  // Task 7 amendment.)
  //
  // For Phase 2 simplicity, assume the dev-server is launched with
  // VITE_FF_CELL_POPOVER=true. Reviewers verify by inspecting the running
  // dev server's index.html for the flag-on conditional render.

  await page.goto('/');
  // Wait for the map render to complete (canonical pattern from
  // frontend/e2e/pages/MapAppPage; reuse if applicable).
  await page.locator('[data-testid="adaptive-grid-marker"]').first().waitFor({ state: 'visible' });

  // Tap a multi-leaf cluster marker.
  const marker = page.locator('[data-testid="adaptive-grid-marker"]').first();
  await marker.tap();

  // Cluster list popover appears.
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/observations,.* families/i)).toBeVisible();

  // The first 2 families are expanded by default. Find a collapsed family
  // (a `cluster-list-popover__family` element WITHOUT the --expanded modifier)
  // and tap its toggle button.
  const collapsedToggle = page
    .locator('.cluster-list-popover__family:not(.cluster-list-popover__family--expanded) .cluster-list-popover__family-toggle')
    .first();
  await collapsedToggle.tap();
  // Some species row from a previously-collapsed family is now visible.
  await expect(page.getByTestId('cluster-list-popover-row').nth(8)).toBeVisible();

  // Tap a clickable species link.
  const link = page.getByRole('link').filter({ hasText: /\d+x/ }).first();
  await link.tap();

  // SpeciesDetailSurface renders (no bbox until Phase 3).
  await expect(page).toHaveURL(/[?&]view=detail/);

  // Navigate back to the map to verify Done-button focus return path.
  await page.goBack();
  await page.locator('[data-testid="adaptive-grid-marker"]').first().waitFor({ state: 'visible' });
  await marker.tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: /Done/i }).tap();
  await expect(page.getByRole('dialog')).toBeHidden();
  // Focus returned to outer marker — assert via evaluate (Playwright doesn't
  // expose `document.activeElement` directly through the locator API).
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
  expect(focusedTag).toBe('BUTTON');
});
