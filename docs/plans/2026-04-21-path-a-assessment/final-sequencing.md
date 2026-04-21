# Path A Final Sequencing — Bird-Watch Frontend Reimagining

**Date:** 2026-04-21
**Status:** Final pre-issue-writing sequencing; supersedes `sequencing.md`
**Architecture reference:** `docs/plans/2026-04-21-path-a-assessment/architecture.md`
**Decisions baked in:** (1) SpeciesPanel is REFACTOR-layout, not CSS tidy; (2) all 5 latent fields ship in release 1.
**Existing open issues:** #57 (familyCode coupling), #60 (Terraform backend), #103 (CLAUDE.md stale), #104 (PR-workflow skill), #105 (bot prompt audit), #106 (ingestor scheduler SA)

---

## 1. What Changed from the Initial Sequencing

Two binding decisions alter the initial sequencing materially.

**Decision 1 — SpeciesPanel is REFACTOR-layout, not a CSS tidy.** The initial sequencing folded SpeciesPanel into a single-line CSS change in Issue 5. Julian's commitment elevates it to a standalone M-sized issue: drawer-at-mobile, sidebar-at-desktop at the 768px breakpoint, tap-outside dismiss, and scroll-restore-on-close, with mobile and desktop tests and an axe-clean check at both viewports. This is not folded into any other issue.

**Decision 2 — All 5 latent fields ship in release 1.** The initial sequencing shipped 3-of-5 and deferred `taxonOrder`/`familyCode` and `lat`/`lng`. Julian's decision closes both deferrals. `taxonOrder`/`familyCode` becomes a standalone issue covering the sort toggle in the feed plus a resolution of the `silhouetteId=familyCode` coupling that blocks #57. `lat`/`lng` surfaces on hotspot-list rows as coordinate text (recommendation justified below). This adds 2 issues and expands the scope of 3 existing issues, bringing the total to 17 issues from the initial 14.

---

## 2. Revised Issue List

### Issue 1: Enable gzip compression on the Read API
- **Label:** `agent-ready`
- **Type:** `feat(read-api)`
- **Scope:**
  - Add Hono `compress()` middleware to `services/read-api/src/app.ts`
  - Verify `Content-Encoding: gzip` on all JSON routes
  - Confirm payload shape is unchanged; confirm no API contract change
- **Files touched:**
  - `services/read-api/src/app.ts`
  - `services/read-api/src/app.test.ts` (assert Content-Encoding header)
- **Acceptance criteria:**
  - `Content-Encoding: gzip` present on `/api/observations` response
  - `?since=14d` payload measurably smaller (target < 20 KB compressed vs ~101 KB raw)
  - All existing read-api tests pass
  - `npm run build` clean
- **Depends on:** nothing
- **Blocks:** Issue 7 (ObservationFeed — mobile viability gated on compression)
- **Approx PR size:** XS
- **Existing GH issue:** none — risk R8 / opportunity O6 in risk-viability.md

---

### Issue 2: Fix ingestor stall (operational prerequisite)
- **Label:** `agent-ready`
- **Type:** `fix(ingestor)`
- **Scope:**
  - Diagnose stall: Cloud Run job failure, eBird API key expiry, or schema migration breakage
  - Fix root cause; verify fresh observations appear at `api.bird-maps.com/api/observations?since=1d`
  - Confirm Cloud Scheduler shows green run history
- **Files touched:** `services/ingestor/src/**` (root-cause-dependent)
- **Acceptance criteria:**
  - `GET api.bird-maps.com/api/observations?since=1d` returns non-empty array with `obsDt` within last 24 hours
  - `GET api.bird-maps.com/api/hotspots` returns non-empty array
  - Cloud Run job shows green in GCP console
  - No API contract change
