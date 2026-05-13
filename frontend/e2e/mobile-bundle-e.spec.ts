/**
 * Mobile Bundle E (issue #514) — six mobile residuals from the v2.2 Tier-5 audit.
 *
 * MOB-1  (BLOCKER)  — AppHeader overflows 390px; body.scrollWidth must be ≤ 390px.
 * MOB-3  (IMPORTANT)— iOS auto-zoom: .species-autocomplete-input font-size must be ≥ 16px.
 * MOB-4  (IMPORTANT)— Header buttons sub-44pt touch target.
 * MOB-5  (IMPORTANT)— Sheet safe-area-top: env(safe-area-inset-top) must appear in CSS.
 * MOB-6  (IMPORTANT)— Drag slop: DISMISS_THRESHOLD_PX tuned for thumb reach.
 * MOB-7  (IMPORTANT)— Sheet handle 24→44pt drag target.
 * MOB-N1 (IMPORTANT)— .filters-panel-close 24×22 unstyled; must be ≥ 44×44pt.
 *
 * All touch-target tests run at 390×844 (iPhone 14 Pro) — the canonical mobile
 * viewport from the release-1 exit criteria.
 */
import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.use({ viewport: { width: 390, height: 844 } });

// ── MOB-1: No horizontal overflow at 390px ─────────────────────────────────

test.describe('MOB-1 — AppHeader no horizontal overflow at 390px', () => {
  test('body.scrollWidth must be ≤ 390 on feed view', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth, 'body.scrollWidth must be ≤ 390px on mobile').toBeLessThanOrEqual(390);
  });

  test('wordmark renders full "Bird Maps" text without truncation at 390px', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    // Visible text must include full product name — not "Bird ..." or "B.."
    await expect(page.locator('.app-header-wordmark')).toContainText('Bird Maps');

    // scrollWidth ≤ clientWidth confirms no ellipsis is applied
    const wm = await page.locator('.app-header-wordmark').evaluate(el => ({
      scroll: (el as HTMLElement).scrollWidth,
      client: (el as HTMLElement).clientWidth,
    }));
    expect(
      wm.scroll,
      `wordmark scrollWidth (${wm.scroll}px) must be ≤ clientWidth (${wm.client}px) — ellipsis applied`,
    ).toBeLessThanOrEqual(wm.client);
  });

  test('app-header width must be ≤ 390 on feed view', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const headerBox = await app.appHeader.boundingBox();
    expect(headerBox, 'app-header bounding box must exist').not.toBeNull();
    expect(headerBox!.width, 'app-header width must be ≤ 390px').toBeLessThanOrEqual(390);
  });
});

// ── MOB-3: iOS auto-zoom guard — font-size ≥ 16px ──────────────────────────
// Covers iPhone 14 Pro (390px), iPhone 14 Pro Max (428px), iPhone 15 Pro Max
// (430px) — all are affected by iOS Safari's auto-zoom on inputs < 16px.

test.describe('MOB-3 — species-autocomplete-input font-size ≥ 16px', () => {
  test('autocomplete input font-size ≥ 16px on species view at 390px (prevents iOS auto-zoom)', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=species');
    await app.waitForAppReady();

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.species-autocomplete-input');
      if (!el) return 0;
      return parseFloat(window.getComputedStyle(el).fontSize);
    });
    expect(fontSize, 'autocomplete input font-size must be ≥ 16px to prevent iOS auto-zoom').toBeGreaterThanOrEqual(16);
  });

  test('autocomplete input font-size ≥ 16px on species view at 428px (iPhone Pro Max — prevents iOS auto-zoom)', async ({
    page,
    apiStub,
  }) => {
    // iPhone Pro Max viewports (428/430px) are wider than the old 414px guard
    // and were previously excluded from the 16px override. The rule is now
    // unconditional so this viewport inherits it automatically.
    await page.setViewportSize({ width: 428, height: 926 });
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=species');
    await app.waitForAppReady();

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.species-autocomplete-input');
      if (!el) return 0;
      return parseFloat(window.getComputedStyle(el).fontSize);
    });
    expect(fontSize, 'autocomplete input font-size must be ≥ 16px at 428px (iPhone Pro Max)').toBeGreaterThanOrEqual(16);
  });
});

// ── MOB-4: Header button touch targets ≥ 44×44pt ───────────────────────────

test.describe('MOB-4 — AppHeader buttons ≥ 44×44pt', () => {
  test('Filters button is ≥ 44px tall', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const box = await app.filtersTrigger.boundingBox();
    expect(box, 'Filters button bounding box must exist').not.toBeNull();
    expect(box!.height, 'Filters button height must be ≥ 44px').toBeGreaterThanOrEqual(44);
    expect(box!.width, 'Filters button width must be ≥ 44px').toBeGreaterThanOrEqual(44);
  });

  test('Attribution button is ≥ 44px tall', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const box = await app.attributionTrigger.boundingBox();
    expect(box, 'Attribution button bounding box must exist').not.toBeNull();
    expect(box!.height, 'Attribution button height must be ≥ 44px').toBeGreaterThanOrEqual(44);
    expect(box!.width, 'Attribution button width must be ≥ 44px').toBeGreaterThanOrEqual(44);
  });

  test('Feed tab button is ≥ 44px tall', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const tab = page.getByRole('tab', { name: 'Feed view' });
    const box = await tab.boundingBox();
    expect(box, 'Feed tab bounding box must exist').not.toBeNull();
    expect(box!.height, 'Feed tab height must be ≥ 44px').toBeGreaterThanOrEqual(44);
  });

  // Regression guard: round-1 fix used font-size:0 which produced empty
  // 44×44 squares with no visual affordance. Strategy A (SVG icons) must
  // render a visible <svg> inside each button at mobile viewport.
  test('Filters button has a visible SVG icon at 390px (no empty-square regression)', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const icon = app.filtersTrigger.locator('svg.app-header-btn-icon');
    await expect(icon, 'Filters button must contain a visible SVG icon at mobile').toBeVisible();
  });

  test('Attribution button has a visible SVG icon at 390px (no empty-square regression)', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    const icon = app.attributionTrigger.locator('svg.app-header-btn-icon');
    await expect(
      icon,
      'Attribution button must contain a visible SVG icon at mobile',
    ).toBeVisible();
  });
});

// ── MOB-7: Sheet handle ≥ 44pt drag target ─────────────────────────────────

test.describe('MOB-7 — sheet handle ≥ 44pt drag target', () => {
  test('sheet-handle button height ≥ 44px', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const box = await handle.boundingBox();
    expect(box, 'sheet handle bounding box must exist').not.toBeNull();
    expect(box!.height, 'sheet handle height must be ≥ 44px').toBeGreaterThanOrEqual(44);
    expect(box!.width, 'sheet handle width must be ≥ 44px').toBeGreaterThanOrEqual(44);
  });
});

// ── MOB-N1: .filters-panel-close ≥ 44×44pt ─────────────────────────────────

test.describe('MOB-N1 — .filters-panel-close touch target ≥ 44×44pt', () => {
  test('filters-panel-close button is ≥ 44×44px', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    const app = new AppPage(page);
    await app.goto('view=feed');
    await app.waitForAppReady();

    await app.openFilters();

    const closeBtn = page.locator('.filters-panel-close');
    const box = await closeBtn.boundingBox();
    expect(box, 'filters-panel-close bounding box must exist').not.toBeNull();
    expect(box!.height, 'filters-panel-close height must be ≥ 44px').toBeGreaterThanOrEqual(44);
    expect(box!.width, 'filters-panel-close width must be ≥ 44px').toBeGreaterThanOrEqual(44);
  });
});
