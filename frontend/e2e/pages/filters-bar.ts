import type { Page, Locator } from '@playwright/test';
import type { Since } from '../../src/state/url-state.js';

export class FiltersBar {
  readonly timeWindow: Locator;
  readonly notableOnly: Locator;
  readonly family: Locator;
  readonly species: Locator;

  constructor(page: Page) {
    // `exact: true` is mandatory on this page object. The SurfaceNav tab
    // labels ("Species view", "Family view") share substrings with the
    // filter input labels ("Species", "Family"). Without exact match,
    // getByLabel('Species') would match both the filter <input> and the
    // SurfaceNav tab button, causing an ambiguous-locator error.
    this.timeWindow = page.getByLabel('Time window', { exact: true });
    this.notableOnly = page.getByLabel('Notable only', { exact: true });
    this.family = page.getByLabel('Family', { exact: true });
    this.species = page.getByLabel('Species', { exact: true });
  }

  async selectTimeWindow(value: Since) {
    await this.timeWindow.selectOption(value);
  }

  async toggleNotable(check: boolean) {
    if (check) await this.notableOnly.check();
    else await this.notableOnly.uncheck();
  }

  async selectFamily(code: string) {
    await this.family.selectOption(code);
  }

  async setSpecies(name: string) {
    await this.species.fill(name);
  }
}