- **Depends on:** nothing (parallel to all frontend work)
- **Blocks:** Issue 1 (gzip size verification should reflect healthy ingest volume); feed will show empty without this but is not strictly blocked
- **Approx PR size:** S (scope TBD on root cause; #106 is likely the same incident)
- **Existing GH issue:** #106 (likely same root cause — confirm before filing; if so, close #106 in this PR)

---

### Issue 3: Update CLAUDE.md — prototype gate convention and stale opening
- **Label:** `agent-ready`
- **Type:** `docs:`
- **Scope:**
  - Add `## Prototype gate` section under `## Before authoring a plan`: render N representative rows (>= 344) at 390×844 and 1440×900 before any plan body is committed; applies to any rendering approach (feeds, marker clusters, SVG)
  - Update the opening paragraph to reflect that application code now exists (supersedes #103)
- **Files touched:**
  - `CLAUDE.md`
- **Acceptance criteria:**
  - Prototype gate section present with mobile + desktop dimension callouts
  - Opening paragraph no longer says "planning artifacts only"
  - PR body references #103 as superseded
  - `npm run build` unaffected
- **Depends on:** nothing
- **Blocks:** nothing
- **Approx PR size:** XS
- **Existing GH issue:** #103 (superseded by this issue)

---

### Issue 4: Introduce `?view=` URL param and SurfaceNav scaffold
- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - Extend `UrlState` in `frontend/src/state/url-state.ts` with `view: 'feed' | 'species' | 'hotspots'` defaulting to `'feed'`
  - Add `SurfaceNav.tsx` — toggle between the three surfaces
  - Wire `SurfaceNav` into `App.tsx` above the content slot
  - Update `url-state.test.ts` to cover round-trip serialisation of `?view=`
- **Files touched:**
  - `frontend/src/state/url-state.ts`
  - `frontend/src/state/url-state.test.ts`
  - `frontend/src/components/SurfaceNav.tsx` (new)
  - `frontend/src/components/SurfaceNav.test.tsx` (new)
  - `frontend/src/App.tsx`
- **Acceptance criteria:**
  - `?view=feed`, `?view=species`, `?view=hotspots` round-trip through `useUrlState` correctly
  - `SurfaceNav` renders three toggle targets; active view is reflected in URL on click
  - Default view (`?view=` absent) resolves to `'feed'`
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR)
- **Depends on:** nothing
- **Blocks:** Issue 6 (deletion wave expects `SurfaceNav` slot to exist in App.tsx)
- **Approx PR size:** S
- **Existing GH issue:** none

---

### Issue 5: Refactor url-state and use-bird-data — drop regionId, add ?region= graceful-degradation
- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Delete `regionId` field from `UrlState` interface in `url-state.ts`
  - Preserve `?region=` in `readUrl()` as a parsed-and-discarded back-compat no-op; if `?species=` is also present on cold load and `?view=` is absent, default `view` to `'species'`
  - Display a one-time dismissible banner ("The region view has been replaced. Use the Filters bar to filter by family or species.") when `?region=` is detected; `replaceState` to drop the param without navigation
  - Remove `getRegions()` call from `use-bird-data.ts`; leave `getHotspots()` in place (used by HotspotList)
  - Update `url-state.test.ts` to remove `regionId` round-trip tests and add `?region=` discard test
  - Update `use-bird-data.test.tsx` to remove region-loading-state assertions
- **Files touched:**
  - `frontend/src/state/url-state.ts`
  - `frontend/src/state/url-state.test.ts`
  - `frontend/src/data/use-bird-data.ts`
  - `frontend/src/data/use-bird-data.test.tsx`
  - `frontend/src/components/MigrationBanner.tsx` (new)
  - `frontend/src/components/MigrationBanner.test.tsx` (new)
  - `frontend/src/App.tsx` (conditionally render banner)
  - `frontend/src/styles.css` (banner layout)
- **Acceptance criteria:**
  - `UrlState` no longer contains `regionId`
  - Navigating to `/?region=sky-islands-huachucas` shows migration banner; URL is rewritten to `/` (no `?region=`) immediately
  - `/?region=sky-islands-huachucas&species=vermfly` opens banner, sets `view='species'`, opens SpeciesPanel
  - Dismiss hides banner; refresh shows no banner
  - `use-bird-data` no longer calls `getRegions()`
  - Axe scan passes with banner visible
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR — banner state)
- **Depends on:** Issue 4 (`view` must be in UrlState before sniff logic can set it)
- **Blocks:** Issue 6 (deletion wave expects `regionId` gone from App.tsx helpers)
- **Approx PR size:** M
- **Existing GH issue:** none — resolves architecture.md §9 and risk R5

---

### Issue 6: Delete the map rendering chain (DISCARD wave)
- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Delete production files: `Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts`
  - Delete their unit test files
  - Delete 8 DISCARD e2e specs: `badge-containment.spec.ts`, `cross-region-badge-containment.spec.ts`, `expand-cap.spec.ts`, `paint-order.spec.ts`, `sizing.spec.ts`, `stroke-scaling.spec.ts`, `region-collapse.spec.ts`, `happy-path.spec.ts`
  - Delete ~60 LOC of map-specific CSS rule groups from `styles.css` (`.region`, `.region-expanded .region-shape`, `.badge`, `.badge-label`, `.map-wrap`, `.bird-map` blocks per architecture.md §10 table)
  - Remove `<div className="map-wrap">` block from `App.tsx` (lines 77–89); replace with `<main className="content-area" aria-busy={loading}></main>` placeholder
  - Remove `GENERIC_SILHOUETTE`, `silhouetteFor`, `colorFor`, `colorForFamily` import and helpers from `App.tsx` (lines 13–43)
  - Update error-screen copy: "Couldn't load map data" → "Couldn't load bird data"
- **Files touched:**
  - `frontend/src/components/Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx` (delete)
  - `frontend/src/geo/path.ts` (delete)
  - Six unit test files (delete)
  - Eight e2e spec files (delete)
  - `frontend/src/styles.css` (~60 LOC deleted)
  - `frontend/src/App.tsx` (map block removed, helpers removed, error copy updated)
- **Acceptance criteria:**
  - `npm run typecheck` passes with zero errors
  - `npm run test` passes (no references to deleted files remain)
  - `npm run build` produces a clean production build
  - `[data-region-id]` does not appear anywhere in the DOM
  - Browser smoke: FiltersBar visible, SpeciesPanel openable via `?species=`, `.error-screen` visible on API failure, SurfaceNav visible
  - PR screenshots required (UI PR — confirm app renders without blank crash)
- **Depends on:** Issue 4 (SurfaceNav must exist in App.tsx), Issue 5 (regionId must be gone from url-state before App.tsx is cleaned)
- **Blocks:** Issues 7, 8, 9, 10, 11, 12, 13 (all surface builds land in the cleared slot)
- **Approx PR size:** L
- **Existing GH issue:** none

