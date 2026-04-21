# Path A Viability Assessment — Stress-Test

**Date:** 2026-04-21
**Author:** Constructive dissent pass, pre-issue-writing
**Input:** Phase 4 `analysis-report.md`, Phase 3 `synthesis-2.md`, Phase 2 iterators 1/2/4
**Audience:** Julian, before GitHub issue drafting and plan authoring
**Premise:** Path A (non-spatial UI — feed, list, grid, cards; no geography) has been chosen. This document does not re-litigate that choice. It stress-tests whether the delivered UI can actually achieve the 11/14 task-fit score that motivated the selection, and where the honest gates are.

---

## Part 1 — Stress-test the 11/14 claim

Iterator 1's 11/14 is a structural-support ceiling, not a delivery guarantee. Four degradation vectors can drop the realised score.

### Surface dominance failure — Credibility: **Strong**

Iterator 1 scores Path A with three task-surfaces carrying the load: the reverse-chronological feed (T1, T7, partial T3), species-first search + panel (T3, T4), and hotspot ranked list (T5 partial, T6). The score assumes all three are navigable from equal footing. In practice, one is the landing view — whichever opens at `bird-maps.com` — and the others become second-click surfaces. Second-click surfaces score worse than first-click ones even when the data is identical.

Archetype-to-surface mapping:
- **Visiting birder** → hotspot-list-primary (T5, T6 land strong; T3 degrades to "use search from a hotspot").
- **Local birder** → feed-primary (T1, T7, T3 land strong; T5 degrades to "scroll/filter").
- **Casual non-birder** → feed-primary with notable ordering (T1, T7 land strong; T4/T5 both deferred).

Recommendation H3 (pick an archetype before the brainstorm) is therefore load-bearing on the realised score. Without a committed pick, default surface is whatever the first commit makes convenient — which is not an archetype decision. Realised score under that regime is one archetype's score, not 11/14.

**Mitigation:** Archetype written into plan's goals section. Default surface follows as direct consequence, stated in the same paragraph. If Julian cannot commit, plan should size at 8–9/14 with named deferred tasks. Honesty.

### Latent-field adoption failure — Credibility: **Strong**

Finding F2 lists five latent fields for zero-backend integration: `obsDt`, observation `lat/lng`, `locName`/`howMany`, row-level `isNotable`, `taxonOrder`/`familyCode`. The 11/14 scoring assumes all five. Iterator 1's per-task justifications lean on them: T1 requires `isNotable`; T3 wants `howMany`; T4 wants `taxonOrder`; T5 wants `locName`; T7 requires `obsDt`.

If Julian ships 2 of 5 (say `obsDt` and `isNotable`, deferring the rest as "first follow-up"):
- T3 drops 2→1 (panel works but lacks observation context).
- T4 drops 2→1 (family is a filter, not a stable taxonomic index).
- T5 drops 1→0 (hotspot list without `locName` is unreadable coordinates).

Net: 11/14 becomes ~8/14 — one point above current 6/14.

Recommendation H6 warns this ("first-day wins, not stretch goals") but plans regularly contain "nice-to-haves" that slide past first-release ship pressure.

**Mitigation:** All five committed as release-1 acceptance criteria with grep-test that the frontend reads each field. `taxonOrder` null-handling policy written in plan body, not deferred. If three-of-five is the only viable ship, say which two are deferred, mark the reduced score, and stop claiming 11/14.

### Taxonomy re-emergence (R3) — Credibility: **Moderate**

Is a region filter dropdown listing the nine ecoregion names a taxonomy failure?

Partial failure, not full. Finding E3 says ecoregion survives as filter/facet; it does not survive as default visual container. A dropdown labelled "Region" with nine options is in-bounds for E3.

But R3's deeper concern is equal-weight visual encoding for unequal data density (40× skew: Sonoran-Phoenix 78 obs vs Grand Canyon 2 at 14d). A dropdown listing nine regions alphabetically with no count reproduces equal-weight encoding in list form. A user picking "Grand Canyon" and seeing 2 observations feels the same "is this broken?" dissonance the map creates.

Not as severe as the map (dropdown is a filter, not a primary display), but real enough to mitigate. Options should carry current-window counts ("Sonoran-Phoenix (78)") so density skew is legible pre-selection.

**Mitigation:** Region options annotated with counts. No persistent region-colour chips next to feed rows (grid-of-badges colour-by-region replicates the equal-weight-tile problem). Region filter is a dropdown, not an always-visible chip row.

### T6 "diversity at a glance" weakness — Credibility: **Strong**

