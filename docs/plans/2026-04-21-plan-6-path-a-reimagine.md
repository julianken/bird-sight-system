# Frontend Reimagining — Path A (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SVG ecoregion map with three non-spatial surfaces — an observation feed, a species-search surface, and a hotspot list — toggled via a new `?view=` URL parameter. The casual-local-birder archetype is the release-1 default (§Open decisions). All five latent wire fields (`obsDt`, observation `lat`/`lng`, `locName`/`howMany`, row-level `isNotable`, `taxonOrder`/`familyCode`) ship in release 1. The `SpeciesPanel` becomes viewport-responsive: a right-docked 320px sidebar at desktop (>= 768px) and a right-anchored drawer at mobile (< 768px), with tap-outside dismiss, ESC preservation, and scroll-restoration on close. Plan 6 closes R2 (ingestor — tracked operationally) and R8 (gzip — Task 1) and internalises the `risk-viability.md` conditional-gos as task-level acceptance.

**Architecture:** Three non-spatial surfaces share one shell — `<FeedSurface>` (default), `<SpeciesSearchSurface>`, `<HotspotListSurface>` — each rendered inside `<main data-render-complete>` and selected by a `view` field in `UrlState`. A new `<SurfaceNav>` sits between `FiltersBar` and `<main>`. `FiltersBar` is KEEP-unchanged (`frontend/src/components/FiltersBar.tsx:20-101`). The existing `?since` / `?notable` / `?species` / `?family` URL contract is preserved byte-for-byte (`frontend/src/state/url-state.ts:23-47`); `?region=` is parsed-and-discarded for one release, with an optional migration banner. Latent-field placement: `obsDt` as relative-time in each `ObservationFeedRow`; `locName` + `howMany` inline on the row; row-level `isNotable` as a flag badge independent of the global `?notable=true` filter; `lat`/`lng` as formatted text on `<HotspotRow>`; `taxonOrder` + `familyCode` driving the feed's optional taxonomic sort with an explicit null-last policy. Readiness-gate becomes `data-render-complete="true"` on `<main>`, replacing `[data-region-id]` count=9. State management unchanged — plain React hooks, `useUrlState` + `useBirdData` + local component state for hotspot sort.

**Tech stack:** React 18, Vite, TypeScript, Vitest, React Testing Library, Playwright, native fetch, CSS (mobile-first with a 768px breakpoint). Same tech as plan 4; no new dependencies.

**Depends on:** Plan 3 (Read API) running; the existing `frontend/src/state/url-state.ts`, `api/client.ts`, `data/use-bird-data.ts`, `components/FiltersBar.tsx`, `components/SpeciesPanel.tsx` as KEEP/REFACTOR scaffolding (`docs/analyses/2026-04-20-frontend-map-analysis/phase-1/area-5-salvage-map.md`).

**Pre-plan decisions (required before Task 1):**

1. **Default archetype — casual local birder (feed-primary).** Rationale: `phase-1/area-3-user-task-fit.md` grades feed-primary strongest for T1/T7/T3, the dogfood tasks. Visiting-birder would force hotspot-primary (richer for tourism but weaker on T1/T7). Default `view='feed'`; refinement: `?species=` on cold load implies `view='species'` so bookmarked species URLs land on the search surface with the panel open (architecture §9 refinement).

2. **T6 — scoped out of release 1; accept T6=0, target honest 10/14.** `risk-viability.md` §T6-weakness: a sorted list is not a "glance"; a 9-bar species-per-region strip is a 3–4 hour task that adds no composability value. Task 14 files a release-2 tracking issue.

3. **Prototype gate — 2-hour Path A prototype between Task 5 and Task 7.** Path A dragons differ from Plan 4's SVG dragons (filter-flip latency, scroll-restore, autocomplete overflow, empty-state legibility). Budget 2 hours; output a preview URL and a 5-line learnings note that tightens Task 7 acceptance criteria.

**Release-1 blocking operational items:**

- **Ingestor stall fix (R2)** — tracked operationally (sequencing.md Issue 12). Must be green before Task 7 ships so the feed does not render an empty-looking state that reads as "site broken." Not a task in this plan.
- **API gzip middleware (O6 / R8)** — Task 1 below.

---

### Task 1: Enable gzip compression on the Read API

**Files:**
- Modify: `services/read-api/src/app.ts`
- Modify: `services/read-api/src/app.test.ts`

- [ ] **Step 1: Failing test.** Add a case to `app.test.ts` asserting that `GET /api/observations?since=14d` with `accept-encoding: gzip` returns `content-encoding: gzip`. Use `app.request()` with a plain `Request`. Run; confirm FAIL.

- [ ] **Step 2: Wire the middleware.** Import `compress` from `hono/compress`. Register `app.use('*', compress())` at the top of the middleware chain in `services/read-api/src/app.ts`, before any routes. No route/response-shape changes. Run the test; PASS.

- [ ] **Step 3: No-drift check.** `npm test --workspace @bird-watch/read-api` (full suite) and `npm run build --workspace @bird-watch/read-api` both green.

- [ ] **Step 4 (final): Commit.**

```
feat(read-api): enable gzip compression middleware

Adds Hono compress() for all responses. Unblocks Path A mobile
viability at healthy ingest volume — closes R8 from the
path-a-assessment risk register.
```

**Acceptance:** `content-encoding: gzip` on `/api/observations`; all existing read-api tests green; build clean.

---

### Task 2: Refactor `state/url-state.ts` — drop `regionId`, add `view`

**Files:**
- Modify: `frontend/src/state/url-state.ts`
- Modify: `frontend/src/state/url-state.test.ts`

Drops `regionId` from `UrlState` (`url-state.ts:6`, `:27`, `:37`). Adds `view: 'feed' | 'species' | 'hotspots'` with default `'feed'`. `?region=` is still parsed by `readUrl()` but not stored on the state object and never re-written by `writeUrl()` — graceful no-op.

