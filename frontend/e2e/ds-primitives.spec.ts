import { test, expect } from '@playwright/test';

/**
 * Design-system primitive snapshot tests.
 *
 * Each test renders a primitive in isolation via the ?ds-preview=<key> shim
 * (frontend/src/dev/DsPreview.tsx — dev-only, import.meta.env.DEV gated).
 * Tests capture snapshots at desktop (1440×900) and mobile (390×844) in
 * light and dark mode for every primitive.
 *
 * Viewports: release-1 exit criteria (1440×900 desktop, 390×844 mobile).
 * Themes: [data-theme] attr toggled via page.evaluate — same mechanism
 *   as the Phase 1 boot-theme.ts + ThemeToggle.tsx contract.
 *
 * Snapshot baselines: frontend/e2e/snapshots/ds-primitives/
 * Regenerate: npm run test:e2e --workspace @bird-watch/frontend -- ds-primitives --update-snapshots
 *
 * Spec: docs/plans/2026-05-09-sky-atlas-phase-2-primitives.md (Task 8)
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function setDark(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
}

// Helper: navigate to the preview page and wait for the primitive to mount
async function goToPreview(page: import('@playwright/test').Page, key: string) {
  await page.goto(`/?ds-preview=${key}`);
  // Wait for React to hydrate — the DsPreview root renders synchronously
  // but React's async scheduling means we need a brief stability window.
  await page.waitForLoadState('networkidle');
}

// ─── <StatusBlock> ───────────────────────────────────────────────────────────

test.describe('<StatusBlock> snapshots', () => {
  test('loading state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToPreview(page, 'status-loading');
    // Freeze the indeterminate <progress> animation (Chromium native spinner
    // is non-deterministic; freeze via animation-play-state + appearance reset).
    await page.addStyleTag({
      content: 'progress { animation: none !important; appearance: none !important; background: #e0e0e0 !important; }',
    });
    await expect(page.locator('.status-block--state-loading')).toBeVisible();
    await expect(page.locator('.status-block--state-loading')).toHaveScreenshot(
      'status-block-loading-desktop-light.png'
    );
  });

  test('loading state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goToPreview(page, 'status-loading');
    // Freeze the indeterminate <progress> animation
    await page.addStyleTag({
      content: 'progress { animation: none !important; appearance: none !important; background: #e0e0e0 !important; }',
    });
    await setDark(page);
    await expect(page.locator('.status-block--state-loading')).toBeVisible();
    await expect(page.locator('.status-block--state-loading')).toHaveScreenshot(
      'status-block-loading-mobile-dark.png'
    );
  });

  test('empty state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'status-empty');
    await expect(page.locator('.status-block--state-empty')).toBeVisible();
    await expect(page.locator('.status-block--state-empty')).toHaveScreenshot(
      'status-block-empty-desktop-light.png'
    );
  });

  test('empty state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'status-empty');
    await setDark(page);
    await expect(page.locator('.status-block--state-empty')).toBeVisible();
    await expect(page.locator('.status-block--state-empty')).toHaveScreenshot(
      'status-block-empty-mobile-dark.png'
    );
  });

  test('error state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'status-error');
    await expect(page.locator('.status-block--state-error')).toBeVisible();
    await expect(page.locator('.status-block--state-error')).toHaveScreenshot(
      'status-block-error-desktop-light.png'
    );
  });

  test('error state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'status-error');
    await setDark(page);
    await expect(page.locator('.status-block--state-error')).toBeVisible();
    await expect(page.locator('.status-block--state-error')).toHaveScreenshot(
      'status-block-error-mobile-dark.png'
    );
  });
});

// ─── <FamilySilhouette> ──────────────────────────────────────────────────────

test.describe('<FamilySilhouette> snapshots', () => {
  const families = ['raptor', 'waterfowl', 'woodpecker', 'songbird', 'shorebird', 'hummingbird', 'corvid'];

  for (const family of families) {
    test(`${family} — desktop light`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await goToPreview(page, `silhouette-${family}`);
      await expect(page.locator(`.family-silhouette--${family}`)).toBeVisible();
      await expect(page.locator(`.family-silhouette--${family}`)).toHaveScreenshot(
        `silhouette-${family}-desktop-light.png`
      );
    });

    test(`${family} — mobile dark`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await goToPreview(page, `silhouette-${family}`);
      await setDark(page);
      await expect(page.locator(`.family-silhouette--${family}`)).toBeVisible();
      await expect(page.locator(`.family-silhouette--${family}`)).toHaveScreenshot(
        `silhouette-${family}-mobile-dark.png`
      );
    });
  }

  test('null-family — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'silhouette-null');
    await expect(page.locator('.family-silhouette--null-family')).toBeVisible();
    await expect(page.locator('.family-silhouette--null-family')).toHaveScreenshot(
      'silhouette-null-family-desktop-light.png'
    );
  });

  test('null-family — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'silhouette-null');
    await setDark(page);
    await expect(page.locator('.family-silhouette--null-family')).toBeVisible();
    await expect(page.locator('.family-silhouette--null-family')).toHaveScreenshot(
      'silhouette-null-family-mobile-dark.png'
    );
  });
});

// ─── <Photo> ─────────────────────────────────────────────────────────────────

test.describe('<Photo> snapshots', () => {
  test('no-photo (src=null, woodpecker) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-null-woodpecker');
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-woodpecker-desktop-light.png'
    );
  });

  test('no-photo (src=null, woodpecker) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-null-woodpecker');
    await setDark(page);
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-woodpecker-mobile-dark.png'
    );
  });

  test('no-photo (src=null, null-family) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-null-nullfamily');
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-nullfamily-desktop-light.png'
    );
  });

  test('no-photo (src=null, null-family) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-null-nullfamily');
    await setDark(page);
    await expect(page.locator('.photo--silhouette')).toBeVisible();
    await expect(page.locator('.photo--silhouette')).toHaveScreenshot(
      'photo-null-nullfamily-mobile-dark.png'
    );
  });

  test('loaded state — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-loaded');
    await expect(page.locator('.photo--loaded')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.photo--loaded')).toHaveScreenshot(
      'photo-loaded-desktop-light.png'
    );
  });

  test('loaded state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-loaded');
    await setDark(page);
    await expect(page.locator('.photo--loaded')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.photo--loaded')).toHaveScreenshot(
      'photo-loaded-mobile-dark.png'
    );
  });
});

// ─── <ClusterPill> ───────────────────────────────────────────────────────────

test.describe('<ClusterPill> snapshots', () => {
  test('sky tier (count=50) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-sky');
    await expect(page.locator('.cluster-pill--sky')).toBeVisible();
    await expect(page.locator('.cluster-pill--sky')).toHaveScreenshot(
      'cluster-pill-sky-desktop-light.png'
    );
  });

  test('sky tier (count=50) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-sky');
    await setDark(page);
    await expect(page.locator('.cluster-pill--sky')).toBeVisible();
    await expect(page.locator('.cluster-pill--sky')).toHaveScreenshot(
      'cluster-pill-sky-mobile-dark.png'
    );
  });

  test('sand tier (count=200) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-sand');
    await expect(page.locator('.cluster-pill--sand')).toBeVisible();
    await expect(page.locator('.cluster-pill--sand')).toHaveScreenshot(
      'cluster-pill-sand-desktop-light.png'
    );
  });

  test('sand tier (count=200) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-sand');
    await setDark(page);
    await expect(page.locator('.cluster-pill--sand')).toBeVisible();
    await expect(page.locator('.cluster-pill--sand')).toHaveScreenshot(
      'cluster-pill-sand-mobile-dark.png'
    );
  });

  test('ember tier (count=900) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-ember');
    await expect(page.locator('.cluster-pill--ember')).toBeVisible();
    await expect(page.locator('.cluster-pill--ember')).toHaveScreenshot(
      'cluster-pill-ember-desktop-light.png'
    );
  });

  test('ember tier — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-ember');
    await setDark(page);
    await expect(page.locator('.cluster-pill--ember')).toBeVisible();
    await expect(page.locator('.cluster-pill--ember')).toHaveScreenshot(
      'cluster-pill-ember-mobile-dark.png'
    );
  });
});

// ─── <FilterSentence> ────────────────────────────────────────────────────────

test.describe('<FilterSentence> snapshots', () => {
  test('1 filter (notable) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'filter-notable');
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-notable-desktop-light.png'
    );
  });

  test('1 filter (notable) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'filter-notable');
    await setDark(page);
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-notable-mobile-dark.png'
    );
  });

  test('2 filters (notable + family) — desktop light', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'filter-notable-family');
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-two-filters-desktop-light.png'
    );
  });

  test('2 filters (notable + family) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'filter-notable-family');
    await setDark(page);
    await expect(page.locator('.filter-sentence__visible')).toBeVisible();
    await expect(page.locator('.filter-sentence__visible')).toHaveScreenshot(
      'filter-sentence-two-filters-mobile-dark.png'
    );
  });
});
