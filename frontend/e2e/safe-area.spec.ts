/**
 * Safe-area inset guard — SpeciesDetailSheet (V1 / issue #788).
 *
 * Restores the MOB-5 intent that the `mobile-bundle-e.spec.ts` header comment
 * promised but whose test body no longer exists in that file:
 *
 *   "MOB-5 (IMPORTANT) — Sheet safe-area-top: env(safe-area-inset-top) must
 *    appear in CSS."
 *
 * A repo-wide grep confirmed zero runtime/CSS assertions for env(safe-area-inset*)
 * under frontend/e2e/ outside that dangling comment.
 *
 * ── Why this file is named safe-area.spec.ts, NOT *.preview.spec.ts ──────────
 *
 * File name is load-bearing. `playwright.config.ts` routes projects by filename:
 *   • `dev-server` project (baseURL: http://localhost:5173) → testIgnore /.*\.preview\.spec\.ts$/
 *   • `preview-build` project (baseURL: http://localhost:4173) → testMatch /.*\.preview\.spec\.ts$/
 *
 * This spec asserts the **authored CSS source string** (`env(safe-area-inset-bottom`
 * appearing in a `CSSStyleRule`). The dev-server Vite build injects `styles.css`
 * as a same-origin `<style>` tag with the **un-minified source preserved**:
 * `padding-bottom: env(safe-area-inset-bottom, 0)` survives verbatim.
 *
 * The preview-build project runs `npm run build` first; the CSS minifier can
 * shorthand-collapse `padding-top` + `padding-bottom` longhands into a single
 * `padding` shorthand or reorder declarations — silently breaking the longhand
 * source-string match even when the production declaration is intact (false RED).
 * Pinning to dev-server by file-naming convention avoids that hazard.
 *
 * This spec is also NOT tagged @coarse (that routes to the coarse-pointer project).
 *
 * ── Why getComputedStyle is NOT the falsifiable probe ────────────────────────
 *
 * Playwright/Chromium cannot make `env(safe-area-inset-bottom)` resolve to a
 * nonzero value — there is no API that sets the device inset in headless mode.
 * `getComputedStyle(sheet).paddingBottom` therefore always yields the `0` fallback
 * regardless of whether the authored production declaration at `styles.css:1219`
 * exists or not. It would pass even if the declaration were deleted — a tautology.
 *
 * The falsifiable probe is the **authored CSSStyleRule source string**: iterating
 * `document.styleSheets` and asserting a matched `.species-detail-sheet` rule's
 * `style.getPropertyValue('padding-bottom')` contains `env(safe-area-inset-bottom`.
 * This fails on removal of `styles.css:1219` — true regression coverage.
 */

import { test, expect, VERMFLY_WITH_PHOTO } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

// Pin to 390×844 (iPhone 14 Pro) — the canonical mobile viewport where
// env(safe-area-inset-bottom) clearance is load-bearing for the home indicator.
test.use({ viewport: { width: 390, height: 844 } });

