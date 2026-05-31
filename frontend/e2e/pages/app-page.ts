import type { Page, Locator } from '@playwright/test';
import { FiltersBar } from './filters-bar.js';

export class AppPage {
  readonly filters: FiltersBar;
  readonly mainSurface: Locator;
  /** O1 (#776): the #map-layer div — receives `inert` at full snap / unscoped
   *  scrim, carries `aria-busy` (re-homed from <main>), and exposes
   *  `data-camera-bounds` / `data-scope-fitted` as e2e camera handles. */
  readonly mapLayer: Locator;
  readonly errorScreen: Locator;
  /**
   * Persistent header banner — transparent wrapper holding identity card +
   * controls pill. The header is `role="banner"` per ARIA landmark semantics.
   * #800: no tablist or tabs — the map is the always-mounted sole surface.
   */
  readonly appHeader: Locator;
  /** Filters trigger button in the controls pill (badge shows active-filter count). */
  readonly filtersTrigger: Locator;
  /** Theme toggle button in the controls pill. */
  readonly themeToggle: Locator;
  /** Credits & attribution trigger in the controls pill. */
  readonly attributionTrigger: Locator;

  // --- Scope chooser (landing surface, #742) accessors (C9/D6, #741) ---
  /** The `<ScopeChooser>` landing region (visible only on the unscoped/bare URL).
   *  Accessible name is the component's `aria-label`. */
  readonly chooser: Locator;
  /** ZIP `<input>` inside the chooser (`aria-label='ZIP code'`, owned by ZipInput). */
  readonly chooserZipInput: Locator;
  /** State `<select>` inside the chooser (`aria-label='State'` via its `<label>`). */
  readonly chooserStateSelect: Locator;
  /** The chooser state-path "Go" submit button. */
  readonly chooserStateGo: Locator;
  /** The de-emphasized "Explore the whole US map" escape-hatch button. */
  readonly chooserWholeUs: Locator;
  /** ZIP malformed inline hint inside the chooser ("Enter a 5-digit ZIP"). */
  readonly chooserZipError: Locator;
  /** ZIP `role=status` region inside the chooser ("ZIP not recognized — …"). */
  readonly chooserZipStatus: Locator;

  // --- In-state ScopeControl (on-map re-scope bar, #737) accessors ---
  /** The floating in-state `<ScopeControl>` region (visible only in a scoped view). */
  readonly scopeControl: Locator;
  /** The in-state state-switch `<select>` (`aria-label='Switch state'`). */
  readonly scopeControlStateSelect: Locator;
  /** The in-state niche "Whole US" escape hatch (state view only). */
  readonly scopeControlWholeUs: Locator;
  /** The "Change scope" exit affordance → returns to the chooser. */
  readonly scopeControlExit: Locator;

  // --- Shared narration / region surfaces ---
  /** The map's runtime region lede (`<p data-testid="map-lede">` in the AppHeader
   *  identity card, #800). Absent while loading (cold-load suppression #716),
   *  visible after /api/observations resolves. */
  readonly mapLede: Locator;
  /** The map canvas root (`data-testid='map-canvas'`). */
  readonly mapCanvas: Locator;
  /**
   * O4 (#780): Filters backdrop scrim (`data-testid='filters-backdrop'`).
   * Present in the DOM only while the filters panel is open (conditionally
   * rendered). Clicking it dismisses the panel — the e2e backdrop-dismiss
   * assertion drives this accessor rather than a raw `.filters-backdrop`
   * class locator, matching the POM convention for stable test hooks.
   */
  readonly filtersBackdrop: Locator;

  // --- O7 (#786): Data-fetch error overlay accessors ---
  /**
   * The floating error overlay (`data-testid='error-overlay'`). Present
   * only when `scopeActive && error && !dismissed`. Distinguished from
   * `errorScreen` (`.error-screen`) which is the GL-boundary fallback —
   * these are two separate failure classes.
   */
  readonly errorOverlay: Locator;
  /** The Retry button inside the error overlay (StatusBlock action prop). */
  readonly errorOverlayRetry: Locator;
  /** The Dismiss (×) button inside the error overlay. */
  readonly errorOverlayDismiss: Locator;

