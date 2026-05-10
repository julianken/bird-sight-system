import type { Page, Locator } from '@playwright/test';
import { FiltersBar } from './filters-bar.js';

export class AppPage {
  readonly filters: FiltersBar;
  readonly mainSurface: Locator;
  readonly errorScreen: Locator;
  /** Persistent header chrome — wordmark, tablist, action buttons. */
  readonly appHeader: Locator;
  /** The three surface tabs inside appHeader (Map, Species, Feed). */
  readonly appHeaderTabs: Locator;
  /** Filters trigger button in appHeader (badge shows active-filter count). */
  readonly filtersTrigger: Locator;
  /** Theme toggle button in appHeader. */
  readonly themeToggle: Locator;
  /** Credits & attribution trigger in appHeader. */
  readonly attributionTrigger: Locator;

  constructor(public readonly page: Page) {
    this.filters = new FiltersBar(page);
    this.mainSurface = page.locator('main#main-surface');
    this.errorScreen = page.locator('.error-screen');
    this.appHeader = page.locator('header.app-header');
    this.appHeaderTabs = this.appHeader.getByRole('tab');
    this.filtersTrigger = this.appHeader.getByRole('button', { name: /^Filters/ });
    this.themeToggle = this.appHeader.getByRole('button', { name: /Switch to (light|dark) theme/ });
    this.attributionTrigger = this.appHeader.getByRole('button', { name: /Credits & attribution/ });
  }

  /** Navigate to a surface by tab name. */
  async selectView(view: 'feed' | 'species' | 'map'): Promise<void> {
    const labelMap = { feed: 'Feed view', species: 'Species view', map: 'Map view' };
    await this.appHeader.getByRole('tab', { name: labelMap[view] }).click();
  }

  async goto(query = '') {
    await this.page.goto(`/${query ? '?' + query : ''}`);
  }

  /**
   * Wait for the app to finish its initial data load. The `<main>`
   * landmark flips `data-render-complete="true"` once `useBirdData`'s
   * `loading` settles to `false`. Replaces the legacy `[data-region-id]`
   * count=9 gate that disappeared when the map chain was deleted in #113.
   */
  async waitForAppReady(timeout = 10_000) {
    await this.page
      .locator('main[data-render-complete="true"]')
      .waitFor({ state: 'attached', timeout });
  }

  getUrlParams(): URLSearchParams {
    return new URL(this.page.url()).searchParams;
  }
}