This is the honest wart on 11/14. Iterator 1 scores T6=1 for Path A and concedes in the justification that the score is soft: non-spatial formats "require the user to build a spatial mental model themselves." Read plainly: without a visual encoding, T6 is 0, because "at a glance" is the task's defining verb and a sorted table is not a glance.

Path A reaches 1 only if a visual encoding ships. Candidates that stay non-spatial:
- Small horizontal bar chart of species-per-region (9 bars, header strip).
- Sparkline of sightings-per-day over the since-window.
- Heatmap-strip of species counts by family by region.

None require a map. If Path A ships with only text lists, T6 is honestly 0 and the total is 10/14 — still a gain over 6/14, but the claimed 11/14 is false.

**Mitigation:** Ship a T6 summary chart in release 1 OR accept T6=0 and target 10/14. Do not claim 11/14 without committing to the encoding.

---

## Part 2 — Mobile feasibility

Phase 4 §G marks mobile-viewport feasibility as low-confidence; only `bird-maps-mobile-390.png` exists and it is a map capture.

### Mobile-specific failure modes

- **Row density at 390px.** Row minimally needs species name, family, count, location, timestamp. At ~340px of content width, single-line truncates everything; multi-line eats 80–100px per row, so 344 rows becomes ~30,000px of scroll — fine for scroll-as-primary, hostile to thumb review.
- **Tap targets.** 44pt (iOS) / 48dp (Material) minimums. Multi-line row clears this; dense single-line does not. Sub-target collisions if row-tap and species-tap are distinct affordances.
- **FiltersBar wrap.** Five filters (since, notable, species, family, region) at 390px wrap to 2–3 rows — 120–180px of above-fold real estate before the first feed row. Competes with the T6 encoding for scarce header space.
- **Panel vs drawer.** `SpeciesPanel` at `position: fixed; right: 0; width: 320px` occupies 82% of a 390px viewport — effectively full-screen. Dismiss via ESC is keyboard-only; tap-outside semantics are undefined in the existing component. R4 is acute on mobile.
- **Autocomplete dropdown** near bottom-of-viewport can overflow; needs explicit placement.

### Minimum prototype to validate mobile viability

Live prototype at representative data volume. Not paper (doesn't test density); not static HTML (doesn't test interaction). Concretely:

- React page (or plain HTML) rendering 344 observation rows from canned JSON.
- FiltersBar placeholder with toggling state.
- T6 summary strip (static SVG placeholder OK) at the top.
- `SpeciesPanel` as drawer at mobile, sidebar at desktop, with explicit breakpoint.
- Deployed to local dev server or CF Pages preview; tested at 390×844, 414×896, 360×800, 768×1024.

2–4 hours if row-shape and canned JSON are pre-decided. Output: living confirmation that density, tap targets, and wrap behaviour are tolerable.

### Desktop-vs-mobile incompatibility risk

Tension: `SpeciesPanel` affordance. Desktop 1440px with a 320px sidebar — content gets 1120px. Mobile 390px with same sidebar — near-full-screen takeover. Two different layouts.

Three resolutions:
1. **Single responsive layout** — panel is always a drawer. Loses desktop list+detail simultaneity.
2. **Breakpoint-switched** — drawer <768px, sidebar >=768px. Two panel presentations.
3. **Drawer everywhere** — cleanest code; accepts no desktop list+detail.

None break Path A viability. The risk is deferring the decision and then discovering mid-implementation that the interaction contract assumes one and the layout assumes another. 2-hour prototype closes the uncertainty.

---

## Part 3 — Volume / performance stress-test

Iterator 2 measured 344 rows / 101 KB / 230 ms TTFB under stall. Healthy-ingestor projection: 1,500–2,000 rows.

### Naive unpaginated feed at 2,000 rows

~12,000 DOM nodes for feed content alone. On cold mobile Safari / mid-tier Android: 200–400ms initial layout. Scroll is fine with browser rasterisation; virtualisation not required at this volume. Filter changes re-render — if naive, each flip costs 100–200ms reconciliation on mobile. Unacceptable as input-to-update latency. Mitigations: memoise row component; `useDeferredValue`; accept snap delay on cold filter flips. None require virtualisation.

**Verdict:** No virtualisation at 2,000 rows. Memoisation is release-1, not post-ship.

### Species autocomplete at 2,000 entries

Result set is the species index (Iterator 2 Finding 5). AZ 14d realistically has 400–600 distinct species even at healthy ingest (1,500–2,000 is observation rows, not species). Substring match over 600 entries is sub-millisecond. No debounce needed for perf; optional for feel.

