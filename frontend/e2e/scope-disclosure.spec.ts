import { test, expect, STATES_FIXTURE } from './fixtures.js';
import { AppPage } from './pages/app-page.js';

/**
 * #828 — the in-state scope form collapses behind a 🔍 search disclosure on the
 * top-left identity card and expands IN PLACE. This spec drives the disclosure
 * the way a user would (click to open, ✕/Esc to close) and asserts the
 * accessibility contract from the design spec §7:
 *
 *   - resting card = two lines (wordmark · region, count-only lede); the scope
 *     form is NOT visible until the disclosure opens;
 *   - 🔍 expands the form in place (aria-expanded → true; glyph → ✕);
 *   - focus moves to the first field (the state <select>) on open;
 *   - Esc collapses AND restores focus to the trigger;
 *   - a click OUTSIDE the card does NOT close it (a stray map click must not
 *     discard a half-typed ZIP);
 *   - the visible region appears once (wordmark line) — the <h1> is sr-only.
 *
 * The map is scoped to Arizona (which is populated on the AZ seed) so the
 * disclosure trigger and the count-only lede both render.
 */
test.describe('Scope disclosure (#828)', () => {
  const AZ_OBS = [
    {
      subId: 'S1',
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 32.22,
      lng: -110.97,
      obsDt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      locId: 'L1',
      locName: 'Tucson',
      howMany: 1,
      isNotable: false,
      silhouetteId: 'tyrannidae',
      familyCode: 'tyrannidae',
    },
    {
      subId: 'S2',
      speciesCode: 'gilwoo',
      comName: 'Gila Woodpecker',
      lat: 32.3,
      lng: -111.0,
      obsDt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
      locId: 'L2',
      locName: 'Saguaro NP',
      howMany: 2,
      isNotable: false,
      silhouetteId: 'picidae',
      familyCode: 'picidae',
    },
  ];

  async function setup(
    page: import('@playwright/test').Page,
    apiStub: import('./fixtures.js').ApiStub,
  ): Promise<AppPage> {
    await apiStub.stubStates();
    await apiStub.stubEmpty();
    // State-aware observations (LIFO wins): AZ populated, anything else empty.
    await page.route('**/api/observations**', async route => {
      const state = new URL(route.request().url()).searchParams.get('state');
      const data = state === 'US-AZ' ? AZ_OBS : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          meta: {
            freshestObservationAt:
              data.length > 0 ? new Date(Date.now() - 5 * 60 * 1000).toISOString() : null,
          },
        }),
      });
    });
    const app = new AppPage(page);
    await app.goto('state=US-AZ');
    await app.waitForAppReady();
    await app.waitForMapLoad();
    return app;
  }

  test('resting card is two lines: the scope form is hidden until the 🔍 opens it', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    // The count-only lede is visible (region + window dropped, #828).
    // #1047: lede always reports sightings.
    await expect(app.mapLede).toHaveText(/^\d+ sightings$/);
    // The visible region rides in the wordmark line exactly once.
    await expect(app.appHeader.locator('.brand-region')).toHaveText('· Arizona');

    // The disclosure trigger is present and collapsed.
    await expect(app.scopeDisclosureTrigger).toBeVisible();
    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'false');

    // The scope form (state select / ZIP / Change scope) is NOT visible at rest.
    await expect(app.scopeControlStateSelect).toBeHidden();
    await expect(app.scopeControlExit).toBeHidden();
  });

  test('exactly one <h1>, rendered visually hidden (region not read twice)', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText('Arizona');
    // sr-only: present in the a11y tree but clipped out of the visible layout.
    await expect(h1).toHaveClass(/sr-only/);
  });

  test('🔍 expands the scope form in place and moves focus to the state <select>', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.scopeDisclosureTrigger.click();

    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'true');
    // The form is now revealed in place (no popover — it grows the card).
    await expect(app.scopeControlStateSelect).toBeVisible();
    await expect(app.scopeControlExit).toBeVisible();
    // Focus moved to the first field.
    await expect(app.scopeControlStateSelect).toBeFocused();
    // The trigger's accessible name flips to the close affordance.
    await expect(
      app.appHeader.getByRole('button', { name: /close scope options/i }),
    ).toBeVisible();
  });

  test('on open, the focused state <select> shows the soft accent ring, not the heavy black box (#837)', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.scopeDisclosureTrigger.click();
    await expect(app.scopeControlStateSelect).toBeFocused();

    // #837: the embedded scope fields drop the repo's heavy
    // `outline: 2px solid var(--color-text-strong); outline-offset: 2px` black
    // offset box (which looked jarring slammed around the select on open) for a
    // tight accent box-shadow ring. Assert the softened recipe on the focused
    // select: a transparent outline (HCM fallback), zero offset, and a
    // box-shadow ring (the accent token, resolved to a real color).
    const style = await app.scopeControlStateSelect.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
        boxShadow: cs.boxShadow,
      };
    });
    // The heavy black outline (rgb(26, 26, 26)) is gone — the outline is now a
    // forced-colors-only transparent fallback.
    expect(style.outlineColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
    expect(style.outlineOffset).toBe('0px');
    // A real (non-"none") box-shadow ring conveys the visible focus indicator.
    expect(style.boxShadow).not.toBe('none');
    expect(style.boxShadow.length).toBeGreaterThan(0);
  });

  test('Esc collapses the form and restores focus to the trigger', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.scopeDisclosureTrigger.click();
    await expect(app.scopeControlStateSelect).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(app.scopeControlStateSelect).toBeHidden();
    // Focus returns to the trigger (spec §7).
    await expect(app.scopeDisclosureTrigger).toBeFocused();
  });

  test('the identity card COLLAPSES to its two-line height when the disclosure is closed (#975)', async ({ page, apiStub }) => {
    // #975 regression guard: #958 swapped the closed scope-rows lock to
    // `visibility:hidden`, which keeps the form IN FLOW — the card froze at its
    // OPEN height with an empty band below the lede. The existing `toBeHidden()`
    // asserts pass on `visibility:hidden` alone (they never measure layout), so
    // they could NOT catch this. This test measures the CARD'S TOTAL HEIGHT
    // (per the review amendment — NOT just `.app-header-scope-rows ≤ 1px`, which
    // would still pass with an 8px residual flex `gap` band present): the closed
    // card must be MATERIALLY SHORTER than the open card.
    const app = await setup(page, apiStub);

    // Read the card's rendered border-box height directly in the page so each
    // poll re-measures a fresh frame (a Playwright Locator boundingBox snapshots
    // once). Returns 0 if absent so `expect.poll` can retry rather than throw.
    const cardHeight = () =>
      page.evaluate(() => {
        const el = document.querySelector('.app-header-identity-card');
        return el ? el.getBoundingClientRect().height : 0;
      });

    // --- At REST (disclosure closed) ---
    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'false');
    const restingHeight = await cardHeight();

    // --- OPEN the disclosure and let the grid-rows tween SETTLE ---
    // The grid-rows + #07 tweens run for --panel-open-dur; poll the SETTLED open
    // height rather than reading a mid-animation frame. `expect.poll` retries the
    // measurement until the card has grown materially (the full scope form: state
    // <select> + ZIP row + Whole US / Change scope links + divider), which only
    // holds once the tween lands — so `openHeight` below is the settled value.
    await app.openScopeDisclosure();
    await expect(app.scopeControlStateSelect).toBeVisible();
    await expect.poll(cardHeight).toBeGreaterThan(restingHeight + 40);
    const openHeight = await cardHeight();

    // --- Esc-CLOSE and assert the card COLLAPSES back to its resting height ---
    await page.keyboard.press('Escape');
    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(app.scopeControlStateSelect).toBeHidden();
    // Poll until the collapse tween has fully settled back to ≈the resting
    // (two-line) height — NO empty region below the lede, no residual flex `gap`
    // band. The closed card must be ≈ wordmark + lede + padding (≤2px sub-pixel
    // rounding slack), MATERIALLY less than its open height — which the per-row
    // `scope-rows ≤ 1px` guard would NOT catch (it passes with the gap band
    // present). This is the missing #975 regression guard.
    await expect.poll(cardHeight).toBeLessThanOrEqual(restingHeight + 2);
    const collapsedHeight = await cardHeight();
    expect(collapsedHeight).toBeLessThan(openHeight - 40);
  });

  test('clicking ✕ collapses the form', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.scopeDisclosureTrigger.click();
    await expect(app.scopeControlStateSelect).toBeVisible();

    // The same trigger now reads "Close scope options" — click it to collapse.
    await app.scopeDisclosureTrigger.click();
    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(app.scopeControlStateSelect).toBeHidden();
  });

  test('a click outside the card does NOT close the form (no click-outside)', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.scopeDisclosureTrigger.click();
    await expect(app.scopeControlStateSelect).toBeVisible();

    // Click the map canvas (well clear of the card) — the disclosure stays open
    // so a half-typed ZIP is never discarded by a stray map click.
    await app.mapCanvas.click({ position: { x: 10, y: 10 } });

    await expect(app.scopeDisclosureTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(app.scopeControlStateSelect).toBeVisible();
  });

  test('re-scoping through the disclosure works end-to-end (state switch)', async ({ page, apiStub }) => {
    const app = await setup(page, apiStub);

    await app.openScopeDisclosure();
    // Switch to another state via the revealed <select> + Go (#1035: change no
    // longer navigates; the explicit Go commit does).
    const target = STATES_FIXTURE.find(s => s.stateCode === 'US-FL')!;
    await app.switchStateViaScopeControl(target.stateCode);

    // The URL round-trips to the new scope (the persisted action — unlike the
    // disclosure open/closed state, which is component-local, not in the URL).
    await expect(page).toHaveURL(/[?&]state=US-FL\b/);
  });
});
