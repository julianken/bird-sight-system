import { useState, useEffect, useRef, useId } from 'react';
import type { Since } from '../state/url-state.js';

export interface FamilyOption { code: string; name: string; }
export interface SpeciesOption {
  code: string;
  comName: string;
  // Plan 6 Task 10 (issue #119): exposes the last two latent fields so
  // future autocomplete groupings can cluster by family without a second
  // derive pass.
  // Both are nullable: taxonOrder lives on SpeciesMeta, NOT Observation,
  // so today's derive pulls it only when the API has been extended to
  // project it onto the observation payload (backward-compatible
  // optional field). familyCode mirrors the silhouetteId fallback from
  // deriveFamilies.
  // Optional on the interface so older test fixtures typecheck without
  // supplying values. Consumers treat missing as null (same handling as
  // the explicit-null case).
  taxonOrder?: number | null;
  familyCode?: string | null;
}

export interface FiltersBarProps {
  since: Since;
  notable: boolean;
  speciesCode: string | null;
  familyCode: string | null;
  families: FamilyOption[];
  speciesIndex: SpeciesOption[];
  /**
   * D2 (#1050): the species index is dictionary-backed (`useSpeciesDictionary`),
   * so a commit can only be classified as a no-match once that index is settled.
   * While `speciesIndexLoading`, defer the no-match verdict — a verdict against a
   * still-empty index would be a FALSE hint (the new silent-failure class the
   * "never silent" contract guards against). Mirrors ZipInput's index-warm window.
   */
  speciesIndexLoading?: boolean;
  /**
   * D2 (#1050): when the species dictionary failed to load, a commit renders
   * ZipInput's `fetchError` outcome (`role="alert"`) instead of a no-match
   * `role="status"` — the field can't be trusted to recognize anything.
   */
  speciesIndexError?: boolean;
  onChange: (partial: Partial<{
    since: Since; notable: boolean;
    speciesCode: string | null; familyCode: string | null;
  }>) => void;
}

/**
 * D2 (#1050) — the surfaced feedback for a Species commit, mirroring ZipInput's
 * "never silent" contract (`ZipInput.tsx:14-25`). `none` is the no-message state
 * — both a successful exact-match commit and an empty-field clear leave it
 * `none` (the change itself is the feedback). `notRecognized` and `fetchError`
 * are the two cases that would otherwise have been a silent no-op.
 */
type SpeciesFeedback =
  | { kind: 'none' }
  | { kind: 'notRecognized'; query: string }
  | { kind: 'fetchError' };