- [ ] **Step 1: Update tests first.** Replace every `regionId` assertion in `url-state.test.ts` with `view` coverage. Add four new cases: defaults include `view: 'feed'`; parsing `?view=hotspots` returns `view: 'hotspots'`; cold-load with `?species=vermfly` and no `?view=` returns `view: 'species'` (the sniff from architecture §9); parsing `?region=sky-islands-huachucas&view=feed` returns `view: 'feed'` and no `regionId` anywhere on state. Run; FAIL.

- [ ] **Step 2: Implement.**
  - Remove `regionId` from `UrlState` and `DEFAULTS`.
  - Add `view` to `UrlState`, default `'feed'`, with a `VALID_VIEW` set.
  - In `readUrl()`: parse `p.get('view')`; if absent and `p.get('species')` is set, return `view: 'species'`. Still call `p.get('region')` but do not store — keeps the call available for the migration-banner side-channel.
  - In `writeUrl()`: if `state.view !== 'feed'`, `p.set('view', state.view)`. Never write `region`.
  - Export `readMigrationFlag(): boolean` returning `new URLSearchParams(window.location.search).has('region')` — used only by Task 4.

- [ ] **Step 3: Typecheck will fail against `App.tsx:82,84` that still references `state.regionId`.** Do NOT fix here — Task 5 removes those lines wholesale. Documented here so the implementer does not branch.

- [ ] **Step 4 (final): Commit.**

```
refactor(frontend): drop regionId from UrlState, add view param

Introduces ?view= surface-toggle (default 'feed') and removes the
now-unused regionId field. ?region= is parsed for migration
detection (Task 4) but not stored or rewritten.

Typecheck red until the App.tsx deletion wave (Task 5).
```

**Acceptance:** 4 new tests pass; `UrlState` has no `regionId`; `?region=` is read-only; `?view=` round-trips.

---

### Task 3: Introduce `<SurfaceNav>` tab component

**Files:**
- Create: `frontend/src/components/SurfaceNav.tsx`
- Create: `frontend/src/components/SurfaceNav.test.tsx`

Tab-style toggle — `role="tablist"` with three `role="tab"` buttons, each with `aria-selected` reflecting `activeView === tabValue` and `aria-controls="main-surface"`. Click sets `view`; Enter/Space activate; Arrow Left/Right migrate focus and activate the adjacent tab per the WAI-ARIA tablist pattern.

- [ ] **Step 1: Failing tests.** Three cases: renders three tabs named "Feed", "Species", "Hotspots" with the active tab marked `aria-selected="true"`; clicking a non-active tab fires `onSelectView`; ArrowRight on the active tab moves focus AND fires `onSelectView` with the next value. Run; FAIL.

- [ ] **Step 2: Implement.**

```tsx
export interface SurfaceNavProps {
  activeView: 'feed' | 'species' | 'hotspots';
  onSelectView: (view: 'feed' | 'species' | 'hotspots') => void;
}
```

Render a `<div role="tablist" aria-label="Surface">` containing three `<button role="tab" aria-controls="main-surface">` elements. Use a `useRef` array to handle ArrowLeft/ArrowRight focus migration.

- [ ] **Step 3: Tests green; commit.**

```
feat(frontend): SurfaceNav tab component for view toggle

Accessible three-tab control driving the ?view= URL param.
Keyboard-arrow navigation + aria-selected per WAI-ARIA tablist.
```

**Acceptance:** 3 tests green; keyboard arrows cycle; `aria-selected` tracks `activeView`.

---

### Task 4: `?region=` graceful-degradation banner

**Files:**
- Create: `frontend/src/components/MigrationBanner.tsx`
- Create: `frontend/src/components/MigrationBanner.test.tsx`

Soft warning for bookmarks matching `?region=*`. Architecture §9 permits silent discard; sequencing.md Issue 9 requests the banner to close R5. ~40 LOC total.

- [ ] **Step 1: Failing tests.** Four cases: `readMigrationFlag() === true` renders a banner; `false` renders null; dismiss click hides the banner; dismiss calls `window.history.replaceState` with a URL lacking `?region=` (spy on `replaceState`). Run; FAIL.

- [ ] **Step 2: Implement.** `useState` holds the visible flag, initialised from `readMigrationFlag()` on mount. Render a `role="status"` div with the copy "The region view has been replaced. Use the Filters bar to filter by family or species." Close button (aria-label "Dismiss migration notice") hides the banner and calls `replaceState` on a rebuilt URL with `region` deleted.

- [ ] **Step 3: Sunset note.** Add a code-comment at top of `MigrationBanner.tsx`: "Release 2: remove this component and `readMigrationFlag` after `?region=` traffic ages out." Linked from §Deferred to release 2.

- [ ] **Step 4 (final): Commit.**

```
feat(frontend): ?region= migration banner for bookmark grace

Parses ?region= on cold load and shows a one-time dismissible
banner. Rewrites the URL on dismiss so refreshes do not re-show.
Closes R5.
```

**Acceptance:** 4 tests green; banner appears only when `?region=` is present; dismiss persists within session.

---

### Task 5: Delete the map rendering chain — DISCARD wave

**Files:**
- Delete: `frontend/src/components/Map.tsx` (+ `Map.test.tsx`)
- Delete: `frontend/src/components/Region.tsx` (+ `Region.test.tsx`)
- Delete: `frontend/src/components/Badge.tsx` (+ `Badge.test.tsx`)
- Delete: `frontend/src/components/BadgeStack.tsx` (+ `BadgeStack.test.tsx`)
- Delete: `frontend/src/components/HotspotDot.tsx` (+ `HotspotDot.test.tsx`)
- Delete: `frontend/src/geo/path.ts` (+ `path.test.ts`)
- Delete: `frontend/e2e/badge-containment.spec.ts`, `cross-region-badge-containment.spec.ts`, `expand-cap.spec.ts`, `paint-order.spec.ts`, `sizing.spec.ts`, `stroke-scaling.spec.ts`, `region-collapse.spec.ts`, `happy-path.spec.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/data/use-bird-data.ts` (+ `use-bird-data.test.tsx`)
- Modify: `frontend/src/styles.css`

