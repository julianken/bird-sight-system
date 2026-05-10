# Sky Atlas — Phase 3 Map Surface Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Sky Atlas map surface — extract a new `<AppHeader>` chrome (wordmark, desktop nav with active-tab accent underline, attribution + filters trigger + theme toggle), rewrite `<MapSurface>` so the context strip carries a newspaper lede + filter sentence + freshness meta, replace MapLibre's solid-circle cluster paint with `<ClusterPill>` React `<Marker>` overlays, revise `<FamilyLegend>` (collapsed by default on mobile, shape-paired swatches), and verify the basemap swap on `[data-theme]` change is FOUC-free. The map is now the front door — the home route this plan ships behind.

**Architecture:** All changes are frontend-only. `<AppHeader>` is a new component; it absorbs the existing `<SurfaceNav>` semantics (`role="tablist"` + 3 tabs) and adds a right-cluster (Attribution / Filters trigger / Theme toggle). `<App>` gains a `filtersOpen` state that the new Filters trigger toggles; the existing `<FiltersBar>` mounts inside a panel rather than on the page chrome. `<MapSurface>` rewrite consumes Phase 2's `<FilterSentence>` and a new `<MapLede>` template (4 cases). The cluster pill overlay is rendered by reading the `observations` GeoJSON source's clustered features through `getClusterLeaves`/`queryRenderedFeatures` and projecting each cluster's lng/lat to a React `<Marker>` carrying `<ClusterPill>`. The MapLibre cluster-circle + cluster-count paint layers are suppressed at every zoom (filter set to a never-true expression). Phase 1 already wires a `MutationObserver` on `<html>` `data-theme` to call `map.setStyle()` — Phase 3 only renames the basemap exports to `BASEMAP_LIGHT` / `BASEMAP_DARK` (keeping the same URL for both until G7/G8 close) and re-verifies the swap is smooth on the new surface composition.

**Tech Stack:** TypeScript, React 18, Vitest 4, `@testing-library/react`, MapLibre GL 5, `react-map-gl/maplibre` 7, `@playwright/test`, `@axe-core/playwright`. Builds with Vite 8. No new npm dependencies.

---

## Spec reference

This plan implements [Phase 3](../design/02-phases/phase-3-map-surface.md) of the Sky Atlas redesign:

- Surface system + persistent chrome: [`docs/design/01-spec/architecture.md`](../design/01-spec/architecture.md)
- `<ClusterPill>` API + `<FilterSentence>` mounting rules: [`docs/design/01-spec/components.md`](../design/01-spec/components.md)
- Newspaper lede 4-template state machine + freshness label: [`docs/design/01-spec/voice-and-content.md`](../design/01-spec/voice-and-content.md)

### Dependencies — must be merged before starting

- **Phase 0** (`feat/sky-atlas-phase-0`) — `pushState` for detail entry, `motion.css`, `DEFAULTS.view='map'`. The home-route flip is what makes the map the front door this plan dresses up.
- **Phase 1** (`feat/sky-atlas-phase-1`) — `tokens.css` three-tier contract, `[data-theme]` mechanic, FOUC-free inline script in `index.html`, `<ThemeToggle>` component, `MapCanvas` `MutationObserver` + `setStyle` plumbing, `frontend/src/config/region.ts` (`REGION_LABEL`).
- **Phase 2** (`feat/sky-atlas-phase-2`) — `<ClusterPill>`, `<FilterSentence>`, `<FamilySilhouette>`, `frontend/src/config/cluster.ts` (`CLUSTER_TIER_BOUNDARIES`, `clusterTier`), `frontend/src/config/family-palette.ts` (`FAMILY_PALETTE`, `getFamilyChannel` returning `{fill, on, shape}`), `frontend/src/config/freshness.ts` (`FRESHNESS_FRESH_MAX_MS`, `FRESHNESS_RECENT_MAX_MS`).

### Acceptance criteria (from Phase 3 doc)

- Map renders both light and dark modes with correct token resolution.
- Cluster pills pass the new axe assertion (`role="img"` + `aria-label="{count} sightings"`).
- FamilyLegend on mobile is collapsed on first load and after `localStorage.clear()`.
- Lede displays the correct of 4 templates based on filter state; period clause drops on stale data.
- Filter trigger badge displays accurate count; `<FilterSentence>` mounts and shows active narrative below lede.
- Map basemap swap on theme toggle is smooth (no FOUC during MapLibre style reload).

This plan is independent of Phases 4–6 (detail surface; feed/species; voice/metadata).

## File structure

| File | Disposition | Responsibility |
|---|---|---|
| `frontend/src/components/AppHeader.tsx` | Create | Persistent chrome: wordmark, desktop nav (3 tabs), right-cluster (Attribution / Filters trigger with `{N}` badge / Theme toggle). Replaces direct mount of `<SurfaceNav>` + `<AttributionModal>` chrome at `App.tsx:165–168, 233–256`. |
| `frontend/src/components/AppHeader.test.tsx` | Create | Tab semantics survive (role=tablist, aria-selected, ArrowLeft/Right migration); Filters trigger badge count; Theme toggle delegates to `<ThemeToggle>`; wordmark `aria-label` is `"Bird Maps Arizona — home"`. |
| `frontend/src/components/MapLede.tsx` | Create | 4-template lede: zero-results / single-species / family / default. Period clause drops when `freshness === 'stale'`. Pure render given props. |
| `frontend/src/components/MapLede.test.tsx` | Create | All 4 template branches; period-clause drop under stale; `REGION_LABEL` substitution. |
| `frontend/src/components/MapSurface.tsx` | Modify | Add context strip above the canvas: `<MapLede>` + `<FilterSentence>` + freshness meta line. Mount `<ClusterPill>` overlay via React `<Marker>`s. |
| `frontend/src/components/MapSurface.test.tsx` | Modify | Context-strip render assertions (lede/sentence/meta present); cluster-pill overlay present at zoom < CLUSTER_MAX_ZOOM with cluster features. |
| `frontend/src/components/map/observation-layers.ts` | Modify | `buildClusterLayerSpec` and `buildClusterCountLayerSpec` filter to never-true; `CLUSTER_TIER_BOUNDARIES` import remains the single source of truth between this layer config and `<ClusterPill>`. |
| `frontend/src/components/map/observation-layers.test.ts` | Modify | Update assertions on cluster layer paint to expect zero opacity; assert `CLUSTER_TIER_BOUNDARIES` is the import source. |
| `frontend/src/components/map/MapCanvas.tsx` | Modify | Add `<ClusterPillOverlay>` child component that listens for `idle` events, calls `queryRenderedFeatures({ layers: ['clusters-hit'] })`, projects each cluster center to a `<Marker>`, renders `<ClusterPill>`. |
| `frontend/src/components/map/MapCanvas.test.tsx` | Modify | Add test for cluster-pill overlay rendering after `idle` event with a clustered feature. |
| `frontend/src/components/map/basemap-style.ts` | Modify | Export `BASEMAP_LIGHT` and `BASEMAP_DARK`; keep `basemapStyle` as `BASEMAP_LIGHT` alias for back-compat. `BASEMAP_DARK` aliases `BASEMAP_LIGHT` URL until G7/G8 close. |
| `frontend/src/components/FamilyLegend.tsx` | Modify | Mobile-collapsed default; shape-paired swatches via `<FamilySilhouette shape={...} />` from family-palette.ts; `localStorage` migration (delete legacy `family-legend-expanded` value when migrating to new key on a viewport mismatch — see Task 5). |
| `frontend/src/components/FamilyLegend.test.tsx` | Modify | Mobile default = collapsed (`localStorage.clear()` + `matchMedia(max-width: 759px)` returns true → `data-expanded="false"`); shape prop forwarded per family. |
| `frontend/src/App.tsx` | Modify | Replace direct `<FiltersBar>` + `<SurfaceNav>` + `<AttributionModal>` mounts with `<AppHeader>` + a panel. Add `filtersOpen` state. Compute `filterCount` for the badge. |
| `frontend/src/App.test.tsx` | Modify | App renders `<AppHeader>` in place of the old top-strip; opening Filters panel reveals `<FiltersBar>`; closing hides it. |
| `frontend/e2e/axe.spec.ts` | Modify | New axe scan asserting cluster pills resolve to `role="img"` with `aria-label="{count} sightings"`. |
| `frontend/e2e/family-legend.spec.ts` | Modify | New test: after `localStorage.clear()` at 390×844, `<FamilyLegend>` first paint is `data-expanded="false"`. |
| `frontend/e2e/pages/app-page.ts` | Modify | Add `appHeader`, `filtersTrigger`, `themeToggle` locators; refactor any `surfaceNav` references to `appHeader.tabs`. |

---

## Task 1: Build `<AppHeader>` chrome component

The new persistent chrome that wraps every surface. Absorbs `<SurfaceNav>`'s tablist semantics (so we don't lose ArrowLeft/Right keyboard nav) and adds a right-cluster of three buttons. The component is purely presentational — `<App>` owns all state (filters open/closed, current view, theme).

`<SurfaceNav>` is NOT deleted in this task — it remains importable for future use, but `<App>` stops mounting it directly. We can decide whether to delete it once the dust settles (likely a follow-up chore PR).

**Files:**
- Create: `frontend/src/components/AppHeader.tsx`
- Create: `frontend/src/components/AppHeader.test.tsx`

- [ ] **Step 1: Write failing tests for `<AppHeader>`.**

