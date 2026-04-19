import { test, expect } from '@playwright/test';

/**
 * Issue #59 — badges must not overflow their region polygon.
 *
 * For each rendered region (9 in the seed), pull the polygon `d` + each
 * badge's translate-centre + radius out of the DOM and run the
 * centre-to-nearest-edge containment check in the page. A centre inside
 * the polygon AND distance-to-edge ≥ badge radius proves the full badge
 * disc is contained (AC #1 of the issue).
 *
 * The check runs client-side (via `page.evaluate`) because it needs the
 * same SVG coordinate system the DOM uses and because Playwright's
 * cross-browser matrix reports transform strings consistently. We read
 * the translate string directly rather than computing a getBoundingClientRect
 * so a single expanded region (with a translate+scale on the parent <g>)
 * doesn't skew the numbers — expanded regions are excluded from the
 * check because the expand transform scales the polygon UP, which keeps
 * the AC property (any in-polygon layout stays in-polygon after a
 * uniform scale).
 */
test.describe('badge containment (#59)', () => {
  test('every collapsed-region badge disc fits inside its region polygon', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    // Wait for observations to load so badges render. `.map-wrap` toggles
    // aria-busy=false when all queries resolve.
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    // Collect (regionId, polygon-d, badge list with cx/cy/r) from the DOM.
    const audit = await page.evaluate(() => {
      // Parser copied from frontend/src/geo/path.ts — inlined to keep this
      // spec self-contained in the browser context.
      function parsePoints(d: string): Array<{ x: number; y: number }> {
        const tokens = d.split(/[\s,]+/).filter(Boolean);
        const points: Array<{ x: number; y: number }> = [];
        let i = 0;
        while (i < tokens.length) {
          const t = tokens[i];
          if (t === 'M' || t === 'L') {
            const x = parseFloat(tokens[i + 1] ?? '0');
            const y = parseFloat(tokens[i + 2] ?? '0');
            points.push({ x, y });
            i += 3;
          } else {
            i += 1;
          }
        }
        return points;
      }

      function pointInPolygon(
        x: number,
        y: number,
        polygon: Array<{ x: number; y: number }>,
      ): boolean {
        let inside = false;
        const n = polygon.length;
        if (n < 3) return false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = polygon[i]!.x, yi = polygon[i]!.y;
          const xj = polygon[j]!.x, yj = polygon[j]!.y;
          const intersect =
            ((yi > y) !== (yj > y)) &&
            (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }

      function distanceToEdge(
        px: number,
        py: number,
        polygon: Array<{ x: number; y: number }>,
      ): number {
        let min = Infinity;
        const n = polygon.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const ax = polygon[j]!.x, ay = polygon[j]!.y;
          const bx = polygon[i]!.x, by = polygon[i]!.y;
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const cx = ax + t * dx;
          const cy = ay + t * dy;
          const d = Math.hypot(px - cx, py - cy);
          if (d < min) min = d;
        }
        return min;
      }

      const results: Array<{
        regionId: string;
        badges: Array<{
          cx: number;
          cy: number;
          r: number;
          distToEdge: number;
          inside: boolean;
        }>;
      }> = [];

      const regions = document.querySelectorAll('[data-region-id]');
      for (const region of regions) {
        const regionId = region.getAttribute('data-region-id')!;
        // Skip expanded regions — their parent <g> carries a translate+scale
        // that changes the coordinate system; the collapsed view is the one
        // the issue is about.
        if (region.classList.contains('region-expanded')) continue;
        const path = region.querySelector('path.region-shape');
        const d = path?.getAttribute('d') ?? '';
        const polygon = parsePoints(d);

        const badges = region.querySelectorAll('.badge');
        const badgeData: Array<{ cx: number; cy: number; r: number; distToEdge: number; inside: boolean }> = [];
        for (const badge of badges) {
          const transform = badge.getAttribute('transform') ?? '';
          const m = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
          if (!m) continue;
          const cx = parseFloat(m[1]!);
          const cy = parseFloat(m[2]!);
          const circle = badge.querySelector('circle.badge-circle');
          const r = parseFloat(circle?.getAttribute('r') ?? '0');
          const dist = distanceToEdge(cx, cy, polygon);
          const inside = pointInPolygon(cx, cy, polygon);
          badgeData.push({ cx, cy, r, distToEdge: dist, inside });
        }
        results.push({ regionId, badges: badgeData });
      }

      return results;
    });

    // At least one region should have badges; fail loud if no region does
    // (means fixtures didn't load — regression signal).
    const withBadges = audit.filter(r => r.badges.length > 0);
    expect(withBadges.length).toBeGreaterThan(0);

    for (const region of audit) {
      for (const badge of region.badges) {
        // Centre must be inside the polygon.
        expect(badge.inside, `centre of a badge in region ${region.regionId} must be inside the polygon (cx=${badge.cx}, cy=${badge.cy})`).toBe(true);
        // Disc test: distance from centre to nearest edge ≥ radius. Allow
        // a 0.5px slack for sub-pixel rasterisation on the grid sample.
        expect(
          badge.distToEdge,
          `badge in region ${region.regionId} overflows polygon edge: centre=(${badge.cx},${badge.cy}) r=${badge.r} distToEdge=${badge.distToEdge}`,
        ).toBeGreaterThanOrEqual(badge.r - 0.5);
      }
    }
  });
});
