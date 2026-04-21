# Path A Sequencing Plan — Bird-Watch Frontend Reimagining

**Date:** 2026-04-21
**Status:** Pre-execution — issue list for Julian to file
**Architecture reference:** `docs/analyses/2026-04-20-frontend-map-analysis/phase-2/iterator-1-task-surface-matrix.md` (Path A surfaces; `architecture.md` not yet authored)
**Existing open issues intersected:** #57 (familyCode coupling), #60 (Terraform backend), #103 (CLAUDE.md stale), #104 (PR-workflow skill), #105 (bot prompt audit)

---

## Migration Strategy

**Recommended approach: single-cutover with seam isolation, not strangler-fig.**

The strangler-fig pattern (keeping the old map alive behind a feature flag while new surfaces are built alongside it) is theoretically appealing but operationally expensive here. The DISCARD boundary is already precisely mapped — it is a single JSX block in `App.tsx` at lines 77–89, wrapping only `<Map />`. The 49% KEEP+REFACTOR scaffolding does not depend on the map being alive. Feature-flagging the old map adds a parallel code path, doubles the test surface, and extends the period during which the rendering-churn risk (R1) continues to generate PRs.

The recommended strategy: **delete the map rendering chain in one PR** (Issue 3 below), immediately replacing the `<div className="map-wrap">` block with a minimal skeleton that keeps `aria-busy`, then build each new surface into that skeleton in subsequent PRs. The seam is clean enough that the cutover is safe — the only coupling risk is the `aria-busy` attribute on the wrapper div, which the e2e refactor issues address explicitly. Each surface PR is independently valuable (the app renders non-empty with just `FiltersBar` + `SpeciesPanel` visible), so there is no "dark period" where the app is broken.

Rollback per phase: each issue produces one PR. If any PR introduces a regression, `git revert` on that PR restores the prior state. The deletion wave (Issue 3) is the highest-risk single PR; its rollback is `git revert` before any surface PRs land on top of it.

---

## Open Issue Cross-Reference

| Existing issue | Intersection with this plan |
|---|---|
| #57 familyCode coupling | Referenced in Issue 11 (latent fields); not resolved in this plan — noted as parallel debt |
| #60 Terraform backend | No intersection — infra-only |
| #103 CLAUDE.md stale | Superseded by Issue 14 (prototype gate + CLAUDE.md update) |
| #104 PR-workflow skill | No intersection — tooling-only |
| #105 bot prompt audit | No intersection — security-only |

---

## Issue List

### Issue 1: Enable gzip compression on the Read API

- **Label:** `agent-ready`
- **Type:** `feat(read-api)`
- **Scope:**
  - Add Hono `compress()` middleware to `services/read-api/src/app.ts`
  - Verify `Content-Encoding: gzip` header in API response
  - Confirm no API contract change (payload shape unchanged)
- **Files touched:**
  - `services/read-api/src/app.ts`
  - `services/read-api/src/app.test.ts` (assert Content-Encoding header)
- **Acceptance criteria:**
  - `Content-Encoding: gzip` present on `/api/observations` response
  - `?since=14d` payload is measurably smaller (assert < 20 KB compressed vs ~101 KB raw)
  - All existing read-api tests pass
  - `npm run build` clean
- **Depends on:** nothing
- **Blocks:** Issue 6 (ObservationFeed — mobile viability gated on compression)
- **Approx. PR size:** XS
- **Existing GH issue match:** none

---

### Issue 2: Refactor KEEP scaffolding — drop `regionId` from url-state and trim use-bird-data

- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Delete `regionId` field from `UrlState` in `frontend/src/state/url-state.ts` (lines 7, 27, 37)
  - Update `url-state.test.ts` to remove `regionId` round-trip tests
  - Remove `getRegions()` and `getHotspots()` calls from `frontend/src/data/use-bird-data.ts` (lines 28–34) — keep the hook's cancellable-parallel-fetch structure
  - Update `use-bird-data.test.tsx` to remove region/hotspot loading-state assertions
- **Files touched:**
  - `frontend/src/state/url-state.ts`
  - `frontend/src/state/url-state.test.ts`
  - `frontend/src/data/use-bird-data.ts`
  - `frontend/src/data/use-bird-data.test.tsx`