---

### Issue 7: Add `[data-render-complete]` readiness gate
- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Add `data-render-complete` attribute to the `<main className="content-area">` element in `App.tsx`, set to `"true"` when the current surface's primary data is loaded (`!loading && observations !== null` for feed/species; `!hotspotsLoading && hotspots !== null` for hotspots)
  - Update Page Object Model: rename `app.waitForMapLoad()` to `app.waitForAppReady()` in `frontend/e2e/pages/app-page.ts`; update the selector to `[data-render-complete="true"]`
  - `data-render-complete` is test-only; it does not replace `aria-busy`
- **Files touched:**
  - `frontend/src/App.tsx`
  - `frontend/e2e/pages/app-page.ts`
- **Acceptance criteria:**
  - `document.querySelector('[data-render-complete="true"]')` resolves once data loads
  - `aria-busy` transitions correctly independent of `data-render-complete`
  - `app.waitForAppReady()` replaces `app.waitForMapLoad()` in the POM
  - `npm run typecheck && npm run test` green
- **Depends on:** Issue 6 (content-area slot must exist)
- **Blocks:** Issue 14 (REFACTOR e2e specs depend on this attribute)
- **Approx PR size:** XS
- **Existing GH issue:** none — architecture.md §8

---

### Issue 8: Build SpeciesPanel REFACTOR-layout — drawer at mobile, sidebar at desktop
- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Replace `styles.css:94-100` `position: fixed` panel layout with a breakpoint-switched layout: drawer (`position: fixed; bottom: 0; left: 0; right: 0; height: 60vh`) below 768px; sidebar (`position: fixed; top: 0; right: 0; width: 320px; height: 100vh`) at 768px and above
  - Implement tap-outside dismiss: add a backdrop element when panel is open at mobile; clicking backdrop calls the existing ESC handler or sets `speciesCode` to null
  - Implement scroll-restore-on-close: capture `window.scrollY` when panel opens; restore it when panel closes (covers the case where opening the drawer causes the underlying feed to scroll)
  - Remove the map-specific comment block at `styles.css:94-100`
  - No JSX change to `SpeciesPanel.tsx` interaction logic (ESC handler, `aria-labelledby`, `useSpeciesDetail` — all KEEP)
  - Playwright tests: panel opens as drawer at 390px; panel opens as sidebar at 1440px; tap-outside closes at 390px; scroll position restores at 390px; axe-clean at both viewports
- **Files touched:**
  - `frontend/src/styles.css` (`.species-panel*` block, lines 94–170)
  - `frontend/src/components/SpeciesPanel.tsx` (backdrop element only, if not doable in CSS alone)
  - `frontend/e2e/species-panel.spec.ts` (add mobile and desktop layout assertions)
- **Acceptance criteria:**
  - Panel renders as full-width drawer at 390×844 viewport
  - Panel renders as 320px right sidebar at 1440×900 viewport
  - Tap outside the panel closes it at 390px
  - Scroll position is restored to within 2px of pre-open position after close at 390px
  - `axe` scan passes at both viewports with panel open
  - Existing ESC-dismiss and `?species=` deep-link tests still pass
  - PR screenshots required (UI PR — mobile drawer and desktop sidebar states)
- **Depends on:** Issue 6 (map block removed so panel no longer contends with SVG z-index)
- **Blocks:** Issue 14 (REFACTOR e2e specs that exercise panel layout need new breakpoint behavior)
- **Approx PR size:** M
- **Existing GH issue:** none — closes risk R4 from risk-viability.md

---

### Issue 9: Build ObservationFeed with 4 of 5 latent fields
- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - New `frontend/src/components/ObservationFeed.tsx`: reverse-chronological list reading from `observations` prop (server already orders by `obs_dt DESC`)
  - Each row renders: `comName`, `obsDt` (relative timestamp: "2 hours ago", "yesterday"), `locName` (plain text), `howMany` (null-safe: "—" when null; "×3" when > 1), row-level `isNotable` badge (visible regardless of global `?notable` filter state)
  - Clicking a row's species name calls `onSelectSpecies(code)` — wires to `set({ speciesCode: code })`
  - New `frontend/src/utils/format-time.ts` relative-timestamp helper with unit tests
  - Empty state: distinct message for "no results for these filters" vs "feed is loading"
  - `aria-busy` on the list container; each row keyboard-focusable
  - Mount in `App.tsx` when `state.view === 'feed'`
- **Files touched:**
  - `frontend/src/components/ObservationFeed.tsx` (new)
  - `frontend/src/components/ObservationFeed.test.tsx` (new)
  - `frontend/src/utils/format-time.ts` (new)
  - `frontend/src/utils/format-time.test.ts` (new)
  - `frontend/src/styles.css` (feed layout rules)
  - `frontend/src/App.tsx` (mount ObservationFeed in feed surface slot)