Create `frontend/src/components/AppHeader.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from './AppHeader.js';

const baseProps = {
  activeView: 'map' as const,
  onSelectView: vi.fn(),
  filterCount: 0,
  onOpenFilters: vi.fn(),
  onOpenAttribution: vi.fn(),
};

describe('<AppHeader>', () => {
  it('renders the wordmark with REGION_LABEL', () => {
    render(<AppHeader {...baseProps} />);
    const link = screen.getByRole('link', { name: /Bird Maps Arizona — home/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent(/Bird Maps · Arizona/);
  });

  it('renders three tabs in stable order: Feed, Species, Map', () => {
    render(<AppHeader {...baseProps} />);
    const tablist = screen.getByRole('tablist', { name: /Surface/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual(['Feed', 'Species', 'Map']);
  });

  it('marks the active tab via aria-selected and is-active class', () => {
    render(<AppHeader {...baseProps} activeView="map" />);
    const mapTab = screen.getByRole('tab', { name: /Map view/i });
    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(mapTab).toHaveClass('app-header-tab', 'is-active');
  });

  it('clicking an inactive tab calls onSelectView with that view', async () => {
    const onSelectView = vi.fn();
    render(<AppHeader {...baseProps} onSelectView={onSelectView} activeView="map" />);
    await userEvent.click(screen.getByRole('tab', { name: /Feed view/i }));
    expect(onSelectView).toHaveBeenCalledWith('feed');
  });

  it('ArrowRight on a focused tab moves focus + activation to the next tab', async () => {
    const onSelectView = vi.fn();
    render(<AppHeader {...baseProps} onSelectView={onSelectView} activeView="feed" />);
    const feedTab = screen.getByRole('tab', { name: /Feed view/i });
    feedTab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('species');
  });

  it('renders Filters trigger without badge when filterCount === 0', () => {
    render(<AppHeader {...baseProps} filterCount={0} />);
    const trigger = screen.getByRole('button', { name: /Filters/i });
    expect(trigger).toBeInTheDocument();
    expect(within(trigger).queryByText(/^[1-9]/)).toBeNull();
  });

  it('renders Filters trigger with numeric badge when filterCount > 0', () => {
    render(<AppHeader {...baseProps} filterCount={3} />);
    const trigger = screen.getByRole('button', { name: /Filters \(3 active\)/i });
    expect(within(trigger).getByText('3')).toBeInTheDocument();
    expect(within(trigger).getByText('3')).toHaveClass('app-header-filter-badge');
  });

  it('clicking the Filters trigger calls onOpenFilters', async () => {
    const onOpenFilters = vi.fn();
    render(<AppHeader {...baseProps} onOpenFilters={onOpenFilters} />);
    await userEvent.click(screen.getByRole('button', { name: /Filters/i }));
    expect(onOpenFilters).toHaveBeenCalledTimes(1);
  });

  it('clicking the Attribution link calls onOpenAttribution', async () => {
    const onOpenAttribution = vi.fn();
    render(<AppHeader {...baseProps} onOpenAttribution={onOpenAttribution} />);
    await userEvent.click(screen.getByRole('button', { name: /Credits & attribution/i }));
    expect(onOpenAttribution).toHaveBeenCalledTimes(1);
  });

  it('mounts the <ThemeToggle> in the right cluster', () => {
    render(<AppHeader {...baseProps} />);
    // ThemeToggle from Phase 1 renders a button with aria-label like "Switch to dark theme"
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (file does not exist).**

Run: `npm run test --workspace @bird-watch/frontend -- AppHeader.test.tsx`

Expected: module-not-found error for `./AppHeader.js`. All 10 tests fail.

- [ ] **Step 3: Implement `<AppHeader>`.**

Create `frontend/src/components/AppHeader.tsx`:

```typescript
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
        Bird Maps <span aria-hidden="true">·</span> {REGION_LABEL}
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
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm run test --workspace @bird-watch/frontend -- AppHeader.test.tsx`

Expected: all 10 tests pass.

- [ ] **Step 5: Run the full frontend test suite (no regressions).**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. `<AppHeader>` is not yet mounted in `<App>`, so the rest of the app is unchanged.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/AppHeader.tsx frontend/src/components/AppHeader.test.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): <AppHeader> persistent chrome component (Sky Atlas Phase 3)

Adds a new <AppHeader> that absorbs <SurfaceNav>'s tablist semantics and
adds a right-cluster (Attribution / Filters trigger with badge / Theme
toggle). Pure presentation; <App> owns state. Wired into <App> in the
next commit.

Spec: docs/design/01-spec/architecture.md (Persistent chrome)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire `<AppHeader>` into `<App>`; add Filters panel state

Replace the direct mount of `<FiltersBar>` (`App.tsx:156–164`), `<SurfaceNav>` (`App.tsx:165–168`), and the `<footer>` containing `<AttributionModal>` (`App.tsx:233–256`) with a single `<AppHeader>` plus a `<FiltersBar>` inside a panel keyed off a new `filtersOpen` state. Compute `filterCount` for the badge.

The `<footer>` is NOT removed in this task — Phase 6 owns that. For Phase 3, we keep the `<AttributionModal>` mounted but trigger it from the header instead. The simplest path: keep `<AttributionModal>` rendering itself with its own internal trigger (the existing `<button>` it renders) but also expose a controlled `open` API. We'll add a `controlledOpen?: boolean` prop in this task as well.

Actually — re-reading `<AttributionModal>`'s contract is out of scope for Phase 3 surface chrome. Path of least resistance: `<AppHeader>`'s `onOpenAttribution` callback dispatches a synthetic click on the existing `<AttributionModal>` trigger button (which still renders inside the footer). The footer + its trigger become visually hidden in this task (`display:none`); Phase 6 deletes the footer entirely.

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write a failing test asserting `<App>` mounts `<AppHeader>`, hides `<SurfaceNav>` chrome, and toggles the Filters panel.**

Append to `frontend/src/App.test.tsx`:

```typescript
  describe('Phase 3: AppHeader + Filters panel', () => {
    it('renders <AppHeader> at the top of the app', async () => {
      render(<App />);
      // Wait for initial bird data fetch resolution
      await screen.findByRole('banner');
      expect(screen.getByRole('banner')).toHaveClass('app-header');
    });

    it('does NOT mount <SurfaceNav> directly anymore (its tablist is now inside <AppHeader>)', async () => {
      render(<App />);
      await screen.findByRole('banner');
      // There should be exactly one tablist with aria-label "Surface" — the
      // one inside <AppHeader>. The legacy <SurfaceNav> mount is removed.
      const lists = screen.getAllByRole('tablist', { name: /Surface/i });
      expect(lists).toHaveLength(1);
      expect(lists[0].closest('header.app-header')).not.toBeNull();
    });

    it('Filters trigger opens a panel containing <FiltersBar>; closing hides it', async () => {
      render(<App />);
      await screen.findByRole('banner');
      const trigger = screen.getByRole('button', { name: /Filters/i });
      // Closed initially: the FiltersBar region should not be in the DOM
      expect(screen.queryByRole('region', { name: /Filters/i })).toBeNull();
      await userEvent.click(trigger);
      expect(screen.getByRole('region', { name: /Filters/i })).toBeInTheDocument();
      // Close button inside the panel dismisses it
      await userEvent.click(screen.getByRole('button', { name: /Close filters/i }));
      expect(screen.queryByRole('region', { name: /Filters/i })).toBeNull();
    });

    it('Filters badge count reflects active filters (notable + family = 2)', async () => {
      // Seed URL with active filters before mount
      window.history.replaceState({}, '', '/?notable=true&family=corvidae');
      render(<App />);
      await screen.findByRole('banner');
      const trigger = screen.getByRole('button', { name: /Filters \(2 active\)/i });
      expect(trigger).toBeInTheDocument();
    });
  });
```

If `App.test.tsx` does not yet exist or does not import `userEvent`, add the import at the top of the file: `import userEvent from '@testing-library/user-event';`. If the test file uses MSW handlers for the bird-data endpoints, ensure they're already set up in the `beforeEach`.

- [ ] **Step 2: Run the test to verify failure.**

Run: `npm run test --workspace @bird-watch/frontend -- App.test.tsx`

Expected: 4 failures. The first because `<App>` does not yet render `role="banner"`; the second because `<SurfaceNav>` is still mounted directly; the third because there's no Filters panel state machine; the fourth same.

- [ ] **Step 3: Modify `<App>` to mount `<AppHeader>` + Filters panel.**

In `frontend/src/App.tsx`:

1. Add the `AppHeader` import after the `SurfaceNav` import (line 13). Keep the `SurfaceNav` import for now — we'll delete it in Task 8 if no other consumer remains:

```typescript
import { AppHeader } from './components/AppHeader.js';
```

2. Add a `filtersOpen` state and a `filterCount` derivation inside the component, immediately after the `useUrlState` line (around line 21):

```typescript
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Active-filter count: every non-default URL-state field counts as 1.
  // since !== '14d', notable, speciesCode, familyCode. Detail/view do not
  // count (they're navigation, not filter narrowing).
  const filterCount =
    (state.since !== '14d' ? 1 : 0) +
    (state.notable ? 1 : 0) +
    (state.speciesCode ? 1 : 0) +
    (state.familyCode ? 1 : 0);
```

3. Add a ref for the AttributionModal trigger so the header can dispatch a click into it. Above the `useEffect`/`useMemo` block:

```typescript
  const attributionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const onOpenAttribution = useCallback(() => {
    attributionTriggerRef.current?.click();
  }, []);
```

4. Replace the JSX section from `<FiltersBar … />` through `<SurfaceNav … />` (`App.tsx:156–168`) with:

```tsx
      <AppHeader
        activeView={state.view}
        onSelectView={view => set({ view })}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        onOpenAttribution={onOpenAttribution}
      />
      {filtersOpen && (
        <div className="filters-panel" role="region" aria-label="Filters">
          <button
            type="button"
            className="filters-panel-close"
            onClick={() => setFiltersOpen(false)}
            aria-label="Close filters"
          >
            ×
          </button>
          <FiltersBar
            since={state.since}
            notable={state.notable}
            speciesCode={state.speciesCode}
            familyCode={state.familyCode}
            families={families}
            speciesIndex={speciesIndex}
            onChange={set}
          />
        </div>
      )}
```

Note: this introduces TWO `role="region" aria-label="Filters"` regions when the panel is open AND `<FiltersBar>` itself still uses that role. Resolve by dropping the inner `role="region"` on `<FiltersBar>` (`FiltersBar.tsx:65` — change `<div className="filters-bar" role="region" aria-label="Filters">` to `<div className="filters-bar">`). The outer panel now carries the landmark; the inner `<FiltersBar>` is a plain wrapper. Update any `<FiltersBar>` test that asserts the role to instead assert it on the panel.

5. Modify the `<footer>` (`App.tsx:233–256`) so the `<AttributionModal>` trigger is reachable by ref but visually hidden:

```tsx
      <footer role="contentinfo" className="app-footer" hidden>
        <AttributionModal
          ref={attributionTriggerRef}
          silhouettes={silhouettes}
          loading={silhouettesLoading}
          error={silhouettesError}
          photoAttribution={activeSpeciesMeta?.photoAttribution}
          photoLicense={activeSpeciesMeta?.photoLicense}
        />
      </footer>
