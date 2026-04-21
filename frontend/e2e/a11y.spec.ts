import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

test.describe('accessibility', () => {
  // Region expand via Space/Enter (map-only behaviour) moved out with
  // the map chain in #113; keyboard-activated region regressions will
  // be re-asserted against the feed/hotspot surfaces as those land in
  // #116/#117. The tab-order and aria-busy checks below still exercise
  // the ever-green chrome (FiltersBar + SurfaceNav + <main>).
  test.skip('Space key also expands a region (not only Enter)', () => {
    // #113 deleted the map; surface-specific tests land in #117 (hotspots)
    // and #118 (species search).
  });

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
    // buttons with aria-label="Feed view" / "Species view" / "Hotspots view".
    const firstSurfaceTabIdx = visited.findIndex(s =>
      s.includes('Feed view') || s.includes('Species view') || s.includes('Hotspots view'),
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
          return true;
        })
        .map(el => el.outerHTML.slice(0, 200));
    });
    expect(unlabelled).toEqual([]);
  });
});
