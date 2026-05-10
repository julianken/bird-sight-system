# Iteration: Loading & Error State Visual Inventory

## Assignment

Fill the loading-and-error-state visual gap identified in Phase 1 (Area 3): of 31 captured screenshots, zero show a loading or error state, yet 8+ distinct loading/error/empty branches exist in code. Capture or precisely describe every non-loaded state so the redesign brief is not blind to this major UX surface.

Sources: phase-1-packet.md §§ "Loading & error states have zero captures" (High-leverage gaps), "Content × Loading states" (Cross-cuts), Area 3 (UX flows / friction), Area 4 (voice register).

---

## Capture methodology

The dev server (`http://localhost:5173`) runs against prod (`VITE_API_BASE_URL=https://api.bird-maps.com`). The prod API responds in <300ms, so most loading states are invisible in normal use. Two techniques were used:

1. **Playwright fetch-interception**: patch `window.fetch` inside the live JS context and trigger a React state re-render via `history.replaceState` + `dispatchEvent(new PopStateEvent('popstate'))` without a full navigation. This preserves the patched fetch across the state change. Used for: feed loading, detail loading.
2. **DOM injection**: for states that cannot be triggered without a full React re-mount (app-level error, map skeleton, feed empty with specific hint copy, attribution modal states, species surface states), the React-rendered HTML was replaced with the code-accurate DOM at the class level, then screenshotted. All injected HTML matches the exact JSX output of the relevant code branch.

States marked **[DOM injection]** are pixel-accurate for class application and CSS rendering but do not include live React event handlers. States marked **[live]** were captured from actual React state.

---

## State coverage table

### App.tsx — App-level states

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Loaded | Normal | phase-1 `01-map-default.png` | live |
| Loading (initial) | `loading=true` before first fetch resolves | Not captured — state resolves in <100ms on prod, invisible | n/a |
| Error screen | `error !== null` in `useBirdData` | `states/desktop/app-error-screen.png`, `states/mobile/app-error-screen.png` | DOM injection |

### FeedSurface — `frontend/src/components/FeedSurface.tsx`

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Loaded (observations) | `!loading && observations.length > 0` | phase-1 `02-feed.png` | live |
| Loading | `loading=true` (filter refetch) | `states/desktop/feed-loading.png`, `states/mobile/feed-loading.png` | live (fetch-interception) |
| Empty — notable filter | `notable=true`, `observations.length=0` (FeedSurface.tsx:103–104) | `states/desktop/feed-empty-notable-1d.png`, `states/mobile/feed-empty-notable-1d.png` | DOM injection |
| Empty — 1d filter | `since='1d'`, `observations.length=0` (FeedSurface.tsx:105–106) | shares same class; copy differs only by hint string | DOM injection (same visual) |
| Empty — generic | `observations.length=0`, neither of above (FeedSurface.tsx:107–108) | shares same class; copy "No observations to show." | code-described (same CSS) |

### MapSurface — `frontend/src/components/MapSurface.tsx`

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Loaded | MapCanvas hydrated | phase-1 `01-map-default.png` | live |
| Loading skeleton | `React.Suspense` fallback while `MapCanvas` lazy-loads (MapSurface.tsx:147–165) | `states/desktop/map-loading-skeleton.png`, `states/mobile/map-loading-skeleton.png` | DOM injection |

### SpeciesSearchSurface — `frontend/src/components/SpeciesSearchSurface.tsx`

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Empty — no selection | `speciesCode === null` (prompt copy only) | `states/desktop/species-empty-no-selection.png` (also phase-1 `03-species-search.png`) | live |
| Loading — species selected | `speciesCode !== null && loading` (SpeciesSearchSurface.tsx:58–62) | `states/desktop/species-loading-observations.png` | DOM injection |
| Empty — no obs | `speciesCode !== null && !loading && filtered.length === 0` (SpeciesSearchSurface.tsx:64–68) | `states/desktop/species-empty-no-obs.png` | DOM injection |
| Loaded — obs list | `speciesCode !== null && !loading && filtered.length > 0` | phase-1 `04-species-detail.png` | live |

