# Investigation: Information Architecture, Navigation, and URL State

## Summary

The site has four surfaces (feed, map, species, detail) driven by a single `useUrlState` hook that uses `window.history.replaceState` exclusively — meaning browser back/forward navigation does NOT move between in-app surface transitions. The default front door is the feed surface (`?view=feed` when no params are present). The `detail` surface is reachable only through implicit transitions (clicking a row in feed, or committing a species in the SpeciesAutocomplete) — it is deliberately absent from the SurfaceNav tablist. FiltersBar filters are globally shared across all surfaces; no filter scoping occurs on surface switch. The most consequential IA constraint for a redesign is the replaceState architecture: it makes the browser back button unreliable as a "go back to feed" mechanism and imposes a structural ceiling on how deeply the site can support user mental models of navigation history.

## Key Findings

### Finding 1: All in-app navigation uses replaceState — back button does not traverse surface history

- **Evidence:** `url-state.ts:87` — `window.history.replaceState({}, '', newUrl)` is the only history mutation in `writeUrl()`. `window.history.pushState` does not appear anywhere in the file. The `popstate` listener at `url-state.ts:97–101` handles back/forward, but since all surface transitions replace (not push) history entries, the only popstate events that fire are those triggered by the browser loading a truly different page.
- **Confidence:** High — confirmed by direct source read; no other file mutates history.
- **Implication:** Users cannot use the browser back button to return from `detail` → `species` or `detail` → `feed` after clicking a species row. The app behaves like a single-page state machine, not a navigable history. This is a significant UX constraint the redesign must either accept and design around (e.g., with explicit "Back" affordances) or change at the URL-state layer. Any redesign that relies on back-navigation convention will need `pushState` to be introduced — a code change, not just a visual change.

### Finding 2: The `detail` surface is orphaned from the SurfaceNav — no tab represents it

- **Evidence:** `SurfaceNav.tsx:22–26` — the TABS array contains exactly `['feed', 'species', 'map']`. `'detail'` is not present. `App.tsx:213–218` renders `SpeciesDetailSurface` only when `state.view === 'detail' && state.detail`. `SpeciesDetailSurface.tsx:112–118` documents: "No ESC dismiss, no overlay, no close button — the user navigates away via the browser back button or SurfaceNav."
- **Confidence:** High — TABS is a readonly array with explicit values; detail is simply not in it.
- **Implication:** When a user enters the detail view, all three SurfaceNav tabs show as inactive (none is `aria-selected=true`) because `anyTabActive` at `SurfaceNav.tsx:76` is false when `state.view === 'detail'`. This is a visible IA seam: the current surface has no tab representation. A redesign must decide whether detail is a fourth tab, a sub-route of species, an overlay/sheet, or remains a tabless in-place surface. Since detail is also the only surface where `SurfaceNav.tsx:76–82` enters the "no active tab" state, the current UI silently signals to users that they've left the navigable space.

### Finding 3: FiltersBar filters are global across all surfaces — no per-surface scoping

- **Evidence:** `App.tsx:24–29` — `useBirdData` is called once at the App level with all filter values from `state.since`, `state.notable`, `state.speciesCode`, `state.familyCode`. This single `observations` array is then passed to all surface components. `App.tsx:156–164` — FiltersBar receives `onChange={set}`, the same setter that drives URL state. `App.tsx:181–219` — all four surfaces receive the same pre-filtered observations prop.
- **Confidence:** High — single data fetch at App level; no surface fetches its own data independently.
- **Implication:** Changing the Family filter on the map surface affects what rows appear in the feed and species surfaces. Applying a species filter via FiltersBar while on the map view narrows the map markers. This global coupling is powerful (shared deep-link URLs encode all context) but cognitively unexpected (users typically expect tab-switching to reset per-tab state). The redesign must communicate clearly that filters are session-global. Any visual design that frames filters as "this surface's controls" will be misleading.

### Finding 4: URL state is fully shareable and survives page refresh — with one non-obvious exception for the `view` param

