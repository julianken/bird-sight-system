import { ThemeToggle } from './ThemeToggle.js';

export interface AppHeaderProps {
  /**
   * #738/C5: runtime region label for the active scope (from `regionLabelFor`).
   * `null` ⟺ the unscoped/chooser landing — the wordmark renders just "Bird
   * Maps" with no ` · {region}` suffix and the aria-label drops the region
   * word. Non-null appends " · {region}" (e.g. "Bird Maps · Arizona").
   */
  region: string | null;
  /** Active filter count — drives the numeric badge on the Filters trigger. */
  filterCount: number;
  /** Open the Filters panel. <App> owns the panel state; this component is presentational. */
  onOpenFilters: () => void;
  /** Open the Credits & Attribution modal. */
  onOpenAttribution: () => void;
}

export function AppHeader({
  region,
  filterCount,
  onOpenFilters,
  onOpenAttribution,
}: AppHeaderProps) {
  const filterTriggerLabel =
    filterCount > 0 ? `Filters (${filterCount} active)` : 'Filters';

  return (
    <header className="app-header" role="banner">
      <a
        className="app-header-wordmark"
        href="/"
        aria-label={region ? `Bird Maps ${region} — home` : 'Bird Maps — home'}
      >
        {/* #738/C5: on the unscoped landing (region=null) the wordmark omits
            the ` · {region}` suffix entirely — never a bare ` · ` separator. */}
        Bird Maps
        {region && (
          <span className="brand-region">
            <span aria-hidden="true"> ·</span> {region}
          </span>
        )}
      </a>

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