### SpeciesDetailSurface — `frontend/src/components/SpeciesDetailSurface.tsx`

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Loading | `loading=true` in `useSpeciesDetail` (SpeciesDetailSurface.tsx:199–203) | `states/desktop/detail-loading.png`, `states/mobile/detail-loading.png` | live (fetch-interception) |
| Error | `error !== null` (SpeciesDetailSurface.tsx:205–209) | `states/desktop/detail-error.png`, `states/mobile/detail-error.png` | live (`?detail=ZZZINVALID` → API 404) |
| Loaded | `data !== null` | phase-1 `04-species-detail.png` | live |

### AttributionModal — `frontend/src/components/AttributionModal.tsx`

| State | Trigger | Capture | Method |
|-------|---------|---------|--------|
| Silhouettes loading | `loading=true` in `useSilhouettes` (AttributionModal.tsx:336–339) | `states/desktop/attribution-modal-silhouettes-loading.png` | DOM injection inside live modal |
| Silhouettes error | `error !== null` (AttributionModal.tsx:332–335) | `states/desktop/attribution-modal-silhouettes-error.png` | DOM injection inside live modal |
| Silhouettes empty | `phylopicRows.length === 0` (AttributionModal.tsx:340–343) | Not captured — same CSS as loading/error; copy "No silhouette attributions available." | code-described |
| Loaded | `phylopicRows.length > 0` | phase-1 `05-attribution-modal.png` | live |

---

## Finding 1: All non-loaded states share a single visual register — muted body text on page background

**Evidence (code + CSS):**

Every non-error state uses one of two CSS classes:

- `.feed-empty` (styles.css:268–275): `padding: 24px; text-align: center; color: var(--color-text-muted) = #555; font-size: 14px; max-width: 480px; margin-inline: auto`
- `.species-search-empty` (styles.css:354–360): `padding: 24px 16px; text-align: center; color: var(--color-text-muted); font-size: 14px; margin: 0`
- `.species-detail-loading` (styles.css:457): `color: var(--color-text-muted); font-size: 13px; margin: 8px 0 0 0`
- `.attribution-modal-loading/.attribution-modal-empty` (styles.css:696–701): `font-style: italic; color: var(--color-text-muted)`

None of these classes include: an icon, an animation, a spinner, a progress indicator, or any visual differentiation between "loading" and "empty." From a purely visual standpoint, a `.feed-empty` and a `.species-detail-loading` look nearly identical — both are small centered text in `#555` on the warm cream `#f4f1ea` background. The only distinction is font-style (italic on modal states) and margin context.

**Confidence:** High — CSS read directly from styles.css, confirmed by screenshot comparison.

**Significance for redesign:** The redesign can introduce visual hierarchy between three semantically distinct states (loading / empty / error) that currently look the same. Currently a user cannot tell from visual appearance alone whether the app is working (loading) or finished (empty). This is a Tier-1 UX gap.

---

## Finding 2: Error states use a distinct visual treatment but only for detail-level errors — not for global errors

**Evidence:**

- `.species-detail-error` (styles.css:519–527): `background: var(--color-error-bg) = #fdecec; border: 1px solid var(--color-error-border) = #d48e8e; border-radius: 4px; color: var(--color-error-text) = #8a1f1f; font-size: 13px` — visually distinguished: red tint, border, dark red text.
- `.error-screen` (styles.css:88–92): `padding: 32px; max-width: 500px; margin: 0 auto` — NO background color, NO border, NO color override. Renders as unstyled `<h2>` + `<p>` on the page background. No visual treatment distinguishes the app-level error from any other content area.

App-level error screen (`App.tsx:143–150`): the `<h2>Couldn't load bird data</h2>` inherits `color: var(--color-text-strong) = #1a1a1a` and the `<p>{error.message}</p>` inherits `color: var(--color-text-strong)`. The raw `error.message` string is passed directly (App.tsx:147) — voice inconsistency flagged in phase-1 Area 4. A network error message string will be raw browser/OS text ("Network offline (simulated)", "Failed to fetch") rather than the crafted copy used everywhere else.

**Confidence:** High — CSS and JSX read directly; app-level error confirmed by DOM injection screenshot.

**Significance for redesign:** Two error levels (component-level detail error vs. app-level error screen) have completely different visual treatments. The component-level error has the codebase's only error-specific token usage (`--color-error-*`). The app-level error — more severe — has no error styling at all. This inversion is a design debt to address.