- **Evidence:** `url-state.ts:71–89` — `writeUrl` serializes all non-default state to query params: `?species=`, `?family=`, `?since=`, `?notable=true`, `?detail=`, `?view=`. Default values are omitted to keep URLs clean. `url-state.ts:81` — `?view=` is emitted even when the view is the default `'feed'` IF `speciesCode` or `detail` is also set, to prevent `readUrl`'s sniff logic from misreading the state on reload.
- **Confidence:** High — confirmed by reading both readUrl and writeUrl in full.
- **Implication:** Any URL a user copies from the address bar is a valid deep-link that restores full state including active surface, filters, and species/family selection. This is a genuine strength the redesign must preserve. The subtle wrinkle is that `since=14d` (the default) is never emitted, so a user who sees "14 days" in the UI and copies the URL gets a URL without `?since=` — which correctly restores to 14d on reload. A designer adding a "share this view" button does not need special handling — the URL is always canonical.

### Finding 5: The front door (`https://bird-maps.com/`) renders the feed surface, not the map

- **Evidence:** `url-state.ts:15–22` — `DEFAULTS.view = 'feed'`. `url-state.ts:56–59` — when no `?view=`, `?species=`, or `?detail=` param is present, `view` resolves to `DEFAULTS.view` = `'feed'`. `App.tsx:181–188` — `state.view === 'feed'` renders `FeedSurface`.
- **Confidence:** High — default constant is unambiguous.
- **Implication:** The screenshots confirm this (local/desktop/02-feed.png shows the feed as the initial state). The map is the most visually distinctive surface (local/desktop/01-map-default.png) but is not the front door — users must click the Map tab to reach it. This is a deliberate IA choice (chronological feed as entry point) but may conflict with user expectation for a "bird maps" site. A redesign that wants the map as the front door would only need to change `DEFAULTS.view` — a one-line code change — but the IA implications (map without context = high cognitive load) are a design decision, not a code one.

### Finding 6: The SpeciesAutocomplete (species surface) and the FiltersBar species input are distinct, parallel entry points to different destinations

- **Evidence:** `SpeciesSearchSurface.tsx:25–30` documents the distinction explicitly: FiltersBar's species input narrows the observation set in-place (user stays on feed); SpeciesAutocomplete is NAVIGATION (commits `?detail=` + `?view=detail`). `App.tsx:101–104` — `onSelectSpecies` calls `set({ detail: speciesCode, view: 'detail' })`. `SpeciesSearchSurface.tsx:75–79` — the row `onSelectSpecies` within the species surface is a deliberate no-op (ROW_NOOP) to prevent re-navigation when the detail panel is already open.
- **Confidence:** High — two code paths, two different state mutations, both confirmed in source.
- **Implication:** The site has two "species input" controls that look superficially similar but behave very differently. This is a known IA duality that a redesign must either unify (single species entry point) or differentiate more clearly (distinct visual language for filter vs. navigation). The current design relies on surface context to carry this distinction — the FiltersBar input says "Species" with a text field; the SpeciesAutocomplete says "Start typing a species…" — but on mobile, where both inputs appear close together, the distinction collapses.

### Finding 7: FamilyLegend is a secondary navigation entry point that writes to global filter state — from within the map surface

- **Evidence:** `FamilyLegend.tsx:195` — clicking a family entry calls `onFamilyToggle(entry.familyCode)`. `App.tsx:91–96` — `onFamilyToggle` calls `set({ familyCode: ... })` which updates URL state globally. `FiltersBar.tsx:89–99` — the Family `<select>` also writes `familyCode` to the same URL state. The FamilyLegend is only rendered within `MapSurface.tsx:173–179` — it is map-surface exclusive.
- **Confidence:** High — prop chain confirmed end-to-end.
- **Implication:** The FamilyLegend acts as a map-embedded filter control whose effects persist across surface switches. If a user clicks "Cardinals & Allies" in the legend and then switches to Feed, the feed will show only Cardinal-family observations. There is no visual cue at the SurfaceNav level or FiltersBar level that a family filter is active when arriving from the legend (except the Family dropdown in FiltersBar updates reactively). A redesign should make filter-active state more prominent at the global chrome level to prevent user confusion about why the feed is filtered.

### Finding 8: The `?view=hotspots` compatibility shim silently redirects to `?view=map`