- **Acceptance criteria:**
  - `UrlState` type no longer contains `regionId`
  - `use-bird-data` hook no longer calls `getRegions()` or `getHotspots()`
  - `npm run typecheck && npm run test` green
  - No e2e specs broken (map e2e specs will fail naturally — that is expected at this stage)
- **Depends on:** nothing
- **Blocks:** Issue 3 (deletion wave references these files), Issue 5 (App.tsx refactor)
- **Approx. PR size:** S
- **Existing GH issue match:** none

---

### Issue 3: Delete the map rendering chain (DISCARD wave)

- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Delete production files: `Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts`
  - Delete their unit test files: `Map.test.tsx`, `Region.test.tsx`, `Badge.test.tsx`, `BadgeStack.test.tsx`, `HotspotDot.test.tsx`, `geo/path.test.ts`
  - Delete DISCARD e2e specs: `badge-containment.spec.ts`, `cross-region-badge-containment.spec.ts`, `expand-cap.spec.ts`, `paint-order.spec.ts`, `sizing.spec.ts`, `stroke-scaling.spec.ts`, `region-collapse.spec.ts`, `happy-path.spec.ts`
  - Delete map-specific CSS rule groups from `styles.css` (`.region`, `.region-expanded .region-shape`, `.badge`, `.badge-label`, `.map-wrap`, `.bird-map` — ~92 LOC, keeping global resets, `.app`, `.error-screen`, `.filters-bar`, `.species-panel` blocks)
  - Replace `<div className="map-wrap">` block in `App.tsx` (lines 77–89) with `<main className="content-area" aria-busy={loading}></main>` placeholder
  - Remove `GENERIC_SILHOUETTE`, `silhouetteFor`, `colorFor` from `App.tsx`
- **Files touched:**
  - `frontend/src/components/Map.tsx` (delete)
  - `frontend/src/components/Region.tsx` (delete)
  - `frontend/src/components/Badge.tsx` (delete)
  - `frontend/src/components/BadgeStack.tsx` (delete)
  - `frontend/src/components/HotspotDot.tsx` (delete)
  - `frontend/src/geo/path.ts` (delete)
  - Six unit test files (delete)
  - Eight e2e spec files (delete)
  - `frontend/src/styles.css` (prune ~92 LOC)
  - `frontend/src/App.tsx` (replace map block, remove helpers)
- **Acceptance criteria:**
  - `npm run typecheck` passes with zero errors
  - `npm run test` passes (no references to deleted files)
  - `npm run build` produces a clean production build
  - Browser renders: FiltersBar visible, SpeciesPanel openable via `?species=`, `.error-screen` visible on API failure — confirmed via `npm run dev` smoke
  - `[data-region-id]` attribute does not appear anywhere in the DOM
  - PR screenshots show the app renders without a blank crash (required — UI PR)
- **Depends on:** Issue 2 (url-state must not reference regionId before App.tsx is cleaned)
- **Blocks:** Issues 4, 5, 6, 7, 8, 9 (all new surfaces land in the cleared slot)
- **Approx. PR size:** L
- **Existing GH issue match:** none

---

### Issue 4: Refactor REFACTOR e2e specs — update readiness gate and map-specific selectors

- **Label:** `agent-ready`
- **Type:** `test(frontend)`
- **Scope:**
  - Replace `[data-region-id]` readiness gate in `species-panel.spec.ts`, `deep-link.spec.ts`, `a11y.spec.ts`, `axe.spec.ts`, `prod-smoke.preview.spec.ts` with a new `[data-render-complete]` attribute gate (see Issue 5)
  - Remove the one `?region=` assertion in `deep-link.spec.ts` (lines 9–13, 52)
  - Remove the map-expand setup in `a11y.spec.ts` test 1 (Space key expands region) — replace with a design-agnostic a11y test for the content area
  - Rewrite `axe.spec.ts` test 2 setup (region-expanded axe scan) to target whatever replaces the expand interaction
  - Remove the `app.expandRegion()` call from `history-nav.spec.ts` — replace with a state-change that uses the new primary interaction
  - Update `error-states.spec.ts` selector from `aria-busy` on `.map-wrap` to `aria-busy` on `.content-area`
