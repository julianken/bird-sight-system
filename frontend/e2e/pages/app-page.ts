import type { Page, Locator } from '@playwright/test';
import { FiltersBar } from './filters-bar.js';

export class AppPage {
  readonly filters: FiltersBar;
  readonly mainSurface: Locator;
  readonly errorScreen: Locator;

  constructor(public readonly page: Page) {
    this.filters = new FiltersBar(page);
    this.mainSurface = page.locator('main#main-surface');
    this.errorScreen = page.locator('.error-screen');
  }

  async goto(query = '') {
    await this.page.goto(`/${query ? '?' + query : ''}`);
  }

  /**
   * Wait for the app to finish its initial data load. The `<main>`
   * landmark flips `data-render-complete="true"` once `useBirdData`'s
   * `loading` settles to `false` and `observations` is no longer
   * null. Replaces the legacy `[data-region-id]` count=9 gate that
   * disappeared when the map chain was deleted in #113.
   */
  async waitForAppReady(timeout = 10_000) {
    await this.page
      .locator('main[data-render-complete="true"]')
      .waitFor({ state: 'attached', timeout });
  }

  /**
   * Temporary alias — the waitForMapLoad name was used by every spec
   * that relied on the 9-region render gate. Keeping the alias lets
   * the migration happen one spec at a time without a flag-day rename.
   * Remove once every spec uses waitForAppReady directly.
   */
  async waitForMapLoad(timeout = 10_000) {
    await this.waitForAppReady(timeout);
  }

  getUrlParams(): URLSearchParams {
    return new URL(this.page.url()).searchParams;
  }
}