- **Evidence:** `url-state.ts:42–50` — if `rawView === 'hotspots'`, the code sets `view = 'map'` and calls `window.history.replaceState` to update the URL bar to `?view=map`. This is a one-way migration — old bookmarks are silently upgraded.
- **Confidence:** High — explicit branch in readUrl.
- **Implication:** There was at least one prior navigation state (`hotspots`) that has been retired. Bookmarks or shared links using `?view=hotspots` still resolve correctly. A redesign does not need to carry this shim forward if the URL-state layer is restructured, but any migration should account for existing shared links.

### Finding 9: AttributionModal is reachable from every surface via the footer Credits link — it is not an IA surface but a persistent footer affordance

- **Evidence:** `App.tsx:233–256` — `<AttributionModal>` is mounted in `<footer role="contentinfo" className="app-footer">`, which is always rendered regardless of `state.view`. Screenshots confirm: `local/desktop/02-feed.png`, `local/desktop/03-species-search.png`, `local/mobile/04-species-detail.png` all show "Credits" at the bottom.
- **Confidence:** High — footer is outside the `state.view` conditional blocks.
- **Implication:** Attribution is a persistent affordance, not a view. It overlays the current surface as a modal (inferred from the screenshot `local/desktop/05-attribution-modal.png` which shows the map beneath it). The redesign can treat attribution as chrome (always available, low hierarchy) rather than as a surface. Its current trigger label "Credits" is minimal — a redesign might expose it more prominently if attribution is part of brand voice.

### Finding 10: The `detail` surface has no dismiss affordance — navigation away relies on SurfaceNav or browser convention

- **Evidence:** `SpeciesDetailSurface.tsx:112–118` — "No ESC dismiss, no overlay, no close button — the user navigates away via the browser back button or SurfaceNav." The surface renders in-flow inside `<main>` (App.tsx:213–218), not as a drawer or modal.
- **Confidence:** High — confirmed by source comment and visual screenshots (local/desktop/04-species-detail.png shows no close button, no back affordance).
- **Implication:** Users who enter detail from a map popover (or feed row click) have no obvious "go back" affordance. The browser back button does nothing useful (replaceState — see Finding 1). The only exits are: click a SurfaceNav tab (feed/species/map), or change a filter. A redesign should provide an explicit back navigation affordance on the detail surface — either a close button (X), a breadcrumb, or a back link — especially since back-button expectation is strong after navigating deeper into content.

## Surprises

