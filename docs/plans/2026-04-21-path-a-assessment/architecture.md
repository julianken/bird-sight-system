# Path A Architecture Blueprint

**Status:** Architecture specification (not design proposal, not implementation plan). Feeds GitHub-issue authoring.
**Inputs:** Phase 4 unified report; Phase 2 Iterator 1 Path A surfaces; Phase 1 Area 5 salvage manifest; Phase 2 Iterator 3 concept salvage. Source files read from `frontend/src/**` and `packages/shared-types/src/index.ts`.
**Out of scope:** visual styling, library picks, color/typography. Structural decisions only.

---

## 1. Top-level composition

The current `App.tsx:77-89` wraps `<Map>` in a `<div className="map-wrap">` between `FiltersBar` (line 68-76) and `SpeciesPanel` (line 94-98). That wrapper, plus the `<Map>` inside it, is the seam.

**Recommendation: single-page with surface-toggle, no React Router introduction.**

Path A surfaces all share the same backend contract (`/api/observations`, `/api/hotspots`, `/api/species/:code`) and the same filter state (`since`, `notable`, `species`, `family`). Routing would split this into three route components that each re-read the same URL state and re-decide when to refetch — duplicating what `useBirdData` already does once. A single `<main>` region that renders exactly one of three surface components keyed off a `view` URL param keeps `useUrlState` + `useBirdData` as the single source of truth and defers the React Router dependency introduction until a genuine route-per-page use case appears.

**Trade-off:** A route-based split would give better back-button granularity when switching surfaces (each surface becomes its own history entry). The surface-toggle approach relies on `useUrlState` already participating in history via `?view=`, which is cheaper. Back-compat for `?region=` is simpler without a router (see §9).

---

## 2. The three surfaces — concrete shape

### 2.1 Feed surface (reverse-chron observation feed)

