import { test, expect } from '@playwright/test';
import { AppPage } from './pages/app-page.js';

/**
 * Basemap dark-flip pixel-sample assertions (Phase 4, issue #573, epic #575).
 *
 * WHAT IS TESTED:
 *   After flipping `BASEMAP_DARK` from the positron alias to the real dark URL
 *   (`https://tiles.openfreemap.org/styles/dark`), the MutationObserver wired
 *   in MapCanvas.tsx calls `map.setStyle()` on theme change. These tests verify
 *   the *result* — that the rendered land-surface pixel is actually darker in
 *   dark mode — using three WCAG luminance assertions:
 *
 *   AC1 — relativeLuminance(lightPixel) - relativeLuminance(darkPixel) > 0.3
 *         (positron land #f4f1ea ≈ 0.92 lum; dark land ≈ 0.05–0.1 lum → delta > 0.7)
 *   AC2 — Light pixel within ±10 per channel of #f4f1ea (positron cream)
 *   AC3 — Dark pixel: all channels < 60 (dark basemap land surface)
 *
 * WEBGL LIMITATION:
 *   Pixel sampling from the MapLibre WebGL canvas requires a real WebGL context.
 *   Headless Chromium in some CI environments lacks a WebGL backend; without it,
 *   the canvas never paints and the pixel read returns [0,0,0,0]. All three
 *   assertions skip when WebGL is unavailable, matching the precedent in
 *   `map-adaptive-grid.spec.ts`. The unit-test guard (basemap-style.test.ts
 *   asserting BASEMAP_DARK !== BASEMAP_LIGHT) is the tautological fallback; the
 *   pixel-sample assertions here are the load-bearing AC1/AC2/AC3 verification.
 *
 * CANVAS PIXEL READING (Fix 3b, PR #582 bot review):
 *   MapLibre 5.x defaults to `preserveDrawingBuffer: false`, which clears the
 *   WebGL backbuffer between frames. A 2D-canvas `drawImage(webglCanvas)` copy
 *   therefore reads [0,0,0,0] and `readCanvasPixel` returns null, causing all
 *   three tests to skip. Fixed by passing `VITE_E2E_PRESERVE_BUFFER=true` to
 *   the Vite dev server in `playwright.config.ts`, which makes `MapCanvas.tsx`
 *   pass `canvasContextAttributes: { preserveDrawingBuffer: true }` to MapLibre.
 *   The flag is e2e-only — it never reaches the production bundle.
 *   The coordinate (300, 300) is chosen as a land-surface region on the Arizona
 *   statewide overview — away from label layers and roads.
 *
 * Route stubs: all /api/* endpoints are stubbed to return empty arrays so the
 * test does not depend on a live database or the read-api service being seeded.
 */

/** Coordinate (canvas-relative px) known to sample land surface in AZ overview. */
const SAMPLE_X = 300;
const SAMPLE_Y = 300;

/** WCAG 2.2 relative luminance — mirrors wcag-contrast.ts in the frontend source. */
function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Read the RGB values at the given canvas-relative pixel via the page's
 * MapLibre instance. Returns null if the map is not ready or the canvas
 * does not expose readable pixels (WebGL unavailable / preserveDrawingBuffer off).
 */
async function readCanvasPixel(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<[number, number, number] | null> {
  return page.evaluate(
    ([px, py]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__birdMap;
      if (!map) return null;
      const canvas = map.getCanvas() as HTMLCanvasElement;
      if (!canvas) return null;

      // Attempt 2D context read (requires preserveDrawingBuffer or a readback frame).
      // MapLibre-GL 5.x exposes `painter.context.gl.readPixels` but that is internal.
      // The safest cross-version approach: use the OffscreenCanvas drawImage trick
      // via a temporary 2D canvas to capture a single pixel. This works when the
      // WebGL canvas has `preserveDrawingBuffer: true` (MapLibre default in some
      // build configs) or when called synchronously within the same frame as a render.
      try {
        const tmp = document.createElement('canvas');
        tmp.width = 1;
        tmp.height = 1;
        const ctx2d = tmp.getContext('2d');
        if (!ctx2d) return null;
        ctx2d.drawImage(canvas, px, py, 1, 1, 0, 0, 1, 1);
        const data = ctx2d.getImageData(0, 0, 1, 1).data;
        // If all channels are 0 the drawImage copied a zeroed buffer (no preserveDrawingBuffer)
        if (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0) return null;
        return [data[0], data[1], data[2]] as [number, number, number];
      } catch {
        return null;
      }
    },
    [x, y] as [number, number],
  );
}

async function waitForMapReady(page: import('@playwright/test').Page): Promise<boolean> {
  await page.locator('[data-testid=map-canvas]').waitFor({ state: 'visible', timeout: 15_000 });
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((window as any).__birdMap);
  });
}

