import { test, expect } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * Copy link to this view — C2 (#1240, epic #1238).
 *
 * The "Copy link to this view" pill (4th control in the top-right cluster) reads
 * the LIVE camera, builds a `…<search>#map=<z>/<lat>/<lng>[/…]&v=<W>x<H>@<dpr>`
 * link through the C1 codec, and writes it to the clipboard with an accessible
 * `role="status"` confirmation. Clipboard ONLY — it never mutates the app's own
 * URL bar (Part 2).
 *
 * Test strategy (per the issue's e2e expectations):
 *   - Install an IN-PAGE `navigator.clipboard.writeText` spy BEFORE navigation
 *     (`window.__copied = []`, wrap the method) so the captured string is
 *     readable without a `clipboard-read` permission (none is granted in
 *     playwright.config.ts) — we do NOT assert via clipboard readback.
 *   - Click the pill, assert `window.__copied[0]` matches the link SHAPE
 *     (regex, NOT an exact value — the camera floats sub-pixel under CI), and
 *     assert the `role=status` region shows the confirmation.
 *   - Reuse `app.waitForMapLoad()` (the camera getter is live only once the map
 *     is ready).
 *
 * Navigation contract: every test begins with `page.goto(...)` (via the POM
 * `goto`, which defaults to `?scope=us`). No state leaks across tests.
 *
 * Read-only: no DB writes — the clipboard spy is in-page instrumentation, and
 * the only network is the stubbed read endpoints. Verified by the CLAUDE.md
 * `grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:|fetch\(.*POST"`
 * guard.
 */

const LINK_SHAPE = /#map=[\d.]+\/-?[\d.]+\/-?[\d.]+/;

/**
 * Install the clipboard spy before any app script runs. Wraps
 * `navigator.clipboard.writeText` so every copy is recorded in `window.__copied`
 * AND still resolves (the real write may be denied in a headless context — the
 * spy resolving keeps the component on its success path so the confirmation
 * renders deterministically). Defensive against `navigator.clipboard` being
 * absent in some contexts: defines a minimal stub when missing.
 */
async function installClipboardSpy(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__copied = [] as string[];
    const record = (text: string): Promise<void> => {
      w.__copied.push(text);
      return Promise.resolve();
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator.clipboard as any).writeText = (text: string): Promise<void> => {
        w.__copied.push(text);
        // Best-effort real write; ignore rejection so the spy stays on the
        // success path (the assertion reads __copied, not the OS clipboard).
        return orig(text).catch(() => undefined);
      };
    } else {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: record },
      });
    }
  });
}

async function readCopied(page: import('@playwright/test').Page): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).__copied as string[]);
}

