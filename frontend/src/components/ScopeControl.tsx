import type { StateSummary } from '@bird-watch/shared-types';
import type { Scope } from '../state/url-state.js';
import { ZipInput } from './ZipInput.js';
import type { ScopeResolution } from '../state/scope-types.js';
import React from 'react';

/**
 * In-state on-map scope control (Task C4, #737).
 *
 * The FLOATING re-scope bar — rendered ONLY after a scope is chosen, i.e. in a
 * `?state=US-XX` state view or a `?scope=us` whole-US view. It is NEVER the
 * pre-map landing chooser (that is `<ScopeChooser>`, #742). It floats over the
 * map canvas (absolutely positioned overlay anchored top, above the basemap via
 * the `--z-overlay` tier the other map-assist overlays use) and lets a user
 * re-scope without going back to the chooser:
 *   - a native `<select>` StateSelector (no combobox lib — repo pattern),
 *   - the existing `<ZipInput>` (#739), reused not re-implemented,
 *   - a small, DE-EMPHASIZED exit affordance ("Change scope" → chooser) and,
 *     in a state view, a niche "Whole US" escape hatch (→ `?scope=us`).
 *
 * Ownership boundary (contract note, #737): ScopeControl is PURELY
 * PRESENTATIONAL. It does NOT own scope state, does NOT read/write the URL, and
 * — critically — NEVER touches the map. In particular it does NOT call
 * `map.setMaxBounds()`: per the C0 prototype's finding (a) + the C1 maplibre-5.x
 * notes §1, `maxBounds` is a REACTIVE camera prop owned by #736/C3. ScopeControl
 * only EMITS the new state code via `onPickState`; the parent (#740/C6) turns
 * that into URL writes + a `bounds`/`maxBounds` prop change, which flows to the
 * `<Map>` WITHOUT A REMOUNT. That no-remount-on-state-switch behaviour is the
 * whole point of this in-state control (prototype finding (a)).
 *
 * It also triggers NO data fetch: #740/C6 owns the "one refetch per scope
 * change" invariant (finding (d)). ScopeControl just emits one clean intent per
 * user action (`onPickState` / `onResolve` / `onPickWholeUs` / `onExit`).
 *
 * Camera hand-off (AC 5): because this control FLOATS over the canvas, #736/C3's
 * `fitBounds` top-padding must be ASYMMETRIC — top padding ≈ this bar's height —
 * so the framed state isn't occluded by the control. Flagged in the PR.
 */

/** The scopes in which ScopeControl is mounted — never `unscoped` (that view
 *  renders the chooser, not this control). A narrowing of `Scope` (#735). */
export type ScopedView = Exclude<Scope, { kind: 'unscoped' }>;

export interface ScopeControlProps {
  /** Current resolved scope — either a `?state=US-XX` view or the `?scope=us`
   *  whole-US view. Drives the selected `<select>` option and whether the
   *  niche "Whole US" affordance is shown. */
  scope: ScopedView;
  /** States for the `<select>`. The caller supplies the result of
   *  `GET /api/states` (#732) — `StateSummary[]`, already name-sorted by the
   *  endpoint. ScopeControl does NOT fetch this. */
  states: StateSummary[];
  /** State `<select>` path: emits the chosen `US-XX` code. The parent
   *  (#740/C6) turns it into a `?state=` write + a reactive camera change. */
  onPickState: (stateCode: string) => void;
  /** Niche whole-US escape hatch: emits the `?scope=us` intent. Only shown in
   *  a state view (in a whole-US view it would be a no-op self-link). */
  onPickWholeUs: () => void;
  /** Exit affordance: clears the scope, returning to the chooser (`unscoped`). */
  onExit: () => void;
  /** ZIP path: the resolved `ScopeResolution` from the embedded `<ZipInput>`,
   *  forwarded straight up (#740 turns it into `?state=US-XX` + a `flyTo` at
   *  `ZIP_FLYTO_ZOOM`). ScopeControl is a pass-through here. */
  onResolve: (scope: ScopeResolution) => void;
  /**
   * When `true`, the component is rendered EMBEDDED inside the AppHeader
   * identity card (§4.2) and does NOT apply the old absolute-positioned
   * `.scope-control` wrapper (the positioning is owned by the identity card).
   * When `false` (the default), the old standalone floating-overlay behaviour
   * is preserved for callers that still use the standalone control.
   *
   * #800: The standalone usage in App.tsx is removed in this PR; the prop
   * exists only to avoid needing two separate component files.
   */
  embedded?: boolean;
}

