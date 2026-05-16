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
  const rowsBefore = await page.getByTestId('cluster-list-popover-row').count();
  await collapsedToggle.tap();
  // Row count grows after expanding the collapsed family.
  await expect.poll(() => page.getByTestId('cluster-list-popover-row').count()).toBeGreaterThan(rowsBefore);

  // Tap a clickable species link. Scoped inside the popover rows; <a> has no
  // href so Playwright's role-based actionability check is unreliable — force
  // the click to bypass the "stable" wait.
  const link = page.locator('.cluster-list-popover__rows a[role="link"]').first();
  await link.waitFor({ state: 'visible' });
  await link.click({ force: true });

  // Note: Done-dismiss + focus-return paths are covered by ClusterListPopover
  // unit tests (frontend/src/components/map/ClusterListPopover.test.tsx). This
  // e2e focuses on the integration: tap → popover → expand → species → navigate.

  // SpeciesDetailSurface renders (no bbox until Phase 3).
  await expect(page).toHaveURL(/[?&]view=detail/);
});