Highest-risk single PR in the plan. The seam is clean at `App.tsx:77-89`; rollback is `git revert`.

- [ ] **Step 1: Delete production files + unit tests.** All 14 delete targets above.

- [ ] **Step 2: Rewrite `App.tsx`.**
  - Delete lines 13-43 (`GENERIC_SILHOUETTE`, `silhouetteFor`, `colorFor`, COUPLING NOTE). Delete imports for `Map`, `colorForFamily`.
  - Delete lines 77-89 (the `<div className="map-wrap">` block).
  - Replace with:

```tsx
<SurfaceNav activeView={state.view} onSelectView={view => set({ view })} />
<main id="main-surface" data-render-complete={!loading && observations !== null ? 'true' : 'false'} aria-busy={loading}>
  {/* Feed/Species/Hotspots surfaces land in Tasks 7-9 */}
</main>
<MigrationBanner />
```

  - `SpeciesPanel` JSX stays (Task 11 refactors the CSS). Error-screen copy (`App.tsx:59-64`): "Couldn't load map data" → "Couldn't load bird data".

- [ ] **Step 3: Trim `use-bird-data.ts`.** Remove `regions: Region[]` from `BirdDataState`. Remove `client.getRegions()` from the `Promise.all` — first effect becomes `client.getHotspots().then(...)`. Update tests to drop the regions assertion and mock. `Region` type stays in shared-types (schema back-compat, zero cost).

- [ ] **Step 4: Prune `styles.css`.** Delete lines 9-53 (`.region`, `.region-expanded`, `vector-effect`, `.badge`, `.badge-selected`, `.badge-label` + comments) and lines 60-75 (`.map-wrap`, `.bird-map`). Keep globals, `.app`, `.error-screen`, `.filters-bar`, `.species-panel*`. Net reduction ~60 LOC. Add scaffold:

```css
.surface-nav { display: flex; gap: 4px; padding: 8px 16px; background: #fff; border-bottom: 1px solid #d8d3c3; }
main { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
```

- [ ] **Step 5: Sanity.** `npm run typecheck && npm test --workspace @bird-watch/frontend` green; dev-server smoke (`npm run dev`) confirms no crash, FiltersBar renders, SpeciesPanel opens on `?species=vermfly`. E2E is red — Task 12 fixes.

- [ ] **Step 6 (final): Commit.**

```
refactor(frontend): delete map rendering chain (DISCARD wave)

Removes ~1,300 prod LOC + ~1,100 test LOC per Phase-1 salvage.
App.tsx renders a three-surface shell behind SurfaceNav; styles
drop ~60 LOC of SVG rules. use-bird-data no longer fetches regions
(Region type retained in shared-types for schema back-compat).

E2E red until Task 12 updates the readiness gate. Unit tests green.
```

**Acceptance:** Deletions landed; typecheck clean; unit tests green; dev smoke passes; SpeciesPanel still openable via `?species=`.

---

### Task 6: Prototype gate (throwaway branch)

**Files (throwaway branch only):**
- Create: `frontend/src/prototype/PrototypeFeed.tsx`
- Create: `frontend/src/prototype/observations-344.json`
- Create: `docs/plans/2026-04-21-path-a-assessment/prototype-notes.md`

Gate, not merge target. Branch off `main`, validate, delete. Budget 2 hours.

- [ ] **Step 1: `git checkout -b prototype/path-a-feed` off main.** Do not push.

- [ ] **Step 2: Canned fixture.** Save `GET /api/observations?since=14d` as `observations-344.json`. Optionally upsample to 2000 rows via `Array.from({length: 2000}, (_, i) => data[i % 344])` for stress runs.

- [ ] **Step 3: Minimal `PrototypeFeed`.** ~80 LOC rendering all rows with species/family/obsDt/locName/howMany/isNotable. No routing or API wiring — just `import data from './observations-344.json'`.

- [ ] **Step 4: Exercise at production dimensions.** Dev-server run at 390×844, 768×1024, 1440×900. Tap rows on mobile, open a mock panel, swap to 2000-row fixture to measure filter-flip re-render latency. Target: cold render < 1s mid-tier phone; filter flip < 200ms at 2000 rows with `React.memo`.

- [ ] **Step 5: 5-line learnings note.** Write `docs/plans/2026-04-21-path-a-assessment/prototype-notes.md`:
  - Row density that works at 390px (single-line vs two-line).
  - Whether `React.memo` is sufficient for filter-flip.
  - Mobile drawer slide direction (right vs bottom).
  - Scroll-restore-on-close observations.
  - One dragon you would not have anticipated.

- [ ] **Step 6: Feed learnings back.** Update Task 7 Step 2 and/or Task 11 Step 3 acceptance criteria with concrete numbers or gotchas.

- [ ] **Step 7 (final): Commit on the throwaway branch (not main).**

```
chore(prototype): Path A feed prototype — learnings capture

Throwaway branch. Validates row density, filter-flip latency at 2k
rows, mobile drawer direction. Learnings captured in
prototype-notes.md for Tasks 7 + 11.
```

**Acceptance:** `prototype-notes.md` exists with the 5 bullets; at least one concrete update lands in Task 7 or Task 11 acceptance; the throwaway branch is not pushed or merged.

---

### Task 7: Build `<FeedSurface>` + `<ObservationFeedRow>` + `format-time`

**Files:**
- Create: `frontend/src/utils/format-time.ts` (+ `format-time.test.ts`)
- Create: `frontend/src/components/ObservationFeedRow.tsx` (+ `ObservationFeedRow.test.tsx`)
- Create: `frontend/src/components/FeedSurface.tsx` (+ `FeedSurface.test.tsx`)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

Ships four of five latent fields: `obsDt`, `locName`, `howMany`, row-level `isNotable`. The casual-local-birder archetype means this is the default surface.

- [ ] **Step 1: `format-time.ts`.** Pure function `formatRelativeTime(iso: string, now: Date = new Date()): string`. Buckets: "just now" (<60s), "N min ago" (<60m), "Nh ago" (<24h), "yesterday" (24–48h), "Mon 3pm" (<7d), "Apr 14" (<1y), "2023-11-03" (>1y). Hand-rolled — no `Intl.RelativeTimeFormat`. 7 pinpoint tests pinning each bucket.

