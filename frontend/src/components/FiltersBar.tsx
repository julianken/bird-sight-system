import { useState, useEffect } from 'react';
import type { Since } from '../state/url-state.js';

export interface FamilyOption { code: string; name: string; }
export interface SpeciesOption { code: string; comName: string; }

export interface FiltersBarProps {
  since: Since;
  notable: boolean;
  speciesCode: string | null;
  familyCode: string | null;
  families: FamilyOption[];
  speciesIndex: SpeciesOption[];
  onChange: (partial: Partial<{
    since: Since; notable: boolean;
    speciesCode: string | null; familyCode: string | null;
  }>) => void;
}

export function FiltersBar(props: FiltersBarProps) {
  // Draft state so users can type multi-character species without URL updating on every keystroke.
  // The URL is only updated on blur or when Enter is pressed.
  const [speciesDraft, setSpeciesDraft] = useState<string>(
    () => props.speciesIndex.find(s => s.code === props.speciesCode)?.comName ?? ''
  );

  // Sync draft when the URL-driven speciesCode changes externally (e.g. browser back/forward).
  useEffect(() => {
    const comName = props.speciesIndex.find(s => s.code === props.speciesCode)?.comName ?? '';
    setSpeciesDraft(comName);
  }, [props.speciesCode, props.speciesIndex]);

  function commitSpeciesDraft(value: string) {
    const match = props.speciesIndex.find(
      s => s.comName.toLowerCase() === value.toLowerCase()
    );
    props.onChange({ speciesCode: match?.code ?? null });
  }

  return (
    <div className="filters-bar" role="region" aria-label="Filters">
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
          <option value="30d">30 days</option>
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
          onChange={e => setSpeciesDraft(e.target.value)}
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
      </label>
    </div>
  );
}
