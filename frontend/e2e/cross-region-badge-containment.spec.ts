import { test, expect } from '@playwright/test';

/**
 * Issue #94 — two-pass map rendering (shapes layer, then badges overlay).
 *
 * Two tests:
 *   1. Three named layers exist as direct children of `svg.bird-map`, in
 *      paint order: shapes → badges → hotspots. This is the structural
 *      guarantee that makes cross-region bleed impossible.
 *   2. No badge centre sits inside any FOREIGN region's polygon interior
 *      at baseline. A bbox-only check would false-positive: adjacent
 *      peers like sonoran-phoenix and mogollon-rim share a boundary so
 *      their bboxes overlap, and a badge placed at the top of
 *      sonoran-phoenix's inscribed rect can land inside mogollon-rim's
 *      bbox yet still sit outside mogollon-rim's polygon interior (which
 *      is what the user actually sees painted). Polygon-interior is the
 *      property that matters for bleed regressions; bbox was too strict.
 *      Polygon-exact own-region containment is already enforced by
 *      `badge-containment.spec.ts` (#59); this spec extends that check
 *      to every foreign region so cross-region regressions surface
 *      immediately.
 */
test.describe('two-pass render (#94)', () => {
  test('three named layers exist as direct children of svg.bird-map, in paint order', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });

    const layerClasses = await page.evaluate(() => {
      const svg = document.querySelector('svg.bird-map');
      if (!svg) return null;
      return Array.from(svg.children).map(g => g.getAttribute('class'));
    });

    expect(layerClasses).toEqual(['shapes-layer', 'badges-layer', 'hotspots-layer']);
  });

  test('no badge centre sits inside any foreign region polygon at baseline', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-region-id]')).toHaveCount(9, { timeout: 15_000 });
    // Wait for observations so badges render.
    await expect(page.locator('.map-wrap'))
      .toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });

    const offenders = await page.evaluate(() => {
      // Inlined parser mirroring frontend/src/geo/path.ts. Absolute M/L only
      // matches the seed grammar — any other command is silently dropped.
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

      // Collect { regionId → polygon } from the shapes layer. Polygon is
      // the same M/L vertex list used by badge-containment.spec.ts.
      type Polygon = Array<{ x: number; y: number }>;
      type BBox = { minX: number; maxX: number; minY: number; maxY: number };
      function bboxOf(points: Polygon): BBox | null {
        if (points.length === 0) return null;
        let minX = points[0]!.x, maxX = points[0]!.x;
        let minY = points[0]!.y, maxY = points[0]!.y;
        for (const p of points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return { minX, maxX, minY, maxY };
      }
      const regionPoly: Record<string, Polygon> = {};
      const regionBbox: Record<string, BBox> = {};
      const regionPaths = document.querySelectorAll(
        '.shapes-layer [data-region-id] path.region-shape',
      );
      for (const pathEl of regionPaths) {
        const g = pathEl.closest('[data-region-id]');
        if (!g) continue;
        const regionId = g.getAttribute('data-region-id');
        if (!regionId) continue;
        const d = pathEl.getAttribute('d') ?? '';
        const pts = parsePoints(d);
        regionPoly[regionId] = pts;
        const bbox = bboxOf(pts);
        if (bbox) regionBbox[regionId] = bbox;
      }

      // Precompute the parent set for each region. A region is a parent
      // of the owner iff the owner's bbox is (strictly or equally)
      // contained in the foreign region's bbox. bbox-based is deliberate:
      // the Arizona seed has sky-island polygons whose vertices sit on
      // sonoran-tucson's boundary (x=360 right edge), and standard ray-
      // casting point-in-polygon is ambiguous on boundary coincidences —
      // bbox-containment is robust to that. The exclusion is documented
      // as "nested-by-bbox" rather than "nested-by-geometry"; false
      // negatives would surface as real offenders in the issue list.
      function bboxContains(outer: BBox, inner: BBox): boolean {
        return (
          outer.minX <= inner.minX &&
          outer.maxX >= inner.maxX &&
          outer.minY <= inner.minY &&
          outer.maxY >= inner.maxY
        );
      }
      const parentsOf: Record<string, Set<string>> = {};
      for (const ownerId of Object.keys(regionBbox)) {
        const parents = new Set<string>();
        const ownerBbox = regionBbox[ownerId]!;
        for (const otherId of Object.keys(regionBbox)) {
          if (otherId === ownerId) continue;
          if (bboxContains(regionBbox[otherId]!, ownerBbox)) {
            parents.add(otherId);
          }
        }
        parentsOf[ownerId] = parents;
      }

      // For every badge, check that its centre is NOT inside any
      // foreign, non-parent region's polygon interior. The owner region
      // is excluded (own-region containment is asserted by
      // badge-containment.spec.ts); any parent region of the owner is
      // excluded because owner-inside-parent nesting is by design.
      // Polygon interior is the paint-surface the user sees — unlike a
      // bbox check this correctly handles adjacent peers whose bboxes
      // overlap but whose polygons do not (e.g. sonoran-phoenix and
      // mogollon-rim share a boundary so their bboxes overlap, but the
      // polygons are disjoint interiors).
      const issues: Array<{
        ownerRegion: string;
        foreignRegion: string;
        cx: number;
        cy: number;
      }> = [];
      const badges = document.querySelectorAll(
        '.badges-layer [data-region-badges-for] .badge',
      );
      for (const badge of badges) {
        const ownerG = badge.closest('[data-region-badges-for]');
        const ownerRegion = ownerG?.getAttribute('data-region-badges-for') ?? '';
        const transform = badge.getAttribute('transform') ?? '';
        const m = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
        if (!m) continue;
        const cx = parseFloat(m[1]!);
        const cy = parseFloat(m[2]!);
        const parents = parentsOf[ownerRegion] ?? new Set<string>();
        for (const [foreignId, polygon] of Object.entries(regionPoly)) {
          if (foreignId === ownerRegion) continue;
          if (parents.has(foreignId)) continue;
          if (pointInPolygon(cx, cy, polygon)) {
            issues.push({ ownerRegion, foreignRegion: foreignId, cx, cy });
          }
        }
      }
      return issues;
    });

    // Document the offenders for quick debugging if the assertion ever
    // fires — otherwise each failure would just say "expected [] to equal
    // []".
    expect(offenders, `badge centres crossing foreign region polygons: ${JSON.stringify(offenders, null, 2)}`).toEqual([]);
  });
});
