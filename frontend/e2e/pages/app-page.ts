import type { Page, Locator } from '@playwright/test';
import { FiltersBar } from './filters-bar.js';

export class AppPage {
  readonly filters: FiltersBar;
  readonly mainSurface: Locator;
  readonly errorScreen: Locator;
  /** Persistent header chrome — wordmark, tablist, action buttons. */
  readonly appHeader: Locator;
  /** Surface tabs inside appHeader (Map). Feed removed in #662; Species in #688. */
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

  /**
   * Open the Filters panel via the AppHeader trigger and wait for the
   * panel to be visible. Phase 3 renders FiltersBar only inside this
   * panel, so any test that needs to interact with or assert filter
   * controls must call this first.
   *
   * Effectively idempotent: if the panel is already open, clicking the
   * trigger calls `setFiltersOpen(true)` again (a no-op in React state),
   * and `waitFor({ state: 'visible' })` resolves immediately. In practice,
   * call this once per test that needs filter access — the panel stays open
   * until the test ends or the Close button is clicked.
   */
  async openFilters(): Promise<void> {
    const panel = this.page.getByRole('region', { name: 'Filters' });
    // Guard: if the panel is already visible (e.g., test parallelism left it
    // open from a prior interaction in the same browser context), skip the
    // trigger click to avoid a double-open no-op that could race on slow CI.
    const alreadyOpen = await panel.isVisible().catch(() => false);
    if (!alreadyOpen) {
      await this.filtersTrigger.click();
      await panel.waitFor({ state: 'visible' });
    }
  }

  /**
   * Navigate to a surface by tab name. Only the Map tab remains in the
   * header post-#688 (Species removed); Feed was removed in #662.
   */
  async selectView(view: 'map'): Promise<void> {
    const labelMap = { map: 'Map view' };
    await this.appHeader.getByRole('tab', { name: labelMap[view] }).click();
  }

  /**
   * Navigate to the app. #740 (C6) gated the map render behind a scope: a bare
   * URL (no `?state=`/`?scope=`) now lands on the <ScopeChooser>, NOT the map.
   * Pre-C6 these specs assumed a bare URL cold-loaded the CONUS national map —
   * which is now exactly the `?scope=us` whole-US view. To preserve what every
   * legacy feed/map/detail spec actually tests, default to `scope=us` when the
   * caller passes no explicit scope. Specs that DO exercise the chooser / a
   * specific scope (e.g. `goto('scope=us')`, `goto('state=US-AZ')`, or the
   * dedicated unscoped-chooser spec via `gotoRaw`) pass their own scope and are
   * untouched. This keeps the e2e suite green on the C6 PR without each map
   * spec having to thread `scope=us` (the C9/#741 scope specs own the chooser
   * + scope-transition coverage explicitly).
   */
  async goto(query = '') {
    const hasScope = /(^|&)(scope|state)=/.test(query);
    const effective = hasScope ? query : query ? `${query}&scope=us` : 'scope=us';
    await this.page.goto(`/?${effective}`);
  }

  /**
   * Navigate to a literal URL with NO default-scope injection — for specs that
   * deliberately land on the unscoped chooser (C9/#741) or assert raw URL
   * handling. `goto('')` would inject `scope=us`; `gotoRaw('')` does not.
   */
  async gotoRaw(query = '') {
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
