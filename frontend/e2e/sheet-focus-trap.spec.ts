import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * F8 (#910) — real focus trap at the FULL detent.
 *
 * At full the sheet is role="dialog"/aria-modal, but `inert` only covers
 * #map-layer (the O1 unified target). The AppHeader floating chrome sits above
 * the backdrop and stays tabbable, so Tab used to escape the dialog into an
 * AppHeader control. T4 installs a Tab/Shift+Tab wrap (mirror of the
 * filters-panel trap) active ONLY at snap==='full'. This live spec drives the
 * real DOM + keyboard pipeline:
 *   • Tab from the LAST focusable in the sheet stays in the sheet AND the
 *     AppHeader Filters trigger is NOT the active element.
 *   • Shift+Tab from the FIRST focusable wraps to the last (stays in sheet).
 */

test.use({ viewport: { width: 390, height: 844 } });

test.describe('SpeciesDetailSheet focus trap at full (#910)', () => {
  test('Tab from the last focusable stays in the sheet (AppHeader Filters not active); Shift+Tab from first → last', async ({
    page,
    apiStub,
  }) => {
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();
    const app = new AppPage(page);
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');

    // Advance half → full so the trap is installed and inert covers #map-layer.
    await page.getByRole('button', { name: /expand/i }).click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');
    await expect(sheet).toHaveAttribute('role', 'dialog');
    await expect(app.mapLayer).toHaveAttribute('inert', '');

    // Wait for the mid→full reveal to settle: at full the mid-only teaser
    // ("Read account") transitions to opacity:0 (recipe-18). Until it settles,
    // the teaser button still computes as visible, so the focusable set (and the
    // wrap target) is non-deterministic. Poll the teaser to opacity:0 — the same
    // settle discipline axe.spec.ts uses — so first/last are stable.
    await page
      .waitForFunction(() => {
        const teaser = document.querySelector('.sheet-fg-teaser');
        if (!teaser) return true;
        return Number(getComputedStyle(teaser).opacity) === 0;
      }, undefined, { timeout: 5_000 })
      .catch(() => {
        /* best-effort settle; assertions below still run */
      });

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Focus the LAST focusable inside the sheet, then Tab forward. The wrap must
    // keep focus inside the sheet (and specifically NOT move it to the AppHeader
    // Filters trigger, which is reachable absent a trap because inert covers only
    // #map-layer).
    await sheet.evaluate((el, sel) => {
      // Match the component's isVisible: walk UP to the sheet checking computed
      // display/visibility/opacity. The opacity:0 lives on the .sheet-fg-teaser
      // PARENT, not the readaccount button, so an element-only check would keep
      // the button — the ancestor walk is what excludes it (mirroring the trap).
      const visible = (i: HTMLElement): boolean => {
        let node: HTMLElement | null = i;
        while (node && node !== el.parentElement) {
          const cs = getComputedStyle(node);
          if (
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.opacity === '0'
          ) {
            return false;
          }
          node = node.parentElement;
        }
        return true;
      };
      const items = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter(
        visible,
      );
      items[items.length - 1]?.focus();
    }, focusableSelector);

    // Sanity: the AppHeader Filters trigger exists and is NOT currently focused.
    await expect(app.filtersTrigger).toBeVisible();
    await page.keyboard.press('Tab');

    // Focus stayed inside the sheet …
    const focusInSheetAfterTab = await sheet.evaluate(
      (el) => el.contains(document.activeElement),
    );
    expect(focusInSheetAfterTab).toBe(true);
    // … and the AppHeader Filters trigger is NOT the active element.
    const filtersIsActive = await app.filtersTrigger.evaluate(
      (el) => el === document.activeElement,
    );
    expect(filtersIsActive).toBe(false);
    // The forward-from-last wrap lands on the FIRST sheet focusable.
    const onFirstAfterTab = await sheet.evaluate((el, sel) => {
      // Match the component's visibility filter: at full the mid-only teaser
      // (with the "Read account" button) is hidden via opacity:0, so it is not
      // a real focus target and must be excluded when computing first/last.
      // Match the component's isVisible: walk UP to the sheet checking computed
      // display/visibility/opacity. The opacity:0 lives on the .sheet-fg-teaser
      // PARENT, not the readaccount button, so an element-only check would keep
      // the button — the ancestor walk is what excludes it (mirroring the trap).
      const visible = (i: HTMLElement): boolean => {
        let node: HTMLElement | null = i;
        while (node && node !== el.parentElement) {
          const cs = getComputedStyle(node);
          if (
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.opacity === '0'
          ) {
            return false;
          }
          node = node.parentElement;
        }
        return true;
      };
      const items = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter(
        visible,
      );
      return items[0] === document.activeElement;
    }, focusableSelector);
    expect(onFirstAfterTab).toBe(true);

    // Now focus the FIRST focusable and Shift+Tab back → wraps to the LAST.
    await sheet.evaluate((el, sel) => {
      // Match the component's isVisible: walk UP to the sheet checking computed
      // display/visibility/opacity. The opacity:0 lives on the .sheet-fg-teaser
      // PARENT, not the readaccount button, so an element-only check would keep
      // the button — the ancestor walk is what excludes it (mirroring the trap).
      const visible = (i: HTMLElement): boolean => {
        let node: HTMLElement | null = i;
        while (node && node !== el.parentElement) {
          const cs = getComputedStyle(node);
          if (
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.opacity === '0'
          ) {
            return false;
          }
          node = node.parentElement;
        }
        return true;
      };
      const items = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter(
        visible,
      );
      items[0]?.focus();
    }, focusableSelector);
    await page.keyboard.press('Shift+Tab');

    const onLastAfterShiftTab = await sheet.evaluate((el, sel) => {
      // Match the component's visibility filter: at full the mid-only teaser
      // (with the "Read account" button) is hidden via opacity:0, so it is not
      // a real focus target and must be excluded when computing first/last.
      // Match the component's isVisible: walk UP to the sheet checking computed
      // display/visibility/opacity. The opacity:0 lives on the .sheet-fg-teaser
      // PARENT, not the readaccount button, so an element-only check would keep
      // the button — the ancestor walk is what excludes it (mirroring the trap).
      const visible = (i: HTMLElement): boolean => {
        let node: HTMLElement | null = i;
        while (node && node !== el.parentElement) {
          const cs = getComputedStyle(node);
          if (
            cs.display === 'none' ||
            cs.visibility === 'hidden' ||
            cs.opacity === '0'
          ) {
            return false;
          }
          node = node.parentElement;
        }
        return true;
      };
      const items = Array.from(el.querySelectorAll<HTMLElement>(sel)).filter(
        visible,
      );
      return items[items.length - 1] === document.activeElement;
    }, focusableSelector);
    expect(onLastAfterShiftTab).toBe(true);
    const filtersActiveAfterShift = await app.filtersTrigger.evaluate(
      (el) => el === document.activeElement,
    );
    expect(filtersActiveAfterShift).toBe(false);
  });
});