test.describe('Copy link to this view (C2 · #1240)', () => {
  test.beforeEach(async ({ apiStub }) => {
    // A healthy scoped map: stub the read endpoints so the map renders and the
    // camera getter goes live. Empty observations are fine — the camera is read
    // from the map, not from data.
    await apiStub.stubEmpty();
  });

  test('the Copy-link pill is present in the top-right controls cluster', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    await expect(app.copyViewLinkButton).toBeVisible();
    // a11y contract: momentary action, NOT a disclosure — no aria-haspopup /
    // aria-expanded / aria-pressed, and the button itself carries no aria-live.
    await expect(app.copyViewLinkButton).toHaveAttribute('type', 'button');
    await expect(app.copyViewLinkButton).toHaveAttribute(
      'aria-label',
      'Copy link to this view',
    );
    expect(await app.copyViewLinkButton.getAttribute('aria-haspopup')).toBeNull();
    expect(await app.copyViewLinkButton.getAttribute('aria-expanded')).toBeNull();
    expect(await app.copyViewLinkButton.getAttribute('aria-pressed')).toBeNull();
    expect(await app.copyViewLinkButton.getAttribute('aria-live')).toBeNull();
  });

  test('clicking copies a link of the codec shape and announces success', async ({ page }) => {
    await installClipboardSpy(page);
    const app = new AppPage(page);
    await app.goto(); // ?scope=us — a real camera once the map settles
    await app.waitForAppReady();
    await app.waitForMapLoad();
    // The camera getter is live only after the map's style.load + the scope
    // framing settles; clicking before then is a no-op (getCamera → null).
    await app.waitForCameraReady();

    await app.copyViewLinkButton.click();

    // The captured clipboard string has the link shape (regex, NOT exact — the
    // camera floats sub-pixel under CI).
    await expect.poll(async () => (await readCopied(page))[0] ?? '', {
      timeout: 5_000,
    }).toMatch(LINK_SHAPE);

    const copied = (await readCopied(page))[0];
    // The query (scope) rides on location.search; the camera in the hash.
    expect(copied).toContain('scope=us');
    expect(copied.indexOf('#map=')).toBeGreaterThan(copied.indexOf('?'));
    // The capture viewport tag is present (&v=<W>x<H>@<dpr>).
    expect(copied).toMatch(/&v=\d+x\d+@\d+(\.\d+)?/);

    // The role=status confirmation announces success (in-place, no toast).
    await expect(
      app.appHeader.getByRole('status').filter({ hasText: /copied/i }),
    ).toHaveCount(1);
  });

  test('the Copy-link CLICK does not mutate the app URL bar (clipboard only — #1249 write-back owns URL writes)', async ({
    page,
  }) => {
    await installClipboardSpy(page);
    const app = new AppPage(page);
    await app.goto();
    await app.waitForAppReady();
    await app.waitForMapLoad();
    await app.waitForCameraReady();

    // The camera→hash write-back (#1249, use-scope-camera.ts) is an INDEPENDENT
    // `map.on('idle')` listener that serializes the live camera into `#map=` via
    // `replaceState` once the scope-settle window closes. It fires regardless of
    // any Copy-link interaction. This test owns the COPY-CLICK contract — that the
    // click is clipboard-only and does NOT itself touch `location`/`history` — so
    // we must first let the independent write-back settle, THEN measure the URL
    // delta caused by the click alone. Asserting "URL never contains `#map=`"
    // (the pre-#1249 premise) is now provably wrong and races the write-back.
    //
    // Settle the write-back: wait until `#map=` lands on the bar (it will, on the
    // first post-fit idle), then snapshot both the URL and the history length.
    await expect
      .poll(() => page.url(), { timeout: 10_000 })
      .toContain('#map=');
    const before = page.url();
    const lengthBefore = await page.evaluate(() => window.history.length);

    await app.copyViewLinkButton.click();
    await expect.poll(async () => (await readCopied(page)).length, { timeout: 5_000 }).toBe(1);
    // Give any (illegitimate) click-driven URL write a chance to land before we
    // assert it did NOT happen — longer than the write-back's 300ms idle debounce.
    await page.waitForTimeout(500);

    // The click added nothing to the URL: the location is byte-identical to the
    // post-write-back snapshot, and no `pushState` grew the history stack. If
    // Copy-link ever starts writing the URL (the regression this guards), one of
    // these fails — the value would differ, or a pushState would bump the length.
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => window.history.length)).toBe(lengthBefore);
  });

  test('icon-only below wide; labeled at wide', async ({ page }) => {
    await installClipboardSpy(page);
    const app = new AppPage(page);

    // Mobile (390×844): icon-only — no "Copy link" text label.
    await page.setViewportSize({ width: 390, height: 844 });
    await app.goto();
    await app.waitForAppReady();
    await expect(app.copyViewLinkButton).toBeVisible();
    await expect(app.copyViewLinkButton.getByText('Copy link')).toHaveCount(0);

    // Wide (1440×900): the text label renders.
    await page.setViewportSize({ width: 1440, height: 900 });
    await app.goto();
    await app.waitForAppReady();
    await expect(app.copyViewLinkButton.getByText('Copy link')).toBeVisible();
  });
});
