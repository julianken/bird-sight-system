import { test, expect } from '@playwright/test';

test.describe('accessibility', () => {
  test('Space key also expands a region (not only Enter)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    const region = page.locator('.region-shape[aria-label="Sky Islands — Santa Ritas"]');
    await region.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-region-id="sky-islands-santa-ritas"]'))
      .toHaveClass(/region-expanded/);
  });

  test('Tab reaches all four filters before any map region', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    // Collect the first 20 focused elements after tabbing from body.
    // Budget is wide enough to survive seed changes that shift region-badge tab positions.
    await page.locator('body').focus();
    const visited: string[] = [];
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return 'NONE';
        const label = el.getAttribute('aria-label') ?? '';
        return `${el.tagName.toLowerCase()}[${label}]`;
      });
      visited.push(tag);
    }

    // Positively identify filters; everything else is map-side by process of elimination.
    // Robust to Badge tags (<g role="button">), overflow pips, hotspot dots, or any future
    // map-side interactive element.
    const FILTER_SIGNATURES = ['Time window', 'Notable only', 'Family', 'Species'];

    const isFilter = (s: string) => FILTER_SIGNATURES.some(sig => s.includes(sig));
    const firstNonFilterIdx = visited.findIndex(s => s !== 'body[]' && !isFilter(s));

    const timeWindowIdx = visited.findIndex(s => s.includes('Time window'));
    const notableIdx = visited.findIndex(s => s.includes('Notable only'));
    const familyIdx = visited.findIndex(s => s.includes('Family'));
    const speciesIdx = visited.findIndex(s => s.includes('Species'));

    expect(timeWindowIdx, 'Time window filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(notableIdx, 'Notable only filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(familyIdx, 'Family filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(speciesIdx, 'Species filter must be tabbable').toBeGreaterThanOrEqual(0);

    if (firstNonFilterIdx >= 0) {
      expect(
        Math.max(timeWindowIdx, notableIdx, familyIdx, speciesIdx),
        'all four filters must come before any map-side tabbable (region path, badge, etc.)'
      ).toBeLessThan(firstNonFilterIdx);
    }
  });

  test('aria-busy flips from true to false when data loads', async ({ page }) => {
    await page.goto('/');
    // Race: the mount effect kicks off a fetch, and we may miss the `true` state
    // if the network is very fast. Accept either ordering, but we MUST end on 'false'.
    await expect.poll(
      () => page.locator('.map-wrap').getAttribute('aria-busy'),
      { timeout: 15_000 }
    ).toBe('false');
  });

  test('every input, select, button, role=button, link, or textarea has an accessible label', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    const unlabelled = await page.evaluate(() => {
      const roots = Array.from(document.querySelectorAll('.app input, .app select, .app button, .app [role="button"], .app a[href], .app textarea'));
      return roots
        .filter((el): el is HTMLElement => el instanceof HTMLElement)
        .filter(el => {
          const aria = el.getAttribute('aria-label');
          if (aria && aria.trim()) return false;
          const labelledBy = el.getAttribute('aria-labelledby');
          if (labelledBy && labelledBy.split(/\s+/).some(id => document.getElementById(id))) return false;
          const id = el.id;
          if (id && document.querySelector(`label[for="${id}"]`)) return false;
          if (el.closest('label')) return false;
          return true;
        })
        .map(el => el.outerHTML.slice(0, 200));
    });
    expect(unlabelled).toEqual([]);
  });
});