- [ ] **Step 2: `ObservationFeedRow` tests (failing).** Five cases:
  1. Renders `comName`, `formatRelativeTime(obsDt)`, and `locName` inline.
  2. `×3` count when `howMany === 3`; no count indicator when `howMany === 1`; `—` (not 0, not blank) when `howMany === null`.
  3. Notable badge (role="img", aria-label="Notable sighting") when `isNotable === true`; omitted otherwise. Badge appears **even when** global `?notable=true` filter is active.
  4. Row is keyboard-focusable (`tabIndex={0}`), `role="button"`, fires `onSelectSpecies(speciesCode)` on click and Enter.
  5. `locName === null` renders the row without the location text (eBird edge case).

- [ ] **Step 3: Implement `ObservationFeedRow`.** Props per architecture §3:

```tsx
export interface ObservationFeedRowProps {
  observation: Observation;
  onSelectSpecies: (code: string) => void;
}
```

Wrap the row in `React.memo` (shallow equality is sufficient because `observation` is a stable reference from the array). DOM column order: notable badge → `comName` → count chip (if > 1) → `locName` (if non-null) → relative time. One `aria-label` on the row element combines all.

- [ ] **Step 4: Implement `FeedSurface`.** Props:

```tsx
export interface FeedSurfaceProps {
  observations: Observation[];
  onSelectSpecies: (code: string) => void;
  sortMode: 'chrono' | 'taxonomic';
}
```

`sortMode === 'taxonomic'` is a stub for Task 10 — the prop exists but the `'taxonomic'` branch currently preserves server order (server already sends `obsDt DESC`). Render `<ol className="feed" aria-label="Observations">` with the mapped rows. Empty state MUST be distinct from error screen — check `observations.length === 0` and render filter-aware guidance:

```tsx
<p className="feed-empty" role="status">
  No observations match these filters.
  {notable && ' Try turning off "Notable only".'}
  {since === '1d' && ' Try widening the time window.'}
</p>
```

This distinguishes "no matches" from "site broken" (risk-viability.md Part 5).

- [ ] **Step 5: Wire into `App.tsx`.**

```tsx
{state.view === 'feed' && (
  <FeedSurface
    observations={observations}
    onSelectSpecies={code => set({ speciesCode: code })}
    sortMode="chrono"
  />
)}
```

- [ ] **Step 6: CSS.**

```css
.feed { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.feed-row { display: flex; align-items: baseline; gap: 8px; padding: 12px 16px; background: #fff; border-radius: 4px; cursor: pointer; min-height: 44px; }
.feed-row:hover, .feed-row:focus-visible { background: #f0ebe0; outline: 2px solid #1a1a1a; outline-offset: -2px; }
.feed-row-notable { background: #fff8e6; border-left: 3px solid #d4a017; }
.feed-row-name { font-weight: 600; }
.feed-row-time { color: #555; font-size: 13px; margin-left: auto; }
.feed-empty { padding: 32px 16px; text-align: center; color: #555; }
```

44px min-height honours the iOS HIG tap target (risk-viability.md Part 2).

- [ ] **Step 7 (final): Commit.**

```
feat(frontend): FeedSurface with obsDt, locName, howMany, row-level isNotable

Ships 4 of 5 latent fields. Rows keyboard-focusable; clicking fires
onSelectSpecies which opens SpeciesPanel via the existing ?species=
URL contract. Empty state has filter-aware hints to distinguish
"no matches" from "site broken." Row component React.memo'd;
prototype confirmed no virtualisation needed at 2k rows. 44px tap
targets.
```

**Acceptance:** All four fields visible per row; row-level notable badge independent of global filter; empty state contextual hint; feed cold-render under 1s at 2000 rows (per prototype).

---

### Task 8: Build `<HotspotListSurface>` + `<HotspotRow>` + `<HotspotSortControls>`

**Files:**
- Create: `frontend/src/utils/format-coords.ts` (+ `format-coords.test.ts`)
- Create: `frontend/src/components/HotspotRow.tsx` (+ `HotspotRow.test.tsx`)
- Create: `frontend/src/components/HotspotSortControls.tsx` (+ `HotspotSortControls.test.tsx`)
- Create: `frontend/src/components/HotspotListSurface.tsx` (+ `HotspotListSurface.test.tsx`)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

Serves T5 (where to go) and T6-partial. Surfaces `lat`/`lng` as formatted text — this is where the latent lat/lng integration lands, via `Hotspot` rather than `Observation` (shared-types/src/index.ts:12-13).

- [ ] **Step 1: `format-coords.ts`.** `formatCoords(lat: number, lng: number): string` → "31.51°N, 110.35°W". Four hemisphere tests.

- [ ] **Step 2: `HotspotSortControls` tests (failing).** Three sort options render; active option marked `aria-pressed="true"` (or `aria-current="true"`); clicking fires `onChange`. Three radio-like buttons; keyboard Space/Enter toggle.

- [ ] **Step 3: `HotspotRow` tests (failing).** Renders `locName`, `formatRelativeTime(latestObsDt)`, `numSpeciesAlltime` as "412 species", and `formatCoords(lat, lng)`.

- [ ] **Step 4: `HotspotListSurface` tests (failing).** Default sort is `latest` → `latestObsDt DESC`. Alternates: `richness-desc` → `numSpeciesAlltime DESC`; `richness-asc` → ASC. `latestObsDt === null` sorts last in all modes. Empty array renders empty-state copy.

- [ ] **Step 5: Implement.** `HotspotListSurface` holds sort mode in local `useState` (NOT URL-persisted per architecture §4 decision). Stale hotspots (`latestObsDt === null` or > 30 days) get `.hotspot-row-stale` class (faded color; still clickable).

- [ ] **Step 6: Wire into `App.tsx`.**

```tsx
{state.view === 'hotspots' && <HotspotListSurface hotspots={hotspots} />}
```

