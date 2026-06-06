import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

test.use({ viewport: { width: 390, height: 844 } });

test.describe('SpeciesDetailSheet snap behavior', () => {
  test('opens at half; expand button advances half → full; role flips at full', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    // The field-guide sheet opens at `half` (plate-card detent), not peek.
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');

    // A single expand tap now advances half → full (peek is reached by
    // dragging down, not by the expand button).
    const expand = page.getByRole('button', { name: /expand/i });
    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    // O1 (#776): inert retargeted from #main-surface to #map-layer so the live
    // MapLibre canvas is frozen at full snap, not the near-empty <main> shell.
    await expect(app.mapLayer).toHaveAttribute('inert', '');
    // AC-1: map canvas is non-interactive (inert) at full snap — a marker/cluster
    // inside #map-layer cannot be focused because the inert attribute removes all
    // descendants from the tab order and blocks pointer events.
    await expect(page.locator('#map-layer')).toHaveAttribute('inert', '');

    // R3 token-resolution probe (O5 #783) — PRIMARY assertion.
    // Verifies that:
    //   (a) --z-modal > --z-overlay AND --z-modal > --z-popover (P1 named scale)
    //   (b) the mounted full-snap sheet resolves z-index to the --z-modal value
    //       (not a raw integer — confirms the CSS rule references var(--z-modal))
    //
    // This fixture uses stubEmpty so FamilyLegend returns null (no silhouettes)
    // and no ObservationPopover mounts — no legend/popover DOM node is required.
    // The probe reads CSS vars off document.documentElement and the sheet only.
    const tiers = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        modal: Number(cs.getPropertyValue('--z-modal').trim()),
        overlay: Number(cs.getPropertyValue('--z-overlay').trim()),
        popover: Number(cs.getPropertyValue('--z-popover').trim()),
      };
    });
    // --z-modal (50) must be above --z-overlay (40) and --z-popover (41)
    expect(tiers.modal).toBeGreaterThan(tiers.overlay);
    expect(tiers.modal).toBeGreaterThan(tiers.popover);

    // The full-snap sheet's computed z-index must equal --z-modal,
    // confirming .species-detail-sheet--full uses var(--z-modal) not a raw int.
    const sheetZ = await sheet.evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(sheetZ).toBe(tiers.modal);

    // Collapse path
    const collapse = page.getByRole('button', { name: /collapse/i });
    await collapse.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    await expect(sheet).toHaveAttribute('role', 'region');
    // O1: inert is removed from #map-layer on collapse (map becomes interactive again).
    await expect(app.mapLayer).not.toHaveAttribute('inert', '');
  });

  test('drag-down past peek dismisses the sheet (URL flips off detail)', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    // The sheet opens at half (~0.6 vh tall). Dismiss fires when the dragged
    // height settles below PEEK_PX * 0.6 (≈62px) without an upward flick — i.e.
    // a long, deliberate downward pull. Compute the travel from the live sheet
    // box so the test is viewport-stable: drag from the handle down to just
    // past the bottom of the screen, shrinking the height under the floor.
    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const handleBox = await handle.boundingBox();
    const sheetBox = await sheet.boundingBox();
    if (!handleBox || !sheetBox) throw new Error('handle/sheet bounding box unavailable');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    // Travel = the sheet's own height + a margin, so finalH collapses well below
    // the dismiss floor. Slow steps keep velocity downward (vy >= 0), not a
    // back-up flick.
    const travel = sheetBox.height + 80;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + travel, { steps: 24 });
    await page.mouse.up();

    // URL must flip away from detail. Per #662 + #663: onCloseDetail
    // resets ?detail= and (when the user opened via the legacy
    // ?view=detail deep-link) restores view to 'map'. Since 'map' is
    // the default view, the canonical post-close URL drops both
    // ?view= and ?detail= entirely.
    await expect(page).not.toHaveURL(/view=detail/);
    await expect.poll(
      () => new URL(page.url()).searchParams.get('detail'),
      { timeout: 5_000 },
    ).toBeNull();
    await expect(page.locator('[data-testid=species-detail-sheet]')).toHaveCount(0);
  });

  test('drag-up grows the sheet ~1:1; a fast up-flick snaps to full', async ({ page, apiStub }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');

    const handle = page.locator('[data-testid=species-detail-sheet-handle]');
    const handleBox = await handle.boundingBox();
    const startBox = await sheet.boundingBox();
    if (!handleBox || !startBox) throw new Error('handle/sheet bounding box unavailable');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    // Phase 1 — a slow, stepped drag UP by 120px. The sheet should track the
    // finger ~1:1: its rendered height grows by ≈120px (minus rounding +
    // safe-area). data-dragging flips true during the gesture. We hold (no
    // mouse-up yet) and assert the live height mid-drag.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 60, { steps: 12 });
    await page.mouse.move(startX, startY - 120, { steps: 12 });
    await expect(sheet).toHaveAttribute('data-dragging', 'true');
    const midBox = await sheet.boundingBox();
    if (!midBox) throw new Error('mid-drag bounding box unavailable');
    // 1:1 within a generous tolerance (rounding + env(safe-area) reservation).
    expect(midBox.height - startBox.height).toBeGreaterThan(90);
    expect(midBox.height - startBox.height).toBeLessThan(150);
    // Release slowly so this gesture itself does NOT flick — it settles by
    // position back to a detent (height grew toward full → likely full, but we
    // only assert dragging cleared and the flick case below owns the snap=full
    // assertion).
    await page.mouse.up();
    await expect(sheet).toHaveAttribute('data-dragging', 'false');

    // Phase 2 — a fast up-flick from half. A rapid upward swipe (high velocity)
    // advances a detent past the nearest-by-position result → full. The flick is
    // detected from the LAST pointermove's velocity (vy = Δy / Δt, px/ms), so the
    // final move must be a single large upward jump issued back-to-back with the
    // prior one: even if the dev server is under parallel load and Δt stretches,
    // an 80px jump keeps |vy| well over the 0.5px/ms threshold.
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');
    const hb2 = await handle.boundingBox();
    if (!hb2) throw new Error('handle bounding box unavailable (flick)');
    const fx = hb2.x + hb2.width / 2;
    const fy = hb2.y + hb2.height / 2;
    await page.mouse.move(fx, fy);
    await page.mouse.down();
    await page.mouse.move(fx, fy - 20);
    await page.mouse.move(fx, fy - 100); // large final jump → unambiguous up-flick
    await page.mouse.up();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');
  });
});