export function FiltersBar(props: FiltersBarProps) {
  // Draft state so users can type multi-character species without URL updating on every keystroke.
  // The URL is only updated on blur or when Enter is pressed.
  const [speciesDraft, setSpeciesDraft] = useState<string>(
    () => props.speciesIndex.find(s => s.code === props.speciesCode)?.comName ?? ''
  );

  // D2 (#1050): the surfaced outcome of the last Species commit (the "never
  // silent" feedback). Cleared whenever the user edits the field again so a
  // stale no-match hint never lingers while typing toward a match.
  const [speciesFeedback, setSpeciesFeedback] = useState<SpeciesFeedback>({ kind: 'none' });

  // Stable id so the Species input can `aria-describedby` its feedback message —
  // assistive tech announces the no-match/error hint as the field's description.
  const speciesHintId = useId();

  // Store speciesIndex in a ref so the sync effect below doesn't re-run on
  // identity churn (new array reference with identical content after every
  // observation refetch). Only speciesCode changes should trigger a sync.
  const speciesIndexRef = useRef(props.speciesIndex);
  speciesIndexRef.current = props.speciesIndex;

  // Sync draft when speciesCode changes (back/forward, popstate) or when the
  // speciesIndex first populates (deep-link: code is set before data arrives).
  // Using .length avoids identity-churn reruns while still catching 0→N.
  useEffect(() => {
    const comName = speciesIndexRef.current.find(s => s.code === props.speciesCode)?.comName ?? '';
    setSpeciesDraft(comName);
  }, [props.speciesCode, props.speciesIndex.length]);

  // D2 (#1050) — never-silent species commit. Four outcomes mirror ZipInput:
  //   - exact match            → commit the code, clear any feedback.
  //   - empty field            → clear the active species filter (KEPT behavior).
  //   - dictionary loading     → defer; surface NO no-match verdict (would be
  //                              a false hint against a not-yet-populated index).
  //   - dictionary error       → role="alert" (the field can't recognize names).
  //   - no match (settled)     → role="status" hint, KEEP the typed value, and
  //                              do NOT push a redundant null commit (that would
  //                              round-trip the URL for no reason). Only an
  //                              explicit clear (empty field) commits null.
  function commitSpeciesDraft(value: string) {
    const trimmed = value.trim();

    // Empty field is an explicit "clear the species filter" — commit null only
    // when a code was actually set, otherwise it's a no-op (and never a hint).
    if (trimmed === '') {
      if (props.speciesCode !== null) props.onChange({ speciesCode: null });
      setSpeciesFeedback({ kind: 'none' });
      return;
    }

    const match = props.speciesIndex.find(
      s => s.comName.toLowerCase() === trimmed.toLowerCase()
    );
    if (match) {
      props.onChange({ speciesCode: match.code });
      setSpeciesFeedback({ kind: 'none' });
      return;
    }

    // No match. Classify against the dictionary state BEFORE verdicting.
    if (props.speciesIndexError) {
      setSpeciesFeedback({ kind: 'fetchError' });
      return;
    }
    if (props.speciesIndexLoading) {
      // Index not settled yet — defer. A no-match verdict here would be false.
      setSpeciesFeedback({ kind: 'none' });
      return;
    }
    // Settled + no match → surface the national-scope no-match hint, keep value.
    setSpeciesFeedback({ kind: 'notRecognized', query: trimmed });
  }

  function handleSpeciesInput(value: string) {
    setSpeciesDraft(value);
    // Editing clears a stale hint so feedback never lags the field's content.
    if (speciesFeedback.kind !== 'none') setSpeciesFeedback({ kind: 'none' });
  }

  return (
    <div className="filters-bar">
      <label>
        Time window
        <select
          aria-label="Time window"
          value={props.since}
          onChange={e => props.onChange({ since: e.target.value as Since })}
        >
          <option value="1d">Today</option>
          <option value="7d">7 days</option>
          <option value="14d">14 days</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          aria-label="Notable only"
          checked={props.notable}
          onChange={e => props.onChange({ notable: e.target.checked })}
        />
        Notable only
      </label>
      <label>
        Family
        <select
          aria-label="Family"
          value={props.familyCode ?? ''}
          onChange={e => props.onChange({ familyCode: e.target.value || null })}
        >
          <option value="">All families</option>
          {props.families.map(f =>
            <option key={f.code} value={f.code}>{f.name}</option>
          )}
        </select>
      </label>
      <label>
        Species
        <input
          type="search"
          aria-label="Species"
          list="species-options"
          placeholder="Common name"
          value={speciesDraft}
          aria-describedby={
            speciesFeedback.kind === 'none' ? undefined : speciesHintId
          }
          onChange={e => handleSpeciesInput(e.target.value)}
          onBlur={e => commitSpeciesDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              commitSpeciesDraft((e.target as HTMLInputElement).value);
            }
          }}
        />
        <datalist id="species-options">
          {props.speciesIndex.map(s =>
            <option key={s.code} value={s.comName} />
          )}
        </datalist>
        {/* D2 (#1050) never-silent feedback. The no-match copy is scoped to the
            dictionary-backed (national) index — 'No species matching "X"', NOT
            "…in the current view", which would be false at low zoom where the
            index is the whole-US dictionary. */}
        {speciesFeedback.kind === 'notRecognized' && (
          <p
            id={speciesHintId}
            className="filters-bar__species-status"
            role="status"
            aria-live="polite"
          >
            No species matching &quot;{speciesFeedback.query}&quot;
          </p>
        )}
        {speciesFeedback.kind === 'fetchError' && (
          <p
            id={speciesHintId}
            className="filters-bar__species-error"
            role="alert"
          >
            Could not load the species list — try again
          </p>
        )}
      </label>
    </div>
  );
}
