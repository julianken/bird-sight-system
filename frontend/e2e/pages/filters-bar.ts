import type { Page, Locator } from '@playwright/test';

export class FiltersBar {
  readonly timeWindow: Locator;
  readonly notableOnly: Locator;
  readonly family: Locator;
  readonly species: Locator;

  constructor(page: Page) {
    this.timeWindow = page.getByLabel('Time window');
    this.notableOnly = page.getByLabel('Notable only');
    this.family = page.getByLabel('Family');
    this.species = page.getByLabel('Species');
  }

  async selectTimeWindow(value: '1d' | '7d' | '14d' | '30d') {
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