- **Acceptance criteria:**
  - Feed renders observations in `obsDt` descending order
  - `obsDt` renders as relative time (not ISO string)
  - `locName`, `howMany` (null-safe), `isNotable` badge all visible per row
  - `isNotable` row badge visible when `?notable=true` filter is off
  - `howMany: null` renders as "—", not "0" or blank
  - Clicking row opens SpeciesPanel with correct species
  - `?notable=true` filter correctly narrows the feed
  - No row uses `observation.lat` or `observation.lng` in display (those surface in Issue 13)
  - RTL unit tests cover: empty state, loading state, single row, notable badge, row click
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR — feed default and notable-filtered states)
- **Depends on:** Issue 1 (gzip — mobile viability), Issue 6 (content-area slot), Issue 7 (readiness gate)
- **Blocks:** Issue 16 (happy-path e2e spec)
- **Approx PR size:** M
- **Existing GH issue:** none

---

### Issue 10: Build HotspotList with lat/lng coordinate display
- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - New `frontend/src/components/HotspotList.tsx`: renders hotspots sorted by `latestObsDt` DESC (freshness) by default
  - Each row: `locName`, `latestObsDt` (relative time), `numSpeciesAlltime` count chip, and `lat`/`lng` displayed as coordinate text ("31.51°N, 110.35°W") — this surfaces the 5th latent field group at the location where it is most legible (hotspot rows carry a fixed lat/lng, not per-observation drift)
  - Local sort state: `latest` (default) / `richness-desc` / `richness-asc`; rendered via `HotspotSortControls.tsx`
  - `getHotspots()` re-enabled in `use-bird-data.ts` (or dedicated `useHotspots` hook)
  - Mount in `App.tsx` when `state.view === 'hotspots'`
- **Files touched:**
  - `frontend/src/components/HotspotList.tsx` (new)
  - `frontend/src/components/HotspotList.test.tsx` (new)
  - `frontend/src/components/HotspotSortControls.tsx` (new)
  - `frontend/src/data/use-bird-data.ts` (re-enable `getHotspots()`)
  - `frontend/src/styles.css` (hotspot list layout)
  - `frontend/src/App.tsx` (mount HotspotListSurface)
- **Acceptance criteria:**
  - Hotspot list renders with `latestObsDt`, `numSpeciesAlltime`, and coordinate text per row
  - Coordinate text format: "31.51°N, 110.35°W" (two decimal places; N/S/E/W suffix)
  - Default sort is freshest-first
  - Sort controls cycle between `latest`, `richness-desc`, `richness-asc`
  - RTL unit tests cover: sort order, coordinate formatting, empty state
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR)
- **Depends on:** Issue 5 (use-bird-data must be cleanly trimmed before hotspot re-add), Issue 6 (content-area slot)
- **Blocks:** Issue 16 (happy-path e2e spec)
- **Approx PR size:** M
- **Existing GH issue:** none

---

### Issue 11: Build SpeciesSearch autocomplete surface
- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - New `frontend/src/components/SpeciesSearchSurface.tsx`: navigation-style autocomplete (distinct from FiltersBar's filter-style species input)
  - Autocomplete data source: `deriveSpeciesIndex(observations)` (already in `derived.ts`)
  - On selection: calls `set({ speciesCode: code })` — opens `SpeciesPanel` via existing deep-link contract
  - When `?species=` is set, surface also renders a secondary list of that species's recent observations (filtered client-side from the already-loaded `observations` array using the same row shape as `ObservationFeed`)
  - Empty state: prompt to type in the search box when `speciesCode === null`
  - Mount in `App.tsx` when `state.view === 'species'`
- **Files touched:**
  - `frontend/src/components/SpeciesSearchSurface.tsx` (new)
  - `frontend/src/components/SpeciesAutocomplete.tsx` (new)
  - `frontend/src/components/SpeciesSearchSurface.test.tsx` (new)
  - `frontend/src/styles.css` (autocomplete and surface layout)
  - `frontend/src/App.tsx` (mount SpeciesSearchSurface)
- **Acceptance criteria:**
  - Typing 3+ characters shows matching species
  - Selecting a species opens `SpeciesPanel` with correct content
  - Deep-link `?species=vermfly` cold-loads panel (`species-panel.spec.ts` must still pass)
  - When `?species=` is set, recent sightings list renders that species's observations with the same `obsDt`/`locName`/`howMany`/`isNotable` row shape as ObservationFeed
  - RTL unit tests cover: autocomplete match, selection sets URL, empty state, species recent sightings list
  - PR screenshots required (UI PR — autocomplete open and species-selected states)
- **Depends on:** Issue 6 (content-area slot), Issue 8 (SpeciesPanel layout must be stable)
- **Blocks:** Issue 16 (happy-path e2e spec)
- **Approx PR size:** M
- **Existing GH issue:** none

---

### Issue 12: Integrate taxonOrder / familyCode — feed sort toggle and decouple silhouetteId coupling
- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - Add a sort toggle to `ObservationFeed`: "Recent" (default, `obsDt DESC` preserved from server) | "Taxonomic" (`taxonOrder ASC`, null values sorted last with alphabetical fallback on `comName`)
  - Sort is local component state in `FeedSurface` / `App.tsx` — not URL-persisted in release 1
  - Add `taxonOrder`-aware sort to `SpeciesSearchSurface` autocomplete options (already required by Issue 11's acceptance criteria — confirm the sort is driven by this issue's null-handling policy)
  - `taxonOrder` null-handling policy (stated explicitly in component comment): `null` values sort after all non-null values; within null group, sort alphabetically by `comName`
  - Decouple `familyCode` from `silhouetteId` in `derived.ts` (lines 4–15): `deriveFamilies` should read `Observation.familyCode` directly if available, falling back to `silhouetteId` only when `familyCode` is null/absent — this is the minimal decoupling that unblocks #57 without resolving it fully; PR body notes #57 as the follow-on
- **Files touched:**
  - `frontend/src/components/ObservationFeed.tsx` (sort toggle)
  - `frontend/src/components/ObservationFeed.test.tsx` (sort order assertions, null taxonOrder)
  - `frontend/src/derived.ts` (familyCode decoupling)
  - `frontend/src/derived.test.ts` (familyCode vs silhouetteId assertion)
  - `frontend/src/styles.css` (sort toggle layout)
- **Acceptance criteria:**
  - "Recent" sort matches server order (no client re-sort); "Taxonomic" sort orders by `taxonOrder ASC` with nulls last, then `comName ASC` within nulls
  - Sort toggle is keyboard accessible
  - `deriveFamilies` reads `familyCode` first; falls back to `silhouetteId` only when `familyCode` is null
  - Grep assertion: `frontend/src/**` reads `taxonOrder` in at least one display path
  - PR body references #57 as partially unblocked
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR — sort toggle in both states)
- **Depends on:** Issue 9 (ObservationFeed must exist)
- **Blocks:** Issue 17 (release-1 exit criteria — 5-of-5 grep check)
- **Approx PR size:** M
- **Existing GH issue:** relates to #57 (partially unblocks it; does not close it)