- [ ] **Step 7: CSS.** Parallel structure to `.feed`/`.feed-row`: `.hotspot-list`, `.hotspot-row`, `.hotspot-row-stale`, `.hotspot-sort`. 44px min-height.

- [ ] **Step 8 (final): Commit.**

```
feat(frontend): HotspotListSurface with lat/lng + freshness + richness sort

Ships hotspot lat/lng as formatted text, per-row latestObsDt
relative time, numSpeciesAlltime, and a three-way sort
(freshness default / richness desc / richness asc). Sort is local
state only — URL persistence deferred to release 2.
```

**Acceptance:** Three sort modes observable; lat/lng in correct hemisphere format; stale hotspots de-emphasised; empty-state copy.

---

### Task 9: Build `<SpeciesSearchSurface>` + `<SpeciesAutocomplete>`

**Files:**
- Create: `frontend/src/components/SpeciesAutocomplete.tsx` (+ test)
- Create: `frontend/src/components/SpeciesSearchSurface.tsx` (+ test)
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

Serves T3 and T4 partial. Architecture §2.2: this autocomplete is **navigation**, not **filter**. It sets `?species=` to open `SpeciesPanel` but does not narrow the observation set the way `FiltersBar`'s species input does. Both coexist.

- [ ] **Step 1: `SpeciesAutocomplete` tests (failing).** Typing 2+ chars filters options (case-insensitive substring); ArrowDown moves focus into the option list; Enter on a focused option fires `onSelectSpecies(code)`; ESC clears the query; dropdown positions **above** the input when the input's `bottom > window.innerHeight / 2` (prototype learning — bottom-of-viewport overflow).

- [ ] **Step 2: `SpeciesSearchSurface` tests (failing).** When `speciesCode === null`, renders the autocomplete with a placeholder prompt and no results list. When `speciesCode` is set, renders a "Recent sightings for this species" list by filtering `observations` client-side to that species (reuses `ObservationFeedRow`). The autocomplete stays visible so the user can switch species.

- [ ] **Step 3: Implement.** Autocomplete data source is `deriveSpeciesIndex(observations)` plus the Task 10 enhancements. For this task, plain substring match on `comName` is sufficient. Positioning: `getBoundingClientRect()` on the input ref; set `data-position="above"` when the input is below viewport midline. Pure CSS placement from there; no portal needed.

- [ ] **Step 4: Wire into `App.tsx`.**

```tsx
{state.view === 'species' && (
  <SpeciesSearchSurface
    speciesIndex={speciesIndex}
    observations={observations}
    speciesCode={state.speciesCode}
    onSelectSpecies={code => set({ speciesCode: code })}
  />
)}
```

- [ ] **Step 5: CSS.** Dropdown is `position: absolute` relative to the input wrapper; `data-position="above"` flips `bottom: 100%` vs `top: 100%`.

- [ ] **Step 6 (final): Commit.**

```
feat(frontend): SpeciesSearchSurface — species-first navigation surface

Dedicated autocomplete separate from FiltersBar species input
(navigation vs filter — different semantics). Selecting a species
sets ?species= and opens SpeciesPanel. Dropdown flips above the
input when positioned below viewport midline.
```

**Acceptance:** Autocomplete substring-matches; selection opens SpeciesPanel; dropdown avoids viewport overflow; recent-sightings list renders when species is selected.

---

### Task 10: Integrate `taxonOrder` / `familyCode` — the fifth latent field

**Files:**
- Modify: `frontend/src/derived.ts` (+ test)
- Modify: `frontend/src/components/FeedSurface.tsx` (+ test)
- Modify: `frontend/src/components/SpeciesAutocomplete.tsx` (+ test)

The fifth latent field; binding pre-plan decision is 5-of-5. `taxonOrder` lives on `SpeciesMeta`, NOT `Observation` (`shared-types/src/index.ts:40`). Taxonomic feed sort therefore requires a lookup via `speciesIndex`; species without `taxonOrder` sort last (documented null policy).

- [ ] **Step 1: Enrich `deriveSpeciesIndex`.** Current shape `{code, comName}`. Extend to `{code, comName, taxonOrder: number | null, familyCode: string | null}`. Source `familyCode` via the existing `observation.silhouetteId` coupling documented in `App.tsx:32-43`. `taxonOrder` is populated only when `useSpeciesDetail` has cached the species meta; otherwise `null` — the null-last policy. A follow-up ticket (see §Deferred to release 2) adds a stable `/api/species-index` endpoint for full cold-load taxonOrder.

- [ ] **Step 2: Feed sort toggle.** The `sortMode` prop stubbed in Task 7 drives behaviour:
  - `chrono` (default): preserve server order.
  - `taxonomic`: client-side sort by `speciesIndex[obs.speciesCode]?.taxonOrder ?? Infinity`. Null-taxonOrder rows land last.
  Render a `<div className="feed-sort">` toggle above the first row — two radio-buttons mirroring `HotspotSortControls`.

- [ ] **Step 3: Autocomplete grouping.** Group options by `familyCode` using `<optgroup label="...">` in the datalist (or, if rendering a custom dropdown, visual headers). Per-option: `comName` (bold) + family name (gray). Sort within group by `taxonOrder ?? comName.localeCompare`.

- [ ] **Step 4: Update tests.** `derived.test.ts` — three new cases pinning the enriched shape and null safety. `FeedSurface.test.tsx` — assert taxonomic sort respects null-last. `SpeciesAutocomplete.test.tsx` — optgroups present when speciesIndex has >1 family.

- [ ] **Step 5: Grep-verify all 5 latent fields.** Per H6 and risk-viability.md "latent-field adoption failure":

```
rg "observation\.obsDt|o\.obsDt|obs\.obsDt" frontend/src --type ts
rg "\.lat[^a-zA-Z]|\.lng[^a-zA-Z]" frontend/src --type ts
rg "locName|howMany" frontend/src --type ts
rg "isNotable" frontend/src --type ts
rg "taxonOrder|familyCode" frontend/src --type ts
```

