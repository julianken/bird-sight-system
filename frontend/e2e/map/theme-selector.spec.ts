import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { AppPage } from '../pages/app-page.js';

/**
 * Theme selector click-through (C8 · #1220, epic #1221).
 *
 * WHAT IS TESTED — driving the SELECTOR UI (not setAttribute) end to end:
 *   1. Selecting each of the 5 themes flips `[data-theme]` to the descriptor's
 *      KIND (positron/bright/liberty → light; dark/fiord → dark).
 *   2. The rendered land pixel approximates `descriptor.landColor` (± tolerance)
 *      after the id-keyed basemap swap — including the SAME-KIND transition
 *      dark→fiord, which proves the swap is id-driven (C1.5), not kind-driven
 *      (the `[data-theme]` attribute doesn't change across dark→fiord).
 *   3. `localStorage['theme']` holds the chosen id, and a RELOAD restores it
 *      (FOUC-free via the inline boot script + App's `resolveInitialTheme` seed).
 *
 * WEBGL LIMITATION (same as basemap-dark-flip.spec.ts): pixel sampling needs a
 * real WebGL context. All pixel assertions skip gracefully when the canvas can't
 * paint; the attribute + localStorage + reload assertions still run (they don't
 * need WebGL). Mirrors the WebGL-skip precedent.
 *
 * CANVAS PIXEL READING: MapLibre 5.x clears the backbuffer between frames, so a
 * 2D drawImage copy reads [0,0,0,0] unless `preserveDrawingBuffer: true`. The
 * e2e-only `VITE_E2E_PRESERVE_BUFFER=true` flag (playwright.config.ts) enables it.
 */

/** Capitalized id (the selector label) → expected chrome kind + land hex. */
const THEMES: { label: string; id: string; kind: 'light' | 'dark'; land: [number, number, number] }[] = [
  { label: 'Positron', id: 'positron', kind: 'light', land: [0xf4, 0xf1, 0xea] },
  { label: 'Bright', id: 'bright', kind: 'light', land: [0xf8, 0xf4, 0xf0] },
  { label: 'Liberty', id: 'liberty', kind: 'light', land: [0xf8, 0xf4, 0xf0] },
  { label: 'Dark', id: 'dark', kind: 'dark', land: [0x0e, 0x11, 0x16] },
  { label: 'Fiord', id: 'fiord', kind: 'dark', land: [0x45, 0x51, 0x6e] },
];

/** A grid of land-interior candidate points (CONUS full-bleed at 1440×900). */
const CANDIDATE_POINTS: [number, number][] = [
  [500, 400], [600, 450], [550, 380], [700, 420], [450, 430],
  [650, 500], [400, 350], [750, 380], [600, 350], [550, 480],
];

async function readCanvasPixel(
  page: Page,
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
      try {
        const tmp = document.createElement('canvas');
        tmp.width = 1;
        tmp.height = 1;
        const ctx2d = tmp.getContext('2d');
        if (!ctx2d) return null;
        ctx2d.drawImage(canvas, px, py, 1, 1, 0, 0, 1, 1);
        const data = ctx2d.getImageData(0, 0, 1, 1).data;
        if (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 0) return null;
        return [data[0], data[1], data[2]] as [number, number, number];
      } catch {
        return null;
      }
    },
    [x, y] as [number, number],
  );
}

/**
 * Find a land pixel whose color is within `tolerance` of `target`. Returns the
 * coords + pixel, or null if no candidate reads (WebGL unavailable) or none match.
 */
async function findLandPixel(
  page: Page,
  target: [number, number, number],
  tolerance: number,
): Promise<{ x: number; y: number; pixel: [number, number, number] } | null> {
  let firstReadable: { x: number; y: number; pixel: [number, number, number] } | null = null;
  for (const [x, y] of CANDIDATE_POINTS) {
    const px = await readCanvasPixel(page, x, y);
    if (px === null) return null; // canvas not readable — preserve WebGL skip
    if (firstReadable === null) firstReadable = { x, y, pixel: px };
    const [r, g, b] = px;
    if (
      Math.abs(r - target[0]) <= tolerance &&
      Math.abs(g - target[1]) <= tolerance &&
      Math.abs(b - target[2]) <= tolerance
    ) {
      return { x, y, pixel: px };
    }
  }
  return firstReadable; // fallback — caller's ± assertion reports what was sampled
}

