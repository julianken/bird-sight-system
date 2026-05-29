import { test, expect } from '@playwright/test';

/**
 * CLS regression test for .map-lede font-size stability.
 *
 * Issue #510: Map CLS regressed 0.068 → 0.172 (POOR) on mobile after
 * W2 #471 added the `.map-lede` rule. The `<h1>` renders at UA default
 * ~32px bold with 0.67em top/bottom margins before CSS applies, then shifts
 * to 26px semibold with margin reset — the height change causes CLS > 0.1 on
 * mobile where the font wraps across more lines at the narrow viewport.
 *
 * Fix: inline critical `.map-lede` styles in `<head>` of index.html so the
 * element is already sized correctly at first paint, before any external CSS
 * or JS executes.
 *
 * Acceptance:
 * - CLS ≤ 0.1 (Good) on mobile 390×844
 * - `.map-lede` computed font-size is 26px (no regression from #471 typography fix)
 * - No desktop regression
 *
 * Spec ref: /Users/j/.claude/plans/execute-the-sky-atlas-reflective-rabin.md §Bundle B B3
 * Closes: #510
 */

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** Type helper for layout-shift PerformanceEntry fields not yet in TypeScript lib. */
type LayoutShiftEntry = PerformanceEntry & { hadRecentInput: boolean; value: number };

/** Window augmentation used by addInitScript payload. */
type WindowWithLsEntries = typeof window & {
  __lsEntries: { value: number; hadRecentInput: boolean; startTime: number }[];
};

/**
 * Injects a PerformanceObserver before navigation that captures all
 * layout-shift entries into `window.__lsEntries` from the earliest paint.
 * Must be called before `page.goto`.
 */
async function injectLsObserver(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as WindowWithLsEntries).__lsEntries = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const ls = entry as LayoutShiftEntry;
        (window as WindowWithLsEntries).__lsEntries.push({
          value: ls.value,
          hadRecentInput: ls.hadRecentInput,
          startTime: entry.startTime,
        });
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
  });
}

/** Read accumulated CLS from the injected observer. */
async function collectCLS(
  page: import('@playwright/test').Page,
): Promise<{ score: number; entries: { value: number; hadRecentInput: boolean; startTime: number }[] }> {
  return page.evaluate(() => {
    const entries = (window as WindowWithLsEntries).__lsEntries;
    const score = entries.filter((e) => !e.hadRecentInput).reduce((acc, e) => acc + e.value, 0);
    return { score, entries };
  });
}

test.describe('.map-lede CLS regression — #510', () => {
  /**
   * Task 0 / acceptance criterion: CLS ≤ 0.1 on mobile 390×844.
   *
   * Pre-fix: UA-default h1 styles (32px / 0.67em margin) shift to
   * final values (26px / 0 0 12px 0) when the stylesheet hydrates,
   * producing CLS ≈ 0.172 (POOR).
   *
   * Post-fix: inline critical CSS in <head> ensures the element is sized
   * correctly at first paint — no shift, CLS ≤ 0.1.
   */
  test('mobile (390×844): CLS ≤ 0.1 and .map-lede font-size stable at 26px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await injectLsObserver(page);

    // #738 — bare URL now lands unscoped (chooser, no `.map-lede`). The
    // critical-CSS/CLS contract this spec guards only applies to a scoped
    // map surface, so navigate to the whole-US escape hatch.
    await page.goto('/?scope=us');
    await page.waitForLoadState('networkidle');

    // .map-lede must be visible and sized correctly
    const lede = page.locator('h1.map-lede');
    await expect(lede).toBeVisible({ timeout: 10_000 });

    // Final font-size must be 26px (typography contract from #471 preserved)
    const fontSize = await lede.evaluate((el) => window.getComputedStyle(el).fontSize);
    expect(fontSize).toBe('26px');

    const cls = await collectCLS(page);
    // eslint-disable-next-line no-console
    console.log(`[#510 CLS mobile] score=${cls.score.toFixed(4)} entries=${JSON.stringify(cls.entries)}`);

    // ACCEPTANCE CRITERION
    expect(cls.score).toBeLessThanOrEqual(0.1);
  });

  test('desktop (1440×900): CLS ≤ 0.1 — no regression', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await injectLsObserver(page);

    // #738 — see mobile case: scope to whole-US so the `.map-lede` renders.
    await page.goto('/?scope=us');
    await page.waitForLoadState('networkidle');

    const lede = page.locator('h1.map-lede');
    await expect(lede).toBeVisible({ timeout: 10_000 });

    const fontSize = await lede.evaluate((el) => window.getComputedStyle(el).fontSize);
    expect(fontSize).toBe('26px');

    const cls = await collectCLS(page);
    // eslint-disable-next-line no-console
    console.log(`[#510 CLS desktop] score=${cls.score.toFixed(4)} entries=${JSON.stringify(cls.entries)}`);

    expect(cls.score).toBeLessThanOrEqual(0.1);
  });
});
