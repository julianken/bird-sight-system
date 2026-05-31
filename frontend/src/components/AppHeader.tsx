/**
 * AppHeader — two floating corner clusters over the edge-to-edge map (#800 / #779 / #761).
 *
 * Design spec: docs/design/2026-05-30-floating-ui-design-spec.md §4.1–4.3.
 *
 * Previous design: a full-width top bar (`position:fixed; left:0; right:0`) with
 * a tablist holding a single "Map" nav tab. This violated the four-corner anchor
 * contract — a full-bleed band, not a corner card.
 *
 * New design: two independent tier-1 floating cards inside a transparent,
 * pointer-events-none `<header role="banner">` wrapper:
 *
 *   TOP-LEFT identity card (.app-header-identity-card) — one stacked card:
 *     1. Wordmark "Bird Maps" (link to /).
 *     2. Region name at --type-lg semibold (the PRIMARY text on a scoped view).
 *     3. Lede row: species count + freshness + source at --type-sm/--type-xs.
 *        THIS is where the formerly-invisible context-strip content now lives (#779).
 *     4. Hairline divider.
 *     5. Scope control rows (de-emphasized "change where" affordance, §4.2):
 *        folded ScopeControl content — state select, ZIP trigger, Whole US / Change scope.
 *        The header-height top-offset that the old ScopeControl required is deleted;
 *        the identity card is a corner card, not a band, so there is nothing to dodge.
 *
 *   TOP-RIGHT controls pill (.app-header-controls-pill) — compact content-width card:
 *     Filters trigger (+ active-count badge) · Attribution · Theme toggle.
 *     Filters is a labeled button at ≥1024, icon-only below.
 *
 * The old `role="tablist"` / `TABS` / `activeView` / `onSelectView` machinery is
 * entirely removed — the map is the always-mounted sole surface post-#688/#777.
 *
 * Responsive behaviour (driven by useBreakpoint()):
 *   wide (≥1024): Filters shows its text label; corner insets use --card-inset-wide.
 *   roomy (480–1024): Filters is icon-only; standard --card-inset gutters.
 *   compact (<480): wordmark collapses (brand only, region drops into lede row);
 *     scope control collapses to a single "Region ▾" affordance; icons only.
 *
 * Lede props (O3 #779) — carried from MapSurface into AppHeader so the formerly
 * invisible context-strip content renders in the identity card:
 *   - ledeText: the pre-rendered lede sentence (or null while loading / unscoped).
 *   - freshnessLabel: "331 species · updated 20 min ago · eBird" (or '').
 *
 * Scope-control props (§4.2) — ScopeControl content is now folded into the
 * bottom rows of this card. When `scope.kind === 'unscoped'` the scope rows
 * are hidden (chooser is the only affordance on the unscoped landing).
 */

import { ThemeToggle } from './ThemeToggle.js';
import type { ScopedView } from './ScopeControl.js';
import { ScopeControl } from './ScopeControl.js';
import type { StateSummary } from '@bird-watch/shared-types';
import type { Scope } from '../state/url-state.js';
import { useBreakpoint } from '../hooks/use-breakpoint.js';
import type { ScopeResolution } from '../state/scope-types.js';

export interface AppHeaderProps {
  /**
   * Runtime region label for the active scope (from `regionLabelFor`, #738/C5).
   * `null` ⟺ the unscoped/chooser landing — the region display is omitted.
   * Non-null is "USA" (`?scope=us`) or the resolved state name (`?state=`).
   */
  region: string | null;
  /** Active filter count — drives the numeric badge on the Filters trigger. */
  filterCount: number;
  /** Open the Filters panel. <App> owns the panel state; this component is presentational. */
  onOpenFilters: () => void;
  /** Open the Credits & Attribution modal. */
  onOpenAttribution: () => void;
  // ── Lede / context-strip props (O3 #779) ────────────────────────────────
  /**
   * Pre-rendered lede sentence from MapLede (e.g. "331 species seen across Arizona
   * in the last 14 days."). Null while loading, null when region=null (unscoped).
   * Rendered in the identity card at --type-sm as the lede row.
   */
  ledeText: string | null;
  /**
   * Pre-formatted freshness / source string from deriveFreshness (e.g.
   * "Updated 11 min ago · Source: eBird"). Empty string when not yet resolved.
   * Rendered in the identity card below the lede at --type-xs --color-text-subtle.
   */
  freshnessLabel: string;
  // ── Scope-control props (§4.2) ───────────────────────────────────────────
  /**
   * Active scope — determines whether scope rows are rendered. When
   * `kind === 'unscoped'` the scope rows are hidden (the chooser is the only
   * affordance on the unscoped landing).
   */
  scope: Scope;
  /** States list for the scope control <select>. Forwarded from App.tsx. */
  states: StateSummary[];
  /** Pick a state from the in-card scope control. */
  onPickState: (stateCode: string) => void;
  /** Switch to the whole-US scope from the in-card scope control. */
  onPickWholeUs: () => void;
  /** Exit to the chooser from the in-card scope control. */
  onExitScope: () => void;
  /** Resolve a ZIP code from the in-card scope control's ZIP input. */
  onResolveZip: (resolution: ScopeResolution) => void;
}

