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
          value={props.speciesIndex.find(s => s.code === props.speciesCode)?.comName ?? ''}
          onChange={e => {
            const v = e.target.value;
            const match = props.speciesIndex.find(s =>
              s.comName.toLowerCase() === v.toLowerCase()
            );
            props.onChange({ speciesCode: match?.code ?? null });
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
