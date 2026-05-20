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
  // <FiltersBar>'s "Species" and "Family" input labels. Preserved verbatim
  // from the pre-#688 two-tab tablist for compatibility with e2e selectors
  // that target `getByRole('tab', { name: 'Map view' })`.
  accessibleName: string;
}

// One-tab tablist post-#688 (Species surface removed). ARIA APG explicitly
// allows single-tab tablists — the role + aria-selected contract still
// expresses the surface state and the structure tolerates future additions
// without churning the markup. The visible "Map" label is suppressed in CSS
// to avoid a "lone Map word" wordmark-adjacent treatment; the accessible
// name is preserved so SR users still hear "Map view, selected".
const TABS: readonly TabDef[] = [
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
          {/* Info-circle icon — visible at mobile (≤480px), hidden at desktop via CSS */}
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
          {/* Text label — visible at desktop (>480px), sr-only at mobile */}
          <span className="app-header-btn-label">Attribution</span>
        </button>
        <button
          type="button"
          className="app-header-filters"
          onClick={onOpenFilters}
          aria-label={filterTriggerLabel}
        >
          {/* Funnel/filter icon — visible at mobile (≤480px), hidden at desktop via CSS */}
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
          {/* Text label — visible at desktop (>480px), sr-only at mobile */}
          <span className="app-header-btn-label">Filters</span>
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