Serves T1 (notable now), T7 (what's new), T3 secondary.

| Aspect | Decision |
|---|---|
| Row unit | One `Observation` record per row. Flat, no grouping in release 1. |
| Order | Server-provided `obsDt DESC` (already the server's sort per Phase 1 Area 4 / `services/read-api` route). Client preserves array order as delivered. |
| Fields shown per row | `comName`, `obsDt` (formatted), `locName`, `howMany`, `isNotable` (badge/flag), species code as the interactive anchor |
| Fields dropped | `subId` (deferred — see §11), `lat`/`lng` (no geographic display in Path A), `silhouetteId` (colour-by-family is visual styling, out of scope) |
| Filter relationship | Feed reacts to the shared `FiltersBar` state. No per-surface filters. Selecting `?species=` or `?family=` narrows the feed via the same `useBirdData` call. |
| Loading state | `aria-busy` on the feed container (mirrors current `map-wrap` `aria-busy={loading}` contract at `App.tsx:77`) |
| Empty state | Dedicated empty message when `observations.length === 0` (separate from error screen). Must distinguish "no results for these filters" from "ingestor stall." |

**Grouping by date** (visual section headers for "Today", "Yesterday", "This week") is structural — not styling — but still deferred to release 2 because it requires a client-side date-bucket step that would add `date-fns`-class dependencies.

### 2.2 Species search surface

Serves T3 (tell me more), T4 partial (family-scoped search).

| Aspect | Decision |
|---|---|
| Autocomplete location | Dedicated input in the species search surface, not in `FiltersBar`. The `FiltersBar` species input is a **filter** (narrows the observation set); the search surface input is **navigation** (opens the panel). These semantics conflict and should live in separate controls. |
| Autocomplete data source | `deriveSpeciesIndex(observations)` (already in `derived.ts`). Same input the existing `FiltersBar.tsx:93-97` datalist uses. |
| Hand-off to `SpeciesPanel` | Selecting a species from the autocomplete calls `set({ speciesCode: code })` — the same contract `App.tsx:85` uses. `SpeciesPanel` reads `speciesCode` from URL and mounts. |
| Recent sightings list (per-species) | When `?species=` is set, the surface also renders a secondary list of that species's observations from the already-loaded `observations` array (filtered client-side by `speciesCode`). Uses the same row shape as the feed surface. |
| Empty state | Prompt to type in the search box when `speciesCode === null`. |

**Why not replace the `FiltersBar` species input:** The filter input is wired into the URL contract (`?species=`) as a filter across all surfaces. Removing it would break deep-links. The search surface is an additional access path, not a replacement.

### 2.3 Hotspot list surface

Serves T5 (where to go), T6 partial (diversity at a glance via ranking).

| Aspect | Decision |
|---|---|
| Row unit | One `Hotspot` record per row |
| Fields shown per row | `locName`, `numSpeciesAlltime`, `latestObsDt` (formatted as relative time: "2 hours ago") |
| Default sort | `latestObsDt DESC` (most recently active first) — the freshness signal Iterator 1 Finding 3 names as the Path A primary signal |
| Available sorts | `latestObsDt DESC` (default, "recently active"), `numSpeciesAlltime DESC` ("most diverse"), `numSpeciesAlltime ASC` ("rarity hunting" — per Iterator 1 Finding 3) |
| Filter relationship | Hotspot list is only lightly filter-reactive: `since` and `species` may narrow the list in future (observations joined to hotspots), but release 1 shows all hotspots regardless of observation filters. The hotspot endpoint is not species-filtered in the current API contract. |
| Selection | Clicking a hotspot row does **not** open `SpeciesPanel`. In release 1 hotspot rows are read-only. A future release can add drill-in. |

---

## 3. Component hierarchy

```
App.tsx (refactored)
├── FiltersBar.tsx (KEEP unchanged — see §7)
├── SurfaceNav.tsx (NEW) — toggle between feed / search / hotspots
├── <main data-render-complete={readinessSignal}> (see §8)
│   ├── FeedSurface.tsx (NEW) — when view === 'feed'
│   │   └── ObservationFeedRow.tsx (NEW) — repeated per observation
│   ├── SpeciesSearchSurface.tsx (NEW) — when view === 'species'
│   │   ├── SpeciesAutocomplete.tsx (NEW)
│   │   └── SpeciesRecentSightings.tsx (NEW — reuses ObservationFeedRow)
│   └── HotspotListSurface.tsx (NEW) — when view === 'hotspots'
│       ├── HotspotSortControls.tsx (NEW)
│       └── HotspotRow.tsx (NEW)
└── SpeciesPanel.tsx (REFACTOR layout — see §6)
```

**Files preserved unchanged (KEEP per Area 5):**

- `frontend/src/api/client.ts`
- `frontend/src/data/use-species-detail.ts`
- `frontend/src/derived.ts` (`deriveFamilies`, `deriveSpeciesIndex`)
- `frontend/src/components/FiltersBar.tsx`
- `frontend/src/components/SpeciesPanel.tsx` (component logic — CSS changes per §6)
- `frontend/src/main.tsx`, `vite-env.d.ts`, `test-setup.ts`

**Files refactored:**

- `frontend/src/App.tsx` — the seam (§10)
- `frontend/src/state/url-state.ts` — `regionId` repurposed or dropped, new `view` param added (§4, §9)
- `frontend/src/data/use-bird-data.ts` — `getRegions()` call becomes optional; `getHotspots()` call stays
- `frontend/src/styles.css` — ~60 LOC of map-defensive rules die (§10)

**Files discarded (map rendering chain, per Area 5):**

- `frontend/src/components/Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`
- `frontend/src/geo/path.ts`
- Their unit tests
- Their e2e specs (`badge-containment`, `cross-region-badge-containment`, `expand-cap`, `paint-order`, `sizing`, `stroke-scaling`, `region-collapse`, `happy-path`)

**JSX skeletons (props-level, no styling):**

```tsx
// ObservationFeedRow.tsx
export interface ObservationFeedRowProps {
  observation: Observation;  // from @bird-watch/shared-types
  onSelectSpecies: (code: string) => void;  // wires to set({ speciesCode })
}

// HotspotRow.tsx
export interface HotspotRowProps {
  hotspot: Hotspot;
}

// SurfaceNav.tsx
export interface SurfaceNavProps {
  activeView: 'feed' | 'species' | 'hotspots';
  onSelectView: (view: 'feed' | 'species' | 'hotspots') => void;
}

// SpeciesAutocomplete.tsx
export interface SpeciesAutocompleteProps {
  speciesIndex: SpeciesOption[];  // from derived.ts
  onSelectSpecies: (code: string) => void;
}

// HotspotSortControls.tsx
export interface HotspotSortControlsProps {
  sort: 'latest' | 'richness-desc' | 'richness-asc';
  onChange: (sort: 'latest' | 'richness-desc' | 'richness-asc') => void;
}
```

---

## 4. State flow

| State | Location | Change from today |
|---|---|---|
| `since` / `notable` / `species` / `family` | `useUrlState` (`url-state.ts`) — unchanged | KEEP |
| `view` (feed/search/hotspots) | `useUrlState` — new URL param `?view=` | NEW (added to `UrlState` interface) |
| `regionId` / `?region=` | See §9 — recommended: preserved as a back-compat no-op in URL parsing for one release, then dropped | REPURPOSED (parsed but not rendered) |
| `speciesCode` / `?species=` | `useUrlState` — unchanged | KEEP |
| Hotspot sort | Local component state inside `HotspotListSurface.tsx` | NEW — not URL-persisted in release 1 (deferred to §11) |
| Pagination / infinite-scroll cursor | **Not needed in release 1.** Iterator 2 measured 344 rows / 101 KB at `?since=14d` in the stall regime; healthy-ingest estimated 1,500–2,000 rows. Both are below any virtualisation threshold for a simple list. Deferred (§11). | N/A |

**New `UrlState` shape:**

```ts
export interface UrlState {
  view: 'feed' | 'species' | 'hotspots';  // NEW, default 'feed'
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
  // regionId intentionally removed from the state interface;
  // parsed-and-discarded in readUrl() for back-compat (see §9)
}
```

---

## 5. Data flow

### 5.1 Per-surface fetches

| Surface | Needs `getObservations()` | Needs `getHotspots()` | Needs `getRegions()` |
|---|---|---|---|
| Feed | Yes | No | No |
| Species search | Yes (for autocomplete + recent sightings) | No | No |
| Hotspot list | No | Yes | No |

**Implication for `use-bird-data.ts`:** `getRegions()` has no caller in Path A release 1. The Region type survives in `shared-types` for back-compat but the API call is dropped from the data hook. `getHotspots()` stays — fetched once at mount, no filter reactivity (the hotspot endpoint is unfiltered per the current contract).

Release 1 does not add a region-filter dropdown. The `family` filter uses the existing `deriveFamilies(observations)` client-side derivation (`derived.ts:16-24`). Adding a region filter would require keeping `getRegions()` alive — out of scope until there's a surface that benefits.

### 5.2 Latent fields (Phase 1 Finding F2 / Iterator 3 Concepts 18-22)

Five LATENT concepts are wire-present and frontend-absent. Mapping them to UI elements:

| Latent field | UI element in Path A | Surface |
|---|---|---|
| `Observation.obsDt` | Formatted relative timestamp in `ObservationFeedRow` | Feed + Species recent sightings |
| `Observation.lat`/`lng` | **Not used.** Path A is non-spatial. Deferred to Path B (§11). | — |
| `Observation.locName` | Rendered as plain text field in each row, adjacent to `comName` | Feed + Species recent sightings |
| `Observation.howMany` | Count indicator beside `comName` ("×3") when `howMany > 1` | Feed + Species recent sightings |
| `Observation.isNotable` | Visual flag/badge on the row (text indicator — styling deferred) | Feed |
| `SpeciesMeta.taxonOrder` | **Not used in release 1.** See §11 — deferred sort toggle | — |
| `SpeciesMeta.familyCode` | Already on wire; used by `deriveFamilies` today via the `silhouetteId` coupling (`derived.ts:4-15`). No new use in Path A release 1. | — |
| `Hotspot.latestObsDt` | Relative timestamp on hotspot row; drives the default sort | Hotspot list |

**Three latent fields selected for release 1 per Recommendation H6:** `obsDt`, `locName` + `howMany` (one concept-pair), and row-level `isNotable`. Rationale below in §11.

### 5.3 New endpoints

- **No new backend endpoint required for release 1.** Family filtering continues to use `deriveFamilies(observations)` — which only shows currently-loaded observation families (Area 4 Finding 5 / §7 gap).
- A stable `/api/families` endpoint (Area 4 Finding 5) would enable taxonomic browsing as a first-class surface. **Deferred to release 2** — not required for Path A surfaces as defined.

---

## 6. SpeciesPanel refactor

`styles.css:94-100` documents that `position: fixed` was chosen specifically to avoid reflowing the map. In Path A there is no map to reflow.

**Recommendation: preserve `position: fixed` for the right-docked layout. Change is a one-line CSS update, not an architectural rework.**

The existing panel CSS (`styles.css:101-114`: `top: 0; right: 0; width: 320px; height: 100vh`) gives the panel a consistent docked appearance that works equally well next to a map-wrap or next to a flex-column of surfaces. What the fixed positioning buys in the Path A context is that opening the panel does not reflow the feed — which matters because the feed is the primary entry surface and scroll position should be preserved.

**What changes:**
- No JSX change to `SpeciesPanel.tsx`.
- Remove the `styles.css:94-100` comment block (map-specific explanation).
- Mobile polish (panel covering the right portion on narrow viewports, noted in the same comment block) remains a deferred item — no worse than today.

**What stays exactly:**
- URL-driven open state (`?species=` trigger) — Iterator 3 Concept 7.
- Scoped ESC handler — `SpeciesPanel.tsx:34-45`.
- `aria-labelledby` + `sr-only` heading fallback — `SpeciesPanel.tsx:53, 88-90`.
- `useSpeciesDetail` hook — zero changes.

**Alternative considered and rejected:** inline detail panel (expand-in-row in the feed surface). Rejected because it would lose deep-linkability and force a rebuild of the strongest tested component in the repo. Preserving the fixed sidebar keeps `species-panel.spec.ts` and `deep-link.spec.ts` minimally changed.

---

## 7. FiltersBar

`FiltersBar.tsx` is KEEP-unchanged per Area 5. For Path A release 1 it survives exactly as it is:

- Remains at the top, above the surface region (preserving the current `App.tsx:68-76` placement).
- Four controls unchanged: time window, notable checkbox, family select, species search input.
- Filter reactivity continues through `useBirdData` — the feed surface and species search surface automatically narrow when any filter changes.
- `speciesDraft` local state + `commitSpeciesDraft` pattern (`FiltersBar.tsx:23-38`) unchanged.

**What does not get added to `FiltersBar` in release 1:**
- Location-name search (structural; would need a second text input and a new client-side filter step on `locName`).
- Taxonomic sort toggle (belongs to surfaces, not filters).
- View toggle (that's `SurfaceNav`, a sibling component).

**Deferred gap (Area 4 Finding 5):** the family dropdown reflects only currently-loaded observation families, not the full AZ family set. This is a pre-existing limitation independent of Path A and survives the transition. A `/api/families` endpoint would fix it; see §11.

---

## 8. Readiness gate

**Current signal (dies):** `[data-region-id]` count=9 on `<g>` elements inside the SVG. Cited in Iterator 3 Concept 15 and in four REFACTOR specs (`species-panel.spec.ts:26,67,90,103`, `deep-link.spec.ts:10,19,26,38,47`, `a11y.spec.ts:16`, `prod-smoke.preview.spec.ts:9-13`). The underlying discipline — emit a deterministic completion signal, consume it in tests — survives; the specific DOM fact must be replaced.

**Replacement signal:** `data-render-complete` attribute on the primary surface container (`<main data-render-complete>` or equivalent). Set to `"true"` when the current surface's primary data is loaded.

| Surface | Signal condition |
|---|---|
| Feed | `!loading && observations !== null` (empty array is still "complete") |
| Species search | `!loading && speciesIndex.length >= 0` (autocomplete populated) |
| Hotspot list | `!hotspotsLoading && hotspots !== null` |

**Implementation note:** the attribute is on a single stable element regardless of surface. `app.waitForMapLoad()` in the POM (`frontend/e2e/pages/app-page.ts:20-22`) renames to `app.waitForAppReady()` and reads the single attribute. No per-surface count assertions; this keeps the readiness gate decoupled from implementation details.

**What this does not mean:** it is not `aria-busy`. The `aria-busy` attribute remains on the content region (`App.tsx:77`) for the loading-overlay semantics. `data-render-complete` is a test-oriented signal orthogonal to a11y state.

---

## 9. URL contract

| Param | Current semantics | Path A semantics | Classification |
|---|---|---|---|
| `?since=` | Time window filter, values `1d`/`7d`/`14d`/`30d` | Unchanged | **Preserved unchanged** |
| `?notable=` | Notable-only filter gate, `true` or absent | Unchanged | **Preserved unchanged** |
| `?species=` | Filter + panel trigger | Filter + panel trigger (panel is reached from any surface) | **Preserved unchanged** |
| `?family=` | Filter | Unchanged | **Preserved unchanged** |
| `?region=` | Expands ecoregion in SVG map | **Parsed and discarded** for one release (silent no-op); panel still opens if `?species=` is also present | **Preserved with adjusted semantics (release 1), removal scheduled (release 2)** |
| `?view=` | — | `feed` / `species` / `hotspots`, default `feed` | **New** |

**Risk R5 — silent bookmark breakage — mitigation:** Existing shared URLs of the form `https://bird-maps.com/?region=sky-islands-huachucas&species=vermfly` land in Path A as: `view` defaults to `feed` (or is sniffed to `species` if `?species=` is set — see refinement below), `?region=` is parsed-and-ignored so no 404 or visible error, and `?species=` still opens `SpeciesPanel`. The user sees the feed with the species filter applied and the detail panel open — the least-surprise graceful degradation. This matches Area 5 §URL-State Contract's "readUrl ignores unknown params" baseline for the transition window.

**Refinement (recommended):** if `?species=` is set on cold load and `?view=` is absent, default `view` to `'species'` so the search surface opens with its autocomplete primed and the panel open — matches the bookmark's original intent (inspecting a species) more closely than landing on the feed.

**Release 2 cleanup:** drop `?region=` parsing entirely once telemetry shows the bookmark traffic has aged out (or a 2-week window has passed, whichever comes first). Julian's call — this is Open Question I4.

---

## 10. The seam

**`App.tsx` diff:**

**Delete (`App.tsx:77-89`):**
```tsx
<div className="map-wrap" aria-busy={loading}>
  <Map regions={...} observations={...} ... />
</div>
```

Plus `App.tsx:13-30` (`GENERIC_SILHOUETTE`, `silhouetteFor`) and `App.tsx:32-43` (`colorFor` + coupling comment) — both only used inside the deleted block.

Plus `App.tsx:5` (`import { Map }`) and `App.tsx:9` (`import { colorForFamily }`).

**Add:**
```tsx
<SurfaceNav
  activeView={state.view}
  onSelectView={view => set({ view, regionId: null })}
/>
<main data-render-complete={!loading ? 'true' : 'false'} aria-busy={loading}>
  {state.view === 'feed' && <FeedSurface observations={observations} onSelectSpecies={code => set({ speciesCode: code })} />}
  {state.view === 'species' && <SpeciesSearchSurface speciesIndex={speciesIndex} observations={observations} onSelectSpecies={code => set({ speciesCode: code })} />}
  {state.view === 'hotspots' && <HotspotListSurface hotspots={hotspots} />}
</main>
```

**Error-screen copy update (`App.tsx:57-64`):** "Couldn't load map data" becomes "Couldn't load bird data" (no more map).

**`styles.css` diff — rules that die (~60 LOC, per Area 5 §Styles):**

| LOC range | Rule | Reason |
|---|---|---|
| 9-12 | `.region { transform-origin: 0 0 }` comment block | SVG expand-transform contract |
| 13 | `.region` rule | Map-specific |
| 14-18 | `.region-expanded .region-shape` drop-shadow comment | SVG filter workaround |
| 19 | `.region-expanded .region-shape` rule | Map-specific |
| 20-27 | `vector-effect: non-scaling-stroke` comment | SVG-only workaround |
| 28-34 | The `vector-effect` selector group | SVG-only |
| 35-37 | `.badge-stack { transform: scale(1.5) }` tombstone comment | Historical SVG bug |
| 38-39 | `.badge { transition }`, `.badge-selected .badge-circle` | Badge SVG element state |
| 40-43 | `.badge-label paint-order` comment | SVG text workaround |
| 44-53 | `.badge-label` rule | SVG-only |
| 60-74 | `.map-wrap` rule + overflow comment | Map wrapper dies |
| 75 | `.bird-map` rule | SVG element sizing |

**Total CSS discarded:** ~60 LOC (Area 5: ~92 LOC map-specific styles; subtracting the `.species-panel` section which is KEEP and other incidental rules).

**Rules that stay:**
- `*`, `html`/`body`/`#root` globals (lines 1-7)
- `.app` outer shell (lines 55-59) — still valid for a flex column
- `.error-screen` (lines 76-80)
- `.filters-bar` + children (lines 82-92)
- All `.species-panel*` rules (lines 94-170) — layout rework happens in CSS only if desired, but §6 argues for preserving `position: fixed`

---

## 11. Out-of-scope for release 1

Five items explicitly deferred. Each is structurally sound and implementable; the rationale is scope containment for a first shippable slice.

| # | Deferred item | Why release 1 ships without it |
|---|---|---|
| 1 | **`subId` checklist grouping** (Iterator 3 Concept 21) | Flat reverse-chron is the simplest feed. Grouping adds a client-side reducer, a collapsible-group UI primitive, and edge cases for the empty `subId` rows. `subId` as a display feature deserves its own ticket once the flat feed is live and being used. |
| 2 | **Taxonomic sort toggle** (Iterator 3 Concept 22, `taxonOrder`) | Only affects species lists (autocomplete + future family-browse). `taxonOrder` has `null` values per the shared-types signature — the null-handling policy is Open Question I6 from the Phase 4 report and should be resolved before shipping the toggle. |
| 3 | **Infinite-scroll / pagination** | Iterator 2 measured 344 rows / 101 KB at `?since=14d`. Healthy-ingest inferred 1,500–2,000. A DOM of 2K list rows is under the virtualisation-matters threshold. Revisit if healthy-ingest pushes past 3K or if mobile perf suffers — but the data does not force it in release 1. |
| 4 | **Hotspot sort URL persistence** | Local component state is adequate for release 1. Promoting the sort to a URL param adds a fifth `UrlState` field and bookmarkability semantics that are not warranted until the feature is validated. |
| 5 | **`/api/families` stable taxonomy endpoint** (Area 4 Finding 5) | Path A surfaces work with `deriveFamilies(observations)`. The new endpoint only matters when family-browse becomes a first-class surface (a release-2 Path A extension or release-3 Path B drill-down). |

### Three of five latent fields chosen for release 1 (per Recommendation H6)

| Chosen | Field | Surface | Why |
|---|---|---|---|
| Yes | `obsDt` | Feed, species recent sightings | Cited by Phase 4 F1 as "the single most indefensible omission." Turns T7 from score 0 to score 2. Formatting is cheap. |
| Yes | `locName` + `howMany` (paired) | Feed, species recent sightings | Both render as plain text; adding one alone looks incomplete. Turns T2 from 0 toward 1 and adds abundance signal. |
| Yes | `isNotable` (row-level) | Feed | Already filter-gated today; row-level display is the visible payoff of the filter. One DOM node per row. |
| Deferred | `lat`/`lng` (observation) | — | Only matters if Path B geography returns. Pure waste of wiring effort in Path A until then. |
| Deferred | `taxonOrder` + `familyCode` | — | `taxonOrder` null-handling is an unresolved product question (Recommendation H6 explicitly flags). `familyCode` via the `silhouetteId` coupling is already indirectly used; promoting it to first-class is blocked on issue #57. |

---

## 12. Summary invariants

- **URL contract preservation:** four filter params survive byte-for-byte; `?species=` trigger for `SpeciesPanel` survives; `?region=` is parsed-and-ignored in release 1 for graceful bookmark degradation.
- **API client untouched:** `ApiClient` (`api/client.ts`) is KEEP. No new endpoints.
- **Accessibility baseline preserved:** `FiltersBar` aria-labels unchanged; `SpeciesPanel` aria-labelledby + sr-only heading unchanged; axe-clean status must hold (`axe.spec.ts` surfaces need equivalent coverage for the three new surfaces).
- **Test toolchain unchanged:** Vitest, Playwright, `@testcontainers/postgresql`, `test-setup.ts` all KEEP.
- **Render-complete signal discipline preserved:** the `[data-region-id]` count=9 DOM fact dies, replaced by `data-render-complete` on the surface container.
- **33% of production LOC still KEEP-unchanged after this refactor** (Phase 1 S1 fraction holds). The new surface components add net LOC but do not touch the KEEP inventory.

---

## GitHub issues this architecture feeds

Short titles with 1-sentence scope. Full issue bodies authored from this document in a follow-up pass.

1. **Introduce `?view=` URL param and SurfaceNav toggle** — Extend `UrlState` / `url-state.ts` with `view: 'feed'|'species'|'hotspots'` (default `feed`), add `SurfaceNav.tsx`, wire to `App.tsx`.
2. **Delete map rendering chain** — Remove `Map.tsx`, `Region.tsx`, `Badge.tsx`, `BadgeStack.tsx`, `HotspotDot.tsx`, `geo/path.ts` and associated unit tests + e2e specs; remove ~60 LOC from `styles.css` per §10.
3. **Build FeedSurface + ObservationFeedRow** — Flat reverse-chron list reading from `observations` with `obsDt`, `locName`, `howMany`, `isNotable`, `comName` per row; species-code click opens `SpeciesPanel`.
4. **Build SpeciesSearchSurface with autocomplete and recent sightings** — Navigation-style autocomplete sourced from `deriveSpeciesIndex`; renders current species's observations as a filtered list when `?species=` is set.
5. **Build HotspotListSurface with three-way sort** — Rows of `locName` + `numSpeciesAlltime` + `latestObsDt`; local sort state between `latest` / `richness-desc` / `richness-asc`, default `latest`.
6. **Replace render-readiness signal** — Swap `[data-region-id]` count=9 gate for `data-render-complete` attribute on surface container; update `app-page.ts` POM and all REFACTOR specs in Area 5.
7. **`?region=` back-compat: parse-and-discard** — Keep the param in `readUrl` for one release to avoid bookmark breakage; `UrlState` drops the field; optional sniff → `view='species'` if `?species=` is present on cold load.
8. **Drop `getRegions()` from `useBirdData`** — Path A surfaces do not consume regions; trim the parallel fetch and the associated state field.
9. **Error-screen copy and surface empty states** — Update "Couldn't load map data" to "Couldn't load bird data"; add distinct empty-state messaging per surface (no-results vs ingestor-stall).
10. **`SpeciesPanel` CSS tidy** — Remove map-specific comment block at `styles.css:94-100`; no component-level change.
11. **Surface-level axe scans** — Extend `axe.spec.ts` coverage to scan feed, species-search, and hotspots surfaces (WCAG 2.1 AA tag set unchanged); retire the region-expand axe test.
12. **Adjust `species-panel.spec.ts` + `deep-link.spec.ts` opening paths** — Replace map-click trigger with surface-click (or autocomplete-select) trigger; preserve URL round-trip and ESC behaviour assertions.