---

### Issue 13: T6 encoding — recommend defer to release 2
- **Label:** `needs-scoping`
- **Type:** `feat(frontend)`
- **Scope:**
  - Scope a non-spatial T6 diversity summary — candidate: a small horizontal bar chart (9 bars, species-count-per-region) rendered as raw SVG or a lightweight charting primitive in a header strip above the feed
  - Evaluate whether the 9-region axis makes conceptual sense when `?region=` is being deprecated as a primary surface param
  - Julian's call: ship in release 1 (T6 = 1, total 11/14) or defer (T6 = 0, total 10/14 — honest reduction)
  - If deferred: close this issue with a comment documenting the score reduction
- **Files touched (if executed):**
  - `frontend/src/components/DensityStrip.tsx` (new)
  - `frontend/src/components/DensityStrip.test.tsx` (new)
  - `frontend/src/App.tsx` (render above feed)
- **Acceptance criteria (for scoping decision):**
  - Decision documented: ship in release 1 or defer, with explicit T6 score consequence
  - If shipped: bar chart renders with per-region species counts; axe-clean; PR screenshots required
  - If deferred: issue closed; `final-sequencing.md` updated to reflect 10/14 target
- **Depends on:** nothing (can be scoped in parallel with surface builds)
- **Blocks:** Issue 17 (exit criteria score depends on this call)
- **Approx PR size:** S (if executed); XS (scoping close)
- **Existing GH issue:** none — risk-viability.md T6 weakness §Part 1

---

### Issue 14: Refactor REFACTOR e2e specs — update readiness gate and surface interactions
- **Label:** `agent-ready`
- **Type:** `test(frontend)`
- **Scope:**
  - Replace `[data-region-id]` readiness gate in all REFACTOR specs with `[data-render-complete="true"]` (using the new `app.waitForAppReady()` POM method from Issue 7)
  - `species-panel.spec.ts`: replace map-expand-then-badge-click trigger with surface-click (feed row click or autocomplete select); preserve URL round-trip and ESC assertions
  - `deep-link.spec.ts`: remove the `?region=` assertion; confirm `?species=` cold-load still passes
  - `a11y.spec.ts`: replace region-expand Space-key test with a surface interaction (e.g., filter change)
  - `axe.spec.ts`: replace region-expanded axe-scan setup with the three surface states (feed, species, hotspots)
  - `error-states.spec.ts`: update `aria-busy` selector from `.map-wrap` to `.content-area`
  - `history-nav.spec.ts`: remove `app.expandRegion()` call; replace with a surface-nav change
  - `prod-smoke.preview.spec.ts`: replace map-load wait with `app.waitForAppReady()`
- **Files touched:**
  - `frontend/e2e/species-panel.spec.ts`
  - `frontend/e2e/deep-link.spec.ts`
  - `frontend/e2e/a11y.spec.ts`
  - `frontend/e2e/axe.spec.ts`
  - `frontend/e2e/error-states.spec.ts`
  - `frontend/e2e/history-nav.spec.ts`
  - `frontend/e2e/prod-smoke.preview.spec.ts`
  - `frontend/e2e/pages/app-page.ts`
- **Acceptance criteria:**
  - All 8 surviving spec files pass: `npm run test:e2e` exits 0
  - No spec uses `[data-region-id]`, `.region-expanded`, `app.expandRegion()`, or `.map-wrap`
  - `axe.spec.ts` scans feed, species-search, and hotspots surfaces and passes WCAG 2.1 AA
  - `retries: 0` setting is not changed
- **Depends on:** Issue 6 (DISCARD specs deleted), Issue 7 (gate attribute exists), Issue 8 (SpeciesPanel breakpoint layout is stable so trigger can be authored)
- **Blocks:** Issue 16 (new happy-path spec)
- **Approx PR size:** M
- **Existing GH issue:** none