- The back button does not work for in-app navigation. Given this is a React SPA, many users will try the back button to return from detail → feed and discover it does nothing (or navigates to the previous website entirely). This is the single largest IA surprise relative to typical SPA expectations.
- The default front door is feed, not map. For a site called "bird-maps.com", this is architecturally coherent (feed = most recent data = highest information density on load) but brand-inconsistent with the domain name.
- `detail` is not represented in SurfaceNav. When on the detail surface, no tab is highlighted. This is an invisible state in the navigation model — users may not know where they are or how to get back.
- The species surface's SpeciesAutocomplete navigates to `detail`, not `species`. A user on the species surface who commits a species name is immediately transported to a different surface with no tab active. The surface transition is silent.
- FiltersBar has two species-related controls — a `Family` dropdown and a `Species` text search — while the SpeciesAutocomplete on the species surface is a third, structurally similar control. Three controls touching species/family across two chrome zones is IA complexity that a redesign should address.
- `FeedSurface.tsx:64` — sort mode (Recent/Taxonomic) is component-local state, not URL state. Changing sort and sharing the URL does not preserve the sort choice. This is documented in the source comment ("Out of scope" for issue #119) but is a gap in shareability.

## Unknowns & Gaps

- **Map popover → detail transition path**: confirmed via `MapSurface.tsx` prop `onSelectSpecies` which is wired to `App.tsx:101–104`'s `onSelectSpecies = set({ detail, view: 'detail' })`. But the exact UX of the map popover (what it shows, how the "See species details" link is rendered) requires reading `MapCanvas` / `ObservationPopover` — not read in this investigation. The navigation path is confirmed; the popover's visual design is not.
- **Deep-link robustness for detail without species**: `url-state.ts:53–54` — `?detail=<code>` without `?view=` sniffs to `view='detail'`. But `SpeciesDetailSurface` renders only when `state.view === 'detail' && state.detail` (App.tsx:213). If `state.detail` is set to an invalid/non-existent species code, `useSpeciesDetail` would presumably return an error — the error state at `SpeciesDetailSurface.tsx:205–209` says "Could not load species details" with `role="alert"`. The UX is graceful but no redirect to feed occurs.
- **Family filter interaction with speciesCode filter**: both `familyCode` and `speciesCode` can be set simultaneously in URL state. `App.tsx:24–29` passes both to `useBirdData`. The API behavior when both are set (AND vs. OR) is not confirmed from frontend code alone — this is a backend/API contract question.
- **SurfaceNav scroll behavior on mobile**: SurfaceNav is a fixed row of three tabs. On mobile (390×844), the FiltersBar takes two rows (local/mobile/01-map-default.png confirms), reducing map/content area. Whether SurfaceNav itself is sticky or scrolls out of view is not confirmed from source alone — it would require CSS inspection (`styles.css`).
- **Sort mode shareability**: `FeedSurface.tsx:64` sort mode is local state only. This is a known gap per issue #119's "Out of scope" note. A future iteration would lift into `useUrlState`.

## Raw Evidence

### Files read
- `/Users/j/repos/bird-watch/frontend/src/state/url-state.ts` — full file (113 lines)
- `/Users/j/repos/bird-watch/frontend/src/App.tsx` — full file (259 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/SurfaceNav.tsx` — full file (110 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/FiltersBar.tsx` — full file (125 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/FeedSurface.tsx` — full file (160 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/MapSurface.tsx` — full file (183 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesSearchSurface.tsx` — full file (84 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesDetailSurface.tsx` — full file (254 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/ObservationFeedRow.tsx` — full file (104 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/FamilyLegend.tsx` — full file (213 lines)
- `/Users/j/repos/bird-watch/frontend/src/components/SpeciesAutocomplete.tsx` — full file (354 lines)

### Screenshots examined (rendered via Read tool)
- All 31 captures across local/prod × desktop/mobile × 4 surfaces + attribution modal + map filtered state

### URL state parameter inventory (confirmed from url-state.ts)

| Param | Type | Default | Omitted when | Notes |
|---|---|---|---|---|
| `?view=` | `'feed'\|'map'\|'species'\|'detail'` | `'feed'` | view=feed AND no species/detail set | `'hotspots'` silently redirects to `'map'` |
| `?since=` | `'1d'\|'7d'\|'14d'\|'30d'` | `'14d'` | value is 14d | |
| `?notable=` | `'true'` | absent = false | false | |
| `?species=` | species code string | absent = null | null | eBird species code |
| `?family=` | family code string | absent = null | null | |
| `?detail=` | species code string | absent = null | null | Triggers view sniff to 'detail' when view absent |

### Surface × viewport completeness

| Surface | Desktop | Mobile |
|---|---|---|
| feed | covered (02-feed.png, FeedSurface.tsx:62–160) | covered (mobile/02-feed.png) |
| map | covered (01-map-default.png, MapSurface.tsx) | covered (mobile/01-map-default.png) |
| species | covered (03-species-search.png, SpeciesSearchSurface.tsx) | covered (mobile/03-species-search.png) |
| detail | covered (04-species-detail.png, SpeciesDetailSurface.tsx) | covered (mobile/04-species-detail.png) |

### Navigation transition map (all confirmed in source)

```
Front door (no params)  →  feed  (url-state.ts:57–59, DEFAULTS.view='feed')

Feed row click          →  detail  (App.tsx:101–104, onSelectSpecies = set({detail, view:'detail'}))
                                   via ObservationFeedRow.tsx:34–36 (activate → onSelectSpecies)

Map popover link        →  detail  (App.tsx:101–104, via MapSurface prop onSelectSpecies)

SpeciesAutocomplete     →  detail  (SpeciesSearchSurface.tsx:47–50 → onSelectSpecies = set({detail, view:'detail'}))
  commit (species tab)

SurfaceNav click        →  feed|species|map  (SurfaceNav.tsx:97–102, onSelectView(tab.value))
  (any tab, any surface)

FamilyLegend click      →  [same view, familyCode updated]  (App.tsx:91–96, set({familyCode: ...}))

FiltersBar change       →  [same view, filter updated]  (App.tsx:163–164, onChange={set})

skip-link click         →  feed  (App.tsx:116–131, set({view:'feed'}))
  (map surface only)

?view=hotspots bookmark →  map  (url-state.ts:42–50, replaceState shim)
```
