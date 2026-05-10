import { test, expect } from '@playwright/test';

/**
 * Design-system primitive structural tests.
 *
 * Each test renders a primitive in isolation via the ?ds-preview=<key> shim
 * (frontend/src/dev/DsPreview.tsx — dev-only, import.meta.env.DEV gated).
 * Tests assert DOM structure, accessibility attributes, and text content.
 * No pixel snapshots — platform-rendering variance made those brittle.
 *
 * Viewports exercised: release-1 exit criteria (1440×900 desktop, 390×844 mobile).
 *
 * SortLabel: no ?ds-preview key exists for this primitive. It is covered by
 * its Vitest unit suite (src/components/ds/SortLabel.test.tsx). A future e2e
 * key would let us exercise it here — see follow-up issue.
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
  await page.waitForLoadState('networkidle');
}

// ─── <StatusBlock> ───────────────────────────────────────────────────────────

test.describe('<StatusBlock>', () => {
  // Loading state: role="status" aria-live="polite" on wrapper (from component);
  // skeleton present; progress bar present; no error/empty copy.
  test('loading state — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'status-loading');

    const block = page.locator('.status-block--state-loading');
    await expect(block).toBeVisible();
    // Wrapper carries role="status" + aria-live for SR announcements
    await expect(block).toHaveAttribute('role', 'status');
    await expect(block).toHaveAttribute('aria-live', 'polite');
    // Skeleton placeholder in DOM — aria-hidden="true" so Playwright sees it as
    // visually hidden; use toBeAttached() rather than toBeVisible() here.
    await expect(block.locator('.status-block__skeleton')).toBeAttached();
    await expect(block.locator('.status-block__skeleton')).toHaveAttribute('aria-hidden', 'true');
    // Indeterminate progress bar present and labelled
    const progress = block.locator('progress.status-block__progress');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute('aria-label', 'Loading, please wait');
    // Title text rendered
    await expect(block.locator('.status-block__title')).toHaveText('Loading observations…');
    // No error/empty class applied
    await expect(page.locator('.status-block--state-error')).not.toBeAttached();
    await expect(page.locator('.status-block--state-empty')).not.toBeAttached();
  });

  test('loading state — mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'status-loading');

    const block = page.locator('.status-block--state-loading');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('role', 'status');
    await expect(block.locator('.status-block__skeleton')).toBeAttached();
    await expect(block.locator('.status-block__skeleton')).toHaveAttribute('aria-hidden', 'true');
    const progress = block.locator('progress.status-block__progress');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute('aria-label', 'Loading, please wait');
  });

  // Empty state: no skeleton; expected title and body copy; action button present.
  test('empty state — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'status-empty');

    const block = page.locator('.status-block--state-empty');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('role', 'status');
    // No skeleton or progress in empty state
    await expect(block.locator('.status-block__skeleton')).not.toBeAttached();
    await expect(block.locator('progress')).not.toBeAttached();
    // Copy from DsPreview fixture
    await expect(block.locator('.status-block__title')).toHaveText('No sightings match your filters.');
    await expect(block.locator('.status-block__body')).toHaveText(
      'Try widening the time window or turning off Notable only.'
    );
    // Action button rendered with correct label
    const actionBtn = block.locator('.status-block__action');
    await expect(actionBtn).toBeVisible();
    await expect(actionBtn).toHaveText('Clear filters');
    await expect(actionBtn).toHaveAttribute('type', 'button');
  });

  test('empty state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'status-empty');
    await setDark(page);

    const block = page.locator('.status-block--state-empty');
    await expect(block).toBeVisible();
    await expect(block.locator('.status-block__skeleton')).not.toBeAttached();
    await expect(block.locator('.status-block__title')).toHaveText('No sightings match your filters.');
  });

  // Error state: tone class = alert; title and body; no skeleton; no action
  // (DsPreview fixture omits action for error). role="status" wraps; error
  // inherits the same container role as the other states.
  test('error state — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'status-error');

    const block = page.locator('.status-block--state-error');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('role', 'status');
    // Error state resolves to tone=alert via component logic
    await expect(block).toHaveClass(/status-block--tone-alert/);
    await expect(block.locator('.status-block__skeleton')).not.toBeAttached();
    await expect(block.locator('.status-block__title')).toHaveText("Couldn't load bird data");
    await expect(block.locator('.status-block__body')).toHaveText(
      'The data service is temporarily unavailable. Try again in a moment.'
    );
  });

  test('error state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'status-error');
    await setDark(page);

    const block = page.locator('.status-block--state-error');
    await expect(block).toBeVisible();
    await expect(block).toHaveClass(/status-block--tone-alert/);
    await expect(block.locator('.status-block__title')).toHaveText("Couldn't load bird data");
  });
});

// ─── <FamilySilhouette> ──────────────────────────────────────────────────────

test.describe('<FamilySilhouette>', () => {
  const families = [
    'raptor',
    'waterfowl',
    'woodpecker',
    'songbird',
    'shorebird',
    'hummingbird',
    'corvid',
  ] as const;

  // DsPreview passes ariaLabel="${family} silhouette" for each named family.
  // The SVG therefore carries role="img" + aria-label (not aria-hidden).
  for (const family of families) {
    test(`${family} — desktop`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await goToPreview(page, `silhouette-${family}`);

      const span = page.locator(`.family-silhouette--${family}`);
      await expect(span).toBeVisible();
      // SVG is present and carries the accessible label
      const svg = span.locator('svg');
      await expect(svg).toBeAttached();
      await expect(svg).toHaveAttribute('role', 'img');
      await expect(svg).toHaveAttribute('aria-label', `${family} silhouette`);
      // Path element present (shape is encoded, not empty)
      await expect(svg.locator('path')).toBeAttached();
      // Layout class applied (DsPreview uses layout="masthead")
      await expect(span).toHaveClass(/family-silhouette--masthead/);
    });

    test(`${family} — mobile dark`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await goToPreview(page, `silhouette-${family}`);
      await setDark(page);

      const span = page.locator(`.family-silhouette--${family}`);
      await expect(span).toBeVisible();
      const svg = span.locator('svg');
      await expect(svg).toHaveAttribute('role', 'img');
      await expect(svg).toHaveAttribute('aria-label', `${family} silhouette`);
    });
  }

  // null-family: class is family-silhouette--null-family
  // DsPreview passes ariaLabel="No-family silhouette"
  test('null-family — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'silhouette-null');

    const span = page.locator('.family-silhouette--null-family');
    await expect(span).toBeVisible();
    const svg = span.locator('svg');
    await expect(svg).toBeAttached();
    await expect(svg).toHaveAttribute('role', 'img');
    await expect(svg).toHaveAttribute('aria-label', 'No-family silhouette');
  });

  test('null-family — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'silhouette-null');
    await setDark(page);

    const span = page.locator('.family-silhouette--null-family');
    await expect(span).toBeVisible();
    await expect(span.locator('svg')).toHaveAttribute('aria-label', 'No-family silhouette');
  });
});

// ─── <Photo> ─────────────────────────────────────────────────────────────────

test.describe('<Photo>', () => {
  // null-src (woodpecker): Photo renders the silhouette span (.photo--silhouette)
  // containing a FamilySilhouette. The inner SVG is aria-hidden because Photo
  // does not pass ariaLabel to FamilySilhouette — the alt text on the Photo
  // is the a11y label for the containing context.
  test('null-src (woodpecker) — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-null-woodpecker');

    const photo = page.locator('.photo--silhouette');
    await expect(photo).toBeVisible();
    // No <img> element when silhouette is shown
    await expect(photo.locator('img')).not.toBeAttached();
    // Inner FamilySilhouette present
    await expect(photo.locator('.family-silhouette--woodpecker')).toBeVisible();
    // SVG is presentational in this context (no ariaLabel passed from Photo)
    const svg = photo.locator('svg');
    await expect(svg).toBeAttached();
    await expect(svg).toHaveAttribute('aria-hidden', 'true');
    // No skeleton when showing silhouette
    await expect(photo.locator('.photo__skeleton')).not.toBeAttached();
  });

  test('null-src (woodpecker) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-null-woodpecker');
    await setDark(page);

    const photo = page.locator('.photo--silhouette');
    await expect(photo).toBeVisible();
    await expect(photo.locator('img')).not.toBeAttached();
    await expect(photo.locator('.family-silhouette--woodpecker')).toBeVisible();
  });

  // null-src (null-family): same silhouette path but null-family variant
  test('null-src (null-family) — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-null-nullfamily');

    const photo = page.locator('.photo--silhouette');
    await expect(photo).toBeVisible();
    await expect(photo.locator('img')).not.toBeAttached();
    await expect(photo.locator('.family-silhouette--null-family')).toBeVisible();
  });

  test('null-src (null-family) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-null-nullfamily');
    await setDark(page);

    const photo = page.locator('.photo--silhouette');
    await expect(photo).toBeVisible();
    await expect(photo.locator('.family-silhouette--null-family')).toBeVisible();
  });

  // loaded state: DsPreview uses a 1×1 data-URI PNG and a 50ms delay before
  // handing it to Photo. We wait for .photo--loaded (state machine settles
  // after onLoad fires).
  test('loaded state — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'photo-loaded');

    const photo = page.locator('.photo--loaded');
    await expect(photo).toBeVisible({ timeout: 5000 });
    // <img> present with correct alt text (DsPreview sets alt="Preview bird")
    const img = photo.locator('img.photo__img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'Preview bird');
    // src is the data-URI placeholder (non-empty)
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\/png/);
    // Skeleton should be gone once loaded
    await expect(photo.locator('.photo__skeleton')).not.toBeAttached();
    // No silhouette class when loaded
    await expect(page.locator('.photo--silhouette')).not.toBeAttached();
  });

  test('loaded state — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'photo-loaded');
    await setDark(page);

    const photo = page.locator('.photo--loaded');
    await expect(photo).toBeVisible({ timeout: 5000 });
    const img = photo.locator('img.photo__img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', 'Preview bird');
  });
});

// ─── <ClusterPill> ───────────────────────────────────────────────────────────

test.describe('<ClusterPill>', () => {
  // Tier thresholds are encoded in cluster.ts; the preview fixtures use
  // count values from DsPreview: sky=50, sand=200, ember=900.
  // aria-label pattern: "{count} sightings" per component contract.

  test('sky tier (count=50) — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-sky');

    const pill = page.locator('.cluster-pill--sky');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('role', 'img');
    await expect(pill).toHaveAttribute('aria-label', '50 sightings');
    await expect(pill).toHaveAttribute('tabindex', '0');
    await expect(pill).toHaveText('50');
  });

  test('sky tier (count=50) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-sky');
    await setDark(page);

    const pill = page.locator('.cluster-pill--sky');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-label', '50 sightings');
    await expect(pill).toHaveText('50');
  });

  test('sand tier (count=200) — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-sand');

    const pill = page.locator('.cluster-pill--sand');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('role', 'img');
    await expect(pill).toHaveAttribute('aria-label', '200 sightings');
    await expect(pill).toHaveText('200');
  });

  test('sand tier (count=200) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-sand');
    await setDark(page);

    const pill = page.locator('.cluster-pill--sand');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-label', '200 sightings');
  });

  test('ember tier (count=900) — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'cluster-ember');

    const pill = page.locator('.cluster-pill--ember');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('role', 'img');
    await expect(pill).toHaveAttribute('aria-label', '900 sightings');
    await expect(pill).toHaveText('900');
  });

  test('ember tier (count=900) — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'cluster-ember');
    await setDark(page);

    const pill = page.locator('.cluster-pill--ember');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('aria-label', '900 sightings');
  });
});

// ─── <FilterSentence> ────────────────────────────────────────────────────────

test.describe('<FilterSentence>', () => {
  // filter-notable: filters = { notable: true, since: '14d' }
  // Expected sentence: "Showing notable sightings from the last 14 days."
  // The always-mounted live region (role="status" aria-live="polite") is
  // independent of the visible sentence element.

  test('notable filter — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'filter-notable');

    const visible = page.locator('.filter-sentence__visible');
    await expect(visible).toBeVisible();
    // Full sentence text (joined across spans)
    await expect(visible).toContainText('notable sightings');
    await expect(visible).toContainText('14 days');
    // Always-mounted live region: role="status" + aria-live="polite" + aria-atomic
    const liveRegion = page.locator('.filter-sentence-live');
    await expect(liveRegion).toBeAttached();
    await expect(liveRegion).toHaveAttribute('role', 'status');
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    await expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
  });

  test('notable filter — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'filter-notable');
    await setDark(page);

    const visible = page.locator('.filter-sentence__visible');
    await expect(visible).toBeVisible();
    await expect(visible).toContainText('notable sightings');
    await expect(visible).toContainText('14 days');
  });

  // filter-notable-family: filters = { notable: true, familyCode: 'woodpeckers', since: '14d' }
  // Expected terms: "notable sightings, woodpeckers"
  test('notable + family filter — desktop', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await goToPreview(page, 'filter-notable-family');

    const visible = page.locator('.filter-sentence__visible');
    await expect(visible).toBeVisible();
    await expect(visible).toContainText('notable sightings');
    await expect(visible).toContainText('woodpeckers');
    await expect(visible).toContainText('14 days');
    // Both filter terms should appear as .filter-bullet spans
    const bullets = visible.locator('.filter-bullet');
    await expect(bullets).toHaveCount(2);
    await expect(bullets.nth(0)).toHaveText('notable sightings');
    await expect(bullets.nth(1)).toHaveText('woodpeckers');
    // Live region structure
    const liveRegion = page.locator('.filter-sentence-live');
    await expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    await expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    await expect(liveRegion).toHaveAttribute('aria-relevant', 'text');
  });

  test('notable + family filter — mobile dark', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await goToPreview(page, 'filter-notable-family');
    await setDark(page);

    const visible = page.locator('.filter-sentence__visible');
    await expect(visible).toBeVisible();
    await expect(visible).toContainText('notable sightings');
    await expect(visible).toContainText('woodpeckers');
    const bullets = visible.locator('.filter-bullet');
    await expect(bullets).toHaveCount(2);
  });
});

/**
 * NOTE — <SortLabel> e2e coverage gap:
 * The DsPreview shim has no ?ds-preview key for <SortLabel>.
 * Structural assertions are already covered by the Vitest unit suite at
 * frontend/src/components/ds/SortLabel.test.tsx.
 * A follow-up issue should add a `sort-label` preview key to DsPreview.tsx
 * and a corresponding test block here. The gap is intentional and tracked,
 * not silently skipped.
 */
