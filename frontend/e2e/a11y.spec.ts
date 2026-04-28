import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('accessibility', () => {
  test('Tab reaches every filter before any surface-interactive element', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

    // Collect the first 20 focused elements after tabbing from body.
    // Budget is wide enough to survive seed changes that shift filter /
    // SurfaceNav tab positions.
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

    // Positively identify the four filters.
    const FILTER_SIGNATURES = ['Time window', 'Notable only', 'Family', 'Species'];
    const timeWindowIdx = visited.findIndex(s => s.includes('Time window'));
    const notableIdx = visited.findIndex(s => s.includes('Notable only'));
    const familyIdx = visited.findIndex(s => s.includes('Family'));
    const speciesIdx = visited.findIndex(s => s.includes('Species'));

    expect(timeWindowIdx, 'Time window filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(notableIdx, 'Notable only filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(familyIdx, 'Family filter must be tabbable').toBeGreaterThanOrEqual(0);
    expect(speciesIdx, 'Species filter must be tabbable').toBeGreaterThanOrEqual(0);

    // Every filter must come before the first SurfaceNav tab. Tabs are
    // buttons with aria-label="Feed view" / "Species view" / "Map view".
    const firstSurfaceTabIdx = visited.findIndex(s =>
      s.includes('Feed view') || s.includes('Species view') || s.includes('Map view'),
    );
    if (firstSurfaceTabIdx >= 0) {
      expect(
        Math.max(timeWindowIdx, notableIdx, familyIdx, speciesIdx),
        'all four filters must come before any SurfaceNav tab',
      ).toBeLessThan(firstSurfaceTabIdx);
    }

    void FILTER_SIGNATURES; // keep the doc-ref for grepability
  });

  test('aria-busy flips from true to false when data loads', async ({ page }) => {
    await page.goto('/');
    // Race: the mount effect kicks off a fetch, and we may miss the `true` state
    // if the network is very fast. Accept either ordering, but we MUST end on 'false'.
    await expect.poll(
      () => page.locator('main#main-surface').getAttribute('aria-busy'),
      { timeout: 10_000 }
    ).toBe('false');
  });

  test('every input, select, button, role=button, link, or textarea has an accessible label', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();

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
          // Anchors and buttons can derive their accessible name from inner
          // text content per the HTML AccName algorithm. Adding the
          // SurfaceFooter eBird credit (#243) introduced the first such
          // text-only link in the app, exposing this gap. Allow non-empty
          // text content as a valid accname source — but ONLY for the
          // interactive roles where AccName treats textContent as valid.
          // For <select>, <input>, <textarea>, textContent is NOT a valid
          // accname source (#260): <select>.textContent returns concatenated
          // option text, <textarea>.textContent returns initial content —
          // both are truthy even for unlabelled controls.
          const isAccnameTextRole =
            el.tagName === 'A' ||
            el.tagName === 'BUTTON' ||
            el.getAttribute('role') === 'button';
          if (!isAccnameTextRole) return true;
          const text = (el.textContent ?? '').trim();
          if (text) return false;
          return true;
        })
        .map(el => el.outerHTML.slice(0, 200));
    });
    expect(unlabelled).toEqual([]);
  });
});
