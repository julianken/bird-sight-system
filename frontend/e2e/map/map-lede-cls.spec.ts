import { test, expect } from '@playwright/test';

/**
 * CLS regression test for the map orientation lede (issue #510).
 *
 * Issue #510: Map CLS regressed 0.068 → 0.172 (POOR) on mobile after
 * W2 #471 added the `.map-lede` rule. The original `<h1 class="map-lede">` was
 * an in-flow element that shifted from UA-default 32px/bold to 26px/semibold
 * after stylesheet hydration, causing CLS > 0.1.
 *
 * V2 re-baseline (#787 / O3 #779 / #800): the lede moved out of the in-flow
 * `.map-context-strip` band (now removed — see styles.css) into the AppHeader
 * identity card as `<p class="app-header-lede" data-testid="map-lede">`, which
 * is inside a `position:fixed` corner card. Document-flow CLS no longer applies
 * — the element never participates in block layout. CLS <= 0.1 holds without the
 * old inline-critical-CSS workaround. The 26px font-size assertion is removed:
 * the lede in the fixed identity card renders at --type-sm, not 26px.
 *
 * Acceptance (post-O3):
 * - CLS <= 0.1 (Good) on mobile 390x844
 * - CLS <= 0.1 (Good) on desktop 1440x900
 * - [data-testid="map-lede"] is visible after observations resolve
 *
 * Spec ref: /Users/j/.claude/plans/execute-the-sky-atlas-reflective-rabin.md §Bundle B B3
 * Closes: #510 / V2 re-baseline: #787
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

test.describe('map-lede CLS regression — #510 (V2 re-baseline #787)', () => {
  /**
   * Task 0 / acceptance criterion: CLS ≤ 0.1 on mobile 390×844.
   *
   * Pre-fix: UA-default h1 styles (32px / 0.67em margin) shifted to
   * final values when stylesheet hydrated, producing CLS ≈ 0.172 (POOR).
   *
   * Post-#800: the lede moved into the AppHeader identity card
   * (<p data-testid="map-lede"> inside a position:fixed card). Document-flow
   * layout shift no longer applies — CLS should be ≤ 0.1 (Good) without the
   * old inline-critical-CSS workaround. Font-size assertion removed: the lede
   * in the fixed identity card renders at --type-sm (not the old 26px h1 size).
   */
  test('mobile (390×844): CLS ≤ 0.1 (#510 — now position:fixed card)', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await injectLsObserver(page);

    // #738 — bare URL now lands unscoped (chooser, no lede). The CLS contract
    // this spec guards only applies to a scoped map surface, so navigate to
    // the whole-US escape hatch.
    await page.goto('/?scope=us');
    await page.waitForLoadState('networkidle');

    // #800: lede is now [data-testid="map-lede"] in the AppHeader identity card.
    const lede = page.locator('[data-testid="map-lede"]');
    await expect(lede).toBeVisible({ timeout: 10_000 });

    const cls = await collectCLS(page);
    // eslint-disable-next-line no-console
    console.log(`[#510 CLS mobile] score=${cls.score.toFixed(4)} entries=${JSON.stringify(cls.entries)}`);

    // ACCEPTANCE CRITERION
    expect(cls.score).toBeLessThanOrEqual(0.1);
  });

  test('desktop (1440×900): CLS ≤ 0.1 — no regression', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await injectLsObserver(page);

    // #738 — see mobile case: scope to whole-US so the lede renders.
    await page.goto('/?scope=us');
    await page.waitForLoadState('networkidle');

    // #800: lede is now [data-testid="map-lede"] in the AppHeader identity card.
    const lede = page.locator('[data-testid="map-lede"]');
    await expect(lede).toBeVisible({ timeout: 10_000 });

    const cls = await collectCLS(page);
    // eslint-disable-next-line no-console
    console.log(`[#510 CLS desktop] score=${cls.score.toFixed(4)} entries=${JSON.stringify(cls.entries)}`);

    expect(cls.score).toBeLessThanOrEqual(0.1);
  });
});