---

### Issue 15: Optional — Path A prototype commit (2–4 hours)
- **Label:** `needs-scoping`
- **Type:** `chore`
- **Scope:**
  - Vite + React page rendering 344 canned observation rows from `src/fixtures/observations-344.json`
  - FiltersBar wired to `since` and `notable`
  - `SpeciesPanel` as drawer <768px / sidebar >=768px with tap-outside dismiss and scroll-restore
  - Feed rows: `comName`, `obsDt`, `locName`, `howMany`, `isNotable`
  - Tested manually at 390×844 and 1440×900, keyboard-only and mouse
  - Screen recording or `PROTOTYPE_LEARNINGS.md` noting density, tap-target, and layout observations
- **Files touched:** `frontend/src/fixtures/observations-344.json` (new; not committed to main branch if only a prototype commit)
- **Acceptance criteria:**
  - Prototype reviewed at both viewports; known interaction failures documented
  - Learnings incorporated into Issue 8 (SpeciesPanel) or Issue 9 (ObservationFeed) scope if any surprises found
- **Depends on:** nothing (can run before Issue 6)
- **Blocks:** nothing (optional insurance gate)
- **Approx PR size:** XS (prototype artifact only, may be a draft PR)
- **Existing GH issue:** none — risk-viability.md Part 7

---

### Issue 16: Write the new happy-path e2e spec for Path A surfaces
- **Label:** `agent-ready`
- **Type:** `test(frontend)`
- **Scope:**
  - New `frontend/e2e/happy-path.spec.ts` (replaces the DISCARD spec of the same name)
  - Covers: feed renders on load; `?notable=true` filter narrows feed; feed row click opens SpeciesPanel; surface nav switches to hotspot list; hotspot list shows coordinate text; species search autocomplete fires and opens panel; `?region=` migration banner shows and dismisses; `?species=` cold-load opens panel
  - Uses `app.waitForAppReady()` readiness gate (not `[data-region-id]`)
  - No SVG assertions; no `[data-region-id]`
- **Files touched:**
  - `frontend/e2e/happy-path.spec.ts` (new)
- **Acceptance criteria:**
  - All tests in the new spec pass with `npm run test:e2e`
  - Covers feed, hotspot, species search, migration banner, and deep-link scenarios
  - No `test.fail()` in the file
  - No DB writes (CLAUDE.md grep check passes)
  - Spec complies with `workers: 2`, `fullyParallel: true`, `retries: 0`
- **Depends on:** Issues 9, 10, 11, 14 (all surfaces and REFACTOR spec updates must land)
- **Blocks:** Issue 17 (exit criteria)
- **Approx PR size:** S
- **Existing GH issue:** none

---

### Issue 17: Release-1 exit criteria meta-issue
- **Label:** `needs-scoping`
- **Type:** `test(frontend)`
- **Scope:**
  - Grep assertion: `frontend/src/**` reads all 5 latent field groups in at least one display path — `obsDt`, `locName`/`howMany`, `isNotable`, `lat`/`lng`, `taxonOrder`/`familyCode` (a CI-runnable grep script or a unit test that imports and inspects the component source)
  - Confirm T2/T5/T7 observably improved: ObservationFeed shows timestamps (T7); HotspotList shows coordinates (T2/T5); filter-to-feed round-trip works
  - SpeciesPanel works at 390px (drawer) and 1440px (sidebar) — confirmed by Issue 8 Playwright tests
  - Axe-clean on all three surfaces — confirmed by Issue 14 axe.spec.ts
  - New happy-path spec green — confirmed by Issue 16
  - Score: 11/14 if T6 encoding ships (Issue 13); 10/14 if deferred — documented explicitly
- **Files touched:**
  - `frontend/src/release-1-assertions.test.ts` (new — grep-based field-coverage assertions, or equivalent CI script)
- **Acceptance criteria:**
  - Grep assertions for all 5 field groups pass
  - All four CI checks green (`test`, `lint`, `build`, `e2e`)
  - Release-1 score documented (11/14 or 10/14 depending on T6 decision)
- **Depends on:** Issues 9, 10, 11, 12, 13, 14, 16 (all surface and field integrations must land)
- **Blocks:** nothing (closes the release)
- **Approx PR size:** XS
- **Existing GH issue:** none

---

## 3. Migration Strategy

The single-cutover-with-seam-isolation strategy from the initial sequencing still applies and is unchanged by both decisions.

The DISCARD boundary remains a single JSX block in `App.tsx` (lines 77–89). The SpeciesPanel REFACTOR-layout (Decision 1) does not reopen the seam question — it is a CSS change inside the existing `<SpeciesPanel>` mount point, not a new routing concern. The expanded latent-field integration (Decision 2) is additive prop-reading inside new surface components, not a seam change.

Rollback per phase: each issue produces one PR. If any PR introduces a regression, `git revert` on that PR restores prior state. Issue 6 (deletion wave) is the highest-risk single PR; its rollback is `git revert` before any surface PR lands. No strangler-fig flag is needed — the deletion wave is safe because the DISCARD boundary is precise and the KEEP scaffolding does not depend on the map being alive.

---

## 4. Dependency Graph