  // --- V1 (#788): Persistent-overlay exclusion-zone accessors ---
  /**
   * The FamilyLegend overlay (`.family-legend`). After O2 (#770) this is a
   * `position:fixed` App-root sibling, not a canvas child. O5 (#783) caps it
   * to ≤280px at ≤480px via `@media max-width:480px` — the physical fix for R6.
   * This accessor is used by marker-overlap.spec.ts to collect the overlay rect
   * and by safe-area.spec.ts indirectly (no direct use needed there).
   */
  readonly familyLegend: Locator;
  /**
   * The `.map-context-strip` in-flow section. After #800/#779 this class is
   * absent from the DOM on current `main` (strip removed per `styles.css:1313`).
   * Kept as a forward-compat accessor for O3 (relocation to floating card).
   * The locator safely returns 0 elements when the strip is not present.
   */
  readonly mapContextStrip: Locator;
  /**
   * The `SpeciesDetailSheet` element (`data-testid='species-detail-sheet'`).
   * Used by safe-area.spec.ts to assert bottom-edge flush alignment and the
   * authored CSS source for `env(safe-area-inset-bottom)`.
   */
  readonly speciesDetailSheet: Locator;

  constructor(public readonly page: Page) {
    this.filters = new FiltersBar(page);
    // Shared handle for the readiness surface in **Node test context**: every
    // `page.locator`-based spec must reference the surface through this accessor
    // instead of inlining `main#main-surface`, so the map-first inversion (#761)
    // re-points only this one line. Browser-context (`page.evaluate`) consumers
    // cannot use this Locator — a Playwright `Locator` does not cross into
    // `page.evaluate` — and instead select on the tag-AND-id-free
    // `[data-render-complete]` attribute (the one hook the inversion carries
    // forward onto whatever element becomes the readiness root).
    this.mainSurface = page.locator('main#main-surface');
    // O1 (#776): map-layer — the inert target, aria-busy node, and camera handle.
    this.mapLayer = page.locator('#map-layer');
    this.errorScreen = page.locator('.error-screen');
    this.appHeader = page.locator('header.app-header');
    // #800: appHeaderTabs removed — no tablist in the new corner-card header.
    this.filtersTrigger = this.appHeader.getByRole('button', { name: /^Filters/ });
    this.themeToggle = this.appHeader.getByRole('button', { name: /Switch to (light|dark) theme/ });
    this.attributionTrigger = this.appHeader.getByRole('button', { name: /Credits & attribution/ });

    // Chooser (#742) — region accessible name "Choose where to look at birds".
    this.chooser = page.getByRole('region', { name: 'Choose where to look at birds' });
    this.chooserZipInput = this.chooser.getByLabel('ZIP code', { exact: true });
    this.chooserStateSelect = this.chooser.getByLabel('State', { exact: true });
    this.chooserStateGo = this.chooser.getByRole('button', { name: 'Go', exact: true });
    this.chooserWholeUs = this.chooser.getByRole('button', { name: 'Explore the whole US map' });
    this.chooserZipError = this.chooser.getByText('Enter a 5-digit ZIP', { exact: true });
    this.chooserZipStatus = this.chooser.getByRole('status');

    // In-state ScopeControl (#737) — region accessible name "Change the map scope".
    this.scopeControl = page.getByRole('region', { name: 'Change the map scope' });
    this.scopeControlStateSelect = this.scopeControl.getByLabel('Switch state', { exact: true });
    this.scopeControlWholeUs = this.scopeControl.getByRole('button', { name: 'Whole US', exact: true });
    this.scopeControlExit = this.scopeControl.getByRole('button', { name: 'Change scope' });

    // #800: lede moved into AppHeader identity card as <p data-testid="map-lede">.
    this.mapLede = page.locator('[data-testid="map-lede"]');
    this.mapCanvas = page.locator('[data-testid="map-canvas"]');
    // O4 (#780): filters backdrop scrim — present only while filters panel is open.
    this.filtersBackdrop = page.getByTestId('filters-backdrop');

    // O7 (#786): data-fetch error overlay — present only when scoped + error + !dismissed.
    this.errorOverlay = page.getByTestId('error-overlay');
    this.errorOverlayRetry = this.errorOverlay.getByRole('button', { name: 'Retry' });
    this.errorOverlayDismiss = this.errorOverlay.getByRole('button', { name: 'Dismiss error' });

    // V1 (#788): persistent-overlay exclusion-zone accessors.
    // familyLegend: position:fixed App-root sibling after O2 (#770); capped ≤280px at ≤480px by O5 (#783).
    this.familyLegend = page.locator('.family-legend');
    // mapContextStrip: removed from DOM in #800/#779 (styles.css:1313); kept for O3 forward-compat.
    this.mapContextStrip = page.locator('.map-context-strip');
    // speciesDetailSheet: the bottom-sheet modal (data-testid per SpeciesDetailSheet.tsx:284).
    this.speciesDetailSheet = page.getByTestId('species-detail-sheet');
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
   * Wait for the map canvas to be visible — replaces the old `selectView('map')`
   * tab-click in tests that needed to assert "on the map view." Post-#800 there is
   * no tablist; the map is always mounted. Callers that previously used
   * `selectView('map')` should use `waitForMapLoad()` instead.
   */
  async waitForMapLoad(timeout = 10_000): Promise<void> {
    await this.mapCanvas.waitFor({ state: 'visible', timeout });
  }

  /**
   * Navigate to the app. #740 (C6) gated the map render behind a scope: a bare
   * URL (no `?state=`/`?scope=`) now lands on the <ScopeChooser>, NOT the map.
   * Pre-C6 these specs assumed a bare URL cold-loaded the CONUS national map —
   * which is now exactly the `?scope=us` whole-US view. To preserve what every
   * legacy map/detail spec actually tests, default to `scope=us` when the
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
   * Wait for the app to finish its initial data load. The readiness flag is
   * keyed on the `data-render-complete` **attribute** — NOT the `<main>`
   * landmark — which flips to `"true"` once `useBirdData`'s `loading` settles
   * to `false`. The selector is intentionally tag-agnostic
   * (`[data-render-complete="true"]`, no `main` qualifier) because the
   * map-first inversion (#761) may move the readiness-bearing element off
   * `<main>`; keying on the attribute keeps this gate valid across that move.
   * Replaces the legacy `[data-region-id]` count=9 gate that disappeared when
   * the map chain was deleted in #113.
   */
  async waitForAppReady(timeout = 10_000) {
    await this.page
      .locator('[data-render-complete="true"]')
      .waitFor({ state: 'attached', timeout });
  }

  getUrlParams(): URLSearchParams {
    return new URL(this.page.url()).searchParams;
  }

  /**
   * #761 (S1) / O1 (#776): assert the map surface is mounted but INERT behind
   * the chooser scrim on the unscoped landing. O1 retargeted `inert` from
   * `#main-surface` to `#map-layer` so the live MapLibre canvas is frozen, not
   * the near-empty <main> shell. Specs assert through this helper rather than
   * inlining the `[inert]` selector so future re-targets re-point only here.
   *
   * Returns the inertness assertion as a chainable `expect` so callers can
   * `await app.expectMapInert()`.
   */
  async expectMapInert(): Promise<void> {
    // The map canvas is present (mounted idle behind the scrim)…
    await this.mapCanvas.waitFor({ state: 'attached' });
    // …and #map-layer carries the `inert` attribute (O1 retarget from #main-surface).
    await this.mapLayer.and(this.page.locator('[inert]')).waitFor({ state: 'attached' });
  }

  /**
   * Pick a state from the chooser `<select>` + click Go (C9 state-select
   * round-trip). The select is the chooser's own (`aria-label='State'`); Go is
   * disabled until a non-empty option is chosen, so this selects first.
   */
  async pickStateInChooser(stateCode: string): Promise<void> {
    await this.chooserStateSelect.selectOption(stateCode);
    await this.chooserStateGo.click();
  }

  /**
   * Enter a ZIP into the chooser ZIP input and submit (the form submits on
   * Enter; `role=search` form, no separate Go button for the ZIP path). Used by
   * the D6 ZIP round-trip / empty-region / unknown / malformed cases.
   */
  async submitChooserZip(zip: string): Promise<void> {
    await this.chooserZipInput.fill(zip);
    await this.chooserZipInput.press('Enter');
  }
}