---

## Finding 3: Map loading skeleton is entirely unstyled plain text on page background — no shape, no animation

**Evidence (MapSurface.tsx:148–165):**

```
<div
  className="map-loading-skeleton"
  role="status"
  aria-live="polite"
  style={{
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f4f1ea',
  }}
>
  Loading map…
</div>
```

The styles are inline (not in styles.css — there is no `.map-loading-skeleton` rule in styles.css). Background `#f4f1ea` = `var(--color-bg-page)` (the warm cream), so the loading state is indistinguishable from an empty div. The text "Loading map…" sits centered in the full `#main-surface` height (viewport height minus FiltersBar + SurfaceNav + footer ≈ 730px desktop / 635px mobile) in the default body font color `#1a1a1a`. Screenshots `states/desktop/map-loading-skeleton.png` and `states/mobile/map-loading-skeleton.png` confirm.

No skeleton shape, no shimmer animation, no progress ring — the 730px canvas area is blank cream with centered text.

**Confidence:** High — code + CSS verified; screenshots captured.

**Significance for redesign:** The map skeleton is the largest empty state in the app by pixel area. It fills essentially the entire viewport. A redesign that introduces skeleton shapes (e.g., a map placeholder silhouette, a shimmer overlay) would have maximum visual impact here. The `duration.*` tokens (`tokens.ts:115–122`) are reserved but unused everywhere including here.

---

## Finding 4: Loading state copy register is consistent with loaded-state voice but has no feedback on progress

**Voice inventory of all loading/error/empty strings:**

| Component | State | Exact copy | File:line |
|-----------|-------|-----------|-----------|
| FeedSurface | loading | "Loading observations…" | FeedSurface.tsx:96 |
| FeedSurface | empty-notable | "No notable sightings in this window. Try widening the time window or turning off Notable only." | FeedSurface.tsx:104 |
| FeedSurface | empty-1d | "No observations reported today. Try expanding the time window." | FeedSurface.tsx:106 |
| FeedSurface | empty-generic | "No observations to show." | FeedSurface.tsx:108 |
| SpeciesSearchSurface | empty-no-selection | "Start typing a species name to explore its recent sightings." | SpeciesSearchSurface.tsx:52–54 |
| SpeciesSearchSurface | loading | "Loading observations…" | SpeciesSearchSurface.tsx:59–61 |
| SpeciesSearchSurface | empty-no-obs | "No recent sightings for this species in the current window." | SpeciesSearchSurface.tsx:65–67 |
| SpeciesDetailSurface | loading | "Loading species details…" | SpeciesDetailSurface.tsx:200 |
| SpeciesDetailSurface | error | "Could not load species details" | SpeciesDetailSurface.tsx:207 |
| App | error | "Couldn't load bird data" + raw `error.message` | App.tsx:146–148 |
| AttributionModal | loading | "Loading silhouette attributions…" | AttributionModal.tsx:337 |
| AttributionModal | error | "Couldn't load silhouette attributions — try again later." | AttributionModal.tsx:333 |
| AttributionModal | empty | "No silhouette attributions available." | AttributionModal.tsx:341 |
| MapSurface | skeleton | "Loading map…" | MapSurface.tsx:162 |

**Register analysis:** All crafted strings are in plain, declarative, direct register — no exclamation marks, no hedging, no apology language. Empty states with actionable filter context include a "try X" suggestion (FeedSurface notable, 1d). Error states at the component level avoid blame language ("Could not load" vs "Failed to load"). The one exception is the app-level error which surfaces `error.message` raw — a voice inconsistency identified in phase-1 Area 4.

**No loading state communicates progress** (e.g. "Fetching 344 observations…" or a percentage). All loading strings are static.

**Confidence:** High — all strings read from source files.

**Significance for redesign:** The copy register is coherent and calm — this is a baseline to preserve. A redesign that adds icons or animations must not push the visual register past the tonal ceiling the copy sets. The voice is "functional-reassuring," not "playful" — icons should match (e.g. neutral spinner rather than animated mascot).

---

## Finding 5: No loading state is shared — each surface reinvents its own pattern

**Evidence:**

There is no shared `<LoadingState>`, `<EmptyState>`, or `<ErrorBoundary>` component in the codebase:

