import { test, expect, VERMFLY_WITH_PHOTO } from '../fixtures.js';
import { AppPage } from '../pages/app-page.js';

/**
 * T3 (#909) — mobile field-guide sheet analytics, driven live.
 *
 * T1 (#907) stopped composing <SpeciesDetailSurface> inside the sheet, which
 * silently dropped three detail-panel events. T3 re-wires them IN the sheet
 * with the SAME event names + prop shapes as the surface. The unit test mocks
 * the IntersectionObserver away, so this live spec is the belt-and-suspenders
 * check that the real observer fires `panel_scrolled_to_bottom` when the user
 * scrolls `.sheet-fg` to the bottom at the full detent — the only detent the
 * sheet scrolls. (Analytics were silently dropped once before; this verifies
 * the wiring survives the real Vite + React + IntersectionObserver pipeline.)
 *
 * Spy mechanism: `main.tsx` exposes the singleton `analytics` object on
 * `window` in DEV. An init-script installs an accessor that wraps the object's
 * `capture` method the instant `main.tsx` assigns it, recording every event
 * name into `window.__capturedAnalytics` BEFORE any `panel_opened` can fire.
 */

test.use({ viewport: { width: 390, height: 844 } });

type CapturedEvent = { name: string; props?: Record<string, unknown> };
type AnalyticsLike = {
  capture: (name: string, props?: Record<string, unknown>) => void;
};
/** Window augmentation used by the addInitScript spy payload. */
type WindowWithAnalytics = typeof window & {
  __capturedAnalytics: CapturedEvent[];
  analytics?: AnalyticsLike;
};

/**
 * Install the analytics spy as an init-script so it is in place before the app
 * bundle runs. We define an accessor on `window.analytics`: when `main.tsx`
 * assigns the singleton (the setter fires), we patch its `capture` method to
 * record into `window.__capturedAnalytics`, then store the patched object.
 */
async function installAnalyticsSpy(app: AppPage): Promise<void> {
  await app.page.addInitScript(() => {
    const w = window as WindowWithAnalytics;
    w.__capturedAnalytics = [];
    let stored: AnalyticsLike | undefined;
    Object.defineProperty(window, 'analytics', {
      configurable: true,
      get() {
        return stored;
      },
      set(value: AnalyticsLike) {
        stored = value;
        if (value && typeof value.capture === 'function') {
          const original = value.capture.bind(value);
          value.capture = (name: string, props?: Record<string, unknown>) => {
            w.__capturedAnalytics.push({ name, props });
            return original(name, props);
          };
        }
      },
    });
  });
}

function countEvents(app: AppPage, name: string): Promise<number> {
  return app.page.evaluate(
    (eventName) =>
      ((window as WindowWithAnalytics).__capturedAnalytics ?? []).filter(
        (e) => e.name === eventName,
      ).length,
    name,
  );
}

function firstEventProps(
  app: AppPage,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  return app.page.evaluate(
    (eventName) =>
      ((window as WindowWithAnalytics).__capturedAnalytics ?? []).find(
        (e) => e.name === eventName,
      )?.props,
    name,
  );
}

test.describe('SpeciesDetailSheet analytics (#909)', () => {
  test('panel_opened fires on data-arrival; panel_scrolled_to_bottom fires when .sheet-fg scrolls to bottom at full', async ({
    page,
    apiStub,
  }) => {
    const app = new AppPage(page);
    await installAnalyticsSpy(app);
    await apiStub.stubEmpty();
    // A long description guarantees the About prose makes .sheet-fg scrollable
    // at full so the bottom sentinel is reached only after a real scroll.
    await apiStub.stubSpecies('vermfly', {
      ...VERMFLY_WITH_PHOTO,
      descriptionBody:
        '<p>' +
        'The Vermilion Flycatcher is a small passerine bird in the tyrant flycatcher family. '.repeat(
          40,
        ) +
        '</p>',
      descriptionAttributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });
    await apiStub.stubPhotoImage();

    await app.goto('detail=vermfly&view=detail');
    await app.waitForAppReady();

    const sheet = page.locator('[data-testid=species-detail-sheet]');
    await expect(sheet).toHaveAttribute('data-snap-state', 'half');

    // panel_opened must have fired once on species data-arrival with the
    // species_code + has_description shape mirrored from the surface.
    await expect.poll(() => countEvents(app, 'panel_opened')).toBe(1);
    expect(await firstEventProps(app, 'panel_opened')).toMatchObject({
      species_code: 'vermfly',
      has_description: true,
    });

    // Advance to full — the only detent at which .sheet-fg scrolls and the
    // sentinel (after the About block) becomes reachable.
    const expand = page.getByRole('button', { name: /expand/i });
    await expand.click();
    await expect(sheet).toHaveAttribute('data-snap-state', 'full');

    // Scroll the .sheet-fg container to its bottom so the bottom sentinel
    // crosses the viewport and the IntersectionObserver fires once.
    await page.locator('.sheet-fg').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    await expect.poll(() => countEvents(app, 'panel_scrolled_to_bottom')).toBe(1);
    expect(await firstEventProps(app, 'panel_scrolled_to_bottom')).toMatchObject({
      species_code: 'vermfly',
    });
  });
});