function ScopeControlImpl(
  {
    scope,
    states,
    onPickState,
    onPickWholeUs,
    onExit,
    onResolve,
    embedded = false,
  }: ScopeControlProps,
  // #837: forwarded ref to the FIRST field (the state <select>). AppHeader's
  // open-the-disclosure effect focuses this directly instead of a fragile
  // `scopeRowsRef.querySelector('select')` DOM-order lookup — focus follows the
  // declared first field, not whatever tag happens to come first in the tree.
  firstFieldRef: React.ForwardedRef<HTMLSelectElement>,
): React.JSX.Element {
  // In a state view the current state is the selected option; in a whole-US
  // view the neutral placeholder ("") is selected (no state is active).
  const selectedState = scope.kind === 'state' ? scope.stateCode : '';

  // WCAG 3.2.2 (On Input, #1035): the <select> sets a TRANSIENT local value;
  // changing it never navigates. An explicit Go button / Enter (form submit)
  // commits the pending value via `onPickState`. This mirrors the landing
  // chooser (ScopeChooser) so both pointer and keyboard use the same commit
  // model — `change` is inert for every input modality, so keyboard arrow-browse
  // through options no longer yanks scope mid-browse. The pending value is
  // seeded from (and re-syncs to) the current scope so the displayed selection
  // tracks the active scope until the user stages a different one.
  const [pendingState, setPendingState] = React.useState(selectedState);
  React.useEffect(() => {
    setPendingState(selectedState);
  }, [selectedState]);

  function handleStateSubmit(e: React.FormEvent): void {
    e.preventDefault();
    // The placeholder (value "") is never a valid scope — Go is disabled there,
    // but guard the submit path too (Enter could otherwise fire on an empty
    // selection).
    if (pendingState) onPickState(pendingState);
  }

  // When embedded inside the identity card, use a class that does NOT apply
  // the old absolute-positioned overlay CSS. The identity card owns the layout.
  const wrapperClass = embedded ? 'scope-control scope-control--embedded' : 'scope-control';

  return (
    <section
      className={wrapperClass}
      role="region"
      aria-label="Change the map scope"
    >
      {/* WCAG 3.2.2 (#1035): the select stages a pending value; an explicit Go
          (or Enter, via this form's submit) commits it. `change` never
          navigates — same commit model for pointer and keyboard. */}
      <form className="scope-control__state-form" onSubmit={handleStateSubmit}>
        <select
          ref={firstFieldRef}
          className="scope-control__select"
          aria-label="Switch state"
          value={pendingState}
          // Inert on change: only stage the selection locally (no navigation).
          onChange={(e) => setPendingState(e.target.value)}
        >
          <option value="">Switch state…</option>
          {states.map((s) => (
            <option key={s.stateCode} value={s.stateCode}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="scope-control__go"
          // Inert while the placeholder is selected — there is nothing to commit.
          disabled={!pendingState}
        >
          Go
        </button>
      </form>

      {/* <ZipInput> (#739) owns the ZIP input, lazy index load, lookup, and the
          "not recognized" / malformed / fetch-error UX. ScopeControl forwards
          its onResolve straight up — it never owns ZIP state or duplicates the
          ZIP copy. */}
      <div className="scope-control__zip">
        <ZipInput onResolve={onResolve} />
      </div>

      {/* De-emphasized exit affordances, visually subordinate to the state/ZIP
          inputs (link-like, lower weight — not filled buttons). */}
      <div className="scope-control__exit-group">
        {scope.kind === 'state' && (
          <button
            type="button"
            className="scope-control__wholeus"
            onClick={onPickWholeUs}
          >
            Whole US
          </button>
        )}
        <button
          type="button"
          className="scope-control__exit"
          onClick={onExit}
        >
          Change scope
        </button>
      </div>
    </section>
  );
}

/**
 * O8 (#784): React.memo boundary — prevents re-renders when AppHeader
 * re-renders due to unrelated App-level state (e.g. nowTick / visibilitychange
 * / freshnessLabel updates) but ScopeControl's own props are unchanged.
 * All props are primitives or useCallback-stable references; the scope object
 * reference is stable when no scope-change has occurred (it's the same useState
 * identity from useUrlState). Default shallow comparison short-circuits on a
 * same-minute nowTick bump.
 *
 * #837: wrapped in forwardRef so AppHeader can hand a ref to the first field
 * (the state <select>) for robust focus-on-open. memo(forwardRef(...)) keeps the
 * O8 re-render boundary while threading the ref through.
 */
export const ScopeControl = React.memo(React.forwardRef(ScopeControlImpl));
ScopeControl.displayName = 'ScopeControl';