Each MUST return at least one non-test source match. Paste output into the commit body. If any returns only test matches, that field is not rendered — fix before committing.

- [ ] **Step 6 (final): Commit.**

```
feat(frontend): integrate taxonOrder + familyCode — 5 of 5 latent fields

Completes the "all 5 latent fields in release 1" binding decision.
Feed sort toggles chrono/taxonomic; nulls sort last. Autocomplete
groups options by familyCode, ordered within group by taxonOrder.
Cold-load taxonOrder enrichment is partial because Observation
does not carry taxonOrder directly — tracked in §Deferred.

grep evidence:
<paste 5 grep outputs>
```

**Acceptance:** All 5 greps return non-test matches; taxonomic sort reorders rows; autocomplete shows family grouping.

---

### Task 11: Refactor `<SpeciesPanel>` — drawer at mobile, sidebar at desktop

**Files:**
- Modify: `frontend/src/components/SpeciesPanel.tsx` (+ test)
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/hooks/use-scroll-restore.ts` (+ test)
- Create: `frontend/src/hooks/use-media-query.ts` (+ test)

Binding pre-plan decision: REFACTOR-proper, overriding architecture doc §6's "one-line CSS tidy" recommendation. The doc's rationale ("`position: fixed` buys no reflow on close") is correct at desktop; wrong at mobile where a 320px fixed panel on a 390px viewport is 82% of the screen with no scroll restore (risk-viability.md Part 2).

- [ ] **Step 1: `useScrollRestore(active: boolean)`.** Captures `window.scrollY` when `active` transitions `false → true`; restores it when `true → false`. If the user scrolled while active (new scrollY differs materially from captured), preserve the user's position instead. Three tests: capture on open, restore on close, user-scroll-override preserved.

- [ ] **Step 2: `useMediaQuery(query: string): boolean`.** Matches via `window.matchMedia`, updates on resize. Two tests: matches on load, updates on media change.

- [ ] **Step 3: New SpeciesPanel tests.** ALL existing tests preserved — ESC close, close button, aria-labelledby, sr-only heading fallback. New cases:
  1. Viewport width `<= 767`: panel has `data-layout="drawer"`.
  2. Viewport width `>= 768`: panel has `data-layout="sidebar"`.
  3. Drawer mode: tapping the overlay behind the panel fires `onDismiss` (overlay is a sibling `<div>` at z-index < panel z-index, full viewport).
  4. Drawer mode on close: `window.scrollTo` called with the captured Y (mock + spy).
  5. Sidebar mode: tapping outside the panel does NOT dismiss. (Desktop users click other app chrome while the panel is open — intentional different contract.)

  Controlled `matchMedia` mock goes into `test-setup.ts`.

- [ ] **Step 4: Implement.** Structural change — overlay added as a sibling:

```tsx
return (
  <>
    {isMobile && <div className="species-panel-overlay" onClick={onDismiss} aria-hidden="true" />}
    <aside
      className="species-panel"
      data-layout={isMobile ? 'drawer' : 'sidebar'}
      role="complementary"
      aria-labelledby={headingId}
    >
      {/* existing body unchanged */}
    </aside>
  </>
);
```

Scoped ESC handler at `SpeciesPanel.tsx:34-45` preserved verbatim. `useScrollRestore(speciesCode !== null)` runs alongside. `useMediaQuery('(max-width: 767px)')` returns `isMobile`.

- [ ] **Step 5: CSS.** Replace the existing `.species-panel` block (`styles.css:94-170`):

```css
/* Base — desktop sidebar */
.species-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: #fff;
  border-left: 1px solid #d8d3c3;
  box-shadow: -2px 0 12px rgba(0, 0, 0, 0.08);
  padding: 24px 20px 16px 20px;
  overflow-y: auto;
  z-index: 10;
}

@media (max-width: 767px) {
  .species-panel { width: 100vw; max-width: 100vw; }
  .species-panel-overlay {
    position: fixed; inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 9;
  }
}

@media (min-width: 768px) {
  .species-panel-overlay { display: none; }
}
```

Preserve all `.species-panel-close`, `.species-panel-body`, `.species-panel-common-name`, `.species-panel-sr-heading`, etc. rules verbatim. Drop the `styles.css:94-100` map-specific comment block.

- [ ] **Step 6 (final): Commit.**

```
refactor(frontend): SpeciesPanel — drawer <768, sidebar >=768

Overrides architecture doc §6's "preserve position: fixed as-is"
per binding pre-plan decision. Mobile gets a full-width drawer
with tap-outside overlay + scroll-restore-on-close. Desktop
unchanged: 320px right-docked sidebar. ESC, close button,
aria-labelledby, sr-only heading preserved verbatim.

