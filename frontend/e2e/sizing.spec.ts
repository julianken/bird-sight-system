import { test, expect } from '@playwright/test';

/**
 * Issue #92 — badge sizing uniformity.
 *
 * For every collapsed region:
 *   - intra-region `<circle class="badge-circle">` `r` values match
 *     (cross-region variance is intended polygon-aware sizing per #59;
 *     intra-region variance would be a regression);
 *   - when an overflow pip is present, pip `r` equals badge `r`.
 *
 * Pre-ticket state: the fallback path sized the pip at `Math.max(5, r*0.4)`
 * while the grid path used `r={r}`. On the live map this rendered
 * Colorado-Plateau + Mogollon pips matching their badges, and all seven
 * other regions' pips at r=6 next to r=15 badges. After the unification
 * both paths use the grid-path policy.
 */
test.describe('badge sizing (#92)', () => {
  test('intra-region badge r uniform and overflow-pip r matches badge r', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    const stats = await page.evaluate(() => {
      // After #94 the badges live in a sibling `.badges-layer` wrapper,
      // not inside the `[data-region-id]` wrapper. Look up each region's
      // badges via `data-region-badges-for="<id>"` and read the overflow
      // pip from the same wrapper.
      const out: Array<{ id: string; badgeRs: number[]; pipR: number | null }> = [];
      for (const shapeG of document.querySelectorAll('.shapes-layer [data-region-id]')) {
        if (shapeG.classList.contains('region-expanded')) continue;
        const id = shapeG.getAttribute('data-region-id') ?? 'unknown';
        const badgeG = document.querySelector(
          `.badges-layer [data-region-badges-for="${id}"]`,
        );
        const rs = Array.from(badgeG?.querySelectorAll('circle.badge-circle') ?? [])
          .map(c => parseFloat(c.getAttribute('r') ?? '0'));
        const pip = badgeG?.querySelector('[data-role="overflow-pip"] circle');
        out.push({
          id,
          badgeRs: rs,
          pipR: pip ? parseFloat(pip.getAttribute('r') ?? '0') : null,
        });
      }
      return out;
    });

    const withBadges = stats.filter(s => s.badgeRs.length > 0);
    expect(withBadges.length).toBeGreaterThan(0);

    for (const { id, badgeRs } of stats) {
      if (badgeRs.length < 2) continue;
      const spread = Math.max(...badgeRs) - Math.min(...badgeRs);
      expect(
        spread,
        `${id} intra-region badge-r spread (rs=${JSON.stringify(badgeRs)})`,
      ).toBeLessThanOrEqual(0);
    }

    for (const { id, badgeRs, pipR } of stats) {
      if (pipR === null || badgeRs.length === 0) continue;
      expect(
        pipR,
        `${id} pipR=${pipR} vs badgeR=${badgeRs[0]}`,
      ).toBe(badgeRs[0]);
    }
  });

  test('overflow-pip fontSize is exactly 9 (matches Badge chip at scale=1)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    const fontSizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-role="overflow-pip"] text'))
        .map(t => t.getAttribute('font-size')),
    );
    // At least one overflow pip should render on the collapsed map (ticket
    // #92 table: 8 of 9 regions ship a pip). Fail loud if none — means
    // fixtures changed or the overflow path is broken.
    expect(fontSizes.length).toBeGreaterThan(0);
    for (const f of fontSizes) {
      expect(f).toBe('9');
    }
  });
});
