import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { FiltersBar } from './filters-bar.js';

export class AppPage {
  readonly filters: FiltersBar;
  readonly mapWrap: Locator;
  readonly errorScreen: Locator;

  constructor(public readonly page: Page) {
    this.filters = new FiltersBar(page);
    this.mapWrap = page.locator('.map-wrap');
    this.errorScreen = page.locator('.error-screen');
  }

  async goto(query = '') {
    await this.page.goto(`/${query ? '?' + query : ''}`);
  }

  async waitForMapLoad(timeout = 15_000) {
    await expect(this.page.locator('[data-region-id]')).toHaveCount(9, { timeout });
  }

  async expandRegion(ariaName: string) {
    const region = this.page.locator(`.region-shape[aria-label="${ariaName}"]`);
    await region.focus();
    await this.page.keyboard.press('Enter');
  }

  regionById(id: string): Locator {
    return this.page.locator(`[data-region-id="${id}"]`);
  }

  getUrlParams(): URLSearchParams {
    return new URL(this.page.url()).searchParams;
  }
}