```
find frontend/src/components -name "*.tsx" | xargs grep -l "loading\|empty\|error" 
→ FeedSurface.tsx, SpeciesSearchSurface.tsx, SpeciesDetailSurface.tsx, AttributionModal.tsx
```

Each surface independently renders its own loading/empty/error DOM. The CSS classes are unique per surface (`.feed-empty` vs `.species-search-empty` vs `.species-detail-loading`) with slightly different padding/font-size values. No shared primitive enforces consistent visual treatment.

**Confidence:** High — codebase search.

**Significance for redesign:** A design system that introduces a `<StatusMessage variant="loading|empty|error">` primitive would unify these 14 distinct copy+class pairs into a single reusable pattern. This is not a refactoring call — it is a design constraint: any new loading/empty/error visual must be compatible with inline rendering inside a narrow panel (detail surface), a full-width list (feed), a full-viewport canvas placeholder (map), and inside a `<dialog>` (attribution modal).

---

## Screenshot index

All screenshots relative to `tmp/redesign-analysis/screenshots/states/`:

| Filename | Viewport | State | Method |
|----------|----------|-------|--------|
| `desktop/app-error-screen.png` | 1440×900 | App.tsx error screen | DOM injection |
| `desktop/feed-loading.png` | 1440×900 | FeedSurface loading | live |
| `desktop/feed-empty-notable-1d.png` | 1440×900 | FeedSurface empty — notable filter | DOM injection |
| `desktop/map-loading-skeleton.png` | 1440×900 | MapSurface Suspense skeleton | DOM injection |
| `desktop/species-empty-no-selection.png` | 1440×900 | SpeciesSearchSurface — no selection | live |
| `desktop/species-loading-observations.png` | 1440×900 | SpeciesSearchSurface — loading | DOM injection |
| `desktop/species-empty-no-obs.png` | 1440×900 | SpeciesSearchSurface — no obs for species | DOM injection |
| `desktop/detail-loading.png` | 1440×900 | SpeciesDetailSurface loading | live |
| `desktop/detail-error.png` | 1440×900 | SpeciesDetailSurface error (404) | live |
| `desktop/attribution-modal-silhouettes-loading.png` | 1440×900 | AttributionModal silhouettes loading | DOM injection (live modal) |
| `desktop/attribution-modal-silhouettes-error.png` | 1440×900 | AttributionModal silhouettes error | DOM injection (live modal) |
| `mobile/app-error-screen.png` | 390×844 | App.tsx error screen | DOM injection |
| `mobile/feed-loading.png` | 390×844 | FeedSurface loading | live |
| `mobile/feed-empty-notable-1d.png` | 390×844 | FeedSurface empty — notable filter | DOM injection |
| `mobile/map-loading-skeleton.png` | 390×844 | MapSurface Suspense skeleton | DOM injection |
| `mobile/detail-loading.png` | 390×844 | SpeciesDetailSurface loading | live |
| `mobile/detail-error.png` | 390×844 | SpeciesDetailSurface error (404) | live |

---

## Summary of design constraints this surfaces

1. **No visual differentiation between loading and empty.** Both states render muted centered text. A designer adding skeleton shapes, spinners, or empty-state illustrations must choose a visual language that works across 5 different container shapes (full viewport, full-width list, narrow panel column, dialog section).

2. **Two error levels with inverted styling severity.** Component-level error (detail surface) has the codebase's only error-specific token usage (`--color-error-*`: red tint + border). App-level error has no error styling. The redesign should reconcile this inversion.

3. **Map skeleton is the highest-impact surface by area.** 730px desktop / 635px mobile of cream-on-cream text. Any skeleton visual (shimmer, shape placeholder, progress indicator) here has maximum viewport coverage.

4. **Duration tokens exist but are unused.** `tokens.ts:115–122` defines `duration.fast/base/slow` (200/250/350ms); `styles.css:16–18` declares `--dur-fast/base/slow`. Zero loading states use them. A redesign that adds CSS transitions or keyframe animations to loading states can reference these reserved tokens without adding new values.

5. **Voice register sets a tonal ceiling for visual design.** Copy is calm, direct, functional. Loading/error visual design should not exceed this register — no playful mascots, no dramatic illustrations, no alarm-red on component-level errors.
