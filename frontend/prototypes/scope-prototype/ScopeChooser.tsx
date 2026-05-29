import { useState } from 'react';
import { STATES } from './states';

/**
 * Landing scope chooser for the C0 prototype (proves the C2a contract).
 *
 * Co-primary: a ZIP input and a state <select>. A de-emphasized "Explore the
 * whole US map" escape hatch maps to `?scope=us`. This component only EMITS
 * the chosen scope; the render-gating (chooser-vs-map + fetch suppression)
 * lives in the parent App — exactly the C2a/C6 split the plan calls for.
 */
export interface ScopeChooserProps {
  onPickState: (stateCode: string) => void;
  onPickZip: (zip: string) => void;
  onPickWholeUs: () => void;
  /** Non-empty when the last ZIP entry was well-formed but unresolved. */
  zipError?: string | null;
}

export function ScopeChooser({
  onPickState,
  onPickZip,
  onPickWholeUs,
  zipError,
}: ScopeChooserProps) {
  const [zip, setZip] = useState('');
  const [stateCode, setStateCode] = useState('');

  return (
    <div className="scope-chooser" role="region" aria-label="Choose a map scope">
      <div className="scope-chooser__card">
        <h1 className="scope-chooser__title">Where do you want to look at birds?</h1>
        <p className="scope-chooser__subtitle">
          Pick a state or enter a ZIP to see recent sightings.
        </p>

        <form
          className="scope-chooser__field"
          onSubmit={(e) => {
            e.preventDefault();
            onPickZip(zip);
          }}
        >
          <label className="scope-chooser__label" htmlFor="zip">
            ZIP code
          </label>
          <div className="scope-chooser__row">
            <input
              id="zip"
              className="scope-chooser__input"
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              aria-label="ZIP code"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              placeholder="e.g. 85701"
            />
            <button type="submit" className="scope-chooser__btn">
              Go
            </button>
          </div>
          {zipError ? (
            <p className="scope-chooser__status" role="status" aria-live="polite">
              {zipError}
            </p>
          ) : null}
        </form>

        <div className="scope-chooser__divider" aria-hidden="true">
          or
        </div>

        <div className="scope-chooser__field">
          <label className="scope-chooser__label" htmlFor="state">
            State
          </label>
          <div className="scope-chooser__row">
            <select
              id="state"
              className="scope-chooser__select"
              aria-label="State"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
            >
              <option value="">Choose a state…</option>
              {STATES.map((s) => (
                <option key={s.stateCode} value={s.stateCode}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="scope-chooser__btn"
              disabled={!stateCode}
              onClick={() => stateCode && onPickState(stateCode)}
            >
              Go
            </button>
          </div>
        </div>

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
