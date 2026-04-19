import { test, expect, type Page } from '@playwright/test';

async function expandSantaRitas(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
  const region = page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]');
  await region.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
    .toHaveClass(/region-expanded/);
}

test.describe('region collapse', () => {
  test('clicking SVG background collapses', async ({ page }) => {
    await expandSantaRitas(page);
    // Dispatch a synthetic click directly on the <svg> element. The AZ viewBox
    // tiles all 9 regions densely enough that no coordinate is guaranteed to
    // land on bare SVG, so dispatchEvent bypasses hit-testing and guarantees
    // e.target === e.currentTarget (the exact condition Map.tsx guards).
    await page.locator('.bird-map').dispatchEvent('click');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .not.toHaveClass(/region-expanded/);
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('region=');
  });

  test('Enter on already-expanded region collapses', async ({ page }) => {
    await expandSantaRitas(page);
    const region = page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]');
    await region.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .not.toHaveClass(/region-expanded/);
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('region=');
  });

  test('clicking expanded region collapses', async ({ page }) => {
    await expandSantaRitas(page);
    // Same rationale as test 1: badge overlays can cover the region center, so
    // dispatch directly on the path element to guarantee it receives the click
    // regardless of hit-testing.
    await page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]').dispatchEvent('click');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .not.toHaveClass(/region-expanded/);
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('region=');
  });

  test('Escape collapses expanded region', async ({ page }) => {
    // test.fail asserts this test MUST fail. When Escape handling ships and
    // this test unexpectedly passes, CI turns red and the annotation must be
    // removed. test.fixme silently skips forever with no signal — do NOT use
    // it here.
    //
    // The planned handler is a document-level keydown listener in App.tsx
    // that calls onSelectRegion(null), clearing BOTH region and species from
    // the URL (matching App.tsx's onSelectRegion prop).
    test.fail();
    await expandSantaRitas(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .not.toHaveClass(/region-expanded/);
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('region=');
    await expect.poll(() => page.url(), { timeout: 5_000 }).not.toContain('species=');
  });
});