test.describe('SpeciesDetailSheet safe-area inset guard (MOB-5 / V1 #788)', () => {
  test('padding-bottom authored CSS contains env(safe-area-inset-bottom) and sheet sits flush to viewport bottom', async ({
    page,
    apiStub,
  }) => {
    // Mirror the stub setup from sheet-snap.spec.ts (lines 8-10).
    await apiStub.stubEmpty();
    await apiStub.stubSpecies('vermfly', VERMFLY_WITH_PHOTO);
    await apiStub.stubPhotoImage();

    const app = new AppPage(page);
    // Open the detail sheet via the deep-link URL (mirrors sheet-snap.spec.ts:12-13).
    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    // Wait for the sheet to be present in the DOM.
    const sheet = app.speciesDetailSheet;
    await sheet.waitFor({ state: 'attached' });

    // ── 1. Authored CSS source-string assertion (falsifiable probe) ───────────
    //
    // Iterate ALL document.styleSheets inside a try/catch (cross-origin guard).
    // The dev-server injects styles.css as a same-origin <style> tag, but
    // index.html:44 also carries an inline <style> block — match on selectorText,
    // not on sheet index, so the assertion is robust to multiple sheets.
    //
    // Assert that at least one matched `.species-detail-sheet` CSSStyleRule's
    // padding-bottom source value contains `env(safe-area-inset-bottom`.
    // This fails if styles.css:1219 is removed (the production declaration).
    const safeAreaResult = await page.evaluate(() => {
      const matchedPaddingValues: string[] = [];
      const matchedPaddingShorthands: string[] = [];

      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          // SecurityError: cross-origin sheet — skip (belt-and-suspenders even
          // in dev-server context where all sheets are same-origin).
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          // Match the base class — `.species-detail-sheet` exactly (not the
          // modifier classes like `.species-detail-sheet--full`).
          if (rule.selectorText !== '.species-detail-sheet') continue;

          const paddingBottom = rule.style.getPropertyValue('padding-bottom');
          const padding = rule.style.getPropertyValue('padding');

          if (paddingBottom) matchedPaddingValues.push(paddingBottom);
          if (padding) matchedPaddingShorthands.push(padding);
        }
      }

      return { matchedPaddingValues, matchedPaddingShorthands };
    });

    // The production declaration at styles.css:1219:
    //   padding-bottom: env(safe-area-inset-bottom, 0);
    // must appear in at least one matched rule as the longhand, OR (future-proof)
    // as the padding shorthand if a future change emits the shorthand form.
    const allValues = [
      ...safeAreaResult.matchedPaddingValues,
      ...safeAreaResult.matchedPaddingShorthands,
    ];

    expect(
      allValues.some((v) => v.includes('env(safe-area-inset-bottom')),
      `Expected at least one .species-detail-sheet CSS rule to have ` +
      `padding-bottom (or padding shorthand) containing env(safe-area-inset-bottom). ` +
      `Found padding-bottom values: ${JSON.stringify(safeAreaResult.matchedPaddingValues)}; ` +
      `padding shorthand values: ${JSON.stringify(safeAreaResult.matchedPaddingShorthands)}. ` +
      `This fails if styles.css:1219 (padding-bottom: env(safe-area-inset-bottom, 0)) is removed.`,
    ).toBe(true);

    // ── 2. padding-top authored CSS source-string assertion ───────────────────
    //
    // The production declaration at styles.css:1218:
    //   padding-top: max(var(--space-xs, 4px), env(safe-area-inset-top, 0px));
    // must also appear — this clears the Dynamic Island / status bar at full snap.
    const safeAreaTopResult = await page.evaluate(() => {
      const matchedPaddingTopValues: string[] = [];

      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (rule.selectorText !== '.species-detail-sheet') continue;
          const paddingTop = rule.style.getPropertyValue('padding-top');
          if (paddingTop) matchedPaddingTopValues.push(paddingTop);
        }
      }

      return { matchedPaddingTopValues };
    });

    expect(
      safeAreaTopResult.matchedPaddingTopValues.some((v) =>
        v.includes('env(safe-area-inset-top'),
      ),
      `Expected at least one .species-detail-sheet CSS rule to have ` +
      `padding-top containing env(safe-area-inset-top). ` +
      `Found: ${JSON.stringify(safeAreaTopResult.matchedPaddingTopValues)}. ` +
      `This fails if styles.css:1218 (padding-top: max(..., env(safe-area-inset-top, 0px))) is removed.`,
    ).toBe(true);

    // ── 3. Optional computed-style probe (informational, not falsifiable) ─────
    //
    // Chromium headless cannot make env(safe-area-inset-bottom) resolve to a
    // nonzero value (no API sets the inset). Reading getComputedStyle therefore
    // only confirms the fallback resolves to `0px` — it does NOT prove the
    // authored env() chain is intact. Assert `0px` here purely as documentation
    // of the headless constraint; do NOT treat this as proof the guard works.
    const computedPaddingBottom = await sheet.evaluate(
      (el) => getComputedStyle(el).paddingBottom,
    );
    // Under headless Chromium, env(safe-area-inset-bottom, 0) resolves to `0px`
    // because there is no API to inject a nonzero safe-area inset.
    // This is intentionally `0px` — NOT an assertion that the inset is consumed.
    expect(
      computedPaddingBottom,
      'headless fallback: env(safe-area-inset-bottom, 0) must resolve to 0px under headless Chromium ' +
      '(informational — this does NOT prove the production guard works on real devices)',
    ).toBe('0px');

    // ── 4. Sheet bottom-edge flush assertion ──────────────────────────────────
    //
    // The sheet is `position: fixed; bottom: 0` (styles.css:1197-1200).
    // Its bottom edge must sit at the viewport bottom edge.
    const sheetBottom = await sheet.evaluate(
      (el) => el.getBoundingClientRect().bottom,
    );
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    expect(
      sheetBottom,
      `sheet.getBoundingClientRect().bottom (${sheetBottom}) must equal ` +
      `window.innerHeight (${viewportHeight}) — sheet is position:fixed;bottom:0 (styles.css:1197-1200)`,
    ).toBe(viewportHeight);
  });
});