export function AppHeader({
  region,
  filterCount,
  onOpenFilters,
  onOpenAttribution,
  ledeText,
  freshnessLabel,
  scope,
  states,
  onPickState,
  onPickWholeUs,
  onExitScope,
  onResolveZip,
}: AppHeaderProps) {
  const bp = useBreakpoint();
  const scopeActive = scope.kind !== 'unscoped';
  const filterTriggerLabel =
    filterCount > 0 ? `Filters (${filterCount} active)` : 'Filters';
  // At wide (≥1024), Filters shows a text label; below it is icon-only.
  const filtersLabeled = bp === 'wide';

  return (
    // Transparent pointer-events-none wrapper preserves the ONE role="banner"
    // landmark while letting the map receive pointer events in the empty center.
    // Each cluster gets pointer-events: auto so they remain interactive.
    <header className="app-header" role="banner">
      {/* TOP-LEFT: identity card (wordmark + lede + scope rows) */}
      <div className="app-header-identity-card" aria-label="Bird Maps identity">
        {/* Row 1: Wordmark */}
        <a
          className="app-header-wordmark"
          href="/"
          aria-label={region ? `Bird Maps ${region} — home` : 'Bird Maps — home'}
        >
          Bird Maps
          {/* At compact (<480) the region drops to the lede row; keep it in the
              wordmark at roomy/wide. Spec: compact collapses to brand+region pill
              but that's the label in the lede row below, not a second inline span. */}
          {region && bp !== 'compact' && (
            <span className="brand-region" aria-hidden="true"> · {region}</span>
          )}
        </a>

        {/* Row 2: Region name — PRIMARY text (--type-lg semibold). Spec §5.2:
            this is the loudest element on a scoped view. Hidden when unscoped
            (chooser handles that) or at compact where it merges with the lede. */}
        {region && bp !== 'compact' && (
          <p className="app-header-region-name" aria-hidden="true">
            {region}
          </p>
        )}

        {/* Row 3: Lede text + freshness (O3 #779 — the formerly invisible context strip).
            The lede is visible here for the first time; the old in-flow
            .map-context-strip band is removed from MapSurface. */}
        {ledeText && (
          <div className="app-header-lede-row">
            <p className="app-header-lede">{ledeText}</p>
            {freshnessLabel && (
              <p className="app-header-freshness">{freshnessLabel}</p>
            )}
          </div>
        )}

        {/* Hairline divider — only visible when scope rows follow */}
        {scopeActive && <hr className="app-header-divider" aria-hidden="true" />}

        {/* Rows 4+: Scope control (§4.2) — de-emphasized "change where" rows.
            Folded directly into the identity card; no longer a separate top-center
            band with a header-height offset. */}
        {scopeActive && (
          <div className="app-header-scope-rows">
            <ScopeControl
              scope={scope as ScopedView}
              states={states}
              onPickState={onPickState}
              onPickWholeUs={onPickWholeUs}
              onExit={onExitScope}
              onResolve={onResolveZip}
              embedded
            />
          </div>
        )}
      </div>

      {/* TOP-RIGHT: controls pill (Filters · Attribution · Theme toggle) */}
      <div className="app-header-controls-pill">
        <button
          type="button"
          className="app-header-attribution"
          onClick={onOpenAttribution}
          aria-label="Credits & attribution"
        >
          <svg
            className="app-header-btn-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          {filtersLabeled && (
            <span className="app-header-btn-label">Attribution</span>
          )}
        </button>

        <button
          type="button"
          className="app-header-filters"
          onClick={onOpenFilters}
          aria-label={filterTriggerLabel}
        >
          <svg
            className="app-header-btn-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          {filtersLabeled && (
            <span className="app-header-btn-label">Filters</span>
          )}
          {filterCount > 0 && (
            <span className="app-header-filter-badge" aria-hidden="true">
              {filterCount}
            </span>
          )}
        </button>

        <ThemeToggle />
      </div>
    </header>
  );
}