```

If `<AttributionModal>` does not currently accept a forwarded ref, this is the minimal change to enable the header dispatch. Wrap it in `React.forwardRef` and forward the ref to its top-level trigger `<button>`. If that refactor is more than ~10 lines, fall back to: render `<AppHeader>` BUT keep the existing footer trigger visible as well, document the duplication in a TODO, and let Phase 6 reconcile. Either path is acceptable; the ref-forwarding path is preferred for the cleaner UX.

- [ ] **Step 4: Run the App tests to verify they pass.**

Run: `npm run test --workspace @bird-watch/frontend -- App.test.tsx`

Expected: all 4 new tests pass; pre-existing App tests pass.

- [ ] **Step 5: Run the full frontend suite for regressions.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. The `<FiltersBar>` `role="region"` move may surface 1–2 test updates in `FiltersBar.test.tsx` or e2e specs that asserted on the role being on the inner element — fix in place.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/components/FiltersBar.tsx frontend/src/components/FiltersBar.test.tsx frontend/src/components/AttributionModal.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): wire <AppHeader> + Filters panel into <App> (Sky Atlas Phase 3)

<App> mounts <AppHeader> in place of the legacy <SurfaceNav> + chrome
<FiltersBar>; <FiltersBar> moves inside a panel keyed off a new
filtersOpen state. The "Filters" trigger badge counts non-default URL
state. <AttributionModal>'s trigger gets a forwarded ref so the
header's "Attribution" button can dispatch a click into it; the
legacy footer is hidden until Phase 6 deletes it.

Spec: docs/design/01-spec/architecture.md (Persistent chrome)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Build `<MapLede>` — 4-template lede component

The lede is a runtime-evaluated truth claim with 4 templates evaluated in priority order. See [`docs/design/01-spec/voice-and-content.md`](../design/01-spec/voice-and-content.md) §"Lede contract". Pure render; the freshness state machine (Phase 6 will own it) is passed in as a prop.

**Files:**
- Create: `frontend/src/components/MapLede.tsx`
- Create: `frontend/src/components/MapLede.test.tsx`

- [ ] **Step 1: Write failing tests for `<MapLede>`.**

Create `frontend/src/components/MapLede.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLede } from './MapLede.js';

describe('<MapLede>', () => {
  it('Template 1: zero results — returns the no-match string', () => {
    render(
      <MapLede
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No sightings match your current filters.',
    );
  });

  it('Template 2: single species — count + common name + region + period', () => {
    render(
      <MapLede
        speciesCount={1}
        observationCount={47}
        speciesCommonName="Vermilion Flycatcher"
        familyName={null}
        period="14 days"
        freshness="fresh"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '47 sightings of Vermilion Flycatcher in Arizona in the last 14 days.',
    );
  });

  it('Template 3: family filter active — N species of family in region in period', () => {
    render(
      <MapLede
        speciesCount={9}
        observationCount={120}
        speciesCommonName={null}
        familyName="woodpeckers"
        period="14 days"
        freshness="fresh"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '9 species of woodpeckers seen across Arizona in the last 14 days.',
    );
  });

  it('Template 4: default — N species across region in period', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona in the last 14 days.',
    );
  });

  it('drops the period clause under freshness="stale"', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="stale"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona.',
    );
    expect(screen.queryByText(/in the last/)).toBeNull();
  });

  it('uses REGION_LABEL constant — text contains "Arizona" exactly', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
      />,
    );
    // Asserts the substitution worked — REGION_LABEL is the source of truth
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /across Arizona/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify failure.**

Run: `npm run test --workspace @bird-watch/frontend -- MapLede.test.tsx`

Expected: module-not-found. 6 tests fail.

- [ ] **Step 3: Implement `<MapLede>`.**

Create `frontend/src/components/MapLede.tsx`:

```typescript
import { REGION_LABEL } from '../config/region.js';

export type Freshness = 'fresh' | 'recent' | 'stale' | 'error';

export interface MapLedeProps {
  /** Number of distinct species across the active filter scope. */
  speciesCount: number;
  /** Number of observations across the active filter scope. */
  observationCount: number;
  /** Common name of the active species filter; null when no species is selected. */
  speciesCommonName: string | null;
  /** Pretty-printed family name (e.g. "woodpeckers"); null when no family filter. */
  familyName: string | null;
  /** Period clause text (e.g. "14 days", "7 days"). */
  period: string;
  /** Freshness state from voice-and-content spec; "stale" drops the period clause. */
  freshness: Freshness;
}

/**
 * Newspaper lede for the map / feed / species surfaces. 4 templates in
 * priority order — see docs/design/01-spec/voice-and-content.md §"Lede
 * contract". Stale data drops the "in the last {period}" clause.
 */
export function MapLede({
  speciesCount,
  observationCount,
  speciesCommonName,
  familyName,
  period,
  freshness,
}: MapLedeProps) {
  const periodClause = freshness === 'stale' ? '' : ` in the last ${period}`;

  let text: string;
  if (observationCount === 0 && speciesCount === 0) {
    // Template 1
    text = 'No sightings match your current filters.';
  } else if (speciesCommonName) {
    // Template 2
    text = `${observationCount} sightings of ${speciesCommonName} in ${REGION_LABEL}${periodClause}.`;
  } else if (familyName) {
    // Template 3
    text = `${speciesCount} species of ${familyName} seen across ${REGION_LABEL}${periodClause}.`;
  } else {
    // Template 4
    text = `${speciesCount} species seen across ${REGION_LABEL}${periodClause}.`;
  }

  return <h1 className="map-lede">{text}</h1>;
}
```

- [ ] **Step 4: Run the test to verify pass.**

Run: `npm run test --workspace @bird-watch/frontend -- MapLede.test.tsx`

Expected: all 6 tests pass.

- [ ] **Step 5: Run full suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/MapLede.tsx frontend/src/components/MapLede.test.tsx
git commit -m "$(cat <<'EOF'
feat(chrome): <MapLede> 4-template newspaper lede (Sky Atlas Phase 3)

Renders the lede sentence from the 4 templates in
docs/design/01-spec/voice-and-content.md §"Lede contract". Pure render;
period clause drops under freshness="stale". <MapSurface> mounts it
in the next commit.

Spec: docs/design/01-spec/voice-and-content.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite `<MapSurface>` context strip — lede + filter sentence + freshness meta

The map surface gains a context strip ABOVE the canvas that mounts `<MapLede>`, `<FilterSentence>`, and a freshness meta line. The full-bleed MapLibre canvas remains below; `<FamilyLegend>` overlay sits on top of the canvas as today.

**Files:**
- Modify: `frontend/src/components/MapSurface.tsx`
- Modify: `frontend/src/components/MapSurface.test.tsx`

- [ ] **Step 1: Write failing tests for context-strip render.**

Append to `frontend/src/components/MapSurface.test.tsx`:

```typescript
  describe('Phase 3: context strip', () => {
    const baseObservations = [
      // 3 species, 3 observations
      makeObs({ subId: 's1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher' }),
      makeObs({ subId: 's2', speciesCode: 'gilwoo', comName: 'Gila Woodpecker' }),
      makeObs({ subId: 's3', speciesCode: 'cacwre', comName: 'Cactus Wren' }),
    ];

    it('mounts <MapLede> with the default-template text', () => {
      render(
        <MapSurface
          observations={baseObservations}
          silhouettes={[]}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          since="14d"
          notable={false}
          freshness="fresh"
          freshnessLabel="Updated 11 min ago · Source: eBird"
        />,
      );
      expect(screen.getByRole('heading', { level: 1, name: /3 species seen across Arizona in the last 14 days\./i })).toBeInTheDocument();
    });

    it('mounts <FilterSentence> when filters are active', () => {
      render(
        <MapSurface
          observations={baseObservations}
          silhouettes={[]}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          since="14d"
          notable={true}
          freshness="fresh"
          freshnessLabel="Updated 11 min ago · Source: eBird"
        />,
      );
      // <FilterSentence> renders a span with class .filter-sentence when filters are non-empty
      expect(document.querySelector('.filter-sentence')).not.toBeNull();
    });

    it('renders the freshness meta line below the lede', () => {
      render(
        <MapSurface
          observations={baseObservations}
          silhouettes={[]}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          since="14d"
          notable={false}
          freshness="fresh"
          freshnessLabel="Updated 11 min ago · Source: eBird"
        />,
      );
      expect(screen.getByText('Updated 11 min ago · Source: eBird')).toHaveClass('map-freshness');
    });

    it('drops period clause and shows "Last updated" copy under stale', () => {
      render(
        <MapSurface
          observations={baseObservations}
          silhouettes={[]}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          since="14d"
          notable={false}
          freshness="stale"
          freshnessLabel="Last updated 9 h ago · Source: eBird"
        />,
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        '3 species seen across Arizona.',
      );
      expect(screen.getByText('Last updated 9 h ago · Source: eBird')).toBeInTheDocument();
    });
  });
```

If `makeObs` is not already a fixture in `MapSurface.test.tsx`, copy the helper used in `MapCanvas.test.tsx` (or any sibling test that builds an `Observation` literal); the exact shape needs `speciesCode`, `comName`, `subId`, plus the standard `lng`, `lat`, `obsDt`, `howMany`, `isNotable`, `familyCode`, `silhouetteId`.

- [ ] **Step 2: Run the test to verify failure.**

Run: `npm run test --workspace @bird-watch/frontend -- MapSurface.test.tsx`

Expected: 4 new tests fail. Existing `<MapSurface>` tests should still pass — they use the old prop shape (no `since`/`notable`/`freshness` props). Step 3 will keep them passing while widening the prop contract.

- [ ] **Step 3: Modify `<MapSurface>` to mount the context strip.**

Edit `frontend/src/components/MapSurface.tsx`:

1. Import the new pieces at the top:

```typescript
import { MapLede, type Freshness } from './MapLede.js';
import { FilterSentence } from './ds/FilterSentence.js';
import type { Since } from '../state/url-state.js';
import { prettyFamily } from '../derived.js';
```