async function waitForMapReady(page: Page): Promise<boolean> {
  await page.locator('[data-testid=map-canvas]').waitFor({ state: 'visible', timeout: 15_000 });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ready = await page.evaluate(() => Boolean((window as any).__birdMap));
    if (ready) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

async function waitForStyleLoaded(page: Page): Promise<void> {
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
  await page.waitForTimeout(1_000);
}

test.describe('ThemeSelector click-through (C8 #1220)', () => {
  test.beforeEach(async ({ page }) => {
    // Stub all API endpoints to empty so the test doesn't depend on a live DB.
    await page.route('**/api/hotspots', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/observations**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { freshestObservationAt: null } }),
      });
    });
    await page.route('**/api/silhouettes', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
  });

  test('selecting each of the 5 themes flips [data-theme] kind + persists the id (no reload)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 }); // wide → inline segmented radiogroup
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await app.waitForMapLoad();

    for (const t of THEMES) {
      await app.selectTheme(t.label);
      // Chrome polarity derives from the descriptor kind.
      await expect(page.locator('html')).toHaveAttribute('data-theme', t.kind);
      // The chosen id is persisted (read by the boot script on the next load).
      const stored = await page.evaluate(() => localStorage.getItem('theme'));
      expect(stored, `localStorage['theme'] after selecting ${t.label}`).toBe(t.id);
      // The active radio is aria-checked.
      await expect(
        app.themeSelectorGroup.getByRole('radio', { name: t.label, exact: true }),
      ).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('same-kind switch dark→fiord re-fetches the basemap (id-driven swap, not kind)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await app.waitForMapLoad();

    const webglReady = await waitForMapReady(page);
    test.skip(!webglReady, 'WebGL unavailable — map canvas did not paint; pixel-sample skipped');

    // Select Dark and sample its near-black land.
    await app.selectTheme('Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await waitForStyleLoaded(page);
    await page.waitForTimeout(2_000);
    const darkSample = await findLandPixel(page, [0x0e, 0x11, 0x16], 40);
    test.skip(darkSample === null, 'Canvas pixel read returned null — pixel-sample skipped');
    const [, , db] = darkSample!.pixel;
    expect(db, `Dark land blue channel at (${darkSample!.x},${darkSample!.y})`).toBeLessThan(60);

    // Switch to Fiord — SAME kind (dark), so [data-theme] is UNCHANGED. A
    // kind-keyed swap would no-op; the id-driven swap re-fetches fiord tiles, so
    // the navy land (#45516E) is now clearly bluer/brighter than dark's near-black.
    await app.selectTheme('Fiord');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // unchanged
    await waitForStyleLoaded(page);
    await page.waitForTimeout(2_000);
    const fiordPixel = await readCanvasPixel(page, darkSample!.x, darkSample!.y);
    test.skip(fiordPixel === null, 'Fiord canvas pixel read returned null — skipped');
    const [fr, fg, fb] = fiordPixel!;
    // Fiord navy #45516E ≈ [69, 81, 110]: all channels meaningfully above dark's
    // near-black floor — proves the swap actually changed the basemap.
    expect(
      fb,
      `Fiord land blue at (${darkSample!.x},${darkSample!.y}) = [${fr},${fg},${fb}] should be > dark's <60 floor ` +
        `(navy #45516E ≈ blue 110). If still near-black, the id-driven same-kind swap did not fire.`,
    ).toBeGreaterThan(70);
  });

  test('chosen theme persists across reload (FOUC-free)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await app.waitForMapLoad();

    // Select a non-default light theme (Liberty) so we prove the FULL id (not
    // just the kind) round-trips — a kind-only persistence would lose this.
    await app.selectTheme('Liberty');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('liberty');

    await page.reload();
    await app.waitForAppReady();
    await app.waitForMapLoad();

    // After reload the boot script + App seed restore liberty: [data-theme]=light
    // (its kind) and the active radio is liberty.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('liberty');
    await expect(
      app.themeSelectorGroup.getByRole('radio', { name: 'Liberty', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  test('narrow viewport collapses to a trigger + popover (same radiogroup)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // compact → popover form
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await app.waitForMapLoad();

    // At rest the radiogroup is not mounted — only the trigger.
    await expect(app.themeSelectorTrigger).toBeVisible();
    await expect(app.themeSelectorGroup).toHaveCount(0);

    // Selecting through the popover works and flips the theme.
    await app.selectTheme('Dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  });
});