```
[Issue 2: fix ingestor] ────────────────────────────────────────────────────┐
[Issue 3: CLAUDE.md]                                                         │
                                                                              │
[Issue 1: gzip] ──────────────────────────────────────────────────┐         │
                                                                    │         │
[Issue 4: ?view= + SurfaceNav] ──────────────┐                    │         │
                                              │                    │         │
                              [Issue 5: url-state + ?region=]      │         │
                                              │                    │         │
                                       [Issue 6: deletion wave]   │         │
                                              │                    │         │
               ┌──────────────────────────────┼─────────────┐     │         │
               │                              │             │     │         │
         [Issue 7:                      [Issue 8:      [Issue 15:  │         │
         render-gate]               SpeciesPanel       prototype]  │         │
               │                    REFACTOR]                      │         │
               │                         │                         │         │
    ┌──────────┼──────────────────────────┤                        │         │
    │          │                          │                         │         │
[Issue 9:  [Issue 10:  [Issue 11:   [Issue 14:                     │         │
ObsFeed]  HotspotList] SpecSearch]  e2e refactor]                  │         │
    │          │           │              │                         │         │
    │          └───────────┘              │                         │         │
    │                                     │                         │         │
[Issue 12: taxonOrder/familyCode] ◄───────┘                        │         │
    │                                                               │         │
    └───────────────────────────────────────────────────────────────┘         │
                                                                               │
[Issue 13: T6 encoding] (needs-scoping — parallel decision)                   │
    │                                                                          │
    └────────────┐                                                             │
                 │                                                             │
          [Issue 16: happy-path e2e] ◄── all surface issues ──────────────────┘
                 │
          [Issue 17: exit criteria]
```

---

## 5. Critical Path

The longest dependency chain through all agent-ready issues:

**Issue 4 → Issue 5 → Issue 6 → Issue 7 → Issue 9 → Issue 12 → Issue 17**

Seven issues deep. This chain determines when the full 5-of-5 latent field integration is complete and verifiable. Every step in this chain is `agent-ready`.

The chain through SpeciesPanel REFACTOR:
**Issue 6 → Issue 8 → Issue 14 → Issue 16 → Issue 17**

Five issues deep. It merges into the critical path at Issue 17.

Note that Issue 4 and Issue 5 are prerequisites to Issue 6 (the deletion wave), which is itself the prerequisite to every surface build. The practical week-0 priority is therefore: land Issues 1, 3, 4, and 5 in parallel, then land Issue 6, then Issue 7 and Issue 8 in parallel, then surface builds in parallel.

---

## 6. Delivery Slices

### Week 0 (pre-cutover blockers)

Target: clean slate before any surface work. Issues in this slice can run in parallel.

| # | Title | Size | Can run in parallel with |
|---|---|---|---|
| 1 | Enable gzip on Read API | XS | 2, 3, 4 |
| 2 | Fix ingestor stall | S | 1, 3, 4 |
| 3 | Update CLAUDE.md prototype gate | XS | 1, 2, 4 |
| 4 | Introduce `?view=` + SurfaceNav scaffold | S | 1, 2, 3 |
| 15 | Optional prototype commit | XS | 1, 2, 3, 4 |

End of week 0: gzip live, ingestor healthy, CLAUDE.md updated, `?view=` param in URL state.

### Week 1 (cutover — deletion wave + URL plumbing + SpeciesPanel)

| # | Title | Size | Notes |
|---|---|---|---|
| 5 | url-state refactor + `?region=` migration | M | Depends on Issue 4 |
| 6 | Deletion wave | L | Depends on Issues 4, 5; highest-risk PR |
| 7 | Readiness gate | XS | Immediately after Issue 6 |
| 8 | SpeciesPanel REFACTOR-layout | M | In parallel with Issue 7 after Issue 6 |

End of week 1: codebase clean (no SVG imports), typecheck passing, `data-render-complete` gate live, SpeciesPanel works as drawer/sidebar.

### Week 2 (surface builds)

| # | Title | Size | Can run in parallel with |
|---|---|---|---|
| 9 | ObservationFeed (4 of 5 latent fields) | M | 10, 11 |
| 10 | HotspotList with lat/lng coordinates | M | 9, 11 |
| 11 | SpeciesSearch autocomplete | M | 9, 10 |
| 12 | taxonOrder / familyCode sort + decoupling | M | After 9 lands |
| 14 | Refactor REFACTOR e2e specs | M | After 6, 7, 8; can partially parallel 9–11 |
| 13 | T6 encoding (scoping decision) | needs-scoping | Parallel with surface builds |

End of week 2: all three surfaces live, 5-of-5 latent fields integrated, e2e suite running green.

### Post-week 2 (hardening and close)

| # | Title | Size | Notes |
|---|---|---|---|
| 16 | New happy-path e2e | S | After all surface issues |
| 17 | Release-1 exit criteria | XS | Closes the release |

Optional follow-on (not release-1): DB `parent_id` and vertex-clamping migration audit (scoping item; see architecture.md §G3 / Finding G3 — 306 SQL LOC eligible for removal after SVG retirement confirmed safe).

---

## 7. Open Decisions Surfaced to Julian

Three decisions remain open after the two binding decisions and require Julian's input before or during week 2.

### Decision A: Default `?view=` per archetype