New hooks: useMediaQuery, useScrollRestore.
```

**Acceptance:** Drawer at 390px covers viewport and dismisses via overlay tap; sidebar at 1440px unchanged from today; scroll restores on mobile close; ESC closes in both modes; axe scan clean at both breakpoints.

---

### Task 12: Migrate REFACTOR e2e specs to the new readiness gate

**Files:**
- Modify: `frontend/e2e/pages/app-page.ts`
- Modify: `frontend/e2e/species-panel.spec.ts`, `deep-link.spec.ts`, `a11y.spec.ts`, `axe.spec.ts`, `prod-smoke.preview.spec.ts`, `error-states.spec.ts`, `history-nav.spec.ts`, `filters.spec.ts`

Dying signal: `[data-region-id]` count=9 (cited in `species-panel.spec.ts:26,67,90,103`, `deep-link.spec.ts:10,19,26,38,47`, `a11y.spec.ts:16`, `prod-smoke.preview.spec.ts:9-13`). Replacement: `[data-render-complete="true"]` on `<main>` (added in Task 5).

- [ ] **Step 1: POM update.** Rename `waitForMapLoad()` → `waitForAppReady()`:

```ts
async waitForAppReady(): Promise<void> {
  await this.page.waitForSelector('main[data-render-complete="true"]', { state: 'attached', timeout: 10_000 });
}
```

Add a one-PR alias `waitForMapLoad = waitForAppReady` for rename-diff minimisation; remove at end of task.

- [ ] **Step 2: Walk each spec.** Replace `[data-region-id]` selectors and `app.expandRegion()` calls:
  - `species-panel.spec.ts`: open panel via `?species=` deep link or via clicking a feed row.
  - `deep-link.spec.ts`: URL round-trip on autocomplete-select, view toggle, filter change. Drop the `?region=` cases at `:9-13,52`.
  - `a11y.spec.ts` test 1 ("Space expands region"): → "Space activates a focused feed row, opens SpeciesPanel."
  - `axe.spec.ts`: three scan targets — feed, species-search, hotspots. Drop the region-expanded scan.
  - `prod-smoke.preview.spec.ts`: confirm production URL loads to `data-render-complete="true"` within 10s; default feed has ≥1 row (skip-gracefully on ingestor stall).
  - `error-states.spec.ts`: `aria-busy` selector moves from `.map-wrap` to `main`.
  - `history-nav.spec.ts`: back/forward exercises surface toggles and filter changes.
  - `filters.spec.ts`: assertions become "row count decreases with `?notable=true`" (not "badge count").

- [ ] **Step 3: Run full e2e.** `npm run test:e2e --workspace @bird-watch/frontend`. All REFACTOR specs green.

- [ ] **Step 4: Remove the POM alias.** Drop `waitForMapLoad`; verify no caller remains (`rg waitForMapLoad frontend/e2e`).

- [ ] **Step 5 (final): Commit.**

```
test(frontend): migrate REFACTOR e2e specs to data-render-complete gate

Eight REFACTOR specs now consume the new [data-render-complete]
signal on <main>. Map-expand steps replaced with surface-
appropriate interactions. ?region= deep-link assertions removed.
```

**Acceptance:** All 8 REFACTOR specs green; zero `[data-region-id]` references in `frontend/e2e/`; POM exports `waitForAppReady`.

---

### Task 13: New happy-path e2e spec

**Files:**
- Create: `frontend/e2e/happy-path.spec.ts`

Replaces the DISCARD'd spec of the same name.

- [ ] **Step 1: Write the spec.** Five tests in one `test.describe('Path A happy path', ...)`:
  1. **`feed surface loads by default`** — goto `/`, `await app.waitForAppReady()`, assert ≥1 `.feed-row`, assert `aria-selected="true"` on the Feed tab.
  2. **`filters narrow the feed`** — toggle `?notable=true` via the checkbox, assert fewer rows (or equal + log if fixture has no non-notable rows).
  3. **`species deep link cold-loads to search surface with panel open`** — goto `/?species=vermfly`, assert `view=species` active, SpeciesPanel visible (`getByRole('complementary')`), `?species=vermfly` still in URL.
  4. **`panel opens at mobile as drawer with overlay`** — `page.setViewportSize({ width: 390, height: 844 })`, goto `/?species=vermfly`, assert `[data-layout="drawer"]` + overlay present, tap overlay, assert panel dismissed and `?species=` removed.
  5. **`panel opens at desktop as sidebar without overlay`** — `page.setViewportSize({ width: 1440, height: 900 })`, same flow, assert `[data-layout="sidebar"]`, overlay NOT present, ESC dismisses.

- [ ] **Step 2: Run.** 5 tests green; no retries (`retries: 0` per CLAUDE.md).

- [ ] **Step 3: No-DB-write audit.** Per CLAUDE.md testing conventions:

```
grep -rE "request\.(post|patch|delete|put)|fetch\(.*method:|fetch\(.*[\"']POST[\"']" frontend/e2e/happy-path.spec.ts
```

Expect zero output.

- [ ] **Step 4 (final): Commit.**

```
test(frontend): new Path A happy-path e2e spec

Replaces the DISCARD'd happy-path.spec.ts. Covers feed default,
filter narrowing, species deep-link, mobile drawer + overlay
dismiss, desktop sidebar + ESC. No DB writes.
```

**Acceptance:** 5 tests green; no DB-write grep hits; passes under CI `workers: 2`, `retries: 0` without flake.

---

### Task 14: T6 scope-out with tracking ticket

**Files:** none — ticket filing + plan update.

Per pre-plan decision 2, T6 does not ship in release 1.

- [ ] **Step 1: File a follow-up issue.** Title: "T6 species-diversity summary encoding (release 2)". Body covers: options (bar chart of species-per-region / sparkline of sightings-per-day / heatmap-strip by family by region); decision to defer (scope containment — honest 10/14 vs claimed 11/14); acceptance when built (renders above feed at desktop; 44px min-height; no new deps; 9 bars sorted by count; client-derived); effort estimate (3–4 hours).

- [ ] **Step 2: Link the issue URL into §Deferred to release 2 below.**

- [ ] **Step 3 (final): Commit.**

```
docs(plan-6): scope-out T6 diversity encoding; tracking issue filed

Path A release 1 ships with T6=0 honestly rather than claim 11/14
via a half-done chart. Release-2 issue linked in Deferred section.
```

**Acceptance:** Issue URL written into §Deferred to release 2; no chart code lands.

---

### Task 15: Self-review gate and release-1 acceptance check

**Files:** none — verification pass.

- [ ] **Step 1: Walk the §Release 1 acceptance checklist below.** Every item checkable; any unchecked item loops back to the relevant task.

- [ ] **Step 2: Full test + build matrix.**

```
npm run typecheck --workspace @bird-watch/frontend
npm test --workspace @bird-watch/frontend
npm run test:e2e --workspace @bird-watch/frontend
npm run build --workspace @bird-watch/frontend
```

All green.

- [ ] **Step 3: Axe scan at both breakpoints.** Per `axe.spec.ts` (updated in Task 12), WCAG 2.1 AA clean at 390×844 and 1440×900 for each of the three surfaces.

- [ ] **Step 4: Visual smoke at 320 / 390 / 768 / 1440 px.** One screenshot per breakpoint per surface (12 total). Eyeball for regressions; attach to the final merge PR per PR template.

- [ ] **Step 5 (final): Commit (if any fixes land).**

```
chore(frontend): Plan 6 self-review sweep