- **Files touched:**
  - `frontend/e2e/species-panel.spec.ts`
  - `frontend/e2e/deep-link.spec.ts`
  - `frontend/e2e/a11y.spec.ts`
  - `frontend/e2e/axe.spec.ts`
  - `frontend/e2e/prod-smoke.preview.spec.ts`
  - `frontend/e2e/error-states.spec.ts`
  - `frontend/e2e/history-nav.spec.ts`
  - `frontend/e2e/pages/*.ts` (Page Object Model — update `waitForMapLoad()` to `waitForRenderComplete()`)
- **Acceptance criteria:**
  - All surviving e2e specs pass: `error-states`, `filters`, `history-nav`, `species-panel`, `deep-link`, `a11y`, `axe`, `prod-smoke.preview`
  - No spec uses `[data-region-id]` or `.region-expanded`
  - `npm run test:e2e` exits 0
  - `axe.spec.ts` WCAG scans still pass
- **Depends on:** Issue 3 (deleted specs gone), Issue 5 (`[data-render-complete]` signal must exist)
- **Blocks:** Issue 10 (new happy-path spec)
- **Approx. PR size:** M
- **Existing GH issue match:** none

---

### Issue 5: Add `[data-render-complete]` readiness gate to App.tsx and update SpeciesPanel layout

- **Label:** `agent-ready`
- **Type:** `refactor(frontend)`
- **Scope:**
  - Add `data-render-complete` attribute to the `.content-area` element in `App.tsx` once the first successful data fetch completes (mirrors the old `[data-region-id]` count=9 pattern but is surface-agnostic)
  - Rework `SpeciesPanel` CSS layout in `styles.css` (lines 94–100): replace `position: fixed` with a layout strategy appropriate to a non-map context (e.g., `position: fixed` can remain but z-index and right-offset must be validated against the new content area)
  - Add `aria-busy` attribute handling to `.content-area` to replace the removed `.map-wrap[aria-busy]`
