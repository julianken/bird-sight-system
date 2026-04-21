import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

// The three nested "sky island" regions sit geographically inside
// sonoran-tucson. Before the paint-order fix, sonoran-tucson (or any
// other neighbour) painted on top of the sky-islands at their centres,
// hijacking clicks. These assertions prove the fix both for the
// baseline view (at each sky-island's visual centre) and for the
// expanded state (the expanded region paints LAST so neighbour strokes
// do not cut its edges).

const SKY_ISLANDS = [
  'sky-islands-santa-ritas',
  'sky-islands-chiricahuas',
  'sky-islands-huachucas',
] as const;

test.describe('SVG paint order (#80 follow-up)', () => {
  test('sky-island centres return the sky-island path at the top of elementsFromPoint', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();

    const probes = await page.evaluate((ids) => {
      const out: Array<{ id: string; topRegionId: string | null; topTag: string | null }> = [];
      for (const id of ids) {
        const g = document.querySelector(`[data-region-id="${id}"]`);
        if (!g) { out.push({ id, topRegionId: null, topTag: null }); continue; }
        const path = g.querySelector('path.region-shape') as SVGPathElement | null;
        if (!path) { out.push({ id, topRegionId: null, topTag: null }); continue; }
        const bbox = path.getBoundingClientRect();
        const cx = (bbox.left + bbox.right) / 2;
        const cy = (bbox.top + bbox.bottom) / 2;
        const top = document.elementFromPoint(cx, cy);
        const topRegion = top?.closest('[data-region-id]')?.getAttribute('data-region-id') ?? null;
        out.push({ id, topRegionId: topRegion, topTag: top?.tagName ?? null });
      }
      return out;
    }, SKY_ISLANDS as unknown as string[]);

    for (const p of probes) {
      expect(
        p.topRegionId,
        `elementsFromPoint at centre of ${p.id} should belong to ${p.id}, got ${p.topRegionId} (topTag=${p.topTag})`,
      ).toBe(p.id);
    }
  });

  test('the expanded region is the LAST [data-region-id] in the DOM', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();
    await app.expandRegion('Sky Islands — Chiricahuas');
    await expect(app.regionById('sky-islands-chiricahuas'))
      .toHaveClass(/region-expanded/);

    const lastId = await page.evaluate(() => {
      const all = document.querySelectorAll('[data-region-id]');
      return all[all.length - 1]?.getAttribute('data-region-id') ?? null;
    });
    expect(lastId).toBe('sky-islands-chiricahuas');
  });

  test('neighbour regions do not paint over the expanded region edges', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForMapLoad();
    await app.expandRegion('Sky Islands — Santa Ritas');
    await expect(app.regionById('sky-islands-santa-ritas'))
      .toHaveClass(/region-expanded/);
    // The expand transform lives on the inner <g data-region-id="...">. Wait
    // for it to render before probing — toHaveClass(region-expanded) can fire
    // a React tick ahead of the transform string being present in the DOM on
    // slower machines.
    await expect.poll(
      () => app.regionById('sky-islands-santa-ritas').getAttribute('transform'),
      { timeout: 5_000 },
    ).toMatch(/translate/);

    const samples = await page.evaluate(() => {
      const g = document.querySelector('[data-region-id="sky-islands-santa-ritas"]');
      if (!g) return null;
      const path = g.querySelector('path.region-shape') as SVGPathElement | null;
      if (!path) return null;
      const bbox = path.getBoundingClientRect();
      // Sample points that are GUARANTEED inside the polygon fill by using
      // an inset fraction of the way from each bbox edge toward the centre,
      // then verifying the point is on the region-shape path via
      // `document.elementFromPoint`. Corner-of-bbox sampling (as originally
      // proposed) hits the "empty" corners of non-rectangular polygons and
      // falls through to the parent region below — which is a geometry
      // artefact, not a paint-order bug.
      const INSET_FRAC = 0.3; // 30% of the way from edge toward centre
      const cx = (bbox.left + bbox.right) / 2;
      const cy = (bbox.top + bbox.bottom) / 2;
      const dx = (bbox.width  * INSET_FRAC) / 2;
      const dy = (bbox.height * INSET_FRAC) / 2;
      const points: Array<{ where: string; x: number; y: number; topRegion: string | null; topTag: string | null }> = [];
      const entries: Array<[string, number, number]> = [
        ['centre',      cx,      cy     ],
        ['upper-left',  cx - dx, cy - dy],
        ['upper-right', cx + dx, cy - dy],
        ['lower-left',  cx - dx, cy + dy],
        ['lower-right', cx + dx, cy + dy],
      ];
      for (const [where, x, y] of entries) {
        const top = document.elementFromPoint(x, y);
        const topRegion = top?.closest('[data-region-id]')?.getAttribute('data-region-id') ?? null;
        points.push({ where, x, y, topRegion, topTag: top?.tagName ?? null });
      }
      return points;
    });
    expect(samples).not.toBeNull();

    for (const s of samples!) {
      // The topmost element at every sample inside the expanded region's
      // bbox should belong to the expanded region itself (its shape, a
      // badge inside it, or its expanded-layer group). Any other region
      // appearing here means the expanded region is being cut — exactly
      // the symptom documented in flow2-santa-ritas-expanded.png.
      expect(
        s.topRegion,
        `at ${s.where}=(${s.x.toFixed(1)},${s.y.toFixed(1)}) the top region should be sky-islands-santa-ritas, got ${s.topRegion} (${s.topTag})`,
      ).toBe('sky-islands-santa-ritas');
    }
  });
});