2. Extend `MapSurfaceProps` (after the existing `onViewportChange` field):

```typescript
  // --- Phase 3: context strip ---
  /** Time-window filter (mirrors UrlState.since). */
  since: Since;
  /** Notable-only filter (mirrors UrlState.notable). */
  notable: boolean;
  /** Freshness state from <App>'s freshness derivation. */
  freshness: Freshness;
  /** Pre-formatted freshness meta string (e.g. "Updated 11 min ago · Source: eBird"). */
  freshnessLabel: string;
```

3. Replace the function body's `return` block. The existing `return (<ErrorBoundary>...</ErrorBoundary>)` becomes wrapped in a context strip + map region. Replace the body from line 124 (`return (`) through line 183 with:

```tsx
  // Derive lede inputs from the observations array.
  const speciesCount = new Set(observations.map(o => o.speciesCode).filter(Boolean)).size;
  const observationCount = observations.length;
  const speciesCommonName =
    legendObs.find(o => o.speciesCode && o.speciesCode === observations[0]?.speciesCode)?.comName ?? null;
  const familyName = familyCode ? prettyFamily(familyCode) : null;
  const period = since === '1d' ? '24 hours' : since.replace('d', ' days');

  return (
    <ErrorBoundary
      fallback={
        <div className="error-screen" role="alert">
          <h2>Map failed to load</h2>
          <p>The map could not be displayed. Try refreshing the page.</p>
        </div>
      }
    >
      {onSkipToFeed && (
        <button type="button" className="skip-link" onClick={onSkipToFeed}>
          Skip to species list
        </button>
      )}
      <section className="map-context-strip" aria-label="Map context">
        <MapLede
          speciesCount={speciesCount}
          observationCount={observationCount}
          speciesCommonName={speciesCommonName}
          familyName={familyName}
          period={period}
          freshness={freshness}
        />
        <FilterSentence filters={{ since, notable, speciesCode: null, familyCode }} />
        <p className="map-freshness">{freshnessLabel}</p>
      </section>
      <div className="map-surface">
        <React.Suspense
          fallback={
            <div
              className="map-loading-skeleton"
              role="status"
              aria-live="polite"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-bg-tint, #f4f1ea)',
              }}
            >
              Loading map…
            </div>
          }
        >
          <MapCanvas
            observations={observations}
            silhouettes={silhouettes}
            {...(onSelectSpecies ? { onSelectSpecies } : {})}
            {...(onViewportChange ? { onViewportChange } : {})}
          />
        </React.Suspense>
        <FamilyLegend
          silhouettes={silhouettes}
          observations={legendObs}
          familyCode={familyCode}
          onFamilyToggle={onFamilyToggle}
          defaultExpanded={defaultExpanded}
        />
      </div>
    </ErrorBoundary>
  );
```

4. The destructuring at the top of the function body (`{ observations, legendObservations, ... }`) needs to include the new props: `since`, `notable`, `freshness`, `freshnessLabel`.

5. Update `<App>` (`App.tsx:191–202`) to thread the new props into `<MapSurface>`:

```tsx
        {state.view === 'map' && (
          <MapSurface
            observations={observations}
            legendObservations={viewportObservations}
            silhouettes={silhouettes}
            familyCode={state.familyCode}
            onFamilyToggle={onFamilyToggle}
            onSkipToFeed={onSkipToFeed}
            onSelectSpecies={onSelectSpecies}
            onViewportChange={onViewportChange}
            since={state.since}
            notable={state.notable}
            freshness="fresh"
            freshnessLabel="Updated just now · Source: eBird"
          />
        )}
```

The `freshness="fresh"` + hardcoded `freshnessLabel` are placeholders — Phase 6 wires the freshness state machine from `meta.freshest_observation_at` and `frontend/src/config/freshness.ts`. For Phase 3, hardcoded values are sufficient; the prop wiring exists so Phase 6 only edits one site.

- [ ] **Step 4: Run MapSurface tests to verify pass.**

Run: `npm run test --workspace @bird-watch/frontend -- MapSurface.test.tsx`

Expected: all tests pass — both the new Phase 3 cases and the pre-existing ones (which receive the new required props from a default merge in the test fixture, OR get type errors that you must fix by adding the new props to `baseProps`).

- [ ] **Step 5: Run full suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass. App.test.tsx's existing `view=map` cases will need their fixture observations updated if any assertion now collides with the new lede heading.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/MapSurface.tsx frontend/src/components/MapSurface.test.tsx frontend/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(map): map context strip — lede + filter sentence + freshness (Sky Atlas Phase 3)

<MapSurface> gains a <section class="map-context-strip"> above the
canvas that mounts <MapLede> (4-template newspaper lede),
<FilterSentence> (active-filter narrative), and a freshness meta line.
<App> threads since/notable/freshness/freshnessLabel through; the
freshness fields are placeholders until Phase 6 wires the state
machine from meta.freshest_observation_at.

Spec: docs/design/01-spec/voice-and-content.md (Lede contract,
Freshness label state machine)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Suppress MapLibre cluster paint; render `<ClusterPill>` overlay

Replace the solid-circle MapLibre cluster paint with React-rendered `<ClusterPill>` overlays. The MapLibre cluster *clustering math* stays — only the *paint* layers (`clusters` and `cluster-count`) are suppressed. The hit-test layer (`clusters-hit`) stays unchanged so we can still query cluster features for the overlay.

The overlay component reads cluster features from `map.queryRenderedFeatures({ layers: ['clusters-hit'] })` after each `idle` event, projects each cluster's coordinates to lng/lat, and renders a `<Marker>` per cluster carrying `<ClusterPill>`. The mosaic-vs-circle threshold (`CLUSTER_MOSAIC_MAX_POINTS = 8` at `observation-layers.ts:162`) stays intact: clusters at-or-below 8 keep their HTML mosaic; clusters above 8 become `<ClusterPill>` instead of the old solid circle.

**Files:**
- Modify: `frontend/src/components/map/observation-layers.ts`
- Modify: `frontend/src/components/map/observation-layers.test.ts`
- Modify: `frontend/src/components/map/MapCanvas.tsx`
- Modify: `frontend/src/components/map/MapCanvas.test.tsx`

- [ ] **Step 1: Write failing tests for the layer-spec changes.**

In `frontend/src/components/map/observation-layers.test.ts`, find the test asserting `buildClusterLayerSpec` returns a circle layer with `circle-color` step expression, and replace its assertions with:

```typescript
  describe('buildClusterLayerSpec (Phase 3 — pills replace circle paint)', () => {
    it('returns a layer that never matches features (paint suppressed by filter)', () => {
      const spec = buildClusterLayerSpec();
      expect(spec.id).toBe('clusters');
      expect(spec.type).toBe('circle');
      // Phase 3 suppression: filter is set to a never-true expression so
      // the canvas never paints a cluster circle. The cluster source
      // itself still computes point_count for the React overlay to read.
      expect(spec.filter).toEqual(['boolean', false]);
    });

    it('cluster-count layer also never matches', () => {
      const spec = buildClusterCountLayerSpec();
      expect(spec.id).toBe('cluster-count');
      expect(spec.filter).toEqual(['boolean', false]);
    });

    it('imports CLUSTER_TIER_BOUNDARIES from frontend/src/config/cluster.ts', async () => {
      // Single source of truth assertion — keeps Phase 2 config + Phase 3
      // layer config bound. Snapshot the import path; if either side
      // forks the constant, the import resolves to a module that doesn't
      // re-export it.
      const config = await import('../../config/cluster.js');
      expect(config.CLUSTER_TIER_BOUNDARIES).toEqual({ sand: 100, ember: 750 });
    });
  });
```

Also delete or update any pre-existing test that asserted the cluster circle paint colors (`#51bbd6`, `#f1f075`, `#f28cb1`) — those values are no longer rendered.

- [ ] **Step 2: Write failing tests for the `<ClusterPillOverlay>` in `MapCanvas.test.tsx`.**

Append to `frontend/src/components/map/MapCanvas.test.tsx`:

```typescript
  describe('Phase 3: <ClusterPillOverlay>', () => {
    it('after map idle, renders one <ClusterPill> per cluster feature', async () => {
      const fakeMap = makeFakeMap({
        getZoom: () => 8,
        queryRenderedFeatures: vi.fn().mockReturnValue([
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-110, 32] },
            properties: { cluster: true, cluster_id: 1, point_count: 140 },
          },
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-111, 33] },
            properties: { cluster: true, cluster_id: 2, point_count: 12 },
          },
        ]),
      });

      render(<MapCanvas {...mapCanvasBaseProps} mapRef={{ current: fakeMap }} />);

      // Trigger the idle event listener registered by <ClusterPillOverlay>
      await act(async () => {
        fakeMap.fire('idle');
      });

      const pills = screen.getAllByRole('img', { name: /sightings$/ });
      expect(pills).toHaveLength(2);
      expect(pills[0]).toHaveAttribute('aria-label', '140 sightings');
      expect(pills[1]).toHaveAttribute('aria-label', '12 sightings');
    });

    it('clicking a pill calls map.easeTo with the cluster center and expansion zoom', async () => {
      const fakeMap = makeFakeMap({
        getZoom: () => 8,
        queryRenderedFeatures: vi.fn().mockReturnValue([
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-110, 32] },
            properties: { cluster: true, cluster_id: 1, point_count: 140 },
          },
        ]),
      });
      // Stub the cluster-source's getClusterExpansionZoom so the click handler
      // resolves to a known target zoom.
      fakeMap.getSource = vi.fn().mockReturnValue({
        getClusterExpansionZoom: vi.fn().mockResolvedValue(11),
      });

      render(<MapCanvas {...mapCanvasBaseProps} mapRef={{ current: fakeMap }} />);
      await act(async () => {
        fakeMap.fire('idle');
      });

      const pill = screen.getByRole('img', { name: '140 sightings' });
      await userEvent.click(pill);

      await waitFor(() => {
        expect(fakeMap.easeTo).toHaveBeenCalledWith(
          expect.objectContaining({ center: [-110, 32], zoom: 11 }),
        );
      });
    });
  });
```

If `mapCanvasBaseProps` and `makeFakeMap` are not the actual helper names in this test file, locate the existing equivalents (read the existing cluster-click test around line ~569; the helpers in scope at that point are the canonical ones).

