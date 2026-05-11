import type { Page, Locator } from '@playwright/test';
import type { Since } from '../../src/state/url-state.js';

export class FiltersBar {
  readonly timeWindow: Locator;
  readonly notableOnly: Locator;
  readonly family: Locator;
  readonly species: Locator;

  constructor(page: Page) {
    // Phase 3: FiltersBar is rendered inside a filters panel
    // (`<div class="filters-panel" role="region" aria-label="Filters">`)
    // that is only mounted when the user opens the Filters drawer via the
    // AppHeader trigger. Scope every locator to that panel so:
    //   (a) locators resolve only when the panel is open, giving a clear
    //       "element not attached" error if a test forgets openFilters(), and
    //   (b) `exact: true` is preserved — SurfaceNav tab accessible names
    //       ("Species view", "Family view") still share substrings with
    //       filter labels; the panel scope adds a second layer of protection.
    const panel = page.getByRole('region', { name: 'Filters' });
    this.timeWindow = panel.getByLabel('Time window', { exact: true });
    this.notableOnly = panel.getByLabel('Notable only', { exact: true });
    this.family = panel.getByLabel('Family', { exact: true });
    this.species = panel.getByLabel('Species', { exact: true });
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
