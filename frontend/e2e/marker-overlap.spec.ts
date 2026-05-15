import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

/**
 * Marker overlap deconflict acceptance (issue #554).
 *
 * Drives the map to 6 deterministic zoom levels across 5 canonical
 * viewports (30 measurements total) and asserts zero pairwise rendered-
 * marker overlap area at each. The deconflict layer is the system under
 * test: it groups overlapping clusters via Union-Find on AABB
 * intersection and surfaces one anchor marker per group, NEVER two
 * overlapping markers on screen.
 *
 * Issue #554 scope expansion (2026-05-15): silhouettes from the
 * unclustered-point symbol layer are now first-class deconflict inputs.
 * When a silhouette would overlap a cluster anchor, deconflict shifts
 * it ≤20px aside via `displaceSilhouettes`; the canvas-painted twin is
 * hidden via the `hidden` feature-state (promoteId="subId"). This spec
 * combines DOM marker rects + symbol-layer feature rects (skipping
 * hidden ones) in the pairwise overlap measurement.
 */

const ZOOM_LEVELS = [5, 6, 8, 10, 12, 14];

const VIEWPORTS = [
  { name: 'iphone-14-pro', w: 390, h: 844 },
  { name: 'ipad-portrait', w: 768, h: 1024 },
  { name: 'ipad-landscape', w: 1024, h: 768 },
  { name: 'desktop-standard', w: 1440, h: 900 },
  { name: 'desktop-wide', w: 1920, h: 1080 },
] as const;

interface OverlapResult {
  marker_count: number;
  total_overlap_area: number;
  worst_overlap_area: number;
}

async function measureOverlap(page: Page): Promise<OverlapResult> {
  return await page.evaluate<OverlapResult>(() => {
    // DOM-based markers: AdaptiveGridMarker, ClusterPill, displaced silhouettes.
    const grids = Array.from(
      document.querySelectorAll('[data-testid="adaptive-grid-marker"]'),
    );
    const pills = Array.from(document.querySelectorAll('.cluster-pill'));
    const displacedSils = Array.from(
      document.querySelectorAll('[data-testid="displaced-silhouette"]'),
    );
    const domItems = [...grids, ...pills, ...displacedSils].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });

    // Canvas-rendered silhouettes (unclustered-point symbol layer) that
    // are NOT hidden by feature-state. The displacement path sets
    // `hidden: true` on a silhouette feature when its React twin is
    // shown by the displaced-silhouette overlay; both the spec and the
    // visual user agree those should not count toward overlap area.
    interface MapForTests {
      queryRenderedFeatures: (
        q: unknown,
        opts: { layers: string[] },
      ) => Array<{
        properties?: { subId?: string };
        geometry?: { type: 'Point'; coordinates: [number, number] };
      }>;
      getFeatureState: (s: object) => Record<string, unknown>;
      project: (ll: [number, number]) => { x: number; y: number };
    }
    const map = (window as unknown as { __mapForTests?: MapForTests })
      .__mapForTests;
    const symBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (map) {
      const symFeats = map.queryRenderedFeatures(undefined, {
        layers: ['unclustered-point'],
      });
      for (const f of symFeats) {
        const subId = f.properties?.subId;
        if (!subId) continue;
        const state = map.getFeatureState({
          source: 'observations',
          id: subId,
        });
        if (state?.hidden) continue;
        const geom = f.geometry;
        if (!geom || geom.type !== 'Point') continue;
        const [lng, lat] = geom.coordinates;
        const p = map.project([lng, lat]);
        // 28×28 silhouette extent (SILHOUETTE_PX), centered at projection.
        symBoxes.push({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 });
      }
    }

    const items = [...domItems, ...symBoxes];
    let total = 0;
    let worst = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        const ox = Math.max(
          0,
          Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
        );
        const oy = Math.max(
          0,
          Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y),
        );
        if (ox > 0 && oy > 0) {
          const area = ox * oy;
          total += area;
          if (area > worst) worst = area;
        }
      }
    }
    return {
      marker_count: items.length,
      total_overlap_area: total,
      worst_overlap_area: worst,
    };
  });
}

for (const viewport of VIEWPORTS) {
  for (const zoom of ZOOM_LEVELS) {
    test(`pairwise marker overlap = 0 at zoom ${zoom} on ${viewport.name} (${viewport.w}×${viewport.h})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.w, height: viewport.h });
      const app = new AppPage(page);
      await app.goto();
      await app.waitForAppReady();

      // Drive the map to the target zoom and let it settle.
      await page.evaluate((z) => {
        const map = (
          window as unknown as { __mapForTests?: { easeTo: (opts: object) => void } }
        ).__mapForTests;
        if (map) map.easeTo({ zoom: z, duration: 0 });
      }, zoom);
      // Brief settle window — the idle event fires after camera-change
      // + tile-load completes; a fixed delay is the project's existing
      // convention here.
      await page.waitForTimeout(500);

      const result = await measureOverlap(page);
      expect(
        result.total_overlap_area,
        `marker_count=${result.marker_count}, worst_overlap=${result.worst_overlap_area}px²`,
      ).toBe(0);
    });
  }
}
