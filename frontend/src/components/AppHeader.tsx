import { useRef, type KeyboardEvent } from 'react';
import { REGION_LABEL } from '../config/region.js';
import { ThemeToggle } from './ThemeToggle.js';
import type { View } from '../state/url-state.js';

export interface AppHeaderProps {
  activeView: View;
  onSelectView: (view: View) => void;
  /** Active filter count — drives the numeric badge on the Filters trigger. */
  filterCount: number;
  /** Open the Filters panel. <App> owns the panel state; this component is presentational. */
  onOpenFilters: () => void;
  /** Open the Credits & Attribution modal. */
  onOpenAttribution: () => void;
}

interface TabDef {
  value: View;
  label: string;
  // Accessible name diverges from visible text to avoid colliding with
  // <FiltersBar>'s "Species" and "Family" input labels — same divergence
  // <SurfaceNav> used pre-Phase 3 (preserved verbatim).
  accessibleName: string;
}

const TABS: readonly TabDef[] = [
  { value: 'feed', label: 'Feed', accessibleName: 'Feed view' },
  { value: 'species', label: 'Species', accessibleName: 'Species view' },
  { value: 'map', label: 'Map', accessibleName: 'Map view' },
];

export function AppHeader({
  activeView,
  onSelectView,
  filterCount,
  onOpenFilters,
  onOpenAttribution,
}: AppHeaderProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activateIndex(index: number) {
    const next = TABS[index];
    if (!next) return;
    tabRefs.current[index]?.focus();
    if (next.value !== activeView) onSelectView(next.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        activateIndex((index + 1) % TABS.length);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        activateIndex((index - 1 + TABS.length) % TABS.length);
        break;
      case 'Home':
        event.preventDefault();
        activateIndex(0);
        break;
      case 'End':
        event.preventDefault();
        activateIndex(TABS.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const tab = TABS[index];
        if (tab && tab.value !== activeView) onSelectView(tab.value);
        break;
      }
      default:
        break;
    }
  }

  const anyTabActive = TABS.some(t => t.value === activeView);
  const filterTriggerLabel =
    filterCount > 0 ? `Filters (${filterCount} active)` : 'Filters';

  return (
    <header className="app-header" role="banner">
      <a className="app-header-wordmark" href="/" aria-label={`Bird Maps ${REGION_LABEL} — home`}>
        Bird Maps<span className="brand-region"><span aria-hidden="true"> ·</span> {REGION_LABEL}</span>
      </a>

      <div className="app-header-nav" role="tablist" aria-label="Surface">
        {TABS.map((tab, index) => {
          const selected = tab.value === activeView;
          const tabbable = selected || (!anyTabActive && index === 0);
          return (
            <button
              key={tab.value}
              ref={el => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`app-header-tab-${tab.value}`}
              aria-selected={selected}
              aria-controls="main-surface"
              aria-label={tab.accessibleName}
              tabIndex={tabbable ? 0 : -1}
              className={`app-header-tab${selected ? ' is-active' : ''}`}
              onClick={() => {
                if (tab.value !== activeView) onSelectView(tab.value);
              }}
              onKeyDown={e => handleKeyDown(e, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="app-header-right">
        <button
          type="button"
          className="app-header-attribution"
          onClick={onOpenAttribution}
          aria-label="Credits & attribution"
        >
          Attribution
        </button>
        <button
          type="button"
          className="app-header-filters"
          onClick={onOpenFilters}
          aria-label={filterTriggerLabel}
        >
          Filters
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