### Gzip (O6) — must-ship or nice-to-have?

At 344 rows / 101 KB uncompressed, mobile 3G is ~8-second download; mobile 4G is ~1s. At 1,500 rows / 450 KB uncompressed, 4G is 3–4 seconds just for JSON — on first paint for anonymous cold visitors.

Gzip (one-line Hono `compress()`, ~10× reduction) takes 450 KB to 45 KB. Difference between "mobile usable on the go" and "mobile forces wifi."

**Verdict:** Gzip is a **must-ship prerequisite**, not concurrent. File immediately; tag `release-blocker`; land before any Path A surface. Any first-paint payload over ~150 KB compressed is a mobile liability.

### Species-aggregate grain — feature or limit?

Backend returns one row per species, not per sighting. Path A's feed surface naturally wants individual sightings ("3 Vermilion Flycatchers at Patagonia Lake SP, 2 hours ago"). Backend delivers species aggregate with one representative observation.

Semantic mismatch, not bug. The question is whether the user understands "this species was seen, most recently here, at this time" vs "time-ordered feed of sightings." For Path A: T1, T3, T4, T7 work with aggregate grain. T5 partially suffers (one hotspot per species isn't a density heatmap). T2 isn't served beyond name match.

**Verdict:** Species-aggregate grain is a constraint, not a blocker. Plan should state which tasks the grain fully serves vs partially serves, and mark a future `/api/sightings` observation-grain endpoint out-of-scope for release 1. UI copy avoids "sightings feed"; prefers "species activity" or "recent species."

---

## Part 4 — Path B forward-compatibility

R6 warns shipping Path A risks Path B becoming "coming soon" indefinitely. Composability is only real if Path A is built to preserve it.

### Decisions that foreclose Path B

- **Route structure assuming non-spatial is the only mode.** `/feed`, `/species/:code`, `/hotspots`, `/family/:code` with no mode-switching — adding a map route later requires a separate shell or retrofit.
- **URL-state flattening lat/lng.** If `?region=` reshapes and no `?lat=&lng=&zoom=` or `?bbox=` space is carved out, geographic mode requires a second URL migration.
- **No view-mode abstraction.** If `App.tsx` wires `<FeedView>` directly with no `<PrimaryView mode={...}>`, adding `<MapView>` means rewiring the tree.
- **No geographic slot in state.** Filter state without `lat/lng` or `bbox` forces a state-contract change later.
- **Lat/lng coerced to display strings early.** Path B must re-parse.

### Decisions to make NOW to preserve composability

- **`view` or `mode` state slot** in URL state (`?view=feed` today, `?view=map` later). Zero cost to add; infinite to retrofit.
- **Keep `lat` and `lng` as numbers** in the derived data layer. Display layer formats; data layer preserves.
- **Type-system placeholders** for `bbox` and `near` parameters on `ApiClient`. No runtime cost.
- **Extract a `<PrimaryView>` composition slot** in `App.tsx`. Ships with only `<FeedView>`; Path B adds `<MapView>` without rewiring.
- **Mode-agnostic `SpeciesPanel` deep-link.** `?species=code` works from feed, hotspot list, future map, anywhere.

### Decisions to avoid

- **Region-to-ecoregion in routing layer.** Region is a filter param, not a route segment (`/region/sky-islands-huachucas` couples taxonomy to URL shape).
- **Dropping hotspot endpoints from API client "because Path A doesn't use them yet."** Unused but present.
- **Hardcoded sort order assumption.** Sort is a parameter; default `obsDt DESC`, open to `distance` or `richness` when geography ships.

Composability is preservable with disciplined choices. The risk is forgetting to make them. Plan acceptance criteria should enumerate each.

---

## Part 5 — Process & operational concerns

### Ingestor stall (R2) — before or after ship?

Path A must not ship while the ingestor is stalled. A stalled feed UI is more legibly broken than a stalled map UI — temporal framing makes staleness visible in a way absolute geography doesn't. The stall is a priority-0 operational issue regardless of redesign. ~1 hour of log-diving.

**Verdict:** Ingestor fix is a release-blocker on Path A.

### API compression (R8 / O6) — prerequisite or concurrent?

Prerequisite. See Part 3. One-line `compress()` middleware on Hono. Ship before first Path A surface renders on mobile.

### Prototype gate (H4) for Path A specifically

Current map dragons are SVG-specific (paint-order, inscribed-rect, transform-origin). Path A has different dragons:

- **Filter-flip render latency** at 2k rows. Prototype confirms memoisation sufficient.
- **Keyboard navigation on long feeds.** Tab through 344+ rows is heavy. Most feeds use focus-trap + arrow-key. Must be modelled.
- **Scroll-position restore on deep-link.** `?species=` opens panel; close must return scroll to the row. Easy to forget.
- **Autocomplete positioning** at bottom of viewport.
- **Empty-state design.** `?since=1d&notable=true` at 3 rows must not read as "is something wrong?" — maps show empty space naturally; short lists look like bugs.

Prototype spec for Path A:
- 344 canned rows matching current Observation shape.
- FiltersBar wired to at least `since` and `notable`.
- `SpeciesPanel` as drawer-at-mobile, sidebar-at-desktop, opening via `?species=` with scroll restore on close.
- Tested at 390×844 and 1440×900, keyboard-only pass included.

Scope: 2–4 hours. Different from a map prototype (different failure modes); same principle (validate before planning).

### User-research gap — cheapest empirical check

Three options ordered by cost:

1. **Julian-as-user test** (0 min marginal): 15 minutes on the site pre-issue-writing, attempting the seven tasks as each archetype.
2. **Send to one friend** (~1 hour): message a non-local casual-birder friend; ask what they'd want on AZ-birds.com; do not lead.
3. **Analytics on existing site** (~30 min): pull any wired-up session data. Likely thin signal.

**Verdict:** Option 1 pre-plan. Option 2 post-plan, pre-ship. The risk of zero empirical check is that Julian picked the ecoregion frame for himself and it turned out not to serve the tasks he himself values. Pattern. One friend conversation would probably have surfaced it.

---

## Part 6 — The go / conditional-go / no-go call

| Risk | Call | Required mitigation |
|---|---|---|
| **R1** Rendering churn escalates | **Go** | Path A selection already resolves R1 — DISCARD manifest is clean stop-loss. |
| **R2** Ingestor stall masks volume | **No-go until resolved** | Fix before Path A first release. ~1 hour. |
| **R3** Taxonomy re-emergence | **Conditional-go** | Region dropdown options carry current-window counts; no persistent region-colour chips in feed rows. |
| **R4** SpeciesPanel layout KEEP | **Conditional-go** | Panel is REFACTOR-layout. Drawer-at-mobile / sidebar-at-desktop decision pre-plan. |
| **R5** URL migration breaks bookmarks | **Conditional-go** | `?region=` migration policy written in plan before issue writing. |
| **R6** Path A/B composability foreclosure | **Conditional-go** | Five composability decisions from Part 4 as acceptance criteria. |
| **R7** "Ditch map" misread | **Go** | Path A chosen. Document in plan so it doesn't re-open. |
| **R8** No CDN/gzip | **No-go until resolved** | Hard prerequisite. One Hono line. Land before Path A ships. |
| **R9** Species-dedup semantics | **Conditional-go** | Plan language avoids individual-sighting promises. "Species activity" not "sightings feed." |
| **R10** Plan before prototype | **Conditional-go** | 2–4 hour Path A prototype before plan body written. |
| **New: Latent-field adoption** | **Conditional-go** | All five latent fields as release-1 criteria with grep-assertion. `taxonOrder` null policy in plan. |
| **New: T6 visual encoding** | **Conditional-go** | Ship a summary chart in release 1 OR accept T6=0 and target 10/14. |
| **New: Default surface / archetype pick** | **Conditional-go** | Archetype committed in writing in plan goals. Default surface as consequence. |
| **New: Mobile panel / sidebar resolution** | **Conditional-go** | Breakpoint-switched or single-layout decision made and prototyped pre-plan. |

**Tally:** 2 no-go-until-resolved, 10 conditional-go, 2 go.

**Honest reading:** Path A is not blocked on the path choice. Path A is blocked on: (1) ingestor fix (~1 hour), (2) gzip enablement (1 line). Conditionally blocked on ten items that all collapse to "write it into the plan before issues, don't defer." None individually are deal-breakers. Collectively they are the plan's acceptance criteria. Skipping them lets R6, R3, R9, and the new risks eat the realised score.

---

## Part 7 — Prototype recommendation

**Build a 2–4 hour prototype before issue writing.**

Scope:
- Vite + React (architecture not under test).
- Canned `src/fixtures/observations-344.json` matching `/api/observations` shape across 9 regions. Optionally `observations-2000.json` with upsampled duplicates for volume stress.
- `<FeedView>` rendering all 344 rows with species, family, count, location, timestamp, notable indicator.
- `<FiltersBar>` wired to `since` (1d/7d/14d/30d), `notable` (toggle), `region` (dropdown with counts).
- `<SpeciesPanel>` as drawer <768px, 320px sidebar >=768px, opening via `?species=` with ESC close and scroll-restore.
- T6 summary strip: 9-bar horizontal chart of species-count-per-region, static SVG or raw SVG component.
- Tested at 390×844 and 1440×900, keyboard-only and mouse.

Deliberately out of scope: real API wiring, species autocomplete (Part 3 validates as fine), hotspot list surface (second-priority unless visiting-birder archetype), hard-refresh deep-link restore.

Output: screen recording or local dev URL plus a 5-line "things I learned" note. Surfaces mobile panel failures, autocomplete collisions, or T6 chart silliness at 9 values before the plan absorbs them.

**Not needed if:** Julian accepts the dragon risk knowingly with high prior-build confidence. But Finding G2's explicit argument is that plan-confidence is where the current dragon inventory came from. 2-hour investment against multi-week plan is cheap insurance.

**Recommendation: build the prototype.**

---

## Part 8 — GitHub issues this stress-test feeds

1. **infra: enable gzip on api.bird-maps.com (prereq to Path A)** — One-line Hono `compress()`; verify with `curl -H 'Accept-Encoding: gzip'`. Release-blocker.
2. **ops: diagnose and resolve ingestor stall (prereq to Path A)** — Cloud Scheduler / Run logs; re-enable cron; confirm `/api/observations?since=1d` non-empty. Release-blocker.
3. **plan: Path A archetype and default surface commitment** — Pre-plan artifact; archetype picked, default surface named.
4. **plan: Path A prototype gate (2–4 hour representative render)** — Prototype scope per Part 7; deliverable is preview URL + learnings. Blocks plan-body authorship.
5. **plan: Path A release-1 acceptance criteria table** — Consolidates latent-field integration (5 of 5), T6 encoding decision, `?view=` slot, panel layout mode, `?region=` migration policy, aggregate-grain disclosure.
6. **frontend: SpeciesPanel mobile drawer + desktop sidebar (REFACTOR-layout)** — Replaces KEEP-as-is; tap-outside dismiss; scroll-restore on close.
7. **frontend: integrate 5 latent fields (obsDt, lat/lng, locName/howMany, row-level isNotable, taxonOrder/familyCode)** — Null-handling for `taxonOrder`; grep-assertion that frontend reads each.
8. **frontend: T6 species-diversity summary strip** — 9-bar chart at header of feed.
9. **frontend: composability scaffolding for future geographic mode** — `?view=feed` URL slot, `<PrimaryView>` abstraction, numeric lat/lng preserved, api-client `bbox`/`near` parameter placeholders.
10. **frontend: region filter option density annotation** — Dropdown options labelled with current-window counts. Defuses R3.
11. **frontend: ?region= URL migration policy for bookmarked deep-links** — Redirect / graceful filter / soft warning. Closes R5.
12. **test: Path A keyboard-nav and focus-restore e2e spec** — Tab → row, Enter → panel, ESC → close + scroll-restore; mobile and desktop.
13. **test: Path A volume smoke at 2,000 rows** — Canned fixture + filter-flip latency assertion; confirms memoisation sufficient without virtualisation.
14. **docs: Path A plan (plan-6 or equivalent)** — Authored after issues 1–4 resolved; absorbs acceptance criteria from issue 5.

Issues 1–2 are release-blockers. Issues 3–4 are plan-body-blockers. Issues 5–11 are release-1 acceptance criteria. Issues 12–13 are test gates. Issue 14 is the plan.

---

## Closing honest note

Path A is the right call for a solo-developer project at current engineering-debt position. The 11/14 claim is realistically achievable **if** five latent fields are enforced, T6 encoding ships, and archetype commitment is pre-plan. Without those, the realised score is 8–9/14 — still better than 6/14 current, but not the meaningful improvement the selection was chosen for.

The two risks that must close before any Path A ship are R2 (ingestor) and R8 (gzip). Both are cheap. Neither is a design decision.

The risk nobody can close via process is whether Julian-the-user of bird-maps.com will actually like a non-spatial UI once it ships. Iterator 4's third blind spot remains unresolvable without either a prototype Julian spends 10 minutes using himself or a shipped first release he lives with. Both are acceptable strategies. "Neither" is not.

Go to issue writing after issues 1, 2, 3, 4 are resolved. Not before.
