import type { Page, Locator } from '@playwright/test';
import type { Since } from '../../src/state/url-state.js';

export class FiltersBar {
  readonly timeWindow: Locator;
  readonly notableOnly: Locator;
  readonly family: Locator;
  readonly species: Locator;

  constructor(page: Page) {
    // `exact: true` is mandatory on this page object. BadgeStack renders an
    // overflow-pip <g role="img" aria-label="N more species — expand region
    // to view"> whenever a polygon is too small to host every species badge
    // at MIN_BADGE_DIAMETER (see issue #59) — the substring "Species" /
    // "species" in that label collides with the filter input's aria-label.
    // Exact match keeps this locator pinned to the form control.
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