- **Files touched:**
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css` (`.species-panel` block, lines 94–171)
- **Acceptance criteria:**
  - `document.querySelector('[data-render-complete]')` resolves once data loads successfully
  - `SpeciesPanel` renders without overlapping the filters bar or creating a dead zone in the content area — confirmed via screenshot
  - `aria-busy` transitions correctly on loading/loaded/error states
  - `npm run typecheck && npm run test` green
  - PR screenshots show panel open state alongside content area (required — UI PR)
- **Depends on:** Issue 3 (map block removed, slot exists)
- **Blocks:** Issue 4 (e2e gate depends on this attribute)
- **Approx. PR size:** S
- **Existing GH issue match:** none

---

### Issue 6: Build the ObservationFeed component (reverse-chronological feed surface)

- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - New `frontend/src/components/ObservationFeed.tsx`: renders `observations` prop as a reverse-chronological list (server already orders by `obs_dt DESC`)
  - Each row surfaces: `comName` (species common name), `obsDt` (formatted relative timestamp), `locName` (hotspot name), `howMany` (individual count, null-safe), row-level `isNotable` badge
  - Clicking a row sets `?species=` in URL state to open SpeciesPanel
  - `aria-label` on the list element; each row is keyboard-focusable
  - Mount in `App.tsx` inside `.content-area`
- **Files touched:**
  - `frontend/src/components/ObservationFeed.tsx` (new)
  - `frontend/src/components/ObservationFeed.test.tsx` (new)
  - `frontend/src/styles.css` (feed layout rules)
  - `frontend/src/App.tsx` (mount ObservationFeed)
- **Acceptance criteria:**
  - Feed renders observations in descending `obsDt` order
  - `obsDt`, `locName`, `howMany`, `isNotable` all visible per row
  - Clicking a row opens SpeciesPanel with correct species
  - `?notable=true` filter correctly filters the feed (via existing `use-bird-data` filter pass-through)
  - No row uses `observation.lat` or `observation.lng` in display (those are reserved for Issue 11)
  - RTL unit tests cover: empty state, loading state, single row rendering, notable badge visibility, row click sets URL
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR) — feed in default state and notable-filtered state
- **Depends on:** Issue 3 (content-area slot), Issue 1 (gzip — mobile viability)
- **Blocks:** Issue 10 (happy-path e2e spec can now target the feed)
- **Approx. PR size:** M
- **Existing GH issue match:** none

---

### Issue 7: Build the HotspotList component (freshness + richness sort)

- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - New `frontend/src/components/HotspotList.tsx`: renders hotspots sorted by `latestObsDt` DESC (freshness) with `numSpeciesAlltime` as secondary sort
  - Each row: `locName`, `latestObsDt` (relative time), `numSpeciesAlltime` count chip
  - `ApiClient.getHotspots()` is already implemented — re-enable the `getHotspots()` call in `use-bird-data.ts` (or add a separate hook) for this surface only
  - Clicking a row sets a `?hotspot=locId` URL param (new param — does not collide with KEEP params)
- **Files touched:**
  - `frontend/src/components/HotspotList.tsx` (new)
  - `frontend/src/components/HotspotList.test.tsx` (new)
  - `frontend/src/data/use-bird-data.ts` (re-enable `getHotspots()` call or add `useHotspots` hook)
  - `frontend/src/state/url-state.ts` (add `hotspotId` param)
  - `frontend/src/styles.css` (hotspot list layout)
  - `frontend/src/App.tsx` (mount HotspotList alongside ObservationFeed, or as tab)
- **Acceptance criteria:**
  - Hotspot list renders with `latestObsDt` and `numSpeciesAlltime` per row
  - List sorted freshest-first
  - Stale hotspots (no recent observations) visually de-emphasized
  - RTL unit tests cover: sort order, empty state, row click sets URL
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR)
- **Depends on:** Issue 3 (content-area slot), Issue 2 (`use-bird-data` trimmed cleanly so hotspot re-add is deliberate)
- **Blocks:** nothing critical
- **Approx. PR size:** M
- **Existing GH issue match:** none

---

### Issue 8: Build the SpeciesSearch autocomplete surface (species-first entry path)

- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - Promote `FiltersBar`'s species datalist input to a more prominent search-first entrypoint, or add a dedicated `SpeciesSearch` component above the feed
  - The species input already uses `deriveSpeciesIndex` — the autocomplete data is available
  - On selection, sets `?species=` and opens `SpeciesPanel` (existing deep-link contract preserved)
  - `taxonOrder` from `ObservationMeta` used to sort autocomplete options taxonomically (null-safe: fall back to alphabetical)
  - Family-grouped autocomplete list (`optgroup` by family)
- **Files touched:**
  - `frontend/src/components/SpeciesSearch.tsx` (new, or modify `FiltersBar.tsx`)
  - `frontend/src/components/SpeciesSearch.test.tsx` (new)
  - `frontend/src/derived.ts` (update `deriveSpeciesIndex` to include `taxonOrder` and `familyName` for grouping)
  - `frontend/src/styles.css`
  - `frontend/src/App.tsx` (mount)
- **Acceptance criteria:**
  - Typing 3+ characters shows matching species with family grouping
  - Selecting a species opens `SpeciesPanel` with correct content
  - `taxonOrder` used for sort where non-null; alphabetical fallback for nulls
  - Deep-link `?species=vermfly` opens panel on cold load (existing spec in `species-panel.spec.ts` must still pass)
  - RTL unit tests cover: option grouping, null `taxonOrder` fallback, selection sets URL
  - PR screenshots required (UI PR)
- **Depends on:** Issue 3 (content-area slot), Issue 5 (SpeciesPanel layout rework)
- **Blocks:** nothing critical
- **Approx. PR size:** M
- **Existing GH issue match:** none

---

### Issue 9: Implement `?region=` URL migration (silent-drop with soft warning)

- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - In `url-state.ts`, detect an incoming `?region=` param on page load
  - If present, display a one-time dismissible banner: "The region view has been replaced. Use the Filters bar to filter by family or species." Remove `?region=` from the URL via `replaceState` without navigating
  - Banner is dismissible (ESC or close button); does not block the feed
  - After dismiss, `?region=` is gone from the URL and the warning does not re-appear on refresh
- **Files touched:**
  - `frontend/src/state/url-state.ts`
  - `frontend/src/components/MigrationBanner.tsx` (new)
  - `frontend/src/components/MigrationBanner.test.tsx` (new)
  - `frontend/src/styles.css`
  - `frontend/src/App.tsx` (conditionally render banner)
- **Acceptance criteria:**
  - Navigating to `/?region=sky-islands-huachucas` shows the migration banner
  - URL is rewritten to `/` (no `?region=`) immediately
  - Dismissing the banner hides it and does not re-appear on refresh
  - Navigating without `?region=` shows no banner
  - Axe scan passes with banner visible
  - RTL unit tests cover: banner shown on region param, not shown without, dismiss clears URL
  - PR screenshots required (UI PR)
- **Depends on:** Issue 2 (`regionId` must be dropped from `url-state` type before this issue adds migration detection), Issue 3
- **Blocks:** nothing
- **Approx. PR size:** S
- **Existing GH issue match:** none (analysis open question I4 — pick: soft warning)

---

### Issue 10: Write the new happy-path e2e spec for Path A surfaces

- **Label:** `agent-ready`
- **Type:** `test(frontend)`
- **Scope:**
  - New `frontend/e2e/happy-path.spec.ts` (replaces the DISCARD spec of the same name)
  - Covers: feed renders observations on load, filters update feed, species search opens panel, hotspot list visible, `?region=` migration banner shows and dismisses, deep-link `?species=` cold-loads panel
  - Uses `[data-render-complete]` readiness gate (not `[data-region-id]`)
  - No map, no `[data-region-id]`, no SVG assertions
- **Files touched:**
  - `frontend/e2e/happy-path.spec.ts` (new)
- **Acceptance criteria:**
  - All tests in the new spec pass with `npm run test:e2e`
  - Covers at minimum: feed default load, notable filter, species search → panel open, `?region=` banner
  - No `test.fail()` in the file
  - Spec respects `workers: 2`, `fullyParallel: true`, `retries: 0` per `playwright.config.ts`
  - No DB writes (grep check per CLAUDE.md convention)
- **Depends on:** Issues 4, 5, 6, 7, 8, 9 (all surfaces must exist for the happy path to be testable)
- **Blocks:** nothing
- **Approx. PR size:** S
- **Existing GH issue match:** none

---

### Issue 11: Integrate latent fields — `obsDt`, `isNotable` (row-level), `locName`/`howMany` as first-class display

- **Label:** `agent-ready`
- **Type:** `feat(frontend)`
- **Scope:**
  - Audit the `ObservationFeed` component (Issue 6) to confirm all three fields are rendered and tested
  - Add relative-time formatting helper for `obsDt` (e.g., "2 hours ago", "yesterday") with a unit test
  - Ensure `isNotable` per-row styling is distinct from the `?notable=true` global filter — row-level badge persists even when global filter is off
  - Null-safe `howMany`: display "—" when null, not 0
  - Document the 3-of-5 latent fields shipped in release 1 vs deferred (`observation.lat/lng`, `taxonOrder` beyond sort-order) in a code comment in `ObservationFeed.tsx`
- **Files touched:**
  - `frontend/src/components/ObservationFeed.tsx`
  - `frontend/src/components/ObservationFeed.test.tsx`
  - `frontend/src/utils/format-time.ts` (new helper)
  - `frontend/src/utils/format-time.test.ts` (new)
- **Acceptance criteria:**
  - `obsDt` renders as relative time (not ISO string)
  - `isNotable` row badge visible regardless of global `?notable` filter state
  - `howMany: null` renders as "—", not "0" or blank
  - `npm run typecheck && npm run test` green
  - PR screenshots required (UI PR) — showing the three fields in a feed row
- **Depends on:** Issue 6 (ObservationFeed must exist)
- **Blocks:** nothing
- **Approx. PR size:** S
- **Existing GH issue match:** relates to #57 (familyCode) but does not resolve it — noted in PR body

---

### Issue 12: Fix the ingestor stall (operational — parallel concern)

- **Label:** `agent-ready`
- **Type:** `fix(ingestor)`
- **Scope:**
  - Diagnose the 52+ hour ingestor stall documented in Iterator 2 (`?since=1d` returning `[]`, `/api/hotspots` returning `[]`)
  - Identify whether the Cloud Run job failed, the eBird API key expired, or a schema migration broke the ingest path
  - Fix the root cause and verify fresh observations appear at `api.bird-maps.com/api/observations?since=1d`
- **Files touched:** `services/ingestor/src/**` (depends on root cause)
- **Acceptance criteria:**
  - `GET api.bird-maps.com/api/observations?since=1d` returns non-empty array with `obsDt` within the last 24 hours
  - `GET api.bird-maps.com/api/hotspots` returns non-empty array
  - Ingestor Cloud Run job shows green in GCP console
  - No change to API contract
- **Depends on:** nothing (parallel to frontend work)
- **Blocks:** Issue 1 (gzip size measurements should be taken at healthy ingest volume); does not strictly block Issue 6 but feed will appear empty without it
- **Approx. PR size:** S (scope TBD until root cause known)
- **Existing GH issue match:** none (documented in Iterator 2 as operational concern)

---

### Issue 13: Update `CLAUDE.md` — add mandatory prototype gate convention

- **Label:** `agent-ready`
- **Type:** `docs:`
- **Scope:**
  - Add a "Prototype gate" section to `CLAUDE.md` under a new `## Before authoring a plan` heading
  - Convention text: before any plan body is committed, render N representative data rows (suggest ≥ 344, sizing to healthy ingest estimate) at mobile (390×844) and desktop (1440×900) dimensions in the candidate rendering approach, confirm no correctness mechanisms beyond what is specified are required
  - Note applies to any rendering approach: feed virtualization, marker clustering, SVG — not SVG-specific
  - Update the opening paragraph (supersedes #103) to reflect that code now exists
- **Files touched:**
  - `CLAUDE.md`
- **Acceptance criteria:**
  - Prototype gate section exists in `CLAUDE.md` with mobile + desktop dimension callouts
  - Opening paragraph no longer says "planning artifacts only"
  - #103 can be closed (reference in PR body)
  - `npm run build` unaffected (docs-only change)
- **Depends on:** nothing (can run in parallel)
- **Blocks:** nothing
- **Approx. PR size:** XS
- **Existing GH issue match:** #103 (stale opening paragraph — this supersedes it)

---

### Issue 14: Triage `parent_id` column and SVG-driven migrations for future removal

- **Label:** `needs-scoping`
- **Type:** `chore`
- **Scope:**
  - Audit whether `parent_id` on the `regions` table and migrations `1700000011000_fix_region_boundaries.sql`, `1700000012000_fix_sky_islands_boundaries.sql` are safe to remove now that SVG is retired
  - Determine if any read-API query still uses `parent_id` for sort or grouping
  - If safe: author down-migrations to remove the column and revert the vertex clamping (node-pg-migrate `-- Down Migration` pattern)
  - If `regions` table is no longer queried at all after the hotspot-list surface lands, consider whether `getRegions()` and the `/api/regions` endpoint should be deprecated
- **Files touched (if executed):**
  - `migrations/` (new down-migration file)
  - `services/read-api/src/regions.ts` (potentially delete or deprecate)
  - `services/read-api/src/app.ts` (remove `/api/regions` route if deprecated)
- **Acceptance criteria (for the scoping issue):**
  - Decision documented: remove vs. retain `parent_id` with rationale
  - If removed: down-migration authored and tested via testcontainers
  - If retained: issue closed with explanation
- **Depends on:** Issue 7 (HotspotList — confirm whether regions endpoint is still needed for any surface)
- **Blocks:** nothing (cleanup, not feature work)
- **Approx. PR size:** S (if executed after scoping)
- **Existing GH issue match:** none

---

## Dependency Graph

```
                     [Issue 12: fix ingestor] ─────────────────────┐
                     [Issue 13: CLAUDE.md gate]                     │
                                                                     │
[Issue 1: gzip] ─────────────────────────────────────────┐          │
                                                          │          │
[Issue 2: url-state/hook refactor] ─────┐                │          │
                                        │                │          │
                               [Issue 3: deletion wave]  │          │
                                        │                │          │
               ┌────────────────────────┼──────────────┐ │          │
               │                        │              │ │          │
          [Issue 5:              [Issue 4: e2e    [Issue 9:         │
          render-gate +           refactor]       ?region=          │
          panel layout]               │           migration]        │
               │                      │                             │
    ┌──────────┼──────────┐            │                            │
    │          │          │            │                            │
[Issue 6:  [Issue 7:  [Issue 8:        │                            │
ObsFeed]  HotspotList] SpecSearch]     │                            │
    │          │          │            │                            │
    └──────────┴──────────┴────────────┘                            │
                          │                                          │
                   [Issue 10: happy-path e2e]                       │
                          │                                          │
                   [Issue 11: latent fields] ◄───────────────────────┘
                          │
                   [Issue 14: DB cleanup] (needs-scoping)
```

**Critical path (longest dependency chain):**

Issue 2 → Issue 3 → Issue 5 → Issue 6 → Issue 11 → Issue 14

This chain is 6 issues deep and determines the earliest date the full release-1 latent field integration is shipped. Every step except Issue 14 is `agent-ready`.

---

## Week-1 Slice (Issues 1–5)

These five issues are the foundation layer. They produce no new user-visible features but create the clean slate required for feature work. An agent or Julian can execute all five in week 1; Issues 1 and 13 can run in parallel with Issues 2–5.

| # | Title | Size | Parallel with |
|---|---|---|---|
| 1 | Enable gzip on Read API | XS | 2, 13 |
| 2 | Refactor url-state / use-bird-data | S | 1, 13 |
| 13 | CLAUDE.md prototype gate | XS | 1, 2 |
| 3 | Deletion wave | L | (after 2) |
| 5 | Render gate + SpeciesPanel layout | S | (after 3) |

Also recommended in week 1, in parallel: Issue 12 (ingestor fix) — it is independent of all frontend work and unblocks meaningful feed data.

After week 1 the codebase is: clean (no SVG imports), typecheck-passing, test-passing at unit level, with an empty content area and a working readiness gate.

---

## Week-2 Slice (Issues 4, 6, 7, 8, 9)

These five issues build the three primary surfaces and complete the e2e migration. They can partially parallelize: Issues 6, 7, and 8 are independent of each other once Issue 3 is landed.

| # | Title | Size | Parallel with |
|---|---|---|---|
| 4 | E2E refactor (REFACTOR specs) | M | 6, 7, 8 |
| 6 | ObservationFeed | M | 7, 8 |
| 7 | HotspotList | M | 6, 8 |
| 8 | SpeciesSearch autocomplete | M | 6, 7 |
| 9 | `?region=` migration banner | S | 6, 7, 8 |

After week 2 the three surfaces are live, filters wire correctly to the feed, and the e2e suite runs green. Issue 12 (ingestor) should ideally be resolved before week 2 ends so the feed shows real data.

---

## Post-week-2 (Issues 10, 11, 14)

These close out the release by writing the new happy-path spec, hardening latent field display, and scoping the DB cleanup. They are the lowest-risk issues in the list — purely additive or scoping work.

| # | Title | Size | Notes |
|---|---|---|---|
| 10 | New happy-path e2e | S | All surfaces must exist |
| 11 | Latent fields audit + formatting | S | Confirm 3-of-5 shipped |
| 14 | DB cleanup scoping | S | `needs-scoping` — may produce follow-on issue |

---

## Coverage of Risk / Opportunity Inventory

| Analysis item | Addressed by |
|---|---|
| R1 Rendering churn escalates | Issue 3 (deletion wave) — hard stop on SVG PR churn |
| R2 Ingestor stall masks volume | Issue 12 (fix ingestor); Issue 1 (gzip for volume headroom) |
| R3 Reimagining recreates taxonomy problem | Issue 6 (feed avoids equal-weight region tiles); Issue 7 (hotspot list grounded in lat/lng freshness) |
| R4 SpeciesPanel layout breaks | Issue 5 (explicit layout rework) |
| R5 `?region=` breaks bookmarks | Issue 9 (soft warning + URL rewrite) |
| R6 Path C ceiling vs Path A rubric | Out of scope for this plan — Path B/C is a future phase; Issue 14 leaves the door open |
| R7 "Ditch map" misread | Julian has chosen Path A — Path B explicitly deferred, not foreclosed |
| R8 No CDN/gzip | Issue 1 |
| R9 Species-dedup semantics | Issue 11 comment documenting 3-of-5 fields shipped; abundance-over-time is out of scope |
| R10 Process failure repeats | Issue 13 (prototype gate in CLAUDE.md) |
| O1 Resurrect `obsDt` | Issue 6 (feed), Issue 11 (formatting) |
| O3 Resurrect `locName`/`howMany` | Issue 6 (feed), Issue 11 (null-safe) |
| O4 Resurrect row-level `isNotable` | Issue 6 (feed), Issue 11 (distinct from filter badge) |
| O6 Gzip | Issue 1 |
| O7 Prototype gate | Issue 13 |
| O11 `layoutBadges` portable concept | Not extracted — dropped with DISCARD; re-implement if needed in a future grouping surface |

**Deferred (not in release 1):**
- O2 Resurrect `lat/lng` — Path B territory, future phase
- O5 `taxonOrder`/`familyCode` beyond sort use — Issue 8 uses `taxonOrder` for autocomplete sort; `familyCode` coupling (#57) is not resolved here

---

*End of sequencing plan.*
