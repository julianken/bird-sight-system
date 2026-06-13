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
 *   TOP-LEFT identity card (.app-header-identity-card) — one stacked card,
 *   TWO LINES at rest (#828):
 *     1. Wordmark row: "Bird Maps · {Region}" + a 🔍 disclosure trigger.
 *        The visible region rides here (the loudest text); a visually-hidden
 *        <h1>{Region}</h1> sits alongside for heading structure (A11Y-3).
 *     2. Lede row: a COUNT-ONLY sentence ("331 species") at --type-sm (#828 —
 *        region + time-window dropped; the region is now the wordmark headline).
 *     ── below the fold, revealed by the 🔍 disclosure (mounted, CSS-hidden when
 *        collapsed) ──
 *     3. Hairline divider (only visible when the disclosure is open).
 *     4. Scope control rows (de-emphasized "change where" affordance, §4.2):
 *        folded ScopeControl content — state select, ZIP trigger, Whole US / Change scope.
 *        Collapsed behind the disclosure so the resting card stays two lines (#828);
 *        🔍 toggles to ✕, focus moves to the state <select> on open, Esc closes and
 *        restores focus to the trigger, and there is NO click-outside-to-close
 *        (a stray map click must not discard a half-typed ZIP). The freshness line
 *        was removed entirely (#828) — source/licensing lives in the bottom-right
 *        attribution and recency isn't worth a permanent line on a minimized card.
 *
 *   TOP-RIGHT controls pill (.app-header-controls-pill) — compact content-width card:
 *     Filters trigger (+ active-count badge) · ⓘ Credits · Theme toggle.
 *     Order: Filters first per spec §3/§5.2 (#1033 V1/V18).
 *     Filters shows a text label at ≥1024, icon-only below.
 *     ⓘ Credits is icon-only at ALL widths (#1033 V1/V18 — the always-visible
 *     bottom-right pill already carries eBird/OpenFreeMap credit).
 *
 * The old `role="tablist"` / `TABS` / `activeView` / `onSelectView` machinery is
 * entirely removed — the map is the always-mounted sole surface post-#688/#777.
 *
 * Responsive behaviour (driven by useBreakpoint()):
 *   The resting card is TWO LINES at EVERY breakpoint (#828) — the region rides
 *   in the wordmark line and the scope form is collapsed behind the disclosure —
 *   so the layout is near-identical across the canonical viewport set. The only
 *   per-breakpoint variation is in the top-right controls pill:
 *   wide (≥1024): Filters shows text label; corner insets use --card-inset-wide.
 *   roomy/compact (<1024): Filters is icon-only; standard --card-inset gutters.
 *
 * Lede prop (O3 #779 / #828) — carried from MapSurface into AppHeader so the
 * formerly invisible context-strip content renders in the identity card:
 *   - ledeText: the pre-rendered COUNT-ONLY lede ("331 species") or null while
 *     loading / unscoped. Region + time-window were dropped in #828.
 *
 * The always-visible eBird + OpenFreeMap attribution does NOT live in this card
 * (#828 removed the freshness line that #830 had hosted the eBird link in); it
 * is restored to the bottom-right corner as App-root chrome (.map-attribution,
 * four-corner contract §4.8). The full credits stay in the top-right ⓘ modal.
 *
 * Scope-control props (§4.2) — ScopeControl content is folded into the bottom
 * rows of this card, behind the 🔍 disclosure (#828). When `scope.kind ===
 * 'unscoped'` the disclosure + scope rows are hidden (the chooser is the only
 * affordance on the unscoped landing).
 */

import type { KeyboardEvent, RefObject } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  /**
   * Whether the Filters panel is currently open. Drives `aria-expanded` on the
   * Filters trigger so screen readers announce the modality and its state.
   * No `aria-controls` — the sheet is conditionally rendered, so an IDREF to
   * an absent element fails axe `aria-valid-attr-value`. Matches the
   * `AttributionModal`/`AdaptiveGridMarker` precedent: `haspopup`+`expanded`
   * alone conveys the modality for a conditionally-mounted dialog (O4 #780).
   */
  filtersOpen: boolean;
  /**
   * Whether a species detail surface (sheet/rail) is open — App derives this
   * from `?detail=` presence (`!!state.detail`). E5 (#1057): drives the scope
   * disclosure's auto-collapse so a detail surface taking over closes the
   * expanded scope card (spec §5.1 COMPACT — at most one expanded surface).
   */
  detailOpen: boolean;
  /**
   * Ref forwarded to the Filters trigger button. App.tsx holds this so it can
   * restore focus to the trigger when the filters sheet is dismissed (O4 #780).
   * The button is always mounted (in the persistent controls pill), so `.current`
   * is reliably non-null whenever the useLayoutEffect close path fires.
   */
  filtersTriggerRef: RefObject<HTMLButtonElement>;
  /** Open the Credits modal (ⓘ trigger in the controls pill). */
  onOpenAttribution: () => void;
  // ── Lede / context-strip props (O3 #779 / #828) ─────────────────────────
  /**
   * Pre-rendered COUNT-ONLY lede sentence (e.g. "331 species") from the
   * `ledeText` useMemo in App.tsx. Null while loading, null when region=null
   * (unscoped). Rendered in the identity card at --type-sm as the lede row.
   * #828: the region + time-window were dropped — the region is the wordmark
   * headline and the window is discoverable via Filters.
   */
  ledeText: string | null;
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
  filtersOpen,
  detailOpen,
  filtersTriggerRef,
  onOpenAttribution,
  ledeText,
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

  // ── Scope disclosure (#828) ──────────────────────────────────────────────
  // The scope form collapses behind a 🔍 trigger on the wordmark row and
  // expands IN PLACE (the card is already a flex column). State is component-
  // local — re-scoping is the persisted action, not the panel's open/closed
  // state, so this does NOT belong in the URL. Spec §7 (disclosure pattern).
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRegionId = useId();
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const scopeRowsRef = useRef<HTMLDivElement>(null);
  // #837: ref to the FIRST scope field (the state <select>), forwarded into
  // ScopeControl. The open-effect focuses this directly instead of a fragile
  // `scopeRowsRef.querySelector('select')` DOM-order query — focus tracks the
  // declared first field, immune to future field-order changes in ScopeControl.
  const firstScopeFieldRef = useRef<HTMLSelectElement>(null);

  // Open → move focus to the first field (the state <select>); spec §7. Runs
  // only on the open edge so re-renders while open don't steal focus.
  useEffect(() => {
    if (scopeOpen) {
      firstScopeFieldRef.current?.focus();
    }
  }, [scopeOpen]);

  // If the scope goes inactive (→ unscoped chooser) while the disclosure is
  // open, reset to collapsed so a later re-scope starts closed (the trigger is
  // unmounted on the unscoped landing, so the open state would otherwise
  // persist invisibly).
  useEffect(() => {
    if (!scopeActive) setScopeOpen(false);
  }, [scopeActive]);

  // E5 (#1057): auto-collapse the disclosure when ANOTHER surface takes over —
  // the Filters sheet opening or a species-detail surface opening. Spec §5.1
  // COMPACT requires at most one expanded surface; on a ≤480 phone an open
  // scope card + an open Filters/detail sheet violated that. We collapse only
  // on the RISING EDGE of each signal (false→true) — NOT whenever the signal
  // is true — so the user can deliberately re-open the scope form while the
  // other surface is still up without it being slammed shut on the next
  // unrelated re-render. This is the SURFACE-TAKEOVER intent, deliberately
  // distinct from the PRESERVED no-click-outside rule: a stray map click must
  // still not discard a half-typed ZIP, but a Filters/detail tap is a clear
  // "switch surfaces" intent. Source signals are pinned (per the issue's
  // reviewer addenda) to the existing `filtersOpen` prop and the `detailOpen`
  // boolean App derives from `?detail=` presence — no new context.
  const prevFiltersOpen = useRef(filtersOpen);
  const prevDetailOpen = useRef(detailOpen);
  useEffect(() => {
    const filtersRising = filtersOpen && !prevFiltersOpen.current;
    const detailRising = detailOpen && !prevDetailOpen.current;
    prevFiltersOpen.current = filtersOpen;
    prevDetailOpen.current = detailOpen;
    if (filtersRising || detailRising) setScopeOpen(false);
  }, [filtersOpen, detailOpen]);

  // E5 (#1057): a successful state COMMIT collapses the disclosure — the user
  // is "done" choosing a scope. We hook the COMMIT path (`onPickState`), NOT
  // the raw `change` event: sibling #1035 moved that commit from
  // change-navigates to an explicit Go/Enter submit, so wrapping `onPickState`
  // here composes with #1035 in either merge order (in both worlds it stays the
  // commit callback). The wrapped handler forwards to the real `onPickState`
  // and then collapses.
  const handlePickState = useCallback(
    (stateCode: string) => {
      onPickState(stateCode);
      setScopeOpen(false);
    },
    [onPickState],
  );

  // Esc collapses + restores focus to the trigger (spec §7). NO click-outside:
  // a stray map click must not discard a half-typed ZIP. Handler lives on the
  // identity card so Esc closes from any field inside the form OR from the
  // trigger itself; guarded on `scopeOpen` so a stray Esc on the resting card
  // (e.g. while a popover elsewhere is the real Esc target) is a no-op here.
  const onCardKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && scopeOpen) {
      e.stopPropagation();
      setScopeOpen(false);
      scopeTriggerRef.current?.focus();
    }
  }, [scopeOpen]);

  return (
    // Transparent pointer-events-none wrapper preserves the ONE role="banner"
    // landmark while letting the map receive pointer events in the empty center.
    // Each cluster gets pointer-events: auto so they remain interactive.
    <header className="app-header" role="banner">
      {/* TOP-LEFT: identity card (wordmark+region+lede; scope behind disclosure) */}
      <div
        className="app-header-identity-card"
        aria-label="Bird Maps identity"
        onKeyDown={onCardKeyDown}
      >
        {/* Row 1: Wordmark line — "Bird Maps · {Region}" + the 🔍 disclosure.
            The region rides here (the loudest text on a scoped view, #828); the
            scope form collapses behind the search trigger. */}
        <div className="app-header-wordmark-row">
          <a
            className="app-header-wordmark"
            href="/"
            aria-label={region ? `Bird Maps ${region} — home` : 'Bird Maps — home'}
          >
            Bird Maps
            {/* #828: the visible region rides in the wordmark line at EVERY
                breakpoint (the resting card is two lines everywhere). The
                matching <h1> below is sr-only so the region isn't read twice.
                #1057: the " · " separator is painted by `.brand-region::before`
                (CSS), NOT a literal text node, so "· {region}" wraps as one
                unbreakable unit and never orphans a hanging "·" at a line end.
                The JSX MUST NOT also carry the literal "· " here (it would
                double-render the dot). */}
            {region && (
              <span className="brand-region" aria-hidden="true">{region}</span>
            )}
          </a>

          {/* 🔍/✕ scope disclosure — only on a scoped view (the unscoped landing
              has no scope form; the chooser is the sole affordance there). The
              disclosure pattern (spec §7): aria-expanded + aria-controls pointing
              at the mounted-but-hidden scope region (a valid IDREF, unlike the
              conditionally-rendered Filters dialog which omits aria-controls). */}
          {scopeActive && (
            <button
              ref={scopeTriggerRef}
              type="button"
              className="app-header-scope-toggle"
              onClick={() => setScopeOpen(o => !o)}
              aria-expanded={scopeOpen}
              aria-controls={scopeRegionId}
              aria-label={scopeOpen ? 'Close scope options' : 'Change region'}
            >
              {scopeOpen ? (
                <svg
                  className="app-header-btn-icon"
                  width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              ) : (
                <svg
                  className="app-header-btn-icon"
                  width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* Region name — preserved as the page's single <h1> for heading
            structure (A11Y-3), but visually hidden at EVERY breakpoint (#828):
            the visible "Arizona" lives in the wordmark line above, so the <h1>
            is sr-only to avoid reading the region twice. Omitted when region is
            null (unscoped — the chooser handles scope narration there). */}
        {region && (
          <h1 className="app-header-region-name sr-only">
            {region}
          </h1>
        )}

        {/* Scope-change live region (#760/#762 — carried from MapLede): announces
            the active region to screen readers on chooser→state and state→state
            transitions WITHOUT requiring a focus move. The same `role="status"
            aria-live="polite"` contract that MapLede.tsx previously provided.
            Renders whenever region is non-null (including during cold-load
            suppression when ledeText is null, matching MapLede's original
            unconditional announcement semantics). */}
        {region && (
          <span className="sr-only" role="status" aria-live="polite">
            Showing {region}.
          </span>
        )}

        {/* Row 2: Lede — a COUNT-ONLY sentence (#828; region + window dropped).
            The old in-flow .map-context-strip band is removed from MapSurface.
            data-testid="map-lede" is the stable test hook for e2e specs
            (#716 suppression contract: absent while loading, visible after). */}
        {ledeText && (
          <div className="app-header-lede-row">
            <p className="app-header-lede" data-testid="map-lede">{ledeText}</p>
          </div>
        )}

        {/* Scope disclosure body (§4.2 / #828 / #951) — MOUNTED whenever scope is
            active (so aria-controls has a valid target) but CSS-collapsed until
            the 🔍 trigger opens it. `data-open` drives the catalog #07
            panel-reveal (.t-panel-slide, styles.css): the rows REST at the
            VISIBLE open end-state and are only offset (translate/opacity/blur +
            visibility:hidden) while closed, so the global reduced-motion guard —
            which zeroes the interpolation, not the start value — lands them
            fully visible on open. The element is always painted (visibility,
            not display:none), so the synchronous data-open flip tweens without a
            post-paint rAF. visibility:hidden at rest keeps the closed form out of
            the a11y tree + tab order AND satisfies Playwright toBeHidden() (an
            `inert`-only rest would still occupy layout and fail those #951 asserts).
            The Esc handler lives here so a press from any field (or the trigger)
            collapses + restores focus. NO click-outside (a stray map click must
            not lose a typed ZIP). The divider only renders when open — the
            resting card is two lines. */}
        {scopeActive && (
          /* #975: grid 0fr↔1fr CLIP wrapper. The inner .t-panel-slide keeps the
             UNCHANGED #07 reveal (transform/opacity/blur + visibility); this
             wrapper is the height-collapse mechanism. Closed → 0fr track →
             the in-flow form contributes ZERO layout height, so the identity
             card shrinks to wordmark + lede + padding (no empty band). The
             id/ref/aria-controls target stays on the INNER element so the a11y
             contract + Page-Object selectors are untouched. The residual parent
             flex `gap` band below the lede (which would survive a 0fr collapse)
             is cancelled by a negative top-margin on the clip WHEN CLOSED — see
             styles.css `.app-header-scope-clip[data-open='false']`. */
          <div className="app-header-scope-clip" data-open={scopeOpen}>
            <div
              id={scopeRegionId}
              ref={scopeRowsRef}
              className="app-header-scope-rows t-panel-slide"
              data-open={scopeOpen}
            >
              {/* Divider only renders when open — the resting card is two lines.
                  (The ScopeControl below stays mounted regardless so aria-controls
                  always resolves to a present target.) */}
              {scopeOpen && <hr className="app-header-divider" aria-hidden="true" />}
              <ScopeControl
                ref={firstScopeFieldRef}
                scope={scope as ScopedView}
                states={states}
                onPickState={handlePickState}
                onPickWholeUs={onPickWholeUs}
                onExit={onExitScope}
                onResolve={onResolveZip}
                embedded
              />
            </div>
          </div>
        )}
      </div>

      {/* TOP-RIGHT: controls pill (Filters · ⓘ Credits · Theme toggle).
          Order: Filters first per spec §3/§5.2 (#1033 V1/V18); attribution
          demoted to icon-only ⓘ at all widths, label shortened to "Credits"
          (the always-visible bottom-right pill already shows eBird/OpenFreeMap
          so the full "Credits & attribution" prose is redundant here). */}
      <div className="app-header-controls-pill">
        <button
          ref={filtersTriggerRef}
          type="button"
          className="app-header-filters"
          onClick={onOpenFilters}
          aria-label={filterTriggerLabel}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
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

        <button
          type="button"
          className="app-header-attribution"
          onClick={onOpenAttribution}
          aria-label="Credits"
          // #830 item E: this opens a showModal() dialog rendered in the top
          // layer, so it carries aria-haspopup="dialog" but INTENTIONALLY omits
          // aria-expanded — a deliberate divergence from .app-header-filters
          // (an inline disclosure). Do NOT "fix" to match filters.
          // #1033 V1/V18: icon-only at all widths (no text label rendered even
          // at wide breakpoints) — the "Credits & attribution" prose was moved
          // to the bottom-right attribution pill which already carries the
          // always-visible eBird/OpenFreeMap credit.
          aria-haspopup="dialog"
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
        </button>

        <ThemeToggle />
      </div>
    </header>
  );
}
