import { useId, useState, type FormEvent } from 'react';
import type { StateSummary } from '@bird-watch/shared-types';
import { ZipInput } from './ZipInput.js';
import type { ScopeResolution } from '../state/scope-types.js';

/**
 * Landing scope chooser — the pre-map surface (revised design 2026-05-29).
 *
 * Prompts "where do you want to look?" with two CO-PRIMARY paths — a ZIP input
 * and a state `<select>` — plus a DE-EMPHASIZED "Explore the whole US map"
 * escape hatch (→ `?scope=us`).
 *
 * Ownership boundary (Task C2a, #742): this component is PURELY PRESENTATIONAL
 * and only EMITS the chosen scope through callback props. It does NOT:
 *   - render the map,
 *   - gate the cold-load `/api/observations` fetch,
 *   - read or write the URL (`?state` / `?zip` / `?scope` are App/#740's job),
 *   - resolve a ZIP to a state (the lazy `loadZipIndex`/`lookupZip` pipeline
 *     lives entirely inside `<ZipInput>` / `zip-lookup.ts`, #739),
 *   - fetch the state list (the caller supplies `props.states` from
 *     `GET /api/states`, #732).
 * The render-gating (chooser-vs-map + fetch suppression) lives in App/C6/#740.
 * If you find yourself importing `url-state.ts`, `api/client.ts`, `fetch`, or a
 * map module here, you have crossed the boundary.
 *
 * The only local state is the transient `<select>` value — no scope/URL/fetch
 * state. Picking a scope swaps the caller to the map, which UNMOUNTS this
 * component cleanly (the intentional remount the C0 prototype validated —
 * camera lifecycle is C3/C6's problem, not C2a's).
 */
export interface ScopeChooserProps {
  /** States for the `<select>`. The caller supplies the result of
   *  `GET /api/states` (#732) — `StateSummary[]` (`stateCode`, `name`, `bbox`),
   *  already name-sorted by the endpoint. ScopeChooser does NOT fetch this. */
  states: StateSummary[];
  /** State `<select>` path: emits the chosen `US-XX` code. */
  onPickState: (stateCode: string) => void;
  /** Whole-US escape hatch: emits the niche `?scope=us` intent. */
  onPickWholeUs: () => void;
  /** ZIP path: the resolved `ScopeResolution` from `<ZipInput>`, forwarded
   *  straight up to the caller (App/C6 turns it into `?state=US-XX` + a camera
   *  `flyTo` at `ZIP_FLYTO_ZOOM`). ScopeChooser is a pass-through here. */
  onResolve: (scope: ScopeResolution) => void;
  /** Loading/empty affordance while the caller's `/api/states` request is in
   *  flight or returned empty (selector disabled, ZIP still usable). */
  statesLoading?: boolean;
}

export function ScopeChooser({
  states,
  onPickState,
  onPickWholeUs,
  onResolve,
  statesLoading = false,
}: ScopeChooserProps): React.JSX.Element {
  const [stateCode, setStateCode] = useState('');
  const selectId = useId();

  // The two paths are independent: a slow/empty `/api/states` disables only the
  // selector — the ZIP path must stay fully usable (C0 contract: ZIP resolves to
  // a state independent of the selector).
  const selectorDisabled = statesLoading || states.length === 0;

  function handleStateSubmit(e: FormEvent): void {
    e.preventDefault();
    // Only a non-empty selection emits a scope; the placeholder (value "") is
    // never a valid scope.
    if (stateCode) onPickState(stateCode);
  }

  return (
    <div className="scope-chooser" role="region" aria-label="Choose where to look at birds">
      <div className="scope-chooser__card">
        <h1 className="scope-chooser__title">Where do you want to look at birds?</h1>
        <p className="scope-chooser__subtitle">
          Enter a ZIP code or pick a state to see recent sightings near you.
        </p>

        <div className="scope-chooser__field">
          <span className="scope-chooser__label" id="scope-chooser-zip-label">
            ZIP code
          </span>
          {/* <ZipInput> (#739) owns the ZIP input, lazy index load, lookup, and
              the "not recognized" / malformed / fetch-error UX. ScopeChooser
              forwards its onResolve straight up — it never owns ZIP state. */}
          <ZipInput onResolve={onResolve} />
        </div>

        <div className="scope-chooser__divider" aria-hidden="true">
          or
        </div>

        <form className="scope-chooser__field" onSubmit={handleStateSubmit}>
          <label className="scope-chooser__label" htmlFor={selectId}>
            State
          </label>
          <div className="scope-chooser__row">
            <select
              id={selectId}
              className="scope-chooser__select"
              value={stateCode}
              disabled={selectorDisabled}
              onChange={(e) => setStateCode(e.target.value)}
            >
              <option value="">
                {selectorDisabled ? 'Loading states…' : 'Choose a state…'}
              </option>
              {states.map((s) => (
                <option key={s.stateCode} value={s.stateCode}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="scope-chooser__btn"
              disabled={selectorDisabled || !stateCode}
            >
              Go
            </button>
          </div>
        </form>

        <button
          type="button"
          className="scope-chooser__wholeus"
          onClick={onPickWholeUs}
        >
          Explore the whole US map
        </button>
      </div>
    </div>
  );
}
