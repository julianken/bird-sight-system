import { useMemo, useState, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { Observation, NotableObservation, FamilySilhouette } from '@bird-watch/shared-types';
import type { Since } from '../state/url-state.js';
import type { SpeciesOption } from './FiltersBar.js';
import { FeedCard } from './FeedCard.js';
import { FeedRowButton } from './FeedRow.js';
import { FilterSentence } from './ds/FilterSentence.js';
import { SortLabel } from './ds/SortLabel.js';
import type { Freshness } from './MapLede.js';
import { buildFamilyColorResolver, buildFamilyPathResolver } from '../data/family-color.js';

export interface FeedSurfaceFilters {
  notable: boolean;
  since: Since;
  speciesCode: string | null;
  familyCode: string | null;
}

export type FeedSortMode = 'recent' | 'taxonomic';

export interface FeedSurfaceProps {
  loading: boolean;
  observations: Observation[];
  now: Date;
  filters: FeedSurfaceFilters;
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * Per-species lookup used by the "Taxonomic" sort. Optional for
   * backward-compat with callers that haven't been updated; when absent
   * the taxonomic sort falls back to alphabetical-by-comName (same shape
   * as the all-null-taxonOrder cold-load case).
   */
  speciesIndex?: SpeciesOption[];
  /**
   * Total unique-species count for the lede template (Priority 4).
   * When absent, FeedSurface derives it from observations.length as a
   * rough fallback (may overcount if multiple obs share a species code).
   */
  observationCount?: number;
  /** Human-readable region label for the lede ("Arizona"). */
  regionLabel?: string;
  /** Human-readable period for the lede ("14 days"). */
  period?: string;
  /**
   * Common name of the selected species — present when speciesCode filter
   * is active. Triggers the Priority 2 lede template.
   */
  speciesName?: string;
  /**
   * Common name of the selected family — present when familyCode filter is
   * active. Triggers the Priority 3 lede template.
   */
  familyName?: string;
  /**
   * Freshness state from the 4-state machine (#456 W3-A).
   * When "stale", the lede drops the "in the last {period}" clause.
   * Spec: docs/design/01-spec/voice-and-content.md §Freshness label state machine.
   */
  freshness?: Freshness;
  /**
   * Pre-computed freshness label (e.g. "Updated 11 min ago · Source: eBird").
   * Displayed below the lede on the feed surface.
   */
  freshnessLabel?: string;
  /**
   * Family silhouettes from the DB (via /api/silhouettes). Used to resolve
   * per-family colors for each FeedRow's <FamilySilhouette>. Optional for
   * backward-compat — when absent, rows fall back to the null-family grey.
   */
  silhouettes?: FamilySilhouette[];
}

/**
 * Measured height of a single FeedRow item in pixels.
 *
 * Derived from styles.css:
 *   .feed-row { min-height: 44px; padding: var(--space-sm) var(--space-md) }
 *   = 44px min-height + 8px (top padding) + 8px (bottom padding) + 1px (border-bottom)
 *   = 61px total.
 *
 * Rounded up to 64px to ensure the virtual window is never undersized.
 * If the CSS changes, update this constant and re-measure with Playwright.
 */
export const ROW_HEIGHT_PX = 64;

/**
 * Fallback height for the virtual list container in jsdom / SSR contexts
 * where ResizeObserver never fires.
 *
 * react-window uses this as the visible-area height when computing how many
 * rows to render. In jsdom tests this controls the rendered row window:
 *   Math.ceil(FEED_LIST_DEFAULT_HEIGHT / ROW_HEIGHT_PX) + overscanCount * 2
 *   ≈ Math.ceil(600 / 64) + 6 = ~16 rows — well below 300.
 *
 * In a real browser the ResizeObserver fires and the List uses the actual
 * container height. This value only matters for the initial render flash
 * and test environments.
 */
export const FEED_LIST_DEFAULT_HEIGHT = 600;

// --------------------------------------------------------------------------
// Virtual row — props passed through react-window's rowProps.
// --------------------------------------------------------------------------

interface VirtualRowProps {
  observations: Observation[];
  now: Date;
  onSelectSpecies: (speciesCode: string) => void;
  resolveColor: (familyCode: string) => string;
  resolvePath: (familyCode: string) => string | null;
}

/**
 * Row renderer for react-window's List.
 *
 * react-window calls this with:
 *   { index, style, ariaAttributes, ...rowProps }
 *
 * `style` contains the absolute-positioning transform. It MUST be applied to
 * the root DOM element so each row lands at the correct scroll offset.
 *
 * `ariaAttributes` carries `role="listitem"`, `aria-posinset`, and
 * `aria-setsize`. Spreading these on the <li> makes the virtual list
 * screen-reader navigable even when most rows are not in the DOM.
 *
 * The outer element is an <li> (not a nested FeedRow which renders its own
 * <li>) so HTML structure is valid. The button content is rendered via
 * FeedRowButton (the extracted button-only export from FeedRow.tsx).
 */
function VirtualFeedRowComponent({
  index,
  style,
  ariaAttributes,
  observations,
  now,
  onSelectSpecies,
  resolveColor,
  resolvePath,
}: RowComponentProps<VirtualRowProps>) {
  const o = observations[index];
  if (!o) return null;

  const familyColor = o.familyCode ? resolveColor(o.familyCode) : undefined;
  const familyPath = o.familyCode ? resolvePath(o.familyCode) : null;

  // Merge the react-window position style onto the <li>. The list container
  // is `position: relative`; each <li> is `position: absolute` via `style`.
  // We also ensure full-width coverage and box-sizing so the button fills
  // the slot correctly.
  const liStyle: CSSProperties = {
    ...(style as CSSProperties),
    left: 0,
    right: 0,
    width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <li
      className="feed-row-item"
      style={liStyle}
      {...ariaAttributes}
    >
      <FeedRowButton
        observation={o}
        now={now}
        onSelectSpecies={onSelectSpecies}
        {...(familyColor !== undefined ? { color: familyColor } : {})}
        {...(familyPath != null ? { pathD: familyPath } : {})}
      />
    </li>
  );
}

/**
 * Feed surface — Sky Atlas Phase 5.
 *
 * Lede templates (evaluated in priority order, from
 * docs/design/01-spec/voice-and-content.md §Lede contract):
 *   1. Zero results → "No sightings match your current filters."
 *   2. speciesName set → "{N} sightings of {name} in {region} in the last {period}."
 *   3. familyName set → "{N} species of {family} seen across {region} in the last {period}."
 *   4. Default → "{N} species seen across {region} in the last {period}."
 *
 * <SortLabel> is a separate sibling ABOVE <FilterSentence> in the context
 * strip. These are independent components that must NOT be composed together
 * (docs/design/01-spec/components.md §<FilterSentence>: "Sort prefix is NOT
 * this component").
 *
 * The top-notable observation (first isNotable=true in the observations array)
 * renders as an elevated <FeedCard> above the virtual list. Remaining
 * observations render as flat rows inside a react-window virtualized <ol>.
 *
 * Sort contract (unchanged):
 *   - "Recent" (default): server order preserved. No client re-sort.
 *   - "Taxonomic": taxonOrder ASC, nulls last, ties by comName.
 *
 * Virtualization contract (issue #509):
 *   - ≤500 DOM nodes regardless of API row count.
 *   - react-window's List renders only the visible window (viewport height /
 *     ROW_HEIGHT_PX rows) plus overscanCount=3 rows on each side.
 *   - FeedCard (top-notable) renders outside the virtual list (variable height).
 */
export function FeedSurface(props: FeedSurfaceProps) {
  const {
    loading,
    observations,
    now,
    filters,
    onSelectSpecies,
    speciesIndex,
    observationCount,
    regionLabel = 'Arizona',
    period = '14 days',
    speciesName,
    familyName,
    freshness = 'fresh',
    freshnessLabel,
    silhouettes,
  } = props;

  // Build the familyCode → color resolver once per silhouettes identity change.
  const resolveColor = useMemo(
    () => buildFamilyColorResolver(silhouettes ?? []),
    [silhouettes],
  );

  // Build the familyCode → svgData (path) resolver.
  const resolvePath = useMemo(
    () => buildFamilyPathResolver(silhouettes ?? []),
    [silhouettes],
  );

  const [sortMode, setSortMode] = useState<FeedSortMode>('recent');

  const taxonMap = useMemo(() => {
    const map = new Map<string, number | null>();
    if (speciesIndex) {
      for (const s of speciesIndex) map.set(s.code, s.taxonOrder ?? null);
    }
    return map;
  }, [speciesIndex]);

  const visibleObservations = useMemo(() => {
    if (sortMode === 'recent') return observations;
    return observations.slice().sort((a, b) => {
      const ta = taxonMap.get(a.speciesCode) ?? null;
      const tb = taxonMap.get(b.speciesCode) ?? null;
      if (ta === null && tb === null) return a.comName.localeCompare(b.comName);
      if (ta === null) return 1;
      if (tb === null) return -1;
      if (ta === tb) return a.comName.localeCompare(b.comName);
      return ta - tb;
    });
  }, [observations, sortMode, taxonMap]);

  // Derive the lede string using the 4-template priority state machine.
  const periodClause = freshness === 'stale' ? '' : ` in the last ${period}`;
  const effectiveCount = observationCount ?? observations.length;
  const lede: string = useMemo(() => {
    if (effectiveCount === 0) {
      return 'No sightings match your current filters.';
    }
    if (speciesName) {
      return `${effectiveCount} sightings of ${speciesName} in ${regionLabel}${periodClause}.`;
    }
    if (familyName) {
      return `${effectiveCount} species of ${familyName} seen across ${regionLabel}${periodClause}.`;
    }
    return `${effectiveCount} species seen across ${regionLabel}${periodClause}.`;
  }, [effectiveCount, speciesName, familyName, regionLabel, periodClause]);

  // Build the ActiveFilters shape expected by <FilterSentence>.
  const activeFilters = useMemo(() => ({
    notable: filters.notable,
    since: filters.since,
    speciesCode: filters.speciesCode,
    familyCode: filters.familyCode,
  }), [filters]);

  // ------------------------------------------------------------------
  // Height measurement for the virtual list.
  //
  // react-window uses style.height as the authoritative height for the
  // visible window. We MUST NOT pass defaultHeight alongside style.height
  // — react-window v2 prefers the internal cached value from defaultHeight
  // and ignores style.height updates, producing a stuck-at-600px bug when
  // the container is taller than 600px (repro: 1920×1080, 768×1024).
  //
  // Why effects with listContainerRef won't work:
  //   FeedSurface renders a loading placeholder while data is in flight,
  //   so the <div ref={listContainerRef}> is NOT in the DOM on first
  //   render. useEffect / useLayoutEffect with [] deps fire after the
  //   first render — but at that point the ref is still null. By the time
  //   data loads and the list container appears, the effects have already
  //   run and won't re-fire.
  //
  // Fix: use a ref callback (setListContainerEl). The callback fires
  //   - when the element first mounts (with the element), and
  //   - when it unmounts (with null).
  //   This is timing-agnostic — it fires regardless of async data delays.
  //
  // On attach: measure clientHeight immediately + attach ResizeObserver
  //   for ongoing changes. The ObserverRef stores the current observer
  //   instance so the cleanup can disconnect it when the element unmounts.
  //
  // The state initial value FEED_LIST_DEFAULT_HEIGHT = 600 is a jsdom /
  //   SSR fallback only — in jsdom clientHeight is always 0, so the
  //   `h > 0` guard preserves the fallback and tests continue to work.
  // ------------------------------------------------------------------
  const [listHeight, setListHeight] = useState<number>(FEED_LIST_DEFAULT_HEIGHT);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Ref callback — fires when the list container element first mounts
  // (el is the element) and when it unmounts (el is null).
  const setListContainerEl = useCallback((el: HTMLDivElement | null) => {
    // Disconnect any previous observer before setting up a new one.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;

    // Synchronous initial measurement — covers the common case where the
    // element has a real size at mount time (data already loaded).
    const h = el.clientHeight;
    if (h > 0) setListHeight(h);

    // ResizeObserver for ongoing changes (window resize, panel layout
    // shifts, etc.).
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === el) {
            const rh = entry.contentRect.height;
            if (rh > 0) setListHeight(rh);
          }
        }
      });
      observer.observe(el);
      observerRef.current = observer;
    }
  }, []);

  // Stable onSelectSpecies reference for rowProps — prevents all visible rows
  // from re-rendering on unrelated state changes.
  const stableOnSelectSpecies = useCallback(onSelectSpecies, [onSelectSpecies]);

  if (loading) {
    return (
      <div className="feed-empty" role="status" aria-live="polite">
        Loading observations…
      </div>
    );
  }

  if (observations.length === 0) {
    let hint: string;
    if (filters.notable) {
      hint = 'No notable sightings in this window. Try widening the time window or turning off Notable only.';
    } else if (filters.since === '1d') {
      hint = 'No observations reported today. Try expanding the time window.';
    } else {
      hint = 'No observations to show.';
    }
    return (
      <div className="feed-surface">
        <h1 className="feed-lede">{lede}</h1>
        <div className="feed-empty" role="status">
          {hint}
        </div>
      </div>
    );
  }

  // Find the first notable observation for the elevated card treatment.
  const topNotable: NotableObservation | null =
    visibleObservations.find((o): o is NotableObservation => o.isNotable) ?? null;

  // All other observations: exclude topNotable so it doesn't appear twice.
  const flatObservations: Observation[] = topNotable
    ? visibleObservations.filter(o => o !== topNotable)
    : visibleObservations;

  // rowProps is memoised to prevent react-window from re-rendering all
  // visible rows on unrelated parent re-renders. The identity of the
  // flatObservations array changes only when sort or filters change.
  const rowProps: VirtualRowProps = {
    observations: flatObservations,
    now,
    onSelectSpecies: stableOnSelectSpecies,
    resolveColor,
    resolvePath,
  };

  return (
    <div className="feed-surface">
      {/* Lede — runtime truth claim, Priority 1–4 state machine */}
      <h1 className="feed-lede">{lede}</h1>
      {/* Freshness meta line — 4-state machine per voice-and-content.md (#456 W3-A) */}
      {freshnessLabel && (
        <p className="feed-freshness">{freshnessLabel}</p>
      )}

      {/* Context strip: SortLabel sibling ABOVE FilterSentence.
          These are independent; do not compose or merge them. */}
      <SortLabel mode={sortMode} />
      <FilterSentence
        filters={activeFilters}
        {...(familyName !== undefined ? { familyName } : {})}
        {...(speciesName !== undefined ? { speciesName } : {})}
      />

      {/* Sort toggle — radio group for native keyboard arrow-key traversal */}
      <div
        className="feed-sort"
        role="radiogroup"
        aria-label="Sort observations"
      >
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="recent"
            checked={sortMode === 'recent'}
            onChange={() => setSortMode('recent')}
          />
          <span>Recent</span>
        </label>
        <label className="feed-sort-option">
          <input
            type="radio"
            name="feed-sort"
            value="taxonomic"
            checked={sortMode === 'taxonomic'}
            onChange={() => setSortMode('taxonomic')}
          />
          <span>Taxonomic</span>
        </label>
      </div>

      {/*
        Top-notable FeedCard — rendered outside the virtual list.
        FeedCard has variable height; keeping it out of the fixed-height
        virtual window simplifies the row-height contract.
      */}
      {topNotable && (() => {
        const notableColor = topNotable.familyCode ? resolveColor(topNotable.familyCode) : undefined;
        const notablePath = topNotable.familyCode ? resolvePath(topNotable.familyCode) : null;
        return (
          <ol className="feed" aria-label="Notable observation">
            <FeedCard
              key={`card:${topNotable.subId}:${topNotable.speciesCode}`}
              observation={topNotable}
              now={now}
              onSelectSpecies={onSelectSpecies}
              {...(notableColor !== undefined ? { color: notableColor } : {})}
              {...(notablePath != null ? { pathD: notablePath } : {})}
            />
          </ol>
        );
      })()}

      {/*
        Virtual observation list (issue #509).

        react-window's List renders only the rows visible in the container
        plus `overscanCount` rows above/below the visible window. This keeps
        DOM nodes bounded to ~(visibleRows + 6) regardless of dataset size,
        replacing the previous unvirtualized approach that produced ~86k nodes.

        tagName="ol" makes the outer container an <ol>, preserving:
          - The `ol.feed[aria-label="Observations"]` selector used by the
            App.tsx skip-link focus target.
          - Screen-reader list semantics. react-window adds aria-setsize and
            aria-posinset to each item so SR users know list length.

        Height: measured from the container div via ResizeObserver. Falls
        back to FEED_LIST_DEFAULT_HEIGHT (600px) in jsdom / SSR.
      */}
      <div
        ref={setListContainerEl}
        className="feed-list-container"
        style={{ flex: '1 1 auto', minHeight: 0 }}
      >
        <List<VirtualRowProps, 'ol'>
          tagName="ol"
          className="feed"
          aria-label="Observations"
          rowComponent={VirtualFeedRowComponent}
          rowCount={flatObservations.length}
          rowHeight={ROW_HEIGHT_PX}
          rowProps={rowProps}
          style={{ height: listHeight }}
          overscanCount={3}
        />
      </div>
    </div>
  );
}