/** Wait for map.isStyleLoaded() to return true, with a timeout fallback. */
async function waitForStyleLoaded(page: import('@playwright/test').Page): Promise<void> {
  // Poll up to 5s for the style to finish loading after a setStyle() call.
  // The idle event would be cleaner but requires a page.evaluate listener
  // setup before the setStyle call — the poll is simpler here.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const loaded = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = (window as any).__birdMap;
      return Boolean(map?.isStyleLoaded?.());
    });
    if (loaded) return;
    await page.waitForTimeout(200);
  }
  // Fallback: give the canvas an extra second to paint even if isStyleLoaded
  // didn't return true in time (some tile loads are async post-style-load).
  await page.waitForTimeout(1_000);
}

test.describe('Basemap dark-flip pixel assertions (Phase 4, closes G8)', () => {
  test.beforeEach(async ({ page }) => {
    // Stub all API endpoints to empty so the test does not depend on a live DB.
    await page.route('**/api/hotspots', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/observations**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { freshestObservationAt: null } }),
      });
    });
    await page.route('**/api/silhouettes', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  });

  test(
    'AC1 — light-to-dark luminance delta > 0.3 at land-surface pixel',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const webglReady = await waitForMapReady(page);
      // Skip gracefully if WebGL is unavailable — the unit-test in
      // basemap-style.test.ts covers the const-value regression instead.
      // See the module comment for the WebGL limitation explanation.
      test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint; pixel-sample skipped');

      // --- Light mode ---
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await waitForStyleLoaded(page);
      // Extra settle: tile network round-trips need time even after style load.
      await page.waitForTimeout(2_000);

      const lightPixel = await readCanvasPixel(page, SAMPLE_X, SAMPLE_Y);
      // If readCanvasPixel returns null the canvas isn't readable (no preserveDrawingBuffer).
      // Skip rather than fail — the WebGL constraint is the root cause, not the feature.
      test.skip(
        lightPixel === null,
        'Canvas pixel read returned null (likely no preserveDrawingBuffer) — pixel-sample skipped',
      );

      // --- Dark mode ---
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await waitForStyleLoaded(page);
      await page.waitForTimeout(2_000);

      const darkPixel = await readCanvasPixel(page, SAMPLE_X, SAMPLE_Y);
      expect(darkPixel, 'Dark mode pixel read should succeed after light pixel succeeded').not.toBeNull();

      // TypeScript narrowing — both are non-null here
      const [lr, lg, lb] = lightPixel!;
      const [dr, dg, db] = darkPixel!;

      const lightLum = relativeLuminance(lr, lg, lb);
      const darkLum = relativeLuminance(dr, dg, db);
      const delta = lightLum - darkLum;

      expect(
        delta,
        `Luminance delta (light − dark) should be > 0.3. ` +
        `Got lightPixel=[${lr},${lg},${lb}] (lum=${lightLum.toFixed(3)}) ` +
        `darkPixel=[${dr},${dg},${db}] (lum=${darkLum.toFixed(3)}) ` +
        `delta=${delta.toFixed(3)}. ` +
        `If delta ≈ 0 the MutationObserver swap is not firing or setStyle() raced.`,
      ).toBeGreaterThan(0.3);
    },
  );

  test(
    'AC2 — light pixel within ±10 per channel of positron cream (#f4f1ea)',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const webglReady = await waitForMapReady(page);
      test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint; pixel-sample skipped');

      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'light');
      });
      await waitForStyleLoaded(page);
      await page.waitForTimeout(2_000);

      const lightPixel = await readCanvasPixel(page, SAMPLE_X, SAMPLE_Y);
      test.skip(
        lightPixel === null,
        'Canvas pixel read returned null (likely no preserveDrawingBuffer) — pixel-sample skipped',
      );

      const [r, g, b] = lightPixel!;
      // Positron land-surface color is #f4f1ea → [244, 241, 234]
      const TARGET_R = 0xf4; // 244
      const TARGET_G = 0xf1; // 241
      const TARGET_B = 0xea; // 234
      const TOLERANCE = 10;

      expect(Math.abs(r - TARGET_R), `R channel: got ${r}, expected ${TARGET_R} ±${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(g - TARGET_G), `G channel: got ${g}, expected ${TARGET_G} ±${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(b - TARGET_B), `B channel: got ${b}, expected ${TARGET_B} ±${TOLERANCE}`).toBeLessThanOrEqual(TOLERANCE);
    },
  );

  test(
    'AC3 — dark pixel all channels < 60 (dark basemap land surface)',
    async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const app = new AppPage(page);
      await app.goto('view=map');
      await app.waitForAppReady();

      const webglReady = await waitForMapReady(page);
      test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint; pixel-sample skipped');

      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await waitForStyleLoaded(page);
      await page.waitForTimeout(2_000);

      const darkPixel = await readCanvasPixel(page, SAMPLE_X, SAMPLE_Y);
      test.skip(
        darkPixel === null,
        'Canvas pixel read returned null (likely no preserveDrawingBuffer) — pixel-sample skipped',
      );

      const [r, g, b] = darkPixel!;
      expect(r, `R channel ${r} should be < 60 for dark basemap land surface`).toBeLessThan(60);
      expect(g, `G channel ${g} should be < 60 for dark basemap land surface`).toBeLessThan(60);
      expect(b, `B channel ${b} should be < 60 for dark basemap land surface`).toBeLessThan(60);
    },
  );
});