**What it is:** Architecture §4 notes the default `view` is `'feed'` when `?view=` is absent. Risk-viability §Part 1 (Surface dominance failure) argues the realised task-fit score depends on which surface is the landing view for which archetype. Three archetypes map to different natural defaults: visiting birder → hotspot-list-primary; local birder → feed-primary; casual non-birder → feed-primary with notable ordering.

**Recommendation:** Default to `'feed'`. The local birder and casual non-birder are the modal plausible visitors at `bird-maps.com`; the feed with temporal framing and `isNotable` filtering is the most immediately legible first-render for both. The visiting birder reaches hotspots via a single SurfaceNav tap — a tolerable second click. This matches architecture.md §4's stated default. If Julian has evidence that visiting birders are the primary audience, switch to `'hotspots'`.

**Where it lands:** `url-state.ts` line that sets the default; SurfaceNav active-indicator default; Issue 4 scope.

### Decision B: T6 encoding in release 1 or deferred

**What it is:** Issue 13. Without a visual encoding (non-spatial bar chart, sparkline, or heatmap strip), T6 "diversity at a glance" is honestly 0 — "at a glance" is the defining verb and a sorted hotspot list does not satisfy it. Including a 9-bar chart raises T6 to 1 and total to 11/14. Excluding it gives 10/14 — still a meaningful gain over 6/14.

**Recommendation:** Defer to release 2. The hotspot list with `numSpeciesAlltime` + `latestObsDt` and the `taxonOrder` sort toggle in the feed deliver the bulk of the Path A value. A T6 chart against 9 ecoregion buckets is semantically awkward given that `?region=` is being deprecated as a primary navigation param. Defer until the region taxonomy's role in Path A is clarified by live usage. Accept T6 = 0 and target 10/14.

**Where it lands:** Issue 13 close comment; Issue 17 exit criteria score.

### Decision C: `lat`/`lng` in ObservationFeed rows or hotspot rows only

**What it is:** Architecture §5.2 deferred `lat`/`lng` entirely. Julian's Decision 2 says all 5 latent fields ship in release 1. The field group `lat`/`lng` must surface somewhere. Two candidate locations: (a) hotspot rows as "31.51°N, 110.35°W" text (scoped in Issue 10); (b) additionally per-observation in ObservationFeed rows as a click-to-expand detail.

**Recommendation:** Hotspot rows only (Issue 10 as scoped). Observation `lat`/`lng` in the feed creates visual noise — a per-row coordinate beside `locName` is redundant (users can already read the location name). The coordinate is more legible and more useful on hotspot rows, where it anchors the location for trip planning. Per-observation coordinates in the feed are Path B territory (geographic display) and would need a "where on the map" affordance to be meaningful. Hotspot-rows-only satisfies the 5-of-5 latent field requirement cleanly.

**Where it lands:** Issue 10 acceptance criteria; Issue 17 grep assertion (confirm `lat`/`lng` is read in HotspotList).

---

## 8. Alignment with Plan 6

The Plan 6 document at `/Users/j/repos/bird-watch/docs/plans/2026-04-21-plan-6-path-a-reimagine.md` is the implementer-facing task artifact; this document is the issue-filing artifact. Both read from the same source inputs. Task-to-issue crosswalk:

| Plan 6 Task | This document Issue | Notes |
|---|---|---|
| Task 1: gzip | Issue 1 | Direct 1:1 |
| Task 2: `?view=` + SurfaceNav scaffold | Issue 4 | Direct 1:1 |
| Task 3: url-state refactor | Issue 5 | Expanded to include `?region=` migration (was separate Issue 9 in initial sequencing; folded here) |
| Task 4: `?region=` migration | Issue 5 | Folded into url-state refactor — this sequencing combines Tasks 3 + 4 into one issue because both touch `url-state.ts` and writing them as separate PRs creates a merge-conflict risk on the same file |
| Task 5: use-bird-data refactor | Issue 5 | `getRegions()` drop is part of the url-state refactor scope |
| Task 6: deletion wave | Issue 6 | Direct 1:1 |
| Task 7: ObservationFeed | Issue 9 | Expanded — 4 latent fields (not 3) per Decision 2 |
| Task 8: HotspotList | Issue 10 | Expanded — includes `lat`/`lng` coordinate text per Decision 2 |
| Task 9: SpeciesSearch | Issue 11 | Direct 1:1 |
| Task 10: taxonOrder / familyCode integration | Issue 12 | New standalone issue per Decision 2 |
| Task 11: SpeciesPanel REFACTOR-proper | Issue 8 | New standalone M-sized issue per Decision 1; was folded into Issue 5 in initial sequencing |
| Task 12: readiness-gate signal | Issue 7 | Direct 1:1 |
| Task 13: new happy-path spec | Issue 16 | Direct 1:1 |
| Task 14: T6 encoding | Issue 13 | `needs-scoping`; recommendation is to defer |
| Task 15: prototype (optional) | Issue 15 | Direct 1:1 |

Issues 3 (CLAUDE.md) and 17 (exit criteria) have no Plan 6 task counterpart — they are process and validation artifacts. If Plan 6 numbering differs slightly from the above, this crosswalk is the canonical mapping; update Plan 6's task list accordingly.

---

*End of final sequencing.*