Release-1 acceptance checklist passes: 5 latent fields grep-
verified, T2/T5/T7 observable on feed/hotspots/species-search,
SpeciesPanel drawer + sidebar, ingestor + gzip green, axe-clean
preserved across all surfaces.
```

**Acceptance:** Every item in §Release 1 acceptance checked; full test + build matrix green; screenshots attached.

---

## Open decisions

Re-listed from the pre-plan header. These are product-judgment calls shaping downstream tasks.

1. **Default archetype / default surface — casual local birder / `view='feed'`.** From `phase-1/area-3-user-task-fit.md` and `risk-viability.md` Part 1: of three archetypes, local-birder is the strongest fit for dogfood usage. Feed-primary serves T1/T7/T3 at score 2 — three highest-value tasks. Visiting-birder forces hotspot-primary (richer for tourism, inferior for dogfood). Casual-non-birder is inferior on every task once feed gains `obsDt` + row-level `isNotable`. Refinement: `?species=` on cold load implies `view='species'` so bookmarked species URLs land on search with the panel open (architecture §9).

2. **T6 scoped out of release 1; accept T6=0.** A sorted list is not a "glance" (risk-viability.md §T6-weakness). Shipping a half-done 9-bar chart to claim 11/14 is the first-release ship pressure H6 warns against. Target honest 10/14. Task 14 tracks.

3. **Prototype gate — 2-hour Path A prototype between Task 5 and Task 7.** Path A dragons differ from Plan 4 (`risk-viability.md` Parts 5, 7; `analysis-report.md` H4): filter-flip latency, scroll-restore, autocomplete overflow, empty-state legibility. Budget 2 hours; output tightens Task 7 acceptance.

---

## Deferred to release 2

Explicitly scoped out, tracking-issue placeholders noted. Release 1 does NOT ship these.

- [ ] **`subId` checklist grouping** — flat reverse-chron is the simplest first feed; checklist-grouping adds a client reducer + collapsible UI + null-subId edge cases. `subId` is NOT one of the 5 latent fields. Follow-up: "feat(frontend): group ObservationFeed rows by subId checklist."

- [ ] **Taxonomic sort toggle UX polish** — Task 10 ships the toggle + null-last. Deferred: stable `/api/species-index` endpoint so `taxonOrder` is populated cold-load before any `SpeciesMeta` fetch. Follow-up: "feat(read-api): /api/species-index with taxonOrder + familyCode per species."

- [ ] **`?region=` migration banner removal** — Task 4 ships; remove in release 2 once bookmark traffic ages out (or after a two-week sunset, Julian's call). Follow-up: "chore(frontend): remove ?region= migration banner + readMigrationFlag."

- [ ] **Mobile gesture polish** — Task 11 ships drawer + tap-outside + ESC. Deferred: swipe-right-to-dismiss gesture; focus-trap inside the drawer (WCAG 2.2 AA-strict). Follow-up: "feat(frontend): SpeciesPanel mobile gesture + focus-trap."

- [ ] **Infinite-scroll / virtualisation** — 344 rows at stall, 1,500–2,000 healthy both render fine with `React.memo` (prototype-verified). Revisit only if ingest pushes past ~3,000 rows or mobile jank appears. No issue filed yet.

- [ ] **T6 "diversity at a glance" encoding** — pre-plan decision 2. Tracking issue filed in Task 14.

- [ ] **Hotspot sort URL persistence** — local state is adequate (architecture §4); promoting adds a 5th UrlState field for unvalidated feature. Follow-up: "feat(frontend): URL-persist hotspot sort mode."

- [ ] **Location-name search in FiltersBar** — structural second text input + new client filter step. Follow-up: "feat(frontend): locName search filter in FiltersBar."

- [ ] **Family-browse as a fourth surface** — requires `/api/families` endpoint (Area 4 Finding 5) and a fourth surface value. Out of scope for three-surface Path A. Follow-up: "feat: /api/families + FamilyBrowseSurface."

---

## Release 1 acceptance

Five checks a maintainer runs to declare "Path A shipped." All must be green.

- [ ] **1. All 5 latent fields read by frontend — grep-verified.** Task 10 Step 5 greps:

```
rg "observation\.obsDt|o\.obsDt|obs\.obsDt" frontend/src --type ts
rg "\.lat[^a-zA-Z]|\.lng[^a-zA-Z]" frontend/src --type ts
rg "locName|howMany" frontend/src --type ts
rg "isNotable" frontend/src --type ts
rg "taxonOrder|familyCode" frontend/src --type ts
```

Each returns ≥1 non-test source match.

- [ ] **2. T2, T5, T7 observably improved from current UI.**
  - **T2 ("near a place"):** hotspot rows surface `lat`/`lng` + `locName`; feed rows surface `locName`. Score 0 → 1 minimum.
  - **T5 ("where to go"):** hotspot-list surface with freshness + richness sorts. 0 → 1.
  - **T7 ("what's new"):** feed renders `obsDt` per row, relative formatting. 0 → 2.
  Observable by walking each surface on the deployed preview; no empirical test required.

- [ ] **3. SpeciesPanel works at 390px (drawer) and 1440px (sidebar).** Task 11 delivers. Smoke in Task 15 Step 4. Confirmed via Task 13 tests 4+5. Scroll-restore on close verified at mobile.

- [ ] **4. Ingestor and gzip both green.**
  - Ingestor: `GET api.bird-maps.com/api/observations?since=1d` returns a non-empty array with newest `obsDt` within 24 hours (sequencing.md Issue 12).
  - Gzip: `curl -sIH 'accept-encoding: gzip' https://api.bird-maps.com/api/observations?since=14d | grep -i content-encoding` returns `content-encoding: gzip`.

- [ ] **5. Axe-clean status preserved.** `axe.spec.ts` (Task 12) scans feed + species-search + hotspots at desktop and mobile. WCAG 2.1 AA tag set unchanged; zero violations. Covers `SpeciesPanel` open state.

When all five check, Plan 6 is done. Path A has shipped.
