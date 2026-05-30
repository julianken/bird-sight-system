import type { StateSummary } from '@bird-watch/shared-types';
import type { Scope } from '../state/url-state.js';
import { ZipInput } from './ZipInput.js';
import type { ScopeResolution } from '../state/scope-types.js';

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
}

export function ScopeControl({
  scope,
  states,
  onPickState,
  onPickWholeUs,
  onExit,
  onResolve,
}: ScopeControlProps): React.JSX.Element {
  // In a state view the current state is the selected option; in a whole-US
  // view the neutral placeholder ("") is selected (no state is active).
  const selectedState = scope.kind === 'state' ? scope.stateCode : '';

  return (
    <section
      className="scope-control"
      role="region"
      aria-label="Change the map scope"
    >
      <select
        className="scope-control__select"
        aria-label="Switch state"
        value={selectedState}
        // Only a non-empty selection emits a scope; the placeholder is inert.
        onChange={(e) => e.target.value && onPickState(e.target.value)}
      >
        <option value="">Switch state…</option>
        {states.map((s) => (
          <option key={s.stateCode} value={s.stateCode}>
            {s.name}
          </option>
        ))}
      </select>

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