- [ ] **Step 3: Run the tests to verify they fail.**

Run: `npm run test --workspace @bird-watch/frontend -- observation-layers.test.ts MapCanvas.test.tsx`

Expected: observation-layers tests fail because `buildClusterLayerSpec` still returns the old `step` paint expression with no filter override; MapCanvas tests fail because no `<ClusterPillOverlay>` exists.

- [ ] **Step 4: Suppress the cluster paint in `observation-layers.ts`.**

Replace `buildClusterLayerSpec` and `buildClusterCountLayerSpec` (`observation-layers.ts:170–237`):

```typescript
import { CLUSTER_TIER_BOUNDARIES } from '../../config/cluster.js';

/**
 * Phase 3: cluster paint is suppressed. The MapLibre cluster source still
 * runs (for `point_count` aggregation), but no canvas paint is drawn —
 * <ClusterPillOverlay> in MapCanvas reads cluster features via
 * queryRenderedFeatures({ layers: ['clusters-hit'] }) and renders a React
 * <ClusterPill> per cluster instead. The pill component imports
 * CLUSTER_TIER_BOUNDARIES from the same config module this file imports
 * from (single source of truth).
 *
 * The hit-test layer 'clusters-hit' is unchanged — it covers all clusters
 * with transparent paint so queryRenderedFeatures still returns features
 * even though no visible paint exists.
 */
export function buildClusterLayerSpec(): LayerProps {
  return {
    id: 'clusters',
    type: 'circle',
    source: 'observations',
    filter: ['boolean', false],
    paint: {
      'circle-opacity': 0,
      'circle-stroke-opacity': 0,
      'circle-color': '#000',
      'circle-radius': 0,
    },
  };
}

export function buildClusterCountLayerSpec(): LayerProps {
  return {
    id: 'cluster-count',
    type: 'symbol',
    source: 'observations',
    filter: ['boolean', false],
    layout: {
      'text-field': '',
      'text-size': 12,
      'text-font': ['Noto Sans Regular'],
    },
    paint: {
      'text-color': 'transparent',
    },
  };
}

// CLUSTER_TIER_BOUNDARIES is re-exported here for callers that need the
// full lookup; the single source of truth lives in
// frontend/src/config/cluster.ts.
export { CLUSTER_TIER_BOUNDARIES };
```

The `'clusters-hit'` layer (`buildClustersHitLayerSpec`) and `CLUSTER_MOSAIC_MAX_POINTS` are NOT changed — small clusters (≤8) still render as HTML mosaics; large clusters (>8) render as `<ClusterPill>` instead of the old solid circle.

- [ ] **Step 5: Add `<ClusterPillOverlay>` to `MapCanvas.tsx`.**

Inside `MapCanvas.tsx`, immediately before the existing `MapView` JSX block (around line 786), add the component definition:

```typescript
import { ClusterPill } from '../ds/ClusterPill.js';
import { Marker } from 'react-map-gl/maplibre';

interface ClusterFeature {
  cluster_id: number;
  point_count: number;
  lng: number;
  lat: number;
}

function ClusterPillOverlay({ map }: { map: maplibregl.Map | null }) {
  const [clusters, setClusters] = React.useState<ClusterFeature[]>([]);

  React.useEffect(() => {
    if (!map) return;
    const refresh = () => {
      const feats = map.queryRenderedFeatures(undefined, {
        layers: ['clusters-hit'],
      }) as Array<{
        geometry: { type: 'Point'; coordinates: [number, number] };
        properties: { cluster?: boolean; cluster_id?: number; point_count?: number };
      }>;
      const next: ClusterFeature[] = [];
      for (const f of feats) {
        if (
          f.properties.cluster === true &&
          typeof f.properties.cluster_id === 'number' &&
          typeof f.properties.point_count === 'number' &&
          f.geometry.type === 'Point'
        ) {
          next.push({
            cluster_id: f.properties.cluster_id,
            point_count: f.properties.point_count,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          });
        }
      }
      setClusters(next);
    };
    map.on('idle', refresh);
    refresh();
    return () => {
      map.off('idle', refresh);
    };
  }, [map]);

  const onClusterClick = React.useCallback(
    async (cluster: ClusterFeature) => {
      if (!map) return;
      const src = map.getSource('observations') as
        | { getClusterExpansionZoom: (id: number) => Promise<number> }
        | undefined;
      if (!src) return;
      try {
        const targetZoom = await src.getClusterExpansionZoom(cluster.cluster_id);
        map.easeTo({
          center: [cluster.lng, cluster.lat],
          zoom: Math.min(targetZoom, CLUSTER_MAX_ZOOM),
          ...(prefersReducedMotion ? { duration: 0 } : {}),
        });
      } catch {
        // getClusterExpansionZoom rejects when the cluster_id has been
        // recycled (camera moved fast enough that the source rebuilt).
        // Silently drop — next idle will repopulate the overlay.
      }
    },
    [map],
  );

  return (
    <>
      {clusters.map(c => (
        <Marker key={c.cluster_id} longitude={c.lng} latitude={c.lat} anchor="center">
          <ClusterPill count={c.point_count} onClick={() => onClusterClick(c)} />
        </Marker>
      ))}
    </>
  );
}
```

`prefersReducedMotion` was introduced in Phase 0 Task 4 (`MapCanvas.tsx`); reuse the existing closure value. If the variable is declared inside the parent component's body, hoist `<ClusterPillOverlay>` so it accepts `prefersReducedMotion` as a prop (cleaner) or define it inline inside the parent function so the closure captures it (faster).

Mount the overlay inside the `<MapView>` JSX, after the `Source`/`Layer` blocks:

```tsx
        {map && <ClusterPillOverlay map={map} />}
```

The existing `mosaic click` handler at `MapCanvas.tsx:729` (which calls `easeTo` for HTML-mosaic clusters at `point_count <= 8`) stays — it handles small clusters; the overlay handles large ones.

- [ ] **Step 6: Run the tests to verify pass.**

Run: `npm run test --workspace @bird-watch/frontend -- observation-layers.test.ts MapCanvas.test.tsx`

Expected: all tests pass.

- [ ] **Step 7: Run full suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/components/map/observation-layers.ts frontend/src/components/map/observation-layers.test.ts frontend/src/components/map/MapCanvas.tsx frontend/src/components/map/MapCanvas.test.tsx
git commit -m "$(cat <<'EOF'
feat(map): replace cluster circles with <ClusterPill> overlay (Sky Atlas Phase 3)

MapLibre's cluster paint layers are filtered to a never-true
expression. <ClusterPillOverlay> reads cluster features from
queryRenderedFeatures({ layers: ['clusters-hit'] }) on each map idle
and renders a React <Marker> per cluster carrying <ClusterPill> from
Phase 2. The mosaic-vs-pill threshold
(CLUSTER_MOSAIC_MAX_POINTS = 8) is unchanged; small clusters still
render as HTML mosaics, large ones as pills. Click-to-zoom delegates
to source.getClusterExpansionZoom + map.easeTo (with the Phase 0
reduced-motion guard reused).

