import type { Page, Locator } from '@playwright/test';
import type { Since } from '../../src/state/url-state.js';

export class FiltersBar {
  readonly timeWindow: Locator;
  readonly notableOnly: Locator;
  readonly family: Locator;
  readonly species: Locator;

  constructor(page: Page) {
    // Phase 3: FiltersBar is rendered inside a filters panel
    // (`<div class="filters-panel" role="dialog" aria-label="Filters">`)
    // that is only mounted when the user opens the Filters drawer via the
    // AppHeader trigger. Scope every locator to that panel so locators
    // resolve only when the panel is open, giving a clear "element not
    // attached" error if a test forgets openFilters(). `exact: true` on
    // every getByLabel call is preserved as a belt-and-braces precaution
    // against ambient label collisions (header buttons, modal contents,
    // future tablist entries).
    // #1033 C51: upgraded from role="region" to role="dialog" so that
    // aria-haspopup="dialog" on the trigger is truthful.
    const panel = page.getByRole('dialog', { name: 'Filters' });
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