Spec: docs/design/01-spec/components.md (<ClusterPill>, "rendered as
React <Marker> overlays … not as MapLibre paint")

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Revise `<FamilyLegend>` — mobile-collapsed default + shape-paired swatches

Two semantic changes:

1. **Mobile-collapsed default.** The current `defaultExpanded` heuristic at `MapSurface.tsx:23–31` returns `true` on viewports ≥760px and `false` below. That's correct mathematically but the `localStorage` precedence at `FamilyLegend.tsx:135–138` clobbers it: any prior `true` value (set on a desktop visit) survives across a viewport flip. Phase 3 resolves analysis Theme 3: when `localStorage` is empty AND viewport is mobile, the legend MUST start collapsed; reload after `localStorage.clear()` must also start collapsed on mobile.

2. **Shape-paired swatches.** Each family entry's swatch becomes `<FamilySilhouette>` from Phase 2, called with `shape={getFamilyChannel(code).shape}`. The shape pairing survives greyscale (WCAG 1.4.1). Replaces the inline `<SilhouetteGlyph>` at `FamilyLegend.tsx:58–84` (delete that helper).

There's a `localStorage` migration concern: if the user has a stale `family-legend-expanded === 'true'` set from a desktop visit, then opens the site on mobile, the localStorage value wins under current code. The fix is to drop localStorage as the source of truth for *first paint*; localStorage only persists *post-toggle*. A clean migration: rename the storage key to `family-legend-expanded.v2`, delete the legacy key. The `.v2` key is only written after a manual toggle, so first paints always defer to viewport.

**Files:**
- Modify: `frontend/src/components/FamilyLegend.tsx`
- Modify: `frontend/src/components/FamilyLegend.test.tsx`

- [ ] **Step 1: Write failing tests for mobile-collapsed default + shape pairing.**

Append to `frontend/src/components/FamilyLegend.test.tsx`:

```typescript
  describe('Phase 3: mobile-collapsed default', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('mobile viewport with empty localStorage starts collapsed', () => {
      render(
        <FamilyLegend
          silhouettes={fakeSilhouettes}
          observations={fakeObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('legacy localStorage value (.v1 key) is migrated and ignored on first paint', () => {
      // The user previously set the legacy key on desktop. On mobile first
      // paint, the legacy key is deleted and the viewport hint wins.
      window.localStorage.setItem('family-legend-expanded', 'true');
      render(
        <FamilyLegend
          silhouettes={fakeSilhouettes}
          observations={fakeObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(window.localStorage.getItem('family-legend-expanded')).toBeNull();
    });

    it('persistence under the new .v2 key wins on subsequent mounts', () => {
      window.localStorage.setItem('family-legend-expanded.v2', 'true');
      render(
        <FamilyLegend
          silhouettes={fakeSilhouettes}
          observations={fakeObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={false}
        />,
      );
      expect(screen.getByRole('button', { name: /Bird families in view/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  describe('Phase 3: shape-paired swatches', () => {
    it('each entry swatch is a <FamilySilhouette> with the shape from getFamilyChannel', () => {
      render(
        <FamilyLegend
          silhouettes={fakeSilhouettes}
          observations={fakeObservations}
          familyCode={null}
          onFamilyToggle={vi.fn()}
          defaultExpanded={true}
        />,
      );
      const entries = screen.getAllByTestId('family-legend-entry');
      // Each entry button contains a <FamilySilhouette> with data-shape attr
      for (const entry of entries) {
        const shape = entry.querySelector('[data-shape]');
        expect(shape).not.toBeNull();
        expect(['circle', 'square', 'pentagon', 'diamond']).toContain(
          shape!.getAttribute('data-shape'),
        );
      }
    });
  });
```

- [ ] **Step 2: Run the tests to verify failure.**

Run: `npm run test --workspace @bird-watch/frontend -- FamilyLegend.test.tsx`

Expected: 4 new tests fail.

- [ ] **Step 3: Update `FamilyLegend.tsx`.**

Replace the contents of `frontend/src/components/FamilyLegend.tsx`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import type { FamilySilhouette as FamilySilhouetteData, Observation } from '@bird-watch/shared-types';
import { prettyFamily } from '../derived.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';
import { getFamilyChannel } from '../config/family-palette.js';

const STORAGE_KEY = 'family-legend-expanded.v2';
const LEGACY_STORAGE_KEY = 'family-legend-expanded';

export interface FamilyLegendProps {
  silhouettes: FamilySilhouetteData[];
  observations: Observation[];
  familyCode: string | null;
  onFamilyToggle: (familyCode: string) => void;
  /**
   * Default expansion state on first paint when localStorage is empty.
   * Driven by the responsive @media query in MapSurface (mobile collapsed,
   * desktop expanded). Once the user toggles, the new .v2 storage key
   * wins on subsequent mounts.
   */
  defaultExpanded: boolean;
}

function readStoredExpanded(): boolean | null {
  try {
    // Migration: drop the legacy key so it can't clobber the mobile
    // viewport hint on first paint. This runs on every mount; effectively
    // free.
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredExpanded(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Storage failures are non-fatal — the legend forgets next mount.
  }
}

interface LegendEntry {
  familyCode: string;
  label: string;
  count: number;
  silhouette: FamilySilhouetteData;
}

function buildEntries(
  silhouettes: FamilySilhouetteData[],
  observations: Observation[],
): LegendEntry[] {
  const counts = new Map<string, number>();
  for (const o of observations) {
    if (!o.familyCode) continue;
    counts.set(o.familyCode, (counts.get(o.familyCode) ?? 0) + 1);
  }
  const byCode = new Map<string, FamilySilhouetteData>();
  for (const s of silhouettes) byCode.set(s.familyCode, s);

  const out: LegendEntry[] = [];
  for (const [code, count] of counts.entries()) {
    if (count === 0) continue;
    const silhouette = byCode.get(code);
    if (!silhouette) continue;
    out.push({
      familyCode: code,
      label: silhouette.commonName ?? prettyFamily(code),
      count,
      silhouette,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function FamilyLegend({
  silhouettes,
  observations,
  familyCode,
  onFamilyToggle,
  defaultExpanded,
}: FamilyLegendProps) {
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = readStoredExpanded();
    return stored ?? defaultExpanded;
  });

  // Persist on every change. The skip-once-on-mount optimization is
  // deferred — the write is idempotent and synchronous; cost is trivial.
  useEffect(() => {
    writeStoredExpanded(expanded);
  }, [expanded]);

  const entries = useMemo(
    () => buildEntries(silhouettes, observations),
    [silhouettes, observations],
  );

  if (silhouettes.length === 0) return null;

  const toggleId = 'family-legend-toggle';

  return (
    <aside
      className="family-legend"
      aria-labelledby={toggleId}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        id={toggleId}
        type="button"
        className="family-legend-toggle"
        aria-expanded={expanded}
        aria-controls="family-legend-entries"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="family-legend-title">Bird families in view</span>
        <span className="family-legend-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && entries.length > 0 && (
        <ul
          id="family-legend-entries"
          className="family-legend-entries"
          role="list"
        >
          {entries.map(entry => {
            const active = entry.familyCode === familyCode;
            const channel = getFamilyChannel(entry.familyCode);
            return (
              <li key={entry.familyCode} className="family-legend-entry-item">
                <button
                  type="button"
                  data-testid="family-legend-entry"
                  className={'family-legend-entry' + (active ? ' is-active' : '')}
                  aria-pressed={active}
                  onClick={() => onFamilyToggle(entry.familyCode)}
                >
                  <FamilySilhouette
                    family={entry.familyCode}
                    layout="thumb"
                    shape={channel.shape}
                  />
                  <span className="family-legend-entry-label">{entry.label}</span>
                  <span
                    className="family-legend-entry-count"
                    aria-label={`${entry.count} observations in view`}
                  >
                    {entry.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run tests to verify pass.**

Run: `npm run test --workspace @bird-watch/frontend -- FamilyLegend.test.tsx`

Expected: all tests pass — both the new Phase 3 cases and the pre-existing ones (which used the old inline `<SilhouetteGlyph>` rendering; tests that asserted on `<svg>` markup may need a small update — find those tests and replace `<svg>` selectors with `<FamilySilhouette>` selectors via `data-shape`).

- [ ] **Step 5: Run full suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add frontend/src/components/FamilyLegend.tsx frontend/src/components/FamilyLegend.test.tsx
git commit -m "$(cat <<'EOF'
feat(map): <FamilyLegend> mobile-collapsed default + shape swatches (Sky Atlas Phase 3)

Two changes resolving analysis Theme 3 (FamilyLegend mobile default):

1. localStorage key migrates from family-legend-expanded to
   family-legend-expanded.v2; legacy key is deleted on read so a stale
   desktop value can't clobber the mobile viewport hint on first paint.
2. Per-entry swatch becomes <FamilySilhouette shape={...} /> from Phase
   2; the shape pairs with family color so the encoding survives
   greyscale (WCAG 1.4.1).

Spec: docs/design/01-spec/components.md (<FamilySilhouette>),
docs/design/03-research/critique-loops-summary.md K3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Verify basemap swap on `[data-theme]` change is FOUC-free

Phase 1 already wires the `MutationObserver` on `<html>` `data-theme` and calls `map.setStyle()` with the new basemap URL. Phase 1 also exports `basemapStyleLight` and `basemapStyleDark`. Phase 3's job: rename to `BASEMAP_LIGHT` / `BASEMAP_DARK` (per spec), confirm `BASEMAP_DARK` aliases `BASEMAP_LIGHT` until the G7/G8 prototype gates close, and verify smoothness end-to-end.

If Phase 1's plan instead shipped names like `basemapStyleLight` / `basemapStyleDark`, this task renames them. The constants resolve to the same OpenFreeMap positron URL until G8 closes — there is NO functional dark basemap to ship in Phase 3.

**Files:**
- Modify: `frontend/src/components/map/basemap-style.ts`
- Modify: any consumer (`frontend/src/components/map/MapCanvas.tsx`, `MapCanvas.test.tsx`) that imports the old names

- [ ] **Step 1: Write a failing test that asserts the new export names exist with the expected aliasing.**

Create `frontend/src/components/map/basemap-style.test.ts` (or append if it exists):

```typescript
import { describe, it, expect } from 'vitest';
import { BASEMAP_LIGHT, BASEMAP_DARK, basemapStyle } from './basemap-style.js';

describe('basemap-style', () => {
  it('exports BASEMAP_LIGHT pointing at OpenFreeMap positron', () => {
    expect(BASEMAP_LIGHT).toBe('https://tiles.openfreemap.org/styles/positron');
  });

  it('exports BASEMAP_DARK aliasing BASEMAP_LIGHT until G7/G8 close', () => {
    // Until G7 (family × basemap contrast) and G8 (dark basemap palette)
    // prototype-gates close, BASEMAP_DARK is a literal alias of
    // BASEMAP_LIGHT. A real dark tile URL is gated behind those gates.
    expect(BASEMAP_DARK).toBe(BASEMAP_LIGHT);
  });

  it('keeps `basemapStyle` as a back-compat alias of BASEMAP_LIGHT', () => {
    expect(basemapStyle).toBe(BASEMAP_LIGHT);
  });
});
```

- [ ] **Step 2: Run the test to verify failure.**

Run: `npm run test --workspace @bird-watch/frontend -- basemap-style.test.ts`

Expected: test fails because `BASEMAP_LIGHT` and `BASEMAP_DARK` are not yet exported (Phase 1 either did not ship them or shipped with different names).

- [ ] **Step 3: Update `basemap-style.ts`.**

Replace the contents of `frontend/src/components/map/basemap-style.ts`:

```typescript
/**
 * Basemap styles for the map surface.
 *
 * Two named exports — BASEMAP_LIGHT and BASEMAP_DARK — drive the basemap
 * swap when `[data-theme]` changes on <html>. The MutationObserver wired
 * up in Phase 1 of the Sky Atlas redesign (MapCanvas.tsx) reads the
 * current attribute on every mutation and calls map.setStyle() with the
 * matching URL.
 *
 * BASEMAP_DARK is a LITERAL alias of BASEMAP_LIGHT until the G7 (family
 * palette × basemap contrast) and G8 (dark basemap palette ratification)
 * prototype gates close. The dark mode mechanic ships in Phase 1; the
 * dark-tile URL only switches in once the gates close. Two named exports
 * exist so consumer code (MapCanvas) is forward-compatible — flipping
 * the alias to a real dark tile URL is a one-line change here.
 *
 * `basemapStyle` is preserved as a back-compat alias of BASEMAP_LIGHT
 * so existing callers (and tests) that imported the old name continue
 * to type-check during the rename. Delete in a follow-up sweep once
 * grep confirms zero callers.
 *
 * Spec: docs/design/01-spec/architecture.md §"Light / dark mode"
 * Gate: docs/design/01-spec/open-questions.md G7, G8
 */
export const BASEMAP_LIGHT: string = 'https://tiles.openfreemap.org/styles/positron';
export const BASEMAP_DARK: string = BASEMAP_LIGHT;

/** @deprecated Use BASEMAP_LIGHT — alias preserved for back-compat. */
export const basemapStyle = BASEMAP_LIGHT;
```

- [ ] **Step 4: Update consumers.**

Run: `grep -rn "basemapStyle\|basemapStyleLight\|basemapStyleDark" frontend/src/`

For each hit:
- Replace `basemapStyleLight` with `BASEMAP_LIGHT`.
- Replace `basemapStyleDark` with `BASEMAP_DARK`.
- Leave `basemapStyle` (singular) usages alone — they go through the alias and continue to work.

The MutationObserver in `MapCanvas.tsx` (added in Phase 1) needs the new names. If Phase 1 shipped a `setStyle` call like `map.setStyle(theme === 'dark' ? basemapStyleDark : basemapStyleLight)`, update to `BASEMAP_DARK : BASEMAP_LIGHT`.

- [ ] **Step 5: Run tests to verify pass.**

Run: `npm run test --workspace @bird-watch/frontend -- basemap-style.test.ts MapCanvas.test.tsx`

Expected: all tests pass.

- [ ] **Step 6: Manual smoke test for FOUC.**

Run the dev server: `npm run dev --workspace @bird-watch/frontend`

In Chrome at `http://localhost:5173/`:
1. Open DevTools → Application → Local Storage → clear.
2. Reload. Map renders in light theme.
3. Click the Theme toggle in `<AppHeader>`. Observe: the basemap should swap (since `BASEMAP_DARK === BASEMAP_LIGHT` until G8 closes, you'll see the same light tiles re-load — that's expected; the swap mechanic is what's being tested, not the visible delta).
4. Watch the network tab: positron tiles re-fetch on the swap. Watch for layout shift, missing markers during the reload, or visible flash of unstyled background.
5. The acceptance bar: no FOUC. The MapLibre `setStyle` reload preserves layers (the MapCanvas implementation passes `{ diff: true }` or re-adds custom layers in a `style.load` listener — Phase 1 owns the wiring).

If a FOUC IS observed, the fix is in `MapCanvas.tsx`'s style-swap handler — likely the custom observation/cluster layers need to be re-registered after `setStyle`. Phase 1's plan describes this; if it didn't ship correctly, fix here, otherwise this task is verification-only.

- [ ] **Step 7: Run full suite.**

Run: `npm run test --workspace @bird-watch/frontend`

Expected: all tests pass.

- [ ] **Step 8: Commit.**

```bash
git add frontend/src/components/map/basemap-style.ts frontend/src/components/map/basemap-style.test.ts frontend/src/components/map/MapCanvas.tsx frontend/src/components/map/MapCanvas.test.tsx
git commit -m "$(cat <<'EOF'
refactor(map): BASEMAP_LIGHT / BASEMAP_DARK exports (Sky Atlas Phase 3)

Renames the basemap-style exports to the spec's BASEMAP_LIGHT /
BASEMAP_DARK; BASEMAP_DARK aliases BASEMAP_LIGHT until G7/G8 close.
basemapStyle preserved as a back-compat alias to keep grep-clean.
Phase 1's MutationObserver swap mechanic verified smooth with the new
chrome composition (no FOUC on theme toggle, manual smoke).

Spec: docs/design/01-spec/architecture.md §"Light / dark mode"
Gate: docs/design/01-spec/open-questions.md G7, G8

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Add new e2e + axe assertions for cluster pill and FamilyLegend mobile default

Three e2e additions:

1. **Axe scan for cluster pill** — at the map view, after render is complete, axe must find at least one element matching `role="img"` with an `aria-label` ending in `" sightings"`, and the scan must produce zero violations.
2. **Family-legend mobile default** — at 390×844, after `localStorage.clear()`, the first paint of `<FamilyLegend>` must have `aria-expanded="false"`.
3. **`<AppPage>` Page Object Model update** — `surfaceNav` references become `appHeader`, with new locators for `filtersTrigger` and `themeToggle`.

**Files:**
- Modify: `frontend/e2e/axe.spec.ts`
- Modify: `frontend/e2e/family-legend.spec.ts`
- Modify: `frontend/e2e/pages/app-page.ts`

- [ ] **Step 1: Update the Page Object Model.**

In `frontend/e2e/pages/app-page.ts`, replace any `surfaceNav` getter with:

```typescript
  appHeader = this.page.locator('header.app-header');
  appHeaderTabs = this.appHeader.getByRole('tab');
  filtersTrigger = this.appHeader.getByRole('button', { name: /^Filters/ });
  themeToggle = this.appHeader.getByRole('button', { name: /Switch to (light|dark) theme/ });
  attributionTrigger = this.appHeader.getByRole('button', { name: /Credits & attribution/ });
```

Update any helper methods that referenced `surfaceNav`, e.g.:

```typescript
  async selectView(view: 'feed' | 'species' | 'map'): Promise<void> {
    const labelMap = { feed: 'Feed view', species: 'Species view', map: 'Map view' };
    await this.appHeader.getByRole('tab', { name: labelMap[view] }).click();
  }
```

- [ ] **Step 2: Add the cluster-pill axe assertion to `axe.spec.ts`.**

Find the existing `'map view has no WCAG 2/2.1 A/AA violations (desktop)'` test (around line 33). Add a sibling test immediately after it:

```typescript
  test('cluster pills resolve to role="img" with "{count} sightings" aria-label', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('view=map');
    await app.waitForAppReady();
    await expect(page.locator('[data-testid=map-canvas]')).toBeVisible({ timeout: 15_000 });
    // Wait for at least one cluster pill to mount. Headless Chromium ships
    // without WebGL by default; if the map can't render, this expectation
    // surfaces a clear "no pills found" failure rather than a timeout
    // mid-axe-scan.
    await expect(page.getByRole('img', { name: /sightings$/ })).toHaveCount(1, {
      timeout: 15_000,
    });
    const pillLabel = await page.getByRole('img', { name: /sightings$/ }).first().getAttribute('aria-label');
    expect(pillLabel).toMatch(/^\d+ sightings$/);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    if (results.violations.length) {
      await test.info().attach('axe-violations', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      });
    }
    expect(results.violations).toEqual([]);
  });
```

If headless Chromium without WebGL can't render the map at all and this test consistently fails for that reason, gate the test on the existence of an `<canvas>` element first; if the canvas is empty (zero pixels rendered), skip with `test.skip(true, 'WebGL unavailable in headless Chromium')`. The acceptance criterion is the assertion structure being correct in CI; the visual rendering check belongs in Playwright-with-Chrome (manual UI verification per CLAUDE.md).

- [ ] **Step 3: Add the mobile-collapsed family-legend e2e test.**

In `frontend/e2e/family-legend.spec.ts`, find the existing `'renders collapsed by default on mobile view=map'` test (line ~97). Replace its body with the stricter localStorage-cleared assertion:

```typescript
  test('renders collapsed by default on mobile view=map (after localStorage.clear)', async ({ page }) => {
    // Resolves analysis Theme 3 — even after a desktop visit set the
    // legacy storage key, mobile first-paint must respect the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.clear();
      // Also seed the legacy key — this is the regression case (a stale
      // desktop value clobbering the mobile default).
      window.localStorage.setItem('family-legend-expanded', 'true');
    });
    await page.goto('/?view=map');
    await page.waitForLoadState('networkidle');

    const toggle = page.getByRole('button', { name: /Bird families in view/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // The legacy key must have been deleted by the migration on read.
    const legacyValue = await page.evaluate(() => window.localStorage.getItem('family-legend-expanded'));
    expect(legacyValue).toBeNull();
  });
```

- [ ] **Step 4: Run the full e2e suite.**

Run: `npm run test:e2e --workspace @bird-watch/frontend`

Expected: all e2e tests pass. The two new tests run alongside the existing 13 axe combinations and the existing FamilyLegend specs.

If any pre-existing e2e spec referenced `surfaceNav` (rather than going through the Page Object Model), update those call sites in place — change to `appHeader` selectors. Run grep to enumerate: `grep -rn "surfaceNav\|surface-nav\|.surface-nav-tab" frontend/e2e/`.

- [ ] **Step 5: Commit.**

```bash
git add frontend/e2e/
git commit -m "$(cat <<'EOF'
test(e2e): cluster-pill axe scan + mobile FamilyLegend default (Sky Atlas Phase 3)

Adds two e2e assertions and updates the Page Object Model:
- axe.spec.ts: cluster pills resolve to role="img" with "{count} sightings"
  aria-label; full axe scan stays violation-free at the map view.
- family-legend.spec.ts: at 390×844, after localStorage.clear() AND a
  legacy `family-legend-expanded=true` value, first paint is collapsed
  and the legacy key is migrated.
- pages/app-page.ts: appHeader / filtersTrigger / themeToggle /
  attributionTrigger locators replace the old surfaceNav reference.

Spec: docs/design/01-spec/components.md (<ClusterPill> a11y),
docs/design/03-research/critique-loops-summary.md K3

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Run the full validation suite end-to-end

Same checks Mergify will require (test, lint, build, e2e). Run all four locally before opening the PR.

**Files:** none modified (unless validation surfaces a regression).

- [ ] **Step 1: Run the full unit test suite from repo root.**

Run: `npm test`

Expected: all unit tests pass across all workspaces.

- [ ] **Step 2: Run the lint suite.**

Run: `npm run lint`

Expected: no errors. Common Phase 3 lint hits: `react-hooks/exhaustive-deps` on the new `<ClusterPillOverlay>` `useEffect` (add `prefersReducedMotion` and `map` to the array if missing); `import/no-unused-modules` if the legacy `<SurfaceNav>` mount got dropped but the import lingers. Fix in place — do not silence with `eslint-disable`.

- [ ] **Step 3: Run knip.**

Run: `npm run knip --workspace @bird-watch/frontend` (or the repo-root variant if there is one).

Expected: no new findings. If `<SurfaceNav>` shows as unused (the `<App>` mount is gone but the file still exports the component), do NOT delete the file in this PR — file a follow-up issue and add a knip ignore rule per the CLAUDE.md knip false-positive workflow:

```typescript
  // SurfaceNav.tsx — temporarily orphaned post-Sky-Atlas Phase 3 (the
  // <App> mount moved into <AppHeader>). Keep until a follow-up sweep
  // confirms no other consumer exists; deleting in this PR exceeds the
  // phase scope. Re-audit by 2026-08-09. (added 2026-05-09)
  ignore: ['frontend/src/components/SurfaceNav.tsx'],
```

The knip-required-check Mergify gotcha (CLAUDE.md): a knip failure blocks the queue. Resolve before posting `@Mergifyio queue`.

- [ ] **Step 4: Run the frontend build.**

Run: `npm run build --workspace @bird-watch/frontend`

Expected: build succeeds; bundle size unchanged from baseline ±5 KB. No new chunks.

- [ ] **Step 5: Run the e2e suite.**

Run: `npm run test:e2e --workspace @bird-watch/frontend`

Expected: all Playwright specs pass. Be specific about Surface checks:
- `axe.spec.ts` (16 combinations now: 13 pre-existing + cluster pill + 2 attribution-modal scans + the desktop map scan)
- `family-legend.spec.ts` (mobile-collapsed default with localStorage migration)
- `happy-path.spec.ts` and any spec that loaded `/` and asserted on the chrome — those locators may need migration to `appHeader`
- `map.spec.ts`, `map-cluster-mosaic.spec.ts`, `map-skip-link-and-hit-layer.spec.ts`, `map-stack-fanout.spec.ts`, `map-symbol-layer.spec.ts` — these may interact with the cluster paint that's now suppressed; update assertions if any asserted on canvas-rendered cluster colors.

- [ ] **Step 6: Drive the new UI live with Playwright MCP per CLAUDE.md UI-verification protocol.**

`npm run dev --workspace @bird-watch/frontend` in a separate terminal.

Steps:
1. `mcp__plugin_playwright_playwright__browser_navigate` to `http://localhost:5173/`
2. `browser_resize` to 390×844 (mobile) — confirm: lede renders, family legend collapsed, no console warnings.
3. `browser_resize` to 1440×900 (desktop) — confirm: lede renders, family legend expanded, AppHeader nav has 3 tabs with active-tab underline on Map.
4. Click the Filters trigger; confirm the panel opens with `<FiltersBar>` content; toggle "Notable only"; confirm the badge shows `1`.
5. Click the Theme toggle; confirm `[data-theme]` flips on `<html>` and the basemap reloads (no FOUC).
6. `browser_console_messages` returns zero errors and zero warnings on both viewports.
7. `browser_take_screenshot` per viewport for the PR Screenshots section. Use the `pr-screenshots-via-user-attachments` skill (per user-level CLAUDE.md) to convert these to `user-attachments/assets/<uuid>` URLs — never commit the PNGs.

- [ ] **Step 7: If validation surfaces any e2e or unit test that needs updates beyond locator migration, commit them as a separate commit before the PR.**

```bash
git add frontend/
git commit -m "$(cat <<'EOF'
test: validation-pass updates for Sky Atlas Phase 3

Test updates surfaced by the full validation gate (npm test + lint +
knip + build + e2e). Locator migrations from <SurfaceNav> to
<AppHeader>; cluster-paint assertions dropped where they asserted
canvas pixels that no longer paint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Open the PR

Use the `creating-prs` skill (and project `pr-workflow` skill at `.claude/skills/pr-workflow/SKILL.md`) for the full opening protocol. CLAUDE.md is explicit: PR body MUST follow `.github/PULL_REQUEST_TEMPLATE.md` verbatim — all 5 sections; Screenshots is REQUIRED on `frontend/**` PRs.

**Files:** none modified.

- [ ] **Step 1: Push the branch.**

```bash
git push -u origin feat/sky-atlas-phase-3-map-surface
```

- [ ] **Step 2: Open the PR.**

```bash
gh pr create --title "feat: Sky Atlas Phase 3 — map surface redesign" --body "$(cat <<'EOF'
## Summary
- New `<AppHeader>` chrome (wordmark + desktop nav with active-tab accent + Attribution / Filters trigger with badge / Theme toggle); replaces `<SurfaceNav>` mount in `<App>` and the legacy footer trigger path.
- `<MapSurface>` rewrite: context strip with `<MapLede>` (4-template newspaper lede), `<FilterSentence>`, freshness meta line; full-bleed MapLibre canvas remains below.
- Cluster pills replace MapLibre solid-circle paint — paint suppressed via never-true filter; `<ClusterPillOverlay>` reads cluster features from `queryRenderedFeatures` and renders one React `<Marker>` per cluster carrying Phase 2's `<ClusterPill>`.
- `<FamilyLegend>` revised: localStorage key migrates to `.v2`, mobile first-paint after `localStorage.clear()` is collapsed, swatches use Phase 2's `<FamilySilhouette>` with shape-paired encoding.
- `BASEMAP_LIGHT` / `BASEMAP_DARK` exports replace the Phase 1 names; `BASEMAP_DARK` aliases `BASEMAP_LIGHT` until G7/G8 close. Phase 1's MutationObserver swap verified smooth on the new chrome composition.

## Test plan
- [x] All Phase 3 unit tests pass: `<AppHeader>` (10), `<MapLede>` (6), `<MapSurface>` context strip (4), `<ClusterPillOverlay>` (2), `<FamilyLegend>` Phase 3 (4), basemap exports (3).
- [x] No regressions: `npm test` green across all workspaces.
- [x] Lint green; knip green (or any orphaned-by-rename file documented in `knip.ts` with a dated comment).
- [x] `npm run build` succeeds; bundle size delta within ±5 KB of baseline.
- [x] e2e suite green, including new cluster-pill axe scan and mobile FamilyLegend collapsed default.
- [x] Live UI verification via Playwright MCP at 390×844 + 1440×900: zero console errors, zero console warnings, all touched surfaces interacted with (Filters open/close, Theme toggle, tab switch).

## Screenshots
[REQUIRED — use the `pr-screenshots-via-user-attachments` skill to produce `user-attachments/assets/<uuid>` URLs from the Playwright MCP captures. One per viewport per touched surface: map at 390×844, map at 1440×900, Filters panel open at 390×844, theme toggle dark at 1440×900.]

## Spec
- docs/design/02-phases/phase-3-map-surface.md
- docs/design/01-spec/architecture.md (Persistent chrome, Light/dark mode)
- docs/design/01-spec/components.md (<ClusterPill>, <FilterSentence>, <FamilySilhouette>)
- docs/design/01-spec/voice-and-content.md (Lede contract, Freshness label state machine)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Dispatch the bot review.**

Per project CLAUDE.md PR workflow, bot review dispatches through the `julianken-bot` Agent subagent — never `gh pr review` from the main session. The bot applies the 12-rule anti-slop rubric and the R13 drift shadow rule.

- [ ] **Step 4: Verify CI green BEFORE queuing.**

Per memory `feedback_verify_checks_before_queue`: read the statusCheckRollup at the head SHA. The four required checks are `test`, `lint`, `build`, `e2e`. If the PR is BEHIND a recently merged commit on `main`, update branch (`gh pr update-branch`) and wait for CI to re-run before posting the queue comment.

```bash
gh pr checks <PR-number>
```

- [ ] **Step 5: After bot review approves and CI is fully green, post the Mergify queue comment.**

The comment body MUST be exactly `@Mergifyio queue` — no prose, no preamble. Mergify uses literal-string match.

```bash
gh pr comment <PR-number> --body "@Mergifyio queue"
```

Per project CLAUDE.md: NEVER use `gh pr merge` directly.

---

## Acceptance criteria

This plan is complete when ALL of the following are true (verifiable against Phase 3's acceptance criteria in [`docs/design/02-phases/phase-3-map-surface.md`](../design/02-phases/phase-3-map-surface.md)):

- [x] **Map renders both light and dark modes with correct token resolution.** Verified by Task 7 manual smoke (theme toggle flips `[data-theme]`; basemap reloads without FOUC; tokens resolve from Phase 1's `tokens.css` light/dark blocks).
- [x] **Cluster pills pass the new axe assertion** (`role="img"` + `aria-label="{count} sightings"`). Verified by `axe.spec.ts` `cluster pills resolve to role="img"` test (Task 8).
- [x] **FamilyLegend on mobile is collapsed on first load and after `localStorage.clear()`** (resolves analysis Theme 3 default-state issue). Verified by `family-legend.spec.ts` `renders collapsed by default on mobile view=map (after localStorage.clear)` (Task 8) and unit tests in Task 6.
- [x] **Lede displays the correct of 4 templates based on filter state; period clause drops on stale data.** Verified by `MapLede.test.tsx` (6 tests, Task 3).
- [x] **Filter trigger badge displays accurate count;** `<FilterSentence>` mounts and shows active narrative below lede. Verified by `App.test.tsx` `Filters badge count reflects active filters` and `MapSurface.test.tsx` `mounts <FilterSentence>` (Tasks 2, 4).
- [x] **Map basemap swap on theme toggle is smooth (no FOUC).** Verified by Task 7 manual smoke; mechanism inherited from Phase 1's `MapCanvas` `MutationObserver` + `setStyle` plumbing.
- [x] All existing tests pass; PR opens with the standard 5-section body, CI green; Mergify queues it. Verified by Task 9, 10.

## What this plan deliberately does NOT include

To stay scoped per the [Phase 3 doc](../design/02-phases/phase-3-map-surface.md):

- **Detail surface redesign.** That's [Phase 4](../design/02-phases/phase-4-detail-surface.md) — `<dialog>` modal + bottom sheet snap points + `<Photo>` mounting.
- **Feed and species surface redesigns.** That's [Phase 5](../design/02-phases/phase-5-feed-species.md) — top-notable card-row, hero `<SpeciesAutocomplete>`, results lists.
- **Voice / metadata pass.** That's [Phase 6](../design/02-phases/phase-6-metadata-voice.md) — `<title>` / `<meta>` rewrites, freshness state machine wiring (the freshness props in this plan are placeholders), the existing `App.tsx:147` raw `error.message` rewrite, the deletion of the `<footer>` and `<AttributionModal>` legacy mount.
- **Cluster-manifest keyboard sidebar.** Deferred to v1.1.
- **Geolocation "near me" default.** Deferred to v1.1.
- **A real dark basemap tile URL.** Gated on G7 (family palette × basemap contrast) and G8 (dark basemap palette ratification) prototype gates — `BASEMAP_DARK` aliases `BASEMAP_LIGHT` until those close.
- **`<SurfaceNav>` deletion.** The component is no longer mounted by `<App>` post-Phase-3, but the file is preserved (with a knip ignore rule if needed) so the deletion can be a clean follow-up sweep PR — keeps Phase 3's diff focused on the surface redesign.

If during implementation you find yourself touching any of those surfaces, stop and confirm — that work belongs in a later phase's plan, not here.
